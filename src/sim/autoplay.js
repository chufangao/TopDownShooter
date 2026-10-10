// A player for tests and balance runs: a policy that picks one action at a time for apply(). It plays at
// one of two levels (LEVELS), on the same choices and the same scouting a player has:
//   basic   rules of thumb: a standing piece the field has no place for stacks onto the strongest fielded piece
//           of its kind, and with room on the field and none standing left in the ossuary a stack splits a body off
//           (pickStack); rooms by weighted dice, the strongest souls fielded in the best of three drafted
//           formations, the first free offer (a relic, a Legendary, a tier), recruits only to fill the field,
//           essence on the lowest kind's next tier (on the track it is on); it never fuses
//   expert  plans, and has studied the combo book (BOOK, src/sim/combos.json, made by --combos): every route over
//           the next few ranks played out; the formation drafted as the puzzle it is (zone drafts from the scouted
//           room's threat map about the seat, its gate held, basic's three) and hill-climbed by rehearsal, the best
//           few fought again on fresh rolls, a 2×2 piece wherever its footprint fits; every purchase, fusion, stack,
//           split and recruit weighed by one growth search on a sketch (the field's strength and the book's worth of
//           the combo it plays toward: targetOf), the free offers by rehearsing the fights ahead in a row, the
//           Monarch's HP carried from each into the next, at the edge of what the army can beat (prospects); its
//           target's kinds fielded first and never let go while another will do
// Essence buys only tiers, recruits and fusions: the Monarch's HP and Command come from relics, a kind's level from
// its tiers (run.js). The Monarch is the camp's (run.js: on its seat, monarchSlot); no level moves it, and every
// piece holds the cell it is given all battle (DESIGN §3).
// It knows the rules, not the rolls: rehearsals and rollouts never use a battle's own seed. A rehearsal ends once
// its result is settled (battle.js settled), and the formation search fights a formation's remaining rolls only
// while they could still change its choice (plan: TUNING.autoplay.settle, prune).
// Run directly for a balance report:  node src/sim/autoplay.js [--runs 8] [--seed sim] [--level expert]
// for the gap between the levels:     … --ladder [--runs 8]
// or for a report on how much the player's choices decide battles:  … --decisions [--runs 8]
// or the expert with one mechanic taken away (ABLATIONS):  … --ablate fusions  (a report as above)
// for how much each mechanic carries the expert, full runs:  … --ablations [--runs 8] [--variants full,fusions,bodies] [--out runs.json]
// or as a fast battle-level proxy (its battles refought stripped): … --necessity [--runs 8] [--setups file]
// or what the expert considers against what it chooses, mechanic by mechanic (AUDIT):  … --audit [--runs 4] [--seed audit]
// or the expert's combo book, ranked by rehearsal and written to src/sim/combos.json (rerun when content or numbers
// change):  … --combos
// (the defaults, RUNS, are sized to one expert run per core: an expert run takes minutes; see README)
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRng } from './rng.js'
import {
  statsOf, tracksOf, tiersOf, nextTracks, CENTRE_OUT, CAMP_SLOTS, CAMP_ROWS, campOpen, wallTiles, steps, deployTile, tileAt, TILES, LANES,
  rowOf, colOf, rangeOf, isAllyShape, distance, makeUnit, slotAt, baseStats, bodiesOf, livingBodies, DEPTH, sizeOf, footprintSlots, fits,
  monarchSlot, ringOf, abilitiesOf, isBlow
} from './unit.js'
import { createBattle, playOut, timelineHash, field } from './battle.js'
import {
  createRun, apply, availableNodes, fieldCap, rosterCap, fielded, inOssuary, currentNode, battleSetup, tierCost,
  isMonarch, monarchOf, souls, canAdvance, holds, soulCount, heldKinds, canPlace, canFuse, fuseParts, OSSUARY,
  relicTier, levelOf, kindLevel, monarchHp, ariseOf, drawRoom, commandOf
} from './run.js'
import { nodeOf, RANKS, generateFloor } from './map.js'
import { TUNING } from '../tuning.js'
import { unitDef, abilityDef, campDef, relicDef, fusionDef, FUSION_LIST, UNIT_LIST, TRACKS, SYNERGIES, CAMP_LIST, RELIC_LIST } from '../content.js'

// seeds: rehearsals per formation (0: take the first draft unrehearsed); drafts: how many of the
// drafts to try (all by default); search: formations tried by hill-climbing from the best draft;
// wounds: field by worth with wounds counted; rollouts: walks per route when choosing a room (0:
// weighted dice), over the next `horizon` rooms; reap: weigh free offers by rehearsing the fights
// ahead; spend: grow by the growth search (grow) rather than by rule of thumb; fuse: weigh each fusion it can make (else it never fuses); book: play toward the combo book's best reachable combo (targetOf); sizeUp: the rehearsals that size up an offer;
// more: draft the expert's formations too (on the roads, a screen and a pocket about the Monarch: drafts);
// finalists, validate: the best `finalists` formations of the search fought again on `validate` fresh rolls, the
// best of them taken.
export const LEVELS = {
  basic: { seeds: 1, search: 0, wounds: false, rollouts: 0, reap: false, spend: false, fuse: false },
  expert: {
    seeds: 4, search: 12, finalists: 8, validate: 4, comfort: 1.8, hard: { search: 60, finalists: 12, validate: 6 }, sizeUp: { seeds: 1, drafts: 2 },
    wounds: true, rollouts: 1, horizon: 3, reap: true, spend: true, fuse: true, more: true, book: true
  }
}
// How an expert imagines a route (quick formations, basic offers), and sizes up an offer.
const ROLLOUT = { seeds: 0, search: 0, wounds: true, rollouts: 0, reap: false, spend: false, fuse: false, more: true }
// How it sizes up a room it could walk into next: every draft, on two rolls (pickRoute).
const RISK = { ...ROLLOUT, seeds: 2 }

// ── ablation: the expert with one mechanic taken away ─────────────────────────────────────────────

// For measuring how much each mechanic carries the expert (--ablations, --necessity): a level's `ablate`
// takes ONE mechanic from it and changes nothing else; essence it would have spent there goes where its
// spending logic already sends it. Everything it plays ahead with (rehearsals, rollouts, sizing up an offer
// or a purchase) carries the same ablation:
//   arise          never takes the Arise relic, so it never raises and is never offered what needs
//                  Arise; and the Monarch's Arise never casts (a rules switch: the run's `ablate`, carried in every
//                  battle's setup), so a snapshot stripped of it (necessity) fights without it too
//   fusions        never fuses (fusionOptions lists none)
//   bodies         no tier adds a body in battle (a rules switch, as arise), and such a tier is worth only its
//                  place on the track (worth: its bodies not counted), so the essence goes elsewhere
//   tracks         never buys a track tier, and takes nothing of a reliquary's tiers (its kinds stay at their first
//                  level: a level is its tiers')
//   legendaries    never takes a Legendary relic but Arise (Arise is its own: arise)
//   relics         never takes a Common, Uncommon or Rare relic (so neither HP nor Command: the field stays at
//                  TUNING.party.field, Legion's aside)
//   synergies      the party holds no synergy in battle, at any step (a rules switch, as arise)
//   formation      no formation search: its souls in basic's first draft's cells (who it fields still its own)
// (monarch-stats and levels went with the Monarch's points and the bought levels, 2026-10-09.)
// A run of an ablation that is a rules switch must be made with it (ablatedRun); policy refuses one that is not.
// Arise is measured with the Legendaries (it is one), and fusions as an extra: both have substitutes the expert
// spends on instead (the user's call after the balance pass, 2026-10-09).
export const ABLATIONS = ['fusions', 'bodies', 'tracks', 'legendaries', 'relics', 'synergies', 'formation']
export const RULE_SWITCHES = ['arise', 'synergies', 'bodies']
export const ablatedRun = (seed, ablate = null) => createRun({ seed, ablate: RULE_SWITCHES.includes(ablate) ? [ablate] : null })
// A level as it plays ahead for L: the same ablation carried.
const as = (base, L) => (L.ablate ? { ...base, ablate: L.ablate } : base)
// Whether L never takes this free offer.
const legendary = (id) => relicTier(id) === 'legendary'
const BANNED = {
  tracks: (o) => o.type === 'tier',
  legendaries: (o) => o.type === 'relic' && legendary(o.id),
  relics: (o) => o.type === 'relic' && !legendary(o.id)
}
const banned = (L, o) => !!BANNED[L.ablate]?.(o)

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
const byPower = (a, b) => power(b) - power(a) || a.uid - b.uid
// An expert counts wounds: a soul at 10% HP is not worth fielding at full price.
const byFieldPower = (a, b) => fieldPower(b) - fieldPower(a) || a.uid - b.uid

// Rough fighting worth from its stats, track tiers included: how long a body lasts times how hard it hits,
// square-rooted, for each living body and each body its tiers add (unless `bodies` is false: the bodies
// ablation's). A tier that grants an ability, an aura or a Colossus's footprint counts as a tenth more. 0 for the
// fallen, and for the Monarch, which never strikes: what it is worth only a rehearsal can tell.
function worth (u, bodies = true) {
  if (u.hp <= 0 || isMonarch(u)) return 0
  const s = statsOf(u)
  const lasts = s.hp * (1 + s.def / 100) / s.damage.taken * (1 + s.eva / 60)
  const hits = s.atk * s.damage.dealt * (TUNING.gauge.base + s.spd / TUNING.gauge.spdDivisor) * s.gauge.rate *
    (1 + s.crt / 100 * (TUNING.crit.mult - 1)) * (s.acc / (s.acc + 15)) * (1 + 0.3 * (s.heal.given - 1))
  const signature = tiersOf(u).filter((t) => t.ability || t.aura || t.size).length
  return Math.sqrt(lasts * hits) * (1 + 0.1 * signature) * (livingBodies(u) + (bodies ? bodiesOf(u) : 0))
}
const power = worth
const fieldPower = (u) => worth(u) * Math.sqrt(hpPct(u))

// The run as it would be standing in another room: what battleSetup needs, nothing copied.
const atNode = (run, node, state = {}) => ({ ...run, state: { ...run.state, ...state, at: node.id } })
// A copy to play ahead on, with its own rolls (`roll`: a rollout's).
function fork (run, roll) {
  const state = structuredClone(run.state)
  if (roll !== undefined) state.seed = `${state.seed}|rollout|${roll}`
  return { state, battle: null, setup: null }
}

// The rooms reachable from `from` within `depth` steps, nearest first.
function ahead (map, from, depth) {
  const seen = new Set()
  let edge = [from]
  for (let d = 0; d < depth && edge.length; d++) {
    edge = [...new Set(edge.flatMap((id) => nodeOf(map, id).next))].filter((id) => !seen.has(id))
    for (const id of edge) seen.add(id)
  }
  return [...seen].map((id) => nodeOf(map, id))
}

// ── map: the route ───────────────────────────────────────────────────────────────────────────────

function pickNode (run, rng, L) {
  const spend = pickSpend(run, L)
  if (spend) return spend
  const nodes = availableNodes(run)
  if (L.rollouts && nodes.length > 1) return { type: 'node', id: pickRoute(run, L) }
  const health = partyHealth(run.state.party)
  const w = { fight: 3, elite: health > 0.7 ? 1.5 : 0.3, reliquary: 2, altar: health < 0.6 ? 5 : 0.5, boss: 1, siege: health > 0.7 ? 1.5 : 0.3 }
  return { type: 'node', id: rng.weighted(nodes, nodes.map((n) => w[n.type])).id }
}

// The expert walks every route over the next `horizon` rooms `rollouts` times on its own rolls, with
// quick formations and basic offers, and takes the first room of the route that ends best on average. A
// rollout's quick formation can win a fight by luck, so first it sizes up each battle room it could walk into
// next (RISK: every draft, the expert's too, on two rolls): a room where its best formation still loses a
// rehearsal is walked into only when every room ahead is one. A loss ends the run; an elite's relic does not
// pay for a coin flip.
function pickRoute (run, L) {
  const start = strength(run.state)
  const next = availableNodes(run)
  const lost = new Set(next.filter((n) => n.foes && plan(atNode(run, n), as(RISK, L), { enough: 1 }).score < 1).map((n) => n.id))
  const safe = (route) => lost.size === next.length || !lost.has(route.split(' ')[0])
  const totals = new Map() // route → summed value
  for (let k = 0; k < L.rollouts; k++) {
    for (const [route, value] of rollout(fork(run, k), start, L.horizon, as(ROLLOUT, L))) totals.set(route, (totals.get(route) ?? 0) + value)
  }
  let best = null
  for (const [route, value] of totals) if (safe(route) && (!best || value > best.value)) best = { route, value }
  return best.route.split(' ')[0]
}

