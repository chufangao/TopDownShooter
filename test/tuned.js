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

// Arise as it was first built (one raise a Will step, tier 1 + Will, at half HP, shadows faltering anywhere).
export const FIRST_ARISE = { monarch: { raises: 1, raiseTier: 1, raiseHp: 0.5, shadowFalter: true } }
// The board of 14 the army was first built with.
export const BOARD_14 = { army: { board: 14 } }
// The balance the army and its expert were first tested on (before necessity round 1): Arise as first built, the
// Monarch's HP, the board of 14, a Marshal's reach of 2, the first tier prices, and orders with no payoff of their
// own (no bracing, no fresh entry); and (round 2) no souls gained by floor and ranks with no might; and (round 3)
// flankers that vault a braced line. (The cohorts, binds and muster it also set are gone from the rules.)
export const FIRST_BALANCE = {
  orders: { braced: 1, fresh: 0, holdFlank: false },
  monarch: { ...FIRST_ARISE.monarch, hp: 140, hpPerPoint: 24 },
  army: { board: 14 },
  party: { fieldPerFloor: 0 },
  ranks: { domain: 2, might: [1, 1, 1] },
  essence: { tier: [30, 60, 100, 150] }
}
