// The forest out of battle (redesign.md §2.25): the expert's recruit and its purchases (tiers and fusions) decided as
// the battle forest decides a piece's move (forest.js, §2.24): today's pick (autoplay.js weighRecruits, grow) unless a
// random forest of regression trees, fitted offline on outside.js's labels (each candidate of a decision played out on a
// copy of the run by the expert to the run's end, valued by teach.js routeEndValue), reads another candidate more than
// its margin above it. No network, and nothing played in play: a decision is a read of the run (autoplay.js outsideRead)
// and a few thousand comparisons. This file is the contract between the labeller (outside.js --label, which writes the
// reads beside the values) and the player (autoplay.js pickReap and pickSpend, which consult the forest in use):
//
//   useOutForest(config)   installs a configuration (outforest.json's contents); null: none, today's expert;
//                          undefined: back to outforest.json beside this file, where there is one. → the one in use
//   outForestModel()       → the forest in use, or null for none
//   outDecides(phase)      → whether the forest in use decides `phase` ('recruit' or 'spend')
//
// With none in use (no outforest.json, or useOutForest(null)), or for a phase the configuration has no forest of, the
// expert is today's, move for move.
//
// In play: a decision's candidates (autoplay.js recruitCandidates, spendCandidates: today's pick first, then the rest by
// today's own score of them, at most OUT_CAP: the labels' own) are read (outsideRead: the run's situation, and each
// candidate's features from the run it would leave), and the phase's forest predicts each one's centred value R; the
// best other candidate by R − R(today's) (ties to the earlier in the list) is taken where that exceeds the phase's margin
// `delta`, else today's (chooseOut). A forest whose advantages never exceed delta (every tree a single leaf, or of target
// 'today' every leaf at most delta) is today's expert, move for move.
//
// The inputs, x (outInputNames), read alike from a label row and in play (encodeOut, from outsideRead's `sit` and `f`; a
// test holds the reads equal):
//   s.*   the situation (SIT_KEYS): where the run stands, the purse in tier prices, the Monarch and the souls, the field's
//         answers to the threats it may meet, and the coming battles: the next battle room on the route the expert would
//         walk (n1), the next three (n3) and the floor's battle rooms still ahead (fl), each as scouting shows them (the
//         foes' threat and the army's odds against it, their HP, DEF and blows, the share of them of each threat type,
//         the waves, and the threats ahead the field has no answer to)
//   f.*   the candidate (CAND_KEYS): its kind (stopping, a tier, a fusion, a recruit), today's score of it and its price,
//         the kind it touches (role, flying, ranged, reach, tier, level, stats, worth, how many stand and are fielded,
//         whether the combo target is built of it), a tier's track and number and what it grants, a fusion's parts and
//         gain, a recruit's newness and the soul it lets go, how well the kind answers the threats ahead (fit.*), and
//         what it changes in the field's read (d.*: strength, the book, the target, its answers, its synergies, the
//         threats ahead left unanswered)
//   vs.*  each candidate feature less today's pick's: the target is an advantage over that one candidate
//   gap   today's score of today's pick less the candidate's
// Each number rounded to 6 decimals in the read itself, so a row's inputs and play's are the same numbers.
//
// The target (a row a candidate of a decision): its playout's value less the mean of its decision's candidates'
// (`target` 'mean', the centred value R, as the battle forest's) or less today's pick's (`target` 'today'), clipped.
// Bagged by whole runs (a run's decisions are correlated, and their playouts chaotic), out-of-bag estimates; seeds ≡ 0
// mod 5 held out, never fitted (ranker.js splitOf).
//
// Shipped as outforest.json: { kind: 'outforest', name, about, made, data, phases: { recruit?, spend? } }, each phase's
// forest { inputs, target, delta, size, feat, thr, right, value, made } in forest.json's shape (forest.js compileTrees
// reads both). Read Node-only, like forest.json.
//
//   npm run outforest -- --data <dir>[,<dir>…] --out <file> [--phases recruit,spend] [--delta 1] [--delta-recruit x]
//                        [--delta-spend y] [--target mean|today] [--trees 200] [--depth 10] [--leaves 256]
//                        [--min-leaf 20] [--mtry 0.333] [--bins 64] [--weighted] [--seed 1] [--name outforest] [--workers 7]
//   fits a forest a phase on outside.js --label's labels (labels.jsonl in each dir) and writes them as one configuration,
//   printing each phase's out-of-bag and held-out tables (the decisions changed, the value realised, the teacher's).
//   npm run outforest -- --data <dir>[,<dir>…] --eval <file>   the held-out tables of a configuration fitted already.
//   npm run outforest -- --data <dir>[,<dir>…] --stats          what the labels hold (decisions, candidates, how often
//                                                                another than the base's pick played out the better).
//
// Round 1 (2026-10-13; labels R1: 120 runs `outl-0…119` of the shipped expert, the battle forest's round 3 and the
// learned route; 3,887 recruit decisions of 4.5 candidates and 6,217 purchases of 5.3, every candidate played out to the
// run's end, in 3.2 h on eight workers (an M2's four performance and four efficiency cores: ~33 runs, ~3,000 decisions
// and ~15,000 candidates an hour; a recruit 16 s, a purchase 5, most of a purchase's candidates meeting a fight already
// played). Another candidate's playout beat the base's at 52% of the recruits (by 10.5 where it did; at 18.8% one cleared
// where the base's line lost) and at 45% of the purchases (by 6.8; 12.2%). Fitted a phase apart, 200 trees each: the
// recruit's depth ≤ 6, ≤ 64 leaves of ≥ 50 rows, mtry 1/3; the purchase's depth ≤ 8, ≤ 64 leaves of ≥ 100 rows, mtry
// 1/2. Out of bag at delta 1 the recruit's forest changes 31% of the recruits for +1.26 a decision (held out 36%, +1.04;
// the teacher's +5.5), most of them a recruit where today's takes none (today's declines three offers in four: its
// sketch counts the field's best few, not the souls behind them); the purchase's +0.16 at delta 0, −0.07 at 0.5, −0.15
// at 1 (held out +0.46, +0.24, +0.12). Paired against the shipped expert on 256 seeds `sel7`:
//   the recruit's forest alone, delta 1                           +18.21 ± 2.43 progress  (clears 62.5% against 37.1%, +93 −28)
//   the recruit's forest alone, delta 2                           +16.31 ± 2.19           (clears 64.1%, +89 −20)
//   the recruit's forest alone, delta 0.5                         +19.56 ± 2.42           (clears 68.8%, +103 −22)
//   the recruit's at delta 1 and the purchase's at delta 0.5      +19.83 ± 2.48           (clears 66.8%, +101 −25)
// The third, on 768 fresh seeds `chk7`: clears 69.1% against the shipped expert's 40.8% (+293 −75), progress +18.33 ±
// 1.46, battles won 99.3% against 98.2%, deaths on floors 2 and 3 14 against 220. 6.85 s a run against 4.69, for its
// runs go further (42.8 battles a run against 33.7, more of them on floor 4: 0.160 s a battle against 0.139); the read
// and the trees cost nothing a timing sees (a configuration whose margin is never passed, every read made, plays the
// shipped expert's moves at 4.02 s a run against 4.61 on 64 seeds). Kept as outforest.json: the recruit's forest alone,
// delta 0.5 (200 trees, 14,084 nodes, 0.19 MB); the purchases today's.
import { compileTrees, treesMean, cutsOf, binOf, growTree, growTrees, leafOn, shared, TARGETS } from './forest.js'
import { splitOf } from './ranker.js'
import { mulberry } from './value.js'

