import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, legalOrders, order, fork, reach, addStatus } from '../src/sim/turns.js'
import {
  danger, dangerAt, press, options, choose, foeTurn, expertTurn, basicTurn, situation, features, choice, expertOptions, boardFeatures, evaluate, judge
} from '../src/sim/policy.js'
import { createRng } from '../src/sim/rng.js'
import { value, decide, TREES } from '../src/sim/expert.js'
import { on, scene, slay } from './scene.js'
import { TEMPERS } from '../src/content.js'
import { TUNING } from '../src/tuning.js'
import { makeUnit, tileAt, tileX, tileY, footprint, slotAt, DEPTH, ROWS, CAMP_ROWS } from '../src/sim/unit.js'
import { tuned } from './tuned.js'
import { load, createNet, toJSON, FEATURES, value as V, weights } from '../src/sim/value.js'

// These read the plan, the tree and today's scorer, so the static evaluation; policy-learned.test.js runs them again
// with the expert on V (TUNING.expert.beam.learned: the shipped value.json, its `hybrid`).
if (!TUNING.expert.beam.learned) load(null)

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

// ── the expert scores (redesign.md §2.17) ───────────────────────────────────────────────────────

// A board of units on tiles (scene.js): [{ id, uid, side, x, y, lvl?, hp?, relics? }], `hp` the HP it stands at.
const board = (units, opts = {}) => {
  const b = scene(units.map((u) => on(u.id, u.uid, u.side, u.x, u.y, u.lvl ?? 3, [0, 0], u.relics ?? [])), opts)
  for (const u of units) if (u.hp) b.byUid.get(u.uid).hp = u.hp
  return b
}
const piece = (b, uid) => b.byUid.get(uid)
// The decision piece `uid` makes on `b` as it stands (policy.js choice).
const decided = (b, uid) => choice(b, piece(b, uid))
const where = (t) => `(${tileX(t)},${tileY(t)})`

test('every feature the expert reads has its weight, and an option\'s score is their weighted sum', () => {
  const b = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 3 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 6 }
  ])
  const W = TUNING.expert.battle
  const sit = situation(b)
  for (const o of expertOptions(b, piece(b, 1))) {
    const v = features(b, piece(b, 1), o, sit)
    for (const [k, x] of Object.entries(v)) assert.ok(k in W.option && Number.isFinite(x), k)
    assert.equal(value(v, W.option), Object.keys(v).reduce((n, k) => n + W.option[k] * v[k], 0))
  }
  for (const k of Object.keys(boardFeatures(b))) assert.ok(k in W.board, k)
  for (const mode of Object.values(W.modes)) for (const k of Object.keys(mode)) assert.ok(k in W.option, k)
  // A decision's tree and its weights: `by` names the rule that forced or filtered it, or the weights.
  const one = decide([], null, [{ v: { damage: 1 } }, { v: { damage: 3 } }], W.option)
  assert.deepEqual([one.option.v.damage, one.by, one.rules], [3, 'weights', []])
})

test('the expert\'s piece takes a kill over a scratch', () => {
  // A Frost Sprite with a foe it can fell and a whole Tomb Knight it can only scratch, both in its lance's reach.
  const b = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'frost_sprite', uid: 1, side: 'party', x: 3, y: 3 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 2, y: 6, lvl: 9 },
    { id: 'clockwork_page', uid: 10, side: 'foe', x: 4, y: 6, hp: 5 }
  ])
  const sprite = piece(b, 1)
  assert.ok(expertOptions(b, sprite).some((o) => o.target?.uid === 9), 'it could strike the Knight')
  const { option } = decided(b, 1)
  assert.equal(option.target?.uid, 10)
  assert.ok(option.v.kill > 0)
})

