// The measuring speed-ups (necessity report, Speed 2): the progress score a run is read by, a rehearsal that ends
// once its result is settled, and the formation search's pruning of rolls that cannot change its choice.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRun, apply, availableNodes, battleSetup, monarchOf } from '../src/sim/run.js'
import { createBattle, playOut } from '../src/sim/battle.js'
import { createRng } from '../src/sim/rng.js'
import { progressOf, foeShare, routeRooms, ROOMS_PER_FLOOR, record, policy, planFor, LEVELS, memoStats, scoreOf, BEST, autoplay } from '../src/sim/autoplay.js'
import { TUNING } from '../src/tuning.js'

// A run standing in its first fight's prep (rank 1 is all fights).
function inFight (seed) {
  const run = createRun({ seed })
  apply(run, { type: 'node', id: availableNodes(run)[0].id })
  assert.equal(run.state.phase, 'prep')
  return run
}

test('progress: 1 for a clear, in [0, 1] otherwise, and rising with every room completed', () => {
  assert.equal(routeRooms(), ROOMS_PER_FLOOR * TUNING.run.floors)
  assert.equal(progressOf({ result: 'victory', floor: TUNING.run.floors, rank: ROOMS_PER_FLOOR }), 1)
  let last = -Infinity
  for (let floor = 1; floor <= TUNING.run.floors; floor++) {
    for (let rank = 1; rank <= ROOMS_PER_FLOOR; rank++) {
      const none = progressOf({ result: 'defeat', floor, rank, share: 0 })
      const half = progressOf({ result: 'defeat', floor, rank, share: 0.5 })
      assert.equal(none, ((floor - 1) * ROOMS_PER_FLOOR + rank - 1) / routeRooms())
      assert.ok(none > last && half > none, `monotone at floor ${floor} rank ${rank}`)
      assert.ok(none >= 0 && half < 1)
      last = half
    }
  }
  assert.equal(progressOf({ result: 'defeat', floor: 1, rank: 1, share: -0.5 }), 0)
  assert.equal(progressOf({ result: 'defeat', floor: 1, rank: 1, share: 2 }), 1 / routeRooms())
})

test('progress in a record: where the run fell and the share of that battle\'s foe HP it removed', () => {
  for (const seed of ['prog-0', 'prog-1', 'prog-2']) {
    const r = record({ seed, level: 'basic' })
    assert.ok(r.progress >= 0 && r.progress <= 1)
    assert.equal(r.progress === 1, r.result === 'victory')
    if (r.result !== 'victory') {
      assert.ok(r.fell.rank >= 1 && r.fell.rank <= ROOMS_PER_FLOOR && r.fell.share >= 0 && r.fell.share <= 1)
      assert.equal(r.progress, progressOf({ result: r.result, floor: r.floor, ...r.fell }))
    }
  }
  // A battle's foe share: none removed at the start, all of it once every foe is down.
  const run = inFight('share')
  const b = createBattle(battleSetup(run))
  assert.equal(foeShare(b), 0)
  playOut(b)
  if (b.winner === 'party') assert.equal(foeShare(b), 1)
  assert.ok(foeShare(b) >= 0 && foeShare(b) <= 1)
})

test('settle: a rehearsal may end once its result is settled, never a battle without it, and with the same verdict here', () => {
  const S = TUNING.autoplay.settle
  assert.ok(S && S.k >= 1)
  let settledWins = 0
  for (const seed of ['settle-0', 'settle-1', 'settle-2', 'settle-3', 'settle-4', 'settle-5']) {
    const run = inFight(seed)
    for (let a; (a = policy(run, createRng(seed).stream('autoplay'), 'basic')).type !== 'fight';) apply(run, a)
    // Foes of four times their HP: a fight long enough for a won verdict to hold its window.
    const setup = { ...battleSetup(run), foeMods: [...battleSetup(run).foeMods, { path: 'hp', op: 'mul', v: 4 }] }
    const full = playOut(createBattle({ ...setup, quiet: true }))
    const quick = playOut(createBattle({ ...setup, quiet: true, settle: S }))
    assert.notEqual(full.reason, 'settled')
    assert.ok(quick.t <= full.t)
    assert.equal(quick.winner, full.winner, seed)
    assert.ok(scoreOf(quick) <= BEST)
    if (quick.reason === 'settled' && quick.winner === 'party') {
      settledWins++
      // A won verdict ends a rehearsal only once it has held, unbroken, for the look back's window.
      assert.ok(quick.won !== null && quick.t - quick.won >= S.window, `${seed}: won from ${quick.won}, settled at ${quick.t}`)
    }
  }
  assert.ok(settledWins > 0, 'some won rehearsal ends before its last foe falls')
  // The Monarch alone, Arise taken away and no one to come: a loss, settled once the look back is full.
  const run = inFight('alone')
  const setup = { ...battleSetup(run), party: [monarchOf(run.state)], reserve: [], ablate: ['arise'] }
  const alone = playOut(createBattle({ ...setup, quiet: true, settle: S }))
  assert.deepEqual([alone.winner, alone.reason], ['foe', 'settled'])
  assert.ok(alone.t <= S.window + S.every)
  // A real fight never settles.
  const real = autoplay(createRun({ seed: 'settle-real' }), { level: 'basic' })
  assert.ok(real.state.phase === 'over' && real.battle.reason !== 'settled')
})

test('pruning: "finalists" is exact (the plan with every roll fought); "best" fights fewer rehearsals still', () => {
  const was = TUNING.autoplay.prune
  const plans = {}
  const fought = {}
  try {
    for (const mode of [null, 'finalists', 'best']) {
      TUNING.autoplay.prune = mode
      const before = memoStats.misses
      // The memo keys on TUNING, so each mode fights its rehearsals afresh.
      plans[mode] = ['prune-0', 'prune-1'].map((seed) => planFor(inFight(seed), LEVELS.expert))
      fought[mode] = memoStats.misses - before
    }
  } finally {
    TUNING.autoplay.prune = was
  }
  assert.deepEqual(plans.finalists, plans.null)
  assert.ok(fought.finalists <= fought.null && fought.best <= fought.finalists, JSON.stringify(fought))
  assert.ok(fought.best < fought.null)
})
