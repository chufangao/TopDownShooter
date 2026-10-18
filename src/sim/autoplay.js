// The autoplayer's command line, and the one module the tests and tools import (player.js and reports.js re-exported).
//   node src/sim/autoplay.js [flags]       the balance report (npm run sim)
//     --paired <a>,<b>                     two players on the same seeds, each none, a forest file, forest:<file>,
//                                          route:<hand|learned|file>, outforest:<file|none> or expert:<file>
//     --ladder [--teacher]                 every rung (basic, calc, expert, the teacher) at each --ascension level
//     --decisions                          how much the formation decides battles
//     --ablate <mechanic>                  the report with one mechanic taken away (ABLATIONS)
//     --ablations [--variants full,…] [--out runs.json]   the expert with each mechanic taken away, full runs
//     --necessity [--setups file]          the same, battle by battle: each battle refought stripped
//     --audit                              what the expert considers and chooses, and which rule decided
//     --builds [--player expert|teacher] [--commit <arch>[,…]|all|fused|synergies|none] [--strict] [--scale 1]
//              [--out file.json]           free play and each archetype committed, on the same seeds
//     --pool                               what a run can gather
//     --combos                             the combo book, written to src/sim/combos.json (npm run combos)
//   and with any of them:
//     --runs n                runs played (8; --paired, --builds, --pool 256; with --sequential 768 at most; --audit 4)
//     --seed name             the seeds' name (sim; --audit audit; --builds, --pool div)
//     --level basic|expert    the player (expert by default)
//     --ascension 0|a,b,…|all the ascension level (a list or all for --ladder alone)
//     --monarch id            who plays (the base Monarch by default)
//     --forest file|none      the expert's battle forest (the shipped one by default)
//     --workers n             the pool's size (one per core by default)
//     --cache dir, --no-cache where runs are kept and read back (RETINUE_CACHE, else ~/.cache/retinue-runs), or none
//     --sequential [--block 64] [--design peto|pocock|obf] [--alpha 0.05] [--min-gain 1]
//                             --paired and --builds played in blocks, stopped once decided
import path from 'node:path'
import { BASE_MONARCH } from './run.js'
import { runCache, defaultDir } from './runcache.js'
import * as SEQ from './sequential.js'
import { LEVELS, ABLATIONS, asMonarch, monarchArg, makeBook } from './player.js'
import {
  record, auditRecord, audit, configure, report, paired, ascensionsOf, ladderRecord, ladder, decisions, ablations,
  refight, necessity, buildRecord, commitsOf, builds, pool
} from './reports.js'

export * from './player.js'
export * from './reports.js'

// Run directly: a report, or in a pool's worker thread its jobs. RUNS: the runs a report plays by default.
const RUNS = { sim: 8, decisions: 8, ladder: 8, ablations: 8, necessity: 8 }
if (typeof process !== 'undefined' && process.argv[1] === decodeURIComponent(new URL(import.meta.url).pathname)) {
  const { isMainThread, parentPort, workerData } = await import('node:worker_threads')
  if (!isMainThread) {
    // A pool's worker (playAll): job after job, until it is let go.
    const play = (job) => (job.audit ? auditRecord(job) : job.refight ? refight(job) : job.builds ? buildRecord(job) : job.ladder ? ladderRecord(job) : record(job))
    if (workerData?.pool) parentPort.on('message', async (job) => parentPort.postMessage(await play(job)))
    else parentPort.postMessage(play(workerData))
  } else {
    const { arg, has } = await import('./cli.js')
    const ascensions = ascensionsOf(arg('ascension', '0'))
    if (ascensions.length > 1 && !has('ladder')) throw new Error('--ascension: one level, but for the ladder')
    const monarch = monarchArg(arg('monarch', BASE_MONARCH))
    const opts = { seed: arg('seed', 'sim'), level: arg('level', 'expert'), ascension: ascensions[0], ...asMonarch(monarch) }
    if (arg('workers', null) !== null) configure({ workers: Math.max(1, Number(arg('workers', 1))) })
    const cache = has('no-cache') ? null : runCache({ dir: arg('cache', defaultDir()) })
    configure({ cache })
    const sequential = has('sequential')
    const seq = sequential ? { sequential, block: Number(arg('block', 64)), design: arg('design', 'peto'), alpha: Number(arg('alpha', 0.05)), minGain: Number(arg('min-gain', SEQ.MIN_GAIN)) } : {}
    if (sequential && !SEQ.DESIGN_NAMES[seq.design]) throw new Error(`unknown design "${seq.design}": ${Object.keys(SEQ.DESIGN_NAMES).join(', ')}`)
    const most = (fixed) => Number(arg('runs', sequential ? 768 : fixed))
    if (!LEVELS[opts.level]) throw new Error(`unknown level "${opts.level}": ${Object.keys(LEVELS).join(', ')}`)
    const ablate = arg('ablate', null)
    if (ablate !== null && !ABLATIONS.includes(ablate)) throw new Error(`unknown ablation "${ablate}": ${ABLATIONS.join(', ')}`)
    // `--variants full` (alone or with others): the full expert only, beside whatever ablations are named.
    const variants = arg('variants', null)?.split(',').filter((v) => v !== 'full') ?? ABLATIONS
    for (const v of variants) if (!ABLATIONS.includes(v)) throw new Error(`unknown ablation "${v}": ${ABLATIONS.join(', ')}`)
    const forest = arg('forest') ?? undefined
    if (has('combos')) makeBook()
    else if (has('pool')) pool({ runs: Number(arg('runs', 256)), seed: arg('seed', 'div') })
    else if (has('builds')) {
      await builds({
        player: arg('player', 'expert'), commits: commitsOf(arg('commit', 'all')), strict: has('strict'), scale: Number(arg('scale', 1)), ascension: ascensions[0], ...asMonarch(monarch),
        runs: most(256), seed: arg('seed', 'div'), out: arg('out', null), ...seq
      })
    }
    else if (arg('paired', null)) {
      const players = arg('paired').split(',')
      if (players.length !== 2) throw new Error('--paired <a>,<b>: two players (a forest file, a part or a whole expert, or none), comma-separated')
      await paired({ ...opts, players, runs: most(256), ...seq })
    }
    else if (has('audit')) await audit({ seed: arg('seed', 'audit'), runs: Number(arg('runs', 4)), ascension: opts.ascension, ...asMonarch(monarch) })
    else if (has('ablations')) await ablations({ ...opts, variants, runs: Number(arg('runs', RUNS.ablations)), out: arg('out', null) })
    else if (has('necessity')) await necessity({ ...opts, runs: Number(arg('runs', RUNS.necessity)), setups: arg('setups', null) })
    else if (has('decisions')) await decisions({ ...opts, runs: Number(arg('runs', RUNS.decisions)) })
    else if (has('ladder')) await ladder({ ...opts, forest, ascensions, teacher: has('teacher'), runs: Number(arg('runs', RUNS.ladder)) })
    else await report({ ...opts, ablate, forest, ascension: ascensions[0], runs: Number(arg('runs', RUNS.sim)) })
    if (cache?.hits || cache?.played) console.error(`(the run cache, ${path.join(cache.dir, cache.code.slice(0, 16))}: ${cache.hits} runs read, ${cache.played} played)`)
  }
}
