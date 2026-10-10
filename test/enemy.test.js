// The enemy as an army (slice 5): late pairs, foe captains with cohorts, behaviours hinted in flavour, waves,
// sieges, the Sovereign's court and its Grave Tide, the depth threat.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, stepBattle, runBattle, escalation } from '../src/sim/battle.js'
import {
  createRun, apply, availableNodes, legalActions, battleSetup, drawRoom, encounter, roomThreats, foeLevel, foeMods, foeEssence,
  essenceByWave, MONARCH_UID, currentNode
} from '../src/sim/run.js'
import { generateFloor, RANKS, SIEGE_RANK } from '../src/sim/map.js'
import { policy, LEVELS, rehearsalBudget } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { UNITS, ABILITIES, THREATS, BEHAVIOURS, unitDef } from '../src/content.js'
import { makeUnit, tileAt, slotAt, colOf, statsOf, baseStats, alive, DEPTH, CENTRE_OUT } from '../src/sim/unit.js'
import { sturdy, grant } from './tuned.js'
import { on, scene as sceneOf, slay, unit } from './scene.js'

const sp = TUNING.spawn
const W = sp.waves
const at = (list, floor) => list[Math.min(floor, list.length) - 1]

// A battle of units placed on tiles (scene.js scene).
const scene = (units, opts) => sceneOf(units, { seed: 'enemy', ...opts })
// A foe still to come: off the board, in its wave, entering in `lane` when `when` comes.
const coming = (id, uid, wave, when, lane = 3, extra = {}) => ({ ...makeUnit(id, { uid, lvl: 1 }), side: 'foe', wave, lane, when: { ...when, wave }, ...extra })
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

test('every foe kind comes by Walk, Flank or Fly, hinted only in its flavour; depth is a room\'s threat', () => {
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
  // Flank is rare: a kind whose nature is to go round, one first met on each of floors 1–3; the rest Walk, but the
  // flyers, first met on floors 2 and 3.
  const by = (b) => Object.values(UNITS).filter((u) => u.behaviour === b).map((u) => [u.id, u.spawn.minFloor]).sort()
  assert.deepEqual(by('flank'), [['barrow_wight', 3], ['mantis_reaper', 2], ['will_o_wisp', 1]])
  assert.deepEqual(by('fly'), [['ash_wyvern', 3], ['hive_drone', 2]])
  assert.ok(THREATS.depth.name && THREATS.depth.desc)
  assert.deepEqual(ABILITIES.grave_tide.effects.at(-1), { op: 'raise', count: 2 })
})

// ── the map ──────────────────────────────────────────────────────────────────────────────────────

