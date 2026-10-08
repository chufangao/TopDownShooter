// The run: a state machine over map → prep → reap → map, floor by floor.
// apply(run, action) is the only way to change it, legalActions(run) lists what apply accepts now,
// and the log of applied actions replays the run exactly: replay(seed, log).
//
// Battles take no input. The player's part is the retinue: which souls it recruits, keeps and lets go,
// what it spends its essence on, and which souls stand in the camp, where. Slain foes pay essence; it
// buys levels, path tiers, recruits and the Monarch's stats. Each floor draws its camp, a 7×7 walled
// layout, on arrival.
//
// The Monarch is you: a party unit with uid MONARCH_UID that stands in the camp like a soul but can never
// be benched, released, levelled or upgraded, and counts toward no cap. Its level is the points bought
// for Dominion (its domain's reach), Command (banners: the field cap) and Will (Arise's raises and their
// tier), and its HP grows with it. If it falls, the battle is lost and so is the run.
//
// The army: every soul is a captain, and a fielded captain may lead a cohort of rank-and-file, bodies of
// one kind whose kin or role matches its own, kept as counts in the ossuary (standing and fallen) and all
// fighting at the muster level. Up to Command bodies a cohort, never more of a kind than stand; at most
// TUNING.army.board bodies take the board, and the rest wait in reserve to enter beside the Monarch. After
// a win the slain may be bound into the ossuary, the first 1 + Will free.
//
// Ranks: a captain fed standing bodies of its kin is promoted, Soldier → Knight → Marshal (u.grade 0–2,
// TUNING.ranks). A Knight may take tier IV on its path or tier I of a second path; a Marshal both, and the
// second path's tiers II–III; in battle a Marshal's banner keeps to orders within its own domain.
//
// Orders: captains may be grouped into detachments (up to TUNING.army.detachments), each with a plan:
// where (Hunt, Stay, or Move to a square, a board tile) and when (at once, at a time, or when the Monarch
// is struck, a wave enters or a body falls). A cohort goes with its captain. A detachment that starts later
// waits off the board (its bodies count toward no cap there) and enters beside the Monarch when its start
// comes. Every soul in no detachment Hunts, at once. The battle carries the plans out (battle.js).
//
// Keystones: rules that rewrite the game (KEYSTONE_LIST), offered free at won elites and at rites from floor
// TUNING.keystone.fromFloor, never one the run holds, up to TUNING.keystone.max a run (s.keystones). Most of
// them bend the battle (battle.js); Legion's banners, the domain's size and centre, Hollow Court's shadows
// kept and Court of Bone's Monarch that nothing heals are the run's to apply. Nothing revives the Monarch.
//
// The enemy is an army too (drawRoom): from floor 2 its rooms have captains leading cohorts, an elite's with
// orders of their own (never shown); a floor-1 elite brings a late pair; from floor 3 rooms come in waves,
// and a siege room is one battle of three. The last room is a siege whose last wave is the Hollow Sovereign
// and its court; its fall ends the battle.
//
// `fight` resolves the whole battle at once; run.setup is what it was built from, so the UI can play it
// back tick by tick.
//
//   phase            action
//   map              { type: 'node', id }           walk to a connected room (a battle room, a siege too, opens prep)
//   map, prep        { type: 'place', uid, slot }   move a soul (or the Monarch) to an open camp slot (0–48)
//                                                   or a soul to the bench (−1); a unit already there takes
//                                                   the mover's old place (never the bench, for the Monarch)
//   map, prep        { type: 'level', uid }         buy a soul its next level
//   map, prep        { type: 'upgrade', uid, path } buy a soul its next tier on `path` (the first commits it;
//                                                   a Knight's or Marshal's on another path, its second path)
//   map, prep        { type: 'monarch', stat }      buy the Monarch a point of 'dominion', 'command' or 'will'
//   map, prep        { type: 'muster' }             buy the rank-and-file their next muster level
//   map, prep        { type: 'cohort', uid, kind,   give a fielded captain a cohort: `count` bodies of `kind`
//                      count, shape }               standing in `shape` (SHAPES); kind null clears it (benched too)
//   map, prep, reap  { type: 'release', uid }       let a soul go (never the last one standing)
//   prep             { type: 'fight' }              the battle plays out; the run moves on by itself
//   reap             { type: 'reap', index }        take offer `index` (recruit one soul for its price, a
//                                                   free relic, a free tier, a free keystone), or null to move on
//   map, prep        { type: 'order', uids, plan }  a detachment of these fielded captains (out of any other;
//                                                   a detachment left empty is gone) with `plan`:
//                                                   { where: 'hunt'|'stay'|'move', square, when: { at, t? } }
//   map, prep        { type: 'order', id, plan }    detachment `id` takes a new plan
//   map, prep        { type: 'disband', id }        detachment `id` is no more: its captains Hunt, at once
//   reap             { type: 'bind', id, count }    bind `count` of the slain of kind `id` into the ossuary
//                                                   (the first 1 + Will a battle free, then 3 × tier each)
//   map, prep        { type: 'promote', uid }       feed a soul bodies of its kin: Soldier → Knight → Marshal
//   over             { type: 'descend' }            the Sovereign slain (result 'victory'): on to the endless
//                                                   floors, each deeper than the last; nothing after a fall
//
// Endless floors: beating the Sovereign on the last floor (TUNING.run.floors) is a clear, recorded for good
// (s.result 'victory'), and the run stops there, over, unless the player descends. Floors past it reuse the
// last floor's camps and foes, growing with every floor deeper (TUNING.spawn.endless), and each ends in a big
// elite; past it the floors simply go on. A fall in the deep ends the run as any defeat does (s.death says
// what felled the Monarch) but leaves the clear standing: s.result stays 'victory'.
import { TUNING } from '../tuning.js'
import { UNIT_LIST, UNITS, relicDef, unitDef, RELIC_LIST, CAMP_LIST, SHAPES, ORDERS, DETACHMENT_COLORS, KEYSTONE_LIST, keystoneDef, FOE_ORDERS, THREATS } from '../content.js'
import { createRng } from './rng.js'
import {
  makeUnit, autoPlace, slotAt, CAMP_SLOTS, CAMP_ROWS, baseStats, onField, CENTRE_OUT, campGrid, campOpen, wallTiles, pathsOf,
  pathDef, nearestOpen, deployTile, distance, rowOf, colOf, COLS, TILES, DEPTH, tileAt, pathsClash, FORMATION, LANES, SLOTS, seatNear
} from './unit.js'
import { createBattle, playOut } from './battle.js'
import { generateFloor, nodeOf, RANKS } from './map.js'

export const START_PARTY = ['tomb_knight', 'bone_chanter', 'frost_sprite']
export const MONARCH_UID = 0
export const MONARCH_STATS = ['dominion', 'command', 'will']
const START_LEVEL = 2
const BATTLE_NODES = ['fight', 'elite', 'boss', 'siege']
const ROMAN = ['I', 'II', 'III', 'IV']
const BOSS = UNIT_LIST.find((u) => u.boss).id

// The Monarch starts on the camp's rear row, in the middle lane (or the open cell nearest it), and the
// start souls take the cells nearest their roles' rows inside its domain: the formation a run opens on
// is one the game itself would not mark as faltering (any soul the domain has no room for goes by its
// row on the whole camp). `death` is what felled the Monarch, once something has. The ossuary starts
// empty: bodies come from binding the slain. `freeBinds` is how many more bodies bind free in this reap.
// No detachments: every soul Hunts, at once. No keystones (ids, in the order taken).
// `ablate` (the autoplayer's ablation reports only, never a player's run): battle rules taken from the party in
// every battle of the run, carried in each battle's setup (battle.js createBattle: 'arise', 'synergies'). A run
// made without it has no such field, as before.
export function createRun ({ seed, ablate = null }) {
  const state = {
    seed, floor: 1, phase: 'map', map: null, camp: null, at: null, party: [], relics: [], offers: [],
    essence: TUNING.essence.start, result: null, death: null, monarch: { dominion: 0, command: 0, will: 0 },
    ossuary: {}, muster: TUNING.army.muster.start, freeBinds: 0, detachments: [],
    keystones: [],
    stats: { fights: 0, wins: 0, reaped: 0, bound: 0, essence: 0, spent: 0, floorsCleared: 0 }, log: [], nextUid: 1
  }
  state.party = [
    makeUnit('monarch', { uid: MONARCH_UID, lvl: 0 }),
    ...START_PARTY.map((id) => makeUnit(id, { uid: state.nextUid++, lvl: START_LEVEL }))
  ]
  if (ablate?.length) state.ablate = ablate.slice()
  const run = { state, battle: null, setup: null }
  enterFloor(run)
  const grid = campGrid(state.camp)
  monarchOf(state).slot = seatNear(state.camp)
  autoPlace(state.party, { grid: { rows: grid.rows, open: (slot) => grid.open(slot) && !faltersAt(state, slot) } })
  autoPlace(state.party, { grid })
  return run
}

