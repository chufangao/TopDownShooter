// The battle on turns (redesign.md §2.3–2.10): the board, pieces, effects, statuses and relics of battle.js, played
// as rounds of orders. Behind TUNING.turns until the full conversion, when this becomes the battle. Pure: the same
// setup and the same orders give the same battle (with TUNING.dice, its rolls come from battle.rng).
//
// A round: your turn, where each piece of yours may move up to its Move and then act once (order); End Turn ('end'),
// where every piece of yours given no act strikes or mends with its basic alone (untouched), the camp plays its turn
// as one opponent (policy.js foeTurn), and the turn ends: statuses tick, cooldowns fall, a wave whose turn has come
// enters, the clock advances, and the battle is checked for its end. It is won when no foe stands and none is still
// to come, lost the instant the Monarch falls, and lost when the clock passes its cap (`deadline`).
//
// The battle (createBattle) is battle.js's, with on top: `turn` (1-based), `phase` ('orders' while your orders are
// taken, 'resolving' inside End Turn), `stage` ('party', 'foes' or 'end': whose part of the round it is), `beat`
// (the index its events carry), `cap` (turns, from the last wave's entry), `waves` ([{ wave, turn, foes, entered }]:
// the later waves and the turn each enters on), `relics`, `purse` (the essence the run held as the battle began, less
// what it has spent here), `spent`, `fused` ([{ recipe, uid, id, lvl, tracks, parts, by, price }]: the fusions made
// here, for the run; `by` the fuser), `ariseTier`. On each unit: `move` (its Move now), `moved` (tiles spent this
// turn), `acted`, `from` (where it stood as its turn began: Undo's tile), `cooldowns` ({ ability id: turns left }),
// `temper`, `basic` and `mend` (its basic blow and basic heal, ability defs or null).
//
// Orders (legalOrders lists every one the player may give now; order applies one, throwing on an illegal one):
//   { type: 'move', uid, tile }                a piece of yours moves to `tile` (reach: within its Move, by a path)
//   { type: 'undo', uid }                      it goes back to `from`, its Move whole again (until it acts)
//   { type: 'act', uid, ability, target }      it acts: `target` is always a unit's uid: a blow's primary (a Shape's
//                                              too), an ally for a heal, itself for a self or all-allies ability, the
//                                              corpse for Arise (the Monarch's act)
//   { type: 'fuse', id, uid, parts }           piece `uid` fuses recipe `id` of `parts` (uids, `uid` among them)
//   { type: 'end' }                            End Turn
//
// Events: battle.js's vocabulary, each stamped with its `beat` (events of one beat play together) in place of a tick:
//   battle:start, enter, wave, action, damage, miss, heal, status (`dur` in turns), expire, cleanse, death, burst, arise,
//   tithe, rise, rule, trigger, phase, battle:end (reason 'monarch', 'wipe', 'sovereign' or 'turn-cap')
// and the turns' own:
//   { type: 'turn', turn, cap, next }          a turn begins: `cap` the last turn before the battle is lost, `next` the
//                                              next wave ({ wave, turn }) or null
//   { type: 'stage', stage }                   'untouched', 'foes' or 'end': a part of the round begins
//   { type: 'move', actor, from, to, path }    a move (`path`: each tile stepped onto, `to` the last)
//   { type: 'undo', actor, from, to }          a move undone
//   { type: 'action', …, tile, counter? }      `tile`: where it acts from; `counter`: a counter, the target's answer
//   { type: 'cooldown', target, ability, turns }  a skill's cooldown set or fallen (0: ready)
//   { type: 'hexed', target }                  a Hexed unit's act lost
//   { type: 'fuse', actor, recipe, parts, price, unit }  a fusion in battle: `unit` the fused piece, as `enter`'s
import { TUNING } from '../tuning.js'
import { unitDef, abilityDef, statusDef, FUSION_LIST, FUSIONS, TEMPERS } from '../content.js'
import { createRng } from './rng.js'
import {
  createBattle as base, enterBattle, stats, emit, runEffect, applyDamage, phases, enter, entryTile, around, layerOf, riseTile,
  vacate, trigger, pick, roadOf, shadowSize, titheOf, ariseTier, computeDamage, hitChance, critChance, fallen, mends
} from './battle.js'
import {
  alive, enemySide, isAllyShape, isBlow, footprint, distanceBetween, unitDistance, rangeOf, expand, makeUnit, sizeOf, tileX, tileY,
  tileAt, NEIGHBOURS, livingOn
} from './unit.js'
import { call, holds } from './rules.js'
import { foeTurn, basicTurn } from './policy.js'

// battle.js's shared parts, which this battle runs on and which move here when it goes (redesign.md §5).
export {
  runEffect, applyDamage, heal, fall, burst, crumble, raise, summon, addStatus, stats, modsFor, synergiesOf, trigger, field, fieldOf, airOf,
  roadOf, enter, entryTile, phases, computeDamage
} from './battle.js'

// ── the battle ───────────────────────────────────────────────────────────────────────────────────

