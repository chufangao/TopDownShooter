// The synergies' rules at 4, for either side, and
// the endless floors past the Sovereign.
import './budget.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enterBattle, rulesOf, perform, order, preview, orderable, fork, addStatus, runEffect, stats, computeDamage } from '../src/sim/turns.js'
import { makeUnit, tileAt, activeSynergies, alive, SLOTS, campOpen, distance, tileY, deployTile } from '../src/sim/unit.js'
import { UNITS, CAMP_LIST, SYNERGIES, STATUSES } from '../src/content.js'
import { TUNING } from '../src/tuning.js'
import { tuned, BOARD_14, grant } from './tuned.js'
import {
  createRun, apply, legalActions, replay, depthOf, deepGrowth, foeMods, foeLevel, drawRoom, canDescend, captainPool,
  MONARCH_UID, monarchOf, souls, fielded, currentNode, availableNodes, foeEssence, battleSetup, join, START_PARTY
} from '../src/sim/run.js'
import { autoplay, policy, LEVELS } from '../src/sim/autoplay.js'
import { generateFloor, RANKS } from '../src/sim/map.js'
import { createRng } from '../src/sim/rng.js'
import { on, scene, unit, turns } from './scene.js'
import { fight } from './rooms.js'
import { basicTurn } from '../src/sim/foe.js'

const E = TUNING.spawn.endless
const F = TUNING.run.floors

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

// Party units of `ids` (cycled) on `tiles`, uids from `uid`, at level `lvl`; the foes' the same (uids from 101).
const squad = (ids, tiles, uid = 1, lvl = 3) => tiles.map(([x, y], i) => on(ids[i % ids.length], uid + i, 'party', x, y, lvl))
const foeSquad = (ids, tiles, uid = 101) => tiles.map(([x, y], i) => on(ids[i % ids.length], uid + i, 'foe', x, y))
// Four tiles of a row `y` (lanes 1–4), or three.
const four = (y) => [1, 2, 3, 4].map((x) => [x, y])
const three = (y) => four(y).slice(0, 3)
const set = (b, uid, hp) => { unit(b, uid).hp = hp }
const rules = (b, rule) => b.events.filter((e) => e.type === 'rule' && e.rule === rule)
const holding = (b, side) => rulesOf(b, side).map((r) => r.id)
// A foe's act on the board as it stands (a foe's turn, as foe.js foeTurn would give it). → its events.
function strike (b, uid, target, ability = null) {
  const u = unit(b, uid)
  const from = b.events.length
  b.stage = u.side === 'foe' ? 'foes' : 'party'
  u.acted = false
  perform(b, u, ability ? u.kit.find((a) => a.id === ability) : u.basic, unit(b, target))
  b.stage = 'party'
  return b.events.slice(from)
}

// ── synergies ────────────────────────────────────────────────────────────────────────────────────

// (Each kin's and role's one synergy at 4 is content.test.js's.)
test('synergies: shadows count, the Monarch never; a battle announces its rules and holds them', () => {
  const ghouls = [1, 2, 3].map((uid) => makeUnit('grave_ghoul', { uid }))
  const undead = (units) => activeSynergies(units).some((s) => s.id === 'undead_4')
  assert.ok(!undead([...ghouls, makeUnit('monarch', { uid: 0, lvl: 0 })]), 'the Monarch counts toward none')
  assert.ok(undead([...ghouls, { ...makeUnit('bone_chanter', { uid: 9 }), shadow: true }]), 'a shadow counts')
  const b = scene([...squad(['grave_ghoul', 'bone_chanter'], four(2)), on('clockwork_page', 100, 'foe', 3, 9)])
  assert.ok(b.events[0].synergies.some((s) => s.side === 'party' && s.id === 'undead_4'))
  assert.deepEqual([holding(b, 'party'), holding(b, 'foe')], [['legion'], []])
  const t = scene([...squad(['grave_ghoul'], three(2)), on('clockwork_page', 100, 'foe', 3, 9)])
  assert.ok(!holding(t, 'party').includes('legion'))
  enterBattle(t, { ...makeUnit('tomb_knight', { uid: 50, lvl: 3 }), side: 'party', shadow: true, tile: tileAt(3, 4) })
  assert.ok(holding(t, 'party').includes('legion'), 'three and a shadow')
})

// A trine counts as the three it was made of (the user's rule of 2026-10-16), on either side; with a
// shadow beside it as with a soul.
test('synergies: a trine counts as three, on either side, a shadow beside it as a soul', () => {
  const b = scene([
    on('trine:grave_ghoul', 1, 'party', 2, 2), on('bone_chanter', 2, 'party', 4, 2),
    on('trine:grave_ghoul', 101, 'foe', 2, 9), on('bone_chanter', 102, 'foe', 4, 9)
  ])
  assert.deepEqual([holding(b, 'party'), holding(b, 'foe')], [['legion'], ['legion']])
  const t = scene([on('trine:grave_ghoul', 1, 'party', 2, 2), on('clockwork_page', 100, 'foe', 3, 9)])
  assert.ok(!holding(t, 'party').includes('legion'), 'three alone')
  enterBattle(t, { ...makeUnit('bone_chanter', { uid: 50, lvl: 3 }), side: 'party', shadow: true, tile: tileAt(3, 4) })
  assert.ok(holding(t, 'party').includes('legion'), 'a trine and a shadow')
})

// The Legion (Undead 4): every foe slain rises on the side holding it, past Arise's reach and tier.
test('Legion: every foe slain rises at once as a shadow of yours beside the Monarch; never a boss or a shadow', () => tuned(BOARD_14, () => {
  const foes = () => [on('clockwork_page', 101, 'foe', 1, 6), on('iron_golem', 102, 'foe', 3, 6), on('frost_sprite', 103, 'foe', 5, 6)]
  const play = (party) => {
    const b = scene([...party, on('monarch', MONARCH_UID, 'party', 3, 1), ...foes()])
    for (const uid of [101, 102, 103]) set(b, uid, 1)
    turns(b)
    return b
  }
  const b = play(squad(['grave_ghoul'], [[1, 5], [3, 5], [5, 5], [0, 4]]))
  const risen = b.events.filter((e) => e.type === 'arise')
  assert.deepEqual(risen.map((e) => [e.corpse, e.unit.id, e.unit.side, e.unit.shadow, e.rule]).sort(),
    [[101, 'clockwork_page', 'party', true, 'legion'], [102, 'iron_golem', 'party', true, 'legion'], [103, 'frost_sprite', 'party', true, 'legion']])
  for (const e of risen) {
    const corpse = unit(b, e.corpse)
    assert.equal(e.from, corpse.tile)
    assert.ok(distance(e.unit.tile, b.monarch.tile) < distance(corpse.tile, b.monarch.tile), `${e.unit.tile} from ${corpse.tile}`)
    assert.ok(corpse.raised && !orderable(b, unit(b, e.unit.uid)), 'a shadow: it takes no orders')
    // The rule is announced right before the shadow rises, by its raiser.
    const i = b.events.indexOf(e)
    assert.deepEqual([b.events[i - 1].type, b.events[i - 1].rule, b.events[i - 1].target, b.events[i - 1].actor], ['rule', 'legion', e.corpse, e.actor])
    assert.equal(unit(b, e.actor).side, 'party')
  }
  assert.equal(b.raised, 0, 'it is no Arise')
  // Three undead: no Legion.
  assert.equal(rules(play(squad(['grave_ghoul'], [[1, 5], [3, 5], [5, 5]])), 'legion').length, 0)
  // A boss and a shadow never rise.
  const d = scene([...squad(['grave_ghoul'], [[1, 5], [3, 5], [5, 5], [0, 4]]), { ...on('frost_sprite', 101, 'foe', 1, 6), shadow: true }, on('hollow_sovereign', 102, 'foe', 3, 6),
    on('iron_golem', 103, 'foe', 6, 10)])
  set(d, 101, 1)
  set(d, 102, 1)
  turns(d)
  assert.ok(unit(d, 101).hp <= 0 && unit(d, 102).hp <= 0)
  assert.deepEqual([rules(d, 'legion').length, d.events.filter((e) => e.type === 'arise').length], [0, 0])
}))

