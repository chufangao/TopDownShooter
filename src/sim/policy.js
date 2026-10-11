// The one policy (redesign.md §2.9), both sides: enumerate a unit's options (where it may stand, then what it may do
// from there), score each, commit the best, and go on to the next unit on the board as it now stands. The camp plays
// its whole turn so (foeTurn), each kind by its temperament and one score; the expert plays yours so (expertTurn), each
// option read as a vector of features and weighed by TUNING.expert (redesign.md §2.17), with no turn of the foes played
// ahead. Above the pieces stands the expert's plan (redesign.md §2.18; plan.js): read once a turn and kept across turns,
// its target formation (a tile for each piece), its kill list and its forecast of the foes are features of each piece's
// options, and the kill list played is one of the boards a turn compares. Nothing reads a seed: the same board gives the
// same turn.
import { TUNING } from '../tuning.js'
import { STATUS_WORTH, statusDef, unitDef, FUSIONS, SYNERGIES } from '../content.js'
import {
  alive, enemySide, isBlow, isAllyShape, footprint, tileX, tileY, unitDistance, distanceBetween, statsOf, blowReach, rangeOf, steps, lineEnds, LINE_AT, LINE_TILES,
  TILES, LANES, DEPTH
} from './unit.js'
import { LANE, roadOf } from './field.js'
import {
  stats, emit, computeDamage, fork, order, reach, roadAhead, targetsFrom, usable, canAct, hexed, perform, walk, aloft, helped, shape, impatience,
  orderable, isSkill, counterOf, fusionsOf, rateOf, synergiesOf, corpses, nextWave, allowed, pick, lined, struckBy
} from './turns.js'
import { call } from './rules.js'
import { decide, TREES } from './expert.js'
import { readPlan } from './plan.js'

// ── the danger map (§2.9.2) ──────────────────────────────────────────────────────────────────────

// By tile, how much the other side could deal on its next turn to one of `side`'s standing there, before that one's
// DEF (dangerAt counts it): each unit of the other side, from every tile it could stand on next turn (a piece of
// yours anywhere its Move reaches, a summon or a shadow where it stands, a foe along its road), its best blow that will
// be ready (a basic, or a skill off cooldown by then) at that tile, summed over the units. → { ground, air, shields }:
// the air for a flyer standing there (a melee blow from the ground never reaches one). The Monarch deals nothing; a unit
// whose next act Hexed takes deals nothing. `at` (Map uid → tile: plan.js forecast's) puts each foe dealing on the one
// tile it names instead of its whole road ahead. Lines count (redesign.md §2.19): a blow that keeps to one (turns.js
// lined) reaches no tile with one of `side`'s standing strictly between, as the board stands; what one piece alone
// shields so is kept apart (`shields`: Map unit → { ground, air }), so that the piece itself, read on another tile
// (dangerAt), is not shielded by where it stood. With `lines` false, as if no one stood in the way (plan.js formation's:
// where your pieces will stand is what it decides).
export function danger (battle, side, at = null, { lines = true } = {}) {
  const dealer = enemySide(side)
  const ground = new Array(TILES).fill(0)
  const air = new Array(TILES).fill(0)
  const shields = new Map()
  // Yours, read in the foes' turn or at its end, act next after a turn's end: a skill whose cooldown falls to 0 by
  // then (at the rate turns.js rateOf gives it) counts. The foes, read in your turn, act before it.
  const later = dealer === 'party' && battle.stage !== 'party'
  const g = new Array(TILES)
  const a = new Array(TILES)
  for (const u of battle.units) {
    if (u.side !== dealer || !alive(u) || u === battle.monarch || stunned(u, later)) continue
    const rate = later ? rateOf(battle, u) : 0
    const blows = u.kit.filter((x) => isBlow(x) && (!isSkill(u, x) || (u.cooldowns[x.id] ?? 0) <= rate))
    if (!blows.length) continue
    const spots = dealer === 'foe' ? (at ? [at.get(u.uid) ?? u.tile] : roadAhead(battle, u, u.move).map((s) => s.tile))
      : orderable(battle, u) ? [u.tile, ...reach(battle, u, u.move).keys()] : [u.tile]
    g.fill(0)
    a.fill(0)
    const alone = new Map()
    for (const b of blows) {
      const raw = rawOf(battle, u, b)
      if (!(raw > 0)) continue
      const r = blowReach(u, b)
      const ra = aloft(u, b, r)
      for (const t of spots) {
        if (lines && lined(b)) {
          // A ranged blow reaches the air as the ground (aloft), on the same lines.
          sight(battle, side, t, u.size, r, raw, g, a, alone)
          continue
        }
        dilate(g, t, u.size, r, raw)
        if (ra >= 0) dilate(a, t, u.size, ra, raw)
      }
    }
    for (let t = 0; t < TILES; t++) {
      ground[t] += g[t]
      air[t] += a[t]
    }
    for (const [y, list] of alone) {
      let w = null
      for (let t = 0; t < TILES; t++) {
        const dg = list[t] - g[t]
        const da = list[t] - a[t]
        if (dg <= 0 && da <= 0) continue
        w ??= shields.get(y) ?? shields.set(y, { ground: new Float64Array(TILES), air: new Float64Array(TILES) }).get(y)
        if (dg > 0) w.ground[t] += dg
        if (da > 0) w.air[t] += da
      }
    }
  }
  return { ground, air, shields }
}

// Whether a Hexed `u` will lose its next act (`later`: it acts after a turn's end, where a Hexed of a turn runs out).
const stunned = (u, later) => hexed(u) && (!later || u.statuses.some((s) => s.id === 'hexed' && (s.fresh || s.dur === 'battle' || s.dur > 1)))

// A blow that keeps to a line, of `raw`, from a footprint at `tile` (of `size`) within `r`: every tile it reaches with
// no one of `side` strictly between (turns.js lineBlocker, as the board stands) holds at least `raw` in `g` and `a`
// (the ground's and the air's lists); one that a single unit of side alone stands in the way of holds it in that unit's
// own list (`alone`: Map unit → list), what the danger there is were that one elsewhere.
function sight (battle, side, tile, size, r, raw, g, a, alone) {
  const x0 = tileX(tile)
  const y0 = tileY(tile)
  const yb = Math.min(DEPTH - 1, y0 + size - 1 + r)
  const xa = Math.max(0, x0 - r)
  const xb = Math.min(LANES - 1, x0 + size - 1 + r)
  for (let y = Math.max(0, y0 - r); y <= yb; y++) {
    for (let x = xa, t = y * LANES + xa; x <= xb; x++, t++) {
      if (g[t] >= raw && a[t] >= raw) continue
      const [p, q] = size === 1 ? [tile, t] : lineEnds(tile, size, t, 1)
      const k = p * TILES + q
      let one = null
      let many = false
      for (let i = LINE_AT[k]; i < LINE_AT[k + 1] && !many; i++) {
        const c = LINE_TILES[i]
        for (let n = 0; n < 2; n++) {
          const w = n ? battle.sky[c] : battle.at[c]
          if (w === null || w.side !== side || w === one) continue
          if (one === null) one = w
          else many = true
        }
      }
      if (one === null) {
        if (g[t] < raw) g[t] = raw
        if (a[t] < raw) a[t] = raw
      } else if (!many) {
        const list = alone.get(one) ?? alone.set(one, new Float64Array(TILES)).get(one)
        if (list[t] < raw) list[t] = raw
      }
    }
  }
}

// Every tile within `r` of a footprint at `tile` holds at least `raw`.
function dilate (list, tile, size, r, raw) {
  const x0 = tileX(tile)
  const y0 = tileY(tile)
  const yb = Math.min(DEPTH - 1, y0 + size - 1 + r)
  const xa = Math.max(0, x0 - r)
  const xb = Math.min(LANES - 1, x0 + size - 1 + r)
  for (let y = Math.max(0, y0 - r); y <= yb; y++) {
    for (let x = xa, t = y * LANES + xa; x <= xb; x++, t++) if (list[t] < raw) list[t] = raw
  }
}

// A blow's damage before the target's DEF and damage taken: computeDamage's raw, with its dealer's damage dealt.
export function rawOf (battle, u, b) {
  const s = stats(battle, u)
  let power = 0
  for (const e of b.effects) if (e.op === 'damage') power += e.power
  return power * s.atk / TUNING.damage.atkDivisor * s.damage.dealt
}

// What share of the raw a unit takes: its DEF's mitigation and its damage taken.
const mitigation = (battle, x) => {
  const s = stats(battle, x)
  return TUNING.damage.defConstant / (TUNING.damage.defConstant + Math.max(0, s.def)) * s.damage.taken
}

// What `u` would take standing on `tile` (a footprint: its worst tile), by a danger map for its side: never more than
// its HP (a fall is the most it can lose). Where it stands now it shields nothing of its own: what the map has it alone
// shield (its `shields`) is danger to it elsewhere.
export function dangerAt (battle, u, tile, map) {
  const list = u.flies ? map.air : map.ground
  const own = map.shields?.get(u)
  const mine = own && (u.flies ? own.air : own.ground)
  let raw = 0
  for (const t of footprint(tile, u.size) ?? [tile]) raw = Math.max(raw, list[t] + (mine ? mine[t] : 0))
  return Math.min(u.hp, raw * mitigation(battle, u))
}

// ── the pressure (§2.9.1) ────────────────────────────────────────────────────────────────────────

