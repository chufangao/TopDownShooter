// The run: a state machine over map → prep → reap → map, floor by floor.
// apply(run, action) is the only way to change it, legalActions(run) lists what apply accepts now,
// and the log of applied actions replays the run exactly: replay(seed, log).
//
// Battles take no input, and your pieces never move in them: each fights from the cell you gave it. The player's
// part is the retinue (DESIGN §1: how to upgrade, where to place): which souls it recruits, keeps, fuses and lets
// go, what it spends its essence on, and which souls stand in the camp, where. Slain foes pay essence; it buys only
// track tiers for a kind (and with them its level), recruits and fusions. Each floor draws its camp, a 7×7 walled
// layout around the Monarch's seat (content.js CAMP_LIST, 'M'), on arrival.
//
// The Monarch is you: a party unit with uid MONARCH_UID that stands on the camp's seat (unit.js monarchSlot), every
// floor, all run. No action moves it or puts anything on its cell; it can never be put in the ossuary, released or
// upgraded, has no level, and counts toward no cap. Nothing is bought for it (DESIGN §2.6): its two numbers come from
// relics, a copy each, with no cap: its max HP (TUNING.monarch.hp and the HP relics: monarchHp) and its Command, the
// field cap, how many pieces fight (TUNING.party.field and the Command relics: commandOf); a won elite always lays out
// a Command relic. Arise's numbers (how far it reaches, the tier and how many it raises, how soon it casts) are the
// Arise relic's own, growing with each copy past the first (ariseOf). The roads run to it (battle.js field). If it
// falls, the battle is lost and so is the run.
//
// Pieces, stacks and footprints (DESIGN §2.2): the party is pieces, each one kind with a `count` of bodies, one
// soul a body, its HP one pool (count × body HP: unit.js makeUnit), and a size (unit.js sizeOf: 2 for a kind of
// size 2 or one holding a Colossus tier, else 1). A piece's `slot` is its anchor cell; it covers its footprint
// (unit.js footprintSlots: a 2×2 also the next lane and the row ahead of both), every cell of it open ground, none
// the Monarch's seat, none another piece's (unit.js fits). A soul recruited is a piece of one; `stack` puts a piece
// onto another of its kind (one piece, the bodies and the HP of both), `split` takes bodies off one into a new
// piece (the hindmost: the fallen first, then the one wounded, then the whole ones: unit.js bodiesHp). Nothing
// stacks or splits by itself. A body fallen in battle stays down, as a fallen soul does: a won battle's heal and a
// level's HP go to the living bodies, and only an altar raises the fallen. A piece whose every body fell leaves the
// field as the battle ends (finishBattle): it lies fallen in the ossuary, its cell and its Command free, and nothing
// fields it again (canPlace) until an altar raises it.
//
// The ossuary: your collection of souls. Every piece not on the field waits there (slot OSSUARY, −1); you field
// the ones you want, up to the field cap (fieldCap: the Monarch's Command, never more than TUNING.army.board), a
// stack one piece whatever its count or size, and the ossuary and the field together hold at most rosterCap souls
// (bodies). After a win you may recruit one of the slain, a full soul at its kind's level (a kind new to the run at
// its first), for essence: a piece of its own, or straight onto a fielded piece of its kind (`onto`).
//
// The army: the pieces fielded, and the bodies their kinds' track tiers add each battle (a tier's `count`,
// content.js TRACKS: battle.js), whole, in the piece's pool; they are the battle's alone, the first to fall.
//
// Kinds (DESIGN §2.6): upgrades belong to the kind, not the soul. s.kinds[id] = { lvl, tracks: [tier, tier], least? }:
// the tiers the kind holds on its two tracks (content.js TRACKS, with the crosspath rule: unit.js canTrack), and the
// level every soul of it stands at, which is its tiers' (levelOf: TUNING.level.base + perTier a tier, rounded down;
// for a fused kind never below `least`, the highest level of the kinds that went into it). No level is bought; `lvl`
// is kept in step with the tiers. Each soul of the kind carries a copy (u.lvl, u.tracks). A kind's state stays once
// made, whether or not a soul of it is left. A soul recruited joins its kind at the kind's level; a kind new to the
// run starts with no tiers (and Soul Lantern's free ones). A Colossus tier (`size: 2`) grows every piece of the kind
// to 2×2: each that no longer fits where it stands goes to the ossuary until it is placed again.
//
// Fusions (DESIGN §2.6, content.js FUSION_LIST): a recipe consumes exactly `needs` bodies of each kind from your
// pieces, fielded or in the ossuary (a bigger stack gives the bodies asked, the hindmost, and keeps the rest, as a
// split would), costs fuseCost, and gives one piece of its fused kind, count 1, full HP, in the ossuary. It joins
// its kind, with the kind's tiers (none for a kind new to the run), at the kind's level, which is never below the
// highest level of the kinds consumed (the kind's `least` rises to it): a fused piece is never weaker than what went
// into it. Recipes are public: legalActions lists one fuse a recipe that can be made (fuseParts).
//
// Relics (content.js RELIC_LIST, RELIC_TIERS): s.relics, their ids in the order taken, a relic taken twice named
// twice (relicCount). Copies stack with no cap: every copy applies in full. A reliquary and a won elite lay out
// Common, Uncommon and Rare relics by TUNING.relic's weights for the room and the floor (relicOffers), a won elite's
// always one Command relic among them; from floor TUNING.relic.legendary.fromFloor both also lay out Legendaries, the
// rules that rewrite the game (legendaryOffers). A reliquary (the rite merged into it) lays out free next tiers of
// your kinds too (tierOffers), and all it lays out is one pick (onePick); an elite's are one of each group
// (offerGroup). Arise is a Legendary: without it no foe rises as a shadow (ariseHeld); each copy past the first grows
// its numbers (ariseOf); a relic that does nothing without it (`needsArise`: Hollow Court, Blood Tithe, Court of Bone,
// the gauge relics) is offered only once it is held. Most Legendaries bend the battle (battle.js relicRules); the
// Command relics' field (Legion's too), the HP relics' Monarch, the domain's size, Hollow Court's shadows reaped and
// Court of Bone's Monarch that nothing heals are the run's to apply. Nothing revives the Monarch.
//
// The enemy is an army too (drawRoom): from floor 2 its rooms have captains, each one piece with its cohort's
// bodies (a count); a floor-1 elite brings a late pair; from floor 3 rooms come in waves, and a siege room is one
// battle of three. The last room is a siege whose last wave is the Hollow Sovereign and its court; its fall ends the
// battle.
//
// `fight` resolves the whole battle at once; run.setup is what it was built from, so the UI can play it
// back tick by tick.
//
//   phase            action
//   map              { type: 'node', id }           walk to a connected room (a battle room, a siege too, opens prep)
//   map, prep        { type: 'place', uid, slot }   move a soul (never the Monarch) to the camp cell `slot` (0–48),
//                                                   its anchor, where its footprint fits (canPlace), or to the
//                                                   ossuary (OSSUARY, −1); the piece covering that cell takes the
//                                                   mover's old place (the ossuary, if it came from there), where
//                                                   it fits; a soul from the ossuary only while the field has room,
//                                                   or in such a swap
//   map, prep        { type: 'stack', uid, onto }   put piece `uid` onto piece `onto` of its kind: one piece of
//                                                   both counts and both pools, where `onto` stands; `uid` is gone
//   map, prep        { type: 'split', uid, n, slot }  take `n` bodies (1 to count − 1) off piece `uid` into a new
//                                                   piece of its kind, the hindmost (see above), at `slot`: a
//                                                   camp cell where it fits while the field has room, or the
//                                                   ossuary (OSSUARY, the default)
//   map, prep        { type: 'fuse', id, parts }    make fusion `id` (content.js FUSIONS) of `parts`, [{ uid, n }]:
//                                                   `n` bodies off each piece, the hindmost (the whole piece when
//                                                   `n` is its count), exactly the recipe's needs, for fuseCost;
//                                                   the fused piece waits in the ossuary
//   map, prep        { type: 'upgrade', kind, track }  buy a kind you hold its next tier on track 0 or 1 (and
//                                                   with it the kind's level: levelOf)
//   map, prep, reap  { type: 'release', uid }       let a soul go (never the last one standing)
//   prep             { type: 'fight' }              the battle plays out; the run moves on by itself
//   reap             { type: 'reap', index, onto }  take offer `index` (recruit one soul for its price, a
//                                                   free relic, a free Legendary, a free tier), or null to move on;
//                                                   a soul with `onto` joins that fielded piece of its kind; one of
//                                                   each group (offerGroup), one in all in a reliquary (onePick)
//   over             { type: 'descend' }            the Sovereign slain (result 'victory'): on to the endless
//                                                   floors, each deeper than the last; nothing after a fall
//
// Endless floors: beating the Sovereign on the last floor (TUNING.run.floors) is a clear, recorded for good
// (s.result 'victory'), and the run stops there, over, unless the player descends. Floors past it reuse the
// last floor's camps and foes, growing with every floor deeper (TUNING.spawn.endless), and each ends in a big
// elite; past it the floors simply go on. A fall in the deep ends the run as any defeat does (s.death says
// what felled the Monarch) but leaves the clear standing: s.result stays 'victory'.
import { TUNING } from '../tuning.js'
import { UNIT_LIST, relicDef, unitDef, abilityDef, RELIC_LIST, RELIC_TIERS, CAMP_LIST, THREATS, FUSION_LIST, FUSIONS, fusionDef } from '../content.js'
import { createRng } from './rng.js'
import {
  makeUnit, autoPlace, slotAt, CAMP_SLOTS, baseStats, onField, CENTRE_OUT, campOpen, wallTiles, tracksOf, canTrack, nextTracks,
  nearestOpen, colOf, FORMATION, SLOTS, bodyHp, livingBodies, bodiesHp, sizeOf, footprintSlots, fits, monarchSlot,
  abilitiesOf, isBlow, ringOf, deployTile, distance, distanceBetween, tileAt, tileX, TILES, DEPTH, ROWS
} from './unit.js'
import { createBattle, playOut, relicRules, ariseCap, ariseTier, ariseHaste, field } from './battle.js'
import { generateFloor, nodeOf, RANKS } from './map.js'

