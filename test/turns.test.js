import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createBattle, legalOrders, order, preview, playOut, playTurns, reach, usable, deadline, fork, perform, corpses, roadAhead, addStatus, roadOf,
  timelineHash, stats, enterBattle, foesNextTo, auraGivers, field as roads, fieldOf, airOf, arrowOf, applyDamage, runEffect, riseTile, pick,
  targetsFrom, orderable, synergiesOf, ariseOf, phases
} from '../src/sim/turns.js'
import { basicTurn, expertTurn } from '../src/sim/policy.js'
import { TUNING } from '../src/tuning.js'
import {
  makeUnit, autoPlace, campGrid, wallTiles, monarchSlot, tileAt, tileY, distance, footprint, slotAt, alive, deployTile, steps, TILES, DEPTH,
  ROWS, CAMP_ROWS, NEIGHBOURS, baseStats
} from '../src/sim/unit.js'
import { CAMP_LIST, RELICS, UNIT_LIST, unitDef, statusDef } from '../src/content.js'
import { createRng } from '../src/sim/rng.js'
import { foeLevel, START_PARTY } from '../src/sim/run.js'
import { tuned, FIRST_ARISE } from './tuned.js'
import { on, scene, slay, moves, turns, listFoesNextTo, listAuraGivers } from './scene.js'

// A battle on turns of units placed on tiles: [{ id, uid, side, x, y, lvl?, tracks?, relics? }] (scene.js scene).
const field = (units, opts = {}) => scene(units.map((u) => on(u.id, u.uid, u.side, u.x, u.y, u.lvl ?? 3, u.tracks ?? [0, 0], u.relics ?? [])), opts)

const unit = (b, uid) => b.byUid.get(uid)
const at = (x, y) => tileAt(x, y)
const end = (b) => order(b, { type: 'end' })
const acts = (events) => events.filter((e) => e.type === 'action')

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
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 6, lvl: 30 },
    { id: 'tomb_knight', uid: 10, side: 'foe', x: 2, y: 6, lvl: 30 }
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

