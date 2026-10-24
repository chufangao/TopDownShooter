// The run: a state machine over draft → map → prep → battle → reap → map, floor by floor. apply(run, action) is the only
// way to change it, legalActions(run) lists what apply accepts now, and the log replays it exactly: replay(seed, log).
// run.state:
//   seed, floor, phase, map, at (the room stood in), camp, essence, result ('victory' | 'defeat' | null), death
//   party    the Monarch (uid MONARCH_UID, on the camp's seat) and every soul, one piece each, its tiers (`tracks`), level and
//            relics its own; slot OSSUARY (−1): in the ossuary
//   relics   every relic owned, by id in the order bought; `shop` the floor's shelf (relic ids, null once bought)
//   draft, offers (the spoils' souls), stats, log, nextUid; where set: ablate, ascension, scale, monarch, tutorial
// Actions, by phase:
//   draft            { type: 'pick', index }             take draft offer `index`, free
//   map              { type: 'node', id }                walk to a connected room
//   map, prep        { type: 'place', uid, slot }        a soul to camp cell `slot` (its anchor) or the ossuary (−1)
//   map, prep        { type: 'fuse', id, parts }         make fusion `id` of `parts` (uids), for fuseCost
//   map, prep        { type: 'upgrade', uid, track }     buy a soul its next tier on track 0 or 1
//   map, prep, reap  { type: 'release', uid }            let a soul go, for its refund (releaseRefund)
//   map, prep, reap  { type: 'hold', relic, uid }        a soul takes an unheld piece relic; 'unhold' { uid, relic? }
//   map, prep, reap  { type: 'buy', index }              buy the shelf's slot `index` (relicPrice)
//   prep             { type: 'fight' }                   the battle opens; in it an action is an order (turns.js order)
//   reap             { type: 'reap', index }             recruit offer `index`, or null to move on
//   altar            'heal', 'transmute' { uid, index }, 'consecrate' { uid, track }: one rite, and the room ends
//   over             { type: 'descend' }                 past the Sovereign, on to the endless floors
import { TUNING } from '../tuning.js'
import { relicDef, unitDef, CAMP_LIST, FUSION_LIST, FUSIONS, TUTORIAL, MONARCH_LIST, MONARCHS } from '../content.js'
import { createRng } from './rng.js'
import {
  makeUnit, slotAt, CAMP_SLOTS, onField, CENTRE_OUT, campOpen, wallTiles, colOf, sizeOf, footprintSlots, fits,
  monarchSlot, isMonarchCell, isRunPath, cellsOf, reachOf, meleeOnly, deployTile, distance, distanceBetween, tileAt,
  tileX, TILES, DEPTH, ROWS
} from './unit.js'
import { roadsTo } from './field.js'
import { createBattle, order, legalOrders } from './turns.js'
import { generateFloor, nodeOf, RANKS, WIDTH } from './map.js'
import {
  MONARCH_UID, OSSUARY, BATTLE_NODES, runStat, isRunRelic, unheld, canHold, ariseOf, fieldCap,
  rosterCap, soulCount, fielded, isMonarch, monarchOf, souls, takenBy, monarchHp, ascensionTop, foeScale, waveEvery
} from './state.js'
import {
  battleEssence, clearsRun, bountyOf, tierCost, tierRefund, recruitCost, fuseCost, relicPrice, canAdvance,
  canUpgrade, pay, advance, levelOf, firstLevel, freshTracks, lanternSteps, markFree, soulOffers, soulOffer, relicOffer, stockShop, restock
} from './economy.js'
import {
  varyRoutes, drawRoom, bossPool, bossFor, answerArmy, foeUnits, foeLevel, poolFloor, spawnPool, foeMods
} from './spawn.js'

// Its parts, re-exported: whatever reads the run imports it from here.
export * from './state.js'
export * from './economy.js'
export * from './spawn.js'

// A fixed start a caller may ask for (createRun's `start`): the tests' plain team, a log from before the draft.
export const START_PARTY = ['tomb_knight', 'bone_chanter', 'frost_sprite']

