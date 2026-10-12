// The ranker (redesign.md §2.23): a learned correction to today's score of each option of a piece's decision, a small
// network over the situation, the option and the piece, trained offline to copy the teacher (teach.js's playouts) and
// shipped as weights in ranker.json. This file is the contract between the teacher (teach.js, which plays out under the
// ranker in use) and the player (policy.js choice, which adds the correction where a ranker is in use):
//
//   useRanker(config)   installs a ranker configuration (ranker.json's contents); null: none, today's expert;
//                       undefined: back to ranker.json beside this file, where there is one. → the one in use, or null
//   rankerModel()       → the ranker in use, or null for none
//
// With none in use (no ranker.json, or useRanker(null)), the expert is today's, move for move.
//
// In play (policy.js choice, rankerView): a piece's options are today's shortlist (policy.js shortlist: at most 16, the
// labels' own, teach.js optionsAt) and today's own choice; today's hard rules (expert.json's, over all its options, as
// expert.js decideTree) leave some; each of those is scored total = today's score + scale·net(x), the best taken (ties
// as policy.js `better`: the fewer steps, the lower lane, the lower target uid), today's choice where nothing beats it.
// The net's last layer starts at zero, so an untrained ranker plays today's expert move for move, and L2 toward zero
// keeps it there wherever the data is thin. The audit's `by`: the hard rule that filtered first, else 'net' (and its
// `margin`, the total the net's choice beats today's by) where the net changed the choice, else today's.
//
// The inputs, x (inputNames: 149 numbers), read alike from a label row and from the board in play (encode; a test holds
// the two equal), every number rounded to 6 decimals as the rows are written:
//   sit.*   the 68 conditions (expert.js conditions: the situation and the piece's own `self.*`)
//   role.*  the piece's kind's role (content.js ROLES, one of six), and `size` its kind's (a Colossus track's 2×2 is not
//           in the rows: the kind's own size)
//   opt.*   the option's 34 features (policy.js OPTION_FEATURES)
//   rel.*   each feature less its mean over the position's options that today's hard rules keep (the options the
//           labels hold for that decision, each set of orders once: teach.js's rows), so "the least endangered of my
//           options" is read whatever the board's level
//   kind.*  stay, move (and no act), act (from where it stands), moveAct, fusion; and `steps`, the tiles it walks
//   aft.*   "after the move" (2026-10-12, round 2): the conditions of the board the option leaves (policy.js afterOf: the
//           option given on a copy as teach.js's playouts give it, read as the decision is) less the decision's own,
//           68 more; read only by a configuration whose inputs name them (round 1's do not), written beside a label set
//           by `npm run teach -- --augment <dir>` (after.jsonl: the run replayed to each decision; teach.js augment)
// each standardised by the training options' mean and sd and clipped to ±`clip` sd. A configuration names the inputs it
// reads (`inputs`), any of these: a condition added later is read by none until a ranker is fitted with it.
//
// The net: hidden 64 then 32, ReLU, one output (value.js's forward pass and Adam; its own backward pass and loss here).
// Trained (fitRanker; `npm run rank`) on teach.js's labels to the battle's end: for each position, its options that are
// legal and that today's hard rules keep, a listwise softmax cross-entropy:
//   model logits  s_i = (prior_i + scale·net_i) / T     (prior: today's score, the row's)
//   target        q_i ∝ exp(value_i / τ + prior_i / T)   (the teacher: the best playout taken, ties by today's score)
// so where the playouts tie, the target is today's own preference and nothing pulls the net (an untrained ranker is
// right there), and where they differ the net learns value/τ, in the softmax's units. T is the median spread of today's
// score (its max less its min) over the options of a training position, and scale = T: a net of ±1 moves an option by
// one median spread (2026-10-12, labels L2: T ≈ 59, today's top two a median 1.7 apart, the best playout's option a
// median 15 below today's choice where it is not it). τ 0.5: a soul's share of 0.1 or a Monarch's of 0.03 lost is a
// tilt of e^0.2; a battle lost against won, e^19. Positions whose options' values all tie are left out (they carry
// nothing). Each position weighs alike (variant `plain`), by its draw's weight clipped (`weighted`: teach.js `wt`, 1 /
// its chance, at most `wclip`), or with the option the expert took left out of the lost and near-lost battles
// (`unchosen`: there it loses, or wins, by how the position was drawn). L2 on the weights toward zero (1e-3: of 1e-4,
// 1e-3 and 1e-2 on labels L2 and L3 the best validation loss, the three within 0.1%), Adam, minibatches of positions,
// early stopping on the validation positions' loss (seeds ≡ 1 mod 5); seeds ≡ 0 mod 5 held out (teach.js split), only
// measured.
// Round 1 (2026-10-12; labels of today's expert to the battle's end, L2 and L3: 500 runs, 41,424 positions, 14,632 of
// them training and decisive): held out, every variant read the playouts better than today's score (decisive positions'
// regret 0.89 → 0.79–0.82, the lost battles' agreement 0.2% → 10–14%), yet in won and near-lost battles, where the
// option the expert took wins by how the positions were drawn, each read them worse (near-lost regret 0.41 → 0.56–0.63),
// and they played as that bias says: paired against today's expert on 256 seeds `sel`, plain −6.3 ± 2.4 progress
// (changing 34% of decisions), unchosen −4.3 ± 2.2 (29%), weighted −0.9 ± 2.2 (21%; clears +33 −29). Weighted,
// confirmed on 768 fresh seeds `chk`: clears 34.1% against 29.7% (+133 −99), progress +2.3 ± 1.4, at 2.6 s a run
// against 2.0; kept as ranker.json.
import { conditions } from './expert.js'
import { OPTION_FEATURES } from './policy.js'
import { forwardAll, gradsFor, adam, mulberry } from './value.js'
import { ROLES, unitDef } from '../content.js'
import { LANE } from './field.js'
import { tileX } from './unit.js'