export const START_PARTY = ['tomb_knight', 'bone_chanter', 'frost_sprite']
export const MONARCH_UID = 0
// The slot of a soul in the ossuary: kept, not fighting.
export const OSSUARY = -1
const BATTLE_NODES = ['fight', 'elite', 'boss', 'siege']
const ROMAN = ['I', 'II', 'III', 'IV']
const BOSS = UNIT_LIST.find((u) => u.boss).id

// The Monarch takes the camp's seat, and the start souls take the camp's default frontier (frontier).
// `death` is what felled the Monarch, once something has. The ossuary starts empty: every start soul is fielded, its
// kind with no tiers, at its first level. No relics (ids, in the order taken, a copy each).
// `ablate` (the autoplayer's ablation reports only, never a player's run): battle rules taken from the party in
// every battle of the run, carried in each battle's setup (battle.js createBattle: 'arise', 'synergies', 'bodies').
// A run made without it has no such field.
export function createRun ({ seed, ablate = null }) {
  const state = {
    seed, floor: 1, phase: 'map', map: null, camp: null, at: null, party: [], relics: [], offers: [],
    essence: TUNING.essence.start, result: null, death: null,
    kinds: Object.fromEntries(START_PARTY.map((id) => [id, { lvl: levelOf({ tracks: [0, 0] }), tracks: [0, 0] }])),
    stats: { fights: 0, wins: 0, reaped: 0, essence: 0, spent: 0, floorsCleared: 0 }, log: [], nextUid: 1
  }
  state.party = [
    makeUnit('monarch', { uid: MONARCH_UID, lvl: 0 }),
    ...START_PARTY.map((id) => makeUnit(id, { uid: state.nextUid++, lvl: state.kinds[id].lvl }))
  ]
  if (ablate?.length) state.ablate = ablate.slice()
  const run = { state, battle: null, setup: null }
  enterFloor(run)
  muster(state, souls(state.party))
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
  for (const u of souls(s.party)) {
    for (let slot = -1; slot < CAMP_SLOTS; slot++) if (canPlace(run, u, slot)) out.push({ type: 'place', uid: u.uid, slot })
  }
  for (const u of souls(s.party)) {
    for (const v of souls(s.party)) if (canStack(s, u, v)) out.push({ type: 'stack', uid: u.uid, onto: v.uid })
    for (let n = 1; n < u.count; n++) {
      for (let slot = -1; slot < CAMP_SLOTS; slot++) if (canSplit(run, u, n, slot)) out.push({ type: 'split', uid: u.uid, n, slot })
    }
  }
  for (const kind of heldKinds(s)) for (const track of [0, 1]) if (canUpgrade(run, kind, track)) out.push({ type: 'upgrade', kind, track })
  // One fuse a recipe that can be made, of its canonical parts (fuseParts: the ossuary's pieces first).
  for (const r of FUSION_LIST) if (canFuse(run, r.id)) out.push({ type: 'fuse', id: r.id, parts: fuseParts(run, r.id) })
  out.push(...releasable(s).map((u) => ({ type: 'release', uid: u.uid })))
  return out
}

