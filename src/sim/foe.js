// The camp's play, and what both sides read of the board: the danger map, the pressure, a unit's options and their
// scores, and the foes' turn; basicTurn is your side's plainest player. Nothing reads a seed. Shipped with the game
// (turns.js plays the foes by it; engine.js reads threatOf).
import { STATUS_WORTH, statusDef } from '../content.js'
import { TUNING } from '../tuning.js'
import { LANE, roadOf } from './field.js'
import { call } from './rules.js'
import { stats, emit, computeDamage, reach, roadAhead, roadTiles, targetsFrom, usable, canAct, hexed, perform, walk, moveMoment, aloft, helped, shape, impatience, orderable, isSkill, counterOf, rateOf, lined, struckBy, keyOn, lockShare, left, costOf, energyOf } from './turns.js'
import { alive, enemySide, isBlow, isAllyShape, footprint, tileX, tileY, blowReach, lineEnds, LINE_AT, LINE_TILES, TILES, LANES, DEPTH } from './unit.js'

// ── the danger map ───────────────────────────────────────────────────────────────────────────────

// By tile, what the other side could deal on its next turn to one of `side`'s standing there, before DEF. → { ground,
// air (for a flyer), shields: Map unit → { ground, air }, what that piece alone screens of lined blows }. `at` (Map uid
// → tile) fixes each foe's tile; `lines` false ignores lines of fire; `only` (distinct tiles) reads those tiles alone,
// the rest left 0 (each tile's reading is its own: the same numbers there); `steps` stands in for stepsOf (the same
// tiles and steps out: a book of them).
export function danger (battle, side, at = null, { lines = true, only = null, steps: stepsFn = stepsOf } = {}) {
  const dealer = enemySide(side)
  const ground = new Array(TILES).fill(0)
  const air = new Array(TILES).fill(0)
  const shields = new Map()
    // Yours, read in the foes' turn, act after a turn's end: a skill whose cooldown runs out by then counts.
  const later = dealer === 'party' && battle.stage !== 'party'
  const area = only && areaOf(only)
  const g = DANGER_G
  const a = DANGER_A
  for (const u of battle.units) {
    if (u.side !== dealer || !alive(u) || u === battle.monarch || stunned(u, later)) continue
    const rate = later ? rateOf(battle, u) : 0
    const blows = u.kit.filter((x) => isBlow(x) && (!isSkill(u, x) || (u.cooldowns[x.id] ?? 0) <= rate))
    if (!blows.length) continue
    if (only) {
      for (const t of only) {
        g[t] = 0
        a[t] = 0
      }
    } else {
      g.fill(0)
      a.fill(0)
    }
    const alone = new Map()
    // Its tiles at its longest stride, each with the steps it takes: a shorter stride's tiles are those within it.
    const raws = blows.map((b) => rawOf(battle, u, b))
    const ks = blows.map((b) => strideNext(battle, u, b))
    const most = blows.reduce((m, b, i) => (raws[i] > 0 ? Math.max(m, ks[i]) : m), -1)
    if (most < 0) continue
    const { tiles, steps } = stepsFn(battle, u, at, most)
    for (let i = 0; i < blows.length; i++) {
      const b = blows[i]
      const raw = raws[i]
      const k = ks[i]
      if (!(raw > 0) || k < 0) continue
      const r = blowReach(u, b)
      const ra = aloft(u, b, r)
      for (let j = 0; j < tiles.length && steps[j] <= k; j++) {
        const t = tiles[j]
        if (lines && lined(b)) {
          // A ranged blow reaches the air as the ground (aloft), on the same lines.
          sight(battle, side, t, u.size, r, raw, g, a, alone, area)
          continue
        }
        dilate(g, t, u.size, r, raw, area)
        if (ra >= 0) dilate(a, t, u.size, ra, raw, area)
      }
    }
    if (only) {
      for (const t of only) {
        ground[t] += g[t]
        air[t] += a[t]
      }
    } else {
      for (let t = 0; t < TILES; t++) {
        ground[t] += g[t]
        air[t] += a[t]
      }
    }
    for (const [y, list] of alone) {
      let w = null
      for (let i = 0, n = only ? only.length : TILES; i < n; i++) {
        const t = only ? only[i] : i
        const dg = list[t] - g[t]
        const da = list[t] - a[t]
        if (dg <= 0 && da <= 0) continue
        w ??= shields.get(y) ?? shields.set(y, { ground: new Array(TILES).fill(0), air: new Array(TILES).fill(0) }).get(y)
        if (dg > 0) w.ground[t] += dg
        if (da > 0) w.air[t] += da
      }
    }
  }
  return { ground, air, shields }
}

