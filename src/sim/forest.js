// The forest (redesign.md §2.23's learned correction, as the user asked for it on 2026-10-12: "no neural network", the
// expert deciding by rules mined from the lookahead, "Think random forest"): a random forest of regression trees over
// the situation, the option and the piece, fitted offline on teach.js's playouts and shipped as data in the expert's
// one file (src/sim/expert.json's `forest`; bundle.js writes it from a forest's own file). No
// network: a decision is today's expert's, then a few thousand comparisons an option. This file is the contract between
// the teacher (teach.js, which plays out under the forest in use) and the player (policy.js choice, which consults the
// forest where one is in use):
//
//   useForest(config)   installs a forest configuration (a forest's file, forest.json's shape below); null: none,
//                       today's expert; undefined: back to the shipped expert's (expert.json's `forest`, where it has
//                       one). → the one in use, or null
//   forestModel()       → the forest in use, or null for none
//
// With none in use (the shipped expert has no `forest`, or useForest(null)), the expert is today's (or today's with the ranker in use,
// ranker.js), move for move. A forest in use decides in place of any ranker.
//
// In play (policy.js choice, forested): a piece's candidates are the ranker's (policy.js rankerView: today's shortlist,
// at most 16, the labels' own, that today's hard rules keep, and today's own choice), today's choice the default. For
// each other candidate o the forest predicts A(o), its advantage over today's choice (predictor): the mean of its trees'
// leaves R(o) less today's choice's own R (the centred target, `target` 'mean'), or that mean alone (`target` 'today').
// The best of them by A (ties as policy.js `better`: the fewer steps, the lower lane, the lower target uid) is taken
// where its A exceeds the configuration's margin `delta`, else today's choice: the forest deviates only where it is
// confident, so a forest whose advantages never exceed delta (every tree a single leaf, or of target 'today' every leaf
// at most delta) is today's expert, move for move. The audit's `by`: the hard rule that filtered first, else 'forest'
// (and its `margin`, the A it took the option by) where the forest changed the choice, else today's.
//
// The inputs, x (inputNames), read alike from a label row and from the board in play (encodeAgainst; a test holds the
// two equal):
//   ranker.js encode's  sit.*, role.*, size, opt.*, rel.*, kind.*, steps, and aft.* where a configuration names them
//                       (the board the option leaves, policy.js afterOf: ~2.2 s more a run, 2026-10-12; rows get them
//                       from teach.js --augment's after.jsonl)
//   gap                 today's score of today's choice less the option's (≥ 0: today's choice is the best by it)
//   vs.*                each option feature less today's choice's: the target is an advantage over that one option,
//                       and these read it directly ("this option screens and today's does not")
// Trees need no standardisation: the raw numbers, each rounded to 6 decimals as the rows are written.
//
// The target (targetsOf), a row an option of a position: its playout value (teach.js, to the battle's end: −10 a battle
// lost, else the HP shares carried and the rounds) less the mean of its position's options' (`target` 'mean', the
// default: the centred value R), or less today's choice's (`target` 'today', today's own row left out: the advantage A
// itself), clipped to ±`clip`. The centred target is the one kept (2026-10-12, R3): today's own playout is one draw of
// a chaotic battle, and as the reference of every row of its position its luck is in all of them alike, where the mean
// of ~10 options averages it out; fitted to A directly, the top 1% of the held-out predictions (+0.36) realised −0.23,
// fitted to R, +0.14 realised +0.14, and the correlation of the predicted advantage with the realised 0.07 against 0.10.
// Today's choice of a row is the best by today's score (the row's `prior`, ties as policy.js better), as play finds it:
// in R2's rows the `chosen` is round 1's ranker's, not today's. Positions whose options all tie are kept (they say
// "nothing to gain here", which is what keeps the forest at today's choice), positions with fewer than two options left
// out.
//
// The trees (fitForest; `npm run forest`): regression trees on histogram splits (each input cut into at most `bins`
// quantile bins of a sample of the training rows, at short decimals strictly between two values met, so a split read on
// the bins is the split read on the raw number, exactly), the squared error's reduction, `mtry` of the inputs drawn at
// each split, grown best first to at most `leaves` leaves and `depth` levels, each leaf at least `minLeaf` rows, its
// value its rows' mean (shrunk by `shrink` rows of 0). Bagged by run: each tree's rows are whole runs drawn with
// replacement (a battle's decisions are correlated and their playouts chaotic: rows drawn alone would let a tree learn a
// run by heart), the runs left out its out-of-bag rows (an honest estimate of each training row). Rows weigh alike by
// default: the state draw's chance (teach.js `--draw state`) is a function of the board, so E[A | x] is the same under
// any weighting by it, and the reach positions, drawn the more, get the finer leaves (`weighted`: by the draw's `wt`,
// clipped, as the ranker's). Labels drawn by their battle's outcome (L2, L3) are biased (in a lost battle today's choice
// loses by construction); their `wt` (1 / the draw's chance) would undo it in expectation, read `weighted`, at a cost in
// variance (a calm decision of a won battle weighs 33): no forest kept reads them. Seeds ≡ 0 mod 5 are held out
// (ranker.js splitOf), never fitted; the rest are fitted. Worker threads, typed arrays.
//
// Shipped as forest.json: { kind: 'forest', name, about, made, data, inputs (the names its splits read), target, delta,
// size (each tree's nodes), feat (a node's input, an index into `inputs`; −1 a leaf), thr (an inner node's threshold:
// x ≤ thr goes to the next node), right (an inner node's right child, nodes ahead), value (a leaf's) }, its nodes each
// tree's in preorder, the trees one after another; inside the expert's one file as its `forest`. Read Node-only (absent:
// today's expert).
//
// Round 1 (2026-10-12; labels R3: 500 runs `teachd-*` of today's expert, drawn by the board's state, half of the
// decisions where the Monarch is in reach or on a foe's line and 5% of the calm, 48,889 positions, every option played
// out to the battle's end by today's expert; R2 beside them, 52,077 positions of the ranker's round 1, at half weight,
// its playouts' rest the ranker's).
// Held out (seeds ≡ 0 mod 5) the label metrics are near their noise: of R3's held-out decisions the teacher gains 0.21
// a decision; the forests below, deviating where they read more than delta, realise +0.000 to +0.009 (a decision's
// standard error ~0.004), and their out-of-bag tables less. What they settled: the centred target (above), and that
// more data and the afterstate help a little (held-out correlation of the predicted advantage with the realised: R3
// 0.100, with aft 0.101, R3 and R2 0.107). Four variants (200 trees, depth ≤ 12, ≤ 512 leaves of ≥ 40 rows, mtry 1/3,
// ≤ 64 bins), paired against today's expert on 256 seeds `sel3`:
//   R3 and R2, round 1's inputs and the forest's, delta 0.05     +0.45 ± 1.90 progress  (clears +17 −31)
//   R3 and R2, with the afterstate's, delta 0.05                 +2.68 ± 1.63           (clears +29 −27)
//   R3 and R2, with the afterstate's, delta 0.02                 +0.88 ± 2.42           (clears +32 −41)
//   R3 alone, with the afterstate's, delta 0.05                  +1.59 ± 1.99           (clears +29 −31)
// The second, on 768 fresh seeds `chk3`: against today's expert, clears 35.4% against 30.7% (+89 −53), progress
// +3.28 ± 0.98, at 4.3 s a run against 2.1; against the ranker's round 1 (ranker.json as it stood), clears 35.4% against
// 36.7% (+119 −129), progress −0.64 ± 1.35, at 4.6 s against 2.8: within one standard error of it. Kept as forest.json
// (200 trees, 184,726 nodes, 2.1 MB; it changes ~5% of the held-out decisions), ranker.json removed from src/sim: the
// shipped expert is decisions only, no network.
// Round 2 (2026-10-12; labels R4: 500 runs `teachf-*` of round 1's forest, drawn by the state as R3's, 53,459
// positions, every option played out to the battle's end by round 1's forest, so no label leans on today's expert to
// do later what the option did not; its afterstate read in every playout's decision, 9 positions a second on seven
// workers against R3's 38; augmented with the afterstates). Refitted as round 1, with the afterstate's inputs. On R4's
// held-out decisions at delta 0.05, the gain realised: round 1 +0.008, R3 and R4 +0.008, R3, R4 and R2 +0.013. Paired
// against round 1 on 256 seeds `sel4`:
//   R3, R4 and R2 (at half weight), delta 0.05                    +1.65 ± 1.73 progress  (clears +23 −16)
//   R3, R4 and R2, delta 0.035                                    +3.03 ± 1.72           (clears +28 −16)
//   R3, R4 and R2, delta 0.02                                     +3.24 ± 1.69           (clears +29 −14)
//   R3 and R4, delta 0.05                                         +3.38 ± 1.56           (clears +27 −17)
// The last, on 768 fresh seeds `chk4`: against round 1, clears 33.1% against 34.1% (+78 −86), progress +1.78 ± 0.98, at
// 5.0 s a run against 4.8 (the runs go further: deaths on floors 1 and 2 272 against 296, on 3 and 4 242 against 210);
// against today's expert, clears 33.1% against 29.6% (+102 −75), progress +2.81 ± 1.03, at 5.1 s against 2.4. Kept as
// forest.json (200 trees, 196,322 nodes, 2.3 MB), on the gain in progress.
// Round 3 (2026-10-12; labels R5: 200 runs `teache-*` of round 2's forest, the learned route on, drawn by the state as
// R4's, 20,849 positions, each option played out three times to the battle's end, its label their mean: teach.js
// `--smooth 3 --epsilon 0.1`, the exact line and two with the continuation perturbed, round 2's forest deciding it; 2.3
// positions a second on eight workers; augmented). Of the options, 28% have three playouts not all alike, and where
// the exact lines of a position lose and win, a quarter have three that span a loss and a win; the perturbed playouts
// lose as often as the exact (9.4% against 9.3%). The means are the more learnable: on R5's held-out decisions at delta
// 0.05, a forest fitted to R5's means realises +0.008 on the means and +0.009 on the exact lines, one fitted to R5's
// exact lines alone (`--label exact`, the same positions) +0.001 and +0.000. Paired against round 2 on 256 seeds `sel6`:
//   R5 alone (its means), delta 0.05                              −1.80 ± 2.11 progress  (clears +25 −43)
//   R5's exact lines alone, delta 0.05                            −1.31 ± 2.22           (clears +26 −46)
//   R5 at twice the weight, R3 and R4, delta 0.05                 −2.43 ± 1.67           (clears +26 −29)
//   R5 at twice the weight, R3 and R4, delta 0.02                 +0.49 ± 2.05           (clears +38 −32)
// The last, on 768 fresh seeds `chk6`: against round 2, clears 36.3% against 34.2% (+107 −91), progress +1.94 ± 1.27,
// at 5.1 s a run against 4.9; against today's expert, clears 36.3% against 30.7% (+111 −68), progress +3.67 ± 1.22, at
// 5.2 s against 2.5. Kept as forest.json (200 trees, 201,376 nodes, 2.3 MB), on the gain in progress.
import { encode, meanOf, rowView, playView, rowAfter, afterNames, inputNames as rankerNames, INPUT_SETS as RANKER_SETS, splitOf, linesOf, labelsIn } from './ranker.js'
import { mulberry } from './value.js'
import { shippedPart } from './expert.js'
import { LANE } from './field.js'
import { tileX } from './unit.js'

