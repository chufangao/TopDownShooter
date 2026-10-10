import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createBattle, legalOrders, order, preview, playOut, reach, usable, deadline, fork, perform, corpses, roadAhead
} from '../src/sim/turns.js'
import { basicTurn, expertTurn } from '../src/sim/policy.js'
import { addStatus, roadOf } from '../src/sim/battle.js'
import { TUNING } from '../src/tuning.js'
import {
  makeUnit, autoPlace, campGrid, wallTiles, monarchSlot, tileAt, tileY, distance, footprint, slotAt, alive, TILES, DEPTH, ROWS, CAMP_ROWS
} from '../src/sim/unit.js'
import { CAMP_LIST, RELICS } from '../src/content.js'
import { createRng } from '../src/sim/rng.js'

// A battle on turns of units placed on tiles: [{ id, uid, side, x, y, lvl?, tracks? }]. Each deploys where its slot
// puts it (a foe off its formation's rows in a spare slot), then is set on its tile, its turn starting there; the roads
// run to the Monarch where it is set. `opts` go to createBattle.
function field (units, opts = {}) {
  const spare = [...Array(21).keys()].filter((s) => !units.some((u) => u.side === 'foe' && u.y >= DEPTH - ROWS && slotAt(u.y - (DEPTH - ROWS), u.x) === s))
  const camp = [...Array(49).keys()].filter((s) => !units.some((u) => u.side === 'party' && u.y < CAMP_ROWS && slotAt(CAMP_ROWS - 1 - u.y, u.x) === s))
  const slot = (u) => u.side === 'party' ? (u.y < CAMP_ROWS ? slotAt(CAMP_ROWS - 1 - u.y, u.x) : camp.pop())
    : u.y >= DEPTH - ROWS ? slotAt(u.y - (DEPTH - ROWS), u.x) : spare.shift()
  const piece = (u) => ({ ...makeUnit(u.id, { uid: u.uid, lvl: u.lvl ?? 3, tracks: u.tracks ?? [0, 0] }), slot: slot(u) })
  const b = createBattle({
    party: units.filter((u) => u.side === 'party').map(piece), foes: units.filter((u) => u.side === 'foe').map(piece), seed: 'turns', ...opts
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

const unit = (b, uid) => b.byUid.get(uid)
const at = (x, y) => tileAt(x, y)
const end = (b) => order(b, { type: 'end' })
const acts = (events) => events.filter((e) => e.type === 'action')

// Lays a unit dead where it stands, as a blow would: a corpse for Arise.
function slay (b, u) {
  u.hp = 0
  u.statuses = []
  for (const t of footprint(u.tile, u.size)) if ((u.flies ? b.sky : b.at)[t] === u) (u.flies ? b.sky : b.at)[t] = null
  b.roster++
}

test('a move is refused through a foe, through a wall and diagonally past a wall\'s corner, and allowed through an ally', () => {
  const corridor = (middle, walls) => field([
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 2 },
    ...(middle ? [{ ...middle, x: 3, y: 3 }] : []),
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 0, y: 10 }
  ], { walls })
  const sides = [at(2, 3), at(4, 3)]
  // The only way to (3, 4) in two steps is through (3, 3).
  assert.equal(reach(corridor(null, sides), unit(corridor(null, sides), 1), 2).has(at(3, 4)), true, 'open: reached')
  let b = corridor({ id: 'tomb_knight', uid: 5, side: 'foe' }, sides)
  assert.equal(reach(b, unit(b, 1), 2).has(at(3, 4)), false, 'never through a foe')
  b = corridor({ id: 'tomb_knight', uid: 5, side: 'party' }, sides)
  assert.equal(reach(b, unit(b, 1), 2).has(at(3, 4)), true, 'through an ally')
  assert.equal(reach(b, unit(b, 1), 2).has(at(3, 3)), false, 'but never ending on it')
  b = corridor(null, [...sides, at(3, 3)])
  assert.equal(reach(b, unit(b, 1), 2).has(at(3, 4)), false, 'never through a wall')
  // One step diagonally, past a wall on either side of the corner: refused.
  for (const wall of [at(4, 2), at(3, 3)]) {
    b = corridor(null, [wall])
    assert.equal(reach(b, unit(b, 1), 1).has(at(4, 3)), false, `not past the corner at ${wall}`)
  }
  b = corridor(null, [])
  assert.equal(reach(b, unit(b, 1), 1).has(at(4, 3)), true, 'a clear diagonal')
  // And as an order.
  b = corridor({ id: 'tomb_knight', uid: 5, side: 'foe' }, sides)
  assert.throws(() => order(b, { type: 'move', uid: 1, tile: at(3, 4) }))
  assert.ok(!legalOrders(b).some((o) => o.type === 'move' && o.uid === 1 && o.tile === at(3, 4)))
})

test('a move is undone until the piece acts, and the board is as it was', () => {
  const b = field([
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 2 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 10 }
  ])
  const u = unit(b, 1)
  order(b, { type: 'move', uid: 1, tile: at(3, 4) })
  assert.deepEqual([u.tile, u.moved, b.at[at(3, 4)], b.at[at(3, 2)]], [at(3, 4), 2, u, null])
  assert.ok(legalOrders(b).some((o) => o.type === 'undo' && o.uid === 1))
  const events = order(b, { type: 'undo', uid: 1 })
  assert.deepEqual(events.map((e) => [e.type, e.from, e.to]), [['undo', at(3, 4), at(3, 2)]])
  assert.deepEqual([u.tile, u.moved, b.at[at(3, 2)], b.at[at(3, 4)]], [at(3, 2), 0, u, null])
  assert.throws(() => order(b, { type: 'undo', uid: 1 }), 'nothing left to undo')
  // Two moves, one undo: back to where it began its turn.
  order(b, { type: 'move', uid: 1, tile: at(3, 3) })
  order(b, { type: 'move', uid: 1, tile: at(3, 4) })
  assert.throws(() => order(b, { type: 'move', uid: 1, tile: at(3, 5) }), 'its Move is spent')
  order(b, { type: 'undo', uid: 1 })
  assert.equal(u.tile, at(3, 2))
})