export function replay (seed, log, { ablate = null } = {}) {
  const run = createRun({ seed, ablate })
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
    const binds = s.offers.filter((o) => o.type === 'bind')
      .flatMap((o) => Array.from({ length: o.max }, (_, k) => ({ type: 'bind', id: o.id, count: k + 1 })))
      .filter((a) => canBind(run, a))
    return [...offers, ...binds, { type: 'reap', index: null }, ...releasable(s).map((u) => ({ type: 'release', uid: u.uid }))]
  }
  if (s.phase === 'over') return canDescend(s) ? [{ type: 'descend' }] : []
  return []
}

function rosterActions (run) {
  const s = run.state
  const out = []
  for (const u of s.party) {
    for (let slot = -1; slot < CAMP_SLOTS; slot++) if (canPlace(run, u, slot)) out.push({ type: 'place', uid: u.uid, slot })
  }
  for (const u of s.party) {
    if (canLevel(run, u)) out.push({ type: 'level', uid: u.uid })
    for (const p of pathsOf(u.id)) if (canUpgrade(run, u, p.id)) out.push({ type: 'upgrade', uid: u.uid, path: p.id })
    if (canPromote(run, u)) out.push({ type: 'promote', uid: u.uid })
  }
  out.push(...MONARCH_STATS.filter((stat) => canCrown(run, stat)).map((stat) => ({ type: 'monarch', stat })))
  if (canMuster(run)) out.push({ type: 'muster' })
  for (const u of souls(s.party)) out.push(...cohortActions(run, u))
  out.push(...orderActions(run))
  out.push(...releasable(s).map((u) => ({ type: 'release', uid: u.uid })))
  return out
}

// The orders a player could give now, sampled so the list stays short (apply takes any plan; these are a
// representative few): each fielded captain alone and all of them together, and each detachment's plan
// changed, to every plan of PLAN_MENU; and each detachment disbanded.
function orderActions (run) {
  const s = run.state
  const captains = fielded(souls(s.party)).map((u) => u.uid)
  const groups = [...captains.map((uid) => [uid]), ...(captains.length > 1 ? [captains] : [])]
  const out = [
    ...groups.flatMap((uids) => PLAN_MENU.map((plan) => ({ type: 'order', uids, plan }))),
    ...s.detachments.flatMap((d) => PLAN_MENU.map((plan) => ({ type: 'order', id: d.id, plan })))
  ].filter((a) => canOrder(run, a))
  return [...out, ...s.detachments.map((d) => ({ type: 'disband', id: d.id }))]
}

// Every cohort a captain could take now (each kind it can lead with bodies to spare, each count, each
// shape), and clearing the one it has.
function cohortActions (run, u) {
  const s = run.state
  const out = u.cohort ? [{ type: 'cohort', uid: u.uid, kind: null }] : []
  if (!onField(u)) return out
  for (const kind of Object.keys(s.ossuary)) {
    for (let count = 1; count <= Math.min(cohortCap(s, u), freeBodies(s, kind, u)); count++) {
      for (const shape of Object.keys(SHAPES)) {
        const a = { type: 'cohort', uid: u.uid, kind, count, shape }
        if (canCohort(run, u, a)) out.push(a)
      }
    }
  }
  return out
}

export const currentNode = (run) => nodeOf(run.state.map, run.state.at)

export function availableNodes (run) {
  if (run.state.phase !== 'map') return []
  return currentNode(run).next.map((id) => nodeOf(run.state.map, id))
}

const relicDefs = (s) => s.relics.map(relicDef)
const relicSum = (s, key) => relicDefs(s).reduce((n, r) => n + (r[key] ?? 0), 0)
const keystoneSum = (s, key) => s.keystones.reduce((n, id) => n + (keystoneDef(id)[key] ?? 0), 0)
// Whether the run holds a keystone with this rule (KEYSTONE_LIST: keep, unhealable, crown…).
export const holds = (s, key) => s.keystones.some((id) => keystoneDef(id)[key])
// Hollow Court: the shadows Arise raised (`arisen`; a party shadow raised any other way is not one) that
// still stood when the battle last fought ended, if it was fought under the keystone. The rules it was
// fought with decide (run.setup), not the keystones held now: one taken on the spoils keeps nothing of the
// battle before it.
export const keptShadows = (run) => run.battle && run.setup?.keystones?.some((id) => keystoneDef(id).keep)
  ? run.battle.units.filter((u) => u.arisen && u.side === 'party' && u.hp > 0) : []
// Caps count souls: the Monarch takes no room on the field or in the retinue. Command adds banners, up to
// as many as the board holds bodies (and so do Legion's two).
// The banners every Monarch holds: TUNING.party.field, and fieldPerFloor more a floor down (to the Sovereign's), so
// Command is not the only way to a wider field (necessity round 2: Monarch points decided whole runs).
export const baseField = (s) => TUNING.party.field + TUNING.party.fieldPerFloor * (Math.min(s.floor, TUNING.run.floors) - 1)
export const fieldCap = (run) => Math.min(TUNING.army.board, baseField(run.state) + run.state.monarch.command + relicSum(run.state, 'field') + keystoneSum(run.state, 'field'))
// How many rank-and-file a captain's cohort holds: Command, plus its rank's (TUNING.ranks.cohort: a Knight and a
// Marshal lead more, Command or not).
export const cohortCap = (s, u) => s.monarch.command + (TUNING.ranks.cohort[u?.grade ?? 0] ?? 0)
export const rosterCap = (run) => TUNING.party.roster + relicSum(run.state, 'roster')
export const fielded = (party) => party.filter(onField)
export const benched = (party) => party.filter((u) => !onField(u))
export const isMonarch = (u) => u.uid === MONARCH_UID
export const monarchOf = (s) => s.party.find(isMonarch)
// The party without the Monarch: what the caps, the bench and the offers count.
export const souls = (party) => party.filter((u) => !isMonarch(u))

// ── the Monarch ──────────────────────────────────────────────────────────────────────────────────

// Its level: the points bought. A point costs more the more it has.
export const monarchPoints = (s) => MONARCH_STATS.reduce((n, k) => n + s.monarch[k], 0)
export const monarchCost = (run) => TUNING.monarch.cost + TUNING.monarch.costPerPoint * monarchPoints(run.state)
const canCrown = (run, stat) => MONARCH_STATS.includes(stat) && run.state.essence >= monarchCost(run)

// How far its domain reaches (Chebyshev, in tiles; keystones bend it, never below 0) and whether a camp cell
// lies outside it: a soul placed there falters from the first tick (it deals less damage).
export const domainOf = (s) => Math.max(0, TUNING.monarch.domain + s.monarch.dominion + keystoneSum(s, 'domain'))
export const faltersAt = (s, slot) => {
  const m = monarchOf(s)
  return !!m && onField(m) && slot >= 0 && slot !== m.slot && distance(deployTile('party', slot), deployTile('party', domainCentre(s))) > domainOf(s)
}

// The camp cell the domain centres on as a battle begins: the Monarch's, or with Vanguard Crown its
// front-most captain's (a living fielded soul that takes the field at once; the front row first, then the
// middle lane, then the lowest uid), as the battle finds it (it then moves with the front).
export function domainCentre (s) {
  const m = monarchOf(s)
  if (!holds(s, 'crown')) return m.slot
  const front = souls(s.party).filter((u) => onField(u) && u.hp > 0 && !waits(detachmentOf(s, u.uid)))
    .sort((a, b) => rowOf(a.slot) - rowOf(b.slot) || Math.abs(colOf(a.slot) - CENTRE_OUT[0]) - Math.abs(colOf(b.slot) - CENTRE_OUT[0]) || a.uid - b.uid)[0]
  return front ? front.slot : m.slot
}
// The Marshal whose own domain covers a fielded soul or member (armyLayout's) at the start: the soul itself
// if it is one, else its captain if that is a Marshal standing on the field; null for anyone else.
export const marshalOf = (s, u) => {
  const c = (u.grade ?? 0) >= 2 ? u : u.cohortOf != null ? s.party.find((x) => x.uid === u.cohortOf) : null
  return c && c.grade >= 2 && onField(c) && c.hp > 0 ? c : null
}
// Whether a fielded soul or member starts the battle faltering, as the battle's `falters` reads its first
// tick: outside the Monarch's domain (faltersAt), unless it is a Marshal or stands within its Marshal's
// own domain (TUNING.ranks.domain; camp distance is board distance). Prep marks and estimates use this.
export const faltersIn = (s, u) => {
  if (!faltersAt(s, u.slot)) return false
  const m = marshalOf(s, u)
  return !m || distance(deployTile('party', u.slot), deployTile('party', m.slot)) > TUNING.ranks.domain
}

