// The run: a state machine over map → prep → reap → map, floor by floor.
// apply(run, action) is the only way to change it, legalActions(run) lists what apply accepts now,
// and the log of applied actions replays the run exactly: replay(seed, log).
//
// Battles take no input. The player's part is the retinue: which souls it recruits, keeps and lets go,
// what it spends its essence on, which souls stand in the camp, where, and the lines they walk. Slain foes
// pay essence; it buys levels and track tiers for a kind, recruits, and the Monarch's stats. Each floor draws
// its camp, a 7×7 walled layout, on arrival.
//
// The Monarch is you: a party unit with uid MONARCH_UID that stands on a seat of the camp (its rear SEAT_ROWS
// rows) but can never be put in the ossuary, released, levelled or upgraded, and counts toward no cap. It has
// four stats, bought a point at a time (MONARCH_STATS): HP (its level: its max HP grows with it), Dominion (its
// domain's reach), Command (the field cap: how many souls fight) and Will (Arise's raises, their tier, and how
// soon it casts). It never steps: the roads run to it (battle.js field). If it falls, the battle is lost and so
// is the run.
//
// Pieces and stacks (DESIGN §2.2): the party is pieces, each one kind with a `count` of bodies, one soul a body,
// its HP one pool (count × body HP: unit.js makeUnit). A soul recruited is a piece of one; `stack` puts a piece
// onto another of its kind (one piece, the bodies and the HP of both), `split` takes bodies off one into a new
// piece (the hindmost: the fallen first, then the one wounded, then the whole ones: unit.js bodiesHp). Nothing
// stacks or splits by itself. A body fallen in battle stays down, as a fallen soul does: a won battle's heal and a
// level's HP go to the living bodies, and only an altar raises the fallen.
//
// The ossuary: your collection of souls. Every piece not on the field waits there (slot OSSUARY, −1); you field
// the ones you want, up to the field cap (fieldCap: TUNING.party.field + Command, relics and keystones, never more
// than TUNING.army.board), a stack one piece whatever its count, and the ossuary and the field together hold at
// most rosterCap souls (bodies). After a win you may recruit one of the slain, a full soul at the level it fought
// at, for essence: a piece of its own, or straight onto a fielded piece of its kind (`onto`).
//
// The army: the pieces fielded, and the bodies their kinds' track tiers add each battle (a tier's `count`,
// content.js TRACKS: battle.js), whole, in the piece's pool; they are the battle's alone, the first to fall.
//
// Kinds (DESIGN §2.8): upgrades belong to the kind, not the soul. s.kinds[id] = { lvl, tracks: [tier, tier] }
// is every soul of the kind's level and the tiers it holds on the kind's two tracks (content.js TRACKS, with
// the crosspath rule: unit.js canTrack); each soul of the kind carries a copy (u.lvl, u.tracks). A kind's
// state stays once made, whether or not a soul of it is left. A soul recruited joins its kind at the kind's
// level, or raises the kind to its own, whichever is higher. A front-line kind's first track ends in a Banner
// (content.js BANNER): in battle the pieces placed beside it walk its line (battle.js follow).
//
// Lines (DESIGN §2.4): a fielded soul may have a line, its march for the battle (s.lines[uid]: { tiles, when }):
// board tiles from its cell's, each a legal step from the one before, and the signal it waits for (content.js
// SIGNALS). A soul with none holds its cell. Lines stand from battle to battle; moving a soul clears its line,
// and a new floor's camp clips each at its first step its walls now block. The battle walks them (battle.js).
//
// Keystones: rules that rewrite the game (KEYSTONE_LIST), offered free at won elites and at rites from floor
// TUNING.keystone.fromFloor, never one the run holds, up to TUNING.keystone.max a run (s.keystones). Most of
// them bend the battle (battle.js); Legion's field, the domain's size, Hollow Court's shadows reaped and
// Court of Bone's Monarch that nothing heals are the run's to apply. Nothing revives the Monarch.
//
// The enemy is an army too (drawRoom): from floor 2 its rooms have captains, each one piece with its cohort's
// bodies (a count); a floor-1 elite
// brings a late pair; from floor 3 rooms come in waves, and a siege room is one battle of three. The last room
// is a siege whose last wave is the Hollow Sovereign and its court; its fall ends the battle.
//
// `fight` resolves the whole battle at once; run.setup is what it was built from, so the UI can play it
// back tick by tick.
//
//   phase            action
//   map              { type: 'node', id }           walk to a connected room (a battle room, a siege too, opens prep)
//   map, prep        { type: 'place', uid, slot }   move a soul to an open camp slot (0–48), or the Monarch to
//                                                   a seat (isSeat), or a soul to the ossuary (OSSUARY, −1);
//                                                   a unit already there takes the mover's old place (never
//                                                   the ossuary, nor off the seats, for the Monarch); a soul
//                                                   from the ossuary only while the field has room, or onto
//                                                   another soul's cell (a swap); whoever moves loses its line
//   map, prep        { type: 'stack', uid, onto }   put piece `uid` onto piece `onto` of its kind: one piece of
//                                                   both counts and both pools, where `onto` stands, with its
//                                                   line; `uid` and its line are gone
//   map, prep        { type: 'split', uid, n, slot }  take `n` bodies (1 to count − 1) off piece `uid` into a new
//                                                   piece of its kind, the hindmost (see above), at `slot`: a
//                                                   free open camp cell while the field has room, or the ossuary
//                                                   (OSSUARY, the default)
//   map, prep        { type: 'level', kind }        buy a kind you hold its next level (every soul of it)
//   map, prep        { type: 'upgrade', kind, track }  buy a kind you hold its next tier on track 0 or 1
//   map, prep        { type: 'monarch', stat }      buy the Monarch a point of 'hp', 'dominion', 'command' or 'will'
//   map, prep, reap  { type: 'release', uid }       let a soul go (never the last one standing)
//   prep             { type: 'fight' }              the battle plays out; the run moves on by itself
//   reap             { type: 'reap', index, onto }  take offer `index` (recruit one soul for its price, a
//                                                   free relic, a free tier, a free keystone), or null to move on;
//                                                   a soul with `onto` joins that fielded piece of its kind
//   map, prep        { type: 'line', uid, tiles, when }  a fielded soul's line (cleanLine): `tiles` its march,
//                                                   `when` the signal it waits for ({ at: 'once' } if left out);
//                                                   no tiles (null or []) clears it: the soul holds
//   over             { type: 'descend' }            the Sovereign slain (result 'victory'): on to the endless
//                                                   floors, each deeper than the last; nothing after a fall
//
// Endless floors: beating the Sovereign on the last floor (TUNING.run.floors) is a clear, recorded for good
// (s.result 'victory'), and the run stops there, over, unless the player descends. Floors past it reuse the
// last floor's camps and foes, growing with every floor deeper (TUNING.spawn.endless), and each ends in a big
// elite; past it the floors simply go on. A fall in the deep ends the run as any defeat does (s.death says
// what felled the Monarch) but leaves the clear standing: s.result stays 'victory'.
import { TUNING } from '../tuning.js'
import { UNIT_LIST, relicDef, unitDef, RELIC_LIST, CAMP_LIST, KEYSTONE_LIST, keystoneDef, THREATS, SIGNALS } from '../content.js'
import { createRng } from './rng.js'
import {
  makeUnit, autoPlace, slotAt, CAMP_SLOTS, baseStats, onField, CENTRE_OUT, campGrid, campOpen, wallTiles, tracksOf, canTrack, nextTracks,
  nearestOpen, deployTile, colOf, TILES, tileX, tileY, tileAt, onBoard, steps, FORMATION, SLOTS, seatNear, isSeat, bodyHp, livingBodies,
  bodiesHp
} from './unit.js'
import { createBattle, playOut } from './battle.js'
import { generateFloor, nodeOf, RANKS } from './map.js'

