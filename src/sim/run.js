// The run: a state machine over draft → map → prep → reap → map, floor by floor.
// apply(run, action) is the only way to change it, legalActions(run) lists what apply accepts now,
// and the log of applied actions replays the run exactly: replay(seed, log).
//
// A battle is played on turns (turns.js; redesign.md §2.3): `fight` opens it, and the player's orders are actions of
// the run like any other. Out of battle the player's part is the retinue: which souls it recruits, keeps, fuses and
// lets go, what it spends its essence on, which souls stand in the camp, where, and which hold which relics. Slain
// foes pay essence; it buys track tiers for a kind (and with them its level), recruits, fusions and relics. Each floor
// draws its camp, a 7×7 walled layout around the Monarch's seat (content.js CAMP_LIST, 'M'), on arrival.
//
// The Monarch is you: a party unit with uid MONARCH_UID that stands on the camp's seat (unit.js monarchSlot), every
// floor, all run. No action moves it or puts anything on its cell; it can never be put in the ossuary, released or
// upgraded, holds no relic, has no level, and counts toward no cap. Nothing is bought for it (DESIGN §2.6): its two
// numbers come from run relics, a copy each, with no cap: its max HP (TUNING.monarch.hp and the HP relics: monarchHp)
// and its Command, the field cap, how many pieces fight (TUNING.party.field and the Command relics: commandOf); every
// Shop stocks a Command relic. The roads run to it (field.js field). If it falls, the battle is lost and so is the
// run.
//
// Pieces and footprints (DESIGN §2.2): one soul is one piece is one body, everywhere. The party is pieces, each one
// soul of one kind with its own HP (unit.js makeUnit) and a size (unit.js sizeOf: 2 for a kind of size 2 or one
// holding a Colossus tier, else 1). A piece's `slot` is its anchor cell; it covers its footprint (unit.js
// footprintSlots: a 2×2 also the next lane and the row ahead of both), every cell of it open ground, none the
// Monarch's seat, none another piece's (unit.js fits). Nothing stacks: a second soul of a kind is a second piece. A
// piece that fell in battle leaves the field as the battle ends (finishBattle): it lies fallen in the ossuary, its
// cell and its Command free, and nothing fields it again (canPlace) until an altar raises it.
//
// The ossuary: your collection of souls. Every piece not on the field waits there (slot OSSUARY, −1); you field
// the ones you want, up to the field cap (fieldCap: the Monarch's Command, never more than TUNING.army.board), and
// the ossuary and the field together hold at most rosterCap souls. After a win you may recruit one of the slain, a
// full soul at its kind's level (a kind new to the run at its first), for essence: a piece of its own. A soul let go
// pays back part of what recruiting it would cost now (releaseRefund).
//
// The army: the pieces fielded, and the summons their kinds' track tiers bring each battle (a tier's `summon`:
// turns.js summon), shadows of their kind beside them, the battle's alone.
//
// Kinds (DESIGN §2.6): upgrades belong to the kind, not the soul. s.kinds[id] = { lvl, tracks: [tier, tier], least? }:
// the tiers the kind holds on its two tracks (its def's `tracks`, with the crosspath rule: unit.js canTrack), and the
// level every soul of it stands at, which is its tiers' (levelOf: TUNING.level.base + perTier a tier, rounded down;
// for a fused kind never below `least`, the highest level of the kinds that went into it). No level is bought; `lvl`
// is kept in step with the tiers. Each soul of the kind carries a copy (u.lvl, u.tracks). A kind's state stays once
// made, whether or not a soul of it is left. A soul recruited joins its kind at the kind's level; a kind new to the
// run starts with no tiers (and Soul Lantern's free ones). A Colossus tier (`size: 2`) grows every piece of the kind
// to 2×2: each that no longer fits where it stands goes to the ossuary until it is placed again.
//
// Fusions (DESIGN §2.6, content.js FUSION_LIST): a recipe consumes exactly `needs` pieces of each kind from your
// pieces, fielded or in the ossuary, whole, costs fuseCost, and gives one piece of its fused kind, full HP, in the
// ossuary. It joins
// its kind, with the kind's tiers (none for a kind new to the run), at the kind's level, which is never below the
// highest level of the kinds consumed (the kind's `least` rises to it): a fused piece is never weaker than what went
// into it. Recipes are public: legalActions lists one fuse a recipe that can be made (fuseParts).
//
// Relics (content.js RELIC_LIST, RELIC_TIERS): s.relics, every relic owned, by id in the order bought, a relic bought
// twice named twice (relicCount). Relics are bought in Shops, and only there (redesign.md §2.11): a Shop stocks
// TUNING.shop.relics, drawn by tier from TUNING.relic.weights.shop for the floor, one of them always a Command relic
// and from floor TUNING.relic.legendary.fromFloor one a Legendary, the rules that rewrite the game (stockShop); each
// priced by its tier and the floor (relicPrice), and any number bought while the purse allows. A won elite lays out
// no relic: it pays essence on top of its foes' (eliteBonus). A relic is a run relic or a piece relic (redesign.md
// §2.15). A run relic (`run: true`) works unheld and its copies stack without cap: its mods on the run's own paths
// (RUN_PATHS: Command, the Monarch's HP, the roster, the prices, essence gain, Arise's reach and tier) are the run's to
// apply (runStat), and a side-wide cost on a unit's (Legion's HP) goes to the battle (battleSetup's partyMods). A
// piece relic works only through the soul holding it (u.relics: `hold`, at most TUNING.relic.perPiece a soul, one copy
// of a relic each): its mods on its holder, its triggers on its holder's moments, a Legendary's rule scoped to its
// holder (turns.js). One owned and held by no soul waits unheld (unheld): bought, given back (`unhold`), or come back
// when its holder is released or fused away; a fallen holder keeps it. An Arise relic (Arise and its variants: rules.js
// grantsArise) gives its holder the skill Arise; a relic that does nothing without one (`needsArise`: the variants,
// Hourglass, Bone Idol) is stocked only once one is owned (ariseHeld). While the run owns Court of Bone nothing heals
// the Monarch (rules.js unhealable). Nothing revives the Monarch.
//
// The enemy is an army too (drawRoom): from floor 2 its rooms have captains, each with a cohort of foes of its kind
// around it, each a foe of its own; a floor-1 elite brings a late pair; from floor 3 rooms come in waves, and a siege
// room is one battle of three. The last room is a siege whose last wave is the Hollow Sovereign and its court; its fall ends the
// battle.
//
// `fight` opens the battle (run.battle, phase 'battle'; run.setup is what it was built from), and the player's orders
// are actions of the run like any other, logged, so replay plays the battle back order by order: apply returns each
// order's events, and once the battle is over the run moves on by itself (closeBattle).
//
// An altar asks one rite of three (redesign.md §4.5), and the room ends with it: heal (every soul, and the fallen
// raised), transmute (a soul made another kind of the floor's), or consecrate (a kind's next tier, free).
//
//   phase            action
//   draft            { type: 'pick', index }        take the draft's offer `index` (s.draft.offer: kind ids), free; the
//                                                   last pick opens the first map (draftOffer, TUNING.draft)
//   map              { type: 'node', id }           walk to a connected room (a battle room, a siege too, opens prep; an
//                                                   altar asks its rite)
//   map, prep        { type: 'place', uid, slot }   move a soul (never the Monarch) to the camp cell `slot` (0–48),
//                                                   its anchor, where its footprint fits (canPlace), or to the
//                                                   ossuary (OSSUARY, −1); the one piece its footprint there
//                                                   covers (swapWith) takes the mover's old place (the ossuary, if
//                                                   it came from there), where it fits; never a footprint over two
//                                                   pieces or the seat; a soul from the ossuary only while the
//                                                   field has room, or in such a swap
//   map, prep        { type: 'fuse', id, parts }    make fusion `id` (content.js FUSIONS) of `parts`, [uid, …]:
//                                                   whole pieces, exactly the recipe's needs, for fuseCost; the
//                                                   fused piece waits in the ossuary
//   map, prep        { type: 'upgrade', kind, track }  buy a kind you hold its next tier on track 0 or 1 (and
//                                                   with it the kind's level: levelOf)
//   map, prep, reap, shop  { type: 'release', uid }  let a soul go (never the last one standing), for its refund
//                                                   (releaseRefund); the relics it held come back unheld
//   map, prep, reap, shop  { type: 'hold', relic, uid }  soul `uid` takes unheld piece relic `relic` (canHold); one
//                                                   already holding TUNING.relic.perPiece gives its first back
//   map, prep, reap, shop  { type: 'unhold', uid, relic? }  soul `uid` gives back `relic`, or every relic it holds
//   prep             { type: 'fight' }              the battle opens (phase 'battle')
//   battle           an order (turns.js legalOrders: { type: 'move' | 'undo' | 'act' | 'fuse' | 'end', … })
//                                                   given in the battle (turns.js order); returns its events
//   reap             { type: 'reap', index }        recruit offer `index`, one soul for its price, or null to move
//                                                   on; one a battle
//   shop             { type: 'buy', index }         buy stock slot `index` (s.shop: a relic id, null once bought)
//                                                   for its price (relicPrice), any number while the purse allows
//   shop             { type: 'leave' }              walk on, free
//   altar            { type: 'heal' }               every soul heals, the fallen rise (heal); the room ends
//   altar            { type: 'transmute', uid, index }  soul `uid` becomes the kind its offer `index` names
//                                                   (transmuteOffer), keeping its level and relics (transmute); the
//                                                   room ends
//   altar            { type: 'consecrate', kind, track }  kind `kind` takes its next tier on `track` free, as an
//                                                   upgrade would for its price; the room ends
//   over             { type: 'descend' }            the Sovereign slain (result 'victory'): on to the endless
//                                                   floors, each deeper than the last; nothing after a fall
//
// Endless floors: beating the Sovereign on the last floor (TUNING.run.floors) is a clear, recorded for good
// (s.result 'victory'), and the run stops there, over, unless the player descends. Floors past it reuse the
// last floor's camps and foes, growing with every floor deeper (TUNING.spawn.endless), and each ends in a big
// elite; past it the floors simply go on. A fall in the deep ends the run as any defeat does (s.death says
// what felled the Monarch) but leaves the clear standing: s.result stays 'victory'.
import { TUNING } from '../tuning.js'
import { UNIT_LIST, relicDef, unitDef, RELIC_LIST, RELIC_TIERS, CAMP_LIST, THREATS, FUSION_LIST, FUSIONS, fusionDef } from '../content.js'
import { createRng } from './rng.js'
import {
  makeUnit, autoPlace, slotAt, CAMP_SLOTS, baseStats, onField, CENTRE_OUT, campOpen, wallTiles, tracksOf, canTrack, nextTracks,
  nearestOpen, colOf, FORMATION, SLOTS, sizeOf, footprintSlots, fits, monarchSlot, isMonarchCell, isRunPath, cellsOf,
  reachOf, meleeOnly, deployTile, distance, distanceBetween, tileAt, tileX, TILES, DEPTH, ROWS
} from './unit.js'
import { roadsTo } from './field.js'
import { createBattle, order, legalOrders } from './turns.js'
import { grantsArise, unhealable } from './rules.js'
import { generateFloor, nodeOf, RANKS } from './map.js'

