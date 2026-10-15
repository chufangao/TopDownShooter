// The rules registry (redesign.md §2.13.4): each rule a synergy, a Legendary relic, a capstone (redesign.md §4.1) or a
// boss's override brings to a battle, its hooks in one place. A new rule is one entry here. turns.js calls the hooks at fixed points, each with
// the battle, a context it may change, and the rule as the side holds it (`r`: its entry, with `holder`, the unit
// whose relic or def brings it, or null for a synergy's, which is the whole side's; and `params`, its numbers):
//   onBlow    an act has resolved (never a counter): { actor, ability, primary, targets }
//   onStruck  a blow has landed on one that still stands: { actor, target, ability, damage }
//   onFall    one of the side's own has fallen (the Monarch's fall ends the battle first): { fallen, by }; a rule
//             may lift it again (Undying), and then it has not fallen for anything after
//   onKill    one of the other side has fallen, whoever felled it (a status too): { slain, by, side }
//   onRaise   a shadow has risen to an Arise of the side's: { actor, corpse, shadow }
//   onTurn    the side's turn begins: { side, turn }
//   onWave    a foe wave has entered: { wave }
//   targets   whom an ability touches: { actor, ability, primary, targets, as }, called first with `as` 'target' on the
//             side of a blow's target, before its shape spreads (it may change `primary`), then with 'actor' on the
//             actor's side, after (it may change `targets`)
//   reach     how far an ability of the side reaches its primaries: { actor, ability, range } (it may change `range`)
//   modify    damage about to land, a blow's or a status tick's: { actor, target, ability, status, damage, miss, as },
//             called with `as` 'actor' on the actor's side, then 'target' on the target's (it may change `damage`
//             or set `miss`)
//   stand     the same damage once every modify has bent it and it has not missed, whole, on the target's side alone:
//             { actor, target, ability, status, damage, mend } (it may lower `damage`, and set `mend`, a share of the
//             target's max HP it heals once the damage has landed): a stand against a fall comes after what lessens a
//             blow, so it is spent only on one that would still fell
//   queue     the foes' turn's order: { queue } (it may reorder it)
// and three that are not moments:
//   grants    an ability id its holder gains (Arise's: redesign.md §2.15)
//   roles     (battle, u, r) → the roles its holder counts as besides its own, for synergies (Mimicry)
//   raisable  (battle, u, r) → whether its holder may raise now (Blood Tithe: not with the Monarch's HP at the tithe)
// `params`: a rule's numbers, its defaults here, a relic's own `params` over them. A Legendary's rule is scoped to its
// holder (§2.15): its hooks look at `r.holder`. A Legendary's cost that is not its holder's is a flag on its entry,
// read for the run wherever it holds the relic: Court of Bone's Monarch that nothing heals (`unhealable`: unhealable),
// Blood Tithe's raises paid in the Monarch's HP (`bleeds`: bleeds, the autoplayer's).
import { TUNING } from '../tuning.js'
import { unitDef, relicDef, abilityDef, statusDef } from '../content.js'
import { alive, livingOn, unitDistance, makeUnit, synergyFull } from './unit.js'
import { around, riseTile, summonTile } from './field.js'
import { emit, raise, roomFor, shadowSize, runEffect, synergiesOf, synergyCountsOf, addStatus, perform, usable, canAct, shape, targetsFrom, cool, corpses, enterBattle } from './turns.js'

const vanguard = (u) => unitDef(u.id).role === 'vanguard'
// Whether one of the side's own felled `slain` (a status it laid counts: `by` is its layer).
const slew = (by, side, slain) => !!by && by.side === side && slain.side !== side