test('statuses last turns: a damage-over-time ticks at the turn\'s end for its power a stack; one laid in the foes\' turn on yours waits a round', () => {
  const b = field([
    { id: 'tomb_knight', uid: 1, side: 'party', x: 0, y: 0, lvl: 30 },
    { id: 'iron_golem', uid: 9, side: 'foe', x: 6, y: 10, lvl: 30 }
  ])
  const u = unit(b, 1)
  addStatus(b, u, 'burning', 2)
  const hp = u.hp
  let events = end(b)
  const ticks = events.filter((e) => e.type === 'damage' && e.status === 'burning')
  assert.deepEqual(ticks.map((e) => e.damage), [12], 'Burning: 12 a turn')
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

test('Arise is a skill of the piece holding the relic: one corpse within its reach, the player\'s choice, then a turn\'s rest', () => {
  const b = field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 2, relics: ['arise'] },
    { id: 'tomb_knight', uid: 2, side: 'party', x: 0, y: 0 },
    { id: 'frost_sprite', uid: 20, side: 'foe', x: 3, y: 4 },
    { id: 'will_o_wisp', uid: 21, side: 'foe', x: 4, y: 4 },
    { id: 'iron_golem', uid: 22, side: 'foe', x: 6, y: 10, lvl: 30 }
  ])
  slay(b, unit(b, 20))
  slay(b, unit(b, 21))
  const rises = () => legalOrders(b).filter((o) => o.ability === 'arise')
  assert.deepEqual(rises().map((o) => [o.uid, o.target]), [[1, 20], [1, 21]], 'its holder\'s alone: the Monarch never raises')
  assert.ok(!legalOrders(b).some((o) => o.uid === 0), 'the Monarch takes no orders')
  const events = order(b, { type: 'act', uid: 1, ability: 'arise', target: 21 })
  assert.deepEqual(events.filter((e) => e.type === 'arise').map((e) => [e.actor, e.corpse]), [[1, 21]])
  assert.ok(events.some((e) => e.type === 'cooldown' && e.target === 1 && e.ability === 'arise' && e.turns === 2), 'a skill: it rests')
  const shadow = b.byUid.get(events.find((e) => e.type === 'arise').unit.uid)
  assert.deepEqual([shadow.hp, shadow.maxHp, shadow.shadow, orderable(b, shadow)], [shadow.maxHp, Math.round(stats(b, shadow).hp), true, false], 'at full HP, taking no orders')
  end(b)
  assert.deepEqual(rises(), [], 'resting a turn')
  end(b)
  assert.deepEqual(rises().map((o) => o.target), [20], 'the other, the turn after')
  // Only within its reach (TUNING.arise.domain from the holder) and of a tier it allows; without the relic, none.
  assert.deepEqual(ariseOf(b, unit(b, 1)), { domain: TUNING.arise.domain, tier: TUNING.arise.tier })
  assert.equal(ariseOf(b, unit(b, 2)), null)
  const far = field([
    { id: 'tomb_knight', uid: 1, side: 'party', x: 0, y: 0, relics: ['arise'] },
    { id: 'frost_sprite', uid: 20, side: 'foe', x: 6, y: 6 },
    { id: 'iron_golem', uid: 21, side: 'foe', x: 1, y: 1 },
    { id: 'iron_golem', uid: 22, side: 'foe', x: 6, y: 10, lvl: 30 }
  ], { arise: { domain: 5, tier: 2 } })
  slay(far, unit(far, 20))
  slay(far, unit(far, 21))
  assert.deepEqual(corpses(far, unit(far, 1)), [], 'one six tiles off, and a tier 3 beside it')
  far.arise.domain = 6
  assert.deepEqual(corpses(far, unit(far, 1)).map((c) => c.uid), [20])
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

// A floor-1 battle: a camp of the floor's with its walls, the Monarch on its seat, a party of the floor's kinds at
// random tiers, some holding a relic each, a formation of its foes, and sometimes a later wave.
const FLOOR_1 = ['tomb_knight', 'bone_chanter', 'frost_sprite', 'hive_warden', 'clockwork_page', 'grave_ghoul', 'will_o_wisp', 'pyre_hound']
const RELIC_POOL = ['arise', 'whetstone', 'heartwood', 'tower_shield', 'grave_bell', 'blood_chalice', 'balm', 'war_drum', 'hunters_mark', 'iron_oath']
function floorOne (seed) {
  const rng = createRng(seed)
  const camp = rng.pick(CAMP_LIST.filter((c) => c.floor === 1)).id
  const seat = monarchSlot(camp)
  const relics = RELIC_POOL.filter((id) => Object.hasOwn(RELICS, id) && rng.chance(0.3))
  const party = autoPlace(Array.from({ length: 3 + rng.int(3) }, (_, i) => {
    const a = rng.int(5)
    const piece = makeUnit(rng.pick(FLOOR_1), { uid: i + 1, lvl: 2 + rng.int(3), tracks: [a, rng.int(a > 2 ? 3 : 5)] })
    return { ...piece, relics: relics[i] ? [relics[i]] : [] }
  }), { grid: campGrid(camp), taken: new Set([seat]) })
  party.push(makeUnit('monarch', { uid: 0, slot: seat }))
  const foes = autoPlace(Array.from({ length: 3 + rng.int(3) }, (_, i) => makeUnit(rng.pick(FLOOR_1), { uid: 100 + i, lvl: 1 + rng.int(3) })))
  const reserve = rng.chance(0.5) ? [0, 1].map((i) => ({ ...makeUnit(rng.pick(FLOOR_1), { uid: 200 + i, lvl: 2 }), side: 'foe', wave: 1, lane: rng.int(7), slot: -1 })) : []
  return { party, foes, reserve, floor: 1, walls: wallTiles(camp), relics, essence: rng.int(80), nextUid: 300 }
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

test('no dice: a battle reads no random number, and nothing misses but to a rule', () => {
  const random = Math.random
  Math.random = () => assert.fail('a battle read a random number')
  try {
    for (let i = 0; i < 4; i++) {
      const a = fuzz(createBattle(floorOne(`rng${i}`)), createRng(`rng${i}`), 8)
      assert.ok(!a.events.some((e) => e.type === 'miss' && !a.events.some((r) => r.type === 'rule' && r.rule === 'mirage')), 'nothing misses but to a rule')
    }
    // And under the expert, whose plans are played ahead on copies.
    playOut(createBattle(floorOne('rngx')), expertTurn)
  } finally {
    Math.random = random
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

test('Arcane Focus on turns: its holder\'s skills come back a turn sooner when it slays', () => {
  const scene = (relics) => {
    const b = field([
      { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 5, lvl: 20, relics },
      { id: 'frost_sprite', uid: 9, side: 'foe', x: 3, y: 6, lvl: 1 },
      { id: 'iron_golem', uid: 10, side: 'foe', x: 6, y: 10, lvl: 20 }
    ])
    unit(b, 9).hp = 1
    order(b, { type: 'act', uid: 1, ability: 'cleave', target: 9 })
    assert.ok(!alive(unit(b, 9)))
    return unit(b, 1).cooldowns.cleave
  }
  assert.deepEqual([scene([]), scene(['arcane_focus'])], [2, 1])
})

// ── the battle ───────────────────────────────────────────────────────────────────────────────────────────────────────

function team (ids, { side = 'party', lvl = 2, uid = side === 'party' ? 1 : 100, camp = null } = {}) {
  return autoPlace(ids.map((id, i) => makeUnit(id, { uid: uid + i, lvl })), camp ? { grid: campGrid(camp) } : {})
}

// A plausible encounter for a floor: 3 foes (4 on odd seeds, as an elite), or the boss on floor 4.
function encounter (seed, floor) {
  const rng = createRng(seed).stream('encounter')
  const lvl = foeLevel(floor)
  if (floor === 4 && rng.chance(0.25)) {
    const boss = team(['hollow_sovereign'], { side: 'foe', lvl })
    boss[0].slot = 1
    return { foes: boss, boss: true }
  }
  const pool = UNIT_LIST.filter((u) => u.spawn && u.spawn.minFloor <= floor)
  const n = rng.chance(0.5) ? 3 : 4
  const ids = Array.from({ length: n }, () => rng.weighted(pool, pool.map((u) => u.spawn.weight)).id)
  return { foes: team(ids, { side: 'foe', lvl: lvl + (n === 4 ? 1 : 0) }), boss: false }
}

// In one of the floor's camps, picked by seed, walls and all, against that encounter; with `monarch`, the Monarch on
// the camp's seat and the first piece holding Arise; with `summons`, every Bone Chanter holds Marrowcaller II, and
// calls its summons as the battle begins.
const fresh = (seed, floor = 1, { ids = START_PARTY, monarch = false, summons = false, tune = () => {} } = {}) => {
  const { foes, boss } = encounter(seed, floor)
  const camp = createRng(seed).stream('camp').pick(CAMP_LIST.filter((c) => c.floor === floor)).id
  const party = team(ids, { lvl: 1 + floor, camp })
  if (summons) for (const u of party) if (u.id === 'bone_chanter') u.tracks = [0, 2]
  tune(party)
  if (monarch) {
    party[0].relics = ['arise']
    party.push(makeUnit('monarch', { uid: 0, lvl: 0, slot: monarchSlot(camp) }))
  }
  autoPlace(party, { grid: campGrid(camp) })
  return createBattle({ party, foes, floor, boss, walls: wallTiles(camp), relics: monarch ? ['arise'] : [] })
}
const SUMMONED = { summons: true, monarch: true }

test('battles start with an event, stamp every event with its beat, and only bring the living; the run\'s pieces are untouched', () => {
  const party = team(START_PARTY)
  party[1].hp = 0
  const b = createBattle({ party, foes: team(['clockwork_page'], { side: 'foe' }) })
  assert.equal(b.units.length, 3)
  assert.equal(b.events[0].type, 'battle:start')
  assert.notEqual(b.units[0], party[0])
  playOut(b)
  assert.ok(b.events.every((e) => Number.isInteger(e.beat)))
  assert.equal(b.events.at(-1).type, 'battle:end')
  assert.equal(party[0].cooldowns, undefined, 'the run unit is untouched')
})

test('turn by turn, or played out at once, the same battle', () => {
  for (const opts of [{}, SUMMONED]) {
    const live = fresh('step', 1, opts)
    while (!live.over) playTurns(live, 1)
    const all = playOut(fresh('step', 1, opts))
    assert.deepEqual(live.events, all.events)
    assert.equal(timelineHash(live.events), timelineHash(all.events))
  }
})

test('120 seeded battles across floors under either policy end by the cap with sane HP', () => {
  for (let i = 0; i < 120; i++) {
    const floor = 1 + (i % 4)
    const b = playOut(fresh('fuzz' + i, floor, i % 3 ? {} : SUMMONED), i % 5 ? basicTurn : expertTurn)
    assert.ok(b.over && b.turn <= deadline(b) + 1, `seed ${i} passed the cap`)
    assert.ok([null, 'party', 'foe'].includes(b.winner))
    for (const u of b.units) assert.ok(Number.isInteger(u.hp) && u.hp >= 0 && u.hp <= u.maxHp, `seed ${i}: ${u.id} hp ${u.hp}`)
    for (const e of b.events) if (e.type === 'damage') assert.ok(Number.isInteger(e.damage) && e.damage >= 0)
  }
})

test('boss phases fire once each, in order, as its HP crosses them; a delay to its cooldowns never touches it', () => {
  const boss = team(['hollow_sovereign'], { side: 'foe', lvl: 1 })
  boss[0].slot = 1
  const b = createBattle({ party: team(['tomb_knight'], { lvl: 9 }), foes: boss, boss: true })
  const sov = b.units.find((u) => u.id === 'hollow_sovereign')
  const knight = b.units.find((u) => u.id === 'tomb_knight')
  for (const share of [0.5, 0.3, 0.01]) {
    applyDamage(b, sov, Math.ceil(sov.maxHp * share), { actor: knight })
    phases(b)
  }
  assert.deepEqual(b.events.filter((e) => e.type === 'phase').map((e) => [e.phase, e.status]), [[1, 'enraged'], [2, 'desperate']])
  sov.cooldowns.grave_tide = 1
  knight.cooldowns.cleave = 1
  runEffect(b, { op: 'cooldown', amount: 2 }, knight, [sov, knight])
  assert.deepEqual([sov.cooldowns.grave_tide, knight.cooldowns.cleave], [1, 3])
})

test('only fielded souls with HP fight', () => {
  const party = team(START_PARTY)
  party[2].slot = -1
  party.push(makeUnit('tomb_knight', { uid: 9, lvl: 3, slot: 10 }))
  party[3].hp = 0
  const b = createBattle({ party, foes: team(['clockwork_page'], { side: 'foe' }) })
  assert.deepEqual(b.units.filter((u) => u.side === 'party').map((u) => u.uid).sort(), [1, 2])
})

test('under basic play every move is a foe\'s, along its road onto a tile free in its layer, and your pieces never move', () => tuned({ army: { board: 5 } }, () => {
  let roads = 0
  let flights = 0
  for (let i = 0; i < 40; i++) {
    const b = fresh('walk' + i, 1 + (i % 4), { monarch: i % 3 === 0 })
    const walk = fieldOf(b)
    const air = airOf(b)
    while (!b.over) {
      const before = new Map(b.units.map((u) => [u.uid, u.tile]))
      for (const e of turns(b)) {
        if (e.type !== 'move') continue
        const u = b.byUid.get(e.actor)
        const where = `seed ${i} turn ${b.turn}: ${u.id} ${e.from}→${e.to}`
        assert.equal(u.side, 'foe', `${where}: one of yours moved`)
        let t = e.from
        for (const s of e.path) {
          assert.equal(s, (u.flies ? air : walk).arrow[t], `${where}: off its road`)
          if (!u.flies) assert.ok(steps(t, b.walls).includes(s), `${where}: into or past a wall`)
          t = s
        }
        u.flies ? flights++ : roads++
      }
      for (const u of b.units) if (u.side === 'party' && alive(u) && before.has(u.uid)) assert.equal(u.tile, before.get(u.uid), `seed ${i}: ${u.id} moved`)
      holds(b)
    }
  }
  assert.ok(roads > 0 && flights > 0, `${roads} moves on roads, ${flights} in flight`)
}))

// ── roads ────────────────────────────────────────────────────────────────────────────────────────

test('roads: a flood from the root through every tile but walls; every arrow points strictly closer, by a legal step', () => {
  for (const c of CAMP_LIST) {
    const walls = wallTiles(c.id)
    const root = deployTile('party', monarchSlot(c.id))
    const f = roads({ root, walls })
    assert.equal(f.root, root)
    assert.deepEqual([f.dist[root], f.arrow[root]], [0, -1])
    for (let t = 0; t < TILES; t++) {
      if (walls.includes(t)) {
        assert.deepEqual([f.dist[t], f.arrow[t]], [Infinity, -1], `${c.id}: a wall has no road`)
        continue
      }
      assert.ok(f.dist[t] < Infinity, `${c.id}: tile ${t} has no road`)
      if (t === root) continue
      assert.equal(f.dist[f.arrow[t]], f.dist[t] - 1, `${c.id}: tile ${t}`)
      assert.ok(steps(t, new Set(walls)).includes(f.arrow[t]), `${c.id}: tile ${t} squeezes past a wall`)
    }
  }
  // Pure: the same answer every time, and none of its inputs touched.
  const walls = wallTiles('spiral')
  assert.deepEqual(roads({ root: tileAt(3, 0), walls }), roads({ root: tileAt(3, 0), walls: [...walls] }))
})

test('a tie between arrows goes to the tile nearest the root\'s lane, then nearest its row, then the centre lane', () => {
  const open = roads({ root: tileAt(3, 0) })
  assert.equal(open.arrow[tileAt(3, 3)], tileAt(3, 2))
  assert.equal(open.arrow[tileAt(1, 1)], tileAt(2, 0))
  const side = roads({ root: tileAt(2, 0), walls: [tileAt(2, 2)] })
  assert.deepEqual([side.dist[tileAt(2, 3)], side.dist[tileAt(1, 3)], side.dist[tileAt(3, 3)]], [4, 3, 3])
  assert.equal(side.arrow[tileAt(2, 3)], tileAt(3, 3))
  assert.equal(roads({ root: tileAt(3, 0), walls: [tileAt(3, 2)] }).arrow[tileAt(3, 3)], tileAt(2, 3))
})

test('a lone foe walks its road to the Monarch, every step its tile\'s arrow, and strikes it', () => {
  const walls = wallTiles('spiral')
  const b = scene([on('monarch', 0, 'party', 3, 0), on('grave_ghoul', 10, 'foe', 0, 10, 1)], { walls })
  const ghoul = unit(b, 10)
  const road = roads({ root: tileAt(3, 0), walls })
  const path = []
  while (!b.over && b.turn < 30 && !b.events.some((e) => e.type === 'action' && e.actor === 10)) {
    for (const e of moves(turns(b), 10)) {
      let t = e.from
      for (const s of e.path) {
        assert.equal(s, road.arrow[t])
        t = s
      }
      path.push(...e.path)
    }
  }
  assert.equal(path.length, road.dist[tileAt(0, 10)] - road.dist[ghoul.tile], 'the shortest road, a step at a time')
  assert.ok(b.events.some((e) => e.type === 'action' && e.actor === 10 && e.targets.includes(0)), 'and it strikes the Monarch')
})

test('a foe never steps onto a held tile: it stops behind a comrade, and a piece of yours on its road holds it, and it strikes that piece', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('grave_ghoul', 10, 'foe', 3, 5, 1), on('grave_ghoul', 11, 'foe', 3, 6, 1)])
  const back = unit(b, 11)
  assert.equal(arrowOf(b, back), unit(b, 10).tile)
  assert.ok(!roadAhead(b, back, 9).some((s) => s.tile === unit(b, 10).tile), 'never onto its comrade')
  const blocked = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4, 9), on('grave_ghoul', 10, 'foe', 3, 5, 1)])
  assert.deepEqual(roadAhead(blocked, unit(blocked, 10), 9).map((s) => s.tile), [tileAt(3, 5)], 'held where it stands')
  const events = turns(blocked)
  assert.deepEqual(moves(events, 10), [])
  assert.ok(events.some((e) => e.type === 'action' && e.actor === 10 && e.targets.includes(1)), 'it strikes what holds it')
})

