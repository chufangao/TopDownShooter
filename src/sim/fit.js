// The fitter of the expert's model tree, offline: fits an expert configuration (src/sim/expert.json: a tree over the
// conditions, each leaf its weights over the option features, and the soft rules) to teach.js's labels by a listwise
// softmax loss; seeds ≡ 0 mod 5 held out, ≡ 1 mod 5 the validation set the tree's size is chosen on.
//
//   npm run fit -- --data <dir> [flags]      fit to the labels in <dir> (labels.jsonl, else every .jsonl or .json)
//   npm run fit -- --default [--out file]    today's scorer (expert.js defaultExpert) written as the tree
//     --out file                 where the tree goes (src/sim/expert.json by default, its tree alone replaced)
//     --tau 0                    the targets' temperature (0: a fifth of the median spread of a position's values)
//     --lambda 3 --relative      the L2 toward each leaf's prior (with --relative ÷ T², in the softmax's own units)
//     --depth 4 --leaves 12      the tree's bounds
//     --min-leaf 0               the smallest leaf (0: 2% of the training positions, at least 30)
//     --weighted                 each position by its draw's weight (`wt`)
//     --weights k=x,…            the values read again from their parts, named or monarch,own,foe,lost,won in order
//     --fixed | --hard           today's rules kept as they are, or its hard ones kept hard and the rest fitted soft
//     --structure grow|prior     grow a tree, or refit the prior's leaves
//     --prior file.json          the configuration to start from (today's by default)
//     --unchosen                 the expert's own option left out of each position
//     --decisive                 positions whose options all score alike left out
//     --dry                      nothing written
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { RULES, defaultExpert, checkModel, leafOf, holds, pathName } from './expert.js'
import { arg, has, isMain } from './cli.js'

// ── the data ─────────────────────────────────────────────────────────────────────────────────────

// An option's value from its parts by `weights` (a label to the battle's end, with `turns`, over END: teach.js END_WEIGHTS).
const END = { lost: 10, monarch: 3, own: 1, turn: 0.02 }
export function relabel (parts, weights) {
  if (parts.turns !== undefined) {
    const w = { ...END, ...weights }
    return parts.lost ? -w.lost : -w.monarch * parts.monarch - w.own * parts.own - w.turn * parts.turns
  }
  return -weights.monarch * parts.monarch - weights.own * parts.own + weights.foe * parts.foe - weights.lost * parts.lost + weights.won * parts.won
}
// Labelled rows, an option a row, from a file or a directory (labels.jsonl, else every .jsonl or .json, gzipped or not).
export function readRows (where, { weights = null, unchosen = false } = {}) {
  const dir = fs.statSync(where).isDirectory()
  const files = dir && fs.existsSync(path.join(where, 'labels.jsonl')) ? [path.join(where, 'labels.jsonl')]
    : dir ? fs.readdirSync(where).filter((f) => /\.(jsonl|json|ndjson)(\.gz)?$/.test(f) && !/^(manifest|report|runs)\./.test(f)).sort().map((f) => path.join(where, f))
      : [where]
  const rows = []
  for (const f of files) {
    let text = fs.readFileSync(f)
    if (f.endsWith('.gz')) text = zlib.gunzipSync(text)
    text = text.toString('utf8')
    const add = (r) => {
      // A position with its options (teach.js): a row an option, the position's fields on each.
      const valueOf = (o) => (weights && o.parts ? relabel(o.parts, weights) : o.value)
      if (Array.isArray(r.options)) for (const o of r.options) if (!(unchosen && o.chosen)) rows.push({ pos: r.id, seed: r.seed, uid: r.uid, sit: r.sit, split: r.split, wt: r.wt, v: o.f, legal: o.legal, chosen: o.chosen, value: valueOf(o) })
      else rows.push(r)
    }
    if (/\.(jsonl|ndjson)(\.gz)?$/.test(f)) {
      for (const line of text.split('\n')) if (line.trim()) add(JSON.parse(line))
    } else {
      const j = JSON.parse(text)
      for (const r of Array.isArray(j) ? j : j.rows ?? []) add(r)
    }
  }
  return rows
}

// A row read in its parts, whatever its fields are called: { pos, seed, uid, v, c (conditions), legal, chosen, value, held, wt }.
const pick = (r, ...keys) => {
  for (const k of keys) if (r[k] !== undefined) return r[k]
  return undefined
}
export const rowOf = (r) => ({
  pos: String(pick(r, 'pos', 'position', 'positionId', 'id')),
  seed: pick(r, 'seed') ?? '',
  uid: pick(r, 'uid'),
  v: pick(r, 'v', 'features', 'optionFeatures', 'x'),
  c: pick(r, 'c', 'situation', 'conditions', 'sit'),
  legal: pick(r, 'legal') ?? true,
  chosen: !!pick(r, 'chosen', 'chosenByExpert', 'expert'),
  value: pick(r, 'value', 'playout', 'y'),
  held: r.split !== undefined ? r.split === 'held' : heldOut(pick(r, 'seed') ?? ''),
  wt: Number.isFinite(r.wt) ? r.wt : 1
})

// A seed's number: its trailing digits (a seed with none, a hash of it).
export const seedNo = (seed) => {
  const m = /(\d+)\D*$/.exec(String(seed))
  if (m) return Number(m[1])
  let h = 0
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(h)
}
export const heldOut = (seed) => seedNo(seed) % 5 === 0

