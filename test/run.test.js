import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRun, apply, legalActions, availableNodes, replay, join, currentNode, fielded, rosterCap, fieldCap,
  MONARCH_UID, monarchOf, souls, battleSetup, encounter, drawRoom, roomThreats,
  foeEssence, baseField, inOssuary, OSSUARY, soulCount, canPlace, canFuse, fuseCost, fuseParts,
  levelOf, kindLevel, commandOf, monarchHp, ariseOf, frontier, tierCost, floorPrice, releaseRefund, relicPrice, canBuy, shopOffers,
  eliteBonus, relicTier, ariseHeld, unheld, START_PARTY, draftOffer, draftPool, partners, startFor, spawnPool
} from '../src/sim/run.js'
import { fork, legalOrders, stalled } from '../src/sim/turns.js'
import { autoplay, policy, LEVELS, planFor } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { generateFloor } from '../src/sim/map.js'
import { TUNING } from '../src/tuning.js'
import { tuned, FIRST_BALANCE, LEVEL_A_TIER, relicMod } from './tuned.js'
import { RELICS, UNITS, UNIT_LIST, FUSION_LIST, CAMP_LIST } from '../src/content.js'
import {
  CAMP_SLOTS, COLS, campOpen, isWall, slotAt, rowOf, colOf, baseStats, makeUnit,
  sizeOf, footprint, footprintSlots, fits, monarchSlot, isMonarchCell, meleeOnly
} from '../src/sim/unit.js'
import { visit, win, fight, rebuilt as rebuiltBattle } from './rooms.js'
import { basicTurn, expertTurn } from '../src/sim/policy.js'

const play = (seed) => autoplay(createRun({ start: START_PARTY, seed }), { rng: createRng(seed).stream('autoplay') })

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
const TRACKS = Object.fromEntries(UNIT_LIST.filter((u) => u.tracks).map((u) => [u.id, u.tracks]))
const [COLOSSUS, COLOSSUS_TRACK] = Object.entries(TRACKS).flatMap(([id, tracks]) => tracks.map((t, k) => [id, k, t])).find(([, , t]) => t.tiers[3].size === 2) ?? []

test('a new run from the fixed start: the Monarch and the trio at their first level on floor 1, all fielded, every battle room scouted', () => {
  const run = createRun({ start: START_PARTY, seed: 'new' })
  const s = run.state
  const first = TUNING.level.base
  assert.deepEqual(s.party.map((u) => [u.id, u.lvl, u.uid]), [['monarch', 0, MONARCH_UID], ['tomb_knight', first, 1], ['bone_chanter', first, 2], ['frost_sprite', first, 3]])
  assert.equal(new Set(s.party.map((u) => u.slot)).size, 4)
  assert.ok(s.party.every((u) => u.slot >= 0))
  assert.deepEqual([s.death, fielded(souls(s.party)).length, fieldCap(run), commandOf(s)], [null, 3, 3, TUNING.party.field])
  assert.deepEqual([monarchOf(s).maxHp, monarchHp(s)], [TUNING.monarch.hp, TUNING.monarch.hp])
  assert.equal(s.phase, 'map')
  assert.equal(s.at, s.map.start)
  assert.ok(availableNodes(run).length >= 2)
  for (const n of s.map.nodes) {
    assert.equal(!!n.foes, ['fight', 'elite', 'boss'].includes(n.type), n.id)
    if (n.foes) assert.equal(new Set(n.foes.map((f) => f.slot)).size, n.foes.length, `${n.id} slots`)
  }
})

// The draft (2026-10-14; TUNING.draft): a run opens with the Monarch alone and takes its first souls one pick at a time.
test('a new run opens on the draft: the Monarch alone, the map drawn but closed, an offer of different floor-1 kinds', () => {
  const run = createRun({ seed: 'draft' })
  const s = run.state
  assert.equal(s.phase, 'draft')
  assert.deepEqual(s.party.map((u) => u.id), ['monarch'])
  assert.deepEqual(s.kinds, {})
  assert.deepEqual(s.draft, { pick: 0, offer: draftOffer('draft', 0) })
  assert.equal(s.draft.offer.length, TUNING.draft.offer)
  assert.equal(new Set(s.draft.offer).size, TUNING.draft.offer)
  assert.ok(s.draft.offer.every((id) => draftPool().includes(id)))
  assert.ok(s.map && s.camp && s.at === s.map.start)
  assert.deepEqual(availableNodes(run), [])
  assert.deepEqual(legalActions(run), s.draft.offer.map((_, index) => ({ type: 'pick', index })))
  // The pool is floor 1's: every kind its rooms can bring and no other, the old trio among them.
  const floor1 = new Set(Object.values(drawFloorKinds(40)))
  assert.deepEqual([...floor1].sort(), draftPool().slice().sort())
  assert.ok(START_PARTY.every((id) => draftPool().includes(id)))
  for (const bad of [{ type: 'node', id: s.map.nodes[1].id }, { type: 'pick', index: TUNING.draft.offer }, { type: 'pick', index: null }, { type: 'pick', index: '0' }, { type: 'fight' }]) {
    assert.throws(() => apply(run, bad), undefined, JSON.stringify(bad))
  }
  assert.deepEqual(s.log, [])
  assert.throws(() => apply(createRun({ start: START_PARTY, seed: 'draft' }), { type: 'pick', index: 0 }), /needs phase draft/)
})

// The kinds floor 1's rooms bring, over the first `n` seeds' maps, but its boss's (a boss and its court: their own
// kinds, run.js courtPool): id → id.
function drawFloorKinds (n) {
  const out = {}
  for (let i = 0; i < n; i++) for (const node of createRun({ start: START_PARTY, seed: `pool-${i}` }).state.map.nodes) if (node.type !== 'boss') for (const f of node.foes ?? []) out[f.id] = f.id
  return out
}

test('the draft: each pick joins its soul free and deals the next offer; the last stands them on the frontier and opens the map', () => {
  const run = createRun({ seed: 'picks' })
  const s = run.state
  const taken = []
  for (let k = 0; k < TUNING.draft.picks; k++) {
    assert.equal(s.phase, 'draft')
    assert.equal(s.draft.pick, k)
    assert.deepEqual(s.draft.offer, draftOffer('picks', k, taken))
    const index = k % s.draft.offer.length
    taken.push(s.draft.offer[index])
    apply(run, { type: 'pick', index })
    assert.equal(s.essence, TUNING.essence.start, 'a pick is free')
    assert.deepEqual(souls(s.party).map((u) => u.id), taken)
  }
  assert.equal(s.phase, 'map')
  assert.equal(s.draft, null)
  assert.ok(availableNodes(run).length >= 2)
  // Each soul at its kind's first level, no tiers, fielded on the camp's default frontier, as the fixed start stands.
  const first = TUNING.level.base
  assert.ok(souls(s.party).every((u) => u.lvl === first && u.tracks.join() === '0,0' && u.slot >= 0))
  assert.deepEqual(souls(s.party).map((u) => u.slot), frontier(s.camp, souls(s.party)))
  assert.deepEqual(Object.keys(s.kinds).sort(), [...new Set(taken)].sort())
  checkField(s)
  assert.deepEqual(s.log.map((a) => a.type), Array(TUNING.draft.picks).fill('pick'))
  assert.deepEqual(legalActions(run).filter((a) => a.type === 'pick'), [])
})

test('the draft: a kind may be taken twice, each a soul of its own; offers are the seed\'s, and every floor-1 kind comes up', () => {
  // A seed whose later pick offers a kind taken at the first.
  let seed = null
  for (let i = 0; i < 200 && !seed; i++) if (draftOffer(`twice-${i}`, 1, draftOffer(`twice-${i}`, 0).slice(0, 1)).includes(draftOffer(`twice-${i}`, 0)[0])) seed = `twice-${i}`
  assert.ok(seed)
  const run = createRun({ seed })
  const kind = run.state.draft.offer[0]
  apply(run, { type: 'pick', index: 0 })
  apply(run, { type: 'pick', index: run.state.draft.offer.indexOf(kind) })
  const twins = souls(run.state.party).filter((u) => u.id === kind)
  assert.equal(twins.length, 2)
  assert.notEqual(twins[0].uid, twins[1].uid)
  // The same seed, the same offers; another seed, its own.
  assert.deepEqual(createRun({ seed: 'same' }).state.draft.offer, createRun({ seed: 'same' }).state.draft.offer)
  const seen = new Set()
  for (let i = 0; i < 60; i++) {
    const held = []
    for (let k = 0; k < TUNING.draft.picks; k++) {
      const offer = draftOffer(`seen-${i}`, k, held)
      for (const id of offer) seen.add(id)
      held.push(offer[i % offer.length])
    }
  }
  assert.deepEqual([...seen].sort(), draftPool().slice().sort())
})

