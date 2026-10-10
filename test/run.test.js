import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRun, apply, legalActions, availableNodes, replay, join, currentNode, fielded, rosterCap, fieldCap,
  MONARCH_UID, monarchOf, souls, domainOf, battleSetup, encounter, drawRoom, roomThreats,
  foeEssence, baseField, inOssuary, OSSUARY, soulCount, canPlace, canFuse, fuseCost, fuseParts, offerGroup, onePick,
  levelOf, kindLevel, commandOf, monarchHp, ariseOf, frontier, tierCost, floorPrice
} from '../src/sim/run.js'
import { createBattle, runBattle } from '../src/sim/battle.js'
import { autoplay, policy, rehearsalBudget, LEVELS, scoreOf, planFor, stackOptions } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { generateFloor } from '../src/sim/map.js'
import { TUNING } from '../src/tuning.js'
import { tuned, FIRST_BALANCE, LEVEL_A_TIER } from './tuned.js'
import { RELICS, UNITS, UNIT_LIST, TRACKS, FUSION_LIST, CAMP_LIST } from '../src/content.js'
import {
  CAMP_SLOTS, COLS, campOpen, isWall, abilitiesOf, auraOf, statsOf, slotAt, rowOf, colOf, baseStats, makeUnit, canTrack, bodyHp,
  bodiesHp, livingBodies, sizeOf, footprintSlots, fits, monarchSlot, isMonarchCell
} from '../src/sim/unit.js'
import { visit, win } from './rooms.js'

const play = (seed) => autoplay(createRun({ seed }), { rng: createRng(seed).stream('autoplay') })

// On to the next floor, as if the player had just left the last room of this one (the state set outside the log:
// a run made so is rebuilt by doing the same, not by replay).
function nextFloor (run) {
  Object.assign(run.state, { at: run.state.map.end, phase: 'reap', offers: [] })
  apply(run, { type: 'reap', index: null })
}

// The camp cells a fielded piece covers (the Monarch: its seat), and whether every fielded piece stands wholly on
// open ground of the camp, none on another's cells, and only the Monarch on the seat.
const cellsOf = (u) => (u.uid === MONARCH_UID ? [u.slot] : footprintSlots(u.slot, sizeOf(u)))
function checkField (s) {
  const seen = new Set()
  for (const u of s.party.filter((x) => x.slot >= 0)) {
    const cells = cellsOf(u)
    assert.ok(cells && cells.every((c) => campOpen(s.camp, c) && !seen.has(c) && isMonarchCell(s.camp, c) === (u.uid === MONARCH_UID)),
      `${u.id} ${u.uid} at ${u.slot} (size ${sizeOf(u)}) in ${s.camp}`)
    for (const c of cells) seen.add(c)
  }
}
// The cells the fielded pieces but `except` cover.
const takenBy = (s, except = []) => new Set(s.party.filter((u) => u.slot >= 0 && !except.includes(u)).flatMap(cellsOf))
// The first open camp cell no piece covers.
const firstFree = (s) => [...Array(CAMP_SLOTS).keys()].find((c) => campOpen(s.camp, c) && !takenBy(s).has(c))

// A kind of size 2 that a run may hold (a fused kind), and a kind's track whose tier IV is a Colossus tier.
const BIG = UNIT_LIST.find((u) => u.size === 2 && !u.boss).id
const [COLOSSUS, COLOSSUS_TRACK] = Object.entries(TRACKS).flatMap(([id, tracks]) => tracks.map((t, k) => [id, k, t])).find(([, , t]) => t.tiers[3].size === 2) ?? []

test('a new run: the Monarch and the start retinue at their first level on floor 1, all fielded, every battle room scouted', () => {
  const run = createRun({ seed: 'new' })
  const s = run.state
  const first = TUNING.level.base
  assert.deepEqual(s.party.map((u) => [u.id, u.lvl, u.uid]), [['monarch', 0, MONARCH_UID], ['tomb_knight', first, 1], ['bone_chanter', first, 2], ['frost_sprite', first, 3]])
  assert.equal(new Set(s.party.map((u) => u.slot)).size, 4)
  assert.ok(s.party.every((u) => u.slot >= 0))
  assert.deepEqual([s.death, fielded(souls(s.party)).length, fieldCap(run), commandOf(s)], [null, 3, 3, TUNING.party.field])
  assert.ok(!('monarch' in s), 'no Monarch points')
  assert.deepEqual([monarchOf(s).maxHp, monarchHp(s)], [TUNING.monarch.hp, TUNING.monarch.hp])
  assert.equal(s.phase, 'map')
  assert.equal(s.at, s.map.start)
  assert.ok(availableNodes(run).length >= 2)
  for (const n of s.map.nodes) {
    assert.equal(!!n.foes, ['fight', 'elite', 'boss'].includes(n.type), n.id)
    if (n.foes) assert.equal(new Set(n.foes.map((f) => f.slot)).size, n.foes.length, `${n.id} slots`)
  }
})

test('apply refuses illegal actions and leaves the log alone', () => {
  const run = createRun({ seed: 'illegal' })
  const [a] = souls(run.state.party)
  const wall = [...Array(CAMP_SLOTS).keys()].find((slot) => isWall(run.state.camp, slot))
  assert.ok(wall >= 0, 'every camp has a wall')
  const bad = [
    null, { type: 'dance' }, { type: 'node', id: run.state.map.end }, { type: 'reap', index: 0 }, { type: 'fight' },
    { type: 'place', uid: a.uid, slot: CAMP_SLOTS }, { type: 'place', uid: a.uid, slot: a.slot }, { type: 'place', uid: 999, slot: 3 },
    { type: 'place', uid: a.uid, slot: wall }, { type: 'place', uid: a.uid, slot: 1.5 },
    { type: 'order', uid: a.uid, order: 'advance' },
    { type: 'release', uid: 999 },
    { type: 'place', uid: MONARCH_UID, slot: -1 }, { type: 'release', uid: MONARCH_UID },
    { type: 'place', uid: MONARCH_UID, slot: [...Array(CAMP_SLOTS).keys()].find((c) => campOpen(run.state.camp, c) && !takenBy(run.state).has(c)) },
    { type: 'place', uid: a.uid, slot: monarchSlot(run.state.camp) },
    { type: 'line', uid: a.uid, tiles: [0] }, { type: 'fuse', id: 'nothing', parts: [] }, { type: 'fuse', id: FUSION_LIST[0].id, parts: [{ uid: a.uid, n: 1 }] },
    { type: 'monarch', stat: 'hp' }, { type: 'monarch', stat: 'command' }, { type: 'monarch' }, { type: 'level', kind: 'tomb_knight' }
  ]
  for (const action of bad) assert.throws(() => apply(run, action), undefined, JSON.stringify(action))
  assert.deepEqual(run.state.log, [])
})

test('legalActions per phase', () => {
  const run = createRun({ seed: 'legal' })
  const kinds = (r) => [...new Set(legalActions(r).map((a) => a.type))].sort()
  // A fuse for each recipe the start retinue can make (none, if no recipe is made of one of each start kind).
  const fuses = (r) => (FUSION_LIST.some((f) => canFuse(r, f.id)) ? ['fuse'] : [])
  run.state.essence = 0
  assert.deepEqual(kinds(run), ['node', 'place', 'release'])
  run.state.essence = 1000
  // Essence buys tiers (and fusions): no level, nothing for the Monarch, Arise held or not.
  assert.deepEqual(kinds(run), [...fuses(run), 'node', 'place', 'release', 'upgrade'].sort())
  run.state.relics.push('arise')
  assert.deepEqual(kinds(run), [...fuses(run), 'node', 'place', 'release', 'upgrade'].sort())
  run.state.relics = []
  assert.ok(!legalActions(run).some((a) => a.uid === MONARCH_UID && ['upgrade', 'release', 'place'].includes(a.type)), 'the Monarch is never placed')
  assert.ok(!legalActions(run).some((a) => a.type === 'place' && a.slot === monarchSlot(run.state.camp)), 'nor anything on its seat')
  run.state.essence = 0
  visit(run, 'fight')
  assert.equal(run.state.phase, 'prep')
  assert.deepEqual(kinds(run), ['fight', 'place', 'release'])
  apply(run, { type: 'fight' })
  if (run.state.phase === 'over') return
  // Poor, a recruit is out of reach: moving on (or letting a soul go) is all there is.
  assert.deepEqual(kinds(run), ['reap', 'release'])
  assert.ok(legalActions(run).some((a) => a.type === 'reap' && a.index === null))
})

test('fight resolves the battle against the scouted foes, and run.setup replays it exactly', () => {
  const run = createRun({ seed: 'scout' })
  const node = visit(run, 'fight')
  apply(run, { type: 'fight' })
  const foes = run.battle.units.filter((u) => u.side === 'foe')
  const bySlot = (a, b) => a.slot - b.slot
  assert.deepEqual(foes.sort(bySlot).map((u) => [u.id, u.lvl, u.slot]), node.foes.slice().sort(bySlot).map((f) => [f.id, f.lvl, f.slot]))
  assert.ok(run.battle.over)
  assert.notEqual(run.state.phase, 'prep')
  const again = createBattle(run.setup)
  runBattle(again)
  assert.deepEqual(again.events, run.battle.events)
})

test('place: field slots swap, the ossuary holds souls back, and the field has a cap', () => {
  const run = createRun({ seed: 'place' })
  const [knight, chanter] = souls(run.state.party)
  const a = knight.slot
  const b = chanter.slot
  apply(run, { type: 'place', uid: knight.uid, slot: b })
  assert.equal(knight.slot, b)
  assert.equal(chanter.slot, a)
  apply(run, { type: 'place', uid: knight.uid, slot: OSSUARY })
  assert.deepEqual([knight.slot, OSSUARY], [-1, -1])
  assert.deepEqual(inOssuary(souls(run.state.party)), [knight])
  assert.equal(fielded(souls(run.state.party)).length, 2)
  while (souls(run.state.party).length < 8) join(run, 'clockwork_page')
  assert.equal(fielded(souls(run.state.party)).length, TUNING.party.field, 'new souls fill the field, then the ossuary')
  const free = [...Array(CAMP_SLOTS).keys()].find((slot) => campOpen(run.state.camp, slot) && !run.state.party.some((u) => u.slot === slot))
  assert.throws(() => apply(run, { type: 'place', uid: knight.uid, slot: free }), /cannot place/)
  apply(run, { type: 'place', uid: knight.uid, slot: chanter.slot })
  assert.equal(knight.slot, a)
  assert.equal(chanter.slot, -1, 'a soul from the ossuary swaps with the one it replaces')
})

test('each floor draws a camp from its own list: the Monarch takes its seat, and the fielded pieces its default frontier (or the ossuary, with no room)', () => {
  const seen = new Set()
  for (let i = 0; i < 30; i++) {
    const run = createRun({ seed: 'camp' + i })
    assert.equal(CAMP_LIST.find((c) => c.id === run.state.camp).floor, 1)
    seen.add(run.state.camp)
  }
  assert.equal(seen.size, CAMP_LIST.filter((c) => c.floor === 1).length, 'every floor-1 camp turns up')
  // Floor by floor, with a full field and a 2×2 on it: each camp from its floor's list, the Monarch on its 'M', and
  // every piece wholly on open ground, where the new camp's frontier puts it (or waiting in the ossuary).
  const floors = new Set()
  for (let i = 0; i < 12; i++) {
    const run = createRun({ seed: 'walls' + i })
    const s = run.state
    command(run, 3)
    const big = join(run, BIG)
    for (const u of [join(run, 'grave_ghoul'), join(run, 'clockwork_page')]) if (u.slot === OSSUARY && canPlace(run, u, firstFree(s))) apply(run, { type: 'place', uid: u.uid, slot: firstFree(s) })
    assert.ok(big.slot >= 0, 'the 2×2 fielded')
    for (let floor = 2; floor <= TUNING.run.floors + 1; floor++) {
      const pieces = souls(s.party).length
      nextFloor(run)
      assert.equal(s.floor, floor)
      assert.equal(CAMP_LIST.find((c) => c.id === s.camp).floor, Math.min(floor, TUNING.run.floors))
      assert.equal(monarchOf(s).slot, monarchSlot(s.camp))
      checkField(s)
      assert.deepEqual(fielded(souls(s.party)).map((u) => u.slot), frontier(s.camp, fielded(souls(s.party))), 'on the frontier')
      assert.equal(souls(s.party).length, pieces, 'no piece lost')
      floors.add(s.camp)
    }
  }
  assert.ok(floors.size > 3, [...floors].join())
})