test('sieges: from floor 3, one or two of the late ranks\' fights, never two in a rank; none before', () => {
  let seen = 0
  for (let i = 0; i < 400; i++) {
    const floor = 1 + (i % 4)
    const map = generateFloor({ seed: 'siege' + i, floor, last: floor === TUNING.run.floors })
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

test('rooms: floor-1 elites bring a late pair; captains with cohorts from floor 2, each one piece; waves from floor 3; the last room ends in the Sovereign\'s court', () => {
  const count = {}
  const pairTiers = []
  for (let i = 0; i < 30; i++) {
    for (let floor = 1; floor <= TUNING.run.floors; floor++) {
      const seed = 'room' + i
      const map = generateFloor({ seed, floor, last: floor === TUNING.run.floors })
      for (const node of map.nodes.filter((n) => ['fight', 'elite', 'siege', 'boss'].includes(n.type))) {
        const where = `${seed} floor ${floor} ${node.id} ${node.type}`
        const room = drawRoom(seed, floor, node)
        assert.deepEqual(room.foes, encounter(seed, floor, node), where)
        const elite = node.type === 'elite'
        const boss = node.type === 'boss'
        const lvl = foeLevel(floor, node.rank) + (elite ? sp.eliteLevel : 0)
        const waves = boss || node.type === 'siege' ? W.siege
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
          if (k) assert.deepEqual(room.waves[k - 1].when, floor === 1 ? { at: 'time', t: sp.late.t } : { at: 'break', t: W.t }, w)
          // A captain is one piece, its cohort's bodies its count; no foe stands apart as another's cohort.
          const captains = g.filter((f) => f.count !== undefined)
          assert.ok(!g.some((f) => 'cohortOf' in f), w)
          if (boss && k === waves - 1) {
            // The Sovereign at the centre of the front row, its court of undead about it.
            assert.deepEqual(g[0], { id: 'hollow_sovereign', lvl, slot: slotAt(0, CENTRE_OUT[0]) }, w)
            assert.equal(g.length, 1 + sp.court, w)
            assert.ok(g.slice(1).every((m) => unitDef(m.id).kin === 'undead' && !unitDef(m.id).boss && m.count === undefined), w)
            continue
          }
          assert.ok(!g.some((f) => unitDef(f.id).boss), w)
          if (floor === 1) {
            assert.equal(captains.length, 0, `${w}: no captains on floor 1`)
            assert.equal(g.length, k ? sp.late.n : at(elite ? sp.elite : sp.fight, floor), w)
            // The late pair comes from the floor's own pool: within its tier cap, and weighted to its tier.
            if (k) {
              const cap = Math.min(sp.tierMax, 1 + Math.floor((floor - 1) * sp.tierPerFloor)) + sp.tierOverCap
              assert.ok(g.every((f) => UNITS[f.id].spawn.minFloor <= floor && UNITS[f.id].tier <= cap), w)
              pairTiers.push(...g.map((f) => UNITS[f.id].tier))
            }
            continue
          }
          const cohort = at(sp.cohort, floor)
          assert.equal(captains.length, elite ? sp.captains.elite : sp.captains.fight, w)
          assert.ok(captains.every((c) => c.count === 1 + cohort), `${w}: a captain and its cohort, one piece`)
          assert.equal(g.length, at(elite ? sp.elite : sp.fight, floor), w)
          assert.ok(!g.some((f) => 'order' in f || 'square' in f), `${w}: no foe carries orders`)
        }
      }
    }
  }
  // Every kind of room was drawn.
  for (const key of ['1fight1', '1elite2', '2fight1', '2elite1', '3fight1', '3fight2', '3elite2', '3siege3', '4siege3', '4boss3']) assert.ok(count[key] > 0, `${key}: ${JSON.stringify(count)}`)
  // The floor's pool, not the elite's: floor 1's weights favour tier 1 (the elite pool's, tier 2).
  assert.ok(pairTiers.filter((t) => t === 1).length > 0.7 * pairTiers.length, `late pair tiers: ${pairTiers}`)
})

// ── the battle: foes as an army ──────────────────────────────────────────────────────────────────

test('a run\'s room becomes battle units: foes take the first uids, formation then waves; a captain and its cohort are one piece; waves wait in the reserve', () => {
  const run = createRun({ seed: 'army5' })
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
  const foeBodies = setup.reserve
  assert.ok(foeBodies.every((f) => f.side === 'foe'), 'the reserve is the foes still to come')
  assert.deepEqual(foeBodies.map((f) => [f.uid, f.id, f.slot, f.wave, f.lane]), node.waves[0].foes.map((f, i) => [first + node.foes.length + i, f.id, -1, 1, colOf(f.slot)]))
  assert.ok(foeBodies.every((f) => JSON.stringify(f.when) === JSON.stringify({ at: 'break', t: W.t, wave: 1 })))
  assert.equal(setup.nextUid, first + total, 'shadows after every foe')
  // Cohorts, wave by wave: a captain's piece holds its cohort's bodies (its count, its pool); no foe carries a plan.
  for (const [k, g] of all.entries()) {
    const units = k ? foeBodies : setup.foes
    for (const [i, f] of g.entries()) {
      const u = units[i]
      assert.deepEqual([u.count, u.maxHp], [f.count ?? 1, (f.count ?? 1) * baseStats(f.id, f.lvl).hp], `${k} ${f.id} ${f.slot}`)
      assert.ok(!('plan' in u) && !('cohortOf' in u) && !('rank' in u), `${k} ${f.id} ${f.slot}`)
    }
  }
  assert.ok(setup.foes.some((u) => u.count > 1))
  // The battle plays it: the second wave announced and entering, and the run moves past every uid it made. (A
  // Monarch that outlasts the wave: twelve level-1 foes with their Drake 6 and Ranger 6 steps outfight three
  // level-10 souls, so the wave would otherwise come to a battle already lost.)
  strong(run, 400)
  apply(run, { type: 'fight' })
  const b = run.battle
  assert.deepEqual(b.events.filter((e) => e.type === 'wave').map((e) => e.wave), [1])
  const foesIn = b.events.filter((e) => e.type === 'enter' && e.unit.side === 'foe').map((e) => e.unit.uid)
  assert.deepEqual(foesIn, foeBodies.map((f) => f.uid), 'the wave entered, in order')
  assert.ok(b.units.filter((u) => u.wave === 1).every((u) => u.side === 'foe'))
  const uids = b.units.map((u) => u.uid)
  assert.equal(new Set(uids).size, uids.length, 'every uid once')
  assert.ok(uids.every((uid) => uid < s.nextUid) && s.nextUid === b.nextUid)
})

test('a late pair enters at the top edge at 20 s, each in its lane, one a tick; a stack enters as one piece', () => {
  const t = sp.late.t
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 0, 9), on('grave_ghoul', 10, 'foe', 3, 10, 1)], {
    reserve: [coming('frost_sprite', 70, 1, { at: 'time', t }, 1), { ...coming('will_o_wisp', 71, 1, { at: 'time', t }, 5), ...makeUnit('will_o_wisp', { uid: 71, lvl: 1, count: 3 }) }]
  })
  assert.deepEqual(b.events[0].reserve.map((r) => [r.uid, r.wave, r.side]), [[70, 1, 'foe'], [71, 1, 'foe']], 'announced as foes still to come, in their wave')
  while (b.t < t) assert.ok(!stepBattle(b).some((e) => e.type === 'enter' || e.type === 'wave'), 'nothing before 20 s')
  const at400 = stepBattle(b).filter((e) => ['wave', 'enter'].includes(e.type))
  assert.deepEqual(at400.map((e) => [e.t, e.type, e.unit?.uid ?? e.wave]), [[t, 'wave', 1], [t, 'enter', 70]])
  assert.equal(at400[1].unit.tile, tileAt(1, DEPTH - 1), 'at the top edge, in its lane')
  assert.equal(at400[1].unit.wave, 1)
  const at401 = stepBattle(b).filter((e) => ['wave', 'enter'].includes(e.type))
  assert.deepEqual(at401.map((e) => [e.t, e.type, e.unit?.uid]), [[t + 1, 'enter', 71]], 'one a tick')
  assert.equal(at401[0].unit.tile, tileAt(5, DEPTH - 1), 'in its own lane')
  assert.deepEqual([at401[0].unit.count, at401[0].unit.maxHp], [3, 3 * unit(b, 71).body], 'one piece of three')
  assert.equal(b.foeIn, t + 1)
})