// The trio every run started with before the draft (2026-10-14): now only a fixed start a caller may ask for
// (createRun's `start`: the tests' plain team, a run saved before the draft, replayed), and the autoplayer's plain
// army's first souls. A run drafts its own (draftOffer).
export const START_PARTY = ['tomb_knight', 'bone_chanter', 'frost_sprite']
export const MONARCH_UID = 0
// The slot of a soul in the ossuary: kept, not fighting.
export const OSSUARY = -1
const BATTLE_NODES = ['fight', 'elite', 'boss', 'siege']
const BOSS = UNIT_LIST.find((u) => u.boss).id

// The Monarch takes the camp's seat, alone: the run opens on the draft (phase 'draft', s.draft: the pick it is on and
// the kinds offered), and the floor's map waits until the last pick. Each pick is a soul joined free (join), its kind
// with no tiers, at its first level; once all are taken they stand on the camp's default frontier (frontier) and the
// map opens. With `start` (kind ids) there is no draft: those souls stand on the frontier at once and the run opens on
// the map, as every run did before the draft (the tests' fixed team; a saved run from then, replayed: replay).
// `death` is what felled the Monarch, once something has. The ossuary starts empty. No relics (ids, in the order
// bought, a copy each); `shop`, the stock of the Shop the run stands in (stockShop), empty elsewhere.
// `ablate` (the autoplayer's ablation reports only, never a player's run): battle rules taken from the party in
// every battle of the run, carried in each battle's setup (turns.js createBattle: 'arise', 'synergies', 'summons').
// A run made without it has no such field. `ascension`, the run's level of the ladder (redesign.md §4.6; TUNING.ascension's
// row: ascensionOf), 0 the base game to ascensionTop(): its foes, their counts and their waves, the Monarch's HP and the
// prices, from the first floor drawn on; a run at 0 has no such field. `scale` (the harness's override, autoplay.js
// --builds --scale: redesign.md §3): every foe's HP and ATK × it on top of the level's (foeScale); a run at 1 has no such
// field.
export function createRun ({ seed, ablate = null, start = null, scale = 1, ascension = 0 }) {
  if (!(Number.isInteger(ascension) && ascension >= 0 && ascension <= ascensionTop())) throw new Error(`ascension ${ascension}: a level from 0 to ${ascensionTop()}`)
  const state = {
    seed, floor: 1, phase: 'map', map: null, camp: null, at: null, party: [], relics: [], offers: [], shop: [],
    essence: TUNING.essence.start, result: null, death: null, draft: null, kinds: {},
    stats: { fights: 0, wins: 0, reaped: 0, essence: 0, spent: 0, floorsCleared: 0 }, log: [], nextUid: 1
  }
  state.party = [makeUnit('monarch', { uid: MONARCH_UID, lvl: 0 })]
  if (ablate?.length) state.ablate = ablate.slice()
  if (scale !== 1) state.scale = scale
  if (ascension) {
    state.ascension = ascension
    Object.assign(monarchOf(state), { hp: monarchHp(state), maxHp: monarchHp(state) })
  }
  const run = { state, battle: null, setup: null }
  enterFloor(run)
  if (start) {
    for (const id of start) join(run, id)
    setFrontier(state, souls(state.party))
  } else {
    state.draft = { pick: 0, offer: draftOffer(seed, 0) }
    state.phase = 'draft'
  }
  return run
}

// The kinds the draft draws from: the floor-1 pool, the kinds floor 1's rooms can bring (spawnPool), in content order.
export const draftPool = () => spawnPool(1).units.map((u) => u.id)

// The kinds the draft's pick `pick` (0-based) offers, `held` the kinds of the souls taken before it: TUNING.draft.offer
// different kinds of the pool (draftPool), drawn evenly by the run's seed, a stream a pick, in the order drawn. A kind
// taken before may be offered again. From the second pick the offer holds a plan (redesign.md §4.2): at least one kind
// that goes with a soul held (partners); a draw with none gives one of its places, drawn on the same stream, to one of
// the pool's partners, drawn evenly. A draw that has one is the offer as drawn.
export function draftOffer (seed, pick, held = []) {
  const rng = createRng(seed).stream(`draft|${pick}`)
  const pool = draftPool()
  const offer = rng.shuffle(pool).slice(0, TUNING.draft.offer)
  const mates = pool.filter((id) => held.some((h) => partners(h, id)))
  if (!mates.length || offer.some((id) => mates.includes(id))) return offer
  offer[rng.int(offer.length)] = rng.pick(mates)
  return offer
}

// Whether kinds `a` and `b` make a plan together: they share a kin (a kind its own, so two of a kind is one), or a
// recipe needs both (content.js FUSION_LIST; a kind with itself where it needs two or more of it).
export function partners (a, b) {
  const kin = unitDef(a).kin
  if (kin && kin === unitDef(b).kin) return true
  return FUSION_LIST.some((r) => (a === b ? (r.needs[a] ?? 0) >= 2 : r.needs[a] && r.needs[b]))
}

// The fixed start a log was played from: a log from before the draft (one that does not open with a pick) was played
// from the trio every run then started with (START_PARTY); any other, from the draft (null).
export const startFor = (log) => (log?.length && log[0].type !== 'pick' ? START_PARTY : null)

// A run's log replays it from its seed (and the start it was played from: startFor) at its level: a run is its seed,
// its level and its log (a record of one carries `ascension` where it is not 0).
export function replay (seed, log, { ablate = null, scale = 1, ascension = 0 } = {}) {
  const run = createRun({ seed, ablate, scale, ascension, start: startFor(log) })
  for (const action of log) apply(run, action)
  return run
}

// ── the ascension ladder (redesign.md §4.6) ──────────────────────────────────────────────────────

// The highest level: TUNING.ascension's last row (level 0 the base game).
export const ascensionTop = () => TUNING.ascension.length - 1
// The run's row of multipliers (TUNING.ascension): its level's, level 0's (every one 1) for a run made without one.
export const ascensionOf = (s) => TUNING.ascension[s.ascension ?? 0]
// What every foe's HP and ATK are multiplied by in the run's battles (foeMods): its level's, × the harness's `scale`.
export const foeScale = (s) => ({ hp: ascensionOf(s).foeHp * (s.scale ?? 1), atk: ascensionOf(s).foeAtk * (s.scale ?? 1) })
// A formation's foes on `floor` (each wave's, the late pair and the cohorts aside: drawRoom), an elite's or a fight's, at
// level `ascension`: TUNING.spawn's count × the level's, rounded.
export const roomSize = (floor, elite, ascension = 0) => {
  const row = TUNING.ascension[ascension]
  return Math.round(at(elite ? TUNING.spawn.elite : TUNING.spawn.fight, floor) * (elite ? row.elite : row.fight))
}
// The turns between waves in the run's battles: TUNING.spawn.waves.every × the level's, rounded, at least 1 (turns.js
// entryTurn; battleSetup carries it where it is not the base's).
export const waveEvery = (s) => Math.max(1, Math.round(TUNING.spawn.waves.every * ascensionOf(s).every))
// The Monarch's base max HP in the run: TUNING.monarch.hp × the level's, rounded (its HP relics add to it: monarchHp).
export const monarchBase = (s) => Math.round(TUNING.monarch.hp * ascensionOf(s).monarchHp)
// Every price's scale here, against floor 1's at level 0: the floor's (floorPrice) × the level's.
export const priceScale = (s) => floorPrice(s.floor) * ascensionOf(s).price
// The unlock rule: a player whose highest level cleared is `cleared` (−1 for none) may choose any level up to the one
// above it (level 0 always), never past the top.
export const openTo = (cleared) => Math.min(ascensionTop(), Math.max(0, cleared + 1))
// A clear at `level` by a player whose highest cleared was `cleared`: the highest now, and the level it opened (null for
// none: a level below the highest cleared, or the top again).
export function clearAt (cleared, level) {
  const now = Math.max(cleared, level)
  return { cleared: now, opened: openTo(now) > openTo(cleared) ? openTo(now) : null }
}

