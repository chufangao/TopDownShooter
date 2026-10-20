// The forests' fitting, offline (play reads a forest through trees.js): a table of label rows binned (binTable),
// regression trees on histogram splits bagged by run in worker threads (fitForest), the margins measured (marginText).
// outforest.js fits and measures its forests by them.
//   The target, a row an option: its playout value less its position's mean (`mean`) or today's choice's (`today`),
//   clipped to ±`clip`. Trees are bagged by whole runs; seeds ≡ 0 mod 5 are held out (splitOf), never fitted.
import { TARGETS } from './trees.js'
import { pool as workerPool } from './pool.js'

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

// The split of a position by its seed's number (its row's `run`): ≡ 0 mod 5 held out, ≡ 1 validation, the rest training.
export const splitOf = (run) => (run % 5 === 0 ? 'held' : run % 5 === 1 ? 'val' : 'train')

const EPS = 1e-9

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

// ── the trees ────────────────────────────────────────────────────────────────────────────────────

// Tree `t` grown on shared table `S` ({ bins, N, cols, nb, y (the clipped target), w (weights), run (−1: not fitted),
// nRuns }) by `cfg` (a fit's settings: seed, depth, leaves, minLeaf, mtry, shrink, minGain): whole runs drawn with replacement, grown best first on `mtry` of the columns at each
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
//   `without`) on `workers` threads: the positions not held out fitted, each row weighing alike or by its `wt` clipped
//   (`weighted`), × `weightOf(meta, cfg)`, normalised to a mean of 1. `defaults`, `what`, `lineOf(cfg, t, counts)`,
//   `progress` and `configOf(trees, t, cols, cfg, fit)` are the caller's.
//   → { config, trees, oob (each fitted row by the trees whose draw left its run out; NaN for none), held (each held-out
//   row by them all), fitted, heldOut (the positions) }
export async function fitForest (t, cfg, { defaults, lineOf, configOf, log = () => {}, workers = 0, what = 'forest', weightOf = () => 1, progress = true }) {
  cfg = { ...defaults, ...cfg }
  if (!TARGETS.includes(cfg.target)) throw new Error(`${what}: no target "${cfg.target}": ${TARGETS.join(', ')}`)
  const yt = targetsOf(t, cfg.target)
  const names = (cfg.inputs ?? t.names).filter((n) => !cfg.without?.some((pre) => n.startsWith(pre)))
  const cols = Int32Array.from(names.map((n) => {
    const j = t.names.indexOf(n)
    if (j < 0) throw new Error(`${what}: the table lacks input "${n}"`)
    return j
  }))
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
// Fitted trees as trees.js reads them (compileTrees): each tree's size, each node's input its place among `cols` (−1 a
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
// ── measuring ────────────────────────────────────────────────────────────────────────────────────

// Whether table row `r` is ahead of row `b` by predictions `P` (ties: the earlier).
const aheadRow = (P, r, b) => P[r] - P[b] > EPS

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
      if (r > a + 1 && aheadRow(P, r, b)) b = r
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
export const DELTAS = Object.freeze([0, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 1])
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

const threads = node('worker_threads')
if (threads && !threads.isMainThread && threads.workerData?.forest === 'fit') {
  // A fitting worker: tree after tree of the shared table, until it is let go.
  const { S, cfg } = threads.workerData
  threads.parentPort.on('message', (t) => {
    const tree = growTree(S, cfg, t)
    threads.parentPort.postMessage(tree, [tree.feat.buffer, tree.bin.buffer, tree.right.buffer, tree.value.buffer, tree.count.buffer])
  })
}
