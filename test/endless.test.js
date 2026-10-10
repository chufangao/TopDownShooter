// Slice 8: synergy steps at 2/4/6/8 with a rule at the top, and the endless floors past the Sovereign.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stepBattle, runBattle, enterBattle, rulesOf } from '../src/sim/battle.js'
import { makeUnit, tileAt, tileX, tileY, activeSynergies, alive, SLOTS, campOpen, distance } from '../src/sim/unit.js'
import { SYNERGIES, KIN, ROLES, UNITS, CAMP_LIST, abilityDef } from '../src/content.js'
import { TUNING } from '../src/tuning.js'
import { tuned, FIRST_ARISE, BOARD_14, grant } from './tuned.js'
import {
  createRun, apply, legalActions, replay, depthOf, deepGrowth, foeMods, foeLevel, drawRoom, canDescend,
  MONARCH_UID, monarchOf, souls, fielded, currentNode, availableNodes, foeEssence, battleSetup, join
} from '../src/sim/run.js'
import { autoplay, policy, LEVELS } from '../src/sim/autoplay.js'
import { generateFloor, RANKS } from '../src/sim/map.js'
import { createRng } from '../src/sim/rng.js'
import { on, scene as sceneOf, unit } from './scene.js'

const E = TUNING.spawn.endless
const F = TUNING.run.floors

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

// A battle of units placed on tiles (scene.js scene). The run holds Arise (a Legendary relic: without it the Monarch
// raises no one) unless the scene names its own `relics`.
const scene = (units, opts) => sceneOf(units, { relics: ['arise'], ...opts })

// `n` party units of `ids` (cycled) on the tiles of `tiles` (cycled from the first), uids from `uid`.
const squad = (ids, tiles, uid = 1) => tiles.map(([x, y], i) => on(ids[i % ids.length], uid + i, 'party', x, y))
// Eight tiles: the front row of the camp's back half and one more behind its middle, or any row `y`.
const eight = (y) => [...Array(7).keys()].map((x) => [x, y]).concat([[3, y - 1]])
const seven = (y) => eight(y).slice(0, 7)
const set = (b, uid, hp) => { unit(b, uid).hp = hp }
// Steps until `done(b)` or the battle ends (or `max` ticks).
function until (b, done, max = 3000) {
  for (let k = 0; k < max && !b.over && !done(b); k++) stepBattle(b)
  return b
}
const rules = (b, rule) => b.events.filter((e) => e.type === 'rule' && e.rule === rule)

// What each action led to: [{ action, outcomes: the miss and damage events its actor caused until the next action }].
function outcomes (events) {
  const out = []
  for (const e of events) {
    if (e.type === 'action') out.push({ action: e, outcomes: [] })
    else if ((e.type === 'miss' || e.type === 'damage') && out.length && e.actor === out.at(-1).action.actor) out.at(-1).outcomes.push(e)
  }
  return out
}

// ── synergy steps ────────────────────────────────────────────────────────────────────────────────

test('every kin and role has its steps up to 8: the steps below are numbers, the 8 is a rule', () => {
  const steps = (axis, id) => SYNERGIES.filter((s) => Object.keys(s.needs).length === 1 && Object.keys(s.needs[axis] ?? {}).join() === id)
  const rulesSeen = new Set()
  const check = (axis, id, want) => {
    const list = steps(axis, id)
    assert.deepEqual(list.map((s) => s.needs[axis][id]).sort((a, b) => a - b), want, `${axis} ${id}`)
    for (const s of list) {
      const n = s.needs[axis][id]
      assert.equal(s.id, `${id}_${n}`)
      assert.ok(s.name && s.desc, s.id)
      if (n === 8) {
        assert.ok(typeof s.rule === 'string' && !rulesSeen.has(s.rule), `${s.id} has a rule of its own`)
        assert.deepEqual(s.mods, [], `${s.id} is a rule, not a number`)
        rulesSeen.add(s.rule)
      } else {
        assert.ok(!s.rule && s.mods.length > 0, `${s.id} is a number`)
      }
    }
  }
  for (const id of Object.keys(KIN)) check('kin', id, [2, 4, 6, 8])
  for (const id of Object.keys(ROLES).filter((r) => !ROLES[r].hidden)) check('role', id, id === 'ranger' ? [3, 6, 8] : [2, 4, 6, 8])
  assert.deepEqual([...rulesSeen].sort(), ['ambush', 'bodyguard', 'deadeye', 'deathblow', 'dragonfire', 'echo', 'frenzy', 'last_stand', 'legion', 'mirage', 'sanctuary'])
  // The old steps keep their ids.
  for (const id of ['undead_2', 'undead_4', 'drake_2', 'fae_2', 'insect_2', 'construct_2', 'vanguard_2', 'ranger_3', 'skirmisher_2', 'channeler_2', 'warden_2', 'trickster_2']) {
    assert.ok(SYNERGIES.some((s) => s.id === id), id)
  }
})