// The rows as arrays, positions in order of first appearance, a position's legal options together:
//   F, K (feature and condition names), n, m (positions, options), X (m × F), y (values), start (n + 1), C (n × K),
//   held, wt, chosen (index within its position, −1 for none), R (m × rules: each option's standing under each rule),
//   c (each position's conditions by name), seeds, rules.
// Options with no finite value or features, positions with fewer than two, and with `decisive` those all alike, dropped.
export function tabulate (rows, { features, conditions = null, decisive = false } = {}) {
  const byPos = new Map()
  for (const raw of rows) {
    const r = rowOf(raw)
    if (!r.legal || !Number.isFinite(r.value) || !r.v) continue
    let p = byPos.get(r.pos)
    if (!p) byPos.set(r.pos, (p = { seed: r.seed, uid: r.uid, c: r.c ?? {}, held: r.held, wt: r.wt, opts: [] }))
    p.opts.push(r)
  }
  const F = features
  const K = conditions ?? [...new Set([...byPos.values()].flatMap((p) => Object.keys(p.c)))].filter((k) => [...byPos.values()].some((p) => Number.isFinite(+p.c[k])))
  const ids = Object.keys(RULES)
  const differ = (p) => Math.max(...p.opts.map((o) => o.value)) - Math.min(...p.opts.map((o) => o.value)) > 1e-9
  const pos = [...byPos.values()].filter((p) => p.opts.length >= 2 && (!decisive || differ(p)))
  const m = pos.reduce((k, p) => k + p.opts.length, 0)
  const n = pos.length
  const d = {
    F, K, n, m, X: new Float64Array(m * F.length), y: new Float64Array(m), start: new Int32Array(n + 1), C: new Float64Array(n * K.length),
    held: new Uint8Array(n), wt: new Float64Array(n), chosen: new Int32Array(n).fill(-1), R: new Uint8Array(m * ids.length), c: [], seeds: [], rules: ids
  }
  let i = 0
  pos.forEach((p, j) => {
    d.start[j] = i
    d.held[j] = p.held ? 1 : 0
    d.wt[j] = p.wt
    d.seeds.push(p.seed)
    const c = {}
    K.forEach((k, a) => { c[k] = d.C[j * K.length + a] = +(p.c[k] ?? 0) || 0 })
    d.c.push(c)
    for (const o of p.opts) {
      const v = {}
      F.forEach((f, a) => { v[f] = d.X[i * F.length + a] = +(o.v[f] ?? 0) || 0 })
      d.y[i] = o.value
      if (o.chosen) d.chosen[j] = i - d.start[j]
      ids.forEach((id, a) => { d.R[i * ids.length + a] = +RULES[id].keep(v) })
      i++
    }
  })
  d.start[n] = i
  return d
}

// ── scoring a configuration on the data, as play would ───────────────────────────────────────────

// Each position's option chosen by `model` as play chooses it. → [{ pick (index within the position), leaf, path }]
export function choices (model, d, list) {
  const F = d.F.length
  const nr = d.rules.length
  const out = []
  for (const j of list) {
    const c = d.c[j]
    const r = leafOf(model, c)
    const a = d.start[j]
    const b = d.start[j + 1]
    const w = d.F.map((f) => r.w[f] ?? 0)
    let alive = []
    for (let i = a; i < b; i++) alive.push(i)
    const soft = []
    for (const rule of model.rules ?? []) {
      if (!rule.on || !holds(rule.when, c)) continue
      const k = d.rules.indexOf(rule.id)
      if (rule.hard) {
        if (alive.length < 2) continue
        const top = Math.max(...alive.map((i) => d.R[i * nr + k]))
        const kept = alive.filter((i) => d.R[i * nr + k] === top)
        if (kept.length < alive.length) alive = kept
      } else if (rule.strength) soft.push([k, rule.strength])
    }
    let best = -1
    let top = -Infinity
    for (const i of alive) {
      let s = 0
      for (let f = 0; f < F; f++) s += w[f] * d.X[i * F + f]
      for (const [k, st] of soft) s += st * d.R[i * nr + k]
      if (s > top + 1e-9) { top = s; best = i }
    }
    out.push({ pick: best - a, leaf: r.leaf.leaf, path: pathName(r) })
  }
  return out
}

// How picks (an index within each position, −1 skipped) agree with the playouts over `list`. → { n, top1, regret }
export function agreement (d, list, picks, tol = 1e-6) {
  let n = 0
  let top = 0
  let regret = 0
  list.forEach((j, k) => {
    const p = picks[k]
    if (p < 0) return
    const a = d.start[j]
    let best = -Infinity
    for (let i = a; i < d.start[j + 1]; i++) best = Math.max(best, d.y[i])
    const y = d.y[a + p]
    n++
    if (y >= best - tol * Math.max(1, Math.abs(best))) top++
    regret += best - y
  })
  return { n, top1: n ? top / n : 0, regret: n ? regret / n : 0 }
}

// ── the loss ─────────────────────────────────────────────────────────────────────────────────────

// Each feature's spread within positions (its root mean square about its position's mean), 1 for one that never varies.
function spreads (d) {
  const F = d.F.length
  const s = new Float64Array(F)
  const mean = new Float64Array(F)
  for (let j = 0; j < d.n; j++) {
    const a = d.start[j]
    const b = d.start[j + 1]
    mean.fill(0)
    for (let i = a; i < b; i++) for (let f = 0; f < F; f++) mean[f] += d.X[i * F + f] / (b - a)
    for (let i = a; i < b; i++) for (let f = 0; f < F; f++) s[f] += (d.X[i * F + f] - mean[f]) ** 2
  }
  return Array.from(s, (x) => Math.sqrt(x / d.m) || 0)
}

