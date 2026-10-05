import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, stepBattle, runBattle, stats } from '../src/sim/battle.js'
import { canIssue, issueCommand } from '../src/sim/commands.js'
import { rowOf } from '../src/sim/formation.js'
import { TUNING } from '../src/content/index.js'
import { team, START } from './helpers.js'

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
