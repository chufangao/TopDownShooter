import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeDamage } from '../src/sim/turns.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import {
  autoPlace, expand, makeUnit, deployTile, slotAt, tileAt, distance, DEPTH, CENTRE_OUT, CAMP_ROWS, campGrid, steps, wallTiles,
  monarchSlot, isMonarchCell, fits, campOpen, rowOf, colOf, CAMP_SLOTS, reachOf, baseStats, summonsOf
} from '../src/sim/unit.js'
import { campDef } from '../src/content.js'
import { listFoesNextTo as foesNextTo } from './scene.js'

test('damage is an integer, at least the minimum, and scales the right way: the mean, with no roll', () => {
  const p = { power: 30, atk: TUNING.damage.atkDivisor, def: 0 }
  assert.equal(computeDamage(p), 30)
  assert.equal(computeDamage({ ...p, def: 100 }), 15)
  assert.equal(computeDamage({ ...p, mul: 0.5 }), 15)
  assert.equal(computeDamage({ power: 0, atk: 1, def: 999 }), TUNING.damage.min)
  assert.ok(Number.isInteger(computeDamage({ ...p, mul: 1.0371 })))
  assert.equal(computeDamage(p), computeDamage(p), 'the same blow, the same damage')
})

test('rng is seeded, string seeds work, and streams are independent', () => {
  const a = createRng('seed')
  const b = createRng('seed')
  const xs = Array.from({ length: 5 }, () => a())
  assert.deepEqual(xs, Array.from({ length: 5 }, () => b()))
  assert.notDeepEqual(xs, Array.from({ length: 5 }, () => createRng('other')()))
  assert.equal(createRng('seed').stream('x')(), createRng('seed').stream('x')())
  assert.notEqual(createRng('seed').stream('x')(), createRng('seed').stream('y')())
  const r = createRng(7)
  for (let i = 0; i < 200; i++) {
    const n = r.int(5)
    assert.ok(Number.isInteger(n) && n >= 0 && n < 5)
    const v = r.range(2, 3)
    assert.ok(v >= 2 && v < 3)
  }
  assert.equal(r.weighted(['a', 'b'], [0, 1]), 'b')
  assert.ok(['p', 'q'].includes(r.pick(['p', 'q'])))
})

test('formation: a plain fill keeps legal slots and fills the rest from the front row, in column order', () => {
  assert.deepEqual(CENTRE_OUT, [3, 2, 4, 1, 5, 0, 6])
  const party = autoPlace(['bone_chanter', 'tomb_knight', 'frost_sprite'].map((id, i) => makeUnit(id, { uid: i + 1 })))
  assert.deepEqual(party.map((u) => u.slot), [slotAt(0, 3), slotAt(0, 2), slotAt(0, 4)], 'by no role: the front row, the middle lane first')
  const kept = autoPlace([{ ...makeUnit('tomb_knight', { uid: 1 }), slot: 9 }, makeUnit('tomb_knight', { uid: 2 })])
  assert.deepEqual(kept.map((u) => u.slot), [9, slotAt(0, 3)], 'the middle lane fills first')
  const shuffled = autoPlace([makeUnit('tomb_knight', { uid: 1 }), makeUnit('tomb_knight', { uid: 2 })], { cols: [2, 0, 1, 3] })
  assert.deepEqual(shuffled.map((u) => u.slot), [2, 0])
})

test('board: formations deploy facing each other, and who stands next to whom is by distance', () => {
  // Fronts face each other across the gap; a lane is the same column on both sides.
  assert.equal(deployTile('party', slotAt(CAMP_ROWS - 1, 0)), tileAt(0, 0), 'the camp rear is the bottom edge')
  assert.equal(deployTile('party', slotAt(0, 3)), tileAt(3, CAMP_ROWS - 1))
  assert.equal(deployTile('foe', slotAt(0, 1)), tileAt(1, DEPTH - 3))
  assert.equal(deployTile('foe', slotAt(2, 1)), tileAt(1, DEPTH - 1))
  assert.equal(distance(tileAt(0, 0), tileAt(1, 1)), 1, 'diagonals are one step')
  assert.equal(distance(tileAt(0, 0), tileAt(3, 2)), 3)

  const at = (uid, side, x, y) => ({ ...makeUnit('tomb_knight', { uid }), side, tile: tileAt(x, y) })
  const knight = at(1, 'party', 1, 3)
  const units = [knight, at(2, 'party', 1, 2), at(10, 'foe', 2, 4), at(11, 'foe', 1, 6), at(12, 'foe', 3, 6)]
  assert.deepEqual(foesNextTo(units, knight).map((u) => u.uid), [10])
  assert.deepEqual(foesNextTo(units, units[1]), [])
  assert.deepEqual(expand(units, knight, { shape: 'row' }, units[3]).map((u) => u.uid), [11, 12])
  assert.deepEqual(expand(units, knight, { shape: 'column' }, units[3]).map((u) => u.uid), [11])
  units[2].hp = 0
  assert.deepEqual(foesNextTo(units, knight), [], 'the dead stand next to no one')
})

