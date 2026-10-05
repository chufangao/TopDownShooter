import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, stepBattle, runBattle, timelineHash } from '../src/sim/battle.js'
import { TUNING } from '../src/content/index.js'
import { team, START, encounter } from './helpers.js'

const fresh = (seed, floor = 1) => {
  const { foes, boss } = encounter(seed, floor)
  return createBattle({ party: team(START, { lvl: 1 + floor }), foes, seed, floor, boss })
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
  assert.equal(party[0].gauge, 0)
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
