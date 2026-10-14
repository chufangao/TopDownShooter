// The fitter of the learned decision tree (redesign.md §2.22, §5 Step 9; expert.js): offline, like the combo book. From
// labelled positions (src/sim/teach.js: a piece's decision on a board from a real run, each of its options played out
// through the foes' turn and a turn or two more, its playout value the higher the better), it fits an expert
// configuration (src/sim/expert.json): a model tree over the vocabulary of conditions (expert.js conditions), each leaf
// its own weights over the option features (policy.js OPTION_FEATURES), and the soft rules (expert.js RULES) with
// their conditions and strengths. Nothing here is read in play.
//   The loss: a listwise softmax over each position's legal options, the model's scores ÷ a temperature `T` against the
//   playout values' own softmax (÷ `tau`): the options ranked as their playouts rank them, the close calls weighing
//   little. Leaf weights by Newton's method on it (in each feature's within-position spread, so the steps are alike),
//   with L2 (`lambda`) toward the leaf's prior (its parent's weights; the root's, today's). Splits grown best first from
//   the vocabulary: every condition and a grid of its thresholds scored by a second-order estimate of the loss they
//   would save, the best few fitted to measure it, the best taken; depth ≤ `depth`, a leaf no smaller than `minLeaf`
//   positions, grown on the training positions but those of seeds ≡ 1 mod 5, and kept at the size that does best on
//   those (the validation set; the held-out positions, seeds ≡ 0 mod 5, are only measured). The rules by
//   coordinate search, each over off, its condition (a field of its own few, a comparison and a threshold, or always)
//   and a strength. Validated on the held-out positions: top-1 agreement with the playout-best and mean regret (the
//   best playout's value less the chosen option's), beside today's expert's and the expert that chose in the data.
// Round 1 (2026-10-11; teach.js's labels of today's fast expert, 245 runs, 20,310 positions, 2 rounds): held out, the
// grown tree agreed with the playout-best 53.9% of the time against today's 50.1%, regret 0.077 against 0.108, yet it
// played far worse (256 seeds `sim`: 2.3% clears against 31.6%, −51 ± 2 progress); with today's rules kept hard, 4.3%;
// today's tree refitted gently (lambda 1, parts re-weighed 3,1,3,10,1), −3.8 ± 2.3; the soft rules alone, on today's
// weights, level (+0.7 ± 1.1). A two-round playout by today's expert is too short a label for the weights (it prices
// neither a soul's fall for the run nor a slow battle, and the learned weights lean on today's expert to finish what
// they start), so expert.json stays today's scorer. Puzzles: the grown trees fail "never into the danger map".
// Round 2 (2026-10-11; labels to the battle's end, teach.js `rounds` 0: 250 runs, 20,954 positions; redesign.md §6):
// with λ as it was, today's temperature (T ~2,000: its scores run to the hundreds) held every leaf at its prior; with λ
// ÷ T² (`relative`) the leaves moved far, and played far worse however the data was taken (`decisive`, `unchosen`,
// `weighted`): 256 seeds `sim`, the rules learned and the leaves free −28.3 ± 2.7 progress (13.7% clears against
// 31.6%); 64 seeds, today's rules hard and today's tree refitted −35 ± 5, at λ 10⁴ still −31, at 10⁵ level (256: −2.1 ±
// 2.3); the soft rules alone (λ as it was), level (−0.3 ± 1.1 with today's rules hard and shooters-first soft; −1.4 ±
// 2.2 with all learned). The leaves learn what today's expert does after them for free: walking to its post
// (`progress` 1 → −54), so a tree that never walks there. expert.json stays today's scorer.
// Run:  npm run fit -- --data <dir of labels> [--out src/sim/expert.json] [--tau 0] [--depth 4] [--min-leaf 0]
//       [--lambda 3] [--leaves 12] [--weighted] [--weights monarch=3,own=1,…] [--fixed | --hard] [--structure prior]
//       [--prior file.json] [--unchosen] [--relative] [--decisive] [--dry]   (0: chosen from the data; --weighted: each position by its draw's weight;
//       --weights: the values read again from their parts, named, or monarch,own,foe,lost,won in order; --fixed:
//       today's rules kept as they are; --hard: today's hard rules kept hard, the rest fitted soft; --structure prior:
//       the prior's tree, its leaves refitted; --prior: the configuration to start from, today's by default;
//       --unchosen: the expert's own option left out of each position, readRows; --relative: lambda ÷ T², fitExpert;
//       --decisive: positions whose options all score alike left out, tabulate; --dry: nothing written)
//       npm run fit -- --default [--out src/sim/expert.json]   today's scorer (expert.js defaultExpert) as the file
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { RULES, defaultExpert, checkModel, leafOf, holds, pathName } from './expert.js'

