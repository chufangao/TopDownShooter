// XP and levelling (§3) — the feedback loop that closes the run.
//
// Foes scale with floor depth from the first encounter. Without this file the party does not, so a
// run structurally cannot survive floor 2 no matter how well it was assembled — which is exactly
// what every browser run did before it existed. This is not a reward system bolted onto combat; it
// is the term on the other side of §6.2's depth curve.
//
// Every constant is in `tuning.json` (§16.1), so the whole curve is sweepable without editing code.
//
// Pure JS. No clock, no Math.random, no Phaser.

import { resolveStats } from './kernel/modifiers.js'
import { activeSynergies } from './synergy.js'
import { statBlock, unitBaseStats } from './party.js'
import { rulesFor } from './doctrine.js'

/** XP required to go from `lvl` to `lvl + 1`. 28 · 76 · 138 · 209 … ~2.8k cumulative to level 10. */
export const xpToNext = (lvl, tuning) =>
  Math.round(tuning.xp.base * Math.pow(Math.max(1, lvl), tuning.xp.exponent))

/**
 * ★1 caps at 10; every fusion star buys five more levels (§3).
 *
 * This is what makes fusion a genuine long-term goal rather than a slot-saving convenience: by
 * floor 8 the foes are level 11 and an unfused party is hard-capped below them.
 */
export const levelCap = (star, tuning) => tuning.xp.cap + tuning.xp.capPerStar * (Math.max(1, star ?? 1) - 1)

/**
 * What defeating one foe is worth to one participant.
 *
 * Note "to one participant", not "to the party": the value is NOT a pool divided by headcount.
 * Dividing would mean every recruit slows down everyone already on the roster, which puts the
 * levelling curve in direct opposition to the acquisition loop that the entire game is built
 * around — a 12-unit party would level three times slower than a 4-unit one and the party cap
 * would become a trap. Each participant earns the full value independently.
 */
export function defeatXp (def, lvl, tuning, { recruited = false } = {}) {
  const x = tuning.xp
  const raw = x.perTier * (def.tier ?? 1) * (1 + x.perLevel * (Math.max(1, lvl) - 1))
  return Math.max(1, Math.round(raw * (recruited ? x.recruitShare : 1)))
}

/**
 * Everything the party earned from a finished battle, per participant, before shares and `xp.mult`.
 *
 * Awarded whether the fight was won or lost. A wipe on floor 3 still killed things on the way down,
 * and zeroing that turns a bad run into a run that also taught you nothing.
 */
export function battleXp (registry, battle, tuning) {
  let total = 0
  for (const u of battle.units) {
    if (u.side !== 'foe') continue
    const killed = u.hp <= 0
    const recruited = !!u.left && u.hp > 0
    if (!killed && !recruited) continue
    total += defeatXp(registry.get('unit', u.defId), u.lvl ?? 1, tuning, { recruited })
  }
  return total
}

/**
 * Give one unit XP and level it up as far as that XP reaches. Mutates and returns a record.
 *
 * Levelling restores nothing. HP is carried across as a *fraction* of the new maximum, so a unit
 * that finished a fight at 12% finishes the level-up at 12%. A level-up that healed would be a
 * silent second recovery channel on top of §6.1's, and it would be the one nobody accounted for
 * when tuning the first.
 */
export function gainXp (registry, unit, amount, tuning, { doctrine = null, forms = null } = {}) {
  const def = registry.get('unit', unit.defId)
  const cap = levelCap(unit.star, tuning)
  const from = unit.lvl
  const branched = []

  // Banked past the cap on purpose, never discarded: the day fusion raises the cap, the levels the
  // unit already earned are waiting for it.
  unit.xp = (unit.xp ?? 0) + Math.max(0, Math.round(amount))

  while (unit.lvl < cap && unit.xp >= xpToNext(unit.lvl, tuning)) {
    unit.xp -= xpToNext(unit.lvl, tuning)
    unit.lvl++
    const pick = chooseBranch(def, unit, doctrine, { registry, forms })
    if (pick) { unit.branch.push(pick); branched.push(pick) }
  }

  if (unit.lvl !== from) rescaleHp(def, unit)
  return { uid: unit.uid, defId: unit.defId, gained: Math.max(0, Math.round(amount)), from, to: unit.lvl, branched }
}

