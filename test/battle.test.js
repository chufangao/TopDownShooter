import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createBattle, stepBattle, runBattle, timelineHash, stats, enterBattle, nextCost, foesNextTo, auraGivers, field, fieldOf, arrowOf, ringTarget, timingMarks
} from '../src/sim/battle.js'
import { TUNING } from '../src/tuning.js'
import { tuned, FIRST_ARISE } from './tuned.js'
import {
  makeUnit, autoPlace, distance, slotAt, campGrid, wallTiles, steps, costliestOf, abilitiesOf, deployTile, tileAt, tileX, tileY, baseStats, DEPTH,
  foesNextTo as listFoesNextTo, auraGivers as listAuraGivers, seatNear, TILES, livingBodies
} from '../src/sim/unit.js'
import { createRng } from '../src/sim/rng.js'
import { UNIT_LIST, unitDef, abilityDef, CAMP_LIST } from '../src/content.js'
import { foeLevel, START_PARTY } from '../src/sim/run.js'

function team (ids, { side = 'party', lvl = 2, uid = side === 'party' ? 1 : 100, camp = null } = {}) {
  return autoPlace(ids.map((id, i) => makeUnit(id, { uid: uid + i, lvl })), camp ? { grid: campGrid(camp) } : {})
}

const START = START_PARTY

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

// The signals a drawn line may wait for.
const WHENS = [{ at: 'once' }, { at: 'time', t: 60 }, { at: 'blow' }, { at: 'wave', wave: 1 }, { at: 'struck' }, { at: 'falls' }]

// A line of up to `n` legal steps from `tile` past `walls` (a Set), each drawn on `rng`, on a signal drawn on it.
function drawLine (rng, tile, walls, n = 6) {
  const tiles = []
  for (let k = 1 + rng.int(n), t = tile; k > 0; k--) tiles.push((t = rng.pick(steps(t, walls))))
  return { tiles, when: rng.pick(WHENS) }
}

// In one of the floor's camps, picked by seed, walls and all, against that encounter. `tune` may edit
// the party before it fights; with `monarch`, the Monarch stands among them (on the rear row's seat) with
// `will` Will; with `army`, the first soul is a stack of that many bodies more, and its second foe one too. With
// `lines`, every soul walks a line drawn on the seed, on a signal drawn on it.
const fresh = (seed, floor = 1, { ids = START, tune = () => {}, monarch = false, will = 0, army = 0, lines = false } = {}) => {
  const { foes, boss } = encounter(seed, floor)
  const camp = createRng(seed).stream('camp').pick(CAMP_LIST.filter((c) => c.floor === floor)).id
  const party = team(ids, { lvl: 1 + floor, camp })
  if (monarch) party.push(makeUnit('monarch', { uid: 0, lvl: 0, slot: seatNear(camp) }))
  const walls = wallTiles(camp)
  const stacked = (u) => Object.assign(u, makeUnit(u.id, { uid: u.uid, lvl: u.lvl, slot: u.slot, count: 1 + army }))
  if (army) {
    stacked(party[0])
    if (foes[1]) stacked(foes[1])
  }
  autoPlace(party, { grid: campGrid(camp) })
  tune(party)
  const rng = createRng(seed).stream('lines')
  if (lines) for (const u of party) if (u.id !== 'monarch') u.line = drawLine(rng, deployTile('party', u.slot), new Set(walls))
  return createBattle({ party, foes, seed, floor, boss, walls, will })
}

// With the board holding only `n` bodies.
function boardOf (n, fn) {
  const was = TUNING.army.board
  TUNING.army.board = n
  try {
    return fn()
  } finally {
    TUNING.army.board = was
  }
}

// Lays a unit dead where it stands, as a blow would (the index, the roster; one of yours, the Flank field's too).
function slay (b, u) {
  u.hp = 0
  u.statuses = []
  b.at[u.tile] = null
  b.roster++
  if (u.side === 'party') b.ours++
}

// A unit placed on a board tile directly, for battles built tile by tile.
const on = (id, uid, side, x, y, lvl = 3) => ({ ...makeUnit(id, { uid, lvl }), side, tile: tileAt(x, y) })

// A battle of units placed on tiles: party and foes are made with `on`, the party in its camp (y 0–6).
// A foe may stand anywhere: it deploys in a spare slot of its formation and is moved there. The ones not
// named in `moving` never step (so a scene stays put); summons stand where they appear.
function scene (units, { moving = [], ...opts } = {}) {
  const foeRow0 = DEPTH - 3
  const spare = [...Array(21).keys()].filter((slot) => !units.some((u) => u.side === 'foe' && tileY(u.tile) >= foeRow0 && slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) === slot))
  const slot = (u) => u.side === 'party' ? slotAt(6 - tileY(u.tile), tileX(u.tile))
    : tileY(u.tile) >= foeRow0 ? slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) : spare.shift()
  const placed = units.map((u) => ({ ...u, slot: slot(u) }))
  const b = createBattle({ party: placed.filter((u) => u.side === 'party'), foes: placed.filter((u) => u.side === 'foe'), seed: 'scene', ...opts })
  for (const u of b.units) {
    const want = units.find((x) => x.uid === u.uid)?.tile
    if (want === undefined) continue
    if (u.tile !== want) {
      b.at[u.tile] = null
      u.tile = want
      b.at[want] = u
    }
    if (!moving.includes(u.uid)) u.nextStep = Infinity
  }
  return b
}

// A line straight up (dy 1) or down (dy −1) the lane from (x, y), `n` tiles.
const lane = (x, y, n, dy = 1) => Array.from({ length: n }, (_, k) => tileAt(x, y + dy * (k + 1)))
const lined = (u, tiles, when = { at: 'once' }) => ({ ...u, line: { tiles, when } })
const moves = (events, uid) => events.filter((e) => e.type === 'move' && e.actor === uid)

// Plain, and with lines: a Monarch, a stack on each side, and every soul on a line.
const LINED = { lines: true, army: 3, monarch: true }

test('the same seed gives the same timeline; a different seed does not', () => {
  for (const opts of [{}, LINED]) {
    const a = runBattle(fresh('det', 1, opts))
    const b = runBattle(fresh('det', 1, opts))
    assert.equal(a.hash, b.hash)
    assert.equal(a.hash, timelineHash(b.events))
    assert.notEqual(a.hash, runBattle(fresh('det2', 1, opts)).hash)
  }
})

test('stepping tick by tick equals runBattle', () => {
  for (const opts of [{}, LINED]) {
    const live = fresh('step', 1, opts)
    const seen = [...live.events]
    while (!live.over) seen.push(...stepBattle(live))
    const run = runBattle(fresh('step', 1, opts))
    assert.deepEqual(seen, run.events)
    assert.equal(timelineHash(seen), run.hash)
    assert.deepEqual(stepBattle(live), [])
  }
})

test('battles start with an event, stamp every event with t, and only bring the living', () => {
  const party = team(START)
  party[1].hp = 0
  const b = createBattle({ party, foes: team(['clockwork_page'], { side: 'foe' }), seed: 1 })
  assert.equal(b.units.length, 3)
  assert.equal(b.events[0].type, 'battle:start')
  assert.notEqual(b.units[0], party[0])
  const { events } = runBattle(b)
  assert.ok(events.every((e) => Number.isInteger(e.t)))
  assert.equal(events.at(-1).type, 'battle:end')
  assert.equal(party[0].gauge, undefined, 'the run unit is untouched')
})

test('300 seeded battles across floors end by the ceiling with sane HP', () => {
  for (let i = 0; i < 300; i++) {
    const floor = 1 + (i % 4)
    const b = fresh('fuzz' + i, floor, i % 3 ? {} : LINED)
    const r = runBattle(b)
    assert.ok(r.ticks <= TUNING.tick.ceiling, `seed ${i} passed the ceiling`)
    assert.ok([null, 'party', 'foe'].includes(r.winner))
    for (const u of b.units) {
      assert.ok(Number.isInteger(u.hp) && u.hp >= 0 && u.hp <= u.maxHp, `seed ${i}: ${u.id} hp ${u.hp}`)
      assert.equal(u.maxHp, u.count * u.body, `seed ${i}: ${u.id} a pool of count × body`)
    }
    for (const e of r.events) if (e.type === 'damage') assert.ok(Number.isInteger(e.damage) && e.damage >= 0)
  }
})

test('boss phases fire once each, in order', () => {
  const boss = team(['hollow_sovereign'], { side: 'foe', lvl: 1 })
  boss[0].slot = 1
  const party = team(['tomb_knight', 'tomb_knight', 'ember_drake', 'ember_drake', 'bone_chanter', 'hive_warden'], { lvl: 9 })
  const r = runBattle(createBattle({ party, foes: boss, seed: 'boss', boss: true }))
  const phases = r.events.filter((e) => e.type === 'phase')
  assert.deepEqual(phases.map((e) => e.status), ['enraged', 'desperate'].slice(0, phases.length))
  assert.ok(phases.length >= 1)
})

test('bosses ignore gauge drain', () => {
  const boss = team(['hollow_sovereign'], { side: 'foe', lvl: 1 })
  boss[0].slot = 1
  const r = runBattle(createBattle({ party: team(['frost_sprite', 'frost_sprite'], { lvl: 5 }), foes: boss, seed: 'drain', boss: true }))
  assert.ok(r.events.some((e) => e.type === 'action' && e.ability === 'frost_lance'))
  assert.ok(!r.events.some((e) => e.type === 'gauge' && e.target === boss[0].uid))
})

