// Recruitment rolls (§2) — the inputs to the formula, gathered from the battle.
//
//   chance = BASE[enemy.tier]
//          * (1 + charm / 100)                  party-wide Charm
//          * (1 + 2 * (1 - enemy.hpPct))        the weaker, the better
//          * kinAffinity(party, enemy.kin)      sharing a Kin tag helps
//          * itemMods
//          * 0.7 ** enemy.persuadeAttempts      each failure hardens them
//
// The formula itself lives in formula.js with every other number; this file only decides what to
// feed it. Keeping the two apart is what lets tools/balance.js sweep the curve without a battle.

import { persuadeChance } from './formula.js'
import { livingOn } from './formation.js'

/**
 * Whether a unit can be talked to at all (§6.3).
 *
 * A boss is persuade-immune by default and any boss may opt back in, because a recruitable boss
 * should be a designed exception rather than an accident of the tier table. Expressed as a default
 * rather than as a hardcoded `if (def.boss)` so a pack can ship either kind without touching code.
 */
export const persuadable = (def) => def.persuadable ?? !def.boss

/** Charm is a party-wide stat: everyone still standing contributes (§2). */
export function partyCharm (ctx, side) {
  let total = 0
  for (const u of livingOn(ctx.battle, side)) total += ctx.statsOf(u).charm ?? 0
  return total
}

/** Sharing a Kin tag helps — recruiting an Undead is easier when Undead already ride with you. */
export function kinAffinity (ctx, side, targetDef) {
  const shares = livingOn(ctx.battle, side)
    .some((u) => ctx.registry.get('unit', u.defId).kin === targetDef.kin)
  return shares ? ctx.tuning.persuade.kinAffinity : 1
}

/**
 * Everything the roll needs, as one object — so the same numbers can be logged into the event, put
 * in a post-mortem, and asserted against by the M2 gate test.
 */
export function persuadeInputs (ctx, actor, target) {
  const def = ctx.registry.get('unit', target.defId)
  const stats = ctx.statsOf(actor)
  return {
    tier: def.tier,
    hpPct: target.maxHp > 0 ? target.hp / target.maxHp : 0,
    charm: partyCharm(ctx, actor.side),
    kinAffinity: kinAffinity(ctx, actor.side, def),
    itemMods: stats.persuade?.chance ?? 1,
    attempts: target.persuadeAttempts ?? 0,
    threshold: stats.persuade?.threshold ?? ctx.tuning.persuade.threshold
  }
}

export function rollChance (inputs, tuning) {
  return persuadeChance(inputs, tuning)
}