test('shadows count toward the steps, a stack once, the Monarch never; the steps stack; a battle announces its rules', () => {
  const captain = makeUnit('grave_ghoul', { uid: 1, slot: 0 })
  const members = Array.from({ length: 7 }, (_, k) => makeUnit(k % 2 ? 'bone_chanter' : 'grave_ghoul', { uid: 10 + k, slot: 1 + k }))
  const ids = (units) => activeSynergies(units).map((s) => s.id).filter((id) => id.startsWith('undead'))
  assert.deepEqual(ids([captain, ...members]), ['undead_2', 'undead_4', 'undead_6', 'undead_8'])
  assert.deepEqual(ids([captain, ...members.slice(1), makeUnit('monarch', { uid: 0, lvl: 0 })]), ['undead_2', 'undead_4', 'undead_6'])
  assert.deepEqual(ids([makeUnit('grave_ghoul', { uid: 1, count: 8 })]), [], 'eight bodies in one piece are one')
  const b = scene([...squad(['grave_ghoul', 'bone_chanter'], eight(2)), on('clockwork_page', 100, 'foe', 3, 9)])
  assert.ok(b.events[0].synergies.some((s) => s.side === 'party' && s.id === 'undead_8'))
  assert.deepEqual([...rulesOf(b, 'party')], ['legion'])
  assert.deepEqual([...rulesOf(b, 'foe')], [])
  // A shadow is a unit like any other: seven undead and a risen one are Undead 8.
  const seven7 = scene([...squad(['grave_ghoul'], seven(2)), on('clockwork_page', 100, 'foe', 3, 9)])
  assert.ok(!rulesOf(seven7, 'party').has('legion'))
  enterBattle(seven7, { ...makeUnit('tomb_knight', { uid: 50, lvl: 3 }), side: 'party', shadow: true, tile: tileAt(3, 4) })
  assert.ok(rulesOf(seven7, 'party').has('legion'))
})

// The Legion (Undead 8): every foe slain rises on your side, past Arise's limit and tier.
test('Undead 8: every foe slain rises at once as a shadow of yours, past Arise\'s limit and tier; never a boss or a shadow', () => tuned({ ...BOARD_14, ...FIRST_ARISE }, () => {
  const foes = () => [on('clockwork_page', 101, 'foe', 1, 6), on('iron_golem', 102, 'foe', 3, 6), on('frost_sprite', 103, 'foe', 5, 6)]
  const fight = (party) => {
    const b = scene([...party, on('monarch', MONARCH_UID, 'party', 3, 1), ...foes()])
    for (const uid of [101, 102, 103]) set(b, uid, 1)
    return runBattle(b) && b
  }
  const b = fight(squad(['grave_ghoul'], eight(5)))
  assert.equal(b.winner, 'party')
  const risen = b.events.filter((e) => e.type === 'arise')
  assert.deepEqual(risen.map((e) => [e.corpse, e.unit.id, e.unit.side, e.unit.shadow, e.rule]).sort(),
    [[101, 'clockwork_page', 'party', true, 'legion'], [102, 'iron_golem', 'party', true, 'legion'], [103, 'frost_sprite', 'party', true, 'legion']])
  for (const e of risen) {
    const corpse = unit(b, e.corpse)
    // Risen on your side, it stands beside the Monarch, not where it fell.
    assert.equal(e.from, corpse.tile)
    assert.ok(distance(e.unit.tile, b.monarch.tile) < distance(corpse.tile, b.monarch.tile), `${e.unit.tile} from ${corpse.tile}`)
    assert.ok(corpse.raised)
    assert.ok(unit(b, e.unit.uid).shadow && unit(b, e.unit.uid).nextStep === Infinity, 'a shadow: it holds')
    // The rule is announced right before the shadow rises, by its raiser.
    const i = b.events.indexOf(e)
    assert.deepEqual([b.events[i - 1].type, b.events[i - 1].rule, b.events[i - 1].target, b.events[i - 1].actor], ['rule', 'legion', e.corpse, e.actor])
    assert.equal(unit(b, e.actor).side, 'party')
  }
  assert.equal(b.raised, 0, 'Arise\'s count is untouched (a tier-3 golem rose with one copy)')
  // Seven undead: no Legion; only Arise raises, once.
  const c = fight(squad(['grave_ghoul'], seven(5)))
  assert.equal(rules(c, 'legion').length, 0)
  assert.ok(c.events.filter((e) => e.type === 'arise').every((e) => !e.rule && e.actor === MONARCH_UID))
  assert.ok(c.raised <= 1)
  // A boss and a shadow never rise.
  const d = scene([...squad(['grave_ghoul'], eight(5)), { ...on('frost_sprite', 101, 'foe', 1, 6), shadow: true }, on('hollow_sovereign', 102, 'foe', 3, 6)])
  set(d, 101, 1)
  set(d, 102, 1)
  until(d, () => unit(d, 101).hp <= 0 && unit(d, 102).hp <= 0)
  assert.ok(unit(d, 101).hp <= 0 && unit(d, 102).hp <= 0)
  assert.deepEqual([rules(d, 'legion').length, d.events.filter((e) => e.type === 'arise').length], [0, 0])
}))

test('Undead 8 works for the foes too: one of yours slain rises on their side', () => {
  const b = scene([
    on('mantis_reaper', 1, 'party', 3, 5), on('monarch', MONARCH_UID, 'party', 3, 0),
    ...[[2, 6], [3, 6], [4, 6], [2, 7], [3, 7], [4, 7], [1, 7], [5, 7]].map(([x, y], i) => on('grave_ghoul', 101 + i, 'foe', x, y))
  ])
  set(b, 1, 1)
  until(b, () => unit(b, 1).hp <= 0)
  const risen = b.events.find((e) => e.type === 'arise')
  assert.deepEqual([risen.corpse, risen.unit.id, risen.unit.side, risen.rule], [1, 'mantis_reaper', 'foe', 'legion'])
  // A foe's shadow is a foe like any other: it walks the roads.
  const shade = unit(b, risen.unit.uid)
  assert.ok(shade.shadow && shade.side === 'foe' && shade.behaviour === 'flank')
})