const node = (name) => globalThis.process?.getBuiltinModule?.(`node:${name}`)
const r6 = (x) => Math.round(x * 1e6) / 1e6
const EPS = 1e-9

// ── the vocabulary ───────────────────────────────────────────────────────────────────────────────

// The decisions a forest out of battle may make.
export const OUT_PHASES = Object.freeze(['recruit', 'spend'])
// The threat types the coming rooms are read by (content.js THREATS, a foe kind's own: depth is a room's, read as its
// waves).
export const OUT_THREATS = Object.freeze(['reach', 'shape', 'drain', 'sustain', 'fly', 'burn', 'bleed'])
// The roles a kind is read by (content.js ROLE_LIST, the Monarch's aside).
export const OUT_ROLES = Object.freeze(['vanguard', 'skirmisher', 'ranger', 'channeler', 'warden', 'trickster'])
// The sets of coming battle rooms: the next on the route (n1), the next three (n3), the floor's still ahead (fl).
export const OUT_ROOMS = Object.freeze(['n1', 'n3', 'fl'])
// What the field's read holds (autoplay.js fieldRead): its strength (a log), the book's worth of its target and how far
// along it is, its souls answering flyers, shooters' Reach and the hexes and wounds (a heal or a cleanse), its shooters,
// its melee, its flyers, its menders, its blows' raw and its toughness (logs), its synergies and the nearest one's share,
// its summons, its mean level, the most souls of one kin and of one role.
export const FIELD_KEYS = Object.freeze(['strength', 'book', 'progress', 'fly', 'reach', 'tend', 'ranged', 'melee', 'flyers', 'healers', 'dps', 'tough', 'syn', 'near', 'summons', 'lvl', 'kin', 'role'])
const ROOM_KEYS = ['rooms', 'threat', 'odds', 'foes', 'hp', 'def', 'raw', 'waves', 'gap', ...OUT_THREATS.map((t) => `t.${t}`)]
export const SIT_KEYS = Object.freeze([
  'phase.map', 'phase.prep', 'phase.reap', 'floor', 'rank', 'purse', 'purse.tier', 'purse.recruit', 'monarch', 'monarch.hp', 'health', 'fallen', 'souls', 'room',
  'command', 'waiting', 'relics', 'unheld', 'cands', 'shop', 'altar', ...FIELD_KEYS, ...OUT_ROOMS.flatMap((r) => ROOM_KEYS.map((k) => `${r}.${k}`)), 'n1.elite', 'n1.boss', 'n1.siege'
])
export const CAND_KEYS = Object.freeze([
  'none', 'tier', 'fuse', 'recruit', 'score', 'cost',
  ...OUT_ROLES.map((r) => `k.${r}`), 'k.flies', 'k.ranged', 'k.melee', 'k.tends', 'k.aura', 'k.reach', 'k.tier', 'k.lvl', 'k.hp', 'k.atk', 'k.def', 'k.move', 'k.worth', 'k.size',
  'k.count', 'k.fielded', 'k.target',
  't.track', 't.no', 't.mods', 't.ability', 't.aura', 't.summon', 't.size', 't.double',
  'u.parts', 'u.worth', 'u.gain', 'u.fielded',
  'r.new', 'r.release', 'r.released', 'r.kept',
  ...OUT_ROOMS.map((r) => `fit.${r}`),
  ...['strength', 'book', 'progress', 'target', 'fly', 'reach', 'tend', 'ranged', 'melee', 'flyers', 'healers', 'dps', 'tough', 'syn', 'near', 'summons', 'lvl', 'souls', 'purse'].map((k) => `d.${k}`),
  ...OUT_ROOMS.map((r) => `d.gap.${r}`)
])
// An object of `keys`, each 0: the read fills it (put).
export const zeros = (keys) => Object.fromEntries(keys.map((k) => [k, 0]))
// Sets read `o`'s `key` (one it was made with: zeros) to `v`, rounded as the rows write it (a flag 0 or 1, anything not
// finite 0).
export function put (o, key, v) {
  if (!(key in o)) throw new Error(`outforest: no read "${key}"`)
  o[key] = typeof v === 'boolean' ? +v : Number.isFinite(v) ? r6(v) : 0
}

