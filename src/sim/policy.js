// The expert's turn (the autoplayer's battle play; never shipped): the situation, the threat read, each option's features
// for the model tree (expert.js), the plan (plan.js) and the forest that may overrule a choice (forest.js). Re-exports foe.js.
import { statusDef, SYNERGIES } from '../content.js'
import { TUNING } from '../tuning.js'
import { value as weighed, TREES, conditions, expertModel, decideTree, readTree, scoreOf, defaultExpert } from './expert.js'
import { LANE, roadOf } from './field.js'
import { danger, stunned, rawOf, mitigation, dangerAt, options, score, NOBODY, MONARCH, gain, hit, landed, NONE, estimate, struckOf, EPS, lane, better, hardest } from './foe.js'
import { forestModel, predictions, playOf, playView, meanOf, readsAfter as forestReadsAfter } from './forest.js'
import { readPlan } from './plan.js'
import { stats, computeDamage, fork, order, reach, roadTiles, targetsFrom, usable, canAct, hexed, perform, aloft, helped, shape, orderable, isSkill, synergiesOf, corpses, nextWave, allowed, pick, lined, stride } from './turns.js'
import { alive, isBlow, isAllyShape, footprint, tileX, distanceBetween, blowReach, rangeOf, steps, lineEnds, LINE_AT, LINE_TILES, TILES, DEPTH, synergyCounts, synergyNeeds } from './unit.js'
export * from './foe.js'

// ── the expert's situation ───────────────────────────────────────────────────────────────────────