// ── the army: rank-and-file, muster, cohorts ────────────────────────────────────────────────────

// A captain may lead bodies of any kind that shares its kin or its role (never the Monarch, nor a boss).
export const canLead = (captain, kind) => {
  const c = unitDef(captain.id)
  const k = unitDef(kind)
  return !c.monarch && !k.monarch && !k.boss && (k.kin === c.kin || k.role === c.role)
}
export const standingOf = (s, kind) => s.ossuary[kind]?.standing ?? 0
// The bodies of `kind` standing in the ossuary that no cohort but `except`'s leads.
export const freeBodies = (s, kind, except = null) =>
  standingOf(s, kind) - souls(s.party).reduce((n, u) => n + (u !== except && u.cohort?.kind === kind ? u.cohort.count : 0), 0)

// The next muster level, bought once for every body: a level, so a level discount cuts it too.
export const musterCost = (run) => price(run, TUNING.army.muster.cost * Math.pow(run.state.muster, TUNING.army.muster.exponent), 'levelDiscount')
const canMuster = (run) => run.state.muster < TUNING.army.muster.cap && run.state.essence >= musterCost(run)

// A cohort for a fielded captain: a kind it can lead, 1 to Command bodies of it that no other cohort
// leads, in a known shape (a change, not the one it has). Clearing (kind null) works on any soul with a
// cohort, benched or not, so a benched captain never holds bodies hostage.
function canCohort (run, u, { kind, count, shape }) {
  const s = run.state
  if (!u || isMonarch(u)) return false
  if (kind === null) return !!u.cohort
  if (!onField(u) || typeof kind !== 'string' || !Object.hasOwn(UNITS, kind) || !Object.hasOwn(SHAPES, shape)) return false
  if (u.cohort && u.cohort.kind === kind && u.cohort.count === count && u.cohort.shape === shape) return false
  return Number.isInteger(count) && count >= 1 && count <= cohortCap(s, u) && canLead(u, kind) && count <= freeBodies(s, kind, u)
}

// Where the army stands for a battle, from the living fielded captains on their cells: each cohort's
// members at its shape's offsets in turn (each captain's first, then each one's second…, in party order),
// an offset walled, off the camp or taken giving way to the next free one, then to the open cell nearest
// the captain. Once TUNING.army.board bodies stand (captains and members; the Monarch not counted), or no
// cell is left, the rest go to the reserve in that order. Dead souls hold no cell: they do not fight.
// A detachment that starts later (`detachments`, the run's by default) is held: its captains and all their
// bodies wait off the board, count toward no cap, and enter in `held`'s order (detachment by detachment,
// in the party order of their first captains, not the order they were formed in, so a rehearsal of the
// same captains and plans lines them up as the fight will; within one, its captains in party order, then
// their bodies round-robin, so no body enters before its captain). A held captain's camp cell stays its own.
// → { members: [{ cohortOf, id, slot }], reserve: [{ cohortOf, id }], held: [{ det, uid, id } | { det, cohortOf, id }] }
export function armyLayout (s, party = fielded(s.party), detachments = s.detachments) {
  const grid = campGrid(s.camp)
  const standing = party.filter((u) => onField(u) && u.hp > 0)
  const taken = new Set(standing.map((u) => u.slot))
  const out = (u) => isMonarch(u) || waits(detachmentOf(s, u.uid, detachments))
  let board = standing.filter((u) => !out(u)).length
  const members = []
  const reserve = []
  round(standing.filter((u) => !out(u) && u.cohort), (body, c) => {
    const slot = board < TUNING.army.board ? memberCell(grid, c, taken) : -1
    if (slot < 0) return reserve.push(body)
    taken.add(slot)
    board++
    members.push({ ...body, slot })
  })
  const held = []
  const first = (d) => standing.findIndex((u) => d.members.includes(u.uid))
  for (const d of detachments.filter(waits).sort((a, b) => first(a) - first(b))) {
    const captains = standing.filter((u) => !isMonarch(u) && d.members.includes(u.uid))
    held.push(...captains.map((u) => ({ det: d.id, uid: u.uid, id: u.id })))
    round(captains.filter((u) => u.cohort), (body) => held.push({ det: d.id, ...body }))
  }
  return { members, reserve, held }
}

// Each captain's first body, then each one's second, and so on: `fn({ cohortOf, id }, captain)`.
function round (captains, fn) {
  for (let k = 0; captains.some((c) => c.cohort.count > k); k++) {
    for (const c of captains) if (k < c.cohort.count) fn({ cohortOf: c.uid, id: c.cohort.kind }, c)
  }
}

function memberCell (grid, captain, taken) {
  const row = rowOf(captain.slot)
  const col = colOf(captain.slot)
  for (const [dr, dc] of SHAPES[captain.cohort.shape].offsets) {
    const r = row + dr
    const c = col + dc
    if (r < 0 || r >= grid.rows || c < 0 || c >= COLS) continue
    const slot = slotAt(r, c)
    if (grid.open(slot) && !taken.has(slot)) return slot
  }
  return nearestOpen(grid, captain.slot, taken)
}

// After deaths a kind may have fewer standing than its cohorts lead: they shrink, the first captains in
// the party keeping theirs; one left with none has none.
function fitCohorts (s) {
  const left = {}
  for (const u of souls(s.party)) {
    if (!u.cohort) continue
    const k = u.cohort.kind
    left[k] ??= standingOf(s, k)
    const count = Math.min(u.cohort.count, left[k])
    left[k] -= count
    u.cohort = count ? { ...u.cohort, count } : null
  }
}

// ── ranks ────────────────────────────────────────────────────────────────────────────────────────

// A soul's next rank takes TUNING.ranks.knight bodies of its kin (a Soldier's) or TUNING.ranks.marshal more
// (a Knight's): how many, or null for a Marshal, the top.
export const promoteNeed = (u) => [TUNING.ranks.knight, TUNING.ranks.marshal][u.grade ?? 0] ?? null
// The bodies of a kin standing in the ossuary, every kind of it.
export const kinStanding = (s, kin) => Object.keys(s.ossuary).reduce((n, k) => n + (unitDef(k).kin === kin ? standingOf(s, k) : 0), 0)
// Any soul, fielded, benched or fallen, may be promoted while enough bodies of its kin stand; never the Monarch.
export const canPromote = (run, u) => !!u && !isMonarch(u) && promoteNeed(u) !== null && kinStanding(run.state, unitDef(u.id).kin) >= promoteNeed(u)

// The bodies a promotion takes, as { kind: count }: those no cohort leads first, then led ones (their
// cohorts shrink, as after deaths); either way the lowest tier first, then the kind with the most, then by id.
export function feedOf (s, kin, n) {
  const kinds = Object.keys(s.ossuary).filter((k) => unitDef(k).kin === kin)
  const take = {}
  const eat = (count) => {
    for (const k of kinds.slice().sort((a, b) => unitDef(a).tier - unitDef(b).tier || count(b) - count(a) || (a < b ? -1 : 1))) {
      const x = Math.min(n, count(k))
      if (x <= 0) continue
      take[k] = (take[k] ?? 0) + x
      n -= x
    }
  }
  eat((k) => Math.max(0, freeBodies(s, k)))
  eat((k) => standingOf(s, k) - (take[k] ?? 0))
  return take
}

// ── orders: detachments and their plans ─────────────────────────────────────────────────────────

// A soul in no detachment Hunts, at once.
export const DEFAULT_PLAN = { where: 'hunt', square: null, when: { at: 'once' } }
// The plans legalActions lists: at once, Hunt, Stay, or Move to the open ground's middle or left wing or
// the foes' middle row; and Hunt or Stay held for each later start (a time: 20 s).
const PLAN_MENU = [
  ...[null, null, tileAt(3, CAMP_ROWS), tileAt(0, CAMP_ROWS), tileAt(3, DEPTH - 2)]
    .map((square, i) => ({ where: i === 0 ? 'hunt' : i === 1 ? 'stay' : 'move', square, when: { at: 'once' } })),
  ...['hunt', 'stay'].flatMap((where) => Object.keys(ORDERS.when).filter((at) => at !== 'once')
    .map((at) => ({ where, square: null, when: at === 'time' ? { at, t: 400 } : { at } })))
]

// The plan as the run keeps it, or null if it is none: `where` one of ORDERS.where; `square` a board tile no
// wall of the camp stands on, for Move (null otherwise); `when` one of ORDERS.when, 'time' with a tick
// `t` from 1 to before the battle's ceiling.
function cleanPlan (s, plan) {
  if (!plan || typeof plan !== 'object' || !Object.hasOwn(ORDERS.where, plan.where)) return null
  const w = plan.when
  if (!w || typeof w !== 'object' || !Object.hasOwn(ORDERS.when, w.at)) return null
  if (w.at === 'time' && !(Number.isInteger(w.t) && w.t >= 1 && w.t < TUNING.tick.ceiling)) return null
  const square = plan.where === 'move' ? plan.square : null
  if (plan.where === 'move' && !isSquare(s, square)) return null
  return { where: plan.where, square, when: w.at === 'time' ? { at: w.at, t: w.t } : { at: w.at } }
}