const node = (name) => globalThis.process?.getBuiltinModule?.(`node:${name}`)

// ── the forest in use ────────────────────────────────────────────────────────────────────────────

// The shipped expert's battle forest (expert.js shippedPart: src/sim/expert.json's `forest`; Node only: in a browser
// there is none, and the expert is today's).
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

// A configuration checked: every input one the code reads, the trees' arrays agreeing (each tree's nodes, its inner
// nodes' thresholds and right children inside it, its leaves' values), the margin finite. → the configuration.
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

const r6 = (x) => Math.round(x * 1e6) / 1e6
// A number as the rows write it (ranker.js's): rounded to 6 decimals, a flag 0 or 1, anything else 0.
const num = (x) => (typeof x === 'number' ? (Number.isFinite(x) ? r6(x) : 0) : typeof x === 'boolean' ? +x : 0)

// The inputs' layout (made at first use, as ranker.js's): ranker.js's inputs, then `gap` and vs.*; F the option
// features (opt.*'s), `opt` where opt.* starts.
let LAYOUT = null
function layout () {
  if (LAYOUT) return LAYOUT
  const R = rankerNames()
  const F = R.filter((n) => n.startsWith('opt.')).map((n) => n.slice(4))
  const extra = ['gap', ...F.map((k) => `vs.${k}`)]
  LAYOUT = { F, extra, names: [...R, ...extra], D: R.length + extra.length, opt: R.indexOf(`opt.${F[0]}`), gap: R.length, vs: R.length + 1 }
  return LAYOUT
}
// The inputs by name, in the order encodeAgainst writes them; and the sets a forest is fitted on (INPUT_SETS): the
// ranker's round-1 inputs with the forest's own, and with the afterstate's too.
export const inputNames = () => layout().names
export const INPUT_SETS = Object.freeze({ base: () => [...RANKER_SETS.base(), ...layout().extra], aft: () => layout().names })