// ── the ranker in use ────────────────────────────────────────────────────────────────────────────

// ranker.json beside this file, read once (Node only: in a browser there is none, and the expert is today's).
function readJSON () {
  try {
    const fs = globalThis.process?.getBuiltinModule?.('node:fs')
    const url = new URL('./ranker.json', import.meta.url)
    return fs && fs.existsSync(url) ? JSON.parse(fs.readFileSync(url, 'utf8')) : null
  } catch {
    return null
  }
}
let SHIPPED
let INSTALLED = false
let MODEL = null

export function rankerModel () {
  if (INSTALLED) return MODEL
  if (SHIPPED === undefined) {
    const json = readJSON()
    SHIPPED = json ? checkRanker(json) : null
  }
  return SHIPPED
}

export function useRanker (config) {
  INSTALLED = config !== undefined
  MODEL = config ? checkRanker(config) : null
  return rankerModel()
}

// A configuration checked: every input one the code reads, the net's sizes its inputs', the standardisation and the
// scale finite. → the configuration.
export function checkRanker (config) {
  const known = new Set(inputNames())
  const { inputs, net } = config ?? {}
  if (!Array.isArray(inputs) || !net?.sizes) throw new Error('ranker: no inputs or no net')
  for (const n of inputs) if (!known.has(n)) throw new Error(`ranker: unknown input "${n}"`)
  if (net.sizes[0] !== inputs.length || net.sizes.at(-1) !== 1 || net.W.length !== net.sizes.length - 1) throw new Error('ranker: the net\'s sizes are not its inputs\'')
  if (!Number.isFinite(config.scale) || config.mean?.length !== inputs.length || config.sd?.length !== inputs.length) throw new Error('ranker: no scale or standardisation')
  return config
}

// ── the inputs ───────────────────────────────────────────────────────────────────────────────────

// The option's kinds, in order (encode's kind.*).
export const KINDS = Object.freeze(['stay', 'move', 'act', 'moveAct', 'fusion'])
const r6 = (x) => Math.round(x * 1e6) / 1e6
// A number as the rows write it: rounded to 6 decimals, a flag 0 or 1, anything else 0.
const num = (x) => (typeof x === 'number' ? (Number.isFinite(x) ? r6(x) : 0) : typeof x === 'boolean' ? +x : 0)

// The inputs' layout in code (made at first use: policy.js and this file import each other): the conditions (C), the
// roles (R), the option features (F), and every input's name in order; the first `shared` are the decision's, alike for
// all its options.
let LAYOUT = null
function layout () {
  if (LAYOUT) return LAYOUT
  const C = Object.keys(conditions({}, { uid: -1, hp: 1, maxHp: 1 }))
  const R = Object.keys(ROLES).filter((r) => r !== 'monarch')
  const F = [...OPTION_FEATURES]
  const base = [...C.map((k) => `sit.${k}`), ...R.map((r) => `role.${r}`), 'size', ...F.map((k) => `opt.${k}`), ...F.map((k) => `rel.${k}`), ...KINDS.map((k) => `kind.${k}`), 'steps']
  const names = [...base, ...C.map((k) => `aft.${k}`)]
  LAYOUT = { C, R, F, base, names, D: names.length, shared: C.length + R.length + 1 }
  return LAYOUT
}
// The inputs by name, in the order encode writes them; and the sets a ranker is fitted on (INPUT_SETS): round 1's, and
// those with the afterstate's.
export const inputNames = () => layout().names
export const INPUT_SETS = Object.freeze({ base: () => layout().base, aft: () => layout().names })
// The conditions an afterstate is read as (aft.*'s, in order).
export const afterNames = () => layout().C

// An option as the ranker reads it ({ f: its features by name, steps, act, fusion, after: the conditions of the board
// it leaves, null where unread }): from the play (an option of policy.js expertOptions, its features read: `v`; its
// afterstate `after`, policy.js afterOf, where the ranker reads it) and from a label row's option (teach.js: `f` with
// its zeros left out; `after`, rowAfter's).
export const playView = (o) => ({ f: o.v, steps: o.path.length, act: !!o.ability, fusion: !!o.fusion, after: o.after ?? null })
export const rowView = (o, after = null) => ({ f: o.f, steps: o.steps, act: o.ability != null, fusion: o.fusion != null, after })

// An afterstate's conditions (policy.js afterOf's) against a row's own (`sit`, its zeros left out), as after.jsonl
// writes them: [k, v, …], each condition (afterNames' index k) whose value v, rounded as the rows are, differs. → the
// list
export function afterDiff (after, sit) {
  const C = layout().C
  const out = []
  for (let k = 0; k < C.length; k++) {
    const v = num(after[C[k]])
    if (v !== num(sit[C[k]])) out.push(k, v)
  }
  return out
}
// The afterstate's conditions of a row's option back from after.jsonl's list (`diff`, against `names`: after.json's
// conditions, the writer's afterNames; null where it was not read): the row's own with those it changes. → by name, or
// null
export function rowAfter (sit, diff, names = afterNames()) {
  if (!diff) return null
  const a = { ...sit }
  for (let j = 0; j < diff.length; j += 2) a[names[diff[j]]] = diff[j + 1]
  return a
}

// The reference of a position: each feature's mean over its options (views) that today's hard rules keep.
export function meanOf (views) {
  const { F } = layout()
  const m = new Float64Array(F.length)
  if (!views.length) return m
  for (const w of views) for (let k = 0; k < F.length; k++) m[k] += num(w.f[F[k]])
  for (let k = 0; k < F.length; k++) m[k] /= views.length
  return m
}