// Applies one action, or throws if it is not legal now. In a battle on turns the action is an order (ORDERS), and
// apply returns the events it made.
export function apply (run, action) {
  const s = run.state
  if (s.phase === 'battle') return command(run, action)
  const handler = HANDLERS[action?.type]
  if (!handler) throw new Error(`unknown action "${action?.type}"`)
  if (!handler.phases.includes(s.phase)) throw new Error(`"${action.type}" needs phase ${handler.phases.join('/')}, run is in "${s.phase}"`)
  handler.run(run, action)
  s.log.push({ ...action })
}

export function legalActions (run) {
  const s = run.state
  if (s.phase === 'battle') return legalOrders(run.battle)
  if (s.phase === 'draft') return s.draft.offer.map((id, index) => ({ type: 'pick', index }))
  if (s.phase === 'map') return [...availableNodes(run).map((n) => ({ type: 'node', id: n.id })), ...rosterActions(run)]
  if (s.phase === 'prep') return [...(canFight(s) ? [{ type: 'fight' }] : []), ...rosterActions(run)]
  if (s.phase === 'reap') {
    const offers = s.offers.flatMap((o, index) => (canTake(run, o) ? [{ type: 'reap', index }] : []))
    return [...offers, { type: 'reap', index: null }, ...releasable(s).map((u) => ({ type: 'release', uid: u.uid })), ...holdActions(s)]
  }
  if (s.phase === 'shop') {
    const buys = s.shop.flatMap((id, index) => (canBuy(run, index) ? [{ type: 'buy', index }] : []))
    return [...buys, { type: 'leave' }, ...releasable(s).map((u) => ({ type: 'release', uid: u.uid })), ...holdActions(s)]
  }
  if (s.phase === 'altar') return altarActions(run)
  if (s.phase === 'over') return canDescend(s) ? [{ type: 'descend' }] : []
  return []
}

function rosterActions (run) {
  const s = run.state
  const out = []
  for (const u of souls(s.party)) {
    for (let slot = -1; slot < CAMP_SLOTS; slot++) if (canPlace(run, u, slot)) out.push({ type: 'place', uid: u.uid, slot })
  }
  for (const kind of heldKinds(s)) for (const track of [0, 1]) if (canUpgrade(run, kind, track)) out.push({ type: 'upgrade', kind, track })
  // One fuse a recipe that can be made, of its canonical parts (fuseParts: the ossuary's pieces first).
  for (const r of FUSION_LIST) if (canFuse(run, r.id)) out.push({ type: 'fuse', id: r.id, parts: fuseParts(run, r.id) })
  out.push(...releasable(s).map((u) => ({ type: 'release', uid: u.uid })))
  out.push(...holdActions(s))
  return out
}

// Every relic a soul may take or give back now: each unheld piece relic (one a relic id) to each soul that may hold it,
// and each soul's relics back.
function holdActions (s) {
  const out = []
  const ids = [...new Set(unheld(s))]
  for (const u of souls(s.party)) {
    for (const relic of ids) if (canHold(s, relic, u)) out.push({ type: 'hold', relic, uid: u.uid })
    if (u.relics?.length) out.push({ type: 'unhold', uid: u.uid })
  }
  return out
}

export const currentNode = (run) => nodeOf(run.state.map, run.state.at)

export function availableNodes (run) {
  if (run.state.phase !== 'map') return []
  return currentNode(run).next.map((id) => nodeOf(run.state.map, id))
}

// The relics owned, a copy each.
const relicDefs = (s) => s.relics.map(relicDef)

// Whether a stat path is the run's own (unit.js RUN_PATHS): every other path a relic's mods name is a unit's, and goes
// to the battle (battleSetup's partyMods; a piece relic's with its holder).
export { isRunPath }
// A run-level stat: `base` with the mods every relic held (a copy each) puts on `paths` (one path, or several read as
// one: a tier's price cut and a low tier's add up), as a unit's mods apply (unit.js statsOf): add, then mul, then the
// largest set.
export function runStat (s, paths, base) {
  const on = [paths].flat()
  let add = 0
  let mul = 1
  let set = null
  for (const r of relicDefs(s)) {
    for (const m of r.mods ?? []) {
      if (!on.includes(m.path)) continue
      if (m.op === 'add') add += m.v
      else if (m.op === 'mul') mul *= m.v
      else if (m.op === 'set') set = set === null ? m.v : Math.max(set, m.v)
    }
  }
  return set ?? (base + add) * mul
}
// How many copies of relic `id` the run owns (0: none).
export const relicCount = (s, id) => s.relics.reduce((n, x) => n + (x === id), 0)
// Whether relic `id` is a run relic (redesign.md §2.15: it works unheld); every other relic is a piece relic.
export const isRunRelic = (id) => !!relicDef(id).run
// The piece relics owned and held by no soul, by id, a copy each (in the order bought): what the Relics strip shows.
export function unheld (s) {
  const left = s.relics.filter((id) => !isRunRelic(id))
  for (const u of s.party) {
    for (const id of u.relics ?? []) {
      const i = left.indexOf(id)
      if (i >= 0) left.splice(i, 1)
    }
  }
  return left
}
// Whether soul `u` may take unheld piece relic `relic` now: a soul of the run (never the Monarch) not holding a copy of
// it already, and a copy of it unheld. One holding TUNING.relic.perPiece takes it in a swap (hold).
export const canHold = (s, relic, u) => !!u && !isMonarch(u) && s.party.includes(u) && !(u.relics ?? []).includes(relic) && unheld(s).includes(relic)
// Whether the run owns an Arise relic (Arise or a variant: rules.js grantsArise): only then is a relic that needs one
// stocked.
export const ariseHeld = (s) => s.relics.some(grantsArise)
// Arise's reach and tier for any holder, the run's (redesign.md §2.15): TUNING.arise's, with the run relics' `arise.domain`
// (Hourglass) and `arise.tier` (Bone Idol), never below 0. A variant's own reach comes on top in battle (turns.js
// ariseOf: Court of Bone's).
export const ariseOf = (s) => ({
  domain: Math.max(0, runStat(s, 'arise.domain', TUNING.arise.domain)),
  tier: Math.max(0, runStat(s, 'arise.tier', TUNING.arise.tier))
})
// The relic's tier (RELIC_TIERS id).
export const relicTier = (id) => relicDef(id).tier
// Hollow Court: the shadows its holder raised (turns.js marks each with the times it is reaped, `reap`) that still
// stood when the battle last fought was won: each pays its essence again, a time each (finishBattle).
export const reapedShadows = (run) => run.battle && run.battle.winner === 'party'
  ? run.battle.units.filter((u) => u.reap > 0 && u.side === 'party' && u.hp > 0) : []
// Whether nothing may heal the Monarch: while the run owns Court of Bone (rules.js unhealable).
export const unhealed = (s) => unhealable(s.relics)
// The field cap counts the pieces fielded, the roster every soul held: the Monarch takes no room in either. The field
// cap is the Monarch's Command, up to as many as the board holds.
// The souls every Monarch fields, its base Command: TUNING.party.field, and fieldPerFloor more a floor down (to the
// Sovereign's; 0 now: the Command relics alone widen the field).
export const baseField = (s) => TUNING.party.field + TUNING.party.fieldPerFloor * (Math.min(s.floor, TUNING.run.floors) - 1)
// The Monarch's Command: its base, and what its Command relics add, a copy each (Legion's two too); uncapped (the
// field is not: fieldCap).
export const commandOf = (s) => runStat(s, 'run.command', baseField(s))
export const fieldCap = (run) => Math.min(TUNING.army.board, commandOf(run.state))
// How many souls the retinue holds, on the field and in the ossuary together.
export const rosterCap = (run) => runStat(run.state, 'run.roster', TUNING.party.roster)
// The souls among these pieces (one a piece; the Monarch is none).
export const soulCount = (party) => souls(party).length
export const fielded = (party) => party.filter(onField)
// The souls in the ossuary: kept, not fielded.
export const inOssuary = (party) => party.filter((u) => !onField(u))
export const isMonarch = (u) => u.uid === MONARCH_UID
export const monarchOf = (s) => s.party.find(isMonarch)
// The party without the Monarch: what the caps, the ossuary and the offers count.
export const souls = (party) => party.filter((u) => !isMonarch(u))

// ── the Monarch ──────────────────────────────────────────────────────────────────────────────────

