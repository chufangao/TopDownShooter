// The learned expert's value (redesign.md §2.21; src/sim/value.js, src/sim/train.js): the encoding (shapes, slots, what
// a player sees and nothing more), the network (a gradient check, determinism, Adam), value.json (load and save, none
// without weights), the forward's cost, and the trainer's labels and replays. Functional only: what V is worth is the
// fit's report (npm run train), not a test's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FEATURES, GLOBAL, FOE, PIECE, FOE_SLOTS, PIECE_SLOTS, encode, value, values, predict, loaded, load, weights, createNet, gradsFor,
  batchLoss, forwardAll, adam, toJSON, fromJSON, forwardBatch, mulberry, VALUE, OUTPUTS, mix
} from '../src/sim/value.js'
import { lambdaReturns, positionsOf, replayTo, replayPlan, weightedAuc, META } from '../src/sim/train.js'
import { fork } from '../src/sim/turns.js'
import { createRun, apply, availableNodes, START_PARTY } from '../src/sim/run.js'
import { TUNING } from '../src/tuning.js'
import { on, scene } from './scene.js'

const D = FEATURES.length
const at = (name) => FEATURES.indexOf(name)

// The Monarch on (3,0) at `share` of its HP, a Tomb Knight of yours aside at (0,2), a Tomb Knight of the camp far off,
// and `shooters` Bone Chanters of the camp (Marrow Bolt: range 4, keeps to a line) each with a clear line to the
// Monarch; with `screen`, a Tomb Knight of yours on each of their lines.
const SPOTS = [[3, 4], [1, 3], [5, 3]]
const SCREENS = [[3, 2], [2, 2], [4, 2]]
function board ({ share = 1, shooters = 0, screen = false } = {}) {
  const b = scene([
    on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 2), on('tomb_knight', 100, 'foe', 6, 10),
    ...SPOTS.slice(0, shooters).map(([x, y], i) => on('bone_chanter', 101 + i, 'foe', x, y)),
    ...(screen ? SCREENS.slice(0, shooters).map(([x, y], i) => on('tomb_knight', 2 + i, 'party', x, y)) : [])
  ])
  b.monarch.hp = Math.max(1, Math.round(b.monarch.maxHp * share))
  return b
}

// A full-size net with standardisation, as value.json holds one (random weights, a fixed seed).
function fullJson (seed = 3) {
  const net = createNet({ inputs: D, seed })
  const r = mulberry(seed)
  return toJSON(net, { mean: Float64Array.from({ length: D }, () => r() - 0.5), sd: Float64Array.from({ length: D }, () => 0.5 + r()) })
}

// The training forward on a raw encoding (standardised by the json's mean and sd): the raw outputs.
function slowForward (json, x) {
  const { net, mean, sd } = fromJSON(json)
  const z = Float64Array.from(x, (v, j) => (v - mean[j]) / sd[j])
  const acts = forwardAll(net, z, 1)
  return Array.from(acts[acts.length - 1])
}

// Runs `fn` with value.json's weights swapped for `json` (null: none), then puts them back.
function withWeights (json, fn) {
  const had = weights()
  load(json)
  try {
    return fn()
  } finally {
    load(had)
  }
}

test('the features: named once each, the globals then 12 foe slots then 10 piece slots', () => {
  assert.equal(new Set(FEATURES).size, D)
  assert.equal(D, GLOBAL.length + FOE_SLOTS * FOE.length + PIECE_SLOTS * PIECE.length)
  assert.equal(FEATURES[GLOBAL.length], 'foe1.' + FOE[0])
  assert.equal(FEATURES.at(-1), `piece${PIECE_SLOTS}.${PIECE.at(-1)}`)
})

test('encode: a Float32Array of FEATURES, finite, deterministic, the same on a fork, filling `out`', () => {
  const b = board({ share: 0.5, shooters: 2 })
  const x = encode(b)
  assert.ok(x instanceof Float32Array)
  assert.equal(x.length, D)
  assert.ok(x.every(Number.isFinite))
  assert.deepEqual(encode(b), x)
  assert.deepEqual(encode(fork(b)), x)
  const out = new Float32Array(D).fill(7)
  assert.equal(encode(b, out), out)
  assert.deepEqual(out, x)
})