test('move, then act; never act, then move, nor undo', () => {
  const b = field([
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 5 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 7, lvl: 20 }
  ])
  order(b, { type: 'move', uid: 1, tile: at(3, 6) })
  order(b, { type: 'act', uid: 1, ability: 'strike', target: 9 })
  assert.ok(unit(b, 1).acted)
  assert.ok(!legalOrders(b).some((o) => o.uid === 1), 'nothing more for it this turn')
  assert.throws(() => order(b, { type: 'move', uid: 1, tile: at(2, 6) }))
  assert.throws(() => order(b, { type: 'undo', uid: 1 }))
  assert.throws(() => order(b, { type: 'act', uid: 1, ability: 'strike', target: 9 }), 'one act a turn')
})

test('counters: a melee blow is answered both ways, once; never a ranged one, never by a Hexed piece, never a counter', () => {
  const scene = () => field([
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 5, lvl: 10 },
    { id: 'frost_sprite', uid: 2, side: 'party', x: 2, y: 5, lvl: 10 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 6, lvl: 10 }
  ])
  // Yours strikes, the foe answers: the preview said so, to the HP.
  let b = scene()
  const shown = preview(b, 1, 'strike', 9)
  assert.ok(shown.damage > 0 && shown.counter > 0)
  let events = order(b, { type: 'act', uid: 1, ability: 'strike', target: 9 })
  const counters = acts(events).filter((e) => e.counter)
  assert.deepEqual(counters.map((e) => [e.actor, e.targets]), [[9, [1]]], 'one counter, by the target, at the striker')
  assert.equal(acts(events).length, 2, 'and the counter is not answered')
  const dealt = (uid, to, after = false) => {
    let past = false
    let n = 0
    for (const e of events) {
      if (e.type === 'action' && e.counter) past = true
      else if (e.type === 'damage' && e.target === to && e.actor === uid && past === after) n += e.damage
    }
    return n
  }
  assert.deepEqual([dealt(1, 9), dealt(9, 1, true)], [shown.damage, shown.counter])
  // A foe strikes, yours answers.
  b = scene()
  b.stage = 'foes'
  events = b.events.length
  perform(b, unit(b, 9), unit(b, 9).basic, unit(b, 1))
  assert.deepEqual(acts(b.events.slice(events)).filter((e) => e.counter).map((e) => [e.actor, e.targets]), [[1, [9]]])
  // A ranged blow: no counter.
  b = scene()
  events = order(b, { type: 'act', uid: 2, ability: unit(b, 2).basic.id, target: 9 })
  assert.equal(acts(events).filter((e) => e.counter).length, 0)
  assert.equal(preview(scene(), 2, unit(b, 2).basic.id, 9).counter, 0)
  // A Hexed target: no counter.
  b = scene()
  addStatus(b, unit(b, 9), 'hexed', 1)
  events = order(b, { type: 'act', uid: 1, ability: 'strike', target: 9 })
  assert.equal(acts(events).filter((e) => e.counter).length, 0)
})

