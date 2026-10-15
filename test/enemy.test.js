// The enemy as an army (slice 5): late pairs, foe captains with cohorts, behaviours hinted in flavour, waves,
// sieges, the Sovereign's court and its Grave Tide, the depth threat.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, order, playOut, perform, corpses, impatience, entryTurn, fork, addStatus } from '../src/sim/turns.js'
import {
  createRun, apply, availableNodes, legalActions, battleSetup, drawRoom, encounter, roomThreats, foeLevel, foeMods, foeEssence,
  essenceByWave, MONARCH_UID, currentNode, START_PARTY, bossFor, courtPool, captainPool, targetTier
} from '../src/sim/run.js'
import { generateFloor, RANKS, SIEGE_RANK } from '../src/sim/map.js'
import { policy, LEVELS } from '../src/sim/autoplay.js'
import { foeTurn } from '../src/sim/policy.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { UNITS, ABILITIES, THREATS, BEHAVIOURS, unitDef } from '../src/content.js'
import { makeUnit, tileAt, slotAt, colOf, statsOf, baseStats, alive, DEPTH, CENTRE_OUT } from '../src/sim/unit.js'
import { sturdy, grant } from './tuned.js'
import { on, scene, slay, unit, turns } from './scene.js'
import { fight } from './rooms.js'

const sp = TUNING.spawn
const W = sp.waves
const at = (list, floor) => list[Math.min(floor, list.length) - 1]

// A battle of units placed on tiles (scene.js scene).
// A foe still to come: off the board, in its wave (entering at the end of its turn: turns.js entryTurn), in `lane`.
const coming = (id, uid, wave, lane = 3, extra = {}) => ({ ...makeUnit(id, { uid, lvl: 1 }), side: 'foe', wave, lane, ...extra })
// The battle a run's log rebuilds: its setup, and the orders given in it (every action logged after its `fight`).
function rebuilt (run) {
  const log = run.state.log
  const from = log.findLastIndex((a) => a.type === 'fight')
  const b = createBattle(structuredClone(run.setup))
  for (const o of log.slice(from + 1)) if (!b.over) order(b, o)
  return b
}
// A run's souls at level 10 and a Monarch that takes a while to fell (the HP `monarch` points once gave: tuned.js
// sturdy), so a battle runs its course (the state edited outside the log: not a replay).
function strong (run, monarch = 40) {
  for (const u of run.state.party) {
    if (u.id === 'monarch') {
      const { hp, maxHp } = sturdy({ ...u, lvl: monarch })
      Object.assign(u, { hp, maxHp })
      continue
    }
    u.lvl = 10
    u.hp = u.maxHp = baseStats(u.id, 10).hp
  }
}

// ── content ──────────────────────────────────────────────────────────────────────────────────────

test('every foe kind comes by Walk or Fly, hinted only in its flavour; depth is a room\'s threat', () => {
  for (const u of Object.values(UNITS)) {
    // The Monarch is never a foe, nor is a fused kind: no behaviour to learn.
    if (u.monarch || u.fused) {
      assert.equal(u.behaviour, undefined, u.id)
      continue
    }
    assert.ok(BEHAVIOURS[u.behaviour], `${u.id} behaviour`)
    assert.ok(typeof u.flavour === 'string' && u.flavour.length > 20, `${u.id} flavour`)
    // Flavour hints; it never names the behaviour it hints at.
    assert.doesNotMatch(u.flavour, /\b(flank(s|ing)?|fl(y|ies|ying|ight)|stays?|hunts?|orders?)\b/i, u.id)
  }
  // Two ways: every kind Walks but the flyers, first met on floors 2 and 3, and a floor's boss (redesign.md §4.7) and its
  // brood.
  assert.deepEqual(Object.keys(BEHAVIOURS), ['walk', 'fly'])
  const flyers = Object.values(UNITS).filter((u) => u.behaviour === 'fly' && u.spawn).map((u) => [u.id, u.spawn.minFloor]).sort()
  assert.deepEqual(flyers, [['ash_wyvern', 3], ['hive_drone', 2]])
  assert.deepEqual(Object.values(UNITS).filter((u) => u.behaviour === 'fly' && !u.spawn).map((u) => [u.id, u.boss]), [['swarm_queen', true]])
  assert.ok(THREATS.depth.name && THREATS.depth.desc)
  assert.deepEqual(ABILITIES.grave_tide.effects.at(-1), { op: 'raise', count: 2 })
})

// ── the map ──────────────────────────────────────────────────────────────────────────────────────

