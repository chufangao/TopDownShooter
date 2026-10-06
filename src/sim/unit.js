// A unit outside the battle loop: base stats and growth, stat modifiers, synergies, and the 3×4
// formation grid it stands on.
import { TUNING } from '../tuning.js'
import { unitDef, SYNERGIES, ROLES } from '../content.js'

// ── stats ────────────────────────────────────────────────────────────────────────────────────────

export function baseStats (id, lvl = 1) {
  const def = unitDef(id)
  const out = {}
  for (const [k, v] of Object.entries(def.base)) out[k] = v + (def.growth[k] ?? 0) * (lvl - 1)
  out.hp = Math.round(out.hp)
  return out
}

// A unit as the run keeps it between battles; createBattle adds the per-battle fields.
export function makeUnit (id, { uid, lvl = 1, slot = -1 } = {}) {
  const hp = baseStats(id, lvl).hp
  return { uid, id, lvl, xp: 0, hp, maxHp: hp, slot }
}

const getPath = (o, path) => path.split('.').reduce((v, k) => v?.[k], o)
function setPath (o, path, value) {
  const keys = path.split('.')
  const last = keys.pop()
  for (const k of keys) o = o[k]
  o[last] = value
}

// Modifiers { path, op: add|mul|set, v, row? } apply add → mul → set; a `row` mod only applies to a
// unit standing in that row. Several sets on one path: the largest wins, so order never matters.
export function statsOf (unit, mods = []) {
  const b = baseStats(unit.id, unit.lvl)
  const s = {
    hp: b.hp, atk: b.atk, def: b.def, spd: b.spd, acc: b.acc, eva: b.eva, crt: b.crt, charm: b.charm ?? 0,
    gauge: { rate: 1 },
    damage: { dealt: 1, taken: 1 },
    heal: { given: 1 },
    persuade: { threshold: TUNING.persuade.threshold, chance: 1 }
  }
  const acc = new Map()
  for (const m of mods) {
    if (m.row !== undefined && rowOf(unit.slot) !== m.row) continue
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
  return SYNERGIES.filter((s) => s.active(c))
}

// ── formation ────────────────────────────────────────────────────────────────────────────────────

// 3×4 grid: slot = row × 4 + col, row 0 is the front. Melee reaches only the enemy's frontmost row.

export const COLS = 4
export const ROWS = 3
export const SLOTS = COLS * ROWS

export const rowOf = (slot) => Math.floor(slot / COLS)
export const colOf = (slot) => slot % COLS
export const slotAt = (row, col) => row * COLS + col
export const rowMods = (slot) => TUNING.rows[rowOf(slot)]

export const alive = (u) => u.hp > 0 && !u.left
export const livingOn = (units, side) => units.filter((u) => u.side === side && alive(u))
export const enemySide = (side) => (side === 'party' ? 'foe' : 'party')
export const isAllyShape = (shape) => shape === 'ally' || shape === 'all_allies' || shape === 'self'

function frontmostRow (units, side) {
  for (let r = 0; r < ROWS; r++) {
    if (units.some((u) => u.side === side && alive(u) && rowOf(u.slot) === r)) return r
  }
  return -1
}

// Candidate primary targets for an ability.
export function reachable (units, actor, ability) {
  if (ability.shape === 'self') return [actor]
  if (isAllyShape(ability.shape)) return livingOn(units, actor.side)
  const side = enemySide(actor.side)
  const enemies = livingOn(units, side)
  if (!ability.melee) return enemies
  const front = frontmostRow(units, side)
  return enemies.filter((u) => rowOf(u.slot) === front)
}

export function expand (units, actor, ability, primary) {
  const living = livingOn(units, primary.side)
  switch (ability.shape) {
    case 'self': return [actor]
    case 'column': return living.filter((u) => colOf(u.slot) === colOf(primary.slot))
    case 'row': return living.filter((u) => rowOf(u.slot) === rowOf(primary.slot))
    case 'all':
    case 'all_allies': return living
    default: return [primary]
  }
}

// Keep units already in a legal free slot; place the rest (slot −1 or clashing) in the frontmost
// free slot of their role's preferred row, spilling to the other rows. Mutates and returns units.
export function autoPlace (units) {
  const taken = new Set()
  const rest = []
  for (const u of units) {
    if (Number.isInteger(u.slot) && u.slot >= 0 && u.slot < SLOTS && !taken.has(u.slot)) taken.add(u.slot)
    else rest.push(u)
  }
  for (const u of rest) {
    const pref = ROLES[unitDef(u.id).role]?.autoRow ?? 1
    u.slot = -1
    for (const row of [pref, ...[0, 1, 2].filter((r) => r !== pref)]) {
      for (let c = 0; c < COLS && u.slot < 0; c++) {
        if (!taken.has(slotAt(row, c))) { u.slot = slotAt(row, c); taken.add(u.slot) }
      }
      if (u.slot >= 0) break
    }
  }
  return units
}
