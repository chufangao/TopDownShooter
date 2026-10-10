import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hitChance, critChance, computeDamage } from '../src/sim/battle.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import {
  autoPlace, reachable, expand, makeUnit, deployTile, slotAt, tileAt, distance, foesNextTo, DEPTH, CENTRE_OUT, CAMP_ROWS, campGrid, steps, wallTiles,
  domainTiles, monarchSlot, isMonarchCell, fits, campOpen, rowOf, colOf, CAMP_SLOTS, ringOf, baseStats, bodyHp, livingBodies, bodiesHp
} from '../src/sim/unit.js'
import { campDef } from '../src/content.js'

test('hit and crit are clamped', () => {
  assert.equal(hitChance(50, 50), 0.5)
  assert.equal(hitChance(1000, 0), TUNING.hit.max)
  assert.equal(hitChance(0, 1000), TUNING.hit.min)
  assert.equal(hitChance(0, 0), 0.5)
  assert.equal(critChance(0), TUNING.crit.min)
  assert.equal(critChance(1000), TUNING.crit.max)
})

test('damage is an integer, at least the minimum, and scales the right way', () => {
  const p = { power: 30, atk: TUNING.damage.atkDivisor, def: 0 }
  assert.equal(computeDamage(p), 30)
  assert.equal(computeDamage({ ...p, def: 100 }), 15)
  assert.equal(computeDamage({ ...p, isCrit: true }), Math.round(30 * TUNING.crit.mult))
  assert.equal(computeDamage({ ...p, mul: 0.5 }), 15)
  assert.equal(computeDamage({ power: 0, atk: 1, def: 999 }), TUNING.damage.min)
  assert.ok(Number.isInteger(computeDamage({ ...p, variance: 1.0371 })))
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

test('board: formations deploy facing each other, and reach is by distance', () => {
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
  const melee = { shape: 'single', melee: true }
  assert.deepEqual(reachable(units, knight, melee).map((u) => u.uid), [10])
  assert.deepEqual(reachable(units, knight, { shape: 'single', range: 3 }).map((u) => u.uid), [10, 11, 12])
  assert.deepEqual(reachable(units, knight, { shape: 'all' }).map((u) => u.uid), [10, 11, 12])
  assert.deepEqual(reachable(units, knight, { shape: 'ally' }).map((u) => u.uid), [1, 2])
  assert.deepEqual(foesNextTo(units, knight).map((u) => u.uid), [10])
  assert.deepEqual(foesNextTo(units, units[1]), [])
  assert.deepEqual(expand(units, knight, { shape: 'row' }, units[3]).map((u) => u.uid), [11, 12])
  assert.deepEqual(expand(units, knight, { shape: 'column' }, units[3]).map((u) => u.uid), [11])
  units[2].hp = 0
  assert.deepEqual(reachable(units, knight, melee), [])
  assert.deepEqual(foesNextTo(units, knight), [], 'the dead stand next to no one')
})

test('board shapes: a blast hits its target and everyone next to it; ally abilities can have a range', () => {
  const at = (uid, side, x, y) => ({ ...makeUnit('tomb_knight', { uid }), side, tile: tileAt(x, y) })
  const caster = at(1, 'party', 3, 0)
  const units = [caster, at(2, 'party', 3, 2), at(3, 'party', 3, 3), at(10, 'foe', 3, 5), at(11, 'foe', 4, 6), at(12, 'foe', 5, 5), at(13, 'foe', 6, 6)]
  assert.deepEqual(expand(units, caster, { shape: 'blast' }, units[4]).map((u) => u.uid), [10, 11, 12])
  assert.deepEqual(expand(units, caster, { shape: 'blast' }, units[6]).map((u) => u.uid), [12, 13])
  const dirge = { shape: 'all_allies', range: 2 }
  assert.deepEqual(expand(units, caster, dirge, caster).map((u) => u.uid), [1, 2])
  assert.deepEqual(reachable(units, caster, { shape: 'ally', range: 2 }).map((u) => u.uid), [1, 2])
  assert.deepEqual(reachable(units, caster, { shape: 'ally' }).map((u) => u.uid), [1, 2, 3])
})

test('rings and domain: a melee kind fights within 1, a ranged kind within its reach, the Monarch holds within 1 and strikes nothing; the domain is a square', () => {
  assert.equal(ringOf({ id: 'tomb_knight' }), 1)
  assert.equal(ringOf({ id: 'frost_sprite' }), 3)
  assert.equal(ringOf({ id: 'bone_chanter' }), 4)
  assert.equal(ringOf({ id: 'monarch' }), 1)
  const square = domainTiles(tileAt(3, 1), 2)
  assert.equal(square.length, 5 * 4, 'clipped by the board\'s bottom edge')
  assert.ok(square.every((t) => distance(t, tileAt(3, 1)) <= 2) && square.includes(tileAt(5, 3)) && !square.includes(tileAt(6, 1)))
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
  // The seat (DESIGN §2.1): the one 'M' cell, open ground that no piece may stand on.
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

test('a piece\'s pool: count × body HP; its living bodies ⌈hp ÷ body HP⌉, falling one at a time; its bodies whole, then the one wounded, then the fallen', () => {
  const b = baseStats('grave_ghoul', 3).hp
  const u = makeUnit('grave_ghoul', { uid: 1, lvl: 3, count: 4 })
  assert.deepEqual([u.count, u.hp, u.maxHp, bodyHp(u), livingBodies(u)], [4, 4 * b, 4 * b, b, 4])
  assert.deepEqual(makeUnit('grave_ghoul', { lvl: 3 }).count, 1)
  for (const [hp, living] of [[4 * b - 1, 4], [3 * b, 3], [3 * b - 1, 3], [2 * b + 1, 3], [b, 1], [1, 1], [0, 0]]) {
    assert.equal(livingBodies({ ...u, hp }), living, `hp ${hp}`)
  }
  assert.deepEqual(bodiesHp({ ...u, hp: 2 * b + 5 }), [b, b, 5, 0])
  assert.deepEqual(bodiesHp({ ...u, hp: 3 * b }), [b, b, b, 0])
  assert.deepEqual(bodiesHp({ ...u, hp: 0 }), [0, 0, 0, 0])
  // A battle unit's body is the one the battle fitted.
  assert.equal(livingBodies({ ...u, body: 10, hp: 25 }), 3)
})