// A run's reap after the foes' Legion: a soul of yours that rose against you is no foe's soul. It is not for
// sale and pays no essence (iron golem: a kind none of the eight ghouls is).
test('Undead 8 on the foes\' side: your fallen risen against you are not sold back or paid for', () => {
  // The foes hold their rules only in the deep (TUNING.spawn.endless.rules): here, on floor 1, from the start.
  const was = TUNING.spawn.endless.rules
  TUNING.spawn.endless.rules = 0
  try { legionReap() } finally { TUNING.spawn.endless.rules = was }
})
function legionReap () {
  // Souls of level 20, so that some seed wins (the reap needs a won battle).
  let won = null
  for (let i = 0; i < 20 && !won; i++) {
    const run = createRun({ seed: `legion-reap${i}` })
    const s = run.state
    s.party = s.party.map((u) => u.uid === MONARCH_UID ? u : { ...makeUnit(u.id, { uid: u.uid, lvl: 20 }), slot: u.slot })
    for (const k of Object.values(s.kinds)) k.lvl = 20
    const golem = join(run, 'iron_golem')
    Object.assign(golem, { slot: -1, hp: 1 })
    const node = availableNodes(run)[0]
    node.type = 'fight'
    node.foes = [...Array(8).keys()].map((slot) => ({ id: 'grave_ghoul', lvl: 1, slot }))
    apply(run, { type: 'node', id: node.id })
    apply(run, legalActions(run).find((a) => a.type === 'place' && a.uid === golem.uid && a.slot >= 0))
    const before = s.essence
    apply(run, { type: 'fight' })
    if (s.phase === 'reap') won = { run, earned: s.essence - before }
  }
  assert.ok(won, 'some seed won')
  const { run, earned } = won
  const b = run.battle
  assert.ok(b.units.some((u) => u.side === 'foe' && u.shadow && u.id === 'iron_golem' && u.hp <= 0), 'the golem rose against you, and fell')
  assert.ok(!run.state.offers.some((o) => o.type === 'soul' && o.id === 'iron_golem'))
  assert.ok(run.state.offers.some((o) => o.type === 'soul' && o.id === 'grave_ghoul'))
  const paid = b.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0).reduce((n, u) => n + foeEssence(u), 0)
  assert.equal(earned, Math.round(paid))
}

// Mirage (Fae 8): each foe's first blow that would land misses.
test('Fae 8: the first blow each foe would land in a battle misses, and only the first', () => {
  const play = (tiles) => {
    const b = scene([...squad(['frost_sprite', 'will_o_wisp', 'thorn_dryad'], tiles(5)), ...[1, 3, 5].map((x, i) => on('tomb_knight', 101 + i, 'foe', x, 6, 10))])
    return until(b, () => false, 400)
  }
  const b = play(eight)
  const struck = new Set()
  let landed = 0
  for (const e of b.events) {
    if (e.type === 'rule' && e.rule === 'mirage') {
      assert.ok(!struck.has(e.actor), 'one Mirage a foe')
      struck.add(e.actor)
      assert.equal(unit(b, e.target).side, 'party')
      const next = b.events[b.events.indexOf(e) + 1]
      assert.deepEqual([next.type, next.actor, next.target], ['miss', e.actor, e.target])
    }
    if (e.type === 'damage' && e.actor > 100 && unit(b, e.target).side === 'party') {
      assert.ok(struck.has(e.actor), 'no blow lands before the Mirage')
      landed++
    }
  }
  assert.deepEqual([...struck].sort(), [101, 102, 103])
  assert.ok(landed > 0, 'later blows land')
  assert.equal(rules(play(seven), 'mirage').length, 0)
})

// Last Stand (Construct 8): the first blow that would fell each of yours leaves it at 1 HP; never the Monarch.
test('Construct 8: the first killing blow leaves a unit standing at 1 HP, once; never the Monarch', () => {
  const party = (tiles) => squad(['clockwork_page', 'clockwork_page', 'iron_golem'], tiles(5))
  const b = scene([...party(eight), on('barrow_wight', 101, 'foe', 2, 6), on('grave_ghoul', 102, 'foe', 4, 6)])
  const page = b.units.find((u) => u.side === 'party' && tileX(u.tile) === 3 && tileY(u.tile) === 5)
  page.hp = 5
  until(b, () => page.hp <= 0)
  const stood = rules(b, 'last_stand')
  assert.ok(stood.length >= 1)
  const mine = stood.filter((e) => e.target === page.uid)
  assert.equal(mine.length, 1, 'once a battle')
  const i = b.events.indexOf(mine[0])
  assert.deepEqual([b.events[i - 1].type, b.events[i - 1].target, b.events[i - 1].hp], ['damage', page.uid, 1])
  assert.ok(page.stood && page.hp <= 0, 'the next killing blow fells it')
  // Seven constructs: no Last Stand.
  const c = scene([...party(seven), on('barrow_wight', 101, 'foe', 2, 6), on('grave_ghoul', 102, 'foe', 4, 6)])
  until(c, () => false, 300)
  assert.equal(rules(c, 'last_stand').length, 0)
  // The Monarch has no last stand: it falls, and the battle is lost.
  const m = scene([...squad(['clockwork_page', 'iron_golem'], eight(1)), on('monarch', MONARCH_UID, 'party', 3, 6), on('grave_ghoul', 101, 'foe', 3, 7)])
  set(m, MONARCH_UID, 1)
  runBattle(m)
  assert.deepEqual([m.winner, m.reason, rules(m, 'last_stand').length], ['foe', 'monarch', 0])
})