// What the expert reads of the board before each piece decides, read again for each: what a player sees, never the
// camp's pressure nor its coming turn. The fields the features and the tree's rules read:
//   turn       the turn
//   map        the danger map for your side (danger)
//   healing    Map foe → what the foes' healers could mend it next turn (healingRead)
//   threat     { foes (threatRead), ours (the units they may strike), d (Map foe → Map unit → HP), spots (Map foe → tiles) }
//   entries    { ground, air }: by tile beside the Monarch, how many foes' roads come in by it
//   roads      [{ tile, held (a uid or null), foes: [{ uid, turns (to come beside the Monarch), reach }] }]
//   holding    Map piece uid → the foes whose road it holds within their Move
//   monarch    { hp, share, danger, lethal, threats: [{ uid, deals }], deals (Map), marked (Set), screened }, or null
//   patience   turns since the last wave's first entry
//   pieces     [{ uid, danger, dies, acted, ready }]: yours that take orders
//   killable   [{ uid, by: [uids] }]: the foes one of yours could fell alone this turn
//   foes       [{ uid, hexed, ready, mends }]: the living foes
//   healers    { party, foe }: the uids that heal
//   synergies  { party, foe, breaks (the foes' one kill would end), gains (yours one more piece would bring) }
//   wave       the next wave { wave, turn, due, lanes }, or null
//   shadows    how many shadows and summons of yours stand
//   corpses    [{ uid, corpses }]: your Arise holders that may raise now
//   idle       the uids of your pieces yet to act
// `lean`: the fields turn to patience alone (a board read to be judged). `short`: threat.d left out (afterOf's).
export function situation (battle, { lean = false, short = false } = {}) {
  // Read when first asked for (a lean read's board may never be).
  let dmap = null
  const lazy = () => (dmap ??= danger(battle, 'party'))
  const m = battle.monarch && alive(battle.monarch) ? battle.monarch : null
  const foes = battle.units.filter((x) => x.side === 'foe' && alive(x))
  const mine = battle.units.filter((x) => orderable(battle, x))
  const entries = { ground: new Array(TILES).fill(0), air: new Array(TILES).fill(0) }
  const roads = new Map()
  const holding = new Map()
  const deals = new Map()
  const screened = []
  const aheads = new Map()
  for (const x of foes) {
    const spots = roadTiles(battle, x, x.move)
    aheads.set(x, spots)
    // The tile its road stops before this turn, short of its Move: who holds it there.
    const stop = spots.length <= x.move ? roadOf(battle, x).arrow[spots[spots.length - 1]] : -1
    const holder = stop >= 0 ? holderOn(battle, x, stop) : null
    if (holder && orderable(battle, holder)) holding.set(holder.uid, [...(holding.get(holder.uid) ?? []), x])
    if (!m) continue
    const d = strikeOn(battle, x, m, spots)
    if (d > 0) deals.set(x, d)
    else if (strikeOn(battle, x, m, spots, null, false) > 0) screened.push(x)
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
  const read = threatRead(battle, aheads)
  const ours = targetsOf(battle)
  const byFoe = new Map(read.map((f) => [f.x, f]))
  const out = {
    turn: battle.turn,
    get map () { return lazy() },
    healing: healingRead(battle),
    threat: { foes: read, ours, d: short ? null : strikes(battle, read, ours), spots: new Map(foes.map((x) => [x, byFoe.get(x)?.spots ?? aheads.get(x).slice()])) },
    entries,
    roads: [...roads.values()].sort((a, b) => a.tile - b.tile),
    holding,
    monarch: m && {
      hp: m.hp, share: m.hp / m.maxHp, danger: total, lethal: total >= m.hp, threats: [...deals].map(([x, d]) => ({ uid: x.uid, deals: d })), deals, marked: new Set(deals.keys()), screened
    },
    patience: battle.turn - battle.foeIn
  }
  if (lean) return out
  const next = nextWave(battle)
  const map = lazy()
  // The lean read's fields, its map a plain field, then the rest.
  return {
    turn: out.turn,
    map,
    healing: out.healing,
    threat: out.threat,
    entries: out.entries,
    roads: out.roads,
    holding: out.holding,
    monarch: out.monarch,
    patience: out.patience,
    pieces: mine.map((u) => {
      const d = dangerAt(battle, u, u.tile, map)
      return { uid: u.uid, danger: d, dies: d >= u.hp, acted: u.acted, ready: ready(u) }
    }),
    killable: foes.map((x) => ({ uid: x.uid, by: mine.filter((u) => fells(battle, u, x)).map((u) => u.uid) })).filter((k) => k.by.length),
    foes: foes.map((x) => ({ uid: x.uid, hexed: hexed(x), ready: ready(x), mends: !!x.mend })),
    healers: Object.fromEntries(['party', 'foe'].map((side) => [side, battle.units.filter((u) => u.side === side && alive(u) && u.mend).map((u) => u.uid)])),
    synergies: synergyRead(battle),
    wave: next && { ...next, due: next.turn === battle.turn + 1, lanes: [...new Set(battle.reserve.filter((f) => (f.wave || 1) === next.wave).map((f) => f.lane))] },
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

// Who holds foe `x`'s road on tile `t`, as turns.js roadAhead reads it (a flyer's: one of yours on the ground, else the air).
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

// What foe `x` could deal the Monarch `m` next turn after DEF: its hardest ready blow reaching m from `spots` (a lined one
// on a clear line, `moved` as clear's; `lines` false: no lines), 0 for none.
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

// Whether no one of `y`'s side, y aside, stands strictly between a footprint at `t` (of `size`) and y on `tile`;
// `moved` ({ u, at }) has piece u on footprint `at` instead.
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

// ── the expert's threat read ─────────────────────────────────────────────────────────────────────

// The foes' coming blows as a player who has met them reads them: each foe that will act next turn, in road order, with
// its road's tiles (`spots`; `ahead` with no one in the way), its ready blows and temperament. `aheads`: spots read already.
// → [{ x, s (its stats), blows: [{ power, r, ra, melee, lined, def }], melee, temper, spots, ahead, dist }]
function threatRead (battle, aheads = null) {
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
    out.push({ x, s: stats(battle, x), blows, melee: blows.every((b) => b.melee), temper: x.temper ?? NEUTRAL, spots: aheads?.get(x)?.slice() ?? roadTiles(battle, x, x.move), ahead, dist: road.dist[x.tile] })
  }
  return out.sort((a, b) => a.dist - b.dist || LANE[tileX(a.x.tile)] - LANE[tileX(b.x.tile)] || a.x.uid - b.x.uid)
}
const NEUTRAL = { aggression: 1, caution: 1, prey: 'weakest' }

// What foe `f` (threatRead's) could deal `y` standing on `tile` next turn from one of `spots`: its hardest blow that
// reaches y there (a flyer only from the air; a lined one on a clear line, `moved` as clear's), after DEF; 0 for none.
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

// What the foes' healers could mend each foe next turn (ready heals within Move and range, each healer counted for
// everyone it reaches): Map foe → HP, with `healers` each one's amounts. Damage it would mend back is `undone`.
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

// The blows the foes would land next turn, each foe's once in road order, on the one of yours it would rather strike as
// the camp scores (dealt, half again on its prey, aggression × a kill's worth). `hp`: Map unit → HP where an option
// changes it; `skip`: foes that will not strike; `picks` gets [foe, unit, dealt, HP left]. → Map unit → HP taken.
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

// The others of yours foe `f`'s Shaped blow at `y` (dealing it `n`) covers, spread from the first tile it could strike y from.
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

// The unit of `row` a foe's prey `kind` makes it hunt; null for a kind with no static read (crowd, rested).
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

// What a unit of yours at `hp` is worth in HP: hp + max − brink × max × (share lost)², 0 fallen
// (TUNING.expert.battle.brink): so a wound on the wounded weighs more, and a fall most.
const standingAt = (hp, max) => (hp > 0 ? hp + max - TUNING.expert.battle.brink * max * (1 - hp / max) ** 2 : 0)
const lossOf = (hp, max, taken) => standingAt(hp, max) - standingAt(hp - taken, max)

// What the Monarch at `hp` (of `max`) is worth in HP: max × ((1 + peril) x − peril x² / 2), x its share left
// (TUNING.expert.battle.peril): an HP weighs 1 while it is whole, 1 + peril as it falls.
const guardAt = (hp, max) => {
  const x = Math.max(0, hp) / max
  const p = TUNING.expert.battle.peril
  return max * ((1 + p) * x - p * x * x / 2)
}

// Your side's losses next turn from assign's `taken`: `souls` and `shadows` weighed by lossOf, `monarch` by guardAt.
function losses (battle, taken, hp) {
  const out = { souls: 0, shadows: 0, monarch: 0, taken }
  for (const [y, n] of taken) {
    if (y === battle.monarch) out.monarch += guardAt(hp.get(y) ?? y.hp, y.maxHp) - guardAt((hp.get(y) ?? y.hp) - n, y.maxHp)
    else out[y.shadow ? 'shadows' : 'souls'] += lossOf(hp.get(y) ?? y.hp, y.maxHp, n)
  }
  return out
}

// The tiles foe `x`'s road takes it to next turn were piece `u` on `tile` instead: its footprint there holds the road
// (a flyer's only a flyer's), where it stood is free.
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

// Whether piece `u` could fell foe `x` alone this turn: a usable blow within its Move left and reach (as the crow flies).
function fells (battle, u, x) {
  if (!canAct(battle, u)) return false
  const gap = distanceBetween(u.tile, u.size, x.tile, x.size) - stride(u)
  for (const b of u.kit) {
    if (!isBlow(b) || !usable(battle, u, b)) continue
    const r = x.flies ? aloft(u, b, blowReach(u, b)) : blowReach(u, b)
    if (r >= 0 && gap <= r && blowOn(battle, u, b, x) >= x.hp) return true
  }
  return false
}

// The synergies on each side; `breaks`: the foes' one fewer of a kin or role would end; `gains`: yours one more would bring.
function synergyRead (battle) {
  // Each side's living by kin and role, a trine as three (unit.js synergyCounts), the Monarch none.
  const counts = (side) => synergyCounts(battle.units.filter((u) => u.side === side && alive(u) && u !== battle.monarch))
  const short = (syn, c) => {
    let n = 0
    for (const [axis, id, need] of synergyNeeds(syn)) n += Math.max(0, need - (c[axis][id] ?? 0))
    return n
  }
  const theirs = counts('foe')
  const ours = counts('party')
  const party = synergiesOf(battle, 'party').map((x) => x.id)
  const foe = synergiesOf(battle, 'foe')
  return {
    party,
    foe: foe.map((x) => x.id),
    breaks: foe.filter((syn) => synergyNeeds(syn).some(([axis, id, need]) => theirs[axis][id] === need)).map((x) => x.id),
    gains: SYNERGIES.filter((syn) => !party.includes(syn.id) && short(syn, ours) === 1).map((x) => x.id)
  }
}

// ── the expert's features ────────────────────────────────────────────────────────────────────────

// Piece `u`'s option `o` read as the features its decision weighs and its tree's rules read, off the board and the
// situation `sit`; nothing is played. By name, in OPTION_FEATURES' order:
//   damage        damage dealt, as far as HP (estimate's, as are kill to rescue)
//   kill          the kills' worth
//   menace        the hardest blows of the foes it fells
//   focus         damage × the target's lost share of HP
//   bane          damage on foes that heal
//   harry         damage on the foes that could strike the Monarch
//   status        the statuses' worth
//   mend          HP mended
//   rescue        HP mended on one who could fall next turn
//   danger        what the foes could deal it next turn where it ends (the danger map)
//   fall          its max HP where that danger or the counter would fell it
//   counter       what the counter its blow draws would take
//   screen        the roads into the Monarch it holds where it ends, less those it holds now
//   guard         the Monarch's danger next turn it takes away
//   lethal        1 where the foes could still fell the Monarch after it
//   cull          the Monarch's threats it fells
//   shadow        a corpse raised (its max HP)
//   fuse, essence always 0, kept so the forests' rows keep their columns
//   waste         1 for an act that changes nothing
//   loss          your souls' losses next turn (losses)
//   shadowLoss    your shadows' and summons' losses
//   hit           the Monarch's loss, weighed by guardAt
//   engage        what it could deal next turn from where it ends
//   undone        damage the foes' healers would mend back
//   quell         each target's share of HP dealt × its hardest blow
//   progress      steps nearer its tile in the plan's formation
//   role          1 where it ends on that tile
//   post          1 where that role is a post (block, air, screen)
//   listed        1 for its strike on the kill list
//   forecast      what the foes could deal it next turn from where the forecast has them stand
//   basic         a hold's End-Turn blow's damage or heal (untouchedOrder)
//   basicKill     the max HP of the foe that blow fells
//   basicCounter  what the counter that blow draws would take
export function features (battle, u, o, sit = situation(battle)) {
  const v = blank()
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
  const e = estimate(battle, u, o, m ? m.marked : NOBODY, sit.map)
  v.damage = e.damage
  v.kill = e.kill
  v.menace = e.menace
  v.focus = e.focus
  v.bane = e.bane
  v.status = e.status
  v.mend = e.mend
  v.rescue = e.rescue
  v.shadow = e.shadow
  v.counter = e.counter
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
  // A hold: what End Turn will have it do from the tile it ends on, which the turn gives it at once.
  if (!o.ability && canAct(battle, u)) {
    const x = untouchedOrder(battle, u, o.tile)
    if (x) {
      const b = estimate(battle, u, { tile: o.tile, ability: u.kit.find((a) => a.id === x.ability), target: battle.byUid.get(x.target) }, NOBODY)
      v.basic = b.damage + b.mend
      v.basicKill = b.kill
      v.basicCounter = b.counter
    }
  }
  if (m) {
    const after = monarchAfter(battle, sit, u, o, e)
    v.guard = Math.min(m.hp, m.danger) - Math.min(m.hp, after)
    v.lethal = after >= m.hp ? 1 : 0
    v.cull = e.felled.filter((x) => m.deals.has(x)).length
  }
  return v
}

// Every feature at 0, in order: a literal each time (a spread of a frozen object is V8's slow path).
const blank = () => ({
  damage: 0, kill: 0, menace: 0, focus: 0, bane: 0, harry: 0, status: 0, mend: 0, rescue: 0, danger: 0, fall: 0, counter: 0, screen: 0, guard: 0, lethal: 0, cull: 0,
  shadow: 0, fuse: 0, essence: 0, waste: 0, loss: 0, shadowLoss: 0, hit: 0, engage: 0, undone: 0, quell: 0, progress: 0, role: 0, post: 0, listed: 0, forecast: 0,
  basic: 0, basicKill: 0, basicCounter: 0
})
const BLANK = Object.freeze(blank())
// The option features by name, in order (features' vector).
export const OPTION_FEATURES = Object.freeze(Object.keys(BLANK))

// The option features the learned tree's leaves weigh and teach.js's labels carry, and the conditions it splits on.
export const optionFeatures = (battle, u, o, sit = situation(battle)) => features(battle, u, o, sit)
export { conditions } from './expert.js'

// The formation's roles that hold the Monarch's ground (plan.js formation): a road's block and air slots, a screen.
const POSTS = new Set(['block', 'air', 'screen'])

// The threat read with piece `u` taking option `o` (estimate `e`): the foes it fells or Hexes strike no one, each whose
// road it holds or frees read again (rowsWith), u at the HP its counter leaves, the one it mends at the HP mended. → losses.
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
  // An act that changes no HP the foes read and fells or Hexes none leaves their turn as holding would: once a tile.
  const plain = (sit.threat.plain ??= new Map())
  let out = plain.get(key)
  if (!out) plain.set(key, (out = losses(battle, assign(battle, foes, dd, hp, skip), hp)))
  return out
}

// The threat read's rows with piece `u` on `tile` instead: each foe whose road it would hold or free, and each shooter
// whose lines it could close or open, read again; the rest as read, u struck where it ends. → Map foe → Map unit → HP.
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

// What piece `u` could deal next turn from where option `o` leaves it: its hardest blow ready by then (one used now
// rests), as far as the HP of a foe it could reach (sit.threat.spots), none of `gone`.
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
      if (rr < 0 || !spots.some((t) => distanceBetween(o.tile, u.size, t, x.size) <= u.move + rr)) continue // Move: a next turn's stride
      let n = 0
      let sx = null
      for (const e of b.effects) if (e.op === 'damage') n += landed(s, (sx ??= stats(battle, x)), e.power)
      if (Math.min(n, x.hp) > best) best = Math.min(n, x.hp)
    }
  }
  return best
}

