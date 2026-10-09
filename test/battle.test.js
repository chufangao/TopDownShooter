import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, stepBattle, runBattle, timelineHash, stats, enterBattle, nextCost, isEngaged, foesNextTo, auraGivers, falters, escalation } from '../src/sim/battle.js'
import { TUNING } from '../src/tuning.js'
import { tuned, FIRST_ARISE } from './tuned.js'
import {
  makeUnit, autoPlace, distance, slotAt, campGrid, wallTiles, steps, costliestOf, abilitiesOf, deployTile, tileAt, tileX, tileY, baseStats, DEPTH, alive,
  isEngaged as listEngaged, foesNextTo as listFoesNextTo, auraGivers as listAuraGivers
} from '../src/sim/unit.js'
import { createRng } from '../src/sim/rng.js'
import { UNIT_LIST, unitDef, abilityDef, ROLES, BEHAVIOURS, CAMP_LIST } from '../src/content.js'
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

// In one of the floor's camps, picked by seed, walls and all, against that encounter. `tune` may edit
// the party before it fights; with `monarch`, the Monarch stands among them (mid-camp, its role's row)
// with `will` Will; with `army`, the first soul has that many summons (Bone Chanters and Ghouls) on the field
// and as many Ghouls again waiting in the battle's reserve. With `orders`, every soul takes a plan drawn on the
// seed (Hunt, Stay, or Move to an open tile anywhere on the board; a summon its summoner's), and the second soul
// is held back for a later start (a time, the Monarch struck, one fallen).
const fresh = (seed, floor = 1, { ids = START, tune = () => {}, monarch = false, will = 0, army = 0, orders = false } = {}) => {
  const { foes, boss } = encounter(seed, floor)
  const camp = createRng(seed).stream('camp').pick(CAMP_LIST.filter((c) => c.floor === floor)).id
  const party = team(monarch ? [...ids, 'monarch'] : ids, { lvl: 1 + floor, camp })
  const walls = wallTiles(camp)
  const rng = createRng(seed).stream('orders')
  if (orders) {
    party.forEach((u, k) => {
      if (u.id === 'monarch') return
      const where = rng.pick(['hunt', 'stay', 'move'])
      const square = where === 'move' ? rng.pick([...Array(DEPTH * 7).keys()].filter((t) => !walls.includes(t))) : null
      Object.assign(u, { det: k + 1, plan: { where, square } })
    })
  }
  const body = (id, uid) => ({ ...makeUnit(id, { uid, lvl: 1 + floor }), cohortOf: party[0].uid, rank: true, ...(orders && { det: 1, plan: party[0].plan }) })
  const summon = (id, uid) => ({ ...makeUnit(id, { uid, lvl: 1 + floor }), cohortOf: party[0].uid, summoned: true, summoner: party[0].uid, ...(orders && { det: 1, plan: party[0].plan }) })
  const members = Array.from({ length: army }, (_, k) => summon(k % 2 ? 'grave_ghoul' : 'bone_chanter', 60 + k))
  autoPlace([...party, ...members], { grid: campGrid(camp) })
  const reserve = Array.from({ length: army }, (_, k) => body('grave_ghoul', 80 + k))
  tune(party)
  const held = orders ? party.splice(1, 1).map((u) => ({ ...u, slot: -1, when: rng.pick([{ at: 'time', t: 60 }, { at: 'struck' }, { at: 'falls' }]) })) : []
  return createBattle({ party: [...party, ...members], foes, seed, floor, boss, walls, will, reserve: [...held, ...reserve] })
}

// With the board holding only `n` bodies, so that a reserve enters mid-battle.
function boardOf (n, fn) {
  const was = TUNING.army.board
  TUNING.army.board = n
  try {
    return fn()
  } finally {
    TUNING.army.board = was
  }
}

// Lays a unit dead where it stands, as a blow would (the index, the roster).
function slay (b, u) {
  u.hp = 0
  u.statuses = []
  b.at[u.tile] = null
  b.roster++
  b.paths.clear()
}

// A unit placed on a board tile directly, for battles built tile by tile.
const on = (id, uid, side, x, y, lvl = 3) => ({ ...makeUnit(id, { uid, lvl }), side, tile: tileAt(x, y) })

// A battle of units placed on tiles: party and foes are made with `on`, the party in its camp (y 0–6).
// A foe may stand anywhere: it deploys in a spare slot of its formation and is moved there. The ones not
// named in `moving` never step (so a scene stays put).
function scene (units, { moving = [], ...opts } = {}) {
  const foeRow0 = DEPTH - 3
  const spare = [...Array(21).keys()].filter((slot) => !units.some((u) => u.side === 'foe' && tileY(u.tile) >= foeRow0 && slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) === slot))
  const slot = (u) => u.side === 'party' ? slotAt(6 - tileY(u.tile), tileX(u.tile))
    : tileY(u.tile) >= foeRow0 ? slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) : spare.shift()
  const placed = units.map((u) => ({ ...u, slot: slot(u) }))
  const b = createBattle({ party: placed.filter((u) => u.side === 'party'), foes: placed.filter((u) => u.side === 'foe'), seed: 'scene', ...opts })
  for (const u of b.units) {
    const want = units.find((x) => x.uid === u.uid).tile
    if (u.tile !== want) {
      b.at[u.tile] = null
      u.tile = want
      u.anchor = want
      b.at[want] = u
    }
    if (!moving.includes(u.uid)) u.nextStep = Infinity
  }
  return b
}

// Plain, and with plans: a Monarch, summons, every soul on a plan and one held for a later start.
const PLANNED = { orders: true, army: 3, monarch: true }

test('the same seed gives the same timeline; a different seed does not', () => {
  for (const opts of [{}, PLANNED]) {
    const a = runBattle(fresh('det', 1, opts))
    const b = runBattle(fresh('det', 1, opts))
    assert.equal(a.hash, b.hash)
    assert.equal(a.hash, timelineHash(b.events))
    assert.notEqual(a.hash, runBattle(fresh('det2', 1, opts)).hash)
  }
})

