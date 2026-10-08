import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRun, apply, legalActions, availableNodes, replay, join, currentNode, fielded, levelCost, tierCost, rosterCap, fieldCap,
  MONARCH_UID, MONARCH_STATS, monarchOf, souls, monarchCost, monarchPoints, domainOf, faltersAt, battleSetup, encounter, drawRoom, roomThreats,
  foeEssence, canLead, standingOf, freeBodies, musterCost, bindCost, armyLayout, isSquare, detachmentOf, DEFAULT_PLAN, cohortCap, baseField
} from '../src/sim/run.js'
import { createBattle, runBattle, stats } from '../src/sim/battle.js'
import { autoplay, policy, rehearsalBudget, LEVELS, scoreOf, planFor, armyWish, detachmentsOf, rehearse, replan } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { generateFloor } from '../src/sim/map.js'
import { TUNING } from '../src/tuning.js'
import { tuned, FIRST_BALANCE } from './tuned.js'
import { RELICS, UNITS, ROLES, SHAPES, ORDERS, DETACHMENT_COLORS } from '../src/content.js'
import {
  CAMP_SLOTS, CAMP_ROWS, campOpen, isWall, abilitiesOf, auraOf, statsOf, pathsOf, slotAt, rowOf, colOf, baseStats, makeUnit, tileAt,
  nearestOpen, campGrid, deployTile, distance, wallTiles, TILES, pathsClash
} from '../src/sim/unit.js'
import { CAMP_LIST } from '../src/content.js'
import { KEYSTONES } from '../src/content.js'

const play = (seed) => autoplay(createRun({ seed }), { rng: createRng(seed).stream('autoplay') })
// Rules of thumb, but with the Monarch mid-camp and wounds counted: cheap, and it gets past floor 1 often
// enough to carry tests onto later floors (basic mostly dies on floor 1).
const STEADY = { ...LEVELS.basic, wounds: true, park: false }

// Turn the first reachable node into `type` so a test can visit one on demand. Battle rooms keep
// their foes; a room that had none gets the first battle room's.
function visit (run, type) {
  const node = availableNodes(run)[0]
  node.type = type
  if (['fight', 'elite', 'boss'].includes(type)) node.foes ??= run.state.map.nodes.find((n) => n.foes).foes
  apply(run, { type: 'node', id: node.id })
  return node
}

// Play the autoplay policy until `done(run)` holds or the run ends.
function autoplayTo (run, done, level = 'basic') {
  const rng = createRng(run.state.seed).stream('autoplay')
  while (run.state.phase !== 'over' && !done(run)) apply(run, policy(run, rng, level))
}

// Visit fights until one is won (on one of 200 seeds, or the test fails rather than spins). `ready` may
// make each run ready first, through its own actions (so it still replays).
function winFight (prefix, ready = () => {}) {
  for (let i = 0; i < 200; i++) {
    const run = createRun({ seed: prefix + i })
    ready(run)
    visit(run, 'fight')
    apply(run, { type: 'fight' })
    if (run.state.phase === 'reap') return run
  }
  assert.fail(`no ${prefix} seed won its fight`)
}

test('a new run: the Monarch and the start retinue at level 2 on floor 1, all fielded, every battle room scouted', () => {
  const run = createRun({ seed: 'new' })
  const s = run.state
  assert.deepEqual(s.party.map((u) => [u.id, u.lvl, u.uid]), [['monarch', 0, MONARCH_UID], ['tomb_knight', 2, 1], ['bone_chanter', 2, 2], ['frost_sprite', 2, 3]])
  assert.equal(new Set(s.party.map((u) => u.slot)).size, 4)
  assert.ok(s.party.every((u) => u.slot >= 0))
  assert.deepEqual([s.monarch, s.death, fielded(souls(s.party)).length, fieldCap(run)], [{ dominion: 0, command: 0, will: 0 }, null, 3, 3])
  assert.equal(monarchOf(s).maxHp, TUNING.monarch.hp)
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
    { type: 'monarch', stat: 'might' }, { type: 'monarch' }
  ]
  for (const action of bad) assert.throws(() => apply(run, action), undefined, JSON.stringify(action))
  assert.deepEqual(run.state.log, [])
})

