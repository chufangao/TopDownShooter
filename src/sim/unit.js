// A unit outside the battle: base stats and growth, stat modifiers, synergies, its reach, its summons and its
// footprint, where it deploys (the party's camp, the foes' formation) and the board it fights on.
import { TUNING } from '../tuning.js'
import { unitDef, campDef, abilityDef, relicDef, SYNERGIES, ROLES, UNIT_LIST } from '../content.js'

// ── stats ────────────────────────────────────────────────────────────────────────────────────────

// A kind's base stats at `lvl`. The Monarch has no level: its base HP is TUNING.monarch.hp (its HP relics add in the run).
export function baseStats (id, lvl = 1) {
  const def = unitDef(id)
  const out = {}
  for (const [k, v] of Object.entries(def.base)) out[k] = v + (def.growth[k] ?? 0) * (lvl - 1)
  if (def.monarch) out.hp = TUNING.monarch.hp
  out.hp = Math.round(out.hp)
  return out
}

// A piece as the run keeps it between battles (createBattle adds the per-battle fields): { uid, id, lvl, tracks, hp,
// maxHp, slot, relics? }. slot −1: the ossuary. `lvl` and `tracks` (the tier held on each of its kind's two tracks, 0–4)
// are its own, bought for it alone (a foe holds no tier); `relics`: the piece relics it holds (ids, at most
// TUNING.relic.perPiece).
export function makeUnit (id, { uid, lvl = 1, slot = -1, tracks = [0, 0] } = {}) {
  const hp = baseStats(id, lvl).hp
  return { uid, id, lvl, tracks: tracks.slice(), hp, maxHp: hp, slot }
}

// ── upgrade tracks ───────────────────────────────────────────────────────────────────────────────

export const tracksOf = (id) => unitDef(id).tracks ?? []
// The tiers a unit holds, its first track's then its second's: shared per kind and pair of tiers, so read only.
const TIERS = new Map()
const NO_TIERS = []
const tiersFrom = (tracks, u) => tracks.flatMap((t, i) => t.tiers.slice(0, u.tracks?.[i] ?? 0))
export const tiersOf = (u) => {
  const t0 = u.tracks?.[0] ?? 0
  const t1 = u.tracks?.[1] ?? 0
  const tracks = tracksOf(u.id)
  if (!tracks.length) return NO_TIERS
  if (tracks.length > 2 || !(t0 >= 0 && t0 <= 4 && t1 >= 0 && t1 <= 4 && Number.isInteger(t0) && Number.isInteger(t1))) return tiersFrom(tracks, u)
  let kind = TIERS.get(tracks)
  if (kind === undefined) TIERS.set(tracks, (kind = []))
  return (kind[t0 * 5 + t1] ??= tiersFrom(tracks, u))
}
// The mods its tiers bring, kept with the list of tiers (shared, as it is).
const TIER_MODS = new WeakMap()
const trackMods = (u) => {
  const tiers = tiersOf(u)
  let mods = TIER_MODS.get(tiers)
  if (mods === undefined) TIER_MODS.set(tiers, (mods = tiers.flatMap((t) => t.mods ?? [])))
  return mods
}
// The crosspath rule: whether a kind holding `tracks` may take the next tier on `t`: up to IV, but while one track
// stands past II the other stops at II.
export const canTrack = (tracks, t) => tracks[t] < 4 && (tracks[t] < 2 || tracks[1 - t] <= 2)
export const nextTracks = (tracks, t) => tracks.map((tier, i) => (i === t ? tier + 1 : tier))

// Its abilities in priority order, with its tiers' swaps and additions; a tier replacing an ability the list lacks throws.
export function abilitiesOf (u) {
  const list = unitDef(u.id).abilities.slice()
  for (const { ability: a } of tiersOf(u)) {
    if (!a) continue
    if (a.replace) {
      const i = list.indexOf(a.replace)
      if (i < 0) throw new Error(`${u.id}: a tier replaces "${a.replace}" with "${a.id}", but its abilities are ${list.join(', ')}`)
      list[i] = a.id
    } else {
      list.splice(a.at ?? 0, 0, a.id)
    }
  }
  return list
}

