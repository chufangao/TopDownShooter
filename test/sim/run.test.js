// The run loop (§1 loop B) — and the boundary it exists to hold.
//
// `sim/run.js` was extracted from `DungeonScene` because the run had grown inside the only thing
// that was drawing one. These tests pin the contract that made the extraction worth doing: the run
// decides everything, `arriveAt()` returns a finished report, and a run plays identically with no
// renderer anywhere near it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks } from '../../tools/packsource.node.js'
import { createRun, playRun, arriveAt, BATTLE_NODES, STARTING_PARTY } from '../../src/sim/run.js'
import { medianLevel } from '../../src/sim/party.js'

const { kernel, tuning } = await createGame({ packs: discoverPacks('packs'), seed: 1 })
const newRun = (seed = 1) => (kernel.defs.restore({ uid: 1 }), createRun({ kernel, tuning, seed }))

// ── shape ───────────────────────────────────────────────────────────────────────────────────────

test('a run starts short-handed — the party you finish with is the one you talked into joining', () => {
  const run = newRun()
  assert.equal(run.state.roster.length, STARTING_PARTY.length)
  assert.ok(run.state.roster.length < tuning.party.cap)
  assert.equal(run.state.floorNum, 1)
  assert.equal(run.state.over, false)
})

test('the serialisable half holds no derived state (§14)', () => {
  const run = newRun()
  run.enterFloor()
  // `floor` and `route` are regenerated from (seed, floorNum). Persisting them would be storing a
  // derivation and inviting it to drift from the generator that made it.
  assert.ok(!('floor' in run.state) && !('route' in run.state))
  assert.ok(run.floor && run.route.length)
  assert.doesNotThrow(() => JSON.stringify(run.state))
})

test('entering a floor is idempotent — the same floor comes back', () => {
  const run = newRun()
  const a = run.enterFloor()
  const b = run.enterFloor()
  assert.deepEqual(a.nodes, b.nodes)
  assert.deepEqual([...a.tiles], [...b.tiles])
})

test('descending advances the run onto a different floor', () => {
  const run = newRun()
  run.enterFloor()
  const first = run.floor
  assert.equal(run.descend(), true)
  assert.equal(run.state.floorNum, 2)
  assert.equal(run.state.deepest, 2)
  assert.notDeepEqual([...run.floor.tiles], [...first.tiles])
})

// ── the report is the whole output surface ──────────────────────────────────────────────────────

test('every node returns a report, and a battle node carries a finished timeline', () => {
  const run = newRun()
  run.enterFloor()
  const battleNode = run.nodes().find((n) => BATTLE_NODES[n.type])
  assert.ok(battleNode, 'a floor must contain something to fight')

  const report = arriveAt(run, battleNode)
  assert.equal(report.type, battleNode.type)
  assert.ok(report.battle.result.events.length > 1)
  assert.ok(report.battle.result.hash, 'the timeline must be hashable — it is the determinism fixture')
  assert.ok(Array.isArray(report.awards) && Array.isArray(report.joined))
  assert.equal(typeof report.wiped, 'boolean')
})

test('a quiet node reports nothing happening rather than throwing', () => {
  const run = newRun()
  run.enterFloor()
  const quiet = run.nodes().find((n) => !BATTLE_NODES[n.type] && n.type !== 'campfire')
  if (!quiet) return
  const report = arriveAt(run, quiet)
  assert.equal(report.battle, null)
  assert.equal(report.healed, 0)
  assert.equal(report.wiped, false)
})

test('a campfire is the only place on a floor the fallen get back up (§6.1)', () => {
  const run = newRun()
  run.enterFloor()
  for (const u of run.state.roster) u.hp = 0
  const report = arriveAt(run, { x: 0, y: 0, type: 'campfire' })
  assert.equal(report.revived, run.state.roster.length)
  assert.ok(run.state.roster.every((u) => u.hp > 0))
})

test('visiting a node is counted once, by the run and not by the renderer', () => {
  const run = newRun()
  run.enterFloor()
  assert.equal(run.state.visited, 0)
  arriveAt(run, { x: 0, y: 0, type: 'treasure' })
  arriveAt(run, { x: 1, y: 0, type: 'treasure' })
  assert.equal(run.state.visited, 2)
})

// ── the run ends ────────────────────────────────────────────────────────────────────────────────

test('a wipe ends the run, and the report says so before anything is drawn', () => {
  let wipes = 0
  for (let s = 0; s < 30 && wipes === 0; s++) {
    const run = newRun(9000 + s)
    const out = playRun(run, { maxFloors: 8 })
    if (out.reason === 'wipe') {
      wipes++
      assert.equal(run.state.over, true)
      assert.ok(run.state.roster.every((u) => u.hp <= 0))
      assert.equal(out.reports.at(-1).wiped, true)
    }
  }
  assert.ok(wipes > 0, 'no seed wiped in 30 runs — the run has no teeth at all')
})

test('a run that survives its last floor reports clearing rather than wiping', () => {
  for (let s = 0; s < 30; s++) {
    const out = playRun(newRun(1000 + s), { maxFloors: 3 })
    if (out.reason !== 'wipe') {
      assert.equal(out.reason, 'cleared')
      assert.equal(out.run.state.deepest, 3)
      return
    }
  }
  assert.fail('no seed cleared three floors')
})

test('nothing keeps resolving after the run is over', () => {
  const run = newRun()
  run.enterFloor()
  run.state.over = true
  assert.equal(run.descend(), false)
  assert.equal(run.state.floorNum, 1)
})

// ── the payoff ──────────────────────────────────────────────────────────────────────────────────

test('★ a whole run is deterministic with no renderer in sight (§18.5)', () => {
  const fingerprint = (seed) => {
    const out = playRun(newRun(seed), { maxFloors: 4 })
    return [
      out.reason,
      out.run.state.deepest,
      medianLevel(out.run.state.roster),
      out.reports.map((r) => r.battle?.result.hash ?? r.type).join(',')
    ].join('|')
  }
  assert.equal(fingerprint(31), fingerprint(31))
  assert.notEqual(fingerprint(31), fingerprint(32))
})

test('★ the run loop has exactly one implementation', async () => {
  // The scene walks node by node so it can animate between them; `playRun` walks the same
  // functions in a loop. If those two ever diverge, the browser and the balance harness are
  // playing different games — which is precisely the bug this file was extracted to make
  // impossible, so it is worth asserting rather than trusting.
  const { readFileSync } = await import('node:fs')
  const scene = readFileSync('src/engine/scenes/DungeonScene.js', 'utf8')

  for (const banned of ['runBattle', 'awardXp', 'addRecruits', 'makeFoes', 'generateFloor', 'postBattleHeal']) {
    assert.ok(!scene.includes(banned + '('),
      `DungeonScene calls ${banned}() — run logic has leaked back into the renderer (§8)`)
  }
  assert.ok(scene.includes('arriveAt('), 'the scene should be driving the run through its report API')
})
