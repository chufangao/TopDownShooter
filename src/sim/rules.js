// The rules registry: each rule a synergy, a Legendary relic, a capstone or a boss's override brings to a battle, its
// hooks in one place. turns.js calls a hook with (battle, ctx, r), `r` the rule as the side holds it: its entry, `holder`
// (the unit whose relic or def brings it; null for a synergy's) and `params` (its defaults here, a relic's over them).
//   onBlow    an act has resolved (never a counter): { actor, ability, primary, targets }
//   onStruck  a blow has landed on one that still stands: { actor, target, ability, damage }
//   onFall    one of the side's own has fallen: { fallen, by }; a rule may lift it again (Undying)
//   onKill    one of the other side has fallen, whoever felled it (a status too): { slain, by, side }
//   onRaise   a foe Claimed by an Arise of the side's has risen as its shadow: { actor, corpse, shadow }
//   onTurn    the side's turn begins: { side, turn }
//   onWave    a foe wave has entered: { wave }
//   onMove    a walk committed (never one undone): { actor, from, to, moved, as }, `as` 'actor', then 'other'
//   targets   whom an ability touches: { actor, ability, primary, targets, as }, 'target' sets primary, 'actor' targets
//   reach     how far an ability of the side reaches its primaries: { actor, ability, range } (it may change `range`)
//   modify    damage about to land: { actor, target, ability, status, damage, miss, as }, 'actor' then 'target'
//   stand     that damage bent, not missed, target's side: { …, damage, mend } (lower `damage`, `mend` a share healed)
//   queue     the foes' turn's order: { queue } (it may reorder it)
//   grants    an ability id its holder gains (Arise's)
//   roles     (battle, u, r) → the roles its holder counts as besides its own, for synergies (Mimicry)
import { TUNING } from '../tuning.js'
import { unitDef, relicDef, abilityDef, statusDef } from '../content.js'
import { alive, livingOn, unitDistance, distanceBetween, blowReach, makeUnit, synergyFull, enemySide } from './unit.js'
import { around, riseTile, summonTile } from './field.js'
import { emit, raise, roomFor, shadowSize, runEffect, synergiesOf, synergyCountsOf, addStatus, perform, usable, canAct, shape, targetsFrom, cool, enterBattle, lined, hexed, aloft, answer } from './turns.js'

const vanguard = (u) => unitDef(u.id).role === 'vanguard'
// Whether one of the side's own felled `slain` (a status it laid counts: `by` is its layer).
const slew = (by, side, slain) => !!by && by.side === side && slain.side !== side

