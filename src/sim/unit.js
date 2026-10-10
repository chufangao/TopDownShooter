// A unit outside the battle loop: base stats and growth, stat modifiers, synergies, its ring, its bodies and its
// footprint, where it deploys (the party's camp, the foes' formation) and the board it fights on.
import { TUNING } from '../tuning.js'
import { unitDef, campDef, abilityDef, SYNERGIES, ROLES, TRACKS } from '../content.js'

// ── stats ────────────────────────────────────────────────────────────────────────────────────────

// The Monarch has no level: its base HP is TUNING.monarch.hp, whatever `lvl` says; the HP relics add to the run's
// Monarch (run.js monarchHp), and the battle takes the run's (battle.js fit).
export function baseStats (id, lvl = 1) {
  const def = unitDef(id)
  const out = {}
  for (const [k, v] of Object.entries(def.base)) out[k] = v + (def.growth[k] ?? 0) * (lvl - 1)
  if (def.monarch) out.hp = TUNING.monarch.hp
  out.hp = Math.round(out.hp)
  return out
}

// A piece (DESIGN §2.2) as the run keeps it between battles; createBattle adds the per-battle fields. One kind
// on one tile with `count` bodies: its HP is one pool of count × body HP (`maxHp`). slot −1 is the ossuary: the
// piece is kept but does not fight. `lvl` and `tracks` (the tier held on each of its kind's two tracks, 0–4)
// are its kind's (run.js s.kinds), the same for every soul of it; a foe's are its own.
export function makeUnit (id, { uid, lvl = 1, slot = -1, tracks = [0, 0], count = 1 } = {}) {
  const hp = count * baseStats(id, lvl).hp
  return { uid, id, lvl, tracks: tracks.slice(), count, hp, maxHp: hp, slot }
}

// ── bodies ───────────────────────────────────────────────────────────────────────────────────────

// One body's HP: a battle unit's as the battle fitted it (`body`: its HP mods, a shadow's raise), else its share
// of the pool. Its living bodies: ⌈hp ÷ body HP⌉, so they fall one at a time, the first ones first.
export const bodyHp = (u) => u.body ?? u.maxHp / (u.count ?? 1)
export const livingBodies = (u) => (u.hp > 0 ? Math.ceil(u.hp / bodyHp(u) - 1e-9) : 0)
// A pool's bodies one by one, from the front: the whole ones, then the one wounded, then the fallen.
export function bodiesHp (u) {
  const b = bodyHp(u)
  const whole = Math.min(u.count, Math.floor(u.hp / b + 1e-9))
  return Array.from({ length: u.count }, (_, i) => (i < whole ? b : i === whole ? u.hp - whole * b : 0))
}

// ── upgrade tracks ───────────────────────────────────────────────────────────────────────────────

// A kind's two tracks (content.js TRACKS); none for the Monarch.
export const tracksOf = (id) => TRACKS[id] ?? []
// The tiers a unit holds: its first track's, then its second's.
export const tiersOf = (u) => tracksOf(u.id).flatMap((t, i) => t.tiers.slice(0, u.tracks?.[i] ?? 0))
const trackMods = (u) => tiersOf(u).flatMap((t) => t.mods ?? [])
// The crosspath rule (DESIGN §2.6): whether a kind holding `tracks` may take the next tier on track `t`: up to
// IV, but while one track stands past II the other stops at II.
export const canTrack = (tracks, t) => tracks[t] < 4 && (tracks[t] < 2 || tracks[1 - t] <= 2)
// The kind's tracks with the next tier taken on `t`.
export const nextTracks = (tracks, t) => tracks.map((tier, i) => (i === t ? tier + 1 : tier))

// Its abilities in priority order, with the swaps and additions its tiers grant.
export function abilitiesOf (u) {
  const list = unitDef(u.id).abilities.slice()
  for (const { ability: a } of tiersOf(u)) {
    if (!a) continue
    if (a.replace) list[list.indexOf(a.replace)] = a.id
    else list.splice(a.at ?? 0, 0, a.id)
  }
  return list
}

export const auraOf = (u) => tiersOf(u).reduce((aura, t) => t.aura ?? aura, unitDef(u.id).aura ?? null)

