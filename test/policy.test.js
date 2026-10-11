import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, legalOrders, order, fork, reach, addStatus } from '../src/sim/turns.js'
import { danger, dangerAt, press, options, choose, foeTurn, expertTurn, greedyTurn, basicTurn, PLAN } from '../src/sim/policy.js'
import { on, scene, slay } from './scene.js'
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

// At the first turn the camp's impatience gives nothing; the trade may nudge it up by its strength.
const TURN_ONE = TUNING.policy.press.strength + 1e-9

test('the pressure: low at the first turn, 1 once the camp is out of patience', () => {
  const b = approach()
  assert.ok(press(b) <= TURN_ONE)
  b.turn = b.foeIn + TUNING.policy.press.turns
  assert.equal(press(b), 1)
  b.turn = 1 + Math.floor(TUNING.policy.press.turns / 2)
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
  // And played as the camp's turn, out of patience.
  b.turn = b.foeIn + TUNING.policy.press.turns
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

// The camp reads the board and its patience, never what is still to come: two battles alike but for who waits in the
// reserve (the same wave, on the same turn) play the same foe turn.
test('the foes\' turn reads the board, never the reserve: another wave of the same turn gives the same turn', () => {
  const later = (id) => [{ ...makeUnit(id, { uid: 50, lvl: 9 }), side: 'foe', wave: 1, lane: 3, slot: -1 }]
  const board = (id) => field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'frost_sprite', uid: 1, side: 'party', x: 3, y: 2 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 6 },
    { id: 'pyre_hound', uid: 10, side: 'foe', x: 1, y: 7 }
  ], { reserve: later(id) })
  const one = board('grave_ghoul')
  const two = board('frost_wyrm')
  one.stage = two.stage = 'foes'
  assert.deepEqual(foeTurn(two).orders, foeTurn(one).orders)
})

test('the foes move in road order, nearest the Monarch first, each on the board the ones before it left', () => {
  const b = field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 9 },
    { id: 'tomb_knight', uid: 8, side: 'foe', x: 3, y: 10 }
  ])
  b.turn = b.foeIn + TUNING.policy.press.turns
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

// ── the expert plans ahead (redesign.md §2.17) ──────────────────────────────────────────────────

// A board of units on tiles (scene.js): [{ id, uid, side, x, y, lvl?, hp?, relics? }], `hp` the HP it stands at.
const board = (units, opts = {}) => {
  const b = scene(units.map((u) => on(u.id, u.uid, u.side, u.x, u.y, u.lvl ?? 3, [0, 0], u.relics ?? [])), opts)
  for (const u of units) if (u.hp) b.byUid.get(u.uid).hp = u.hp
  return b
}
// A turn by `policy`: its orders, End Turn among them.
const play = (b, policy) => {
  for (const o of policy(b)) if (!b.over) order(b, o)
}
const souls = (b) => b.units.filter((u) => u.side === 'party' && u !== b.monarch && !u.shadow && u.hp > 0).length

// Boards found by a search over small ones, with the numbers as they stand (a balance pass that moves them may need
// others found). Here the greedy turn's best one round ahead leaves a Frost Sprite where the foes' second turn fells
// it, whatever its next turn does; the expert, seeing two rounds, keeps all three pieces.
test('the expert sees two rounds ahead: where the one-round best loses a piece on the next turn, it loses none', () => {
  const units = [
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'frost_sprite', uid: 1, side: 'party', x: 3, y: 4 },
    { id: 'bone_chanter', uid: 2, side: 'party', x: 1, y: 2 },
    { id: 'frost_sprite', uid: 3, side: 'party', x: 4, y: 3 },
    { id: 'pyre_hound', uid: 9, side: 'foe', x: 6, y: 6 },
    { id: 'frost_sprite', uid: 10, side: 'foe', x: 0, y: 4 },
    { id: 'pyre_hound', uid: 11, side: 'foe', x: 4, y: 5 }
  ]
  const greedy = board(units)
  play(greedy, greedyTurn)
  assert.equal(souls(greedy), 3, 'the one-round best loses nothing in its round')
  play(greedy, greedyTurn)
  assert.equal(souls(greedy), 2, 'and a piece in the next')
  const expert = board(units)
  play(expert, expertTurn)
  play(expert, expertTurn)
  assert.equal(souls(expert), 3)
  assert.ok(!expert.over || expert.winner === 'party')
})

test('focus fire: the expert fells a foe that the greedy pass only wounds', () => {
  const units = [
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'grave_ghoul', uid: 1, side: 'party', x: 6, y: 2 },
    { id: 'frost_sprite', uid: 2, side: 'party', x: 3, y: 3 },
    { id: 'frost_sprite', uid: 3, side: 'party', x: 1, y: 2 },
    { id: 'tomb_knight', uid: 4, side: 'party', x: 4, y: 4 },
    { id: 'bone_chanter', uid: 9, side: 'foe', x: 4, y: 5, lvl: 5, hp: 45 },
    { id: 'tomb_knight', uid: 10, side: 'foe', x: 6, y: 3, lvl: 4, hp: 69 }
  ]
  // The chanter as the turn's orders leave it, before End Turn.
  const after = (policy) => {
    const b = board(units)
    for (const o of policy(b)) if (o.type !== 'end') order(b, o)
    return b.byUid.get(9)
  }
  const wounded = after(greedyTurn)
  assert.ok(wounded.hp > 0 && wounded.hp < 45, `greedy: ${wounded.hp}`)
  assert.ok(after(expertTurn).hp <= 0)
})

