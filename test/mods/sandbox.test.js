// Tier 3 — the script sandbox (§13.3). Cooperative, not a security boundary; what it guarantees
// is that a mod cannot silently desync the sim or squat someone else's ids.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { createPack } from '../../src/sim/mods/pack.js'
import { discoverPacks, readPackFromDisk, makeNodeImporter } from '../../tools/packsource.node.js'

const base = () => [...discoverPacks('packs'), readPackFromDisk('test/fixtures/kindled')]

/** A pack whose script is supplied inline, so a bad script needs no file on disk. */
function scriptPack (id, fn, requires = { core: '^1.0' }) {
  return createPack({ id, name: id, version: '1.0.0', api: 1, scripts: ['scripts/main.js'], requires },
    { 'scripts/main.js': '// supplied by the test importer' })
}
const inlineImporter = (fn) => async () => ({ default: fn })

test('scripts do not run unless the pack is trusted — off by default (§13.3 open question 2)', async () => {
  const { report, kernel } = await createGame({ packs: base(), seed: 1, importScript: makeNodeImporter('test/fixtures') })
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.scripts, [])
  assert.ok(report.warnings.some((w) => /kindled: 1 script\(s\) not run/.test(w)))
  assert.equal(kernel.ops.has('kindled:ignite'), false)
})

test('a trusted pack registers a new verb, a hook and an expr form', async () => {
  const { report, kernel } = await createGame({
    packs: base(), seed: 1, trusted: ['kindled'], importScript: makeNodeImporter('test/fixtures')
  })
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.scripts, ['kindled/scripts/main.js'])
  assert.equal(kernel.ops.has('kindled:ignite'), true)
  assert.equal(kernel.forms.has('kindled:isAsh'), true)
  assert.ok(kernel.hooks.subscribers('damage:compute').includes('kindled:pyre'))
})

test('a new op is a first-class citizen — validated exactly like a core one', async () => {
  const { kernel } = await createGame({
    packs: base(), seed: 1, trusted: ['kindled'], importScript: makeNodeImporter('test/fixtures')
  })
  assert.deepEqual(kernel.ops.validate({ op: 'kindled:ignite', power: 12 }), [])
  assert.match(kernel.ops.validate({ op: 'kindled:ignite', power: 'hot' })[0], /"power" should be number/)
})

test('Math.random inside mod code throws, naming the mod', async () => {
  const pack = scriptPack('naughty', null)
  const { report } = await createGame({
    packs: [...base(), pack],
    seed: 1,
    trusted: ['naughty'],
    importScript: inlineImporter(() => { Math.random() })
  })
  assert.ok(report.errors.some((e) => /naughty called Math\.random/.test(e)), report.errors.join('\n'))
})

test('Date.now and new Date throw too', async () => {
  for (const [label, fn] of [['Date.now', () => { Date.now() }], ['new Date\\(\\)', () => { new Date() }]]) {
    const { report } = await createGame({
      packs: [...base(), scriptPack('naughty')],
      seed: 1,
      trusted: ['naughty'],
      importScript: inlineImporter(fn)
    })
    assert.ok(report.errors.some((e) => new RegExp(`naughty called ${label}`).test(e)), `${label}: ${report.errors.join('\n')}`)
  }
})

test('the traps are removed again once mod code returns', async () => {
  await createGame({
    packs: [...base(), scriptPack('naughty')],
    seed: 1,
    trusted: ['naughty'],
    importScript: inlineImporter(() => { try { Math.random() } catch {} })
  })
  assert.equal(typeof Math.random(), 'number')
  assert.equal(typeof Date.now(), 'number')
  assert.ok(new Date() instanceof Date)
})

test('the trap also covers callbacks the mod registered, not just load time', async () => {
  const { kernel } = await createGame({
    packs: [...base(), scriptPack('naughty')],
    seed: 1,
    trusted: ['naughty'],
    importScript: inlineImporter(({ hooks }) => {
      hooks.on('damage:compute', 'naughty:late', 10, (ev) => { ev.mul *= Math.random() })
    })
  })
  assert.throws(() => kernel.hooks.emit('damage:compute', { mul: 1 }, {}), /naughty called Math\.random/)
})

test('a mod cannot register outside its own namespace', async () => {
  const { report } = await createGame({
    packs: [...base(), scriptPack('naughty')],
    seed: 1,
    trusted: ['naughty'],
    importScript: inlineImporter(({ ops }) => {
      ops.register('core:damage_but_better', { schema: {}, run () {} })
    })
  })
  assert.ok(report.errors.some((e) => /must be namespaced "naughty:…"/.test(e)), report.errors.join('\n'))
})

test('a mod gets its own rng stream, and drawing from it cannot move anyone else\'s', async () => {
  let modStream = null
  const { kernel } = await createGame({
    packs: [...base(), scriptPack('naughty')],
    seed: 'run-7',
    trusted: ['naughty'],
    importScript: inlineImporter(({ rng }) => {
      modStream = rng.streamName
      for (let i = 0; i < 500; i++) rng()
    })
  })
  assert.equal(modStream, 'mod:naughty')

  const { kernel: clean } = await createGame({ packs: base(), seed: 'run-7' })
  assert.equal(kernel.rng.stream('loot')(), clean.rng.stream('loot')())
})

test('a script that throws disables its own pack\'s extras, not the game', async () => {
  const { report, kernel } = await createGame({
    packs: [...base(), scriptPack('naughty')],
    seed: 1,
    trusted: ['naughty'],
    importScript: inlineImporter(() => { throw new Error('boom') })
  })
  assert.ok(report.errors.some((e) => /naughty\/scripts\/main\.js: boom/.test(e)))
  assert.equal(kernel.registry.count('unit'), 8, 'core + kindled content still loaded')
})

test('scripts declared with no host importer warn instead of failing', async () => {
  const { report } = await createGame({ packs: base(), seed: 1, trusted: ['kindled'] })
  assert.ok(report.warnings.some((w) => /host provides no importer/.test(w)))
})
