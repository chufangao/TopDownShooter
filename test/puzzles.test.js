// Tactical puzzles: hand-built boards with a known right answer. On each, the reads prep deploys by (read.js: the kill
// list, the forecast, the chokes, the plan and its target formation, the assignment), and the solver's line (solver.js):
// the kill, the block, the hold. Functional only: what is done on a board, never how often it wins. The boards are
// clear-cut (the right answer wins by far).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { order, fork, airOf, fieldOf, addStatus, roadAhead, lineStruck } from '../src/sim/turns.js'
import { options, danger } from '../src/sim/foe.js'
import { solve, solverTurn } from '../src/sim/solver.js'
import { decide, TREES, situation, blowOn, readPlan, killList, forecast, chokes, hungarian, formation } from '../src/sim/read.js'
import { createRun, availableNodes, monarchOf, START_PARTY } from '../src/sim/run.js'
import { survey, pickRoute, roomFeatures, AUDIT, resetAudit, withRoute } from '../src/sim/autoplay.js'
import { TUNING } from '../src/tuning.js'
import { on, scene } from './scene.js'
import { tileAt, tileX, tileY, distance, isBlow, blowReach } from '../src/sim/unit.js'

// A board of units on tiles (scene.js): [{ id, uid, side, x, y, lvl?, hp? }], `hp` the HP it stands at; `walls` as
// [x, y] pairs.
const board = (units, { walls = [], ...opts } = {}) => {
  const b = scene(units.map((u) => on(u.id, u.uid, u.side, u.x, u.y, u.lvl ?? 3)), { ...opts, walls: walls.map(([x, y]) => tileAt(x, y)) })
  for (const u of units) if (u.hp) b.byUid.get(u.uid).hp = u.hp
  return b
}
const M = (x, y) => ({ id: 'monarch', uid: 0, side: 'party', x, y })
const at = (x, y) => tileAt(x, y)
const where = (t) => `(${tileX(t)},${tileY(t)})`
const piece = (b, uid) => b.byUid.get(uid)
// HP at which neither of `uids` fells `target` alone with its best blow (read.js blowOn), and the two together do.
const twoBlows = (b, uids, target) => {
  const best = uids.map((uid) => Math.max(...piece(b, uid).kit.filter(isBlow).map((a) => blowOn(b, piece(b, uid), a, target))))
  return Math.max(...best) + Math.ceil(Math.min(...best) / 2)
}
// The solver's knobs on these boards: a budget, so that its line is a function of the board.
const SOLVE = Object.freeze({ budget: 5000, slack: false })
// The board solved (solve: `b` untouched). → { line, won, end, … }
const solved = (b) => solve(b, SOLVE)
// The solver's first turn on `b`, played on it: its orders, End Turn last. → the orders.
function play (b) {
  const orders = solved(b).line[0].orders
  for (const o of orders) if (!b.over) order(b, o)
  return orders
}
// The plan read on the board as prep reads it, and its target formation (Map piece uid → { role, tile, … }).
const planOf = (b) => readPlan(b, situation(b))
const goalsOf = (b) => formation(b, planOf(b))
// The road a foe walks from its tile to the Monarch (its arrows), its own tile first.
const roadFrom = (road, t) => {
  const out = []
  for (let k = 0; t >= 0 && k < 99; t = road.arrow[t], k++) out.push(t)
  return out
}

// ── the plan's parts ────────────────────────────────────────────────────────────────────────────

test('the Hungarian assignment: the least cost in all, each row its own column', () => {
  assert.deepEqual(hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]]), [1, 0, 2])
  assert.deepEqual(hungarian([[1, 9], [1, 2]]), [0, 1])
  // More columns than rows: the cheapest columns taken, none twice.
  const col = hungarian([[5, 1, 1], [5, 1, 9]])
  assert.equal(new Set(col).size, 2)
  assert.deepEqual(col, [2, 1])
})