test('with nothing to fell, the expert\'s piece ends out of the danger map rather than in it', () => {
  // A lone Frost Sprite before three strong Knights: from where its Move takes it it could scratch one, from inside what
  // they could deal it next turn.
  const b = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'frost_sprite', uid: 1, side: 'party', x: 3, y: 2 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 2, y: 7, lvl: 12 },
    { id: 'tomb_knight', uid: 10, side: 'foe', x: 3, y: 7, lvl: 12 },
    { id: 'tomb_knight', uid: 11, side: 'foe', x: 4, y: 7, lvl: 12 }
  ])
  const sprite = piece(b, 1)
  const sit = situation(b)
  const opts = expertOptions(b, sprite)
  assert.ok(opts.some((o) => dangerAt(b, sprite, o.tile, sit.map) > 0), 'some of its tiles are in the danger map')
  assert.ok(!sit.killable.length, 'and none of the foes can be felled')
  const { option } = decided(b, 1)
  assert.equal(dangerAt(b, sprite, option.tile, sit.map), 0, where(option.tile))
})

test('the expert\'s piece blocks the road into the Monarch when nothing is in reach', () => {
  // A Tomb Knight of yours off to the side and one foe far up the middle: its road comes in beside the seat.
  const b = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 5, y: 2 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 9 }
  ])
  const sit = situation(b)
  assert.equal(sit.roads.length, 1)
  const entry = sit.roads[0].tile
  // The ghoul's road runs down lane 3 to the entry beside the seat: the knight ends on it, between the two (where it
  // holds the road: a foe never passes through a piece), and once beside the seat its screen counts that road.
  const { option } = decided(b, 1)
  assert.ok(tileX(option.tile) === 3 && tileY(option.tile) >= tileY(entry) && tileY(option.tile) < 9, `on the road, not ${where(option.tile)}`)
  if (option.tile === entry) assert.ok(option.v.screen > 0)
  // Played: its move is the turn's, and the road stays held after it.
  for (const o of expertTurn(b)) order(b, o)
  const knight = piece(b, 1)
  assert.ok(tileX(knight.tile) === 3 && tileY(knight.tile) >= tileY(entry) && tileY(knight.tile) < tileY(piece(b, 9).tile), where(knight.tile))
})

// ── the tree's rules, one test each (expert.js TREES) ───────────────────────────────────────────

test('rule no-waste: a ward on allies who all hold it at its full stacks (the Monarch too) is no option', () => {
  const b = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'bone_chanter', uid: 1, side: 'party', x: 3, y: 2 },
    { id: 'tomb_knight', uid: 2, side: 'party', x: 4, y: 2 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 9 }
  ])
  for (const uid of [0, 1, 2]) addStatus(b, piece(b, uid), 'hasten', 3)
  const opts = expertOptions(b, piece(b, 1))
  assert.ok(opts.some((o) => o.ability?.id === 'dirge'), 'Dirge is offered')
  const pick = choice(b, piece(b, 1), situation(b), opts)
  assert.ok(pick.rules.includes('no-waste'), JSON.stringify(pick.rules))
  assert.notEqual(pick.option.ability?.id, 'dirge')
  assert.ok(opts.filter((o) => o.ability?.id === 'dirge').every((o) => o.v.waste === 1))
})

test('rule monarch-lethal: with the Monarch about to fall, only what keeps it standing is an option', () => {
  // The Monarch at 5 HP, a Ghoul beside it; your Frost Sprite could fell the Ghoul, or strike the wounded Knight.
  const b = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0, hp: 5 },
    { id: 'frost_sprite', uid: 1, side: 'party', x: 3, y: 3 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 2, hp: 10 },
    { id: 'tomb_knight', uid: 10, side: 'foe', x: 5, y: 5, hp: 20 }
  ])
  const sit = situation(b)
  assert.ok(sit.monarch.lethal)
  const pick = decided(b, 1)
  assert.equal(pick.by, 'monarch-lethal')
  assert.equal(pick.option.v.lethal, 0)
  assert.equal(pick.option.target?.uid, 9)
})

