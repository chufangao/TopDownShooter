// The formation by the solver (solver.js bestFormation): the coming battle solved once a candidate formation, the best
// fielded, its line the battle's. Functional only: which candidate it takes and that the battle is not solved twice,
// never how often it wins.
import './budget.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bestFormation, openingOf, solve, solverTurn, useSolverHook, useFormationHook, boardHash } from '../src/sim/solver.js'
import { createRun, apply, availableNodes, souls, START_PARTY } from '../src/sim/run.js'
import { createBattle } from '../src/sim/turns.js'
import { slotAt, monarchSlot } from '../src/sim/unit.js'
import { record, planFor, LEVELS } from '../src/sim/autoplay.js'

// A run in prep before a fight with one Tomb Knight, and two formations of it: the Monarch alone (nothing of yours but
// the Monarch standing: lost as the battle opens) and the whole party where it stands.
function prepRun (seed = 'formation-0') {
  const run = createRun({ start: START_PARTY, seed })
  const node = availableNodes(run)[0]
  node.type = 'fight'
  node.foes = [{ id: 'tomb_knight', lvl: 1, slot: slotAt(0, 3) }]
  apply(run, { type: 'node', id: node.id })
  const m = { uid: 0, slot: monarchSlot(run.state.camp) }
  return { run, alone: [m], all: [m, ...souls(run.state.party).map((u) => ({ uid: u.uid, slot: u.slot }))] }
}

test('a won formation is fielded before a lost one, today\'s pick first or not; two alike, the first; the cap solves the first alone', () => {
  const { run, alone, all } = prepRun()
  const was = JSON.stringify(run.state)
  assert.equal(openingOf(run, alone).reason, 'overrun')
  assert.ok(!openingOf(run, all).over)
  const r = bestFormation(run, [{ goal: alone }, { goal: all }], { budget: 20000 })
  assert.equal(JSON.stringify(run.state), was, 'the run untouched')
  assert.deepEqual([r.index, r.stats[0].won, r.stats[0].value, r.stats[1].won], [1, false, -10, true])
  assert.ok(r.stats[1].value > -10 && r.stats[1].plans > 0)
  assert.equal(bestFormation(run, [{ goal: all }, { goal: alone }], { budget: 20000 }).index, 0)
  // Two alike, solved alike (the prep's budget the battle's): the second does not better the first, and is not taken.
  const twins = bestFormation(run, [{ goal: all }, { goal: all.map((p) => ({ ...p })) }], { budget: Number(process.env.RETINUE_SOLVER_BUDGET) })
  assert.equal(twins.index, 0)
  assert.equal(bestFormation(run, [{ goal: alone }, { goal: all }], { cap: 1 }).stats.length, 1)
})

test('the battle that opens on the formation chosen takes its line: its first turn the prep\'s, the battle not solved again', () => {
  const { run, alone, all } = prepRun()
  const r = bestFormation(run, [{ goal: alone }, { goal: all }], { budget: 20000 })
  assert.equal(r.index, 1)
  // The line the prep found: the candidate's battle solved at the prep's budget, nothing to better (the first was lost).
  const line = solve(openingOf(run, all), { budget: 20000, cap: Infinity, slack: false }).line
  const seen = []
  const off = useSolverHook(({ stats }) => seen.push(stats))
  try {
    apply(run, { type: 'fight' })
    assert.equal(boardHash(run.battle), line[0].hash)
    assert.deepEqual(solverTurn(run.battle), line[0].orders)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].prep, true)
    // Taken once: the same board again is solved afresh.
    solverTurn(createBattle(structuredClone(run.setup)))
    assert.equal(seen.length, 2)
    assert.equal(seen[1].prep, undefined)
  } finally {
    off()
  }
})

// A pick's line is kept where it is today's pick's (solved as the battle would be) or won; any other battle is solved
// afresh at its own budget.
test('the expert fields the solver\'s pick: a formation solved a prep, each battle on a kept line not solved again', () => {
  const preps = []
  const firsts = []
  let kept = null
  const offs = [
    useFormationHook(({ index, stats }) => {
      preps.push({ index, n: stats.length })
      kept = index === 0 || stats[index].won
    }),
    useSolverHook(({ stats }, battle) => {
      if (firsts.some((x) => x.battle === battle)) return
      firsts.push({ battle, kept, prep: !!stats.prep })
      kept = null
    })
  ]
  let r
  try {
    r = record({ seed: 'formation-1', level: 'expert' })
  } finally {
    for (const off of offs) off()
  }
  assert.ok(r.battles.length > 0)
  assert.ok(preps.length >= r.battles.length, 'a formation solved a battle')
  assert.ok(preps.every((p) => p.n >= 1 && p.index >= 0 && p.index < p.n))
  assert.equal(firsts.length, r.battles.length)
  for (const x of firsts) assert.equal(x.prep, x.kept, 'a battle on a kept line takes it, any other is solved')
  assert.ok(firsts.some((x) => x.prep))
})

// Under the formation ablation the expert's souls stand in basic's first draft's cells (ablation.test.js): no solve.
test('basic and the formation ablation solve no formation; the expert one a prep', () => {
  const { run } = prepRun('formation-2')
  let n = 0
  const off = useFormationHook(() => n++)
  try {
    planFor(run, { ...LEVELS.expert, ablate: 'formation' })
    planFor({ ...run, state: structuredClone(run.state) }, LEVELS.basic)
    assert.equal(n, 0)
    planFor({ ...run, state: structuredClone(run.state) }, LEVELS.expert)
    assert.equal(n, 1)
  } finally {
    off()
  }
})