test('stepping tick by tick equals runBattle', () => {
  for (const opts of [{}, PLANNED]) {
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

test('300 seeded battles across floors end before the ceiling with sane HP', () => {
  for (let i = 0; i < 300; i++) {
    const floor = 1 + (i % 4)
    const b = fresh('fuzz' + i, floor)
    const r = runBattle(b)
    assert.ok(r.ticks < TUNING.tick.ceiling, `seed ${i} reached the ceiling`)
    assert.ok(r.winner === 'party' || r.winner === 'foe')
    for (const u of b.units) {
      assert.ok(Number.isInteger(u.hp) && u.hp >= 0 && u.hp <= u.maxHp, `seed ${i}: ${u.id} hp ${u.hp}`)
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
  assert.deepEqual(b.units.filter((u) => u.side === 'party').map((u) => u.uid), [1, 2])
})

test('units step at most once per step clock, onto a free tile; only a flanker hops bodies; the engaged hold unless they slip', () => boardOf(5, () => {
  let moves = 0
  let flanks = 0
  let entries = 0
  for (let i = 0; i < 60; i++) {
    const b = fresh('walk' + i, 1 + (i % 4), { monarch: i % 3 === 0, will: i % 2, army: i % 4 === 1 ? 3 : 0, orders: i % 5 === 2 })
    const tile = new Map(b.units.map((u) => [u.uid, u.tile]))
    const last = new Map()
    const dead = new Set()
    const holder = (t) => b.units.find((x) => !dead.has(x.uid) && tile.get(x.uid) === t)
    const engaged = (u) => b.units.some((e) => e.side !== u.side && !dead.has(e.uid) && distance(tile.get(e.uid), tile.get(u.uid)) === 1)
    while (!b.over) {
      for (const e of stepBattle(b)) {
        if (e.type === 'death') dead.add(e.target)
        if (e.type === 'arise' || e.type === 'enter') {
          assert.ok(!holder(e.unit.tile) && !b.walls.has(e.unit.tile), `seed ${i} t ${e.t}: ${e.type} on a body or a wall`)
          tile.set(e.unit.uid, e.unit.tile)
          if (e.type === 'enter') entries++
        }
        if (e.type !== 'move') continue
        const u = b.units.find((x) => x.uid === e.actor)
        const where = `seed ${i} t ${e.t}: ${u.id} ${e.from}→${e.to}`
        assert.ok(u !== b.monarch, `${where}: the Monarch stepped`)
        assert.equal(tile.get(u.uid), e.from)
        assert.ok(!last.has(u.uid) || e.t - last.get(u.uid) >= TUNING.board.stepTicks, `${where}: stepped again too soon`)
        last.set(u.uid, e.t)
        const slips = BEHAVIOURS[ROLES[unitDef(u.id).role].move].slips
        assert.ok(slips || !engaged(u), `${where}: walked away while engaged`)
        assert.ok(slips || !e.via, `${where}: only a flanker passes through bodies`)
        // A step, or a hop: a chain of steps through the living to the first open tile.
        const chain = [e.from, ...(e.via ?? []), e.to]
        for (let k = 1; k < chain.length; k++) assert.ok(steps(chain[k - 1], b.walls).includes(chain[k]), `${where}: into or past a wall`)
        for (const t of e.via ?? []) assert.ok(holder(t), `${where}: hopped over an empty tile ${t}`)
        assert.ok(!holder(e.to), `${where}: onto a body`)
        tile.set(u.uid, e.to)
        const held = b.units.filter((x) => !dead.has(x.uid)).map((x) => tile.get(x.uid))
        assert.equal(new Set(held).size, held.length, `${where}: two units on one tile`)
        moves++
        if (slips) flanks++
      }
    }
  }
  assert.ok(moves > 0 && flanks > 0 && entries > 0, `${moves} moves, ${flanks} by flankers, ${entries} entries`)
}))

test('a step costs no gauge: a walker steps every stepTicks while its gauge keeps filling', () => {
  const party = [makeUnit('tomb_knight', { uid: 1, lvl: 3, slot: slotAt(6, 3) })]
  const foes = [makeUnit('tomb_knight', { uid: 10, lvl: 3, slot: slotAt(2, 3) })]
  const b = createBattle({ party, foes, seed: 'clock' })
  const knight = b.units.find((u) => u.uid === 1)
  const foe = b.units.find((u) => u.uid === 10)
  foe.nextStep = Infinity
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
    steps.push(...events.filter((e) => e.type === 'move' && e.actor === 1).map((e) => e.t))
    assert.ok(knight.gauge >= gauge, `t ${b.t}: the gauge fell from ${gauge} to ${knight.gauge}`)
    gauge = knight.gauge
  }
  assert.ok(steps.length >= 4, `${steps}`)
  assert.deepEqual(steps, steps.map((_, k) => k * TUNING.board.stepTicks), 'one step per clock, from the first tick')
})

test('a flanker hops through walls of bodies, theirs and its own, and never shares a tile', () => {
  // A Clockwork Page on the camp's back row; its own line two rows ahead of it, all seven lanes; the
  // foes' line in front of its quarry, all seven lanes. Everyone but the Page stands still.
  const line = (row, uid) => Array.from({ length: 7 }, (_, c) => makeUnit('tomb_knight', { uid: uid + c, lvl: 1, slot: slotAt(row, c) }))
  const b = createBattle({
    party: [makeUnit('clockwork_page', { uid: 1, lvl: 10, slot: slotAt(6, 3) }), ...line(4, 2)],
    foes: [...line(0, 20), makeUnit('tomb_knight', { uid: 30, lvl: 1, slot: slotAt(2, 3) })],
    seed: 'hop'
  })
  const page = b.units.find((u) => u.uid === 1)
  const quarry = b.units.find((u) => u.uid === 30)
  for (const u of b.units) if (u !== page) u.nextStep = Infinity
  const hops = []
  while (!b.over && page.hp > 0 && distance(page.tile, quarry.tile) > 1) {
    const events = stepBattle(b)
    hops.push(...events.filter((e) => e.type === 'move' && e.actor === 1 && e.via))
    // With a way to its quarry it has eyes for nothing else: it waits out its step beside the foes'
    // line, gauge and all, and strikes none of it.
    assert.ok(!events.some((e) => e.type === 'action' && e.actor === 1), `t ${b.t}: the Page struck on its way`)
    const living = b.units.filter((u) => u.hp > 0)
    assert.equal(new Set(living.map((u) => u.tile)).size, living.length, `t ${b.t}: two units on one tile`)
  }
  assert.ok(page.hp > 0 && distance(page.tile, quarry.tile) <= 1, 'the Page reached its quarry')
  assert.equal(hops.length, 2, 'one hop over each line')
  assert.deepEqual(hops.map((e) => e.via.length), [1, 1])
})

test('a braced line holds flankers: a foe flanker cannot vault a unit on Stay at its post, and is engaged beside one', () => {
  // A foe Clockwork Page; the party's line two rows ahead of its quarry, all seven lanes, on Stay (braced) or on
  // Hunt; its quarry, a Tomb Knight, behind the line. Nobody but the Page moves.
  const run = (where, hold = true) => tuned({ orders: { holdFlank: hold } }, () => {
    const line = Array.from({ length: 7 }, (_, c) => ({ ...makeUnit('tomb_knight', { uid: 2 + c, lvl: 10, slot: slotAt(4, c) }), plan: { where, square: null } }))
    const b = createBattle({
      party: [makeUnit('tomb_knight', { uid: 1, lvl: 1, slot: slotAt(6, 3) }), ...line],
      foes: [makeUnit('clockwork_page', { uid: 30, lvl: 10, slot: slotAt(0, 3) })],
      seed: 'hold'
    })
    const page = b.units.find((u) => u.uid === 30)
    const quarry = b.units.find((u) => u.uid === 1)
    for (const u of b.units) if (u !== page) u.nextStep = Infinity
    while (!b.over && page.hp > 0 && b.t < 300 && distance(page.tile, quarry.tile) > 1) stepBattle(b)
    return distance(page.tile, quarry.tile) <= 1
  })
  assert.ok(run('hunt'), 'it vaults a line on Hunt')
  assert.ok(run('stay', false), 'and a braced one without the rule')
  assert.ok(!run('stay'), 'a braced line holds it')
})

test('a flanker whose quarry is sealed off fights what is in reach, through its own line if need be', () => {
  // The quarry, a Tomb Knight in the foes' back corner, has a knight on every tile around it. A lone
  // foe knight stands in the front centre lane; the Page starts behind its own front line, which it has
  // to pass to get there. Nobody but the Page moves.
  const run = (screen) => {
    const party = [makeUnit('clockwork_page', { uid: 1, lvl: 5, slot: slotAt(screen ? 1 : 0, 3) })]
    if (screen) party.push(...[2, 3, 4].map((c, k) => makeUnit('tomb_knight', { uid: 2 + k, lvl: 1, slot: slotAt(0, c) })))
    const foes = [[2, 0], [2, 1], [1, 0], [1, 1]].map(([r, c], k) => makeUnit('tomb_knight', { uid: 20 + k, lvl: 1, slot: slotAt(r, c) }))
    foes.push(makeUnit('tomb_knight', { uid: 24, lvl: 5, slot: slotAt(0, 3) }))
    const b = createBattle({ party, foes, seed: 'sealed' })
    const page = b.units.find((u) => u.uid === 1)
    for (const u of b.units) if (u !== page) u.nextStep = Infinity
    const events = []
    while (!b.over && b.t < 400 && !events.some((e) => e.type === 'action' && e.actor === 1)) events.push(...stepBattle(b))
    assert.equal(page.quarry, 20, 'the quarry is the deepest foe')
    const strike = events.find((e) => e.type === 'action' && e.actor === 1)
    assert.ok(strike, 'the Page struck')
    assert.deepEqual(strike.targets, [24], 'at the foe it could reach')
    return events.filter((e) => e.type === 'move' && e.actor === 1)
  }
  run(false)
  assert.ok(run(true).some((e) => e.via), 'it hopped its own line on the way')
})

test('gauge never banks past the costliest ability, the tile index matches the living, and caches are never stale', () => {
  let wide = 0
  for (let i = 0; i < 40; i++) {
    // Half the battles bring a Tomb Knight whose Bulwark aura reaches 2 tiles, the widest on the board.
    const bulwark = (party) => Object.assign(party.find((u) => u.id === 'tomb_knight'), { path: 'bulwark', tier: 3 })
    const b = boardOf(5, () => fresh('index' + i, 1 + (i % 4), i % 2 ? { monarch: true, will: 1, army: i % 4 === 3 ? 3 : 0, orders: i % 8 === 1 } : { ids: [...START, 'tomb_knight', 'bone_chanter'], tune: bulwark }))
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
        assert.equal(isEngaged(b, u), listEngaged(b.units, u))
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
  const tile = b.at.findIndex((u, t) => u === null && !b.walls.has(t))
  const u = enterBattle(b, { ...makeUnit('frost_sprite', { uid: 99, lvl: 3 }), side: 'party', tile })
  assert.equal(b.at[tile], u)
  assert.equal(b.roster, roster + 1)
  assert.deepEqual([u.gauge, u.nextStep, u.statuses], [0, b.t, []])
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

test('a Tomb Knight shields the allies next to it; bonds are set at the start and announced', () => {
  const soul = (id, uid, row, col) => makeUnit(id, { uid, slot: slotAt(row, col), lvl: 3 })
  const party = [soul('tomb_knight', 1, 0, 3), soul('frost_sprite', 2, 1, 4), soul('bone_chanter', 3, 2, 0), soul('tomb_knight', 4, 0, 2)]
  const b = createBattle({ party, foes: [soul('clockwork_page', 10, 2, 3)], seed: 'aura' })
  const unit = (uid) => b.units.find((u) => u.uid === uid)
  assert.equal(stats(b, unit(2)).damage.taken, 0.85, 'next to a knight')
  assert.equal(stats(b, unit(3)).damage.taken, 1, 'three lanes away')
  assert.equal(stats(b, unit(1)).damage.taken, 0.85, "the other knight's aura, not its own")
  assert.ok(Math.abs(stats(b, unit(1)).def / stats(b, { ...unit(3), uid: 99, id: 'tomb_knight', lvl: 3, tile: unit(3).tile }).def - 1.2) < 1e-9, 'Phalanx: +20% DEF')
  const start = b.events[0]
  assert.deepEqual(start.bonds.filter((x) => x.id === 'phalanx').map((x) => x.uid).sort(), [1, 4])
  // Walking apart does not break a bond: it was set by the formation.
  b.at[unit(4).tile] = null
  unit(4).tile = unit(3).tile + 1
  b.at[unit(4).tile] = unit(4)
  b.cache.clear()
  assert.ok(stats(b, unit(1)).def > stats(b, { ...unit(1), uid: 98 }).def)
})

test('path tiers fight: a self heal mends the user, and a `who` mod touches only souls it names', () => {
  const ghoul = { ...makeUnit('grave_ghoul', { uid: 1, lvl: 6, slot: slotAt(0, 3) }), path: 'glutton', tier: 3 }
  ghoul.hp = Math.round(ghoul.maxHp / 2)
  const b = createBattle({ party: [ghoul], foes: team(['iron_golem'], { side: 'foe', lvl: 6 }), seed: 'devour' })
  runBattle(b)
  const devours = b.events.filter((e) => e.type === 'action' && e.ability === 'devour')
  assert.ok(devours.length > 0)
  assert.ok(b.events.some((e) => e.type === 'heal' && e.actor === 1 && e.target === 1), 'Devour heals its user')

  const vanguardsOnly = [{ path: 'def', op: 'mul', v: 2, who: { role: ['vanguard'] } }]
  const knight = makeUnit('tomb_knight', { uid: 2 })
  const sprite = makeUnit('frost_sprite', { uid: 3 })
  const field = createBattle({ party: autoPlace([knight, sprite]), foes: team(['clockwork_page'], { side: 'foe' }), seed: 'who', partyMods: vanguardsOnly })
  const of = (id) => stats(field, field.units.find((u) => u.id === id)).def
  assert.equal(of('tomb_knight'), 2 * unitDef('tomb_knight').base.def)
  assert.equal(of('frost_sprite'), unitDef('frost_sprite').base.def)
})

// ── the Monarch ──────────────────────────────────────────────────────────────────────────────────

test('the Monarch stands where it is put, never strikes, and banks for Arise while no corpse is in reach', () => {
  // A Monarch behind a lone knight; the foes stand off at the far end, out of everyone's reach.
  const b = scene([on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 3, 5), on('frost_sprite', 10, 'foe', 3, 10)], { moving: [0] })
  const m = b.monarch
  assert.equal(m.uid, 0)
  for (let k = 0; k < 200; k++) {
    for (const e of stepBattle(b)) assert.ok(e.actor !== 0, `t ${e.t}: the Monarch did ${e.type}`)
    assert.ok(m.gauge <= 200)
  }
  assert.equal(m.tile, tileAt(3, 2), 'it never stepped')
  assert.equal(m.gauge, 200, 'Arise is banked, and no more')
  assert.equal(nextCost(b, m), 200)
})

test('Arise raises the strongest corpse in the domain, then the nearest, as a shadow at half HP where it fell', () => tuned(FIRST_ARISE, () => {
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
  const { action, arise, events } = rise(b)
  assert.deepEqual([action.ability, action.targets], ['arise', [11]])
  const ghoul = b.units.find((u) => u.uid === 11)
  const max = baseStats('grave_ghoul', 2).hp
  assert.deepEqual(arise, {
    t: 0, type: 'arise', actor: 0, corpse: 11,
    unit: { uid: nextUid, id: 'grave_ghoul', side: 'party', tile: ghoul.tile, lvl: 2, hp: Math.ceil(max / 2), maxHp: max, shadow: true }
  })
  const shadow = b.units.find((u) => u.uid === nextUid)
  // It rose on the corpse's tile (and may already have taken a step: it acts the tick it enters).
  assert.ok(ghoul.raised && shadow.shadow && b.at[shadow.tile] === shadow)
  assert.deepEqual([b.roster, b.nextUid, b.raised], [roster + 1, nextUid + 1, 1])
  assert.ok(events.some((e) => e.type === 'falter' && e.target === nextUid && e.on), 'a shadow always falters')
  assert.ok(falters(b, shadow))
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

test('Arise by the numbers: raises × (1 + Will) a battle, of tier raiseTier + Will, at raiseHp of max HP; its shadows falter only outside the domain', () => {
  const { raises, raiseTier, raiseHp } = TUNING.monarch
  assert.equal(TUNING.monarch.shadowFalter, false)
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
      assert.equal(e.unit.hp, Math.ceil(e.unit.maxHp * raiseHp))
      // It falters as a soul on its tile would: inside the domain, not at all.
      const shadow = b.units.find((u) => u.uid === e.unit.uid)
      if (distance(shadow.tile, b.monarch.tile) <= b.domain) assert.ok(!falters(b, shadow), 'inside the domain: no falter')
    }
  }
})

test('shadows falter, count for synergies, and hold the bonds of where they rise', () => tuned(FIRST_ARISE, () => {
  // A Grave Ghoul corpse lies beside a party Grave Ghoul (same board row, next lane), inside the domain.
  const b = scene([
    on('monarch', 0, 'party', 3, 1), on('grave_ghoul', 1, 'party', 2, 3),
    on('grave_ghoul', 10, 'foe', 3, 3, 3), on('iron_golem', 11, 'foe', 6, 10, 1)
  ])
  const ghoul = b.units.find((u) => u.uid === 1)
  const before = stats(b, ghoul)
  slay(b, b.units.find((u) => u.uid === 10))
  b.monarch.gauge = 200
  stepBattle(b)
  const shadow = b.units.find((u) => u.shadow)
  assert.ok(shadow, 'it rose')
  // Undead 2 and Vanguard 2 now, for both: the shadow counts.
  assert.ok(stats(b, ghoul).def > before.def, 'the shadow made a synergy')
  // Phalanx and Kinship, held by the shadow (with the ghoul as partner); the ghoul's own are unchanged.
  const held = b.bonds.filter((x) => x.uid === shadow.uid).map((x) => x.bond.id).sort()
  assert.deepEqual(held, ['kinship', 'phalanx'])
  assert.ok(b.bonds.filter((x) => x.uid === shadow.uid).every((x) => x.partner === 1))
  assert.ok(!b.bonds.some((x) => x.uid === 1), 'those already there keep theirs')
  // It falters wherever it stands; the ghoul beside it, inside the domain, does not.
  assert.ok(falters(b, shadow) && !falters(b, ghoul))
  const dealt = stats(b, shadow).damage.dealt
  const tile = shadow.tile
  shadow.tile = ghoul.tile + 1 // were it not a shadow, here it would stand inside the domain
  shadow.shadow = false
  assert.ok(!falters(b, shadow))
  assert.ok(Math.abs(dealt / stats(b, shadow).damage.dealt - TUNING.monarch.falter) < 1e-9)
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

test('a party unit outside the domain falters, announced as it walks out; foes, the Monarch and battles without one never do', () => {
  // The Monarch at (3, 2); a knight walks up its lane toward a foe frozen at the far edge. It leaves the
  // domain (3 tiles) on the step to y 6.
  const b = scene([on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 3, 4), on('tomb_knight', 10, 'foe', 3, 10)], { moving: [1] })
  const knight = b.units.find((u) => u.uid === 1)
  const foe = b.units.find((u) => u.uid === 10)
  const events = []
  while (distance(knight.tile, foe.tile) > 1) events.push(...stepBattle(b))
  const marks = events.filter((e) => e.type === 'falter')
  assert.deepEqual(marks.map((e) => [e.target, e.on]), [[1, true]], 'one change, when it stepped out')
  const out = events.find((e) => e.type === 'move' && e.actor === 1 && distance(e.to, b.monarch.tile) > b.domain)
  assert.equal(out.t, marks[0].t)
  assert.equal(tileY(out.to) - tileY(b.monarch.tile), b.domain + 1)
  assert.ok(Math.abs(stats(b, knight).damage.dealt - TUNING.monarch.falter) < 1e-9)
  assert.ok(!falters(b, foe) && !falters(b, b.monarch))
  assert.equal(stats(b, foe).damage.dealt, 1)
  // A wider domain holds it.
  const wide = scene([on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 3, 4), on('tomb_knight', 10, 'foe', 3, 10)], { moving: [1], domain: 7 })
  while (!wide.over && wide.t < 200) stepBattle(wide)
  assert.ok(!wide.events.some((e) => e.type === 'falter'))
  // A soul placed outside is announced at the start, right after battle:start; no one else is.
  const placed = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 5), on('tomb_knight', 10, 'foe', 3, 10)])
  assert.deepEqual(placed.events.slice(0, 2).map((e) => e.type), ['battle:start', 'falter'])
  assert.deepEqual(placed.events[1], { t: 0, type: 'falter', target: 1, on: true })
  assert.ok(!placed.events.some((e) => e.type === 'falter' && e.target !== 1))
  // No Monarch, no domain.
  const none = scene([on('tomb_knight', 1, 'party', 3, 0), on('tomb_knight', 10, 'foe', 3, 10)])
  assert.ok(!falters(none, none.units[0]) && !none.events.some((e) => e.type === 'falter'))
})

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
  // Past the reserve's too: a shadow never takes the uid of a body still to enter.
  const reserve = [{ ...makeUnit('grave_ghoul', { uid: 60, lvl: 3 }), cohortOf: 7, rank: true }]
  assert.equal(scene(units, { reserve }).nextUid, 61)
})

// ── the army ─────────────────────────────────────────────────────────────────────────────────────

// A summon of `captain`'s on a tile (as battle.js summon makes them: on its leash). A unit waiting in the
// battle's reserve on a leash (`waiting`) is the battle's generic reserve rule; the run fills it with held souls.
const member = (id, uid, captain, x, y, lvl = 3) => ({ ...on(id, uid, 'party', x, y, lvl), cohortOf: captain, summoned: true, summoner: captain })
const waiting = (id, uid, captain, lvl = 3) => ({ ...makeUnit(id, { uid, lvl }), cohortOf: captain, rank: true })

test('the reserve enters beside the Monarch, one a tick, once fewer than 14 bodies stand (a board of 14); each entry restarts the escalation clock', () => boardOf(14, () => {
  // The Monarch at (3,1); fourteen knights in rows 3 and 4 (the captain, uid 4, at (3,3)); three ghouls of
  // its cohort in reserve. Row 3 stays full, so no one has a way to walk anywhere.
  const knights = [...Array(14).keys()].map((k) => on('tomb_knight', k + 1, 'party', k % 7, 3 + Math.floor(k / 7)))
  const reserve = [waiting('grave_ghoul', 30, 4), waiting('grave_ghoul', 31, 4), waiting('grave_ghoul', 32, 4)]
  const b = scene([on('monarch', 0, 'party', 3, 1), ...knights, on('iron_golem', 50, 'foe', 3, 10)], { reserve })
  assert.deepEqual(b.events[0].reserve, [30, 31, 32].map((uid) => ({ uid, id: 'grave_ghoul', lvl: 3, rank: true, cohortOf: 4 })))
  for (let k = 0; k < 5; k++) assert.ok(!stepBattle(b).some((e) => e.type === 'enter'), 'fourteen bodies: no room')
  // (Early enough that an entry restarts the ramp in full: see the ceiling test in enemy.test.js.)
  b.t = 1000
  assert.ok(escalation(b) > 1, 'blows have ramped')
  for (const uid of [8, 9, 10]) slay(b, b.units.find((u) => u.uid === uid))
  // Three fell at once: one enters a tick, ahead of the Monarch first (the middle lane, then the lower
  // tile), the newcomer last in the turn order, the roster bumped, the clock restarted.
  const entered = []
  for (let k = 0; k < 4; k++) {
    const roster = b.roster
    const events = stepBattle(b)
    const e = events.filter((x) => x.type === 'enter')
    if (k === 3) {
      assert.deepEqual(e, [], 'the reserve is spent')
      break
    }
    assert.equal(e.length, 1, `tick ${b.t - 1}: one a tick`)
    entered.push(e[0])
    assert.equal(b.roster, roster + 1)
    assert.equal(b.entered, b.t - 1)
    assert.equal(escalation(b), 1, 'escalation counts from the last entry')
    assert.equal(b.units.at(-1).uid, e[0].unit.uid)
  }
  // Its max HP is fitted as it enters: Undead 4 and 6 (the knights and it) add 5% and 10%.
  const ghoul = Math.round(baseStats('grave_ghoul', 3).hp * 1.05 * 1.1)
  assert.deepEqual(entered.map((e) => [e.t, e.unit]), [[0, tileAt(3, 2), 30], [1, tileAt(2, 2), 31], [2, tileAt(4, 2), 32]].map(([dt, tile, uid]) =>
    [1000 + dt, { uid, id: 'grave_ghoul', side: 'party', tile, lvl: 3, hp: ghoul, maxHp: ghoul, rank: true, cohortOf: 4 }]))
  assert.ok(entered.every((e) => b.at[e.unit.tile]?.uid === e.unit.uid), 'on the index, where they entered')
  assert.ok(!entered.some((e) => falters(b, b.units.find((u) => u.uid === e.unit.uid))), 'inside the domain, captain standing')
  // With room on the board from the start, the reserve enters at once, a tick apiece.
  const thin = scene([on('monarch', 0, 'party', 3, 1), on('tomb_knight', 1, 'party', 3, 4), on('iron_golem', 50, 'foe', 3, 10)],
    { reserve: [waiting('grave_ghoul', 30, 1), waiting('grave_ghoul', 31, 1)] })
  assert.deepEqual([stepBattle(thin), stepBattle(thin)].map((ev) => ev.filter((e) => e.type === 'enter').map((e) => [e.t, e.unit.uid])), [[[0, 30]], [[1, 31]]])
  // A body whose captain is gone enters faltering. With no Monarch it enters at the rear centre, and a
  // party with bodies still to enter is not wiped.
  const lone = scene([on('tomb_knight', 1, 'party', 0, 4), on('iron_golem', 50, 'foe', 3, 10)], { reserve: [waiting('grave_ghoul', 30, 99)] })
  slay(lone, lone.units.find((u) => u.uid === 1))
  lone.reserve.push(waiting('grave_ghoul', 31, 99))
  const ev = stepBattle(lone)
  assert.ok(!lone.over, 'bodies still in reserve')
  const e = ev.find((x) => x.type === 'enter')
  assert.equal(e.unit.tile, tileAt(3, 0))
  assert.ok(ev.some((x) => x.type === 'falter' && x.target === 30 && x.on), 'its captain is gone: it falters')
  assert.ok(lone.units.find((u) => u.uid === 30).orphan)
  // A member on the board from the start whose captain never took the field is an orphan from the
  // start, announced at t 0.
  const astray = scene([on('monarch', 0, 'party', 3, 1), member('grave_ghoul', 2, 99, 3, 2), on('iron_golem', 50, 'foe', 3, 10)])
  assert.ok(astray.units.find((u) => u.uid === 2).orphan)
  assert.deepEqual(astray.events.filter((x) => x.type === 'falter'), [{ t: 0, type: 'falter', target: 2, on: true }])
}))

test('an Arise shadow stands past the board\'s cap: it holds back no reserve body', () => boardOf(14, () => {
  // Thirteen knights in rows 4 and 5, the Monarch at (3,1) with Arise ready, a slain Tomb Knight at its feet.
  const knights = [...Array(13).keys()].map((k) => on('tomb_knight', k + 1, 'party', k % 7, 4 + Math.floor(k / 7)))
  const b = scene([on('monarch', 0, 'party', 3, 1), ...knights, on('tomb_knight', 40, 'foe', 3, 2, 1), on('iron_golem', 50, 'foe', 3, 10)], { will: 1 })
  slay(b, b.units.find((u) => u.uid === 40))
  b.monarch.gauge = 200
  assert.ok(stepBattle(b).some((e) => e.type === 'arise'), 'the Monarch raised it')
  b.reserve.push(waiting('grave_ghoul', 70, 1), waiting('grave_ghoul', 71, 1))
  assert.deepEqual(stepBattle(b).filter((e) => e.type === 'enter').map((e) => e.unit.uid), [70], 'thirteen and a shadow: room for one more')
  for (let k = 0; k < 5; k++) assert.ok(!stepBattle(b).some((e) => e.type === 'enter'), 'fourteen bodies and a shadow: full')
  slay(b, b.units.find((u) => u.uid === 13))
  assert.deepEqual(stepBattle(b).filter((e) => e.type === 'enter').map((e) => e.unit.uid), [71], 'a body fell: the reserve enters')
}))

test('summons keep within a tile of their summoner while it stands: they walk back to it, and step only where they stay beside it', () => {
  // The captain, a knight at (3,3), stands still; a Ghoul and a Clockwork Page of its cohort start in the
  // rear corners; the only foe stands frozen at the far edge, out of everyone's reach.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3), member('grave_ghoul', 2, 1, 0, 0), member('clockwork_page', 3, 1, 6, 0),
    on('iron_golem', 50, 'foe', 3, 10)], { moving: [2, 3] })
  const captain = b.units.find((u) => u.uid === 1)
  const ghoul = b.units.find((u) => u.uid === 2)
  const page = b.units.find((u) => u.uid === 3)
  const joined = new Map()
  for (let k = 0; k < 300; k++) {
    for (const e of stepBattle(b)) {
      if (e.type !== 'move') continue
      const u = b.units.find((x) => x.uid === e.actor)
      const before = distance(e.from, captain.tile)
      const after = distance(e.to, captain.tile)
      if (joined.has(u.uid)) assert.ok(after <= 1, `t ${e.t}: ${u.id} strayed from its captain to ${e.to}`)
      else assert.ok(after < before, `t ${e.t}: ${u.id} walked away from its captain`)
      if (after <= 1 && !joined.has(u.uid)) joined.set(u.uid, e.t)
    }
  }
  assert.ok(joined.has(2) && joined.has(3), 'both reached it')
  assert.ok(distance(ghoul.tile, captain.tile) <= 1 && distance(page.tile, captain.tile) <= 1)
  // Beside its captain, it still takes its role's step toward the foes, where the step keeps it beside.
  const by = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3), member('grave_ghoul', 2, 1, 3, 2),
    on('iron_golem', 50, 'foe', 3, 10)], { moving: [2] })
  let step = null
  while (!step && by.t < TUNING.board.stepTicks) step = stepBattle(by).find((e) => e.type === 'move' && e.actor === 2)
  assert.ok(step, 'it stepped within one step clock')
  assert.ok(distance(step.to, tileAt(3, 3)) <= 1, 'still beside its captain')
  assert.ok(distance(step.to, tileAt(3, 10)) < distance(tileAt(3, 2), tileAt(3, 10)), 'nearer the foes')
  // The same Page with no captain hunts its quarry across the board.
  const free = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3), on('clockwork_page', 3, 'party', 6, 0), on('iron_golem', 50, 'foe', 3, 10)], { moving: [3] })
  for (let k = 0; k < 300; k++) stepBattle(free)
  assert.ok(distance(free.units.find((u) => u.uid === 3).tile, tileAt(3, 10)) <= 1, 'a free flanker reaches its quarry')
})

