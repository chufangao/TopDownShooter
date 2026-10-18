// The battle forest: a random forest of regression trees over the situation, the option and the piece, fitted offline on
// teach.js's playouts (forestfit.js) and shipped as expert.json's `forest`. With none in use the expert is today's, move
// for move; in play (policy.js forested) a candidate whose predicted advantage over today's choice exceeds `delta` wins.
//   useForest(config)  installs a forest (null: none; undefined: back to the shipped one). → the one in use, or null
//   forestModel()      → the forest in use, or null
// The inputs (inputNames), read alike from a label row and from the board in play, rounded to 6 decimals:
//   sit.*   the conditions (expert.js conditions, the piece's own `self.*` among them)
//   role.*  the piece's kind's role (content.js ROLES), and `size` its kind's
//   opt.*   the option features (policy.js OPTION_FEATURES)
//   rel.*   each feature less its mean over the options today's hard rules keep (meanOf)
//   kind.*  stay, move, act, moveAct, fusion; and `steps`, the tiles it walks
//   aft.*   the conditions of the board the option leaves less the decision's own, where a forest names them
//   gap     today's score of today's choice less the option's
//   vs.*    each option feature less today's choice's
// The file: { kind: 'forest', name, about, made, data, inputs, target ('mean': less today's choice's own; 'today'), delta,
// size (each tree's node count), feat (a node's input index; −1 a leaf), thr (x ≤ thr: the next node), right (an inner
// node's right child, nodes ahead), value (a leaf's) }, each tree's nodes in preorder, one tree after another.
import { shippedPart, conditions } from './expert.js'
import { OPTION_FEATURES } from './policy.js'
import { ROLES, unitDef } from '../content.js'

// ── the forest in use ────────────────────────────────────────────────────────────────────────────

// The shipped expert's battle forest (Node only: in a browser there is none).
const readJSON = () => shippedPart('forest')
let SHIPPED
let INSTALLED = false
let MODEL = null

export function forestModel () {
  if (INSTALLED) return MODEL
  if (SHIPPED === undefined) {
    const json = readJSON()
    SHIPPED = json ? checkForest(json) : null
  }
  return SHIPPED
}

export function useForest (config) {
  INSTALLED = config !== undefined
  MODEL = config ? checkForest(config) : null
  return forestModel()
}

// The targets a forest is fitted to (predictor reads them).
export const TARGETS = Object.freeze(['mean', 'today'])

// A configuration checked: every input one the code reads, the trees' arrays agreeing, the margin finite. → it
export function checkForest (config) {
  const known = new Set(inputNames())
  const { inputs, size, feat, thr, right, value } = config ?? {}
  if (!Array.isArray(inputs) || !Array.isArray(size) || !Array.isArray(feat)) throw new Error('forest: no inputs or no trees')
  for (const n of inputs) if (!known.has(n)) throw new Error(`forest: unknown input "${n}"`)
  if (!Number.isFinite(config.delta)) throw new Error('forest: no margin (delta)')
  if (config.target !== undefined && !TARGETS.includes(config.target)) throw new Error(`forest: no target "${config.target}"`)
  let inner = 0
  for (const f of feat) {
    if (f >= inputs.length || f < -1) throw new Error('forest: a split on an input it does not name')
    if (f >= 0) inner++
  }
  if (size.reduce((a, b) => a + b, 0) !== feat.length || thr?.length !== inner || right?.length !== inner || value?.length !== feat.length - inner) throw new Error('forest: its trees\' arrays do not agree')
  return config
}

// ── the inputs ───────────────────────────────────────────────────────────────────────────────────

// The option's kinds, in order (encode's kind.*).
const KINDS = Object.freeze(['stay', 'move', 'act', 'moveAct', 'fusion'])
export const r6 = (x) => Math.round(x * 1e6) / 1e6
// A number as the rows write it: rounded to 6 decimals, a flag 0 or 1, anything else 0.
const num = (x) => (typeof x === 'number' ? (Number.isFinite(x) ? r6(x) : 0) : typeof x === 'boolean' ? +x : 0)

// The rows' layout (made at first use: policy.js and this file import each other): conditions C, roles R, option
// features F, every input's name (`names`; `base` without aft.*); the first `shared` are the decision's.
let ROWS = null
function rowLayout () {
  if (ROWS) return ROWS
  const C = Object.keys(conditions({}, { uid: -1, hp: 1, maxHp: 1 }))
  const R = Object.keys(ROLES).filter((r) => r !== 'monarch')
  const F = [...OPTION_FEATURES]
  const base = [...C.map((k) => `sit.${k}`), ...R.map((r) => `role.${r}`), 'size', ...F.map((k) => `opt.${k}`), ...F.map((k) => `rel.${k}`), ...KINDS.map((k) => `kind.${k}`), 'steps']
  const names = [...base, ...C.map((k) => `aft.${k}`)]
  ROWS = { C, R, F, base, names, D: names.length, shared: C.length + R.length + 1 }
  return ROWS
}
// The conditions an afterstate is read as (aft.*'s, in order).
export const afterNames = () => rowLayout().C

