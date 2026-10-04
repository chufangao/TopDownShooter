// K1's gate (§17): nothing under src/ imports a content file, and core loads through the public
// loader only. These tests exercise the loader the way a mod author's pack will.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { createPack } from '../../src/sim/mods/pack.js'
import { discoverPacks, readPackFromDisk } from '../../tools/packsource.node.js'

const corePacks = () => discoverPacks('packs')
const kindled = () => readPackFromDisk('test/fixtures/kindled')

/** A pack built in memory — the same shape a dragged zip produces (§13.1). */
function memPack (id, files, manifest = {}) {
  return createPack(
    { id, name: id, version: '1.0.0', api: 1, content: ['content/*.json'], ...manifest },
    files
  )
}

test('packs/core loads clean through the public entry point', async () => {
  const { report, kernel, tuning } = await createGame({ packs: corePacks(), seed: 1 })
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.warnings, [])
  assert.deepEqual(report.order, ['core'])
  assert.equal(report.counts.unit, 7)
  assert.equal(report.counts.ability, 11)
  assert.equal(report.counts.status, 5)
  assert.equal(report.counts.resonance, 15)
  assert.equal(report.counts.pact, 6)
  // The shop and the reports, as content like everything else (§4.1, §4.2).
  assert.equal(report.counts.tenet, 22)
  assert.equal(report.counts.dispatch, 9)
  assert.equal(kernel.ops.count(), 7, 'core:emit_signal joined the six at M3.5 (§11.4)')
  assert.equal(tuning.tick.hz, 20)
  assert.equal(kernel.frozen, true, 'the registry must be frozen before the first tick (§18.8)')
})

test('the content hash is stable across loads of the same content', async () => {
  const a = await createGame({ packs: corePacks(), seed: 1 })
  const b = await createGame({ packs: corePacks(), seed: 999 })
  assert.equal(a.report.contentHash, b.report.contentHash, 'the seed must not affect content')
})

test('an external pack loads beside core with no changes to core', async () => {
  const { report, kernel } = await createGame({ packs: [...corePacks(), kindled()], seed: 1 })
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.order, ['core', 'kindled'])
  assert.equal(kernel.registry.has('unit', 'kindled:ash_seer'), true)
  assert.equal(kernel.registry.has('element', 'kindled:ash'), true)
})

test('a patch rebalances core content without forking it', async () => {
  const clean = await createGame({ packs: corePacks(), seed: 1 })
  const baseHp = clean.kernel.registry.get('unit', 'core:bone_chanter').base.hp

  const { kernel, report } = await createGame({ packs: [...corePacks(), kindled()], seed: 1 })
  const patched = kernel.registry.get('unit', 'core:bone_chanter')
  assert.equal(patched.base.hp, baseHp * 1.2)
  assert.equal(patched.tier, 3)
  assert.ok(patched.abilities.includes('kindled:emberdirge'))
  assert.ok(report.patchLog.some((e) => e.src === 'kindled' && e.path === 'base.hp'))
})

test('a wildcard patch with a where-expression hits exactly the matching defs', async () => {
  const clean = await createGame({ packs: corePacks(), seed: 1 })
  const { kernel } = await createGame({ packs: [...corePacks(), kindled()], seed: 1 })
  const before = clean.kernel.registry
  for (const def of kernel.registry.all('unit')) {
    if (!before.has('unit', def.id)) continue
    const wasDrake = before.get('unit', def.id).kin === 'core:drake'
    const expected = before.get('unit', def.id).base.atk * (wasDrake ? 1.1 : 1)
    assert.equal(def.base.atk, expected, `${def.id} atk`)
  }
})

test('a pack cannot define ids outside its own namespace', async () => {
  const squatter = memPack('squat', {
    'content/unit.json': JSON.stringify({
      kind: 'unit',
      defs: [{ id: 'core:bone_chanter', name: 'Stolen', kin: 'core:undead', role: 'core:channeler', tier: 1, base: { hp: 1, atk: 1, def: 1, spd: 1, acc: 1, eva: 1, crt: 1 }, abilities: ['core:strike'], art: { descriptor: 'x:y' } }]
    })
  })
  const { report } = await createGame({ packs: [...corePacks(), squatter], seed: 1 })
  assert.ok(report.errors.some((e) => /outside the "squat:" namespace/.test(e)), report.errors.join('\n'))
})

test('a dangling reference fails at boot with a name, not on floor 7', async () => {
  const broken = memPack('broken', {
    'content/ability.json': JSON.stringify({
      kind: 'ability',
      defs: [{ id: 'broken:zap', name: 'Zap', castCost: 100, shape: 'single', element: 'broken:void', effects: [{ op: 'core:damage', power: 10 }] }]
    })
  })
  const { report } = await createGame({ packs: [...corePacks(), broken], seed: 1 })
  assert.ok(report.errors.some((e) => /unknown element "broken:void"/.test(e)), report.errors.join('\n'))
  assert.equal(report.contentHash, null, 'a failed load must not freeze a half-built registry')
})