export const RULES = {
  // Undead 4: a foe slain rises at once as a shadow of the side, past Arise's reach and tier (never a boss or a shadow).
  legion: {
    onKill (battle, { slain, by, side }) {
      if (alive(slain) || slain.raised || slain.shadow || unitDef(slain.id).boss || !roomFor(battle, side)) return
      if (side === 'party' && riseTile(battle, slain.tile, shadowSize(slain, side), slain.flies) < 0) return
      const actor = by?.side === side ? by : null
      emit(battle, { type: 'rule', rule: 'legion', side, actor: actor?.uid ?? null, target: slain.uid })
      raise(battle, actor, slain, { side, rule: 'legion' })
    }
  },
  // Drake 4: a single-target blow of the side's bursts on its target and everyone of its side beside it.
  dragonfire: {
    targets (battle, ctx) {
      const { actor, ability, primary } = ctx
      if (ctx.as !== 'actor' || ability.shape !== 'single' || ability.claim || primary.side === actor.side) return
      const out = around(battle, primary.tile, 1, primary.side, primary.size)
      ctx.targets = ability.melee && !actor.flies ? out.filter((x) => !x.flies) : out
    }
  },
  // Fae 4: the first blow each foe would land on the side (yours or theirs) in the battle misses; its later blows land
  // (`foiled`, set once and never reset: one entering later has a first blow of its own). Damage alone is foiled, a
  // tick never, and an act that lays only a status lands. A miss is whole (turns.js runEffect): it lays nothing on the
  // one it missed, and no relic hears it.
  mirage: {
    modify (battle, ctx) {
      const { actor, target } = ctx
      if (ctx.as !== 'target' || ctx.status || ctx.miss || !actor || actor.side === target.side || actor.foiled) return
      actor.foiled = true
      emit(battle, { type: 'rule', rule: 'mirage', side: target.side, actor: actor.uid, target: target.uid })
      ctx.miss = true
    }
  },
  // Insect 4: one of the side's that slays a foe has every skill ready again.
  frenzy: {
    onKill (battle, { slain, by, side }) {
      if (!slew(by, side, slain) || !alive(by)) return
      emit(battle, { type: 'rule', rule: 'frenzy', side, actor: by.uid, target: slain.uid })
      for (const id in by.cooldowns) if (by.cooldowns[id] > 0) cool(battle, by, id, 0)
    }
  },
  // Construct 4: the first damage that would fell each of the side's but the Monarch leaves it at 1 HP, and it heals.
  last_stand: {
    stand (battle, ctx) {
      const { target } = ctx
      if (target.stood || target === battle.monarch || ctx.damage < target.hp) return
      target.stood = true
      ctx.damage = target.hp - 1
      ctx.mend = TUNING.lastStand.heal
      emit(battle, { type: 'rule', rule: 'last_stand', side: target.side, target: target.uid })
    }
  },
  // Vanguard 4: a single-target blow at one not a Vanguard falls on a Vanguard beside it; Vanguards take less damage.
  bodyguard: {
    modify (battle, ctx) {
      if (ctx.as === 'target' && !ctx.miss && vanguard(ctx.target)) ctx.damage *= TUNING.bodyguard.taken
    },
    targets (battle, ctx) {
      const { actor, ability, primary } = ctx
      if (ctx.as !== 'target' || ability.shape !== 'single' || primary.side === actor.side || vanguard(primary)) return
      const guard = around(battle, primary.tile, 1, primary.side, primary.size).filter(vanguard).sort((a, b) => b.hp - a.hp || a.ord - b.ord)[0]
      if (!guard) return
      emit(battle, { type: 'rule', rule: 'bodyguard', side: guard.side, actor: guard.uid, target: primary.uid })
      ctx.primary = guard
    }
  },
  // Ranger 4: the side's ranged blows deal `mul` times their damage.
  deadeye: {
    params: { mul: 1.5 },
    modify (battle, ctx, r) {
      const { actor, target, ability } = ctx
      if (ctx.as !== 'actor' || ctx.status || !ability || ability.melee || actor.side === target.side) return
      ctx.damage *= r.params.mul
    }
  },
  // Skirmisher 4: the side's pieces start or enter the battle Hastened for TUNING.ambush.turns turns.
  ambush: {
    onTurn (battle, { side }) {
      const fresh = battle.units.filter((u) => u.side === side && alive(u) && !u.ambushed && u !== battle.monarch)
      if (!fresh.length) return
      emit(battle, { type: 'rule', rule: 'ambush', side })
      for (const u of fresh) {
        u.ambushed = true
        addStatus(battle, u, 'hasten', TUNING.ambush.turns, u)
      }
    }
  },
  // Channeler 4: every ability of the side's (never an Arise) rings out once more, free; at TUNING.echo.half below `full`.
  // The echo is a blow of its own: it may land on one the first missed, and a miss of its own is whole (`missed`).
  echo: {
    params: { full: true },
    onBlow (battle, { actor, ability, targets }, r) {
      if (!alive(actor) || ability.claim || ability.effects.some((e) => e.op === 'raise')) return
      emit(battle, { type: 'rule', rule: 'echo', side: actor.side, actor: actor.uid, ability: ability.id, ...(!r.params.full && { half: true }) })
      const missed = new Set()
      for (const effect of ability.effects) runEffect(battle, r.params.full ? effect : scaled(effect, TUNING.echo.half), actor, targets, ability, null, missed)
    }
  },
  // Warden 4: an ability of the side's aimed at an ally reaches, and touches, every one of its side on the board.
  sanctuary: {
    reach (battle, ctx) {
      if (ctx.ability.shape === 'ally' || ctx.ability.shape === 'all_allies') ctx.range = Infinity
    },
    targets (battle, ctx) {
      if (ctx.as !== 'actor' || (ctx.ability.shape !== 'ally' && ctx.ability.shape !== 'all_allies')) return
      ctx.targets = livingOn(battle.units, ctx.actor.side)
    }
  },
  // Trickster 4: a blow on a foe below TUNING.deathblow.below of its max HP deals TUNING.deathblow.mult its damage.
  deathblow: {
    modify (battle, ctx) {
      const { actor, target } = ctx
      if (ctx.as !== 'actor' || ctx.status || ctx.miss || !actor || actor.side === target.side) return
      if (target.hp >= target.maxHp * TUNING.deathblow.below) return
      ctx.damage *= TUNING.deathblow.mult
      emit(battle, { type: 'rule', rule: 'deathblow', side: actor.side, actor: actor.uid, target: target.uid })
    }
  },

  // ── the Legendaries, each scoped to its holder ──

  // Arise: its holder gains the skill (a foe within its reach Claimed: turns.js fall raises it).
  arise: { grants: 'arise' },
  // Undying: its holder, fallen, rises where it fell at `hp` of its max HP, once a battle.
  undying: {
    params: { hp: 0.6 },
    onFall (battle, { fallen }, r) {
      if (fallen !== r.holder || fallen.rose) return
      fallen.rose = 1
      fallen.hp = Math.max(1, Math.round(fallen.maxHp * r.params.hp))
    }
  },
  // Reaper's Hunger: its holder, slaying a foe in your orders (never by a counter or a tick), has its act again.
  reapers_hunger: {
    onKill (battle, { slain, by, side }, r) {
      if (by !== r.holder || !slew(by, side, slain) || !alive(by) || !by.acted || battle.phase !== 'orders' || battle.stage !== 'party') return
      emit(battle, { type: 'rule', rule: 'reapers_hunger', side, actor: by.uid, target: slain.uid })
      by.acted = false
      by.spent = Math.max(0, by.spent - TUNING.energy.basic)
    }
  },
  // Seven-League Boots: its holder's blows (a counter's too) deal `mul` on a turn it has moved `tiles` or more.
  seven_league_boots: {
    params: { tiles: 3, mul: 1.5 },
    modify (battle, ctx, r) {
      const { actor, target, ability } = ctx
      if (ctx.as !== 'actor' || actor !== r.holder || ctx.status || !ability || target.side === actor.side) return
      if (actor.moved >= r.params.tiles) ctx.damage *= r.params.mul
    }
  },
  // Last Candle: as your turn begins with the Monarch below `below` of its HP, its holder is Desperate for the round.
  last_candle: {
    params: { below: 0.5 },
    onTurn (battle, { side }, r) {
      const u = r.holder
      const m = battle.monarch
      if (side !== u.side || !alive(u) || !m || !alive(m) || m.hp >= m.maxHp * r.params.below) return
      if (!u.statuses.some((s) => s.id === 'desperate')) emit(battle, { type: 'rule', rule: 'last_candle', side, actor: u.uid })
      addStatus(battle, u, 'desperate', 1, u)
    }
  },
  // Grave Powder: while its holder stands, a shadow of its side that falls bursts, `amount` true damage to foes beside it.
  grave_powder: {
    params: { amount: 20 },
    onFall (battle, { fallen }, r) {
      const u = r.holder
      if (!fallen.shadow || fallen.side !== u.side || !alive(u)) return
      const near = around(battle, fallen.tile, 1, enemySide(fallen.side), fallen.size)
      if (!near.length) return
      emit(battle, { type: 'rule', rule: 'grave_powder', side: u.side, actor: u.uid, target: fallen.uid })
      runEffect(battle, { op: 'damage', amount: r.params.amount }, u, near)
    }
  },
  // Overwatch: a foe ending its walk in reach of its holder's basic blow is struck by it at once, `times` a turn.
  overwatch: {
    params: { times: 1 },
    onMove (battle, { actor, to, as }, r) {
      const u = r.holder
      const b = u.basic
      if (as !== 'other' || !b || u.watched >= r.params.times || !alive(u) || !alive(actor) || actor.side === u.side || hexed(u)) return
      const reach = blowReach(u, b)
      if (distanceBetween(u.tile, u.size, to, actor.size) > (actor.flies ? aloft(u, b, reach) : reach)) return
      u.watched++
      emit(battle, { type: 'rule', rule: 'overwatch', side: u.side, actor: u.uid, target: actor.uid })
      answer(battle, u, b, actor, { rule: 'overwatch' })
    }
  },
  // Hold the Line: its holder and its side within a tile deal `mul` at a foe on a turn they have not moved (never a tick).
  hold_the_line: {
    params: { mul: 1.25 },
    modify (battle, ctx, r) {
      const { actor, target } = ctx
      const u = r.holder
      if (ctx.as !== 'actor' || ctx.status || !actor || target.side === actor.side || actor.side !== u.side || !alive(u)) return
      if (actor.moved === 0 && unitDistance(actor, u) <= 1) ctx.damage *= r.params.mul
    }
  },
  // Mimicry: its holder counts as a `role` too, for its side's synergies.
  mimicry: {
    params: { role: 'warden' },
    roles: (battle, u, r) => (u === r.holder ? [r.params.role] : [])
  },
  // ── a capstone's rule, scoped to the piece of its kind: what its abilities cannot say ──

  // The Charnel Cathedral: a foe it slays within a tile of it rises at once as a shadow of its side, as Legion raises.
  charnel_cathedral: {
    onKill (battle, { slain, by, side }, r) {
      const u = r.holder
      if (by !== u || !alive(u) || alive(slain) || slain.raised || slain.shadow || unitDef(slain.id).boss || !roomFor(battle, side)) return
      if (unitDistance(u, slain) > 1) return
      if (side === 'party' && riseTile(battle, slain.tile, shadowSize(slain, side), slain.flies) < 0) return
      emit(battle, { type: 'rule', rule: 'charnel_cathedral', side, actor: u.uid, target: slain.uid })
      raise(battle, u, slain, { side, rule: 'charnel_cathedral' })
    }
  },
  // The Cinder Wyrm: a foe it slays (a blow or its Burning) sets every foe next to it Burning, laid by it: the fire spreads.
  cinder_wyrm: {
    onKill (battle, { slain, by }, r) {
      if (by !== r.holder) return
      const near = around(battle, slain.tile, 1, slain.side, slain.size)
      if (!near.length) return
      emit(battle, { type: 'rule', rule: 'cinder_wyrm', side: by.side, actor: by.uid, target: slain.uid })
      for (const x of near) addStatus(battle, x, 'burning', null, by)
    }
  },
  // The Hive Mind: as the battle begins and each wave enters, `drones` of `kind` hatch beside it; a kill readies its skills.
  hive_mind: {
    params: { drones: 2, kind: 'hive_drone' },
    onTurn (battle, { side, turn }, r) {
      if (turn === 1 && side === r.holder.side) hatch(battle, r)
    },
    onWave (battle, ctx, r) {
      hatch(battle, r)
    },
    onKill (battle, { slain, by, side }, r) {
      if (by !== r.holder || !alive(by) || !slew(by, side, slain)) return
      emit(battle, { type: 'rule', rule: 'hive_mind', side, actor: by.uid, target: slain.uid })
      for (const id in by.cooldowns) if (by.cooldowns[id] > 0) cool(battle, by, id, 0)
    }
  },
  // The Engine of Ages: the first damage each battle that would fell it leaves it at 1 HP instead, apart from Last Stand.
  engine_of_ages: {
    stand (battle, ctx, r) {
      const { target } = ctx
      if (target !== r.holder || target.endured || ctx.damage < target.hp) return
      target.endured = true
      ctx.damage = target.hp - 1
      emit(battle, { type: 'rule', rule: 'engine_of_ages', side: target.side, target: target.uid })
    }
  },

  // ── a boss's override, on top of its temperament ──

  // The Hollow Sovereign: its court moves first; it casts Grave Tide every `every` turns, where it covers the most of yours.
  sovereign: {
    params: { every: 3, ability: 'grave_tide' },
    queue (battle, ctx, r) {
      const court = (u) => u !== r.holder && u.wave === r.holder.wave
      ctx.queue.sort((a, b) => court(b) - court(a))
    },
    onTurn (battle, { turn }, r) {
      const u = r.holder
      if (turn % r.params.every || !canAct(battle, u)) return
      const tide = u.kit.find((a) => a.id === r.params.ability)
      if (!tide || !usable(battle, u, tide)) return
      const covers = (x) => shape(battle, u, tide, x).filter((y) => y.side !== u.side).length
      const at = targetsFrom(battle, u, tide).sort((a, b) => covers(b) - covers(a) || a.uid - b.uid)[0]
      if (at) perform(battle, u, tide, at)
    }
  },
  // The Molting Abbess (against statuses): as the foes' turn begins it sheds every debuff on itself, while it stands.
  molting_abbess: {
    onTurn (battle, ctx, r) {
      const u = r.holder
      if (!alive(u)) return
      const off = u.statuses.filter((x) => statusDef(x.id).tags.includes('debuff'))
      if (!off.length) return
      emit(battle, { type: 'rule', rule: 'molting_abbess', side: u.side, target: u.uid })
      for (const x of off) {
        u.statuses.splice(u.statuses.indexOf(x), 1)
        emit(battle, { type: 'cleanse', target: u.uid, status: x.id })
      }
    }
  },
  // The Barrow Marshal (against shooters): while it stands, a shot at a non-Vanguard of its side lands on a Vanguard beside it.
  barrow_marshal: {
    targets (battle, ctx, r) {
      const { actor, ability, primary } = ctx
      if (ctx.as !== 'target' || !alive(r.holder) || primary.side !== r.holder.side || actor.side === primary.side || !lined(ability) || vanguard(primary)) return
      const guard = around(battle, primary.tile, 1, primary.side, primary.size).filter(vanguard).sort((a, b) => b.hp - a.hp || a.ord - b.ord)[0]
      if (!guard) return
      emit(battle, { type: 'rule', rule: 'barrow_marshal', side: guard.side, actor: guard.uid, target: primary.uid })
      ctx.primary = guard
    }
  },
  // The Swarm Queen (against walls): every `every` turns, while it stands, `drones` of `kind` hatch beside it, up to `most`.
  swarm_queen: {
    params: { every: 2, drones: 2, most: 4, kind: 'hive_drone' },
    onTurn (battle, { turn }, r) {
      if (turn % r.params.every) return
      const standing = battle.units.filter((x) => x.summoner === r.holder.uid && alive(x)).length
      hatch(battle, r, Math.min(r.params.drones, r.params.most - standing))
    }
  }
}