// What the damage over time `u` holds deals it at the turn's end, none from one laid since its turn passed.
function dotOn (u) {
  let n = 0
  for (const s of u.statuses) {
    if (s.fresh) continue
    for (const e of statusDef(s.id).tick ?? NONE) if (e.op === 'dot') n += e.power * s.stacks
  }
  return n
}

// The roads into the Monarch piece `u` would hold standing on `tile` (sit.entries, over its footprint).
export const holds = (u, tile, sit) => (footprint(tile, u.size) ?? [tile]).reduce((n, t) => n + sit.entries.air[t] + (u.flies ? 0 : sit.entries.ground[t]), 0)

// How far `u` on `tile` is from the nearest living foe: a flyer as the crow flies, on the ground round the walls (walkField).
const gap = (battle, u, tile) => {
  if (u.flies) return battle.units.reduce((d, x) => (x.side !== u.side && alive(x) ? Math.min(d, distanceBetween(tile, u.size, x.tile, x.size)) : d), Infinity)
  const field = walkField(battle, u.side)
  let d = Infinity
  for (const t of footprint(tile, u.size) ?? [tile]) d = Math.min(d, field[t])
  return d
}
// Steps (8 ways, never cutting a wall's corner) from each tile to the nearest living unit not of `side`, Infinity where
// none can be reached. Kept for a board as its foes stand.
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