export const currentNode = (run) => nodeOf(run.state.map, run.state.at)

export function availableNodes (run) {
  if (run.state.phase !== 'map') return []
  return currentNode(run).next.map((id) => nodeOf(run.state.map, id))
}

// The relics held, a copy each, and a rule's sum over every copy.
const relicDefs = (s) => s.relics.map(relicDef)
const relicSum = (s, key) => relicDefs(s).reduce((n, r) => n + (r[key] ?? 0), 0)
// How many copies of relic `id` the run holds (0: none).
export const relicCount = (s, id) => s.relics.reduce((n, x) => n + (x === id), 0)
// Whether the run holds a relic with this rule (RELIC_LIST: reap, unhealable…).
export const holds = (s, key) => relicDefs(s).some((r) => r[key])
// Whether the run holds Arise (a Legendary relic): without it no foe rises as a shadow, the domain does nothing, and
// no relic that needs it is offered.
export const ariseHeld = (s) => relicCount(s, 'arise') > 0
// Arise as the run holds it (DESIGN §2.5), its numbers the relic's own: `copies` of it; the `domain` it reaches
// (domainOf: TUNING.arise.domain, more.domain a copy past the first, Court of Bone's tiles too); how many it `raises`
// a battle (battle.js ariseCap: TUNING.arise.raises, more.raises a copy past the first, grown by Blood Tithe; 0
// without it), the highest `tier` it raises (ariseTier: TUNING.arise.tier, more.tier a copy past the first), and the
// `haste` it gives the Monarch's gauge (ariseHaste: more.haste a copy past the first).
export function ariseOf (s) {
  const held = relicRules(s.relics)
  return { copies: held.arise, domain: domainOf(s), raises: ariseCap(held), tier: ariseTier(held), haste: ariseHaste(held) }
}
// The copies of Arise past the first: each reaches a tile farther (TUNING.arise.more.domain).
const pastFirst = (s) => Math.max(0, relicCount(s, 'arise') - 1)
// The relic's tier (RELIC_TIERS id).
export const relicTier = (id) => relicDef(id).tier
// What an offer is taken as one of (one of each a room): 'soul', 'relic', 'legendary' (a Legendary relic, apart
// from the others) or 'tier'.
export const offerGroup = (o) => (o.type === 'relic' && relicTier(o.id) === 'legendary' ? 'legendary' : o.type)
// Whether the room's offers are one pick in all, whatever their groups: a reliquary's (its relics, its Legendaries and
// its tiers, the rite's and the reliquary's offers merged); elsewhere one of each group.
export const onePick = (run) => run.state.phase === 'reap' && currentNode(run)?.type === 'reliquary'
// Hollow Court: the shadows Arise raised (`arisen`; a party shadow raised any other way is not one) that
// still stood when the battle last fought was won, if it was fought under the relic: each pays its essence
// again, once a copy (finishBattle: reapsOf). The relics it was fought with decide (run.setup), not the ones held
// now: one taken on the spoils reaps nothing of the battle before it.
const reapsOf = (ids = []) => ids.reduce((n, id) => n + (relicDef(id).reap ?? 0), 0)
export const reapedShadows = (run) => run.battle && run.battle.winner === 'party' && reapsOf(run.setup?.relics) > 0
  ? run.battle.units.filter((u) => u.arisen && u.side === 'party' && u.hp > 0) : []
// The field cap counts pieces (a stack is one), the roster souls (a stack's every body): the Monarch takes no room
// in either. It is the Monarch's Command, up to as many as the board holds.
// The souls every Monarch fields, its base Command: TUNING.party.field, and fieldPerFloor more a floor down (to the
// Sovereign's; 0 now: the Command relics alone widen the field).
export const baseField = (s) => TUNING.party.field + TUNING.party.fieldPerFloor * (Math.min(s.floor, TUNING.run.floors) - 1)
// The Monarch's Command: its base, and what its Command relics add, a copy each (Legion's two too); uncapped (the
// field is not: fieldCap).
export const commandOf = (s) => baseField(s) + relicSum(s, 'command')
export const fieldCap = (run) => Math.min(TUNING.army.board, commandOf(run.state))
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

// Its max HP: TUNING.monarch.hp and what its HP relics add, a copy each. Nothing else raises it.
export const monarchHp = (s) => TUNING.monarch.hp + relicSum(s, 'monarchHp')

// How far Arise reaches, its domain (Chebyshev, in tiles, from the Monarch's tile; relics bend it, never below 0):
// TUNING.arise.domain, more.domain a copy of Arise past the first, and Court of Bone's tiles. Arise raises the foes
// that fall inside it (unit.js domainTiles lists its tiles). Without Arise it does nothing.
export const domainOf = (s) => Math.max(0, TUNING.arise.domain + TUNING.arise.more.domain * pastFirst(s) + relicSum(s, 'domain'))

// ── the camp: footprints ─────────────────────────────────────────────────────────────────────────

// The camp cells a fielded piece covers: its footprint from its anchor (unit.js footprintSlots).
const cellsOf = (u) => footprintSlots(u.slot, sizeOf(u)) ?? [u.slot]

// The camp cells the fielded pieces cover, the Monarch's seat among them, but `except`'s.
function takenBy (s, except = []) {
  const out = new Set()
  for (const u of s.party) if (onField(u) && !except.includes(u)) for (const c of cellsOf(u)) out.add(c)
  return out
}

// The fielded piece but `except` whose footprint covers camp cell `slot`, if any.
const coverOf = (s, slot, except = null) => s.party.find((x) => x !== except && onField(x) && cellsOf(x).includes(slot)) ?? null