// Every order the expert gives over whole battles is one legalOrders lists as it is given, the same board giving the
// same orders, its copy too: a battle with a piece holding Arise and corpses to raise, and one with a fusion to make.
test('the expert never gives an illegal order, and the same board gives the same orders', () => {
  const arise = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'bone_chanter', uid: 1, side: 'party', x: 2, y: 2, relics: ['arise'] },
    { id: 'tomb_knight', uid: 2, side: 'party', x: 3, y: 3 },
    { id: 'frost_sprite', uid: 3, side: 'party', x: 5, y: 2 },
    { id: 'grave_ghoul', uid: 8, side: 'foe', x: 2, y: 4 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 6 },
    { id: 'will_o_wisp', uid: 10, side: 'foe', x: 2, y: 8 },
    { id: 'pyre_hound', uid: 11, side: 'foe', x: 4, y: 8 }
  ])
  slay(arise, arise.byUid.get(8))
  const fusion = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 2, y: 2, hp: 60 },
    { id: 'tomb_knight', uid: 2, side: 'party', x: 3, y: 2, hp: 60 },
    { id: 'bone_chanter', uid: 3, side: 'party', x: 2, y: 3, hp: 30 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 6 },
    { id: 'pyre_hound', uid: 10, side: 'foe', x: 4, y: 8 }
  ], { essence: 100, fuse: { bone_colossus: { price: 30, lvl: 3, tracks: [0, 0] } } })
  const kinds = new Set()
  for (const b of [arise, fusion]) {
    assert.deepEqual(expertTurn(fork(b)), expertTurn(b))
    for (let turn = 0; turn < 8 && !b.over; turn++) {
      const orders = expertTurn(b)
      assert.deepEqual(orders.at(-1), { type: 'end' })
      for (const o of orders) {
        if (b.over) break
        if (o.type !== 'end') assert.ok(legalOrders(b).some((l) => JSON.stringify(l) === JSON.stringify(o)), JSON.stringify(o))
        kinds.add(o.type === 'act' ? o.ability : o.type)
        order(b, o)
      }
    }
  }
  assert.ok(['move', 'fuse', 'arise'].every((k) => kinds.has(k)), [...kinds].join())
})

// The essence a fusion spends is weighed against what it leaves on the board (PLAN.essence an essence): at a price no
// board could repay it is not made, though the greedy turn (which weighs HP alone) makes it; under the fusions ablation
// (`fuse` false) none is made at any price.
test('the expert weighs a fusion\'s price: made when cheap, not at a price no board could repay; never with `fuse` false', () => {
  const fusing = (price) => {
    const b = board([
      { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
      { id: 'tomb_knight', uid: 1, side: 'party', x: 2, y: 2 },
      { id: 'tomb_knight', uid: 2, side: 'party', x: 3, y: 2 },
      { id: 'bone_chanter', uid: 3, side: 'party', x: 2, y: 3 },
      { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 6 },
      { id: 'pyre_hound', uid: 10, side: 'foe', x: 4, y: 8 }
    ], { essence: 1e9, fuse: { bone_colossus: { price, lvl: 3, tracks: [0, 0] } } })
    for (const uid of [1, 2, 3]) b.byUid.get(uid).hp = Math.ceil(b.byUid.get(uid).maxHp / 4)
    return b
  }
  const fuses = (orders) => orders.some((o) => o.type === 'fuse')
  // Ten times every max HP on the board, in essence.
  const dear = Math.ceil(10 * fusing(1).units.reduce((n, u) => n + u.maxHp, 0) / PLAN.essence)
  assert.ok(fuses(expertTurn(fusing(1))), 'cheap: fused')
  assert.ok(legalOrders(fusing(dear)).some((o) => o.type === 'fuse') && fuses(greedyTurn(fusing(dear))), 'dear: a legal fusion, which HP alone would make')
  assert.ok(!fuses(expertTurn(fusing(dear))), 'dear: not made')
  assert.ok(!fuses(expertTurn(fusing(1), { fuse: false })), 'never under the ablation')
})

// The search is bounded (PLAN.beam, PLAN.focus, PLAN.arise): a turn on a full board, ten pieces and the Monarch against
// a dozen foes at the deep floors' levels, takes tens of milliseconds (20–50 ms); the bound is generous, for slow
// machines.
test('the expert\'s turn on a full board costs well under a second', () => {
  const mine = ['tomb_knight', 'bone_chanter', 'frost_sprite', 'grave_ghoul', 'pyre_hound', 'mantis_reaper', 'marsh_hag', 'thorn_dryad', 'iron_golem', 'ember_drake']
  const theirs = ['tomb_knight', 'pyre_hound', 'frost_sprite', 'bone_chanter', 'grave_ghoul', 'will_o_wisp', 'rot_bloat', 'hive_warden', 'mantis_reaper', 'barrow_wight', 'ash_wyvern', 'iron_golem']
  const b = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    ...mine.map((id, i) => ({ id, uid: 1 + i, side: 'party', x: 1 + (i % 5), y: 1 + 2 * Math.floor(i / 5), lvl: 8 })),
    ...theirs.map((id, i) => ({ id, uid: 20 + i, side: 'foe', x: i % 7, y: 6 + 2 * Math.floor(i / 7) + (i % 2), lvl: 9 }))
  ])
  // The best of three, past a pause of the machine's (a test run is busy).
  let ms = Infinity
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now()
    const orders = expertTurn(fork(b))
    ms = Math.min(ms, performance.now() - t0)
    assert.ok(orders.length > 1)
  }
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`)
})
