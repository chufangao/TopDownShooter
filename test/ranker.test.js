// The ranker (redesign.md §2.23; src/sim/ranker.js): a learned correction to today's score of each option, its inputs
// read alike from a label row and in play, its loss and training, and the measurement's plumbing (autoplay.js
// withRanker, record's `ranker`, pairedStats). Functional only: what a ranker decides and how it is read, never how
// often it wins.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  useRanker, rankerModel, checkRanker, inputNames, encode, rowView, playView, meanOf, scorer, createNet, listLoss, readLabels, fitRanker, netOf,
  INPUT_SETS, rowAfter, afterNames, readsAfter
} from '../src/sim/ranker.js'
import { expertTurn, situation, expertOptions, features, conditions, rankerView, afterOf, OPTION_FEATURES } from '../src/sim/policy.js'
import { labelPosition, signature, optionsAt, afterRow, augmentRun, teachRun } from '../src/sim/teach.js'
import { readPlan } from '../src/sim/plan.js'
import { createRun, apply } from '../src/sim/run.js'
import { policy, record, withRanker, pairedStats } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { fork } from '../src/sim/turns.js'
import { gradsFor, mulberry } from '../src/sim/value.js'
import { on, scene } from './scene.js'

// Round 1's inputs (no afterstate), and all of them.
const BASE = INPUT_SETS.base()
const D = BASE.length
const ALL = inputNames()

// A ranker configuration from a net (ranker.json's shape) over inputs `inputs` (round 1's by default): standardised as
// given, by default not at all.
const configOf = (net, { name = 'test', scale = 50, inputs = BASE, mean = new Array(inputs.length).fill(0), sd = new Array(inputs.length).fill(1) } = {}) => ({
  name, inputs: inputs.slice(), mean, sd, clip: 10, scale, net: { sizes: net.sizes.slice(), W: net.W.map((w) => Array.from(w)), b: net.b.map((v) => Array.from(v)) }
})
// An untrained ranker (its last layer zero), and one whose last layer is drawn too (it decides otherwise than today).
const untrained = (inputs = BASE) => configOf(createNet({ inputs: inputs.length, seed: 3 }), { inputs })
const drawn = (seed = 5, k = 2, inputs = BASE) => {
  const net = createNet({ inputs: inputs.length, seed })
  const rand = mulberry(seed)
  net.W[2] = net.W[2].map(() => (rand() - 0.5) * k)
  return configOf(net, { name: `drawn-${seed}`, inputs })
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

// A run's first `n` battles played by the expert (autoplay.js policy, as a run plays): → the run's log, and each piece
// decision met on the way ({ board (a copy as it decided), uid, tile, orders, at (the run's log index) }).
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
        if (open?.uid === a.uid) open.orders.push(a)
        else if (!decided.has(a.uid)) {
          decided.add(a.uid)
          open = { board: fork(b), uid: a.uid, tile: b.byUid.get(a.uid).tile, orders: [a], at: run.state.log.length }
          points.push(open)
        } else open = null
      } else open = null
    }
    apply(run, a)
    if (b && b.over) done++
  }
  return { log: run.state.log, points }
}

test('the ranker in use: ranker.json\'s by default (none without one), a configuration installed, null for none, undefined back to ranker.json', () => {
  const shipped = useRanker(undefined)
  const r = untrained()
  assert.equal(useRanker(r), r)
  assert.equal(rankerModel(), r)
  assert.equal(useRanker(null), null)
  assert.equal(rankerModel(), null)
  assert.equal(useRanker(undefined), shipped)
  assert.throws(() => checkRanker({ ...r, inputs: [...r.inputs.slice(1), 'sit.nothing'] }), /unknown input/)
  assert.throws(() => checkRanker({ ...r, scale: NaN }), /scale/)
})