// A square a Move may be sent to: any board tile, the foes' ground included, but no wall.
export const isSquare = (s, tile) => Number.isInteger(tile) && tile >= 0 && tile < TILES && !wallTiles(s.camp).includes(tile)
const samePlan = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// A detachment that waits for a later start: it begins the battle off the board, in reserve.
export const waits = (d) => !!d && d.plan.when.at !== 'once'
export const detachmentOf = (s, uid, detachments = s.detachments) => detachments.find((d) => d.members.includes(uid)) ?? null

// An order: forming a detachment of fielded captains (`uids`, distinct, no Monarch; none of them left in
// another), within TUNING.army.detachments once those emptied are gone, and not one that already stands
// with this plan; or a new plan for detachment `id` (a change, not the one it has).
function canOrder (run, a) {
  const s = run.state
  const plan = cleanPlan(s, a.plan)
  if (!plan) return false
  if (a.id !== undefined) {
    const d = a.uids === undefined && s.detachments.find((x) => x.id === a.id)
    return !!d && !samePlan(d.plan, plan)
  }
  const uids = a.uids
  if (!Array.isArray(uids) || !uids.length || new Set(uids).size !== uids.length) return false
  if (!uids.every((uid) => s.party.some((u) => u.uid === uid && !isMonarch(u) && onField(u)))) return false
  const left = s.detachments.filter((d) => d.members.some((uid) => !uids.includes(uid)))
  if (left.length >= TUNING.army.detachments) return false
  return !s.detachments.some((d) => d.members.length === uids.length && uids.every((uid) => d.members.includes(uid)) && samePlan(d.plan, plan))
}

// A soul leaves its detachment (released, or ordered into another); a detachment left empty is gone.
function leave (s, uids) {
  for (const d of s.detachments) d.members = d.members.filter((uid) => !uids.includes(uid))
  s.detachments = s.detachments.filter((d) => d.members.length)
}

// A new floor's camp may wall a Move's square: the square moves to the open tile nearest it (fewest steps
// apart, then the lower tile).
function fitSquares (s) {
  const walls = new Set(wallTiles(s.camp))
  for (const d of s.detachments) {
    const sq = d.plan.square
    if (sq === null || !walls.has(sq)) continue
    let best = -1
    for (let t = 0; t < TILES; t++) if (!walls.has(t) && (best < 0 || distance(t, sq) < distance(best, sq))) best = t
    d.plan = { ...d.plan, square: best }
  }
}

// ── the retinue: placing, releasing, buying ─────────────────────────────────────────────────────

// The Monarch is never benched: not by a place to −1, nor by a benched soul taking its cell.
function canPlace (run, u, slot) {
  if (slot === u.slot || (slot !== -1 && !campOpen(run.state.camp, slot))) return false
  if (slot === -1 && isMonarch(u)) return false
  const other = slot >= 0 && run.state.party.find((x) => x.slot === slot)
  if (other && isMonarch(other) && !onField(u)) return false
  return onField(u) || !!other || fielded(souls(run.state.party)).length < fieldCap(run)
}

// Releasing must leave a soul who can still fight; the Monarch is never released.
function releasable (s) {
  const all = souls(s.party)
  return all.length > 1 ? all.filter((u) => all.some((x) => x !== u && x.hp > 0)) : []
}

// The Monarch alone may fight (and will likely fall).
const canFight = (s) => s.party.some((u) => onField(u) && u.hp > 0)

// A new soul takes a free field slot if there is one, else waits on the bench.
export function join (run, id, { lvl = medianLevel(souls(run.state.party)), uid = run.state.nextUid++ } = {}) {
  const s = run.state
  if (unitDef(id).monarch) throw new Error('there is one Monarch')
  if (souls(s.party).length >= rosterCap(run)) throw new Error('the retinue is full')
  const u = makeUnit(id, { uid, lvl: Math.min(TUNING.level.cap, lvl) })
  s.party.push(u)
  if (fielded(souls(s.party)).length < fieldCap(run)) autoPlace([...fielded(s.party), u], { grid: campGrid(s.camp) })
  return u
}

// ── action handlers ──────────────────────────────────────────────────────────────────────────────

