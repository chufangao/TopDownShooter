import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRun, apply, legalActions, availableNodes, replay, join, currentNode, fielded, levelCost, tierCost, rosterCap } from '../src/sim/run.js'
import { createBattle, runBattle } from '../src/sim/battle.js'
import { autoplay, policy } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { RELICS } from '../src/content.js'
import { CAMP_SLOTS, campOpen, isWall, abilitiesOf, auraOf, statsOf, pathsOf } from '../src/sim/unit.js'
import { CAMP_LIST } from '../src/content.js'

const play = (seed) => autoplay(createRun({ seed }), { rng: createRng(seed).stream('autoplay') })

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

// Visit fights until one is won.
function winFight (prefix) {
  for (let i = 0; ; i++) {
    const run = createRun({ seed: prefix + i })
    visit(run, 'fight')
    apply(run, { type: 'fight' })
    if (run.state.phase === 'reap') return run
  }
}

test('a new run: start retinue at level 2 on floor 1, all fielded, every battle room scouted', () => {
  const run = createRun({ seed: 'new' })
  const s = run.state
  assert.deepEqual(s.party.map((u) => [u.id, u.lvl]), [['tomb_knight', 2], ['bone_chanter', 2], ['frost_sprite', 2]])
  assert.equal(new Set(s.party.map((u) => u.slot)).size, 3)
  assert.ok(s.party.every((u) => u.slot >= 0))
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
  const [a] = run.state.party
  const wall = [...Array(CAMP_SLOTS).keys()].find((slot) => isWall(run.state.camp, slot))
  assert.ok(wall >= 0, 'every camp has a wall')
  const bad = [
    null, { type: 'dance' }, { type: 'node', id: run.state.map.end }, { type: 'reap', index: 0 }, { type: 'fight' },
    { type: 'place', uid: a.uid, slot: CAMP_SLOTS }, { type: 'place', uid: a.uid, slot: a.slot }, { type: 'place', uid: 999, slot: 3 },
    { type: 'place', uid: a.uid, slot: wall }, { type: 'place', uid: a.uid, slot: 1.5 },
    { type: 'order', uid: a.uid, order: 'advance' },
    { type: 'release', uid: 999 }
  ]
  for (const action of bad) assert.throws(() => apply(run, action), undefined, JSON.stringify(action))
  assert.deepEqual(run.state.log, [])
})