// A piece new to the field (a recruit) beside the Monarch: on the free cell nearest its seat that its footprint fits
// beside every other fielded piece (ties: the middle lanes first, then the lower cell), or the ossuary (OSSUARY, −1)
// if none is left. Never out ahead of the pieces you placed, where its ring would change where the foes halt.
function besideSeat (s, u) {
  const seat = deployTile('party', monarchSlot(s.camp))
  const taken = takenBy(s, [u])
  const k = (slot) => [distanceBetween(deployTile('party', slot), sizeOf(u), seat, 1), CENTRE_OUT.indexOf(colOf(slot)), slot]
  u.slot = [...Array(CAMP_SLOTS).keys()].filter((c) => fits(s.camp, c, sizeOf(u), taken)).sort((a, b) => cmp(k(a), k(b)))[0] ?? OSSUARY
}

// ── the camp: the default frontier ───────────────────────────────────────────────────────────────

// Where `pieces` stand on a camp new to them (the run's start, each floor's arrival), so that Fight pressed at once
// makes sense: a foe halts only where it can hit back (DESIGN §2.4), a melee one where something blocks it, so the
// front piece holds the road's choke, in the walkers' way, and the others stand back by their rings, reaching all
// round it: the foes it blocks, and the shooters that halt to shoot at it, are in their reach. Pure: → each piece's
// anchor slot, in order (−1: no room left for it).
export function frontier (camp, pieces) {
  const seat = monarchSlot(camp)
  const root = deployTile('party', seat)
  const roads = field({ root, walls: wallTiles(camp) })
  const lane = (x) => CENTRE_OUT.indexOf(x)
  // How many entry roads, one from each tile of the foes' rows, pass each tile on their way to the seat.
  const traffic = new Array(TILES).fill(0)
  for (let t = tileAt(0, DEPTH - ROWS); t < TILES; t++) for (let x = t; x >= 0 && x !== root; x = roads.arrow[x]) traffic[x]++
  // The choke: the busiest road tile outside the Monarch's own ring, the furthest from the seat among the busiest.
  const cells = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(camp, slot) && slot !== seat)
  const busy = (t) => [-traffic[t], -roads.dist[t], lane(tileX(t)), t]
  const choke = cells.map((slot) => deployTile('party', slot)).filter((t) => distance(t, root) > ringOf({ id: 'monarch' }))
    .sort((a, b) => cmp(busy(a), busy(b)))[0] ?? root
  // The front piece: the tankiest melee one (every blow in its kit melee, whatever their conditions), the living
  // first; with no melee piece, the one of the shortest ring.
  const melee = (u) => {
    const blows = abilitiesOf(u).map(abilityDef).filter(isBlow)
    return blows.length > 0 && blows.every((a) => a.melee)
  }
  const lead = (i) => [pieces[i].hp > 0 ? 0 : 1, melee(pieces[i]) ? 0 : 1, melee(pieces[i]) ? 0 : ringOf(pieces[i]), -pieces[i].maxHp, i]
  const front = pieces.map((_, i) => i).sort((a, b) => cmp(lead(a), lead(b)))[0]
  // Each piece in turn on the free cell its footprint fits that `rank`s first (lane order, then the lower cell, on a
  // tie).
  const taken = new Set([seat])
  const slots = pieces.map(() => -1)
  const put = (i, rank) => {
    const size = sizeOf(pieces[i])
    const k = (slot) => [...rank(deployTile('party', slot), size), lane(colOf(slot)), slot]
    const slot = cells.filter((c) => fits(camp, c, size, taken)).sort((a, b) => cmp(k(a), k(b)))[0] ?? -1
    slots[i] = slot
    if (slot >= 0) for (const c of footprintSlots(slot, size)) taken.add(c)
  }
  if (front === undefined) return slots
  put(front, (t, size) => [distanceBetween(t, size, choke, 1)])
  if (slots[front] < 0) return slots
  // The rest, the living first: where its ring covers the front piece's whole ring (it stands within its ring less
  // the front's, at least 1, of it), covering as little traffic as it can past where the foes meet the front piece
  // (so a shooter comes into no ring of theirs sooner), then nearest the seat; with nowhere that covers it, near the
  // seat.
  const f = { tile: deployTile('party', slots[front]), size: sizeOf(pieces[front]), ring: ringOf(pieces[front]) }
  const past = roads.dist[choke] + f.ring
  const rest = pieces.map((_, i) => i).filter((i) => i !== front).sort((a, b) => (pieces[b].hp > 0) - (pieces[a].hp > 0) || a - b)
  for (const i of rest) {
    const r = ringOf(pieces[i])
    put(i, (t, size) => {
      let over = 0
      for (let x = 0; x < TILES; x++) if (traffic[x] && roads.dist[x] > past && distanceBetween(t, size, x, 1) <= r) over += traffic[x]
      return [distanceBetween(t, size, f.tile, f.size) <= Math.max(1, r - f.ring) ? 0 : 1, over, distanceBetween(t, size, root, 1)]
    })
  }
  return slots
}

// Two keys (lists of numbers) in order: the first that differs decides.
const cmp = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

// `pieces` (fielded, or to be) take the default frontier (frontier), each where its footprint fits, or the ossuary
// where none is left.
function muster (s, pieces) {
  frontier(s.camp, pieces).forEach((slot, i) => { pieces[i].slot = slot })
}

// ── the retinue: placing, releasing, buying ─────────────────────────────────────────────────────