// A new run: the Monarch on the camp's seat and the draft open, the map waiting for its last pick. With `start` (kind
// ids) there is no draft: those souls stand on the frontier and the map opens. `ablate`, `ascension`, `scale` and
// `monarch` (another than the base one holds its relic and drafts with its bias) are kept on the state only where set.
export function createRun ({ seed, ablate = null, start = null, scale = 1, ascension = 0, monarch = BASE_MONARCH }) {
  if (!(Number.isInteger(ascension) && ascension >= 0 && ascension <= ascensionTop())) throw new Error(`ascension ${ascension}: a level from 0 to ${ascensionTop()}`)
  if (!Object.hasOwn(MONARCHS, monarch)) throw new Error(`monarch "${monarch}": one of ${MONARCH_LIST.map((m) => m.id).join(', ')}`)
  const state = {
    seed, floor: 1, phase: 'map', map: null, camp: null, at: null, party: [], relics: [], offers: [], shop: [],
    essence: TUNING.essence.start, result: null, death: null, draft: null,
    stats: { fights: 0, wins: 0, reaped: 0, essence: 0, spent: 0, floorsCleared: 0 }, log: [], nextUid: 1
  }
  state.party = [makeUnit('monarch', { uid: MONARCH_UID, lvl: 0 })]
  if (ablate?.length) state.ablate = ablate.slice()
  if (scale !== 1) state.scale = scale
  if (ascension) {
    state.ascension = ascension
    Object.assign(monarchOf(state), { hp: monarchHp(state), maxHp: monarchHp(state) })
  }
  if (monarch !== BASE_MONARCH) {
    state.monarch = monarch
    if (MONARCHS[monarch].relic) takeRelic(state, MONARCHS[monarch].relic)
  }
  const run = { state, battle: null, setup: null }
  enterFloor(run)
  if (start) {
    for (const id of start) join(run, id)
    setFrontier(state, souls(state.party))
    openFloor(run)
  } else {
    state.draft = { pick: 0, offer: draftOffer(seed, 0, [], biasOf(state)) }
    state.phase = 'draft'
  }
  return run
}

// Applies one action, or throws if it is not legal now; in battle the action is an order, and apply returns its events.
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
    return [...offers, { type: 'reap', index: null }, ...buyActions(run), ...releasable(s).map((u) => ({ type: 'release', uid: u.uid })), ...holdActions(s)]
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
  for (const u of souls(s.party)) for (const track of [0, 1]) if (canUpgrade(run, u, track)) out.push({ type: 'upgrade', uid: u.uid, track })
  // One fuse a recipe that can be made, of its canonical parts (fuseParts: the ossuary's pieces first).
  for (const r of FUSION_LIST) if (canFuse(run, r.id)) out.push({ type: 'fuse', id: r.id, parts: fuseParts(run, r.id) })
  out.push(...buyActions(run))
  out.push(...releasable(s).map((u) => ({ type: 'release', uid: u.uid })))
  out.push(...holdActions(s))
  return out
}

const buyActions = (run) => run.state.shop.flatMap((id, index) => (canBuy(run, index) ? [{ type: 'buy', index }] : []))

// Every piece relic a soul may take or give back now.
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

// ── the Monarchs ─────────────────────────────────────────────────────────────────────────────────

export const BASE_MONARCH = MONARCH_LIST[0].id
export const monarchDef = (s) => MONARCHS[s.monarch ?? BASE_MONARCH]
// The kin the run's draft favours (its Monarch's `bias`), or null.
export const biasOf = (s) => monarchDef(s).bias ?? null
// The Monarchs open to a player whose highest level cleared is `cleared` (−1: none), the base one always, in content order.
export const monarchsOpen = (cleared) => MONARCH_LIST.filter((m) => m.unlock === undefined || cleared >= m.unlock).map((m) => m.id)
// The Monarchs a clear at `level` opened for a player whose highest cleared was `cleared`. → their ids (none: []).
export function monarchsAt (cleared, level) {
  const before = new Set(monarchsOpen(cleared))
  return monarchsOpen(Math.max(cleared, level)).filter((id) => !before.has(id))
}

// The tutorial: one room before floor 1 in a real run state, never saved: a fixed start, its seed's floor-1 camp, and a
// map of the threshold and one fight of the tutorial's foes; won, its spoils end it (phase 'over', no result).
export function tutorialRun () {
  const run = createRun({ seed: TUTORIAL.seed, start: TUTORIAL.party, scale: TUTORIAL.scale ?? 1 })
  const s = run.state
  s.tutorial = true
  const lane = (WIDTH - 1) / 2
  const foes = TUTORIAL.foes.map((f) => ({ id: f.id, lvl: foeLevel(1), slot: slotAt(f.row, f.lane) }))
  s.map = {
    floor: 1,
    nodes: [{ id: '0.0', rank: 0, lane, type: 'start', next: ['1.0'] }, { id: '1.0', rank: RANKS - 1, lane, type: 'fight', next: [], foes }],
    start: '0.0',
    end: '1.0'
  }
  s.at = s.map.start
  return run
}