test('the untouched\'s target: the foe furthest along its road, ties by lane, centre first, then the nearest', () => {
  // A Bone Chanter (Marrow Bolt, range 4) at (3, 2), the Monarch at (3, 0); in its reach, Ghouls at (5, 5) and (1, 5),
  // five steps from the Monarch, and at (3, 6), six. Of the two nearer, CENTRE_OUT takes lane 1 first.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('bone_chanter', 1, 'party', 3, 2), on('grave_ghoul', 10, 'foe', 5, 5, 1),
    on('grave_ghoul', 11, 'foe', 1, 5, 1), on('grave_ghoul', 12, 'foe', 3, 6, 1), on('grave_ghoul', 13, 'foe', 3, 7, 1)])
  const chanter = unit(b, 1)
  const aim = () => pick(b, chanter, targetsFrom(b, chanter, chanter.basic))?.uid
  assert.equal(aim(), 11)
  slay(b, unit(b, 11))
  assert.equal(aim(), 10)
  slay(b, unit(b, 10))
  assert.equal(aim(), 12, 'the one at (3, 7) is past its reach')
  const shot = turns(b).find((e) => e.type === 'action' && e.actor === 1)
  assert.deepEqual([shot.ability, shot.targets], [chanter.basic.id, [12]], 'and its basic goes there')
})