test('a member strikes what is in reach before it walks back to its captain', () => {
  // The captain far behind at (3,1); its Ghoul at (3,5), a step due, a foe right in front of it.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 1), member('grave_ghoul', 2, 1, 3, 5),
    on('iron_golem', 50, 'foe', 3, 6, 1)], { moving: [2] })
  let first = null
  while (!first && b.t < 400) first = stepBattle(b).find((e) => (e.type === 'move' || e.type === 'action') && e.actor === 2)
  assert.equal(first?.type, 'action', 'its first deed is the strike, not a walk back')
  assert.deepEqual(first.targets, [50])
})

test('summons too many for the tiles around their summoner stand a ring deeper instead of idling', () => {
  // A still captain at (3,1) with eight of its ten members already all around it; the other two start
  // far off in the camp's rear corners. With no room beside it, they keep to the next ring, as near as
  // there is room, and never stand idle where they started.
  const ring = [[2, 0], [3, 0], [4, 0], [2, 1], [4, 1], [2, 2], [3, 2], [4, 2], [0, 6], [6, 6]]
  const b = scene([on('monarch', 0, 'party', 0, 0), on('tomb_knight', 1, 'party', 3, 1),
    ...ring.map(([x, y], k) => member('grave_ghoul', 10 + k, 1, x, y)), on('iron_golem', 50, 'foe', 3, 10)],
  { moving: ring.map((_, k) => 10 + k) })
  for (let k = 0; k < 400; k++) stepBattle(b)
  const near = b.units.filter((u) => u.summoned).map((u) => distance(u.tile, tileAt(3, 1))).sort()
  assert.deepEqual(near, [1, 1, 1, 1, 1, 1, 1, 1, 2, 2])
})