// redesign.md §4.2: from the second pick, the offer holds a plan.
test('the draft guarantees a plan: every pick after the first offers a kin-mate or a recipe partner of a soul held', () => {
  // The relation, read from the kins and the recipes: a kin (a kind its own), a recipe across kins, nothing else.
  assert.ok(partners('grave_ghoul', 'tomb_knight') && partners('grave_ghoul', 'grave_ghoul') && partners('will_o_wisp', 'frost_sprite'))
  assert.ok(partners('frost_sprite', 'ember_drake') && partners('ember_drake', 'frost_sprite'), 'the Rime Drake\'s parts, a Fae and a Drake')
  assert.ok(!partners('pyre_hound', 'frost_sprite') && !partners('clockwork_page', 'hive_warden') && !partners('grave_ghoul', 'will_o_wisp'))
  for (const r of FUSION_LIST) for (const a of Object.keys(r.needs)) for (const b of Object.keys(r.needs)) assert.ok(partners(a, b), `${r.id}: ${a}, ${b}`)
  // Every pick of every path through the draft, on many seeds: the offer as many different floor-1 kinds as TUNING says,
  // the seed's (the same twice), and from the second pick one at least goes with a soul held. The first pick's is the
  // draw as it was, and a later one differs from the plain draw only where that draw had no partner, in one place.
  const plain = (seed, pick) => createRng(seed).stream(`draft|${pick}`).shuffle(draftPool()).slice(0, TUNING.draft.offer)
  let offers = 0
  let dealt = 0
  const walk = (seed, held) => {
    if (held.length >= TUNING.draft.picks) return
    const offer = draftOffer(seed, held.length, held)
    const where = `${seed} ${held.join(',')}: ${offer.join(',')}`
    assert.equal(offer.length, TUNING.draft.offer, where)
    assert.equal(new Set(offer).size, offer.length, where)
    assert.ok(offer.every((id) => draftPool().includes(id)), where)
    assert.deepEqual(draftOffer(seed, held.length, held.slice()), offer, where)
    const was = plain(seed, held.length)
    const mate = (o) => o.some((id) => held.some((h) => partners(h, id)))
    if (!held.length || mate(was)) assert.deepEqual(offer, was, where)
    else {
      assert.ok(mate(offer), where)
      assert.equal(offer.filter((id, i) => id !== was[i]).length, 1, where)
      dealt++
    }
    offers++
    for (const id of offer) walk(seed, [...held, id])
  }
  for (let i = 0; i < 100; i++) walk(`plan-${i}`, [])
  assert.equal(offers, 100 * (1 + TUNING.draft.offer + TUNING.draft.offer ** 2))
  assert.ok(dealt > 0, 'some draws had no partner')
  // The run deals it: each later offer in a run is draftOffer's for the souls the picks took.
  const run = createRun({ seed: 'plan-run' })
  for (let k = 0; k < TUNING.draft.picks; k++) {
    assert.deepEqual(run.state.draft.offer, draftOffer('plan-run', k, souls(run.state.party).map((u) => u.id)))
    if (k) assert.ok(run.state.draft.offer.some((id) => souls(run.state.party).some((u) => partners(u.id, id))))
    apply(run, { type: 'pick', index: 2 })
  }
})

// TUNING.spawn's tierFalloff and tierOverCap (redesign.md §4.2): a room's draws by tier, each pool summing to one.
test('the pool by floor: tier 1 the bulk of floor 1 and still a fifth of floor 3; tier 3 a few per cent of floor 2, a tenth of floor 3', () => {
  const shares = (floor, bias = 0) => {
    const p = spawnPool(floor, bias)
    const sum = p.weights.reduce((a, b) => a + b, 0)
    const out = {}
    p.units.forEach((u, i) => { out[u.tier] = (out[u.tier] ?? 0) + p.weights[i] / sum })
    return out
  }
  for (let floor = 1; floor <= TUNING.run.floors; floor++) {
    for (const bias of [0, TUNING.spawn.eliteTier]) {
      const t = shares(floor, bias)
      assert.ok(Math.abs(Object.values(t).reduce((a, b) => a + b, 0) - 1) < 1e-9, `floor ${floor} +${bias}`)
      assert.ok(spawnPool(floor, bias).units.every((u) => u.spawn.minFloor <= floor && !u.boss), `floor ${floor} +${bias}`)
    }
  }
  const [f1, f2, f3] = [1, 2, 3].map((floor) => shares(floor))
  // Floor 1's tier 3 is the Ember Drake alone (the balance pass, 2026-10-16: the Rime Drake's keystone), a few per cent.
  assert.ok(f1[1] > 0.65 && f1[1] < 0.9 && f1[3] < 0.06, JSON.stringify(f1))
  assert.ok(f2[3] > 0.02 && f2[3] < 0.1, JSON.stringify(f2))
  assert.ok(f3[3] > 0.07 && f3[3] < 0.2 && f3[1] > 0.15 && f3[1] < 0.3, JSON.stringify(f3))
  // An elite still leans a tier up: floor 1's to tier 2, floor 3's to tier 3.
  assert.ok(shares(1, TUNING.spawn.eliteTier)[2] > 0.5 && shares(3, TUNING.spawn.eliteTier)[3] > 0.35)
})

test('replay: a drafted run replays from its picks; a log from before the draft replays from the old trio', () => {
  const run = createRun({ seed: 'replay-draft' })
  for (let k = 0; k < TUNING.draft.picks; k++) apply(run, { type: 'pick', index: 2 - k % 3 })
  apply(run, { type: 'node', id: availableNodes(run)[0].id })
  assert.equal(startFor(run.state.log), null)
  assert.deepEqual(replay('replay-draft', run.state.log).state, run.state)
  // Mid-draft too.
  const half = createRun({ seed: 'replay-half' })
  apply(half, { type: 'pick', index: 1 })
  assert.deepEqual(replay('replay-half', half.state.log).state, half.state)
  assert.deepEqual(replay('replay-none', []).state, createRun({ seed: 'replay-none' }).state)
  // A run from the fixed start logs no pick, and replays from that start.
  const old = createRun({ start: START_PARTY, seed: 'replay-old' })
  apply(old, { type: 'node', id: availableNodes(old)[0].id })
  assert.equal(startFor(old.state.log), START_PARTY)
  assert.deepEqual(replay('replay-old', old.state.log).state, old.state)
})

test('the autoplayer drafts: both levels take every pick first and play on from the map', () => {
  for (const level of ['basic', 'expert']) {
    const run = createRun({ seed: `auto-draft-${level}` })
    const rng = createRng(run.state.seed).stream('autoplay')
    for (let k = 0; k < TUNING.draft.picks; k++) {
      const a = policy(run, rng, level)
      assert.equal(a.type, 'pick', level)
      assert.ok(Number.isInteger(a.index) && a.index >= 0 && a.index < TUNING.draft.offer, level)
      apply(run, a)
    }
    assert.equal(run.state.phase, 'map', level)
    assert.notEqual(policy(run, rng, level).type, 'pick', level)
  }
  // The expert takes a ranged kind while its souls hold fewer than TUNING.expert.draft.ranged and one is offered.
  const ranged = (id) => !meleeOnly(makeUnit(id, { lvl: 1 }))
  for (let i = 0; i < 6; i++) {
    const r = createRun({ seed: `expert-ranged-${i}` })
    const g = createRng(r.state.seed).stream('autoplay')
    while (r.state.phase === 'draft') {
      const short = souls(r.state.party).filter((u) => ranged(u.id)).length < TUNING.expert.draft.ranged && r.state.draft.offer.some(ranged)
      const a = policy(r, g, 'expert')
      if (short) assert.ok(ranged(r.state.draft.offer[a.index]), `${r.state.seed}: ${r.state.draft.offer.join()} → ${r.state.draft.offer[a.index]}`)
      apply(r, a)
    }
  }
  // Basic takes a kind it does not hold where one is offered.
  const run = createRun({ seed: 'basic-fresh' })
  const rng = createRng('basic-fresh').stream('autoplay')
  for (let k = 0; k < TUNING.draft.picks; k++) {
    const fresh = run.state.draft.offer.findIndex((id) => !run.state.kinds[id])
    const a = policy(run, rng, 'basic')
    assert.equal(a.index, Math.max(0, fresh))
    apply(run, a)
  }
})

test('apply refuses illegal actions and leaves the log alone', () => {
  const run = createRun({ start: START_PARTY, seed: 'illegal' })
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
    { type: 'line', uid: a.uid, tiles: [0] }, { type: 'fuse', id: 'nothing', parts: [] }, { type: 'fuse', id: FUSION_LIST[0].id, parts: [a.uid] },
    { type: 'monarch', stat: 'hp' }, { type: 'monarch', stat: 'command' }, { type: 'monarch' }, { type: 'level', kind: 'tomb_knight' }
  ]
  for (const action of bad) assert.throws(() => apply(run, action), undefined, JSON.stringify(action))
  assert.deepEqual(run.state.log, [])
})