// An option as the forest reads it: the ranker's view (ranker.js playView in play, rowView of a label row's option)
// with its `prior`, today's score of it (in play `o.score`, expert.js decideTree's; a row's `prior`, the same score).
export const playOf = (o) => ({ ...playView(o), prior: o.score })
export const rowOf = (o, after = null) => ({ ...rowView(o, after), prior: o.prior })

// The raw inputs of option `view` of a decision (conditions `c`, the piece's kind `unit`, `mean` its position's
// reference: ranker.js meanOf) against today's choice `own` (its view, the same way): ranker.js encode's, then the gap of
// today's score and each feature less today's choice's. Written into `out` (inputNames' layout). → out
export function encodeAgainst (c, unit, view, mean, own, out = new Float64Array(layout().D)) {
  const L = layout()
  encode(c, unit, view, mean, out)
  out[L.gap] = r6(num(own.prior) - num(view.prior))
  for (let k = 0; k < L.F.length; k++) out[L.vs + k] = out[L.opt + k] - num(own.f[L.F[k]])
  return out
}

// ── the forest in play ───────────────────────────────────────────────────────────────────────────

// A configuration made ready for play, once: its nodes in typed arrays, each split's input mapped to code's layout and
// each right child to its index.
const RUNTIMES = new WeakMap()
function runtimeOf (model) {
  let rt = RUNTIMES.get(model)
  if (rt) return rt
  const L = layout()
  rt = { ...compileTrees(model, model.inputs.map((n) => L.names.indexOf(n))), x: new Float64Array(L.D), after: model.inputs.some((m) => m.startsWith('aft.')) }
  RUNTIMES.set(model, rt)
  return rt
}
// The trees of a configuration (forest.json's shape: size, feat, thr, right, value) in typed arrays for play, each
// split's input `at[feat]` (its place in the vector the trees will read) and each right child its index. Shared with
// outforest.js, whose forests are of the same shape. → { feat, thr, right, val, roots }
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
// Whether forest `model` reads the board an option leaves (aft.*): only then does play read it (policy.js afterOf).
export const readsAfter = (model) => runtimeOf(model).after
// Forest `model`'s prediction for raw inputs `x` (encodeAgainst's).
export const predict = (model, x) => treesMean(runtimeOf(model), x)

