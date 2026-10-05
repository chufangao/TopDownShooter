import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hitChance, critChance, affinity, computeDamage, persuadeChance } from '../src/sim/formula.js'
import { createRng } from '../src/sim/rng.js'
import { ELEMENTS, TUNING } from '../src/content/index.js'
import { autoPlace, reachable, expand, rowOf } from '../src/sim/formation.js'
import { makeUnit } from '../src/sim/stats.js'

test('hit and crit are clamped', () => {
  assert.equal(hitChance(50, 50), 0.5)
  assert.equal(hitChance(1000, 0), TUNING.hit.max)
  assert.equal(hitChance(0, 1000), TUNING.hit.min)
  assert.equal(hitChance(0, 0), 0.5)
  assert.equal(critChance(0), TUNING.crit.min)
  assert.equal(critChance(1000), TUNING.crit.max)
})

test('affinity reads the attacking element', () => {
  assert.equal(affinity(ELEMENTS.holy, 'dark'), 2)
  assert.equal(affinity(ELEMENTS.fire, 'frost'), 1.5)
  assert.equal(affinity(ELEMENTS.fire, 'holy'), 1)
  assert.equal(affinity(null, 'dark'), 1)
})

test('damage is an integer, at least the minimum, and scales the right way', () => {
  const p = { power: 30, atk: TUNING.damage.atkDivisor, def: 0 }
  assert.equal(computeDamage(p), 30)
  assert.equal(computeDamage({ ...p, def: 100 }), 15)
  assert.equal(computeDamage({ ...p, isCrit: true }), Math.round(30 * TUNING.crit.mult))
  assert.equal(computeDamage({ ...p, affinity: 2, mul: 0.5 }), 30)
  assert.equal(computeDamage({ power: 0, atk: 1, def: 999 }), TUNING.damage.min)
  assert.ok(Number.isInteger(computeDamage({ ...p, variance: 1.0371 })))
})

test('persuade rises as the target weakens and falls with each failed attempt', () => {
  const base = { tier: 1, hpPct: 0.3, charm: 0 }
  const c = persuadeChance(base)
  assert.ok(Math.abs(c - 0.15 * 2.4) < 1e-9)
  assert.ok(persuadeChance({ ...base, hpPct: 0.1 }) > c)
  assert.ok(Math.abs(persuadeChance({ ...base, attempts: 1 }) - c * TUNING.persuade.decay) < 1e-9)
  assert.ok(persuadeChance({ ...base, charm: 50 }) > c)
  assert.equal(persuadeChance({ ...base, charm: 10000 }), TUNING.persuade.max)
})

test('rng is seeded, string seeds work, and streams are independent', () => {
  const a = createRng('seed')
  const b = createRng('seed')
  const xs = Array.from({ length: 5 }, () => a())
  assert.deepEqual(xs, Array.from({ length: 5 }, () => b()))
  assert.notDeepEqual(xs, Array.from({ length: 5 }, () => createRng('other')()))
  assert.equal(createRng('seed').stream('x')(), createRng('seed').stream('x')())
  assert.notEqual(createRng('seed').stream('x')(), createRng('seed').stream('y')())
  const r = createRng(7)
  for (let i = 0; i < 200; i++) {
    const n = r.int(5)
    assert.ok(Number.isInteger(n) && n >= 0 && n < 5)
    const v = r.range(2, 3)
    assert.ok(v >= 2 && v < 3)
  }
  assert.equal(r.weighted(['a', 'b'], [0, 1]), 'b')
  assert.ok(['p', 'q'].includes(r.pick(['p', 'q'])))
})

test('formation: auto-fill by role, melee reaches only the front row', () => {
  const party = autoPlace(['bone_chanter', 'tomb_knight', 'frost_sprite'].map((id, i) => makeUnit(id, { uid: i + 1 })))
  assert.deepEqual(party.map((u) => rowOf(u.slot)), [2, 0, 1])
  const foes = autoPlace(['tomb_knight', 'bone_chanter'].map((id, i) => makeUnit(id, { uid: i + 10, side: 'foe' })))
  const units = [...party, ...foes]
  const melee = { shape: 'single', melee: true }
  assert.deepEqual(reachable(units, party[1], melee).map((u) => u.uid), [10])
  assert.deepEqual(reachable(units, party[1], { shape: 'single' }).map((u) => u.uid), [10, 11])
  foes[0].hp = 0
  assert.deepEqual(reachable(units, party[1], melee).map((u) => u.uid), [11])
  assert.deepEqual(expand(units, party[0], { shape: 'all_allies' }, party[0]).length, 3)
  const kept = autoPlace([{ ...makeUnit('tomb_knight', { uid: 1 }), slot: 9 }, makeUnit('tomb_knight', { uid: 2 })])
  assert.deepEqual(kept.map((u) => u.slot), [9, 0])
})