test('sieges: from floor 3, one or two of the late ranks\' fights, never two in a rank; none before', () => {
  let seen = 0
  for (let i = 0; i < 400; i++) {
    const floor = 1 + (i % 4)
    const map = generateFloor({ seed: 'siege' + i, floor, boss: floor <= TUNING.run.floors })
    const sieges = map.nodes.filter((n) => n.type === 'siege')
    if (floor < W.floor) {
      assert.equal(sieges.length, 0, `seed ${i} floor ${floor}`)
      continue
    }
    assert.ok(sieges.length >= 1 && sieges.length <= 2, `seed ${i} floor ${floor}: ${sieges.length} sieges`)
    assert.ok(sieges.every((n) => n.rank >= SIEGE_RANK && n.rank <= RANKS - 2), `seed ${i}: ${sieges.map((n) => n.id)}`)
    assert.equal(new Set(sieges.map((n) => n.rank)).size, sieges.length, `seed ${i}: two in a rank`)
    seen += sieges.length
  }
  assert.ok(seen > 200)
})

// ── the rooms ────────────────────────────────────────────────────────────────────────────────────

const groups = (room) => [room.foes, ...(room.waves ?? []).map((w) => w.foes)]

test('rooms: floor-1 elites bring a late pair; captains with cohorts from floor 2, each of the cohort a foe of its own; waves from floor 3; a floor\'s boss with its court, the last room ends in the Sovereign\'s', () => {
  const count = {}
  const pairTiers = []
  const captainTiers = []
  for (let i = 0; i < 30; i++) {
    for (let floor = 1; floor <= TUNING.run.floors; floor++) {
      const seed = 'room' + i
      const map = generateFloor({ seed, floor, boss: true })
      for (const node of map.nodes.filter((n) => ['fight', 'elite', 'siege', 'boss'].includes(n.type))) {
        const where = `${seed} floor ${floor} ${node.id} ${node.type}`
        const room = drawRoom(seed, floor, node)
        assert.deepEqual(room.foes, encounter(seed, floor, node), where)
        const elite = node.type === 'elite'
        const boss = node.type === 'boss'
        const lvl = foeLevel(floor, node.rank) + (elite ? sp.eliteLevel : 0)
        const waves = node.type === 'siege' || (boss && floor >= W.floor) ? W.siege : boss ? 1
          : floor === 1 ? (elite ? 2 : 1)
          : floor < W.floor ? 1 : elite ? W.elite : node.rank >= W.fightRank ? W.fight : 1
        assert.equal(groups(room).length, waves, where)
        assert.equal(!!room.waves, waves > 1, `${where}: waves only when there are some`)
        assert.equal(roomThreats(room).has('depth'), waves > 1, `${where}: depth`)
        count[`${floor}${node.type}${waves}`] = (count[`${floor}${node.type}${waves}`] ?? 0) + 1
        for (const [k, g] of groups(room).entries()) {
          const w = `${where} wave ${k}`
          assert.equal(new Set(g.map((f) => f.slot)).size, g.length, `${w}: slots`)
          assert.ok(g.every((f) => Number.isInteger(f.slot) && f.slot >= 0 && f.slot < 21 && f.lvl === lvl), w)
          if (k) assert.deepEqual(Object.keys(room.waves[k - 1]), ['foes'], `${w}: a wave enters on its turn, and waits for nothing`)
          // One foe a piece: none carries a count, and none is marked as another's cohort.
          assert.ok(!g.some((f) => 'count' in f || 'cohortOf' in f), w)
          if (boss && k === waves - 1) {
            // Its boss (the seed's, with no army: run.js bossFor) at the centre of the front row, or behind it with its
            // court before it; its court about it, of its kinds (the Sovereign's undead).
            const id = bossFor(seed, floor).id
            assert.deepEqual(g[0], { id, lvl, slot: slotAt(unitDef(id).court.front ? 1 : 0, CENTRE_OUT[0]) }, w)
            assert.equal(g.length, 1 + at(sp.court, floor), w)
            assert.equal(id === 'hollow_sovereign', floor === TUNING.run.floors, w)
            assert.ok(g.slice(1).every((m) => courtPool(floor, unitDef(id).court).units.some((u) => u.id === m.id) && !unitDef(m.id).boss && m.count === undefined), w)
            if (id === 'hollow_sovereign') assert.ok(g.slice(1).every((m) => unitDef(m.id).kin === 'undead'), w)
            continue
          }
          assert.ok(!g.some((f) => unitDef(f.id).boss), w)
          if (floor === 1) {
            // No captains on floor 1: the formation is the foes drawn, no more.
            assert.equal(g.length, k ? sp.late.n : at(elite ? sp.elite : sp.fight, floor), w)
            // The late pair comes from the floor's own pool: within its tier cap, and weighted to its tier.
            if (k) {
              const cap = Math.min(sp.tierMax, 1 + Math.floor((floor - 1) * sp.tierPerFloor)) + sp.tierOverCap
              assert.ok(g.every((f) => UNITS[f.id].spawn.minFloor <= floor && UNITS[f.id].tier <= cap), w)
              pairTiers.push(...g.map((f) => UNITS[f.id].tier))
            }
            continue
          }
          // The foes drawn, then each captain's cohort after them (the formation has room for every one of them here:
          // none is dropped): an elite's (and the waves before a boss's) of the captain's kind; a fight's, since the
          // user's rule of 2026-10-16, of the wave's other kinds, its captain drawn first, a tier or more over the
          // floor's target and of its minimum at least (captainPool: floor 2's a keystone of tier 3).
          const cohort = at(sp.cohort, floor)
          const captains = elite ? sp.captains.elite : sp.captains.fight
          const drawn = at(elite ? sp.elite : sp.fight, floor)
          assert.equal(g.length, drawn + captains * cohort, w)
          const led = !elite && !boss
          if (led) {
            const least = Math.max(targetTier(floor) + sp.captains.above, at(sp.captains.minTier, floor))
            assert.ok(g.slice(0, captains).every((f) => captainPool(floor).units.some((u) => u.id === f.id) && UNITS[f.id].tier >= least), `${w}: its captain a tier up`)
            captainTiers.push(...g.slice(0, captains).map((f) => `${floor}:${UNITS[f.id].tier}`))
          }
          for (let c = 0; c < captains; c++) {
            const band = g.slice(drawn + c * cohort, drawn + (c + 1) * cohort)
            if (led) assert.ok(band.every((f) => g.slice(captains, drawn).some((x) => x.id === f.id)), `${w}: cohort ${c} of the wave's own kinds`)
            else assert.ok(band.every((f) => f.id === band[0].id) && g.slice(0, drawn).some((f) => f.id === band[0].id), `${w}: cohort ${c} of a captain's kind`)
          }
          assert.ok(!g.some((f) => 'order' in f || 'square' in f), `${w}: no foe carries orders`)
        }
      }
    }
  }
  // Every kind of room was drawn.
  const F = TUNING.run.floors
  for (const key of ['1fight1', '1elite2', '1boss1', '2fight1', '2elite1', '2boss1', '3fight1', '3fight2', '3elite2', '3siege3', `${F}siege3`, `${F}boss3`]) assert.ok(count[key] > 0, `${key}: ${JSON.stringify(count)}`)
  // The floor's pool, not the elite's: floor 1's weights favour tier 1 (the elite pool's, tier 2).
  assert.ok(pairTiers.filter((t) => t === 1).length > 0.7 * pairTiers.length, `late pair tiers: ${pairTiers}`)
  // A fight's captains: a keystone of tier 3 on floor 2 (never a tier 2, one above its target), tier 3 and 4 on floor 3.
  assert.deepEqual([...new Set(captainTiers)].sort(), ['2:3', '3:3', '3:4'], `captain tiers: ${captainTiers}`)
  assert.deepEqual(captainPool(2).units.map((u) => u.id).sort(), ['ember_drake', 'iron_golem', 'mantis_reaper'])
})