// Tiles read alone (danger's `only`) and the box that bounds them: a reach that misses the box reads none of them.
function areaOf (tiles) {
  let xa = LANES
  let xb = -1
  let ya = DEPTH
  let yb = -1
  for (const t of tiles) {
    xa = Math.min(xa, tileX(t))
    xb = Math.max(xb, tileX(t))
    ya = Math.min(ya, tileY(t))
    yb = Math.max(yb, tileY(t))
  }
  return { tiles, xa, xb, ya, yb }
}

// danger's scratch, one unit's reach at a time (nothing danger calls reads a danger map).
const DANGER_G = new Array(TILES).fill(0)
const DANGER_A = new Array(TILES).fill(0)

// Whether a Hexed `u` will lose its next act (`later`: it acts after a turn's end, where a Hexed of a turn runs out).
export const stunned = (u, later) => hexed(u) && (!later || u.statuses.some((s) => s.id === 'hexed' && (s.fresh || s.dur === 'battle' || s.dur > 1)))

// The tiles `u` could strike from on its side's next turn: a foe's road ahead within `tiles` (or the one tile `at`
// names; a sentry's own tile, which it holds), a piece of yours anywhere `tiles` reaches, a summon or a shadow where it
// stands (its End Turn walk unread).
const spotsOf = (battle, u, at, tiles) => u.side === 'foe' ? (at ? [at.get(u.uid) ?? u.tile] : u.hold ? [u.tile] : roadTiles(battle, u, tiles))
  : orderable(battle, u) ? [u.tile, ...reach(battle, u, tiles).keys()] : [u.tile]
// spotsOf's tiles, each with the steps it takes, the fewest first: a road's tile its place on the road, a reached
// tile its path's length. Those within k steps are spotsOf's at k (a road's first k + 1; reach's within k).
export function stepsOf (battle, u, at, tiles) {
  if (u.side === 'foe' || !orderable(battle, u)) {
    const list = spotsOf(battle, u, at, tiles)
    return { tiles: list, steps: list.map((t, i) => i) }
  }
  const list = [u.tile]
  const steps = [0]
  for (const [t, path] of reach(battle, u, tiles)) {
    list.push(t)
    steps.push(path.length)
  }
  return { tiles: list, steps }
}
// The tiles `u` can walk on its next turn's energy (energyOf, as its Move stands now: the budget set last is its last
// turn's; a Rooted one keeps its energy and walks none) and still pay blow `b` (none: the walk alone): its next turn's
// stride; −1 where that energy cannot pay `b`.
export function strideNext (battle, u, b = null) {
  const e = energyOf(battle, u) - (b ? costOf(u, b) : 0)
  return e < 0 ? -1 : u.move > 0 ? Math.floor(e / TUNING.energy.tile) : 0
}

// What a unit could strike on its side's next turn, for the board to light when a foe is tapped (every blow, no line of
// fire; a Hexed one nothing): a sentry's reach from the tile it holds. → { move (road order), ground, air }: tile lists,
// ascending.
export function threatOf (battle, u) {
  const move = alive(u) ? spotsOf(battle, u, null, strideNext(battle, u)) : []
  const ground = new Array(TILES).fill(0)
  const air = new Array(TILES).fill(0)
  if (move.length && !stunned(u, false)) {
    for (const b of u.kit) {
      const k = isBlow(b) ? strideNext(battle, u, b) : -1
      if (k < 0) continue
      const r = blowReach(u, b)
      const ra = aloft(u, b, r)
      for (const t of spotsOf(battle, u, null, k)) {
        dilate(ground, t, u.size ?? 1, r, 1)
        if (ra >= 0) dilate(air, t, u.size ?? 1, ra, 1)
      }
    }
  }
  const tiles = (list) => list.flatMap((v, t) => (v ? [t] : []))
  return { move, ground: tiles(ground), air: tiles(air) }
}