test('the inputs: every condition, the role and size, every option feature and against its position, the kind and steps', () => {
  const names = inputNames()
  assert.equal(new Set(names).size, names.length)
  const c = conditions({}, { uid: 1, hp: 1, maxHp: 1 })
  for (const k in c) assert.ok(names.includes(`sit.${k}`) && names.includes(`aft.${k}`), k)
  assert.ok(BASE.every((n) => names.includes(n) && !n.startsWith('aft.')))
  for (const k of OPTION_FEATURES) assert.ok(names.includes(`opt.${k}`) && names.includes(`rel.${k}`), k)
  // A move and act, its damage above its position's mean.
  const views = [{ f: { damage: 10 }, steps: 2, act: true, fusion: false }, { f: { damage: 4 }, steps: 0, act: false, fusion: false }]
  const x = encode({ turn: 3 }, 'frost_sprite', views[0], meanOf(views))
  assert.equal(x[names.indexOf('sit.turn')], 3)
  assert.equal(x[names.indexOf('opt.damage')], 10)
  assert.equal(x[names.indexOf('rel.damage')], 3)
  assert.equal(x[names.indexOf('kind.moveAct')], 1)
  assert.equal(x[names.indexOf('kind.stay')], 0)
  assert.equal(x[names.indexOf('steps')], 2)
  assert.equal(x[names.indexOf('size')], 1)
  assert.equal(names.filter((n) => n.startsWith('role.') && x[names.indexOf(n)] === 1).length, 1)
  // The afterstate less the decision; nothing where none was read.
  assert.ok(names.filter((n) => n.startsWith('aft.')).every((n) => x[names.indexOf(n)] === 0))
  const y = encode({ turn: 3, foes: 4 }, 'frost_sprite', { ...views[0], after: { turn: 3, foes: 2, killable: 1 } }, meanOf(views))
  assert.equal(y[names.indexOf('aft.foes')], -2)
  assert.equal(y[names.indexOf('aft.killable')], 1)
  assert.equal(y[names.indexOf('aft.turn')], 0)
})

test('the inputs from a label row (teach.js) are the inputs in play, number for number, over the same options', () => {
  const { points } = battles('rank-test-1', 1)
  assert.ok(points.length >= 4)
  let compared = 0
  for (const p of points.slice(0, 6)) {
    const row = labelPosition(fork(p.board), p.uid, signature(p.orders, p.tile), { rounds: 1 })
    const f = fork(p.board)
    const u = f.byUid.get(p.uid)
    const sit = situation(f)
    sit.plan = readPlan(f, sit)
    const opts = expertOptions(f, u)
    for (const o of opts) {
      o.v = features(f, u, o, sit)
      o.road = -o.path.length
    }
    const c = conditions(sit, u)
    const view = rankerView(f, u, sit, opts, c)
    // teach.js's shortlist is policy.js's, option for option; the label's options are the row's, in its order, the same
    // kept.
    const key = (o) => `${o.tile}|${o.ability?.id ?? ''}|${o.target?.uid ?? ''}|${o.fusion?.id ?? ''}`
    const g = fork(p.board)
    const gs = situation(g)
    gs.plan = readPlan(g, gs)
    assert.deepEqual(optionsAt(g, g.byUid.get(p.uid), gs).short.map(key), view.short.map(key))
    const same = (o, r) => o.tile === r.tile && (o.ability?.id ?? null) === r.ability && (o.target?.uid ?? null) === r.target && (o.fusion?.id ?? null) === r.fusion
    assert.equal(view.label.length, row.options.length)
    view.label.forEach((o, i) => {
      assert.ok(same(o, row.options[i]), `option ${i}`)
      assert.equal(view.kept.has(o), !!row.options[i].kept)
    })
    const mean = meanOf(row.options.filter((r) => r.kept).map(rowView))
    assert.deepEqual(Array.from(view.mean), Array.from(mean))
    row.options.forEach((r, i) => {
      assert.deepEqual(Array.from(encode(c, u.id, playView(view.label[i]), view.mean)), Array.from(encode(row.sit, row.kind, rowView(r), mean)))
      compared++
    })
  }
  assert.ok(compared > 20)
})