test('the chokes: as far out as one piece holds every foe that comes that way, never past a foe, never past the cap', () => {
  // One foe down the middle lane, no walls: its road is the lane, held as far out as the cap allows.
  const b = board([M(3, 0), { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 9 }])
  const road = fieldOf(b)
  assert.deepEqual(chokes(road, [at(3, 9)], 3).map((c) => where(c.tile)), ['(3,3)'])
  assert.deepEqual(chokes(road, [at(3, 9)], 1).map((c) => where(c.tile)), ['(3,1)'])
  // Never past a foe: one standing nearer holds the line in front of it.
  assert.deepEqual(chokes(road, [at(3, 9), at(3, 3)], 3).map((c) => where(c.tile)), ['(3,2)'])
  // The front: the tiles where the foes it holds would wait.
  assert.deepEqual(chokes(road, [at(3, 9)], 3)[0].front.map(where), ['(3,4)'])
})

test('the forecast: the bold come as far as lets them strike, the wary stop outside your reach, a keeper behind them', () => {
  const b = board([
    M(3, 0),
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 3 },
    { id: 'pyre_hound', uid: 9, side: 'foe', x: 3, y: 6 },
    { id: 'frost_sprite', uid: 10, side: 'foe', x: 5, y: 9 },
    { id: 'hive_warden', uid: 11, side: 'foe', x: 1, y: 10 }
  ])
  const map = danger(b, 'foe')
  const fc = forecast(b, map)
  // The hound (bold) comes to strike the knight: beside it, on its road.
  assert.ok(fc.bold.has(9) && distance(fc.at.get(9), at(3, 3)) === 1, where(fc.at.get(9)))
  // The sprite (wary) comes as far as your side could not strike it, and no farther.
  const road = roadFrom(fieldOf(b), at(5, 9))
  const t = fc.at.get(10)
  assert.ok(!fc.bold.has(10) && map.ground[t] === 0, where(t))
  const next = road[road.indexOf(t) + 1]
  assert.ok(road.indexOf(t) === piece(b, 10).move || map.ground[next] > 0, `${where(t)} then ${where(next)}`)
  // The warden (a keeper) no nearer the Monarch than its comrades.
  const d = fieldOf(b).dist
  assert.ok(d[fc.at.get(11)] > Math.min(d[fc.at.get(9)], d[fc.at.get(10)]), where(fc.at.get(11)))
  // Once the camp's patience has run long, as the counts show it, every foe comes as far as its road lets it.
  b.turn = b.foeIn + TUNING.expert.plan.impatient
  const late = forecast(b)
  for (const uid of [9, 10, 11]) assert.equal(late.at.get(uid), roadAhead(b, piece(b, uid), piece(b, uid).move).at(-1).tile, `${uid}`)
})

test('every plan the reads choose among has its weights and its roles', () => {
  const W = TUNING.expert.plan
  assert.ok(['hold', 'focus', 'push', 'protect'].every((k) => k in W.choose && k in W.roles))
  assert.deepEqual(TREES.plan.map((n) => n.id), ['monarch-shooter', 'monarch-reach', 'fell-healer', 'go-to-them'])
  for (const roles of Object.values(W.roles)) assert.deepEqual(Object.keys(roles).sort(), ['air', 'block', 'heal', 'screen', 'shoot', 'strike'])
  const b = board([M(3, 0), { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 3 }, { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 6, hp: 5 }])
  assert.ok(['hold', 'focus', 'push', 'protect'].includes(planOf(b).kind))
})

// ── the puzzles ─────────────────────────────────────────────────────────────────────────────────

test('puzzle: hold the line rather than chase', () => {
  // A Tomb Knight on the road into the Monarch; two foes far up the board, out of anything it could strike this turn.
  // The Ghoul's arm reaches 2 and the Hound's 1: held at (3,2), they wait at (3,3), out of the Monarch's reach.
  const b = board([
    M(3, 0),
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 2 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 9 },
    { id: 'pyre_hound', uid: 10, side: 'foe', x: 5, y: 9 }
  ])
  assert.ok(!options(b, piece(b, 1)).some((o) => o.ability && isBlow(o.ability)), 'nothing in reach')
  assert.equal(planOf(b).kind, 'hold')
  assert.deepEqual([goalsOf(b).get(1).role, goalsOf(b).get(1).tile], ['block', at(3, 2)])
  const r = solved(b)
  assert.ok(r.won && r.end.byUid.get(0).hp === piece(b, 0).hp, 'won, the Monarch unhurt')
  const orders = play(b)
  assert.ok(!orders.some((o) => o.type === 'move' && o.uid === 1), JSON.stringify(orders))
  assert.equal(piece(b, 1).tile, at(3, 2))
})

