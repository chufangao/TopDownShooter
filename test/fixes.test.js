// The final pass's fixes, each with the case that broke it: the escalation ramp held to the ceiling's clock
// (enemy.test.js), and here the rest: the Legion's shadows held to the board, Court of Bone's heal gates, heals that
// count only whom they can mend, a Monarch that takes no stat it did not buy, the Monarch's seat, threat types on
// every route, and the autoplayer's room weights and ladder measures.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, stepBattle, runBattle, stats } from '../src/sim/battle.js'
import {
  createRun, apply, battleSetup, monarchOf, drawRoom, varyRoutes, walkWithout, routeThreats, roomThreats, fielded, availableNodes
} from '../src/sim/run.js'
import { policy, causesOf, armyMeasures } from '../src/sim/autoplay.js'
import { generateFloor } from '../src/sim/map.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { CAMP_LIST, RELICS } from '../src/content.js'
import {
  makeUnit, slotAt, colOf, baseStats, monarchSlot, livingBodies
} from '../src/sim/unit.js'
import { on, stackOn, scene as sceneOf, unit } from './scene.js'

// A battle of units placed on tiles (scene.js scene).
const scene = (units, opts) => sceneOf(units, { seed: 'fixes', ...opts })
const bodies = (b) => b.units.filter((u) => u.side === 'party' && u.hp > 0 && u !== b.monarch).length

// ── the battle ───────────────────────────────────────────────────────────────────────────────────

test('the Legion raises only while your side has room: a room of four waves of twenty is won by a wipe, never stalled at the ceiling', () => {
  // Eight undead souls that shoot (Undead 8, the Legion) packed about a Monarch, against four waves of twenty
  // Ghouls whose blows barely scratch, walking the roads into their fire. Unbounded, the risen would fill the board
  // until the last wave found no tile to enter on, and the battle, won but for them, would run to the ceiling.
  const cells = [[6, 2], [6, 4], [5, 2], [5, 3], [5, 4], [4, 2], [4, 3], [4, 4]]
  const party = [
    { ...makeUnit('monarch', { uid: 0, lvl: 40 }), slot: slotAt(6, 3) },
    ...cells.map((cell, i) => ({ ...makeUnit(i % 2 ? 'barrow_wight' : 'bone_chanter', { uid: i + 1, lvl: 10 }), slot: slotAt(...cell) }))
  ]
  const wave = (k) => Array.from({ length: 20 }, (_, i) => ({ ...makeUnit('grave_ghoul', { uid: 100 + 20 * k + i, lvl: 1 }), slot: i }))
  const later = [1, 2, 3].flatMap((k) => wave(k).map((f) => ({ ...f, slot: -1, side: 'foe', wave: k, lane: colOf(f.slot), when: { at: 'break', wave: k, t: TUNING.spawn.waves.t } })))
  const b = createBattle({ party, foes: wave(0), reserve: later, seed: 'legion-bound', domain: 6, foeMods: [{ path: 'atk', op: 'mul', v: 0.05 }] })
  let most = 0
  while (!b.over) {
    stepBattle(b)
    most = Math.max(most, bodies(b))
  }
  assert.deepEqual([b.winner, b.reason], ['party', 'wipe'])
  // Arise's own shadows stand past the board (at most its cap a battle); every other body, the Legion's too, within it.
  assert.ok(most <= TUNING.army.board + b.raised, `${most} bodies on the board (${b.raised} of them Arise's)`)
  const risen = b.events.filter((e) => e.type === 'arise' && e.rule === 'legion').length
  assert.ok(risen > 0 && risen < 80, `${risen} risen of 80 slain: some, not all`)
})