// The raw inputs (see the head of this file) of an option `view` of a decision: its conditions `c` (by name), the
// deciding piece's kind `unit` (a unit id), and `mean` (meanOf: its position's reference). Written into `out` (in code's
// layout: inputNames). → out
export function encode (c, unit, view, mean, out = new Float64Array(layout().D)) {
  encodeDecision(c, unit, out)
  encodeOption(view, mean, out, c)
  return out
}
function encodeDecision (c, unit, out) {
  const { C, R } = layout()
  for (let i = 0; i < C.length; i++) out[i] = num(c[C[i]])
  const def = unitDef(unit)
  for (let j = 0; j < R.length; j++) out[C.length + j] = def.role === R[j] ? 1 : 0
  out[C.length + R.length] = def.size ?? 1
}
function encodeOption (view, mean, out, c) {
  const { C, F, shared } = layout()
  const n = F.length
  for (let k = 0; k < n; k++) {
    const x = num(view.f[F[k]])
    out[shared + k] = x
    out[shared + n + k] = x - mean[k]
  }
  const kind = view.fusion ? 4 : view.act ? (view.steps > 0 ? 3 : 2) : view.steps > 0 ? 1 : 0
  for (let j = 0; j < KINDS.length; j++) out[shared + 2 * n + j] = j === kind ? 1 : 0
  out[shared + 2 * n + KINDS.length] = num(view.steps)
  // The afterstate less the decision: 0 throughout where it was not read.
  const at = shared + 2 * n + KINDS.length + 1
  const a = view.after
  for (let k = 0; k < C.length; k++) out[at + k] = a ? num(a[C[k]]) - num(c[C[k]]) : 0
}

// ── the net in play ──────────────────────────────────────────────────────────────────────────────

// A configuration made ready for play, once: its inputs mapped to code's layout and split into the decision's and the
// option's (the decision's part of the first layer summed once a decision), its weights transposed (output-major: row
// j the weights into unit j). Buffers kept here: one decision scored at a time.
const RUNTIMES = new WeakMap()
function runtimeOf (model) {
  let rt = RUNTIMES.get(model)
  if (rt) return rt
  const L = layout()
  const at = model.inputs.map((n) => L.names.indexOf(n))
  const { sizes, W, b } = model.net
  const WT = W.map((w, l) => {
    const I = sizes[l]
    const J = sizes[l + 1]
    const t = new Float64Array(I * J)
    for (let i = 0; i < I; i++) for (let j = 0; j < J; j++) t[j * I + i] = w[i * J + j]
    return t
  })
  const idx = (pred) => Int32Array.from(model.inputs.map((_, j) => j).filter((j) => pred(at[j])))
  rt = {
    sizes, WT, b: b.map((v) => Float64Array.from(v)), at: Int32Array.from(at),
    mean: Float64Array.from(model.mean), sd: Float64Array.from(model.sd, (s) => (s > 1e-9 ? s : 1)), clip: model.clip ?? 10,
    shared: idx((i) => i < L.shared), own: idx((i) => i >= L.shared),
    raw: new Float64Array(L.D), x: new Float64Array(sizes[0]), h0: new Float64Array(sizes[1]), acts: sizes.map((n) => new Float64Array(n)),
    after: model.inputs.some((n) => n.startsWith('aft.'))
  }
  RUNTIMES.set(model, rt)
  return rt
}
// Whether ranker `model` reads the board an option leaves (aft.*): only then does play read it (policy.js afterOf).
export const readsAfter = (model) => runtimeOf(model).after
const standard = (rt, j) => {
  const z = (rt.raw[rt.at[j]] - rt.mean[j]) / rt.sd[j]
  return z > rt.clip ? rt.clip : z < -rt.clip ? -rt.clip : z
}

// The net of ranker `model` for one decision (conditions `c`, the piece's kind `unit`): → a function of an option's
// view (its afterstate in it where the ranker reads one) and its position's reference (meanOf) → the net's output for
// it. The decision's inputs read once.
export function scorer (model, c, unit) {
  const rt = runtimeOf(model)
  const { sizes, WT, b, x, h0, acts, shared, own } = rt
  encodeDecision(c, unit, rt.raw)
  const I = sizes[0]
  const J = sizes[1]
  for (const j of shared) x[j] = standard(rt, j)
  for (let k = 0; k < J; k++) {
    let s = b[0][k]
    const off = k * I
    for (const j of shared) s += WT[0][off + j] * x[j]
    h0[k] = s
  }
  return (view, mean) => {
    encodeOption(view, mean, rt.raw, c)
    for (const j of own) x[j] = standard(rt, j)
    let A = acts[1]
    for (let k = 0; k < J; k++) {
      let s = h0[k]
      const off = k * I
      for (const j of own) s += WT[0][off + j] * x[j]
      A[k] = s > 0 ? s : 0
    }
    for (let l = 1; l + 1 < sizes.length; l++) {
      const In = sizes[l]
      const Out = sizes[l + 1]
      const Z = acts[l + 1]
      const last = l + 2 === sizes.length
      for (let k = 0; k < Out; k++) {
        let s = b[l][k]
        const off = k * In
        for (let i = 0; i < In; i++) s += WT[l][off + i] * A[i]
        Z[k] = last || s > 0 ? s : 0
      }
      A = Z
    }
    return A[0]
  }
}

// ── the net in training ──────────────────────────────────────────────────────────────────────────