test('board shapes: a blast hits its target and everyone next to it; an all-allies ability can have a range', () => {
  const at = (uid, side, x, y) => ({ ...makeUnit('tomb_knight', { uid }), side, tile: tileAt(x, y) })
  const caster = at(1, 'party', 3, 0)
  const units = [caster, at(2, 'party', 3, 2), at(3, 'party', 3, 3), at(10, 'foe', 3, 5), at(11, 'foe', 4, 6), at(12, 'foe', 5, 5), at(13, 'foe', 6, 6)]
  assert.deepEqual(expand(units, caster, { shape: 'blast' }, units[4]).map((u) => u.uid), [10, 11, 12])
  assert.deepEqual(expand(units, caster, { shape: 'blast' }, units[6]).map((u) => u.uid), [12, 13])
  const dirge = { shape: 'all_allies', range: 2 }
  assert.deepEqual(expand(units, caster, dirge, caster).map((u) => u.uid), [1, 2])
})

test('reach: a melee kind reaches 1 (a long arm 2), a ranged kind its blows\' range, the Monarch nothing', () => {
  assert.equal(reachOf({ id: 'tomb_knight' }), 1)
  assert.equal(reachOf({ id: 'grave_ghoul' }), 2)
  assert.equal(reachOf({ id: 'frost_sprite' }), 3)
  assert.equal(reachOf({ id: 'bone_chanter' }), 4)
  assert.equal(reachOf({ id: 'monarch' }), 0)
})

test('camp: placement skips walls; the Monarch\'s seat is the camp\'s \'M\' cell; steps never cut a wall corner', () => {
  // Broken Palisade: row 1 is '#..#..#'. Seven souls fill the front row; the next two row 1's open cells.
  const grid = campGrid('palisade')
  const placed = autoPlace(Array.from({ length: 9 }, (_, k) => makeUnit('frost_sprite', { uid: k + 1 })), { grid })
  assert.deepEqual(placed.slice(7).map((u) => u.slot), [slotAt(1, 2), slotAt(1, 4)], 'row 1 lane 3 is a wall; lanes 2 and 4 are open')
  const walled = autoPlace([{ ...makeUnit('tomb_knight', { uid: 3 }), slot: slotAt(1, 0) }], { grid })
  assert.equal(walled[0].slot, slotAt(0, 3), 'a soul on a wall moves off it')
  // A wall at (1, 1) and (2, 2) on a toy board: no diagonal step from (1, 2) to (2, 1) between them.
  const walls = new Set([tileAt(1, 1), tileAt(2, 2)])
  assert.ok(!steps(tileAt(1, 2), walls).includes(tileAt(2, 1)))
  assert.ok(steps(tileAt(1, 2), walls).includes(tileAt(0, 3)), 'a diagonal past open ground is fine')
  assert.ok(!steps(tileAt(1, 2), walls).includes(tileAt(1, 1)))
  assert.equal(wallTiles('palisade').length, campDef('palisade').map.join('').split('#').length - 1)
  // The seat: the one 'M' cell, open ground that no piece may stand on.
  const seat = monarchSlot('palisade')
  assert.equal(campDef('palisade').map[rowOf(seat)][colOf(seat)], 'M')
  assert.deepEqual([...Array(CAMP_SLOTS).keys()].filter((slot) => isMonarchCell('palisade', slot)), [seat])
  assert.ok(campOpen('palisade', seat) && !fits('palisade', seat))
})

test('camp placement honours footprints: a 2×2 keeps a cell where it fits, takes the first where it fits, or none', () => {
  // Broken Palisade (row 1 '#..#..#'): no 2×2 is anchored on the front row (it covers the row ahead), nor across a
  // wall; the first that fits from the front, its lanes from the middle out, is anchored at row 1, lane 4 (cells rows
  // 0–1, lanes 4–5), then at row 1, lane 1.
  const grid = campGrid('palisade')
  const big = (uid, slot = -1) => ({ ...makeUnit('bone_colossus', { uid }), slot })
  const [placed] = autoPlace([big(1)], { grid })
  assert.equal(placed.slot, slotAt(1, 4))
  // One anchored on the front row cannot stay there; one where it fits stays, and the rest go round it.
  const [moved, kept, next] = autoPlace([big(1, slotAt(0, 3)), big(2, slotAt(3, 3)), big(3)], { grid })
  assert.deepEqual([moved.slot, kept.slot, next.slot], [slotAt(1, 4), slotAt(3, 3), slotAt(1, 1)])
  assert.ok([moved, kept, next].every((u) => fits('palisade', u.slot, 2)))
  // Cells held by others (`taken`) are not open to it; with no cell left it goes off the field (−1).
  const taken = new Set([...Array(CAMP_SLOTS).keys()].filter((c) => rowOf(c) > 0))
  assert.equal(autoPlace([big(1)], { grid, taken })[0].slot, -1)
  // A foe formation holds every piece at size 1.
  assert.equal(autoPlace([big(1)])[0].slot, slotAt(0, 3))
})

test('a piece is one soul: its HP its kind\'s at its level, no count, whatever is asked of makeUnit; its summons its tiers\'', () => {
  const b = baseStats('grave_ghoul', 3).hp
  const u = makeUnit('grave_ghoul', { uid: 1, lvl: 3, count: 4 })
  assert.deepEqual([u.count, u.hp, u.maxHp], [undefined, b, b])
  assert.deepEqual(Object.keys(u).sort(), ['hp', 'id', 'lvl', 'maxHp', 'slot', 'tracks', 'uid'])
  // A Bone Chanter calls none until Marrowcaller II, then that tier's (and none more past it).
  assert.deepEqual([[0, 0], [0, 1], [0, 2], [0, 4], [2, 2]].map((tracks) => summonsOf({ id: 'bone_chanter', tracks })), [0, 0, 2, 2, 2])
  assert.equal(summonsOf({ id: 'tomb_knight', tracks: [4, 0] }), 0)
})