// The Monarch's danger next turn were `u` to take option `o` (estimate `e`): each foe that threatens it, whose road u
// holds, or that a screen stops, read again: nothing from one it fells or Hexes, the rest from roadWith's tiles.
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

// ── the expert's turn ────────────────────────────────────────────────────────────────────────────

export function expertOptions (battle, u, { moving = true } = {}) {
  return options(battle, u, { moving })
}

// One piece's decision alone: its options' features and its conditions through the model tree in use (expert.js
// decideTree; ties as `better`), which a forest may overrule (forested). → { option, by, rules, leaf, path, left, margin? }
export function choice (battle, u, sit = situation(battle), opts = expertOptions(battle, u), model = expertModel()) {
  for (const o of opts) {
    o.v = features(battle, u, o, sit)
    o.road = -o.path.length
  }
  const c = conditions(sit, u)
  const F = forestModel()
  if (F) return forested(battle, u, sit, opts, c, model, F)
  return decideTree(model, c, model.options === 'shortlist' ? shortlisted(battle, u, sit, opts, c) : opts, { better })
}

// One piece's decision with forest `F`: today's decision (rankerView), then each other candidate's predicted advantage
// over its choice (`o.gain`); the best is taken where it exceeds `F.delta`, else today's choice stands, `by` 'forest'
// with its `margin` where it changed. A forest that reads afterstates (forest.js aft.*) has each candidate's read.
function forested (battle, u, sit, opts, c, model, F) {
  const { today, own, candidates, mean } = rankerView(battle, u, sit, opts, c, model)
  if (!own || candidates.length < 2) return today
  const after = forestReadsAfter(F)
  if (after && F.target === 'mean') own.after = afterOf(battle, u, own, sit.plan)
  // Each candidate's afterstate first, then their advantages all at once (forest.js predictions).
  const rest = candidates.filter((o) => o !== own)
  if (after) for (const o of rest) o.after = afterOf(battle, u, o, sit.plan)
  const g = predictions(F, c, u.id, mean, playOf(own), rest.map(playOf))
  let best = null
  for (let i = 0; i < rest.length; i++) {
    const o = rest[i]
    o.gain = g[i]
    if (best === null || gains(o, best)) best = o
  }
  if (!(best.gain > F.delta)) return today
  return { ...today, option: best, by: today.left === opts ? 'forest' : today.by, margin: best.gain }
}
// The better of two options by the forest's advantage (`gain`); ties as `better` breaks a tie of scores.
const gains = (o, b) => {
  if (Math.abs(o.gain - b.gain) > EPS) return o.gain > b.gain
  if (o.road !== b.road) return o.road > b.road
  if (lane(o) !== lane(b)) return lane(o) < lane(b)
  return (o.target?.uid ?? -1) < (b.target?.uid ?? -1)
}

