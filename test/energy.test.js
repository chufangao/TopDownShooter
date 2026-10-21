// Energy: a unit's budget a turn (TUNING.energy: base + its Move), spent by the tile, its basic and a skill; a walk
// alone goes farther than a walk and a strike; a skill after a walk costs a tile of it; Undo gives the walk's energy
// back; a Rooted piece walks no tile and keeps its energy for its acts; the foes' reckoning and options keep to it.
// Functional only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { order, reach, usable, energyOf, left, tilesLeft, stride, costOf, addStatus, intents, legalOrders } from '../src/sim/turns.js'
import { options, threatOf, danger } from '../src/sim/foe.js'
import { situation, blowOn } from '../src/sim/read.js'
import { abilityDef } from '../src/content.js'
import { TUNING } from '../src/tuning.js'
import { on, scene, unit } from './scene.js'
import { tileAt, distanceBetween } from '../src/sim/unit.js'

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

test('Reaper\'s Hunger gives the act back and its basic\'s energy, never the walk: the act committed it, so no Undo', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3, 10, [0, 0], ['reapers_hunger']), on('grave_ghoul', 9, 'foe', 3, 5, 1), on('grave_ghoul', 8, 'foe', 1, 9, 10)])
  const k = unit(b, 1)
  unit(b, 9).hp = 1
  order(b, { type: 'move', uid: 1, tile: tileAt(3, 4) })
  const events = order(b, { type: 'act', uid: 1, ability: 'cleave', target: 9 })
  assert.ok(events.some((e) => e.rule === 'reapers_hunger') && !k.acted, 'the kill gives its act back')
  assert.equal(k.spent, E.tile + E.skill - E.basic)
  assert.throws(() => order(b, { type: 'undo', uid: 1 }), /no move to undo/)
  assert.deepEqual([k.tile, k.moved, k.spent, left(k)], [tileAt(3, 4), 1, E.tile + E.skill - E.basic, k.energy - (E.tile + E.skill - E.basic)], 'the walk stands, its tile still spent')
})

test('the danger map and a foe\'s reach read its next turn\'s energy at its Move now: a foe freed of Rooted comes its whole walk, a Rooted one walks none and keeps its skill', () => {
  const make = () => scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 2, 10), on('grave_ghoul', 9, 'foe', 3, 7, 10)])
  const fresh = make()
  // Rooted for its turn: it stays where it stood, its budget that turn whole (base + its Move); the Root runs out at the
  // turn's end.
  const b = make()
  const g = unit(b, 9)
  addStatus(b, g, 'rooted', 1)
  order(b, { type: 'end' })
  assert.deepEqual([g.tile, g.energy, g.statuses.length, energyOf(b, g)], [unit(fresh, 9).tile, E.base + 2, 0, E.base + 2])
  assert.deepEqual(threatOf(b, g), threatOf(fresh, unit(fresh, 9)), 'its reach as a fresh foe\'s')
  assert.deepEqual(danger(b, 'party').ground, danger(fresh, 'party').ground, 'the danger map as a fresh foe\'s')
  // Rooted now: no tile walked, its energy whole, so its skill (3 of base + 2) as its basic, from where it stands.
  const r = make()
  const rg = unit(r, 9)
  addStatus(r, rg, 'rooted', 1)
  order(r, { type: 'move', uid: 1, tile: tileAt(3, 3) })
  assert.deepEqual([rg.move, energyOf(r, rg)], [0, E.base + 2])
  assert.deepEqual(threatOf(r, rg).move, [rg.tile])
  const gnawOnly = { ...rg, kit: rg.kit.filter((a) => a.id === 'gnaw') }
  const strikeOnly = { ...rg, kit: rg.kit.filter((a) => a.id === 'strike') }
  assert.ok(threatOf(r, gnawOnly).ground.length > 0, 'its skill strikes from where it stands')
  assert.deepEqual(threatOf(r, gnawOnly).ground, threatOf(r, strikeOnly).ground)
})

