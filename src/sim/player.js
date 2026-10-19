// The autoplayer's players out of battle, for tests and balance runs: a policy that picks one action at a time for
// apply(). Basic plays by rules of thumb; the expert reads the run once a decision (survey), lets the tree of hard rules
// (expert.js TREES) force or filter its options and the weights score the rest, and never plays ahead to decide.
import fs from 'node:fs'
import { createRng } from './rng.js'
import {
  statsOf, tracksOf, tiersOf, nextTracks, CENTRE_OUT, CAMP_SLOTS, CAMP_ROWS, campOpen, wallTiles, steps, deployTile,
  tileAt, tileX, tileY, TILES, LANES, rowOf, colOf, distance, makeUnit, slotAt, baseStats, summonsOf, summonedOf, DEPTH,
  sizeOf, footprintSlots, fits, monarchSlot, abilitiesOf, isBlow, isAllyShape, blowReach, armOf, heldMods, isRunPath,
  cellsOf, meleeOnly, auraOf, activeSynergies, rangeOf, ROWS, reachOf, withSummons, synergyCounts, synergyWeight
} from './unit.js'
import { roadsTo } from './field.js'
import { createBattle, legalOrders, stalled } from './turns.js'
import { expertTurn, basicTurn, brief, situation } from './policy.js'
import {
  outForestModel, outDecides, chooseOut, opensBoard, zeros, put, SIT_KEYS, CAND_KEYS, FIELD_KEYS, OUT_THREATS,
  OUT_ROLES, OUT_ROOMS, PREP_SIT_KEYS, PREP_CAND_KEYS, FORMATION_KEYS, OPENING_KEYS, OPENING_ROOM_KEYS
} from './outforest.js'
import { deployment } from './plan.js'
import {
  value, decide, standing as keysOf, outranks, TREES, leafOf, checkModel, pathName, conditions, shippedPart
} from './expert.js'
import { grantsArise, bleeds, ariseGrants } from './rules.js'
import {
  createRun, apply, availableNodes, fieldCap, rosterCap, fielded, inOssuary, currentNode, battleSetup, tierCost,
  foeMods, roomThreats, unkeyed, isMonarch, monarchOf, souls, canAdvance, unhealed, soulCount, canPlace, canFuse,
  fuseParts, fuseCost, OSSUARY, START_PARTY, relicTier, levelOf, monarchHp, ariseOf, commandOf, canBuy,
  relicPrice, isRunRelic, unheld, canHold, foeEssence, eliteBonus, floorPrice, runStat, spawnPool, altarActions,
  transmuteOffer, foeScale, ANSWERS, tends, BASE_MONARCH, copyRun, copyPlain
} from './run.js'
import { nodeOf, RANKS } from './map.js'
import { TUNING } from '../tuning.js'
import {
  unitDef, abilityDef, relicDef, fusionDef, FUSION_LIST, UNIT_LIST, SYNERGIES, RELIC_LIST, STATUS_WORTH, MONARCHS
} from '../content.js'

// A level's switches: `search` hill-climb steps from the best draft (0: basic's first draft); `wounds` souls fielded by
// worth with wounds counted; `route` rooms chosen by their features (else weighted draws); `spend` the growth search
// (else rules of thumb); `fuse` fusions weighed (else never); `book` play toward the combo book's best reachable combo;
// `more` the expert's zone drafts too; `turns` its turn policy in battle (TURNS).
export const LEVELS = {
  basic: { search: 0, wounds: false, route: false, spend: false, fuse: false, turns: 'basic' },
  expert: { search: 120, wounds: true, route: true, spend: true, fuse: true, more: true, book: true, turns: 'expert' }
}
// The turn policies by name; `still` is the expert's that never moves a piece (the moves ablation's).
export const TURNS = {
  basic: basicTurn,
  expert: (b, o) => expertTurn(b, o),
  still: (b, o) => expertTurn(b, { ...o, moving: false })
}
export const turnsOf = (L) => ablatedTurns(L.turns ?? 'basic', L.ablate)
export const ablatedTurns = (turns, m) => (m === 'orders' ? 'basic' : turns !== 'expert' ? turns : m === 'moves' ? 'still' : turns)

// ── ablation: the expert with one mechanic taken away ─────────────────────────────────────────────

// A level's `ablate` takes one mechanic from the expert and nothing else; its essence goes where its spending sends it:
//   orders         every turn ended without an order
//   fusions        never fuses
//   summons        no tier brings a summon, nor is one counted in its worth (a rules switch)
//   tracks         never buys a track tier
//   legendaries    never buys a Legendary relic (Arise among them)
//   relics         never buys a Common, Uncommon or Rare relic
//   synergies      no synergy's rule in battle (a rules switch)
//   formation      its souls in basic's first draft's cells
//   moves          its pieces never move in battle (TURNS still)
// A run under a rules switch is made with it (ablatedRun). 'arise' is a rules switch but no ablation.
export const ABLATIONS = ['orders', 'combos', 'fusions', 'summons', 'tracks', 'legendaries', 'relics', 'synergies', 'formation', 'moves']
export const RULE_SWITCHES = ['arise', 'synergies', 'summons', 'combos']
// A run for a level under `ablate` (its rules switch where it is one), from `start` where given, else the draft.
export const ablatedRun = (seed, ablate = null, start = null, { scale = 1, ascension = 0, monarch = BASE_MONARCH } = {}) => createRun({ seed, ablate: RULE_SWITCHES.includes(ablate) ? [ablate] : null, start, scale, ascension, monarch })
// A job's Monarch where it is not the base one: spread into its spec (asMonarch), named in a header (monarchText).
export const asMonarch = (monarch) => (monarch && monarch !== BASE_MONARCH ? { monarch } : {})
export const monarchText = (monarch) => (monarch && monarch !== BASE_MONARCH ? `, as ${MONARCHS[monarch].name.replace(/^The /, 'the ')}` : '')
export function monarchArg (spec = BASE_MONARCH) {
  if (!Object.hasOwn(MONARCHS, spec)) throw new Error(`--monarch "${spec}": one of ${Object.keys(MONARCHS).join(', ')}`)
  return spec
}
export const legendary = (id) => relicTier(id) === 'legendary'
const BANNED = {
  legendaries: legendary,
  relics: (id) => !legendary(id)
}
const banned = (L, id) => !!BANNED[L.ablate]?.(id)

// A formation as L may field it: under the formation ablation, basic's first draft's cells.
const allowed = (run, party, L) => (L.ablate === 'formation' ? basicCells(run, party, L) : party)

// Basic's first draft's cells for these units: the Monarch on its seat, the souls by role row from the middle lane.
export function basicCells (run, party, L) {
  const s = run.state
  const cols = blasts(currentNode(run).foes) ? SPREAD : CENTRE_OUT
  const placed = byRows(party.filter((u) => !isMonarch(u) && u.hp > 0).sort(L.wounds ? byFieldPower : byPower).map((u) => ({ ...u, slot: -1 })), cols, s.camp, seated(s.camp))
  const at = new Map(placed.map((u) => [u.uid, u.slot]))
  return party.map((u) => ({ ...u, slot: isMonarch(u) ? monarchSlot(s.camp) : at.get(u.uid) ?? -1 }))
}

export const hpPct = (u) => u.hp / u.maxHp
const partyHealth = (party) => party.reduce((n, u) => n + hpPct(u), 0) / party.length
const byPower = (a, b) => worth(b) - worth(a) || a.uid - b.uid
// An expert counts wounds: a soul at 10% HP is not worth fielding at full price.
export const byFieldPower = (a, b) => fieldPower(b) - fieldPower(a) || a.uid - b.uid

// A soul's rough fighting worth: how long it lasts times how hard it hits, and its tiers' summons (unless `summons`).
function worth (u, summons = true, mods = heldMods(u), h = TUNING.expert.growth.worth.hits, w = TUNING.expert.growth.worth) {
  if (u.hp <= 0 || isMonarch(u)) return 0
  const s = statsOf(u, mods)
  const lasts = s.hp * (1 + s.def / 100) / s.damage.taken
  const hits = s.atk * s.damage.dealt * (1 + w.move * s.move) + w.mend * mendOut(u, s)
  const signature = tiersOf(u).filter((t) => t.ability || t.aura || t.size).length
  const own = lasts ** (1 - h) * hits ** h * (1 + w.signature * signature) * (1 + w.relic * (u.relics?.length ?? 0))
  const n = summons ? summonsOf(u) : 0
  const kind = summonedOf(u)
  if (!n || kind === u.id) return own * (1 + n * Math.sqrt(TUNING.summon.hp))
  return own + n * Math.sqrt(TUNING.summon.hp) * worth({ ...u, id: kind }, false, mods, h, w)
}
const fieldPower = (u) => worth(u) * Math.sqrt(hpPct(u))
// What a soul mends a turn: its best heal of others (a heal's power, a ward's STATUS_WORTH), at its ATK.
const mendOut = (u, s) => Math.max(0, ...kitOf(u).filter((a) => isAllyShape(a.shape) && a.effects.some((e) => e.op === 'heal' && !e.self))
  .map((a) => a.effects.reduce((n, e) => n + (e.op === 'heal' && !e.self ? e.power : e.op === 'apply_status' ? STATUS_WORTH[e.status] ?? 0 : 0), 0))) *
  s.atk / TUNING.damage.atkDivisor * s.heal.given

const fork = copyRun

// What a retinue brings to its next fight: its best souls' wounded worth, its Arise holders' shadows, its run relics.
function strength (s, summons = true) {
  const read = relicReads(s)
  const best = souls(s.party).map((u) => ({ u, p: read(u, (mods) => worth(u, summons, mods)) * Math.sqrt(hpPct(u)) })).sort((a, b) => b.p - a.p).slice(0, fieldCap({ state: s }))
  const raised = TUNING.expert.growth.raise.share * ariseWorth(s, best.filter((x) => x.p > 0).map((x) => x.u))
  return (best.reduce((n, x) => n + x.p, 0) + raised) * (1 + TUNING.expert.growth.worth.relic * s.relics.filter((id) => isRunRelic(id) && !isBanner(id)).length) || 1
}

// ── the relics a soul fights with, read ───────────────────────────────────────────────────────────

// The run relics' mods scoped to a kin or a role (a kin banner's), as statsOf reads `who` in battle.
const scopedMods = (s) => s.relics.filter(isRunRelic).flatMap((id) => (relicDef(id).mods ?? []).filter((m) => m.who && !isRunPath(m.path)))
// Whether run relic `id` is a kin banner: every mod of it scoped to a kin or a role.
const isBanner = (id) => !!relicDef(id).mods?.length && relicDef(id).mods.every((m) => m.who)
// The relics at work, read: → (u, of) → `of(mods)` on its relics' and the banners' mods, a share more per trigger.
function relicReads (s) {
  const banners = scopedMods(s)
  return (u, of) => {
    const mods = banners.length ? [...heldMods(u), ...banners] : heldMods(u)
    const st = banners.length ? statsOf(u, mods) : null
    const sooner = st ? Math.max(0, st.cooldown.rate - 1) * STATUS_WORTH.hasten * paid('status') * MOMENTS.blow / st.hp : 0
    return of(mods) * (1 + sooner + (u.relics ?? []).reduce((n, id) => n + (relicDef(id).on ? triggerShare(s, u, relicDef(id)) : 0), 0))
  }
}
// How often a battle a fielded piece meets each trigger's moment; `move` is a guess.
const MOMENTS = { blow: 3.2, kill: 2.4, struck: 0.8, wave: 1.4, fall: 0.01, move: 2 }
// The stacks of a status a `per` damage finds a blow, a flat guess.
const PER_STACKS = 1.5
// The tiles a `per: { moved }` damage reads a blow, and the share of blows a `per: { walked }` finds a foe that walked:
// flat guesses.
const PER_TILES = 2
const PER_WALKED = 0.5
// The share of its moments a trigger's `when` holds, a flat guess.
const WHEN_SHARE = 0.5
// How many of yours (allies) or theirs (foes) an effect about a place touches.
const AROUND = { allies: 3.4, foes: 1.7 }
// What the battle's weights pay for one of each (a status, an HP mended, a shadow's max HP), in HP of damage.
const paid = (what) => TUNING.expert.battle.option[what] / TUNING.expert.battle.option.damage
// What piece relic `r`'s trigger brings holder `u` a battle, a share of its max HP: its effects' worth × AROUND × MOMENTS.
function triggerShare (s, u, r) {
  const st = statsOf(u, heldMods(u))
  const hit = (power) => power * st.atk / TUNING.damage.atkDivisor
  let hp = 0
  for (const e of r.effects) {
    const each = e.op === 'apply_status' ? (STATUS_WORTH[e.status] ?? 0) * paid('status')
      : e.op === 'heal' ? (e.pct ? e.pct * st.hp : hit(e.power) * st.heal.given) * paid('mend')
        : e.op === 'damage' ? (e.per ? e.amount * perTimes(e.per) : e.amount ?? hit(e.power))
          : e.op === 'cooldown' ? Math.max(0, -e.amount) * STATUS_WORTH.hasten * paid('status')
            : e.op === 'raise' ? raiseHp(s.floor, e.tier ?? TUNING.arise.tier, u.lvl) * paid('shadow') : 0
    hp += each * (AROUND[e.to] ?? 1)
  }
  return hp * (MOMENTS[r.on] ?? 0) * (r.when ? WHEN_SHARE : 1) / st.hp
}
const perTimes = (per) => (per.moved ? PER_TILES : per.walked ? PER_WALKED : PER_STACKS)
// The mean max HP of the shadow a slain foe of `floor`'s draws yields a raise to `tier` at level `lvl` (none above it).
const raises = new Map()
function raiseHp (floor, tier, lvl) {
  const key = `${floor}|${tier}|${lvl}`
  if (!raises.has(key)) {
    const pool = spawnPool(floor)
    const all = pool.weights.reduce((n, w) => n + w, 0)
    raises.set(key, pool.units.reduce((n, d, i) => n + (d.tier <= tier ? pool.weights[i] * baseStats(d.id, lvl).hp : 0), 0) / all)
  }
  return raises.get(key)
}

// ── Arise's worth, read from the roads ────────────────────────────────────────────────────────────

// Arise as soul `u` holds it, its rules' additions counted: { domain, tier, count }; null for none or under 'arise'.
function ariseIn (s, u) {
  const grants = ariseGrants(u)
  if (!grants.length || s.ablate?.includes('arise')) return null
  const a = ariseOf(s)
  const sum = (k) => grants.reduce((n, r) => n + (r.params[k] ?? 0), 0)
  return { domain: a.domain + sum('domain'), tier: a.tier + sum('tier'), count: Math.max(1, ...grants.map((r) => r.params.count ?? 1)) }
}

// The share of a foe's road within `domain` tiles of `tiles`, a tile weighed (1 + its distance to the seat)^−1.
function fallShare (road, tiles, domain) {
  let all = 0
  let near = 0
  for (let i = 0; i < road.length - 1; i++) {
    const w = 1 / (road.length - i)
    all += w
    if (tiles.some((x) => distance(road[i], x) <= domain)) near += w
  }
  return all ? near / all : 0
}

// The worth the Arise holders among `pieces` would raise a battle, over the floor's rooms ahead, capped by their raises.
function ariseWorth (s, pieces) {
  const holders = []
  for (const u of pieces) {
    const a = ariseIn(s, u)
    if (a) holders.push({ ...a, tiles: u.slot >= 0 ? tilesAt(u, u.slot) : [deployTile('party', monarchSlot(s.camp))] })
  }
  if (!holders.length || !s.map) return 0
  const rank = nodeOf(s.map, s.at)?.rank ?? 0
  const rooms = s.map.nodes.filter((n) => n.foes && n.rank >= rank)
  if (!rooms.length) return 0
  const cap = holders.reduce((n, h) => n + h.count, 0) * TUNING.expert.growth.raise.turns
  let total = 0
  for (const n of rooms) {
    let shadows = 0
    let worthOf = 0
    for (const f of scoutAt(s, n)) {
      if (f.boss) continue
      const p = Math.max(0, ...holders.filter((h) => f.tier <= h.tier).map((h) => fallShare(f.road, h.tiles, h.domain)))
      if (!p) continue
      shadows += p
      worthOf += p * shadowWorth(f.id, f.lvl)
    }
    total += shadows > cap ? worthOf * cap / shadows : worthOf
  }
  return total / rooms.length
}
const shadowWorths = new Map()
function shadowWorth (id, lvl) {
  const key = `${id}|${lvl}`
  if (!shadowWorths.has(key)) shadowWorths.set(key, worth(makeUnit(id, { lvl })))
  return shadowWorths.get(key)
}

// ── the survey: what the expert reads of the run ──────────────────────────────────────────────────