test('legalActions per phase', () => {
  const run = createRun({ start: START_PARTY, seed: 'legal' })
  const kinds = (r) => [...new Set(legalActions(r).map((a) => a.type))].sort()
  // A fuse for each recipe the start retinue can make (none, if no recipe is made of one of each start kind).
  const fuses = (r) => (FUSION_LIST.some((f) => canFuse(r, f.id)) ? ['fuse'] : [])
  run.state.essence = 0
  assert.deepEqual(kinds(run), ['node', 'place', 'release'])
  run.state.essence = 1000
  // Essence buys tiers (and fusions): no level, nothing for the Monarch; an Arise relic owned waits to be held.
  assert.deepEqual(kinds(run), [...fuses(run), 'node', 'place', 'release', 'upgrade'].sort())
  run.state.relics.push('arise')
  assert.deepEqual(kinds(run), [...fuses(run), 'hold', 'node', 'place', 'release', 'upgrade'].sort())
  run.state.relics = []
  assert.ok(!legalActions(run).some((a) => a.uid === MONARCH_UID && ['upgrade', 'release', 'place'].includes(a.type)), 'the Monarch is never placed')
  assert.ok(!legalActions(run).some((a) => a.type === 'place' && a.slot === monarchSlot(run.state.camp)), 'nor anything on its seat')
  run.state.essence = 0
  visit(run, 'fight')
  assert.equal(run.state.phase, 'prep')
  assert.deepEqual(kinds(run), ['fight', 'place', 'release'])
  // A piece relic waiting: a soul may take it, and give it back.
  run.state.relics.push('whetstone')
  assert.deepEqual(kinds(run), ['fight', 'hold', 'place', 'release'])
  apply(run, legalActions(run).find((a) => a.type === 'hold'))
  assert.deepEqual(kinds(run), ['fight', 'place', 'release', 'unhold'])
  // In battle: the orders alone.
  apply(run, { type: 'fight' })
  assert.deepEqual(legalActions(run), legalOrders(run.battle))
  while (run.state.phase === 'battle') apply(run, { type: 'end' })
  if (run.state.phase === 'over') return
  // Poor, a recruit is out of reach: moving on (or letting a soul go) is all there is.
  assert.deepEqual(kinds(run), ['reap', 'release', 'unhold'])
  assert.ok(legalActions(run).some((a) => a.type === 'reap' && a.index === null))
})

test('fight opens the battle against the scouted foes, and run.setup with the orders given replays it exactly', () => {
  const run = createRun({ start: START_PARTY, seed: 'scout' })
  const node = visit(run, 'fight')
  fight(run)
  const foes = run.battle.units.filter((u) => u.side === 'foe')
  const bySlot = (a, b) => a.slot - b.slot
  assert.deepEqual(foes.sort(bySlot).map((u) => [u.id, u.lvl, u.slot]), node.foes.slice().sort(bySlot).map((f) => [f.id, f.lvl, f.slot]))
  assert.ok(run.battle.over)
  assert.ok(!['prep', 'battle'].includes(run.state.phase))
  assert.deepEqual(rebuiltBattle(run).events, run.battle.events)
})

