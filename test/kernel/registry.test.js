import test from 'node:test'
import assert from 'node:assert/strict'
import { createRegistry, stableStringify, digest, assertId } from '../../src/sim/kernel/registry.js'
import { makeRng } from '../../src/sim/kernel/rng.js'

const unit = (id, extra = {}) => ({ id, kin: 'Undead', base: { hp: 78, atk: 14 }, ...extra })

test('bare ids are a load-time error', () => {
  const R = createRegistry()
  assert.throws(() => R.define('unit', 'bone_chanter', unit('bone_chanter')), /namespace:name/)
  assert.throws(() => assertId('Core:Thing'), /namespace:name/)
  assert.throws(() => assertId('core:'), /namespace:name/)
  R.define('unit', 'core:bone_chanter', unit('core:bone_chanter'))
})

test('duplicate ids name the pack that got there first', () => {
  const R = createRegistry()
  R.define('unit', 'core:x', unit('core:x'), 'core')
  assert.throws(() => R.define('unit', 'core:x', unit('core:x'), 'kindled'),
    /duplicate unit id core:x \(already defined by core\)/)
})

test('get throws with a suggestion instead of returning undefined', () => {
  const R = createRegistry()
  R.define('unit', 'core:bone_chanter', unit('core:bone_chanter'))
  assert.throws(() => R.get('unit', 'kindled:bone_chanter'), /did you mean core:bone_chanter/)
  assert.throws(() => R.get('mount', 'core:anything'), /no mount content is registered/)
})

test('all() is always sorted by id, whatever order things were defined in', () => {
  const forward = createRegistry()
  for (const id of ['core:c', 'core:a', 'core:b']) forward.define('unit', id, unit(id))
  const backward = createRegistry()
  for (const id of ['core:b', 'core:a', 'core:c']) backward.define('unit', id, unit(id))
  assert.deepEqual(forward.all('unit').map((d) => d.id), ['core:a', 'core:b', 'core:c'])
  assert.deepEqual(forward.all('unit'), backward.all('unit'))
})

test('all() of an unknown kind is an empty array, not a throw', () => {
  assert.deepEqual(createRegistry().all('mount'), [])
})

test('defs are deep-frozen — content is immutable at runtime', () => {
  const R = createRegistry()
  R.define('unit', 'core:x', unit('core:x'))
  const def = R.get('unit', 'core:x')
  assert.throws(() => { def.base.hp = 1 }, TypeError)
  assert.throws(() => { def.kin = 'Fae' }, TypeError)
})

test('freeze closes the registry before the first tick', () => {
  const R = createRegistry()
  R.define('unit', 'core:x', unit('core:x'))
  R.freeze()
  assert.equal(R.frozen, true)
  assert.throws(() => R.define('unit', 'core:y', unit('core:y')), /frozen/)
  assert.throws(() => R.redefine('unit', 'core:x', unit('core:x')), /frozen/)
  assert.equal(R.get('unit', 'core:x').kin, 'Undead')
})

test('redefine is the patch path and only works on existing ids', () => {
  const R = createRegistry()
  R.define('unit', 'core:x', unit('core:x'), 'core')
  R.redefine('unit', 'core:x', unit('core:x', { tier: 3 }), 'kindled')
  assert.equal(R.get('unit', 'core:x').tier, 3)
  assert.equal(R.sourceOf('unit', 'core:x'), 'kindled')
  assert.throws(() => R.redefine('unit', 'core:ghost', unit('core:ghost')), /not defined/)
})

// Invariant §18.6 in miniature: the same content in any definition order hashes the same.
test('the registry hash is independent of definition order and key order', () => {
  const ids = ['core:a', 'kindled:b', 'core:c', 'kindled:d', 'core:e']
  const rng = makeRng('order').stream('t')
  const build = (order, flip) => {
    const R = createRegistry()
    for (const id of order) {
      R.define('unit', id, flip
        ? { base: { atk: 14, hp: 78 }, kin: 'Undead', id }
        : { id, kin: 'Undead', base: { hp: 78, atk: 14 } })
    }
    return R.hash()
  }
  const expected = build(ids, false)
  for (let i = 0; i < 20; i++) assert.equal(build(rng.shuffle(ids), i % 2 === 0), expected)
})

test('the hash changes when content changes', () => {
  const a = createRegistry(); a.define('unit', 'core:x', unit('core:x'))
  const b = createRegistry(); b.define('unit', 'core:x', unit('core:x', { tier: 2 }))
  assert.notEqual(a.hash(), b.hash())
})

test('stableStringify sorts keys at every depth', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }),
    '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}')
  assert.equal(digest('x').length, 8)
})
