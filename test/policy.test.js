import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, legalOrders, order, fork, deadline, reach, addStatus } from '../src/sim/turns.js'
import { danger, dangerAt, press, options, choose, foeTurn, expertTurn, basicTurn } from '../src/sim/policy.js'
import { TEMPERS } from '../src/content.js'
import { TUNING } from '../src/tuning.js'
import { makeUnit, tileAt, footprint, slotAt, DEPTH, ROWS, CAMP_ROWS } from '../src/sim/unit.js'

// A battle on turns of units set on tiles (as test/turns.test.js builds them): [{ id, uid, side, x, y, lvl? }].
function field (units, opts = {}) {
  const spare = [...Array(21).keys()].filter((s) => !units.some((u) => u.side === 'foe' && u.y >= DEPTH - ROWS && slotAt(u.y - (DEPTH - ROWS), u.x) === s))
  const slot = (u) => u.side === 'party' ? slotAt(CAMP_ROWS - 1 - u.y, u.x) : u.y >= DEPTH - ROWS ? slotAt(u.y - (DEPTH - ROWS), u.x) : spare.shift()
  const piece = (u) => ({ ...makeUnit(u.id, { uid: u.uid, lvl: u.lvl ?? 3 }), slot: slot(u) })
  const b = createBattle({
    party: units.filter((u) => u.side === 'party').map(piece), foes: units.filter((u) => u.side === 'foe').map(piece), ...opts
  })
  const placed = units.map((u) => [b.byUid.get(u.uid), tileAt(u.x, u.y)])
  for (const [u] of placed) for (const t of footprint(u.tile, u.size)) (u.flies ? b.sky : b.at)[t] = null
  for (const [u, t] of placed) {
    u.tile = u.from = t
    for (const x of footprint(t, u.size)) (u.flies ? b.sky : b.at)[x] = u
  }
  if (b.monarch) b.root = b.monarch.tile
  b.roads = { walk: null, air: null }
  return b
}

const at = (x, y) => tileAt(x, y)

// The Monarch at the rear, a Frost Sprite before it, and one Tomb Knight of the camp coming down the middle lane.
const approach = (y = 9) => field([
  { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
  { id: 'frost_sprite', uid: 1, side: 'party', x: 3, y: 1 },
  { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y },
  { id: 'tomb_knight', uid: 10, side: 'foe', x: 0, y: 10 }
])

test('the danger map: what your side could deal next turn, by tile, from everywhere its Move takes it; none from the Monarch', () => {
  const b = approach()
  const map = danger(b, 'foe')
  const sprite = b.byUid.get(1)
  const lance = sprite.basic
  const far = Math.max(...[...reach(b, sprite, sprite.move).keys()].map((t) => Math.floor(t / 7))) + lance.range
  assert.ok(map.ground[at(3, far)] > 0, 'its Move and then its reach')
  assert.equal(map.ground[at(3, far + 1)], 0, 'and no further')
  assert.ok(map.air[at(3, far)] > 0, 'a ranged blow reaches a flyer')
  // The Monarch alone deals nothing.
  const alone = field([{ id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 }, { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 2 }])
  assert.ok(danger(alone, 'foe').ground.every((v) => v === 0))
  // A melee kind on the ground: nothing in the air.
  const knight = field([{ id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 1 }, { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 9 }])
  assert.ok(danger(knight, 'foe').air.every((v) => v === 0))
  assert.ok(danger(knight, 'foe').ground[at(3, 2)] > 0)
  // What a foe would take there: by its DEF, never past its HP.
  const foe = b.byUid.get(9)
  assert.ok(dangerAt(b, foe, at(3, far), map) > 0 && dangerAt(b, foe, at(3, far), map) <= foe.hp)
})

// At the first turn the clock gives nothing; the trade may nudge it up by its strength.
const TURN_ONE = TUNING.policy.press.strength + 1e-9

test('the pressure: low at the first turn, 1 at the cap', () => {
  const b = approach()
  assert.ok(press(b) <= TURN_ONE)
  b.turn = deadline(b)
  assert.equal(press(b), 1)
  b.turn = Math.floor(deadline(b) / 2)
  const mid = press(b)
  assert.ok(mid > 0 && mid < 1)
})

test('a foe at low pressure stops at the edge of the danger map; at high pressure it comes in', () => {
  const b = approach()
  const foe = b.byUid.get(9)
  const map = danger(b, 'foe')
  const temper = TEMPERS.charger
  const low = choose(b, foe, temper, 0, map)
  assert.equal(map.ground[low.tile], 0, 'it holds outside')
  assert.ok(low.tile !== foe.tile, 'having come as far as it safely could')
  assert.ok(options(b, foe).some((o) => map.ground[o.tile] > 0), 'though it could have come in')
  const high = choose(b, foe, temper, 1, map)
  assert.ok(map.ground[high.tile] > 0, 'it comes in')
  // And played as the camp's turn, at the cap.
  b.turn = deadline(b)
  foe.temper = temper
  foeTurn(b)
  assert.ok(map.ground[foe.tile] > 0)
})

test('the same board gives the same foe turn', () => {
  const b = approach(8)
  const one = foeTurn(fork(b, { quiet: false }))
  const two = foeTurn(fork(b, { quiet: false }))
  assert.ok(one.orders.length > 0)
  assert.deepEqual(two, one)
})

test('the foes move in road order, nearest the Monarch first, each on the board the ones before it left', () => {
  const b = field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 9 },
    { id: 'tomb_knight', uid: 8, side: 'foe', x: 3, y: 10 }
  ])
  b.turn = deadline(b)
  const { orders } = foeTurn(fork(b, { quiet: false }))
  assert.deepEqual(orders.filter((o) => o.type === 'move').map((o) => o.uid), [9, 8])
})