// The playouts' own distribution over each position's options: softmax(value ÷ tau), over those `mask` leaves.
function targets (d, tau, mask = null) {
  const q = new Float64Array(d.m)
  for (let j = 0; j < d.n; j++) {
    const a = d.start[j]
    const b = d.start[j + 1]
    let top = -Infinity
    for (let i = a; i < b; i++) if (!mask || mask[i]) top = Math.max(top, d.y[i])
    let z = 0
    for (let i = a; i < b; i++) z += (q[i] = !mask || mask[i] ? Math.exp((d.y[i] - top) / tau) : 0)
    for (let i = a; i < b; i++) q[i] /= z
  }
  return q
}

// The options the hard rules of `rules` leave in each position (as expert.js hardFilter, in order). → 1 kept, 0 not.
function hardMask (d, rules) {
  const mask = new Uint8Array(d.m).fill(1)
  const nr = d.rules.length
  for (let j = 0; j < d.n; j++) {
    let left = []
    for (let i = d.start[j]; i < d.start[j + 1]; i++) left.push(i)
    for (const r of rules) {
      if (!r.on || !r.hard || left.length < 2 || !holds(r.when, d.c[j])) continue
      const k = d.rules.indexOf(r.id)
      const top = Math.max(...left.map((i) => d.R[i * nr + k]))
      left = left.filter((i) => d.R[i * nr + k] === top)
    }
    for (let i = d.start[j]; i < d.start[j + 1]; i++) mask[i] = 0
    for (const i of left) mask[i] = 1
  }
  return mask
}
// What a hard rule's filter takes off an option's score (raw), out of every softmax.
const BARRED = -1e12

// A fitting context: the features scaled by their spreads (Z), the targets, the temperature, the scores' fixed parts.
function context (d, { tau, T }) {
  const sd = spreads(d)
  const F = d.F.length
  const Z = new Float64Array(d.m * F)
  for (let i = 0; i < d.m; i++) for (let f = 0; f < F; f++) Z[i * F + f] = sd[f] ? d.X[i * F + f] / sd[f] : 0
  return { d, F, sd, Z, q: targets(d, tau), T, off: new Float64Array(d.m), tau, pw: new Float64Array(d.n).fill(1) }
}

// The loss of position j under scaled weights u, its gradient and Hessian in u added to `g` and `H` where given.
function posLoss (ctx, j, u, g = null, H = null) {
  const { d, F, Z, q, T, off } = ctx
  const a = d.start[j]
  const b = d.start[j + 1]
  const k = b - a
  const s = new Float64Array(k)
  let top = -Infinity
  for (let i = a; i < b; i++) {
    let x = off[i]
    for (let f = 0; f < F; f++) x += u[f] * Z[i * F + f]
    s[i - a] = x / T
    if (s[i - a] > top) top = s[i - a]
  }
  let z = 0
  for (let t = 0; t < k; t++) z += Math.exp(s[t] - top)
  const lz = top + Math.log(z)
  const pw = ctx.pw[j]
  let loss = 0
  for (let i = a; i < b; i++) if (q[i] > 0) loss -= q[i] * (s[i - a] - lz)
  loss *= pw
  if (g) {
    const mean = new Float64Array(F)
    for (let i = a; i < b; i++) {
      const p = Math.exp(s[i - a] - lz)
      const r = pw * (p - q[i]) / T
      for (let f = 0; f < F; f++) {
        const x = Z[i * F + f]
        g[f] += r * x
        mean[f] += p * x
      }
      if (H) {
        const w = pw * p / (T * T)
        for (let f = 0; f < F; f++) {
          const x = Z[i * F + f]
          if (x === 0) continue
          for (let e = 0; e <= f; e++) H[f * F + e] += w * x * Z[i * F + e]
        }
      }
    }
    if (H) {
      const w = pw / (T * T)
      for (let f = 0; f < F; f++) for (let e = 0; e <= f; e++) H[f * F + e] -= w * mean[f] * mean[e]
    }
  }
  return loss
}

// Solves (H + λI) x = g for a symmetric H held in its lower triangle (Cholesky). → x
function solve (H, g, F, lambda) {
  const L = new Float64Array(F * F)
  for (let i = 0; i < F; i++) {
    for (let j = 0; j <= i; j++) {
      let s = H[i * F + j] + (i === j ? lambda : 0)
      for (let k = 0; k < j; k++) s -= L[i * F + k] * L[j * F + k]
      L[i * F + j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j * F + j]
    }
  }
  const y = new Float64Array(F)
  for (let i = 0; i < F; i++) {
    let s = g[i]
    for (let k = 0; k < i; k++) s -= L[i * F + k] * y[k]
    y[i] = s / L[i * F + i]
  }
  const x = new Float64Array(F)
  for (let i = F - 1; i >= 0; i--) {
    let s = y[i]
    for (let k = i + 1; k < F; k++) s -= L[k * F + i] * x[k]
    x[i] = s / L[i * F + i]
  }
  return x
}

// The loss of positions `list` under u, with the L2 toward `u0` (λ/2 |u − u0|²).
function leafLoss (ctx, list, u, u0, lambda) {
  let n = 0
  for (const j of list) n += posLoss(ctx, j, u)
  for (let f = 0; f < ctx.F; f++) n += lambda / 2 * (u[f] - u0[f]) ** 2
  return n
}

// A leaf's scaled weights fitted to `list` by Newton's method from `u0`, its prior and the L2's centre. → { u, loss }
function fitLeaf (ctx, list, u0, lambda, { iters = 12 } = {}) {
  const F = ctx.F
  let u = Float64Array.from(u0)
  let loss = leafLoss(ctx, list, u, u0, lambda)
  for (let it = 0; it < iters; it++) {
    const g = new Float64Array(F)
    const H = new Float64Array(F * F)
    for (const j of list) posLoss(ctx, j, u, g, H)
    for (let f = 0; f < F; f++) g[f] += lambda * (u[f] - u0[f])
    const step = solve(H, g, F, lambda)
    let alpha = 1
    let next = null
    let nl = Infinity
    for (let k = 0; k < 20; k++, alpha /= 2) {
      next = u.map((x, f) => x - alpha * step[f])
      nl = leafLoss(ctx, list, next, u0, lambda)
      if (nl <= loss) break
    }
    if (!(nl <= loss)) break
    const gain = loss - nl
    u = next
    loss = nl
    if (gain < 1e-7 * Math.max(1, Math.abs(loss))) break
  }
  return { u, loss }
}

