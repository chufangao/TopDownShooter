// Each piece's intent, read ahead of End Turn (intents): what End Turn then plays, blow for blow, for both sides, and
// the battle untouched by the reading. Functional only: what is read is what plays.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { order, intents, addStatus } from '../src/sim/turns.js'
import { on, scene, unit } from './scene.js'

// The foes' stage of End Turn's events, read a foe at a time as intents reads it: { uid, to, ability, target, struck, hits }.
function foesPlayed (events) {
  const from = events.findIndex((e) => e.type === 'stage' && e.stage === 'foes')
  const to = events.findIndex((e) => e.type === 'stage' && e.stage === 'end')
  const out = []
  let cur = null
  let answered = false
  for (const e of events.slice(from < 0 ? events.length : from, to < 0 ? events.length : to)) {
    const foe = (uid) => uid >= 100
    if ((e.type === 'move' && foe(e.actor)) || (e.type === 'action' && !e.counter && !e.rule && foe(e.actor))) {
      if (!cur || cur.uid !== e.actor) out.push(cur = { uid: e.actor, to: null, ability: null, target: null, struck: null, hits: {} })
      answered = false
    }
    if (!cur) continue
    if (e.type === 'move' && e.actor === cur.uid) cur.to = e.to
    else if (e.type === 'action' && e.actor === cur.uid && !e.counter) [cur.ability, cur.target, cur.struck] = [e.ability, e.primary, e.struck ?? e.primary]
    else if (e.type === 'action') answered = true
    else if (e.type === 'damage' && !e.status && !answered) cur.hits[e.target] = (cur.hits[e.target] ?? 0) + e.damage
  }
  return out
}

const snapshot = (b) => JSON.stringify(b.units.map((u) => [u.uid, u.hp, u.tile, u.acted, u.statuses, u.cooldowns]))

test('the intents read ahead are what End Turn plays: each foe\'s walk, its act and whom it lands on, in their order; a shooter\'s through a screen; the battle untouched by the reading', () => {
  const b = scene([
    on('monarch', 0, 'party', 3, 0),
    on('tomb_knight', 1, 'party', 3, 3, 30),
    on('tomb_knight', 2, 'party', 2, 2, 30),
    on('hive_warden', 3, 'party', 4, 1, 30),
    // A brute in the knight's road; a shooter behind it, its line to the Monarch screened by the knight; a third far off.
    on('grave_ghoul', 101, 'foe', 3, 5, 30),
    on('bone_chanter', 102, 'foe', 3, 7, 30),
    on('iron_golem', 103, 'foe', 1, 9, 30)
  ])
  const before = snapshot(b)
  const events = b.events.length
  const c = intents(b)
  assert.equal(snapshot(b), before, 'the battle is as it was')
  assert.deepEqual([b.events.length, b.turn, b.phase, b.stage], [events, 1, 'orders', 'party'])
  // Every living foe is read once: acting, walking or holding.
  assert.deepEqual(c.theirs.map((x) => x.uid).sort(), [101, 102, 103])
  assert.ok(c.theirs.every((x) => x.ability || x.to != null || x.holds), 'each foe acts, walks or holds')
  // Yours left untouched are read as the End Turn card reads them.
  assert.deepEqual(c.mine.map((x) => x.uid), [1, 2, 3])
  // What End Turn then plays for the foes is what was read: the same foes in the same order, the same walks, acts and blows.
  const real = foesPlayed(order(b, { type: 'end' }))
  const read = c.theirs.filter((x) => x.ability || x.to != null).map((x) => ({ uid: x.uid, to: x.to, ability: x.ability, target: x.target, struck: x.struck, hits: x.hits }))
  assert.deepEqual(real, read)
  assert.ok(real.length >= 2, 'the brute and the shooter act or walk')
  assert.ok(c.over === b.over && c.winner === b.winner)
})

