// The solver bench's board set, made once: seeded expert runs played at a modest budget (the boards matter, not how
// they were reached), every battle's setup kept, and a set stratified out of them written to boards.json.
//   node tools/solverbench/boards.mjs [--seed sb] [--runs 10] [--per-floor 40] [--boss-share 0.25] [--budget 20000]
//        [--workers n] [--file tools/solverbench/boards.json] [--cache tools/solverbench/out/runs]
// A floor's share: its boss battles first (every boss kind met, then more up to boss-share of the floor), then the rest
// round the cells of room kind × sentry or none in turn, each cell in a fixed order (by its boards' ids' digests).
// The same arguments and src/ make the same file; a run played is kept in the cache, so a stop or a larger set resumes.
import fs from 'node:fs'
import path from 'node:path'
import { REPO_SRC, BOARDS, OUT, arg, workersArg, sha, srcDigest, readJson, writeJson, runPool } from './lib.mjs'

const prefix = arg('seed', 'sb')
const runs = Number(arg('runs', 10))
const perFloor = Number(arg('per-floor', 40))
const bossShare = Number(arg('boss-share', 0.25))
const budget = Number(arg('budget', 20000))
const file = path.resolve(arg('file', BOARDS))
const cache = path.resolve(arg('cache', path.join(OUT, 'runs')))
const workers = workersArg(1)
const src = srcDigest(REPO_SRC)
const seeds = Array.from({ length: runs }, (_, i) => `${prefix}-${i}`)

// The runs: from the cache where one was played by this src at this budget, else played.
const played = new Map()
for (const seed of seeds) {
  const x = readJson(path.join(cache, `${seed}.json`))
  if (x && x.budget === budget && x.src === src) played.set(seed, x)
}
const jobs = seeds.filter((s) => !played.has(s)).map((seed) => ({ kind: 'play', seed, budget }))
console.error(`${runs} runs (seed ${prefix}), budget ${budget}: ${jobs.length} to play (${played.size} cached), ${workers} workers`)
await runPool(jobs, workers, ({ job, res, error }) => {
  if (error) return
  const x = { budget, src, ...res }
  writeJson(path.join(cache, `${job.seed}.json`), x)
  played.set(job.seed, x)
}, { every: 1 })
const missing = seeds.filter((s) => !played.has(s))
if (missing.length) throw new Error(`boards: runs not played: ${missing.join(', ')}`)

// The candidates, and the set.
const all = seeds.flatMap((s) => played.get(s).battles.map((b) => ({ id: `${s}.${b.index}`, ...b })))
const KINDS = ['fight', 'siege', 'elite', 'boss']
const order = (xs) => [...xs].sort((a, b) => (sha(a.id) < sha(b.id) ? -1 : 1))
const roundRobin = (cells, n) => {
  const out = []
  const at = cells.map(() => 0)
  while (out.length < n && cells.some((c, i) => at[i] < c.length)) {
    cells.forEach((c, i) => { if (out.length < n && at[i] < c.length) out.push(c[at[i]++]) })
  }
  return out
}
const chosen = []
for (const floor of [...new Set(all.map((b) => b.floor))].sort()) {
  const here = all.filter((b) => b.floor === floor)
  const bosses = here.filter((b) => b.kind === 'boss')
  const kinds = [...new Set(bosses.map((b) => b.boss))].sort()
  const bossN = Math.min(bosses.length, Math.max(kinds.length, Math.round(perFloor * bossShare)))
  const picked = roundRobin(kinds.map((k) => order(bosses.filter((b) => b.boss === k))), bossN)
  const cells = KINDS.filter((k) => k !== 'boss').flatMap((k) => [true, false].map((s) => order(here.filter((b) => b.kind === k && b.sentry === s))))
  picked.push(...roundRobin(cells, perFloor - picked.length))
  chosen.push(...picked)
}
const rankOf = (b) => [b.floor, KINDS.indexOf(b.kind), b.sentry ? 0 : 1, sha(b.id)]
const cmp = (a, b) => { const x = rankOf(a); const y = rankOf(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0 }
chosen.sort(cmp)

const meta = {
  seeds: { prefix, runs }, perFloor, bossShare, budget, src, knobs: played.get(seeds[0]).knobs,
  runs: seeds.map((s) => ({ seed: s, result: played.get(s).result, floor: played.get(s).floor, battles: played.get(s).battles.length })),
  candidates: all.length
}
const boards = chosen.map(({ won, ...b }) => b)
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, `{"meta":${JSON.stringify(meta)},\n"boards":[\n${boards.map((b) => JSON.stringify(b)).join(',\n')}\n]}\n`)

// The composition.
console.log(`${boards.length} boards of ${all.length} battles in ${runs} runs (${meta.runs.filter((r) => r.result === 'victory').length} cleared) → ${file}`)
const cols = KINDS.flatMap((k) => [`${k}+s`, `${k}`])
console.log(`floor  ${cols.map((c) => c.padStart(8)).join('')}  ${'all'.padStart(5)}  bosses`)
for (const floor of [...new Set(boards.map((b) => b.floor))]) {
  const here = boards.filter((b) => b.floor === floor)
  const n = (k, s) => here.filter((b) => b.kind === k && b.sentry === s).length
  const bosses = [...new Set(here.filter((b) => b.boss).map((b) => b.boss))]
  console.log(`${String(floor).padEnd(5)}  ${KINDS.flatMap((k) => [n(k, true), n(k, false)]).map((x) => String(x).padStart(8)).join('')}  ${String(here.length).padStart(5)}  ${bosses.join(', ')}`)
}
console.log('(+s: a sentry stands among its foes or its waves)')