// Every route from here, `depth` rooms deep or to the floor's end, as [route, value]: 0 for a run lost
// on the way (a fall in the deep too, though the clear stands), 2 for the boss slain, else 1 plus half the
// retinue's strength at the route's end over its strength now, the Monarch's third of it (as a rehearsal weighs it
// beside the souls: scoreOf) by the share of its HP it has left where nothing will mend it (Court of Bone: a Monarch
// bled low there counts as low, never as whole; elsewhere the run mends it, and it counts as whole, as before). Its
// HP is the run's own, carried room to room. Routes that share their first rooms share those fights: the walk only
// branches where the map does.
function rollout (sim, start, depth, R, route = []) {
  const next = nodeOf(sim.state.map, sim.state.at).next
  return next.flatMap((id, i) => {
    const branch = i === next.length - 1 ? sim : fork(sim)
    const floor = branch.state.floor
    apply(branch, { type: 'node', id })
    while (branch.state.phase === 'prep' || branch.state.phase === 'reap') apply(branch, policy(branch, null, R))
    const s = branch.state
    const here = [...route, id]
    if (s.phase === 'over') return [[here.join(' '), s.result === 'victory' && !s.death ? 2 : 0]]
    const share = holds(s, 'unhealable') ? (2 + hpPct(monarchOf(s))) / 3 : 1
    if (s.floor !== floor || here.length >= depth) return [[here.join(' '), 1 + 0.5 * strength(s) / start * share]]
    return rollout(branch, start, depth, R, here)
  })
}

// What a retinue brings to its next fight: the fieldable pieces' wounded power (their bodies counted), raised
// by relics.
function strength (s, bodies = true) {
  const best = souls(s.party).map((u) => worth(u, bodies) * Math.sqrt(hpPct(u))).sort((a, b) => b - a).slice(0, fieldCap({ state: s }))
  return best.reduce((n, p) => n + p, 0) * (1 + 0.08 * s.relics.length) || 1
}

// ── prep: the formation ──────────────────────────────────────────────────────────────────────────────

// The autoplayer arranges its souls with the same choice a player has: any camp cell where a piece's footprint
// fits (unit.js fits: a 2×2 piece needs its four cells open), the Monarch on its seat (the camp's: it never
// moves). It drafts a few formations and rehearses each against the scouted foes on a different battle seed (it
// knows the rules, not the rolls), keeping the one that does best; ties keep the earlier draft. Basic's three:
//   rows       each role's row (ROW), packed from the middle lane (auras want neighbours)
//   spread     each role's row, every other lane first (against area attacks)
//   sheltered  the melee where foes walking in arrive first; ranged souls behind the walls, where foes
//              must walk furthest to reach them for how close they stand
// The expert (`more`) reads the placement as the puzzle it is. Pieces never move and fight what their blows reach in
// their ring, and every foe makes for the seat, so the fighting is on the roads, most of it where they meet at the
// seat. The scouted room becomes a threat map (threatOf: each tile a foe will pass, by its bodies, a flyer's in
// the air apart), a cell is worth to a piece what of that its ring reaches (reach: the air only with a ranged
// blow), and its drafts are filled greedily from that (zone): at a few radii about the seat, the reach shared
// out or bunched; with its gate held where the camp has one (gated: the fewest cells that close every ground
// road, so every walker meets one of them). Then one search: it hill-climbs from the best draft (mutate),
// and fights the best few again on fresh rolls (plan). A piece that fits nowhere waits in the ossuary (slot −1).

const SPREAD = [3, 1, 5, 2, 4, 0, 6]
const blasts = (foes) => foes.some((f) => unitDef(f.id).abilities.some((id) => abilityDef(id).shape === 'blast'))
const reachOf = (u) => Math.max(1, ...unitDef(u.id).abilities.map(abilityDef).filter((a) => !isAllyShape(a.shape)).map(rangeOf))
// Each role's row in a drafted formation (0 the camp's front): the vanguard ahead, the ranged behind.
const ROW = { vanguard: 0, skirmisher: 1, warden: 1, trickster: 1, ranger: 2, channeler: 2 }
const rowFor = (u) => ROW[unitDef(u.id).role] ?? 1

// The camp cells a formation entry covers: its footprint from its anchor (none in the ossuary).
const cover = (u) => (u.slot >= 0 ? footprintSlots(u.slot, sizeOf(u)) ?? [u.slot] : [])
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
    for (const c of cover(u)) taken.add(c)
  }
  return true
}

// Keep units already where their footprint fits past `taken` (a Set of cells, claimed as they go); place the rest,
// the 2×2 first (they need the room), in the first cell they fit of their role's row (rowFor, an anchor's row),
// spilling to the nearest rows, columns in `cols` order; −1 where none is left. Mutates and returns units.
function byRows (units, cols, camp, taken) {
  const rest = []
  for (const u of units) {
    if (u.slot >= 0 && fits(camp, u.slot, sizeOf(u), taken)) cover(u).forEach((c) => taken.add(c))
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
      cover(u).forEach((x) => taken.add(x))
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
  const melee = (u) => reachOf(u) === 1
  const order = units.slice().sort((a, b) => melee(b) - melee(a) || rowFor(a) - rowFor(b))
  for (const u of order) {
    const off = (slot) => Math.abs(rowOf(slot) - rowFor(u))
    const score = melee(u) ? (slot) => walk(slot) : (slot) => -(walk(slot) - rowOf(slot) - 1)
    const free = open.filter((slot) => fits(camp, slot, sizeOf(u), taken))
    u.slot = free.sort((a, b) => score(a) - score(b) || off(a) - off(b) || lane(a) - lane(b))[0] ?? -1
    cover(u).forEach((c) => taken.add(c))
  }
  return units
}

// The expert's zone drafts: [radius about the seat (Chebyshev, from a footprint's nearest tile), how much of a tile's
// threat stays once a piece reaches it (1: bunched, every piece on the busiest tiles; less: shared out over the
// roads), how steeply the threat grows toward the seat]. The first is the one a quick formation takes (SIZE_UP,
// ROLLOUT).
const ZONES = [[2, 1, 1], [Infinity, 0.5, 0.5], [1, 1, 2], [3, 0.5, 1]]
// The zone drafts with the `first` (the book's for its target: its `draft`) first.
const zones = (first = 0) => [ZONES[first] ?? ZONES[0], ...ZONES.filter((_, i) => i !== (ZONES[first] ? first : 0))]

// The formations L drafts for these units (`want`, in fielding order), each with the Monarch on its seat first.
export function drafts (run, want, L) {
  const s = run.state
  const m = { ...monarchOf(s), slot: monarchSlot(s.camp) }
  const blank = () => want.map((u) => ({ ...u, slot: -1 }))
  const lanes = blasts(currentNode(run).foes) ? [SPREAD, CENTRE_OUT] : [CENTRE_OUT, SPREAD]
  const rows = (cols) => [{ ...m }, ...byRows(blank(), cols, s.camp, seated(s.camp))]
  const basic = [rows(lanes[0]), rows(lanes[1]), [{ ...m }, ...sheltered(blank(), s.camp, seated(s.camp))]]
  if (!L.more) return basic
  const threat = threatOf(run)
  const gate = gated(blank(), s.camp, threat)
  return [
    ...zones(L.book ? targetOf(s)?.draft : 0).map(([radius, keep, steep]) => [{ ...m }, ...zone(blank(), s.camp, threatOf(run, steep), { radius, keep })]),
    ...(gate ? [[{ ...m }, ...gate]] : []), ...basic
  ]
}

// The scouted room as a threat map: every foe piece, the opening's from where it stands and each later wave's from
// the top edge of its lane, walked to the seat, a walker by the camp's arrows (roadsTo), a flyer by the air road's
// (roadsTo's `air`, over the walls; a piece on it holds the flyer there, but where the pieces stand is what the map is
// for); each tile it passes takes its bodies × (1 + road distance)^−steep: the nearer the seat, where every road ends
// and the fighting gathers, the more.
// → { ground, air }, each a Float64Array by tile.
const threats = new Map()
function threatOf (run, steep = 1) {
  const s = run.state
  const node = currentNode(run)
  const key = JSON.stringify([s.camp, steep, node.foes, node.waves?.map((w) => w.foes)])
  if (threats.has(key)) return threats.get(key)
  const roads = roadsTo(s.camp)
  const ground = new Float64Array(TILES)
  const air = new Float64Array(TILES)
  const foes = [...node.foes.map((x) => [x, deployTile('foe', x.slot)]), ...(node.waves ?? []).flatMap((w) => w.foes.map((x) => [x, tileAt(colOf(x.slot), DEPTH - 1)]))]
  for (const [foe, from] of foes) {
    const flies = !!unitDef(foe.id).flies
    const f = flies ? roads.air : roads.field
    for (const t of roadFrom(from, f)) (flies ? air : ground)[t] += (foe.count ?? 1) / (1 + f.dist[t]) ** steep
  }
  const out = { ground, air }
  if (threats.size > 500) threats.clear()
  threats.set(key, out)
  return out
}
// A foe's road from `t` to the root, by a field's arrows (a walker's the camp's roads, a flyer's the air road).
function roadFrom (t, f) {
  const out = []
  for (let n = 0; t >= 0 && n < TILES; t = f.arrow[t], n++) out.push(t)
  return out
}

// What a piece anchored on `slot` reaches of a threat map: the ground's tiles within its ring of its footprint, the
// air's within its ranged reach (its ranged blows' range, never past its ring; none for a piece with only melee
// blows). Where it fights, whatever its blows' conditions: not only where it holds a foe (unit.js holdOf).
function reach (u, slot, { ground, air }) {
  const at = tilesAt(u, slot)
  const ring = ringOf(u)
  const sky = Math.min(ring, Math.max(-1, ...abilitiesOf(u).map(abilityDef).filter((a) => isBlow(a) && !a.melee).map(rangeOf)))
  let n = 0
  for (let t = 0; t < TILES; t++) {
    if (!ground[t] && !air[t]) continue
    let d = Infinity
    for (const x of at) d = Math.min(d, distance(x, t))
    if (d <= ring) n += ground[t]
    if (d <= sky) n += air[t]
  }
  return n
}

// A zone draft: each piece in turn (the 2×2 first, then in fielding order) on the free cell its footprint fits
// within `radius` of the seat (anywhere, where none is left there) whose reach of the threat is the most, nearer the
// seat on ties; each tile it reaches then keeps `keep` of its threat for the pieces after it. Mutates and returns units.
function zone (units, camp, threat, { radius = Infinity, keep = 1, taken = seated(camp) } = {}) {
  const seat = deployTile('party', monarchSlot(camp))
  const left = { ground: threat.ground.slice(), air: threat.air.slice() }
  const near = (u, slot) => Math.min(...tilesAt(u, slot).map((t) => distance(t, seat)))
  for (const u of units.slice().sort((a, b) => sizeOf(b) - sizeOf(a))) {
    if (u.slot >= 0) continue
    const free = openCells(camp).filter((slot) => fits(camp, slot, sizeOf(u), taken))
    const inside = free.filter((slot) => near(u, slot) <= radius)
    const scored = (inside.length ? inside : free).map((slot) => ({ slot, n: reach(u, slot, left), d: near(u, slot) }))
    u.slot = scored.sort((a, b) => b.n - a.n || a.d - b.d || a.slot - b.slot)[0]?.slot ?? -1
    if (u.slot < 0) continue
    cover(u).forEach((c) => taken.add(c))
    if (keep < 1) {
      const at = tilesAt(u, u.slot)
      for (let t = 0; t < TILES; t++) if (at.some((x) => distance(x, t) <= ringOf(u))) { left.ground[t] *= keep; left.air[t] *= keep }
    }
  }
  return units
}

// The camp's gate: the fewest open cells (never the seat, at most GATE) that, held, close every ground road from the
// board's top edge to the Monarch (the cells counted as walls, steps' corner rule included), so every walker's road
// runs into a piece there, none of them beside the seat if that can be had, and the furthest along the roads from it
// of those; none where it takes more. Made once per camp.
const GATE = 3
const gates = new Map()
export function gateOf (camp) {
  if (gates.has(camp)) return gates.get(camp)
  const seat = monarchSlot(camp)
  const root = deployTile('party', seat)
  const { dist } = roadsTo(camp).field
  const d = (slot) => dist[deployTile('party', slot)]
  const walls = new Uint8Array(TILES)
  for (const t of wallTiles(camp)) walls[t] = 1
  // Whether the Monarch is cut off from the top edge with `cells` held: a flood from the top edge (steps, inlined).
  const closes = (cells) => {
    const shut = walls.slice()
    for (const c of cells) shut[deployTile('party', c)] = 1
    const seen = new Uint8Array(TILES)
    const queue = []
    for (let x = 0; x < LANES; x++) { const t = tileAt(x, DEPTH - 1); seen[t] = 1; queue.push(t) }
    for (let i = 0; i < queue.length; i++) {
      const x = queue[i] % LANES
      const y = (queue[i] - x) / LANES
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if ((!dx && !dy) || nx < 0 || nx >= LANES || ny < 0 || ny >= DEPTH) continue
          const n = tileAt(nx, ny)
          if (seen[n] || shut[n] || (dx && dy && (shut[tileAt(nx, y)] || shut[tileAt(x, ny)]))) continue
          if (n === root) return false
          seen[n] = 1
          queue.push(n)
        }
      }
    }
    return true
  }
  const sets = (cells, k, from = 0) => (k === 0 ? [[]] : cells.slice(from).flatMap((c, i) => sets(cells, k - 1, from + i + 1).map((rest) => [c, ...rest])))
  const far = (set) => set.reduce((n, c) => n + d(c), 0)
  const open = openCells(camp).filter((c) => c !== seat && d(c) < Infinity)
  let gate = []
  for (const cells of [open.filter((c) => d(c) > 1), open]) {
    for (let k = 1; k <= GATE && !gate.length; k++) gate = sets(cells, k).sort((a, b) => far(b) - far(a)).find(closes) ?? []
    if (gate.length) break
  }
  gates.set(camp, gate)
  return gate
}

