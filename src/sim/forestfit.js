// The battle forest's fitting, offline (play reads a forest through forest.js alone): teach.js's labels read as play
// reads a board, regression trees on histogram splits bagged by run in worker threads, the margins measured.
// outforest.js fits and measures its forests by binTable, fitForest and marginText.
//
//   npm run forest -- --data <dir>[,<dir>…] [--out file] [flags]   fit a forest, printing its out-of-bag and held-out margins
//   npm run forest -- --data <dir>[,<dir>…] --eval <file>[,<file>…]   the held-out margins of forests already fitted
//     --out file                 where the forest is written (src/sim/forest.json is the one play reads)
//     --inputs base|aft          the inputs; aft adds the afterstate's (each label set augmented: teach.js --augment)
//     --data-weight 1,0.5,…      each label set's weight, in --data's order
//     --use <dir>,…              the label sets fitted on (all by default; the rest read only for the bins)
//     --label mean|exact         a smoothed set's means, or its exact lines
//     --target mean|today        an option's value less its position's mean, or less today's choice's
//     --trees 200 --depth 12 --leaves 512 --min-leaf 40   the trees' bounds
//     --mtry 0.333               the share of the inputs drawn at each split
//     --shrink 0                 a leaf's value its rows' mean, shrunk by that many rows of 0
//     --bins 64                  the bins an input is cut into, at most
//     --weighted --wclip 10      each row by its draw's `wt`, clipped
//     --seed 1                   the trees' draws
//     --delta 0.1                the margin play reads the forest at
//     --name forest              the forest's name
//     --workers n                worker threads (every core but one by default)
//
// The target, a row an option: its playout value less its position's mean (`mean`) or today's choice's (`today`),
//   clipped to ±`clip`; today's choice the best by the row's `prior`, ties as policy.js better. Trees are bagged by
//   whole runs; seeds ≡ 0 mod 5 are held out (splitOf), never fitted.
// forest.json: { kind, name, about, made, data, inputs, target, delta, size, feat, thr, right, value }.
import {
  inputNames, INPUT_SETS, checkForest, TARGETS, meanOf, rowView, rowOf, rowAfter, afterNames, encodeAgainst, readsAfter, predict
} from './forest.js'
import { LANE } from './field.js'
import { tileX } from './unit.js'
import { pool as workerPool } from './pool.js'
import { arg, has, list, num, isMain } from './cli.js'

const node = (name) => globalThis.process?.getBuiltinModule?.(`node:${name}`)

// A small seeded generator (mulberry32): [0, 1).
export function mulberry (seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── the labels ───────────────────────────────────────────────────────────────────────────────────

export async function * linesOf (file) {
  const fs = node('fs')
  const readline = node('readline')
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) if (line.trim()) yield line
}
// A label set's file: a directory's labels.jsonl, else the file named.
const labelsIn = (where) => {
  const fs = node('fs')
  return fs.statSync(where).isDirectory() ? `${where.replace(/\/$/, '')}/labels.jsonl` : where
}

// The split of a position by its seed's number (teach.js `run`): ≡ 0 mod 5 held out, ≡ 1 validation, the rest training.
export const splitOf = (run) => (run % 5 === 0 ? 'held' : run % 5 === 1 ? 'val' : 'train')

const EPS = 1e-9
// The better of two label options by today's score, ties as policy.js better.
const ahead = (o, b) => {
  if (Math.abs(o.prior - b.prior) > EPS) return o.prior > b.prior
  if (o.steps !== b.steps) return o.steps < b.steps
  const lo = LANE[tileX(o.tile)]
  const lb = LANE[tileX(b.tile)]
  if (lo !== lb) return lo < lb
  return (o.target ?? -1) < (b.target ?? -1)
}

// One label row as the forest reads it: of the options the hard rules keep (meanOf's reference), the legal with a value,
// today's first, each with its inputs against today's (encodeAgainst). → { today, mean, rows: [{ o, x, value, … }] } or null
export function readDecision (row, after = null, names = afterNames()) {
  const kept = row.options.filter((o) => o.kept)
  const opts = kept.filter((o) => o.legal && Number.isFinite(o.value))
  if (opts.length < 2) return null
  const mean = meanOf(kept.map((o) => rowView(o)))
  let today = opts[0]
  for (const o of opts) if (ahead(o, today)) today = o
  const view = (o) => rowOf(o, rowAfter(row.sit, after?.a?.[o.i] ?? null, names))
  const own = view(today)
  const rows = [today, ...opts.filter((o) => o !== today)].map((o) => ({
    o, x: encodeAgainst(row.sit, row.kind, o === today ? own : view(o), mean, own), value: o.value, steps: o.steps, lane: LANE[tileX(o.tile)], target: o.target ?? -1
  }))
  return { today, mean, rows }
}