// ── the battle: foes as an army ──────────────────────────────────────────────────────────────────

test('a run\'s room becomes battle units: foes take the first uids, formation then waves; a captain\'s cohort are foes of their own; waves wait in the reserve', () => {
  const run = createRun({ start: START_PARTY, seed: 'army5' })
  const s = run.state
  const node = availableNodes(run)[0]
  // A floor-3 elite here: captains, cohorts, a second wave.
  const room = drawRoom('army5', 3, { ...node, type: 'elite', rank: 9 })
  Object.assign(node, { type: 'elite' }, room)
  for (const f of groups(node).flat()) f.lvl = 1
  apply(run, { type: 'node', id: node.id })
  const setup = battleSetup(run)
  const first = s.nextUid
  const all = groups(node)
  const total = all.flat().length
  assert.deepEqual(setup.foes.map((f) => [f.uid, f.id, f.slot]), node.foes.map((f, i) => [first + i, f.id, f.slot]))
  const waiting = setup.reserve
  assert.ok(waiting.every((f) => f.side === 'foe'), 'the reserve is the foes still to come')
  assert.deepEqual(waiting.map((f) => [f.uid, f.id, f.slot, f.wave, f.lane]), node.waves[0].foes.map((f, i) => [first + node.foes.length + i, f.id, -1, 1, colOf(f.slot)]))
  assert.ok(waiting.every((f) => !('when' in f)))
  assert.equal(setup.nextUid, first + total, 'shadows after every foe')
  // Cohorts, wave by wave: every foe one body of its kind at its level; no foe carries a count or a plan.
  for (const [k, g] of all.entries()) {
    const units = k ? waiting : setup.foes
    for (const [i, f] of g.entries()) {
      const u = units[i]
      assert.deepEqual([u.count, u.maxHp], [undefined, baseStats(f.id, f.lvl).hp], `${k} ${f.id} ${f.slot}`)
    }
  }
  // The elite's captains brought their cohorts as foes of their own.
  assert.equal(setup.foes.length, at(sp.elite, 3) + sp.captains.elite * at(sp.cohort, 3))
  // The battle plays it: the second wave announced and entering, and the run moves past every uid it made. (A
  // Monarch that outlasts the wave: twelve level-1 foes with their Drake 6 and Ranger 6 steps outfight three
  // level-10 souls, so the wave would otherwise come to a battle already lost.)
  strong(run, 400)
  apply(run, { type: 'fight' })
  const b = run.battle
  while (s.phase === 'battle' && b.reserve.length) apply(run, { type: 'end' })
  assert.deepEqual(b.events.filter((e) => e.type === 'wave').map((e) => e.wave), [1])
  const foesIn = b.events.filter((e) => e.type === 'enter' && e.unit.side === 'foe').map((e) => e.unit.uid)
  assert.deepEqual(foesIn, waiting.map((f) => f.uid).slice(0, foesIn.length), 'the wave entered, in order')
  while (s.phase === 'battle') apply(run, { type: 'end' })
  assert.ok(b.units.filter((u) => u.wave === 1).every((u) => u.side === 'foe'))
  const uids = b.units.map((u) => u.uid)
  assert.equal(new Set(uids).size, uids.length, 'every uid once')
  assert.ok(uids.every((uid) => uid < s.nextUid) && s.nextUid === b.nextUid)
})