test('puzzle: the shooter behind the blocker', () => {
  // A Frost Sprite and a Tomb Knight off the road to either side; two foes coming down the middle.
  const b = board([
    M(3, 0),
    { id: 'frost_sprite', uid: 1, side: 'party', x: 0, y: 1 },
    { id: 'tomb_knight', uid: 2, side: 'party', x: 6, y: 1 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 10 },
    { id: 'grave_ghoul', uid: 10, side: 'foe', x: 2, y: 10 }
  ])
  const goals = goalsOf(b)
  const block = goals.get(2)
  const shoot = goals.get(1)
  assert.deepEqual([block.role, shoot.role], ['block', 'shoot'])
  const road = fieldOf(b)
  // Behind the blocker by the road, and its lance (range 3) reaches where the held foes would wait.
  const front = roadFrom(road, at(3, 10)).find((t) => road.arrow[t] === block.tile)
  assert.ok(road.dist[shoot.tile] <= road.dist[block.tile] && distance(shoot.tile, front) <= 3, `${where(shoot.tile)} for ${where(block.tile)}`)
  const r = solved(b)
  assert.ok(r.won && r.end.byUid.get(0).hp === piece(b, 0).hp, 'won, the Monarch unhurt')
})

test('puzzle: the healer first', () => {
  // A wounded Hive Warden (it mends) and a wounded Pyre Hound (it hits harder for its HP), the Sprite able to fell one.
  const b = board([
    M(3, 0),
    { id: 'frost_sprite', uid: 1, side: 'party', x: 3, y: 3 },
    { id: 'pyre_hound', uid: 9, side: 'foe', x: 1, y: 6, hp: 10 },
    { id: 'hive_warden', uid: 10, side: 'foe', x: 5, y: 6, hp: 10 },
    { id: 'tomb_knight', uid: 11, side: 'foe', x: 3, y: 10 }
  ])
  // The Warden's lock open (a key on it): the puzzle is the healer, not the lock.
  addStatus(b, piece(b, 10), 'burning', 3)
  const sit = situation(b)
  assert.ok(!sit.monarch.threats.length, 'nothing threatens the Monarch')
  assert.deepEqual(killList(b, sit).list.map((k) => k.uid), [10])
  const plan = planOf(b)
  assert.deepEqual([plan.kind, plan.target, plan.by], ['focus', 10, 'fell-healer'])
  const orders = play(b)
  assert.ok(orders.some((o) => o.type === 'act' && o.uid === 1 && o.target === 10), JSON.stringify(orders))
  assert.ok(piece(b, 10).hp <= 0 && piece(b, 9).hp > 0)
})

test('puzzle: focus a key foe the kill list can fell with two blows together', () => {
  // A Hive Warden neither the Sprite nor the Chanter can fell alone, but both together can.
  const b = board([
    M(3, 0),
    { id: 'frost_sprite', uid: 1, side: 'party', x: 3, y: 3 },
    { id: 'bone_chanter', uid: 2, side: 'party', x: 2, y: 2 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 1, y: 8 },
    { id: 'hive_warden', uid: 10, side: 'foe', x: 4, y: 7 },
    { id: 'tomb_knight', uid: 11, side: 'foe', x: 3, y: 10 }
  ])
  const w = piece(b, 10)
  // Its lock open (a key on it): the puzzle is the kill list, not the lock.
  addStatus(b, w, 'burning', 3)
  w.hp = twoBlows(b, [1, 2], w)
  for (const uid of [1, 2]) assert.ok(piece(b, uid).kit.every((a) => !isBlow(a) || blowOn(b, piece(b, uid), a, w) < w.hp), `${uid} alone`)
  const list = killList(b, situation(b)).list
  assert.deepEqual(list.map((k) => [k.uid, k.strikes.map((s) => s.uid).sort()]), [[10, [1, 2]]])
  assert.deepEqual([planOf(b).kind, planOf(b).target], ['focus', 10])
  const orders = play(b)
  assert.deepEqual(orders.filter((o) => o.type === 'act' && o.target === 10).map((o) => o.uid).sort(), [1, 2])
  assert.ok(w.hp <= 0)
})

