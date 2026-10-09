// Runs fn with TUNING's values at `patch` (a { section: { key: value } } map), restoring them after: for
// tests whose scenes were built on other numbers than the current balance (the rule under test reads TUNING).
import { TUNING } from '../src/tuning.js'

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

// Arise as it was first built (one raise a Will step, tier 1 + Will, at half HP).
export const FIRST_ARISE = { monarch: { raises: 1, raiseTier: 1, raiseHp: 0.5 } }
// The board of 14 the army was first built with.
export const BOARD_14 = { army: { board: 14 } }
// The balance the army and its expert were first tested on (before necessity round 1): Arise as first built, the
// Monarch's HP, the board of 14 and the first tier prices; and (round 2) no souls gained by floor. (The ranks and their
// might, the cohorts, binds, muster and orders it also set are gone from the rules.)
export const FIRST_BALANCE = {
  monarch: { ...FIRST_ARISE.monarch, hp: 140, hpPerPoint: 24 },
  army: { board: 14 },
  party: { fieldPerFloor: 0 },
  essence: { tier: [30, 60, 100, 150] }
}