// A multilayer perceptron for training (as value.js createNet's: `W[l]` input-major, Float64Arrays), sizes [inputs,
// …hidden, 1]: the hidden layers He-initialised from `seed`, the last layer zero (an untrained ranker is today's
// expert).
export function createNet ({ inputs, hidden = [64, 32], seed = 1 }) {
  const sizes = [inputs, ...hidden, 1]
  const rand = mulberry(seed)
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
  const W = []
  const b = []
  for (let l = 0; l + 1 < sizes.length; l++) {
    const last = l + 2 === sizes.length
    const s = Math.sqrt(2 / sizes[l])
    W.push(Float64Array.from({ length: sizes[l] * sizes[l + 1] }, () => (last ? 0 : gauss() * s)))
    b.push(new Float64Array(sizes[l + 1]))
  }
  return { sizes, W, b }
}

// The listwise loss of a batch of positions, and with `grads` (value.js gradsFor) its gradient. `batch`: { X (m × inputs,
// standardised), m, start (the positions' first options, k + 1), base (each option's today's score ÷ T), q (each
// option's target share: within its position, summing to 1), w (each position's weight) }; `g` = scale ÷ T (the net's
// output in the logits' units). Per position, its logits s = base + g·net, its loss logΣexp(s) − Σ q·s; → their mean by
// weight.
export function listLoss (net, batch, g, grads = null, acts = []) {
  const { X, m, start, base, q, w } = batch
  forwardAll(net, X, m, acts)
  const O = acts[net.sizes.length - 1]
  const k = start.length - 1
  let wsum = 0
  for (let p = 0; p < k; p++) wsum += w[p]
  const delta = grads ? new Float64Array(m) : null
  let total = 0
  for (let p = 0; p < k; p++) {
    const a = start[p]
    const z = start[p + 1]
    let top = -Infinity
    for (let i = a; i < z; i++) top = Math.max(top, base[i] + g * O[i])
    let sum = 0
    for (let i = a; i < z; i++) sum += Math.exp(base[i] + g * O[i] - top)
    const lse = top + Math.log(sum)
    let cross = 0
    for (let i = a; i < z; i++) cross += q[i] * (base[i] + g * O[i])
    const wp = w[p] / wsum
    total += wp * (lse - cross)
    if (delta) for (let i = a; i < z; i++) delta[i] = wp * g * (Math.exp(base[i] + g * O[i] - lse) - q[i])
  }
  if (grads) backward(net, acts, delta, m, grads)
  return total
}

// The gradient of the weights from the outputs' (`delta`, n × the last layer), through ReLU, into `grads` (zeroed here).
function backward (net, acts, delta, n, grads) {
  const { sizes, W } = net
  const L = sizes.length - 1
  for (let l = 0; l < L; l++) {
    grads.W[l].fill(0)
    grads.b[l].fill(0)
  }
  let d = delta
  for (let l = L - 1; l >= 0; l--) {
    const I = sizes[l]
    const J = sizes[l + 1]
    const A = acts[l]
    const gW = grads.W[l]
    const gb = grads.b[l]
    const Wl = W[l]
    const prev = l > 0 ? new Float64Array(n * I) : null
    for (let r = 0; r < n; r++) {
      const dO = r * J
      const aO = r * I
      for (let j = 0; j < J; j++) gb[j] += d[dO + j]
      for (let i = 0; i < I; i++) {
        const v = A[aO + i]
        if (v === 0) continue
        const wo = i * J
        let s = 0
        for (let j = 0; j < J; j++) {
          gW[wo + j] += v * d[dO + j]
          s += Wl[wo + j] * d[dO + j]
        }
        if (prev && v > 0) prev[aO + i] = s
      }
    }
    d = prev
  }
}

// ── the labels ───────────────────────────────────────────────────────────────────────────────────

// A growing typed array.
class Grow {
  constructor (Type, n = 1 << 16) {
    this.Type = Type
    this.a = new Type(n)
    this.n = 0
  }

  room (k) {
    if (this.n + k <= this.a.length) return
    const b = new this.Type(Math.max(this.a.length * 2, this.n + k))
    b.set(this.a.subarray(0, this.n))
    this.a = b
  }

  push (x) {
    this.room(1)
    this.a[this.n++] = x
  }

  view () {
    return this.a.subarray(0, this.n)
  }
}

const node = (name) => globalThis.process?.getBuiltinModule?.(`node:${name}`)