// Its ring (DESIGN §2.3): the radius in tiles it fights within (the Monarch's, which never strikes, is only how near
// it holds a foe: holdOf), its kind's and the tiles its tiers add. A foe's stride: how many times faster than
// TUNING.board.stepTicks it walks (1 by default, × its tiers'); your pieces never walk. How it goes for the Monarch
// as a foe: 'walk', 'flank' or 'fly' (BEHAVIOURS).
export const ringOf = (u) => tiersOf(u).reduce((r, t) => r + (t.ring ?? 0), unitDef(u.id).ring)
export const strideOf = (u) => tiersOf(u).reduce((x, t) => x * (t.stride ?? 1), unitDef(u.id).stride ?? 1)
export const behaviourOf = (u) => unitDef(u.id).behaviour ?? 'walk'
// Its arm (DESIGN §2.3): how far a melee blow of yours with no range of its own reaches, never past the ring: the
// kind's `arm`, 1, or 2 for a long-armed kind (Grave Ghoul, Mantis Reaper). The kind's alone: a tier that widens the
// ring lengthens no arm. A foe's melee has no reach at all, whatever its arm (battle.js closeIn).
export const armOf = (u) => unitDef(u.id).arm ?? 1

// How far a piece of yours holds a walking foe, its sight (DESIGN §2.4): your rings are what the foes see you by, and
// a foe may halt in the sight of one that can strike it (only once it can strike something of yours from there:
// battle.js wayOf). A piece sees only as far as its blows that need no condition reach (a blow with a `when` may not
// hold when the foe stands there: Killing Cold, Briar Lash, Miasma, Pyre Rain), so a shooter never halts where it
// can strike a piece that cannot strike back; its ring, where it fights once a condition holds, stays its own. On the
// ground the longest reach of those blows (a melee one its own range, else its kind's arm: armOf; a ranged one its
// range), never past its ring; in the air only the ranged ones' (−1 with none, for no melee blow touches a flyer); −1
// for both with no such blow at all. The Monarch never strikes, but holds whatever comes within its ring, on the
// ground and in the air. Each measured from its footprint. → { ground, air }.
export function holdOf (u) {
  const ring = ringOf(u)
  if (unitDef(u.id).monarch) return { ground: ring, air: ring }
  const sure = abilitiesOf(u).map(abilityDef).filter((a) => isBlow(a) && !a.when)
  const reach = (list) => Math.min(ring, Math.max(-1, ...list.map((a) => (a.melee ? a.range ?? armOf(u) : rangeOf(a)))))
  return { ground: reach(sure), air: reach(sure.filter((a) => !a.melee)) }
}

// The bodies a piece's tiers add for each battle (a tier's `count`): they fight in its pool, whole, and are gone
// when the battle ends.
export const bodiesOf = (u) => tiersOf(u).reduce((n, t) => n + (t.count ?? 0), 0)

// The least and the most gauge any of its abilities costs: below the cheapest a unit can only bank (or
// walk, which is off the gauge), and its gauge never banks past the costliest.
export const cheapestOf = (u) => Math.min(...abilitiesOf(u).map((a) => abilityDef(a).castCost))
export const costliestOf = (u) => Math.max(...abilitiesOf(u).map((a) => abilityDef(a).castCost))

// A stat path's keys, split once.
const pathKeys = new Map()
const keysOf = (path) => {
  let keys = pathKeys.get(path)
  if (keys === undefined) pathKeys.set(path, (keys = path.split('.')))
  return keys
}
const getPath = (o, path) => keysOf(path).reduce((v, k) => v?.[k], o)
function setPath (o, path, value) {
  const keys = keysOf(path)
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]]
  o[keys[keys.length - 1]] = value
}

