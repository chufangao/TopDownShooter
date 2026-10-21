// The forests out of battle: the expert's recruit and purchases (tiers and fusions) are today's pick unless the phase's
// random forest, fitted offline on outside.js --label's playouts, reads another candidate more than its margin above it.
// Consulted in play by player.js (pickReap, pickSpend); fitted by `npm run outforest`. (The formation is the solver's:
// solver.js bestFormation.)
//
//   useOutForest(config)   installs a configuration; null: none, today's expert; undefined: back to the shipped one
//                          (src/sim/outforest.json). → the one in use
//   outForestModel()       → the forest in use, or null for none
//   outDecides(phase)      → whether the forest in use decides `phase` ('recruit' or 'spend')
// With none in use, or for a phase it has no forest of, the expert is today's, move for move.
//
// The inputs (layoutOf), read alike from a label row and in play (encodeOut), each rounded to 6 decimals: s.* the
//   situation (SIT_KEYS), f.* the candidate (CAND_KEYS), vs.* each candidate feature less today's pick's, gap today's
//   score of today's pick less the candidate's.
// The target, a row a candidate: its playout's value less its decision's mean (`mean`) or today's pick's (`today`), clipped.
// outforest.json: { kind: 'outforest', name, about, made, data, phases: { recruit?, spend? } }, a phase's forest
//   { inputs, target, delta, deltas? (deltaAt), adjust? (adjustAt), size, feat, thr, right, value, made } (trees.js
//   compileTrees reads it); shipped as src/sim/outforest.json.
//
//   npm run outforest -- --data <dir>[,<dir>…] [--out file] [flags]   fit a forest a phase, printing its margins tables
//     --phases recruit,spend     the phases fitted (both by default); a phase with no labels gets no forest
//     --with file                the phases of that configuration not fitted here, carried over
//     --delta 0.25               the margin; --delta-recruit, --delta-spend a phase's own
//     --target mean|today        the target, as above
//     --trees 200 --depth 6 --leaves 64 --min-leaf 50 --mtry 0.333 --shrink 0   the trees, as forestfit.js grows them
//     --bins 64 --seed 1         the bins an input is cut into at most, and the trees' draws
//     --weighted --wclip 10      each row by its draw's `wt`, clipped
//     --floor-weights 2,1,…      a decision's weight by its floor, the last for every floor past them
//     --without s.o.,f.o.,…      the inputs never split on, by the start of their names
//     --name outforest           the configuration's name
//     --workers n                worker threads (every core but one by default)
//   npm run outforest -- --data <dir>[,<dir>…] --eval <file>   the held-out tables of a configuration fitted already
//   npm run outforest -- --data <dir>[,<dir>…] --stats         what the labels hold (outLabelStats)
//   npm run outforest -- --merge a.json[:2],b.json[:1] --out <file> [--phase recruit] [--adjust '{"recruit":[0.4,0,0]}']
//                        [--name merged]   a phase's forests as one (mergeOutForests; an expert file's outforest read)
import { compileTrees, treesMean, TARGETS, r6 } from './trees.js'
import { binTable, fitForest, flatTrees, heldTable, linesOf, marginText, splitOf } from './forestfit.js'
import { shippedPart } from './read.js'
import { arg, has, list, num, isMain } from './cli.js'

const node = (name) => globalThis.process?.getBuiltinModule?.(`node:${name}`)
const EPS = 1e-9

// ── the vocabulary ───────────────────────────────────────────────────────────────────────────────

const OUT_PHASES = Object.freeze(['recruit', 'spend'])
// The threat types the coming rooms are read by (content.js THREATS; depth, a room's, read as its waves).
export const OUT_THREATS = Object.freeze(['reach', 'shape', 'drain', 'sustain', 'fly', 'burn', 'bleed'])
// The roles a kind is read by (content.js ROLE_LIST, the Monarch's aside).
export const OUT_ROLES = Object.freeze(['vanguard', 'skirmisher', 'ranger', 'channeler', 'warden', 'trickster'])
// The sets of coming battle rooms: the next on the route (n1), the next three (n3), the floor's still ahead (fl).
export const OUT_ROOMS = Object.freeze(['n1', 'n3', 'fl'])
// What the field's read holds (player.js fieldRead): its strength, the book's target and progress, its answers, its
// pieces by kind, its blows and toughness, its synergies, summons and level, and the most souls of one kin and one role.
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
// Each phase's reads: the situation's keys and a candidate's.
const KEYS = Object.freeze({ recruit: [SIT_KEYS, CAND_KEYS], spend: [SIT_KEYS, CAND_KEYS] })