test('place: field slots swap, the ossuary holds souls back, and the field has a cap', () => {
  const run = createRun({ start: START_PARTY, seed: 'place' })
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
    const run = createRun({ start: START_PARTY, seed: 'camp' + i })
    assert.equal(CAMP_LIST.find((c) => c.id === run.state.camp).floor, 1)
    seen.add(run.state.camp)
  }
  assert.equal(seen.size, CAMP_LIST.filter((c) => c.floor === 1).length, 'every floor-1 camp turns up')
  // Floor by floor, with a full field and a 2×2 on it: each camp from its floor's list, the Monarch on its 'M', and
  // every piece wholly on open ground, where the new camp's frontier puts it (or waiting in the ossuary).
  const floors = new Set()
  for (let i = 0; i < 12; i++) {
    const run = createRun({ start: START_PARTY, seed: 'walls' + i })
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
  const run = createRun({ start: START_PARTY, seed: 'same-camp' })
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


test('release never lets go of the last soul standing (the Monarch does not count), nor of the Monarch; a soul let go pays back its refund', () => {
  const run = createRun({ start: START_PARTY, seed: 'release' })
  const m = monarchOf(run.state)
  const [a, b, c] = souls(run.state.party)
  a.hp = 0
  b.hp = 0
  assert.throws(() => apply(run, { type: 'release', uid: c.uid }))
  assert.throws(() => apply(run, { type: 'release', uid: MONARCH_UID }))
  const essence = run.state.essence
  apply(run, { type: 'release', uid: a.uid })
  assert.deepEqual(run.state.party, [m, b, c])
  assert.equal(run.state.essence, essence + releaseRefund(run, a), 'a fallen soul\'s refund too')
})

test('prep: the Monarch alone may fight; a fight with no one standing may not', () => {
  const run = createRun({ start: START_PARTY, seed: 'standing' })
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

test('altar\'s heal heals everyone and raises the fallen', () => {
  const run = createRun({ start: START_PARTY, seed: 'altar' })
  const [a, b] = run.state.party
  a.hp = 1
  b.hp = 0
  visit(run, 'altar')
  assert.equal(run.state.phase, 'altar')
  assert.equal(a.hp, 1)
  apply(run, { type: 'heal' })
  assert.equal(run.state.phase, 'map')
  assert.equal(a.hp, a.maxHp)
  assert.equal(b.hp, Math.ceil(b.maxHp * TUNING.run.altarRevive))
})

// DESIGN §2.2: a piece that fell leaves the field as the battle ends: it lies fallen in the ossuary, its cell and its
// Command free, and nothing fields it until an altar raises it. It still fuses and is released.
test('a piece that falls in a won battle goes to the ossuary: its cell and Command free, never placed, until an altar raises it', () => {
  const won = (() => {
    for (let i = 0; i < 200; i++) {
      const run = createRun({ start: START_PARTY, seed: 'fallen' + i })
      apply(run, { type: 'node', id: availableNodes(run)[0].id })
      fight(run)
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
  // An altar's heal raises it where it lies, in the ossuary; then it may be placed.
  visit(won, 'altar')
  apply(won, { type: 'heal' })
  assert.deepEqual([u.hp, u.slot], [Math.ceil(u.maxHp * TUNING.run.altarRevive), OSSUARY])
  assert.ok([...Array(CAMP_SLOTS).keys()].some((slot) => canPlace(won, u, slot)))
})

// ── the Shop (redesign.md §2.11) ─────────────────────────────────────────────────────────────────

// Walks into a Shop on `floor` with `essence` in the purse.
function shopAt (seed, floor = 1, essence = 0) {
  const run = createRun({ start: START_PARTY, seed })
  run.state.floor = floor
  run.state.essence = essence
  visit(run, 'shop')
  return run
}
const isCommand = (id) => relicMod(id, 'run.command') > 0

test('a Shop stocks distinct relics, one always a Command relic, no Legendary on floor 1 and one from floor 2; nothing else is sold', () => {
  for (let k = 0; k < 40; k++) {
    for (const floor of [1, 2, 4]) {
      const run = shopAt('stock' + k, floor)
      const s = run.state
      assert.equal(s.phase, 'shop')
      assert.equal(s.shop.length, TUNING.shop.relics, `${k} floor ${floor}`)
      assert.equal(new Set(s.shop).size, s.shop.length, 'never the same relic twice on one shelf')
      assert.ok(s.shop.every((id) => RELICS[id] && (!RELICS[id].needsArise || s.relics.includes('arise'))), JSON.stringify(s.shop))
      assert.ok(s.shop.some((id) => isCommand(id) && relicTier(id) !== 'legendary'), `a Command relic: ${s.shop}`)
      assert.equal(s.shop.filter((id) => relicTier(id) === 'legendary').length, floor >= TUNING.relic.legendary.fromFloor ? 1 : 0, `${s.shop}`)
      assert.deepEqual(new Set(legalActions(run).map((a) => a.type)), new Set(['leave', ...(souls(s.party).length > 1 ? ['release'] : [])]), 'an empty purse buys nothing')
    }
  }
})

test('a Shop sells any number of its relics while the purse allows, a bought slot gone; a buy it cannot pay for is refused; leaving is free', () => {
  const run = shopAt('buy-any')
  const s = run.state
  const stock = s.shop.slice()
  const prices = stock.map((id) => relicPrice(run, id))
  assert.deepEqual(shopOffers(run).map((o) => [o.index, o.id, o.tier, o.cost]), stock.map((id, i) => [i, id, relicTier(id), prices[i]]))
  // An empty purse: every buy refused, nothing changes.
  assert.ok(!canBuy(run, 0))
  assert.throws(() => apply(run, { type: 'buy', index: 0 }), /not enough essence/)
  assert.deepEqual([s.shop, s.relics, s.essence], [stock, [], 0])
  // Enough for all but the dearest: every one it can pay for, one after another, each slot emptied as it sells.
  const order = stock.map((_, i) => i).sort((a, b) => prices[a] - prices[b])
  s.essence = prices.reduce((n, p) => n + p, 0) - 1
  for (const i of order.slice(0, -1)) {
    assert.ok(legalActions(run).some((a) => a.type === 'buy' && a.index === i))
    apply(run, { type: 'buy', index: i })
    assert.equal(s.shop[i], null)
    assert.equal(shopOffers(run)[i], null)
  }
  assert.deepEqual(s.relics, order.slice(0, -1).map((i) => stock[i]))
  assert.equal(s.essence, prices[order.at(-1)] - 1)
  assert.equal(s.stats.spent, prices.reduce((n, p) => n + p, 0) - prices[order.at(-1)])
  assert.throws(() => apply(run, { type: 'buy', index: order.at(-1) }), /not enough essence/, 'the dearest is out of reach')
  assert.throws(() => apply(run, { type: 'buy', index: order[0] }), /no relic in slot/, 'a bought slot is gone')
  assert.ok(!legalActions(run).some((a) => a.type === 'buy'))
  // Leaving: free, and on to the map; the stock left on the shelf goes with the room.
  const essence = s.essence
  apply(run, { type: 'leave' })
  assert.deepEqual([s.phase, s.shop, s.essence], ['map', [], essence])
  assert.throws(() => apply(run, { type: 'buy', index: 0 }), /needs phase shop/)
  // A Command relic bought widens the field at once; an HP relic raises the Monarch's max HP and heals it by as much.
  const more = shopAt('buy-more', 1, 1000)
  more.state.shop = ['grave_banner', 'phylactery']
  monarchOf(more.state).hp = 100
  apply(more, { type: 'buy', index: 0 })
  apply(more, { type: 'buy', index: 1 })
  assert.deepEqual([fieldCap(more), monarchOf(more.state).maxHp, monarchOf(more.state).hp],
    [TUNING.party.field + 1, TUNING.monarch.hp + relicMod('phylactery', 'run.monarchHp'), 100 + relicMod('phylactery', 'run.monarchHp')])
  checkState(more.state)
})

test('a relic\'s price is its tier\'s, scaled by the floor and cut by the relics that cut it', () => {
  for (const floor of [1, 2, 3, 4, 6]) {
    const run = shopAt('price', floor)
    for (const r of [RELICS.whetstone, RELICS.war_drum, RELICS.grave_banner, RELICS.arise]) {
      assert.equal(relicPrice(run, r.id), Math.round(TUNING.shop.price[r.tier] * floorPrice(floor)), `${r.id} floor ${floor}`)
    }
  }
  assert.ok(relicPrice(shopAt('price', 3), 'whetstone') > relicPrice(shopAt('price', 1), 'whetstone'))
  // A relic that cuts a relic's price (`price.relic`; none is content yet), a copy at a time, never below 1.
  RELICS.test_haggle = { id: 'test_haggle', tier: 'common', name: 'Haggle', desc: '', mods: [{ path: 'price.relic', op: 'add', v: -0.25 }] }
  try {
    const run = shopAt('price', 2)
    const full = TUNING.shop.price.rare * floorPrice(2)
    run.state.relics = ['test_haggle']
    assert.equal(relicPrice(run, 'grave_banner'), Math.round(full * 0.75))
    run.state.relics = ['test_haggle', 'test_haggle']
    assert.equal(relicPrice(run, 'grave_banner'), Math.round(full * 0.5))
    run.state.relics = Array(5).fill('test_haggle')
    assert.equal(relicPrice(run, 'grave_banner'), 1)
    // The other price cuts are not a relic's.
    run.state.relics = ['rite_candle', 'grave_ledger', 'binding_chain']
    assert.equal(relicPrice(run, 'grave_banner'), Math.round(full))
  } finally {
    delete RELICS.test_haggle
  }
})

test('a won elite pays its bonus on top of its foes\' pay, lays out no relic, and offers its recruit like any fight', () => {
  for (const floor of [1, 2]) {
    const run = win('elite-pay', (r) => { r.state.floor = floor }, 'elite')
    const s = run.state
    const pay = run.battle.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0).reduce((n, u) => n + foeEssence(u), 0)
    assert.equal(eliteBonus(floor), Math.round(TUNING.essence.eliteBonus * floorPrice(floor)))
    assert.equal(s.stats.essence, Math.round(pay + eliteBonus(floor)), `floor ${floor}`)
    assert.equal(s.essence, TUNING.essence.start + s.stats.essence)
    assert.ok(s.offers.length > 0 && s.offers.every((o) => o.type === 'soul'), JSON.stringify(s.offers))
    assert.deepEqual(s.relics, [])
    apply(run, { type: 'reap', index: null })
    assert.deepEqual([s.phase, s.relics], ['map', []])
  }
  // A fight pays no bonus; Tithe Bowl's share counts the bonus too.
  const fight = win('elite-pay')
  const paid = fight.battle.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0).reduce((n, u) => n + foeEssence(u), 0)
  assert.equal(fight.state.stats.essence, Math.round(paid))
  const bowl = win('elite-pay', (r) => { r.state.relics = ['tithe_bowl'] }, 'elite')
  const foes = bowl.battle.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0).reduce((n, u) => n + foeEssence(u), 0)
  assert.equal(bowl.state.stats.essence, Math.round((foes + eliteBonus(1)) * (1 + relicMod('tithe_bowl', 'essence.gain'))))
})

test('a run that buys in a Shop replays exactly: the stock is drawn from the seed and the room', () => {
  const run = createRun({ start: START_PARTY, seed: 'shop-replay' })
  const s = run.state
  const node = availableNodes(run)[0]
  node.type = 'shop'
  // Outside the log: the room made a Shop and the purse filled, so the replay below is given the same.
  s.essence = 500
  s.log = []
  apply(run, { type: 'node', id: node.id })
  const stock = s.shop.slice()
  const a = legalActions(run).find((x) => x.type === 'buy')
  apply(run, a)
  apply(run, legalActions(run).find((x) => x.type === 'buy') ?? { type: 'leave' })
  if (s.phase === 'shop') apply(run, { type: 'leave' })
  const again = createRun({ start: START_PARTY, seed: 'shop-replay' })
  again.state.map.nodes.find((n) => n.id === node.id).type = 'shop'
  again.state.essence = 500
  apply(again, s.log[0])
  assert.deepEqual(again.state.shop, stock, 'the same stock')
  for (const x of s.log.slice(1)) apply(again, x)
  assert.deepEqual(again.state, s)
  assert.ok(s.relics.length >= 1)
})

test('a won fight pays essence and puts one soul per kind slain up for sale; one may be recruited', () => {
  const run = win('fight')
  const s = run.state
  const slain = run.battle.units.filter((u) => u.side === 'foe' && u.hp <= 0)
  const sale = s.offers.filter((o) => o.type === 'soul')
  assert.deepEqual(new Set(sale.map((o) => o.id)), new Set(slain.map((u) => u.id)))
  assert.ok(sale.every((o) => o.cost > 0 && o.lvl === kindLevel(s, o.id)), 'each at its kind\'s level, not the level it fought at')
  assert.deepEqual(s.offers.map((o) => o.type), sale.map(() => 'soul'), 'souls only')
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

test('a soul may be let go in a Shop, for its refund, and the Shop stays open with its stock', () => {
  const run = shopAt('shop-release')
  const s = run.state
  join(run, s.party[1].id)
  const stock = s.shop.slice()
  const u = souls(s.party).at(-1)
  const refund = releaseRefund(run, u)
  assert.ok(legalActions(run).some((a) => a.type === 'release' && a.uid === u.uid))
  apply(run, { type: 'release', uid: u.uid })
  assert.deepEqual([s.phase, s.shop, s.essence], ['shop', stock, refund])
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
      // Only the Monarch's fall loses (no clock), or for the autoplayer a stall: End Turn alone may hold a battle
      // forever (turns.js stalled). Always the killer's kind's first threat; a foe of a later wave (a late pair) also
      // records its wave.
      assert.ok(['monarch', 'stall'].includes(s.death?.reason), JSON.stringify(s.death))
      if (s.death.reason === 'stall') assert.deepEqual(s.death, { by: null, reason: 'stall', threat: null })
      else {
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
  for (let i = 0; i < 4; i++) autoplay(createRun({ start: START_PARTY, seed: 'plans' + i }), { onBattle: check })
  // The expert also trades souls with the ossuary; one floor of it.
  const run = createRun({ start: START_PARTY, seed: 'plans-expert' })
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
    const run = autoplay(createRun({ start: START_PARTY, seed: 'park' + i }), { onBattle: seated })
    assert.ok(!run.state.log.some((a) => (a.type === 'place' && a.uid === MONARCH_UID) || a.type === 'monarch' || a.type === 'level'))
  }
  const run = createRun({ start: START_PARTY, seed: 'monarch-expert3' })
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
    const run = createRun({ start: START_PARTY, seed: 'prep' })
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

// In a Shop basic buys a Command relic it can pay for, and nothing else (autoplay.js pickShop); the place it adds fields
// a soul that waited.
test('in a Shop basic buys a Command relic it can pay for, then leaves, and fields the soul waiting for the place it adds', () => {
  const b = shopAt('command')
  const s = b.state
  const rng = createRng('command').stream('autoplay')
  join(b, 'grave_ghoul')
  s.shop = ['whetstone', 'grave_banner']
  assert.deepEqual(policy(b, rng, 'basic'), { type: 'leave' }, 'an empty purse buys nothing')
  s.essence = relicPrice(b, 'grave_banner') + relicPrice(b, 'whetstone')
  assert.deepEqual(policy(b, rng, 'basic'), { type: 'buy', index: 1 })
  apply(b, { type: 'buy', index: 1 })
  assert.deepEqual(policy(b, rng, 'basic'), { type: 'leave' }, 'and nothing but Command')
  apply(b, { type: 'leave' })
  assert.deepEqual([s.relics, s.phase, unheld(s)], [['grave_banner'], 'map', []])
  visit(b, 'fight')
  for (let action; (action = policy(b, rng, 'basic')).type !== 'fight';) apply(b, action)
  assert.deepEqual([fieldCap(b), fielded(souls(s.party)).length, soulCount(s.party)], [4, 4, 4])
})

// The expert's Shop (autoplay.js buyFor, pickHold): with every tier its kinds can take already held (so its price
// displaces none), it buys what the sketch says a relic adds, gives a piece relic it bought to a standing soul, and
// leaves; a relic a fallen soul holds it gives back, and gives again to one standing. Functional: that it buys and holds,
// and only what it may, never which relic it prefers.
test('the expert in a Shop: buys a relic worth its price, gives a piece relic to a standing soul, and leaves; a fallen holder\'s relic goes to one standing', () => {
  const run = shopAt('expert-shop')
  const s = run.state
  for (const k of Object.values(s.kinds)) Object.assign(k, { lvl: levelOf({ tracks: [4, 2] }), tracks: [4, 2] })
  for (const u of souls(s.party)) Object.assign(u, makeUnit(u.id, { uid: u.uid, slot: u.slot, lvl: s.kinds[u.id].lvl, tracks: [4, 2] }))
  s.shop = ['whetstone', 'heartwood', 'grave_banner']
  s.essence = 1e4
  const rng = createRng('expert-shop').stream('autoplay')
  const acts = []
  for (let a; (a = policy(run, rng, 'expert')).type !== 'leave' && acts.length < 20;) {
    assert.ok(legalActions(run).some((x) => JSON.stringify(x) === JSON.stringify(a)), JSON.stringify(a))
    acts.push(a)
    apply(run, a)
    if (a.type === 'hold') assert.ok(souls(s.party).find((u) => u.uid === a.uid).hp > 0, 'given to a standing soul')
  }
  assert.ok(acts.some((a) => a.type === 'buy') && acts.some((a) => a.type === 'hold'), JSON.stringify(acts))
  assert.ok(souls(s.party).every((u) => (u.relics?.length ?? 0) <= TUNING.relic.perPiece))
  assert.deepEqual(policy(run, rng, 'expert'), { type: 'leave' })
  // Its holder fallen, the relic is given back, then to a soul standing.
  apply(run, { type: 'leave' })
  const holder = souls(s.party).find((u) => u.relics?.length)
  const relic = holder.relics[0]
  holder.hp = 0
  assert.deepEqual(policy(run, rng, 'expert'), { type: 'unhold', uid: holder.uid })
  apply(run, { type: 'unhold', uid: holder.uid })
  const next = policy(run, rng, 'expert')
  assert.equal(next.type, 'hold', JSON.stringify(next))
  assert.ok(next.relic === relic || unheld(s).includes(next.relic))
  assert.ok(souls(s.party).find((u) => u.uid === next.uid).hp > 0)
})

test('the autoplayer decides without touching the run', () => {
  for (const level of ['basic', 'expert']) {
    const seen = new Set()
    // Through the first rooms: a route choice, a prep and a reap at least (on another seed if a run is
    // lost before it reaps: floor 1 is hard).
    for (let k = 0; k < 4 && !seen.has('reap'); k++) {
      const run = createRun({ start: START_PARTY, seed: 'rehearse' + (k || '') })
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
    assert.ok(['map', 'prep', 'battle', 'reap'].every((p) => seen.has(p)) && [...seen].every((p) => ['map', 'prep', 'battle', 'reap', 'shop', 'altar'].includes(p)), `${level}: ${[...seen]}`)
  }
})

test('replay(seed, log) rebuilds the same final state', () => {
  for (let i = 0; i < 5; i++) {
    const live = fuzz('replay' + i, 0, new Set())
    assert.deepEqual(replay(live.state.seed, live.state.log).state, live.state)
  }
})

test('the current node after a fight is the room fought in', () => {
  const run = createRun({ start: START_PARTY, seed: 'node' })
  const node = visit(run, 'fight')
  fight(run)
  assert.equal(currentNode(run).id, node.id)
})

// ── the Monarch in the run ───────────────────────────────────────────────────────────────────────

test('the Monarch stands on its camp\'s seat from the start, and nothing places it nor anything on its cell; its souls start on the camp\'s default frontier', () => {
  for (const c of CAMP_LIST.filter((x) => x.floor === 1)) {
    let run
    for (let i = 0; !run || run.state.camp !== c.id; i++) run = createRun({ start: START_PARTY, seed: 'throne' + i })
    const m = monarchOf(run.state)
    assert.equal(m.slot, monarchSlot(c.id))
    assert.ok(isMonarchCell(c.id, m.slot))
    const start = souls(run.state.party)
    assert.deepEqual(start.map((u) => u.slot), frontier(c.id, start.map((u) => ({ ...u, slot: OSSUARY }))), `${c.id}: the frontier (test/movement.test.js)`)
  }
  const run = createRun({ start: START_PARTY, seed: 'throne' })
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
  assert.equal(m.slot, seat)
  // It takes no room: three souls fill the field beside it, and it is never released.
  apply(run, { type: 'place', uid: chanter.uid, slot: firstFree(s) })
  assert.equal(fielded(s.party).length, fieldCap(run) + 1)
  assert.throws(() => join(run, 'monarch'), /one Monarch/)
  checkState(s)
})

test('the Monarch\'s HP and Command are its relics\', and Arise\'s numbers the run\'s; the battle gets them all', () => {
  const run = createRun({ start: START_PARTY, seed: 'crown' })
  const s = run.state
  const m = monarchOf(s)
  assert.deepEqual([m.lvl, m.maxHp], [0, TUNING.monarch.hp])
  // Relics: two Command (one Legion), two copies of Arise, Court of Bone and an Hourglass.
  s.relics = ['grave_banner', 'legion', 'arise', 'arise', 'court_of_bone', 'hourglass']
  assert.equal(fieldCap(run), TUNING.party.field + 3)
  assert.equal(commandOf(s), baseField(s) + 3)
  const a = ariseOf(s)
  assert.equal(a.domain, TUNING.arise.domain + relicMod('hourglass', 'arise.domain'))
  visit(run, 'fight')
  const setup = battleSetup(run)
  assert.deepEqual([setup.arise, setup.relics.filter((id) => id === 'arise').length, setup.nextUid], [a, 2, s.nextUid + setup.foes.length])
  assert.equal(setup.party.find((u) => u.uid === MONARCH_UID).maxHp, m.maxHp)
})

test('a fight: shadows never join the retinue and the run moves past their uids; wounds carry; a fallen Monarch ends the run', () => tuned({ ...FIRST_BALANCE, arise: { ...FIRST_BALANCE.arise, domain: 8 } }, () => {
  // With Arise's reach over the whole board (two souls holding Arise), where corpses fall in reach; with `hp`, the
  // Monarch wounded before the fight, its souls on the cells beside its seat, where the foes come to them.
  const fightFrom = (seed, hp) => {
    const run = createRun({ start: START_PARTY, seed })
    run.state.relics = ['arise', 'arise']
    souls(run.state.party).slice(0, 2).forEach((u) => { u.relics = ['arise'] })
    visit(run, 'fight')
    if (hp) {
      monarchOf(run.state).hp = hp
      const seat = monarchOf(run.state).slot
      const beside = [[0, -1], [0, 1], [-1, 0]].map(([dr, dc]) => [rowOf(seat) + dr, colOf(seat) + dc]).filter(([r, c]) => r >= 0 && c >= 0 && c < COLS)
        .map(([r, c]) => slotAt(r, c)).filter((slot) => campOpen(run.state.camp, slot))
      souls(run.state.party).forEach((u, i) => beside[i] !== undefined && canPlace(run, u, beside[i]) && apply(run, { type: 'place', uid: u.uid, slot: beside[i] }))
    }
    return fight(run)
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
  const lone = createRun({ start: START_PARTY, seed: 'lone' })
  visit(lone, 'fight')
  for (const u of souls(lone.state.party)) apply(lone, { type: 'place', uid: u.uid, slot: -1 })
  fight(lone, basicTurn)
  assert.deepEqual([lone.state.phase, lone.state.result, lone.battle.reason], ['over', 'defeat', 'monarch'])
  assert.deepEqual(lone.state.death, { ...lone.battle.death, reason: 'monarch' })
  assert.ok(lone.state.death.by && lone.state.death.threat)
  assert.equal(monarchOf(lone.state).hp, 0)
  // No clock: a battle is never lost by time, only by the Monarch's fall.
  const slow = createRun({ start: START_PARTY, seed: 'slow' })
  visit(slow, 'fight')
  fight(slow, basicTurn)
  assert.ok(slow.battle.winner === 'party' || slow.state.death?.reason === 'monarch', JSON.stringify(slow.state.death))
  // An altar's heal heals it like a soul.
  const rest = createRun({ start: START_PARTY, seed: 'rest' })
  monarchOf(rest.state).hp = 1
  visit(rest, 'altar')
  apply(rest, { type: 'heal' })
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
      const map = generateFloor({ seed, floor, boss: floor <= TUNING.run.floors })
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

// ── the army: souls, Command ─────────────────────────────────────────────────────────────────────────────────────────

// Gives the Monarch `n` more Command: as many Grave Banners (the Command relic that costs the souls nothing), held as a
// relic taken would be (the state edited outside the log: not a replay).
function command (run, n) {
  run.state.relics.push(...Array(n).fill('grave_banner'))
}

// ── the army: souls, the ossuary ───────────────────────────────────────────────────────

test('Command is the field cap (3 + Command), never past the board', () => {
  const run = createRun({ start: START_PARTY, seed: 'army' })
  const s = run.state
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
  checkState(s)
})

test('the ossuary is the soul collection: recruits past the field wait there, a soul leaves it only while the field has room, and the roster counts both', () => {
  const run = createRun({ start: START_PARTY, seed: 'ossuary' })
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
  // nearest the seat that it fits (its footprint's nearest cell; none nearer), behind the start souls' frontier.
  for (const camp of CAMP_LIST.filter((c) => c.floor === 1)) {
    const run = createRun({ start: START_PARTY, seed: 'recruit' })
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

// ── a soul's HP, and prices (DESIGN §2.2) ────────────────────────────────────────────────────────

// One soul is one piece is one body: it fights as one, comes out of a won battle with the share of its HP it kept, and
// heals; one that fell stays down, in the ossuary.
test('a won battle leaves each piece the share of its HP it kept, then heals each living one by postBattleHeal; the fallen stay down', () => {
  const run = win('kept-hp')
  const s = run.state
  const b = run.battle
  let fought = 0
  for (const u of s.party) {
    const bu = b.byUid.get(u.uid)
    if (!bu) continue
    fought++
    // The run's HP: the battle's share of it, at least 1 while it stood, then the won battle's heal.
    const kept = bu.hp > 0 ? Math.min(u.maxHp, Math.max(1, Math.round(bu.hp / bu.maxHp * u.maxHp))) : 0
    const healed = kept > 0 ? Math.min(u.maxHp, kept + Math.ceil(u.maxHp * TUNING.run.postBattleHeal)) : 0
    assert.equal(u.hp, healed, `${u.id} ${u.uid}`)
    assert.equal(u.maxHp, u.uid === MONARCH_UID ? monarchHp(s) : baseStats(u.id, u.lvl).hp, `${u.id} ${u.uid}: its max HP its level's`)
    if (!kept) assert.equal(u.slot, OSSUARY, `${u.id} ${u.uid}: the fallen to the ossuary`)
  }
  assert.equal(fought, run.setup.party.length, 'every piece fielded fought')
  checkState(s)
})

test('a tier\'s level heals a living soul by its gain and leaves a fallen one down; an altar heals the living to altarHeal and raises the fallen to altarRevive', () => tuned(LEVEL_A_TIER, () => {
  const run = createRun({ start: START_PARTY, seed: 'level-heal' })
  const s = run.state
  const [knight] = souls(s.party)
  const fallen = join(run, 'tomb_knight')
  fallen.hp = 0
  const b = knight.maxHp
  knight.hp = 10
  s.essence = 1000
  apply(run, { type: 'upgrade', kind: 'tomb_knight', track: 0 })
  assert.ok(knight.lvl > TUNING.level.base)
  const b2 = baseStats('tomb_knight', knight.lvl).hp
  assert.deepEqual([knight.maxHp, knight.hp, fallen.maxHp, fallen.hp], [b2, 10 + b2 - b, b2, 0])
  const T = TUNING.run
  knight.hp = 10
  const node = visit(run, 'altar')
  assert.equal(node.type, 'altar')
  apply(run, { type: 'heal' })
  assert.deepEqual([knight.hp, fallen.hp], [Math.max(10, Math.round(b2 * T.altarHeal)), Math.ceil(b2 * T.altarRevive)])
}))

test('a foe pays essence by its tier alone, whatever its level', () => {
  const one = makeUnit('grave_ghoul', { lvl: 4 })
  assert.equal(foeEssence(makeUnit('grave_ghoul', { lvl: 1 })), foeEssence(one))
  assert.equal(foeEssence(one), TUNING.essence.perTier * UNITS.grave_ghoul.tier)
  assert.equal(foeEssence(makeUnit('iron_golem', { lvl: 4 })), TUNING.essence.perTier * UNITS.iron_golem.tier)
})

test('every price grows by the floor: a tier, a recruit and a fusion cost their base × floorPrice, 1 on floor 1', () => {
  assert.equal(floorPrice(1), 1)
  assert.ok(floorPrice(2) > floorPrice(1) && floorPrice(3) > floorPrice(2))
  const run = createRun({ start: START_PARTY, seed: 'floor-prices' })
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
  const run = createRun({ start: START_PARTY, seed: 'big' })
  const s = run.state
  command(run, 2)
  const big = join(run, BIG)
  assert.equal(sizeOf(big), 2)
  assert.ok(big.slot >= 0 && rowOf(big.slot) >= 1, 'a new soul takes the free cell nearest the seat it fits; a 2×2 runs a row ahead, so never from the front row')
  checkField(s)
  // Every anchor whose footprint covers no other soul's cell (one over a soul is a swap, or nothing: swapWith):
  // listed, and applied, exactly where the footprint fits, on the camp's open ground and never over the seat.
  const others = takenBy(s, [big, monarchOf(s)])
  const listed = new Set(legalActions(run).filter((a) => a.type === 'place' && a.uid === big.uid).map((a) => a.slot))
  let fit = 0
  for (let slot = 0; slot < CAMP_SLOTS; slot++) {
    const cells = footprintSlots(slot, 2)
    if ((cells ?? [slot]).some((c) => others.has(c)) || slot === big.slot) continue
    const ok = !!cells && cells.every((c) => campOpen(s.camp, c) && !isMonarchCell(s.camp, c))
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

test('a Colossus tier grows every piece of its kind to 2×2: one that still fits keeps its cell, one that does not goes to the ossuary', () => {
  const run = createRun({ start: START_PARTY, seed: 'colossus' })
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
  // It may be placed again, wherever a 2×2 fits (or in a swap with the one piece under its footprint).
  const back = legalActions(run).filter((a) => a.type === 'place' && a.uid === b.uid && a.slot >= 0 && !footprintSlots(a.slot, 2).some((c) => takenBy(s).has(c)))
  assert.ok(back.length > 0 && back.every((x) => fits(s.camp, x.slot, 2, takenBy(s))))
  checkState(s)
})

test('a Colossus tier bumps only what cannot stand: a piece growing over one of its kind that goes to the ossuary keeps its cell', () => {
  const run = createRun({ start: START_PARTY, seed: 'colossus-bump' })
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

// How many pieces of `kind` the retinue holds (a soul each).
const piecesOf = (s, kind) => souls(s.party).filter((u) => u.id === kind).length

// A run holding, for each kind recipe `r` needs, a piece more than it needs, and the essence the fusion costs.
function fusable (seed, r) {
  const run = createRun({ start: START_PARTY, seed })
  const s = run.state
  for (const [kind, n] of Object.entries(r.needs)) while (piecesOf(s, kind) < n + 1) join(run, kind)
  s.essence = fuseCost(run, r.id)
  return run
}

test('fuse: a recipe consumes exactly the pieces it needs (each kind keeps its one more), pays its price, and its fused piece waits in the ossuary, joining its kind', () => tuned(LEVEL_A_TIER, () => {
  for (const r of FUSION_LIST) {
    const run = fusable('fuse-' + r.id, r)
    const s = run.state
    const def = UNITS[r.result]
    assert.ok(def.fused, `${r.result} is a fused kind`)
    assert.equal(fuseCost(run, r.id), Math.round(TUNING.essence.fuse * def.tier * floorPrice(s.floor)))
    // The pieces asked of each kind, in the recipe's order: the ossuary's first, then the fielded, party order among
    // equals.
    const ofKind = (kind) => souls(s.party).filter((u) => u.id === kind)
    const parts = Object.entries(r.needs).flatMap(([kind, n]) => [...ofKind(kind).filter((u) => u.slot < 0), ...ofKind(kind).filter((u) => u.slot >= 0)].slice(0, n).map((u) => u.uid))
    assert.deepEqual(fuseParts(run, r.id), parts, 'the pieces asked of each kind')
    assert.ok(canFuse(run, r.id))
    // Refused, the run untouched: a short set, one too many of a kind, a wrong kind (one more, or in a part's stead),
    // the Monarch, a piece twice, no such piece, the parts as counts, none, not a list, no such recipe, and
    // short of essence.
    const other = souls(s.party).find((u) => !(u.id in r.needs)) ?? join(run, UNIT_LIST.find((u) => u.spawn && !(u.id in r.needs)).id)
    const spare = souls(s.party).find((u) => u.id in r.needs && !parts.includes(u.uid))
    const bad = [
      parts.slice(1), [...parts, spare.uid], [...parts, other.uid], [other.uid, ...parts.slice(1)], [...parts, MONARCH_UID],
      [parts[0], parts[0], ...parts.slice(2)], [999, ...parts.slice(1)], parts.map((uid) => ({ uid, n: 1 })), [], null, 'all'
    ]
    const was = structuredClone(s)
    for (const p of bad) assert.throws(() => apply(run, { type: 'fuse', id: r.id, parts: p }), /cannot fuse/, JSON.stringify(p))
    assert.throws(() => apply(run, { type: 'fuse', id: 'no_such_fusion', parts }), /cannot fuse/)
    s.essence--
    assert.ok(!canFuse(run, r.id) && fuseParts(run, r.id) !== null)
    assert.throws(() => apply(run, { type: 'fuse', id: r.id, parts }), /not enough essence/)
    s.essence++
    assert.deepEqual(s, was)
    // Made: the pieces named gone, whole, and every other kept as it was (each kind its one more); the essence paid;
    // the fused piece in the ossuary, whole, a kind new to the run at the highest level of the kinds consumed (its
    // least), with no tiers.
    const before = { souls: soulCount(s.party), spent: s.stats.spent, uid: s.nextUid }
    const kept = structuredClone(souls(s.party).filter((u) => !parts.includes(u.uid)))
    const lvl = Math.max(...Object.keys(r.needs).map((kind) => kindLevel(s, kind)))
    apply(run, { type: 'fuse', id: r.id, parts })
    assert.deepEqual(souls(s.party).slice(0, -1), kept)
    assert.ok(Object.keys(r.needs).every((kind) => piecesOf(s, kind) === 1), 'each kind keeps its one more')
    const fused = s.party.at(-1)
    const hp = baseStats(r.result, lvl).hp
    assert.deepEqual([fused.id, fused.uid, fused.hp, fused.maxHp, fused.slot, fused.lvl, fused.tracks], [r.result, before.uid, hp, hp, OSSUARY, lvl, [0, 0]])
    assert.deepEqual(s.kinds[r.result], { lvl, tracks: [0, 0], least: lvl })
    assert.deepEqual([s.essence, s.stats.spent - before.spent, soulCount(s.party)], [0, fuseCost(run, r.id), before.souls - parts.length + 1])
    assert.deepEqual(s.log.at(-1), { type: 'fuse', id: r.id, parts })
    checkState(s)
    // What is left lists the fusion only if it still holds the pieces (each kind kept one) and the essence.
    s.essence = 1e4
    const short = Object.entries(r.needs).some(([kind, n]) => piecesOf(s, kind) < n)
    assert.equal(fuseParts(run, r.id) === null, short)
    assert.equal(legalActions(run).some((a) => a.type === 'fuse' && a.id === r.id), !short)
    // Again, once the fused kind has a tier of its own (and the level it gives): the new piece joins it at both, the
    // pieces named consumed and gone.
    apply(run, { type: 'upgrade', kind: r.result, track: 0 })
    for (const [kind, n] of Object.entries(r.needs)) while (piecesOf(s, kind) < n) join(run, kind)
    const again = fuseParts(run, r.id)
    apply(run, { type: 'fuse', id: r.id, parts: again })
    assert.deepEqual([s.party.at(-1).lvl, s.party.at(-1).tracks], [s.kinds[r.result].lvl, [1, 0]])
    assert.ok(s.kinds[r.result].lvl !== lvl && !s.party.some((u) => again.includes(u.uid)))
    checkState(s)
  }
}))

test('a fused piece is never at a lower level than its parts: its kind stands at least at the highest level of the kinds consumed, held or not, and never falls', () => {
  const r = FUSION_LIST.find((x) => Object.keys(x.needs).length > 1)
  const [high, low] = Object.keys(r.needs)
  const run = fusable('fuse-level', r)
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
  for (const [id, n] of Object.entries(r.needs)) while (piecesOf(s, id) < n) join(run, id)
  apply(run, { type: 'fuse', id: r.id, parts: fuseParts(run, r.id) })
  const want = Math.max(higher, levelOf(s.kinds[r.result]))
  assert.deepEqual([s.party.at(-1).lvl, first.lvl, s.kinds[r.result].least], [want, want, higher])
  // Let go of every piece of it and fused again: the kind keeps its level and its tiers.
  const kind = { ...s.kinds[r.result] }
  for (const u of souls(s.party).filter((x) => x.id === r.result)) apply(run, { type: 'release', uid: u.uid })
  for (const [id, n] of Object.entries(r.needs)) while (piecesOf(s, id) < n) join(run, id)
  apply(run, { type: 'fuse', id: r.id, parts: fuseParts(run, r.id) })
  assert.deepEqual([s.party.at(-1).lvl, s.party.at(-1).tracks, s.kinds[r.result]], [kind.lvl, kind.tracks, kind])
  checkState(s)
})

test('legalActions lists one fuse a recipe that can be made, of its canonical parts: the ossuary\'s pieces first, then the fielded, party order among equals', () => {
  for (const r of FUSION_LIST) {
    const run = createRun({ start: START_PARTY, seed: 'fuse-legal-' + r.id })
    const s = run.state
    command(run, 6)
    s.essence = 1e4
    // Each kind: as many fielded pieces as the recipe needs, then one more, held after them, in the ossuary.
    const held = Object.entries(r.needs).map(([kind, n]) => {
      const ofKind = () => souls(s.party).filter((u) => u.id === kind)
      while (ofKind().length < n) join(run, kind)
      for (const u of ofKind()) if (u.slot < 0) apply(run, { type: 'place', uid: u.uid, slot: firstFree(s) })
      const spare = join(run, kind)
      if (spare.slot >= 0) apply(run, { type: 'place', uid: spare.uid, slot: OSSUARY })
      return { n, out: ofKind().filter((u) => u !== spare), spare }
    })
    const fuses = () => legalActions(run).filter((a) => a.type === 'fuse')
    const expect = held.flatMap(({ n, out, spare }) => [spare.uid, ...out.slice(0, n - 1).map((u) => u.uid)])
    assert.deepEqual(fuseParts(run, r.id), expect, 'the ossuary\'s piece first, then the fielded')
    assert.deepEqual(fuses().filter((a) => a.id === r.id), [{ type: 'fuse', id: r.id, parts: expect }])
    // The first fielded piece of each kind to the ossuary too: the ossuary's two in party order (it before the one
    // held after it), then the fielded.
    for (const { out } of held) apply(run, { type: 'place', uid: out[0].uid, slot: OSSUARY })
    const then = held.flatMap(({ n, out, spare }) => [out[0].uid, spare.uid, ...out.slice(1).map((u) => u.uid)].slice(0, n))
    assert.deepEqual(fuseParts(run, r.id), then)
    // Every fuse listed applies, and none when the essence falls short.
    for (const a of fuses()) apply({ ...run, state: structuredClone(s) }, a)
    s.essence = fuseCost(run, r.id) - 1
    assert.ok(!fuses().some((a) => a.id === r.id) && !canFuse(run, r.id))
    assert.equal(fuseParts(run, 'no_such_fusion'), null)
  }
})

// ── fuzz: random legal actions, invariants after every one, replay at the end ──────────────────

// The board in battle: each layer's index holds the living alone, each on every tile of its footprint, in its own layer,
// and nothing else there (no two pieces on a tile), a ground piece on no wall, a fusion's parts off it.
function checkBoard (b) {
  for (const [layer, flies] of [[b.at, false], [b.sky, true]]) {
    for (let t = 0; t < layer.length; t++) {
      const u = layer[t]
      if (u) assert.ok(u.hp > 0 && !!u.flies === flies && !u.into && footprint(u.tile, u.size)?.includes(t), `${u.id} ${u.uid} on tile ${t}`)
    }
  }
  for (const u of b.units) {
    if (u.hp <= 0) continue
    const tiles = footprint(u.tile, u.size)
    assert.ok(tiles?.every((t) => (u.flies ? b.sky : b.at)[t] === u && (u.flies || !b.walls.has(t))), `${u.id} ${u.uid} at ${u.tile}, size ${u.size}`)
  }
}

function checkState (s) {
  assert.ok(['map', 'prep', 'battle', 'reap', 'shop', 'altar', 'over'].includes(s.phase), s.phase)
  const all = souls(s.party)
  assert.ok(all.length >= 1 && soulCount(s.party) <= TUNING.party.roster + 3 * s.relics.filter((r) => r === 'ossuary_key').length)
  assert.ok(Number.isInteger(s.essence) && s.essence >= 0, `essence ${s.essence}`)
  assert.equal(new Set(s.party.map((u) => u.uid)).size, s.party.length, 'unique uids')
  assert.ok(s.party.every((u) => u.uid < s.nextUid || u.uid === MONARCH_UID), 'uids below nextUid')
  checkField(s)
  const command = s.relics.reduce((n, id) => n + relicMod(id, 'run.command'), 0)
  assert.equal(commandOf(s), baseField(s) + command)
  assert.ok(fielded(all).length <= commandOf(s), 'field cap')
  // The Monarch: one, always on its camp's seat, with no level and no points: its max HP its base and its HP relics';
  // no kind, no tracks; it stands until the run is over.
  const m = s.party.filter((u) => u.id === 'monarch')
  assert.deepEqual(m.map((u) => u.uid), [MONARCH_UID])
  assert.equal(m[0].slot, monarchSlot(s.camp), 'the Monarch on its seat')
  assert.deepEqual([m[0].lvl, m[0].maxHp, m[0].tracks], [0, monarchHp(s), [0, 0]])
  assert.ok(!('monarch' in s.kinds), 'the Monarch is no kind')
  if (s.phase !== 'over') assert.ok(m[0].hp > 0, 'the Monarch stands')
  assert.equal(s.result === 'defeat', !!s.death)
  for (const u of all) {
    assert.ok(Number.isInteger(u.hp) && u.hp >= 0 && u.hp <= u.maxHp, `${u.id} hp ${u.hp}/${u.maxHp}`)
    assert.ok(u.lvl >= 1 && u.lvl <= levelOf({ tracks: [4, 2] }), `${u.id} lvl ${u.lvl}`)
    // Upgrades are the kind's: every soul holds its kind's level and tiers, within the crosspath rule.
    const kind = s.kinds[u.id]
    assert.ok(kind, `${u.id}: a kind`)
    assert.deepEqual([u.lvl, u.tracks], [kind.lvl, kind.tracks], `${u.id} ${u.uid}`)
    assert.ok(!('count' in u), `${u.id} ${u.uid}: one body, no count`)
    assert.equal(u.maxHp, baseStats(u.id, u.lvl).hp, `${u.id} ${u.uid} max HP: its level's`)
  }
  for (const [id, k] of Object.entries(s.kinds)) {
    assert.ok(k.lvl >= 1 && k.tracks.length === 2 && k.lvl === levelOf(k), `${id} ${JSON.stringify(k)}: its level is its tiers'`)
    assert.ok(k.tracks.every((t) => Number.isInteger(t) && t >= 0 && t <= 4) && !(k.tracks[0] > 2 && k.tracks[1] > 2), `${id} ${k.tracks}`)
  }
  assert.ok(Number.isInteger(m[0].hp) && m[0].hp >= 0 && m[0].hp <= m[0].maxHp)
  // The army is souls, a piece each: no shadow or boss ever in the retinue (the ossuary is the pieces off the field);
  // the spoils' offers are souls alone (relics are bought: redesign.md §2.11).
  for (const u of all) assert.ok(!UNITS[u.id].boss && !u.shadow && !('cohort' in u), u.id)
  assert.ok(s.offers.every((o) => o.type === 'soul'), JSON.stringify(s.offers))
  assert.ok(fieldCap({ state: s }) <= TUNING.army.board)
  // Relics: known, as many copies as bought (no cap); a Shop's shelf (only while in one) holds known relics, or null
  // where one sold, one that needs Arise only once it is held; nothing bought for the Monarch, no level bought.
  assert.ok(s.relics.every((id) => RELICS[id]), JSON.stringify(s.relics))
  assert.ok(s.phase === 'shop' || s.shop.length === 0, JSON.stringify(s.shop))
  for (const id of s.shop.filter(Boolean)) assert.ok(RELICS[id] && (!RELICS[id].needsArise || ariseHeld(s)), id)
  // Held relics: piece relics the run owns, at most perPiece a soul, one copy each; never the Monarch's.
  const held = all.flatMap((u) => u.relics ?? [])
  for (const u of all) assert.ok((u.relics ?? []).length <= TUNING.relic.perPiece && new Set(u.relics ?? []).size === (u.relics ?? []).length, `${u.uid} ${u.relics}`)
  for (const id of new Set(held)) assert.ok(!RELICS[id].run && held.filter((x) => x === id).length <= s.relics.filter((x) => x === id).length, id)
  assert.ok(!m[0].relics?.length)
  assert.ok(!s.log.some((a) => a.type === 'monarch' || a.type === 'level'), 'no Monarch points, no levels bought')
}


// A steady hand, standing in for a player (the autoplayer is tested on its own): it makes any fusion it can, walks
// to a random room, fields a piece from the ossuary, gives a relic waiting to a soul, or buys a tier now and then before
// it fights; in battle strikes now and then and ends its turns; recruits the first soul it can afford, in a Shop buys
// the first relic it can pay for until it can pay for none, then leaves; at an altar takes a rite of the three at random.
function steady (run, rng) {
  const s = run.state
  const legal = legalActions(run)
  const of = (type) => legal.filter((a) => a.type === type)
  if (s.phase === 'battle') return of('act').length && rng.chance(0.5) ? rng.pick(of('act')) : { type: 'end' }
  if (s.phase === 'altar') return rng.pick(of(rng.pick([...new Set(legal.map((a) => a.type))])))
  if (of('fuse').length) return rng.pick(of('fuse'))
  if (of('hold').length && rng.chance(0.3)) return rng.pick(of('hold'))
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
  const run = createRun({ start: START_PARTY, seed })
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
// `again` is the run rebuilt from `ready` and its log as the log grows (each entry applied once, as it is logged: with
// no clock a run lives longer, and rebuilding it from the start at every check would refight it again and again).
function fuzz (seed, k, seen, fought = () => {}, offered = { legendaries: 0 }) {
  const rng = createRng(seed).stream('fuzz')
  const run = ready(seed, k)
  const again = ready(seed, k)
  for (let steps = 0; run.state.phase !== 'over'; steps++) {
    assert.ok(steps < 1e5, 'stuck')
    const legal = legalActions(run)
    assert.ok(legal.length > 0)
    const isLegendary = (a) => a.type === 'buy' && relicTier(run.state.shop[a.index]) === 'legendary'
    if (legal.some(isLegendary)) offered.legendaries++
    // A Legendary a Shop sells that the purse can pay for is bought half the time (the steady hand buys the first it
    // can), so the runs that reach one carry Legendaries into their battles.
    const legendary = legal.find(isLegendary)
    // Past the sim's bound on turns a battle ends as a stall, as the autoplayer ends one (End Turn alone may hold it).
    const action = run.state.phase === 'battle' && stalled(run.battle) ? { type: 'stall' }
      : legendary && rng.chance(0.5) ? legendary : rng.chance(0.2) ? anyLegal(legal, rng) : steady(run, rng)
    seen.add(action.type)
    apply(run, action)
    if (action.type === 'fight') fought(run)
    checkState(run.state)
    if (run.state.phase === 'battle') checkBoard(run.battle)
    for (const a of run.state.log.slice(again.state.log.length)) apply(again, a)
    if (steps % 17 === 0) everyLegalActionApplies(run, again)
  }
  return run
}

// The run rebuilt (`base`: from `ready` and the log) is the run, and each legal action applies cleanly to a copy of it
// (cloned per action, the rebuilt run itself never touched).
function everyLegalActionApplies (run, base) {
  assert.deepEqual(base.state, run.state)
  const legal = legalActions(run)
  for (const action of legal.filter((_, i) => i % Math.ceil(legal.length / 12) === 0)) {
    const copy = { ...base, state: structuredClone(base.state), battle: base.battle && fork(base.battle, { quiet: false }) }
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
  // Legendaries come from Shops from floor 2: those the purse could pay for are bought.
  assert.ok(!offered.legendaries || legendaries > 0, `Legendaries offered ${offered.legendaries} times, taken ${legendaries}: ${JSON.stringify(results)}`)
  // Every action the run has, its battles' orders among them (tracks.test.js fuzzes the levels and tiers harder).
  for (const type of ['act', 'buy', 'end', 'fight', 'fuse', 'hold', 'leave', 'move', 'node', 'place', 'reap', 'release', 'unhold', 'upgrade', 'heal', 'transmute', 'consecrate']) assert.ok(seen.has(type), `${type}: ${[...seen]}`)
  assert.ok(big > 0, 'a 2×2 piece fought')
})

// ── the battle in the run (redesign.md §2.3) ─────────────────────────────────────────────────────

// A new run walked into the first battle room it can reach (by the log: replay walks it too).
function atBattle (seed) {
  const run = createRun({ start: START_PARTY, seed })
  const node = availableNodes(run).find((n) => ['fight', 'elite'].includes(n.type))
  apply(run, { type: 'node', id: node.id })
  return run
}

test('a fight opens the battle: its orders are the run\'s actions, each returning its events, and the run replays exactly', () => {
  for (const [k, turn] of [basicTurn, expertTurn].entries()) {
    const run = atBattle(`turnsrun${k}`)
    assert.equal(apply(run, { type: 'fight' }), undefined)
    assert.equal(run.state.phase, 'battle')
    assert.deepEqual(legalActions(run), legalOrders(run.battle))
    assert.throws(() => apply(run, { type: 'release', uid: souls(run.state.party)[0].uid }), 'no other action in battle')
    while (run.state.phase === 'battle') {
      for (const o of turn(run.battle)) {
        const events = apply(run, o)
        assert.ok(Array.isArray(events) && events.length > 0, JSON.stringify(o))
        if (run.state.phase !== 'battle') break
      }
    }
    assert.ok(['reap', 'over'].includes(run.state.phase), run.state.phase)
    assert.ok(run.battle.over && run.state.log.some((a) => a.type === 'end'))
    const again = replay(run.state.seed, run.state.log)
    assert.deepEqual(again.battle.events, run.battle.events)
    assert.deepEqual(again.state, run.state)
  }
})

test('a fusion in battle pays from the purse, its parts leave the party (the relics they held back unheld), its piece joins it and its kind', () => {
  const run = atBattle('fusebattle')
  const s = run.state
  join(run, 'tomb_knight')
  const [a, b] = souls(s.party).filter((u) => u.id === 'tomb_knight')
  const c = souls(s.party).find((u) => u.id === 'bone_chanter')
  for (const u of souls(s.party)) u.slot = OSSUARY
  // Two Knights side by side, the Chanter before the first, and the fourth cell of the Colossus's 2×2 open.
  const slot = [...Array(CAMP_SLOTS).keys()].find((x) => rowOf(x) > 0 && fits(s.camp, x, 2, new Set([monarchSlot(s.camp)])))
  Object.assign(a, { slot })
  Object.assign(b, { slot: slot + 1 })
  Object.assign(c, { slot: slot - COLS })
  s.relics = ['whetstone']
  b.relics = ['whetstone']
  assert.deepEqual(unheld(s), [])
  s.essence = 200
  const spent = s.stats.spent
  const earned = s.stats.essence
  apply(run, { type: 'fight' })
  const o = legalActions(run).find((x) => x.type === 'fuse' && x.uid === a.uid)
  assert.deepEqual([o.id, [...o.parts].sort((x, y) => x - y)], ['bone_colossus', [a.uid, b.uid, c.uid].sort((x, y) => x - y)])
  const price = run.setup.fuse.bone_colossus.price
  assert.equal(price, fuseCost(run, 'bone_colossus'))
  apply(run, o)
  assert.equal(run.battle.purse, 200 - price)
  while (s.phase === 'battle') apply(run, { type: 'end' })
  assert.equal(s.stats.spent, spent + price)
  assert.equal(s.essence, 200 - price + s.stats.essence - earned)
  for (const uid of o.parts) assert.ok(!s.party.some((u) => u.uid === uid), `part ${uid} gone`)
  assert.deepEqual(unheld(s), ['whetstone'], 'its relic back, unheld')
  const piece = s.party.find((u) => u.uid === run.battle.fused[0].uid)
  assert.ok(piece && piece.id === 'bone_colossus' && !piece.relics?.length)
  assert.deepEqual([piece.lvl, piece.tracks], [s.kinds.bone_colossus.lvl, s.kinds.bone_colossus.tracks])
  assert.ok(piece.lvl >= kindLevel(s, 'tomb_knight'))
  assert.equal(piece.slot, piece.hp > 0 ? slot : OSSUARY, 'on the fuser\'s cell, or fallen')
})
