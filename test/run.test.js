import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRun, apply, legalActions, availableNodes, replay, join, currentNode, fielded, levelCost, rosterCap, fieldCap,
  MONARCH_UID, MONARCH_STATS, monarchOf, souls, monarchCost, monarchPoints, domainOf, battleSetup, encounter, drawRoom, roomThreats,
  foeEssence, baseField, inOssuary, OSSUARY, cleanLine, LINE_MAX, soulCount
} from '../src/sim/run.js'
import { createBattle, runBattle, stepBattle, timingMarks } from '../src/sim/battle.js'
import { autoplay, policy, rehearsalBudget, LEVELS, scoreOf, planFor, armyWish, rehearse, redraw, linesOf } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { generateFloor } from '../src/sim/map.js'
import { TUNING } from '../src/tuning.js'
import { tuned, FIRST_BALANCE } from './tuned.js'
import { RELICS, UNITS, SIGNALS } from '../src/content.js'
import {
  CAMP_SLOTS, CAMP_ROWS, campOpen, isWall, abilitiesOf, auraOf, statsOf, slotAt, rowOf, baseStats, makeUnit, tileAt,
  deployTile, distance, wallTiles, seatNear, isSeat, LANES, canTrack, bodyHp, bodiesHp, livingBodies
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
  assert.deepEqual([s.monarch, s.death, fielded(souls(s.party)).length, fieldCap(run)], [{ hp: 0, dominion: 0, command: 0, will: 0 }, null, 3, 3])
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
  assert.deepEqual(kinds(run), ['line', 'node', 'place', 'release'])
  run.state.essence = 1000
  assert.deepEqual(kinds(run), ['level', 'line', 'monarch', 'node', 'place', 'release', 'upgrade'])
  assert.deepEqual(legalActions(run).filter((a) => a.type === 'monarch').map((a) => a.stat), MONARCH_STATS)
  assert.ok(!legalActions(run).some((a) => a.uid === MONARCH_UID && ['level', 'upgrade', 'release'].includes(a.type)))
  assert.ok(!legalActions(run).some((a) => a.type === 'place' && a.uid === MONARCH_UID && !isSeat(run.state.camp, a.slot)), 'the Monarch only to a seat')
  assert.ok(!legalActions(run).some((a) => a.type === 'line' && a.uid === MONARCH_UID), 'the Monarch draws no line')
  run.state.essence = 0
  visit(run, 'fight')
  assert.equal(run.state.phase, 'prep')
  assert.deepEqual(kinds(run), ['fight', 'line', 'place', 'release'])
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
  // A full soul: its kind's level and tiers, on the field if there is room or else in the ossuary.
  const got = s.party.at(-1)
  assert.deepEqual([got.lvl, got.tracks, got.hp === got.maxHp], [s.kinds[got.id].lvl, s.kinds[got.id].tracks, true])
  assert.equal(s.phase, 'map', 'a fight\'s spoils were its souls: the room ends')
  checkState(s)
})

test('essence buys a kind its levels and track tiers', () => {
  const run = createRun({ seed: 'buy' })
  const s = run.state
  const knight = s.party.find((u) => u.id === 'tomb_knight')
  s.essence = 0
  assert.throws(() => apply(run, { type: 'level', kind: 'tomb_knight' }), /cannot level/)
  s.essence = 5000
  assert.throws(() => apply(run, { type: 'level', kind: 'monarch' }), /cannot level/)
  assert.throws(() => apply(run, { type: 'upgrade', kind: 'monarch', track: 0 }), /cannot upgrade/)
  const cost = levelCost(run, 'tomb_knight')
  const hp = knight.maxHp
  apply(run, { type: 'level', kind: 'tomb_knight' })
  assert.deepEqual([knight.lvl, s.kinds.tomb_knight.lvl, s.essence], [3, 3, 5000 - cost])
  assert.ok(knight.maxHp > hp && knight.hp === knight.maxHp)
  const def = statsOf(knight).def
  apply(run, { type: 'upgrade', kind: 'tomb_knight', track: 0 })
  assert.deepEqual(knight.tracks, [1, 0])
  assert.ok(statsOf(knight).def > def, 'Bulwark I raises DEF')
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
})

test('a rite offers free next tiers, each for a different kind, and taking one ends it', () => {
  const run = createRun({ seed: 'rite' })
  const s = run.state
  visit(run, 'rite')
  assert.equal(s.phase, 'reap')
  assert.equal(s.offers.length, 3)
  assert.ok(s.offers.every((o) => o.type === 'tier' && canTrack(s.kinds[o.kind].tracks, o.track)))
  assert.equal(new Set(s.offers.map((o) => o.kind)).size, 3)
  const o = s.offers[1]
  const essence = s.essence
  apply(run, { type: 'reap', index: 1 })
  const tracks = [0, 0].map((x, i) => (i === o.track ? 1 : 0))
  assert.deepEqual([s.kinds[o.kind].tracks, s.party.find((x) => x.id === o.kind).tracks, s.essence, s.phase], [tracks, tracks, essence, 'map'])
})