test('a skill rests a turn and is back the turn after; a basic is always there', () => {
  const b = field([
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 5, lvl: 30 },
    { id: 'iron_golem', uid: 9, side: 'foe', x: 3, y: 6, lvl: 30 },
    { id: 'iron_golem', uid: 10, side: 'foe', x: 2, y: 6, lvl: 30 }
  ])
  const u = unit(b, 1)
  const cleave = u.kit.find((a) => a.id === 'cleave')
  assert.ok(usable(b, u, cleave))
  const events = order(b, { type: 'act', uid: 1, ability: 'cleave', target: 9 })
  assert.ok(events.some((e) => e.type === 'cooldown' && e.target === 1 && e.ability === 'cleave' && e.turns === 2))
  end(b)
  assert.equal(b.turn, 2)
  assert.ok(!usable(b, u, cleave), 'resting')
  assert.ok(!legalOrders(b).some((o) => o.uid === 1 && o.ability === 'cleave'))
  assert.ok(legalOrders(b).some((o) => o.uid === 1 && o.ability === 'strike'), 'the basic is there')
  end(b)
  assert.ok(usable(b, u, cleave), 'back')
  assert.ok(legalOrders(b).some((o) => o.uid === 1 && o.ability === 'cleave'))
})

test('End Turn acts the untouched with their basics only: a blow at what they reach, else a heal', () => {
  const b = field([
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 5, lvl: 30 },
    { id: 'hive_warden', uid: 2, side: 'party', x: 0, y: 1, lvl: 30 },
    { id: 'tomb_knight', uid: 3, side: 'party', x: 1, y: 1, lvl: 30 },
    { id: 'iron_golem', uid: 9, side: 'foe', x: 3, y: 6, lvl: 30 },
    { id: 'iron_golem', uid: 10, side: 'foe', x: 2, y: 6, lvl: 30 }
  ])
  unit(b, 3).hp = Math.round(unit(b, 3).maxHp * 0.3)
  const events = end(b)
  const stage = events.findIndex((e) => e.type === 'stage' && e.stage === 'foes')
  const mine = acts(events.slice(0, stage)).filter((e) => !e.counter)
  assert.deepEqual(mine.map((e) => [e.actor, e.ability]), [[1, 'strike'], [2, unit(b, 2).mend.id]], 'Strike, not Cleave; the basic heal, not Mend')
  assert.notEqual(unit(b, 2).mend.id, 'mend')
  assert.equal(mine[1].targets[0], 3)
})

