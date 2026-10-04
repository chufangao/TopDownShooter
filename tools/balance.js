#!/usr/bin/env node
// The balance harness (§10, §16.2) — N battles per tier, CSV of win rate and time-to-kill.
//
//   node tools/balance.js --n 400 > balance.csv
//   node tools/balance.js --n 200 --tier 3
//   node tools/balance.js --n 200 --sweep damage.atkDivisor=10,20,28,36
//
// §19 records twice that this file is what would have caught the gauge formula and the damage
// divisor before each cost a browser session. Both were the same failure: a constant whose effect
// is only visible across hundreds of battles, changed on reasoning alone. `--sweep` is the direct
// answer — it re-runs the whole measurement against a patched `tuning` path, so the question
// "what does atkDivisor actually do to time-to-kill" is one command and about a second.
//
// Every fight is level-matched by default (party level = foe level) so a row means one thing: how
// this roster performs against tier T on even terms. The run-level question — whether the party
// stays ahead of the depth curve — is `tools/sim.js`, and the two should not be confused.

import { makeParty, makeFoes } from '../src/sim/party.js'
import { createBattle } from '../src/sim/combat/battle.js'
import { runBattle } from '../src/sim/combat/resolve.js'
import { makeRng } from '../src/sim/kernel/rng.js'
import { STARTING_PARTY } from '../src/sim/run.js'
import { bootGame, parseArgs, num, percentile, mean, round } from './harness.js'

const args = parseArgs()

if (args.help) {
  console.log(`node tools/balance.js [options]

  --n <n>             battles per row (default 200)
  --tier <n>          restrict foes to exactly this tier; omitted sweeps floors 1-8
  --lvl <n>           party level; omitted matches the foe level for the row
  --size <n>          foes per battle (default 3)
  --sweep <path=a,b>  re-run every row once per value, patching that tuning path
  --seed <n>          base seed (default 1)
  --fixtures          also load test/fixtures/* packs
`)
  process.exit(0)
}

const N = num(args.n, 200)
const size = num(args.size, 3)
const seed0 = num(args.seed, 1)
const { kernel, tuning } = await bootGame({ fixtures: !!args.fixtures })

/** One row per (sweep value × floor). A floor fixes the foe tier band and the level (§6.2). */
const floors = args.tier && args.tier !== true
  ? [{ label: `tier ${args.tier}`, tier: num(args.tier, 1), lvl: num(args.lvl, num(args.tier, 1) * 2) }]
  : [1, 2, 3, 4, 5, 6, 7, 8].map((f) => ({
      label: `floor ${f}`,
      floor: f,
      lvl: num(args.lvl, Math.max(1, Math.round(1 + (f - 1) * 1.5)))
    }))

const sweep = parseSweep(args.sweep)

console.log(['sweep', 'row', 'n', 'partyLvl', 'foeLvl', 'winRate', 'ttkTicks', 'ttkSec', 'p90Sec',
  'survivors', 'recruits', 'stalls'].join(','))

for (const variant of sweep) {
  const T = patch(tuning, variant.path, variant.value)
  for (const row of floors) {
    console.log(measure(T, row, variant).join(','))
  }
}

// ── measurement ─────────────────────────────────────────────────────────────────────────────────

function measure (T, row, variant) {
  const ticks = []
  let wins = 0
  let stalls = 0
  let survivors = 0
  let recruits = 0

  for (let i = 0; i < N; i++) {
    const rng = makeRng(`${seed0}|${variant.label}|${row.label}|${i}`)
    const partyLvl = num(args.lvl, row.lvl)
    const party = makeParty(kernel, STARTING_PARTY, { side: 'party', lvl: partyLvl })
    const foes = row.tier
      ? makeParty(kernel, pickTier(rng.stream('spawn'), row.tier, size), { side: 'foe', lvl: row.lvl })
      : makeFoes(kernel, rng.stream('spawn'), { floor: row.floor, size })

    const battle = createBattle({ kernel, tuning: T, party, foes, seed: i, floor: row.floor ?? 1 })
    const result = runBattle(battle, { kernel, tuning: T, rng: rng.stream('combat') })

    ticks.push(result.ticks)
    if (result.state.winner === 'party') wins++
    if (result.state.reason === 'tick-ceiling') stalls++
    survivors += result.state.units.filter((u) => u.side === 'party' && u.hp > 0).length
    recruits += result.state.recruited.length
  }

  const hz = T.tick.hz
  return [
    variant.label,
    row.label,
    N,
    num(args.lvl, row.lvl),
    row.lvl,
    round(wins / N, 3),
    Math.round(mean(ticks)),
    round(mean(ticks) / hz, 1),
    round(percentile(ticks, 0.9) / hz, 1),
    round(survivors / N, 2),
    round(recruits / N, 3),
    stalls
  ]
}

/** Units of exactly one tier — the isolated measurement `--tier` exists for. */
function pickTier (rng, tier, n) {
  const pool = kernel.registry.all('unit').filter((d) => d.tier === tier && !d.boss)
  if (!pool.length) throw new Error(`no non-boss units of tier ${tier} are loaded`)
  return Array.from({ length: n }, () => pool[rng.int(pool.length)].id)
}

// ── sweeping a tuning path ──────────────────────────────────────────────────────────────────────

function parseSweep (spec) {
  if (!spec || spec === true) return [{ label: 'base', path: null, value: null }]
  const [path, list] = String(spec).split('=')
  if (!list) throw new Error('--sweep wants path=a,b,c — e.g. --sweep damage.atkDivisor=10,28')
  return list.split(',').map((v) => ({ label: `${path}=${v}`, path, value: Number(v) }))
}

/**
 * A tuning def with one path replaced. Deep-cloned rather than mutated because the registry is
 * frozen after boot (§11.1) and, more to the point, because a sweep that leaked between rows would
 * silently make every number after the first one wrong.
 */
function patch (base, path, value) {
  if (!path) return base
  const out = JSON.parse(JSON.stringify(base))
  const keys = path.split('.')
  let cur = out
  for (const k of keys.slice(0, -1)) {
    if (cur[k] === undefined) throw new Error(`--sweep path "${path}" does not exist in tuning.json`)
    cur = cur[k]
  }
  const last = keys[keys.length - 1]
  if (cur[last] === undefined) throw new Error(`--sweep path "${path}" does not exist in tuning.json`)
  cur[last] = value
  return out
}