// What the expert reads of the run before a decision out of battle, as a player is shown it; no battle played:
//   floor, rank, phase         where the run stands
//   purse, prices              its essence; the cheapest next `tier`, `recruit` and `relic` (null for none)
//   health, fallen, monarch    the souls' HP share, the fallen, the Monarch's HP share; `unhealed`: nothing heals it
//   strength                   the field's (strength)
//   command, fielded, waiting  the field cap, the standing souls fielded and in the ossuary
//   target                     the combo it plays toward: { id, progress, missing kinds }, null for none
//   relics                     `unheld` piece relics, `free` souls with room to hold one
//   rooms                      each room open next: { id, type, threat, threats, unanswered, want, ahead: { shop
//                              (always null), altar: rooms on to the nearest } }
export function survey (run, L = LEVELS.expert) {
  const s = run.state
  const all = souls(s.party)
  const up = standing(all)
  const target = L.book ? targetOf(s) : null
  const keeps = targetKinds(target)
  const common = RELIC_LIST.find((r) => r.tier === 'common')
  const tiers = all.flatMap((u) => [0, 1].filter((t) => canAdvance(s, u, t)).map((t) => tierCost(run, u, t)))
  const m = monarchOf(s)
  return {
    floor: s.floor,
    rank: currentNode(run)?.rank ?? 0,
    phase: s.phase,
    purse: s.essence,
    prices: {
      tier: tiers.length ? Math.min(...tiers) : null,
      recruit: s.offers?.length ? Math.min(...s.offers.map((o) => o.cost)) : null,
      relic: common ? relicPrice(run, common.id) : null
    },
    health: all.reduce((n, u) => n + Math.max(0, u.hp), 0) / Math.max(1, all.reduce((n, u) => n + u.maxHp, 0)),
    fallen: all.length - up.length,
    monarch: m.hp / m.maxHp,
    unhealed: unhealed(s),
    strength: strength(s, L.ablate !== 'summons'),
    command: fieldCap(run),
    fielded: fielded(up).length,
    waiting: inOssuary(up).length,
    target: target && { id: target.id, progress: comboProgress(s, target), missing: Object.entries(target.needs).filter(([id, n]) => up.filter((u) => u.id === id).length < n).map(([id]) => id) },
    relics: { unheld: unheld(s).filter((id) => !isRunRelic(id)), free: up.filter((u) => (u.relics?.length ?? 0) < TUNING.relic.perPiece).length },
    rooms: s.phase === 'map' ? availableNodes(run).map((n) => scoutRoom(run, n, up, keeps)) : []
  }
}

function scoutRoom (run, n, up, keeps) {
  const s = run.state
  const foes = [...(n.foes ?? []), ...(n.waves ?? []).flatMap((w) => w.foes)]
  const mods = foeMods(s.floor, n.type === 'boss', foeScale(s))
  const threats = n.foes ? [...roomThreats(n)] : []
  return {
    id: n.id,
    type: n.type,
    threat: foes.reduce((t, f) => t + worth(makeUnit(f.id, { lvl: f.lvl }), false, mods), 0),
    threats,
    unanswered: [...threats.filter((t) => ANSWERS[t] && !up.some(ANSWERS[t])), ...unkeyed(n, up).map((x) => `lock:${x.id}`)],
    want: foes.filter((f) => keeps.has(f.id)).length,
    ahead: { shop: null, altar: roomsTo(s.map, n.id, 'altar') }
  }
}

// A soul's abilities, as their definitions.
const kitOf = (u) => abilitiesOf(u).map(abilityDef)

// How many rooms on from `from` the nearest room of `type` lies (1: the next), null for none on the floor.
function roomsTo (map, from, type) {
  const seen = new Set([from])
  let edge = [from]
  for (let d = 1; edge.length; d++) {
    const next = []
    for (const id of edge) {
      for (const n of nodeOf(map, id).next) {
        if (seen.has(n)) continue
        if (nodeOf(map, n).type === type) return d
        seen.add(n)
        next.push(n)
      }
    }
    edge = next
  }
  return null
}

// ── map: the route ───────────────────────────────────────────────────────────────────────────────

function pickNode (run, rng, L, sit) {
  const shop = pickShop(run, L, sit)
  if (shop) return shop
  const spend = pickSpend(run, L, sit)
  if (spend) return spend
  const nodes = availableNodes(run)
  if (L.route && nodes.length > 1) return { type: 'node', id: pickRoute(run, sit) }
  const health = partyHealth(run.state.party)
  const w = { fight: 3, elite: health > 0.7 ? 1.5 : 0.3, altar: health < 0.6 ? 5 : 0.5, boss: 1, siege: health > 0.7 ? 1.5 : 0.3 }
  return { type: 'node', id: rng.weighted(nodes, nodes.map((n) => w[n.type])).id }
}

// The expert's next room: the open rooms' features (roomFeatures) by TREES.route then the weights, or the learned route.
export function pickRoute (run, sit = survey(run)) {
  const model = routeModel()
  if (model) {
    const pick = learnedRoute(model, run, sit)
    noteRule(run, 'route', pick, surveyLine(sit))
    return pick.option.node.id
  }
  const rooms = sit.rooms.map((room) => ({ node: nodeOf(run.state.map, room.id), v: roomFeatures(sit, room) }))
  const pick = decide(TREES.route, sit, rooms, TUNING.expert.route)
  noteRule(run, 'route', pick, surveyLine(sit))
  return pick.option.node.id
}

// ── the learned route ─────────────────────────────────────────────────────────────────────────────

// The route's model tree (expert.json's `route`): splits on the run's situation (routeConditions), each leaf its weights
// over a room's features (routeFeatures); TREES.route's rules first only where it keeps them (`hand`).
export const ROUTE_LEARNED = true
let ROUTE_MODEL
export const shippedRoute = () => shippedPart('route')
export function routeModel () {
  if (ROUTE_MODEL !== undefined) return ROUTE_MODEL
  ROUTE_MODEL = null
  if (!ROUTE_LEARNED) return null
  const json = shippedRoute()
  ROUTE_MODEL = json ? checkModel(json) : null
  return ROUTE_MODEL
}
// Installs route `model` (false: the hand-built route; undefined: back to the shipped one). → the one in use
export function useRoute (model) {
  ROUTE_MODEL = model === undefined ? undefined : model ? checkModel(model) : null
  return routeModel()
}

// One room choice by route `model`: its leaf's weights over each room's features (0 where none). → { option, by, path }
export function learnedRoute (model, run, sit = survey(run)) {
  const r = leafOf(model, routeConditions(run, sit))
  const w = Object.fromEntries(ROUTE_FEATURES.map((k) => [k, r.w[k] ?? 0]))
  const rooms = sit.rooms.map((room) => ({ node: nodeOf(run.state.map, room.id), v: routeFeatures(run, sit, room) }))
  const pick = decide(model.hand ? TREES.route : [], sit, rooms, w)
  return { option: pick.option, by: pick.by === 'weights' ? `route ${r.leaf.leaf}` : pick.by, path: pathName(r) }
}

// The mean essence a tier costs on `floor`: the unit the route reads a purse and a room's pay in.
export const tierScale = (floor) => TUNING.essence.tier.reduce((n, x) => n + x, 0) / TUNING.essence.tier.length * floorPrice(floor)
const THREAT_TYPES = ['reach', 'shape', 'drain', 'sustain', 'fly', 'burn', 'bleed', 'depth']

// The run's situation a room choice is read in (the route tree's conditions; add, never rename):
//   floor, rank                      where the run stands
//   strength                         the army's, as a log
//   souls, fielded, waiting, fallen  the souls standing, fielded, in the ossuary; the fallen
//   command, health                  the field cap; the souls' HP share
//   monarch, monarch.hp, unhealed    the Monarch's HP share, its HP, whether nothing may heal it
//   purse, purse.relic               the essence in tier prices, and in the floor's cheapest relic's
//   relics, progress                 the relics owned; how far along its target combo
//   rooms, open.*                    the rooms open; an elite or an altar among them (open.shop always 0)
//   odds.elite, odds.min, odds.max   the army's log odds against the elite open, the worst and the best battle room
export function routeConditions (run, sit = survey(run)) {
  const s = run.state
  const m = monarchOf(s)
  const odds = sit.rooms.filter((r) => r.threat > 0 && r.type !== 'altar').map((r) => ({ type: r.type, odds: Math.log(sit.strength / r.threat) }))
  const elite = odds.find((x) => x.type === 'elite')
  return {
    floor: sit.floor,
    rank: sit.rank,
    strength: Math.log(sit.strength),
    souls: sit.fielded + sit.waiting,
    fielded: sit.fielded,
    waiting: sit.waiting,
    fallen: sit.fallen,
    command: sit.command,
    health: sit.health,
    monarch: sit.monarch,
    'monarch.hp': Math.max(0, m.hp),
    unhealed: sit.unhealed ? 1 : 0,
    purse: sit.purse / tierScale(sit.floor),
    'purse.relic': sit.prices.relic ? sit.purse / sit.prices.relic : 0,
    relics: s.relics.length,
    progress: sit.target?.progress ?? 0,
    rooms: sit.rooms.length,
    'open.elite': sit.rooms.some((r) => r.type === 'elite') ? 1 : 0,
    'open.altar': sit.rooms.some((r) => r.type === 'altar') ? 1 : 0,
    'open.shop': 0,
    'odds.elite': elite ? elite.odds : 0,
    'odds.min': odds.length ? Math.min(...odds.map((x) => x.odds)) : 0,
    'odds.max': odds.length ? Math.max(...odds.map((x) => x.odds)) : 0
  }
}

// A room read for the learned route: roomFeatures', and for a battle room besides:
//   foes, tier, tierMean, lvl  its foes: how many, the highest tier and the mean, the mean level
//   waves, late                its waves after the first; a floor-1 elite's late pair
//   t.<type>                   each threat type it carries
//   pay                        its foes' essence and an elite's bonus, in tier prices
//   long                       odds below TUNING.expert.tree.odds
//   hurt, worn                 the Monarch's and the souls' HP lacking
export const ROUTE_FEATURES = Object.freeze([
  'fight', 'elite', 'shop', 'altar', 'boss', 'siege', 'odds', 'weak', 'wounds', 'monarch', 'purse', 'want', 'unanswered', 'altarAhead', 'monarchAhead',
  'shopAhead', 'foes', 'tier', 'tierMean', 'lvl', 'waves', 'late', ...THREAT_TYPES.map((t) => `t.${t}`), 'pay', 'long', 'hurt', 'worn'
])
export function routeFeatures (run, sit, room) {
  const s = run.state
  const v = roomFeatures(sit, room)
  const out = { ...v, foes: 0, tier: 0, tierMean: 0, lvl: 0, waves: 0, late: 0 }
  for (const t of THREAT_TYPES) out[`t.${t}`] = 0
  Object.assign(out, { pay: 0, long: 0, hurt: 0, worn: 0 })
  const node = nodeOf(s.map, room.id)
  if (!node?.foes) return out
  const foes = [...node.foes, ...(node.waves ?? []).flatMap((w) => w.foes)]
  const tiers = foes.map((f) => unitDef(f.id).tier)
  out.foes = foes.length
  out.tier = Math.max(0, ...tiers)
  out.tierMean = tiers.length ? tiers.reduce((n, x) => n + x, 0) / tiers.length : 0
  out.lvl = foes.length ? foes.reduce((n, f) => n + f.lvl, 0) / foes.length : 0
  out.waves = node.waves?.length ?? 0
  out.late = node.type === 'elite' && s.floor === 1 && out.waves > 0 ? 1 : 0
  for (const t of room.threats) if (THREAT_TYPES.includes(t)) out[`t.${t}`] = 1
  const pay = foes.reduce((n, f) => n + foeEssence(f), 0) + (node.type === 'elite' ? eliteBonus(s.floor) : 0)
  out.pay = pay * runStat(s, 'essence.gain', 1) / tierScale(s.floor)
  const battle = room.threat > 0 && room.type !== 'altar'
  out.long = battle && v.odds < TUNING.expert.tree.odds ? 1 : 0
  out.hurt = battle ? 1 - sit.monarch : 0
  out.worn = battle ? 1 - sit.health : 0
  return out
}

// A room read as the features the hand-built route weighs (TUNING.expert.route):
//   fight … siege              its type, one of six
//   odds, weak                 the log of the army's strength over its threat; how far the room is the stronger
//   want, unanswered           its foes of the target's kinds; its threat types the army has no answer to
//   wounds, monarch            for an altar, the souls' wounds and the Monarch's (none while nothing may heal it)
//   altarAhead, monarchAhead   the same for an altar on a route through it, the nearer the more
//   shop, purse, shopAhead     always 0, kept for the fitted models' columns
export function roomFeatures (sit, room) {
  const fights = room.threat > 0 && room.type !== 'altar'
  const odds = fights ? Math.log(sit.strength / room.threat) : 0
  const v = { fight: 0, elite: 0, shop: 0, altar: 0, boss: 0, siege: 0 }
  v[room.type] = 1
  return {
    ...v,
    odds,
    weak: Math.max(0, -odds),
    wounds: room.type === 'altar' ? 1 - sit.health : 0,
    monarch: room.type === 'altar' && !sit.unhealed ? 1 - sit.monarch : 0,
    purse: 0,
    want: room.want,
    unanswered: room.unanswered.length,
    altarAhead: room.ahead.altar === null ? 0 : (1 - sit.health) / (1 + room.ahead.altar),
    monarchAhead: room.ahead.altar === null || sit.unhealed ? 0 : (1 - sit.monarch) / (1 + room.ahead.altar),
    shopAhead: 0
  }
}

// ── prep: the formation ──────────────────────────────────────────────────────────────────────────────

// Basic fields its first draft (each role's row from the middle lane, every other lane first against blasts); the expert
// drafts more and hill-climbs from the best on formationFeatures. A piece that fits nowhere waits in the ossuary (slot −1).

const SPREAD = [3, 1, 5, 2, 4, 0, 6]
const blasts = (foes) => foes.some((f) => unitDef(f.id).abilities.some((id) => abilityDef(id).shape === 'blast'))
// Each role's row in a drafted formation (0 the camp's front): the vanguard ahead, the ranged behind.
const ROW = { vanguard: 0, skirmisher: 1, warden: 1, trickster: 1, ranger: 2, channeler: 2 }
const rowFor = (u) => ROW[unitDef(u.id).role] ?? 1

// The cells taken before anything is placed: the Monarch's seat.
const seated = (camp) => new Set([monarchSlot(camp)])
const openCells = (camp) => [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(camp, slot))
// The board tiles a piece anchored on `slot` stands on.
const tilesAt = (u, slot) => (footprintSlots(slot, sizeOf(u)) ?? [slot]).map((c) => deployTile('party', c))

// Whether the run can field a formation: the Monarch on its seat, every other piece where its footprint fits.
function legal (out, camp) {
  const taken = new Set()
  for (const u of out) {
    if (isMonarch(u)) {
      if (u.slot !== monarchSlot(camp)) return false
      continue
    }
    if (u.slot < 0) continue
    if (!fits(camp, u.slot, sizeOf(u), taken)) return false
    for (const c of cellsOf(u)) taken.add(c)
  }
  return true
}

// Places the units not yet fitting on their role's row (the 2×2 first, nearest rows next, `cols` order); mutates them.
function byRows (units, cols, camp, taken) {
  const rest = []
  for (const u of units) {
    if (u.slot >= 0 && fits(camp, u.slot, sizeOf(u), taken)) cellsOf(u).forEach((c) => taken.add(c))
    else rest.push(u)
  }
  const rows = [...Array(CAMP_ROWS).keys()]
  for (const u of rest.slice().sort((a, b) => sizeOf(b) - sizeOf(a))) {
    const pref = rowFor(u)
    u.slot = -1
    for (const row of rows.slice().sort((a, b) => Math.abs(a - pref) - Math.abs(b - pref) || a - b)) {
      const c = cols.find((c) => fits(camp, slotAt(row, c), sizeOf(u), taken))
      if (c === undefined) continue
      u.slot = slotAt(row, c)
      cellsOf(u).forEach((x) => taken.add(x))
      break
    }
  }
  return units
}

// How many steps a foe needs from the open ground above the camp to each camp cell, around its walls.
function walkIn (camp) {
  const walls = new Set(wallTiles(camp))
  const dist = new Array(TILES).fill(Infinity)
  const queue = []
  for (let x = 0; x < LANES; x++) queue.push(tileAt(x, CAMP_ROWS))
  for (const t of queue) dist[t] = 0
  for (let i = 0; i < queue.length; i++) {
    for (const n of steps(queue[i], walls)) {
      if (dist[n] === Infinity) { dist[n] = dist[queue[i]] + 1; queue.push(n) }
    }
  }
  return (slot) => dist[deployTile('party', slot)]
}

// The sheltered draft: the melee first, on the fewest steps in; the ranged on the most steps in for how far forward.
function sheltered (units, camp, taken) {
  const walk = walkIn(camp)
  const open = openCells(camp)
  const lane = (slot) => CENTRE_OUT.indexOf(colOf(slot))
  const order = units.slice().sort((a, b) => meleeOnly(b) - meleeOnly(a) || rowFor(a) - rowFor(b))
  for (const u of order) {
    const off = (slot) => Math.abs(rowOf(slot) - rowFor(u))
    const score = meleeOnly(u) ? (slot) => walk(slot) : (slot) => -(walk(slot) - rowOf(slot) - 1)
    const free = open.filter((slot) => fits(camp, slot, sizeOf(u), taken))
    u.slot = free.sort((a, b) => score(a) - score(b) || off(a) - off(b) || lane(a) - lane(b))[0] ?? -1
    cellsOf(u).forEach((c) => taken.add(c))
  }
  return units
}

// The expert's zone drafts: [radius about the seat, the share of a tile's threat left once a piece covers it (1:
// bunched; less: shared out), how steeply the threat grows toward the seat].
const ZONES = [[2, 1, 1], [Infinity, 0.5, 0.5], [1, 1, 2], [3, 0.5, 1]]

// The formations L drafts for `want`, the Monarch on its seat: the expert's plan's, zone and gated drafts; basic's three.
export function drafts (run, want, L) {
  const s = run.state
  const m = { ...monarchOf(s), slot: monarchSlot(s.camp) }
  const blank = () => want.map((u) => ({ ...u, slot: -1 }))
  const lanes = blasts(currentNode(run).foes) ? [SPREAD, CENTRE_OUT] : [CENTRE_OUT, SPREAD]
  const rows = (cols) => [{ ...m }, ...byRows(blank(), cols, s.camp, seated(s.camp))]
  const basic = [rows(lanes[0]), rows(lanes[1]), [{ ...m }, ...sheltered(blank(), s.camp, seated(s.camp))]]
  if (!L.more) return basic
  const gate = gated(blank(), s.camp, threatOf(run))
  return [
    [{ ...m }, ...planDraft(run, blank(), rows(lanes[0]))],
    ...ZONES.map(([radius, keep, steep]) => [{ ...m }, ...zone(blank(), s.camp, threatOf(run, steep), { radius, keep })]),
    ...(gate ? [[{ ...m }, ...gate]] : []), ...basic
  ]
}

