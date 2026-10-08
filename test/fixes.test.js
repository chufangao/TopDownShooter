// The final pass's fixes, each with the case that broke it: the escalation ramp held to the ceiling's clock
// (enemy.test.js), the Marshal's trailing members (ranks.test.js), and here the rest: the Legion's shadows held
// to the board, Court of Bone's heal gates, a Monarch that takes no stat it did not buy, entries under Vanguard
// Crown, the Monarch's seat, threat types on every route, rehearsals that cannot see the foes' orders, and the
// autoplayer's room weights and ladder measures.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, stepBattle, runBattle, stats } from '../src/sim/battle.js'
import {
  createRun, apply, battleSetup, monarchOf, drawRoom, varyRoutes, walkWithout, routeThreats, roomThreats, fielded, souls,
  availableNodes, domainCentre
} from '../src/sim/run.js'
import { policy, rehearse, causesOf, armyMeasures, edgeRow, guessOrders } from '../src/sim/autoplay.js'
import { generateFloor } from '../src/sim/map.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { CAMP_LIST, UNITS, FOE_ORDERS } from '../src/content.js'
import {
  makeUnit, tileAt, tileX, tileY, slotAt, rowOf, colOf, DEPTH, distance, baseStats, deployTile, seatNear, sealedBy, campOpen, CAMP_ROWS,
  CENTRE_OUT
} from '../src/sim/unit.js'

const on = (id, uid, side, x, y, lvl = 3) => ({ ...makeUnit(id, { uid, lvl }), side, tile: tileAt(x, y) })
const member = (id, uid, captain, lvl = 3) => ({ ...makeUnit(id, { uid, lvl }), cohortOf: captain, rank: true })

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
    const want = units.find((x) => x.uid === u.uid).tile
    if (u.tile !== want) {
      b.at[u.tile] = null
      u.tile = want
      u.anchor = want
      b.at[want] = u
    }
    if (moving !== true && !moving.includes(u.uid)) u.nextStep = Infinity
  }
  return b
}
const unit = (b, uid) => b.units.find((u) => u.uid === uid)
const bodies = (b) => b.units.filter((u) => u.side === 'party' && u.hp > 0 && u !== b.monarch).length

// ── the battle ───────────────────────────────────────────────────────────────────────────────────

test('the Legion raises only while your side has room: a room of four waves of twenty is won by a wipe, never stalled at the ceiling', () => {
  // Eight undead captains (Undead 8, the Legion) and a Monarch, against four waves of twenty frail foes whose
  // blows barely scratch. Unbounded, the risen would fill the board until the last wave found no tile to enter
  // on, and the battle, won but for them, would run to the ceiling.
  const party = [
    { ...makeUnit('monarch', { uid: 0, lvl: 40 }), slot: slotAt(6, 3) },
    ...['tomb_knight', 'grave_ghoul', 'tomb_knight', 'grave_ghoul', 'tomb_knight', 'grave_ghoul', 'tomb_knight', 'grave_ghoul']
      .map((id, i) => ({ ...makeUnit(id, { uid: i + 1, lvl: 10 }), slot: slotAt(i < 7 ? 1 : 2, i % 7) }))
  ]
  const wave = (k) => Array.from({ length: 20 }, (_, i) => ({ ...makeUnit('frost_sprite', { uid: 100 + 20 * k + i, lvl: 1 }), slot: i }))
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
  const fight = (keystones) => {
    const mon = { ...makeUnit('monarch', { uid: 0, lvl: 2 }), slot: slotAt(6, 3) }
    mon.hp = Math.round(mon.maxHp * 0.4)
    const party = [mon, { ...makeUnit('hive_warden', { uid: 1, lvl: 5 }), slot: slotAt(0, 3) }, { ...makeUnit('tomb_knight', { uid: 2, lvl: 5 }), slot: slotAt(0, 2) }]
    const foes = [10, 11].map((uid, i) => ({ ...makeUnit('grave_ghoul', { uid, lvl: 3 }), slot: slotAt(0, 3 + i) }))
    const b = createBattle({ party, foes, seed: 'cob', keystones, domain: 5 })
    runBattle(b)
    return {
      heals: b.events.filter((e) => e.type === 'heal' && e.actor === 1),
      strikes: b.events.filter((e) => e.type === 'action' && e.actor === 1 && e.ability === 'strike').length
    }
  }
  const cob = fight(['court_of_bone'])
  assert.ok(cob.heals.length > 0 && cob.heals.every((e) => e.target !== 0 && e.heal > 0), JSON.stringify(cob.heals.slice(0, 3)))
  assert.ok(cob.strikes > 0, 'it strikes when no one it can mend is wounded')
  // Without the keystone the wounded Monarch is mended.
  assert.ok(fight([]).heals.some((e) => e.target === 0 && e.heal > 0))
})

