// The run: a state machine over map → prep → reap → map, floor by floor.
// apply(run, action) is the only way to change it, legalActions(run) lists what apply accepts now,
// and the log of applied actions replays the run exactly: replay(seed, log).
//
// Battles take no input. The player's part is the retinue: which souls stand in the camp, where, and
// which are merged. Each floor draws its camp, a 7×7 walled layout, on arrival. `fight` resolves the
// whole battle at once; run.setup is what it was built from, so the UI can play it back tick by tick.
//
//   phase            action
//   map              { type: 'node', id }          walk to a connected room (a battle room opens prep)
//   map, prep        { type: 'place', uid, slot }  move a soul to an open camp slot (0–48) or the bench
//                                                  (−1); a soul already there takes the mover's old place
//   map, prep        { type: 'merge', id, star }   merge the strongest copies of a soul into one of star + 1
//   map, prep, reap  { type: 'release', uid }      let a soul go (never the last one standing)
//   prep             { type: 'fight' }             the battle plays out; the run moves on by itself
//   reap             { type: 'reap', index }       bind offer `index` (a soul or a relic), or null to skip
//   over             none
import { TUNING } from '../tuning.js'
import { UNIT_LIST, relicDef, unitDef, RELIC_LIST, CAMP_LIST } from '../content.js'
import { createRng } from './rng.js'
import { makeUnit, autoPlace, slotAt, CAMP_SLOTS, baseStats, onField, CENTRE_OUT, campGrid, campOpen, wallTiles } from './unit.js'
import { createBattle, runBattle } from './battle.js'
import { generateFloor, nodeOf } from './map.js'

export const START_PARTY = ['tomb_knight', 'bone_chanter', 'frost_sprite']
const START_LEVEL = 2
const BATTLE_NODES = ['fight', 'elite', 'boss']
const BOSS = UNIT_LIST.find((u) => u.boss).id

export function createRun ({ seed }) {
  const state = {
    seed, floor: 1, phase: 'map', map: null, camp: null, at: null, party: [], relics: [], offers: [],
    result: null, stats: { fights: 0, wins: 0, reaped: 0, merges: 0, floorsCleared: 0 }, log: [], nextUid: 1
  }
  state.party = START_PARTY.map((id) => makeUnit(id, { uid: state.nextUid++, lvl: START_LEVEL }))
  const run = { state, battle: null, setup: null }
  enterFloor(run)
  autoPlace(state.party, { grid: campGrid(state.camp) })
  return run
}

export function replay (seed, log) {
  const run = createRun({ seed })
  for (const action of log) apply(run, action)
  return run
}

// Applies one action, or throws if it is not legal now.
export function apply (run, action) {
  const s = run.state
  const handler = HANDLERS[action?.type]
  if (!handler) throw new Error(`unknown action "${action?.type}"`)
  if (!handler.phases.includes(s.phase)) throw new Error(`"${action.type}" needs phase ${handler.phases.join('/')}, run is in "${s.phase}"`)
  handler.run(run, action)
  s.log.push({ ...action })
}

export function legalActions (run) {
  const s = run.state
  if (s.phase === 'map') return [...availableNodes(run).map((n) => ({ type: 'node', id: n.id })), ...rosterActions(run)]
  if (s.phase === 'prep') return [...(canFight(s) ? [{ type: 'fight' }] : []), ...rosterActions(run)]
  if (s.phase === 'reap') {
    const offers = s.offers.flatMap((o, index) => (canTake(run, o) ? [{ type: 'reap', index }] : []))
    return [...offers, { type: 'reap', index: null }, ...releasable(s).map((u) => ({ type: 'release', uid: u.uid }))]
  }
  return []
}

function rosterActions (run) {
  const s = run.state
  const out = []
  for (const u of s.party) {
    for (let slot = -1; slot < CAMP_SLOTS; slot++) if (canPlace(run, u, slot)) out.push({ type: 'place', uid: u.uid, slot })
  }
  out.push(...mergeable(s.party).map(({ id, star }) => ({ type: 'merge', id, star })))
  out.push(...releasable(s).map((u) => ({ type: 'release', uid: u.uid })))
  return out
}

export const currentNode = (run) => nodeOf(run.state.map, run.state.at)

export function availableNodes (run) {
  if (run.state.phase !== 'map') return []
  return currentNode(run).next.map((id) => nodeOf(run.state.map, id))
}

const relicDefs = (s) => s.relics.map(relicDef)
const relicSum = (s, key) => relicDefs(s).reduce((n, r) => n + (r[key] ?? 0), 0)
export const fieldCap = (run) => TUNING.party.field + relicSum(run.state, 'field')
export const fielded = (party) => party.filter(onField)
export const benched = (party) => party.filter((u) => !onField(u))

// ── the retinue: placing, merging, releasing ─────────────────────────────────────────────────────

function canPlace (run, u, slot) {
  if (slot === u.slot || (slot !== -1 && !campOpen(run.state.camp, slot))) return false
  const other = slot >= 0 && run.state.party.find((x) => x.slot === slot)
  return onField(u) || !!other || fielded(run.state.party).length < fieldCap(run)
}

// Kinds with enough copies at one star to merge: [{ id, star }].
export function mergeable (party) {
  const n = new Map()
  for (const u of party) n.set(`${u.id}|${u.star}`, (n.get(`${u.id}|${u.star}`) ?? 0) + 1)
  const out = []
  for (const [key, count] of n) {
    const [id, star] = key.split('|')
    if (count >= TUNING.star.copies && Number(star) < TUNING.star.max) out.push({ id, star: Number(star) })
  }
  return out
}

// Releasing must leave someone who can still fight.
const releasable = (s) => s.party.length > 1 ? s.party.filter((u) => s.party.some((x) => x !== u && x.hp > 0)) : []

const canFight = (s) => s.party.some((u) => onField(u) && u.hp > 0)

// A new soul takes a free field slot if there is one, else waits on the bench.
export function join (run, id, { lvl = medianLevel(run.state.party), uid = run.state.nextUid++ } = {}) {
  const s = run.state
  if (s.party.length >= TUNING.party.roster) throw new Error('the retinue is full')
  const u = makeUnit(id, { uid, lvl: Math.min(TUNING.xp.cap, lvl) })
  s.party.push(u)
  if (fielded(s.party).length < fieldCap(run)) autoPlace([...fielded(s.party), u], { grid: campGrid(s.camp) })
  return u
}

// ── action handlers ──────────────────────────────────────────────────────────────────────────────

const HANDLERS = {
  node: { phases: ['map'], run: walk },
  place: { phases: ['map', 'prep'], run: place },
  merge: { phases: ['map', 'prep'], run: merge },
  release: { phases: ['map', 'prep', 'reap'], run: release },
  fight: { phases: ['prep'], run: fight },
  reap: { phases: ['reap'], run: reap }
}

function walk (run, { id }) {
  const node = availableNodes(run).find((n) => n.id === id)
  if (!node) throw new Error(`node "${id}" is not reachable`)
  const s = run.state
  s.at = id
  if (BATTLE_NODES.includes(node.type)) {
    s.phase = 'prep'
  } else if (node.type === 'reliquary') {
    s.offers = relicOffers(s, 3)
    s.phase = 'reap'
  } else if (node.type === 'altar') {
    const t = TUNING.run
    for (const u of s.party) u.hp = u.hp > 0 ? Math.max(u.hp, Math.round(u.maxHp * t.altarHeal)) : Math.ceil(u.maxHp * t.altarRevive)
    nextRoom(run)
  } else {
    throw new Error(`unknown node type "${node.type}"`)
  }
}

function place (run, { uid, slot }) {
  const s = run.state
  const u = s.party.find((x) => x.uid === uid)
  if (!u) throw new Error(`no soul ${uid}`)
  if (!canPlace(run, u, slot)) throw new Error(`cannot place ${uid} at ${slot}`)
  const other = slot >= 0 ? s.party.find((x) => x.slot === slot) : null
  if (other) other.slot = u.slot
  u.slot = slot
}