test('a wave enters once the wave before is down to a third, or 30 s after it began to enter; a wave not yet begun has not broken', () => {
  const brk = { at: 'break', t: W.t }
  const make = () => scene([on('monarch', 0, 'party', 3, 0, 100), on('grave_ghoul', 10, 'foe', 0, 10, 1), on('grave_ghoul', 11, 'foe', 3, 10, 1), on('grave_ghoul', 12, 'foe', 6, 10, 1)], {
    reserve: [coming('tomb_knight', 20, 1, brk, 2), coming('tomb_knight', 21, 1, brk, 4), coming('iron_golem', 30, 2, brk, 3)]
  })
  const b = make()
  const enters = (ev) => ev.filter((e) => e.type === 'enter').map((e) => e.unit.uid)
  for (let k = 0; k < 20; k++) assert.deepEqual(enters(stepBattle(b)), [])
  slay(b, unit(b, 10))
  for (let k = 0; k < 20; k++) assert.deepEqual(enters(stepBattle(b)), [], 'two of three stand: not broken')
  slay(b, unit(b, 11))
  const broke = stepBattle(b)
  assert.deepEqual(broke.filter((e) => e.type === 'wave').map((e) => e.wave), [1])
  assert.deepEqual(enters(broke), [20], 'one of three: the next wave comes')
  assert.deepEqual(enters(stepBattle(b)), [21])
  assert.equal(b.waveAt[1], b.t - 2)
  // The third waits on the second: two of two stand.
  for (let k = 0; k < 20; k++) assert.deepEqual(enters(stepBattle(b)), [])
  slay(b, unit(b, 20))
  for (let k = 0; k < 5; k++) assert.deepEqual(enters(stepBattle(b)), [], 'one of two: more than a third')
  slay(b, unit(b, 21))
  const third = stepBattle(b)
  assert.deepEqual([third.filter((e) => e.type === 'wave').map((e) => e.wave), enters(third)], [[2], [30]])
  // Untouched, a wave comes 30 s after the one before began: the second at 30 s, the third 30 s after it.
  const slow = make()
  const seen = []
  while (slow.t < 2 * W.t + 5 && !slow.over) seen.push(...stepBattle(slow).filter((e) => e.type === 'enter').map((e) => [e.t, e.unit.uid]))
  assert.deepEqual(seen.slice(0, 3), [[W.t, 20], [W.t + 1, 21], [2 * W.t, 30]])
  // Foes still to come keep a battle going with every foe on the board slain.
  const empty = make()
  for (const uid of [10, 11, 12]) slay(empty, unit(empty, uid))
  stepBattle(empty)
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
  sov.gauge = sov.costliest
  const ev = stepBattle(b)
  assert.ok(ev.some((e) => e.type === 'action' && e.actor === 50 && e.ability === 'grave_tide'), 'it cast Grave Tide')
  const risen = ev.filter((e) => e.type === 'arise')
  assert.deepEqual(risen.map((e) => [e.actor, e.corpse, e.unit.uid, e.unit.side, e.unit.shadow, e.unit.tile]),
    [[50, 2, 200, 'foe', true, tileAt(5, 5)], [50, 51, 201, 'foe', true, tileAt(2, 9)]])
  for (const e of risen) {
    const u = unit(b, e.unit.uid)
    assert.ok(alive(u) && u.shadow && u.side === 'foe')
    assert.equal(u.hp, Math.ceil(baseStats(u.id, u.lvl).hp * TUNING.arise.hp))
  }
  assert.equal(b.raised, 0, 'Arise\'s count is the Monarch\'s alone')
  assert.ok(unit(b, 2).raised && unit(b, 51).raised && !unit(b, 52).raised && !unit(b, 53).raised)
  assert.equal(b.nextUid, 202)
  // A second cast raises the one corpse left that may rise, the Page: never the raised again, the boss, the
  // shadow or the trodden Golem.
  sov.gauge = sov.costliest
  const again = stepBattle(b).filter((e) => e.type === 'arise')
  assert.deepEqual(again.map((e) => [e.actor, e.corpse, e.unit.uid, e.unit.tile]), [[50, 52, 202, tileAt(6, 10)]])
  assert.equal(b.nextUid, 203)
  assert.ok(!unit(b, 53).raised && !unit(b, 54).raised && !unit(b, 55).raised)
})

