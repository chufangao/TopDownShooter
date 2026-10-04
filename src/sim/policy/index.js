// Doctrine → an action. This is where the player lives (§4).
//
// The shape was always the shape: an ordered ability list with `when` gates, and an ordered
// targeting priority list. What changed at M3 is only where `doctrine` comes from — the editors
// write the same JSON this file has been reading all along, and it arrives on the battle context
// rather than as a default parameter.
//
// Three behaviours worth naming because they are load-bearing:
//
//   * A unit whose highest-priority passing ability is unaffordable WAITS and banks gauge. That
//     is what lets a 220-cost Dirge exist beside a 100-cost bolt without the bolt starving it.
//     Falling through to something cheaper is opt-in per rule, via an explicit ELSE (§2).
//   * Which enemy row gets attacked is an aggro roll (§3: the front row draws ~60%); which unit
//     inside that row is picked is the doctrine's rule, with no randomness. So formation decides
//     the shape of the fight and the doctrine decides the focus.
//   * Every gate goes through `evalRule`, so every rule has a fire count (§4.1). A rule that never
//     fires is the most common authoring bug and is invisible without one.

import { reachable, expand, rowOf, rowMods, ROWS, livingOn } from '../combat/formation.js'
import { persuadable } from '../combat/persuade.js'
import { exprContext } from '../combat/battle.js'
import {
  DEFAULT_DOCTRINE as DOCTRINE, TARGET_RULES, ANY_ABILITY,
  recruitVerdict, evalRule, targetModesFor, rulesFor
} from '../doctrine.js'

export { TARGET_RULES }
export const DEFAULT_DOCTRINE = DOCTRINE

const isAllyShape = (shape) => shape === 'ally' || shape === 'all_allies' || shape === 'self'

/**
 * Apply a targeting priority list. Comparators may need resolved stats ("weakest defence"), so the
 * battle context travels with the sort — outside a battle they fall back to base stats.
 */
function order (candidates, modes, ctx) {
  const cmps = modes.map((m) => TARGET_RULES[m]).filter(Boolean)
  return candidates.slice().sort((a, b) => {
    for (const cmp of cmps) {
      const d = cmp(a, b, ctx)
      if (d !== 0) return d
    }
    return a.slot - b.slot   // total order, so the same seed always resolves the same way
  })
}

/** Aggro roll over the rows that hold a reachable target (§3). */
function pickRow (candidates, ctx) {
  const rows = []
  const weights = []
  for (let r = 0; r < ROWS; r++) {
    const inRow = candidates.filter((u) => rowOf(u.slot) === r)
    if (inRow.length === 0) continue
    rows.push(inRow)
    weights.push(rowMods(ctx.tuning, r * 4).aggro ?? 1)
  }
  if (rows.length === 0) return []
  if (rows.length === 1) return rows[0]
  return ctx.rng.weighted(rows, weights)
}

/**
 * The Recruit doctrine, checked before anything else: a weakened enemy worth talking to outranks
 * another swing. This is the line the post-mortem will name when a run dies with a full graveyard
 * and an empty roster.
 *
 * @returns {{ability, targets, cost}|null|'wait'} 'wait' means "bank gauge for the attempt"
 */
function considerRecruit (ctx, actor, doctrine, stats) {
  const abilityId = (doctrine.granted ?? []).find((id) => ctx.registry.has('ability', id))
  if (!abilityId) return null
  const ability = ctx.registry.get('ability', abilityId)
  const threshold = stats.persuade?.threshold ?? ctx.tuning.persuade.threshold

  const enemies = livingOn(ctx.battle, actor.side === 'party' ? 'foe' : 'party')
    // Filtered here as well as refused by the op: a Recruit rule that matches a boss would
    // otherwise have the whole party stand around spending gauge on an attempt that cannot land,
    // and lose the fight to its own doctrine (§6.3).
    .filter((u) => persuadable(ctx.registry.get('unit', u.defId)))
    .filter((u) => u.hp / u.maxHp <= threshold)
    .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.slot - b.slot)

  for (const target of enemies) {
    // Tag counts in a Recruit rule are counts of the roster, not of the survivors on the field.
    const rules = { ...exprContext(ctx, actor, target), party: ctx.battle.roster ?? undefined }
    const verdict = recruitVerdict(ctx, target, doctrine, rules)
    if (verdict.action !== 'persuade') continue
    if (target.hp / target.maxHp > verdict.at) continue

    const cost = ability.castCost * (stats.gauge.cost ?? 1)
    if (actor.gauge < cost) return 'wait'
    return { ability, targets: [target], cost }
  }
  return null
}