// The camp's pressure, 0 to 1: its impatience (turns.js: 0 as the last wave enters, 1 TUNING.policy.press.turns
// later; there is no clock), nudged by TUNING.policy.press.strength toward the trade the camp could make: up when its
// foes could deal more to your pieces in their reach than yours to them, down when less. Out of patience it is 1,
// whatever the trade: the horde always comes, so a battle always ends. Never shown. `maps` may carry the danger maps
// already made ({ party, foe }: danger to each side).
export function press (battle, maps = {}) {
  const time = impatience(battle)
  if (time >= 1) return 1
  const theirs = onSide(battle, 'party', maps.party ?? danger(battle, 'party'))
  const ours = onSide(battle, 'foe', maps.foe ?? danger(battle, 'foe'))
  const nudge = (theirs - ours) / Math.max(1, theirs + ours)
  return Math.min(1, Math.max(0, time + TUNING.policy.press.strength * nudge))
}

// A foe at full pressure (foeTurn): bold at least (aggression 1), so even a Keeper (0) comes along its road as far as
// its Move and the board allow, preyOf making the Monarch its prey; and it fights, tending no one (no heal, cleanse or
// ward on its own side): a camp that mends what you deal as fast as you deal it would hold a battle forever.
const hasty = (temper) => (temper.aggression >= 1 ? temper : { ...temper, aggression: 1 })
const fighting = (battle, u) => options(battle, u).filter((o) => !o.ability || o.target.side !== u.side)

const onSide = (battle, side, map) => battle.units.reduce((n, u) => n + (u.side === side && alive(u) ? dangerAt(battle, u, u.tile, map) : 0), 0)

// ── options and their scores (§2.9.3) ────────────────────────────────────────────────────────────

// A unit's options: each place it may stand this turn (a foe its road's tiles, 0 to its Move ahead; a piece of yours
// where it stands and everywhere its Move left reaches, unless `moving` is false), and from each, holding or each act
// it may make: each blow at each foe in reach (a shape that touches all it reaches, once), each heal or cleanse at each
// ally it can do something for, each ward on whom it reaches, Arise at each corpse. → [{ tile, path, ability, target }]
// (`ability` an ability def or null, `target` a unit or null).
export function options (battle, u, { moving = true } = {}) {
  const spots = u.side === 'foe' ? roadAhead(battle, u)
    : [{ tile: u.tile, path: [] }, ...(moving && !u.acted ? [...reach(battle, u)].map(([tile, path]) => ({ tile, path })) : [])]
  const acts = canAct(battle, u) ? u.kit.filter((a) => usable(battle, u, a)) : []
  const out = []
  for (const s of spots) {
    out.push({ tile: s.tile, path: s.path, ability: null, target: null })
    for (const a of acts) {
      let list
      if (isAllyShape(a.shape) && a.effects.some((e) => (e.op === 'heal' && !e.self) || e.op === 'cleanse')) list = helped(battle, u, a, s.tile)
      else list = targetsFrom(battle, u, a, s.tile)
      if (a.shape === 'all') list = list.slice(0, 1)
      for (const x of list) out.push({ tile: s.tile, path: s.path, ability: a, target: x })
    }
  }
  return out
}

// The one score (§2.9.3):
//   dealt × (the target is its prey ? 1.5 : 1) − caution × (1 − press) × taken + aggression × (1 + press) × gained
// dealt: damage (as far as each target's HP), HP mended, a status's worth (STATUS_WORTH); taken: the
// danger where it would stand (ctx.danger, for its side: danger) and the counter its blow would draw; gained: road
// gained (a foe's) and each kill's worth (its max HP; the Monarch's, the battle). `ctx` may carry the danger map and
// `prey` (a Set of units: preyOf).
export function score (battle, u, o, temper, p, ctx = {}) {
  const map = ctx.danger ??= danger(battle, u.side)
  const e = estimate(battle, u, o, ctx.prey ?? NOBODY)
  const taken = dangerAt(battle, u, o.tile, map) + e.counter
  return e.dealt - temper.caution * (1 - p) * taken + temper.aggression * (1 + p) * (gain(battle, u, o.tile) + e.kill)
}

const NOBODY = new Set()
const MONARCH = 1e6
const worth = (battle, x) => (x === battle.monarch ? MONARCH : x.maxHp)
// Road gained: how much nearer the Monarch a foe would stand (none for yours).
const gain = (battle, u, tile) => (u.side === 'foe' ? roadOf(battle, u).dist[u.tile] - roadOf(battle, u).dist[tile] : 0)

// A blow of `power` from `a` (stats) on `x`, as it lands (before the rules that bend it).
const hit = (battle, a, x, power) => {
  const d = stats(battle, x)
  return computeDamage({ power, atk: a.atk, def: d.def, mul: a.damage.dealt * d.damage.taken })
}

const NONE = Object.freeze([])
const ZERO = { dealt: 0, kill: 0, counter: 0, damage: 0, focus: 0, bane: 0, preyed: 0, menace: 0, status: 0, mend: 0, rescue: 0, shadow: 0, felled: NONE, hexed: NONE }
// A status laid on `x` (it always lands): its worth, nothing where `x` holds it already at its full stacks (it would
// only last longer).
const statusWorth = (e, x) => {
  const had = x.statuses.find((s) => s.id === e.status)
  return had && had.stacks >= statusDef(e.status).stacks ? 0 : STATUS_WORTH[e.status] ?? 0
}
const debuff = (id) => statusDef(id).tags.includes('debuff')

// What an option would do, read off the board without playing it. For the one score: `dealt` (damage as far as each
// target's HP, × 1.5 on the actor's prey; HP mended; a status's worth; a corpse raised, its max HP), `kill` (each
// kill's worth) and `counter` (what the counter its blow draws would take). And the same split for the expert's
// features: `damage` (no prey), `focus` (damage × the share of HP its target had lost already), `bane` (damage on a
// target that has a heal: turns.js `mend`), `preyed` (damage on the actor's prey: the expert's, the foes that could
// strike the Monarch), `menace` (the hardest
// blow of each foe it fells), `status`, `mend`, `rescue` (HP mended on one of the actor's side that danger map `map`,
// where given, says could fall next turn) and `shadow` (a corpse raised); `felled` and `hexed`, the foes it would fell
// and those it would Hex.
function estimate (battle, u, o, prey, map = null) {
  const a = o.ability
  if (!a) return ZERO
  if (a.shape === 'corpse') return { ...ZERO, dealt: o.target.maxHp, shadow: o.target.maxHp }
  const s = stats(battle, u)
  // The actor where it would stand, for the shapes that measure from it; a blow spreads from the one it strikes.
  const at = { uid: u.uid, side: u.side, tile: o.tile, size: u.size, flies: u.flies }
  const struck = struckOf(battle, u, o)
  const targets = shape(battle, at, a, struck).map((x) => (x === at ? u : x))
  const out = { ...ZERO }
  if (map !== null) out.hits = []
  let primary = 0
  for (const x of targets) {
    if (x.side !== u.side) {
      let d = 0
      for (const e of a.effects) if (e.op === 'damage') d += hit(battle, s, x, e.power)
      if (x === struck) primary = d
      const dd = Math.min(d, x.hp)
      if (map !== null && dd > 0 && dd < x.hp) out.hits.push([x, dd])
      out.dealt += dd * (prey.has(x) ? 1.5 : 1)
      out.damage += dd
      out.focus += dd * (1 - x.hp / x.maxHp)
      if (x.mend) out.bane += dd
      if (prey.has(x)) out.preyed += dd
      if (d >= x.hp) {
        out.kill += worth(battle, x)
        out.menace += hardest(battle, x)
        out.felled = [...out.felled, x]
      } else {
        for (const e of a.effects) {
          if (e.op !== 'apply_status' || !debuff(e.status)) continue
          const w = statusWorth(e, x)
          out.dealt += w
          out.status += w
          if (e.status === 'hexed') out.hexed = [...out.hexed, x]
        }
      }
    } else {
      const missing = x === battle.monarch && battle.unhealable ? 0 : x.maxHp - x.hp
      const brink = map !== null && x.hp <= dangerAt(battle, x, x.tile, map)
      for (const e of a.effects) {
        if (e.op === 'heal' && !e.self) {
          const m = Math.min(missing, e.pct ? x.maxHp * e.pct : e.power * s.atk / TUNING.damage.atkDivisor * s.heal.given)
          out.dealt += m
          out.mend += m
          if (brink) out.rescue += m
        } else if (e.op === 'cleanse' || (e.op === 'apply_status' && !debuff(e.status))) {
          const w = e.op === 'cleanse' ? x.statuses.filter((st) => statusDef(st.id).tags.includes(e.tag)).slice(0, e.count).reduce((n, st) => n + (STATUS_WORTH[st.id] ?? 0), 0) : statusWorth(e, x)
          out.dealt += w
          out.status += w
        }
      }
    }
  }
  for (const e of a.effects) {
    if (e.op !== 'heal' || !e.self) continue
    const m = Math.min(u.maxHp - u.hp, e.power * s.atk / TUNING.damage.atkDivisor * s.heal.given)
    out.dealt += m
    out.mend += m
  }
  out.counter = isBlow(a) && a.melee && primary < struck.hp ? answer(battle, u, o, struck) : 0
  return out
}

// Whom option `o` of `u`'s strikes (redesign.md §2.19): a blow's, the first of its target's side on its line from where
// it would stand, or a Bodyguard that takes it (turns.js struckBy); else its target. Read once an option.
export const struckOf = (battle, u, o) => (o.struck ??= o.ability && isBlow(o.ability) && o.target.side !== u.side ? struckBy(battle, u, o.ability, o.target, o.tile) : o.target)

