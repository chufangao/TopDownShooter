import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createBattle, stepBattle, runBattle, timelineHash, stats, enterBattle, nextCost, foesNextTo, auraGivers, field, fieldOf, arrowOf, ringTarget, flyStep
} from '../src/sim/battle.js'
import { TUNING } from '../src/tuning.js'
import { tuned, FIRST_ARISE } from './tuned.js'
import {
  makeUnit, autoPlace, distance, slotAt, campGrid, wallTiles, steps, costliestOf, abilitiesOf, deployTile, tileAt, tileX, tileY, baseStats, DEPTH,
  foesNextTo as listFoesNextTo, auraGivers as listAuraGivers, monarchSlot, TILES, livingBodies, ROWS, NEIGHBOURS, footprint, holdOf
} from '../src/sim/unit.js'
import { createRng } from '../src/sim/rng.js'
import { UNIT_LIST, TRACKS, unitDef, abilityDef, statusDef, CAMP_LIST } from '../src/content.js'
import { foeLevel, START_PARTY } from '../src/sim/run.js'
import { on, stackOn, scene as sceneOf, slay, moves } from './scene.js'

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

// In one of the floor's camps, picked by seed, walls and all, against that encounter. `tune` may edit
// the party before it fights; with `monarch`, the Monarch stands among them (on the camp's seat), holding `arise`
// copies of Arise (the Legendary relic: run.js); with `army`, the first soul is a stack of that many bodies more, and its second foe one too.
const fresh = (seed, floor = 1, { ids = START, tune = () => {}, monarch = false, arise = 1, army = 0 } = {}) => {
  const { foes, boss } = encounter(seed, floor)
  const camp = createRng(seed).stream('camp').pick(CAMP_LIST.filter((c) => c.floor === floor)).id
  const party = team(ids, { lvl: 1 + floor, camp })
  if (monarch) party.push(makeUnit('monarch', { uid: 0, lvl: 0, slot: monarchSlot(camp) }))
  const walls = wallTiles(camp)
  const stacked = (u) => Object.assign(u, makeUnit(u.id, { uid: u.uid, lvl: u.lvl, slot: u.slot, count: 1 + army }))
  if (army) {
    stacked(party[0])
    if (foes[1]) stacked(foes[1])
  }
  autoPlace(party, { grid: campGrid(camp) })
  tune(party)
  return createBattle({ party, foes, seed, floor, boss, walls, ...(monarch && { relics: Array(arise).fill('arise') }) })
}

// With the board holding only `n` bodies.
const boardOf = (n, fn) => tuned({ army: { board: n } }, fn)

// A battle of units placed on tiles (scene.js scene). The run holds Arise (a Legendary relic: without it the Monarch
// raises no one) unless the scene names its own `relics`.
const scene = (units, opts) => sceneOf(units, { relics: ['arise'], ...opts })

// Plain, and stacked: a Monarch, and a stack on each side.
const STACKED = { army: 3, monarch: true }

test('the same seed gives the same timeline; a different seed does not', () => {
  for (const opts of [{}, STACKED]) {
    const a = runBattle(fresh('det', 1, opts))
    const b = runBattle(fresh('det', 1, opts))
    assert.equal(a.hash, b.hash)
    assert.equal(a.hash, timelineHash(b.events))
    assert.notEqual(a.hash, runBattle(fresh('det2', 1, opts)).hash)
  }
})

test('stepping tick by tick equals runBattle', () => {
  for (const opts of [{}, STACKED]) {
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
    const b = fresh('fuzz' + i, floor, i % 3 ? {} : STACKED)
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

test('every step is a foe\'s, a legal one onto a tile free in its layer, one a step clock: a walker on its road, a flyer nearer the Monarch; your pieces never step', () => boardOf(5, () => {
  let roads = 0
  let flights = 0
  for (let i = 0; i < 60; i++) {
    const b = fresh('walk' + i, 1 + (i % 4), { monarch: i % 3 === 0, arise: 1 + i % 2, army: i % 4 === 1 ? 3 : 0 })
    const walk = fieldOf(b)
    const tile = new Map(b.units.map((u) => [u.uid, u.tile]))
    const last = new Map()
    const dead = new Set()
    // Who holds tile t on the ground, or in the air (`flies`): a flyer and a ground unit may share one.
    const holder = (t, flies) => b.units.find((x) => !dead.has(x.uid) && tile.get(x.uid) === t && !!x.flies === flies)
    while (!b.over) {
      for (const e of stepBattle(b)) {
        if (e.type === 'death') dead.add(e.target)
        if (e.type === 'rise') dead.delete(e.target)
        if (e.type === 'arise' || e.type === 'enter') {
          const flies = !!unitDef(e.unit.id).flies
          assert.ok(!holder(e.unit.tile, flies) && (!b.walls.has(e.unit.tile) || flies), `seed ${i} t ${e.t}: ${e.type} on a body or a wall`)
          tile.set(e.unit.uid, e.unit.tile)
        }
        if (e.type !== 'move') continue
        const u = b.byUid.get(e.actor)
        const where = `seed ${i} t ${e.t}: ${u.id} ${e.from}→${e.to}`
        assert.equal(u.side, 'foe', `${where}: one of yours stepped`)
        assert.equal(tile.get(u.uid), e.from)
        assert.ok(!holder(e.to, u.flies), `${where}: onto a body`)
        assert.ok(!last.has(u.uid) || e.t - last.get(u.uid) >= u.every, `${where}: stepped again too soon`)
        last.set(u.uid, e.t)
        if (u.flies) {
          assert.ok(NEIGHBOURS[e.from].includes(e.to) && distance(e.to, b.root) < distance(e.from, b.root), `${where}: no nearer the Monarch`)
          flights++
        } else {
          assert.ok(steps(e.from, b.walls).includes(e.to), `${where}: into or past a wall`)
          if (u.behaviour === 'walk') assert.equal(e.to, walk.arrow[e.from], `${where}: off its road`)
          roads++
        }
        tile.set(u.uid, e.to)
        const held = b.units.filter((x) => !dead.has(x.uid)).map((x) => `${tile.get(x.uid)}${x.flies ? ' air' : ''}`)
        assert.equal(new Set(held).size, held.length, `${where}: two units on one tile in one layer`)
      }
    }
    for (const u of b.units) if (u.side === 'party') assert.equal(u.tile, tile.get(u.uid), `seed ${i}: ${u.id} moved`)
  }
  assert.ok(roads > 0 && flights > 0, `${roads} steps on roads, ${flights} in flight`)
}))

test('a step costs no gauge: a foe steps every stepTicks ÷ its stride while its gauge keeps filling', () => {
  // A foe knight walks down the centre lane to the Monarch at (3, 0), with no one in its ring until it arrives.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 10, 'foe', 3, 10)], { moving: [10] })
  const knight = b.byUid.get(10)
  // What its gauge bar saves toward: with no foe in reach, its cheapest ability (a step is no cost).
  const cheapest = Math.min(...abilitiesOf(knight).map((a) => abilityDef(a).castCost))
  const steps = []
  let gauge = 0
  while (!b.over) {
    const saving = nextCost(b, knight)
    if (distance(knight.tile, b.monarch.tile) > 1) assert.equal(saving, cheapest, `t ${b.t}: saving for ${saving} with nothing in reach`)
    const events = stepBattle(b)
    const action = events.find((e) => e.type === 'action' && e.actor === 10)
    if (action) {
      assert.equal(abilityDef(action.ability).castCost, saving, 'it saved for the ability it used')
      break
    }
    steps.push(...moves(events, 10).map((e) => e.t))
    assert.ok(knight.gauge >= gauge, `t ${b.t}: the gauge fell from ${gauge} to ${knight.gauge}`)
    gauge = knight.gauge
  }
  assert.equal(steps.length, 9, 'down the lane to beside the Monarch')
  // The Tomb Knight walks at stride 0.75: a step every stepTicks ÷ 0.75 ticks.
  assert.equal(knight.every, Math.round(TUNING.board.stepTicks / unitDef('tomb_knight').stride))
  assert.deepEqual(steps, steps.map((_, k) => k * knight.every), 'one step per clock, from the first tick')
  // A kind's stride scales its clock.
  const def = unitDef('tomb_knight')
  const was = def.stride
  def.stride = 2
  try {
    const fast = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 10, 'foe', 3, 10)], { moving: [10] })
    while (fast.t < 30) stepBattle(fast)
    assert.deepEqual(moves(fast.events, 10).map((e) => e.t), [0, 8, 16, 24])
  } finally {
    def.stride = was
  }
  // One of yours never steps: its clock never comes.
  assert.deepEqual([b.monarch.every, b.monarch.nextStep], [Infinity, Infinity])
})