test('rule kill-first: a foe that could strike the Monarch next turn, and can be felled, is felled first', () => {
  // The Monarch whole; a wounded Ghoul two tiles from it, and a whole Knight your Sprite would deal more to.
  const b = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'frost_sprite', uid: 1, side: 'party', x: 1, y: 3 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 3, hp: 12 },
    { id: 'tomb_knight', uid: 10, side: 'foe', x: 1, y: 6, lvl: 6 }
  ])
  const sit = situation(b)
  assert.ok(!sit.monarch.lethal && sit.monarch.threats.some((x) => x.uid === 9), JSON.stringify(sit.monarch.threats))
  const pick = decided(b, 1)
  assert.equal(pick.by, 'kill-first')
  assert.equal(pick.option.target?.uid, 9)
  // And the Monarch within reach selects the guard's weights.
  assert.ok(pick.rules.includes('guard'))
})

test('rule never-die: a piece does not end where the danger map says it falls, unless its act kills or shields the Monarch', () => {
  // A Frost Sprite at 12 HP that could strike a whole Knight only from among three Knights that would fell it.
  const b = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'frost_sprite', uid: 1, side: 'party', x: 3, y: 3, hp: 12 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 2, y: 7, lvl: 9 },
    { id: 'tomb_knight', uid: 10, side: 'foe', x: 3, y: 7, lvl: 9 },
    { id: 'tomb_knight', uid: 11, side: 'foe', x: 4, y: 7, lvl: 9 }
  ])
  const opts = expertOptions(b, piece(b, 1))
  const pick = choice(b, piece(b, 1), situation(b), opts)
  assert.ok(opts.some((o) => o.v.fall > 0 && !o.v.kill) && opts.some((o) => !o.v.fall), 'deadly tiles and safe ones')
  assert.ok(pick.rules.includes('never-die'), JSON.stringify(pick.rules))
  assert.equal(pick.option.v.fall, 0)
})

test('rule no-doom: of the boards a turn could leave, never one where the foes could fell the Monarch next turn', () => {
  const doomed = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0, hp: 5 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 0, y: 2 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 1 }
  ])
  const safe = fork(doomed)
  slay(safe, safe.byUid.get(9))
  // Even with the doomed board's other numbers made to look better.
  const boards = [{ name: 'doomed', v: { ...boardFeatures(doomed), hp: 1e4 } }, { name: 'safe', v: boardFeatures(safe) }]
  assert.deepEqual([boards[0].v.doom, boards[1].v.doom], [1, 0])
  const pick = decide(TREES.board, null, boards, TUNING.expert.battle.board)
  assert.deepEqual([pick.option.name, pick.by], ['safe', 'no-doom'])
})

// ── the expert's turns ──────────────────────────────────────────────────────────────────────────

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

// Two Tomb Knights and a Bone Chanter standing together, the purse full: a fusion is an option of each (its worth, the
// fused piece's HP over its parts', against its price: TUNING.expert.battle.option.essence an essence).
const fusing = (price, hp = (u) => Math.ceil(u.maxHp / 4)) => {
  const b = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 2, y: 2 },
    { id: 'tomb_knight', uid: 2, side: 'party', x: 3, y: 2 },
    { id: 'bone_chanter', uid: 3, side: 'party', x: 2, y: 3 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 6 },
    { id: 'pyre_hound', uid: 10, side: 'foe', x: 4, y: 8 }
  ], { essence: 1e9, fuse: { bone_colossus: { price, lvl: 3, tracks: [0, 0] } } })
  for (const uid of [1, 2, 3]) b.byUid.get(uid).hp = hp(b.byUid.get(uid))
  return b
}
const fuses = (orders) => orders.some((o) => o.type === 'fuse')