// Frenzy (Insect 8): a slayer's gauge fills at once.
test('Insect 8: one of yours that slays a foe has its gauge filled, and strikes again next', () => {
  const play = (tiles) => {
    const b = scene([...squad(['mantis_reaper', 'hive_warden'], tiles(5)), ...[0, 2, 4, 6].map((x, i) => on('clockwork_page', 101 + i, 'foe', x, 6))])
    for (let uid = 101; uid <= 104; uid++) set(b, uid, 1)
    return b
  }
  const b = play(eight)
  let frenzies = 0
  while (!b.over) {
    const ev = stepBattle(b)
    for (const e of ev.filter((x) => x.type === 'rule' && x.rule === 'frenzy')) {
      const slayer = unit(b, e.actor)
      assert.equal(slayer.gauge, slayer.costliest, 'its gauge is full')
      const i = ev.indexOf(e)
      assert.deepEqual([ev[i - 1].type, ev[i - 1].target], ['death', e.target])
      frenzies++
    }
  }
  assert.equal(frenzies, 4)
  const c = play(seven)
  runBattle(c)
  assert.equal(rules(c, 'frenzy').length, 0)
})

// Dragonfire (Drake 8): a single-target attack bursts on everyone next to its target.
test('Drake 8: every single-target attack of yours strikes its target and every foe next to it', () => {
  const play = (tiles) => {
    const b = scene([...squad(['ember_drake', 'frost_wyrm'], tiles(1)), on('frost_sprite', 20, 'party', 3, 6), ...[2, 3, 4].map((x, i) => on('clockwork_page', 101 + i, 'foe', x, 8))])
    until(b, () => b.events.some((e) => e.type === 'action' && e.actor === 20))
    return b.events.find((e) => e.type === 'action' && e.actor === 20)
  }
  const burst = play(eight)
  assert.equal(burst.ability, 'frost_lance')
  assert.ok(burst.targets.length >= 2, `${burst.targets}`)
  assert.equal(play(seven).targets.length, 1)
})

// Bodyguard (Vanguard 8): a single-target blow at one of yours lands on a Vanguard next to it.
test('Vanguard 8: a single-target blow at a non-Vanguard of yours falls on a Vanguard beside it: the Monarch is guarded', () => {
  const play = (n) => {
    const line = squad(['tomb_knight', 'grave_ghoul', 'iron_golem'], eight(1).slice(0, n - 1))
    // A Wisp (a Flank kind) halts beside the Monarch and shoots it.
    const b = scene([...line, on('tomb_knight', 8, 'party', 2, 5), on('monarch', MONARCH_UID, 'party', 3, 6), on('will_o_wisp', 101, 'foe', 3, 7)])
    until(b, () => b.events.some((e) => e.type === 'action' && e.actor === 101))
    return b
  }
  const b = play(8)
  const i = b.events.findIndex((e) => e.type === 'action' && e.actor === 101)
  assert.deepEqual([b.events[i - 1].type, b.events[i - 1].rule, b.events[i - 1].actor, b.events[i - 1].target], ['rule', 'bodyguard', 8, MONARCH_UID])
  assert.deepEqual(b.events[i].targets, [8])
  assert.ok(!b.events.some((e) => e.type === 'damage' && e.target === MONARCH_UID))
  const c = play(7)
  assert.deepEqual(c.events.find((e) => e.type === 'action' && e.actor === 101).targets, [MONARCH_UID])
  assert.equal(rules(c, 'bodyguard').length, 0)
})

// Deadeye (Ranger 8): ranged blows never miss and always crit.
test('Ranger 8: ranged blows of yours never miss and every one is a critical hit', () => {
  const play = (tiles) => {
    const b = scene([...squad(['ember_drake', 'frost_wyrm'], tiles(6)), ...[[1, 9], [3, 9], [5, 9], [2, 10], [4, 10]].map(([x, y], i) => on(i < 3 ? 'clockwork_page' : 'tomb_knight', 101 + i, 'foe', x, y))])
    runBattle(b)
    return outcomes(b.events).filter((o) => o.action.actor < 100 && !abilityDef(o.action.ability).melee).flatMap((o) => o.outcomes)
  }
  const sure = play(eight)
  assert.ok(sure.length > 5)
  assert.ok(sure.every((e) => e.type === 'damage' && e.isCrit), JSON.stringify(sure.find((e) => !(e.type === 'damage' && e.isCrit))))
  const unsure = play(seven)
  assert.ok(unsure.some((e) => e.type === 'miss' || !e.isCrit))
  // Melee blows are left to the roll: ghouls at the nimble sprites' throats (out of the rangers' reach) still
  // miss, or land without a crit, while the rangers' blows at a knight in reach all crit.
  const b = scene([...squad(['ember_drake', 'frost_wyrm'], eight(2)), ...[1, 3, 5].map((x, i) => on('grave_ghoul', 11 + i, 'party', x, 6)),
    ...[1, 3, 5].map((x, i) => on('frost_sprite', 101 + i, 'foe', x, 7, 10)), on('tomb_knight', 104, 'foe', 3, 4, 20)])
  runBattle(b)
  const mine = outcomes(b.events).filter((o) => o.action.actor < 100)
  const melee = mine.filter((o) => abilityDef(o.action.ability).melee).flatMap((o) => o.outcomes)
  const ranged = mine.filter((o) => !abilityDef(o.action.ability).melee).flatMap((o) => o.outcomes)
  assert.ok(melee.length > 3 && ranged.length > 3, `${melee.length} melee, ${ranged.length} ranged`)
  assert.ok(melee.some((e) => e.type === 'miss' || !e.isCrit))
  assert.ok(ranged.every((e) => e.type === 'damage' && e.isCrit))
})