// ── roads ────────────────────────────────────────────────────────────────────────────────────────

test('roads: a flood from the root through every tile but walls; every arrow points strictly closer, by a legal step', () => {
  for (const c of CAMP_LIST) {
    const walls = wallTiles(c.id)
    const root = deployTile('party', monarchSlot(c.id))
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
  while (!b.over && b.t < 2000 && distance(ghoul.tile, b.monarch.tile) > ghoul.ring) {
    const from = ghoul.tile
    const to = arrowOf(b, ghoul)
    assert.equal(to, road.arrow[from])
    for (const e of moves(stepBattle(b), 10)) {
      assert.deepEqual([e.from, e.to], [from, to])
      path.push(e.to)
    }
  }
  assert.equal(path.length, road.dist[tileAt(0, 10)] - road.dist[ghoul.tile], 'the shortest road, a step at a time, until the Monarch is in its ring')
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
  const b = scene([on('monarch', 0, 'party', 3, 0), ...line([0, 1, 2, 3, 4, 5]), on('mantis_reaper', 20, 'foe', 3, 6, 9), on('grave_ghoul', 21, 'foe', 2, 6, 1)], { moving: [20, 21] })
  const flank = fieldOf(b, true)
  const walk = fieldOf(b)
  assert.ok(flank.dist[tileAt(3, 6)] > walk.dist[tileAt(3, 6)], 'round the line is further')
  assert.equal(flank.dist[tileAt(3, 3)], Infinity, 'your pieces are walls to it')
  const mantis = b.byUid.get(20)
  const ghoul = b.byUid.get(21)
  assert.equal(arrowOf(b, ghoul), walk.arrow[ghoul.tile], 'a Walk kind walks the arrows')
  assert.equal(arrowOf(b, mantis), flank.arrow[mantis.tile])
  // The Mantis heads round for the gap at (6, 3), every step on the Flank field's arrows (its first not the Walk
  // field's), until the line is in its ring; the Ghoul walks straight into the line.
  const path = []
  while (!b.over && b.t < 200 && !foesNextTo(b, mantis).length) {
    const from = mantis.tile
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
  // A line across every lane: no road round it, so a Flank kind walks the Walk field's arrows into it, heeding none of
  // the knights' rings, and halts only where a knight holds its next tile.
  const sealed = scene([on('monarch', 0, 'party', 3, 0), ...line([0, 1, 2, 3, 4, 5, 6]), on('mantis_reaper', 20, 'foe', 3, 6, 9)], { moving: [20] })
  const shut = sealed.byUid.get(20)
  assert.equal(fieldOf(sealed, true).dist[shut.tile], Infinity)
  assert.equal(arrowOf(sealed, shut), fieldOf(sealed).arrow[shut.tile])
  while (!sealed.over && sealed.t < 300 && !sealed.events.some((e) => e.type === 'action' && e.actor === 20)) stepBattle(sealed)
  assert.equal(tileY(shut.tile), 4, 'it walked up to the line, beside it (a foe has no long arm)')
  const blow = sealed.events.find((e) => e.type === 'action' && e.actor === 20)
  assert.deepEqual(blow?.targets, [sealed.at[arrowOf(sealed, shut)].uid], 'and fights the knight in its way')
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
  assert.equal(ringTarget(f, f.monarch), null, 'nothing stands in the Monarch\'s ring of 1')
})

test('gauge never banks past the costliest ability, the tile index matches the living (every tile of a 2×2), and caches are never stale', () => {
  let wide = 0
  let big = 0
  for (let i = 0; i < 40; i++) {
    // Half the battles bring a Tomb Knight whose Bulwark aura reaches 2 tiles, the widest on the board, and half of
    // those a 2×2 Bone Colossus (the deeper floors bring flyers).
    const bulwark = (party) => Object.assign(party.find((u) => u.id === 'tomb_knight'), { tracks: [3, 0] })
    const ids = [...START, 'tomb_knight', i % 4 === 2 ? 'bone_colossus' : 'bone_chanter']
    const b = boardOf(5, () => fresh('index' + i, 1 + (i % 4), i % 2 ? { monarch: true, arise: 2, army: i % 4 === 3 ? 3 : 0 } : { ids, tune: bulwark }))
    const check = () => {
      const living = b.units.filter((u) => u.hp > 0)
      for (const u of b.units) {
        assert.ok(u.gauge >= 0 && u.gauge <= costliestOf(u), `seed ${i} t ${b.t}: ${u.id} gauge ${u.gauge}`)
        if (u.hp > 0) for (const t of footprint(u.tile, u.size)) assert.equal((u.flies ? b.sky : b.at)[t], u, `seed ${i} t ${b.t}: ${u.id} missing from tile ${t}`)
      }
      const indexed = [...b.at, ...b.sky].filter(Boolean)
      assert.equal(new Set(indexed).size, living.length, `seed ${i} t ${b.t}: the index holds the dead`)
      assert.equal(indexed.length, living.reduce((n, u) => n + u.size * u.size, 0), `seed ${i} t ${b.t}: a tile too many`)
      assert.ok(b.sky.every((u) => u === null || u.flies) && b.at.every((u) => u === null || !u.flies), `seed ${i} t ${b.t}: a unit in the wrong layer`)
    }
    big += b.units.filter((u) => u.size > 1).length
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
  assert.ok(big > 0, 'some battle brought a 2×2 piece')
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
  assert.deepEqual([u.gauge, u.nextStep, u.statuses], [0, Infinity, []], 'one of yours never steps')
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

test('Arise raises the strongest corpse in the domain, then the nearest, whoever stands on it, as a shadow of half a body\'s HP beside the Monarch', () => tuned(FIRST_ARISE, () => {
  // The Monarch at (3, 2), domain 3. Corpses: a Bone Chanter (tier 2) 3 tiles off, two Ghouls (tier 1),
  // one 2 tiles off and one 3 off, a Tomb Knight (tier 2) 4 tiles off (outside), and a Wisp (tier 1) a
  // tile off, the nearest of all, under a living knight. A living foe far away keeps the battle going.
  const build = (copies) => {
    const b = scene([
      on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 0, 0, 1),
      on('bone_chanter', 10, 'foe', 6, 2, 4), on('grave_ghoul', 11, 'foe', 4, 4, 2), on('grave_ghoul', 12, 'foe', 0, 2, 2),
      on('tomb_knight', 13, 'foe', 3, 6, 4), on('will_o_wisp', 14, 'foe', 2, 2, 2), on('iron_golem', 15, 'foe', 6, 10, 1)
    ], { relics: Array(copies).fill('arise') })
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
  // One copy of Arise: tier 1 only, so the nearest, the Wisp, though the living knight stands on it; one raise a battle. It
  // rises beside the Monarch: of the free tiles a step from it, those a step from where it fell, then the centre
  // lane, then the lower: (3, 1).
  const b = build(1)
  const roster = b.roster
  const nextUid = b.nextUid
  const { action, arise } = rise(b)
  assert.deepEqual([action.ability, action.targets], ['arise', [14]])
  const wisp = b.units.find((u) => u.uid === 14)
  const body = Math.round(baseStats('will_o_wisp', 2).hp / 2)
  assert.deepEqual(arise, {
    t: 0, type: 'arise', actor: 0, corpse: 14, from: tileAt(2, 2),
    unit: { uid: nextUid, id: 'will_o_wisp', side: 'party', tile: tileAt(3, 1), lvl: 2, hp: body, maxHp: body, shadow: true, count: 1 }
  })
  const shadow = b.units.find((u) => u.uid === nextUid)
  assert.ok(wisp.raised && shadow.shadow && b.at[shadow.tile] === shadow && b.at[wisp.tile].uid === 1)
  assert.deepEqual([b.roster, b.nextUid, b.raised], [roster + 1, nextUid + 1, 1])
  b.monarch.gauge = 200
  for (let k = 0; k < 5; k++) assert.ok(!rise(b).action, 'one raise a battle with one copy')
  // Two copies: tier 2 now, so the Chanter; the Knight lies beyond the domain.
  const w = build(2)
  assert.deepEqual(rise(w).action.targets, [10])
  w.monarch.gauge = 200
  assert.deepEqual(rise(w).action.targets, [14], 'then the nearest of the rest')
  w.monarch.gauge = 200
  assert.deepEqual(rise(w).action.targets, [11], 'then the nearer Ghoul')
  w.monarch.gauge = 200
  assert.ok(!rise(w).action, 'three raises a battle with two copies')
}))

test('a shadow rises on the free tile closest to the Monarch: ties to the tile nearest where it fell, then lane order', () => tuned(FIRST_ARISE, () => {
  // The Monarch at (3, 0), domain 9; a Ghoul slain at `at`, with party Knights on `taken`.
  const rise = (at, taken = []) => {
    const b = scene([on('monarch', 0, 'party', 3, 0), ...taken.map(([x, y], i) => on('tomb_knight', 1 + i, 'party', x, y)), on('grave_ghoul', 10, 'foe', ...at, 2),
      on('iron_golem', 50, 'foe', 6, DEPTH - 1, 1)], { domain: 9 })
    slay(b, b.byUid.get(10))
    b.monarch.gauge = 200
    return stepBattle(b).find((e) => e.type === 'arise')?.unit.tile ?? null
  }
  // A step from the Monarch: (2, 0), (4, 0), (2, 1), (3, 1), (4, 1). From up the centre lane, (3, 1) is nearest.
  assert.equal(rise([3, 6]), tileAt(3, 1))
  // From (0, 3), (2, 1) is nearest, two tiles off.
  assert.equal(rise([0, 3]), tileAt(2, 1))
  // From (1, 3), (2, 1) and (3, 1) are both two off: lane 3 comes first in lane order.
  assert.equal(rise([1, 3]), tileAt(3, 1))
  // From (6, 1), (4, 0) and (4, 1) are both two off, and in one lane: the lower tile.
  assert.equal(rise([6, 1]), tileAt(4, 0))
  // With (3, 1) taken, from straight up the centre: (2, 1) and (4, 1) are equally near; lane 2 comes first.
  assert.equal(rise([3, 6], [[3, 1]]), tileAt(2, 1))
  // Every tile a step off taken: two steps off, nearest where it fell.
  assert.equal(rise([3, 6], [[2, 0], [4, 0], [2, 1], [3, 1], [4, 1]]), tileAt(3, 2))
}))

test('a shadow never rises where it fell unless that is the free tile closest to the Monarch; with none free, nothing rises and no raise is spent', () => tuned(FIRST_ARISE, () => {
  // Slain two tiles up from the Monarch, it rises a tile from it, and its death tile stays clear.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('grave_ghoul', 10, 'foe', 3, 2, 2), on('iron_golem', 50, 'foe', 6, DEPTH - 1, 1)])
  slay(b, b.byUid.get(10))
  b.monarch.gauge = 200
  const arise = stepBattle(b).find((e) => e.type === 'arise')
  assert.deepEqual([arise.from, arise.unit.tile, b.at[tileAt(3, 2)]], [tileAt(3, 2), tileAt(3, 1), null])
  // Every tile but four walled: the Monarch's, a Knight's, the Ghoul's and the golem's. The Ghoul slain, a Sprite of
  // yours steps onto its tile: no tile is free, so Arise does not cast, and spends nothing.
  const open = [deployTile('party', slotAt(6, 3)), deployTile('party', slotAt(5, 3)), deployTile('foe', slotAt(0, 3)), deployTile('foe', slotAt(0, 4))]
  const walls = [...Array(TILES).keys()].filter((t) => !open.includes(t))
  const full = createBattle({
    party: [makeUnit('monarch', { uid: 0, lvl: 3, slot: slotAt(6, 3) }), makeUnit('tomb_knight', { uid: 1, lvl: 3, slot: slotAt(5, 3) })],
    foes: [makeUnit('grave_ghoul', { uid: 10, lvl: 2, slot: slotAt(0, 3) }), makeUnit('iron_golem', { uid: 50, lvl: 1, slot: slotAt(0, 4) })],
    seed: 'full', walls, domain: 9, relics: ['arise', 'arise']
  })
  const corpse = full.byUid.get(10)
  slay(full, corpse)
  enterBattle(full, { ...makeUnit('frost_sprite', { uid: 5, lvl: 1 }), side: 'party', tile: corpse.tile })
  full.monarch.gauge = 200
  for (let k = 0; k < 20; k++) assert.ok(!stepBattle(full).some((e) => e.type === 'arise' || (e.type === 'action' && e.actor === 0)), 'no tile, no Arise')
  assert.deepEqual([full.raised, full.monarch.gauge >= 200], [0, true])
  // The Sprite falls: its tile, the Ghoul's death tile, is the one free tile, and there the Ghoul rises.
  slay(full, full.byUid.get(5))
  const rose = stepBattle(full).find((e) => e.type === 'arise')
  assert.deepEqual([rose.corpse, rose.unit.tile, full.raised], [10, corpse.tile, 1])
}))

test('a foe road through the domain stays clear of its dead: the next foe walks over where the first fell', () => tuned(FIRST_ARISE, () => {
  // Two Ghouls in file down the centre lane, the first slain at (3, 3), inside the domain; the Monarch raises it.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('grave_ghoul', 10, 'foe', 3, 3, 2), on('grave_ghoul', 11, 'foe', 3, 5, 2),
    on('iron_golem', 50, 'foe', 6, DEPTH - 1, 1)], { moving: [11] })
  slay(b, b.byUid.get(10))
  b.monarch.gauge = 200
  const arise = stepBattle(b).find((e) => e.type === 'arise')
  assert.deepEqual([arise.from, arise.unit.tile], [tileAt(3, 3), tileAt(3, 1)])
  const road = fieldOf(b)
  assert.equal(road.arrow[tileAt(3, 4)], tileAt(3, 3), 'the road runs through where it fell')
  let over = false
  for (let k = 0; k < 200 && !over; k++) over = moves(stepBattle(b), 11).some((e) => e.to === tileAt(3, 3))
  assert.ok(over, 'the second Ghoul walks onto the tile the first fell on')
}))

test('Arise by the numbers, the relic\'s own: raises and tier for one copy, more of each a copy past the first, each body at its hp share of its HP', () => {
  const { raises, tier, more } = TUNING.arise
  // Corpses of every tier up to 5 at the Monarch's feet, more than any cap; a far golem keeps the battle going.
  const ids = ['grave_ghoul', 'bone_chanter', 'tomb_knight', 'iron_golem']
  for (const copies of [1, 2]) {
    const past = copies - 1
    const corpses = [...Array(8).keys()].map((k) => on(ids[k % ids.length], 10 + k, 'foe', k % 7, 2 + Math.floor(k / 7), 2))
    const b = scene([on('monarch', 0, 'party', 3, 1), ...corpses, on('iron_golem', 50, 'foe', 6, 10, 1)], { relics: Array(copies).fill('arise') })
    for (const c of corpses) slay(b, b.units.find((u) => u.uid === c.uid))
    const risen = []
    for (let k = 0; k < 20; k++) {
      b.monarch.gauge = 200
      risen.push(...stepBattle(b).filter((e) => e.type === 'arise'))
    }
    const reach = corpses.filter((c) => unitDef(c.id).tier <= tier + more.tier * past).length
    assert.equal(risen.length, Math.min(reach, raises + more.raises * past), `${copies} copies`)
    for (const e of risen) {
      assert.ok(unitDef(e.unit.id).tier <= tier + more.tier * past)
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
  assert.deepEqual([shadow.tile, shadow.nextStep], [tileAt(3, 2), Infinity], 'beside the Monarch, toward where it fell, never to step')
  // Undead 2 and Vanguard 2 now, for both: the shadow counts.
  assert.ok(stats(b, ghoul).def > before.def, 'the shadow made a synergy')
  for (let k = 0; k < 300; k++) assert.deepEqual(moves(stepBattle(b), shadow.uid), [], 'it holds')
  assert.equal(shadow.tile, tileAt(3, 2))
}))

test('Arise breaks a tie by the lowest uid, and never raises a boss, a shadow, or its own side\'s dead', () => {
  const arise = (b) => {
    b.monarch.gauge = 200
    return stepBattle(b).find((e) => e.type === 'action' && e.actor === 0)?.targets
  }
  const build = (corpses, copies = 1) => {
    const b = scene([on('monarch', 0, 'party', 3, 2), ...corpses, on('iron_golem', 20, 'foe', 6, 10, 1)], { relics: Array(copies).fill('arise') })
    for (const c of corpses) slay(b, b.units.find((u) => u.uid === c.uid))
    return b
  }
  // Two Ghouls a tile off, the higher uid first on the list: the lower rises.
  assert.deepEqual(arise(build([on('grave_ghoul', 12, 'foe', 2, 3, 2), on('grave_ghoul', 11, 'foe', 4, 3, 2)])), [11])
  // The Hollow Sovereign at the Monarch's feet, its tier in reach with five copies of Arise: the Ghoul rises instead.
  assert.deepEqual(arise(build([on('hollow_sovereign', 10, 'foe', 3, 3, 2), on('grave_ghoul', 11, 'foe', 5, 4, 2)], 5)), [11])
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
    on('iron_golem', 50, 'foe', 3, 10)], { relics: ['arise', 'arise'] })
  slay(b, b.byUid.get(40))
  b.monarch.gauge = 200
  assert.ok(stepBattle(b).some((e) => e.type === 'arise'), 'two souls on a board of one, and the Monarch raised it')
}))

test('the battle is lost the instant the Monarch falls, and the killer is recorded', () => {
  // The Monarch, its one soul away in the far corner, and a Wisp walking in to shoot it.
  const b = scene([on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 0, 0, 9), on('will_o_wisp', 10, 'foe', 3, 6, 9)], { moving: [10] })
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
  // The same blow with everyone ready to act in the tick it lands: the Wisp beside the Monarch, and a Ghoul after it in
  // turn order, halted by a knight in its way, holds its strike.
  const busy = scene([on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 1, 3, 5), on('will_o_wisp', 10, 'foe', 3, 3, 9), on('grave_ghoul', 11, 'foe', 0, 4, 5)])
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
  const sprite = scene([on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 0, 0), on('frost_sprite', 10, 'foe', 3, 5, 9)], { moving: [10] })
  sprite.monarch.hp = 1
  runBattle(sprite)
  assert.deepEqual([sprite.death.by, sprite.death.threat], ['frost_sprite', 'reach'])
})

