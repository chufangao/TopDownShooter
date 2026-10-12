// The forest (src/sim/forest.js; redesign.md §2.23's correction as regression trees): trees that may overrule today's
// choice of a piece where they read another option the better by more than their margin; their inputs read alike from a
// label row and in play, their fitting, forest.json's shape, and the measurement's plumbing (autoplay.js withForest,
// record's `forest`, playerOf; teach.js's install). Functional only: what a forest decides and how it is read, never
// how often it wins.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  useForest, forestModel, checkForest, inputNames, INPUT_SETS, encodeAgainst, playOf, rowOf, predict, predictor, readDecision, readTable, fitForest,
  growTree, readsAfter, FIT
} from '../src/sim/forest.js'
import { useRanker, rankerModel, meanOf, rowView, createNet, INPUT_SETS as RANKER_SETS } from '../src/sim/ranker.js'
import { expertTurn, situation, expertOptions, features, conditions, rankerView, afterOf } from '../src/sim/policy.js'
import { teachRun, teacherRun } from '../src/sim/teach.js'
import { readPlan } from '../src/sim/plan.js'
import { createRun, apply } from '../src/sim/run.js'
import { policy, record, withForest, playerOf } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { fork } from '../src/sim/turns.js'
import { mulberry } from '../src/sim/value.js'
import { on, scene } from './scene.js'

const NAMES = inputNames()
const BASE = INPUT_SETS.base()

// A forest configuration (forest.json's shape) from trees given as nested nodes ({ f: an input's name, t: its
// threshold, l, r } or a leaf's number), its margin `delta`.
function forestOf (trees, { delta = 0.1, name = 'test-forest', inputs = BASE, target = 'today' } = {}) {
  const cfg = { kind: 'forest', name, inputs: inputs.slice(), target, delta, size: [], feat: [], thr: [], right: [], value: [] }
  const emit = (n) => {
    const at = cfg.feat.length
    if (typeof n === 'number') {
      cfg.feat.push(-1)
      cfg.value.push(n)
      return
    }
    const j = cfg.inputs.indexOf(n.f)
    assert.ok(j >= 0, n.f)
    cfg.feat.push(j)
    cfg.thr.push(n.t)
    const k = cfg.right.length
    cfg.right.push(0)
    emit(n.l)
    cfg.right[k] = cfg.feat.length - at
    emit(n.r)
  }
  for (const t of trees) {
    const before = cfg.feat.length
    emit(t)
    cfg.size.push(cfg.feat.length - before)
  }
  return cfg
}
// A forest of `n` trees, each `depth` levels of splits drawn on inputs that differ between options (the option's own,
// against its position and against today's choice; the gap of today's score), its thresholds and leaves drawn too: it
// decides otherwise than today often.
const SPLITS = ['opt.damage', 'opt.danger', 'rel.danger', 'vs.damage', 'vs.danger', 'vs.screen', 'gap', 'steps', 'kind.stay', 'opt.kill', 'vs.progress']
function drawn (seed = 3, n = 12, depth = 3, { delta = 0.1, spread = 2, target = 'today' } = {}) {
  const rand = mulberry(seed)
  const tree = (d) => (d === 0 ? (rand() - 0.3) * spread : { f: SPLITS[Math.floor(rand() * SPLITS.length)], t: Math.round((rand() * 20 - 5) * 10) / 10, l: tree(d - 1), r: tree(d - 1) })
  return forestOf(Array.from({ length: n }, () => tree(depth)), { delta, name: `drawn-${seed}`, target })
}

const board = (units) => {
  const b = scene(units.map((u) => on(u.id, u.uid, u.side, u.x, u.y, u.lvl ?? 3)), { walls: [] })
  for (const u of units) if (u.hp) b.byUid.get(u.uid).hp = u.hp
  return b
}
const boards = () => [
  board([{ id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 }, { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 3 }, { id: 'bone_chanter', uid: 2, side: 'party', x: 2, y: 2 },
    { id: 'frost_sprite', uid: 3, side: 'party', x: 4, y: 2 }, { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 6 },
    { id: 'will_o_wisp', uid: 10, side: 'foe', x: 2, y: 8 }, { id: 'pyre_hound', uid: 11, side: 'foe', x: 4, y: 8 }]),
  board([{ id: 'monarch', uid: 0, side: 'party', x: 3, y: 0, hp: 30 }, { id: 'tomb_knight', uid: 1, side: 'party', x: 1, y: 1 }, { id: 'frost_sprite', uid: 2, side: 'party', x: 5, y: 1 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 2, lvl: 9 }, { id: 'grave_ghoul', uid: 10, side: 'foe', x: 1, y: 7 }])
]