// Its max HP: its base (TUNING.monarch.hp, × the level's: monarchBase) and what its HP relics add, a copy each. Nothing
// else raises it.
export const monarchHp = (s) => runStat(s, 'run.monarchHp', monarchBase(s))

// ── the camp: footprints ─────────────────────────────────────────────────────────────────────────

// The camp cells the fielded pieces cover, the Monarch's seat among them, but `except`'s.
function takenBy (s, except = []) {
  const out = new Set()
  for (const u of s.party) if (onField(u) && !except.includes(u)) for (const c of cellsOf(u)) out.add(c)
  return out
}

// What piece `u`'s footprint would cover anchored at camp cell `slot`, but `u` itself: the one fielded piece under
// it, which a place swaps with (canPlace, place); null with none (or no footprint there); 'many' when two or more
// pieces, or the Monarch's seat, are under it: no place swaps with two, nor with the Monarch.
export function swapWith (run, u, slot) {
  const s = run.state
  const cells = footprintSlots(slot, sizeOf(u))
  if (!cells) return null
  if (cells.some((c) => isMonarchCell(s.camp, c))) return 'many'
  const under = s.party.filter((x) => x !== u && onField(x) && cellsOf(x).some((c) => cells.includes(c)))
  return under.length > 1 || under.some(isMonarch) ? 'many' : under[0] ?? null
}

// A piece new to the field (a recruit) beside the Monarch: on the free cell nearest its seat that its footprint fits
// beside every other fielded piece (ties: the middle lanes first, then the lower cell), or the ossuary (OSSUARY, −1)
// if none is left. Never out ahead of the pieces you placed.
function besideSeat (s, u) {
  const seat = deployTile('party', monarchSlot(s.camp))
  const taken = takenBy(s, [u])
  const k = (slot) => [distanceBetween(deployTile('party', slot), sizeOf(u), seat, 1), CENTRE_OUT.indexOf(colOf(slot)), slot]
  u.slot = [...Array(CAMP_SLOTS).keys()].filter((c) => fits(s.camp, c, sizeOf(u), taken)).sort((a, b) => cmp(k(a), k(b)))[0] ?? OSSUARY
}

// ── the camp: the default frontier ───────────────────────────────────────────────────────────────

