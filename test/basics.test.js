import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hitChance, critChance, computeDamage } from '../src/sim/battle.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { autoPlace, reachable, expand, rowOf, makeUnit, deployTile, slotAt, tileAt, distance, isEngaged, DEPTH, CENTRE_OUT, activeBonds, CAMP_ROWS, campGrid, steps, wallTiles, summonTile, tileX, tileY } from '../src/sim/unit.js'

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

test('formation: auto-fill by role keeps legal slots and fills the rest in column order', () => {
  assert.deepEqual(CENTRE_OUT, [3, 2, 4, 1, 5, 0, 6])
  const party = autoPlace(['bone_chanter', 'tomb_knight', 'frost_sprite'].map((id, i) => makeUnit(id, { uid: i + 1 })))
  assert.deepEqual(party.map((u) => rowOf(u.slot)), [2, 0, 1])
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
  assert.ok(isEngaged(units, knight))
  assert.ok(!isEngaged(units, units[1]))
  assert.deepEqual(expand(units, knight, { shape: 'row' }, units[3]).map((u) => u.uid), [11, 12])
  assert.deepEqual(expand(units, knight, { shape: 'column' }, units[3]).map((u) => u.uid), [11])
  units[2].hp = 0
  assert.deepEqual(reachable(units, knight, melee), [])
  assert.ok(!isEngaged(units, knight), 'the dead engage no one')
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

test('bonds: beside, behind and ahead, by role or same kin; the fallen hold none', () => {
  const soul = (id, uid, row, col) => makeUnit(id, { uid, slot: slotAt(row, col) })
  const held = (units) => activeBonds(units).map((b) => `${b.bond.id}:${b.uid}>${b.partner}`).sort()
  // Two Tomb Knights side by side: Phalanx and Kinship both ways; a Warden behind one: Vigil.
  const units = [soul('tomb_knight', 1, 0, 3), soul('tomb_knight', 2, 0, 4), soul('hive_warden', 3, 1, 3)]
  assert.deepEqual(held(units), ['kinship:1>2', 'kinship:2>1', 'phalanx:1>2', 'phalanx:2>1', 'vigil:1>3'])
  // A Frost Sprite (skirmisher) right ahead of a Bone Chanter (channeler): Spotter. Not diagonal.
  assert.deepEqual(held([soul('bone_chanter', 1, 2, 3), soul('frost_sprite', 2, 1, 3)]), ['spotter:1>2'])
  assert.deepEqual(held([soul('bone_chanter', 1, 2, 3), soul('frost_sprite', 2, 1, 4)]), [])
  // Lanes do not wrap from one row's end to the next row's start.
  assert.deepEqual(held([soul('tomb_knight', 1, 0, 6), soul('tomb_knight', 2, 1, 0)]), [])
  units[1].hp = 0
  assert.deepEqual(held(units), ['vigil:1>3'])
  // Scouted foes have no HP yet and still bond.
  assert.equal(activeBonds([{ id: 'tomb_knight', uid: 0, slot: 0 }, { id: 'tomb_knight', uid: 1, slot: 1 }]).length, 4)
})

test('camp: placement skips walls and spills to the nearest row; steps never cut a wall corner', () => {
  // Broken Palisade: row 1 is '##.#.##'. A Bone Chanter prefers the back row (2), a Frost Sprite row 1.
  const grid = campGrid('palisade')
  const [sprite, chanter] = autoPlace([makeUnit('frost_sprite', { uid: 1 }), makeUnit('bone_chanter', { uid: 2 })], { grid })
  assert.equal(sprite.slot, slotAt(1, 2), 'row 1 lane 3 is a wall; lane 2 is the first open cell')
  assert.equal(chanter.slot, slotAt(2, 3))
  const walled = autoPlace([{ ...makeUnit('tomb_knight', { uid: 3 }), slot: slotAt(1, 0) }], { grid })
  assert.equal(walled[0].slot, slotAt(0, 3), 'a soul on a wall moves off it')
  // A wall at (1, 1) and (2, 2) on a toy board: no diagonal step from (1, 2) to (2, 1) between them.
  const walls = new Set([tileAt(1, 1), tileAt(2, 2)])
  assert.ok(!steps(tileAt(1, 2), walls).includes(tileAt(2, 1)))
  assert.ok(steps(tileAt(1, 2), walls).includes(tileAt(0, 3)), 'a diagonal past open ground is fine')
  assert.ok(!steps(tileAt(1, 2), walls).includes(tileAt(1, 1)))
  assert.equal(wallTiles('palisade').length, 5)
})

test('summons appear on the nearest open tile: beside the summoner, then behind, then ahead, diagonals last', () => {
  const from = tileAt(3, 3)
  const taken = new Set([from])
  const order = []
  for (let i = 0; i < 8; i++) {
    const t = summonTile(from, (x) => !taken.has(x))
    taken.add(t)
    order.push([tileX(t) - 3, tileY(t) - 3])
  }
  assert.deepEqual(order, [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]])
  assert.equal(summonTile(from, () => false), -1)
})