test('Court of Bone: a healer whose only wounded ally is the Monarch strikes instead of casting heals that land for nothing', () => {
  const fight = (relics) => {
    const mon = { ...makeUnit('monarch', { uid: 0, lvl: 2 }), slot: slotAt(6, 3) }
    mon.hp = Math.round(mon.maxHp * 0.4)
    const party = [mon, { ...makeUnit('hive_warden', { uid: 1, lvl: 5 }), slot: slotAt(0, 3) }, { ...makeUnit('tomb_knight', { uid: 2, lvl: 5 }), slot: slotAt(0, 2) }]
    // Ring-1 foes: the warden can strike back at whatever strikes it (a Ghoul's ring 2 would strike from out of its reach).
    const foes = [10, 11].map((uid, i) => ({ ...makeUnit('iron_golem', { uid, lvl: 3 }), slot: slotAt(0, 3 + i) }))
    const b = createBattle({ party, foes, seed: 'cob', relics, domain: 5 })
    runBattle(b)
    return {
      heals: b.events.filter((e) => e.type === 'heal' && e.actor === 1),
      strikes: b.events.filter((e) => e.type === 'action' && e.actor === 1 && e.ability === 'strike').length
    }
  }
  const cob = fight(['court_of_bone'])
  assert.ok(cob.heals.length > 0 && cob.heals.every((e) => e.target !== 0 && e.heal > 0), JSON.stringify(cob.heals.slice(0, 3)))
  assert.ok(cob.strikes > 0, 'it strikes when no one it can mend is wounded')
  // Without the relic the wounded Monarch is mended.
  assert.ok(fight([]).heals.some((e) => e.target === 0 && e.heal > 0))
})

// A heal never lifts a fallen body (DESIGN §2.2), so a stack whose living bodies are whole has nothing to mend, however
// many of its bodies lie fallen (wounds carry: only an altar raises them). A heal's condition and its target count
// only the allies it can mend, or, for one that cleanses, an ally carrying what it strips; both sides alike.
const broken = (b, uid) => {
  const u = unit(b, uid)
  u.hp = u.body
  return u
}
const healsBy = (b, uid) => b.events.filter((e) => e.type === 'heal' && e.actor === uid)
const strikes = (b, uid) => b.events.filter((e) => e.type === 'action' && e.actor === uid && e.ability === 'strike').length
const aimedAt = (b, uid, target) => b.events.filter((e) => e.type === 'action' && e.actor === uid && e.targets.includes(target)).length

test('a heal counts only whom it can mend: a Page beside a Golem strikes it, never Purging a stack whose living body is whole', () => {
  // A Tomb Knight stack of three, two bodies fallen, its one living body whole, far from the fight: it reads 33% HP.
  // Purge (an ally below 90%) once chose it for ever, healed it for 0, and the Page never struck the Golem beside it.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('clockwork_page', 1, 'party', 3, 5), stackOn('tomb_knight', 2, 'party', 0, 0, 3),
    on('iron_golem', 10, 'foe', 3, 6)])
  const knight = broken(b, 2)
  runBattle(b)
  assert.equal(aimedAt(b, 1, 2), 0, 'nothing of the Page\'s is aimed at the Knight')
  assert.ok(healsBy(b, 1).every((e) => e.heal > 0), JSON.stringify(healsBy(b, 1).slice(0, 3)))
  assert.ok(strikes(b, 1) > 0, 'it strikes the Golem')
  assert.deepEqual([livingBodies(knight), knight.hp], [1, knight.body])
  // Carrying a debuff Purge strips, the Knight is the Page's to tend once: the Brittle comes off, and the Page strikes.
  const again = scene([on('monarch', 0, 'party', 3, 0), on('clockwork_page', 1, 'party', 3, 5), stackOn('tomb_knight', 2, 'party', 0, 0, 3),
    on('iron_golem', 10, 'foe', 3, 6)])
  broken(again, 2).statuses.push({ id: 'brittle', dur: 'battle', stacks: 1, age: 0, by: null })
  runBattle(again)
  assert.ok(again.events.some((e) => e.type === 'cleanse' && e.target === 2 && e.status === 'brittle'))
  assert.equal(aimedAt(again, 1, 2), 1, 'once, while the Brittle is on it')
  assert.ok(strikes(again, 1) > 0)
})

test('two healers each holding only a stack of whole living bodies to mend fight: no stall at the ceiling with no blow struck', () => {
  // Your Hive Warden blocks a foe Hive Warden captain of three, two of its bodies fallen; you hold a Knight stack
  // likewise broken. Each once Mended its broken stack for 0 every turn, and the battle ran to the tick ceiling (a
  // run's defeat) with no damage dealt. Now both strike.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('hive_warden', 1, 'party', 3, 5), stackOn('tomb_knight', 2, 'party', 0, 0, 3),
    stackOn('hive_warden', 10, 'foe', 3, 6, 3)], { moving: true })
  broken(b, 2)
  broken(b, 10)
  runBattle(b)
  const blows = (uid) => b.events.filter((e) => e.type === 'damage' && e.actor === uid).length
  assert.ok(blows(1) > 0 && blows(10) > 0, `your Warden ${blows(1)} blows landed, theirs ${blows(10)}`)
  assert.equal(aimedAt(b, 1, 2), 0, 'your Warden aims nothing at the Knight')
  assert.notEqual(b.reason, 'tick-ceiling')
})