// The inputs by name, in encodeOut's layout.
let NAMES = null
export const outInputNames = () => (NAMES ??= Object.freeze([...SIT_KEYS.map((k) => `s.${k}`), ...CAND_KEYS.map((k) => `f.${k}`), ...CAND_KEYS.map((k) => `vs.${k}`), 'gap']))
const S0 = 0
const F0 = SIT_KEYS.length
const V0 = F0 + CAND_KEYS.length
const G0 = V0 + CAND_KEYS.length
export const OUT_D = G0 + 1

// The inputs of candidate `f` (its read: outsideRead's `f[i]`) of a decision read as `sit`, against today's pick
// `today` (its read), in outInputNames' layout. → out
export function encodeOut (sit, f, today, out = new Float64Array(OUT_D)) {
  for (let j = 0; j < SIT_KEYS.length; j++) out[S0 + j] = sit[SIT_KEYS[j]] ?? 0
  for (let j = 0; j < CAND_KEYS.length; j++) {
    const k = CAND_KEYS[j]
    const v = f[k] ?? 0
    out[F0 + j] = v
    out[V0 + j] = r6(v - (today[k] ?? 0))
  }
  out[G0] = r6((today.score ?? 0) - (f.score ?? 0))
  return out
}

// ── the forest in use ────────────────────────────────────────────────────────────────────────────