test('the loss\'s gradient is its finite difference', () => {
  const net = createNet({ inputs: 5, hidden: [4, 3], seed: 2 })
  const rand = mulberry(9)
  net.W[2] = net.W[2].map(() => rand() - 0.5)
  net.b = net.b.map((v) => v.map(() => rand() * 0.2))
  const start = Int32Array.from([0, 3, 5, 9])
  const m = 9
  const X = Float64Array.from({ length: m * 5 }, () => rand() * 2 - 1)
  const base = Float64Array.from({ length: m }, () => rand())
  const q = new Float64Array(m)
  for (let p = 0; p < 3; p++) {
    let s = 0
    for (let i = start[p]; i < start[p + 1]; i++) s += (q[i] = rand())
    for (let i = start[p]; i < start[p + 1]; i++) q[i] /= s
  }
  const batch = { X, m, start, base, q, w: Float64Array.from([1, 2, 0.5]) }
  const grads = gradsFor(net)
  listLoss(net, batch, 1.3, grads)
  const h = 1e-6
  for (let l = 0; l < net.W.length; l++) {
    for (const [P, G] of [[net.W[l], grads.W[l]], [net.b[l], grads.b[l]]]) {
      for (let i = 0; i < P.length; i++) {
        const x = P[i]
        P[i] = x + h
        const up = listLoss(net, batch, 1.3)
        P[i] = x - h
        const down = listLoss(net, batch, 1.3)
        P[i] = x
        const num = (up - down) / (2 * h)
        assert.ok(Math.abs(num - G[i]) < 1e-6 * Math.max(1, Math.abs(num)), `layer ${l} [${i}]: ${num} against ${G[i]}`)
      }
    }
  }
})

test('an untrained ranker plays today\'s expert move for move over whole battles; with none, today\'s', () => {
  const before = rankerModel()
  try {
    useRanker(null)
    const today = battles('rank-test-2', 2).log
    useRanker(untrained())
    const notes = []
    assert.deepEqual(battles('rank-test-2', 2).log, today)
    for (const b of boards()) {
      useRanker(null)
      const plain = expertTurn(fork(b))
      useRanker(untrained())
      assert.deepEqual(expertTurn(fork(b), { note: (r) => notes.push(r) }), plain)
    }
    assert.ok(notes.some((r) => r.decision === 'battle'))
    assert.ok(notes.every((r) => r.by !== 'net' && !r.margin))
  } finally {
    useRanker(before)
  }
})

test('a ranker decides deterministically, legal orders; where its net changes today\'s choice, the audit says net and its margin', () => {
  const before = rankerModel()
  try {
    let nets = 0
    for (const seed of [5, 6, 7, 8]) {
      useRanker(drawn(seed, 20))
      for (const b of boards()) {
        const notes = []
        const orders = expertTurn(fork(b), { note: (r) => notes.push(r) })
        assert.deepEqual(expertTurn(fork(b)), orders)
        assert.deepEqual(orders.at(-1), { type: 'end' })
        for (const r of notes.filter((x) => x.by === 'net')) {
          assert.ok(r.margin > -1e-6, `${r.margin}`)
          nets++
        }
      }
    }
    assert.ok(nets > 0, 'some net decided')
  } finally {
    useRanker(before)
  }
})