test('Hexed loses the act: no order, nothing at End Turn; it moves still, and the status runs out', () => {
  const b = field([
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 5, lvl: 30 },
    { id: 'iron_golem', uid: 9, side: 'foe', x: 3, y: 6, lvl: 30 }
  ])
  addStatus(b, unit(b, 1), 'hexed', 1)
  assert.ok(!legalOrders(b).some((o) => o.uid === 1 && o.type === 'act'))
  assert.ok(legalOrders(b).some((o) => o.uid === 1 && o.type === 'move'))
  const events = end(b)
  assert.ok(events.some((e) => e.type === 'hexed' && e.target === 1))
  assert.ok(!acts(events).some((e) => e.actor === 1), 'no act, no counter')
  assert.ok(!unit(b, 1).statuses.some((s) => s.id === 'hexed'), 'a turn of it, gone')
  assert.ok(legalOrders(b).some((o) => o.uid === 1 && o.type === 'act'))
})

test('statuses last turns: a damage-over-time ticks at the turn\'s end for twice its per-second power; one laid in the foes\' turn on yours waits a round', () => {
  const b = field([
    { id: 'tomb_knight', uid: 1, side: 'party', x: 0, y: 0, lvl: 30 },
    { id: 'iron_golem', uid: 9, side: 'foe', x: 6, y: 10, lvl: 30 }
  ])
  const u = unit(b, 1)
  addStatus(b, u, 'burning', 2)
  const hp = u.hp
  let events = end(b)
  const ticks = events.filter((e) => e.type === 'damage' && e.status === 'burning')
  assert.deepEqual(ticks.map((e) => e.damage), [12], 'Burning: 6 a second, 12 a turn')
  assert.equal(u.hp, hp - 12)
  events = end(b)
  assert.ok(events.some((e) => e.type === 'expire' && e.status === 'burning'), 'two turns')
  b.stage = 'foes'
  addStatus(b, u, 'withered', 1)
  b.stage = 'party'
  end(b)
  assert.ok(u.statuses.some((s) => s.id === 'withered'), 'laid after its turn: the round\'s end passes it by')
  end(b)
  assert.ok(!u.statuses.some((s) => s.id === 'withered'))
})

test('a wave enters on its turn, and the counter says which turn', () => {
  const sprite = { ...makeUnit('frost_sprite', { uid: 50, lvl: 1 }), side: 'foe', wave: 1, lane: 3, slot: -1 }
  const b = field([
    { id: 'tomb_knight', uid: 1, side: 'party', x: 0, y: 0, lvl: 30 },
    { id: 'iron_golem', uid: 9, side: 'foe', x: 6, y: 10, lvl: 30 }
  ], { reserve: [sprite] })
  const due = 1 + TUNING.spawn.waves.every
  assert.deepEqual(b.waves.map((w) => [w.wave, w.turn, w.entered]), [[1, due, false]])
  assert.deepEqual(b.events.find((e) => e.type === 'turn').next, { wave: 1, turn: due })
  while (b.turn < due - 1) end(b)
  assert.ok(!b.byUid.has(50), 'not before its turn')
  const events = end(b)
  assert.equal(b.turn, due)
  assert.ok(b.byUid.has(50) && alive(unit(b, 50)) && tileY(unit(b, 50).tile) >= DEPTH - ROWS, 'at the top edge')
  assert.ok(events.some((e) => e.type === 'wave' && e.wave === 1))
  assert.deepEqual(events.filter((e) => e.type === 'turn').map((e) => [e.turn, e.next]), [[due, null]])
  assert.ok(b.waves[0].entered)
  assert.equal(deadline(b), due + TUNING.turn.cap - 1, 'the clock counts from it')
})

test('the clock: a battle undecided at the cap is lost', () => {
  const b = field([
    { id: 'tomb_knight', uid: 1, side: 'party', x: 0, y: 0, lvl: 30 },
    { id: 'iron_golem', uid: 9, side: 'foe', x: 6, y: 10, lvl: 30 }
  ], { cap: 3 })
  playOut(b, basicTurn)
  assert.deepEqual([b.over, b.winner, b.reason, b.turn], [true, null, 'turn-cap', 4])
})