test('a foe that can neither walk nor strike holds; a Hexed foe loses its act; the last foe falling to the untouched pass ends the reading there', () => {
  const b = scene([
    on('monarch', 0, 'party', 3, 0),
    on('tomb_knight', 1, 'party', 3, 4, 30),
    // The brute stands against the knight and strikes it; the golem behind it in the same road has nowhere to go.
    on('grave_ghoul', 101, 'foe', 3, 5, 30),
    on('iron_golem', 102, 'foe', 3, 6, 30),
    on('grave_ghoul', 103, 'foe', 0, 9, 30)
  ])
  addStatus(b, unit(b, 103), 'hexed', 1)
  const c = intents(b)
  const by = (uid) => c.theirs.find((x) => x.uid === uid)
  // Against the knight it acts from where it stands (its basic or a skill, whichever scores best) and walks nowhere.
  assert.ok(unit(b, 101).kit.some((a) => a.id === by(101).ability))
  assert.deepEqual([by(101).target, by(101).to], [1, null])
  assert.ok(by(101).hits[1] > 0)
  assert.deepEqual([by(102).holds, by(102).ability, by(102).to], [true, null, null])
  assert.deepEqual([by(103).hexed, by(103).ability], [true, null])
  assert.equal(c.ended, false)
  // The knight alone fells the last foe: the foes never take a turn.
  const won = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 5, 30), on('grave_ghoul', 101, 'foe', 3, 6, 1)])
  unit(won, 101).hp = 5
  const w = intents(won)
  assert.deepEqual([w.mine[0].falls, w.theirs, w.ended, w.over, w.winner], [[101], [], true, true, 'party'])
  // Nothing is read once no orders are taken.
  order(won, { type: 'end' })
  assert.equal(intents(won), null)
})

test('a blow a guard takes is read as guarded, the one it shielded named, as End Turn plays it; a screen\'s is not', () => {
  // The sprite's lance at the chanter, its one foe in reach; the Vanguard beside the chanter takes it (Bodyguard).
  const b = scene([
    on('monarch', 0, 'party', 3, 0),
    on('frost_sprite', 1, 'party', 0, 3, 30),
    on('bone_chanter', 101, 'foe', 0, 6, 30),
    ...[[1, 7], [2, 9], [3, 9], [4, 9]].map(([x, y], i) => on('tomb_knight', 102 + i, 'foe', x, y, 30))
  ])
  const read = intents(b).mine.find((x) => x.uid === 1)
  assert.deepEqual([read.target, read.struck, read.guarded], [101, 102, 101])
  const played = order(b, { type: 'end' }).find((e) => e.type === 'action' && e.actor === 1)
  assert.deepEqual([played.primary, played.struck, played.guarded], [101, 102, 101])
  // A screen on the line alone: struck, never guarded.
  const c = scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 0, 3, 30), on('tomb_knight', 100, 'foe', 0, 5, 30), on('bone_chanter', 101, 'foe', 0, 6, 30)])
  const events = order(c, { type: 'act', uid: 1, ability: 'frost_lance', target: 101 })
  const shot = events.find((e) => e.type === 'action' && e.actor === 1)
  assert.deepEqual([shot.struck, shot.guarded], [100, undefined])
})

// A sentry with nothing of yours in its reach holds as its turn comes (the board's HOLDS); once one stands in it, it
// acts from its tile, walking nowhere.
test('a sentry holds as its turn comes while nothing of yours is in its reach, then acts from its tile', () => {
  const far = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3, 10), on('brass_sentry', 50, 'foe', 0, 10, 1)])
  const held = intents(far).theirs.find((x) => x.uid === 50)
  assert.deepEqual([held.holds, held.ability, held.to], [true, null, null])
  const near = scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 2, 'party', 0, 6, 10), on('brass_sentry', 50, 'foe', 0, 10, 1)])
  const acts = intents(near).theirs.find((x) => x.uid === 50)
  assert.deepEqual([acts.holds, acts.ability, acts.target, acts.to], [false, 'brass_bolt', 2, null])
})
