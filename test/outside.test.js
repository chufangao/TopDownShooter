// The outside teacher (src/sim/outside.js, redesign.md §2.23, §6): the expert's choices out of battle made by playing
// their candidates out, offline. Functional only: its base step is the base's, the base's pick is always its first
// candidate, a playout leaves the live run untouched, the same run gives the same choice, a decision of one candidate
// spends no playout, a fight already played gives what it gave, and a cap of 1 plays as the base; never a win or a rate.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  outsideTeacher, outsideStats, candidatesAt, baseStep, prepStep, playout, outsideRun, configOf, beforeOf, outsideReport, outsideLines, PHASES
} from '../src/sim/outside.js'
import { createRun, apply, currentNode, availableNodes, legalActions } from '../src/sim/run.js'
import { policy, autoplay } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'

// sim-10's expert falls on floor 1 after five battles: a whole run in about a second, so a playout to its end is cheap.
// (sim-0 until the pool was flattened, 2026-10-15: its run clears now.)
const SEED = 'sim-10'
const copyOf = (run) => ({ state: structuredClone(run.state), battle: null, setup: null })

// The base's run on `seed`, each step out of battle handed to `visit(run, action)` before it is applied; `until(run)`
// stops it there (the run as it stands, out of battle). → { run, rng }
function walk (seed, { visit = null, until = null } = {}) {
  const run = createRun({ seed })
  const rng = createRng(seed).stream('autoplay')
  while (run.state.phase !== 'over') {
    if (run.state.phase !== 'battle' && until?.(run)) break
    const a = policy(run, rng, 'expert')
    if (run.state.phase !== 'battle') visit?.(run, a)
    apply(run, a)
  }
  return { run, rng }
}
// The run where the base first meets a decision of two candidates or more (in `phase`, where named).
const atDecision = (phase = null, cfg = {}) => walk(SEED, { until: (r) => { const d = candidatesAt(r, cfg); return d.cands?.length >= 2 && (!phase || d.phase === phase) } })
// The action a candidate takes first: its first action, or a formation's first step.
const firstOf = (run, x) => (x.goal ? prepStep(run, x.goal) : x.actions[0])

test('baseStep is the base\'s step out of battle, step for step', () => {
  let n = 0
  walk(SEED, { visit: (run, a) => { n++; assert.deepEqual(baseStep(run), a, `${run.state.phase} step ${n}`) } })
  assert.ok(n > 10)
})

// sim-10's expert meets no altar before it falls: its first map step after a battle, every room open made an altar.
test('at an altar baseStep is the base\'s rite, its pick the first candidate, and the teacher plays the rites out', () => {
  const { run, rng } = walk(SEED, { until: (r) => r.state.phase === 'map' && r.state.log.some((a) => a.type === 'reap') })
  for (const n of availableNodes(run)) n.type = 'altar'
  while (run.state.phase === 'map') apply(run, policy(run, rng, 'expert'))
  assert.equal(run.state.phase, 'altar')
  const a = policy(run, rng, 'expert')
  assert.deepEqual(baseStep(run), a)
  const d = candidatesAt(run, { cap: 4 })
  assert.equal(d.phase, 'altar')
  assert.ok(d.cands.length >= 2 && d.cands.length <= 4)
  assert.deepEqual(firstOf(run, d.cands[0]), a)
  assert.equal(new Set(d.cands.map((x) => x.id)).size, d.cands.length)
  assert.ok(d.cands.every((x) => x.actions.length === 1 && ['heal', 'transmute', 'consecrate'].includes(x.actions[0].type)))
  // Played out a room on: each candidate once, the pick a rite the run takes; with the phase off, the base's.
  const r = copyOf(run)
  const pick = outsideTeacher(r, rng, { cap: 4, rooms: 1 })
  const st = outsideStats(r)
  assert.deepEqual([st.phases.altar.asked, st.phases.altar.decided, st.phases.altar.playouts], [1, 1, d.cands.length])
  assert.ok(legalActions(run).some((x) => JSON.stringify(x) === JSON.stringify(pick)))
  assert.deepEqual(outsideTeacher(copyOf(run), rng, { phases: 'prep,spend,recruit,shop,hold' }), a)
  // The same step the base's run takes: the rite applied, the room is done and the map stands.
  apply(run, a)
  assert.equal(run.state.phase, 'map')
})

test('the base\'s own pick is always the first candidate, and the cap holds', () => {
  const met = new Set()
  walk(SEED, {
    visit: (run, a) => {
      const d = candidatesAt(run, { cap: 4 })
      if (!d.cands) return assert.deepEqual(d.act, a)
      met.add(d.phase)
      assert.ok(d.cands.length >= 1 && d.cands.length <= 4)
      assert.deepEqual(firstOf(run, d.cands[0]), a, `${d.phase}: ${d.cands[0].label}`)
      assert.equal(new Set(d.cands.map((x) => x.id)).size, d.cands.length)
    }
  })
  assert.ok(met.size > 0)
})

