// The run: a state machine over map → battle → spoils (→ swap) → map, floor by floor.
// apply(run, action) is the only way to change it, legalActions(run) lists what apply accepts now,
// and the log of applied actions replays the run exactly: replay(seed, log).
//
//   phase    action
//   map      { type: 'node', id }               walk to a connected room
//            { type: 'slots', a, b }            swap two formation slots (at least one occupied)
//   battle   { type: 'command', verb, target }  Focus, Parley, Brace or Unleash, issued at the current tick
//            { type: 'advance', ticks }         step the fight; when it ends the run moves on by itself
//   spoils   { type: 'spoil', index }           take offer `index`, or null to skip
//   swap     { type: 'release', uid }           release a unit for the waiting recruit, or null to turn it away
//   over     none
import { TUNING } from '../tuning.js'
import { UNIT_LIST, relicDef, unitDef, RELIC_LIST } from '../content.js'
import { createRng } from './rng.js'
import { makeUnit, autoPlace, slotAt, SLOTS, baseStats } from './unit.js'
import { createBattle, stepBattle, VERBS, canIssue, issueCommand } from './battle.js'
import { generateFloor, nodeOf } from './map.js'

export const START_PARTY = ['tomb_knight', 'bone_chanter', 'frost_sprite']
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

export function replay (seed, log) {
  const run = createRun({ seed })
  for (const action of log) apply(run, action)
  return run
}

// Applies one action, or throws if it is not legal now. Returns the battle events it caused.
export function apply (run, action) {
  const s = run.state
  const handler = HANDLERS[action?.type]
  if (!handler) throw new Error(`unknown action "${action?.type}"`)
  if (handler.phase !== s.phase) throw new Error(`"${action.type}" needs phase "${handler.phase}", run is in "${s.phase}"`)
  const last = s.log.at(-1)
  const entry = { ...action }
  const events = handler.run(run, action, entry) ?? []
  // Consecutive advances log as one, so a live battle stepped frame by frame logs like a scripted one.
  if (entry.type === 'advance' && last?.type === 'advance') last.ticks += entry.ticks
  else s.log.push(entry)
  return events
}

export function legalActions (run) {
  const s = run.state
  if (s.phase === 'map') {
    const out = availableNodes(run).map((n) => ({ type: 'node', id: n.id }))
    const used = new Set(s.party.map((u) => u.slot))
    for (let a = 0; a < SLOTS; a++) {
      for (let b = a + 1; b < SLOTS; b++) if (used.has(a) || used.has(b)) out.push({ type: 'slots', a, b })
    }
    return out
  }
  if (s.phase === 'battle') {
    const out = [{ type: 'advance', ticks: 1 }]
    for (const verb of VERBS) {
      for (const u of run.battle.units) if (canIssue(run.battle, verb, u.uid).ok) out.push({ type: 'command', verb, target: u.uid })
    }
    return out
  }
  if (s.phase === 'spoils') return [...s.offers.map((_, index) => ({ type: 'spoil', index })), { type: 'spoil', index: null }]
  if (s.phase === 'swap') return [...s.party.map((u) => ({ type: 'release', uid: u.uid })), { type: 'release', uid: null }]
  return []
}

export const currentNode = (run) => nodeOf(run.state.map, run.state.at)

export function availableNodes (run) {
  if (run.state.phase !== 'map') return []
  return currentNode(run).next.map((id) => nodeOf(run.state.map, id))
}

const relicDefs = (s) => s.relics.map(relicDef)
const relicSum = (s, key) => relicDefs(s).reduce((n, r) => n + (r[key] ?? 0), 0)
export const commandsFor = (run) => TUNING.commands.perBattle + relicSum(run.state, 'commands')

// Adds a unit at the party's median level, or queues it in `pending` when the party is full.
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

// ── action handlers ──────────────────────────────────────────────────────────────────────────────

const HANDLERS = {
  node: { phase: 'map', run: walk },
  slots: { phase: 'map', run: swapSlots },
  command: { phase: 'battle', run: command },
  advance: { phase: 'battle', run: advance },
  spoil: { phase: 'spoils', run: pickSpoil },
  release: { phase: 'swap', run: release }
}