test('Legion works for the foes too: one of yours slain rises on their side, where it fell', () => {
  const b = scene([on('mantis_reaper', 1, 'party', 3, 5), on('monarch', MONARCH_UID, 'party', 3, 0), ...foeSquad(['grave_ghoul'], [[2, 6], [3, 6], [4, 6], [3, 7]])])
  set(b, 1, 1)
  strike(b, 102, 1)
  const risen = b.events.find((e) => e.type === 'arise')
  assert.deepEqual([risen.corpse, risen.unit.id, risen.unit.side, risen.rule, risen.unit.tile], [1, 'mantis_reaper', 'foe', 'legion', tileAt(3, 5)])
  assert.ok(unit(b, risen.unit.uid).shadow)
})

// A run's reap after the foes' Legion: a soul of yours that rose against you is no foe's soul. It is not for
// sale and pays no essence (a Brass Sentry: a kind none of the ghouls is, of Move 1, and no locked kind, so End Turn's
// untouched blows fell it once risen).
test('Legion on the foes\' side: your fallen risen against you are not sold back or paid for', () => {
  // The foes hold their rules on every floor: here, on floor 1.
  legionReap()
})
function legionReap () {
  let won = null
  // Each seed, and each cell the sentry may take (the camp's layout decides which stands in the ghouls' way): the first
  // fight won with the sentry risen against you.
  for (let i = 0; i < 20 && !won; i++) {
    const cells = legalActions((() => { const r = setup(i); return r })()).filter((a) => a.type === 'place' && a.slot >= 0).length
    for (let c = 0; c < cells && !won; c++) {
      const run = setup(i)
      const s = run.state
      const sentry = souls(s.party).find((u) => u.id === 'brass_sentry')
      const places = legalActions(run).filter((a) => a.type === 'place' && a.uid === sentry.uid && a.slot >= 0)
      if (!places[c]) break
      apply(run, places[c])
      const before = s.essence
      // End Turn alone: the expert would walk the 1-HP sentry out of the ghouls' reach; left alone it stands and falls.
      fight(run, basicTurn)
      if (s.phase === 'reap' && run.battle.units.some((u) => u.side === 'foe' && u.shadow)) won = { run, earned: s.essence - before }
    }
  }
  // A run at the fight's door: your souls at level 20, a sentry at 1 HP unplaced, five ghouls (their Legion, four undead,
  // holds through the one your untouched pieces fell before the foes' turn).
  function setup (i) {
    const run = createRun({ start: START_PARTY, seed: `legion-reap${i}` })
    const s = run.state
    s.party = s.party.map((u) => u.uid === MONARCH_UID ? u : { ...makeUnit(u.id, { uid: u.uid, lvl: 20 }), slot: u.slot })
    const sentry = join(run, 'brass_sentry')
    Object.assign(sentry, { slot: -1, hp: 1 })
    const node = availableNodes(run)[0]
    node.type = 'fight'
    node.foes = [...Array(5).keys()].map((slot) => ({ id: 'grave_ghoul', lvl: 1, slot }))
    apply(run, { type: 'node', id: node.id })
    return run
  }
  assert.ok(won, 'some seed won, the sentry risen against it')
  const { run, earned } = won
  const b = run.battle
  assert.ok(b.units.some((u) => u.side === 'foe' && u.shadow && u.id === 'brass_sentry' && u.hp <= 0), 'the sentry rose against you, and fell')
  assert.ok(!run.state.offers.some((o) => o.type === 'soul' && o.id === 'brass_sentry'))
  assert.ok(run.state.offers.some((o) => o.type === 'soul' && o.id === 'grave_ghoul'))
  const paid = b.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0).reduce((n, u) => n + foeEssence(u, b.floor), 0)
  assert.equal(earned, Math.round(paid))
}

test('Mirage: the first blow each foe would land on the side holding it in a battle misses, and only the first; either side', () => {
  // The fae at level 20: a wisp must outlive two of the knights' blows, or the four that hold Mirage are three.
  const b = scene([...squad(['will_o_wisp', 'thorn_dryad'], four(5), 1, 20), ...[1, 3].map((x, i) => on('tomb_knight', 101 + i, 'foe', x, 6, 10))])
  const lands = (uid, target) => strike(b, uid, target).some((e) => e.type === 'damage' && e.actor === uid)
  const foiled = (uid, target) => {
    const first = strike(b, uid, target)
    assert.deepEqual(first.filter((e) => ['rule', 'miss', 'damage'].includes(e.type)).map((e) => [e.type, e.actor]).slice(0, 2), [['rule', uid], ['miss', uid]])
    assert.ok(!first.some((e) => e.type === 'damage' && e.actor === uid), 'no harm done')
    assert.ok(lands(uid, target), 'the next lands')
  }
  for (const uid of [101, 102]) foiled(uid, uid === 101 ? 1 : 3)
  assert.equal(rules(b, 'mirage').length, 2)
  // Once a foe a battle, not once a turn: the next turn its blow lands.
  b.turn++
  for (const uid of [101, 102]) assert.ok(lands(uid, uid === 101 ? 1 : 3), `${uid} lands on the next turn`)
  assert.equal(rules(b, 'mirage').length, 2)
  // A foe entering later has a first blow of its own.
  enterBattle(b, { ...makeUnit('tomb_knight', { uid: 103, lvl: 10 }), side: 'foe', tile: tileAt(2, 6) })
  foiled(103, 2)
  assert.equal(rules(b, 'mirage').length, 3)
  const few = scene([...squad(['will_o_wisp', 'thorn_dryad'], three(5)), on('tomb_knight', 101, 'foe', 1, 6, 10)])
  assert.ok(strike(few, 101, 1).some((e) => e.type === 'damage'))
  // Theirs: your first blow at one of their four fae misses.
  const theirs = scene([on('tomb_knight', 1, 'party', 3, 5, 10), ...foeSquad(['will_o_wisp', 'thorn_dryad'], four(6))])
  const mine = order(theirs, { type: 'act', uid: 1, ability: 'strike', target: 103 })
  assert.deepEqual(mine.filter((e) => e.type === 'rule').map((e) => [e.rule, e.side]), [['mirage', 'foe']])
})