// An effect at `k` of its strength (Echo's lesser form): damage and healing × k, a status's turns × k rounded up.
function scaled (e, k) {
  if (e.op === 'damage' || e.op === 'heal') return { ...e, ...(e.power != null && { power: e.power * k }), ...(e.pct && { pct: e.pct * k }) }
  if (e.op !== 'apply_status') return e
  const turns = e.turns ?? statusDef(e.status).turns
  return turns === 'battle' ? e : { ...e, turns: Math.ceil(turns * k) }
}

// A Hive Mind's or a Swarm Queen's drones hatch: `n` summons of its holder's on the free tiles nearest it (summonTile),
// while it stands and its side has room; with no tile free, fewer.
function hatch (battle, r, n = r.params.drones) {
  const u = r.holder
  if (!alive(u)) return
  const flies = !!unitDef(r.params.kind).flies
  for (let k = 0; k < n && roomFor(battle, u.side); k++) {
    const tile = summonTile(battle, u, 1, flies)
    if (tile < 0) return
    if (!k) emit(battle, { type: 'rule', rule: r.id, side: u.side, actor: u.uid })
    const drone = enterBattle(battle, { ...makeUnit(r.params.kind, { uid: battle.nextUid++, lvl: u.lvl }), side: u.side, shadow: true, summoned: true, summoner: u.uid, tile })
    emit(battle, { type: 'enter', unit: { uid: drone.uid, id: drone.id, side: drone.side, tile: drone.tile, lvl: drone.lvl, hp: drone.hp, maxHp: drone.maxHp, shadow: true, summoned: true, summoner: u.uid } })
  }
}