const HANDLERS = {
  node: { phases: ['map'], run: walk },
  place: { phases: ['map', 'prep'], run: place },
  level: { phases: ['map', 'prep'], run: level },
  upgrade: { phases: ['map', 'prep'], run: upgrade },
  release: { phases: ['map', 'prep', 'reap'], run: release },
  monarch: { phases: ['map', 'prep'], run: crown },
  muster: { phases: ['map', 'prep'], run: muster },
  promote: { phases: ['map', 'prep'], run: promote },
  cohort: { phases: ['map', 'prep'], run: cohort },
  order: { phases: ['map', 'prep'], run: order },
  disband: { phases: ['map', 'prep'], run: disband },
  fight: { phases: ['prep'], run: fight },
  reap: { phases: ['reap'], run: reap },
  bind: { phases: ['reap'], run: bind },
  descend: { phases: ['over'], run: descend }
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
    if (!s.offers.length) nextRoom(run)
  } else if (node.type === 'rite') {
    s.offers = [...riteOffers(run, 3), ...keystoneOffers(s)]
    s.phase = 'reap'
    if (!s.offers.length) nextRoom(run)
  } else if (node.type === 'altar') {
    const t = TUNING.run
    for (const u of s.party) {
      if (isMonarch(u) && holds(s, 'unhealable')) continue
      u.hp = u.hp > 0 ? Math.max(u.hp, Math.round(u.maxHp * t.altarHeal)) : Math.ceil(u.maxHp * t.altarRevive)
    }
    // The fallen rank-and-file stand again.
    for (const o of Object.values(s.ossuary)) {
      o.standing += o.fallen
      o.fallen = 0
    }
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

function level (run, { uid }) {
  const u = run.state.party.find((x) => x.uid === uid)
  if (!u || !canLevel(run, u)) throw new Error(`cannot level ${uid}`)
  pay(run, levelCost(run, u))
  setLevel(u, u.lvl + 1)
}

// A point raises the Monarch's max HP and heals it by the gain, unless nothing may heal it (Court of Bone).
function crown (run, { stat }) {
  const s = run.state
  if (!canCrown(run, stat)) throw new Error(`cannot raise the Monarch's ${stat}`)
  pay(run, monarchCost(run))
  s.monarch[stat]++
  const m = monarchOf(s)
  const hp = m.hp
  setLevel(m, monarchPoints(s))
  if (holds(s, 'unhealable')) m.hp = hp
}

function muster (run) {
  if (!canMuster(run)) throw new Error('cannot muster')
  pay(run, musterCost(run))
  run.state.muster++
}

function cohort (run, { uid, kind, count, shape }) {
  const u = run.state.party.find((x) => x.uid === uid)
  if (!canCohort(run, u, { kind, count, shape })) throw new Error(`cannot give ${uid} a cohort of ${count} ${kind} in ${shape}`)
  u.cohort = kind === null ? null : { kind, count, shape }
}

// A new detachment takes the first id free (1 up) and that id's colour; its captains stand in party order.
function order (run, a) {
  const s = run.state
  if (!canOrder(run, a)) throw new Error(`cannot give the order ${JSON.stringify(a)}`)
  const plan = cleanPlan(s, a.plan)
  if (a.id !== undefined) {
    s.detachments.find((d) => d.id === a.id).plan = plan
    return
  }
  leave(s, a.uids)
  let id = 1
  while (s.detachments.some((d) => d.id === id)) id++
  const members = s.party.filter((u) => a.uids.includes(u.uid)).map((u) => u.uid)
  s.detachments.push({ id, color: DETACHMENT_COLORS[(id - 1) % DETACHMENT_COLORS.length], members, plan })
}

function disband (run, { id }) {
  const s = run.state
  if (!s.detachments.some((d) => d.id === id)) throw new Error(`no detachment ${id}`)
  s.detachments = s.detachments.filter((d) => d.id !== id)
}

function upgrade (run, { uid, path }) {
  const u = run.state.party.find((x) => x.uid === uid)
  if (!u || !canUpgrade(run, u, path)) throw new Error(`cannot upgrade ${uid} on ${path}`)
  pay(run, tierCost(run, u, path))
  advance(u, path)
}

// The bodies are eaten (gone, not fallen) and the soul rises a rank; cohorts left with too few shrink.
function promote (run, { uid }) {
  const s = run.state
  const u = s.party.find((x) => x.uid === uid)
  if (!canPromote(run, u)) throw new Error(`cannot promote ${uid}`)
  for (const [k, n] of Object.entries(feedOf(s, unitDef(u.id).kin, promoteNeed(u)))) s.ossuary[k].standing -= n
  u.grade = (u.grade ?? 0) + 1
  fitCohorts(s)
}

// A released soul's rite offers go with it; a rite left with none ends.
function release (run, { uid }) {
  const s = run.state
  if (!releasable(s).some((u) => u.uid === uid)) throw new Error(`cannot release ${uid}`)
  s.party = s.party.filter((u) => u.uid !== uid)
  leave(s, [uid])
  if (s.phase !== 'reap') return
  s.offers = s.offers.filter((o) => o.uid !== uid)
  if (!s.offers.length) nextRoom(run)
}

// The battle takes uids for its foes and for the shadows it raises; the run moves past all of them.
function fight (run) {
  const s = run.state
  if (!canFight(s)) throw new Error('nobody standing on the field')
  run.setup = battleSetup(run)
  run.battle = createBattle(run.setup)
  playOut(run.battle)
  s.nextUid = run.battle.nextUid
  finishBattle(run)
}

// Past the Sovereign, the next floor down: its map, its camp, its foes, as any floor on arrival. Only from a
// clear the Monarch survived (a fall in the deep is the end).
export const canDescend = (s) => s.phase === 'over' && s.result === 'victory' && s.death === null
function descend (run) {
  const s = run.state
  if (!canDescend(s)) throw new Error('only a run that slew the Sovereign may descend')
  s.floor++
  enterFloor(run)
}

// One of each kind per room: recruiting a soul (for its price) takes the other souls off the table, and
// taking a free relic or rite tier the others of its kind, so an elite still leaves its relic after a
// recruit. The room ends on null, or once nothing is left.
function reap (run, { index }) {
  const s = run.state
  const o = index === null ? null : s.offers[index]
  if (index !== null && !o) throw new Error(`no offer ${index}`)
  if (o && !canTake(run, o)) {
    throw new Error(o.type !== 'soul' ? `offer ${index} can't be taken` : souls(s.party).length >= rosterCap(run) ? 'the retinue is full: release a soul first' : 'not enough essence')
  }
  if (o?.type === 'relic') s.relics.push(o.id)
  else if (o?.type === 'keystone') s.keystones.push(o.id)
  else if (o?.type === 'tier') advance(s.party.find((u) => u.uid === o.uid), o.path)
  else if (o?.type === 'soul') {
    pay(run, o.cost)
    join(run, o.id, { lvl: o.lvl })
    s.stats.reaped++
  }
  s.offers = o ? s.offers.filter((x) => x.type !== o.type) : []
  if (!s.offers.length) nextRoom(run)
}

// Bodies bound go to the ossuary, standing. The offer keeps what is left of it, and the room's other offers
// stay on the table; a room left with no offer at all ends.
function bind (run, { id, count }) {
  const s = run.state
  if (!canBind(run, { id, count })) throw new Error(`cannot bind ${count} ${id}`)
  const o = s.offers.find((x) => x.type === 'bind' && x.id === id)
  pay(run, bindCost(run, id, count))
  s.freeBinds = Math.max(0, s.freeBinds - count)
  const bones = (s.ossuary[id] ??= { standing: 0, fallen: 0 })
  bones.standing += count
  s.stats.bound += count
  o.max -= count
  if (!o.max) s.offers = s.offers.filter((x) => x !== o)
  if (!s.offers.length) nextRoom(run)
}

// The first 1 + Will bodies bound after a battle are free (s.freeBinds counts down); each more costs
// TUNING.army.bindPerTier × its tier.
export const bindCost = (run, id, count) => Math.max(0, count - run.state.freeBinds) * TUNING.army.bindPerTier * unitDef(id).tier
function canBind (run, { id, count }) {
  const o = run.state.offers.find((x) => x.type === 'bind' && x.id === id)
  return !!o && Number.isInteger(count) && count >= 1 && count <= o.max && run.state.essence >= bindCost(run, id, count)
}

// A bind offer is taken by `bind`, never by `reap`.
function canTake (run, o) {
  const s = run.state
  if (o.type === 'bind') return false
  if (o.type === 'soul') return souls(s.party).length < rosterCap(run) && s.essence >= o.cost
  if (o.type === 'tier') return s.party.some((u) => u.uid === o.uid && canAdvance(u, o.path))
  if (o.type === 'keystone') return !s.keystones.includes(o.id) && s.keystones.length < TUNING.keystone.max
  return true
}

// ── internals ────────────────────────────────────────────────────────────────────────────────────

// Every battle room's foes are fixed when the floor is made, so the map can show them: `foes`, and `waves`
// for a room with more to come (see drawRoom). The floor's camp is drawn from its list; souls standing on its
// walls move to open ground. A Monarch whose cell is walled takes its seat as a run begins (seatNear: the rear
// row's middle lane, or the open cell nearest it that seals no one in), not its role's row: that row is a
// wall's in some camps, its one gap where the Monarch, which never steps, would shut the army in behind it.
function enterFloor (run) {
  const s = run.state
  s.map = generateFloor({ seed: s.seed, floor: s.floor, last: s.floor === TUNING.run.floors })
  s.camp = createRng(s.seed).stream(`camp|${s.floor}`).pick(CAMP_LIST.filter((c) => c.floor === poolFloor(s.floor))).id
  const m = monarchOf(s)
  if (onField(m) && !campOpen(s.camp, m.slot)) {
    const seat = seatNear(s.camp, undefined, new Set(souls(fielded(s.party)).map((u) => u.slot)))
    m.slot = seat >= 0 ? seat : seatNear(s.camp)
  }
  autoPlace(fielded(s.party), { grid: campGrid(s.camp) })
  fitSquares(s)
  for (const n of s.map.nodes) if (BATTLE_NODES.includes(n.type)) Object.assign(n, drawRoom(s.seed, s.floor, n))
  varyRoutes(s)
  s.at = s.map.start
  s.phase = 'map'
}

function nextRoom (run) {
  const s = run.state
  s.phase = 'map'
  s.freeBinds = 0
  if (s.at !== s.map.end) return
  s.stats.floorsCleared++
  s.floor++
  enterFloor(run)
}

// reDESIGN §9: across a floor's ranks every threat type appears on every route, so a walk that skirts one
// answer still meets the threat it answers. Once the rooms are drawn, while some walk from the start to the
// floor's end meets no room carrying a type the floor's foes can bring (routeThreats; depth aside: a room's
// waves bring it, not its foes), the first battle room on that walk from rank variety.from on (never the
// boss's) is drawn again wanting the type, and keeping the types it had (drawRoom's `want`, on a stream of
// its own). Bounded: `variety.routeTries` redraws a type a pass, two passes (a redraw for one type may cost
// a route another).
export function varyRoutes (s) {
  const v = TUNING.spawn.variety
  for (let pass = 0; pass < 2; pass++) {
    for (const type of routeThreats(s.floor)) {
      for (let k = 0; k < v.routeTries; k++) {
        const node = walkWithout(s.map, type)?.find((n) => BATTLE_NODES.includes(n.type) && n.type !== 'boss' && n.rank >= v.from)
        if (!node) break
        const keep = [...roomThreats(node)].filter((t) => t !== 'depth' && t !== type)
        Object.assign(node, drawRoom(s.seed, s.floor, node, { want: [type, ...keep], redraw: `${pass}|${k}` }))
      }
    }
  }
}

// The threat types (but depth) the rooms of a floor can carry: those of its foes' pool, the elites' included.
export const routeThreats = (floor) => {
  const sp = TUNING.spawn
  const out = threatsOf([...spawnPool(poolFloor(floor)).units, ...spawnPool(poolFloor(floor), sp.eliteTier).units])
  return Object.keys(THREATS).filter((t) => out.has(t))
}

// A walk from a floor's start to its end that meets no battle room carrying `type`, as its rooms in order
// (the first found, breadth first), or null if every walk meets one.
export function walkWithout (map, type) {
  const blocked = (n) => BATTLE_NODES.includes(n.type) && roomThreats(n).has(type)
  const back = new Map([[map.start, null]])
  const queue = [map.start]
  for (let i = 0; i < queue.length; i++) {
    const n = nodeOf(map, queue[i])
    if (n.id === map.end) {
      const walk = []
      for (let id = n.id; id !== null; id = back.get(id)) walk.unshift(nodeOf(map, id))
      return walk
    }
    for (const id of n.next) {
      if (back.has(id) || blocked(nodeOf(map, id))) continue
      back.set(id, n.id)
      queue.push(id)
    }
  }
  return null
}

// The distinct threat types a room's foes carry.
export const threatsOf = (foes) => new Set(foes.flatMap((f) => unitDef(f.id).threats ?? []))
// A room's ({ foes, waves? }): every wave's foes', and depth when more come behind the first.
export const roomThreats = (room) => {
  const out = threatsOf([room.foes, ...(room.waves ?? []).map((w) => w.foes)].flat())
  if (room.waves?.length) out.add('depth')
  return out
}

// A room's foes as [{ id, lvl, slot }]: its first wave, the formation on the board from the start (drawRoom).
export const encounter = (seed, floor, node) => drawRoom(seed, floor, node).foes

// A battle room: `foes`, the formation on the board from the start, and for a room with more to come
// `waves`: [{ foes, when }], each a formation of its own that enters at the top edge, each foe in its slot's
// lane, when `when` comes ({ at: 'time', t }: at tick t; { at: 'break', t }: once the wave before is down to
// TUNING.spawn.waves.share of its foes, or t ticks after it began to enter). A foe is { id, lvl, slot }, and in
// a formation of its own (a wave's slots are its own) a captain's cohort carries `cohortOf`: the captain's
// slot; an elite's captain carries the order it was given (`order`, one of its kind's foeOrders, and for a
// flank the wing's `square`), which is never shown.
// What comes, by room (TUNING.spawn):
//   fight   a formation of `fight` foes, floor 3+ from rank waves.fightRank: waves.fight such waves
//   elite   `elite` foes of a higher tier; floor 1: and a late pair of the floor's own pool at late.t;
//           floor 3+: waves.elite waves
//   siege   waves.siege fight-sized waves, from floor 3
//   boss    waves.siege waves, the last the Hollow Sovereign at the centre of its court of `court` undead
// From floor 2 each wave (but the Sovereign's) has captains: captains.fight (captains.elite in an elite) of
// its foes, each leading cohort[floor − 1] more of its own kind, on the nearest free slots of the formation.
// Each wave's foes stand in their roles' rows, filling the middle lanes first, each band of lanes (centre
// three, then the next pair out…) in shuffled order.
// From rank `variety.from` on, a room must carry enough distinct threats that one answer never covers it
// (TUNING.spawn.variety, waves and depth counted; a siege or the last room as a fight): a draw short of it
// is redrawn on the same stream, keeping the most varied.
// On an endless floor (past the Sovereign's) the foes come from the last floor's pool, and the enemy keeps
// growing as an army (deepGrowth): higher levels, more foes a wave, more waves to a room, bigger cohorts;
// the floor's last room is a big elite.
export function drawRoom (seed, floor, node, { want = [], redraw = null } = {}) {
  const sp = TUNING.spawn
  const W = sp.waves
  const grow = deepGrowth(floor, node)
  const lvl = foeLevel(floor, node.rank) + grow.level
  const rng = createRng(seed).stream(`foes|${floor}|${node.id}${redraw === null ? '' : `|route|${redraw}`}`)
  const elite = node.type === 'elite'
  const boss = node.type === 'boss'
  const pool = spawnPool(poolFloor(floor), elite ? sp.eliteTier : 0)
  const n = Math.min(SLOTS, at(elite ? sp.elite : sp.fight, floor) + grow.count)
  const waved = floor >= W.floor
  const base = boss || node.type === 'siege' ? W.siege : !waved ? 1 : elite ? W.elite : node.rank >= W.fightRank ? W.fight : 1
  // The deep's extra waves come to every room (a single formation becomes a room of waves), up to the cap.
  const waves = grow.waves ? Math.max(base, Math.min(TUNING.spawn.endless.maxWaves, base + grow.waves)) : base
  // Each wave's kinds as drawn (the Sovereign's: its court), then the late pair.
  const floorPool = spawnPool(poolFloor(floor))
  const elitePool = boss ? spawnPool(poolFloor(floor), sp.eliteTier) : null
  const undead = elitePool && {
    units: elitePool.units.filter((u) => u.kin === 'undead'),
    weights: elitePool.weights.filter((_, i) => elitePool.units[i].kin === 'undead')
  }
  const pair = elite && floor === 1
  const draw = () => [
    ...Array.from({ length: waves }, (_, k) => boss && k === waves - 1
      ? Array.from({ length: sp.court }, () => rng.weighted(undead.units, undead.weights).id)
      : Array.from({ length: n }, () => rng.weighted(pool.units, pool.weights).id)),
    ...(pair ? [Array.from({ length: sp.late.n }, () => rng.weighted(floorPool.units, floorPool.weights).id)] : [])
  ]
  const v = sp.variety
  const need = node.rank >= v.from ? (elite ? v.elite : v.fight) : 0
  const asFoes = (list) => list.map((id) => ({ id }))
  // How varied a draw is: its distinct threats, and for a route's redraw (see varyRoutes) far before that, the
  // type it wants (want[0]), then each type it keeps (the rest): a draw that has them all and `need` types
  // scores `goal`.
  const threats = (ids) => roomThreats({ foes: asFoes([...ids[0], ...(boss ? [BOSS] : [])]), waves: ids.slice(1).map((list) => ({ foes: asFoes(list) })) })
  const kinds = (ids) => {
    const t = threats(ids)
    return t.size + (want.length && t.has(want[0]) ? 1000 : 0) + 10 * want.slice(1).filter((x) => t.has(x)).length
  }
  const goal = need + (want.length ? 1000 + 10 * (want.length - 1) : 0)
  let ids = null
  for (let k = 0, best = -1; k < v.tries && best < goal; k++) {
    const d = draw()
    const c = kinds(d)
    if (c > best) { ids = d; best = c }
  }
  const level = lvl + (elite ? sp.eliteLevel : 0)
  const forms = ids.map((list, k) => boss && k === waves - 1
    ? courtOf(list, level)
    : formation(rng, list, level, pair && k === waves ? 0 : elite ? sp.captains.elite : sp.captains.fight, at(sp.cohort, floor) + grow.cohort, elite))
  const room = { foes: forms[0] }
  if (forms.length > 1) room.waves = forms.slice(1).map((foes, k) => ({ foes, when: pair ? { at: 'time', t: sp.late.t } : { at: 'break', t: W.t } }))
  return room

  // The Sovereign at the centre of its first row, its court on the slots nearest it.
  function courtOf (list, level) {
    const foes = [{ id: BOSS, lvl: level, slot: slotAt(0, CENTRE_OUT[0]) }]
    const taken = new Set([foes[0].slot])
    for (const id of list) {
      const slot = nearestOpen(FORMATION, foes[0].slot, taken)
      if (slot < 0) break
      taken.add(slot)
      foes.push({ id, lvl: level, slot, cohortOf: foes[0].slot })
    }
    return foes
  }
}

// A wave's formation: `ids` placed by role, then `captains` of them (if they lead anyone: `cohort` > 0) each
// leading `cohort` more of its kind on the free slots nearest it; an elite's captain takes an order.
function formation (rng, ids, lvl, captains, cohort, elite) {
  const foes = ids.map((id) => ({ id, lvl, slot: -1 }))
  const cols = [CENTRE_OUT.slice(0, 3), ...[3, 5].map((i) => CENTRE_OUT.slice(i, i + 2))].flatMap((band) => rng.shuffle(band))
  autoPlace(foes, { cols })
  if (!cohort || !captains) return foes
  const taken = new Set(foes.map((f) => f.slot))
  for (const c of rng.shuffle(foes).slice(0, captains)) {
    if (elite) Object.assign(c, foeOrder(rng, c))
    for (let k = 0; k < cohort; k++) {
      const slot = nearestOpen(FORMATION, c.slot, taken)
      if (slot < 0) break
      taken.add(slot)
      foes.push({ id: c.id, lvl, slot, cohortOf: c.slot })
    }
  }
  return foes
}

// An elite captain's order, drawn from its kind's foeOrders: Stay, Hunt, or a flank, which walks to the open
// ground beside your camp on the wing nearer it (either, from the middle lane) and Hunts from there.
function foeOrder (rng, captain) {
  const order = rng.pick(unitDef(captain.id).foeOrders)
  if (order !== 'flank') return { order }
  const lane = colOf(captain.slot)
  const wing = lane * 2 < LANES - 1 ? 0 : lane * 2 > LANES - 1 ? LANES - 1 : rng.pick([0, LANES - 1])
  return { order, square: tileAt(wing, CAMP_ROWS) }
}

// What createBattle needs in the current room, with copies of the fielded souls so the UI can rebuild
// the same battle. Leaves the run untouched: the foes take the next free uids, and fight() claims them.
// `party`, `detachments` and `seed` override the fielded souls (with their cohorts), the detachments and the
// room's seed, for a rehearsal. The Monarch's domain and Will go with it. The cohorts stand as armyLayout
// says: their members join the party as battle units { cohortOf, rank: true } at the muster level, and the
// bodies with no room on the board make up the reserve, in order, after the held detachments (captains and
// bodies, each with its detachment's `when`); members take uids after the foes', then the held bodies, then
// the reserve's, and shadows after them all. Every unit of a detachment (a captain, its cohort) carries
// `det` and its plan; `detachments` lists those that take part, for the renderer.
// The foes (foeUnits): the room's formation stands from the start, and its later waves wait at the end of
// the reserve, each foe with `side: 'foe'`, its `wave`, its slot's `lane` and the wave's `when`; the foes take
// the first uids, the formation's then each wave's in order. With `scout`, the setup is the room as a player
// knows it: the elite captains' orders, never shown, are left out (they and their cohorts Hunt), for a
// rehearsal that must not fight on what it cannot know.
export function battleSetup (run, { party = fielded(run.state.party), seed = null, detachments = run.state.detachments, scout = false } = {}) {
  const s = run.state
  const node = currentNode(run)
  const boss = node.type === 'boss'
  const army = armyLayout(s, party, detachments)
  const orders = (uid) => {
    const d = detachmentOf(s, uid, detachments)
    return d ? { det: d.id, plan: { where: d.plan.where, square: d.plan.square } } : {}
  }
  const start = (uid) => ({ when: detachmentOf(s, uid, detachments).plan.when })
  const foes = foeUnits(node, s.nextUid, scout)
  let uid = s.nextUid + foes.length
  const body = (b, slot) => ({ ...makeUnit(b.id, { uid: uid++, lvl: s.muster, slot }), cohortOf: b.cohortOf, rank: true, ...orders(b.cohortOf) })
  const members = army.members.map((b) => body(b, b.slot))
  const held = army.held.map((h) => h.uid !== undefined
    ? { ...party.find((u) => u.uid === h.uid), slot: -1, ...orders(h.uid), ...start(h.uid) }
    : { ...body(h, -1), ...start(h.cohortOf) })
  // Bodies with no room on the board sit the battle out unless TUNING.army.overflow (necessity round 2): only a
  // held detachment enters once the battle is under way, so a later start is the only way more than the board's
  // bodies fight.
  const reserve = TUNING.army.overflow ? army.reserve.map((b) => body(b, -1)) : []
  const away = new Set(held.map((u) => u.uid))
  const units = [...party.filter((u) => !away.has(u.uid)).map((u) => ({ ...u, ...orders(u.uid) })), ...members]
  const taking = new Set([...units, ...held, ...reserve].filter((u) => u.det !== undefined && (u.slot < 0 || u.hp > 0)).map((u) => u.det))
  return {
    party: units,
    reserve: [...held, ...reserve, ...foes.filter((f) => f.wave)],
    detachments: detachments.filter((d) => taking.has(d.id)).map((d) => ({ id: d.id, color: d.color, ...d.plan })),
    foes: foes.filter((f) => !f.wave),
    seed: seed ?? `${s.seed}|${s.floor}|${node.id}`,
    floor: s.floor,
    // The foes' 8-step rules hold only in the deep (TUNING.spawn.endless.rules floors past the Sovereign's).
    foeRules: depthOf(s.floor) >= TUNING.spawn.endless.rules,
    boss,
    camp: s.camp,
    walls: wallTiles(s.camp),
    partyMods: relicDefs(s).flatMap((r) => r.mods ?? []),
    foeMods: foeMods(s.floor, boss),
    domain: domainOf(s),
    will: s.monarch.will,
    nextUid: uid,
    keystones: s.keystones.slice(),
    relics: s.relics.slice(),
    ...(s.ablate && { ablate: s.ablate.slice() })
  }
}

// A room's foes as battle units, uids from `uid` on: a captain's cohort with `cohortOf` (its captain's uid) and
// `rank: true`, an elite's captain and its cohort with the plan of its order (FOE_ORDERS; none when `scout`);
// a later wave's foes off the board (slot −1) with what they wait for (see battleSetup).
function foeUnits (node, uid, scout = false) {
  const out = []
  for (const [k, foes] of [node.foes, ...(node.waves ?? []).map((w) => w.foes)].entries()) {
    const uids = new Map(foes.map((f, i) => [f.slot, uid + i]))
    const plan = (f) => !scout && f?.order && { plan: { where: FOE_ORDERS[f.order].where, square: f.square ?? null } }
    for (const [i, f] of foes.entries()) {
      const captain = f.cohortOf != null ? foes.find((c) => c.slot === f.cohortOf) : f
      out.push({
        ...makeUnit(f.id, { uid: uid + i, lvl: f.lvl, slot: k ? -1 : f.slot }),
        ...(f.cohortOf != null && { cohortOf: uids.get(f.cohortOf), rank: true }),
        ...plan(captain),
        ...(k && { side: 'foe', wave: k, lane: colOf(f.slot), when: { ...node.waves[k - 1].when, wave: k } })
      })
    }
    uid += foes.length
  }
  return out
}

function finishBattle (run) {
  const b = run.battle
  const s = run.state
  const byUid = new Map(b.units.map((u) => [u.uid, u]))
  for (const u of s.party) {
    const bu = byUid.get(u.uid)
    if (bu) u.hp = bu.hp > 0 ? Math.max(1, Math.round(bu.hp / bu.maxHp * u.maxHp)) : 0
  }
  // Rank-and-file who fell lie with the fallen until an altar; the reserve that never entered still stands.
  for (const u of b.units) {
    if (!u.rank || u.side !== 'party' || u.hp > 0) continue
    const bones = (s.ossuary[u.id] ??= { standing: 0, fallen: 0 })
    bones.standing--
    bones.fallen++
  }
  fitCohorts(s)
  // Hollow Court: the shadows still standing stay, as rank-and-file of their kind.
  for (const u of keptShadows(run)) (s.ossuary[u.id] ??= { standing: 0, fallen: 0 }).standing++
  s.stats.fights++
  if (b.winner !== 'party') {
    s.phase = 'over'
    // A fall in the deep, past the Sovereign, leaves the clear standing.
    if (s.result !== 'victory') s.result = 'defeat'
    s.death = b.reason === 'monarch' ? { ...b.death, reason: 'monarch' } : { by: null, reason: b.reason, threat: 'clock' }
    return
  }
  s.stats.wins++
  const earned = Math.round(battleEssence(b) * (1 + relicSum(s, 'essence')))
  s.essence += earned
  s.stats.essence += earned
  for (const u of s.party) {
    if (isMonarch(u) && holds(s, 'unhealable')) continue
    if (u.hp > 0) u.hp = Math.min(u.maxHp, u.hp + Math.ceil(u.maxHp * TUNING.run.postBattleHeal))
  }
  const node = currentNode(run)
  if (node.type === 'boss') {
    s.stats.floorsCleared++
    s.phase = 'over'
    s.result = 'victory'
    return
  }
  s.offers = [...soulOffers(run, b), ...bindOffers(b, keptShadows(run)), ...(node.type === 'elite' ? [...relicOffers(s, TUNING.essence.eliteRelics), ...keystoneOffers(s)] : [])]
  s.freeBinds = 1 + s.monarch.will
  s.phase = 'reap'
}

// ── progression: the retinue ─────────────────────────────────────────────────────────────────────

// Every foe slain pays essence, more for higher tiers and levels; it all goes to one purse. Only real foes
// pay: a shadow (of either side) was paid for once already, as the corpse it rose from.
export const foeEssence = (u) => TUNING.essence.perTier * unitDef(u.id).tier * (1 + TUNING.essence.perLevel * (u.lvl - 1))
const battleEssence = (battle) => battle.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0).reduce((n, u) => n + foeEssence(u), 0)
// What each foe wave of a battle paid (the formation's first), before relics: a siege pays wave by wave,
// and a boss's crumbled court as if slain.
export function essenceByWave (battle) {
  const out = battle.waveAt.map(() => 0)
  for (const u of battle.units) if (u.side === 'foe' && !u.shadow && u.hp <= 0) out[u.wave ?? 0] = (out[u.wave ?? 0] ?? 0) + foeEssence(u)
  return Array.from(out, (v) => v ?? 0)
}