// ── the tree ─────────────────────────────────────────────────────────────────────────────────────

// Candidate cuts of condition k over `list`, between distinct values (every one with at most 2 × `most` values, else
// `most` at its quantiles), each leaving `min` positions a side. → { order (indices into list), vals, cuts: [{ i, at }] }
function thresholds (ctx, list, k, min, most = 16) {
  const { d } = ctx
  const K = d.K.length
  const vals = list.map((j) => d.C[j * K + k])
  const order = list.map((_, i) => i).sort((a, b) => vals[a] - vals[b])
  const n = order.length
  const ok = (i) => i >= min && n - i >= min && vals[order[i]] !== vals[order[i - 1]]
  const cuts = new Map()
  let distinct = 1
  for (let i = 1; i < n && distinct <= 2 * most; i++) if (vals[order[i]] !== vals[order[i - 1]]) distinct++
  if (distinct <= 2 * most) {
    for (let i = 1; i < n; i++) if (ok(i)) cuts.set(i, (vals[order[i - 1]] + vals[order[i]]) / 2)
    return { order, vals, cuts: [...cuts].map(([i, at]) => ({ i, at })) }
  }
  for (let q = 1; q <= most; q++) {
    const i0 = Math.floor(q * n / (most + 1))
    let i = i0
    while (i < n && i > 0 && vals[order[i]] === vals[order[i - 1]]) i++
    if (!ok(i)) {
      i = i0
      while (i > 0 && vals[order[i]] === vals[order[i - 1]]) i--
      if (!ok(i)) continue
    }
    cuts.set(i, (vals[order[i - 1]] + vals[order[i]]) / 2)
  }
  return { order, vals, cuts: [...cuts].map(([i, at]) => ({ i, at })) }
}

// The best split of a leaf (positions `list`, scaled weights `u`): each condition's cuts scored by a second-order estimate
// of the loss saved, the best `exact` of them fitted by a few Newton steps and measured. → { k, at, lo, hi, gain } or null
function bestSplit (ctx, list, u, lambda, { min, exact = 4, skip = new Set() }) {
  const { d, F } = ctx
  const K = d.K.length
  const n = list.length
  const gs = new Float64Array(n * F)
  const H = new Float64Array(F * F)
  const one = new Float64Array(F)
  list.forEach((j, i) => {
    one.fill(0)
    posLoss(ctx, j, u, one, H)
    gs.set(one, i * F)
  })
  const total = new Float64Array(F)
  for (let i = 0; i < n; i++) for (let f = 0; f < F; f++) total[f] += gs[i * F + f]
  const est = (g, share) => {
    const x = solve(H.map((h) => h * share), g, F, lambda)
    let s = 0
    for (let f = 0; f < F; f++) s += g[f] * x[f]
    return s / 2
  }
  const cands = []
  for (let k = 0; k < K; k++) {
    if (skip.has(d.K[k])) continue
    const t = thresholds(ctx, list, k, min)
    if (!t.cuts.length) continue
    const lo = new Float64Array(F)
    let c = 0
    for (let i = 0; i < n && c < t.cuts.length; i++) {
      if (i === t.cuts[c].i) {
        const hi = total.map((x, f) => x - lo[f])
        cands.push({ k, at: t.cuts[c].at, order: t.order, cut: i, score: est(lo, i / n) + est(hi, 1 - i / n) })
        c++
      }
      const r = t.order[i] * F
      for (let f = 0; f < F; f++) lo[f] += gs[r + f]
    }
  }
  cands.sort((a, b) => b.score - a.score)
  const base = leafLoss(ctx, list, u, u, lambda)
  let best = null
  for (const c of cands.slice(0, exact)) {
    const lo = c.order.slice(0, c.cut).map((i) => list[i])
    const hi = c.order.slice(c.cut).map((i) => list[i])
    const gain = base - fitLeaf(ctx, lo, u, lambda, { iters: 4 }).loss - fitLeaf(ctx, hi, u, lambda, { iters: 4 }).loss
    if (!best || gain > best.gain) best = { k: c.k, at: c.at, lo, hi, gain }
  }
  return best
}

// The leaves of a fitting tree (its nodes { split: { k, at }, lo, hi } or { u, list }).
function leaves (node, out = []) {
  if (node.u) out.push(node)
  else {
    leaves(node.lo, out)
    leaves(node.hi, out)
  }
  return out
}

function leafFor (ctx, node, j) {
  const K = ctx.d.K.length
  while (!node.u) node = (node.split.k < 0 ? 0 : ctx.d.C[j * K + node.split.k]) > node.split.at ? node.hi : node.lo
  return node
}

