import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, stepBattle, runBattle, timelineHash, stats } from '../src/sim/battle.js'
import { TUNING } from '../src/tuning.js'
import { makeUnit, autoPlace, distance, TILES, slotAt, campGrid, wallTiles, steps } from '../src/sim/unit.js'
import { createRng } from '../src/sim/rng.js'
import { UNIT_LIST, unitDef, ROLES, BEHAVIOURS, CAMP_LIST } from '../src/content.js'
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

// In one of the floor's camps, picked by seed, walls and all.
const fresh = (seed, floor = 1) => {
  const { foes, boss } = encounter(seed, floor)
  const camp = createRng(seed).stream('camp').pick(CAMP_LIST.filter((c) => c.floor === floor)).id
  return createBattle({ party: team(START, { lvl: 1 + floor, camp }), foes, seed, floor, boss, walls: wallTiles(camp) })
}

test('the same seed gives the same timeline; a different seed does not', () => {
  const a = runBattle(fresh('det'))
  const b = runBattle(fresh('det'))
  assert.equal(a.hash, b.hash)
  assert.equal(a.hash, timelineHash(b.events))
  assert.notEqual(a.hash, runBattle(fresh('det2')).hash)
})

test('stepping tick by tick equals runBattle', () => {
  const live = fresh('step')
  const seen = [...live.events]
  while (!live.over) seen.push(...stepBattle(live))
  const run = runBattle(fresh('step'))
  assert.deepEqual(seen, run.events)
  assert.equal(timelineHash(seen), run.hash)
  assert.deepEqual(stepBattle(live), [])
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
  const wins = [0, 0, 0, 0]
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
    if (r.winner === 'party') wins[floor - 1]++
  }
  assert.ok(wins[0] > 0, 'the start party can win on floor 1')
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

test('units walk one free tile at a time, never share one, and the engaged hold unless they slip', () => {
  let moves = 0
  let flanks = 0
  for (let i = 0; i < 60; i++) {
    const b = fresh('walk' + i, 1 + (i % 4))
    const tile = new Map(b.units.map((u) => [u.uid, u.tile]))
    const dead = new Set()
    const engaged = (u) => b.units.some((e) => e.side !== u.side && !dead.has(e.uid) && distance(tile.get(e.uid), tile.get(u.uid)) === 1)
    while (!b.over) {
      for (const e of stepBattle(b)) {
        if (e.type === 'death') dead.add(e.target)
        if (e.type !== 'move') continue
        const u = b.units.find((x) => x.uid === e.actor)
        assert.equal(tile.get(u.uid), e.from)
        assert.ok(e.to >= 0 && e.to < TILES && distance(e.from, e.to) === 1, `seed ${i}: step ${e.from}→${e.to}`)
        assert.ok(steps(e.from, b.walls).includes(e.to), `seed ${i}: step ${e.from}→${e.to} into or past a wall`)
        const slips = BEHAVIOURS[ROLES[unitDef(u.id).role].move].slips
        assert.ok(slips || !engaged(u), `seed ${i}: ${u.id} walked away while engaged`)
        tile.set(u.uid, e.to)
        const held = b.units.filter((x) => !dead.has(x.uid)).map((x) => tile.get(x.uid))
        assert.equal(new Set(held).size, held.length, `seed ${i}: two units on one tile`)
        moves++
        if (slips) flanks++
      }
    }
  }
  assert.ok(moves > 0 && flanks > 0)
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
  unit(4).tile = unit(3).tile + 1
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