test('only fielded souls with HP fight', () => {
  const party = team(START)
  party[2].slot = -1
  party.push(makeUnit('tomb_knight', { uid: 9, lvl: 3, slot: 10 }))
  party[3].hp = 0
  const b = createBattle({ party, foes: team(['clockwork_page'], { side: 'foe' }), seed: 'bench' })
  assert.deepEqual(b.units.filter((u) => u.side === 'party').map((u) => u.uid).sort(), [1, 2])
})

test('every step is a legal step onto a free tile, one a step clock: a foe on its road, one of yours on its line; the Monarch and shadows hold', () => boardOf(5, () => {
  let roads = 0
  let marches = 0
  for (let i = 0; i < 60; i++) {
    const b = fresh('walk' + i, 1 + (i % 4), { monarch: i % 3 === 0, will: i % 2, army: i % 4 === 1 ? 3 : 0, lines: i % 2 === 0 })
    const walk = fieldOf(b)
    const tile = new Map(b.units.map((u) => [u.uid, u.tile]))
    const leg = new Map()
    const last = new Map()
    const dead = new Set()
    const holder = (t) => b.units.find((x) => !dead.has(x.uid) && tile.get(x.uid) === t)
    while (!b.over) {
      for (const e of stepBattle(b)) {
        if (e.type === 'death') dead.add(e.target)
        if (e.type === 'rise') dead.delete(e.target)
        if (e.type === 'arise' || e.type === 'enter') {
          assert.ok(!holder(e.unit.tile) && !b.walls.has(e.unit.tile), `seed ${i} t ${e.t}: ${e.type} on a body or a wall`)
          tile.set(e.unit.uid, e.unit.tile)
        }
        if (e.type !== 'move') continue
        const u = b.byUid.get(e.actor)
        const where = `seed ${i} t ${e.t}: ${u.id} ${e.from}→${e.to}`
        assert.equal(tile.get(u.uid), e.from)
        assert.ok(steps(e.from, b.walls).includes(e.to), `${where}: into or past a wall`)
        assert.ok(!holder(e.to), `${where}: onto a body`)
        assert.ok(!last.has(u.uid) || e.t - last.get(u.uid) >= TUNING.board.stepTicks, `${where}: stepped again too soon`)
        last.set(u.uid, e.t)
        if (u.side === 'foe') {
          if (u.behaviour === 'walk') assert.equal(e.to, walk.arrow[e.from], `${where}: off its road`)
          roads++
        } else {
          assert.ok(u !== b.monarch && !(u.shadow && u.ring === 1), `${where}: one with no line stepped`)
          const k = leg.get(u.uid) ?? 0
          assert.equal(e.to, u.line.tiles[k], `${where}: off its line`)
          leg.set(u.uid, k + 1)
          marches++
        }
        tile.set(u.uid, e.to)
        const held = b.units.filter((x) => !dead.has(x.uid)).map((x) => tile.get(x.uid))
        assert.equal(new Set(held).size, held.length, `${where}: two units on one tile`)
      }
    }
  }
  assert.ok(roads > 0 && marches > 0, `${roads} steps on roads, ${marches} on lines`)
}))

test('a step costs no gauge: a marcher steps every stepTicks while its gauge keeps filling', () => {
  // A knight on a long line up its lane; a golem frozen at the far edge, out of its ring until it arrives.
  const b = scene([lined(on('tomb_knight', 1, 'party', 3, 0), lane(3, 0, 9)), on('iron_golem', 10, 'foe', 3, 10)], { moving: [1] })
  const knight = b.byUid.get(1)
  const foe = b.byUid.get(10)
  // What its gauge bar saves toward: with no foe in reach, its cheapest ability (a step is no cost).
  const cheapest = Math.min(...abilitiesOf(knight).map((a) => abilityDef(a).castCost))
  const steps = []
  let gauge = 0
  while (!b.over) {
    const saving = nextCost(b, knight)
    if (distance(knight.tile, foe.tile) > 1) assert.equal(saving, cheapest, `t ${b.t}: saving for ${saving} with nothing in reach`)
    const events = stepBattle(b)
    const action = events.find((e) => e.type === 'action' && e.actor === 1)
    if (action) {
      assert.equal(abilityDef(action.ability).castCost, saving, 'it saved for the ability it used')
      break
    }
    steps.push(...moves(events, 1).map((e) => e.t))
    assert.ok(knight.gauge >= gauge, `t ${b.t}: the gauge fell from ${gauge} to ${knight.gauge}`)
    gauge = knight.gauge
  }
  assert.ok(steps.length >= 4, `${steps}`)
  assert.deepEqual(steps, steps.map((_, k) => k * TUNING.board.stepTicks), 'one step per clock, from the first tick')
  // A kind's stride scales its clock.
  const def = unitDef('tomb_knight')
  def.stride = 2
  try {
    const fast = scene([lined(on('tomb_knight', 1, 'party', 3, 0), lane(3, 0, 4)), on('iron_golem', 10, 'foe', 3, 10)], { moving: [1] })
    while (fast.t < 40) stepBattle(fast)
    assert.deepEqual(moves(fast.events, 1).map((e) => e.t), [0, 8, 16, 24])
  } finally {
    delete def.stride
  }
})

// ── roads ────────────────────────────────────────────────────────────────────────────────────────

test('roads: a flood from the root through every tile but walls; every arrow points strictly closer, by a legal step', () => {
  for (const c of CAMP_LIST) {
    const walls = wallTiles(c.id)
    const root = deployTile('party', seatNear(c.id))
    const f = field({ root, walls })
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
  assert.deepEqual(field({ root: tileAt(3, 0), walls }), field({ root: tileAt(3, 0), walls: [...walls] }))
})

test('a tie between arrows goes to the tile nearest the root\'s lane, then nearest its row, then the centre lane', () => {
  // The root at (3, 0) on open ground. From (3, 3) three tiles are a step nearer: (2, 2), (3, 2), (4, 2); the
  // root's lane wins.
  const open = field({ root: tileAt(3, 0) })
  assert.equal(open.arrow[tileAt(3, 3)], tileAt(3, 2))
  // From (1, 1), (2, 0) and (2, 1) are both a lane off the root's: the one in its row wins (straight ahead).
  assert.equal(open.arrow[tileAt(1, 1)], tileAt(2, 0))
  // The root at (2, 0), a wall on (2, 2): no step from (2, 3) squeezes past its corners, so (1, 3) and (3, 3) are the
  // ways on, a lane off either side and level: the lane nearer the centre, 3, wins.
  const side = field({ root: tileAt(2, 0), walls: [tileAt(2, 2)] })
  assert.deepEqual([side.dist[tileAt(2, 3)], side.dist[tileAt(1, 3)], side.dist[tileAt(3, 3)]], [4, 3, 3])
  assert.equal(side.arrow[tileAt(2, 3)], tileAt(3, 3))
  // The root on the centre lane (3, 0), a wall on (3, 2): from (3, 3), (2, 3) and (4, 3) tie on every count but
  // CENTRE_OUT's order, which takes lane 2 before lane 4.
  assert.equal(field({ root: tileAt(3, 0), walls: [tileAt(3, 2)] }).arrow[tileAt(3, 3)], tileAt(2, 3))
})

test('a foe on tile T steps to the arrow of T; two foes on the road walk the same way', () => {
  // A lone Ghoul at the far edge walks the Spiral's road to the Monarch, every step to its tile's arrow.
  const walls = wallTiles('spiral')
  const b = scene([on('monarch', 0, 'party', 3, 0), on('grave_ghoul', 10, 'foe', 0, 10, 1)], { moving: [10], walls })
  const ghoul = b.byUid.get(10)
  const road = field({ root: tileAt(3, 0), walls })
  const path = []
  while (!b.over && b.t < 2000 && distance(ghoul.tile, b.monarch.tile) > 1) {
    const from = ghoul.tile
    const to = arrowOf(b, ghoul)
    assert.equal(to, road.arrow[from])
    for (const e of moves(stepBattle(b), 10)) {
      assert.deepEqual([e.from, e.to], [from, to])
      path.push(e.to)
    }
  }
  assert.equal(path.length, road.dist[tileAt(0, 10)] - 1, 'the shortest road, a step at a time, to beside the Monarch')
  while (!b.over && b.t < 2500 && !b.events.some((e) => e.type === 'action' && e.actor === 10)) stepBattle(b)
  assert.ok(b.events.some((e) => e.type === 'action' && e.actor === 10 && e.targets.includes(0)), 'and it strikes the Monarch')
})

test('a foe queues behind a foe: it waits while its next tile is held, and steps the tick it is free', () => {
  // The Monarch at (3, 0); a frozen Ghoul at (3, 5) and a walking one behind it at (3, 6), whose arrow is (3, 5).
  const b = scene([on('monarch', 0, 'party', 3, 0), on('grave_ghoul', 10, 'foe', 3, 5, 1), on('grave_ghoul', 11, 'foe', 3, 6, 1)], { moving: [11] })
  const [front, back] = [10, 11].map((uid) => b.byUid.get(uid))
  assert.equal(arrowOf(b, back), front.tile)
  for (let k = 0; k < 50; k++) assert.deepEqual(moves(stepBattle(b), 11), [], 'it queues')
  front.nextStep = b.t
  let first = null
  while (!first && b.t < 200) {
    const events = stepBattle(b)
    first = moves(events, 11)[0] ?? null
    if (first) assert.equal(moves(events, 10)[0]?.to, tileAt(3, 4), 'the front one stepped first, the same tick')
  }
  assert.deepEqual([first.from, first.to], [tileAt(3, 6), tileAt(3, 5)])
  // A foe whose next tile holds a piece of yours fights it: it never walks round it.
  const blocked = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4, 9), on('grave_ghoul', 10, 'foe', 3, 5, 1)], { moving: [10] })
  while (!blocked.over && blocked.t < 300) assert.deepEqual(moves(stepBattle(blocked), 10), [], 'it fights what stands on its road')
  assert.ok(blocked.events.some((e) => e.type === 'action' && e.actor === 10 && e.targets.includes(1)))
})

