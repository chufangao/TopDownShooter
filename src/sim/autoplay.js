import { createRng } from './rng.js'
import { canIssue, unleashPick } from './battle.js'
import { livingOn } from './unit.js'
import { createRun, apply, availableNodes } from './run.js'
import { TUNING } from '../tuning.js'

// A heuristic player for tests and balance runs: a policy that picks one action at a time for apply().
// Run directly for a balance report:  node src/sim/autoplay.js [--runs 200] [--seed sim]

const hpPct = (u) => u.hp / u.maxHp
const partyHealth = (party) => party.reduce((n, u) => n + hpPct(u), 0) / party.length
const heals = (ability) => ability?.effects.some((e) => e.op === 'heal')
const CHECK_EVERY = 5

function pickNode (run, rng) {
  const nodes = availableNodes(run)
  const health = partyHealth(run.state.party)
  const w = { fight: 3, elite: health > 0.7 ? 1.5 : 0.3, treasure: 2, campfire: health < 0.6 ? 5 : 0.5, boss: 1 }
  return { type: 'node', id: rng.weighted(nodes, nodes.map((n) => w[n.type])).id }
}

// At most one Command per check: parley a weak foe, save a dying ally, then focus once late on.
function pickCommand (run, mind) {
  const b = run.battle
  const party = livingOn(b.units, 'party')
  const foes = livingOn(b.units, 'foe')
  const cmd = (verb, target) => ({ type: 'command', verb, target })
  if (run.state.party.length + run.state.pending.length < TUNING.party.cap) {
    for (const f of foes) {
      const c = canIssue(b, 'parley', f.uid)
      if (c.ok && c.chance >= 0.25) return cmd('parley', f.uid)
    }
  }
  const low = party.filter((u) => hpPct(u) < 0.35 && !mind.helped.has(u.uid)).sort((a, z) => hpPct(a) - hpPct(z))[0]
  if (low) {
    mind.helped.add(low.uid)
    const healer = party.find((u) => heals(unleashPick(b, u)))
    return healer ? cmd('unleash', healer.uid) : cmd('brace', low.uid)
  }
  if (!mind.focused && b.t >= 40) {
    mind.focused = true
    return cmd('focus', foes.slice().sort((a, z) => hpPct(a) - hpPct(z))[0].uid)
  }
  return null
}

function pickOffer (run) {
  const { offers, party } = run.state
  const hurt = party.some((u) => u.hp <= 0) || partyHealth(party) < 0.5
  const order = hurt ? ['rest', 'relic', 'drill', 'recruit'] : party.length < 8 ? ['relic', 'recruit', 'drill', 'rest'] : ['relic', 'drill', 'rest']
  for (const type of order) {
    const i = offers.findIndex((o) => o.type === type)
    if (i >= 0) return { type: 'spoil', index: i }
  }
  return { type: 'spoil', index: null }
}

// Release the lowest-level fallen unit for the recruit, else turn it away.
function pickRelease (run) {
  const fallen = run.state.party.filter((u) => u.hp <= 0).sort((a, z) => a.lvl - z.lvl)[0]
  return { type: 'release', uid: fallen ? fallen.uid : null }
}

export function policy (run, rng, mind) {
  const s = run.state
  if (s.phase === 'map') return pickNode(run, rng)
  if (s.phase === 'spoils') return pickOffer(run)
  if (s.phase === 'swap') return pickRelease(run)
  const b = run.battle
  if (mind.battle !== b) Object.assign(mind, { battle: b, focused: false, helped: new Set(), checked: -1 })
  if (b.commandsLeft > 0 && mind.checked !== b.t) {
    mind.checked = b.t
    const c = pickCommand(run, mind)
    if (c) return c
  }
  return { type: 'advance', ticks: CHECK_EVERY }
}

// Plays the run to the end. onBattle(battle, run) fires after each battle, once the run has moved on.
export function autoplay (run, { rng = createRng(run.state.seed).stream('autoplay'), onBattle = null } = {}) {
  const mind = {}
  for (let guard = 0; run.state.phase !== 'over'; guard++) {
    if (guard > 1e5) throw new Error('autoplay is stuck')
    const action = policy(run, rng, mind)
    apply(run, action)
    if (action.type === 'advance' && run.battle.over) onBattle?.(run.battle, run)
  }
  return run
}

// ── balance report ─────────────────────────────────────────────────────────────────────────────

// Autoplays `runs` seeded runs and prints clear rate, battle length and per-floor progression.
function report ({ runs, seed: seed0 }) {
  const ticks = []
  const deaths = {}
  const floors = {} // floor (B = boss) → sums at the start of each battle there
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
        const party = b.units.filter((u) => u.side === 'party')
        const foes = b.units.filter((u) => u.side === 'foe')
        const f = (floors[b.floor + (b.boss ? 'B' : '')] ??= { n: 0, lvl: 0, size: 0, foes: 0, relics: 0, won: 0 })
        f.n++
        f.lvl += party.reduce((n, u) => n + u.lvl, 0) / party.length
        f.size += party.length
        f.foes += foes.length
        f.relics += run.state.relics.length
        f.won += b.winner === 'party' ? 1 : 0
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
  console.log('\nper floor, averaged over battles fought there (party as it entered the battle):')
  console.log('floor  battles  won    party lvl  fielded  foes  relics')
  for (const [k, f] of Object.entries(floors)) {
    const avg = (v) => (v / f.n).toFixed(1)
    console.log(`${k.padEnd(5)}  ${String(f.n).padStart(7)}  ${pct(f.won * runs / f.n).padStart(5)}  ${avg(f.lvl).padStart(9)}  ${avg(f.size).padStart(7)}  ${avg(f.foes).padStart(4)}  ${avg(f.relics).padStart(6)}`)
  }
}

if (typeof process !== 'undefined' && process.argv[1] === decodeURIComponent(new URL(import.meta.url).pathname)) {
  const arg = (name, def) => {
    const i = process.argv.indexOf('--' + name)
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
  }
  report({ runs: Number(arg('runs', 200)), seed: arg('seed', 'sim') })
}
