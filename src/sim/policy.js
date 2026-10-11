// The one policy (redesign.md §2.9), both sides: enumerate a unit's options (where it may stand, then what it may do
// from there), score each by one function, commit the best, and go on to the next unit on the board as it now stands.
// The camp plays its whole turn so (foeTurn), each kind by its temperament; the expert plays yours so, one round ahead
// (greedyTurn), or searching over such plays two rounds ahead (expertTurn: redesign.md §2.17). Nothing reads a seed:
// the same board gives the same turn.
import { TUNING } from '../tuning.js'
import { STATUS_WORTH, statusDef } from '../content.js'
import { alive, enemySide, isBlow, isAllyShape, footprint, tileX, tileY, blowReach, unitDistance, distanceBetween, TILES, LANES, DEPTH } from './unit.js'
import { LANE, roadOf } from './field.js'
import {
  stats, emit, computeDamage, fork, order, reach, roadAhead, targetsFrom, usable, canAct, hexed, perform, walk, aloft, helped, shape, impatience,
  orderable, isSkill, counterOf, fusionsOf, rateOf
} from './turns.js'
import { call } from './rules.js'

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
  // then (at the rate turns.js rateOf gives it) counts. The foes, read in your turn, act before it.
  const later = dealer === 'party' && battle.stage !== 'party'
  const g = new Array(TILES)
  const a = new Array(TILES)
  for (const u of battle.units) {
    if (u.side !== dealer || !alive(u) || u === battle.monarch || stunned(u, later)) continue
    const rate = later ? rateOf(battle, u) : 0
    const blows = u.kit.filter((x) => isBlow(x) && (!isSkill(u, x) || (u.cooldowns[x.id] ?? 0) <= rate))
    if (!blows.length) continue
    const spots = dealer === 'foe' ? roadAhead(battle, u, u.move).map((s) => s.tile)
      : orderable(battle, u) ? [u.tile, ...reach(battle, u, u.move).keys()] : [u.tile]
    g.fill(0)
    a.fill(0)
    for (const b of blows) {
      const raw = rawOf(battle, u, b)
      if (!(raw > 0)) continue
      const r = blowReach(u, b)
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

const ZERO = { dealt: 0, kill: 0, counter: 0 }
// A status laid on `x` (it always lands): its worth, nothing where `x` holds it already at its full stacks (it would
// only last longer).
const statusWorth = (e, x) => {
  const had = x.statuses.find((s) => s.id === e.status)
  return had && had.stacks >= statusDef(e.status).stacks ? 0 : STATUS_WORTH[e.status] ?? 0
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
      const missing = x === battle.monarch && battle.unhealable ? 0 : x.maxHp - x.hp
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

// How the expert weighs an option: bold enough to trade, careful of what it would take, the most wounded foe first.
const EXPERT = { aggression: 1, caution: 1, prey: 'wounded' }

// How the expert weighs a board played ahead (value) and how widely it searches (expertTurn; redesign.md §2.17).
// Placeholders for the balance pass, kept here while tuning.js is another's (TUNING.policy.plan, once it is free):
//   carry    a soul's HP lost weighs 1 + carry (a foe's, a shadow's and a summon's 1): its wounds leave the battle with
//            it, and a fallen soul lies fallen until an altar
//   monarch  the Monarch's HP lost weighs this (its fall, the run's end, is weighed apart)
//   threat   the share of what the foes could deal yours on their coming turn, at the horizon, counted as lost
//   brink    how much dearer a unit's HP is the nearer its fall (standing)
//   drive    the share of the damage a turn's orders deal that counts again, beyond what is left of it at the horizon:
//            a battle is won only by felling, and a foe that mends it back spends its acts so (no clock hurries you,
//            so without it a search would wait out a foe it cannot fell within two rounds, for ever)
//   essence  HP an essence spent is worth: an in-battle fusion's price, weighed against what the fusion leaves
//   focus    foes a focus plan is made for, at most; arise: corpses a raising plan is made for, at most, a holder
//   beam     the plans played on into the second round, the best after the first
export const PLAN = { carry: 0.5, monarch: 3, threat: 0.5, brink: 0.5, drive: 0.5, essence: 1, focus: 3, arise: 3, beam: 6 }

// The expert's turn (redesign.md §2.17): a search over candidate plans, each a whole turn of orders made on its own
// copy of the battle, judged by two rounds played ahead on that copy. The candidates:
//   - the greedy pass (pass): each piece in turn commits its best option by the one score (choose, the danger map made
//     again before each), in three orders (the most constrained first, the strongest first, the nearest a foe first),
//     and once more striking from where each stands;
//   - End Turn alone;
//   - holding back: the greedy pass with each piece kept out of the danger map, unless its act kills (safe);
//   - screening the Monarch (screen): the toughest pieces onto the tiles beside its seat that the foes' roads come in by;
//   - focus fire (focus), for each foe two or more pieces could strike (focusOn: at most PLAN.focus);
//   - each fusion a piece may make where it stands, made first (none with `fuse` false: the fusions ablation's), and
//     each corpse an Arise holder could raise (raises: at most PLAN.arise a holder), raised first; then the greedy pass.
// Plans that leave the same board are judged once (boardKey). Each is played on its copy through End Turn (the foes'
// turn), and the PLAN.beam best by then (value) go on: your next turn by the greedy pass and the foes' turn again. Of
// those, the one that leaves the best board is given, the first on a tie: value, the HP traded (a unit nearer its fall
// dearer, a soul's wounds dearer than a foe's as they leave the battle with it, the Monarch's dearest), the essence
// spent, the damage dealt now, and what yours stand to lose on the foes' next turn. It reads the board and plays the
// camp's turn as the camp would (foeTurn, deterministic), nothing else: the same board, the same orders. Its cost a
// turn: about a dozen greedy passes and copies played through a foes' turn, and PLAN.beam passes and turns more.
export function expertTurn (battle, { fuse = true } = {}) {
  if (battle.over) return []
  const p = press(battle)
  const plans = []
  const seen = new Set()
  const make = (build) => {
    const f = fork(battle)
    const orders = build(f)
    const key = boardKey(f)
    if (seen.has(key)) return
    seen.add(key)
    plans.push({ orders, f, dealt: dealtOn(battle, f), v: 0 })
  }
  // The greedy pass in each order of the pieces that is not one already passed.
  const queues = new Set()
  for (const rank of [room, might, near]) {
    const key = queue(battle, rank, true).map((u) => u.uid).join()
    if (queues.has(key)) continue
    queues.add(key)
    make((f) => pass(f, p, { rank }))
  }
  make((f) => pass(f, p, { moving: false }))
  make(() => [])
  make((f) => pass(f, p, { keep: safe }))
  make((f) => screen(f, p))
  for (const uid of focusOn(battle)) make((f) => focus(f, p, f.byUid.get(uid)))
  if (fuse) for (const u of battle.units) if (canAct(battle, u)) for (const o of fusionsOf(battle, u)) make((f) => [give(f, o), ...pass(f, p)])
  for (const [uid, corpse] of raises(battle)) {
    make((f) => {
      const u = f.byUid.get(uid)
      return [...commit(f, u, choose(f, u, EXPERT, p, danger(f, 'party'), options(f, u).filter((o) => o.ability?.shape === 'corpse' && o.target.uid === corpse))), ...pass(f, p)]
    })
  }
  // Round one, the foes' turn, for every plan; round two, your turn and theirs, for the PLAN.beam best by then.
  for (const c of plans) {
    end(c.f)
    c.v = value(battle, c.f, c.dealt)
  }
  const beam = new Set(plans.slice().sort((a, b) => b.v - a.v || plans.indexOf(a) - plans.indexOf(b)).slice(0, PLAN.beam))
  let best = null
  for (const c of plans) {
    if (!beam.has(c)) continue
    if (!c.f.over) {
      pass(c.f, press(c.f))
      end(c.f)
    }
    c.v = value(battle, c.f, c.dealt)
    if (best === null || c.v > best.v) best = c
  }
  return [...best.orders, { type: 'end' }]
}

// The quick expert (the autoplayer's rehearsals: autoplay.js LEVELS `rehearsal`; the expert's turn before it planned
// ahead): two greedy passes on copies of the battle (pass: one moving as it likes, one striking from where each stands),
// and with `fuse`, one more for each fusion a piece may make where it stands, that fusion first; each, and End Turn
// alone, played through the foes' turn on a copy (ahead), and the one that leaves the best trade given, the first on a
// tie. Its cost a turn: two greedy passes and three copies played through a foes' turn, and a pass and a copy a fusion.
export function greedyTurn (battle, { fuse = true } = {}) {
  if (battle.over) return []
  const p = press(battle)
  const plans = [plan(battle, p, true), plan(battle, p, false), []]
  if (fuse) for (const u of battle.units) if (canAct(battle, u)) for (const o of fusionsOf(battle, u)) plans.push(plan(battle, p, true, o))
  let best = null
  let top = -Infinity
  for (const orders of plans) {
    const v = ahead(battle, orders)
    if (v > top) {
      best = orders
      top = v
    }
  }
  return [...best, { type: 'end' }]
}

// A greedy plan on a copy, `first` (a fusion) given before it.
function plan (battle, p, moving, first = null) {
  const f = fork(battle)
  const out = first ? [give(f, first)] : []
  out.push(...pass(f, p, { moving, approach: false }))
  return out
}

// The greedy pass on copy `f`: each piece of yours that has not acted, in `rank`'s order (the lowest first; by default
// the most constrained, the fewest options, first; ties by acting order), commits its best option (choose, the danger
// map from the foes' coming turn made again before each), moving as it likes unless `moving` is false. `keep` (f, u,
// option, map) narrows a piece's options to those it passes, where any does; with `approach` (the planner's, not the
// quick expert's), a piece that can strike no foe comes on (closer). → its orders, given on `f`.
function pass (f, p, { moving = true, rank = room, keep = null, approach = true } = {}) {
  const out = []
  for (const u of queue(f, rank, moving)) {
    if (f.over) break
    if (!orderable(f, u) || u.acted) continue
    const map = danger(f, 'party')
    let opts = options(f, u, { moving })
    if (keep) {
      const kept = opts.filter((o) => keep(f, u, o, map))
      if (kept.length) opts = kept
    }
    const best = choose(f, u, EXPERT, p, map, opts)
    out.push(...commit(f, u, approach && !opts.some((o) => o.ability && isBlow(o.ability) && o.target.side !== u.side) ? closer(f, u, best, opts, map) : best))
  }
  return out
}

// A piece that can strike no foe this turn, wherever it goes, still comes on: of its options doing what its best does
// (the same act at the same target, or holding), the one ending nearest a foe, then the one it would take least at
// (dangerAt), then the fewest steps. (The one score gives a move no worth by itself: a piece left alone where nothing
// reaches it would stand idle the battle through.)
function closer (f, u, best, opts, map) {
  let out = best
  let key = null
  for (const o of opts) {
    if (o.ability !== best.ability || o.target !== best.target) continue
    const k = [gap(f, u, o.tile), dangerAt(f, u, o.tile, map), o.path.length]
    if (key === null || k[0] < key[0] || (k[0] === key[0] && (k[1] < key[1] || (k[1] === key[1] && k[2] < key[2])))) {
      out = o
      key = k
    }
  }
  return out
}

// How far `u` standing on `tile` would be from the nearest living foe (Chebyshev, footprints counted).
const gap = (f, u, tile) => f.units.reduce((d, x) => (x.side !== u.side && alive(x) ? Math.min(d, distanceBetween(tile, u.size, x.tile, x.size)) : d), Infinity)

// The pieces of yours that have not acted, in `rank`'s order (the lowest first; ties by acting order).
function queue (f, rank, moving) {
  const pieces = f.units.filter((u) => orderable(f, u) && !u.acted)
  const key = new Map(pieces.map((u) => [u, rank(f, u, moving)]))
  return pieces.sort((a, b) => key.get(a) - key.get(b) || a.ord - b.ord)
}

// The pass's orders: the most constrained first (room), the strongest first (might: its hardest blow's raw), the
// nearest a foe first (near).
const room = (f, u, moving) => options(f, u, { moving }).length
const might = (f, u) => -menace(f, u)
const near = (f, u) => f.units.reduce((d, x) => (x.side === 'foe' && alive(x) ? Math.min(d, unitDistance(u, x)) : d), Infinity)
// Holding back: an option out of the danger map, or one whose act kills.
const safe = (f, u, o, map) => dangerAt(f, u, o.tile, map) === 0 || estimate(f, u, o, NOBODY).kill > 0
// A unit's hardest blow, raw (rawOf).
const menace = (battle, u) => u.kit.reduce((n, b) => (isBlow(b) ? Math.max(n, rawOf(battle, u, b)) : n), 0)

// Option `best` of piece `u` given on `f`: its move, then its act. → the orders.
function commit (f, u, best) {
  const out = []
  if (best.tile !== u.tile) out.push(give(f, { type: 'move', uid: u.uid, tile: best.tile }))
  if (best.ability && !f.over) out.push(give(f, { type: 'act', uid: u.uid, ability: best.ability.id, target: best.target.uid }))
  return out
}

const give = (f, o) => {
  order(f, o)
  return o
}

const end = (f) => {
  if (!f.over) order(f, { type: 'end' })
}

// What blow `a` of `u` would deal `x` as it lands (its damage effects; before the rules that bend it).
const blowOn = (battle, u, a, x) => {
  const s = stats(battle, u)
  let d = 0
  for (const e of a.effects) if (e.op === 'damage') d += hit(battle, s, x, e.power)
  return d
}

// The foes worth a focus plan: each that two or more of your pieces could strike this turn (from anywhere their Move
// takes them), those the pieces could fell together first (each piece's hardest blow at it summed), then the most
// dangerous for their HP (menace over HP), then by uid; at most PLAN.focus. → uids.
function focusOn (battle) {
  const by = new Map()
  for (const u of battle.units) {
    if (!orderable(battle, u) || !canAct(battle, u)) continue
    const best = new Map()
    for (const o of options(battle, u)) {
      if (!o.ability || !isBlow(o.ability) || o.target.side === u.side) continue
      best.set(o.target, Math.max(best.get(o.target) ?? 0, blowOn(battle, u, o.ability, o.target)))
    }
    for (const [x, d] of best) by.set(x, [...(by.get(x) ?? []), d])
  }
  return [...by].filter(([, ds]) => ds.length >= 2)
    .map(([x, ds]) => ({ x, fells: ds.reduce((n, d) => n + d, 0) >= x.hp ? 1 : 0, threat: menace(battle, x) / x.hp }))
    .sort((a, b) => b.fells - a.fells || b.threat - a.threat || a.x.uid - b.x.uid)
    .slice(0, PLAN.focus).map((e) => e.x.uid)
}

// Focus fire on `foe` on copy `f`: of the pieces that could strike it, the fewest whose best blows at it (choose among
// those) would fell it together, the hardest-hitting first (all of them where none would, to wound it most), each
// striking it, the ranged first and the melee last (a blow that fells draws no counter); then the rest by the greedy
// pass. → its orders.
function focus (f, p, foe) {
  const at = (u) => options(f, u).filter((o) => o.target === foe && o.ability && isBlow(o.ability))
  const map = danger(f, 'party')
  const strikers = []
  for (const u of f.units) {
    if (!orderable(f, u) || !canAct(f, u)) continue
    const opts = at(u)
    if (!opts.length) continue
    const best = choose(f, u, EXPERT, p, map, opts)
    strikers.push({ u, d: blowOn(f, u, best.ability, foe), melee: best.ability.melee ? 1 : 0 })
  }
  strikers.sort((a, b) => b.d - a.d || a.u.ord - b.u.ord)
  let k = 0
  for (let dealt = 0; k < strikers.length && dealt < foe.hp; k++) dealt += strikers[k].d
  const out = []
  for (const { u } of strikers.slice(0, k).sort((a, b) => a.melee - b.melee || b.d - a.d || a.u.ord - b.u.ord)) {
    if (f.over || !alive(foe)) break
    if (!orderable(f, u) || !canAct(f, u)) continue
    const opts = at(u)
    if (opts.length) out.push(...commit(f, u, choose(f, u, EXPERT, p, danger(f, 'party'), opts)))
  }
  out.push(...pass(f, p))
  return out
}

// Screening the Monarch on copy `f`: the tiles beside its seat by which the living foes' roads come in (a ground foe's
// Walk road, a flyer's air road; a piece of yours on the ground stops either: turns.js roadAhead), the most travelled
// first, each one still free taken by the toughest piece on the ground that can reach it (its HP over the share of a
// blow it takes: mitigation), which then acts from there as it likes best; then the rest by the greedy pass. → its
// orders (the greedy pass's alone with no Monarch, or no road in).
function screen (f, p) {
  const out = []
  const m = f.monarch
  const count = new Map()
  if (m && alive(m)) {
    for (const x of f.units) {
      if (x.side !== 'foe' || !alive(x)) continue
      const road = roadOf(f, x)
      for (let t = x.tile, k = 0; t >= 0 && road.dist[t] >= 1 && k < TILES; t = road.arrow[t], k++) {
        if (road.dist[t] !== 1) continue
        count.set(t, (count.get(t) ?? 0) + 1)
        break
      }
    }
  }
  for (const [t] of [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
    if (f.over) break
    if (f.at[t] !== null) continue
    let best = null
    let hardest = -1
    for (const u of f.units) {
      if (!orderable(f, u) || u.acted || u.size > 1 || u.flies || !reach(f, u).has(t)) continue
      const h = u.hp / mitigation(f, u)
      if (h > hardest) {
        best = u
        hardest = h
      }
    }
    if (!best) continue
    const there = options(f, best).filter((o) => o.tile === t)
    if (there.length) out.push(...commit(f, best, choose(f, best, EXPERT, p, danger(f, 'party'), there)))
  }
  out.push(...pass(f, p))
  return out
}

// The raising plans: for each piece that may Arise now, each corpse it could raise this turn (from anywhere its Move
// takes it), the biggest first (max HP, then uid), at most PLAN.arise. → [[uid, corpse uid]].
function raises (battle) {
  const out = []
  for (const u of battle.units) {
    if (!orderable(battle, u) || !canAct(battle, u) || !u.kit.some((a) => a.shape === 'corpse' && usable(battle, u, a))) continue
    const seen = new Set()
    for (const o of options(battle, u)) if (o.ability?.shape === 'corpse') seen.add(o.target)
    for (const x of [...seen].sort((a, b) => b.maxHp - a.maxHp || a.uid - b.uid).slice(0, PLAN.arise)) out.push([u.uid, x.uid])
  }
  return out
}

// A board, as far as what follows from it: where each unit stands, its HP, whether it has acted, its statuses and
// cooldowns, and the purse. Two plans that leave the same key play on alike.
const boardKey = (f) => f.units.map((u) => `${u.uid}@${u.tile}:${u.hp}${u.acted ? '!' : ''}${u.statuses.map((s) => `,${s.id}${s.stacks}/${s.dur}${s.fresh ? '+' : ''}`).join('')}|${Object.entries(u.cooldowns).map(([k, n]) => k + n).join()}`).join(';') + `#${f.purse}`

// A board played ahead (`f`, a copy of `battle`), weighed for your side: the HP the foes lost (a slain one its max HP
// more; standing), less the HP yours lost likewise, a soul's weighing 1 + PLAN.carry, a shadow's or a summon's 1, and the
// Monarch's by guard (the nearer its fall, the dearer each HP). A unit made meanwhile counts from nothing (a shadow
// risen or a fused piece of yours: gained; a shadow of theirs: theirs), a foe come in from the reserve from its whole
// HP, and a soul fused away as fallen; so a fusion is weighed by what it leaves on the board for what it took, less its
// price (PLAN.essence an essence spent). Then PLAN.drive of `dealt`, the damage this turn's orders dealt (expertTurn),
// and less PLAN.threat of what each of yours would lose to what the foes could deal it on their coming turn (danger,
// weighed as its HP lost is). A lost battle is −1e12; a won one 1e9 more, by what it leaves.
function value (battle, f, dealt = 0) {
  if (f.over && f.winner !== 'party') return -1e12
  let v = PLAN.drive * dealt
  for (const c of f.units) {
    const u = battle.byUid.get(c.uid)
    if (c === f.monarch) {
      v -= guard(u, u.hp) - guard(c, Math.max(0, c.hp))
      continue
    }
    const before = u ? standing(u) : c.side === 'foe' && battle.reserve.some((r) => r.uid === c.uid) ? 2 * c.maxHp : 0
    const lost = before - standing(c)
    if (c.side === 'foe') v += lost
    else v -= lost * (c.shadow ? 1 : 1 + PLAN.carry)
  }
  v -= (f.spent - battle.spent) * PLAN.essence
  if (f.over) return 1e9 + v
  // What the foes could take on their coming turn, from where yours stand.
  const map = danger(f, 'party')
  for (const c of f.units) {
    if (c.side !== 'party' || !alive(c)) continue
    const d = dangerAt(f, c, c.tile, map)
    if (!(d > 0)) continue
    if (c === f.monarch) v -= PLAN.threat * (guard(c, c.hp) - guard(c, c.hp - d))
    else v -= PLAN.threat * (standing(c) - standing({ hp: c.hp - d, maxHp: c.maxHp })) * (c.shadow ? 1 : 1 + PLAN.carry)
  }
  return v
}

// What a unit standing is worth, in HP: its HP and its max HP more (what felling it takes from its side), less
// PLAN.brink of its max HP × the square of the share it has lost (the nearer its fall, the dearer each HP: blows
// gathered on one foe are worth more than the same spread, and wounds spread over yours cost less than on one). 0 fallen.
const standing = (u) => (alive(u) ? u.hp + u.maxHp - PLAN.brink * u.maxHp * (1 - u.hp / u.maxHp) ** 2 : 0)

// What the Monarch standing at `hp` is worth: PLAN.monarch × its max HP × (3x − x²), x its share of HP; so an HP of its
// weighs PLAN.monarch while it is whole, thrice that as it is about to fall.
const guard = (m, hp) => {
  const x = hp / m.maxHp
  return PLAN.monarch * m.maxHp * (3 * x - x * x)
}

// The damage the orders given on `f` dealt the foes (each foe's HP lost, as `battle` had it).
const dealtOn = (battle, f) => f.units.reduce((n, c) => {
  const u = c.side === 'foe' ? battle.byUid.get(c.uid) : null
  return u && alive(u) ? n + u.hp - Math.max(0, c.hp) : n
}, 0)

// A turn's orders played on a copy through End Turn (the foes' turn among it), for the quick expert (greedyTurn): the
// HP the foes lost (a slain one its whole max HP more) less the HP yours lost (a fallen one likewise; the Monarch's
// thrice), or the verdict if the battle ends. A piece of yours made meanwhile (a shadow risen, a fused piece) counts as
// it stands, gained, and a piece fused away as fallen: so a fusion is weighed by what it leaves on the board for what
// it took. A foe come in meanwhile (a wave, a shadow of theirs) is not weighed.
function ahead (battle, orders) {
  const f = fork(battle)
  for (const o of orders) if (!f.over) order(f, o)
  if (!f.over) order(f, { type: 'end' })
  if (f.over) return f.winner === 'party' ? 1e12 : -1e12
  let v = 0
  for (const c of f.units) {
    const u = battle.byUid.get(c.uid)
    if (u ? !alive(u) : c.side === 'foe') continue
    const lost = (u ? u.hp + u.maxHp : 0) - (alive(c) ? c.hp + c.maxHp : 0)
    v += c.side === 'foe' ? lost : -lost * (c === f.monarch ? 3 : 1)
  }
  return v
}