test('a heal still mends a stack whose living body is hurt, never past its living bodies', () => {
  // The Knight stack of three, two fallen, its living body at half: Mend (an ally below 50%) heals it, its fallen
  // bodies down still.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('hive_warden', 1, 'party', 6, 0), stackOn('tomb_knight', 2, 'party', 0, 0, 3),
    on('iron_golem', 10, 'foe', 3, 10)])
  const knight = unit(b, 2)
  knight.hp = Math.round(knight.body / 2)
  for (let i = 0; i < 600 && !healsBy(b, 1).length; i++) stepBattle(b)
  const [mend] = healsBy(b, 1)
  assert.ok(mend && mend.target === 2 && mend.heal > 0, JSON.stringify(mend))
  assert.ok(knight.hp > Math.round(knight.body / 2) && knight.hp <= knight.body)
  assert.equal(livingBodies(knight), 1)
})

test('a heal counts only whom it reaches: Swarm Mend waits for a wound within its 2 tiles, and the Warden tends the far one otherwise', () => {
  // A Hive Warden on Brood Mother III (Swarm Mend, every ally within 2 tiles, while an ally is below 60%), a Golem
  // before it, a Ghoul at 30% across the camp. Swarm Mend read the whole board and healed no one within its reach, for 0
  // every cast, all battle; now Purge mends the Ghoul, and the Warden strikes.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('hive_warden', 1, 'party', 6, 5, 3, [3, 0]), on('grave_ghoul', 2, 'party', 0, 0),
    on('iron_golem', 10, 'foe', 6, 6)])
  const ghoul = unit(b, 2)
  ghoul.hp = Math.round(ghoul.maxHp * 0.3)
  runBattle(b)
  assert.ok(healsBy(b, 1).every((e) => e.heal > 0), JSON.stringify(healsBy(b, 1).slice(0, 3)))
  assert.ok(healsBy(b, 1).some((e) => e.target === 2), 'the Ghoul is mended')
  assert.ok(strikes(b, 1) > 0)
})

test('the Monarch takes no synergy\'s or relic\'s stats (a Legendary\'s neither): its HP in battle is the one the camp shows', () => {
  const units = [on('monarch', 0, 'party', 3, 0, 4), ...[1, 2, 3, 4].map((uid) => on(uid % 2 ? 'tomb_knight' : 'grave_ghoul', uid, 'party', uid, 3)),
    on('iron_golem', 50, 'foe', 3, 10)]
  const b = scene(units, { partyMods: [{ path: 'hp', op: 'mul', v: 1.15 }, { path: 'def', op: 'add', v: 20 }, ...RELICS.legion.mods], relics: ['legion'] })
  const base = baseStats('monarch', 4)
  assert.deepEqual([b.monarch.hp, b.monarch.maxHp], [base.hp, base.hp])
  assert.equal(stats(b, b.monarch).def, base.def, 'no Undead 4 DEF, no relic DEF')
  // Its souls take them all: Undead 4 (+5%), the relic (+15%), Legion (×0.85).
  assert.equal(unit(b, 1).maxHp, Math.round(baseStats('tomb_knight', 3).hp * 1.05 * 1.15 * 0.85))
  // In the run: with Heartwood and four undead fielded, the battle's Monarch is the camp's.
  const run = createRun({ seed: 'no-might' })
  const s = run.state
  s.relics = ['heartwood']
  const node = availableNodes(run)[0]
  apply(run, { type: 'node', id: node.id })
  const fight = createBattle(battleSetup(run))
  assert.deepEqual([fight.monarch.hp, fight.monarch.maxHp], [monarchOf(s).hp, monarchOf(s).maxHp])
})

// ── the run ──────────────────────────────────────────────────────────────────────────────────────