// The stand heals: it leaves the piece at 1 HP, then mends TUNING.lastStand.heal of its max HP.
const stood = (u) => 1 + Math.max(1, Math.round(u.maxHp * TUNING.lastStand.heal))

test('Last Stand: the first blow that would fell each of the side\'s leaves it at 1 HP and heals it, once; never the Monarch; either side', () => {
  const b = scene([...squad(['clockwork_page', 'clockwork_page', 'iron_golem'], four(5)), on('monarch', MONARCH_UID, 'party', 0, 0), on('barrow_wight', 101, 'foe', 2, 6, 6)])
  const page = unit(b, 2)
  page.hp = 5
  const first = strike(b, 101, 2)
  assert.deepEqual([page.hp, rules(b, 'last_stand').map((e) => e.target)], [stood(page), [2]])
  const i = first.findIndex((e) => e.type === 'rule' && e.rule === 'last_stand')
  assert.deepEqual([first[i + 1].type, first[i + 1].target, first[i + 1].hp], ['damage', 2, 1])
  assert.deepEqual([first[i + 2].type, first[i + 2].target, first[i + 2].heal, first[i + 2].hp], ['heal', 2, stood(page) - 1, stood(page)], 'then it mends')
  page.hp = 5
  strike(b, 101, 2)
  assert.ok(page.stood && page.hp <= 0, 'the next killing blow fells it')
  b.monarch.hp = 1
  strike(b, 101, MONARCH_UID)
  assert.deepEqual([b.winner, b.reason, rules(b, 'last_stand').length], ['foe', 'monarch', 1], 'the Monarch has no stand')
  const few = scene([...squad(['clockwork_page'], three(5)), on('barrow_wight', 101, 'foe', 2, 6, 6)])
  set(few, 2, 5)
  strike(few, 101, 2)
  assert.equal(unit(few, 2).hp, 0)
  const theirs = scene([on('tomb_knight', 1, 'party', 2, 5, 10), ...foeSquad(['clockwork_page', 'iron_golem'], four(6))])
  set(theirs, 102, 1)
  order(theirs, { type: 'act', uid: 1, ability: 'strike', target: 102 })
  assert.deepEqual([unit(theirs, 102).hp, rules(theirs, 'last_stand')[0].side], [stood(unit(theirs, 102)), 'foe'])
})

// A stand is spent only on damage that would still fell once every rule has bent it: Bodyguard's lessening comes first.
test('Last Stand comes after what lessens a blow: under Bodyguard a Construct Vanguard stands only on what would still fell it', () => {
  const play = (hp) => {
    const b = scene([...squad(['iron_golem', 'clockwork_page'], four(5)), ...squad(['tomb_knight'], [[5, 5], [6, 5]], 10), on('barrow_wight', 101, 'foe', 1, 6, 6)])
    assert.ok(['last_stand', 'bodyguard'].every((r) => holding(b, 'party').includes(r)))
    const golem = unit(b, 1)
    if (hp) golem.hp = hp
    const dealt = strike(b, 101, 1).find((e) => e.type === 'damage' && e.target === 1).damage
    return { golem, dealt, stands: rules(b, 'last_stand').length }
  }
  const { dealt } = play(null)
  assert.ok(Math.round(dealt / TUNING.bodyguard.taken) > dealt + 1, 'unlessened, the blow would fell at one HP more than it deals')
  const near = play(dealt + 1)
  assert.deepEqual([near.golem.hp, !!near.golem.stood, near.stands], [1, false, 0], 'lessened, it fells nothing: no stand spent')
  const at = play(dealt)
  assert.deepEqual([at.golem.hp, at.stands], [stood(at.golem), 1])
})

// Last Stand bends any damage that would fell (land: a blow's or a status tick's), and its card says so.
// The preview marks the fall on whoever takes the blow: a Bodyguard that steps in front of it and dies of it.
test('a preview reports the fall of whoever would take the blow, a Bodyguard that takes it in the target\'s place included', () => {
  const theirs = scene([...foeSquad(['tomb_knight', 'grave_ghoul'], [[0, 10], [1, 10], [2, 10]]), on('tomb_knight', 108, 'foe', 2, 9), on('frost_sprite', 120, 'foe', 3, 8), on('will_o_wisp', 1, 'party', 3, 4)])
  set(theirs, 108, 1)
  const before = theirs.events.length
  const p = preview(theirs, 1, 'witchfire', 120)
  // The damage stands on the one that takes it.
  assert.deepEqual([p.struck, p.kills, p.falls, p.damage], [108, true, [108], p.hits[108]])
  assert.ok(p.hits[108] > 0 && !(120 in p.hits))
  // Unguarded, the target is struck and falls as before.
  const plain = scene([on('frost_sprite', 120, 'foe', 3, 8), on('will_o_wisp', 1, 'party', 3, 4)])
  set(plain, 120, 1)
  const q = preview(plain, 1, 'witchfire', 120)
  assert.deepEqual([q.struck, q.kills, q.falls], [120, true, [120]])
  assert.deepEqual([theirs.events.length, alive(unit(theirs, 108))], [before, true], 'the battle itself is untouched')
})

test('Last Stand: a Burning tick that would fell one of the side\'s leaves it at 1 HP too, and the card says "would fall"', () => {
  const b = scene([...squad(['clockwork_page', 'clockwork_page', 'iron_golem'], four(5)), on('barrow_wight', 101, 'foe', 2, 9, 6)])
  const page = unit(b, 2)
  page.hp = 5
  addStatus(b, page, 'burning', 3, unit(b, 101))
  runEffect(b, { op: 'dot', power: 12 }, page, [page], null, page.statuses[0])
  assert.deepEqual([page.hp, page.stood, rules(b, 'last_stand').length], [stood(page), true, 1])
  const card = SYNERGIES.find((s) => s.rule === 'last_stand').desc
  assert.match(card, /would fall/)
  assert.doesNotMatch(card, /blow/)
})

test('Frenzy: one of the side\'s that slays a foe has every skill ready again; either side', () => {
  const play = (tiles) => {
    const b = scene([...squad(['mantis_reaper', 'hive_warden'], tiles), on('clockwork_page', 101, 'foe', 1, 6), on('iron_golem', 102, 'foe', 6, 10)])
    set(b, 101, 1)
    const events = order(b, { type: 'act', uid: 1, ability: 'reap', target: 101 })
    return { b, events }
  }
  const { b, events } = play(four(5))
  const i = events.findIndex((e) => e.type === 'rule' && e.rule === 'frenzy')
  assert.deepEqual([events[i - 1].type, events[i - 1].target, events[i].actor], ['death', 101, 1])
  assert.equal(unit(b, 1).cooldowns.reap, 0, 'Reap is ready again')
  // and says so, as every cooldown set or fallen is said (the sprite's pip reads it).
  assert.deepEqual(events.slice(i + 1).filter((e) => e.type === 'cooldown').map((e) => [e.target, e.ability, e.turns]), [[1, 'reap', 0]])
  assert.equal(play(three(5)).b.byUid.get(1).cooldowns.reap, 2)
  const theirs = scene([on('clockwork_page', 1, 'party', 1, 5), ...foeSquad(['mantis_reaper', 'hive_warden'], four(6))])
  set(theirs, 1, 1)
  strike(theirs, 101, 1, 'reap')
  assert.deepEqual([unit(theirs, 101).cooldowns.reap, rules(theirs, 'frenzy')[0].side], [0, 'foe'])
})

