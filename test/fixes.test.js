// The final pass's fixes, each with the case that broke it: the Legion's shadows held to the board, a healer's choice,
// heals that count only whom they can mend, a Monarch that takes no stat it did not buy, the Monarch's seat,
// threat types on every route but Fly, and the autoplayer's room weights and ladder measures.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, playTurns, stats } from '../src/sim/turns.js'
import {
  createRun, apply, battleSetup, monarchOf, drawRoom, varyRoutes, walkWithout, routeThreats, forcedThreats, roomThreats, fielded,
  availableNodes, isRunPath, answerArmy, unanswered, ANSWERS, START_PARTY
} from '../src/sim/run.js'
import { policy, causesOf, armyMeasures } from '../src/sim/autoplay.js'
import { generateFloor } from '../src/sim/map.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { CAMP_LIST, RELICS } from '../src/content.js'
import { makeUnit, slotAt, colOf, baseStats, monarchSlot } from '../src/sim/unit.js'
import { on, scene, unit, turns } from './scene.js'

// A battle of units placed on tiles (scene.js scene).
const pieces = (b) => b.units.filter((u) => u.side === 'party' && u.hp > 0 && u !== b.monarch).length

// ── the battle ───────────────────────────────────────────────────────────────────────────────────

test('the Legion raises only while your side has room: its shadows never stand past the board', () => {
  // Eight undead souls that shoot (Undead 4, the Legion) packed about a Monarch, against four waves of twenty Ghouls
  // whose blows barely scratch, walking the roads into their fire. Unbounded, the risen would fill the board until a
  // later wave found no tile to enter on.
  const cells = [[6, 2], [6, 4], [5, 2], [5, 3], [5, 4], [4, 2], [4, 3], [4, 4]]
  const party = [
    { ...makeUnit('monarch', { uid: 0, lvl: 40 }), slot: slotAt(6, 3) },
    ...cells.map((cell, i) => ({ ...makeUnit(i % 2 ? 'barrow_wight' : 'bone_chanter', { uid: i + 1, lvl: 10 }), slot: slotAt(...cell) }))
  ]
  const wave = (k) => Array.from({ length: 20 }, (_, i) => ({ ...makeUnit('grave_ghoul', { uid: 100 + 20 * k + i, lvl: 1 }), slot: i }))
  const later = [1, 2, 3].flatMap((k) => wave(k).map((f) => ({ ...f, slot: -1, side: 'foe', wave: k, lane: colOf(f.slot) })))
  const b = createBattle({ party, foes: wave(0), reserve: later, foeMods: [{ path: 'atk', op: 'mul', v: 0.05 }] })
  let most = 0
  while (!b.over) {
    playTurns(b, 1)
    most = Math.max(most, pieces(b))
  }
  assert.ok(most <= TUNING.army.board, `${most} pieces on the board`)
  const slain = b.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0).length
  const risen = b.events.filter((e) => e.type === 'arise' && e.rule === 'legion').length
  assert.ok(risen > 0 && risen < slain, `${risen} risen of ${slain} slain: some, not all`)
})

// The heals `uid` casts: those its own actions land, before anything else acts (a Regen it holds ticks for its holder,
// and is no cast).
function castHeals (b, uid) {
  const out = []
  let acting = null
  for (const e of b.events) {
    if (e.type === 'action') acting = e
    else if (acting && e.beat !== acting.beat) acting = null
    if (e.type === 'heal' && e.actor === uid && acting?.actor === uid) out.push(e)
  }
  return out
}
const healsBy = (b, uid) => b.events.filter((e) => e.type === 'heal' && e.actor === uid)
const aimedAt = (b, uid, target) => b.events.filter((e) => e.type === 'action' && e.actor === uid && e.targets.includes(target)).length
const blowsBy = (b, uid) => b.events.filter((e) => e.type === 'action' && e.actor === uid && e.ability === b.byUid.get(uid).basic.id).length