test('the tile index matches the living (every tile of a 2×2), and the caches are never stale', () => tuned({ army: { board: 5 } }, () => {
  let wide = 0
  let big = 0
  for (let i = 0; i < 24; i++) {
    // Half the battles bring a Tomb Knight whose Bulwark aura reaches 2 tiles, the widest on the board, and half of
    // those a 2×2 Bone Colossus.
    const bulwark = (party) => Object.assign(party.find((u) => u.id === 'tomb_knight'), { tracks: [3, 0] })
    const ids = [...START_PARTY, 'tomb_knight', i % 4 === 2 ? 'bone_colossus' : 'bone_chanter']
    const b = i % 2 ? fresh('index' + i, 1 + (i % 4), { monarch: true }) : fresh('index' + i, 1 + (i % 4), { ids, tune: bulwark })
    big += b.units.filter((u) => u.size > 1).length
    while (!b.over) {
      playTurns(b, 1, i % 4 === 1 ? expertTurn : basicTurn)
      holds(b)
      const living = b.units.filter((u) => u.hp > 0)
      const indexed = [...b.at, ...b.sky].filter(Boolean)
      assert.equal(new Set(indexed).size, living.length, `seed ${i} turn ${b.turn}: the index holds the dead`)
      assert.equal(indexed.length, living.reduce((n, u) => n + u.size * u.size, 0), `seed ${i} turn ${b.turn}: a tile too many`)
      for (const u of living) {
        assert.deepEqual(foesNextTo(b, u), listFoesNextTo(b.units, u))
        const givers = auraGivers(b, u)
        assert.deepEqual(givers, listAuraGivers(b.units, u))
        wide += givers.filter((g) => distance(g.tile, u.tile) === 2).length
        const cached = stats(b, u)
        const { cache, syn } = b
        b.cache = new Map()
        b.syn = {}
        assert.deepEqual(stats(b, u), cached, `seed ${i} turn ${b.turn}: ${u.id} has stale stats`)
        b.cache = cache
        b.syn = syn
      }
    }
  }
  assert.ok(big > 0, 'some battle brought a 2×2 piece')
  assert.ok(wide > 0, 'some aura reached 2 tiles')
}))

test('a unit can enter a battle under way: on the index, acting, and versioning the roster', () => {
  const b = fresh('enter')
  playTurns(b, 2)
  const roster = b.roster
  const foe = b.units.find((x) => x.side === 'foe' && x.hp > 0) ?? b.units.find((x) => x.side === 'foe')
  const tile = [...Array(TILES).keys()].filter((t) => b.at[t] === null && !b.walls.has(t) && tileY(t) < CAMP_ROWS).sort((x, y) => distance(x, foe.tile) - distance(y, foe.tile) || x - y)[0]
  const u = enterBattle(b, { ...makeUnit('frost_sprite', { uid: 99, lvl: 3 }), side: 'party', tile })
  assert.equal(b.at[tile], u)
  assert.equal(b.roster, roster + 1)
  assert.deepEqual([u.statuses, u.cooldowns, u.relics], [[], {}, []])
  assert.throws(() => enterBattle(b, { ...makeUnit('frost_sprite', { uid: 98 }), side: 'party', tile }), /taken/)
  const open = b.at.findIndex((x, t) => x === null && !b.walls.has(t))
  assert.throws(() => enterBattle(b, { ...makeUnit('frost_sprite', { uid: 97 }), side: 'party', tile: open, hp: 0 }), /no HP/)
  assert.equal(b.at[open], null, 'the dead never stand on the board')
  if (!b.over) assert.ok(legalOrders(b).some((o) => o.uid === 99), 'the newcomer takes orders')
})

test('a unit entering mid-battle fights with its HP mods, as one there from the start does, and only on open ground', () => {
  const walls = [deployTile('party', slotAt(6, 5))]
  const mods = [{ path: 'hp', op: 'mul', v: 1.5 }]
  const knight = (uid, slot) => makeUnit('tomb_knight', { uid, lvl: 3, slot })
  const b = createBattle({ party: [knight(1, slotAt(6, 3))], foes: [knight(10, slotAt(0, 3))], partyMods: mods, walls })
  const u = enterBattle(b, { ...knight(2), side: 'party', tile: deployTile('party', slotAt(6, 1)) })
  assert.equal(u.maxHp, Math.round(stats(b, u).hp))
  assert.ok(u.maxHp >= Math.round(knight(2).maxHp * 1.5), `${u.maxHp}: the +50% is in it`)
  assert.equal(u.hp, u.maxHp)
  const both = createBattle({ party: [knight(1, slotAt(6, 3)), knight(2, slotAt(6, 1))], foes: [knight(10, slotAt(0, 3))], partyMods: mods, walls })
  assert.equal(u.maxHp, both.units.find((x) => x.uid === 2).maxHp)
  assert.throws(() => enterBattle(b, { ...knight(3), side: 'party', tile: walls[0] }), /cannot be stood on/)
  assert.throws(() => enterBattle(b, { ...knight(4), side: 'party', tile: -1 }), /cannot be stood on/)
})

test('a Tomb Knight shields the allies next to it', () => {
  const soul = (id, uid, row, col) => makeUnit(id, { uid, slot: slotAt(row, col), lvl: 3 })
  const party = [soul('tomb_knight', 1, 0, 3), soul('frost_sprite', 2, 1, 4), soul('bone_chanter', 3, 2, 0), soul('tomb_knight', 4, 0, 2)]
  const b = createBattle({ party, foes: [soul('clockwork_page', 10, 2, 3)] })
  const of = (uid) => stats(b, b.units.find((u) => u.uid === uid)).damage.taken
  assert.equal(of(2), 0.85, 'next to a knight')
  assert.equal(of(3), 1, 'three lanes away')
  assert.equal(of(1), 0.85, "the other knight's aura, not its own")
})

