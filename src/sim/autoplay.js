// A player for tests and balance runs: a policy that picks one action at a time for apply(). It plays at one of two
// levels (LEVELS), on the same choices and the same scouting a player has:
//   basic   rules of thumb: rooms by weighted draws, the strongest souls fielded in its first draft (each role's row,
//           packed from the middle lane, every other lane against blasts), in a Shop a Command relic it can pay for
//           (pickShop), recruits only to fill the field, essence on the lowest kind's next tier (on the track it is on);
//           it never fuses, and in battle it ends every turn without an order (policy.js basicTurn: what it leaves alone
//           strikes with its basic blow)
//   expert  judges (redesign.md §2.17; expert.js), and has studied the combo book (BOOK, src/sim/combos.json, ranked
//           by a static formula: --combos). Every decision is one shape: the situation read once (survey out of battle,
//           policy.js situation in it: what a player is shown, and the book), the options listed, each read as a named
//           vector of features, the tree of hard rules (expert.js TREES) forcing or filtering them, the weights
//           (TUNING.expert) scoring the rest. The next room by its type and the army's state (roomFeatures); the
//           formation drafted (the plan's target formation as the first turn would read it: plan.js deployment; zone
//           drafts about the seat, its gate held, basic's three) and hill-climbed on a static score against the scouted
//           room's roads (formationFeatures); every purchase, fusion, recruit, relic bought and relic given by one
//           growth search on a sketch (the field's strength and the book's worth of the combo it plays toward:
//           targetOf), a relic against the tiers its price displaces (buyFor); its target's kinds fielded first and
//           never let go while another will do; in battle every turn policy.js expertTurn's (a battle plan kept across
//           turns, its target formation, kill list and forecast: plan.js; then the pieces one at a time with a beam of
//           partial turns, each option's board scored by V where trained, else the static evaluation: redesign.md
//           §2.21), and where V is trained, the formation by V of the battle's opening board among the best the
//           hill-climb met. It never plays a battle, a turn of the foes, or a route ahead to decide anything.
// Essence buys tiers, recruits, fusions and relics (a Shop's): the Monarch's HP and Command come from run relics, a
// kind's level from its tiers (run.js). The Monarch is the camp's (run.js: on its seat, monarchSlot); nothing moves it.
// In a battle it gives the level's turn policy's orders, one at a time.
// Run directly for a balance report:  node src/sim/autoplay.js [--runs 8] [--seed sim] [--level expert] [--workers n]
// [--static] (today's static evaluation in the expert's turns and formations, whatever V value.js holds)
// for the gap between the levels:     … --ladder [--runs 8]
// or for a report on how much the player's choices decide battles:  … --decisions [--runs 8]
// or the expert with one mechanic taken away (ABLATIONS):  … --ablate orders  (a report as above; --ablate moves: its
// pieces never move in battle)
// for how much each mechanic carries the expert, full runs:  … --ablations [--runs 8] [--variants full,orders,fusions] [--out runs.json]
// or as a fast battle-level proxy (its battles refought stripped): … --necessity [--runs 8] [--setups file]
// or what the expert considers against what it chooses, and which rule decided (AUDIT):  … --audit [--runs 4] [--seed audit]
// or the expert's combo book, ranked by its static formula and written to src/sim/combos.json (rerun when content or
// numbers change):  … --combos  (npm run combos)
// (--decisions and --necessity refight recorded battles to measure them: they decide nothing.)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRng } from './rng.js'
import {
  statsOf, tracksOf, tiersOf, nextTracks, CENTRE_OUT, CAMP_SLOTS, CAMP_ROWS, campOpen, wallTiles, steps, deployTile, tileAt, tileX, tileY, TILES,
  LANES, rowOf, colOf, distance, makeUnit, slotAt, baseStats, summonsOf, DEPTH, sizeOf, footprintSlots, fits,
  monarchSlot, abilitiesOf, isBlow, isAllyShape, blowReach, armOf, heldMods, isRunPath, cellsOf, meleeOnly, auraOf, activeSynergies, rangeOf, ROWS
} from './unit.js'
import { roadsTo } from './field.js'
import { createBattle, playOut, timelineHash, legalOrders, stalled } from './turns.js'
import { expertTurn, basicTurn, brief, situation, evaluate } from './policy.js'
import { loaded } from './value.js'
import { deployment } from './plan.js'
import { value, decide, standing as keysOf, outranks, TREES } from './expert.js'
import { grantsArise, bleeds, ariseGrants } from './rules.js'
import {
  createRun, apply, availableNodes, fieldCap, rosterCap, fielded, inOssuary, currentNode, battleSetup, tierCost, foeMods, roomThreats,
  isMonarch, monarchOf, souls, canAdvance, unhealed, soulCount, heldKinds, canPlace, canFuse, fuseParts, fuseCost, OSSUARY, START_PARTY,
  relicTier, levelOf, kindLevel, monarchHp, ariseOf, commandOf, canBuy, relicPrice, isRunRelic, unheld, canHold
} from './run.js'
import { nodeOf, RANKS } from './map.js'
import { TUNING } from '../tuning.js'
import { unitDef, abilityDef, campDef, relicDef, fusionDef, FUSION_LIST, UNIT_LIST, SYNERGIES, RELIC_LIST, STATUS_WORTH } from '../content.js'

// search: formations met by hill-climbing from the best draft, on the static score (0: the first draft, basic's rule
// of thumb); wounds: field by worth with wounds counted; route: choose the next room by its features (else weighted
// draws); spend: grow by the growth search (grow: purchases, recruits, the Shop's relics, who holds them) rather than by
// rule of thumb; fuse: weigh each fusion it can make (else it never fuses); book: play toward the combo book's best
// reachable combo (targetOf); more: draft the expert's formations too (zone drafts about the Monarch, its gate held:
// drafts); turns: how it plays its turns in battle ('basic': End Turn alone; 'expert': policy.js expertTurn).
export const LEVELS = {
  basic: { search: 0, wounds: false, route: false, spend: false, fuse: false, turns: 'basic' },
  expert: { search: 120, wounds: true, route: true, spend: true, fuse: true, more: true, book: true, turns: 'expert' }
}
// The turn policies by name (LEVELS `turns`; `unfused`, the expert's that never fuses in battle: the fusions
// ablation's; `still`, the expert's that never moves a piece: the moves ablation's). Each takes the battle and options
// (expertTurn's `note`, the audit's).
const TURNS = {
  basic: basicTurn,
  expert: (b, o) => expertTurn(b, o),
  unfused: (b, o) => expertTurn(b, { ...o, fuse: false }),
  still: (b, o) => expertTurn(b, { ...o, moving: false })
}
// The turn policy L fights by: its `turns`, with its ablation's mechanic taken from them (ablatedTurns).
const turnsOf = (L) => ablatedTurns(L.turns ?? 'basic', L.ablate)
// Turn policy `turns` with mechanic `m` taken away: End Turn alone without orders, the expert's unfused without
// fusions, its still without moves.
const ablatedTurns = (turns, m) => (m === 'orders' ? 'basic' : turns !== 'expert' ? turns : m === 'fusions' ? 'unfused' : m === 'moves' ? 'still' : turns)

// ── ablation: the expert with one mechanic taken away ─────────────────────────────────────────────

// For measuring how much each mechanic carries the expert (--ablations, --necessity): a level's `ablate`
// takes ONE mechanic from it and changes nothing else; essence it would have spent there goes where its
// spending logic already sends it:
//   orders         ends every turn of every battle without an order (policy.js basicTurn: what is left alone strikes
//                  or mends with its basic, and no skill is ever used): what in-battle play is worth
//   fusions        never fuses (fusionOptions lists none; its turns give no fuse order in battle either: TURNS unfused)
//   summons        no tier brings a summon in battle (a rules switch: the run's `ablate`, carried in every battle's
//                  setup, so a snapshot stripped of it, necessity, fights without it too), and such a tier is worth
//                  only its place on the track (worth: its summons not counted), so the essence goes elsewhere
//   tracks         never buys a track tier (its kinds stay at their first level: a level is its tiers')
//   legendaries    never buys a Legendary relic (Arise and its variants among them)
//   relics         never buys a Common, Uncommon or Rare relic (so neither HP nor Command: the field stays at
//                  TUNING.party.field, Legion's aside)
//   synergies      the party holds no synergy's rule in battle (a rules switch, as summons)
//   formation      no formation search: its souls in basic's first draft's cells (who it fields still its own)
//   moves          its pieces never move in battle: each acts from where it stands (policy.js expertTurn's `moving`:
//                  TURNS still); prep unchanged: what moving the pieces is worth (redesign.md §2.18)
// A run of an ablation that is a rules switch must be made with it (ablatedRun); policy refuses one that is not.
// 'arise' is a rules switch too (no relic grants Arise: the necessity's and the tests'), not an ablation: Arise is
// measured with the Legendaries (it is one), and fusions as an extra, both having substitutes the expert spends on
// instead (the user's call after the balance pass, 2026-10-09). The formation is measured with no band (MEASURED; the
// user's call after the turns pass, 2026-10-11): pieces move in battle, and the orders absorb where they start. So are
// the moves (2026-10-11, with the plan: redesign.md §2.18).
export const ABLATIONS = ['orders', 'fusions', 'summons', 'tracks', 'legendaries', 'relics', 'synergies', 'formation', 'moves']
export const RULE_SWITCHES = ['arise', 'synergies', 'summons']
export const ablatedRun = (seed, ablate = null) => createRun({ seed, ablate: RULE_SWITCHES.includes(ablate) ? [ablate] : null })
// Whether L never buys relic `id`.
const legendary = (id) => relicTier(id) === 'legendary'
const BANNED = {
  legendaries: legendary,
  relics: (id) => !legendary(id)
}
const banned = (L, id) => !!BANNED[L.ablate]?.(id)

// A formation as L may field it: under 'formation' the cells basic's first draft gives (basicCells). Anything
// else as it is.
const allowed = (run, party, L) => (L.ablate === 'formation' ? basicCells(run, party, L) : party)

// Basic's first draft's cells for these units (L's fielding order, as its drafts take them): the Monarch on its
// seat, the souls by role row from the middle lane (every other lane against blasts), each where its footprint
// fits.
function basicCells (run, party, L) {
  const s = run.state
  const cols = blasts(currentNode(run).foes) ? SPREAD : CENTRE_OUT
  const placed = byRows(party.filter((u) => !isMonarch(u) && u.hp > 0).sort(L.wounds ? byFieldPower : byPower).map((u) => ({ ...u, slot: -1 })), cols, s.camp, seated(s.camp))
  const at = new Map(placed.map((u) => [u.uid, u.slot]))
  return party.map((u) => ({ ...u, slot: isMonarch(u) ? monarchSlot(s.camp) : at.get(u.uid) ?? -1 }))
}

const hpPct = (u) => u.hp / u.maxHp
const partyHealth = (party) => party.reduce((n, u) => n + hpPct(u), 0) / party.length
const byPower = (a, b) => worth(b) - worth(a) || a.uid - b.uid
// An expert counts wounds: a soul at 10% HP is not worth fielding at full price.
const byFieldPower = (a, b) => fieldPower(b) - fieldPower(a) || a.uid - b.uid

// Rough fighting worth from its stats, track tiers and the relics it holds included (`mods`: a foe's, its floor's):
// how long it lasts times how hard it hits (and how far it goes in a turn), square-rooted, and as much again for each
// summon its tiers bring, at the root of the share of HP a summon rises with (unless `summons` is false: the summons
// ablation's). A tier that grants an ability, an aura or a Colossus's footprint counts a share more, and each relic it
// holds a share more besides its mods (what its triggers and rules are worth no static read can tell):
// TUNING.expert.growth.worth. 0 for the fallen, and for the Monarch, which never strikes.
function worth (u, summons = true, mods = heldMods(u), h = TUNING.expert.growth.worth.hits, w = TUNING.expert.growth.worth) {
  if (u.hp <= 0 || isMonarch(u)) return 0
  const s = statsOf(u, mods)
  const lasts = s.hp * (1 + s.def / 100) / s.damage.taken
  const hits = s.atk * s.damage.dealt * (1 + w.move * s.move) + w.mend * mendOut(u, s)
  const signature = tiersOf(u).filter((t) => t.ability || t.aura || t.size).length
  return lasts ** (1 - h) * hits ** h * (1 + w.signature * signature) * (1 + w.relic * (u.relics?.length ?? 0)) *
    (1 + (summons ? summonsOf(u) * Math.sqrt(TUNING.summon.hp) : 0))
}
const fieldPower = (u) => worth(u) * Math.sqrt(hpPct(u))
// What a soul mends a turn (worth's `mend`): its best heal of others, each heal effect's HP and each ward it lays (its
// STATUS_WORTH, a Regen's among them), by its ATK and healing given as a heal lands.
const mendOut = (u, s) => Math.max(0, ...kitOf(u).filter((a) => isAllyShape(a.shape) && a.effects.some((e) => e.op === 'heal' && !e.self))
  .map((a) => a.effects.reduce((n, e) => n + (e.op === 'heal' && !e.self ? e.power : e.op === 'apply_status' ? STATUS_WORTH[e.status] ?? 0 : 0), 0))) *
  s.atk / TUNING.damage.atkDivisor * s.heal.given

// A copy of the run to weigh a choice on (the growth search's): the state cloned, no battle.
const fork = (run) => ({ state: structuredClone(run.state), battle: null, setup: null })

// What a retinue brings to its next fight: the fieldable pieces' wounded power (their summons and the relics they hold
// counted) and the shadows the Arise holders among them would raise (ariseWorth, a share of their worth:
// TUNING.expert.growth.raise), raised by each run relic as worth raises a piece by one it holds (a piece relic works
// only through its holder).
function strength (s, summons = true) {
  const best = souls(s.party).map((u) => ({ u, p: worth(u, summons) * Math.sqrt(hpPct(u)) })).sort((a, b) => b.p - a.p).slice(0, fieldCap({ state: s }))
  const raised = TUNING.expert.growth.raise.share * ariseWorth(s, best.filter((x) => x.p > 0).map((x) => x.u))
  return (best.reduce((n, x) => n + x.p, 0) + raised) * (1 + TUNING.expert.growth.worth.relic * s.relics.filter(isRunRelic).length) || 1
}

// ── Arise's worth, read from the roads (redesign.md §2.15, §2.17) ────────────────────────────────

// Arise as soul `u` holds it, out of battle: the run's reach and tier (run.js ariseOf), what the rules granting it add
// (Court of Bone's tiles) and the corpses it raises a turn (Blood Tithe's `count`, else 1), as turns.js ariseOf and
// rules.js read them in battle. Null for a soul holding no Arise relic, and for every soul under the 'arise' rules switch.
function ariseIn (s, u) {
  const grants = ariseGrants(u)
  if (!grants.length || s.ablate?.includes('arise')) return null
  const a = ariseOf(s)
  const sum = (k) => grants.reduce((n, r) => n + (r.params[k] ?? 0), 0)
  return { domain: a.domain + sum('domain'), tier: a.tier + sum('tier'), count: Math.max(1, ...grants.map((r) => r.params.count ?? 1)) }
}

// The share of a scouted foe's road (scoutAt) where it may fall within `domain` tiles of `tiles`: each tile of its road
// but the seat weighed as threatOf weighs it, (1 + its road distance)^−1, the nearer the seat (where the fighting
// gathers) the more.
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