// ── the data ─────────────────────────────────────────────────────────────────────────────────────

// Labelled rows (one an option), from a file or a directory: teach.js's labels.jsonl there (a line a position, its
// options within: expanded), else every .jsonl or .json (an array, or { rows }) in it, either gzipped (.gz). `weights`:
// each option's value read again from its parts by them (a label to the battle's end, its parts' `turns` there, by
// teach.js END_WEIGHTS' { lost, monarch, own, turn }, a missing one END_WEIGHTS'; else by WEIGHTS' { monarch, own, foe,
// lost, won }). `unchosen`: the option the expert took left out of each position (a label to the battle's end is the
// battle the expert played, and the positions are drawn by how it ended: in a lost battle its choice loses by
// construction (99.8% of them in round 2's data, the others 88.8%), in a won one it wins; the options it did not take
// are labelled free of that draw). → the rows.
const END = { lost: 10, monarch: 3, own: 1, turn: 0.02 }
export function relabel (parts, weights) {
  if (parts.turns !== undefined) {
    const w = { ...END, ...weights }
    return parts.lost ? -w.lost : -w.monarch * parts.monarch - w.own * parts.own - w.turn * parts.turns
  }
  return -weights.monarch * parts.monarch - weights.own * parts.own + weights.foe * parts.foe - weights.lost * parts.lost + weights.won * parts.won
}
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

// A row read in its parts, whatever its fields are called: { pos (the position's id), seed, uid, v (option features
// by name), c (conditions by name), legal, chosen, value }.
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
// Whether a seed is held out: its number ≡ 0 mod 5.
export const heldOut = (seed) => seedNo(seed) % 5 === 0

// The rows as arrays, positions in order of first appearance, each position's legal options together: { F (feature
// names), K (condition names), n, m, X (m × F), y, start (n + 1), C (n × K), held, wt (each position's weight: teach.js
// draws its positions by danger, 1 / the chance), chosen (index within its position,
// −1 for none), R (m × the rules: each option's standing under each, RULES' order), c (each position's conditions by
// name), seeds }. Options with no finite value or features, and positions with fewer than two such, are dropped; with
// `decisive`, so are those whose options' values are all alike (a battle every option wins alike, or loses: nothing to
// rank, and a uniform target that only pulls the scores flat).
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

// Each position's option chosen by configuration `model` (expert.js semantics: hard rules filter, the leaf's weights
// and the soft rules score, the first best taken), and its leaf's name. → { pick (index within the position), leaf }
// per position of `list`.
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

// How well picks agree with the playouts over positions `list`: `top1` the share whose pick is a playout-best option
// (within `tol` of the best value), `regret` the mean of the best value less the pick's. `picks`: index within each
// position (−1: none, skipped).
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

// The playouts' own distribution over each position's options: softmax(value ÷ tau), over those `mask` leaves (the
// hard rules': the rest none).
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

// A fitting context: the data scaled (Z: each feature ÷ its spread), the targets, the temperature, the rules' and the
// leaves' fixed parts (`off`, per option: the soft rules and a leaf's `by`).
function context (d, { tau, T }) {
  const sd = spreads(d)
  const F = d.F.length
  const Z = new Float64Array(d.m * F)
  for (let i = 0; i < d.m; i++) for (let f = 0; f < F; f++) Z[i * F + f] = sd[f] ? d.X[i * F + f] / sd[f] : 0
  return { d, F, sd, Z, q: targets(d, tau), T, off: new Float64Array(d.m), tau, pw: new Float64Array(d.n).fill(1) }
}

// The loss of position j under scaled weights u (its softmax ÷ T against the targets), and with `g`/`H` (F, F × F)
// given, its gradient and Hessian in u added to them.
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

// A leaf's scaled weights fitted to positions `list` by Newton's method from `u0` (its prior, the L2's centre too). →
// { u, loss, g (the per-position gradients at u, list's order, for the splits) }
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

