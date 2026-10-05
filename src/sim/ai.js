// Default policy: try abilities in def order; skip one whose `when` fails or that has no legal
// target; if the first viable one is unaffordable, bank gauge rather than fall through.
import { unitDef, abilityDef } from '../content/index.js'
import { reachable, expand, rowOf, rowMods, livingOn, enemySide, isAllyShape, ROWS } from './formation.js'

export function view (battle, unit) {
  return {
    self: unit,
    allies: livingOn(battle.units, unit.side),
    enemies: livingOn(battle.units, enemySide(unit.side)),
    t: battle.t
  }
}

// Abilities that pass their condition and have a legal target, in def order.
export function viable (battle, unit) {
  const s = view(battle, unit)
  const out = []
  for (const id of unitDef(unit.id).abilities) {
    const ability = abilityDef(id)
    if (ability.when && !ability.when(s)) continue
    const candidates = reachable(battle.units, unit, ability)
    if (candidates.length) out.push({ ability, candidates })
  }
  return out
}

const byHpPct = (a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.slot - b.slot
const lowest = (list) => list.slice().sort(byHpPct)[0]

// Aggro roll over the rows that hold a candidate (front draws most).
function pickRow (candidates, rng) {
  const rows = []
  const weights = []
  for (let r = 0; r < ROWS; r++) {
    const inRow = candidates.filter((u) => rowOf(u.slot) === r)
    if (!inRow.length) continue
    rows.push(inRow)
    weights.push(rowMods(r * 4).aggro)
  }
  return rows.length === 1 ? rows[0] : rng.weighted(rows, weights)
}

function pickTarget (battle, unit, ability, candidates) {
  if (isAllyShape(ability.shape)) return lowest(candidates)
  const f = battle.focus
  if (unit.side === 'party' && f && battle.t < f.until) {
    const hit = candidates.find((u) => u.uid === f.target)
    if (hit) return hit
  }
  return lowest(pickRow(candidates, battle.rng))
}

// → { ability, targets, cost } or null (banking, or nothing to do).
export function chooseAction (battle, unit) {
  const options = viable(battle, unit)
  let pick = options[0]
  if (unit.unleash) pick = options.find((o) => o.ability.id === unit.unleash) ?? pick
  if (!pick || unit.gauge < pick.ability.castCost) return null
  const primary = pickTarget(battle, unit, pick.ability, pick.candidates)
  return { ability: pick.ability, targets: expand(battle.units, unit, pick.ability, primary), cost: pick.ability.castCost }
}