test('a later wave enters at the top edge at the end of its turn, each foe in its lane, the wave announced once', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 0, 9), on('grave_ghoul', 10, 'foe', 3, 10, 1)], {
    reserve: [coming('frost_sprite', 70, 1, 1), coming('will_o_wisp', 71, 1, 5)]
  })
  assert.deepEqual(b.events[0].reserve.map((r) => [r.uid, r.wave, r.side]), [[70, 1, 'foe'], [71, 1, 'foe']], 'announced as foes still to come, in their wave')
  const due = entryTurn({ wave: 1 })
  assert.equal(due, 1 + W.every)
  while (b.turn < due - 1) assert.ok(!turns(b).some((e) => e.type === 'enter' || e.type === 'wave'), 'nothing before its turn')
  const came = turns(b).filter((e) => ['wave', 'enter'].includes(e.type))
  assert.deepEqual(came.map((e) => [e.type, e.unit?.uid ?? e.wave]), [['wave', 1], ['enter', 70], ['enter', 71]])
  assert.deepEqual(came.slice(1).map((e) => e.unit.tile), [tileAt(1, DEPTH - 1), tileAt(5, DEPTH - 1)], 'at the top edge, in its lane')
  assert.deepEqual([came[1].unit.wave, came[1].unit.maxHp], [1, unit(b, 70).maxHp], 'one body')
  assert.equal(b.foeIn, due)
})

test('waves come on fixed turns, whatever the field: wave k at turn 1 + k × every; and foes still to come keep a battle going', () => {
  const make = () => scene([on('monarch', 0, 'party', 3, 0, 100), on('grave_ghoul', 10, 'foe', 0, 10, 1), on('grave_ghoul', 11, 'foe', 3, 10, 1), on('grave_ghoul', 12, 'foe', 6, 10, 1)], {
    reserve: [coming('tomb_knight', 20, 1, 2), coming('tomb_knight', 21, 1, 4), coming('iron_golem', 30, 2, 3)]
  })
  const b = make()
  assert.deepEqual(b.waves.map((w) => [w.wave, w.turn, w.foes]), [[1, 1 + W.every, 2], [2, 1 + 2 * W.every, 1]])
  const seen = []
  while (!b.over && b.turn <= 1 + 2 * W.every) seen.push(...turns(b).filter((e) => e.type === 'enter').map((e) => [b.turn, e.unit.uid]))
  assert.deepEqual(seen, [[1 + W.every, 20], [1 + W.every, 21], [1 + 2 * W.every, 30]])
  // The camp's patience counts from the last wave's turn (no clock).
  assert.deepEqual([b.foeIn, impatience(b)], [1 + 2 * W.every, (b.turn - b.foeIn) / TUNING.policy.press.turns])
  const empty = make()
  for (const uid of [10, 11, 12]) slay(empty, unit(empty, uid))
  turns(empty)
  assert.ok(!empty.over)
})