test('Dragonfire: a single-target blow of the side\'s strikes its target and every one of its side next to it; either side', () => {
  const play = (tiles) => {
    const b = scene([...squad(['ember_drake', 'frost_wyrm'], tiles), on('frost_sprite', 20, 'party', 3, 6), ...[2, 3, 4].map((x, i) => on('clockwork_page', 101 + i, 'foe', x, 8))])
    return order(b, { type: 'act', uid: 20, ability: 'frost_lance', target: 102 }).find((e) => e.type === 'action' && e.actor === 20)
  }
  assert.deepEqual(play(four(1)).targets, [101, 102, 103])
  assert.deepEqual(play(three(1)).targets, [102])
  const theirs = scene([...foeSquad(['ember_drake', 'frost_wyrm'], four(9)), on('frost_sprite', 120, 'foe', 3, 6), ...[2, 3, 4].map((x, i) => on('clockwork_page', 1 + i, 'party', x, 5))])
  const burst = strike(theirs, 120, 2).find((e) => e.type === 'action')
  assert.deepEqual(burst.targets, [1, 2, 3])
})

test('Bodyguard: a single-target blow at one of the side\'s not a Vanguard falls on a Vanguard beside it: the Monarch is guarded; either side', () => {
  const play = (n) => {
    const b = scene([...squad(['tomb_knight', 'grave_ghoul'], four(1).slice(0, n - 1)), on('tomb_knight', 8, 'party', 2, 5), on('monarch', MONARCH_UID, 'party', 3, 6), on('will_o_wisp', 101, 'foe', 3, 8)])
    return strike(b, 101, MONARCH_UID)
  }
  const ev = play(4)
  const i = ev.findIndex((e) => e.type === 'action' && e.actor === 101)
  assert.deepEqual([ev[i - 1].type, ev[i - 1].rule, ev[i - 1].actor, ev[i - 1].target], ['rule', 'bodyguard', 8, MONARCH_UID])
  assert.deepEqual(ev[i].targets, [8])
  assert.ok(!ev.some((e) => e.type === 'damage' && e.target === MONARCH_UID))
  assert.deepEqual(play(3).find((e) => e.type === 'action').targets, [MONARCH_UID])
  const theirs = scene([...foeSquad(['tomb_knight', 'grave_ghoul'], [[0, 10], [1, 10], [2, 10]]), on('tomb_knight', 108, 'foe', 2, 9), on('frost_sprite', 120, 'foe', 3, 8), on('will_o_wisp', 1, 'party', 3, 4)])
  const shot = order(theirs, { type: 'act', uid: 1, ability: 'witchfire', target: 120 })
  assert.deepEqual(shot.find((e) => e.type === 'rule').side, 'foe')
  assert.deepEqual(shot.find((e) => e.type === 'action').targets, [108])
})

test('Bodyguard: the side\'s Vanguards take TUNING.bodyguard.taken of the damage, a blow\'s and a tick\'s; no one else does; either side', () => {
  // Four Vanguards (or three) and a Wisp, a foe Wisp's shot at Vanguard 8 and at the Wisp, and a Burning tick on 8.
  const play = (n) => {
    const b = scene([...squad(['tomb_knight', 'grave_ghoul'], four(1).slice(0, n - 1)), on('tomb_knight', 8, 'party', 2, 5, 20), on('will_o_wisp', 9, 'party', 5, 5, 20),
      on('will_o_wisp', 101, 'foe', 3, 8), on('iron_golem', 102, 'foe', 6, 10)])
    const shot = (target) => strike(b, 101, target).find((e) => e.type === 'damage' && e.target === target).damage
    const guard = unit(b, 8)
    addStatus(b, guard, 'burning', 3, unit(b, 101))
    const from = b.events.length
    runEffect(b, { op: 'dot', power: 12 }, guard, [guard], null, guard.statuses[0])
    return { vanguard: shot(8), wisp: shot(9), tick: b.events.slice(from).find((e) => e.type === 'damage').damage }
  }
  const [held, plain] = [play(4), play(3)]
  assert.equal(held.vanguard, Math.round(plain.vanguard * TUNING.bodyguard.taken))
  assert.equal(held.tick, Math.round(plain.tick * TUNING.bodyguard.taken))
  assert.ok(held.vanguard < plain.vanguard && held.tick < plain.tick)
  assert.equal(held.wisp, plain.wisp, 'a piece no Vanguard takes it full')
  // Theirs: your blow on one of their four Vanguards.
  const theirs = (n) => {
    const b = scene([...foeSquad(['tomb_knight'], [[1, 10], [2, 10], [3, 10], [4, 10]].slice(0, n)), on('frost_sprite', 1, 'party', 1, 7, 20)])
    return order(b, { type: 'act', uid: 1, ability: 'frost_lance', target: 101 }).find((e) => e.type === 'damage' && e.target === 101).damage
  }
  assert.equal(theirs(4), Math.round(theirs(3) * TUNING.bodyguard.taken))
})

test('Deadeye: the side\'s ranged blows deal half again; its melee as it was; either side', () => {
  const dealt = (tiles, ability) => {
    const b = scene([...squad(['ember_drake', 'frost_wyrm'], tiles), on('tomb_knight', 101, 'foe', 1, 2, 20), on('iron_golem', 102, 'foe', 6, 10)])
    return preview(b, 1, ability, 101).damage
  }
  const [sure, plain] = [dealt(four(1), 'ember_burst'), dealt(three(1), 'ember_burst')]
  assert.equal(sure, Math.round(plain * 1.5))
  assert.equal(dealt(four(1), 'strike'), dealt(three(1), 'strike'), 'a melee blow is no ranged one')
  const theirs = scene([...foeSquad(['ember_drake', 'frost_wyrm'], four(9)), on('tomb_knight', 1, 'party', 1, 7, 20)])
  const fewer = scene([...foeSquad(['ember_drake', 'frost_wyrm'], three(9)), on('tomb_knight', 1, 'party', 1, 7, 20)])
  const hurt = (b) => strike(b, 101, 1, 'ember_burst').find((e) => e.type === 'damage' && e.target === 1).damage
  assert.equal(hurt(theirs), Math.round(hurt(fewer) * 1.5))
})