// A run's first `n` battles played by the expert (as a run plays): → the run's log, and each piece decision met on the
// way ({ board (a copy as it decided), uid, at (the run's log index) }).
function battles (seed, n) {
  const run = createRun({ seed })
  const rng = createRng(run.state.seed).stream('autoplay')
  const points = []
  let done = 0
  let turn = -1
  let decided = new Set()
  let open = null
  while (run.state.phase !== 'over' && done < n) {
    const a = policy(run, rng, 'expert')
    const b = run.state.phase === 'battle' ? run.battle : null
    if (b) {
      if (b.turn !== turn) {
        turn = b.turn
        decided = new Set()
      }
      if (a.type === 'move' || a.type === 'act' || a.type === 'fuse') {
        // A piece's orders together are one decision; one it gives again later in the turn is not another.
        if (open?.uid !== a.uid) {
          open = null
          if (!decided.has(a.uid)) {
            decided.add(a.uid)
            open = { board: fork(b), uid: a.uid, at: run.state.log.length }
            points.push(open)
          }
        }
      } else open = null
    }
    apply(run, a)
    if (b && b.over) done++
  }
  return { log: run.state.log, points }
}

// `fn()` with the forest and the ranker given in use, both put back after.
function playing ({ forest = null, ranker = null }, fn) {
  const had = { forest: forestModel(), ranker: rankerModel() }
  try {
    useForest(forest)
    useRanker(ranker)
    return fn()
  } finally {
    useForest(had.forest)
    useRanker(had.ranker)
  }
}

test('the forest in use: forest.json\'s by default (none without one), a configuration installed, null for none, undefined back', () => {
  const shipped = useForest(undefined)
  const f = drawn()
  try {
    assert.equal(useForest(f), f)
    assert.equal(forestModel(), f)
    assert.equal(useForest(null), null)
    assert.equal(forestModel(), null)
  } finally {
    assert.equal(useForest(undefined), shipped)
  }
  assert.throws(() => checkForest({ ...f, inputs: [...f.inputs.slice(1), 'sit.nothing'] }), /unknown input/)
  assert.throws(() => checkForest({ ...f, delta: undefined }), /margin/)
  assert.throws(() => checkForest({ ...f, value: f.value.slice(1) }), /agree/)
  assert.throws(() => checkForest({ ...f, feat: f.feat.map((x) => (x >= 0 ? f.inputs.length : x)) }), /does not name/)
})

test('the inputs: the ranker\'s, then the gap of today\'s score and each feature against today\'s choice', () => {
  assert.equal(new Set(NAMES).size, NAMES.length)
  assert.ok(BASE.every((n) => NAMES.includes(n) && !n.startsWith('aft.')))
  assert.ok(NAMES.includes('gap') && NAMES.includes('vs.damage') && NAMES.includes('aft.foes'))
  const views = [{ f: { damage: 10, danger: 2 }, steps: 2, act: true, fusion: false, prior: 30 }, { f: { damage: 4 }, steps: 0, act: false, fusion: false, prior: 41.5 }]
  const x = encodeAgainst({ turn: 3 }, 'frost_sprite', views[0], meanOf(views), views[1])
  assert.equal(x[NAMES.indexOf('sit.turn')], 3)
  assert.equal(x[NAMES.indexOf('opt.damage')], 10)
  assert.equal(x[NAMES.indexOf('rel.damage')], 3)
  assert.equal(x[NAMES.indexOf('gap')], 11.5)
  assert.equal(x[NAMES.indexOf('vs.damage')], 6)
  assert.equal(x[NAMES.indexOf('vs.danger')], 2)
  assert.equal(x[NAMES.indexOf('kind.moveAct')], 1)
  // A forest's prediction: the mean of its trees' leaves; its advantage, that less today's choice's own where its
  // target is centred.
  const f = forestOf([{ f: 'vs.damage', t: 5, l: -1, r: 1 }, { f: 'gap', t: 20, l: 0.5, r: -0.5 }, 0.25])
  assert.equal(predict(f, x), (1 + 0.5 + 0.25) / 3)
  const mean = meanOf(views)
  assert.equal(predictor(f, { turn: 3 }, 'frost_sprite', mean, views[1])(views[0]), (1 + 0.5 + 0.25) / 3)
  const centred = { ...f, target: 'mean' }
  assert.equal(predictor(centred, { turn: 3 }, 'frost_sprite', mean, views[1])(views[0]), (1 + 0.5 + 0.25) / 3 - (-1 + 0.5 + 0.25) / 3)
  x[NAMES.indexOf('vs.damage')] = 5
  assert.equal(predict(f, x), (-1 + 0.5 + 0.25) / 3)
})

