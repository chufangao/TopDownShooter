// Damage, hit, crit, affinity (§2) — deliberately boring and entirely tunable.
//
// Every term is a named field on a data object. There is no hidden state and no float accumulation
// across ticks: damage is integer at the point of application. Every constant comes from
// `tuning.json` (§16.1), so the whole balance surface is one reviewable, patchable, hot-reloadable
// file and this module never needs editing to rebalance the game.
//
// Pure. No clock, no Math.random, no Phaser.

export const clamp = (lo, hi, v) => Math.min(hi, Math.max(lo, v))

/** ACC_a / (ACC_a + EVA_d), clamped. Both zero → a coin flip rather than a NaN. */
export function hitChance (acc, eva, tuning) {
  const t = tuning.hit
  const denom = acc + eva
  return clamp(t.min, t.max, denom <= 0 ? 0.5 : acc / denom)
}

export function critChance (crt, tuning) {
  const t = tuning.crit
  return clamp(t.min, t.max, crt / t.divisor)
}

/** 0.5 | 1.0 | 1.5 | 2.0 — declared by the attacking element's def, so mods can add elements. */
export function affinity (attackElementDef, defenderElementId) {
  if (!attackElementDef || !defenderElementId) return 1
  return attackElementDef.affinity?.[defenderElementId] ?? 1
}

export function rollVariance (rng, tuning) {
  const [lo, hi] = tuning.variance
  return rng.range(lo, hi)
}

/**
 * The formula itself. Takes numbers, returns a number — nothing here knows what a unit is.
 *
 * @param {object} p
 * @param {number} p.power     ability power
 * @param {number} p.atk       attacker ATK, already modifier-resolved
 * @param {number} p.def       defender DEF, already modifier-resolved
 * @param {number} [p.affinity=1]
 * @param {boolean} [p.isCrit=false]
 * @param {number} [p.variance=1]
 * @param {number} [p.add=0]   flat add from the damage:compute proposal
 * @param {number} [p.mul=1]   multiplier from the damage:compute proposal (rows, Pacts, statuses)
 * @param {number} [p.pierce=0] fraction of DEF ignored, 0..1
 */
export function computeDamage (p, tuning) {
  const t = tuning.damage
  const def = Math.max(0, p.def * (1 - (p.pierce ?? 0)))
  const raw = p.power * (p.atk / t.atkDivisor)
  const mitigated = raw * (t.defConstant / (t.defConstant + def))
  // critMul comes off the damage:compute proposal when a Pact or item has raised it (§11.5).
  const crit = p.isCrit ? (p.critMul ?? tuning.crit.mult) : 1
  const total = (mitigated + (p.add ?? 0)) * (p.affinity ?? 1) * crit * (p.variance ?? 1) * (p.mul ?? 1)
  return Math.max(t.min, Math.round(total))
}

/**
 * Recruitment odds (§2). The whole acquisition loop rests on this being generous enough that you
 * are tempted to stop killing something while it is still hitting you.
 *
 *   chance = BASE[tier] * (1 + charm/100) * (1 + 2*(1 - hpPct)) * kinAffinity * itemMods * decay^attempts
 */
export function persuadeChance (p, tuning) {
  const t = tuning.persuade
  const base = t.base[String(p.tier)] ?? t.base.default
  const chance = base *
    (1 + (p.charm ?? 0) / t.charmDivisor) *
    (1 + t.weakenBonus * (1 - clamp(0, 1, p.hpPct))) *
    (p.kinAffinity ?? 1) *
    (p.itemMods ?? 1) *
    Math.pow(t.decay, p.attempts ?? 0)
  return clamp(0, t.max, chance)
}