// Grows a tree best first from a root of prior u0: each step the leaf whose best split saves the most, while it saves
// more than `minGain` within `maxLeaves` and `depth`. → every tree on the way, [{ tree, leaves (count) }]
function grow (ctx, train, u0, { lambda, depth, minLeaf, maxLeaves, minGain, log }) {
  const root = { u: fitLeaf(ctx, train, u0, lambda).u, list: train, depth: 0, prior: u0 }
  const snap = (n) => (n.u ? { u: Float64Array.from(n.u) } : { split: n.split, lo: snap(n.lo), hi: snap(n.hi) })
  const out = [{ tree: snap(root), leaves: 1 }]
  const pending = new Map()
  for (let count = 1; count < maxLeaves; count++) {
    let best = null
    for (const leaf of leaves(root)) {
      if (leaf.depth >= depth || leaf.list.length < 2 * minLeaf) continue
      if (!pending.has(leaf)) pending.set(leaf, bestSplit(ctx, leaf.list, leaf.u, lambda, { min: minLeaf }))
      const s = pending.get(leaf)
      if (s && (!best || s.gain > best.s.gain)) best = { leaf, s }
    }
    if (!best || best.s.gain <= minGain) break
    const { leaf, s } = best
    log?.(`  split ${count}: ${ctx.d.K[s.k]} > ${+s.at.toFixed(4)} (${s.lo.length} | ${s.hi.length} positions), saves ${s.gain.toFixed(2)}`)
    const lo = fitLeaf(ctx, s.lo, leaf.u, lambda)
    const hi = fitLeaf(ctx, s.hi, leaf.u, lambda)
    pending.delete(leaf)
    leaf.split = { k: s.k, at: s.at }
    leaf.lo = { u: lo.u, list: s.lo, depth: leaf.depth + 1, prior: leaf.u }
    leaf.hi = { u: hi.u, list: s.hi, depth: leaf.depth + 1, prior: leaf.u }
    delete leaf.u
    delete leaf.list
    out.push({ tree: snap(root), leaves: count + 1 })
  }
  return out
}

// ── the rules ────────────────────────────────────────────────────────────────────────────────────

// The fields each rule's condition may read (besides always), today's first; and the strengths it may take, in the
// temperature's units (× T: 1 shifts the odds of an option e-fold; the largest is hard in effect).
const RULE_FIELDS = {
  'no-waste': [],
  'monarch-lethal': ['monarch.lethal', 'monarch.peril'],
  'kill-first': ['monarch.threats', 'monarch.danger', 'monarch.peril'],
  'shooters-first': ['plan.shooter', 'plan.shooters', 'monarch.danger', 'monarch.peril'],
  'never-die': ['monarch.peril', 'monarch.danger', 'self.share'],
  'hold-the-line': ['plan.protect', 'monarch.danger', 'monarch.peril']
}
const STRENGTHS = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000]

// Each option's raw score (no temperature) under fitting tree `tree` and the soft rules of `rules`, `skip`'s part out.
function baseScores (ctx, tree, rules, skip = null) {
  const { d, F, Z } = ctx
  const nr = d.rules.length
  const s = new Float64Array(d.m)
  for (let j = 0; j < d.n; j++) {
    const leaf = leafFor(ctx, tree, j)
    const u = leaf.u
    const on = rules.filter((r) => r !== skip && r.on && !r.hard && r.strength && holds(r.when, d.c[j])).map((r) => [d.rules.indexOf(r.id), r.strength])
    for (let i = d.start[j]; i < d.start[j + 1]; i++) {
      let x = (ctx.mask && !ctx.mask[i] ? BARRED : 0) + (leaf.by ? byOf(ctx, leaf.by, j, i) : 0)
      for (let f = 0; f < F; f++) x += u[f] * Z[i * F + f]
      for (const [k, st] of on) x += st * d.R[i * nr + k]
      s[i] = x
    }
  }
  return s
}

// What a leaf's `by` (expert.js: weights added × a condition's value) adds to option i of position j's score, raw.
function byOf (ctx, by, j, i) {
  const { d } = ctx
  const F = d.F.length
  let n = 0
  for (const [field, add] of Object.entries(by)) {
    const k = d.c[j][field] ?? 0
    if (!k) continue
    for (const key in add) {
      const f = d.F.indexOf(key)
      if (f >= 0) n += k * add[key] * d.X[i * F + f]
    }
  }
  return n
}

// The loss of position j with raw scores s (+ `add` × the standing of rule k, where `add` is not 0).
function rawLoss (ctx, j, s, k = -1, add = 0) {
  const { d, q, T } = ctx
  const nr = d.rules.length
  const a = d.start[j]
  const b = d.start[j + 1]
  let top = -Infinity
  for (let i = a; i < b; i++) top = Math.max(top, (s[i] + (add ? add * d.R[i * nr + k] : 0)) / T)
  let z = 0
  for (let i = a; i < b; i++) z += Math.exp((s[i] + (add ? add * d.R[i * nr + k] : 0)) / T - top)
  const lz = top + Math.log(z)
  let loss = 0
  for (let i = a; i < b; i++) if (q[i] > 0) loss -= q[i] * ((s[i] + (add ? add * d.R[i * nr + k] : 0)) / T - lz)
  return loss * ctx.pw[j]
}