test('a camp drawn again on the next floor (the deep reuses the last floor\'s few) keeps the layout the player gave it there', () => {
  // Floor by floor into the deep, a soul moved off its frontier cell each floor: where the next floor draws another
  // camp, the pieces take its frontier; where it draws the same, they keep the cells they stood on.
  const run = createRun({ seed: 'same-camp' })
  const s = run.state
  let same = 0
  for (let floor = 2; floor <= TUNING.run.floors + 10; floor++) {
    const mover = fielded(souls(s.party))[1]
    const cell = [...Array(CAMP_SLOTS).keys()].reverse().find((c) => !takenBy(s).has(c) && canPlace(run, mover, c))
    apply(run, { type: 'place', uid: mover.uid, slot: cell })
    const before = { camp: s.camp, slots: fielded(souls(s.party)).map((u) => u.slot) }
    nextFloor(run)
    checkField(s)
    const now = fielded(souls(s.party)).map((u) => u.slot)
    if (s.camp !== before.camp) {
      assert.deepEqual(now, frontier(s.camp, fielded(souls(s.party))), `floor ${floor}: a new camp's frontier`)
      continue
    }
    same++
    assert.notDeepEqual(before.slots, frontier(s.camp, fielded(souls(s.party))), 'the mover off its frontier cell')
    assert.deepEqual(now, before.slots, `floor ${floor}: the same camp, the same cells`)
  }
  assert.ok(same > 0, 'a camp drawn twice running')
})


test('release never lets go of the last soul standing (the Monarch does not count), nor of the Monarch', () => {
  const run = createRun({ seed: 'release' })
  const m = monarchOf(run.state)
  const [a, b, c] = souls(run.state.party)
  a.hp = 0
  b.hp = 0
  assert.throws(() => apply(run, { type: 'release', uid: c.uid }))
  assert.throws(() => apply(run, { type: 'release', uid: MONARCH_UID }))
  apply(run, { type: 'release', uid: a.uid })
  assert.deepEqual(run.state.party, [m, b, c])
})

test('prep: the Monarch alone may fight; a fight with no one standing may not', () => {
  const run = createRun({ seed: 'standing' })
  visit(run, 'fight')
  const [a, b, c] = souls(run.state.party)
  a.hp = 0
  apply(run, { type: 'place', uid: b.uid, slot: -1 })
  apply(run, { type: 'place', uid: c.uid, slot: -1 })
  assert.ok(legalActions(run).some((x) => x.type === 'fight'), 'the Monarch still stands')
  monarchOf(run.state).hp = 0
  assert.ok(!legalActions(run).some((x) => x.type === 'fight'))
  assert.throws(() => apply(run, { type: 'fight' }), /nobody standing/)
})

test('altar heals everyone and raises the fallen', () => {
  const run = createRun({ seed: 'altar' })
  const [a, b] = run.state.party
  a.hp = 1
  b.hp = 0
  visit(run, 'altar')
  assert.equal(run.state.phase, 'map')
  assert.equal(a.hp, a.maxHp)
  assert.equal(b.hp, Math.ceil(b.maxHp * TUNING.run.altarRevive))
})

// DESIGN §2.2: a piece whose every body fell leaves the field as the battle ends: it lies fallen in the ossuary, its
// cell and its Command free, and nothing fields it until an altar raises it. It still stacks, fuses and is released.
test('a piece that falls in a won battle goes to the ossuary: its cell and Command free, never placed, until an altar raises it', () => {
  const won = (() => {
    for (let i = 0; i < 200; i++) {
      const run = createRun({ seed: 'fallen' + i })
      apply(run, { type: 'node', id: availableNodes(run)[0].id })
      apply(run, { type: 'fight' })
      if (run.state.phase === 'reap' && souls(run.state.party).some((u) => u.hp <= 0)) return run
    }
    assert.fail('no seed felled a soul in a won first fight')
  })()
  const s = won.state
  const u = souls(s.party).find((x) => x.hp <= 0)
  const cell = won.setup.party.find((x) => x.uid === u.uid).slot
  assert.ok(cell >= 0, 'it fought from a cell')
  assert.equal(u.slot, OSSUARY)
  assert.ok(inOssuary(souls(s.party)).includes(u) && !fielded(s.party).includes(u))
  assert.ok(!fielded(s.party).some((v) => (footprintSlots(v.slot, sizeOf(v)) ?? []).includes(cell)), 'its cell free')
  assert.equal(fielded(souls(s.party)).length, won.setup.party.filter((x) => x.uid !== MONARCH_UID).length - souls(s.party).filter((x) => x.hp <= 0).length, 'its Command free')
  // Nothing places it: no camp cell takes it, no action offers one; it may still be released.
  assert.ok([...Array(CAMP_SLOTS).keys()].every((slot) => !canPlace(won, u, slot)))
  assert.ok(!legalActions(won).some((a) => a.type === 'place' && a.uid === u.uid && a.slot >= 0))
  assert.ok(legalActions(won).some((a) => a.type === 'release' && a.uid === u.uid))
  assert.throws(() => apply(won, { type: 'place', uid: u.uid, slot: cell }))
  // The run replays to the same retinue: the fall is the battle's, and the battle is the log's.
  apply(won, { type: 'reap', index: null })
  assert.deepEqual(replay(s.seed, s.log).state.party, s.party)
  // A soul of its kind on the field: the fallen one stacks onto it, a body down in its pool, and splits off again only
  // to the ossuary (a piece of the fallen alone is fielded nowhere).
  const kin = join(won, u.id)
  assert.ok(kin.slot >= 0)
  apply(won, { type: 'stack', uid: u.uid, onto: kin.uid })
  assert.deepEqual([kin.count, livingBodies(kin)], [2, 1])
  assert.ok(!legalActions(won).some((a) => a.type === 'split' && a.uid === kin.uid && a.slot >= 0))
  apply(won, { type: 'split', uid: kin.uid, n: 1 })
  const again = s.party.at(-1)
  assert.deepEqual([again.hp, again.slot], [0, OSSUARY])
  // An altar raises it where it lies, in the ossuary; then it may be placed.
  visit(won, 'altar')
  assert.deepEqual([again.hp, again.slot], [Math.ceil(again.maxHp * TUNING.run.altarRevive), OSSUARY])
  assert.ok([...Array(CAMP_SLOTS).keys()].some((slot) => canPlace(won, again, slot)))
})

test('a reliquary (the rite merged into it) offers distinct relics and free next tiers, no Legendary on floor 1, one pick in all; taking one keeps it and ends the room, skipping takes nothing', () => {
  const run = createRun({ seed: 'gold' })
  const s = run.state
  visit(run, 'reliquary')
  const offers = s.offers.slice()
  assert.equal(s.phase, 'reap')
  assert.ok(onePick(run))
  const relics = offers.filter((o) => o.type === 'relic')
  const tiers = offers.filter((o) => o.type === 'tier')
  assert.equal(relics.length, TUNING.relic.offer.reliquary)
  assert.ok(relics.every((o) => RELICS[o.id] && o.tier === RELICS[o.id].tier && o.tier !== 'legendary'))
  assert.equal(new Set(relics.map((o) => o.id)).size, relics.length)
  assert.equal(tiers.length, Math.min(TUNING.relic.offer.tiers, 3), 'a tier for each start kind')
  assert.ok(tiers.every((o) => canTrack(s.kinds[o.kind].tracks, o.track)))
  assert.equal(new Set(tiers.map((o) => o.kind)).size, tiers.length)
  assert.deepEqual(offers.map((o) => o.type), [...relics.map(() => 'relic'), ...tiers.map(() => 'tier')], 'its relics, then its tiers')
  // A relic: kept; the tiers go with the others.
  apply(run, { type: 'reap', index: 1 })
  assert.deepEqual([s.relics, s.offers, s.phase], [[offers[1].id], [], 'map'])
  // A tier: free, the kind's every soul holds it (and the level it gives); the relics go.
  visit(run, 'reliquary')
  const index = s.offers.findIndex((o) => o.type === 'tier')
  const o = s.offers[index]
  const essence = s.essence
  apply(run, { type: 'reap', index })
  const tracks = [0, 0].map((x, i) => (i === o.track ? 1 : 0))
  assert.deepEqual([s.kinds[o.kind].tracks, s.party.find((x) => x.id === o.kind).tracks, s.kinds[o.kind].lvl, s.essence, s.relics.length, s.phase],
    [tracks, tracks, levelOf({ tracks }), essence, 1, 'map'])
  // Skipping takes nothing.
  visit(run, 'reliquary')
  apply(run, { type: 'reap', index: null })
  assert.equal(s.relics.length, 1)
  // From floor 2 its Legendaries come too, in the same one pick.
  s.floor = 2
  visit(run, 'reliquary')
  assert.equal(s.offers.filter((x) => offerGroup(x) === 'legendary').length, TUNING.relic.legendary.offer)
  assert.ok(s.offers.some((x) => x.type === 'tier') && s.offers.some((x) => offerGroup(x) === 'relic'))
  apply(run, { type: 'reap', index: s.offers.findIndex((x) => offerGroup(x) === 'legendary') })
  assert.deepEqual([s.relics.length, s.offers, s.phase], [2, [], 'map'])
  // No room is a rite any more, on any floor.
  for (let floor = 1; floor <= TUNING.run.floors; floor++) assert.ok(!generateFloor({ seed: 'gold', floor }).nodes.some((n) => n.type === 'rite'))
})

test('a won fight pays essence and puts one soul per kind slain up for sale; one may be recruited', () => {
  const run = win('fight')
  const s = run.state
  const slain = run.battle.units.filter((u) => u.side === 'foe' && u.hp <= 0)
  const sale = s.offers.filter((o) => o.type === 'soul')
  assert.deepEqual(new Set(sale.map((o) => o.id)), new Set(slain.map((u) => u.id)))
  assert.ok(sale.every((o) => o.cost > 0 && o.lvl === kindLevel(s, o.id)), 'each at its kind\'s level, not the level it fought at')
  assert.deepEqual(s.offers.map((o) => o.type), sale.map(() => 'soul'), 'souls only: nothing to bind')
  assert.ok(s.essence > TUNING.essence.start && s.stats.essence === s.essence - TUNING.essence.start)
  assert.ok(souls(s.party).every((u) => u.lvl === TUNING.level.base), 'no XP: levels only rise with tiers')
  s.essence = 0
  assert.ok(!legalActions(run).some((a) => a.type === 'reap' && a.index !== null), 'recruits cost essence')
  assert.throws(() => apply(run, { type: 'reap', index: 0 }), /not enough essence/)
  s.essence = 1000
  const before = s.party.length
  const soul = s.offers[0]
  apply(run, { type: 'reap', index: 0 })
  assert.equal(s.party.length, before + 1)
  assert.deepEqual([s.party.at(-1).id, s.party.at(-1).lvl], [soul.id, soul.lvl])
  assert.equal(s.essence, 1000 - soul.cost)
  assert.equal(s.stats.reaped, 1)
  assert.ok(!s.offers.some((o) => o.type === 'soul'), 'one recruit per battle')
  // A full soul: its kind's level and tiers, on the field if there is room or else in the ossuary.
  const got = s.party.at(-1)
  assert.deepEqual([got.lvl, got.tracks, got.hp === got.maxHp], [s.kinds[got.id].lvl, s.kinds[got.id].tracks, true])
  assert.equal(s.phase, 'map', 'a fight\'s spoils were its souls: the room ends')
  checkState(s)
})

test('essence buys a kind its track tiers, and with them its level; never a level alone', () => tuned(LEVEL_A_TIER, () => {
  const run = createRun({ seed: 'buy' })
  const s = run.state
  const knight = s.party.find((u) => u.id === 'tomb_knight')
  s.essence = 5000
  assert.throws(() => apply(run, { type: 'level', kind: 'tomb_knight' }), /unknown action "level"/)
  assert.throws(() => apply(run, { type: 'upgrade', kind: 'monarch', track: 0 }), /cannot upgrade/)
  const hp = knight.maxHp
  const def = statsOf({ ...knight, tracks: [0, 0] }).def
  apply(run, { type: 'upgrade', kind: 'tomb_knight', track: 0 })
  assert.deepEqual([knight.tracks, knight.lvl, s.kinds.tomb_knight.lvl, s.essence], [[1, 0], levelOf({ tracks: [1, 0] }), levelOf({ tracks: [1, 0] }), 5000 - TUNING.essence.tier[0]])
  assert.ok(knight.maxHp > hp && knight.hp === knight.maxHp, 'the level the tier gives raises its HP, healed by the gain')
  assert.ok(statsOf(knight).def > def, 'Bulwark I (and the level) raise DEF')
  apply(run, { type: 'upgrade', kind: 'tomb_knight', track: 1 })
  apply(run, { type: 'upgrade', kind: 'tomb_knight', track: 0 })
  apply(run, { type: 'upgrade', kind: 'tomb_knight', track: 0 })
  assert.deepEqual(knight.tracks, [3, 1])
  assert.equal(auraOf(knight).range, 2, 'Bulwark III widens its aura')
  apply(run, { type: 'upgrade', kind: 'tomb_knight', track: 1 })
  assert.throws(() => apply(run, { type: 'upgrade', kind: 'tomb_knight', track: 1 }), /cannot upgrade/, 'Reaver stops at II beside Bulwark III')
  assert.ok(!legalActions(run).some((a) => a.type === 'upgrade' && a.kind === 'tomb_knight' && a.track === 1))
  for (let i = 0; i < 3; i++) apply(run, { type: 'upgrade', kind: 'frost_sprite', track: 0 })
  assert.deepEqual(abilitiesOf(s.party.find((u) => u.id === 'frost_sprite')), ['shatter_lance'])
  assert.equal(s.stats.spent, 5000 - s.essence)
}))

