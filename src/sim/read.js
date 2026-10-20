// What the autoplayer reads out of battle: the models it ships beside its code (shippedPart); its decisions by a tree of
// hard rules, then weights (decide, TREES), and the learned route's model tree (leafOf); a board's situation (situation)
// and the opening board's conditions as named numbers (conditions); and the plan for your pieces on a battle's first
// board with its formation (readPlan, formation), which prep deploys by (deployment). Never shipped.
import { TUNING } from '../tuning.js'
import { SYNERGIES, unitDef, abilityDef } from '../content.js'
import { LANE, roadOf, fieldOf, airOf } from './field.js'
import { danger, stunned, rawOf, mitigation, dangerAt, hit, options, hardest, struckOf } from './foe.js'
import {
  stats, computeDamage, roadTiles, usable, canAct, hexed, aloft, orderable, isSkill, synergiesOf, nextWave, lined, stride, counterOf, ariseOf,
  lineBlocker
} from './turns.js'
import {
  alive, isBlow, isAllyShape, footprint, tileX, tileAt, distance, distanceBetween, blowReach, rangeOf, statsOf, abilitiesOf, lineEnds, between,
  LINE_AT, LINE_TILES, TILES, LANES, DEPTH, NEIGHBOURS, synergyCounts, synergyNeeds
} from './unit.js'

// ── the models shipped ───────────────────────────────────────────────────────────────────────────

// A model shipped beside the code as src/sim/<name>.json (`outforest`: the forests out of battle, outforest.js; `route`:
// the learned route, player.js routeModel), read once (Node only: in a browser none); null where none ships.
const PARTS = new Map()
export function shippedPart (name) {
  if (PARTS.has(name)) return PARTS.get(name)
  let x = null
  try {
    const fs = globalThis.process?.getBuiltinModule?.('node:fs')
    const url = new URL(`./${name}.json`, import.meta.url)
    if (fs?.existsSync(url)) x = JSON.parse(fs.readFileSync(url, 'utf8'))
  } catch {
    x = null
  }
  PARTS.set(name, x)
  return x
}

// ── the decisions ────────────────────────────────────────────────────────────────────────────────

// One shape for the decisions read here (the plan, a formation, the next room, a relic held, an altar's rite): a situation
// read from what a player sees (situation, player.js survey), its options as named feature vectors (`v`), then two
// layers, each decision naming its rule (`by`):
//   1. the tree (TREES): hard rules in order; a node whose `when` holds forces an option (`force`) or keeps those it
//      ranks highest (`keep`)
//   2. the weights (TUNING.expert): their sum over the features (value) scores what the tree left, the best taken.

// The weighted sum of a feature vector. A feature missing from its table is NaN (the tests hold every vector to its table).
export function value (v, w) {
  let n = 0
  for (const k in v) n += w[k] * v[k]
  return n
}

// One decision: `options` (each with its features `v`), `sit`, `tree`, `weights`; ties keep the first.
// → { option (null for none), by, rules (every rule fired, in order) }
export function decide (tree, sit, options, weights) {
  let left = options
  const rules = []
  for (const node of tree) {
    if (!left.length || !node.when(sit)) continue
    if (node.force) {
      const o = node.force(left, sit)
      if (o) return { option: o, by: node.id, rules: [...rules, node.id] }
    } else if (node.keep) {
      const ranks = left.map((o) => +node.keep(o, sit))
      const top = Math.max(...ranks)
      if (ranks.every((r) => r === top)) continue
      left = left.filter((_, i) => ranks[i] === top)
      rules.push(node.id)
    }
  }
  let best = null
  for (const o of left) {
    o.score = value(o.v, weights)
    if (best === null || o.score > best.score) best = o
  }
  return { option: best, by: rules[0] ?? 'weights', rules }
}

// The tree's filters as a candidate's standing (each holding filter's `keep`, in order), for a one-at-a-time search.
export const standing = (tree, sit, o) => tree.filter((n) => n.keep && n.when(sit)).map((n) => +n.keep(o, sit))

// Whether candidate `a` ({ keys, score }) beats `b`: → the index of the first key it wins on, keys.length on the score, else −1.
export function outranks (a, b) {
  for (let i = 0; i < a.keys.length; i++) if (a.keys[i] !== b.keys[i]) return a.keys[i] > b.keys[i] ? i : -1
  return a.score > b.score ? a.keys.length : -1
}

// ── the vocabulary of conditions ─────────────────────────────────────────────────────────────────

// The situation of a board (situation) as named numbers: what the forests out of battle read of the board a formation
// opens a battle on (outforest.js OPENING_KEYS, OPENING_ROOM_KEYS), each a count, a sum or a share. The labelled data
// reads these names: add, never rename.
export function conditions (sit) {
  const m = sit.monarch
  let open = 0
  let soonest = 99
  let unheld = 0
  for (const r of sit.roads) {
    if (r.held !== null) continue
    unheld++
    open += r.foes.length
    for (const f of r.foes) soonest = Math.min(soonest, f.turns)
  }
  let held = 0
  for (const xs of sit.holding.values()) held += xs.length
  let dies = 0
  let danger = 0
  let ready = 0
  for (const p of sit.pieces) {
    if (p.dies) dies++
    danger += p.danger
    ready += p.ready.length
  }
  let primed = 0
  let mends = 0
  for (const x of sit.foes) {
    primed += x.ready.length
    if (x.mends) mends++
  }
  let healing = 0
  for (const x of sit.healing.values()) healing += x
  const w = sit.wave
  return {
    'monarch.danger': m?.danger ?? 0,
    'monarch.peril': m ? Math.min(4, m.danger / Math.max(1, m.hp)) : 0,
    'monarch.threats': m?.threats.length ?? 0,
    'monarch.screened': m?.screened.length ?? 0,
    roads: sit.roads.length,
    'roads.open': unheld,
    'roads.openFoes': open,
    'roads.soonest': soonest,
    holding: sit.holding.size,
    'holding.foes': held,
    'entries.ground': sum(sit.entries.ground),
    'entries.air': sum(sit.entries.air),
    pieces: sit.pieces.length,
    'pieces.dies': dies,
    'pieces.danger': danger,
    'pieces.ready': ready,
    killable: sit.killable.length,
    'foes.ready': primed,
    'foes.mends': mends,
    'healers.foe': sit.healers.foe.length,
    healing,
    'synergies.party': sit.synergies.party.length,
    'synergies.foe': sit.synergies.foe.length,
    'synergies.breaks': sit.synergies.breaks.length,
    'synergies.gains': sit.synergies.gains.length,
    'wave.in': w ? w.turn - sit.turn : 99,
    'wave.lanes': w?.lanes.length ?? 0,
    shadows: sit.shadows,
    idle: sit.idle.length
  }
}