// Each rule in turn, the others held: off, or on with its best condition (always, or a field of its own, `gt` or `le`
// a threshold at its quantiles) and strength, by the training loss. `rules` changed in place. → the loss.
function fitRules (ctx, tree, rules, train, { log } = {}) {
  const { d } = ctx
  const K = d.K.length
  let total = 0
  for (const rule of rules) {
    // A hard rule filters, as in play: no candidate.
    if (rule.hard) continue
    const k = d.rules.indexOf(rule.id)
    const s = baseScores(ctx, tree, rules, rule)
    const off = train.map((j) => rawLoss(ctx, j, s))
    const offSum = off.reduce((a, b) => a + b, 0)
    const grid = STRENGTHS.map((x) => +(x * ctx.T).toPrecision(3))
    const at = grid.map((st) => train.map((j) => rawLoss(ctx, j, s, k, st)))
    const whens = [null]
    for (const field of RULE_FIELDS[rule.id]) {
      const a = d.K.indexOf(field)
      if (a < 0) continue
      const vals = [...new Set(train.map((j) => d.C[j * K + a]))].sort((x, y) => x - y)
      const cuts = vals.length <= 12 ? vals.slice(1).map((v, i) => (v + vals[i]) / 2) : Array.from({ length: 11 }, (_, i) => vals[Math.floor((i + 1) * vals.length / 12)])
      for (const cut of new Set(cuts)) for (const op of ['gt', 'le']) whens.push({ field, op, at: +cut.toFixed(6) })
    }
    let best = { loss: offSum, on: false, when: rule.when, strength: 0 }
    for (const when of whens) {
      const act = train.map((j) => holds(when, d.c[j]))
      if (!act.some(Boolean)) continue
      grid.forEach((st, a) => {
        let n = 0
        for (let i = 0; i < train.length; i++) n += act[i] ? at[a][i] : off[i]
        if (n < best.loss - 1e-9) best = { loss: n, on: true, when, strength: st }
      })
    }
    Object.assign(rule, { on: best.on, hard: false, when: best.when, strength: best.on ? best.strength : 0 })
    total = best.loss
    log?.(`  rule ${rule.id}: ${rule.on ? `on, ${rule.strength}, ${rule.when ? `${rule.when.field} ${rule.when.op} ${rule.when.at}` : 'always'}` : 'off'} (loss ${best.loss.toFixed(2)})`)
  }
  return total
}

// ── the fit ──────────────────────────────────────────────────────────────────────────────────────

// A fitting tree as an expert configuration: its splits as nodes, each leaf's weights back in HP (its scaled weights ÷
// the spreads; a feature that never varied keeps the prior's `w0`), named by its path, and the rules.
function toModel (ctx, tree, rules, w0, about) {
  const { d, sd } = ctx
  let n = 0
  const node = (t) => {
    if (t.u) {
      const w = { ...(t.w0 ?? w0) }
      d.F.forEach((f, a) => { if (sd[a]) w[f] = +(t.u[a] / sd[a]).toPrecision(6) })
      return { leaf: t.name ?? `L${++n}`, w, ...(t.by && { by: t.by }) }
    }
    return { ...(t.id && { id: t.id }), if: t.field ?? d.K[t.split.k], gt: +t.split.at.toPrecision(6), then: node(t.hi), else: node(t.lo) }
  }
  return checkModel({ name: 'learned', about, tree: node(tree), rules: rules.map((r) => ({ id: r.id, on: r.on, hard: !!r.hard, strength: r.strength, when: r.when })) })
}

// The fitting tree for an expert configuration's tree (its splits; each leaf's weights scaled), for a model read in.
function fromModel (ctx, node) {
  const { d, sd } = ctx
  if (node.leaf !== undefined) return { u: Float64Array.from(d.F, (f, a) => (node.w[f] ?? 0) * sd[a]), name: node.leaf, by: node.by, w0: node.w }
  const k = d.K.indexOf(node.if)
  // A condition the data lacks reads 0, as in play.
  return { id: node.id, field: node.if, split: { k, at: node.gt, zero: k < 0 }, lo: fromModel(ctx, node.else), hi: fromModel(ctx, node.then) }
}

// The temperature that best fits configuration-scores `s` to the targets: a golden search on its log.
function temperature (ctx, s, list) {
  const f = (lt) => {
    ctx.T = Math.exp(lt)
    let n = 0
    for (const j of list) n += rawLoss(ctx, j, s)
    return n
  }
  let a = Math.log(0.01)
  let b = Math.log(1e5)
  const r = (Math.sqrt(5) - 1) / 2
  for (let it = 0; it < 60; it++) {
    const c = b - r * (b - a)
    const e = a + r * (b - a)
    if (f(c) < f(e)) b = e
    else a = c
  }
  ctx.T = Math.exp((a + b) / 2)
  return ctx.T
}