test('Arise raises one corpse a turn, the one the player chooses', () => {
  const b = field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 0, y: 0 },
    { id: 'frost_sprite', uid: 20, side: 'foe', x: 3, y: 3 },
    { id: 'will_o_wisp', uid: 21, side: 'foe', x: 4, y: 3 },
    { id: 'iron_golem', uid: 22, side: 'foe', x: 6, y: 10, lvl: 30 }
  ], { relics: ['arise'] })
  slay(b, unit(b, 20))
  slay(b, unit(b, 21))
  const rises = () => legalOrders(b).filter((o) => o.uid === 0)
  assert.deepEqual(rises().map((o) => [o.type, o.ability, o.target]), [['act', 'arise', 20], ['act', 'arise', 21]])
  const events = order(b, { type: 'act', uid: 0, ability: 'arise', target: 21 })
  assert.deepEqual(events.filter((e) => e.type === 'arise').map((e) => e.corpse), [21])
  assert.deepEqual(rises(), [], 'once a turn')
  end(b)
  assert.deepEqual(rises().map((o) => o.target), [20], 'the other, next turn')
  // Without the relic: nothing.
  const none = field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'frost_sprite', uid: 20, side: 'foe', x: 3, y: 3 },
    { id: 'iron_golem', uid: 22, side: 'foe', x: 6, y: 10 }
  ])
  slay(none, unit(none, 20))
  assert.deepEqual(corpses(none), [])
})

test('fuse in battle: the parts are consumed, the price paid, the piece placed on the fuser\'s anchor; refused where a 2×2 cannot fit', () => {
  const parts = [
    { id: 'tomb_knight', uid: 1, side: 'party', x: 2, y: 2 },
    { id: 'tomb_knight', uid: 2, side: 'party', x: 3, y: 2 },
    { id: 'bone_chanter', uid: 3, side: 'party', x: 2, y: 3 },
    { id: 'iron_golem', uid: 9, side: 'foe', x: 6, y: 10, lvl: 20 }
  ]
  const b = field(parts, { essence: 100, fuse: { bone_colossus: { price: 30, lvl: 2, tracks: [0, 0] } } })
  const lit = legalOrders(b).filter((o) => o.type === 'fuse')
  assert.ok(lit.some((o) => o.uid === 1 && o.id === 'bone_colossus'))
  const events = order(b, { type: 'fuse', id: 'bone_colossus', uid: 1, parts: [1, 2, 3] })
  const made = events.find((e) => e.type === 'fuse')
  assert.deepEqual([made.recipe, made.parts, made.price, made.unit.id, made.unit.tile, made.unit.size], ['bone_colossus', [1, 2, 3], 30, 'bone_colossus', at(2, 2), 2])
  assert.deepEqual([b.purse, b.spent], [70, 30])
  assert.deepEqual(b.fused.map((f) => [f.recipe, f.parts, f.price, f.lvl]), [['bone_colossus', [1, 2, 3], 30, 3]])
  for (const uid of [1, 2, 3]) assert.ok(!alive(unit(b, uid)) && unit(b, uid).into === made.unit.uid, `${uid} consumed`)
  const piece = unit(b, made.unit.uid)
  assert.equal(piece.hp, piece.maxHp, 'full HP')
  for (const t of footprint(at(2, 2), 2)) assert.equal(b.at[t], piece)
  assert.ok(piece.acted, 'the fuser\'s act')
  // Not where its footprint is held, and not past the purse.
  const blocked = field([...parts, { id: 'grave_ghoul', uid: 4, side: 'party', x: 3, y: 3 }], { essence: 100 })
  assert.ok(!legalOrders(blocked).some((o) => o.type === 'fuse' && o.uid === 1))
  assert.throws(() => order(blocked, { type: 'fuse', id: 'bone_colossus', uid: 1, parts: [1, 2, 3] }))
  const walled = field(parts, { essence: 100, walls: [at(3, 3)] })
  assert.throws(() => order(walled, { type: 'fuse', id: 'bone_colossus', uid: 1, parts: [1, 2, 3] }))
  const poor = field(parts, { essence: 5 })
  assert.ok(!legalOrders(poor).some((o) => o.type === 'fuse'))
})