const NONE = Object.freeze([])
const sum = (xs) => {
  let n = 0
  for (let i = 0; i < xs.length; i++) n += xs[i]
  return n
}

// ── the hard rules ───────────────────────────────────────────────────────────────────────────────

// The hard rules, a decision's list apiece. Each reads the situation (`sit`) and an option's features (`o.v`) only.
const T = () => TUNING.expert.tree
// The rooms that are battles (map.js types).
const BATTLES = new Set(['fight', 'elite', 'siege', 'boss'])
export const TREES = {
  // The battle plan on its first board (readPlan; `sit`: reach, shooters, fellable, healer, waiting).
  plan: [
    // A foe whose ranged blow reaches the Monarch now or next turn is the focus; where none such can be felled, protect.
    { id: 'monarch-shooter', when: (sit) => sit.shooters?.length > 0, keep: (o, sit) => (sit.fellable.length ? o.v.shooter > 0 : o.v.protect > 0) },
    // The Monarch within the foes' reach next turn: close about it, or fell what reaches it where the kill list can.
    { id: 'monarch-reach', when: (sit) => sit.reach, keep: (o) => o.v.protect > 0 || o.v.cull > 0 },
    // A healer of theirs that can be felled this turn is: what the rest deal, it undoes.
    { id: 'fell-healer', when: (sit) => sit.healer, keep: (o) => o.v.focus > 0 && o.v.mends > 0 && o.v.fell >= 1 },
    // Foes that hold off out of your reach, and no wave to come: a line they never walk into holds nothing; go to them.
    { id: 'go-to-them', when: (sit) => sit.waiting, keep: (o) => o.v.hold === 0 && o.v.protect === 0 }
  ],
  // A formation (autoplay.js plan; features autoplay.js formationFeatures).
  formation: [
    // The field filled: as many pieces as any formation fields (the Command, where their footprints fit).
    { id: 'fill-field', when: () => true, keep: (o) => o.v.fielded },
    // A scouted flyer met by a field that can strike one, where any formation fields such a piece.
    { id: 'answer-air', when: (ctx) => !!ctx?.foes?.some((f) => f.flies), keep: (o) => o.v.air > 0 },
    // The roads into the Monarch held: as few scouted foes' roads open to the seat as the pieces allow.
    { id: 'block-roads', when: () => true, keep: (o) => -o.v.open }
  ],
  // The next room (autoplay.js pickRoute; features autoplay.js roomFeatures; `o.node` the room).
  route: [
    // A badly wounded army (TUNING.expert.tree.wounded) takes an altar where one is open,
    { id: 'wounded-altar', when: (sit) => sit.health < T().wounded, force: (rooms) => rooms.find((o) => o.node.type === 'altar') },
    // and so does a wounded Monarch (below TUNING.expert.tree.altar of its HP), where an altar may heal it.
    { id: 'monarch-altar', when: (sit) => !sit.unhealed && sit.monarch < T().altar, force: (rooms) => rooms.find((o) => o.node.type === 'altar') },
    // A badly wounded army never walks into an elite where another room is open,
    { id: 'wounded-no-elite', when: (sit) => sit.health < T().wounded, keep: (o) => o.node.type !== 'elite' },
    // nor does a Monarch below TUNING.expert.tree.elite of its HP.
    { id: 'monarch-no-elite', when: (sit) => sit.monarch < T().elite, keep: (o) => o.node.type !== 'elite' },
    // Never a battle the army is the underdog in (log odds below TUNING.expert.tree.odds) where another room is open.
    { id: 'no-long-odds', when: () => true, keep: (o) => (BATTLES.has(o.node.type) ? Math.min(o.v.odds, T().odds) : T().odds) }
  ],
  // A relic given, kept or taken back out of battle (autoplay.js pickHold: `o.free`, a hold onto a free slot).
  hold: [
    // A piece relic waiting works for no one: given, where a standing soul has a free slot.
    { id: 'give-relic', when: (sit) => sit.relics.unheld.length > 0 && sit.relics.free > 0, keep: (o) => !!o.free }
  ],
  // An altar's rite (autoplay.js pickAltar: `o.action`): the heal, for the route's reason to walk to an altar.
  altar: [
    { id: 'monarch-heal', when: (sit) => !sit.unhealed && sit.monarch < T().altar, force: (opts) => opts.find((o) => o.action?.type === 'heal') }
  ]
}

// ── the learned route's model tree ───────────────────────────────────────────────────────────────

// A model tree as leafOf reads it, checked: every leaf's weights finite, every inner node a condition, a threshold and
// both branches. → the configuration
export function checkTree (config) {
  const walk = (n) => {
    if (n.leaf !== undefined) {
      for (const [k, x] of Object.entries(n.w)) if (!Number.isFinite(x)) throw new Error(`expert: leaf ${n.leaf}: weight ${k} is ${x}`)
      return
    }
    if (typeof n.if !== 'string' || !Number.isFinite(n.gt) || !n.then || !n.else) throw new Error(`expert: a malformed node ${JSON.stringify(n).slice(0, 80)}`)
    walk(n.then)
    walk(n.else)
  }
  walk(config.tree)
  return config
}

// The leaf conditions `c` come to, the path there ({ id, if, gt, hi }), and the weights in effect (with `by`'s). → { leaf, path, w }
export function leafOf (model, c) {
  let n = model.tree
  const path = []
  while (n.leaf === undefined) {
    const hi = (c[n.if] ?? 0) > n.gt
    path.push({ id: n.id, if: n.if, gt: n.gt, hi })
    n = hi ? n.then : n.else
  }
  let w = n.w
  if (n.by) {
    for (const [field, add] of Object.entries(n.by)) {
      const k = c[field] ?? 0
      if (!(k !== 0)) continue
      if (w === n.w) w = { ...w }
      for (const key in add) w[key] += k * add[key]
    }
  }
  return { leaf: n, path, w }
}

// A path in words, for the audit: "monarch.danger>0 plan.protect≤0.5 → guard".
export const pathName = (r) => `${r.path.map((p) => `${p.if}${p.hi ? '>' : '≤'}${+p.gt.toFixed(3)}`).join(' ')} → ${r.leaf.leaf}`

// ── the situation ────────────────────────────────────────────────────────────────────────────────

