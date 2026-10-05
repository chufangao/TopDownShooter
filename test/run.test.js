import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRun, apply, legalActions, availableNodes, replay, join } from '../src/sim/run.js'
import { autoplay, policy } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { RELICS } from '../src/content.js'

const play = (seed) => autoplay(createRun({ seed }), { rng: createRng(seed).stream('autoplay') })
const finish = (run) => apply(run, { type: 'advance', ticks: TUNING.tick.ceiling })

// Turn the first reachable node into `type` so a test can visit one on demand.
function visit (run, type) {
  const node = availableNodes(run)[0]
  node.type = type
  apply(run, { type: 'node', id: node.id })
  return node
}

test('a new run: start party at level 2 on floor 1, standing on the start node', () => {
  const run = createRun({ seed: 'new' })
  const s = run.state
  assert.deepEqual(s.party.map((u) => [u.id, u.lvl]), [['tomb_knight', 2], ['bone_chanter', 2], ['frost_sprite', 2]])
  assert.equal(new Set(s.party.map((u) => u.slot)).size, 3)
  assert.equal(s.phase, 'map')
  assert.equal(s.at, s.map.start)
  assert.ok(availableNodes(run).length >= 2)
})

test('apply refuses illegal actions and leaves the log alone', () => {
  const run = createRun({ seed: 'illegal' })
  const bad = [
    null, { type: 'dance' }, { type: 'node', id: run.state.map.end }, { type: 'spoil', index: 0 },
    { type: 'advance', ticks: 1 }, { type: 'slots', a: 0, b: 12 }, { type: 'slots', a: 3, b: 3 }
  ]
  for (const action of bad) assert.throws(() => apply(run, action), undefined, JSON.stringify(action))
  assert.deepEqual(run.state.log, [])
  visit(run, 'fight')
  assert.throws(() => apply(run, { type: 'advance', ticks: 0 }))
  const foe = run.battle.units.find((u) => u.side === 'foe').uid
  assert.throws(() => apply(run, { type: 'command', verb: 'brace', target: foe }), /target an ally/)
  assert.equal(run.state.log.length, 1)
})

test('legalActions per phase', () => {
  const run = createRun({ seed: 'legal' })
  const kinds = (r) => [...new Set(legalActions(r).map((a) => a.type))].sort()
  assert.deepEqual(kinds(run), ['node', 'slots'])
  visit(run, 'fight')
  assert.deepEqual(kinds(run), ['advance', 'command'])
  assert.ok(legalActions(run).every((a) => a.type !== 'command' || a.verb !== 'parley'), 'no foe is weak enough yet')
  finish(run)
  if (run.state.phase === 'over') return
  assert.deepEqual(kinds(run), ['spoil'])
  assert.deepEqual(legalActions(run).at(-1), { type: 'spoil', index: null })
})

test('consecutive advances log as one entry with the ticks actually stepped', () => {
  const run = createRun({ seed: 'merge' })
  visit(run, 'fight')
  apply(run, { type: 'advance', ticks: 3 })
  apply(run, { type: 'advance', ticks: 4 })
  assert.deepEqual(run.state.log.at(-1), { type: 'advance', ticks: 7 })
  const target = run.battle.units.find((u) => u.side === 'foe').uid
  apply(run, { type: 'command', verb: 'focus', target })
  const events = finish(run)
  assert.ok(events.some((e) => e.type === 'command' && e.t === 7))
  assert.equal(run.state.log.at(-1).ticks, run.battle.t - 7)
  assert.notEqual(run.state.phase, 'battle', 'the run moves on when the battle ends')
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
    else assert.ok(s.party.every((u) => u.hp === 0))
  }
  assert.equal(results.victory + results.defeat, 20)
})

test('replay(seed, log) rebuilds the same final state, battle commands included', () => {
  for (let i = 0; i < 5; i++) {
    const live = play('replay' + i)
    assert.ok(live.state.log.some((e) => e.type === 'command'))
    assert.deepEqual(replay(live.state.seed, live.state.log).state, live.state)
  }
})

test('slots edits the formation, including into empty slots', () => {
  const run = createRun({ seed: 'slots' })
  const [knight, chanter] = run.state.party
  const a = knight.slot
  const b = chanter.slot
  apply(run, { type: 'slots', a, b })
  assert.equal(knight.slot, b)
  assert.equal(chanter.slot, a)
  apply(run, { type: 'slots', a: b, b: 11 })
  assert.equal(knight.slot, 11)
})

test('campfire heals everyone and revives the fallen', () => {
  const run = createRun({ seed: 'fire' })
  const [a, b] = run.state.party
  a.hp = 1
  b.hp = 0
  visit(run, 'campfire')
  assert.equal(run.state.phase, 'map')
  assert.equal(a.hp, a.maxHp)
  assert.equal(b.hp, Math.ceil(b.maxHp * TUNING.run.campfireRevive))
})