// The plan's draft: each piece on the tile the first turn's plan walks it to (deployment), the rest by zone; mutates them.
function planDraft (run, units, start) {
  const s = run.state
  const setup = battleSetup(run, { party: start.filter((u) => u.slot >= 0) })
  const b = createBattle({ ...setup, ablate: [...(setup.ablate ?? []), 'summons'], quiet: true })
  const within = new Set(openCells(s.camp).filter((c) => c !== monarchSlot(s.camp)).map((c) => deployTile('party', c)))
  const at = b.over ? new Map() : deployment(b, situation(b), within)
  const taken = seated(s.camp)
  for (const u of units) {
    const t = at.get(u.uid)
    if (t === undefined) continue
    const slot = slotAt(CAMP_ROWS - 1 - tileY(t), tileX(t))
    if (!fits(s.camp, slot, sizeOf(u), taken)) continue
    u.slot = slot
    cellsOf(u).forEach((c) => taken.add(c))
  }
  return zone(units, s.camp, threatOf(run), { taken })
}

// The scouted room's foes, made once a room: each of the opening and every wave, its road to the seat, blow and reach.
// → [{ flies, road: [tile, …, the seat], raw, reach, air, hp, id, lvl, tier, boss }]
const scouts = new Map()
const scout = (run) => scoutAt(run.state, currentNode(run))
// The same for any battle room `node` of the run's floor.
function scoutAt (s, node) {
  const key = JSON.stringify([s.camp, s.floor, node.id, node.type, node.foes, node.waves?.map((w) => w.foes), s.scale, s.ascension])
  if (scouts.has(key)) return scouts.get(key)
  const roads = roadsTo(s.camp)
  const mods = foeMods(s.floor, node.type === 'boss', foeScale(s))
  const out = []
  for (const [k, foes] of [node.foes ?? [], ...(node.waves ?? []).map((w) => w.foes)].entries()) {
    for (const f of foes) {
      const u = makeUnit(f.id, { lvl: f.lvl })
      const flies = !!unitDef(f.id).flies
      const blows = kitOf(u).filter(isBlow)
      const far = (list) => Math.min(DEPTH, Math.max(-1, ...list.map((b) => blowReach(u, b))))
      const from = deployTile('foe', k ? slotAt(ROWS - 1, colOf(f.slot)) : f.slot)
      out.push({ flies, road: roadFrom(from, flies ? roads.air : roads.field), raw: punch(u, mods), reach: far(blows), air: far(blows.filter((b) => !b.melee || flies)), hp: statsOf(u, mods).hp,
        id: f.id, lvl: f.lvl, tier: unitDef(f.id).tier, boss: !!unitDef(f.id).boss })
    }
  }
  if (scouts.size > 500) scouts.clear()
  scouts.set(key, out)
  return out
}

// The scouted room as a threat map: each tile of a foe's road but the seat takes (1 + its distance to the seat)^−steep.
// → { ground, air } (a flyer's in the air), each a Float64Array by tile
const threats = new WeakMap()
function threatOf (run, steep = 1) {
  const list = scout(run)
  const made = threats.get(list) ?? new Map()
  threats.set(list, made)
  if (made.has(steep)) return made.get(steep)
  const out = { ground: new Float64Array(TILES), air: new Float64Array(TILES) }
  for (const { road, flies } of list) {
    const to = flies ? out.air : out.ground
    for (let i = 0; i < road.length - 1; i++) to[road[i]] += 1 / (road.length - i) ** steep
  }
  made.set(steep, out)
  return out
}

// A foe's road from `t` to the root, by a field's arrows (a ground foe's the camp's roads, a flyer's the air road).
function roadFrom (t, f) {
  const out = []
  for (let n = 0; t >= 0 && n < TILES; t = f.arrow[t], n++) out.push(t)
  return out
}

// What a piece anchored on `slot` covers, as the danger map counts it: every tile its Move takes it to, and from each
// every tile its blows reach (the air's only by a blow that strikes a flyer). → { ground, air }, kept by '|'-free ids
const covers = new Map()
function coverage (u, slot, camp) {
  const key = `${u.id}|${u.lvl}|${u.tracks}|${u.relics ?? ''}|${slot}|${camp}`
  const had = covers.get(key)
  if (had !== undefined) return had
  const flies = !!unitDef(u.id).flies
  const walls = new Set(flies ? [] : wallTiles(camp))
  const move = Math.max(0, Math.floor(statsOf(u, heldMods(u)).move))
  const from = tilesAt(u, slot)
  const been = new Set(from)
  for (let edge = from, k = 0; k < move && edge.length; k++) {
    edge = edge.flatMap((t) => steps(t, walls)).filter((n) => !been.has(n) && (been.add(n), true))
  }
  const blows = abilitiesOf(u).map(abilityDef).filter(isBlow)
  const far = (list) => Math.min(DEPTH, Math.max(-1, ...list.map((a) => blowReach(u, a))))
  const out = { ground: dilate(been, far(blows)), air: dilate(been, far(blows.filter((a) => !a.melee || flies))) }
  if (covers.size > 50000) covers.clear()
  covers.set(key, out)
  return out
}
// Every tile within `r` of any of `tiles` (none for r < 0).
function dilate (tiles, r) {
  if (r < 0) return []
  const out = new Set()
  for (const t of tiles) {
    const x0 = tileX(t)
    const y0 = tileY(t)
    for (let y = Math.max(0, y0 - r); y <= Math.min(DEPTH - 1, y0 + r); y++) {
      for (let x = Math.max(0, x0 - r); x <= Math.min(LANES - 1, x0 + r); x++) out.add(tileAt(x, y))
    }
  }
  return [...out]
}
// How much of a threat map a coverage takes.
const covered = (c, threat) => c.ground.reduce((n, t) => n + threat.ground[t], 0) + c.air.reduce((n, t) => n + threat.air[t], 0)

// A zone draft: each piece in turn (the 2×2 first) on the free cell within `radius` of the seat (anywhere if none is
// left) whose coverage takes the most threat; each tile it covers then keeps `keep` of it. Mutates and returns units.
function zone (units, camp, threat, { radius = Infinity, keep = 1, taken = seated(camp) } = {}) {
  const seat = deployTile('party', monarchSlot(camp))
  const left = { ground: threat.ground.slice(), air: threat.air.slice() }
  const near = (u, slot) => Math.min(...tilesAt(u, slot).map((t) => distance(t, seat)))
  for (const u of units.slice().sort((a, b) => sizeOf(b) - sizeOf(a))) {
    if (u.slot >= 0) continue
    const free = openCells(camp).filter((slot) => fits(camp, slot, sizeOf(u), taken))
    const inside = free.filter((slot) => near(u, slot) <= radius)
    const scored = (inside.length ? inside : free).map((slot) => ({ slot, n: covered(coverage(u, slot, camp), left), d: near(u, slot) }))
    u.slot = scored.sort((a, b) => b.n - a.n || a.d - b.d || a.slot - b.slot)[0]?.slot ?? -1
    if (u.slot < 0) continue
    cellsOf(u).forEach((c) => taken.add(c))
    if (keep < 1) {
      const c = coverage(u, u.slot, camp)
      for (const t of c.ground) left.ground[t] *= keep
      for (const t of c.air) left.air[t] *= keep
    }
  }
  return units
}

// The camp's gate: the fewest open cells (at most GATE, never the seat, none beside it if that can be had) that every
// ground road crosses, so every ground foe runs into a piece there. Made once per camp. → [slot, …], [] for none
const GATE = 3
const gates = new Map()
export function gateOf (camp) {
  if (gates.has(camp)) return gates.get(camp)
  const seat = monarchSlot(camp)
  const f = roadsTo(camp).field
  const d = (slot) => f.dist[deployTile('party', slot)]
  // Each road as the set of camp cells it crosses, the seat aside.
  const cellAt = new Map(openCells(camp).filter((c) => c !== seat).map((c) => [deployTile('party', c), c]))
  const roads = []
  for (let t = tileAt(0, DEPTH - ROWS); t < TILES; t++) {
    if (f.dist[t] < Infinity) roads.push(new Set(roadFrom(t, f).filter((x) => cellAt.has(x)).map((x) => cellAt.get(x))))
  }
  const crosses = (cells) => roads.length > 0 && roads.every((road) => cells.some((c) => road.has(c)))
  const sets = (cells, k, from = 0) => (k === 0 ? [[]] : cells.slice(from).flatMap((c, i) => sets(cells, k - 1, from + i + 1).map((rest) => [c, ...rest])))
  const far = (set) => set.reduce((n, c) => n + d(c), 0)
  const crossed = openCells(camp).filter((c) => roads.some((road) => road.has(c)))
  let gate = []
  for (const cells of [crossed.filter((c) => d(c) > 1), crossed]) {
    for (let k = 1; k <= GATE && !gate.length; k++) gate = sets(cells, k).sort((a, b) => far(b) - far(a)).find(crosses) ?? []
    if (gate.length) break
  }
  gates.set(camp, gate)
  return gate
}

// The gate held: each of its cells by the toughest piece left whose footprint covers it, then the rest as zone fills
// them. Null where the camp has no gate, or the field too few pieces to hold it and fight beside it.
function gated (units, camp, threat) {
  const gate = gateOf(camp)
  if (!gate.length || units.length <= gate.length) return null
  const taken = seated(camp)
  const left = units.slice().sort((a, b) => toughness(b) - toughness(a) || a.uid - b.uid)
  for (const cell of gate) {
    if (taken.has(cell)) continue
    const anchors = (u) => (sizeOf(u) === 1 ? [cell] : [cell, cell - 1, cell + LANES, cell + LANES - 1].filter((a) => footprintSlots(a, 2)?.includes(cell)))
    const u = left.find((x) => x.slot < 0 && anchors(x).some((a) => fits(camp, a, sizeOf(x), taken)))
    if (!u) return null
    u.slot = anchors(u).find((a) => fits(camp, a, sizeOf(u), taken))
    cellsOf(u).forEach((c) => taken.add(c))
  }
  return zone(units, camp, threat, { taken })
}

// What a soul is worth on a tile it must hold: how much it takes to fell.
const toughness = (u) => {
  const st = statsOf(u)
  return st.hp * (1 + st.def / 100)
}

// ── the formation's read ─────────────────────────────────────────────────────────────────────────

// What a formation is read against, made once a plan; `reads`: what each soul brings wherever it stands, by uid.
function formationContext (run, L, want = wanted(run, L)) {
  const s = run.state
  const threat = threatOf(run)
  return {
    foes: scout(run),
    threat,
    total: threat.ground.reduce((n, x) => n + x, 0) + threat.air.reduce((n, x) => n + x, 0) || 1,
    seat: deployTile('party', monarchSlot(s.camp)),
    best: want.reduce((n, u) => n + fieldPower(u), 0) || 1,
    tough: standing(souls(s.party)).map(tough).sort((a, b) => b - a).slice(0, fieldCap(run)).reduce((n, x) => n + x, 0) || 1,
    threats: new Set(scoutThreats(run)),
    synergies: !s.ablate?.includes('synergies'),
    reads: new Map()
  }
}

// A formation read against the scouted room, no battle played: each scouted foe walks its road to the seat and stops
// before the first piece of yours on it (TUNING.expert.formation weighs the features, TREES.formation reads them).
//   fielded, air       the pieces fielded; those that strike flyers
//   power, lasts       their worth (wounds counted) and toughness, each over the field's best
//   cover, dps         each piece's hardest blow × the share of the threat map it covers, summed; the blows summed
//   exposed, monarch   the share of each piece's HP (at most 1) and of the Monarch's (at most 2) the foes reaching it take
//   open, blockers     foes reaching the seat with nothing of yours on their road; foes held first by a melee piece
//   behind             ranged pieces that cover the roads where no foe reaches them
//   mend, heals        each healer: the exposure of the allies within its reach; what its heals of others mend
//   synergies, aura    the synergy rules held (a summon as its kind); the allies within an aura's range of its giver
//   arise              each Arise holder: the share of the threat map within its reach
//   answers            each threat type of the room: +1 answered, −1 not
//   focus, contact     each foe where it first comes within reach: the share of its HP yours could deal there, and of
//                      the frailest piece's it reaches there that its blow takes
export function formationFeatures (run, party, ctx = formationContext(run, LEVELS.expert)) {
  const s = run.state
  const pieces = party.filter((u) => !isMonarch(u) && u.slot >= 0)
  const tiles = new Map(pieces.map((u) => [u, tilesAt(u, u.slot)]))
  const flies = (u) => !!unitDef(u.id).flies
  const ground = new Map()
  const air = new Map()
  for (const u of pieces) for (const t of tiles.get(u)) (flies(u) ? air : ground).set(t, u)
  const v = { fielded: pieces.length, air: pieces.filter(ANSWERS.fly).length, power: 0, cover: 0, exposed: 0, open: 0, blockers: 0, behind: 0, mend: 0, monarch: 0, synergies: 0, aura: 0, arise: 0, lasts: 0, heals: 0, answers: 0, dps: 0, focus: 0, contact: 0 }
  const reached = new Map(pieces.map((u) => [u, 0]))
  // What each piece brings wherever it stands, read once a plan (ctx.reads); its coverage once a formation.
  const reads = ctx.reads ?? new Map()
  const readOf = (u) => {
    let r = reads.get(u.uid)
    if (r === undefined) {
      const heals = kitOf(u).filter((a) => isAllyShape(a.shape) && a.shape !== 'self' && a.effects.some((e) => e.op === 'heal' && !e.self))
      reads.set(u.uid, (r = { punch: punch(u), mitigation: mitigation(u), power: fieldPower(u), tough: tough(u), melee: meleeOnly(u), st: statsOf(u, heldMods(u)), heals, aura: auraOf(u), raises: ariseIn(s, u) }))
    }
    return r
  }
  const covers = new Map(pieces.map((u) => [u, coverage(u, u.slot, s.camp)]))
  let onSeat = 0
  for (const f of ctx.foes) {
    let k = 0
    let by = null
    for (; k < f.road.length - 1 && !by; k++) by = ground.get(f.road[k]) ?? (f.flies ? air.get(f.road[k]) : null) ?? null
    const stands = f.road.slice(0, by ? k - 1 : k)
    if (!by) v.open++
    else if (readOf(by).melee) v.blockers++
    const near = (list, r) => r >= 0 && stands.some((t) => list.some((x) => distance(t, x) <= r))
    for (const u of pieces) if (near(tiles.get(u), flies(u) ? f.air : f.reach)) reached.set(u, reached.get(u) + f.raw)
    if (near([ctx.seat], f.reach)) onSeat += f.raw
    // Where it first comes within reach of a piece of yours: focus and contact.
    const first = stands.find((t) => pieces.some((u) => tiles.get(u).some((x) => distance(t, x) <= (flies(u) ? f.air : f.reach))))
    if (first !== undefined) {
      let dealt = 0
      for (const u of pieces) {
        const c = covers.get(u)
        if ((f.flies ? c.air : c.ground).includes(first)) dealt += readOf(u).punch
      }
      v.focus += Math.min(1, dealt / Math.max(1, f.hp))
      let worst = 0
      for (const u of pieces) if (tiles.get(u).some((x) => distance(first, x) <= (flies(u) ? f.air : f.reach))) worst = Math.max(worst, Math.min(1, f.raw * readOf(u).mitigation / Math.max(1, u.hp)))
      v.contact += worst
    }
  }
  const share = new Map(pieces.map((u) => [u, Math.min(1, reached.get(u) * readOf(u).mitigation / Math.max(1, u.hp))]))
  const apart = (a, b) => Math.min(...tiles.get(a).flatMap((x) => tiles.get(b).map((y) => distance(x, y))))
  for (const u of pieces) {
    const p = readOf(u)
    const { st, heals, aura, raises } = p
    const part = covered(covers.get(u), ctx.threat) / ctx.total
    v.power += p.power / ctx.best
    v.cover += p.punch * part
    v.exposed += share.get(u)
    if (!p.melee && part > 0 && reached.get(u) === 0) v.behind++
    v.lasts += p.tough / ctx.tough
    v.dps += p.punch
    for (const a of heals) for (const e of a.effects) if (e.op === 'heal' && !e.self) v.heals += (e.pct ? e.pct * 100 : e.power * st.atk / TUNING.damage.atkDivisor * st.heal.given) / (a === heals[0] ? 1 : heals.length)
    if (heals.length) {
      const r = Math.max(...heals.map(rangeOf)) + Math.floor(st.move)
      for (const x of pieces) if (x !== u && apart(u, x) <= r) v.mend += share.get(x)
    }
    if (aura) for (const x of pieces) if (x !== u && apart(u, x) <= aura.range) v.aura++
    if (raises) {
      let n = 0
      for (let t = 0; t < TILES; t++) if (tiles.get(u).some((x) => distance(t, x) <= raises.domain)) n += ctx.threat.ground[t] + ctx.threat.air[t]
      v.arise += n / ctx.total
    }
  }
  const m = monarchOf(s)
  v.monarch = Math.min(2, onSeat * mitigation(m) / Math.max(1, m.hp))
  if (ctx.synergies) v.synergies = activeSynergies(pieces.flatMap(withSummons)).length
  for (const t of ctx.threats) if (ANSWERS[t]) v.answers += pieces.some(ANSWERS[t]) ? 1 : -1
  return v
}