test('legalActions per phase', () => {
  const run = createRun({ seed: 'legal' })
  const kinds = (r) => [...new Set(legalActions(r).map((a) => a.type))].sort()
  run.state.essence = 0
  assert.deepEqual(kinds(run), ['node', 'order', 'place', 'release'])
  run.state.essence = 1000
  assert.deepEqual(kinds(run), ['level', 'monarch', 'muster', 'node', 'order', 'place', 'release', 'upgrade'])
  assert.deepEqual(legalActions(run).filter((a) => a.type === 'monarch').map((a) => a.stat), MONARCH_STATS)
  assert.ok(!legalActions(run).some((a) => a.uid === MONARCH_UID && ['level', 'upgrade', 'release'].includes(a.type)))
  assert.ok(!legalActions(run).some((a) => a.type === 'place' && a.uid === MONARCH_UID && a.slot === -1))
  run.state.essence = 0
  visit(run, 'fight')
  assert.equal(run.state.phase, 'prep')
  assert.deepEqual(kinds(run), ['fight', 'order', 'place', 'release'])
  apply(run, { type: 'fight' })
  if (run.state.phase === 'over') return
  // The first body bound is free, so binding is legal even when poor.
  assert.deepEqual(kinds(run), ['bind', 'reap', 'release'])
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

test('place: field slots swap, the bench holds souls back, and the field has a cap', () => {
  const run = createRun({ seed: 'place' })
  const [knight, chanter] = souls(run.state.party)
  const a = knight.slot
  const b = chanter.slot
  apply(run, { type: 'place', uid: knight.uid, slot: b })
  assert.equal(knight.slot, b)
  assert.equal(chanter.slot, a)
  apply(run, { type: 'place', uid: knight.uid, slot: -1 })
  assert.equal(knight.slot, -1)
  assert.equal(fielded(souls(run.state.party)).length, 2)
  while (souls(run.state.party).length < 8) join(run, 'clockwork_page')
  assert.equal(fielded(souls(run.state.party)).length, TUNING.party.field, 'new souls fill the field, then the bench')
  const free = [...Array(CAMP_SLOTS).keys()].find((slot) => campOpen(run.state.camp, slot) && !run.state.party.some((u) => u.slot === slot))
  assert.throws(() => apply(run, { type: 'place', uid: knight.uid, slot: free }), /cannot place/)
  apply(run, { type: 'place', uid: knight.uid, slot: chanter.slot })
  assert.equal(knight.slot, a)
  assert.equal(chanter.slot, -1, 'a benched soul swaps with the one it replaces')
})

test('each floor draws a camp from its own list, and souls on its walls move to open ground', () => {
  const seen = new Set()
  for (let i = 0; i < 30; i++) {
    const run = createRun({ seed: 'camp' + i })
    assert.equal(CAMP_LIST.find((c) => c.id === run.state.camp).floor, 1)
    seen.add(run.state.camp)
  }
  assert.equal(seen.size, CAMP_LIST.filter((c) => c.floor === 1).length, 'every floor-1 camp turns up')
  // On to floor 2: its camp is from floor 2's list, and nobody is left standing on a wall.
  const run = createRun({ seed: 'walls' })
  const s = run.state
  autoplayTo(run, () => s.floor === 2, STEADY)
  if (s.phase === 'over') return
  assert.equal(CAMP_LIST.find((c) => c.id === s.camp).floor, 2)
  for (const u of fielded(s.party)) assert.ok(campOpen(s.camp, u.slot))
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

test('reliquary offers 3 distinct relics; taking one keeps it, skipping takes nothing', () => {
  const run = createRun({ seed: 'gold' })
  visit(run, 'reliquary')
  const { offers } = run.state
  assert.equal(run.state.phase, 'reap')
  assert.equal(offers.length, 3)
  assert.ok(offers.every((o) => o.type === 'relic' && RELICS[o.id]))
  assert.equal(new Set(offers.map((o) => o.id)).size, 3)
  apply(run, { type: 'reap', index: 1 })
  assert.deepEqual(run.state.relics, [offers[1].id])
  assert.equal(run.state.phase, 'map')
  visit(run, 'reliquary')
  assert.ok(!run.state.offers.some((o) => o.id === offers[1].id), 'no duplicate relics')
  apply(run, { type: 'reap', index: null })
  assert.equal(run.state.relics.length, 1)
})

test('a won fight pays essence and puts one soul per kind slain up for sale; one may be recruited', () => {
  const run = winFight('fight')
  const s = run.state
  const slain = run.battle.units.filter((u) => u.side === 'foe' && u.hp <= 0)
  const sale = s.offers.filter((o) => o.type === 'soul')
  assert.deepEqual(new Set(sale.map((o) => o.id)), new Set(slain.map((u) => u.id)))
  assert.ok(sale.every((o) => o.cost > 0 && o.lvl === Math.max(...slain.filter((u) => u.id === o.id).map((u) => u.lvl))))
  assert.deepEqual(s.offers.map((o) => o.type), [...sale.map(() => 'soul'), ...sale.map(() => 'bind')], 'souls, then the bodies to bind')
  assert.ok(s.essence > TUNING.essence.start && s.stats.essence === s.essence - TUNING.essence.start)
  assert.ok(souls(s.party).every((u) => u.lvl === 2), 'no XP: levels only rise when bought')
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
  assert.equal(s.phase, 'reap', 'the bodies are still there to bind')
  apply(run, { type: 'reap', index: null })
  assert.equal(s.phase, 'map')
  checkState(s)
})

test('essence buys levels and path tiers; the first tier commits a soul to its path', () => {
  const run = createRun({ seed: 'buy' })
  const s = run.state
  const knight = s.party.find((u) => u.id === 'tomb_knight')
  s.essence = 0
  assert.throws(() => apply(run, { type: 'level', uid: knight.uid }), /cannot level/)
  s.essence = 5000
  assert.throws(() => apply(run, { type: 'level', uid: MONARCH_UID }), /cannot level/)
  assert.throws(() => apply(run, { type: 'upgrade', uid: MONARCH_UID, path: 'bulwark' }), /cannot upgrade/)
  s.essence = 0
  s.essence = 5000
  const cost = levelCost(run, knight)
  const hp = knight.maxHp
  apply(run, { type: 'level', uid: knight.uid })
  assert.deepEqual([knight.lvl, s.essence], [3, 5000 - cost])
  assert.ok(knight.maxHp > hp && knight.hp === knight.maxHp)
  const [bulwark, reaver] = pathsOf('tomb_knight')
  const def = statsOf(knight).def
  apply(run, { type: 'upgrade', uid: knight.uid, path: bulwark.id })
  assert.deepEqual([knight.path, knight.tier], [bulwark.id, 1])
  assert.ok(statsOf(knight).def > def, 'tier I raises DEF')
  assert.throws(() => apply(run, { type: 'upgrade', uid: knight.uid, path: reaver.id }), /cannot upgrade/)
  assert.ok(!legalActions(run).some((a) => a.type === 'upgrade' && a.uid === knight.uid && a.path === reaver.id))
  apply(run, { type: 'upgrade', uid: knight.uid, path: bulwark.id })
  apply(run, { type: 'upgrade', uid: knight.uid, path: bulwark.id })
  assert.equal(auraOf(knight).range, 2, 'Bulwark III widens its aura')
  assert.throws(() => apply(run, { type: 'upgrade', uid: knight.uid, path: bulwark.id }), /cannot upgrade/)
  const sprite = s.party.find((u) => u.id === 'frost_sprite')
  for (let i = 0; i < 3; i++) apply(run, { type: 'upgrade', uid: sprite.uid, path: 'rimeblade' })
  assert.deepEqual(abilitiesOf(sprite), ['shatter_lance'])
  assert.equal(s.stats.spent, 5000 - s.essence)
})

test('a rite offers free next tiers, each for a different soul, and taking one ends it', () => {
  const run = createRun({ seed: 'rite' })
  const s = run.state
  visit(run, 'rite')
  assert.equal(s.phase, 'reap')
  assert.equal(s.offers.length, 3)
  assert.ok(s.offers.every((o) => o.type === 'tier'))
  assert.equal(new Set(s.offers.map((o) => o.uid)).size, 3)
  const o = s.offers[1]
  const essence = s.essence
  apply(run, { type: 'reap', index: 1 })
  const u = s.party.find((x) => x.uid === o.uid)
  assert.deepEqual([u.path, u.tier, s.essence, s.phase], [o.path, 1, essence, 'map'])
})

test('releasing a soul during a rite withdraws its offer, and a rite left with none ends', () => {
  const run = createRun({ seed: 'rite-release' })
  const s = run.state
  visit(run, 'rite')
  const [first, ...rest] = s.offers
  apply(run, { type: 'release', uid: first.uid })
  assert.deepEqual(s.offers, rest)
  for (const o of rest) if (souls(s.party).length > 1) apply(run, { type: 'release', uid: o.uid })
  assert.equal(s.phase, s.offers.length ? 'reap' : 'map')
})

test('a full retinue must release a soul before it can recruit', () => {
  const run = winFight('full')
  const s = run.state
  s.essence = 1e5
  while (souls(s.party).length < rosterCap(run)) join(run, 'clockwork_page')
  assert.ok(!legalActions(run).some((a) => a.type === 'reap' && a.index !== null))
  assert.throws(() => apply(run, { type: 'reap', index: 0 }), /release a soul first/)
  const benched = s.party.find((u) => u.slot < 0)
  apply(run, { type: 'release', uid: benched.uid })
  assert.equal(s.phase, 'reap')
  apply(run, { type: 'reap', index: 0 })
  assert.equal(souls(s.party).length, rosterCap(run))
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

// A run can still be won with a Monarch to keep alive: a rich one (its purse topped up, Monarch points
// bought up to six a floor, past the souls' level cap: its HP is its points' alone, no synergy or relic adds
// to it) plays to the boss and kills it, every state sane.
// Not replayed: the purse and the points are bought outside the log's policy.
test('a strong run clears all four floors: the boss falls, the Monarch stands on the last camp, and nothing felled it', () => {
  const run = createRun({ seed: 'rich' })
  const s = run.state
  const rng = createRng(s.seed).stream('autoplay')
  while (s.phase !== 'over') {
    if (s.essence < 5000) s.essence = 1e5
    const points = monarchPoints(s)
    apply(run, ['map', 'prep'].includes(s.phase) && points < 6 * s.floor ? { type: 'monarch', stat: MONARCH_STATS[points % 3] } : policy(run, rng, STEADY))
    checkState(s)
  }
  assert.deepEqual([s.result, s.death, s.floor, s.stats.floorsCleared], ['victory', null, TUNING.run.floors, TUNING.run.floors])
  assert.equal(run.battle.boss, true)
  assert.ok(campOpen(s.camp, monarchOf(s).slot) && monarchOf(s).hp > 0)
  assert.ok(monarchPoints(s) > TUNING.level.cap, 'the Monarch\'s level runs past the souls\' cap')
})

test('the autoplayer uses the choices a player has: open cells only', () => {
  const check = (b, r) => {
    for (const u of r.setup.party) assert.ok(campOpen(r.setup.camp, u.slot), `${u.id} on ${u.slot} in ${r.setup.camp}`)
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

// The basic player parks the Monarch at the back and leaves it there; the expert searches its cell with
// the souls' and buys it points.
test('the autoplayer and the Monarch: basic parks it on the rear row, the expert moves it and spends on it', () => {
  const rear = (camp) => nearestOpen(campGrid(camp), slotAt(CAMP_ROWS - 1, 3))
  for (let i = 0; i < 4; i++) {
    const run = autoplay(createRun({ seed: 'park' + i }), {
      onBattle: (b, r) => assert.equal(r.setup.party.find((u) => u.uid === MONARCH_UID).slot, rear(r.setup.camp), `park${i} floor ${b.floor}`)
    })
    assert.deepEqual([run.state.monarch.dominion, run.state.monarch.will], [0, 0], 'basic buys only Command')
  }
  // The expert's drafts put the Monarch on the rear row or mid-camp; only the hill-climb takes it elsewhere.
  // (A seed whose expert clears floor 1: floor 1 is hard, and one lost before a point is bought proves nothing.)
  const run = createRun({ seed: 'monarch-expert0' })
  const rng = createRng('monarch-expert0').stream('autoplay')
  const fights = []
  const bought = []
  while (run.state.floor === 1 && run.state.phase !== 'over') {
    const action = policy(run, rng, 'expert')
    if (action.type === 'monarch') bought.push(action.stat)
    apply(run, action)
    if (action.type !== 'fight') continue
    const grid = campGrid(run.setup.camp)
    const drafted = [nearestOpen(grid, slotAt(CAMP_ROWS - 1, 3)), nearestOpen(grid, slotAt(ROLES.monarch.autoRow, 3))]
    fights.push({ slot: run.setup.party.find((u) => u.uid === MONARCH_UID).slot, drafted })
  }
  assert.ok(fights.some((f) => !f.drafted.includes(f.slot)), `the Monarch stood in ${fights.map((f) => f.slot)}`)
  assert.ok(bought.length > 0, 'it bought a Monarch point')
})

// The plan is carried out, the Monarch's cell included, from wherever the player left it: basic walks it
// back to the rear row's middle lane, the expert to the cell its search chose.
test('the autoplayer moves the Monarch to its planned cell before it fights, and every soul to its own', () => {
  for (const level of ['basic', 'expert']) {
    const run = createRun({ seed: 'prep' })
    const s = run.state
    visit(run, 'fight')
    const start = [slotAt(2, 3), slotAt(2, 2), slotAt(3, 3)].find((slot) => campOpen(s.camp, slot) && !s.party.some((u) => u.slot === slot))
    apply(run, { type: 'place', uid: MONARCH_UID, slot: start })
    const rng = createRng('prep').stream('autoplay')
    for (let action; (action = policy(run, rng, level)).type !== 'fight';) apply(run, action)
    const plan = planFor(run, LEVELS[level])
    const cell = plan.find((p) => p.uid === MONARCH_UID).slot
    assert.notEqual(cell, start, `${level}: the plan moves it`)
    if (level === 'basic') assert.equal(cell, nearestOpen(campGrid(s.camp), slotAt(CAMP_ROWS - 1, 3)), 'basic parks it on the rear row')
    assert.equal(monarchOf(s).slot, cell, `${level}: the Monarch stands where it was planned`)
    for (const p of plan) assert.equal(s.party.find((u) => u.uid === p.uid).slot, p.slot, `${level}: uid ${p.uid}`)
    assert.deepEqual(s.party.filter((u) => u.slot === cell).map((u) => u.uid), [MONARCH_UID])
  }
})

// The expert buys a Monarch point only when rehearsing the fights ahead says it beats the same essence
// spent on its souls: Command with two strong souls waiting, and nothing when no point can change a battle.
test('the expert spends on the Monarch by rehearsal: Command for souls that wait, never a point that does nothing', () => {
  const rng = createRng('wish').stream('autoplay')
  const waiting = createRun({ seed: 'wish' })
  visit(waiting, 'fight')
  join(waiting, 'grave_ghoul', { lvl: 6 })
  join(waiting, 'tomb_knight', { lvl: 6 })
  waiting.state.essence = monarchCost(waiting)
  assert.deepEqual([fieldCap(waiting), souls(waiting.state.party).filter((u) => u.slot < 0).length], [3, 2])
  assert.equal(armyWish(waiting), 'command')
  assert.deepEqual(policy(waiting, rng, 'expert'), { type: 'monarch', stat: 'command' })
  // Every point made worthless: the domain already covers the board, a point adds no HP, no one waits for
  // a banner, and every foe ahead is of a tier Will 1 cannot raise. The souls' levels win.
  const M = { ...TUNING.monarch }
  try {
    Object.assign(TUNING.monarch, { domain: 99, hpPerPoint: 0, raiseTier: 1 })
    const idle = createRun({ seed: 'wish' })
    for (const n of idle.state.map.nodes) if (n.foes) n.foes = n.foes.map((f) => ({ ...f, id: 'iron_golem' }))
    visit(idle, 'fight')
    idle.state.essence = 200
    assert.equal(armyWish(idle), null)
    assert.notEqual(policy(idle, rng, 'expert').type, 'monarch')
  } finally {
    Object.assign(TUNING.monarch, M)
  }
})

// Basic buys Command once two standing souls would wait on the bench with every banner filled: one point
// for two souls, and then it fields them. Never for one, never for the fallen, and never another stat.
test('basic buys one Command point for two souls waiting on the bench, then fields them', () => {
  const b = createRun({ seed: 'command' })
  const s = b.state
  const rng = createRng('command').stream('autoplay')
  s.essence = 1000
  join(b, 'grave_ghoul')
  join(b, 'grave_ghoul')
  visit(b, 'fight')
  const bought = []
  for (let action; (action = policy(b, rng, 'basic')).type !== 'fight';) {
    if (action.type === 'monarch') bought.push(action.stat)
    apply(b, action)
  }
  assert.deepEqual(bought, ['command'])
  assert.deepEqual([fieldCap(b), fielded(souls(s.party)).length, souls(s.party).length], [4, 4, 5])
  // One waiting soul buys nothing; nor do two, if one of them has fallen.
  const one = createRun({ seed: 'command' })
  one.state.essence = 1000
  join(one, 'grave_ghoul')
  assert.notEqual(policy(one, rng, 'basic').type, 'monarch')
  const fallen = createRun({ seed: 'command' })
  fallen.state.essence = 1000
  join(fallen, 'grave_ghoul')
  join(fallen, 'grave_ghoul').hp = 0
  assert.notEqual(policy(fallen, rng, 'basic').type, 'monarch')
})

test('a rehearsal scores a fallen Monarch as a loss, whoever else stands, and leaves shadows out of a win', () => {
  const on = (id, uid, side, slot, lvl = 3) => ({ ...makeUnit(id, { uid, lvl }), side, slot })
  // The Monarch in front, its soul held at the back; a Wisp out-shoots it.
  const lost = createBattle({ party: [on('monarch', 0, 'party', slotAt(0, 3)), on('tomb_knight', 1, 'party', slotAt(6, 0), 9)], foes: [on('will_o_wisp', 10, 'foe', slotAt(0, 3), 9)], seed: 's' })
  lost.units.find((u) => u.uid === 1).nextStep = Infinity
  runBattle(lost)
  assert.deepEqual([lost.winner, lost.reason], ['foe', 'monarch'])
  assert.ok(lost.units.find((u) => u.uid === 1).hp > 0 && scoreOf(lost) <= -3 && scoreOf(lost) >= -4, 'a loss weighs more than any win')
  const won = createBattle({ party: [on('monarch', 0, 'party', slotAt(3, 3)), on('tomb_knight', 1, 'party', slotAt(0, 3), 9)], foes: [on('grave_ghoul', 10, 'foe', slotAt(0, 3), 1)], seed: 's' })
  runBattle(won)
  assert.equal(won.winner, 'party')
  const kept = won.units.find((u) => u.uid === 1)
  const expect = 1 + (kept.hp / kept.maxHp + won.monarch.hp / won.monarch.maxHp) / 2
  won.units.push({ side: 'party', shadow: true, hp: 0, maxHp: 500 })
  assert.ok(Math.abs(scoreOf(won) - expect) < 1e-9)
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
    const live = play('replay' + i)
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

test('the Monarch starts on the rear row, middle lane, or the open cell nearest it, its souls inside its domain; it can move but never to the bench', () => {
  for (const c of CAMP_LIST.filter((x) => x.floor === 1)) {
    let run
    for (let i = 0; !run || run.state.camp !== c.id; i++) run = createRun({ seed: 'throne' + i })
    const m = monarchOf(run.state)
    assert.equal(m.slot, nearestOpen(campGrid(c.id), slotAt(CAMP_ROWS - 1, 3)))
    assert.equal(rowOf(m.slot), CAMP_ROWS - 1)
    assert.ok(souls(run.state.party).every((u) => u.slot >= 0 && !faltersAt(run.state, u.slot)), `${c.id}: the start souls stand in the domain`)
  }
  const run = createRun({ seed: 'throne' })
  const s = run.state
  const m = monarchOf(s)
  const [knight, chanter] = souls(s.party)
  // It swaps cells with a soul like any soul.
  const was = m.slot
  apply(run, { type: 'place', uid: MONARCH_UID, slot: knight.slot })
  assert.deepEqual([knight.slot, rowOf(was)], [was, CAMP_ROWS - 1])
  // A benched soul cannot take its cell (that would bench it), though one can take a free cell.
  apply(run, { type: 'place', uid: chanter.uid, slot: -1 })
  assert.throws(() => apply(run, { type: 'place', uid: chanter.uid, slot: m.slot }), /cannot place/)
  assert.throws(() => apply(run, { type: 'place', uid: MONARCH_UID, slot: -1 }), /cannot place/)
  // It takes no room: three souls fill the field beside it, and it is never released.
  apply(run, { type: 'place', uid: chanter.uid, slot: [...Array(CAMP_SLOTS).keys()].find((t) => campOpen(s.camp, t) && !s.party.some((u) => u.slot === t)) })
  assert.equal(fielded(s.party).length, fieldCap(run) + 1)
  assert.throws(() => join(run, 'monarch'), /one Monarch/)
})

test('Monarch points: Dominion, Command and Will, at 20 + 10 per point bought, each raising its level and HP', () => {
  const run = createRun({ seed: 'crown' })
  const s = run.state
  const m = monarchOf(s)
  s.essence = 0
  assert.throws(() => apply(run, { type: 'monarch', stat: 'will' }), /cannot raise/)
  s.essence = 1000
  m.hp = 50
  let spent = 0
  for (const [k, stat] of ['command', 'dominion', 'will', 'command'].entries()) {
    const cost = monarchCost(run)
    assert.equal(cost, TUNING.monarch.cost + TUNING.monarch.costPerPoint * k)
    const hp = m.hp
    const maxHp = m.maxHp
    apply(run, { type: 'monarch', stat })
    spent += cost
    assert.deepEqual([m.lvl, monarchPoints(s), m.maxHp], [k + 1, k + 1, baseStats('monarch', k + 1).hp])
    assert.equal(m.hp, hp + m.maxHp - maxHp, 'a point heals by what it adds')
  }
  assert.deepEqual([s.monarch, s.essence], [{ dominion: 1, command: 2, will: 1 }, 1000 - spent])
  // Command: banners. Dominion: the domain. Will: Arise. The battle gets them all.
  assert.equal(fieldCap(run), TUNING.party.field + 2)
  assert.equal(domainOf(s), TUNING.monarch.domain + 1)
  visit(run, 'fight')
  const setup = battleSetup(run)
  assert.deepEqual([setup.domain, setup.will, setup.nextUid], [domainOf(s), 1, s.nextUid + setup.foes.length])
  assert.equal(setup.party.find((u) => u.uid === MONARCH_UID).maxHp, m.maxHp)
  // Its level is the points bought, with no cap: past the souls' at 12.
  s.essence = 1e6
  while (monarchPoints(s) < 12) apply(run, { type: 'monarch', stat: 'will' })
  assert.ok(12 > TUNING.level.cap)
  assert.deepEqual([m.lvl, m.maxHp], [12, baseStats('monarch', 12).hp])
})

test('a camp cell outside the domain falters: faltersAt measures from the Monarch', () => {
  const run = createRun({ seed: 'domain' })
  const s = run.state
  const m = monarchOf(s)
  for (let slot = 0; slot < CAMP_SLOTS; slot++) {
    const far = distance(deployTile('party', slot), deployTile('party', m.slot)) > domainOf(s)
    assert.equal(faltersAt(s, slot), far && slot !== m.slot, `slot ${slot}`)
  }
  assert.ok(faltersAt(s, slotAt(0, 3)), 'from the rear row the front row falters')
  s.monarch.dominion = 3
  assert.ok(!faltersAt(s, slotAt(0, 3)))
})

test('a fight: shadows never join the retinue and the run moves past their uids; wounds carry; a fallen Monarch ends the run', () => tuned(FIRST_BALANCE, () => {
  // Behind the line, where corpses fall in reach; with `hp`, wounded before the fight.
  const fightFrom = (seed, hp) => {
    const run = createRun({ seed })
    run.state.monarch.will = 1
    visit(run, 'fight')
    if (hp) monarchOf(run.state).hp = hp
    const cell = nearestOpen(campGrid(run.state.camp), slotAt(2, 3), new Set(souls(run.state.party).map((u) => u.slot)))
    apply(run, { type: 'place', uid: MONARCH_UID, slot: cell })
    apply(run, { type: 'fight' })
    return run
  }
  // A won fight where a shadow rose and fell.
  const shadowFight = (() => {
    for (let i = 0; i < 200; i++) {
      const run = fightFrom('shadow' + i)
      if (run.state.phase === 'reap' && run.battle.units.some((u) => u.shadow && u.hp <= 0)) return run
    }
    assert.fail('no seed raised a shadow that fell in a won fight')
  })()
  const run = shadowFight
  const shadows = run.battle.units.filter((u) => u.shadow)
  const first = run.setup.nextUid
  assert.equal(first, run.setup.foes.at(-1).uid + 1)
  assert.ok(shadows.every((u) => u.uid >= first && u.uid < run.state.nextUid))
  // Only the room's own foes pay essence, not the shadows that rose and fell.
  const slain = run.battle.units.filter((u) => run.setup.foes.some((f) => f.uid === u.uid) && u.hp <= 0)
  assert.equal(run.state.stats.essence, Math.round(slain.reduce((n, u) => n + foeEssence(u), 0)))
  assert.equal(run.state.nextUid, run.battle.nextUid)
  assert.ok(!run.state.party.some((u) => shadows.some((x) => x.uid === u.uid)))
  // A won fight where the Monarch, wounded coming in, was struck: it keeps its share of HP, then heals.
  const woundFight = (() => {
    for (let i = 0; i < 200; i++) {
      const run = fightFrom('wound' + i, 30)
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
  // The Monarch alone, at the front, against a room: it falls, and the run says to what.
  const lone = createRun({ seed: 'lone' })
  visit(lone, 'fight')
  for (const u of souls(lone.state.party)) apply(lone, { type: 'place', uid: u.uid, slot: -1 })
  apply(lone, { type: 'place', uid: MONARCH_UID, slot: slotAt(0, 3) })
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

const bones = (counts) => Object.fromEntries(Object.entries(counts).map(([id, n]) => [id, { standing: n, fallen: 0 }]))
// Buys the Monarch `n` points of Command out of a purse topped up for it, as a player would.
function command (run, n) {
  for (let k = 0; k < n; k++) {
    run.state.essence += monarchCost(run)
    apply(run, { type: 'monarch', stat: 'command' })
  }
}
// A copy of a run to try an action on (the state edited outside the log, so not a replay).
const copyOf = (run) => ({ ...run, state: structuredClone(run.state) })

test('the army starts empty: no bodies, muster 2; the muster costs 9 × level^1.2, a level discount cuts it, and it stops at 10', () => {
  const run = createRun({ seed: 'muster' })
  const s = run.state
  assert.deepEqual([s.ossuary, s.muster, s.freeBinds], [{}, TUNING.army.muster.start, 0])
  assert.ok(souls(s.party).every((u) => !u.cohort))
  s.essence = 0
  assert.throws(() => apply(run, { type: 'muster' }), /cannot muster/)
  s.essence = 1e4
  for (let lvl = 2; lvl < 10; lvl++) {
    const cost = Math.round(9 * Math.pow(lvl, 1.2))
    assert.equal(musterCost(run), cost)
    const before = s.essence
    apply(run, { type: 'muster' })
    assert.deepEqual([s.muster, s.essence], [lvl + 1, before - cost])
  }
  assert.ok(!legalActions(run).some((a) => a.type === 'muster'))
  assert.throws(() => apply(run, { type: 'muster' }), /cannot muster/)
  const cheap = createRun({ seed: 'muster' })
  cheap.state.relics.push('grave_ledger')
  assert.equal(musterCost(cheap), Math.round(9 * Math.pow(2, 1.2) * 0.75))
  // Banners grow with Command, but never past the bodies the board holds.
  cheap.state.monarch.command = TUNING.army.board - TUNING.party.field - 1
  assert.equal(fieldCap(cheap), TUNING.army.board - 1)
  cheap.state.monarch.command = 20
  assert.equal(fieldCap(cheap), TUNING.army.board)
})

test('cohorts: a fielded captain leads bodies of its kin or role, up to Command, never more of a kind than stand', () => {
  const run = createRun({ seed: 'cohort' })
  const s = run.state
  const [knight, chanter, sprite] = souls(s.party)
  s.essence = 0
  s.ossuary = bones({ grave_ghoul: 3, frost_sprite: 2, iron_golem: 1, will_o_wisp: 1 })
  const give = (u, kind, count, shape = 'line') => apply(run, { type: 'cohort', uid: u.uid, kind, count, shape })
  // Command 0: no room for a single body.
  assert.ok(!legalActions(run).some((a) => a.type === 'cohort'))
  assert.throws(() => give(knight, 'grave_ghoul', 1), /cannot give/)
  command(run, 2)
  s.essence = 0
  // Kin (undead) or role (vanguard): ghouls and golems for the knight; ghouls and wisps (channeler) for the
  // chanter; sprites and wisps (fae) for the sprite. Never the Monarch, a boss, or a kind no one knows.
  assert.deepEqual([knight, chanter, sprite].map((u) => Object.keys(s.ossuary).filter((k) => canLead(u, k))),
    [['grave_ghoul', 'iron_golem'], ['grave_ghoul', 'will_o_wisp'], ['frost_sprite', 'will_o_wisp']])
  assert.ok(!canLead(knight, 'monarch') && !canLead(knight, 'hollow_sovereign') && !canLead(monarchOf(s), 'grave_ghoul'))
  for (const bad of [[sprite, 'grave_ghoul', 1], [knight, 'grave_ghoul', 3], [knight, 'grave_ghoul', 0], [knight, 'grave_ghoul', 1.5],
    [knight, 'hollow_sovereign', 1], [knight, 'dragon', 1], [knight, 'grave_ghoul', 1, 'circle'], [monarchOf(s), 'grave_ghoul', 1]]) {
    assert.throws(() => give(...bad), /cannot give/, JSON.stringify(bad.slice(1)))
  }
  give(knight, 'grave_ghoul', 2, 'wedge')
  assert.deepEqual(knight.cohort, { kind: 'grave_ghoul', count: 2, shape: 'wedge' })
  assert.throws(() => give(knight, 'grave_ghoul', 2, 'wedge'), /cannot give/, 'no change is no action')
  assert.equal(freeBodies(s, 'grave_ghoul'), 1)
  assert.throws(() => give(chanter, 'grave_ghoul', 2), /cannot give/, 'only one ghoul is left')
  give(chanter, 'grave_ghoul', 1)
  give(knight, 'grave_ghoul', 1, 'block')
  give(chanter, 'grave_ghoul', 2, 'pair')
  give(sprite, 'frost_sprite', 2)
  // legalActions lists exactly the cohorts apply accepts: each kind a captain can lead with bodies to
  // spare, each count up to Command, each shape but the one it has; and clearing for those that have one.
  const listed = legalActions(run).filter((a) => a.type === 'cohort').map((a) => JSON.stringify(a))
  const accepted = []
  for (const u of s.party) {
    for (const kind of [null, ...Object.keys(UNITS)]) {
      for (const count of [0, 1, 2, 3]) {
        for (const shape of [...Object.keys(SHAPES), 'circle']) {
          const a = kind === null ? { type: 'cohort', uid: u.uid, kind } : { type: 'cohort', uid: u.uid, kind, count, shape }
          try {
            apply(copyOf(run), a)
            accepted.push(JSON.stringify(a))
          } catch {}
        }
      }
    }
  }
  assert.deepEqual(new Set(listed), new Set(accepted))
  assert.equal(listed.length, new Set(listed).size)
  assert.ok(listed.some((a) => a.includes('"kind":"iron_golem"')) && listed.some((a) => a.includes('"kind":null')))
  // A benched captain keeps its cohort but cannot take a new one, and can always let it go.
  apply(run, { type: 'place', uid: chanter.uid, slot: -1 })
  assert.deepEqual(chanter.cohort, { kind: 'grave_ghoul', count: 2, shape: 'pair' })
  assert.throws(() => give(chanter, 'will_o_wisp', 1), /cannot give/)
  // The benched still hold their bodies: the knight (one ghoul) cannot take the chanter's two as well, or
  // fielding the chanter again would lead four of three ghouls.
  assert.equal(freeBodies(s, 'grave_ghoul', knight), 1)
  assert.throws(() => give(knight, 'grave_ghoul', 2, 'line'), /cannot give/, 'the benched still hold their bodies')
  apply(run, { type: 'cohort', uid: chanter.uid, kind: null })
  assert.equal(chanter.cohort, null)
  assert.throws(() => apply(run, { type: 'cohort', uid: chanter.uid, kind: null }), /cannot give/)
  give(knight, 'grave_ghoul', 2)
  assert.equal(freeBodies(s, 'grave_ghoul'), 1)
  // Released, a captain's cohort goes with it.
  apply(run, { type: 'release', uid: knight.uid })
  assert.equal(freeBodies(s, 'grave_ghoul'), 3)
  checkState(s)
})

// A cohort stands at its shape's offsets from its captain, skipping walls and taken cells, and the
// board takes 14 bodies: the rest wait in the reserve, each captain's first body before anyone's second.
test('banners take the field: members at their shape, walls and taken cells skipped, 14 bodies on the board and the rest in reserve', () => tuned(FIRST_BALANCE, () => {
  const run = createRun({ seed: 'army1' })
  const s = run.state
  assert.equal(s.camp, 'palisade', 'row 1 reads ##.#.##')
  visit(run, 'fight')
  const [knight, chanter, sprite] = souls(s.party)
  s.monarch.command = 6
  s.ossuary = bones({ grave_ghoul: 12, frost_sprite: 6 })
  apply(run, { type: 'place', uid: knight.uid, slot: slotAt(1, 2) })
  apply(run, { type: 'cohort', uid: knight.uid, kind: 'grave_ghoul', count: 3, shape: 'line' })
  const cells = () => armyLayout(s).members.map((b) => b.slot)
  // Line: (1,1), (1,3) and (1,0) are walls; (1,4) is open; (1,−1) is off the camp, (1,5) a wall; then the
  // rank behind: (2,2), (2,1).
  assert.deepEqual(cells(), [slotAt(1, 4), slotAt(2, 2), slotAt(2, 1)])
  // A soul on (2,2): the next free offset, (2,3), takes its body.
  apply(run, { type: 'place', uid: chanter.uid, slot: slotAt(2, 2) })
  assert.deepEqual(cells(), [slotAt(1, 4), slotAt(2, 1), slotAt(2, 3)])
  // No offset of a pair fits in the rear corner: the open cells nearest the captain.
  apply(run, { type: 'place', uid: knight.uid, slot: slotAt(6, 6) })
  apply(run, { type: 'cohort', uid: knight.uid, kind: 'grave_ghoul', count: 2, shape: 'pair' })
  assert.deepEqual(cells(), [slotAt(6, 5), slotAt(5, 6)])
  // Three captains of six: 3 + 18 bodies. The board takes 14: each captain's first three bodies and the
  // knight's and chanter's fourth; the rest wait, in the order they would have stood.
  apply(run, { type: 'cohort', uid: knight.uid, kind: 'grave_ghoul', count: 6, shape: 'line' })
  apply(run, { type: 'cohort', uid: chanter.uid, kind: 'grave_ghoul', count: 6, shape: 'block' })
  apply(run, { type: 'cohort', uid: sprite.uid, kind: 'frost_sprite', count: 6, shape: 'wedge' })
  const army = armyLayout(s)
  assert.equal(army.members.length, TUNING.army.board - 3)
  assert.deepEqual(army.reserve.map((b) => b.cohortOf), [sprite, knight, chanter, sprite, knight, chanter, sprite].map((u) => u.uid))
  const taken = [...fielded(s.party).map((u) => u.slot), ...army.members.map((b) => b.slot)]
  assert.equal(new Set(taken).size, taken.length, 'one body a cell')
  assert.ok(army.members.every((b) => campOpen(s.camp, b.slot)))
  // The battle: members join the party at the muster level, uids after the foes'; the reserve keeps its
  // order; shadows come after them all. Synergies and bonds count the members.
  s.muster = 4
  const setup = battleSetup(run)
  const foes = setup.foes.length
  const members = setup.party.filter((u) => u.rank)
  assert.deepEqual(members.map((u) => [u.id, u.slot, u.cohortOf]), army.members.map((b) => [b.id, b.slot, b.cohortOf]))
  assert.deepEqual([...members, ...setup.reserve].map((u) => u.uid), Array.from({ length: 18 }, (_, k) => s.nextUid + foes + k))
  assert.ok([...members, ...setup.reserve].every((u) => u.lvl === 4 && u.rank === true && u.hp === u.maxHp && u.maxHp === baseStats(u.id, 4).hp))
  assert.ok(setup.reserve.every((u) => u.slot === -1))
  assert.equal(setup.nextUid, s.nextUid + foes + 18)
  const b = createBattle(setup)
  const start = b.events[0]
  assert.ok(start.synergies.some((x) => x.side === 'party' && x.id === 'undead_4'), 'two undead captains and their ghouls')
  assert.ok(start.units.filter((u) => u.rank).every((u) => u.cohortOf === members.find((m) => m.uid === u.uid).cohortOf))
  assert.deepEqual(start.reserve.map((u) => u.uid), setup.reserve.map((u) => u.uid))
  assert.ok(b.bonds.some((x) => members.some((m) => m.uid === x.uid)), 'members hold bonds')
  // Not on the field, not in the battle: a dead or benched captain's cohort stays home.
  knight.hp = 0
  apply(run, { type: 'place', uid: sprite.uid, slot: -1 })
  assert.deepEqual(new Set(armyLayout(s).members.map((x) => x.cohortOf)), new Set([chanter.uid]))
  // No cell left: with the board cap raised past the camp, three cohorts of 15 outnumber its open cells.
  // Every open cell but the Monarch's and the souls' takes one body, each exactly once, and the rest wait
  // in the reserve, still round-robin.
  const was = TUNING.army.board
  TUNING.army.board = 60
  try {
    const full = createRun({ seed: 'army1' })
    const f = full.state
    visit(full, 'fight')
    const captains = souls(f.party)
    f.monarch.command = 15
    f.ossuary = bones({ grave_ghoul: 30, frost_sprite: 15 })
    for (const [u, kind] of captains.map((u, i) => [u, i < 2 ? 'grave_ghoul' : 'frost_sprite'])) {
      apply(full, { type: 'cohort', uid: u.uid, kind, count: 15, shape: 'block' })
    }
    const open = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(f.camp, slot)).length
    const crowd = armyLayout(f)
    assert.ok(open - 1 < TUNING.army.board, 'the camp runs out before the cap')
    assert.equal(crowd.members.length + captains.length, open - 1, 'every open cell but the Monarch\'s')
    const cellsTaken = [...fielded(f.party).map((u) => u.slot), ...crowd.members.map((b) => b.slot)]
    assert.ok(crowd.members.every((b) => b.slot >= 0 && campOpen(f.camp, b.slot)))
    assert.equal(new Set(cellsTaken).size, cellsTaken.length, 'one body a cell')
    const order = Array.from({ length: 45 }, (_, k) => captains[k % 3].uid)
    assert.deepEqual(crowd.members.map((b) => b.cohortOf), order.slice(0, crowd.members.length))
    assert.deepEqual(crowd.reserve.map((b) => b.cohortOf), order.slice(crowd.members.length), 'the overflow waits, round-robin')
    assert.equal(battleSetup(full).reserve.length, crowd.reserve.length)
  } finally {
    TUNING.army.board = was
  }
}))

test('after a battle the rank-and-file who fell lie with the fallen, the cohorts shrink to what stands, and an altar raises them', () => {
  // Two cohorts of two ghouls, every ghoul led: any that falls shrinks a cohort.
  const fought = (() => {
    for (let i = 0; i < 100; i++) {
      const run = createRun({ seed: 'fallen' + i })
      const s = run.state
      command(run, 2)
      s.ossuary = bones({ grave_ghoul: 4 })
      // Foes a little above the floor's, so that bodies fall.
      for (const n of s.map.nodes) if (n.foes) n.foes = n.foes.map((f) => ({ ...f, lvl: f.lvl + 5 }))
      visit(run, 'fight')
      const [knight, chanter] = souls(s.party)
      apply(run, { type: 'cohort', uid: knight.uid, kind: 'grave_ghoul', count: 2, shape: 'line' })
      apply(run, { type: 'cohort', uid: chanter.uid, kind: 'grave_ghoul', count: 2, shape: 'line' })
      apply(run, { type: 'fight' })
      const dead = run.battle.units.filter((u) => u.rank && u.hp <= 0).length
      if (s.phase === 'reap' && dead > 0 && dead < 4) return { run, dead }
    }
    assert.fail('no fight was won with some ghouls fallen')
  })()
  const { run, dead } = fought
  const s = run.state
  assert.deepEqual(s.ossuary.grave_ghoul, { standing: 4 - dead, fallen: dead })
  const [knight, chanter] = souls(s.party)
  assert.equal(knight.cohort.count, Math.min(2, 4 - dead), 'the first captain keeps its own')
  assert.equal(chanter.cohort?.count ?? 0, 4 - dead - knight.cohort.count)
  checkState(s)
  apply(run, { type: 'reap', index: null })
  visit(run, 'altar')
  assert.deepEqual(s.ossuary.grave_ghoul, { standing: 4, fallen: 0 })
})

test('a reserve body that entered and fell lies with the fallen; the reserve that never entered still stands', () => tuned(FIRST_BALANCE, () => {
  // A board of 4: the three souls and one ghoul. Two cohorts of three leave five ghouls in reserve, and a
  // seventh stands unled.
  const was = TUNING.army.board
  TUNING.army.board = 4
  try {
    for (let i = 0; i < 100; i++) {
      const run = createRun({ seed: 'entered' + i })
      const s = run.state
      command(run, 3)
      s.ossuary = bones({ grave_ghoul: 7 })
      for (const n of s.map.nodes) if (n.foes) n.foes = n.foes.map((f) => ({ ...f, lvl: f.lvl + 5 }))
      visit(run, 'fight')
      const [knight, chanter] = souls(s.party)
      apply(run, { type: 'cohort', uid: knight.uid, kind: 'grave_ghoul', count: 3, shape: 'line' })
      apply(run, { type: 'cohort', uid: chanter.uid, kind: 'grave_ghoul', count: 3, shape: 'line' })
      assert.equal(run.state.phase, 'prep')
      apply(run, { type: 'fight' })
      const b = run.battle
      const entered = new Set(b.events.filter((e) => e.type === 'enter').map((e) => e.unit.uid))
      const fell = b.units.filter((u) => u.rank && u.hp <= 0)
      if (s.phase !== 'reap' || !fell.some((u) => entered.has(u.uid)) || !b.reserve.length) continue
      assert.deepEqual(s.ossuary.grave_ghoul, { standing: 7 - fell.length, fallen: fell.length }, 'the entrants who fell are counted')
      assert.ok(7 - fell.length >= b.reserve.length + 1, 'those still in reserve, and the unled one, still stand')
      return
    }
    assert.fail('no won fight had an entered body fall')
  } finally {
    TUNING.army.board = was
  }
}))

test('round 2: a body with no room on the board sits the battle out; only a held detachment enters mid-battle', () => {
  // A board of 4: the three souls and one ghoul; two cohorts of three leave five ghouls with no room.
  const was = TUNING.army.board
  TUNING.army.board = 4
  try {
    const run = createRun({ seed: 'overflow' })
    const s = run.state
    command(run, 3)
    s.ossuary = bones({ grave_ghoul: 7 })
    visit(run, 'fight')
    const [knight, chanter] = souls(s.party)
    apply(run, { type: 'cohort', uid: knight.uid, kind: 'grave_ghoul', count: 3, shape: 'line' })
    apply(run, { type: 'cohort', uid: chanter.uid, kind: 'grave_ghoul', count: 3, shape: 'line' })
    assert.equal(armyLayout(s).reserve.length, 5, 'five find no room')
    assert.equal(TUNING.army.overflow, false)
    assert.equal(battleSetup(run).reserve.filter((u) => u.side !== 'foe').length, 0, 'none of them waits to enter')
    tuned({ army: { overflow: true } }, () => assert.equal(battleSetup(run).reserve.filter((u) => u.side !== 'foe').length, 5, 'with overflow they wait in reserve'))
    // Held for a body falling, the knight's banner waits off the board and enters past the cap.
    const held = [{ id: 1, color: DETACHMENT_COLORS[0], members: [knight.uid], plan: { ...DEFAULT_PLAN, when: { at: 'falls' } } }]
    const setup = battleSetup(run, { detachments: held })
    assert.equal(setup.reserve.filter((u) => u.side !== 'foe' && u.when?.at === 'falls').length, 4, 'the held captain and its three')
  } finally {
    TUNING.army.board = was
  }
})

test('round 2: a Knight and a Marshal fight with their rank\'s might (TUNING.ranks.might)', () => {
  const { might } = TUNING.ranks
  const on = (grade, uid, col) => ({ ...makeUnit('tomb_knight', { uid, lvl: 3 }), grade, side: 'party', slot: slotAt(0, col) })
  const b = createBattle({ party: [on(0, 1, 1), on(1, 2, 3), on(2, 3, 5)], foes: [{ ...makeUnit('grave_ghoul', { uid: 9, lvl: 1 }), side: 'foe', slot: slotAt(0, 3) }], seed: 'might' })
  const [s0, s1, s2] = [1, 2, 3].map((uid) => stats(b, b.units.find((u) => u.uid === uid)))
  for (const [g, st] of [[1, s1], [2, s2]]) {
    assert.ok(Math.abs(st.damage.dealt / s0.damage.dealt - might[g]) < 1e-9)
    assert.ok(Math.abs(st.damage.taken / s0.damage.taken - 1 / might[g]) < 1e-9)
  }
  assert.ok(might[1] > 1 && might[2] > might[1])
})

test('binding: one offer per kind slain; the first 1 + Will bodies are free, then 3 × tier each; binding leaves the other offers', () => {
  const run = winFight('bind')
  const s = run.state
  const slain = run.battle.units.filter((u) => u.side === 'foe' && u.hp <= 0)
  const offers = s.offers.filter((o) => o.type === 'bind')
  assert.deepEqual(offers.map((o) => [o.id, o.max]), [...new Set(slain.map((u) => u.id))].map((id) => [id, slain.filter((u) => u.id === id).length]))
  assert.equal(s.freeBinds, 1 + s.monarch.will)
  // A bind offer is never reaped; it is bound, from 1 to as many as fell.
  const index = s.offers.findIndex((o) => o.type === 'bind')
  assert.ok(!legalActions(run).some((a) => a.type === 'reap' && a.index === index))
  assert.throws(() => apply(run, { type: 'reap', index }), /can't be taken/)
  const o = offers.find((x) => x.max >= 2) ?? offers[0]
  const tier = UNITS[o.id].tier
  assert.deepEqual(legalActions(run).filter((a) => a.type === 'bind' && a.id === o.id).map((a) => a.count), Array.from({ length: o.max }, (_, k) => k + 1).filter((n) => s.essence >= (n - 1) * 3 * tier))
  for (const bad of [{ id: o.id, count: 0 }, { id: o.id, count: o.max + 1 }, { id: 'iron_golem', count: 1 }, { id: o.id, count: 1.5 }]) {
    assert.throws(() => apply(run, { type: 'bind', ...bad }), /cannot bind/, JSON.stringify(bad))
  }
  assert.deepEqual([bindCost(run, o.id, 1), bindCost(run, o.id, 2)], [0, 3 * tier])
  // Two at once of three slain Grave Ghouls (an offer made by hand, so that a kind fell more than once):
  // the first free, the second at 3 × tier, taken from the purse; then one more, paid in full.
  const ghouls = { type: 'bind', id: 'grave_ghoul', max: 3, name: 'Grave Ghoul', desc: '' }
  s.offers.splice(s.offers.findIndex((x) => x.type === 'bind'), 0, ghouls)
  s.essence = 100
  const per = 3 * UNITS.grave_ghoul.tier
  const souls0 = s.offers.filter((x) => x.type === 'soul').length
  apply(run, { type: 'bind', id: 'grave_ghoul', count: 2 })
  assert.deepEqual([s.ossuary.grave_ghoul, s.essence, s.freeBinds, ghouls.max, s.stats.bound], [{ standing: 2, fallen: 0 }, 100 - per, 0, 1, 2])
  apply(run, { type: 'bind', id: 'grave_ghoul', count: 1 })
  assert.deepEqual([s.ossuary.grave_ghoul.standing, s.essence, s.freeBinds, s.stats.bound], [3, 100 - 2 * per, 0, 3])
  assert.ok(!s.offers.includes(ghouls), 'all three bound: the offer is gone')
  assert.equal(s.offers.filter((x) => x.type === 'soul').length, souls0, 'the souls are still for sale')
  assert.equal(s.phase, 'reap')
  // Poor, no more bodies: the free ones are spent.
  s.essence = 0
  assert.ok(!legalActions(run).some((a) => a.type === 'bind'))
  checkState(s)
  // Will 1 (bought before the fight) frees two; binding the last offer left ends the room.
  const will = winFight('bind-will', (r) => {
    r.state.essence += monarchCost(r)
    apply(r, { type: 'monarch', stat: 'will' })
  })
  assert.equal(will.state.monarch.will, 1)
  assert.equal(will.state.freeBinds, 2)
  const [first] = will.state.offers.filter((x) => x.type === 'bind')
  first.max = 2
  will.state.offers = [first, { type: 'bind', id: 'grave_ghoul', max: 1, name: 'Grave Ghoul', desc: '' }]
  will.state.essence = 0
  assert.equal(bindCost(will, first.id, 2), 0)
  apply(will, { type: 'bind', id: first.id, count: 2 })
  assert.deepEqual([will.state.essence, will.state.phase, will.state.freeBinds], [0, 'reap', 0], 'both free ones spent at once')
  will.state.essence = per
  apply(will, { type: 'bind', id: 'grave_ghoul', count: 1 })
  assert.deepEqual([will.state.essence, will.state.phase, will.state.freeBinds], [0, 'map', 0])
  // reap null ends a room with bodies left unbound.
  apply(run, { type: 'reap', index: null })
  assert.equal(s.phase, 'map')
})

// Basic binds only what is free (bodies its captains can lead first), leads with its most numerous kind,
// as many as Command allows, in a line, and buys muster once it is the cheapest thing.
test('the basic army: free bodies only, the most numerous kind each captain can lead, a line, and muster when it is cheapest', () => tuned(FIRST_BALANCE, () => {
  const rng = createRng('basic-army').stream('autoplay')
  const won = winFight('thumb')
  const s = won.state
  s.essence = 1000
  const lead = (id) => fielded(souls(s.party)).some((c) => canLead(c, id))
  const binds = []
  for (let a; (a = policy(won, rng, 'basic')).type === 'bind';) {
    binds.push(a)
    apply(won, a)
  }
  assert.equal(binds.length, 1, 'one free body, then no paid ones')
  const first = binds[0]
  const kinds = won.battle.units.filter((u) => u.side === 'foe' && u.hp <= 0).map((u) => u.id)
  assert.ok(lead(first.id) || !kinds.some(lead), `${first.id}: a kind its captains lead first`)
  assert.equal(first.count, 1)
  // Its cohorts, played out to the fight.
  const run = createRun({ seed: 'thumb' })
  const t = run.state
  t.monarch.command = 2
  t.ossuary = bones({ grave_ghoul: 5, frost_sprite: 1, iron_golem: 1 })
  visit(run, 'fight')
  for (let a; (a = policy(run, rng, 'basic')).type !== 'fight';) apply(run, a)
  const [knight, chanter, sprite] = souls(t.party)
  assert.deepEqual([knight.cohort, chanter.cohort, sprite.cohort], [
    { kind: 'grave_ghoul', count: 2, shape: 'line' }, { kind: 'grave_ghoul', count: 2, shape: 'line' }, { kind: 'frost_sprite', count: 1, shape: 'line' }
  ])
  // Muster once its cost is no more than any level or tier its fighters could take, and only with a cohort
  // in the fight.
  t.essence = 1000
  for (const u of souls(t.party)) u.lvl = 4
  assert.ok(musterCost(run) <= Math.min(...souls(t.party).map((u) => levelCost(run, u))))
  assert.deepEqual(policy(run, rng, 'basic'), { type: 'muster' })
  for (const u of souls(t.party)) u.lvl = 2
  assert.notEqual(policy(run, rng, 'basic').type, 'muster', 'a level is cheaper')
  for (const u of souls(t.party)) {
    u.lvl = 4
    u.cohort = null
  }
  assert.notEqual(policy(run, rng, 'basic').type, 'muster', 'no cohort fights')
}))

// The expert searches the cohorts' shapes, kinds and counts with the cells, and carries its plan out with
// legal cohort actions; with no room in a cohort it pays for no body, and it buys the muster when
// rehearsing says so.
test('the expert army: cohorts searched in the hill-climb and carried out; bodies bound by rehearsal, paid for only with room; muster by rehearsal', () => tuned(FIRST_BALANCE, () => {
  const shapes = new Set()
  for (let i = 0; i < 30 && (i < 3 || shapes.size < 2); i++) {
    const run = createRun({ seed: 'host' + i })
    const s = run.state
    command(run, 3)
    // Two ghouls, so the field never stands Undead 8, whose Legion would win every rehearsal whatever the
    // shape (no captain is at tier III, so the expert makes no Knight to eat them).
    s.ossuary = bones({ grave_ghoul: 2, frost_sprite: 3, will_o_wisp: 3 })
    visit(run, 'fight')
    const rng = createRng('host').stream('autoplay')
    for (let a; (a = policy(run, rng, 'expert')).type !== 'fight';) apply(run, a)
    const goal = planFor(run, LEVELS.expert)
    for (const p of goal) assert.deepEqual(s.party.find((u) => u.uid === p.uid).cohort ?? null, p.cohort, `host${i}: uid ${p.uid} leads as planned`)
    for (const p of goal) if (p.cohort) shapes.add(p.cohort.shape)
    assert.ok(goal.some((p) => p.cohort), `host${i}: it leads bodies`)
    checkState(s)
  }
  assert.ok(shapes.size > 1, `the climb tried shapes: ${[...shapes]}`)
  // Command 0: free bodies, never paid ones.
  const won = winFight('pay')
  won.state.essence = 1000
  const rng = createRng('pay').stream('autoplay')
  let bound = 0
  for (let a; (a = policy(won, rng, 'expert')).type === 'bind';) {
    bound += a.count
    apply(won, a)
  }
  assert.equal(bound, 1)
  assert.equal(won.state.essence, 1000)
  // A won fight with Command 3, Will 3 and the souls maxed (the knight and the chanter lead ghouls, the
  // knight golems too). Four free bodies go to the kind whose bodies rehearse best, not the first offered
  // (basic takes the first its captains can lead). Paid ghouls fill the cohorts' room and no more: 2
  // captains × Command 3, none standing yet. Which kind rehearses best depends on balance: the foes stand at
  // level 10 so that the golems' bulk shows (at 9 and below, since the final balance pass, the ghouls do).
  const reaped = () => {
    const r = createRun({ seed: 'paid0' })
    r.state.monarch = { dominion: 3, command: 3, will: 3 }
    for (const u of souls(r.state.party)) Object.assign(u, { lvl: 10, path: pathsOf(u.id)[0].id, tier: 3 })
    for (const n of r.state.map.nodes) if (n.foes) n.foes = n.foes.map((f) => ({ ...f, lvl: 10 }))
    apply(r, { type: 'node', id: availableNodes(r)[0].id })
    apply(r, { type: 'fight' })
    assert.equal(r.state.phase, 'reap')
    return r
  }
  const picks = reaped()
  picks.state.offers = ['grave_ghoul', 'iron_golem'].map((id) => ({ type: 'bind', id, max: 4, name: id, desc: '' }))
  assert.equal(picks.state.freeBinds, 4)
  assert.deepEqual(policy(picks, rng, 'expert'), { type: 'bind', id: 'iron_golem', count: 4 })
  assert.deepEqual(policy(picks, rng, 'basic'), { type: 'bind', id: 'grave_ghoul', count: 4 })
  const pays = reaped()
  const p = pays.state
  p.offers = [{ type: 'bind', id: 'grave_ghoul', max: 8, name: 'Grave Ghoul', desc: '' }]
  p.freeBinds = 0
  p.essence = 1000
  const paid = policy(pays, rng, 'expert')
  assert.deepEqual(paid, { type: 'bind', id: 'grave_ghoul', count: 6 })
  apply(pays, paid)
  assert.equal(p.essence, 1000 - 6 * 3 * UNITS.grave_ghoul.tier)
  assert.notEqual(policy(pays, rng, 'expert').type, 'bind', 'the cohorts are full')
  // A rehearsal fixture: with Command 4 and ten bodies led by level-2 souls against level-5 foes, the next
  // muster beats the souls and the Monarch's points. The souls are Knights with too few bodies of their kin
  // to become Marshals (4 undead, 6 fae; a Knight fights as a Soldier does), so the expert has no promotion
  // to make first: promotion costs no essence and comes before every purchase. Fewer than 8 of a kin with
  // the souls (Undead 6, Fae 7): at Undead 8 the Legion wins every rehearsal, and nothing rehearses better.
  // It depends on balance: retune the foes' level and the bodies with the numbers (the final balance pass
  // moved it from 5 ghouls, 5 sprites and level-8 foes; necessity round 1, on FIRST_BALANCE, from level 6 to 5).
  const run = createRun({ seed: 'muster5' })
  const s = run.state
  s.monarch = { dominion: 3, command: 4, will: 3 }
  s.ossuary = bones({ grave_ghoul: 4, frost_sprite: 6 })
  for (const u of souls(s.party)) u.grade = 1
  for (const n of s.map.nodes) if (n.foes) n.foes = n.foes.map((f) => ({ ...f, lvl: 5 }))
  apply(run, { type: 'node', id: availableNodes(run)[0].id })
  s.essence = Math.max(musterCost(run), monarchCost(run))
  assert.equal(armyWish(run), 'muster')
  assert.deepEqual(policy(run, rng, 'expert'), { type: 'muster' })
}))

// ── orders: detachments and their plans ─────────────────────────────────────────────────────────

const planOf = (where, at = 'once') => ({ where, square: null, when: { at } })

test('orders: fielded captains form a detachment with a plan, edited by id or disbanded; one left empty is gone', () => {
  const run = createRun({ seed: 'orders' })
  const s = run.state
  const [knight, chanter, sprite] = souls(s.party)
  const order = (a) => apply(run, { type: 'order', ...a })
  assert.deepEqual(s.detachments, [])
  assert.equal(detachmentOf(s, knight.uid), null, 'no detachment: Hunt, at once')
  assert.deepEqual(DEFAULT_PLAN, planOf('hunt'))
  // A plan is kept clean: a square only for Move, a tick only for a time.
  order({ uids: [knight.uid], plan: { where: 'stay', square: 5, when: { at: 'once', t: 9 }, extra: 1 } })
  assert.deepEqual(s.detachments, [{ id: 1, color: DETACHMENT_COLORS[0], members: [knight.uid], plan: planOf('stay') }])
  // Its captains stand in party order; Move takes any open board tile, the foes' ground too.
  const square = tileAt(3, CAMP_ROWS + 2)
  order({ uids: [sprite.uid, chanter.uid], plan: { where: 'move', square, when: { at: 'time', t: 200 } } })
  assert.deepEqual(s.detachments[1], { id: 2, color: DETACHMENT_COLORS[1], members: [chanter.uid, sprite.uid], plan: { where: 'move', square, when: { at: 'time', t: 200 } } })
  assert.equal(detachmentOf(s, sprite.uid).id, 2)
  // Ordered into a new detachment, the knight and the chanter leave theirs: the knight's, left empty, is
  // gone, and the new one takes the first id free.
  order({ uids: [knight.uid, chanter.uid], plan: planOf('hunt', 'falls') })
  assert.deepEqual(s.detachments.map((d) => [d.id, d.members, d.plan.when.at]), [[2, [sprite.uid], 'time'], [1, [knight.uid, chanter.uid], 'falls']])
  order({ id: 2, plan: planOf('stay', 'struck') })
  assert.deepEqual(s.detachments[0].plan, planOf('stay', 'struck'))
  // Refused: the Monarch, no one, twice the same, a stranger; a plan of no known where or when, Move with
  // no square, to a wall or off the board, a time out of the battle's span; a detachment that already
  // stands so, a plan a detachment already has, a detachment that is not there.
  const wall = wallTiles(s.camp)[0]
  const bad = [
    { uids: [MONARCH_UID], plan: planOf('stay') }, { uids: [], plan: planOf('stay') }, { uids: [knight.uid, knight.uid], plan: planOf('stay') },
    { uids: [999], plan: planOf('stay') }, { uids: [knight.uid] }, { uids: [knight.uid], plan: planOf('charge') }, { uids: [knight.uid], plan: planOf('stay', 'dawn') },
    { uids: [knight.uid], plan: { where: 'stay' } }, { uids: [knight.uid], plan: { where: 'move', when: { at: 'once' } } },
    { uids: [knight.uid], plan: { where: 'move', square: wall, when: { at: 'once' } } }, { uids: [knight.uid], plan: { where: 'move', square: TILES, when: { at: 'once' } } },
    { uids: [knight.uid], plan: { where: 'move', square: 1.5, when: { at: 'once' } } },
    ...[0, 1.5, TUNING.tick.ceiling].map((t) => ({ uids: [knight.uid], plan: { where: 'hunt', when: { at: 'time', t } } })),
    { uids: [chanter.uid, knight.uid], plan: planOf('hunt', 'falls') }, { id: 1, plan: planOf('hunt', 'falls') }, { id: 7, plan: planOf('stay') },
    { id: 1, uids: [knight.uid], plan: planOf('stay') }
  ]
  for (const a of bad) assert.throws(() => order(a), /cannot give the order/, JSON.stringify(a))
  assert.throws(() => apply(run, { type: 'disband', id: 7 }), /no detachment/)
  // A benched soul takes no order.
  apply(run, { type: 'place', uid: sprite.uid, slot: -1 })
  assert.throws(() => order({ uids: [sprite.uid], plan: planOf('stay') }), /cannot give the order/)
  apply(run, { type: 'place', uid: sprite.uid, slot: nearestOpen(campGrid(s.camp), sprite.slot, new Set(s.party.map((u) => u.slot))) })
  // At most TUNING.army.detachments detachments: five captains in four, and the fifth is refused, but a
  // captain alone may be ordered anew (its own detachment goes as the new one comes).
  command(run, 2)
  join(run, 'grave_ghoul')
  join(run, 'hive_warden')
  s.detachments = []
  const five = fielded(souls(s.party))
  assert.equal(five.length, 5)
  for (const u of five.slice(0, 4)) order({ uids: [u.uid], plan: planOf('stay') })
  assert.throws(() => order({ uids: [five[4].uid], plan: planOf('stay') }), /cannot give the order/)
  assert.ok(!legalActions(run).some((a) => a.type === 'order' && a.uids?.includes(five[4].uid) && a.uids.length === 1))
  order({ uids: [five[0].uid], plan: planOf('hunt', 'struck') })
  order({ uids: [five[1].uid, five[4].uid], plan: planOf('stay') })
  assert.equal(s.detachments.length, 4)
  // legalActions lists a representative few: every one applies, none twice, edits and disbands included.
  const listed = legalActions(run).filter((a) => ['order', 'disband'].includes(a.type))
  assert.equal(new Set(listed.map((a) => JSON.stringify(a))).size, listed.length)
  for (const a of listed) assert.doesNotThrow(() => apply(copyOf(run), a), JSON.stringify(a))
  assert.ok(listed.some((a) => a.id !== undefined && a.type === 'order') && listed.some((a) => a.type === 'disband'))
  assert.ok(listed.some((a) => a.plan?.where === 'move') && listed.some((a) => a.plan && a.plan.when.at !== 'once'))
  // Disbanded, its captains Hunt at once; released, a captain leaves its detachment, and one left empty is
  // gone.
  apply(run, { type: 'disband', id: s.detachments[0].id })
  assert.equal(s.detachments.length, 3)
  const alone = s.detachments.find((d) => d.members.length === 1)
  apply(run, { type: 'release', uid: alone.members[0] })
  assert.ok(!s.detachments.includes(alone))
  checkState(s)
})

// A held detachment (a later start) waits off the board: no cell, no count toward the 14, and enters
// beside the Monarch, captain first, when its start comes.
test('a detachment held for a later start waits off the board with its cohort, counts toward no cap, and enters when called', () => tuned(FIRST_BALANCE, () => {
  const run = createRun({ seed: 'army1' })
  const s = run.state
  visit(run, 'fight')
  const [knight, chanter, sprite] = souls(s.party)
  s.monarch.command = 6
  s.ossuary = bones({ grave_ghoul: 12, frost_sprite: 6 })
  apply(run, { type: 'cohort', uid: knight.uid, kind: 'grave_ghoul', count: 6, shape: 'line' })
  apply(run, { type: 'cohort', uid: chanter.uid, kind: 'grave_ghoul', count: 6, shape: 'block' })
  apply(run, { type: 'cohort', uid: sprite.uid, kind: 'frost_sprite', count: 6, shape: 'wedge' })
  assert.deepEqual([armyLayout(s).members.length, armyLayout(s).reserve.length, armyLayout(s).held.length], [11, 7, 0])
  apply(run, { type: 'order', uids: [knight.uid], plan: planOf('hunt', 'falls') })
  apply(run, { type: 'order', uids: [chanter.uid], plan: planOf('stay') })
  // The knight and its six wait; the other two banners now all fit: 2 captains and 12 bodies.
  const army = armyLayout(s)
  assert.deepEqual(army.held, [{ det: 1, uid: knight.uid, id: 'tomb_knight' }, ...Array.from({ length: 6 }, () => ({ det: 1, cohortOf: knight.uid, id: 'grave_ghoul' }))])
  assert.deepEqual([army.members.length, army.reserve.length], [12, 0])
  assert.ok(!army.members.some((b) => b.slot === knight.slot), 'the held captain\'s cell stays its own')
  const setup = battleSetup(run)
  const foes = setup.foes.length
  assert.ok(!setup.party.some((u) => u.uid === knight.uid || u.cohortOf === knight.uid))
  assert.deepEqual(setup.reserve.map((u) => [u.uid === knight.uid || u.cohortOf === knight.uid, u.det, u.when, u.plan, u.slot]),
    Array.from({ length: 7 }, () => [true, 1, { at: 'falls' }, { where: 'hunt', square: null }, -1]))
  assert.deepEqual(setup.reserve.slice(1).map((u) => u.uid), Array.from({ length: 6 }, (_, k) => s.nextUid + foes + 12 + k), 'held bodies after the members')
  // The Stay banner: its captain and its cohort carry its plan; the sprite's none (it Hunts).
  assert.ok(setup.party.filter((u) => u.uid === chanter.uid || u.cohortOf === chanter.uid).every((u) => u.det === 2 && u.plan.where === 'stay'))
  assert.ok(setup.party.filter((u) => u.uid === sprite.uid || u.cohortOf === sprite.uid).every((u) => u.det === undefined && !u.plan))
  assert.deepEqual(setup.detachments, [{ id: 1, color: DETACHMENT_COLORS[0], ...planOf('hunt', 'falls') }, { id: 2, color: DETACHMENT_COLORS[1], ...planOf('stay') }])
  // Foes strong enough that a body falls, and the held detachment is called.
  const b = createBattle({ ...setup, foes: setup.foes.map((f) => makeUnit(f.id, { uid: f.uid, lvl: 25, slot: f.slot })) })
  assert.deepEqual(b.events.filter((e) => e.type === 'order').map((e) => [e.detachment, e.where, e.when.at]), [[1, 'hunt', 'falls'], [2, 'stay', 'once']])
  assert.equal(b.events[0].reserve.filter((u) => u.when).length, 7)
  runBattle(b)
  const fell = b.events.find((e) => e.type === 'death' && b.units.find((u) => u.uid === e.target).side === 'party')
  const call = b.events.find((e) => e.type === 'call')
  const entered = b.events.filter((e) => e.type === 'enter').map((e) => e.unit.uid)
  assert.ok(b.events.filter((e) => e.t <= fell.t).every((e) => e.type !== 'call' && e.type !== 'enter'), 'nothing before a body falls')
  assert.deepEqual([call.t, call.detachment, call.at], [fell.t + 1, 1, 'falls'])
  assert.equal(entered[0], knight.uid, 'the captain first')
  assert.ok(entered.slice(1).every((uid) => b.units.find((u) => u.uid === uid).cohortOf === knight.uid))
  // A held detachment goes before the bodies that found no room: with a board of 10, the four bodies it
  // cannot hold wait behind the knight's seven.
  const was = TUNING.army.board
  TUNING.army.board = 10
  try {
    assert.deepEqual(battleSetup(run).reserve.map((u) => u.when?.at ?? null), [...Array(7).fill('falls'), ...Array(4).fill(null)])
  } finally {
    TUNING.army.board = was
  }
  // A captain held all battle is untouched by it.
  apply(run, { type: 'fight' })
  if (!run.battle.events.some((e) => e.type === 'enter' && e.unit.uid === knight.uid)) assert.equal(knight.hp, knight.maxHp)
  // An order with no one on the board but held ones leaves the Monarch alone at the start.
  const lone = createRun({ seed: 'army1' })
  visit(lone, 'fight')
  apply(lone, { type: 'order', uids: fielded(souls(lone.state.party)).map((u) => u.uid), plan: planOf('stay', 'struck') })
  const solo = battleSetup(lone)
  assert.deepEqual(solo.party.map((u) => u.uid), [MONARCH_UID])
  assert.equal(solo.reserve.length, 3)
}))

test('basic fights on default orders; the expert carries out the orders it planned, and plans some', () => {
  const run = createRun({ seed: 'plans' })
  visit(run, 'fight')
  apply(run, { type: 'order', uids: [souls(run.state.party)[0].uid], plan: planOf('stay') })
  const rng = createRng('plans').stream('autoplay')
  let a
  while ((a = policy(run, rng, 'basic')).type !== 'fight') {
    assert.notEqual(a.type, 'order', 'basic gives no orders')
    apply(run, a)
  }
  assert.deepEqual(run.state.detachments, [], 'basic disbands what it finds')
  // The expert: over a few floor-1 rooms, its prep leaves the run with exactly the detachments its plan
  // holds, and at least one plan gives an order.
  let ordered = 0
  for (let i = 0; i < 6 && !ordered; i++) {
    const r = createRun({ seed: 'plans' + i })
    visit(r, 'fight')
    for (let x; (x = policy(r, rng, 'expert')).type !== 'fight';) apply(r, x)
    const goal = planFor(r, LEVELS.expert)
    const want = detachmentsOf(goal).map((d) => [d.members.slice().sort(), d.plan])
    assert.deepEqual(new Set(r.state.detachments.map((d) => JSON.stringify([d.members.slice().sort(), d.plan]))), new Set(want.map((w) => JSON.stringify(w))))
    ordered += r.state.detachments.length
    checkState(r.state)
  }
  assert.ok(ordered > 0, 'the expert gives orders')
  // A formation is rehearsed with its orders: the same cells with every captain held until the Monarch is
  // struck is another battle (the Monarch stands alone at the start), and the run is untouched.
  const r = createRun({ seed: 'plans' })
  visit(r, 'fight')
  const before = structuredClone(r.state)
  const party = fielded(r.state.party).map((u) => ({ ...u }))
  const held = party.map((u) => (u.uid === MONARCH_UID ? u : { ...u, order: planOf('hunt', 'struck') }))
  assert.deepEqual(detachmentsOf(held), [{ id: 1, color: DETACHMENT_COLORS[0], members: souls(party).map((u) => u.uid), plan: planOf('hunt', 'struck') }])
  assert.notEqual(rehearse(r, held, 2), rehearse(r, party, 2))
  assert.deepEqual(r.state, before)
})

test('the expert never plans more detachments than the run takes, however its climb changes the orders', () => {
  const run = createRun({ seed: 'cap' })
  visit(run, 'fight')
  command(run, 2)
  join(run, 'grave_ghoul')
  join(run, 'hive_warden')
  const s = run.state
  const cap = TUNING.army.detachments
  const open = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(s.camp, slot))
  const orders = (party) => new Set(party.filter((u) => u.order).map((u) => JSON.stringify(u.order))).size
  // Long chains of order changes on five captains (screens, posts at the domain's edge, fresh draws, joins,
  // clears): never more different orders than detachments, and they do reach the cap.
  let most = 0
  for (let chain = 0; chain < 150; chain++) {
    const rng = createRng('cap' + chain).stream('climb')
    let party = fielded(s.party).map((u) => ({ ...u, order: null }))
    for (let k = 0; k < 40; k++) {
      party = replan(party.map((u) => ({ ...u })), s, rng, open)
      most = Math.max(most, orders(party))
      assert.ok(orders(party) <= cap, `chain ${chain}, step ${k}: ${orders(party)} orders`)
      assert.ok(detachmentsOf(party).length <= cap)
    }
  }
  assert.equal(most, cap)
  // A formation with an order past the cap makes only `cap` detachments (the rest Hunt, at once), and the
  // run takes every one of them.
  const plans = [planOf('stay'), planOf('stay', 'falls'), planOf('stay', 'struck'), planOf('hunt', 'falls'), planOf('hunt', 'struck')]
  const five = fielded(souls(s.party)).map((u, k) => ({ ...u, order: plans[k] }))
  assert.equal(five.length, 5)
  assert.deepEqual(detachmentsOf(five).map((d) => d.plan), plans.slice(0, cap))
  for (const d of detachmentsOf(five)) apply(run, { type: 'order', uids: d.members, plan: d.plan })
  assert.equal(s.detachments.length, cap)
  // The expert's own prep with five captains applies, step by step, to the fight.
  for (let a; (a = policy(run, null, 'expert')).type !== 'fight';) apply(run, a)
  assert.ok(s.detachments.length <= cap)
  checkState(s)
})

test('held detachments enter by their first captains in party order, however they were formed, so a rehearsal sets up the fight the run will', () => {
  const run = createRun({ seed: 'heldorder' })
  visit(run, 'fight')
  const s = run.state
  const [knight, chanter, sprite] = souls(s.party)
  s.monarch.command = 1
  s.ossuary = bones({ grave_ghoul: 2 })
  apply(run, { type: 'cohort', uid: knight.uid, kind: 'grave_ghoul', count: 1, shape: 'line' })
  apply(run, { type: 'cohort', uid: chanter.uid, kind: 'grave_ghoul', count: 1, shape: 'line' })
  // Formed the sprite's first, then the knight's: the knight's enters first all the same.
  apply(run, { type: 'order', uids: [sprite.uid], plan: planOf('hunt', 'falls') })
  apply(run, { type: 'order', uids: [chanter.uid, knight.uid], plan: planOf('stay', 'falls') })
  assert.deepEqual(s.detachments.map((d) => d.members), [[sprite.uid], [knight.uid, chanter.uid]])
  assert.deepEqual(armyLayout(s).held.map((h) => h.uid ?? `body of ${h.cohortOf}`), [knight.uid, chanter.uid, `body of ${knight.uid}`, `body of ${chanter.uid}`, sprite.uid])
  // The same formation as the autoplayer keeps it (orders on its souls) and rehearses it (detachmentsOf, in
  // another order and with other ids) sets up the same reserve, uids and all.
  const party = fielded(s.party).reverse().map((u) => ({ ...u, order: detachmentOf(s, u.uid)?.plan ?? null }))
  const order = new Map(s.party.map((u, i) => [u.uid, i]))
  const sorted = party.slice().sort((a, b) => order.get(a.uid) - order.get(b.uid))
  const entry = (setup) => setup.reserve.map((u) => [u.uid, u.id, u.cohortOf, u.when])
  assert.deepEqual(entry(battleSetup(run, { party: sorted, detachments: detachmentsOf(sorted) })), entry(battleSetup(run)))
})

test('a new floor\'s camp may wall a Move\'s square: it moves to the open tile nearest it; detachments carry on', () => {
  const run = createRun({ seed: 'squares' })
  const s = run.state
  const [knight, chanter] = souls(s.party)
  const next = createRng(s.seed).stream('camp|2').pick(CAMP_LIST.filter((c) => c.floor === 2)).id
  const walls = wallTiles(next)
  const walled = walls[0]
  const open = [...Array(TILES).keys()].find((t) => !walls.includes(t) && !wallTiles(s.camp).includes(t))
  apply(run, { type: 'order', uids: [knight.uid], plan: { where: 'move', square: open, when: { at: 'once' } } })
  apply(run, { type: 'order', uids: [chanter.uid], plan: { where: 'stay', square: null, when: { at: 'struck' } } })
  s.detachments[0].plan.square = walled
  // The floor's last room left: on to floor 2.
  s.at = s.map.end
  s.phase = 'reap'
  s.offers = [{ type: 'relic', id: RELICS[Object.keys(RELICS)[0]].id }]
  apply(run, { type: 'reap', index: null })
  assert.deepEqual([s.floor, s.camp], [2, next])
  const near = Math.min(...[...Array(TILES).keys()].filter((t) => !walls.includes(t)).map((t) => distance(t, walled)))
  const want = [...Array(TILES).keys()].find((t) => !walls.includes(t) && distance(t, walled) === near)
  assert.deepEqual(s.detachments.map((d) => [d.members, d.plan]), [
    [[knight.uid], { where: 'move', square: want, when: { at: 'once' } }],
    [[chanter.uid], { where: 'stay', square: null, when: { at: 'struck' } }]
  ])
  assert.ok(isSquare(s, want))
  checkState(s)
})

// ── fuzz: random legal actions, invariants after every one, replay at the end ──────────────────

function checkState (s) {
  assert.ok(['map', 'prep', 'reap', 'over'].includes(s.phase), s.phase)
  const all = souls(s.party)
  assert.ok(all.length >= 1 && all.length <= TUNING.party.roster + 3 * s.relics.filter((r) => r === 'ossuary_key').length)
  assert.ok(Number.isInteger(s.essence) && s.essence >= 0, `essence ${s.essence}`)
  assert.equal(new Set(s.party.map((u) => u.uid)).size, s.party.length, 'unique uids')
  assert.ok(s.party.every((u) => u.uid < s.nextUid || u.uid === MONARCH_UID), 'uids below nextUid')
  const field = s.party.filter((u) => u.slot >= 0)
  assert.equal(new Set(field.map((u) => u.slot)).size, field.length, 'unique slots')
  const legion = s.keystones.reduce((n, id) => n + (KEYSTONES[id].field ?? 0), 0)
  assert.ok(fielded(all).length <= baseField(s) + s.monarch.command + s.relics.filter((r) => r === 'grave_banner').length + legion, 'field cap')
  // The Monarch: one, always on the field, its level the points bought and its HP grown with them; it
  // stands until the run is over.
  const m = s.party.filter((u) => u.id === 'monarch')
  assert.deepEqual(m.map((u) => u.uid), [MONARCH_UID])
  assert.ok(campOpen(s.camp, m[0].slot), 'the Monarch is never benched')
  assert.deepEqual([m[0].lvl, m[0].maxHp, m[0].path, m[0].tier], [monarchPoints(s), baseStats('monarch', monarchPoints(s)).hp, null, 0])
  if (s.phase !== 'over') assert.ok(m[0].hp > 0, 'the Monarch stands')
  assert.equal(s.result === 'defeat', !!s.death)
  for (const u of all) {
    assert.ok(u.slot === -1 || campOpen(s.camp, u.slot), `${u.id} slot ${u.slot} in camp ${s.camp}`)
    assert.ok(Number.isInteger(u.hp) && u.hp >= 0 && u.hp <= u.maxHp, `${u.id} hp ${u.hp}/${u.maxHp}`)
    assert.ok(u.lvl >= 1 && u.lvl <= TUNING.level.cap, `${u.id} lvl ${u.lvl}`)
    assert.ok(u.tier >= 0 && u.tier <= 4 && (u.tier === 0) === (u.path === null), `${u.id} ${u.path} ${u.tier}`)
    if (u.path) assert.ok(pathsOf(u.id).some((p) => p.id === u.path), `${u.id} path ${u.path}`)
    checkRank(u)
  }
  assert.ok(Number.isInteger(m[0].hp) && m[0].hp >= 0 && m[0].hp <= m[0].maxHp)
  // The army: counts never negative; the muster in its range; free binds only in a reap; every cohort led
  // by a soul that can lead it, within Command, in a known shape; never more of a kind led than stand.
  for (const [id, o] of Object.entries(s.ossuary)) {
    assert.ok(UNITS[id] && !UNITS[id].boss && !UNITS[id].monarch, id)
    assert.ok([o.standing, o.fallen].every((n) => Number.isInteger(n) && n >= 0), `${id} ${JSON.stringify(o)}`)
  }
  assert.ok(Number.isInteger(s.muster) && s.muster >= TUNING.army.muster.start && s.muster <= TUNING.army.muster.cap, `muster ${s.muster}`)
  assert.ok(Number.isInteger(s.freeBinds) && s.freeBinds >= 0 && (s.phase === 'reap' || s.freeBinds === 0), `free binds ${s.freeBinds}`)
  assert.ok(!m[0].cohort, 'the Monarch leads no cohort')
  const led = {}
  for (const u of all.filter((x) => x.cohort)) {
    const c = u.cohort
    assert.ok(canLead(u, c.kind) && SHAPES[c.shape] && Number.isInteger(c.count) && c.count >= 1 && c.count <= cohortCap(s, u), `${u.id} ${JSON.stringify(c)}`)
    led[c.kind] = (led[c.kind] ?? 0) + c.count
  }
  for (const [kind, n] of Object.entries(led)) assert.ok(n <= standingOf(s, kind), `${n} ${kind} led, ${standingOf(s, kind)} standing`)
  for (const o of s.offers.filter((x) => x.type === 'bind')) assert.ok(UNITS[o.id] && Number.isInteger(o.max) && o.max >= 1, JSON.stringify(o))
  assert.ok(fieldCap({ state: s }) <= TUNING.army.board)
  // Orders: at most TUNING.army.detachments, ids distinct with their colours, each with captains (souls of
  // the party, none in two) and a plan as the run keeps it.
  assert.ok(s.detachments.length <= TUNING.army.detachments)
  assert.equal(new Set(s.detachments.map((d) => d.id)).size, s.detachments.length)
  const members = s.detachments.flatMap((d) => d.members)
  assert.equal(new Set(members).size, members.length, 'a captain in one detachment')
  for (const d of s.detachments) {
    assert.ok(Number.isInteger(d.id) && d.id >= 1 && d.color === DETACHMENT_COLORS[(d.id - 1) % DETACHMENT_COLORS.length], JSON.stringify(d))
    assert.ok(d.members.length && d.members.every((uid) => all.some((u) => u.uid === uid)), JSON.stringify(d))
    const { where, square, when } = d.plan
    assert.ok(ORDERS.where[where] && ORDERS.when[when.at], JSON.stringify(d.plan))
    assert.ok(where === 'move' ? isSquare(s, square) : square === null, JSON.stringify(d.plan))
    assert.ok(when.at !== 'time' || (Number.isInteger(when.t) && when.t >= 1 && when.t < TUNING.tick.ceiling), JSON.stringify(d.plan))
  }
  // Keystones: known, never one twice, at most TUNING.keystone.max, none before its floor; an offer is one
  // the run does not hold, and only while it may take one more.
  assert.ok(s.keystones.every((id) => KEYSTONES[id]) && new Set(s.keystones).size === s.keystones.length, JSON.stringify(s.keystones))
  assert.ok(s.keystones.length <= TUNING.keystone.max && (s.floor >= TUNING.keystone.fromFloor || !s.keystones.length))
  for (const o of s.offers.filter((x) => x.type === 'keystone')) {
    assert.ok(KEYSTONES[o.id] && !s.keystones.includes(o.id) && s.keystones.length < TUNING.keystone.max, JSON.stringify(o))
  }
}

// Ranks: a Soldier holds tiers I–III; a Knight one more, tier IV or a second path's tier I, never both; a
// Marshal tier IV and its second path's I–III; a second path is another of its kind's, never one that clashes.
function checkRank (u) {
  const where = `${u.id} grade ${u.grade} ${u.path} ${u.tier} ${u.path2} ${u.tier2}`
  assert.ok([0, 1, 2].includes(u.grade), where)
  assert.ok(Number.isInteger(u.tier2) && u.tier2 >= 0 && u.tier2 <= 3 && (u.tier2 === 0) === (u.path2 === null), where)
  if (u.path2) assert.ok(u.path && u.path2 !== u.path && !pathsClash(u.id, u.path, u.path2) && pathsOf(u.id).some((p) => p.id === u.path2), where)
  const extra = (u.tier === 4 ? 1 : 0) + (u.tier2 ? 1 : 0)
  assert.ok(u.grade === 2 ? u.tier2 <= 3 : u.grade === 1 ? extra <= 1 && u.tier2 <= 1 : extra === 0, where)
}

// A fifth of the time a uniformly random legal action, else the autoplay policy at `level`: a floor is 15
// rooms long, and random play rarely gets past the first. `fought(run)` sees each battle once it is over.
function fuzz (seed, seen, level = STEADY, fought = () => {}) {
  const rng = createRng(seed).stream('fuzz')
  const run = createRun({ seed })
  for (let steps = 0; run.state.phase !== 'over'; steps++) {
    assert.ok(steps < 1e5, 'stuck')
    const legal = legalActions(run)
    assert.ok(legal.length > 0)
    const action = rng.chance(0.2) ? rng.pick(legal) : policy(run, rng, level)
    seen.add(action.type)
    apply(run, action)
    if (action.type === 'fight') fought(run)
    checkState(run.state)
    if (steps % 97 === 0) everyLegalActionApplies(run)
  }
  return run
}

// The run rebuilt by replay is the run, and each legal action applies cleanly to a copy of it (one replay,
// cloned per action: a long run's log is a whole run of battles to refight).
function everyLegalActionApplies (run) {
  const base = replay(run.state.seed, run.state.log)
  assert.deepEqual(base.state, run.state)
  const legal = legalActions(run)
  for (const action of legal.filter((_, i) => i % Math.ceil(legal.length / 12) === 0)) {
    const copy = { ...base, state: structuredClone(base.state) }
    assert.doesNotThrow(() => apply(copy, action), JSON.stringify(action))
  }
}

// Forty more runs fight on the orders their random actions gave (the policy would disband them), so plans
// reach the battles the invariants and replays cover: Stay and Move on the board, held detachments called,
// Move units arriving. (They seldom leave floor 1, so they are kept apart from the hundred.)
const KEEPING = { ...STEADY, keepOrders: true }

test('fuzz: 140 runs of random legal actions keep every invariant, cover every action, fight on plans, and replay exactly', () => {
  const results = {}
  const seen = new Set()
  const plans = { detachments: 0, planned: 0, held: 0, called: 0, arrived: 0 }
  const fought = (run) => {
    const { setup, battle } = run
    plans.detachments += setup.detachments.length > 0
    plans.planned += setup.party.some((u) => u.plan && u.plan.where !== 'hunt')
    plans.held += setup.reserve.some((u) => u.when)
    plans.called += battle.events.some((e) => e.type === 'call')
    plans.arrived += battle.events.some((e) => e.type === 'arrive')
  }
  let keystones = 0
  for (let i = 0; i < 100; i++) {
    const run = fuzz('fuzz' + i, seen)
    results[run.state.floor] = (results[run.state.floor] ?? 0) + 1
    keystones += run.state.keystones.length
    assert.deepEqual(replay(run.state.seed, run.state.log).state, run.state)
  }
  for (let i = 0; i < 40; i++) {
    const run = fuzz('fuzz-plans' + i, seen, KEEPING, fought)
    assert.deepEqual(replay(run.state.seed, run.state.log).state, run.state)
  }
  // Floor 1's late pairs and floor 2's captains make the deeper floors rare for these policies: the deeper
  // floors' rooms (waves, sieges, the Sovereign's court) are played through in test/enemy.test.js.
  assert.ok(Object.keys(results).length > 1, `fuzz runs should end on different floors: ${JSON.stringify(results)}`)
  assert.ok(keystones > 0, 'some runs took keystones')
  assert.deepEqual([...seen].sort(), ['bind', 'cohort', 'disband', 'fight', 'level', 'monarch', 'muster', 'node', 'order', 'place', 'promote', 'reap', 'release', 'upgrade'])
  assert.ok(Object.values(plans).every((n) => n >= 5), `battles with plans: ${JSON.stringify(plans)}`)
})