// Fits an expert configuration to `d` (tabulate's). → { model, report, ctx, tree, rules }. Options: `tau` the targets'
//   temperature (0: a fifth of the median spread of a position's values), `lambda` the L2, `depth`, `maxLeaves`,
//   `minLeaf` (0: 2% of the training positions, at least 30), `minGain` a split's least saving, `weighted` (by `wt`),
//   `fixed` (true: the prior's rules as they are; 'hard': its hard ones kept, the rest fitted soft), `structure` ('grow',
//   or 'prior': its leaves refitted), `options` ('shortlist' or 'all': what the labels' options were, and the model's in
//   play), `prior` (expert.js defaultExpert by default), `relative` (the L2 ÷ T²), `log`.
export function fitExpert (d, { tau = 0, lambda = 3, depth = 4, maxLeaves = 12, minLeaf = 0, minGain = 0, prior = defaultExpert(), weighted = false, options = 'shortlist', fixed = false, structure = 'grow', relative = false, log = null } = {}) {
  const all = Array.from({ length: d.n }, (_, j) => j)
  const train = all.filter((j) => !d.held[j])
  const test = all.filter((j) => d.held[j])
  const val = train.filter((j) => seedNo(d.seeds[j]) % 5 === 1)
  const grown = val.length && val.length < train.length ? train.filter((j) => seedNo(d.seeds[j]) % 5 !== 1) : train
  if (!tau) {
    const spreadsY = all.map((j) => {
      let lo = Infinity
      let hi = -Infinity
      for (let i = d.start[j]; i < d.start[j + 1]; i++) { lo = Math.min(lo, d.y[i]); hi = Math.max(hi, d.y[i]) }
      return hi - lo
    }).filter((x) => x > 0).sort((a, b) => a - b)
    tau = (spreadsY[Math.floor(spreadsY.length / 2)] ?? 1) / 5 || 1
  }
  minLeaf ||= Math.max(30, Math.round(0.02 * train.length))
  const ctx = context(d, { tau, T: 1 })
  if (weighted) {
    const mean = train.reduce((n, j) => n + d.wt[j], 0) / Math.max(1, train.length)
    for (let j = 0; j < d.n; j++) ctx.pw[j] = d.wt[j] / mean
  }
  let base = prior.tree
  while (base.leaf === undefined) base = base.else
  const w0 = Object.fromEntries(d.F.map((f) => [f, base.w[f] ?? 0]))
  const u0 = Float64Array.from(d.F, (f, a) => w0[f] * ctx.sd[a])
  // The rules as `fixed` says; those fitted start soft from the prior's, a hard one at a strength hard in effect.
  const soft = (id, r) => ({ id, on: !!r?.on, hard: false, strength: r?.on ? (r.hard ? 1e4 : r.strength) : 0, when: r?.when ?? RULES[id].when })
  const rules = fixed === true ? (prior.rules ?? []).map((r) => ({ ...r }))
    : fixed === 'hard' ? [...(prior.rules ?? []).map((r) => (r.on && r.hard ? { ...r } : soft(r.id, r))), ...Object.keys(RULES).filter((id) => !(prior.rules ?? []).some((r) => r.id === id)).map((id) => soft(id, null))]
      : Object.keys(RULES).map((id) => soft(id, (prior.rules ?? []).find((x) => x.id === id)))
  if (rules.some((r) => r.on && r.hard)) {
    ctx.mask = hardMask(d, rules)
    ctx.q = targets(d, tau, ctx.mask)
  }
  // Each option's fixed part under a tree: the hard rules' bar, its leaf's `by`, the soft rules (the leaf's weights none).
  const zero = (t) => (t.u ? { u: new Float64Array(ctx.F), by: t.by } : { split: t.split, lo: zero(t.lo), hi: zero(t.hi) })
  const offsets = (tree) => { ctx.off = baseScores(ctx, zero(tree), rules) }
  const say = (s) => log?.(s)
  say(`fit: ${d.n} positions (${train.length} to fit, ${test.length} held out), ${d.m} options, ${d.F.length} features, ${d.K.length} conditions; tau ${+tau.toPrecision(3)}, lambda ${lambda}, depth ≤ ${depth}, leaves ≤ ${maxLeaves}, a leaf ≥ ${minLeaf}`)
  // The temperature, by today's root weights alone (1 where they score every option alike: a prior of none).
  const root0 = { u: u0 }
  if (u0.some((x) => x !== 0)) temperature(ctx, baseScores(ctx, root0, []), train)
  if (!(ctx.T > 0.0101 && ctx.T < 0.99e5)) ctx.T = 1
  const lambda0 = lambda
  if (relative) lambda /= ctx.T ** 2
  say(`  temperature ${+ctx.T.toPrecision(3)}${relative ? `, lambda ${lambda0} ÷ T² = ${+lambda.toPrecision(3)}` : ''}`)
  if (fixed !== true) fitRules(ctx, root0, rules, grown, { log: say })
  offsets(root0)
  const root1 = { u: fitLeaf(ctx, grown, u0, lambda).u }
  if (fixed !== true) fitRules(ctx, root1, rules, grown, { log: say })
  offsets(root0)
  let trees
  if (structure === 'prior') {
    const t = fromModel(ctx, prior.tree)
    offsets(t)
    trees = [{ tree: t, leaves: leaves(t).length }]
  } else trees = grow(ctx, grown, u0, { lambda, depth, minLeaf, maxLeaves, minGain, log: say })
  const judge = (tree, list) => {
    const m = toModel(ctx, tree, rules, w0, '')
    const ch = choices(m, d, list)
    const ag = agreement(d, list, ch.map((x) => x.pick))
    let loss = 0
    const s = baseScores(ctx, tree, rules)
    for (const j of list) loss += rawLoss(ctx, j, s)
    return { ...ag, loss: loss / Math.max(1, list.length) }
  }
  const chooseOn = grown === train ? train : val
  let pickT = trees[0]
  let pickJ = judge(trees[0].tree, chooseOn)
  for (const t of trees) {
    const j = judge(t.tree, chooseOn)
    say(`  ${t.leaves} leaves: validation top-1 ${(100 * j.top1).toFixed(1)}%, regret ${j.regret.toFixed(4)}, loss ${j.loss.toFixed(4)}`)
    if (j.regret < pickJ.regret - 1e-9 || (Math.abs(j.regret - pickJ.regret) <= 1e-9 && j.loss < pickJ.loss)) { pickT = t; pickJ = j }
  }
  const tree = pickT.tree
  if (fixed !== true) fitRules(ctx, tree, rules, train, { log: say })
  offsets(tree)
  for (const leaf of leaves(tree)) {
    const list = train.filter((j) => leafFor(ctx, tree, j) === leaf)
    if (list.length) leaf.u = fitLeaf(ctx, list, leaf.u, lambda).u
  }
  const report = { tau, T: ctx.T, lambda, depth, maxLeaves, minLeaf, positions: { train: train.length, validation: grown === train ? 0 : val.length, test: test.length }, leaves: leaves(tree).length }
  const model = toModel(ctx, tree, rules, w0, '')
  if (structure === 'prior') model.name = `${prior.name ?? 'prior'}, refitted`
  for (const [name, list] of [['train', train], ['test', test]]) {
    if (!list.length) continue
    const mine = agreement(d, list, choices(model, d, list).map((x) => x.pick))
    const today = agreement(d, list, choices(prior, d, list).map((x) => x.pick))
    const chosen = agreement(d, list, list.map((j) => d.chosen[j]))
    report[name] = { learned: mine, today, chosen }
  }
  model.about = `learned ${new Date().toISOString().slice(0, 10)} on ${d.n} positions (${train.length} fitted): held out top-1 ${pct(report.test?.learned.top1)}, regret ${num(report.test?.learned.regret)} (today's ${pct(report.test?.today.top1)}, ${num(report.test?.today.regret)}); tau ${+tau.toPrecision(3)}, T ${+ctx.T.toPrecision(3)}, lambda ${lambda}`
  model.fit = report
  // Fitted on the shortlists' options, it decides among them in play.
  if (options === 'shortlist') model.options = 'shortlist'
  return { model, report, ctx, tree, rules }
}
const pct = (x) => (x === undefined ? '-' : `${(100 * x).toFixed(1)}%`)
const num = (x) => (x === undefined ? '-' : x.toFixed(3))