test('a party wiped but for the Monarch fights on, and the Monarch alone with the dead can win', () => {
  // Its one soul is already dead; a Tomb Knight corpse lies at its feet; a weak foe Knight walks in.
  const b = scene([on('monarch', 0, 'party', 3, 2), on('frost_sprite', 1, 'party', 0, 0, 1),
    on('tomb_knight', 10, 'foe', 3, 3, 8), on('tomb_knight', 11, 'foe', 3, 9, 1)], { moving: [11], relics: ['arise', 'arise'] })
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

test('with the foes\' rows full, a foe still to come waits in the reserve: it never enters the gap row or your camp, and enters once a tile there frees', () => {
  // Twenty-one frozen Pages fill the foes' three rows; a Ghoul of the next wave is due at tick 5, in lane 5, and a Hive
  // Drone behind it (the reserve enters in order, one a tick: the flyer waits its turn, though the air is free).
  const rows = [...Array(21).keys()].map((i) => on('clockwork_page', 10 + i, 'foe', i % 7, DEPTH - 1 - Math.floor(i / 7), 1))
  const b = scene([on('monarch', 0, 'party', 3, 0), ...rows], {
    reserve: [{ ...makeUnit('grave_ghoul', { uid: 70, lvl: 1 }), side: 'foe', lane: 5, wave: 1, when: { at: 'time', t: 5 } },
      { ...makeUnit('hive_drone', { uid: 71, lvl: 1 }), side: 'foe', lane: 5, wave: 1, when: { at: 'time', t: 5 } }]
  })
  const seen = []
  while (b.t < 40) seen.push(...stepBattle(b).filter((e) => e.type === 'enter'))
  assert.deepEqual(b.reserve.map((u) => u.uid), [70, 71], 'both still wait')
  assert.deepEqual(seen, [], 'nobody entered')
  // A Page falls at (2, 9): the Ghoul enters there, the nearest open tile of the foes' rows to the top of its lane, and
  // the flyer behind it after.
  slay(b, b.byUid.get(10 + 7 + 2))
  while (b.t < 45) seen.push(...stepBattle(b).filter((e) => e.type === 'enter'))
  assert.deepEqual(seen.map((e) => [e.unit.uid, e.unit.tile]), [[70, tileAt(2, DEPTH - 2)], [71, tileAt(5, DEPTH - 1)]])
  assert.ok(b.units.filter((u) => u.side === 'foe' && u.hp > 0).every((u) => tileY(u.tile) >= DEPTH - 3))
})

// ── stacks (DESIGN §2.2) ─────────────────────────────────────────────────────────────────────────

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
  // An Ember Drake, halted in the Ghouls' rings, bursts on the thickest spot: a stack of three Ghouls beside a lone one.
  const b = scene([stackOn('grave_ghoul', 1, 'party', 3, 5, 3), on('grave_ghoul', 2, 'party', 2, 5), on('ember_drake', 50, 'foe', 3, 7, 5)])
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

test('an Ember Drake bursts on a lone foe in its ring: no blow of its waits for a crowd', () => {
  const b = scene([on('ember_drake', 1, 'party', 3, 4), on('iron_golem', 50, 'foe', 3, 7, 9)])
  let burst = null
  while (!b.over && b.t < 400 && !burst) burst = stepBattle(b).find((e) => e.type === 'action' && e.actor === 1)
  assert.deepEqual([burst?.ability, burst?.targets], ['ember_burst', [50]])
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
  const n = TRACKS.bone_chanter[1].tiers[1].count
  assert.deepEqual([plain.count, marrow.count, marrow.hp, marrow.maxHp, marrow.body], [2, 2 + n, (2 + n) * b, (2 + n) * b, b])
  const hurt = chanter([0, 2], b)
  assert.deepEqual([hurt.count, hurt.hp, livingBodies(hurt)], [2 + n, (1 + n) * b, 1 + n], 'the added bodies whole, beside the wounded')
  assert.equal(chanter([0, 2], 2 * plain.maxHp / 2, ['bodies']).count, 2)
  assert.equal(chanter([0, 2], 0), undefined, 'a fallen piece does not fight')
})

test('a shadow rises with the fallen piece\'s count, each body at Arise\'s hp share of its HP, and holds', () => tuned(FIRST_ARISE, () => {
  const b = scene([on('monarch', 0, 'party', 3, 1), stackOn('grave_ghoul', 10, 'foe', 3, 3, 3, 2), on('iron_golem', 11, 'foe', 6, 10, 1)])
  slay(b, b.byUid.get(10))
  b.monarch.gauge = 200
  const arise = stepBattle(b).find((e) => e.type === 'arise')
  const shadow = b.byUid.get(arise.unit.uid)
  const body = Math.round(stats(b, shadow).hp * TUNING.arise.hp)
  assert.deepEqual([shadow.count, shadow.body, shadow.hp, shadow.maxHp, livingBodies(shadow), arise.unit.count], [3, body, 3 * body, 3 * body, 3, 3])
  for (let k = 0; k < 200; k++) assert.deepEqual(moves(stepBattle(b), shadow.uid), [], 'it holds')
}))


// ── footprints (DESIGN §2.2) ─────────────────────────────────────────────────────────────────────

test('a 2×2 piece stands on its whole footprint: on the index four times, every reach measured from it, listed once, and its fall clears all four', () => {
  // A Bone Colossus (size 2) anchored at (2, 3) covers (2, 3), (3, 3), (2, 4) and (3, 4). Ghouls at (4, 4) and (1, 2), each
  // a tile from the footprint and two from its anchor, and a Hive Drone at (1, 5), beside it too; a Frost Sprite of yours
  // at (5, 6), two tiles off it, and a Chanter at (6, 3), three off.
  const b = scene([on('bone_colossus', 1, 'party', 2, 3, 9), on('frost_sprite', 2, 'party', 5, 6), on('bone_chanter', 3, 'party', 6, 3),
    on('grave_ghoul', 10, 'foe', 4, 4, 9), on('grave_ghoul', 11, 'foe', 1, 2, 9), on('hive_drone', 12, 'foe', 1, 5, 9)], { walls: [tileAt(5, 0)] })
  const colossus = b.byUid.get(1)
  const tiles = footprint(tileAt(2, 3), 2)
  assert.deepEqual(tiles, [tileAt(2, 3), tileAt(3, 3), tileAt(2, 4), tileAt(3, 4)])
  assert.equal(colossus.size, 2)
  assert.ok(tiles.every((t) => b.at[t] === colossus), 'on the index on every tile')
  assert.equal(b.events[0].units.find((u) => u.uid === 1).size, 2, 'announced with its size')
  // Next to it: whoever is a tile from any tile of it, each once; the Ghoul at (4, 4) is beside two of its tiles.
  assert.deepEqual(foesNextTo(b, colossus).map((u) => u.uid), [10, 11, 12])
  assert.deepEqual(foesNextTo(b, b.byUid.get(10)), [colossus])
  assert.deepEqual(foesNextTo(b, colossus), listFoesNextTo(b.units, colossus))
  // Its aura (2 tiles) reaches from the footprint: the Sprite, not the Chanter.
  assert.deepEqual([2, 3].map((uid) => stats(b, b.byUid.get(uid)).damage.taken), [0.85, 1])
  assert.deepEqual(auraGivers(b, b.byUid.get(2)), listAuraGivers(b.units, b.byUid.get(2)))
  // Its sweep, a melee blow at every foe within 1 of it, strikes both Ghouls once and never the Drone.
  let sweep = null
  while (!b.over && b.t < 1000 && !sweep) sweep = stepBattle(b).find((e) => e.type === 'action' && e.actor === 1)
  assert.deepEqual([sweep.ability, sweep.targets], ['colossal_sweep', [10, 11]])
  // No other footprint may overlap it, leave the board or stand on a wall.
  const big = (uid, tile) => ({ ...makeUnit('bone_colossus', { uid, lvl: 1 }), side: 'party', tile })
  assert.throws(() => enterBattle(b, big(90, tileAt(1, 4))), /taken/)
  assert.throws(() => enterBattle(b, big(91, tileAt(6, 0))), /cannot be stood on/)
  assert.throws(() => enterBattle(b, big(92, tileAt(4, 0))), /cannot be stood on/)
  // It falls as one, and leaves all four tiles.
  colossus.hp = 1
  while (!b.over && b.t < 2000 && colossus.hp > 0) stepBattle(b)
  assert.ok(tiles.every((t) => b.at[t] === null), 'off the index on every tile')
})

test('a 2×2 piece blocks the Flank field two wide: a gap it fills is shut, and its fall opens it', () => {
  // Knights across y 3 on lanes 0–4, the Monarch behind them. A knight on (5, 3) leaves a way round through (6, 3); a
  // Colossus anchored there fills both lanes.
  const line = [0, 1, 2, 3, 4].map((x) => on('tomb_knight', 1 + x, 'party', x, 3, 9))
  const build = (piece) => scene([on('monarch', 0, 'party', 3, 0), ...line, piece, on('mantis_reaper', 20, 'foe', 3, 8, 9)])
  const single = build(on('tomb_knight', 6, 'party', 5, 3, 9))
  assert.ok(fieldOf(single, true).dist[tileAt(3, 8)] < Infinity, 'round through (6, 3)')
  const b = build(on('bone_colossus', 6, 'party', 5, 3, 9))
  const flank = fieldOf(b, true)
  for (const t of footprint(tileAt(5, 3), 2)) assert.equal(flank.dist[t], Infinity, 'every tile of it a wall to the Flank field')
  assert.equal(flank.dist[tileAt(3, 8)], Infinity, 'no way round')
  assert.equal(arrowOf(b, b.byUid.get(20)), fieldOf(b).arrow[tileAt(3, 8)], 'so the Flank kind walks the arrows')
  slay(b, b.byUid.get(6))
  assert.ok(fieldOf(b, true).dist[tileAt(3, 8)] < Infinity, 'its fall opens the way')
})

// ── flyers (DESIGN §2.4) ─────────────────────────────────────────────────────────────────────────

test('a flyer flies over the walls straight at the Monarch: each step to the free tile beside it nearest the Monarch, ties in the arrows\' order', () => {
  // A wall across the board at y 5: no road reaches the foes' rows. A Hive Drone at (3, 9) flies down the centre lane,
  // over the wall, to beside the Monarch at (3, 0), and strikes it.
  const walls = [...Array(7).keys()].map((x) => tileAt(x, 5))
  const b = scene([on('monarch', 0, 'party', 3, 0), on('hive_drone', 10, 'foe', 3, 9, 1)], { moving: [10], walls })
  const drone = b.byUid.get(10)
  assert.ok(drone.flies)
  assert.equal(fieldOf(b).dist[drone.tile], Infinity, 'no road for a walker')
  const path = []
  let over = false
  while (!b.over && b.t < 1000 && distance(drone.tile, b.monarch.tile) > drone.ring) {
    const to = flyStep(b, drone)
    for (const e of moves(stepBattle(b), 10)) {
      assert.equal(e.to, to)
      path.push(e.to)
    }
    over ||= b.walls.has(drone.tile)
  }
  assert.deepEqual(path, [8, 7, 6, 5, 4, 3, 2, 1].map((y) => tileAt(3, y)), 'straight down its lane')
  assert.ok(over, 'hovering over the wall on the way')
  while (!b.over && b.t < 1500 && !b.events.some((e) => e.type === 'action' && e.actor === 10)) stepBattle(b)
  assert.ok(b.events.some((e) => e.type === 'action' && e.actor === 10 && e.targets.includes(0)), 'and it strikes the Monarch')
  // Your pieces on the ground never hold it back; with every tile beside it that is nearer held in the air (flyers of
  // yours), it waits.
  const under = scene([on('monarch', 0, 'party', 3, 0), ...[2, 3, 4].map((x) => on('tomb_knight', x, 'party', x, 1)), on('hive_drone', 10, 'foe', 3, 2, 1)])
  assert.equal(flyStep(under, under.byUid.get(10)), tileAt(3, 1))
  const held = scene([on('monarch', 0, 'party', 3, 0), ...[2, 3, 4].map((x) => on('hive_drone', x, 'party', x, 1)), on('hive_drone', 10, 'foe', 3, 2, 1)])
  assert.equal(flyStep(held, held.byUid.get(10)), -1)
  // Your aim at a flyer reads its distance to the Monarch as its road: a Drone hovering over a wall at (2, 4), four from
  // the Monarch, comes before a Ghoul at (5, 5), five along its road.
  const aim = scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 3, 3), on('hive_drone', 10, 'foe', 2, 4, 1), on('grave_ghoul', 11, 'foe', 5, 5, 1)],
    { walls: [tileAt(2, 4)] })
  assert.deepEqual([fieldOf(aim).dist[tileAt(2, 4)], fieldOf(aim).dist[tileAt(5, 5)]], [Infinity, 5])
  assert.equal(ringTarget(aim, aim.byUid.get(1)).uid, 10)
})

