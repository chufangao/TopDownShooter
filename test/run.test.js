import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRun, apply, legalActions, availableNodes, replay, join, currentNode, fielded, levelCost, tierCost, rosterCap, fieldCap,
  MONARCH_UID, MONARCH_STATS, monarchOf, souls, monarchCost, monarchPoints, domainOf, faltersAt, battleSetup, encounter, drawRoom, roomThreats,
  foeEssence, armyLayout, isSquare, detachmentOf, DEFAULT_PLAN, baseField, inOssuary, OSSUARY, promoteLevel
} from '../src/sim/run.js'
import { createBattle, runBattle, stats, stepBattle, falters } from '../src/sim/battle.js'
import { autoplay, policy, rehearsalBudget, LEVELS, scoreOf, planFor, armyWish, detachmentsOf, rehearse, replan } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { generateFloor } from '../src/sim/map.js'
import { TUNING } from '../src/tuning.js'
import { tuned, FIRST_BALANCE } from './tuned.js'
import { RELICS, UNITS, ROLES, ORDERS, DETACHMENT_COLORS } from '../src/content.js'
import { summonsOf } from '../src/sim/unit.js'
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
  assert.deepEqual(kinds(run), ['level', 'monarch', 'node', 'order', 'place', 'release', 'upgrade'])
  assert.deepEqual(legalActions(run).filter((a) => a.type === 'monarch').map((a) => a.stat), MONARCH_STATS)
  assert.ok(!legalActions(run).some((a) => a.uid === MONARCH_UID && ['level', 'upgrade', 'release'].includes(a.type)))
  assert.ok(!legalActions(run).some((a) => a.type === 'place' && a.uid === MONARCH_UID && a.slot === -1))
  run.state.essence = 0
  visit(run, 'fight')
  assert.equal(run.state.phase, 'prep')
  assert.deepEqual(kinds(run), ['fight', 'order', 'place', 'release'])
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
  assert.deepEqual(s.offers.map((o) => o.type), sale.map(() => 'soul'), 'souls only: nothing to bind')
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
  // A full soul: its level, no path yet, a Soldier, on the field if there is room or else in the ossuary.
  const got = s.party.at(-1)
  assert.deepEqual([got.path, got.tier, got.grade, got.hp === got.maxHp], [null, 0, 0, true])
  assert.equal(s.phase, 'map', 'a fight\'s spoils were its souls: the room ends')
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
  const kept = s.party.find((u) => u.slot < 0)
  apply(run, { type: 'release', uid: kept.uid })
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

// Buys the Monarch `n` points of Command out of a purse topped up for it, as a player would.
function command (run, n) {
  for (let k = 0; k < n; k++) {
    run.state.essence += monarchCost(run)
    apply(run, { type: 'monarch', stat: 'command' })
  }
}
// A copy of a run to try an action on (the state edited outside the log, so not a replay).
const copyOf = (run) => ({ ...run, state: structuredClone(run.state) })

// ── the army: souls, the ossuary, summons ───────────────────────────────────────────────────────

test('the army is the souls: no bodies, no muster, no binds; Command is the field cap (3 + Command), never past the board', async () => {
  const run = createRun({ seed: 'army' })
  const s = run.state
  for (const k of ['ossuary', 'muster', 'freeBinds']) assert.ok(!(k in s), `no ${k} in the state`)
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
  // Relics and keystones add to it, and it never passes the board.
  s.relics.push('grave_banner')
  s.keystones.push('legion')
  assert.equal(fieldCap(run), 6 + 1 + 2)
  s.monarch.command = 20
  assert.equal(fieldCap(run), TUNING.army.board)
  // The old exports are gone with the bodies, the cohorts, the muster and the binds.
  const gone = ['benched', 'keptShadows', 'canLead', 'standingOf', 'freeBodies', 'kinStanding', 'feedOf', 'cohortCap', 'musterCost', 'bindCost', 'promoteNeed']
  const runJs = await import('../src/sim/run.js')
  assert.deepEqual(gone.filter((k) => k in runJs), [])
  assert.ok(!('SHAPES' in await import('../src/content.js')))
  assert.ok(!('muster' in TUNING.army) && !('bindPerTier' in TUNING.army) && !('overflow' in TUNING.army) && !('cohort' in TUNING.ranks))
})