// What the forest reads of piece `u`'s decision (`opts` read already, `c` its conditions, `model` the expert in use).
// → { today (decideTree's), own (its choice), short (the shortlist), label (a label row's options: the shortlist, then
// today's choice, each set of orders once), kept (a Set: what the hard rules keep), candidates (the shortlist's kept,
// and today's choice), mean (forest.js meanOf over the label's kept) }
export function rankerView (battle, u, sit, opts, c = conditions(sit, u), model = expertModel()) {
  const today = decideTree(model, c, opts, { better })
  const own = today.option
  const short = shortlist(battle, u, sit, opts, model, readTree(model, c), today.left === opts)
  const kept = new Set(today.left)
  const seen = new Set()
  const label = []
  const add = (o) => {
    const s = signatureOf(battle, u, o)
    if (seen.has(s)) return
    seen.add(s)
    label.push(o)
  }
  for (const o of short) add(o)
  if (own) add(twinOf(battle, u, own, opts))
  const candidates = short.filter((o) => kept.has(o))
  if (own && !candidates.includes(own)) candidates.push(own)
  return { today, own, short, label, kept, candidates, mean: meanOf(label.filter((o) => kept.has(o)).map(playView)) }
}
// The conditions of the board option `o` of piece `u` leaves, given on a copy as teach.js's playouts give it (a hold
// with its End-Turn act), the piece then done, no foes' turn played. → the conditions, or null where an order is refused.
export function afterOf (battle, u, o, plan) {
  const g = copy(battle)
  const gu = g.byUid.get(u.uid)
  try {
    commit(g, gu, o)
    if (!o.ability && !g.over) {
      const x = untouchedOrder(g, gu)
      if (x) give(g, x)
    }
  } catch {
    return null
  }
  if (alive(gu)) gu.acted = true
  const sit = situation(g, { short: true })
  sit.plan = plan
  return conditions(sit, gu)
}

// The orders an option gives, as one decision (teach.js signature): its tile and its act, a hold's End-Turn act.
function signatureOf (battle, u, o) {
  if (o.ability) return `${o.tile}|a:${o.ability.id}:${o.target.uid}`
  const x = untouchedOrder(battle, u, o.tile)
  return `${o.tile}|${x ? `a:${x.ability}:${x.target}` : ''}`
}
// The option of `opts` that gives the same orders as hold `o` with its End-Turn act made an act, else `o`.
function twinOf (battle, u, o, opts) {
  if (o.ability) return o
  const x = untouchedOrder(battle, u, o.tile)
  return (x && opts.find((y) => y.tile === o.tile && y.ability && y.ability.id === x.ability && y.target.uid === x.target)) || o
}

// The options a model fitted on the shortlists decides among (`options: 'shortlist'`): today's scorer's shortlist and
// today's own choice, as the labels had them. → the options, the shortlist's order.
function shortlisted (battle, u, sit, opts, c) {
  const today = todayModel()
  const short = shortlist(battle, u, sit, opts, today, readTree(today, c))
  const own = decideTree(today, c, opts, { better }).option
  return own && !short.includes(own) ? [...short, own] : short
}
// Today's scorer (expert.js defaultExpert), made again only when its weights change.
let TODAY = null
const todayModel = () => {
  const W = TUNING.expert.battle
  if (TODAY?.option !== W.option || TODAY?.modes !== W.modes || TODAY?.stall !== TUNING.expert.tree.stall) TODAY = { option: W.option, modes: W.modes, stall: TUNING.expert.tree.stall, model: defaultExpert() }
  return TODAY.model
}

// Today's static board evaluation: the board's features (against `from`, the board the turn began on), filtered and
// moded by TREES.board and weighed by TUNING.expert.battle.board. → { keys, score, v, value (keys folded above score) }
export function judge (battle, from = battle, sit = null) {
  const ctx = boardContext(from)
  const W = TUNING.expert.battle
  let w = W.board
  const filters = []
  for (const node of TREES.board) {
    if (!node.when(ctx)) continue
    if (node.keep) filters.push(node)
    else if (node.mode) w = { ...w, ...W.boardModes[node.mode] }
  }
  const v = boardFeatures(battle, from, sit, w.closer !== 0)
  const keys = filters.map((node) => +node.keep({ v }, ctx))
  const score = weighed(v, w)
  let n = score
  for (let i = 0; i < keys.length; i++) n += keys[i] * FOLD[i]
  return { keys, score, v, value: n }
}
// What the board's tree reads (TREES.board's `sit`): the camp's patience, the plan's kind and shooters, as the turn began.
const boardContext = (from) => ({ patience: from.turn - from.foeIn, plan: from.plan?.kind, shooters: from.plan?.shooters.length ?? 0 })
// Each key of the board's tree above all after it: no score reaches 1e10 (a battle won is 1e9); shooters are a handful.
const FOLD = [1e14, 1e10, 1e7]

// The better of two options by the prior (o.score), ties as `better`, for a sort.
const byPrior = (a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0)