// A rule as a side holds it: its entry, its holder (null for a synergy's) and its numbers.
const entry = (id, holder = null, params = null) => {
  if (!Object.hasOwn(RULES, id)) throw new Error(`no rule "${id}" in the registry`)
  return { id, ...RULES[id], holder, params: { ...RULES[id].params, ...params } }
}

// The rules a unit's piece relics and its kind's def (a boss's override, a capstone's) bring it, scoped to it. → entries.
export function heldRules (u) {
  const out = []
  for (const id of u.relics ?? []) {
    const r = relicDef(id)
    if (r.rule) out.push(entry(r.rule, u, r.params))
  }
  const own = unitDef(u.id).rule
  if (own) out.push(entry(own, u))
  return out
}

// The rules `side` holds now, in a fixed order: its synergies' (a split one told whether it holds whole: `params.full`),
// then its units' held rules (`u.held`, acting order; a fallen holder keeps its). Kept until the synergies or roster change.
export function rulesOf (battle, side) {
  const syn = synergiesOf(battle, side)
  const kept = (battle.ruleList ??= {})[side]
  if (kept?.syn === syn && kept.roster === battle.roster) return kept.list
  const counts = synergyCountsOf(battle, side)
  const list = syn.filter((s) => s.rule).map((s) => entry(s.rule, null, s.full ? { full: synergyFull(s, counts) } : null))
  for (const u of battle.units) if (u.side === side && u.held?.length) list.push(...u.held)
  battle.ruleList[side] = { syn, roster: battle.roster, list }
  return list
}

// Each rule `side` holds runs its `hook`, in order.
export function call (battle, hook, side, ctx) {
  for (const r of rulesOf(battle, side)) if (r[hook]) r[hook](battle, ctx, r)
}

// Whether `side` holds rule `id` (for the interface's glow; nothing in a battle branches on a rule's name).
export const holds = (battle, side, id) => rulesOf(battle, side).some((r) => r.id === id)

// The abilities a unit's held rules grant it (Arise), as defs, but none the `arise` ablation takes away.
export const grantsOf = (battle, u) => (u.held ?? []).filter((r) => r.grants && !(battle.ablate.has('arise') && r.grants === 'arise'))
  .map((r) => abilityDef(r.grants))

// Whether relic `id` grants its holder Arise.
export const grantsArise = (id) => RULES[relicDef(id).rule]?.grants === 'arise'