test('a melee blow never strikes a flyer, a ranged one does: a ring holding only flyers reads empty to a melee piece', () => {
  // A Hive Drone beside a Tomb Knight of yours and a Frost Sprite, halted by the Sprite's ranged ring.
  const b = scene([on('tomb_knight', 1, 'party', 3, 3, 9), on('frost_sprite', 2, 'party', 4, 3, 9), on('hive_drone', 10, 'foe', 3, 4, 9)])
  const [knight, sprite] = [1, 2].map((uid) => b.byUid.get(uid))
  assert.deepEqual([holdOf(knight).air, holdOf(sprite).air], [-1, 3], 'what each can strike in the air')
  assert.equal(ringTarget(b, knight), null, 'its ring reads empty')
  assert.equal(ringTarget(b, sprite).uid, 10)
  assert.equal(nextCost(b, knight), knight.cheapest, 'it banks as with nothing in reach')
  for (let k = 0; k < 300 && !b.over; k++) stepBattle(b)
  assert.ok(b.events.some((e) => e.type === 'action' && e.actor === 2 && e.targets.includes(10)), 'the ranged blow strikes')
  assert.ok(!b.events.some((e) => e.type === 'action' && e.actor === 1), 'the melee piece never does')
  assert.ok(b.events.some((e) => e.type === 'action' && e.actor === 10 && e.targets.includes(2)), 'the flyer strikes back at the Sprite that shot it')
  assert.ok(!b.events.some((e) => e.type === 'action' && e.actor === 10 && e.targets.includes(1)), 'never at the knight, which never could')
  // With a Ghoul beside the knight too, in the Drone's row, the knight's blows (its Cleave strikes the whole row) fall on
  // the Ghoul alone.
  const both = scene([on('tomb_knight', 1, 'party', 3, 3, 9), on('grave_ghoul', 11, 'foe', 2, 4, 9), on('hive_drone', 10, 'foe', 3, 4, 9)])
  let blows = 0
  while (!both.over && both.t < 600 && blows < 3) {
    for (const e of stepBattle(both)) {
      if (e.type !== 'action' || e.actor !== 1) continue
      assert.deepEqual(e.targets, [11], `${e.ability}`)
      blows++
    }
  }
  assert.equal(blows, 3)
})