test('the expert weighs Fuse as an act: wounded parts and a cheap price, it fuses; at a price no board could repay it does not; never with `fuse` false', () => {
  const b = fusing(30)
  const orders = expertTurn(b)
  const fused = orders.find((o) => o.type === 'fuse')
  assert.ok(fused && fused.id === 'bone_colossus', JSON.stringify(orders))
  assert.ok(legalOrders(b).some((l) => JSON.stringify(l) === JSON.stringify(fused)), 'a legal order')
  for (const o of orders) if (!b.over) order(b, o)
  assert.equal(b.fused.length, 1)
  // Ten times every max HP on the board, in essence.
  const dear = Math.ceil(10 * fusing(1).units.reduce((n, u) => n + u.maxHp, 0) / -TUNING.expert.battle.option.essence)
  assert.ok(legalOrders(fusing(dear)).some((o) => o.type === 'fuse'), 'dear: a legal fusion')
  assert.ok(!fuses(expertTurn(fusing(dear))), 'dear: not made')
  assert.ok(!fuses(expertTurn(fusing(1), { fuse: false })), 'never under the ablation')
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
  const kinds = new Set()
  for (const b of [arise, fusing(30, (u) => Math.ceil(u.maxHp / 3))]) {
    assert.deepEqual(expertTurn(fork(b)), expertTurn(b))
    for (let turn = 0; turn < 12 && !b.over; turn++) {
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

// The turn's beam (redesign.md §2.21): its decisions, as the learner's hooks hear them. A board with a choice for each
// of three pieces, and a corpse to raise.
const beamBoard = () => {
  const b = field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 3 },
    { id: 'bone_chanter', uid: 2, side: 'party', x: 2, y: 2 },
    { id: 'frost_sprite', uid: 3, side: 'party', x: 4, y: 2 },
    { id: 'grave_ghoul', uid: 8, side: 'foe', x: 2, y: 4 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 6 },
    { id: 'will_o_wisp', uid: 10, side: 'foe', x: 2, y: 8 },
    { id: 'pyre_hound', uid: 11, side: 'foe', x: 4, y: 8 }
  ])
  b.byUid.get(9).hp = 6
  return b
}

test('the beam: record hears each decision of the turn given, in order, its options scored by their boards and the one taken', () => {
  const b = beamBoard()
  const recs = []
  const orders = expertTurn(fork(b), { record: (f, info) => recs.push({ f, ...info }) })
  // Hearing changes nothing.
  assert.deepEqual(orders, expertTurn(fork(b)))
  assert.ok(recs.length >= 1 && recs.length <= 3, `${recs.length} decisions`)
  assert.equal(new Set(recs.map((r) => r.uid)).size, recs.length)
  const f = fork(b)
  for (const r of recs) {
    assert.ok(r.options.length >= 1 && r.chosen >= 0 && r.chosen < r.options.length && r.explored === false)
    for (const o of r.options) {
      assert.ok(Number.isFinite(o.value) && Number.isFinite(o.prior) && o.board?.units, JSON.stringify({ ...o, board: !!o.board }))
      assert.ok(['tile', 'ability', 'target', 'fusion'].every((k) => k in o))
    }
    // Ranked by their boards' value, and each board the piece's option applied: the piece on its tile.
    assert.ok(r.options.every((o, i) => i === 0 || o.value <= r.options[i - 1].value))
    assert.ok(r.options.every((o) => o.board.byUid.get(r.uid).tile === o.tile || o.fusion))
    // The board each decision is heard on is the one the decisions before it left.
    assert.deepEqual(r.f.units.map((u) => [u.uid, u.tile, u.hp]), f.units.map((u) => [u.uid, u.tile, u.hp]))
    const c = r.options[r.chosen]
    for (const o of orders.filter((x) => x.uid === r.uid)) order(f, o)
    assert.equal(f.byUid.get(r.uid).tile, c.tile)
  }
})

test('the beam: explore takes, at each decision with chance epsilon, one of the best few at random; the same draws, the same turn', () => {
  const b = beamBoard()
  const turn = (seed) => {
    const recs = []
    const rng = createRng(seed).stream('explore')
    const orders = expertTurn(fork(b), { record: (f, info) => recs.push(info), explore: { rng, epsilon: 1, top: 3 } })
    return { orders, recs }
  }
  const one = turn('a')
  assert.deepEqual(turn('a').orders, one.orders)
  assert.ok(one.recs.length >= 1 && one.recs.every((r) => r.explored && r.chosen < 3), JSON.stringify(one.recs.map((r) => [r.chosen, r.explored])))
  const g = fork(b)
  for (const o of one.orders) {
    if (o.type !== 'end') assert.ok(legalOrders(g).some((l) => JSON.stringify(l) === JSON.stringify(o)), JSON.stringify(o))
    order(g, o)
  }
  // Epsilon 0: the beam's own turn.
  assert.deepEqual(expertTurn(fork(b), { explore: { rng: createRng('b').stream('x'), epsilon: 0, top: 3 } }), expertTurn(fork(b)))
})

test('evaluate: V where value.js holds trained weights, else the static board evaluation, the board tree\'s rules above its weights', () => {
  const b = beamBoard()
  assert.equal(evaluate(b, { learned: false }), judge(b).value)
  assert.ok(Number.isFinite(evaluate(b)))
  // A board where the foes could fell the Monarch next turn is worse than any where they could not, whatever else.
  const doomed = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0, hp: 5 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 0, y: 2 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 1 },
    { id: 'grave_ghoul', uid: 10, side: 'foe', x: 0, y: 9 }
  ])
  const safe = fork(doomed)
  slay(safe, safe.byUid.get(9))
  safe.byUid.get(1).hp = 1
  const d = judge(doomed)
  assert.deepEqual([d.v.doom, judge(safe).v.doom], [1, 0])
  doomed.byUid.get(10).hp = 1
  assert.ok(judge(safe).value > judge(doomed).value)
})