test('when a summoner (or a foe captain) falls its summons (its cohort) falter for the rest of the battle, and Hunt', () => {
  // The captain, at 1 HP, is the weakest thing a Frost Sprite can see; its Ghoul starts in the corner,
  // inside the domain. The Sprite stands still.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3), member('grave_ghoul', 2, 1, 0, 1),
    on('frost_sprite', 50, 'foe', 3, 6, 6)], { moving: [2] })
  const captain = b.units.find((u) => u.uid === 1)
  const ghoul = b.units.find((u) => u.uid === 2)
  captain.hp = 1
  const dealt = stats(b, ghoul).damage.dealt
  const events = []
  while (alive(captain) && b.t < 2000) events.push(...stepBattle(b))
  assert.ok(!alive(captain), 'the captain fell')
  const death = events.findIndex((e) => e.type === 'death' && e.target === 1)
  assert.deepEqual(events.slice(death + 1).filter((e) => e.type === 'falter'), [{ t: events[death].t, type: 'falter', target: 2, on: true }])
  assert.ok(ghoul.orphan && falters(b, ghoul))
  assert.ok(Math.abs(stats(b, ghoul).damage.dealt / dealt - TUNING.monarch.falter) < 1e-9)
  // It Hunts: it walks to the Sprite, leaving its captain's tile behind, and fights it.
  const fell = captain.tile
  while (!b.over && distance(ghoul.tile, b.units.find((u) => u.uid === 50).tile) > 1) stepBattle(b)
  assert.ok(distance(ghoul.tile, fell) > 1, 'it left its captain behind')
  assert.ok(falters(b, ghoul), 'still faltering')
})