test('track tiers fight: a self heal mends the user, and a `who` mod touches only souls it names', () => {
  const b = scene([on('grave_ghoul', 1, 'party', 3, 5, 6, [0, 3]), on('iron_golem', 10, 'foe', 3, 6, 6)])
  const ghoul = unit(b, 1)
  ghoul.hp = Math.round(ghoul.maxHp / 2)
  assert.ok(ghoul.kit.some((a) => a.id === 'devour'))
  const events = order(b, { type: 'act', uid: 1, ability: 'devour', target: 10 })
  assert.ok(events.some((e) => e.type === 'heal' && e.actor === 1 && e.target === 1), 'Devour heals its user')
  const vanguardsOnly = [{ path: 'def', op: 'mul', v: 2, who: { role: ['vanguard'] } }]
  const army = createBattle({ party: autoPlace([makeUnit('tomb_knight', { uid: 2 }), makeUnit('frost_sprite', { uid: 3 })]), foes: team(['clockwork_page'], { side: 'foe' }), partyMods: vanguardsOnly })
  const of = (id) => stats(army, army.units.find((u) => u.id === id)).def
  assert.equal(of('tomb_knight'), 2 * unitDef('tomb_knight').base.def)
  assert.equal(of('frost_sprite'), unitDef('frost_sprite').base.def)
})

// ── the Monarch ──────────────────────────────────────────────────────────────────────────────────

test('the Monarch stands where it is put, never moves, never acts and takes no orders; the roads run to it', () => {
  const b = scene([on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 3, 5), on('frost_sprite', 10, 'foe', 3, 10)])
  const m = b.monarch
  assert.equal(b.root, m.tile)
  assert.deepEqual([m.kit, m.move], [[], 0])
  for (let k = 0; k < 6 && !b.over; k++) {
    assert.ok(!legalOrders(b).some((o) => o.uid === 0))
    for (const e of turns(b)) assert.ok(e.actor !== 0 || e.type === 'death', `the Monarch did ${e.type}`)
  }
  assert.equal(m.tile, tileAt(3, 2), 'it never moved')
  // With no Monarch the roads run to the camp's rear middle tile.
  assert.equal(scene([on('tomb_knight', 1, 'party', 3, 5), on('frost_sprite', 10, 'foe', 3, 10)]).root, tileAt(3, 0))
})

test('the battle is lost the instant the Monarch falls, and the killer is recorded', () => {
  const b = scene([on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 0, 0, 9), on('will_o_wisp', 10, 'foe', 3, 6, 9)])
  playOut(b)
  assert.deepEqual([b.winner, b.reason], ['foe', 'monarch'])
  const death = b.events.findIndex((e) => e.type === 'death' && e.target === 0)
  assert.ok(death > 0)
  assert.deepEqual(b.events.slice(death + 1).map((e) => e.type), ['battle:end'], 'no one acts after it falls')
  const wisp = unit(b, 10)
  assert.deepEqual(b.death, { by: 'will_o_wisp', uid: 10, ability: 'witchfire', from: wisp.tile, shape: 'single', threat: 'reach' })
  assert.deepEqual(b.events.at(-1), { beat: b.beat, type: 'battle:end', winner: 'foe', reason: 'monarch', death: b.death })
  assert.ok(unit(b, 1).hp > 0, 'its soul still stood')
})

test('a party wiped but for the Monarch fights on; units made mid-battle take uids from nextUid', () => {
  const b = scene([on('monarch', 0, 'party', 3, 2), on('frost_sprite', 1, 'party', 0, 0, 1), on('tomb_knight', 11, 'foe', 3, 9, 1)])
  slay(b, unit(b, 1))
  end(b)
  assert.ok(!b.over, 'the Monarch still stands')
  const units = [on('monarch', 0, 'party', 3, 2), on('tomb_knight', 7, 'party', 3, 4), on('grave_ghoul', 40, 'foe', 3, 5, 1)]
  assert.equal(scene(units).nextUid, 41)
  assert.equal(scene(units, { nextUid: 100 }).nextUid, 100)
  const reserve = [{ ...makeUnit('grave_ghoul', { uid: 60, lvl: 3 }), side: 'foe', wave: 1, lane: 3 }]
  assert.equal(scene(units, { reserve }).nextUid, 61, 'past the reserve\'s too')
})

test('with the foes\' rows full, a ground foe of a wave waits in the reserve and enters once a tile there frees; a flyer due beside it enters in the air', () => {
  const rows = [...Array(21).keys()].map((i) => on('clockwork_page', 10 + i, 'foe', i % 7, DEPTH - 1 - Math.floor(i / 7), 1))
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 0, 30), ...rows], {
    reserve: [{ ...makeUnit('grave_ghoul', { uid: 70, lvl: 1 }), side: 'foe', lane: 5, wave: 1 },
      { ...makeUnit('hive_drone', { uid: 71, lvl: 1 }), side: 'foe', lane: 5, wave: 1 }]
  })
  // The Pages hold their rows: a road gained is a loss to them, and they never come down while the test runs.
  for (const u of b.units) if (u.id === 'clockwork_page') u.temper = { aggression: -1, caution: 0, prey: 'weakest' }
  const due = 1 + TUNING.spawn.waves.every
  const seen = []
  while (b.turn < due) seen.push(...turns(b).filter((e) => e.type === 'enter'))
  assert.deepEqual(b.reserve.map((u) => u.uid), [70], 'the Ghoul still waits')
  assert.deepEqual(seen.map((e) => [e.unit.uid, e.unit.tile]), [[71, tileAt(5, DEPTH - 1)]], 'the Drone entered on its turn, in the air')
  slay(b, unit(b, 10 + 7 + 2))
  seen.length = 0
  seen.push(...turns(b).filter((e) => e.type === 'enter'))
  assert.deepEqual(seen.map((e) => [e.unit.uid, e.unit.tile]), [[70, tileAt(2, DEPTH - 2)]], 'the nearest open tile of the foes\' rows to the top of its lane')
})

// ── Arise ────────────────────────────────────────────────────────────────────────────────────────

test('Arise raises any corpse in its holder\'s reach of a tier it allows, whoever stands on it, at full HP beside the Monarch', () => tuned(FIRST_ARISE, () => {
  // The holder at (3, 2), reach 3, tier 1. Corpses: a Bone Chanter (tier 2) 3 tiles off, a Ghoul (tier 1) 3 off, a
  // Tomb Knight 4 off (outside), and a Wisp (tier 1) a tile off under a living knight of yours.
  const b = scene([
    on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 3, 2, 3, [0, 0], ['arise']), on('tomb_knight', 2, 'party', 0, 0, 1),
    on('bone_chanter', 10, 'foe', 6, 2, 4), on('grave_ghoul', 11, 'foe', 4, 5, 2), on('tomb_knight', 13, 'foe', 3, 6, 4),
    on('will_o_wisp', 14, 'foe', 2, 2, 2), on('iron_golem', 15, 'foe', 6, 10, 1)
  ])
  for (const uid of [10, 11, 13, 14]) slay(b, unit(b, uid))
  const knight = unit(b, 2)
  b.at[knight.tile] = null
  knight.tile = knight.from = unit(b, 14).tile
  b.at[knight.tile] = knight
  assert.deepEqual(corpses(b, unit(b, 1)).map((c) => c.uid).sort(), [11, 14])
  const events = order(b, { type: 'act', uid: 1, ability: 'arise', target: 14 })
  const arise = events.find((e) => e.type === 'arise')
  const body = Math.round(baseStats('will_o_wisp', 2).hp)
  assert.deepEqual([arise.actor, arise.corpse, arise.from, arise.unit.hp, arise.unit.maxHp, arise.unit.side], [1, 14, tileAt(2, 2), body, body, 'party'])
  assert.equal(distance(arise.unit.tile, b.monarch.tile), 1, 'beside the Monarch')
  assert.ok(unit(b, 14).raised && b.at[unit(b, 14).tile] === knight)
}))