// Ambush (Skirmisher 8): full gauges at the start and on entry.
test('Skirmisher 8: yours start the battle, and enter it, with a full gauge', () => {
  const play = (tiles) => scene([...squad(['frost_sprite', 'barrow_wight'], tiles(5)), on('monarch', MONARCH_UID, 'party', 3, 0), on('tomb_knight', 101, 'foe', 3, 10)])
  const b = play(eight)
  assert.ok(b.units.filter((u) => u.side === 'party').every((u) => u.gauge === u.costliest))
  assert.equal(unit(b, 101).gauge, 0)
  assert.deepEqual(rules(b, 'ambush').map((e) => e.side), ['party'])
  const late = enterBattle(b, { ...makeUnit('grave_ghoul', { uid: 50, lvl: 3 }), side: 'party', tile: tileAt(3, 2) })
  assert.equal(late.gauge, late.costliest)
  const c = play(seven)
  assert.ok(c.units.every((u) => u.gauge === 0))
  assert.equal(rules(c, 'ambush').length, 0)
})

// Echo (Channeler 8): every ability rings out twice; Arise never.
test('Channeler 8: every ability of yours rings out twice, on the same targets; Arise never echoes', () => {
  const play = (tiles) => {
    const b = scene([...squad(['will_o_wisp', 'bone_chanter'], tiles(5)), on('monarch', MONARCH_UID, 'party', 3, 0),
      on('tomb_knight', 101, 'foe', 3, 9, 20), on('frost_sprite', 102, 'foe', 3, 3)])
    set(b, 102, 1)
    return until(b, () => false, 500)
  }
  const b = play(eight)
  const echoes = rules(b, 'echo')
  assert.ok(echoes.length >= 3)
  assert.ok(!echoes.some((e) => e.ability === 'arise'))
  assert.ok(b.events.some((e) => e.type === 'arise' && e.actor === MONARCH_UID), 'the Monarch raised the sprite')
  for (const e of echoes) {
    const i = b.events.indexOf(e)
    const act = b.events.slice(0, i).findLast((x) => x.type === 'action')
    assert.deepEqual([act.actor, act.ability], [e.actor, e.ability])
  }
  // A Witchfire on the knight, which stands through both: two blows, one each pass.
  const fire = outcomes(b.events).find((o) => o.action.ability === 'witchfire' && o.action.targets[0] === 101)
  assert.equal(fire.outcomes.filter((x) => x.target === 101).length, 2)
  assert.equal(rules(play(seven), 'echo').length, 0)
})

// Sanctuary (Warden 8): an ally ability touches every ally.
test('Warden 8: an ability aimed at an ally touches every one of yours on the board', () => {
  const play = (tiles) => {
    const b = scene([...squad(['hive_warden', 'thorn_dryad'], tiles(1)), on('clockwork_page', 20, 'party', 3, 5), on('clockwork_page', 101, 'foe', 3, 10)])
    set(b, 20, 10)
    until(b, () => b.events.some((e) => e.type === 'action' && e.ability === 'mend'))
    return [b, b.events.find((e) => e.type === 'action' && e.ability === 'mend')]
  }
  const [b, mend] = play(eight)
  assert.deepEqual(mend.targets.slice().sort((x, y) => x - y), b.units.filter((u) => u.side === 'party' && alive(u)).map((u) => u.uid).sort((x, y) => x - y))
  assert.deepEqual(play(seven)[1].targets, [20])
})

// Deathblow (Trickster 8): a crit slays outright, a boss excepted.
test('Trickster 8: a critical hit of yours slays any foe outright, but not a boss', () => {
  const ring = [[2, 3], [3, 3], [4, 3], [2, 5], [3, 5], [4, 5], [2, 4], [4, 4]]
  const play = (foe, n) => scene([...squad(['clockwork_page', 'mantis_reaper'], ring.slice(0, n)), on('monarch', MONARCH_UID, 'party', 3, 0), on(foe, 101, 'foe', 3, 4)])
  const b = play('iron_golem', 8)
  const golem = unit(b, 101)
  until(b, () => golem.hp <= 0)
  const blow = rules(b, 'deathblow')
  assert.equal(blow.length, 1)
  const i = b.events.indexOf(blow[0])
  assert.deepEqual([b.events[i + 1].type, b.events[i + 1].isCrit, b.events[i + 1].hp, b.events[i + 2].type], ['damage', true, 0, 'death'])
  // The first crit on it was the Deathblow.
  assert.equal(b.events.slice(0, i).filter((e) => e.type === 'damage' && e.target === 101 && e.isCrit).length, 0)
  // The Sovereign takes its crits and stands.
  const s = play('hollow_sovereign', 8)
  let crits = 0
  for (let k = 0; k < 400 && !s.over && rulesOf(s, 'party').has('deathblow'); k++) {
    for (const e of stepBattle(s)) if (e.type === 'damage' && e.target === 101 && e.isCrit) crits++
  }
  assert.ok(crits > 0 && unit(s, 101).hp > 0)
  assert.equal(rules(s, 'deathblow').length, 0)
  const c = play('iron_golem', 7)
  until(c, () => unit(c, 101).hp <= 0)
  assert.equal(rules(c, 'deathblow').length, 0)
  // Last Stand outranks Deathblow: against foes at Construct 8, the first crit is turned at 1 HP and no
  // Deathblow is announced; once the stand is spent it falls as any foe does. Every Deathblow announced slays.
  // (The other seven constructs stand out of everyone's reach and shallower than the golem, so it stays the
  // flankers' quarry.)
  const d = scene([...squad(['clockwork_page', 'mantis_reaper'], ring), on('monarch', MONARCH_UID, 'party', 3, 0), on('iron_golem', 101, 'foe', 3, 4),
    ...[[0, 0], [0, 1], [0, 2], [6, 0], [6, 1], [6, 2], [1, 0]].map(([x, y], i) => on(i % 2 ? 'iron_golem' : 'clockwork_page', 102 + i, 'foe', x, y))])
  const g = unit(d, 101)
  until(d, () => g.hp <= 0)
  const stand = rules(d, 'last_stand').find((e) => e.target === 101)
  const j = d.events.indexOf(stand)
  assert.deepEqual([d.events[j - 1].type, d.events[j - 1].isCrit, d.events[j - 1].hp], ['damage', true, 1])
  assert.ok(!d.events.slice(0, j).some((e) => e.type === 'rule' && e.rule === 'deathblow' && e.target === 101))
  assert.ok(g.hp <= 0)
  const slays = (x) => rules(x, 'deathblow').every((e) => x.events[x.events.indexOf(e) + 1].hp === 0)
  assert.ok(slays(b) && slays(d), 'a Deathblow announced slays')
})