// ── plans and the reaction rule ──────────────────────────────────────────────────────────────────

// A unit placed on a tile with a plan ({ where, square }) and its detachment.
const ordered = (u, where, square = null, det = 1) => ({ ...u, det, plan: { where, square } })

test('the reaction rule: a melee unit engages a foe within 2 tiles, not 3; on Stay it walks back to its tile after', () => {
  // The Monarch at (3,0) with a domain wide enough to hold the fight; a Tomb Knight on Stay at (3,3); a foe
  // Ghoul frozen 3 tiles off, out of the rule's reach.
  const far = scene([on('monarch', 0, 'party', 3, 0), ordered(on('tomb_knight', 1, 'party', 3, 3), 'stay'), on('grave_ghoul', 10, 'foe', 3, 6, 1)], { moving: [1], domain: 7 })
  for (let k = 0; k < 100; k++) assert.ok(!stepBattle(far).some((e) => e.type === 'move'), 'Stay: nothing within 2, so it holds')
  // On Hunt it walks at the same foe.
  const hunt = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3), on('grave_ghoul', 10, 'foe', 3, 6, 1)], { moving: [1], domain: 7 })
  assert.equal(stepBattle(hunt).find((e) => e.type === 'move')?.to, tileAt(3, 4), 'Hunt walks in')
  // Two tiles off: it steps out to engage, fights, and once the foe is gone walks back onto its tile. A
  // golem far off keeps the battle going.
  const near = scene([on('monarch', 0, 'party', 3, 0), ordered(on('tomb_knight', 1, 'party', 3, 3), 'stay'), on('grave_ghoul', 10, 'foe', 3, 5, 1),
    on('iron_golem', 11, 'foe', 6, 10, 1)], { moving: [1], domain: 7 })
  const knight = near.units.find((u) => u.uid === 1)
  const first = stepBattle(near).find((e) => e.type === 'move')
  assert.deepEqual([first?.from, first?.to], [tileAt(3, 3), tileAt(3, 4)], 'it steps to engage')
  while (!near.over && near.units.find((u) => u.uid === 10).hp > 0 && near.t < 1000) stepBattle(near)
  assert.ok(near.events.some((e) => e.type === 'action' && e.actor === 1), 'it fought')
  while (!near.over && knight.tile !== knight.anchor && near.t < 1200) stepBattle(near)
  assert.equal(knight.tile, tileAt(3, 3), 'back on its tile')
  assert.equal(knight.where, 'stay')
  for (let k = 0; k < 60; k++) assert.ok(!stepBattle(near).some((e) => e.type === 'move' && e.actor === 1), 'and it holds there')
  // A ranged unit on Stay never walks out: a Frost Sprite holds while a Ghoul walks up, and shoots it from
  // its tile once it is in range.
  const sprite = scene([on('monarch', 0, 'party', 0, 0), ordered(on('frost_sprite', 1, 'party', 3, 2), 'stay'), on('grave_ghoul', 10, 'foe', 3, 10, 1)], { moving: [1, 10], domain: 7 })
  while (!sprite.over && sprite.t < 1500) assert.ok(!stepBattle(sprite).some((e) => e.type === 'move' && e.actor === 1), `t ${sprite.t}: the Sprite left its tile`)
  assert.ok(sprite.events.some((e) => e.type === 'action' && e.actor === 1 && e.targets.includes(10)), 'it shot the Ghoul')
})

