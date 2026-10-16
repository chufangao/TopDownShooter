// A unit outside the battle: base stats and growth, stat modifiers, synergies, its reach, its summons and its
// footprint, where it deploys (the party's camp, the foes' formation) and the board it fights on.
import { TUNING } from '../tuning.js'
import { unitDef, campDef, abilityDef, relicDef, SYNERGIES, ROLES } from '../content.js'

// ── stats ────────────────────────────────────────────────────────────────────────────────────────

// The Monarch has no level: its base HP is TUNING.monarch.hp, whatever `lvl` says; the HP relics add to the run's
// Monarch (run.js monarchHp), and the battle takes the run's (turns.js fit).
export function baseStats (id, lvl = 1) {
  const def = unitDef(id)
  const out = {}
  for (const [k, v] of Object.entries(def.base)) out[k] = v + (def.growth[k] ?? 0) * (lvl - 1)
  if (def.monarch) out.hp = TUNING.monarch.hp
  out.hp = Math.round(out.hp)
  return out
}

// A piece (DESIGN §2.2) as the run keeps it between battles; createBattle adds the per-battle fields. One soul of
// one kind on one tile, one body, its HP its own (`hp` of `maxHp`): it stands while it has HP left. slot −1 is the
// ossuary: the piece is kept but does not fight. `lvl` and `tracks` (the tier held on each of its kind's two
// tracks, 0–4) are its kind's (run.js s.kinds), the same for every soul of it; a foe's are its own. A soul may hold
// relics (run.js hold: `relics`, ids, at most TUNING.relic.perPiece), which a piece made here holds none of.
export function makeUnit (id, { uid, lvl = 1, slot = -1, tracks = [0, 0] } = {}) {
  const hp = baseStats(id, lvl).hp
  return { uid, id, lvl, tracks: tracks.slice(), hp, maxHp: hp, slot }
}

// ── upgrade tracks ───────────────────────────────────────────────────────────────────────────────

// A kind's two tracks, on its def (redesign.md §2.13.1); none for the Monarch.
export const tracksOf = (id) => unitDef(id).tracks ?? []
// The tiers a unit holds: its first track's, then its second's. Kept a kind and pair of tiers (a kind's tracks are its
// def's, never changed in play: a tier's own fields are read through the list, never copied), so it is shared: read
// only. A kind of more than two tracks, or tiers not whole from 0 to 4, are made afresh each time.
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
// The crosspath rule (DESIGN §2.6): whether a kind holding `tracks` may take the next tier on track `t`: up to
// IV, but while one track stands past II the other stops at II.
export const canTrack = (tracks, t) => tracks[t] < 4 && (tracks[t] < 2 || tracks[1 - t] <= 2)
// The kind's tracks with the next tier taken on `t`.
export const nextTracks = (tracks, t) => tracks.map((tier, i) => (i === t ? tier + 1 : tier))

// Its abilities in priority order, with the swaps and additions its tiers grant. A tier that replaces an ability the
// list does not hold (its kind's, or one an earlier tier taught) is a content error, and says so: it would otherwise
// write the new ability past the list's end and leave a hole in the kit.
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

// Its kind's Move (redesign.md §2.2), before mods: the def's `move` (every kind carries one, the Monarch's 0:
// content.test.js). A stat path (statsOf `move`), so tiers, auras and statuses add to it.
export const baseMove = (id) => unitDef(id).move
export const behaviourOf = (u) => unitDef(u.id).behaviour ?? 'walk'
// Its arm (DESIGN §2.3): how far a melee blow with no range of its own reaches: the kind's `arm`, 1, or 2 for a
// long-armed kind (Grave Ghoul, Mantis Reaper).
export const armOf = (u) => unitDef(u.id).arm ?? 1
// How far a blow of its reaches (redesign.md §2.6): a melee blow its own range, else its kind's arm; a
// ranged blow its range (one with none, an `all` shape's, the whole board).
export const blowReach = (u, a) => (a.melee ? a.range ?? armOf(u) : a.range ?? Infinity)
// Its reach, the union of its blows' (blowReach), from its footprint: never past the board (DEPTH), 0 with no blow (the
// Monarch).
export const reachOf = (u) => Math.min(DEPTH, Math.max(0, ...abilitiesOf(u).map(abilityDef).filter(isBlow).map((a) => blowReach(u, a))))
// Whether it fights in melee alone: it has a blow, and every blow of its kit, its tiers' too, is melee (a long arm's
// is: a Grave Ghoul's), so a formation puts it in front (run.js frontier, autoplay.js drafts).
export const meleeOnly = (u) => {
  const blows = abilitiesOf(u).map(abilityDef).filter(isBlow)
  return blows.length > 0 && blows.every((a) => a.melee)
}

// The summons a piece's tiers bring to each battle (a tier's `summon`): shadows of its kind that rise beside it as
// the battle begins and are gone when it ends (turns.js summon). A summon is a shadow, and brings none of its own.
export const summonsOf = (u) => tiersOf(u).reduce((n, t) => n + (t.summon ?? 0), 0)
// The kind its summons are: its own, or for a trine the kind it was made of (its def's `summons`: content.js trineOf).
export const summonedOf = (u) => unitDef(u.id).summons ?? u.id

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
// too. Several sets on one path: the largest wins, so order never matters. A unit's stats are HP, ATK, DEF and Move
// (redesign.md §2.2), and the shares its blows and heals are bent by; `move` the tiles it may go in a turn (baseMove),
// `cooldown.rate` how many turns its skills' cooldowns fall at each turn's end (1; Hasten's 2).
//
// Kept (STATS), as everything it reads is in the key: the unit's kind, level, tiers and position, each mod by identity
// in order (the sums run in it), and TUNING.monarch.hp (the Monarch's baseStats; a test's tuning moves it). A mod is
// never changed once made (content's, a battle's side mods, a status's), and a kind's def never in play. So the stats
// are shared: read only. Dropped whole past STATS_CAP keys (a battle's side mods are made anew each battle).
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