test('releasing the last soul of a kind during a rite withdraws its kind\'s offer, and a rite left with none ends', () => {
  const run = createRun({ seed: 'rite-release' })
  const s = run.state
  join(run, s.party[1].id)
  visit(run, 'rite')
  const ofKind = (kind) => s.party.filter((u) => u.id === kind)
  const [first, ...rest] = s.offers
  const all = s.offers.slice()
  // A second soul of the kind keeps the offer; the last one takes it away.
  if (ofKind(first.kind).length > 1) {
    apply(run, { type: 'release', uid: ofKind(first.kind)[0].uid })
    assert.deepEqual(s.offers, all)
  }
  apply(run, { type: 'release', uid: ofKind(first.kind)[0].uid })
  assert.deepEqual(s.offers, rest)
  for (const o of rest) for (const u of ofKind(o.kind)) if (souls(s.party).length > 1) apply(run, { type: 'release', uid: u.uid })
  assert.equal(s.phase, s.offers.length ? 'reap' : 'map')
})

test('a full retinue must release a soul before it can recruit', () => {
  const run = winFight('full')
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
  const rear = (camp) => seatNear(camp)
  for (let i = 0; i < 4; i++) {
    const run = autoplay(createRun({ seed: 'park' + i }), {
      onBattle: (b, r) => assert.equal(r.setup.party.find((u) => u.uid === MONARCH_UID).slot, rear(r.setup.camp), `park${i} floor ${b.floor}`)
    })
    assert.deepEqual([run.state.monarch.dominion, run.state.monarch.will], [0, 0], 'basic buys only Command')
  }
  // The expert's drafts put the Monarch on the rear row's middle seat or the one ahead of it (or in a pocket);
  // the hill-climb takes it to other seats.
  // (A seed whose expert clears floor 1: floor 1 is hard, and one lost before a point is bought proves nothing.)
  const run = createRun({ seed: 'monarch-expert3' })
  const rng = createRng('monarch-expert3').stream('autoplay')
  const fights = []
  const bought = []
  while (run.state.floor === 1 && run.state.phase !== 'over') {
    const action = policy(run, rng, 'expert')
    if (action.type === 'monarch') bought.push(action.stat)
    apply(run, action)
    if (action.type !== 'fight') continue
    const drafted = [seatNear(run.setup.camp), seatNear(run.setup.camp, slotAt(CAMP_ROWS - 2, 3))]
    fights.push({ slot: run.setup.party.find((u) => u.uid === MONARCH_UID).slot, drafted })
  }
  assert.ok(fights.every((f) => isSeat(run.setup.camp, f.slot) || f.slot === undefined), 'always on a seat')
  assert.ok(fights.some((f) => !f.drafted.includes(f.slot)) || fights.length < 2, `the Monarch stood in ${fights.map((f) => f.slot)}`)
  assert.ok(bought.length > 0, 'it bought a Monarch point')
})