export const RULES = {
  // Undead 4: a foe slain rises at once as a shadow of the side holding it, past Arise's reach and tier, never a boss,
  // a shadow or a Monarch, while that side has room for it (turns.js roomFor; one of yours rises beside the Monarch:
  // riseTile). Its raiser is the slayer when it stands on that side.
  legion: {
    onKill (battle, { slain, by, side }) {
      if (alive(slain) || slain.raised || slain.shadow || slain.into || unitDef(slain.id).boss || !roomFor(battle, side)) return
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
      if (ctx.as !== 'actor' || ability.shape !== 'single' || primary.side === actor.side) return
      const out = around(battle, primary.tile, 1, primary.side, primary.size)
      ctx.targets = ability.melee && !actor.flies ? out.filter((x) => !x.flies) : out
    }
  },
  // Fae 4: the first blow each foe would land on the side each turn (the battle's: yours and theirs) misses.
  mirage: {
    modify (battle, ctx) {
      const { actor, target } = ctx
      if (ctx.as !== 'target' || ctx.status || ctx.miss || !actor || actor.side === target.side || actor.foiled === battle.turn) return
      actor.foiled = battle.turn
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
  // Construct 4: the first damage that would fell each of the side's (a blow's, a burst's or a status tick's, as every
  // rule has bent it: stand) leaves it at 1 HP, and it heals TUNING.lastStand.heal of its max HP (never the Monarch).
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
  // Vanguard 4: a single-target blow at one of the side's not itself a Vanguard falls on a Vanguard beside it (the one
  // with the most HP, then the first to act); and the side's Vanguards take TUNING.bodyguard.taken of the damage that
  // lands on them (a blow's, a burst's or a status tick's).
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
  // Ranger 4: the side's ranged blows deal `mul` times their damage (redesign.md §2.16).
  deadeye: {
    params: { mul: 1.5 },
    modify (battle, ctx, r) {
      const { actor, target, ability } = ctx
      if (ctx.as !== 'actor' || ctx.status || !ability || ability.melee || actor.side === target.side) return
      ctx.damage *= r.params.mul
    }
  },
  // Skirmisher 4: the side's pieces start the battle, and enter it, Hastened (+1 Move, cooldowns falling faster) for
  // their first TUNING.ambush.turns turns: each from the first time its side's turn begins with it on the board.
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
  // Channeler 4: every ability of the side's rings out once more, free, on the same targets (an Arise never echoes):
  // split (the improvement plan's §4.3), at TUNING.echo.half of its effect while the side counts fewer Channelers than
  // its synergy's `full` (`r.params.full` false: rulesOf), whole from there.
  echo: {
    params: { full: true },
    onBlow (battle, { actor, ability, targets }, r) {
      if (!alive(actor) || ability.effects.some((e) => e.op === 'raise')) return
      emit(battle, { type: 'rule', rule: 'echo', side: actor.side, actor: actor.uid, ability: ability.id, ...(!r.params.full && { half: true }) })
      for (const effect of ability.effects) runEffect(battle, r.params.full ? effect : scaled(effect, TUNING.echo.half), actor, targets, ability)
    }
  },
  // Warden 4: an ability of the side's aimed at an ally reaches anyone of its side, and touches every one of its side
  // on the board.
  sanctuary: {
    reach (battle, ctx) {
      if (ctx.ability.shape === 'ally' || ctx.ability.shape === 'all_allies') ctx.range = Infinity
    },
    targets (battle, ctx) {
      if (ctx.as !== 'actor' || (ctx.ability.shape !== 'ally' && ctx.ability.shape !== 'all_allies')) return
      ctx.targets = livingOn(battle.units, ctx.actor.side)
    }
  },
  // Trickster 4: an execute (redesign.md §2.16): a blow of the side's on a foe below TUNING.deathblow.below of its max
  // HP deals TUNING.deathblow.mult times its damage.
  deathblow: {
    modify (battle, ctx) {
      const { actor, target } = ctx
      if (ctx.as !== 'actor' || ctx.status || ctx.miss || !actor || actor.side === target.side) return
      if (target.hp >= target.maxHp * TUNING.deathblow.below) return
      ctx.damage *= TUNING.deathblow.mult
      emit(battle, { type: 'rule', rule: 'deathblow', side: actor.side, actor: actor.uid, target: target.uid })
    }
  },

  // ── the Legendaries, each scoped to its holder (§2.15) ──

  // Arise: its holder gains the skill (content.js `arise`: one corpse within its reach rises, turns.js corpses).
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
  // Mimicry: its holder counts as a `role` too, for its side's synergies.
  mimicry: {
    params: { role: 'warden' },
    roles: (battle, u, r) => (u === r.holder ? [r.params.role] : [])
  },
  // Hollow Court, an Arise variant: the shadows its holder raises that still stand when the battle is won pay their
  // essence again, `reap` times (run.js finishBattle reads `reap` on the shadow).
  hollow_court: {
    grants: 'arise',
    params: { reap: 1 },
    onRaise (battle, { actor, shadow }, r) {
      if (actor === r.holder) shadow.reap = (shadow.reap ?? 0) + r.params.reap
    }
  },
  // Blood Tithe, an Arise variant: its holder's Arise raises `count` corpses a turn, the one chosen and then the others
  // in its reach (the highest tier first, then the nearest, then the first to have stood), and each shadow it raises
  // costs the Monarch `tithe` of its max HP; never its last (raisable, and no more corpses than its HP pays for). It
  // was "no turn's rest" until Arise itself lost the rest (2026-10-11; redesign.md §2.15).
  blood_tithe: {
    grants: 'arise',
    bleeds: true,
    params: { tithe: 0.02, count: 2 },
    raisable: (battle, u, r) => !battle.monarch || battle.monarch.hp > titheOf(battle, r),
    targets (battle, ctx, r) {
      const { actor, ability, primary } = ctx
      if (ctx.as !== 'actor' || actor !== r.holder || ability.shape !== 'corpse') return
      const m = battle.monarch
      const pays = m ? Math.floor((m.hp - 1) / titheOf(battle, r)) : Infinity
      const more = corpses(battle, actor).filter((c) => c !== primary)
        .sort((a, b) => unitDef(b.id).tier - unitDef(a.id).tier || unitDistance(actor, a) - unitDistance(actor, b) || a.ord - b.ord)
      ctx.targets = [primary, ...more].slice(0, Math.max(1, Math.min(r.params.count, pays)))
    },
    onRaise (battle, { actor }, r) {
      const m = battle.monarch
      if (actor !== r.holder || !m || !alive(m)) return
      const cost = titheOf(battle, r)
      m.hp -= cost
      emit(battle, { type: 'tithe', target: m.uid, damage: cost, hp: m.hp })
    }
  },
  // Court of Bone, an Arise variant: its holder's Arise reaches `domain` tiles farther; and while the run holds it,
  // nothing heals the Monarch, in battle or out (unhealable).
  court_of_bone: { grants: 'arise', params: { domain: 2 }, unhealable: true },

  // ── a capstone's rule, scoped to the piece of its kind (redesign.md §4.1): what its abilities cannot say ──

  // The Charnel Cathedral: a foe it slays beside it (its blow or a status it laid, the slain within a tile of its
  // footprint) rises at once as a shadow of its side, as Legion raises (never a boss, a shadow or a Monarch, while the
  // side has room), unless something rose from it first.
  charnel_cathedral: {
    onKill (battle, { slain, by, side }, r) {
      const u = r.holder
      if (by !== u || !alive(u) || alive(slain) || slain.raised || slain.shadow || slain.into || unitDef(slain.id).boss || !roomFor(battle, side)) return
      if (unitDistance(u, slain) > 1) return
      if (side === 'party' && riseTile(battle, slain.tile, shadowSize(slain, side), slain.flies) < 0) return
      emit(battle, { type: 'rule', rule: 'charnel_cathedral', side, actor: u.uid, target: slain.uid })
      raise(battle, u, slain, { side, rule: 'charnel_cathedral' })
    }
  },
  // The Cinder Wyrm: a foe it slays (its blow, or a Burning it laid) sets every foe next to it Burning, laid by it: the
  // fire spreads, and a burn it laid that slays spreads again.
  cinder_wyrm: {
    onKill (battle, { slain, by }, r) {
      if (by !== r.holder) return
      const near = around(battle, slain.tile, 1, slain.side, slain.size)
      if (!near.length) return
      emit(battle, { type: 'rule', rule: 'cinder_wyrm', side: by.side, actor: by.uid, target: slain.uid })
      for (const x of near) addStatus(battle, x, 'burning', null, by)
    }
  },
  // The Hive Mind: as the battle begins (its side's first turn) and as each later wave enters, while it stands,
  // `drones` of `kind` hatch beside it as its summons (shadows at TUNING.summon.hp of a whole one's HP, at its level, with
  // no tiers, while its side has room on the board: hatch); and one it slays has its every skill ready again, as Frenzy
  // has it for a side.
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
  // The Engine of Ages: the first damage each battle that would fell it (a blow's, a burst's or a status tick's, as
  // every rule has bent it: stand) leaves it at 1 HP instead, as Last Stand does its side's, and apart from it.
  engine_of_ages: {
    stand (battle, ctx, r) {
      const { target } = ctx
      if (target !== r.holder || target.endured || ctx.damage < target.hp) return
      target.endured = true
      ctx.damage = target.hp - 1
      emit(battle, { type: 'rule', rule: 'engine_of_ages', side: target.side, target: target.uid })
    }
  },

  // ── a boss's override, on top of its temperament (§2.9.6) ──

  // The Hollow Sovereign: its court (the foes of its own wave) moves before every other foe, and it casts Grave Tide
  // as its act every `every` turns, at the start of the foes' turn, whatever the scoring would rather: where its
  // shape covers the most of yours (then the lowest uid), while its own condition holds (content.js `when`) and it may
  // act at all (a Hexed Sovereign loses the act, as any foe does: turns.js canAct).
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
  }
}

// An effect at `k` of its strength (Echo's lesser form): its damage's and its healing's power (a heal's share of max HP
// too) × k, and a status laid for k of its turns, rounded up (one of a battle's as it was); a cleanse or a cooldown
// as it is.
function scaled (e, k) {
  if (e.op === 'damage' || e.op === 'heal') return { ...e, ...(e.power != null && { power: e.power * k }), ...(e.pct && { pct: e.pct * k }) }
  if (e.op !== 'apply_status') return e
  const turns = e.turns ?? statusDef(e.status).turns
  return turns === 'battle' ? e : { ...e, turns: Math.ceil(turns * k) }
}

// What a shadow of a Blood Tithe holder's costs the Monarch.
export const titheOf = (battle, r) => Math.ceil(battle.monarch.maxHp * r.params.tithe)

// A Hive Mind's drones hatch (hive_mind): each a summon of its holder's on the free tile of its camp nearest it
// (field.js summonTile), announced as it enters, while the holder stands and its side has room; with no tile free,
// fewer hatch.
function hatch (battle, r) {
  const u = r.holder
  if (!alive(u)) return
  const flies = !!unitDef(r.params.kind).flies
  for (let k = 0; k < r.params.drones && roomFor(battle, u.side); k++) {
    const tile = summonTile(battle, u, 1, flies)
    if (tile < 0) return
    if (!k) emit(battle, { type: 'rule', rule: 'hive_mind', side: u.side, actor: u.uid })
    const drone = enterBattle(battle, { ...makeUnit(r.params.kind, { uid: battle.nextUid++, lvl: u.lvl }), side: u.side, shadow: true, summoned: true, summoner: u.uid, tile })
    emit(battle, { type: 'enter', unit: { uid: drone.uid, id: drone.id, side: drone.side, tile: drone.tile, lvl: drone.lvl, hp: drone.hp, maxHp: drone.maxHp, shadow: true, summoned: true, summoner: u.uid } })
  }
}

// A rule as a side holds it: its entry, its holder (null for a synergy's) and its numbers.
const entry = (id, holder = null, params = null) => {
  if (!Object.hasOwn(RULES, id)) throw new Error(`no rule "${id}" in the registry`)
  return { id, ...RULES[id], holder, params: { ...RULES[id].params, ...params } }
}

// The rules a unit's relics bring it (a piece relic's `rule`, scoped to it; turns.js reads them as it takes its place:
// held), and its kind's (a def's `rule`: a boss's override, a capstone's), scoped to it too. → entries.
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

// The rules `side` holds now, in a fixed order: its synergies' (turns.js synergiesOf: the foes' on every floor, as
// yours, redesign.md §2.12; none of yours with the `synergies` ablation), a split one's told whether it holds whole
// (`params.full`: unit.js synergyFull, by the side's counts), then each of its units' held rules (`u.held`, in acting
// order; a fallen holder keeps its relic and its rule, one consumed by a fusion gave it back). Kept until the
// synergies or the roster change.
export function rulesOf (battle, side) {
  const syn = synergiesOf(battle, side)
  const kept = (battle.ruleList ??= {})[side]
  if (kept?.syn === syn && kept.roster === battle.roster) return kept.list
  const counts = synergyCountsOf(battle, side)
  const list = syn.filter((s) => s.rule).map((s) => entry(s.rule, null, s.full ? { full: synergyFull(s, counts) } : null))
  for (const u of battle.units) if (u.side === side && !u.into && u.held?.length) list.push(...u.held)
  battle.ruleList[side] = { syn, roster: battle.roster, list }
  return list
}

// Each rule `side` holds runs its `hook`, in order.
export function call (battle, hook, side, ctx) {
  for (const r of rulesOf(battle, side)) if (r[hook]) r[hook](battle, ctx, r)
}

// Whether `side` holds rule `id` (for the interface's glow; nothing in a battle branches on a rule's name).
export const holds = (battle, side, id) => rulesOf(battle, side).some((r) => r.id === id)

// The abilities a unit's held rules grant it (Arise), as defs, but none the `arise` ablation takes away
// (autoplay.js: a measuring switch, never a player's).
export const grantsOf = (battle, u) => (u.held ?? []).filter((r) => r.grants && !(battle.ablate.has('arise') && r.grants === 'arise'))
  .map((r) => abilityDef(r.grants))

// Whether any of these relic ids (the run's) brings a rule that leaves the Monarch unhealable (Court of Bone).
export const unhealable = (ids) => ids.some((id) => RULES[relicDef(id).rule]?.unhealable)

// Whether relic `id` brings a rule its holder's raises pay for in the Monarch's HP (Blood Tithe).
export const bleeds = (id) => !!RULES[relicDef(id).rule]?.bleeds

// Whether relic `id` grants its holder Arise (an Arise relic: Arise and its variants; run.js needsArise).
export const grantsArise = (id) => RULES[relicDef(id).rule]?.grants === 'arise'
// The rules of the relics `u` holds that grant it Arise, as it holds them, its params among them (autoplay.js ariseIn).
export const ariseGrants = (u) => heldRules(u).filter((r) => r.grants === 'arise')