test('a healer left untouched mends the wounded Monarch first', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('hive_warden', 1, 'party', 6, 0, 5), on('tomb_knight', 2, 'party', 0, 0, 5),
    on('iron_golem', 10, 'foe', 3, 10, 3)])
  b.monarch.hp = Math.round(b.monarch.maxHp * 0.4)
  unit(b, 2).hp = Math.round(unit(b, 2).maxHp * 0.8)
  turns(b)
  assert.ok(castHeals(b, 1).some((e) => e.target === 0 && e.heal > 0), 'the wounded Monarch is mended first')
})

// A heal never lifts an ally past its max HP, so one at full HP has nothing to mend; a heal that cleanses tends an ally
// carrying what it strips. Both sides alike.
test('a heal counts only whom it can mend: a Page beside a Golem strikes it, never Purging a Knight at full HP', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('clockwork_page', 1, 'party', 3, 5), on('tomb_knight', 2, 'party', 0, 0),
    on('iron_golem', 10, 'foe', 3, 6)])
  const knight = unit(b, 2)
  playTurns(b, 4)
  assert.equal(aimedAt(b, 1, 2), 0, 'nothing of the Page\'s is aimed at the Knight')
  assert.ok(blowsBy(b, 1) > 0, 'it strikes the Golem')
  assert.equal(knight.hp, knight.maxHp)
  // Nothing in its reach, and the Knight wounded a little and carrying a debuff Purge strips: the Brittle comes off.
  const again = scene([on('monarch', 0, 'party', 3, 0), on('clockwork_page', 1, 'party', 3, 5), on('tomb_knight', 2, 'party', 0, 0),
    on('iron_golem', 10, 'foe', 3, 10)])
  const hurt = unit(again, 2)
  hurt.hp = Math.round(hurt.maxHp * 0.85)
  hurt.statuses.push({ id: 'brittle', dur: 'battle', stacks: 1, by: null })
  turns(again)
  assert.ok(again.events.some((e) => e.type === 'cleanse' && e.target === 2 && e.status === 'brittle'))
})

test('two healers each holding only allies at full HP fight: both strike, and neither mends for nothing', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('hive_warden', 1, 'party', 3, 5), on('tomb_knight', 2, 'party', 0, 0),
    on('hive_warden', 10, 'foe', 3, 6)])
  playTurns(b, 4)
  const blows = (uid) => b.events.filter((e) => e.type === 'damage' && e.actor === uid).length
  assert.ok(blows(1) > 0 && blows(10) > 0, `your Warden ${blows(1)} blows landed, theirs ${blows(10)}`)
  assert.equal(aimedAt(b, 1, 2), 0, 'your Warden aims nothing at the Knight')
  assert.ok(castHeals(b, 1).every((e) => e.heal > 0) && castHeals(b, 10).every((e) => e.heal > 0))
})

test('a heal mends an ally that is hurt, never past its max HP', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('hive_warden', 1, 'party', 6, 0), on('tomb_knight', 2, 'party', 0, 0),
    on('iron_golem', 10, 'foe', 3, 10)])
  const knight = unit(b, 2)
  knight.hp = knight.maxHp - 1
  turns(b)
  const [mend] = healsBy(b, 1)
  assert.ok(mend && mend.target === 2 && mend.heal === 1, JSON.stringify(mend))
  assert.equal(knight.hp, knight.maxHp)
})