// The counter a melee blow from `o.tile` would draw from `x`, the one it strikes (turns.js counterOf, measured from there).
function answer (battle, u, o, x) {
  const b = counterOf(battle, x, u, o.tile)
  if (!b) return 0
  const s = stats(battle, x)
  let d = 0
  for (const e of b.effects) if (e.op === 'damage') d += hit(battle, s, u, e.power)
  return Math.min(d, u.hp)
}

// Whom `u` would rather strike this turn (its temperament's `prey`, among the foes its options reach; the Monarch for
// everyone once the pressure is 1): weakest the lowest HP, wounded the lowest share of it, unarmoured the lowest DEF,
// monarch the Monarch, crowd where its shape covers the most, rested the most skills ready. Ties all count.
export function preyOf (battle, u, opts, temper, p) {
  const kind = p >= 1 ? 'monarch' : temper.prey
  const blows = opts.filter((o) => o.ability && isBlow(o.ability) && o.target.side !== u.side)
  // Among those its blows would strike (struckOf: a screen on the line, not the one behind it).
  const list = [...new Set(blows.map((o) => struckOf(battle, u, o)))]
  if (!list.length) return NOBODY
  if (kind === 'monarch') return new Set(list.filter((x) => x === battle.monarch))
  if (kind === 'crowd') {
    let most = 0
    let out = new Set()
    for (const o of blows) {
      const x = struckOf(battle, u, o)
      const n = shape(battle, { uid: u.uid, side: u.side, tile: o.tile, size: u.size, flies: u.flies }, o.ability, x).filter((y) => y.side !== u.side).length
      if (n > most) {
        most = n
        out = new Set([x])
      } else if (n === most) out.add(x)
    }
    return out
  }
  const key = PREY[kind]
  const low = Math.min(...list.map((x) => key(battle, x)))
  return new Set(list.filter((x) => key(battle, x) === low))
}

const PREY = {
  weakest: (battle, x) => x.hp,
  wounded: (battle, x) => x.hp / x.maxHp,
  unarmoured: (battle, x) => stats(battle, x).def,
  rested: (battle, x) => -x.kit.filter((a) => isSkill(x, a) && !(x.cooldowns[a.id] > 0)).length
}

// The better of two scored options: the higher score; ties: more road gained (`road`), the lower lane, the lower uid of
// its target, holding first (an act that changes nothing is not made: a ward recast on those who hold it).
const EPS = 1e-9
const lane = (o) => LANE[tileX(o.tile)]
const better = (o, b) => {
  if (Math.abs(o.score - b.score) > EPS) return o.score > b.score
  if (o.road !== b.road) return o.road > b.road
  if (lane(o) !== lane(b)) return lane(o) < lane(b)
  return (o.target?.uid ?? -1) < (b.target?.uid ?? -1)
}

// `u`'s best option now, by `temper` at pressure `p`, against danger map `map` for its side.
export function choose (battle, u, temper, p, map, opts = options(battle, u)) {
  const ctx = { danger: map, prey: preyOf(battle, u, opts, temper, p) }
  let best = null
  for (const o of opts) {
    o.score = score(battle, u, o, temper, p, ctx)
    // Yours gain no road: the fewer steps the better.
    o.road = u.side === 'foe' ? gain(battle, u, o.tile) : -o.path.length
    if (best === null || better(o, best)) best = o
  }
  return best
}

// ── the camp's turn (§2.9) ───────────────────────────────────────────────────────────────────────

// The foes' turn: the pressure and the danger map read once, then each foe in road order (nearest the Monarch first,
// ties by lane, then uid; a boss's override may reorder it: rules.js `queue`, the Sovereign's court first) commits
// its best option (choose, by its temperament; at full pressure a hasty one, among its fighting options) on the board
// as it stands after the ones before it: its move along its road, then its act. Deterministic. → { orders, events }
// (orders as the player's are written).
export function foeTurn (battle) {
  const from = battle.events.length
  const out = []
  const maps = { foe: danger(battle, 'foe') }
  const p = press(battle, maps)
  const dist = (u) => roadOf(battle, u).dist[u.tile]
  const queue = battle.units.filter((u) => u.side === 'foe' && alive(u))
    .sort((a, b) => dist(a) - dist(b) || LANE[tileX(a.tile)] - LANE[tileX(b.tile)] || a.uid - b.uid)
  call(battle, 'queue', 'foe', { queue })
  for (const u of queue) {
    if (battle.over) break
    if (!alive(u)) continue
    const best = p >= 1 ? choose(battle, u, hasty(u.temper), p, maps.foe, fighting(battle, u)) : choose(battle, u, u.temper, p, maps.foe)
    if (best.tile !== u.tile) {
      out.push({ type: 'move', uid: u.uid, tile: best.tile })
      walk(battle, u, best.path)
    }
    if (best.ability) {
      out.push({ type: 'act', uid: u.uid, ability: best.ability.id, target: best.target.uid })
      perform(battle, u, best.ability, best.target)
    } else if (hexed(u) && !u.acted) {
      battle.beat++
      emit(battle, { type: 'hexed', target: u.uid })
    }
    u.acted = true
  }
  return { orders: out, events: battle.events.slice(from) }
}

// ── your side's turns ────────────────────────────────────────────────────────────────────────────

// The basic player: End Turn, every turn (what it leaves alone strikes or mends with its basic: turns.js untouched).
export const basicTurn = () => [{ type: 'end' }]

// ── the expert's situation (redesign.md §2.17) ───────────────────────────────────────────────────

// What the expert reads of the board before a piece of its decides, read again for each (the pieces before it have
// moved, struck and felled): what the board, the wave counter and the bestiary show a player, never the camp's pressure
// nor its coming turn. Every option of the piece is read against it (features), and the tree's rules read it
// (expert.js TREES.battle):
//   turn       the turn
//   map        the danger map: what the foes could deal next turn to one of yours on each tile (danger)
//   entries    { ground, air }, by tile beside the Monarch's seat: how many living foes' roads come in by it (a piece of
//              yours on the ground there holds either kind; a flyer of yours, only the flyers)
//   roads      each tile a foe's road comes into the Monarch by: { tile, held (the uid of yours on it, or null), foes:
//              [{ uid, turns (to come beside the Monarch: its road ÷ its Move, rounded up), reach }] }
//   holding    by the uid of a piece of yours, the foes whose road it holds within their Move (those it frees by leaving)
//   monarch    { hp, share (of its max HP: its wounds are the run's, carried from battle to battle, redesign.md §2.18
//              C), danger (what the foes could deal it next turn: their `deals` summed), lethal (danger ≥ hp), threats
//              ([{ uid, deals }], the foes that could strike it), deals (Map: foe → what it could deal), marked (a Set of
//              those foes), screened (the foes in reach of it whose every line to it one of yours stands in: §2.19) };
//              null with none
//   pieces     each of yours that takes orders: { uid, danger (where it stands), dies (that danger would fell it), acted,
//              ready (its skills off cooldown) }
//   killable   each foe one of yours could fell alone this turn (its blow's exact damage; within its Move left and its
//              reach, as the crow flies): [{ uid, by: [uids] }]
//   foes       each living foe: { uid, hexed, ready (its skills off cooldown), mends (it has a heal) }
//   healers    { party, foe }: the uids that heal, on each side
//   synergies  { party, foe }: the rules each side holds (ids); `breaks`: the foes' that one fewer of a kin or role
//              would end (a kill that breaks a cohort's 4); `gains`: yours that one more piece would bring
//   wave       the next wave as the counter shows it ({ wave, turn }), `due` (it enters as this turn ends) and the
//              `lanes` it enters by; null with none to come
//   patience   turns since the last wave's first entry (the camp's impatience grows with it: a player sees as much)
//   shadows    your shadows and summons standing
//   corpses    each Arise holder of yours that may raise now: [{ uid, corpses (uids in its reach where it stands) }]
//   idle       the uids of your pieces yet to act
//   healing    what the foes' healers could mend each foe next turn (healingRead: Map foe → HP)
//   threat     the foes' coming blows, each foe's once (threatRead: `foes`, in road order; `ours`, the units of yours they
//              may strike; `d`, what each could deal each; `spots`, the tiles each living foe's road could take it to)
export function situation (battle) {
  const map = danger(battle, 'party')
  const m = battle.monarch && alive(battle.monarch) ? battle.monarch : null
  const foes = battle.units.filter((x) => x.side === 'foe' && alive(x))
  const mine = battle.units.filter((x) => orderable(battle, x))
  const entries = { ground: new Array(TILES).fill(0), air: new Array(TILES).fill(0) }
  const roads = new Map()
  const holding = new Map()
  const deals = new Map()
  const screened = []
  for (const x of foes) {
    const spots = roadAhead(battle, x, x.move)
    // The tile its road stops before this turn, short of its Move: who holds it there.
    const stop = spots.length <= x.move ? roadOf(battle, x).arrow[spots[spots.length - 1].tile] : -1
    const holder = stop >= 0 ? holderOn(battle, x, stop) : null
    if (holder && orderable(battle, holder)) holding.set(holder.uid, [...(holding.get(holder.uid) ?? []), x])
    if (!m) continue
    const d = strikeOn(battle, x, m, spots.map((s) => s.tile))
    if (d > 0) deals.set(x, d)
    else if (strikeOn(battle, x, m, spots.map((s) => s.tile), null, false) > 0) screened.push(x)
    const road = roadOf(battle, x)
    const t = entryOf(road, x.tile)
    if (t < 0) continue
    const by = x.flies ? entries.air : entries.ground
    by[t]++
    if (!roads.has(t)) roads.set(t, { tile: t, held: battle.at[t]?.side === 'party' ? battle.at[t].uid : null, foes: [] })
    roads.get(t).foes.push({ uid: x.uid, turns: Math.ceil((road.dist[x.tile] - 1) / Math.max(1, x.move)), reach: farthest(x) })
  }
  const total = [...deals.values()].reduce((n, d) => n + d, 0)
  const ready = (u) => u.kit.filter((a) => isSkill(u, a) && !(u.cooldowns[a.id] > 0)).map((a) => a.id)
  const next = nextWave(battle)
  const read = threatRead(battle)
  const ours = targetsOf(battle)
  return {
    turn: battle.turn,
    map,
    healing: healingRead(battle),
    threat: { foes: read, ours, d: strikes(battle, read, ours), spots: new Map(foes.map((x) => [x, read.find((f) => f.x === x)?.spots ?? roadAhead(battle, x, x.move).map((p) => p.tile)])) },
    entries,
    roads: [...roads.values()].sort((a, b) => a.tile - b.tile),
    holding,
    monarch: m && {
      hp: m.hp, share: m.hp / m.maxHp, danger: total, lethal: total >= m.hp, threats: [...deals].map(([x, d]) => ({ uid: x.uid, deals: d })), deals, marked: new Set(deals.keys()), screened
    },
    pieces: mine.map((u) => {
      const d = dangerAt(battle, u, u.tile, map)
      return { uid: u.uid, danger: d, dies: d >= u.hp, acted: u.acted, ready: ready(u) }
    }),
    killable: foes.map((x) => ({ uid: x.uid, by: mine.filter((u) => fells(battle, u, x)).map((u) => u.uid) })).filter((k) => k.by.length),
    foes: foes.map((x) => ({ uid: x.uid, hexed: hexed(x), ready: ready(x), mends: !!x.mend })),
    healers: Object.fromEntries(['party', 'foe'].map((side) => [side, battle.units.filter((u) => u.side === side && alive(u) && u.mend).map((u) => u.uid)])),
    synergies: synergyRead(battle),
    wave: next && { ...next, due: next.turn === battle.turn + 1, lanes: [...new Set(battle.reserve.filter((f) => (f.wave || 1) === next.wave).map((f) => f.lane))] },
    patience: battle.turn - battle.foeIn,
    shadows: battle.units.filter((u) => u.side === 'party' && alive(u) && u.shadow).length,
    corpses: mine.filter((u) => canAct(battle, u) && u.kit.some((a) => a.shape === 'corpse' && usable(battle, u, a))).map((u) => ({ uid: u.uid, corpses: corpses(battle, u).map((c) => c.uid) })),
    idle: mine.filter((u) => !u.acted).map((u) => u.uid)
  }
}