// A run's first battle labelled (teach.js teachRun: every decision kept, its options played out a round), as rows.
const labelled = (seed, limit = 6) => teachRun(seed, { battles: 1, limit, rounds: 1, ranker: null, forest: null, keep: { lost: 1, near: 1, reach: 1, calm: 1 } }).positions

test('a forest\'s inputs and prediction in play are its inputs and prediction on the label row, number for number', async () => {
  const rows = playing({}, () => labelled('forest-test-1'))
  assert.ok(rows.length >= 4)
  // A forest fitted on these very rows: its thresholds the values they hold.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retinue-forest-test-'))
  let f
  let fit
  let table
  try {
    fs.writeFileSync(path.join(dir, 'labels.jsonl'), rows.map((r) => JSON.stringify(r) + '\n').join(''))
    table = await readTable([dir], { bins: 16 })
    fit = await fitForest(table, { trees: 6, minLeaf: 2, leaves: 16, depth: 5, mtry: 0.5 })
    f = checkForest(JSON.parse(JSON.stringify(fit.config)))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  assert.ok(f.feat.some((x) => x >= 0), 'some tree split')
  const { points } = playing({}, () => battles('forest-test-1', 1))
  let compared = 0
  let r = 0
  for (const row of rows) {
    const d = readDecision(row)
    if (!d) continue
    // The table's rows are the decision's, in order: the fit's own predictions (on the bins) are the forest's on the raw
    // inputs, as far as forest.json's rounding of the leaves.
    for (const o of d.rows) {
      const y = predict(f, o.x)
      const own = fit.trees.reduce((s, tree) => {
        let k = 0
        while (tree.feat[k] >= 0) k = table.bins[tree.feat[k] * table.N + r] <= tree.bin[k] ? k + 1 : tree.right[k]
        return s + tree.value[k]
      }, 0) / fit.trees.length
      assert.ok(Math.abs(y - own) < 1e-4 * Math.max(1, Math.abs(own)), `${y} against ${own}`)
      r++
    }
    // The same decision in play: its candidates read against today's choice as the forest reads them (today's own row
    // first).
    const p = points.find((q) => q.at === row.at && q.uid === row.uid)
    if (!p) continue
    const g = fork(p.board)
    const u = g.byUid.get(row.uid)
    const sit = situation(g)
    sit.plan = readPlan(g, sit)
    const opts = expertOptions(g, u)
    for (const o of opts) {
      o.v = features(g, u, o, sit)
      o.road = -o.path.length
    }
    const c = conditions(sit, u)
    const view = playing({}, () => rankerView(g, u, sit, opts, c))
    const same = (o, x) => o.tile === x.tile && (o.ability?.id ?? null) === x.ability && (o.target?.uid ?? null) === x.target && (o.fusion?.id ?? null) === x.fusion
    assert.ok(same(view.own, d.today), `${row.id}: today's choice`)
    assert.deepEqual(Array.from(view.mean), Array.from(d.mean))
    const gain = predictor(f, c, u.id, view.mean, playOf(view.own))
    assert.deepEqual(Array.from(encodeAgainst(c, u.id, playOf(view.own), view.mean, playOf(view.own))), Array.from(d.rows[0].x))
    for (const x of d.rows.slice(1)) {
      const o = view.candidates.find((y) => same(y, x.o))
      if (!o) continue
      assert.deepEqual(Array.from(encodeAgainst(c, u.id, playOf(o), view.mean, playOf(view.own))), Array.from(x.x), `${row.id}`)
      assert.equal(gain(playOf(o)), predict(f, x.x) - predict(f, d.rows[0].x))
      compared++
    }
  }
  assert.ok(compared > 10, `${compared} compared`)
})

test('with no forest and no ranker the expert is today\'s; a forest whose advantages never exceed its margin plays it move for move', () => {
  const today = playing({}, () => battles('forest-test-2', 2).log)
  // Of the advantage's target, every leaf at most the margin; of the centred, every tree one leaf.
  const flat = forestOf([{ f: 'vs.damage', t: 0, l: 0.1, r: { f: 'gap', t: 3, l: -2, r: 0.1 } }, 0.1, -5], { delta: 0.1 })
  const level = forestOf([3, -1, 0.5], { delta: 0, target: 'mean' })
  const notes = []
  for (const f of [flat, level]) {
    playing({ forest: f }, () => {
      assert.deepEqual(battles('forest-test-2', 2).log, today)
      for (const b of boards()) assert.deepEqual(expertTurn(fork(b), { note: (r) => notes.push(r) }), playing({}, () => expertTurn(fork(b))))
    })
  }
  assert.ok(notes.some((r) => r.decision === 'battle'))
  assert.ok(notes.every((r) => r.by !== 'forest' && !r.margin))
  // A forest decides in place of a ranker: the flat forest with a ranker in use is still today's.
  const net = createNet({ inputs: 149, seed: 2 })
  const rand = mulberry(4)
  net.W[2] = net.W[2].map(() => (rand() - 0.5) * 40)
  const ranker = { name: 'loud', inputs: RANKER_SETS.base(), mean: new Array(149).fill(0), sd: new Array(149).fill(1), clip: 10, scale: 50, net: { sizes: net.sizes, W: net.W.map((w) => Array.from(w)), b: net.b.map((v) => Array.from(v)) } }
  playing({ forest: flat, ranker }, () => assert.deepEqual(battles('forest-test-2', 1).log, playing({}, () => battles('forest-test-2', 1).log)))
})

test('a forest decides deterministically, legal orders; where it changes today\'s choice, the audit says forest and a margin above its own', () => {
  let changed = 0
  for (const seed of [5, 6, 7]) {
    const f = drawn(seed, 12, 3, { target: seed === 6 ? 'mean' : 'today' })
    playing({ forest: f }, () => {
      for (const b of boards()) {
        const notes = []
        const orders = expertTurn(fork(b), { note: (r) => notes.push(r) })
        assert.deepEqual(expertTurn(fork(b)), orders)
        assert.deepEqual(orders.at(-1), { type: 'end' })
        for (const r of notes.filter((x) => x.by === 'forest')) {
          assert.ok(r.margin > f.delta, `${r.margin}`)
          changed++
        }
      }
      const a = battles('forest-test-3', 1).log
      assert.deepEqual(battles('forest-test-3', 1).log, a)
    })
  }
  assert.ok(changed > 0, 'some forest decided')
  // One that reads the board an option leaves reads it, and decides alike twice.
  const deep = forestOf([{ f: 'aft.foes', t: -0.5, l: 1, r: { f: 'aft.monarch.danger', t: 0, l: 0.5, r: -1 } }], { inputs: NAMES, target: 'mean' })
  assert.equal(readsAfter(drawn(8)), false)
  assert.equal(readsAfter(deep), true)
  playing({ forest: deep }, () => {
    const a = battles('forest-test-3', 1).log
    assert.deepEqual(battles('forest-test-3', 1).log, a)
  })
})

// Label rows on disk (teach.js's shape) for fitting: `runs` runs of `per` positions, four options each; in a position,
// the option that guards the most against today's choice (the best by today's score, preferring damage) gains when the
// Monarch is in danger.
function synthetic (runs = 20, per = 8, seed = 11) {
  const rand = mulberry(seed)
  const rows = []
  for (let k = 0; k < runs; k++) {
    for (let j = 0; j < per; j++) {
      const danger = Math.round(rand() * 3)
      const options = Array.from({ length: 4 }, (_, i) => {
        const f = { damage: Math.round(rand() * 20), guard: Math.round(rand() * 10), danger: Math.round(rand() * 5) }
        return { i, tile: 10 + i, steps: i % 2, ability: i ? 'strike' : null, target: i ? 9 : null, fusion: null, f, prior: 2 * f.damage + i * 1e-3, kept: 1, legal: 1, chosen: 0, value: 0 }
      })
      const top = options.reduce((a, o) => (o.prior > a.prior ? o : a))
      top.chosen = 1
      for (const o of options) o.value = danger > 1 ? -0.05 * (10 - o.f.guard) - (rand() < 0.1 ? 10 : 0) : -0.02 * (20 - o.f.damage)
      rows.push({ id: `s${k}:${j}`, seed: `syn-${k}`, run: k, floor: 1, group: 0, danger: 'reach', wt: 2, kind: 'frost_sprite', sit: { turn: j, 'monarch.danger': danger }, options, chosen: top.i })
    }
  }
  return rows
}

test('fitting: deterministic for a seed, the same trees in worker threads, bagged by run, forest.json\'s shape through a file and back', async () => {
  const rows = synthetic()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retinue-forest-fit-'))
  try {
    fs.writeFileSync(path.join(dir, 'labels.jsonl'), rows.map((r) => JSON.stringify(r) + '\n').join(''))
    const t = await readTable([dir], { bins: 32 })
    assert.equal(t.P, rows.length)
    assert.equal(t.N, rows.length * 4)
    // Every input cut at most 31 times, ascending.
    for (const c of t.cuts) {
      assert.ok(c.length <= 31)
      for (let i = 1; i < c.length; i++) assert.ok(c[i] > c[i - 1])
    }
    const cfg = { trees: 8, minLeaf: 5, leaves: 12, depth: 6, seed: 3 }
    const a = await fitForest(t, cfg)
    const b = await fitForest(t, cfg)
    const strip = (c) => ({ ...c, made: { ...c.made, at: null, seconds: null } })
    assert.deepEqual(strip(a.config), strip(b.config))
    const w = await fitForest(t, cfg, { workers: 2 })
    assert.deepEqual(strip(w.config), strip(a.config))
    assert.notDeepEqual(strip((await fitForest(t, { ...cfg, seed: 4 })).config).feat, strip(a.config).feat)
    // A tree is a function of the table, the seed and its number: its runs drawn with replacement, as many draws as
    // runs.
    const S = { bins: t.bins, N: t.N, cols: Int32Array.from(t.names.keys()), nb: t.nb, y: Float64Array.from(t.v), w: new Float64Array(t.N).fill(1), run: Int32Array.from(t.pos, (p) => (t.meta[p].split === 'held' ? -1 : t.meta[p].run)), nRuns: 20 }
    const fitBy = { ...FIT, ...cfg }
    const tree = growTree(S, fitBy, 0)
    assert.deepEqual(growTree(S, fitBy, 0), tree)
    assert.notDeepEqual(growTree(S, fitBy, 1).count, tree.count)
    assert.equal(tree.count.reduce((x, y) => x + y, 0), 20)
    assert.ok(tree.feat.length === tree.right.length && tree.feat[0] >= 0)
    // Out of bag: each fitted row's estimate from the trees that left its run out; the held-out rows' from them all.
    assert.ok(a.fitted.every((p) => t.meta[p].split !== 'held') && a.heldOut.every((p) => t.meta[p].split === 'held'))
    assert.ok(a.heldOut.length > 0 && a.heldOut.every((p) => Number.isFinite(a.held[t.start[p]])))
    assert.ok(a.fitted.some((p) => Number.isFinite(a.oob[t.start[p]])))
    // Through a file: the same predictions, read as play reads them.
    const file = path.join(dir, 'forest.json')
    fs.writeFileSync(file, JSON.stringify(a.config) + '\n')
    const back = checkForest(JSON.parse(fs.readFileSync(file, 'utf8')))
    assert.equal(back.kind, 'forest')
    for (const row of rows.slice(0, 12)) {
      const d = readDecision(row)
      for (const o of d.rows) assert.equal(predict(back, o.x), predict(a.config, o.x))
    }
    // The inputs a row's option is read by: today's choice its best by today's score, its own row first.
    const d = readDecision(rows[0])
    assert.equal(d.today.chosen, 1)
    assert.equal(d.rows.length, 4)
    assert.equal(d.rows[0].o, d.today)
    const mean = meanOf(rows[0].options.map((o) => rowView(o)))
    assert.deepEqual(Array.from(d.rows[1].x), Array.from(encodeAgainst(rows[0].sit, rows[0].kind, rowOf(d.rows[1].o), mean, rowOf(d.today))))
    // Of the advantage's target, today's own row is not fitted; the centred target's targets sum to 0 a position.
    const today = await fitForest(t, { ...cfg, target: 'today' })
    assert.equal(today.config.target, 'today')
    assert.equal(a.config.target, 'mean')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a job\'s forest is installed for its run and the one before put back; a paired player by its name or its file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retinue-forest-job-'))
  const before = forestModel()
  try {
    const file = path.join(dir, 'f.json')
    fs.writeFileSync(file, JSON.stringify(drawn(4)))
    const rfile = path.join(dir, 'r.json')
    fs.writeFileSync(rfile, JSON.stringify({ name: 'r' }))
    const mine = drawn(9)
    useForest(mine)
    assert.equal(withForest('none', () => forestModel()), null)
    assert.equal(forestModel(), mine)
    assert.equal(withForest(file, () => forestModel().name), 'drawn-4')
    assert.equal(withForest(undefined, () => forestModel()), mine)
    assert.throws(() => withForest(file, () => { throw new Error('inside') }), /inside/)
    assert.equal(forestModel(), mine)
    const r = record({ seed: 'forest-test-9', level: 'expert', forest: file, ranker: 'none' })
    assert.equal(r.forest, 'drawn-4')
    assert.equal(r.ranker, null)
    assert.equal(forestModel(), mine)
    assert.equal(record({ seed: 'forest-test-9', level: 'expert', forest: 'none', ranker: 'none' }).forest, null)
    assert.equal(forestModel(), mine)
    assert.deepEqual(playerOf('none'), { ranker: 'none', forest: 'none' })
    assert.deepEqual(playerOf(file), { ranker: 'none', forest: file })
    assert.deepEqual(playerOf(`forest:${file}`), { ranker: 'none', forest: file })
    assert.deepEqual(playerOf(rfile), { ranker: rfile, forest: 'none' })
    // teach.js installs a run's forest for the run and its playouts, from a file too.
    useForest(null)
    teacherRun('forest-test-1', { fights: 1, forest: file })
    assert.equal(forestModel().name, 'drawn-4')
    teacherRun('forest-test-1', { fights: 1, forest: null })
    assert.equal(forestModel(), null)
  } finally {
    useForest(before)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the afterstate a forest reads in play is the board the option leaves, read as the ranker reads it', () => {
  // (The rows' afterstates are teach.js --augment's, which ranker.test.js holds equal to play's: here only that play
  // hands a forest that reads them each candidate's.)
  const deep = forestOf([{ f: 'aft.foes', t: -0.5, l: 1, r: -1 }], { inputs: NAMES, target: 'mean' })
  const b = boards()[0]
  const g = fork(b)
  const sit = situation(g)
  sit.plan = readPlan(g, sit)
  const u = g.byUid.get(3)
  const opts = expertOptions(g, u)
  for (const o of opts) {
    o.v = features(g, u, o, sit)
    o.road = -o.path.length
  }
  const c = conditions(sit, u)
  const view = playing({}, () => rankerView(g, u, sit, opts, c))
  view.own.after = afterOf(g, u, view.own, sit.plan)
  const gain = predictor(deep, c, u.id, view.mean, playOf(view.own))
  const leaf = (o) => ((o.after?.foes ?? c.foes) - c.foes <= -0.5 ? 1 : -1)
  for (const o of view.candidates.filter((x) => x !== view.own)) {
    o.after = afterOf(g, u, o, sit.plan)
    assert.equal(gain(playOf(o)), leaf(o) - leaf(view.own))
  }
})