// Modifiers { path, op: add|mul|set, v, pos?, who? } apply add → mul → set; a `pos` mod ('engaged': a foe next
// to it, or 'free') only applies to a battle unit in that position (unit.pos), never outside a battle, and a
// `who` mod ({ role?, kin? }, one or a list; `boss`, true or false) only to units it matches. The unit's own track tiers count
// too. Several sets on one path: the largest wins, so order never matters.
export function statsOf (unit, mods = []) {
  const b = baseStats(unit.id, unit.lvl)
  const s = {
    hp: b.hp, atk: b.atk, def: b.def, spd: b.spd, acc: b.acc, eva: b.eva, crt: b.crt,
    gauge: { rate: 1 },
    damage: { dealt: 1, taken: 1 },
    heal: { given: 1 }
  }
  const acc = new Map()
  for (const m of [...trackMods(unit), ...mods]) {
    if (m.pos !== undefined && m.pos !== unit.pos) continue
    if (m.who && !matches(unit, m.who)) continue
    let a = acc.get(m.path)
    if (!a) acc.set(m.path, (a = { add: 0, mul: 1, set: null }))
    if (m.op === 'add') a.add += m.v
    else if (m.op === 'mul') a.mul *= m.v
    else if (m.op === 'set') a.set = a.set === null ? m.v : Math.max(a.set, m.v)
  }
  for (const [path, a] of acc) {
    const base = getPath(s, path)
    if (typeof base !== 'number') throw new Error(`unknown stat path "${path}"`)
    setPath(s, path, a.set ?? (base + a.add) * a.mul)
  }
  return s
}

// A unit of a hidden role (the Monarch) counts toward no synergy.
const hidden = (u) => !!ROLES[unitDef(u.id).role].hidden

// Synergies active for these units, from their counts per kin and role. `alias` ({ role: [role, …] }, the
// Legendary relic Mimicry's, a role once a copy; a lone role for one) counts a unit of the first role as one of the
// second too, once for each time it is named.
export function activeSynergies (units, alias = null) {
  const c = { kin: {}, role: {} }
  for (const u of units) {
    if (hidden(u)) continue
    const d = unitDef(u.id)
    c.kin[d.kin] = (c.kin[d.kin] ?? 0) + 1
    for (const role of rolesOf(d, alias)) c.role[role] = (c.role[role] ?? 0) + 1
  }
  return SYNERGIES.filter((s) => synergyActive(s, c))
}

// The roles a unit of def `d` counts as: its own, and each one its alias adds (a role named twice counts twice).
const rolesOf = (d, alias) => [d.role, ...[alias?.[d.role] ?? []].flat().filter((r) => r !== d.role)]

export const synergyActive = (syn, counts) =>
  ['kin', 'role'].every((axis) => Object.entries(syn.needs[axis] ?? {}).every(([id, n]) => (counts[axis][id] ?? 0) >= n))

// ── formation and camp ───────────────────────────────────────────────────────────────────────────

// Where each side deploys: a grid COLS wide, slot = row × COLS + col, row 0 the front (nearest the
// other side). The foes stand in a ROWS-deep formation with nothing in the way; the party in its
// CAMP_ROWS-deep camp, whose walls (campDef(id).map, front row first) no soul may stand on.

export const COLS = 7
export const ROWS = 3
export const SLOTS = COLS * ROWS
export const CAMP_ROWS = 7
export const CAMP_SLOTS = COLS * CAMP_ROWS

export const rowOf = (slot) => Math.floor(slot / COLS)
export const colOf = (slot) => slot % COLS
export const slotAt = (row, col) => row * COLS + col

export const alive = (u) => u.hp > 0
export const onField = (u) => u.slot >= 0
export const livingOn = (units, side) => units.filter((u) => u.side === side && alive(u))
export const enemySide = (side) => (side === 'party' ? 'foe' : 'party')
export const isAllyShape = (shape) => shape === 'ally' || shape === 'all_allies' || shape === 'self'
// A blow: an ability aimed at the other side (not an ally ability, nor Arise's raise).
export const isBlow = (a) => !isAllyShape(a.shape) && a.shape !== 'corpse'

// Columns from the middle lane outward: where a formation fills first.
export const CENTRE_OUT = Array.from({ length: COLS }, (_, i) => (COLS - 1) / 2 + (i % 2 ? -1 : 1) * Math.ceil(i / 2))

export const isWall = (camp, slot) => campDef(camp).map[rowOf(slot)][colOf(slot)] === '#'
export const campOpen = (camp, slot) => Number.isInteger(slot) && slot >= 0 && slot < CAMP_SLOTS && !isWall(camp, slot)