// Prices, after the relics' discounts.
const price = (run, base, discount) => Math.max(1, Math.round(base * (1 - relicSum(run.state, discount))))
export const levelCost = (run, u) => price(run, TUNING.level.cost * Math.pow(u.lvl, TUNING.level.exponent), 'levelDiscount')
export const tierCost = (run, u, path = u.path) => price(run, TUNING.essence.tier[nextTier(u, path)], 'tierDiscount')
export const recruitCost = (run, id, lvl) => price(run, TUNING.essence.recruit * unitDef(id).tier * (1 + TUNING.essence.perLevel * (lvl - 1)), 'recruitDiscount')

const canLevel = (run, u) => !isMonarch(u) && u.lvl < TUNING.level.cap && run.state.essence >= levelCost(run, u)
// The next tier on `path`: tiers I–III of the path a soul commits to with its first; for a Knight one more,
// tier IV there or tier I of a second path (one that does not clash with the first: pathsClash); for a
// Marshal both, and the second path's tiers II–III besides.
export function canAdvance (u, path) {
  if (isMonarch(u) || !pathDef(u.id, path)) return false
  const grade = u.grade ?? 0
  const tier2 = u.tier2 ?? 0
  if (u.path === null || u.path === path) return u.tier < 3 || (u.tier === 3 && grade >= 1 && (grade === 2 || !tier2))
  if ((u.path2 ?? null) !== null && u.path2 !== path) return false
  if (pathsClash(u.id, u.path, path)) return false
  return tier2 ? grade === 2 && tier2 < 3 : grade === 2 || (grade === 1 && u.tier < 4)
}
// Which tier on `path` a soul takes next (0 for its tier I): on its path's, or on its second path's.
export const nextTier = (u, path) => (u.path === null || u.path === path ? u.tier : u.tier2 ?? 0)
// The soul with its next tier on `path`, as a copy.
export const advanced = (u, path) => (u.path === null || u.path === path
  ? { ...u, path, tier: u.tier + 1 }
  : { ...u, path2: path, tier2: (u.tier2 ?? 0) + 1 })