test('encode reads the board: the Monarch\'s wounds, the lines on it, the screen, the slots by road', () => {
  const open = encode(board({ share: 0.5, shooters: 3 }))
  assert.equal(open[at('share')], 0.5)
  assert.equal(open[at('linesNow')], 3)
  assert.equal(open[at('strikers')], 3)
  assert.ok(open[at('danger')] > 0)
  assert.equal(open[at('foes')], 4)
  // The three shooters stand nearer the Monarch by road than the knight far off: slots 1–3, each with its clear line.
  for (let i = 1; i <= 3; i++) assert.equal(open[at(`foe${i}.line`)], 1, `foe${i}`)
  assert.equal(open[at('foe4.line')], 0)
  assert.ok(open[at('foe4.ehp')] > 0, 'the knight in the fourth slot')
  for (let i = 5; i <= FOE_SLOTS; i++) for (const f of FOE) assert.equal(open[at(`foe${i}.${f}`)], 0, `empty slot foe${i}.${f}`)
  for (const f of PIECE) assert.equal(open[at(`piece2.${f}`)], 0, `empty slot piece2.${f}`)
  const screened = encode(board({ share: 0.5, shooters: 3, screen: true }))
  assert.equal(screened[at('linesNow')], 0)
  assert.equal(screened[at('screened')], 3)
  assert.equal(screened[at('danger')], 0)
  const screens = [1, 2, 3, 4].reduce((n, i) => n + screened[at(`piece${i}.screen`)], 0)
  assert.equal(screens, 3, 'each screen stands first on a line of fire')
  for (let i = 1; i <= 3; i++) assert.equal(screened[at(`foe${i}.line`)], -1)
  // Acting is read: a piece that has acted, and the share yet to.
  const b = board({ shooters: 1 })
  assert.equal(encode(b)[at('idle')], 1)
  b.byUid.get(1).acted = true
  const x = encode(b)
  assert.equal(x[at('idle')], 0)
  assert.equal(x[at('piece1.acted')], 1)
})

test('encode reads nothing hidden: not the camp\'s pressure, and nothing of the battle changes', () => {
  const b = board({ share: 0.6, shooters: 2 })
  b.turn = 7
  b.foeIn = 2
  const snap = (x) => JSON.stringify(x.units.map((u) => [u.uid, u.hp, u.tile, u.acted, u.moved, u.statuses, u.cooldowns]))
  const before = snap(b)
  const events = b.events.length
  const x = encode(b)
  assert.equal(snap(b), before)
  assert.equal(b.events.length, events, 'no turn played')
  assert.equal(b.turn, 7)
  const press = { ...TUNING.policy.press }
  try {
    TUNING.policy.press.turns = 1
    TUNING.policy.press.strength = 5
    assert.deepEqual(encode(fork(b)), x, 'the pressure\'s settings change nothing V reads')
  } finally {
    Object.assign(TUNING.policy.press, press)
  }
  // The counts a player sees do: the turns since the last wave.
  b.foeIn = 6
  assert.notDeepEqual(encode(fork(b)), x)
})

test('the network\'s gradient matches finite differences (every parameter, weighted rows, all three outputs)', () => {
  const net = createNet({ inputs: 6, hidden: [5, 4], seed: 11 })
  const r = mulberry(5)
  // Bigger weights than the init's, so every unit has some say.
  for (const w of net.W) for (let i = 0; i < w.length; i++) w[i] = (r() - 0.5) * 1.5
  for (const v of net.b) for (let i = 0; i < v.length; i++) v[i] = (r() - 0.5) * 0.5
  const n = 7
  const X = Float64Array.from({ length: n * 6 }, () => (r() - 0.5) * 3)
  const Y = Float64Array.from({ length: n * OUTPUTS }, (_, i) => (i % 3 === 0 ? r() : (r() - 0.5) * 0.4))
  const wt = Float64Array.from({ length: n }, () => 0.5 + r())
  const norms = [0.3, 0.02, 0.05]
  const g = gradsFor(net)
  batchLoss(net, X, Y, n, norms, g, wt)
  const h = 1e-6
  let worst = 0
  for (const [list, glist] of [[net.W, g.W], [net.b, g.b]]) {
    for (let l = 0; l < list.length; l++) {
      for (let i = 0; i < list[l].length; i++) {
        const keep = list[l][i]
        list[l][i] = keep + h
        const up = batchLoss(net, X, Y, n, norms, null, wt)
        list[l][i] = keep - h
        const down = batchLoss(net, X, Y, n, norms, null, wt)
        list[l][i] = keep
        const num = (up - down) / (2 * h)
        const err = Math.abs(num - glist[l][i]) / Math.max(1e-4, Math.abs(num) + Math.abs(glist[l][i]))
        worst = Math.max(worst, err)
      }
    }
  }
  assert.ok(worst < 1e-5, `worst relative error ${worst}`)
})