// What the Arise holders among `pieces` (the souls strength counts) would raise a battle, in worth, with no battle
// played: each battle room of the floor from where the run stands on (the map scouts every room), each of its foes but
// a boss, of a tier a holder's Arise allows, rising with the share of its road within that holder's reach of where it
// stands (fallShare: from its cell, or the seat's for one in the ossuary; the best holder's), at its worth at its level
// (worth); a room's shadows no more than the holders' raises a battle (each its corpses a turn ×
// TUNING.expert.growth.raise.turns), its worth cut in proportion; the mean over the rooms. 0 with no holder.
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
// A shadow's worth: its kind's at the corpse's level, on your side (worth).
const shadowWorths = new Map()
function shadowWorth (id, lvl) {
  const key = `${id}|${lvl}`
  if (!shadowWorths.has(key)) shadowWorths.set(key, worth(makeUnit(id, { lvl })))
  return shadowWorths.get(key)
}

// ── the survey: what the expert reads of the run (redesign.md §2.17) ─────────────────────────────

// What the expert reads of the run before a decision out of battle, once a decision (policy): what the map, the field,
// the ossuary, the purse, the Shop and the bestiary show a player, and the combo book; never a room's battle played.
//   floor, rank, phase       where the run stands
//   purse, prices            its essence, and the cheapest next tier of a kind it holds (`tier`), recruit on offer
//                            (`recruit`) and relic of the floor (`relic`): null where there is none
//   health, fallen, monarch  its souls' HP over their max (the fallen's none), how many lie fallen, and the share of the
//                            Monarch's HP it has (its wounds carried from battle to battle: the route's tree reads it,
//                            redesign.md §2.18 C); `unhealed`: nothing may heal the Monarch (Court of Bone)
//   strength                 the field's (strength)
//   command, fielded, waiting  the field cap, the standing souls fielded, and those waiting in the ossuary
//   target                   the combo it plays toward ({ id, progress, missing: kinds still short }), null for none
//   relics                   `unheld`: the piece relics waiting; `free`: standing souls with room to hold one
//   rooms                    each room it may walk into next: { id, type, threat (its scouted foes' worth), threats
//                            (their types), unanswered (those the army has no answer to: ANSWERS), want (its foes of the
//                            target's kinds), ahead ({ shop, altar }: rooms to the nearest on a route through it, null
//                            for none) }
export function survey (run, L = LEVELS.expert) {
  const s = run.state
  const all = souls(s.party)
  const up = standing(all)
  const target = L.book ? targetOf(s) : null
  const keeps = targetKinds(target)
  const common = RELIC_LIST.find((r) => r.tier === 'common')
  const tiers = heldKinds(s).flatMap((kind) => [0, 1].filter((t) => canAdvance(s, kind, t)).map((t) => tierCost(run, kind, t)))
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

// A room the run may walk into, as the survey reads it (scouting shows its foes; the map, where the routes go).
function scoutRoom (run, n, up, keeps) {
  const s = run.state
  const foes = [...(n.foes ?? []), ...(n.waves ?? []).flatMap((w) => w.foes)]
  const mods = foeMods(s.floor, n.type === 'boss')
  const threats = n.foes ? [...roomThreats(n)] : []
  return {
    id: n.id,
    type: n.type,
    threat: foes.reduce((t, f) => t + worth(makeUnit(f.id, { lvl: f.lvl }), false, mods), 0),
    threats,
    unanswered: threats.filter((t) => ANSWERS[t] && !up.some(ANSWERS[t])),
    want: foes.filter((f) => keeps.has(f.id)).length,
    ahead: { shop: roomsTo(s.map, n.id, 'shop'), altar: roomsTo(s.map, n.id, 'altar') }
  }
}

// The army's answers to a room's threat types (content.js THREATS), by what a standing soul can do: Fly by a blow that
// reaches a flyer (a ranged one, or a flyer's own), Reach by a ranged blow, Drain, Burn and Bleed by a heal of others or
// a cleanse. Shape, Sustain and Depth are met by numbers alone, so the survey counts no answer short for them.
const kitOf = (u) => abilitiesOf(u).map(abilityDef)
const tends = (u) => kitOf(u).some((a) => isAllyShape(a.shape) && a.effects.some((e) => (e.op === 'heal' && !e.self) || e.op === 'cleanse'))
const ANSWERS = {
  fly: (u) => kitOf(u).some((a) => isBlow(a) && (!a.melee || !!unitDef(u.id).flies)),
  reach: (u) => kitOf(u).some((a) => isBlow(a) && !a.melee),
  drain: tends,
  burn: tends,
  bleed: tends
}

// How many rooms on from room `from` the nearest room of `type` lies on a route through it (1: the next), null for
// none on the floor.
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
  const spend = pickSpend(run, L, sit)
  if (spend) return spend
  const nodes = availableNodes(run)
  if (L.route && nodes.length > 1) return { type: 'node', id: pickRoute(run, sit) }
  const health = partyHealth(run.state.party)
  const w = { fight: 3, elite: health > 0.7 ? 1.5 : 0.3, shop: 2, altar: health < 0.6 ? 5 : 0.5, boss: 1, siege: health > 0.7 ? 1.5 : 0.3 }
  return { type: 'node', id: rng.weighted(nodes, nodes.map((n) => w[n.type])).id }
}

// The expert's next room: each room it may walk into, read against the survey (roomFeatures), decided by the tree's
// rules (TREES.route: a badly wounded army takes an altar, and walks into no elite) and then the weights
// (TUNING.expert.route). No route is walked ahead and no room's battle played: a room is what scouting shows of it.
// → the room's id.
export function pickRoute (run, sit = survey(run)) {
  const rooms = sit.rooms.map((room) => ({ node: nodeOf(run.state.map, room.id), v: roomFeatures(sit, room) }))
  const pick = decide(TREES.route, sit, rooms, TUNING.expert.route)
  noteRule(run, 'route', pick, surveyLine(sit))
  return pick.option.node.id
}

// A room read as the features its decision weighs (TUNING.expert.route): its type, one of six; for a battle room the
// odds (the log of the army's strength over the room's scouted threat; `weak` where the room is the stronger), its foes
// of the target's kinds (`want`) and its threat types the army has no answer to (`unanswered`); for an altar the souls'
// wounds and the Monarch's (none while nothing may heal it); for a Shop the purse over the floor's cheapest relic, up
// to 3; and an altar or a Shop on a route through it (`altarAhead`, `shopAhead`), the nearer the more, an altar by the
// souls' wounds and by the Monarch's (`monarchAhead`, none while nothing may heal it: redesign.md §2.18 C).
export function roomFeatures (sit, room) {
  const fights = room.threat > 0 && room.type !== 'shop' && room.type !== 'altar'
  const odds = fights ? Math.log(sit.strength / room.threat) : 0
  const purse = sit.prices.relic ? Math.min(3, sit.purse / sit.prices.relic) : 0
  const v = { fight: 0, elite: 0, shop: 0, altar: 0, boss: 0, siege: 0 }
  v[room.type] = 1
  return {
    ...v,
    odds,
    weak: Math.max(0, -odds),
    wounds: room.type === 'altar' ? 1 - sit.health : 0,
    monarch: room.type === 'altar' && !sit.unhealed ? 1 - sit.monarch : 0,
    purse: room.type === 'shop' ? purse : 0,
    want: room.want,
    unanswered: room.unanswered.length,
    altarAhead: room.ahead.altar === null ? 0 : (1 - sit.health) / (1 + room.ahead.altar),
    monarchAhead: room.ahead.altar === null || sit.unhealed ? 0 : (1 - sit.monarch) / (1 + room.ahead.altar),
    shopAhead: room.ahead.shop === null ? 0 : purse / (1 + room.ahead.shop)
  }
}

// ── prep: the formation ──────────────────────────────────────────────────────────────────────────────

// The autoplayer arranges its souls with the same choice a player has: any camp cell where a piece's footprint
// fits (unit.js fits: a 2×2 piece needs its four cells open), the Monarch on its seat (the camp's: it never
// moves). Basic takes its first draft, its rule of thumb; the expert drafts a few and decides between them, and
// between them and the formations a hill-climb finds from the best, by a static read of the scouted room
// (formationFeatures; plan). Basic's three drafts:
//   rows       each role's row (ROW), packed from the middle lane (auras want neighbours)
//   spread     each role's row, every other lane first (against area attacks)
//   sheltered  the melee where foes walking in arrive first; ranged souls behind the walls, where foes
//              must walk furthest to reach them for how close they stand
// The expert (`more`) reads the placement as the puzzle it is. Every foe keeps to its road to the seat, and a piece
// of yours strikes what it reaches once it has moved, so the fighting is where the foes' roads run within your pieces'
// Move and reach, most of it where the roads meet at the seat. The scouted room's roads (scout: each foe's, from where
// it stands or enters to the seat) become a threat map (threatOf: each road tile, the nearer the seat the more), a cell
// is worth to a piece what of that it covers from there (coverage: as the danger map counts a piece of yours, every
// tile its Move takes it to and its blows' reach from each, the air only for a blow that strikes a flyer), and its
// drafts are filled greedily from that (zone): at a few radii about the seat, the coverage shared out or bunched; with
// its gate held where the camp has one (gated: the fewest cells every drawn ground road crosses, so every ground foe's
// road runs into a piece that blocks it there). A piece that fits nowhere waits in the ossuary (slot −1).

const SPREAD = [3, 1, 5, 2, 4, 0, 6]
const blasts = (foes) => foes.some((f) => unitDef(f.id).abilities.some((id) => abilityDef(id).shape === 'blast'))
// Each role's row in a drafted formation (0 the camp's front): the vanguard ahead, the ranged behind.
const ROW = { vanguard: 0, skirmisher: 1, warden: 1, trickster: 1, ranger: 2, channeler: 2 }
const rowFor = (u) => ROW[unitDef(u.id).role] ?? 1

// The cells the Monarch holds before anything is placed: its seat.
const seated = (camp) => new Set([monarchSlot(camp)])
// The camp's open cells.
const openCells = (camp) => [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(camp, slot))
// The board tiles a piece anchored on `slot` stands on.
const tilesAt = (u, slot) => (footprintSlots(slot, sizeOf(u)) ?? [slot]).map((c) => deployTile('party', c))

// Whether a formation is one the run can field: the Monarch on its seat, every other fielded piece where its
// footprint fits (fits: open camp cells, never the seat), none on another's cells.
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

// Keep units already where their footprint fits past `taken` (a Set of cells, claimed as they go); place the rest,
// the 2×2 first (they need the room), in the first cell they fit of their role's row (rowFor, an anchor's row),
// spilling to the nearest rows, columns in `cols` order; −1 where none is left. Mutates and returns units.
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

// Each in turn, the melee first, on the free cell its footprint fits that scores best: for the melee the fewest
// steps in, for the ranged the most steps in for how far forward they stand.
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

// The expert's zone drafts: [radius about the seat (Chebyshev, from a footprint's nearest tile), how much of a tile's
// threat stays once a piece reaches it (1: bunched, every piece on the busiest tiles; less: shared out over the
// roads), how steeply the threat grows toward the seat].
const ZONES = [[2, 1, 1], [Infinity, 0.5, 0.5], [1, 1, 2], [3, 0.5, 1]]

// The formations L drafts for these units (`want`, in fielding order), each with the Monarch on its seat first: the
// expert's the plan's first (planDraft), then its zone drafts, its gate held, and basic's three.
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

// The plan's draft (redesign.md §2.18: where you deploy and where you move are one idea): the target formation the
// first turn's plan would walk to (plan.js deployment), read on the board as the room would set it up from `start` (a
// draft that fields these units: who stands is all it reads), no turn played and no summons called; each piece it
// gives a slot on its tile where its footprint fits the camp (the seat aside), the rest as the threat map's zone draft
// fills them. Mutates and returns units.
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

