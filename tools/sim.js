#!/usr/bin/env node
// Headless runs (§16.2) — the harness §19 twice noted was missing.
//
//   node tools/sim.js --seed 42 --floors 8
//   node tools/sim.js --runs 20 --json > runs.json
//   node tools/sim.js --seed 7 --doctrine my-doctrine.json --verbose
//
// Every gate claimed in §19 up to now was checked either by `node --test` or by driving a real
// browser. Neither is a substitute for this: a browser session measures one run and costs minutes,
// and a unit test measures a function rather than a game. The M4 gate — *a seeded run reaches floor
// 4 without a hand-built party* — is a statement about twenty runs, and this is the only thing that
// can say whether it is true.
//
// It calls exactly the functions the browser calls. There is no second implementation of a run
// anywhere (§8), so a number printed here is a number about the real game.

import { readFileSync } from 'node:fs'
import { createRun, playRun, BATTLE_NODES } from '../src/sim/run.js'
import { endRun } from '../src/sim/economy.js'
import { coherence } from '../src/sim/synergy.js'
import { bootGame, parseArgs, num, percentile, mean, round } from './harness.js'

const args = parseArgs()

if (args.help) {
  console.log(`node tools/sim.js [options]

  --seed <n>          first run seed (default 1)
  --runs <n>          how many consecutive seeds to play (default 1)
  --floors <n>        stop after this floor (default 8)
  --doctrine <file>   a Doctrine JSON export (§4) to play by; omitted means the shipped set
  --fixtures          also load test/fixtures/* packs — off by default, it moves every number
  --json              emit machine-readable JSON instead of the summary table
  --verbose           per-node log for a single run
`)
  process.exit(0)
}

const seed0 = num(args.seed, 1)
const runs = num(args.runs, 1)
const maxFloors = num(args.floors, 8)
const doctrine = args.doctrine && args.doctrine !== true
  ? JSON.parse(readFileSync(args.doctrine, 'utf8'))
  : undefined

const { kernel, tuning } = await bootGame({ fixtures: !!args.fixtures })

const results = []
for (let i = 0; i < runs; i++) {
  const seed = seed0 + i
  const run = createRun({ kernel, tuning, seed, doctrine })

  const log = []
  const outcome = playRun(run, {
    maxFloors,
    onReport: args.verbose
      ? (report, r) => log.push(describe(report, r))
      : null
  })

  const banked = endRun(run)
  results.push({
    seed,
    floors: outcome.floors,
    reason: outcome.reason,
    nodes: outcome.reports.length,
    battles: outcome.reports.filter((r) => r.battle).length,
    recruited: outcome.reports.reduce((n, r) => n + r.joined.length, 0),
    declined: outcome.reports.reduce((n, r) => n + r.declined.length, 0),
    party: run.state.roster.length,
    standing: run.state.roster.filter((u) => u.hp > 0).length,
    medianLvl: median(run.state.roster.map((u) => u.lvl)),
    coherence: round(coherence(kernel.registry, run.state.roster), 3),
    residue: banked.residue,
    coin: run.state.coin,
    codex: banked.codex.length,
    log
  })
}

if (args.json) {
  console.log(JSON.stringify(runs === 1 ? results[0] : results, null, 2))
  process.exit(0)
}

for (const r of results) {
  for (const line of r.log) console.log(line)
  if (r.log.length) console.log('')
}

report(results)

// ── output ──────────────────────────────────────────────────────────────────────────────────────

function report (rows) {
  const w = (s, n) => String(s).padStart(n)
  console.log('seed   floor  reason   nodes  fights  party  lvl   coh    residue')
  for (const r of rows) {
    console.log([
      w(r.seed, 4), w(r.floors, 6), '  ' + r.reason.padEnd(8),
      w(r.nodes, 4), w(r.battles, 7), w(`${r.standing}/${r.party}`, 7),
      w(r.medianLvl, 5), w(r.coherence, 6), w(r.residue, 10)
    ].join(''))
  }

  if (rows.length < 2) return
  const depths = rows.map((r) => r.floors)
  // The M4 gate, stated as the number it actually is. §17 asks that a seeded run reach floor 4
  // without a hand-built party; one run reaching it proves nothing and twenty runs is a rate.
  const reached4 = depths.filter((d) => d >= 4).length
  console.log('')
  console.log(`${rows.length} runs · median floor ${percentile(depths, 0.5)} · p90 floor ${percentile(depths, 0.9)}`)
  console.log(`reached floor 4: ${reached4}/${rows.length} (${Math.round((reached4 / rows.length) * 100)}%)  ← the M4 gate`)
  console.log(`median party ${median(rows.map((r) => r.party))} · median level ${median(rows.map((r) => r.medianLvl))} · ` +
    `mean recruits ${round(mean(rows.map((r) => r.recruited)), 1)} · mean residue ${Math.round(mean(rows.map((r) => r.residue)))}`)
}

function describe (report, run) {
  const at = `f${run.state.floorNum} ${String(run.state.visited).padStart(2)}`
  if (!report.battle) {
    const extra = report.healed ? ` +${report.healed} hp` : ''
    const rev = report.revived ? ` ${report.revived} revived` : ''
    return `${at}  ${report.type.padEnd(10)}${extra}${rev}`
  }
  const { result } = report.battle
  const foes = BATTLE_NODES[report.type] ?? '?'
  const bits = [
    `${result.state.winner ?? 'draw'} in ${(result.ticks / run.tuning.tick.hz).toFixed(1)}s`,
    `${report.awards.length} paid`,
    report.levelled.length ? `${report.levelled.length} levelled` : null,
    report.joined.length ? `+${report.joined.map((u) => u.defId.split(':')[1]).join(' +')}` : null,
    report.cut.length ? `-${report.cut.map((u) => u.defId.split(':')[1]).join(' -')}` : null,
    report.wiped ? 'WIPE' : null
  ].filter(Boolean)
  return `${at}  ${report.type.padEnd(10)}${String(foes).padStart(2)} foes · ${bits.join(' · ')}`
}

function median (values) {
  const s = values.slice().sort((a, b) => a - b)
  if (!s.length) return 0
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : round((s[mid - 1] + s[mid]) / 2, 1)
}