// The forest of `model` for one decision (conditions `c`, the piece's kind `unit`, `mean` its position's reference:
// meanOf, `own` today's choice's view: playOf): → a function of an option's view (playOf, its afterstate in it where the
// forest reads one: today's choice's too, for a forest of the centred target) → the option's predicted advantage over
// today's choice: the trees' mean, less today's choice's own where the target is centred (`target` 'mean').
export function predictor (model, c, unit, mean, own) {
  const rt = runtimeOf(model)
  const base = model.target === 'mean' ? treesMean(rt, encodeAgainst(c, unit, own, mean, own, rt.x)) : 0
  return (view) => treesMean(rt, encodeAgainst(c, unit, view, mean, own, rt.x)) - base
}

// ── the labels ───────────────────────────────────────────────────────────────────────────────────

const EPS = 1e-9
// The better of two label options by today's score (ties as policy.js better: the fewer steps, the lower lane, the
// lower target uid).
const ahead = (o, b) => {
  if (Math.abs(o.prior - b.prior) > EPS) return o.prior > b.prior
  if (o.steps !== b.steps) return o.steps < b.steps
  const lo = LANE[tileX(o.tile)]
  const lb = LANE[tileX(b.tile)]
  if (lo !== lb) return lo < lb
  return (o.target ?? -1) < (b.target ?? -1)
}