test('a playout leaves the live run untouched, and the same run gives the same choice', () => {
  const { run, rng } = atDecision()
  const was = JSON.stringify(run.state)
  const a = copyOf(run)
  const b = copyOf(run)
  const cfg = { rooms: 1 }
  const pa = outsideTeacher(a, rng, cfg)
  const pb = outsideTeacher(b, createRng('another').stream('autoplay'), cfg)
  assert.deepEqual(pa, pb)
  assert.deepEqual(outsideStats(a).last, outsideStats(b).last)
  assert.ok(outsideStats(a).last.cands.every((x) => Number.isFinite(x.value)))
  assert.deepEqual(outsideStats(a).picks, outsideStats(b).picks)
  outsideTeacher(run, rng, cfg)
  assert.equal(JSON.stringify(run.state), was)
  assert.deepEqual(outsideStats(run).last, outsideStats(a).last)
})

test('a decision of one candidate spends no playout', () => {
  const { run, rng } = walk(SEED, { until: (r) => r.state.phase === 'reap' })
  run.state.essence = 0
  assert.deepEqual(outsideTeacher(run, rng), { type: 'reap', index: null })
  const st = outsideStats(run)
  assert.equal(st.phases.recruit.asked, 1)
  assert.equal(st.phases.recruit.decided, 0)
  assert.equal(st.phases.recruit.playouts, 0)
  assert.equal(st.fights, 0)
  // With no phase its own, the teacher is the base and asks nothing.
  const { run: r2, rng: g2 } = atDecision()
  const own = baseStep(r2)
  assert.deepEqual(outsideTeacher(r2, g2, { phases: '' }), own)
  assert.ok(PHASES.every((p) => outsideStats(r2).phases[p].asked === 0))
})

test('a fight already played gives what it gave: the base\'s line a step on ends where it did', () => {
  const { run } = walk(SEED, { until: (r) => r.state.phase === 'map' && r.state.log.length > 0 })
  const c = configOf({})
  const memo = () => ({ ends: new Map(), battles: new Map(), plans: new Map(), goal: null, stats: { fights: 0 } })
  const before = beforeOf(run)
  const own = { actions: [baseStep(run)] }
  const m = memo()
  const fresh = playout(run, own, m, c, before)
  assert.equal(fresh.hit, false)
  assert.ok(fresh.fights > 0 && m.ends.size === fresh.fights)
  const again = playout(run, own, m, c, before)
  assert.equal(again.hit, true)
  assert.equal(again.value, fresh.value)
  const next = copyOf(run)
  apply(next, own.actions[0])
  assert.equal(playout(next, { actions: [] }, m, c, before).value, fresh.value)
  assert.equal(playout(next, { actions: [] }, memo(), c, before).value, fresh.value)
  // An action the run refuses is no candidate's.
  assert.equal(playout(run, { actions: [{ type: 'fight' }] }, m, c, before).value, -Infinity)
})

test('a formation is judged by its coming battle, the base\'s own first', () => {
  const { run, rng } = atDecision('prep')
  const d = candidatesAt(run)
  assert.ok(d.cands.every((x) => Array.isArray(x.goal) && x.actions.length === 0))
  const act = outsideTeacher(run, rng)
  const st = outsideStats(run)
  assert.equal(st.last.phase, 'prep')
  assert.equal(st.phases.prep.playouts, d.cands.length)
  assert.ok(st.last.cands.every((x) => Number.isFinite(x.value)))
  assert.ok(['place', 'fight'].includes(act.type))
})

test('with won, a decision whose base\'s line clears the run plays that line alone and keeps the base\'s pick', () => {
  // sim-1's expert clears: late on the last floor its own line clears from wherever it stands (sim-2 fell on floor 4
  // with the twelve relics in the Shops, sim-1 with Echo at half; on three floors sim-0 falls on floor 3).
  const { run, rng } = walk('sim-1', { until: (r) => r.state.floor === TUNING.run.floors && (currentNode(r)?.rank ?? 0) >= 11 && candidatesAt(r).cands?.length >= 2 })
  const own = baseStep(run)
  assert.deepEqual(outsideTeacher(run, rng, { won: true }), own)
  const st = outsideStats(run)
  const sum = (k) => PHASES.reduce((n, p) => n + st.phases[p][k], 0)
  assert.ok(sum('settled') >= 1)
  assert.equal(sum('overrides'), 0)
  assert.equal(sum('playouts'), sum('settled'))
  assert.equal(configOf({ won: true, rooms: 2 }).won, false)
})

test('a cap of 1 plays as the base, and a run\'s line reads as the report wants it', () => {
  const r = outsideRun(SEED, { cap: 1, log: true })
  const base = autoplay(createRun({ seed: SEED }), { level: 'expert' })
  assert.deepEqual(r.log, base.state.log)
  assert.equal(r.playouts, 0)
  assert.equal(r.decisions, 0)
  assert.deepEqual(r.picks, [])
  assert.equal(r.result, base.state.result)
  const rep = outsideReport([r, { seed: SEED, player: 'expert', result: r.result, floor: r.floor, progress: r.progress, battles: r.battles, ms: 1 }])
  assert.equal(rep.n, 1)
  assert.equal(rep.progress.diff, 0)
  assert.ok(PHASES.every((p) => rep.phases[p].decided === 0))
  assert.ok(outsideLines(rep).length > 5)
  assert.throws(() => configOf({ phases: 'prep,route' }))
})