// What a soul takes to fell, wounds counted: its HP standing, its DEF's mitigation and its damage taken.
const tough = (u) => {
  const st = statsOf(u, heldMods(u))
  return Math.max(0, u.hp) * (1 + st.def / 100) / st.damage.taken
}
const scoutThreats = (run) => {
  const n = currentNode(run)
  return n?.foes ? [...roomThreats(n)] : []
}

// The share of a blow's raw a soul takes out of battle: its DEF's mitigation and its damage taken.
const mitigation = (u) => {
  const st = statsOf(u, heldMods(u))
  return TUNING.damage.defConstant / (TUNING.damage.defConstant + Math.max(0, st.def)) * st.damage.taken
}
// A unit's hardest blow, raw, by `mods` (a soul's held relics'; a foe's floor's).
const punch = (u, mods = heldMods(u)) => {
  const st = statsOf(u, mods)
  return Math.max(0, ...kitOf(u).filter(isBlow).map((b) => b.effects.reduce((n, e) => n + (e.op === 'damage' ? e.power : 0), 0))) * st.atk / TUNING.damage.atkDivisor * st.damage.dealt
}

// The souls L would field: the strongest standing (wounds counted at the expert's level), its target's kinds favoured.
export const standing = (party) => party.filter((u) => u.hp > 0)
const wanted = (run, L) => {
  const keeps = L.book ? targetKinds(targetOf(run.state)) : null
  const w = (u) => worth(u, L.ablate !== 'summons') * (L.wounds ? Math.sqrt(hpPct(u)) : 1) * (keeps?.has(u.id) ? 1 + TUNING.expert.book.target : 1)
  return standing(souls(run.state.party)).sort((a, b) => w(b) - w(a) || a.uid - b.uid).slice(0, fieldCap(run))
}

// → { party, by, rules, met }: basic's first draft, or the expert's best draft hill-climbed `search` steps; `by`, `rules`:
// the rules that turned a comparison (else 'weights'); `met`: each formation judged, { party, v, keys, score, draft }.
export function plan (run, L, { onCandidate = null } = {}) {
  const want = wanted(run, L)
  const options = drafts(run, want, L).map((party) => allowed(run, party, L))
  if (!L.search) {
    onCandidate?.(options[0])
    return { party: options[0], by: 'first draft', rules: [], met: [] }
  }
  const ctx = formationContext(run, L, want)
  const w = TUNING.expert.formation
  const filters = TREES.formation.filter((n) => n.keep && n.when(ctx))
  const met = new Map()
  const judge = (party, draft = false) => {
    const key = party.map((u) => `${u.uid}@${u.slot}`).sort().join()
    if (!met.has(key)) {
      const v = formationFeatures(run, party, ctx)
      met.set(key, { party, v, keys: keysOf(TREES.formation, ctx, { v }), score: value(v, w), draft })
      onCandidate?.(party)
    }
    return met.get(key)
  }
  const turned = new Set()
  let best = null
  const take = (c) => {
    if (best === null) return (best = c)
    const won = outranks(c, best)
    const lost = won < 0 ? outranks(best, c) : -1
    if (won >= 0 && won < filters.length) turned.add(won)
    if (lost >= 0 && lost < filters.length) turned.add(lost)
    if (won >= 0) best = c
  }
  for (const party of options) take(judge(party, true))
  const rng = createRng(JSON.stringify([run.state.seed, run.state.floor, run.state.at, best.party.map((u) => u.uid)])).stream('climb')
  const open = openCells(run.state.camp)
  for (let i = 0; i < L.search; i++) take(judge(allowed(run, mutate(best.party, standing(souls(run.state.party)), open, rng, run.state, L), L)))
  const rules = [...turned].sort((a, b) => a - b).map((k) => filters[k].id)
  return { party: best.party, by: rules[0] ?? 'weights', rules, met: [...met.values()] }
}

// One change to a formation: trade a soul for one in the ossuary, swap two, or move one (trades alone under the ablation).
function mutate (party, pool, open, rng, s, L) {
  const out = party.map((u) => ({ ...u }))
  const fixed = L.ablate === 'formation'
  const movable = out.filter((u) => !isMonarch(u))
  if (!movable.length) return out
  const a = movable[rng.int(movable.length)]
  const spare = pool.filter((u) => !out.some((x) => x.uid === u.uid))
  const roll = rng()
  if (fixed && !spare.length) return out
  if (spare.length && (roll < 0.2 || fixed)) {
    const b = rng.pick(spare)
    const next = out.map((u) => (u === a ? { ...b, slot: a.slot } : u))
    return legal(next, s.camp) ? next : out
  }
  if (movable.length > 1 && roll < 0.55) {
    const b = rng.pick(movable.filter((u) => u !== a))
    const slot = a.slot
    a.slot = b.slot
    b.slot = slot
    return legal(out, s.camp) ? out : party.map((u) => ({ ...u }))
  }
  const taken = new Set(out.filter((u) => u !== a).flatMap(cellsOf))
  const free = open.filter((slot) => slot !== a.slot && fits(s.camp, slot, sizeOf(a), taken))
  if (!free.length) return out
  const near = a.slot < 0 ? [] : free.filter((slot) => distance(deployTile('party', slot), deployTile('party', a.slot)) <= 2)
  a.slot = rng.pick(near.length && rng.chance(0.7) ? near : free)
  return out
}

// The expert's formation, made once a prep (the plan reads who stands, not where), or the forest's pick (prepPick).
const plans = new WeakMap()
export function planFor (run, L, sit = null) {
  const s = run.state
  const key = JSON.stringify([L, s.floor, s.at, s.camp, s.relics, s.nextUid, s.party.map((u) => [u.uid, u.id, u.lvl, u.hp, u.maxHp, u.tracks, u.relics])])
  const have = plans.get(run)
  if (have?.key === key) return have.plan
  const onCandidate = audited(run) ? (party) => { AUDIT.candidates++; for (const f of new Set(featuresOf(s, party))) note('considered', f) } : null
  const made = plan(run, L, { onCandidate })
  noteRule(run, 'formation', made, `floor ${s.floor}, ${currentNode(run).type} in ${s.camp}`)
  const out = prepPick(run, L, made, sit).map((u) => ({ uid: u.uid, slot: u.slot }))
  plans.set(run, { key, plan: out })
  return out
}

// One step toward the plan: a soul it leaves out to the ossuary, a soul into its cell, or one in the way out; then fight.
function pickPrep (run, L, sit) {
  const s = run.state
  const spend = pickSpend(run, L, sit)
  if (spend) return spend
  const goal = planFor(run, L, sit).filter((p) => !isMonarch(p))
  const piece = (p) => s.party.find((u) => u.uid === p.uid)
  const out = fielded(souls(s.party)).find((u) => !goal.some((p) => p.uid === u.uid && p.slot >= 0))
  if (out) return { type: 'place', uid: out.uid, slot: OSSUARY }
  const off = goal.filter((p) => piece(p).slot !== p.slot)
  const next = off.find((p) => canPlace(run, piece(p), p.slot))
  if (next) return { type: 'place', uid: next.uid, slot: next.slot }
  const blocker = off.find((p) => piece(p).slot >= 0)
  if (blocker) return { type: 'place', uid: blocker.uid, slot: OSSUARY }
  return { type: 'fight' }
}

// ── audit: what the expert considers, what it chooses, and which rule decided ─────────────────────

// The audit (--audit), off but for it: per mechanic, formations met (`considered`) and fought (`chosen`) that use it; per
// decision, the rule that decided it (`rules`) and the first one's situation (`example`); `run`: the run audited, or all.
export const AUDIT = { on: false, run: undefined, candidates: 0, plans: 0, considered: {}, chosen: {}, done: {}, rules: {}, example: {} }
const note = (book, key, n = 1) => { if (AUDIT.on) AUDIT[book][key] = (AUDIT[book][key] ?? 0) + n }
const audited = (run) => AUDIT.on && (AUDIT.run === undefined || AUDIT.run === run)
export function resetAudit (on = true, run = undefined) {
  Object.assign(AUDIT, { on, run, candidates: 0, plans: 0, considered: {}, chosen: {}, done: {}, rules: {}, example: {} })
}
// A decision of `run`'s, for the audit: counted by "decision: rule", the first one's situation (`line`) kept.
function noteRule (run, decision, pick, line) {
  if (!audited(run)) return
  const key = `${decision}: ${pick.by}`
  note('rules', key)
  AUDIT.example[key] ??= line
}
const surveyLine = (sit) => `floor ${sit.floor} rank ${sit.rank}, ${sit.purse} essence, souls at ${Math.round(100 * sit.health)}% (${sit.fallen} fallen), ` +
  `Monarch ${Math.round(100 * sit.monarch)}%, ${sit.fielded}/${sit.command} fielded, ${sit.relics.unheld.length} relic(s) waiting` +
  (sit.target ? `, toward ${sit.target.id} (${Math.round(100 * sit.target.progress)}%)` : '') +
  (sit.rooms.length ? `; next: ${sit.rooms.map((r) => r.type + (r.threat ? ` (${(sit.strength / r.threat).toFixed(1)}×)` : '')).join(', ')}` : '')

// What a formation uses, for the audit; 'left out': a piece in the ossuary though the field had room for it.
export const FEATURES = ['long arm fielded', '2×2 fielded', 'fused fielded', 'beside the Monarch', 'left out']
function featuresOf (s, party) {
  const out = []
  const pieces = party.filter((u) => !isMonarch(u)).map((p) => ({ ...s.party.find((x) => x.uid === p.uid), ...p }))
  const seat = deployTile('party', monarchSlot(s.camp))
  for (const u of pieces) {
    if (u.slot < 0) { out.push('left out'); continue }
    if (armOf(u) === 2) out.push('long arm fielded')
    if (sizeOf(u) === 2) out.push('2×2 fielded')
    if (unitDef(u.id).fused) out.push('fused fielded')
    if (cellsOf(u).some((c) => distance(deployTile('party', c), seat) === 1)) out.push('beside the Monarch')
  }
  return out
}

// A formation fought: its features once each.
export function chose (s, goal) {
  AUDIT.plans++
  for (const f of new Set(featuresOf(s, goal))) note('chosen', f)
}

// ── growth: essence and fusions ─────────────────────────────────────────────────────────────────────

// Basic spends by rule of thumb; the expert gives its relics where they are worth most, then buys by the growth search.
function pickSpend (run, L, sit) {
  if (!L.spend) return basicSpend(run, L)
  return pickHold(run, L, sit) ?? spendPick(run, L, sit)
}

// Every purchase the purse affords L: any soul's next tier on either track (but under the tracks ablation).
export function spendOptions (run, L) {
  const s = run.state
  if (L.ablate === 'tracks') return []
  return souls(s.party).flatMap((u) => [0, 1].filter((track) => canAdvance(s, u, track) && s.essence >= tierCost(run, u, track))
    .map((track) => ({ type: 'upgrade', uid: u.uid, track })))
}

// The fusions L may make now, each of its canonical parts (fuseParts); none for basic or under the fusions ablation.
export function fusionOptions (run, L) {
  if (!L.fuse || L.ablate === 'fusions') return []
  return FUSION_LIST.filter((r) => canFuse(run, r.id) && mayFuse(r.id)).map((r) => ({ type: 'fuse', id: r.id, parts: fuseParts(run, r.id) }))
}

// Basic's spending: the next tier of the lowest soul that will fight (by level, then party order) that has one, on the
// track it is on (the one with more tiers, the first on a tie), else the other where that one is stopped, as the purse
// affords.
function basicSpend (run, L) {
  const s = run.state
  if (L.ablate === 'tracks') return null
  const fight = new Set(standing(souls(s.party)).sort(byFieldPower).slice(0, fieldCap(run)))
  const affords = (u, track) => canAdvance(s, u, track) && s.essence >= tierCost(run, u, track)
  const lowest = souls(s.party).filter((u) => fight.has(u) && [0, 1].some((t) => canAdvance(s, u, t))).sort((a, b) => a.lvl - b.lvl)[0]
  if (!lowest) return null
  const on = lowest.tracks[1] > lowest.tracks[0] ? 1 : 0
  const track = affords(lowest, on) ? on : !canAdvance(s, lowest, on) && affords(lowest, 1 - on) ? 1 - on : null
  return track === null ? null : { type: 'upgrade', uid: lowest.uid, track }
}

// What a state is worth to grow toward: the field's strength (a log), the book's worth of its target; `sketch` weighs them.
export const growthOf = (s, L) => ({ strength: Math.log(strength(s, L.ablate !== 'summons')), book: L.book ? bookValue(s) : 0 })
export const sketch = (s, L) => value(growthOf(s, L), TUNING.expert.growth)
// What a choice must beat: keeping what it has (TUNING.expert.growth.keep).
const KEEP = () => TUNING.expert.growth.keep

// The growth search, one decision: keeping, and each of `actions` applied to a copy (a tier also with the next on its
// track, for a level that rounds away), by the tree's rules for `why`, then the weights. → the action, or null to keep
const growths = new WeakMap()
const label = (a) => (a.type === 'fuse' ? `fuse ${a.id}` : a.type)
export function grow (run, L, actions, why, sit = null) {
  if (!actions.length) return null
  const s = run.state
  const key = JSON.stringify([L.ablate, s.floor, s.at, s.phase, s.essence, s.relics, s.party.map((u) => [u.uid, u.hp, u.slot >= 0, u.relics, u.tracks, u.lvl])])
  const seen = growths.get(run) ?? {}
  if (seen[why]?.key === key) return seen[why].pick
  if (audited(run)) for (const a of actions) note('considered', label(a))
  const base = growthOf(s, L)
  const gain = (st) => {
    const v = growthOf(st, L)
    return { strength: v.strength - base.strength, book: v.book - base.book, keep: 0 }
  }
  const room = (uid) => (s.party.find((u) => u.uid === uid)?.relics?.length ?? 0) < TUNING.relic.perPiece
  const options = [{ action: null, v: { strength: 0, book: 0, keep: 1, save: why === 'spend' ? saving(run, L) : 0 } }]
  for (const a of actions) {
    const sim = fork(run)
    apply(sim, a)
    options.push({ action: a, free: a.type === 'hold' && room(a.uid), v: { ...gain(sim.state), save: 0 } })
    if (!nextTier(sim, a)) continue
    apply(sim, a)
    options.push({ action: a, v: { ...gain(sim.state), save: 0 } })
  }
  const decided = decide(TREES[why] ?? [], sit, options, TUNING.expert.growth)
  const pick = decided.option.action
  // Each option's score by its action (a tier's the better of it alone and with the next: spendCandidates reads them).
  const scores = new Map()
  for (const o of options) {
    const id = outId(o.action)
    if (Number.isFinite(o.score) && !(scores.get(id) >= o.score)) scores.set(id, o.score)
  }
  growths.set(run, { ...seen, [why]: { key, pick, scores } })
  noteRule(run, why, decided, sit && surveyLine(sit))
  if (pick && audited(run)) note('done', label(pick))
  return pick
}

// Whether, with tier `a` just bought on `sim`, the next on its track may be bought too (the two priced together).
function nextTier (sim, a) {
  if (a.type !== 'upgrade') return false
  const u = sim.state.party.find((x) => x.uid === a.uid)
  return canAdvance(sim.state, u, a.track) && sim.state.essence >= tierCost(sim, u, a.track)
}

// Soul `u` with its next tier on `track` taken, at the level it gives (its other fields as they are).
const afterTier = (u, track) => {
  const tracks = nextTracks(u.tracks, track)
  return { ...u, tracks, lvl: levelOf({ tracks }) }
}

// ── the combo book ───────────────────────────────────────────────────────────────────────────────

// The combo book (combos.json, made by --combos): every combo ranked by a static formula, best first, each weighed on
// every floor as that floor's army (BOOK_FLOORS), its pieces in it and the rest the plain army's (FILLER):
//   { made, plain: { relic: points on the plain army }, combos: [entry] }; an entry:
//   { id: fusion:<recipe>:<track> | core:<kind>:<track> | kin:<kin>:<n> | role:<role>:<n>, needs: { kind: pieces },
//     fuse?: recipe, tracks: { kind: the track each soul of it grows on }, kin?|role?: { name: n }, from: the first
//     floor its kinds are met,
//     gain: [per floor, the log of its army's power over the plain army's; null where it cannot stand],
//     relics?: { relic: points, floors 2 and 4 } }
const BOOK_FLOORS = [
  { command: 3, tiers: 1, hp: 220 }, { command: 5, tiers: 2, hp: 265 },
  { command: 7, tiers: 3, hp: 300 }, { command: 9, tiers: 4, hp: 340 }
]
// Whether relic def `r` has a mod on run-level stat path `path`.
export const gives = (r, path) => (r.mods ?? []).some((m) => m.path === path)
// The relics a battle reads (mods on a unit, triggers, rules, Arise's reach and tier); not Command, not the Monarch's HP.
const BATTLE_RELICS = () => RELIC_LIST.filter((r) => (r.mods?.some((m) => !isRunPath(m.path) || m.path.startsWith('arise.')) || r.on || r.rule) &&
  !gives(r, 'run.command') && !gives(r, 'run.monarchHp')).map((r) => r.id)
const RECRUITED = () => UNIT_LIST.filter((u) => u.spawn && tracksOf(u.id).length === 2)
// The plain army: the starting souls, then the kinds the floors meet, earliest and commonest first, to the deepest Command.
const FILLER = [...START_PARTY, ...RECRUITED().filter((u) => !START_PARTY.includes(u.id))
  .sort((a, b) => a.spawn.minFloor - b.spawn.minFloor || b.spawn.weight - a.spawn.weight || (a.id < b.id ? -1 : 1)).map((u) => u.id)]
  .slice(0, Math.max(...BOOK_FLOORS.map((F) => F.command)))

