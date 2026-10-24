// The solver bench's table: variant B against variant A, paired by board (the boards both have solved).
//   node tools/solverbench/analyze.mjs <A> <B> [--file tools/solverbench/boards.json] [--out tools/solverbench/out]
// Each row a group of boards (all; by floor; by room kind; sentry or none):
//   outcome  solved by A and by B, lost (A's solve B lacks) and gained, the margin's paired difference B − A (the
//            Monarch's share kept, and the solver's value of the won line: −3 × the Monarch's share lost − the souls'
//            share lost − 0.02 a round) on the boards both won, mean ± SE, and the share of boards B plays A's line on
//   cost     plans and ms, mean and median, B's over A's (of the means), the share the budget cut short
//   probes   End Turn alone and the one-wide search (probeOf) won, the boards' difficulty, beside A's and B's solves
// Then the verdict: B keeps every solve of A or the boards it loses, the margin against 2 SE, the speed ratio.
import path from 'node:path'
import { BOARDS, OUT, arg, readBoards, fileOf, readJson, mean, se, median } from './lib.mjs'

const [A, B] = process.argv.slice(2).filter((x, i, xs) => !x.startsWith('--') && !xs[i - 1]?.startsWith('--'))
if (!A || !B) throw new Error('usage: node tools/solverbench/analyze.mjs <variantA> <variantB> [--file boards.json] [--out dir]')
const out = path.resolve(arg('out', OUT))
const { boards } = readBoards(path.resolve(arg('file', BOARDS)))
const at = (v, b) => { const r = readJson(path.join(out, v, fileOf(b.id))); return r && !r.error ? r : null }
const rows = boards.map((b) => ({ b, a: at(A, b), z: at(B, b), p: readJson(path.join(out, 'boards', fileOf(b.id)))?.probe ?? null })).filter((r) => r.a && r.z)
if (!rows.length) throw new Error(`analyze: no board solved by both ${A} and ${B} under ${out}`)
const ka = rows[0].a.key
const kz = rows[0].z.key
if (ka.budget !== kz.budget || JSON.stringify(ka.widths) !== JSON.stringify(kz.widths)) console.log(`note: ${A} ran at budget ${ka.budget} widths ${JSON.stringify(ka.widths)}, ${B} at ${kz.budget} ${JSON.stringify(kz.widths)}`)

const KINDS = ['fight', 'siege', 'elite', 'boss']
const groups = [
  ['all', () => true],
  ...[...new Set(rows.map((r) => r.b.floor))].sort().map((f) => [`floor ${f}`, (r) => r.b.floor === f]),
  ...KINDS.filter((k) => rows.some((r) => r.b.kind === k)).map((k) => [k, (r) => r.b.kind === k]),
  ['sentry', (r) => r.b.sentry],
  ['none', (r) => !r.b.sentry]
]
const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(0)}%` : '–')
const pm = (xs, d = 3) => (xs.length ? `${mean(xs) >= 0 ? '+' : ''}${mean(xs).toFixed(d)} ± ${se(xs).toFixed(d)}` : '–')
const num = (x) => (!Number.isFinite(x) ? '–' : x >= 1e4 ? `${(x / 1e3).toFixed(0)}k` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}k` : x.toFixed(0))
const ratio = (b, a) => (a > 0 ? `×${(b / a).toFixed(2)}` : '–')
const both = (rs) => rs.filter((r) => r.a.solved && r.z.solved)
const stat = (rs) => ({
  rs,
  lost: rs.filter((r) => r.a.solved && !r.z.solved),
  gained: rs.filter((r) => !r.a.solved && r.z.solved),
  dMon: both(rs).map((r) => r.z.margin.monarch - r.a.margin.monarch),
  dVal: both(rs).map((r) => r.z.value - r.a.value),
  same: rs.filter((r) => r.a.line === r.z.line).length / rs.length
})
const table = (head, cells) => {
  const all = [head, ...cells]
  const w = head.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)))
  for (const r of all) console.log(r.map((c, i) => (i ? String(c).padStart(w[i]) : String(c).padEnd(w[i]))).join('  '))
}

