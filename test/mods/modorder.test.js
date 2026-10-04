// Invariant §18.6 — the moddability twin of the determinism test, and the single most valuable
// test in Part II: load the packs in random permutations, assert an identical registry hash.
//
// It holds because of exactly two decisions: `registry.all()` sorts by id (§11.1), and the load
// order is a topological sort with ties broken by id (§13.1). If either erodes, this test is what
// notices.
//
// The timeline half of the invariant ("…and identical battle timeline") lands with resolve.js at M1.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { createPack } from '../../src/sim/mods/pack.js'
import { discoverPacks, readPackFromDisk } from '../../tools/packsource.node.js'
import { makeRng } from '../../src/sim/kernel/rng.js'

function statPack (id, hpMul, extraUnit) {
  return createPack(
    {
      id,
      name: id,
      version: '1.0.0',
      api: 1,
      content: ['content/*.json'],
      patches: ['patches/*.json'],
      art: { descriptors: 'art/descriptors/' },
      requires: { core: '^1.0' }
    },
    {
      'content/unit.json': JSON.stringify({
        kind: 'unit',
        defs: [{
          id: `${id}:${extraUnit}`, name: extraUnit, kin: 'core:beast', role: 'core:skirmisher',
          element: 'core:physical', tier: 1,
          base: { hp: 60, atk: 14, def: 5, spd: 28, acc: 46, eva: 20, crt: 6 },
          growth: { hp: 7, atk: 1.8 },
          abilities: ['core:strike'],
          art: { descriptor: `${id}:${extraUnit}` }
        }]
      }),
      // Art travels the same road: a descriptor over core's shared rig, clips, parts and palettes,
      // so a pack ships a new-looking creature with no PNG in it at all (§15.5).
      [`art/descriptors/${extraUnit}.json`]: JSON.stringify({
        id: `${id}:${extraUnit}`,
        rig: 'core:biped',
        seed: 12,
        palette: { ramp: 'core:chitin', accent: 'core:bone' },
        parts: {
          head: { shape: 'core:head_drake' },
          torso: { shape: 'core:torso_carapace' },
          armL: { shape: 'core:arm_bone' },
          armR: { shape: 'core:arm_bone' },
          legL: { shape: 'core:leg_plate' },
          legR: { shape: 'core:leg_plate' }
        }
      }),
      // Every pack patches the same path on the same def — overlapping patches are explicitly
      // allowed (§13.2), so the order they resolve in has to be deterministic anyway.
      'patches/hp.json': JSON.stringify({ target: 'unit:core:tomb_knight', ops: [{ op: 'mul', path: 'base.hp', v: hpMul }] })
    }
  )
}

const allPacks = () => [
  ...discoverPacks('packs'),
  readPackFromDisk('test/fixtures/kindled'),
  statPack('alpha', 1.1, 'dune_hound'),
  statPack('zeta', 0.9, 'salt_moth')
]

test('every load order produces the same registry hash', async () => {
  const packs = allPacks()
  const { report: base } = await createGame({ packs, seed: 1 })
  assert.deepEqual(base.errors, [])
  assert.equal(base.order.length, 4)

  const rng = makeRng('mod-order').stream('fuzz')
  for (let i = 0; i < 40; i++) {
    const shuffled = rng.shuffle(packs)
    const { report } = await createGame({ packs: shuffled, seed: 1 })
    assert.deepEqual(report.errors, [])
    assert.equal(report.contentHash, base.contentHash,
      `order ${shuffled.map((p) => p.id).join(',')} produced a different registry`)
    assert.deepEqual(report.order, base.order, 'the resolved load order must be total and reproducible')
  }
})

test('overlapping patches compose to the same result in any order', async () => {
  const packs = allPacks()
  const rng = makeRng('overlap').stream('fuzz')
  const { kernel: baseKernel } = await createGame({ packs, seed: 1 })
  const expected = baseKernel.registry.get('unit', 'core:tomb_knight').base.hp

  for (let i = 0; i < 20; i++) {
    const { kernel } = await createGame({ packs: rng.shuffle(packs), seed: 1 })
    assert.equal(kernel.registry.get('unit', 'core:tomb_knight').base.hp, expected)
  }
})

test('requires and loadAfter are honoured, with ties broken by id', async () => {
  const packs = allPacks()
  const { report } = await createGame({ packs, seed: 1 })
  // core first (everything requires it), then the rest alphabetically — a total order.
  assert.deepEqual(report.order, ['core', 'alpha', 'kindled', 'zeta'])
})

test('loadAfter reorders without changing the outcome', async () => {
  const packs = allPacks()
  const withHint = packs.map((p) => p.id !== 'alpha'
    ? p
    : createPack({ ...p.manifest, loadAfter: ['zeta'] }, p.files))

  const { report: plain } = await createGame({ packs, seed: 1 })
  const { report: hinted } = await createGame({ packs: withHint, seed: 1 })
  assert.deepEqual(hinted.order, ['core', 'kindled', 'zeta', 'alpha'])
  assert.equal(hinted.contentHash, plain.contentHash, 'load order must not change content')
})

test('a load-order cycle is reported, not hung on', async () => {
  const a = createPack({ id: 'aa', name: 'aa', version: '1.0.0', api: 1, loadAfter: ['bb'] }, {})
  const b = createPack({ id: 'bb', name: 'bb', version: '1.0.0', api: 1, loadAfter: ['aa'] }, {})
  const { report } = await createGame({ packs: [a, b], seed: 1 })
  assert.ok(report.errors.some((e) => /load order cycle between packs: aa, bb/.test(e)))
})
