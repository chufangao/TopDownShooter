import { test } from 'node:test'
import assert from 'node:assert/strict'
import { field, targetsFrom } from '../src/sim/turns.js'
import {
  makeUnit, tileAt, DEPTH, ROWS, TILES, sizeOf, fits, footprintSlots, distanceBetween, deployTile, monarchSlot, wallTiles, armOf, reachOf,
  blowReach
} from '../src/sim/unit.js'
import { CAMP_LIST, abilityDef } from '../src/content.js'
import { frontier, START_PARTY } from '../src/sim/run.js'
import { on, scene } from './scene.js'

// Reach (redesign.md §2.6): a blow's range and nothing else, from where a piece stands after its move; your melee
// reaches 1, or 2 for a long arm. (The foes' roads, and that your pieces hold them, are test/turns.test.js's and
// test/policy.test.js's.)

test('your melee reaches 1, or 2 for a long arm; a tier that grows a blow\'s range grows only that blow\'s reach', () => {
  assert.deepEqual(['tomb_knight', 'ember_drake', 'grave_ghoul', 'mantis_reaper', 'hive_queen'].map((id) => armOf({ id })), [1, 1, 2, 2, 1])
  // Golems round a piece of yours at (3, 4): one beside it, one 2 tiles off, one 3 off.
  const reaches = (piece) => {
    const b = scene([on('monarch', 0, 'party', 0, 0), piece, on('iron_golem', 10, 'foe', 4, 5, 9), on('iron_golem', 11, 'foe', 3, 6, 9), on('iron_golem', 12, 'foe', 3, 7, 9)])
    const u = b.byUid.get(piece.uid)
    return (ability) => targetsFrom(b, u, u.kit.find((a) => a.id === ability)).map((x) => x.uid)
  }
  // An Ember Drake: its Strike reaches 1, its Ember Burst its range.
  const drake = reaches(on('ember_drake', 1, 'party', 3, 4))
  assert.deepEqual([drake('strike'), drake('ember_burst')], [[10], [10, 11, 12]])
  // A Grave Ghoul's melee, a long arm, reaches 2.
  assert.deepEqual(reaches(on('grave_ghoul', 1, 'party', 3, 4))('strike'), [10, 11])
  // A Mantis Reaper with Phantom IV: Reap at its arm, Phantom Edge at its range, a tile past it.
  const mantis = { id: 'mantis_reaper', tracks: [0, 4] }
  assert.deepEqual([blowReach(mantis, abilityDef('reap')), blowReach(mantis, abilityDef('phantom_edge')), reachOf(mantis)], [2, 3, 3])
  assert.deepEqual(reaches(on('mantis_reaper', 1, 'party', 3, 4, 3, [0, 4]))('phantom_edge'), [10, 11, 12])
})

// The roads a ground foe takes from each tile of the foes' rows to the seat, each a list of tiles (the seat last).
function entryRoads (camp) {
  const seat = deployTile('party', monarchSlot(camp))
  const roads = field({ root: seat, walls: wallTiles(camp) })
  const out = []
  for (let t = tileAt(0, DEPTH - ROWS); t < TILES; t++) {
    const road = []
    for (let x = t; x >= 0; x = roads.arrow[x]) road.push(x)
    out.push(road)
  }
  return { seat, roads, out }
}

test('the default frontier: each start soul on a cell of its own, the Tomb Knight on the road most foes walk, the others\' reach all round it', () => {
  const start = START_PARTY.map((id, i) => makeUnit(id, { uid: 1 + i, lvl: 2 }))
  for (const c of CAMP_LIST.filter((x) => x.floor === 1)) {
    const slots = frontier(c.id, start)
    assert.deepEqual(frontier(c.id, start), slots, 'deterministic')
    assert.ok(start.every((u) => u.slot === -1), 'pure: the pieces untouched')
    const taken = new Set([monarchSlot(c.id)])
    start.forEach((u, i) => {
      assert.ok(fits(c.id, slots[i], sizeOf(u), taken), `${c.id}: ${u.id} on ${slots[i]}`)
      for (const x of footprintSlots(slots[i], sizeOf(u))) taken.add(x)
    })
    const { out } = entryRoads(c.id)
    const knight = deployTile('party', slots[0])
    assert.equal(start[0].id, 'tomb_knight')
    assert.ok(out.filter((road) => road.includes(knight)).length > out.length / 2, `${c.id}: the Knight on most roads, in a ground foe's way`)
    start.slice(1).forEach((u, i) => assert.ok(distanceBetween(deployTile('party', slots[i + 1]), sizeOf(u), knight, 1) <= Math.max(1, reachOf(u) - reachOf(start[0])), `${c.id}: ${u.id} reaches round the Knight`))
  }
  // A bigger army, 2×2 pieces among them, finds a cell of its own in every camp; the tankiest melee piece leads.
  const army = ['frost_sprite', 'bone_colossus', 'tomb_knight', 'bone_chanter', 'hive_queen', 'grave_ghoul', 'ember_drake', 'clockwork_page', 'will_o_wisp', 'iron_golem']
    .map((id, i) => makeUnit(id, { uid: 1 + i, lvl: 3 }))
  for (const c of CAMP_LIST) {
    const slots = frontier(c.id, army)
    const taken = new Set([monarchSlot(c.id)])
    army.forEach((u, i) => {
      if (slots[i] < 0) return
      assert.ok(fits(c.id, slots[i], sizeOf(u), taken), `${c.id}: ${u.id} on ${slots[i]}`)
      for (const x of footprintSlots(slots[i], sizeOf(u))) taken.add(x)
    })
    assert.ok(slots.filter((s) => s >= 0).length >= 8, `${c.id}: ${slots}`)
  }
})