test('treasure offers 3 distinct relics; taking one keeps it, skipping takes nothing', () => {
  const run = createRun({ seed: 'gold' })
  visit(run, 'treasure')
  const { offers } = run.state
  assert.equal(run.state.phase, 'spoils')
  assert.equal(offers.length, 3)
  assert.ok(offers.every((o) => o.type === 'relic' && RELICS[o.id]))
  assert.equal(new Set(offers.map((o) => o.id)).size, 3)
  apply(run, { type: 'spoil', index: 1 })
  assert.deepEqual(run.state.relics, [offers[1].id])
  assert.equal(run.state.phase, 'map')
  visit(run, 'treasure')
  assert.ok(!run.state.offers.some((o) => o.id === offers[1].id), 'no duplicate relics')
  apply(run, { type: 'spoil', index: null })
  assert.equal(run.state.relics.length, 1)
})

test('a won fight copies HP back, pays XP, heals survivors and offers spoils', () => {
  const run = createRun({ seed: 'fight' })
  visit(run, 'fight')
  assert.equal(run.state.phase, 'battle')
  finish(run)
  const s = run.state
  assert.equal(s.stats.fights, 1)
  if (run.battle.winner !== 'party') return assert.equal(s.result, 'defeat')
  assert.equal(s.phase, 'spoils')
  assert.ok(s.offers.length >= 1 && s.offers.length <= 3)
  assert.ok(s.party.some((u) => u.hp > 0 && (u.xp > 0 || u.lvl > 2)))
  checkState(s)
})

test('full party: a recruit waits, then the player releases a unit for it or declines', () => {
  for (const decline of [false, true]) {
    let run = null
    for (let i = 0; !run; i++) {
      const r = createRun({ seed: `swap${decline}${i}` })
      while (r.state.party.length < TUNING.party.cap) join(r, 'clockwork_page')
      visit(r, 'fight')
      finish(r)
      if (r.state.phase === 'spoils' && r.state.offers.some((o) => o.type === 'recruit')) run = r
    }
    const s = run.state
    apply(run, { type: 'spoil', index: s.offers.findIndex((o) => o.type === 'recruit') })
    assert.equal(s.phase, 'swap')
    assert.equal(s.pending.length, 1)
    const recruit = s.pending[0]
    const released = s.party[0]
    assert.throws(() => apply(run, { type: 'release', uid: 9999 }))
    apply(run, { type: 'release', uid: decline ? null : released.uid })
    assert.equal(s.phase, 'map')
    assert.equal(s.pending.length, 0)
    assert.equal(s.party.length, TUNING.party.cap)
    assert.equal(s.party.includes(recruit), !decline)
    assert.equal(s.party.includes(released), decline)
    if (!decline) assert.equal(recruit.slot, released.slot)
  }
})

// ── fuzz: random legal actions, invariants after every one, replay at the end ──────────────────

function checkState (s) {
  assert.ok(['map', 'battle', 'spoils', 'swap', 'over'].includes(s.phase), s.phase)
  assert.ok(s.party.length >= 1 && s.party.length <= TUNING.party.cap)
  assert.equal(new Set(s.party.map((u) => u.uid)).size, s.party.length, 'unique uids')
  assert.equal(new Set(s.party.map((u) => u.slot)).size, s.party.length, 'unique slots')
  for (const u of s.party) {
    assert.ok(Number.isInteger(u.slot) && u.slot >= 0 && u.slot < 12, `${u.id} slot ${u.slot}`)
    assert.ok(Number.isInteger(u.hp) && u.hp >= 0 && u.hp <= u.maxHp, `${u.id} hp ${u.hp}/${u.maxHp}`)
    assert.ok(u.lvl >= 1 && u.lvl <= TUNING.xp.cap && u.xp >= 0, `${u.id} lvl ${u.lvl} xp ${u.xp}`)
  }
}

// Half the time the autoplay policy (to get deep into runs), half a uniformly random legal action.
function fuzz (seed) {
  const rng = createRng(seed).stream('fuzz')
  const run = createRun({ seed })
  let steps = 0
  for (const mind = {}; run.state.phase !== 'over'; steps++) {
    assert.ok(steps < 1e5, 'stuck')
    const legal = legalActions(run)
    assert.ok(legal.length > 0)
    let action = rng.chance(0.5) ? null : rng.pick(legal)
    if (action?.type === 'advance') action = { type: 'advance', ticks: 1 + rng.int(60) }
    action ??= policy(run, rng, mind)
    apply(run, action)
    checkState(run.state)
    if (run.state.phase === 'battle') assert.ok(!run.battle.over, 'a finished battle never lingers')
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