// ── the rules on the foes' side ─────────────────────────────────────────────────────────────────

// Every rule holds for whichever side reaches it: the foes of the deep hold them against you. Each scene below
// mirrors one of the party's: eight foes of a kin or role, and a few of yours to meet them; every rule event
// is the foes', and does to you what it does for you.
const foeSquad = (ids, tiles, uid = 101) => tiles.map(([x, y], i) => on(ids[i % ids.length], uid + i, 'foe', x, y))
// Eight tiles of their side: a row `y` and one more behind its middle (behind is further up for them).
const theirEight = (y) => [...Array(7).keys()].map((x) => [x, y]).concat([[3, y + 1]])
const foeRules = (b, rule) => rules(b, rule).filter((e) => e.side === 'foe')

test('the rules work for the foes too: Mirage, Last Stand, Frenzy, Dragonfire, Bodyguard, Deadeye, Ambush, Echo, Sanctuary', () => {
  // Mirage (their Fae 8): the first blow each of yours would land on them misses.
  {
    const knight = (x, i) => on('tomb_knight', 1 + i, 'party', x, 6, 10)
    const b = scene([...foeSquad(['frost_sprite', 'will_o_wisp', 'thorn_dryad'], theirEight(7)), ...[1, 3, 5].map(knight)])
    until(b, () => false, 400)
    const m = foeRules(b, 'mirage')
    assert.ok(m.length >= 1 && m.length === rules(b, 'mirage').length)
    assert.equal(new Set(m.map((e) => e.actor)).size, m.length, 'one Mirage for each of yours')
    for (const e of m) {
      assert.ok(e.actor <= 3 && unit(b, e.target).side === 'foe')
      const next = b.events[b.events.indexOf(e) + 1]
      assert.deepEqual([next.type, next.actor, next.target], ['miss', e.actor, e.target])
    }
  }
  // Last Stand (their Construct 8): their first killing blow leaves the foe at 1 HP.
  {
    const b = scene([...foeSquad(['clockwork_page', 'clockwork_page', 'iron_golem'], theirEight(7)), on('barrow_wight', 1, 'party', 2, 5), on('grave_ghoul', 2, 'party', 4, 6)])
    const page = unit(b, 104)
    page.hp = 5
    until(b, () => page.hp <= 0)
    const mine = foeRules(b, 'last_stand').filter((e) => e.target === 104)
    assert.equal(mine.length, 1)
    const i = b.events.indexOf(mine[0])
    assert.deepEqual([b.events[i - 1].type, b.events[i - 1].target, b.events[i - 1].hp], ['damage', 104, 1])
  }
  // Frenzy (their Insect 8): a foe that slays one of yours has its gauge filled: once for each page slain (at 1 HP, a
  // blow slays it; a page no foe can strike back at, nothing in its way and never striking, outlives the rest).
  {
    const b = scene([...foeSquad(['mantis_reaper', 'hive_warden'], theirEight(7)), ...[0, 2, 4, 6].map((x, i) => on('clockwork_page', 1 + i, 'party', x, 6))])
    for (let uid = 1; uid <= 4; uid++) set(b, uid, 1)
    let frenzies = 0
    while (!b.over) {
      for (const e of stepBattle(b).filter((x) => x.type === 'rule' && x.rule === 'frenzy')) {
        assert.equal(e.side, 'foe')
        const slayer = unit(b, e.actor)
        assert.ok(slayer.side === 'foe' && slayer.gauge === slayer.costliest)
        assert.equal(unit(b, e.target).side, 'party')
        frenzies++
      }
    }
    assert.ok(frenzies > 0)
    assert.equal(frenzies, [1, 2, 3, 4].filter((uid) => !alive(unit(b, uid))).length)
  }
  // Dragonfire (their Drake 8): a foe's single-target attack bursts on yours next to its target (the Sprite halted in
  // the pages' rings).
  {
    const b = scene([...foeSquad(['ember_drake', 'frost_wyrm'], theirEight(9)), on('frost_sprite', 120, 'foe', 3, 6), ...[2, 3, 4].map((x, i) => on('clockwork_page', 1 + i, 'party', x, 5))])
    until(b, () => b.events.some((e) => e.type === 'action' && e.actor === 120))
    const burst = b.events.find((e) => e.type === 'action' && e.actor === 120)
    assert.equal(burst.ability, 'frost_lance')
    assert.ok(burst.targets.length >= 2 && burst.targets.every((uid) => unit(b, uid).side === 'party'), `${burst.targets}`)
  }
  // Bodyguard (their Vanguard 8): your single-target blow at a foe that is no Vanguard falls on a Vanguard
  // beside it.
  {
    const b = scene([...foeSquad(['tomb_knight', 'grave_ghoul', 'iron_golem'], [...Array(7).keys()].map((x) => [x, 10])), on('tomb_knight', 108, 'foe', 2, 9),
      on('frost_sprite', 120, 'foe', 3, 8), on('will_o_wisp', 1, 'party', 3, 4)])
    until(b, () => b.events.some((e) => e.type === 'action' && e.actor === 1))
    const i = b.events.findIndex((e) => e.type === 'action' && e.actor === 1)
    assert.deepEqual([b.events[i - 1].type, b.events[i - 1].rule, b.events[i - 1].side, b.events[i - 1].actor, b.events[i - 1].target], ['rule', 'bodyguard', 'foe', 108, 120])
    assert.deepEqual(b.events[i].targets, [108])
  }
  // Deadeye (their Ranger 8): their ranged blows never miss and always crit (the foes halted in the rings of yours, or
  // behind a comrade).
  {
    const b = scene([...foeSquad(['ember_drake', 'frost_wyrm'], theirEight(7)), ...[[1, 6], [3, 6], [5, 6], [2, 5], [4, 5]].map(([x, y], i) => on(i < 3 ? 'clockwork_page' : 'tomb_knight', 1 + i, 'party', x, y))])
    until(b, () => false, 600)
    const sure = outcomes(b.events).filter((o) => o.action.actor > 100 && !abilityDef(o.action.ability).melee).flatMap((o) => o.outcomes)
    assert.ok(sure.length > 3, `${sure.length} ranged outcomes`)
    assert.ok(sure.every((e) => e.type === 'damage' && e.isCrit))
  }
  // Ambush (their Skirmisher 8): they start with full gauges, and say so; yours start empty.
  {
    const b = scene([...foeSquad(['frost_sprite', 'barrow_wight'], theirEight(8)), on('monarch', MONARCH_UID, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4)])
    assert.ok(b.units.filter((u) => u.side === 'foe').every((u) => u.gauge === u.costliest))
    assert.ok(b.units.filter((u) => u.side === 'party').every((u) => u.gauge === 0))
    assert.deepEqual(rules(b, 'ambush').map((e) => e.side), ['foe'])
    const late = enterBattle(b, { ...makeUnit('grave_ghoul', { uid: 150, lvl: 3 }), side: 'foe', tile: tileAt(3, 7) })
    assert.equal(late.gauge, late.costliest)
  }
  // Echo (their Channeler 8): their abilities ring out twice (the Chanters beside the knight halted in its ring, the
  // Wisp behind one of them halted by it: a Flank kind heeds no ring).
  {
    const b = scene([...foeSquad(['bone_chanter', 'will_o_wisp'], theirEight(7)), on('tomb_knight', 1, 'party', 3, 6, 20)])
    until(b, () => false, 500)
    const echoes = rules(b, 'echo')
    assert.ok(echoes.length >= 3 && echoes.every((e) => e.side === 'foe' && unit(b, e.actor).side === 'foe'))
    const fire = outcomes(b.events).find((o) => o.action.ability === 'witchfire' && o.action.targets[0] === 1)
    assert.equal(fire.outcomes.filter((x) => x.target === 1).length, 2)
  }
  // Sanctuary (their Warden 8): a foe's ally ability touches every foe on the board (cast by those halted in a page's
  // ring).
  {
    const b = scene([...foeSquad(['hive_warden', 'thorn_dryad'], theirEight(7)), on('clockwork_page', 120, 'foe', 0, 9), on('clockwork_page', 1, 'party', 3, 6)])
    set(b, 120, 10)
    until(b, () => b.events.some((e) => e.type === 'action' && e.ability === 'mend'))
    const mend = b.events.find((e) => e.type === 'action' && e.ability === 'mend')
    assert.deepEqual(mend.targets.slice().sort((x, y) => x - y), b.units.filter((u) => u.side === 'foe' && alive(u)).map((u) => u.uid).sort((x, y) => x - y))
  }
})