test('Move: a unit walks to its square, arrives on it or next to it (announced), and Hunts from then on; a ranged one shoots on its way', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), ordered(on('tomb_knight', 1, 'party', 0, 1), 'move', tileAt(6, 5)), on('iron_golem', 10, 'foe', 3, 10, 1)], { moving: [1], domain: 7 })
  const knight = b.units.find((u) => u.uid === 1)
  const path = []
  let arrival = null
  while (!arrival && b.t < 400) {
    for (const e of stepBattle(b)) {
      if (e.type === 'move' && e.actor === 1) path.push(e.to)
      if (e.type === 'arrive') arrival = e
    }
  }
  assert.deepEqual(arrival, { t: b.t - 1, type: 'arrive', uid: 1 })
  assert.ok(distance(path.at(-1), tileAt(6, 5)) <= 1 && path.slice(0, -1).every((t) => distance(t, tileAt(6, 5)) > 1), 'it arrived on its last step, not before')
  assert.ok(path.every((t, k) => k === 0 || distance(t, tileAt(6, 5)) < distance(path[k - 1], tileAt(6, 5))), 'every step nearer the square')
  assert.equal(knight.where, 'hunt')
  const at = knight.tile
  while (b.t < 600 && knight.tile === at) stepBattle(b)
  assert.ok(distance(knight.tile, tileAt(3, 10)) < distance(at, tileAt(3, 10)), 'then it hunts the golem')
  assert.equal(b.events.filter((e) => e.type === 'arrive').length, 1)
  // A unit that starts next to its square has arrived at once.
  const there = scene([on('monarch', 0, 'party', 3, 0), ordered(on('tomb_knight', 1, 'party', 2, 2), 'move', tileAt(3, 3)), on('iron_golem', 10, 'foe', 3, 10, 1)], { domain: 7 })
  assert.ok(there.events.some((e) => e.type === 'arrive' && e.uid === 1 && e.t === 0))
  // A Sprite sent past a foe in its range stops to shoot it, and walks on when it has fallen.
  const sprite = scene([on('monarch', 0, 'party', 3, 0), ordered(on('frost_sprite', 1, 'party', 3, 1), 'move', tileAt(3, 9)), on('grave_ghoul', 10, 'foe', 3, 4, 1),
    on('iron_golem', 11, 'foe', 0, 10, 1)], { moving: [1], domain: 9 })
  let shot = false
  while (sprite.units.find((u) => u.uid === 10).hp > 0 && sprite.t < 2000) {
    for (const e of stepBattle(sprite)) {
      if (e.type === 'action' && e.actor === 1) shot = true
      assert.ok(!(e.type === 'move' && e.actor === 1 && shot), 'no step while the ghoul is in range')
    }
  }
  assert.ok(shot)
  const tile = sprite.units.find((u) => u.uid === 1).tile
  while (sprite.t < 2100 && sprite.units.find((u) => u.uid === 1).tile === tile) stepBattle(sprite)
  assert.ok(tileY(sprite.units.find((u) => u.uid === 1).tile) > tileY(tile), 'on toward its square')
})

test('outside the domain only Hunt is heeded: a unit that falters drops its plan for the rest of the battle', () => {
  // A knight sent to the foes' ground from beside the Monarch: it falters on the step past the domain and
  // Hunts from there, never arriving, even back inside.
  const b = scene([on('monarch', 0, 'party', 3, 0), ordered(on('tomb_knight', 1, 'party', 3, 2), 'move', tileAt(3, 9)), on('iron_golem', 10, 'foe', 0, 10, 1)], { moving: [1] })
  const knight = b.units.find((u) => u.uid === 1)
  let out = null
  while (!out && b.t < 400) out = stepBattle(b).find((e) => e.type === 'falter' && e.target === 1 && e.on)
  assert.ok(out, 'it stepped out of the domain')
  assert.equal(tileY(knight.tile), b.domain + 1)
  assert.equal(knight.where, 'hunt', 'its plan is dropped at once')
  knight.tile = tileAt(3, 1) // were it back inside, it would still Hunt
  b.at[tileAt(3, b.domain + 1)] = null
  b.at[knight.tile] = knight
  assert.equal(knight.where, 'hunt')
  while (!b.over && b.t < 1500) stepBattle(b)
  assert.ok(!b.events.some((e) => e.type === 'arrive'), 'it never arrived')
  // On Stay, placed outside the domain: it falters at the start and Hunts at once.
  const placed = scene([on('monarch', 0, 'party', 3, 0), ordered(on('tomb_knight', 1, 'party', 3, 5), 'stay'), on('iron_golem', 10, 'foe', 3, 10, 1)], { moving: [1] })
  assert.equal(placed.units.find((u) => u.uid === 1).where, 'hunt')
  assert.equal(stepBattle(placed).find((e) => e.type === 'move')?.to, tileAt(3, 6))
  // Foes have no domain: a foe's plan is never dropped, unless its captain's fell with it (an orphan Hunts).
  const foe = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 0), ordered(on('grave_ghoul', 10, 'foe', 3, 9, 1), 'stay'),
    { ...ordered(on('grave_ghoul', 11, 'foe', 5, 9, 1), 'stay'), cohortOf: 99, rank: true }])
  assert.equal(foe.units.find((u) => u.uid === 10).where, 'stay')
  assert.equal(foe.units.find((u) => u.uid === 11).where, 'hunt')
})

test('a flanker on any plan walks through bodies: on Move it hops its own line to its square, chasing no quarry on the way', () => {
  // A Clockwork Page behind a wall of its own knights across all seven lanes, sent to (3,6); a golem in the
  // foes' corner would be its quarry on Hunt. No one but the Page moves.
  const wall = Array.from({ length: 7 }, (_, x) => on('tomb_knight', 2 + x, 'party', x, 2))
  const b = scene([ordered(on('clockwork_page', 1, 'party', 3, 0), 'move', tileAt(3, 6)), ...wall, on('iron_golem', 20, 'foe', 6, 10, 1)], { moving: [1] })
  const page = b.units.find((u) => u.uid === 1)
  const moves = []
  while (page.where === 'move' && b.t < 400) {
    const events = stepBattle(b)
    moves.push(...events.filter((e) => e.type === 'move' && e.actor === 1))
    const living = b.units.filter((u) => u.hp > 0)
    assert.equal(new Set(living.map((u) => u.tile)).size, living.length, `t ${b.t}: two units on one tile`)
  }
  assert.ok(distance(page.tile, tileAt(3, 6)) <= 1 && b.events.some((e) => e.type === 'arrive' && e.uid === 1), 'it arrived')
  assert.deepEqual(moves.filter((e) => e.via).map((e) => e.via), [[tileAt(3, 2)]], 'one hop, over its own line')
  assert.ok(moves.every((e) => tileX(e.to) === 3), 'straight up its lane to the square, not off toward its quarry')
})