export const auraOf = (u) => tiersOf(u).reduce((aura, t) => t.aura ?? aura, unitDef(u.id).aura ?? null)

// Its kind's Move before mods (every kind carries one, the Monarch's 0): a stat path tiers, auras and statuses add to.
const baseMove = (id) => unitDef(id).move
// How a foe of its kind moves: Hold for a kind marked `hold` (a sentry), else its `behaviour` (Walk by default).
export const behaviourOf = (u) => (unitDef(u.id).hold ? 'hold' : unitDef(u.id).behaviour ?? 'walk')
// The most HP a sentry stands with at level `lvl`, before a room's HP mods (turns.js fit scales it by them): the median
// of the soul kinds of tier TUNING.spawn.sentry.hpTier at that level, so the walk to it is the cost, not the fight.
export function sentryHp (lvl) {
  const tier = TUNING.spawn.sentry.hpTier
  const key = `${tier}|${lvl}`
  let hp = SENTRY_HP.get(key)
  if (hp === undefined) {
    const list = UNIT_LIST.filter((d) => d.tier === tier && d.spawn && !d.boss).map((d) => baseStats(d.id, lvl).hp).sort((a, b) => a - b)
    hp = list.length ? list[Math.floor((list.length - 1) / 2)] : Infinity
    SENTRY_HP.set(key, hp)
  }
  return hp
}
const SENTRY_HP = new Map()
// How far a melee blow with no range of its own reaches: the kind's `arm`, 1, or 2 for a long-armed kind.
export const armOf = (u) => unitDef(u.id).arm ?? 1
// How far a blow of its reaches: a melee blow its own range, else its arm; a ranged blow its range (none: the board).
export const blowReach = (u, a) => (a.melee ? a.range ?? armOf(u) : a.range ?? Infinity)
// Its reach, the farthest of its blows', from its footprint: never past the board, 0 with no blow (the Monarch).
export const reachOf = (u) => Math.min(DEPTH, Math.max(0, ...abilitiesOf(u).map(abilityDef).filter(isBlow).map((a) => blowReach(u, a))))
export const meleeOnly = (u) => {
  const blows = abilitiesOf(u).map(abilityDef).filter(isBlow)
  return blows.length > 0 && blows.every((a) => a.melee)
}

// The summons its tiers bring to each battle: shadows of its kind risen beside it for the battle, bringing none of theirs.
export const summonsOf = (u) => tiersOf(u).reduce((n, t) => n + (t.summon ?? 0), 0)
// The kind its summons are: its own, or for a trine the kind it was made of (its def's `summons`).
export const summonedOf = (u) => unitDef(u.id).summons ?? u.id

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

