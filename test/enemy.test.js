// The enemy as an army (slice 5): late pairs, foe captains with cohorts and hinted orders, waves, sieges, the
// Sovereign's court and its Grave Tide, the depth threat.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, stepBattle, runBattle, stats, falters, escalation } from '../src/sim/battle.js'
import {
  createRun, apply, availableNodes, legalActions, battleSetup, drawRoom, encounter, roomThreats, foeLevel, foeMods, foeEssence,
  essenceByWave, souls, monarchPoints, MONARCH_STATS, MONARCH_UID, currentNode
} from '../src/sim/run.js'
import { generateFloor, RANKS, SIEGE_RANK } from '../src/sim/map.js'
import { policy, LEVELS, rehearsalBudget } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { UNITS, ABILITIES, THREATS, FOE_ORDERS, unitDef } from '../src/content.js'
import {
  makeUnit, tileAt, tileX, tileY, slotAt, colOf, distance, statsOf, baseStats, alive, DEPTH, CAMP_ROWS, LANES, CENTRE_OUT
} from '../src/sim/unit.js'

const sp = TUNING.spawn
const W = sp.waves
const at = (list, floor) => list[Math.min(floor, list.length) - 1]

// A unit placed on a board tile directly; a battle of such units (as in battle.test.js): foes deploy in spare
// slots of their formation and are moved to their tiles; the ones not named in `moving` never step.
const on = (id, uid, side, x, y, lvl = 3) => ({ ...makeUnit(id, { uid, lvl }), side, tile: tileAt(x, y) })
function scene (units, { moving = [], ...opts } = {}) {
  const foeRow0 = DEPTH - 3
  const spare = [...Array(21).keys()].filter((slot) => !units.some((u) => u.side === 'foe' && tileY(u.tile) >= foeRow0 && slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) === slot))
  const slot = (u) => u.side === 'party' ? slotAt(6 - tileY(u.tile), tileX(u.tile))
    : tileY(u.tile) >= foeRow0 ? slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) : spare.shift()
  const placed = units.map((u) => ({ ...u, slot: slot(u) }))
  const b = createBattle({ party: placed.filter((u) => u.side === 'party'), foes: placed.filter((u) => u.side === 'foe'), seed: 'enemy', ...opts })
  for (const u of b.units) {
    const want = units.find((x) => x.uid === u.uid).tile
    if (u.tile !== want) {
      b.at[u.tile] = null
      u.tile = want
      u.anchor = want
      b.at[want] = u
    }
    if (!moving.includes(u.uid)) u.nextStep = Infinity
  }
  return b
}
// Lays a unit dead where it stands, as a blow would (the index, the roster), without the blow's consequences.
function slay (b, u) {
  u.hp = 0
  u.statuses = []
  b.at[u.tile] = null
  b.roster++
  b.paths.clear()
}
const unit = (b, uid) => b.units.find((u) => u.uid === uid)
// A foe still to come: off the board, in its wave, entering in `lane` when `when` comes.
const coming = (id, uid, wave, when, lane = 3, extra = {}) => ({ ...makeUnit(id, { uid, lvl: 1 }), side: 'foe', wave, lane, when: { ...when, wave }, ...extra })
// A run's souls at level 10 and a Monarch that takes a while to fell (level `monarch`), so a battle runs its
// course (the state edited outside the log: not a replay).
function strong (run, monarch = 40) {
  for (const u of run.state.party) {
    const lvl = u.id === 'monarch' ? monarch : 10
    u.lvl = lvl
    u.hp = u.maxHp = baseStats(u.id, lvl).hp
  }
}

// ── content ──────────────────────────────────────────────────────────────────────────────────────