// An object of `keys`, each 0: the read fills it (put).
export const zeros = (keys) => Object.fromEntries(keys.map((k) => [k, 0]))
// Sets `key` of read `o` (made by zeros) to `v`, rounded as the rows write it (a flag 0 or 1, anything not finite 0).
export function put (o, key, v) {
  if (!(key in o)) throw new Error(`outforest: no read "${key}"`)
  o[key] = typeof v === 'boolean' ? +v : Number.isFinite(v) ? r6(v) : 0
}

// A phase's inputs in encodeOut's layout: the situation's (s.*), the candidate's (f.*), the same less today's pick's
// (vs.*), and the gap; their names, and where each block starts. Made once a phase. → { sit, cand, names, F0, V0, G0, D }
const LAYOUTS = new Map()
export function layoutOf (phase = 'recruit') {
  if (!KEYS[phase]) throw new Error(`outforest: no phase "${phase}": ${OUT_PHASES.join(', ')}`)
  if (!LAYOUTS.has(phase)) {
    const [sit, cand] = KEYS[phase]
    const names = Object.freeze([...sit.map((k) => `s.${k}`), ...cand.map((k) => `f.${k}`), ...cand.map((k) => `vs.${k}`), 'gap'])
    LAYOUTS.set(phase, { sit, cand, names, F0: sit.length, V0: sit.length + cand.length, G0: sit.length + 2 * cand.length, D: names.length })
  }
  return LAYOUTS.get(phase)
}
export const outInputNames = (phase = 'recruit') => layoutOf(phase).names
export const OUT_D = layoutOf('recruit').D

// The inputs of candidate `f` (its read: outsideRead's `f[i]`) of a decision of `phase` read as `sit`,
// against today's pick `today` (its read), in the phase's layout (layoutOf). → out
export function encodeOut (sit, f, today, phase = 'recruit', out = new Float64Array(layoutOf(phase).D)) {
  const { sit: S, cand: C, F0, V0, G0 } = layoutOf(phase)
  for (let j = 0; j < S.length; j++) out[j] = sit[S[j]] ?? 0
  for (let j = 0; j < C.length; j++) {
    const k = C[j]
    const v = f[k] ?? 0
    out[F0 + j] = v
    out[V0 + j] = r6(v - (today[k] ?? 0))
  }
  out[G0] = r6((today.score ?? 0) - (f.score ?? 0))
  return out
}

// ── the forest in use ────────────────────────────────────────────────────────────────────────────

// The shipped forests out of battle (src/sim/outforest.json; Node only).
const readJSON = () => shippedPart('outforest')
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