// The recipe whose result is fused kind `id`, or undefined.
const RECIPES = new Map(FUSION_LIST.map((r) => [r.result, r]))
const recipeOf = (id) => RECIPES.get(id)
// The first floor a kind is met on: its spawn's, a fused kind's the latest of its recipe's parts'.
const firstFloor = (id) => unitDef(id).spawn?.minFloor ?? Math.max(1, ...Object.keys(recipeOf(id)?.needs ?? {}).map(firstFloor))

// The book's combos, as content makes them; `cores` (id → mean gain), once ranked, picks each kin's and role's kinds.
export function combosOf (cores = null) {
  const kinds = RECRUITED()
  const first = firstFloor
  const out = []
  for (const r of FUSION_LIST) {
    for (const track of [0, 1]) {
      out.push({ id: `fusion:${r.id}:${track}`, needs: { ...r.needs }, fuse: r.id, tracks: { [r.result]: track }, from: Math.max(...Object.keys(r.needs).map(first)) })
    }
  }
  for (const u of kinds) for (const track of [0, 1]) out.push({ id: `core:${u.id}:${track}`, needs: { [u.id]: 2 }, tracks: { [u.id]: track }, from: first(u.id) })
  if (!cores) return out
  // A kind's better track, and its worth to a kin or role (its better core's mean gain).
  const best = (id) => [0, 1].map((t) => [t, cores[`core:${id}:${t}`] ?? -Infinity]).sort((a, b) => b[1] - a[1])[0]
  for (const syn of SYNERGIES) {
    for (const axis of ['kin', 'role']) {
      for (const [k, n] of Object.entries(syn.needs[axis] ?? {})) {
        const pool = kinds.filter((u) => u[axis] === k).sort((a, b) => first(a.id) - first(b.id) || best(b.id)[1] - best(a.id)[1])
        if (!pool.length) continue
        const needs = {}
        for (let i = 0; i < n; i++) needs[pool[i % pool.length].id] = (needs[pool[i % pool.length].id] ?? 0) + 1
        const tracks = Object.fromEntries(Object.keys(needs).map((id) => [id, best(id)[0]]))
        out.push({ id: `${axis}:${k}:${n}`, needs, tracks, from: Math.max(...Object.keys(needs).map(first)), [axis]: { [k]: n } })
      }
    }
  }
  return out
}

// A combo's army on `floor` (null: the plain army) as a run in prep, `relics` held; null where its pieces are too many.
let bookBase = null
const bookRun = () => (bookBase ??= createRun({ seed: 'book', start: START_PARTY }))
function bookArmy (combo, floor, relics = []) {
  const F = BOOK_FLOORS[Math.min(floor, BOOK_FLOORS.length) - 1]
  const tracks = { ...(combo?.tracks ?? {}) }
  const ids = []
  if (combo?.fuse && floor > 1) ids.push(fusionDef(combo.fuse).result)
  else for (const [id, n] of Object.entries(combo?.needs ?? {})) for (let i = 0; i < n; i++) ids.push(id)
  if (ids.length > F.command) return null
  for (const id of FILLER) if (ids.length < F.command) ids.push(id)
  const run = { state: { ...bookRun().state }, battle: null, setup: null }
  const s = run.state
  // Each soul of a kind the combo names grows on that track (the rest on the first), the floor's tiers on it and up
  // to II on the other.
  const tiersOn = (id) => {
    const t = tracks[id] ?? 0
    const tiers = [0, 0]
    tiers[t] = F.tiers
    tiers[1 - t] = Math.min(2, Math.max(0, F.tiers - 2))
    return tiers
  }
  const monarch = { ...monarchOf(s), maxHp: F.hp, hp: F.hp }
  s.party = [monarch, ...ids.map((id, i) => {
    const t = tiersOn(id)
    return makeUnit(id, { uid: i + 1, lvl: levelOf({ tracks: t }), tracks: t })
  })]
  s.nextUid = ids.length + 1
  // The floor first: the banners fill the Command up from the floor's base.
  s.floor = floor
  s.relics = [...Array(Math.max(0, F.command - commandOf({ ...s, relics: [] }))).fill('grave_banner'), ...relics]
  // A piece relic works only held: each to the first piece with room for it, the combo's own pieces first.
  for (const id of relics.filter((r) => !isRunRelic(r))) {
    const u = s.party.find((x) => !isMonarch(x) && (x.relics?.length ?? 0) < TUNING.relic.perPiece && !x.relics?.includes(id))
    if (u) u.relics = [...(u.relics ?? []), id]
  }
  s.phase = 'prep'
  return run
}

// A combo army's power, the book's static formula (TUNING.expert.book): its souls' worth with their relics and synergies.
function bookPower (run) {
  const b = TUNING.expert.book
  const s = run.state
  const pieces = souls(s.party)
  const read = relicReads(s)
  let power = 0
  for (const u of pieces) {
    const held = (u.relics ?? []).reduce((n, id) => n + (relicDef(id).on ? b.trigger : 0) + (relicDef(id).rule ? b.rule : 0), 0)
    power += read(u, (mods) => worth(u, true, mods, b.hits, b.worth)) * (1 + (unitDef(u.id).fused ? b.fused : 0) + held)
  }
  const rules = activeSynergies(pieces.flatMap(withSummons)).length
  const arise = pieces.some((u) => u.relics?.some(grantsArise)) ? s.relics.filter((id) => isRunRelic(id) && (relicDef(id).mods ?? []).some((m) => m.path.startsWith('arise.'))).length : 0
  return power * (1 + b.synergy * rules + b.arise * arise)
}

// --combos: the book, made: every fusion and core, then the kin and role combos of the best cores, each against the
// plain army on every floor; then each battle relic that adds more than TUNING.expert.book.floor to them.
const BOOK_FILE = new URL('./combos.json', import.meta.url)
export function makeBook ({ out = BOOK_FILE, quiet = false } = {}) {
  const t0 = Date.now()
  const floors = BOOK_FLOORS.map((_, i) => i + 1)
  const power = (combo, floor, relics = []) => {
    const army = bookArmy(combo, floor, relics)
    return army && Math.log(bookPower(army))
  }
  const plain = floors.map((floor) => power(null, floor))
  const rank = (combos) => combos.map((combo) => ({
    ...combo,
    gain: floors.map((floor, f) => {
      const p = power(combo, floor)
      return p === null ? null : +(p - plain[f]).toFixed(4)
    })
  }))
  const mean = (e) => {
    const g = e.gain.filter((x, f) => x !== null && f + 1 >= e.from)
    return g.length ? g.reduce((n, x) => n + x, 0) / g.length : -Infinity
  }
  const first = rank(combosOf())
  const cores = Object.fromEntries(first.filter((e) => e.id.startsWith('core:')).map((e) => [e.id, mean(e)]))
  const second = rank(combosOf(cores).filter((c) => !first.some((e) => e.id === c.id)))
  const book = [...first, ...second].sort((a, b) => mean(b) - mean(a) || (a.id < b.id ? -1 : 1))
  // The relics: on floors 2 and 4, each against the army without it (one that needs Arise, against Arise alone).
  const relicFloors = [2, 4]
  const pairs = (combo) => {
    const points = {}
    for (const id of BATTLE_RELICS()) {
      const base = relicDef(id).needsArise ? ['arise'] : []
      let sum = 0
      let n = 0
      for (const floor of relicFloors) {
        const got = power(combo, floor, [...base, id])
        const ref = power(combo, floor, base)
        if (got === null || ref === null) continue
        sum += got - ref
        n++
      }
      if (n && sum / n > TUNING.expert.book.floor) points[id] = +(sum / n).toFixed(4)
    }
    return Object.fromEntries(Object.entries(points).sort((x, y) => y[1] - x[1]))
  }
  for (const e of book) e.relics = pairs(e)
  const data = { made: 'node src/sim/autoplay.js --combos', plain: pairs(null), combos: book }
  fs.writeFileSync(out, JSON.stringify(data, null, 1) + '\n')
  if (quiet) return data
  console.log(`the combo book: ${book.length} combos ranked in ${((Date.now() - t0) / 1000).toFixed(1)} s; written to ${out.pathname ?? out}`)
  for (const e of book.slice(0, 15)) console.log(`  ${e.id.padEnd(34)} ${e.gain.map((g) => (g === null ? '    -   ' : g.toFixed(3).padStart(8))).join(' ')}  ${Object.keys(e.relics ?? {}).slice(0, 3).join(', ')}`)
}

// The book as the expert reads it, empty where none was made.
export const BOOK = (() => {
  try {
    return JSON.parse(fs.readFileSync(BOOK_FILE, 'utf8'))
  } catch {
    return { margins: {}, plain: {}, combos: [] }
  }
})()

// ── archetypes: a run committed to a build ───────────────────────────────────────────────────────

// The builds a run may commit to: every fused kind and every synergy, by id.
export const ARCHETYPES = () => [...new Set(FUSION_LIST.map((r) => r.result)), ...SYNERGIES.map((x) => x.id)]
// The synergy archetype `arch` names, or null (a fused kind's).
export const synergyOf = (arch) => SYNERGIES.find((x) => x.id === arch) ?? null
// The recipes a fused kind is built by: its own and, below them, every fused part's.
export function recipesOf (kind, seen = new Set()) {
  const out = []
  for (const r of FUSION_LIST) {
    if (r.result !== kind || seen.has(r.id)) continue
    seen.add(r.id)
    out.push(r, ...Object.keys(r.needs).filter((id) => unitDef(id).fused).flatMap((id) => recipesOf(id, seen)))
  }
  return out
}
// An archetype's combos of the book: a fused kind's, those that fuse it or a fused part of it (`fuse`, recipesOf); a
// synergy's, the kin's or role's that reach every count its rule needs (`kin`, `role`). Throws for an unknown one.
export function archetypeCombos (arch, combos = BOOK.combos) {
  const syn = synergyOf(arch)
  if (syn) return combos.filter((c) => Object.entries(syn.needs).every(([axis, need]) => Object.entries(need).every(([k, n]) => (c[axis]?.[k] ?? 0) >= n)))
  if (!FUSION_LIST.some((r) => r.result === arch)) throw new Error(`unknown archetype "${arch}": ${ARCHETYPES().join(', ')}`)
  const recipes = new Set(recipesOf(arch).map((r) => r.id))
  return combos.filter((c) => recipes.has(c.fuse))
}
// The archetype the expert is committed to (null: free play): its book is that archetype's combos alone.
let COMMIT = null
export function useCommit (arch, { strict = false } = {}) {
  const combos = arch ? archetypeCombos(arch) : null
  if (arch && !combos.length) throw new Error(`archetype "${arch}" has no combo in the book (npm run combos)`)
  COMMIT = arch ? { arch, combos, ...(strict && { strict: strictOf(arch) }) } : null
}
export const commitOf = () => COMMIT?.arch ?? null
export const isStrict = () => !!COMMIT?.strict
// `fn()` committed to `arch` (null: free play), strictly with `strict`, the commitment before it put back after;
// undefined: as it is. → what fn returns
export function withCommit (arch, fn, strict = false) {
  if (arch === undefined) return fn()
  const before = COMMIT
  useCommit(arch, { strict })
  try {
    return fn()
  } finally {
    COMMIT = before
  }
}

// The strict commitment (--builds --strict): a run held to its archetype's `kinds` and `recipes`: drafted and recruited
// where offered, spared on release, the only fusions, never transmuted away; the rest is the expert's.
export function strictOf (arch) {
  const syn = synergyOf(arch)
  const ofAxis = (u) => Object.entries(syn.needs).every(([axis, need]) => need[u[axis]] !== undefined)
  const kinds = syn
    ? new Set(UNIT_LIST.filter((u) => (u.spawn || u.fused) && !u.boss && ofAxis(u)).map((u) => u.id))
    : new Set(recipesOf(arch).flatMap((r) => [r.result, ...Object.keys(r.needs)]))
  const recipes = new Set((syn ? FUSION_LIST.filter((r) => kinds.has(r.result)) : recipesOf(arch)).map((r) => r.id))
  const need = syn ? Math.max(...Object.values(syn.needs).flatMap((x) => Object.values(x))) : 0
  return { arch, syn: !!syn, kinds, recipes, need }
}
// Whether recipe `id` may be made: any, but under the strict commitment one of its recipes.
const mayFuse = (id) => !COMMIT?.strict || COMMIT.strict.recipes.has(id)
// Whether the strict archetype is short of a soul of kind `id`, every soul held counted (a fused kind as its parts).
function strictShort (run, id) {
  const st = COMMIT.strict
  if (!st.kinds.has(id)) return false
  const s = run.state
  const counts = new Map()
  for (const u of souls(s.party)) counts.set(u.id, (counts.get(u.id) ?? 0) + 1)
  if (st.syn) {
    let n = 0
    let w = 0
    for (const [k, m] of counts) if (st.kinds.has(k)) { n += m; w += m * synergyWeight({ id: k }) }
    return w < st.need || n < fieldCap(run)
  }
  let short = false
  const want = (kind, k) => {
    const have = Math.min(counts.get(kind) ?? 0, k)
    counts.set(kind, (counts.get(kind) ?? 0) - have)
    if (have >= k) return
    const r = recipeOf(kind)
    if (!r) { if (kind === id) short = true; return }
    for (const [part, m] of Object.entries(r.needs)) want(part, (k - have) * m)
  }
  want(st.arch, 1)
  return short
}
// The strict commitment's recruit where the spoils offer a soul of its kinds the purse affords: the one the sketch gains
// most by, forced where the archetype is short of it (strictShort), else only where it beats keeping; once a room.
// → { pick: { index, release? } | null, forced, options: [{ index, kind, actions, gain }] }; undefined: none offered
const stricts = new WeakMap()
function strictRecruit (run, L) {
  const st = COMMIT?.strict
  if (!st) return undefined
  const s = run.state
  const key = JSON.stringify([st.arch, s.floor, s.at, s.offers.map((o) => o.id)])
  if (stricts.get(run)?.key === key) return stricts.get(run).out
  const offers = [...s.offers.entries()].filter(([, o]) => o.cost <= s.essence && st.kinds.has(o.id))
  let out
  if (offers.length) {
    const full = soulCount(s.party) >= rosterCap(run)
    const spare = (u) => souls(s.party).some((x) => x !== u && x.hp > 0)
    const weakest = inOssuary(s.party).filter((u) => spare(u) && !st.kinds.has(u.id)).sort(byFieldPower).at(-1)
    const room = !full || !!weakest
    const short = room ? offers.filter(([, o]) => strictShort(run, o.id)) : []
    const forced = short.length > 0
    const base = sketch(s, L)
    const options = []
    if (room) {
      for (const [index] of forced ? short : offers) {
        const actions = [...(full ? [{ type: 'release', uid: weakest.uid }] : []), { type: 'reap', index }]
        const sim = fork(run)
        for (const a of actions) apply(sim, a)
        options.push({ index, kind: s.offers[index].id, actions, gain: sketch(sim.state, L) - base })
      }
    }
    let pick = null
    let best = forced ? -Infinity : KEEP()
    for (const o of options) if (o.gain > best) { best = o.gain; pick = o }
    out = { pick: pick && { index: pick.index, ...(full && { release: weakest.uid }) }, forced, options }
  }
  stricts.set(run, { key, out })
  return out
}
// The combos the expert plays toward: the committed archetype's, else the whole book.
const bookCombos = () => COMMIT?.combos ?? BOOK.combos

// How far a run is along a combo, 0 to 1: the mean of its pieces standing (a fused part by its own recipe's progress, a
// kin or role as its synergy counts), a fusion made, and its tracks' tiers of four (each kind's by its soul with the most
// tiers). `counts`: standingCounts(s); `best`: bestTracks(s).
function comboProgress (s, c, counts = standingCounts(s), best = bestTracks(s)) {
  const pieces = (id) => counts.get(id) ?? 0
  const share = (needs) => {
    let got = 0
    let all = 0
    let deep = false
    for (const id in needs) {
      const have = Math.min(pieces(id), needs[id])
      got += have
      all += needs[id]
      if (have < needs[id] && RECIPES.has(id)) deep = true
    }
    if (!deep) return got / all
    // A fused part short: each of its pieces counted once, down its recipe.
    const left = new Map()
    got = 0
    const count = (id, k, w) => {
      const have = Math.min(left.get(id) ?? pieces(id), k)
      left.set(id, (left.get(id) ?? pieces(id)) - have)
      got += have * w
      const r = have < k && recipeOf(id)
      if (!r) return
      const n = Object.values(r.needs).reduce((x, m) => x + m, 0)
      for (const [part, m] of entriesOf(r.needs)) count(part, (k - have) * m, w / n)
    }
    for (const [id, k] of entriesOf(needs)) count(id, k, 1)
    return got / all
  }
  const of = (axis, value) => {
    let n = 0
    for (const [id, m] of counts) if (unitDef(id)[axis] === value) n += m * synergyWeight({ id })
    return n
  }
  // The parts summed as they come (the order a list of them would sum in), and counted.
  let sum = 0
  let parts = 0
  const part = (x) => {
    sum += x
    parts++
  }
  if (c.fuse) {
    const made = pieces(fusionDef(c.fuse).result) > 0
    const first = made ? 1 : share(c.needs)
    part(first)
    part(made ? 1 : 0)
  } else if (c.kin || c.role) {
    for (const [k, n] of entriesOf(c.kin ?? NO_NEEDS)) part(Math.min(1, of('kin', k) / n))
    for (const [r, n] of entriesOf(c.role ?? NO_NEEDS)) part(Math.min(1, of('role', r) / n))
  } else part(share(c.needs))
  const tracks = entriesOf(c.tracks)
  const held = tracks.filter(([id]) => pieces(id) > 0)
  part(held.length ? held.reduce((n, [id, t]) => n + (best.get(id)?.[t] ?? 0) / 4, 0) / tracks.length : 0)
  return sum / parts
}
// An object's entries, made once an object (the book's combos and the recipes' needs never change).
const ENTRIES = new WeakMap()
const NO_NEEDS = Object.freeze({})
function entriesOf (o) {
  let out = ENTRIES.get(o)
  if (out === undefined) ENTRIES.set(o, (out = Object.entries(o)))
  return out
}
function standingCounts (s) {
  const counts = new Map()
  for (const u of souls(s.party)) if (u.hp > 0) counts.set(u.id, (counts.get(u.id) ?? 0) + 1)
  return counts
}
// Each kind held, the tracks of its soul with the most tiers (the first in the party among equals). → Map id → tracks
function bestTracks (s) {
  const best = new Map()
  for (const u of souls(s.party)) {
    const t = best.get(u.id)
    if (!t || u.tracks[0] + u.tracks[1] > t[0] + t[1]) best.set(u.id, u.tracks)
  }
  return best
}

