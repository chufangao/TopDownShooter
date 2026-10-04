import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveStats, createStatSchema, validateModifier, getPath, setPath } from '../../src/sim/kernel/modifiers.js'
import { makeRng } from '../../src/sim/kernel/rng.js'

const base = () => ({ hp: 100, atk: 20, def: 10, persuade: { threshold: 0.3 }, gauge: { rate: 1 } })

test('ops apply in set → add → mul → clamp order', () => {
  const s = resolveStats(base(), [
    { path: 'atk', op: 'mul', v: 2, src: 'core:a' },
    { path: 'atk', op: 'add', v: 5, src: 'core:b' },
    { path: 'atk', op: 'set', v: 10, src: 'core:c' }
  ])
  assert.equal(s.atk, 30)   // (10 + 5) * 2, never (10 * 2) + 5
})

test('clamp is applied last and multiple clamps intersect', () => {
  const s = resolveStats(base(), [
    { path: 'persuade.threshold', op: 'add', v: 0.9, src: 'core:glamour' },
    { path: 'persuade.threshold', op: 'clamp', v: [0, 0.6], src: 'core:cap' },
    { path: 'persuade.threshold', op: 'clamp', v: { max: 0.5 }, src: 'core:tighter' }
  ])
  assert.equal(s.persuade.threshold, 0.5)
})

// Invariant §18.7 — the reason this file exists at all.
test('resolved stats are identical under 100 shuffles of the modifier list', () => {
  const mods = [
    { path: 'atk', op: 'add', v: 5, src: 'core:lattice' },
    { path: 'atk', op: 'mul', v: 1.4, src: 'core:warlord' },
    { path: 'atk', op: 'mul', v: 0.85, src: 'kindled:curse' },
    { path: 'atk', op: 'add', v: 3, src: 'core:ring' },
    { path: 'hp', op: 'mul', v: 1.2, src: 'core:congregation' },
    { path: 'hp', op: 'add', v: 40, src: 'core:vitality' },
    { path: 'def', op: 'clamp', v: [0, 200], src: 'core:cap' },
    { path: 'def', op: 'add', v: 400, src: 'kindled:bulwark' },
    { path: 'gauge.rate', op: 'mul', v: 1.04, src: 'core:swarm_logic' },
    { path: 'gauge.rate', op: 'mul', v: 1.04, src: 'kindled:haste' }
  ]
  const expected = resolveStats(base(), mods)
  const rng = makeRng('shuffle').stream('t')
  for (let i = 0; i < 100; i++) {
    assert.deepEqual(resolveStats(base(), rng.shuffle(mods)), expected)
  }
  assert.equal(expected.def, 200)
})

test('equal-priority modifiers break ties by src, so results stay bit-identical', () => {
  const mods = [
    { path: 'atk', op: 'mul', v: 1.1, src: 'z:mod' },
    { path: 'atk', op: 'mul', v: 1.3, src: 'a:mod' },
    { path: 'atk', op: 'mul', v: 1.7, src: 'm:mod' }
  ]
  const expected = resolveStats(base(), mods).atk
  const rng = makeRng('ties').stream('t')
  for (let i = 0; i < 50; i++) {
    assert.equal(resolveStats(base(), rng.shuffle(mods)).atk, expected)
  }
  // Multiplied in src order (a, m, z), not arrival order — and the float is bit-stable because of it.
  assert.equal(expected, 20 * (1.3 * 1.7 * 1.1))
})

test('prio beats src, and a later set wins deterministically', () => {
  const s = resolveStats(base(), [
    { path: 'atk', op: 'set', v: 1, prio: 10, src: 'a:mod' },
    { path: 'atk', op: 'set', v: 2, prio: 20, src: 'b:mod' }
  ])
  assert.equal(s.atk, 2)
})

test('nested paths resolve without disturbing siblings', () => {
  const s = resolveStats(base(), [{ path: 'gauge.rate', op: 'add', v: 0.22, src: 'core:spd' }])
  assert.equal(s.gauge.rate, 1.22)
  assert.equal(s.persuade.threshold, 0.3)
  assert.equal(s.hp, 100)
})

test('the result is frozen and the base is untouched', () => {
  const b = base()
  const s = resolveStats(b, [{ path: 'hp', op: 'add', v: 1, src: 'core:x' }])
  assert.throws(() => { s.hp = 0 }, TypeError)
  assert.throws(() => { s.gauge.rate = 0 }, TypeError)
  assert.equal(b.hp, 100)
})

test('an empty modifier list still returns a frozen clone', () => {
  const b = base()
  const s = resolveStats(b, [])
  assert.deepEqual(s, b)
  assert.throws(() => { s.hp = 0 }, TypeError)
})

test('a set modifier may write a non-number; add/mul on one throws naming the sources', () => {
  const s = resolveStats({ element: 'dark' }, [{ path: 'element', op: 'set', v: 'fire', src: 'core:x' }])
  assert.equal(s.element, 'fire')
  assert.throws(() => resolveStats({ element: 'dark' }, [{ path: 'element', op: 'add', v: 1, src: 'kindled:oops' }]),
    /kindled:oops/)
})

test('validateModifier catches the mistakes a content author actually makes', () => {
  assert.deepEqual(validateModifier({ path: 'atk', op: 'add', v: 1 }), [])
  assert.match(validateModifier({ path: 'Atk', op: 'add', v: 1 })[0], /not a dotted lowercase path/)
  assert.match(validateModifier({ path: 'atk', op: 'scale', v: 1 })[0], /must be one of set add mul clamp/)
  assert.match(validateModifier({ path: 'atk', op: 'mul', v: '2x', src: 'kindled:x' })[0], /kindled:x/)
  assert.match(validateModifier({ path: 'atk', op: 'clamp', v: 5 })[0], /needs \[min,max\]/)
})

test('the stat schema turns a typo into a named boot error', () => {
  const schema = createStatSchema(['atk', 'def', 'persuade.threshold'])
  assert.deepEqual(schema.check([{ path: 'atk', op: 'add', v: 1, src: 'core:x' }]), [])
  const errs = schema.check([{ path: 'persaude.threshold', op: 'add', v: 1, src: 'kindled:typo' }])
  assert.match(errs[0], /unknown modifier path "persaude.threshold" \(from kindled:typo\)/)
})

test('getPath and setPath handle missing intermediate objects', () => {
  assert.equal(getPath({ a: { b: 2 } }, 'a.b'), 2)
  assert.equal(getPath({}, 'a.b.c'), undefined)
  assert.deepEqual(setPath({}, 'a.b.c', 1), { a: { b: { c: 1 } } })
})