// `setup` is battle.js's (run.js battleSetup), and may carry: `essence`, the run's purse as the battle begins (what a
// fusion here may spend: default 0); `fuse`, per recipe id { price, lvl, tracks }: what it costs here, and the level
// and tiers its fused kind stands at in the run (defaults: fuseCost's formula with no discount, level 2, no tiers;
// the fused piece stands at least at its parts' highest level); `cap`, the clock's cap (TUNING.turn.cap); `ariseTier`,
// the highest tier Arise raises (run.js ariseOf: the relic's copies and the `arise.tier` mods; default the copies').
export function createBattle (setup) {
  const { essence = 0, fuse = {}, cap = TUNING.turn.cap, ariseTier: tier = null, ...rest } = setup
  const battle = base({ ...rest, mode: MODE })
  Object.assign(battle, {
    turn: 1, t: 1, phase: 'orders', stage: 'party', dice: !!TUNING.dice, cap, foeIn: 1, ariseTier: tier ?? ariseTier(battle.held),
    purse: essence, spent: 0, fused: [], fuse, relics: (setup.relics ?? []).slice(), waves: schedule(battle.reserve), ruleList: {}
  })
  // The opening formation is the first wave: its moment comes before anyone acts (battle.js open).
  if (battle.monarch && alive(battle.monarch) && battle.units.some((u) => u.side === 'foe' && alive(u))) trigger(battle, 'wave', battle.monarch, battle.monarch)
  startTurn(battle)
  settle(battle)
  return battle
}

// When a foe of the reserve enters: its wave's turn, TUNING.spawn.waves.every turns apart from the first (turn 1),
// unless its `when` names one (`turn`). Its old trigger (a tick, a break) no longer counts.
const entryTurn = (foe) => foe.when?.turn ?? 1 + (foe.wave || 1) * TUNING.spawn.waves.every

function schedule (reserve) {
  const out = []
  for (const foe of reserve) {
    const wave = foe.wave || 1
    const w = out.find((x) => x.wave === wave)
    if (w) w.foes++
    else out.push({ wave, turn: entryTurn(foe), foes: 1, entered: false })
  }
  return out.sort((a, b) => a.turn - b.turn || a.wave - b.wave)
}

// The next wave still to enter ({ wave, turn }), or null.
export const nextWave = (battle) => {
  const w = battle.waves.find((x) => !x.entered)
  return w ? { wave: w.wave, turn: w.turn } : null
}

// The last turn played before the battle is lost: the cap counts from the last wave's entry (or the turn a wave still
// to come is due).
export const deadline = (battle) => Math.max(battle.foeIn, ...battle.waves.filter((w) => !w.entered).map((w) => w.turn)) + battle.cap - 1

// A turn of yours begins: every piece of yours whole again, its Move read, the rules' moment, the counts announced.
function startTurn (battle) {
  battle.stage = 'party'
  battle.phase = 'orders'
  for (const u of battle.units) if (u.side === 'party') ready(u)
  refresh(battle)
  call(battle, 'onTurn', 'party', { side: 'party', turn: battle.turn })
  battle.beat++
  emit(battle, { type: 'turn', turn: battle.turn, cap: deadline(battle), next: nextWave(battle) })
}

const ready = (u) => {
  u.moved = 0
  u.acted = false
  u.from = u.tile
}

// Every living unit's Move as its stats give it now (statuses, auras and tiers counted), for the board to show and
// the orders to read. The Monarch never moves, whatever hastens it.
function refresh (battle) {
  for (const u of battle.units) if (alive(u)) u.move = u === battle.monarch ? 0 : Math.max(0, Math.floor(stats(battle, u).move))
}

// Won when no foe stands and none is to come (the Sovereign's fall crumbles its side: 'sovereign'); lost the instant
// the Monarch falls, or, with none, when the party is wiped. Whether the battle is over.
export function settle (battle) {
  if (battle.over) return true
  const m = battle.monarch
  let party = 0
  let foe = battle.reserve.length
  for (const u of battle.units) if (u.hp > 0) u.side === 'party' ? party++ : foe++
  const lost = m ? !alive(m) : !party
  if (!lost && foe) return false
  finish(battle, lost ? 'foe' : 'party', lost ? (m ? 'monarch' : 'wipe') : battle.crumbled ? 'sovereign' : 'wipe')
  return true
}

function finish (battle, winner, reason) {
  battle.over = true
  battle.winner = winner
  battle.reason = reason
  battle.phase = 'orders'
  battle.beat++
  emit(battle, { type: 'battle:end', winner, reason, ...(battle.death && { death: battle.death }) })
}

// ── the shared effects' turn rules (battle.js calls these: battle.mode) ─────────────────────────────

const NEUTRAL = { aggression: 1, caution: 1, prey: 'weakest' }
// A kind's temperament (content.js TEMPERS): its def's, a preset by name or three values; neutral without one.
export const temperOf = (id) => {
  const t = unitDef(id).temper
  return (typeof t === 'string' ? TEMPERS[t] : t) ?? NEUTRAL
}

// A kind's basic blow: the blow its def marks `basic`, else its cheapest (the old gauge's castCost; the later in its
// list on a tie, and with no prices the last: a kit lists its basics last); its basic heal, the same among its
// abilities that mend or cleanse an ally. A tier that swaps a basic swaps a basic (Shatter Lance for Frost Lance).
const cheapest = (list) => list.reduce((best, a) => (best === null || a.basic || (!best.basic && (a.castCost ?? Infinity) <= (best.castCost ?? Infinity)) ? a : best), null)
export const basicOf = (kit) => cheapest(kit.filter(isBlow))
export const mendOf = (kit) => cheapest(kit.filter((a) => isAllyShape(a.shape) && a.shape !== 'self' && a.effects.some((e) => (e.op === 'heal' && !e.self) || e.op === 'cleanse')))
// A skill: anything not a basic and not Arise. Every skill rests a turn: cooldown 2 unless its def says.
export const isSkill = (u, a) => a !== u.basic && a !== u.mend && a.shape !== 'corpse'