// A soul to camp cell `slot`, its anchor, or to the ossuary (OSSUARY). Never the Monarch, which keeps its seat,
// and never onto the seat; never a fallen piece onto the camp (it waits in the ossuary for an altar). On the camp
// the piece's footprint must fit (unit.js fits) but for the piece covering `slot` (coverOf), which swaps with it: it
// takes the mover's old place, where it must fit beside the mover, or the ossuary if the mover came from there. A
// soul leaves the ossuary for open ground only while the field has room (fieldCap: Command), or in a swap.
export function canPlace (run, u, slot) {
  const s = run.state
  if (!u || isMonarch(u) || !s.party.includes(u) || slot === u.slot) return false
  if (slot === OSSUARY) return true
  if (u.hp <= 0 || !campOpen(s.camp, slot)) return false
  const other = coverOf(s, slot, u)
  if (other && isMonarch(other)) return false
  const taken = takenBy(s, [u, other])
  if (!fits(s.camp, slot, sizeOf(u), taken)) return false
  if (!other) return onField(u) || fielded(souls(s.party)).length < fieldCap(run)
  if (!onField(u)) return true
  for (const c of footprintSlots(slot, sizeOf(u))) taken.add(c)
  return fits(s.camp, u.slot, sizeOf(other), taken)
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
// Splitting `n` bodies off a piece: 1 to count − 1 of them, to the ossuary, or to a camp cell where a piece of its
// size fits while the field has room for one more piece, and only if one of them stands (the hindmost, the fallen
// first: a piece of the fallen alone is no piece to field).
function canSplit (run, u, n, slot) {
  if (!u || isMonarch(u) || !Number.isInteger(n) || n < 1 || n >= u.count) return false
  if (slot === OSSUARY) return true
  const s = run.state
  return bodiesHp(u).slice(u.count - n).some((hp) => hp > 0) &&
    campOpen(s.camp, slot) && fits(s.camp, slot, sizeOf(u), takenBy(s)) && fielded(souls(s.party)).length < fieldCap(run)
}

// A new soul takes the free cell nearest the Monarch (besideSeat) while the field has room, else waits in the ossuary,
// a piece of one; or with `onto` it is a body more in that piece of its kind, whole. It joins its kind at the kind's
// level and tiers; a kind new to the run starts with no tiers, at its first level. Returns the piece it is in.
export function join (run, id, { uid = run.state.nextUid++, onto = null } = {}) {
  const s = run.state
  if (unitDef(id).monarch) throw new Error('there is one Monarch')
  if (soulCount(s.party) >= rosterCap(run)) throw new Error('the retinue is full')
  const piece = onto === null ? null : s.party.find((u) => u.uid === onto)
  if (onto !== null && !(piece && piece.id === id && onField(piece))) throw new Error(`no fielded ${id} ${onto} to join`)
  if (!s.kinds[id]) s.kinds[id] = { lvl: levelOf({ tracks: [0, 0] }), tracks: [0, 0] }
  const u = makeUnit(id, { uid, lvl: s.kinds[id].lvl, tracks: s.kinds[id].tracks })
  if (piece) {
    piece.count++
    piece.hp += u.hp
    piece.maxHp += u.maxHp
    return piece
  }
  s.party.push(u)
  if (fielded(souls(s.party)).length < fieldCap(run)) besideSeat(s, u)
  return u
}

// ── fusions (DESIGN §2.6) ────────────────────────────────────────────────────────────────────────

// What fusion `id` costs: TUNING.essence.fuse × its fused kind's tier, × the floor's price scale (floorPrice).
export const fuseCost = (run, id) => price(run, TUNING.essence.fuse * unitDef(fusionDef(id).result).tier)

// The parts fusion `id` takes when the run chooses them, [{ uid, n }], or null if the retinue lacks the bodies (or
// there is no such recipe): for each kind it needs, in the recipe's order, from that kind's pieces in the ossuary
// first, then the fielded, the smallest stacks first (party order among equals), as many bodies of each as are
// still needed.
export function fuseParts (run, id) {
  const recipe = Object.hasOwn(FUSIONS, id) ? FUSIONS[id] : null
  if (!recipe) return null
  const out = []
  for (const [kind, need] of Object.entries(recipe.needs)) {
    let left = need
    const pieces = souls(run.state.party).filter((u) => u.id === kind).sort((a, b) => onField(a) - onField(b) || a.count - b.count)
    for (const u of pieces) {
      if (!left) break
      const n = Math.min(left, u.count)
      out.push({ uid: u.uid, n })
      left -= n
    }
    if (left) return null
  }
  return out
}

// Whether fusion `id` can be made now: the run holds the bodies it needs (fuseParts) and the essence it costs.
export const canFuse = (run, id) => Object.hasOwn(FUSIONS, id) && run.state.essence >= fuseCost(run, id) && fuseParts(run, id) !== null

// `parts` ([{ uid, n }]) as the pieces they name, each with its `n`, if they are exactly `recipe`'s: souls of the run
// (never the Monarch), each named once, 1 to its count bodies off each, every one of a kind the recipe needs, and of
// each kind the bodies it needs; else null.
function partsOf (s, recipe, parts) {
  if (!Array.isArray(parts)) return null
  const out = []
  const got = {}
  for (const p of parts) {
    const u = s.party.find((x) => x.uid === p?.uid)
    if (!u || isMonarch(u) || out.some((x) => x.u === u) || !Number.isInteger(p.n) || p.n < 1 || p.n > u.count || !Object.hasOwn(recipe.needs, u.id)) return null
    out.push({ u, n: p.n })
    got[u.id] = (got[u.id] ?? 0) + p.n
  }
  return Object.entries(recipe.needs).every(([kind, n]) => got[kind] === n) ? out : null
}

// ── action handlers ──────────────────────────────────────────────────────────────────────────────

const HANDLERS = {
  node: { phases: ['map'], run: walk },
  place: { phases: ['map', 'prep'], run: place },
  stack: { phases: ['map', 'prep'], run: stack },
  split: { phases: ['map', 'prep'], run: split },
  upgrade: { phases: ['map', 'prep'], run: upgrade },
  release: { phases: ['map', 'prep', 'reap'], run: release },
  fuse: { phases: ['map', 'prep'], run: fuse },
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
    // The rite's and the reliquary's offers in one: its relics, its Legendaries (from their floor), and free tiers;
    // one pick in all (onePick).
    s.offers = [...relicOffers(s, 'reliquary'), ...legendaryOffers(s), ...tierOffers(run, TUNING.relic.offer.tiers)]
    s.phase = 'reap'
    if (!s.offers.length) nextRoom(run)
  } else if (node.type === 'altar') {
    // Every soul heals, in the ossuary too, and a fallen one stands again: body by body, into its pool. A piece that
    // fell whole stands again where it lies, in the ossuary, to be placed.
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
  const other = slot >= 0 ? coverOf(s, slot, u) : null
  if (other) other.slot = u.slot
  u.slot = slot
}

// A piece onto another of its kind: one piece, where `onto` stands.
function stack (run, { uid, onto }) {
  const s = run.state
  const u = s.party.find((x) => x.uid === uid)
  const v = s.party.find((x) => x.uid === onto)
  if (!canStack(s, u, v)) throw new Error(`cannot stack ${uid} onto ${onto}`)
  v.count += u.count
  v.hp += u.hp
  v.maxHp += u.maxHp
  s.party = s.party.filter((x) => x !== u)
}

// `n` bodies off a piece, the hindmost, into a new piece of its kind at `slot`.
function split (run, { uid, n, slot = OSSUARY }) {
  const s = run.state
  const u = s.party.find((x) => x.uid === uid)
  if (!canSplit(run, u, n, slot)) throw new Error(`cannot split ${n} off ${uid} to ${slot}`)
  const v = makeUnit(u.id, { uid: s.nextUid++, lvl: u.lvl, tracks: u.tracks, count: n, slot })
  v.hp = takeBodies(u, n)
  s.party.push(v)
}

// `n` bodies (fewer than its count) off piece `u`, the hindmost (unit.js bodiesHp): its pool loses their HP and
// their share of its max HP. → the HP they took with them.
function takeBodies (u, n) {
  const hp = bodiesHp(u).slice(u.count - n).reduce((a, b) => a + b, 0)
  u.count -= n
  u.hp -= hp
  u.maxHp -= n * baseStats(u.id, u.lvl).hp
  return hp
}

// A fusion (partsOf): its parts' bodies consumed (a whole piece gone, a bigger stack keeping the rest), its price
// paid, and its fused piece in the ossuary, count 1, full HP, with its kind's tiers (none for a kind new to the run),
// at its kind's level: the kind's `least` rises to the highest level of the kinds consumed, so the fused piece (and
// every other of its kind) is never at a lower level than its parts (DESIGN §2.6).
function fuse (run, { id, parts }) {
  const s = run.state
  const recipe = Object.hasOwn(FUSIONS, id) ? FUSIONS[id] : null
  const took = recipe && partsOf(s, recipe, parts)
  if (!took) throw new Error(`cannot fuse ${id} of ${JSON.stringify(parts)}`)
  if (s.essence < fuseCost(run, id)) throw new Error(`cannot fuse ${id}: not enough essence`)
  pay(run, fuseCost(run, id))
  const least = Math.max(...took.map(({ u }) => kindLevel(s, u.id)))
  for (const { u, n } of took) {
    if (n === u.count) s.party = s.party.filter((x) => x !== u)
    else takeBodies(u, n)
  }
  const kind = recipe.result
  s.kinds[kind] ??= { lvl: levelOf({ tracks: [0, 0] }), tracks: [0, 0] }
  s.kinds[kind].least = Math.max(s.kinds[kind].least ?? 0, least)
  syncKind(s, kind)
  s.party.push(makeUnit(kind, { uid: s.nextUid++, lvl: s.kinds[kind].lvl, tracks: s.kinds[kind].tracks }))
}

function upgrade (run, { kind, track }) {
  if (!canUpgrade(run, kind, track)) throw new Error(`cannot upgrade ${kind} on track ${track}`)
  pay(run, tierCost(run, kind, track))
  advance(run.state, kind, track)
}

// Releasing the last soul of a kind withdraws a reliquary's tier offers for that kind; a room left with none ends.
function release (run, { uid }) {
  const s = run.state
  if (!releasable(s).some((u) => u.uid === uid)) throw new Error(`cannot release ${uid}`)
  s.party = s.party.filter((u) => u.uid !== uid)
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

// One of each group per room (offerGroup): recruiting a soul (for its price) takes the other souls off the table,
// and taking a free relic or Legendary the others of its group, so an elite still leaves its relic and its Legendary
// after a recruit. A reliquary's offers are one pick (onePick): taking any ends it. The room ends on null, or once
// nothing is left. A relic is taken as takeRelic says; a recruit of a kind new to the run joins with Soul Lantern's
// free tiers, a copy each, each on its lower track (lanternSteps).
function reap (run, { index, onto }) {
  const s = run.state
  const o = index === null ? null : s.offers[index]
  if (index !== null && !o) throw new Error(`no offer ${index}`)
  if (onto != null && !(o?.type === 'soul' && fielded(souls(s.party)).some((u) => u.uid === onto && u.id === o.id))) throw new Error(`offer ${index} cannot join ${onto}`)
  if (o && !canTake(run, o)) {
    throw new Error(o.type !== 'soul' ? `offer ${index} can't be taken` : soulCount(s.party) >= rosterCap(run) ? 'the retinue is full: release a soul first' : 'not enough essence')
  }
  if (o?.type === 'relic') takeRelic(s, o.id)
  else if (o?.type === 'tier') advance(s, o.kind, o.track)
  else if (o?.type === 'soul') {
    pay(run, o.cost)
    const steps = s.kinds[o.id] ? [] : lanternSteps(s)
    join(run, o.id, { onto: onto ?? null })
    for (const t of steps) if (canAdvance(s, o.id, t)) advance(s, o.id, t)
    s.stats.reaped++
  }
  s.offers = o && !onePick(run) ? s.offers.filter((x) => offerGroup(x) !== offerGroup(o)) : []
  if (!s.offers.length) nextRoom(run)
}

function canTake (run, o) {
  const s = run.state
  if (o.type === 'soul') return soulCount(s.party) < rosterCap(run) && s.essence >= o.cost
  if (o.type === 'tier') return canAdvance(s, o.kind, o.track)
  return true
}

// A relic taken: a copy more in s.relics. An HP relic raises the Monarch's max HP by its `monarchHp` and heals it by
// as much, unless nothing may heal it (Court of Bone, held before or taken now).
function takeRelic (s, id) {
  s.relics.push(id)
  const gain = relicDef(id).monarchHp ?? 0
  if (!gain) return
  const m = monarchOf(s)
  m.maxHp += gain
  if (!holds(s, 'unhealable')) m.hp += gain
}

// ── internals ────────────────────────────────────────────────────────────────────────────────────

// Every battle room's foes are fixed when the floor is made, so the map can show them: `foes`, and `waves`
// for a room with more to come (see drawRoom). The floor's camp is drawn from its list: the Monarch takes its
// seat (monarchSlot), and the fielded pieces take the new camp's default frontier (muster), any it leaves no room
// for going to the ossuary. A camp drawn again on the next floor (the deep reuses the last floor's few) is no camp
// new to them: they keep the cells the player gave them there.
function enterFloor (run) {
  const s = run.state
  const was = s.camp
  s.map = generateFloor({ seed: s.seed, floor: s.floor, last: s.floor === TUNING.run.floors })
  s.camp = createRng(s.seed).stream(`camp|${s.floor}`).pick(CAMP_LIST.filter((c) => c.floor === poolFloor(s.floor))).id
  monarchOf(s).slot = monarchSlot(s.camp)
  if (s.camp !== was) muster(s, fielded(souls(s.party)))
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

// Across a floor's ranks every threat type appears on every route, so a walk that skirts one answer still meets
// the threat it answers. Once the rooms are drawn, while some walk from the start to the floor's end meets no room
// carrying a type the floor's foes can bring (routeThreats; depth aside: a room's waves bring it, not its foes),
// the first battle room on that walk from rank variety.from on (never the boss's) is drawn again wanting the type,
// and keeping the types it had (drawRoom's `want`, on a stream of its own); each further try on the same walk
// takes the next such room on it. Bounded: `variety.routeTries`
// redraws a type a pass, `variety.routePasses` passes (a redraw for one type may cost a route another).
export function varyRoutes (s) {
  const v = TUNING.spawn.variety
  for (let pass = 0; pass < v.routePasses; pass++) {
    for (const type of routeThreats(s.floor)) {
      for (let k = 0; k < v.routeTries; k++) {
        const rooms = walkWithout(s.map, type)?.filter((n) => BATTLE_NODES.includes(n.type) && n.type !== 'boss' && n.rank >= v.from)
        if (!rooms?.length) break
        const node = rooms[(pass + k) % rooms.length]
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
const threatsOf = (foes) => new Set(foes.flatMap((f) => unitDef(f.id).threats ?? []))
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
// `party` and `seed` override the fielded souls and the room's seed, for a rehearsal. Each piece stands where its
// slot puts it, for the whole battle (the battle reads its footprint: unit.js sizeOf). Arise's reach goes with it
// (domainOf); the rest of Arise's numbers the battle reads from the relics (battle.js ariseCap). Shadows take uids
// after the foes' (the battle makes them: battle.js raise).
// The foes (foeUnits): the room's formation stands from the start, and its later waves wait in the reserve, each
// foe with `side: 'foe'`, its `wave`, its slot's `lane` and the wave's `when`; the foes take the first uids, the
// formation's then each wave's in order.
export function battleSetup (run, { party = fielded(run.state.party), seed = null } = {}) {
  const s = run.state
  const node = currentNode(run)
  const boss = node.type === 'boss'
  const foes = foeUnits(node, s.nextUid)
  return {
    party: party.map((u) => ({ ...u })),
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
    nextUid: s.nextUid + foes.length,
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
  // A piece keeps the HP of its own bodies that stood as the battle began (u is still as it came in): the bodies its
  // tiers added were the first to fall, and go, and a body fallen before it stays down (only an altar raises the
  // fallen), whatever the added bodies left in the pool. A piece whose every body fell leaves the field (DESIGN
  // §2.2): it lies fallen in the ossuary, its cell and its Command free, until an altar raises it (canPlace keeps it
  // there).
  for (const u of s.party) {
    const bu = byUid.get(u.uid)
    if (!bu) continue
    const kept = Math.min(bu.hp, livingBodies(u) * bu.body)
    u.hp = kept > 0 ? Math.max(1, Math.round(kept / bu.body * bodyHp(u))) : 0
    if (u.hp <= 0 && !isMonarch(u)) u.slot = OSSUARY
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
  // Hollow Court: the shadows Arise raised that still stand pay their essence again, once a copy.
  const court = reapedShadows(run).reduce((n, u) => n + foeEssence(u), 0) * reapsOf(run.setup.relics)
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
  s.offers = [...soulOffers(run, b), ...(node.type === 'elite' ? [...relicOffers(s, 'elite'), ...legendaryOffers(s)] : [])]
  s.phase = 'reap'
}

// ── progression: the retinue ─────────────────────────────────────────────────────────────────────

// Every foe piece slain pays essence by its tier alone (perTier × tier), whatever its count or level; it all goes to
// one purse. Only real foes pay: a shadow (of either side) was paid for once already, as the corpse it rose from.
export const foeEssence = (u) => TUNING.essence.perTier * unitDef(u.id).tier
const battleEssence = (battle) => battle.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0).reduce((n, u) => n + foeEssence(u), 0)
// What each foe wave of a battle paid (the formation's first), before relics: a siege pays wave by wave,
// and a boss's crumbled court as if slain.
export function essenceByWave (battle) {
  const out = battle.waveAt.map(() => 0)
  for (const u of battle.units) if (u.side === 'foe' && !u.shadow && u.hp <= 0) out[u.wave ?? 0] = (out[u.wave ?? 0] ?? 0) + foeEssence(u)
  return Array.from(out, (v) => v ?? 0)
}

// Prices: every price (a tier, a recruit, a fusion) is its base × the floor's price scale (floorPrice: 1 on floor 1,
// rising by TUNING.essence.perFloor a floor), after the relics' discounts: a kind's next tier on `track` (tiers I and
// II cut by lowTierDiscount too), a recruit (recruitDiscount).
export const floorPrice = (floor) => 1 + TUNING.essence.perFloor * (floor - 1)
const price = (run, base, ...discounts) => Math.max(1, Math.round(base * floorPrice(run.state.floor) * (1 - discounts.reduce((n, d) => n + relicSum(run.state, d), 0))))
export const tierCost = (run, kind, track) => {
  const next = run.state.kinds[kind].tracks[track]
  return price(run, TUNING.essence.tier[next], 'tierDiscount', ...(next < 2 ? ['lowTierDiscount'] : []))
}
const recruitCost = (run, id, lvl) => price(run, TUNING.essence.recruit * unitDef(id).tier * (1 + TUNING.essence.perLevel * (lvl - 1)), 'recruitDiscount')

// The kinds the run holds a soul of, in party order (the Monarch is no kind).
export const heldKinds = (s) => [...new Set(souls(s.party).map((u) => u.id))]
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

// A kind takes its next tier on `track`: every soul of it holds it, and stands at the level its tiers give (syncKind).
// A Colossus tier (`size: 2`) grows each of its
// pieces to 2×2: one that no longer fits where it stands (unit.js fits) goes to the ossuary. In party order, each
// keeps its cell if it fits beside every other kind's pieces and those of its own kind kept before it, so a piece
// is never bumped for one that goes to the ossuary itself.
function advance (s, kind, track) {
  if (!canAdvance(s, kind, track)) throw new Error(`no next tier on track ${track} for ${kind}`)
  s.kinds[kind].tracks = nextTracks(s.kinds[kind].tracks, track)
  for (const u of s.party) if (u.id === kind) u.tracks = s.kinds[kind].tracks.slice()
  syncKind(s, kind)
  const grown = fielded(s.party).filter((u) => u.id === kind)
  const taken = takenBy(s, grown)
  for (const u of grown) {
    if (fits(s.camp, u.slot, sizeOf(u), taken)) cellsOf(u).forEach((c) => taken.add(c))
    else u.slot = OSSUARY
  }
}

// A kind's level from its state ({ tracks, least? }: s.kinds[id]): TUNING.level.base + perTier a tier held on its two
// tracks, rounded down, and never below `least` (a fused kind's: the highest level of the kinds that went into it).
export const levelOf = (k) => Math.max(k.least ?? 0, Math.floor(TUNING.level.base + TUNING.level.perTier * (k.tracks[0] + k.tracks[1])))
// The level of kind `kind` in the run (its first, for a kind new to the run).
export const kindLevel = (s, kind) => levelOf(s.kinds[kind] ?? { tracks: [0, 0] })

// A kind at the level its state gives (levelOf), and every soul of it too.
function syncKind (s, kind) {
  s.kinds[kind].lvl = kindLevel(s, kind)
  for (const u of s.party) if (u.id === kind && u.lvl !== s.kinds[kind].lvl) setLevel(u, s.kinds[kind].lvl)
}

// A level-up raises each body's HP and heals each living body by the difference; the fallen stay at 0.
function setLevel (u, lvl) {
  const before = bodyHp(u)
  const living = livingBodies(u)
  u.lvl = lvl
  u.maxHp = u.count * baseStats(u.id, u.lvl).hp
  u.hp += living * (bodyHp(u) - before)
}

// The track a free tier goes on (Soul Lantern): the one with fewer tiers (the first on a tie) while it may take one,
// else the other while it may, else none (null).
export const lowerTrack = (tracks) => [tracks[1] < tracks[0] ? 1 : 0, tracks[1] < tracks[0] ? 0 : 1].find((t) => canTrack(tracks, t)) ?? null
// The free tiers a kind new to the run joins with when recruited (Soul Lantern's, a copy each): the tracks they go on,
// in order, each the lower track then (lowerTrack).
function lanternSteps (s) {
  const steps = []
  for (let tracks = [0, 0], t; steps.length < relicSum(s, 'soulTiers') && (t = lowerTrack(tracks)) !== null; tracks = nextTracks(tracks, t)) steps.push(t)
  return steps
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
// Command, as it were: more waves to a room and bigger cohorts behind each captain, floor by floor. Nothing above
// the deep. → { level, count, waves, cohort }
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

// One soul for sale per kind of foe slain: a full soul (one body) that joins its kind at the kind's level, with its
// kind's tiers (a kind new to the run at its first, with Soul Lantern's tiers: lanternSteps), priced by that level;
// one of them a battle (reap). A foe shadow is no foe's soul (it rose from one of yours: the Legion, Undead 8, on the
// foes' side).
function soulOffers (run, battle) {
  const s = run.state
  const slain = battle.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0)
  return [...new Set(slain.map((u) => u.id))].map((id) => {
    const lvl = s.kinds[id] ? kindLevel(s, id) : levelOf({ tracks: lanternSteps(s).reduce(nextTracks, [0, 0]) })
    return { type: 'soul', id, lvl, cost: recruitCost(run, id, lvl), name: unitDef(id).name, desc: `Rises at level ${lvl}.` }
  })
}

// A reliquary offers free tiers (what a rite did): up to `n` of the next tiers your kinds could take, each for a
// different kind where it can.
function tierOffers (run, n) {
  const s = run.state
  const rng = createRng(s.seed).stream(`tiers|${s.floor}|${s.at}`)
  const options = rng.shuffle(heldKinds(s).flatMap((kind) => [0, 1].filter((track) => canAdvance(s, kind, track)).map((track) => ({ kind, track }))))
  const picked = [...options.filter((o, i) => options.findIndex((x) => x.kind === o.kind) === i), ...options].filter((o, i, all) => all.indexOf(o) === i).slice(0, n)
  return picked.map(({ kind, track }) => {
    const next = s.kinds[kind].tracks[track]
    const t = tracksOf(kind)[track]
    return { type: 'tier', kind, track, name: `${unitDef(kind).name}: ${t.name} ${ROMAN[next]}`, desc: t.tiers[next].desc }
  })
}

// A relic offer: `tier` (RELIC_TIERS id) for the card.
const relicOffer = (r) => ({ type: 'relic', id: r.id, name: r.name, desc: r.desc, tier: r.tier })
// Whether relic `r` may be offered to the run: one that needs Arise only once it is held; one held, again.
const offerable = (s, r) => !r.needsArise || ariseHeld(s)
// The tier weights of `room` on the floor (TUNING.relic.weights: the floor's entry, the last for every floor past).
export const relicWeights = (room, floor) => {
  const w = TUNING.relic.weights[room]
  return w[Math.min(floor, w.length) - 1]
}

// What `room` ('reliquary' or 'elite') lays out: TUNING.relic.offer[room] relics, each of a tier drawn by the room's
// weights on the floor (relicWeights; a tier with nothing left to draw is passed over), then one of that tier, never
// one already in this offer; one the run holds may come again. A won elite's first is drawn from the Command relics
// alone (`command`), so the field never grows by luck alone, and its relics are laid out in shuffled order.
function relicOffers (s, room) {
  const rng = createRng(s.seed).stream(`relics|${s.floor}|${s.at}`)
  const weights = relicWeights(room, s.floor)
  const out = []
  for (let k = 0; k < TUNING.relic.offer[room]; k++) {
    const command = room === 'elite' && k === 0
    const left = (tier) => RELIC_LIST.filter((r) => r.tier === tier && offerable(s, r) && !out.includes(r) && (!command || r.command > 0))
    const tiers = RELIC_TIERS.filter((t) => t.id !== 'legendary' && (weights[t.id] ?? 0) > 0 && left(t.id).length)
    if (!tiers.length) break
    const tier = rng.weighted(tiers, tiers.map((t) => weights[t.id])).id
    out.push(rng.pick(left(tier)))
  }
  return (room === 'elite' ? rng.shuffle(out) : out).map(relicOffer)
}

// From floor TUNING.relic.legendary.fromFloor, an elite won and a reliquary each lay out TUNING.relic.legendary.offer
// Legendaries, free, one to take; one held may come again, and one that needs Arise only once it is held.
function legendaryOffers (s) {
  const k = TUNING.relic.legendary
  if (s.floor < k.fromFloor) return []
  const rng = createRng(s.seed).stream(`legendaries|${s.floor}|${s.at}`)
  return rng.shuffle(RELIC_LIST.filter((r) => r.tier === 'legendary' && offerable(s, r)))
    .slice(0, k.offer)
    .map(relicOffer)
}