test('every foe kind carries the orders its elite captains may take, hinted only in its flavour; depth is a room\'s threat', () => {
  assert.deepEqual(Object.keys(FOE_ORDERS), ['stay', 'hunt', 'flank'])
  for (const u of Object.values(UNITS)) {
    if (u.monarch) {
      assert.equal(u.foeOrders, undefined)
      continue
    }
    assert.ok(u.foeOrders?.length && u.foeOrders.every((o) => FOE_ORDERS[o]), `${u.id} foeOrders`)
    assert.equal(new Set(u.foeOrders).size, u.foeOrders.length, `${u.id} foeOrders repeat`)
    assert.ok(typeof u.flavour === 'string' && u.flavour.length > 20, `${u.id} flavour`)
    // Flavour hints; it never names the order it hints at.
    assert.doesNotMatch(u.flavour, /\b(stays?|hunts?|flanks?|orders?)\b/i, u.id)
  }
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

test('rooms: floor-1 elites bring a late pair; captains with cohorts from floor 2, an elite\'s with orders; waves from floor 3; the last room ends in the Sovereign\'s court', () => {
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
          const members = g.filter((f) => f.cohortOf != null)
          const captains = g.filter((f) => members.some((m) => m.cohortOf === f.slot))
          if (boss && k === waves - 1) {
            // The Sovereign at the centre of the front row, its court of undead about it.
            assert.deepEqual(g[0], { id: 'hollow_sovereign', lvl, slot: slotAt(0, CENTRE_OUT[0]) }, w)
            assert.equal(members.length, sp.court, w)
            assert.ok(members.every((m) => m.cohortOf === g[0].slot && unitDef(m.id).kin === 'undead' && !unitDef(m.id).boss), w)
            assert.equal(g.length, 1 + sp.court, w)
            continue
          }
          assert.ok(!g.some((f) => unitDef(f.id).boss), w)
          if (floor === 1) {
            assert.equal(members.length, 0, `${w}: no captains on floor 1`)
            assert.ok(!g.some((f) => f.order), w)
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
          for (const c of captains) {
            const led = members.filter((m) => m.cohortOf === c.slot)
            assert.equal(led.length, cohort, w)
            assert.ok(led.every((m) => m.id === c.id && m.order === undefined && m.square === undefined), `${w}: a cohort of its own kind, with no order of its own`)
            if (!elite) {
              assert.equal(c.order, undefined, `${w}: a fight's captain hunts`)
              continue
            }
            assert.ok(unitDef(c.id).foeOrders.includes(c.order), `${w}: ${c.id} ${c.order}`)
            if (c.order !== 'flank') {
              assert.equal(c.square, undefined, w)
              continue
            }
            // A flank goes to the open ground beside the camp, on the wing nearer it.
            assert.equal(tileY(c.square), CAMP_ROWS, w)
            const wing = tileX(c.square)
            assert.ok(wing === 0 || wing === LANES - 1, w)
            if (colOf(c.slot) !== (LANES - 1) / 2) assert.equal(wing, colOf(c.slot) < (LANES - 1) / 2 ? 0 : LANES - 1, w)
          }
          assert.equal(g.length, at(elite ? sp.elite : sp.fight, floor) + captains.length * cohort, w)
          assert.ok(!g.some((f) => f.order && !captains.includes(f)), w)
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

test('a run\'s room becomes battle units: foes take the first uids, formation then waves; a cohort knows its captain\'s uid and shares an elite captain\'s orders; waves wait at the reserve\'s end', () => {
  const run = createRun({ seed: 'army5' })
  const s = run.state
  const node = availableNodes(run)[0]
  // A floor-3 elite here: captains with orders, cohorts, a second wave.
  const room = drawRoom('army5', 3, { ...node, type: 'elite', rank: 9 })
  Object.assign(node, { type: 'elite' }, room)
  for (const f of groups(node).flat()) f.lvl = 1
  apply(run, { type: 'node', id: node.id })
  const setup = battleSetup(run)
  const first = s.nextUid
  const all = groups(node)
  const total = all.flat().length
  assert.deepEqual(setup.foes.map((f) => [f.uid, f.id, f.slot]), node.foes.map((f, i) => [first + i, f.id, f.slot]))
  const foeBodies = setup.reserve.filter((b) => b.side === 'foe')
  assert.deepEqual(foeBodies.map((f) => [f.uid, f.id, f.slot, f.wave, f.lane]), node.waves[0].foes.map((f, i) => [first + node.foes.length + i, f.id, -1, 1, colOf(f.slot)]))
  assert.ok(foeBodies.every((f) => JSON.stringify(f.when) === JSON.stringify({ at: 'break', t: W.t, wave: 1 })))
  assert.deepEqual(setup.reserve.slice(-foeBodies.length), foeBodies, 'at the end of the reserve')
  assert.equal(setup.nextUid, first + total, 'shadows after every foe')
  // Cohorts and orders, wave by wave: a member's cohortOf is its captain's uid, and it carries its captain's plan.
  for (const [k, g] of all.entries()) {
    const units = k ? foeBodies : setup.foes
    for (const [i, f] of g.entries()) {
      const u = units[i]
      const captain = f.cohortOf != null ? g.find((c) => c.slot === f.cohortOf) : f
      if (f.cohortOf != null) assert.deepEqual([u.cohortOf, u.rank], [units[g.indexOf(captain)].uid, true])
      else assert.equal(u.cohortOf, undefined)
      assert.deepEqual(u.plan, captain.order ? { where: FOE_ORDERS[captain.order].where, square: captain.square ?? null } : undefined, `${k} ${f.id} ${f.slot}`)
    }
  }
  assert.ok(setup.foes.some((u) => u.plan) && setup.foes.some((u) => u.cohortOf !== undefined))
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

test('a late pair enters at the top edge at 20 s, each in its lane, one a tick; its entry is the wave a held detachment waits for', () => {
  const t = sp.late.t
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 0, 9), on('grave_ghoul', 10, 'foe', 3, 10, 1)], {
    reserve: [
      { ...makeUnit('tomb_knight', { uid: 5, lvl: 3 }), det: 1, plan: { where: 'hunt', square: null }, when: { at: 'wave' } },
      coming('frost_sprite', 70, 1, { at: 'time', t }, 1),
      coming('will_o_wisp', 71, 1, { at: 'time', t }, 5)
    ]
  })
  assert.deepEqual(b.events[0].reserve.filter((r) => r.side === 'foe').map((r) => [r.uid, r.wave]), [[70, 1], [71, 1]], 'announced as foes still to come, in their wave')
  while (b.t < t) assert.ok(!stepBattle(b).some((e) => e.type === 'enter' || e.type === 'wave'), 'nothing before 20 s')
  const at400 = stepBattle(b).filter((e) => ['wave', 'enter', 'call'].includes(e.type))
  assert.deepEqual(at400.map((e) => [e.t, e.type, e.unit?.uid ?? e.wave]), [[t, 'wave', 1], [t, 'enter', 70]])
  assert.equal(at400[1].unit.tile, tileAt(1, DEPTH - 1), 'at the top edge, in its lane')
  assert.equal(at400[1].unit.wave, 1)
  const at401 = stepBattle(b).filter((e) => ['wave', 'enter', 'call'].includes(e.type))
  assert.deepEqual(at401.map((e) => [e.t, e.type, e.unit?.uid ?? e.detachment]), [[t + 1, 'call', 1], [t + 1, 'enter', 5], [t + 1, 'enter', 71]], 'one a tick on each side')
  assert.equal(at401[2].unit.tile, tileAt(5, DEPTH - 1))
  assert.equal(b.entered, t + 1)
})

test('a wave\'s cohort member enters beside its captain; with its captain fallen, in its own lane, faltering and Hunting', () => {
  // The captain, a Tomb Knight, holds (1,9); its Ghoul comes in the next wave, in lane 5.
  const make = () => scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 50, 'foe', 1, 9, 1)], {
    reserve: [coming('grave_ghoul', 60, 1, { at: 'time', t: 1 }, 5, { cohortOf: 50, rank: true })]
  })
  const entry = (b) => {
    while (b.t < 10) {
      const ev = stepBattle(b)
      const i = ev.findIndex((e) => e.type === 'enter')
      if (i >= 0) return [ev[i], ev.slice(i + 1)]
    }
    assert.fail('the member never entered')
  }
  const b = make()
  const [e] = entry(b)
  assert.equal(e.unit.uid, 60)
  assert.ok(distance(e.unit.tile, unit(b, 50).tile) <= 1 && tileX(e.unit.tile) <= 2, 'beside its captain, not in its lane')
  assert.ok(!unit(b, 60).orphan)
  const lost = make()
  slay(lost, unit(lost, 50))
  const [o, after] = entry(lost)
  assert.equal(o.unit.tile, tileAt(5, DEPTH - 1), 'its lane, at the top edge')
  assert.deepEqual(after.filter((x) => x.type === 'falter'), [{ t: o.t, type: 'falter', target: 60, on: true }])
  assert.equal(unit(lost, 60).where, 'hunt')
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

test('a foe cohort keeps to its captain; when the captain falls it falters (×0.7) and Hunts, whatever its orders', () => {
  // The captain, a Tomb Knight on Stay, stands still at (3,9); its Ghoul starts in the far corner.
  const stay = { where: 'stay', square: null }
  const ghoul = { ...on('grave_ghoul', 51, 'foe', 6, 10, 1), cohortOf: 50, rank: true, plan: stay }
  const b = scene([on('monarch', 0, 'party', 3, 0), { ...on('tomb_knight', 50, 'foe', 3, 9, 1), plan: stay }, ghoul], { moving: [51] })
  const g = unit(b, 51)
  for (let k = 0; k < 120; k++) stepBattle(b)
  assert.ok(distance(g.tile, unit(b, 50).tile) <= 1, 'it walked back beside its captain')
  for (let k = 0; k < 200; k++) {
    stepBattle(b)
    assert.ok(distance(g.tile, unit(b, 50).tile) <= 1, 'and keeps there')
  }
  assert.ok(!falters(b, g) && !g.orphan)
  // A Frost Sprite of yours shoots the captain, the weakest it can see, at 1 HP.
  const kill = scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 3, 6, 9), { ...on('tomb_knight', 50, 'foe', 3, 9, 1), plan: stay },
    { ...ghoul, tile: tileAt(4, 10) }], { moving: [51] })
  const k = unit(kill, 51)
  unit(kill, 50).hp = 1
  unit(kill, 1).gauge = unit(kill, 1).costliest
  const dealt = stats(kill, k).damage.dealt
  const events = []
  while (alive(unit(kill, 50)) && kill.t < 400) events.push(...stepBattle(kill))
  const death = events.findIndex((e) => e.type === 'death' && e.target === 50)
  assert.ok(death >= 0, 'the captain fell')
  assert.deepEqual(events.slice(death + 1).filter((e) => e.type === 'falter'), [{ t: events[death].t, type: 'falter', target: 51, on: true }])
  assert.ok(k.orphan && falters(kill, k) && k.where === 'hunt', 'it falters and drops its Stay')
  assert.ok(Math.abs(stats(kill, k).damage.dealt / dealt - TUNING.monarch.falter) < 1e-9)
  // It Hunts: it walks at your souls.
  const from = k.tile
  for (let n = 0; n < 100 && !kill.over; n++) stepBattle(kill)
  assert.ok(tileY(k.tile) < tileY(from), 'it walked toward your camp')
})