// A damage-over-time ticks once a turn for twice its per-second power (a turn is two seconds; a tick is 50 ms).
const perTurn = new WeakMap()
const turnly = (effect, def) => {
  let e = perTurn.get(effect)
  if (!e) perTurn.set(effect, (e = { ...effect, power: effect.power * 40 / def.tickEvery }))
  return e
}

const MODE = {
  // A unit takes its place: its turn fields (its Move is read at the turn's start: refresh).
  join (battle, u) {
    u.move = 0
    u.moved = 0
    u.acted = false
    u.from = u.tile
    u.cooldowns = {}
    u.luck = {}
    u.temper = temperOf(u.id)
    u.basic = basicOf(u.kit)
    u.mend = mendOf(u.kit)
  },
  // A blow's damage: deterministic (every blow hits, none crits, the mean of computeDamage), or with TUNING.dice the
  // old rolls (Deadeye's sure crit among them).
  damage (battle, effect, actor, target, ability) {
    const a = stats(battle, actor)
    const d = stats(battle, target)
    let isCrit = false
    let variance = 1
    if (battle.dice) {
      const sure = actor.side !== target.side && !!ability && !ability.melee && holds(battle, actor.side, 'deadeye')
      if (!sure && !battle.rng.chance(hitChance(a.acc ?? 1, d.eva ?? 0))) {
        emit(battle, { type: 'miss', actor: actor.uid, target: target.uid })
        return
      }
      isCrit = sure || battle.rng.chance(critChance(a.crt ?? 0))
      variance = battle.rng.range(...TUNING.variance)
    }
    const damage = computeDamage({ power: effect.power, atk: a.atk, def: d.def, isCrit, variance, mul: a.damage.dealt * d.damage.taken })
    applyDamage(battle, target, damage, { actor, isCrit, ability: ability?.id ?? null })
  },
  // The rules that bend damage as it lands (rules.js modify); null: it missed.
  land (battle, target, amount, { actor, ability, status, isCrit }) {
    const ctx = { actor, target, ability: ability ? abilityDef(ability) : null, status, crit: !!isCrit, damage: amount, miss: false, as: 'actor' }
    if (actor) call(battle, 'modify', actor.side, ctx)
    ctx.as = 'target'
    call(battle, 'modify', target.side, ctx)
    if (ctx.miss) {
      emit(battle, { type: 'miss', actor: actor.uid, target: target.uid })
      return null
    }
    return Math.max(0, Math.round(ctx.damage))
  },
  // Whether a status with a `chance` lands: with dice, a roll; without, on a fixed cadence per actor, ability and
  // status, at the chance's mean (it lands each time their running sum, from a half, passes a whole: 35% lands on
  // the 2nd, 5th, 8th…). One with no chance always lands.
  lands (battle, effect, actor, ability) {
    if (effect.chance === undefined) return true
    if (battle.dice) return battle.rng.chance(effect.chance)
    const key = `${ability?.id ?? ''}|${effect.status}`
    const v = (actor.luck[key] ?? 0.5) + effect.chance
    actor.luck[key] = v >= 1 ? v - 1 : v
    return v >= 1
  },
  // How many turns a status lasts (an effect's or a status def's): its `turns`, else its `dur` ÷ 40 rounded down (at
  // least 1; the longest, and 'battle', the battle). Undefined where it names neither.
  span (x) {
    if (x.turns !== undefined) return x.turns
    if (x.dur === undefined) return undefined
    return x.dur === 'battle' || x.dur >= 600 ? 'battle' : Math.max(1, Math.floor(x.dur / 40))
  },
  // A status laid after its holder's turn of this round has passed (on one of yours in the foes' turn, on anyone at the
  // turn's end) skips the round's end: a status counts its holder's turns (redesign.md §2.8).
  fresh (battle, target) {
    return battle.stage === 'end' || (target.side === 'party' && battle.stage === 'foes')
  },
  // The `cooldown` op: `amount` turns added to every cooldown of each target (−1: its skills a turn sooner; a delay
  // never touches a boss), none below 0.
  cooldown (battle, effect, actor, targets) {
    for (const x of targets) {
      if (!alive(x) || (effect.amount > 0 && unitDef(x.id).boss)) continue
      for (const a of x.kit) {
        if (!isSkill(x, a)) continue
        const was = x.cooldowns[a.id] ?? 0
        const now = Math.max(0, was + effect.amount)
        if (now !== was) cool(battle, x, a.id, now)
      }
    }
  },
  // A fall the rules hear of: the fallen's side (onFall), and the other side (onKill).
  fell (battle, target, actor) {
    call(battle, 'onFall', target.side, { fallen: target, by: actor })
    const side = enemySide(target.side)
    call(battle, 'onKill', side, { slain: target, by: actor, side })
  }
}

function cool (battle, u, id, turns) {
  u.cooldowns[id] = turns
  emit(battle, { type: 'cooldown', target: u.uid, ability: id, turns })
}

// ── reach and targets ────────────────────────────────────────────────────────────────────────────

export const hexed = (u) => u.statuses.some((s) => s.id === 'hexed')

// How far a blow of `u`'s reaches (redesign.md §2.6: no ring): a melee blow its own range, else its kind's arm; a
// ranged blow its range (one with none, Killing Cold's, its kind's old ring until its conversion). A flyer only by a
// ranged blow, or a flyer's melee (−1: none).
export const reachOf = (u, a) => (a.melee ? a.range ?? u.arm : a.range ?? (Number.isFinite(u.ring) ? u.ring : Infinity))
export const aloft = (u, a, r) => (a.melee && !u.flies ? -1 : r)