test('releasing the last soul of a kind in a reliquary withdraws its kind\'s tier, and a reliquary left with nothing ends', () => {
  const run = createRun({ seed: 'rite-release' })
  const s = run.state
  join(run, s.party[1].id)
  visit(run, 'reliquary')
  const ofKind = (kind) => s.party.filter((u) => u.id === kind)
  const tiers = s.offers.filter((o) => o.type === 'tier')
  const [first, ...rest] = tiers
  const all = s.offers.slice()
  // A second soul of the kind keeps the offer; the last one takes it away; the relics stay.
  if (ofKind(first.kind).length > 1) {
    apply(run, { type: 'release', uid: ofKind(first.kind)[0].uid })
    assert.deepEqual(s.offers, all)
  }
  apply(run, { type: 'release', uid: ofKind(first.kind)[0].uid })
  assert.deepEqual(s.offers, all.filter((o) => o !== first))
  for (const o of rest) for (const u of ofKind(o.kind)) if (souls(s.party).length > 1) apply(run, { type: 'release', uid: u.uid })
  assert.ok(s.offers.every((o) => o.type === 'relic' || ofKind(o.kind).length))
  // With only tiers laid out, the last kind's release ends the room.
  s.offers = s.offers.filter((o) => o.type === 'tier')
  for (const o of s.offers.slice()) for (const u of ofKind(o.kind)) if (souls(s.party).length > 1) apply(run, { type: 'release', uid: u.uid })
  assert.equal(s.phase, s.offers.length ? 'reap' : 'map')
})

test('a full retinue must release a soul before it can recruit', () => {
  const run = win('full')
  const s = run.state
  s.essence = 1e5
  while (soulCount(s.party) < rosterCap(run)) join(run, 'clockwork_page')
  assert.ok(!legalActions(run).some((a) => a.type === 'reap' && a.index !== null))
  assert.throws(() => apply(run, { type: 'reap', index: 0 }), /release a soul first/)
  const kept = s.party.find((u) => u.slot < 0)
  apply(run, { type: 'release', uid: kept.uid })
  assert.equal(s.phase, 'reap')
  apply(run, { type: 'reap', index: 0 })
  assert.equal(soulCount(s.party), rosterCap(run))
})

// Rules of thumb lose on floor 1 most of the time: the basic player is the one floor 1 is built to kill.
test('autoplay finishes 20 seeded runs with a sane final state, and each defeat says what felled the Monarch', () => {
  const results = { victory: 0, defeat: 0 }
  for (let i = 0; i < 20; i++) {
    const s = play('auto' + i).state
    assert.equal(s.phase, 'over')
    results[s.result]++
    checkState(s)
    assert.ok(s.stats.wins <= s.stats.fights)
    if (s.result === 'victory') assert.equal(s.stats.floorsCleared, TUNING.run.floors)
    if (s.result === 'defeat') {
      assert.ok(s.death && ['monarch', 'tick-ceiling'].includes(s.death.reason), JSON.stringify(s.death))
      // Always the killer's kind's first threat; a foe of a later wave (a late pair) also records its wave.
      if (s.death.reason === 'monarch') {
        assert.ok(UNITS[s.death.by] && Number.isInteger(s.death.from), JSON.stringify(s.death))
        assert.equal(s.death.threat, UNITS[s.death.by].threats[0], JSON.stringify(s.death))
        assert.ok(s.death.wave === undefined || s.death.wave >= 1, JSON.stringify(s.death))
      }
    } else assert.equal(s.death, null)
  }
  assert.ok(results.defeat > 0, JSON.stringify(results))
})

test('the autoplayer uses the choices a player has: every piece where its footprint fits, the Monarch on its seat', () => {
  const check = (b, r) => {
    const taken = new Set()
    for (const u of r.setup.party) {
      if (u.uid === MONARCH_UID) {
        assert.equal(u.slot, monarchSlot(r.setup.camp))
        continue
      }
      assert.ok(fits(r.setup.camp, u.slot, sizeOf(u), taken), `${u.id} on ${u.slot} in ${r.setup.camp}`)
      for (const c of footprintSlots(u.slot, sizeOf(u))) taken.add(c)
    }
  }
  for (let i = 0; i < 4; i++) autoplay(createRun({ seed: 'plans' + i }), { onBattle: check })
  // The expert also trades souls with the ossuary; one floor of it.
  const run = createRun({ seed: 'plans-expert' })
  const rng = createRng('plans-expert').stream('autoplay')
  while (run.state.floor === 1 && run.state.phase !== 'over') {
    const action = policy(run, rng, 'expert')
    apply(run, action)
    if (action.type === 'fight') check(run.battle, run)
  }
})

// The Monarch is the camp's (DESIGN §2.1): neither level ever places it, and it fights from its seat. Nothing is
// bought for it: its HP and Command are relics.
test('the autoplayer and the Monarch: neither level moves it from its seat, nor buys it anything', () => {
  const seated = (b, r) => assert.equal(r.setup.party.find((u) => u.uid === MONARCH_UID).slot, monarchSlot(r.setup.camp), `${r.state.seed} floor ${b.floor}`)
  for (let i = 0; i < 4; i++) {
    const run = autoplay(createRun({ seed: 'park' + i }), { onBattle: seated })
    assert.ok(!run.state.log.some((a) => (a.type === 'place' && a.uid === MONARCH_UID) || a.type === 'monarch' || a.type === 'level'))
  }
  const run = createRun({ seed: 'monarch-expert3' })
  const rng = createRng('monarch-expert3').stream('autoplay')
  while (run.state.floor === 1 && run.state.phase !== 'over') {
    const action = policy(run, rng, 'expert')
    assert.ok(!(action.type === 'place' && action.uid === MONARCH_UID) && !['monarch', 'level'].includes(action.type), JSON.stringify(action))
    apply(run, action)
    if (action.type === 'fight') seated(run.battle, run)
  }
})

// The plan is carried out from wherever the player left the pieces: the souls it leaves out to the ossuary, every
// other piece (a 2×2 too) to its planned cell, the Monarch never moved.
test('the autoplayer carries out its plan before it fights: every piece in its planned cell, a 2×2 piece too, from wherever it was left', () => {
  for (const level of ['basic', 'expert']) {
    const run = createRun({ seed: 'prep' })
    const s = run.state
    visit(run, 'fight')
    command(run, 2)
    const colossus = join(run, 'bone_colossus')
    join(run, 'grave_ghoul')
    assert.equal(sizeOf(colossus), 2)
    // Every soul shuffled: the first to the ossuary, the rest to the cells their footprint fits from the back.
    const order = souls(s.party)
    for (const u of order) apply(run, { type: 'place', uid: u.uid, slot: OSSUARY })
    for (const u of order.slice(1)) {
      const slot = [...Array(CAMP_SLOTS).keys()].reverse().find((x) => canPlace(run, u, x) && !s.party.some((v) => v !== u && v.slot >= 0 && footprintSlots(x, sizeOf(u)).some((c) => (footprintSlots(v.slot, sizeOf(v)) ?? [v.slot]).includes(c))))
      if (slot !== undefined) apply(run, { type: 'place', uid: u.uid, slot })
    }
    const rng = createRng('prep').stream('autoplay')
    for (let action; (action = policy(run, rng, level)).type !== 'fight';) {
      assert.ok(!(action.type === 'place' && action.uid === MONARCH_UID), `${level}: ${JSON.stringify(action)}`)
      apply(run, action)
    }
    const plan = planFor(run, LEVELS[level])
    assert.equal(monarchOf(s).slot, monarchSlot(s.camp), `${level}: the Monarch on its seat`)
    for (const p of plan) assert.equal(s.party.find((u) => u.uid === p.uid).slot, p.slot, `${level}: uid ${p.uid}`)
    assert.ok(plan.some((p) => p.uid === colossus.uid && p.slot >= 0), `${level}: the 2×2 piece is fielded`)
    assert.deepEqual(fielded(souls(s.party)).map((u) => u.uid).sort(), plan.filter((p) => p.uid !== MONARCH_UID && p.slot >= 0).map((p) => p.uid).sort())
  }
})

// The expert weighs a Command relic as it weighs any relic, by rehearsing the fights ahead with the run holding it:
// with two souls waiting it beats a relic that changes no battle (Binding Chain: a recruit's price); with none
// waiting, the place it adds is filled by a body split off a stack, as the expert would. It fields its strongest
// souls, so a soul waits only behind souls as strong: here a fresh run's five, each at its kind's level, for three
// places, against floor 1's fights ahead, where the fourth piece is the difference between losing rooms and winning.
test('the expert weighs a Command relic by rehearsal: the place it adds for souls that wait beats a relic that changes no battle', () => {
  const rng = createRng('wish').stream('autoplay')
  const offers = [{ type: 'relic', id: 'binding_chain', tier: 'common', name: '', desc: '' }, { type: 'relic', id: 'grave_banner', tier: 'rare', name: '', desc: '' }]
  const waiting = createRun({ seed: 'wish' })
  visit(waiting, 'fight')
  for (const id of ['grave_ghoul', 'frost_sprite']) join(waiting, id)
  assert.equal(new Set(souls(waiting.state.party).map((u) => u.lvl)).size, 1, 'the souls waiting as strong as those fielded')
  assert.deepEqual([fieldCap(waiting), souls(waiting.state.party).filter((u) => u.slot < 0).length], [3, 2])
  Object.assign(waiting.state, { phase: 'reap', offers: offers.slice() })
  assert.deepEqual(policy(waiting, rng, 'expert'), { type: 'reap', index: 1 })
  apply(waiting, { type: 'reap', index: 1 })
  assert.equal(fieldCap(waiting), 4)
})

// Basic takes the first free offer, whatever it is: a Command relic too, and then it fields a soul that waited.
test('basic takes the first free offer, a Command relic too, and fields the souls waiting for the place it adds', () => {
  const b = createRun({ seed: 'command' })
  const s = b.state
  const rng = createRng('command').stream('autoplay')
  join(b, 'grave_ghoul')
  join(b, 'grave_ghoul')
  Object.assign(s, { phase: 'reap', offers: [{ type: 'relic', id: 'grave_banner', tier: 'rare', name: '', desc: '' }, { type: 'relic', id: 'whetstone', tier: 'common', name: '', desc: '' }] })
  assert.deepEqual(policy(b, rng, 'basic'), { type: 'reap', index: 0 })
  apply(b, { type: 'reap', index: 0 })
  assert.deepEqual([s.relics, s.phase], [['grave_banner'], 'map'])
  visit(b, 'fight')
  for (let action; (action = policy(b, rng, 'basic')).type !== 'fight';) apply(b, action)
  assert.deepEqual([fieldCap(b), fielded(souls(s.party)).length, soulCount(s.party)], [4, 4, 5])
})

test('a rehearsal scores a fallen Monarch as a loss, whoever else stands, a win by what it keeps after the heal, and leaves shadows out', () => {
  const on = (id, uid, side, slot, lvl = 3) => ({ ...makeUnit(id, { uid, lvl }), side, slot })
  // The Monarch in front, its soul held at the back; a Wisp out-shoots it.
  const lost = createBattle({ party: [on('monarch', 0, 'party', slotAt(0, 3)), on('tomb_knight', 1, 'party', slotAt(6, 0), 9)], foes: [on('will_o_wisp', 10, 'foe', slotAt(0, 3), 9)], seed: 's' })
  runBattle(lost)
  assert.deepEqual([lost.winner, lost.reason], ['foe', 'monarch'])
  assert.ok(lost.units.find((u) => u.uid === 1).hp > 0 && scoreOf(lost) <= -3 && scoreOf(lost) >= -4, 'a loss weighs more than any win')
  // A ring-1 foe, which walks into the Knight's ring (a ring-2 Ghoul would strike it from out of its reach, for good).
  const won = createBattle({ party: [on('monarch', 0, 'party', slotAt(3, 3)), on('tomb_knight', 1, 'party', slotAt(0, 3), 9)], foes: [on('clockwork_page', 10, 'foe', slotAt(0, 3), 1)], seed: 's' })
  runBattle(won)
  assert.equal(won.winner, 'party')
  // A win by what the run keeps after the battle's heal: the souls' share by their bodies, twice the Monarch's.
  const kept = won.units.find((u) => u.uid === 1)
  const heal = TUNING.run.postBattleHeal
  const after = (u, n) => Math.min(1, u.hp / u.maxHp + heal / n)
  const expect = 1 + (2 * after(kept, kept.count) + after(won.monarch, 1)) / 3
  won.units.push({ side: 'party', shadow: true, hp: 0, maxHp: 500 })
  assert.ok(Math.abs(scoreOf(won) - expect) < 1e-9)
  // A Monarch left at a quarter keeps the heal on top; under Court of Bone, where nothing heals it after the battle
  // either, it keeps only the quarter.
  won.monarch.hp = won.monarch.maxHp / 4
  const healed = 1 + (2 * after(kept, kept.count) + 0.25 + heal) / 3
  assert.ok(Math.abs(scoreOf(won) - healed) < 1e-9)
  won.held = { ...won.held, unhealable: true }
  assert.ok(Math.abs(scoreOf(won) - (1 + (2 * after(kept, kept.count) + 0.25) / 3)) < 1e-9)
})