test('a Flank field routes round your pieces, is made again only when one rises or falls, and falls back on the Walk field with none', () => {
  // A line of knights across y 3, every lane but the last; the Monarch behind it at (3, 0).
  const line = (lanes) => lanes.map((x) => on('tomb_knight', 1 + x, 'party', x, 3, 9))
  const b = scene([on('monarch', 0, 'party', 3, 0), ...line([0, 1, 2, 3, 4, 5]), on('clockwork_page', 20, 'foe', 3, 6, 9), on('grave_ghoul', 21, 'foe', 2, 6, 1)], { moving: [20, 21] })
  const flank = fieldOf(b, true)
  const walk = fieldOf(b)
  assert.ok(flank.dist[tileAt(3, 6)] > walk.dist[tileAt(3, 6)], 'round the line is further')
  assert.equal(flank.dist[tileAt(3, 3)], Infinity, 'your pieces are walls to it')
  const page = b.byUid.get(20)
  const ghoul = b.byUid.get(21)
  assert.equal(arrowOf(b, ghoul), walk.arrow[ghoul.tile], 'a Walk kind walks the arrows')
  assert.equal(arrowOf(b, page), flank.arrow[page.tile])
  // The Page heads round for the gap at (6, 3), every step on the Flank field's arrows (its first not the Walk
  // field's), until the line is in its ring; the Ghoul walks straight into the line.
  const path = []
  while (!b.over && b.t < 200 && !foesNextTo(b, page).length) {
    const from = page.tile
    for (const e of moves(stepBattle(b), 20)) {
      assert.equal(e.to, flank.arrow[from])
      path.push(e.to)
    }
  }
  assert.ok(path.length >= 2 && path[0] !== walk.arrow[tileAt(3, 6)] && tileX(path.at(-1)) > 3, `round toward the gap: ${path}`)
  assert.ok(moves(b.events, 21).every((e) => e.to === walk.arrow[e.from]))
  // The field stands while your pieces only walk; a piece fallen makes it again.
  const was = fieldOf(b, true)
  const knight = b.byUid.get(4)
  b.at[knight.tile] = null
  knight.tile = tileAt(3, 2)
  b.at[knight.tile] = knight
  assert.equal(fieldOf(b, true), was, 'a piece that walks changes nothing')
  slay(b, b.byUid.get(1))
  const now = fieldOf(b, true)
  assert.notEqual(now, was)
  assert.ok(now.dist[tileAt(0, 3)] < Infinity, 'its tile is open ground again')
  // A line across every lane: no road round it, so a Flank kind walks the Walk field's arrows into it.
  const sealed = scene([on('monarch', 0, 'party', 3, 0), ...line([0, 1, 2, 3, 4, 5, 6]), on('clockwork_page', 20, 'foe', 3, 6, 9)], { moving: [20] })
  const shut = sealed.byUid.get(20)
  assert.equal(fieldOf(sealed, true).dist[shut.tile], Infinity)
  assert.equal(arrowOf(sealed, shut), fieldOf(sealed).arrow[shut.tile])
  while (!sealed.over && sealed.t < 300 && !sealed.events.some((e) => e.type === 'action' && e.actor === 20)) stepBattle(sealed)
  assert.equal(tileY(shut.tile), 4, 'it walked up to the line')
  assert.ok(sealed.events.some((e) => e.type === 'action' && e.actor === 20), 'and fights it')
})

// ── rings ────────────────────────────────────────────────────────────────────────────────────────

test('a ring\'s target: yours aim at the foe furthest along its road, ties by lane; a foe at the piece on its road, else the nearest', () => {
  // A Bone Chanter (ring 4) at (3, 2), the Monarch at (3, 0); in its ring, Ghouls at (5, 5) and (1, 5), five
  // steps from the Monarch, and at (3, 6), six. Of the two nearer the Monarch, CENTRE_OUT takes lane 1 first.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('bone_chanter', 1, 'party', 3, 2), on('grave_ghoul', 10, 'foe', 5, 5, 1),
    on('grave_ghoul', 11, 'foe', 1, 5, 1), on('grave_ghoul', 12, 'foe', 3, 6, 1), on('grave_ghoul', 13, 'foe', 3, 7, 1)])
  const chanter = b.byUid.get(1)
  assert.equal(ringTarget(b, chanter).uid, 11)
  slay(b, b.byUid.get(11))
  assert.equal(ringTarget(b, chanter).uid, 10)
  slay(b, b.byUid.get(10))
  assert.equal(ringTarget(b, chanter).uid, 12, 'the one at (3, 7) is past its ring')
  let shot = null
  while (!shot && b.t < 200) shot = stepBattle(b).find((e) => e.type === 'action' && e.actor === 1 && e.ability === 'marrow_bolt')
  assert.deepEqual(shot.targets, [12], 'and its blows go there')
  // A Frost Wyrm (ring 3, a Walk kind) at (3, 5) on its road down lane 3: the knight on its next tile, (3, 4),
  // before the Ghoul beside it; with the knight gone, the nearest; of two as near, CENTRE_OUT's lane first.
  const f = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4), on('grave_ghoul', 2, 'party', 2, 5),
    on('grave_ghoul', 3, 'party', 5, 3), on('grave_ghoul', 4, 'party', 1, 3), on('frost_wyrm', 10, 'foe', 3, 5)])
  const sprite = f.byUid.get(10)
  assert.equal(arrowOf(f, sprite), tileAt(3, 4))
  assert.equal(ringTarget(f, sprite).uid, 1)
  slay(f, f.byUid.get(1))
  assert.equal(ringTarget(f, sprite).uid, 2)
  slay(f, f.byUid.get(2))
  assert.equal(ringTarget(f, sprite).uid, 4)
  assert.equal(ringTarget(f, f.monarch), null, 'the Monarch\'s ring is none')
})

test('a piece fights whatever is in its ring and otherwise follows its line: a ranged one never steps while a foe is in reach', () => {
  // A Frost Sprite (ring 3) marching up lane 3; a Ghoul frozen at (3, 7). It halts with the Ghoul 3 tiles off,
  // shoots it from there, and walks on once it has fallen.
  const b = scene([on('monarch', 0, 'party', 3, 0), lined(on('frost_sprite', 1, 'party', 3, 1, 6), lane(3, 1, 8)), on('grave_ghoul', 10, 'foe', 3, 7, 1),
    on('iron_golem', 11, 'foe', 0, 10, 1)], { moving: [1] })
  const sprite = b.byUid.get(1)
  const ghoul = b.byUid.get(10)
  while (ghoul.hp > 0 && b.t < 2000) {
    const events = stepBattle(b)
    if (moves(events, 1).length) assert.ok(distance(sprite.tile, ghoul.tile) >= 3, `t ${b.t}: walked into its ring`)
    if (distance(sprite.tile, ghoul.tile) <= 3) assert.deepEqual(moves(events, 1).filter((e) => distance(e.from, ghoul.tile) <= 3), [], 'no step with a foe in its ring')
  }
  assert.equal(sprite.tile, tileAt(3, 4), 'it held three tiles off')
  assert.ok(b.events.some((e) => e.type === 'action' && e.actor === 1 && e.targets.includes(10)))
  while (b.t < 2200 && sprite.tile === tileAt(3, 4)) stepBattle(b)
  assert.equal(sprite.tile, tileAt(3, 5), 'then on along its line')
})

test('a piece with ring 2 lunges at a foe two tiles off, strikes from beside it, and walks back once its ring is clear', () => {
  // A Grave Ghoul at (3, 3) given ring 2; a frail Ghoul frozen at (3, 5); a golem far off keeps the battle going.
  const build = (extra = []) => {
    const b = scene([on('monarch', 0, 'party', 0, 0), on('grave_ghoul', 1, 'party', 3, 3, 9), ...extra, on('grave_ghoul', 10, 'foe', 3, 5, 1),
      on('iron_golem', 11, 'foe', 6, 10, 1)], { moving: [1] })
    b.byUid.get(1).ring = 2
    return b
  }
  const b = build()
  const ghoul = b.byUid.get(1)
  const foe = b.byUid.get(10)
  assert.ok(ghoul.lunges)
  const lunge = moves(stepBattle(b), 1)[0]
  assert.deepEqual([lunge?.from, lunge?.to], [tileAt(3, 3), tileAt(3, 4)], 'the straight step, beside the foe')
  assert.equal(ghoul.home, tileAt(3, 3))
  while (foe.hp > 0 && b.t < 1000) {
    stepBattle(b)
    assert.ok(distance(ghoul.tile, ghoul.home ?? ghoul.tile) <= 1, 'never further from its line than its ring')
  }
  assert.ok(b.events.some((e) => e.type === 'action' && e.actor === 1 && e.targets.includes(10)), 'it struck')
  while (b.t < 1200 && ghoul.tile !== tileAt(3, 3)) stepBattle(b)
  assert.deepEqual([ghoul.tile, ghoul.home], [tileAt(3, 3), null], 'back on the tile it left')
  // With no open tile beside the foe within its reach, it waits: three frozen knights hold them, and the foe is
  // a golem that outlasts the watch.
  const walled = scene([on('monarch', 0, 'party', 0, 0), on('grave_ghoul', 1, 'party', 3, 3, 9), ...[2, 3, 4].map((x) => on('tomb_knight', x, 'party', x, 4, 1)),
    on('iron_golem', 10, 'foe', 3, 5, 9)], { moving: [1] })
  walled.byUid.get(1).ring = 2
  for (let k = 0; k < 100; k++) assert.deepEqual(moves(stepBattle(walled), 1), [], 'no open tile: it waits')
  // A ring of 1 never lunges: a foe two tiles off is out of its ring.
  const short = build()
  short.byUid.get(1).ring = 1
  for (let k = 0; k < 100; k++) assert.deepEqual(moves(stepBattle(short), 1), [])
})