function readJSON () {
  try {
    const fs = node('fs')
    const url = new URL('./outforest.json', import.meta.url)
    return fs && fs.existsSync(url) ? JSON.parse(fs.readFileSync(url, 'utf8')) : null
  } catch {
    return null
  }
}
let SHIPPED
let INSTALLED = false
let MODEL = null

export function outForestModel () {
  if (INSTALLED) return MODEL
  if (SHIPPED === undefined) {
    const json = readJSON()
    SHIPPED = json ? checkOutForest(json) : null
  }
  return SHIPPED
}

export function useOutForest (config) {
  INSTALLED = config !== undefined
  MODEL = config ? checkOutForest(config) : null
  return outForestModel()
}

export const outDecides = (phase) => !!outForestModel()?.phases?.[phase]

// A configuration checked: a forest only for the phases it may decide, each of inputs the code reads, its trees' arrays
// agreeing, its margin finite. → the configuration
export function checkOutForest (config) {
  if (config?.kind !== 'outforest' || typeof config.phases !== 'object' || config.phases === null) throw new Error('outforest: no phases')
  const known = new Set(outInputNames())
  for (const [phase, m] of Object.entries(config.phases)) {
    if (!OUT_PHASES.includes(phase)) throw new Error(`outforest: no phase "${phase}": ${OUT_PHASES.join(', ')}`)
    const { inputs, size, feat, thr, right, value } = m ?? {}
    if (!Array.isArray(inputs) || !Array.isArray(size) || !Array.isArray(feat)) throw new Error(`outforest: ${phase} has no inputs or no trees`)
    for (const n of inputs) if (!known.has(n)) throw new Error(`outforest: unknown input "${n}"`)
    if (!Number.isFinite(m.delta)) throw new Error(`outforest: ${phase} has no margin (delta)`)
    if (!TARGETS.includes(m.target)) throw new Error(`outforest: ${phase} has no target "${m.target}"`)
    let inner = 0
    for (const f of feat) {
      if (f >= inputs.length || f < -1) throw new Error(`outforest: ${phase} splits on an input it does not name`)
      if (f >= 0) inner++
    }
    if (size.reduce((a, b) => a + b, 0) !== feat.length || thr?.length !== inner || right?.length !== inner || value?.length !== feat.length - inner) throw new Error(`outforest: ${phase}'s trees' arrays do not agree`)
  }
  return config
}

// A phase's forest made ready for play, once: its trees compiled to encodeOut's layout.
const RUNTIMES = new WeakMap()
function runtimeOf (m) {
  let rt = RUNTIMES.get(m)
  if (!rt) {
    const names = outInputNames()
    rt = { ...compileTrees(m, m.inputs.map((n) => names.indexOf(n))), x: new Float64Array(OUT_D) }
    RUNTIMES.set(m, rt)
  }
  return rt
}
// A phase's forest `m`'s mean leaf for inputs `x` (encodeOut's).
export const predictOut = (m, x) => treesMean(runtimeOf(m), x)