// The options of piece `u` worth a second read, each scored by today's scorer (the prior): holding where it stands; for
// each act and target the best and the least endangered; of the moves the nearest its formation tile, the least
// endangered, the best block and the safest screen; then the best by the prior to TUNING.expert.shortlist. → options,
// the best first, each with `v`, `prior` and `score`. `read` (expert.js readTree): `all` read already; `scored`: scored too.
function shortlist (battle, u, sit, all, model = expertModel(), read = null, scored = false) {
  if (!read) {
    read = readTree(model, conditions(sit, u))
    for (const o of all) {
      o.v = features(battle, u, o, sit)
      o.road = -o.path.length
    }
  }
  for (const o of all) o.score = o.prior = scored ? o.score : scoreOf(read, o.v)
  const list = all.slice().sort(byPrior)
  const cap = TUNING.expert.shortlist
  if (list.length <= cap) return list
  const field = sit.plan.goals.get(u.uid)?.field
  const steps = (t) => (field && Number.isFinite(field[t]) ? field[t] : TILES)
  const risks = new Map()
  const risk = (t) => {
    let r = risks.get(t)
    if (r === undefined) risks.set(t, (r = dangerAt(battle, u, t, sit.map)))
    return r
  }
  // The first of `list` (in the prior's order) that `cmp` ranks lowest.
  const best = (xs, cmp) => xs.reduce((a, b) => (a === null || cmp(b, a) < 0 ? b : a), null)
  const safer = (a, b) => risk(a.tile) - risk(b.tile) || steps(a.tile) - steps(b.tile)
  const nearer = (a, b) => steps(a.tile) - steps(b.tile) || risk(a.tile) - risk(b.tile)
  const keep = new Set()
  const groups = new Map()
  const moves = []
  for (const o of list) {
    if (o.ability) {
      const k = `${o.ability.id}:${o.target.uid}`
      const g = groups.get(k)
      if (g) g.push(o)
      else groups.set(k, [o])
    } else moves.push(o)
  }
  const stay = moves.find((o) => o.tile === u.tile)
  if (stay) keep.add(stay)
  for (const g of groups.values()) {
    keep.add(g[0])
    keep.add(best(g, safer))
  }
  if (moves.length > 1) {
    keep.add(best(moves, nearer))
    keep.add(best(moves, safer))
    // A block: the most roads into the Monarch held, more than where it stands.
    const here = holds(u, u.tile, sit)
    const blocks = moves.filter((o) => holds(u, o.tile, sit) > here)
    if (blocks.length) keep.add(best(blocks, (a, b) => holds(u, b.tile, sit) - holds(u, a.tile, sit) || safer(a, b)))
    // A screen: on the line of a foe whose blow from range reaches the Monarch now, or would but for a screen of yours.
    const lines = screenLines(battle, sit)
    const on = lines.size ? moves.filter((o) => (footprint(o.tile, u.size) ?? [o.tile]).some((t) => lines.has(t))) : NONE
    if (on.length) keep.add(best(on, safer))
  }
  for (const o of spread(list, cap - keep.size, keep, 3)) keep.add(o)
  return list.filter((o) => keep.has(o))
}

// What an option does, for the spread of a decision's options: its act at its target, or a move alone.
export const kindOf = (o) => (o.ability ? `${o.ability.id}:${o.target.uid}` : 'move')
// The first `n` of `list` (in its order) that are not in `taken`, no more than `per` of one act at one target (twice
// that of moves alone): so that the same act from a dozen tiles does not crowd out the others.
export function spread (list, n, taken = NOBODY, per = 2) {
  const out = []
  const count = new Map()
  for (const o of taken) count.set(kindOf(o), (count.get(kindOf(o)) ?? 0) + 1)
  for (const o of list) {
    if (out.length >= n) break
    if (taken.has(o)) continue
    const k = kindOf(o)
    const c = count.get(k) ?? 0
    if (c >= (k === 'move' ? 2 * per : per)) continue
    count.set(k, c + 1)
    out.push(o)
  }
  return out
}

// The tiles strictly between the Monarch and each foe whose lined blow reaches it, or would but for a screen. → a Set.
export function screenLines (battle, sit) {
  const out = new Set()
  const m = battle.monarch
  if (!sit.monarch || !m) return out
  for (const x of [...sit.monarch.deals.keys(), ...sit.monarch.screened]) {
    if (!x.kit.some((b) => isBlow(b) && lined(b) && distanceBetween(x.tile, x.size, m.tile, m.size) <= blowReach(x, b))) continue
    const [p, q] = lineEnds(x.tile, x.size, m.tile, m.size)
    const k = p * TILES + q
    for (let i = LINE_AT[k]; i < LINE_AT[k + 1]; i++) out.add(LINE_TILES[i])
  }
  return out
}

// A copy of the battle for an afterstate (turns.js fork), with the caches that stay true: each unit's stats (checked on
// read) and each side's synergies. Not the rules' list: its rules point at the units they were made with.
function copy (battle) {
  const f = fork(battle)
  f.cache = new Map(battle.cache)
  f.syn = { ...battle.syn }
  return f
}

// The expert's turn (fastTurn). `moving` false: every piece acts from where it stands. `note` hears each decision
// ({ decision: 'plan', 'battle' or 'path', uid, by, rules, sit }). `record(battle, { uid, options, chosen, explored })` at
// each decision, with the board before it (read only) and the options scored ({ tile, ability, target, prior, value }).
// `explore: { rng, epsilon, top, weigh }`: with chance epsilon, one of the `top` best at random instead of the choice.
// The same board gives the same orders (but under `explore`).
export function expertTurn (battle, { note = null, moving = true, record = null, explore = null } = {}) {
  if (battle.over) return []
  return fastTurn(battle, { note, moving, record, explore })
}