// A grid to place on: how many rows it has, which slots a piece may stand on, and the size a piece stands at on it
// (a foe piece always 1; one of yours its kind's and its tiers', sizeOf).
export const FORMATION = { rows: ROWS, open: (slot) => Number.isInteger(slot) && slot >= 0 && slot < SLOTS, size: () => 1 }
export const campGrid = (camp) => ({ rows: CAMP_ROWS, open: (slot) => campOpen(camp, slot), size: sizeOf })

// The open slot of `grid` nearest `slot` (fewest rows and lanes apart, then fewest rows, then the lower
// slot), skipping `taken`; −1 if there is none.
export function nearestOpen (grid, slot, taken = new Set()) {
  const r0 = rowOf(slot)
  const c0 = colOf(slot)
  let best = -1
  let bestK = Infinity
  for (let t = 0; t < grid.rows * COLS; t++) {
    if (!grid.open(t) || taken.has(t)) continue
    const dr = Math.abs(rowOf(t) - r0)
    const k = (dr + Math.abs(colOf(t) - c0)) * 100 + dr
    if (k < bestK) { best = t; bestK = k }
  }
  return best
}

// Whether a unit matches { role?, kin?, boss? } (role and kin: one or a list; boss: whether it is a boss, or
// either when unset).
function matches (u, need) {
  if (need.boss !== undefined && !!unitDef(u.id).boss !== need.boss) return false
  return ['role', 'kin'].every((axis) => {
    const want = need[axis]
    return want === undefined || (Array.isArray(want) ? want.includes(unitDef(u.id)[axis]) : unitDef(u.id)[axis] === want)
  })
}

// Pieces onto `grid` (FORMATION or a campGrid) by their footprints (DESIGN §2.2): in order, each standing where its
// footprint still fits keeps its slot; the rest (slot −1, clashing or walled) take the first slot theirs fits, the
// front row first, its columns in `cols` order (the middle lane first by default), or −1 with none left (off the
// field: for yours, the ossuary). A footprint fits where every cell of it is open on the grid and not in `taken`
// (the cells others hold: the Monarch's seat, the pieces not being placed; it grows as these are). Mutates and
// returns units.
export function autoPlace (units, { cols = CENTRE_OUT, grid = FORMATION, taken = new Set() } = {}) {
  const cells = (slot, u) => footprintSlots(slot, grid.size(u))
  const fitsAt = (slot, u) => cells(slot, u)?.every((c) => grid.open(c) && !taken.has(c)) ?? false
  const hold = (u) => { for (const c of cells(u.slot, u)) taken.add(c) }
  const rest = []
  for (const u of units) {
    if (u.slot >= 0 && fitsAt(u.slot, u)) hold(u)
    else rest.push(u)
  }
  for (const u of rest) {
    u.slot = -1
    for (let row = 0; row < grid.rows && u.slot < 0; row++) {
      const c = cols.find((col) => fitsAt(slotAt(row, col), u))
      if (c !== undefined) u.slot = slotAt(row, c)
    }
    if (u.slot >= 0) hold(u)
  }
  return units
}

// ── the board ────────────────────────────────────────────────────────────────────────────────────

// Both sides fight on one board, LANES wide and DEPTH deep: tile = y × LANES + x. The party's camp
// fills y 0 to CAMP_ROWS − 1 (its rear row at y 0, its front facing up), then come TUNING.board.gap
// open rows, then the foes' formation, front row first, to the far edge: the foes always attack from
// above, over open ground. A lane is a column, on both sides. Distance counts diagonal steps as one,
// so the 8 tiles around a unit are all at distance 1.

export const LANES = COLS
export const DEPTH = CAMP_ROWS + TUNING.board.gap + ROWS
export const TILES = LANES * DEPTH

export const tileX = (tile) => tile % LANES
export const tileY = (tile) => Math.floor(tile / LANES)
export const tileAt = (x, y) => y * LANES + x
const onBoard = (x, y) => x >= 0 && x < LANES && y >= 0 && y < DEPTH
export const distance = (a, b) => Math.max(Math.abs(tileX(a) - tileX(b)), Math.abs(tileY(a) - tileY(b)))

