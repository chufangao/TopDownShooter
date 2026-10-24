// The solver bench's shared pieces: its paths, the arguments, digests (a board's, a line's, a src tree's), a pool of
// worker threads and the numbers the analysis reads.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { Worker } from 'node:worker_threads'

export const HERE = path.dirname(new URL(import.meta.url).pathname)
// The repo's src/ (tools/solverbench/ → src/): the game the boards are made with, the default variant's solver, the probes'.
export const REPO_SRC = path.resolve(HERE, '../../src')
export const BOARDS = path.join(HERE, 'boards.json')
export const OUT = path.join(HERE, 'out')

// `--k v` (or the default), `--k` alone as a flag.
export const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d }
export const flag = (k) => process.argv.includes(`--${k}`)
export const workersArg = (d = os.availableParallelism?.() ?? os.cpus().length) => Math.max(1, Number(arg('workers', d)))

export const sha = (x, n = 16) => crypto.createHash('sha1').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, n)
// A board's digest: its setup's. A line's: its turns' orders, in order (two solves with one digest played the same line).
export const boardDigest = (board) => sha(board.setup)
export const lineDigest = (line) => sha(line.map((t) => t.orders))
// A src tree's digest: every file's path and bytes, sorted by path (a result is redone when the tree it was made by changed).
export function srcDigest (dir) {
  const h = crypto.createHash('sha1')
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).forEach((e) => {
    const p = path.join(d, e.name)
    if (e.isDirectory()) return walk(p)
    h.update(path.relative(dir, p) + '\0')
    h.update(fs.readFileSync(p))
  })
  walk(dir)
  return h.digest('hex').slice(0, 16)
}

// The board set (boards.json): { meta, boards: [{ id, seed, index, floor, room, kind, boss, rank, size, sentries, sentry,
// camp, foes, setup }] }; `k` boards evenly spaced through it (the set is sorted by floor and kind, so a few still span them).
export function readBoards (file = BOARDS, k = Infinity) {
  const set = JSON.parse(fs.readFileSync(file, 'utf8'))
  const all = set.boards
  const n = Math.min(all.length, k)
  return { meta: set.meta, boards: n === all.length ? all : Array.from({ length: n }, (_, i) => all[Math.floor(i * all.length / n)]) }
}
// A board's id as a file name.
export const fileOf = (id) => `${id.replace(/[^\w.-]/g, '_')}.json`
export const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
export const writeJson = (f, x) => {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f + '.tmp', JSON.stringify(x))
  fs.renameSync(f + '.tmp', f)
}

// `jobs` on `workers` threads of worker.mjs, each result handed to `onResult` as it comes (in finishing order); a job's
// error is a result with `error`. Progress to stderr every `every` results.
export async function runPool (jobs, workers, onResult, { every = 10, env = process.env } = {}) {
  const t0 = Date.now()
  let next = 0
  let done = 0
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, () => new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.mjs', import.meta.url), { env })
    const feed = () => (next < jobs.length ? w.postMessage(jobs[next++]) : (w.terminate(), resolve()))
    w.on('message', (r) => {
      done++
      if (r.error) console.error('error', r.job.kind, r.job.board?.id ?? r.job.seed, r.error.split('\n')[0])
      onResult(r)
      if (done % every === 0 || done === jobs.length) {
        const s = (Date.now() - t0) / 1000
        console.error(`${done}/${jobs.length} in ${s.toFixed(0)} s, ~${(s / done * (jobs.length - done)).toFixed(0)} s left`)
      }
      feed()
    })
    w.on('error', reject)
    feed()
  })))
  return (Date.now() - t0) / 1000
}

// ── the numbers ──
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
export const sd = (xs) => { const m = mean(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) : 0 }
export const se = (xs) => (xs.length ? sd(xs) / Math.sqrt(xs.length) : NaN)
export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN }
