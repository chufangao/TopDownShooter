// The final pass's fixes, each with the case that broke it: the escalation ramp held to the ceiling's clock
// (enemy.test.js), and here the rest: the Legion's shadows held to the board, Court of Bone's heal gates, a Monarch
// that takes no stat it did not buy, the Monarch's seat, threat types on every route, and the autoplayer's room
// weights and ladder measures.
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
  makeUnit, tileAt, tileX, tileY, slotAt, colOf, DEPTH, baseStats, sealedBy, monarchSlot
} from '../src/sim/unit.js'

const on = (id, uid, side, x, y, lvl = 3) => ({ ...makeUnit(id, { uid, lvl }), side, tile: tileAt(x, y) })

// A battle of units placed on tiles (the party in its camp, y 0–6; a foe anywhere). The ones not named in
// `moving` never step (all step with `moving: true`).
function scene (units, { moving = [], ...opts } = {}) {
  const foeRow0 = DEPTH - 3
  const spare = [...Array(21).keys()].filter((slot) => !units.some((u) => u.side === 'foe' && tileY(u.tile) >= foeRow0 && slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) === slot))
  const slot = (u) => u.side === 'party' ? slotAt(6 - tileY(u.tile), tileX(u.tile))
    : tileY(u.tile) >= foeRow0 ? slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) : spare.shift()
  const placed = units.map((u) => ({ ...u, slot: slot(u) }))
  const b = createBattle({ party: placed.filter((u) => u.side === 'party'), foes: placed.filter((u) => u.side === 'foe'), seed: 'fixes', ...opts })
  for (const u of b.units) {
    const want = units.find((x) => x.uid === u.uid)?.tile
    if (want === undefined) continue
    if (u.tile !== want) {
      const layer = u.flies ? b.sky : b.at
      layer[u.tile] = null
      u.tile = want
      layer[want] = u
    }
    if (moving !== true && !moving.includes(u.uid)) u.nextStep = Infinity
  }
  return b
}
const unit = (b, uid) => b.units.find((u) => u.uid === uid)
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

test('the Monarch\'s seat seals no one in, on every camp; a new floor seats it on its new camp\'s seat', () => {
  for (const c of CAMP_LIST) assert.equal(sealedBy(c.id, monarchSlot(c.id)).length, 0, c.id)
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
  assert.deepEqual(causesOf({ by: 'mantis_reaper', reason: 'monarch', threat: 'flank', wave: 2 }), ['flank'])
  // One knight fights the Golem beside it all its life; one never has anything in its ring. Half the army acted.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 5), on('tomb_knight', 2, 'party', 0, 0), on('iron_golem', 50, 'foe', 3, 6, 9)])
  runBattle(b)
  assert.deepEqual(armyMeasures(b), { army: 2, acted: 1 })
})