// A combo's worth from here: its gain over the plain army on the floors left, and the points of the relics at work that
// pair with it; a relic that costs the Monarch HP counts none while nothing may heal it.
const BOOK_CAP = BOOK_FLOORS.length
function comboWorth (s, c, work = atWork(s), bled = unhealed(s)) {
  const pairs = c.relics ?? BOOK.plain ?? {}
  let relics = 0
  for (const id of work) relics += bled && bleeds(id) ? 0 : pairs[id] ?? 0
  // A combo whose kinds are not met before a later floor (`from`) is worth TUNING.expert.book.ahead of it until then.
  return (gainFrom(c, Math.min(s.floor, BOOK_CAP)) + relics) * (c.from > s.floor ? TUNING.expert.book.ahead : 1)
}
// A combo's mean gain on the floors from `from` on (none below 0), made once a combo and floor.
const gains = new WeakMap()
function gainFrom (c, from) {
  let kept = gains.get(c)
  if (!kept) gains.set(c, (kept = []))
  if (kept[from] === undefined) {
    const g = c.gain.filter((x, f) => x !== null && f + 1 >= from)
    kept[from] = Math.max(0, g.length ? g.reduce((n, x) => n + x, 0) / g.length : 0)
  }
  return kept[from]
}
// The relics at work in a state, each once: the run relics owned and the piece relics a standing soul holds.
const atWork = (s) => new Set([...s.relics.filter(isRunRelic), ...standing(souls(s.party)).flatMap((u) => u.relics ?? [])])

// The book's value of a state: the best of its combos, by worth times progress. The target (targetOf) is that combo.
function bookValue (s) {
  return bookRead(s).value
}
export function targetOf (s) {
  return bookRead(s).target
}
// Both, read once for what they read of a state (by the combos in play): its floor, the relics at work, whether nothing
// heals the Monarch, the standing souls of each kind and the tiers of its soul with the most. Dropped whole past 4,096
// states.
const BOOK_READS = new WeakMap()
function bookRead (s) {
  const work = atWork(s)
  const bled = unhealed(s)
  const counts = standingCounts(s)
  const best = bestTracks(s)
  const combos = bookCombos()
  const key = JSON.stringify([s.floor, [...work], bled, [...counts], [...counts.keys()].map((id) => best.get(id)), TUNING.expert.book.ahead])
  let seen = BOOK_READS.get(combos)
  if (!seen || seen.size >= 4096) BOOK_READS.set(combos, (seen = new Map()))
  let read = seen.get(key)
  if (read) return read
  let value = 0
  let target = null
  let most = 0
  for (const c of combos) {
    const v = comboWorth(s, c, work, bled) * comboProgress(s, c, counts, best)
    value = Math.max(value, v)
    if (v > most) { most = v; target = c }
  }
  seen.set(key, (read = { value, target }))
  return read
}
// The kinds a target is built of (its parts, its tracks').
const targetKinds = (c) => new Set([...Object.keys(c?.needs ?? {}), ...Object.keys(c?.tracks ?? {})])
// The kinds a soul let go to make room is never of while another will do: its target's, and a strict archetype's.
function keptKinds (s, L) {
  const keeps = L.book ? targetKinds(targetOf(s)) : new Set()
  if (COMMIT?.strict) for (const id of COMMIT.strict.kinds) keeps.add(id)
  return keeps
}

// ── reap ─────────────────────────────────────────────────────────────────────────────────────────

// The one recruit a battle allows: basic's (recruit), the expert's (weighRecruits) or the forest's (recruitPick).
export function pickReap (run, L, sit) {
  const s = run.state
  // The strict commitment first, where it decides (strictRecruit).
  const strict = L.spend ? strictRecruit(run, L)?.pick : undefined
  if (strict !== undefined) {
    if (!strict) return { type: 'reap', index: null }
    if (strict.release != null && soulCount(s.party) >= rosterCap(run)) return { type: 'release', uid: strict.release }
    return { type: 'reap', index: strict.index }
  }
  if (L.spend && outDecides('recruit')) {
    const actions = recruitPick(run, L, sit)
    const release = actions.find((a) => a.type === 'release')
    if (release && soulCount(s.party) >= rosterCap(run)) return release
    return actions.find((a) => a.type === 'reap')
  }
  if (L.spend) {
    const pick = weighRecruits(run, L, sit)
    if (!pick) return { type: 'reap', index: null }
    if (pick.release != null && soulCount(s.party) >= rosterCap(run)) return { type: 'release', uid: pick.release }
    return { type: 'reap', index: pick.index }
  }
  const index = recruit(run)
  if (index === null || soulCount(s.party) < rosterCap(run)) return { type: 'reap', index }
  // Never the last soul standing: with every other soul fallen, the recruit is passed over.
  const spare = (u) => souls(s.party).some((x) => x !== u && x.hp > 0)
  const weakest = inOssuary(s.party).filter(spare).sort(L.wounds ? byFieldPower : byPower).at(-1)
  return weakest ? { type: 'release', uid: weakest.uid } : { type: 'reap', index: null }
}

// The expert's recruit by the sketch: each soul it can afford (a full retinue letting its weakest in the ossuary go, of
// no kind it keeps), or a fusion it would complete; the best that beats keeping, or none. → { index, release? } or null
const recruits = new WeakMap()
export function weighRecruits (run, L, sit = null) {
  const s = run.state
  // Once a room, for the offers it has (a release leaves them as they were; a recruit takes the souls away).
  const key = JSON.stringify([s.floor, s.at, s.offers.map((o) => o.id)])
  if (recruits.get(run)?.key === key) return recruits.get(run).pick
  const spare = (u) => souls(s.party).some((x) => x !== u && x.hp > 0)
  const keeps = keptKinds(s, L)
  const weakest = inOssuary(s.party).filter(spare).sort((a, b) => keeps.has(b.id) - keeps.has(a.id) || byFieldPower(a, b)).at(-1)
  const base = sketch(s, L)
  let pick = null
  let best = KEEP()
  for (const [index, o] of s.offers.entries()) {
    if (o.cost > s.essence) continue
    const sim = fork(run)
    const full = soulCount(s.party) >= rosterCap(run)
    if (full && !weakest) continue
    if (full) apply(sim, { type: 'release', uid: weakest.uid })
    apply(sim, { type: 'reap', index })
    if (audited(run)) note('considered', 'recruit')
    // What it adds to the sketch, or what a fusion it completes would (one the purse is short of: growth.later of it).
    const gain = Math.max(sketch(sim.state, L), ...completes(sim, L, true).map((x) => base + (sketch(x.state, L) - base) * (x.later ? TUNING.expert.growth.later : 1))) - base
    if (gain > best) {
      best = gain
      pick = { index, ...(full && { release: weakest.uid }) }
    }
  }
  recruits.set(run, { key, pick })
  noteRule(run, 'reap', { by: 'weights' }, sit && surveyLine(sit))
  if (pick && audited(run)) note('done', 'recruit')
  return pick
}

// The retinue after each fusion L may make on copy `sim`; with `later`, also those the purse is short of, marked `later`.
function completes (sim, L, later = false) {
  const map = { ...sim, state: { ...sim.state, phase: 'map' } }
  const out = fusionOptions(map, L).map((a) => {
    const next = fork(map)
    apply(next, a)
    return next
  })
  if (!later || !L.fuse || L.ablate === 'fusions') return out
  for (const r of FUSION_LIST) {
    if (!mayFuse(r.id) || canFuse(map, r.id) || fuseParts(map, r.id) === null) continue
    const next = fork(map)
    next.state.essence = fuseCost(map, r.id)
    apply(next, { type: 'fuse', id: r.id, parts: fuseParts(map, r.id) })
    next.later = true
    out.push(next)
  }
  return out
}

// What saving for a fusion is worth (grow's `save`): the most the sketch gains from one the purse is short of.
export function saving (run, L) {
  const base = sketch(run.state, L)
  return Math.max(0, ...completes(fork(run), L, true).filter((x) => x.later).map((x) => sketch(x.state, L) - base))
}

// A pick of the draft: basic the first offered of a kind it lacks, else the first; the expert the offer the sketch values
// most, among the ranged kinds offered while it holds fewer than TUNING.expert.draft.ranged ranged pieces.
export function pickDraft (run, L) {
  const s = run.state
  const offer = s.draft.offer
  if (!L.spend) {
    const fresh = offer.findIndex((id) => !souls(s.party).some((u) => u.id === id))
    return { type: 'pick', index: Math.max(0, fresh) }
  }
  const ranged = (id) => !meleeOnly(makeUnit(id, { lvl: 1 }))
  // Under the strict commitment, its archetype's kinds alone where the pick offers one.
  const st = COMMIT?.strict
  const allowed = st && offer.some((id) => st.kinds.has(id)) ? (id) => st.kinds.has(id) : () => true
  const short = souls(s.party).filter((u) => !meleeOnly(u)).length < TUNING.expert.draft.ranged && offer.some((id) => allowed(id) && ranged(id))
  let best = { index: 0, worth: -Infinity }
  for (const index of offer.keys()) {
    if (!allowed(offer[index])) continue
    if (short && !ranged(offer[index])) continue
    const sim = fork(run)
    apply(sim, { type: 'pick', index })
    const worth = sketch(sim.state, L)
    if (worth > best.worth) best = { index, worth }
  }
  return { type: 'pick', index: best.index }
}

// Basic's recruit: while the field has room, the highest tier it can afford (the first offered among equals).
function recruit (run) {
  const s = run.state
  if (standing(souls(s.party)).length >= fieldCap(run)) return null
  const affordable = s.offers.flatMap((o, index) => (o.cost <= s.essence ? [{ o, index }] : []))
  return affordable.sort((a, b) => unitDef(b.o.id).tier - unitDef(a.o.id).tier || a.index - b.index)[0]?.index ?? null
}

// The state a purchase would make, for the sketch: a relic owned (an HP relic's Monarch raised, and healed unless nothing
// may heal it), or soul `o.uid` alone with a tier more on track `o.track` (afterTier). Only what changes: { relics?, party? }
export function offerState (s, o) {
  if (o.type === 'relic') {
    const relics = [...s.relics, o.id]
    const gain = monarchHp({ ...s, relics }) - monarchHp(s)
    if (!gain) return { relics }
    const heal = !unhealed({ relics })
    return { relics, party: s.party.map((u) => (isMonarch(u) ? { ...u, maxHp: monarchHp({ ...s, relics }), hp: u.hp + (heal ? gain : 0) } : u)) }
  }
  if (o.type !== 'tier') return {}
  return { party: s.party.map((u) => (u.uid === o.uid ? afterTier(u, o.track) : u)) }
}

// ── the Shop ─────────────────────────────────────────────────────────────────────────────────────

// The Shop's shelf, met on the map: basic buys the first Command relic it can pay for, then gives a piece relic waiting
// to the first fielded soul holding none; the expert gives (pickHold), then buys (buyFor). → a buy, a hold, or null
function pickShop (run, L, sit) {
  if (L.spend) return pickHold(run, L, sit) ?? buyFor(run, L, sit)
  const s = run.state
  const index = s.shop.findIndex((id, i) => id && gives(relicDef(id), 'run.command') && !banned(L, id) && canBuy(run, i))
  if (index >= 0) return { type: 'buy', index }
  const relic = unheld(s)[0]
  const holder = relic && souls(s.party).find((u) => u.slot >= 0 && u.hp > 0 && !u.relics?.length && canHold(s, relic, u))
  return holder ? { type: 'hold', relic, uid: holder.uid } : null
}

// What the expert buys: the relic whose sketch (held) gains most per essence, past a tier's (tierRate). → a buy, or null
export function buyFor (run, L, sit = null) {
  const s = run.state
  // Nothing on the shelf it may pay for: no sketch to read.
  if (!s.shop.some((id, index) => id && !banned(L, id) && canBuy(run, index))) return null
  const base = sketch(s, L)
  const bar = tierRate(run, L, base)
  let pick = null
  let most = bar
  for (const [index, id] of s.shop.entries()) {
    if (!id || banned(L, id) || !canBuy(run, index)) continue
    const gain = held({ ...s, ...offerState(s, { type: 'relic', id }) }, id, L) - base
    const rate = gain / relicPrice(run, id)
    if (gain > KEEP() && rate > most) { most = rate; pick = { type: 'buy', index } }
  }
  noteRule(run, 'buy', { by: 'weights' }, sit && surveyLine(sit))
  return pick
}

// The sketch of `s` owning relic `id`, a piece relic held by the standing soul it raises most.
export function held (s, id, L) {
  let best = sketch(s, L)
  if (isRunRelic(id)) return best
  for (const u of standing(souls(s.party))) {
    if (u.relics?.includes(id)) continue
    const relics = [...(u.relics ?? []).slice(Math.max(0, (u.relics?.length ?? 0) - TUNING.relic.perPiece + 1)), id]
    best = Math.max(best, sketch({ ...s, party: s.party.map((x) => (x === u ? { ...x, relics } : x)) }, L))
  }
  return best
}

// The best sketch gain per essence among the souls' next tiers (each also with the one after it); 0 for none.
export function tierRate (run, L, base) {
  const s = run.state
  if (L.ablate === 'tracks') return 0
  let best = 0
  for (const { uid } of souls(s.party)) {
    for (const track of [0, 1]) {
      let st = s
      let cost = 0
      for (let k = 0, u; k < 2 && canAdvance(st, (u = st.party.find((x) => x.uid === uid)), track); k++) {
        cost += tierCost({ state: st }, u, track)
        st = { ...st, ...offerState(st, { type: 'tier', uid, track }) }
        best = Math.max(best, (sketch(st, L) - base) / cost)
      }
    }
  }
  return best
}

// The expert's relics in hand: a fallen soul's given back, then each waiting where the sketch says it is worth most.
export function pickHold (run, L, sit) {
  const s = run.state
  const fallen = souls(s.party).find((u) => u.hp <= 0 && u.relics?.length)
  if (fallen) return { type: 'unhold', uid: fallen.uid }
  const ids = [...new Set(unheld(s))]
  if (!ids.length) return null
  const options = ids.flatMap((relic) => standing(souls(s.party)).filter((u) => canHold(s, relic, u)).map((u) => ({ type: 'hold', relic, uid: u.uid })))
  return grow(run, L, options, 'hold', sit)
}

// ── the altar ────────────────────────────────────────────────────────────────────────────────────

// An altar's rites: basic heals; the expert weighs each as a purchase (grow) and heals where none beats keeping.
export function altarOptions (run, L) {
  return altarActions(run).filter((a) => (a.type !== 'consecrate' || L.ablate !== 'tracks') && !strictBars(run, a))
}
// Whether the strict commitment bars rite `a`: a transmutation of a soul of its kinds into one not of them.
function strictBars (run, a) {
  const st = COMMIT?.strict
  if (!st || a.type !== 'transmute') return false
  const u = run.state.party.find((x) => x.uid === a.uid)
  return st.kinds.has(u.id) && !st.kinds.has(transmuteOffer(run.state, u.id)[a.index])
}
const HEAL = Object.freeze({ type: 'heal' })
export function pickAltar (run, L, sit = null) {
  if (!L.spend) return { ...HEAL }
  return grow(run, L, altarOptions(run, L), 'altar', sit ?? survey(run, L)) ?? { ...HEAL }
}
// A rite in words, for the candidates' labels ("transmute 7 frost_sprite into will_o_wisp").
function riteLabel (run, a) {
  const u = run.state.party.find((x) => x.uid === a.uid)
  if (a.type !== 'transmute') return a.type === 'consecrate' ? `consecrate ${a.uid} ${u.id} ${a.track}` : a.type
  return `transmute ${a.uid} ${u.id} into ${transmuteOffer(run.state, u.id)[a.index]}`
}

// ── the forest out of battle ─────────────────────────────────────────────────────────────────────

// The recruit and the purchases are today's (weighRecruits, grow) unless a forest out of battle decides them: then it
// reads today's pick and the next best, at most OUT_CAP (outsideRead), and takes its own past its margin (chooseOut).
const OUT_CAP = 6
// What names a candidate: the action it takes (null: stopping), or for a recruit its actions.
const outId = (x) => JSON.stringify(x ?? null)

// `own` first, then the rest of `cands` by score, the higher first (stable), at most `cap`.
export function rankCandidates (cands, own, cap = OUT_CAP) {
  const base = cands.find((x) => x.id === own)
  if (!base) throw new Error(`the pick ${own} is no candidate`)
  const rest = cands.filter((x) => x !== base).map((x, i) => ({ x, i })).sort((a, b) => b.x.score - a.x.score || a.i - b.i).map((e) => e.x)
  return [base, ...rest].slice(0, cap)
}