test('the Monarch takes no synergy\'s, relic\'s or keystone\'s stats: its HP in battle is the one the camp shows', () => {
  const units = [on('monarch', 0, 'party', 3, 0, 4), ...[1, 2, 3, 4].map((uid) => on(uid % 2 ? 'tomb_knight' : 'grave_ghoul', uid, 'party', uid, 3)),
    on('iron_golem', 50, 'foe', 3, 10)]
  const b = scene(units, { partyMods: [{ path: 'hp', op: 'mul', v: 1.15 }, { path: 'def', op: 'add', v: 20 }], keystones: ['legion'] })
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

test('Vanguard Crown: a body enters beside the domain\'s centre, the front-most captain, not beside a Monarch the domain has left', () => {
  const build = (keystones) => scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 5), on('iron_golem', 50, 'foe', 3, 10)],
    { keystones, domain: 2, reserve: [member('grave_ghoul', 2, 1)] })
  const crowned = build(['vanguard_crown'])
  const ev = stepBattle(crowned).find((e) => e.type === 'enter')
  assert.equal(distance(ev.unit.tile, tileAt(3, 5)), 1)
  assert.ok(!unit(crowned, 2).falter && unit(crowned, 2).where === 'hunt')
  // Without it, beside the Monarch, as ever.
  const plain = build([])
  assert.equal(distance(stepBattle(plain).find((e) => e.type === 'enter').unit.tile, tileAt(3, 0)), 1)
})

// ── the run ──────────────────────────────────────────────────────────────────────────────────────