// The lines of a label file, streamed (a labels.jsonl of 90 MB is read a line at a time).
async function * linesOf (file) {
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

// One label row (teach.js: a position and its options) read as the ranker's data: its options that today's hard rules
// keep (the reference, meanOf) and of them those legal with a value (the decision's options), each encoded (raw), of
// code's inputs those `cols` names (their indices in inputNames). `after`: after.jsonl's line for the row (each option's
// afterstate against the row's own, rowAfter; `names` its conditions), null where none was written. Rows with fewer
// than two such options carry no decision: null. → { x (raw inputs, an option a row), prior, value, steps, lane,
// target, chosen, n, meta }
export function readPosition (row, cols = null, after = null, names = afterNames()) {
  const kept = row.options.filter((o) => o.kept)
  const opts = kept.filter((o) => o.legal && Number.isFinite(o.value))
  if (opts.length < 2) return null
  const mean = meanOf(kept.map((o) => rowView(o)))
  const L = layout()
  const D = cols ? cols.length : L.D
  const full = new Float64Array(L.D)
  const x = new Float64Array(opts.length * D)
  opts.forEach((o, i) => {
    encode(row.sit, row.kind, rowView(o, rowAfter(row.sit, after?.a?.[o.i] ?? null, names)), mean, full)
    if (cols) for (let j = 0; j < D; j++) x[i * D + j] = full[cols[j]]
    else x.set(full, i * D)
  })
  const taken = row.options[row.chosen]
  return {
    x,
    prior: opts.map((o) => o.prior),
    value: opts.map((o) => o.value),
    steps: opts.map((o) => o.steps),
    lane: opts.map((o) => LANE[tileX(o.tile)]),
    target: opts.map((o) => o.target ?? -1),
    chosen: opts.map((o) => (o.chosen ? 1 : 0)),
    n: opts.length,
    meta: { id: row.id, run: row.run, split: splitOf(row.run), group: row.group, floor: row.floor, wt: row.wt ?? 1, taken: taken && taken.legal ? taken.value : null }
  }
}

// The positions of label sets `dirs` (each a directory of teach.js's labels, or a file), read into one table: raw
// inputs X (Float32, m × D: the inputs `inputs` names, INPUT_SETS' base by default; the afterstate's read from each
// directory's after.jsonl, line for line with its labels: teach.js augment), per option its prior, value, tie keys
// (steps, lane, target) and whether the expert took it, and per position its first option (start), split, group, floor,
// weight (`wt`; `dw`, its label set's weight: `weights`, 1 each by default), the taken option's value, and whether its
// options' values differ (decisive). With `all` false, the training and validation positions that are not decisive are
// left out (they never enter the loss; the held-out ones are kept, for the tables). → the table
export async function readLabels (dirs, { inputs = INPUT_SETS.base(), weights = null, all = true, log = null } = {}) {
  const fs = node('fs')
  const L = layout()
  const cols = Int32Array.from(inputs.map((n) => {
    const i = L.names.indexOf(n)
    if (i < 0) throw new Error(`ranker: unknown input "${n}"`)
    return i
  }))
  const after = inputs.some((n) => n.startsWith('aft.'))
  const D = cols.length
  const X = new Grow(Float32Array, 1 << 22)
  const col = { prior: new Grow(Float64Array), value: new Grow(Float64Array), steps: new Grow(Int16Array), lane: new Grow(Int8Array), target: new Grow(Int32Array), chosen: new Grow(Uint8Array) }
  const start = [0]
  const meta = []
  for (const [k, dir] of dirs.entries()) {
    const file = labelsIn(dir)
    const side = file.replace(/labels\.jsonl$/, 'after.jsonl')
    const lines = after ? (fs.existsSync(side) ? linesOf(side)[Symbol.asyncIterator]() : null) : null
    if (after && !lines) throw new Error(`ranker: ${dir} has no after.jsonl (npm run teach -- --augment ${dir})`)
    const names = after ? JSON.parse(fs.readFileSync(side.replace(/after\.jsonl$/, 'after.json'), 'utf8')).conditions : null
    let n = 0
    let unread = 0
    for await (const line of linesOf(file)) {
      const row = JSON.parse(line)
      let a = null
      if (lines) {
        // Rows labelled after the augmentation have no line: left out (counted).
        const next = unread ? { done: true } : await lines.next()
        if (next.done) {
          unread++
          continue
        }
        a = JSON.parse(next.value)
        if (a.id !== row.id) throw new Error(`ranker: ${side} is not line for line with its labels (at ${row.id})`)
      }
      const p = readPosition(row, cols, a, names ?? undefined)
      if (!p) continue
      const decisive = Math.max(...p.value) - Math.min(...p.value) > 1e-9
      if (!all && !decisive && p.meta.split !== 'held') continue
      X.room(p.x.length)
      X.a.set(p.x, X.n)
      X.n += p.x.length
      for (const key in col) for (let i = 0; i < p.n; i++) col[key].push(p[key][i])
      start.push(start.at(-1) + p.n)
      meta.push({ ...p.meta, data: dir, dw: weights?.[k] ?? 1, decisive })
      n++
    }
    log?.(`  ${dir}: ${n} positions${after ? `, with their afterstates${unread ? ` (${unread} rows past after.jsonl left out)` : ''}` : ''}`)
  }
  return { D, names: inputs.slice(), X: X.view(), m: start.at(-1), start: Int32Array.from(start), meta, ...Object.fromEntries(Object.entries(col).map(([key, g]) => [key, g.view()])) }
}

// ── fitting ──────────────────────────────────────────────────────────────────────────────────────

export const VARIANTS = Object.freeze(['plain', 'weighted', 'unchosen'])
export const FIT = Object.freeze({ variant: 'plain', tau: 0.5, l2: 1e-3, lr: 1e-3, epochs: 60, patience: 6, batch: 32, hidden: [64, 32], seed: 1, clip: 10, wclip: 10 })

// The positions a variant trains on (of `list`), each with its options in the loss: those whose values differ among the
// options it keeps (with `unchosen`, the expert's own left out of the lost and near-lost battles), and its weight (its
// draw's, clipped, with `weighted`; × its label set's, `dw`). → [{ p, opts (indices into the table), w }]
function lossSet (d, list, cfg) {
  const out = []
  for (const p of list) {
    const M = d.meta[p]
    let opts = []
    for (let i = d.start[p]; i < d.start[p + 1]; i++) if (!(cfg.variant === 'unchosen' && M.group > 0 && d.chosen[i])) opts.push(i)
    if (opts.length < 2) continue
    const v = opts.map((i) => d.value[i])
    if (!(Math.max(...v) - Math.min(...v) > 1e-9)) continue
    if (opts.length === d.start[p + 1] - d.start[p]) opts = null
    out.push({ p, opts, w: (cfg.variant === 'weighted' ? Math.min(M.wt, cfg.wclip) : 1) * (M.dw ?? 1) })
  }
  return out
}
const optsOf = (d, e) => e.opts ?? Array.from({ length: d.start[e.p + 1] - d.start[e.p] }, (_, k) => d.start[e.p] + k)

// The median spread of today's score over the options of positions `set` (lossSet's): the temperature T.
function spreadOf (d, set) {
  const s = set.map((e) => {
    const pr = optsOf(d, e).map((i) => d.prior[i])
    return Math.max(...pr) - Math.min(...pr)
  }).sort((a, b) => a - b)
  return Math.max(1, s[Math.floor(s.length / 2)] ?? 1)
}

// Each input's mean and sd over the options of positions `set`.
function standardisation (d, set) {
  const D = d.D
  const mean = new Float64Array(D)
  const sq = new Float64Array(D)
  let n = 0
  for (const e of set) {
    for (const i of optsOf(d, e)) {
      const o = i * D
      for (let j = 0; j < D; j++) {
        const v = d.X[o + j]
        mean[j] += v
        sq[j] += v * v
      }
      n++
    }
  }
  const sd = new Float64Array(D)
  for (let j = 0; j < D; j++) {
    mean[j] /= Math.max(1, n)
    const s = Math.sqrt(Math.max(0, sq[j] / Math.max(1, n) - mean[j] * mean[j]))
    sd[j] = s > 1e-6 ? s : 1
  }
  return { mean, sd }
}

// The batch of positions `set` (lossSet's entries) for listLoss, standardised by `S`: their options' inputs and targets.
function batchOf (d, set, S, cfg, T) {
  const D = d.D
  const rows = set.map((e) => optsOf(d, e))
  const m = rows.reduce((n, r) => n + r.length, 0)
  const X = new Float64Array(m * D)
  const base = new Float64Array(m)
  const q = new Float64Array(m)
  const start = new Int32Array(set.length + 1)
  const w = new Float64Array(set.length)
  let r = 0
  set.forEach((e, k) => {
    start[k] = r
    w[k] = e.w
    let top = -Infinity
    for (const i of rows[k]) top = Math.max(top, d.value[i] / cfg.tau + d.prior[i] / T)
    let sum = 0
    const a = r
    for (const i of rows[k]) {
      standardise(d.X, i * D, S, cfg.clip, X, r * D, D)
      base[r] = d.prior[i] / T
      q[r] = Math.exp(d.value[i] / cfg.tau + d.prior[i] / T - top)
      sum += q[r]
      r++
    }
    for (let j = a; j < r; j++) q[j] /= sum
  })
  start[set.length] = r
  return { X, m, start, base, q, w }
}
function standardise (src, at, S, clip, dst, to, D) {
  for (let j = 0; j < D; j++) {
    const z = (src[at + j] - S.mean[j]) / S.sd[j]
    dst[to + j] = z > clip ? clip : z < -clip ? -clip : z
  }
}

// The net's output for every option of positions `list` (the whole table's where null), by chunks; `cols`, the table's
// columns its inputs are (null: all, in order). → Float64Array (m)
function outputs (d, net, S, clip, list = null, cols = null) {
  const D = net.sizes[0]
  const out = new Float64Array(d.m)
  const ps = list ?? d.meta.map((_, p) => p)
  const acts = []
  const row = new Float64Array(D)
  for (let c = 0; c < ps.length; c += 256) {
    const chunk = ps.slice(c, c + 256)
    const idx = chunk.flatMap((p) => Array.from({ length: d.start[p + 1] - d.start[p] }, (_, k) => d.start[p] + k))
    const X = new Float64Array(idx.length * D)
    idx.forEach((i, r) => {
      if (!cols) return standardise(d.X, i * d.D, S, clip, X, r * D, D)
      for (let j = 0; j < D; j++) row[j] = d.X[i * d.D + cols[j]]
      standardise(row, 0, S, clip, X, r * D, D)
    })
    forwardAll(net, X, idx.length, acts)
    const O = acts[net.sizes.length - 1]
    idx.forEach((i, r) => { out[i] = O[r] })
  }
  return out
}
// A configuration's net over the table (its inputs among the table's: a round-1 ranker read on rows with the
// afterstate's too). → { O (outputs'), scale }
export function outputsOf (d, config) {
  const { net, S } = netOf(config)
  const cols = config.inputs.map((n) => {
    const j = d.names.indexOf(n)
    if (j < 0) throw new Error(`ranker: the table lacks input "${n}" of ${config.name}`)
    return j
  })
  const same = cols.length === d.D && cols.every((j, i) => j === i)
  return { O: outputs(d, net, S, config.clip ?? 10, null, same ? null : cols), scale: config.scale }
}

// The option a ranker takes in position p (net outputs `O`, null for none: today's alone): of its options, today's
// choice (the best by its score, ties as policy.js better) unless one beats it by the total (score + scale·net). → the
// table's index of it, and today's.
const EPS = 1e-9
function pickIn (d, p, O, scale) {
  const beats = (i, j, si, sj) => {
    if (Math.abs(si - sj) > EPS) return si > sj
    if (d.steps[i] !== d.steps[j]) return d.steps[i] < d.steps[j]
    if (d.lane[i] !== d.lane[j]) return d.lane[i] < d.lane[j]
    return d.target[i] < d.target[j]
  }
  let today = d.start[p]
  for (let i = d.start[p] + 1; i < d.start[p + 1]; i++) if (beats(i, today, d.prior[i], d.prior[today])) today = i
  if (!O) return { pick: today, today }
  const total = (i) => d.prior[i] + scale * O[i]
  let pick = today
  for (let i = d.start[p]; i < d.start[p + 1]; i++) if (beats(i, pick, total(i), total(pick))) pick = i
  return { pick, today }
}

// Agreement with the playout-best and regret (the best value less the chosen's), over positions `list`, for the option
// the expert took in the data (`taken`: a kill-list strike among them), today's expert (its score alone) and each of
// `rankers` ({ name, O (its net outputs), scale }), and the share of decisions each changed from today's. → { n, taken:
// { agree, regret }, today, [name]: { agree, regret, changed } }
export function agreement (d, list, rankers) {
  const acc = () => ({ agree: 0, regret: 0, n: 0, changed: 0 })
  const r = { n: list.length, taken: acc(), today: acc() }
  for (const k of rankers) r[k.name] = acc()
  const add = (a, best, v) => {
    if (v === null || v === undefined) return
    a.n++
    a.regret += best - v
    if (v >= best - 1e-9) a.agree++
  }
  for (const p of list) {
    let best = -Infinity
    for (let i = d.start[p]; i < d.start[p + 1]; i++) best = Math.max(best, d.value[i])
    const { today } = pickIn(d, p, null, 0)
    add(r.today, best, d.value[today])
    add(r.taken, best, d.meta[p].taken)
    for (const k of rankers) {
      const { pick } = pickIn(d, p, k.O, k.scale)
      add(r[k.name], best, d.value[pick])
      if (pick !== today) r[k.name].changed++
    }
  }
  for (const k of ['taken', 'today', ...rankers.map((x) => x.name)]) {
    const a = r[k]
    a.changed = list.length ? a.changed / list.length : 0
    a.agree = a.n ? a.agree / a.n : 0
    a.regret = a.n ? a.regret / a.n : 0
  }
  return r
}

// The validation table of positions `list` (agreement's, for `rankers`): all, decisive, decisive by the battle's end
// (won, near-lost, lost: drawn by the outcome, in a lost battle the option the expert took loses by construction, in a
// won one it wins), decisive by floor. → rows
export function validation (d, list, rankers) {
  const dec = list.filter((p) => d.meta[p].decisive)
  const rows = [['all', list], ['decisive', dec]]
  for (const [g, name] of [[0, 'won'], [1, 'near-lost'], [2, 'lost']]) rows.push([`decisive, ${name} battles`, dec.filter((p) => d.meta[p].group === g)])
  for (const f of [...new Set(list.map((p) => d.meta[p].floor))].sort((a, b) => a - b)) rows.push([`decisive, floor ${f}`, dec.filter((p) => d.meta[p].floor === f)])
  return rows.map(([name, ps]) => ({ name, ...agreement(d, ps, rankers), names: rankers.map((k) => k.name) }))
}
// A validation table in words: each column's agreement and regret, a ranker's with the share it changed.
export function tableText (rows) {
  const pct = (x) => `${(100 * x).toFixed(1)}%`.padStart(6)
  const names = rows[0]?.names ?? []
  const cell = (a, ch) => `${pct(a.agree)} ${a.regret.toFixed(3).padStart(6)}${ch ? ` ${pct(a.changed)}` : ''}`
  const head = ['taken agree/regret'.padStart(20), 'today agree/regret'.padStart(20), ...names.map((k) => `${k} agree/regret/changed`.padStart(28))]
  const out = [`${''.padEnd(26)} ${'n'.padStart(6)} ${head.join(' ')}`]
  for (const r of rows) out.push(`${r.name.padEnd(26)} ${String(r.n).padStart(6)} ${cell(r.taken).padStart(20)} ${cell(r.today).padStart(20)} ${names.map((k) => cell(r[k], true).padStart(28)).join(' ')}`)
  return out.join('\n')
}

// Fits a ranker on table `d` (readLabels'), by `cfg` (FIT's keys), on the table's inputs. → { config (ranker.json's
// shape), net, O (its outputs over the table), held, val (their validation tables, beside `compare`'s: [{ name, O,
// scale }], outputsOf's) }
export function fitRanker (d, cfg = {}, { log = () => {}, compare = [] } = {}) {
  cfg = { ...FIT, ...cfg }
  if (!VARIANTS.includes(cfg.variant)) throw new Error(`ranker: unknown variant "${cfg.variant}": ${VARIANTS.join(', ')}`)
  const by = (s) => d.meta.map((_, p) => p).filter((p) => d.meta[p].split === s)
  const train = lossSet(d, by('train'), cfg)
  const val = lossSet(d, by('val'), cfg)
  const T = spreadOf(d, train)
  const scale = T
  const g = scale / T
  const S = standardisation(d, train)
  log(`fitting (${cfg.variant}): ${train.length} training positions, ${val.length} validation; T = scale = ${T.toFixed(2)}, τ ${cfg.tau}, L2 ${cfg.l2}`)
  const net = createNet({ inputs: d.D, hidden: cfg.hidden, seed: cfg.seed })
  const grads = gradsFor(net)
  const state = {}
  const rand = mulberry(cfg.seed + 7)
  const valBatch = batchOf(d, val, S, cfg, T)
  const lossOn = (b) => listLoss(net, b, g)
  let best = { loss: lossOn(valBatch), epoch: 0, W: net.W.map((w) => w.slice()), b: net.b.map((v) => v.slice()) }
  log(`  epoch 0: validation loss ${best.loss.toFixed(5)}`)
  const order = train.slice()
  const acts = []
  for (let epoch = 1; epoch <= cfg.epochs; epoch++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    let sum = 0
    for (let a = 0; a < order.length; a += cfg.batch) {
      const b = batchOf(d, order.slice(a, a + cfg.batch), S, cfg, T)
      sum += listLoss(net, b, g, grads, acts) * Math.min(cfg.batch, order.length - a)
      adam(net, grads, state, { lr: cfg.lr, l2: cfg.l2 })
    }
    const v = lossOn(valBatch)
    log(`  epoch ${epoch}: training loss ${(sum / order.length).toFixed(5)}, validation ${v.toFixed(5)}`)
    if (v < best.loss - 1e-6) best = { loss: v, epoch, W: net.W.map((w) => w.slice()), b: net.b.map((x) => x.slice()) }
    else if (epoch - best.epoch >= cfg.patience) break
  }
  net.W = best.W
  net.b = best.b
  const config = toConfig(net, S, d.names, { T, scale, cfg, epoch: best.epoch, loss: best.loss, positions: { train: train.length, val: val.length } })
  const O = outputs(d, net, S, cfg.clip)
  const rankers = [...compare, { name: 'ranker', O, scale }]
  return { config, net, O, scale, val: validation(d, by('val'), rankers), held: validation(d, by('held'), rankers) }
}

const round = (v) => +v.toPrecision(7)
// A fitted net as ranker.json's configuration.
function toConfig (net, S, inputs, { T, scale, cfg, epoch, loss, positions }) {
  return {
    name: `ranker-${cfg.variant}`,
    about: `today's score + scale·net (redesign.md §2.23), fitted on teach.js's labels to the battle's end, variant ${cfg.variant}`,
    made: { at: new Date().toISOString(), ...cfg, T: round(T), epoch, validation: round(loss), positions },
    data: cfg.data ?? null,
    inputs: inputs.slice(),
    mean: Array.from(S.mean, round),
    sd: Array.from(S.sd, round),
    clip: cfg.clip,
    scale: round(scale),
    net: { sizes: net.sizes.slice(), W: net.W.map((w) => Array.from(w, round)), b: net.b.map((v) => Array.from(v, round)) }
  }
}

// A configuration's net for training or measuring (its standardisation with it). → { net, S }
export function netOf (config) {
  return {
    net: { sizes: config.net.sizes.slice(), W: config.net.W.map((w) => Float64Array.from(w)), b: config.net.b.map((v) => Float64Array.from(v)) },
    S: { mean: Float64Array.from(config.mean), sd: Float64Array.from(config.sd, (s) => (s > 1e-9 ? s : 1)) }
  }
}

// ── the command ──────────────────────────────────────────────────────────────────────────────────

// npm run rank -- --data <dir>[,<dir>…] --out <file> [--inputs base|aft] [--data-weight 1,0.5,…] [--compare <file>,…]
//                 [--variant plain|weighted|unchosen] [--tau 0.5] [--l2 1e-3] [--lr 1e-3] [--epochs 60] [--patience 6]
//                 [--batch 32] [--hidden 64,32] [--seed 1] [--clip 10] [--wclip 10]
//   fits a ranker and writes it (src/sim/ranker.json is the one play reads: write it only for a ranker kept on a paired
//   gain), printing the validation positions' (seeds ≡ 1 mod 5; their decisive ones) and the held-out positions' (≡ 0)
//   tables: the option the expert took's agreement with the playout-best and its regret, today's expert's, each
//   `--compare` ranker's (round 1's, say) and the ranker's. `--inputs aft`: with the afterstate's (each label set
//   augmented: teach.js --augment); `--data-weight`: each label set's weight, in --data's order.
// npm run rank -- --data <dir>[,<dir>…] --eval <file>[,<file>…] [--inputs base|aft]   the tables of rankers fitted already.
async function main () {
  const argv = process.argv.slice(2)
  const arg = (name, def) => {
    const i = argv.indexOf('--' + name)
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def
  }
  const list = (k) => (arg(k, '') || '').split(',').filter(Boolean)
  const dirs = list('data')
  if (!dirs.length) throw new Error('rank: --data <dir>[,<dir>…] of teach.js labels')
  const set = arg('inputs', 'base')
  if (!INPUT_SETS[set]) throw new Error(`rank: --inputs ${set}: one of ${Object.keys(INPUT_SETS).join(', ')}`)
  const weights = list('data-weight').map(Number)
  const fs = node('fs')
  const read = (f) => checkRanker(JSON.parse(fs.readFileSync(f, 'utf8')))
  const t0 = Date.now()
  console.log(`reading ${dirs.join(', ')} (inputs ${set}${weights.length ? `, weights ${weights.join(', ')}` : ''})`)
  const evals = list('eval')
  const d = await readLabels(dirs, { inputs: INPUT_SETS[set](), weights: weights.length ? weights : null, all: evals.length > 0, log: console.log })
  const held = d.meta.map((_, p) => p).filter((p) => d.meta[p].split === 'held')
  const valid = d.meta.map((_, p) => p).filter((p) => d.meta[p].split === 'val')
  console.log(`${d.meta.length} positions, ${d.m} options, ${d.D} inputs (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
  const show = (name, rows) => console.log(`\n${name}\n${tableText(rows)}`)
  const named = (f) => ({ name: read(f).name ?? f, ...outputsOf(d, read(f)) })
  if (evals.length) {
    const rankers = evals.map(named)
    show('validation (seeds ≡ 1 mod 5)', validation(d, valid, rankers))
    show('held out (seeds ≡ 0 mod 5)', validation(d, held, rankers))
    return
  }
  const num = (k) => (arg(k, null) === null ? undefined : Number(arg(k)))
  const cfg = Object.fromEntries(Object.entries({
    variant: arg('variant', undefined), tau: num('tau'), l2: num('l2'), lr: num('lr'), epochs: num('epochs'), patience: num('patience'), batch: num('batch'),
    hidden: arg('hidden', null)?.split(',').map(Number), seed: num('seed'), clip: num('clip'), wclip: num('wclip')
  }).filter(([, v]) => v !== undefined))
  cfg.data = dirs
  cfg.inputs = set
  if (weights.length) cfg.weights = weights
  const out = arg('out', null)
  const r = fitRanker(d, cfg, { log: console.log, compare: list('compare').map(named) })
  show('validation (seeds ≡ 1 mod 5; the decisive positions)', r.val)
  show('held out (seeds ≡ 0 mod 5)', r.held)
  r.config.made.held = r.held.map((x) => ({ name: x.name, n: x.n, today: x.today, ranker: x.ranker }))
  if (out) {
    fs.writeFileSync(out, JSON.stringify(r.config) + '\n')
    console.log(`\nwrote ${out} (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
  }
}

if (typeof process !== 'undefined' && process.argv[1] === decodeURIComponent(new URL(import.meta.url).pathname)) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