// The gate held (gateOf): its cells each by the toughest piece left whose footprint covers it, then every other piece
// as a zone draft fills it (zone, from the threat map). Null where the camp has no gate or the field too few pieces
// to hold it and fight beside it.
function gated (units, camp, threat) {
  const gate = gateOf(camp)
  if (!gate.length || units.length <= gate.length) return null
  const taken = seated(camp)
  const left = units.slice().sort((a, b) => toughness(b) - toughness(a) || a.uid - b.uid)
  for (const cell of gate) {
    const anchors = (u) => (sizeOf(u) === 1 ? [cell] : [cell, cell - 1, cell + LANES, cell + LANES - 1].filter((a) => footprintSlots(a, 2)?.includes(cell)))
    const u = left.find((x) => x.slot < 0 && anchors(x).some((a) => fits(camp, a, sizeOf(x), taken)))
    if (!u) return null
    u.slot = anchors(u).find((a) => fits(camp, a, sizeOf(u), taken))
    cover(u).forEach((c) => taken.add(c))
  }
  return zone(units, camp, threat, { taken })
}

// The foes' roads to the Monarch on its seat (battle.js field): `field` the walkers', the camp's walls only, and `air`
// the flyers' air road, over every tile, walls and all (battle.js airOf). Made once per camp.
const roadCache = new Map()
export function roadsTo (camp) {
  if (!roadCache.has(camp)) {
    const root = deployTile('party', monarchSlot(camp))
    roadCache.set(camp, { field: field({ root, walls: wallTiles(camp) }), air: field({ root, walls: [] }) })
  }
  return roadCache.get(camp)
}

// What a soul is worth on a tile it must hold: how much it takes to fell.
const toughness = (u) => {
  const st = statsOf(u)
  return st.hp * (1 + st.def / 100)
}

const rehearsalSeed = (setup, k) => setup.seed + '|rehearsal' + (k ? '|' + k : '')

// The budget rehearsals run on (TUNING.autoplay): a battle still going at `ceiling` ticks counts as a loss,
// and a battle of more than `bigBattle` units on the board at the start is rehearsed on one roll (the
// reserve's waves are not counted: they only enter as their time comes). Foe waves need no more: a
// ceiling counts from the last foe to enter (battle.js checkEnd), so a rehearsal always meets every wave
// (each comes at most TUNING.spawn.waves.t after the one before, well inside the budget). → { seeds, ceiling }
export function rehearsalBudget (setup, seeds) {
  const A = TUNING.autoplay
  const big = setup.party.length + setup.foes.length > A.bigBattle
  return { seeds: big ? Math.min(seeds, 1) : seeds, ceiling: A.rehearsalCeiling }
}

// A rehearsal's worth, averaged over its budget's rolls: a win by what it leaves the run, from 1 to 2: each piece's
// share of its HP after the battle's heal (TUNING.run.postBattleHeal of a body), a fallen soul's 0 (it is gone for
// good, where a wounded one mends), the souls' by their bodies weighing twice the Monarch's (its HP is the camp's to
// spend, and mends as theirs does, but not at all while nothing may heal it: Court of Bone; shadows leave anyway); a
// loss by how much of the foes' HP it took, from −LOSS − 1 to −LOSS. A fallen Monarch is a loss, whoever else stands,
// and so is the ceiling. A loss ends the run, so it weighs LOSS more than the worst win: a formation that loses one
// roll in six to save a few wounds in the other five is not the better one.
// The formation is rehearsed in the run's party order, its pieces on the field only (a piece it leaves at −1
// waits in the ossuary), as the real fight will set it up. → { score (the mean), left (the Monarch's HP at the end of
// the rolls it won, their mean; −1 with none won: what a rehearsal of the next fight carries, rehearseAhead) }, or
// null (a search's `beats`, below).
export function rehearse (run, party, want = 1, { from = 0, full = false, beats = null, stress = 0 } = {}) {
  const order = new Map(run.state.party.map((u, i) => [u.uid, i]))
  const rank = (u) => order.get(u.uid) ?? Infinity
  party = party.filter((u) => u.slot >= 0).sort((a, b) => rank(a) - rank(b))
  // `from`, `full`: a validation (plan) rehearses on seeds of its own, from `from` on, all `want` of them
  // however big the battle. `beats` (a search's: plan): told the best mean the rolls still to come could reach
  // (every one of them scoring BEST), whether that could still change the search's choice; once it could not,
  // the rest are not fought and the formation's score is null. Exact: the score it would have had is no higher.
  const setup = battleSetup(run, { party })
  if (stress) setup.foeMods = [...setup.foeMods, { path: 'hp', op: 'mul', v: 1 + stress }, { path: 'atk', op: 'mul', v: 1 + stress }]
  const budget = rehearsalBudget(setup, want)
  const { ceiling } = budget
  const seeds = full ? want : budget.seeds
  let total = 0
  let left = 0
  let won = 0
  for (let k = from; k < from + seeds; k++) {
    const roll = rehearsed({ ...setup, seed: rehearsalSeed(setup, k), ceiling })
    total += roll.score
    if (roll.left >= 0) { left += roll.left; won++ }
    if (beats && k + 1 < from + seeds) {
      // Added roll by roll, as the total itself is: rounding is monotone, so the mean it ends on is no higher.
      let most = total
      for (let j = k + 1; j < from + seeds; j++) most += BEST
      if (!beats(most / seeds)) return null
    }
  }
  return { score: total / seeds, left: won ? left / won : -1 }
}

// A rehearsal's outcome for one battle's input, fought once: { score (scoreOf), left (the Monarch's HP as a won
// battle leaves it, as it stands when the rehearsal settles; −1 for a loss, or with no Monarch) }. A battle is a pure
// function of its setup (and of TUNING and the content), so the same setup on the same seed is never refought, from
// whichever plan, draft, climb step or size-up it comes. Keyed on the setup's content (a SHA-1 digest of its JSON with
// TUNING's), not its identity. The memo is the thread's own (a Map, bounded: cleared when full), or in a pool's worker
// the table all its workers share (shareMemo). Either way a miss only costs the fight.
const MEMO_CAP = 600000
const memo = new Map()
export const memoStats = { hits: 0, misses: 0 }
function rehearsed (input) {
  const digest = createHash('sha1').update(tuningKey()).update(JSON.stringify(input)).digest()
  const have = table ? tableGet(digest) : memo.get(digest.toString('base64'))
  if (have !== undefined) { memoStats.hits++; return have }
  memoStats.misses++
  const b = playOut(createBattle({ ...input, quiet: true, settle: TUNING.autoplay.settle }))
  const out = { score: scoreOf(b), left: b.winner === 'party' && b.monarch ? b.monarch.hp : -1 }
  if (table) {
    tablePut(digest, out)
  } else {
    if (memo.size >= MEMO_CAP) memo.clear()
    memo.set(digest.toString('base64'), out)
  }
  return out
}
// TUNING as JSON, for the memo's key: tests change it between runs. Re-read on every call (it is small).
const tuningKey = () => JSON.stringify(TUNING)

// The memo a pool's workers share (playAll): an open-addressed hash table in a SharedArrayBuffer, MEMO_SLOTS
// slots of eight 32-bit words: [state, key, key, key, score, score, left, left] (state 0 empty, 1 being written, 2
// ready; the key the digest's first 96 bits; the score and the Monarch's HP left each a float64). A worker claims an
// empty slot by compare-and-swap, writes it, then marks it ready; a reader takes a slot only once it is ready. Two
// workers may fight the same battle at once and both write it (the same outcome): that costs a fight, never a
// result. Nothing is ever removed; a key that finds no free slot within MEMO_PROBES is not kept.
const MEMO_SLOTS = 1 << 23
const MEMO_BYTES = MEMO_SLOTS * 32
const MEMO_PROBES = 64
let table = null
export function shareMemo (buffer) {
  table = { words: new Int32Array(buffer), values: new Float64Array(buffer), mask: buffer.byteLength / 32 - 1 }
}
function tableGet (digest) {
  const { words, values, mask } = table
  const k0 = digest.readInt32LE(0)
  const k1 = digest.readInt32LE(4)
  const k2 = digest.readInt32LE(8)
  for (let p = 0, i = k0 & mask; p < MEMO_PROBES; p++, i = (i + 1) & mask) {
    const b = i * 8
    const state = Atomics.load(words, b)
    if (state === 0) return undefined
    if (state === 2 && words[b + 1] === k0 && words[b + 2] === k1 && words[b + 3] === k2) return { score: values[i * 4 + 2], left: values[i * 4 + 3] }
  }
  return undefined
}
function tablePut (digest, { score, left }) {
  const { words, values, mask } = table
  const k0 = digest.readInt32LE(0)
  const k1 = digest.readInt32LE(4)
  const k2 = digest.readInt32LE(8)
  for (let p = 0, i = k0 & mask; p < MEMO_PROBES; p++, i = (i + 1) & mask) {
    const b = i * 8
    const state = Atomics.load(words, b)
    if (state === 2 && words[b + 1] === k0 && words[b + 2] === k1 && words[b + 3] === k2) return
    if (state === 0 && Atomics.compareExchange(words, b, 0, 1) === 0) {
      words[b + 1] = k0
      words[b + 2] = k1
      words[b + 3] = k2
      values[i * 4 + 2] = score
      values[i * 4 + 3] = left
      Atomics.store(words, b, 2)
      return
    }
  }
}

const LOSS = 3
// The best a rehearsal can score: a win that keeps every HP (heals never pass max HP).
export const BEST = 2
export function scoreOf (b) {
  if (b.winner !== 'party') {
    const foes = b.units.filter((u) => u.side === 'foe')
    return -LOSS - (foes.length ? foes.reduce((n, u) => n + Math.max(0, u.hp), 0) / foes.reduce((n, u) => n + u.maxHp, 0) : 0)
  }
  const heal = TUNING.run.postBattleHeal
  const mend = (u) => (u !== b.monarch ? heal / (u.count ?? 1) : b.held.unhealable ? 0 : heal)
  const kept = (u) => (u.hp > 0 ? Math.min(1, u.hp / u.maxHp + mend(u)) : 0)
  const souls = b.units.filter((u) => u.side === 'party' && !u.shadow && u !== b.monarch)
  const bodies = souls.reduce((n, u) => n + (u.count ?? 1), 0)
  const army = bodies ? souls.reduce((n, u) => n + (u.count ?? 1) * kept(u), 0) / bodies : 0
  if (!b.monarch) return 1 + army
  return 1 + (bodies ? (2 * army + kept(b.monarch)) / 3 : kept(b.monarch))
}

// Who stands in the camp: the strongest standing souls, wounds counted at the expert's level.
const standing = (party) => party.filter((u) => u.hp > 0)
const TARGET_BONUS = 0.25
const wanted = (run, L) => {
  const keeps = L.book ? targetKinds(targetOf(run.state)) : null
  const w = (u) => worth(u, L.ablate !== 'bodies') * (L.wounds ? Math.sqrt(hpPct(u)) : 1) * (keeps?.has(u.id) ? 1 + TARGET_BONUS : 1)
  return standing(souls(run.state.party)).sort((a, b) => w(b) - w(a) || a.uid - b.uid).slice(0, fieldCap(run))
}