test('killing the Sovereign ends the battle: its court and every foe still standing crumble and pay as if slain, and the foes still to come never enter', () => {
  const b = scene([
    on('tomb_knight', 1, 'party', 3, 6, 9),
    { ...on('hollow_sovereign', 50, 'foe', 3, 7, 1), wave: 2 }, { ...on('grave_ghoul', 51, 'foe', 5, 9, 1), wave: 2 },
    { ...on('bone_chanter', 52, 'foe', 0, 10, 1), shadow: true }, on('will_o_wisp', 53, 'foe', 6, 10, 1)
  ], { reserve: [coming('grave_ghoul', 60, 3, { at: 'time', t: 2000 })] })
  b.waveAt[2] = 0
  const sov = unit(b, 50)
  sov.hp = 1
  unit(b, 1).gauge = unit(b, 1).costliest
  while (!b.over && b.t < 400) stepBattle(b)
  assert.ok(!alive(sov))
  const fell = b.events.findIndex((e) => e.type === 'death' && e.target === 50)
  const after = b.events.slice(fell + 1).filter((e) => e.type === 'death')
  assert.deepEqual(after.map((e) => [e.target, e.actor, e.crumble]), [[51, 50, true], [52, 50, true], [53, 50, true]])
  assert.ok(b.units.filter((u) => u.side === 'foe').every((u) => u.hp === 0))
  assert.deepEqual(b.reserve, [], 'the foe still to come never enters')
  assert.deepEqual([b.over, b.winner, b.reason], [true, 'party', 'sovereign'])
  assert.deepEqual(b.events.at(-1), { t: b.t - 1, type: 'battle:end', winner: 'party', reason: 'sovereign' })
  // They pay as if slain (not the shadow): the court in the Sovereign's wave, the Wisp in the first.
  const pay = essenceByWave(b)
  assert.equal(pay[2], foeEssence(sov) + foeEssence(unit(b, 51)))
  assert.equal(pay[0], foeEssence(unit(b, 53)))
  assert.equal(pay[1], 0)
})