test('the Sovereign\'s Grave Tide raises two of the field\'s dead on its side: the strongest, then the nearest; Arise\'s cap is untouched', () => {
  // A Tomb Knight of yours stands before it; the dead lie about: your Tomb Knight (tier 2), a foe Ghoul two
  // tiles off and a foe Page three off (tier 1), and a fallen foe shadow (never raised again). Never raised
  // either: a fallen boss (tier 5), and a foe Golem (tier 3) with a Ghoul of yours standing on its corpse.
  const b = scene([
    on('tomb_knight', 1, 'party', 3, 6, 9), on('tomb_knight', 2, 'party', 5, 5, 1), on('grave_ghoul', 3, 'party', 4, 4, 9),
    on('hollow_sovereign', 50, 'foe', 3, 7, 1), on('grave_ghoul', 51, 'foe', 2, 9, 1), on('clockwork_page', 52, 'foe', 6, 10, 1),
    { ...on('bone_chanter', 53, 'foe', 0, 9, 1), shadow: true }, on('iron_golem', 54, 'foe', 4, 8, 1), on('hollow_sovereign', 55, 'foe', 1, 10, 1)
  ], { nextUid: 200 })
  for (const uid of [2, 51, 52, 53, 54, 55]) slay(b, unit(b, uid))
  const g = unit(b, 3)
  b.at[g.tile] = null
  g.tile = unit(b, 54).tile
  b.at[g.tile] = g
  const sov = unit(b, 50)
  sov.hp = Math.floor(sov.maxHp / 2)
  const tide = sov.kit.find((a) => a.id === 'grave_tide')
  const cast = () => {
    const from = b.events.length
    b.stage = 'foes'
    sov.cooldowns = {}
    perform(b, sov, tide, unit(b, 1))
    return b.events.slice(from)
  }
  const ev = cast()
  assert.ok(ev.some((e) => e.type === 'action' && e.actor === 50 && e.ability === 'grave_tide'), 'it cast Grave Tide')
  const risen = ev.filter((e) => e.type === 'arise')
  assert.deepEqual(risen.map((e) => [e.actor, e.corpse, e.unit.uid, e.unit.side, e.unit.shadow, e.unit.tile]),
    [[50, 2, 200, 'foe', true, tileAt(5, 5)], [50, 51, 201, 'foe', true, tileAt(2, 9)]])
  for (const e of risen) {
    const u = unit(b, e.unit.uid)
    assert.ok(alive(u) && u.shadow && u.side === 'foe')
    assert.deepEqual([u.hp, u.maxHp], [baseStats(u.id, u.lvl).hp, baseStats(u.id, u.lvl).hp], 'whole')
  }
  assert.equal(b.raised, 0, 'Arise\'s count is its holders\' alone')
  assert.ok(unit(b, 2).raised && unit(b, 51).raised && !unit(b, 52).raised && !unit(b, 53).raised)
  assert.equal(b.nextUid, 202)
  // A second cast raises the one corpse left that may rise, the Page: never the raised again, the boss, the
  // shadow or the trodden Golem.
  const again = cast().filter((e) => e.type === 'arise')
  assert.deepEqual(again.map((e) => [e.actor, e.corpse, e.unit.uid, e.unit.tile]), [[50, 52, 202, tileAt(6, 10)]])
  assert.equal(b.nextUid, 203)
  assert.ok(!unit(b, 53).raised && !unit(b, 54).raised && !unit(b, 55).raised)
})

test('the Sovereign\'s override casts Grave Tide as the foes\' turn begins, every third turn; a Hexed Sovereign loses that act as any foe does', () => {
  const tideTurn = (hex) => {
    const b = scene([on('tomb_knight', 1, 'party', 3, 6, 9), on('hollow_sovereign', 50, 'foe', 3, 7, 1)])
    const sov = unit(b, 50)
    sov.hp = Math.floor(sov.maxHp / 2)
    b.turn = 3
    if (hex) addStatus(b, sov, 'hexed', 1)
    const ev = order(b, { type: 'end' })
    return { cast: ev.some((e) => e.type === 'action' && e.actor === 50 && !e.counter), lost: ev.some((e) => e.type === 'hexed' && e.target === 50) }
  }
  assert.deepEqual(tideTurn(false), { cast: true, lost: false }, 'its Tide turn')
  assert.deepEqual(tideTurn(true), { cast: false, lost: true }, 'Hexed: no Tide, no act')
})