// The scouted room's foes and their roads (made once a room; no battle is set up or played): each foe of the opening
// formation and of every wave, the road it will walk to the Monarch's seat from where it stands or enters (field.js
// roadsTo: a ground foe's the camp's Walk field, a flyer's the air road; a wave's foe enters at the top edge in its
// lane, as turns.js entryTile puts it), and what it strikes with (its hardest blow, raw, its floor's mods counted; how
// far its blows reach a piece on the ground, and one in the air, −1 for none). → [{ flies, road: [tile, …, the seat],
// raw, reach, air, hp, id, lvl, tier, boss }]
const scouts = new Map()
const scout = (run) => scoutAt(run.state, currentNode(run))
// The same for any battle room `node` of the run's floor (ariseWorth's). Each foe carries its kind, level and tier too.
function scoutAt (s, node) {
  const key = JSON.stringify([s.camp, s.floor, node.id, node.type, node.foes, node.waves?.map((w) => w.foes)])
  if (scouts.has(key)) return scouts.get(key)
  const roads = roadsTo(s.camp)
  const mods = foeMods(s.floor, node.type === 'boss')
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

// The scouted room as a threat map (the zone drafts' and `cover`'s): each tile of each scouted foe's road but the seat,
// taking (1 + its road distance)^−steep, once a foe: the nearer the seat, where every road ends and the fighting
// gathers, the more. → { ground, air } (a flyer's in the air), each a Float64Array by tile.
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

// What a piece anchored on `slot` covers, as the danger map counts a piece of yours (policy.js danger): every tile its
// Move takes it to (unit.js steps, round the camp's walls, over them for a flyer; from any tile of its footprint), and
// from each, every tile its blows reach (unit.js blowReach), the air's only by a blow that strikes a flyer (a ranged
// one, or a flyer's melee). → { ground, air }: lists of tiles. Made once for each kind, level, tiers, relics held, cell
// and camp.
const covers = new Map()
function coverage (u, slot, camp) {
  const key = JSON.stringify([u.id, u.lvl, u.tracks, u.relics ?? [], slot, camp])
  if (covers.has(key)) return covers.get(key)
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

// A zone draft: each piece in turn (the 2×2 first, then in fielding order) on the free cell its footprint fits
// within `radius` of the seat (anywhere, where none is left there) whose coverage of the threat is the most, nearer
// the seat on ties; each tile it covers then keeps `keep` of its threat for the pieces after it. Mutates and returns
// units.
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

// The camp's gate (DESIGN §2.4): the fewest open cells (never the seat, at most GATE) that every drawn ground road
// crosses, so every ground foe's road runs into a piece there. The roads are the Walk field's arrows (field.js
// roadsTo's `field`), one from each tile of the foes' rows (where the opening stands and every later wave enters:
// field.js entryTile) to the seat; a piece on one blocks there each foe whose road it is, for a foe keeps to its road
// and never passes through a piece (turns.js roadAhead), so a cell no road crosses is never weighed. None of them
// beside the seat (a road step from it) if that can be had, and the furthest along the roads from it of those; none
// where it takes more than GATE. Flyers keep the air road: the gate is the ground's. Made once per camp. → [slot, …],
// [] for none.
const GATE = 3
const gates = new Map()
export function gateOf (camp) {
  if (gates.has(camp)) return gates.get(camp)
  const seat = monarchSlot(camp)
  const f = roadsTo(camp).field
  const d = (slot) => f.dist[deployTile('party', slot)]
  // Each road as the set of camp cells it crosses, the seat aside (roadFrom: the arrows to the root).
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

// The gate held (gateOf): its cells each by the toughest piece left whose footprint covers it (a 2×2 piece's covers
// four cells, and a gate cell already under one is held), then every other piece as a zone draft fills it (zone, from
// the threat map). Null where the camp has no gate or the field too few pieces to hold it and fight beside it.
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

// ── the formation's read (redesign.md §2.17) ─────────────────────────────────────────────────────

// What a formation is read against, made once a plan: the scouted foes (scout), the threat map (threatOf) and its
// total, the seat's tile, the field's best (the fielded souls' worth L would want, wounds counted: wanted), and whether
// your side holds synergies (not under their rules switch).
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
    synergies: !s.ablate?.includes('synergies')
  }
}

// A formation read against the scouted room, no battle played: the features its decision weighs
// (TUNING.expert.formation) and its tree's rules read (TREES.formation). Each scouted foe walks its road to the seat
// and stops before the first piece of yours on it (a piece on the ground holds anyone, a flyer only a flyer): the tiles
// it may stand on are its road up to there, and it strikes what is within its reach of one of them.
//   fielded    the pieces fielded
//   power      their worth, wounds counted (fieldPower), over the field's best (ctx.best)
//   cover      each piece's hardest blow (raw) × the share of the threat map its coverage takes, summed
//   exposed    each piece: the share of its HP the scouted foes that reach it could take in a turn, at most 1
//   open       scouted foes whose road reaches the seat with nothing of yours on it
//   blockers   scouted foes held first by a piece that fights in melee alone
//   behind     ranged pieces that cover the roads where no scouted foe reaches them
//   mend       each healer: the exposure of the allies within its Move and its heal's range
//   monarch    the share of the Monarch's HP the scouted foes that reach it could take in a turn, at most 2
//   synergies  the synergy rules its souls hold (a summon counting as its kind)
//   aura       the allies within an aura's range of its giver
//   arise      each Arise holder: the share of the threat map within its Arise's reach of it (ariseIn)
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
  let onSeat = 0
  for (const f of ctx.foes) {
    let k = 0
    let by = null
    for (; k < f.road.length - 1 && !by; k++) by = ground.get(f.road[k]) ?? (f.flies ? air.get(f.road[k]) : null) ?? null
    const stands = f.road.slice(0, by ? k - 1 : k)
    if (!by) v.open++
    else if (meleeOnly(by)) v.blockers++
    const near = (list, r) => r >= 0 && stands.some((t) => list.some((x) => distance(t, x) <= r))
    for (const u of pieces) if (near(tiles.get(u), flies(u) ? f.air : f.reach)) reached.set(u, reached.get(u) + f.raw)
    if (near([ctx.seat], f.reach)) onSeat += f.raw
    // Where it first comes within its reach of a piece of yours: what yours could deal it there next turn (each
    // piece whose coverage takes that tile: its hardest blow), as a share of its HP, and the share of the HP of the
    // frailest piece it reaches there that its blow would take.
    const first = stands.find((t) => pieces.some((u) => tiles.get(u).some((x) => distance(t, x) <= (flies(u) ? f.air : f.reach))))
    if (first !== undefined) {
      let dealt = 0
      for (const u of pieces) {
        const c = coverage(u, u.slot, s.camp)
        if ((f.flies ? c.air : c.ground).includes(first)) dealt += punch(u)
      }
      v.focus += Math.min(1, dealt / Math.max(1, f.hp))
      let worst = 0
      for (const u of pieces) if (tiles.get(u).some((x) => distance(first, x) <= (flies(u) ? f.air : f.reach))) worst = Math.max(worst, Math.min(1, f.raw * mitigation(u) / Math.max(1, u.hp)))
      v.contact += worst
    }
  }
  const share = new Map(pieces.map((u) => [u, Math.min(1, reached.get(u) * mitigation(u) / Math.max(1, u.hp))]))
  const apart = (a, b) => Math.min(...tiles.get(a).flatMap((x) => tiles.get(b).map((y) => distance(x, y))))
  for (const u of pieces) {
    const st = statsOf(u, heldMods(u))
    const covers = covered(coverage(u, u.slot, s.camp), ctx.threat) / ctx.total
    v.power += fieldPower(u) / ctx.best
    v.cover += punch(u) * covers
    v.exposed += share.get(u)
    if (!meleeOnly(u) && covers > 0 && reached.get(u) === 0) v.behind++
    v.lasts += tough(u) / ctx.tough
    v.dps += punch(u)
    const heals = kitOf(u).filter((a) => isAllyShape(a.shape) && a.shape !== 'self' && a.effects.some((e) => e.op === 'heal' && !e.self))
    for (const a of heals) for (const e of a.effects) if (e.op === 'heal' && !e.self) v.heals += (e.pct ? e.pct * 100 : e.power * st.atk / TUNING.damage.atkDivisor * st.heal.given) / (a === heals[0] ? 1 : heals.length)
    if (heals.length) {
      const r = Math.max(...heals.map(rangeOf)) + Math.floor(st.move)
      for (const x of pieces) if (x !== u && apart(u, x) <= r) v.mend += share.get(x)
    }
    const aura = auraOf(u)
    if (aura) for (const x of pieces) if (x !== u && apart(u, x) <= aura.range) v.aura++
    const raises = ariseIn(s, u)
    if (raises) {
      let n = 0
      for (let t = 0; t < TILES; t++) if (tiles.get(u).some((x) => distance(t, x) <= raises.domain)) n += ctx.threat.ground[t] + ctx.threat.air[t]
      v.arise += n / ctx.total
    }
  }
  const m = monarchOf(s)
  v.monarch = Math.min(2, onSeat * mitigation(m) / Math.max(1, m.hp))
  if (ctx.synergies) v.synergies = activeSynergies(pieces.flatMap((u) => Array(1 + summonsOf(u)).fill(u))).length
  for (const t of ctx.threats) if (ANSWERS[t]) v.answers += pieces.some(ANSWERS[t]) ? 1 : -1
  return v
}

// What a soul takes to fell, wounds counted: its HP standing, its DEF's mitigation and its damage taken.
const tough = (u) => {
  const st = statsOf(u, heldMods(u))
  return Math.max(0, u.hp) * (1 + st.def / 100) / st.damage.taken
}
// The threat types of the room the run is in (its scouted foes').
const scoutThreats = (run) => {
  const n = currentNode(run)
  return n?.foes ? [...roomThreats(n)] : []
}

// The share of a blow's raw a soul takes out of battle: its DEF's mitigation and its damage taken (policy.js mitigation,
// with no battle: its held relics' mods alone).
const mitigation = (u) => {
  const st = statsOf(u, heldMods(u))
  return TUNING.damage.defConstant / (TUNING.damage.defConstant + Math.max(0, st.def)) * st.damage.taken
}
// A unit's hardest blow, raw (policy.js rawOf, out of battle), by `mods` (a soul's: its held relics'; a foe's: its
// floor's).
const punch = (u, mods = heldMods(u)) => {
  const st = statsOf(u, mods)
  return Math.max(0, ...kitOf(u).filter(isBlow).map((b) => b.effects.reduce((n, e) => n + (e.op === 'damage' ? e.power : 0), 0))) * st.atk / TUNING.damage.atkDivisor * st.damage.dealt
}

// Who stands in the camp: the strongest standing souls, wounds counted at the expert's level, a soul of the combo
// target's kinds as if worth TUNING.expert.book.target more.
const standing = (party) => party.filter((u) => u.hp > 0)
const wanted = (run, L) => {
  const keeps = L.book ? targetKinds(targetOf(run.state)) : null
  const w = (u) => worth(u, L.ablate !== 'summons') * (L.wounds ? Math.sqrt(hpPct(u)) : 1) * (keeps?.has(u.id) ? 1 + TUNING.expert.book.target : 1)
  return standing(souls(run.state.party)).sort((a, b) => w(b) - w(a) || a.uid - b.uid).slice(0, fieldCap(run))
}