// The domain (DESIGN §2.5): the tiles within `reach` of `centre` (the Monarch's tile), a square.
export const domainTiles = (centre, reach) => [...Array(TILES).keys()].filter((t) => distance(t, centre) <= reach)

export function deployTile (side, slot) {
  const y = side === 'party' ? CAMP_ROWS - 1 - rowOf(slot) : DEPTH - ROWS + rowOf(slot)
  return tileAt(colOf(slot), y)
}

// The board tiles a camp's walls stand on.
export const wallTiles = (camp) => [...Array(CAMP_SLOTS).keys()].filter((slot) => isWall(camp, slot)).map((slot) => deployTile('party', slot))

export function neighbours (tile) {
  const x = tileX(tile)
  const y = tileY(tile)
  const out = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && onBoard(x + dx, y + dy)) out.push(tileAt(x + dx, y + dy))
  }
  return out
}

// neighbours(tile) for every tile, made once: the board never changes size.
export const NEIGHBOURS = Array.from({ length: TILES }, (_, t) => neighbours(t))

// The tiles a unit can step to from `tile` past `walls` (a Set of tiles): no wall, and no diagonal
// squeezing past a wall's corner. Moves are symmetric, so this also lists where a step to `tile` can
// come from.
export function steps (tile, walls) {
  const x = tileX(tile)
  const y = tileY(tile)
  return neighbours(tile).filter((n) => !walls.has(n) &&
    (tileX(n) === x || tileY(n) === y || (!walls.has(tileAt(tileX(n), y)) && !walls.has(tileAt(x, tileY(n))))))
}

// An ability's own range, as the list helpers read it: melee the 8 tiles around; a ranged ability its `range`;
// one without a range (an `all` shape) the whole board. In a battle a blow reaches no further than its ring, and a
// melee one of yours with no range of its own its kind's arm (armOf; battle.js reachOf).
export const rangeOf = (ability) => ability.range ?? (ability.melee ? 1 : Infinity)

// The open cells of `camp` (slots) that a unit standing for good on cell `slot` (the Monarch on its seat) cuts
// off from the open ground ahead of the camp: no road into them can pass it.
export function sealedBy (camp, slot) {
  const walls = new Set(wallTiles(camp))
  const block = deployTile('party', slot)
  const seen = new Set()
  const queue = []
  for (let x = 0; x < LANES; x++) { seen.add(tileAt(x, CAMP_ROWS)); queue.push(tileAt(x, CAMP_ROWS)) }
  for (let i = 0; i < queue.length; i++) {
    for (const n of steps(queue[i], walls)) {
      if (n !== block && tileY(n) < CAMP_ROWS && !seen.has(n)) { seen.add(n); queue.push(n) }
    }
  }
  return [...Array(CAMP_SLOTS).keys()].filter((c) => c !== slot && campOpen(camp, c) && !seen.has(deployTile('party', c)))
}

// ── footprints and the seat (DESIGN §2.1–§2.2) ──────────────────────────────────────────────────

// A piece's size: 1, or 2 for a kind of size 2 (a fused kind's) or one holding a Colossus tier (`size: 2`).
export const sizeOf = (u) => Math.max(unitDef(u.id).size ?? 1, ...tiersOf(u).map((t) => t.size ?? 1))

// The tiles a piece of `size` anchored at `tile` covers: its anchor, the next lane (+x) and the row ahead (+y,
// toward the foes) of both; null where any would leave the board.
export function footprint (tile, size = 1) {
  if (size === 1) return [tile]
  const x = tileX(tile)
  const y = tileY(tile)
  if (x + size > LANES || y + size > DEPTH) return null
  const out = []
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) out.push(tileAt(x + dx, y + dy))
  return out
}

// The camp cells a piece of `size` anchored at `slot` covers: its cell, the next lane, and the row ahead of both
// (a row nearer the front: row − 1); null where any would leave the camp.
export function footprintSlots (slot, size = 1) {
  if (size === 1) return [slot]
  const r = rowOf(slot)
  const c = colOf(slot)
  if (c + size > COLS || r - (size - 1) < 0) return null
  const out = []
  for (let dr = 0; dr < size; dr++) for (let dc = 0; dc < size; dc++) out.push(slotAt(r - dr, c + dc))
  return out
}