// → { party, score, left }: the best formation found for the current room, and the Monarch's HP its rehearsal left
// (rehearse; −1 with none won, or none rehearsed). Formations that put everyone in the same cells are only rehearsed
// once. `enough` (the room veto's: pickRoute): the caller asks only whether the best score reaches it; with pruning
// on, the plan stops at the first formation that does, and a formation that cannot reach it is not fought on its
// remaining rolls. The answer is the same.
function plan (run, L, { enough = Infinity, onCandidate = null } = {}) {
  const want = wanted(run, L)
  const options = drafts(run, want, L).slice(0, L.drafts ?? Infinity).map((party) => allowed(run, party, L))
  if (!L.seeds) return { party: options[0], score: 0, left: -1 }
  const tried = new Map()
  const forms = new Map()
  const lefts = new Map()
  const keyOf = (party) => party.map((u) => `${u.uid}@${u.slot}`).sort().join()
  // What a formation must beat to be worth its remaining rolls (TUNING.autoplay.prune; null: every roll fought):
  //   'best'       the best so far. A formation that cannot beat it is never taken by the search, but might have
  //                made the finalists: it no longer can (a plan may differ from one with every roll fought).
  //   'finalists'  with `validate`, a place among the best `finalists` tried so far (above the finalists-th best: a
  //                tie goes to the earlier, and scores never leave `tried`), which covers beating the best too;
  //                without, the best so far. Exact: the same plan as with every roll fought.
  // A formation whose rolls left cannot lift it past that is not rehearsed on them (rehearse `beats`) and is kept
  // as −Infinity: never taken, never a finalist.
  const cut = () => {
    if (!L.validate || TUNING.autoplay.prune === 'best') return best ? bestScore : -Infinity
    const vs = [...tried.values()].filter((v) => v > -Infinity)
    if (vs.length < L.finalists) return -Infinity
    return vs.sort((a, b) => b - a)[L.finalists - 1]
  }
  const score = (party) => {
    const key = keyOf(party)
    if (!tried.has(key)) {
      const bar = cut()
      const beats = enough < Infinity ? (most) => most >= enough : (most) => most > bar
      const r = rehearse(run, party, L.seeds, { beats: TUNING.autoplay.prune && beats, stress: L.stress })
      tried.set(key, r?.score ?? -Infinity)
      lefts.set(key, r?.left ?? -1)
      forms.set(key, party)
      onCandidate?.(party)
    }
    return tried.get(key)
  }
  let best = null
  let bestScore = -Infinity
  for (const party of options) {
    const v = score(party)
    if (!best || v > bestScore) { best = party; bestScore = v }
    if (bestScore >= enough && TUNING.autoplay.prune) return { party: best, score: bestScore, left: lefts.get(keyOf(best)) }
  }
  // A hard room (no draft wins comfortably) is thought over harder: the climb goes on while it is still not
  // comfortable, up to hard.search steps, and more finalists are fought on more fresh rolls.
  const effort = L.hard && bestScore < L.comfort ? { ...L, ...L.hard } : L
  const rng = createRng(JSON.stringify([run.state.seed, run.state.floor, run.state.at, best.map((u) => u.uid)])).stream('climb')
  const open = openCells(run.state.camp)
  for (let i = 0; i < L.search || (i < effort.search && bestScore < L.comfort); i++) {
    const next = allowed(run, mutate(best, standing(souls(run.state.party)), open, rng, run.state, L), L)
    const v = score(next)
    if (v > bestScore) { best = next; bestScore = v }
  }
  if (!L.validate) return { party: best, score: bestScore, left: lefts.get(keyOf(best)) }
  // A big battle is rehearsed on one roll, and the climb keeps whatever beat the best so far on it: it learns
  // that roll, not the fight (a formation it took could win a third of fresh rolls where a draft it passed
  // over won them all). So the best `finalists` formations it found, drafts and climbs alike, are fought again
  // on `validate` fresh rolls of their own, and the best of those is taken (ties: the earlier rehearsal).
  const top = [...tried].filter(([, v]) => v > -Infinity).sort((a, b) => b[1] - a[1]).slice(0, effort.finalists)
  let pick = null
  for (const [key, v] of top) {
    // A finalist whose rolls left cannot beat the pick so far (nor tie it with the better search score) is not
    // fought on them (exact, as above).
    const beats = TUNING.autoplay.prune && pick && ((most) => most > pick.fresh || (most === pick.fresh && v > pick.v))
    const r = rehearse(run, forms.get(key), effort.validate, { from: 100, full: true, beats })
    if (r === null) continue
    const fresh = r.score
    if (!pick || fresh > pick.fresh || (fresh === pick.fresh && v > pick.v)) pick = { key, v, fresh, left: r.left }
  }
  return pick ? { party: forms.get(pick.key), score: pick.fresh, left: pick.left } : { party: best, score: bestScore, left: lefts.get(keyOf(best)) }
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
  const taken = new Set(out.filter((u) => u !== a).flatMap(cover))
  const free = open.filter((slot) => slot !== a.slot && fits(s.camp, slot, sizeOf(a), taken))
  if (!free.length) return out
  const near = a.slot < 0 ? [] : free.filter((slot) => distance(deployTile('party', slot), deployTile('party', a.slot)) <= 2)
  a.slot = rng.pick(near.length && rng.chance(0.7) ? near : free)
  return out
}

// The plan only depends on the room, the camp, the relics, who is standing (not where), their counts, levels and
// tiers, and the uids the foes will take, so it is made once per prep however many steps carry it
// out.
const plans = new WeakMap()
export function planFor (run, L) {
  const s = run.state
  const key = JSON.stringify([L, s.floor, s.at, s.camp, s.relics, s.nextUid, s.party.map((u) => [u.uid, u.id, u.lvl, u.count, u.hp, u.maxHp, u.tracks])])
  const have = plans.get(run)
  if (have?.key === key) return have.plan
  const onCandidate = audited(run) ? (party) => { AUDIT.candidates++; for (const f of new Set(featuresOf(s, party))) note('considered', f) } : null
  const made = plan(run, L, { onCandidate }).party.map((u) => ({ uid: u.uid, slot: u.slot }))
  plans.set(run, { key, plan: made })
  return made
}