test('flyers hold the air: a flyer and a ground unit share a tile and never block each other; two of one layer never share one; the Flank field ignores flyers', () => {
  // A corridor down lane 3 to the Monarch at (3, 0), a Hive Drone of yours hovering in it at (3, 2), a Mantis Reaper
  // walking it (a Flank kind: no ring of yours halts it but the Monarch's).
  const walls = [1, 2, 3, 4, 5, 6].flatMap((y) => [0, 1, 2, 4, 5, 6].map((x) => tileAt(x, y)))
  const b = scene([on('monarch', 0, 'party', 3, 0, 30), on('hive_drone', 1, 'party', 3, 2, 1), on('mantis_reaper', 10, 'foe', 3, 6, 9),
    on('iron_golem', 50, 'foe', 6, 10, 1)], { moving: [10], walls })
  const [drone, mantis] = [1, 10].map((uid) => b.byUid.get(uid))
  assert.deepEqual([b.sky[drone.tile], b.at[drone.tile]], [drone, null], 'the drone in the air index, the ground under it free')
  assert.ok(fieldOf(b, true).dist[mantis.tile] < Infinity, 'no wall to the Flank field')
  // The Mantis walks under the drone and on: its next tile is never held by a flyer.
  let under = false
  while (!b.over && b.t < 600 && !under) {
    stepBattle(b)
    under = mantis.tile === drone.tile
  }
  assert.ok(under, 'the Mantis stands under the drone')
  assert.deepEqual([b.at[drone.tile], b.sky[drone.tile]], [mantis, drone])
  // A foe flyer enters over a foe standing on its tile at the top edge, and flies over your ground pieces.
  const top = deployTile('foe', slotAt(ROWS - 1, 3))
  const sky = scene([on('monarch', 0, 'party', 3, 0), on('iron_golem', 50, 'foe', 3, 10, 1)],
    { reserve: [{ ...makeUnit('hive_drone', { uid: 60, lvl: 1 }), side: 'foe', lane: 3, when: { at: 'time', t: 0 } }] })
  assert.equal(sky.byUid.get(50).tile, top)
  const enter = stepBattle(sky).find((e) => e.type === 'enter')
  assert.deepEqual([enter.unit.uid, enter.unit.tile, sky.at[top]?.uid], [60, top, 50])
  // Two flyers, or two on the ground, never share a tile.
  const flyer = (uid, tile) => ({ ...makeUnit('hive_drone', { uid, lvl: 1 }), side: 'party', tile })
  const ground = (uid, tile) => ({ ...makeUnit('tomb_knight', { uid, lvl: 1 }), side: 'party', tile })
  assert.throws(() => enterBattle(sky, flyer(90, sky.byUid.get(60).tile)), /taken/)
  assert.throws(() => enterBattle(sky, ground(91, top)), /taken/)
  assert.doesNotThrow(() => enterBattle(sky, flyer(92, sky.monarch.tile)))
})