// The user's rule of 2026-10-16 (redesign.md §7): the Pale Court's Hex every turn held the Sovereign to 0–1 acts a
// battle (§8). A boss whose act a Hex took shrugs off every Hex until its turn comes unHexed; any other foe does not.
test('a boss is never Hexed twice in a row: one that lost its act to a Hex shrugs off every Hex until it has acted again', () => {
  const hexed = (u) => u.statuses.find((s) => s.id === 'hexed')
  for (const id of ['hollow_sovereign', 'mire_mother']) {
    const b = scene([on('tomb_knight', 1, 'party', 3, 6, 9), on(id, 50, 'foe', 3, 7, 1), on('grave_ghoul', 51, 'foe', 1, 7, 1)])
    const boss = unit(b, 50)
    const ghoul = unit(b, 51)
    const rows = []
    for (let turn = 0; turn < 3; turn++) {
      const from = b.events.length
      addStatus(b, boss, 'hexed', 1, unit(b, 1))
      addStatus(b, ghoul, 'hexed', 1, unit(b, 1))
      const shrugged = b.events.slice(from).some((e) => e.type === 'shrug' && e.target === 50)
      const held = !!hexed(boss)
      const ev = order(b, { type: 'end' })
      rows.push([held, shrugged, ev.some((e) => e.type === 'hexed' && e.target === 50), ev.some((e) => e.type === 'hexed' && e.target === 51)])
    }
    // [held, shrugged, its act lost, the ghoul's act lost]
    assert.deepEqual(rows, [[true, false, true, true], [false, true, false, true], [true, false, true, true]], id)
  }
  // Whenever it is laid and by whom: after the act it lost, later in the foes' turn and at the turn's end, by your side or
  // its own, none takes hold (nor renews the one it holds); once its turn has come unHexed, the next lands, one laid in
  // that turn after it acts (a counter's) fresh, costing the act after.
  const b = scene([on('tomb_knight', 1, 'party', 3, 6, 9), on('mire_mother', 50, 'foe', 3, 7, 1), on('grave_ghoul', 51, 'foe', 1, 7, 1)])
  const boss = unit(b, 50)
  addStatus(b, boss, 'hexed', 1)
  b.stage = 'foes'
  foeTurn(b)
  assert.ok(boss.shrugs && hexed(boss) && !hexed(boss).fresh, 'its act lost')
  for (const [stage, by] of [['foes', 1], ['foes', 51], ['end', 1]]) {
    b.stage = stage
    const from = b.events.length
    addStatus(b, boss, 'hexed', 1, unit(b, by))
    assert.equal(hexed(boss).fresh, false, `${stage}, by ${by}: the Hex it holds not renewed`)
    assert.deepEqual(b.events.slice(from).map((e) => e.type), ['shrug'])
  }
  boss.statuses = []
  b.stage = 'foes'
  boss.acted = false
  foeTurn(b)
  assert.ok(!boss.shrugs, 'its turn came unHexed')
  addStatus(b, boss, 'hexed', 1, unit(b, 1))
  assert.ok(hexed(boss)?.fresh, 'a Hex laid after it acted lands, for its next act')
  // A Hex of 2 turns is one Hex: it costs two acts, and the boss shrugs off the next until it acts again.
  const c = scene([on('tomb_knight', 1, 'party', 3, 6, 9), on('mire_mother', 50, 'foe', 3, 7, 1)])
  addStatus(c, unit(c, 50), 'hexed', 2)
  const lost = []
  for (let turn = 0; turn < 4; turn++) {
    addStatus(c, unit(c, 50), 'hexed', 1)
    lost.push(order(c, { type: 'end' }).some((e) => e.type === 'hexed' && e.target === 50))
  }
  assert.deepEqual(lost, [true, true, false, true])
})

test('killing the Sovereign ends the battle: its court and every foe still standing crumble and pay as if slain, and the foes still to come never enter', () => {
  const b = scene([
    on('tomb_knight', 1, 'party', 3, 6, 9),
    { ...on('hollow_sovereign', 50, 'foe', 3, 7, 1), wave: 2 }, { ...on('grave_ghoul', 51, 'foe', 5, 9, 1), wave: 2 },
    { ...on('bone_chanter', 52, 'foe', 0, 10, 1), shadow: true }, on('will_o_wisp', 53, 'foe', 6, 10, 1)
  ], { reserve: [coming('grave_ghoul', 60, 3)] })
  b.waveAt[2] = 1
  const sov = unit(b, 50)
  sov.hp = 1
  order(b, { type: 'act', uid: 1, ability: 'strike', target: 50 })
  assert.ok(!alive(sov))
  const fell = b.events.findIndex((e) => e.type === 'death' && e.target === 50)
  const after = b.events.slice(fell + 1).filter((e) => e.type === 'death')
  assert.deepEqual(after.map((e) => [e.target, e.actor, e.crumble]), [[51, 50, true], [52, 50, true], [53, 50, true]])
  assert.ok(b.units.filter((u) => u.side === 'foe').every((u) => u.hp === 0))
  assert.deepEqual(b.reserve, [], 'the foe still to come never enters')
  assert.deepEqual([b.over, b.winner, b.reason], [true, 'party', 'crumble'])
  assert.deepEqual(b.events.at(-1), { beat: b.beat, type: 'battle:end', winner: 'party', reason: 'crumble' })
  // They pay as if slain (not the shadow): the court in the Sovereign's wave, the Wisp in the first.
  const pay = essenceByWave(b)
  assert.equal(pay[2], foeEssence(sov) + foeEssence(unit(b, 51)))
  assert.equal(pay[0], foeEssence(unit(b, 53)))
  assert.equal(pay[1], 0)
})

