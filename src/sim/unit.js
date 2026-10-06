// A unit outside the battle loop: base stats and growth, stat modifiers, synergies, where it
// deploys (the party's camp, the foes' formation) and the board it fights on.
import { TUNING } from '../tuning.js'
import { unitDef, campDef, abilityDef, SYNERGIES, ROLES, BONDS, PATHS } from '../content.js'

// ── stats ────────────────────────────────────────────────────────────────────────────────────────

export function baseStats (id, lvl = 1) {
  const def = unitDef(id)
  const out = {}
  for (const [k, v] of Object.entries(def.base)) out[k] = v + (def.growth[k] ?? 0) * (lvl - 1)
  out.hp = Math.round(out.hp)
  return out
}

// A unit as the run keeps it between battles; createBattle adds the per-battle fields.
// slot −1 is the bench: the unit is kept but does not fight. `path` is the upgrade path it has
// committed to (null before its first tier) and `tier` how far along it (0–3).
export function makeUnit (id, { uid, lvl = 1, slot = -1 } = {}) {
  const hp = baseStats(id, lvl).hp
  return { uid, id, lvl, path: null, tier: 0, hp, maxHp: hp, slot }
}

// ── upgrade paths ────────────────────────────────────────────────────────────────────────────────

// What a soul's path tiers make of it. Foes and scouted units have no path.
export const pathsOf = (id) => PATHS[id] ?? []
export const pathDef = (id, path) => pathsOf(id).find((p) => p.id === path) ?? null
export const tiersOf = (u) => (u.path ? pathDef(u.id, u.path).tiers.slice(0, u.tier) : [])
export const pathMods = (u) => tiersOf(u).flatMap((t) => t.mods ?? [])

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

// The least gauge any of its actions costs: below it, a unit can only bank.
export const cheapestOf = (u) => Math.min(TUNING.board.moveCost, ...abilitiesOf(u).map((a) => abilityDef(a).castCost))

const getPath = (o, path) => path.split('.').reduce((v, k) => v?.[k], o)
function setPath (o, path, value) {
  const keys = path.split('.')
  const last = keys.pop()
  for (const k of keys) o = o[k]
  o[last] = value
}

