// The measuring speed-ups (necessity report, Speed 2): the progress score a run is read by.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRun, apply, availableNodes, battleSetup, START_PARTY } from '../src/sim/run.js'
import { createBattle, playOut } from '../src/sim/turns.js'
import { progressOf, foeShare, routeRooms, ROOMS_PER_FLOOR, record } from '../src/sim/autoplay.js'
import { TUNING } from '../src/tuning.js'

// A run standing in its first fight's prep (rank 1 is all fights).
function inFight (seed) {
  const run = createRun({ start: START_PARTY, seed })
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
