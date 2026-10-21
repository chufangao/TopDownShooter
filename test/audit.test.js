// The audit of 2026-10-21: each rule a bug broke, as it now stands.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { order, legalOrders, addStatus, targetsFrom, pick, fork } from '../src/sim/turns.js'
import { tileAt } from '../src/sim/unit.js'
import { createRun, apply, join, releaseRefund, tierRefund, recruitCost, START_PARTY } from '../src/sim/run.js'
import { tierPrice } from '../src/sim/economy.js'
import { TUNING } from '../src/tuning.js'
import { on, scene, unit } from './scene.js'

test('Undo: a walk an act committed stays committed, Reaper\'s Hunger\'s act again too', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3, 3, [0, 0], ['reapers_hunger', 'trample']), on('grave_ghoul', 10, 'foe', 3, 6, 1), on('grave_ghoul', 11, 'foe', 2, 6, 1), on('grave_ghoul', 12, 'foe', 1, 9, 1)])
  const k = unit(b, 1)
  unit(b, 10).hp = 1
  order(b, { type: 'move', uid: 1, tile: tileAt(3, 5) })
  assert.ok(legalOrders(b).some((o) => o.type === 'undo' && o.uid === 1), 'a walk not yet acted on may be undone')
  order(b, { type: 'act', uid: 1, ability: k.basic.id, target: 10 })
  assert.equal(k.acted, false, 'Hunger gave the act back')
  assert.ok(!legalOrders(b).some((o) => o.type === 'undo' && o.uid === 1))
  assert.throws(() => order(b, { type: 'undo', uid: 1 }), /no move to undo/)
  assert.equal(k.tile, tileAt(3, 5))
})

test('Hex: one laid on a foe\'s walk (an Overwatch\'s) costs the act it walked to, and it shrugs until it acts', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('pale_court', 1, 'party', 3, 3, 3, [0, 0], ['overwatch']), on('tomb_knight', 2, 'party', 4, 4, 3), on('grave_ghoul', 10, 'foe', 3, 8, 3)])
  unit(b, 10).hp = unit(b, 10).maxHp = 999
  unit(b, 1).acted = true
  unit(b, 2).acted = true
  const ev = order(b, { type: 'end' })
  assert.ok(ev.some((e) => e.type === 'status' && e.target === 10 && e.status === 'hexed'), 'the Overwatch laid its Hex')
  assert.ok(ev.some((e) => e.type === 'hexed' && e.target === 10), 'the Hex cost the act')
  assert.ok(!ev.some((e) => e.type === 'action' && e.actor === 10), 'the ghoul struck nothing')
  assert.equal(unit(b, 10).shrugs, true)
})

test('the battle ends the instant the last foe falls on a walk\'s moment: a Trample in your orders', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3, 3, [0, 0], ['trample']), on('grave_ghoul', 10, 'foe', 3, 6, 1), on('grave_ghoul', 11, 'foe', 2, 6, 1)])
  unit(b, 10).hp = 1
  unit(b, 11).hp = 5
  order(b, { type: 'move', uid: 1, tile: tileAt(3, 5) })
  order(b, { type: 'act', uid: 1, ability: unit(b, 1).basic.id, target: 10 })
  assert.equal(b.over, true)
  assert.equal(b.winner, 'party')
  assert.deepEqual(legalOrders(b), [])
})

test('the battle ends the instant the last foe falls on a walk\'s moment: an Overwatch in the foes\' turn, before the round\'s ticks', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 3, 3, 3, [0, 0], ['overwatch']), on('grave_ghoul', 10, 'foe', 3, 8, 3)])
  unit(b, 10).hp = 5
  const m = unit(b, 0)
  m.hp = 5
  addStatus(b, m, 'bleeding', 2, unit(b, 10))
  unit(b, 1).acted = true
  order(b, { type: 'end' })
  assert.equal(b.winner, 'party')
  assert.equal(m.hp, 5, 'no tick after the win')
})

test('the round\'s ticks stop once the battle is decided: the last foe burning to death wins it before the Monarch bleeds', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 3, 3), on('grave_ghoul', 10, 'foe', 6, 9, 3)])
  const g = unit(b, 10)
  addStatus(b, g, 'rooted', 1, unit(b, 1))
  g.hp = 5
  addStatus(b, g, 'burning', 3, unit(b, 1))
  const m = unit(b, 0)
  m.hp = 5
  addStatus(b, m, 'bleeding', 2, g)
  unit(b, 1).acted = true
  order(b, { type: 'end' })
  assert.equal(b.winner, 'party')
  assert.equal(m.hp, 5)
})

test('an all-foes act is legal at every primary it may name, End Turn\'s pick among them', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('hive_spitter', 1, 'party', 3, 3, 3, [4, 0]), on('grave_ghoul', 10, 'foe', 1, 6, 3), on('grave_ghoul', 11, 'foe', 3, 5, 3)])
  const u = unit(b, 1)
  assert.equal(u.basic.shape, 'all')
  const list = targetsFrom(b, u, u.basic)
  const legal = legalOrders(b).filter((o) => o.type === 'act' && o.uid === 1 && o.ability === u.basic.id).map((o) => o.target)
  assert.deepEqual(legal.sort(), list.map((x) => x.uid).sort())
  assert.ok(legal.includes(pick(b, u, list).uid))
  const f = fork(b)
  order(f, { type: 'act', uid: 1, ability: u.basic.id, target: pick(b, u, list).uid })
  assert.equal(f.byUid.get(1).acted, true)
})

test('a tier given free pays nothing back: Soul Lantern\'s on a release, so a recruit let go at once never pays', () => {
  const run = createRun({ start: START_PARTY, seed: 'free-tier' })
  const s = run.state
  s.relics.push('soul_lantern', 'soul_lantern')
  const u = join(run, 'grave_ghoul')
  assert.deepEqual(u.tracks, [1, 1])
  assert.equal(tierRefund(run, u), 0)
  assert.equal(releaseRefund(run, u), Math.floor(TUNING.essence.refund * recruitCost(run, u.id)))
  assert.ok(releaseRefund(run, u) < recruitCost(run, u.id))
  // A tier bought on top of them pays back as any tier bought does.
  s.essence = 1000
  apply(run, { type: 'upgrade', uid: u.uid, track: 0 })
  assert.deepEqual(u.tracks, [2, 1])
  assert.equal(tierRefund(run, u), Math.floor(TUNING.essence.refund * tierPrice(run, 1)))
})