// The kinds the draft draws from: the kinds floor 1's rooms can bring, in content order.
export const draftPool = () => spawnPool(1).units.map((u) => u.id)

// The kinds draft pick `pick` offers, `held` the kinds taken before: TUNING.draft.offer of the pool on a stream a pick
// (a Monarch's `bias` kin weighed TUNING.monarchs.bias); from the second pick, at least one a partner of a soul held;
// and always one at least that strikes past melee, drawn as the rest are into a place no partner nor `bias` kin needs.
export function draftOffer (seed, pick, held = [], bias = null) {
  const rng = createRng(seed).stream(`draft|${pick}`)
  const pool = draftPool()
  const weight = (id) => (bias && unitDef(id).kin === bias ? TUNING.monarchs.bias : 1)
  const offer = bias ? weighedDraw(rng, pool, weight, TUNING.draft.offer) : rng.shuffle(pool).slice(0, TUNING.draft.offer)
  const mates = pool.filter((id) => held.some((h) => partners(h, id)))
  if (mates.length && !offer.some((id) => mates.includes(id))) offer[rng.int(offer.length)] = rng.pick(mates)
  const shooters = pool.filter((id) => shoots(id) && !offer.includes(id))
  if (offer.some(shoots) || !shooters.length) return offer
  // The place given up: none the only partner held, nor of the bias kin, where another will do.
  const needed = (id) => mates.includes(id) && offer.filter((x) => mates.includes(x)).length === 1
  const all = offer.map((id, i) => i).filter((i) => !needed(offer[i]))
  const free = all.filter((i) => !(bias && unitDef(offer[i]).kin === bias))
  const places = free.length ? free : all.length ? all : offer.map((id, i) => i)
  offer[places[rng.int(places.length)]] = rng.weighted(shooters, shooters.map(weight))
  return offer
}

// Whether a kind's kit holds a blow past melee (every kind has a blow: unit.js meleeOnly).
const shoots = (id) => !meleeOnly(makeUnit(id))

// `n` different items of `items` drawn one at a time on `rng`, each by its `weight` among those left. → in the order drawn
function weighedDraw (rng, items, weight, n) {
  const left = items.slice()
  const out = []
  while (out.length < n && left.length) {
    const x = rng.weighted(left, left.map(weight))
    out.push(x)
    left.splice(left.indexOf(x), 1)
  }
  return out
}

// Whether kinds `a` and `b` make a plan together: they share a kin, or a recipe needs both (a kind with itself: two of it).
export function partners (a, b) {
  const kin = unitDef(a).kin
  if (kin && kin === unitDef(b).kin) return true
  return FUSION_LIST.some((r) => (a === b ? (r.needs[a] ?? 0) >= 2 : r.needs[a] && r.needs[b]))
}

// The fixed start a log was played from: START_PARTY for a log from before the draft (not opening on a pick), else null.
export const startFor = (log) => (log?.length && log[0].type !== 'pick' ? START_PARTY : null)

// A run replayed from its seed and log; any other createRun option is passed as given (`ascension`, `ablate`, `scale`…).
export function replay (seed, log, opts = {}) {
  const run = createRun({ start: startFor(log), ...opts, seed })
  for (const action of log) apply(run, action)
  return run
}

// A copy of a run to play ahead on, taken between battles: its state copied by hand (plain data, nothing reached twice),
// but for the log's entries and the floor's map once drawn (openFloor), which are never written and stay shared.
export const copyRun = (run) => ({ state: copyState(run.state), battle: null, setup: null })
function copyState (s) {
  const out = {}
  for (const k in s) out[k] = k === 'log' ? s.log.slice() : k === 'map' && s.phase !== 'draft' ? s.map : copyPlain(s[k])
  return out
}
// A deep copy of plain data (copyRun's): objects and arrays copied, key order kept, anything else as it is.
export function copyPlain (v) {
  if (typeof v !== 'object' || v === null) return v
  if (Array.isArray(v)) {
    const out = []
    for (let i = 0; i < v.length; i++) out.push(copyPlain(v[i]))
    return out
  }
  const out = {}
  for (const k in v) out[k] = copyPlain(v[k])
  return out
}