// A situation in a line, for the audit.
export const brief = (sit) => [
  `turn ${sit.turn}`,
  sit.monarch ? `Monarch ${sit.monarch.hp} HP, ${Math.round(sit.monarch.danger)} in reach of ${sit.monarch.threats.length} foe(s)` : 'no Monarch',
  `${sit.roads.filter((r) => r.held === null).length}/${sit.roads.length} roads in open`,
  `${sit.pieces.filter((p) => p.dies).length}/${sit.pieces.length} pieces where they could fall`,
  `${sit.killable.length} foe(s) killable`,
  sit.wave ? `wave ${sit.wave.wave} on turn ${sit.wave.turn}` : 'no wave to come'
].join(', ')

// Who holds a foe `x`'s road on tile `t` (as turns.js roadAhead reads it): for a ground foe whoever stands there, for a
// flyer one of yours on the ground there, else whoever is in the air there; null for no one.
const holderOn = (battle, x, t) => (x.flies ? (battle.at[t] !== null && battle.at[t].side !== x.side ? battle.at[t] : battle.sky[t]) : battle.at[t])

// The tile road `road` comes into its root by (the one beside it), from `tile`; −1 where no road runs.
function entryOf (road, tile) {
  if (!(road.dist[tile] < Infinity) || road.dist[tile] < 1) return -1
  let t = tile
  for (let k = 0; k < TILES && road.dist[t] > 1; k++) t = road.arrow[t]
  return t
}

// How far a unit's blows reach at most (on the board).
const farthest = (u) => Math.min(DEPTH, Math.max(0, ...u.kit.filter(isBlow).map((b) => blowReach(u, b))))

// What foe `x` could deal `m` (the Monarch) on its next turn, after its DEF: its hardest blow ready by then that
// reaches `m` from one of `spots` (the tiles its road takes it to), on a clear line for a blow that keeps to one (a
// Monarch screened from a shooter is safe from it: redesign.md §2.19; `moved`, { u, at }: piece u standing on the
// footprint `at` instead), 0 where none does or a Hex costs it its act. With `lines` false, as if no one stood in the
// way. Summed over the foes, the danger map's read at the Monarch's tile, foe by foe.
function strikeOn (battle, x, m, spots, moved = null, lines = true) {
  if (stunned(x, false)) return 0
  let best = 0
  for (const b of x.kit) {
    if (!isBlow(b) || (isSkill(x, b) && (x.cooldowns[b.id] ?? 0) > 0)) continue
    const raw = rawOf(battle, x, b)
    if (!(raw > best)) continue
    const r = blowReach(x, b)
    const line = lines && lined(b)
    if (spots.some((t) => distanceBetween(t, x.size, m.tile, m.size) <= r && (!line || clear(battle, t, x.size, m, m.tile, moved)))) best = raw
  }
  return best * mitigation(battle, m)
}

// Whether no one of `y`'s side stands strictly between a footprint at `t` (of side `size`) and y standing on `tile`, y
// itself aside (the line a blow keeps to: turns.js lineStruck); `moved` ({ u, at }) has piece u on the footprint `at`
// instead of where it stands.
function clear (battle, t, size, y, tile, moved = null) {
  const [p, q] = lineEnds(t, size, tile, y.size)
  const k = p * TILES + q
  for (let i = LINE_AT[k]; i < LINE_AT[k + 1]; i++) {
    const c = LINE_TILES[i]
    const g = battle.at[c]
    if (g !== null && g.side === y.side && g !== y && g !== moved?.u) return false
    const a = battle.sky[c]
    if (a !== null && a.side === y.side && a !== y && a !== moved?.u) return false
    if (moved && moved.u !== y && moved.u.side === y.side && moved.at.includes(c)) return false
  }
  return true
}

// ── the expert's threat read (redesign.md §2.17) ─────────────────────────────────────────────────

// The foes' coming blows as a player who has met them reads them, never played: each living foe that will act next
// turn, in road order (nearest the Monarch first, as the camp moves them), with the tiles its road could take it to
// (roadAhead: a held tile stops it), the road it would walk with no one in its way (`ahead`: to see whom a move of
// yours blocks or frees), the blows it will have ready (the power of each, how far it reaches a piece on the ground and
// one in the air), and how its way line says it hunts (its temperament, the bestiary's). The danger map counts every
// foe on every tile; this counts each foe's blow once, on whom it would rather strike (assign).
// → [{ x, s (its stats), blows: [{ power, r, ra }], temper, spots, ahead }]
function threatRead (battle) {
  const out = []
  for (const x of battle.units) {
    if (x.side !== 'foe' || !alive(x) || stunned(x, false)) continue
    const blows = []
    for (const b of x.kit) {
      if (!isBlow(b) || (isSkill(x, b) && (x.cooldowns[b.id] ?? 0) > 0)) continue
      let power = 0
      for (const e of b.effects) if (e.op === 'damage') power += e.power
      const r = blowReach(x, b)
      if (power > 0) blows.push({ power, r, ra: aloft(x, b, r), melee: !!b.melee, lined: lined(b), def: b })
    }
    if (!blows.length) continue
    const road = roadOf(battle, x)
    const ahead = []
    for (let t = road.arrow[x.tile], k = 0; t >= 0 && k < x.move; t = road.arrow[t], k++) ahead.push(t)
    out.push({ x, s: stats(battle, x), blows, melee: blows.every((b) => b.melee), temper: x.temper ?? NEUTRAL, spots: roadAhead(battle, x, x.move).map((p) => p.tile), ahead, dist: road.dist[x.tile] })
  }
  return out.sort((a, b) => a.dist - b.dist || LANE[tileX(a.x.tile)] - LANE[tileX(b.x.tile)] || a.x.uid - b.x.uid)
}
const NEUTRAL = { aggression: 1, caution: 1, prey: 'weakest' }

// What foe `f` (threatRead's) could deal `y` of yours standing on `tile` next turn from one of `spots`: its hardest
// blow that reaches y there (a flyer only by one that reaches the air; one that keeps to a line, on a clear line: a
// screen of yours takes it instead, redesign.md §2.19; `moved` as clear's), after y's DEF; 0 for none.
function strikeAt (battle, f, y, tile, spots, moved = null) {
  let best = 0
  let sy = null
  for (const b of f.blows) {
    const r = y.flies ? b.ra : b.r
    if (r < 0) continue
    let near = false
    for (const t of spots) if (distanceBetween(t, f.x.size, tile, y.size) <= r && (!b.lined || clear(battle, t, f.x.size, y, tile, moved))) { near = true; break }
    if (!near) continue
    sy ??= stats(battle, y)
    const d = computeDamage({ power: b.power, atk: f.s.atk, def: sy.def, mul: f.s.damage.dealt * sy.damage.taken })
    if (d > best) best = d
  }
  return best
}

