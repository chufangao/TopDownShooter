// Learned risk (redesign.md §2.20; src/sim/risk.js): the two models read off risk.json over the features risk.js
// reads, probabilities in [0, 1], monotone where the board says plainly which way, deterministic, and the fitter's
// arithmetic. Functional only: what the models are worth is the fit's report (--fit), not a test's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  positionRisk, positionFeatures, roomRisk, roomRiskFeatures, POSITION_FEATURES, ROOM_FEATURES, POSITION_K, RISK, fitLogistic, auc
} from '../src/sim/risk.js'
import { createRun } from '../src/sim/run.js'
import { on, scene } from './scene.js'

// The Monarch on (3,0) at `share` of its HP, a Tomb Knight of yours aside at (0,2), a Tomb Knight of the camp far off
// (so the battle stands), and `shooters` Bone Chanters of the camp (Marrow Bolt: range 4, keeps to a line) each with a
// clear line to the Monarch; with `screen`, a Tomb Knight of yours on each of their lines instead.
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
const feature = (x, name) => x[POSITION_FEATURES.indexOf(name)]

test('risk.json holds both models, over the features risk.js reads', () => {
  for (const [name, features] of [['position', POSITION_FEATURES], ['room', ROOM_FEATURES]]) {
    const m = RISK[name]
    assert.ok(m, `a ${name} model`)
    assert.deepEqual(m.features, features, `${name}: the json's features are the file's, in its order`)
    for (const k of ['mean', 'sd', 'w']) {
      assert.equal(m[k].length, features.length, `${name}.${k}`)
      assert.ok(m[k].every(Number.isFinite), `${name}.${k} finite`)
    }
    assert.ok(Number.isFinite(m.b))
    assert.ok(m.sd.every((v) => v > 0))
  }
  assert.ok([2, 3].includes(POSITION_K), 'the fall within 2 or 3 turns')
  assert.equal(new Set(POSITION_FEATURES).size, POSITION_FEATURES.length)
  assert.equal(new Set(ROOM_FEATURES).size, ROOM_FEATURES.length)
})

test('the position read: what the board shows of the Monarch\'s danger and the lines on it', () => {
  const open = positionFeatures(board({ share: 0.5, shooters: 3 }))
  assert.equal(open.length, POSITION_FEATURES.length)
  assert.equal(feature(open, 'share'), 0.5)
  assert.equal(feature(open, 'linesNow'), 3, 'three clear lines now')
  assert.equal(feature(open, 'strikers'), 3)
  assert.ok(feature(open, 'danger') > 0)
  const screened = positionFeatures(board({ share: 0.5, shooters: 3, screen: true }))
  assert.equal(feature(screened, 'linesNow'), 0, 'every line stood in')
  assert.equal(feature(screened, 'screened'), 3)
  assert.equal(feature(screened, 'danger'), 0)
  const none = positionFeatures(board())
  assert.equal(feature(none, 'danger'), 0)
  assert.equal(feature(none, 'idle'), 1, 'a turn\'s start: every piece yet to act')
})

test('probabilities in [0, 1]; 0 for a battle over or with no Monarch', () => {
  for (const share of [0.05, 0.3, 1]) {
    for (const shooters of [0, 1, 2, 3]) {
      for (const screen of [false, true]) {
        const p = positionRisk(board({ share, shooters, screen }))
        assert.ok(p >= 0 && p <= 1, `${share} ${shooters} ${screen}: ${p}`)
      }
    }
  }
  const b = scene([on('tomb_knight', 1, 'party', 3, 0), on('bone_chanter', 101, 'foe', 3, 4)])
  assert.equal(positionFeatures(b), null)
  assert.equal(positionRisk(b), 0)
  const over = board({ shooters: 1 })
  over.over = true
  assert.equal(positionRisk(over), 0)
})

