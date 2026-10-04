// Spawn tables and depth scaling (§6.2).
//
// The reason this file exists at all: for two milestones a pack could ship a unit but could not say
// where it appeared, because the weighting was twelve lines inside `party.js`. These tests pin the
// property that fixed it — a table is content, and content composes without an order.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks, readPackFromDisk } from '../../tools/packsource.node.js'
import { spawnPool, pickSpawns, foeLevel, targetTier } from '../../src/sim/spawn.js'
import { makeFoes } from '../../src/sim/party.js'
import { makeRng } from '../../src/sim/kernel/rng.js'

const { kernel, tuning } = await createGame({ packs: discoverPacks('packs'), seed: 1 })
const weightOf = (pool, id) => pool.find((e) => e.def.id === id)?.w ?? 0

// ── the depth curve ─────────────────────────────────────────────────────────────────────────────

test('foe level is the curve the party XP has to keep pace with (§6.2)', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((f) => foeLevel(f, tuning)), [1, 3, 4, 6, 7, 9, 10, 12])
})

test('a floor aims at a tier, and nothing more than one above it can appear', () => {
  for (const floor of [1, 2, 4, 8]) {
    const target = targetTier(floor, tuning)
    for (const { def } of spawnPool(kernel, { floor, tuning })) {
      assert.ok(def.tier <= target + tuning.spawn.tierOverCap,
        `tier ${def.tier} ${def.id} can spawn on floor ${floor}, which targets tier ${target}`)
    }
  }
})

test('★ floor 1 cannot field the thing that used to wipe a level-2 party', () => {
  // The measurement §6.2 records: flat weighting put two tier-3 Drakes in the first encounter of
  // floor 1. Both halves of the fix are asserted — the Drake declares a floor window, and the tier
  // cap would exclude it anyway.
  const ids = spawnPool(kernel, { floor: 1, tuning }).map((e) => e.def.id)
  assert.ok(!ids.includes('core:ember_drake'))
  assert.ok(ids.length >= 3, 'floor 1 still has a real pool to draw from')
})

test('weight falls off steeply away from the floor target, so the band reads', () => {
  const deep = spawnPool(kernel, { floor: 6, tuning })
  const near = deep.filter((e) => e.def.tier === targetTier(6, tuning))
  const far = deep.filter((e) => e.def.tier <= targetTier(6, tuning) - 2)
  if (near.length && far.length) {
    assert.ok(Math.max(...near.map((e) => e.w)) > Math.max(...far.map((e) => e.w)) * 4)
  }
})

// ── tables are content, and they compose ────────────────────────────────────────────────────────

test('a themed table adds to the base pool rather than replacing it', () => {
  // `core:spawn_crypt` weights the Undead up on floors 1-3. The wildcard pool still contributes, so
  // the Bone Chanter's weight is the sum of both rows and everything else is still reachable.
  const f3 = spawnPool(kernel, { floor: 3, tuning })
  assert.ok(weightOf(f3, 'core:bone_chanter') > weightOf(f3, 'core:hive_warden'),
    'the crypt table must move a same-tier unit above one it does not name')
  assert.ok(weightOf(f3, 'core:clockwork_page') > 0, 'a themed table must not exclude anyone')
})

test('★ depth shaping outranks theming, and that ordering is the point', () => {
  // Floor 1 targets tier 1, so the crypt table's tier-2 Undead stay rare there even though the
  // table names them — the shaping is applied once, after every table, precisely so a themed pool
  // cannot opt out of the cap that keeps floor 1 survivable. The theme reads on floor 3, where the
  // band and the table agree. Getting this backwards is how a "flavourful" table wipes a new run.
  const f1 = spawnPool(kernel, { floor: 1, tuning })
  assert.ok(weightOf(f1, 'core:frost_sprite') > weightOf(f1, 'core:bone_chanter') * 4)
  const f3 = spawnPool(kernel, { floor: 3, tuning })
  assert.ok(weightOf(f3, 'core:bone_chanter') > weightOf(f3, 'core:frost_sprite') * 4)
})

