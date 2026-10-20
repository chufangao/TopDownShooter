import { test } from 'node:test'
import assert from 'node:assert/strict'
import { field, targetsFrom, order, addStatus, untouchedPreview, preview, legalOrders } from '../src/sim/turns.js'
import {
  makeUnit, tileAt, DEPTH, ROWS, TILES, sizeOf, fits, footprintSlots, distanceBetween, deployTile, monarchSlot, wallTiles, armOf, reachOf,
  blowReach
} from '../src/sim/unit.js'
import { CAMP_LIST, abilityDef, RELICS } from '../src/content.js'
import { frontier, START_PARTY } from '../src/sim/run.js'
import { on, scene, unit } from './scene.js'

// Reach: a blow's range and nothing else, from where a piece stands after its move; your melee
// reaches 1, or 2 for a long arm. (The foes' roads, and that your pieces hold them, are test/turns.test.js's and
// test/policy.test.js's.)

test('your melee reaches 1, or 2 for a long arm; a tier that grows a blow\'s range grows only that blow\'s reach', () => {
  assert.deepEqual(['tomb_knight', 'ember_drake', 'grave_ghoul', 'mantis_reaper', 'hive_queen'].map((id) => armOf({ id })), [1, 1, 2, 2, 1])
  // Golems round a piece of yours at (3, 4): one beside it, one 2 tiles off, one 3 off.
  const reaches = (piece) => {
    const b = scene([on('monarch', 0, 'party', 0, 0), piece, on('iron_golem', 10, 'foe', 4, 5, 9), on('iron_golem', 11, 'foe', 3, 6, 9), on('iron_golem', 12, 'foe', 3, 7, 9)])
    const u = b.byUid.get(piece.uid)
    return (ability) => targetsFrom(b, u, u.kit.find((a) => a.id === ability)).map((x) => x.uid)
  }
  // An Ember Drake: its Strike reaches 1, its Ember Burst its range.
  const drake = reaches(on('ember_drake', 1, 'party', 3, 4))
  assert.deepEqual([drake('strike'), drake('ember_burst')], [[10], [10, 11, 12]])
  // A Grave Ghoul's melee, a long arm, reaches 2.
  assert.deepEqual(reaches(on('grave_ghoul', 1, 'party', 3, 4))('strike'), [10, 11])
  // A Mantis Reaper with Phantom IV: Reap at its arm, Phantom Edge at its range, a tile past it.
  const mantis = { id: 'mantis_reaper', tracks: [0, 4] }
  assert.deepEqual([blowReach(mantis, abilityDef('reap')), blowReach(mantis, abilityDef('phantom_edge')), reachOf(mantis)], [2, 3, 3])
  assert.deepEqual(reaches(on('mantis_reaper', 1, 'party', 3, 4, 3, [0, 4]))('phantom_edge'), [10, 11, 12])
})

// The roads a ground foe takes from each tile of the foes' rows to the seat, each a list of tiles (the seat last).
function entryRoads (camp) {
  const seat = deployTile('party', monarchSlot(camp))
  const roads = field({ root: seat, walls: wallTiles(camp) })
  const out = []
  for (let t = tileAt(0, DEPTH - ROWS); t < TILES; t++) {
    const road = []
    for (let x = t; x >= 0; x = roads.arrow[x]) road.push(x)
    out.push(road)
  }
  return { seat, roads, out }
}

test('the default frontier: each start soul on a cell of its own, the Tomb Knight on the road most foes walk, the others\' reach all round it', () => {
  const start = START_PARTY.map((id, i) => makeUnit(id, { uid: 1 + i, lvl: 2 }))
  for (const c of CAMP_LIST.filter((x) => x.floor === 1)) {
    const slots = frontier(c.id, start)
    assert.deepEqual(frontier(c.id, start), slots, 'deterministic')
    assert.ok(start.every((u) => u.slot === -1), 'pure: the pieces untouched')
    const taken = new Set([monarchSlot(c.id)])
    start.forEach((u, i) => {
      assert.ok(fits(c.id, slots[i], sizeOf(u), taken), `${c.id}: ${u.id} on ${slots[i]}`)
      for (const x of footprintSlots(slots[i], sizeOf(u))) taken.add(x)
    })
    const { out } = entryRoads(c.id)
    const knight = deployTile('party', slots[0])
    assert.equal(start[0].id, 'tomb_knight')
    assert.ok(out.filter((road) => road.includes(knight)).length > out.length / 2, `${c.id}: the Knight on most roads, in a ground foe's way`)
    start.slice(1).forEach((u, i) => assert.ok(distanceBetween(deployTile('party', slots[i + 1]), sizeOf(u), knight, 1) <= Math.max(1, reachOf(u) - reachOf(start[0])), `${c.id}: ${u.id} reaches round the Knight`))
  }
  // A bigger army, 2×2 pieces among them, finds a cell of its own in every camp; the tankiest melee piece leads.
  const army = ['frost_sprite', 'bone_colossus', 'tomb_knight', 'bone_chanter', 'hive_queen', 'grave_ghoul', 'ember_drake', 'clockwork_page', 'will_o_wisp', 'iron_golem']
    .map((id, i) => makeUnit(id, { uid: 1 + i, lvl: 3 }))
  for (const c of CAMP_LIST) {
    const slots = frontier(c.id, army)
    const taken = new Set([monarchSlot(c.id)])
    army.forEach((u, i) => {
      if (slots[i] < 0) return
      assert.ok(fits(c.id, slots[i], sizeOf(u), taken), `${c.id}: ${u.id} on ${slots[i]}`)
      for (const x of footprintSlots(slots[i], sizeOf(u))) taken.add(x)
    })
    assert.ok(slots.filter((s) => s >= 0).length >= 8, `${c.id}: ${slots}`)
  }
})