// What the foes' healers could mend each foe next turn (their heals ready, within their Move and the heal's range of
// it, as the crow flies; each healer counted for everyone it could reach, as if it mended each): Map foe → HP. A blow
// that leaves a foe less wounded than this is undone on the camp's turn (features' `undone`).
function healingRead (battle) {
  const out = new Map()
  out.healers = []
  for (const h of battle.units) {
    if (h.side !== 'foe' || !alive(h) || stunned(h, false)) continue
    const s = stats(battle, h)
    for (const a of h.kit) {
      if (!isAllyShape(a.shape) || (isSkill(h, a) && (h.cooldowns[a.id] ?? 0) > 0)) continue
      const heal = a.effects.find((e) => e.op === 'heal' && !e.self)
      if (!heal) continue
      const r = rangeOf(a) + h.move
      const amounts = new Map()
      for (const x of battle.units) {
        if (x.side !== 'foe' || !alive(x) || distanceBetween(h.tile, h.size, x.tile, x.size) > r) continue
        const n = heal.pct ? x.maxHp * heal.pct : heal.power * s.atk / TUNING.damage.atkDivisor * s.heal.given
        out.set(x, Math.max(out.get(x) ?? 0, 0) + n)
        amounts.set(x, n)
      }
      out.healers.push(amounts)
    }
  }
  return out
}

// Your side's units the foes may strike: the Monarch, your pieces, your shadows and summons.
const targetsOf = (battle) => battle.units.filter((y) => y.side === 'party' && alive(y))

// What each foe could deal each unit of yours next turn, where they stand: Map foe entry → Map unit → HP.
function strikes (battle, threat, ours) {
  const d = new Map()
  for (const f of threat) {
    const row = new Map()
    for (const y of ours) {
      const n = strikeAt(battle, f, y, y.tile, f.spots)
      if (n > 0) row.set(y, n)
    }
    d.set(f, row)
  }
  return d
}

// The blows the foes would land next turn, each foe's once (the threat read's `d`, foe → Map unit → HP it could
// deal): in road order, each on the unit of yours its way line says it would rather strike, as the camp scores a blow
// (§2.9.3) with nothing played: the HP it would deal (as far as that one's HP left), half again on its prey, and its
// aggression × a kill's worth (the max HP; the Monarch's, the battle) where it would fell it. `hp`: Map unit → the HP it
// stands at (where an option changes it); `skip`: foes that will not strike (felled or Hexed). → Map unit → HP taken.
function assign (battle, threat, d, hp, skip, picks = null) {
  const taken = new Map()
  const m = battle.monarch
  for (const f of threat) {
    if (skip.has(f.x)) continue
    const row = d.get(f)
    if (!row.size) continue
    const left = (y) => (hp.get(y) ?? y.hp) - (taken.get(y) ?? 0)
    const prey = preyAmong(battle, f.temper.prey, row, left)
    let best = null
    let top = -Infinity
    for (const [y, n] of row) {
      const l = left(y)
      if (l <= 0) continue
      const kill = n >= l ? (y === m ? MONARCH : y.maxHp) : 0
      const v = Math.min(n, l) * (prey === y ? 1.5 : 1) + f.temper.aggression * kill
      if (v > top) { top = v; best = y }
    }
    if (!best) continue
    picks?.push([f, best, Math.min(row.get(best), left(best)), left(best)])
    // A Shape's blow lands on everyone of yours it covers from there too (turns.js shape).
    for (const z of spill(battle, f, best, row.get(best))) {
      const n = strikeAt(battle, f, z, z.tile, [z.tile, ...f.spots])
      if (n > 0 && left(z) > 0) taken.set(z, (taken.get(z) ?? 0) + Math.min(n, left(z)))
    }
    taken.set(best, (taken.get(best) ?? 0) + Math.min(row.get(best), left(best)))
  }
  return taken
}

// The others of yours foe `f`'s blow at `y` (the one that deals it `n`) covers, where that blow has a Shape: as
// turns.js shape spreads it from the first tile of its road it would strike y from.
function spill (battle, f, y, n) {
  for (const b of f.blows) {
    if (b.def.shape === 'single' || b.def.shape === undefined) continue
    const r = y.flies ? b.ra : b.r
    if (r < 0) continue
    const t = f.spots.find((p) => distanceBetween(p, f.x.size, y.tile, y.size) <= r)
    if (t === undefined) continue
    const sy = stats(battle, y)
    if (computeDamage({ power: b.power, atk: f.s.atk, def: sy.def, mul: f.s.damage.dealt * sy.damage.taken }) < n) continue
    return shape(battle, { uid: f.x.uid, side: 'foe', tile: t, size: f.x.size, flies: f.x.flies }, b.def, y).filter((z) => z !== y && z.side === 'party' && alive(z))
  }
  return NONE
}

// The one of `row`'s units (those a foe could strike) its prey (TEMPERS) makes it hunt, by what it stands at now; null
// where its prey reads nothing static (a crowd, the most rested).
function preyAmong (battle, kind, row, left) {
  if (kind === 'monarch') return row.has(battle.monarch) ? battle.monarch : null
  const key = kind === 'weakest' ? left : kind === 'wounded' ? (y) => left(y) / y.maxHp : kind === 'unarmoured' ? (y) => stats(battle, y).def : null
  if (!key) return null
  let out = null
  let low = Infinity
  for (const y of row.keys()) {
    if (left(y) <= 0) continue
    const k = key(y)
    if (k < low) { low = k; out = y }
  }
  return out
}

// What a unit of yours standing at `hp` is worth, in HP: its HP and its max HP more (what felling it takes from your
// side), less TUNING.expert.battle.brink of its max HP × the square of the share it has lost (the nearer its fall, the
// dearer each HP); 0 fallen. So what a blow takes from it (lossOf) weighs a wound on the wounded more, and a fall most.
const standingAt = (hp, max) => (hp > 0 ? hp + max - TUNING.expert.battle.brink * max * (1 - hp / max) ** 2 : 0)
const lossOf = (hp, max, taken) => standingAt(hp, max) - standingAt(hp - taken, max)

// What the Monarch standing at `hp` (of `max`) is worth, in HP: its max HP × g(x), x the share it stands at, g(x) =
// (1 + peril) x − peril x² / 2 (TUNING.expert.battle.peril): an HP of its weighs 1 while it is whole and 1 + peril as it
// is about to fall (its HP carries from room to room, and its fall is the run's end).
const guardAt = (hp, max) => {
  const x = Math.max(0, hp) / max
  const p = TUNING.expert.battle.peril
  return max * ((1 + p) * x - p * x * x / 2)
}

// Your side's losses next turn as the threat read says (assign), by kind of unit: `souls` (your pieces, a soul's wounds
// leaving the battle with it, its fall worst), `shadows` (shadows and summons), each in HP weighed by lossOf, and
// `monarch` what the Monarch would take, weighed by guardAt; `taken` the map assign made.
function losses (battle, taken, hp) {
  const out = { souls: 0, shadows: 0, monarch: 0, taken }
  for (const [y, n] of taken) {
    if (y === battle.monarch) out.monarch += guardAt(hp.get(y) ?? y.hp, y.maxHp) - guardAt((hp.get(y) ?? y.hp) - n, y.maxHp)
    else out[y.shadow ? 'shadows' : 'souls'] += lossOf(hp.get(y) ?? y.hp, y.maxHp, n)
  }
  return out
}

// The tiles foe `x`'s road takes it to next turn (roadAhead's), were piece `u` standing on `tile` instead of where it
// stands: its footprint there holds the road (a ground piece's anyone's, a flyer's only a flyer's), and where it stood
// is free.
function roadWith (battle, x, u, tile) {
  const road = roadOf(battle, x)
  const held = footprint(tile, u.size)
  const out = [x.tile]
  for (let t = road.arrow[x.tile], k = 0; t >= 0 && k < x.move; t = road.arrow[t], k++) {
    const ground = battle.at[t] === u ? null : battle.at[t]
    const air = battle.sky[t] === u ? null : battle.sky[t]
    const holder = x.flies ? (ground !== null && ground.side !== x.side ? ground : air) : ground
    if ((held.includes(t) && (x.flies || !u.flies)) || (holder !== null && holder !== x) || (!x.flies && battle.walls.has(t))) break
    out.push(t)
  }
  return out
}

// Whether piece `u` could fell foe `x` alone this turn: a blow it may use now whose damage (exact: no dice) is x's HP,
// within its Move left and that blow's reach of it, as the crow flies (a melee blow from the ground never at a flyer).
function fells (battle, u, x) {
  if (!canAct(battle, u)) return false
  const gap = distanceBetween(u.tile, u.size, x.tile, x.size) - Math.max(0, u.move - u.moved)
  for (const b of u.kit) {
    if (!isBlow(b) || !usable(battle, u, b)) continue
    const r = x.flies ? aloft(u, b, blowReach(u, b)) : blowReach(u, b)
    if (r >= 0 && gap <= r && blowOn(battle, u, b, x) >= x.hp) return true
  }
  return false
}

// The synergies on each side (synergiesOf), and how near each side is to losing or gaining one: `breaks` the foes'
// rules that one fewer of a kin or role they count would end, `gains` the rules of yours one more piece would bring.
function synergyRead (battle) {
  const counts = (side) => {
    const c = { kin: {}, role: {} }
    for (const u of battle.units) {
      if (u.side !== side || !alive(u) || u === battle.monarch) continue
      const d = unitDef(u.id)
      c.kin[d.kin] = (c.kin[d.kin] ?? 0) + 1
      c.role[d.role] = (c.role[d.role] ?? 0) + 1
    }
    return c
  }
  const short = (syn, c) => ['kin', 'role'].reduce((n, axis) => n + Object.entries(syn.needs[axis] ?? {}).reduce((k, [id, need]) => k + Math.max(0, need - (c[axis][id] ?? 0)), 0), 0)
  const theirs = counts('foe')
  const ours = counts('party')
  const party = synergiesOf(battle, 'party').map((x) => x.id)
  const foe = synergiesOf(battle, 'foe')
  return {
    party,
    foe: foe.map((x) => x.id),
    breaks: foe.filter((syn) => ['kin', 'role'].some((axis) => Object.entries(syn.needs[axis] ?? {}).some(([id, need]) => theirs[axis][id] === need))).map((x) => x.id),
    gains: SYNERGIES.filter((syn) => !party.includes(syn.id) && short(syn, ours) === 1).map((x) => x.id)
  }
}