test('puzzle: the kill list strikes from range first, so the melee blow that fells it draws no counter; the solver fells it', () => {
  const b = board([
    M(3, 0),
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 3 },
    { id: 'frost_sprite', uid: 2, side: 'party', x: 5, y: 2 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 5 },
    { id: 'tomb_knight', uid: 10, side: 'foe', x: 0, y: 10 }
  ])
  // The Knight wounded so that it takes both blows.
  piece(b, 9).hp = twoBlows(b, [1, 2], piece(b, 9))
  const list = killList(b, situation(b)).list
  assert.deepEqual(list.map((k) => [k.uid, k.strikes.map((s) => s.uid)]), [[9, [2, 1]]])
  const orders = play(b).filter((o) => o.type === 'act')
  assert.deepEqual(orders.map((o) => o.uid).sort(), [1, 2])
  assert.ok(piece(b, 9).hp <= 0)
})

test('puzzle: never into the danger map for nothing', () => {
  // A lone Frost Sprite, nothing it could strike this turn, two strong shooters up the board whose reach covers the
  // camp's middle rows.
  const b = board([
    M(3, 0),
    { id: 'frost_sprite', uid: 1, side: 'party', x: 3, y: 1 },
    { id: 'frost_sprite', uid: 9, side: 'foe', x: 2, y: 9, lvl: 6 },
    { id: 'frost_sprite', uid: 10, side: 'foe', x: 4, y: 9, lvl: 6 }
  ])
  const sit = situation(b)
  const sprite = piece(b, 1)
  assert.ok(!options(b, sprite).some((o) => o.ability && isBlow(o.ability)), 'nothing in reach')
  assert.ok(options(b, sprite).some((o) => sit.map.ground[o.tile] > 0), 'tiles in the danger map within its Move')
  play(b)
  assert.equal(sit.map.ground[sprite.tile], 0, where(sprite.tile))
})

test('puzzle: a road walled by two, each road into the Monarch held by its own piece', () => {
  // Two gaps in a wall before the Monarch, a Ghoul at each: two roads, two blockers.
  const b = board([
    M(3, 1),
    { id: 'tomb_knight', uid: 1, side: 'party', x: 2, y: 0 },
    { id: 'tomb_knight', uid: 2, side: 'party', x: 4, y: 0 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 0, y: 6 },
    { id: 'grave_ghoul', uid: 10, side: 'foe', x: 6, y: 6 }
  ], { walls: [[0, 3], [2, 3], [3, 3], [4, 3], [6, 3]] })
  const goals = [1, 2].map((uid) => goalsOf(b).get(uid))
  assert.deepEqual(goals.map((g) => g.role), ['block', 'block'])
  assert.deepEqual(goals.map((g) => where(g.tile)).sort(), ['(1,3)', '(5,3)'])
  const roads = [9, 10].map((uid) => roadFrom(fieldOf(b), at(uid === 9 ? 0 : 6, 6)))
  assert.ok(goals.every((g) => roads.filter((r) => r.includes(g.tile)).length === 1))
  const r = solved(b)
  assert.ok(r.won && r.end.byUid.get(0).hp === piece(b, 0).hp, 'won, the Monarch unhurt')
})

// A strong Tomb Knight of theirs two tiles from the Monarch, too strong to fell this turn.
const threatened = () => board([
  M(3, 0),
  { id: 'tomb_knight', uid: 1, side: 'party', x: 1, y: 1 },
  { id: 'frost_sprite', uid: 2, side: 'party', x: 5, y: 1 },
  { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 2, lvl: 9 }
])