// Where `pieces` stand on a camp new to them (the run's start, each floor's arrival), so that a battle begun at once
// makes sense: the front piece holds the road's choke, in the ground foes' way, and the others stand back by their reach
// (unit.js reachOf: the union of their blows'), reaching all round it: the foes it blocks, and the shooters that stop
// to shoot at it, are in their reach. Pure: → each piece's anchor slot, in order (−1: no room left for it).
export function frontier (camp, pieces) {
  const seat = monarchSlot(camp)
  const root = deployTile('party', seat)
  const roads = roadsTo(camp).field
  const lane = (x) => CENTRE_OUT.indexOf(x)
  // How many entry roads, one from each tile of the foes' rows, pass each tile on their way to the seat.
  const traffic = new Array(TILES).fill(0)
  for (let t = tileAt(0, DEPTH - ROWS); t < TILES; t++) for (let x = t; x >= 0 && x !== root; x = roads.arrow[x]) traffic[x]++
  // The choke: the busiest road tile not beside the Monarch, the furthest from the seat among the busiest.
  const cells = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(camp, slot) && slot !== seat)
  const busy = (t) => [-traffic[t], -roads.dist[t], lane(tileX(t)), t]
  const choke = cells.map((slot) => deployTile('party', slot)).filter((t) => distance(t, root) > 1)
    .sort((a, b) => cmp(busy(a), busy(b)))[0] ?? root
  // The front piece: the tankiest melee one (unit.js meleeOnly: every blow in its kit melee), the living first; with no
  // melee piece, the one of the shortest reach.
  const lead = (i) => [pieces[i].hp > 0 ? 0 : 1, meleeOnly(pieces[i]) ? 0 : 1, meleeOnly(pieces[i]) ? 0 : reachOf(pieces[i]), -pieces[i].maxHp, i]
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
  // The rest, the living first: where its reach covers the front piece's whole reach (it stands within its reach less
  // the front's, at least 1, of it), covering as little traffic as it can past where the foes meet the front piece
  // (so a shooter comes into no reach of theirs sooner), then nearest the seat; with nowhere that covers it, near the
  // seat.
  const f = { tile: deployTile('party', slots[front]), size: sizeOf(pieces[front]), reach: reachOf(pieces[front]) }
  const past = roads.dist[choke] + f.reach
  const rest = pieces.map((_, i) => i).filter((i) => i !== front).sort((a, b) => (pieces[b].hp > 0) - (pieces[a].hp > 0) || a - b)
  for (const i of rest) {
    const r = reachOf(pieces[i])
    put(i, (t, size) => {
      let over = 0
      for (let x = 0; x < TILES; x++) if (traffic[x] && roads.dist[x] > past && distanceBetween(t, size, x, 1) <= r) over += traffic[x]
      return [distanceBetween(t, size, f.tile, f.size) <= Math.max(1, r - f.reach) ? 0 : 1, over, distanceBetween(t, size, root, 1)]
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
function setFrontier (s, pieces) {
  frontier(s.camp, pieces).forEach((slot, i) => { pieces[i].slot = slot })
}

// ── the retinue: placing, releasing, buying ─────────────────────────────────────────────────────

// A soul to camp cell `slot`, its anchor, or to the ossuary (OSSUARY). Never the Monarch, which keeps its seat,
// and never onto the seat; never a fallen piece onto the camp (it waits in the ossuary for an altar). On the camp
// the piece's footprint must fit (unit.js fits) but for the one piece it covers there (swapWith), which swaps with
// it: that one takes the mover's old place, where it must fit beside the mover, or the ossuary if the mover came
// from there. A footprint over two pieces, or over the seat, places nowhere. A soul leaves the ossuary for open
// ground only while the field has room (fieldCap: Command), or in a swap.
export function canPlace (run, u, slot) {
  const s = run.state
  if (!u || isMonarch(u) || !s.party.includes(u) || slot === u.slot) return false
  if (slot === OSSUARY) return true
  if (u.hp <= 0 || !campOpen(s.camp, slot)) return false
  const other = swapWith(run, u, slot)
  if (other === 'many') return false
  const taken = takenBy(s, [u, other])
  if (!fits(s.camp, slot, sizeOf(u), taken)) return false
  if (!other) return onField(u) || fielded(souls(s.party)).length < fieldCap(run)
  if (!onField(u)) return true
  for (const c of footprintSlots(slot, sizeOf(u))) taken.add(c)
  return fits(s.camp, u.slot, sizeOf(other), taken)
}

// Releasing must leave a soul who can still fight; the Monarch is never released. The relics a soul let go held come
// back unheld (unheld counts the souls of the party).
function releasable (s) {
  const all = souls(s.party)
  return all.length > 1 ? all.filter((u) => all.some((x) => x !== u && x.hp > 0)) : []
}

// The Monarch alone may fight (and will likely fall).
const canFight = (s) => s.party.some((u) => onField(u) && u.hp > 0)

// What letting soul `u` go pays back: TUNING.essence.refund of what recruiting it would cost now, at its level
// (recruitCost), rounded down; a fallen soul's too. The Monarch is never released.
export const releaseRefund = (run, u) => Math.floor(TUNING.essence.refund * recruitCost(run, u.id, u.lvl))

// A new soul takes the free cell nearest the Monarch (besideSeat) while the field has room, else waits in the ossuary,
// a piece of its own. It joins its kind at the kind's level and tiers; a kind new to the run starts with no tiers, at
// its first level. Returns the piece.
export function join (run, id, { uid = run.state.nextUid++ } = {}) {
  const s = run.state
  if (unitDef(id).monarch) throw new Error('there is one Monarch')
  if (soulCount(s.party) >= rosterCap(run)) throw new Error('the retinue is full')
  s.kinds[id] ??= newKind()
  const u = makeUnit(id, { uid, lvl: s.kinds[id].lvl, tracks: s.kinds[id].tracks })
  s.party.push(u)
  if (fielded(souls(s.party)).length < fieldCap(run)) besideSeat(s, u)
  return u
}

// ── fusions (DESIGN §2.6) ────────────────────────────────────────────────────────────────────────

// What fusion `id` costs: TUNING.essence.fuse × its fused kind's tier, × the floor's price scale (floorPrice).
export const fuseCost = (run, id) => price(run, TUNING.essence.fuse * unitDef(fusionDef(id).result).tier)

// The parts fusion `id` takes when the run chooses them, an array of uids, or null if the retinue lacks the pieces (or
// there is no such recipe): for each kind it needs, in the recipe's order, as many of that kind's pieces as it needs,
// those in the ossuary first, then the fielded (party order among equals).
export function fuseParts (run, id) {
  const recipe = Object.hasOwn(FUSIONS, id) ? FUSIONS[id] : null
  if (!recipe) return null
  const out = []
  for (const [kind, need] of Object.entries(recipe.needs)) {
    const pieces = souls(run.state.party).filter((u) => u.id === kind).sort((a, b) => onField(a) - onField(b))
    if (pieces.length < need) return null
    out.push(...pieces.slice(0, need).map((u) => u.uid))
  }
  return out
}

// Whether fusion `id` can be made now: the run holds the pieces it needs (fuseParts) and the essence it costs.
export const canFuse = (run, id) => Object.hasOwn(FUSIONS, id) && run.state.essence >= fuseCost(run, id) && fuseParts(run, id) !== null

// `parts` (uids) as the pieces they name, if they are exactly `recipe`'s: souls of the run (never the Monarch), each
// named once, every one of a kind the recipe needs, and of each kind as many as it needs; else null.
function partsOf (s, recipe, parts) {
  if (!Array.isArray(parts)) return null
  const out = []
  const got = {}
  for (const uid of parts) {
    const u = s.party.find((x) => x.uid === uid)
    if (!u || isMonarch(u) || out.includes(u) || !Object.hasOwn(recipe.needs, u.id)) return null
    out.push(u)
    got[u.id] = (got[u.id] ?? 0) + 1
  }
  return Object.entries(recipe.needs).every(([kind, n]) => got[kind] === n) ? out : null
}

// ── action handlers ──────────────────────────────────────────────────────────────────────────────

const HANDLERS = {
  pick: { phases: ['draft'], run: pick },
  node: { phases: ['map'], run: walk },
  place: { phases: ['map', 'prep'], run: place },
  upgrade: { phases: ['map', 'prep'], run: upgrade },
  release: { phases: ['map', 'prep', 'reap', 'shop'], run: release },
  hold: { phases: ['map', 'prep', 'reap', 'shop'], run: hold },
  unhold: { phases: ['map', 'prep', 'reap', 'shop'], run: unhold },
  fuse: { phases: ['map', 'prep'], run: fuse },
  fight: { phases: ['prep'], run: fight },
  reap: { phases: ['reap'], run: reap },
  buy: { phases: ['shop'], run: buy },
  leave: { phases: ['shop'], run: leave },
  heal: { phases: ['altar'], run: heal },
  transmute: { phases: ['altar'], run: transmute },
  consecrate: { phases: ['altar'], run: consecrate },
  descend: { phases: ['over'], run: descend }
}

// A pick of the draft: the offered kind joins, free (join); the next pick's offer is drawn for the souls now held, or,
// the last taken, the souls take the camp's default frontier and the map opens.
function pick (run, { index }) {
  const s = run.state
  const id = Number.isInteger(index) ? s.draft.offer[index] : undefined
  if (!id) throw new Error(`no draft offer ${index}`)
  join(run, id)
  s.draft.pick++
  if (s.draft.pick < TUNING.draft.picks) {
    s.draft.offer = draftOffer(s.seed, s.draft.pick, souls(s.party).map((u) => u.id))
    return
  }
  s.draft = null
  setFrontier(s, souls(s.party))
  s.phase = 'map'
}

function walk (run, { id }) {
  const node = availableNodes(run).find((n) => n.id === id)
  if (!node) throw new Error(`node "${id}" is not reachable`)
  const s = run.state
  s.at = id
  if (BATTLE_NODES.includes(node.type)) {
    s.phase = 'prep'
  } else if (node.type === 'shop') {
    s.shop = stockShop(s)
    s.phase = 'shop'
  } else if (node.type === 'altar') {
    // The altar asks its rite (heal, transmute, consecrate); the room ends with it.
    s.phase = 'altar'
  } else {
    throw new Error(`unknown node type "${node.type}"`)
  }
}

function place (run, { uid, slot }) {
  const s = run.state
  const u = s.party.find((x) => x.uid === uid)
  if (!u) throw new Error(`no soul ${uid}`)
  if (!canPlace(run, u, slot)) throw new Error(`cannot place ${uid} at ${slot}`)
  const other = slot >= 0 ? swapWith(run, u, slot) : null
  if (other) other.slot = u.slot
  u.slot = slot
}

// A fusion (partsOf): its parts consumed, whole, its price paid, and its fused piece in the ossuary, full HP, with its
// kind's tiers (none for a kind new to the run), at its kind's level: the kind's `least` rises to the highest level of
// the kinds consumed, so the fused piece (and every other of its kind) is never at a lower level than its parts
// (DESIGN §2.6). The relics the parts held come back unheld; the fused piece holds none.
function fuse (run, { id, parts }) {
  const s = run.state
  const recipe = Object.hasOwn(FUSIONS, id) ? FUSIONS[id] : null
  const took = recipe && partsOf(s, recipe, parts)
  if (!took) throw new Error(`cannot fuse ${id} of ${JSON.stringify(parts)}`)
  if (s.essence < fuseCost(run, id)) throw new Error(`cannot fuse ${id}: not enough essence`)
  pay(run, fuseCost(run, id))
  const u = fused(s, recipe.result, took, s.nextUid++)
  s.party.push(u)
}

// The parts `took` leave the party, and the fused piece of `kind` comes (uid `uid`, in the ossuary), its kind's level
// never below theirs. Returns it.
function fused (s, kind, took, uid) {
  const least = Math.max(...took.map((u) => kindLevel(s, u.id)))
  s.party = s.party.filter((x) => !took.includes(x))
  s.kinds[kind] ??= newKind()
  s.kinds[kind].least = Math.max(s.kinds[kind].least ?? 0, least)
  syncKind(s, kind)
  return makeUnit(kind, { uid, lvl: s.kinds[kind].lvl, tracks: s.kinds[kind].tracks })
}

// A fusion made in a battle (turns.js `fused`: its price already paid, closeBattle): its parts leave the party (their
// relics come back unheld) and its piece joins it with the uid it fought under, on the fuser's cell where its footprint
// fits there, else in the ossuary (its HP the battle's, as any piece's: finishBattle).
function fuseIn (run, f) {
  const s = run.state
  const took = s.party.filter((u) => f.parts.includes(u.uid))
  const fuser = took.find((u) => u.uid === f.by)
  const u = fused(s, f.id, took, f.uid)
  if (fuser?.slot >= 0 && fits(s.camp, fuser.slot, sizeOf(u), takenBy(s))) u.slot = fuser.slot
  s.party.push(u)
}

function upgrade (run, { kind, track }) {
  if (!canUpgrade(run, kind, track)) throw new Error(`cannot upgrade ${kind} on track ${track}`)
  pay(run, tierCost(run, kind, track))
  advance(run.state, kind, track)
}

// A soul let go pays back its refund (releaseRefund); the relics it held come back unheld.
function release (run, { uid }) {
  const s = run.state
  const u = releasable(s).find((x) => x.uid === uid)
  if (!u) throw new Error(`cannot release ${uid}`)
  s.essence += releaseRefund(run, u)
  s.party = s.party.filter((x) => x !== u)
}

// A soul takes an unheld piece relic (canHold); one already holding TUNING.relic.perPiece gives back the first it took.
function hold (run, { relic, uid }) {
  const s = run.state
  const u = s.party.find((x) => x.uid === uid)
  if (!canHold(s, relic, u)) throw new Error(`soul ${uid} cannot hold ${relic}`)
  const now = (u.relics ?? []).slice()
  if (now.length >= TUNING.relic.perPiece) now.splice(0, now.length - TUNING.relic.perPiece + 1)
  u.relics = [...now, relic]
}

// A soul gives back `relic`, or every relic it holds; it waits unheld.
function unhold (run, { uid, relic = null }) {
  const s = run.state
  const u = souls(s.party).find((x) => x.uid === uid)
  if (!u?.relics?.length || (relic !== null && !u.relics.includes(relic))) throw new Error(`soul ${uid} holds no ${relic ?? 'relic'}`)
  const i = relic === null ? -1 : u.relics.indexOf(relic)
  u.relics = i < 0 ? [] : u.relics.filter((_, k) => k !== i)
}

// The battle opens (turns.js createBattle): the orders play it (command). It takes uids for its foes and for the
// shadows it raises; the run moves past all of them as it ends (closeBattle).
function fight (run) {
  const s = run.state
  if (!canFight(s)) throw new Error('nobody standing on the field')
  run.setup = battleSetup(run)
  run.battle = createBattle(run.setup)
  s.phase = 'battle'
  if (run.battle.over) closeBattle(run)
}

// The orders a battle takes (turns.js order): 'stall' only past the sim's bound on turns, the autoplayer's alone.
const ORDERS = ['move', 'undo', 'act', 'fuse', 'end', 'stall']

// An order in the battle: given (turns.js order, which throws on one not legal now), logged, and its events
// returned; the battle over, the run moves on (closeBattle).
function command (run, action) {
  if (!ORDERS.includes(action?.type)) throw new Error(`"${action?.type}" is no order, and the run is in battle`)
  const events = order(run.battle, action)
  run.state.log.push({ ...action })
  if (run.battle.over) closeBattle(run)
  return events
}

// A battle is over: the run takes the uids it used, pays what it spent of the purse (its fusions), takes its fusions'
// pieces in place of their parts (fuseIn), and moves on (finishBattle).
function closeBattle (run) {
  const b = run.battle
  run.state.nextUid = b.nextUid
  if (b.spent) pay(run, b.spent)
  for (const f of b.fused) fuseIn(run, f)
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

// The spoils' one recruit (a battle's only offers are its souls): offer `index` for its price, or null to take none;
// either way the room ends. A recruit of a kind new to the run joins with Soul Lantern's free tiers, a copy each, each
// on its lower track (lanternSteps). A soul is priced as it stands when taken (soulOffer).
function reap (run, { index }) {
  const s = run.state
  const o = index === null ? null : s.offers[index]
  if (index !== null && !o) throw new Error(`no offer ${index}`)
  if (o && !canTake(run, o)) {
    throw new Error(soulCount(s.party) >= rosterCap(run) ? 'the retinue is full: release a soul first' : 'not enough essence')
  }
  if (o) {
    pay(run, soulOffer(run, o).cost)
    const steps = s.kinds[o.id] ? [] : lanternSteps(s)
    join(run, o.id)
    for (const t of steps) if (canAdvance(s, o.id, t)) advance(s, o.id, t)
    s.stats.reaped++
  }
  s.offers = []
  nextRoom(run)
}

export function canTake (run, o) {
  const s = run.state
  return soulCount(s.party) < rosterCap(run) && s.essence >= soulOffer(run, o).cost
}

// A relic bought: a copy more in s.relics (a piece relic waits unheld). One that raises the Monarch's max HP
// (`run.monarchHp`) heals it by as much, unless nothing may heal it (Court of Bone, owned before or bought now).
function takeRelic (s, id) {
  const gain = monarchHp({ ...s, relics: [...s.relics, id] }) - monarchHp(s)
  s.relics.push(id)
  if (!gain) return
  const m = monarchOf(s)
  m.maxHp += gain
  if (!unhealed(s)) m.hp += gain
}

// ── the Shop (redesign.md §2.11) ─────────────────────────────────────────────────────────────────

// What relic `id` costs: TUNING.shop.price for its tier × the floor's price scale (floorPrice), after the relics that
// cut it (`price.relic`), never below 1.
export const relicPrice = (run, id) => relicTierPrice(run, relicTier(id))
// What a relic of tier `tier` (RELIC_TIERS id) costs here: relicPrice's, by tier (the Shop's prices, as a room's tip
// lists them before it is entered).
export const relicTierPrice = (run, tier) => price(run, TUNING.shop.price[tier], 'price.relic')
// Whether stock slot `index` can be bought now: a relic still on the shelf, and the purse holds its price.
export const canBuy = (run, index) => {
  const id = run.state.shop[index]
  return !!id && run.state.essence >= relicPrice(run, id)
}
// The stock as the interface shows it: each slot's relic and its price now, null for one bought.
export const shopOffers = (run) => run.state.shop.map((id, index) => id && { ...relicOffer(relicDef(id)), index, cost: relicPrice(run, id) })

// A slot bought: its price paid, the relic held (takeRelic), the slot empty. The Shop stays open for more.
function buy (run, { index }) {
  const s = run.state
  const id = s.shop[index]
  if (!id) throw new Error(`no relic in slot ${index}`)
  if (!canBuy(run, index)) throw new Error('not enough essence')
  pay(run, relicPrice(run, id))
  takeRelic(s, id)
  s.shop[index] = null
}

// Out of the Shop, free; what is left on its shelves is left behind with the room.
function leave (run) {
  run.state.shop = []
  nextRoom(run)
}

// ── the altar (redesign.md §4.5) ─────────────────────────────────────────────────────────────────

// An altar asks one rite of three, and the room ends with it (nextRoom): it bends "recruit only" without adding a soul,
// so a run that drafted into a kin the floor does not feed can turn. Nothing else is done there.

// The kinds an altar offers to make a soul of kind `kind`: TUNING.run.altarOffer kinds of the floor's pool (spawnPool:
// the kinds its foes bring) of the same tier, never its own, drawn evenly on a stream of the altar's and the kind's own
// (two souls of a kind are offered the same), in the order drawn; fewer where the pool holds fewer. None for a kind no
// foe brings: a fused kind is made, not met.
export function transmuteOffer (s, kind) {
  const d = unitDef(kind)
  if (!d.spawn) return []
  const pool = spawnPool(poolFloor(s.floor)).units.filter((u) => u.tier === d.tier && u.id !== kind).map((u) => u.id)
  return createRng(s.seed).stream(`altar|${s.floor}|${s.at}|${kind}`).shuffle(pool).slice(0, TUNING.run.altarOffer)
}
// Whether soul `u` may be transmuted now: a standing soul of the run (never the Monarch; a fallen one is the heal's to
// raise) of a kind the altar offers others for (transmuteOffer).
export const canTransmute = (s, u) => !!u && !isMonarch(u) && s.party.includes(u) && u.hp > 0 && transmuteOffer(s, u.id).length > 0

// Every rite the altar takes now: the heal; each soul's transmutation into each kind offered it (canTransmute); each
// held kind's next tier on each track that may take one (canAdvance), free.
export function altarActions (run) {
  const s = run.state
  const out = [{ type: 'heal' }]
  for (const u of souls(s.party)) if (canTransmute(s, u)) out.push(...transmuteOffer(s, u.id).map((_, index) => ({ type: 'transmute', uid: u.uid, index })))
  for (const kind of heldKinds(s)) for (const track of [0, 1]) if (canAdvance(s, kind, track)) out.push({ type: 'consecrate', kind, track })
  return out
}

// The heal, as every altar gave before it offered more: each soul heals to TUNING.run.altarHeal of its max HP, in the
// ossuary too, and a fallen one stands again at altarRevive, where it lies, in the ossuary, to be placed; the Monarch
// too, unless nothing may heal it (Court of Bone).
function heal (run) {
  const s = run.state
  const t = TUNING.run
  for (const u of s.party) {
    if (isMonarch(u) && unhealed(s)) continue
    u.hp = u.hp > 0 ? Math.max(u.hp, Math.round(u.maxHp * t.altarHeal)) : Math.ceil(u.maxHp * t.altarRevive)
  }
  nextRoom(run)
}

// A transmutation (canTransmute): soul `uid` becomes the kind its offer `index` names, the same soul, its uid, its relics
// and its share of its HP kept, on its cell where its new footprint fits there, else in the ossuary. Tiers are a kind's,
// not a soul's (DESIGN §2.6), so none moves: the old kind keeps those bought for it, for any soul of it left or recruited
// later, and the soul holds its new kind's (none for a kind new to the run; Soul Lantern lights recruits alone). Its
// level it keeps: its new kind's `least` rises to it, as a fused kind's rises to its parts' (levelOf), so it, and every
// soul of its new kind, stands at the higher of the two.
function transmute (run, { uid, index }) {
  const s = run.state
  const u = s.party.find((x) => x.uid === uid)
  const into = canTransmute(s, u) && Number.isInteger(index) ? transmuteOffer(s, u.id)[index] : undefined
  if (!into) throw new Error(`cannot transmute ${uid} into offer ${index}`)
  s.kinds[into] ??= newKind()
  s.kinds[into].least = Math.max(s.kinds[into].least ?? 0, u.lvl)
  syncKind(s, into)
  const k = s.kinds[into]
  const v = makeUnit(into, { uid: u.uid, lvl: k.lvl, tracks: k.tracks, slot: u.slot })
  v.hp = Math.max(1, Math.round(v.maxHp * u.hp / u.maxHp))
  if (u.relics) v.relics = u.relics.slice()
  s.party[s.party.indexOf(u)] = v
  if (onField(v) && !fits(s.camp, v.slot, sizeOf(v), takenBy(s, [v]))) v.slot = OSSUARY
  nextRoom(run)
}

// A consecration: kind `kind` takes its next tier on `track` (canAdvance), as buying it would (advance), at no cost.
function consecrate (run, { kind, track }) {
  if (!canAdvance(run.state, kind, track)) throw new Error(`cannot consecrate ${kind} on track ${track}`)
  advance(run.state, kind, track)
  nextRoom(run)
}

// ── internals ────────────────────────────────────────────────────────────────────────────────────

// Every battle room's foes are fixed when the floor is made, so the map can show them: `foes`, and `waves`
// for a room with more to come (see drawRoom). The floor's camp is drawn from its list: the Monarch takes its
// seat (monarchSlot), and the fielded pieces take the new camp's default frontier (setFrontier), any it leaves no room
// for going to the ossuary. A camp drawn again on the next floor (the deep reuses the last floor's few) is no camp
// new to them: they keep the cells the player gave them there.
function enterFloor (run) {
  const s = run.state
  const was = s.camp
  s.map = generateFloor({ seed: s.seed, floor: s.floor, last: s.floor === TUNING.run.floors })
  s.camp = createRng(s.seed).stream(`camp|${s.floor}`).pick(CAMP_LIST.filter((c) => c.floor === poolFloor(s.floor))).id
  monarchOf(s).slot = monarchSlot(s.camp)
  if (s.camp !== was) setFrontier(s, fielded(souls(s.party)))
  for (const n of s.map.nodes) if (BATTLE_NODES.includes(n.type)) Object.assign(n, drawRoom(s.seed, s.floor, n, { ascension: s.ascension }))
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
        Object.assign(node, drawRoom(s.seed, s.floor, node, { want: [type, ...keep], redraw: `${pass}|${k}`, ascension: s.ascension }))
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
// `waves`: [{ foes }], each a formation of its own that enters at the top edge, each foe in its slot's lane, wave k
// at the end of turn 1 + k × the run's spacing (waveEvery: TUNING.spawn.waves.every at level 0; turns.js entryTurn). A
// foe is a piece { id, lvl, slot }, in a formation of its own (a wave's slots are its own); a captain's cohort are foes
// of their own beside it.
// What comes, by room (TUNING.spawn):
//   fight   a formation of `fight` foes, floor 3+ from rank waves.fightRank: waves.fight such waves
//   elite   `elite` foes of a higher tier; floor 1: and a late pair of the floor's own pool, a wave of its own;
//           floor 3+: waves.elite waves
//   siege   waves.siege fight-sized waves, from floor 3
//   boss    waves.siege waves, the last the Hollow Sovereign at the centre of its court of `court` undead
// From floor 2 each wave (but the Sovereign's) has captains: captains.fight (captains.elite in an elite) of
// its foes, each leading cohort[floor − 1] more foes of its own kind (formation).
// Each wave's foes stand from its front row back, filling the middle lanes first, each band of lanes (centre
// three, then the next pair out…) in shuffled order.
// From rank `variety.from` on, a room must carry enough distinct threats that one answer never covers it
// (TUNING.spawn.variety, waves and depth counted; a siege or the last room as a fight): a draw short of it
// is redrawn on the same stream, keeping the most varied.
// On an endless floor (past the Sovereign's) the foes come from the last floor's pool, and the enemy keeps
// growing as an army (deepGrowth): higher levels, more foes a wave, more waves to a room, bigger cohorts;
// the floor's last room is a big elite. At a level of the ascension ladder (`ascension`, the run's) a fight's and an
// elite's count are its (roomSize), before the deep's growth.
export function drawRoom (seed, floor, node, { want = [], redraw = null, ascension = 0 } = {}) {
  const sp = TUNING.spawn
  const W = sp.waves
  const grow = deepGrowth(floor, node)
  const lvl = foeLevel(floor, node.rank) + grow.level
  const rng = createRng(seed).stream(`foes|${floor}|${node.id}${redraw === null ? '' : `|route|${redraw}`}`)
  const elite = node.type === 'elite'
  const boss = node.type === 'boss'
  const pool = spawnPool(poolFloor(floor), elite ? sp.eliteTier : 0)
  const n = Math.min(SLOTS, roomSize(floor, elite, ascension) + grow.count)
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
  if (forms.length > 1) room.waves = forms.slice(1).map((foes) => ({ foes }))
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
// each with `cohort` more foes of its kind, each on the free slot nearest the captain (unit.js nearestOpen: the
// fewest rows and lanes apart, then the fewest rows, then the lower slot, so the front rows first), and dropped when
// the formation has no free slot left. Each is an ordinary foe: it pays essence, and may be recruited.
function formation (rng, ids, lvl, captains, cohort) {
  const foes = ids.map((id) => ({ id, lvl, slot: -1 }))
  const cols = [CENTRE_OUT.slice(0, 3), ...[3, 5].map((i) => CENTRE_OUT.slice(i, i + 2))].flatMap((band) => rng.shuffle(band))
  autoPlace(foes, { cols })
  if (!cohort || !captains) return foes
  const taken = new Set(foes.map((f) => f.slot))
  for (const c of rng.shuffle(foes.slice()).slice(0, captains)) {
    for (let k = 0; k < cohort; k++) {
      const slot = nearestOpen(FORMATION, c.slot, taken)
      if (slot < 0) break
      taken.add(slot)
      foes.push({ id: c.id, lvl, slot })
    }
  }
  return foes
}

// What createBattle (turns.js) needs in the current room, with copies of the fielded souls (and the relics each
// holds) so the UI can rebuild the same battle. Leaves the run untouched: the foes take the next free uids, and the
// battle's end claims them. `party` overrides the fielded souls, for a rehearsal. Each
// piece stands where its slot puts it as the battle begins (the battle reads its footprint: unit.js sizeOf). The run
// relics' mods on a unit's stats (a side-wide cost, a kin banner's on its kin) go as `partyMods` (a piece relic's mods
// go with its holder); Arise's reach
// and tier for any holder as `arise` (ariseOf); every relic owned as `relics` (Court of Bone's Monarch that nothing
// heals); the purse a fusion in battle pays from, and each recipe's price and its fused kind's level and tiers. Shadows
// take uids after the foes' (the battle makes them: turns.js raise).
// The foes (foeUnits): the room's formation stands from the start, and its later waves wait in the reserve, each
// foe with `side: 'foe'`, its `wave` and its slot's `lane`; the foes take the first uids, the formation's then each
// wave's in order. The run's level (ascensionOf) is in the foes' mods (foeScale) and, where its waves come sooner or
// later than the base's, in `every` (waveEvery).
export function battleSetup (run, { party = fielded(run.state.party) } = {}) {
  const s = run.state
  const node = currentNode(run)
  const boss = node.type === 'boss'
  const foes = foeUnits(node, s.nextUid)
  const every = waveEvery(s)
  return {
    party: party.map((u) => ({ ...u, ...(u.relics && { relics: u.relics.slice() }) })),
    reserve: foes.filter((f) => f.wave),
    foes: foes.filter((f) => !f.wave),
    floor: s.floor,
    boss,
    camp: s.camp,
    walls: wallTiles(s.camp),
    partyMods: s.relics.filter(isRunRelic).flatMap((id) => (relicDef(id).mods ?? []).filter((m) => !isRunPath(m.path))),
    foeMods: foeMods(s.floor, boss, foeScale(s)),
    ...(every !== TUNING.spawn.waves.every && { every }),
    arise: ariseOf(s),
    nextUid: s.nextUid + foes.length,
    relics: s.relics.slice(),
    ...(s.ablate && { ablate: s.ablate.slice() }),
    essence: s.essence,
    fuse: Object.fromEntries(FUSION_LIST.map((r) => [r.id, { price: fuseCost(run, r.id), lvl: kindLevel(s, r.result), tracks: (s.kinds[r.result]?.tracks ?? [0, 0]).slice() }]))
  }
}

// A room's foes as battle units, uids from `uid` on; a later wave's foes off the board (slot −1), with their wave and
// lane (see battleSetup).
function foeUnits (node, uid) {
  const out = []
  for (const [k, foes] of [node.foes, ...(node.waves ?? []).map((w) => w.foes)].entries()) {
    for (const [i, f] of foes.entries()) {
      out.push({
        ...makeUnit(f.id, { uid: uid + i, lvl: f.lvl, slot: k ? -1 : f.slot }),
        ...(k && { side: 'foe', wave: k, lane: colOf(f.slot) })
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
  // A piece keeps the share of its HP it ended the battle with (the battle's max HP is fitted to its mods: turns.js
  // fit). A piece that fell leaves the field (DESIGN §2.2): it lies fallen in the ossuary, its cell and its Command
  // free, until an altar raises it (canPlace keeps it there); it keeps the relics it held.
  for (const u of s.party) {
    const bu = byUid.get(u.uid)
    if (!bu) continue
    u.hp = bu.hp > 0 ? Math.min(u.maxHp, Math.max(1, Math.round(bu.hp / bu.maxHp * u.maxHp))) : 0
    if (u.hp <= 0 && !isMonarch(u)) u.slot = OSSUARY
  }
  // Shadows and summons are the battle's alone: nothing of them comes back to the run.
  s.stats.fights++
  if (b.winner !== 'party') {
    s.phase = 'over'
    // A fall in the deep, past the Sovereign, leaves the clear standing.
    if (s.result !== 'victory') s.result = 'defeat'
    // Only the Monarch's fall loses a battle in play (no clock: redesign.md §2.10); the autoplayer's battle may also
    // end as a stall (turns.js stalled), a loss that is no one's blow.
    s.death = b.reason === 'monarch' ? { ...b.death, reason: 'monarch' } : { by: null, reason: b.reason, threat: null }
    return
  }
  s.stats.wins++
  // Hollow Court: the shadows its holder raised that still stand pay their essence again, a time each it reaps them. A
  // won elite pays its bonus on top (eliteBonus), and what relics add to a battle's pay (`essence.gain`) counts it too.
  const node = currentNode(run)
  const court = reapedShadows(run).reduce((n, u) => n + foeEssence(u) * u.reap, 0)
  const bonus = node.type === 'elite' ? eliteBonus(s.floor) : 0
  const earned = Math.round((battleEssence(b) + court + bonus) * runStat(s, 'essence.gain', 1))
  s.essence += earned
  s.stats.essence += earned
  // Each living soul heals; the fallen stay down.
  for (const u of s.party) {
    if (isMonarch(u) && unhealed(s)) continue
    if (u.hp > 0) u.hp = Math.min(u.maxHp, u.hp + Math.ceil(u.maxHp * TUNING.run.postBattleHeal))
  }
  if (node.type === 'boss') {
    s.stats.floorsCleared++
    s.phase = 'over'
    s.result = 'victory'
    return
  }
  s.offers = soulOffers(run, b)
  s.phase = 'reap'
}

// ── progression: the retinue ─────────────────────────────────────────────────────────────────────

// Every foe slain pays essence by its tier alone (perTier × tier), whatever its level; it all goes to one purse. Only real foes pay: a shadow (of either side) was paid for once already, as the corpse it rose from.
export const foeEssence = (u) => TUNING.essence.perTier * unitDef(u.id).tier
// What a won elite pays on top of its foes (TUNING.essence.eliteBonus × the floor's price scale), before the relics
// that raise a battle's pay. It lays out no relic: relics are bought (redesign.md §2.11).
export const eliteBonus = (floor) => Math.round(TUNING.essence.eliteBonus * floorPrice(floor))
const battleEssence = (battle) => battle.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0).reduce((n, u) => n + foeEssence(u), 0)
// What each foe wave of a battle paid (the formation's first), before relics: a siege pays wave by wave,
// and a boss's crumbled court as if slain.
export function essenceByWave (battle) {
  const out = battle.waveAt.map(() => 0)
  for (const u of battle.units) if (u.side === 'foe' && !u.shadow && u.hp <= 0) out[u.wave ?? 0] = (out[u.wave ?? 0] ?? 0) + foeEssence(u)
  return Array.from(out, (v) => v ?? 0)
}

// Prices: every price (a tier, a recruit, a fusion, a relic) is its base × the floor's price scale (floorPrice: 1 on
// floor 1, rising by TUNING.essence.perFloor a floor), × what the relics' `price.…` mods leave of it (runStat, the
// paths read as one: their cuts add up), × the run's level's (ascensionOf: `price`): a kind's next tier on `track`
// (`price.tier`, and `price.lowTier` too for tiers I and II), a recruit (`price.recruit`), a relic (`price.relic`:
// relicPrice).
export const floorPrice = (floor) => 1 + TUNING.essence.perFloor * (floor - 1)
const price = (run, base, ...paths) => Math.max(1, Math.round(base * floorPrice(run.state.floor) * runStat(run.state, paths, 1) * ascensionOf(run.state).price))
export const tierCost = (run, kind, track) => {
  const next = run.state.kinds[kind].tracks[track]
  return price(run, TUNING.essence.tier[next], 'price.tier', ...(next < 2 ? ['price.lowTier'] : []))
}
export const recruitCost = (run, id, lvl) => price(run, TUNING.essence.recruit * unitDef(id).tier * (1 + TUNING.essence.perLevel * (lvl - 1)), 'price.recruit')

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
// A kind new to the run: no tiers, at the level that gives.
const newKind = () => ({ lvl: levelOf({ tracks: [0, 0] }), tracks: [0, 0] })
// The level of kind `kind` in the run (its first, for a kind new to the run).
export const kindLevel = (s, kind) => levelOf(s.kinds[kind] ?? { tracks: [0, 0] })

// A kind at the level its state gives (levelOf), and every soul of it too.
function syncKind (s, kind) {
  s.kinds[kind].lvl = kindLevel(s, kind)
  for (const u of s.party) if (u.id === kind && u.lvl !== s.kinds[kind].lvl) setLevel(u, s.kinds[kind].lvl)
}

// A level-up raises the soul's max HP and heals a living one by the difference; the fallen stay at 0.
function setLevel (u, lvl) {
  const before = u.maxHp
  u.lvl = lvl
  u.maxHp = baseStats(u.id, u.lvl).hp
  if (u.hp > 0) u.hp += u.maxHp - before
}

// The track a free tier goes on (Soul Lantern): the one with fewer tiers (the first on a tie) while it may take one,
// else the other while it may, else none (null).
export const lowerTrack = (tracks) => [tracks[1] < tracks[0] ? 1 : 0, tracks[1] < tracks[0] ? 0 : 1].find((t) => canTrack(tracks, t)) ?? null
// The free tiers a kind new to the run joins with when recruited (Soul Lantern's, a copy each): the tracks they go on,
// in order, each the lower track then (lowerTrack).
function lanternSteps (s) {
  const steps = []
  for (let tracks = [0, 0], t; steps.length < runStat(s, 'run.soulTiers', 0) && (t = lowerTrack(tracks)) !== null; tracks = nextTracks(tracks, t)) steps.push(t)
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

// Spawnable units for a floor, weighted toward the floor's target tier (`tierBias` TUNING.spawn.eliteTier: an elite's;
// autoplay.js --pool reads it). → { units, weights }
export function spawnPool (floor, tierBias = 0) {
  const sp = TUNING.spawn
  const target = Math.min(sp.tierMax, 1 + Math.floor((floor - 1) * sp.tierPerFloor)) + tierBias
  const units = UNIT_LIST.filter((u) => u.spawn && u.spawn.minFloor <= floor && u.tier <= target + sp.tierOverCap)
  return { units, weights: units.map((u) => u.spawn.weight / Math.pow(1 + Math.abs(u.tier - target), sp.tierFalloff)) }
}

// In the boss's room only the boss takes the boss's multipliers; its waves and court take the floor's. Past
// the Sovereign's floor every floor deeper adds TUNING.spawn.endless's hp and atk shares to them all. `scale`, the
// run's (foeScale: its level's and the harness's), multiplies every foe's, the boss's too: { hp, atk }, or one number
// for both.
export function foeMods (floor, boss, scale = 1) {
  const sp = TUNING.spawn
  const by = typeof scale === 'number' ? { hp: scale, atk: scale } : scale
  const grow = (key) => (1 + sp.endless[key] * depthOf(floor)) * by[key]
  const mods = [{ path: 'hp', op: 'mul', v: at(sp.foeHp, floor) * grow('hp') }, { path: 'atk', op: 'mul', v: at(sp.foeAtk, floor) * grow('atk') }]
  if (!boss) return mods
  return [
    { path: 'hp', op: 'mul', v: sp.bossHp * grow('hp'), who: { boss: true } },
    { path: 'atk', op: 'mul', v: sp.bossAtk * grow('atk'), who: { boss: true } },
    ...mods.map((m) => ({ ...m, who: { boss: false } }))
  ]
}

// ── rewards ──────────────────────────────────────────────────────────────────────────────────────

// One soul for sale per kind of foe slain: a full soul that joins its kind at the kind's level, with its kind's tiers
// (a kind new to the run at its first, with Soul Lantern's tiers: lanternSteps), priced by that level; one of them a
// battle (reap). A foe shadow is no foe's soul (it rose from one of yours: the Legion, Undead 8, on the foes' side).
function soulOffers (run, battle) {
  const slain = battle.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0)
  return [...new Set(slain.map((u) => u.id))].map((id) => soulOffer(run, { type: 'soul', id, name: unitDef(id).name }))
}

// A soul offer as the run stands now: the level it would join at (its kind's; a kind new to the run its first, with
// the free tiers Soul Lantern would give it), what it costs at that level (recruitCost) and the card's line. Every
// reading of an offer's price or level goes through here (canTake, reap, the spoils screen), so the relics held now
// (Soul Lantern, Binding Chain) are in the price.
export function soulOffer (run, o) {
  const s = run.state
  const lvl = s.kinds[o.id] ? kindLevel(s, o.id) : levelOf({ tracks: lanternSteps(s).reduce(nextTracks, [0, 0]) })
  return { ...o, lvl, cost: recruitCost(run, o.id, lvl), desc: `Rises at level ${lvl}.` }
}

// A relic as the Shop's card shows it (shopOffers): `tier` (RELIC_TIERS id).
const relicOffer = (r) => ({ type: 'relic', id: r.id, name: r.name, desc: r.desc, tier: r.tier })
// Whether relic `r` may be stocked for the run: one that needs Arise only once an Arise relic is owned; one owned, again.
const offerable = (s, r) => !r.needsArise || ariseHeld(s)
// A Shop's tier weights on the floor (TUNING.relic.weights.shop: the floor's entry, the last for every floor past).
export const relicWeights = (floor) => {
  const w = TUNING.relic.weights.shop
  return w[Math.min(floor, w.length) - 1]
}

// A Shop's stock (redesign.md §2.11): TUNING.shop.relics relic ids, drawn on a stream of the room's own, so a replay
// stocks it again. Each Common to Rare relic is of a tier drawn by the Shop's weights on the floor (relicWeights; a
// tier with nothing left to draw is passed over), then one of that tier, never one already on the shelf; the first
// drawn from the Command relics alone, so the field never grows by luck. From floor TUNING.relic.legendary.fromFloor
// one slot is a Legendary. One the run holds may come again. Laid out in shuffled order.
function stockShop (s) {
  const rng = createRng(s.seed).stream(`shop|${s.floor}|${s.at}`)
  const weights = relicWeights(s.floor)
  const command = (r) => (r.mods ?? []).some((m) => m.path === 'run.command' && m.v > 0)
  const out = []
  const legendary = s.floor >= TUNING.relic.legendary.fromFloor ? 1 : 0
  for (let k = 0; k < TUNING.shop.relics - legendary; k++) {
    const left = (tier) => RELIC_LIST.filter((r) => r.tier === tier && offerable(s, r) && !out.includes(r) && (k > 0 || command(r)))
    const tiers = RELIC_TIERS.filter((t) => t.id !== 'legendary' && (weights[t.id] ?? 0) > 0 && left(t.id).length)
    if (!tiers.length) break
    out.push(rng.pick(left(rng.weighted(tiers, tiers.map((t) => weights[t.id])).id)))
  }
  const legendaries = RELIC_LIST.filter((r) => r.tier === 'legendary' && offerable(s, r))
  if (legendary && legendaries.length) out.push(rng.pick(legendaries))
  return rng.shuffle(out).map((r) => r.id)
}