// A lined blow of `raw` from a footprint at `tile` within `r`: each tile it reaches with no one of `side` between holds
// at least `raw` in `g` and `a`; one a single unit alone screens holds it in that unit's list in `alone`. `area`
// (areaOf): of those tiles, its tiles alone.
function sight (battle, side, tile, size, r, raw, g, a, alone, area = null) {
  const x0 = tileX(tile)
  const y0 = tileY(tile)
  const ya = Math.max(0, y0 - r)
  const yb = Math.min(DEPTH - 1, y0 + size - 1 + r)
  const xa = Math.max(0, x0 - r)
  const xb = Math.min(LANES - 1, x0 + size - 1 + r)
  if (area) {
    if (xb < area.xa || xa > area.xb || yb < area.ya || ya > area.yb) return
    for (const t of area.tiles) {
      const x = tileX(t)
      const y = tileY(t)
      if (x >= xa && x <= xb && y >= ya && y <= yb) seen(battle, side, tile, size, t, raw, g, a, alone)
    }
    return
  }
  for (let y = ya; y <= yb; y++) {
    for (let t = y * LANES + xa, tb = y * LANES + xb; t <= tb; t++) seen(battle, side, tile, size, t, raw, g, a, alone)
  }
}
// sight's reading of tile `t`.
function seen (battle, side, tile, size, t, raw, g, a, alone) {
  if (g[t] >= raw && a[t] >= raw) return
  let p = tile
  let q = t
  if (size !== 1) [p, q] = lineEnds(tile, size, t, 1)
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
    const list = alone.get(one) ?? alone.set(one, new Array(TILES).fill(0)).get(one)
    if (list[t] < raw) list[t] = raw
  }
}

