import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, stepBattle, runBattle, timelineHash, stats, canIssue, issueCommand } from '../src/sim/battle.js'
import { TUNING } from '../src/tuning.js'
import { rowOf, makeUnit, autoPlace } from '../src/sim/unit.js'
import { createRng } from '../src/sim/rng.js'
import { UNIT_LIST } from '../src/content.js'
import { foeLevel, START_PARTY } from '../src/sim/run.js'

function team (ids, { side = 'party', lvl = 2, uid = side === 'party' ? 1 : 100 } = {}) {
  return autoPlace(ids.map((id, i) => makeUnit(id, { uid: uid + i, lvl })))
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

const FOES = ['clockwork_page', 'hive_warden', 'frost_sprite']
const battle = (seed = 'cmd', opts = {}) =>
  createBattle({ party: team(START), foes: team(FOES, { side: 'foe', lvl: 1 }), seed, ...opts })
const step = (b, n) => { for (let i = 0; i < n && !b.over; i++) stepBattle(b) }
const uidOf = (b, id, side) => b.units.find((u) => u.id === id && u.side === side).uid

test('budget: 3 per battle, spent on issue, refused after', () => {
  const b = battle()
  assert.equal(b.commandsLeft, TUNING.commands.perBattle)
  for (let i = 0; i < 3; i++) assert.ok(issueCommand(b, { verb: 'focus', target: 100 }).ok)
  assert.equal(b.commandsLeft, 0)
  const r = issueCommand(b, { verb: 'focus', target: 100 })
  assert.equal(r.ok, false)
  assert.equal(b.commandLog.length, 3)
  assert.equal(battle('x', { commands: 5 }).commandsLeft, 5)
})

test('invalid targets are rejected without spending', () => {
  const b = battle()
  assert.equal(canIssue(b, 'focus', 1).ok, false)
  assert.equal(canIssue(b, 'brace', 100).ok, false)
  assert.equal(canIssue(b, 'unleash', 100).ok, false)
  assert.equal(canIssue(b, 'focus', 999).ok, false)
  assert.equal(canIssue(b, 'dance', 1).ok, false)
  assert.equal(canIssue(b, 'parley', 100).ok, false, 'a healthy foe cannot be parleyed')
  b.units.find((u) => u.uid === 101).hp = 0
  assert.equal(canIssue(b, 'focus', 101).ok, false, 'dead')
  assert.equal(issueCommand(b, { verb: 'brace', target: 100 }).ok, false)
  assert.equal(b.commandsLeft, 3)
  const boss = team(['hollow_sovereign'], { side: 'foe' })
  boss[0].slot = 1
  boss[0].hp = 1
  assert.equal(canIssue(createBattle({ party: team(START), foes: boss, seed: 1, boss: true }), 'parley', 100).ok, false)
})

test('focus: every party single-target pick goes to the focused foe', () => {
  const b = battle('focus')
  const target = uidOf(b, 'frost_sprite', 'foe')
  issueCommand(b, { verb: 'focus', target })
  const events = []
  while (!b.over && b.t < TUNING.commands.focusTicks) events.push(...stepBattle(b))
  assert.equal(events[0].type, 'command')
  const party = new Set(b.units.filter((u) => u.side === 'party').map((u) => u.uid))
  const picks = events.filter((e) => e.type === 'action' && party.has(e.actor) && e.targets.length === 1 && !party.has(e.targets[0]))
  const focusAlive = (t) => !events.some((e) => e.type === 'death' && e.target === target && e.t < t)
  assert.ok(picks.length > 0)
  for (const p of picks) if (focusAlive(p.t)) assert.equal(p.targets[0], target)
})

test('parley: an attempt is made on the weakened foe, and success recruits it', () => {
  let recruited = 0
  for (let i = 0; i < 20; i++) {
    const b = battle('parley' + i)
    const foe = b.units.find((u) => u.id === 'clockwork_page')
    foe.hp = Math.floor(foe.maxHp * 0.2)
    const c = canIssue(b, 'parley', foe.uid)
    assert.ok(c.ok && c.chance > 0 && c.chance < 1)
    issueCommand(b, { verb: 'parley', target: foe.uid })
    assert.equal(canIssue(b, 'parley', foe.uid).ok, false, 'one parley at a time')
    const events = []
    while (!b.over && !events.some((e) => e.type === 'persuade' || e.type === 'refund')) events.push(...stepBattle(b))
    const p = events.find((e) => e.type === 'persuade')
    if (!p) { assert.equal(b.commandsLeft, 3, 'refunded'); continue }
    assert.equal(p.target, foe.uid)
    assert.ok(!events.some((e) => e.type === 'damage' && e.actor === p.actor && e.t === p.t))
    if (p.success) {
      recruited++
      assert.ok(foe.left && b.recruited.includes(foe.uid))
      assert.ok(events.some((e) => e.type === 'recruit' && e.target === foe.uid && e.id === 'clockwork_page'))
    } else {
      assert.equal(foe.persuadeAttempts, 1)
    }
  }
  assert.ok(recruited > 0)
})

test('parley is refunded when the target dies first', () => {
  const b = battle('refund')
  const foe = b.units.find((u) => u.id === 'frost_sprite' && u.side === 'foe')
  foe.hp = 1
  issueCommand(b, { verb: 'parley', target: foe.uid })
  for (const u of b.units) if (u.side === 'party') u.gauge = -1000
  stepBattle(b)
  foe.hp = 0
  stepBattle(b)
  assert.equal(b.parley, null)
  assert.equal(b.commandsLeft, 3)
  assert.ok(b.events.some((e) => e.type === 'refund'))
})

test('brace: braced takes less damage, and steps back a row only when the slot is free', () => {
  const b = battle('brace')
  const knight = b.units.find((u) => u.id === 'tomb_knight')
  const sprite = b.units.find((u) => u.id === 'frost_sprite' && u.side === 'party')
  const taken = stats(b, knight).damage.taken
  issueCommand(b, { verb: 'brace', target: knight.uid })
  stepBattle(b)
  assert.equal(knight.slot, 0, 'blocked by the sprite behind it')
  assert.ok(knight.statuses.some((s) => s.id === 'braced' && s.dur === TUNING.commands.braceTicks - 1))
  assert.ok(Math.abs(stats(b, knight).damage.taken - taken * 0.6) < 1e-9)
  sprite.slot = 5
  issueCommand(b, { verb: 'brace', target: knight.uid })
  stepBattle(b)
  assert.equal(rowOf(knight.slot), 1)
  assert.ok(b.events.some((e) => e.type === 'move' && e.target === knight.uid && e.slot === 4))
})

test('unleash: the ally fires its most expensive viable ability this tick', () => {
  const b = battle('unleash')
  const knight = b.units.find((u) => u.id === 'tomb_knight')
  issueCommand(b, { verb: 'unleash', target: knight.uid })
  const events = stepBattle(b)
  const act = events.find((e) => e.type === 'action' && e.actor === knight.uid)
  assert.equal(act?.ability, 'cleave')
  assert.equal(act.t, 0)
})

test('live play with commands replays exactly from the command log', () => {
  for (const seed of ['r1', 'r2', 'r3']) {
    const live = battle(seed)
    while (!live.over) {
      if (live.t === 40) issueCommand(live, { verb: 'unleash', target: uidOf(live, 'bone_chanter', 'party') })
      if (live.t === 60) issueCommand(live, { verb: 'focus', target: uidOf(live, 'hive_warden', 'foe') })
      for (const f of live.units) if (live.commandsLeft && canIssue(live, 'parley', f.uid).ok) issueCommand(live, { verb: 'parley', target: f.uid })
      stepBattle(live)
    }
    assert.ok(live.commandLog.length >= 2)
    const replay = runBattle(battle(seed), { commands: live.commandLog })
    assert.deepEqual(replay.events, live.events)
  }
})