// One step toward the plan (the Monarch is on its seat already, and stays): the souls it leaves out to the
// ossuary; then a soul into its planned cell where it can go straight there (run.js canPlace: whoever covers that
// cell takes its old one, never a soul in place, for no two planned footprints share a cell); with none that can,
// a soul not yet in place to the ossuary, to clear the way; then fight.
function pickPrep (run, L) {
  const s = run.state
  const spend = pickSpend(run, L)
  if (spend) return spend
  const restack = pickStack(run, L)
  if (restack) return restack
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

// Stacks. Basic by rule of thumb: a standing piece the field has no place for (not among the strongest fieldCap)
// joins the strongest of those of its kind, a body more where it fights; and while the field has room for more
// pieces than stand, a stack splits its hindmost body off (the plan then fields it, if it stands). Never both at
// once. The expert (`spend`) weighs it instead (deliberate).
function pickStack (run, L) {
  if (L.spend) return deliberate(run, L)
  const s = run.state
  const want = wanted(run, L)
  const spare = standing(souls(s.party)).find((u) => !want.includes(u) && want.some((w) => w.id === u.id))
  if (spare) return { type: 'stack', uid: spare.uid, onto: want.find((w) => w.id === spare.id).uid }
  const big = want.length < fieldCap(run) && want.find((u) => u.count > 1)
  return big ? { type: 'split', uid: big.uid, n: 1 } : null
}

// The stacks and splits the expert weighs, beside keeping what it has (null, first): each standing piece onto the
// strongest fielded piece of its kind (one stack, bodies on one tile), and a body off each standing stack (spread
// over two tiles), at most STACK_OPTIONS of them.
const STACK_OPTIONS = 6
export function stackOptions (run) {
  const s = run.state
  const all = standing(souls(s.party))
  const out = []
  for (const kind of [...new Set(all.map((u) => u.id))]) {
    const onto = all.filter((u) => u.id === kind && u.slot >= 0).sort(byFieldPower)[0]
    if (onto) for (const u of all) if (u.id === kind && u !== onto) out.push({ type: 'stack', uid: u.uid, onto: onto.uid })
  }
  for (const u of all) if (u.count > 1) out.push({ type: 'split', uid: u.uid, n: 1 })
  return [null, ...out.slice(0, STACK_OPTIONS)]
}

// The expert's stacks, once a room: its stacks and splits (stackOptions) weighed by the growth search (grow), against
// keeping what it has. → the action, or null.
const decided = new WeakMap()
function deliberate (run, L) {
  const s = run.state
  const key = `${s.floor}|${s.at}`
  if (decided.get(run) === key) return null
  decided.set(run, key)
  return grow(run, L, stackOptions(run).slice(1), 'stack')
}

// ── audit: what the expert considers, and what it chooses ───────────────────────────────────────────

// Off but for the audit (--audit): per mechanic, how many of the formations the plans rehearsed use it
// (`considered`; and each stack, split, fusion or idle tier weighed), and how many of the formations fought do
// (`chosen`). Only the audited run's own plans and choices count (`run`: none of the copies it plays ahead on), and
// with no run named, every plan the audit sees.
export const AUDIT = { on: false, run: undefined, candidates: 0, plans: 0, considered: {}, chosen: {}, done: {} }
const note = (book, key, n = 1) => { if (AUDIT.on) AUDIT[book][key] = (AUDIT[book][key] ?? 0) + n }
const audited = (run) => AUDIT.on && (AUDIT.run === undefined || AUDIT.run === run)
export function resetAudit (on = true, run = undefined) {
  Object.assign(AUDIT, { on, run, candidates: 0, plans: 0, considered: {}, chosen: {}, done: {} })
}

// What a formation uses: a stack fielded, a ring-2 kind fielded, a 2×2 piece fielded, a fused piece fielded, a
// piece beside the Monarch, a piece left in the ossuary though the field had room for it.
export const FEATURES = ['stack fielded', 'ring-2 fielded', '2×2 fielded', 'fused fielded', 'beside the Monarch', 'left out']
export function featuresOf (s, party) {
  const out = []
  const pieces = party.filter((u) => !isMonarch(u)).map((p) => ({ ...s.party.find((x) => x.uid === p.uid), ...p }))
  const seat = deployTile('party', monarchSlot(s.camp))
  for (const u of pieces) {
    if (u.slot < 0) { out.push('left out'); continue }
    if (u.count > 1) out.push('stack fielded')
    if (ringOf(u) === 2) out.push('ring-2 fielded')
    if (sizeOf(u) === 2) out.push('2×2 fielded')
    if (unitDef(u.id).fused) out.push('fused fielded')
    if (cover(u).some((c) => distance(deployTile('party', c), seat) === 1)) out.push('beside the Monarch')
  }
  return out
}

// A formation fought: its features once each.
function chose (s, goal) {
  AUDIT.plans++
  for (const f of new Set(featuresOf(s, goal))) note('chosen', f)
}

// ── growth: essence, fusions and stacks ──────────────────────────────────────────────────────────────

// Basic buys by rule of thumb (basicSpend) and never fuses. The expert grows by one search (grow): every choice it
// has — a fusion it can make, any held kind's next tier (and that tier with the one after it on its track, as one); a
// stack or a split, once a room; a recruit (weighRecruits) — sketched (sketch: the strength of the field it leaves, and
// what the book says it is worth ahead), the best taken if it beats keeping what it has. The free offers are rehearsed
// over the fights ahead besides (weighOffers: prospects), for a relic's worth is in the battle, not the field's
// numbers. Nothing is bought for the Monarch: its HP and Command are relics.
function pickSpend (run, L) {
  if (!L.spend) return basicSpend(run, L)
  return grow(run, L, [...fusionOptions(run, L), ...spendOptions(run, L)], 'spend')
}

// Every purchase the purse affords L: a tier of any kind held (but under the tracks ablation).
export function spendOptions (run, L) {
  const s = run.state
  return heldKinds(s).flatMap((kind) => [0, 1].filter((track) => L.ablate !== 'tracks' && canAdvance(s, kind, track) && s.essence >= tierCost(run, kind, track))
    .map((track) => ({ type: 'upgrade', kind, track })))
}

// The fusions L may make now: one a recipe the run can make (run.js canFuse), of its canonical parts (fuseParts:
// the ossuary's pieces first, then the fielded, the smallest stacks first), as legalActions lists them; none for a
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

// How much the book weighs beside the field (sketch) and rehearsal (prospects), and by how much a choice must beat
// keeping what it has.
const BOOK_WEIGHT = 0.5
const EPS = 0.005

// A choice's sketch, before any rehearsal: the field it leaves (strength, as a log: what it adds as a share) and what
// the book says it is worth ahead (bookValue).
// (Under the bodies ablation a tier's bodies are not counted: they never come.)
const sketch = (s, L) => Math.log(strength(s, L.ablate !== 'bodies')) + (L.book ? BOOK_WEIGHT * bookValue(s) : 0)

// The growth search: `options` (actions legal now) each applied to a copy and sketched, the best taken if it beats
// keeping what it has by EPS. A kind's next tier is weighed twice: alone, and with the tier after it on the same track
// as one candidate (where the crosspath rule allows it and the purse holds both prices together: nextTier), at their
// gain together, the first of the two bought for it; for a level is base + perTier × tiers, rounded down, and a tier
// whose level rounds away shows its worth only with the next (2026-10-10: on seed sim-0 the expert held 2,364 essence
// and declined a Frost Sprite tier of 194 for want of it). Rehearsal is spent where it decides (the formation, the free
// offers); a purchase's worth to the fights to come is the book's to say. Weighed once for each run state and purpose
// (`why`). → the action, or null.
const growths = new WeakMap()
const label = (a) => (a.type === 'fuse' ? `fuse ${a.id}` : a.type)
function grow (run, L, options, why) {
  if (!options.length) return null
  const s = run.state
  const key = JSON.stringify([L.ablate, s.floor, s.at, s.phase, s.essence, s.kinds, s.relics.length, s.party.map((u) => [u.uid, u.count, u.hp, u.slot >= 0])])
  const seen = growths.get(run) ?? {}
  if (seen[why]?.key === key) return seen[why].pick
  if (audited(run)) for (const a of options) note('considered', label(a))
  const base = sketch(s, L)
  let best = EPS
  let pick = null
  for (const a of options) {
    const sim = fork(run)
    apply(sim, a)
    const gain = sketch(sim.state, L) - base
    if (gain > best) { best = gain; pick = a }
    if (!nextTier(sim, a)) continue
    apply(sim, a)
    const both = sketch(sim.state, L) - base
    if (both > best) { best = both; pick = a }
  }
  growths.set(run, { ...seen, [why]: { key, pick } })
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

// A Command relic as the expert would use it, for rehearsal: `state` (offerState's) with the place it adds that no
// standing soul waits for filled by a body split off its biggest stack, as it would split it on the map.
function commandFilled (run, state) {
  const sim = fork(run)
  Object.assign(sim.state, state, { phase: 'map' })
  const waiting = standing(souls(sim.state.party))
  if (waiting.length > fieldCap(sim)) return state
  const big = waiting.filter((u) => u.count > 1).sort((a, b) => b.count - a.count || a.uid - b.uid)[0]
  if (!big) return state
  apply(sim, { type: 'split', uid: big.uid, n: 1 })
  return { ...state, party: sim.state.party, nextUid: sim.state.nextUid }
}

// What the expert expects of a state ahead: the fights ahead rehearsed (valueAhead) and, with the book (L.book), what
// the book says it is worth (bookValue), BOOK_WEIGHT of it.
function prospects (run, L) {
  const value = valueAhead(run, L)
  return (state) => value(state) + (L.book ? BOOK_WEIGHT * bookValue({ ...run.state, ...state }) : 0)
}

// How a run would fare in the battle rooms ahead with `state` changed: its rehearsal score, averaged, the rooms
// fought in a row (rehearseAhead: the Monarch's HP carried from each into the next), each with the best of the
// expert's zone drafts (L.sizeUp). Rehearsed at the edge of what the army can beat: the foes made harder by the
// greatest of MARGINS at which the army as it stands still wins them well enough (KEEP on average), so a choice shows
// what it adds where the near rooms are easy, and is not lost among defeats where they are hard. The margin is found
// once a room (and phase).
const MARGINS = [0, 0.3, 0.6, 1]
const KEEP = 1.3
const margins = new WeakMap()
function valueAhead (run, L = LEVELS.expert) {
  const s = run.state
  const rooms = roomsAhead(run)
  const at = (stress) => {
    const size = as({ ...ROLLOUT, ...L.sizeUp, stress }, L)
    return (state) => rehearseAhead(run, rooms, size, state).reduce((n, r) => n + r.score, 0) / rooms.length
  }
  const key = `${L.ablate}|${s.floor}|${s.at}|${s.phase}`
  if (margins.get(run)?.key !== key) {
    let margin = MARGINS[0]
    for (const m of MARGINS.slice(1)) {
      if (at(m)({}) < KEEP) break
      margin = m
    }
    margins.set(run, { key, margin })
  }
  return at(margins.get(run).margin)
}

// The battle rooms whose fights a choice is weighed on, in the order the run would come to them: the room being
// prepared for, the nearest within two steps (ROOMS_AHEAD in all), and the floor's last (or the room just won, at the
// floor's end).
const ROOMS_AHEAD = 4
export function roomsAhead (run) {
  const s = run.state
  const near = ahead(s.map, s.at, 2).filter((n) => n.foes)
  const end = nodeOf(s.map, s.map.end)
  const here = s.phase === 'prep' ? [currentNode(run)] : []
  const rooms = [...here, ...near.filter((n) => n !== end)].slice(0, ROOMS_AHEAD)
  if (end.foes && s.at !== end.id) rooms.push(end)
  if (!rooms.length) rooms.push(currentNode(run))
  return rooms
}

// The battle rooms `rooms` (roomsAhead's, in the order the run would come to them) fought in a row with `state`
// changed, each with the best of L's drafts (plan), the Monarch's HP carried from each fight into the next: what a won
// rehearsal left it (rehearse; with none won, the HP it began with: the loss weighs on its own), mended on the way as
// the run would mend it (mendOnWay: a battle's heal, an altar the way cannot miss; neither under Court of Bone). So a
// relic that bleeds the Monarch (Blood Tithe), or keeps it from mending (Court of Bone), costs what it costs over the
// rooms, not what it costs in one from a Monarch made whole each time. The souls start each fight as they stand now,
// and a room between two of these that is not rehearsed neither bleeds nor mends anyone (but an altar). Every fight is
// rehearsed on rolls of its own, never the battle's seed (rehearse: rehearsalSeed). → for each room { node, hp (the
// Monarch's at its start), score, left (rehearse's) }.
export function rehearseAhead (run, rooms, L, state = {}) {
  const s = { ...run.state, ...state }
  const m = monarchOf(s)
  const out = []
  let hp = m.hp
  let from = run.state.at
  let won = false
  for (const node of rooms) {
    hp = mendOnWay(s, hp, m.maxHp, from, node.id, won)
    const party = s.party.map((u) => (isMonarch(u) ? { ...u, hp } : u))
    const { score, left } = plan(atNode(run, node, { ...state, party }), L)
    out.push({ node, hp, score, left })
    won = left >= 0
    if (won) hp = Math.max(1, Math.round(left))
    from = node.id
  }
  return out
}

// The Monarch's HP `hp` (of `max`) as the run mends it on its way from room `from` to room `to` on `s`'s floor:
// TUNING.run.postBattleHeal of its max HP more for the battle won in `from` (`won`; run.js finishBattle), and up to
// altarHeal of it at an altar every way between passes (run.js walk); neither while nothing may heal it (Court of
// Bone).
function mendOnWay (s, hp, max, from, to, won) {
  if (holds(s, 'unhealable')) return hp
  const t = TUNING.run
  if (won) hp = Math.min(max, hp + Math.ceil(max * t.postBattleHeal))
  return altarOnWay(s.map, from, to) ? Math.max(hp, Math.round(max * t.altarHeal)) : hp
}

// Whether every way from room `from` to room `to` on `map` passes an altar (false where `to` is not ahead of `from`).
function altarOnWay (map, from, to) {
  const reaches = (avoid) => {
    const seen = new Set([from])
    for (const queue = [from]; queue.length;) {
      for (const id of nodeOf(map, queue.shift()).next) {
        if (id === to) return true
        if (seen.has(id) || avoid(nodeOf(map, id))) continue
        seen.add(id)
        queue.push(id)
      }
    }
    return false
  }
  return reaches(() => false) && !reaches((n) => n.type === 'altar')
}

// ── the combo book ───────────────────────────────────────────────────────────────────────────────

// The expert comes to a run having studied every combo the content holds, ranked before the run by rehearsal
// (--combos writes them to src/sim/combos.json; the expert loads it as BOOK). Basic has none of it. The combos:
//   fusion:<recipe>:<track>   the recipe's parts, fused (on floor 1, its parts as they stand), the result on a track
//   core:<kind>:<track>       two pieces of a kind, on one of its two tracks (to its tier IV: a Colossus, an aura, a
//                             new or remade ability, Burning or Hexed)
//   kin:<kin>:<n>, role:<role>:<n>   n pieces of a kin or a role (its synergy steps past the first), each of the
//                             kind its cores rank best, those met soonest first
//   pact:<synergy>            a pact's kin and role pieces
// Each is fought on every floor as the floor's army (BOOK_FLOORS: its Command, tiers, bodies and Monarch) with its
// pieces in it and the plain army's in the rest (FILLER), in rooms drawn for the floor (bookRooms: a camp's in a row,
// the Monarch's HP carried), from the best of the zone drafts; its `gain` is the score it adds over the plain army
// (null on a floor its pieces cannot all stand). Then the relics that pair with it: the score each battle relic adds
// to the best combos' armies (an Arise relic with Arise held). An entry:
//   { id, needs: { kind: bodies } (the bodies it is built from), fuse?: the recipe, tracks: { kind: track },
//     kin?: { kin: n }, role?: { role: n }, from: the first floor its kinds are met, gain: [per floor],
//     relics?: { relic: points }, draft: the zone draft its army fights best from (ZONES) }
// The book also holds `plain`: the relics' points on the plain army.
const BOOK_FLOORS = [
  { command: 3, tiers: 1, bodies: 1, hp: 220 }, { command: 5, tiers: 2, bodies: 1, hp: 265 },
  { command: 7, tiers: 3, bodies: 2, hp: 300 }, { command: 9, tiers: 4, bodies: 2, hp: 340 }
]
// The plain army: the souls a run starts with, then the kinds floor 1 meets most.
const FILLER = ['tomb_knight', 'bone_chanter', 'frost_sprite', 'grave_ghoul', 'clockwork_page', 'will_o_wisp', 'hive_warden', 'pyre_hound', 'thorn_dryad']
// The relics a battle reads (not the purse's, the ossuary's, nor Command or the Monarch's HP, which rehearsal weighs).
const BATTLE_RELICS = () => RELIC_LIST.filter((r) => (r.mods || r.on || r.arise || r.rise || r.alias || r.raises || r.domain) && !r.command && !r.monarchHp).map((r) => r.id)
const RECRUITED = () => UNIT_LIST.filter((u) => u.spawn && TRACKS[u.id]?.length === 2)

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
  const members = (fit, n) => {
    const pool = kinds.filter(fit).sort((a, b) => first(a.id) - first(b.id) || best(b.id)[1] - best(a.id)[1])
    if (!pool.length) return null
    const picks = Array.from({ length: n }, (_, i) => pool[i % pool.length].id)
    const needs = {}
    for (const id of picks) needs[id] = (needs[id] ?? 0) + 1
    return needs
  }
  const group = (id, fit, n, extra) => {
    const needs = members(fit, n)
    if (needs) out.push({ id, needs, tracks: Object.fromEntries(Object.keys(needs).map((k) => [k, best(k)[0]])), from: Math.max(...Object.keys(needs).map(first)), ...extra })
  }
  for (const k of new Set(kinds.map((u) => u.kin))) for (const n of [4, 6]) group(`kin:${k}:${n}`, (u) => u.kin === k, n, { kin: { [k]: n } })
  for (const r of new Set(kinds.map((u) => u.role))) for (const n of r === 'ranger' ? [3, 6] : [2, 4]) group(`role:${r}:${n}`, (u) => u.role === r, n, { role: { [r]: n } })
  for (const p of SYNERGIES.filter((x) => x.needs.kin && x.needs.role)) {
    const [[k, nk]] = Object.entries(p.needs.kin)
    const [[r, nr]] = Object.entries(p.needs.role)
    const a = members((u) => u.kin === k && u.role !== r, nk)
    const b = members((u) => u.role === r && u.kin !== k, nr)
    if (!a || !b) continue
    const needs = { ...a }
    for (const [id, n] of Object.entries(b)) needs[id] = (needs[id] ?? 0) + n
    out.push({ id: `pact:${p.id}`, needs, tracks: Object.fromEntries(Object.keys(needs).map((x) => [x, best(x)[0]])), kin: p.needs.kin, role: p.needs.role, from: Math.max(...Object.keys(needs).map(first)) })
  }
  return out
}

// The rooms a floor's armies are fought in: on each of the floor's camps, a floor drawn for the book, its last room,
// an elite and its deepest fight, in the order a run comes to them (by rank: bookScore fights them in a row).
const bookRoomCache = new Map()
function bookRooms (floor) {
  if (bookRoomCache.has(floor)) return bookRoomCache.get(floor)
  const camps = CAMP_LIST.filter((c) => c.floor === floor)
  const rooms = camps.flatMap((c, k) => {
    const seed = `book|${k}`
    const map = generateFloor({ seed, floor, last: floor === TUNING.run.floors })
    const battles = map.nodes.filter((n) => ['fight', 'elite', 'boss', 'siege'].includes(n.type))
    for (const n of battles) Object.assign(n, drawRoom(seed, floor, n))
    const end = battles.find((n) => n.id === map.end)
    const elite = battles.find((n) => n.type === 'elite' && n !== end)
    const fight = battles.filter((n) => n.type === 'fight').sort((a, b) => b.rank - a.rank)[0]
    return [end, elite, fight].filter(Boolean).sort((x, y) => x.rank - y.rank).map((node) => ({ camp: c.id, map, node }))
  })
  bookRoomCache.set(floor, rooms)
  return rooms
}

// A combo's army on a floor (null for none: the plain army), as a run standing in a room's prep: its pieces (a fusion
// made from floor 2, its parts as pieces on floor 1), each kind at the floor's tiers on its track (the plain kinds on
// their first), the bodies the floor's pieces hold, the rest of the floor's Command filled with the plain army's,
// `relics` held, and the Monarch the floor's. Null where its pieces outnumber the Command.
function bookArmy (combo, floor, relics = []) {
  const F = BOOK_FLOORS[Math.min(floor, BOOK_FLOORS.length) - 1]
  const tracks = { ...(combo?.tracks ?? {}) }
  const ids = []
  if (combo?.fuse && floor > 1) ids.push(fusionDef(combo.fuse).result)
  else for (const [id, n] of Object.entries(combo?.needs ?? {})) for (let i = 0; i < n; i++) ids.push(id)
  if (ids.length > F.command) return null
  for (const id of FILLER) if (ids.length < F.command) ids.push(id)
  const run = createRun({ seed: 'book' })
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
  s.party = [monarch, ...ids.map((id, i) => makeUnit(id, { uid: i + 1, lvl: s.kinds[id].lvl, tracks: s.kinds[id].tracks, count: F.bodies }))]
  s.nextUid = ids.length + 1
  s.relics = [...Array(Math.max(0, F.command - commandOf({ ...s, relics: [] }))).fill('grave_banner'), ...relics]
  s.floor = floor
  s.phase = 'prep'
  return run
}

// A combo's army fought in every room of the floor (bookRooms), from each zone draft on `seeds` rolls at `stress`:
// → { score (the best draft's, averaged over the rooms), drafts (each draft's average) }, or null where it cannot stand.
// A camp's rooms are fought in a row, as a run comes to them: the Monarch whole at the first, its HP carried from the
// best draft's rehearsal into the next and mended on the way as the run would mend it (mendOnWay, as rehearseAhead
// carries it), so a relic that bleeds it or keeps it from mending (Blood Tithe, Court of Bone) is weighed at what it
// costs over a floor's fights, not in one from a Monarch made whole each time.
function bookScore (combo, floor, { relics = [], seeds = 2, stress = 0 } = {}) {
  const base = bookArmy(combo, floor, relics)
  if (!base) return null
  const L = { ...ROLLOUT, more: true }
  const max = monarchOf(base.state).maxHp
  let score = 0
  const drafted = ZONES.map(() => 0)
  let hp = max
  let won = false
  let last = null
  for (const { camp, map, node } of bookRooms(floor)) {
    if (camp !== last?.camp) {
      hp = max
      won = false
    } else hp = mendOnWay({ ...base.state, map }, hp, max, last.node.id, node.id, won)
    last = { camp, node }
    const party = base.state.party.map((u) => (isMonarch(u) ? { ...u, hp } : u))
    const run = { ...base, state: { ...base.state, party, camp, map, at: node.id } }
    const want = wanted(run, L)
    const results = drafts(run, want, L).slice(0, ZONES.length).map((p) => rehearse(run, p, seeds, { full: true, stress }))
    const best = results.reduce((a, r) => (r.score > a.score ? r : a))
    score += best.score
    results.forEach((r, i) => { drafted[i] += r.score })
    won = best.left >= 0
    if (won) hp = Math.max(1, Math.round(best.left))
  }
  const n = bookRooms(floor).length
  return { score: score / n, drafts: drafted.map((v) => v / n) }
}

// A worker's book job (playAll): one combo (null: the plain army) on one floor, at the floor's margin, with relics.
function bookJob ({ combo, floor, relics, seeds, stress }) {
  return bookScore(combo, floor, { relics, seeds, stress })
}

// --combos: the book, made. Per floor first the margin: the greatest of MARGINS at which the plain army still wins
// its rooms on average, so the combos are told apart where the floor is hard for it. Then every fusion and core on
// every floor, then the kin, role and pact combos built from the best cores, each against the plain army; then the
// battle relics on the plain army and on the best BOOK_TOP combos' (on floors 2 and 4), each against the same army
// without it. Kept: every combo, best first, with the relics that add more than RELIC_FLOOR to it.
const BOOK_TOP = 12
const RELIC_FLOOR = 0.02
const BOOK_FILE = new URL('./combos.json', import.meta.url)
async function makeBook ({ out = BOOK_FILE } = {}) {
  const t0 = Date.now()
  const floors = BOOK_FLOORS.map((_, i) => i + 1)
  const tries = await playAll(floors.flatMap((floor) => MARGINS.map((stress) => ({ book: true, combo: null, floor, seeds: 2, stress }))))
  const margins = {}
  const plainScores = {}
  for (const [f, floor] of floors.entries()) {
    const at = Math.max(0, MARGINS.findLastIndex((_, i) => tries[f * MARGINS.length + i].score >= 1))
    margins[floor] = MARGINS[at]
    plainScores[floor] = tries[f * MARGINS.length + at].score
  }
  const rank = async (combos) => {
    const jobs = combos.flatMap((combo) => floors.map((floor) => ({ book: true, combo, floor, seeds: 2, stress: margins[floor] })))
    const done = await playAll(jobs)
    return combos.map((combo, c) => {
      const res = floors.map((floor, f) => done[c * floors.length + f])
      const gain = res.map((r, f) => (r ? +(r.score - plainScores[floors[f]]).toFixed(3) : null))
      const drafts = ZONES.map((_, d) => res.reduce((n, r) => n + (r ? r.drafts[d] : 0), 0))
      return { ...combo, gain, draft: drafts.indexOf(Math.max(...drafts)) }
    })
  }
  const mean = (e) => {
    const g = e.gain.filter((x, f) => x !== null && f + 1 >= e.from)
    return g.length ? g.reduce((n, x) => n + x, 0) / g.length : -Infinity
  }
  const first = await rank(combosOf())
  const cores = Object.fromEntries(first.filter((e) => e.id.startsWith('core:')).map((e) => [e.id, mean(e)]))
  const second = await rank(combosOf(cores).filter((c) => !first.some((e) => e.id === c.id)))
  const book = [...first, ...second].sort((a, b) => mean(b) - mean(a) || (a.id < b.id ? -1 : 1))
  // The relics: on floors 2 and 4, the plain army's and the best combos' armies, each relic against none.
  const relicFloors = [2, 4]
  const armies = [null, ...book.slice(0, BOOK_TOP)]
  const relics = BATTLE_RELICS()
  const withArise = (id) => (relicDef(id).needsArise ? ['arise', id] : [id])
  const jobs = armies.flatMap((combo) => relicFloors.flatMap((floor) => [[], ...relics.map(withArise)].map((held) => ({ book: true, combo, floor, relics: held, seeds: 1, stress: margins[floor] }))))
  const done = await playAll(jobs)
  const per = relics.length + 1
  armies.forEach((combo, a) => {
    const points = {}
    relicFloors.forEach((floor, f) => {
      const at = (a * relicFloors.length + f) * per
      const none = done[at]
      if (!none) return
      relics.forEach((id, r) => {
        const got = done[at + 1 + r]
        // An Arise-gated relic is weighed against Arise alone.
        const ref = relicDef(id).needsArise ? done[at + 1 + relics.indexOf('arise')] : none
        if (got && ref) points[id] = (points[id] ?? 0) + (got.score - ref.score) / relicFloors.length
      })
    })
    const kept = Object.fromEntries(Object.entries(points).filter(([, v]) => v > RELIC_FLOOR).sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, +v.toFixed(3)]))
    if (combo) book.find((e) => e.id === combo.id).relics = kept
    else book.plain = kept
  })
  const data = { made: 'node src/sim/autoplay.js --combos', margins, plain: book.plain, combos: book }
  fs.writeFileSync(out, JSON.stringify(data, null, 1) + '\n')
  console.log(`the combo book: ${book.length} combos ranked in ${((Date.now() - t0) / 1000).toFixed(0)} s, margins ${JSON.stringify(margins)}; written to ${out.pathname ?? out}`)
  for (const e of book.slice(0, 15)) console.log(`  ${e.id.padEnd(34)} ${e.gain.map((g) => (g === null ? '   -  ' : g.toFixed(2).padStart(6))).join(' ')}  ${Object.keys(e.relics ?? {}).slice(0, 3).join(', ')}`)
}