test('gauge never banks past the costliest ability, the tile index matches the living, and caches are never stale', () => {
  let wide = 0
  for (let i = 0; i < 40; i++) {
    // Half the battles bring a Tomb Knight whose Bulwark aura reaches 2 tiles, the widest on the board.
    const bulwark = (party) => Object.assign(party.find((u) => u.id === 'tomb_knight'), { tracks: [3, 0] })
    const b = boardOf(5, () => fresh('index' + i, 1 + (i % 4), i % 2 ? { monarch: true, will: 1, army: i % 4 === 3 ? 3 : 0, lines: i % 8 === 1 } : { ids: [...START, 'tomb_knight', 'bone_chanter'], tune: bulwark }))
    const check = () => {
      const living = b.units.filter((u) => u.hp > 0)
      for (const u of b.units) {
        assert.ok(u.gauge >= 0 && u.gauge <= costliestOf(u), `seed ${i} t ${b.t}: ${u.id} gauge ${u.gauge}`)
        if (u.hp > 0) assert.equal(b.at[u.tile], u, `seed ${i} t ${b.t}: ${u.id} missing from tile ${u.tile}`)
      }
      assert.equal(b.at.filter(Boolean).length, living.length, `seed ${i} t ${b.t}: the index holds the dead`)
    }
    while (!b.over) {
      boardOf(5, () => stepBattle(b))
      check()
      // The index answers the list helpers' questions the same way.
      if (b.t % 5) continue
      for (const u of b.units.filter((x) => x.hp > 0)) {
        assert.deepEqual(foesNextTo(b, u), listFoesNextTo(b.units, u))
        const givers = auraGivers(b, u)
        assert.deepEqual(givers, listAuraGivers(b.units, u))
        wide += givers.filter((g) => distance(g.tile, u.tile) === 2).length
        // The caches (stats, synergies) answer as a fresh reckoning would: a death or entry left
        // nothing stale.
        const cached = stats(b, u)
        const { cache, syn } = b
        b.cache = new Map()
        b.syn = {}
        assert.deepEqual(stats(b, u), cached, `seed ${i} t ${b.t}: ${u.id} has stale stats`)
        b.cache = cache
        b.syn = syn
      }
    }
    check()
  }
  assert.ok(wide > 0, 'some aura reached 2 tiles')
})

test('a unit can enter a battle under way: on the index, acting, and versioning the roster', () => {
  const b = fresh('enter')
  for (let k = 0; k < 40; k++) stepBattle(b)
  const roster = b.roster
  const ours = b.ours
  const foe = b.units.find((x) => x.side === 'foe' && x.hp > 0)
  const tile = [...Array(TILES).keys()].filter((t) => b.at[t] === null && !b.walls.has(t)).sort((x, y) => distance(x, foe.tile) - distance(y, foe.tile) || x - y)[0]
  const u = enterBattle(b, { ...makeUnit('frost_sprite', { uid: 99, lvl: 3 }), side: 'party', tile })
  assert.equal(b.at[tile], u)
  assert.deepEqual([b.roster, b.ours], [roster + 1, ours + 1])
  assert.deepEqual([u.gauge, u.nextStep, u.statuses, u.line, u.home], [0, b.t, [], null, null])
  assert.throws(() => enterBattle(b, { ...makeUnit('frost_sprite', { uid: 98 }), side: 'party', tile }), /taken/)
  const open = b.at.findIndex((x, t) => x === null && !b.walls.has(t))
  assert.throws(() => enterBattle(b, { ...makeUnit('frost_sprite', { uid: 97 }), side: 'party', tile: open, hp: 0 }), /no HP/)
  assert.equal(b.at[open], null, 'the dead never stand on the board')
  runBattle(b)
  assert.ok(b.events.some((e) => e.actor === 99), 'the newcomer acts')
})

test('a unit entering mid-battle fights with its HP mods, as one there from the start does, and only on open ground', () => {
  const walls = [deployTile('party', slotAt(6, 5))]
  const mods = [{ path: 'hp', op: 'mul', v: 1.5 }]
  const knight = (uid, slot) => makeUnit('tomb_knight', { uid, lvl: 3, slot })
  const b = createBattle({ party: [knight(1, slotAt(6, 3))], foes: [knight(10, slotAt(0, 3))], seed: 'fit', partyMods: mods, walls })
  const u = enterBattle(b, { ...knight(2), side: 'party', tile: deployTile('party', slotAt(6, 1)) })
  assert.equal(u.maxHp, Math.round(stats(b, u).hp))
  assert.ok(u.maxHp >= Math.round(knight(2).maxHp * 1.5), `${u.maxHp}: the relic's +50% is in it`)
  assert.equal(u.hp, u.maxHp)
  // The same knight there from the start, beside the first, is just as tough.
  const both = createBattle({ party: [knight(1, slotAt(6, 3)), knight(2, slotAt(6, 1))], foes: [knight(10, slotAt(0, 3))], seed: 'fit', partyMods: mods, walls })
  assert.equal(u.maxHp, both.units.find((x) => x.uid === 2).maxHp)
  assert.throws(() => enterBattle(b, { ...knight(3), side: 'party', tile: walls[0] }), /cannot be stood on/)
  assert.throws(() => enterBattle(b, { ...knight(4), side: 'party', tile: -1 }), /cannot be stood on/)
})

test('a battle ends undecided at its ceiling', () => {
  const b = createBattle({ party: team(START, { lvl: 9 }), foes: team(['iron_golem', 'iron_golem'], { side: 'foe', lvl: 9 }), seed: 'short', ceiling: 30 })
  const r = runBattle(b)
  assert.deepEqual([r.ticks, r.winner, b.reason], [30, null, 'tick-ceiling'])
})

test('a Tomb Knight shields the allies next to it', () => {
  const soul = (id, uid, row, col) => makeUnit(id, { uid, slot: slotAt(row, col), lvl: 3 })
  const party = [soul('tomb_knight', 1, 0, 3), soul('frost_sprite', 2, 1, 4), soul('bone_chanter', 3, 2, 0), soul('tomb_knight', 4, 0, 2)]
  const b = createBattle({ party, foes: [soul('clockwork_page', 10, 2, 3)], seed: 'aura' })
  const unit = (uid) => b.units.find((u) => u.uid === uid)
  assert.equal(stats(b, unit(2)).damage.taken, 0.85, 'next to a knight')
  assert.equal(stats(b, unit(3)).damage.taken, 1, 'three lanes away')
  assert.equal(stats(b, unit(1)).damage.taken, 0.85, "the other knight's aura, not its own")
  assert.ok(!('bonds' in b.events[0]), 'bonds are gone')
})

test('track tiers fight: a self heal mends the user, and a `who` mod touches only souls it names', () => {
  const ghoul = { ...makeUnit('grave_ghoul', { uid: 1, lvl: 6, slot: slotAt(0, 3) }), tracks: [0, 3] }
  ghoul.hp = Math.round(ghoul.maxHp / 2)
  const b = createBattle({ party: [ghoul], foes: team(['iron_golem'], { side: 'foe', lvl: 6 }), seed: 'devour' })
  runBattle(b)
  const devours = b.events.filter((e) => e.type === 'action' && e.ability === 'devour')
  assert.ok(devours.length > 0)
  assert.ok(b.events.some((e) => e.type === 'heal' && e.actor === 1 && e.target === 1), 'Devour heals its user')

  const vanguardsOnly = [{ path: 'def', op: 'mul', v: 2, who: { role: ['vanguard'] } }]
  const knight = makeUnit('tomb_knight', { uid: 2 })
  const sprite = makeUnit('frost_sprite', { uid: 3 })
  const army = createBattle({ party: autoPlace([knight, sprite]), foes: team(['clockwork_page'], { side: 'foe' }), seed: 'who', partyMods: vanguardsOnly })
  const of = (id) => stats(army, army.units.find((u) => u.id === id)).def
  assert.equal(of('tomb_knight'), 2 * unitDef('tomb_knight').base.def)
  assert.equal(of('frost_sprite'), unitDef('frost_sprite').base.def)
})

// ── the Monarch ──────────────────────────────────────────────────────────────────────────────────

