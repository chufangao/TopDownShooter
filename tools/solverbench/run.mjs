// The solver bench's run: every board solved by one variant's solver as the environment configures it (RETINUE_SOLVER_*,
// the budget given, no slack read), so that a solve is a function of its board; one result file a board a variant
// (out/<variant>/<board>.json), so a stop resumes, and a result made by another src tree, budget or board is redone.
// The probes (End Turn alone, the one-wide search: probeOf) are the boards' own, solved once by the repo's src
// (out/boards/<board>.json). Then the table of the variants run so far (analyze.mjs, against `base`).
//   node tools/solverbench/run.mjs [--variant base] [--src <a src/ tree>] [--budget 150000] [--workers n] [--boards k]
//        [--fresh] [--file tools/solverbench/boards.json] [--out tools/solverbench/out]
// A variant is a name and the src/ tree its solver is imported from: the repo's by default; a heuristic is measured from
// a copy (cp -r src /somewhere/src-x, change it there, --variant x --src /somewhere/src-x), the repo untouched.
import fs from 'node:fs'
import path from 'node:path'
import { REPO_SRC, BOARDS, OUT, arg, flag, workersArg, boardDigest, srcDigest, readBoards, fileOf, readJson, writeJson, runPool } from './lib.mjs'

const variant = arg('variant', 'base')
if (!/^[\w.-]+$/.test(variant) || variant === 'boards' || variant === 'runs') throw new Error(`run: a variant's name is a plain word, not boards or runs: ${variant}`)
const src = path.resolve(arg('src', REPO_SRC))
const budget = Number(arg('budget', process.env.RETINUE_SOLVER_BUDGET ?? 150000))
if (!(budget < Infinity)) throw new Error('run: the bench solves by a budget of plans, so that a solve is a function of its board')
const out = path.resolve(arg('out', OUT))
const file = path.resolve(arg('file', BOARDS))
const workers = workersArg()
const { boards } = readBoards(file, Number(arg('boards', Infinity)))
const dir = path.join(out, variant)
if (flag('fresh')) fs.rmSync(dir, { recursive: true, force: true })
if (!fs.existsSync(path.join(src, 'sim/solver.js'))) throw new Error(`run: no sim/solver.js under ${src}`)

// What a result must have been made by to stand: this variant's src (by its digest), the budget, the solver's knobs as
// the environment sets them here, and the board.
const srcHash = srcDigest(src)
const repoHash = src === REPO_SRC ? srcHash : srcDigest(REPO_SRC)
process.env.RETINUE_SOLVER_BUDGET = String(budget)
process.env.RETINUE_SOLVER_SLACK = '0'
const knobs = (await import(`${src}/sim/solver.js`)).solverKnobs()
if (!knobs.pure) console.error(`run: the environment names a wall-clock cap (${knobs.cap} s): solves are not a function of their boards`)
const key = { budget, src: srcHash, widths: knobs.widths, cap: Number.isFinite(knobs.cap) ? knobs.cap : 'none' }
const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const had = readJson(path.join(dir, 'meta.json'))
if (had && had.srcPath !== src) console.error(`run: ${variant} was run from ${had.srcPath}; now from ${src} (its results are redone where its tree differs)`)
writeJson(path.join(dir, 'meta.json'), { variant, srcPath: src, ...key })

const jobs = []
let kept = 0
let stale = 0
for (const board of boards) {
  const digest = boardDigest(board)
  const p = readJson(path.join(out, 'boards', fileOf(board.id)))
  if (!p || p.src !== repoHash || p.board !== digest) jobs.push({ kind: 'probe', src: REPO_SRC, board })
  const r = readJson(path.join(dir, fileOf(board.id)))
  if (r && r.board === digest && sameKey(r.key, key)) kept++
  else {
    if (r) stale++
    jobs.push({ kind: 'solve', src, board, budget })
  }
}
const solves = jobs.filter((j) => j.kind === 'solve').length
console.error(`${variant} (${src}, ${srcHash}): ${boards.length} boards, ${solves} solves to go (${kept} done${stale ? `, ${stale} made otherwise redone` : ''}), ${jobs.length - solves} probes; budget ${budget} plans, widths ${knobs.widths.map((w) => w.join('/')).join(',')}, ${workers} workers`)
const secs = await runPool(jobs, workers, ({ job, res, error }) => {
  if (error) return
  const digest = boardDigest(job.board)
  if (job.kind === 'probe') writeJson(path.join(out, 'boards', fileOf(job.board.id)), { id: job.board.id, board: digest, src: repoHash, probe: res })
  else writeJson(path.join(dir, fileOf(job.board.id)), { id: job.board.id, board: digest, key, ...res })
})
console.error(`done in ${secs.toFixed(0)} s`)
if (variant !== 'base' && fs.existsSync(path.join(out, 'base'))) {
  process.argv = [process.argv[0], new URL('./analyze.mjs', import.meta.url).pathname, 'base', variant, '--file', file, '--out', out]
  await import('./analyze.mjs')
}
