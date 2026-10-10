// The one policy (redesign.md §2.9), both sides: enumerate a unit's options (where it may stand, then what it may do
// from there), score each by one function, commit the best, and go on to the next unit on the board as it now stands.
// The camp plays its whole turn so (foeTurn), each kind by its temperament; the expert plays yours so (expertTurn).
// Nothing reads a seed: the same board gives the same turn.
import { TUNING } from '../tuning.js'
import { STATUS_WORTH, statusDef } from '../content.js'
import { stats, emit, LANE, roadOf, computeDamage } from './battle.js'
import { alive, enemySide, isBlow, isAllyShape, footprint, distanceBetween, tileX, tileY, TILES, LANES, DEPTH } from './unit.js'
import {
  fork, order, reach, roadAhead, targetsFrom, usable, canAct, hexed, perform, walk, reachOf, aloft, helped, shape, deadline, orderable,
  isSkill
} from './turns.js'

// ── the danger map (§2.9.2) ──────────────────────────────────────────────────────────────────────

// By tile, how much the other side could deal on its next turn to one of `side`'s standing there, before that one's
// DEF (dangerAt counts it): each unit of the other side, from every tile it could stand on next turn (a piece of
// yours anywhere its Move reaches, a summon or a shadow where it stands, a foe along its road), its best blow that will
// be ready (a basic, or a skill off cooldown by then) at that tile, summed over the units. → { ground, air }: the air
// for a flyer standing there (a melee blow from the ground never reaches one). The Monarch deals nothing; a unit
// whose next act Hexed takes deals nothing.
export function danger (battle, side) {
  const dealer = enemySide(side)
  const ground = new Array(TILES).fill(0)
  const air = new Array(TILES).fill(0)
  // Yours, read in the foes' turn or at its end, act next after a turn's end: a skill whose cooldown falls to 0 by
  // then counts. The foes, read in your turn, act before it.
  const later = dealer === 'party' && battle.stage !== 'party'
  const g = new Array(TILES)
  const a = new Array(TILES)
  for (const u of battle.units) {
    if (u.side !== dealer || !alive(u) || u === battle.monarch || stunned(u, later)) continue
    const rate = later ? Math.max(1, Math.round(stats(battle, u).cooldown.rate)) : 0
    const blows = u.kit.filter((x) => isBlow(x) && (!isSkill(u, x) || (u.cooldowns[x.id] ?? 0) <= rate))
    if (!blows.length) continue
    const spots = dealer === 'foe' ? roadAhead(battle, u, u.move).map((s) => s.tile)
      : orderable(battle, u) ? [u.tile, ...reach(battle, u, u.move).keys()] : [u.tile]
    g.fill(0)
    a.fill(0)
    for (const b of blows) {
      const raw = rawOf(battle, u, b)
      if (!(raw > 0)) continue
      const r = reachOf(u, b)
      const ra = aloft(u, b, r)
      for (const t of spots) {
        dilate(g, t, u.size, r, raw)
        if (ra >= 0) dilate(a, t, u.size, ra, raw)
      }
    }
    for (let t = 0; t < TILES; t++) {
      ground[t] += g[t]
      air[t] += a[t]
    }
  }
  return { ground, air }
}