// The candidate forest `model` takes at decision `read` of `phase` (outsideRead's: `f[0]` today's pick's): each
// candidate's R (the trees' mean), its advantage over today's R less today's own (target 'mean') or R itself (target
// 'today'); the best other by it, the earlier where equal, where it exceeds the phase's delta, else today's. →
// { index (into read.f, 0 today's), margin (the advantage it was taken by; 0 for today's) }
export function chooseOut (model, phase, read) {
  const m = model?.phases?.[phase]
  if (!m || read.f.length < 2) return { index: 0, margin: 0 }
  const rt = runtimeOf(m)
  const today = read.f[0]
  const base = m.target === 'mean' ? treesMean(rt, encodeOut(read.sit, today, today, rt.x)) : 0
  let best = 0
  let top = -Infinity
  for (let i = 1; i < read.f.length; i++) {
    const a = treesMean(rt, encodeOut(read.sit, read.f[i], today, rt.x)) - base
    if (a > top + EPS) {
      top = a
      best = i
    }
  }
  return top > m.delta ? { index: best, margin: r6(top) } : { index: 0, margin: 0 }
}

// ── the labels ───────────────────────────────────────────────────────────────────────────────────

// The label files of `dirs` (a directory of outside.js --label's, or its labels.jsonl).
function labelsOf (dir) {
  const fs = node('fs')
  const path = node('path')
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? path.join(dir, 'labels.jsonl') : dir
}
async function * linesOf (file) {
  const fs = node('fs')
  const readline = node('readline')
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) if (line.trim()) yield line
}

// One label row (outside.js --label: a decision and its candidates) as the forest reads it: its candidates with a value,
// today's pick (`today`, the row's) first, each one's inputs against it (encodeOut; today's own vs.* and gap 0) and
// value. Fewer than two such candidates, or no today's pick among them: null. → { rows: [{ x, value, base }] }
export function readOutDecision (row) {
  const opts = row.options.filter((o) => Number.isFinite(o.value))
  const today = opts.find((o) => o.today)
  if (opts.length < 2 || !today) return null
  const order = [today, ...opts.filter((o) => o !== today)]
  return { rows: order.map((o) => ({ x: encodeOut(row.sit, o.f, today.f), value: o.value, base: !!o.base })) }
}

// The decisions of `phase` in label sets `dirs`, streamed: each { row, d (readOutDecision's), k (its set's index) }.
async function * decisionsOf (dirs, phase) {
  for (const [k, dir] of dirs.entries()) {
    for await (const line of linesOf(labelsOf(dir))) {
      const row = JSON.parse(line)
      if (row.phase !== phase) continue
      const d = readOutDecision(row)
      if (d) yield { row, d, k }
    }
  }
}