// ── the camp: footprints ─────────────────────────────────────────────────────────────────────────

// The one fielded piece `u`'s footprint would cover anchored at `slot` (it swaps with it), null for none, 'many' for two
// or more or the Monarch's seat (no place swaps with those).
export function swapWith (run, u, slot) {
  const s = run.state
  const cells = footprintSlots(slot, sizeOf(u))
  if (!cells) return null
  if (cells.some((c) => isMonarchCell(s.camp, c))) return 'many'
  const under = s.party.filter((x) => x !== u && onField(x) && cellsOf(x).some((c) => cells.includes(c)))
  return under.length > 1 || under.some(isMonarch) ? 'many' : under[0] ?? null
}

// A recruit beside the Monarch: on the free cell nearest its seat that its footprint fits (ties: the middle lanes, then
// the lower cell), else the ossuary.
function besideSeat (s, u) {
  const seat = deployTile('party', monarchSlot(s.camp))
  const taken = takenBy(s, [u])
  const k = (slot) => [distanceBetween(deployTile('party', slot), sizeOf(u), seat, 1), CENTRE_OUT.indexOf(colOf(slot)), slot]
  u.slot = [...Array(CAMP_SLOTS).keys()].filter((c) => fits(s.camp, c, sizeOf(u), taken)).sort((a, b) => cmp(k(a), k(b)))[0] ?? OSSUARY
}

// ── the camp: the default frontier ───────────────────────────────────────────────────────────────

// Where `pieces` stand on a camp new to them: the front piece on the road's choke, in the ground foes' way, the others
// back by their reach, covering it. Pure: → each piece's anchor slot, in order (−1: no room left for it).
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
  // The front piece: the tankiest melee one, the living first; with no melee piece, the one of the shortest reach.
  const lead = (i) => [pieces[i].hp > 0 ? 0 : 1, meleeOnly(pieces[i]) ? 0 : 1, meleeOnly(pieces[i]) ? 0 : reachOf(pieces[i]), -pieces[i].maxHp, i]
  const front = pieces.map((_, i) => i).sort((a, b) => cmp(lead(a), lead(b)))[0]
  // Each piece in turn on the free cell its footprint fits that `rank`s first (then lane order, then the lower cell).
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
  // The rest, the living first: where its reach covers the front piece's, covering as little traffic past the front as
  // it can (so a shooter comes into no foe's reach sooner), then nearest the seat.
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

function setFrontier (s, pieces) {
  frontier(s.camp, pieces).forEach((slot, i) => { pieces[i].slot = slot })
}

// ── the retinue: placing, releasing, buying ─────────────────────────────────────────────────────

// Whether soul `u` may go to camp cell `slot` (its anchor) or the ossuary: never the Monarch nor onto its seat, never a
// fallen soul onto the camp; its footprint must fit but for the one piece it covers (swapWith), which takes its old
// place. A soul leaves the ossuary for open ground only while the field has room (fieldCap), or in a swap.
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

// The souls that may be let go: never the last one standing, never the Monarch.
function releasable (s) {
  const all = souls(s.party)
  return all.length > 1 ? all.filter((u) => all.some((x) => x !== u && x.hp > 0)) : []
}

// The Monarch alone may fight (and will likely fall).
const canFight = (s) => s.party.some((u) => onField(u) && u.hp > 0)

// What letting soul `u` go pays back: TUNING.essence.refund of what recruiting one of its kind costs now, rounded down,
// and the same share of each tier it holds (tierRefund).
export const releaseRefund = (run, u) => Math.floor(TUNING.essence.refund * recruitCost(run, u.id)) + tierRefund(run, u)

// A new soul joins with Soul Lantern's free tiers (freshTracks, marked free: they pay nothing back) and the level they
// give, beside the Monarch while the field has room, else in the ossuary. → the piece.
export function join (run, id, { uid = run.state.nextUid++ } = {}) {
  const s = run.state
  if (unitDef(id).monarch) throw new Error('there is one Monarch')
  if (soulCount(s.party) >= rosterCap(run)) throw new Error('the retinue is full')
  const tracks = freshTracks(s)
  const u = makeUnit(id, { uid, lvl: levelOf({ tracks }), tracks })
  const at = [0, 0]
  for (const t of lanternSteps(s)) markFree(u, t, at[t]++)
  s.party.push(u)
  if (fielded(souls(s.party)).length < fieldCap(run)) besideSeat(s, u)
  return u
}

