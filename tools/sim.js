#!/usr/bin/env node
// Headless autoplay runs for balance:  node tools/sim.js --runs 100 [--seed s]
import { createRun } from '../src/sim/run.js'
import { autoplay } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/content/index.js'

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name)
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
}
const runs = Number(arg('runs', 100))
const seed0 = arg('seed', 'sim')

const ticks = []
const deaths = {}
let clears = 0
let recruits = 0
let commands = 0
let ceiling = 0
for (let i = 0; i < runs; i++) {
  const seed = `${seed0}-${i}`
  const run = createRun({ seed })
  autoplay(run, {
    rng: createRng(seed).stream('autoplay'),
    onBattle: (b) => {
      ticks.push(b.t)
      if (b.reason === 'tick-ceiling') ceiling++
    }
  })
  const s = run.state
  if (s.result === 'victory') clears++
  else deaths[s.floor] = (deaths[s.floor] ?? 0) + 1
  recruits += s.stats.recruits
  commands += s.stats.commandsSpent
}

ticks.sort((a, b) => a - b)
const q = (p) => ticks[Math.min(ticks.length - 1, Math.floor(p * ticks.length))]
const pct = (n) => `${(100 * n / runs).toFixed(1)}%`
console.log(`runs ${runs} (seed ${seed0})`)
console.log(`clear rate        ${pct(clears)}`)
for (let f = 1; f <= TUNING.run.floors; f++) console.log(`deaths on floor ${f} ${pct(deaths[f] ?? 0)}`)
console.log(`battles           ${ticks.length}, ${(ticks.length / runs).toFixed(1)} per run`)
console.log(`battle ticks      median ${q(0.5)}, p90 ${q(0.9)}, max ${ticks.at(-1)}, at ceiling ${ceiling}`)
console.log(`mean recruits     ${(recruits / runs).toFixed(2)}`)
console.log(`mean commands     ${(commands / runs).toFixed(2)}`)