// Whether a Hexed `u` will lose its next act (`later`: it acts after a turn's end, where a Hexed of a turn runs out).
const stunned = (u, later) => hexed(u) && (!later || u.statuses.some((s) => s.id === 'hexed' && (s.fresh || s.dur === 'battle' || s.dur > 1)))

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
function rawOf (battle, u, b) {
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
// its HP (a fall is the most it can lose).
export function dangerAt (battle, u, tile, map) {
  const list = u.flies ? map.air : map.ground
  let raw = 0
  for (const t of footprint(tile, u.size) ?? [tile]) raw = Math.max(raw, list[t])
  return Math.min(u.hp, raw * mitigation(battle, u))
}

// ── the pressure (§2.9.1) ────────────────────────────────────────────────────────────────────────

// The camp's pressure, 0 to 1: the clock's share from the first turn to the cap (deadline), nudged by
// TUNING.policy.press.strength toward the trade the camp could make: up when its foes could deal more to your pieces
// in their reach than yours to them, down when less. At the cap it is 1, whatever the trade. `maps` may carry the
// danger maps already made ({ party, foe }: danger to each side).
export function press (battle, maps = {}) {
  const end = deadline(battle)
  const clock = end > 1 ? (battle.turn - 1) / (end - 1) : 1
  if (clock >= 1) return 1
  const theirs = onSide(battle, 'party', maps.party ?? danger(battle, 'party'))
  const ours = onSide(battle, 'foe', maps.foe ?? danger(battle, 'foe'))
  const nudge = (theirs - ours) / Math.max(1, theirs + ours)
  return Math.min(1, Math.max(0, clock + TUNING.policy.press.strength * nudge))
}

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
// dealt: damage (as far as each target's HP), HP mended, a status's worth (STATUS_WORTH, by its chance); taken: the
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

// A blow of `power` from `a` (stats) on `x`: deterministic, as it lands with no dice (before the rules that bend it).
const hit = (battle, a, x, power) => {
  const d = stats(battle, x)
  return computeDamage({ power, atk: a.atk, def: d.def, isCrit: false, variance: 1, mul: a.damage.dealt * d.damage.taken })
}

const ZERO = { dealt: 0, kill: 0, counter: 0 }
// A status laid on `x`: its worth by its chance, nothing where `x` holds it already at its full stacks (it would only
// last longer).
const statusWorth = (e, x) => {
  const had = x.statuses.find((s) => s.id === e.status)
  return had && had.stacks >= statusDef(e.status).stacks ? 0 : (STATUS_WORTH[e.status] ?? 0) * (e.chance ?? 1)
}
const debuff = (id) => statusDef(id).tags.includes('debuff')

// What an option would do, read off the board without playing it: { dealt, kill, counter } (score).
function estimate (battle, u, o, prey) {
  const a = o.ability
  if (!a) return ZERO
  if (a.shape === 'corpse') return { dealt: o.target.maxHp, kill: 0, counter: 0 }
  const s = stats(battle, u)
  // The actor where it would stand, for the shapes that measure from it.
  const at = { uid: u.uid, side: u.side, tile: o.tile, size: u.size, flies: u.flies }
  const targets = shape(battle, at, a, o.target).map((x) => (x === at ? u : x))
  let dealt = 0
  let kill = 0
  let primary = 0
  for (const x of targets) {
    if (x.side !== u.side) {
      let d = 0
      for (const e of a.effects) if (e.op === 'damage') d += hit(battle, s, x, e.power)
      if (x === o.target) primary = d
      dealt += Math.min(d, x.hp) * (prey.has(x) ? 1.5 : 1)
      if (d >= x.hp) kill += worth(battle, x)
      else for (const e of a.effects) if (e.op === 'apply_status' && debuff(e.status)) dealt += statusWorth(e, x)
    } else {
      const missing = x === battle.monarch && battle.held.unhealable ? 0 : x.maxHp - x.hp
      for (const e of a.effects) {
        if (e.op === 'heal' && !e.self) dealt += Math.min(missing, e.pct ? x.maxHp * e.pct : e.power * s.atk / TUNING.damage.atkDivisor * s.heal.given)
        else if (e.op === 'cleanse') dealt += x.statuses.filter((st) => statusDef(st.id).tags.includes(e.tag)).slice(0, e.count).reduce((n, st) => n + (STATUS_WORTH[st.id] ?? 0), 0)
        else if (e.op === 'apply_status' && !debuff(e.status)) dealt += statusWorth(e, x)
      }
    }
  }
  for (const e of a.effects) if (e.op === 'heal' && e.self) dealt += Math.min(u.maxHp - u.hp, e.power * s.atk / TUNING.damage.atkDivisor * s.heal.given)
  return { dealt, kill, counter: isBlow(a) && a.melee && primary < o.target.hp ? answer(battle, u, o) : 0 }
}

// The counter a melee blow from `o.tile` would draw from its target (turns.js counterOf, measured from there).
function answer (battle, u, o) {
  const x = o.target
  const b = x.basic
  if (x === battle.monarch || hexed(x) || !b?.melee || (u.flies && !x.flies)) return 0
  if (distanceBetween(o.tile, u.size, x.tile, x.size) > reachOf(x, b)) return 0
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
  const list = [...new Set(blows.map((o) => o.target))]
  if (!list.length) return NOBODY
  if (kind === 'monarch') return new Set(list.filter((x) => x === battle.monarch))
  if (kind === 'crowd') {
    let most = 0
    let out = new Set()
    for (const o of blows) {
      const n = shape(battle, { uid: u.uid, side: u.side, tile: o.tile, size: u.size, flies: u.flies }, o.ability, o.target).filter((x) => x.side !== u.side).length
      if (n > most) {
        most = n
        out = new Set([o.target])
      } else if (n === most) out.add(o.target)
    }
    return out
  }
  const key = PREY[kind] ?? PREY.weakest
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
// ties by lane, then uid) commits its best option (choose) on the board as it stands after the ones before it: its move
// along its road, then its act. Deterministic. → { orders, events } (orders as the player's are written).
export function foeTurn (battle) {
  const from = battle.events.length
  const out = []
  const maps = { foe: danger(battle, 'foe') }
  const p = press(battle, maps)
  const dist = (u) => roadOf(battle, u).dist[u.tile]
  const queue = battle.units.filter((u) => u.side === 'foe' && alive(u))
    .sort((a, b) => dist(a) - dist(b) || LANE[tileX(a.tile)] - LANE[tileX(b.tile)] || a.uid - b.uid)
  for (const u of queue) {
    if (battle.over) break
    if (!alive(u)) continue
    const best = choose(battle, u, u.temper, p, maps.foe)
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

// The basic player: End Turn, every turn (the old autobattle, without skills).
export const basicTurn = () => [{ type: 'end' }]

// How the expert weighs: bold enough to trade, careful of what it would take, the most wounded foe first.
const EXPERT = { aggression: 1, caution: 1, prey: 'wounded' }

// The expert's turn (§5 shared contract): the one score for your side, greedy piece by piece, then the turn played
// ahead. Two plans are made on copies of the battle, one moving as it likes and one striking from where each stands,
// each piece in the order most constrained first (fewest options) committing its best option (choose, the danger map
// from the foes' coming turn made again before each piece); the two and End Turn alone are each played through the
// foes' turn on a copy (ahead), and the one that leaves the best trade is given. Its cost a turn: two greedy passes
// (a danger map and every option of each piece scored, one by one) and three copies played through a foes' turn.
export function expertTurn (battle) {
  if (battle.over) return []
  const p = press(battle)
  let best = null
  let value = -Infinity
  for (const orders of [plan(battle, p, true), plan(battle, p, false), []]) {
    const v = ahead(battle, orders)
    if (v > value) {
      best = orders
      value = v
    }
  }
  return [...best, { type: 'end' }]
}

function plan (battle, p, moving) {
  const f = fork(battle)
  const out = []
  const pieces = f.units.filter((u) => orderable(f, u) && !u.acted)
  const room = new Map(pieces.map((u) => [u, options(f, u, { moving }).length]))
  pieces.sort((a, b) => room.get(a) - room.get(b) || a.ord - b.ord)
  for (const u of pieces) {
    if (f.over) break
    if (!orderable(f, u) || u.acted) continue
    const best = choose(f, u, EXPERT, p, danger(f, 'party'), options(f, u, { moving }))
    if (best.tile !== u.tile) out.push(give(f, { type: 'move', uid: u.uid, tile: best.tile }))
    if (best.ability && !f.over) out.push(give(f, { type: 'act', uid: u.uid, ability: best.ability.id, target: best.target.uid }))
  }
  return out
}

const give = (f, o) => {
  order(f, o)
  return o
}

// A turn's orders played on a copy through End Turn (the foes' turn among it): the HP the foes lost (a slain one its
// whole max HP more) less the HP yours lost (a fallen one likewise; the Monarch's thrice), or the verdict if the battle
// ends.
function ahead (battle, orders) {
  const f = fork(battle)
  for (const o of orders) if (!f.over) order(f, o)
  if (!f.over) order(f, { type: 'end' })
  if (f.over) return f.winner === 'party' ? 1e12 : -1e12
  let v = 0
  for (const u of battle.units) {
    if (!alive(u)) continue
    const c = f.byUid.get(u.uid)
    const lost = u.hp - Math.max(0, c.hp) + (alive(c) ? 0 : u.maxHp)
    v += u.side === 'foe' ? lost : -lost * (u === battle.monarch ? 3 : 1)
  }
  return v
}