test('rehearsals run on a budget: a tick ceiling, and one roll for a big battle', () => {
  const { rehearsalCeiling, bigBattle } = TUNING.autoplay
  const setup = (n) => ({ party: Array(Math.ceil(n / 2)).fill({}), foes: Array(Math.floor(n / 2)).fill({}) })
  const seeds = LEVELS.expert.seeds
  assert.ok(seeds > 1)
  assert.deepEqual(rehearsalBudget(setup(10), seeds), { seeds, ceiling: rehearsalCeiling })
  assert.deepEqual(rehearsalBudget(setup(bigBattle), seeds), { seeds, ceiling: rehearsalCeiling })
  assert.deepEqual(rehearsalBudget(setup(bigBattle + 1), seeds), { seeds: 1, ceiling: rehearsalCeiling })
  assert.deepEqual(rehearsalBudget(setup(bigBattle + 1), 0), { seeds: 0, ceiling: rehearsalCeiling })
  assert.deepEqual(rehearsalBudget({ ...setup(bigBattle), reserve: [{}, {}] }, seeds), { seeds, ceiling: rehearsalCeiling }, 'the reserve does not count')
  assert.deepEqual([rehearsalCeiling, bigBattle], [1400, 24])
})

test('the autoplayer rehearses and plays ahead without touching the run', () => {
  for (const level of ['basic', 'expert']) {
    const seen = new Set()
    // Through the first rooms: a route choice, a prep and a reap at least (on another seed if a run is
    // lost before it reaps: floor 1 is hard).
    for (let k = 0; k < 4 && !seen.has('reap'); k++) {
      const run = createRun({ seed: 'rehearse' + (k || '') })
      const rng = createRng(run.state.seed).stream('autoplay')
      while (run.state.stats.fights < 2 && run.state.phase !== 'over') {
        const before = structuredClone(run.state)
        const setup = run.setup
        const action = policy(run, rng, level)
        assert.deepEqual(run.state, before, `${level} ${run.state.phase}`)
        assert.equal(run.setup, setup)
        seen.add(run.state.phase)
        apply(run, action)
      }
    }
    assert.deepEqual([...seen].sort(), ['map', 'prep', 'reap'], level)
  }
})

test('replay(seed, log) rebuilds the same final state', () => {
  for (let i = 0; i < 5; i++) {
    const live = fuzz('replay' + i, 0, new Set())
    assert.deepEqual(replay(live.state.seed, live.state.log).state, live.state)
  }
})

test('the current node after a fight is the room fought in', () => {
  const run = createRun({ seed: 'node' })
  const node = visit(run, 'fight')
  apply(run, { type: 'fight' })
  assert.equal(currentNode(run).id, node.id)
})

// ── the Monarch in the run ───────────────────────────────────────────────────────────────────────

test('the Monarch stands on its camp\'s seat from the start, and nothing places it nor anything on its cell; its souls start on the camp\'s default frontier', () => {
  for (const c of CAMP_LIST.filter((x) => x.floor === 1)) {
    let run
    for (let i = 0; !run || run.state.camp !== c.id; i++) run = createRun({ seed: 'throne' + i })
    const m = monarchOf(run.state)
    assert.equal(m.slot, monarchSlot(c.id))
    assert.ok(isMonarchCell(c.id, m.slot))
    const start = souls(run.state.party)
    assert.deepEqual(start.map((u) => u.slot), frontier(c.id, start.map((u) => ({ ...u, slot: OSSUARY }))), `${c.id}: the frontier (test/movement.test.js)`)
  }
  const run = createRun({ seed: 'throne' })
  const s = run.state
  const m = monarchOf(s)
  const seat = m.slot
  const [knight, chanter] = souls(s.party)
  // Never placed: not to any cell, nor the ossuary; and nothing onto its cell, from the field or the ossuary.
  for (let slot = OSSUARY; slot < CAMP_SLOTS; slot++) assert.throws(() => apply(run, { type: 'place', uid: MONARCH_UID, slot }), /cannot place/, `to ${slot}`)
  assert.throws(() => apply(run, { type: 'place', uid: knight.uid, slot: seat }), /cannot place/)
  apply(run, { type: 'place', uid: chanter.uid, slot: OSSUARY })
  assert.throws(() => apply(run, { type: 'place', uid: chanter.uid, slot: seat }), /cannot place/)
  assert.ok(!canPlace(run, m, OSSUARY) && !canPlace(run, chanter, seat))
  assert.throws(() => apply(run, { type: 'split', uid: knight.uid, n: 1, slot: seat }), /cannot split/)
  assert.equal(m.slot, seat)
  // It takes no room: three souls fill the field beside it, and it is never released.
  apply(run, { type: 'place', uid: chanter.uid, slot: firstFree(s) })
  assert.equal(fielded(s.party).length, fieldCap(run) + 1)
  assert.throws(() => join(run, 'monarch'), /one Monarch/)
  checkState(s)
})

test('no Monarch points: no action buys it anything; its HP and Command are its relics\', and Arise\'s numbers the Arise relic\'s; the battle gets them all', () => {
  const run = createRun({ seed: 'crown' })
  const s = run.state
  const m = monarchOf(s)
  s.essence = 1000
  for (const stat of ['hp', 'command', 'domain', 'raises']) assert.throws(() => apply(run, { type: 'monarch', stat }), /unknown action "monarch"/)
  assert.ok(!legalActions(run).some((a) => a.type === 'monarch'))
  assert.deepEqual([s.essence, m.lvl, m.maxHp, s.log], [1000, 0, TUNING.monarch.hp, []])
  // Relics: two Command (one Legion), an HP relic, two copies of Arise and Court of Bone.
  s.relics = ['grave_banner', 'legion', 'arise', 'arise', 'court_of_bone']
  assert.equal(fieldCap(run), TUNING.party.field + 3)
  assert.equal(commandOf(s), baseField(s) + 3)
  const a = ariseOf(s)
  assert.deepEqual([a.copies, a.domain, domainOf(s)], [2, TUNING.arise.domain + TUNING.arise.more.domain + RELICS.court_of_bone.domain, a.domain])
  visit(run, 'fight')
  const setup = battleSetup(run)
  assert.deepEqual([setup.domain, setup.relics.filter((id) => id === 'arise').length, setup.nextUid], [domainOf(s), 2, s.nextUid + setup.foes.length])
  assert.equal(setup.party.find((u) => u.uid === MONARCH_UID).maxHp, m.maxHp)
})

test('a fight: shadows never join the retinue and the run moves past their uids; wounds carry; a fallen Monarch ends the run', () => tuned({ ...FIRST_BALANCE, arise: { ...FIRST_BALANCE.arise, domain: 8 } }, () => {
  // With a domain over the whole camp (two copies of Arise), where corpses fall in reach; with `hp`, wounded
  // before the fight, its souls on the cells beside its seat, where the foes come to them.
  const fightFrom = (seed, hp) => {
    const run = createRun({ seed })
    run.state.relics = ['arise', 'arise']
    visit(run, 'fight')
    if (hp) {
      monarchOf(run.state).hp = hp
      const seat = monarchOf(run.state).slot
      const beside = [[0, -1], [0, 1], [-1, 0]].map(([dr, dc]) => [rowOf(seat) + dr, colOf(seat) + dc]).filter(([r, c]) => r >= 0 && c >= 0 && c < COLS)
        .map(([r, c]) => slotAt(r, c)).filter((slot) => campOpen(run.state.camp, slot))
      souls(run.state.party).forEach((u, i) => beside[i] !== undefined && canPlace(run, u, beside[i]) && apply(run, { type: 'place', uid: u.uid, slot: beside[i] }))
    }
    apply(run, { type: 'fight' })
    return run
  }
  // A won fight where shadows rose (beside the Monarch: they seldom fall there).
  const shadowFight = (() => {
    for (let i = 0; i < 200; i++) {
      const run = fightFrom('shadow' + i)
      if (run.state.phase === 'reap' && run.battle.units.some((u) => u.shadow)) return run
    }
    assert.fail('no seed raised a shadow in a won fight')
  })()
  const run = shadowFight
  const shadows = run.battle.units.filter((u) => u.shadow)
  const first = run.setup.nextUid
  assert.equal(first, run.setup.foes.at(-1).uid + 1)
  assert.ok(shadows.every((u) => u.uid >= first && u.uid < run.state.nextUid))
  // Only the room's own foes pay essence, not the shadows that rose, standing or fallen.
  const slain = run.battle.units.filter((u) => run.setup.foes.some((f) => f.uid === u.uid) && u.hp <= 0)
  assert.equal(run.state.stats.essence, Math.round(slain.reduce((n, u) => n + foeEssence(u), 0)))
  assert.equal(run.state.nextUid, run.battle.nextUid)
  assert.ok(!run.state.party.some((u) => shadows.some((x) => x.uid === u.uid)))
  // A won fight where the Monarch, wounded coming in, was struck: it keeps its share of HP, then heals.
  const woundFight = (() => {
    for (let i = 0; i < 200; i++) {
      const run = fightFrom('wound' + i, 100)
      if (run.state.phase === 'reap' && run.battle.events.some((e) => e.type === 'damage' && e.target === MONARCH_UID)) return run
    }
    assert.fail('no seed struck the Monarch in a won fight')
  })()
  const m = monarchOf(woundFight.state)
  const bm = woundFight.battle.monarch
  const carried = Math.max(1, Math.round(bm.hp / bm.maxHp * m.maxHp))
  assert.ok(carried < m.maxHp, `it carried its wounds out: ${bm.hp}/${bm.maxHp}`)
  assert.equal(m.hp, Math.min(m.maxHp, carried + Math.ceil(m.maxHp * TUNING.run.postBattleHeal)))
  assert.ok(m.hp > carried, 'and healed after the win')
  // The Monarch alone against a room: it falls, and the run says to what.
  const lone = createRun({ seed: 'lone' })
  visit(lone, 'fight')
  for (const u of souls(lone.state.party)) apply(lone, { type: 'place', uid: u.uid, slot: -1 })
  apply(lone, { type: 'fight' })
  assert.deepEqual([lone.state.phase, lone.state.result, lone.battle.reason], ['over', 'defeat', 'monarch'])
  assert.deepEqual(lone.state.death, { ...lone.battle.death, reason: 'monarch' })
  assert.ok(lone.state.death.by && lone.state.death.threat)
  assert.equal(monarchOf(lone.state).hp, 0)
  // The clock: a battle still going at the ceiling is a defeat by it.
  const ceiling = TUNING.tick.ceiling
  TUNING.tick.ceiling = 5
  try {
    const slow = createRun({ seed: 'slow' })
    visit(slow, 'fight')
    apply(slow, { type: 'fight' })
    assert.deepEqual([slow.state.result, slow.state.death], ['defeat', { by: null, reason: 'tick-ceiling', threat: 'clock' }])
  } finally {
    TUNING.tick.ceiling = ceiling
  }
  // An altar heals it like a soul.
  const rest = createRun({ seed: 'rest' })
  monarchOf(rest.state).hp = 1
  visit(rest, 'altar')
  assert.equal(monarchOf(rest.state).hp, monarchOf(rest.state).maxHp)
}))

// Every wave counted, and depth for a room with more than one (a floor-1 elite's late pair, waves); a siege and
// the last room count as fights.
test('from rank 3 on, every fight carries two threat types and every elite three; before it, the first draw stands', () => {
  const v = TUNING.spawn.variety
  // The room as drawn with the rule off: one draw, never redrawn.
  const firstDraw = (seed, floor, node) => {
    const tries = v.tries
    v.tries = 1
    try {
      return drawRoom(seed, floor, node)
    } finally {
      v.tries = tries
    }
  }
  let checked = 0
  let early = 0
  let redrawn = 0
  for (let i = 0; i < 60; i++) {
    for (let floor = 1; floor <= TUNING.run.floors; floor++) {
      const seed = 'threat' + i
      const map = generateFloor({ seed, floor, last: floor === TUNING.run.floors })
      for (const node of map.nodes) {
        if (!['fight', 'elite', 'siege', 'boss'].includes(node.type)) continue
        const room = drawRoom(seed, floor, node)
        assert.deepEqual(room, drawRoom(seed, floor, node), 'the draw is seeded')
        assert.deepEqual(room.foes, encounter(seed, floor, node))
        if (node.rank < v.from) {
          const first = firstDraw(seed, floor, node)
          assert.deepEqual(room, first, `${seed} floor ${floor} ${node.id}: ranks before ${v.from} keep their first draw`)
          early++
          if (roomThreats(first).size < (node.type === 'elite' ? v.elite : v.fight)) redrawn++
          continue
        }
        const need = node.type === 'elite' ? v.elite : v.fight
        assert.ok(roomThreats(room).size >= need, `${seed} floor ${floor} ${node.id} ${node.type}: ${[room.foes, ...(room.waves ?? []).map((w) => w.foes)].flat().map((f) => f.id)}`)
        checked++
      }
    }
  }
  assert.ok(checked > 1000)
  assert.ok(early > 100 && redrawn > 0, `${early} early rooms, ${redrawn} of them short of the rule: it would have redrawn some`)
})