test('the network is deterministic: one seed one net, one data one training; Adam brings the loss down', () => {
  const a = createNet({ inputs: 10, seed: 4 })
  const b = createNet({ inputs: 10, seed: 4 })
  assert.deepEqual(a, b)
  assert.notDeepEqual(createNet({ inputs: 10, seed: 5 }).W[0], a.W[0])
  assert.deepEqual(a.sizes, [10, 64, 64, OUTPUTS])
  const r = mulberry(9)
  const n = 64
  const X = Float64Array.from({ length: n * 10 }, () => r() * 2 - 1)
  // A rule to learn: won while the first input is positive; the losses its second and third.
  const Y = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) {
    Y[i * 3] = X[i * 10] > 0 ? 1 : 0
    Y[i * 3 + 1] = 0.1 * X[i * 10 + 1]
    Y[i * 3 + 2] = 0.1 * X[i * 10 + 2]
  }
  const norms = [0.69, 0.003, 0.003]
  const train = (net) => {
    const g = gradsFor(net)
    const s = {}
    const first = batchLoss(net, X, Y, n, norms)
    for (let k = 0; k < 150; k++) {
      batchLoss(net, X, Y, n, norms, g)
      adam(net, g, s, { lr: 3e-3, l2: 1e-5 })
    }
    return [first, batchLoss(net, X, Y, n, norms)]
  }
  const [first, last] = train(a)
  train(b)
  assert.deepEqual(a, b, 'the same training, the same weights')
  assert.ok(last < first / 5, `${first} → ${last}`)
})

test('value is null with no weights; predict and values too', () => {
  withWeights(null, () => {
    assert.equal(loaded(), false)
    const b = board({ shooters: 1 })
    assert.equal(value(b), null)
    assert.equal(predict(b), null)
    assert.equal(values([b]), null)
    assert.equal(forwardBatch(encode(b), 1), null)
  })
})

test('value.json: save and load round trip, the play forward (folded, sparse) is the training forward', () => {
  const json = fullJson()
  const again = JSON.parse(JSON.stringify(json))
  const read = fromJSON(again)
  assert.ok(read)
  assert.deepEqual(read.net.sizes, [D, 64, 64, OUTPUTS])
  assert.equal(fromJSON({ ...again, features: FEATURES.slice(1) }), null, 'a stale json is no net')
  withWeights(again, () => {
    assert.equal(loaded(), true)
    for (const o of [{ shooters: 0 }, { share: 0.3, shooters: 3 }, { share: 0.5, shooters: 3, screen: true }]) {
      const b = board(o)
      const slow = slowForward(again, encode(b))
      const p = predict(b)
      assert.ok(Math.abs(p.won - 1 / (1 + Math.exp(-slow[0]))) < 1e-4, `won ${p.won}`)
      assert.ok(Math.abs(p.monarch - slow[1]) < 1e-4)
      assert.ok(Math.abs(p.own - slow[2]) < 1e-4)
      const v = value(b)
      assert.ok(Math.abs(v - (VALUE.won * p.won - VALUE.monarch * p.monarch - VALUE.own * p.own)) < 1e-6)
      assert.ok(Math.abs(values([b, b])[1] - v) < 1e-6, 'the batch gives each board its own value')
    }
    // A battle over: VALUE.won when won, −VALUE.monarch when lost.
    const won = board({ shooters: 1 })
    won.over = true
    won.winner = 'party'
    assert.equal(value(won), VALUE.won)
    won.winner = 'foe'
    assert.equal(value(won), -VALUE.monarch)
  })
})