// The book as the expert reads it: { margins, plain, combos }, empty where none was made.
export const BOOK = (() => {
  try {
    return JSON.parse(fs.readFileSync(BOOK_FILE, 'utf8'))
  } catch {
    return { margins: {}, plain: {}, combos: [] }
  }
})()

// What the expert makes of the book. How far a run is along a combo, from 0 to 1, the mean of its parts: the bodies
// it is built from, standing (a kin's, a role's or a pact's: the pieces of that kin or role, any kind); a fusion's made
// (its parts then all counted); and the tiers on its tracks of the kinds it holds, of the four.
function comboProgress (s, c) {
  const up = souls(s.party).filter((u) => u.hp > 0)
  const bodies = (id) => up.reduce((n, u) => n + (u.id === id ? u.count : 0), 0)
  const share = (needs) => {
    const all = Object.values(needs).reduce((n, k) => n + k, 0)
    return Object.entries(needs).reduce((n, [id, k]) => n + Math.min(bodies(id), k), 0) / all
  }
  const parts = []
  if (c.fuse) {
    const made = bodies(fusionDef(c.fuse).result) > 0
    parts.push(made ? 1 : share(c.needs), made ? 1 : 0)
  } else if (c.kin || c.role) {
    for (const [k, n] of Object.entries(c.kin ?? {})) parts.push(Math.min(1, up.filter((u) => unitDef(u.id).kin === k).length / n))
    for (const [r, n] of Object.entries(c.role ?? {})) parts.push(Math.min(1, up.filter((u) => unitDef(u.id).role === r).length / n))
  } else parts.push(share(c.needs))
  const held = Object.entries(c.tracks).filter(([id]) => bodies(id) > 0)
  parts.push(held.length ? held.reduce((n, [id, t]) => n + (s.kinds[id]?.tracks[t] ?? 0) / 4, 0) / Object.keys(c.tracks).length : 0)
  return parts.reduce((n, x) => n + x, 0) / parts.length
}

// A combo's worth from here: its gain over the plain army on the floors left (the last floor's past them, none
// below 0), and the points of the relics held that pair with it (its own, else the plain army's), each once. A relic
// that costs the Monarch HP (Blood Tithe's tithe) was weighed beside Arise alone, the Monarch mending between fights
// (bookScore): while nothing may heal it (Court of Bone) those points do not hold, and the book counts none of them
// (rehearsal, prospects, weighs what it costs there).
const BOOK_CAP = BOOK_FLOORS.length
function comboWorth (s, c) {
  const from = Math.min(s.floor, BOOK_CAP)
  const g = c.gain.filter((x, f) => x !== null && f + 1 >= from)
  const pairs = c.relics ?? BOOK.plain ?? {}
  const bled = holds(s, 'unhealable')
  const relics = [...new Set(s.relics)].reduce((n, id) => n + (bled && relicDef(id).tithe ? 0 : pairs[id] ?? 0), 0)
  return Math.max(0, g.length ? g.reduce((n, x) => n + x, 0) / g.length : 0) + relics
}

// The book's value of a state: the best of its combos, by worth times progress. The target (targetOf) is that combo.
function bookValue (s) {
  let best = 0
  for (const c of BOOK.combos) best = Math.max(best, comboWorth(s, c) * comboProgress(s, c))
  return best
}
function targetOf (s) {
  let best = null
  let most = 0
  for (const c of BOOK.combos) {
    const v = comboWorth(s, c) * comboProgress(s, c)
    if (v > most) { most = v; best = c }
  }
  return best
}
// The kinds a target is built of (its parts, its tracks'), and whether a soul is one of them.
const targetKinds = (c) => new Set([...Object.keys(c?.needs ?? {}), ...Object.keys(c?.tracks ?? {})])

// ── reap ─────────────────────────────────────────────────────────────────────────────────────────

// Free offers (a relic, a Legendary, a reliquary's tier) first: basic takes the first, an expert rehearses the retinue
// each would make against the battle rooms within two steps and the floor's last room (or the room just won, at the
// floor's end; roomsAhead), fought in a row with the Monarch's HP carried (rehearseAhead): a relic (a Legendary too, a
// copy more of one held too) as the run holding it, an HP relic's Monarch with its HP and a Command relic's place
// filled (commandFilled). Then the one recruit a battle allows: basic buys the highest tier it can afford while the
// field has room, an expert the soul worth most if it beats the weakest it would field (or nearly, with no one standing
// in the ossuary), else one that can join a fielded piece of its kind; with the field full it joins that piece
// (`onto`). A full retinue lets its weakest soul in the ossuary go to make room.
function pickReap (run, L) {
  const s = run.state
  const free = s.offers.flatMap((o, index) => (o.type === 'soul' || banned(L, o) ? [] : [index]))
  if (free.length) return { type: 'reap', index: L.reap ? weighOffers(run, free, L) : free[0] }
  if (L.reap) {
    const pick = weighRecruits(run, L)
    if (!pick) return { type: 'reap', index: null }
    if (pick.release != null && soulCount(s.party) >= rosterCap(run)) return { type: 'release', uid: pick.release }
    return { type: 'reap', index: pick.index, ...(pick.onto != null && { onto: pick.onto }) }
  }
  const index = recruit(run, L)
  const piece = index !== null && L.reap && fielded(souls(s.party)).length >= fieldCap(run) && fielded(souls(s.party)).find((u) => u.id === s.offers[index].id)
  if (index === null || soulCount(s.party) < rosterCap(run)) return { type: 'reap', index, ...(piece && { onto: piece.uid }) }
  // Never the last soul standing (the run refuses that release): with every other soul fallen, the recruit
  // is passed over instead.
  const spare = (u) => souls(s.party).some((x) => x !== u && x.hp > 0)
  const weakest = inOssuary(s.party).filter(spare).sort(L.wounds ? byFieldPower : byPower).at(-1)
  return weakest ? { type: 'release', uid: weakest.uid } : { type: 'reap', index: null }
}