test('an elite captain\'s orders: Stay holds its ground, a flank walks to the wing and Hunts from there with its cohort', () => {
  // On Stay, nothing of yours within 2 tiles: it holds. Hunting, it walks in.
  const party = [on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3, 1)]
  const holding = scene([...party, { ...on('tomb_knight', 50, 'foe', 3, 9, 1), plan: { where: 'stay', square: null } }], { moving: [50] })
  for (let k = 0; k < 150; k++) assert.ok(!stepBattle(holding).some((e) => e.type === 'move'), 'Stay holds')
  const hunting = scene([...party, on('tomb_knight', 50, 'foe', 3, 9, 1)], { moving: [50] })
  assert.ok(stepBattle(hunting).some((e) => e.type === 'move' && e.actor === 50), 'Hunt walks in')
  // A flank to the left wing: the captain at (1,10) with its Ghoul beside it; the square is (0,7).
  const flank = { where: 'move', square: tileAt(0, CAMP_ROWS) }
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 6, 0, 1), { ...on('tomb_knight', 50, 'foe', 1, 10, 1), plan: flank },
    { ...on('grave_ghoul', 51, 'foe', 2, 10, 1), cohortOf: 50, rank: true, plan: flank }], { moving: [50, 51] })
  const c = unit(b, 50)
  const m = unit(b, 51)
  while (!b.events.some((e) => e.type === 'arrive' && e.uid === 50) && b.t < 400) {
    stepBattle(b)
    assert.ok(distance(m.tile, c.tile) <= 2, 'its cohort keeps up')
  }
  assert.ok(distance(c.tile, flank.square) <= 1, 'it arrived at the wing')
  assert.equal(c.where, 'hunt')
  assert.ok(tileX(c.tile) <= 1, 'down the left wing')
})