test('a new floor seats the Monarch on its new camp\'s seat, and a soul standing there moves off it', () => {
  // A run whose third floor is the Crossroads, a soul standing on the cell that is the Crossroads' seat: the
  // Monarch takes its seat there, and the soul moves off it.
  const seed = [...Array(200).keys()].map((i) => `seat${i}`).find((x) => createRng(x).stream('camp|3').pick(CAMP_LIST.filter((c) => c.floor === 3)).id === 'crossroads')
  const run = createRun({ seed })
  const s = run.state
  const m = monarchOf(s)
  const seat = monarchSlot('crossroads')
  const soul = fielded(s.party).find((u) => u !== m)
  if (m.slot === seat) m.slot = soul.slot
  soul.slot = seat
  Object.assign(s, { floor: 2, at: s.map.end, phase: 'reap', offers: [] })
  apply(run, { type: 'reap', index: null })
  assert.deepEqual([s.floor, s.camp], [3, 'crossroads'])
  assert.equal(m.slot, seat)
  assert.notEqual(soul.slot, seat)
  assert.equal(new Set(fielded(s.party).map((u) => u.slot)).size, fielded(s.party).length)
})

test('every walk through a floor meets every threat type its foes can bring', () => {
  const v = TUNING.spawn.variety
  let redrawn = 0
  for (let i = 0; i < 24; i++) {
    for (let floor = 1; floor <= TUNING.run.floors + 2; floor++) {
      const seed = `route${i}`
      const map = generateFloor({ seed, floor, last: floor === TUNING.run.floors })
      for (const n of map.nodes) if (['fight', 'elite', 'boss', 'siege'].includes(n.type)) Object.assign(n, drawRoom(seed, floor, n))
      const before = structuredClone(map)
      varyRoutes({ seed, floor, map })
      for (const type of routeThreats(floor)) assert.equal(walkWithout(map, type), null, `${seed} floor ${floor}: a walk with no ${type}`)
      map.nodes.forEach((n, k) => {
        if (JSON.stringify(n) === JSON.stringify(before.nodes[k])) return
        redrawn++
        // Only rooms from variety.from on, never the boss's, and still as varied as a room must be.
        assert.ok(n.rank >= v.from && n.type !== 'boss', `${seed} floor ${floor} ${n.id}`)
        assert.ok(roomThreats(n).size >= (n.type === 'elite' ? v.elite : v.fight), `${seed} floor ${floor} ${n.id}`)
      })
      // The same seed draws the same floor.
      const again = generateFloor({ seed, floor, last: floor === TUNING.run.floors })
      for (const n of again.nodes) if (['fight', 'elite', 'boss', 'siege'].includes(n.type)) Object.assign(n, drawRoom(seed, floor, n))
      varyRoutes({ seed, floor, map: again })
      assert.deepEqual(again, map)
    }
  }
  assert.ok(redrawn > 0, 'some walk needed a room drawn again')
  // A run's floor holds to it as made.
  const run = createRun({ seed: 'route-run' })
  for (const type of routeThreats(1)) assert.equal(walkWithout(run.state.map, type), null)
})

// ── the autoplayer ───────────────────────────────────────────────────────────────────────────────

test('the dice weigh every room type: a reliquary is a choice like any other, and a missing weight fails loudly', () => {
  assert.throws(() => createRng('w').weighted(['a', 'b'], [1, undefined]), /finite/)
  assert.throws(() => createRng('w').weighted(['a', 'b'], [1, NaN]), /finite/)
  const picks = new Set()
  for (let k = 0; k < 40; k++) {
    const run = createRun({ seed: 'rites' })
    const [reliquary, ...rest] = availableNodes(run)
    reliquary.type = 'reliquary'
    for (const n of rest) n.type = 'fight'
    const rng = createRng(`rites${k}`).stream('autoplay')
    let act
    while ((act = policy(run, rng, 'basic')).type !== 'node') apply(run, act)
    picks.add(act.id === availableNodes(run)[0].id ? 'reliquary' : 'fight')
  }
  assert.deepEqual([...picks].sort(), ['fight', 'reliquary'], 'the reliquary and a fight are each taken, on different rolls')
})

test('the ladder\'s measures: a ceiling is its own cause, depth no second one; the army\'s actors', () => {
  assert.deepEqual(causesOf(null), [])
  assert.deepEqual(causesOf({ by: null, reason: 'tick-ceiling', threat: 'clock' }), ['ceiling'])
  assert.deepEqual(causesOf({ by: 'will_o_wisp', reason: 'monarch', threat: 'reach', wave: 2 }), ['reach'])
  // One knight fights the Golem beside it all its life; one never has anything in its ring. Half the army acted.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 5), on('tomb_knight', 2, 'party', 0, 0), on('iron_golem', 50, 'foe', 3, 6, 9)])
  runBattle(b)
  assert.deepEqual(armyMeasures(b), { army: 2, acted: 1 })
})