// ── the army: rank-and-file, muster, cohorts, binding ─────────────────────────────────────────

// Gives the Monarch `n` more Command: as many Grave Banners (the Command relic that costs the souls nothing), held as a
// relic taken would be (the state edited outside the log: not a replay).
function command (run, n) {
  run.state.relics.push(...Array(n).fill('grave_banner'))
}
// A copy of a run to try an action on (the state edited outside the log, so not a replay).

// ── the army: souls, the ossuary ───────────────────────────────────────────────────────

test('the army is the souls: no bodies, no muster, no binds; Command is the field cap (3 + Command), never past the board', async () => {
  const run = createRun({ seed: 'army' })
  const s = run.state
  for (const k of ['ossuary', 'muster', 'freeBinds', 'lines']) assert.ok(!(k in s), `no ${k} in the state`)
  assert.ok(!('bound' in s.stats))
  assert.ok(souls(s.party).every((u) => !('cohort' in u)))
  s.essence = 1e4
  for (const type of ['muster', 'cohort', 'bind']) {
    assert.throws(() => apply(run, { type, uid: 1, id: 'grave_ghoul', kind: 'grave_ghoul', count: 1, shape: 'line' }), /unknown action/, type)
    assert.ok(!legalActions(run).some((a) => a.type === type))
  }
  // 3 + Command souls on the field: each point a soul more.
  assert.deepEqual([TUNING.party.field, TUNING.party.fieldPerFloor, baseField(s), fieldCap(run)], [3, 0, 3, 3])
  for (let c = 1; c <= 3; c++) {
    command(run, 1)
    assert.equal(fieldCap(run), 3 + c)
  }
  // A floor down adds none: Command alone widens the field.
  s.floor = 3
  assert.equal(fieldCap(run), 6)
  // Legion adds its two, and the field never passes the board, however much Command the relics give.
  s.relics.push('legion')
  assert.equal(fieldCap(run), 6 + 2)
  command(run, 20)
  assert.equal(fieldCap(run), TUNING.army.board)
  // The old exports are gone with the bodies, the cohorts, the muster and the binds.
  // So are the ranks and the per-soul paths: upgrades are the kind's (DESIGN §2.6). And the lines (DESIGN §2.9).
  const gone = ['benched', 'keptShadows', 'canLead', 'standingOf', 'freeBodies', 'kinStanding', 'feedOf', 'cohortCap', 'musterCost', 'bindCost', 'promoteNeed',
    'promoteLevel', 'promoteCost', 'canPromote', 'nextTier', 'cleanLine', 'cleanWhen', 'isMarch', 'LINE_MAX',
    // And the Monarch's points and the bought levels (2026-10-09).
    'MONARCH_STATS', 'monarchPoints', 'monarchCost', 'monarchStatOpen', 'levelCost', 'medianLevel']
  const runJs = await import('../src/sim/run.js')
  assert.deepEqual(gone.filter((k) => k in runJs), [])
  const unitJs = await import('../src/sim/unit.js')
  assert.deepEqual(['pathsOf', 'pathDef', 'pathMods', 'pathsClash'].filter((k) => k in unitJs), [])
  const contentJs = await import('../src/content.js')
  assert.deepEqual(['SHAPES', 'PATHS', 'GRADES'].filter((k) => k in contentJs), [])
  assert.ok(!('muster' in TUNING.army) && !('bindPerTier' in TUNING.army) && !('overflow' in TUNING.army) && !('ranks' in TUNING))
  assert.deepEqual(['cost', 'costPerPoint', 'hpPerPoint'].filter((k) => k in TUNING.monarch), [])
  // And Arise's numbers moved to the relic's own (TUNING.arise): the Monarch keeps its base HP alone.
  assert.deepEqual(Object.keys(TUNING.monarch), ['hp'])
  assert.deepEqual(['cost', 'exponent', 'cap'].filter((k) => k in TUNING.level), [])
})

test('the ossuary is the soul collection: recruits past the field wait there, a soul leaves it only while the field has room, and the roster counts both', () => {
  const run = createRun({ seed: 'ossuary' })
  const s = run.state
  // The field full (3), every new soul waits in the ossuary, kept whole.
  const extra = [join(run, 'grave_ghoul'), join(run, 'will_o_wisp')]
  assert.deepEqual(extra.map((u) => u.slot), [OSSUARY, OSSUARY])
  assert.deepEqual(inOssuary(souls(s.party)), extra)
  assert.deepEqual(extra.map((u) => [u.lvl, u.tracks, u.hp === u.maxHp]), [[TUNING.level.base, [0, 0], true], [TUNING.level.base, [0, 0], true]])
  // No room on the field: an open cell is refused, a swap is not.
  const open = [...Array(CAMP_SLOTS).keys()].find((slot) => campOpen(s.camp, slot) && !s.party.some((u) => u.slot === slot))
  assert.throws(() => apply(run, { type: 'place', uid: extra[0].uid, slot: open }), /cannot place/)
  assert.ok(!legalActions(run).some((a) => a.type === 'place' && a.uid === extra[0].uid && a.slot === open))
  const [knight] = souls(s.party)
  const cell = knight.slot
  apply(run, { type: 'place', uid: extra[0].uid, slot: cell })
  assert.deepEqual([extra[0].slot, knight.slot], [cell, OSSUARY], 'the fielded soul goes to the ossuary in its place')
  // A Command relic: one more may leave it for an open cell.
  command(run, 1)
  apply(run, { type: 'place', uid: extra[1].uid, slot: open })
  assert.equal(fielded(souls(s.party)).length, 4)
  assert.deepEqual(inOssuary(souls(s.party)), [knight])
  // The Monarch never goes there, and the roster cap counts the ossuary and the field together.
  assert.throws(() => apply(run, { type: 'place', uid: MONARCH_UID, slot: OSSUARY }), /cannot place/)
  while (soulCount(s.party) < rosterCap(run)) join(run, 'clockwork_page')
  assert.throws(() => join(run, 'clockwork_page'), /the retinue is full/)
  assert.equal(inOssuary(souls(s.party)).length, rosterCap(run) - fieldCap(run))
  checkState(s)
})

test('a recruit with room on the field takes the free cell nearest the Monarch, never one out ahead of the pieces placed', () => {
  // In every floor-1 camp, the field widened by Command: each new soul, a 2×2 among them, stands on the free cell
  // nearest the seat that it fits (its footprint's nearest cell; none nearer), so the start souls' frontier still says
  // where the foes halt.
  for (const camp of CAMP_LIST.filter((c) => c.floor === 1)) {
    const run = createRun({ seed: 'recruit' })
    const s = run.state
    s.camp = camp.id
    monarchOf(s).slot = monarchSlot(camp.id)
    const start = fielded(souls(s.party))
    frontier(camp.id, start).forEach((slot, i) => { start[i].slot = slot })
    command(run, 3)
    const seat = monarchOf(s).slot
    const near = (slot, size) => Math.min(...footprintSlots(slot, size).map((c) => Math.max(Math.abs(rowOf(c) - rowOf(seat)), Math.abs(colOf(c) - colOf(seat)))))
    for (const id of ['frost_sprite', BIG, 'grave_ghoul']) {
      const taken = takenBy(s)
      const u = join(run, id)
      const size = sizeOf(u)
      assert.ok(u.slot >= 0, `${camp.id}: ${id} fielded`)
      checkField(s)
      const best = Math.min(...[...Array(CAMP_SLOTS).keys()].filter((c) => fits(s.camp, c, size, taken)).map((c) => near(c, size)))
      assert.equal(near(u.slot, size), best, `${camp.id}: ${id} at ${u.slot}`)
    }
    assert.deepEqual(start.map((u) => u.slot), frontier(camp.id, start), 'the pieces placed stay put')
  }
})

// ── stacks (DESIGN §2.2) ─────────────────────────────────────────────────────────────────────────

const pieceOf = (run, uid) => run.state.party.find((u) => u.uid === uid)

test('stack and split: a piece onto another of its kind is one piece of both counts and pools, keeping the place of the one it joined; splitting gives the bodies back', () => {
  const run = createRun({ seed: 'stack' })
  const s = run.state
  const [knight, chanter] = souls(s.party)
  const body = baseStats('tomb_knight', knight.lvl).hp
  const twin = join(run, 'tomb_knight')
  assert.equal(twin.slot, OSSUARY)
  // Refused: another kind, itself, the Monarch, no such piece.
  for (const [uid, onto] of [[twin.uid, chanter.uid], [twin.uid, twin.uid], [MONARCH_UID, knight.uid], [knight.uid, MONARCH_UID], [999, knight.uid]]) {
    assert.throws(() => apply(run, { type: 'stack', uid, onto }), /cannot stack/, `${uid} onto ${onto}`)
  }
  const souls0 = soulCount(s.party)
  const slot = knight.slot
  apply(run, { type: 'stack', uid: twin.uid, onto: knight.uid })
  assert.deepEqual([knight.count, knight.hp, knight.maxHp, knight.slot], [2, 2 * body, 2 * body, slot])
  assert.ok(!s.party.includes(twin))
  assert.deepEqual([soulCount(s.party), fielded(souls(s.party)).length], [souls0, 3], 'two souls, one piece on the field')
  checkState(s)
  // Split: 1 to count − 1 bodies, to the ossuary or a free open cell while the field has room.
  const wall = [...Array(CAMP_SLOTS).keys()].find((t) => !campOpen(s.camp, t))
  const free = [...Array(CAMP_SLOTS).keys()].find((t) => campOpen(s.camp, t) && !s.party.some((u) => u.slot === t))
  for (const bad of [{ n: 0 }, { n: 2 }, { n: 1.5 }, { n: 1, slot: chanter.slot }, { n: 1, slot: wall }, { n: 1, slot: free }]) {
    assert.throws(() => apply(run, { type: 'split', uid: knight.uid, ...bad }), /cannot split/, JSON.stringify(bad))
  }
  assert.throws(() => apply(run, { type: 'split', uid: chanter.uid, n: 1 }), /cannot split/, 'a piece of one')
  const uid = s.nextUid
  apply(run, { type: 'split', uid: knight.uid, n: 1 })
  const back = pieceOf(run, uid)
  assert.deepEqual([back.id, back.count, back.hp, back.maxHp, back.slot, back.lvl, back.tracks], ['tomb_knight', 1, body, body, OSSUARY, knight.lvl, knight.tracks])
  assert.deepEqual([knight.count, knight.hp, knight.maxHp, knight.slot], [1, body, body, slot])
  assert.equal(soulCount(s.party), souls0, 'the same souls')
  // With room on the field, straight onto a free cell.
  apply(run, { type: 'stack', uid: back.uid, onto: knight.uid })
  command(run, 1)
  apply(run, { type: 'split', uid: knight.uid, n: 1, slot: free })
  assert.deepEqual([s.party.at(-1).slot, fielded(souls(s.party)).length], [free, 4])
  checkState(s)
})

test('a wounded stack splits off its hindmost bodies: the fallen first, then the one wounded, then the whole', () => {
  const run = createRun({ seed: 'stack-wounds' })
  const s = run.state
  const [knight] = souls(s.party)
  for (let k = 0; k < 2; k++) apply(run, { type: 'stack', uid: join(run, 'tomb_knight').uid, onto: knight.uid })
  const b = bodyHp(knight)
  knight.hp = b + Math.round(b / 2)
  assert.deepEqual(bodiesHp(knight), [b, Math.round(b / 2), 0])
  apply(run, { type: 'split', uid: knight.uid, n: 1 })
  assert.deepEqual([s.party.at(-1).hp, knight.count, knight.hp], [0, 2, b + Math.round(b / 2)], 'the fallen one')
  apply(run, { type: 'split', uid: knight.uid, n: 1 })
  assert.deepEqual([s.party.at(-1).hp, knight.count, knight.hp], [Math.round(b / 2), 1, b], 'then the wounded one')
  checkState(s)
})

test('legalActions lists exactly the stacks and splits apply accepts', () => {
  const run = createRun({ seed: 'stack-legal' })
  const s = run.state
  const [knight] = souls(s.party)
  join(run, 'tomb_knight')
  apply(run, { type: 'stack', uid: join(run, 'tomb_knight').uid, onto: knight.uid })
  for (const cmd of [0, 1]) {
    if (cmd) command(run, 1)
    const listed = legalActions(run).filter((a) => a.type === 'stack' || a.type === 'split').map((a) => JSON.stringify(a))
    const tries = souls(s.party).flatMap((u) => [
      ...souls(s.party).map((v) => ({ type: 'stack', uid: u.uid, onto: v.uid })),
      ...[1, 2, 3].flatMap((n) => [-1, ...Array(CAMP_SLOTS).keys()].map((slot) => ({ type: 'split', uid: u.uid, n, slot })))
    ])
    const accepted = tries.filter((a) => {
      try {
        apply({ ...run, state: structuredClone(s) }, a)
        return true
      } catch {
        return false
      }
    }).map((a) => JSON.stringify(a))
    assert.deepEqual(listed.sort(), accepted.sort(), `Command ${cmd}`)
    assert.ok(listed.some((a) => a.includes('"stack"')) && listed.some((a) => a.includes('"split"')))
  }
})