// Candidate cuts of condition k over positions `list`: `order` the positions sorted by it, each cut the count on its low
// side, between two distinct values (every such where it has no more than 2 × `most` values, else `most` at its
// quantiles), each leaving at least `min` positions on
// either side. → { order (indices into list), vals (list's values), cuts: [{ i, at }] }
function thresholds (ctx, list, k, min, most = 16) {
  const { d } = ctx
  const K = d.K.length
  const vals = list.map((j) => d.C[j * K + k])
  const order = list.map((_, i) => i).sort((a, b) => vals[a] - vals[b])
  const n = order.length
  const ok = (i) => i >= min && n - i >= min && vals[order[i]] !== vals[order[i - 1]]
  const cuts = new Map()
  // Few values: a cut between every two.
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

// The best split of a leaf (positions `list`, scaled weights `u`): every condition × its cuts scored by the second-order
// estimate of the loss its two children would save (each child's gradient at u, summed along the condition's order; its
// Hessian the leaf's × its share), the best `exact` of them fitted (a few Newton steps from u, u their prior) and
// measured. → { k, at, lo, hi, gain } or null.
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

// The positions each leaf of a fitting tree holds (its nodes { split: { k, at }, lo, hi } or { u, list }).
function leaves (node, out = []) {
  if (node.u) out.push(node)
  else {
    leaves(node.lo, out)
    leaves(node.hi, out)
  }
  return out
}

// The fitting tree's leaf for position j's conditions.
function leafFor (ctx, node, j) {
  const K = ctx.d.K.length
  while (!node.u) node = (node.split.k < 0 ? 0 : ctx.d.C[j * K + node.split.k]) > node.split.at ? node.hi : node.lo
  return node
}

// Grows a tree best first from a root leaf of prior u0, on the training positions: each step the leaf whose best split
// saves the most, while it saves more than `minGain` and the tree is under `maxLeaves` leaves and `depth` deep. Every
// tree on the way is kept (a copy of its leaves' weights), for the held-out choice. → [{ tree, leaves (count) }]
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

// Each option's score but for rule `skip`'s part (its leaf's weights over its features, a leaf's `by`, the other soft
// rules of `rules`), raw (the temperature not applied), for the fitting tree `tree` (scaled weights).
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
    // (a rule kept hard is no candidate: it filters, as in play)
    if (rule.hard) continue
    const k = d.rules.indexOf(rule.id)
    const s = baseScores(ctx, tree, rules, rule)
    const off = train.map((j) => rawLoss(ctx, j, s))
    const offSum = off.reduce((a, b) => a + b, 0)
    // The loss of each training position at each strength.
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
  // (A condition the data lacks reads 0 there, as in play: 0 > its threshold or not.)
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

// Fits an expert configuration to labelled data `d` (tabulate's). Options: `tau` the targets' temperature (0: a fifth of
// the median spread of the playout values within a position), `lambda` the L2, `depth` and `maxLeaves` the tree's
// bounds, `minLeaf` the smallest leaf (0: 2% of the training positions, at least 30), `minGain` the least a split must
// save, `weighted` each position by its weight (teach.js's `wt`), `fixed` true: the prior's rules kept as they are (none
// fitted; its hard ones filter), 'hard': its hard rules kept so and the rest fitted soft, `structure` 'grow' or 'prior' (the prior's tree, its leaves refitted), `options`
// 'shortlist' (the labels' options were
// today's shortlist: so are the model's in play) or 'all', `prior` the configuration to start from (today's: expert.js defaultExpert; its root's weights the root's
// prior, its rules where the search starts), `relative` the L2 in the temperature's units (λ ÷ T²: with today's
// scores in the hundreds, T is in the thousands, and λ alone holds every leaf at its prior), `log`. → { model, report }
export function fitExpert (d, { tau = 0, lambda = 3, depth = 4, maxLeaves = 12, minLeaf = 0, minGain = 0, prior = defaultExpert(), weighted = false, options = 'shortlist', fixed = false, structure = 'grow', relative = false, log = null } = {}) {
  const all = Array.from({ length: d.n }, (_, j) => j)
  const train = all.filter((j) => !d.held[j])
  const test = all.filter((j) => d.held[j])
  // The tree's size chosen on a validation set of the training positions (seeds ≡ 1 mod 5), grown on the rest; the
  // held-out ones only measured.
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
  // Each position weighed by its `wt` (teach.js: 1 / the chance it was drawn), as a share of the mean, or all alike.
  if (weighted) {
    const mean = train.reduce((n, j) => n + d.wt[j], 0) / Math.max(1, train.length)
    for (let j = 0; j < d.n; j++) ctx.pw[j] = d.wt[j] / mean
  }
  // The prior: the root of today's tree (its base leaf, where it has one), its weights scaled.
  let base = prior.tree
  while (base.leaf === undefined) base = base.else
  const w0 = Object.fromEntries(d.F.map((f) => [f, base.w[f] ?? 0]))
  const u0 = Float64Array.from(d.F, (f, a) => w0[f] * ctx.sd[a])
  // The rules: the prior's as they are (`fixed`: its hard ones filter the options out of every softmax, as in play), or
  // each soft, fitted from the prior's (a hard one from a strength hard in effect).
  // (`fixed` 'hard': the prior's hard rules kept, in its order, and the rest each fitted soft from where they stand.)
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
  // (`relative`: the L2 in the softmax's own units, scores ÷ T, so a prior of large scores, today's, is not held in place
  // by it: λ ÷ T².)
  const lambda0 = lambda
  if (relative) lambda /= ctx.T ** 2
  say(`  temperature ${+ctx.T.toPrecision(3)}${relative ? `, lambda ${lambda0} ÷ T² = ${+lambda.toPrecision(3)}` : ''}`)
  // The rules on today's root, then the root, then the rules again (unless fixed).
  if (fixed !== true) fitRules(ctx, root0, rules, grown, { log: say })
  offsets(root0)
  const root1 = { u: fitLeaf(ctx, grown, u0, lambda).u }
  if (fixed !== true) fitRules(ctx, root1, rules, grown, { log: say })
  offsets(root0)
  // The tree: the prior's own (`structure` 'prior': each leaf refitted toward its own weights), or grown best first and
  // kept at the size that does best on the validation set (mean regret, then the loss).
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
  // The rules once more on the tree kept, and its leaves again under them, on every training position.
  const tree = pickT.tree
  if (fixed !== true) fitRules(ctx, tree, rules, train, { log: say })
  offsets(tree)
  // (each leaf from its own weights, toward them: a polish under the rules found)
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
  // Fitted on today's shortlists (teach.js), it decides among them in play (policy.js shortlisted).
  if (options === 'shortlist') model.options = 'shortlist'
  return { model, report, ctx, tree, rules }
}
const pct = (x) => (x === undefined ? '-' : `${(100 * x).toFixed(1)}%`)
const num = (x) => (x === undefined ? '-' : x.toFixed(3))

// A planted problem, for the fitter's own test: positions whose options' values follow a known tree over two of a
// handful of conditions (`truth`: { tree, rules }, an expert configuration over features `F`), with noise `noise` and a
// soft rule's bonus planted. → { rows, truth }
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

if (typeof process !== 'undefined' && process.argv[1] === decodeURIComponent(new URL(import.meta.url).pathname)) {
  const arg = (name, def) => {
    const i = process.argv.indexOf('--' + name)
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
  }
  const out = arg('out', new URL('./expert.json', import.meta.url).pathname)
  // The shipped expert file holds the expert's other parts beside its model tree (bundle.js): written there, the tree
  // replaces only the tree; any other file is the tree alone.
  const writeTree = async (file, model) => {
    const { writePart, SHIPPED } = await import('./bundle.js')
    if (path.resolve(file) === SHIPPED) writePart('tree', model)
    else fs.writeFileSync(file, JSON.stringify(model, null, 1) + '\n')
  }
  if (process.argv.includes('--default')) {
    await writeTree(out, defaultExpert())
    console.log(`today's scorer written to ${out}`)
  } else {
    const { OPTION_FEATURES } = await import('./policy.js')
    const t0 = Date.now()
    const given = arg('weights', null)
    const w = given?.split(',').map(Number)
    const weights = !given ? null : given.includes('=') ? Object.fromEntries(given.split(',').map((kv) => kv.split('=')).map(([k, x]) => [k, Number(x)]))
      : { monarch: w[0], own: w[1], foe: w[2], lost: w[3], won: w[4] }
    const rows = readRows(arg('data', null) ?? (() => { throw new Error('--data <labels> wanted') })(), { weights, unchosen: process.argv.includes('--unchosen') })
    const d = tabulate(rows, { features: OPTION_FEATURES, decisive: process.argv.includes('--decisive') })
    const prior = arg('prior', null) ? checkModel(JSON.parse(fs.readFileSync(arg('prior'), 'utf8'))) : defaultExpert()
    const { model, report } = fitExpert(d, {
      tau: Number(arg('tau', 0)), lambda: Number(arg('lambda', 3)), depth: Number(arg('depth', 4)), maxLeaves: Number(arg('leaves', 12)),
      minLeaf: Number(arg('min-leaf', 0)), weighted: process.argv.includes('--weighted'),
      fixed: process.argv.includes('--fixed') ? true : process.argv.includes('--hard') ? 'hard' : false,
      structure: arg('structure', 'grow'), prior, relative: process.argv.includes('--relative'), log: console.log
    })
    for (const name of ['train', 'test']) {
      const r = report[name]
      if (!r) continue
      console.log(`${name}: learned top-1 ${pct(r.learned.top1)} regret ${num(r.learned.regret)}; today's ${pct(r.today.top1)} ${num(r.today.regret)}; the data's chooser ${pct(r.chosen.top1)} ${num(r.chosen.regret)} (${r.learned.n} positions)`)
    }
    if (!process.argv.includes('--dry')) {
      await writeTree(out, model)
      console.log(`written to ${out} (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
    }
  }
}