// The decisions of `phase` of label sets `dirs` read into one table for fitting (forest.js readTable's shape): a row a
// candidate (today's pick first), its inputs cut into at most `bins` bins (cutsOf, on a reservoir of `sample` rows) and
// stored by column (shared memory, for the workers); per row its value; per decision its first row, run, split, draw
// weight, and the key of its run. → the table
export async function readOutTable (dirs, phase, { bins = 64, sample = 100000, seed = 1 } = {}) {
  const D = OUT_D
  const S = Math.max(1, sample)
  const res = new Float64Array(S * D)
  const rand = mulberry(seed)
  let N = 0
  let P = 0
  for await (const { d } of decisionsOf(dirs, phase)) {
    P++
    for (const r of d.rows) {
      const k = N < S ? N : Math.floor(rand() * (N + 1))
      if (k < S) res.set(r.x, k * D)
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
  const base = new Uint8Array(N)
  const start = new Int32Array(P + 1)
  const meta = []
  let r = 0
  let p = 0
  for await (const { row, d, k } of decisionsOf(dirs, phase)) {
    start[p] = r
    for (const o of d.rows) {
      for (let j = 0; j < D; j++) B[j * N + r] = binOf(cuts[j], o.x[j])
      v[r] = o.value
      base[r] = +o.base
      r++
    }
    meta.push({ seed: row.seed, run: row.run, split: splitOf(row.run), floor: row.floor, wt: row.wt ?? 1, runKey: `${k}:${row.run}` })
    p++
  }
  start[p] = r
  if (r !== N || p !== P) throw new Error('outforest: the labels changed between the passes')
  return { phase, names: outInputNames().slice(), D, N, P, cuts, nb: Uint8Array.from(cuts, (c) => c.length + 1), bins: B, v, base, start, meta, dirs: dirs.slice() }
}

// ── the trees ────────────────────────────────────────────────────────────────────────────────────

export const OUT_FIT = Object.freeze({ target: 'mean', trees: 200, depth: 10, leaves: 256, minLeaf: 20, mtry: 1 / 3, shrink: 0, minGain: 1e-6, clip: 30, weighted: false, wclip: 10, seed: 1, delta: 1 })

// Each row's target: its value less its decision's mean (`mean`) or less today's pick's (`today`).
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

// Fits a phase's forest on table `t` (readOutTable's) by `cfg` (OUT_FIT's keys), on `workers` threads (forest.js
// growTrees): the decisions not held out fitted, each row weighing alike (or by its draw's `wt` clipped, `weighted`),
// bagged by run. → { config (a phase's forest), oob (each fitted row's prediction by the trees whose draw left its run
// out), held (each held-out row's by them all), fitted, heldOut }
export async function fitOutForest (t, cfg = {}, { log = () => {}, workers = 0 } = {}) {
  cfg = { ...OUT_FIT, ...cfg }
  if (!TARGETS.includes(cfg.target)) throw new Error(`outforest: no target "${cfg.target}": ${TARGETS.join(', ')}`)
  const yt = targetsOf(t, cfg.target)
  const cols = Int32Array.from({ length: t.D }, (_, j) => j)
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
    const wp = cfg.weighted ? Math.min(M.wt, cfg.wclip) : 1
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
  log(`fitting ${cfg.trees} trees (${t.phase}) to the ${cfg.target === 'mean' ? 'centred value' : 'advantage over today\'s pick'} on ${fitted.length} decisions (${rows} rows, ${runs.size} runs), ${t.D} inputs: ` +
    `depth ≤ ${cfg.depth}, leaves ≤ ${cfg.leaves}, min leaf ${cfg.minLeaf}, mtry ${+cfg.mtry.toFixed(3)}${cfg.weighted ? `, weighted (clip ${cfg.wclip})` : ''}`)
  const t0 = Date.now()
  const trees = new Array(cfg.trees)
  if (workers > 1) await growTrees(S, cfg, workers, (k, tree) => { trees[k] = tree })
  else for (let k = 0; k < cfg.trees; k++) trees[k] = growTree(S, cfg, k)
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
  const config = toConfig(trees, t, cfg, { decisions: fitted.length, rows, runs: runs.size, seconds: +((Date.now() - t0) / 1000).toFixed(1) })
  return { config, oob, held, fitted, heldOut }
}

const round = (v, p = 5) => +v.toPrecision(p)
// Fitted trees as a phase's forest: every split's threshold its bin's cut, every right child as nodes ahead.
function toConfig (trees, t, cfg, fit) {
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
        thr.push(t.cuts[c][tree.bin[i]])
        right.push(tree.right[i] - i)
      }
    }
  }
  const { target, trees: n, depth, leaves, minLeaf, mtry, shrink, weighted, wclip, clip, seed, delta } = cfg
  return {
    inputs: t.names.slice(), target, delta, size: trees.map((x) => x.feat.length), feat, thr, right, value,
    made: { at: new Date().toISOString(), trees: n, depth, leaves, minLeaf, mtry: +mtry.toFixed(4), shrink, weighted, wclip, clip, seed, bins: Math.max(...t.nb), data: t.dirs, ...fit }
  }
}

// ── measuring ────────────────────────────────────────────────────────────────────────────────────