// The candidates the forest reads of decision `d`: rankCandidates', and passing on (`d.cands[0]`) where not among them.
export function outCandidates (d, cap = OUT_CAP) {
  const list = rankCandidates(d.cands, d.today, cap)
  if (!list.includes(d.cands[0])) list.push(d.cands[0])
  return list
}

// A purchase's candidates: stopping, then each tier and fusion the purse affords, with grow's score (a tier the better of
// it alone and with the next); null with nothing to buy. → { today, cands: [{ id, label, actions, score }] }
export function spendCandidates (run, L, sit = null) {
  const actions = [...fusionOptions(run, L), ...spendOptions(run, L)]
  if (!actions.length) return null
  const today = grow(run, L, actions, 'spend', sit)
  const { scores } = growths.get(run).spend
  const label = (a) => (a.type === 'fuse' ? `fuse ${a.id}` : `tier ${a.uid} ${run.state.party.find((u) => u.uid === a.uid).id} ${a.track}`)
  return {
    today: outId(today),
    cands: [{ id: outId(null), label: 'stop', actions: [], score: scores.get(outId(null)) }, ...actions.map((a) => ({ id: outId(a), label: label(a), actions: [a], score: scores.get(outId(a)) }))]
  }
}

// The recruit's candidates: none, and each soul the purse affords, by what it adds to the sketch. → { today, cands }
export function recruitCandidates (run, L, sit = null) {
  const s = run.state
  const strict = L.spend ? strictRecruit(run, L) : undefined
  if (strict !== undefined) return strictCandidates(strict)
  const pick = weighRecruits(run, L, sit)
  const full = soulCount(s.party) >= rosterCap(run)
  const keeps = keptKinds(s, LEVELS.expert)
  const spare = (u) => souls(s.party).some((x) => x !== u && x.hp > 0)
  const weakest = inOssuary(s.party).filter(spare).sort((a, b) => keeps.has(b.id) - keeps.has(a.id) || byFieldPower(a, b)).at(-1)
  const none = { type: 'reap', index: null }
  const sk = sketch(s, L)
  const cands = [{ id: outId([none]), label: 'none', actions: [none], score: KEEP() }]
  for (const [index, o] of s.offers.entries()) {
    if (o.cost > s.essence || (full && !weakest)) continue
    const actions = [...(full ? [{ type: 'release', uid: weakest.uid }] : []), { type: 'reap', index }]
    const sim = lightFork(run)
    for (const a of actions) apply(sim, a)
    cands.push({ id: outId(actions), label: `recruit ${o.id}`, actions, score: sketch(sim.state, L) - sk })
  }
  const own = pick === null ? [none] : [...(pick.release != null && full ? [{ type: 'release', uid: pick.release }] : []), { type: 'reap', index: pick.index }]
  return { today: outId(own), cands }
}

// The strict recruit's options as candidates, with none unless it is forced or no other is left. → { today, cands }
function strictCandidates ({ pick, forced, options }) {
  const none = { type: 'reap', index: null }
  const cands = options.map((o) => ({ id: outId(o.actions), label: `recruit ${o.kind}`, actions: o.actions, score: o.gain }))
  if (!forced || !cands.length) cands.unshift({ id: outId([none]), label: 'none', actions: [none], score: KEEP() })
  const own = pick ? options.find((o) => o.index === pick.index).actions : [none]
  return { today: outId(own), cands }
}

// An altar's candidates: each rite the expert may take, scored by what it adds to the sketch; today's pick pickAltar's.
export function altarCandidates (run, L, sit = null) {
  const today = pickAltar(run, L, sit)
  const sk = sketch(run.state, L)
  const cands = altarOptions(run, L).map((a) => {
    const sim = lightFork(run)
    apply(sim, a)
    return { id: outId(a), label: riteLabel(run, a), actions: [a], score: sketch(sim.state, L) - sk }
  })
  return { today: outId(today), cands }
}

// A copy of the run to read a candidate on, sharing its log and its floor's map (no candidate touches them).
function lightFork (run) {
  const { log, map, ...rest } = run.state
  return { state: { ...copyPlain(rest), map, log: [] }, battle: null, setup: null }
}

// The battle rooms the run walks into next: the room in prep, then those the route would walk (at most `n`); the rooms on
// to its first Shop and altar; the floor's still ahead. → { next: [node], floor: [node], shop, altar }
function roomsAhead (run, L, sit, n = 3) {
  const s = run.state
  const here = currentNode(run)
  const next = s.phase === 'prep' && here?.foes ? [here] : []
  let at = s.at
  let shop = null
  let altar = null
  for (let step = 1; next.length < n && step <= RANKS; step++) {
    const ids = nodeOf(s.map, at)?.next ?? []
    if (!ids.length) break
    const id = ids.length > 1 ? routeStep(run, L, sit, at) : ids[0]
    const room = nodeOf(s.map, id)
    if (room.foes) next.push(room)
    if (room.type === 'shop') shop ??= step
    if (room.type === 'altar') altar ??= step
    at = id
  }
  const rank = here?.rank ?? 0
  const floor = s.map.nodes.filter((x) => x.foes && (x.rank > rank || (s.phase === 'prep' && x === here)))
  return { next, floor, shop, altar }
}
// The room the expert's route would walk into from room `at`, the army as it stands (nothing noted in the audit).
function routeStep (run, L, sit, at) {
  const s = run.state
  const stood = { state: { ...s, at, phase: 'map' }, battle: null, setup: null }
  const up = standing(souls(s.party))
  const keeps = targetKinds(L.book ? targetOf(s) : null)
  const rooms = nodeOf(s.map, at).next.map((id) => scoutRoom(stood, nodeOf(s.map, id), up, keeps))
  const view = { ...sit, rank: nodeOf(s.map, at).rank, phase: 'map', rooms }
  const model = routeModel()
  if (model) return learnedRoute(model, stood, view).option.node.id
  return decide(TREES.route, view, rooms.map((room) => ({ node: nodeOf(s.map, room.id), v: roomFeatures(view, room) })), TUNING.expert.route).option.node.id
}

// A battle room as scouting shows it, once a room: its foes' worth, count, mean HP, DEF and blow, threat shares, waves.
const roomReads = new Map()
function roomRead (s, room) {
  const key = JSON.stringify([s.floor, room.id, room.type, room.foes, room.waves?.map((w) => w.foes), s.scale, s.ascension])
  let r = roomReads.get(key)
  if (r) return r
  const foes = [...(room.foes ?? []), ...(room.waves ?? []).flatMap((w) => w.foes)]
  const mods = foeMods(s.floor, room.type === 'boss', foeScale(s))
  const t = Object.fromEntries(OUT_THREATS.map((k) => [k, 0]))
  let threat = 0
  let hp = 0
  let def = 0
  let raw = 0
  for (const f of foes) {
    const u = makeUnit(f.id, { lvl: f.lvl })
    const st = statsOf(u, mods)
    threat += worth(u, false, mods)
    hp += st.hp
    def += st.def
    raw += punch(u, mods)
    for (const k of unitDef(f.id).threats ?? []) if (k in t) t[k]++
  }
  const n = Math.max(1, foes.length)
  for (const k of OUT_THREATS) t[k] /= n
  r = { threat, foes: foes.length, hp: hp / n, def: def / n, raw: raw / n, waves: room.waves?.length ?? 0, type: room.type, t }
  if (roomReads.size > 5000) roomReads.clear()
  roomReads.set(key, r)
  return r
}

// The threats of rooms `reads` the field `f` has no answer to: flyers, shooters, and hexes, burns and bleeds; the mean.
const gapOf = (reads, f) => (reads.length ? reads.reduce((n, r) => n + r.t.fly * (f.fly === 0) + r.t.reach * (f.reach === 0) + (r.t.drain + r.t.burn + r.t.bleed) * (f.tend === 0), 0) / reads.length : 0)

// The field a state would fight with, read (FIELD_KEYS) over its fieldable best, at most the Command:
//   strength, book, progress         its strength (a log); its target's book worth, and how far along it is
//   fly, reach, tend                 souls that answer flyers, shooters, and hexes and wounds
//   ranged, melee, flyers, healers   its shooters, its melee alone, its flyers, its menders
//   dps, tough                       its blows' raw and its toughness, as logs
//   syn, near                        its synergies held; of the nearest not held, the share of its needs met
//   summons, lvl, kin, role          its summons; its mean level; the most souls of one kin and of one role
// → { f, best, target (its id), up (the souls standing) }
function fieldRead (s, L) {
  const up = standing(souls(s.party))
  const best = up.map((u) => ({ u, p: worth(u, L.ablate !== 'summons') * Math.sqrt(hpPct(u)) })).sort((a, b) => b.p - a.p).slice(0, fieldCap({ state: s })).map((x) => x.u)
  const target = L.book ? targetOf(s) : null
  const f = zeros(FIELD_KEYS)
  f.strength = Math.log(strength(s, L.ablate !== 'summons'))
  f.book = target ? comboWorth(s, target) * comboProgress(s, target) : 0
  f.progress = target ? comboProgress(s, target) : 0
  const kins = {}
  const roles = {}
  let lvl = 0
  for (const u of best) {
    const d = unitDef(u.id)
    const kit = kitOf(u)
    if (ANSWERS.fly(u)) f.fly++
    if (ANSWERS.reach(u)) f.reach++
    if (tends(u)) {
      f.tend++
      f.healers++
    }
    if (kit.some((a) => isBlow(a) && !a.melee)) f.ranged++
    if (meleeOnly(u)) f.melee++
    if (d.flies) f.flyers++
    f.dps += punch(u)
    f.tough += tough(u)
    f.summons += summonsOf(u)
    lvl += u.lvl
    kins[d.kin] = (kins[d.kin] ?? 0) + 1
    roles[d.role] = (roles[d.role] ?? 0) + 1
  }
  f.dps = Math.log(1 + f.dps)
  f.tough = Math.log(1 + f.tough)
  f.lvl = best.length ? lvl / best.length : 0
  f.kin = Math.max(0, ...Object.values(kins))
  f.role = Math.max(0, ...Object.values(roles))
  if (!s.ablate?.includes('synergies')) {
    const pieces = best.flatMap(withSummons)
    const held = activeSynergies(pieces)
    f.syn = held.length
    const c = synergyCounts(pieces)
    for (const syn of SYNERGIES) {
      if (held.includes(syn)) continue
      for (const axis of ['kin', 'role']) for (const [id, k] of Object.entries(syn.needs[axis] ?? {})) f.near = Math.max(f.near, Math.min(1, (c[axis][id] ?? 0) / k))
    }
  }
  return { f, best, target: target?.id ?? null, up: up.length }
}

// The soul a candidate touches, at its level and tiers after it (k.*): its role, whether it flies, shoots, fights in
// melee alone, tends or gives an aura; its reach, tier, level, HP, ATK, DEF, Move, worth (a log) and footprint.
function soulRead (v, out) {
  const u = makeUnit(v.id, { lvl: v.lvl, tracks: v.tracks })
  const d = unitDef(v.id)
  const st = statsOf(u)
  if (OUT_ROLES.includes(d.role)) put(out, `k.${d.role}`, 1)
  put(out, 'k.flies', !!d.flies)
  put(out, 'k.ranged', kitOf(u).some((a) => isBlow(a) && !a.melee))
  put(out, 'k.melee', meleeOnly(u))
  put(out, 'k.tends', tends(u))
  put(out, 'k.aura', !!auraOf(u))
  put(out, 'k.reach', reachOf(u))
  put(out, 'k.tier', d.tier)
  put(out, 'k.lvl', u.lvl)
  put(out, 'k.hp', st.hp)
  put(out, 'k.atk', st.atk)
  put(out, 'k.def', st.def)
  put(out, 'k.move', st.move)
  put(out, 'k.worth', Math.log(1 + worth(u)))
  put(out, 'k.size', sizeOf(u))
  return u
}

// How well soul `u` answers the rooms' threats: flyers if it strikes one, shooters if it shoots, the rest if it tends.
const fitOf = (reads, u) => (reads.length ? reads.reduce((n, r) => n + r.t.fly * ANSWERS.fly(u) + r.t.reach * ANSWERS.reach(u) + (r.t.drain + r.t.burn + r.t.bleed) * tends(u), 0) / reads.length : 0)

// The reads the forest out of battle decides a recruit or a purchase by (SIT_KEYS, CAND_KEYS), of decision `phase` over
// `cands` (today's pick first); no battle played, every number rounded (put). → { sit, f: [per candidate] }
// The situation:
//   phase.*, floor, rank             where the run stands
//   purse, purse.tier, purse.recruit the essence in tier prices, and over the cheapest next tier and recruit
//   monarch, monarch.hp              the Monarch's HP share, its HP
//   health, fallen, souls            the souls' HP share, the fallen, those standing
//   room, command, waiting           room left in the retinue; the field cap; the souls in the ossuary
//   relics, unheld, cands            the relics owned and waiting; the candidates
//   shop, altar                      1 / (1 + the rooms on to the next), 0 for none (shop always 0)
//   FIELD_KEYS                       the field's read (fieldRead)
//   n1.*, n3.*, fl.*                 the next battle room, the next three, the floor's still ahead (roomRead): rooms,
//                                    threat, odds (the least; fl's the mean), foes, hp, def, raw, waves, t.<type>, gap
//   n1.elite, n1.boss, n1.siege      the next battle room's type
// Each candidate, its actions applied to a copy (candidateRead):
//   score, cost, none                today's score; its cost in tier prices; a recruit of none or stopping
//   tier, t.*                        a tier: its track and number, what it grants, `double` with the next
//   fuse, u.*                        a fusion: its parts, their worth, its gain, those fielded
//   recruit, r.*                     a recruit: of a kind none holds; a release, the soul let go's worth, of a kept kind
//   k.*, fit.*                       the soul it touches (soulRead), and of its kind how many stand, fielded, the
//                                    target's; fitOf
//   d.*                              the field's read of the state it leaves less this one's
export function outsideRead (run, L, sit, phase, cands) {
  sit ??= survey(run, L)
  const s = run.state
  const scale = tierScale(s.floor)
  const ahead = roomsAhead(run, L, sit)
  const reads = { n1: ahead.next.slice(0, 1).map((r) => roomRead(s, r)), n3: ahead.next.map((r) => roomRead(s, r)), fl: ahead.floor.map((r) => roomRead(s, r)) }
  const was = fieldRead(s, L)
  const x = zeros(SIT_KEYS)
  put(x, `phase.${s.phase}`, 1)
  put(x, 'floor', s.floor)
  put(x, 'rank', sit.rank)
  put(x, 'purse', s.essence / scale)
  put(x, 'purse.tier', sit.prices.tier ? s.essence / sit.prices.tier : 0)
  put(x, 'purse.recruit', sit.prices.recruit ? s.essence / sit.prices.recruit : 0)
  put(x, 'monarch', sit.monarch)
  put(x, 'monarch.hp', Math.max(0, monarchOf(s).hp))
  put(x, 'health', sit.health)
  put(x, 'fallen', sit.fallen)
  put(x, 'souls', was.up)
  put(x, 'room', rosterCap(run) - soulCount(s.party))
  put(x, 'command', sit.command)
  put(x, 'waiting', sit.waiting)
  put(x, 'relics', s.relics.length)
  put(x, 'unheld', sit.relics.unheld.length)
  put(x, 'cands', cands.length)
  // Always 0, for no room is a Shop: kept for the forest's columns.
  put(x, 'shop', ahead.shop === null ? 0 : 1 / (1 + ahead.shop))
  put(x, 'altar', ahead.altar === null ? 0 : 1 / (1 + ahead.altar))
  for (const k of FIELD_KEYS) put(x, k, was.f[k])
  const odds = (r) => was.f.strength - Math.log(Math.max(1e-9, r.threat))
  for (const set of OUT_ROOMS) {
    const R = reads[set]
    if (!R.length) continue
    const mean = (g) => R.reduce((n, r) => n + g(r), 0) / R.length
    put(x, `${set}.rooms`, R.length)
    put(x, `${set}.threat`, Math.log(Math.max(1e-9, mean((r) => r.threat))))
    put(x, `${set}.odds`, set === 'fl' ? mean(odds) : Math.min(...R.map(odds)))
    for (const k of ['foes', 'hp', 'def', 'raw', 'waves']) put(x, `${set}.${k}`, mean((r) => r[k]))
    for (const t of OUT_THREATS) put(x, `${set}.t.${t}`, mean((r) => r.t[t]))
    put(x, `${set}.gap`, gapOf(R, was.f))
  }
  if (reads.n1.length) for (const type of ['elite', 'boss', 'siege']) put(x, `n1.${type}`, reads.n1[0].type === type)
  const f = cands.map((c) => candidateRead(run, L, c, reads, was, scale))
  return { sit: x, f }
}