test('value.json\'s own combination and its inputs left out: `value` mixes the outputs, `drop` makes those inputs nothing', () => {
  const json = { ...fullJson(), value: { won: 40, monarch: 2, own: 0.5 }, drop: ['idle', 'piece1.ready'] }
  withWeights(json, () => {
    assert.deepEqual({ ...mix() }, { won: 40, monarch: 2, own: 0.5 })
    const b = board({ shooters: 2 })
    const p = predict(b)
    assert.ok(Math.abs(value(b) - (40 * p.won - 2 * p.monarch - 0.5 * p.own)) < 1e-5)
    // An input left out changes nothing: the same board with it read otherwise gives the same outputs.
    const x = encode(b)
    const y = Float32Array.from(x)
    y[at('idle')] += 0.7
    y[at('piece1.ready')] += 1
    const o = forwardBatch(x, 1)
    const q = forwardBatch(y, 1)
    for (let k = 0; k < OUTPUTS; k++) assert.ok(Math.abs(o[k] - q[k]) < 1e-9)
    y[at('danger')] += 1
    assert.notDeepEqual(Array.from(forwardBatch(y, 1)), Array.from(o), 'an input kept still counts')
  })
  // Without its own, the default.
  withWeights(fullJson(), () => assert.equal(mix(), VALUE))
})

test('the forward\'s cost: a board\'s value within a generous bound', () => {
  withWeights(fullJson(), () => {
    const boards = [board({ shooters: 3 }), board({ share: 0.4, shooters: 2, screen: true })]
    for (let k = 0; k < 200; k++) value(boards[k % 2])
    const xs = new Float32Array(64 * D)
    for (let k = 0; k < 64; k++) encode(boards[k % 2], xs.subarray(k * D, (k + 1) * D))
    for (let k = 0; k < 20; k++) forwardBatch(xs, 64)
    let t0 = process.hrtime.bigint()
    for (let k = 0; k < 2000; k++) value(boards[k % 2])
    const each = Number(process.hrtime.bigint() - t0) / 1e3 / 2000
    t0 = process.hrtime.bigint()
    for (let k = 0; k < 50; k++) forwardBatch(xs, 64)
    const row = Number(process.hrtime.bigint() - t0) / 1e3 / (50 * 64)
    assert.ok(each < 500, `value ${each.toFixed(1)} µs a board`)
    assert.ok(row < 200, `batched forward ${row.toFixed(1)} µs a board`)
  })
})

test('TD(λ) returns: λ 1 the result throughout, λ 0 the next turn\'s V, the last turn the result', () => {
  const v = [0.9, 0.8, 0.6, 0.3]
  assert.deepEqual(Array.from(lambdaReturns(v, 0, 1)), [0, 0, 0, 0])
  assert.deepEqual(Array.from(lambdaReturns(v, 1, 0)), [0.8, 0.6, 0.3, 1])
  const y = lambdaReturns(v, 0, 0.5)
  assert.equal(y[3], 0)
  assert.ok(Math.abs(y[2] - 0.15) < 1e-12)
  assert.ok(Math.abs(y[1] - (0.5 * 0.6 + 0.5 * y[2])) < 1e-12)
  assert.equal(weightedAuc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1], [1, 1, 1, 1]), 0.75)
})

// A run that ends its turns at once in every battle (End Turn alone: the untouched strike), as a record of its log:
// its first battle and on, until it is lost or `battles` are fought.
function endingRun (seed, battles = 2) {
  const run = createRun({ start: START_PARTY, seed })
  let fought = 0
  for (let guard = 0; guard < 5000 && run.state.phase !== 'over'; guard++) {
    const s = run.state
    if (s.phase === 'map') {
      if (fought >= battles) break
      apply(run, { type: 'node', id: availableNodes(run)[0].id })
    } else if (s.phase === 'prep') {
      fought++
      apply(run, { type: 'fight' })
    } else if (s.phase === 'battle') apply(run, { type: run.battle.turn > TUNING.turn.guard ? 'stall' : 'end' })
    else if (s.phase === 'reap') apply(run, { type: 'reap', index: null })
    else if (s.phase === 'shop') apply(run, { type: 'leave' })
    else break
  }
  return { seed, result: run.state.result, log: run.state.log.map((a) => ({ ...a })) }
}