// What an option's value is read from: `value` (a smoothed set's mean), or `values[0]` (its exact line).
export const LABELS = Object.freeze(['mean', 'exact'])

// The decisions of label sets `dirs`, streamed as { row, d (readDecision's), k (its set's index) }, with the afterstates
// of each set's after.jsonl where `after` (rows past it left out, counted in `skipped`), each value by `label`.
async function * decisionsOf (dirs, after, skipped = null, label = 'mean') {
  if (!LABELS.includes(label)) throw new Error(`forest: no label "${label}": ${LABELS.join(', ')}`)
  const fs = node('fs')
  for (const [k, dir] of dirs.entries()) {
    const file = labelsIn(dir)
    const side = file.replace(/labels\.jsonl$/, 'after.jsonl')
    if (after && !fs.existsSync(side)) throw new Error(`forest: ${dir} has no after.jsonl (npm run teach -- --augment ${dir})`)
    const lines = after ? linesOf(side)[Symbol.asyncIterator]() : null
    const names = after ? JSON.parse(fs.readFileSync(side.replace(/after\.jsonl$/, 'after.json'), 'utf8')).conditions : undefined
    let past = false
    for await (const line of linesOf(file)) {
      const row = JSON.parse(line)
      if (label === 'exact') for (const o of row.options) if (o.values) o.value = o.values[0]
      let a = null
      if (lines) {
        const next = past ? { done: true } : await lines.next()
        if (next.done) {
          past = true
          if (skipped) skipped[k] = (skipped[k] ?? 0) + 1
          continue
        }
        a = JSON.parse(next.value)
        if (a.id !== row.id) throw new Error(`forest: ${side} is not line for line with its labels (at ${row.id})`)
      }
      const d = readDecision(row, a, names)
      if (d) yield { row, d, k }
    }
  }
}

// The cuts of one input from sample values `v`: at most `B` − 1, each where the sample's count passes the next of B
// quantiles and two distinct values meet, at the shortest decimal between them (between). → Float64Array, ascending
export function cutsOf (v, B) {
  const s = Float64Array.from(v).sort()
  const n = s.length
  const out = []
  let next = 1
  for (let i = 0; i + 1 < n; i++) {
    if (s[i] === s[i + 1] || i + 1 < next * n / B) continue
    out.push(between(s[i], s[i + 1]))
    while (next * n / B <= i + 1) next++
  }
  return Float64Array.from(out)
}
// The shortest decimal r with a ≤ r < b (a < b): a threshold that reads the same on the raw number and on its bin.
function between (a, b) {
  for (let p = 1; p <= 17; p++) {
    const r = +((a + b) / 2).toPrecision(p)
    if (r >= a && r < b) return r
  }
  return a
}
// The bin of `x` among `cuts`: the first cut it is at most, else past the last.
function binOf (cuts, x) {
  let lo = 0
  let hi = cuts.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (x <= cuts[mid]) hi = mid
    else lo = mid + 1
  }
  return lo
}

export const shared = (Type, n) => new Type(new SharedArrayBuffer(Math.max(1, n) * Type.BYTES_PER_ELEMENT))

// A table for fitting, read in two passes of `decisions(pass)` ({ row, d, k } each; a row's input j at x[cols[j]]): the
// first counts the rows and keeps a reservoir of `sample` for the cuts (cutsOf, at most `bins` bins); the second bins
// every row in shared memory, column by column, with its value (v) and `extras` ({ name: [Type, (o, p) → a value] }),
// and per decision its start and `metaOf(row, k)`. → { D, N, P, cuts, nb, bins, v, ...extras, start, meta }
export async function binTable (decisions, cols, { bins = 64, sample = 100000, seed = 1, extras = {}, metaOf, what = 'forest' }) {
  const D = cols.length
  const S = Math.max(1, sample)
  const res = new Float64Array(S * D)
  const rand = mulberry(seed)
  let N = 0
  let P = 0
  for await (const { d } of decisions(1)) {
    P++
    for (const r of d.rows) {
      const k = N < S ? N : Math.floor(rand() * (N + 1))
      if (k < S) for (let j = 0; j < D; j++) res[k * D + j] = r.x[cols[j]]
      N++
    }
  }
  const got = Math.min(N, S)
  const column = new Float64Array(got)
  const cuts = []
  for (let j = 0; j < D; j++) {
    for (let i = 0; i < got; i++) column[i] = res[i * D + j]
    cuts.push(cutsOf(column, bins))
  }
  const B = shared(Uint8Array, N * D)
  const v = new Float64Array(N)
  const own = Object.entries(extras).map(([name, [Type, of]]) => [name, new Type(N), of])
  const start = new Int32Array(P + 1)
  const meta = []
  let r = 0
  let p = 0
  for await (const { row, d, k } of decisions(2)) {
    start[p] = r
    for (const o of d.rows) {
      for (let j = 0; j < D; j++) B[j * N + r] = binOf(cuts[j], o.x[cols[j]])
      v[r] = o.value
      for (const [, a, of] of own) a[r] = of(o, p)
      r++
    }
    meta.push(metaOf(row, k))
    p++
  }
  start[p] = r
  if (r !== N || p !== P) throw new Error(`${what}: the labels changed between the passes`)
  return { D, N, P, cuts, nb: Uint8Array.from(cuts, (c) => c.length + 1), bins: B, v, ...Object.fromEntries(own.map(([name, a]) => [name, a])), start, meta }
}

// The decisions of label sets `dirs` (directories of teach.js's labels, or files) as one table (binTable's): a row an
// option, today's choice first, its `inputs` binned; per row its value (v), position and tie keys (steps, lane, target);
// per position its start, id, run, split, group, floor, danger, `wt`, label set (`data`, `dw` its `weights`) and `runKey`.
export async function readTable (dirs, { inputs = INPUT_SETS.base(), weights = null, bins = 64, sample = 100000, seed = 1, log = null, label = 'mean' } = {}) {
  const known = inputNames()
  const cols = Int32Array.from(inputs.map((n) => {
    const i = known.indexOf(n)
    if (i < 0) throw new Error(`forest: unknown input "${n}"`)
    return i
  }))
  const after = inputs.some((n) => n.startsWith('aft.'))
  const skipped = {}
  const t = await binTable((pass) => decisionsOf(dirs, after, pass === 2 ? skipped : null, label), cols, {
    bins,
    sample,
    seed,
    extras: { pos: [Int32Array, (o, p) => p], steps: [Int16Array, (o) => o.steps], lane: [Int8Array, (o) => o.lane], target: [Int32Array, (o) => o.target] },
    metaOf: (row, k) => ({ id: row.id, run: row.run, split: splitOf(row.run), group: row.group, floor: row.floor, danger: row.danger, wt: row.wt ?? 1, data: dirs[k], dw: weights?.[k] ?? 1, runKey: `${k}:${row.run}` })
  })
  for (const [k, n] of Object.entries(skipped)) log?.(`  ${dirs[k]}: ${n} rows past its after.jsonl left out`)
  return { names: inputs.slice(), ...t, dirs: dirs.slice(), label }
}

// ── the trees ────────────────────────────────────────────────────────────────────────────────────

export const FIT = Object.freeze({ target: 'mean', trees: 200, depth: 12, leaves: 512, minLeaf: 40, mtry: 1 / 3, shrink: 0, minGain: 1e-6, clip: 10, weighted: false, wclip: 10, seed: 1, delta: 0.1 })

// Tree `t` grown on shared table `S` ({ bins, N, cols, nb, y (the clipped target), w (weights), run (−1: not fitted),
// nRuns }) by `cfg` (FIT's keys): whole runs drawn with replacement, grown best first on `mtry` of the columns at each
// split; deterministic for the seed and t. → { feat (−1 a leaf), bin (left: at most it), right, value, count } in preorder
export function growTree (S, cfg, t) {
  const { bins, N, cols, nb, y, w, run, nRuns } = S
  const rand = mulberry((Math.imul(cfg.seed >>> 0, 0x9E3779B1) ^ Math.imul(t + 1, 0x85EBCA77)) >>> 0)
  const count = new Uint16Array(nRuns)
  for (let i = 0; i < nRuns; i++) count[Math.floor(rand() * nRuns)]++
  let n = 0
  for (let r = 0; r < N; r++) if (run[r] >= 0 && count[run[r]]) n++
  const idx = new Int32Array(n)
  const tmp = new Int32Array(n)
  const m = new Float64Array(N)
  const my = new Float64Array(N)
  n = 0
  for (let r = 0; r < N; r++) {
    if (run[r] < 0 || !count[run[r]]) continue
    idx[n++] = r
    m[r] = w[r] * count[run[r]]
    my[r] = m[r] * y[r]
  }
  const C = cols.length
  const mtry = Math.max(1, Math.min(C, Math.round(cfg.mtry * C)))
  const perm = Int32Array.from({ length: C }, (_, j) => j)
  const hw = new Float64Array(256)
  const hs = new Float64Array(256)
  const hn = new Int32Array(256)
  const minLeaf = Math.max(1, cfg.minLeaf)
  // The nodes as grown: their rows idx[lo, hi), depth, weight and weighted sum, best split, children.
  const nodes = []
  const make = (lo, hi, depth, W, Sy) => {
    const k = nodes.length
    const x = { lo, hi, depth, W, Sy, gain: -Infinity, c: -1, b: -1, left: -1, right: -1 }
    nodes.push(x)
    if (depth < cfg.depth && hi - lo >= 2 * minLeaf && W > 0) split(x)
    return k
  }
  // A node's best split, on `mtry` columns drawn (a partial shuffle of them).
  const split = (x) => {
    const { lo, hi, W, Sy } = x
    const n = hi - lo
    const base = Sy * Sy / W
    for (let j = 0; j < mtry; j++) {
      const q = j + Math.floor(rand() * (C - j))
      const c = perm[q]
      perm[q] = perm[j]
      perm[j] = c
      const nbc = nb[cols[c]]
      if (nbc < 2) continue
      hw.fill(0, 0, nbc)
      hs.fill(0, 0, nbc)
      hn.fill(0, 0, nbc)
      const off = cols[c] * N
      for (let i = lo; i < hi; i++) {
        const r = idx[i]
        const b = bins[off + r]
        hw[b] += m[r]
        hs[b] += my[r]
        hn[b]++
      }
      let wl = 0
      let sl = 0
      let nl = 0
      for (let b = 0; b + 1 < nbc; b++) {
        wl += hw[b]
        sl += hs[b]
        nl += hn[b]
        if (nl < minLeaf) continue
        if (n - nl < minLeaf) break
        const wr = W - wl
        if (wl <= 0 || wr <= 1e-12) continue
        const sr = Sy - sl
        const gain = sl * sl / wl + sr * sr / wr - base
        if (gain > x.gain + 1e-12) {
          x.gain = gain
          x.c = c
          x.b = b
        }
      }
    }
  }
  let W0 = 0
  let S0 = 0
  for (let i = 0; i < n; i++) {
    W0 += m[idx[i]]
    S0 += my[idx[i]]
  }
  make(0, n, 0, W0, S0)
  const open = nodes[0].c >= 0 ? [0] : []
  let leaves = 1
  while (leaves < cfg.leaves && open.length) {
    let at = 0
    for (let i = 1; i < open.length; i++) if (nodes[open[i]].gain > nodes[open[at]].gain) at = i
    const k = open[at]
    const x = nodes[k]
    if (!(x.gain > cfg.minGain)) break
    open.splice(at, 1)
    // The rows split, each side in its order (the left in place, the right through tmp).
    const off = cols[x.c] * N
    let a = x.lo
    let z = 0
    let wl = 0
    let sl = 0
    for (let i = x.lo; i < x.hi; i++) {
      const r = idx[i]
      if (bins[off + r] <= x.b) {
        idx[a++] = r
        wl += m[r]
        sl += my[r]
      } else tmp[z++] = r
    }
    idx.set(tmp.subarray(0, z), a)
    x.left = make(x.lo, a, x.depth + 1, wl, sl)
    x.right = make(a, x.hi, x.depth + 1, x.W - wl, x.Sy - sl)
    for (const c of [x.left, x.right]) if (nodes[c].c >= 0) open.push(c)
    leaves++
  }
  const order = []
  const stack = [0]
  while (stack.length) {
    const k = stack.pop()
    order.push(k)
    const x = nodes[k]
    if (x.left >= 0) stack.push(x.right, x.left)
  }
  const place = new Int32Array(nodes.length)
  order.forEach((k, i) => { place[k] = i })
  const feat = new Int16Array(order.length)
  const bin = new Uint8Array(order.length)
  const right = new Int32Array(order.length)
  const value = new Float64Array(order.length)
  order.forEach((k, i) => {
    const x = nodes[k]
    if (x.left >= 0) {
      feat[i] = x.c
      bin[i] = x.b
      right[i] = place[x.right]
    } else {
      feat[i] = -1
      value[i] = x.W + cfg.shrink > 0 ? x.Sy / (x.W + cfg.shrink) : 0
    }
  })
  return { feat, bin, right, value, count }
}