// The stat paths a relic's mods may name that are the run's, not a unit's (redesign.md §2.13.3; run.js runStat reads
// them): Command, the Monarch's max HP, the retinue's room, the free tiers a new kind joins with, the shares the prices
// are cut by (a tier, tiers I–II besides, a recruit, a relic), the share more battles pay, and Arise's reach and tier.
// Every other path is a unit's.
export const RUN_PATHS = ['run.command', 'run.monarchHp', 'run.roster', 'run.soulTiers', 'price.tier', 'price.lowTier', 'price.recruit', 'price.relic', 'essence.gain', 'arise.domain', 'arise.tier']
export const isRunPath = (path) => RUN_PATHS.includes(path)
// The mods the piece relics a soul holds (`relics`, ids) put on it (redesign.md §2.15): a unit's paths alone.
export const heldMods = (u) => (u.relics ?? []).flatMap((id) => relicDef(id).mods ?? []).filter((m) => !isRunPath(m.path))

// A unit of a hidden role (the Monarch) counts toward no synergy.
const hidden = (u) => !!ROLES[unitDef(u.id).role].hidden

// What a piece counts toward its kin's and its role's synergies (the user's rule of 2026-10-16, redesign.md §7.7): a
// trine (three of one kind fused, written or made: content.js `trineOf`, the Pale Court among them) as the three it was
// made of, a trine of a trine as three too (its parts' own fusions are not unfolded further); every other piece once, a
// mixed recipe's and a capstone's too. Either side's alike.
export const TRINE_COUNT = 3
export const synergyWeight = (u) => (unitDef(u.id).trineOf ? TRINE_COUNT : 1)
// A piece and the summons its tiers bring (summonsOf), each summon as the kind it calls up (summonedOf: a trine's, the
// kind it was made of), as the board will count them: for the readers that weigh a field before its battle.
export const withSummons = (u) => [u, ...Array(summonsOf(u)).fill({ id: summonedOf(u) })]

// These units' counts toward synergies, per kin and role: { kin: { id: n }, role: { id: n } }, each unit by its weight
// (synergyWeight: a trine three). `also(u)`, where given, lists the roles a unit counts as besides its own (a holder
// of Mimicry's, a Warden too: turns.js synergiesOf), a role not its own once each, a trine's too (the relic's, not its
// parts').
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

// Synergies active for these units, from their counts per kin and role (synergyCounts).
export function activeSynergies (units, also = null) {
  const c = synergyCounts(units, also)
  return SYNERGIES.filter((s) => synergyActive(s, c))
}

export const synergyActive = (syn, counts) => {
  for (const [axis, id, n] of synergyNeeds(syn)) if (!((counts[axis][id] ?? 0) >= n)) return false
  return true
}
// A synergy's needs as [axis, id, count], kin's then role's, made once a synergy (content's, never changed).
const NEEDS = new Map()
export const synergyNeeds = (syn) => {
  let out = NEEDS.get(syn)
  if (!out) NEEDS.set(syn, (out = ['kin', 'role'].flatMap((axis) => Object.entries(syn.needs[axis] ?? {}).map(([id, n]) => [axis, id, n]))))
  return out
}
// Whether a synergy held holds its rule whole: one split (content.js `full`: Echo's) once its kin or role counts `full`,
// below it its lesser form; any other wherever it holds.
export const synergyFull = (syn, counts) =>
  !syn.full || ['kin', 'role'].every((axis) => Object.keys(syn.needs[axis] ?? {}).every((id) => (counts[axis][id] ?? 0) >= syn.full))

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

// An ability's own range: its `range`, else melee the 8 tiles around and anything else (an ally ability, an `all`
// shape) the whole board. An ally ability reaches by this; a blow by blowReach (a melee one with no range of its own
// reaches its kind's arm).
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

// ── lines of fire (redesign.md §2.19) ───────────────────────────────────────────────────────────

// The tiles strictly between two tiles, in order from the first: a supercover line, every tile the segment between
// their centres touches; one through a corner touches both tiles beside it (the lower first), so no blow slips between
// two diagonal blockers. Made once for every pair, a flat list: pair a × TILES + b's tiles are LINE_TILES from
// LINE_AT[pair] up to LINE_AT[pair + 1] (the board never changes size; a line is at most 17 tiles).
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

// The tiles strictly between tiles a and b, in order from a (LINE_TILES'), as a list.
export const between = (a, b) => Array.from(LINE_TILES.subarray(LINE_AT[a * TILES + b], LINE_AT[a * TILES + b + 1]))

// The ends of a line between two footprints (anchor `a` of side `sa`, `b` of `sb`): each the tile of its footprint
// nearest the other (a 2×2 piece's nearest tile; lane and row each held within its footprint).
export function lineEnds (a, sa, b, sb) {
  const to = sb === 1 ? b : nearestIn(b, sb, a)
  return [sa === 1 ? a : nearestIn(a, sa, to), to]
}
const nearestIn = (t, s, p) => tileAt(Math.min(Math.max(tileX(p), tileX(t)), tileX(t) + s - 1), Math.min(Math.max(tileY(p), tileY(t)), tileY(t) + s - 1))

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

// The camp cells a run piece covers: its footprint from its anchor (footprintSlots); none in the ossuary (slot −1).
export const cellsOf = (u) => (u.slot >= 0 ? footprintSlots(u.slot, sizeOf(u)) ?? [u.slot] : [])

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

// Who a Shape touches, from a list of units (turns.js shape), every distance between footprints (unitDistance).
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
