// The one place a headless host boots a game (§16.2).
//
// `sim.js`, `balance.js` and every test that wants a real registry need the same four lines: find
// the packs on disk, hand them to `createGame`, fail loudly if content is broken. Writing those
// four lines twice is how the two tools drift into disagreeing about which packs are loaded, which
// is the one thing a balance number must never be ambiguous about.
//
// Node-only, like everything in tools/ — `src/sim/` must stay runnable in a browser and a Worker.

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createGame } from '../src/sim/boot.js'
import { discoverPacks, readPackFromDisk } from './packsource.node.js'

/**
 * Every pack a headless run should see.
 *
 * Test fixtures are opt-in and off by default: `test/fixtures/kindled` is a real pack that ships a
 * unit and a patch, so including it silently would move every balance number this file produces
 * and over-count the roster by one — a mistake §19 has already recorded once.
 *
 * @param {{fixtures?: boolean, root?: string}} [opts]
 */
export function findPacks ({ fixtures = false, root = 'packs' } = {}) {
  const packs = discoverPacks(root)
  if (!fixtures || !existsSync('test/fixtures')) return packs
  for (const name of readdirSync('test/fixtures').sort()) {
    if (existsSync(join('test/fixtures', name, 'mod.json'))) packs.push(readPackFromDisk(join('test/fixtures', name)))
  }
  return packs
}

/**
 * Boot a game the way the browser does — through `createGame`, the single public entry point
 * (§18.12). A content error is fatal here rather than a warning: a balance sweep against a
 * half-loaded registry is worse than no sweep, because it produces numbers.
 *
 * @returns {Promise<{kernel, tuning, report}>}
 */
export async function bootGame ({ fixtures = false, seed = 0, root = 'packs' } = {}) {
  const game = await createGame({ packs: findPacks({ fixtures, root }), seed })
  if (game.report.errors.length) {
    throw new Error(`content failed to load:\n  ${game.report.errors.join('\n  ')}`)
  }
  if (!game.tuning) throw new Error('no tuning def loaded — packs/core/content/tuning.json is missing or invalid')
  return game
}

// ── argv ────────────────────────────────────────────────────────────────────────────────────────

/**
 * `--seed 42 --floors 8 --json` → `{seed: '42', floors: '8', json: true}`. Deliberately tiny: a CLI
 * parser is not a dependency worth having, and every flag these tools take is a scalar.
 */
export function parseArgs (argv = process.argv.slice(2)) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i++ }
  }
  return out
}

export const num = (v, fallback) => (v === undefined || v === true ? fallback : Number(v))

/** Percentile of an already-unsorted numeric array. Returns null for an empty one. */
export function percentile (values, p) {
  if (!values.length) return null
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))]
}

export const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)

/** Fixed decimals without trailing-zero noise, for a CSV a human reads. */
export const round = (v, dp = 2) => (Number.isFinite(v) ? Number(v.toFixed(dp)) : v)