test('summons follow their summoner\'s plan by the leash: they hold with it on Stay, walk with it on Move, and Hunt once it arrives', () => {
  const still = scene([on('monarch', 0, 'party', 3, 0), ordered(on('tomb_knight', 1, 'party', 3, 2), 'stay'), ordered(member('grave_ghoul', 2, 1, 3, 1), 'stay'),
    on('iron_golem', 10, 'foe', 3, 10, 1)], { moving: [1, 2] })
  for (let k = 0; k < 200; k++) assert.ok(!stepBattle(still).some((e) => e.type === 'move'), 'a Stay banner holds')
  // On Move, the cohort keeps its leash all the way, and Hunts with its captain once it has arrived.
  const b = scene([on('monarch', 0, 'party', 3, 0), ordered(on('tomb_knight', 1, 'party', 3, 2), 'move', tileAt(0, 5)), ordered(member('grave_ghoul', 2, 1, 3, 1), 'move', tileAt(0, 5)),
    on('iron_golem', 10, 'foe', 6, 10, 1)], { moving: [1, 2], domain: 7 })
  const [captain, ghoul] = [1, 2].map((uid) => b.units.find((u) => u.uid === uid))
  while (captain.where === 'move' && b.t < 600) {
    stepBattle(b)
    assert.ok(distance(ghoul.tile, captain.tile) <= 2, `t ${b.t}: the ghoul strayed`)
  }
  assert.ok(distance(captain.tile, tileAt(0, 5)) <= 1, 'the captain arrived')
  const at = ghoul.tile
  while (b.t < 900 && ghoul.tile === at) stepBattle(b)
  assert.ok(distance(ghoul.tile, tileAt(6, 10)) < distance(at, tileAt(6, 10)), 'the cohort hunts with it')
  // Its own copy of the plan does not hold it back: with its captain on Hunt (arrived, or faltering), a
  // member whose copy says Stay takes the Hunt step its leash allows, round its still captain.
  const led = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3), ordered(member('grave_ghoul', 2, 1, 3, 2), 'stay'),
    on('iron_golem', 10, 'foe', 3, 10, 1)], { moving: [2], domain: 7 })
  const step = stepBattle(led).find((e) => e.type === 'move' && e.actor === 2)
  assert.ok(step && tileY(step.to) === 3 && distance(step.to, tileAt(3, 3)) === 1, 'it steps up beside its captain')
})

test('a held detachment waits off the board and enters beside the Monarch when its start comes, captain first, on its plan', () => {
  const held = (when) => [
    { ...makeUnit('tomb_knight', { uid: 5, lvl: 3 }), det: 2, plan: { where: 'stay', square: null }, when },
    { ...waiting('grave_ghoul', 6, 5), det: 2, plan: { where: 'stay', square: null }, when }
  ]
  const orders = [{ id: 2, color: '#000', where: 'stay', square: null, when: { at: 'time', t: 30 } }]
  // At a time: nothing before tick 30; then the call, the captain, and its ghoul the tick after, never an
  // orphan; each holds the tile it entered on.
  const b = scene([on('monarch', 0, 'party', 3, 1), on('tomb_knight', 1, 'party', 3, 4), on('iron_golem', 50, 'foe', 3, 10)], { reserve: held({ at: 'time', t: 30 }), detachments: orders })
  assert.deepEqual(b.events[0].reserve.map((u) => [u.uid, u.det, u.when]), [[5, 2, { at: 'time', t: 30 }], [6, 2, { at: 'time', t: 30 }]])
  assert.deepEqual(b.events[1], { t: 0, type: 'order', detachment: 2, color: '#000', where: 'stay', square: null, when: { at: 'time', t: 30 } })
  const seen = []
  while (b.t < 40) seen.push(...stepBattle(b).filter((e) => e.type === 'call' || e.type === 'enter'))
  assert.deepEqual(seen.map((e) => [e.t, e.type, e.unit?.uid]), [[30, 'call', undefined], [30, 'enter', 5], [31, 'enter', 6]])
  assert.deepEqual(seen[0], { t: 30, type: 'call', detachment: 2, at: 'time' })
  assert.equal(seen[1].unit.det, 2)
  const [knight, ghoul] = [5, 6].map((uid) => b.units.find((u) => u.uid === uid))
  assert.ok(!ghoul.orphan && knight.where === 'stay' && knight.anchor === seen[1].unit.tile && ghoul.anchor === seen[2].unit.tile)
  // Off the board it is no body, and on it it stands past the board's cap, in TUNING.orders.reserve places
  // of its own: fourteen stand (a board of 14) and the overflow waits, while the held captain enters on its
  // start all the same, fresh (a full gauge, Shielded).
  boardOf(14, () => {
    const knights = [...Array(14).keys()].map((k) => on('tomb_knight', k + 1, 'party', k % 7, 3 + Math.floor(k / 7)))
    const full = scene([on('monarch', 0, 'party', 3, 1), ...knights, on('iron_golem', 50, 'foe', 3, 10)],
      { reserve: [...held({ at: 'time', t: 5 }).slice(0, 1).map((u) => ({ ...u, uid: 40 })), waiting('grave_ghoul', 41, 1)] })
    const came = []
    while (full.t < 15) came.push(...stepBattle(full).filter((e) => e.type === 'enter').map((e) => [e.t, e.unit.uid]))
    assert.deepEqual(came, [[5, 40]], 'the held captain at its start, past the full board; the overflow waits')
    const fresh = full.units.find((u) => u.uid === 40)
    assert.ok(fresh.statuses.some((x) => x.id === 'shield'), 'it entered fresh: Shielded')
    slay(full, full.units.find((u) => u.uid === 9))
    assert.deepEqual(stepBattle(full).filter((e) => e.type === 'enter').map((e) => e.unit.uid), [41], 'a body fell: the overflow enters')
  })
  // Its places are TUNING.orders.reserve: held bodies past them wait like the overflow.
  tuned({ orders: { reserve: 1 } }, () => boardOf(1, () => {
    const two = [{ ...held({ at: 'time', t: 2 })[0], uid: 40 }, { ...held({ at: 'time', t: 2 })[0], uid: 41 }]
    const b = scene([on('monarch', 0, 'party', 3, 1), on('tomb_knight', 1, 'party', 3, 4), on('iron_golem', 50, 'foe', 3, 10)], { reserve: two })
    const came = []
    while (b.t < 12) came.push(...stepBattle(b).filter((e) => e.type === 'enter').map((e) => e.unit.uid))
    assert.deepEqual(came, [40], 'one place of its own')
  }))
  // The Monarch struck: the start comes the tick after the blow.
  const struck = scene([on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 0, 0), on('will_o_wisp', 50, 'foe', 3, 6, 3)], { reserve: held({ at: 'struck' }) })
  while (!struck.events.some((e) => e.type === 'damage' && e.target === 0) && struck.t < 400) stepBattle(struck)
  const blow = struck.events.find((e) => e.type === 'damage' && e.target === 0).t
  assert.ok(!struck.events.some((e) => e.type === 'enter'))
  assert.deepEqual(stepBattle(struck).filter((e) => e.type === 'call' || e.type === 'enter').map((e) => [e.t, e.type]), [[blow + 1, 'call'], [blow + 1, 'enter']])
  // A body falls: a ghoul at 1 HP beside a golem.
  const falls = scene([on('monarch', 0, 'party', 3, 0), member('grave_ghoul', 2, 99, 3, 5), on('iron_golem', 50, 'foe', 3, 6, 5)], { reserve: held({ at: 'falls' }) })
  falls.units.find((u) => u.uid === 2).hp = 1
  while (!falls.events.some((e) => e.type === 'death') && falls.t < 400) stepBattle(falls)
  const death = falls.events.find((e) => e.type === 'death').t
  assert.ok(!falls.events.some((e) => e.type === 'enter'))
  assert.deepEqual(stepBattle(falls).filter((e) => e.type === 'enter').map((e) => [e.t, e.unit.uid]), [[death + 1, 5]])
})

test('a foe still to come enters at the top edge on its time and keeps the battle going; its entry is the wave a held detachment can wait for', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 0, 9), on('grave_ghoul', 10, 'foe', 3, 10, 1)], {
    reserve: [
      { ...makeUnit('tomb_knight', { uid: 5, lvl: 3 }), det: 1, plan: { where: 'hunt', square: null }, when: { at: 'wave' } },
      { ...makeUnit('grave_ghoul', { uid: 70, lvl: 1 }), side: 'foe', when: { at: 'time', t: 20 } }
    ]
  })
  slay(b, b.units.find((u) => u.uid === 10))
  const seen = []
  while (b.t < 25) seen.push(...stepBattle(b).filter((e) => e.type === 'enter'))
  assert.ok(!b.over, 'a foe still to enter: not won')
  assert.deepEqual(seen.map((e) => [e.t, e.unit.uid, e.unit.side]), [[20, 70, 'foe'], [21, 5, 'party']])
  assert.equal(tileY(seen[0].unit.tile), DEPTH - 1, 'at the top edge')
  assert.equal(b.entered, 21)
})