// The strongest copies merge into the strongest one, which stands where the frontmost of them stood.
function merge (run, { id, star }) {
  const s = run.state
  if (!mergeable(s.party).some((m) => m.id === id && m.star === star)) throw new Error(`cannot merge ${id} ★${star}`)
  const copies = s.party.filter((u) => u.id === id && u.star === star)
    .sort((a, b) => b.lvl - a.lvl || b.xp - a.xp || a.uid - b.uid)
    .slice(0, TUNING.star.copies)
  const [keep, ...gone] = copies
  const slots = copies.map((u) => u.slot).filter((x) => x >= 0).sort((a, b) => a - b)
  s.party = s.party.filter((u) => !gone.includes(u))
  keep.star++
  keep.slot = slots[0] ?? -1
  keep.maxHp = baseStats(keep.id, keep.lvl, keep.star).hp
  keep.hp = keep.maxHp
  s.stats.merges++
}

function release (run, { uid }) {
  const s = run.state
  if (!releasable(s).some((u) => u.uid === uid)) throw new Error(`cannot release ${uid}`)
  s.party = s.party.filter((u) => u.uid !== uid)
}

function fight (run) {
  const s = run.state
  if (!canFight(s)) throw new Error('nobody standing on the field')
  run.setup = battleSetup(run)
  s.nextUid += run.setup.foes.length
  run.battle = createBattle(run.setup)
  runBattle(run.battle)
  finishBattle(run)
}

function reap (run, { index }) {
  const s = run.state
  const o = index === null ? null : s.offers[index]
  if (index !== null && !o) throw new Error(`no offer ${index}`)
  if (o && !canTake(run, o)) throw new Error('the retinue is full: release a soul first')
  if (o?.type === 'relic') s.relics.push(o.id)
  else if (o?.type === 'soul') {
    join(run, o.id, { lvl: o.lvl })
    s.stats.reaped++
  }
  s.offers = []
  nextRoom(run)
}

const canTake = (run, o) => o.type !== 'soul' || run.state.party.length < TUNING.party.roster

// ── internals ────────────────────────────────────────────────────────────────────────────────────