const canUpgrade = (run, u, path) => canAdvance(u, path) && run.state.essence >= tierCost(run, u, path)

function pay (run, cost) {
  const s = run.state
  if (s.essence < cost) throw new Error('not enough essence')
  s.essence -= cost
  s.stats.spent += cost
}

function advance (u, path) {
  if (!canAdvance(u, path)) throw new Error(`no tier ${nextTier(u, path) + 1} on ${path} for ${u.id}`)
  Object.assign(u, advanced(u, path))
}

// A level-up raises maxHp and heals by the difference; the fallen stay at 0. The Monarch's level has no cap.
function setLevel (u, lvl) {
  const before = u.maxHp
  u.lvl = isMonarch(u) ? lvl : Math.min(TUNING.level.cap, lvl)
  u.maxHp = baseStats(u.id, u.lvl).hp
  if (u.hp > 0) u.hp = Math.min(u.maxHp, u.hp + u.maxHp - before)
}

export function medianLevel (party) {
  const lv = party.map((u) => u.lvl).sort((a, b) => a - b)
  return lv.length ? lv[Math.floor((lv.length - 1) / 2)] : START_LEVEL
}

// ── progression: the foes ────────────────────────────────────────────────────────────────────────

const at = (list, floor) => list[Math.min(floor, list.length) - 1]