// What a player reads of the board, never the camp's pressure nor its coming turn: the fields the conditions, the plan
// and the kill list read:
//   turn       the turn
//   map        the danger map for your side (danger)
//   healing    Map foe → what the foes' healers could mend it next turn (healingRead)
//   threat     { foes (threatRead), d (Map foe → Map unit of yours → HP) }
//   entries    { ground, air }: by tile beside the Monarch, how many foes' roads come in by it
//   roads      [{ tile, held (a uid or null), foes: [{ uid, turns (to come beside the Monarch), reach }] }]
//   holding    Map piece uid → the foes whose road it holds within their Move
//   monarch    { hp, danger, threats: [{ uid, deals }], deals (Map), screened }, or null
//   pieces     [{ uid, danger, dies, ready }]: yours that take orders
//   killable   [{ uid, by: [uids] }]: the foes one of yours could fell alone this turn
//   foes       [{ uid, ready, mends }]: the living foes
//   healers    { foe }: the uids of theirs that heal
//   synergies  { party, foe, breaks (the foes' one kill would end), gains (yours one more piece would bring) }
//   wave       the next wave { wave, turn, lanes }, or null
//   shadows    how many shadows and summons of yours stand
//   idle       the uids of your pieces yet to act
// `short`: threat.d left out (the opening board's read).
export function situation (battle, { short = false } = {}) {
  const map = danger(battle, 'party')
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
    else if (strikeOn(battle, x, m, spots, false) > 0) screened.push(x)
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
  const next = nextWave(battle)
  return {
    turn: battle.turn,
    map,
    healing: healingRead(battle),
    threat: { foes: read, d: short ? null : strikes(battle, read, targetsOf(battle)) },
    entries,
    roads: [...roads.values()].sort((a, b) => a.tile - b.tile),
    holding,
    monarch: m && { hp: m.hp, danger: total, threats: [...deals].map(([x, d]) => ({ uid: x.uid, deals: d })), deals, screened },
    pieces: mine.map((u) => {
      const d = dangerAt(battle, u, u.tile, map)
      return { uid: u.uid, danger: d, dies: d >= u.hp, ready: ready(u) }
    }),
    killable: foes.map((x) => ({ uid: x.uid, by: mine.filter((u) => fells(battle, u, x)).map((u) => u.uid) })).filter((k) => k.by.length),
    foes: foes.map((x) => ({ uid: x.uid, ready: ready(x), mends: !!x.mend })),
    healers: { foe: foes.filter((u) => u.mend).map((u) => u.uid) },
    synergies: synergyRead(battle),
    wave: next && { ...next, lanes: [...new Set(battle.reserve.filter((f) => (f.wave || 1) === next.wave).map((f) => f.lane))] },
    shadows: battle.units.filter((u) => u.side === 'party' && alive(u) && u.shadow).length,
    idle: mine.filter((u) => !u.acted).map((u) => u.uid)
  }
}

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
// on a clear line; `lines` false: no lines), 0 for none.
function strikeOn (battle, x, m, spots, lines = true) {
  if (stunned(x, false)) return 0
  let best = 0
  for (const b of x.kit) {
    if (!isBlow(b) || (isSkill(x, b) && (x.cooldowns[b.id] ?? 0) > 0)) continue
    const raw = rawOf(battle, x, b)
    if (!(raw > best)) continue
    const r = blowReach(x, b)
    const line = lines && lined(b)
    if (spots.some((t) => distanceBetween(t, x.size, m.tile, m.size) <= r && (!line || clear(battle, t, x.size, m, m.tile)))) best = raw
  }
  return best * mitigation(battle, m)
}

// Whether no one of `y`'s side, y aside, stands strictly between a footprint at `t` (of `size`) and y on `tile`.
function clear (battle, t, size, y, tile) {
  const [p, q] = lineEnds(t, size, tile, y.size)
  const k = p * TILES + q
  for (let i = LINE_AT[k]; i < LINE_AT[k + 1]; i++) {
    const c = LINE_TILES[i]
    const g = battle.at[c]
    if (g !== null && g.side === y.side && g !== y) return false
    const a = battle.sky[c]
    if (a !== null && a.side === y.side && a !== y) return false
  }
  return true
}

// ── the threat read ──────────────────────────────────────────────────────────────────────────────

// The foes' coming blows as a player who has met them reads them: each foe that will act next turn, in road order, with
// its road's tiles (`spots`) and its ready blows. `aheads`: spots read already.
// → [{ x, s (its stats), blows: [{ power, r, ra, melee, lined }], melee, spots, dist }]
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
      if (power > 0) blows.push({ power, r, ra: aloft(x, b, r), melee: !!b.melee, lined: lined(b) })
    }
    if (!blows.length) continue
    out.push({ x, s: stats(battle, x), blows, melee: blows.every((b) => b.melee), spots: aheads?.get(x)?.slice() ?? roadTiles(battle, x, x.move), dist: roadOf(battle, x).dist[x.tile] })
  }
  return out.sort((a, b) => a.dist - b.dist || LANE[tileX(a.x.tile)] - LANE[tileX(b.x.tile)] || a.x.uid - b.x.uid)
}

const NEUTRAL = { aggression: 1, caution: 1, prey: 'weakest' }

// What foe `f` (threatRead's) could deal `y` standing on `tile` next turn from one of `spots`: its hardest blow that
// reaches y there (a flyer only from the air; a lined one on a clear line), after DEF; 0 for none.
function strikeAt (battle, f, y, tile, spots) {
  let best = 0
  let sy = null
  for (const b of f.blows) {
    const r = y.flies ? b.ra : b.r
    if (r < 0) continue
    let near = false
    for (const t of spots) if (distanceBetween(t, f.x.size, tile, y.size) <= r && (!b.lined || clear(battle, t, f.x.size, y, tile))) { near = true; break }
    if (!near) continue
    sy ??= stats(battle, y)
    const d = computeDamage({ power: b.power, atk: f.s.atk, def: sy.def, mul: f.s.damage.dealt * sy.damage.taken })
    if (d > best) best = d
  }
  return best
}