// The Monarch's seat: the camp's 'M' cell (DESIGN §2.1). It is pre-placed there and never moves.
export function monarchSlot (camp) {
  const map = campDef(camp).map
  for (let r = 0; r < map.length; r++) {
    const c = map[r].indexOf('M')
    if (c >= 0) return slotAt(r, c)
  }
  throw new Error(`camp "${camp}" has no seat`)
}
export const isMonarchCell = (camp, slot) => Number.isInteger(slot) && slot >= 0 && slot < CAMP_SLOTS && campDef(camp).map[rowOf(slot)][colOf(slot)] === 'M'

// Whether a piece of `size` anchored at `slot` stands wholly on open cells of `camp`, none the seat, none in
// `taken` (a Set of cells other pieces hold).
export function fits (camp, slot, size = 1, taken = new Set()) {
  const cells = footprintSlots(slot, size)
  return !!cells && cells.every((c) => campOpen(camp, c) && !isMonarchCell(camp, c) && !taken.has(c))
}

// The least Chebyshev distance between two footprints, a square of side `sa` at anchor `a` and one of `sb` at `b`
// (the gap between them, 0 where they overlap); and between two units' footprints (a battle unit carries its size,
// `u.size`; a run piece reads its kind and tiers).
export function distanceBetween (a, sa, b, sb) {
  const dx = Math.max(0, tileX(b) - tileX(a) - sa + 1, tileX(a) - tileX(b) - sb + 1)
  const dy = Math.max(0, tileY(b) - tileY(a) - sa + 1, tileY(a) - tileY(b) - sb + 1)
  return Math.max(dx, dy)
}
export const unitDistance = (a, b) => distanceBetween(a.tile, a.size ?? sizeOf(a), b.tile, b.size ?? sizeOf(b))

// Whether two spans of lanes (or of rows), [a, a + sa) and [b, b + sb), overlap: two footprints sharing a lane (or
// a row).
const overlap = (a, sa, b, sb) => a < b + sb && b < a + sa

// These list-based helpers answer from a list of units what a battle answers from its tile index (battle.js), the
// plain reckoning the tests hold the index to; a battle expands its Shapes with `expand`. Every distance is between
// footprints (unitDistance).

// The living allies whose aura reaches this unit.
export const auraGivers = (units, u) => units.filter((a) => a !== u && a.side === u.side && alive(a) && auraOf(a) &&
  unitDistance(a, u) <= auraOf(a).range)

// The living foes next to a unit (on a tile beside it, or over or under it on its own: a flyer and a ground unit
// share a tile).
export const foesNextTo = (units, u) => units.filter((e) => e.side !== u.side && alive(e) && unitDistance(e, u) <= 1)

// Candidate primary targets for an ability: units on the side it aims at within its range (an ally
// ability without a range reaches every ally).
export function reachable (units, actor, ability) {
  if (ability.shape === 'self') return [actor]
  const side = isAllyShape(ability.shape) ? actor.side : enemySide(actor.side)
  const range = rangeOf(ability)
  return livingOn(units, side).filter((u) => unitDistance(actor, u) <= range)
}

// row: everyone on the primary's side across the board in its row (any row its footprint spans); column: everyone
// in its lane (likewise); blast: the primary and everyone on its side next to it; all_allies: every ally within
// range; all: everyone on the primary's side, within range of the actor if it has one. A unit counts once whatever
// its footprint, and is in a row or lane if any tile of it is.
export function expand (units, actor, ability, primary) {
  const living = livingOn(units, primary.side)
  const size = (u) => u.size ?? sizeOf(u)
  switch (ability.shape) {
    case 'self': return [actor]
    case 'column': return living.filter((u) => overlap(tileX(u.tile), size(u), tileX(primary.tile), size(primary)))
    case 'row': return living.filter((u) => overlap(tileY(u.tile), size(u), tileY(primary.tile), size(primary)))
    case 'blast': return living.filter((u) => unitDistance(u, primary) <= 1)
    case 'all_allies': return living.filter((u) => unitDistance(u, actor) <= rangeOf(ability))
    case 'all': return ability.range ? living.filter((u) => unitDistance(u, actor) <= ability.range) : living
    default: return [primary]
  }
}