test('the Sovereign\'s Grave Tide raises two of the field\'s dead on its side: the strongest, then the nearest; foe shadows falter and Arise\'s cap is untouched', () => {
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
  g.tile = g.anchor = unit(b, 54).tile
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
    assert.ok(alive(u) && u.shadow && u.side === 'foe' && falters(b, u))
    assert.ok(ev.some((x) => x.type === 'falter' && x.target === u.uid && x.on))
    assert.equal(u.hp, Math.ceil(baseStats(u.id, u.lvl).hp * TUNING.monarch.raiseHp))
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
    { ...on('hollow_sovereign', 50, 'foe', 3, 7, 1), wave: 2 }, { ...on('grave_ghoul', 51, 'foe', 5, 9, 1), wave: 2, cohortOf: 50, rank: true },
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

test('a Monarch felled by a foe of a later wave is recorded with that wave, under the killer\'s own threat', () => {
  const fell = (wave, id = 'clockwork_page') => {
    const b = scene([on('monarch', 0, 'party', 3, 0), { ...on(id, 50, 'foe', 3, 1, 5), ...(wave && { wave }) }])
    b.monarch.hp = 1
    while (!b.over) stepBattle(b)
    return b.death
  }
  assert.deepEqual([fell(0).threat, fell(0).wave], ['flank', undefined])
  assert.deepEqual([fell(1).threat, fell(1).wave, fell(1).by], ['flank', 1, 'clockwork_page'])
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
  // The reap offers the bodies of every wave's kinds.
  const kinds = new Set(real.map((u) => u.id))
  assert.deepEqual(new Set(s.offers.filter((o) => o.type === 'bind').map((o) => o.id)), kinds)
  assert.equal(s.nextUid, b.nextUid)
})

// A rich run (as run.test.js's strong run) through floors 3 and 4: on the way every legal action applies to a
// copy of the state, the state keeps its uids and slots straight, and every deep battle rebuilt from its setup
// plays out the same (the essence is edited outside the log, so the run itself cannot be replayed: the fuzz
// test seldom gets this deep). The last room is the Sovereign's siege: its waves enter, the Sovereign with its
// court last, and its fall ends the battle.
test('the deep floors play: waves, sieges and the Sovereign\'s court, every legal action applying on the way', () => {
  const run = createRun({ seed: 'rich' })
  const s = run.state
  const rng = createRng(s.seed).stream('autoplay')
  const STEADY = { ...LEVELS.basic, wounds: true, park: false }
  const fought = []
  for (let steps = 0; s.phase !== 'over'; steps++) {
    if (s.essence < 5000) s.essence = 1e5
    const points = monarchPoints(s)
    if (s.floor >= W.floor && steps % 23 === 0) {
      for (const a of legalActions(run).filter((_, i, all) => i % Math.ceil(all.length / 8) === 0)) {
        assert.doesNotThrow(() => apply({ ...run, state: structuredClone(s) }, a), JSON.stringify(a))
      }
    }
    const action = ['map', 'prep'].includes(s.phase) && points < 6 * s.floor ? { type: 'monarch', stat: MONARCH_STATS[points % 3] } : policy(run, rng, STEADY)
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
  assert.equal(s.result, 'victory')
  assert.ok(fought.some((f) => f.floor >= W.floor && f.b.events.some((e) => e.type === 'wave')), 'waves on the deep floors')
  const last = fought.at(-1)
  assert.equal(last.type, 'boss')
  const b = last.b
  assert.deepEqual(b.events.filter((e) => e.type === 'wave').map((e) => e.wave), [1, 2])
  const sov = b.units.find((u) => u.id === 'hollow_sovereign')
  assert.equal(sov.wave, 2)
  assert.ok(b.units.filter((u) => u.cohortOf === sov.uid).length === sp.court, 'its court entered with it')
  assert.deepEqual([b.winner, b.reason], ['party', 'sovereign'])
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

test('the ceiling counts from the last foe to enter: a late wave in the boss room still meets the ramp before it; your reserve pushes neither the ceiling nor the ramp past it', () => {
  // A stalemate: the Monarch in its camp, a Golem at the far edge, another (held where it enters) in the
  // last wave at the latest it can come (30 s after a wave that came at 30 s); a soul of yours enters after it.
  const late = 2 * W.t
  const b = scene([on('monarch', 0, 'party', 3, 0, 20), on('iron_golem', 10, 'foe', 3, 10, 1)], {
    boss: true,
    reserve: [
      { ...makeUnit('grave_ghoul', { uid: 5, lvl: 1 }), det: 1, plan: { where: 'stay', square: null }, when: { at: 'time', t: late + 100 } },
      coming('iron_golem', 20, 2, { at: 'time', t: late }, 0, { plan: { where: 'stay', square: null } })
    ]
  })
  let ramped = 0
  while (!b.over) {
    stepBattle(b)
    if (escalation(b) > 1) ramped++
  }
  const X = TUNING.escalation
  assert.equal(b.foeIn, late)
  assert.equal(b.entered, late + 100, 'your soul entered after it')
  assert.deepEqual([b.winner, b.reason, b.t], [null, 'tick-ceiling', late + TUNING.tick.ceiling])
  // In the boss room your entries never restart the ramp: it has the whole window the last foe left it.
  assert.ok(ramped > 0 && ramped === b.t - (b.foeIn + X.startTick * X.bossMult), `ramped ${ramped} ticks`)
  // Elsewhere your entry restarts the ramp, but never past startTick × bossMult after the last foe entry: a
  // body of yours entering 1500 ticks in (the ramp would start at 2400, the ceiling) leaves it 600 ticks.
  const grind = scene([on('monarch', 0, 'party', 3, 0, 20), on('iron_golem', 10, 'foe', 3, 10, 1)], {
    reserve: [{ ...makeUnit('grave_ghoul', { uid: 5, lvl: 1 }), det: 1, plan: { where: 'stay', square: null }, when: { at: 'time', t: 1500 } }]
  })
  const ramp = []
  while (!grind.over) {
    stepBattle(grind)
    if (escalation(grind) > 1) ramp.push(grind.t)
  }
  assert.deepEqual([grind.foeIn, grind.entered, grind.winner, grind.reason, grind.t], [0, 1500, null, 'tick-ceiling', TUNING.tick.ceiling])
  const after = ramp.filter((t) => t > 1500)
  assert.equal(ramp[0], X.startTick + 1, 'ramped from startTick, before the entry')
  assert.equal(after[0], X.startTick * X.bossMult + 1, 'the entry restarts it, but it ramps again by the boss\'s window after the last foe entry')
  assert.equal(after.length, TUNING.tick.ceiling - X.startTick * X.bossMult)
  // An entry early enough restarts it in full: a body entering at 300 ramps from 300 + startTick.
  const early = scene([on('monarch', 0, 'party', 3, 0, 20), on('iron_golem', 10, 'foe', 3, 10, 1)], {
    reserve: [{ ...makeUnit('grave_ghoul', { uid: 5, lvl: 1 }), det: 1, plan: { where: 'stay', square: null }, when: { at: 'time', t: 300 } }]
  })
  for (let t = 0; t <= 300 + X.startTick; t++) stepBattle(early)
  assert.equal(early.entered, 300)
  assert.equal(escalation(early), 1 + X.perTick)
})