export const START_PARTY = ['tomb_knight', 'bone_chanter', 'frost_sprite']
export const MONARCH_UID = 0
export const MONARCH_STATS = ['hp', 'dominion', 'command', 'will']
// The slot of a soul in the ossuary: kept, not fighting.
export const OSSUARY = -1
const START_LEVEL = 2
const BATTLE_NODES = ['fight', 'elite', 'boss', 'siege']
const ROMAN = ['I', 'II', 'III', 'IV']
const BOSS = UNIT_LIST.find((u) => u.boss).id

// The Monarch starts on the camp's rear row, in the middle lane (or the seat nearest it), and the start souls
// fill the camp from its front row, middle lanes first. `death` is what felled the Monarch, once something has.
// The ossuary starts empty: every start soul is fielded. No lines: every soul holds. No keystones (ids, in the
// order taken).
// `ablate` (the autoplayer's ablation reports only, never a player's run): battle rules taken from the party in
// every battle of the run, carried in each battle's setup (battle.js createBattle: 'arise', 'synergies'). A run
// made without it has no such field, as before.
export function createRun ({ seed, ablate = null }) {
  const state = {
    seed, floor: 1, phase: 'map', map: null, camp: null, at: null, party: [], relics: [], offers: [],
    essence: TUNING.essence.start, result: null, death: null, monarch: { hp: 0, dominion: 0, command: 0, will: 0 },
    kinds: Object.fromEntries(START_PARTY.map((id) => [id, { lvl: START_LEVEL, tracks: [0, 0] }])), lines: {}, keystones: [],
    stats: { fights: 0, wins: 0, reaped: 0, essence: 0, spent: 0, floorsCleared: 0 }, log: [], nextUid: 1
  }
  state.party = [
    makeUnit('monarch', { uid: MONARCH_UID, lvl: 0 }),
    ...START_PARTY.map((id) => makeUnit(id, { uid: state.nextUid++, lvl: START_LEVEL }))
  ]
  if (ablate?.length) state.ablate = ablate.slice()
  const run = { state, battle: null, setup: null }
  enterFloor(run)
  monarchOf(state).slot = seatNear(state.camp)
  autoPlace(state.party, { grid: campGrid(state.camp) })
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
    const offers = s.offers.flatMap((o, index) => (canTake(run, o)
      ? [{ type: 'reap', index }, ...(o.type === 'soul' ? fielded(souls(s.party)).filter((u) => u.id === o.id).map((u) => ({ type: 'reap', index, onto: u.uid })) : [])]
      : []))
    return [...offers, { type: 'reap', index: null }, ...releasable(s).map((u) => ({ type: 'release', uid: u.uid }))]
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
  for (const u of souls(s.party)) {
    for (const v of souls(s.party)) if (canStack(s, u, v)) out.push({ type: 'stack', uid: u.uid, onto: v.uid })
    for (let n = 1; n < u.count; n++) {
      for (let slot = -1; slot < CAMP_SLOTS; slot++) if (canSplit(run, u, n, slot)) out.push({ type: 'split', uid: u.uid, n, slot })
    }
  }
  for (const kind of heldKinds(s)) {
    if (canLevel(run, kind)) out.push({ type: 'level', kind })
    for (const track of [0, 1]) if (canUpgrade(run, kind, track)) out.push({ type: 'upgrade', kind, track })
  }
  out.push(...MONARCH_STATS.filter((stat) => canCrown(run, stat)).map((stat) => ({ type: 'monarch', stat })))
  out.push(...lineActions(run))
  out.push(...releasable(s).map((u) => ({ type: 'release', uid: u.uid })))
  return out
}