// A tree's leaf value for table row `r`, read on its bins.
function leafOn (S, tree, r) {
  const { feat, bin, right, value } = tree
  let k = 0
  for (let f = feat[0]; f >= 0; f = feat[k]) k = S.bins[S.cols[f] * S.N + r] <= bin[k] ? k + 1 : right[k]
  return value[k]
}

// The trees `cfg.trees` of shared table `S`, in worker threads (in this one for 0 or 1), each to `done(t, tree)`.
export async function growTrees (S, cfg, workers, done) {
  if (!(workers > 1)) {
    for (let t = 0; t < cfg.trees; t++) done(t, growTree(S, cfg, t))
    return
  }
  await workerPool(import.meta.url, { forest: 'fit', S, cfg }, Array.from({ length: cfg.trees }, (_, t) => t), workers, (t, tree) => done(t, tree))
}

// Fits a forest on table `t` (binTable's) by `cfg` (`defaults`' keys; `inputs`, less those starting with one of
//   `without`; `use`, the label sets fitted on) on `workers` threads: the positions not held out fitted, each row weighing
//   alike or by its `wt` clipped (`weighted`), × `weightOf(meta, cfg)`, normalised to a mean of 1. `what`, `lineOf`,
//   `progress` and `configOf(trees, t, cols, cfg, fit)` are the caller's (the battle forest's by default).
//   → { config, trees, oob (each fitted row by the trees whose draw left its run out; NaN for none), held (each held-out
//   row by them all), fitted, heldOut (the positions) }
export async function fitForest (t, cfg = {}, { log = () => {}, workers = 0, defaults = FIT, what = 'forest', weightOf = (M) => M.dw, lineOf = fitLine, progress = true, configOf = toConfig } = {}) {
  cfg = { ...defaults, ...cfg }
  if (!TARGETS.includes(cfg.target)) throw new Error(`${what}: no target "${cfg.target}": ${TARGETS.join(', ')}`)
  const yt = targetsOf(t, cfg.target)
  const names = (cfg.inputs ?? t.names).filter((n) => !cfg.without?.some((pre) => n.startsWith(pre)))
  const cols = Int32Array.from(names.map((n) => {
    const j = t.names.indexOf(n)
    if (j < 0) throw new Error(`${what}: the table lacks input "${n}"`)
    return j
  }))
  const use = cfg.use ? new Set(cfg.use) : null
  const runs = new Map()
  const run = shared(Int32Array, t.N).fill(-1)
  const w = shared(Float64Array, t.N)
  const y = shared(Float64Array, t.N)
  const fitted = []
  const heldOut = []
  let wsum = 0
  let rows = 0
  for (let p = 0; p < t.P; p++) {
    const M = t.meta[p]
    if (M.split === 'held') {
      heldOut.push(p)
      continue
    }
    if (use && !use.has(M.data)) continue
    fitted.push(p)
    if (!runs.has(M.runKey)) runs.set(M.runKey, runs.size)
    const wp = (cfg.weighted ? Math.min(M.wt, cfg.wclip) : 1) * weightOf(M, cfg)
    // Today's choice's own row is no advantage over itself: fitted only to the centred target.
    for (let r = t.start[p] + (cfg.target === 'today' ? 1 : 0); r < t.start[p + 1]; r++) {
      run[r] = runs.get(M.runKey)
      w[r] = wp
      wsum += wp
      rows++
    }
  }
  for (let r = 0; r < t.N; r++) {
    if (run[r] >= 0) w[r] *= rows / wsum
    y[r] = Math.max(-cfg.clip, Math.min(cfg.clip, yt[r]))
  }
  const S = { bins: t.bins, N: t.N, cols, nb: t.nb, y, w, run, nRuns: runs.size }
  log(lineOf(cfg, t, { fitted: fitted.length, rows, runs: runs.size, inputs: cols.length }))
  const t0 = Date.now()
  const trees = new Array(cfg.trees)
  let made = 0
  await growTrees(S, cfg, workers, (k, tree) => {
    trees[k] = tree
    if (progress && ++made % Math.max(1, Math.round(cfg.trees / 5)) === 0) log(`  ${made}/${cfg.trees} trees, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  })
  const sum = new Float64Array(t.N)
  const cnt = new Int32Array(t.N)
  const runOf = new Int32Array(t.N).fill(-1)
  const isHeld = new Uint8Array(t.N)
  for (const p of heldOut) for (let r = t.start[p]; r < t.start[p + 1]; r++) isHeld[r] = 1
  for (const p of fitted) for (let r = t.start[p]; r < t.start[p + 1]; r++) runOf[r] = runs.get(t.meta[p].runKey)
  for (const tree of trees) {
    for (let r = 0; r < t.N; r++) {
      const k = runOf[r]
      if (k >= 0 ? tree.count[k] : !isHeld[r]) continue
      sum[r] += leafOn(S, tree, r)
      cnt[r]++
    }
  }
  const oob = new Float64Array(t.N).fill(NaN)
  const held = new Float64Array(t.N).fill(NaN)
  for (let r = 0; r < t.N; r++) {
    if (!cnt[r]) continue
    if (runOf[r] >= 0) oob[r] = sum[r] / cnt[r]
    else held[r] = sum[r] / cnt[r]
  }
  const config = configOf(trees, t, cols, cfg, { fitted: fitted.length, rows, runs: runs.size, seconds: (Date.now() - t0) / 1000 })
  return { config, trees, oob, held, fitted, heldOut }
}

// The battle forest's first line of a fitting (fitForest's lineOf).
const fitLine = (cfg, t, n) => `fitting ${cfg.trees} trees to the ${cfg.target === 'mean' ? 'centred value' : 'advantage over today\'s choice'} on ${n.fitted} positions (${n.rows} rows, ${n.runs} runs), ${n.inputs} inputs: depth ≤ ${cfg.depth}, leaves ≤ ${cfg.leaves}, ` +
  `min leaf ${cfg.minLeaf}, mtry ${+cfg.mtry.toFixed(3)}, shrink ${cfg.shrink}${cfg.weighted ? `, weighted (clip ${cfg.wclip})` : ''}`

// Each row's target: its value less its position's mean (`mean`), or less today's choice's (`today`).
function targetsOf (t, target) {
  const y = new Float64Array(t.N)
  for (let p = 0; p < t.P; p++) {
    const a = t.start[p]
    const z = t.start[p + 1]
    let m = t.v[a]
    if (target === 'mean') {
      m = 0
      for (let r = a; r < z; r++) m += t.v[r]
      m /= z - a
    }
    for (let r = a; r < z; r++) y[r] = t.v[r] - m
  }
  return y
}

const round = (v, p = 5) => +v.toPrecision(p)
// Fitted trees as forest.js reads them (compileTrees): each tree's size, each node's input its place among `cols` (−1 a
// leaf), each split's threshold its bin's cut, each right child as nodes ahead, each leaf's value to five figures.
export function flatTrees (trees, t, cols) {
  const feat = []
  const thr = []
  const right = []
  const value = []
  for (const tree of trees) {
    for (let i = 0; i < tree.feat.length; i++) {
      const c = tree.feat[i]
      feat.push(c)
      if (c < 0) value.push(round(tree.value[i]))
      else {
        thr.push(t.cuts[cols[c]][tree.bin[i]])
        right.push(tree.right[i] - i)
      }
    }
  }
  return { size: trees.map((x) => x.feat.length), feat, thr, right, value }
}
// Fitted trees as forest.json's configuration (fitForest's configOf).
function toConfig (trees, t, cols, cfg, fit) {
  const { target, trees: n, depth, leaves, minLeaf, mtry, shrink, weighted, wclip, clip, seed, delta } = cfg
  return {
    kind: 'forest',
    name: cfg.name ?? 'forest',
    about: `a random forest's advantage over today's choice (src/sim/forest.js), fitted on teach.js's labels to the battle's end (target ${target}); today's choice unless the best other candidate's exceeds delta`,
    made: { at: new Date().toISOString(), trees: n, depth, leaves, minLeaf, mtry: +mtry.toFixed(4), shrink, weighted, wclip, clip, seed, bins: Math.max(...t.nb), label: t.label ?? 'mean', positions: fit.fitted, rows: fit.rows, runs: fit.runs, seconds: +fit.seconds.toFixed(1) },
    data: cfg.data ?? t.dirs,
    inputs: Array.from(cols, (j) => t.names[j]),
    target,
    delta,
    ...flatTrees(trees, t, cols)
  }
}

// ── measuring ────────────────────────────────────────────────────────────────────────────────────

// The better of two table rows by predictions `P`, ties as policy.js better where the table has the tie keys, else the earlier.
const aheadRow = (t, P, r, b) => {
  if (Math.abs(P[r] - P[b]) > EPS) return P[r] > P[b]
  if (!t.steps) return false
  if (t.steps[r] !== t.steps[b]) return t.steps[r] < t.steps[b]
  if (t.lane[r] !== t.lane[b]) return t.lane[r] < t.lane[b]
  return t.target[r] < t.target[b]
}

// How predictions `P` (a table row each) decide positions `list` at margin `delta`, as play would: the best other option
//   taken where its advantage over today's choice exceeds delta. → { n, changed (the share), gain (the mean advantage
//   realised by the playouts), wgain (the same by the draw's weight), up and down (the shares changed for a better and a
//   worse playout), oracle (the mean best advantage: the teacher's), woracle }
export function decided (t, list, P, delta, target = 'mean') {
  let n = 0
  let changed = 0
  let gain = 0
  let wgain = 0
  let wsum = 0
  let up = 0
  let down = 0
  let oracle = 0
  let woracle = 0
  for (const p of list) {
    const a = t.start[p]
    const z = t.start[p + 1]
    if (z - a < 2 || Number.isNaN(P[a + 1])) continue
    const base = target === 'mean' ? P[a] : 0
    let b = a + 1
    let top = 0
    for (let r = a + 1; r < z; r++) {
      if (r > a + 1 && aheadRow(t, P, r, b)) b = r
      top = Math.max(top, t.v[r] - t.v[a])
    }
    const wt = t.meta[p].wt
    n++
    wsum += wt
    oracle += top
    woracle += wt * top
    if (!(P[b] - base > delta)) continue
    const y = t.v[b] - t.v[a]
    changed++
    gain += y
    wgain += wt * y
    if (y > EPS) up++
    else if (y < -EPS) down++
  }
  const by = (x, of) => (of ? x / of : 0)
  return { n, changed: by(changed, n), gain: by(gain, n), wgain: by(wgain, wsum), up: by(up, n), down: by(down, n), oracle: by(oracle, n), woracle: by(woracle, wsum) }
}

// The margins a table is read at.
const DELTAS = Object.freeze([0, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 1])
// A table of predictions `P` over positions `list`, a line a margin (decided's): the decisions changed, the advantage
// realised (per position and by the draw's weight), the changes that gained and lost.
export function marginText (t, list, P, deltas = DELTAS, target = 'mean') {
  const pct = (x) => `${(100 * x).toFixed(1)}%`.padStart(7)
  const out = [`${'delta'.padStart(6)} ${'n'.padStart(7)} ${'changed'.padStart(8)} ${'gain'.padStart(8)} ${'w gain'.padStart(8)} ${'better'.padStart(7)} ${'worse'.padStart(7)}`]
  let oracle = null
  for (const d of deltas) {
    const r = decided(t, list, P, d, target)
    oracle = r
    out.push(`${String(d).padStart(6)} ${String(r.n).padStart(7)} ${pct(r.changed).padStart(8)} ${r.gain.toFixed(4).padStart(8)} ${r.wgain.toFixed(4).padStart(8)} ${pct(r.up)} ${pct(r.down)}`)
  }
  if (oracle) out.push(`(the teacher: gain ${oracle.oracle.toFixed(4)}, by weight ${oracle.woracle.toFixed(4)})`)
  return out.join('\n')
}

// The held-out decisions of `decisions` as a table for decided and marginText, raw inputs read as play reads them, with
// each of predictors `of` (inputs → a prediction) on every row. → { t (v, `keys`, start, meta), P: [an array a predictor] }
export async function heldTable (decisions, of, keys = []) {
  const t = { v: [], ...Object.fromEntries(keys.map((k) => [k, []])), start: [0], meta: [] }
  const P = of.map(() => [])
  for await (const { row, d } of decisions) {
    if (splitOf(row.run) !== 'held') continue
    for (const o of d.rows) {
      of.forEach((f, i) => P[i].push(f(o.x)))
      t.v.push(o.value)
      for (const k of keys) t[k].push(o[k])
    }
    t.start.push(t.v.length)
    t.meta.push({ wt: row.wt ?? 1 })
  }
  return { t, P }
}

// The held-out margins table of forests `configs` on label sets `dirs`, read as play reads them. → { [name]: text }
async function evalForests (dirs, configs, { log = null } = {}) {
  const after = configs.some((c) => readsAfter(c))
  const { t, P } = await heldTable(decisionsOf(dirs, after), configs.map((c) => (x) => predict(c, x)), ['steps', 'lane', 'target'])
  const list = t.meta.map((_, p) => p)
  const out = {}
  configs.forEach((c, i) => {
    out[c.name] = marginText(t, list, P[i], [...new Set([c.delta, ...DELTAS])].sort((a, b) => a - b), c.target ?? 'today')
    log?.(`\n${c.name} (delta ${c.delta}), held out (seeds ≡ 0 mod 5):\n${out[c.name]}`)
  })
  return out
}

// ── the command ──────────────────────────────────────────────────────────────────────────────────

async function main () {
  const dirs = list('data')
  if (!dirs.length) throw new Error('forest: --data <dir>[,<dir>…] of teach.js labels')
  const fs = node('fs')
  const os = node('os')
  const t0 = Date.now()
  const evals = list('eval')
  if (evals.length) {
    await evalForests(dirs, evals.map((f) => ({ ...checkForest(JSON.parse(fs.readFileSync(f, 'utf8'))), name: f })), { log: console.log })
    return
  }
  const set = arg('inputs', 'base')
  if (!INPUT_SETS[set]) throw new Error(`forest: --inputs ${set}: one of ${Object.keys(INPUT_SETS).join(', ')}`)
  const weights = list('data-weight').map(Number)
  const bins = Number(arg('bins', 64))
  if (!(bins >= 2 && bins <= 256)) throw new Error('forest: --bins between 2 and 256')
  const label = arg('label', 'mean')
  console.log(`reading ${dirs.join(', ')} (inputs ${set}${weights.length ? `, weights ${weights.join(', ')}` : ''}, ${bins} bins${label !== 'mean' ? `, the ${label} labels` : ''})`)
  const t = await readTable(dirs, { inputs: INPUT_SETS[set](), weights: weights.length ? weights : null, bins, log: console.log, label })
  console.log(`${t.P} positions, ${t.N} rows, ${t.D} inputs (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
  const cfg = Object.fromEntries(Object.entries({
    target: arg('target'), trees: num('trees'), depth: num('depth'), leaves: num('leaves'), minLeaf: num('min-leaf'), mtry: num('mtry'), shrink: num('shrink'), wclip: num('wclip'), seed: num('seed'), delta: num('delta'),
    name: arg('name')
  }).filter(([, v]) => v != null))
  if (has('weighted')) cfg.weighted = true
  if (list('use').length) cfg.use = list('use')
  cfg.data = dirs
  const workers = Number(arg('workers', Math.max(1, os.availableParallelism() - 1)))
  const r = await fitForest(t, cfg, { log: console.log, workers })
  const target = r.config.target
  console.log(`\nout of bag (the positions fitted, each by the trees whose draw left its run out):\n${marginText(t, r.fitted, r.oob, DELTAS, target)}`)
  console.log(`\nheld out (seeds ≡ 0 mod 5):\n${marginText(t, r.heldOut, r.held, DELTAS, target)}`)
  const out = arg('out', null)
  if (out) {
    const text = JSON.stringify(r.config) + '\n'
    fs.writeFileSync(out, text)
    console.log(`\nwrote ${out}: ${r.config.size.length} trees, ${r.config.feat.length} nodes, ${(text.length / 1e6).toFixed(2)} MB (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
  }
}

const threads = node('worker_threads')
if (threads && !threads.isMainThread && threads.workerData?.forest === 'fit') {
  // A fitting worker: tree after tree of the shared table, until it is let go.
  const { S, cfg } = threads.workerData
  threads.parentPort.on('message', (t) => {
    const tree = growTree(S, cfg, t)
    threads.parentPort.postMessage(tree, [tree.feat.buffer, tree.bin.buffer, tree.right.buffer, tree.value.buffer, tree.count.buffer])
  })
} else if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
