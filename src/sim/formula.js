import { TUNING } from '../content/index.js'

export const clamp = (lo, hi, v) => Math.min(hi, Math.max(lo, v))

export function hitChance (acc, eva, tuning = TUNING) {
  const denom = acc + eva
  return clamp(tuning.hit.min, tuning.hit.max, denom <= 0 ? 0.5 : acc / denom)
}

export function critChance (crt, tuning = TUNING) {
  const t = tuning.crit
  return clamp(t.min, t.max, crt / t.divisor)
}

export function affinity (attackElement, defenderElementId) {
  if (!attackElement || !defenderElementId) return 1
  return attackElement.affinity?.[defenderElementId] ?? 1
}

export function rollVariance (rng, tuning = TUNING) {
  const [lo, hi] = tuning.variance
  return rng.range(lo, hi)
}

// p: { power, atk, def, affinity, isCrit, critMul, variance, mul }
export function computeDamage (p, tuning = TUNING) {
  const t = tuning.damage
  const raw = p.power * (p.atk / t.atkDivisor)
  const mitigated = raw * (t.defConstant / (t.defConstant + Math.max(0, p.def)))
  const crit = p.isCrit ? (p.critMul ?? tuning.crit.mult) : 1
  const total = mitigated * (p.affinity ?? 1) * crit * (p.variance ?? 1) * (p.mul ?? 1)
  return Math.max(t.min, Math.round(total))
}

// chance = base[tier] × (1 + charm/100) × (1 + 2(1 − hp%)) × kinAffinity × itemMods × decay^attempts
export function persuadeChance (p, tuning = TUNING) {
  const t = tuning.persuade
  const base = t.base[p.tier] ?? t.base.default
  const chance = base *
    (1 + (p.charm ?? 0) / t.charmDivisor) *
    (1 + t.weakenBonus * (1 - clamp(0, 1, p.hpPct))) *
    (p.kinAffinity ?? 1) *
    (p.itemMods ?? 1) *
    Math.pow(t.decay, p.attempts ?? 0)
  return clamp(0, t.max, chance)
}