// The fast turn: the plan read once (plan.js readPlan), then each piece decides once on the board the ones before left
// (choice), the kill list's strikers first. Where the plan reads shooters of the Monarch's and the kill list strikes, the
// kill list as listed is a second pass, and the better board by judge gives the orders. With epsilon above 0 the greedy
// pass alone unless `explore.weigh`; `record` and `explore` replay the pass taken, so recording changes no orders.
function fastTurn (battle, { note, moving, record, explore }) {
  const sit = situation(battle)
  const pieces = battle.units.filter((u) => orderable(battle, u) && !u.acted)
  const plan = readPlan(battle, sit, { moving })
  const listed = plan.kills.flatMap((k) => k.strikes.map((s) => s.uid))
  const rank = (u) => (listed.includes(u.uid) ? listed.indexOf(u.uid) : Infinity)
  const turnOrder = pieces.slice().sort((a, b) => rank(a) - rank(b) || a.ord - b.ord).map((u) => u.uid)
  note?.({ decision: 'plan', by: `${plan.kind} (${plan.trigger ?? 'kept'})`, rules: plan.rules, sit })
  const log = () => (note ? [] : null)
  const greedy = !(explore?.epsilon > 0) || !!explore.weigh
  const weigh = plan.shooters.length && plan.kills.length && greedy
  // Keys: a key laid this turn is another piece's payoff, so a pass with the key-layers first is judged beside the
  // first, where any piece pays a key another could lay.
  const keyOrder = greedy ? keysFirst(battle, pieces, turnOrder) : null
  const again = weigh || keyOrder
  let pick = fastPass(battle, plan, turnOrder, again ? { moving, log: log() } : { moving, record, explore, log: log() })
  let value = again ? judge(pick.f, battle).value : 0
  const best = { order: turnOrder, kills: false }
  const better = (pass) => {
    const v = judge(pass.f, battle).value
    if (!(v > value)) return false
    pick = pass
    value = v
    return true
  }
  if (weigh && better(fastPass(battle, plan, turnOrder, { moving, log: log(), kills: true }))) best.kills = true
  if (keyOrder && better(fastPass(battle, plan, keyOrder, { moving, log: log(), kills: best.kills }))) best.order = keyOrder
  if (again && (record || explore)) pick = fastPass(battle, plan, best.order, { moving, record, explore, log: log(), kills: best.kills })
  for (const r of pick.log ?? NONE) note(r)
  return [...pick.orders, { type: 'end' }]
}

// The turn order with the key-layers first: the pieces with a usable blow that lays a status another piece's usable
// keyed blow pays (turns.js keyOn); null where no piece pays a key another could lay.
function keysFirst (battle, pieces, turnOrder) {
  const blows = (u) => u.kit.filter((a) => isBlow(a) && usable(battle, u, a))
  const lays = (u) => blows(u).flatMap((a) => a.effects.filter((e) => e.op === 'apply_status').map((e) => e.status))
  const pays = (u) => blows(u).flatMap((a) => a.effects.filter((e) => e.keyed).map((e) => e.keyed.status))
  const layers = pieces.filter((u) => lays(u).some((k) => pieces.some((v) => v !== u && pays(v).includes(k)))).map((u) => u.uid)
  if (!layers.length) return null
  return [...turnOrder.filter((uid) => layers.includes(uid)), ...turnOrder.filter((uid) => !layers.includes(uid))]
}

// One pass of the fast turn on a copy of `battle`: with `kills`, the kill list's strikes first as listed, then each
// piece of `turnOrder` yet to act by choice, then End Turn's untouched. → { f (the board, End Turn not yet), orders, log }
function fastPass (battle, plan, turnOrder, { moving, record = null, explore = null, log = null, kills = false }) {
  const f = copy(battle)
  const orders = []
  if (kills) {
    for (const s of plan.kills.flatMap((k) => k.strikes)) {
      const u = f.byUid.get(s.uid)
      const x = f.byUid.get(s.target)
      if (f.over || !u || !orderable(f, u) || u.acted || !canAct(f, u) || !x || !alive(x)) continue
      const opts = options(f, u, { moving }).filter((o) => o.ability?.id === s.ability && o.target?.uid === s.target && struckOf(f, u, o) === o.target)
      const o = opts.find((y) => y.tile === s.tile) ?? opts.sort((p, q) => p.path.length - q.path.length || p.tile - q.tile)[0]
      if (!o) continue
      orders.push(...commit(f, u, o))
      log?.push({ decision: 'battle', uid: u.uid, by: 'kill-list', rules: ['kill-list'] })
    }
  }
  for (const uid of turnOrder) {
    if (f.over) break
    const u = f.byUid.get(uid)
    if (!u || !orderable(f, u) || u.acted) continue
    const s = situation(f)
    s.plan = plan
    const opts = expertOptions(f, u, { moving })
    const pick = choice(f, u, s, opts)
    let o = pick.option
    if (!o) continue
    let explored = false
    const scored = record || explore ? pick.left.slice().sort(byPrior) : NONE
    if (explore && explore.rng() < explore.epsilon) {
      const top = scored.slice(0, Math.max(1, explore.top ?? 3))
      o = top[Math.floor(explore.rng() * top.length)]
      explored = true
    }
    if (record) {
      record(f, {
        uid,
        options: scored.map((c) => ({ tile: c.tile, ability: c.ability?.id ?? null, target: c.target?.uid ?? null, prior: c.score, value: c.score })),
        chosen: scored.indexOf(o),
        explored
      })
    }
    if (log) {
      log.push({ decision: 'battle', uid, by: pick.by, rules: pick.rules, sit: s, ...(pick.margin !== undefined && { margin: pick.margin }) })
      log.push({ decision: 'path', uid, by: pick.path, rules: [] })
    }
    orders.push(...commit(f, u, o))
    if (!o.ability && !f.over) {
      const x = untouchedOrder(f, u)
      if (x) orders.push(give(f, x))
    }
  }
  if (!f.over) orders.push(...untouchedOrders(f))
  return { f, orders, log }
}