// ── movement as a channel ─────────────────────────────────────────────────────

// The elements that read movement: a piece's own tiles moved this turn or its target's (`per: { moved }`, `per: {
// walked }`, a trigger's `when`), and a walk once committed (the 'move' moment, rules.js onMove), told as the piece acts
// or in End Turn's untouched pass, never on the walk: an Undo leaves nothing to unwind. Each on a board built tile by
// tile; the far Golem keeps a battle from ending on a wipe, the Monarch sits in the corner out of everyone's way.
const board = (units) => {
  const b = scene([on('monarch', 0, 'party', 0, 0), ...units, on('iron_golem', 99, 'foe', 6, 10, 1)], { ablate: ['summons'] })
  // The far Golem stays far: Rooted for the battle (its energy would walk it three tiles a turn).
  addStatus(b, unit(b, 99), 'rooted', 'battle')
  return b
}
// Piece `uid` uses its basic on `target` (→ the events), or walks to (x, y).
const basic = (b, uid, target) => order(b, { type: 'act', uid, ability: unit(b, uid).basic.id, target })
const walkTo = (b, uid, x, y) => order(b, { type: 'move', uid, tile: tileAt(x, y) })
// The damage a relic's effect dealt (no ability: a trigger's), by `actor`, as [target, damage].
const dealt = (events, actor) => events.filter((e) => e.type === 'damage' && e.ability === null && !e.status && e.actor === actor).map((e) => [e.target, e.damage])
const fired = (events, relic) => events.filter((e) => e.type === 'trigger' && e.relic === relic)
const watches = (events) => events.filter((e) => e.type === 'rule' && e.rule === 'overwatch')
// Foes that last: HP enough that no test's blows fell them.
const tough = (b, ...uids) => { for (const uid of uids) unit(b, uid).hp = unit(b, uid).maxHp = 999 }

test('Momentum: 6 true damage a tile its holder moved this turn, none standing still; an Undo and a second walk count the second alone', () => {
  // A Frost Sprite (Move 3, Frost Lance at 3) shoots a Tomb Knight at (3, 6) from (3, 3), having walked there from (3,
  // y); no lock to cut what the relic deals (keys.test.js).
  const shoot = (y) => {
    const b = board([on('frost_sprite', 1, 'party', 3, y, 3, [0, 0], ['momentum']), on('tomb_knight', 10, 'foe', 3, 6, 9)])
    if (y !== 3) walkTo(b, 1, 3, 3)
    assert.equal(unit(b, 1).moved, 3 - y)
    return dealt(basic(b, 1, 10), 1)
  }
  assert.deepEqual(shoot(3), [], 'still: nothing')
  assert.deepEqual(shoot(2), [[10, 6]])
  assert.deepEqual(shoot(0), [[10, 18]])
  // Three tiles, undone, then two: the blow counts the two, once.
  const b = board([on('frost_sprite', 1, 'party', 3, 1, 3, [0, 0], ['momentum']), on('tomb_knight', 10, 'foe', 3, 6, 9)])
  walkTo(b, 1, 3, 4)
  order(b, { type: 'undo', uid: 1 })
  assert.equal(unit(b, 1).moved, 0)
  walkTo(b, 1, 3, 3)
  const events = basic(b, 1, 10)
  assert.equal(fired(events, 'momentum').length, 1)
  assert.deepEqual(dealt(events, 1), [[10, 12]])
  assert.deepEqual(RELICS.momentum.effects, [{ op: 'damage', amount: 6, per: { moved: 'actor' }, to: 'other' }])
})