test('the ossuary is the soul collection: recruits past the field wait there, a soul leaves it only while the field has room, and the roster counts both', () => {
  const run = createRun({ seed: 'ossuary' })
  const s = run.state
  // The field full (3), every new soul waits in the ossuary, kept whole.
  const extra = [join(run, 'grave_ghoul', { lvl: 4 }), join(run, 'will_o_wisp', { lvl: 3 })]
  assert.deepEqual(extra.map((u) => u.slot), [OSSUARY, OSSUARY])
  assert.deepEqual(inOssuary(souls(s.party)), extra)
  assert.deepEqual(extra.map((u) => [u.lvl, u.path, u.grade]), [[4, null, 0], [3, null, 0]])
  // No room on the field: an open cell is refused, a swap is not.
  const open = [...Array(CAMP_SLOTS).keys()].find((slot) => campOpen(s.camp, slot) && !s.party.some((u) => u.slot === slot))
  assert.throws(() => apply(run, { type: 'place', uid: extra[0].uid, slot: open }), /cannot place/)
  assert.ok(!legalActions(run).some((a) => a.type === 'place' && a.uid === extra[0].uid && a.slot === open))
  const [knight] = souls(s.party)
  const cell = knight.slot
  apply(run, { type: 'place', uid: extra[0].uid, slot: cell })
  assert.deepEqual([extra[0].slot, knight.slot], [cell, OSSUARY], 'the fielded soul goes to the ossuary in its place')
  // A point of Command: one more may leave it for an open cell.
  command(run, 1)
  apply(run, { type: 'place', uid: extra[1].uid, slot: open })
  assert.equal(fielded(souls(s.party)).length, 4)
  assert.deepEqual(inOssuary(souls(s.party)), [knight])
  // The Monarch never goes there, and the roster cap counts the ossuary and the field together.
  assert.throws(() => apply(run, { type: 'place', uid: MONARCH_UID, slot: OSSUARY }), /cannot place/)
  while (souls(s.party).length < rosterCap(run)) join(run, 'clockwork_page')
  assert.throws(() => join(run, 'clockwork_page'), /the retinue is full/)
  assert.equal(inOssuary(souls(s.party)).length, rosterCap(run) - fieldCap(run))
  checkState(s)
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

// A summoner: the chanter on Marrowcaller II, which raises 2 Skeletons a battle.
const summoner = (run, lvl = 5) => Object.assign(run.state.party.find((u) => u.id === 'bone_chanter'), { path: 'marrowcaller', tier: 2, lvl })

test('summons: a summon tier raises them each battle beside their summoner, at its level, on its plan; a Knight raises one more, a Marshal two', () => {
  const run = createRun({ seed: 'summon' })
  const s = run.state
  visit(run, 'fight')
  // A domain over the whole camp, so that no one falters (and drops its plan) at the start.
  s.monarch.dominion = 9
  const chanter = summoner(run, 5)
  assert.deepEqual(summonsOf(chanter), [{ id: 'skeleton', count: 2, lvl: 5 }])
  apply(run, { type: 'order', uids: [chanter.uid], plan: planOf('stay') })
  // The setup holds souls only: the battle raises the summons, uids after the foes'.
  const setup = battleSetup(run)
  assert.ok(!setup.party.some((u) => u.summoned) && !setup.reserve.some((u) => u.summoned))
  assert.equal(setup.nextUid, s.nextUid + setup.foes.length + setup.reserve.filter((u) => u.side === 'foe').length)
  const b = createBattle(setup)
  const me = b.units.find((u) => u.uid === chanter.uid)
  const raised = b.units.filter((u) => u.summoned)
  assert.deepEqual(raised.map((u) => [u.id, u.lvl, u.summoner, u.cohortOf, u.det, u.where]), [['skeleton', 5, chanter.uid, chanter.uid, 1, 'stay'], ['skeleton', 5, chanter.uid, chanter.uid, 1, 'stay']])
  assert.deepEqual(raised.map((u) => u.uid), [setup.nextUid, setup.nextUid + 1])
  // Beside it (here there is room), and Stay holds the tile each appeared on.
  assert.ok(raised.every((u) => distance(u.tile, me.tile) === 1 && u.anchor === u.tile))
  // Announced with everyone at the start, marked for the renderer.
  const start = b.events[0].units.filter((u) => u.summoned)
  assert.deepEqual(start.map((u) => [u.uid, u.summoner, u.det]), raised.map((u) => [u.uid, chanter.uid, 1]))
  // They count toward synergies like anyone: the chanter, the knight and two Skeletons are Undead 4.
  assert.ok(b.events[0].synergies.some((x) => x.side === 'party' && x.id === 'undead_4'))
  // A Knight's summon tier raises one more, a Marshal's two; a soul with no summon tier raises none.
  for (const [grade, n] of [[1, 3], [2, 4]]) {
    chanter.grade = grade
    assert.equal(createBattle(battleSetup(run)).units.filter((u) => u.summoned).length, n)
  }
  chanter.grade = 0
  assert.deepEqual(summonsOf(s.party.find((u) => u.id === 'tomb_knight')), [])
  // The level follows TUNING.summon.level: half the summoner's, rounded, at least 1.
  tuned({ summon: { level: 0.5 } }, () => {
    assert.ok(createBattle(battleSetup(run)).units.filter((u) => u.summoned).every((u) => u.lvl === 3))
    chanter.lvl = 1
    assert.ok(createBattle(battleSetup(run)).units.filter((u) => u.summoned).every((u) => u.lvl === 1))
    chanter.lvl = 5
  })
  // The summons switch (the ablation harness's) raises none.
  assert.equal(createBattle({ ...battleSetup(run), ablate: ['summons'] }).units.filter((u) => u.summoned).length, 0)
  // A summoner in the ossuary, or fallen, raises nothing.
  chanter.hp = 0
  assert.equal(createBattle(battleSetup(run)).units.filter((u) => u.summoned).length, 0)
})

test('summons follow their summoner: on its leash, on its Move, and orphaned (faltering, Hunting) when it falls', () => {
  const run = createRun({ seed: 'summon-move' })
  visit(run, 'fight')
  run.state.monarch.dominion = 9
  const chanter = summoner(run, 6)
  const square = tileAt(0, CAMP_ROWS + 1)
  apply(run, { type: 'order', uids: [chanter.uid], plan: { where: 'move', square, when: { at: 'once' } } })
  const b = createBattle(battleSetup(run))
  const me = b.units.find((u) => u.uid === chanter.uid)
  const raised = b.units.filter((u) => u.summoned)
  assert.ok(raised.every((u) => u.where === 'move' && u.square === square && u.det === 1))
  // While it walks to its square, they keep near it (a tile, or the nearest ring with room).
  for (let t = 0; t < 200 && !b.over && me.hp > 0; t++) {
    stepBattle(b)
    for (const u of raised) if (u.hp > 0 && !u.orphan) assert.ok(distance(u.tile, me.tile) <= 3, `t ${b.t}: ${u.uid} strayed`)
  }
  // Its fall orphans them: they falter and Hunt for the rest of the battle. (The chanter carried in at 1 HP,
  // against Rangers far above it, which pick off the weakest: it falls before its summons do.)
  const setup = battleSetup(run)
  const fight = createBattle({ ...setup, party: setup.party.map((u) => (u.uid === chanter.uid ? { ...u, hp: 1 } : u)), foes: setup.foes.map((f) => makeUnit('ember_drake', { uid: f.uid, lvl: 20, slot: f.slot })) })
  const lead = fight.units.find((u) => u.uid === chanter.uid)
  while (!fight.over && lead.hp > 0) stepBattle(fight)
  assert.ok(lead.hp <= 0, 'the summoner fell')
  const left = fight.units.filter((x) => x.summoned && x.hp > 0)
  assert.ok(left.length > 0, 'a summon outlived it')
  for (const u of left) assert.ok(u.orphan && u.where === 'hunt' && falters(fight, u), `${u.uid} orphaned`)
})

test('summons of a held soul appear as it enters, beside it, fresh, on its plan; they take no place on the board', () => {
  const run = createRun({ seed: 'summon-held' })
  visit(run, 'fight')
  const chanter = summoner(run, 4)
  apply(run, { type: 'order', uids: [chanter.uid], plan: { where: 'stay', square: null, when: { at: 'time', t: 20 } } })
  const setup = battleSetup(run)
  assert.deepEqual(setup.reserve.filter((u) => u.side !== 'foe').map((u) => u.uid), [chanter.uid], 'only the soul waits')
  const b = createBattle(setup)
  assert.equal(b.units.filter((u) => u.summoned).length, 0, 'none before it enters')
  while (!b.over && !b.events.some((e) => e.type === 'summon')) stepBattle(b)
  const enter = b.events.find((e) => e.type === 'enter' && e.unit.uid === chanter.uid)
  const raised = b.events.filter((e) => e.type === 'summon')
  assert.equal(raised.length, 2)
  assert.ok(raised.every((e) => e.t === enter.t && e.actor === chanter.uid && e.unit.summoned && e.unit.summoner === chanter.uid && e.unit.det === 1))
  const me = b.units.find((u) => u.uid === chanter.uid)
  for (const e of raised) {
    const u = b.units.find((x) => x.uid === e.unit.uid)
    assert.ok(distance(u.tile, me.tile) <= 2 && u.where === 'stay' && u.gauge === u.costliest && u.statuses.some((x) => x.id === 'shield'), 'fresh, as its summoner')
  }
  // They take no place: a board cap of the souls standing still lets the next soul of the reserve in.
  tuned({ army: { board: 3 } }, () => {
    const two = createRun({ seed: 'summon-held' })
    visit(two, 'fight')
    summoner(two, 4)
    const lone = createBattle({
      ...battleSetup(two),
      reserve: [{ ...makeUnit('grave_ghoul', { uid: 900, lvl: 2 }), slot: -1 }]
    })
    // Three souls and two Skeletons on the board, the board's cap 3: the summons leave room for none of the
    // souls' places, so the waiting one enters only once a soul falls; with the summons counted it never would.
    const souls0 = lone.units.filter((u) => u.side === 'party' && u !== lone.monarch && !u.summoned).length
    assert.equal(souls0, 3)
    assert.equal(lone.units.filter((u) => u.summoned).length, 2)
    lone.units.find((u) => u.side === 'party' && u !== lone.monarch && !u.summoned).hp = 0
    lone.roster++
    stepBattle(lone)
    assert.ok(lone.events.some((e) => e.type === 'enter' && e.unit.uid === 900), 'a place freed by a soul, not taken by the summons')
  })
})

test('summons give nothing and keep nothing: no essence, no recruit, no place in the retinue; the run moves past their uids', () => {
  const run = winFight('summon-spoils', (r) => summoner(r, 6))
  const s = run.state
  const b = run.battle
  const raised = b.units.filter((u) => u.summoned)
  assert.equal(raised.length, 2)
  assert.ok(!s.party.some((u) => u.summoned), 'none joins the retinue')
  assert.ok(s.offers.every((o) => o.type !== 'soul' || !UNITS[o.id].summon), 'none is for sale')
  assert.equal(s.nextUid, b.nextUid)
  assert.ok(raised.every((u) => u.uid < s.nextUid))
  // Essence is the slain foes' alone.
  const paid = b.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0).reduce((n, u) => n + foeEssence(u), 0)
  assert.equal(s.stats.essence, Math.round(paid))
})

test('a fallen summon never rises: not by the foes\' Legion (Undead 8)', () => {
  // Eight strong Ghouls hold the Legion (their rules on); the chanter's Skeletons fall to them.
  const party = [
    { ...makeUnit('monarch', { uid: 0, lvl: 3 }), slot: slotAt(6, 3) },
    { ...makeUnit('bone_chanter', { uid: 1, lvl: 4 }), path: 'marrowcaller', tier: 2, slot: slotAt(2, 3) },
    { ...makeUnit('tomb_knight', { uid: 2, lvl: 4 }), slot: slotAt(1, 3) }
  ]
  const foes = [0, 1, 2, 3, 4, 5, 6, 3].map((c, i) => ({ ...makeUnit('grave_ghoul', { uid: 10 + i, lvl: 9 }), slot: slotAt(i < 7 ? 0 : 1, c) }))
  const b = createBattle({ party, foes, seed: 'legion-summons', foeRules: true, domain: 9 })
  runBattle(b)
  const raised = new Set(b.units.filter((u) => u.summoned).map((u) => u.uid))
  const fell = b.units.filter((u) => u.summoned && u.hp <= 0)
  assert.ok(fell.length > 0, 'a Skeleton fell')
  assert.ok(b.events.some((e) => e.type === 'rule' && e.rule === 'legion'), 'the Legion raised someone')
  assert.ok(!b.events.some((e) => e.type === 'arise' && raised.has(e.corpse)), 'no summon rose')
  assert.ok(fell.every((u) => !u.raised))
})

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

// A held detachment (a later start) waits off the board: no cell, no count toward any cap, and enters beside
// the Monarch, soul by soul, when its start comes.
test('a detachment held for a later start waits off the board, counts toward no cap, and enters when called', () => {
  const run = createRun({ seed: 'army1' })
  const s = run.state
  visit(run, 'fight')
  const [knight, chanter, sprite] = souls(s.party)
  assert.deepEqual(armyLayout(s), { members: [], reserve: [], held: [] })
  apply(run, { type: 'order', uids: [knight.uid], plan: planOf('hunt', 'falls') })
  apply(run, { type: 'order', uids: [chanter.uid], plan: planOf('stay') })
  // The knight waits; its cell stays its own.
  assert.deepEqual(armyLayout(s).held, [{ det: 1, uid: knight.uid, id: 'tomb_knight' }])
  const setup = battleSetup(run)
  assert.ok(!setup.party.some((u) => u.uid === knight.uid))
  assert.deepEqual(setup.reserve.filter((u) => u.side !== 'foe').map((u) => [u.uid, u.det, u.when, u.plan, u.slot]), [[knight.uid, 1, { at: 'falls' }, { where: 'hunt', square: null }, -1]])
  assert.ok(knight.slot >= 0, 'its cell stays its own')
  // The Stay detachment carries its plan; the sprite none (it Hunts).
  assert.ok(setup.party.filter((u) => u.uid === chanter.uid).every((u) => u.det === 2 && u.plan.where === 'stay'))
  assert.ok(setup.party.filter((u) => u.uid === sprite.uid).every((u) => u.det === undefined && !u.plan))
  assert.deepEqual(setup.detachments, [{ id: 1, color: DETACHMENT_COLORS[0], ...planOf('hunt', 'falls') }, { id: 2, color: DETACHMENT_COLORS[1], ...planOf('stay') }])
  // Foes strong enough that one of yours falls, and the held detachment is called.
  const b = createBattle({ ...setup, foes: setup.foes.map((f) => makeUnit(f.id, { uid: f.uid, lvl: 25, slot: f.slot })) })
  assert.deepEqual(b.events.filter((e) => e.type === 'order').map((e) => [e.detachment, e.where, e.when.at]), [[1, 'hunt', 'falls'], [2, 'stay', 'once']])
  assert.equal(b.events[0].reserve.filter((u) => u.when).length, 1)
  runBattle(b)
  const fell = b.events.find((e) => e.type === 'death' && b.units.find((u) => u.uid === e.target).side === 'party')
  const call = b.events.find((e) => e.type === 'call')
  const entered = b.events.filter((e) => e.type === 'enter').map((e) => e.unit.uid)
  assert.ok(b.events.filter((e) => e.t <= fell.t).every((e) => e.type !== 'call' && e.type !== 'enter'), 'nothing before one falls')
  assert.deepEqual([call.t, call.detachment, call.at], [fell.t + 1, 1, 'falls'])
  assert.deepEqual(entered, [knight.uid])
  // A soul held all battle is untouched by it.
  apply(run, { type: 'fight' })
  if (!run.battle.events.some((e) => e.type === 'enter' && e.unit.uid === knight.uid)) assert.equal(knight.hp, knight.maxHp)
  // An order with no one on the board but held ones leaves the Monarch alone at the start.
  const lone = createRun({ seed: 'army1' })
  visit(lone, 'fight')
  apply(lone, { type: 'order', uids: fielded(souls(lone.state.party)).map((u) => u.uid), plan: planOf('stay', 'struck') })
  const solo = battleSetup(lone)
  assert.deepEqual(solo.party.map((u) => u.uid), [MONARCH_UID])
  assert.equal(solo.reserve.filter((u) => u.side !== 'foe').length, 3)
})

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
  // Formed the sprite's first, then the knight's: the knight's enters first all the same.
  apply(run, { type: 'order', uids: [sprite.uid], plan: planOf('hunt', 'falls') })
  apply(run, { type: 'order', uids: [chanter.uid, knight.uid], plan: planOf('stay', 'falls') })
  assert.deepEqual(s.detachments.map((d) => d.members), [[sprite.uid], [knight.uid, chanter.uid]])
  assert.deepEqual(armyLayout(s).held.map((h) => h.uid), [knight.uid, chanter.uid, sprite.uid])
  // The same formation as the autoplayer keeps it (orders on its souls) and rehearses it (detachmentsOf, in
  // another order and with other ids) sets up the same reserve, uids and all.
  const party = fielded(s.party).reverse().map((u) => ({ ...u, order: detachmentOf(s, u.uid)?.plan ?? null }))
  const order = new Map(s.party.map((u, i) => [u.uid, i]))
  const sorted = party.slice().sort((a, b) => order.get(a.uid) - order.get(b.uid))
  const entry = (setup) => setup.reserve.map((u) => [u.uid, u.id, u.when])
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
  // The army is souls: no bodies, muster or binds kept; no summon, shadow or boss ever in the retinue (the
  // ossuary is the souls off the field); the offers are souls, relics, tiers and keystones.
  for (const k of ['ossuary', 'muster', 'freeBinds']) assert.ok(!(k in s), k)
  for (const u of all) assert.ok(!UNITS[u.id].summon && !UNITS[u.id].boss && !u.summoned && !u.shadow && !('cohort' in u), u.id)
  assert.ok(s.offers.every((o) => ['soul', 'relic', 'tier', 'keystone'].includes(o.type)), JSON.stringify(s.offers))
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
  // Every action but promote: a rank takes a level and essence these spenders never leave standing together
  // (legal in some 6 of 9,000 steps), so ranks.test.js plays promotions (its fuzz and legalActions test).
  assert.deepEqual([...seen].sort(), ['disband', 'fight', 'level', 'monarch', 'node', 'order', 'place', 'reap', 'release', 'upgrade'])
  assert.ok(Object.values(plans).every((n) => n >= 5), `battles with plans: ${JSON.stringify(plans)}`)
})