test('the Monarch stands where it is put, never strikes, and banks for Arise while no corpse is in reach', () => {
  // A Monarch behind a lone knight; the foes stand off at the far end, out of everyone's reach.
  const b = scene([on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 3, 5), on('frost_sprite', 10, 'foe', 3, 10)], { moving: [0] })
  const m = b.monarch
  assert.equal(m.uid, 0)
  assert.equal(b.root, m.tile, 'the roads run to it')
  for (let k = 0; k < 200; k++) {
    for (const e of stepBattle(b)) assert.ok(e.actor !== 0, `t ${e.t}: the Monarch did ${e.type}`)
    assert.ok(m.gauge <= 200)
  }
  assert.equal(m.tile, tileAt(3, 2), 'it never stepped')
  assert.equal(m.gauge, 200, 'Arise is banked, and no more')
  assert.equal(nextCost(b, m), 200)
  // With no Monarch the roads run to the camp's rear middle tile.
  assert.equal(scene([on('tomb_knight', 1, 'party', 3, 5), on('frost_sprite', 10, 'foe', 3, 10)]).root, tileAt(3, 0))
})

test('Arise raises the strongest corpse in the domain, then the nearest, as a shadow of half a body\'s HP where it fell', () => tuned(FIRST_ARISE, () => {
  // The Monarch at (3, 2), domain 3. Corpses: a Bone Chanter (tier 2) 3 tiles off, two Ghouls (tier 1),
  // one 2 tiles off and one 3 off, a Tomb Knight (tier 2) 4 tiles off (outside), and a Wisp (tier 1) a
  // tile off, the nearest of all, but under a living knight. A living foe far away keeps the battle going.
  const build = (will) => {
    const b = scene([
      on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 0, 0, 1),
      on('bone_chanter', 10, 'foe', 6, 2, 4), on('grave_ghoul', 11, 'foe', 4, 4, 2), on('grave_ghoul', 12, 'foe', 0, 2, 2),
      on('tomb_knight', 13, 'foe', 3, 6, 4), on('will_o_wisp', 14, 'foe', 2, 2, 2), on('iron_golem', 15, 'foe', 6, 10, 1)
    ], { will })
    for (const uid of [10, 11, 12, 13, 14]) slay(b, b.units.find((u) => u.uid === uid))
    // The wisp's tile is held by the living: the party knight stands on it.
    const knight = b.units.find((u) => u.uid === 1)
    b.at[knight.tile] = null
    knight.tile = b.units.find((u) => u.uid === 14).tile
    b.at[knight.tile] = knight
    b.monarch.gauge = 200
    return b
  }
  const rise = (b) => {
    const events = stepBattle(b)
    return { action: events.find((e) => e.type === 'action' && e.actor === 0), arise: events.find((e) => e.type === 'arise'), events }
  }
  // Will 0: tier 1 only, so the nearer Ghoul (the Wisp, nearer still, lies under the living); one raise a battle.
  const b = build(0)
  const roster = b.roster
  const nextUid = b.nextUid
  const { action, arise } = rise(b)
  assert.deepEqual([action.ability, action.targets], ['arise', [11]])
  const ghoul = b.units.find((u) => u.uid === 11)
  const body = Math.round(baseStats('grave_ghoul', 2).hp / 2)
  assert.deepEqual(arise, {
    t: 0, type: 'arise', actor: 0, corpse: 11,
    unit: { uid: nextUid, id: 'grave_ghoul', side: 'party', tile: ghoul.tile, lvl: 2, hp: body, maxHp: body, shadow: true, count: 1 }
  })
  const shadow = b.units.find((u) => u.uid === nextUid)
  assert.ok(ghoul.raised && shadow.shadow && b.at[shadow.tile] === shadow && shadow.tile === ghoul.tile)
  assert.deepEqual([b.roster, b.nextUid, b.raised], [roster + 1, nextUid + 1, 1])
  b.monarch.gauge = 200
  for (let k = 0; k < 5; k++) assert.ok(!rise(b).action, 'one raise a battle at Will 0')
  // Will 1: tier 2 now, so the Chanter; the Knight lies beyond the domain, the Wisp under the living.
  const w = build(1)
  assert.deepEqual(rise(w).action.targets, [10])
  w.monarch.gauge = 200
  assert.deepEqual(rise(w).action.targets, [11], 'then the nearest of the rest')
  w.monarch.gauge = 200
  assert.ok(!rise(w).action, 'two raises a battle at Will 1')
}))

test('Arise by the numbers: raises × (1 + Will) a battle, of tier raiseTier + Will, each body at raiseHp of its HP', () => {
  const { raises, raiseTier } = TUNING.monarch
  // Corpses of every tier up to 5 at the Monarch's feet, more than any cap; a far golem keeps the battle going.
  const ids = ['grave_ghoul', 'bone_chanter', 'tomb_knight', 'iron_golem']
  for (const will of [0, 1]) {
    const corpses = [...Array(8).keys()].map((k) => on(ids[k % ids.length], 10 + k, 'foe', k % 7, 2 + Math.floor(k / 7), 2))
    const b = scene([on('monarch', 0, 'party', 3, 1), ...corpses, on('iron_golem', 50, 'foe', 6, 10, 1)], { will })
    for (const c of corpses) slay(b, b.units.find((u) => u.uid === c.uid))
    const risen = []
    for (let k = 0; k < 20; k++) {
      b.monarch.gauge = 200
      risen.push(...stepBattle(b).filter((e) => e.type === 'arise'))
    }
    const reach = corpses.filter((c) => unitDef(c.id).tier <= raiseTier + will).length
    assert.equal(risen.length, Math.min(reach, raises * (1 + will)), `Will ${will}`)
    for (const e of risen) {
      assert.ok(unitDef(e.unit.id).tier <= raiseTier + will)
      const body = b.byUid.get(e.unit.uid).body
      assert.deepEqual([e.unit.count, e.unit.hp, e.unit.maxHp], [1, body, body])
    }
  }
})

test('a shadow holds its tile, and counts for synergies', () => tuned(FIRST_ARISE, () => {
  // A Grave Ghoul corpse beside a party Grave Ghoul, inside the domain; a Ghoul foe walks in later from far off.
  const b = scene([
    on('monarch', 0, 'party', 3, 1), on('grave_ghoul', 1, 'party', 2, 3),
    on('grave_ghoul', 10, 'foe', 3, 3, 3), on('iron_golem', 11, 'foe', 6, 10, 1)
  ])
  const ghoul = b.byUid.get(1)
  const before = stats(b, ghoul)
  slay(b, b.byUid.get(10))
  b.monarch.gauge = 200
  stepBattle(b)
  const shadow = b.units.find((u) => u.shadow)
  assert.ok(shadow, 'it rose')
  assert.deepEqual([shadow.tile, shadow.line, shadow.nextStep], [tileAt(3, 3), null, b.t - 1], 'where it fell, with no line, free to step')
  // Undead 2 and Vanguard 2 now, for both: the shadow counts.
  assert.ok(stats(b, ghoul).def > before.def, 'the shadow made a synergy')
  for (let k = 0; k < 300; k++) assert.deepEqual(moves(stepBattle(b), shadow.uid), [], 'it holds')
  assert.equal(shadow.tile, tileAt(3, 3))
}))

test('Arise breaks a tie by the lowest uid, and never raises a boss, a shadow, or its own side\'s dead', () => {
  const arise = (b) => {
    b.monarch.gauge = 200
    return stepBattle(b).find((e) => e.type === 'action' && e.actor === 0)?.targets
  }
  const build = (corpses, will = 0) => {
    const b = scene([on('monarch', 0, 'party', 3, 2), ...corpses, on('iron_golem', 20, 'foe', 6, 10, 1)], { will })
    for (const c of corpses) slay(b, b.units.find((u) => u.uid === c.uid))
    return b
  }
  // Two Ghouls a tile off, the higher uid first on the list: the lower rises.
  assert.deepEqual(arise(build([on('grave_ghoul', 12, 'foe', 2, 3, 2), on('grave_ghoul', 11, 'foe', 4, 3, 2)])), [11])
  // The Hollow Sovereign at the Monarch's feet, its tier in reach at Will 4: the Ghoul rises instead.
  assert.deepEqual(arise(build([on('hollow_sovereign', 10, 'foe', 3, 3, 2), on('grave_ghoul', 11, 'foe', 5, 4, 2)], 4)), [11])
  // A foe-side shadow (as a foe's raise will make one) is no corpse to raise; the same body as a real foe is.
  const shade = build([on('grave_ghoul', 10, 'foe', 3, 3, 2)])
  shade.units.find((u) => u.uid === 10).shadow = true
  assert.equal(arise(shade), undefined)
  shade.units.find((u) => u.uid === 10).shadow = false
  assert.deepEqual(arise(shade), [10])
  // A fallen soul a tile off and a fallen foe two off: the foe rises. With only the soul, nothing does.
  const soul = on('grave_ghoul', 1, 'party', 3, 3, 2)
  assert.deepEqual(arise(build([soul, on('grave_ghoul', 10, 'foe', 5, 4, 2)])), [10])
  const own = build([soul])
  for (let k = 0; k < 5; k++) assert.equal(arise(own), undefined, 'the Monarch never raises its own dead')
  assert.ok(!own.events.some((e) => e.type === 'arise'))
})

test('Arise raises past the board\'s cap: its shadows take no place a soul needs', () => boardOf(1, () => {
  const b = scene([on('monarch', 0, 'party', 3, 1), on('tomb_knight', 1, 'party', 0, 4), on('tomb_knight', 2, 'party', 6, 4), on('tomb_knight', 40, 'foe', 3, 2, 1),
    on('iron_golem', 50, 'foe', 3, 10)], { will: 1 })
  slay(b, b.byUid.get(40))
  b.monarch.gauge = 200
  assert.ok(stepBattle(b).some((e) => e.type === 'arise'), 'two souls on a board of one, and the Monarch raised it')
}))