test('a shadow rises on the free tile closest to the Monarch: ties to the tile nearest where it fell, then lane order', () => {
  const rise = (from, taken = []) => {
    const b = scene([on('monarch', 0, 'party', 3, 0), ...taken.map(([x, y], i) => on('tomb_knight', 1 + i, 'party', x, y)), on('iron_golem', 50, 'foe', 6, DEPTH - 1, 1)])
    return riseTile(b, tileAt(...from))
  }
  assert.equal(rise([3, 6]), tileAt(3, 1))
  assert.equal(rise([0, 3]), tileAt(2, 1))
  assert.equal(rise([1, 3]), tileAt(3, 1))
  assert.equal(rise([6, 1]), tileAt(4, 0))
  assert.equal(rise([3, 6], [[3, 1]]), tileAt(2, 1))
  assert.equal(rise([3, 6], [[2, 0], [4, 0], [2, 1], [3, 1], [4, 1]]), tileAt(3, 2))
})

test('with no free tile for its shadow a corpse is not Arise\'s to raise; once one frees, it rises there', () => {
  const open = [deployTile('party', slotAt(6, 3)), deployTile('party', slotAt(5, 3)), deployTile('foe', slotAt(0, 3)), deployTile('foe', slotAt(0, 4))]
  const walls = [...Array(TILES).keys()].filter((t) => !open.includes(t))
  const full = createBattle({
    party: [makeUnit('monarch', { uid: 0, lvl: 3, slot: slotAt(6, 3) }), { ...makeUnit('tomb_knight', { uid: 1, lvl: 3, slot: slotAt(5, 3) }), relics: ['arise'] }],
    foes: [makeUnit('grave_ghoul', { uid: 10, lvl: 2, slot: slotAt(0, 3) }), makeUnit('iron_golem', { uid: 50, lvl: 1, slot: slotAt(0, 4) })],
    walls, arise: { domain: 9, tier: 3 }
  })
  const corpse = full.byUid.get(10)
  slay(full, corpse)
  const sprite = enterBattle(full, { ...makeUnit('frost_sprite', { uid: 5, lvl: 1 }), side: 'party', tile: corpse.tile })
  assert.deepEqual(corpses(full, full.byUid.get(1)), [], 'no tile, no Arise')
  slay(full, sprite)
  const rose = order(full, { type: 'act', uid: 1, ability: 'arise', target: 10 }).find((e) => e.type === 'arise')
  assert.deepEqual([rose.corpse, rose.unit.tile], [10, corpse.tile])
})

test('a foe road through Arise\'s reach stays clear of its dead: the next foe walks over where the first fell', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 0, 3, [0, 0], ['arise']), on('grave_ghoul', 10, 'foe', 3, 3, 2),
    on('grave_ghoul', 11, 'foe', 3, 5, 2), on('iron_golem', 50, 'foe', 6, DEPTH - 1, 1)])
  slay(b, unit(b, 10))
  const arise = order(b, { type: 'act', uid: 1, ability: 'arise', target: 10 }).find((e) => e.type === 'arise')
  assert.deepEqual([arise.from, arise.unit.tile], [tileAt(3, 3), tileAt(3, 1)])
  assert.equal(fieldOf(b).arrow[tileAt(3, 4)], tileAt(3, 3), 'the road runs through where it fell')
  assert.ok(roadAhead(b, unit(b, 11), 9).some((s) => s.tile === tileAt(3, 3)), 'and the next Ghoul may walk onto it')
})

test('Arise by the numbers: the run\'s reach and tier, a variant\'s own on top; more holders are more raisers', () => {
  const corpse = (id, uid, x, y) => on(id, uid, 'foe', x, y, 2)
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 1, 1, 3, [0, 0], ['arise']), on('tomb_knight', 2, 'party', 5, 1, 3, [0, 0], ['court_of_bone']),
    corpse('grave_ghoul', 10, 1, 4), corpse('iron_golem', 11, 5, 4), corpse('grave_ghoul', 12, 0, 9), on('iron_golem', 50, 'foe', 6, 10, 1)], { arise: { domain: 3, tier: 2 } })
  for (const uid of [10, 11, 12]) slay(b, unit(b, uid))
  assert.deepEqual([ariseOf(b, unit(b, 1)), ariseOf(b, unit(b, 2))], [{ domain: 3, tier: 2 }, { domain: 5, tier: 2 }])
  assert.deepEqual(corpses(b, unit(b, 1)).map((c) => c.uid), [10], 'the golem is tier 3')
  b.arise.tier = 3
  assert.deepEqual(corpses(b, unit(b, 2)).map((c) => c.uid), [10, 11], 'Court of Bone reaches 2 farther')
  order(b, { type: 'act', uid: 1, ability: 'arise', target: 10 })
  order(b, { type: 'act', uid: 2, ability: 'arise', target: 11 })
  assert.equal(b.units.filter((u) => u.arisen).length, 2, 'two holders, two raised in a turn')
})

test('a shadow takes no orders, holds or acts as the untouched do, and counts for synergies', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), ...[0, 1, 2].map((x) => on('grave_ghoul', 1 + x, 'party', x, 3, 3, [0, 0], x === 0 ? ['arise'] : [])),
    on('grave_ghoul', 10, 'foe', 1, 5, 3), on('iron_golem', 11, 'foe', 6, 10, 1)])
  assert.ok(!synergiesOf(b, 'party').some((s) => s.id === 'undead_4'))
  slay(b, unit(b, 10))
  order(b, { type: 'act', uid: 1, ability: 'arise', target: 10 })
  const shadow = b.units.find((u) => u.shadow)
  assert.ok(synergiesOf(b, 'party').some((s) => s.id === 'undead_4'), 'the shadow made Undead 4')
  assert.ok(!legalOrders(b).some((o) => o.uid === shadow.uid))
  const tile = shadow.tile
  for (let k = 0; k < 3 && !b.over; k++) turns(b)
  assert.equal(shadow.tile, tile, 'it holds')
})