// Deathblow (their Trickster 8): a foe's crit slays one of yours outright; never the Monarch, whose fall would
// end the run on one roll.
test('their Deathblow slays one of yours outright on a crit, but never the Monarch', () => {
  const ring = [[2, 3], [3, 3], [4, 3], [2, 5], [3, 5], [4, 5], [2, 4], [4, 4]]
  // (No Monarch here: flankers hunt the deepest of yours, and would pass the golem by for it.)
  const b = scene([...foeSquad(['clockwork_page', 'mantis_reaper'], ring), on('iron_golem', 1, 'party', 3, 4)])
  const golem = unit(b, 1)
  until(b, () => golem.hp <= 0)
  const blow = foeRules(b, 'deathblow')
  assert.equal(blow.length, 1)
  const i = b.events.indexOf(blow[0])
  assert.deepEqual([b.events[i + 1].type, b.events[i + 1].isCrit, b.events[i + 1].hp, b.events[i + 2].type], ['damage', true, 0, 'death'])
  // The Monarch, ringed by the same tricksters, takes their crits as blows.
  const m = scene([...foeSquad(['clockwork_page', 'mantis_reaper'], ring), on('monarch', MONARCH_UID, 'party', 3, 4, 40)])
  let crits = 0
  for (let k = 0; k < 600 && !m.over; k++) {
    for (const e of stepBattle(m)) if (e.type === 'damage' && e.target === MONARCH_UID && e.isCrit && e.hp > 0) crits++
  }
  assert.ok(crits > 0, 'it took crits and stood')
  assert.equal(rules(m, 'deathblow').length, 0)
})

