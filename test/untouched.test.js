// What the battle's cards read ahead of the playback: End Turn's own part (untouchedPreview) and an act's preview (the
// statuses, heals and cleanses it would bring, for the aim's marks). Functional only: what is read is what plays.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { order, preview, addStatus, untouchedPreview } from '../src/sim/turns.js'
import { on, scene } from './scene.js'

const unit = (b, uid) => b.byUid.get(uid)

// The untouched part of End Turn's events (up to the foes' stage), read per piece of yours as untouchedPreview reads
// its own: [uid, ability, aimed at, damage by target].
function played (events) {
  const end = events.findIndex((e) => e.type === 'stage' && e.stage === 'foes')
  const out = []
  let cur = null
  for (const e of events.slice(0, end < 0 ? events.length : end)) {
    if (e.type === 'action' && !e.counter) out.push(cur = { uid: e.actor, ability: e.ability, target: e.primary, hits: {}, answered: false })
    else if (e.type === 'action' && e.counter && cur) cur.answered = true
    else if (e.type === 'damage' && !e.status && cur && !cur.answered) cur.hits[e.target] = (cur.hits[e.target] ?? 0) + e.damage
  }
  return out.map(({ answered, ...x }) => x)
}

test('End Turn\'s own part, read ahead: each untouched piece of yours in acting order, what it does, in sequence; nothing of the foes\' turn, and the battle untouched', () => {
  const b = scene([
    on('monarch', 0, 'party', 3, 0),
    on('tomb_knight', 1, 'party', 3, 5, 30),
    on('tomb_knight', 5, 'party', 4, 5, 30),
    on('tomb_knight', 4, 'party', 5, 5, 30),
    on('tomb_knight', 6, 'party', 2, 5, 30),
    on('hive_warden', 2, 'party', 0, 1, 30),
    on('tomb_knight', 3, 'party', 1, 1, 30),
    on('grave_ghoul', 9, 'foe', 3, 6, 1),
    on('iron_golem', 10, 'foe', 4, 6, 30)
  ])
  unit(b, 3).hp = Math.round(unit(b, 3).maxHp * 0.3)
  addStatus(b, unit(b, 4), 'hexed', 1)
  // One that has acted is no longer untouched.
  order(b, { type: 'act', uid: 6, ability: 'strike', target: 9 })
  assert.ok(unit(b, 9).hp > 0, 'the ghoul still stands for the first untouched blow')
  const before = JSON.stringify(b.units.map((u) => [u.uid, u.hp, u.tile, u.acted, u.statuses]))
  const events = b.events.length
  const p = untouchedPreview(b)
  // The battle it was read from is as it was: no event, no wound, no step, still your turn.
  assert.equal(JSON.stringify(b.units.map((u) => [u.uid, u.hp, u.tile, u.acted, u.statuses])), before)
  assert.deepEqual([b.events.length, b.turn, b.phase, b.stage], [events, 1, 'orders', 'party'])
  // Every piece of yours left untouched, in acting order: never the Monarch, never one that acted, never a foe; and one
  // that rises meanwhile (five undead hold the Legion: the ghoul they slay rises as yours) acts too, as a shadow.
  const risen = p.acts.filter((x) => !unit(b, x.uid))
  assert.deepEqual(p.acts.filter((x) => unit(b, x.uid)).map((x) => x.uid), [1, 5, 4, 2, 3])
  assert.ok(p.acts.every((x) => !unit(b, x.uid) || unit(b, x.uid).side === 'party'))
  assert.ok(risen.every((x) => x.shadow && x.id === 'grave_ghoul'))
  const by = (uid) => p.acts.find((x) => x.uid === uid)
  // In sequence: the first fells the ghoul, so the next strikes the golem, and the golem answers it.
  assert.deepEqual([by(1).ability, by(1).target, by(1).falls], ['strike', 9, [9]])
  assert.deepEqual([by(5).ability, by(5).target], ['strike', 10])
  assert.ok(by(5).hits[10] > 0 && by(5).counter > 0, 'struck, and answered')
  // Hexed: its act lost. The healer mends the wounded; the knight far from any foe does nothing.
  assert.deepEqual([by(4).hexed, by(4).ability], [true, null])
  assert.deepEqual([by(2).ability, by(2).target], [unit(b, 2).mend.id, 3])
  assert.ok(by(2).heals[3] > 0)
  assert.deepEqual([by(3).ability, by(3).hexed, Object.keys(by(3).hits)], [null, false, []])
  assert.equal(p.over, false)
  // What End Turn then plays for your side is what was read, blow for blow.
  const real = played(order(b, { type: 'end' }))
  assert.deepEqual(real, p.acts.filter((x) => x.ability).map((x) => ({ uid: x.uid, ability: x.ability, target: x.target, hits: x.hits })))
})

test('End Turn\'s own part read ahead: the last foe falling in it ends the battle there; nothing is read once no orders are taken', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 5, 30), on('grave_ghoul', 9, 'foe', 3, 6, 1)])
  unit(b, 9).hp = 5
  const p = untouchedPreview(b)
  assert.deepEqual([p.acts.length, p.acts[0].falls, p.over, p.winner], [1, [9], true, 'party'])
  const won = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 5, 30)])
  assert.ok(won.over)
  assert.equal(untouchedPreview(won), null)
  // All yours have acted: nothing to read but that.
  const done = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 5, 30), on('iron_golem', 9, 'foe', 3, 6, 30)])
  order(done, { type: 'act', uid: 1, ability: 'strike', target: 9 })
  assert.deepEqual(untouchedPreview(done).acts, [])
})

test('a preview tells the statuses an act lays (a blow\'s, a group buff\'s on every ally), every heal it lands, and what it cleanses', () => {
  const b = scene([
    on('bone_chanter', 1, 'party', 3, 4, 10),
    on('tomb_knight', 2, 'party', 2, 4, 10),
    on('hive_warden', 3, 'party', 4, 4, 10),
    on('tomb_knight', 9, 'foe', 3, 7, 10)
  ])
  // A blow that lays Brittle: its damage as before, and the status as the target would wear it.
  const bolt = preview(b, 1, 'marrow_bolt', 9)
  assert.ok(bolt.damage > 0 && bolt.hits[9] === bolt.damage)
  assert.deepEqual(bolt.statuses[9]?.map((s) => s.id), ['brittle'])
  assert.ok(bolt.statuses[9][0].dur > 0)
  assert.deepEqual([bolt.heals, bolt.cleansed, bolt.rises], [{}, {}, []])
  // A group buff: every ally it reaches wears it.
  const dirge = preview(b, 1, 'dirge', 1)
  assert.deepEqual(Object.keys(dirge.statuses).map(Number).sort(), [1, 2, 3])
  assert.ok(Object.values(dirge.statuses).every((l) => l.length === 1 && l[0].id === 'hasten'))
  // A cleanse and a heal: what it strips, and what it mends, on the one it is aimed at.
  unit(b, 2).hp = Math.round(unit(b, 2).maxHp / 2)
  addStatus(b, unit(b, 2), 'withered', 3)
  const purge = preview(b, 3, 'purge', 2)
  assert.deepEqual(purge.cleansed, { 2: ['withered'] })
  assert.ok(purge.heals[2] > 0 && purge.heal === purge.heals[2])
  assert.ok(!purge.statuses[2], 'nothing laid')
  // Read on a copy: the battle is as it was.
  assert.ok(unit(b, 2).statuses.some((s) => s.id === 'withered'))
})