// With weights in value.js and the expert told to use them (TUNING.expert.beam.learned, or `learned`), the beam scores
// each option's board by V (`hybrid` 0), or by the static evaluation and V (`hybrid` above 0): a net of random weights
// here, for the plumbing.
test('the beam with V: each option\'s board scored by V, the turn legal and the same for the same board', () => {
  const b = beamBoard()
  const n = FEATURES.length
  const was = TUNING.expert.beam.hybrid
  const had = weights()
  load(toJSON(createNet({ inputs: n, hidden: [8], seed: 7 }), { mean: new Float64Array(n), sd: new Float64Array(n).fill(1) }))
  try {
    assert.equal(evaluate(b), V(b))
    assert.equal(evaluate(b, { learned: false }), judge(b).value)
    TUNING.expert.beam.hybrid = 0
    const recs = []
    const orders = expertTurn(fork(b), { record: (f, info) => recs.push(info), learned: true })
    assert.deepEqual(expertTurn(fork(b), { learned: true }), orders)
    assert.ok(recs.length && recs.every((r) => r.options.every((o) => o.value === V(o.board))))
    const g = fork(b)
    for (const o of orders) {
      if (o.type !== 'end') assert.ok(legalOrders(g).some((l) => JSON.stringify(l) === JSON.stringify(o)), JSON.stringify(o))
      order(g, o)
    }
    // Hybrid: each option's board by the static evaluation and `hybrid` × V; unlearned (the default), V read nowhere.
    TUNING.expert.beam.hybrid = 2
    const mixed = []
    expertTurn(fork(b), { record: (f, info) => mixed.push(info), learned: true })
    const plain = []
    expertTurn(fork(b), { record: (f, info) => plain.push(info), learned: false })
    // (The first decision is on the board as it stands, the same for both.)
    const same = (o, p) => p.tile === o.tile && p.ability === o.ability && p.target === o.target && p.fusion === o.fusion
    assert.ok(mixed[0].options.length > 1 && mixed[0].uid === plain[0].uid)
    for (const o of mixed[0].options) {
      const p = plain[0].options.find((x) => same(o, x))
      assert.ok(p && Math.abs(o.value - (p.value + 2 * V(o.board))) < 1e-6 * Math.max(1, Math.abs(o.value)))
    }
    if (!TUNING.expert.beam.learned) assert.deepEqual(expertTurn(fork(b)), expertTurn(fork(b), { learned: false }))
  } finally {
    TUNING.expert.beam.hybrid = was
    load(had)
  }
})