test('the Sovereign\'s crumbled court never rises: the battle ends with its fall, and its dust is no corpse (no shadow for Hollow Court to reap)', () => {
  // A Frost Sprite of yours fells the Sovereign at (3, 4) with one shot; two Pages of its court stand beside it, well
  // inside the reach of a Knight of yours holding Hollow Court.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 1, 1, 20), on('tomb_knight', 2, 'party', 3, 2, 3, [0, 0], ['hollow_court']),
    on('hollow_sovereign', 10, 'foe', 3, 4, 1), on('clockwork_page', 11, 'foe', 2, 4, 1), on('clockwork_page', 12, 'foe', 4, 4, 1)], { boss: true })
  unit(b, 10).hp = 1
  order(b, { type: 'act', uid: 1, ability: unit(b, 1).basic.id, target: 10 })
  assert.deepEqual([b.winner, b.reason, b.turn], ['party', 'crumble', 1])
  assert.deepEqual(b.events.filter((e) => e.type === 'death' && e.crumble).map((e) => e.target), [11, 12])
  assert.deepEqual(corpses(b, unit(b, 2)), [], 'nothing for Arise')
  assert.ok(!b.events.some((e) => e.type === 'arise'))
  assert.equal(b.units.filter((u) => u.shadow).length, 0)
})

test('a Monarch felled by a foe of a later wave is recorded with that wave, under the killer\'s own threat', () => {
  const fell = (wave, id = 'mantis_reaper') => {
    const b = scene([on('monarch', 0, 'party', 3, 0), { ...on(id, 50, 'foe', 3, 1, 5), ...(wave && { wave }) }])
    b.monarch.hp = 1
    playOut(b)
    return b.death
  }
  assert.deepEqual([fell(0).threat, fell(0).wave], [UNITS.mantis_reaper.threats[0], undefined])
  assert.deepEqual([fell(1).threat, fell(1).wave, fell(1).by], [UNITS.mantis_reaper.threats[0], 1, 'mantis_reaper'])
  // The Sovereign and its court come in the boss room's last wave: still what they are, never 'depth'.
  assert.deepEqual([fell(2, 'hollow_sovereign').threat, fell(2, 'hollow_sovereign').wave], [UNITS.hollow_sovereign.threats[0], 2])
  assert.deepEqual([fell(2, 'barrow_wight').threat, fell(2, 'barrow_wight').wave], [UNITS.barrow_wight.threats[0], 2])
  assert.ok(!Object.values(UNITS).some((u) => u.threats?.includes('depth')))
})

test('in the last room only the Sovereign takes the boss\'s multipliers; its waves and court take the floor\'s', () => {
  const last = TUNING.run.floors
  const mods = foeMods(last, true)
  const sov = makeUnit('hollow_sovereign', { uid: 1, lvl: 7 })
  const ghoul = makeUnit('grave_ghoul', { uid: 2, lvl: 7 })
  assert.equal(statsOf(sov, mods).hp, statsOf(sov).hp * at(sp.bossHp, last))
  assert.equal(statsOf(sov, mods).atk, statsOf(sov).atk * at(sp.bossAtk, last))
  assert.equal(statsOf(ghoul, mods).hp, statsOf(ghoul).hp * at(sp.foeHp, last))
  assert.equal(statsOf(ghoul, mods).atk, statsOf(ghoul).atk * at(sp.foeAtk, last))
  assert.deepEqual(foeMods(last, false).map((m) => m.v), [at(sp.foeHp, last), at(sp.foeAtk, last)])
})

// ── the run ──────────────────────────────────────────────────────────────────────────────────────