test('a recruit may join a fielded piece of its kind straight away: a body more, whole; never one in the ossuary or of another kind', () => {
  const run = win('onto')
  const s = run.state
  s.essence = 1e4
  const index = s.offers.findIndex((o) => o.type === 'soul')
  const o = s.offers[index]
  // A fielded piece of the offer's kind, and one in the ossuary.
  const piece = join(run, o.id)
  const [first] = fielded(souls(s.party)).filter((u) => u !== piece)
  Object.assign(piece, { slot: first.slot })
  first.slot = OSSUARY
  const spare = join(run, o.id)
  assert.equal(spare.slot, OSSUARY)
  const other = fielded(souls(s.party)).find((u) => u.id !== o.id)
  assert.deepEqual(legalActions(run).filter((a) => a.type === 'reap' && a.index === index && a.onto !== undefined), [{ type: 'reap', index, onto: piece.uid }])
  for (const onto of [spare.uid, other.uid, 999]) assert.throws(() => apply(run, { type: 'reap', index, onto }), /cannot join/, `onto ${onto}`)
  const before = [s.party.length, soulCount(s.party)]
  apply(run, { type: 'reap', index, onto: piece.uid })
  const lvl = s.kinds[o.id].lvl
  assert.deepEqual([piece.count, piece.lvl, piece.hp, piece.maxHp], [2, lvl, 2 * baseStats(o.id, lvl).hp, 2 * baseStats(o.id, lvl).hp])
  assert.deepEqual([s.party.length, soulCount(s.party)], [before[0], before[1] + 1], 'no new piece: a soul more in it')
  checkState(s)
})

test('a stack fights as one piece and keeps the bodies it kept: those its tiers added fall first and go; the fallen stay down; a won battle heals each living body', () => {
  const run = win('stack-fight', (r) => {
    const s = r.state
    const [knight] = souls(s.party)
    apply(r, { type: 'stack', uid: join(r, 'tomb_knight').uid, onto: knight.uid })
    // The chanter's kind on Marrowcaller II: bodies more each battle (and the level the two tiers give).
    s.essence += TUNING.essence.tier[0] + TUNING.essence.tier[1]
    for (let k = 0; k < 2; k++) apply(r, { type: 'upgrade', kind: 'bone_chanter', track: 1 })
  })
  const s = run.state
  const b = run.battle
  for (const u of fielded(souls(s.party))) {
    const bu = b.byUid.get(u.uid)
    const added = u.id === 'bone_chanter' ? TRACKS.bone_chanter[1].tiers[1].count : 0
    assert.deepEqual([bu.count, u.count], [u.count + added, u.count], u.id)
    // The run's pool: the bodies it kept, then the won battle's heal on each living one.
    const kept = Math.min(bu.hp, u.count * bu.body)
    const back = kept > 0 ? Math.max(1, Math.round(kept / bu.body * bodyHp(u))) : 0
    const healed = back > 0 ? Math.min(Math.ceil(back / bodyHp(u) - 1e-9) * bodyHp(u), back + Math.ceil(bodyHp(u) * TUNING.run.postBattleHeal)) : 0
    assert.equal(u.hp, healed, u.id)
  }
  assert.equal(s.party.find((u) => u.id === 'tomb_knight').count, 2)
  checkState(s)
})

test('a tier\'s level heals each living body by its gain, an altar each body: the living to altarHeal, the fallen to altarRevive', () => tuned(LEVEL_A_TIER, () => {
  const run = createRun({ seed: 'stack-heal' })
  const s = run.state
  const [knight] = souls(s.party)
  for (let k = 0; k < 2; k++) apply(run, { type: 'stack', uid: join(run, 'tomb_knight').uid, onto: knight.uid })
  const b = bodyHp(knight)
  knight.hp = b + 10
  s.essence = 1000
  apply(run, { type: 'upgrade', kind: 'tomb_knight', track: 0 })
  assert.ok(knight.lvl > TUNING.level.base)
  const b2 = baseStats('tomb_knight', knight.lvl).hp
  assert.deepEqual([knight.maxHp, knight.hp, livingBodies(knight)], [3 * b2, b + 10 + 2 * (b2 - b), 2])
  const T = TUNING.run
  knight.hp = 10
  const node = visit(run, 'altar')
  assert.equal(node.type, 'altar')
  assert.equal(knight.hp, Math.max(10, Math.round(b2 * T.altarHeal)) + 2 * Math.ceil(b2 * T.altarRevive))
}))

test('stacks: basic stacks a standing piece the field has no place for onto its kind, and splits a stack while the field has room; the expert weighs each, once a room', () => {
  const rng = createRng('auto-stack').stream('autoplay')
  // A spare of each start kind in turn: basic stacks the one of the kind left off the field onto that kind's piece.
  const spares = ['tomb_knight', 'bone_chanter', 'frost_sprite'].map((kind) => {
    const run = createRun({ seed: 'auto-stack' })
    visit(run, 'fight')
    run.state.essence = 0
    const spare = join(run, kind)
    return { run, a: policy(run, rng, 'basic'), spare, piece: run.state.party.find((u) => u.id === kind) }
  })
  const stacked = spares.filter((p) => p.a.type === 'stack')
  assert.ok(stacked.length >= 1, JSON.stringify(spares.map((p) => p.a)))
  for (const p of stacked) assert.deepEqual(p.a, { type: 'stack', uid: p.spare.uid, onto: p.piece.uid })
  // The expert weighs keeping against that stack (and any other), and takes one of them.
  for (const { run, spare, piece } of spares) {
    const options = stackOptions(run)
    assert.equal(options[0], null)
    assert.ok(options.some((o) => o?.type === 'stack' && o.uid === spare.uid && o.onto === piece.uid), JSON.stringify(options))
    const a = policy(run, rng, 'expert')
    assert.ok(a.type !== 'stack' && a.type !== 'split' ? true : options.some((o) => JSON.stringify(o) === JSON.stringify(a)), JSON.stringify(a))
  }
  // A stack with a place free on the field: basic splits a body off, and the plan fields it.
  const room = () => {
    const run = createRun({ seed: 'auto-split' })
    visit(run, 'fight')
    const [knight] = souls(run.state.party)
    apply(run, { type: 'stack', uid: join(run, 'tomb_knight').uid, onto: knight.uid })
    command(run, 1)
    run.state.essence = 0
    return { run, knight }
  }
  const { run, knight } = room()
  assert.deepEqual(policy(run, rng, 'basic'), { type: 'split', uid: knight.uid, n: 1 })
  for (let a; (a = policy(run, rng, 'basic')).type !== 'fight';) apply(run, a)
  assert.deepEqual([fielded(souls(run.state.party)).length, knight.count], [4, 1])
  // The expert weighs the split against keeping the stack, once a room: asked again, it has decided.
  const e = room()
  assert.ok(stackOptions(e.run).some((o) => o?.type === 'split' && o.uid === e.knight.uid))
  const first = policy(e.run, rng, 'expert')
  if (first.type === 'split') apply(e.run, first)
  const again = policy(e.run, rng, 'expert')
  assert.ok(again.type !== 'stack' && again.type !== 'split', JSON.stringify(again))
})

test('a foe piece pays essence by its tier alone, whatever its count or level', () => {
  const one = makeUnit('grave_ghoul', { lvl: 4 })
  assert.equal(foeEssence({ ...one, count: 3 }), foeEssence(one))
  assert.equal(foeEssence(makeUnit('grave_ghoul', { lvl: 1 })), foeEssence(one))
  assert.equal(foeEssence(one), TUNING.essence.perTier * UNITS.grave_ghoul.tier)
  assert.equal(foeEssence(makeUnit('iron_golem', { lvl: 4 })), TUNING.essence.perTier * UNITS.iron_golem.tier)
})

test('every price grows by the floor: a tier, a recruit and a fusion cost their base × floorPrice, 1 on floor 1', () => {
  assert.equal(floorPrice(1), 1)
  assert.ok(floorPrice(2) > floorPrice(1) && floorPrice(3) > floorPrice(2))
  const run = createRun({ seed: 'floor-prices' })
  const s = run.state
  const r = FUSION_LIST[0]
  for (const floor of [1, 2, 3, 4, 6]) {
    s.floor = floor
    assert.equal(tierCost(run, 'tomb_knight', 0), Math.round(TUNING.essence.tier[0] * floorPrice(floor)), `tier I on floor ${floor}`)
    assert.equal(fuseCost(run, r.id), Math.round(TUNING.essence.fuse * UNITS[r.result].tier * floorPrice(floor)), `fusion on floor ${floor}`)
  }
})

// ── footprints (DESIGN §2.2) ─────────────────────────────────────────────────────────────────────

test('a 2×2 piece stands where its whole footprint fits: on the camp, open ground, not the seat, no other piece\'s; place says exactly where', () => {
  const run = createRun({ seed: 'big' })
  const s = run.state
  command(run, 2)
  const big = join(run, BIG)
  assert.equal(sizeOf(big), 2)
  assert.ok(big.slot >= 0 && rowOf(big.slot) >= 1, 'a new soul takes the free cell nearest the seat it fits; a 2×2 runs a row ahead, so never from the front row')
  checkField(s)
  // Every anchor no other piece covers: listed, and applied, exactly where the footprint fits.
  const others = takenBy(s, [big])
  const listed = new Set(legalActions(run).filter((a) => a.type === 'place' && a.uid === big.uid).map((a) => a.slot))
  let fit = 0
  for (let slot = 0; slot < CAMP_SLOTS; slot++) {
    if (others.has(slot) || slot === big.slot) continue
    const cells = footprintSlots(slot, 2)
    const ok = !!cells && cells.every((c) => campOpen(s.camp, c) && !isMonarchCell(s.camp, c) && !others.has(c))
    assert.equal(listed.has(slot), ok, `anchor ${slot}`)
    assert.equal(canPlace(run, big, slot), ok, `anchor ${slot}`)
    fit += ok
  }
  assert.ok(fit > 0 && listed.has(OSSUARY))
  const seat = monarchOf(s).slot
  for (const slot of [slotAt(0, 3), slotAt(3, COLS - 1), slotAt(rowOf(seat), colOf(seat) - 1)]) {
    assert.throws(() => apply(run, { type: 'place', uid: big.uid, slot }), /cannot place/, `front row, last lane, over the seat: ${slot}`)
  }
  // A swap: a soul dropped on any cell of the 2×2 trades places with it only where the 2×2 fits in its old one.
  const knight = souls(s.party).find((u) => u.id === 'tomb_knight')
  assert.equal(rowOf(knight.slot), 0)
  for (const c of cellsOf(big)) assert.throws(() => apply(run, { type: 'place', uid: knight.uid, slot: c }), /cannot place/, 'a 2×2 on the front row')
  const A = big.slot
  const B = [...Array(CAMP_SLOTS).keys()].find((c) => c !== knight.slot && fits(s.camp, c, 2, takenBy(s, [big, knight])) && !footprintSlots(c, 2).includes(A) && !cellsOf(big).includes(c))
  apply(run, { type: 'place', uid: knight.uid, slot: B })
  apply(run, { type: 'place', uid: big.uid, slot: B })
  assert.deepEqual([big.slot, knight.slot], [B, A], 'onto the knight\'s cell: the knight takes its old one')
  checkField(s)
  // From the ossuary, with the field full, only in a swap where it fits: onto the knight, which goes to the ossuary.
  apply(run, { type: 'place', uid: big.uid, slot: OSSUARY })
  while (fielded(souls(s.party)).length < fieldCap(run)) assert.ok(join(run, 'clockwork_page').slot >= 0)
  const front = souls(s.party).find((u) => u.slot >= 0 && !fits(s.camp, u.slot, 2, takenBy(s, [u])))
  assert.throws(() => apply(run, { type: 'place', uid: big.uid, slot: front.slot }), /cannot place/, 'onto a piece whose cell holds no 2×2')
  assert.ok(canPlace(run, big, knight.slot) === fits(s.camp, knight.slot, 2, takenBy(s, [knight])))
  if (canPlace(run, big, knight.slot)) {
    apply(run, { type: 'place', uid: big.uid, slot: A })
    assert.deepEqual([big.slot, knight.slot], [A, OSSUARY])
  }
  checkState(s)
})

