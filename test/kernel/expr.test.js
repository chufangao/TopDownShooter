import test from 'node:test'
import assert from 'node:assert/strict'
import { standardForms } from '../../src/sim/kernel/expr.js'
import { makeRng } from '../../src/sim/kernel/rng.js'

const F = () => standardForms()

test('literals evaluate to themselves', () => {
  const f = F()
  assert.equal(f.eval(3), 3)
  assert.equal(f.eval(true), true)
  assert.equal(f.eval(null), null)
  assert.equal(f.eval('Drake'), 'Drake')
})

test('$refs read ctx.vars, including dotted paths', () => {
  const f = F()
  const ctx = { vars: { target: { hp: 30, tags: { kin: 'Drake' } } } }
  assert.equal(f.eval('$target.hp', ctx), 30)
  assert.equal(f.eval('$target.tags.kin', ctx), 'Drake')
})

test('an unbound $ref throws naming what was bound', () => {
  const f = F()
  assert.throws(() => f.eval('$enemy', { vars: { target: 1 } }), /unbound variable \$enemy.*target/s)
})

test("['lit', …] escapes a string that starts with $", () => {
  assert.equal(F().eval(['lit', '$literal']), '$literal')
})

test("['var', name, default] is the optional lookup", () => {
  const f = F()
  assert.equal(f.eval(['var', 'missing', 7], { vars: {} }), 7)
  assert.equal(f.eval(['var', 'here', 7], { vars: { here: 1 } }), 1)
})

test('the §11.6 example evaluates', () => {
  const f = F()
  f.register('hpPct', { arity: [1, 1], fn: (a) => a[0].hp / a[0].maxHp })
  f.register('kinCount', { arity: [1, 1], fn: (a, ctx) => ctx.party.filter((u) => u.kin === a[0]).length })

  const rule = ['and', ['lte', ['hpPct', '$target'], 0.3],
                       ['lt', ['kinCount', 'Drake'], 4]]
  const ctx = {
    vars: { target: { hp: 20, maxHp: 100 } },
    party: [{ kin: 'Drake' }, { kin: 'Drake' }, { kin: 'Undead' }]
  }
  assert.equal(f.eval(rule, ctx), true)

  ctx.vars.target.hp = 90
  assert.equal(f.eval(rule, ctx), false)
})

test('and/or/if short-circuit', () => {
  const f = F()
  let calls = 0
  f.register('boom', { arity: [0, 0], fn: () => { calls++; throw new Error('should not run') } })
  assert.equal(f.eval(['and', false, ['boom']]), false)
  assert.equal(f.eval(['or', true, ['boom']]), true)
  assert.equal(f.eval(['if', true, 1, ['boom']]), 1)
  assert.equal(calls, 0)
})

test('arithmetic and clamping', () => {
  const f = F()
  assert.equal(f.eval(['add', 1, 2, 3]), 6)
  assert.equal(f.eval(['sub', 10, 4]), 6)
  assert.equal(f.eval(['mul', 2, 3, 4]), 24)
  assert.equal(f.eval(['div', 1, 0]), 0, 'division by zero is 0, not Infinity — no NaN in the sim')
  assert.equal(f.eval(['clamp', 0.1, 2, 0.95]), 0.95)
  assert.equal(f.eval(['clamp', 0.1, -5, 0.95]), 0.1)
  assert.equal(f.eval(['round', ['mul', 1.5, 3]]), 5)
})

test('truthiness is explicit — 0 and empty string are false, [] is not', () => {
  const f = F()
  assert.equal(f.eval(['not', 0]), true)
  assert.equal(f.eval(['not', '']), true)
  assert.equal(f.eval(['and', ['list']]), true)
})

test('rand comes from a named stream, and only from a named stream', () => {
  const f = F()
  assert.throws(() => f.eval(['rand']), /needs ctx\.rng/)
  const a = f.eval(['rand'], { rng: makeRng(5).stream('t') })
  const b = f.eval(['rand'], { rng: makeRng(5).stream('t') })
  assert.equal(a, b)
})

test('unknown forms and bad arity throw at eval', () => {
  const f = F()
  assert.throws(() => f.eval(['nope', 1]), /unknown form "nope"/)
  assert.throws(() => f.eval(['lt', 1]), /takes 2 args, got 1/)
})

test('validate is a static check for lint — no evaluation, whole-tree report', () => {
  const f = F()
  assert.deepEqual(f.validate(['and', ['lte', 1, 2]]), [])
  const errs = f.validate(['and', ['nope', 1], ['lt', 1]])
  assert.equal(errs.length, 2)
  assert.match(errs[0], /unknown expr form "nope"/)
  assert.match(errs[1], /"lt" takes 2 args/)
})

test('forms freeze after boot, and duplicates are refused', () => {
  const f = F()
  assert.throws(() => f.register('add', { fn: () => 0 }), /duplicate expr form add/)
  f.register('kindled:ignite', { arity: [0, 0], fn: () => 1, src: 'kindled' })
  f.freeze()
  assert.throws(() => f.register('late', { fn: () => 0 }), /frozen/)
})

test('expressions are plain JSON — they round-trip through a save unchanged', () => {
  const rule = ['and', ['lte', ['var', 'hp', 1], 0.3], ['includes', ['list', 'Drake', 'Fae'], '$kin']]
  assert.deepEqual(JSON.parse(JSON.stringify(rule)), rule)
  assert.equal(F().eval(rule, { vars: { hp: 0.2, kin: 'Fae' } }), true)
})