// ── the expert's features (redesign.md §2.17) ────────────────────────────────────────────────────

// An option of piece `u` (a tile, and its act or a fusion there: options, expertOptions) read as the features its
// decision weighs (TUNING.expert.battle.option) and its tree's rules read (expert.js TREES.battle), off the board as it
// stands and the situation `sit`; nothing is played:
//   damage, kill, menace, focus, bane, status, mend, rescue, shadow, counter   what its act does (estimate)
//   harry    its damage on the foes that could strike the Monarch next turn (sit.monarch.deals)
//   danger   HP the foes could deal it next turn where it ends (the danger map), as far as the HP its counter leaves
//   fall     its max HP, where that danger or the counter would fell it
//   screen   the foes' roads into the Monarch it holds from where it ends (sit.entries), less those it holds now
//   guard    HP of the Monarch's danger next turn that the option takes away: the threats it fells or Hexes deal
//            nothing, and each foe whose road it would hold (or free) reaches the Monarch, or not, from where it ends
//   lethal   1 where the foes could still fell the Monarch next turn after it; cull: Monarch threats it fells
//   fuse, essence   a fusion: the fused piece's HP less its parts', and its price
//   waste    1 for an act that changes nothing (no damage, no mend, no status, no shadow)
// and from the plan (sit.plan: plan.js readPlan, read once a turn; made here where a decision is read alone):
//   progress steps it ends nearer the tile the target formation gives it (its path on its layer, footprints counted;
//            a piece with no slot, the tile whence it would strike the nearest foe)
//   role     1 where it ends on that tile: its role held; post: and that role a post (a road's block or air slot, a
//            screen: the tree's hold-the-line)
//   listed   1 where its act is its strike on the kill list (the same blow at the same foe)
//   forecast HP the foes could deal it next turn where it ends, each from where the forecast has it stand (not every
//            tile its road could take it to, as `danger` and `loss` read them)
export function features (battle, u, o, sit = situation(battle)) {
  const v = {
    damage: 0, kill: 0, menace: 0, focus: 0, bane: 0, harry: 0, status: 0, mend: 0, rescue: 0, danger: 0, fall: 0, counter: 0, screen: 0, guard: 0, lethal: 0, cull: 0,
    shadow: 0, fuse: 0, essence: 0, waste: 0, loss: 0, shadowLoss: 0, hit: 0, engage: 0, undone: 0, quell: 0, progress: 0, role: 0, post: 0, listed: 0, forecast: 0
  }
  const m = sit.monarch
  const P = sit.plan ??= readPlan(battle, sit, { store: false })
  const goal = P.goals.get(u.uid)
  if (goal?.field) {
    const before = goal.field[u.tile]
    const after = goal.field[o.tile]
    if (Number.isFinite(before) && Number.isFinite(after)) v.progress = before - after
    if (after === 0) {
      v.role = 1
      if (POSTS.has(goal.role)) v.post = 1
    }
  }
  if (o.fusion) {
    const t = sit.threat.base ??= threatWith(battle, sit, u, { tile: u.tile }, ZERO)
    v.loss = t.souls
    v.shadowLoss = t.shadows
    v.hit = t.monarch
    const terms = battle.fuse?.[o.fusion.id]
    const parts = o.fusion.parts.map((uid) => battle.byUid.get(uid))
    const lvl = Math.max(terms?.lvl ?? 1, ...parts.map((p) => p.lvl))
    v.fuse = statsOf({ id: FUSIONS[o.fusion.id].result, lvl, tracks: terms?.tracks ?? [0, 0] }, battle.partyMods).hp - parts.reduce((n, p) => n + p.hp, 0)
    v.essence = terms?.price ?? 0
    v.screen = -parts.reduce((n, p) => n + (p === u ? 0 : holds(p, p.tile, sit)), 0)
    v.lethal = m?.lethal ? 1 : 0
    return v
  }
  const e = estimate(battle, u, o, m ? m.marked : NOBODY, sit.map)
  for (const k of ['damage', 'kill', 'menace', 'focus', 'bane', 'status', 'mend', 'rescue', 'shadow', 'counter']) v[k] = e[k]
  v.harry = e.preyed
  const left = u.hp - e.counter
  v.danger = Math.max(0, Math.min(left, dangerAt(battle, u, o.tile, sit.map)))
  const t = threatWith(battle, sit, u, o, e)
  v.loss = t.souls
  v.shadowLoss = t.shadows
  v.hit = t.monarch
  v.fall = left <= 0 || (t.taken.get(u) ?? 0) >= left ? u.maxHp : 0
  v.engage = engage(battle, sit, u, o, new Set(e.felled))
  for (const [x, dd] of e.hits ?? NONE) {
    const H = sit.healing.get(x) ?? 0
    const before = x.maxHp - x.hp
    v.undone += Math.min(before + dd, H) - Math.min(before, H)
    v.quell += dd / x.hp * hardest(battle, x)
  }
  v.screen = holds(u, o.tile, sit) - holds(u, u.tile, sit)
  const k = P.listed.get(u.uid)
  if (k && o.ability?.id === k.ability && o.target?.uid === k.target) v.listed = 1
  v.forecast = Math.max(0, Math.min(left, dangerAt(battle, u, o.tile, P.fmap)))
  if (o.ability && e.damage + e.kill + e.status + e.mend + e.shadow === 0) v.waste = 1
  if (m) {
    const after = monarchAfter(battle, sit, u, o, e)
    v.guard = Math.min(m.hp, m.danger) - Math.min(m.hp, after)
    v.lethal = after >= m.hp ? 1 : 0
    v.cull = e.felled.filter((x) => m.deals.has(x)).length
  }
  return v
}

// The formation's roles that hold the Monarch's ground (plan.js formation): a road's block and air slots, a screen.
const POSTS = new Set(['block', 'air', 'screen'])

// The threat read (sit.threat) with piece `u` taking option `o` (its estimate `e`): the foes it fells or Hexes strike no
// one; each foe whose road it holds or frees (its footprint where it stands or where it ends, on the road the foe would
// walk) is read again from where its road would take it (roadWith); the rest as read, u struck where it ends, at the
// HP its counter leaves it, and the one it mends at the HP it mends it to. → losses.
function threatWith (battle, sit, u, o, e) {
  const { foes, d } = sit.threat
  const key = u.uid * TILES + o.tile
  const moved = o.tile !== u.tile
  let dd = d
  if (moved) {
    // The same for every act from one tile: read once a tile.
    const kept = (sit.threat.with ??= new Map())
    dd = kept.get(key)
    if (!dd) kept.set(key, (dd = rowsWith(battle, sit, u, o.tile)))
  }
  const hp = new Map()
  if (e.counter) hp.set(u, u.hp - e.counter)
  const x = o.target
  if (e.mend && x && x.side === u.side && o.ability.shape !== 'all_allies') hp.set(x, Math.min(x.maxHp, (hp.get(x) ?? x.hp) + e.mend))
  const skip = e.felled.length || e.hexed.length ? new Set([...e.felled, ...e.hexed]) : NOBODY
  if (hp.size || skip !== NOBODY) return losses(battle, assign(battle, foes, dd, hp, skip), hp)
  // An act that changes no one's HP the foes read, and fells or Hexes none of them, leaves the foes' turn as holding
  // there would: read once a tile.
  const plain = (sit.threat.plain ??= new Map())
  let out = plain.get(key)
  if (!out) plain.set(key, (out = losses(battle, assign(battle, foes, dd, hp, skip), hp)))
  return out
}

// The threat read's rows (sit.threat.d) with piece `u` standing on `tile` instead: each foe whose road it would hold or
// free (on the road the foe would walk) read again from where its road would take it (roadWith); each shooter whose
// lines it could close or open (where it stood or where it ends within that shooter's reach of the tiles its road could
// take it to: a tile strictly between is nearer than the one struck) read again with u where it ends (redesign.md
// §2.19); the rest as read, u struck where it ends. → Map foe entry → Map unit → HP.
function rowsWith (battle, sit, u, tile) {
  const { foes, ours, d } = sit.threat
  const at = footprint(tile, u.size)
  const was = footprint(u.tile, u.size)
  const both = [...at, ...was]
  const moved = { u, at }
  const dd = new Map()
  for (const f of foes) {
    let row
    const road = f.ahead.some((t) => both.includes(t))
    const lines = !road && f.blows.some((b) => b.lined && f.spots.some((t) => both.some((c) => distanceBetween(t, f.x.size, c, 1) < b.r)))
    if (road || lines) {
      const spots = road ? roadWith(battle, f.x, u, tile) : f.spots
      row = new Map()
      for (const y of ours) {
        const n = strikeAt(battle, f, y, y === u ? tile : y.tile, spots, moved)
        if (n > 0) row.set(y, n)
      }
    } else {
      row = new Map(d.get(f))
      const n = strikeAt(battle, f, u, tile, f.spots, moved)
      if (n > 0) row.set(u, n)
      else row.delete(u)
    }
    dd.set(f, row)
  }
  return dd
}