// The plan is carried out, the Monarch's cell included, from wherever the player left it: basic walks it
// back to the rear row's middle lane, the expert to the cell its search chose.
test('the autoplayer moves the Monarch to its planned cell before it fights, and every soul to its own', () => {
  for (const level of ['basic', 'expert']) {
    const run = createRun({ seed: 'prep' })
    const s = run.state
    visit(run, 'fight')
    const start = [slotAt(CAMP_ROWS - 2, 0), slotAt(CAMP_ROWS - 1, 0), slotAt(CAMP_ROWS - 2, 6)].find((slot) => isSeat(s.camp, slot) && !s.party.some((u) => u.slot === slot))
    apply(run, { type: 'place', uid: MONARCH_UID, slot: start })
    const rng = createRng('prep').stream('autoplay')
    for (let action; (action = policy(run, rng, level)).type !== 'fight';) apply(run, action)
    const plan = planFor(run, LEVELS[level])
    const cell = plan.find((p) => p.uid === MONARCH_UID).slot
    assert.notEqual(cell, start, `${level}: the plan moves it`)
    if (level === 'basic') assert.equal(cell, seatNear(s.camp), 'basic parks it on the rear row')
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
  assert.deepEqual([fieldCap(b), fielded(souls(s.party)).length, soulCount(s.party)], [4, 4, 5])
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

test('the Monarch starts on the rear row\'s middle seat and its souls on the front row; it moves among the seats, never to the bench', () => {
  for (const c of CAMP_LIST.filter((x) => x.floor === 1)) {
    let run
    for (let i = 0; !run || run.state.camp !== c.id; i++) run = createRun({ seed: 'throne' + i })
    const m = monarchOf(run.state)
    assert.equal(m.slot, seatNear(c.id))
    assert.equal(rowOf(m.slot), CAMP_ROWS - 1)
    assert.ok(souls(run.state.party).every((u) => rowOf(u.slot) === 0), `${c.id}: a plain fill, from the front row`)
  }
  const run = createRun({ seed: 'throne' })
  const s = run.state
  const m = monarchOf(s)
  const [knight, chanter] = souls(s.party)
  // A seat of the rear two rows only: the third row from the back is refused.
  assert.throws(() => apply(run, { type: 'place', uid: MONARCH_UID, slot: slotAt(CAMP_ROWS - 3, 3) }), /cannot place/)
  const seat = slotAt(CAMP_ROWS - 2, 2)
  apply(run, { type: 'place', uid: MONARCH_UID, slot: seat })
  assert.equal(m.slot, seat)
  // A soul swaps cells with it only from a seat: from the front row it would put the Monarch off the seats.
  assert.throws(() => apply(run, { type: 'place', uid: knight.uid, slot: seat }), /cannot place/)
  apply(run, { type: 'place', uid: knight.uid, slot: slotAt(CAMP_ROWS - 1, 2) })
  apply(run, { type: 'place', uid: knight.uid, slot: seat })
  assert.deepEqual([knight.slot, m.slot], [seat, slotAt(CAMP_ROWS - 1, 2)])
  // A benched soul cannot take its cell (that would bench it), though one can take a free cell.
  apply(run, { type: 'place', uid: chanter.uid, slot: -1 })
  assert.throws(() => apply(run, { type: 'place', uid: chanter.uid, slot: m.slot }), /cannot place/)
  assert.throws(() => apply(run, { type: 'place', uid: MONARCH_UID, slot: -1 }), /cannot place/)
  // It takes no room: three souls fill the field beside it, and it is never released.
  apply(run, { type: 'place', uid: chanter.uid, slot: [...Array(CAMP_SLOTS).keys()].find((t) => campOpen(s.camp, t) && !s.party.some((u) => u.slot === t)) })
  assert.equal(fielded(s.party).length, fieldCap(run) + 1)
  assert.throws(() => join(run, 'monarch'), /one Monarch/)
})

test('Monarch points: HP, Dominion, Command and Will, at 20 + 10 per point bought; only HP raises its level and HP', () => {
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
    const maxHp = m.maxHp
    apply(run, { type: 'monarch', stat })
    spent += cost
    assert.deepEqual([m.lvl, monarchPoints(s), m.maxHp, m.hp], [0, k + 1, maxHp, 50])
  }
  assert.deepEqual([s.monarch, s.essence], [{ hp: 0, dominion: 1, command: 2, will: 1 }, 1000 - spent])
  // Command: banners. Dominion: the domain. Will: Arise. The battle gets them all.
  assert.equal(fieldCap(run), TUNING.party.field + 2)
  assert.equal(domainOf(s), TUNING.monarch.domain + 1)
  visit(run, 'fight')
  const setup = battleSetup(run)
  assert.deepEqual([setup.domain, setup.will, setup.nextUid], [domainOf(s), 1, s.nextUid + setup.foes.length])
  assert.equal(setup.party.find((u) => u.uid === MONARCH_UID).maxHp, m.maxHp)
  // Its level is the HP points bought, with no cap: past the souls' at 12.
  s.essence = 1e6
  while (s.monarch.hp < 12) apply(run, { type: 'monarch', stat: 'hp' })
  assert.ok(12 > TUNING.level.cap)
  assert.deepEqual([m.lvl, m.maxHp], [12, baseStats('monarch', 12).hp])
})

test('a fight: shadows never join the retinue and the run moves past their uids; wounds carry; a fallen Monarch ends the run', () => tuned(FIRST_BALANCE, () => {
  // On the seat row ahead, with a domain over the whole camp, where corpses fall in reach; with `hp`, wounded
  // before the fight, its souls on the row behind it, where only their shots reach past it.
  const fightFrom = (seed, hp) => {
    const run = createRun({ seed })
    Object.assign(run.state.monarch, { will: 1, dominion: 6 })
    visit(run, 'fight')
    if (hp) monarchOf(run.state).hp = hp
    apply(run, { type: 'place', uid: MONARCH_UID, slot: seatNear(run.state.camp, slotAt(CAMP_ROWS - 2, 3), new Set([monarchOf(run.state).slot])) })
    if (hp) {
      const behind = [2, 3, 4].map((c) => slotAt(CAMP_ROWS - 1, c)).filter((slot) => campOpen(run.state.camp, slot) && slot !== monarchOf(run.state).slot)
      souls(run.state.party).forEach((u, i) => behind[i] !== undefined && apply(run, { type: 'place', uid: u.uid, slot: behind[i] }))
    }
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

// Buys the Monarch `n` points of Command out of a purse topped up for it, as a player would.
function command (run, n) {
  for (let k = 0; k < n; k++) {
    run.state.essence += monarchCost(run)
    apply(run, { type: 'monarch', stat: 'command' })
  }
}
// A copy of a run to try an action on (the state edited outside the log, so not a replay).

// ── the army: souls, the ossuary ───────────────────────────────────────────────────────

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
  // So are the ranks and the per-soul paths: upgrades are the kind's (DESIGN §2.8).
  const gone = ['benched', 'keptShadows', 'canLead', 'standingOf', 'freeBodies', 'kinStanding', 'feedOf', 'cohortCap', 'musterCost', 'bindCost', 'promoteNeed',
    'promoteLevel', 'promoteCost', 'canPromote', 'nextTier']
  const runJs = await import('../src/sim/run.js')
  assert.deepEqual(gone.filter((k) => k in runJs), [])
  const unitJs = await import('../src/sim/unit.js')
  assert.deepEqual(['pathsOf', 'pathDef', 'pathMods', 'pathsClash'].filter((k) => k in unitJs), [])
  const contentJs = await import('../src/content.js')
  assert.deepEqual(['SHAPES', 'PATHS', 'GRADES'].filter((k) => k in contentJs), [])
  assert.ok(!('muster' in TUNING.army) && !('bindPerTier' in TUNING.army) && !('overflow' in TUNING.army) && !('ranks' in TUNING))
})

test('the ossuary is the soul collection: recruits past the field wait there, a soul leaves it only while the field has room, and the roster counts both', () => {
  const run = createRun({ seed: 'ossuary' })
  const s = run.state
  // The field full (3), every new soul waits in the ossuary, kept whole.
  const extra = [join(run, 'grave_ghoul', { lvl: 4 }), join(run, 'will_o_wisp', { lvl: 3 })]
  assert.deepEqual(extra.map((u) => u.slot), [OSSUARY, OSSUARY])
  assert.deepEqual(inOssuary(souls(s.party)), extra)
  assert.deepEqual(extra.map((u) => [u.lvl, u.tracks]), [[4, [0, 0]], [3, [0, 0]]])
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
  while (soulCount(s.party) < rosterCap(run)) join(run, 'clockwork_page')
  assert.throws(() => join(run, 'clockwork_page'), /the retinue is full/)
  assert.equal(inOssuary(souls(s.party)).length, rosterCap(run) - fieldCap(run))
  checkState(s)
})

// ── stacks (DESIGN §2.2) ─────────────────────────────────────────────────────────────────────────

const pieceOf = (run, uid) => run.state.party.find((u) => u.uid === uid)

test('stack and split: a piece onto another of its kind is one piece of both counts and pools, keeping the place and line of the one it joined; splitting gives the bodies back', () => {
  const run = createRun({ seed: 'stack' })
  const s = run.state
  const [knight, chanter] = souls(s.party)
  const body = baseStats('tomb_knight', knight.lvl).hp
  const twin = join(run, 'tomb_knight')
  assert.equal(twin.slot, OSSUARY)
  apply(run, legalActions(run).find((a) => a.type === 'line' && a.uid === knight.uid && a.tiles))
  const line = s.lines[knight.uid]
  // Refused: another kind, itself, the Monarch, no such piece.
  for (const [uid, onto] of [[twin.uid, chanter.uid], [twin.uid, twin.uid], [MONARCH_UID, knight.uid], [knight.uid, MONARCH_UID], [999, knight.uid]]) {
    assert.throws(() => apply(run, { type: 'stack', uid, onto }), /cannot stack/, `${uid} onto ${onto}`)
  }
  const souls0 = soulCount(s.party)
  const slot = knight.slot
  apply(run, { type: 'stack', uid: twin.uid, onto: knight.uid })
  assert.deepEqual([knight.count, knight.hp, knight.maxHp, knight.slot, s.lines[knight.uid]], [2, 2 * body, 2 * body, slot, line])
  assert.ok(!s.party.includes(twin) && !(twin.uid in s.lines))
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
  assert.deepEqual([knight.count, knight.hp, knight.maxHp, s.lines[knight.uid]], [1, body, body, line])
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
  const run = winFight('onto')
  const s = run.state
  s.essence = 1e4
  const index = s.offers.findIndex((o) => o.type === 'soul')
  const o = s.offers[index]
  // A fielded piece of the offer's kind, and one in the ossuary.
  const piece = join(run, o.id, { lvl: 1 })
  const [first] = fielded(souls(s.party)).filter((u) => u !== piece)
  Object.assign(piece, { slot: first.slot })
  first.slot = OSSUARY
  const spare = join(run, o.id, { lvl: 1 })
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
  const run = winFight('stack-fight', (r) => {
    const s = r.state
    const [knight] = souls(s.party)
    apply(r, { type: 'stack', uid: join(r, 'tomb_knight').uid, onto: knight.uid })
    // The chanter's kind on Marrowcaller II: a body more each battle.
    s.kinds.bone_chanter.tracks = [0, 2]
    s.party.find((u) => u.id === 'bone_chanter').tracks = [0, 2]
  })
  const s = run.state
  const b = run.battle
  for (const u of fielded(souls(s.party))) {
    const bu = b.byUid.get(u.uid)
    const added = u.id === 'bone_chanter' ? 1 : 0
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

test('a level heals each living body by its gain, an altar each body: the living to altarHeal, the fallen to altarRevive', () => {
  const run = createRun({ seed: 'stack-heal' })
  const s = run.state
  const [knight] = souls(s.party)
  for (let k = 0; k < 2; k++) apply(run, { type: 'stack', uid: join(run, 'tomb_knight').uid, onto: knight.uid })
  const b = bodyHp(knight)
  knight.hp = b + 10
  s.essence = 1000
  apply(run, { type: 'level', kind: 'tomb_knight' })
  const b2 = baseStats('tomb_knight', knight.lvl).hp
  assert.deepEqual([knight.maxHp, knight.hp, livingBodies(knight)], [3 * b2, b + 10 + 2 * (b2 - b), 2])
  const T = TUNING.run
  knight.hp = 10
  const node = visit(run, 'altar')
  assert.equal(node.type, 'altar')
  assert.equal(knight.hp, Math.max(10, Math.round(b2 * T.altarHeal)) + 2 * Math.ceil(b2 * T.altarRevive))
})

test('the autoplayer stacks a standing piece the field has no place for onto its kind, and splits a stack while the field has room', () => {
  const rng = createRng('auto-stack').stream('autoplay')
  for (const level of ['basic', 'expert']) {
    // A spare of each start kind in turn: the one of the kind left off the field joins that kind's piece.
    const picks = ['tomb_knight', 'bone_chanter', 'frost_sprite'].map((kind) => {
      const run = createRun({ seed: 'auto-stack' })
      visit(run, 'fight')
      run.state.essence = 0
      const spare = join(run, kind)
      return { a: policy(run, rng, level), spare, piece: run.state.party.find((u) => u.id === kind) }
    })
    const stacked = picks.filter((p) => p.a.type === 'stack')
    assert.ok(stacked.length >= 1, `${level}: ${JSON.stringify(picks.map((p) => p.a))}`)
    for (const p of stacked) assert.deepEqual(p.a, { type: 'stack', uid: p.spare.uid, onto: p.piece.uid }, level)
    // A stack with a place free on the field: a body splits off, and the plan fields it.
    const run = createRun({ seed: 'auto-split' })
    visit(run, 'fight')
    const [knight] = souls(run.state.party)
    apply(run, { type: 'stack', uid: join(run, 'tomb_knight').uid, onto: knight.uid })
    command(run, 1)
    run.state.essence = 0
    assert.deepEqual(policy(run, rng, level), { type: 'split', uid: knight.uid, n: 1 }, level)
    for (let a; (a = policy(run, rng, level)).type !== 'fight';) apply(run, a)
    assert.deepEqual([fielded(souls(run.state.party)).length, knight.count], [4, 1], level)
  }
})

test('a foe piece pays essence for each of its bodies', () => {
  const one = makeUnit('grave_ghoul', { lvl: 4 })
  assert.ok(Math.abs(foeEssence({ ...one, count: 3 }) - 3 * foeEssence(one)) < 1e-9)
})

// ── lines ────────────────────────────────────────────────────────────────────────────────────────

// `n` tiles straight up the board from tile `t`.
const up = (t, n) => Array.from({ length: n }, (_, k) => t + LANES * (k + 1))

test('lines: a fielded soul\'s march of legal steps from its cell, on a signal; the action refuses anything else, and no tiles clear it', () => {
  const run = createRun({ seed: 'lines' })
  const s = run.state
  const [knight, chanter, sprite] = souls(s.party)
  const from = deployTile('party', knight.slot)
  apply(run, { type: 'line', uid: knight.uid, tiles: up(from, 2) })
  assert.deepEqual(s.lines[knight.uid], { tiles: up(from, 2), when: { at: 'once' } }, 'at once, when no signal is given')
  for (const when of [{ at: 'time', t: 100 }, { at: 'blow' }, { at: 'wave', wave: 1 }, { at: 'struck' }, { at: 'falls' }, { at: 'once' }]) {
    apply(run, { type: 'line', uid: knight.uid, tiles: up(from, 1), when: { ...when, extra: 1 } })
    assert.deepEqual(s.lines[knight.uid], { tiles: up(from, 1), when }, 'kept as the run keeps it')
  }
  assert.deepEqual(Object.keys(SIGNALS), ['once', 'time', 'blow', 'wave', 'struck', 'falls'])
  // It may cross a tile another piece holds, and run onto the foes' ground, to the far edge.
  const far = up(deployTile('party', chanter.slot), 4)
  apply(run, { type: 'line', uid: chanter.uid, tiles: [deployTile('party', knight.slot), ...up(deployTile('party', knight.slot), 4)].slice(0, 1).concat(far.slice(1)).length ? up(deployTile('party', chanter.slot), 4) : [] })
  assert.equal(s.lines[chanter.uid].tiles.at(-1), far.at(-1))
  const across = [deployTile('party', knight.slot), ...up(deployTile('party', knight.slot), 1)]
  if (distance(deployTile('party', sprite.slot), across[0]) === 1) {
    apply(run, { type: 'line', uid: sprite.uid, tiles: across })
    assert.deepEqual(s.lines[sprite.uid].tiles, across, 'through the knight\'s cell')
  }
  // Refused, the lines left as they were: no step (two rows at once, its own tile, off the board, not a list),
  // too long, a signal the run does not know or out of range, the Monarch's (it never steps), a soul not in the
  // retinue.
  const bad = [
    { uid: knight.uid, tiles: [from + 2 * LANES] },
    { uid: knight.uid, tiles: [from] },
    { uid: knight.uid, tiles: [-1] },
    { uid: knight.uid, tiles: 'up' },
    { uid: knight.uid, tiles: Array.from({ length: LINE_MAX + 1 }, (_, k) => (k % 2 ? from : from + LANES)) },
    { uid: knight.uid, tiles: up(from, 1), when: { at: 'time', t: 0 } },
    { uid: knight.uid, tiles: up(from, 1), when: { at: 'time', t: TUNING.tick.ceiling } },
    { uid: knight.uid, tiles: up(from, 1), when: { at: 'wave', wave: 0 } },
    { uid: knight.uid, tiles: up(from, 1), when: { at: 'dawn' } },
    { uid: knight.uid, tiles: up(from, 1), when: 'once' },
    { uid: MONARCH_UID, tiles: up(deployTile('party', monarchOf(s).slot), 1) },
    { uid: 999, tiles: [0] }
  ]
  for (const a of bad) {
    const was = structuredClone(s.lines)
    const log = s.log.length
    assert.throws(() => apply(run, { type: 'line', ...a }), /line/, JSON.stringify(a))
    assert.deepEqual([s.lines, s.log.length], [was, log])
  }
  // Walls: no step onto one, nor diagonally past a wall's corner. On the Broken Palisade (row 1 '##.#.##'), a
  // soul at row 2, lane 2: up to (2, 5) is fine, (3, 5) is a wall, and from (2, 5) to (3, 6) squeezes past it.
  const palisade = { ...s, camp: 'palisade', party: s.party.map((u) => (u.uid === knight.uid ? { ...u, slot: slotAt(2, 2) } : u)) }
  assert.deepEqual(cleanLine(palisade, knight.uid, [tileAt(2, 5), tileAt(2, 6), tileAt(3, 6)]), { tiles: [tileAt(2, 5), tileAt(2, 6), tileAt(3, 6)], when: { at: 'once' } })
  assert.equal(cleanLine(palisade, knight.uid, [tileAt(3, 5)]), null)
  assert.equal(cleanLine(palisade, knight.uid, [tileAt(2, 5), tileAt(3, 6)]), null)
  // No tiles: cleared (and clearing none is no error).
  apply(run, { type: 'line', uid: knight.uid, tiles: null })
  apply(run, { type: 'line', uid: knight.uid, tiles: [] })
  assert.ok(!(knight.uid in s.lines))
  // A soul in the ossuary draws none, and every line legalActions offers applies.
  apply(run, { type: 'place', uid: sprite.uid, slot: -1 })
  assert.throws(() => apply(run, { type: 'line', uid: sprite.uid, tiles: up(from, 1) }), /no line/)
  const offered = legalActions(run).filter((a) => a.type === 'line')
  assert.ok(offered.some((a) => a.tiles && a.when.at !== 'once') && offered.some((a) => a.tiles === null))
  for (const a of offered) apply({ ...run, state: structuredClone(s) }, a)
  checkState(s)
})

test('moving a piece clears its line (and the line of the one it swaps with); a release clears it; a new floor clips each at its first step its walls block', () => {
  const run = createRun({ seed: 'lines-move' })
  const s = run.state
  const [knight, chanter, sprite] = souls(s.party)
  const draw = (u) => apply(run, { type: 'line', uid: u.uid, tiles: up(deployTile('party', u.slot), 1) })
  for (const u of [knight, chanter, sprite]) draw(u)
  apply(run, { type: 'place', uid: knight.uid, slot: chanter.slot })
  assert.deepEqual(Object.keys(s.lines).map(Number), [sprite.uid], 'both swapped souls lost theirs')
  draw(knight)
  apply(run, { type: 'place', uid: knight.uid, slot: -1 })
  assert.ok(!(knight.uid in s.lines))
  apply(run, { type: 'release', uid: sprite.uid })
  assert.deepEqual(s.lines, {})
  // A seed whose first floor is the Standing Stones and whose second the Ditch (row 2 walled from lane 0 to 5):
  // lines down lanes 3 and 2 lose their tiles from the Ditch's wall on; one whose first step is now a wall goes;
  // one on lane 6, untouched, stays.
  const clip = createRun({ seed: 'clip7' })
  const c = clip.state
  assert.equal(c.camp, 'stones')
  const souls3 = souls(c.party)
  const cells = [slotAt(0, 3), slotAt(0, 2), slotAt(1, 4), slotAt(0, 6)]
  join(clip, 'grave_ghoul')
  c.essence += monarchCost(clip)
  apply(clip, { type: 'monarch', stat: 'command' })
  const four = souls(c.party)
  for (const [i, u] of four.entries()) u.slot = cells[i]
  const lines = [[tileAt(3, 5), tileAt(3, 4)], [tileAt(2, 5), tileAt(2, 4)], [tileAt(4, 4)], [tileAt(6, 5), tileAt(6, 4)]]
  for (const [i, u] of four.entries()) apply(clip, { type: 'line', uid: u.uid, tiles: lines[i] })
  Object.assign(c, { at: c.map.end, phase: 'reap', offers: [] })
  apply(clip, { type: 'reap', index: null })
  assert.deepEqual([c.floor, c.camp], [2, 'ditch'])
  assert.deepEqual(four.map((u) => c.lines[u.uid]?.tiles ?? null), [[tileAt(3, 5)], [tileAt(2, 5)], null, [tileAt(6, 5), tileAt(6, 4)]])
  assert.ok(souls3.length === 3 && four.every((u) => campOpen('ditch', u.slot)))
  checkState(c)
})

test('battleSetup carries each soul\'s line into the battle, which walks it as the timing marks say', () => {
  const run = createRun({ seed: 'lines-fight' })
  const s = run.state
  visit(run, 'fight')
  const [knight] = souls(s.party)
  // At the camp's back, out of every foe's ring until long after the marks.
  apply(run, { type: 'place', uid: knight.uid, slot: slotAt(CAMP_ROWS - 1, 0) })
  apply(run, { type: 'line', uid: knight.uid, tiles: up(deployTile('party', knight.slot), 2), when: { at: 'time', t: 20 } })
  const setup = battleSetup(run)
  assert.deepEqual(setup.party.find((u) => u.uid === knight.uid).line, s.lines[knight.uid])
  assert.ok(setup.party.filter((u) => u.uid !== knight.uid).every((u) => !u.line))
  assert.deepEqual(battleSetup(run, { lines: {} }).party.filter((u) => u.line), [], 'a rehearsal may set its own')
  const b = createBattle(setup)
  const marks = timingMarks({ party: fielded(s.party), lines: s.lines, walls: wallTiles(s.camp), at: [20, 36, 60] })
  const seen = []
  while (b.t <= 60) {
    if ([20, 36, 60].includes(b.t)) seen.push(b.byUid.get(knight.uid).tile)
    stepBattle(b)
  }
  assert.deepEqual(seen, marks[knight.uid])
  assert.deepEqual(marks[knight.uid], [deployTile('party', knight.slot), ...up(deployTile('party', knight.slot), 2)])
})

test('basic draws no line (it clears any it finds); the expert draws the lines it planned, legal ones only, and the run untouched by its plans', () => {
  const run = createRun({ seed: 'plans' })
  visit(run, 'fight')
  const [first] = souls(run.state.party)
  apply(run, { type: 'line', uid: first.uid, tiles: up(deployTile('party', first.slot), 1) })
  const rng = createRng('plans').stream('autoplay')
  let a
  while ((a = policy(run, rng, 'basic')).type !== 'fight') {
    assert.ok(a.type !== 'line' || a.tiles === null, 'basic only clears')
    apply(run, a)
  }
  assert.deepEqual(run.state.lines, {}, 'basic holds')
  // The expert: over a few floor-1 rooms, its prep leaves the run with exactly the lines its plan holds.
  let drawn = 0
  for (let i = 0; i < 6; i++) {
    const r = createRun({ seed: 'plans' + i })
    visit(r, 'fight')
    for (let x; (x = policy(r, rng, 'expert')).type !== 'fight';) apply(r, x)
    assert.deepEqual(r.state.lines, linesOf(planFor(r, LEVELS.expert)))
    drawn += Object.keys(r.state.lines).length
    checkState(r.state)
  }
  assert.ok(drawn >= 0)
  // Its line search draws only what the run takes: a soul's redrawn line is legal from its own cell.
  const r = createRun({ seed: 'redraw' })
  visit(r, 'fight')
  const before = structuredClone(r.state)
  const party = fielded(r.state.party).map((u) => ({ ...u, line: null }))
  const g = createRng('redraw').stream('climb')
  for (let k = 0; k < 200; k++) {
    redraw(party, r.state, g)
    for (const u of party.filter((x) => x.line)) assert.deepEqual(cleanLine(r.state, u.uid, u.line.tiles, u.line.when), u.line)
  }
  assert.ok(party.some((u) => u.line))
  rehearse(r, party, 1)
  assert.deepEqual(r.state, before)
})

// ── fuzz: random legal actions, invariants after every one, replay at the end ──────────────────

function checkState (s) {
  assert.ok(['map', 'prep', 'reap', 'over'].includes(s.phase), s.phase)
  const all = souls(s.party)
  assert.ok(all.length >= 1 && soulCount(s.party) <= TUNING.party.roster + 3 * s.relics.filter((r) => r === 'ossuary_key').length)
  assert.ok(Number.isInteger(s.essence) && s.essence >= 0, `essence ${s.essence}`)
  assert.equal(new Set(s.party.map((u) => u.uid)).size, s.party.length, 'unique uids')
  assert.ok(s.party.every((u) => u.uid < s.nextUid || u.uid === MONARCH_UID), 'uids below nextUid')
  const field = s.party.filter((u) => u.slot >= 0)
  assert.equal(new Set(field.map((u) => u.slot)).size, field.length, 'unique slots')
  const legion = s.keystones.reduce((n, id) => n + (KEYSTONES[id].field ?? 0), 0)
  assert.ok(fielded(all).length <= baseField(s) + s.monarch.command + s.relics.filter((r) => r === 'grave_banner').length + legion, 'field cap')
  // The Monarch: one, always on the field, its level the HP points bought and its HP grown with them; no
  // kind, no tracks; it stands until the run is over.
  const m = s.party.filter((u) => u.id === 'monarch')
  assert.deepEqual(m.map((u) => u.uid), [MONARCH_UID])
  assert.ok(isSeat(s.camp, m[0].slot), 'the Monarch is never benched, nor off the seats')
  assert.deepEqual([m[0].lvl, m[0].maxHp, m[0].tracks], [s.monarch.hp, baseStats('monarch', s.monarch.hp).hp, [0, 0]])
  assert.ok(!('monarch' in s.kinds) && Object.keys(s.monarch).sort().join() === [...MONARCH_STATS].sort().join())
  if (s.phase !== 'over') assert.ok(m[0].hp > 0, 'the Monarch stands')
  assert.equal(s.result === 'defeat', !!s.death)
  for (const u of all) {
    assert.ok(u.slot === -1 || campOpen(s.camp, u.slot), `${u.id} slot ${u.slot} in camp ${s.camp}`)
    assert.ok(Number.isInteger(u.hp) && u.hp >= 0 && u.hp <= u.maxHp, `${u.id} hp ${u.hp}/${u.maxHp}`)
    assert.ok(u.lvl >= 1 && u.lvl <= TUNING.level.cap, `${u.id} lvl ${u.lvl}`)
    // Upgrades are the kind's: every soul holds its kind's level and tiers, within the crosspath rule.
    const kind = s.kinds[u.id]
    assert.ok(kind, `${u.id}: a kind`)
    assert.deepEqual([u.lvl, u.tracks], [kind.lvl, kind.tracks], `${u.id} ${u.uid}`)
    assert.ok(Number.isInteger(u.count) && u.count >= 1, `${u.id} ${u.uid} count ${u.count}`)
    assert.equal(u.maxHp, u.count * baseStats(u.id, u.lvl).hp, `${u.id} ${u.uid} max HP: a pool of count × body`)
    assert.ok(!['grade', 'path', 'tier', 'path2', 'tier2'].some((k) => k in u), `${u.id}: no rank, no path`)
  }
  for (const [id, k] of Object.entries(s.kinds)) {
    assert.ok(k.lvl >= 1 && k.lvl <= TUNING.level.cap && k.tracks.length === 2, `${id} ${JSON.stringify(k)}`)
    assert.ok(k.tracks.every((t) => Number.isInteger(t) && t >= 0 && t <= 4) && !(k.tracks[0] > 2 && k.tracks[1] > 2), `${id} ${k.tracks}`)
  }
  assert.ok(Number.isInteger(m[0].hp) && m[0].hp >= 0 && m[0].hp <= m[0].maxHp)
  // The army is souls in pieces: no muster or binds kept; no shadow or boss ever in the retinue (the ossuary is the
  // pieces off the field); the offers are souls, relics, tiers and keystones.
  for (const k of ['ossuary', 'muster', 'freeBinds']) assert.ok(!(k in s), k)
  for (const u of all) assert.ok(!UNITS[u.id].boss && !u.shadow && !('cohort' in u), u.id)
  assert.ok(s.offers.every((o) => ['soul', 'relic', 'tier', 'keystone'].includes(o.type)), JSON.stringify(s.offers))
  assert.ok(fieldCap({ state: s }) <= TUNING.army.board)
  // Lines: only fielded souls' (never the Monarch's), each a march from its soul's cell on a signal, as the run
  // keeps them.
  assert.ok(!('detachments' in s))
  for (const [uid, line] of Object.entries(s.lines)) {
    const u = all.find((x) => x.uid === Number(uid))
    assert.ok(u && u.slot >= 0, `line ${uid}`)
    assert.deepEqual(cleanLine(s, u.uid, line.tiles, line.when), line, `line ${uid}`)
  }
  // Keystones: known, never one twice, at most TUNING.keystone.max, none before its floor; an offer is one
  // the run does not hold, and only while it may take one more.
  assert.ok(s.keystones.every((id) => KEYSTONES[id]) && new Set(s.keystones).size === s.keystones.length, JSON.stringify(s.keystones))
  assert.ok(s.keystones.length <= TUNING.keystone.max && (s.floor >= TUNING.keystone.fromFloor || !s.keystones.length))
  for (const o of s.offers.filter((x) => x.type === 'keystone')) {
    assert.ok(KEYSTONES[o.id] && !s.keystones.includes(o.id) && s.keystones.length < TUNING.keystone.max, JSON.stringify(o))
  }
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
    if (action.onto !== undefined) seen.add('reap onto')
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

// Forty more runs fight on the lines their random actions drew (the policy would clear them), so lines reach the
// battles the invariants and replays cover: marches, and lines waiting on a signal. (They seldom leave floor 1,
// so they are kept apart from the hundred.)
const KEEPING = { ...STEADY, keepLines: true }

test('fuzz: 140 runs of random legal actions keep every invariant, cover every action, fight on lines, and replay exactly', () => {
  const results = {}
  const seen = new Set()
  const plans = { lined: 0, waiting: 0, marched: 0 }
  const fought = (run) => {
    const { setup, battle } = run
    plans.lined += setup.party.some((u) => u.line)
    plans.waiting += setup.party.some((u) => u.line && u.line.when.at !== 'once')
    plans.marched += battle.events.some((e) => e.type === 'move' && battle.byUid.get(e.actor).side === 'party')
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
  // Every action the run has, a recruit onto a piece too (tracks.test.js fuzzes the levels and tiers harder).
  assert.deepEqual([...seen].sort(), ['fight', 'level', 'line', 'monarch', 'node', 'place', 'reap', 'reap onto', 'release', 'split', 'stack', 'upgrade'])
  assert.ok(Object.values(plans).every((n) => n >= 5), `battles with lines: ${JSON.stringify(plans)}`)
})