// Whether an ally ability of `u`'s can do anything for `x`: mend it (its HP short, and it no Monarch nothing may
// heal), or strip a status it would cleanse (battle.js helps, from any tile).
export function canMend (battle, u, a, x) {
  if (x.hp < x.maxHp && !(x === battle.monarch && battle.held.unhealable)) return true
  return a.effects.some((e) => e.op === 'cleanse' && x.statuses.some((s) => statusDef(s.id).tags.includes(e.tag)))
}

// The primaries ability `a` of `u`'s may take with `u` standing on `tile`: a blow's foes within its reach; an ally
// ability's allies within its range (anyone, under Sanctuary); itself for a self or all-allies ability; Arise's
// corpses.
export function targetsFrom (battle, u, a, tile = u.tile) {
  if (a.shape === 'corpse') return u === battle.monarch ? corpses(battle) : []
  if (a.shape === 'self' || a.shape === 'all_allies') return [u]
  if (isAllyShape(a.shape)) {
    const r = holds(battle, u.side, 'sanctuary') ? Infinity : rangeOf(a)
    return battle.units.filter((x) => x.side === u.side && alive(x) && (x === u || distanceBetween(tile, u.size, x.tile, x.size) <= r))
  }
  const r = reachOf(u, a)
  return around(battle, tile, r, enemySide(u.side), u.size, aloft(u, a, r))
}

// Whether `a`'s condition holds for `u` (content.js `when`: only the conditions that are the rule remain), read as
// the old battle read it: a heal's allies those it can do something for; `t` the turn's start in old ticks.
export function allowed (battle, u, a) {
  if (!a.when) return true
  const enemies = livingOn(battle.units, enemySide(u.side))
  let allies = livingOn(battle.units, u.side)
  if (mends(a)) allies = allies.filter((x) => canMend(battle, u, a, x) && unitDistance(u, x) <= rangeOf(a))
  return a.when({ self: u, allies, enemies, t: (battle.turn - 1) * 40, dist: (x) => unitDistance(x, u) })
}

// Whether `u` may use `a` now, whatever its target: a basic always; a skill off cooldown; its condition holding.
export const usable = (battle, u, a) => (!isSkill(u, a) || !(u.cooldowns[a.id] > 0)) && allowed(battle, u, a)

// Whether `u` may still act this turn.
export const canAct = (battle, u) => !battle.over && alive(u) && !u.acted && !hexed(u)

// Who an ability touches, aimed at `primary`: its shape's spread (battle.js expandOn, a blast by the index), turned
// first by the rules of the target's side (a Bodyguard), then by the actor's (Dragonfire, Sanctuary). → { primary,
// targets }.
function spread (battle, u, a, primary) {
  const ctx = { actor: u, ability: a, primary, targets: null, as: 'target' }
  if (isBlow(a)) call(battle, 'targets', primary.side, ctx)
  ctx.targets = shape(battle, u, a, ctx.primary)
  ctx.as = 'actor'
  call(battle, 'targets', u.side, ctx)
  return ctx
}

export function shape (battle, u, a, primary) {
  if (a.shape === 'corpse') return [primary]
  const out = a.shape === 'blast' ? around(battle, primary.tile, 1, primary.side, primary.size) : expand(battle.units, u, a, primary)
  return a.melee && !u.flies && primary.side !== u.side ? out.filter((x) => !x.flies) : out
}

// ── acting ───────────────────────────────────────────────────────────────────────────────────────

// `u` uses `a` on `primary`, from where it stands: its act for the turn. A skill rests (its cooldown set first, so a
// rule that readies it, Frenzy's, may undo that); the rules hear of it (onStruck, onBlow: Echo); a melee blow's
// target answers it (counter); the HP phases are read; the battle may end.
export function perform (battle, u, a, primary) {
  battle.beat++
  const { primary: aimed, targets } = spread(battle, u, a, primary)
  emit(battle, { type: 'action', actor: u.uid, ability: a.id, anim: a.anim, targets: targets.map((x) => x.uid), tile: u.tile })
  u.acted = true
  if (isSkill(u, a)) cool(battle, u, a.id, a.cooldown ?? 2)
  const before = targets.map((x) => x.hp)
  for (const effect of a.effects) runEffect(battle, effect, u, targets, a)
  if (a.shape === 'corpse') {
    // Arise's shadow is Arise's own (Hollow Court reaps those, run.js).
    phases(battle)
    return settle(battle)
  }
  targets.forEach((x, i) => {
    if (x.side !== u.side && alive(x) && x.hp < before[i]) call(battle, 'onStruck', x.side, { actor: u, target: x, ability: a, damage: before[i] - x.hp })
  })
  call(battle, 'onBlow', u.side, { actor: u, ability: a, primary: aimed, targets })
  if (isBlow(a) && a.melee) counter(battle, aimed, u)
  phases(battle)
  settle(battle)
}

// A counter (redesign.md §2.6): the target of a melee blow, still standing within its own basic blow's reach of the
// attacker, answers at once with that blow, if it is melee, on the attacker alone; never a Hexed piece, never the
// Monarch, never ground at a flyer; one a blow, and a counter is never answered.
export function counterOf (battle, defender, attacker) {
  if (!alive(defender) || !alive(attacker) || defender.side === attacker.side || defender === battle.monarch || hexed(defender)) return null
  const b = defender.basic
  if (!b?.melee || (attacker.flies && !defender.flies) || unitDistance(defender, attacker) > reachOf(defender, b)) return null
  return b
}