test('a Hexed foe moves but does not act', () => {
  const b = field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 5, lvl: 20 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 6, lvl: 20 }
  ])
  addStatus(b, b.byUid.get(9), 'hexed', 1)
  b.stage = 'foes'
  const { orders, events } = foeTurn(b)
  assert.ok(!orders.some((o) => o.type === 'act'))
  assert.ok(events.some((e) => e.type === 'hexed' && e.target === 9))
})

test('the expert gives legal orders, the same for the same board, and ends its turn; the basic player only ends it', () => {
  const b = field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 3 },
    { id: 'bone_chanter', uid: 2, side: 'party', x: 2, y: 2 },
    { id: 'frost_sprite', uid: 3, side: 'party', x: 4, y: 2 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 6 },
    { id: 'will_o_wisp', uid: 10, side: 'foe', x: 2, y: 8 },
    { id: 'pyre_hound', uid: 11, side: 'foe', x: 4, y: 8 }
  ], { relics: ['arise'] })
  const orders = expertTurn(b)
  assert.deepEqual(expertTurn(b), orders)
  assert.deepEqual(orders.at(-1), { type: 'end' })
  const was = b.turn
  for (const o of orders) {
    if (o.type !== 'end') assert.ok(legalOrders(b).some((l) => JSON.stringify(l) === JSON.stringify(o)), JSON.stringify(o))
    order(b, o)
  }
  assert.ok(b.over || b.turn === was + 1)
  assert.deepEqual(basicTurn(b), [{ type: 'end' }])
})

test('the expert weighs Fuse as an act: a recipe\'s parts standing together, wounded, and the price in the purse, it fuses; never with `fuse` false', () => {
  const b = field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 2, y: 2 },
    { id: 'tomb_knight', uid: 2, side: 'party', x: 3, y: 2 },
    { id: 'bone_chanter', uid: 3, side: 'party', x: 2, y: 3 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 6 },
    { id: 'pyre_hound', uid: 10, side: 'foe', x: 4, y: 8 }
  ], { essence: 100, fuse: { bone_colossus: { price: 30, lvl: 3, tracks: [0, 0] } } })
  for (const uid of [1, 2, 3]) b.byUid.get(uid).hp = Math.ceil(b.byUid.get(uid).maxHp / 4)
  const orders = expertTurn(b)
  const fused = orders.find((o) => o.type === 'fuse')
  assert.ok(fused && fused.id === 'bone_colossus', JSON.stringify(orders))
  assert.ok(legalOrders(b).some((l) => JSON.stringify(l) === JSON.stringify(fused)), 'a legal order')
  for (const o of orders) if (!b.over) order(b, o)
  assert.equal(b.fused.length, 1)
  assert.ok(!expertTurn(field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 2, y: 2 },
    { id: 'tomb_knight', uid: 2, side: 'party', x: 3, y: 2 },
    { id: 'bone_chanter', uid: 3, side: 'party', x: 2, y: 3 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 6 }
  ], { essence: 100, fuse: { bone_colossus: { price: 30, lvl: 3, tracks: [0, 0] } } }), { fuse: false }).some((o) => o.type === 'fuse'))
})