// What piece `u` could deal next turn from where option `o` leaves it: its hardest blow it will have ready (a skill it
// uses now rests), as far as the HP of the foe it lands on, at a foe it could reach then (its Move and the blow's reach,
// as the crow flies, to a tile that foe's road could take it to: sit.threat.spots), none of `gone` (those it fells now).
function engage (battle, sit, u, o, gone) {
  const s = stats(battle, u)
  let best = 0
  for (const b of u.kit) {
    if (!isBlow(b) || (isSkill(u, b) && (b === o.ability || (u.cooldowns[b.id] ?? 0) > 1))) continue
    const r = blowReach(u, b)
    const ra = aloft(u, b, r)
    for (const [x, spots] of sit.threat.spots) {
      if (gone.has(x)) continue
      const rr = x.flies ? ra : r
      if (rr < 0 || !spots.some((t) => distanceBetween(o.tile, u.size, t, x.size) <= u.move + rr)) continue
      let n = 0
      for (const e of b.effects) if (e.op === 'damage') n += hit(battle, s, x, e.power)
      if (Math.min(n, x.hp) > best) best = Math.min(n, x.hp)
    }
  }
  return best
}

// What the damage over time a unit holds will deal it at the turn's end (each status's `dot` tick, its power a stack),
// none from one laid since its holder's turn passed (it waits a round).
function dotOn (u) {
  let n = 0
  for (const s of u.statuses) {
    if (s.fresh) continue
    for (const e of statusDef(s.id).tick ?? NONE) if (e.op === 'dot') n += e.power * s.stacks
  }
  return n
}

// The roads into the Monarch piece `u` would hold standing on `tile` (sit.entries, over its footprint).
const holds = (u, tile, sit) => (footprint(tile, u.size) ?? [tile]).reduce((n, t) => n + sit.entries.air[t] + (u.flies ? 0 : sit.entries.ground[t]), 0)

// How far `u` standing on `tile` would be from the nearest living foe, footprints counted: for a flyer as the crow
// flies (Chebyshev), for a piece on the ground in steps round the camp's walls (walkField; 2026-10-11: as the crow
// flies, a piece behind a wall read itself beside a foe it could never reach, and stayed).
const gap = (battle, u, tile) => {
  if (u.flies) return battle.units.reduce((d, x) => (x.side !== u.side && alive(x) ? Math.min(d, distanceBetween(tile, u.size, x.tile, x.size)) : d), Infinity)
  const field = walkField(battle, u.side)
  let d = Infinity
  for (const t of footprint(tile, u.size) ?? [tile]) d = Math.min(d, field[t])
  return d
}
// Steps (8 ways, never cutting a wall's corner: unit.js steps) from each tile to the nearest living unit not of
// `side`, walls in the way; Infinity where none can be reached. Made once for a board as its foes stand.
const walks = new WeakMap()
function walkField (battle, side) {
  const from = []
  for (const x of battle.units) if (x.side !== side && alive(x)) from.push(...(footprint(x.tile, x.size) ?? [x.tile]))
  const key = side + from.join()
  const had = walks.get(battle)
  if (had?.key === key) return had.field
  const field = new Array(TILES).fill(Infinity)
  for (const t of from) field[t] = 0
  for (let i = 0, queue = from.slice(); i < queue.length; i++) {
    const t = queue[i]
    for (const n of steps(t, battle.walls)) {
      if (field[n] <= field[t] + 1) continue
      field[n] = field[t] + 1
      queue.push(n)
    }
  }
  walks.set(battle, { key, field })
  return field
}

// The Monarch's danger next turn were `u` to take option `o` (its estimate `e`): sit.monarch.danger, with each foe
// that threatens it now, whose road `u` holds, or that one of yours screens from it, read again: nothing from one it
// fells or Hexes, and from the rest what they could deal from where their roads would take them with `u` where `o`
// leaves it (roadWith), on the lines u's footprint there closes or where it stood opens (a screen works: §2.19).
function monarchAfter (battle, sit, u, o, e) {
  const { deals, screened } = sit.monarch
  const moved = o.tile !== u.tile
  let after = sit.monarch.danger
  const shift = moved ? { u, at: footprint(o.tile, u.size) } : null
  for (const x of new Set([...deals.keys(), ...(moved ? screened : NONE), ...(sit.holding.get(u.uid) ?? NONE)])) {
    const before = deals.get(x) ?? 0
    const now = e.felled.includes(x) || e.hexed.includes(x) ? 0 : moved ? strikeOn(battle, x, battle.monarch, roadWith(battle, x, u, o.tile), shift) : before
    after += now - before
  }
  return after
}

// ── the expert's turn (redesign.md §2.17) ────────────────────────────────────────────────────────

// Piece `u`'s options for the expert: options' (each tile it may end on, and from there holding or each act at each
// target), and with `fuse` each fusion it may make where it stands.
export function expertOptions (battle, u, { moving = true, fuse = true } = {}) {
  const opts = options(battle, u, { moving })
  if (fuse && canAct(battle, u)) for (const o of fusionsOf(battle, u)) opts.push({ tile: u.tile, path: [], ability: null, target: null, fusion: o })
  return opts
}

// One piece's decision (expert.js decide): its options read against the situation (features; the plan the situation
// carries, else the turn's as plan.js reads it), the tree's rules (TREES.battle), then the weights
// (TUNING.expert.battle.option, or a mode's); ties as `better` breaks them (the fewer steps, the lower lane, the lower
// target uid). → { option, by, rules }.
export function choice (battle, u, sit = situation(battle), opts = expertOptions(battle, u), stance = null) {
  for (const o of opts) {
    o.v = features(battle, u, o, sit)
    o.road = -o.path.length
  }
  const w = TUNING.expert.battle
  return decide(TREES.battle, sit, opts, stance ? { ...w.option, ...w.stances[stance] } : w.option, { modes: w.modes, better })
}

// The expert's turn (redesign.md §2.17, §2.18): pure scoring under a plan. First the plan (plan.js readPlan: kept from
// the last turn unless a trigger changed it, its target formation, the kill list, the foes' forecast), read once on the
// board as it stands. Then each piece of yours that may still act, one at a time, commits its choice on the board as the
// pieces before it left it (so a kill, focus fire and a blow's exact damage are known: the battle has no dice), the plan
// among its features. The pieces go in a few orders (ORDERS: the most constrained first, the strongest first, the
// nearest a foe first, and once more striking from where each stands; and the first two again under each stance's
// weights, TUNING.expert.battle.stances: `ward` minding the Monarch more, `bold` coming on), each on its own copy of the
// battle; once more with the kill list's strikes given first, in its order; and the copy whose board decides best
// (boardFeatures: the tree's TREES.board, then TUNING.expert.battle.board, or a mode's of boardModes) gives its orders,
// the first on a tie. No turn of the foes is played and the camp's policy is never called: the same board gives the same
// orders. `fuse` false (the fusions ablation's): no fusion is weighed. `moving` false (the moves ablation's): every piece
// acts from where it stands. `note` (the audit's) hears each decision of the turn given: { decision ('plan', 'board', or
// 'battle' a piece's), uid, by, rules, sit }.
export function expertTurn (battle, { fuse = true, note = null, moving = true } = {}) {
  if (battle.over) return []
  const sit = situation(battle)
  const plan = readPlan(battle, sit, { moving })
  const boards = []
  const seen = new Set()
  for (const [rank, step, stance] of ORDERS) {
    if (stance && !TUNING.expert.battle.stances?.[stance]) continue
    const go = moving && step
    const uids = queue(battle, rank, go).map((u) => u.uid)
    const key = `${go}|${stance}|${uids}`
    if (seen.has(key)) continue
    seen.add(key)
    const f = fork(battle)
    const log = []
    const orders = pass(f, uids, { moving: go, fuse, log, stance, plan })
    orders.push(...untouchedOrders(f))
    boards.push({ orders, log, v: boardFeatures(f, battle) })
  }
  // The kill list played: its strikes in its order (each from its tile, or the nearest it may strike from now), then the
  // rest as the first order has them.
  if (plan.kills.length) {
    const f = fork(battle)
    const log = []
    const orders = []
    for (const s of plan.kills.flatMap((k) => k.strikes)) {
      const u = f.byUid.get(s.uid)
      if (f.over || !canAct(f, u) || !alive(f.byUid.get(s.target))) continue
      // From a tile whence the blow strikes its foe, not a screen before it (§2.19).
      const opts = options(f, u, { moving }).filter((o) => o.ability?.id === s.ability && o.target?.uid === s.target && struckOf(f, u, o) === o.target)
      const o = opts.find((x) => x.tile === s.tile) ?? opts.sort((p, q) => p.path.length - q.path.length || p.tile - q.tile)[0]
      if (o) orders.push(...commit(f, u, o))
    }
    orders.push(...pass(f, queue(f, room, moving).map((u) => u.uid), { moving, fuse, log, plan }))
    orders.push(...untouchedOrders(f))
    boards.push({ orders, log, v: boardFeatures(f, battle) })
  }
  // The camp's one score with the expert's temperament, each piece in turn (moving, and striking from where each
  // stands), and End Turn alone: what is left alone strikes with its basic.
  for (const play of [...(moving ? [(f) => greedy(f, true)] : []), (f) => greedy(f, false), () => []]) {
    const f = fork(battle)
    const orders = play(f)
    orders.push(...untouchedOrders(f))
    boards.push({ orders, log: [], v: boardFeatures(f, battle) })
  }
  const ctx = { patience: battle.turn - battle.foeIn, plan: plan.kind, shooters: plan.shooters.length }
  const pick = decide(TREES.board, ctx, boards, TUNING.expert.battle.board, { modes: TUNING.expert.battle.boardModes })
  if (note) {
    note({ decision: 'plan', by: `${plan.kind} (${plan.trigger ?? 'kept'})`, rules: plan.rules, sit })
    note({ decision: 'board', by: pick.by, rules: pick.rules })
    for (const r of pick.option.log) note(r)
  }
  return [...pick.option.orders, { type: 'end' }]
}