// An option as the rows read it ({ f, steps, act, fusion, after }): from the play (an option with its `v`, its `after`
// where read) and from a label row's option (teach.js: `f` with its zeros left out).
export const playView = (o) => ({ f: o.v, steps: o.path.length, act: !!o.ability, fusion: !!o.fusion, after: o.after ?? null })
export const rowView = (o, after = null) => ({ f: o.f, steps: o.steps, act: o.ability != null, fusion: o.fusion != null, after })

// An afterstate's conditions against a row's own (`sit`), as after.jsonl writes them: [k, v, …] for each condition
// (afterNames' index k) whose rounded value v differs.
export function afterDiff (after, sit) {
  const C = rowLayout().C
  const out = []
  for (let k = 0; k < C.length; k++) {
    const v = num(after[C[k]])
    if (v !== num(sit[C[k]])) out.push(k, v)
  }
  return out
}
// A row's afterstate back from after.jsonl's `diff` (against `names`, the writer's afterNames): the row's own conditions
// with those it changes; null where it was not read.
export function rowAfter (sit, diff, names = afterNames()) {
  if (!diff) return null
  const a = { ...sit }
  for (let j = 0; j < diff.length; j += 2) a[names[diff[j]]] = diff[j + 1]
  return a
}

// The reference of a position: each feature's mean over its options (views) that today's hard rules keep.
export function meanOf (views) {
  const { F } = rowLayout()
  const m = new Float64Array(F.length)
  if (!views.length) return m
  for (const w of views) for (let k = 0; k < F.length; k++) m[k] += num(w.f[F[k]])
  for (let k = 0; k < F.length; k++) m[k] /= views.length
  return m
}

