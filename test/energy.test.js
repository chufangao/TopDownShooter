// Energy: a unit's budget a turn (TUNING.energy: base + its Move), spent by the tile, its basic and a skill; a walk
// alone goes farther than a walk and a strike; a skill after a walk costs a tile of it; Undo gives the walk's energy
// back; a Rooted piece walks no tile; the foes' reckoning and options keep to it. Functional only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { order, reach, usable, energyOf, left, tilesLeft, stride, costOf, addStatus, intents } from '../src/sim/turns.js'
import { options } from '../src/sim/foe.js'
import { TUNING } from '../src/tuning.js'
import { on, scene, unit } from './scene.js'
import { tileAt } from '../src/sim/unit.js'

const E = TUNING.energy

test('a Move-2 piece has base + 2 energy: four tiles alone, two tiles and its basic, one tile and a skill; what it cannot pay for it cannot do', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 2, 10), on('grave_ghoul', 9, 'foe', 3, 9, 10)])
  const k = unit(b, 1)
  assert.equal(k.move, 2)
  assert.equal(energyOf(b, k), E.base + 2)
  assert.deepEqual([k.energy, left(k), tilesLeft(k), stride(k), stride(k, k.kit.find((a) => a.id === 'cleave'))], [E.base + 2, E.base + 2, E.base + 2, E.base + 2 - E.basic, E.base + 2 - E.skill])
  const far = Math.max(...[...reach(b, k).values()].map((p) => p.length))
  assert.equal(far, E.base + 2, 'a walk alone goes the whole budget')
  // Two tiles, then its basic: paid. Three tiles: no basic left.
  order(b, { type: 'move', uid: 1, tile: [...reach(b, k)].find(([, p]) => p.length === 2)[0] })
  assert.deepEqual([k.spent, left(k), tilesLeft(k)], [2 * E.tile, E.base + 2 - 2 * E.tile, E.base + 2 - 2 * E.tile])
  assert.ok(usable(b, k, k.basic) && !usable(b, k, k.kit.find((a) => a.id === 'cleave')), 'its basic paid, its skill not')
  order(b, { type: 'undo', uid: 1 })
  assert.deepEqual([k.spent, k.moved], [0, 0], 'Undo gives the walk back')
  order(b, { type: 'move', uid: 1, tile: [...reach(b, k)].find(([, p]) => p.length === 3)[0] })
  assert.ok(!usable(b, k, k.basic) && !usable(b, k, k.kit.find((a) => a.id === 'cleave')), 'three tiles: nothing left to strike with')
  assert.equal(energyOf(b, unit(b, 0)), 0)
  // Walked up to a foe on its whole budget, it strikes nothing at End Turn: its intent says so, and so it plays.
  const c = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 2, 10), on('grave_ghoul', 9, 'foe', 3, 7, 10)])
  const ck = unit(c, 1)
  order(c, { type: 'move', uid: 1, tile: tileAt(3, 6) })
  assert.ok(left(ck) < E.basic, 'nothing left for its basic')
  assert.equal(intents(c).mine.find((x) => x.uid === 1).ability, null)
  const played = order(c, { type: 'end' })
  assert.ok(!played.some((e) => e.type === 'action' && e.actor === 1 && !e.counter), 'no free strike at End Turn (a counter is no act)')
})

test('an act spends its cost: a basic after the walk, a skill after a shorter one; Rooted walks no tile and keeps its basic', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4, 10), on('grave_ghoul', 9, 'foe', 3, 5, 10)])
  const k = unit(b, 1)
  order(b, { type: 'act', uid: 1, ability: 'strike', target: 9 })
  assert.deepEqual([k.acted, k.spent], [true, costOf(k, k.basic)])
  const c = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4, 10), on('grave_ghoul', 9, 'foe', 3, 5, 10)])
  order(c, { type: 'act', uid: 1, ability: 'cleave', target: 9 })
  assert.equal(unit(c, 1).spent, E.skill)
  // A Rooted foe, its road open and one of yours in its reach: it walks no tile in its turn, and still bites.
  const r = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4, 10), on('grave_ghoul', 9, 'foe', 3, 6, 10)])
  addStatus(r, unit(r, 9), 'rooted', 2)
  const events = order(r, { type: 'end' })
  assert.ok(!events.some((e) => e.type === 'move' && e.actor === 9), 'Rooted: no tile')
  assert.ok(events.some((e) => e.type === 'action' && e.actor === 9 && !e.counter), 'its basic still paid')
})

test('a foe\'s options keep to its energy: a far tile with no act, a near one with its blow, never both at the full walk', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3, 10), on('grave_ghoul', 9, 'foe', 3, 8, 10)])
  const g = unit(b, 9)
  b.stage = 'foes'
  const opts = options(b, g)
  assert.ok(opts.every((o) => o.path.length * E.tile + (o.ability ? costOf(g, o.ability) : 0) <= g.energy), 'every option within its energy')
  assert.ok(opts.some((o) => !o.ability && o.path.length > g.move), 'a walk alone goes past its Move')
  assert.ok(opts.every((o) => !o.ability || o.path.length <= g.energy - costOf(g, o.ability)), 'an act only from a tile it can still pay from')
})