// How predictions `P` (a table row each; NaN unread) decide decisions `list` at margin `delta`, as play would: each
// other candidate's advantage over today's pick (P less today's own P for the centred target), the best taken where it
// exceeds delta, else today's. → { n, changed (the share changed), gain (the mean value realised over today's pick by
// the playouts, 0 where unchanged), up, down (the shares changed for a better and a worse playout), oracle (the mean
// best value over today's: the teacher's), base (the mean value of the base's pick, the run's own, over today's) }
export function decidedOut (t, list, P, delta, target = 'mean') {
  let n = 0
  let changed = 0
  let gain = 0
  let up = 0
  let down = 0
  let oracle = 0
  for (const p of list) {
    const a = t.start[p]
    const z = t.start[p + 1]
    if (z - a < 2 || Number.isNaN(P[a + 1])) continue
    const ref = target === 'mean' ? P[a] : 0
    let b = a + 1
    let top = 0
    for (let r = a + 1; r < z; r++) {
      if (P[r] > P[b] + EPS) b = r
      top = Math.max(top, t.v[r] - t.v[a])
    }
    n++
    oracle += top
    if (!(P[b] - ref > delta)) continue
    const y = t.v[b] - t.v[a]
    changed++
    gain += y
    if (y > EPS) up++
    else if (y < -EPS) down++
  }
  const by = (x) => (n ? x / n : 0)
  return { n, changed: by(changed), gain: by(gain), up: by(up), down: by(down), oracle: by(oracle) }
}

export const OUT_DELTAS = Object.freeze([0, 0.25, 0.5, 1, 2, 3, 5, 10])
// A margins table of predictions `P` over decisions `list`, a line a margin.
export function outMarginText (t, list, P, deltas = OUT_DELTAS, target = 'mean') {
  const pct = (x) => `${(100 * x).toFixed(1)}%`.padStart(7)
  const out = [`${'delta'.padStart(6)} ${'n'.padStart(7)} ${'changed'.padStart(8)} ${'gain'.padStart(8)} ${'better'.padStart(7)} ${'worse'.padStart(7)}`]
  let last = null
  for (const d of deltas) {
    const r = decidedOut(t, list, P, d, target)
    last = r
    out.push(`${String(d).padStart(6)} ${String(r.n).padStart(7)} ${pct(r.changed).padStart(8)} ${r.gain.toFixed(4).padStart(8)} ${pct(r.up)} ${pct(r.down)}`)
  }
  if (last) out.push(`(the teacher: gain ${last.oracle.toFixed(4)} a decision)`)
  return out.join('\n')
}

// What label sets `dirs` hold, by phase: decisions, candidates a decision, the share where another candidate than the
// base's pick played out the better (by more than 1e-9) and by how much on the mean, the share where some candidate
// cleared and the base's did not, and the decisions by floor. → { [phase]: { … } }
export async function outLabelStats (dirs) {
  const out = {}
  for (const phase of OUT_PHASES) {
    const st = { decisions: 0, candidates: 0, beaten: 0, beatenBy: 0, cleared: 0, runs: new Set(), floors: {} }
    for (const [, dir] of dirs.entries()) {
      for await (const line of linesOf(labelsOf(dir))) {
        const row = JSON.parse(line)
        if (row.phase !== phase) continue
        const opts = row.options.filter((o) => Number.isFinite(o.value))
        const base = opts.find((o) => o.base)
        if (!base || opts.length < 2) continue
        st.decisions++
        st.candidates += opts.length
        st.runs.add(row.seed)
        st.floors[row.floor] = (st.floors[row.floor] ?? 0) + 1
        const top = Math.max(...opts.filter((o) => o !== base).map((o) => o.value))
        if (top > base.value + EPS) {
          st.beaten++
          st.beatenBy += top - base.value
        }
        if (!base.won && opts.some((o) => o.won)) st.cleared++
      }
    }
    const d = Math.max(1, st.decisions)
    out[phase] = { decisions: st.decisions, runs: st.runs.size, candidates: +(st.candidates / d).toFixed(2), beaten: +(st.beaten / d).toFixed(4), beatenBy: +(st.beatenBy / Math.max(1, st.beaten)).toFixed(4), cleared: +(st.cleared / d).toFixed(4), floors: st.floors }
  }
  return out
}