test('a siege is one battle of three waves with no prep between them, paying essence wave by wave', () => {
  let run = null
  for (let i = 0; i < 20 && !run; i++) {
    const r = createRun({ start: START_PARTY, seed: 'siege' + i })
    const node = availableNodes(r)[0]
    // A floor-3 siege, cut to two foes a wave at level 1, against souls at level 10.
    const room = drawRoom(r.state.seed, 3, { ...node, type: 'siege', rank: SIEGE_RANK })
    Object.assign(node, { type: 'siege', foes: room.foes.slice(0, 2), waves: room.waves.map((w) => ({ ...w, foes: w.foes.slice(0, 2) })) })
    for (const f of groups(node).flat()) f.lvl = 1
    strong(r)
    assert.ok(legalActions(r).some((a) => a.type === 'node' && a.id === node.id))
    apply(r, { type: 'node', id: node.id })
    assert.equal(r.state.phase, 'prep', 'a siege opens prep like any battle')
    fight(r)
    if (r.state.phase === 'reap') run = r
  }
  assert.ok(run, 'no siege was won')
  const s = run.state
  const b = run.battle
  const node = currentNode(run)
  assert.equal(s.stats.fights, 1, 'one battle')
  assert.deepEqual(b.events.filter((e) => e.type === 'wave').map((e) => e.wave), [1, 2])
  const real = b.units.filter((u) => u.side === 'foe' && !u.shadow)
  assert.equal(real.length, groups(node).flat().length, 'every wave fought')
  assert.ok(real.every((u) => u.hp <= 0))
  const pay = essenceByWave(b)
  assert.equal(pay.length, 3)
  assert.ok(pay.every((v) => v > 0), JSON.stringify(pay))
  assert.equal(s.stats.essence, Math.round(pay.reduce((n, v) => n + v, 0)))
  // The battle is a pure function of its setup and its orders: rebuilt from them, every wave plays out the same.
  assert.deepEqual(rebuilt(run).events, b.events)
  // The reap offers a soul of every wave's kinds, one to recruit.
  const kinds = new Set(real.map((u) => u.id))
  assert.deepEqual(new Set(s.offers.filter((o) => o.type === 'soul').map((o) => o.id)), kinds)
  assert.equal(s.nextUid, b.nextUid)
})

// A rich run (as run.test.js's strong run) through floors 3 and 4: on the way every legal action applies to a
// copy of the state, the state keeps its uids and slots straight, and every deep battle rebuilt from its setup and
// its orders plays out the same (the essence is edited outside the log, so the run itself cannot be replayed: the
// fuzz test seldom gets this deep). The last room is the Sovereign's siege: its waves enter, the Sovereign with its
// court last, and its fall ends the battle.
// Functionality, not balance: however far the run gets, every legal action applies, every deep fight rebuilds
// from its setup, and uids and slots stay unique. (Whether it wins is the final balance pass's business.)
test('the deep floors play: every legal action applying on the way, every deep fight rebuilt from its setup', () => {
  const run = createRun({ start: START_PARTY, seed: 'rich' })
  const s = run.state
  const rng = createRng(s.seed).stream('autoplay')
  const STEADY = { ...LEVELS.basic, wounds: true, turns: 'expert' }
  const fought = []
  // Each floor, the relics a rich run might have taken (outside the log, as the purse): HP and three Command.
  let granted = 0
  for (let steps = 0; s.phase !== 'over'; steps++) {
    if (s.essence < 5000) s.essence = 1e5
    if (['map', 'prep'].includes(s.phase) && granted < s.floor) {
      granted++
      grant(run, ['bone_mantle', 'grave_banner', 'grave_banner', 'grave_banner'])
    }
    if (s.floor >= W.floor && steps % 23 === 0) {
      for (const a of legalActions(run).filter((_, i, all) => i % Math.ceil(all.length / 8) === 0)) {
        assert.doesNotThrow(() => apply({ ...run, state: structuredClone(s), battle: run.battle && fork(run.battle, { quiet: false }) }, a), JSON.stringify(a))
      }
    }
    const action = policy(run, rng, STEADY)
    const floor = s.floor
    const was = s.phase
    apply(run, action)
    if (action.type === 'fight') fought.push({ floor, type: currentNode(run).type, b: run.battle })
    if (was === 'battle' && s.phase !== 'battle' && run.battle.floor >= W.floor) {
      assert.deepEqual(rebuilt(run).events, run.battle.events, `floor ${run.battle.floor}: rebuilt from its setup and its orders`)
    }
    assert.equal(new Set(s.party.map((u) => u.uid)).size, s.party.length, 'unique uids')
    assert.ok(s.party.every((u) => u.uid < s.nextUid || u.uid === MONARCH_UID), 'uids below nextUid')
    const field = s.party.filter((u) => u.slot >= 0)
    assert.equal(new Set(field.map((u) => u.slot)).size, field.length, 'unique slots')
  }
  assert.ok(fought.length > 0, 'it fought')
  assert.ok(fought.some((f) => f.floor >= W.floor), `it fought on floor ${W.floor}: ${fought.map((f) => f.floor)}`)
})
