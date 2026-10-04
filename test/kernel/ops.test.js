import test from 'node:test'
import assert from 'node:assert/strict'
import { createOps } from '../../src/sim/kernel/ops.js'

function ops () {
  const O = createOps()
  O.registerType('element', (v) => ['physical', 'fire', 'dark', 'holy'].includes(v))
  O.register('core:damage', {
    schema: { power: 'number', element: { type: 'element', default: 'physical' } },
    run: (ctx, args) => { ctx.log.push(`damage ${args.power} ${args.element}`) }
  })
  O.register('core:apply_status', {
    schema: { status: 'id', dur: 'int', chance: { type: 'number', default: 1, min: 0, max: 1 } },
    run: (ctx, args) => { ctx.log.push(`status ${args.status} ${args.dur} ${args.chance}`) }
  })
  return O
}

test('an unknown op is a hard error — the sim never runs content it does not understand', () => {
  assert.throws(() => ops().get('kindled:ignite'), /unknown op "kindled:ignite"/)
})

test('op ids must be namespaced and unique', () => {
  const O = ops()
  assert.throws(() => O.register('damage', { run: () => {} }), /namespace:name/)
  assert.throws(() => O.register('core:damage', { run: () => {} }), /duplicate op core:damage/)
})

test('an op with an unknown arg type is refused at registration', () => {
  assert.throws(() => ops().register('kindled:x', { schema: { e: 'elemnt' }, run: () => {} }),
    /unknown type "elemnt"/)
})

test('validate catches content bugs at load, not at tick time', () => {
  const O = ops()
  assert.deepEqual(O.validate({ op: 'core:damage', power: 34, element: 'dark' }), [])
  assert.deepEqual(O.validate({ op: 'core:damage', power: 34 }), [], 'defaulted args are optional')

  assert.match(O.validate({ op: 'core:damage' })[0], /missing arg "power"/)
  assert.match(O.validate({ op: 'core:damage', power: 'lots' })[0], /"power" should be number/)
  assert.match(O.validate({ op: 'core:damage', power: 1, element: 'sparkle' })[0], /"element" should be element/)
  assert.match(O.validate({ op: 'core:damage', power: 1, powr: 2 })[0], /unknown arg "powr"/)
  assert.match(O.validate({ op: 'kindled:nope' })[0], /unknown op "kindled:nope"/)
  assert.match(O.validate({ op: 'core:apply_status', status: 'brittle', dur: 6 })[0], /"status" should be id/)
  assert.match(O.validate({ op: 'core:apply_status', status: 'core:brittle', dur: 6, chance: 2 })[0], /above max 1/)
})

test('_note is allowed everywhere — it is how JSON gets comments (§16.1)', () => {
  assert.deepEqual(ops().validate({ op: 'core:damage', power: 1, _note: 'buffed in 1.2' }), [])
})

test('schema defaults are applied at run time, so defs stay as authored', () => {
  const O = ops()
  assert.deepEqual(O.argsFor({ op: 'core:damage', power: 34 }), { power: 34, element: 'physical' })
  const ctx = { log: [] }
  O.run({ op: 'core:damage', power: 34, element: 'dark' }, ctx)
  O.run({ op: 'core:apply_status', status: 'core:brittle', dur: 6 }, ctx)
  assert.deepEqual(ctx.log, ['damage 34 dark', 'status core:brittle 6 1'])
})

test('registration is load-time only', () => {
  const O = ops()
  O.freeze()
  assert.throws(() => O.register('kindled:ignite', { run: () => {} }), /frozen/)
  assert.throws(() => O.registerType('rune', () => true), /frozen/)
})

test('ids() is sorted, so op iteration never depends on load order', () => {
  const O = createOps()
  O.register('z:b', { run: () => {} })
  O.register('a:c', { run: () => {} })
  O.register('a:a', { run: () => {} })
  assert.deepEqual(O.ids(), ['a:a', 'a:c', 'z:b'])
})