// A configuration checked: a forest only for the phases it may decide, of inputs the code reads, its arrays agreeing.
export function checkOutForest (config) {
  if (config?.kind !== 'outforest' || typeof config.phases !== 'object' || config.phases === null) throw new Error('outforest: no phases')
  for (const [phase, m] of Object.entries(config.phases)) {
    if (!OUT_PHASES.includes(phase)) throw new Error(`outforest: no phase "${phase}": ${OUT_PHASES.join(', ')}`)
    const known = new Set(outInputNames(phase))
    const { inputs, size, feat, thr, right, value } = m ?? {}
    if (!Array.isArray(inputs) || !Array.isArray(size) || !Array.isArray(feat)) throw new Error(`outforest: ${phase} has no inputs or no trees`)
    for (const n of inputs) if (!known.has(n)) throw new Error(`outforest: unknown input "${n}"`)
    if (!Number.isFinite(m.delta)) throw new Error(`outforest: ${phase} has no margin (delta)`)
    if (m.deltas !== undefined && !(Array.isArray(m.deltas) && m.deltas.length && m.deltas.every(Number.isFinite))) throw new Error(`outforest: ${phase}'s deltas are no list of numbers`)
    if (m.adjust !== undefined) {
      if (typeof m.adjust !== 'object' || m.adjust === null || Array.isArray(m.adjust)) throw new Error(`outforest: ${phase}'s adjust is no object`)
      const reads = new Set(KEYS[phase][1])
      for (const [k, w] of Object.entries(m.adjust)) {
        if (!reads.has(k)) throw new Error(`outforest: ${phase}'s adjust reads no candidate key "${k}"`)
        const ws = Array.isArray(w) ? w : [w]
        if (!ws.length || !ws.every(Number.isFinite)) throw new Error(`outforest: ${phase}'s adjust of "${k}" is no number or list of them`)
      }
    }
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

// Phase `phase`'s forest `m` made ready for play, once: its trees compiled to the phase's layout (encodeOut's).
const RUNTIMES = new WeakMap()
function runtimeOf (m, phase) {
  let rt = RUNTIMES.get(m)
  if (!rt) {
    const { names, D } = layoutOf(phase)
    rt = { ...compileTrees(m, m.inputs.map((n) => names.indexOf(n))), x: new Float64Array(D) }
    RUNTIMES.set(m, rt)
  }
  return rt
}
// Phase `phase`'s forest `m`'s mean leaf for inputs `x` (encodeOut's).
export const predictOut = (m, x, phase = 'recruit') => treesMean(runtimeOf(m, phase), x)

// A phase's correction `adjust` ({ key: w } or { key: [w by floor, …] } over a candidate's reads) on `floor`: each
// candidate's advantage gains Σ w × (its read − today's pick's), the list's last past its end. → [[key, w], …] or null
const onFloor = (w, floor) => (Array.isArray(w) ? w[Math.min(w.length, Math.max(1, floor ?? 1)) - 1] : w)
export function adjustAt (adjust, floor = 1) {
  if (!adjust) return null
  const out = Object.entries(adjust).map(([k, w]) => [k, onFloor(w, floor)]).filter(([, w]) => w !== 0)
  return out.length ? out : null
}
// A phase's margin on `floor`: its `deltas` by floor (the last past its end) where it has them, else its `delta`.
export const deltaAt = (m, floor = 1) => (m.deltas ? onFloor(m.deltas, floor) : m.delta)

// The candidate forest `model` takes at decision `read` of `phase` (`f[0]` today's pick's): the best other by its
// advantage over today's (corrected by adjustAt), the earlier where equal, where that exceeds deltaAt, else today's.
// → { index (into read.f), margin (the advantage it was taken by; 0 for today's) }
export function chooseOut (model, phase, read) {
  const m = model?.phases?.[phase]
  if (!m || read.f.length < 2) return { index: 0, margin: 0 }
  const rt = runtimeOf(m, phase)
  const today = read.f[0]
  const base = m.target === 'mean' ? treesMean(rt, encodeOut(read.sit, today, today, phase, rt.x)) : 0
  const adj = adjustAt(m.adjust, read.sit.floor)
  let best = 0
  let top = -Infinity
  for (let i = 1; i < read.f.length; i++) {
    let a = treesMean(rt, encodeOut(read.sit, read.f[i], today, phase, rt.x)) - base
    if (adj) for (const [k, w] of adj) a += w * ((read.f[i][k] ?? 0) - (today[k] ?? 0))
    if (a > top + EPS) {
      top = a
      best = i
    }
  }
  return top > deltaAt(m, read.sit.floor) ? { index: best, margin: r6(top) } : { index: 0, margin: 0 }
}

// ── the labels ───────────────────────────────────────────────────────────────────────────────────

// The label files of `dirs` (a directory of outside.js --label's, or its labels.jsonl).
function labelsOf (dir) {
  const fs = node('fs')
  const path = node('path')
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? path.join(dir, 'labels.jsonl') : dir
}

// One label row as the forest reads it: its candidates with a value, today's pick first, each with its inputs against
// it (encodeOut) and value. → { rows: [{ x, value, base }] }, or null for fewer than two or no today's pick
export function readOutDecision (row) {
  const opts = row.options.filter((o) => Number.isFinite(o.value))
  const today = opts.find((o) => o.today)
  if (opts.length < 2 || !today) return null
  const order = [today, ...opts.filter((o) => o !== today)]
  return { rows: order.map((o) => ({ x: encodeOut(row.sit, o.f, today.f, row.phase), value: o.value, base: !!o.base })) }
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

// The decisions of `phase` of label sets `dirs` as one table (forestfit.js binTable's): a row a candidate, today's pick
// first, with its value and `base`; per decision its start, seed, run, split, floor, `wt` and `runKey`.
export async function readOutTable (dirs, phase, { bins = 64, sample = 100000, seed = 1 } = {}) {
  const { names, D } = layoutOf(phase)
  const t = await binTable(() => decisionsOf(dirs, phase), Int32Array.from({ length: D }, (_, j) => j), {
    bins,
    sample,
    seed,
    what: 'outforest',
    extras: { base: [Uint8Array, (o) => +o.base] },
    metaOf: (row, k) => ({ seed: row.seed, run: row.run, split: splitOf(row.run), floor: row.floor, wt: row.wt ?? 1, runKey: `${k}:${row.run}` })
  })
  return { phase, names: names.slice(), ...t, dirs: dirs.slice() }
}

// ── the trees ────────────────────────────────────────────────────────────────────────────────────

// The settings a forest is fitted by, unless given. `floors`: a decision's weight by its floor (the last for every floor
// past them; null, alike); `without`: the inputs never split on, by the start of their names.
const OUT_FIT = Object.freeze({ target: 'mean', trees: 200, depth: 6, leaves: 64, minLeaf: 50, mtry: 1 / 3, shrink: 0, minGain: 1e-6, clip: 30, weighted: false, wclip: 10, floors: null, without: null, seed: 1, delta: 0.25 })

// Fits a phase's forest on table `t` (readOutTable's) by `cfg` (OUT_FIT's keys) with forestfit.js fitForest, each
// decision weighed by its floor's `floors`. → { config (the phase's forest), oob, held, fitted, heldOut }
export async function fitOutForest (t, cfg = {}, { log = () => {}, workers = 0 } = {}) {
  const { config, oob, held, fitted, heldOut } = await fitForest(t, cfg, {
    log,
    workers,
    defaults: OUT_FIT,
    what: 'outforest',
    weightOf: (M, c) => (c.floors ? c.floors[Math.min(M.floor, c.floors.length) - 1] : 1),
    lineOf: (c, t, n) => `fitting ${c.trees} trees (${t.phase}) to the ${c.target === 'mean' ? 'centred value' : 'advantage over today\'s pick'} on ${n.fitted} decisions (${n.rows} rows, ${n.runs} runs), ${n.inputs} inputs: ` +
      `depth ≤ ${c.depth}, leaves ≤ ${c.leaves}, min leaf ${c.minLeaf}, mtry ${+c.mtry.toFixed(3)}${c.weighted ? `, weighted (clip ${c.wclip})` : ''}${c.floors ? `, floors weighing ${c.floors.join(', ')}` : ''}`,
    progress: false,
    configOf: toConfig
  })
  return { config, oob, held, fitted, heldOut }
}

// Fitted trees as a phase's forest (fitForest's configOf).
function toConfig (trees, t, cols, cfg, fit) {
  const { target, trees: n, depth, leaves, minLeaf, mtry, shrink, weighted, wclip, floors, without, clip, seed, delta } = cfg
  return {
    inputs: Array.from(cols, (j) => t.names[j]),
    target,
    delta,
    ...flatTrees(trees, t, cols),
    made: { at: new Date().toISOString(), trees: n, depth, leaves, minLeaf, mtry: +mtry.toFixed(4), shrink, weighted, wclip, ...(floors && { floors }), ...(without && { without }), clip, seed, bins: Math.max(...t.nb), data: t.dirs, decisions: fit.fitted, rows: fit.rows, runs: fit.runs, seconds: +fit.seconds.toFixed(1) }
  }
}

// ── measuring ────────────────────────────────────────────────────────────────────────────────────

// The margins a table is read at (forestfit.js marginText's).
const OUT_DELTAS = Object.freeze([0, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10])

// What label sets `dirs` hold, by phase: decisions, runs, candidates a decision, the share where another than the base's
// pick played out the better and by how much, the share where another cleared where the base's did not, and by floor.
async function outLabelStats (dirs) {
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

// A configuration's held-out tables on label sets `dirs`, read as play reads them. → { [phase]: text }
async function evalOutForest (dirs, config, { log = null } = {}) {
  const out = {}
  for (const [phase, m] of Object.entries(config.phases)) {
    const { t, P: [P] } = await heldTable(decisionsOf(dirs, phase), [(x) => predictOut(m, x, phase)])
    const list = t.meta.map((_, p) => p)
    out[phase] = marginText(t, list, P, [...new Set([m.delta, ...OUT_DELTAS])].sort((a, b) => a - b), m.target)
    log?.(`\n${phase} (delta ${m.delta}), held out (seeds ≡ 0 mod 5):\n${out[phase]}`)
  }
  return out
}

// ── forests together ─────────────────────────────────────────────────────────────────────────────

// Phase `phase`'s forests of configurations `parts` ([{ config, times }]) as one: every tree of each, `times` over (its
// weight in the mean), on the union of their inputs; the rest (target, margin, `adjust`, `deltas`) and the other phases
// the first configuration's. → the configuration, checked
export function mergeOutForests (parts, phase = 'recruit', { name = 'merged' } = {}) {
  if (!parts.length) throw new Error('outforest: nothing to merge')
  const ms = parts.map(({ config }) => config.phases?.[phase])
  if (ms.some((m) => !m)) throw new Error(`outforest: a configuration has no ${phase} forest`)
  if (new Set(ms.map((m) => m.target)).size > 1) throw new Error('outforest: forests of different targets')
  const used = new Set(ms.flatMap((m) => m.inputs))
  const inputs = outInputNames(phase).filter((n) => used.has(n))
  const { size: _s, feat: _f, thr: _t, right: _r, value: _v, inputs: _i, made: _m, ...rest } = ms[0]
  const out = { ...rest, inputs, size: [], feat: [], thr: [], right: [], value: [] }
  for (const [k, m] of ms.entries()) {
    const at = m.inputs.map((n) => inputs.indexOf(n))
    const times = parts[k].times ?? 1
    if (!(Number.isInteger(times) && times >= 1)) throw new Error(`outforest: a forest's times ${times}: a whole number, 1 or more`)
    for (let t = 0; t < times; t++) {
      out.size.push(...m.size)
      for (const f of m.feat) out.feat.push(f < 0 ? -1 : at[f])
      out.thr.push(...m.thr)
      out.right.push(...m.right)
      out.value.push(...m.value)
    }
  }
  out.made = { merged: parts.map(({ config, times = 1 }, k) => ({ name: config.name, times, trees: ms[k].size.length, made: ms[k].made })) }
  const first = parts[0].config
  return checkOutForest({ ...first, name, made: new Date().toISOString(), phases: { ...first.phases, [phase]: out } })
}

// ── the command ──────────────────────────────────────────────────────────────────────────────────

async function main () {
  if (arg('merge', null)) {
    const fs = node('fs')
    const phase = arg('phase', 'recruit')
    const parts = list('merge').map((spec) => {
      const [file, times = '1'] = spec.split(':')
      const x = JSON.parse(fs.readFileSync(file, 'utf8'))
      return { config: x.kind === 'outforest' ? x : x.outforest, times: Number(times) }
    })
    const config = mergeOutForests(parts, phase, { name: arg('name', 'merged') })
    if (arg('adjust', null)) config.phases[phase].adjust = JSON.parse(arg('adjust'))
    const text = JSON.stringify(checkOutForest(config)) + '\n'
    fs.writeFileSync(arg('out') ?? undefined, text)
    const m = config.phases[phase]
    console.log(`wrote ${arg('out')}: ${phase} ${m.size.length} trees, ${m.feat.length} nodes, ${m.inputs.length} inputs, delta ${m.delta}${m.adjust ? `, adjust ${JSON.stringify(m.adjust)}` : ''}; ${(text.length / 1e6).toFixed(2)} MB`)
    return
  }
  const dirs = list('data')
  if (!dirs.length) throw new Error('outforest: --data <dir>[,<dir>…] of outside.js --label labels')
  const fs = node('fs')
  const os = node('os')
  const t0 = Date.now()
  if (has('stats')) {
    console.log(JSON.stringify(await outLabelStats(dirs), null, 1))
    return
  }
  if (arg('eval', null)) {
    await evalOutForest(dirs, checkOutForest(JSON.parse(fs.readFileSync(arg('eval'), 'utf8'))), { log: console.log })
    return
  }
  const phases = list('phases').length ? list('phases') : OUT_PHASES.slice()
  for (const p of phases) if (!OUT_PHASES.includes(p)) throw new Error(`outforest: no phase "${p}"`)
  const base = Object.fromEntries(Object.entries({
    target: arg('target'), trees: num('trees'), depth: num('depth'), leaves: num('leaves'), minLeaf: num('min-leaf'), mtry: num('mtry'), shrink: num('shrink'),
    wclip: num('wclip'), seed: num('seed'), delta: num('delta')
  }).filter(([, v]) => v != null))
  if (has('weighted')) base.weighted = true
  if (arg('floor-weights', null)) base.floors = arg('floor-weights').split(',').map(Number)
  if (arg('without', null)) base.without = arg('without').split(',')
  const workers = Number(arg('workers', Math.max(1, os.availableParallelism() - 1)))
  const bins = Number(arg('bins', 64))
  const kept = arg('with', null) ? checkOutForest(JSON.parse(fs.readFileSync(arg('with'), 'utf8'))) : null
  const config = {
    kind: 'outforest', name: arg('name', 'outforest'), about: 'random forests over the expert\'s recruit and purchases (src/sim/outforest.js), fitted on outside.js --label\'s playouts to the run\'s end; today\'s pick unless another\'s predicted advantage exceeds delta',
    made: new Date().toISOString(), data: [...new Set([...(kept?.data ?? []), ...dirs])], phases: Object.fromEntries(Object.entries(kept?.phases ?? {}).filter(([p]) => !phases.includes(p)))
  }
  for (const phase of phases) {
    const t = await readOutTable(dirs, phase, { bins })
    console.log(`\n${phase}: ${t.P} decisions, ${t.N} rows, ${t.D} inputs (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
    if (t.P < 2) {
      console.log('  too few decisions to fit: none for this phase')
      continue
    }
    const cfg = { ...base, ...(num(`delta-${phase}`) !== undefined && { delta: num(`delta-${phase}`) }) }
    const r = await fitOutForest(t, cfg, { log: console.log, workers })
    console.log(`out of bag (the decisions fitted, each by the trees whose draw left its run out):\n${marginText(t, r.fitted, r.oob, OUT_DELTAS, r.config.target)}`)
    console.log(`held out (seeds ≡ 0 mod 5):\n${marginText(t, r.heldOut, r.held, OUT_DELTAS, r.config.target)}`)
    config.phases[phase] = r.config
  }
  const out = arg('out', null)
  if (out) {
    const text = JSON.stringify(checkOutForest(config)) + '\n'
    fs.writeFileSync(out, text)
    console.log(`\nwrote ${out}: ${Object.entries(config.phases).map(([p, m]) => `${p} ${m.size.length} trees, ${m.feat.length} nodes, delta ${m.delta}`).join('; ')}, ${(text.length / 1e6).toFixed(2)} MB (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
  }
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