test('each start comes only on its own signal: a foe slain is no body fallen, a blow on a soul is no blow on the Monarch, a body of yours entering is no wave', () => {
  const held = (when, uid = 5) => ({ ...makeUnit('tomb_knight', { uid, lvl: 3 }), det: 2, plan: { where: 'hunt', square: null }, when })
  const calls = (b) => b.events.filter((e) => e.type === 'call' || (e.type === 'enter' && e.unit.uid === 5))
  // A body falls: a knight slays a foe at 1 HP, and nothing is called; then a Ghoul of yours at 1 HP, left
  // alone by a still golem until now, falls to it, and the held knight is called the tick after. (No
  // Monarch: it would raise the slain foe, and the shadow might fall first.)
  const falls = scene([on('tomb_knight', 1, 'party', 0, 5, 9), on('grave_ghoul', 10, 'foe', 0, 6, 1),
    on('grave_ghoul', 2, 'party', 6, 1), on('iron_golem', 50, 'foe', 6, 3, 5), on('iron_golem', 51, 'foe', 3, 10)], { reserve: [held({ at: 'falls' })] })
  falls.units.find((u) => u.uid === 10).hp = 1
  while (!falls.events.some((e) => e.type === 'death') && falls.t < 400) stepBattle(falls)
  assert.deepEqual(falls.events.filter((e) => e.type === 'death').map((e) => e.target), [10], 'a foe fell first')
  for (let k = 0; k < 20; k++) stepBattle(falls)
  assert.deepEqual(calls(falls), [], 'a foe slain calls nothing')
  const ghoul = falls.units.find((u) => u.uid === 2)
  ghoul.hp = 1
  falls.units.find((u) => u.uid === 50).nextStep = falls.t
  while (alive(ghoul) && falls.t < 800) stepBattle(falls)
  const death = falls.events.find((e) => e.type === 'death' && e.target === 2)?.t
  assert.ok(death !== undefined, 'the ghoul fell')
  assert.deepEqual(calls(falls), [])
  stepBattle(falls)
  assert.deepEqual(calls(falls).map((e) => [e.t, e.type]), [[death + 1, 'call'], [death + 1, 'enter']])
  // The Monarch struck: a Wisp shoots the knight in front first, and nothing is called; once the knight is
  // gone and the Wisp's fire reaches the Monarch, the held knight is called the tick after the blow.
  const struck = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4, 9), on('will_o_wisp', 50, 'foe', 3, 8, 3)],
    { reserve: [held({ at: 'struck' })], moving: [50], domain: 7 })
  while (!struck.events.some((e) => e.type === 'damage' && e.target === 1) && struck.t < 400) stepBattle(struck)
  assert.ok(struck.events.some((e) => e.type === 'damage' && e.target === 1), 'the knight was hit')
  for (let k = 0; k < 20; k++) stepBattle(struck)
  assert.ok(!struck.events.some((e) => e.type === 'damage' && e.target === 0), 'the Monarch untouched so far')
  assert.deepEqual(calls(struck), [], 'a blow on a soul calls nothing')
  slay(struck, struck.units.find((u) => u.uid === 1))
  while (!struck.events.some((e) => e.type === 'damage' && e.target === 0) && struck.t < 1200) stepBattle(struck)
  const blow = struck.events.find((e) => e.type === 'damage' && e.target === 0)?.t
  assert.ok(blow !== undefined, 'the Monarch was struck')
  assert.deepEqual(calls(struck), [])
  stepBattle(struck)
  assert.deepEqual(calls(struck).map((e) => [e.t, e.type]), [[blow + 1, 'call'], [blow + 1, 'enter']])
  // A wave: on a board of one, a body of yours from the reserve enters as the knight falls, and nothing is
  // called; a foe entering is the wave, and the held knight is called the tick after (the board is full,
  // but a held body stands past it, in places of its own: it enters on the call).
  boardOf(1, () => {
    const wave = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 0, 9), on('iron_golem', 51, 'foe', 3, 10)], {
      reserve: [held({ at: 'wave' }), waiting('grave_ghoul', 30, 1), { ...makeUnit('grave_ghoul', { uid: 70, lvl: 1 }), side: 'foe', when: { at: 'time', t: 40 } }]
    })
    slay(wave, wave.units.find((u) => u.uid === 1))
    const seen = []
    while (wave.t < 45) seen.push(...stepBattle(wave).filter((e) => e.type === 'enter' || e.type === 'call'))
    assert.deepEqual(seen.map((e) => [e.t, e.type, e.unit?.uid]), [[0, 'enter', 30], [40, 'enter', 70], [41, 'call', undefined], [41, 'enter', 5]])
  })
})

test('a held Move unit that enters beside its square has arrived on entry, and Hunts from there', () => {
  // The Monarch at (3,1); a knight held for 5 ticks, sent to (3,3): it enters at (3,2), next to its square.
  const b = scene([on('monarch', 0, 'party', 3, 1), on('iron_golem', 50, 'foe', 3, 10)], {
    reserve: [{ ...makeUnit('tomb_knight', { uid: 5, lvl: 3 }), det: 1, plan: { where: 'move', square: tileAt(3, 3) }, when: { at: 'time', t: 5 } }],
    detachments: [{ id: 1, color: '#000', where: 'move', square: tileAt(3, 3), when: { at: 'time', t: 5 } }],
    domain: 7
  })
  const seen = []
  while (b.t < 7) seen.push(...stepBattle(b).filter((e) => e.type === 'enter' || e.type === 'arrive'))
  assert.deepEqual(seen.map((e) => [e.t, e.type]), [[5, 'enter'], [5, 'arrive']])
  assert.equal(seen[0].unit.tile, tileAt(3, 2))
  assert.equal(seen[1].uid, 5)
  const knight = b.units.find((u) => u.uid === 5)
  assert.equal(knight.where, 'hunt')
  const at = knight.tile
  while (b.t < 200 && knight.tile === at) stepBattle(b)
  assert.ok(distance(knight.tile, tileAt(3, 10)) < distance(at, tileAt(3, 10)), 'it hunts the golem')
})

test('the reaction rule holds for a summon (or a foe cohort member) too: it steps out past its leash to engage a foe within 2, and holds with none', () => {
  // A still captain on Stay at (3,2), its Ghoul on Stay at (3,3); a foe Ghoul frozen 2 tiles from the member
  // and 3 from the captain. The member's step to engage takes it 2 from its captain, past its leash of 1.
  const at = (y) => scene([on('monarch', 0, 'party', 3, 0), ordered(on('tomb_knight', 1, 'party', 3, 2), 'stay'), ordered(member('grave_ghoul', 2, 1, 3, 3), 'stay'),
    on('grave_ghoul', 10, 'foe', 3, y, 1), on('iron_golem', 50, 'foe', 6, 10, 1)], { moving: [2], domain: 7 })
  const near = at(5)
  let step = null
  while (!step && near.t < 100) step = stepBattle(near).find((e) => e.type === 'move' && e.actor === 2)
  assert.ok(step, 'the member stepped')
  assert.ok(distance(step.to, tileAt(3, 5)) === 1 && distance(step.to, tileAt(3, 2)) === 2, `to ${step.to}: beside the foe, past its leash`)
  // Three tiles off, it holds by its captain.
  const far = at(6)
  for (let k = 0; k < 100; k++) assert.ok(!stepBattle(far).some((e) => e.type === 'move' && e.actor === 2), 'nothing within 2: it holds')
})

test('Stay with its tile taken: the unit holds where it is, and takes its tile back once it is free', () => {
  // A knight on Stay whose tile is (3,3), moved to (3,1) by the scene; an ally stands still on (3,3).
  const b = scene([on('monarch', 0, 'party', 0, 0), ordered(on('tomb_knight', 1, 'party', 3, 3), 'stay'), on('grave_ghoul', 2, 'party', 5, 3),
    on('iron_golem', 50, 'foe', 3, 10, 1)], { moving: [1], domain: 7 })
  const [knight, ally] = [1, 2].map((uid) => b.units.find((u) => u.uid === uid))
  const put = (u, tile) => { b.at[u.tile] = null; u.tile = tile; b.at[tile] = u }
  put(knight, tileAt(3, 1))
  put(ally, tileAt(3, 3))
  assert.equal(knight.anchor, tileAt(3, 3))
  for (let k = 0; k < 60; k++) assert.ok(!stepBattle(b).some((e) => e.type === 'move' && e.actor === 1), 'its tile is taken: it holds')
  slay(b, ally)
  while (b.t < 200 && knight.tile !== knight.anchor) stepBattle(b)
  assert.equal(knight.tile, tileAt(3, 3), 'back on its tile')
})