// The camp's pressure is read by its policy alone (press: TUNING.policy.press); the expert reads the board, never the
// camp's coming turn. Counted: every read of TUNING.policy.press (the camp's turn reads it, so does any turn of the
// foes played ahead) while the expert decides; and its orders, with the camp's patience changed.
test('the expert plays no turn of the foes and never reads the camp\'s pressure', () => {
  const b = field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 3 },
    { id: 'bone_chanter', uid: 2, side: 'party', x: 2, y: 2 },
    { id: 'frost_sprite', uid: 3, side: 'party', x: 4, y: 2 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 6 },
    { id: 'will_o_wisp', uid: 10, side: 'foe', x: 2, y: 8 },
    { id: 'pyre_hound', uid: 11, side: 'foe', x: 4, y: 8 }
  ])
  const real = TUNING.policy.press
  let reads = 0
  Object.defineProperty(TUNING.policy, 'press', { get () { reads++; return real }, configurable: true })
  try {
    for (let turn = 0; turn < 6 && !b.over; turn++) {
      const orders = expertTurn(b)
      assert.equal(reads, 0, `turn ${b.turn}: the expert read the camp's pressure`)
      for (const o of orders) if (!b.over) order(b, o)
      reads = 0
    }
  } finally {
    Object.defineProperty(TUNING.policy, 'press', { value: real, writable: true, configurable: true, enumerable: true })
  }
  const c = field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 3 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 6 }
  ])
  const orders = expertTurn(c)
  tuned({ policy: { press: { strength: 0.9, turns: 2 } } }, () => assert.deepEqual(expertTurn(c), orders))
})

// The situation is read from the board: its fields hold what the board, the counter and the bestiary show.
test('the situation: the roads into the Monarch, its danger and threats, the pieces\' danger, the killable, the waves to come', () => {
  const later = [{ ...makeUnit('grave_ghoul', { uid: 50, lvl: 1 }), side: 'foe', wave: 1, lane: 2, slot: -1 }]
  const b = field([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'frost_sprite', uid: 1, side: 'party', x: 3, y: 3 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 2, lvl: 1 },
    { id: 'tomb_knight', uid: 10, side: 'foe', x: 0, y: 9 }
  ], { reserve: later })
  b.byUid.get(9).hp = 5
  const sit = situation(b)
  assert.ok(sit.roads.length >= 1 && sit.roads.every((r) => r.foes.every((f) => f.turns >= 0 && f.reach >= 1)))
  assert.ok(sit.monarch.threats.some((x) => x.uid === 9) && sit.monarch.danger > 0)
  assert.equal(sit.monarch.lethal, sit.monarch.danger >= sit.monarch.hp)
  assert.deepEqual(sit.pieces.map((p) => p.uid), [1])
  assert.ok(sit.killable.some((k) => k.uid === 9 && k.by.includes(1)), JSON.stringify(sit.killable))
  assert.ok(sit.wave && sit.wave.lanes.includes(2) && sit.wave.turn === 1 + TUNING.spawn.waves.every)
  assert.equal(sit.patience, b.turn - b.foeIn)
  assert.deepEqual(sit.idle, [1])
})

// A turn on a full board, ten pieces and the Monarch against a dozen foes at the deep floors' levels, takes a few
// milliseconds (it plays nothing ahead); the bound is generous, for slow machines.
test('the expert\'s turn on a full board costs a few milliseconds', () => {
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
  assert.ok(ms < 250, `${ms.toFixed(1)} ms`)
})