/**
 * The whole roster's share of one battle (§3).
 *
 * Participation, not kill credit: a Vanguard that spent the fight soaking the front row earns what
 * the Ranger behind it earned. Kill-credit XP would let the party's best unit run away with the run
 * and would actively punish the units doing the job the formation grid asks of them.
 *
 * The fallen earn a half share rather than nothing — zeroing it compounds one bad fight into a unit
 * that can never catch up, which is a death spiral wearing a progression system's clothes.
 *
 * Call this BEFORE `addRecruits`: someone talked round mid-fight was on the other side for it.
 *
 * @returns {{awards: Array, perParticipant: number}}
 */
export function awardXp (kernel, roster, battle, { tuning, doctrine = null } = {}) {
  const R = kernel.registry
  const base = battleXp(R, battle, tuning)
  const fought = new Set(battle.units.filter((u) => u.side === 'party').map((u) => u.uid))
  const mults = xpMultipliers(kernel, roster, tuning)
  const awards = []

  for (const u of roster) {
    if (!fought.has(u.uid)) continue
    const share = u.hp > 0 ? 1 : tuning.xp.fallenShare
    const amount = base * share * (mults.get(u.uid) ?? 1)
    if (amount > 0) awards.push(gainXp(R, u, amount, tuning, { doctrine, forms: kernel.forms }))
  }

  return { awards, perParticipant: base }
}

// ── internals ───────────────────────────────────────────────────────────────────────────────────

/**
 * `xp.mult` per unit, through the one stat pipeline (§11.3) — so a Lattice node, an item and a Pact
 * all move XP the same way, and none of them needs to know this file exists.
 */
function xpMultipliers (kernel, roster, tuning) {
  const ctx = { registry: kernel.registry, forms: kernel.forms, rng: kernel.rng, tuning }
  const synergies = activeSynergies(ctx, roster.filter((u) => u.hp > 0))
  const shared = synergies.flatMap((s) => s.modifiers.map((m) => ({ ...m, src: s.id })))

  const out = new Map()
  for (const u of roster) {
    const def = kernel.registry.get('unit', u.defId)
    out.set(u.uid, resolveStats(statBlock(def, u.lvl, tuning), shared).xp.mult)
  }
  return out
}

/** Stats follow `base + growth × (lvl − 1)`; §3 says the level-up must not double as a heal. */
function rescaleHp (def, unit) {
  const max = Math.max(1, Math.round(unitBaseStats(def, unit.lvl).hp))
  const frac = unit.maxHp > 0 ? unit.hp / unit.maxHp : 0
  unit.hp = unit.hp > 0 ? Math.max(1, Math.round(max * frac)) : 0
  unit.maxHp = max
}

/**
 * The level 5 / level 10 branch pick — Succession (§3, §4.2).
 *
 * It is a Doctrine rule, never a prompt. §3 originally concluded that a modal would break the
 * never-touch-the-controls rule, and §4.1 refined it: what breaks the rule is *waiting for an
 * answer*, not asking a question. So the pick is taken here, by default, the moment it is earned —
 * and a Precedent afterwards offers to set the policy for every unit that reaches level 5 from
 * here on. With no rule written the first option is taken, so an unauthored Doctrine is never a
 * blocked one and the question is always asked retroactively.
 *
 * @param {object} [ctx]  `{registry, forms}` — needed only to evaluate a rule's `when`. A rule with
 *   a `when` and no evaluator is skipped rather than silently treated as matching.
 */
function chooseBranch (def, unit, doctrine, { registry = null, forms = null } = {}) {
  const branch = (def.branches ?? []).find((b) => b.at === unit.lvl)
  if (!branch?.opts?.length) return null

  for (const rule of rulesFor(doctrine, 'branch')) {
    if (!branch.opts.includes(rule.prefer)) continue
    if (rule.when === undefined || rule.when === true) return rule.prefer
    if (!forms) continue
    // `$self` is the unit that just levelled — "IF role = Vanguard → prefer defensive" (§3).
    if (forms.eval(rule.when, { vars: { self: unit, actor: unit, target: unit }, registry })) return rule.prefer
  }
  return branch.opts[0]
}