// Modifiers { path, op: add|mul|set, v, pos?, who? } apply add → mul → set; a `pos` mod ('engaged' or
// 'free') only applies to a battle unit in that position (unit.pos), never outside a battle, and a
// `who` mod ({ role?, kin? }, one or a list) only to units it matches. The unit's own path tiers count
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
  for (const m of [...pathMods(unit), ...mods]) {
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

// Synergies active for these units, from their counts per kin and role.
export function activeSynergies (units) {
  const c = { kin: {}, role: {} }
  for (const u of units) {
    const d = unitDef(u.id)
    c.kin[d.kin] = (c.kin[d.kin] ?? 0) + 1
    c.role[d.role] = (c.role[d.role] ?? 0) + 1
  }
  return SYNERGIES.filter((s) => synergyActive(s, c))
}

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

// Columns from the middle lane outward: where a formation fills first.
export const CENTRE_OUT = Array.from({ length: COLS }, (_, i) => (COLS - 1) / 2 + (i % 2 ? -1 : 1) * Math.ceil(i / 2))

export const isWall = (camp, slot) => campDef(camp).map[rowOf(slot)][colOf(slot)] === '#'
export const campOpen = (camp, slot) => Number.isInteger(slot) && slot >= 0 && slot < CAMP_SLOTS && !isWall(camp, slot)

// A grid to place on: how many rows it has and which slots a unit may stand on.
export const FORMATION = { rows: ROWS, open: (slot) => Number.isInteger(slot) && slot >= 0 && slot < SLOTS }
export const campGrid = (camp) => ({ rows: CAMP_ROWS, open: (slot) => campOpen(camp, slot) })

// ── formation bonds ──────────────────────────────────────────────────────────────────────────────

// The slot each bond relation points at from `slot`, or −1 off the formation.
const RELATION = {
  beside: (r, c) => [[r, c - 1], [r, c + 1]],
  behind: (r, c) => [[r + 1, c]],
  ahead: (r, c) => [[r - 1, c]]
}

function matches (u, need, other = null) {
  const d = unitDef(u.id)
  return ['role', 'kin'].every((axis) => {
    const want = need[axis]
    if (want === undefined) return true
    if (want === 'same') return other && d[axis] === unitDef(other.id)[axis]
    return Array.isArray(want) ? want.includes(d[axis]) : d[axis] === want
  })
}

// Bonds held by one side's units, from their formation slots: [{ bond, uid, partner }]. Only the living
// on the field count (a scouted foe has no HP yet and counts); a unit holds each bond once, with the
// first partner found.
export function activeBonds (units) {
  const at = new Map(units.filter((u) => onField(u) && (u.hp ?? 1) > 0).map((u) => [u.slot, u]))
  const out = []
  for (const u of at.values()) {
    for (const bond of BONDS) {
      if (!matches(u, bond.who)) continue
      const partner = RELATION[bond.at](rowOf(u.slot), colOf(u.slot))
        .filter(([r, c]) => r >= 0 && c >= 0 && c < COLS)
        .map(([r, c]) => at.get(slotAt(r, c)))
        .find((p) => p && matches(p, bond.with, u))
      if (partner) out.push({ bond, uid: u.uid, partner: partner.uid })
    }
  }
  return out
}

// Keep units already in an open free slot; place the rest (slot −1, clashing or walled) in the first
// open free slot of their role's preferred row, spilling to the nearest rows. Columns are tried in
// `cols` order, the middle lane first by default; `grid` is FORMATION or a campGrid. Mutates and
// returns units.
export function autoPlace (units, { cols = CENTRE_OUT, grid = FORMATION } = {}) {
  const taken = new Set()
  const rest = []
  for (const u of units) {
    if (grid.open(u.slot) && !taken.has(u.slot)) taken.add(u.slot)
    else rest.push(u)
  }
  const rows = [...Array(grid.rows).keys()]
  for (const u of rest) {
    const pref = ROLES[unitDef(u.id).role]?.autoRow ?? 1
    u.slot = -1
    for (const row of rows.slice().sort((a, b) => Math.abs(a - pref) - Math.abs(b - pref) || a - b)) {
      for (const c of cols) {
        const slot = slotAt(row, c)
        if (u.slot < 0 && grid.open(slot) && !taken.has(slot)) { u.slot = slot; taken.add(slot) }
      }
      if (u.slot >= 0) break
    }
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
export const onBoard = (x, y) => x >= 0 && x < LANES && y >= 0 && y < DEPTH
export const distance = (a, b) => Math.max(Math.abs(tileX(a) - tileX(b)), Math.abs(tileY(a) - tileY(b)))

export function deployTile (side, slot) {
  const y = side === 'party' ? CAMP_ROWS - 1 - rowOf(slot) : DEPTH - ROWS + rowOf(slot)
  return tileAt(colOf(slot), y)
}

// The board tiles a camp's walls stand on.
export const wallTiles = (camp) => [...Array(CAMP_SLOTS).keys()].filter((slot) => isWall(camp, slot)).map((slot) => deployTile('party', slot))

// How deep into its own formation a tile is for `side`: 0 at the board's middle, rising to its back edge.
export const depthFor = (side, tile) => side === 'party' ? DEPTH - 1 - tileY(tile) : tileY(tile)

export function neighbours (tile) {
  const x = tileX(tile)
  const y = tileY(tile)
  const out = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && onBoard(x + dx, y + dy)) out.push(tileAt(x + dx, y + dy))
  }
  return out
}

// The tiles a unit can step to from `tile` past `walls` (a Set of tiles): no wall, and no diagonal
// squeezing past a wall's corner. Moves are symmetric, so this also lists where a step to `tile` can
// come from.
export function steps (tile, walls) {
  const x = tileX(tile)
  const y = tileY(tile)
  return neighbours(tile).filter((n) => !walls.has(n) &&
    (tileX(n) === x || tileY(n) === y || (!walls.has(tileAt(tileX(n), y)) && !walls.has(tileAt(x, tileY(n))))))
}

// Melee reaches the 8 tiles around; a ranged ability its `range`; one without a range (an `all`
// shape) reaches the whole board.
export const rangeOf = (ability) => ability.range ?? (ability.melee ? 1 : Infinity)

// The living allies whose aura reaches this unit.
export const auraGivers = (units, u) => units.filter((a) => a !== u && a.side === u.side && alive(a) && auraOf(a) &&
  distance(a.tile, u.tile) <= auraOf(a).range)

// A unit with a living foe next to it is engaged: it stays put unless its role slips free.
export const foesNextTo = (units, u) => units.filter((e) => e.side !== u.side && alive(e) && distance(e.tile, u.tile) === 1)
export const isEngaged = (units, u) => foesNextTo(units, u).length > 0

// Candidate primary targets for an ability: units on the side it aims at within its range (an ally
// ability without a range reaches every ally).
export function reachable (units, actor, ability) {
  if (ability.shape === 'self') return [actor]
  const side = isAllyShape(ability.shape) ? actor.side : enemySide(actor.side)
  const range = rangeOf(ability)
  return livingOn(units, side).filter((u) => distance(actor.tile, u.tile) <= range)
}

// row: everyone on the primary's side across the board in its row; column: everyone in its lane;
// blast: the primary and everyone on its side next to it; all_allies: every ally within range.
export function expand (units, actor, ability, primary) {
  const living = livingOn(units, primary.side)
  switch (ability.shape) {
    case 'self': return [actor]
    case 'column': return living.filter((u) => tileX(u.tile) === tileX(primary.tile))
    case 'row': return living.filter((u) => tileY(u.tile) === tileY(primary.tile))
    case 'blast': return living.filter((u) => distance(u.tile, primary.tile) <= 1)
    case 'all_allies': return living.filter((u) => distance(u.tile, actor.tile) <= rangeOf(ability))
    case 'all': return living
    default: return [primary]
  }
}