// What the foes' healers could mend each foe next turn (ready heals within Move and range, each healer counted for
// everyone it reaches): Map foe → HP.
function healingRead (battle) {
  const out = new Map()
  for (const h of battle.units) {
    if (h.side !== 'foe' || !alive(h) || stunned(h, false)) continue
    const s = stats(battle, h)
    for (const a of h.kit) {
      if (!isAllyShape(a.shape) || (isSkill(h, a) && (h.cooldowns[a.id] ?? 0) > 0)) continue
      const heal = a.effects.find((e) => e.op === 'heal' && !e.self)
      if (!heal) continue
      const r = rangeOf(a) + h.move
      for (const x of battle.units) {
        if (x.side !== 'foe' || !alive(x) || distanceBetween(h.tile, h.size, x.tile, x.size) > r) continue
        const n = heal.pct ? x.maxHp * heal.pct : heal.power * s.atk / TUNING.damage.atkDivisor * s.heal.given
        out.set(x, Math.max(out.get(x) ?? 0, 0) + n)
      }
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

// Whether piece `u` could fell foe `x` alone this turn: a usable blow within the walk its energy leaves for that blow
// (stride) and reach (as the crow flies).
function fells (battle, u, x) {
  if (!canAct(battle, u)) return false
  const gap = distanceBetween(u.tile, u.size, x.tile, x.size)
  for (const b of u.kit) {
    if (!isBlow(b) || !usable(battle, u, b)) continue
    const r = x.flies ? aloft(u, b, blowReach(u, b)) : blowReach(u, b)
    if (r >= 0 && gap - stride(u, b) <= r && blowOn(battle, u, b, x) >= x.hp) return true
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

// What blow `a` of `u` would deal `x` as it lands (its damage effects; before the rules that bend it).
export const blowOn = (battle, u, a, x) => {
  const s = stats(battle, u)
  let d = 0
  for (const e of a.effects) if (e.op === 'damage') d += hit(battle, s, x, e.power)
  return d
}

// ── the plan's reads ─────────────────────────────────────────────────────────────────────────────

// The plan prep deploys by: what your pieces do together, read off a battle's first board (readPlan), never played out.
// Four reads:
//   the plan       hold, focus (one key foe), push (at foes that will not come) or protect (close about the Monarch),
//                  picked by TREES.plan and TUNING.expert.plan.choose
//   the formation  roles to tiles for the plan, pieces to roles by assignment (formation); prep deploys by it (deployment)
//   the kill list  the foes your pieces can fell together this turn, and who strikes whom in what order (killList)
//   the forecast   where each foe will likely stand next turn (forecast)
const PLAN = () => TUNING.expert.plan
const NOBODY = new Set()

// ── the forecast ─────────────────────────────────────────────────────────────────────────────────

// Where each living foe will likely stand next turn, along its road within its Move: the bold (aggression ≥ 1) as far
// as lets them strike one of yours, else to your reach's edge; a keeper (0) behind its comrades; the rest wary (`map`,
// the foes' danger map); all as far as they can once the turns since the last wave's first entry reach plan.impatient.
// → { at: Map uid → tile, bold: Set }
export function forecast (battle, map = danger(battle, 'foe')) {
  const impatient = battle.turn - battle.foeIn >= PLAN().impatient
  const at = new Map()
  const bold = new Set()
  const keepers = []
  const ours = battle.units.filter((y) => y.side === 'party' && alive(y))
  for (const x of battle.units) {
    if (x.side !== 'foe' || !alive(x)) continue
    const spots = roadTiles(battle, x, x.move)
    const t = x.temper ?? NEUTRAL
    const hurt = x.flies ? map.air : map.ground
    if (impatient) {
      at.set(x.uid, spots[spots.length - 1])
      bold.add(x.uid)
    } else if (t.aggression >= 1) {
      const blows = x.kit.filter((b) => isBlow(b) && !(isSkill(x, b) && x.cooldowns[b.id] > 0))
      const strikes = (s) => ours.some((y) => blows.some((b) => {
        const r = y.flies ? aloft(x, b, blowReach(x, b)) : blowReach(x, b)
        return r >= 0 && distanceBetween(s, x.size, y.tile, y.size) <= r
      }))
      let s = -1
      for (const p of spots) if (strikes(p)) s = p
      at.set(x.uid, s >= 0 ? s : wary(spots, hurt))
      bold.add(x.uid)
    } else if (t.aggression <= 0) keepers.push([x, spots, hurt])
    else at.set(x.uid, wary(spots, hurt))
  }
  // A keeper no nearer the Monarch than the nearest of its comrades will stand (each read on its own road).
  for (const [x, spots, hurt] of keepers) {
    const road = roadOf(battle, x)
    let front = Infinity
    for (const t of at.values()) front = Math.min(front, road.dist[t])
    const behind = spots.filter((s) => road.dist[s] > front)
    at.set(x.uid, wary(behind.length ? behind : [spots[0]], hurt))
  }
  return { at, bold }
}

// The farthest of `spots` (a road's tiles, in order) that `hurt` (a danger map's list) leaves unhurt, else the least hurt.
function wary (spots, hurt) {
  let out = -1
  for (const s of spots) if (hurt[s] === 0) out = s
  return out >= 0 ? out : spots.reduce((a, s) => (hurt[s] < hurt[a] ? s : a), spots[0])
}

// ── the roads' chokes ────────────────────────────────────────────────────────────────────────────

// The chokes of `road` (a field: arrows into the Monarch's seat) for foes walking from `sources`: for each road into the
// seat, of the chain of tiles out from its entry where one piece holds every source that comes that way (no split, no
// foe on it, within `cap` steps), the tile `hold(chain, sources' indices)` picks, else the farthest.
// → [{ tile, sources (how many it holds), front (the tiles just before it, where those foes wait) }], by entry tile
export function chokes (road, sources, cap, hold = null) {
  const count = new Map()
  const by = new Map()
  sources.forEach((s, i) => {
    let last = -1
    for (let t = road.arrow[s], k = 0; t >= 0 && road.dist[t] > 0 && k < TILES; t = road.arrow[t], k++) {
      count.set(t, (count.get(t) ?? 0) + 1)
      last = t
    }
    if (last >= 0) by.set(last, [...(by.get(last) ?? NONE), i])
  })
  const kids = new Map()
  for (const t of count.keys()) if (count.has(road.arrow[t])) kids.set(road.arrow[t], [...(kids.get(road.arrow[t]) ?? NONE), t])
  const out = []
  for (const e of [...count.keys()].filter((t) => road.dist[t] === 1).sort((a, b) => a - b)) {
    const chain = [e]
    for (let n = e; ;) {
      const k = kids.get(n) ?? NONE
      if (k.length !== 1 || count.get(k[0]) !== count.get(n) || road.dist[k[0]] > cap) break
      n = k[0]
      chain.push(n)
    }
    const n = chain[hold ? hold(chain, by.get(e) ?? NONE) : chain.length - 1]
    const front = new Set(kids.get(n) ?? NONE)
    for (const s of sources) if (road.arrow[s] === n) front.add(s)
    out.push({ tile: n, sources: count.get(n), front: [...front].sort((a, b) => a - b) })
  }
  return out
}

// The line out of range, as chokes' `hold`: the first tile of the chain (`ok` to stand on) where a piece keeps every foe
// of that road out of the Monarch's reach (exposure 0), else the farthest of the least exposed. `src`: roadSources'.
function outOfRange (battle, road, src, ok) {
  const m = battle.monarch
  return (chain, from) => {
    if (!m || !alive(m)) return chain.length - 1
    let best = -1
    let low = Infinity
    for (let i = 0; i < chain.length; i++) {
      if (!ok(chain[i])) continue
      const e = exposure(battle, road, src, from, chain[i], m)
      if (e === 0) return i
      if (e <= low) {
        low = e
        best = i
      }
    }
    return best >= 0 ? best : chain.length - 1
  }
}

// The Monarch's exposure with a piece on road tile `b`: the hardest blow (raw) of each foe of sources `from` that reaches
// it from its road short of b (a lined one not through b), summed.
function exposure (battle, road, src, from, b, m) {
  let n = 0
  for (const i of from) {
    const pos = []
    for (let t = src.tiles[i], k = 0; t >= 0 && t !== b && road.dist[t] > 0 && k < TILES; t = road.arrow[t], k++) pos.push(t)
    for (const x of src.who[i]) n += reachesFrom(battle, x, pos, m, { screen: b })
  }
  return n
}

// Foe `x`'s hardest blow (raw) reaching `m` from one of `pos` (a lined one not through `screen`), 0 for none; `board`: ready
// next turn, none if Hexed, lines as the board stands; `ranged`: no melee. A reserve foe reads its kind's kit.
function reachesFrom (battle, x, pos, m, { screen = -1, board = false, ranged = false } = {}) {
  if (board && hexed(x)) return 0
  let best = 0
  for (const a of x.kit ?? abilitiesOf(x).map(abilityDef)) {
    if (!isBlow(a) || (ranged && a.melee) || (board && isSkill(x, a) && (x.cooldowns[a.id] ?? 0) > 0)) continue
    const raw = x.kit ? rawOf(battle, x, a) : a.effects.reduce((n, e) => n + (e.op === 'damage' ? e.power : 0), 0) * statsOf(x).atk / TUNING.damage.atkDivisor
    if (!(raw > best)) continue
    const r = blowReach(x, a)
    const line = lined(a)
    for (const t of pos) {
      if (distanceBetween(t, 1, m.tile, m.size) > r) continue
      if (line) {
        const [p, q] = lineEnds(t, 1, m.tile, m.size)
        if (onLine(p, q, screen) || (board && lineBlocker(battle, p, q, m.side, m))) continue
      }
      best = raw
      break
    }
  }
  return best
}

// Whether tile `t` lies strictly between tiles p and q (unit.js LINE_TILES).
function onLine (p, q, t) {
  if (t < 0) return false
  const k = p * TILES + q
  for (let i = LINE_AT[k]; i < LINE_AT[k + 1]; i++) if (LINE_TILES[i] === t) return true
  return false
}

// The foes that walk a layer's road (`flies`), as chokes' sources: each living one's tile, and each lane's top-edge tile
// the foes still to come enter by, with the foes there (`who`, by the same index). → { tiles, who }
function roadSources (battle, foes, flies) {
  const tiles = []
  const who = []
  for (const x of foes) {
    if (!!x.flies !== flies) continue
    tiles.push(x.tile)
    who.push([x])
  }
  const at = new Map()
  for (const f of battle.reserve) {
    if (!!unitDef(f.id).flies !== flies) continue
    const t = tileAt(f.lane ?? 3, DEPTH - 1)
    at.set(t, [...(at.get(t) ?? NONE), f])
  }
  for (const [t, list] of [...at].sort((a, b) => a[0] - b[0])) {
    tiles.push(t)
    who.push(list)
  }
  return { tiles, who }
}

// ── the kill list ────────────────────────────────────────────────────────────────────────────────

// Which foes your pieces can fell together this turn, and who strikes whom in what order: the foes the most pressing
// first (in `first`, the Monarch's shooters; able to strike the Monarch; a healer; the hardest blow for its HP), each
// listed where the pieces not yet listed can deal its HP, the fewest of them, ranged blows first (a counter answers only
// a blow its target survives), none whose counter would fell a piece.
// → { list: [{ uid, strikes: [{ uid, ability, target, tile, damage }] }], deal: Map foe uid → what yours could deal it }
export function killList (battle, sit, { first = NOBODY } = {}) {
  const mine = battle.units.filter((u) => orderable(battle, u) && canAct(battle, u))
  const foes = battle.units.filter((x) => x.side === 'foe' && alive(x))
  const best = new Map()
  const deal = new Map()
  for (const u of mine) {
    const row = new Map()
    for (const o of options(battle, u)) {
      const a = o.ability
      // A blow from a tile whence one of its side stands in its line strikes that one, not this foe.
      if (!a || !isBlow(a) || o.target.side === u.side || struckOf(battle, u, o) !== o.target) continue
      const d = blowOn(battle, u, a, o.target)
      if (!(d > 0)) continue
      const list = row.get(o.target.uid) ?? []
      list.push({ tile: o.tile, ability: a.id, damage: d, melee: !!a.melee, risk: dangerAt(battle, u, o.tile, sit.map), steps: o.path.length })
      row.set(o.target.uid, list)
    }
    for (const [uid, list] of row) {
      list.sort((p, q) => q.damage - p.damage || p.risk - q.risk || p.steps - q.steps || p.tile - q.tile)
      deal.set(uid, (deal.get(uid) ?? 0) + list[0].damage)
    }
    best.set(u.uid, row)
  }
  const m = sit.monarch
  const key = (x) => [first.has(x.uid) ? 1 : 0, m?.deals.has(x) ? 1 : 0, x.mend ? 1 : 0, hardest(battle, x) / Math.max(1, x.hp)]
  const order = foes.map((x) => [x, key(x)]).sort(([a, p], [b, q]) => q[0] - p[0] || q[1] - p[1] || q[2] - p[2] || q[3] - p[3] || a.uid - b.uid).map(([x]) => x)
  const used = new Set()
  const claimed = new Set()
  const cells = (u, t) => footprint(t, u.size).map((c) => (u.flies ? 'a' : 'g') + c)
  const list = []
  for (const x of order) {
    if ((deal.get(x.uid) ?? 0) < x.hp) continue
    const cands = []
    for (const u of mine) {
      if (used.has(u.uid)) continue
      const o = best.get(u.uid).get(x.uid)?.find((s) => !cells(u, s.tile).some((c) => claimed.has(c)))
      if (o) cands.push({ u, ...o })
    }
    cands.sort((p, q) => q.damage - p.damage || p.u.uid - q.u.uid)
    const pick = []
    let sum = 0
    for (const c of cands) {
      if (sum >= x.hp) break
      pick.push(c)
      sum += c.damage
    }
    if (sum < x.hp) continue
    // The fewest: whoever the rest can do without stands down (the weakest blow first).
    for (let i = pick.length - 1; i >= 0 && pick.length > 1; i--) {
      if (sum - pick[i].damage >= x.hp) {
        sum -= pick[i].damage
        pick.splice(i, 1)
      }
    }
    pick.sort((p, q) => p.melee - q.melee || p.damage - q.damage || p.u.uid - q.u.uid)
    const dear = pick.some((c, i) => {
      if (!c.melee || i === pick.length - 1) return false
      const b = counterOf(battle, x, c.u, c.tile)
      return !!b && blowOn(battle, x, b, c.u) >= c.u.hp
    })
    if (dear) continue
    list.push({ uid: x.uid, strikes: pick.map((c) => ({ uid: c.u.uid, ability: c.ability, target: x.uid, tile: c.tile, damage: c.damage })) })
    for (const c of pick) {
      used.add(c.u.uid)
      for (const t of cells(c.u, c.tile)) claimed.add(t)
    }
  }
  return { list, deal }
}

// ── the plan ─────────────────────────────────────────────────────────────────────────────────────

// The plan on a battle's first board, chosen by the tree and the weights, with the forecast and the kill list it reads.
// → { kind, target (focus: a foe's uid), by (the rule that chose it, or 'weights'), kills (the kill list's), quarry (a
// push's foes), fc (forecast), open (the danger from where it has the foes, no line of fire stopped) }
export function readPlan (battle, sit) {
  const reached = danger(battle, 'foe')
  const fc = forecast(battle, reached)
  const open = danger(battle, 'party', fc.at, { lines: false })
  const foes = battle.units.filter((x) => x.side === 'foe' && alive(x))
  const shooters = shootersOf(battle, fc, foes)
  const kills = killList(battle, sit, { first: new Set(shooters) })
  const felled = new Set(kills.list.map((k) => k.uid))
  const fellable = shooters.filter((uid) => felled.has(uid) || canFell(battle, battle.byUid.get(uid), fc))
  const ctx = {
    reach: threatened(sit),
    shooters,
    fellable,
    healer: foes.some((x) => x.mend && felled.has(x.uid)),
    waiting: !sit.wave && foes.length > 0 && foes.every((x) => holdsOff(x, fc, reached))
  }
  const pick = decide(TREES.plan, ctx, planOptions(battle, sit, kills, fc, foes, reached, fellable), PLAN().choose)
  const kind = pick.option.kind
  return {
    kind,
    target: pick.option.target,
    by: pick.by,
    kills: kills.list,
    // A push's quarry: the foes that hold off.
    quarry: kind === 'push' ? foes.filter((x) => holdsOff(x, fc, reached)).map((x) => x.uid) : NONE,
    fc,
    open
  }
}

// The Monarch's shooters: the uids of the living foes whose ranged blow, ready next turn, could reach the Monarch from
// where they stand or the forecast has them, on a clear line as the board stands.
function shootersOf (battle, fc, foes) {
  const m = battle.monarch
  if (!m || !alive(m)) return NONE
  const out = []
  for (const x of foes) {
    const at = fc.at.get(x.uid)
    if (reachesFrom(battle, x, at === undefined || at === x.tile ? [x.tile] : [x.tile, at], m, { board: true, ranged: true }) > 0) out.push(x.uid)
  }
  return out
}

// Whether your pieces could fell foe `x` within TUNING.expert.plan.horizon turns: each that can strike it at all, its
// hardest blow once a turn from when its Move brings it in reach of x's forecast tile, against x's HP.
function canFell (battle, x, fc) {
  const at = fc.at.get(x.uid) ?? x.tile
  let dealt = 0
  for (const u of battle.units) {
    if (!orderable(battle, u)) continue
    const r = reachOf(u, x.flies)
    if (r < 0) continue
    const gap = Math.max(0, distanceBetween(u.tile, u.size, at, x.size) - r)
    const blows = PLAN().horizon - Math.ceil(gap / Math.max(1, u.move))
    if (blows > 0) dealt += blows * hardestOn(battle, u, x)
  }
  return dealt >= x.hp
}

// Whether the Monarch is in the foes' reach for the plan: one could strike it next turn, or could but for a screen
// (counting the screened keeps a protect from walking its own screen away the next turn).
const threatened = (sit) => !!sit.monarch && (sit.monarch.danger > 0 || sit.monarch.screened?.length > 0)

// Whether foe `x` holds off: the forecast has it wary, where your side could not strike it next turn (`reached`).
const holdsOff = (x, fc, reached) => !fc.bold.has(x.uid) && (x.flies ? reached.air : reached.ground)[fc.at.get(x.uid) ?? x.tile] === 0
// How far `u`'s blows reach a foe (one that flies, `air`: only a ranged blow, or a flyer's); −1 for none.
const reachOf = (u, air) => u.kit.reduce((r, b) => (isBlow(b) ? Math.max(r, air ? aloft(u, b, blowReach(u, b)) : blowReach(u, b)) : r), -1)

// The plans the tree and the weights choose among (TUNING.expert.plan.choose), each a vector of features:
//   hold, focus, push, protect   which plan it is (1)
//   bold      hold: the share of the foes' HP the forecast has coming on
//   waves     hold: a wave is still to come
//   peril     protect: the Monarch's danger next turn, a share of its HP (at most 2)
//   mends, picks, menace   focus, of its target: it mends; it strikes from afar at one of yours; its hardest blow's share
//   fell      focus: 1 where the kill list fells the target, else the share of its HP yours could deal this turn
//   threat    focus: the target could strike the Monarch next turn; cull: and the kill list fells it
//   shooter   focus: the target is one of the Monarch's shooters yours could fell
//   wary      push: the share of the foes' HP that holds off
//   edge      push: edgeOf
// A focus is offered on every living foe.
function planOptions (battle, sit, kills, fc, foes, reached, fellable = NONE) {
  const hp = foes.reduce((n, x) => n + x.hp, 0) || 1
  const share = (xs) => xs.reduce((n, x) => n + x.hp, 0) / hp
  const m = sit.monarch
  const felled = new Set(kills.list.map((k) => k.uid))
  const top = Math.max(1e-9, ...foes.map((x) => hardest(battle, x)))
  const zero = { hold: 0, focus: 0, push: 0, protect: 0, bold: 0, waves: 0, peril: 0, mends: 0, picks: 0, menace: 0, fell: 0, threat: 0, cull: 0, shooter: 0, wary: 0, edge: 0 }
  const picks = (x) => {
    const f = sit.threat.foes.find((e) => e.x === x)
    return !!f && !f.melee && [...sit.threat.d.get(f).keys()].some((y) => y !== battle.monarch)
  }
  const out = [
    { kind: 'hold', target: null, v: { ...zero, hold: 1, bold: share(foes.filter((x) => fc.bold.has(x.uid))), waves: sit.wave ? 1 : 0 } },
    { kind: 'protect', target: null, v: { ...zero, protect: 1, peril: m ? Math.min(2, m.danger / Math.max(1, m.hp)) : 0 } },
    { kind: 'push', target: null, v: { ...zero, push: 1, wary: share(foes.filter((x) => holdsOff(x, fc, reached))), edge: edgeOf(battle) } }
  ]
  for (const x of foes) {
    const fell = felled.has(x.uid) ? 1 : Math.min(1, (kills.deal.get(x.uid) ?? 0) / Math.max(1, x.hp))
    const threat = m?.deals.has(x) ? 1 : 0
    out.push({
      kind: 'focus',
      target: x.uid,
      v: {
        ...zero, focus: 1, mends: x.mend ? 1 : 0, picks: picks(x) ? 1 : 0, menace: hardest(battle, x) / top, fell, threat, cull: threat && felled.has(x.uid) ? 1 : 0,
        shooter: fellable.includes(x.uid) ? 1 : 0
      }
    })
  }
  return out
}

// Your side's strength over the foes', as a log, −2 to 2: each side's HP standing × its hardest blows (raw), summed.
function edgeOf (battle) {
  const side = (s) => {
    let hp = 0
    let hit = 0
    for (const u of battle.units) {
      if (u.side !== s || !alive(u) || u === battle.monarch) continue
      hp += u.hp
      hit += hardest(battle, u)
    }
    return hp * hit
  }
  const ours = side('party')
  const theirs = side('foe')
  return ours > 0 && theirs > 0 ? Math.max(-2, Math.min(2, Math.log(ours / theirs))) : ours > 0 ? 2 : -2
}

// ── the target formation ─────────────────────────────────────────────────────────────────────────

// Roles to tiles for `plan` (its kind, target and forecast), read off the board, then your pieces to them. The slots:
//   block   each ground road's choke at the line out of range (outOfRange), within TUNING.expert.plan.line steps
//   air     the air road's chokes where flyers walk it and no block is
//   shoot   the TUNING.expert.plan.shooters safest tiles behind the line within plan.reach of the kill zone
//   heal    the tiles beside each block, behind it
//   screen  on the line of each foe whose lined blow reaches the Monarch from its forecast tile
//   strike  focus: about its target's forecast tile; push: about each of its quarry's (plan.strikers a ring)
// Danger here is the plan's `open` map (lines of fire as clear: the formation decides where the screens will stand).
// A piece's fit for a slot (TUNING.expert.plan): the role's worth for the plan × its aptness, plus fit.exposed × its
// danger there, fit.raise for an Arise holder near the kill zone; the assignment (hungarian) fills a hold's or protect's
// road slots first; a piece no slot fits is free. `within`: the tiles a piece may stand on (prep's), null for any.
// → Map piece uid → { role ('free' for none), tile (its anchor, −1 for none) }
export function formation (battle, plan, within = null) {
  const W = PLAN()
  const worth = W.roles[plan.kind]
  const out = new Map()
  const pieces = battle.units.filter((u) => orderable(battle, u))
  if (!pieces.length) return out
  const fc = plan.fc
  const ground = fieldOf(battle)
  const air = airOf(battle)
  const foes = battle.units.filter((x) => x.side === 'foe' && alive(x))
  const taken = new Set()
  const ok = (t) => !taken.has(t) && t !== battle.root && !battle.walls.has(t) && (within === null || within.has(t)) && (battle.at[t] === null || battle.at[t].side === 'party')
  const shadow = (u) => !!u && u.side === 'party' && u !== battle.monarch && !orderable(battle, u)
  const slots = []
  const add = (s) => {
    slots.push(s)
    taken.add(s.tile)
  }
  // Each road held at the line out of range (outOfRange), the ground's, then the air's.
  const gsrc = roadSources(battle, foes, false)
  const sources = gsrc.tiles
  const line = chokes(ground, sources, W.line, outOfRange(battle, ground, gsrc, ok))
  for (const c of line) if (ok(c.tile) && !shadow(battle.at[c.tile])) add({ role: 'block', tile: c.tile })
  const asrc = roadSources(battle, foes, true)
  const aline = chokes(air, asrc.tiles, W.line, outOfRange(battle, air, asrc, (t) => ok(t) || line.some((g) => g.tile === t && taken.has(t))))
  // An air choke past a wall comes back to the tile inside the last wall its road crosses, unless that is the seat.
  for (const c of aline) {
    let t = c.tile
    for (let n = c.tile; n >= 0 && air.dist[n] > 0; n = air.arrow[n]) if (battle.walls.has(n)) t = air.arrow[n]
    if (t === battle.root) t = c.tile
    if (!line.some((g) => g.tile === t) && ok(t) && !shadow(battle.at[t]) && !shadow(battle.sky[t])) add({ role: 'air', tile: t })
  }
  // A screen on the line of each foe whose lined blow reaches the Monarch from its forecast tile, where no slot stands on
  // that line already: its tile nearest the Monarch, or one of yours on it already.
  const m = battle.monarch
  if (m && alive(m) && worth.screen > 0) {
    for (const x of foes) {
      const at = fc.at.get(x.uid) ?? x.tile
      if (!x.kit.some((a) => isBlow(a) && lined(a) && rawOf(battle, x, a) > 0 && distanceBetween(at, x.size, m.tile, m.size) <= blowReach(x, a))) continue
      const [p, q] = lineEnds(at, x.size, m.tile, m.size)
      const on = between(p, q)
      if (on.some((t) => taken.has(t))) continue
      const t = on.find((c) => battle.at[c] !== null && orderable(battle, battle.at[c])) ?? on.findLast((c) => ok(c))
      if (t !== undefined && ok(t)) add({ role: 'screen', tile: t, target: x.uid })
    }
  }
  const zone = [...new Set([...line, ...aline].flatMap((c) => c.front))]
  if (zone.length) {
    // The foes' approach: their roads up to the line.
    const ahead = new Set()
    const stop = new Set(line.map((c) => c.tile))
    for (const s of sources) for (let t = s, k = 0; t >= 0 && k < TILES && !stop.has(t) && ground.dist[t] > 0; t = ground.arrow[t], k++) ahead.add(t)
    const depth = 1 + Math.max(0, ...[...line, ...aline].map((c) => ground.dist[c.tile]).filter(Number.isFinite))
    const near = (t) => zone.reduce((n, z) => Math.min(n, distance(t, z)), Infinity)
    const shoot = []
    for (let t = 0; t < TILES; t++) {
      if (!ok(t) || ahead.has(t) || !(ground.dist[t] <= depth)) continue
      const n = near(t)
      if (n >= 1 && n <= W.reach) shoot.push({ t, n, d: plan.open.ground[t] })
    }
    shoot.sort((p, q) => p.d - q.d || p.n - q.n || p.t - q.t)
    for (const c of shoot.slice(0, W.shooters)) add({ role: 'shoot', tile: c.t })
    for (const s of slots.filter((x) => x.role === 'block')) {
      for (const t of NEIGHBOURS[s.tile]) if (ok(t) && ground.dist[t] <= ground.dist[s.tile]) add({ role: 'heal', tile: t, ward: s.tile })
    }
  }
  if (worth.strike > 0) {
    const targets = (plan.kind === 'focus' ? [plan.target] : plan.quarry).map((uid) => battle.byUid.get(uid)).filter((x) => x && alive(x))
    for (const x of targets) {
      const at = fc.at.get(x.uid) ?? x.tile
      const rings = [[], [], []]
      for (let t = 0; t < TILES; t++) {
        const n = distance(t, at)
        if (ok(t) && n >= 1 && n <= W.reach) rings[Math.min(n, 3) - 1].push({ t, n })
      }
      const order = (p, q) => plan.open.ground[p.t] - plan.open.ground[q.t] || p.n - q.n || p.t - q.t
      for (const ring of rings) for (const c of ring.sort(order).slice(0, W.strikers)) add({ role: 'strike', tile: c.t, target: x.uid, at })
    }
  }
  // Each piece's fit for each slot, and the assignment.
  const toughOf = (u) => {
    const s = stats(battle, u)
    return u.hp * (1 + Math.max(0, s.def) / 100) / s.damage.taken
  }
  const most = Math.max(1e-9, ...pieces.map(toughOf))
  const top = Math.max(1e-9, ...pieces.map((u) => hardest(battle, u)))
  const BIG = 1e6
  // Holding or protecting, the road slots (and a protect's screens) are filled first while a piece can take them.
  const held = plan.kind === 'hold' || plan.kind === 'protect'
  const HELD = 1e3
  const hits = new Map()
  const hardOn = (x) => hits.get(x) ?? hits.set(x, Math.max(1e-9, ...pieces.map((u) => hardestOn(battle, u, x)))).get(x)
  const rows = pieces.map((u) => {
    const melee = u.kit.filter(isBlow).every((b) => b.melee)
    const ranged = u.kit.filter((b) => isBlow(b) && !b.melee).reduce((r, b) => Math.max(r, blowReach(u, b)), -1)
    const raise = ariseOf(battle, u)
    return slots.map((s) => {
      const a = anchorFor(battle, u, s.tile, within)
      if (a < 0) return -BIG
      let apt = 0
      if (s.role === 'block') apt = toughOf(u) / most * (melee ? 1 : 1 - W.fit.melee)
      else if (s.role === 'screen') apt = toughOf(u) / most
      else if (s.role === 'air') apt = reachOf(u, true) >= 0 ? 1 : 0.2
      else if (s.role === 'shoot') apt = ranged >= 0 && zone.some((z) => distanceBetween(a, u.size, z, 1) <= ranged) ? hardest(battle, u) / top : 0
      else if (s.role === 'heal') apt = u.mend ? 1 : 0
      else if (s.role === 'strike') {
        const x = battle.byUid.get(s.target)
        const r = reachOf(u, x.flies)
        apt = r >= 0 && distanceBetween(a, u.size, s.at, x.size) <= r ? hardestOn(battle, u, x) / hardOn(x) : 0
      }
      if (!(apt > 0)) return -BIG
      const first = held && (s.role === 'block' || s.role === 'air' || (s.role === 'screen' && plan.kind === 'protect'))
      let fit = (first ? HELD : 0) + worth[s.role] * apt + W.fit.exposed * dangerAt(battle, u, a, plan.open) / Math.max(1, u.hp)
      if (raise && zone.some((z) => distanceBetween(a, u.size, z, 1) <= raise.domain)) fit += W.fit.raise
      return fit
    })
  })
  const col = hungarian(rows.map((r) => [...r.map((f) => -f), ...pieces.map(() => 0)]))
  pieces.forEach((u, i) => {
    const s = col[i] < slots.length ? slots[col[i]] : null
    out.set(u.uid, { role: s?.role ?? 'free', tile: s ? anchorFor(battle, u, s.tile, within) : -1 })
  })
  return out
}

// What `u`'s hardest blow at `x` would deal it (blowOn), wherever it stands.
const hardestOn = (battle, u, x) => u.kit.reduce((n, b) => (isBlow(b) ? Math.max(n, blowOn(battle, u, b, x)) : n), 0)

// Where piece `u` stands to cover `tile`: its anchor (a 2×2's, the first of the four whose footprint covers it, clear of
// walls and the edge), within `within` where given; −1 for none.
function anchorFor (battle, u, tile, within = null) {
  for (const a of u.size === 1 ? [tile] : [tile, tile - 1, tile - LANES, tile - LANES - 1]) {
    const fp = a >= 0 ? footprint(a, u.size) : null
    if (fp?.includes(tile) && fp.every((t) => (u.flies || !battle.walls.has(t)) && t !== battle.root && (within === null || within.has(t)))) return a
  }
  return -1
}

// Rows to columns (n ≤ m), the least cost in all: the Hungarian method (Kuhn–Munkres, by potentials). → each row's column
export function hungarian (cost) {
  const n = cost.length
  const m = n ? cost[0].length : 0
  const u = new Array(n + 1).fill(0)
  const v = new Array(m + 1).fill(0)
  const p = new Array(m + 1).fill(0)
  const way = new Array(m + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array(m + 1).fill(Infinity)
    const used = new Array(m + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else minv[j] -= delta
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0)
  }
  const out = new Array(n).fill(-1)
  for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1
  return out
}

// ── prep ─────────────────────────────────────────────────────────────────────────────────────────

// Prep's formation (player.js planDraft): the formation's answer on `battle` as the room would begin, its slots among the
// camp's `within` tiles. → Map piece uid → its anchor tile
export function deployment (battle, sit, within) {
  const goals = formation(battle, readPlan(battle, sit), within)
  return new Map([...goals].filter(([, g]) => g.role !== 'free' && g.tile >= 0).map(([uid, g]) => [uid, g.tile]))
}