// Every battle room's foes are fixed when the floor is made, so the map can show them. The floor's camp
// is drawn from its list; souls standing on its walls move to open ground.
function enterFloor (run) {
  const s = run.state
  s.map = generateFloor({ seed: s.seed, floor: s.floor, last: s.floor === TUNING.run.floors })
  s.camp = createRng(s.seed).stream(`camp|${s.floor}`).pick(CAMP_LIST.filter((c) => c.floor === s.floor)).id
  autoPlace(fielded(s.party), { grid: campGrid(s.camp) })
  for (const n of s.map.nodes) if (BATTLE_NODES.includes(n.type)) n.foes = encounter(s.seed, s.floor, n)
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

// A room's foes as [{ id, lvl, slot }]: drawn from the floor's pool, each in its role's row. They fill
// the middle lanes first, each band of lanes (centre three, then the next pair out…) in shuffled order.
export function encounter (seed, floor, node) {
  const sp = TUNING.spawn
  const lvl = foeLevel(floor)
  if (node.type === 'boss') return [{ id: BOSS, lvl, slot: slotAt(0, CENTRE_OUT[0]) }]
  const rng = createRng(seed).stream(`foes|${floor}|${node.id}`)
  const elite = node.type === 'elite'
  const { units, weights } = spawnPool(floor, elite ? sp.eliteTier : 0)
  const n = at(elite ? sp.elite : sp.fight, floor)
  const foes = Array.from({ length: n }, () => ({ id: rng.weighted(units, weights).id, lvl: lvl + (elite ? sp.eliteLevel : 0), slot: -1 }))
  const cols = [CENTRE_OUT.slice(0, 3), ...[3, 5].map((i) => CENTRE_OUT.slice(i, i + 2))].flatMap((band) => rng.shuffle(band))
  return autoPlace(foes, { cols })
}

// What createBattle needs in the current room, with copies of the fielded souls so the UI can rebuild
// the same battle. Leaves the run untouched: the foes take the next free uids, and fight() claims them.
// `party` and `seed` override the fielded souls and the room's seed, for a rehearsal.
export function battleSetup (run, { party = fielded(run.state.party), seed = null } = {}) {
  const s = run.state
  const node = currentNode(run)
  const boss = node.type === 'boss'
  return {
    party: party.map((u) => ({ ...u })),
    foes: node.foes.map((f, i) => makeUnit(f.id, { uid: s.nextUid + i, lvl: f.lvl, slot: f.slot })),
    seed: seed ?? `${s.seed}|${s.floor}|${node.id}`,
    floor: s.floor,
    boss,
    camp: s.camp,
    walls: wallTiles(s.camp),
    partyMods: relicDefs(s).flatMap((r) => r.mods ?? []),
    foeMods: foeMods(s.floor, boss)
  }
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
  if (b.winner !== 'party') {
    s.phase = 'over'
    s.result = 'defeat'
    return
  }
  s.stats.wins++
  const xp = battleXp(b)
  for (const u of s.party) {
    if (u.hp <= 0) continue
    if (byUid.has(u.uid)) gainXp(u, xp)
    u.hp = Math.min(u.maxHp, u.hp + Math.ceil(u.maxHp * TUNING.run.postBattleHeal))
  }
  const node = currentNode(run)
  if (node.type === 'boss') {
    s.stats.floorsCleared++
    s.phase = 'over'
    s.result = 'victory'
    return
  }
  s.offers = [...soulOffers(run, b), ...(node.type === 'elite' ? relicOffers(s, 1) : [])]
  s.phase = 'reap'
}

// ── progression: the retinue ─────────────────────────────────────────────────────────────────────

export const xpToNext = (lvl) => Math.round(TUNING.xp.base * Math.pow(Math.max(1, lvl), TUNING.xp.exponent))
const defeatXp = (u) => Math.round(TUNING.xp.perTier * unitDef(u.id).tier * (1 + TUNING.xp.perLevel * (u.lvl - 1)))

// XP every fielded survivor of a won battle gets (in full, not split): the sum over foes slain.
const battleXp = (battle) => battle.units.filter((u) => u.side === 'foe' && u.hp <= 0).reduce((n, u) => n + defeatXp(u), 0)

// A level-up raises maxHp and heals by the difference; the fallen stay at 0.
function setLevel (u, lvl) {
  const before = u.maxHp
  u.lvl = Math.min(TUNING.xp.cap, lvl)
  u.maxHp = baseStats(u.id, u.lvl, u.star).hp
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

// ── progression: the foes ────────────────────────────────────────────────────────────────────────

const at = (list, floor) => list[Math.min(floor, list.length) - 1]

export const foeLevel = (floor) => Math.max(1, Math.round(1 + (floor - 1) * TUNING.spawn.levelPerFloor))

// Spawnable units for a floor, weighted toward the floor's target tier.
function spawnPool (floor, tierBias = 0) {
  const sp = TUNING.spawn
  const target = Math.min(sp.tierMax, 1 + Math.floor((floor - 1) * sp.tierPerFloor)) + tierBias
  const units = UNIT_LIST.filter((u) => u.spawn && u.spawn.minFloor <= floor && u.tier <= target + sp.tierOverCap)
  return { units, weights: units.map((u) => u.spawn.weight / Math.pow(1 + Math.abs(u.tier - target), sp.tierFalloff)) }
}

export function foeMods (floor, boss) {
  const sp = TUNING.spawn
  return [
    { path: 'hp', op: 'mul', v: boss ? sp.bossHp : at(sp.foeHp, floor) },
    { path: 'atk', op: 'mul', v: boss ? sp.bossAtk : at(sp.foeAtk, floor) }
  ]
}

// ── rewards ──────────────────────────────────────────────────────────────────────────────────────

// One soul offer per kind of foe slain, rising at the retinue's median level.
function soulOffers (run, battle) {
  const s = run.state
  const lvl = Math.min(TUNING.xp.cap, medianLevel(s.party) + relicSum(s, 'soulLevel'))
  const ids = [...new Set(battle.units.filter((u) => u.side === 'foe' && u.hp <= 0).map((u) => u.id))]
  return ids.map((id) => {
    const d = unitDef(id)
    return { type: 'soul', id, lvl, name: d.name, desc: `Rises at level ${lvl}.` }
  })
}

function relicOffers (s, n) {
  const rng = createRng(s.seed).stream(`relics|${s.floor}|${s.at}`)
  return rng.shuffle(RELIC_LIST.filter((r) => !s.relics.includes(r.id)))
    .slice(0, n)
    .map((r) => ({ type: 'relic', id: r.id, name: r.name, desc: r.desc }))
}