// One candidate's read (outsideRead's), against `was` (the decision's field read).
function candidateRead (run, L, cand, reads, was, scale) {
  const s = run.state
  const out = zeros(CAND_KEYS)
  const acts = cand.actions.filter((a) => !(a.type === 'reap' && a.index === null))
  let st = s
  let sim = null
  if (acts.length) {
    sim = lightFork(run)
    for (const a of acts) apply(sim, a)
    st = sim.state
  }
  put(out, 'score', cand.score)
  put(out, 'cost', (s.essence - st.essence) / scale)
  const main = acts.find((a) => a.type !== 'release')
  // The soul it touches, as it stands after: the one tiered, the fused, the recruit.
  const joined = () => st.party.find((u) => !s.party.some((x) => x.uid === u.uid))
  let soul = null
  if (!main) put(out, 'none', 1)
  else if (main.type === 'upgrade') {
    put(out, 'tier', 1)
    soul = st.party.find((u) => u.uid === main.uid)
    const no = soul.tracks[main.track]
    const tier = tracksOf(soul.id)[main.track].tiers[no - 1]
    put(out, 't.track', main.track)
    put(out, 't.no', no)
    put(out, 't.mods', !!tier.mods?.length)
    put(out, 't.ability', !!tier.ability)
    put(out, 't.aura', !!tier.aura)
    put(out, 't.summon', tier.summon ?? 0)
    put(out, 't.size', !!tier.size)
    put(out, 't.double', nextTier(sim, main))
  } else if (main.type === 'fuse') {
    put(out, 'fuse', 1)
    soul = joined()
    const parts = main.parts.map((uid) => s.party.find((u) => u.uid === uid))
    const sum = parts.reduce((n, u) => n + worth(u), 0)
    put(out, 'u.parts', parts.length)
    put(out, 'u.worth', Math.log(1 + sum))
    put(out, 'u.gain', Math.log(1 + (soul ? worth(soul) : 0)) - Math.log(1 + sum))
    put(out, 'u.fielded', parts.filter((u) => was.best.includes(u)).length)
  } else if (main.type === 'reap') {
    put(out, 'recruit', 1)
    soul = joined()
    const id = s.offers[main.index].id
    put(out, 'r.new', !souls(s.party).some((u) => u.id === id))
    const release = acts.find((a) => a.type === 'release')
    if (release) {
      const u = s.party.find((x) => x.uid === release.uid)
      const mean = was.best.reduce((n, x) => n + fieldPower(x), 0) / Math.max(1, was.best.length)
      put(out, 'r.release', 1)
      put(out, 'r.released', mean > 0 ? fieldPower(u) / mean : 0)
      put(out, 'r.kept', targetKinds(L.book ? targetOf(s) : null).has(u.id))
    }
  }
  if (soul) {
    const kind = soul.id
    const u = soulRead(soul, out)
    const target = L.book ? targetOf(s) : null
    put(out, 'k.count', standing(souls(st.party)).filter((x) => x.id === kind).length)
    put(out, 'k.fielded', was.best.filter((x) => x.id === kind).length)
    put(out, 'k.target', targetKinds(target).has(kind))
    for (const set of OUT_ROOMS) put(out, `fit.${set}`, fitOf(reads[set], u))
  }
  const now = sim ? fieldRead(st, L) : was
  for (const k of ['strength', 'book', 'progress', 'fly', 'reach', 'tend', 'ranged', 'melee', 'flyers', 'healers', 'dps', 'tough', 'syn', 'near', 'summons', 'lvl']) put(out, `d.${k}`, now.f[k] - was.f[k])
  put(out, 'd.target', now.target !== was.target)
  put(out, 'd.souls', now.up - was.up)
  put(out, 'd.purse', (st.essence - s.essence) / scale)
  for (const set of OUT_ROOMS) put(out, `d.gap.${set}`, gapOf(reads[set], now.f) - gapOf(reads[set], was.f))
  return out
}

// The candidate the expert takes at `phase` (today's first): the forest's where it decides and reads it past its margin.
function outChoice (run, L, sit, phase, cands) {
  const model = outForestModel()
  if (cands.length < 2 || !model?.phases?.[phase]) return cands[0]
  const read = phase === 'prep' ? prepRead(run, L, sit, cands, { boards: opensBoard(model.phases.prep) }) : outsideRead(run, L, sit, phase, cands)
  const pick = chooseOut(model, phase, read)
  if (pick.index > 0) noteRule(run, phase, { by: 'outforest' }, sit && surveyLine(sit))
  return cands[pick.index]
}

// ── the formation by the forest out of battle ────────────────────────────────────────────────────

// The formations a prep's forest reads (prepCandidates), and the places among them its drafts may take.
export const PREP_CAP = 9
const PREP_DRAFTS = 3
// What names a formation: the cells its pieces take (the Monarch's among them), whoever waits in the ossuary aside.
export const formationName = (party) => party.filter((u) => u.slot >= 0).map((u) => `${u.uid}@${u.slot}`).sort().join()
// Today's order of the formations a plan met: the tree's filters' standing, first to last, then the static score.
function byStanding (a, b) {
  for (let i = 0; i < a.keys.length; i++) if (a.keys[i] !== b.keys[i]) return b.keys[i] - a.keys[i]
  return b.score - a.score
}

// The formations a prep's forest reads, at most `cap`: today's pick first, then the plan's others in today's order to
// `cap` less `drafts`, then its best drafts not among them (formations of another shape), then today's order again.
// → { today, cands: [{ id (formationName), label, goal: [{ uid, slot }], party, v, keys, score, draft, rank }] }
export function prepCandidates (run, L, made = plan(run, L), { cap = PREP_CAP, drafts = PREP_DRAFTS } = {}) {
  const today = formationName(made.party)
  const order = made.met.slice().sort(byStanding)
  const own = made.met.find((c) => formationName(c.party) === today)
  if (!own) throw new Error('the plan\'s formation is none it met')
  const list = [own]
  const seen = new Set([today])
  const fill = (to, keep = () => true) => {
    for (const c of order) {
      if (list.length >= to) break
      if (keep(c) && !seen.has(formationName(c.party))) {
        seen.add(formationName(c.party))
        list.push(c)
      }
    }
  }
  fill(cap - drafts)
  fill(cap, (c) => c.draft)
  fill(cap)
  return {
    today,
    cands: list.map((c, i) => ({
      id: formationName(c.party), label: i ? `formation ${i}${c.draft ? ' (a draft)' : ''}` : 'formation', goal: c.party.map((u) => ({ uid: u.uid, slot: u.slot })),
      party: c.party, v: c.v, keys: c.keys, score: c.score, draft: c.draft, rank: i
    }))
  }
}

// The expert's formation from plan `made`: its own, or the forest's where one decides the prep (never under the ablation).
function prepPick (run, L, made, sit) {
  if (!L.search || L.ablate === 'formation' || !outDecides('prep')) return made.party
  return outChoice(run, L, sit, 'prep', prepCandidates(run, L, made).cands).party
}

// The board formation `party` opens the coming battle on, no turn played, read as the battle reads a board (conditions).
const openingOf = (run, party) => conditions(situation(createBattle({ ...battleSetup(run, { party: party.filter((u) => u.slot >= 0) }), quiet: true }), { short: true }))

// The reads the forest out of battle decides a formation by (PREP_SIT_KEYS, PREP_CAND_KEYS), over `cands` (today's
// pick first); nothing read of where a soul stands now, no battle played, every number rounded (put). Without `boards`
// no opening board is made and the o.* reads stay 0. → { sit, f: [per formation] }
// The situation:
//   floor, rank, elite, boss, siege  where the run stands; the room's type
//   monarch, monarch.hp, health, fallen, souls, command, cands   as outsideRead's
//   field.*                          the field's read (fieldRead)
//   room.*                           the coming battle (roomRead): threat, odds, foes, hp, def, raw, waves, t.<type>, gap
//   scout.*                          its flyers, shooters (reach 2+), farthest reach, raw of all and of the shooters
//                                    on the Monarch's HP, boss, mean ground road, the threat map's mass
//   camp.open, camp.gate             the camp's open cells; its gate's
//   o.*                              the opening board on today's pick (OPENING_ROOM_KEYS)
// Each formation (formationRead):
//   score, rank, draft               today's score; its place in the list; a draft or the climb's
//   v.*                              formationFeatures'
//   moved, swapped                   pieces moved; souls fielded in place of today's
//   seat1, seat2, front, row         pieces beside and near the seat, in the front row; the mean row
//   lanes, big, gate                 the lanes held; the 2×2 fielded; the gate's cells held
//   shooters, melee, flyers, menders by kind
//   wounded, hp                      pieces under half HP; the mean HP share
//   o.*                              the board it opens on (OPENING_KEYS)
export function prepRead (run, L, sit, cands, { boards = true } = {}) {
  sit ??= survey(run, L)
  const s = run.state
  const node = currentNode(run)
  const was = fieldRead(s, L)
  const room = roomRead(s, node)
  const foes = scout(run)
  const m = monarchOf(s)
  const x = zeros(PREP_SIT_KEYS)
  put(x, 'floor', s.floor)
  put(x, 'rank', sit.rank)
  for (const type of ['elite', 'boss', 'siege']) put(x, type, node.type === type)
  put(x, 'monarch', sit.monarch)
  put(x, 'monarch.hp', Math.max(0, m.hp))
  put(x, 'health', sit.health)
  put(x, 'fallen', sit.fallen)
  put(x, 'souls', was.up)
  put(x, 'command', sit.command)
  put(x, 'cands', cands.length)
  for (const k of FIELD_KEYS) put(x, `field.${k}`, was.f[k])
  put(x, 'room.threat', Math.log(Math.max(1e-9, room.threat)))
  put(x, 'room.odds', was.f.strength - Math.log(Math.max(1e-9, room.threat)))
  for (const k of ['foes', 'hp', 'def', 'raw', 'waves']) put(x, `room.${k}`, room[k])
  for (const t of OUT_THREATS) put(x, `room.t.${t}`, room.t[t])
  put(x, 'room.gap', gapOf([room], was.f))
  const onM = mitigation(m) / Math.max(1, m.hp)
  const ground = foes.filter((f) => !f.flies)
  put(x, 'scout.flyers', foes.length - ground.length)
  put(x, 'scout.shooters', foes.filter((f) => f.reach >= 2).length)
  put(x, 'scout.reach', Math.max(0, ...foes.map((f) => f.reach)))
  put(x, 'scout.raw', foes.reduce((n, f) => n + f.raw, 0) * onM)
  put(x, 'scout.far', foes.filter((f) => f.reach >= 2).reduce((n, f) => n + f.raw, 0) * onM)
  put(x, 'scout.boss', foes.some((f) => f.boss))
  put(x, 'scout.road', ground.length ? ground.reduce((n, f) => n + f.road.length, 0) / ground.length : 0)
  const ctx = formationContext(run, L)
  put(x, 'scout.mass', ctx.total)
  put(x, 'camp.open', openCells(s.camp).length)
  const gate = gateOf(s.camp)
  put(x, 'camp.gate', gate.length)
  const opened = cands.map((c) => (boards ? openingOf(run, c.party) : {}))
  for (const k of OPENING_ROOM_KEYS) put(x, `o.${k}`, opened[0][k] ?? 0)
  const own = cands[0]
  const f = cands.map((c, i) => formationRead(run, c, own, ctx.seat, gate, opened[i]))
  return { sit: x, f }
}

// One formation's read (prepRead's), against today's pick `own`; `opened` the board it opens on (openingOf).
function formationRead (run, c, own, seat, gate, opened) {
  const out = zeros(PREP_CAND_KEYS)
  put(out, 'score', c.score)
  put(out, 'rank', c.rank)
  put(out, 'draft', c.draft)
  for (const k of FORMATION_KEYS) put(out, `v.${k}`, c.v[k])
  const fielded = (party) => party.filter((u) => !isMonarch(u) && u.slot >= 0)
  const pieces = fielded(c.party)
  const at = new Map(fielded(own.party).map((u) => [u.uid, u.slot]))
  const mine = new Set(pieces.map((u) => u.uid))
  put(out, 'moved', pieces.filter((u) => at.get(u.uid) !== u.slot).length + [...at.keys()].filter((uid) => !mine.has(uid)).length)
  put(out, 'swapped', pieces.filter((u) => !at.has(u.uid)).length)
  const near = (u) => Math.min(...tilesAt(u, u.slot).map((t) => distance(t, seat)))
  put(out, 'seat1', pieces.filter((u) => near(u) <= 1).length)
  put(out, 'seat2', pieces.filter((u) => near(u) <= 2).length)
  put(out, 'front', pieces.filter((u) => cellsOf(u).some((cell) => rowOf(cell) === 0)).length)
  put(out, 'row', pieces.length ? pieces.reduce((n, u) => n + rowOf(u.slot), 0) / pieces.length : 0)
  put(out, 'lanes', new Set(pieces.flatMap((u) => cellsOf(u).map(colOf))).size)
  put(out, 'big', pieces.filter((u) => sizeOf(u) === 2).length)
  const held = new Set(pieces.flatMap(cellsOf))
  put(out, 'gate', gate.filter((cell) => held.has(cell)).length)
  put(out, 'shooters', pieces.filter((u) => kitOf(u).some((a) => isBlow(a) && !a.melee)).length)
  put(out, 'melee', pieces.filter(meleeOnly).length)
  put(out, 'flyers', pieces.filter((u) => !!unitDef(u.id).flies).length)
  put(out, 'menders', pieces.filter(tends).length)
  put(out, 'wounded', pieces.filter((u) => hpPct(u) < 0.5).length)
  put(out, 'hp', pieces.length ? pieces.reduce((n, u) => n + hpPct(u), 0) / pieces.length : 0)
  for (const k of OPENING_KEYS) put(out, `o.${k}`, opened[k] ?? 0)
  return out
}

// The expert's recruit as actions: today's, or the forest's (outChoice); decided once a room. → [action, …]
const outRecruits = new WeakMap()
export function recruitPick (run, L, sit = null) {
  const s = run.state
  const key = JSON.stringify([s.floor, s.at, s.offers.map((o) => o.id)])
  if (outRecruits.get(run)?.key === key) return outRecruits.get(run).actions
  // Under the strict commitment, its pick (no forest).
  const strict = L.spend ? strictRecruit(run, L) : undefined
  if (strict !== undefined) {
    const d = strictCandidates(strict)
    const actions = JSON.parse(d.today)
    outRecruits.set(run, { key, actions })
    return actions
  }
  const d = recruitCandidates(run, L, sit)
  const { actions } = outChoice(run, L, sit, 'recruit', outCandidates(d))
  outRecruits.set(run, { key, actions })
  return actions
}

// The expert's purchase: today's (grow's), or the forest's where one decides purchases; null to stop. Once a grow key.
const outSpends = new WeakMap()
export function spendPick (run, L, sit = null) {
  const actions = [...fusionOptions(run, L), ...spendOptions(run, L)]
  const today = grow(run, L, actions, 'spend', sit)
  if (!actions.length || !outDecides('spend')) return today
  const key = growths.get(run).spend.key
  if (outSpends.get(run)?.key === key) return outSpends.get(run).pick
  const d = spendCandidates(run, L, sit)
  const pick = outChoice(run, L, sit, 'spend', outCandidates(d))
  const out = pick.id === d.today ? today : pick.actions[0] ?? null
  outSpends.set(run, { key, pick: out })
  return out
}

export function policy (run, rng, level = 'basic', turnOptions = null) {
  const L = typeof level === 'string' ? LEVELS[level] : level
  const s = run.state
  if (L.ablate) {
    if (!ABLATIONS.includes(L.ablate)) throw new Error(`unknown ablation "${L.ablate}": ${ABLATIONS.join(', ')}`)
    if (RULE_SWITCHES.includes(L.ablate) && !s.ablate?.includes(L.ablate)) throw new Error(`ablating ${L.ablate} needs a run made with it (ablatedRun)`)
  }
  if (s.phase === 'battle') return battleOrder(run, L, turnOptions)
  if (s.phase === 'draft') return pickDraft(run, L)
  // The expert's survey of the run, read once for this decision (basic reads none).
  const sit = L.spend || L.route ? survey(run, L) : null
  if (s.phase === 'map') return pickNode(run, rng, L, sit)
  if (s.phase === 'prep') return pickPrep(run, L, sit)
  if (s.phase === 'reap') return pickReap(run, L, sit)
  if (s.phase === 'altar') return pickAltar(run, L, sit)
  throw new Error(`no policy for phase "${s.phase}"`)
}

// In a battle: the level's turn policy, planned once at the turn's start and given an order at a time, End Turn last, as
// playOut gives them; planned again should the next no longer be legal. `turnOptions` go to the turn policy.
const planned = new WeakMap()
const same = (a, o) => a.type === o.type && a.uid === o.uid && a.tile === o.tile && a.ability === o.ability && a.target === o.target && a.id === o.id &&
  String(a.parts) === String(o.parts)
function battleOrder (run, L, turnOptions = null) {
  const b = run.battle
  // Past the sim's bound on turns, as playOut ends it: a stall (a passive side may hold a battle forever).
  if (stalled(b)) return { type: 'stall' }
  let p = planned.get(b)
  const stale = !p || p.turn !== b.turn || !p.orders.length || (p.orders[0].type !== 'end' && !legalOrders(b).some((a) => same(a, p.orders[0])))
  if (stale) {
    const note = audited(run) ? (r) => noteRule(run, r.decision, r, r.sit ? brief(r.sit) : `turn ${b.turn}`) : null
    planned.set(b, (p = { turn: b.turn, orders: TURNS[turnsOf(L)](b, { ...turnOptions, note }) }))
  }
  return p.orders.shift()
}

// Plays the run to the end: onBattle(battle, run) after each battle, beforeFight(run) before each fight; `act(run, rng)`
// chooses every action in place of the level's policy where given. A clear is the end: no level descends further.
export function autoplay (run, { rng = createRng(run.state.seed).stream('autoplay'), level = 'basic', onBattle = null, beforeFight = null, turnOptions = null, act = null } = {}) {
  for (let guard = 0; run.state.phase !== 'over'; guard++) {
    if (guard > 1e5) throw new Error('autoplay is stuck')
    const was = run.state.phase
    const action = act ? act(run, rng) : policy(run, rng, level, turnOptions)
    if (action.type === 'fight') beforeFight?.(run)
    apply(run, action)
    // On turns a battle ends with an order, not with the fight that opened it.
    if (run.state.phase !== 'battle' && (action.type === 'fight' || was === 'battle')) onBattle?.(run.battle, run)
  }
  return run
}