test('a bad op arg is caught at load, not at tick time', async () => {
  const broken = memPack('broken', {
    'content/ability.json': JSON.stringify({
      kind: 'ability',
      defs: [{ id: 'broken:zap', name: 'Zap', castCost: 100, shape: 'single', effects: [{ op: 'core:damage', power: 'lots' }] }]
    })
  })
  const { report } = await createGame({ packs: [...corePacks(), broken], seed: 1 })
  assert.ok(report.errors.some((e) => /"power" should be number/.test(e)), report.errors.join('\n'))
})

test('an unknown expr form in a when-gate is caught at load', async () => {
  const broken = memPack('broken', {
    'content/ability.json': JSON.stringify({
      kind: 'ability',
      defs: [{ id: 'broken:zap', name: 'Zap', castCost: 100, shape: 'single', when: ['gte', ['enemyKount'], 2], effects: [{ op: 'core:damage', power: 10 }] }]
    })
  })
  const { report } = await createGame({ packs: [...corePacks(), broken], seed: 1 })
  assert.ok(report.errors.some((e) => /unknown expr form "enemyKount"/.test(e)), report.errors.join('\n'))
})

test('an unknown modifier path is a boot error naming the pack', async () => {
  const broken = memPack('broken', {
    'content/status.json': JSON.stringify({
      kind: 'status',
      defs: [{ id: 'broken:woozy', name: 'Woozy', dur: 10, modifiers: [{ path: 'persaude.threshold', op: 'add', v: 0.1 }] }]
    })
  })
  const { report } = await createGame({ packs: [...corePacks(), broken], seed: 1 })
  assert.ok(report.errors.some((e) => /unknown modifier path "persaude.threshold".*broken:woozy/.test(e)), report.errors.join('\n'))
})

test('a hook row that writes an immutable field is refused at load', async () => {
  const broken = memPack('broken', {
    'content/status.json': JSON.stringify({
      kind: 'status',
      defs: [{ id: 'broken:cheat', name: 'Cheat', dur: 10, hooks: [{ point: 'battle:start', field: 'winner', op: 'set', v: 'me' }] }]
    })
  })
  const { report } = await createGame({ packs: [...corePacks(), broken], seed: 1 })
  assert.ok(report.errors.some((e) => /not mutable at battle:start/.test(e)), report.errors.join('\n'))
})

test('a broken manifest disables one pack instead of taking the game down', async () => {
  const bad = createPack({ id: 'Bad Pack!', name: 'x', version: 'one', api: 'yes' }, {})
  const { report, kernel } = await createGame({ packs: [...corePacks(), bad], seed: 1 })
  assert.deepEqual(report.errors, [])
  assert.equal(report.disabled.length, 1)
  assert.match(report.disabled[0].reason, /id .* must match/)
  assert.equal(kernel.registry.count('unit'), 7, 'core still loaded')
})

test('a pack from the future is disabled with a readable message', async () => {
  const future = memPack('future', {}, { api: 99 })
  const { report } = await createGame({ packs: [...corePacks(), future], seed: 1 })
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.disabled, [{ id: 'future', reason: 'needs api 99, this build provides 1 — update the game' }])
})

test('a pack whose dependency is missing is disabled, and so is anything that needed it', async () => {
  const mid = memPack('mid', {}, { requires: { missing: '^1.0' } })
  const top = memPack('top', {}, { requires: { mid: '^1.0' } })
  const { report } = await createGame({ packs: [...corePacks(), mid, top], seed: 1 })
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.disabled.map((d) => d.id), ['mid', 'top'])
})

test('a dependency at the wrong version is disabled with both versions named', async () => {
  const needsTwo = memPack('needstwo', {}, { requires: { core: '^2.0' } })
  const { report } = await createGame({ packs: [...corePacks(), needsTwo], seed: 1 })
  assert.match(report.disabled[0].reason, /requires "core" \^2\.0, found 1\.0\.0/)
})

test('a patch aimed at content that is not loaded warns rather than crashing', async () => {
  const p = memPack('lonely', { 'patches/x.json': JSON.stringify({ target: 'unit:ghost:thing', ops: [{ op: 'set', path: 'tier', v: 9 }] }) },
    { patches: ['patches/*.json'] })
  const { report } = await createGame({ packs: [...corePacks(), p], seed: 1 })
  assert.deepEqual(report.errors, [])
  assert.ok(report.warnings.some((w) => /matched nothing/.test(w)))
})

test('a content file that is not valid JSON names the file', async () => {
  const p = memPack('oops', { 'content/unit.json': '{ "kind": "unit", }' })
  await assert.rejects(() => createGame({ packs: [...corePacks(), p], seed: 1 }), /oops: content\/unit\.json is not valid JSON/)
})
