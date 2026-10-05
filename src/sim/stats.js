import { TUNING, unitDef, SYNERGIES } from '../content/index.js'
import { rowOf } from './formation.js'

export function baseStats (id, lvl = 1) {
  const def = unitDef(id)
  const out = {}
  for (const [k, v] of Object.entries(def.base)) out[k] = v + (def.growth[k] ?? 0) * (lvl - 1)
  out.hp = Math.round(out.hp)
  return out
}

export function makeUnit (id, { uid, lvl = 1, side = 'party', slot = -1 } = {}) {
  const hp = baseStats(id, lvl).hp
  return { uid, id, side, lvl, xp: 0, hp, maxHp: hp, slot, gauge: 0, statuses: [], persuadeAttempts: 0, left: false }
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

// counts of living units per kin and role, for synergy activation.
export function tagCounts (units) {
  const c = { kin: {}, role: {} }
  for (const u of units) {
    const d = unitDef(u.id)
    c.kin[d.kin] = (c.kin[d.kin] ?? 0) + 1
    c.role[d.role] = (c.role[d.role] ?? 0) + 1
  }
  return c
}

export function activeSynergies (units) {
  const c = tagCounts(units)
  return SYNERGIES.filter((s) => s.active(c))
}