test('a shadow of a flying kind flies: it rises in the air nearest the Monarch, over it, and holds there; melee cannot touch it', () => tuned(FIRST_ARISE, () => {
  // A Hive Drone slain at (2, 2), in the Monarch's domain; a foe Knight beside the Monarch at (3, 1), not stepping.
  // The drone rises in the air over the Monarch's own tile, the nearest to it there is.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('hive_drone', 10, 'foe', 2, 2, 1), on('tomb_knight', 11, 'foe', 3, 1, 9),
    on('iron_golem', 50, 'foe', 6, 10, 1)])
  slay(b, b.byUid.get(10))
  b.monarch.gauge = b.monarch.costliest
  const arise = stepBattle(b).find((e) => e.type === 'arise')
  assert.deepEqual([arise?.corpse, arise?.unit.tile], [10, tileAt(3, 0)])
  const shadow = b.byUid.get(arise.unit.uid)
  assert.ok(shadow.flies && shadow.shadow && shadow.every === Infinity, 'a flyer of yours, holding')
  assert.deepEqual([b.sky[shadow.tile], b.at[shadow.tile]], [shadow, b.monarch])
  const knight = b.byUid.get(11)
  assert.equal(ringTarget(b, knight), b.monarch, 'the Knight aims at the Monarch under it')
  const events = []
  while (!b.over && b.t < 400 && shadow.hp > 0) events.push(...stepBattle(b))
  assert.ok(events.some((e) => e.type === 'action' && e.actor === 11), 'the Knight strikes')
  assert.ok(!events.some((e) => e.type === 'move' && e.actor === shadow.uid), 'it never moves')
  assert.ok(!events.some((e) => e.type === 'action' && e.actor === 11 && e.targets.includes(shadow.uid)), 'no melee blow at it')
}))

