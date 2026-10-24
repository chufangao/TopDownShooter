// The relic bench: every config solved on every room (budgeted, so deterministic), resumable from results.jsonl, then
// the table (analyze.mjs). node tools/relicbench/run.mjs [--workers n] [--rooms n] [--fresh]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { ROOMS, BUDGET, configs } from './configs.mjs'

const dir = path.dirname(new URL(import.meta.url).pathname)
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d }
const workers = Number(arg('workers', os.availableParallelism?.() ?? os.cpus().length))
const rooms = ROOMS.slice(0, Number(arg('rooms', ROOMS.length)))
const file = path.join(dir, 'results.jsonl')
if (process.argv.includes('--fresh') && fs.existsSync(file)) fs.unlinkSync(file)
const done = new Set()
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    const r = JSON.parse(line)
    if (r.budget === BUDGET && !r.error) done.add(`${r.room.seed}|${r.room.node}|${r.key}`)
  }
}
const cfgs = configs()
// Room-major: a stop leaves every config on the rooms finished.
const jobs = []
for (const room of rooms) for (const c of cfgs) if (!done.has(`${room.seed}|${room.node}|${c.key}`)) jobs.push({ room, key: c.key, cfg: c.cfg, budget: BUDGET })
console.error(`${cfgs.length} configs × ${rooms.length} rooms; ${jobs.length} solves to go (${done.size} done), budget ${BUDGET} plans, ${workers} workers`)
const t0 = Date.now()
let next = 0
let finished = 0
const out = fs.openSync(file, 'a')
await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, () => new Promise((resolve) => {
  const w = new Worker(new URL('./worker.mjs', import.meta.url))
  const feed = () => (next < jobs.length ? w.postMessage(jobs[next++]) : (w.terminate(), resolve()))
  w.on('message', (r) => {
    fs.writeSync(out, JSON.stringify(r) + '\n')
    finished++
    if (r.error) console.error('error', r.key, r.room, r.error.split('\n')[0])
    if (finished % 25 === 0 || finished === jobs.length) {
      const s = (Date.now() - t0) / 1000
      console.error(`${finished}/${jobs.length} in ${s.toFixed(0)} s, ~${(s / finished * (jobs.length - finished)).toFixed(0)} s left`)
    }
    feed()
  })
  w.on('error', (e) => { console.error(e); resolve() })
  feed()
})))
fs.closeSync(out)
console.error(`solves done in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
await import('./analyze.mjs')