function walk (run, { id }) {
  const node = availableNodes(run).find((n) => n.id === id)
  if (!node) throw new Error(`node "${id}" is not reachable`)
  const s = run.state
  s.at = id
  if (BATTLE_NODES.includes(node.type)) {
    run.battle = startBattle(run, node)
    s.phase = 'battle'
  } else if (node.type === 'treasure') {
    s.offers = rollOffers(s, 'treasure')
    s.phase = 'spoils'
  } else if (node.type === 'campfire') {
    const t = TUNING.run
    for (const u of s.party) u.hp = u.hp > 0 ? Math.max(u.hp, Math.round(u.maxHp * t.campfireHeal)) : Math.ceil(u.maxHp * t.campfireRevive)
    nextRoom(run)
  } else {
    throw new Error(`unknown node type "${node.type}"`)
  }
}

function swapSlots (run, { a, b }) {
  const s = run.state
  const ok = (x) => Number.isInteger(x) && x >= 0 && x < SLOTS
  const ua = s.party.find((u) => u.slot === a)
  const ub = s.party.find((u) => u.slot === b)
  if (!ok(a) || !ok(b) || a === b || (!ua && !ub)) throw new Error(`bad slots ${a}, ${b}`)
  if (ua) ua.slot = b
  if (ub) ub.slot = a
}

function command (run, { verb, target }) {
  const r = issueCommand(run.battle, { verb, target })
  if (!r.ok) throw new Error(`${verb}: ${r.reason}`)
}

// Logs the ticks actually stepped, which is fewer than asked when the battle ends.
function advance (run, { ticks }, entry) {
  if (!Number.isInteger(ticks) || ticks < 1) throw new Error(`bad tick count ${ticks}`)
  const b = run.battle
  const events = []
  const from = b.t
  while (!b.over && b.t - from < ticks) events.push(...stepBattle(b))
  entry.ticks = b.t - from
  if (b.over) finishBattle(run)
  return events
}

function pickSpoil (run, { index }) {
  const s = run.state
  if (index !== null && !s.offers[index]) throw new Error(`no offer ${index}`)
  if (index !== null) takeOffer(run, s.offers[index])
  s.offers = []
  if (s.pending.length) s.phase = 'swap'
  else nextRoom(run)
}

// The recruit takes the released unit's slot.
function release (run, { uid }) {
  const s = run.state
  const i = uid === null ? -1 : s.party.findIndex((u) => u.uid === uid)
  if (uid !== null && i < 0) throw new Error(`no party unit ${uid}`)
  const recruit = s.pending.shift()
  if (i >= 0) {
    recruit.slot = s.party[i].slot
    s.party.splice(i, 1, recruit)
  }
  if (!s.pending.length) nextRoom(run)
}

// ── internals ────────────────────────────────────────────────────────────────────────────────────

function enterFloor (run) {
  const s = run.state
  s.map = generateFloor({ seed: s.seed, floor: s.floor, last: s.floor === TUNING.run.floors })
  s.at = s.map.start
  s.phase = 'map'
}

function nextRoom (run) {
  const s = run.state
  s.phase = 'map'
  if (s.at !== s.map.end) return
  s.stats.floorsCleared++
  s.floor++
  enterFloor(run)
}

function makeFoes (run, node) {
  const s = run.state
  const sp = TUNING.spawn
  const rng = createRng(s.seed).stream(`foes|${s.floor}|${node.id}`)
  const elite = node.type === 'elite'
  const lvl = foeLevel(s.floor) + (elite ? sp.eliteLevel : 0)
  if (node.type === 'boss') return [makeUnit(BOSS, { uid: s.nextUid++, lvl, slot: slotAt(0, 1) })]
  const { units, weights } = spawnPool(s.floor, elite ? sp.eliteTier : 0)
  const n = elite ? sp.elite : sp.fight
  return autoPlace(Array.from({ length: n }, () => makeUnit(rng.weighted(units, weights).id, { uid: s.nextUid++, lvl })))
}

function startBattle (run, node) {
  const s = run.state
  return createBattle({
    party: s.party,
    foes: makeFoes(run, node),
    seed: `${s.seed}|${s.floor}|${node.id}`,
    floor: s.floor,
    boss: node.type === 'boss',
    partyMods: relicDefs(s).flatMap((r) => r.mods ?? []),
    foeMods: node.type === 'boss' ? [] : foeMods(s.floor),
    commands: commandsFor(run),
    braceTicks: TUNING.commands.braceTicks + relicSum(s, 'brace')
  })
}