// ── fusions ──────────────────────────────────────────────────────────────────────────────────────

// The tiers a soul holds, both tracks together.
const tiersHeld = (u) => u.tracks[0] + u.tracks[1]

// The parts the run picks for fusion `id`, uids, or null where the retinue lacks them: for each kind it needs, in the
// recipe's order, its pieces in the ossuary first, then the fielded; among each those holding the fewest relics first
// (a holder's relic would come back unheld), then the fewest tiers (the least growth given up), party order among
// equals. A fuse logged names its parts, so a saved run replays whatever this picks.
export function fuseParts (run, id) {
  const recipe = Object.hasOwn(FUSIONS, id) ? FUSIONS[id] : null
  if (!recipe) return null
  const out = []
  for (const [kind, need] of Object.entries(recipe.needs)) {
    const pieces = souls(run.state.party).filter((u) => u.id === kind).sort((a, b) => onField(a) - onField(b) || (a.relics?.length ?? 0) - (b.relics?.length ?? 0) || tiersHeld(a) - tiersHeld(b))
    if (pieces.length < need) return null
    out.push(...pieces.slice(0, need).map((u) => u.uid))
  }
  return out
}

export const canFuse = (run, id) => Object.hasOwn(FUSIONS, id) && run.state.essence >= fuseCost(run, id) && fuseParts(run, id) !== null
// What fusion `id`'s canonical parts (fuseParts) pay back for the tiers they hold (tierRefund); 0 with none.
export const fuseRefund = (run, id) => (fuseParts(run, id) ?? []).reduce((n, uid) => n + tierRefund(run, run.state.party.find((u) => u.uid === uid)), 0)

// `parts` (uids) as the pieces they name if they are exactly `recipe`'s needs (souls, each once), else null.
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
  release: { phases: ['map', 'prep', 'reap'], run: release },
  hold: { phases: ['map', 'prep', 'reap'], run: hold },
  unhold: { phases: ['map', 'prep', 'reap'], run: unhold },
  fuse: { phases: ['map', 'prep'], run: fuse },
  fight: { phases: ['prep'], run: fight },
  reap: { phases: ['reap'], run: reap },
  buy: { phases: ['map', 'prep', 'reap'], run: buy },
  heal: { phases: ['altar'], run: heal },
  transmute: { phases: ['altar'], run: transmute },
  consecrate: { phases: ['altar'], run: consecrate },
  descend: { phases: ['over'], run: descend }
}

// A draft pick: the offered kind joins free; then the next pick's offer, or after the last the frontier and the map.
function pick (run, { index }) {
  const s = run.state
  const id = Number.isInteger(index) ? s.draft.offer[index] : undefined
  if (!id) throw new Error(`no draft offer ${index}`)
  join(run, id)
  s.draft.pick++
  if (s.draft.pick < TUNING.draft.picks) {
    s.draft.offer = draftOffer(s.seed, s.draft.pick, souls(s.party).map((u) => u.id), biasOf(s))
    return
  }
  s.draft = null
  setFrontier(s, souls(s.party))
  s.phase = 'map'
  openFloor(run)
}

