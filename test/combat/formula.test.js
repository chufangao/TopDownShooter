import test from 'node:test'
import assert from 'node:assert/strict'
import { hitChance, critChance, affinity, computeDamage, persuadeChance, clamp } from '../../src/sim/combat/formula.js'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks } from '../../tools/packsource.node.js'
import { makeRng } from '../../src/sim/kernel/rng.js'

// The formula reads its constants from packs/core/content/tuning.json, so these tests double as a
// check that the shipped tuning is coherent (§16.1).
const { tuning } = await createGame({ packs: discoverPacks('packs'), seed: 1 })

test('hit chance is clamped at both ends', () => {
  assert.equal(hitChance(100, 0, tuning), 0.95)
  assert.equal(hitChance(0, 100, tuning), 0.10)
  assert.equal(hitChance(50, 50, tuning), 0.5)
  assert.equal(hitChance(0, 0, tuning), 0.5, 'no stats at all is a coin flip, not a NaN')
})

test('crit chance is CRT/100, clamped to 1%–60%', () => {
  assert.equal(critChance(0, tuning), 0.01)
  assert.equal(critChance(25, tuning), 0.25)
  assert.equal(critChance(400, tuning), 0.60)
})

test('affinity reads the attacking element and defaults to 1', () => {
  const fire = { affinity: { 'core:frost': 1.5, 'core:fire': 0.5 } }
  assert.equal(affinity(fire, 'core:frost'), 1.5)
  assert.equal(affinity(fire, 'core:fire'), 0.5)
  assert.equal(affinity(fire, 'core:dark'), 1)
  assert.equal(affinity(null, 'core:dark'), 1)
})

test('damage is an integer, always, at the point of application', () => {
  const rng = makeRng('dmg').stream('t')
  for (let i = 0; i < 2000; i++) {
    const d = computeDamage({
      power: rng.range(5, 60), atk: rng.range(5, 200), def: rng.range(0, 300),
      affinity: rng.pick([0.5, 1, 1.5, 2]), isCrit: rng.chance(0.2), variance: rng.range(0.95, 1.05)
    }, tuning)
    assert.ok(Number.isInteger(d), `${d} is not an integer`)
    assert.ok(d >= tuning.damage.min, `${d} below the floor`)
  }
})

test('DEF mitigates on a curve that never reaches zero', () => {
  const p = { power: 30, atk: 100 }
  const noDef = computeDamage({ ...p, def: 0 }, tuning)
  const someDef = computeDamage({ ...p, def: 100 }, tuning)
  const lotsOfDef = computeDamage({ ...p, def: 900 }, tuning)
  assert.equal(someDef, Math.round(noDef / 2), '100 DEF is exactly half, by construction')
  assert.ok(lotsOfDef >= tuning.damage.min && lotsOfDef < someDef)
})

test('pierce ignores a fraction of DEF', () => {
  const p = { power: 30, atk: 100, def: 100 }
  assert.equal(computeDamage({ ...p, pierce: 1 }, tuning), computeDamage({ ...p, def: 0 }, tuning))
})

// Rounding happens once, at the end — so these compare within a point of the scaled base rather
// than to a re-rounded number.
const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) <= 1, `${msg ?? ''} expected ≈${expected}, got ${actual}`)

test('crit and affinity multiply the same base', () => {
  const p = { power: 40, atk: 80, def: 50 }
  const plain = computeDamage(p, tuning)
  near(computeDamage({ ...p, affinity: 2 }, tuning), plain * 2, 'affinity')
  near(computeDamage({ ...p, isCrit: true }, tuning), plain * tuning.crit.mult, 'crit')
})

test('the damage:compute proposal fields do what §11.5 says', () => {
  const p = { power: 40, atk: 80, def: 50 }
  const plain = computeDamage(p, tuning)
  near(computeDamage({ ...p, mul: 0.8 }, tuning), plain * 0.8, 'Scaled Wall')
  assert.ok(computeDamage({ ...p, add: 20 }, tuning) > plain)
})

test('the same inputs always give the same number — no hidden state', () => {
  const p = { power: 33, atk: 77, def: 41, affinity: 1.5, isCrit: true, variance: 1.01 }
  const first = computeDamage(p, tuning)
  for (let i = 0; i < 100; i++) assert.equal(computeDamage(p, tuning), first)
})

test('persuade rewards weakening, punishes repeated attempts, and stays under the cap', () => {
  const at = (over) => persuadeChance({ tier: 2, charm: 0, hpPct: 0.3, attempts: 0, ...over }, tuning)
  assert.ok(at({ hpPct: 0.1 }) > at({ hpPct: 0.9 }), 'the weaker, the better')
  assert.ok(at({ attempts: 1 }) < at({ attempts: 0 }), 'each failure hardens them')
  assert.ok(Math.abs(at({ attempts: 2 }) / at({ attempts: 1 }) - tuning.persuade.decay) < 1e-12)
  assert.ok(at({ charm: 100 }) > at({ charm: 0 }), 'party-wide Charm helps')
  assert.ok(at({ kinAffinity: tuning.persuade.kinAffinity }) > at({}), 'sharing a Kin tag helps')
  assert.ok(at({ tier: 1, hpPct: 0, charm: 500, kinAffinity: 4 }) <= tuning.persuade.max)
  assert.ok(at({ tier: 5 }) < at({ tier: 1 }), 'rarer things are harder to talk round')
})

test('an unknown tier falls back rather than producing NaN', () => {
  assert.ok(persuadeChance({ tier: 99, hpPct: 0.5 }, tuning) > 0)
})

test('clamp is inclusive at both ends', () => {
  assert.equal(clamp(0, 1, -5), 0)
  assert.equal(clamp(0, 1, 5), 1)
  assert.equal(clamp(0, 1, 0.5), 0.5)
})