test('Ambush: the side\'s pieces start the battle Hastened, and those that enter later at their side\'s next turn; either side', () => {
  const play = (tiles) => scene([...squad(['frost_sprite', 'barrow_wight'], tiles), on('monarch', MONARCH_UID, 'party', 3, 0), on('tomb_knight', 101, 'foe', 3, 10)])
  const hasted = (u) => u.statuses.some((s) => s.id === 'hasten')
  const b = play(four(5))
  assert.ok(b.units.filter((u) => u.side === 'party' && u !== b.monarch).every(hasted))
  assert.ok(!hasted(b.monarch) && !hasted(unit(b, 101)))
  assert.deepEqual(rules(b, 'ambush').map((e) => e.side), ['party'])
  assert.deepEqual(b.events.filter((e) => e.type === 'status' && e.status === 'hasten').map((e) => e.dur), [2, 2, 2, 2], 'for their first two turns')
  const late = enterBattle(b, { ...makeUnit('grave_ghoul', { uid: 50, lvl: 3 }), side: 'party', tile: tileAt(3, 2) })
  assert.ok(!hasted(late))
  turns(b)
  assert.ok(hasted(late), 'the turn after it entered')
  assert.ok(!play(three(5)).units.some(hasted))
  const theirs = scene([...foeSquad(['frost_sprite', 'barrow_wight'], four(9)), on('monarch', MONARCH_UID, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4)])
  assert.ok(!theirs.units.some(hasted), 'theirs come at their own turn')
  order(theirs, { type: 'end' })
  assert.deepEqual(rules(theirs, 'ambush').map((e) => e.side), ['foe'])
})

// Hastened for TUNING.ambush.turns of a piece's own turns: still on its second, gone by its third.
test('Ambush lasts its pieces\' first two turns', () => {
  assert.equal(TUNING.ambush.turns, 2)
  const b = scene([...squad(['frost_sprite', 'barrow_wight'], [[0, 1], [1, 1], [5, 1], [6, 1]]), on('monarch', MONARCH_UID, 'party', 3, 0), on('iron_golem', 101, 'foe', 3, 10, 20)])
  const mine = () => b.units.filter((u) => u.side === 'party' && u !== b.monarch)
  const hasted = (u) => u.statuses.some((s) => s.id === 'hasten')
  const moves = () => mine().map((u) => u.move)
  const first = moves()
  assert.ok(mine().every(hasted) && b.turn === 1)
  turns(b)
  assert.ok(b.turn === 2 && !b.over)
  assert.ok(mine().every(hasted), 'the second turn too')
  assert.deepEqual(moves(), first, 'its Move still one more')
  turns(b)
  assert.ok(b.turn === 3 && !b.over)
  assert.ok(!mine().some(hasted), 'gone by the third')
  assert.deepEqual(moves(), first.map((m) => m - 1))
})

test('Echo: every ability of the side\'s rings out once more on the same targets; an Arise never echoes; either side', () => {
  const play = (tiles) => {
    const b = scene([...squad(['will_o_wisp', 'bone_chanter'], tiles), on('tomb_knight', 9, 'party', 0, 0, 3, [0, 0], ['arise']), on('monarch', MONARCH_UID, 'party', 3, 0),
      on('tomb_knight', 101, 'foe', 3, 6, 20), on('frost_sprite', 102, 'foe', 1, 2), on('iron_golem', 103, 'foe', 6, 10)])
    const fire = order(b, { type: 'act', uid: 1, ability: 'witchfire', target: 101 })
    return { b, fire }
  }
  const { b, fire } = play(four(4))
  assert.equal(fire.filter((e) => e.type === 'damage' && e.target === 101).length, 2, 'two blows')
  assert.deepEqual(rules(b, 'echo').map((e) => [e.actor, e.ability]), [[1, 'witchfire']])
  set(b, 102, 0)
  b.roster++
  for (const t of [unit(b, 102).tile]) b.at[t] = null
  const rose = order(b, { type: 'act', uid: 9, ability: 'arise', target: 102 })
  assert.ok(rose.some((e) => e.type === 'arise') && !rose.some((e) => e.type === 'rule' && e.rule === 'echo'), 'Arise never echoes')
  assert.equal(play(three(4)).fire.filter((e) => e.type === 'damage' && e.target === 101).length, 1)
  const theirs = scene([...foeSquad(['will_o_wisp', 'bone_chanter'], four(7)), on('tomb_knight', 1, 'party', 1, 5, 20)])
  const twice = strike(theirs, 101, 1).filter((e) => e.type === 'damage' && e.target === 1)
  assert.deepEqual([twice.length, rules(theirs, 'echo')[0].side], [2, 'foe'])
})

// Echo is split: from 4 Channelers its second landing is at TUNING.echo.half of the effect
// (the damage, the healing, a status's turns, rounded up), from the synergy's `full` (8) whole.
test('Echo at half from 4 Channelers, whole from 8: the second landing\'s damage, healing and a status\'s turns', () => {
  const full = SYNERGIES.find((s) => s.rule === 'echo').full
  const k = TUNING.echo.half
  assert.deepEqual([full, k], [8, 0.5])
  const tiles = [[1, 3], [2, 3], [3, 3], [4, 3], [1, 2], [2, 2], [3, 2], [4, 2]]
  const play = (n) => {
    const b = scene([...squad(['will_o_wisp', 'bone_chanter'], tiles.slice(0, n)), on('hive_warden', 20, 'party', 5, 3), on('tomb_knight', 21, 'party', 6, 3, 9),
      on('tomb_knight', 101, 'foe', 3, 7, 20), on('iron_golem', 102, 'foe', 6, 10)])
    const echoes = rulesOf(b, 'party').filter((r) => r.id === 'echo')
    // Witchfire's 30 on the Knight, as the Wisp's stats and the Knight's make it: whole, and at k.
    const [a, d] = [stats(b, unit(b, 1)), stats(b, unit(b, 101))]
    const blow = (p) => computeDamage({ power: p, atk: a.atk, def: d.def, mul: a.damage.dealt * d.damage.taken })
    const fire = order(b, { type: 'act', uid: 1, ability: 'witchfire', target: 101 }).filter((e) => e.type === 'damage' && e.target === 101).map((e) => e.damage)
    // Mend's 28 on the Knight of ours at 1 HP, and its Regen.
    unit(b, 21).hp = 1
    const w = stats(b, unit(b, 20))
    const mend = (p) => Math.max(1, Math.round(p * w.atk / TUNING.damage.atkDivisor * w.heal.given))
    const ev = order(b, { type: 'act', uid: 20, ability: 'mend', target: 21 })
    return {
      echoes, blow, mend, fire,
      heals: ev.filter((e) => e.type === 'heal' && e.target === 21).map((e) => e.heal),
      regen: ev.filter((e) => e.type === 'status' && e.status === 'regen' && e.target === 21).map((e) => e.dur),
      half: rules(b, 'echo').map((e) => !!e.half)
    }
  }
  const four = play(4)
  assert.deepEqual(four.echoes.map((r) => r.params.full), [false], 'one Echo, its lesser form')
  assert.deepEqual(four.fire, [four.blow(30), four.blow(30 * k)])
  assert.ok(four.fire[1] < four.fire[0])
  assert.deepEqual(four.heals, [four.mend(28), four.mend(28 * k)])
  assert.deepEqual(four.regen, [STATUSES.regen.turns, Math.ceil(STATUSES.regen.turns * k)])
  assert.deepEqual(four.half, [true, true], 'and says so')
  assert.deepEqual(play(7).echoes.map((r) => r.params.full), [false], 'seven: still the lesser')
  const eight = play(8)
  assert.deepEqual(eight.echoes.map((r) => r.params.full), [true], 'one Echo, whole')
  assert.deepEqual(eight.fire, [eight.blow(30), eight.blow(30)])
  assert.deepEqual(eight.heals, [eight.mend(28), eight.mend(28)])
  assert.deepEqual(eight.regen, [STATUSES.regen.turns, STATUSES.regen.turns])
  assert.deepEqual(eight.half, [false, false])
  assert.equal(play(3).echoes.length, 0)
})

