// Rooms walked into by hand, for the tests.
import assert from 'node:assert/strict'
import { createRun, apply, availableNodes } from '../src/sim/run.js'

// Turns the first reachable room into `type` and walks in. A battle room keeps its foes; one that had none gets the
// floor's first battle room's.
export function visit (run, type) {
  const node = availableNodes(run)[0]
  node.type = type
  if (['fight', 'elite', 'boss'].includes(type)) node.foes ??= run.state.map.nodes.find((n) => n.foes).foes
  apply(run, { type: 'node', id: node.id })
  return node
}

// A new run, made `ready`, that won its first room of `type` (the first of seeds `prefix`0, 1… to win it), on its
// spoils.
export function win (prefix, ready = () => {}, type = 'fight') {
  for (let i = 0; i < 200; i++) {
    const run = createRun({ seed: prefix + i })
    ready(run)
    visit(run, type)
    apply(run, { type: 'fight' })
    if (run.state.phase === 'reap') return run
  }
  assert.fail(`no ${prefix} seed won its ${type}`)
}