// Foes grow floor by floor and, across a floor, rank by rank: the floor's last room is `levelRamp`
// levels above its first.
export const foeLevel = (floor, rank = 1) => {
  const sp = TUNING.spawn
  return Math.max(1, Math.round(1 + (floor - 1) * sp.levelPerFloor + sp.levelRamp * (rank - 1) / (RANKS - 2)))
}

// Floors past the Sovereign's (TUNING.run.floors): 0 down to it, then 1, 2… An endless floor takes its
// camps and its spawn pool from the last floor's.
export const depthOf = (floor) => Math.max(0, floor - TUNING.run.floors)
const poolFloor = (floor) => Math.min(floor, TUNING.run.floors)

// What a room `depth` floors past the Sovereign's adds to its foes (TUNING.spawn.endless): levels and
// foes a wave per floor deep, and more of both in the floor's last room, its big elite; and the enemy's own
// Command and Dominion, as it were: more waves to a room and bigger cohorts behind each captain, floor by
// floor. Nothing above the deep. → { level, count, waves, cohort }
export function deepGrowth (floor, node) {
  const E = TUNING.spawn.endless
  const deep = depthOf(floor)
  const final = deep > 0 && node.rank === RANKS - 1
  return {
    level: deep * E.level + (final ? E.final.level : 0),
    count: Math.floor(deep * E.count) + (final ? E.final.count : 0),
    waves: Math.floor(deep * E.waves),
    cohort: Math.floor(deep * E.cohort)
  }
}

// Spawnable units for a floor, weighted toward the floor's target tier.
function spawnPool (floor, tierBias = 0) {
  const sp = TUNING.spawn
  const target = Math.min(sp.tierMax, 1 + Math.floor((floor - 1) * sp.tierPerFloor)) + tierBias
  const units = UNIT_LIST.filter((u) => u.spawn && u.spawn.minFloor <= floor && u.tier <= target + sp.tierOverCap)
  return { units, weights: units.map((u) => u.spawn.weight / Math.pow(1 + Math.abs(u.tier - target), sp.tierFalloff)) }
}

// In the boss's room only the boss takes the boss's multipliers; its waves and court take the floor's. Past
// the Sovereign's floor every floor deeper adds TUNING.spawn.endless's hp and atk shares to them all.
export function foeMods (floor, boss) {
  const sp = TUNING.spawn
  const grow = (key) => 1 + sp.endless[key] * depthOf(floor)
  const mods = [{ path: 'hp', op: 'mul', v: at(sp.foeHp, floor) * grow('hp') }, { path: 'atk', op: 'mul', v: at(sp.foeAtk, floor) * grow('atk') }]
  if (!boss) return mods
  return [
    { path: 'hp', op: 'mul', v: sp.bossHp * grow('hp'), who: { boss: true } },
    { path: 'atk', op: 'mul', v: sp.bossAtk * grow('atk'), who: { boss: true } },
    ...mods.map((m) => ({ ...m, who: { boss: false } }))
  ]
}

// ── rewards ──────────────────────────────────────────────────────────────────────────────────────

// One soul for sale per kind of foe slain, rising at the level that foe fought at. A foe shadow is no foe's soul
// (it rose from one of yours: the Legion, Undead 8, on the foes' side).
function soulOffers (run, battle) {
  const s = run.state
  const slain = battle.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0)
  return [...new Set(slain.map((u) => u.id))].map((id) => {
    const lvl = Math.min(TUNING.level.cap, Math.max(...slain.filter((u) => u.id === id).map((u) => u.lvl)) + relicSum(s, 'soulLevel'))
    return { type: 'soul', id, lvl, cost: recruitCost(run, id, lvl), name: unitDef(id).name, desc: `Rises at level ${lvl}.` }
  })
}

// The slain may be bound as rank-and-file: one offer per kind, for as many as fell (real foes only). A corpse
// whose shadow Hollow Court keeps (`kept`) is already in the ossuary: it is not bound twice.
function bindOffers (battle, kept = []) {
  const gone = new Set(kept.map((u) => u.corpse))
  const slain = battle.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0 && !unitDef(u.id).boss && !gone.has(u.uid))
  return [...new Set(slain.map((u) => u.id))].map((id) => {
    const max = slain.filter((u) => u.id === id).length
    return { type: 'bind', id, max, name: unitDef(id).name, desc: `${max} slain may rise as rank-and-file.` }
  })
}

// A rite offers free tiers: up to `n` of the next tiers your souls could take, each for a different
// soul where it can.
function riteOffers (run, n) {
  const s = run.state
  const rng = createRng(s.seed).stream(`rite|${s.floor}|${s.at}`)
  const options = rng.shuffle(s.party.flatMap((u) => pathsOf(u.id).filter((p) => canAdvance(u, p.id)).map((p) => ({ u, p }))))
  const picked = [...options.filter((o, i) => options.findIndex((x) => x.u === o.u) === i), ...options].filter((o, i, all) => all.indexOf(o) === i).slice(0, n)
  return picked.map(({ u, p }) => {
    const next = nextTier(u, p.id)
    return { type: 'tier', uid: u.uid, path: p.id, name: `${unitDef(u.id).name}: ${p.name} ${ROMAN[next]}`, desc: pathDef(u.id, p.id).tiers[next].desc }
  })
}

function relicOffers (s, n) {
  // A retinue carries at most TUNING.essence.relicMax relics (necessity round 2: relics weighed too much).
  if (s.relics.length >= TUNING.essence.relicMax) return []
  const rng = createRng(s.seed).stream(`relics|${s.floor}|${s.at}`)
  return rng.shuffle(RELIC_LIST.filter((r) => !s.relics.includes(r.id)))
    .slice(0, n)
    .map((r) => ({ type: 'relic', id: r.id, name: r.name, desc: r.desc }))
}

// From floor TUNING.keystone.fromFloor, an elite won and a rite each lay out TUNING.keystone.offer keystones
// the run does not hold, free, one to take, until it holds TUNING.keystone.max.
function keystoneOffers (s) {
  const k = TUNING.keystone
  if (s.floor < k.fromFloor || s.keystones.length >= k.max) return []
  const rng = createRng(s.seed).stream(`keystones|${s.floor}|${s.at}`)
  return rng.shuffle(KEYSTONE_LIST.filter((d) => !s.keystones.includes(d.id)))
    .slice(0, k.offer)
    .map((d) => ({ type: 'keystone', id: d.id, name: d.name, desc: d.desc }))
}