/**
 * The Ability editor (§4): `IF allies.below(50% HP) ≥ 3 THEN heal_pulse` · `ELSE basic`.
 *
 * An empty list means "the unit's own abilities, in def order" — which is exactly what M1 and M2
 * did, so a player who has never opened this editor is never worse off. A rule naming an ability
 * the unit does not have is skipped rather than erroring: a Doctrine is written once and applied to
 * a roster that changes every fight, so "my Channeler rule" must be harmless on a Vanguard.
 *
 * @returns {string[]} ability ids to try, in order
 */
function abilityOrder (ctx, actor, doctrine) {
  const def = ctx.registry.get('unit', actor.defId)
  const rules = rulesFor(doctrine, 'ability')
  if (rules.length === 0) return def.abilities

  const has = new Set(def.abilities)
  const vars = exprContext(ctx, actor, null)
  const out = []

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if (rule.use !== ANY_ABILITY && !has.has(rule.use)) continue
    if (!evalRule(ctx, rule.when, vars, 'ability', i)) continue
    // ELSE is opt-in per rule (§2). Without it a rule is a commitment: the unit banks gauge for the
    // ability it named rather than quietly settling for a cheaper one, which is the only way an
    // expensive ability stays reachable.
    if (rule.use === ANY_ABILITY) return out.concat(def.abilities)
    out.push(rule.use)
    if (!rule.orElse) return out
  }

  // No rule matched. Fall back to the unit's own list rather than standing still — a player who has
  // not written a catch-all should lose a *choice*, never a turn (§3's "never blocked" default).
  return out.concat(def.abilities)
}

/**
 * @param {object} ctx     battle context; carries the run's doctrine and the trace sink
 * @param {object} actor
 * @param {object} [doctrine]  overrides `ctx.doctrine`, for tests that want one battle's policy
 * @returns {{ability, targets, cost}|null} null means "not ready" — either banking gauge for a
 *   pricier ability, or nothing it can do has a legal target.
 */
export function chooseAction (ctx, actor, doctrine = ctx.doctrine ?? DOCTRINE) {
  const def = ctx.registry.get('unit', actor.defId)
  const stats = ctx.statsOf(actor)

  // Only the party recruits. An enemy talking your Tomb Knight into defecting is a fine idea, and
  // it is a Pact away — but it is not the default game.
  if (actor.side === 'party') {
    const recruit = considerRecruit(ctx, actor, doctrine, stats)
    if (recruit === 'wait') return null
    if (recruit) return recruit
  }

  // The player's targeting list is theirs; a foe fights by the shipped default, or the game would
  // get easier every time you wrote a better rule for yourself.
  const policy = actor.side === 'party' ? doctrine : DOCTRINE

  for (const abilityId of abilityOrder(ctx, actor, policy)) {
    const ability = ctx.registry.get('ability', abilityId)

    if (ability.when && !ctx.forms.eval(ability.when, exprContext(ctx, actor, null))) continue

    const candidates = reachable(ctx.battle, actor, ability)
    if (candidates.length === 0) continue

    // Affordable? If not, stop here rather than falling through — waiting for this ability IS the
    // decision. Falling through would silently demote every expensive ability in the game.
    const cost = ability.castCost * (stats.gauge.cost ?? 1)
    if (actor.gauge < cost) return null

    const ally = isAllyShape(ability.shape)
    const pool = ally ? candidates : pickRow(candidates, ctx)
    const primary = order(pool, targetModesFor(policy, def.role, ally), ctx)[0]
    if (!primary) continue

    const proposal = ctx.hooks.emit('target:select',
      { targets: expand(ctx.battle, actor, ability, primary) },
      Object.assign(Object.create(ctx), { actor, target: primary, ability }))

    if (!proposal.targets?.length) continue
    return { ability, targets: proposal.targets, cost }
  }
  return null
}