// Modifiers { path, op: add|mul|set, v, pos?, who? }, its tiers' and `mods`, apply add → mul → set (the largest set wins):
// a `pos` mod ('engaged' or 'free') only to a battle unit in that position, a `who` mod ({ role?, kin?, boss? }) only
// to units it matches. The stats: hp, atk, def, move, cooldown.rate, and the shares damage.dealt/taken, heal.given.
// Kept by all they read (kind, level, tiers, position, each mod by identity, TUNING.monarch.hp), so shared and read
// only: a mod is never changed once made. Dropped whole past STATS_CAP keys.
const STATS = new Map()
const STATS_CAP = 1 << 16
const MOD_IDS = new WeakMap()
let modCount = 0
export function statsOf (unit, mods = []) {
  let key = `${unit.id}|${unit.lvl}|${unit.tracks}|${unit.pos}`
  for (const m of mods) {
    let id = MOD_IDS.get(m)
    if (id === undefined) MOD_IDS.set(m, (id = ++modCount))
    key += `|${id}`
  }
  key += `|${TUNING.monarch.hp}`
  let s = STATS.get(key)
  if (s === undefined) {
    if (STATS.size >= STATS_CAP) STATS.clear()
    STATS.set(key, (s = statsFrom(unit, mods)))
  }
  return s
}
function statsFrom (unit, mods) {
  const b = baseStats(unit.id, unit.lvl)
  const s = {
    hp: b.hp, atk: b.atk, def: b.def,
    move: baseMove(unit.id),
    cooldown: { rate: 1 },
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
  Object.freeze(s.cooldown)
  Object.freeze(s.damage)
  Object.freeze(s.heal)
  return Object.freeze(s)
}

// The stat paths a relic's mods may name that are the run's, not a unit's (runStat reads them).
export const RUN_PATHS = ['run.command', 'run.monarchHp', 'run.roster', 'run.soulTiers', 'price.tier', 'price.lowTier', 'price.recruit', 'price.relic', 'essence.gain', 'arise.domain', 'arise.tier']
export const isRunPath = (path) => RUN_PATHS.includes(path)
// The mods the piece relics a soul holds put on it: a unit's paths alone.
export const heldMods = (u) => (u.relics ?? []).flatMap((id) => relicDef(id).mods ?? []).filter((m) => !isRunPath(m.path))

// A unit of a hidden role (the Monarch) counts toward no synergy.
const hidden = (u) => !!ROLES[unitDef(u.id).role].hidden

// What a piece counts toward its kin's and role's synergies: a trine (three of one kind fused) as three, any other once.
const TRINE_COUNT = 3
export const synergyWeight = (u) => (unitDef(u.id).trineOf ? TRINE_COUNT : 1)
// A piece and the summons its tiers bring, each as the kind it calls up, as the board will count them before a battle.
export const withSummons = (u) => [u, ...Array(summonsOf(u)).fill({ id: summonedOf(u) })]

// These units' counts toward synergies by weight (synergyWeight): { kin: { id: n }, role: { id: n } }. `also(u)`, where
// given, lists the roles a unit counts as besides its own (Mimicry's), each once.
export function synergyCounts (units, also = null) {
  const c = { kin: {}, role: {} }
  for (const u of units) {
    if (hidden(u)) continue
    const d = unitDef(u.id)
    const n = synergyWeight(u)
    c.kin[d.kin] = (c.kin[d.kin] ?? 0) + n
    c.role[d.role] = (c.role[d.role] ?? 0) + n
    for (const role of (also?.(u) ?? []).filter((r) => r !== d.role)) c.role[role] = (c.role[role] ?? 0) + 1
  }
  return c
}

export function activeSynergies (units, also = null) {
  const c = synergyCounts(units, also)
  return SYNERGIES.filter((s) => synergyActive(s, c))
}

export const synergyActive = (syn, counts) => {
  for (const [axis, id, n] of synergyNeeds(syn)) if (!((counts[axis][id] ?? 0) >= n)) return false
  return true
}
// A synergy's needs as [axis, id, count], kin's then role's, made once a synergy.
const NEEDS = new Map()
export const synergyNeeds = (syn) => {
  let out = NEEDS.get(syn)
  if (!out) NEEDS.set(syn, (out = ['kin', 'role'].flatMap((axis) => Object.entries(syn.needs[axis] ?? {}).map(([id, n]) => [axis, id, n]))))
  return out
}
// Whether a synergy holds its rule whole: one split (`full`: Echo's) once its counts reach `full`, below it its lesser form.
export const synergyFull = (syn, counts) =>
  !syn.full || ['kin', 'role'].every((axis) => Object.keys(syn.needs[axis] ?? {}).every((id) => (counts[axis][id] ?? 0) >= syn.full))

// ── formation and camp ───────────────────────────────────────────────────────────────────────────

// Where each side deploys: a grid COLS wide, slot = row × COLS + col, row 0 the front (nearest the other side). The foes
// stand in a ROWS-deep formation; the party in its CAMP_ROWS-deep camp, whose walls (campDef(id).map) no soul stands on.

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
// A blow: an ability aimed at the other side (not an ally ability, nor Arise's claim).
export const isBlow = (a) => !isAllyShape(a.shape) && !a.claim

// Columns from the middle lane outward: where a formation fills first.
export const CENTRE_OUT = Array.from({ length: COLS }, (_, i) => (COLS - 1) / 2 + (i % 2 ? -1 : 1) * Math.ceil(i / 2))
// A sentry's posts in a formation, in order: the far row from the wings in, then the middle row's wings: off the road
// a wave's walkers take, so none is held behind one. A sentry of a later wave enters on the first free one (field.js
// entryTile).
const WINGS_IN = CENTRE_OUT.slice().reverse()
export const SENTRY_POSTS = [...WINGS_IN.map((c) => slotAt(ROWS - 1, c)), ...WINGS_IN.slice(0, COLS - 3).map((c) => slotAt(ROWS - 2, c))]

export const isWall = (camp, slot) => campDef(camp).map[rowOf(slot)][colOf(slot)] === '#'
export const campOpen = (camp, slot) => Number.isInteger(slot) && slot >= 0 && slot < CAMP_SLOTS && !isWall(camp, slot)

// A grid to place on: its rows, which slots a piece may stand on, and a piece's size on it (a foe's always 1).
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

// Whether a unit matches { role?, kin?, boss? } (role and kin: one or a list; boss unset: either).
function matches (u, need) {
  if (need.boss !== undefined && !!unitDef(u.id).boss !== need.boss) return false
  return ['role', 'kin'].every((axis) => {
    const want = need[axis]
    return want === undefined || (Array.isArray(want) ? want.includes(unitDef(u.id)[axis]) : unitDef(u.id)[axis] === want)
  })
}

// Pieces onto `grid` by their footprints, in order: one whose footprint still fits keeps its slot; the rest take the
// first that fits, front row first, columns in `cols` order, or −1 (for yours, the ossuary). A footprint fits on open
// cells not in `taken`, which grows as these are placed. Mutates and returns units.
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

// Both sides fight on one board, LANES wide and DEPTH deep: tile = y × LANES + x. The camp fills y 0 to CAMP_ROWS − 1
// (its front facing up), then TUNING.board.gap open rows, then the foes' formation to the far edge. Distance is Chebyshev.

export const LANES = COLS
export const DEPTH = CAMP_ROWS + TUNING.board.gap + ROWS
export const TILES = LANES * DEPTH

export const tileX = (tile) => tile % LANES
export const tileY = (tile) => Math.floor(tile / LANES)
export const tileAt = (x, y) => y * LANES + x
const onBoard = (x, y) => x >= 0 && x < LANES && y >= 0 && y < DEPTH
export const distance = (a, b) => Math.max(Math.abs(tileX(a) - tileX(b)), Math.abs(tileY(a) - tileY(b)))

export function deployTile (side, slot) {
  const y = side === 'party' ? CAMP_ROWS - 1 - rowOf(slot) : DEPTH - ROWS + rowOf(slot)
  return tileAt(colOf(slot), y)
}

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

// The tiles a unit can step to from `tile` past `walls` (a Set): no wall, no diagonal squeezing past a wall's corner.
// Moves are symmetric, so this also lists where a step to `tile` can come from.
export function steps (tile, walls) {
  const x = tileX(tile)
  const y = tileY(tile)
  return (NEIGHBOURS[tile] ?? neighbours(tile)).filter((n) => !walls.has(n) &&
    (tileX(n) === x || tileY(n) === y || (!walls.has(tileAt(tileX(n), y)) && !walls.has(tileAt(x, tileY(n))))))
}

// An ability's own range: its `range`, else 1 for melee and the whole board for anything else (a blow's: blowReach).
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

// ── lines of fire ────────────────────────────────────────────────────────────────────────────────

// The tiles strictly between two tiles, in order from the first: a supercover line, a corner touching both tiles beside
// it (the lower first), so no blow slips between two diagonal blockers. Pair a × TILES + b's tiles are LINE_TILES from
// LINE_AT[pair] up to LINE_AT[pair + 1].
export const LINE_AT = new Int32Array(TILES * TILES + 1)
export const LINE_TILES = (() => {
  const out = []
  for (let a = 0; a < TILES; a++) {
    for (let b = 0; b < TILES; b++) {
      LINE_AT[a * TILES + b] = out.length
      let x = tileX(a)
      let y = tileY(a)
      const nx = Math.abs(tileX(b) - x)
      const ny = Math.abs(tileY(b) - y)
      const sx = Math.sign(tileX(b) - x)
      const sy = Math.sign(tileY(b) - y)
      const start = out.length
      // The next boundary the segment crosses: a lane's (x) when (ix + ½) / nx comes before (iy + ½) / ny, a row's when
      // after, a corner when both at once (exact, in integers).
      for (let ix = 0, iy = 0; ix < nx || iy < ny;) {
        const k = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx
        if (k === 0) {
          const p = tileAt(x + sx, y)
          const q = tileAt(x, y + sy)
          out.push(Math.min(p, q), Math.max(p, q))
          x += sx
          y += sy
          ix++
          iy++
        } else if (k < 0) {
          x += sx
          ix++
        } else {
          y += sy
          iy++
        }
        out.push(tileAt(x, y))
      }
      // The far end is no tile between.
      if (out.length > start) out.pop()
    }
  }
  LINE_AT[TILES * TILES] = out.length
  return Int8Array.from(out)
})()

// The tiles strictly between tiles a and b, in order from a.
export const between = (a, b) => Array.from(LINE_TILES.subarray(LINE_AT[a * TILES + b], LINE_AT[a * TILES + b + 1]))

// The ends of a line between two footprints (anchor `a` of side `sa`, `b` of `sb`): each its tile nearest the other.
export function lineEnds (a, sa, b, sb) {
  const to = sb === 1 ? b : nearestIn(b, sb, a)
  return [sa === 1 ? a : nearestIn(a, sa, to), to]
}
const nearestIn = (t, s, p) => tileAt(Math.min(Math.max(tileX(p), tileX(t)), tileX(t) + s - 1), Math.min(Math.max(tileY(p), tileY(t)), tileY(t) + s - 1))

// ── footprints and the seat ──────────────────────────────────────────────────────────────────────

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

// The camp cells a run piece covers: its footprint from its anchor (footprintSlots); none in the ossuary (slot −1).
export const cellsOf = (u) => (u.slot >= 0 ? footprintSlots(u.slot, sizeOf(u)) ?? [u.slot] : [])

// The Monarch's seat: the camp's 'M' cell. It is pre-placed there and never moves.
export function monarchSlot (camp) {
  const map = campDef(camp).map
  for (let r = 0; r < map.length; r++) {
    const c = map[r].indexOf('M')
    if (c >= 0) return slotAt(r, c)
  }
  throw new Error(`camp "${camp}" has no seat`)
}
export const isMonarchCell = (camp, slot) => Number.isInteger(slot) && slot >= 0 && slot < CAMP_SLOTS && campDef(camp).map[rowOf(slot)][colOf(slot)] === 'M'

// Whether a piece of `size` anchored at `slot` stands wholly on open cells of `camp`, none the seat nor in `taken`.
export function fits (camp, slot, size = 1, taken = new Set()) {
  const cells = footprintSlots(slot, size)
  return !!cells && cells.every((c) => campOpen(camp, c) && !isMonarchCell(camp, c) && !taken.has(c))
}

// The least Chebyshev distance between two footprints (squares of side `sa` at `a`, `sb` at `b`; 0 where they overlap).
export function distanceBetween (a, sa, b, sb) {
  const dx = Math.max(0, tileX(b) - tileX(a) - sa + 1, tileX(a) - tileX(b) - sb + 1)
  const dy = Math.max(0, tileY(b) - tileY(a) - sa + 1, tileY(a) - tileY(b) - sb + 1)
  return Math.max(dx, dy)
}
export const unitDistance = (a, b) => distanceBetween(a.tile, a.size ?? sizeOf(a), b.tile, b.size ?? sizeOf(b))

// Whether two spans [a, a + sa) and [b, b + sb) overlap: two footprints sharing a lane (or a row).
const overlap = (a, sa, b, sb) => a < b + sb && b < a + sa

// Who a Shape touches, every distance between footprints: row / column, everyone on the primary's side sharing its row /
// lane; blast, the primary and its side next to it; all_allies, every ally in range; all, the primary's side (within the
// actor's range, if it has one).
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
