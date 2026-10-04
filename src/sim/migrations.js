// Save migrations (§14) — the one place JS is allowed to know about save shape (§16.1).
//
// An ordered array of `{to, up(state)}`, applied in sequence. Every save format change adds one
// entry and one committed fixture, and `test/sim/save.test.js` walks every fixture through every
// migration above its version, asserting the result validates — so the chain is exercised end to
// end rather than only at its last link.
//
// Two rules that are easy to break and expensive to have broken:
//
//   * **A migration never reads the registry.** It transforms one plain object into another. The
//     content a save was written against may not be installed any more — that is what the repair
//     pass in `save.js` is for, and it runs *after* the chain, once the shape is current.
//   * **A migration is never edited after it ships.** Someone's save on disk has already been
//     through it. Fixing a bad migration means adding the next one.

/**
 * @type {Array<{to: number, up: (state: object) => object}>}
 *
 * Empty at v1, and deliberately so: there has never been a released save format below the current
 * one, and seeding this with an invented entry would mean the migration test's only assertion was
 * about fiction. What makes the chain trustworthy at v1 is not a fake first link — it is that
 * `test/fixtures/saves/v1.json` is committed today, so the first *real* migration has something
 * true to be tested against on the day it lands.
 */
export const MIGRATIONS = []

/** The version a fresh save is written at. Bump alongside a new MIGRATIONS entry, never alone. */
export const SAVE_VERSION = 1

/**
 * Walk a save's `state` up to the current version.
 *
 * @param {object} save   a parsed save, any version ≤ SAVE_VERSION
 * @returns {{state: object, applied: number[]}} which migrations ran, for the load report
 */
export function migrate (save) {
  const from = Number.isInteger(save?.v) ? save.v : 0
  if (from > SAVE_VERSION) {
    throw new Error(`save is version ${from}; this build understands up to ${SAVE_VERSION}. ` +
      'Loading a save from a newer build would silently drop whatever it added.')
  }

  let state = save.state
  const applied = []
  for (const m of MIGRATIONS) {
    if (m.to <= from) continue
    state = m.up(state)
    applied.push(m.to)
  }
  return { state, applied }
}