function walk (run, { id }) {
  const node = availableNodes(run).find((n) => n.id === id)
  if (!node) throw new Error(`node "${id}" is not reachable`)
  const s = run.state
  s.at = id
  if (BATTLE_NODES.includes(node.type)) {
    s.phase = 'prep'
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

// A fusion, a trade of souls and essence for a soul: its parts consumed, its price paid, the tiers the parts held paid
// back (tierRefund), and the fused soul in the ossuary at full HP, fresh: its first level, no tier, no relic (the
// parts' wait unheld).
function fuse (run, { id, parts }) {
  const s = run.state
  const recipe = Object.hasOwn(FUSIONS, id) ? FUSIONS[id] : null
  const took = recipe && partsOf(s, recipe, parts)
  if (!took) throw new Error(`cannot fuse ${id} of ${JSON.stringify(parts)}`)
  if (s.essence < fuseCost(run, id)) throw new Error(`cannot fuse ${id}: not enough essence`)
  pay(run, fuseCost(run, id))
  s.essence += took.reduce((n, u) => n + tierRefund(run, u), 0)
  s.party = s.party.filter((x) => !took.includes(x))
  s.party.push(makeUnit(recipe.result, { uid: s.nextUid++, lvl: firstLevel() }))
}

// A soul buys its next tier on `track` (advance), for tierCost.
function upgrade (run, { uid, track }) {
  const u = run.state.party.find((x) => x.uid === uid)
  if (!canUpgrade(run, u, track)) throw new Error(`cannot upgrade ${uid} on track ${track}`)
  pay(run, tierCost(run, u, track))
  advance(run.state, u, track)
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

// The battle opens (turns.js createBattle) and the orders play it (command).
function fight (run) {
  const s = run.state
  if (!canFight(s)) throw new Error('nobody standing on the field')
  run.setup = battleSetup(run)
  run.battle = createBattle(run.setup)
  s.phase = 'battle'
  if (run.battle.over) closeBattle(run)
}

// The orders a battle takes (turns.js order): 'stall' only past the sim's bound on turns, the autoplayer's alone.
const ORDERS = ['move', 'undo', 'act', 'end', 'stall']

// An order in the battle: given (turns.js order throws on an illegal one), logged, its events returned.
function command (run, action) {
  if (!ORDERS.includes(action?.type)) throw new Error(`"${action?.type}" is no order, and the run is in battle`)
  const events = order(run.battle, action)
  run.state.log.push({ ...action })
  if (run.battle.over) closeBattle(run)
  return events
}

// A battle is over: the run takes the uids it used and moves on (finishBattle).
function closeBattle (run) {
  run.state.nextUid = run.battle.nextUid
  finishBattle(run)
}

// Past the Sovereign, the next floor down, as any floor on arrival; only from a clear the Monarch survived.
export const canDescend = (s) => s.phase === 'over' && s.result === 'victory' && s.death === null
function descend (run) {
  const s = run.state
  if (!canDescend(s)) throw new Error('only a run that slew the Sovereign may descend')
  s.floor++
  enterFloor(run)
  openFloor(run)
}

// The spoils' one recruit: offer `index` for its price (as it stands now), or null for none; either way the room ends.
function reap (run, { index }) {
  const s = run.state
  const o = index === null ? null : s.offers[index]
  if (index !== null && !o) throw new Error(`no offer ${index}`)
  if (o && !canTake(run, o)) {
    throw new Error(soulCount(s.party) >= rosterCap(run) ? 'the retinue is full: release a soul first' : 'not enough essence')
  }
  if (o) {
    pay(run, soulOffer(run, o).cost)
    join(run, o.id)
    s.stats.reaped++
  }
  s.offers = []
  nextRoom(run)
}

function canTake (run, o) {
  const s = run.state
  return soulCount(s.party) < rosterCap(run) && s.essence >= soulOffer(run, o).cost
}

// A relic owned: a copy more in s.relics; one that raises the Monarch's max HP heals it by as much.
function takeRelic (s, id) {
  const gain = monarchHp({ ...s, relics: [...s.relics, id] }) - monarchHp(s)
  s.relics.push(id)
  if (!gain) return
  const m = monarchOf(s)
  m.maxHp += gain
  m.hp += gain
}

// ── the Shop ─────────────────────────────────────────────────────────────────────────────────────

// No room: the floor's shelf (s.shop), open in map, prep and reap.

export const canBuy = (run, index) => {
  const id = run.state.shop[index]
  return !!id && run.state.essence >= relicPrice(run, id)
}
// The shelf as the interface shows it: each slot's relic and its price now, null for one bought.
export const shopOffers = (run) => run.state.shop.map((id, index) => id && { ...relicOffer(relicDef(id)), index, cost: relicPrice(run, id) })
// The Shop's Fusions as the interface shows them: every recipe whose parts are all held, with its fuse action, its
// price, what its parts' tiers pay back (`back`), whether the phase fuses (`open`) and whether it can be made now (`can`).
export function shelfFusions (run) {
  const open = HANDLERS.fuse.phases.includes(run.state.phase)
  return FUSION_LIST.flatMap((f) => {
    const parts = fuseParts(run, f.id)
    return parts ? [{ id: f.id, action: { type: 'fuse', id: f.id, parts }, cost: fuseCost(run, f.id), back: fuseRefund(run, f.id), open, can: open && canFuse(run, f.id) }] : []
  })
}

// A slot bought: its price paid, the relic owned, the slot empty until the next battle won refills it (restock).
function buy (run, { index }) {
  const s = run.state
  const id = s.shop[index]
  if (!id) throw new Error(`no relic in slot ${index}`)
  if (!canBuy(run, index)) throw new Error('not enough essence')
  pay(run, relicPrice(run, id))
  takeRelic(s, id)
  s.shop[index] = null
}

// ── the altar ────────────────────────────────────────────────────────────────────────────────────

// An altar asks one rite of three, and the room ends with it: the Monarch's heal, transmute or consecrate.

// The kinds an altar offers to make a soul of `kind`: TUNING.run.altarOffer of the floor's pool of its tier, never its
// own, drawn on the altar's and the kind's stream; none for a kind no foe brings (a fused kind).
export function transmuteOffer (s, kind) {
  const d = unitDef(kind)
  if (!d.spawn) return []
  const pool = spawnPool(poolFloor(s.floor)).units.filter((u) => u.tier === d.tier && u.id !== kind).map((u) => u.id)
  return createRng(s.seed).stream(`altar|${s.floor}|${s.at}|${kind}`).shuffle(pool).slice(0, TUNING.run.altarOffer)
}
// Whether soul `u` may be transmuted now: a standing soul, never the Monarch, of a kind the altar offers others for.
export const canTransmute = (s, u) => !!u && !isMonarch(u) && s.party.includes(u) && u.hp > 0 && transmuteOffer(s, u.id).length > 0

// Every rite the altar takes now: the heal, each soul's transmutations, each soul's next tiers (free).
export function altarActions (run) {
  const s = run.state
  const out = [{ type: 'heal' }]
  for (const u of souls(s.party)) if (canTransmute(s, u)) out.push(...transmuteOffer(s, u.id).map((_, index) => ({ type: 'transmute', uid: u.uid, index })))
  for (const u of souls(s.party)) for (const track of [0, 1]) if (canAdvance(s, u, track)) out.push({ type: 'consecrate', uid: u.uid, track })
  return out
}

// The heal: the Monarch to TUNING.run.altarHeal of its max HP; the souls are whole already.
function heal (run) {
  const s = run.state
  const m = monarchOf(s)
  m.hp = Math.max(m.hp, Math.round(m.maxHp * TUNING.run.altarHeal))
  nextRoom(run)
}

// A transmutation: soul `uid` becomes the kind its offer `index` names, its uid, relics, HP share and cell (where it
// fits) kept, and its tiers too, each on its new kind's track of the same number, so its level stands.
function transmute (run, { uid, index }) {
  const s = run.state
  const u = s.party.find((x) => x.uid === uid)
  const into = canTransmute(s, u) && Number.isInteger(index) ? transmuteOffer(s, u.id)[index] : undefined
  if (!into) throw new Error(`cannot transmute ${uid} into offer ${index}`)
  const v = makeUnit(into, { uid: u.uid, lvl: u.lvl, tracks: u.tracks, slot: u.slot })
  v.hp = Math.max(1, Math.round(v.maxHp * u.hp / u.maxHp))
  if (u.relics) v.relics = u.relics.slice()
  if (u.free) v.free = u.free.slice()
  s.party[s.party.indexOf(u)] = v
  if (onField(v) && !fits(s.camp, v.slot, sizeOf(v), takenBy(s, [v]))) v.slot = OSSUARY
  nextRoom(run)
}

// A consecration: soul `uid` takes its next tier on `track` free, as buying it would (marked free: it pays nothing back).
function consecrate (run, { uid, track }) {
  const u = run.state.party.find((x) => x.uid === uid)
  if (!canAdvance(run.state, u, track)) throw new Error(`cannot consecrate ${uid} on track ${track}`)
  markFree(u, track, u.tracks[track])
  advance(run.state, u, track)
  nextRoom(run)
}

// ── internals ────────────────────────────────────────────────────────────────────────────────────

// A floor entered: its map and its camp; the Monarch takes its seat and the fielded pieces the new camp's frontier (a
// camp drawn again keeps their cells), and the floor's shelf is stocked. Its rooms wait for the floor to open.
function enterFloor (run) {
  const s = run.state
  const was = s.camp
  s.map = generateFloor({ seed: s.seed, floor: s.floor, boss: bossPool(s.floor).length > 0 })
  s.camp = createRng(s.seed).stream(`camp|${s.floor}`).pick(CAMP_LIST.filter((c) => c.floor === poolFloor(s.floor))).id
  monarchOf(s).slot = monarchSlot(s.camp)
  if (s.camp !== was) setFrontier(s, fielded(souls(s.party)))
  s.at = s.map.start
  s.phase = 'map'
  s.shop = stockShop(s)
}

// A floor opens on the army as it stands: its boss chosen (bossFor), every battle room's foes fixed now so the map can
// show them (drawRoom; a boss room's `lean`), the routes varied and an elite drawn again to answer the army.
function openFloor (run) {
  const s = run.state
  const army = souls(s.party).filter((u) => u.hp > 0)
  const boss = bossFor(s.seed, s.floor, army)
  for (const n of s.map.nodes) {
    if (!BATTLE_NODES.includes(n.type)) continue
    Object.assign(n, drawRoom(s.seed, s.floor, n, { ascension: s.ascension, boss: boss?.id }))
    if (n.type === 'boss') n.lean = boss.lean
  }
  varyRoutes(s)
  answerArmy(s, army)
}

function nextRoom (run) {
  const s = run.state
  s.phase = 'map'
  if (s.at !== s.map.end) return
  // The tutorial's one room is all of it.
  if (s.tutorial) { s.phase = 'over'; return }
  s.stats.floorsCleared++
  s.floor++
  enterFloor(run)
  openFloor(run)
}

// What createBattle needs in the current room, with copies of the fielded souls (`party` overrides them, for a
// rehearsal); it leaves the run untouched. The run relics' unit mods go as `partyMods`, the floor's and level's as
// `foeMods`, a wave spacing not the base's as `every`; the foes take the next free uids, then the shadows.
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
    // The camp's walls and the room's own (spawn.js roomGround): none of them on a tile anyone starts on.
    walls: [...wallTiles(s.camp), ...(node.walls ?? [])],
    partyMods: s.relics.filter(isRunRelic).flatMap((id) => (relicDef(id).mods ?? []).filter((m) => !isRunPath(m.path))),
    foeMods: foeMods(s.floor, boss, foeScale(s)),
    ...(every !== TUNING.spawn.waves.every && { every }),
    arise: ariseOf(s),
    nextUid: s.nextUid + foes.length,
    relics: s.relics.slice(),
    ...(s.ablate && { ablate: s.ablate.slice() })
  }
}

function finishBattle (run) {
  const b = run.battle
  const s = run.state
  const byUid = new Map(b.units.map((u) => [u.uid, u]))
  // A piece carries the share of its HP it ended with: a win makes a soul whole again below, a loss ends the run.
  for (const u of s.party) {
    const bu = byUid.get(u.uid)
    if (!bu) continue
    u.hp = bu.hp > 0 ? Math.min(u.maxHp, Math.max(1, Math.round(bu.hp / bu.maxHp * u.maxHp))) : 0
  }
  // Shadows and summons are the battle's alone.
  s.stats.fights++
  if (b.winner !== 'party') {
    s.phase = 'over'
    // A fall in the deep, past the Sovereign, leaves the clear standing.
    if (s.result !== 'victory') s.result = 'defeat'
    // The Monarch's fall loses a battle in play (its killer told), and so does an overrun, nothing of yours but the
    // Monarch standing (no one's blow); the autoplayer's may also end as a stall.
    s.death = b.reason === 'monarch' ? { ...b.death, reason: 'monarch' } : { by: null, reason: b.reason, threat: null }
    return
  }
  s.stats.wins++
  // A won elite or boss pays its bounty, relics `essence.gain` on all.
  const node = currentNode(run)
  const earned = Math.round((battleEssence(b) + bountyOf(s, node)) * runStat(s, 'essence.gain', 1))
  s.essence += earned
  s.stats.essence += earned
  // Every soul whole again at TUNING.run.postBattleHeal of its max HP, the fallen standing in their cells: no wound and
  // no fall of a soul carries from one battle to the next. The Monarch keeps the HP it ended with: its HP is the run's.
  for (const u of souls(s.party)) u.hp = Math.max(u.hp, Math.min(u.maxHp, Math.ceil(u.maxHp * TUNING.run.postBattleHeal)))
  if (clearsRun(s, node)) {
    s.stats.floorsCleared++
    s.phase = 'over'
    s.result = 'victory'
    return
  }
  s.offers = soulOffers(run, b)
  restock(s)
  s.phase = 'reap'
}