test('the trainer\'s positions: labels in range, weights, a lost battle a disaster, its turns replayed exactly', async () => {
  let rec = null
  for (let k = 0; k < 12 && !rec; k++) {
    const r = endingRun(`value-test-${k}`, 3)
    if (r.result === 'defeat') rec = r
  }
  assert.ok(rec, 'a run lost by End Turn alone')
  const p = await positionsOf(rec)
  assert.ok(p.n > 0)
  assert.equal(p.X.length, p.n * D)
  const M = META.length
  for (let i = 0; i < p.n; i++) {
    assert.ok(p.Y[i * 3] === 0 || p.Y[i * 3] === 1)
    assert.equal(p.Y[i * 3], p.Z[i], 'P(won)\'s target the battle\'s result (λ 1)')
    assert.ok(p.Y[i * 3 + 1] <= 1 + 1e-6 && p.Y[i * 3 + 1] >= -1 - 1e-6)
    assert.ok(p.wt[i] >= 1)
    assert.ok([0, 1, 2].includes(p.meta[i * M + 3]))
    // A lost battle's positions are kept whole (weight 1).
    if (p.meta[i * M + 4] === 2) assert.equal(p.wt[i], 1)
  }
  // The lost battle's positions end with the Monarch's fall: at its last turn's start, all it had lost within two.
  const lost = p.disasters.find((d) => d.lost)
  assert.ok(lost, 'the lost battle listed among the disasters')
  assert.equal(p.disasters.filter((d) => d.lost).length, 1)
  // Each listed turn replays to that turn's start, the board as it was.
  for (const t of lost.turns.slice(-2)) {
    const run = await replayTo(rec, t.at)
    assert.equal(run.state.phase, 'battle')
    assert.equal(run.battle.turn, t.turn)
    assert.equal(run.battle.stage, 'party')
    const again = await replayTo(rec, t.at)
    assert.deepEqual(encode(again.battle), encode(run.battle))
  }
  // A replay (train.js replayRun's record: the run's log, read from a turn's start on) gives that battle's positions from
  // there, split with the run it replays: here the run's own log, so the same rows as the run's own from that turn.
  const at = lost.turns.at(-2).at
  const r = await positionsOf({ seed: 'replay-1', base: rec.seed, from: at, log: rec.log })
  assert.ok(r.n > 0 && r.n < p.n)
  for (let i = 0; i < r.n; i++) assert.equal(r.meta[i * M], p.meta[0], 'the replay split with its run')
  const tail = p.n - r.n
  assert.deepEqual(Array.from(r.X), Array.from(p.X.subarray(tail * D)))
  assert.deepEqual(Array.from(r.Y.subarray(r.n * 3 - 3)), Array.from(p.Y.subarray(p.n * 3 - 3)))
  // The replays planned: each disaster of a training run (seed ≢ 0, 1 mod 5) at its last turns' starts, never a replay's.
  const plan = replayPlan([
    { seed: 'v-3', turns: [10, 20, 30, 40, 50, 60].map((a, i) => ({ turn: i + 1, at: a })) },
    { seed: 'v-5', turns: [{ turn: 1, at: 7 }] },
    { seed: 'r-8', base: 'v-8', turns: [{ turn: 1, at: 7 }] }
  ], { prefix: 'p', last: 2, early: 1, times: 2 })
  assert.equal(plan.length, 6)
  assert.ok(plan.every((x) => x.base === 'v-3'))
  assert.deepEqual(plan.slice(2).map((x) => x.at), [50, 50, 60, 60])
  assert.deepEqual(plan.map((x) => x.seed), ['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6'])
})