test('the battle is lost the instant the Monarch falls, and the killer is recorded', () => {
  // The Monarch, its one soul away in the far corner, and a Wisp shooting at it from 4 tiles off.
  const b = scene([on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 0, 0, 9), on('will_o_wisp', 10, 'foe', 3, 6, 9)])
  const r = runBattle(b)
  assert.deepEqual([r.winner, b.reason], ['foe', 'monarch'])
  const death = r.events.findIndex((e) => e.type === 'death' && e.target === 0)
  assert.ok(death > 0)
  assert.deepEqual(r.events.slice(death + 1).map((e) => e.type), ['battle:end'], 'no one acts after it falls')
  const blow = r.events[death - 1]
  assert.equal(blow.type, 'damage')
  const wisp = b.units.find((u) => u.uid === 10)
  assert.deepEqual(b.death, { by: 'will_o_wisp', uid: 10, ability: 'witchfire', from: wisp.tile, shape: 'single', threat: 'reach' })
  assert.deepEqual(r.events.at(-1), { t: b.t - 1, type: 'battle:end', winner: 'foe', reason: 'monarch', death: b.death })
  assert.ok(b.units.find((u) => u.uid === 1).hp > 0, 'its soul still stood')
  // The same blow with everyone ready to act in the tick it lands: a Ghoul after the Wisp in turn order,
  // beside a knight, holds its strike.
  const busy = scene([on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 0, 3, 5), on('will_o_wisp', 10, 'foe', 3, 5, 9), on('grave_ghoul', 11, 'foe', 0, 4, 5)])
  busy.monarch.hp = 1
  for (const u of busy.units) if (u.uid !== 0) u.gauge = u.costliest
  const order = busy.units.map((u) => u.uid)
  assert.ok(order.indexOf(11) > order.indexOf(10), `turn order ${order}`)
  const ev = stepBattle(busy)
  const fell = ev.findIndex((e) => e.type === 'death' && e.target === 0)
  assert.ok(fell > 0 && ev[fell - 1].actor === 10, 'the Wisp felled it')
  assert.deepEqual(ev.slice(fell + 1).map((e) => e.type), ['battle:end'])
  assert.equal(busy.units.find((u) => u.uid === 11).gauge, busy.units.find((u) => u.uid === 11).costliest, 'the Ghoul never struck')
  // The killer's threat is its first tag: a Frost Sprite [reach, drain] kills by reach.
  const sprite = scene([on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 0, 0), on('frost_sprite', 10, 'foe', 3, 5, 9)])
  sprite.monarch.hp = 1
  runBattle(sprite)
  assert.deepEqual([sprite.death.by, sprite.death.threat], ['frost_sprite', 'reach'])
})

test('a party wiped but for the Monarch fights on, and the Monarch alone with the dead can win', () => {
  // Its one soul is already dead; a Tomb Knight corpse lies at its feet; a weak Ghoul walks in.
  const b = scene([on('monarch', 0, 'party', 3, 2), on('frost_sprite', 1, 'party', 0, 0, 1),
    on('tomb_knight', 10, 'foe', 3, 3, 8), on('grave_ghoul', 11, 'foe', 3, 9, 1)], { moving: [11], will: 1 })
  slay(b, b.units.find((u) => u.uid === 1))
  slay(b, b.units.find((u) => u.uid === 10))
  b.monarch.gauge = 200
  stepBattle(b)
  assert.ok(!b.over, 'the Monarch still stands')
  const r = runBattle(b)
  assert.deepEqual([r.winner, b.reason], ['party', 'wipe'])
  assert.ok(r.events.some((e) => e.type === 'arise' && e.unit.id === 'tomb_knight'))
  assert.ok(r.events.some((e) => e.type === 'death' && e.target === 11 && b.units.find((u) => u.uid === e.actor).shadow), 'its shadow did the killing')
  assert.equal(b.death, null)
  // At the ceiling, undecided.
  const c = scene([on('monarch', 0, 'party', 3, 2), on('iron_golem', 10, 'foe', 3, 10)], { ceiling: 50 })
  const rc = runBattle(c)
  assert.deepEqual([rc.winner, c.reason, rc.ticks], [null, 'tick-ceiling', 50])
})

test('units made mid-battle take uids from nextUid, past every uid there by default', () => {
  const units = [on('monarch', 0, 'party', 3, 2), on('tomb_knight', 7, 'party', 3, 4), on('grave_ghoul', 40, 'foe', 3, 5, 1)]
  assert.equal(scene(units).nextUid, 41)
  assert.equal(scene(units, { nextUid: 100 }).nextUid, 100)
  // Past the reserve's too: a shadow never takes the uid of a foe still to enter.
  const reserve = [{ ...makeUnit('grave_ghoul', { uid: 60, lvl: 3 }), side: 'foe', when: { at: 'time', t: 9999 } }]
  assert.equal(scene(units, { reserve }).nextUid, 61)
})

test('a foe still to come enters at the top edge in its lane on its time, and keeps the battle going', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 0, 9), on('grave_ghoul', 10, 'foe', 3, 10, 1)], {
    reserve: [{ ...makeUnit('grave_ghoul', { uid: 70, lvl: 1 }), side: 'foe', lane: 5, wave: 1, when: { at: 'time', t: 20 } }]
  })
  assert.deepEqual(b.events[0].reserve, [{ uid: 70, id: 'grave_ghoul', lvl: 1, count: 1, wave: 1, when: { at: 'time', t: 20 }, side: 'foe' }])
  slay(b, b.units.find((u) => u.uid === 10))
  const seen = []
  while (b.t < 25) seen.push(...stepBattle(b).filter((e) => e.type === 'enter' || e.type === 'wave'))
  assert.ok(!b.over, 'a foe still to enter: not won')
  assert.deepEqual(seen.map((e) => [e.t, e.type]), [[20, 'wave'], [20, 'enter']])
  assert.equal(seen[1].unit.tile, tileAt(5, DEPTH - 1), 'at the top edge, in its lane')
  assert.deepEqual([b.foeIn, b.waveAt[1]], [20, 20])
})

// ── stacks (DESIGN §2.2) ─────────────────────────────────────────────────────────────────────────

// A piece of `count` bodies on a tile, for battles built tile by tile.
const stackOn = (id, uid, side, x, y, count, lvl = 3) => ({ ...makeUnit(id, { uid, lvl, count }), side, tile: tileAt(x, y) })
const firstBlow = (b, uid) => {
  while (!b.over && b.t < 2000) {
    const hit = stepBattle(b).find((e) => e.type === 'damage' && e.actor === uid)
    if (hit) return hit.damage
  }
  return null
}

test('a stack is one piece of count × body HP that strikes with every living body: three hit three times as hard as one, two of three twice', () => {
  // A Frost Sprite piece at (3, 4) shoots a golem 3 tiles up, out of the golem's ring: the same rolls each time.
  const sprite = (count, hp) => {
    const u = stackOn('frost_sprite', 1, 'party', 3, 4, count)
    return scene([hp ? { ...u, hp } : u, on('iron_golem', 50, 'foe', 3, 7, 9)])
  }
  const one = sprite(1)
  const u = one.byUid.get(1)
  const three = sprite(3)
  assert.deepEqual([three.byUid.get(1).count, three.byUid.get(1).body, three.byUid.get(1).maxHp, three.byUid.get(1).hp], [3, u.body, 3 * u.body, 3 * u.body])
  assert.equal(three.events[0].units.find((x) => x.uid === 1).count, 3, 'announced with its count')
  const d1 = firstBlow(one, 1)
  const d3 = firstBlow(three, 1)
  const d2 = firstBlow(sprite(3, 2 * u.body), 1)
  assert.ok(d1 > 0 && Math.abs(d3 - 3 * d1) <= 2 && Math.abs(d2 - 2 * d1) <= 2, JSON.stringify([d1, d2, d3]))
})

test('bodies fall one at a time, from the pool; a heal mends only the living, never lifting a fallen body', () => {
  // A stack of three Ghouls at (3, 6) under a golem's blows, a Hive Warden behind it mending.
  // A golem of twenty times its HP and three its ATK, so the stack falls before it does.
  const foeMods = [{ path: 'hp', op: 'mul', v: 20 }, { path: 'atk', op: 'mul', v: 3 }]
  const b = scene([stackOn('grave_ghoul', 1, 'party', 3, 6, 3), on('hive_warden', 2, 'party', 3, 4, 3), on('iron_golem', 50, 'foe', 3, 7, 6)], { foeMods })
  const stack = b.byUid.get(1)
  let living = livingBodies(stack)
  let hp = stack.hp
  const seen = new Set([living])
  let heals = 0
  while (!b.over && b.t < 3000 && stack.hp > 0) {
    for (const e of stepBattle(b)) {
      if (e.target !== 1) continue
      if (e.type === 'damage') assert.equal(e.hp, Math.max(0, hp - e.damage), 'the blow lands on the pool')
      if (e.type === 'heal') heals++
      if (e.type === 'damage' || e.type === 'heal') hp = e.hp
    }
    assert.equal(stack.hp, hp)
    assert.ok(livingBodies(stack) <= living && stack.hp <= livingBodies(stack) * stack.body, `t ${b.t}: ${stack.hp} hp, ${livingBodies(stack)} living, was ${living}`)
    living = livingBodies(stack)
    seen.add(living)
  }
  assert.ok(seen.has(2) && seen.has(1) && heals > 0, `living ${[...seen]}, ${heals} heals`)
})