// What End Turn has one of yours yet to act do (turns.js untouched), as an order: its basic blow from `tile` at the foe
// furthest along its road, else its basic heal on the most wounded; null for nothing.
export function untouchedOrder (f, u, tile = u.tile) {
  if (!canAct(f, u)) return null
  // Its basic, where its energy after the walk pays for it (usable).
  const b = u.basic
  const foes = b && usable(f, u, b) ? targetsFrom(f, u, b, tile) : NONE
  if (foes.length) return { type: 'act', uid: u.uid, ability: b.id, target: pick(f, u, foes).uid }
  const m = u.mend
  const allies = m && usable(f, u, m) ? helped(f, u, m, tile) : NONE
  if (allies.length) return { type: 'act', uid: u.uid, ability: m.id, target: allies.slice().sort((p, q) => p.hp / p.maxHp - q.hp / q.maxHp || p.uid - q.uid)[0].uid }
  return null
}

// End Turn's untouched done on copy `f` (untouchedOrder, in acting order): your pieces' acts as orders; shadows', summons'
// and those a cleanse freed on the way made as End Turn makes them (an order would be refused). → the orders.
export function untouchedOrders (f) {
  const out = []
  const ordered = new Set(f.units.filter((u) => orderable(f, u) && canAct(f, u)))
  for (const u of f.units.slice()) {
    if (f.over) break
    if (u.side !== 'party' || u === f.monarch || !canAct(f, u)) continue
    const o = untouchedOrder(f, u)
    if (!o) continue
    if (ordered.has(u)) out.push(give(f, o))
    else {
      perform(f, u, u.kit.find((a) => a.id === o.ability), f.byUid.get(o.target))
      u.acted = true
    }
  }
  return out
}

// Option `o` of piece `u` given on `f`: its move, by the path the option was read with, then its act. → the orders.
function commit (f, u, o) {
  const out = []
  if (o.tile !== u.tile) out.push(give(f, { type: 'move', uid: u.uid, tile: o.tile }, o.path))
  if (f.over) return out
  if (o.ability) out.push(give(f, { type: 'act', uid: u.uid, ability: o.ability.id, target: o.target.uid }))
  return out
}

const give = (f, o, path = null) => {
  order(f, o, path)
  return o
}

// What blow `a` of `u` would deal `x` as it lands (its damage effects; before the rules that bend it).
export const blowOn = (battle, u, a, x) => {
  const s = stats(battle, u)
  let d = 0
  for (const e of a.effects) if (e.op === 'damage') d += hit(battle, s, x, e.power)
  return d
}

// A board a turn's orders leave (`battle`, `from` with them given, End Turn not yet), as the features TREES.board and
// TUNING.expert.battle.board read: hp and shadows (your HP), foeHp and foes (theirs, and their max HP), danger and falls
// (what the foes could deal your pieces, the max HP of those it fells), monarch, doom (1: lethal), open (foes on roads
// nothing holds), loss, shadowLoss and hit (losses), counters, mended (by the foes' healers), foeTicks and ticks (damage
// over time), closer (tiles nearer the foes; 0 with `closer` false), progress, shooters (the plan's still standing),
// spent (always 0), won and lost. `sit`: the board's situation where read already (a lean one will do).
export function boardFeatures (battle, from = battle, sit = null, closer = true) {
  const v = {
    hp: 0, shadows: 0, foeHp: 0, foes: 0, danger: 0, falls: 0, monarch: 0, doom: 0, open: 0, spent: 0, won: 0, lost: 0, loss: 0, shadowLoss: 0, hit: 0,
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
  sit ??= situation(battle, { lean: true })
  const rows = [...sit.threat.d.values()]
  for (const u of battle.units) {
    if (!alive(u)) continue
    if (u.side === 'foe') {
      v.foeHp += u.hp
      v.foes += u.maxHp
    } else if (u !== battle.monarch) {
      if (u.shadow) v.shadows += u.hp
      else v.hp += u.hp
      let d = 0
      for (const row of rows) d += row.get(u) ?? 0
      v.danger += Math.min(d, u.hp)
      if (d >= u.hp) v.falls += u.maxHp
    }
  }
  const picks = []
  const t = losses(battle, assign(battle, sit.threat.foes, sit.threat.d, new Map(), NOBODY, picks), new Map())
  v.loss = t.souls
  v.shadowLoss = t.shadows
  v.hit = t.monarch
  // The counters yours would draw from the foes' melee blows (each foe's once, on whom assign says).
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
  // The tiles your pieces came nearer the nearest foe this turn, and nearer their formation tiles.
  for (const u of from.units) {
    if (u.side !== 'party' || u === from.monarch || !orderable(from, u)) continue
    const now = battle.byUid.get(u.uid)
    if (!now || !alive(now)) continue
    const before = closer ? gap(from, u, u.tile) : NaN
    const after = closer ? gap(battle, now, now.tile) : NaN
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