// ── statuses the foes bring, and death bursts (DESIGN §2.4) ──────────────────────────────────────

test('Burning: each tick interval its holder takes power true damage a stack, dealt by whoever laid it, up to 3 stacks, until it ends; no blow', () => {
  // Three Pyre Hounds bite the Monarch (it never strikes back); a golem far off keeps the battle going.
  const def = statusDef('burning')
  const power = def.tick[0].power
  const b = scene([on('monarch', 0, 'party', 3, 3, 30), ...[2, 3, 4].map((x, i) => on('pyre_hound', 10 + i, 'foe', x, 4, 3)), on('iron_golem', 50, 'foe', 6, 10, 1)],
    { relics: ['arise', 'hourglass'] })
  const m = b.monarch
  const burning = () => m.statuses.find((s) => s.id === 'burning')
  let most = 0
  let ticks = 0
  while (!b.over && b.t < 2000 && most < def.stacks) {
    const stacks = burning()?.stacks ?? 0
    const age = burning()?.age ?? 0
    for (const e of stepBattle(b)) {
      if (e.type !== 'damage' || e.status !== 'burning') continue
      // True damage: no roll, no DEF, no crit, no escalation.
      assert.deepEqual([e.target, e.damage, e.isCrit, e.ability], [0, power * stacks, false, null])
      assert.ok([10, 11, 12].includes(e.actor), 'dealt by a hound')
      assert.equal((age + 1) % def.tickEvery, 0, 'on its interval')
      most = Math.max(most, stacks)
      ticks++
    }
    assert.ok((burning()?.stacks ?? 0) <= def.stacks)
  }
  assert.equal(most, def.stacks, `${ticks} ticks`)
  // The hounds slain, their fire burns on, strikes no moment (Hourglass fires when the Monarch is struck), and ends.
  for (const uid of [10, 11, 12]) slay(b, b.byUid.get(uid))
  const from = b.events.length
  while (!b.over && b.t < 4000 && burning()) stepBattle(b)
  for (let k = 0; k < 3 * def.tickEvery; k++) stepBattle(b)
  const after = b.events.slice(from)
  const burns = after.filter((e) => e.type === 'damage' && e.status === 'burning')
  assert.ok(burns.length > 0 && burns.every((e) => [10, 11, 12].includes(e.actor)), 'a fallen hound\'s fire')
  const end = after.find((e) => e.type === 'expire' && e.target === 0 && e.status === 'burning')
  assert.ok(end && burns.every((e) => e.t <= end.t), 'it ends, and burns no more')
  assert.ok(!after.some((e) => e.type === 'trigger'), 'a burn is no blow')
})