test('Arise never raises a boss, a shadow, one consumed by a fusion, or its own side\'s dead; nor anyone past a boss\'s fall; and it raises past the board\'s cap', () => tuned({ army: { board: 1 } }, () => {
  const build = (corpses) => {
    const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 2, 3, [0, 0], ['arise']), on('tomb_knight', 2, 'party', 6, 2), ...corpses, on('iron_golem', 20, 'foe', 6, 10, 1)], { arise: { domain: 5, tier: 9 } })
    for (const c of corpses) slay(b, unit(b, c.uid))
    return b
  }
  const raisable = (b) => corpses(b, unit(b, 1)).map((c) => c.uid)
  assert.deepEqual(raisable(build([on('hollow_sovereign', 10, 'foe', 3, 4, 2), on('grave_ghoul', 11, 'foe', 5, 4, 2)])), [11])
  const shade = build([on('grave_ghoul', 10, 'foe', 3, 4, 2)])
  unit(shade, 10).shadow = true
  assert.deepEqual(raisable(shade), [])
  unit(shade, 10).shadow = false
  assert.deepEqual(raisable(shade), [10])
  unit(shade, 10).into = 99
  assert.deepEqual(raisable(shade), [], 'consumed by a fusion')
  assert.deepEqual(raisable(build([on('grave_ghoul', 5, 'party', 3, 3, 2)])), [], 'never its own dead')
  const past = build([on('grave_ghoul', 10, 'foe', 3, 4, 2)])
  assert.ok(order(past, { type: 'act', uid: 1, ability: 'arise', target: 10 }).some((e) => e.type === 'arise'), 'two souls on a board of one, and it raised')
  const dust = build([on('grave_ghoul', 10, 'foe', 3, 4, 2)])
  dust.crumbled = true
  assert.deepEqual(raisable(dust), [], 'a boss\'s court is dust')
}))

// ── pieces and footprints (DESIGN §2.2) ──────────────────────────────────────────────────────────

test('a 2×2 piece stands on its whole footprint: on the index four times, every reach measured from it, listed once, and its fall clears all four', () => {
  const b = scene([on('bone_colossus', 1, 'party', 2, 3, 9), on('frost_sprite', 2, 'party', 5, 6), on('bone_chanter', 3, 'party', 6, 3),
    on('grave_ghoul', 10, 'foe', 4, 4, 9), on('grave_ghoul', 11, 'foe', 1, 2, 9), on('hive_drone', 12, 'foe', 1, 5, 9)], { walls: [tileAt(5, 0)] })
  const colossus = unit(b, 1)
  const tiles = footprint(tileAt(2, 3), 2)
  assert.equal(colossus.size, 2)
  assert.ok(tiles.every((t) => b.at[t] === colossus), 'on the index on every tile')
  assert.equal(b.events[0].units.find((u) => u.uid === 1).size, 2, 'announced with its size')
  assert.deepEqual(foesNextTo(b, colossus).map((u) => u.uid), [10, 11, 12])
  assert.deepEqual(foesNextTo(b, unit(b, 10)), [colossus])
  assert.deepEqual([2, 3].map((uid) => stats(b, unit(b, uid)).damage.taken), [0.85, 1], 'its aura reaches from the footprint')
  // Its sweep, a melee blow at every foe within 1 of it, strikes both Ghouls once and never the Drone.
  const sweep = order(b, { type: 'act', uid: 1, ability: 'colossal_sweep', target: 10 }).find((e) => e.type === 'action' && e.actor === 1)
  assert.deepEqual(sweep.targets, [10, 11])
  const big = (uid, tile) => ({ ...makeUnit('bone_colossus', { uid, lvl: 1 }), side: 'party', tile })
  assert.throws(() => enterBattle(b, big(90, tileAt(1, 4))), /taken/)
  assert.throws(() => enterBattle(b, big(91, tileAt(6, 0))), /cannot be stood on/)
  assert.throws(() => enterBattle(b, big(92, tileAt(4, 0))), /cannot be stood on/)
  applyDamage(b, colossus, colossus.hp, { actor: unit(b, 10) })
  assert.ok(tiles.every((t) => b.at[t] === null), 'off the index on every tile')
})

// ── flyers (DESIGN §2.4) ─────────────────────────────────────────────────────────────────────────

test('the air road: the roads flooded from the Monarch over every tile, walls and all, a flyer\'s road; your aim at a flyer reads it', () => {
  const walls = [...Array(7).keys()].map((x) => tileAt(x, 5))
  const b = scene([on('monarch', 0, 'party', 3, 0), on('hive_drone', 10, 'foe', 3, 9, 1)], { walls })
  const air = airOf(b)
  assert.equal(airOf(b), air, 'made once')
  assert.equal(fieldOf(b).dist[tileAt(3, 9)], Infinity, 'no road on the ground')
  for (let t = 0; t < TILES; t++) {
    assert.equal(air.dist[t], distance(t, b.root), `tile ${t}`)
    if (t !== b.root) assert.ok(NEIGHBOURS[t].includes(air.arrow[t]) && air.dist[air.arrow[t]] === air.dist[t] - 1, `tile ${t}`)
  }
  assert.deepEqual(air, roads({ root: b.root }), 'the roads with no walls')
  assert.equal(arrowOf(b, unit(b, 10)), tileAt(3, 8), 'a flyer\'s road')
  const aim = scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 3, 3), on('hive_drone', 10, 'foe', 2, 4, 1), on('grave_ghoul', 11, 'foe', 5, 5, 1)],
    { walls: [tileAt(2, 4)] })
  assert.deepEqual([fieldOf(aim).dist[tileAt(2, 4)], airOf(aim).dist[tileAt(2, 4)], fieldOf(aim).dist[tileAt(5, 5)]], [Infinity, 4, 5])
  const sprite = unit(aim, 1)
  assert.equal(pick(aim, sprite, targetsFrom(aim, sprite, sprite.basic)).uid, 10)
})

test('a melee blow never strikes a flyer, a ranged one does, and a ground piece never counters one', () => {
  const b = scene([on('tomb_knight', 1, 'party', 2, 3, 9), on('frost_sprite', 2, 'party', 4, 3, 9), on('hive_drone', 10, 'foe', 3, 4, 9)])
  const [knight, sprite] = [1, 2].map((uid) => unit(b, uid))
  assert.deepEqual(targetsFrom(b, knight, knight.basic), [], 'its reach reads empty')
  assert.deepEqual(targetsFrom(b, sprite, sprite.basic).map((u) => u.uid), [10])
  b.stage = 'foes'
  const from = b.events.length
  perform(b, unit(b, 10), unit(b, 10).basic, knight)
  assert.ok(!b.events.slice(from).some((e) => e.type === 'action' && e.counter), 'no counter from the ground')
})