test('monotone where the board is plain: the Monarch\'s wounds, and clear lines on it', () => {
  const risk = (o) => positionRisk(board(o))
  assert.ok(risk({ share: 0.1, shooters: 3 }) > risk({ share: 1, shooters: 0 }), 'at 10% under three clear lines, riskier than whole under none')
  for (const shooters of [0, 1, 3]) {
    let last = -1
    for (const share of [1, 0.6, 0.3, 0.1]) {
      const p = risk({ share, shooters })
      assert.ok(p > last, `${shooters} shooter(s): riskier as its HP falls (${share}: ${p} after ${last})`)
      last = p
    }
  }
  for (const share of [1, 0.3, 0.1]) {
    let last = -1
    for (const shooters of [0, 1, 2, 3]) {
      const p = risk({ share, shooters })
      assert.ok(p > last, `at ${share}: riskier with each clear line (${shooters}: ${p} after ${last})`)
      last = p
    }
    assert.ok(risk({ share, shooters: 3, screen: true }) < risk({ share, shooters: 3 }), `at ${share}: its lines stood in, safer`)
  }
})

test('deterministic, and reading leaves the board as it was', () => {
  const b = board({ share: 0.3, shooters: 2 })
  const before = JSON.stringify(b.units.map((u) => [u.uid, u.hp, u.tile, u.statuses, u.cooldowns, u.acted]))
  const p = positionRisk(b)
  assert.equal(positionRisk(b), p)
  assert.equal(positionRisk(board({ share: 0.3, shooters: 2 })), p, 'the same board, the same risk')
  assert.deepEqual([...positionFeatures(b)], [...positionFeatures(board({ share: 0.3, shooters: 2 }))])
  assert.equal(JSON.stringify(b.units.map((u) => [u.uid, u.hp, u.tile, u.statuses, u.cooldowns, u.acted])), before)
})

test('cheap: a position read in well under a millisecond', () => {
  const b = board({ share: 0.3, shooters: 3 })
  positionRisk(b)
  const n = 500
  const t0 = performance.now()
  for (let i = 0; i < n; i++) positionRisk(b)
  assert.ok((performance.now() - t0) / n < 1, 'under 1 ms a read (the budget is 0.2 ms; it takes tens of µs)')
})

test('room risk: 0 for a room with no battle; a probability for a battle room; a wounded army riskier', () => {
  const run = createRun({ seed: 'risk-test' })
  const nodes = run.state.map.nodes
  const quiet = nodes.filter((n) => n.type === 'shop' || n.type === 'altar')
  assert.ok(quiet.length)
  for (const n of quiet) {
    assert.equal(roomRiskFeatures(run, n), null)
    assert.equal(roomRisk(run, n), 0)
  }
  const battles = nodes.filter((n) => ['fight', 'elite', 'siege', 'boss'].includes(n.type))
  assert.ok(battles.some((n) => n.type === 'fight') && battles.some((n) => n.type === 'elite'))
  const whole = battles.map((n) => roomRisk(run, n))
  for (const p of whole) assert.ok(p > 0 && p < 1)
  assert.deepEqual(battles.map((n) => roomRisk(run, n)), whole, 'deterministic')
  const x = roomRiskFeatures(run, battles.find((n) => n.type === 'elite'))
  assert.equal(x.length, ROOM_FEATURES.length)
  assert.equal(x[ROOM_FEATURES.indexOf('elite')], 1)
  for (const u of run.state.party) u.hp = Math.max(1, Math.round(u.maxHp * 0.1))
  battles.forEach((n, i) => assert.ok(roomRisk(run, n) > whole[i], `${n.type} ${n.id}: riskier with every soul and the Monarch at 10%`))
})

test('the fitter: a planted weight recovered in sign and order, and the AUC\'s ends', () => {
  const n = 4000
  const d = 3
  const X = new Float32Array(n * d)
  const y = new Uint8Array(n)
  // A deterministic stream; y from 2·x0 − x1 + 0·x2 through the logistic, thresholded by the stream.
  let s = 7
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) X[i * d + j] = rand() * 4 - 2
    y[i] = rand() < 1 / (1 + Math.exp(-(2 * X[i * d] - X[i * d + 1]))) ? 1 : 0
  }
  const m = fitLogistic(X, y, n, d, 1)
  const w = m.w.map((v, j) => v / m.sd[j])
  assert.ok(w[0] > 1.5 && w[0] < 2.5, `x0 ≈ 2: ${w[0]}`)
  assert.ok(w[1] < -0.6 && w[1] > -1.4, `x1 ≈ −1: ${w[1]}`)
  assert.ok(Math.abs(w[2]) < 0.2, `x2 ≈ 0: ${w[2]}`)
  assert.equal(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]), 1)
  assert.equal(auc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1]), 0)
  assert.equal(auc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1]), 0.5)
})