test('the Monarch\'s seat never seals the camp: on every camp, and when a new floor walls its cell', () => {
  for (const c of CAMP_LIST) {
    const seat = seatNear(c.id)
    assert.ok(campOpen(c.id, seat) && sealedBy(c.id, seat).length === 0, c.id)
    // The rear row's middle lane, but in Spiral, whose whole rear row is the way round to its heart.
    if (c.id !== 'spiral') assert.equal(seat, slotAt(CAMP_ROWS - 1, CENTRE_OUT[0]), c.id)
  }
  // Funnel's and Switchback's gaps are the cells its role's row would take (row 3, the middle lane first).
  assert.ok(sealedBy('funnel', slotAt(3, 3)).length > 0 && sealedBy('switchback', slotAt(3, 6)).length > 0)
  // A run whose third floor is Funnel, its Monarch standing where Funnel has a wall: it is seated again where
  // it seals nothing, not in the gap.
  const seed = [...Array(200).keys()].map((i) => `seat${i}`).find((x) => createRng(x).stream('camp|3').pick(CAMP_LIST.filter((c) => c.floor === 3)).id === 'funnel')
  const run = createRun({ seed })
  const s = run.state
  const m = monarchOf(s)
  const wall = slotAt(3, 2)
  apply(run, { type: 'place', uid: m.uid, slot: wall })
  Object.assign(s, { floor: 2, at: s.map.end, phase: 'reap', offers: [] })
  apply(run, { type: 'reap', index: null })
  assert.deepEqual([s.floor, s.camp], [3, 'funnel'])
  assert.ok(m.slot !== wall && campOpen('funnel', m.slot) && sealedBy('funnel', m.slot).length === 0, `seated at ${rowOf(m.slot)},${colOf(m.slot)}`)
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

test('rehearsals fight the room as a player knows it: an elite captain\'s order, never shown, changes nothing', () => {
  const run = createRun({ seed: 'scout' })
  const s = run.state
  // Floor 2's elite, walked into: captains with orders.
  const node = availableNodes(run)[0]
  node.type = 'elite'
  Object.assign(node, drawRoom(s.seed, 2, { ...node, rank: 9 }))
  apply(run, { type: 'node', id: node.id })
  const ordered = node.foes.filter((f) => f.order)
  assert.ok(ordered.length > 0, 'its captains carry orders')
  assert.ok(battleSetup(run).foes.some((f) => f.plan), 'the real fight follows them')
  assert.ok(!battleSetup(run, { scout: true }).foes.some((f) => f.plan) && !battleSetup(run, { scout: true }).reserve.some((f) => f.side === 'foe' && f.plan))
  // Whatever order they were given, the rehearsal is the same.
  const party = fielded(s.party)
  const scores = ['stay', 'hunt', 'flank'].map((order) => {
    for (const f of ordered) Object.assign(f, { order, square: order === 'flank' ? tileAt(0, CAMP_ROWS) : undefined })
    return rehearse(run, party, 1)
  })
  assert.equal(new Set(scores).size, 1, JSON.stringify(scores))
  // What it rehearses instead: orders guessed from each captain's kind (its foeOrders), the cohort with its
  // captain, one guess per rehearsal seed, so over a few seeds every order a kind may be given turns up.
  const setup = battleSetup(run, { scout: true })
  const foes = [...setup.foes, ...setup.reserve.filter((u) => u.side === 'foe')]
  const captains = foes.filter((u) => foes.some((m) => m.cohortOf === u.uid))
  const seen = new Set()
  for (let k = 0; k < 24; k++) {
    const g = guessOrders(setup, `guess${k}`)
    const all = [...g.foes, ...g.reserve.filter((u) => u.side === 'foe')]
    assert.deepEqual(g, guessOrders(setup, `guess${k}`), 'a guess is the seed\'s')
    for (const c of captains) {
      const plan = all.find((u) => u.uid === c.uid).plan
      assert.ok(UNITS[c.id].foeOrders.some((o) => FOE_ORDERS[o].where === plan.where), `${c.id}: ${plan.where}`)
      assert.equal(plan.square !== null, plan.where === 'move')
      for (const m of all.filter((u) => u.cohortOf === c.uid)) assert.deepEqual(m.plan, plan, 'its cohort goes with it')
      seen.add(`${c.id}:${plan.where}`)
    }
    assert.ok(all.filter((u) => u.plan).every((u) => captains.some((c) => c.uid === u.uid || c.uid === u.cohortOf)), 'no one else')
  }
  const wanted = captains.flatMap((c) => UNITS[c.id].foeOrders.map((o) => `${c.id}:${FOE_ORDERS[o].where}`))
  assert.deepEqual([...seen].sort(), [...new Set(wanted)].sort())
})

test('the dice weigh every room type: a rite is a choice like any other, and a missing weight fails loudly', () => {
  assert.throws(() => createRng('w').weighted(['a', 'b'], [1, undefined]), /finite/)
  assert.throws(() => createRng('w').weighted(['a', 'b'], [1, NaN]), /finite/)
  const picks = new Set()
  for (let k = 0; k < 40; k++) {
    const run = createRun({ seed: 'rites' })
    const [rite, ...rest] = availableNodes(run)
    rite.type = 'rite'
    for (const n of rest) n.type = 'fight'
    const rng = createRng(`rites${k}`).stream('autoplay')
    let act
    while ((act = policy(run, rng, 'basic')).type !== 'node') apply(run, act)
    picks.add(act.id === availableNodes(run)[0].id ? 'rite' : 'fight')
  }
  assert.deepEqual([...picks].sort(), ['fight', 'rite'], 'the rite and a fight are each taken, on different rolls')
})

test('the ladder\'s measures: a ceiling is its own cause, depth no second one; the army\'s actors and its time faltering', () => {
  assert.deepEqual(causesOf(null), [])
  assert.deepEqual(causesOf({ by: null, reason: 'tick-ceiling', threat: 'clock' }), ['ceiling'])
  assert.deepEqual(causesOf({ by: 'mantis_reaper', reason: 'monarch', threat: 'flank', wave: 2 }), ['flank'])
  // One knight outside the domain fights the Golem beside it all its life; one inside never has anything in
  // reach. Half the army acted; the time faltering is the first knight's whole life over both lives.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 5), on('tomb_knight', 2, 'party', 0, 0), on('iron_golem', 50, 'foe', 3, 6, 9)])
  runBattle(b)
  const m = armyMeasures(b)
  const life = b.events.find((e) => e.type === 'death' && e.target === 1)?.t ?? b.t
  assert.deepEqual([m.army, m.acted], [2, 1])
  assert.ok(Math.abs(m.falter - life / (life + b.t)) < 1e-9, `${m.falter} vs ${life / (life + b.t)}`)
})

test('the expert\'s order menu measures the domain\'s edge from its centre: under Vanguard Crown, the front-most captain', () => {
  const run = createRun({ seed: 'edge' })
  const s = run.state
  const party = fielded(s.party).map((u) => ({ ...u }))
  const caps = souls(party)
  caps[0].slot = slotAt(1, 3)
  caps[1].slot = slotAt(4, 2)
  caps[2].slot = slotAt(4, 4)
  const plain = edgeRow(s, party)
  assert.equal(plain, CAMP_ROWS - 1 - Math.min(CAMP_ROWS - 1, tileY(deployTile('party', monarchOf(s).slot)) + 3))
  s.keystones = ['vanguard_crown']
  const crowned = edgeRow(s, party)
  assert.equal(domainCentre({ ...s, party }), caps[0].slot)
  assert.equal(crowned, CAMP_ROWS - 1 - Math.min(CAMP_ROWS - 1, tileY(deployTile('party', caps[0].slot)) + 2))
  assert.ok(crowned < plain, 'further forward than from the Monarch')
})