test('Quarry: 15 true damage more to a foe that walked on its last turn; nothing on one that stood through it', () => {
  const field = () => {
    const b = board([on('frost_sprite', 1, 'party', 3, 3, 3, [0, 0], ['quarry']), on('grave_ghoul', 10, 'foe', 3, 6)])
    tough(b, 10)
    return b
  }
  // As the battle opens nothing has walked.
  const b = field()
  assert.deepEqual(dealt(basic(b, 1, 10), 1), [])
  order(b, { type: 'end' })
  const ghoul = unit(b, 10)
  assert.ok(ghoul.moved > 0, 'it walked in the foes\' turn, and your orders still read it')
  const shot = legalOrders(b).find((o) => o.type === 'act' && o.uid === 1 && o.target === 10)
  assert.ok(shot, 'in reach')
  assert.deepEqual(dealt(order(b, shot), 1), [[10, 15]], 'once, whatever its tiles')
  // Rooted, the Ghoul stands through the foes' turn: no Quarry.
  const still = field()
  basic(still, 1, 10)
  addStatus(still, unit(still, 10), 'rooted', null, unit(still, 1))
  const was = unit(still, 10).tile
  order(still, { type: 'end' })
  assert.deepEqual([unit(still, 10).tile, unit(still, 10).moved], [was, 0])
  assert.deepEqual(dealt(basic(still, 1, 10), 1), [])
})

test('Bastion: its holder struck on a turn it has not moved deals its attacker 12 true damage; after a move, nothing', () => {
  // A Tomb Knight holding the line before a Grave Ghoul; End Turn: the Knight strikes, the Ghoul answers and strikes it.
  const play = (y) => {
    const b = board([on('tomb_knight', 1, 'party', 3, y, 3, [0, 0], ['bastion']), on('grave_ghoul', 10, 'foe', 3, 4)])
    tough(b, 10)
    if (y !== 3) walkTo(b, 1, 3, 3)
    const events = order(b, { type: 'end' })
    assert.ok(events.some((e) => e.type === 'damage' && e.target === 1 && e.actor === 10), 'struck')
    return events
  }
  const still = play(3)
  assert.ok(fired(still, 'bastion').length >= 1)
  assert.ok(dealt(still, 1).length >= 1 && dealt(still, 1).every(([t, d]) => t === 10 && d === 12), JSON.stringify(dealt(still, 1)))
  const moved = play(2)
  assert.deepEqual([fired(moved, 'bastion'), dealt(moved, 1)], [[], []], 'it moved this turn')
  assert.deepEqual(RELICS.bastion.when, { still: true })
})

test('Trample: 10 true damage to each foe beside where its holder ends, told as it acts, never on the walk; nothing after an Undo', () => {
  // A Tomb Knight walks (3, 2) → (3, 3): Grave Ghouls at (3, 4) and (2, 4) beside it, a Frost Sprite at (5, 5) two tiles
  // off (no fourth Vanguard among the foes: their Bodyguard would lessen the damage).
  const field = () => {
    const b = board([on('tomb_knight', 1, 'party', 3, 2, 3, [0, 0], ['trample']), on('grave_ghoul', 10, 'foe', 3, 4), on('grave_ghoul', 11, 'foe', 2, 4), on('frost_sprite', 12, 'foe', 5, 5)])
    tough(b, 10, 11, 12)
    return b
  }
  const b = field()
  const walked = walkTo(b, 1, 3, 3)
  assert.deepEqual([fired(walked, 'trample'), dealt(walked, 1)], [[], []], 'nothing on the walk')
  // The act's preview shows the moment's damage, though it comes after the Ghoul's answer: it is the act's.
  const seen = preview(b, 1, unit(b, 1).basic.id, 10)
  assert.equal(seen.hits[11], 10, JSON.stringify(seen.hits))
  const acted = basic(b, 1, 10)
  assert.equal(fired(acted, 'trample').length, 1)
  assert.deepEqual(dealt(acted, 1).sort(), [[10, 10], [11, 10]])
  assert.ok(acted.findIndex((e) => e.type === 'trigger' && e.relic === 'trample') > acted.findIndex((e) => e.type === 'action' && e.actor === 1), 'after the act')
  // Told once: End Turn tells nothing again.
  assert.deepEqual(fired(order(b, { type: 'end' }), 'trample'), [])
  // Walked and undone, then End Turn: the Knight strikes nothing from (3, 2), and no moment comes.
  const undone = field()
  walkTo(undone, 1, 3, 3)
  order(undone, { type: 'undo', uid: 1 })
  assert.deepEqual(fired(order(undone, { type: 'end' }), 'trample'), [])
  // Walked and given no act: the untouched pass tells it, in its stage, and the End Turn card shows it.
  const left = field()
  walkTo(left, 1, 3, 3)
  const card = untouchedPreview(left).acts.find((x) => x.uid === 1)
  assert.equal(card.hits[11], 10, JSON.stringify(card.hits))
  const events = order(left, { type: 'end' })
  const at = events.findIndex((e) => e.type === 'trigger' && e.relic === 'trample')
  assert.ok(at > 0 && at < events.findIndex((e) => e.type === 'stage' && e.stage === 'foes'), 'in the untouched pass')
})