test('Sanctuary: an ability of the side\'s aimed at an ally reaches anyone, and touches every one of its side on the board; either side', () => {
  const play = (tiles) => {
    const b = scene([...squad(['hive_warden', 'thorn_dryad'], tiles), on('clockwork_page', 20, 'party', 6, 6), on('clockwork_page', 101, 'foe', 3, 10)])
    set(b, 20, 10)
    return [b, order(b, { type: 'act', uid: 1, ability: 'mend', target: 20 }).find((e) => e.type === 'action')]
  }
  const [b, mend] = play(four(0))
  assert.deepEqual(mend.targets.slice().sort((x, y) => x - y), b.units.filter((u) => u.side === 'party' && alive(u)).map((u) => u.uid).sort((x, y) => x - y))
  assert.deepEqual(play(three(0))[1].targets, [20])
  const theirs = scene([...foeSquad(['hive_warden', 'thorn_dryad'], four(10)), on('clockwork_page', 120, 'foe', 0, 8), on('clockwork_page', 1, 'party', 3, 4)])
  set(theirs, 120, 10)
  const healed = strike(theirs, 101, 120, 'mend').find((e) => e.type === 'action')
  assert.deepEqual(healed.targets.slice().sort((x, y) => x - y), theirs.units.filter((u) => u.side === 'foe' && alive(u)).map((u) => u.uid).sort((x, y) => x - y))
})

test('Deathblow works for the foes too: their blow on one of yours below 35% of its HP deals double', () => {
  const play = (tiles) => {
    const b = scene([...foeSquad(['clockwork_page', 'mantis_reaper'], tiles), on('tomb_knight', 1, 'party', 1, 5, 20)])
    set(b, 1, Math.floor(unit(b, 1).maxHp * 0.3))
    return strike(b, 101, 1).find((e) => e.type === 'damage' && e.target === 1).damage
  }
  assert.equal(play(four(6)), Math.round(play(three(6)) * TUNING.deathblow.mult))
})

// Last Stand meets Undying: the stand comes first, and the rise after the next killing blow.
test('Last Stand under Undying comes before the rise; Undying lifts only its holder, once a battle', () => {
  const u = scene([on('iron_golem', 1, 'party', 3, 4, 3, [0, 0], ['undying']), ...squad(['clockwork_page'], [[0, 1], [1, 1], [2, 1]], 20),
    on('clockwork_page', 30, 'party', 6, 0), on('frost_sprite', 101, 'foe', 3, 5, 20), on('iron_golem', 102, 'foe', 6, 10)])
  assert.ok(holding(u, 'party').includes('last_stand') && holding(u, 'party').includes('undying'))
  const golem = unit(u, 1)
  golem.hp = 1
  strike(u, 101, 1)
  assert.equal(golem.hp, stood(golem))
  golem.hp = 1
  strike(u, 101, 1)
  const order = u.events.filter((e) => e.target === 1 && ['rule', 'death', 'rise'].includes(e.type)).map((e) => e.rule ?? e.type)
  assert.deepEqual(order, ['last_stand', 'death', 'rise'])
  assert.equal(golem.hp, Math.max(1, Math.round(golem.maxHp * 0.6)), 'at its relic\'s share')
  while (alive(golem)) strike(u, 101, 1)
  assert.equal(u.events.filter((e) => e.type === 'rise').length, 1, 'once a battle')
  // A page beside it holding nothing falls, and stays down.
  const page = unit(u, 30)
  page.stood = true
  page.hp = 1
  strike(u, 101, 30)
  assert.ok(!alive(page) && !u.events.some((e) => e.type === 'rise' && e.target === 30))
})

// The foes hold their rules on every floor, as yours do.
test('the foes hold their synergies\' rules on every floor, the first among them', () => {
  const drakes = scene([...foeSquad(['ember_drake', 'frost_wyrm'], four(9)), on('tomb_knight', 1, 'party', 3, 4)], { floor: 1 })
  assert.deepEqual(holding(drakes, 'foe').sort(), ['deadeye', 'dragonfire'])
  assert.ok(drakes.events[0].synergies.some((x) => x.side === 'foe' && x.id === 'drake_4'))
  // The run's setup carries no gate: a floor-1 battle of a cohort of four holds its rule.
  const run = createRun({ start: START_PARTY, seed: 'foe-rules' })
  apply(run, { type: 'node', id: availableNodes(run).find((n) => n.foes).id })
  assert.ok(!('foeRules' in battleSetup(run)))
  assert.ok(!('rules' in TUNING.spawn.endless))
})

// ── endless floors ───────────────────────────────────────────────────────────────────────────────