// Every tile within `r` of a footprint at `tile` holds at least `raw`; `area` (areaOf): of those tiles, its tiles alone.
function dilate (list, tile, size, r, raw, area = null) {
  const x0 = tileX(tile)
  const y0 = tileY(tile)
  const ya = Math.max(0, y0 - r)
  const yb = Math.min(DEPTH - 1, y0 + size - 1 + r)
  const xa = Math.max(0, x0 - r)
  const xb = Math.min(LANES - 1, x0 + size - 1 + r)
  if (area) {
    if (xb < area.xa || xa > area.xb || yb < area.ya || ya > area.yb) return
    for (const t of area.tiles) {
      const x = tileX(t)
      const y = tileY(t)
      if (x >= xa && x <= xb && y >= ya && y <= yb && list[t] < raw) list[t] = raw
    }
    return
  }
  for (let y = ya; y <= yb; y++) {
    for (let t = y * LANES + xa, tb = y * LANES + xb; t <= tb; t++) if (list[t] < raw) list[t] = raw
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
export const mitigation = (battle, x) => {
  const s = stats(battle, x)
  return TUNING.damage.defConstant / (TUNING.damage.defConstant + Math.max(0, s.def)) * s.damage.taken
}

// What `u` would take standing on `tile` (its footprint's worst tile) by a danger map for its side, at most its HP. A
// piece never screens itself: what the map has it alone screen counts against it here. `mit`: its mitigation, read
// already on this board.
export function dangerAt (battle, u, tile, map, mit = mitigation(battle, u)) {
  const list = u.flies ? map.air : map.ground
  const own = map.shields?.get(u)
  const mine = own && (u.flies ? own.air : own.ground)
  let raw = 0
  for (const t of footprint(tile, u.size) ?? [tile]) raw = Math.max(raw, list[t] + (mine ? mine[t] : 0))
  return Math.min(u.hp, raw * mit)
}

// ── the pressure ─────────────────────────────────────────────────────────────────────────────────

// The camp's pressure, 0 to 1: its impatience (turns.js), nudged by TUNING.policy.press.strength toward the trade its
// foes could make; out of patience it is 1, so a battle always ends. `maps`: the danger maps made already, { party, foe }.
export function press (battle, maps = {}) {
  const time = impatience(battle)
  if (time >= 1) return 1
  const theirs = onSide(battle, 'party', maps.party ?? danger(battle, 'party'))
  const ours = onSide(battle, 'foe', maps.foe ?? danger(battle, 'foe'))
  const nudge = (theirs - ours) / Math.max(1, theirs + ours)
  return Math.min(1, Math.max(0, time + TUNING.policy.press.strength * nudge))
}

// At full pressure a foe is bold (aggression 1 at least) and only fights: a camp that mended as fast as you dealt would stall.
const hasty = (temper) => (temper.aggression >= 1 ? temper : { ...temper, aggression: 1 })
const fighting = (battle, u) => options(battle, u).filter((o) => !o.ability || o.target.side !== u.side)

const onSide = (battle, side, map) => battle.units.reduce((n, u) => n + (u.side === side && alive(u) ? dangerAt(battle, u, u.tile, map) : 0), 0)

// ── options and their scores ─────────────────────────────────────────────────────────────────────

// A unit's options: each tile it may stand on this turn (a foe's road ahead, a sentry's own tile alone; yours, where it
// stands and, unless `moving` is false, its Move's reach), holding or each act from there.
// → [{ tile, path, ability, target }] (null: holding).
export function options (battle, u, { moving = true } = {}) {
  const spots = u.side === 'foe' ? (u.hold ? [{ tile: u.tile, path: [] }] : roadAhead(battle, u))
    : [{ tile: u.tile, path: [] }, ...(moving && !u.acted ? [...reach(battle, u)].map(([tile, path]) => ({ tile, path })) : [])]
  const acts = canAct(battle, u) ? u.kit.filter((a) => usable(battle, u, a)) : []
  const out = []
  for (const s of spots) {
    out.push({ tile: s.tile, path: s.path, ability: null, target: null })
    for (const a of acts) {
      // Its energy: the tiles walked and the act together.
      if (s.path.length * TUNING.energy.tile + costOf(u, a) > left(u)) continue
      let list
      if (isAllyShape(a.shape) && a.effects.some((e) => (e.op === 'heal' && !e.self) || e.op === 'cleanse')) list = helped(battle, u, a, s.tile)
      else list = targetsFrom(battle, u, a, s.tile)
      if (a.shape === 'all') list = list.slice(0, 1)
      for (const x of list) out.push({ tile: s.tile, path: s.path, ability: a, target: x })
    }
  }
  return out
}

// The one score, with taken the danger where it would stand plus the counter it draws, gained road and kills' worth:
//   dealt × (the target is its prey ? 1.5 : 1) − caution × (1 − press) × taken + aggression × (1 + press) × gained
// `ctx` may carry the danger map and `prey` (a Set: preyOf).
export function score (battle, u, o, temper, p, ctx = {}) {
  const map = ctx.danger ??= danger(battle, u.side)
  const e = estimate(battle, u, o, ctx.prey ?? NOBODY)
  const taken = dangerAt(battle, u, o.tile, map) + e.counter
  return e.dealt - temper.caution * (1 - p) * taken + temper.aggression * (1 + p) * (gain(battle, u, o.tile) + e.kill)
}

export const NOBODY = new Set()
export const MONARCH = 1e6
const worth = (battle, x) => (x === battle.monarch ? MONARCH : x.maxHp)
// Road gained: how much nearer the Monarch a foe would stand (none for yours).
export const gain = (battle, u, tile) => (u.side === 'foe' ? roadOf(battle, u).dist[u.tile] - roadOf(battle, u).dist[tile] : 0)

// A blow of `power` from `a` (stats) on `x`, as it lands (before the rules that bend it); `landed` on x's stats `d`.
export const hit = (battle, a, x, power) => landed(a, stats(battle, x), power)
export const landed = (a, d, power) => computeDamage({ power, atk: a.atk, def: d.def, mul: a.damage.dealt * d.damage.taken })

export const NONE = Object.freeze([])
const ZERO = { dealt: 0, kill: 0, counter: 0, damage: 0, focus: 0, bane: 0, preyed: 0, menace: 0, status: 0, mend: 0, rescue: 0, shadow: 0, felled: NONE, hexed: NONE }
// A status laid on `x`: its worth, or nothing where `x` holds it at its full stacks already or shrugs it off (a Hex on
// one whose act a Hex cost: turns.js addStatus).
const statusWorth = (e, x) => {
  if (e.status === 'hexed' && x.shrugs) return 0
  const had = x.statuses.find((s) => s.id === e.status)
  return had && had.stacks >= statusDef(e.status).stacks ? 0 : STATUS_WORTH[e.status] ?? 0
}
const debuff = (id) => statusDef(id).tags.includes('debuff')

// What an option would do, read off the board: for the score `dealt`, `kill`, `counter`; for the expert's features
// `damage`, `focus` (× the target's lost share of HP), `bane` (on a healer), `preyed`, `menace` (the hardest blow of each
// foe felled), `status`, `mend`, `rescue` (mending one `map` says could fall), `shadow` (an Arise's claim, a Claimed foe
// felled), and the `felled` and `hexed` (a Hex on one that shrugs it off stuns nobody).
export function estimate (battle, u, o, prey, map = null) {
  const a = o.ability
  if (!a) return ZERO
  // A claim is worth the shadow it may bring, the more the nearer its foe stands to falling.
  if (a.claim) {
    const w = o.target.maxHp * (1 - o.target.hp / o.target.maxHp / 2)
    return { ...ZERO, dealt: w, shadow: w }
  }
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
      // A keyed blow on its key deals its multiple; a locked foe takes its lock's share unless a key opens it.
      let d = 0
      for (const e of a.effects) if (e.op === 'damage') d += hit(battle, s, x, e.power) * (keyOn(battle, u, x, e.keyed) ? e.keyed.mul : 1)
      d = Math.round(d * lockShare(battle, x, u))
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
        if (x.statuses.some((st) => st.id === 'claimed')) out.shadow += x.maxHp
        out.felled = [...out.felled, x]
      } else {
        for (const e of a.effects) {
          if (e.op !== 'apply_status' || !debuff(e.status)) continue
          const w = statusWorth(e, x)
          out.dealt += w
          out.status += w
          if (e.status === 'hexed' && !x.shrugs) out.hexed = [...out.hexed, x]
        }
      }
    } else {
      const missing = x.maxHp - x.hp
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

// Whom option `o` strikes: a blow's first of its target's side on the line or a Bodyguard (turns.js struckBy), else its target.
export const struckOf = (battle, u, o) => (o.struck ??= o.ability && isBlow(o.ability) && o.target.side !== u.side ? struckBy(battle, u, o.ability, o.target, o.tile) : o.target)

// The counter a melee blow from `o.tile` would draw from `x`, the one it strikes (turns.js counterOf).
function answer (battle, u, o, x) {
  const b = counterOf(battle, x, u, o.tile)
  if (!b) return 0
  const s = stats(battle, x)
  let d = 0
  for (const e of b.effects) if (e.op === 'damage') d += hit(battle, s, u, e.power)
  return Math.min(Math.round(d * lockShare(battle, u, x)), u.hp)
}

// Whom `u` would rather strike, by its temperament's `prey` (the Monarch once the pressure is 1): weakest the lowest HP,
// wounded the lowest share, unarmoured the lowest DEF, crowd the most covered, rested the most skills ready. Ties count.
function preyOf (battle, u, opts, temper, p) {
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

// The better of two scored options: the higher score; ties: more road, the lower lane, the lower target uid, holding first.
export const EPS = 1e-9
export const lane = (o) => LANE[tileX(o.tile)]
export const better = (o, b) => {
  if (Math.abs(o.score - b.score) > EPS) return o.score > b.score
  if (o.road !== b.road) return o.road > b.road
  if (lane(o) !== lane(b)) return lane(o) < lane(b)
  return (o.target?.uid ?? -1) < (b.target?.uid ?? -1)
}

// A unit's best option by `score`; a foe whose options hold no blow at one of yours, from any tile of its road ahead
// this turn, weighs its road at TUNING.policy.walk's aggression at least: it comes. A sentry never comes, so it skips
// that judgement: it acts from its tile or holds.
export function choose (battle, u, temper, p, map, opts = options(battle, u)) {
  const least = TUNING.policy.walk
  const idle = u.side === 'foe' && !u.hold && !opts.some((o) => o.ability && isBlow(o.ability) && o.target.side !== u.side)
  if (idle && temper.aggression < least) temper = { ...temper, aggression: least }
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

// ── the camp's turn ──────────────────────────────────────────────────────────────────────────────

// The foes' turn: each foe in road order (nearest the Monarch, then lane, uid; rules.js `queue` may reorder) commits its
// best option on the board as the ones before left it: its move (an Overwatch may strike it), then its act; a sentry in
// its place in that order, its act alone. → { orders, events }
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
    // One whose act a Hex cost shrugs off Hexes until it acts again (turns.js addStatus, perform).
    const lost = hexed(u) && !u.acted
    const best = p >= 1 ? choose(battle, u, hasty(u.temper), p, maps.foe, fighting(battle, u)) : choose(battle, u, u.temper, p, maps.foe)
    if (best.tile !== u.tile) {
      out.push({ type: 'move', uid: u.uid, tile: best.tile })
      walk(battle, u, best.path)
      moveMoment(battle, u)
      if (battle.over || !alive(u)) continue
    }
    // A Hex laid on the walk (an Overwatch's) costs the act it was walking to.
    if (best.ability && !hexed(u)) {
      out.push({ type: 'act', uid: u.uid, ability: best.ability.id, target: best.target.uid })
      perform(battle, u, best.ability, best.target)
    } else if (lost || best.ability) {
      battle.beat++
      emit(battle, { type: 'hexed', target: u.uid })
      u.shrugs = true
    }
    u.acted = true
  }
  return { orders: out, events: battle.events.slice(from) }
}

// A unit's hardest blow, raw (rawOf).
export const hardest = (battle, u) => u.kit.reduce((n, b) => (isBlow(b) ? Math.max(n, rawOf(battle, u, b)) : n), 0)

// ── your side's turns ────────────────────────────────────────────────────────────────────────────

// The basic player: End Turn, every turn (what it leaves alone acts by itself: turns.js untouched).
export const basicTurn = () => [{ type: 'end' }]
