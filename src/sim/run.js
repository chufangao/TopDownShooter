// The run: a state machine over map → battle → spoils (→ swap) → map, floor by floor. Every player
// input is logged, so replay(seed, log) rebuilds the same state.
import { TUNING, UNIT_LIST, unitDef, relicDef } from '../content/index.js'
import { createRng } from './rng.js'
import { makeUnit, baseStats } from './stats.js'
import { autoPlace, slotAt, SLOTS } from './formation.js'
import { createBattle, runBattle } from './battle.js'
import { generateFloor, nodeOf } from './map.js'
import { rollOffers, applyOffer } from './spoils.js'

export const START_PARTY = ['tomb_knight', 'bone_chanter', 'frost_sprite']
export const START_LEVEL = 2
const BATTLE_NODES = ['fight', 'elite', 'boss']
const BOSS = UNIT_LIST.find((u) => u.boss).id

export function createRun ({ seed }) {
  const state = {
    seed, floor: 1, phase: 'map', map: null, at: null, party: [], relics: [], offers: [], pending: [],
    result: null, stats: { fights: 0, wins: 0, recruits: 0, commandsSpent: 0, floorsCleared: 0 }, log: [], nextUid: 1
  }
  state.party = autoPlace(START_PARTY.map((id) => makeUnit(id, { uid: state.nextUid++, lvl: START_LEVEL })))
  const run = { state, battle: null }
  enterFloor(run)
  return run
}

function enterFloor (run) {
  const s = run.state
  s.map = generateFloor({ seed: s.seed, floor: s.floor, last: s.floor === TUNING.run.floors })
  s.at = s.map.start
  s.phase = 'map'
}

function need (run, phase) {
  if (run.state.phase !== phase) throw new Error(`run is in phase "${run.state.phase}", not "${phase}"`)
}

export const currentNode = (run) => nodeOf(run.state.map, run.state.at)

export function availableNodes (run) {
  if (run.state.phase !== 'map') return []
  return currentNode(run).next.map((id) => nodeOf(run.state.map, id))
}

export function chooseNode (run, id) {
  need(run, 'map')
  const node = availableNodes(run).find((n) => n.id === id)
  if (!node) throw new Error(`node "${id}" is not reachable`)
  const s = run.state
  s.log.push({ op: 'node', id })
  s.at = id
  if (BATTLE_NODES.includes(node.type)) {
    run.battle = startBattle(run, node)
    s.phase = 'battle'
  } else if (node.type === 'treasure') {
    s.offers = rollOffers(run, { kind: 'treasure' })
    s.phase = 'spoils'
  } else if (node.type === 'campfire') {
    const t = TUNING.run
    for (const u of s.party) u.hp = u.hp > 0 ? Math.max(u.hp, Math.round(u.maxHp * t.campfireHeal)) : Math.ceil(u.maxHp * t.campfireRevive)
    advance(run)
  } else {
    throw new Error(`unknown node type "${node.type}"`)
  }
}

const relics = (run) => run.state.relics.map(relicDef)
export const commandsFor = (run) => TUNING.commands.perBattle + relics(run).reduce((n, r) => n + (r.commands ?? 0), 0)

export function foeLevel (floor) {
  return Math.max(1, Math.round(1 + (floor - 1) * TUNING.spawn.levelPerFloor))
}

// Spawnable units for a floor with weights shaped toward the floor's target tier.
export function spawnPool (floor, tierBias = 0) {
  const sp = TUNING.spawn
  const target = Math.min(sp.tierMax, 1 + Math.floor((floor - 1) * sp.tierPerFloor)) + tierBias
  const units = UNIT_LIST.filter((u) => u.spawn && u.spawn.minFloor <= floor && u.tier <= target + sp.tierOverCap)
  return { units, weights: units.map((u) => u.spawn.weight / Math.pow(1 + Math.abs(u.tier - target), sp.tierFalloff)) }
}

function makeFoes (run, node) {
  const s = run.state
  const sp = TUNING.spawn
  const rng = createRng(s.seed).stream(`foes|${s.floor}|${node.id}`)
  const elite = node.type === 'elite'
  const lvl = foeLevel(s.floor) + (elite ? sp.eliteLevel : 0)
  if (node.type === 'boss') return [makeUnit(BOSS, { uid: s.nextUid++, lvl, side: 'foe', slot: slotAt(0, 1) })]
  const { units, weights } = spawnPool(s.floor, elite ? sp.eliteTier : 0)
  const n = elite ? sp.elite : sp.fight
  return autoPlace(Array.from({ length: n }, () => makeUnit(rng.weighted(units, weights).id, { uid: s.nextUid++, lvl, side: 'foe' })))
}

// Foes grow with depth beyond their level, so a recruited party still meets real fights.
export function foeMods (floor) {
  const at = (list) => list[Math.min(floor, list.length) - 1]
  return [
    { path: 'hp', op: 'mul', v: at(TUNING.spawn.foeHp) },
    { path: 'atk', op: 'mul', v: at(TUNING.spawn.foeAtk) }
  ]
}

function startBattle (run, node) {
  const s = run.state
  return createBattle({
    party: s.party,
    foes: makeFoes(run, node),
    seed: `${s.seed}|${s.floor}|${node.id}`,
    floor: s.floor,
    boss: node.type === 'boss',
    partyMods: relics(run).flatMap((r) => r.mods ?? []),
    foeMods: node.type === 'boss' ? [] : foeMods(s.floor),
    commands: commandsFor(run),
    braceTicks: TUNING.commands.braceTicks + relics(run).reduce((n, r) => n + (r.brace ?? 0), 0)
  })
}