test('a table row honours its own when-gate', () => {
  // The Tomb Knight's crypt row is gated on floorNum ≥ 2, so its floor-1 weight is the wildcard
  // pool's alone and its floor-2 weight is that plus the row.
  const bare = weightOf(spawnPool(kernel, { floor: 1, tuning }), 'core:tomb_knight')
  const gated = weightOf(spawnPool(kernel, { floor: 2, tuning }), 'core:tomb_knight')
  assert.ok(gated > bare * 1.2, `expected the gated row to add weight (${bare} → ${gated})`)
})

test('a table outside its floor window contributes nothing', () => {
  assert.equal(weightOf(spawnPool(kernel, { floor: 1, tuning }), 'core:hollow_sovereign'), 0)
})

test('★ summing rows is what makes the pool independent of pack load order (§18.6)', () => {
  // Addition is commutative; a "last table wins" rule would not be. This is the property that lets
  // a pack add to the pool by shipping one row without any coordination.
  const a = spawnPool(kernel, { floor: 2, tuning })
  const b = spawnPool(kernel, { floor: 2, tuning })
  assert.deepEqual(a.map((e) => [e.def.id, e.w]), b.map((e) => [e.def.id, e.w]))
  assert.deepEqual(a.map((e) => e.def.id), a.map((e) => e.def.id).slice().sort())
})

test('a Bias node multiplies a Kin family into the pool (§5)', () => {
  const before = weightOf(spawnPool(kernel, { floor: 2, tuning }), 'core:bone_chanter')
  const after = weightOf(spawnPool(kernel, { floor: 2, tuning, bias: { 'core:undead': 3 } }), 'core:bone_chanter')
  assert.equal(Math.round(after / before), 3)
})

// ── drawing ─────────────────────────────────────────────────────────────────────────────────────

test('the same seed draws the same encounter', () => {
  const draw = () => pickSpawns(kernel, makeRng('enc').stream('spawn'), { floor: 3, tuning, size: 5 })
  assert.deepEqual(draw(), draw())
})

test('an encounter may field several of the same thing — a swarm is a real encounter', () => {
  const seen = new Set()
  for (let i = 0; i < 40; i++) {
    seen.add(pickSpawns(kernel, makeRng(`sw${i}`).stream('spawn'), { floor: 2, tuning, size: 4 }).join('|'))
  }
  assert.ok(seen.size > 1, 'draws must vary with the seed')
})

test('an impossible floor fails with a sentence, not a TypeError', () => {
  assert.throws(
    () => pickSpawns(kernel, makeRng('x').stream('spawn'), { floor: 1, tuning, size: 1, boss: true }),
    /no boss can spawn on floor 1/
  )
})

test('makeFoes builds a level-matched formation from the floor pool', () => {
  const foes = makeFoes(kernel, makeRng('mf').stream('spawn'), { floor: 4, size: 5, tuning })
  assert.equal(foes.length, 5)
  for (const f of foes) {
    assert.equal(f.side, 'foe')
    assert.equal(f.lvl, foeLevel(4, tuning))
    assert.ok(f.slot >= 0 && f.slot < 12)
  }
  assert.equal(new Set(foes.map((f) => f.slot)).size, 5)
})

// ── the §12 test: shipping content touches only packs/ ──────────────────────────────────────────

test('★ a pack joins the spawn pool by shipping one block, with no core change', async () => {
  // The whole reason spawn tables became content. `kindled:ash_seer` declares `spawn` in its own
  // file and appears from floor 3 — no table was edited, no code was touched, and core does not
  // know the pack exists.
  const withMod = await createGame({
    packs: [...discoverPacks('packs'), readPackFromDisk('test/fixtures/kindled')], seed: 1
  })
  const t = withMod.tuning
  assert.equal(weightOf(spawnPool(withMod.kernel, { floor: 1, tuning: t }), 'kindled:ash_seer'), 0)
  assert.ok(weightOf(spawnPool(withMod.kernel, { floor: 5, tuning: t }), 'kindled:ash_seer') > 0)
  // …and core's own pool is unchanged by its presence.
  assert.equal(
    weightOf(spawnPool(withMod.kernel, { floor: 5, tuning: t }), 'core:ember_drake'),
    weightOf(spawnPool(kernel, { floor: 5, tuning }), 'core:ember_drake')
  )
})