test('puzzle: protect when the Monarch is within the foes\' reach: the plan closes about it, the solver\'s turn keeps it unhurt', () => {
  const b = threatened()
  const sit = situation(b)
  assert.ok(sit.monarch.danger > 0 && !killList(b, sit).list.length)
  // The plan closes about the Monarch, your Knight's tile the one the threat's road comes in by.
  assert.deepEqual([planOf(b).kind, planOf(b).by], ['protect', 'monarch-reach'])
  assert.deepEqual([goalsOf(b).get(1).role, where(goalsOf(b).get(1).tile)], ['block', '(3,1)'])
  const hp = piece(b, 0).hp
  play(b)
  assert.equal(piece(b, 0).hp, hp, 'the Monarch unhurt through the foes\' turn')
})

// ── the line out of range, the Monarch's shooters ─────────────────────────────────────────────

// The tile a foe walking the road from tile `from` waits on, held by a piece on road tile `t`: the one before t.
const before = (b, t, from) => roadFrom(fieldOf(b), from).find((x) => fieldOf(b).arrow[x] === t)

test('puzzle: the line out of range, where a shooter held cannot reach the Monarch, a screen on its line counted', () => {
  // An Ember Drake (a blast of reach 4: no line stops it) and a Pyre Hound down the middle: the road is held where the
  // Drake, waiting before the piece, is out of the Monarch's reach, not at the old cap of three steps.
  const blast = board([
    M(3, 0),
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 1 },
    { id: 'ember_drake', uid: 9, side: 'foe', x: 3, y: 10 },
    { id: 'pyre_hound', uid: 10, side: 'foe', x: 4, y: 9 }
  ])
  const g = goalsOf(blast).get(1)
  const drake = piece(blast, 9)
  const reach = Math.max(...drake.kit.filter(isBlow).map((a) => blowReach(drake, a)))
  assert.deepEqual([planOf(blast).kind, g.role, where(g.tile)], ['hold', 'block', '(3,4)'])
  assert.ok(distance(before(blast, g.tile, at(3, 10)), at(3, 0)) > reach, 'held out of its reach')
  assert.ok(distance(before(blast, fieldOf(blast).arrow[g.tile], at(3, 10)), at(3, 0)) <= reach, 'and no farther out than that')
  // A Bone Chanter (its bolt keeps to a line, reach 4) and a Pyre Hound: held beside the seat, the Chanter's every line to
  // the Monarch runs through the piece that holds it, so the line is the first tile out.
  const lined = board([
    M(3, 0),
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 1 },
    { id: 'bone_chanter', uid: 9, side: 'foe', x: 3, y: 10 },
    { id: 'pyre_hound', uid: 10, side: 'foe', x: 3, y: 9 }
  ])
  assert.deepEqual([planOf(lined).kind, goalsOf(lined).get(1).role, where(goalsOf(lined).get(1).tile)], ['hold', 'block', '(3,1)'])
})

test('puzzle: the Monarch\'s shooter felled first, before the healer the weights would take', () => {
  // A Will-o'-Wisp whose witchfire reaches the Monarch now, the Sprite and the Knight able to fell it together; a
  // wounded Hive Warden the Sprite could fell alone (fell-healer's, and the weights': its mending is dear).
  const b = board([
    M(3, 0),
    { id: 'frost_sprite', uid: 1, side: 'party', x: 2, y: 2 },
    { id: 'tomb_knight', uid: 2, side: 'party', x: 4, y: 1 },
    { id: 'will_o_wisp', uid: 9, side: 'foe', x: 5, y: 4, hp: 25 },
    { id: 'hive_warden', uid: 10, side: 'foe', x: 1, y: 5, hp: 10 },
    { id: 'tomb_knight', uid: 11, side: 'foe', x: 3, y: 10 }
  ])
  const plan = planOf(b)
  assert.deepEqual([plan.kind, plan.target, plan.by], ['focus', 9, 'monarch-shooter'])
  assert.equal(plan.kills[0].uid, 9)
  const hp = piece(b, 0).hp
  play(b)
  assert.ok(piece(b, 9).hp <= 0, 'the shooter felled')
  assert.equal(piece(b, 0).hp, hp, 'the Monarch unhurt through the foes\' turn')
})