// The expert's recruit, by the growth search's sketch: each soul it can afford, as a piece of its own or as a body
// more in the fielded piece of its kind, with the retinue as it would leave it (when the retinue is full, its weakest
// standing piece in the ossuary let go first, never one its target is built of while another will do: a release only
// ever comes with a recruit worth it), or a fusion it would complete; the best that beats keeping the essence, or none.
// Weighed once a room; a release it needs comes first, then the recruit it was for.
// → { index, onto?, release? } or null
const recruits = new WeakMap()
function weighRecruits (run, L) {
  const s = run.state
  // Once a room, for the offers it has (a release leaves them as they were; a recruit takes the souls away).
  const key = JSON.stringify([s.floor, s.at, s.offers.map((o) => [o.type, o.id ?? o.kind ?? null])])
  if (recruits.get(run)?.key === key) return recruits.get(run).pick
  const spare = (u) => souls(s.party).some((x) => x !== u && x.hp > 0)
  // The soul it lets go: the weakest standing in the ossuary, never one its target is built of while another will do.
  const keeps = L.book ? targetKinds(targetOf(s)) : new Set()
  const weakest = inOssuary(s.party).filter(spare).sort((a, b) => keeps.has(b.id) - keeps.has(a.id) || byFieldPower(a, b)).at(-1)
  const base = sketch(s, L)
  let pick = null
  let best = EPS
  for (const [index, o] of s.offers.entries()) {
    if (o.type !== 'soul' || o.cost > s.essence) continue
    const piece = fielded(souls(s.party)).filter((u) => u.id === o.id).sort(byFieldPower)[0]
    for (const onto of [null, ...(piece ? [piece.uid] : [])]) {
      const sim = fork(run)
      const full = soulCount(s.party) >= rosterCap(run)
      if (full && !weakest) continue
      if (full) apply(sim, { type: 'release', uid: weakest.uid })
      apply(sim, { type: 'reap', index, ...(onto !== null && { onto }) })
      if (audited(run)) note('considered', onto === null ? 'recruit a new piece' : 'recruit onto a piece')
      // A recruit is worth what it adds to the field and the book, or what a fusion it completes would.
      const gain = Math.max(...[sim, ...completes(sim, L)].map((x) => sketch(x.state, L))) - base
      if (gain > best) {
        best = gain
        pick = { index, ...(onto !== null && { onto }), ...(full && { release: weakest.uid }) }
      }
    }
  }
  recruits.set(run, { key, pick })
  if (pick && audited(run)) note('done', pick.onto != null ? 'recruit onto a piece' : 'recruit a new piece')
  return pick
}

// The retinue as it would be after each fusion L may make on `sim` (a copy, after a recruit: weighed as on the map).
function completes (sim, L) {
  const map = { ...sim, state: { ...sim.state, phase: 'map' } }
  return fusionOptions(map, L).map((a) => {
    const next = fork(map)
    apply(next, a)
    return next
  })
}

function recruit (run, L) {
  const s = run.state
  const affordable = s.offers.flatMap((o, index) => (o.type === 'soul' && o.cost <= s.essence ? [{ o, index, w: worth(offered(s, o)) }] : []))
  const field = standing(souls(s.party)).sort(byFieldPower).slice(0, fieldCap(run))
  const room = field.length < fieldCap(run)
  if (!L.reap) {
    if (!room) return null
    return affordable.sort((a, b) => unitDef(b.o.id).tier - unitDef(a.o.id).tier || a.index - b.index)[0]?.index ?? null
  }
  // With no standing soul in the ossuary, one nearly as good as the weakest fielded is worth keeping for the
  // next place a Command relic adds on the field (and makes that relic worth taking in rehearsal).
  const weakest = room ? 0 : fieldPower(field.at(-1)) * (inOssuary(standing(souls(s.party))).length ? 1.1 : 0.8)
  const best = affordable.sort((a, b) => b.w - a.w || a.index - b.index)[0]
  if (best && best.w > weakest) return best.index
  return affordable.find((a) => fielded(souls(s.party)).some((u) => u.id === a.o.id))?.index ?? null
}

// A soul on offer as it would join: at its kind's level (the offer's), with its kind's tiers.
const offered = (s, o) => makeUnit(o.id, { uid: s.nextUid + 1000, lvl: o.lvl, tracks: s.kinds[o.id]?.tracks })

// The state an offer would make, for rehearsal: a relic held (a copy more; an HP relic's Monarch with its max HP
// raised, healed by as much unless nothing may heal it), or the kind (every soul of it) with that tier and the level
// it gives (the battle fits each piece's HP to its level); else as is.
export function offerState (s, o) {
  if (o.type === 'relic') {
    const relics = [...s.relics, o.id]
    const gain = relicDef(o.id).monarchHp ?? 0
    if (!gain) return { relics }
    const heal = !holds(s, 'unhealable') && !relicDef(o.id).unhealable
    return { relics, party: s.party.map((u) => (isMonarch(u) ? { ...u, maxHp: monarchHp({ ...s, relics }), hp: u.hp + (heal ? gain : 0) } : u)) }
  }
  if (o.type !== 'tier') return {}
  const k = afterTier(s.kinds[o.kind], o.track)
  return { kinds: { ...s.kinds, [o.kind]: k }, party: s.party.map((u) => (u.id === o.kind ? { ...u, lvl: k.lvl, tracks: k.tracks } : u)) }
}

function weighOffers (run, indices, L) {
  const s = run.state
  const value = prospects(run, L)
  let best = indices[0]
  let bestValue = -Infinity
  for (const index of indices) {
    const o = s.offers[index]
    const state = offerState(s, o)
    const v = value(o.type === 'relic' && relicDef(o.id).command ? commandFilled(run, state) : state)
    if (v > bestValue) { best = index; bestValue = v }
  }
  return best
}

export function policy (run, rng, level = 'basic') {
  const L = typeof level === 'string' ? LEVELS[level] : level
  const s = run.state
  if (L.ablate) {
    if (!ABLATIONS.includes(L.ablate)) throw new Error(`unknown ablation "${L.ablate}": ${ABLATIONS.join(', ')}`)
    if (RULE_SWITCHES.includes(L.ablate) && !s.ablate?.includes(L.ablate)) throw new Error(`ablating ${L.ablate} needs a run made with it (ablatedRun)`)
  }
  if (s.phase === 'map') return pickNode(run, rng, L)
  if (s.phase === 'prep') return pickPrep(run, L)
  if (s.phase === 'reap') return pickReap(run, L)
  throw new Error(`no policy for phase "${s.phase}"`)
}

// Plays the run to the end. onBattle(battle, run) fires after each battle, once the run has moved on, and
// beforeFight(run) just before each fight is applied (the run as the battle will be set up from it). A
// clear is the end too: neither level descends past the Sovereign (the policy has nothing for 'over'), so
// the ladder's clears and floors keep their meaning; the endless floors are a player's (and a test's).
export function autoplay (run, { rng = createRng(run.state.seed).stream('autoplay'), level = 'basic', onBattle = null, beforeFight = null } = {}) {
  for (let guard = 0; run.state.phase !== 'over'; guard++) {
    if (guard > 1e5) throw new Error('autoplay is stuck')
    const action = policy(run, rng, level)
    if (action.type === 'fight') beforeFight?.(run)
    apply(run, action)
    if (action.type === 'fight') onBattle?.(run.battle, run)
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
// raised), its army (its bodies, the tiers' added included, and how many fell, its 2×2 pieces, how many
// acted: armyMeasures), with
// `setups` what it was built from (for refighting) and with `snapshots` the run's state just before the fight
// (for refighting with a mechanic stripped: necessity; its log left out); how the run ended, what felled the
// Monarch, the army it ended with, its build (buildOf), and how many of each action it took (`acts`, by type;
// `tiers`: track tiers its kinds hold at the end; `relics` held, every copy, and the `legendaries` among them).
export function record ({ seed, level, ablate = null, setups = false, snapshots = false }) {
  const battles = []
  const memo0 = { ...memoStats }
  const t0 = Date.now()
  const run = ablatedRun(seed, ablate)
  let snap = null
  // The battle the run fell in: its room's rank and the share of its foes' HP removed (progressOf).
  let fell = null
  autoplay(run, {
    level: ablate ? { ...LEVELS[level], ablate } : level,
    beforeFight: snapshots ? (r) => { snap = structuredClone({ ...r.state, log: [] }) } : null,
    onBattle: (b, r) => {
      if (b.winner !== 'party') fell = { rank: currentNode(r).rank, share: foeShare(b) }
      const party = b.units.filter((u) => u.side === 'party' && !u.shadow && u !== b.monarch)
      battles.push({
        floor: b.floor + (b.boss ? 'B' : ''),
        t: b.t,
        ceiling: b.reason === 'tick-ceiling',
        won: b.winner === 'party',
        lvl: party.reduce((n, u) => n + u.lvl, 0) / Math.max(1, party.length),
        size: party.length,
        roster: soulCount(r.state.party),
        foes: b.units.filter((u) => u.side === 'foe').length,
        relics: r.state.relics.length,
        raised: b.raised,
        bodies: party.reduce((n, u) => n + u.count, 0),
        fell: party.reduce((n, u) => n + u.count - livingBodies(u), 0),
        waves: b.events.filter((e) => e.type === 'wave').length,
        foesIn: b.events.filter((e) => e.type === 'enter' && e.unit.side === 'foe').length,
        colossi: r.setup.party.filter((u) => u.uid !== 0 && sizeOf(u) === 2).length,
        ...armyMeasures(b),
        camp: r.state.camp,
        setup: setups ? r.setup : undefined,
        snapshot: snapshots ? snap : undefined,
        outcome: snapshots ? { won: b.winner === 'party', t: b.t, hash: timelineHash(b.events) } : undefined
      })
    }
  })
  const s = run.state
  return {
    battles, result: s.result, floor: s.floor, camp: s.camp, relics: s.relics.length, reaped: s.stats.reaped,
    monarch: { maxHp: monarchOf(s).maxHp, command: fieldCap(run), ...ariseOf(s) }, death: s.death, legendaries: legendariesOf(s), build: buildOf(s),
    ossuary: souls(s.party).filter((u) => u.slot < 0).length,
    acts: s.log.reduce((n, a) => ({ ...n, [a.type]: (n[a.type] ?? 0) + 1 }), {}),
    tiers: Object.values(s.kinds).reduce((n, k) => n + k.tracks[0] + k.tracks[1], 0),
    // How far it got (progressOf), and where it fell (null for a clear).
    progress: progressOf({ result: s.result, floor: s.floor, rank: fell?.rank ?? 1, share: fell?.share ?? 0 }),
    fell,
    // Wall time of the run, in seconds (the only field that is not a pure function of the job).
    secs: (Date.now() - t0) / 1000,
    // Its rehearsals: how many were fought, and how many the memo already had (rehearsed).
    rehearsals: { fought: memoStats.misses - memo0.misses, memo: memoStats.hits - memo0.hits }
  }
}

// One seeded run at `level` with the audit on (AUDIT): what its plans considered and what it fought with, the
// stacks, splits and fusions it weighed and took, and per battle Arise's raises and the party's synergies.
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
    const k = a.type === 'reap' && a.onto != null ? 'reap onto' : a.type
    acts[k] = (acts[k] ?? 0) + 1
  }
  const out = {
    seed, level, result: s.result, floor: s.floor, secs: (Date.now() - t0) / 1000, battles, acts,
    candidates: AUDIT.candidates, plans: AUDIT.plans, considered: AUDIT.considered, chosen: AUDIT.chosen, done: AUDIT.done
  }
  resetAudit(false)
  return out
}

// The audit (--audit): `runs` expert runs and one basic run, side by side, per mechanic: how often its plans
// considered it (formations rehearsed that use it, options weighed) and how often it chose it (formations fought
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
  row('formations (rehearsed/fought)', (rs) => sum(rs, (r) => r.candidates), (rs) => sum(rs, (r) => r.plans))
  for (const f of FEATURES) row(f, (rs) => sum(rs, (r) => r.considered[f]), (rs) => sum(rs, (r) => r.chosen[f]))
  for (const k of ['stack', 'split']) row(`${k} (weighed/done)`, (rs) => sum(rs, (r) => r.considered[k]), (rs) => sum(rs, (r) => r.acts[k]))
  const fusions = (book) => (r) => Object.entries(r[book]).reduce((n, [k, v]) => n + (k.startsWith('fuse ') ? v : 0), 0)
  row('fuse (weighed/done)', (rs) => sum(rs, fusions('considered')), (rs) => sum(rs, (r) => r.acts.fuse))
  for (const k of ['recruit a new piece', 'recruit onto a piece']) row(`${k} (weighed/done)`, (rs) => sum(rs, (r) => r.considered[k]), (rs) => sum(rs, (r) => r.done[k]))
  row('release (done)', () => '-', (rs) => sum(rs, (r) => r.acts.release))
  row('upgrade (weighed/bought)', (rs) => sum(rs, (r) => r.considered.upgrade), (rs) => sum(rs, (r) => r.done.upgrade))
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

