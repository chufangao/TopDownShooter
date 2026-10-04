import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRng, hashString } from '../../src/sim/kernel/rng.js'

test('same seed reproduces the same sequence', () => {
  const a = makeRng(42).stream('combat')
  const b = makeRng(42).stream('combat')
  const seqA = Array.from({ length: 64 }, () => a())
  const seqB = Array.from({ length: 64 }, () => b())
  assert.deepEqual(seqA, seqB)
})

test('different seeds diverge', () => {
  const a = Array.from({ length: 16 }, makeRng(1).stream('combat'))
  const b = Array.from({ length: 16 }, makeRng(2).stream('combat'))
  assert.notDeepEqual(a, b)
})

test('numeric and string seeds are the same seed', () => {
  assert.equal(makeRng(7).stream('x')(), makeRng('7').stream('x')())
})

// The reason named streams exist: a cosmetic mod drawing extra numbers must not change your loot.
test('streams are independent — draining one does not move another', () => {
  const r1 = makeRng('run-seed')
  for (let i = 0; i < 1000; i++) r1.stream('mod:kindled')()
  const lootAfterHeavyModUse = Array.from({ length: 8 }, () => r1.stream('loot')())

  const r2 = makeRng('run-seed')
  const lootWithNoMod = Array.from({ length: 8 }, () => r2.stream('loot')())

  assert.deepEqual(lootAfterHeavyModUse, lootWithNoMod)
})

test('stream creation order does not matter', () => {
  const r1 = makeRng(9); r1.stream('a'); r1.stream('b')
  const r2 = makeRng(9); r2.stream('b'); r2.stream('a')
  assert.equal(r1.stream('a')(), r2.stream('a')())
  assert.equal(r1.stream('b')(), r2.stream('b')())
})

test('the same stream name returns the same advancing stream', () => {
  const r = makeRng(3)
  const first = r.stream('combat')()
  const second = r.stream('combat')()
  assert.notEqual(first, second, 'stream() must not restart the sequence')
})

test('output stays in [0,1) over a long run', () => {
  const s = makeRng('bounds').stream('t')
  let lo = 1, hi = 0
  for (let i = 0; i < 100000; i++) { const v = s(); if (v < lo) lo = v; if (v > hi) hi = v }
  assert.ok(lo >= 0 && hi < 1, `range was [${lo}, ${hi})`)
  assert.ok(lo < 0.001 && hi > 0.999, 'distribution should cover the unit interval')
})

test('helpers stay in range', () => {
  const s = makeRng('helpers').stream('t')
  for (let i = 0; i < 2000; i++) {
    const n = s.int(6)
    assert.ok(Number.isInteger(n) && n >= 0 && n < 6)
    const f = s.range(2, 5)
    assert.ok(f >= 2 && f < 5)
  }
})

test('shuffle is deterministic and non-mutating', () => {
  const src = [1, 2, 3, 4, 5, 6, 7, 8]
  const a = makeRng('s').stream('t').shuffle(src)
  const b = makeRng('s').stream('t').shuffle(src)
  assert.deepEqual(a, b)
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual(a.slice().sort((x, y) => x - y), src)
})

test('weighted respects zero weights', () => {
  const s = makeRng('w').stream('t')
  for (let i = 0; i < 500; i++) assert.notEqual(s.weighted(['a', 'b', 'c'], [1, 0, 1]), 'b')
})

test('snapshot and restore resume mid-sequence — the save contract', () => {
  const r = makeRng('save')
  const s = r.stream('combat')
  for (let i = 0; i < 10; i++) s()
  const snap = JSON.parse(JSON.stringify(r.snapshot()))
  const expected = Array.from({ length: 5 }, () => s())

  const r2 = makeRng('save')
  r2.restore(snap)
  assert.deepEqual(Array.from({ length: 5 }, () => r2.stream('combat')()), expected)
})

test('snapshot key order never depends on stream creation order', () => {
  const r1 = makeRng(1); r1.stream('z'); r1.stream('a')
  const r2 = makeRng(1); r2.stream('a'); r2.stream('z')
  assert.deepEqual(Object.keys(r1.snapshot().streams), Object.keys(r2.snapshot().streams))
})

test('hashString is stable and well spread', () => {
  assert.equal(hashString('core:bone_chanter'), hashString('core:bone_chanter'))
  const seen = new Set()
  for (let i = 0; i < 5000; i++) seen.add(hashString('id_' + i))
  assert.ok(seen.size > 4990, `expected few collisions, got ${5000 - seen.size}`)
})