// A floor-1 battle: a camp of the floor's with its walls, the Monarch on its seat (holding `relics`), a party of the
// floor's kinds at random tiers, a formation of its foes, and sometimes a later wave.
const FLOOR_1 = ['tomb_knight', 'bone_chanter', 'frost_sprite', 'hive_warden', 'clockwork_page', 'grave_ghoul', 'will_o_wisp', 'pyre_hound']
const RELIC_POOL = ['arise', 'whetstone', 'heartwood', 'tower_shield', 'grave_bell', 'blood_chalice', 'balm', 'war_drum', 'hunters_mark', 'iron_oath']
function floorOne (seed) {
  const rng = createRng(seed)
  const camp = rng.pick(CAMP_LIST.filter((c) => c.floor === 1)).id
  const seat = monarchSlot(camp)
  const party = autoPlace(Array.from({ length: 3 + rng.int(3) }, (_, i) => {
    const a = rng.int(5)
    return makeUnit(rng.pick(FLOOR_1), { uid: i + 1, lvl: 2 + rng.int(3), tracks: [a, rng.int(a > 2 ? 3 : 5)] })
  }), { grid: campGrid(camp), taken: new Set([seat]) })
  party.push(makeUnit('monarch', { uid: 0, slot: seat }))
  const foes = autoPlace(Array.from({ length: 3 + rng.int(3) }, (_, i) => makeUnit(rng.pick(FLOOR_1), { uid: 100 + i, lvl: 1 + rng.int(3) })))
  const reserve = rng.chance(0.5) ? [0, 1].map((i) => ({ ...makeUnit(rng.pick(FLOOR_1), { uid: 200 + i, lvl: 2 }), side: 'foe', wave: 1, lane: rng.int(7), slot: -1 })) : []
  const relics = RELIC_POOL.filter((id) => Object.hasOwn(RELICS, id) && rng.chance(0.3))
  return { party, foes, reserve, seed, floor: 1, walls: wallTiles(camp), relics, essence: rng.int(80), nextUid: 300 }
}

// What must hold of a battle at every step: each foe on its road, each tile held by at most one unit in each layer and
// by the one whose footprint it is, every HP within its bounds.
function holds (b) {
  for (const layer of ['at', 'sky']) {
    for (let t = 0; t < TILES; t++) {
      const u = b[layer][t]
      if (u === null) continue
      assert.ok(alive(u), `a dead ${u.id} on ${t}`)
      assert.equal(!!u.flies, layer === 'sky')
      assert.ok(footprint(u.tile, u.size).includes(t), `${u.id} ${u.uid} indexed on ${t}, standing on ${u.tile}`)
    }
  }
  for (const u of b.units) {
    assert.ok(u.hp >= 0 && u.hp <= u.maxHp, `${u.id} ${u.uid} HP ${u.hp}/${u.maxHp}`)
    if (!alive(u)) continue
    for (const t of footprint(u.tile, u.size)) assert.equal((u.flies ? b.sky : b.at)[t], u, `${u.id} ${u.uid} off the index`)
    if (!u.flies) assert.ok(!b.walls.has(u.tile), `${u.id} on a wall`)
    if (u.side === 'foe') assert.ok(roadOf(b, u).dist[u.tile] < Infinity, `${u.id} ${u.uid} off its road`)
  }
}

// Random legal orders, `per` at most a turn, then End Turn; every act's preview checked against what it dealt.
function fuzz (b, rng, per = 8, log = null) {
  while (!b.over) {
    for (let k = 0; k < per && !b.over; k++) {
      const list = legalOrders(b).filter((o) => o.type !== 'end')
      if (!list.length || rng.chance(0.15)) break
      const o = rng.pick(list)
      log?.push(o)
      const shown = o.type === 'act' ? preview(b, o.uid, o.ability, o.target) : null
      const events = order(b, o)
      if (shown) {
        const answer = events.findIndex((e) => e.type === 'action' && e.counter)
        const dealt = events.slice(0, answer < 0 ? events.length : answer).filter((e) => e.type === 'damage' && !e.status && e.target === o.target).reduce((n, e) => n + e.damage, 0)
        assert.equal(dealt, shown.damage, `preview of ${JSON.stringify(o)}`)
      }
      holds(b)
    }
    if (!b.over) {
      log?.push({ type: 'end' })
      end(b)
      holds(b)
    }
    assert.ok(b.turn <= deadline(b) + 1, 'never past the cap')
  }
  return b
}