function counter (battle, defender, attacker) {
  const b = counterOf(battle, defender, attacker)
  if (!b) return
  battle.beat++
  emit(battle, { type: 'action', actor: defender.uid, ability: b.id, anim: b.anim, targets: [attacker.uid], tile: defender.tile, counter: true })
  for (const effect of b.effects) runEffect(battle, effect, defender, [attacker], b)
}

// One left untouched this turn acts at End Turn (redesign.md §2.5), from where it stands, with its basics alone: its
// basic blow at the old target rule (battle.js pick: the foe furthest along its road, ties by lane), else its basic
// heal on the most wounded it can do something for, else nothing. A Hexed one loses its act.
function untouched (battle, u) {
  if (hexed(u)) {
    battle.beat++
    emit(battle, { type: 'hexed', target: u.uid })
    u.acted = true
    return
  }
  const b = u.basic
  if (b && allowed(battle, u, b)) {
    const list = targetsFrom(battle, u, b)
    if (list.length) return perform(battle, u, b, pick(battle, u, list))
  }
  const m = u.mend
  if (m && allowed(battle, u, m)) {
    const list = helped(battle, u, m, u.tile)
    if (list.length) return perform(battle, u, m, lowest(list))
  }
}

// The allies a heal of `u`'s standing on `tile` can do something for (canMend), as primaries: for an all-allies one,
// itself, once anyone in its range can use it.
export function helped (battle, u, a, tile) {
  if (a.shape === 'all_allies') {
    const anywhere = holds(battle, u.side, 'sanctuary')
    return battle.units.some((x) => x.side === u.side && alive(x) && (anywhere || distanceBetween(tile, u.size, x.tile, x.size) <= rangeOf(a)) && canMend(battle, u, a, x)) ? [u] : []
  }
  return targetsFrom(battle, u, a, tile).filter((x) => canMend(battle, u, a, x))
}

const lowest = (list) => list.slice().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.uid - b.uid)[0]

// What Arise may raise now (redesign.md §2.4): a fallen foe, never raised, never a shadow or a boss, of a tier up to
// Arise's, within the domain of the Monarch, with a free tile beside the Monarch for it; none once the Monarch has
// acted, without the relic, after a boss's fall, or when Blood Tithe would take its last HP. No cap, no cooldown: the
// turn is the cap.
export function corpses (battle) {
  const m = battle.monarch
  if (!m || !alive(m) || !holds(battle, 'party', 'arise') || battle.crumbled) return []
  if (battle.held.tithe && m.hp <= titheOf(battle, m)) return []
  const tier = battle.ariseTier
  return battle.units.filter((c) => c.side !== 'party' && !alive(c) && !c.raised && !c.shadow && !unitDef(c.id).boss &&
    unitDef(c.id).tier <= tier && unitDistance(c, m) <= battle.domain && riseTile(battle, m.tile, shadowSize(c, 'party'), c.flies) >= 0)
}

// ── moving ───────────────────────────────────────────────────────────────────────────────────────

// Whether piece `u`'s footprint may pass anchored at `t`: on the board, and on the ground no wall and no foe on it (a
// flyer goes over anything).
function passes (battle, u, t) {
  const tiles = footprint(t, u.size)
  if (!tiles) return false
  if (u.flies) return true
  for (const x of tiles) if (battle.walls.has(x) || (battle.at[x] !== null && battle.at[x].side !== u.side)) return false
  return true
}

// Whether no wall stands on `u`'s footprint anchored at `t` (a diagonal step's corner test: unit.js steps).
const clear = (battle, u, t) => footprint(t, u.size)?.every((x) => !battle.walls.has(x)) ?? false

// Whether `u` may end a move anchored at `t`: its footprint free in its layer (but for itself), no wall under one on
// the ground.
export function endable (battle, u, t) {
  const tiles = footprint(t, u.size)
  if (!tiles) return false
  const layer = layerOf(battle, u)
  return tiles.every((x) => (layer[x] === null || layer[x] === u) && (u.flies || !battle.walls.has(x)))
}

// The tiles a piece of yours may move to now, each with its path (redesign.md §2.2): within `budget` steps (its Move
// left, by default), stepping as unit.js steps (no wall, never diagonally past a wall's corner), through your own
// pieces but never through a foe, never ending on a held tile; a flyer over anything. → Map tile → path (each tile
// stepped onto, the last the tile), in the order a flood finds them.
export function reach (battle, u, budget = u.move - u.moved) {
  const out = new Map()
  if (!(budget > 0)) return out
  const prev = new Map([[u.tile, -1]])
  const cost = new Map([[u.tile, 0]])
  const queue = [u.tile]
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i]
    const c = cost.get(t)
    if (c >= budget) continue
    const x = tileX(t)
    const y = tileY(t)
    for (const n of NEIGHBOURS[t]) {
      if (cost.has(n) || !passes(battle, u, n)) continue
      if (!u.flies && tileX(n) !== x && tileY(n) !== y && !(clear(battle, u, tileAt(tileX(n), y)) && clear(battle, u, tileAt(x, tileY(n))))) continue
      cost.set(n, c + 1)
      prev.set(n, t)
      queue.push(n)
    }
  }
  for (const t of queue) {
    if (t === u.tile || !endable(battle, u, t)) continue
    const path = []
    for (let s = t; s !== u.tile; s = prev.get(s)) path.unshift(s)
    out.set(t, path)
  }
  return out
}