export const xpToNext = (lvl) => Math.round(TUNING.xp.base * Math.pow(Math.max(1, lvl), TUNING.xp.exponent))
const defeatXp = (u) => Math.round(TUNING.xp.perTier * unitDef(u.id).tier * (1 + TUNING.xp.perLevel * (u.lvl - 1)))

// A level-up raises maxHp and heals by the difference; the fallen stay at 0.
export function setLevel (u, lvl) {
  const before = u.maxHp
  u.lvl = Math.min(TUNING.xp.cap, lvl)
  u.maxHp = baseStats(u.id, u.lvl).hp
  if (u.hp > 0) u.hp = Math.min(u.maxHp, u.hp + u.maxHp - before)
}

function gainXp (u, amount) {
  u.xp += amount
  while (u.lvl < TUNING.xp.cap && u.xp >= xpToNext(u.lvl)) {
    u.xp -= xpToNext(u.lvl)
    setLevel(u, u.lvl + 1)
  }
}

export function medianLevel (party) {
  const lv = party.map((u) => u.lvl).sort((a, b) => a - b)
  return lv.length ? lv[Math.floor((lv.length - 1) / 2)] : START_LEVEL
}

// Adds a new unit at the party's median level, or queues it in `pending` when the party is full.
export function join (run, id, { uid = run.state.nextUid++, frac = 1 } = {}) {
  const s = run.state
  const u = makeUnit(id, { uid, lvl: medianLevel(s.party) })
  u.hp = Math.max(1, Math.round(u.maxHp * frac))
  s.stats.recruits++
  if (s.party.length < TUNING.party.cap) {
    s.party.push(u)
    autoPlace(s.party)
  } else s.pending.push(u)
  return u
}

export function finishBattle (run) {
  need(run, 'battle')
  const b = run.battle
  if (!b.over) throw new Error('battle is not over')
  const s = run.state
  s.log.push({ op: 'finish', commands: b.commandLog.map((c) => ({ ...c })) })
  const byUid = new Map(b.units.map((u) => [u.uid, u]))
  for (const u of s.party) {
    const bu = byUid.get(u.uid)
    if (bu) u.hp = bu.hp > 0 ? Math.max(1, Math.round(bu.hp / bu.maxHp * u.maxHp)) : 0
  }
  s.stats.fights++
  s.stats.commandsSpent += commandsFor(run) - b.commandsLeft
  if (b.winner !== 'party' || !s.party.some((u) => u.hp > 0)) {
    s.phase = 'over'
    s.result = 'defeat'
    return
  }
  s.stats.wins++
  const xp = b.units.filter((u) => u.side === 'foe' && (u.hp <= 0 || u.left)).reduce((n, u) => n + defeatXp(u), 0)
  for (const u of s.party) {
    if (u.hp <= 0) continue
    gainXp(u, xp)
    u.hp = Math.min(u.maxHp, u.hp + Math.ceil(u.maxHp * TUNING.run.postBattleHeal))
  }
  for (const uid of b.recruited) {
    const bu = byUid.get(uid)
    join(run, bu.id, { uid, frac: Math.max(TUNING.run.recruitMinHp, bu.hp / bu.maxHp) })
  }
  const node = currentNode(run)
  if (node.type === 'boss') {
    s.stats.floorsCleared++
    s.phase = 'over'
    s.result = 'victory'
    return
  }
  s.offers = rollOffers(run, { kind: node.type })
  s.phase = 'spoils'
}

export function pickSpoil (run, index = null) {
  need(run, 'spoils')
  const s = run.state
  if (index !== null && !s.offers[index]) throw new Error(`no offer ${index}`)
  s.log.push({ op: 'spoil', index })
  if (index !== null) applyOffer(run, s.offers[index])
  s.offers = []
  if (s.pending.length) s.phase = 'swap'
  else advance(run)
}

// Party full and a recruit waiting: release a unit for it (it takes the released slot), or decline (null).
export function resolveSwap (run, releaseUid = null) {
  need(run, 'swap')
  const s = run.state
  const i = releaseUid === null ? -1 : s.party.findIndex((u) => u.uid === releaseUid)
  if (releaseUid !== null && i < 0) throw new Error(`no party unit ${releaseUid}`)
  s.log.push({ op: 'swap', release: releaseUid })
  const recruit = s.pending.shift()
  if (i >= 0) {
    recruit.slot = s.party[i].slot
    s.party.splice(i, 1, recruit)
  }
  if (!s.pending.length) advance(run)
}

export function swapSlots (run, a, b) {
  need(run, 'map')
  const ok = (x) => Number.isInteger(x) && x >= 0 && x < SLOTS
  if (!ok(a) || !ok(b) || a === b) throw new Error(`bad slots ${a}, ${b}`)
  const s = run.state
  s.log.push({ op: 'slots', a, b })
  const ua = s.party.find((u) => u.slot === a)
  const ub = s.party.find((u) => u.slot === b)
  if (ua) ua.slot = b
  if (ub) ub.slot = a
}

function advance (run) {
  const s = run.state
  s.phase = 'map'
  if (s.at !== s.map.end) return
  s.stats.floorsCleared++
  s.floor++
  enterFloor(run)
}

export function replay (seed, log) {
  const run = createRun({ seed })
  for (const e of log) {
    if (e.op === 'node') chooseNode(run, e.id)
    else if (e.op === 'finish') {
      runBattle(run.battle, { commands: e.commands })
      finishBattle(run)
    } else if (e.op === 'spoil') pickSpoil(run, e.index)
    else if (e.op === 'swap') resolveSwap(run, e.release)
    else if (e.op === 'slots') swapSlots(run, e.a, e.b)
    else throw new Error(`unknown log entry "${e.op}"`)
  }
  return run
}