test('the Sovereign\'s crumbled court never rises: not even to an Arise cast later in the tick it fell (no shadow for Hollow Court to reap)', () => {
  // A Frost Sprite of yours fells the Sovereign at (3, 4) with its first shot; two Pages of its court stand beside it,
  // well inside Arise's reach of the Monarch at (3, 0), whose gauge is full and who acts after the Sprite.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 1, 1, 20),
    on('hollow_sovereign', 10, 'foe', 3, 4, 1), on('clockwork_page', 11, 'foe', 2, 4, 1), on('clockwork_page', 12, 'foe', 4, 4, 1)],
  { relics: ['arise', 'hollow_court'], boss: true })
  unit(b, 10).hp = 1
  unit(b, 1).gauge = unit(b, 1).costliest
  b.monarch.gauge = b.monarch.costliest
  assert.ok(unit(b, 1).ord < b.monarch.ord, 'the Monarch acts after the Sprite')
  while (!b.over) stepBattle(b)
  assert.deepEqual([b.winner, b.reason, b.t], ['party', 'sovereign', 1])
  assert.deepEqual(b.events.filter((e) => e.type === 'death' && e.crumble).map((e) => e.target), [11, 12])
  assert.deepEqual(b.events.filter((e) => e.type === 'arise' || (e.type === 'action' && e.actor === 0)), [], 'Arise never cast')
  assert.equal(b.units.filter((u) => u.shadow).length, 0)
})