test('the play\'s net is the training\'s, through ranker.json and back; a fit is deterministic', async () => {
  // Label rows on disk (teach.js's shape): a piece of each position's options, the one that guards the Monarch the most
  // winning the battle, today's score preferring damage.
  const rand = mulberry(11)
  const rows = []
  for (let k = 0; k < 120; k++) {
    const options = Array.from({ length: 4 }, (_, i) => {
      const f = { damage: Math.round(rand() * 20), guard: Math.round(rand() * 10), danger: Math.round(rand() * 5) }
      return { i, tile: 10 + i, steps: i % 2, ability: i ? 'strike' : null, target: i ? 9 : null, fusion: null, f, prior: 2 * f.damage, kept: 1, legal: 1, chosen: 0, value: 0 }
    })
    const best = options.reduce((a, o) => (o.f.guard > a.f.guard ? o : a))
    for (const o of options) o.value = o === best ? -0.1 : -10
    const top = options.reduce((a, o) => (o.prior > a.prior ? o : a))
    top.chosen = 1
    rows.push({ id: `p${k}`, seed: `syn-${k}`, run: k, floor: 1, group: 2, wt: 1, kind: 'frost_sprite', sit: { turn: k % 7, 'monarch.danger': k % 3 }, options, chosen: top.i })
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retinue-ranker-test-'))
  try {
    fs.writeFileSync(path.join(dir, 'labels.jsonl'), rows.map((r) => JSON.stringify(r) + '\n').join(''))
    const d = await readLabels([dir])
    assert.equal(d.meta.length, rows.length)
    const cfg = { epochs: 3, batch: 8, hidden: [8, 4] }
    const a = fitRanker(d, cfg)
    const b = fitRanker(d, cfg)
    assert.deepEqual({ ...a.config, made: null }, { ...b.config, made: null })
    const config = checkRanker(JSON.parse(JSON.stringify(a.config)))
    assert.ok(config.scale > 0)
    assert.ok(a.net.W[2].some((w) => w !== 0), 'the last layer learned')
    // The play's scorer reads a row as the training did: the same net output, as far as ranker.json's rounding.
    const { net, S } = netOf(config)
    assert.ok(net.W.length === 3 && S.mean.length === D && config.inputs.length === D)
    rows.slice(0, 10).forEach((row, p) => {
      const mean = meanOf(row.options.map(rowView))
      const score = scorer(config, row.sit, row.kind)
      row.options.forEach((o, i) => {
        const y = score(rowView(o), mean)
        const t = a.O[d.start[p] + i]
        assert.ok(Math.abs(y - t) < 1e-4 * Math.max(1, Math.abs(t)), `${y} against ${t}`)
      })
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a job\'s ranker is installed for its run and the one before put back; pairedStats compares seed for seed', () => {
  const before = rankerModel()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retinue-ranker-job-'))
  try {
    const file = path.join(dir, 'r.json')
    fs.writeFileSync(file, JSON.stringify(untrained()))
    const mine = drawn(4)
    useRanker(mine)
    assert.equal(withRanker('none', () => rankerModel()), null)
    assert.equal(rankerModel(), mine)
    assert.equal(withRanker(file, () => rankerModel().name), 'test')
    assert.equal(rankerModel(), mine)
    assert.equal(withRanker(undefined, () => rankerModel()), mine)
    assert.throws(() => withRanker(file, () => { throw new Error('inside') }), /inside/)
    assert.equal(rankerModel(), mine)
    const r = record({ seed: 'rank-test-9', level: 'expert', ranker: file })
    assert.equal(r.ranker, 'test')
    assert.equal(rankerModel(), mine)
    assert.equal(record({ seed: 'rank-test-9', level: 'expert', ranker: 'none' }).ranker, null)
    assert.equal(rankerModel(), mine)
  } finally {
    useRanker(before)
    fs.rmSync(dir, { recursive: true, force: true })
  }
  const run = (result, progress, won = [true]) => ({ result, progress, floor: 2, secs: 1, battles: won.map((w) => ({ won: w })) })
  const S = pairedStats([run('victory', 1), run('defeat', 0.5), run('defeat', 0.2, [true, false])], [run('defeat', 0.9, [false]), run('victory', 1), run('defeat', 0.3)])
  assert.equal(S.runs, 3)
  assert.equal(S.won, 1)
  assert.equal(S.lost, 1)
  assert.equal(S.a.clears, 1)
  assert.equal(S.b.battles, 3)
  assert.ok(Math.abs(S.diff - 100 * (-0.1 + 0.5 + 0.1) / 3) < 1e-9)
  assert.ok(S.se > 0)
})

// A run's first battle labelled (teach.js teachRun: every decision kept, its options played out a round), as rows.
const labelled = (seed, limit = 5) => teachRun(seed, { battles: 1, limit, rounds: 1, keep: { lost: 1, near: 1, reach: 1, calm: 1 } }).positions

test('the afterstates: the augmentation replays the run to each row\'s board, and its afterstates are play\'s, number for number', () => {
  const before = rankerModel()
  try {
    useRanker(null)
    const rows = labelled('rank-test-4')
    assert.ok(rows.length >= 3)
    const { rows: aug } = augmentRun({ seed: 'rank-test-4', positions: rows }, { ranker: null })
    assert.equal(aug.length, rows.length)
    assert.ok(aug.every((x) => x.same && !x.missed), 'every row\'s board met again')
    const { points } = battles('rank-test-4', 1)
    let compared = 0
    for (const row of rows) {
      const x = aug.find((r) => r.id === row.id)
      // The same decision in play: the board as the piece decided, its options as the ranker reads them.
      const p = points.find((q) => q.at === row.at && q.uid === row.uid)
      if (!p) continue
      const f = fork(p.board)
      const u = f.byUid.get(row.uid)
      const sit = situation(f)
      sit.plan = readPlan(f, sit)
      const opts = expertOptions(f, u)
      for (const o of opts) {
        o.v = features(f, u, o, sit)
        o.road = -o.path.length
      }
      const c = conditions(sit, u)
      const view = rankerView(f, u, sit, opts, c)
      const mean = meanOf(row.options.filter((r) => r.kept).map((r) => rowView(r)))
      row.options.forEach((r, i) => {
        const o = view.label[i]
        o.after = afterOf(f, u, o, sit.plan)
        const live = encode(c, u.id, playView(o), view.mean)
        const read = encode(row.sit, row.kind, rowView(r, rowAfter(row.sit, x.a[i], afterNames())), mean)
        assert.deepEqual(Array.from(live), Array.from(read), `${row.id} option ${i}`)
        compared++
      })
    }
    assert.ok(compared > 10, `${compared} compared`)
    // The board's own read: afterRow on the row's board again gives the same.
    assert.deepEqual(augmentRun({ seed: 'rank-test-4', positions: rows }, { ranker: null }).rows, aug)
  } finally {
    useRanker(before)
  }
})

test('a ranker that reads no afterstate never reads one; one whose afterstate weighs nothing plays as it; one that weighs it decides alike twice', () => {
  const before = rankerModel()
  try {
    const plain = untrained()
    assert.equal(readsAfter(plain), false)
    // The same net over all the inputs, the afterstate's first-layer weights zero: the same decisions, read with it.
    const base = drawn(9, 20)
    const net = createNet({ inputs: ALL.length, seed: 3 })
    const at = ALL.map((n) => BASE.indexOf(n))
    const J = net.sizes[1]
    net.W[0] = Float64Array.from({ length: ALL.length * J }, (_, k) => (at[Math.floor(k / J)] >= 0 ? base.net.W[0][at[Math.floor(k / J)] * J + (k % J)] : 0))
    net.W[1] = Float64Array.from(base.net.W[1])
    net.W[2] = Float64Array.from(base.net.W[2])
    const wide = configOf(net, { name: 'wide', inputs: ALL })
    assert.equal(readsAfter(wide), true)
    for (const b of boards()) {
      useRanker(base)
      const orders = expertTurn(fork(b))
      useRanker(wide)
      assert.deepEqual(expertTurn(fork(b)), orders)
    }
    useRanker(null)
    const today = battles('rank-test-2', 1).log
    useRanker(untrained(ALL))
    assert.deepEqual(battles('rank-test-2', 1).log, today, 'an untrained ranker with the afterstate is today\'s expert too')
    useRanker(drawn(6, 20, ALL))
    const a = battles('rank-test-2', 1).log
    assert.deepEqual(battles('rank-test-2', 1).log, a)
  } finally {
    useRanker(before)
  }
})
