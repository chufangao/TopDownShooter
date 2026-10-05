// 3×4 grid: slot = row × 4 + col, row 0 is the front. Melee reaches only the enemy's frontmost row.
import { TUNING, unitDef, ROLES } from '../content/index.js'

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

export function frontmostRow (units, side) {
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
