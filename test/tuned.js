// Runs fn with TUNING's values at `patch` (a { section: { key: value } } map), restoring them after: for
// tests whose scenes were built on other numbers than the current balance (the rule under test reads TUNING).
import { TUNING } from '../src/tuning.js'
import { RELICS } from '../src/content.js'

export function tuned (patch, fn) {
  const was = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, Object.fromEntries(Object.keys(v).map((x) => [x, TUNING[k][x]]))]))
  for (const [k, v] of Object.entries(patch)) Object.assign(TUNING[k], v)
  let async = false
  try {
    const out = fn()
    if (out && typeof out.then === 'function') {
      async = true
      return out.finally(() => { for (const [k, v] of Object.entries(was)) Object.assign(TUNING[k], v) })
    }
    return out
  } finally {
    if (!async) for (const [k, v] of Object.entries(was)) Object.assign(TUNING[k], v)
  }
}

// Arise as it was first built (one raise a Will step, tier 1 + Will, at half HP, domain 3).
export const FIRST_ARISE = { monarch: { raises: 1, raiseTier: 1, raiseHp: 0.5, domain: 3 } }
// The level scale the run's scenes were built on (before the balance pass, 2026-10-09): level 1 with no tiers and
// 1.5 a tier, so a single tier gives a level (the pass made it 2 and 0.5: a level every two tiers).
export const LEVEL_A_TIER = { level: { base: 1, perTier: 1.5 } }
// The board of 14 the army was first built with.
export const BOARD_14 = { army: { board: 14 } }
// The balance the army and its expert were first tested on (before necessity round 1): Arise as first built, the
// Monarch's base HP, the board of 14 and the first tier prices; and (round 2) no souls gained by floor. (The ranks and their
// might, the cohorts, binds, muster and orders it also set are gone from the rules.)
export const FIRST_BALANCE = {
  monarch: { ...FIRST_ARISE.monarch, hp: 140 },
  army: { board: 14 },
  party: { fieldPerFloor: 0 },
  essence: { tier: [30, 60, 100, 150] }
}

// A battle scene's Monarch as the scenes were built, before its HP points were cut (2026-10-09): `u.lvl` points of
// HP, HP_PER_POINT each over TUNING.monarch.hp, so a scene's Monarch takes as long to fell as it did. The run's
// Monarch has no level now (its HP is its base and its HP relics': run.js monarchHp); any other unit as it is.
export const HP_PER_POINT = 14
export const sturdy = (u) => {
  if (u.id !== 'monarch') return u
  const hp = TUNING.monarch.hp + HP_PER_POINT * (u.lvl ?? 0)
  return { ...u, hp, maxHp: hp }
}

// Gives a run relics as if taken (outside the log: a run made so is not replayed): each copy held, and the
// Monarch's max HP raised (and healed) by the HP relics among them, as run.js takeRelic does.
export function grant (run, ids) {
  const s = run.state
  s.relics.push(...ids)
  const m = s.party.find((u) => u.id === 'monarch')
  const gain = ids.reduce((n, id) => n + (RELICS[id].monarchHp ?? 0), 0)
  Object.assign(m, { maxHp: m.maxHp + gain, hp: m.hp + gain })
}
