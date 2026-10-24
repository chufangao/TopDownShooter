// The bench's worker thread: a job a message. `play` a seeded expert run kept as its battles' setups (boards.mjs);
// `probe` the weaker plays from a board (probeOf); `solve` a board solved by a variant's solver as the environment
// configures it, with the budget given and no slack read. Each src tree's modules are imported once a thread.
import { parentPort } from 'node:worker_threads'
import { REPO_SRC, lineDigest } from './lib.mjs'

const trees = new Map()
const tree = (src) => {
  if (!trees.has(src)) {
    trees.set(src, Promise.all([import(`${src}/sim/solver.js`), import(`${src}/sim/turns.js`)])
      .then(([solver, turns]) => ({ solver, turns })))
  }
  return trees.get(src)
}

async function play ({ seed, budget }) {
  process.env.RETINUE_SOLVER_BUDGET = String(budget)
  process.env.RETINUE_SOLVER_SLACK = '0'
  const { record } = await import(`${REPO_SRC}/sim/reports.js`)
  const { unitDef } = await import(`${REPO_SRC}/content.js`)
  const { solverKnobs } = await import(`${REPO_SRC}/sim/solver.js`)
  const r = record({ seed, level: 'expert', setups: true })
  const battles = r.battles.map((b, index) => {
    const s = b.setup
    const sentries = [...s.foes, ...s.reserve].filter((u) => unitDef(u.id)?.hold).length
    return {
      seed, index, floor: s.floor, room: b.room, kind: s.boss ? 'boss' : b.room, boss: s.boss ? b.boss ?? null : null,
      rank: b.rank, size: b.size, sentries, sentry: sentries > 0, camp: s.camp, foes: s.foes.length + s.reserve.length,
      won: b.won, setup: s
    }
  })
  return { seed, result: r.result, floor: r.floor, secs: r.secs, knobs: solverKnobs(), battles }
}

async function probe ({ src, board }) {
  const { turns } = await tree(src)
  const { probeOf } = await import(`${src}/sim/reports.js`)
  return probeOf(turns.createBattle(structuredClone(board.setup)))
}

async function solve ({ src, board, budget }) {
  process.env.RETINUE_SOLVER_BUDGET = String(budget)
  process.env.RETINUE_SOLVER_SLACK = '0'
  const { solver, turns } = await tree(src)
  const battle = turns.createBattle(structuredClone(board.setup))
  const t0 = performance.now()
  const r = solver.solve(battle)
  const ms = Math.round(performance.now() - t0)
  const s = r.stats
  return {
    solved: s.solved, level: s.level, plans: s.plans, nodes: s.nodes, truncated: s.truncated, margin: s.margin,
    value: s.value, turns: s.turns, ms, line: lineDigest(r.line)
  }
}

const KINDS = { play, probe, solve }
parentPort.on('message', async (job) => {
  try {
    parentPort.postMessage({ job, res: await KINDS[job.kind](job) })
  } catch (err) {
    parentPort.postMessage({ job, error: String(err?.stack ?? err) })
  }
})