// A planted problem for the fitter's own test: options whose values follow a known tree and soft rule, with noise.
export function synthetic ({ positions = 1500, options = 8, noise = 0.2, seed = 1 } = {}) {
  let s = seed >>> 0 || 1
  const rand = () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
  const F = ['damage', 'kill', 'danger', 'progress', 'waste', 'cull', 'lethal', 'fall', 'guard', 'harry', 'post']
  const w = (o) => Object.fromEntries(F.map((f) => [f, o[f] ?? 0]))
  const truth = checkModel({
    name: 'planted',
    tree: {
      if: 'monarch.danger', gt: 0.5,
      then: { if: 'patience', gt: 10, then: { leaf: 'press', w: w({ damage: 1, kill: 0.5, danger: -0.2, progress: 2 }) }, else: { leaf: 'guard', w: w({ damage: 0.3, kill: 0.2, danger: -1.5, guard: 2 }) } },
      else: { leaf: 'calm', w: w({ damage: 1, kill: 1, danger: -0.3, progress: 0.5 }) }
    },
    rules: [{ id: 'no-waste', on: true, hard: false, strength: 3, when: null }]
  })
  const rows = []
  for (let p = 0; p < positions; p++) {
    const c = { 'monarch.danger': rand(), patience: Math.floor(20 * rand()), noise1: rand(), noise2: Math.floor(5 * rand()) }
    const r = leafOf(truth, c)
    for (let k = 0; k < options; k++) {
      const v = Object.fromEntries(F.map((f) => [f, 0]))
      v.damage = 10 * rand()
      v.kill = rand() < 0.2 ? 5 * rand() : 0
      v.danger = 6 * rand()
      v.progress = Math.floor(4 * rand()) - 1
      v.guard = 3 * rand()
      v.waste = rand() < 0.15 ? 1 : 0
      let y = 0
      for (const f of F) y += r.w[f] * v[f]
      y += 3 * (v.waste ? 0 : 1) + noise * 4 * (rand() - 0.5)
      rows.push({ pos: `p${p}`, seed: `syn-${p}`, uid: 1, v, c, legal: true, chosen: k === 0, value: y })
    }
  }
  return { rows, truth, F }
}

// ── the command line ─────────────────────────────────────────────────────────────────────────────

if (isMain(import.meta.url)) {
  const out = arg('out', new URL('./expert.json', import.meta.url).pathname)
  // The shipped expert file holds the expert's other parts (bundle.js): there the tree alone is replaced.
  const writeTree = async (file, model) => {
    const { writePart, SHIPPED } = await import('./bundle.js')
    if (path.resolve(file) === SHIPPED) writePart('tree', model)
    else fs.writeFileSync(file, JSON.stringify(model, null, 1) + '\n')
  }
  if (has('default')) {
    await writeTree(out, defaultExpert())
    console.log(`today's scorer written to ${out}`)
  } else {
    const { OPTION_FEATURES } = await import('./policy.js')
    const t0 = Date.now()
    const given = arg('weights', null)
    const w = given?.split(',').map(Number)
    const weights = !given ? null : given.includes('=') ? Object.fromEntries(given.split(',').map((kv) => kv.split('=')).map(([k, x]) => [k, Number(x)]))
      : { monarch: w[0], own: w[1], foe: w[2], lost: w[3], won: w[4] }
    const rows = readRows(arg('data', null) ?? (() => { throw new Error('--data <labels> wanted') })(), { weights, unchosen: has('unchosen') })
    const d = tabulate(rows, { features: OPTION_FEATURES, decisive: has('decisive') })
    const prior = arg('prior', null) ? checkModel(JSON.parse(fs.readFileSync(arg('prior'), 'utf8'))) : defaultExpert()
    const { model, report } = fitExpert(d, {
      tau: Number(arg('tau', 0)), lambda: Number(arg('lambda', 3)), depth: Number(arg('depth', 4)), maxLeaves: Number(arg('leaves', 12)),
      minLeaf: Number(arg('min-leaf', 0)), weighted: has('weighted'),
      fixed: has('fixed') ? true : has('hard') ? 'hard' : false,
      structure: arg('structure', 'grow'), prior, relative: has('relative'), log: console.log
    })
    for (const name of ['train', 'test']) {
      const r = report[name]
      if (!r) continue
      console.log(`${name}: learned top-1 ${pct(r.learned.top1)} regret ${num(r.learned.regret)}; today's ${pct(r.today.top1)} ${num(r.today.regret)}; the data's chooser ${pct(r.chosen.top1)} ${num(r.chosen.regret)} (${r.learned.n} positions)`)
    }
    if (!has('dry')) {
      await writeTree(out, model)
      console.log(`written to ${out} (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
    }
  }
}
