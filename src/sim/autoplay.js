// A heuristic player for tests and tools/sim.js. It only calls the same functions the UI calls.
import { createRng } from './rng.js'
import { stepBattle } from './battle.js'
import { canIssue, issueCommand, unleashPick } from './commands.js'
import { livingOn } from './formation.js'
import { availableNodes, chooseNode, finishBattle, pickSpoil, resolveSwap } from './run.js'
import { TUNING } from '../content/index.js'

const hpPct = (u) => u.hp / u.maxHp
const partyHealth = (party) => party.reduce((n, u) => n + hpPct(u), 0) / party.length

function pickNode (run, rng) {
  const nodes = availableNodes(run)
  const health = partyHealth(run.state.party)
  const w = { fight: 3, elite: health > 0.7 ? 1.5 : 0.3, treasure: 2, campfire: health < 0.6 ? 5 : 0.5, boss: 1 }
  return rng.weighted(nodes, nodes.map((n) => w[n.type]))
}

const heals = (ability) => ability?.effects.some((e) => e.op === 'heal')

function command (b, run, state) {
  const party = livingOn(b.units, 'party')
  const foes = livingOn(b.units, 'foe')
  const roster = run.state.party.length + run.state.pending.length
  if (roster < TUNING.party.cap) {
    for (const f of foes) {
      const c = canIssue(b, 'parley', f.uid)
      if (c.ok && c.chance >= 0.25) return issueCommand(b, { verb: 'parley', target: f.uid })
    }
  }
  const low = party.filter((u) => hpPct(u) < 0.35 && !state.helped.has(u.uid)).sort((a, z) => hpPct(a) - hpPct(z))[0]
  if (low) {
    state.helped.add(low.uid)
    const healer = party.find((u) => heals(unleashPick(b, u)))
    return issueCommand(b, healer ? { verb: 'unleash', target: healer.uid } : { verb: 'brace', target: low.uid })
  }
  if (!state.focused && b.t >= 40) {
    state.focused = true
    const target = foes.slice().sort((a, z) => hpPct(a) - hpPct(z))[0]
    return issueCommand(b, { verb: 'focus', target: target.uid })
  }
}

function playBattle (b, run) {
  const state = { focused: false, helped: new Set() }
  while (!b.over) {
    if (b.commandsLeft > 0 && b.t % 5 === 0) command(b, run, state)
    stepBattle(b)
  }
}

function pickOffer (run) {
  const { offers, party } = run.state
  if (!offers.length) return null
  const has = (type) => offers.findIndex((o) => o.type === type)
  const hurt = party.some((u) => u.hp <= 0) || partyHealth(party) < 0.5
  const order = hurt ? ['rest', 'relic', 'drill', 'recruit'] : party.length < 8 ? ['relic', 'recruit', 'drill', 'rest'] : ['relic', 'drill', 'rest']
  for (const type of order) if (has(type) >= 0) return has(type)
  return null
}

// Release a fallen unit for the recruit, else decline.
function pickRelease (run) {
  const fallen = run.state.party.filter((u) => u.hp <= 0).sort((a, z) => a.lvl - z.lvl)[0]
  return fallen ? fallen.uid : null
}

export function autoplay (run, { rng = createRng(run.state.seed).stream('autoplay'), onBattle = null } = {}) {
  const s = run.state
  for (let guard = 0; s.phase !== 'over'; guard++) {
    if (guard > 1000) throw new Error('autoplay is stuck')
    if (s.phase === 'map') chooseNode(run, pickNode(run, rng).id)
    else if (s.phase === 'battle') {
      playBattle(run.battle, run)
      onBattle?.(run.battle, run)
      finishBattle(run)
    } else if (s.phase === 'spoils') pickSpoil(run, pickOffer(run))
    else if (s.phase === 'swap') resolveSwap(run, pickRelease(run))
  }
  return run
}
