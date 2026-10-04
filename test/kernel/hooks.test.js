import test from 'node:test'
import assert from 'node:assert/strict'
import { createHooks, HOOK_POINTS } from '../../src/sim/kernel/hooks.js'

test('handlers run in (priority, subscriberId) order regardless of subscription order', () => {
  const order = []
  const H = createHooks()
  H.on('damage:compute', 'z:late', 100, () => order.push('z:late'))
  H.on('damage:compute', 'core:mid', 50, () => order.push('core:mid'))
  H.on('damage:compute', 'a:mid', 50, () => order.push('a:mid'))
  H.on('damage:compute', 'core:early', 10, () => order.push('core:early'))
  H.emit('damage:compute', { mul: 1 }, {})
  assert.deepEqual(order, ['core:early', 'a:mid', 'core:mid', 'z:late'])

  const H2 = createHooks()
  const order2 = []
  H2.on('damage:compute', 'core:mid', 50, () => order2.push('core:mid'))
  H2.on('damage:compute', 'core:early', 10, () => order2.push('core:early'))
  H2.on('damage:compute', 'z:late', 100, () => order2.push('z:late'))
  H2.on('damage:compute', 'a:mid', 50, () => order2.push('a:mid'))
  H2.emit('damage:compute', { mul: 1 }, {})
  assert.deepEqual(order2, order)
})

// Scaled Wall (§3) as a data row would express itself exactly like this.
test('handlers negotiate through a mutable proposal', () => {
  const H = createHooks()
  H.on('damage:compute', 'core:scaled_wall', 50, (ev) => { ev.mul *= 0.8 })
  H.on('damage:compute', 'core:brittle', 60, (ev) => { ev.mul *= 1.25 })
  const ev = H.emit('damage:compute', { mul: 1, add: 0 }, {})
  assert.equal(ev.mul, 1)
  assert.equal(ev.add, 0)
})

test('emitting with no subscribers returns the proposal untouched', () => {
  const ev = createHooks().emit('battle:start', { x: 1 }, {})
  assert.deepEqual(ev, { x: 1 })
})

test('writing an undeclared field on a proposal throws, naming the subscriber', () => {
  const H = createHooks()
  H.on('damage:compute', 'kindled:pyre', 60, (ev) => { ev.damage = 9999 })
  assert.throws(() => H.emit('damage:compute', { mul: 1 }, {}),
    /kindled:pyre wrote "damage" on the damage:compute proposal/)
})

test('read-only points reject every write', () => {
  const H = createHooks()
  H.on('battle:start', 'kindled:x', 0, (ev) => { ev.anything = 1 })
  assert.throws(() => H.emit('battle:start', {}, {}), /this point is read-only/)
})

test('an unknown hook point is refused at subscribe time', () => {
  assert.throws(() => createHooks().on('damage:computed', 'core:x', 0, () => {}),
    /unknown hook point "damage:computed"/)
})

test('subscription is load-time only', () => {
  const H = createHooks()
  H.freeze()
  assert.throws(() => H.on('unit:death', 'core:x', 0, () => {}), /frozen/)
})

test('the documented point set covers the §11.5 list', () => {
  for (const p of ['tick:start', 'gauge:fill', 'action:choose', 'target:select', 'damage:compute',
    'damage:apply', 'status:apply', 'unit:death', 'unit:revive', 'persuade:roll', 'persuade:result',
    'battle:start', 'battle:end', 'loot:roll', 'node:enter', 'floor:end', 'run:end', 'residue:compute']) {
    assert.ok(p in HOOK_POINTS, `${p} should be a hook point`)
  }
})

test('subscribers() reports the resolved order — the "one place to debug" promise', () => {
  const H = createHooks()
  H.on('unit:death', 'core:grave_choir', 20, () => {})
  H.on('unit:death', 'core:assembly_line', 10, () => {})
  assert.deepEqual(H.subscribers('unit:death'), ['core:assembly_line', 'core:grave_choir'])
  assert.equal(H.has('unit:revive'), false)
  assert.equal(H.count(), 2)
})