// One label row (teach.js: a position and its options) as the forest reads it: its options today's hard rules keep (the
// reference, meanOf), of them those legal with a value (the decision's), today's choice among them (the best by today's
// score, as play's), and each one's raw inputs against it (encodeAgainst; today's choice's own, its gap and vs.* 0),
// value and tie keys, today's choice first. `after`: after.jsonl's line for the row (`names` its conditions), null where
// none was written. Fewer than two such options: null. → { today, mean, rows: [{ o, x, value, steps, lane, target }] }
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

// The labels an option's value is read from (`label`): its `value` (a smoothed set's mean of its playouts, teach.js
// `--smooth`), or a smoothed set's exact line alone (`values[0]`: the label one playout would have given; a set not
// smoothed has only `value`, which is that).
export const LABELS = Object.freeze(['mean', 'exact'])

// The decisions of label sets `dirs`, streamed: each { row, d (readDecision's), k (its set's index) }, the afterstates
// read from each set's after.jsonl (line for line with its labels: teach.js augment) where `after`; rows labelled after
// the augmentation have none and are left out (counted in `skipped`); each option's value by `label` (LABELS).
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
export function binOf (cuts, x) {
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

// The decisions of label sets `dirs` (each a directory of teach.js's labels, or a file) read into one table for fitting:
// a row an option of a position (readDecision's: today's choice first), its inputs `inputs` (INPUT_SETS' base by
// default) cut into at most `bins` bins (cutsOf, on a reservoir of `sample` rows: two passes over the labels) and stored
// by column, bin for bin (shared memory, for the workers); per row its playout value (v), its position and tie keys
// (steps, lane, target); per position its first row (start: today's choice's), id, run, split, group, floor, danger,
// draw weight (`wt`), its label set (`data`, `dw` its weight: `weights`, 1 each by default) and the key of its run
// (`runKey`); each option's value by `label` (LABELS: a smoothed set's mean by default). → the table
export async function readTable (dirs, { inputs = INPUT_SETS.base(), weights = null, bins = 64, sample = 100000, seed = 1, log = null, label = 'mean' } = {}) {
  const L = layout()
  const cols = Int32Array.from(inputs.map((n) => {
    const i = L.names.indexOf(n)
    if (i < 0) throw new Error(`forest: unknown input "${n}"`)
    return i
  }))
  const D = cols.length
  const after = inputs.some((n) => n.startsWith('aft.'))
  // The first pass: the rows counted, a reservoir of them for the cuts.
  const S = Math.max(1, sample)
  const res = new Float64Array(S * D)
  const rand = mulberry(seed)
  let N = 0
  let P = 0
  for await (const { d } of decisionsOf(dirs, after, null, label)) {
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
  // The second pass: every row binned.
  const B = shared(Uint8Array, N * D)
  const v = new Float64Array(N)
  const pos = new Int32Array(N)
  const steps = new Int16Array(N)
  const lane = new Int8Array(N)
  const target = new Int32Array(N)
  const start = new Int32Array(P + 1)
  const meta = []
  const skipped = {}
  let r = 0
  let p = 0
  for await (const { row, d, k } of decisionsOf(dirs, after, skipped, label)) {
    start[p] = r
    for (const o of d.rows) {
      for (let j = 0; j < D; j++) B[j * N + r] = binOf(cuts[j], o.x[cols[j]])
      v[r] = o.value
      pos[r] = p
      steps[r] = o.steps
      lane[r] = o.lane
      target[r] = o.target
      r++
    }
    meta.push({ id: row.id, run: row.run, split: splitOf(row.run), group: row.group, floor: row.floor, danger: row.danger, wt: row.wt ?? 1, data: dirs[k], dw: weights?.[k] ?? 1, runKey: `${k}:${row.run}` })
    p++
  }
  start[p] = r
  if (r !== N || p !== P) throw new Error('forest: the labels changed between the passes')
  for (const [k, n] of Object.entries(skipped)) log?.(`  ${dirs[k]}: ${n} rows past its after.jsonl left out`)
  return { names: inputs.slice(), D, N, P, cuts, nb: Uint8Array.from(cuts, (c) => c.length + 1), bins: B, v, pos, steps, lane, target, start, meta, dirs: dirs.slice(), label }
}

// ── the trees ────────────────────────────────────────────────────────────────────────────────────

export const FIT = Object.freeze({ target: 'mean', trees: 200, depth: 12, leaves: 512, minLeaf: 40, mtry: 1 / 3, shrink: 0, minGain: 1e-6, clip: 10, weighted: false, wclip: 10, seed: 1, delta: 0.1 })
// The targets a forest is fitted to (see the head of this file).
export const TARGETS = Object.freeze(['mean', 'today'])

// Tree `t` of a forest grown on shared table `S` ({ bins (column by column), N, cols (the table's columns it reads), nb
// (each column's bins), y (the clipped target), w (each row's weight), run (each row's run, −1 for a row not fitted),
// nRuns }) by `cfg` (FIT's keys): its runs drawn with replacement (`count`, a run's draws), its rows those of the runs
// drawn, each weighing w × its run's draws; grown best first (the leaf whose split reduces the squared error the most
// split next) on `mtry` of the columns drawn at each split. Deterministic for the seed and t. → { feat (the column's
// place in `cols`, −1 a leaf), bin (left: the bin at most it), right (the right child's index), value (a leaf's), count }
// in preorder
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
  // In preorder: a node, its left subtree, its right.
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
export function leafOn (S, tree, r) {
  const { feat, bin, right, value } = tree
  let k = 0
  for (let f = feat[0]; f >= 0; f = feat[k]) k = S.bins[S.cols[f] * S.N + r] <= bin[k] ? k + 1 : right[k]
  return value[k]
}

// The trees `cfg.trees` of shared table `S` (growTree's), in worker threads (`workers` at a time; in this thread for 0
// or 1), each handed to `done(t, tree)` in the order they end. outforest.js grows its trees by it too.
export async function growTrees (S, cfg, workers, done) {
  if (!(workers > 1)) {
    for (let t = 0; t < cfg.trees; t++) done(t, growTree(S, cfg, t))
    return
  }
  const { Worker } = node('worker_threads')
  const queue = Array.from({ length: cfg.trees }, (_, t) => t)
  const one = async () => {
    const w = new Worker(new URL(import.meta.url), { workerData: { forest: 'fit', S, cfg } })
    try {
      while (queue.length) {
        const t = queue.shift()
        const tree = await new Promise((resolve, reject) => {
          const off = () => {
            w.off('message', ok)
            w.off('error', fail)
          }
          const ok = (msg) => {
            off()
            resolve(msg)
          }
          const fail = (err) => {
            off()
            reject(err)
          }
          w.on('message', ok)
          w.on('error', fail)
          w.postMessage(t)
        })
        done(t, tree)
      }
    } finally {
      await w.terminate()
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, cfg.trees) }, one))
}