test('puzzle: a shooter none of yours can fell is screened', () => {
  // A strong Bone Chanter four tiles off, its bolt on a clear line to the Monarch; nothing of yours could fell it in
  // the turns ahead: the plan closes about the Monarch, and a piece stands on the Chanter's line.
  const b = board([
    M(3, 0),
    { id: 'tomb_knight', uid: 1, side: 'party', x: 1, y: 1 },
    { id: 'frost_sprite', uid: 2, side: 'party', x: 5, y: 1 },
    { id: 'bone_chanter', uid: 9, side: 'foe', x: 5, y: 4, lvl: 9 }
  ])
  const chanter = piece(b, 9)
  const bolt = chanter.kit.find((a) => a.id === 'marrow_bolt')
  assert.equal(lineStruck(b, chanter, bolt, piece(b, 0)), piece(b, 0), 'a clear line at first')
  assert.deepEqual([planOf(b).kind, planOf(b).by], ['protect', 'monarch-shooter'])
  const hp = piece(b, 0).hp
  const orders = solved(b).line[0].orders
  for (const o of orders) if (o.type !== 'end') order(b, o)
  assert.notEqual(lineStruck(b, chanter, bolt, piece(b, 0)), piece(b, 0), 'screened before the foes\' turn')
  order(b, { type: 'end' })
  assert.equal(piece(b, 0).hp, hp, 'the Monarch unhurt through it')
})

// A run on the map with its next rooms made `types` (the first ones; a battle room keeps the floor's foes).
function crossroads (types) {
  const seed = [...Array(40).keys()].map((k) => `route-${k}`).find((x) => availableNodes(createRun({ start: START_PARTY, seed: x })).length >= types.length)
  const run = createRun({ start: START_PARTY, seed })
  const nodes = availableNodes(run)
  const foes = run.state.map.nodes.find((n) => n.foes).foes
  types.forEach((type, i) => {
    nodes[i].type = type
    if (['fight', 'elite'].includes(type)) nodes[i].foes ??= foes
  })
  return { run, nodes }
}

test('puzzle: a wounded Monarch takes the altar, and walks into no elite', () => {
  // The souls whole, the Monarch's wounds carried from the last battle: an altar between two fights.
  const T = TUNING.expert.tree
  const { run, nodes } = crossroads(['fight', 'altar', 'fight'])
  const m = monarchOf(run.state)
  m.hp = Math.floor(m.maxHp * T.altar * 0.6)
  assert.ok(survey(run).health === 1 && survey(run).monarch < T.altar)
  resetAudit(true, run)
  try {
    assert.equal(withRoute('hand', () => pickRoute(run)), nodes[1].id)
    assert.equal(AUDIT.rules['route: monarch-altar'], 1)
  } finally {
    resetAudit(false)
  }
  // Less wounded, but below the elite's threshold: an elite beside a fight is refused, the elite weighed far above.
  const elite = crossroads(['elite', 'fight'])
  // The same foes in both, so the odds choose neither.
  elite.nodes[1].foes = elite.nodes[0].foes
  const e = monarchOf(elite.run.state)
  e.hp = Math.floor(e.maxHp * (T.altar + T.elite) / 2)
  const sit = survey(elite.run)
  assert.ok(sit.monarch >= T.altar && sit.monarch < T.elite && sit.health === 1)
  const rooms = sit.rooms.map((room) => ({ node: elite.nodes.find((n) => n.id === room.id), v: { ...roomFeatures(sit, room), elite: room.type === 'elite' ? 1e3 : 0 } }))
  const pick = decide(TREES.route, sit, rooms, TUNING.expert.route)
  assert.deepEqual([pick.option.node.type, pick.by], ['fight', 'monarch-no-elite'])
  // Whole, the elite is a room like another.
  e.hp = e.maxHp
  assert.equal(decide(TREES.route, survey(elite.run), rooms, TUNING.expert.route).option.node.type, 'elite')
})