test('fuzz: random legal orders to the end keep the foes on their roads, one unit a tile, HP in bounds, and end by the cap', () => {
  for (let i = 0; i < 24; i++) {
    const b = fuzz(createBattle(floorOne(`fuzz${i}`)), createRng(`orders${i}`))
    assert.ok(b.over && ['party', 'foe', null].includes(b.winner), `fuzz${i}`)
    assert.ok(b.events.at(-1).type === 'battle:end')
  }
})

test('the same orders give the same events', () => {
  for (let i = 0; i < 6; i++) {
    const log = []
    const a = fuzz(createBattle(floorOne(`same${i}`)), createRng(`same${i}`), 8, log)
    const b = createBattle(floorOne(`same${i}`))
    for (const o of log) order(b, o)
    assert.deepEqual(b.events, a.events)
    assert.deepEqual([b.winner, b.turn], [a.winner, a.turn])
  }
})

test('a copy plays on apart: its orders never touch the battle it came from', () => {
  const b = createBattle(floorOne('fork'))
  const was = JSON.stringify(b.units.map((u) => [u.uid, u.tile, u.hp, u.statuses, u.cooldowns]))
  const events = b.events.length
  const f = fork(b)
  playOut(f, expertTurn)
  assert.ok(f.over)
  assert.equal(JSON.stringify(b.units.map((u) => [u.uid, u.tile, u.hp, u.statuses, u.cooldowns])), was)
  assert.equal(b.events.length, events)
  assert.equal(b.turn, 1)
})

test('the foes keep to their roads, a flyer to the air road, stopping short of whoever holds the way', () => {
  const b = field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 0, y: 10 },
    { id: 'hive_drone', uid: 10, side: 'foe', x: 6, y: 10 }
  ], { walls: [at(0, 5), at(1, 5), at(2, 5), at(3, 5), at(4, 5), at(5, 5)] })
  for (const uid of [9, 10]) {
    const u = unit(b, uid)
    const road = roadOf(b, u)
    for (const { tile, path } of roadAhead(b, u, 9)) {
      assert.equal(path.length, road.dist[u.tile] - road.dist[tile], 'each step one nearer')
      let t = u.tile
      for (const s of path) {
        assert.equal(road.arrow[t], s, 'along the arrows')
        t = s
      }
    }
  }
  const drone = unit(b, 10)
  assert.equal(roadOf(b, drone).dist[drone.tile], distance(drone.tile, b.root), 'the air road goes over the walls')
  assert.ok(roadOf(b, unit(b, 9)).dist[unit(b, 9).tile] > distance(unit(b, 9).tile, b.root), 'the road goes round them')
  // One of yours on its road holds it there.
  const next = roadOf(b, drone).arrow[roadOf(b, drone).arrow[drone.tile]]
  const held = field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: next % 7, y: Math.floor(next / 7) },
    { id: 'hive_drone', uid: 10, side: 'foe', x: 6, y: 10 }
  ])
  assert.deepEqual(roadAhead(held, unit(held, 10), 9).map((s) => s.tile), [drone.tile, roadOf(b, drone).arrow[drone.tile]])
})

test('with TUNING.dice the battle still runs, its rolls its seed\'s', () => {
  TUNING.dice = true
  try {
    for (let i = 0; i < 4; i++) {
      const a = playOut(createBattle(floorOne(`dice${i}`)), i % 2 ? expertTurn : basicTurn)
      const b = playOut(createBattle(floorOne(`dice${i}`)), i % 2 ? expertTurn : basicTurn)
      assert.ok(a.over && a.dice)
      assert.deepEqual(b.events, a.events)
    }
  } finally {
    TUNING.dice = false
  }
})