// Fits a forest on table `t` (readTable's) by `cfg` (FIT's keys; `inputs`, the table's inputs it reads, all by default;
// `use`, the label sets it is fitted on, all by default), on `workers` threads: the positions not held out are fitted,
// each row weighing alike (or by its draw's `wt` clipped, `weighted`) × its label set's `dw`, normalised to a mean of
// 1; its target `cfg.target`'s (targetsOf). → { config (forest.json's shape), trees, oob (each fitted row's prediction
// by the trees whose draw left its run out; NaN for none), held (each held-out row's prediction by them all; NaN for the
// rest), fitted (the positions fitted), heldOut (the positions held out) }
export async function fitForest (t, cfg = {}, { log = () => {}, workers = 0 } = {}) {
  cfg = { ...FIT, ...cfg }
  if (!TARGETS.includes(cfg.target)) throw new Error(`forest: no target "${cfg.target}": ${TARGETS.join(', ')}`)
  const yt = targetsOf(t, cfg.target)
  const names = cfg.inputs ?? t.names
  const cols = Int32Array.from(names.map((n) => {
    const j = t.names.indexOf(n)
    if (j < 0) throw new Error(`forest: the table lacks input "${n}"`)
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
    const wp = (cfg.weighted ? Math.min(M.wt, cfg.wclip) : 1) * M.dw
    // (Today's choice's own row is no advantage over itself: fitted only to the centred target.)
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
  log(`fitting ${cfg.trees} trees to the ${cfg.target === 'mean' ? 'centred value' : 'advantage over today\'s choice'} on ${fitted.length} positions (${rows} rows, ${runs.size} runs), ${cols.length} inputs: depth ≤ ${cfg.depth}, leaves ≤ ${cfg.leaves}, ` +
    `min leaf ${cfg.minLeaf}, mtry ${+cfg.mtry.toFixed(3)}, shrink ${cfg.shrink}${cfg.weighted ? `, weighted (clip ${cfg.wclip})` : ''}`)
  const t0 = Date.now()
  const trees = new Array(cfg.trees)
  let made = 0
  await growTrees(S, cfg, workers, (k, tree) => {
    trees[k] = tree
    if (++made % Math.max(1, Math.round(cfg.trees / 5)) === 0) log(`  ${made}/${cfg.trees} trees, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  })
  // Out of bag, in the trees' order (each row of a fitted position by the trees whose draw left its run out); the
  // held-out rows by every tree.
  const sum = new Float64Array(t.N)
  const cnt = new Int32Array(t.N)
  const runOf = new Int32Array(t.N).fill(-1)
  const isHeld = Uint8Array.from(t.pos, (p) => +(t.meta[p].split === 'held'))
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
  const config = toConfig(trees, t, cols, cfg, { positions: fitted.length, rows, runs: runs.size, seconds: (Date.now() - t0) / 1000 })
  return { config, trees, oob, held, fitted, heldOut }
}

// Each row's target: its value less its position's mean (`mean`, the centred value), or less today's choice's
// (`today`, the advantage over it). → Float64Array
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
// Fitted trees as forest.json's configuration: the inputs the table's columns `cols` are, every split's threshold its
// bin's cut, every right child as nodes ahead.
function toConfig (trees, t, cols, cfg, fit) {
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
  const { target, trees: n, depth, leaves, minLeaf, mtry, shrink, weighted, wclip, clip, seed, delta } = cfg
  return {
    kind: 'forest',
    name: cfg.name ?? 'forest',
    about: `a random forest's advantage over today's choice (src/sim/forest.js), fitted on teach.js's labels to the battle's end (target ${target}); today's choice unless the best other candidate's exceeds delta`,
    made: { at: new Date().toISOString(), trees: n, depth, leaves, minLeaf, mtry: +mtry.toFixed(4), shrink, weighted, wclip, clip, seed, bins: Math.max(...t.nb), label: t.label ?? 'mean', ...fit, seconds: +fit.seconds.toFixed(1) },
    data: cfg.data ?? t.dirs,
    inputs: Array.from(cols, (j) => t.names[j]),
    target,
    delta,
    size: trees.map((x) => x.feat.length),
    feat,
    thr,
    right,
    value
  }
}

// ── measuring ────────────────────────────────────────────────────────────────────────────────────

// The better of two table rows by predictions `P`: the higher; ties as policy.js better (the fewer steps, the lower lane,
// the lower target uid).
const aheadRow = (t, P, r, b) => {
  if (Math.abs(P[r] - P[b]) > EPS) return P[r] > P[b]
  if (t.steps[r] !== t.steps[b]) return t.steps[r] < t.steps[b]
  if (t.lane[r] !== t.lane[b]) return t.lane[r] < t.lane[b]
  return t.target[r] < t.target[b]
}

// How predictions `P` (a table row each; NaN unread) of a forest of target `target` decide positions `list` at margin
// `delta`, as play would: each other option's advantage over today's choice read (P, less today's choice's own P for
// the centred target), the best taken where it exceeds delta, else today's choice. → { n, changed (the share it
// changed), gain (the mean advantage realised by the playouts: the option's value less today's, 0 where unchanged),
// wgain (the same by the draw's weight: as play meets the decisions), up and down (the shares changed for a better and
// for a worse playout), oracle (the mean best advantage: the teacher's), woracle }
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
export const DELTAS = Object.freeze([0, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 1])
// A table of predictions `P` over positions `list`, a line a margin: the decisions changed, the advantage realised (per
// position, and by the draw's weight), the changes that gained and lost.
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

// Forests `configs` read on label sets `dirs` as play reads them (each option's raw inputs, encodeAgainst; no bins): the
// held-out positions' margins table of each at its own delta and at DELTAS. → { [name]: text }
export async function evalForests (dirs, configs, { log = null } = {}) {
  const after = configs.some((c) => readsAfter(c))
  const P = configs.map(() => [])
  const t = { v: [], steps: [], lane: [], target: [], start: [0], meta: [] }
  for await (const { row, d } of decisionsOf(dirs, after)) {
    if (splitOf(row.run) !== 'held') continue
    for (const o of d.rows) {
      configs.forEach((c, i) => P[i].push(predict(c, o.x)))
      t.v.push(o.value)
      t.steps.push(o.steps)
      t.lane.push(o.lane)
      t.target.push(o.target)
    }
    t.start.push(t.v.length)
    t.meta.push({ wt: row.wt ?? 1 })
  }
  const list = t.meta.map((_, p) => p)
  const out = {}
  configs.forEach((c, i) => {
    out[c.name] = marginText(t, list, P[i], [...new Set([c.delta, ...DELTAS])].sort((a, b) => a - b), c.target ?? 'today')
    log?.(`\n${c.name} (delta ${c.delta}), held out (seeds ≡ 0 mod 5):\n${out[c.name]}`)
  })
  return out
}

// ── the command ──────────────────────────────────────────────────────────────────────────────────

// npm run forest -- --data <dir>[,<dir>…] --out <file> [--inputs base|aft] [--data-weight 1,0.5,…] [--use <dir>,…]
//                   [--target mean|today] [--trees 200] [--depth 12] [--leaves 512] [--min-leaf 40] [--mtry 0.333]
//                   [--shrink 0] [--bins 64] [--weighted] [--wclip 10] [--seed 1] [--delta 0.1] [--name forest]
//                   [--label mean|exact] [--workers 7]
//   fits a forest and writes it (src/sim/forest.json is the one play reads: write it only for a forest kept on a paired
//   gain), printing its out-of-bag and held-out margins tables (marginText). `--inputs aft`: with the afterstate's
//   (each label set augmented: teach.js --augment); `--data-weight`: each label set's weight, in --data's order;
//   `--use`: the label sets fitted on (all by default; the rest only read for the bins); `--label exact`: a smoothed
//   set's exact lines in place of its means (LABELS).
// npm run forest -- --data <dir>[,<dir>…] --eval <file>[,<file>…]   the held-out tables of forests fitted already, read
//   as play reads them.
async function main () {
  const argv = process.argv.slice(2)
  const arg = (name, def) => {
    const i = argv.indexOf('--' + name)
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def
  }
  const list = (k) => (arg(k, '') || '').split(',').filter(Boolean)
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
  const num = (k) => (arg(k, null) === null ? undefined : Number(arg(k)))
  const cfg = Object.fromEntries(Object.entries({
    target: arg('target', undefined), trees: num('trees'), depth: num('depth'), leaves: num('leaves'), minLeaf: num('min-leaf'), mtry: num('mtry'), shrink: num('shrink'), wclip: num('wclip'), seed: num('seed'), delta: num('delta'),
    name: arg('name', undefined)
  }).filter(([, v]) => v !== undefined))
  if (argv.includes('--weighted')) cfg.weighted = true
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
} else if (typeof process !== 'undefined' && process.argv[1] === decodeURIComponent(new URL(import.meta.url).pathname)) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