test('a Monarch felled by a foe of a later wave is recorded with that wave, under the killer\'s own threat', () => {
  const fell = (wave, id = 'mantis_reaper') => {
    const b = scene([on('monarch', 0, 'party', 3, 0), { ...on(id, 50, 'foe', 3, 1, 5), ...(wave && { wave }) }])
    b.monarch.hp = 1
    while (!b.over) stepBattle(b)
    return b.death
  }
  assert.deepEqual([fell(0).threat, fell(0).wave], ['flank', undefined])
  assert.deepEqual([fell(1).threat, fell(1).wave, fell(1).by], ['flank', 1, 'mantis_reaper'])
  // The Sovereign and its court come in the boss room's last wave: still what they are, never 'depth'.
  assert.deepEqual([fell(2, 'hollow_sovereign').threat, fell(2, 'hollow_sovereign').wave], [UNITS.hollow_sovereign.threats[0], 2])
  assert.deepEqual([fell(2, 'barrow_wight').threat, fell(2, 'barrow_wight').wave], [UNITS.barrow_wight.threats[0], 2])
  assert.ok(!Object.values(UNITS).some((u) => u.threats?.includes('depth')))
})

test('in the last room only the Sovereign takes the boss\'s multipliers; its waves and court take the floor\'s', () => {
  const mods = foeMods(4, true)
  const sov = makeUnit('hollow_sovereign', { uid: 1, lvl: 7 })
  const ghoul = makeUnit('grave_ghoul', { uid: 2, lvl: 7 })
  assert.equal(statsOf(sov, mods).hp, statsOf(sov).hp * sp.bossHp)
  assert.equal(statsOf(sov, mods).atk, statsOf(sov).atk * sp.bossAtk)
  assert.equal(statsOf(ghoul, mods).hp, statsOf(ghoul).hp * at(sp.foeHp, 4))
  assert.equal(statsOf(ghoul, mods).atk, statsOf(ghoul).atk * at(sp.foeAtk, 4))
  assert.deepEqual(foeMods(4, false).map((m) => m.v), [at(sp.foeHp, 4), at(sp.foeAtk, 4)])
})

// ── the run ──────────────────────────────────────────────────────────────────────────────────────

test('a siege is one battle of three waves with no prep between them, paying essence wave by wave', () => {
  let run = null
  for (let i = 0; i < 20 && !run; i++) {
    const r = createRun({ seed: 'siege' + i })
    const node = availableNodes(r)[0]
    // A floor-3 siege, cut to two foes a wave at level 1, against souls at level 10.
    const room = drawRoom(r.state.seed, 3, { ...node, type: 'siege', rank: SIEGE_RANK })
    Object.assign(node, { type: 'siege', foes: room.foes.slice(0, 2), waves: room.waves.map((w) => ({ ...w, foes: w.foes.slice(0, 2) })) })
    for (const f of groups(node).flat()) f.lvl = 1
    strong(r)
    assert.ok(legalActions(r).some((a) => a.type === 'node' && a.id === node.id))
    apply(r, { type: 'node', id: node.id })
    assert.equal(r.state.phase, 'prep', 'a siege opens prep like any battle')
    apply(r, { type: 'fight' })
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
  // The battle is a pure function of its setup: rebuilt from it, every wave plays out the same.
  const again = createBattle(structuredClone(run.setup))
  runBattle(again)
  assert.deepEqual(again.events, b.events)
  // The reap offers a soul of every wave's kinds, one to recruit.
  const kinds = new Set(real.map((u) => u.id))
  assert.deepEqual(new Set(s.offers.filter((o) => o.type === 'soul').map((o) => o.id)), kinds)
  assert.equal(s.nextUid, b.nextUid)
})

// A rich run (as run.test.js's strong run) through floors 3 and 4: on the way every legal action applies to a
// copy of the state, the state keeps its uids and slots straight, and every deep battle rebuilt from its setup
// plays out the same (the essence is edited outside the log, so the run itself cannot be replayed: the fuzz
// test seldom gets this deep). The last room is the Sovereign's siege: its waves enter, the Sovereign with its
// court last, and its fall ends the battle.
// Functionality, not balance: however far the run gets, every legal action applies, every deep fight rebuilds
// from its setup, and uids and slots stay unique. (Whether it wins is the final balance pass's business.)
test('the deep floors play: every legal action applying on the way, every deep fight rebuilt from its setup', () => {
  const run = createRun({ seed: 'rich' })
  const s = run.state
  const rng = createRng(s.seed).stream('autoplay')
  const STEADY = { ...LEVELS.basic, wounds: true }
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
        assert.doesNotThrow(() => apply({ ...run, state: structuredClone(s) }, a), JSON.stringify(a))
      }
    }
    const action = policy(run, rng, STEADY)
    const floor = s.floor
    apply(run, action)
    if (action.type === 'fight') fought.push({ floor, type: currentNode(run).type, b: run.battle })
    if (action.type === 'fight' && floor >= W.floor) {
      const again = createBattle(structuredClone(run.setup))
      runBattle(again)
      assert.deepEqual(again.events, run.battle.events, `floor ${floor} ${currentNode(run).id}: rebuilt from its setup`)
    }
    assert.equal(new Set(s.party.map((u) => u.uid)).size, s.party.length, 'unique uids')
    assert.ok(s.party.every((u) => u.uid < s.nextUid || u.uid === MONARCH_UID), 'uids below nextUid')
    const field = s.party.filter((u) => u.slot >= 0)
    assert.equal(new Set(field.map((u) => u.slot)).size, field.length, 'unique slots')
  }
  assert.ok(fought.length > 0, 'it fought')
})