// A configuration's held-out tables on label sets `dirs`, read as play reads them (each candidate's inputs: encodeOut,
// no bins). → { [phase]: text }
export async function evalOutForest (dirs, config, { log = null } = {}) {
  const out = {}
  for (const [phase, m] of Object.entries(config.phases)) {
    const t = { v: [], start: [0], meta: [] }
    const P = []
    for await (const { row, d } of decisionsOf(dirs, phase)) {
      if (splitOf(row.run) !== 'held') continue
      for (const o of d.rows) {
        P.push(predictOut(m, o.x))
        t.v.push(o.value)
      }
      t.start.push(t.v.length)
      t.meta.push({ wt: row.wt ?? 1 })
    }
    const list = t.meta.map((_, p) => p)
    out[phase] = outMarginText(t, list, P, [...new Set([m.delta, ...OUT_DELTAS])].sort((a, b) => a - b), m.target)
    log?.(`\n${phase} (delta ${m.delta}), held out (seeds ≡ 0 mod 5):\n${out[phase]}`)
  }
  return out
}

// ── the command ──────────────────────────────────────────────────────────────────────────────────

async function main () {
  const argv = process.argv.slice(2)
  const arg = (name, def) => {
    const i = argv.indexOf('--' + name)
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def
  }
  const list = (k) => (arg(k, '') || '').split(',').filter(Boolean)
  const dirs = list('data')
  if (!dirs.length) throw new Error('outforest: --data <dir>[,<dir>…] of outside.js --label labels')
  const fs = node('fs')
  const os = node('os')
  const t0 = Date.now()
  if (argv.includes('--stats')) {
    console.log(JSON.stringify(await outLabelStats(dirs), null, 1))
    return
  }
  if (arg('eval', null)) {
    await evalOutForest(dirs, checkOutForest(JSON.parse(fs.readFileSync(arg('eval'), 'utf8'))), { log: console.log })
    return
  }
  const phases = list('phases').length ? list('phases') : OUT_PHASES.slice()
  for (const p of phases) if (!OUT_PHASES.includes(p)) throw new Error(`outforest: no phase "${p}"`)
  const num = (k) => (arg(k, null) === null ? undefined : Number(arg(k)))
  const base = Object.fromEntries(Object.entries({
    target: arg('target', undefined), trees: num('trees'), depth: num('depth'), leaves: num('leaves'), minLeaf: num('min-leaf'), mtry: num('mtry'), shrink: num('shrink'),
    wclip: num('wclip'), seed: num('seed'), delta: num('delta')
  }).filter(([, v]) => v !== undefined))
  if (argv.includes('--weighted')) base.weighted = true
  const workers = Number(arg('workers', Math.max(1, os.availableParallelism() - 1)))
  const bins = Number(arg('bins', 64))
  const config = { kind: 'outforest', name: arg('name', 'outforest'), about: 'random forests over the expert\'s recruit and purchases (src/sim/outforest.js), fitted on outside.js --label\'s playouts to the run\'s end; today\'s pick unless another\'s predicted advantage exceeds delta', made: new Date().toISOString(), data: dirs, phases: {} }
  for (const phase of phases) {
    const t = await readOutTable(dirs, phase, { bins })
    console.log(`\n${phase}: ${t.P} decisions, ${t.N} rows, ${t.D} inputs (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
    const cfg = { ...base, ...(num(`delta-${phase}`) !== undefined && { delta: num(`delta-${phase}`) }) }
    const r = await fitOutForest(t, cfg, { log: console.log, workers })
    console.log(`out of bag (the decisions fitted, each by the trees whose draw left its run out):\n${outMarginText(t, r.fitted, r.oob, OUT_DELTAS, r.config.target)}`)
    console.log(`held out (seeds ≡ 0 mod 5):\n${outMarginText(t, r.heldOut, r.held, OUT_DELTAS, r.config.target)}`)
    config.phases[phase] = r.config
  }
  const out = arg('out', null)
  if (out) {
    const text = JSON.stringify(checkOutForest(config)) + '\n'
    fs.writeFileSync(out, text)
    console.log(`\nwrote ${out}: ${Object.entries(config.phases).map(([p, m]) => `${p} ${m.size.length} trees, ${m.feat.length} nodes, delta ${m.delta}`).join('; ')}, ${(text.length / 1e6).toFixed(2)} MB (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
  }
}

if (typeof process !== 'undefined' && process.argv[1] === decodeURIComponent(new URL(import.meta.url).pathname)) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
