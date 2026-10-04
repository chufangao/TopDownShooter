import test from 'node:test'
import assert from 'node:assert/strict'
import { createRegistry } from '../../src/sim/kernel/registry.js'
import { createInstancer } from '../../src/sim/kernel/defs.js'

function fixture () {
  const R = createRegistry()
  R.define('unit', 'core:bone_chanter', {
    kin: 'Undead', role: 'Channeler', tier: 2,
    base: { hp: 78, atk: 14 }, growth: { hp: 9, atk: 2.1 },
    abilities: ['core:dirge']
  })
  const I = createInstancer(R)
  I.registerKind('unit', {
    orphanPolicy: 'drop',
    make: (def, ctx) => ({
      lvl: ctx.lvl ?? 1,
      xp: 0,
      hp: Math.round(def.base.hp + def.growth.hp * ((ctx.lvl ?? 1) - 1)),
      statuses: []
    })
  })
  return { R, I }
}

test('an instance holds numbers and a defId — never an object reference (§14)', () => {
  const { I } = fixture()
  const inst = I.instantiate('unit', 'core:bone_chanter', { lvl: 4 })
  assert.deepEqual(inst, { uid: 1, defId: 'core:bone_chanter', lvl: 4, xp: 0, hp: 105, statuses: [] })
  assert.deepEqual(JSON.parse(JSON.stringify(inst)), inst, 'instances must be plain JSON')
})

test('uids are unique, monotonic and part of save state', () => {
  const { I } = fixture()
  const a = I.instantiate('unit', 'core:bone_chanter')
  const b = I.instantiate('unit', 'core:bone_chanter')
  assert.equal(b.uid, a.uid + 1)

  const snap = I.snapshot()
  const { I: I2 } = fixture()
  I2.restore(snap)
  assert.equal(I2.instantiate('unit', 'core:bone_chanter').uid, b.uid + 1)
})

test('a factory cannot forget uid or defId', () => {
  const { R } = fixture()
  const I = createInstancer(R)
  I.registerKind('unit', { make: () => ({ uid: 999, defId: 'kindled:wrong' }) })
  const inst = I.instantiate('unit', 'core:bone_chanter')
  assert.equal(inst.defId, 'core:bone_chanter')
  assert.equal(inst.uid, 1)
})

test('instantiating a dangling id fails with a name', () => {
  const { I } = fixture()
  assert.throws(() => I.instantiate('unit', 'kindled:ghost'), /unknown unit "kindled:ghost"/)
})

test('a mod can add a whole new content kind', () => {
  const { R, I } = fixture()
  R.define('mount', 'kindled:ashsteed', { speed: 12 })
  I.registerKind('mount', { make: (def) => ({ speed: def.speed, fatigue: 0 }) })
  assert.deepEqual(I.instantiate('mount', 'kindled:ashsteed'), { uid: 1, defId: 'kindled:ashsteed', speed: 12, fatigue: 0 })
  assert.deepEqual(I.kinds(), ['mount', 'unit'])
})

test('kinds are registered once and validated', () => {
  const { R, I } = fixture()
  assert.throws(() => I.registerKind('unit', { make: () => ({}) }), /duplicate instance kind unit/)
  assert.throws(() => I.registerKind('mount', { make: 'nope' }), /must be a function/)
  assert.throws(() => I.registerKind('mount', { make: () => ({}), orphanPolicy: 'explode' }), /orphanPolicy/)
  assert.throws(() => I.instantiate('relic', 'core:x'), /no instance factory for kind relic/)
  R.define('relic', 'core:x', {})
})

test('orphanPolicy answers "a pack was removed, now what?" (§14)', () => {
  const { I } = fixture()
  assert.equal(I.orphanPolicy('unit', 'core:bone_chanter'), null, 'not an orphan')
  assert.equal(I.orphanPolicy('unit', 'kindled:gone'), 'drop')
})

test('defOf resolves an instance back to its frozen def', () => {
  const { I } = fixture()
  const inst = I.instantiate('unit', 'core:bone_chanter')
  assert.equal(I.defOf('unit', inst).kin, 'Undead')
})
