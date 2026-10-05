import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRun, availableNodes, chooseNode, finishBattle, pickSpoil, resolveSwap, swapSlots, replay, join
} from '../src/sim/run.js'
import { runBattle } from '../src/sim/battle.js'
import { autoplay } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING, RELICS } from '../src/content/index.js'

const play = (seed) => autoplay(createRun({ seed }), { rng: createRng(seed).stream('autoplay') })

// Turn the first reachable node into `type` so a test can visit one on demand.
function visit (run, type) {
  const node = availableNodes(run)[0]
  node.type = type
  chooseNode(run, node.id)
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
  assert.throws(() => chooseNode(run, s.map.end))
  assert.throws(() => pickSpoil(run, 0))
})

test('autoplay finishes 20 seeded runs with a sane final state', () => {
  const results = { victory: 0, defeat: 0 }
  for (let i = 0; i < 20; i++) {
    const s = play('auto' + i).state
    assert.equal(s.phase, 'over')
    results[s.result]++
    assert.ok(s.party.length <= TUNING.party.cap)
    for (const u of s.party) assert.ok(Number.isInteger(u.hp) && u.hp >= 0 && u.hp <= u.maxHp, `${u.id} hp ${u.hp}/${u.maxHp}`)
    assert.ok(s.stats.wins <= s.stats.fights)
    if (s.result === 'victory') assert.equal(s.stats.floorsCleared, TUNING.run.floors)
    else assert.ok(s.party.every((u) => u.hp === 0))
  }
  assert.equal(results.victory + results.defeat, 20)
})

test('replay(seed, log) rebuilds the same final state, battle commands included', () => {
  for (let i = 0; i < 5; i++) {
    const live = play('replay' + i)
    assert.ok(live.state.log.some((e) => e.op === 'finish' && e.commands.length))
    assert.deepEqual(replay(live.state.seed, live.state.log).state, live.state)
  }
})

test('swapSlots edits the formation, including into empty slots, and replays', () => {
  const run = createRun({ seed: 'slots' })
  const [knight, chanter] = run.state.party
  const a = knight.slot
  const b = chanter.slot
  swapSlots(run, a, b)
  assert.equal(knight.slot, b)
  assert.equal(chanter.slot, a)
  swapSlots(run, b, 11)
  assert.equal(knight.slot, 11)
  assert.throws(() => swapSlots(run, 0, 12))
  assert.deepEqual(replay('slots', run.state.log).state, run.state)
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
  pickSpoil(run, 1)
  assert.deepEqual(run.state.relics, [offers[1].id])
  assert.equal(run.state.phase, 'map')
  visit(run, 'treasure')
  assert.ok(!run.state.offers.some((o) => o.id === offers[1].id), 'no duplicate relics')
  pickSpoil(run, null)
  assert.equal(run.state.relics.length, 1)
  assert.deepEqual(run.state.log.filter((e) => e.op === 'spoil'), [{ op: 'spoil', index: 1 }, { op: 'spoil', index: null }])
})

test('a won fight copies HP back, heals survivors and offers spoils', () => {
  const run = createRun({ seed: 'fight' })
  visit(run, 'fight')
  assert.equal(run.state.phase, 'battle')
  assert.throws(() => finishBattle(run), /not over/)
  runBattle(run.battle)
  finishBattle(run)
  const s = run.state
  assert.equal(s.stats.fights, 1)
  if (run.battle.winner !== 'party') return assert.equal(s.result, 'defeat')
  assert.equal(s.phase, 'spoils')
  assert.ok(s.offers.length >= 1 && s.offers.length <= 3)
  for (const u of s.party) assert.ok(u.hp >= 0 && u.hp <= u.maxHp)
})

test('full party: a recruit waits, then the player releases a unit for it or declines', () => {
  for (const decline of [false, true]) {
    let run = null
    for (let i = 0; !run; i++) {
      const r = createRun({ seed: `swap${decline}${i}` })
      while (r.state.party.length < TUNING.party.cap) join(r, 'clockwork_page')
      visit(r, 'fight')
      runBattle(r.battle)
      finishBattle(r)
      if (r.state.phase === 'spoils' && r.state.offers.some((o) => o.type === 'recruit')) run = r
    }
    const s = run.state
    const offer = s.offers.findIndex((o) => o.type === 'recruit')
    pickSpoil(run, offer)
    assert.equal(s.phase, 'swap')
    assert.equal(s.pending.length, 1)
    const recruit = s.pending[0]
    const released = s.party[0]
    assert.throws(() => resolveSwap(run, 9999))
    resolveSwap(run, decline ? null : released.uid)
    assert.equal(s.phase, 'map')
    assert.equal(s.pending.length, 0)
    assert.equal(s.party.length, TUNING.party.cap)
    assert.equal(s.party.includes(recruit), !decline)
    assert.equal(s.party.includes(released), decline)
    if (!decline) assert.equal(recruit.slot, released.slot)
  }
})