// The road a foe may take this turn (redesign.md §2.9.3): its road's tiles from where it stands, up to `steps` ahead,
// stopping before the first held one (battle.js holderOf: a walker's anyone on the ground, a flyer's a piece of yours
// below or anyone in the air) or a wall. → [{ tile, path }], its own tile first.
export function roadAhead (battle, u, steps = u.move - u.moved) {
  const road = roadOf(battle, u)
  const out = [{ tile: u.tile, path: [] }]
  const path = []
  for (let t = road.arrow[u.tile], k = 0; t >= 0 && k < steps; t = road.arrow[t], k++) {
    const holder = u.flies ? (battle.at[t] !== null && battle.at[t].side !== u.side ? battle.at[t] : battle.sky[t]) : battle.at[t]
    if ((holder !== null && holder !== u) || (!u.flies && battle.walls.has(t))) break
    path.push(t)
    out.push({ tile: t, path: path.slice() })
  }
  return out
}

// A unit moves along `path` (a piece of yours by reach, a foe by roadAhead), its footprint with it.
export function walk (battle, u, path) {
  const from = u.tile
  const to = path[path.length - 1]
  battle.beat++
  relocate(battle, u, to)
  u.moved += path.length
  emit(battle, { type: 'move', actor: u.uid, from, to, path })
}

function relocate (battle, u, to) {
  const layer = layerOf(battle, u)
  for (const t of footprint(u.tile, u.size)) if (layer[t] === u) layer[t] = null
  u.tile = to
  for (const t of footprint(to, u.size)) layer[t] = u
}

// ── fusing in battle (redesign.md §2.4) ──────────────────────────────────────────────────────────

// A soul of yours that may go into a fusion: living, never a shadow (a summon is one), never the Monarch.
const soul = (battle, u) => u.side === 'party' && alive(u) && !u.shadow && u !== battle.monarch

// What fusion `id` costs here (setup.fuse, else run.js fuseCost's formula with no discount) and the level and tiers
// its piece stands at.
function fusing (battle, id) {
  const r = FUSIONS[id]
  const given = battle.fuse?.[id] ?? {}
  const price = given.price ?? Math.max(1, Math.round(TUNING.essence.fuse * unitDef(r.result).tier * (1 + TUNING.essence.perFloor * (battle.floor - 1))))
  return { recipe: r, price, lvl: given.lvl ?? Math.floor(TUNING.level.base), tracks: (given.tracks ?? [0, 0]).slice() }
}

// Whether `parts` (units) are recipe `id`'s exactly, fused by `u` among them: souls, each within a tile of `u`, the
// purse holding the price, and the fused piece's footprint free on `u`'s anchor once the parts' tiles count free.
function fusible (battle, u, id, parts) {
  if (!Object.hasOwn(FUSIONS, id) || !parts.includes(u) || new Set(parts).size !== parts.length) return false
  const { recipe, price, tracks } = fusing(battle, id)
  const got = {}
  for (const p of parts) {
    if (!soul(battle, p) || unitDistance(p, u) > 1 || !Object.hasOwn(recipe.needs, p.id)) return false
    got[p.id] = (got[p.id] ?? 0) + 1
  }
  if (!Object.entries(recipe.needs).every(([kind, n]) => got[kind] === n) || battle.purse < price) return false
  const flies = !!unitDef(recipe.result).flies
  const tiles = footprint(u.tile, sizeOf({ id: recipe.result, tracks }))
  const layer = flies ? battle.sky : battle.at
  return !!tiles && tiles.every((t) => (flies || !battle.walls.has(t)) && (layer[t] === null || parts.includes(layer[t])))
}

// The fusions `u` may make now: per recipe it is a part of, its nearest parts (then the lower uids).
function fusionsOf (battle, u) {
  const out = []
  if (!soul(battle, u)) return out
  for (const r of FUSION_LIST) {
    if (!Object.hasOwn(r.needs, u.id)) continue
    const parts = [u]
    for (const [kind, n] of Object.entries(r.needs)) {
      const near = battle.units.filter((x) => x !== u && x.id === kind && soul(battle, x) && unitDistance(x, u) <= 1)
        .sort((a, b) => unitDistance(a, u) - unitDistance(b, u) || a.uid - b.uid)
      parts.push(...near.slice(0, n - (kind === u.id ? 1 : 0)))
    }
    if (fusible(battle, u, r.id, parts)) out.push({ type: 'fuse', id: r.id, uid: u.uid, parts: parts.map((p) => p.uid) })
  }
  return out
}

// The parts are consumed where they stand (off the board: `into` the fused piece's uid, never a corpse), the price
// is paid from the purse, and the fused piece stands on `u`'s anchor, full HP, fresh cooldowns, its act spent.
function fuse (battle, u, id, parts) {
  const { recipe, price, lvl, tracks } = fusing(battle, id)
  battle.beat++
  battle.purse -= price
  battle.spent += price
  const uid = battle.nextUid++
  for (const p of parts) {
    vacate(battle, p)
    p.hp = 0
    p.statuses = []
    p.raised = true
    p.into = uid
  }
  battle.roster++
  battle.ours++
  const level = Math.max(lvl, ...parts.map((p) => p.lvl))
  const unit = enterBattle(battle, { ...makeUnit(recipe.result, { uid, lvl: level, tracks }), side: 'party', tile: u.tile })
  unit.acted = true
  battle.fused.push({ recipe: id, uid, id: recipe.result, lvl: level, tracks, parts: parts.map((p) => p.uid), by: u.uid, price })
  emit(battle, {
    type: 'fuse', actor: u.uid, recipe: id, parts: parts.map((p) => p.uid), price,
    unit: { uid, id: unit.id, side: 'party', tile: unit.tile, lvl: unit.lvl, hp: unit.hp, maxHp: unit.maxHp, ...(unit.size > 1 && { size: unit.size }) }
  })
}

// ── orders ───────────────────────────────────────────────────────────────────────────────────────