test('a Shape hit lands on a stack once: one target, one blow on its pool', () => {
  // An Ember Drake bursts on the thickest spot: a stack of three Ghouls beside a lone one.
  const b = scene([stackOn('grave_ghoul', 1, 'party', 3, 5, 3), on('grave_ghoul', 2, 'party', 2, 5), on('ember_drake', 50, 'foe', 3, 8, 5)])
  let bursts = 0
  while (!b.over && b.t < 2000 && bursts < 3) {
    const events = stepBattle(b)
    const burst = events.find((e) => e.type === 'action' && e.ability === 'ember_burst')
    if (!burst) continue
    bursts++
    assert.equal(burst.targets.filter((uid) => uid === 1).length, 1, 'the stack is one target')
    assert.ok(events.filter((e) => e.type === 'damage' && e.target === 1).length <= 1, 'one blow on its pool')
  }
  assert.ok(bursts > 0)
})

test('a synergy counts a stack once, whatever its count', () => {
  const ghouls = (count) => scene([stackOn('grave_ghoul', 1, 'party', 3, 5, count), on('iron_golem', 50, 'foe', 6, 10, 1)])
  const party = (b) => b.events[0].synergies.filter((x) => x.side === 'party').map((x) => x.id)
  assert.deepEqual(party(ghouls(4)), [])
  const two = scene([stackOn('grave_ghoul', 1, 'party', 3, 5, 4), on('tomb_knight', 2, 'party', 2, 5), on('iron_golem', 50, 'foe', 6, 10, 1)])
  assert.ok(party(two).includes('undead_2') && !party(two).includes('undead_4'))
})

test('a soul\'s tiers add bodies for the battle, whole; none with the bodies switch, none to a fallen piece', () => {
  const chanter = (tracks, hp, ablate = []) => {
    const u = { ...makeUnit('bone_chanter', { uid: 1, lvl: 4, count: 2, slot: slotAt(3, 3), tracks }), ...(hp !== undefined && { hp }) }
    return createBattle({ party: [u], foes: [makeUnit('iron_golem', { uid: 50, lvl: 1, slot: slotAt(0, 3) })], seed: 'bodies', ablate }).byUid.get(1)
  }
  const plain = chanter([0, 0])
  const b = plain.body
  const marrow = chanter([0, 2])
  assert.deepEqual([plain.count, marrow.count, marrow.hp, marrow.maxHp, marrow.body], [2, 3, 3 * b, 3 * b, b])
  const hurt = chanter([0, 2], b)
  assert.deepEqual([hurt.count, hurt.hp, livingBodies(hurt)], [3, 2 * b, 2], 'the added body whole, beside the wounded')
  assert.equal(chanter([0, 2], 2 * plain.maxHp / 2, ['bodies']).count, 2)
  assert.equal(chanter([0, 2], 0), undefined, 'a fallen piece does not fight')
})

test('a shadow rises with the fallen piece\'s count, each body at raiseHp of its HP, and holds', () => tuned(FIRST_ARISE, () => {
  const b = scene([on('monarch', 0, 'party', 3, 1), stackOn('grave_ghoul', 10, 'foe', 3, 3, 3, 2), on('iron_golem', 11, 'foe', 6, 10, 1)])
  slay(b, b.byUid.get(10))
  b.monarch.gauge = 200
  const arise = stepBattle(b).find((e) => e.type === 'arise')
  const shadow = b.byUid.get(arise.unit.uid)
  const body = Math.round(stats(b, shadow).hp * TUNING.monarch.raiseHp)
  assert.deepEqual([shadow.count, shadow.body, shadow.hp, shadow.maxHp, livingBodies(shadow), arise.unit.count], [3, body, 3 * body, 3 * body, 3, 3])
  for (let k = 0; k < 200; k++) assert.deepEqual(moves(stepBattle(b), shadow.uid), [], 'it holds')
}))

// ── lines ────────────────────────────────────────────────────────────────────────────────────────

test('a line waits for its signal: a time, the first blow, a wave, a blow on the Monarch, a piece of yours fallen', () => {
  // A knight at (0, 1) with a line up its lane, waiting on `when`. The first step comes on the signal's tick or the
  // next (it acts after whoever gave it, or before): never earlier.
  const signalled = (when, units, opts = {}, until = (b) => b.t >= 400) => {
    const b = scene([lined(on('tomb_knight', 1, 'party', 0, 1, 9), lane(0, 1, 3), when), ...units], { moving: [1, ...(opts.moving ?? [])], ...opts })
    while (!b.over && !until(b) && !moves(b.events, 1).length) stepBattle(b)
    return { b, step: moves(b.events, 1)[0]?.t ?? null }
  }
  const golem = on('iron_golem', 50, 'foe', 6, 10, 1)
  assert.equal(signalled({ at: 'once' }, [golem]).step, 0)
  assert.equal(signalled({ at: 'time', t: 30 }, [golem]).step, 30)
  // Blow: a Wisp frozen in range of a soul across the board; its first blow, either side's, is the signal.
  const shot = signalled({ at: 'blow' }, [on('monarch', 0, 'party', 3, 0), on('grave_ghoul', 2, 'party', 6, 3, 9), on('will_o_wisp', 51, 'foe', 6, 7, 3)])
  const blow = shot.b.events.find((e) => e.type === 'damage').t
  assert.ok(shot.step >= blow && shot.step <= blow + 1, `blow at ${blow}, step at ${shot.step}`)
  // Wave 1: the reserve's first foe of wave 1 enters at 40; one of wave 0 (on the board from the start) is none.
  const reserve = [{ ...makeUnit('grave_ghoul', { uid: 70, lvl: 1 }), side: 'foe', lane: 6, wave: 1, when: { at: 'time', t: 40 } }]
  const wave = signalled({ at: 'wave', wave: 1 }, [golem], { reserve })
  assert.ok(wave.step === 40 || wave.step === 41, `step at ${wave.step}`)
  assert.equal(signalled({ at: 'wave', wave: 2 }, [golem], { reserve }).step, null, 'no wave 2 ever comes')
  // Struck: a frozen Wisp shoots the knight on its road first (no signal), and only its blow on the Monarch starts
  // the line, the marcher at (0, 0) out of its ring.
  const struck = scene([lined(on('tomb_knight', 1, 'party', 0, 0, 9), lane(0, 0, 3), { at: 'struck' }), on('monarch', 0, 'party', 3, 1),
    on('tomb_knight', 2, 'party', 3, 4, 1), on('will_o_wisp', 51, 'foe', 3, 5, 3)], { moving: [1] })
  struck.byUid.get(2).hp = 1
  while (!struck.over && struck.t < 1500 && !moves(struck.events, 1).length) stepBattle(struck)
  struck.step = moves(struck.events, 1)[0]?.t ?? null
  const hits = struck.events.filter((e) => e.type === 'damage')
  const onMonarch = hits.find((e) => e.target === 0)?.t
  assert.ok(hits.some((e) => e.target === 2 && e.t < onMonarch), 'a soul was struck first')
  assert.ok(struck.step >= onMonarch && struck.step <= onMonarch + 1, `struck at ${onMonarch}, step at ${struck.step}`)
  // Fallen: a foe slain is none; a Ghoul of yours at 1 HP beside a golem falls, and that is.
  const units = [on('monarch', 0, 'party', 3, 0), on('tomb_knight', 3, 'party', 6, 5, 9), on('grave_ghoul', 52, 'foe', 6, 6, 1), on('grave_ghoul', 2, 'party', 3, 4), on('iron_golem', 53, 'foe', 3, 5, 9)]
  const fallen = signalled({ at: 'falls' }, units, {}, (b) => b.t >= 1500)
  const deaths = fallen.b.events.filter((e) => e.type === 'death')
  const ours = deaths.find((e) => e.target === 2)?.t
  assert.ok(deaths.some((e) => e.target === 52 && e.t < ours), 'a foe fell first')
  assert.ok(fallen.step >= ours && fallen.step <= ours + 1, `fell at ${ours}, step at ${fallen.step}`)
})

test('a marcher waits behind a friend on its next tile, and walks on the tick the tile is free; at its last tile it holds', () => {
  // A knight on (3, 1) with a line up its lane to (3, 5); a Ghoul of yours holds (3, 3); a golem far off.
  const b = scene([lined(on('tomb_knight', 1, 'party', 3, 1), lane(3, 1, 4)), on('grave_ghoul', 2, 'party', 3, 3), on('iron_golem', 50, 'foe', 6, 10, 1)], { moving: [1] })
  const knight = b.byUid.get(1)
  for (let k = 0; k < 100; k++) stepBattle(b)
  assert.deepEqual(moves(b.events, 1).map((e) => e.to), [tileAt(3, 2)], 'one step, then it waits')
  slay(b, b.byUid.get(2))
  const freed = b.t
  stepBattle(b)
  assert.deepEqual(moves(b.events, 1).map((e) => [e.t, e.to]).at(-1), [freed, tileAt(3, 3)], 'on at once')
  for (let k = 0; k < 100; k++) stepBattle(b)
  assert.equal(knight.tile, tileAt(3, 5), 'its last tile')
  assert.equal(moves(b.events, 1).length, 4, 'and there it holds')
  // Two marchers in file: the one behind waits on the one ahead, step for step.
  const file = scene([lined(on('tomb_knight', 1, 'party', 3, 1), lane(3, 1, 3)), lined(on('tomb_knight', 2, 'party', 3, 0), lane(3, 0, 3)), on('iron_golem', 50, 'foe', 6, 10, 1)], { moving: [1, 2] })
  for (let k = 0; k < 100; k++) stepBattle(file)
  assert.deepEqual([file.byUid.get(1).tile, file.byUid.get(2).tile], [tileAt(3, 4), tileAt(3, 3)])
})