test('the Monarch takes no synergy\'s or relic\'s stats (a Legendary\'s neither): its HP in battle is the one the camp shows', () => {
  const units = [on('monarch', 0, 'party', 3, 0, 4), ...[1, 2, 3, 4].map((uid) => on(uid % 2 ? 'tomb_knight' : 'grave_ghoul', uid, 'party', uid, 3)),
    on('iron_golem', 50, 'foe', 3, 10)]
  // Legion's mods on your souls (its Command is the run's: run.js RUN_PATHS).
  const legion = RELICS.legion.mods.filter((m) => !isRunPath(m.path))
  const b = scene(units, { partyMods: [{ path: 'hp', op: 'mul', v: 1.15 }, { path: 'def', op: 'add', v: 20 }, ...legion], relics: ['legion'] })
  const base = baseStats('monarch', 4)
  assert.deepEqual([b.monarch.hp, b.monarch.maxHp], [base.hp, base.hp])
  assert.equal(stats(b, b.monarch).def, base.def, 'no relic DEF')
  // Its souls take them all: the +15%, and Legion's ×0.85.
  assert.equal(unit(b, 1).maxHp, Math.round(baseStats('tomb_knight', 3).hp * 1.15 * 0.85))
  // In the run: with Heartwood held by a soul, the battle's Monarch is the camp's.
  const run = createRun({ start: START_PARTY, seed: 'no-might' })
  const s = run.state
  s.relics = ['heartwood']
  fielded(s.party).find((u) => u.id !== 'monarch').relics = ['heartwood']
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
  const run = createRun({ start: START_PARTY, seed })
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

// A floor of seed `seed` as drawn, before its routes are varied: every battle room's foes fixed.
function floorAt (seed, floor) {
  const map = generateFloor({ seed, floor, boss: floor <= TUNING.run.floors })
  for (const n of map.nodes) if (['fight', 'elite', 'boss', 'siege'].includes(n.type)) Object.assign(n, drawRoom(seed, floor, n))
  return map
}
const flies = (n) => ['fight', 'elite', 'boss', 'siege'].includes(n.type) && roomThreats(n).has('fly')

test('every walk through a floor meets every threat type its foes can bring but Fly', () => {
  const v = TUNING.spawn.variety
  let redrawn = 0
  for (let i = 0; i < 24; i++) {
    for (let floor = 1; floor <= TUNING.run.floors + 2; floor++) {
      const seed = `route${i}`
      const map = floorAt(seed, floor)
      const before = structuredClone(map)
      varyRoutes({ seed, floor, map })
      assert.deepEqual(forcedThreats(floor), routeThreats(floor).filter((t) => t !== 'fly'))
      for (const type of forcedThreats(floor)) assert.equal(walkWithout(map, type), null, `${seed} floor ${floor}: a walk with no ${type}`)
      map.nodes.forEach((n, k) => {
        if (JSON.stringify(n) === JSON.stringify(before.nodes[k])) return
        redrawn++
        // Only rooms from variety.from on, never the boss's, and still as varied as a room must be.
        assert.ok(n.rank >= v.from && n.type !== 'boss', `${seed} floor ${floor} ${n.id}`)
        assert.ok(roomThreats(n).size >= (n.type === 'elite' ? v.elite : v.fight), `${seed} floor ${floor} ${n.id}`)
      })
      // The same seed draws the same floor.
      const again = floorAt(seed, floor)
      varyRoutes({ seed, floor, map: again })
      assert.deepEqual(again, map)
    }
  }
  assert.ok(redrawn > 0, 'some walk needed a room drawn again')
  // A run's floor holds to it as made.
  const run = createRun({ start: START_PARTY, seed: 'route-run' })
  for (const type of forcedThreats(1)) assert.equal(walkWithout(run.state.map, type), null)
})

test('a walk through a floor whose foes fly may meet no flyer: its battle rooms all on the ground, start to end', () => {
  assert.ok(routeThreats(2).includes('fly') && !forcedThreats(2).includes('fly'))
  let walk = null
  let seed = null
  for (let i = 0; i < 400 && !walk; i++) {
    seed = `nofly${i}`
    for (let floor = 2; floor <= TUNING.run.floors && !walk; floor++) {
      const map = floorAt(seed, floor)
      varyRoutes({ seed, floor, map })
      walk = walkWithout(map, 'fly')
      if (!walk) continue
      assert.deepEqual([walk[0].id, walk.at(-1).id], [map.start, map.end])
      assert.ok(walk.every((n) => !flies(n)), `${seed} floor ${floor}`)
      assert.ok(map.nodes.some(flies), `${seed} floor ${floor}: flyers elsewhere on it`)
    }
  }
  assert.ok(walk, 'some walk meets no flyer')
})

test('an elite may still bring Fly to an army with no answer to it (answerArmy), the same on the same seed', () => {
  // Two ground melee souls: no blow reaches a flyer, nor strikes from afar, nor tends.
  const melee = ['tomb_knight', 'grave_ghoul'].map((id, i) => makeUnit(id, { uid: i + 1, lvl: 1 }))
  assert.ok(melee.every((u) => !ANSWERS.fly(u) && !ANSWERS.reach(u)))
  let flown = 0
  for (let i = 0; i < 200 && !flown; i++) {
    const seed = `melee${i}`
    for (const floor of [2, 3]) {
      assert.ok(unanswered(floor, melee).includes('fly'), `floor ${floor}`)
      const map = floorAt(seed, floor)
      varyRoutes({ seed, floor, map })
      const elites = map.nodes.filter((n) => n.type === 'elite')
      if (!elites.length) continue
      // Each elite a lone Tomb Knight (Shape alone), so none brings what the army lacks: one is drawn again.
      for (const n of elites) {
        n.foes = [{ ...n.foes[0], id: 'tomb_knight' }]
        delete n.waves
      }
      const before = structuredClone(map)
      answerArmy({ seed, floor, map, ascension: 0 }, melee)
      const moved = elites.filter((n) => JSON.stringify(n) !== JSON.stringify(before.nodes.find((x) => x.id === n.id)))
      assert.equal(moved.length, 1, `${seed} floor ${floor}`)
      const got = roomThreats(moved[0])
      assert.ok(got.has('shape') && unanswered(floor, melee).some((t) => got.has(t)), `${seed} floor ${floor}: ${[...got]}`)
      if (got.has('fly')) flown++
      const again = structuredClone(before)
      answerArmy({ seed, floor, map: again, ascension: 0 }, melee)
      assert.deepEqual(again, map)
    }
  }
  assert.ok(flown > 0, 'an elite drawn again for the melee army brings Fly')
})

// ── the autoplayer ───────────────────────────────────────────────────────────────────────────────

test('basic\'s weighted draws cover every room type: an altar is a choice like any other, and a missing weight fails loudly', () => {
  assert.throws(() => createRng('w').weighted(['a', 'b'], [1, undefined]), /finite/)
  assert.throws(() => createRng('w').weighted(['a', 'b'], [1, NaN]), /finite/)
  const picks = new Set()
  for (let k = 0; k < 40; k++) {
    const run = createRun({ start: START_PARTY, seed: 'rites' })
    const [altar, ...rest] = availableNodes(run)
    altar.type = 'altar'
    for (const n of rest) n.type = 'fight'
    const rng = createRng(`rites${k}`).stream('autoplay')
    let act
    while ((act = policy(run, rng, 'basic')).type !== 'node') apply(run, act)
    picks.add(act.id === availableNodes(run)[0].id ? 'altar' : 'fight')
  }
  assert.deepEqual([...picks].sort(), ['altar', 'fight'], 'the altar and a fight are each taken, on different rolls')
})

test('the ladder\'s measures: one cause a defeat, the killer\'s threat or a stall, depth no second one; the army\'s actors', () => {
  assert.deepEqual(causesOf(null), [])
  assert.deepEqual(causesOf({ by: null, reason: 'stall', threat: null }), ['stall'])
  assert.deepEqual(causesOf({ by: 'will_o_wisp', reason: 'monarch', threat: 'reach', wave: 2 }), ['reach'])
  // One knight fights the Golem beside it; one never has anything in its reach. Half the army acted.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 5), on('tomb_knight', 2, 'party', 0, 0), on('iron_golem', 50, 'foe', 3, 6, 9)])
  playTurns(b, 2)
  assert.deepEqual(armyMeasures(b), { army: 2, acted: 1 })
})