test('a 2×2 stack splits only to a cell its footprint fits', () => {
  const run = createRun({ seed: 'big-split' })
  const s = run.state
  command(run, 2)
  const big = join(run, BIG)
  apply(run, { type: 'stack', uid: join(run, BIG).uid, onto: big.uid })
  assert.equal(big.count, 2)
  const free = [...Array(CAMP_SLOTS).keys()].filter((c) => campOpen(s.camp, c) && !takenBy(s).has(c))
  for (const slot of free) {
    const action = { type: 'split', uid: big.uid, n: 1, slot }
    const listed = legalActions(run).some((a) => JSON.stringify(a) === JSON.stringify(action))
    assert.equal(listed, fits(s.camp, slot, 2, takenBy(s)), `to ${slot}`)
  }
  const slot = free.find((c) => fits(s.camp, c, 2, takenBy(s)))
  apply(run, { type: 'split', uid: big.uid, n: 1, slot })
  assert.deepEqual([s.party.at(-1).slot, sizeOf(s.party.at(-1)), big.count], [slot, 2, 1])
  checkState(s)
})

test('a Colossus tier grows every piece of its kind to 2×2: one that still fits keeps its cell, one that does not goes to the ossuary', () => {
  const run = createRun({ seed: 'colossus' })
  const s = run.state
  command(run, 2)
  s.essence = 1e5
  const [a, b] = [join(run, COLOSSUS), join(run, COLOSSUS)]
  // One where a 2×2 would fit, the other on the front row, where none can stand.
  const roomy = [...Array(CAMP_SLOTS).keys()].find((c) => c !== b.slot && fits(s.camp, c, 2, takenBy(s, [a])))
  if (a.slot !== roomy) apply(run, { type: 'place', uid: a.uid, slot: roomy })
  const front = [...Array(COLS).keys()].map((c) => slotAt(0, c)).find((c) => !footprintSlots(roomy, 2).includes(c) && (c === b.slot || (campOpen(s.camp, c) && !takenBy(s).has(c))))
  if (b.slot !== front) apply(run, { type: 'place', uid: b.uid, slot: front })
  const others = souls(s.party).filter((u) => u.id !== COLOSSUS).map((u) => [u.uid, u.slot])
  for (let k = 0; k < 3; k++) apply(run, { type: 'upgrade', kind: COLOSSUS, track: COLOSSUS_TRACK })
  assert.deepEqual([sizeOf(a), a.slot, b.slot], [1, roomy, front])
  apply(run, { type: 'upgrade', kind: COLOSSUS, track: COLOSSUS_TRACK })
  assert.deepEqual([sizeOf(a), sizeOf(b), a.slot, b.slot], [2, 2, roomy, OSSUARY])
  assert.deepEqual(souls(s.party).filter((u) => u.id !== COLOSSUS).map((u) => [u.uid, u.slot]), others, 'the other kinds stand where they stood')
  checkField(s)
  // It may be placed again, wherever a 2×2 fits (or in a swap).
  const back = legalActions(run).filter((a) => a.type === 'place' && a.uid === b.uid && !takenBy(s).has(a.slot))
  assert.ok(back.length > 0 && back.every((x) => fits(s.camp, x.slot, 2, takenBy(s))))
  checkState(s)
})

test('a Colossus tier bumps only what cannot stand: a piece growing over one of its kind that goes to the ossuary keeps its cell', () => {
  const run = createRun({ seed: 'colossus-bump' })
  const s = run.state
  command(run, 2)
  s.essence = 1e5
  // Every soul to the ossuary but two of the kind: `a` (first in party order) on the second row where a 2×2 fits,
  // and `b` in front of it on the front row, where none can stand, and inside a's footprint-to-be.
  for (const u of souls(s.party)) if (u.slot >= 0) apply(run, { type: 'place', uid: u.uid, slot: OSSUARY })
  const [a, b] = [join(run, COLOSSUS), join(run, COLOSSUS)]
  for (const u of [a, b]) if (u.slot >= 0) apply(run, { type: 'place', uid: u.uid, slot: OSSUARY })
  const lane = [...Array(COLS).keys()].find((c) => fits(s.camp, slotAt(1, c), 2, takenBy(s)))
  apply(run, { type: 'place', uid: a.uid, slot: slotAt(1, lane) })
  apply(run, { type: 'place', uid: b.uid, slot: slotAt(0, lane) })
  assert.ok(s.party.indexOf(a) < s.party.indexOf(b) && footprintSlots(a.slot, 2).includes(b.slot))
  for (let k = 0; k < 4; k++) apply(run, { type: 'upgrade', kind: COLOSSUS, track: COLOSSUS_TRACK })
  assert.deepEqual([sizeOf(a), a.slot, b.slot], [2, slotAt(1, lane), OSSUARY])
  checkField(s)
})

// ── fusions (DESIGN §2.6) ────────────────────────────────────────────────────────────────────────

const bodiesOf = (s, kind) => souls(s.party).filter((u) => u.id === kind).reduce((n, u) => n + u.count, 0)

// A run holding, for each kind recipe `r` needs, one piece of a body more than it needs (a stack), and the
// essence the fusion costs.
function fusable (seed, r) {
  const run = createRun({ seed })
  const s = run.state
  const pieces = Object.entries(r.needs).map(([kind, n]) => {
    while (bodiesOf(s, kind) < n + 1) join(run, kind)
    const [first, ...rest] = souls(s.party).filter((u) => u.id === kind)
    for (const u of rest) apply(run, { type: 'stack', uid: u.uid, onto: first.uid })
    return first
  })
  s.essence = fuseCost(run, r.id)
  return { run, pieces }
}

test('fuse: a recipe consumes exactly the bodies it needs (a bigger stack keeps the rest), pays its price, and its fused piece waits in the ossuary, joining its kind', () => tuned(LEVEL_A_TIER, () => {
  for (const r of FUSION_LIST) {
    const { run, pieces } = fusable('fuse-' + r.id, r)
    const s = run.state
    const def = UNITS[r.result]
    assert.ok(def.fused, `${r.result} is a fused kind`)
    assert.equal(fuseCost(run, r.id), Math.round(TUNING.essence.fuse * def.tier * floorPrice(s.floor)))
    const parts = pieces.map((u) => ({ uid: u.uid, n: r.needs[u.id] }))
    assert.deepEqual(fuseParts(run, r.id), parts, 'the bodies asked of each stack')
    assert.ok(canFuse(run, r.id))
    // Refused, the run untouched: a short set, one too many, a wrong kind, the Monarch, a piece twice, no such piece,
    // no bodies, not a list, no such recipe, and short of essence.
    const other = souls(s.party).find((u) => !(u.id in r.needs)) ?? join(run, UNIT_LIST.find((u) => u.spawn && !(u.id in r.needs)).id)
    const [p0, ...rest] = parts
    const bad = [
      [{ ...p0, n: p0.n - 1 }, ...rest].filter((p) => p.n > 0), [{ ...p0, n: p0.n + 1 }, ...rest], [...parts, { uid: other.uid, n: 1 }],
      [{ uid: other.uid, n: p0.n }, ...rest], [...parts, { uid: MONARCH_UID, n: 1 }], [{ ...p0, n: p0.n - 1 }, { ...p0, n: 1 }, ...rest],
      [{ ...p0, uid: 999 }, ...rest], [{ ...p0, n: 0 }, ...parts], [{ ...p0, n: p0.n - 0.5 }, ...rest], [], null, 'all'
    ]
    const was = structuredClone(s)
    for (const p of bad) assert.throws(() => apply(run, { type: 'fuse', id: r.id, parts: p }), /cannot fuse/, JSON.stringify(p))
    assert.throws(() => apply(run, { type: 'fuse', id: 'no_such_fusion', parts }), /cannot fuse/)
    s.essence--
    assert.ok(!canFuse(run, r.id) && fuseParts(run, r.id) !== null)
    assert.throws(() => apply(run, { type: 'fuse', id: r.id, parts }), /not enough essence/)
    s.essence++
    assert.deepEqual(s, was)
    // Made: the bodies gone (the hindmost; each stack keeps its one more), the essence paid, the fused piece in the
    // ossuary, whole, a kind new to the run at the highest level of the kinds consumed (its least), with no tiers.
    const before = { souls: soulCount(s.party), spent: s.stats.spent, uid: s.nextUid }
    const lvl = Math.max(...pieces.map((u) => kindLevel(s, u.id)))
    apply(run, { type: 'fuse', id: r.id, parts })
    assert.deepEqual(pieces.map((u) => [s.party.includes(u), u.count, u.hp, u.maxHp]), pieces.map((u) => [true, 1, bodyHp(u), baseStats(u.id, u.lvl).hp]))
    const fused = s.party.at(-1)
    assert.deepEqual([fused.id, fused.uid, fused.count, fused.hp, fused.slot, fused.lvl, fused.tracks], [r.result, before.uid, 1, fused.maxHp, OSSUARY, lvl, [0, 0]])
    assert.deepEqual(s.kinds[r.result], { lvl, tracks: [0, 0], least: lvl })
    assert.deepEqual([s.essence, s.stats.spent - before.spent, soulCount(s.party)], [0, fuseCost(run, r.id), before.souls - Object.values(r.needs).reduce((a, b) => a + b, 0) + 1])
    assert.deepEqual(s.log.at(-1), { type: 'fuse', id: r.id, parts })
    checkState(s)
    // What is left lists the fusion only if it still holds the bodies (each kind kept one) and the essence.
    s.essence = 1e4
    const short = Object.entries(r.needs).some(([kind, n]) => bodiesOf(s, kind) < n)
    assert.equal(fuseParts(run, r.id) === null, short)
    assert.equal(legalActions(run).some((a) => a.type === 'fuse' && a.id === r.id), !short)
    // Again, once the fused kind has a tier of its own (and the level it gives): the new piece joins it at both,
    // whole pieces consumed and gone.
    apply(run, { type: 'upgrade', kind: r.result, track: 0 })
    for (const [kind, n] of Object.entries(r.needs)) while (bodiesOf(s, kind) < n) join(run, kind)
    const again = fuseParts(run, r.id)
    const whole = again.filter((p) => s.party.find((u) => u.uid === p.uid).count === p.n).map((p) => p.uid)
    apply(run, { type: 'fuse', id: r.id, parts: again })
    assert.deepEqual([s.party.at(-1).lvl, s.party.at(-1).tracks], [s.kinds[r.result].lvl, [1, 0]])
    assert.ok(s.kinds[r.result].lvl !== lvl && whole.length > 0 && !s.party.some((u) => whole.includes(u.uid)))
    checkState(s)
  }
}))

test('a fused piece is never at a lower level than its parts: its kind stands at least at the highest level of the kinds consumed, held or not, and never falls', () => {
  const r = FUSION_LIST.find((x) => Object.keys(x.needs).length > 1)
  const [high, low] = Object.keys(r.needs)
  const { run } = fusable('fuse-level', r)
  const s = run.state
  s.essence = 1e5
  // One part's kind three tiers up, the other's one.
  for (const t of [0, 0, 1]) apply(run, { type: 'upgrade', kind: high, track: t })
  apply(run, { type: 'upgrade', kind: low, track: 0 })
  const top = kindLevel(s, high)
  assert.ok(top > kindLevel(s, low) && top > levelOf({ tracks: [0, 0] }))
  apply(run, { type: 'fuse', id: r.id, parts: fuseParts(run, r.id) })
  const first = s.party.at(-1)
  assert.deepEqual([first.id, first.lvl, first.maxHp, s.kinds[r.result]], [r.result, top, baseStats(r.result, top).hp, { lvl: top, tracks: [0, 0], least: top }])
  // Its own tiers count only once they give more than that.
  apply(run, { type: 'upgrade', kind: r.result, track: 0 })
  assert.equal(first.lvl, Math.max(top, levelOf({ tracks: [1, 0] })))
  // Fused again from parts a tier higher still: the kind rises to them, the piece already held with it.
  apply(run, { type: 'upgrade', kind: high, track: 0 })
  const higher = kindLevel(s, high)
  for (const [id, n] of Object.entries(r.needs)) while (bodiesOf(s, id) < n) join(run, id)
  apply(run, { type: 'fuse', id: r.id, parts: fuseParts(run, r.id) })
  const want = Math.max(higher, levelOf(s.kinds[r.result]))
  assert.deepEqual([s.party.at(-1).lvl, first.lvl, s.kinds[r.result].least], [want, want, higher])
  // Let go of every piece of it and fused again: the kind keeps its level and its tiers.
  const kind = { ...s.kinds[r.result] }
  for (const u of souls(s.party).filter((x) => x.id === r.result)) apply(run, { type: 'release', uid: u.uid })
  for (const [id, n] of Object.entries(r.needs)) while (bodiesOf(s, id) < n) join(run, id)
  apply(run, { type: 'fuse', id: r.id, parts: fuseParts(run, r.id) })
  assert.deepEqual([s.party.at(-1).lvl, s.party.at(-1).tracks, s.kinds[r.result]], [kind.lvl, kind.tracks, kind])
  checkState(s)
})