test('legalActions per phase', () => {
  const run = createRun({ seed: 'legal' })
  const kinds = (r) => [...new Set(legalActions(r).map((a) => a.type))].sort()
  run.state.essence = 0
  assert.deepEqual(kinds(run), ['node', 'place', 'release'])
  run.state.essence = 1000
  assert.deepEqual(kinds(run), ['level', 'node', 'place', 'release', 'upgrade'])
  run.state.essence = 0
  visit(run, 'fight')
  assert.equal(run.state.phase, 'prep')
  assert.deepEqual(kinds(run), ['fight', 'place', 'release'])
  apply(run, { type: 'fight' })
  if (run.state.phase === 'over') return
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

test('place: field slots swap, the bench holds souls back, and the field has a cap', () => {
  const run = createRun({ seed: 'place' })
  const [knight, chanter] = run.state.party
  const a = knight.slot
  const b = chanter.slot
  apply(run, { type: 'place', uid: knight.uid, slot: b })
  assert.equal(knight.slot, b)
  assert.equal(chanter.slot, a)
  apply(run, { type: 'place', uid: knight.uid, slot: -1 })
  assert.equal(knight.slot, -1)
  assert.equal(fielded(run.state.party).length, 2)
  while (run.state.party.length < 8) join(run, 'clockwork_page')
  assert.equal(fielded(run.state.party).length, TUNING.party.field, 'new souls fill the field, then the bench')
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
  autoplayTo(run, () => s.floor === 2)
  if (s.phase === 'over') return
  assert.equal(CAMP_LIST.find((c) => c.id === s.camp).floor, 2)
  for (const u of fielded(s.party)) assert.ok(campOpen(s.camp, u.slot))
})

test('release never lets go of the last soul standing', () => {
  const run = createRun({ seed: 'release' })
  const [a, b, c] = run.state.party
  a.hp = 0
  b.hp = 0
  assert.throws(() => apply(run, { type: 'release', uid: c.uid }))
  apply(run, { type: 'release', uid: a.uid })
  assert.deepEqual(run.state.party, [b, c])
})

test('prep needs someone standing on the field', () => {
  const run = createRun({ seed: 'standing' })
  visit(run, 'fight')
  const [a, b, c] = run.state.party
  a.hp = 0
  apply(run, { type: 'place', uid: b.uid, slot: -1 })
  apply(run, { type: 'place', uid: c.uid, slot: -1 })
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
  assert.deepEqual(new Set(s.offers.map((o) => o.id)), new Set(slain.map((u) => u.id)))
  assert.ok(s.offers.every((o) => o.type === 'soul' && o.cost > 0 && o.lvl === Math.max(...slain.filter((u) => u.id === o.id).map((u) => u.lvl))))
  assert.ok(s.essence > TUNING.essence.start && s.stats.essence === s.essence - TUNING.essence.start)
  assert.ok(s.party.every((u) => u.lvl === 2), 'no XP: levels only rise when bought')
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
  for (const o of rest) if (s.party.length > 1) apply(run, { type: 'release', uid: o.uid })
  assert.equal(s.phase, s.offers.length ? 'reap' : 'map')
})

test('a full retinue must release a soul before it can recruit', () => {
  const run = winFight('full')
  const s = run.state
  s.essence = 1e5
  while (s.party.length < rosterCap(run)) join(run, 'clockwork_page')
  assert.ok(!legalActions(run).some((a) => a.type === 'reap' && a.index !== null))
  assert.throws(() => apply(run, { type: 'reap', index: 0 }), /release a soul first/)
  const benched = s.party.find((u) => u.slot < 0)
  apply(run, { type: 'release', uid: benched.uid })
  assert.equal(s.phase, 'reap')
  apply(run, { type: 'reap', index: 0 })
  assert.equal(s.party.length, rosterCap(run))
})

test('autoplay finishes 20 seeded runs with a sane final state', () => {
  const results = { victory: 0, defeat: 0 }
  for (let i = 0; i < 20; i++) {
    const s = play('auto' + i).state
    assert.equal(s.phase, 'over')
    results[s.result]++
    checkState(s)
    assert.ok(s.stats.wins <= s.stats.fights)
    if (s.result === 'victory') assert.equal(s.stats.floorsCleared, TUNING.run.floors)
  }
  assert.ok(results.victory > 0 && results.defeat > 0, JSON.stringify(results))
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

test('the autoplayer rehearses and plays ahead without touching the run', () => {
  for (const level of ['basic', 'expert']) {
    const run = createRun({ seed: 'rehearse' })
    const rng = createRng('rehearse').stream('autoplay')
    const seen = new Set()
    // Through the first rooms: a route choice, a prep and a reap at least.
    while (run.state.stats.fights < 2 && run.state.phase !== 'over') {
      const before = structuredClone(run.state)
      const setup = run.setup
      const action = policy(run, rng, level)
      assert.deepEqual(run.state, before, `${level} ${run.state.phase}`)
      assert.equal(run.setup, setup)
      seen.add(run.state.phase)
      apply(run, action)
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

// ── fuzz: random legal actions, invariants after every one, replay at the end ──────────────────

function checkState (s) {
  assert.ok(['map', 'prep', 'reap', 'over'].includes(s.phase), s.phase)
  assert.ok(s.party.length >= 1 && s.party.length <= TUNING.party.roster + 3 * s.relics.filter((r) => r === 'ossuary_key').length)
  assert.ok(Number.isInteger(s.essence) && s.essence >= 0, `essence ${s.essence}`)
  assert.equal(new Set(s.party.map((u) => u.uid)).size, s.party.length, 'unique uids')
  const field = s.party.filter((u) => u.slot >= 0)
  assert.equal(new Set(field.map((u) => u.slot)).size, field.length, 'unique slots')
  assert.ok(field.length <= TUNING.party.field + s.relics.filter((r) => r === 'grave_banner').length, 'field cap')
  if (s.phase !== 'over') assert.ok(s.party.some((u) => u.hp > 0), 'someone is standing')
  for (const u of s.party) {
    assert.ok(u.slot === -1 || campOpen(s.camp, u.slot), `${u.id} slot ${u.slot} in camp ${s.camp}`)
    assert.ok(Number.isInteger(u.hp) && u.hp >= 0 && u.hp <= u.maxHp, `${u.id} hp ${u.hp}/${u.maxHp}`)
    assert.ok(u.lvl >= 1 && u.lvl <= TUNING.level.cap, `${u.id} lvl ${u.lvl}`)
    assert.ok(u.tier >= 0 && u.tier <= 3 && (u.tier === 0) === (u.path === null), `${u.id} ${u.path} ${u.tier}`)
    if (u.path) assert.ok(pathsOf(u.id).some((p) => p.id === u.path), `${u.id} path ${u.path}`)
  }
}

// A fifth of the time a uniformly random legal action, else the autoplay policy: a floor is 15 rooms
// long, and random play rarely gets past the first.
function fuzz (seed) {
  const rng = createRng(seed).stream('fuzz')
  const run = createRun({ seed })
  for (let steps = 0; run.state.phase !== 'over'; steps++) {
    assert.ok(steps < 1e5, 'stuck')
    const legal = legalActions(run)
    assert.ok(legal.length > 0)
    const action = rng.chance(0.2) ? rng.pick(legal) : policy(run, rng)
    apply(run, action)
    checkState(run.state)
    if (steps % 97 === 0) everyLegalActionApplies(run)
  }
  return run
}

// Each legal action applies cleanly to a copy of the run rebuilt by replay.
function everyLegalActionApplies (run) {
  const legal = legalActions(run)
  for (const action of legal.filter((_, i) => i % Math.ceil(legal.length / 12) === 0)) {
    const copy = replay(run.state.seed, run.state.log)
    assert.doesNotThrow(() => apply(copy, action), JSON.stringify(action))
  }
}

test('fuzz: 40 runs of random legal actions keep every invariant and replay exactly', () => {
  const results = {}
  for (let i = 0; i < 40; i++) {
    const run = fuzz('fuzz' + i)
    results[run.state.floor] = (results[run.state.floor] ?? 0) + 1
    assert.deepEqual(replay(run.state.seed, run.state.log).state, run.state)
  }
  assert.ok(Object.keys(results).length > 1, `fuzz runs should end on different floors: ${JSON.stringify(results)}`)
})