console.log(`${B} against ${A}: ${rows.length} boards paired of ${boards.length}, budget ${ka.budget}`)
console.log('')
console.log('outcome (Δ: B − A on the boards both won, mean ± SE)')
table(['', 'n', `solved ${A}`, `solved ${B}`, 'lost', 'gained', 'Δ monarch', 'Δ value', 'same line'], groups.map(([name, f]) => {
  const s = stat(rows.filter(f))
  if (!s.rs.length) return [name, 0, '', '', '', '', '', '', '']
  return [name, s.rs.length, pct(s.rs.filter((r) => r.a.solved).length / s.rs.length), pct(s.rs.filter((r) => r.z.solved).length / s.rs.length), s.lost.length, s.gained.length, pm(s.dMon), pm(s.dVal), pct(s.same)]
}))
console.log('')
console.log('cost (mean / median; ×: B\'s mean over A\'s; cut: the budget cut the solve short)')
table(['', `plans ${A}`, `plans ${B}`, '×plans', `ms ${A}`, `ms ${B}`, '×ms', `cut ${A}`, `cut ${B}`], groups.map(([name, f]) => {
  const rs = rows.filter(f)
  if (!rs.length) return [name, '', '', '', '', '', '', '', '']
  const v = (side, k) => rs.map((r) => r[side][k])
  const mm = (xs) => `${num(mean(xs))} / ${num(median(xs))}`
  return [name, mm(v('a', 'plans')), mm(v('z', 'plans')), ratio(mean(v('z', 'plans')), mean(v('a', 'plans'))), mm(v('a', 'ms')), mm(v('z', 'ms')), ratio(mean(v('z', 'ms')), mean(v('a', 'ms'))), pct(mean(v('a', 'truncated').map(Number))), pct(mean(v('z', 'truncated').map(Number)))]
}))
if (rows.some((r) => r.p)) {
  console.log('')
  console.log('the boards\' difficulty (won: End Turn alone, the one-wide search, the solvers)')
  table(['', 'n', 'idle', 'greedy', A, B], groups.map(([name, f]) => {
    const rs = rows.filter(f).filter((r) => r.p)
    const w = (g) => pct(rs.filter(g).length / rs.length)
    return [name, rs.length, w((r) => r.p.idle.won), w((r) => r.p.greedy.won), w((r) => r.a.solved), w((r) => r.z.solved)]
  }))
}

// The verdict.
const s = stat(rows)
const tag = (r) => `${r.b.id} (floor ${r.b.floor} ${r.b.kind}${r.b.sentry ? ', sentry' : ''})`
console.log('')
if (s.gained.length) console.log(`solved by ${B} alone: ${s.gained.map(tag).join(', ')}`)
if (s.lost.length) console.log(`solved by ${A} alone: ${s.lost.map(tag).join(', ')}`)
const held = (xs) => !xs.length || mean(xs) >= -2 * se(xs)
const up = (xs) => xs.length > 1 && mean(xs) > 2 * se(xs) && mean(xs) > 0
const msA = rows.reduce((n, r) => n + r.a.ms, 0)
const msB = rows.reduce((n, r) => n + r.z.ms, 0)
const plansA = rows.reduce((n, r) => n + r.a.plans, 0)
const plansB = rows.reduce((n, r) => n + r.z.plans, 0)
const speed = msB / msA
console.log(`verdict: ${s.lost.length ? `${B} loses ${s.lost.length} of ${A}'s solves: ${s.lost.map((r) => r.b.id).join(', ')}` : `${B} keeps every solve of ${A}`}` +
  `${s.gained.length ? ` and gains ${s.gained.length}` : ''}; ${B} plays ${A}'s line on ${pct(s.same)} of the boards`)
console.log(`  margin (${both(rows).length} boards both won): Δ value ${pm(s.dVal)}, Δ monarch ${pm(s.dMon)}: ${held(s.dVal) && held(s.dMon) ? 'not lower by 2 SE' : 'LOWER by more than 2 SE'}`)
console.log(`  speed: ${B} takes ×${speed.toFixed(2)} the time of ${A} (${(msB / 1000).toFixed(0)} s against ${(msA / 1000).toFixed(0)} s), ×${(plansB / plansA).toFixed(2)} the plans; per board the median ms ratio ×${median(rows.map((r) => r.z.ms / Math.max(1, r.a.ms))).toFixed(2)}`)
const better = s.gained.length > 0 || up(s.dVal) || speed < 0.95
const gain = !s.lost.length && held(s.dVal) && held(s.dMon) && better
console.log(`  a paired gain: ${gain ? 'yes' : 'no'}${!gain && !s.lost.length && held(s.dVal) && held(s.dMon) ? ` (nothing lost, and nothing better: no board gained, the margin not higher by 2 SE, the time not under ×0.95)` : ''}`)