test('legalActions lists one fuse a recipe that can be made, of its canonical parts: the ossuary\'s pieces first, then the fielded, the smallest stacks first', () => {
  for (const r of FUSION_LIST) {
    const run = createRun({ seed: 'fuse-legal-' + r.id })
    const s = run.state
    command(run, 6)
    s.essence = 1e4
    // Each kind: a fielded stack a body bigger than the recipe needs, and a piece of one in the ossuary.
    const held = Object.entries(r.needs).map(([kind, n]) => {
      const stack = souls(s.party).find((u) => u.id === kind) ?? join(run, kind)
      if (stack.slot < 0) apply(run, { type: 'place', uid: stack.uid, slot: firstFree(s) })
      while (stack.count < n + 1) join(run, kind, { onto: stack.uid })
      const spare = join(run, kind)
      if (spare.slot >= 0) apply(run, { type: 'place', uid: spare.uid, slot: OSSUARY })
      return { kind, n, stack, spare }
    })
    const fuses = () => legalActions(run).filter((a) => a.type === 'fuse')
    const expect = held.flatMap(({ n, stack, spare }) => [{ uid: spare.uid, n: 1 }, ...(n > 1 ? [{ uid: stack.uid, n: n - 1 }] : [])])
    assert.deepEqual(fuseParts(run, r.id), expect, 'the ossuary\'s piece first, then the stack')
    assert.deepEqual(fuses().filter((a) => a.id === r.id), [{ type: 'fuse', id: r.id, parts: expect }])
    // A fielded piece of one more each: smaller than the stack, so taken before it.
    const single = held.map(({ kind }) => {
      const u = join(run, kind)
      if (u.slot < 0) apply(run, { type: 'place', uid: u.uid, slot: firstFree(s) })
      return u
    })
    const then = held.flatMap(({ n, stack, spare }, i) => [{ uid: spare.uid, n: 1 }, ...(n > 1 ? [{ uid: single[i].uid, n: 1 }] : []), ...(n > 2 ? [{ uid: stack.uid, n: n - 2 }] : [])])
    assert.deepEqual(fuseParts(run, r.id), then)
    // Every fuse listed applies, and none when the essence falls short.
    for (const a of fuses()) apply({ ...run, state: structuredClone(s) }, a)
    s.essence = fuseCost(run, r.id) - 1
    assert.ok(!fuses().some((a) => a.id === r.id) && !canFuse(run, r.id))
    assert.equal(fuseParts(run, 'no_such_fusion'), null)
  }
})

// ── fuzz: random legal actions, invariants after every one, replay at the end ──────────────────

function checkState (s) {
  assert.ok(['map', 'prep', 'reap', 'over'].includes(s.phase), s.phase)
  const all = souls(s.party)
  assert.ok(all.length >= 1 && soulCount(s.party) <= TUNING.party.roster + 3 * s.relics.filter((r) => r === 'ossuary_key').length)
  assert.ok(Number.isInteger(s.essence) && s.essence >= 0, `essence ${s.essence}`)
  assert.equal(new Set(s.party.map((u) => u.uid)).size, s.party.length, 'unique uids')
  assert.ok(s.party.every((u) => u.uid < s.nextUid || u.uid === MONARCH_UID), 'uids below nextUid')
  checkField(s)
  const command = s.relics.reduce((n, id) => n + (RELICS[id].command ?? 0), 0)
  assert.equal(commandOf(s), baseField(s) + command)
  assert.ok(fielded(all).length <= commandOf(s), 'field cap')
  // The Monarch: one, always on its camp's seat, with no level and no points: its max HP its base and its HP relics';
  // no kind, no tracks; it stands until the run is over.
  const m = s.party.filter((u) => u.id === 'monarch')
  assert.deepEqual(m.map((u) => u.uid), [MONARCH_UID])
  assert.equal(m[0].slot, monarchSlot(s.camp), 'the Monarch on its seat')
  assert.deepEqual([m[0].lvl, m[0].maxHp, m[0].tracks], [0, monarchHp(s), [0, 0]])
  assert.ok(!('monarch' in s.kinds) && !('monarch' in s))
  if (s.phase !== 'over') assert.ok(m[0].hp > 0, 'the Monarch stands')
  assert.equal(s.result === 'defeat', !!s.death)
  for (const u of all) {
    assert.ok(Number.isInteger(u.hp) && u.hp >= 0 && u.hp <= u.maxHp, `${u.id} hp ${u.hp}/${u.maxHp}`)
    assert.ok(u.lvl >= 1 && u.lvl <= levelOf({ tracks: [4, 2] }), `${u.id} lvl ${u.lvl}`)
    // Upgrades are the kind's: every soul holds its kind's level and tiers, within the crosspath rule.
    const kind = s.kinds[u.id]
    assert.ok(kind, `${u.id}: a kind`)
    assert.deepEqual([u.lvl, u.tracks], [kind.lvl, kind.tracks], `${u.id} ${u.uid}`)
    assert.ok(Number.isInteger(u.count) && u.count >= 1, `${u.id} ${u.uid} count ${u.count}`)
    assert.equal(u.maxHp, u.count * baseStats(u.id, u.lvl).hp, `${u.id} ${u.uid} max HP: a pool of count × body`)
    assert.ok(!['grade', 'path', 'tier', 'path2', 'tier2'].some((k) => k in u), `${u.id}: no rank, no path`)
  }
  for (const [id, k] of Object.entries(s.kinds)) {
    assert.ok(k.lvl >= 1 && k.tracks.length === 2 && k.lvl === levelOf(k), `${id} ${JSON.stringify(k)}: its level is its tiers'`)
    assert.ok(k.tracks.every((t) => Number.isInteger(t) && t >= 0 && t <= 4) && !(k.tracks[0] > 2 && k.tracks[1] > 2), `${id} ${k.tracks}`)
  }
  assert.ok(Number.isInteger(m[0].hp) && m[0].hp >= 0 && m[0].hp <= m[0].maxHp)
  // The army is souls in pieces: no muster or binds kept; no shadow or boss ever in the retinue (the ossuary is the
  // pieces off the field); the offers are souls, relics (Legendaries among them) and tiers.
  for (const k of ['ossuary', 'muster', 'freeBinds']) assert.ok(!(k in s), k)
  for (const u of all) assert.ok(!UNITS[u.id].boss && !u.shadow && !('cohort' in u), u.id)
  assert.ok(s.offers.every((o) => ['soul', 'relic', 'tier'].includes(o.type)), JSON.stringify(s.offers))
  assert.ok(fieldCap({ state: s }) <= TUNING.army.board)
  // No lines, no detachments: a piece holds its cell.
  assert.ok(!('detachments' in s) && !('lines' in s))
  // Relics: known, as many copies as taken (no cap); an offer is a known relic of its tier, one that needs Arise
  // only once it is held; nothing bought for the Monarch, no level bought.
  assert.ok(s.relics.every((id) => RELICS[id]), JSON.stringify(s.relics))
  for (const o of s.offers.filter((x) => x.type === 'relic')) {
    assert.ok(RELICS[o.id] && o.tier === RELICS[o.id].tier && (!RELICS[o.id].needsArise || s.relics.includes('arise')), JSON.stringify(o))
  }
  assert.ok(!s.log.some((a) => a.type === 'monarch' || a.type === 'level'), 'no Monarch points, no levels bought')
}


// A steady hand, standing in for a player (the autoplayer is tested on its own): it makes any fusion it can, walks
// to a random room, fields a piece from the ossuary or buys a tier now and then before it fights, and takes the
// first offer it can afford.
function steady (run, rng) {
  const s = run.state
  const legal = legalActions(run)
  const of = (type) => legal.filter((a) => a.type === type)
  if (of('fuse').length) return rng.pick(of('fuse'))
  if (s.phase === 'map') return rng.pick(of('node'))
  if (s.phase === 'prep') {
    const out = of('place').filter((a) => a.slot >= 0 && s.party.find((u) => u.uid === a.uid).slot === OSSUARY)
    if (out.length && rng.chance(0.5)) {
      const uid = rng.pick([...new Set(out.map((a) => a.uid))])
      return rng.pick(out.filter((a) => a.uid === uid))
    }
    return of('upgrade').length && rng.chance(0.3) ? rng.pick(of('upgrade')) : of('fight')[0]
  }
  return legal.find((a) => a.type === 'reap' && a.index !== null) ?? legal[0]
}

// A uniformly random legal action: a kind of action first, then one of that kind (places would drown out the rest).
function anyLegal (legal, rng) {
  const type = rng.pick([...new Set(legal.map((a) => a.type))])
  return rng.pick(legal.filter((a) => a.type === type))
}

// A fuzz run, made ready outside its log (so rebuilt by `ready` and its log, not by replay): run `k` starts k % 3
// floors down; every other one with a purse topped up, a Command relic (room for a fused piece) and the souls a
// recipe needs, so fusions come up; and every fourth with its kinds at their top tiers (level 10) and the Monarch's
// HP, Command and Arise twice from relics, so it lives to see more rooms.
function ready (seed, k) {
  const run = createRun({ seed })
  const s = run.state
  for (let f = 0; f < k % 3; f++) nextFloor(run)
  if (k % 2) {
    s.essence += 500
    s.relics.push('grave_banner')
    for (const [kind, n] of Object.entries(FUSION_LIST[k % FUSION_LIST.length].needs)) for (let j = 0; j < n; j++) join(run, kind)
  }
  if (k % 4 === 3) {
    s.essence += 1e4
    for (const kind of Object.keys(s.kinds)) for (const track of [0, 0, 0, 0, 1, 1]) apply(run, { type: 'upgrade', kind, track })
    // The relics (outside the log, as the rest of this setup): HP, Command, and Arise twice.
    s.relics.push('phylactery', 'grave_banner', 'arise', 'arise')
    Object.assign(monarchOf(s), { hp: monarchHp(s), maxHp: monarchHp(s) })
    s.essence = 200
  }
  s.log = []
  return run
}

// The run rebuilt from its start and its log is the run.
function rebuilt (run, k) {
  const again = ready(run.state.seed, k)
  for (const action of run.state.log) apply(again, action)
  return again
}

// A fifth of the time a random legal action, else the steady hand's. `fought(run)` sees each battle once it is over.
function fuzz (seed, k, seen, fought = () => {}, offered = { legendaries: 0 }) {
  const rng = createRng(seed).stream('fuzz')
  const run = ready(seed, k)
  for (let steps = 0; run.state.phase !== 'over'; steps++) {
    assert.ok(steps < 1e5, 'stuck')
    const legal = legalActions(run)
    assert.ok(legal.length > 0)
    const isLegendary = (a) => a.type === 'reap' && a.index !== null && offerGroup(run.state.offers[a.index]) === 'legendary'
    if (legal.some(isLegendary)) offered.legendaries++
    // A Legendary on offer is taken half the time (the steady hand would take a soul or a relic first), so the runs
    // that reach one carry Legendaries into their battles.
    const legendary = legal.find(isLegendary)
    const action = legendary && rng.chance(0.5) ? legendary : rng.chance(0.2) ? anyLegal(legal, rng) : steady(run, rng)
    seen.add(action.type)
    if (action.onto !== undefined) seen.add('reap onto')
    apply(run, action)
    if (action.type === 'fight') fought(run)
    checkState(run.state)
    if (steps % 17 === 0) everyLegalActionApplies(run, k)
  }
  return run
}

// The run rebuilt is the run, and each legal action applies cleanly to a copy of it (one rebuild, cloned per
// action: a long run's log is a whole run of battles to refight).
function everyLegalActionApplies (run, k) {
  const base = rebuilt(run, k)
  assert.deepEqual(base.state, run.state)
  const legal = legalActions(run)
  for (const action of legal.filter((_, i) => i % Math.ceil(legal.length / 12) === 0)) {
    const copy = { ...base, state: structuredClone(base.state) }
    assert.doesNotThrow(() => apply(copy, action), JSON.stringify(action))
  }
}

test('fuzz: 120 runs of random legal actions keep every invariant, cover every action, fight with 2×2 pieces, and rebuild exactly', () => {
  const results = {}
  const seen = new Set()
  let big = 0
  let legendaries = 0
  const offered = { legendaries: 0 }
  for (let k = 0; k < 120; k++) {
    const run = fuzz('fuzz' + k, k, seen, (r) => { big += r.setup.party.some((u) => sizeOf(u) === 2) }, offered)
    results[run.state.floor] = (results[run.state.floor] ?? 0) + 1
    legendaries += run.state.relics.filter((id) => RELICS[id].tier === 'legendary').length
    assert.deepEqual(rebuilt(run, k).state, run.state)
  }
  assert.ok(Object.keys(results).length > 1, `fuzz runs should end on different floors: ${JSON.stringify(results)}`)
  // Legendaries come from floor 2's elites and rites: those offered are taken.
  assert.ok(!offered.legendaries || legendaries > 0, `Legendaries offered ${offered.legendaries} times, taken ${legendaries}: ${JSON.stringify(results)}`)
  // Every action the run has, a recruit onto a piece too (tracks.test.js fuzzes the levels and tiers harder).
  assert.deepEqual([...seen].sort(), ['fight', 'fuse', 'node', 'place', 'reap', 'reap onto', 'release', 'split', 'stack', 'upgrade'])
  assert.ok(big > 0, 'a 2×2 piece fought')
})
