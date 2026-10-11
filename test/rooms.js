// Rooms walked into by hand, and their battles fought, for the tests.
import assert from 'node:assert/strict'
import { createRun, apply, availableNodes } from '../src/sim/run.js'
import { expertTurn } from '../src/sim/policy.js'
import { createBattle, order, stalled } from '../src/sim/turns.js'

// Turns the first reachable room into `type` and walks in. A battle room keeps its foes; one that had none gets the
// floor's first battle room's.
export function visit (run, type) {
  const node = availableNodes(run)[0]
  node.type = type
  if (['fight', 'elite', 'boss'].includes(type)) node.foes ??= run.state.map.nodes.find((n) => n.foes).foes
  apply(run, { type: 'node', id: node.id })
  return node
}

// Fights the room the run stands in: `fight` opens the battle, and `policy` (policy.js expertTurn by default; basicTurn
// ends every turn) gives each turn's orders, as the run's actions, until it is over (past the sim's bound on turns, a
// stall, as the autoplayer ends one). Returns the run.
export function fight (run, policy = expertTurn) {
  apply(run, { type: 'fight' })
  while (run.state.phase === 'battle') {
    if (stalled(run.battle)) apply(run, { type: 'stall' })
    else for (const o of policy(run.battle)) {
      if (run.state.phase !== 'battle') break
      apply(run, o)
    }
  }
  return run
}

// A new run, made `ready`, that won its first room of `type` (the first of seeds `prefix`0, 1… to win it, its turns
// the expert's), on its spoils.
export function win (prefix, ready = () => {}, type = 'fight') {
  for (let i = 0; i < 200; i++) {
    const run = createRun({ seed: prefix + i })
    ready(run)
    visit(run, type)
    fight(run)
    if (run.state.phase === 'reap') return run
  }
  assert.fail(`no ${prefix} seed won its ${type}`)
}

// The battle a run's log rebuilds: its setup, and the orders given in it (every action logged after its `fight`).
export function rebuilt (run) {
  const log = run.state.log
  const from = log.findLastIndex((a) => a.type === 'fight')
  const b = createBattle(structuredClone(run.setup))
  for (const o of log.slice(from + 1)) if (!b.over) order(b, o)
  return b
}