test('puzzle: push against wary shooters that will not come', () => {
  // Two Frost Sprites of theirs (wary: they keep out of your reach), no wave to come, your stronger pieces back by the
  // Monarch: holding would wait on foes that never walk in.
  const b = board([
    M(3, 0),
    { id: 'tomb_knight', uid: 1, side: 'party', x: 2, y: 1, lvl: 6 },
    { id: 'frost_sprite', uid: 2, side: 'party', x: 4, y: 1, lvl: 6 },
    { id: 'frost_sprite', uid: 9, side: 'foe', x: 2, y: 9, lvl: 1 },
    { id: 'frost_sprite', uid: 10, side: 'foe', x: 4, y: 9, lvl: 1 }
  ])
  assert.deepEqual([planOf(b).kind, planOf(b).by], ['push', 'go-to-them'])
  assert.ok(solved(b).won)
  const near = () => [1, 2].reduce((n, uid) => n + Math.min(...[9, 10].map((f) => distance(piece(b, uid).tile, piece(b, f).tile))), 0)
  const was = near()
  play(b)
  assert.ok(near() < was, `${near()} vs ${was}`)
})

test('puzzle: a flyer met where the air road comes in, by a piece that can strike it', () => {
  // Open ground: a Hive Drone down the middle; your Knight (melee, it cannot strike a flyer) and your Sprite.
  const open = board([
    M(3, 0),
    { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 1 },
    { id: 'frost_sprite', uid: 2, side: 'party', x: 5, y: 1 },
    { id: 'hive_drone', uid: 9, side: 'foe', x: 3, y: 9 }
  ])
  const goals = goalsOf(open)
  const air = roadFrom(airOf(open), at(3, 9))
  // Its sting reaches 1: held beside the seat, it waits two tiles off (the line out of range).
  assert.deepEqual([goals.get(2).role, where(goals.get(2).tile)], ['air', '(3,1)'])
  assert.ok(air.includes(goals.get(2).tile))
  assert.notEqual(goals.get(1).role, 'air')
  // Walled: the ground road goes round the wall's end, the air road over it; the Sprite meets the Drone inside the
  // wall on the air road, the Knight holds the ground road.
  const walled = board([
    M(3, 0),
    { id: 'tomb_knight', uid: 1, side: 'party', x: 1, y: 1 },
    { id: 'frost_sprite', uid: 2, side: 'party', x: 5, y: 1 },
    { id: 'hive_drone', uid: 9, side: 'foe', x: 3, y: 9 },
    { id: 'grave_ghoul', uid: 10, side: 'foe', x: 0, y: 9 }
  ], { walls: [[1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2]] })
  const sprite = goalsOf(walled).get(2)
  const knight = goalsOf(walled).get(1)
  assert.deepEqual([sprite.role, where(sprite.tile), knight.role], ['air', '(3,1)', 'block'])
  assert.ok(roadFrom(airOf(walled), at(3, 9)).includes(sprite.tile) && roadFrom(fieldOf(walled), at(0, 9)).includes(knight.tile))
  for (const b of [open, walled]) assert.ok(solved(b).won)
})

test('puzzle: the moves ablation acts from where each stands', () => {
  const b = board([
    M(3, 0),
    { id: 'frost_sprite', uid: 1, side: 'party', x: 0, y: 1 },
    { id: 'tomb_knight', uid: 2, side: 'party', x: 6, y: 1 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 4 }
  ])
  addStatus(b, piece(b, 9), 'hexed', 1)
  const orders = solverTurn(b, { ...SOLVE, moving: false })
  assert.ok(!orders.some((o) => o.type === 'move'), JSON.stringify(orders))
  assert.ok(orders.some((o) => o.type === 'act'), 'it acts from where it stands')
  assert.ok(solverTurn(fork(b), SOLVE).some((o) => o.type === 'move'), 'the full solver moves')
})