// A piece the player orders: one of yours, living, no shadow (summons and shadows act as the untouched do).
export const orderable = (battle, u) => u.side === 'party' && alive(u) && !u.shadow

function mine (battle, uid) {
  const u = battle.byUid.get(uid)
  if (battle.over || battle.phase !== 'orders') throw new Error('no orders are taken now')
  if (!u || !orderable(battle, u)) throw new Error(`no piece ${uid} of yours takes orders`)
  return u
}

// The acts `u` may make from where it stands: each ability it may use at each target it may take (a shape that
// touches all it reaches, once).
export function actsOf (battle, u) {
  const out = []
  if (!canAct(battle, u)) return out
  for (const a of u.kit) {
    if (!usable(battle, u, a)) continue
    const list = targetsFrom(battle, u, a)
    for (const x of a.shape === 'all' ? list.slice(0, 1) : list) out.push({ type: 'act', uid: u.uid, ability: a.id, target: x.uid })
  }
  return out
}

// Every order the player may give now (none once the battle is over).
export function legalOrders (battle) {
  if (battle.over || battle.phase !== 'orders') return []
  const out = []
  for (const u of battle.units) {
    if (!orderable(battle, u) || u.acted) continue
    for (const tile of reach(battle, u).keys()) out.push({ type: 'move', uid: u.uid, tile })
    out.push(...actsOf(battle, u))
    if (canAct(battle, u)) out.push(...fusionsOf(battle, u))
    if (u.moved > 0 && endable(battle, u, u.from)) out.push({ type: 'undo', uid: u.uid })
  }
  out.push({ type: 'end' })
  return out
}

// Applies one order (legalOrders' kinds) and returns the events it made; End Turn runs the rest of the round.
export function order (battle, o) {
  const from = battle.events.length
  if (o.type === 'end') {
    if (battle.over || battle.phase !== 'orders') throw new Error('no orders are taken now')
    endTurn(battle)
    return battle.events.slice(from)
  }
  const u = mine(battle, o.uid)
  if (o.type === 'move') {
    const path = u.acted ? null : reach(battle, u).get(o.tile)
    if (!path) throw new Error(`${u.id} ${u.uid} cannot move to ${o.tile}`)
    walk(battle, u, path)
  } else if (o.type === 'undo') {
    if (u.acted || !(u.moved > 0) || !endable(battle, u, u.from)) throw new Error(`${u.id} ${u.uid} has no move to undo`)
    battle.beat++
    emit(battle, { type: 'undo', actor: u.uid, from: u.tile, to: u.from })
    relocate(battle, u, u.from)
    u.moved = 0
  } else if (o.type === 'act') {
    const a = u.kit.find((x) => x.id === o.ability)
    const target = a && canAct(battle, u) && usable(battle, u, a) ? targetsFrom(battle, u, a).find((x) => x.uid === o.target) : null
    if (!target) throw new Error(`${u.id} ${u.uid} cannot use ${o.ability} on ${o.target}`)
    perform(battle, u, a, target)
  } else if (o.type === 'fuse') {
    const parts = Array.isArray(o.parts) ? o.parts.map((uid) => battle.byUid.get(uid)) : []
    if (!canAct(battle, u) || parts.some((p) => !p) || !fusible(battle, u, o.id, parts)) throw new Error(`${u.id} ${u.uid} cannot fuse ${o.id} of ${JSON.stringify(o.parts)}`)
    fuse(battle, u, o.id, parts)
    settle(battle)
  } else {
    throw new Error(`unknown order "${o.type}"`)
  }
  refresh(battle)
  return battle.events.slice(from)
}

// End Turn (redesign.md §2.3, steps 2–4): the untouched act, the foes take their turn, the turn ends; then your next
// turn begins, unless the battle is over.
function endTurn (battle) {
  battle.phase = 'resolving'
  battle.beat++
  emit(battle, { type: 'stage', stage: 'untouched' })
  // In acting order, and anyone who rises meanwhile (a Legion's shadow) too.
  for (let i = 0; i < battle.units.length && !battle.over; i++) {
    const u = battle.units[i]
    if (u.side === 'party' && alive(u) && !u.acted && u !== battle.monarch) untouched(battle, u)
  }
  if (!battle.over) {
    battle.stage = 'foes'
    for (const u of battle.units) if (u.side === 'foe') ready(u)
    refresh(battle)
    call(battle, 'onTurn', 'foe', { side: 'foe', turn: battle.turn })
    battle.beat++
    emit(battle, { type: 'stage', stage: 'foes' })
    foeTurn(battle)
  }
  if (!battle.over) closeTurn(battle)
  if (!battle.over) startTurn(battle)
  battle.phase = 'orders'
}

// The turn's end: statuses tick and age, cooldowns fall, the clock advances, a wave whose turn has come enters, and
// the battle is checked: lost once the clock has passed its cap.
function closeTurn (battle) {
  battle.stage = 'end'
  battle.beat++
  emit(battle, { type: 'stage', stage: 'end' })
  age(battle)
  phases(battle)
  if (settle(battle)) return
  for (const u of battle.units) {
    if (!alive(u)) continue
    let rate = 0
    for (const id in u.cooldowns) {
      if (!(u.cooldowns[id] > 0)) continue
      rate ||= Math.max(1, Math.round(stats(battle, u).cooldown.rate))
      cool(battle, u, id, Math.max(0, u.cooldowns[id] - rate))
    }
  }
  battle.turn++
  battle.t = battle.turn
  arrive(battle)
  if (settle(battle)) return
  if (battle.turn > deadline(battle)) finish(battle, null, 'turn-cap')
}