test('a death burst: a Rot Bloat falling Withers the other side\'s living within 1 of where it fell, and no one else', () => {
  // A Bloat at (3, 4) on its last HP: a knight of yours beside it at (3, 3), a Sprite at (4, 5), a Chanter three tiles off
  // at (3, 1); a Ghoul of its own side beside it at (2, 5).
  const b = scene([on('tomb_knight', 1, 'party', 3, 3, 9), on('frost_sprite', 2, 'party', 4, 5), on('bone_chanter', 3, 'party', 3, 1),
    on('rot_bloat', 10, 'foe', 3, 4, 1), on('grave_ghoul', 11, 'foe', 2, 5, 1), on('iron_golem', 50, 'foe', 6, 10, 1)])
  b.byUid.get(10).hp = 1
  b.byUid.get(1).gauge = b.byUid.get(1).costliest
  while (!b.over && b.t < 600 && b.byUid.get(10).hp > 0) stepBattle(b)
  const death = b.events.findIndex((e) => e.type === 'death' && e.target === 10)
  const burst = b.events[death + 1]
  assert.deepEqual([burst.type, burst.actor, burst.tile, burst.targets.slice().sort()], ['burst', 10, tileAt(3, 4), [1, 2]])
  const withered = b.events.slice(death).filter((e) => e.type === 'status' && e.status === 'withered' && e.t === burst.t).map((e) => e.target)
  assert.deepEqual(withered.sort(), [1, 2])
  for (const uid of [1, 2]) assert.ok(b.byUid.get(uid).statuses.some((s) => s.id === 'withered'))
  for (const uid of [3, 11]) assert.ok(!b.byUid.get(uid).statuses.some((s) => s.id === 'withered'))
})