// What End Turn has the untouched do (turns.js untouched; redesign.md §2.5), done on copy `f` so that a board is read
// with it done: each unit of yours yet to act, in acting order, strikes with its basic blow from where it stands at the
// foe furthest along its road (turns.js pick), else mends with its basic heal the most wounded it can do something for;
// a Hexed one loses its act. Your pieces' acts are given as orders (the same acts End Turn would make); your shadows'
// and summons', which take no orders, are made as End Turn makes them. → the orders.
export function untouchedOrders (f) {
  const out = []
  for (const u of f.units.slice()) {
    if (f.over) break
    if (u.side !== 'party' || u === f.monarch || !canAct(f, u)) continue
    const b = u.basic
    const foes = b && allowed(f, u, b) ? targetsFrom(f, u, b) : NONE
    const m = u.mend
    const allies = !foes.length && m && allowed(f, u, m) ? helped(f, u, m, u.tile) : NONE
    const [a, x] = foes.length ? [b, pick(f, u, foes)] : allies.length ? [m, allies.slice().sort((p, q) => p.hp / p.maxHp - q.hp / q.maxHp || p.uid - q.uid)[0]] : [null, null]
    if (!a) continue
    if (orderable(f, u)) out.push(give(f, { type: 'act', uid: u.uid, ability: a.id, target: x.uid }))
    else {
      perform(f, u, a, x)
      u.acted = true
    }
  }
  return out
}

// The camp's one score (§2.9.3) as the expert would play it (EXPERT: bold enough to trade, careful of what it would
// take, the most wounded foe first), at no pressure (the camp's is never read): each piece of yours yet to act, the most
// constrained first, commits its best option on copy `f` (the danger map read again before each), moving as it likes
// unless `moving` is false. → its orders.
const EXPERT = { aggression: 1, caution: 1, prey: 'wounded' }
function greedy (f, moving) {
  const out = []
  for (const u of queue(f, room, moving)) {
    if (f.over) break
    if (!orderable(f, u) || u.acted) continue
    out.push(...commit(f, u, choose(f, u, EXPERT, 0, danger(f, 'party'), options(f, u, { moving }))))
  }
  return out
}

// The orders the pieces go in (expertTurn): [rank, moving] (rank the lower first; ties by acting order).
const room = (f, u, moving) => options(f, u, { moving }).length
const might = (f, u) => -hardest(f, u)
const near = (f, u) => f.units.reduce((d, x) => (x.side === 'foe' && alive(x) ? Math.min(d, unitDistance(u, x)) : d), Infinity)
const ORDERS = [[room, true], [might, true], [near, true], [room, false], [room, true, 'ward'], [might, true, 'ward'], [room, true, 'bold'], [might, true, 'bold']]

// The pieces of yours that have not acted, in `rank`'s order (the lowest first; ties by acting order).
function queue (f, rank, moving) {
  const pieces = f.units.filter((u) => orderable(f, u) && !u.acted)
  const key = new Map(pieces.map((u) => [u, rank(f, u, moving)]))
  return pieces.sort((a, b) => key.get(a) - key.get(b) || a.ord - b.ord)
}

// One pass on copy `f`: each piece of `uids` still to act, in turn, reads the situation (the turn's `plan` with it) and
// commits its choice (moving as it likes unless `moving` is false). `log` hears each decision. → its orders, given on
// `f`.
function pass (f, uids, { moving, fuse, log, stance = null, plan }) {
  const out = []
  for (const uid of uids) {
    if (f.over) break
    const u = f.byUid.get(uid)
    if (!orderable(f, u) || u.acted) continue
    const sit = situation(f)
    sit.plan = plan
    const pick = choice(f, u, sit, expertOptions(f, u, { moving, fuse }), stance)
    log.push({ decision: 'battle', uid, by: pick.by, rules: pick.rules, sit })
    out.push(...commit(f, u, pick.option))
  }
  return out
}

// Option `o` of piece `u` given on `f`: its move, then its act or its fusion. → the orders.
function commit (f, u, o) {
  const out = []
  if (o.tile !== u.tile) out.push(give(f, { type: 'move', uid: u.uid, tile: o.tile }))
  if (f.over) return out
  if (o.fusion) out.push(give(f, o.fusion))
  else if (o.ability) out.push(give(f, { type: 'act', uid: u.uid, ability: o.ability.id, target: o.target.uid }))
  return out
}

const give = (f, o) => {
  order(f, o)
  return o
}

// A unit's hardest blow, raw (rawOf).
export const hardest = (battle, u) => u.kit.reduce((n, b) => (isBlow(b) ? Math.max(n, rawOf(battle, u, b)) : n), 0)

// What blow `a` of `u` would deal `x` as it lands (its damage effects; before the rules that bend it).
export const blowOn = (battle, u, a, x) => {
  const s = stats(battle, u)
  let d = 0
  for (const e of a.effects) if (e.op === 'damage') d += hit(battle, s, x, e.power)
  return d
}

// A board a turn's orders leave (`battle`, a copy of `from` with them given, End Turn not yet), read as the features
// its decision weighs (TUNING.expert.battle.board) and its tree reads (TREES.board): your souls' HP (`hp`) and your
// shadows' and summons' (`shadows`); the foes' HP (`foeHp`) and the max HP of each standing (`foes`); what the foes
// could deal your pieces next turn where they stand (`danger`, by the danger map) and the max HP of those it could fell
// (`falls`); what they could deal the Monarch (`monarch`), `doom` 1 where that fells it, and the foes whose road into
// it nothing of yours holds (`open`); the essence spent this turn (`spent`); the tiles your pieces came nearer the
// nearest foe this turn (`closer`, walking: gap), and nearer the tiles the plan's target formation gives them
// (`progress`: plan.js, from.plan); the Monarch's shooters the plan read (from.plan.shooters: plan.js shootersOf) still
// standing (`shooters`); and the battle `won` or `lost`.
export function boardFeatures (battle, from = battle) {
  const v = {
    hp: 0, shadows: 0, foeHp: 0, foes: 0, danger: 0, falls: 0, monarch: 0, doom: 0, open: 0, spent: battle.spent - from.spent, won: 0, lost: 0, loss: 0, shadowLoss: 0, hit: 0,
    counters: 0, mended: 0, foeTicks: 0, ticks: 0, closer: 0, progress: 0, shooters: 0
  }
  if (battle.over) {
    v[battle.winner === 'party' ? 'won' : 'lost'] = 1
    return v
  }
  for (const uid of from.plan?.shooters ?? NONE) {
    const x = battle.byUid.get(uid)
    if (x && alive(x)) v.shooters++
  }
  const sit = situation(battle)
  for (const u of battle.units) {
    if (!alive(u)) continue
    if (u.side === 'foe') {
      v.foeHp += u.hp
      v.foes += u.maxHp
    } else if (u !== battle.monarch) {
      if (u.shadow) v.shadows += u.hp
      else v.hp += u.hp
      const d = dangerAt(battle, u, u.tile, sit.map)
      v.danger += d
      if (d >= u.hp) v.falls += u.maxHp
    }
  }
  const picks = []
  const t = losses(battle, assign(battle, sit.threat.foes, sit.threat.d, new Map(), NOBODY, picks), new Map())
  v.loss = t.souls
  v.shadowLoss = t.shadows
  v.hit = t.monarch
  // The counters yours would draw from the foes' melee blows (each foe's once, on whom assign says), where they stand
  // through it.
  for (const [f, y, n, left] of picks) {
    if (!f.melee || y === battle.monarch || n >= left || hexed(y) || !y.basic?.melee) continue
    const s = stats(battle, y)
    let d = 0
    for (const e of y.basic.effects) if (e.op === 'damage') d += hit(battle, s, f.x, e.power)
    v.counters += Math.min(d, f.x.hp)
  }
  // What the foes' healers would mend next turn (each its most wounded in reach), and the statuses' ticks at the turn's end.
  for (const amounts of sit.healing.healers) {
    let most = 0
    for (const [x, n] of amounts) most = Math.max(most, Math.min(n, x.maxHp - x.hp))
    v.mended += most
  }
  for (const u of battle.units) {
    if (!alive(u)) continue
    const n = dotOn(u)
    if (u.side === 'foe') v.foeTicks += Math.min(n, u.hp)
    else if (u !== battle.monarch) v.ticks += Math.min(n, u.hp)
  }
  // The tiles your pieces came nearer the nearest foe this turn, summed (the press's: a battle is ended by coming on).
  for (const u of from.units) {
    if (u.side !== 'party' || u === from.monarch || !orderable(from, u)) continue
    const now = battle.byUid.get(u.uid)
    if (!now || !alive(now)) continue
    const before = gap(from, u, u.tile)
    const after = gap(battle, now, now.tile)
    if (Number.isFinite(before) && Number.isFinite(after)) v.closer += before - after
    const field = from.plan?.goals.get(u.uid)?.field
    if (field && Number.isFinite(field[u.tile]) && Number.isFinite(field[now.tile])) v.progress += field[u.tile] - field[now.tile]
  }
  if (sit.monarch) {
    v.monarch = Math.min(sit.monarch.hp, sit.monarch.danger)
    v.doom = sit.monarch.lethal ? 1 : 0
    v.open = sit.roads.reduce((n, r) => n + (r.held === null ? r.foes.length : 0), 0)
  }
  return v
}