test('past the Sovereign\'s floor the foes grow by the floor, as an army: more levels, more foes, more waves, bigger cohorts, more HP and ATK; a big elite at the end', () => {
  const last = { rank: RANKS - 1 }
  const none = { level: 0, count: 0, waves: 0, cohort: 0 }
  for (let f = 1; f <= F; f++) {
    assert.equal(depthOf(f), 0)
    assert.deepEqual(deepGrowth(f, last), none)
  }
  const grown = (d, final) => ({
    level: d * E.level + (final ? E.final.level : 0),
    count: Math.floor(d * E.count) + (final ? E.final.count : 0),
    waves: Math.floor(d * E.waves),
    cohort: Math.floor(d * E.cohort)
  })
  assert.deepEqual(deepGrowth(F + 1, { rank: 3 }), grown(1, false))
  assert.deepEqual(deepGrowth(F + 2, last), grown(2, true))
  assert.deepEqual(deepGrowth(F + 4, { rank: 3 }), grown(4, false))
  assert.ok(deepGrowth(F + 4, { rank: 3 }).waves > 0 && deepGrowth(F + 4, { rank: 3 }).cohort > deepGrowth(F + 1, { rank: 3 }).cohort, 'the army grows')
  const sp = TUNING.spawn
  const W = sp.waves
  assert.deepEqual(foeMods(F, false).map((m) => m.v), [sp.foeHp[F - 1], sp.foeAtk[F - 1]])
  // The deep's from the lists' last entries, as its counts and cohorts are (below): floor 4's, past three floors.
  assert.deepEqual(foeMods(F + 3, false).map((m) => m.v), [sp.foeHp.at(-1) * (1 + 3 * E.hp), sp.foeAtk.at(-1) * (1 + 3 * E.atk)])
  // Rooms on endless floors: the last floor's pool, its counts grown, levels raised, more waves to every room
  // and a bigger cohort behind every captain; the end a big elite.
  let rooms = 0
  for (const floor of [F + 1, F + 2, F + 4]) {
    for (const seed of ['deep0', 'deep1']) {
      const map = generateFloor({ seed, floor, boss: floor <= F })
      assert.equal(map.nodes.find((n) => n.id === map.end).type, 'elite')
      for (const node of map.nodes.filter((n) => ['fight', 'elite', 'siege'].includes(n.type))) {
        const room = drawRoom(seed, floor, node)
        const g = deepGrowth(floor, node)
        const elite = node.type === 'elite'
        const n = Math.min(SLOTS, (elite ? sp.elite : sp.fight).at(-1) + g.count)
        const base = node.type === 'siege' ? W.siege : elite ? W.elite : node.rank >= W.fightRank ? W.fight : 1
        const forms = [room.foes, ...(room.waves ?? []).map((w) => w.foes)]
        assert.equal(forms.length, Math.max(base, Math.min(E.maxWaves, base + g.waves)), `${floor} ${node.id}: waves`)
        const cohort = sp.cohort.at(-1) + g.cohort
        const lvl = foeLevel(floor, node.rank) + g.level + (elite ? sp.eliteLevel : 0)
        // The last floor's pool: what may spawn there, up to its target tier (no deeper tiers come in).
        const tier = Math.min(sp.tierMax, 1 + Math.floor((F - 1) * sp.tierPerFloor)) + (elite ? sp.eliteTier : 0) + sp.tierOverCap
        for (const foes of forms) {
          rooms++
          // The foes drawn, then every captain's cohort, the deep's bigger one, foes of their own: an elite's of its
          // captain's kind, a fight's of the wave's other kinds, its captain drawn first a tier up (captainPool).
          const captains = elite ? sp.captains.elite : sp.captains.fight
          assert.equal(foes.length, Math.min(SLOTS, n + captains * cohort), `${floor} ${node.id}: foes a wave`)
          assert.ok(foes.length <= SLOTS && new Set(foes.map((f) => f.slot)).size === foes.length)
          assert.ok(!foes.some((f) => 'count' in f), `${floor} ${node.id}: no counts`)
          for (let c = 0; c < captains && n + (c + 1) * cohort <= SLOTS; c++) {
            const band = foes.slice(n + c * cohort, n + (c + 1) * cohort)
            if (elite) assert.ok(band.every((f) => f.id === band[0].id) && foes.slice(0, n).some((f) => f.id === band[0].id), `${floor} ${node.id}: cohort ${c}`)
            else assert.ok(band.every((f) => foes.slice(captains, n).some((x) => x.id === f.id)), `${floor} ${node.id}: cohort ${c}`)
          }
          const led = elite ? 0 : captains
          assert.ok(foes.slice(0, led).every((f) => captainPool(F).units.some((u) => u.id === f.id)), `${floor} ${node.id}: its captain`)
          assert.ok(foes.slice(led).every((f) => UNITS[f.id].spawn.minFloor <= F && UNITS[f.id].tier <= tier), `${floor} ${node.id} ${foes.map((f) => f.id)}`)
          assert.ok(foes.every((f) => f.lvl === lvl), `${floor} ${node.id} ${foes.map((f) => f.lvl)} ${lvl}`)
        }
        if (node.id === map.end) assert.ok(n > (elite ? sp.elite : sp.fight).at(-1) + Math.floor((floor - F) * E.count))
      }
    }
  }
  assert.ok(rooms > 100, `${rooms} formations checked`)
  // Never more than the formation holds, and never more waves than the cap.
  const deepest = drawRoom('deep', 60, { id: '15.0', rank: RANKS - 1, type: 'elite' })
  assert.ok([deepest.foes, ...deepest.waves.map((w) => w.foes)].every((foes) => foes.length === SLOTS))
  assert.equal(deepest.waves.length + 1, E.maxWaves)
})

// A rich run (purse topped up, and each floor an HP relic and three Command relics given, outside the log) to the Sovereign, through rooms
// emptied of foes and to a frail boss alone in each floor's last room, the Sovereign on the last: the descent is under
// test here, not the fights on the way (whether a run gets there is the final balance pass's business).
function clear (seed) {
  const sp = TUNING.spawn
  const empty = { fight: sp.fight.map(() => 0), elite: sp.elite.map(() => 0), court: sp.court.map(() => 0), bossHp: sp.bossHp.map(() => 0.02), bossAtk: sp.bossAtk.map(() => 0.02), late: { ...sp.late, n: 0 }, waves: { ...sp.waves, siege: 1 } }
  return tuned({ spawn: empty }, () => {
    const run = createRun({ start: START_PARTY, seed })
    const s = run.state
    const rng = createRng(seed).stream('autoplay')
    for (let granted = 0; s.phase !== 'over';) {
      if (s.essence < 5000) s.essence = 1e5
      if (['map', 'prep'].includes(s.phase) && granted < s.floor) {
        granted++
        grant(run, ['bone_mantle', 'grave_banner', 'grave_banner', 'grave_banner'])
      }
      apply(run, policy(run, rng, STEADY))
    }
    return run
  })
}
const STEADY = { ...LEVELS.basic, wounds: true, turns: 'solver' }
// The 'deep' clear is played once and shared: each test takes its own copy of the state.
let cleared = null
const clearDeep = () => {
  cleared ??= clear('deep')
  return { state: structuredClone(cleared.state), battle: cleared.battle, setup: cleared.setup }
}

// The run's invariants as the endless floors bend them: the clear stands for good once made, a fall in the
// deep keeps it, descend is legal exactly when canDescend says, the camp is the last floor's below it, and
// the floors cleared count every floor left behind.
function checkDeep (run) {
  const s = run.state
  assert.ok(['map', 'prep', 'battle', 'reap', 'altar', 'over'].includes(s.phase), s.phase)
  assert.ok(Number.isInteger(s.essence) && s.essence >= 0)
  assert.equal(new Set(s.party.map((u) => u.uid)).size, s.party.length)
  const m = monarchOf(s)
  assert.ok(m && campOpen(s.camp, m.slot))
  if (s.phase !== 'over') assert.ok(m.hp > 0)
  if (s.death) assert.equal(s.phase, 'over')
  if (s.phase === 'over') assert.ok(s.result === 'victory' || (s.result === 'defeat' && s.death))
  else assert.ok(s.result === null || (s.result === 'victory' && s.floor > TUNING.run.floors))
  if (s.floor > TUNING.run.floors) assert.equal(s.result, 'victory')
  assert.equal(legalActions(run).some((a) => a.type === 'descend'), canDescend(s))
  assert.equal(CAMP_LIST.find((c) => c.id === s.camp).floor, Math.min(s.floor, TUNING.run.floors))
  const won = s.phase === 'over' && s.result === 'victory' && !s.death
  assert.equal(s.stats.floorsCleared, s.floor - 1 + (won ? 1 : 0))
  for (const u of souls(s.party)) assert.ok(Number.isInteger(u.hp) && u.hp >= 0 && u.hp <= u.maxHp)
}