// ── Banners (DESIGN §2.8: a front-line kind's tier IV) ───────────────────────────────────────────

// A Tomb Knight of Bulwark IV: a Banner.
const banner = (uid, x, y, lvl = 3) => ({ ...on('tomb_knight', uid, 'party', x, y, lvl), tracks: [4, 0] })

test('a Banner leads: the pieces placed beside it walk its line keeping their places, their own lines set aside; the Monarch, another Banner and a piece not beside it keep their own', () => {
  // The Banner at (3, 1) up its lane to (3, 5). Beside it: a Ghoul at (2, 1) with a line of its own, a Sprite
  // at (4, 0), the Monarch at (3, 0), and a second Banner at (4, 2) on its own line; a Chanter at (6, 0), beside
  // neither, on its own.
  const far = on('iron_golem', 50, 'foe', 6, DEPTH - 1, 1)
  const b = scene([
    lined(banner(1, 3, 1), lane(3, 1, 4)), lined(on('grave_ghoul', 2, 'party', 2, 1), lane(2, 1, 1)), on('frost_sprite', 3, 'party', 4, 0),
    on('monarch', 0, 'party', 3, 0), lined(banner(4, 4, 2), [tileAt(5, 3)]), lined(on('bone_chanter', 5, 'party', 6, 0), lane(6, 0, 2)), far
  ], { moving: [1, 2, 3, 4, 5] })
  assert.deepEqual([1, 2, 3, 0, 4, 5].map((uid) => b.byUid.get(uid)).map((u) => [u.uid, u.banner, u.leader, u.offset]),
    [[1, true, null, null], [2, false, 1, [-1, 0]], [3, false, 1, [1, -1]], [0, false, null, null], [4, true, null, null], [5, false, null, null]])
  assert.deepEqual([b.byUid.get(2).line, b.byUid.get(3).line], [null, null], 'their own lines set aside')
  assert.deepEqual(b.events[0].units.filter((u) => u.leader !== undefined).map((u) => [u.uid, u.leader]).sort(), [[2, 1], [3, 1]], 'marked for the renderer')
  // Never a step ahead of their living Banner.
  const legs = { 1: 0, 2: 0, 3: 0 }
  for (let k = 0; k < 300; k++) {
    for (const e of stepBattle(b)) if (e.type === 'move' && legs[e.actor] !== undefined) legs[e.actor]++
    assert.ok(legs[2] <= legs[1] && legs[3] <= legs[1], JSON.stringify(legs))
  }
  assert.deepEqual([1, 2, 3, 0, 4, 5].map((uid) => b.byUid.get(uid).tile), [tileAt(3, 5), tileAt(2, 5), tileAt(4, 4), tileAt(3, 0), tileAt(5, 3), tileAt(6, 2)])
})

test('a Banner\'s wing waits on it: held up, they hold; fallen, they walk the rest of its line alone; one with no line leads no one', () => {
  // The Banner at (3, 1) up its lane; a Ghoul of yours holds (3, 3) in its way; its wing, a Ghoul at (2, 1).
  const far = on('iron_golem', 50, 'foe', 6, DEPTH - 1, 1)
  const b = scene([lined(banner(1, 3, 1), lane(3, 1, 4)), on('grave_ghoul', 2, 'party', 2, 1), on('grave_ghoul', 3, 'party', 3, 3), far], { moving: [1, 2] })
  assert.equal(b.byUid.get(3).leader, null, 'two tiles off: no wing')
  for (let k = 0; k < 200; k++) stepBattle(b)
  assert.deepEqual([b.byUid.get(1).tile, b.byUid.get(2).tile], [tileAt(3, 2), tileAt(2, 2)], 'the wing holds with its Banner')
  slay(b, b.byUid.get(1))
  for (let k = 0; k < 200; k++) stepBattle(b)
  assert.equal(b.byUid.get(2).tile, tileAt(2, 5), 'and walks on alone')
  // A Banner with no line: the piece beside it stays where it was put.
  const still = scene([banner(1, 3, 1), on('grave_ghoul', 2, 'party', 2, 1), far], { moving: [1, 2] })
  assert.equal(still.byUid.get(2).leader, null)
  for (let k = 0; k < 200; k++) stepBattle(still)
  assert.equal(still.byUid.get(2).tile, tileAt(2, 1))
})

test('a shadow that rises on a Banner\'s line falls in with its wing; off the line, or on a line no Banner leads, it holds', () => tuned(FIRST_ARISE, () => {
  // The Banner at (3, 1), its line up its lane from 30 ticks; a Ghoul foe slain at (3, 3), on that line, rises.
  const rise = (lead, x) => {
    const b = scene([on('monarch', 0, 'party', 0, 0), lined(lead, lane(3, 1, 4), { at: 'time', t: 30 }), on('grave_ghoul', 10, 'foe', x, 3, 2),
      on('iron_golem', 50, 'foe', 6, DEPTH - 1, 1)], { moving: [1], domain: 9 })
    slay(b, b.byUid.get(10))
    b.monarch.gauge = 200
    const arise = stepBattle(b).find((e) => e.type === 'arise')
    const shadow = b.byUid.get(arise.unit.uid)
    for (let k = 0; k < 300; k++) stepBattle(b)
    return { arise, shadow }
  }
  const { arise, shadow } = rise(banner(1, 3, 1), 3)
  assert.deepEqual([arise.unit.leader, shadow.offset], [1, [0, 2]])
  assert.equal(shadow.tile, tileAt(3, 7), 'it walks the Banner\'s line two tiles ahead of it')
  for (const [lead, x] of [[banner(1, 3, 1), 4], [{ ...on('tomb_knight', 1, 'party', 3, 1), tracks: [3, 0] }, 3]]) {
    const off = rise(lead, x)
    assert.deepEqual([off.arise.unit.leader, off.shadow.leader, off.shadow.tile], [undefined, null, tileAt(x, 3)])
  }
}))

test('timing marks: where each piece stands at 5, 10 and 15 s, walking the lines with your pieces the only blockers, as a battle walks them', () => {
  const at = (id, uid, x, y) => makeUnit(id, { uid, lvl: 3, slot: slotAt(6 - y, x) })
  const party = [at('monarch', 0, 3, 0), at('tomb_knight', 1, 3, 1), at('grave_ghoul', 2, 3, 3), at('frost_sprite', 3, 5, 1), at('bone_chanter', 4, 1, 1)]
  const lines = {
    1: { tiles: lane(3, 1, 5), when: { at: 'once' } },
    2: { tiles: [tileAt(2, 4)], when: { at: 'time', t: 150 } },
    3: { tiles: lane(5, 1, 3), when: { at: 'time', t: 120 } },
    4: { tiles: lane(1, 1, 3), when: { at: 'blow' } }
  }
  const marks = timingMarks({ party, lines })
  const step = TUNING.board.stepTicks
  assert.deepEqual(Object.keys(marks).map(Number), [0, 1, 2, 3, 4])
  // The knight is held at (3, 2) behind the Ghoul until the Ghoul's own line takes it off at tick 150; it follows
  // that tick (the Ghoul acts first), and a step a clock takes it to its last tile, (3, 6), at 198.
  assert.deepEqual(marks[1], [tileAt(3, 2), tileAt(3, 6), tileAt(3, 6)])
  assert.deepEqual(marks[2], [tileAt(3, 3), tileAt(2, 4), tileAt(2, 4)])
  // The Sprite waits for tick 120, then walks its three tiles a step a clock.
  assert.deepEqual(marks[3], [tileAt(5, 1), tileAt(5, 4), tileAt(5, 4)])
  // A Blow never comes on an empty field: the Chanter holds; the Monarch never steps.
  assert.deepEqual(marks[4], [tileAt(1, 1), tileAt(1, 1), tileAt(1, 1)])
  assert.deepEqual(marks[0], [tileAt(3, 0), tileAt(3, 0), tileAt(3, 0)])
  // The run units are untouched, and other ticks may be asked for.
  assert.deepEqual(party.map((u) => u.line), [undefined, undefined, undefined, undefined, undefined])
  assert.deepEqual(timingMarks({ party, lines, at: [0, step, 2 * step] })[1], [tileAt(3, 1), tileAt(3, 2), tileAt(3, 2)])
  // Against a battle whose foes stand off out of every ring, the marks are where the pieces stand.
  const b = createBattle({ party: party.map((u) => ({ ...u, ...(lines[u.uid] && { line: lines[u.uid] }) })), foes: [makeUnit('iron_golem', { uid: 50, lvl: 1, slot: slotAt(2, 0) })], seed: 'marks' })
  b.byUid.get(50).nextStep = Infinity
  const seen = { 0: [], 1: [], 2: [], 3: [], 4: [] }
  while (b.t <= 300) {
    if ([100, 200, 300].includes(b.t)) for (const uid of Object.keys(seen)) seen[uid].push(b.byUid.get(Number(uid)).tile)
    stepBattle(b)
  }
  assert.deepEqual(seen, marks)
})