// Last Stand meets Undying: the stand comes first, and the rise after the next killing blow.
test('Last Stand under Undying comes before the rise', () => {
  const constructs = [[0, 1], [1, 1], [2, 1], [4, 1], [5, 1]].map(([x, y], i) => on('clockwork_page', 20 + i, 'party', x, y))
  const u = scene([on('iron_golem', 1, 'party', 3, 4), ...constructs, on('clockwork_page', 26, 'party', 6, 1), on('clockwork_page', 27, 'party', 6, 0),
    on('frost_sprite', 101, 'foe', 3, 5, 20)], { relics: ['arise', 'undying'] })
  assert.ok(rulesOf(u, 'party').has('last_stand'))
  const golem = unit(u, 1)
  golem.hp = 1
  until(u, () => u.events.some((e) => e.type === 'rise'))
  const order = u.events.filter((e) => e.target === 1 && ['rule', 'death', 'rise'].includes(e.type)).map((e) => e.rule ?? e.type)
  assert.deepEqual(order.slice(0, 3), ['last_stand', 'death', 'rise'])
})

// The foes hold their rules only in the deep: above it their ladders stop at the stat steps
// (TUNING.spawn.endless.rules).
test('the foes hold their 8-step rules only in the deep; their stat steps hold everywhere', () => {
  const drakes = (opts) => scene([...foeSquad(['ember_drake', 'frost_wyrm'], theirEight(8)), on('tomb_knight', 1, 'party', 3, 4)], opts)
  const shallow = drakes({ foeRules: false })
  assert.deepEqual([...rulesOf(shallow, 'foe')], [])
  const named = shallow.events[0].synergies.filter((x) => x.side === 'foe').map((x) => x.id)
  assert.ok(named.includes('drake_6') && !named.includes('drake_8'), `${named}`)
  const deep = drakes({})
  assert.deepEqual([...rulesOf(deep, 'foe')].sort(), ['deadeye', 'dragonfire'])
  assert.ok(deep.events[0].synergies.some((x) => x.side === 'foe' && x.id === 'drake_8'))
  // The run decides it by the floor: shallow floors none, the deep from E.rules floors down.
  const run = createRun({ seed: 'foe-rules' })
  apply(run, { type: 'node', id: availableNodes(run).find((n) => n.foes).id })
  assert.equal(battleSetup(run).foeRules, false)
  run.state.floor = F + E.rules
  assert.equal(battleSetup(run).foeRules, true)
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
  assert.deepEqual(foeMods(F + 3, false).map((m) => m.v), [sp.foeHp[F - 1] * (1 + 3 * E.hp), sp.foeAtk[F - 1] * (1 + 3 * E.atk)])
  // Rooms on endless floors: the last floor's pool, its counts grown, levels raised, more waves to every room
  // and a bigger cohort behind every captain; the end a big elite.
  let rooms = 0
  for (const floor of [F + 1, F + 2, F + 4]) {
    for (const seed of ['deep0', 'deep1']) {
      const map = generateFloor({ seed, floor, last: floor === F })
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
          assert.equal(foes.length, n, `${floor} ${node.id}: foes a wave`)
          assert.ok(foes.length <= SLOTS && new Set(foes.map((f) => f.slot)).size === foes.length)
          // Every captain is one piece with the deep's bigger cohort in it.
          const captains = foes.filter((f) => f.count !== undefined)
          assert.equal(captains.length, elite ? sp.captains.elite : sp.captains.fight, `${floor} ${node.id}: captains`)
          assert.ok(captains.every((c) => c.count === 1 + cohort), `${floor} ${node.id}: cohort`)
          assert.ok(foes.every((f) => UNITS[f.id].spawn.minFloor <= F && UNITS[f.id].tier <= tier), `${floor} ${node.id} ${foes.map((f) => f.id)}`)
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
// emptied of foes and to a frail Sovereign alone in its room: the descent is under test here, not the fights on
// the way (whether a run gets there is the final balance pass's business).
function clear (seed) {
  const sp = TUNING.spawn
  const empty = { fight: sp.fight.map(() => 0), elite: sp.elite.map(() => 0), court: 0, bossHp: 0.02, late: { ...sp.late, n: 0 }, waves: { ...sp.waves, siege: 1 } }
  return tuned({ spawn: empty }, () => {
    const run = createRun({ seed })
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
const STEADY = { ...LEVELS.basic, wounds: true }
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
  assert.ok(['map', 'prep', 'reap', 'over'].includes(s.phase), s.phase)
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
  const lost = createRun({ seed: 'deep-lost' })
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
        assert.doesNotThrow(() => apply({ ...run, state: structuredClone(s) }, a), JSON.stringify(a))
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
  // A fall in the deep: the Monarch alone on the field, against a room of the deep. The run is over, the
  // clear stands, the death is recorded, and there is no descending from it.
  const fall = { state: structuredClone(snap), battle: null, setup: null }
  apply(fall, { type: 'descend' })
  const node = fall.state.map.nodes.find((n) => fall.state.map.nodes.find((x) => x.id === fall.state.at).next.includes(n.id) && n.foes)
  if (node) {
    apply(fall, { type: 'node', id: node.id })
    for (const u of fielded(souls(fall.state.party))) apply(fall, { type: 'place', uid: u.uid, slot: -1 })
    apply(fall, { type: 'fight' })
    assert.deepEqual([fall.state.phase, fall.state.result, fall.state.death?.reason], ['over', 'victory', 'monarch'])
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
  Object.assign(TUNING.spawn, { bossHp: 0.02, bossAtk: 0.2, court: 0, foeHp: was[5].map((v) => v * 0.6), foeAtk: was[6].map((v) => v * 0.6) })
  TUNING.spawn.waves.siege = 1
  try {
    const seen = new Set()
    let descended = 0
    let deepest = 1
    for (let i = 0; i < 80 && descended < 2; i++) {
      const seed = 'shallow' + i
      const rng = createRng(seed).stream('fuzz')
      const run = createRun({ seed })
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