// The lines a player could draw now, sampled so the list stays short (apply takes any legal line; these are a
// representative few): for each fielded soul, straight up its lane for each of LINE_MENU's lengths (as far as
// walls and the board's edge let it), the shorter on every signal of WHEN_MENU, the longer at once; and its
// line cleared, if it has one.
const LINE_MENU = [2, 5]
const WHEN_MENU = [{ at: 'once' }, { at: 'time', t: 100 }, { at: 'blow' }, { at: 'wave', wave: 1 }, { at: 'struck' }, { at: 'falls' }]
function lineActions (run) {
  const s = run.state
  const walls = new Set(wallTiles(s.camp))
  const out = []
  for (const u of fielded(souls(s.party))) {
    for (const [k, n] of LINE_MENU.entries()) {
      const tiles = []
      for (let t = deployTile('party', u.slot); tiles.length < n && onBoard(tileX(t), tileY(t) + 1) && steps(t, walls).includes(t + UP); t += UP) tiles.push(t + UP)
      if (tiles.length) out.push(...(k ? WHEN_MENU.slice(0, 1) : WHEN_MENU).map((when) => ({ type: 'line', uid: u.uid, tiles, when })))
    }
    if (s.lines[u.uid]) out.push({ type: 'line', uid: u.uid, tiles: null })
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
// Whether the run holds a keystone with this rule (KEYSTONE_LIST: reap, unhealable…).
export const holds = (s, key) => s.keystones.some((id) => keystoneDef(id)[key])
// Hollow Court: the shadows Arise raised (`arisen`; a party shadow raised any other way is not one) that
// still stood when the battle last fought was won, if it was fought under the keystone: each pays its essence
// again (finishBattle). The rules it was fought with decide (run.setup), not the keystones held now: one taken
// on the spoils reaps nothing of the battle before it.
export const reapedShadows = (run) => run.battle && run.battle.winner === 'party' && run.setup?.keystones?.some((id) => keystoneDef(id).reap)
  ? run.battle.units.filter((u) => u.arisen && u.side === 'party' && u.hp > 0) : []
// The field cap counts pieces (a stack is one), the roster souls (a stack's every body): the Monarch takes no room
// in either. Command adds a piece to the field a point, up to as many as the board holds (and so do Legion's two).
// The souls every Monarch fields: TUNING.party.field, and fieldPerFloor more a floor down (to the Sovereign's;
// 0 now: Command alone widens the field).
export const baseField = (s) => TUNING.party.field + TUNING.party.fieldPerFloor * (Math.min(s.floor, TUNING.run.floors) - 1)
export const fieldCap = (run) => Math.min(TUNING.army.board, baseField(run.state) + run.state.monarch.command + relicSum(run.state, 'field') + keystoneSum(run.state, 'field'))
// How many souls the retinue holds, on the field and in the ossuary together, stacked or not.
export const rosterCap = (run) => TUNING.party.roster + relicSum(run.state, 'roster')
// The souls (bodies) in these pieces.
export const soulCount = (party) => souls(party).reduce((n, u) => n + u.count, 0)
export const fielded = (party) => party.filter(onField)
// The souls in the ossuary: kept, not fielded.
export const inOssuary = (party) => party.filter((u) => !onField(u))
export const isMonarch = (u) => u.uid === MONARCH_UID
export const monarchOf = (s) => s.party.find(isMonarch)
// The party without the Monarch: what the caps, the ossuary and the offers count.
export const souls = (party) => party.filter((u) => !isMonarch(u))

// ── the Monarch ──────────────────────────────────────────────────────────────────────────────────

// The points bought, on all four stats: a point costs more the more it has.
export const monarchPoints = (s) => MONARCH_STATS.reduce((n, k) => n + s.monarch[k], 0)
export const monarchCost = (run) => TUNING.monarch.cost + TUNING.monarch.costPerPoint * monarchPoints(run.state)
const canCrown = (run, stat) => MONARCH_STATS.includes(stat) && run.state.essence >= monarchCost(run)

// How far its domain reaches (Chebyshev, in tiles, from the Monarch's tile; keystones bend it, never below 0):
// Arise raises the foes that fall inside it (unit.js domainTiles lists its tiles).
export const domainOf = (s) => Math.max(0, TUNING.monarch.domain + s.monarch.dominion + keystoneSum(s, 'domain'))

// ── lines ────────────────────────────────────────────────────────────────────────────────────────

// One step up the board, toward the foes.
const UP = tileAt(0, 1)
// The longest line: as many steps as the board has tiles.
export const LINE_MAX = TILES

// A signal as the run keeps it (content.js SIGNALS), or null if it is none: 'time' with a tick `t` from 1 to
// before the battle's ceiling, 'wave' with a wave from 1 to before TUNING.spawn.endless.maxWaves, the rest bare.
export function cleanWhen (when = { at: 'once' }) {
  if (!when || typeof when !== 'object' || !Object.hasOwn(SIGNALS, when.at)) return null
  if (when.at === 'time') return Number.isInteger(when.t) && when.t >= 1 && when.t < TUNING.tick.ceiling ? { at: 'time', t: when.t } : null
  if (when.at === 'wave') return Number.isInteger(when.wave) && when.wave >= 1 && when.wave < TUNING.spawn.endless.maxWaves ? { at: 'wave', wave: when.wave } : null
  return { at: when.at }
}

// Whether `tiles` is a march from board tile `from` past `walls` (a Set): 1 to LINE_MAX board tiles, each a legal
// step from the one before (unit.js steps: no wall, no squeeze past a wall's corner). It may cross tiles other
// pieces hold and run anywhere on the board.
export const isMarch = (from, tiles, walls) => Array.isArray(tiles) && tiles.length >= 1 && tiles.length <= LINE_MAX &&
  tiles.every((t, i) => Number.isInteger(t) && t >= 0 && t < TILES && steps(i ? tiles[i - 1] : from, walls).includes(t))

// A line as the run keeps it ({ tiles, when }), or null if it is none: for a fielded soul (never the Monarch, which
// never steps), a march from its cell's tile (isMarch) and a signal (cleanWhen).
export function cleanLine (s, uid, tiles, when) {
  const u = s.party.find((x) => x.uid === uid)
  if (!u || isMonarch(u) || !onField(u)) return null
  const w = cleanWhen(when)
  if (!w || !isMarch(deployTile('party', u.slot), tiles, new Set(wallTiles(s.camp)))) return null
  return { tiles: tiles.slice(), when: w }
}

// A new floor's camp: each line cut short at its first step the camp's walls now block, and gone if none is left.
function clipLines (s) {
  const walls = new Set(wallTiles(s.camp))
  for (const [uid, line] of Object.entries(s.lines)) {
    const from = deployTile('party', s.party.find((u) => u.uid === Number(uid)).slot)
    const k = line.tiles.findIndex((t, i) => !steps(i ? line.tiles[i - 1] : from, walls).includes(t))
    if (k === 0) delete s.lines[uid]
    else if (k > 0) s.lines[uid] = { ...line, tiles: line.tiles.slice(0, k) }
  }
}

// ── the retinue: placing, releasing, buying ─────────────────────────────────────────────────────

// The Monarch only ever stands on a seat (isSeat): it never goes to the ossuary, nor to a cell off the seats,
// whether it moves or a soul swaps cells with it (so a soul from the ossuary never takes its cell). A soul leaves
// the ossuary for an open cell only while the field has room (fieldCap: Command).
function canPlace (run, u, slot) {
  const camp = run.state.camp
  if (slot === u.slot || (slot !== -1 && !campOpen(camp, slot))) return false
  if (isMonarch(u) && !isSeat(camp, slot)) return false
  const other = slot >= 0 && run.state.party.find((x) => x.slot === slot)
  if (other && isMonarch(other) && !isSeat(camp, u.slot)) return false
  return onField(u) || !!other || fielded(souls(run.state.party)).length < fieldCap(run)
}

// Releasing must leave a soul who can still fight; the Monarch is never released.
function releasable (s) {
  const all = souls(s.party)
  return all.length > 1 ? all.filter((u) => all.some((x) => x !== u && x.hp > 0)) : []
}

// The Monarch alone may fight (and will likely fall).
const canFight = (s) => s.party.some((u) => onField(u) && u.hp > 0)

// Stacking: two pieces of one kind (never the Monarch), either fielded or in the ossuary.
const canStack = (s, u, v) => !!u && !!v && u !== v && !isMonarch(u) && !isMonarch(v) && u.id === v.id && s.party.includes(u) && s.party.includes(v)
// Splitting `n` bodies off a piece: 1 to count − 1 of them, to the ossuary, or to a free open cell of the camp
// while the field has room for one more piece.
function canSplit (run, u, n, slot) {
  if (!u || isMonarch(u) || !Number.isInteger(n) || n < 1 || n >= u.count) return false
  if (slot === OSSUARY) return true
  const s = run.state
  return campOpen(s.camp, slot) && !s.party.some((x) => x.slot === slot) && fielded(souls(s.party)).length < fieldCap(run)
}

// A new soul takes a free field slot if there is one, else waits in the ossuary, a piece of one; or with `onto`
// it is a body more in that piece of its kind, whole. It joins its kind: at the kind's level, or, at `lvl` above
// it, raising the kind (every soul of it) to `lvl`; a kind new to the run starts at `lvl` with no tiers.
// Returns the piece it is in.
export function join (run, id, { lvl = medianLevel(souls(run.state.party)), uid = run.state.nextUid++, onto = null } = {}) {
  const s = run.state
  if (unitDef(id).monarch) throw new Error('there is one Monarch')
  if (soulCount(s.party) >= rosterCap(run)) throw new Error('the retinue is full')
  const piece = onto === null ? null : s.party.find((u) => u.uid === onto)
  if (onto !== null && !(piece && piece.id === id && onField(piece))) throw new Error(`no fielded ${id} ${onto} to join`)
  lvl = Math.min(TUNING.level.cap, lvl)
  if (!s.kinds[id]) s.kinds[id] = { lvl, tracks: [0, 0] }
  else if (lvl > s.kinds[id].lvl) levelKind(s, id, lvl)
  const u = makeUnit(id, { uid, lvl: s.kinds[id].lvl, tracks: s.kinds[id].tracks })
  if (piece) {
    piece.count++
    piece.hp += u.hp
    piece.maxHp += u.maxHp
    return piece
  }
  s.party.push(u)
  if (fielded(souls(s.party)).length < fieldCap(run)) autoPlace([...fielded(s.party), u], { grid: campGrid(s.camp) })
  return u
}

// ── action handlers ──────────────────────────────────────────────────────────────────────────────

const HANDLERS = {
  node: { phases: ['map'], run: walk },
  place: { phases: ['map', 'prep'], run: place },
  stack: { phases: ['map', 'prep'], run: stack },
  split: { phases: ['map', 'prep'], run: split },
  level: { phases: ['map', 'prep'], run: level },
  upgrade: { phases: ['map', 'prep'], run: upgrade },
  release: { phases: ['map', 'prep', 'reap'], run: release },
  monarch: { phases: ['map', 'prep'], run: crown },
  line: { phases: ['map', 'prep'], run: line },
  fight: { phases: ['prep'], run: fight },
  reap: { phases: ['reap'], run: reap },
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
    // Every soul heals, in the ossuary too, and a fallen one stands again: body by body, into its pool.
    const t = TUNING.run
    for (const u of s.party) {
      if (isMonarch(u) && holds(s, 'unhealable')) continue
      const b = bodyHp(u)
      u.hp = bodiesHp(u).reduce((n, hp) => n + (hp > 0 ? Math.max(hp, Math.round(b * t.altarHeal)) : Math.ceil(b * t.altarRevive)), 0)
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
  if (other) {
    other.slot = u.slot
    delete s.lines[other.uid]
  }
  u.slot = slot
  delete s.lines[u.uid]
}

// A piece onto another of its kind: one piece, where `onto` stands, with its line.
function stack (run, { uid, onto }) {
  const s = run.state
  const u = s.party.find((x) => x.uid === uid)
  const v = s.party.find((x) => x.uid === onto)
  if (!canStack(s, u, v)) throw new Error(`cannot stack ${uid} onto ${onto}`)
  v.count += u.count
  v.hp += u.hp
  v.maxHp += u.maxHp
  s.party = s.party.filter((x) => x !== u)
  delete s.lines[uid]
}

// `n` bodies off a piece, the hindmost, into a new piece of its kind at `slot`.
function split (run, { uid, n, slot = OSSUARY }) {
  const s = run.state
  const u = s.party.find((x) => x.uid === uid)
  if (!canSplit(run, u, n, slot)) throw new Error(`cannot split ${n} off ${uid} to ${slot}`)
  const hp = bodiesHp(u).slice(u.count - n).reduce((a, b) => a + b, 0)
  const v = makeUnit(u.id, { uid: s.nextUid++, lvl: u.lvl, tracks: u.tracks, count: n, slot })
  v.hp = hp
  u.count -= n
  u.hp -= hp
  u.maxHp -= v.maxHp
  s.party.push(v)
}

function level (run, { kind }) {
  if (!canLevel(run, kind)) throw new Error(`cannot level ${kind}`)
  pay(run, levelCost(run, kind))
  levelKind(run.state, kind, run.state.kinds[kind].lvl + 1)
}

// A point of HP raises the Monarch's max HP (its level) and heals it by the gain, unless nothing may heal it
// (Court of Bone).
function crown (run, { stat }) {
  const s = run.state
  if (!canCrown(run, stat)) throw new Error(`cannot raise the Monarch's ${stat}`)
  pay(run, monarchCost(run))
  s.monarch[stat]++
  if (stat !== 'hp') return
  const m = monarchOf(s)
  const hp = m.hp
  setLevel(m, s.monarch.hp)
  if (holds(s, 'unhealable')) m.hp = hp
}

// A line drawn (cleanLine), or with no tiles cleared.
function line (run, { uid, tiles, when }) {
  const s = run.state
  const u = s.party.find((x) => x.uid === uid)
  if (!u || isMonarch(u) || !onField(u)) throw new Error(`${uid} has no line to draw`)
  if (tiles === null || tiles === undefined || (Array.isArray(tiles) && !tiles.length)) {
    delete s.lines[uid]
    return
  }
  const drawn = cleanLine(s, uid, tiles, when)
  if (!drawn) throw new Error(`not a line for ${uid}: ${JSON.stringify({ tiles, when })}`)
  s.lines[uid] = drawn
}

function upgrade (run, { kind, track }) {
  if (!canUpgrade(run, kind, track)) throw new Error(`cannot upgrade ${kind} on track ${track}`)
  pay(run, tierCost(run, kind, track))
  advance(run.state, kind, track)
}

// Releasing the last soul of a kind withdraws the rite's offers for that kind; a rite left with none ends.
function release (run, { uid }) {
  const s = run.state
  if (!releasable(s).some((u) => u.uid === uid)) throw new Error(`cannot release ${uid}`)
  s.party = s.party.filter((u) => u.uid !== uid)
  delete s.lines[uid]
  if (s.phase !== 'reap') return
  const held = heldKinds(s)
  s.offers = s.offers.filter((o) => o.type !== 'tier' || held.includes(o.kind))
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
function reap (run, { index, onto }) {
  const s = run.state
  const o = index === null ? null : s.offers[index]
  if (index !== null && !o) throw new Error(`no offer ${index}`)
  if (onto != null && !(o?.type === 'soul' && fielded(souls(s.party)).some((u) => u.uid === onto && u.id === o.id))) throw new Error(`offer ${index} cannot join ${onto}`)
  if (o && !canTake(run, o)) {
    throw new Error(o.type !== 'soul' ? `offer ${index} can't be taken` : soulCount(s.party) >= rosterCap(run) ? 'the retinue is full: release a soul first' : 'not enough essence')
  }
  if (o?.type === 'relic') s.relics.push(o.id)
  else if (o?.type === 'keystone') s.keystones.push(o.id)
  else if (o?.type === 'tier') advance(s, o.kind, o.track)
  else if (o?.type === 'soul') {
    pay(run, o.cost)
    join(run, o.id, { lvl: o.lvl, onto: onto ?? null })
    s.stats.reaped++
  }
  s.offers = o ? s.offers.filter((x) => x.type !== o.type) : []
  if (!s.offers.length) nextRoom(run)
}

function canTake (run, o) {
  const s = run.state
  if (o.type === 'soul') return soulCount(s.party) < rosterCap(run) && s.essence >= o.cost
  if (o.type === 'tier') return canAdvance(s, o.kind, o.track)
  if (o.type === 'keystone') return !s.keystones.includes(o.id) && s.keystones.length < TUNING.keystone.max
  return true
}

// ── internals ────────────────────────────────────────────────────────────────────────────────────

// Every battle room's foes are fixed when the floor is made, so the map can show them: `foes`, and `waves`
// for a room with more to come (see drawRoom). The floor's camp is drawn from its list; souls standing on its
// walls move to open ground and lose their lines, and every other line is clipped to the new walls (clipLines).
// A Monarch whose cell is walled takes its seat as a run begins (seatNear: the rear row's middle lane, or the
// seat nearest it that seals no one in).
function enterFloor (run) {
  const s = run.state
  s.map = generateFloor({ seed: s.seed, floor: s.floor, last: s.floor === TUNING.run.floors })
  s.camp = createRng(s.seed).stream(`camp|${s.floor}`).pick(CAMP_LIST.filter((c) => c.floor === poolFloor(s.floor))).id
  const m = monarchOf(s)
  if (onField(m) && !isSeat(s.camp, m.slot)) {
    const seat = seatNear(s.camp, undefined, new Set(souls(fielded(s.party)).map((u) => u.slot)))
    m.slot = seat >= 0 ? seat : seatNear(s.camp)
  }
  const was = new Map(s.party.map((u) => [u.uid, u.slot]))
  autoPlace(fielded(s.party), { grid: campGrid(s.camp) })
  for (const u of s.party) if (u.slot !== was.get(u.uid)) delete s.lines[u.uid]
  clipLines(s)
  for (const n of s.map.nodes) if (BATTLE_NODES.includes(n.type)) Object.assign(n, drawRoom(s.seed, s.floor, n))
  varyRoutes(s)
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
// TUNING.spawn.waves.share of its foes, or t ticks after it began to enter). A foe is a piece { id, lvl, slot },
// in a formation of its own (a wave's slots are its own), and a captain's carries `count`: itself and its cohort.
// What comes, by room (TUNING.spawn):
//   fight   a formation of `fight` foes, floor 3+ from rank waves.fightRank: waves.fight such waves
//   elite   `elite` foes of a higher tier; floor 1: and a late pair of the floor's own pool at late.t;
//           floor 3+: waves.elite waves
//   siege   waves.siege fight-sized waves, from floor 3
//   boss    waves.siege waves, the last the Hollow Sovereign at the centre of its court of `court` undead
// From floor 2 each wave (but the Sovereign's) has captains: captains.fight (captains.elite in an elite) of
// its foes, each one piece leading cohort[floor − 1] more bodies of its own kind.
// Each wave's foes stand from its front row back, filling the middle lanes first, each band of lanes (centre
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
    : formation(rng, list, level, pair && k === waves ? 0 : elite ? sp.captains.elite : sp.captains.fight, at(sp.cohort, floor) + grow.cohort))
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
      foes.push({ id, lvl: level, slot })
    }
    return foes
  }
}

// A wave's formation: `ids` placed from the front row, then `captains` of them (if they lead anyone: `cohort` > 0)
// each one piece with `cohort` more bodies of its kind (`count`).
function formation (rng, ids, lvl, captains, cohort) {
  const foes = ids.map((id) => ({ id, lvl, slot: -1 }))
  const cols = [CENTRE_OUT.slice(0, 3), ...[3, 5].map((i) => CENTRE_OUT.slice(i, i + 2))].flatMap((band) => rng.shuffle(band))
  autoPlace(foes, { cols })
  if (!cohort || !captains) return foes
  for (const c of rng.shuffle(foes).slice(0, captains)) c.count = 1 + cohort
  return foes
}

// What createBattle needs in the current room, with copies of the fielded souls so the UI can rebuild
// the same battle. Leaves the run untouched: the foes take the next free uids, and fight() claims them.
// `party`, `lines` and `seed` override the fielded souls, their lines (by uid) and the room's seed, for a
// rehearsal. Each soul with a line carries it (`line`). The Monarch's domain and Will go with it. Shadows take
// uids after the foes' (the battle makes them: battle.js raise).
// The foes (foeUnits): the room's formation stands from the start, and its later waves wait in the reserve, each
// foe with `side: 'foe'`, its `wave`, its slot's `lane` and the wave's `when`; the foes take the first uids, the
// formation's then each wave's in order.
export function battleSetup (run, { party = fielded(run.state.party), seed = null, lines = run.state.lines } = {}) {
  const s = run.state
  const node = currentNode(run)
  const boss = node.type === 'boss'
  const foes = foeUnits(node, s.nextUid)
  return {
    party: party.map((u) => (lines[u.uid] ? { ...u, line: lines[u.uid] } : { ...u })),
    reserve: foes.filter((f) => f.wave),
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
    nextUid: s.nextUid + foes.length,
    keystones: s.keystones.slice(),
    relics: s.relics.slice(),
    ...(s.ablate && { ablate: s.ablate.slice() })
  }
}

// A room's foes as battle units, uids from `uid` on, each piece with its count; a later wave's foes off the board
// (slot −1) with what they wait for (see battleSetup).
function foeUnits (node, uid) {
  const out = []
  for (const [k, foes] of [node.foes, ...(node.waves ?? []).map((w) => w.foes)].entries()) {
    for (const [i, f] of foes.entries()) {
      out.push({
        ...makeUnit(f.id, { uid: uid + i, lvl: f.lvl, slot: k ? -1 : f.slot, count: f.count ?? 1 }),
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
  // A piece keeps the HP of its own bodies: the bodies its tiers added were the first to fall, and go.
  for (const u of s.party) {
    const bu = byUid.get(u.uid)
    if (!bu) continue
    const kept = Math.min(bu.hp, u.count * bu.body)
    u.hp = kept > 0 ? Math.max(1, Math.round(kept / bu.body * bodyHp(u))) : 0
  }
  // Shadows are the battle's alone: nothing of them comes back to the run.
  s.stats.fights++
  if (b.winner !== 'party') {
    s.phase = 'over'
    // A fall in the deep, past the Sovereign, leaves the clear standing.
    if (s.result !== 'victory') s.result = 'defeat'
    s.death = b.reason === 'monarch' ? { ...b.death, reason: 'monarch' } : { by: null, reason: b.reason, threat: 'clock' }
    return
  }
  s.stats.wins++
  // Hollow Court: the shadows Arise raised that still stand pay their essence again.
  const court = reapedShadows(run).reduce((n, u) => n + foeEssence(u), 0)
  const earned = Math.round((battleEssence(b) + court) * (1 + relicSum(s, 'essence')))
  s.essence += earned
  s.stats.essence += earned
  // Each living body heals (a stack's whole ones are whole already: the one wounded takes it).
  for (const u of s.party) {
    if (isMonarch(u) && holds(s, 'unhealable')) continue
    if (u.hp > 0) u.hp = Math.min(livingBodies(u) * bodyHp(u), u.hp + Math.ceil(bodyHp(u) * TUNING.run.postBattleHeal))
  }
  const node = currentNode(run)
  if (node.type === 'boss') {
    s.stats.floorsCleared++
    s.phase = 'over'
    s.result = 'victory'
    return
  }
  s.offers = [...soulOffers(run, b), ...(node.type === 'elite' ? [...relicOffers(s, TUNING.essence.eliteRelics), ...keystoneOffers(s)] : [])]
  s.phase = 'reap'
}

// ── progression: the retinue ─────────────────────────────────────────────────────────────────────

// Every foe slain pays essence, more for higher tiers and levels, a piece for each of its bodies; it all goes to
// one purse. Only real foes pay: a shadow (of either side) was paid for once already, as the corpse it rose from.
export const foeEssence = (u) => (u.count ?? 1) * TUNING.essence.perTier * unitDef(u.id).tier * (1 + TUNING.essence.perLevel * (u.lvl - 1))
const battleEssence = (battle) => battle.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0).reduce((n, u) => n + foeEssence(u), 0)
// What each foe wave of a battle paid (the formation's first), before relics: a siege pays wave by wave,
// and a boss's crumbled court as if slain.
export function essenceByWave (battle) {
  const out = battle.waveAt.map(() => 0)
  for (const u of battle.units) if (u.side === 'foe' && !u.shadow && u.hp <= 0) out[u.wave ?? 0] = (out[u.wave ?? 0] ?? 0) + foeEssence(u)
  return Array.from(out, (v) => v ?? 0)
}

// Prices, after the relics' discounts: a kind's next level, its next tier on `track`, a recruit.
const price = (run, base, discount) => Math.max(1, Math.round(base * (1 - relicSum(run.state, discount))))
export const levelCost = (run, kind) => price(run, TUNING.level.cost * Math.pow(run.state.kinds[kind].lvl, TUNING.level.exponent), 'levelDiscount')
export const tierCost = (run, kind, track) => price(run, TUNING.essence.tier[run.state.kinds[kind].tracks[track]], 'tierDiscount')
export const recruitCost = (run, id, lvl) => price(run, TUNING.essence.recruit * unitDef(id).tier * (1 + TUNING.essence.perLevel * (lvl - 1)), 'recruitDiscount')

// The kinds the run holds a soul of, in party order (the Monarch is no kind).
export const heldKinds = (s) => [...new Set(souls(s.party).map((u) => u.id))]
const canLevel = (run, kind) => heldKinds(run.state).includes(kind) && run.state.kinds[kind].lvl < TUNING.level.cap && run.state.essence >= levelCost(run, kind)
// Whether a kind the run holds may take its next tier on `track` (unit.js canTrack: up to IV, the other track
// stopping at II once one passes it).
export const canAdvance = (s, kind, track) => heldKinds(s).includes(kind) && (track === 0 || track === 1) && tracksOf(kind).length === 2 && canTrack(s.kinds[kind].tracks, track)
const canUpgrade = (run, kind, track) => canAdvance(run.state, kind, track) && run.state.essence >= tierCost(run, kind, track)

function pay (run, cost) {
  const s = run.state
  if (s.essence < cost) throw new Error('not enough essence')
  s.essence -= cost
  s.stats.spent += cost
}

// A kind takes its next tier on `track`: every soul of it holds it.
function advance (s, kind, track) {
  if (!canAdvance(s, kind, track)) throw new Error(`no next tier on track ${track} for ${kind}`)
  s.kinds[kind].tracks = nextTracks(s.kinds[kind].tracks, track)
  for (const u of s.party) if (u.id === kind) u.tracks = s.kinds[kind].tracks.slice()
}

// A kind at level `lvl`: every soul of it too.
function levelKind (s, kind, lvl) {
  s.kinds[kind].lvl = Math.min(TUNING.level.cap, lvl)
  for (const u of s.party) if (u.id === kind) setLevel(u, s.kinds[kind].lvl)
}

// A level-up raises each body's HP and heals each living body by the difference; the fallen stay at 0. The
// Monarch's level has no cap.
function setLevel (u, lvl) {
  const before = bodyHp(u)
  const living = livingBodies(u)
  u.lvl = isMonarch(u) ? lvl : Math.min(TUNING.level.cap, lvl)
  u.maxHp = u.count * baseStats(u.id, u.lvl).hp
  u.hp += living * (bodyHp(u) - before)
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

// One soul for sale per kind of foe slain, rising at the level that foe fought at: a full soul (one body, at its
// level, with its kind's tiers), one of them a battle (reap). A foe shadow is no foe's soul (it rose from one of yours: the Legion,
// Undead 8, on the foes' side).
function soulOffers (run, battle) {
  const s = run.state
  const slain = battle.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0)
  return [...new Set(slain.map((u) => u.id))].map((id) => {
    const lvl = Math.min(TUNING.level.cap, Math.max(...slain.filter((u) => u.id === id).map((u) => u.lvl)) + relicSum(s, 'soulLevel'))
    return { type: 'soul', id, lvl, cost: recruitCost(run, id, lvl), name: unitDef(id).name, desc: `Rises at level ${lvl}.` }
  })
}

// A rite offers free tiers: up to `n` of the next tiers your kinds could take, each for a different kind
// where it can.
function riteOffers (run, n) {
  const s = run.state
  const rng = createRng(s.seed).stream(`rite|${s.floor}|${s.at}`)
  const options = rng.shuffle(heldKinds(s).flatMap((kind) => [0, 1].filter((track) => canAdvance(s, kind, track)).map((track) => ({ kind, track }))))
  const picked = [...options.filter((o, i) => options.findIndex((x) => x.kind === o.kind) === i), ...options].filter((o, i, all) => all.indexOf(o) === i).slice(0, n)
  return picked.map(({ kind, track }) => {
    const next = s.kinds[kind].tracks[track]
    const t = tracksOf(kind)[track]
    return { type: 'tier', kind, track, name: `${unitDef(kind).name}: ${t.name} ${ROMAN[next]}`, desc: t.tiers[next].desc }
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