function finishBattle (run) {
  const b = run.battle
  const s = run.state
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
  const xp = battleXp(b)
  for (const u of s.party.filter((u) => u.hp > 0)) {
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
  s.offers = rollOffers(s, node.type)
  s.phase = 'spoils'
}

function takeOffer (run, o) {
  const s = run.state
  const t = TUNING.run
  if (o.type === 'relic') {
    if (!s.relics.includes(o.id)) s.relics.push(o.id)
  } else if (o.type === 'drill') {
    for (const u of s.party) setLevel(u, u.lvl + 1)
  } else if (o.type === 'rest') {
    for (const u of s.party) u.hp = u.hp > 0 ? Math.max(u.hp, Math.ceil(u.maxHp * t.restHeal)) : Math.ceil(u.maxHp * t.restRevive)
  } else if (o.type === 'recruit') {
    join(run, o.id)
  } else {
    throw new Error(`unknown offer "${o.type}"`)
  }
}

const START_LEVEL = 2

// ── progression: the party ───────────────────────────────────────────────────────────────────────

export const xpToNext = (lvl) => Math.round(TUNING.xp.base * Math.pow(Math.max(1, lvl), TUNING.xp.exponent))
const defeatXp = (u) => Math.round(TUNING.xp.perTier * unitDef(u.id).tier * (1 + TUNING.xp.perLevel * (u.lvl - 1)))

// XP every survivor of a won battle gets (in full, not split): the sum over foes killed or recruited.
const battleXp = (battle) =>
  battle.units.filter((u) => u.side === 'foe' && (u.hp <= 0 || u.left)).reduce((n, u) => n + defeatXp(u), 0)

// A level-up raises maxHp and heals by the difference; the fallen stay at 0.
function setLevel (u, lvl) {
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

function medianLevel (party) {
  const lv = party.map((u) => u.lvl).sort((a, b) => a - b)
  return lv.length ? lv[Math.floor((lv.length - 1) / 2)] : START_LEVEL
}

// ── progression: the foes ────────────────────────────────────────────────────────────────────────

export const foeLevel = (floor) => Math.max(1, Math.round(1 + (floor - 1) * TUNING.spawn.levelPerFloor))

// Spawnable units for a floor, weighted toward the floor's target tier.
function spawnPool (floor, tierBias = 0) {
  const sp = TUNING.spawn
  const target = Math.min(sp.tierMax, 1 + Math.floor((floor - 1) * sp.tierPerFloor)) + tierBias
  const units = UNIT_LIST.filter((u) => u.spawn && u.spawn.minFloor <= floor && u.tier <= target + sp.tierOverCap)
  return { units, weights: units.map((u) => u.spawn.weight / Math.pow(1 + Math.abs(u.tier - target), sp.tierFalloff)) }
}

// Stat multipliers for ordinary foes on a floor (the boss has its own numbers).
function foeMods (floor) {
  const at = (list) => list[Math.min(floor, list.length) - 1]
  return [
    { path: 'hp', op: 'mul', v: at(TUNING.spawn.foeHp) },
    { path: 'atk', op: 'mul', v: at(TUNING.spawn.foeAtk) }
  ]
}

// ── spoils ───────────────────────────────────────────────────────────────────────────────────────

// 1-of-3 rewards after a win or at a treasure room. Skipping is always allowed.

const TYPES = ['relic', 'drill', 'rest', 'recruit']

function offer (type, rng, s, relics) {
  if (type === 'relic') {
    const r = relics.shift()
    return r && { type, id: r.id, name: r.name, desc: r.desc }
  }
  if (type === 'drill') return { type, name: 'Drill', desc: 'Every unit gains a level.' }
  if (type === 'rest') {
    const t = TUNING.run
    return { type, name: 'Rest', desc: `Heal everyone to at least ${t.restHeal * 100}% and revive the fallen at ${t.restRevive * 100}%.` }
  }
  const { units, weights } = spawnPool(s.floor)
  const def = rng.weighted(units, weights)
  return { type, id: def.id, name: def.name, desc: `${def.name} (${def.kin}, ${def.role}) joins at level ${medianLevel(s.party)}.` }
}

// kind: the room just cleared (fight, elite, treasure).
function rollOffers (s, kind) {
  const rng = createRng(s.seed).stream(`spoils|${s.floor}|${s.at}`)
  const relics = rng.shuffle(RELIC_LIST.filter((r) => !s.relics.includes(r.id)))
  const out = []
  const add = (o) => o && out.push(o)
  if (kind === 'treasure') for (let i = 0; i < 3; i++) add(offer('relic', rng, s, relics))
  if (kind === 'elite') add(offer('relic', rng, s, relics))
  let types = TYPES.filter((t) => !out.some((o) => o.type === t))
  while (out.length < 3 && types.length) {
    const type = rng.weighted(types, types.map((t) => TUNING.spoils[t]))
    types = types.filter((t) => t !== type)
    add(offer(type, rng, s, relics))
  }
  return out
}