// Plays every job in worker threads, one per core, and returns the results in the jobs' order. The workers live
// for the whole call, each playing job after job, and share one rehearsal memo (shareMemo): a battle one run
// rehearsed, no other run refights, so the same seed played again (an ablation, another variant) costs only
// where it parts from the runs before it. So the jobs go in this order: the un-ablated runs first, seed by
// seed (an expert's before a basic one's), so each seed's prefix is in the memo before its ablations come; then
// the ablations, seed by seed, the longest of a seed first (jobTime: how long the job took the last time it was
// played here, else a guess), so the pool ends on short jobs; and of those, a seed whose un-ablated runs have
// all finished goes first. Which job runs where and when changes no result: a run is a pure function of its
// job, and the memo only returns what the fight would.
async function playAll (jobs) {
  const { Worker } = await import('node:worker_threads')
  const { availableParallelism } = await import('node:os')
  const times = loadTimes()
  const out = new Array(jobs.length)
  const seeds = [...new Set(jobs.map((j) => j.seed))]
  const rank = (j) => [j.ablate ? 1 : 0, seeds.indexOf(j.seed), j.level === 'basic' ? 1 : 0, -jobTime(j, times)]
  const queue = [...jobs.keys()].sort((a, b) => {
    const ra = rank(jobs[a])
    const rb = rank(jobs[b])
    for (let k = 0; k < ra.length; k++) if (ra[k] !== rb[k]) return ra[k] - rb[k]
    return a - b
  })
  const memo = new SharedArrayBuffer(MEMO_BYTES)
  const prefix = new Map(seeds.map((seed) => [seed, jobs.filter((j) => !j.ablate && j.seed === seed).length]))
  const take = () => {
    const k = Math.max(0, queue.findIndex((i) => !jobs[i].ablate || !prefix.get(jobs[i].seed)))
    return queue.splice(k, 1)[0]
  }
  const worker = async () => {
    const w = new Worker(new URL(import.meta.url), { workerData: { pool: true, memo } })
    try {
      while (queue.length) {
        const i = take()
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
        if (!jobs[i].ablate) prefix.set(jobs[i].seed, prefix.get(jobs[i].seed) - 1)
      }
    } finally {
      await w.terminate()
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs.length, availableParallelism()) }, worker))
  saveTimes(times)
  return out
}

// How long each job took when last played on this machine, in seconds, by its seed, level and ablation (a
// small file in the OS's temp directory; read only to order the next pool's jobs, and never needed: without
// it the guess orders them).
const TIMES = 'retinue-job-times.json'
const timeKey = (job) => job.refight || job.book ? null : `${job.seed}|${job.level}|${job.ablate ?? ''}`
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
const jobTime = (job, times) => times[timeKey(job)] ?? (job.refight ? 1 : job.level === 'basic' ? 1 : job.ablate ? 100 : 200)

// ── balance report ─────────────────────────────────────────────────────────────────────────────

// Autoplays `runs` seeded runs and prints clear rate, battle length, per-floor progression and how each
// camp layout fares: a camp far off its floor's average is a balance outlier.
// With `ablate`, the level with that mechanic taken away (ABLATIONS).
async function report ({ runs, seed: seed0, level, ablate = null }) {
  const played = await playAll(Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level, ablate })))
  const battles = played.flatMap((r) => r.battles)
  const ticks = battles.map((b) => b.t).sort((a, b) => a - b)
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
  const q = (p) => ticks[Math.min(ticks.length - 1, Math.floor(p * ticks.length))]
  const pct = (n) => `${(100 * n / runs).toFixed(1)}%`
  console.log(`runs ${runs} (seed ${seed0}, ${level} player${ablate ? `, ${ablate} ablated` : ''})`)
  console.log(`clear rate        ${pct(played.filter((r) => r.result === 'victory').length)}`)
  for (let f = 1; f <= TUNING.run.floors; f++) console.log(`deaths on floor ${f} ${pct(deaths[f] ?? 0)}`)
  console.log(`battles           ${ticks.length}, ${(ticks.length / runs).toFixed(1)} per run`)
  console.log(`battle ticks      median ${q(0.5)}, p90 ${q(0.9)}, max ${ticks.at(-1)}, at ceiling ${battles.filter((b) => b.ceiling).length}`)
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

// What ended a run, one cause per defeat: the Monarch's killer's own first threat, or 'ceiling' for a battle
// still undecided at the tick ceiling (no Monarch died); none for a run that did not end in one. Depth (the
// killer came in a later wave: death.wave) is counted apart (see ladder), so the causes add up to the defeats.
export const causesOf = (death) => !death ? [] : [death.reason === 'tick-ceiling' ? 'ceiling' : death.threat ?? 'none']

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
  // and what ended the run, by the killer's first threat or the ceiling (causesOf).
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
  // The army: stacks made over the run and pieces in the ossuary at its end; per battle, the bodies fielded,
  // the bodies that fell, and the 2×2 pieces fielded.
  console.log('\nlevel     stacks  ossuary   bodies/battle  fell/battle  2×2/battle')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const avg = (f) => (mine.reduce((n, r) => n + f(r), 0) / runs).toFixed(1)
    const battles = mine.flatMap((r) => r.battles)
    const per = (key) => (battles.reduce((n, b) => n + b[key], 0) / Math.max(1, battles.length)).toFixed(2)
    console.log(`${level.padEnd(6)}  ${avg((r) => r.acts.stack ?? 0).padStart(8)}  ${avg((r) => r.ossuary).padStart(7)}  ${per('bodies').padStart(14)}  ${per('fell').padStart(11)}  ${per('colossi').padStart(10)}`)
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
  // above 40%), and the deaths by a foe of a later wave (depth); the median battle length by floor; and the build
  // spread in wins (no build in more than ~25%): the commonest Legendaries, kin and tracks.
  console.log('\nlevel   acted  Monarch deaths/defeats  top threat  depth  ceiling')
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
      String(lost.length - killed.length).padStart(7)
    ]
    console.log(cols.join('  '))
  })
  console.log('\nlevel   median battle ticks by floor')
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
      const b = playOut(createBattle({ ...setup, party, quiet: true }))
      const mine = b.units.filter((u) => u.side === 'party' && !u.shadow)
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
// `--variants fusions,bodies`) plays only those ablations beside the full expert, for a quicker check. Each drop
// is checked against its band (BANDS): a core mechanic should cost 25–50 points, an extra one 8–25.
export const CORE = ['tracks', 'formation', 'bodies']
export const EXTRA = ['fusions', 'legendaries', 'relics', 'synergies']
export const BANDS = { ...Object.fromEntries(CORE.map((m) => [m, [25, 50]])), ...Object.fromEntries(EXTRA.map((m) => [m, [8, 25]])) }
async function ablations ({ runs, seed: seed0, variants = ABLATIONS, out = null }) {
  variants = [null, ...variants]
  const t0 = Date.now()
  const played = await playAll(variants.flatMap((ablate) => Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level: 'expert', ablate }))))
  // With `out`, every run's outcome as JSON (for pairing two sweeps seed by seed).
  if (out) {
    fs.writeFileSync(out, JSON.stringify({
      runs, seed: seed0, minutes: (Date.now() - t0) / 60000,
      played: played.map((r, i) => ({ seed: `${seed0}-${i % runs}`, ablate: variants[Math.floor(i / runs)], result: r.result, floor: r.floor, fell: r.fell, progress: r.progress, secs: r.secs, rehearsals: r.rehearsals }))
    }, null, 1))
  }
  const fought = played.reduce((n, r) => n + r.rehearsals.fought, 0)
  const memo = played.reduce((n, r) => n + r.rehearsals.memo, 0)
  console.log(`runs ${runs} per variant (seed ${seed0}), the expert with one mechanic taken away, the same seeds each; ${((Date.now() - t0) / 60000).toFixed(1)} min` +
    ` (rehearsals: ${fought} fought, ${memo} from the memo, ${(100 * memo / Math.max(1, fought + memo)).toFixed(0)}%)`)
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
  console.log('\nuses over the runs: stacks made, fusions made, track tiers held, Legendaries and other relics held at the end')
  console.log('variant         stack   fuse  tiers  legend  relics')
  for (const { ablate, mine } of rows) {
    const sum = (f) => String(mine.reduce((n, r) => n + f(r), 0)).padStart(6)
    console.log(`${(ablate ?? 'full').padEnd(13)}  ${[(r) => r.acts.stack ?? 0,
      (r) => r.acts.fuse ?? 0, (r) => r.tiers, (r) => r.legendaries.length, (r) => r.relics - r.legendaries.length].map(sum).join(' ')}`)
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
  const verdict = (ablate, v) => !BANDS[ablate] ? '(not targeted)' : v < BANDS[ablate][0] ? 'under' : v > BANDS[ablate][1] ? 'over' : 'in'
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
  console.log(`\ncheck: full expert ${(100 * full).toFixed(0)}% (target >= 90%), progress ${(100 * mean(prog[0])).toFixed(1)}; drops against their bands (core 25–50, extra 8–25)`)
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
//   arise, synergies, bodies  the rules switch (as the full ablation's)
//   fusions        every fused piece back in its parts (unfused)
//   tracks         no tier on any track, and so every kind at the level that gives (a fused kind's `least` kept; its
//                  souls' wounds kept as a share)
//   legendaries    none but Arise (the domain and the field as without them)
//   relics         no Common, Uncommon or Rare relic (no such mods, no such triggers, the field and the Monarch's
//                  max HP as without them, its wounds kept as a share)
//   formation      the souls in basic's first draft's cells
export const NECESSITY = ABLATIONS
export function stripped (state, mechanic = null) {
  const s = structuredClone(state)
  const run = { state: s, battle: null, setup: null }
  const team = souls(s.party)
  const relevel = (u, lvl) => {
    const max = u.count * baseStats(u.id, lvl).hp
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
  } else if (mechanic !== null) {
    throw new Error(`unknown mechanic "${mechanic}": ${NECESSITY.join(', ')}`)
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

// A run's state with every fused piece back in its parts (the recipe whose result it is: FUSION_LIST): each kind a
// piece of the bodies the recipe takes (for each body of the fused piece), at its kind's level and tiers (for a
// kind the run never held, its first level, with none), wounded as the fused piece was; each on the
// first of the fused piece's cells it fits (a 2×2 piece's four, the anchor first), else in the ossuary. Mutates s.
function unfused (s) {
  for (const u of souls(s.party).filter((x) => unitDef(x.id).fused)) {
    const recipe = FUSION_LIST.find((r) => r.result === u.id)
    if (!recipe) continue
    const cells = cover(u)
    s.party = s.party.filter((x) => x !== u)
    const taken = new Set(s.party.filter((x) => x.slot >= 0).flatMap(cover))
    for (const [kind, n] of Object.entries(recipe.needs)) {
      const k = s.kinds[kind] ?? { lvl: kindLevel(s, kind), tracks: [0, 0] }
      const part = makeUnit(kind, { uid: s.nextUid++, lvl: k.lvl, tracks: k.tracks.slice(), count: n * u.count })
      part.hp = u.hp > 0 ? Math.max(1, Math.round(part.maxHp * hpPct(u))) : 0
      part.slot = cells.find((c) => fits(s.camp, c, sizeOf(part), taken)) ?? -1
      cover(part).forEach((c) => taken.add(c))
      s.party.push(part)
    }
  }
}

// Refights each snapshot as it stood and once per mechanic stripped: → per snapshot, per variant
// { won, alive (the Monarch stands at the end), hp (the share of your side's HP kept, 0 for a loss) }, and
// whether the as-it-stood refight played out exactly as the real battle did.
export function refight ({ snaps, variants = [null, ...NECESSITY] }) {
  return snaps.map(({ snapshot, outcome }) => {
    const out = {}
    for (const m of variants) {
      // Only the as-it-stood refight is compared event by event; the rest keep no events.
      const b = playOut(createBattle({ ...battleSetup(stripped(snapshot, m)), quiet: m !== null }))
      const mine = b.units.filter((u) => u.side === 'party' && !u.shadow)
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
    const play = (job) => (job.book ? bookJob(job) : job.audit ? auditRecord(job) : job.refight ? refight(job) : record(job))
    if (workerData?.pool) {
      shareMemo(workerData.memo)
      parentPort.on('message', (job) => parentPort.postMessage(play(job)))
    }
    else parentPort.postMessage(play(workerData))
  } else {
    const arg = (name, def) => {
      const i = process.argv.indexOf('--' + name)
      return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
    }
    const opts = { seed: arg('seed', 'sim'), level: arg('level', 'expert') }
    if (!LEVELS[opts.level]) throw new Error(`unknown level "${opts.level}": ${Object.keys(LEVELS).join(', ')}`)
    const ablate = arg('ablate', null)
    if (ablate !== null && !ABLATIONS.includes(ablate)) throw new Error(`unknown ablation "${ablate}": ${ABLATIONS.join(', ')}`)
    // `--variants full` (alone or with others): the full expert only, beside whatever ablations are named.
    const variants = arg('variants', null)?.split(',').filter((v) => v !== 'full') ?? ABLATIONS
    for (const v of variants) if (!ABLATIONS.includes(v)) throw new Error(`unknown ablation "${v}": ${ABLATIONS.join(', ')}`)
    if (process.argv.includes('--combos')) await makeBook()
    else if (process.argv.includes('--audit')) await audit({ seed: arg('seed', 'audit'), runs: Number(arg('runs', 4)) })
    else if (process.argv.includes('--ablations')) await ablations({ ...opts, variants, runs: Number(arg('runs', RUNS.ablations)), out: arg('out', null) })
    else if (process.argv.includes('--necessity')) await necessity({ ...opts, runs: Number(arg('runs', RUNS.necessity)), setups: arg('setups', null) })
    else if (process.argv.includes('--decisions')) await decisions({ ...opts, runs: Number(arg('runs', RUNS.decisions)) })
    else if (process.argv.includes('--ladder')) await ladder({ ...opts, runs: Number(arg('runs', RUNS.ladder)) })
    else await report({ ...opts, ablate, runs: Number(arg('runs', RUNS.sim)) })
  }
}