// Each status's tick runs once (a damage-over-time's at twice its per-second power), then it ages a turn and may run
// out; one laid since its holder's turn passed (`fresh`) waits a round. Nothing ticks once the Monarch has fallen.
function age (battle) {
  for (let i = 0; i < battle.units.length; i++) {
    const u = battle.units[i]
    if (fallen(battle)) return
    if (!alive(u) || !u.statuses.length) continue
    for (const s of u.statuses.slice()) {
      if (!u.statuses.includes(s)) continue
      if (s.fresh) {
        s.fresh = false
        continue
      }
      const def = statusDef(s.id)
      for (const effect of def.tick ?? []) runEffect(battle, turnly(effect, def), u, [u], null, s)
      if (!alive(u)) break
      if (!u.statuses.includes(s) || s.dur === 'battle' || --s.dur > 0) continue
      u.statuses.splice(u.statuses.indexOf(s), 1)
      emit(battle, { type: 'expire', target: u.uid, status: s.id })
    }
  }
}

// The foes whose wave's turn has come enter at the top edge (battle.js enter, entryTile: each its lane; one with no
// free entry tile waits for a later turn's end), each wave announced as it begins (its moment, 'wave') and heard by
// the rules (onWave).
function arrive (battle) {
  for (const foe of battle.reserve.slice()) {
    if (entryTurn(foe) > battle.turn) continue
    const tile = entryTile(battle, foe.lane, !!unitDef(foe.id).flies)
    if (tile < 0) continue
    // (battle.js enter takes it out of the reserve by itself, and announces a wave by its number: a stray foe is wave 1.)
    const wave = (foe.wave ||= 1)
    const first = battle.waveAt[wave] === undefined
    enter(battle, foe, tile)
    const w = battle.waves.find((x) => x.wave === wave)
    if (w) w.entered = true
    if (first) for (const side of ['party', 'foe']) call(battle, 'onWave', side, { wave })
  }
}

// ── playing ──────────────────────────────────────────────────────────────────────────────────────

// Plays a battle to its end, `policy(battle)` giving each of your turns' orders (policy.js expertTurn, basicTurn), up
// to End Turn, which ends a turn whose orders do not. With dice a plan made on a copy may not survive the rolls (a foe
// it meant to strike already slain): the policy plans again from the board as it stands, a few times a turn at most.
// Returns the battle.
export function playOut (battle, policy = basicTurn) {
  while (!battle.over) {
    let orders = policy(battle)
    let again = 0
    for (let i = 0; i < orders.length && !battle.over && orders[i].type !== 'end'; i++) {
      try {
        order(battle, orders[i])
      } catch (err) {
        if (!battle.dice || ++again > 4) throw err
        orders = policy(battle)
        i = -1
      }
    }
    if (!battle.over) order(battle, { type: 'end' })
  }
  return battle
}

// What a blow would do, shown before it is committed (redesign.md §2.4): the act played on a copy of the battle
// (fork), with no dice, read back from its events: `damage` dealt to `target`, `counter` the damage its answer would
// deal the actor, `heal` mended on it, `hits` damage by uid (a Shape's every target, a Bodyguard's), and whether the
// target would fall. Null for an act that may not be given.
export function preview (battle, uid, ability, target) {
  const f = fork(battle, { quiet: false, dice: false })
  try {
    order(f, { type: 'act', uid, ability, target })
  } catch {
    return null
  }
  const out = { damage: 0, counter: 0, heal: 0, hits: {}, kills: false }
  let answered = false
  for (const e of f.events) {
    if (e.type === 'action' && e.counter) answered = true
    else if (e.type === 'damage' && !e.status) {
      if (answered) {
        if (e.target === uid) out.counter += e.damage
      } else {
        out.hits[e.target] = (out.hits[e.target] ?? 0) + e.damage
        if (e.target === target) out.damage += e.damage
      }
    } else if (e.type === 'heal' && e.target === target && !answered) out.heal += e.heal
  }
  const t = f.byUid.get(target)
  out.kills = !!t && !alive(t) && t.side !== f.byUid.get(uid).side
  return out
}

// A copy of the battle to play ahead on (preview, policy.js): every unit and status copied, the index and every list
// of units pointing at the copies, no events kept (`quiet`) and its own dice. The original is never touched.
export function fork (battle, { quiet = true, dice = battle.dice } = {}) {
  const map = new Map()
  const units = battle.units.map((u) => {
    const c = { ...u, statuses: u.statuses.map((s) => ({ ...s })), cooldowns: { ...u.cooldowns }, luck: { ...u.luck }, struck: u.struck && new Set(u.struck) }
    map.set(u, c)
    return c
  })
  const re = (u) => (u === null ? null : map.get(u))
  return {
    ...battle,
    units,
    at: battle.at.map(re),
    sky: battle.sky.map(re),
    byUid: new Map(units.map((u) => [u.uid, u])),
    monarch: battle.monarch && re(battle.monarch),
    auras: battle.auras.map(re),
    phased: battle.phased.map(re),
    reserve: battle.reserve.map((u) => ({ ...u })),
    waveAt: battle.waveAt.slice(),
    waves: battle.waves.map((w) => ({ ...w })),
    harm: { ...battle.harm },
    fused: battle.fused.slice(),
    events: [],
    quiet,
    dice,
    rng: createRng(`${battle.seed}|fork|${battle.turn}|${battle.beat}`).stream('battle'),
    syn: {},
    cache: new Map(),
    living: { party: null, foe: null },
    ruleList: {},
    probes: null
  }
}