test('Overwatch: the holder\'s basic strikes a foe ending its walk within its reach, as a counter, once a turn; never a flyer a melee holder cannot strike', () => {
  // A Frost Sprite at (3, 3) (Frost Lance, reach 3): two Grave Ghouls walk to within 3 of it in the foes' turn.
  const b = board([on('frost_sprite', 1, 'party', 3, 3, 3, [0, 0], ['overwatch']), on('grave_ghoul', 10, 'foe', 3, 8), on('grave_ghoul', 11, 'foe', 4, 8)])
  tough(b, 10, 11)
  const first = order(b, { type: 'end' })
  const said = watches(first)
  assert.equal(said.length, 1, 'once a turn, though both end in reach')
  const struck = said[0].target
  const i = first.indexOf(said[0])
  assert.deepEqual([first[i - 1].type, first[i - 1].actor], ['move', struck], 'as its walk resolves')
  const blow = first[i + 1]
  assert.deepEqual([blow.type, blow.actor, blow.ability, blow.targets], ['action', 1, 'frost_lance', [struck]])
  assert.ok(first.some((e) => e.type === 'move' && e.actor === 21 - struck), 'the other walked too')
  // The next turn it watches again.
  assert.equal(watches(order(b, { type: 'end' })).length, 1)
  // A Tomb Knight (melee, on the ground) at (1, 4): an Ash Wyvern ends beside it, unstruck; a foe Tomb Knight is struck.
  const knight = (foe) => {
    const k = board([on('tomb_knight', 1, 'party', 1, 4, 3, [0, 0], ['overwatch']), on(foe, 10, 'foe', 1, 7)])
    tough(k, 10)
    return [...order(k, { type: 'end' }), ...order(k, { type: 'end' })]
  }
  const flyer = knight('ash_wyvern')
  assert.ok(flyer.some((e) => e.type === 'move' && e.actor === 10 && distanceBetween(e.to, 1, tileAt(1, 4), 1) === 1), 'the Wyvern ended beside the Knight')
  assert.deepEqual(watches(flyer), [])
  const ground = knight('tomb_knight')
  assert.ok(watches(ground).length >= 1)
  // Struck as a counter is: never answered, though the foe Knight's own blow is melee.
  const j = ground.indexOf(watches(ground)[0])
  assert.deepEqual([ground[j + 1].type, ground[j + 1].actor, ground[j + 1].targets], ['action', 1, [10]])
  const next = ground.slice(j + 2).find((e) => e.type === 'action')
  assert.ok(next && !(next.counter && next.actor === 10), `no answer to the Overwatch blow: ${JSON.stringify(next)}`)
})

test('Hold the Line: its holder and a still ally beside it deal 25% more; not one that moved, nor one two tiles off', () => {
  // A Frost Sprite at (3, 3) shoots a Grave Ghoul at (3, 6); the holder, a Tomb Knight, stands at (kx, 3).
  const shot = (kx, { relic = true, from = 3 } = {}) => {
    const b = board([on('tomb_knight', 2, 'party', kx, 3, 3, [0, 0], relic ? ['hold_the_line'] : []), on('frost_sprite', 1, 'party', 3, from), on('grave_ghoul', 10, 'foe', 3, 6)])
    tough(b, 10)
    if (from !== 3) walkTo(b, 1, 3, 3)
    return basic(b, 1, 10).find((e) => e.type === 'damage' && e.actor === 1).damage
  }
  const plain = shot(2, { relic: false })
  const more = Math.round(plain * RELICS.hold_the_line.params.mul)
  assert.ok(more > plain)
  assert.equal(shot(2), more, 'a still ally beside it')
  assert.equal(shot(2, { from: 2 }), plain, 'it moved')
  assert.equal(shot(1), plain, 'two tiles off')
  // The holder itself, still and having moved: its Strike at a Ghoul beside it.
  const own = (relic, y) => {
    const b = board([on('tomb_knight', 1, 'party', 3, y, 3, [0, 0], relic ? ['hold_the_line'] : []), on('grave_ghoul', 10, 'foe', 3, 4)])
    tough(b, 10)
    if (y !== 3) walkTo(b, 1, 3, 3)
    return basic(b, 1, 10).find((e) => e.type === 'damage' && e.actor === 1).damage
  }
  const strike = own(false, 3)
  assert.equal(own(true, 3), Math.round(strike * RELICS.hold_the_line.params.mul))
  assert.equal(own(true, 2), strike)
})