// The rows' inputs of option `view` of a decision (conditions `c`, the piece's kind `unit`, `mean`: meanOf), written
// into `out` in the rows' layout. → out
export function encode (c, unit, view, mean, out = new Float64Array(rowLayout().D)) {
  encodeDecision(c, unit, out)
  encodeOption(view, mean, out, c)
  return out
}
function encodeDecision (c, unit, out) {
  const { C, R } = rowLayout()
  for (let i = 0; i < C.length; i++) out[i] = num(c[C[i]])
  const def = unitDef(unit)
  for (let j = 0; j < R.length; j++) out[C.length + j] = def.role === R[j] ? 1 : 0
  out[C.length + R.length] = def.size ?? 1
  return out
}
function encodeOption (view, mean, out, c) {
  const { C, F, shared } = rowLayout()
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

// The inputs' layout: the rows', then `gap` and vs.* (F the option features, `opt` where opt.* starts).
let LAYOUT = null
function layout () {
  if (LAYOUT) return LAYOUT
  const R = rowLayout().names
  const F = R.filter((n) => n.startsWith('opt.')).map((n) => n.slice(4))
  const extra = ['gap', ...F.map((k) => `vs.${k}`)]
  LAYOUT = { F, extra, names: [...R, ...extra], D: R.length + extra.length, opt: R.indexOf(`opt.${F[0]}`), gap: R.length, vs: R.length + 1 }
  return LAYOUT
}
// The inputs by name, in encodeAgainst's order; INPUT_SETS: the sets a forest is fitted on (without and with aft.*).
export const inputNames = () => layout().names
export const INPUT_SETS = Object.freeze({ base: () => [...rowLayout().base, ...layout().extra], aft: () => layout().names })

// An option as the forest reads it: its view with its `prior`, today's score of it.
export const playOf = (o) => ({ ...playView(o), prior: o.score })
export const rowOf = (o, after = null) => ({ ...rowView(o, after), prior: o.prior })

// The raw inputs of option `view` against today's choice `own`: encode's, then the gap of today's score and each
// feature less today's choice's. Written into `out` (inputNames' layout). → out
export function encodeAgainst (c, unit, view, mean, own, out = new Float64Array(layout().D)) {
  encodeDecision(c, unit, out)
  return encodeOptionAgainst(c, view, mean, own, out)
}
// encodeAgainst's without the decision's part (the first `shared` inputs, alike for all its options).
function encodeOptionAgainst (c, view, mean, own, out) {
  const L = layout()
  encodeOption(view, mean, out, c)
  out[L.gap] = r6(num(own.prior) - num(view.prior))
  for (let k = 0; k < L.F.length; k++) out[L.vs + k] = out[L.opt + k] - num(own.f[L.F[k]])
  return out
}

// ── the forest in play ───────────────────────────────────────────────────────────────────────────

// A configuration made ready for play, once: compiled to typed arrays in the code's input layout.
const RUNTIMES = new WeakMap()
function runtimeOf (model) {
  let rt = RUNTIMES.get(model)
  if (rt) return rt
  const L = layout()
  rt = { ...compileTrees(model, model.inputs.map((n) => L.names.indexOf(n))), x: new Float64Array(L.D), after: model.inputs.some((m) => m.startsWith('aft.')) }
  RUNTIMES.set(model, rt)
  return rt
}
// The trees of a configuration in typed arrays for play, each split's input `at[feat]` and each right child its index.
// Shared with outforest.js. → { feat, thr, right, val, roots }
export function compileTrees (model, at) {
  const n = model.feat.length
  const feat = new Int32Array(n)
  const thr = new Float64Array(n)
  const right = new Int32Array(n)
  const val = new Float64Array(n)
  const roots = new Int32Array(model.size.length)
  let k = 0
  let i = 0
  let j = 0
  for (let t = 0; t < model.size.length; t++) {
    roots[t] = k
    const end = k + model.size[t]
    for (; k < end; k++) {
      const f = model.feat[k]
      if (f < 0) {
        feat[k] = -1
        val[k] = model.value[j++]
        continue
      }
      feat[k] = at[f]
      thr[k] = model.thr[i]
      right[k] = k + model.right[i++]
      if (!(right[k] > k + 1 && right[k] < end)) throw new Error(`forest: tree ${t}'s node ${k - roots[t]} points outside it`)
    }
  }
  return { feat, thr, right, val, roots }
}
// The mean of the trees' leaves for raw inputs `x` (the layout the trees were compiled for: compileTrees).
export function treesMean (rt, x) {
  const { feat, thr, right, val, roots } = rt
  let s = 0
  for (let t = 0; t < roots.length; t++) {
    let k = roots[t]
    for (let f = feat[k]; f >= 0; f = feat[k]) k = x[f] <= thr[k] ? k + 1 : right[k]
    s += val[k]
  }
  return roots.length ? s / roots.length : 0
}
// The same for several inputs at once, tree by tree, each tree's nodes read once for all (the trees are megabytes).
function treesMeans (rt, xs) {
  const { feat, thr, right, val, roots } = rt
  const sums = new Array(xs.length).fill(0)
  for (let t = 0; t < roots.length; t++) {
    const root = roots[t]
    for (let j = 0; j < xs.length; j++) {
      const x = xs[j]
      let k = root
      for (let f = feat[k]; f >= 0; f = feat[k]) k = x[f] <= thr[k] ? k + 1 : right[k]
      sums[j] += val[k]
    }
  }
  return sums.map((s) => (roots.length ? s / roots.length : 0))
}
// Whether forest `model` reads the board an option leaves (aft.*): only then does play read it (policy.js afterOf).
export const readsAfter = (model) => runtimeOf(model).after
// Forest `model`'s prediction for raw inputs `x` (encodeAgainst's).
export const predict = (model, x) => treesMean(runtimeOf(model), x)

// The forest of `model` for one decision (conditions `c`, the kind `unit`, `mean`, `own` today's choice's view): → a
// function of an option's view → its predicted advantage over today's choice (less own's prediction for target 'mean').
export function predictor (model, c, unit, mean, own) {
  const rt = runtimeOf(model)
  const base = model.target === 'mean' ? treesMean(rt, encodeAgainst(c, unit, own, mean, own, rt.x)) : 0
  return (view) => treesMean(rt, encodeAgainst(c, unit, view, mean, own, rt.x)) - base
}
// predictor's advantages for each of `views` at once (treesMeans: the same numbers). → [advantage]
export function predictions (model, c, unit, mean, own, views) {
  const rt = runtimeOf(model)
  const head = encodeDecision(c, unit, new Float64Array(layout().D))
  const xs = views.map((view) => encodeOptionAgainst(c, view, mean, own, head.slice()))
  if (model.target === 'mean') xs.push(encodeOptionAgainst(c, own, mean, own, head.slice()))
  const sums = treesMeans(rt, xs)
  const base = model.target === 'mean' ? sums.pop() : 0
  return sums.map((p) => p - base)
}