test('Rooted keeps its acts: its energy is base + its Move as if free, it walks no tile and pays its skill where it stands; a cut to its Move still cuts it', () => {
  // A Rooted knight beside a Ghoul, both lasting; the Root holds through its next turn.
  const make = (opts) => {
    const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4, 10), on('grave_ghoul', 9, 'foe', 3, 5, 10)], opts)
    for (const uid of [1, 9]) unit(b, uid).hp = unit(b, uid).maxHp = 9999
    addStatus(b, unit(b, 1), 'rooted', 2)
    order(b, { type: 'end' })
    return b
  }
  const b = make()
  const k = unit(b, 1)
  assert.ok(k.statuses.some((s) => s.id === 'rooted'), 'Rooted through its turn')
  assert.deepEqual([k.move, k.energy, energyOf(b, k), tilesLeft(k), stride(k), reach(b, k).size], [0, E.base + 2, E.base + 2, 0, 0, 0])
  assert.ok(!legalOrders(b).some((o) => o.type === 'move' && o.uid === 1), 'no tile to walk')
  const cleave = k.kit.find((a) => a.id === 'cleave')
  assert.ok(usable(b, k, cleave), 'its skill paid')
  order(b, { type: 'act', uid: 1, ability: 'cleave', target: 9 })
  assert.equal(k.spent, E.skill)
  // A cut to its Move (a mod that lowers it) still cuts its energy: only the hold is lifted.
  const slow = make({ partyMods: [{ path: 'move', op: 'add', v: -1 }] })
  assert.deepEqual([unit(slow, 1).move, energyOf(slow, unit(slow, 1)), unit(slow, 1).energy], [0, E.base + 1, E.base + 1])
})

test('the foes\' energy is theirs as their turn begins: the Sovereign\'s tide comes first on its turn, after a Rooted turn as after any', () => {
  for (const root of [false, true]) {
    const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3, 10), on('tomb_knight', 2, 'party', 2, 3, 10), on('hollow_sovereign', 9, 'foe', 3, 9, 1)])
    const s = unit(b, 9)
    s.hp = Math.floor(s.maxHp / 2)
    order(b, { type: 'end' })
    if (root) addStatus(b, s, 'rooted', 1)
    order(b, { type: 'end' })
    assert.equal(b.turn % 3, 0, 'the tide\'s turn')
    const events = order(b, { type: 'end' })
    const first = events.slice(events.findIndex((e) => e.type === 'stage' && e.stage === 'foes') + 1).find((e) => e.type === 'move' || e.type === 'action')
    assert.deepEqual([first.type, first.actor, first.ability], ['action', 9, 'grave_tide'], root ? 'after a Rooted turn' : 'as ever')
  }
})

test('the board\'s read counts a piece\'s kill this turn by what each blow costs: none by a blow whose walk it cannot pay', () => {
  // A Hive Queen's Royal Scythe outhits its Strike, but costs a tile more of its walk: the foe it reaches only by
  // Strike's longer walk is no kill by the Scythe this turn.
  const q = scene([on('monarch', 0, 'party', 3, 0), on('hive_queen', 1, 'party', 3, 2, 3), on('grave_ghoul', 9, 'foe', 3, 6, 10)])
  const queen = unit(q, 1)
  const ghoul = unit(q, 9)
  const strike = blowOn(q, queen, abilityDef('strike'), ghoul)
  const scythe = blowOn(q, queen, abilityDef('royal_scythe'), ghoul)
  assert.ok(scythe > strike)
  assert.equal(distanceBetween(queen.tile, queen.size, ghoul.tile, 1), stride(queen) + 1)
  ghoul.hp = strike + 1
  q.cache = new Map()
  assert.ok(!options(q, queen).some((o) => o.ability?.id === 'royal_scythe'), 'no Scythe from any tile it may walk to')
  assert.deepEqual(situation(q).killable, [], 'no kill it cannot make')
  ghoul.hp = strike
  q.cache = new Map()
  assert.deepEqual(situation(q).killable, [{ uid: 9, by: [1] }], 'the Strike\'s kill')
})