test('a battle with no foe left at its start is won at once; a battle plays out under either policy', () => {
  const b = field([{ id: 'tomb_knight', uid: 1, side: 'party', x: 0, y: 0 }])
  assert.deepEqual([b.over, b.winner], [true, 'party'])
  for (const policy of [basicTurn, expertTurn]) {
    const c = playOut(createBattle(floorOne('play')), policy)
    assert.ok(c.over)
  }
})

test('Move: a kind\'s own, its tiers\' and Hasten\'s added; the Monarch never moves', () => {
  const b = field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'frost_sprite', uid: 1, side: 'party', x: 0, y: 0 },
    { id: 'frost_sprite', uid: 2, side: 'party', x: 6, y: 0, tracks: [0, 1] },
    { id: 'iron_golem', uid: 9, side: 'foe', x: 6, y: 10 }
  ])
  const base = unit(b, 1).move
  assert.ok(base >= 1)
  addStatus(b, unit(b, 1), 'hasten', 2)
  addStatus(b, unit(b, 0), 'hasten', 2)
  order(b, { type: 'move', uid: 1, tile: at(0, 1) })
  assert.equal(unit(b, 1).move, base + 1)
  assert.ok(unit(b, 2).move >= base, 'a tier may add to it')
  assert.equal(unit(b, 0).move, 0)
  assert.ok(!legalOrders(b).some((o) => o.uid === 0 && o.type === 'move'))
})

test('the rules registry runs at its hooks: the Legion raises the slain (onKill), a Bodyguard takes the blow (targets)', () => {
  const b = field([
    ...[0, 1, 2, 3].map((x) => ({ id: 'tomb_knight', uid: 1 + x, side: 'party', x, y: 1 })),
    ...[0, 1, 2, 3].map((x) => ({ id: 'grave_ghoul', uid: 5 + x, side: 'party', x, y: 0 })),
    { id: 'bone_chanter', uid: 9, side: 'party', x: 4, y: 1 },
    { id: 'frost_sprite', uid: 20, side: 'foe', x: 0, y: 2, lvl: 1 },
    { id: 'frost_sprite', uid: 21, side: 'foe', x: 4, y: 3 },
    { id: 'iron_golem', uid: 22, side: 'foe', x: 6, y: 10, lvl: 20 }
  ])
  unit(b, 20).hp = 1
  let events = order(b, { type: 'act', uid: 1, ability: 'strike', target: 20 })
  assert.ok(events.some((e) => e.type === 'rule' && e.rule === 'legion' && e.target === 20))
  const risen = events.find((e) => e.type === 'arise')
  assert.deepEqual([risen.corpse, risen.unit.side, risen.rule], [20, 'party', 'legion'])
  b.stage = 'foes'
  const from = b.events.length
  perform(b, unit(b, 21), unit(b, 21).basic, unit(b, 9))
  events = b.events.slice(from)
  const guard = events.find((e) => e.type === 'rule' && e.rule === 'bodyguard')
  assert.ok(guard && guard.target === 9)
  assert.ok(events.some((e) => e.type === 'damage' && e.target === guard.actor))
  assert.ok(!events.some((e) => e.type === 'damage' && e.target === 9))
})

test('Arcane Focus on turns: the killer\'s skills come back a turn sooner', () => {
  const scene = (relics) => {
    const b = field([
      { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 5, lvl: 20 },
      { id: 'frost_sprite', uid: 9, side: 'foe', x: 3, y: 6, lvl: 1 },
      { id: 'iron_golem', uid: 10, side: 'foe', x: 6, y: 10, lvl: 20 }
    ], { relics })
    unit(b, 9).hp = 1
    order(b, { type: 'act', uid: 1, ability: 'cleave', target: 9 })
    assert.ok(!alive(unit(b, 9)))
    return unit(b, 1).cooldowns.cleave
  }
  assert.deepEqual([scene([]), scene(['arcane_focus'])], [2, 1])
})