test('flyers hold the air: a flyer and a ground unit share a tile and never block each other; two of one layer never share one', () => {
  const walls = [1, 2, 3, 4, 5, 6].flatMap((y) => [0, 1, 2, 4, 5, 6].map((x) => tileAt(x, y)))
  const b = scene([on('monarch', 0, 'party', 3, 0, 30), on('hive_drone', 1, 'party', 3, 2, 1), on('mantis_reaper', 10, 'foe', 3, 6, 9),
    on('iron_golem', 50, 'foe', 6, 10, 1)], { walls })
  const [drone, mantis] = [1, 10].map((uid) => unit(b, uid))
  assert.deepEqual([b.sky[drone.tile], b.at[drone.tile]], [drone, null], 'the drone in the air index, the ground under it free')
  assert.equal(fieldOf(b).arrow[tileAt(3, 3)], drone.tile, 'its road runs under the drone')
  assert.ok(roadAhead(b, mantis, 9).some((s) => s.tile === drone.tile), 'a flyer never holds a ground foe\'s road')
  const top = deployTile('foe', slotAt(ROWS - 1, 3))
  const sky = scene([on('monarch', 0, 'party', 3, 0), on('iron_golem', 50, 'foe', 3, 10, 1)])
  const drone2 = enterBattle(sky, { ...makeUnit('hive_drone', { uid: 60, lvl: 1 }), side: 'foe', tile: top })
  assert.deepEqual([sky.sky[top], sky.at[top]?.uid], [drone2, 50], 'a foe flyer over a foe standing on its tile')
  const flyer = (uid, tile) => ({ ...makeUnit('hive_drone', { uid, lvl: 1 }), side: 'party', tile })
  const ground = (uid, tile) => ({ ...makeUnit('tomb_knight', { uid, lvl: 1 }), side: 'party', tile })
  assert.throws(() => enterBattle(sky, flyer(90, top)), /taken/)
  assert.throws(() => enterBattle(sky, ground(91, top)), /taken/)
  assert.doesNotThrow(() => enterBattle(sky, flyer(92, sky.monarch.tile)))
})

test('a shadow of a flying kind flies: it rises in the air nearest the Monarch, over it, and melee from the ground cannot touch it', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 0, 3, [0, 0], ['arise']), on('hive_drone', 10, 'foe', 2, 2, 1),
    on('tomb_knight', 11, 'foe', 3, 1, 9), on('iron_golem', 50, 'foe', 6, 10, 1)])
  slay(b, unit(b, 10))
  const arise = order(b, { type: 'act', uid: 1, ability: 'arise', target: 10 }).find((e) => e.type === 'arise')
  assert.deepEqual([arise?.corpse, arise?.unit.tile], [10, tileAt(3, 0)])
  const shadow = unit(b, arise.unit.uid)
  assert.ok(shadow.flies && shadow.shadow)
  assert.deepEqual([b.sky[shadow.tile], b.at[shadow.tile]], [shadow, b.monarch])
  const knight = unit(b, 11)
  assert.ok(!targetsFrom(b, knight, knight.basic).includes(shadow), 'no melee blow reaches it')
})

// ── statuses the foes bring, and death bursts ────────────────────────────────────────────────────

test('Burning: once a turn its holder takes its power a stack, dealt by whoever laid it, up to its stacks, until it ends; no blow', () => {
  const def = statusDef('burning')
  const power = def.tick[0].power
  const b = scene([on('monarch', 0, 'party', 3, 3, 30), on('tomb_knight', 1, 'party', 0, 0, 9, [0, 0], ['iron_oath']), ...[2, 3, 4].map((x, i) => on('pyre_hound', 10 + i, 'foe', x, 4, 3)),
    on('iron_golem', 50, 'foe', 6, 10, 1)])
  const m = b.monarch
  const hounds = [10, 11, 12].map((uid) => unit(b, uid))
  for (const h of hounds) addStatus(b, m, 'burning', 3, h)
  const stacks = m.statuses.find((s) => s.id === 'burning').stacks
  assert.equal(stacks, Math.min(3, def.stacks))
  for (const h of hounds) slay(b, h)
  const events = []
  while (!b.over && m.statuses.some((s) => s.id === 'burning')) events.push(...turns(b))
  const burns = events.filter((e) => e.type === 'damage' && e.status === 'burning')
  assert.ok(burns.length > 0)
  for (const e of burns) assert.deepEqual([e.target, e.damage, e.ability], [0, power * stacks, null])
  assert.ok(burns.every((e) => [10, 11, 12].includes(e.actor)), 'a fallen hound\'s fire')
  assert.ok(events.some((e) => e.type === 'expire' && e.target === 0 && e.status === 'burning'), 'it ends')
  assert.ok(!events.some((e) => e.type === 'trigger'), 'a burn is no blow')
})

test('a death burst: a Rot Bloat falling Withers the other side\'s living within 1 of where it fell, and no one else', () => {
  const b = scene([on('tomb_knight', 1, 'party', 3, 3, 9), on('frost_sprite', 2, 'party', 4, 5), on('bone_chanter', 3, 'party', 3, 1),
    on('rot_bloat', 10, 'foe', 3, 4, 1), on('grave_ghoul', 11, 'foe', 2, 5, 1), on('iron_golem', 50, 'foe', 6, 10, 1)])
  unit(b, 10).hp = 1
  const events = order(b, { type: 'act', uid: 1, ability: 'strike', target: 10 })
  const death = events.findIndex((e) => e.type === 'death' && e.target === 10)
  const burst = events[death + 1]
  assert.deepEqual([burst.type, burst.actor, burst.tile, burst.targets.slice().sort()], ['burst', 10, tileAt(3, 4), [1, 2]])
  for (const uid of [1, 2]) assert.ok(unit(b, uid).statuses.some((s) => s.id === 'withered'))
  for (const uid of [3, 11]) assert.ok(!unit(b, uid).statuses.some((s) => s.id === 'withered'))
})

// ── the synergies' rules (rules.js) ──────────────────────────────────────────────────────────────

test('Deathblow, an execute: a blow of yours on a foe below a quarter of its HP deals double; none above it, none on yours', () => {
  const tricksters = [0, 1, 2, 3].map((x) => on('clockwork_page', 1 + x, 'party', x, 1, 9))
  const blow = (hp, holders = tricksters) => {
    const b = scene([...holders, on('tomb_knight', 9, 'party', 5, 4, 9), on('iron_golem', 10, 'foe', 5, 5, 20), on('iron_golem', 11, 'foe', 6, 10, 1)])
    const golem = unit(b, 10)
    golem.hp = Math.floor(golem.maxHp * hp)
    const events = order(b, { type: 'act', uid: 9, ability: 'strike', target: 10 })
    return { dealt: events.find((e) => e.type === 'damage' && e.target === 10).damage, rule: events.some((e) => e.type === 'rule' && e.rule === 'deathblow') }
  }
  const low = blow(0.2)
  const plain = blow(0.2, tricksters.slice(0, 3))
  assert.deepEqual([low.rule, plain.rule], [true, false])
  assert.equal(low.dealt, Math.round(plain.dealt * TUNING.deathblow.mult), 'double, below a quarter')
  assert.deepEqual(blow(0.5), { dealt: blow(0.5, tricksters.slice(0, 3)).dealt, rule: false }, 'nothing above it')
})