// → { party, by, rules }: the formation for the current room. Basic (no `search`) takes its first draft, its rule of
// thumb. The expert decides between its drafts (the tree's rules, TREES.formation, then the weights,
// TUNING.expert.formation, on formationFeatures) and hill-climbs from the best (mutate), `search` steps, a change kept
// where it outranks the best (expert.js outranks: the tree's filters first, then the score). `by` and `rules` name the
// rules that turned a comparison (else 'weights'); `onCandidate` hears each formation met, once.
function plan (run, L, { onCandidate = null } = {}) {
  const want = wanted(run, L)
  const options = drafts(run, want, L).map((party) => allowed(run, party, L))
  if (!L.search) {
    onCandidate?.(options[0])
    return { party: options[0], by: 'first draft', rules: [] }
  }
  const ctx = formationContext(run, L, want)
  const w = TUNING.expert.formation
  const filters = TREES.formation.filter((n) => n.keep && n.when(ctx))
  const met = new Map()
  const judge = (party) => {
    const key = party.map((u) => `${u.uid}@${u.slot}`).sort().join()
    if (!met.has(key)) {
      const v = formationFeatures(run, party, ctx)
      met.set(key, { party, v, keys: keysOf(TREES.formation, ctx, { v }), score: value(v, w) })
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
  for (const party of options) take(judge(party))
  const rng = createRng(JSON.stringify([run.state.seed, run.state.floor, run.state.at, best.party.map((u) => u.uid)])).stream('climb')
  const open = openCells(run.state.camp)
  for (let i = 0; i < L.search; i++) take(judge(allowed(run, mutate(best.party, standing(souls(run.state.party)), open, rng, run.state, L), L)))
  const rules = [...turned].sort((a, b) => a - b).map((k) => filters[k].id)
  const learned = opening(run, L, [...met.values()], best)
  if (learned) return { party: learned.party, by: learned === best ? rules[0] ?? 'weights' : 'value', rules }
  return { party: best.party, by: rules[0] ?? 'weights', rules }
}

// The formation by V of the battle's opening board (redesign.md §2.21), where V is trained (value.js loaded) and L
// may use it: of the formations met (each { party, keys, score }: the tree's filters' standing and the static score),
// the TUNING.expert.beam.formation best by the tree's filters and then the static score, each read again as the board
// the room would open on (createBattle from the run's setup with that formation: a board computed, no turn played),
// the tree's filters first, then V (policy.js evaluate). → the formation met it picks, or null where V is not used.
function opening (run, L, met, best) {
  const n = TUNING.expert.beam.formation
  if (L.learned === false || !(n > 0) || !loaded()) return null
  const top = met.slice().sort((a, b) => (outranks(a, b) >= 0 ? -1 : outranks(b, a) >= 0 ? 1 : 0)).slice(0, n)
  if (!top.includes(best)) top.unshift(best)
  let pick = null
  for (const c of top) {
    const b = createBattle({ ...battleSetup(run, { party: c.party.filter((u) => u.slot >= 0) }), quiet: true })
    const x = { c, keys: c.keys, score: evaluate(b) }
    if (pick === null || outranks(x, pick) >= 0) pick = x
  }
  return pick.c
}

// One change to a formation: trade a soul for one from the ossuary (it takes over the cell), swap two, or move
// one to a free cell its footprint fits (a near one more often than not); a change that leaves a footprint where
// it does not fit (legal) is no change. The Monarch never moves. With 'formation' ablated nothing is moved (the
// cells are basic's: see allowed): a change is a trade.
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

// The plan only depends on the room, the camp, the relics, who is standing (not where), their levels, tiers and the
// relics they hold, and the uids the foes will take, so it is made once per prep however many steps carry it out.
const plans = new WeakMap()
export function planFor (run, L) {
  const s = run.state
  const key = JSON.stringify([L, s.floor, s.at, s.camp, s.relics, s.nextUid, s.party.map((u) => [u.uid, u.id, u.lvl, u.hp, u.maxHp, u.tracks, u.relics])])
  const have = plans.get(run)
  if (have?.key === key) return have.plan
  const onCandidate = audited(run) ? (party) => { AUDIT.candidates++; for (const f of new Set(featuresOf(s, party))) note('considered', f) } : null
  const made = plan(run, L, { onCandidate })
  noteRule(run, 'formation', made, `floor ${s.floor}, ${currentNode(run).type} in ${s.camp}`)
  const out = made.party.map((u) => ({ uid: u.uid, slot: u.slot }))
  plans.set(run, { key, plan: out })
  return out
}

// One step toward the plan (the Monarch is on its seat already, and stays): the souls it leaves out to the
// ossuary; then a soul into its planned cell where it can go straight there (run.js canPlace: whoever covers that
// cell takes its old one, never a soul in place, for no two planned footprints share a cell); with none that can,
// a soul not yet in place to the ossuary, to clear the way; then fight.
function pickPrep (run, L, sit) {
  const s = run.state
  const spend = pickSpend(run, L, sit)
  if (spend) return spend
  const goal = planFor(run, L).filter((p) => !isMonarch(p))
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

// Off but for the audit (--audit): per mechanic, how many of the formations the plans met use it (`considered`; and
// each fusion, recruit or tier weighed), and how many of the formations fought do (`chosen`); and per decision, the rule
// of the tree that decided it, or the weights (`rules`, by "decision: rule"), with the situation the first such
// decision was read in (`example`). Only the audited run's own plans and choices count (`run`), and with no run named,
// every plan the audit sees.
export const AUDIT = { on: false, run: undefined, candidates: 0, plans: 0, considered: {}, chosen: {}, done: {}, rules: {}, example: {} }
const note = (book, key, n = 1) => { if (AUDIT.on) AUDIT[book][key] = (AUDIT[book][key] ?? 0) + n }
const audited = (run) => AUDIT.on && (AUDIT.run === undefined || AUDIT.run === run)
export function resetAudit (on = true, run = undefined) {
  Object.assign(AUDIT, { on, run, candidates: 0, plans: 0, considered: {}, chosen: {}, done: {}, rules: {}, example: {} })
}
// A decision of `run`'s (expert.js decide's { by }), for the audit: counted by "decision: rule", and `line`, the
// situation it was read in, kept for the first of each.
function noteRule (run, decision, pick, line) {
  if (!audited(run)) return
  const key = `${decision}: ${pick.by}`
  note('rules', key)
  AUDIT.example[key] ??= line
}
// The survey in a line, for the audit.
const surveyLine = (sit) => `floor ${sit.floor} rank ${sit.rank}, ${sit.purse} essence, souls at ${Math.round(100 * sit.health)}% (${sit.fallen} fallen), ` +
  `Monarch ${Math.round(100 * sit.monarch)}%, ${sit.fielded}/${sit.command} fielded, ${sit.relics.unheld.length} relic(s) waiting` +
  (sit.target ? `, toward ${sit.target.id} (${Math.round(100 * sit.target.progress)}%)` : '') +
  (sit.rooms.length ? `; next: ${sit.rooms.map((r) => r.type + (r.threat ? ` (${(sit.strength / r.threat).toFixed(1)}×)` : '')).join(', ')}` : '')

// What a formation uses: a long-armed kind fielded, a 2×2 piece fielded, a fused piece fielded, a piece beside the
// Monarch, a piece left in the ossuary though the field had room for it.
export const FEATURES = ['long arm fielded', '2×2 fielded', 'fused fielded', 'beside the Monarch', 'left out']
export function featuresOf (s, party) {
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
function chose (s, goal) {
  AUDIT.plans++
  for (const f of new Set(featuresOf(s, goal))) note('chosen', f)
}

// ── growth: essence and fusions ─────────────────────────────────────────────────────────────────────

// Basic buys by rule of thumb (basicSpend) and never fuses. The expert grows by one search (grow): every choice it
// has — a fusion it can make, any held kind's next tier (and that tier with the one after it on its track, as one); a
// recruit (weighRecruits); a relic on a Shop's shelf (buyFor); a relic given to a soul (pickHold) — sketched (sketch:
// the strength of the field it leaves, and what the book says it is worth ahead), the best taken if it beats keeping
// what it has. Out of battle it gives its relics where they are worth most before it spends. Nothing is bought for the
// Monarch: its HP and Command are run relics.
function pickSpend (run, L, sit) {
  if (!L.spend) return basicSpend(run, L)
  return pickHold(run, L, sit) ?? grow(run, L, [...fusionOptions(run, L), ...spendOptions(run, L)], 'spend', sit)
}

// Every purchase the purse affords L: a tier of any kind held (but under the tracks ablation).
export function spendOptions (run, L) {
  const s = run.state
  return heldKinds(s).flatMap((kind) => [0, 1].filter((track) => L.ablate !== 'tracks' && canAdvance(s, kind, track) && s.essence >= tierCost(run, kind, track))
    .map((track) => ({ type: 'upgrade', kind, track })))
}

// The fusions L may make now: one a recipe the run can make (run.js canFuse), of its canonical parts (fuseParts:
// the ossuary's pieces first, then the fielded), as legalActions lists them; none for a
// level that never fuses (basic) or under the fusions ablation.
export function fusionOptions (run, L) {
  if (!L.fuse || L.ablate === 'fusions') return []
  return FUSION_LIST.filter((r) => canFuse(run, r.id)).map((r) => ({ type: 'fuse', id: r.id, parts: fuseParts(run, r.id) }))
}

// Basic's essence goes to the kinds that will fight (those of the strongest standing souls): the lowest of them (by
// level, then by its order) its next tier, on the track it is on (the one with more tiers, the first before any; the
// other where the crosspath rule stops it), whatever its purse affords of it.
function basicSpend (run, L) {
  const s = run.state
  if (L.ablate === 'tracks') return null
  const kinds = [...new Set(standing(souls(s.party)).sort(byFieldPower).slice(0, fieldCap(run)).map((u) => u.id))]
  const affords = (kind, track) => canAdvance(s, kind, track) && s.essence >= tierCost(run, kind, track)
  const on = (kind) => (s.kinds[kind].tracks[1] > s.kinds[kind].tracks[0] ? 1 : 0)
  const low = (kind) => [kindLevel(s, kind), kinds.indexOf(kind)]
  const lowest = kinds.filter((kind) => [0, 1].some((t) => canAdvance(s, kind, t))).sort((a, b) => low(a)[0] - low(b)[0] || low(a)[1] - low(b)[1])[0]
  if (!lowest) return null
  const track = affords(lowest, on(lowest)) ? on(lowest) : !canAdvance(s, lowest, on(lowest)) && affords(lowest, 1 - on(lowest)) ? 1 - on(lowest) : null
  return track === null ? null : { type: 'upgrade', kind: lowest, track }
}

// What a state is worth to grow toward, as the features the growth search weighs (TUNING.expert.growth): the field it
// fields (strength, as a log: what a choice adds, as a share) and what the book says the combo it plays toward is worth
// ahead (bookValue; none without the book). Under the summons ablation a tier's summons are not counted: they never
// come. `sketch`: their weighted sum.
const growthOf = (s, L) => ({ strength: Math.log(strength(s, L.ablate !== 'summons')), book: L.book ? bookValue(s) : 0 })
const sketch = (s, L) => value(growthOf(s, L), TUNING.expert.growth)
// What a choice must beat: keeping what it has (TUNING.expert.growth.keep).
const KEEP = () => TUNING.expert.growth.keep

// The growth search, one decision (expert.js decide): keeping what it has, and each of `actions` (legal now) applied
// to a copy, read as what it adds to growthOf; the tree's rules for `why` (TREES.hold for a relic given), then the
// weights. A kind's next tier is weighed twice: alone, and with the tier after it on the same track as one option
// (where the crosspath rule allows it and the purse holds both prices together: nextTier), at their gain together,
// the first of the two bought for it; for a level is base + perTier × tiers, rounded down, and a tier whose level
// rounds away shows its worth only with the next (2026-10-10: on seed sim-0 the expert held 2,364 essence and declined
// a Frost Sprite tier of 194 for want of it). A hold onto a soul with room for the relic is `free` (the tree's
// give-relic). Weighed once for each run state and purpose (`why`). → the action, or null to keep.
const growths = new WeakMap()
const label = (a) => (a.type === 'fuse' ? `fuse ${a.id}` : a.type)
function grow (run, L, actions, why, sit = null) {
  if (!actions.length) return null
  const s = run.state
  const key = JSON.stringify([L.ablate, s.floor, s.at, s.phase, s.essence, s.kinds, s.relics, s.party.map((u) => [u.uid, u.hp, u.slot >= 0, u.relics])])
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
  growths.set(run, { ...seen, [why]: { key, pick } })
  noteRule(run, why, decided, sit && surveyLine(sit))
  if (pick && audited(run)) note('done', label(pick))
  return pick
}

// Whether, on `sim` with tier `a` (an upgrade) just bought, the tier after it on the same track may be bought too: the
// crosspath rule allows it, and what is left of the purse pays its price (the two priced together, grow).
const nextTier = (sim, a) => a.type === 'upgrade' && canAdvance(sim.state, a.kind, a.track) && sim.state.essence >= tierCost(sim, a.kind, a.track)

// A kind's state ({ lvl, tracks, least? }) with the next tier on `track` taken: its level with it (run.js levelOf).
const afterTier = (k, track) => {
  const next = { ...k, tracks: nextTracks(k.tracks, track) }
  return { ...next, lvl: levelOf(next) }
}

// ── the combo book ───────────────────────────────────────────────────────────────────────────────

// The expert comes to a run having studied every combo the content holds, ranked before the run by a static formula
// (--combos writes them to src/sim/combos.json, in under a second; the expert loads it as BOOK). Basic has none of it.
// The combos:
//   fusion:<recipe>:<track>   the recipe's parts, fused (on floor 1, its parts as they stand), the result on a track
//   core:<kind>:<track>       two pieces of a kind, on one of its two tracks (to its tier IV: a Colossus, an aura, a
//                             new or remade ability, Burning or Hexed)
//   kin:<kin>:<n>, role:<role>:<n>   the n pieces of a kin or a role its synergy's rule needs (content.js SYNERGIES:
//                             one rule each, at 4), each of the kind its cores rank best, those met soonest first
// Each is set up on every floor as the floor's army (BOOK_FLOORS: its Command, tiers and Monarch) with its pieces in it
// and the plain army's in the rest (FILLER), and weighed by bookPower; its `gain` on a floor is the log of its army's
// power over the plain army's (null on a floor its pieces cannot all stand). Then the relics that pair with it: what
// each battle relic adds to its army's power on floors 2 and 4 (a piece relic held by one of its pieces; one that needs
// Arise weighed against Arise alone). An entry:
//   { id, needs: { kind: pieces } (the pieces it is built from), fuse?: the recipe, tracks: { kind: track },
//     kin?: { kin: n }, role?: { role: n }, from: the first floor its kinds are met, gain: [per floor],
//     relics?: { relic: points } }
// The book also holds `plain`: the relics' points on the plain army.
const BOOK_FLOORS = [
  { command: 3, tiers: 1, hp: 220 }, { command: 5, tiers: 2, hp: 265 },
  { command: 7, tiers: 3, hp: 300 }, { command: 9, tiers: 4, hp: 340 }
]
// Whether relic def `r` has a mod on run-level stat path `path` (run.js RUN_PATHS).
const gives = (r, path) => (r.mods ?? []).some((m) => m.path === path)
// The relics a battle reads: their mods on a unit, their triggers, their rules, and Arise's reach and tier (not the
// purse's, the ossuary's, nor Command or the Monarch's HP, which the field's strength weighs).
const BATTLE_RELICS = () => RELIC_LIST.filter((r) => (r.mods?.some((m) => !isRunPath(m.path) || m.path.startsWith('arise.')) || r.on || r.rule) &&
  !gives(r, 'run.command') && !gives(r, 'run.monarchHp')).map((r) => r.id)
const RECRUITED = () => UNIT_LIST.filter((u) => u.spawn && tracksOf(u.id).length === 2)
// The plain army: the souls a run starts with (run.js START_PARTY), then the kinds the floors meet, floor 1's pool first
// and the commonest first (their spawn weights), as many as the deepest floor's Command.
const FILLER = [...START_PARTY, ...RECRUITED().filter((u) => !START_PARTY.includes(u.id))
  .sort((a, b) => a.spawn.minFloor - b.spawn.minFloor || b.spawn.weight - a.spawn.weight || (a.id < b.id ? -1 : 1)).map((u) => u.id)]
  .slice(0, Math.max(...BOOK_FLOORS.map((F) => F.command)))

// The book's combos, as content makes them; `cores` (id → mean gain), once ranked, picks each kin's and role's kinds.
export function combosOf (cores = null) {
  const kinds = RECRUITED()
  const first = (id) => unitDef(id).spawn?.minFloor ?? 1
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

// A combo's army on a floor (null for none: the plain army), as a run standing in a room's prep: its pieces (a fusion
// made from floor 2, its parts as pieces on floor 1), each kind at the floor's tiers on its track (the plain kinds on
// their first), the rest of the floor's Command filled with the plain army's, `relics` owned (and held), and the
// Monarch the floor's. Null where its pieces outnumber the Command.
let bookBase = null
const bookRun = () => (bookBase ??= createRun({ seed: 'book' }))
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
  const kindOf = (id) => {
    const t = tracks[id] ?? 0
    const tiers = [0, 0]
    tiers[t] = F.tiers
    tiers[1 - t] = Math.min(2, Math.max(0, F.tiers - 2))
    return { tracks: tiers, lvl: levelOf({ tracks: tiers }) }
  }
  s.kinds = Object.fromEntries([...new Set(ids)].map((id) => [id, kindOf(id)]))
  const monarch = { ...monarchOf(s), maxHp: F.hp, hp: F.hp }
  s.party = [monarch, ...ids.map((id, i) => makeUnit(id, { uid: i + 1, lvl: s.kinds[id].lvl, tracks: s.kinds[id].tracks }))]
  s.nextUid = ids.length + 1
  // The floor first: the base Command the banners make up to F.command is the floor's (run.js baseField).
  s.floor = floor
  s.relics = [...Array(Math.max(0, F.command - commandOf({ ...s, relics: [] }))).fill('grave_banner'), ...relics]
  // A piece relic works only held (redesign.md §2.15): each is given to the first piece with room for it, the combo's
  // own pieces first.
  for (const id of relics.filter((r) => !isRunRelic(r))) {
    const u = s.party.find((x) => !isMonarch(x) && (x.relics?.length ?? 0) < TUNING.relic.perPiece && !x.relics?.includes(id))
    if (u) u.relics = [...(u.relics ?? []), id]
  }
  s.phase = 'prep'
  return run
}

// A combo army's power (bookArmy's run), the book's static formula (TUNING.expert.book): each soul's worth (worth: its
// stats, its tiers and the summons they bring, and the relics it holds), a fused soul's a share more, and a share of
// its holder's more for a relic's trigger or rule; the whole a share more for each synergy rule its souls hold (a summon
// counting as its kind), and for each run relic on Arise's reach or tier while a soul holds Arise.
function bookPower (run) {
  const b = TUNING.expert.book
  const s = run.state
  const pieces = souls(s.party)
  let power = 0
  for (const u of pieces) {
    const held = (u.relics ?? []).reduce((n, id) => n + (relicDef(id).on ? b.trigger : 0) + (relicDef(id).rule ? b.rule : 0), 0)
    power += worth(u, true, heldMods(u), b.hits, b.worth) * (1 + (unitDef(u.id).fused ? b.fused : 0) + held)
  }
  const rules = activeSynergies(pieces.flatMap((u) => Array(1 + summonsOf(u)).fill(u))).length
  const arise = pieces.some((u) => u.relics?.some(grantsArise)) ? s.relics.filter((id) => isRunRelic(id) && (relicDef(id).mods ?? []).some((m) => m.path.startsWith('arise.'))).length : 0
  return power * (1 + b.synergy * rules + b.arise * arise)
}

// --combos: the book, made. Every fusion and core on every floor, then the kin and role combos built from the best
// cores, each against the plain army (bookPower); then the battle relics on the plain army and on every combo's army
// (on floors 2 and 4), each against the same army without it. Kept: every combo, best first, with the relics that add
// more than TUNING.expert.book.floor to it.
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

// The book as the expert reads it: { margins, plain, combos }, empty where none was made.
export const BOOK = (() => {
  try {
    return JSON.parse(fs.readFileSync(BOOK_FILE, 'utf8'))
  } catch {
    return { margins: {}, plain: {}, combos: [] }
  }
})()

// What the expert makes of the book. How far a run is along a combo, from 0 to 1, the mean of its parts: the pieces
// it is built from, standing (a kin's, a role's or a pact's: the pieces of that kin or role, any kind); a fusion's made
// (its parts then all counted); and the tiers on its tracks of the kinds it holds, of the four.
function comboProgress (s, c) {
  const up = souls(s.party).filter((u) => u.hp > 0)
  const pieces = (id) => up.reduce((n, u) => n + (u.id === id), 0)
  const share = (needs) => {
    const all = Object.values(needs).reduce((n, k) => n + k, 0)
    return Object.entries(needs).reduce((n, [id, k]) => n + Math.min(pieces(id), k), 0) / all
  }
  const parts = []
  if (c.fuse) {
    const made = pieces(fusionDef(c.fuse).result) > 0
    parts.push(made ? 1 : share(c.needs), made ? 1 : 0)
  } else if (c.kin || c.role) {
    for (const [k, n] of Object.entries(c.kin ?? {})) parts.push(Math.min(1, up.filter((u) => unitDef(u.id).kin === k).length / n))
    for (const [r, n] of Object.entries(c.role ?? {})) parts.push(Math.min(1, up.filter((u) => unitDef(u.id).role === r).length / n))
  } else parts.push(share(c.needs))
  const held = Object.entries(c.tracks).filter(([id]) => pieces(id) > 0)
  parts.push(held.length ? held.reduce((n, [id, t]) => n + (s.kinds[id]?.tracks[t] ?? 0) / 4, 0) / Object.keys(c.tracks).length : 0)
  return parts.reduce((n, x) => n + x, 0) / parts.length
}

// A combo's worth from here: its gain over the plain army on the floors left (the last floor's past them, none
// below 0), and the points of the relics at work that pair with it (its own, else the plain army's), each once. A relic
// that costs the Monarch HP (Blood Tithe's tithe) pays for it only while the Monarch mends between fights: while
// nothing may heal it (Court of Bone) the book counts none of its points.
const BOOK_CAP = BOOK_FLOORS.length
function comboWorth (s, c, work = atWork(s)) {
  const from = Math.min(s.floor, BOOK_CAP)
  const g = c.gain.filter((x, f) => x !== null && f + 1 >= from)
  const pairs = c.relics ?? BOOK.plain ?? {}
  const bled = unhealed(s)
  let relics = 0
  for (const id of work) relics += bled && bleeds(id) ? 0 : pairs[id] ?? 0
  // A combo whose kinds are not met before a later floor (`from`) is worth TUNING.expert.book.ahead of it until then.
  return (Math.max(0, g.length ? g.reduce((n, x) => n + x, 0) / g.length : 0) + relics) * (c.from > s.floor ? TUNING.expert.book.ahead : 1)
}
// The relics at work in a state, each once: the run relics owned, and the piece relics a standing soul holds (one
// unheld works for no one: redesign.md §2.15).
const atWork = (s) => new Set([...s.relics.filter(isRunRelic), ...standing(souls(s.party)).flatMap((u) => u.relics ?? [])])

// The book's value of a state: the best of its combos, by worth times progress. The target (targetOf) is that combo.
function bookValue (s) {
  const work = atWork(s)
  let best = 0
  for (const c of BOOK.combos) best = Math.max(best, comboWorth(s, c, work) * comboProgress(s, c))
  return best
}
function targetOf (s) {
  const work = atWork(s)
  let best = null
  let most = 0
  for (const c of BOOK.combos) {
    const v = comboWorth(s, c, work) * comboProgress(s, c)
    if (v > most) { most = v; best = c }
  }
  return best
}
// The kinds a target is built of (its parts, its tracks'), and whether a soul is one of them.
const targetKinds = (c) => new Set([...Object.keys(c?.needs ?? {}), ...Object.keys(c?.tracks ?? {})])

// ── reap ─────────────────────────────────────────────────────────────────────────────────────────

// The one recruit a battle allows (a battle's spoils are its souls: relics are bought, redesign.md §2.11): basic buys
// the highest tier it can afford while the field has room, an expert the soul that grows its sketch most
// (weighRecruits). A full retinue lets its weakest soul in the ossuary go to make room.
function pickReap (run, L, sit) {
  const s = run.state
  if (L.spend) {
    const pick = weighRecruits(run, L, sit)
    if (!pick) return { type: 'reap', index: null }
    if (pick.release != null && soulCount(s.party) >= rosterCap(run)) return { type: 'release', uid: pick.release }
    return { type: 'reap', index: pick.index }
  }
  const index = recruit(run)
  if (index === null || soulCount(s.party) < rosterCap(run)) return { type: 'reap', index }
  // Never the last soul standing (the run refuses that release): with every other soul fallen, the recruit
  // is passed over instead.
  const spare = (u) => souls(s.party).some((x) => x !== u && x.hp > 0)
  const weakest = inOssuary(s.party).filter(spare).sort(L.wounds ? byFieldPower : byPower).at(-1)
  return weakest ? { type: 'release', uid: weakest.uid } : { type: 'reap', index: null }
}

// The expert's recruit, by the growth search's sketch: each soul it can afford, a piece of its own, with the retinue
// as it would leave it (when the retinue is full, its weakest
// standing piece in the ossuary let go first, never one its target is built of while another will do: a release only
// ever comes with a recruit worth it), or a fusion it would complete; the best that beats keeping the essence, or none.
// Weighed once a room; a release it needs comes first, then the recruit it was for.
// → { index, release? } or null
const recruits = new WeakMap()
function weighRecruits (run, L, sit = null) {
  const s = run.state
  // Once a room, for the offers it has (a release leaves them as they were; a recruit takes the souls away).
  const key = JSON.stringify([s.floor, s.at, s.offers.map((o) => o.id)])
  if (recruits.get(run)?.key === key) return recruits.get(run).pick
  const spare = (u) => souls(s.party).some((x) => x !== u && x.hp > 0)
  // The soul it lets go: the weakest standing in the ossuary, never one its target is built of while another will do.
  const keeps = L.book ? targetKinds(targetOf(s)) : new Set()
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
    // A recruit is worth what it adds to the field and the book, or what a fusion it completes would (one the purse
    // cannot pay for yet, TUNING.expert.growth.later of that).
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

// The retinue as it would be after each fusion L may make on `sim` (a copy, after a recruit: weighed as on the map);
// with `later`, each fusion whose parts it holds though the purse is short of its price too (as if paid), marked
// `later`.
function completes (sim, L, later = false) {
  const map = { ...sim, state: { ...sim.state, phase: 'map' } }
  const out = fusionOptions(map, L).map((a) => {
    const next = fork(map)
    apply(next, a)
    return next
  })
  if (!later || !L.fuse || L.ablate === 'fusions') return out
  for (const r of FUSION_LIST) {
    if (canFuse(map, r.id) || fuseParts(map, r.id) === null) continue
    const next = fork(map)
    next.state.essence = fuseCost(map, r.id)
    apply(next, { type: 'fuse', id: r.id, parts: fuseParts(map, r.id) })
    next.later = true
    out.push(next)
  }
  return out
}

// What saving for a fusion is worth (grow's `save`): the most the sketch would gain from a fusion whose parts the run
// holds while the purse is short of its price (completes' `later`), 0 for none.
function saving (run, L) {
  const base = sketch(run.state, L)
  return Math.max(0, ...completes(fork(run), L, true).filter((x) => x.later).map((x) => sketch(x.state, L) - base))
}

// Basic's recruit (the expert's is weighRecruits'): while the field has room for another standing soul, the soul of
// the highest tier it can afford (the first offered among equals); else none.
function recruit (run) {
  const s = run.state
  if (standing(souls(s.party)).length >= fieldCap(run)) return null
  const affordable = s.offers.flatMap((o, index) => (o.cost <= s.essence ? [{ o, index }] : []))
  return affordable.sort((a, b) => unitDef(b.o.id).tier - unitDef(a.o.id).tier || a.index - b.index)[0]?.index ?? null
}

// The state a purchase would make, for the sketch: a relic owned (a copy more; an HP relic's Monarch with its max HP
// raised, healed by as much unless nothing may heal it), or the kind (every soul of it) with a tier more on a track and
// the level it gives; else as is. Only what changes: { relics?, party?, kinds? }.
export function offerState (s, o) {
  if (o.type === 'relic') {
    const relics = [...s.relics, o.id]
    const gain = monarchHp({ ...s, relics }) - monarchHp(s)
    if (!gain) return { relics }
    const heal = !unhealed({ relics })
    return { relics, party: s.party.map((u) => (isMonarch(u) ? { ...u, maxHp: monarchHp({ ...s, relics }), hp: u.hp + (heal ? gain : 0) } : u)) }
  }
  if (o.type !== 'tier') return {}
  const k = afterTier(s.kinds[o.kind], o.track)
  return { kinds: { ...s.kinds, [o.kind]: k }, party: s.party.map((u) => (u.id === o.kind ? { ...u, lvl: k.lvl, tracks: k.tracks } : u)) }
}

// ── the Shop ─────────────────────────────────────────────────────────────────────────────────────

// Basic buys a Command relic it can pay for and L may take, the first on the shelf; then gives a piece relic waiting to
// the first fielded soul that holds none (the first such relic, the first such soul); else it leaves. The expert gives
// what waits where it is worth most (pickHold), then buys what is worth its price (buyFor), a relic at a time, and
// leaves when neither is.
function pickShop (run, L, sit) {
  if (L.spend) return pickHold(run, L, sit) ?? buyFor(run, L, sit) ?? { type: 'leave' }
  const s = run.state
  const index = s.shop.findIndex((id, i) => id && gives(relicDef(id), 'run.command') && !banned(L, id) && canBuy(run, i))
  if (index >= 0) return { type: 'buy', index }
  const relic = unheld(s)[0]
  const holder = relic && souls(s.party).find((u) => u.slot >= 0 && u.hp > 0 && !u.relics?.length && canHold(s, relic, u))
  return holder ? { type: 'hold', relic, uid: holder.uid } : { type: 'leave' }
}

// What the expert buys (redesign.md §2.11: a relic bought is a tier not bought): of the relics on the shelf it can pay
// for and L may take, the one whose sketch gains most for each essence it costs (owned, and a piece relic held where it
// is worth most: held; the book's worth of the combo it plays toward counts it at work, comboWorth), if that beats the
// tiers its price displaces, the best a tier of the retinue's kinds gives an essence (tierRate), and gains anything at
// all. → a buy, or null.
function buyFor (run, L, sit = null) {
  const s = run.state
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

// The sketch of state `s`, owning relic `id`, with it held where it is worth most if it is a piece relic: given to the
// standing soul whose sketch it raises most (one holding its fill gives back its first), else left unheld.
function held (s, id, L) {
  let best = sketch(s, L)
  if (isRunRelic(id)) return best
  for (const u of standing(souls(s.party))) {
    if (u.relics?.includes(id)) continue
    const relics = [...(u.relics ?? []).slice(Math.max(0, (u.relics?.length ?? 0) - TUNING.relic.perPiece + 1)), id]
    best = Math.max(best, sketch({ ...s, party: s.party.map((x) => (x === u ? { ...x, relics } : x)) }, L))
  }
  return best
}

// What an essence buys in tiers: the best sketch gain per essence among the next tiers of the kinds the retinue holds
// (and each with the tier after it on its track, as one: grow), whatever the purse holds now, for essence kept waits
// for them. 0 where no tier is left to buy, or none may be (the tracks ablation).
function tierRate (run, L, base) {
  const s = run.state
  if (L.ablate === 'tracks') return 0
  let best = 0
  for (const kind of heldKinds(s)) {
    for (const track of [0, 1]) {
      let st = s
      let cost = 0
      for (let k = 0; k < 2 && canAdvance(st, kind, track); k++) {
        cost += tierCost({ state: st }, kind, track)
        st = { ...st, ...offerState(st, { type: 'tier', kind, track }) }
        best = Math.max(best, (sketch(st, L) - base) / cost)
      }
    }
  }
  return best
}

// The expert's relics in hand (out of battle: a held relic works only on the field): one a fallen soul holds is given
// back (it fights for no one until an altar), then each piece relic waiting goes to the standing soul where the sketch
// says it is worth most (grow: one holding its fill gives back its first, which waits to be weighed again), if that
// adds anything. → a hold or an unhold, or null.
function pickHold (run, L, sit) {
  const s = run.state
  const fallen = souls(s.party).find((u) => u.hp <= 0 && u.relics?.length)
  if (fallen) return { type: 'unhold', uid: fallen.uid }
  const ids = [...new Set(unheld(s))]
  if (!ids.length) return null
  const options = ids.flatMap((relic) => standing(souls(s.party)).filter((u) => canHold(s, relic, u)).map((u) => ({ type: 'hold', relic, uid: u.uid })))
  return grow(run, L, options, 'hold', sit)
}

export function policy (run, rng, level = 'basic', turnOptions = null) {
  const L = typeof level === 'string' ? LEVELS[level] : level
  const s = run.state
  if (L.ablate) {
    if (!ABLATIONS.includes(L.ablate)) throw new Error(`unknown ablation "${L.ablate}": ${ABLATIONS.join(', ')}`)
    if (RULE_SWITCHES.includes(L.ablate) && !s.ablate?.includes(L.ablate)) throw new Error(`ablating ${L.ablate} needs a run made with it (ablatedRun)`)
  }
  if (s.phase === 'battle') return battleOrder(run, L, turnOptions)
  // The expert's survey of the run, read once for this decision (basic reads none).
  const sit = L.spend || L.route ? survey(run, L) : null
  if (s.phase === 'map') return pickNode(run, rng, L, sit)
  if (s.phase === 'prep') return pickPrep(run, L, sit)
  if (s.phase === 'reap') return pickReap(run, L, sit)
  if (s.phase === 'shop') return pickShop(run, L, sit)
  throw new Error(`no policy for phase "${s.phase}"`)
}

// In a battle: the level's turn policy (turnsOf: LEVELS `turns`, End Turn alone under the orders ablation), planned
// once at the turn's start and given an order at a time, End Turn last, as playOut would give them (so a refight under
// the same policy plays the same battle); planned again should the next no longer be legal (an order given meanwhile by
// someone else: a test's). Under the audit, each of its decisions is noted with its rule. `turnOptions` go to the turn
// policy as they are (policy.js expertTurn's: the learner's `record` and `explore`); L's `learned` false keeps it to
// today's static evaluation.
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
    planned.set(b, (p = { turn: b.turn, orders: TURNS[turnsOf(L)](b, { ...turnOptions, note, ...(L.learned === false && { learned: false }) }) }))
  }
  return p.orders.shift()
}

// Plays the run to the end. onBattle(battle, run) fires after each battle, once the run has moved on, and
// beforeFight(run) just before each fight is applied (the run as the battle will be set up from it); `turnOptions` go
// to every turn of the expert's (policy.js expertTurn: the learner's `record` and `explore`). A
// clear is the end too: neither level descends past the Sovereign (the policy has nothing for 'over'), so
// the ladder's clears and floors keep their meaning; the endless floors are a player's (and a test's).
export function autoplay (run, { rng = createRng(run.state.seed).stream('autoplay'), level = 'basic', onBattle = null, beforeFight = null, turnOptions = null } = {}) {
  for (let guard = 0; run.state.phase !== 'over'; guard++) {
    if (guard > 1e5) throw new Error('autoplay is stuck')
    const was = run.state.phase
    const action = policy(run, rng, level, turnOptions)
    if (action.type === 'fight') beforeFight?.(run)
    apply(run, action)
    // On turns a battle ends with an order, not with the fight that opened it.
    if (run.state.phase !== 'battle' && (action.type === 'fight' || was === 'battle')) onBattle?.(run.battle, run)
  }
  return run
}

// ── playing many runs ─────────────────────────────────────────────────────────────────────────────

// Of a battle's army (your pieces that took the board; not the Monarch, not shadows): how many there
// were, and how many acted at least once (an action event of theirs).
export function armyMeasures (b) {
  const mine = (uid) => {
    const u = b.byUid.get(uid)
    return !!u && u.side === 'party' && !u.shadow && u !== b.monarch
  }
  const army = new Set()
  const acted = new Set()
  for (const e of b.events) {
    if (e.type === 'battle:start') for (const u of e.units) if (mine(u.uid)) army.add(u.uid)
    if (e.type === 'action' && mine(e.actor)) acted.add(e.actor)
  }
  return { army: army.size, acted: [...army].filter((uid) => acted.has(uid)).length }
}

// A run's build, as the ladder's spread reads it: its Legendaries, the kin most of its fielded souls share
// (ties to the first by name; none without souls), and the tracks their kinds took.
const legendariesOf = (s) => s.relics.filter(legendary)
const buildOf = (s) => {
  const kins = {}
  for (const u of fielded(souls(s.party))) kins[unitDef(u.id).kin] = (kins[unitDef(u.id).kin] ?? 0) + 1
  const kin = Object.entries(kins).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '-'
  const tracks = [...new Set(fielded(souls(s.party)).flatMap((u) => tracksOf(u.id).filter((_, i) => u.tracks[i] > 0).map((t) => t.id)))].sort()
  return { legendaries: legendariesOf(s).sort().join('+') || '-', kin, tracks: tracks.join('+') || '-' }
}

// One seeded run at `level` (with `ablate`, that level with one mechanic taken away: ABLATIONS), as the
// reports need it: each battle as the retinue entered it (its pieces: not the Monarch, not the shadows it
// raised), its army (its pieces, how many fell, the summons its tiers brought, its 2×2 pieces, how many
// acted: armyMeasures), with
// `setups` what it was built from (for refighting) and with `snapshots` the run's state just before the fight
// (for refighting with a mechanic stripped: necessity; its log left out); how the run ended, what felled the
// Monarch, the army it ended with, its build (buildOf), and how many of each action it took (`acts`, by type;
// `tiers`: track tiers its kinds hold at the end; `relics` held, every copy, and the `legendaries` among them).
export function record ({ seed, level, ablate = null, setups = false, snapshots = false, learned = true }) {
  const battles = []
  const t0 = Date.now()
  const run = ablatedRun(seed, ablate)
  const L = { ...LEVELS[level], ...(ablate && { ablate }), ...(!learned && { learned: false }) }
  let snap = null
  // The battle the run fell in: its room's rank and the share of its foes' HP removed (progressOf).
  let fell = null
  autoplay(run, {
    level: L,
    beforeFight: snapshots ? (r) => { snap = structuredClone({ ...r.state, log: [] }) } : null,
    onBattle: (b, r) => {
      if (b.winner !== 'party') fell = { rank: currentNode(r).rank, share: foeShare(b) }
      const party = b.units.filter((u) => u.side === 'party' && !u.shadow && u !== b.monarch)
      battles.push({
        floor: b.floor + (b.boss ? 'B' : ''),
        t: b.turn,
        stall: b.reason === 'stall',
        won: b.winner === 'party',
        lvl: party.reduce((n, u) => n + u.lvl, 0) / Math.max(1, party.length),
        size: party.length,
        roster: soulCount(r.state.party),
        foes: b.units.filter((u) => u.side === 'foe').length,
        relics: r.state.relics.length,
        raised: b.raised,
        pieces: party.length,
        fell: party.filter((u) => u.hp <= 0).length,
        summoned: b.units.filter((u) => u.summoned).length,
        waves: b.events.filter((e) => e.type === 'wave').length,
        foesIn: b.events.filter((e) => e.type === 'enter' && e.unit.side === 'foe').length,
        colossi: r.setup.party.filter((u) => u.uid !== 0 && sizeOf(u) === 2).length,
        ...armyMeasures(b),
        camp: r.state.camp,
        setup: setups ? r.setup : undefined,
        snapshot: snapshots ? snap : undefined,
        outcome: snapshots ? { won: b.winner === 'party', t: b.turn, hash: timelineHash(b.events), turns: turnsOf(L) } : undefined
      })
    }
  })
  const s = run.state
  return {
    battles, result: s.result, floor: s.floor, camp: s.camp, relics: s.relics.length, reaped: s.stats.reaped,
    monarch: { maxHp: monarchOf(s).maxHp, command: fieldCap(run), copies: s.relics.filter(grantsArise).length, ...ariseOf(s) }, death: s.death, legendaries: legendariesOf(s), build: buildOf(s),
    ossuary: souls(s.party).filter((u) => u.slot < 0).length,
    acts: s.log.reduce((n, a) => ({ ...n, [a.type]: (n[a.type] ?? 0) + 1 }), {}),
    tiers: Object.values(s.kinds).reduce((n, k) => n + k.tracks[0] + k.tracks[1], 0),
    // How far it got (progressOf), and where it fell (null for a clear).
    progress: progressOf({ result: s.result, floor: s.floor, rank: fell?.rank ?? 1, share: fell?.share ?? 0 }),
    fell,
    // Wall time of the run, in seconds (the only field that is not a pure function of the job).
    secs: (Date.now() - t0) / 1000
  }
}

// One seeded run at `level` with the audit on (AUDIT): what its plans considered and what it fought with, the
// recruits and fusions it weighed and took, and per battle Arise's raises and the party's synergies.
export function auditRecord ({ seed, level }) {
  const t0 = Date.now()
  const battles = { n: 0, won: 0, raised: 0, synergies: 0 }
  const run = createRun({ seed })
  resetAudit(true, run)
  autoplay(run, {
    level,
    beforeFight: (r) => chose(r.state, fielded(r.state.party)),
    onBattle: (b) => {
      battles.n++
      battles.won += b.winner === 'party'
      battles.raised += b.raised
      battles.synergies += b.events[0]?.synergies.filter((x) => x.side === 'party').length ?? 0
    }
  })
  const s = run.state
  const acts = {}
  for (const a of s.log) {
    acts[a.type] = (acts[a.type] ?? 0) + 1
  }
  const out = {
    seed, level, result: s.result, floor: s.floor, secs: (Date.now() - t0) / 1000, battles, acts,
    candidates: AUDIT.candidates, plans: AUDIT.plans, considered: AUDIT.considered, chosen: AUDIT.chosen, done: AUDIT.done, rules: AUDIT.rules,
    example: AUDIT.example
  }
  resetAudit(false)
  return out
}

// The audit (--audit): `runs` expert runs and one basic run, side by side, per mechanic: how often its plans
// considered it (formations met that use it, options weighed) and how often it chose it (formations fought
// that use it, actions taken).
async function audit ({ runs, seed: seed0 }) {
  const t0 = Date.now()
  const jobs = [...Array.from({ length: runs }, (_, k) => ({ seed: `${seed0}-${k + 1}`, level: 'expert', audit: true })), { seed: `${seed0}-1`, level: 'basic', audit: true }]
  const played = await playAll(jobs)
  const groups = [['expert', played.filter((r) => r.level === 'expert')], ['basic', played.filter((r) => r.level === 'basic')]]
  const sum = (rs, f) => rs.reduce((n, r) => n + (f(r) ?? 0), 0)
  console.log(`audit: ${runs} expert run(s) (seeds ${seed0}-1…${runs}) and one basic, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  for (const [level, rs] of groups) {
    console.log(`  ${level}: ${rs.map((r) => `${r.seed} ${r.result ?? 'over'} floor ${r.floor}, ${r.battles.n} battles, ${r.secs.toFixed(0)} s`).join('; ')}`)
  }
  const row = (name, considered, chosen) => console.log(`${name.padEnd(34)}${groups.map(([, rs]) => `${String(considered(rs)).padStart(11)}${String(chosen(rs)).padStart(9)}`).join('   ')}`)
  console.log(`\n${''.padEnd(34)}${groups.map(([l]) => `${l.padStart(11)} ${''.padStart(8)}`).join('   ')}`)
  console.log(`${'mechanic'.padEnd(34)}${groups.map(() => `${'considered'.padStart(11)}${'chosen'.padStart(9)}`).join('   ')}`)
  row('formations (met/fought)', (rs) => sum(rs, (r) => r.candidates), (rs) => sum(rs, (r) => r.plans))
  for (const f of FEATURES) row(f, (rs) => sum(rs, (r) => r.considered[f]), (rs) => sum(rs, (r) => r.chosen[f]))
  const fusions = (book) => (r) => Object.entries(r[book]).reduce((n, [k, v]) => n + (k.startsWith('fuse ') ? v : 0), 0)
  row('fuse (weighed/done)', (rs) => sum(rs, fusions('considered')), (rs) => sum(rs, (r) => r.acts.fuse))
  row('recruit (weighed/done)', (rs) => sum(rs, (r) => r.considered.recruit), (rs) => sum(rs, (r) => r.done.recruit))
  row('release (done)', () => '-', (rs) => sum(rs, (r) => r.acts.release))
  row('relic bought (done)', () => '-', (rs) => sum(rs, (r) => r.acts.buy))
  row('relic given (weighed/done)', (rs) => sum(rs, (r) => r.considered.hold), (rs) => sum(rs, (r) => r.acts.hold))
  row('upgrade (weighed/bought)', (rs) => sum(rs, (r) => r.considered.upgrade), (rs) => sum(rs, (r) => r.done.upgrade))
  // Which rule of the tree decided each decision, or the weights alone, over the expert's runs, with the situation
  // the first such decision was read in.
  const experts = groups[0][1]
  const rules = {}
  for (const r of experts) for (const [k, n] of Object.entries(r.rules)) rules[k] = (rules[k] ?? 0) + n
  console.log('\nthe expert\'s decisions, by the rule that decided them (the weights where none did), and the first one\'s situation:')
  for (const [k, n] of Object.entries(rules).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    console.log(`  ${k.padEnd(32)} ${String(n).padStart(7)}  ${experts.map((r) => r.example[k]).find(Boolean) ?? ''}`)
  }
  console.log('\nfought, per level:')
  for (const [level, rs] of groups) {
    const n = Math.max(1, sum(rs, (r) => r.battles.n))
    console.log(`  ${level}: Arise ${(sum(rs, (r) => r.battles.raised) / n).toFixed(2)} raises and ${(sum(rs, (r) => r.battles.synergies) / n).toFixed(2)} synergies a battle; ${sum(rs, (r) => r.battles.won)}/${n} won`)
  }
}

// How far a run got, from 0 to 1: the rooms it completed out of the rooms on the full route to the Sovereign
// (ROOMS_PER_FLOOR a floor, TUNING.run.floors floors), with partial credit for the battle it fell in: the share
// of that battle's foe HP it removed (foeShare) counts as that share of its room. 1 for a clear (the Sovereign
// slain). `rank` is the rank of the room it fell in (1 … ROOMS_PER_FLOOR: the rooms before it on its floor are
// completed); `share` in [0, 1]. Continuous where the clear rate is all or nothing, so far less noisy run for run.
export const ROOMS_PER_FLOOR = RANKS - 1
export const routeRooms = () => ROOMS_PER_FLOOR * TUNING.run.floors
export function progressOf ({ result, floor, rank = 1, share = 0 }) {
  if (result === 'victory') return 1
  const done = (floor - 1) * ROOMS_PER_FLOOR + (rank - 1) + Math.min(1, Math.max(0, share))
  return Math.min(1, Math.max(0, done / routeRooms()))
}
// The share of a battle's foe HP removed: of the foes that stood on the board or were still to come (the
// reserve's waves), shadows left out (they are no foe the room brought).
export function foeShare (b) {
  let hp = 0
  let max = 0
  for (const u of [...b.units, ...b.reserve]) {
    if ((u.side ?? 'party') !== 'foe' || u.shadow) continue
    hp += Math.max(0, u.hp)
    max += u.maxHp
  }
  return max ? 1 - hp / max : 0
}

// Plays every job in worker threads, one per core (or WORKERS: --workers), and returns the results in the jobs' order.
// The workers live for the whole call, each playing job after job, the longest first (jobTime: how long the job took
// the last time it was played here, else a guess), so the pool ends on short jobs. Which job runs where and when
// changes no result: a run is a pure function of its job.
let WORKERS = null
async function playAll (jobs) {
  const { Worker } = await import('node:worker_threads')
  const { availableParallelism } = await import('node:os')
  const times = loadTimes()
  const out = new Array(jobs.length)
  const queue = [...jobs.keys()].sort((a, b) => jobTime(jobs[b], times) - jobTime(jobs[a], times) || a - b)
  const worker = async () => {
    const w = new Worker(new URL(import.meta.url), { workerData: { pool: true } })
    try {
      while (queue.length) {
        const i = queue.shift()
        const t0 = Date.now()
        out[i] = await new Promise((resolve, reject) => {
          const off = () => { w.off('message', done); w.off('error', fail); w.off('exit', exit) }
          const done = (msg) => { off(); resolve(msg) }
          const fail = (err) => { off(); reject(err) }
          const exit = (code) => { off(); reject(new Error(`worker exited with ${code}`)) }
          w.on('message', done)
          w.on('error', fail)
          w.on('exit', exit)
          w.postMessage(jobs[i])
        })
        times[timeKey(jobs[i])] = (Date.now() - t0) / 1000
      }
    } finally {
      await w.terminate()
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs.length, WORKERS ?? availableParallelism()) }, worker))
  saveTimes(times)
  return out
}

// How long each job took when last played on this machine, in seconds, by its seed, level and ablation (a
// small file in the OS's temp directory; read only to order the next pool's jobs, and never needed: without
// it the guess orders them).
const TIMES = 'retinue-job-times.json'
const timeKey = (job) => job.refight ? null : `${job.seed}|${job.level}|${job.ablate ?? ''}`
function loadTimes () {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.tmpdir(), TIMES), 'utf8'))
  } catch { return {} }
}
function saveTimes (times) {
  delete times.null
  try { fs.writeFileSync(path.join(os.tmpdir(), TIMES), JSON.stringify(times)) } catch {}
}
// A job's expected length: its last time if known, else a guess (an expert run far longer than a basic one, the
// full expert longest of all: it lives longest; a chunk of refights all alike).
const jobTime = (job, times) => times[timeKey(job)] ?? (job.refight || job.level === 'basic' ? 1 : job.ablate ? 4 : 5)

// ── balance report ─────────────────────────────────────────────────────────────────────────────

// Autoplays `runs` seeded runs and prints clear rate, battle length, per-floor progression and how each
// camp layout fares: a camp far off its floor's average is a balance outlier.
// With `ablate`, the level with that mechanic taken away (ABLATIONS).
async function report ({ runs, seed: seed0, level, ablate = null, learned = true }) {
  const played = await playAll(Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level, ablate, ...(!learned && { learned }) })))
  const battles = played.flatMap((r) => r.battles)
  const turns = battles.map((b) => b.t).sort((a, b) => a - b)
  const deaths = {}
  const floors = {} // floor (B = boss) → sums at the start of each battle there
  const camps = {} // camp id → { battles, won, ended: runs lost in it }
  for (const b of battles) {
    const f = (floors[b.floor] ??= { n: 0, lvl: 0, size: 0, roster: 0, foes: 0, relics: 0, won: 0 })
    f.n++
    for (const k of ['lvl', 'size', 'roster', 'foes', 'relics', 'won']) f[k] += b[k]
    const c = (camps[b.camp] ??= { battles: 0, won: 0, ended: 0 })
    c.battles++
    c.won += b.won
  }
  for (const r of played) {
    if (r.result === 'defeat') camps[r.camp].ended++
    if (r.result !== 'victory') deaths[r.floor] = (deaths[r.floor] ?? 0) + 1
  }
  const sum = (key) => played.reduce((n, r) => n + r[key], 0)
  const q = (p) => turns[Math.min(turns.length - 1, Math.floor(p * turns.length))]
  const pct = (n) => `${(100 * n / runs).toFixed(1)}%`
  console.log(`runs ${runs} (seed ${seed0}, ${level} player${ablate ? `, ${ablate} ablated` : ''})`)
  console.log(`clear rate        ${pct(played.filter((r) => r.result === 'victory').length)}`)
  for (let f = 1; f <= TUNING.run.floors; f++) console.log(`deaths on floor ${f} ${pct(deaths[f] ?? 0)}`)
  console.log(`battles           ${turns.length}, ${(turns.length / runs).toFixed(1)} per run`)
  console.log(`battle turns      median ${q(0.5)}, p90 ${q(0.9)}, max ${turns.at(-1)}, stalls ${battles.filter((b) => b.stall).length}`)
  console.log(`mean souls reaped ${(sum('reaped') / runs).toFixed(2)}`)
  console.log('\nper floor, averaged over battles fought there (retinue as it entered the battle):')
  console.log('floor  battles  won    field lvl  fielded  roster  foes  relics')
  for (const [k, f] of Object.entries(floors)) {
    const avg = (v, d = 1) => (v / f.n).toFixed(d)
    console.log(`${k.padEnd(5)}  ${String(f.n).padStart(7)}  ${pct(f.won * runs / f.n).padStart(5)}  ${avg(f.lvl).padStart(9)}  ${avg(f.size).padStart(7)}  ${avg(f.roster).padStart(6)}  ${avg(f.foes).padStart(4)}  ${avg(f.relics).padStart(6)}`)
  }
  console.log('\nper camp (battles fought in it; runs that ended there in defeat):')
  console.log('floor  camp               battles  won     defeats')
  for (const [id, c] of Object.entries(camps).sort((a, b) => campDef(a[0]).floor - campDef(b[0]).floor || a[0].localeCompare(b[0]))) {
    console.log(`${String(campDef(id).floor).padEnd(5)}  ${campDef(id).name.padEnd(17)}  ${String(c.battles).padStart(7)}  ${(100 * c.won / c.battles).toFixed(1).padStart(5)}%  ${String(c.ended).padStart(7)}`)
  }
}

// ── skill ladder ─────────────────────────────────────────────────────────────────────────────────

// What ended a run, one cause per defeat: the Monarch's killer's own first threat, or 'stall' for a battle played
// past the sim's bound on turns (turns.js stalled: no clock, a passive side held it); none for a run that did not end
// in one. Depth (the killer came in a later wave: death.wave) is counted apart (see ladder), so the causes add up to
// the defeats.
export const causesOf = (death) => !death ? [] : [death.reason === 'stall' ? 'stall' : death.threat ?? 'none']

// The same seeds at every level: how far planning lifts a run over rules of thumb. The gap between
// basic and expert is the game's skill range; a gap near zero means the choices barely matter, and an
// expert clear rate near 100% means a planner has solved it.
async function ladder ({ runs, seed: seed0 }) {
  const levels = Object.keys(LEVELS)
  const played = await playAll(levels.flatMap((level) => Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level }))))
  console.log(`runs ${runs} per level (seed ${seed0}), the same seeds at each`)
  console.log('level    clear  died on floor 1      2      3      4  battles won  relics  reaped')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const pct = (n, d = runs) => `${(100 * n / d).toFixed(1)}%`
    const died = (f) => pct(mine.filter((r) => r.result !== 'victory' && r.floor === f).length).padStart(7)
    const battles = mine.flatMap((r) => r.battles)
    const avg = (key) => (mine.reduce((n, r) => n + r[key], 0) / runs).toFixed(1)
    console.log(`${level.padEnd(6)}  ${pct(mine.filter((r) => r.result === 'victory').length).padStart(6)}  ${' '.repeat(8)}${[1, 2, 3, 4].map(died).join('')}  ${pct(battles.filter((b) => b.won).length, battles.length).padStart(11)}  ${avg('relics').padStart(6)}  ${avg('reaped').padStart(6)}`)
  })
  // The Monarch at the run's end (its max HP, its Command, Arise's copies: all relics'), shadows raised per battle,
  // and what ended the run, by the killer's first threat or a stall (causesOf).
  console.log('\nlevel   monarch hp  com  arise  raised/battle  deaths by threat')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const avg = (f) => (mine.reduce((n, r) => n + f(r), 0) / runs).toFixed(1)
    const battles = mine.flatMap((r) => r.battles)
    const causes = {}
    for (const r of mine) for (const k of causesOf(r.death)) causes[k] = (causes[k] ?? 0) + 1
    const tally = Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '-'
    const raised = (battles.reduce((n, b) => n + b.raised, 0) / Math.max(1, battles.length)).toFixed(2)
    console.log(`${level.padEnd(6)}  ${avg((r) => r.monarch.maxHp).padStart(10)}  ${avg((r) => r.monarch.command).padStart(3)}  ${avg((r) => r.monarch.copies).padStart(5)}  ${raised.padStart(13)}  ${tally}`)
  })
  // The army: pieces in the ossuary at the run's end; per battle, the pieces fielded, the pieces that fell, the
  // summons their tiers brought, and the 2×2 pieces fielded.
  console.log('\nlevel    ossuary   pieces/battle  fell/battle  summons/battle  2×2/battle')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const avg = (f) => (mine.reduce((n, r) => n + f(r), 0) / runs).toFixed(1)
    const battles = mine.flatMap((r) => r.battles)
    const per = (key) => (battles.reduce((n, b) => n + b[key], 0) / Math.max(1, battles.length)).toFixed(2)
    console.log(`${level.padEnd(6)}  ${avg((r) => r.ossuary).padStart(8)}  ${per('pieces').padStart(14)}  ${per('fell').padStart(11)}  ${per('summoned').padStart(14)}  ${per('colossi').padStart(10)}`)
  })
  // The enemy as an army: foe waves that entered and foes that entered after the start, per battle; and the
  // Monarch's deaths by threat, floor by floor.
  console.log('\nlevel   waves/battle  foes in/battle  Monarch deaths by threat, by floor')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const battles = mine.flatMap((r) => r.battles)
    const per = (key) => (battles.reduce((n, b) => n + b[key], 0) / Math.max(1, battles.length)).toFixed(2)
    const floors = {}
    for (const r of mine) {
      if (!r.death) continue
      const f = (floors[r.floor] ??= {})
      for (const k of causesOf(r.death)) f[k] = (f[k] ?? 0) + 1
    }
    const tally = Object.entries(floors).sort((a, b) => a[0] - b[0])
      .map(([f, c]) => `${f}: ${Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`).join('; ') || '-'
    console.log(`${level.padEnd(6)}  ${per('waves').padStart(12)}  ${per('foesIn').padStart(14)}  ${tally}`)
  })
  // reDESIGN's "How to measure it", against its targets: the share of the army that acted at least once
  // (70%+), of defeats where the Monarch died (30–60%), the largest single cause's share of those deaths (no threat
  // above 40%), the deaths by a foe of a later wave (depth) and the defeats by a stall (no Monarch died: a battle
  // played past the sim's bound on turns); the median battle length by floor; and the build
  // spread in wins (no build in more than ~25%): the commonest Legendaries, kin and tracks.
  console.log('\nlevel   acted  Monarch deaths/defeats  top threat  depth  stalls')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const battles = mine.flatMap((r) => r.battles)
    const share = (n, d) => (d ? `${(100 * n / d).toFixed(0)}%` : '-')
    const army = battles.reduce((n, b) => n + b.army, 0)
    const lost = mine.filter((r) => r.death)
    const killed = lost.filter((r) => r.death.reason === 'monarch')
    const causes = {}
    for (const r of killed) for (const k of causesOf(r.death)) causes[k] = (causes[k] ?? 0) + 1
    const top = Object.entries(causes).sort((a, b) => b[1] - a[1])[0]
    const cols = [
      level.padEnd(6),
      share(battles.reduce((n, b) => n + b.acted, 0), army).padStart(5),
      `${killed.length}/${lost.length} ${share(killed.length, lost.length)}`.padStart(22),
      (top ? `${top[0]} ${share(top[1], killed.length)}` : '-').padStart(10),
      String(killed.filter((r) => r.death.wave).length).padStart(5),
      String(lost.length - killed.length).padStart(6)
    ]
    console.log(cols.join('  '))
  })
  console.log('\nlevel   median battle turns by floor')
  levels.forEach((level, i) => {
    const floors = {}
    for (const b of played.slice(i * runs, (i + 1) * runs).flatMap((r) => r.battles)) (floors[b.floor] ??= []).push(b.t)
    const median = (ts) => ts.sort((a, b) => a - b)[Math.floor(ts.length / 2)]
    console.log(`${level.padEnd(6)}  ${Object.entries(floors).sort((a, b) => parseInt(a[0]) - parseInt(b[0]) || a[0].length - b[0].length).map(([f, ts]) => `${f}: ${median(ts)} (${ts.length})`).join('  ') || '-'}`)
  })
  console.log('\nlevel   wins  build spread in wins: the commonest Legendaries, kin, tracks, and Legendaries+kin')
  levels.forEach((level, i) => {
    const wins = played.slice(i * runs, (i + 1) * runs).filter((r) => r.result === 'victory')
    const commonest = (f) => {
      const n = {}
      for (const r of wins) n[f(r.build)] = (n[f(r.build)] ?? 0) + 1
      const [k, c] = Object.entries(n).sort((a, b) => b[1] - a[1])[0] ?? ['-', 0]
      return `${k} ${wins.length ? (100 * c / wins.length).toFixed(0) : 0}%`
    }
    console.log(`${level.padEnd(6)}  ${String(wins.length).padStart(4)}  ${[(b) => b.legendaries, (b) => b.kin, (b) => b.tracks, (b) => `${b.legendaries}|${b.kin}`].map(commonest).join('; ')}`)
  })
}

// ── decisions report ─────────────────────────────────────────────────────────────────────────────

// How much the player's formation decides battles: every battle the autoplayer fights is fought again
// `tries` times with its souls in random open cells. A choice that never changes the result is
// cosmetic; one that always does makes a bad pick an automatic loss. Aim for the share decided by the
// cells to sit around 30–40% on floors 2–4. Most fights are wins either way, so HP kept (the share of
// the field's HP still standing at the end, 0 for a loss) shows what a formation is worth when it is
// not the result: wounds carry over to the next fight.
async function decisions ({ runs, seed: seed0, level, tries = 8 }) {
  const played = await playAll(Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level, setups: true })))
  const setups = played.flatMap((r) => r.battles.map((b) => b.setup))
  const rng = createRng(seed0).stream('decisions')
  const floors = {}
  const KEYS = ['n', 'auto', 'random', 'decided', 'autoHp', 'randomHp', 'spreadHp']
  for (const setup of setups) {
    const fight = (party) => {
      const b = playOut(createBattle({ ...setup, party, quiet: true }), TURNS[turnsOf(LEVELS[level])])
      const mine = b.units.filter((u) => u.side === 'party' && !u.shadow && !u.into)
      const hp = b.winner === 'party' ? mine.reduce((n, u) => n + u.hp, 0) / mine.reduce((n, u) => n + u.maxHp, 0) : 0
      return { won: b.winner === 'party', hp }
    }
    const open = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(setup.camp, slot))
    // Each piece on a random open cell where its whole footprint fits, the Monarch on its seat; a piece that fits
    // nowhere left sits out.
    const shuffle = (party) => {
      const cells = rng.shuffle(open)
      const taken = new Set()
      const out = []
      for (const u of [...party].sort((x, y) => isMonarch(y) - isMonarch(x))) {
        const size = u.size ?? sizeOf(u)
        const slot = isMonarch(u) ? monarchSlot(setup.camp) : cells.find((c) => fits(setup.camp, c, size, taken))
        if (slot === undefined) continue
        for (const c of footprintSlots(slot, size) ?? [slot]) taken.add(c)
        out.push({ ...u, slot })
      }
      return out
    }
    const auto = fight(setup.party)
    const random = Array.from({ length: tries }, () => fight(shuffle(setup.party)))
    const wins = random.filter((t) => t.won).length
    const f = (floors[setup.floor + (setup.boss ? 'B' : '')] ??= Object.fromEntries(KEYS.map((k) => [k, 0])))
    f.n++
    f.auto += auto.won
    f.random += wins / tries
    f.decided += wins > 0 && wins < tries
    f.autoHp += auto.hp
    f.randomHp += random.reduce((n, t) => n + t.hp, 0) / tries
    f.spreadHp += Math.max(...random.map((t) => t.hp)) - Math.min(...random.map((t) => t.hp))
  }
  const pct = (v, n) => `${(100 * v / n).toFixed(1)}%`
  const all = Object.fromEntries(KEYS.map((k) => [k, Object.values(floors).reduce((a, f) => a + f[k], 0)]))
  console.log(`runs ${runs} (seed ${seed0}, ${level} player), ${all.n} battles, each refought ${tries}× with the souls in random cells`)
  console.log('decided: the share of battles whose result changes with where the souls stand.')
  const COLS = [['autoplayer', 'auto'], ['random', 'random'], ['decided', 'decided'],
    ['autoplayer', 'autoHp'], ['random', 'randomHp'], ['best−worst', 'spreadHp']]
  const width = (name) => Math.max(6, name.length)
  const groups = [['won', 2], ['', 1], ['HP kept', 3]]
  let at = 0
  console.log(' '.repeat(16) + groups.map(([name, n]) => {
    const w = COLS.slice(at, (at += n)).reduce((a, [c]) => a + width(c) + 2, 0)
    return name.padEnd(w)
  }).join('').trimEnd())
  console.log('floor  battles  ' + COLS.map(([c]) => c.padStart(width(c))).join('  '))
  for (const [k, f] of [...Object.entries(floors), ['all', all]]) {
    console.log(`${k.padEnd(5)}  ${String(f.n).padStart(7)}  ` + COLS.map(([c, key]) => pct(f[key], f.n).padStart(width(c))).join('  '))
  }
}

// ── ablations: what each mechanic carries ────────────────────────────────────────────────────────────

// The full expert and the expert with each mechanic taken away (ABLATIONS), on the same `runs` seeds, every run
// in one pool: clear rate, where the runs died, what felled the Monarch, and the clear rate's drop against the
// full expert in points. `uses` counts what each variant did over its runs (actions by type, tiers held at the
// end, Legendaries and other relics taken), so an ablation can be seen to take its mechanic away. `variants` (the CLI's
// `--variants fusions,summons`) plays only those ablations beside the full expert, for a quicker check. Each drop
// is checked against its band (BANDS): a core mechanic should cost 25–50 points, an extra one 8–25. The core: the
// orders given in battle, the tracks and the summons a piece's tiers bring. MEASURED: played and reported, against no
// band: the formation, reclassified out of the core on 2026-10-11 (the user's call, after the balance pass measured it
// at 2 points: pieces move in battle, so the orders absorb most of where a piece starts; redesign.md §6); and the
// moves (redesign.md §2.18: what the plan's walking is worth).
export const CORE = ['orders', 'tracks', 'summons']
export const EXTRA = ['fusions', 'legendaries', 'relics', 'synergies']
export const MEASURED = ['formation', 'moves']
export const BANDS = { ...Object.fromEntries(CORE.map((m) => [m, [25, 50]])), ...Object.fromEntries(EXTRA.map((m) => [m, [8, 25]])) }
async function ablations ({ runs, seed: seed0, variants = ABLATIONS, out = null }) {
  variants = [null, ...variants]
  const t0 = Date.now()
  const played = await playAll(variants.flatMap((ablate) => Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level: 'expert', ablate }))))
  // With `out`, every run's outcome as JSON (for pairing two sweeps seed by seed).
  if (out) {
    fs.writeFileSync(out, JSON.stringify({
      runs, seed: seed0, minutes: (Date.now() - t0) / 60000,
      played: played.map((r, i) => ({ seed: `${seed0}-${i % runs}`, ablate: variants[Math.floor(i / runs)], result: r.result, floor: r.floor, fell: r.fell, progress: r.progress, secs: r.secs }))
    }, null, 1))
  }
  console.log(`runs ${runs} per variant (seed ${seed0}), the expert with one mechanic taken away, the same seeds each; ${((Date.now() - t0) / 60000).toFixed(1)} min` +
    ` (${(played.reduce((n, r) => n + r.secs, 0) / played.length).toFixed(1)} s a run)`)
  console.log('variant        clear  died on floor 1    2    3    4   drop  Monarch deaths by threat')
  const clear = (mine) => mine.filter((r) => r.result === 'victory').length / runs
  const full = clear(played.slice(0, runs))
  const rows = variants.map((ablate, i) => ({ ablate, mine: played.slice(i * runs, (i + 1) * runs) }))
  for (const { ablate, mine } of rows) {
    const died = (f) => String(mine.filter((r) => r.result !== 'victory' && r.floor === f).length).padStart(5)
    const causes = {}
    for (const r of mine) for (const k of causesOf(r.death)) causes[k] = (causes[k] ?? 0) + 1
    const tally = Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '-'
    const drop = ablate ? (100 * (full - clear(mine))).toFixed(0) : '-'
    console.log(`${(ablate ?? 'full').padEnd(13)}  ${(100 * clear(mine)).toFixed(0).padStart(4)}%  ${' '.repeat(13)}${[1, 2, 3, 4].map(died).join('')}  ${drop.padStart(5)}  ${tally}`)
  }
  console.log('\nuses over the runs: orders given in battle (moves and acts), recruits made, fusions made, track tiers held, relics')
  console.log('held when they ended (Legendaries, the rest), and relics given to a soul')
  console.log('variant        orders  reaped  fuse  tiers  legend  relics  holds')
  for (const { ablate, mine } of rows) {
    const sum = (f) => String(mine.reduce((n, r) => n + f(r), 0)).padStart(6)
    console.log(`${(ablate ?? 'full').padEnd(13)}  ${[(r) => (r.acts.move ?? 0) + (r.acts.act ?? 0), (r) => r.reaped,
      (r) => r.acts.fuse ?? 0, (r) => r.tiers, (r) => r.legendaries.length, (r) => r.relics - r.legendaries.length, (r) => r.acts.hold ?? 0].map(sum).join(' ')}`)
  }
  // Progress (progressOf): continuous, so it reads a mechanic's cost on far fewer runs than the clear rate. Runs
  // are paired by seed: a variant's drop and its standard error are those of the seed-by-seed difference from
  // the full expert. The progress drop is put on the clear rate's scale by k, the least-squares slope through
  // the origin of the clear drop on the progress drop across the variants played (clear-eq = k × progress drop).
  const prog = rows.map(({ mine }) => mine.map((r) => r.progress))
  const mean = (xs) => xs.reduce((n, x) => n + x, 0) / xs.length
  const se = (xs) => xs.length > 1 ? Math.sqrt(xs.reduce((n, x) => n + (x - mean(xs)) ** 2, 0) / (xs.length - 1) / xs.length) : 0
  const pdrops = rows.map(({ ablate, mine }, i) => {
    const diff = prog[0].map((p, j) => 100 * (p - prog[i][j]))
    return { ablate, clearDrop: 100 * (full - clear(mine)), drop: mean(diff), se: se(diff) }
  }).slice(1)
  const sxy = pdrops.reduce((n, d) => n + d.drop * d.clearDrop, 0)
  const sxx = pdrops.reduce((n, d) => n + d.drop * d.drop, 0)
  const k = sxx > 0 ? sxy / sxx : 1
  const verdict = (ablate, v) => !BANDS[ablate] ? '(no band)' : v < BANDS[ablate][0] ? 'under' : v > BANDS[ablate][1] ? 'over' : 'in'
  console.log(`\nprogress: rooms completed of the ${routeRooms()} on the route to the Sovereign, the battle lost counted by the share of its`)
  console.log(`foe HP removed (1 = cleared); drops in points, paired by seed (± one standard error of the paired difference);`)
  console.log(`clear-eq = k × progress drop, k = ${sxx > 0 ? k.toFixed(2) : '1 (no drop to fit)'}: the least-squares slope through the origin of the clear drop on the progress drop (${pdrops.length} variants)`)
  console.log('variant        clear  progress   ±se   drop    ±se  clear-eq   ±se  band    verdict')
  console.log(`${'full'.padEnd(13)}  ${(100 * full).toFixed(0).padStart(4)}%  ${(100 * mean(prog[0])).toFixed(1).padStart(8)}  ${(100 * se(prog[0])).toFixed(1).padStart(4)}`)
  for (const [i, d] of pdrops.entries()) {
    const band = BANDS[d.ablate] ? BANDS[d.ablate].join('–') : '-'
    console.log(`${d.ablate.padEnd(13)}  ${(100 * clear(rows[i + 1].mine)).toFixed(0).padStart(4)}%  ${(100 * mean(prog[i + 1])).toFixed(1).padStart(8)}  ${' '.repeat(4)}  ${d.drop.toFixed(1).padStart(5)}  ${d.se.toFixed(1).padStart(5)}  ` +
      `${(k * d.drop).toFixed(1).padStart(8)}  ${(k * d.se).toFixed(1).padStart(4)}  ${band.padEnd(6)}  ${verdict(d.ablate, k * d.drop)}`)
  }
  const drops = rows.filter((r) => BANDS[r.ablate]).map((r) => ({ ablate: r.ablate, drop: 100 * (full - clear(r.mine)), band: BANDS[r.ablate] }))
  const list = (xs) => xs.map((d) => `${d.ablate} ${d.drop.toFixed(0)}`).join(', ') || '-'
  console.log(`\ncheck: full expert ${(100 * full).toFixed(0)}% (target >= 90%), progress ${(100 * mean(prog[0])).toFixed(1)}; drops against their bands (core 25–50: ${CORE.join(', ')}; extra 8–25: ${EXTRA.join(', ')}; measured, no band: ${MEASURED.join(', ')})`)
  const eq = pdrops.filter((d) => BANDS[d.ablate]).map((d) => ({ ablate: d.ablate, drop: k * d.drop, band: BANDS[d.ablate] }))
  console.log('  by clear-eq (k × progress drop):')
  console.log(`    in band: ${list(eq.filter((d) => d.drop >= d.band[0] && d.drop <= d.band[1]))}`)
  console.log(`    too small: ${list(eq.filter((d) => d.drop < d.band[0]))}`)
  console.log(`    too large: ${list(eq.filter((d) => d.drop > d.band[1]))}`)
  console.log('  by clear rate:')
  console.log(`    in band: ${list(drops.filter((d) => d.drop >= d.band[0] && d.drop <= d.band[1]))}`)
  console.log(`    too small: ${list(drops.filter((d) => d.drop < d.band[0]))}`)
  console.log(`    too large: ${list(drops.filter((d) => d.drop > d.band[1]))}`)
}

// ── necessity: the same, battle by battle (a fast proxy) ─────────────────────────────────────────────

// The run, as it stood just before a fight (a snapshot of record), with one mechanic stripped (null: as it
// was), for battleSetup to set the battle up from. → a run { state, battle, setup }
//   orders         as it stood: refight plays it with End Turn alone
//   arise, synergies, summons  the rules switch (as the full ablation's)
//   fusions        every fused piece back in its parts (unfused)
//   tracks         no tier on any track, and so every kind at the level that gives (a fused kind's `least` kept; its
//                  souls' wounds kept as a share)
//   legendaries    no Legendary, Arise and its variants among them (the Command and the souls' relics as without them)
//   relics         no Common, Uncommon or Rare relic (no such mods, no such triggers, the field and the Monarch's
//                  max HP as without them, its wounds kept as a share)
//   formation      the souls in basic's first draft's cells
//   moves          as it stood: refight plays it with an expert that never moves a piece
// A soul holds only the relics the run still owns.
export const NECESSITY = ABLATIONS
export function stripped (state, mechanic = null) {
  const s = structuredClone(state)
  const run = { state: s, battle: null, setup: null }
  const team = souls(s.party)
  const relevel = (u, lvl) => {
    const max = baseStats(u.id, lvl).hp
    u.hp = u.hp > 0 ? Math.max(1, Math.round(u.hp / u.maxHp * max)) : 0
    u.lvl = lvl
    u.maxHp = max
  }
  if (RULE_SWITCHES.includes(mechanic)) {
    s.ablate = [...(s.ablate ?? []), mechanic]
  } else if (mechanic === 'fusions') {
    unfused(s)
  } else if (mechanic === 'tracks') {
    for (const k of Object.values(s.kinds)) {
      k.tracks = [0, 0]
      k.lvl = levelOf(k)
    }
    for (const u of team) {
      u.tracks = [0, 0]
      relevel(u, s.kinds[u.id].lvl)
    }
  } else if (mechanic === 'legendaries') {
    s.relics = s.relics.filter((id) => !legendary(id))
  } else if (mechanic === 'relics') {
    s.relics = s.relics.filter(legendary)
  } else if (mechanic === 'formation') {
    const at = new Map(basicCells(run, fielded(s.party), LEVELS.expert).map((u) => [u.uid, u.slot]))
    for (const u of s.party) if (at.has(u.uid)) u.slot = at.get(u.uid)
  } else if (mechanic !== null && mechanic !== 'orders' && mechanic !== 'moves') {
    throw new Error(`unknown mechanic "${mechanic}": ${NECESSITY.join(', ')}`)
  }
  // A soul holds only relics the run still owns (a relic stripped is no one's).
  const owned = s.relics.slice()
  for (const u of souls(s.party)) {
    if (!u.relics) continue
    u.relics = u.relics.filter((id) => {
      const i = owned.indexOf(id)
      if (i >= 0) owned.splice(i, 1)
      return i >= 0
    })
  }
  // The Monarch's max HP as its relics now give it (its wounds kept as a share).
  const m = monarchOf(s)
  const max = monarchHp(s)
  if (m.maxHp !== max) {
    m.hp = m.hp > 0 ? Math.max(1, Math.round(m.hp / m.maxHp * max)) : 0
    m.maxHp = max
  }
  // A smaller field (no relic adding Command): the weakest standing souls past it to the ossuary.
  const cap = fieldCap(run)
  for (const u of standing(fielded(souls(s.party))).sort(byFieldPower).slice(cap)) u.slot = -1
  return run
}

// A run's state with every fused piece back in its parts (the recipe whose result it is: FUSION_LIST): as many pieces
// of each kind as the recipe takes, at its kind's level and tiers (for a kind the run never held, its first level,
// with none), wounded as the fused piece was; each on the first of the fused piece's cells it fits (a 2×2 piece's
// four, the anchor first), else in the ossuary. Mutates s.
function unfused (s) {
  for (const u of souls(s.party).filter((x) => unitDef(x.id).fused)) {
    const recipe = FUSION_LIST.find((r) => r.result === u.id)
    if (!recipe) continue
    const cells = cellsOf(u)
    s.party = s.party.filter((x) => x !== u)
    const taken = new Set(s.party.filter((x) => x.slot >= 0).flatMap(cellsOf))
    for (const [kind, n] of Object.entries(recipe.needs)) {
      const k = s.kinds[kind] ?? { lvl: kindLevel(s, kind), tracks: [0, 0] }
      for (let i = 0; i < n; i++) {
        const part = makeUnit(kind, { uid: s.nextUid++, lvl: k.lvl, tracks: k.tracks.slice() })
        part.hp = u.hp > 0 ? Math.max(1, Math.round(part.maxHp * hpPct(u))) : 0
        part.slot = cells.find((c) => fits(s.camp, c, sizeOf(part), taken)) ?? -1
        cellsOf(part).forEach((c) => taken.add(c))
        s.party.push(part)
      }
    }
  }
}

// Refights each snapshot as it stood and once per mechanic stripped, under the turn policy it was played with, that
// mechanic taken from it (ablatedTurns: End Turn alone with the orders stripped, no fusing with the fusions, no move
// with the moves): →
// per snapshot, per variant { won, alive (the Monarch stands at the end), hp (the share of your side's HP kept, 0 for
// a loss) }, and whether the as-it-stood refight played out exactly as the real battle did.
export function refight ({ snaps, variants = [null, ...NECESSITY] }) {
  return snaps.map(({ snapshot, outcome }) => {
    const out = {}
    for (const m of variants) {
      // Only the as-it-stood refight is compared event by event; the rest keep no events.
      const b = playOut(createBattle({ ...battleSetup(stripped(snapshot, m)), quiet: m !== null }), TURNS[ablatedTurns(outcome?.turns ?? 'basic', m)])
      const mine = b.units.filter((u) => u.side === 'party' && !u.shadow && !u.into)
      const won = b.winner === 'party'
      out[m ?? 'full'] = { won, alive: !!b.monarch && b.monarch.hp > 0, hp: won ? mine.reduce((n, u) => n + u.hp, 0) / mine.reduce((n, u) => n + u.maxHp, 0) : 0 }
      if (m === null) out.same = !!outcome && timelineHash(b.events) === outcome.hash
    }
    return out
  })
}

// The full expert's battles over `runs` runs (recorded once; with `setups`, a file: read if it is there, else
// written, so a tuning loop refights the same battles in seconds), each refought as it stood and once per
// mechanic stripped (stripped), in one pool. Per variant: battles won, the Monarch standing at the end, HP kept,
// and battles won floor by floor.
async function necessity ({ runs, seed: seed0, setups: file = null }) {
  const t0 = Date.now()
  let snaps
  if (file && fs.existsSync(file)) {
    snaps = JSON.parse(fs.readFileSync(file, 'utf8'))
  } else {
    const played = await playAll(Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level: 'expert', snapshots: true })))
    snaps = played.flatMap((r) => r.battles.map((b) => ({ floor: b.floor, snapshot: b.snapshot, outcome: b.outcome })))
    if (file) fs.writeFileSync(file, JSON.stringify(snaps))
  }
  const t1 = Date.now()
  const { availableParallelism } = await import('node:os')
  const per = Math.max(1, Math.ceil(snaps.length / (2 * availableParallelism())))
  const chunks = []
  for (let i = 0; i < snaps.length; i += per) chunks.push({ refight: true, snaps: snaps.slice(i, i + per) })
  const results = (await playAll(chunks)).flat()
  const variants = ['full', ...NECESSITY]
  const floors = [...new Set(snaps.map((x) => x.floor))]
  console.log(`necessity: ${snaps.length} battles of the full expert (${file && t1 - t0 < 1000 ? `from ${file}` : `${runs} runs, seed ${seed0}`}), ` +
    `each refought as it stood and with one mechanic stripped; record ${((t1 - t0) / 60000).toFixed(1)} min, refights ${((Date.now() - t1) / 60000).toFixed(1)} min`)
  console.log(`as it stood, refights identical to the real battle: ${results.filter((r) => r.same).length}/${results.length}`)
  // A run-scale reading: the share of recorded runs whose every battle is still won with the mechanic stripped
  // (a run's battles are those of one seed), and its drop against the same as it stood, in points. It reads
  // against the full ablation's clear-rate drop, though it cannot see the expert adapt (a mechanic's essence
  // spent elsewhere) nor the battles a stripped run would have fought differently.
  const seeds = [...new Set(snaps.map((x) => x.snapshot.seed))]
  const clean = (v) => seeds.filter((seed) => results.every((r, i) => snaps[i].snapshot.seed !== seed || r[v].won)).length / seeds.length
  const base = clean('full')
  console.log(`runs: ${seeds.length}; "runs clean": runs whose every battle is won; "drop": its fall against full, in points`)
  console.log('variant        won   Monarch stood  HP kept   lost  runs clean  drop   ' + floors.map((f) => `fl ${f}`.padStart(6)).join(''))
  const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : '-')
  for (const v of variants) {
    const all = results.map((r) => r[v])
    const won = all.filter((x) => x.won).length
    const cols = floors.map((f) => {
      const here = results.filter((_, i) => snaps[i].floor === f).map((r) => r[v])
      return pct(here.filter((x) => x.won).length, here.length).padStart(7)
    })
    const drop = v === 'full' ? '-' : (100 * (base - clean(v))).toFixed(0)
    console.log(`${v.padEnd(13)}  ${pct(won, all.length).padStart(6)}  ${pct(all.filter((x) => x.alive).length, all.length).padStart(13)}  ${pct(all.reduce((n, x) => n + x.hp, 0), all.length).padStart(7)}  ${String(all.length - won).padStart(5)}  ${pct(clean(v), 1).padStart(10)}  ${drop.padStart(4)}   ${cols.join('')}`)
  }
}

// Run directly: a report, or (in a worker thread of playAll) one run. The default runs a report plays: about one
// expert run per core of an 8-core machine, so each finishes in about the time of its slowest run.
const RUNS = { sim: 8, decisions: 8, ladder: 8, ablations: 8, necessity: 8 }
if (typeof process !== 'undefined' && process.argv[1] === decodeURIComponent(new URL(import.meta.url).pathname)) {
  const { isMainThread, parentPort, workerData } = await import('node:worker_threads')
  if (!isMainThread) {
    // A pool's worker (playAll): job after job, until it is let go.
    const play = (job) => (job.audit ? auditRecord(job) : job.refight ? refight(job) : record(job))
    if (workerData?.pool) parentPort.on('message', (job) => parentPort.postMessage(play(job)))
    else parentPort.postMessage(play(workerData))
  } else {
    const arg = (name, def) => {
      const i = process.argv.indexOf('--' + name)
      return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
    }
    const opts = { seed: arg('seed', 'sim'), level: arg('level', 'expert') }
    // `--workers n`: the pool's size (one per core by default); `--static`: the expert's turns and formations by today's
    // static evaluation, whatever value.js holds (a report's alone).
    if (arg('workers', null) !== null) WORKERS = Math.max(1, Number(arg('workers', 1)))
    const learned = !process.argv.includes('--static')
    if (!LEVELS[opts.level]) throw new Error(`unknown level "${opts.level}": ${Object.keys(LEVELS).join(', ')}`)
    const ablate = arg('ablate', null)
    if (ablate !== null && !ABLATIONS.includes(ablate)) throw new Error(`unknown ablation "${ablate}": ${ABLATIONS.join(', ')}`)
    // `--variants full` (alone or with others): the full expert only, beside whatever ablations are named.
    const variants = arg('variants', null)?.split(',').filter((v) => v !== 'full') ?? ABLATIONS
    for (const v of variants) if (!ABLATIONS.includes(v)) throw new Error(`unknown ablation "${v}": ${ABLATIONS.join(', ')}`)
    if (process.argv.includes('--combos')) makeBook()
    else if (process.argv.includes('--audit')) await audit({ seed: arg('seed', 'audit'), runs: Number(arg('runs', 4)) })
    else if (process.argv.includes('--ablations')) await ablations({ ...opts, variants, runs: Number(arg('runs', RUNS.ablations)), out: arg('out', null) })
    else if (process.argv.includes('--necessity')) await necessity({ ...opts, runs: Number(arg('runs', RUNS.necessity)), setups: arg('setups', null) })
    else if (process.argv.includes('--decisions')) await decisions({ ...opts, runs: Number(arg('runs', RUNS.decisions)) })
    else if (process.argv.includes('--ladder')) await ladder({ ...opts, runs: Number(arg('runs', RUNS.ladder)) })
    else await report({ ...opts, ablate, learned, runs: Number(arg('runs', RUNS.sim)) })
  }
}