test('the Sovereign slain is a clear, and the run stops there unless the player descends; the autoplayer never does', () => {
  const run = clearDeep()
  const s = run.state
  assert.deepEqual([s.phase, s.result, s.death, s.floor, s.stats.floorsCleared], ['over', 'victory', null, F, F])
  assert.deepEqual(legalActions(run), [{ type: 'descend' }])
  checkDeep(run)
  // Neither level descends: autoplay stops at the clear, and the policy has nothing for it.
  const n = s.log.length
  autoplay(run, { level: 'expert' })
  assert.equal(s.log.length, n)
  for (const level of ['basic', 'expert']) assert.throws(() => policy(run, createRng('x').stream('a'), level), /no policy/)
  // Descending: the next floor, deeper, from the last floor's camps; the clear stands.
  apply(run, { type: 'descend' })
  assert.deepEqual([s.phase, s.result, s.death, s.floor, s.stats.floorsCleared, s.at], ['map', 'victory', null, F + 1, F, s.map.start])
  assert.equal(s.map.floor, F + 1)
  assert.equal(s.map.nodes.find((n) => n.id === s.map.end).type, 'elite')
  assert.ok(!s.map.nodes.some((n) => n.type === 'boss'))
  assert.ok(!legalActions(run).some((a) => a.type === 'descend'))
  assert.throws(() => apply(run, { type: 'descend' }), /needs phase over/)
  for (const n of s.map.nodes.filter((x) => x.foes)) assert.equal(n.foes[0].lvl >= foeLevel(F + 1, n.rank) + E.level, true)
  checkDeep(run)
  // A defeat before any clear cannot descend.
  const lost = createRun({ start: START_PARTY, seed: 'deep-lost' })
  assert.throws(() => apply(lost, { type: 'descend' }), /needs phase over/)
})

// The deep, played: random legal actions a fifth of the time and the policy else, every invariant after
// every action, every legal action applying cleanly now and then, and the deep replayed exactly from the
// clear (the purse was topped up on the way down, outside the log, so the run before it does not replay).
test('the endless floors play on: a fight there is the deep\'s, a fall there ends the run and keeps the clear, and it replays exactly', () => {
  // The deep's machinery, not its difficulty (the final pass tunes that): its growth is held at nothing for
  // this walk, which plays on until the run ends or it is two floors down.
  const was = { ...E }
  Object.assign(E, { level: 0, count: 0, hp: 0, atk: 0, waves: 0, cohort: 0, rules: 99 })
  try { deepWalk() } finally { Object.assign(E, was) }
})
function deepWalk () {
  const run = clearDeep()
  const s = run.state
  const snap = structuredClone(s)
  const rng = createRng('deep').stream('fuzz')
  apply(run, { type: 'descend' })
  const deepFights = []
  for (let steps = 0; s.phase !== 'over' && s.floor <= F + 2 && steps < 4000; steps++) {
    const legal = legalActions(run)
    // Every action in the log, so the deep replays (no relic given here: nothing is bought for the Monarch).
    const action = rng.chance(0.2) ? rng.pick(legal) : policy(run, rng, STEADY)
    apply(run, action)
    if (action.type === 'fight') deepFights.push(run.setup)
    checkDeep(run)
    if (steps % 61 === 0) {
      for (const a of legalActions(run).filter((_, i) => i % 7 === 0)) {
        assert.doesNotThrow(() => apply({ ...run, state: structuredClone(s), battle: run.battle && fork(run.battle, { quiet: false }) }, a), JSON.stringify(a))
      }
    }
  }
  assert.ok(deepFights.length > 0, `${deepFights.length} fights in the deep`)
  for (const setup of deepFights) {
    assert.ok(setup.floor > F && !setup.boss)
    assert.deepEqual(setup.foeMods.map((m) => m.v), foeMods(setup.floor, false).map((m) => m.v))
  }
  // Rebuilt from the clear by its log, the deep is the same.
  const again = { state: structuredClone(snap), battle: null, setup: null }
  for (const a of s.log.slice(snap.log.length)) apply(again, a)
  assert.deepEqual(again.state, s)
  // A fall in the deep: the Monarch alone on the field, against a room of the deep, overrun as the battle opens. The run
  // is over, the clear stands, the death is recorded, and there is no descending from it.
  const fall = { state: structuredClone(snap), battle: null, setup: null }
  apply(fall, { type: 'descend' })
  const node = fall.state.map.nodes.find((n) => fall.state.map.nodes.find((x) => x.id === fall.state.at).next.includes(n.id) && n.foes)
  if (node) {
    apply(fall, { type: 'node', id: node.id })
    for (const u of fielded(souls(fall.state.party))) apply(fall, { type: 'place', uid: u.uid, slot: -1 })
    apply(fall, { type: 'fight' })
    while (fall.state.phase === 'battle') apply(fall, { type: 'end' })
    assert.deepEqual([fall.state.phase, fall.state.result, fall.state.death?.reason], ['over', 'victory', 'overrun'])
    assert.deepEqual(legalActions(fall), [])
    assert.throws(() => apply(fall, { type: 'descend' }), /slew the Sovereign/)
    checkDeep(fall)
    assert.equal(currentNode(fall).id, node.id)
  }
}

// replay(seed, log) across the endless floors, with no help from outside the log: the Sovereign stands on
// floor 1 here, alone and frail, and every foe at 60% of its HP and ATK (the souls start at their first level and
// nothing is bought for the Monarch since 2026-10-09), so rules of thumb can beat it, and the fuzz (a fifth random
// actions) goes on two floors into the deep. `descend` is legal and taken there.
test('fuzz with the Sovereign on floor 1: runs descend, play two floors deep, keep every invariant, and replay exactly', () => {
  const was = [TUNING.run.floors, TUNING.spawn.bossHp, TUNING.spawn.bossAtk, TUNING.spawn.court, TUNING.spawn.waves.siege, TUNING.spawn.foeHp, TUNING.spawn.foeAtk]
  Object.assign(TUNING.run, { floors: 1 })
  // The Sovereign's room is a siege of floor 1's foes ending in the Sovereign alone (no court, no other waves).
  Object.assign(TUNING.spawn, { bossHp: was[1].map(() => 0.02), bossAtk: was[2].map(() => 0.2), court: was[3].map(() => 0), foeHp: was[5].map((v) => v * 0.6), foeAtk: was[6].map((v) => v * 0.6) })
  TUNING.spawn.waves.siege = 1
  try {
    const seen = new Set()
    let descended = 0
    let deepest = 1
    for (let i = 0; i < 80 && descended < 2; i++) {
      const seed = 'shallow' + i
      const rng = createRng(seed).stream('fuzz')
      const run = createRun({ start: START_PARTY, seed })
      const s = run.state
      for (let steps = 0; steps < 6000 && s.floor <= 3; steps++) {
        const legal = legalActions(run)
        if (!legal.length) break
        const action = s.phase === 'over' ? legal[0] : rng.chance(0.2) ? rng.pick(legal) : policy(run, rng, STEADY)
        seen.add(action.type)
        apply(run, action)
        if (action.type === 'descend') descended++
        checkDeep(run)
      }
      deepest = Math.max(deepest, s.floor)
      if (s.log.some((a) => a.type === 'descend')) assert.deepEqual(replay(seed, s.log).state, s)
    }
    assert.equal(descended, 2, 'two runs slew the frail Sovereign and descended')
    assert.ok(seen.has('descend') && seen.has('fight') && seen.has('reap'))
    assert.ok(deepest >= 2, `deepest floor ${deepest}`)
  } finally {
    TUNING.run.floors = was[0]
    TUNING.spawn.bossHp = was[1]
    TUNING.spawn.bossAtk = was[2]
    TUNING.spawn.court = was[3]
    TUNING.spawn.waves.siege = was[4]
    Object.assign(TUNING.spawn, { foeHp: was[5], foeAtk: was[6] })
  }
})