// ── the autoplayer ───────────────────────────────────────────────────────────────────────────────

test('the autoplayer rehearses a room with waves long enough to meet them: its budget counts from the last foe in, as the ceiling does', () => {
  const { rehearsalCeiling } = TUNING.autoplay
  const party = [{}, {}]
  const foes = [{}, {}]
  const body = (wave) => ({ side: 'foe', wave })
  for (const reserve of [[{}, {}], [body(1), body(1)], [body(1), body(2), body(2)]]) {
    assert.equal(rehearsalBudget({ party, foes, reserve }, 4).ceiling, rehearsalCeiling)
  }
  // Each wave comes at most W.t after the one before began, so a budget longer than that meets every one.
  assert.ok(W.t < rehearsalCeiling && sp.late.t < rehearsalCeiling)
})

// ── the clock ────────────────────────────────────────────────────────────────────────────────────

test('the ceiling and the ramp count from the last foe to enter: a late wave in the boss room still meets the ramp before the ceiling', () => {
  // A stalemate: the Monarch in its camp, a Golem at the far edge, another (frozen where it enters) in the last
  // wave at the latest it can come (30 s after a wave that came at 30 s).
  const late = 2 * W.t
  const X = TUNING.escalation
  for (const boss of [true, false]) {
    const b = scene([on('monarch', 0, 'party', 3, 0, 20), on('iron_golem', 10, 'foe', 3, 10, 1)], {
      boss, reserve: [coming('iron_golem', 20, 2, { at: 'time', t: late }, 0)]
    })
    let ramped = 0
    while (!b.over) {
      stepBattle(b)
      if (b.byUid.get(20)) b.byUid.get(20).nextStep = Infinity
      if (b.t > late && escalation(b) > 1) ramped++
    }
    assert.equal(b.foeIn, late)
    assert.deepEqual([b.winner, b.reason, b.t], [null, 'tick-ceiling', late + TUNING.tick.ceiling])
    assert.equal(ramped, b.t - (b.foeIn + X.startTick * (boss ? X.bossMult : 1)), `ramped ${ramped} ticks after the last entry`)
  }
  // Before any foe enters, the ramp counts from the start.
  const early = scene([on('monarch', 0, 'party', 3, 0, 20), on('iron_golem', 10, 'foe', 3, 10, 1)])
  for (let t = 0; t <= X.startTick; t++) stepBattle(early)
  assert.equal(escalation(early), 1 + X.perTick)
})
