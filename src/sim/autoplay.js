// A player for tests and balance runs: a policy that picks one action at a time for apply(). It plays at
// one of two levels (LEVELS), on the same choices and the same scouting a player has:
//   basic   rules of thumb: rooms by weighted dice, the strongest souls fielded, the Monarch parked on
//           the camp's rear row in the middle lane, the best of three drafted formations, the first free
//           offer (a relic, a tier, a keystone), recruits only to fill the field, essence on the lowest level (a path tier once a soul
//           is ready for it), and Command only once two standing souls would wait on the bench with
//           every banner filled; only the free bodies bound (kinds its captains can lead first), each
//           captain a cohort of the most numerous kind it can lead, as many as Command allows, in a line,
//           and muster once it is the cheapest thing to buy while a cohort fights; default orders (every
//           soul Hunts, at once: a detachment it finds is disbanded); it never promotes a captain
//   expert  plans: every route over the next few ranks played out, wounds counted when fielding, the
//           formation (the Monarch's cell and the cohorts' kinds, counts and shapes too) hill-climbed
//           over cells and the ossuary, and the captains' orders (Stay, Hunt, Move to the domain's edge or a
//           wing, held for a body falling, the Monarch struck or, where more foes come, a wave) with them; a
//           Stay line, a screen beside the Monarch and a reserve among its drafts; free offers (keystones too)
//           weighed by rehearsing the fights ahead, recruits that
//           would make the field, essence on whatever buys the most worth per essence, and Monarch points,
//           muster and paid bodies when rehearsing the fights ahead says they beat the same essence spent
//           on the souls; the free bodies on the kind that rehearses best; a captain promoted when the rank
//           buys something (a Knight once its tier IV is next or rehearsal says the rank beats its bodies, a Marshal when rehearsal says the domain beats
//           the bodies; the strongest fielded first), and a Knight's or Marshal's tier IV and second path
//           bought by worth like any tier
// It knows the rules, not the rolls: rehearsals and rollouts never use a battle's own seed, nor the orders an
// elite's captains were given (never shown: it rehearses them on orders guessed from what their kinds may be
// bidden, a different guess each rehearsal seed). A rehearsal ends once its result is settled (battle.js settled), and
// the formation search fights a formation's remaining rolls only while they could still change its choice (plan:
// TUNING.autoplay.settle, prune).
// Run directly for a balance report:  node src/sim/autoplay.js [--runs 8] [--seed sim] [--level expert]
// for the gap between the levels:     … --ladder [--runs 8]
// or for a report on how much the player's choices decide battles:  … --decisions [--runs 8]
// or the expert with one mechanic taken away (ABLATIONS):  … --ablate orders  (a report as above)
// for how much each mechanic carries the expert, full runs:  … --ablations [--runs 8] [--variants full,orders,army] [--out runs.json]
// or as a fast battle-level proxy (its battles refought stripped): … --necessity [--runs 8] [--setups file]
// (the defaults, RUNS, are sized to one expert run per core: an expert run takes minutes; see README)
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRng } from './rng.js'
import {
  statsOf, pathsOf, tiersOf, autoPlace, CENTRE_OUT, CAMP_SLOTS, CAMP_ROWS, campGrid, campOpen, wallTiles, steps, deployTile,
  tileAt, tileX, tileY, TILES, LANES, DEPTH, rowOf, colOf, rangeOf, isAllyShape, distance, makeUnit, nearestOpen, slotAt, baseStats,
  seatNear, sealedBy
} from './unit.js'
import { createBattle, playOut, timelineHash } from './battle.js'
import {
  createRun, apply, availableNodes, fieldCap, rosterCap, fielded, benched, currentNode, battleSetup, levelCost, tierCost,
  isMonarch, monarchOf, souls, MONARCH_STATS, monarchCost, monarchPoints, canLead, musterCost, bindCost, standingOf, domainOf, isSquare,
  canPromote, canAdvance, advanced, holds, domainCentre, feedOf, promoteNeed, kinStanding, cohortCap
} from './run.js'
import { nodeOf, RANKS } from './map.js'
import { TUNING } from '../tuning.js'
import { unitDef, abilityDef, campDef, ROLES, SHAPES, DETACHMENT_COLORS, FOE_ORDERS } from '../content.js'

// seeds: rehearsals per formation (0: take the first draft unrehearsed); drafts: how many of the
// drafts to try (all by default); search: formations tried by hill-climbing from the best draft;
// wounds: field by worth with wounds counted; rollouts: walks per route when choosing a room (0:
// weighted dice), over the next `horizon` rooms; reap: weigh free offers by rehearsing the fights
// ahead, and recruit by worth; spend: buy by worth per essence (and Monarch points by rehearsal) rather
// than by rule of thumb; park: the Monarch always on the rear row, middle lane, never moved by the search;
// orders: draft and search the captains' orders (else every soul Hunts, at once); finalists, validate: the best
// `finalists` formations of the search fought again on `validate` fresh rolls, the best of them taken; keepOrders (no level has
// it: the fuzz test's) fights on whatever orders it finds instead of disbanding them, when it plans none.
export const LEVELS = {
  basic: { seeds: 1, search: 0, wounds: false, rollouts: 0, reap: false, spend: false, park: true, orders: false },
  expert: { seeds: 4, search: 12, finalists: 8, validate: 4, wounds: true, rollouts: 1, horizon: 3, reap: true, spend: true, park: false, orders: true }
}
// How an expert imagines a route (quick formations, basic offers), and sizes up an offer.
const ROLLOUT = { seeds: 0, search: 0, wounds: true, rollouts: 0, reap: false, spend: false, park: false, orders: false }
const SIZE_UP = { ...ROLLOUT, seeds: 1, drafts: 1 }
// How it sizes up a room it could walk into next: every draft, orders too, on two rolls (pickRoute).
const RISK = { ...ROLLOUT, seeds: 2, orders: true }

// ── ablation: the expert with one mechanic taken away ─────────────────────────────────────────────

// For measuring how much each mechanic carries the expert (--ablations, --necessity): a level's `ablate`
// takes ONE mechanic from it and changes nothing else; essence it would have spent there goes where its
// spending logic already sends it. Everything it plays ahead with (rehearsals, rollouts, sizing up an offer
// or a point) carries the same ablation:
//   monarch-stats  never buys a Monarch point (Dominion, Command, Will); a cohort holds only its captain's rank's bodies (TUNING.ranks.cohort)
//                  (run.js canCohort), so this takes the army with it
//   arise          the Monarch's Arise never casts (a rules switch: the run's `ablate`, carried in every
//                  battle's setup) and it never buys Will
//   orders         no Stay or Move: every detachment's plan is Hunt (a held start is still allowed)
//   reserves       no held start: every detachment starts at once (Stay and Move still allowed)
//   army           no cohorts: never leads a body, never musters, never gives a cohort; it still binds bodies, as
//                  rank food only (chooseFood), so ranks stay within reach
//   ranks          never promotes
//   paths          never buys a path tier, and takes nothing of a rite's tiers; with tier IV out of reach a Knight
//                  is weighed as the step toward a Marshal (promotion)
//   keystones      never takes a keystone
//   relics         never takes a relic
//   synergies      the party holds no synergy in battle, at any step (a rules switch, as arise)
//   formation      no formation search: its souls in basic's first draft's cells (who it fields, its cohorts and
//                  orders still its own) and the Monarch parked where basic parks it
//   levels         never buys a level (reported, not targeted)
// A run of an ablation that is a rules switch must be made with it (ablatedRun); policy refuses one that is not.
export const ABLATIONS = ['monarch-stats', 'arise', 'orders', 'reserves', 'army', 'ranks', 'paths', 'keystones', 'relics', 'synergies', 'formation', 'levels']
export const RULE_SWITCHES = ['arise', 'synergies']
export const ablatedRun = (seed, ablate = null) => createRun({ seed, ablate: RULE_SWITCHES.includes(ablate) ? [ablate] : null })
// A level as it plays ahead for L: the same ablation carried.
const as = (base, L) => (L.ablate ? { ...base, ablate: L.ablate } : base)
// The Monarch stats L may buy.
export const statsFor = (L) => MONARCH_STATS.filter((stat) => L.ablate !== 'monarch-stats' && !(L.ablate === 'arise' && stat === 'will'))
// The free offer type L never takes.
const BANNED = { paths: 'tier', keystones: 'keystone', relics: 'relic' }

// A formation as L may field it: under 'orders' every plan Hunts (its start kept), under 'reserves' every plan
// starts at once (a plan left Hunting at once is no order: null); under 'formation' the cells basic's first draft
// gives (basicCells). Anything else as it is.
function allowed (run, party, L) {
  if (L.ablate === 'orders' || L.ablate === 'reserves') {
    party = party.map((u) => {
      if (!u.order) return u
      const o = L.ablate === 'orders' ? { where: 'hunt', square: null, when: u.order.when } : { ...u.order, when: { at: 'once' } }
      return { ...u, order: o.where === 'hunt' && o.when.at === 'once' ? null : o }
    })
  }
  return L.ablate === 'formation' ? basicCells(run, party, L) : party
}

// Basic's first draft's cells for these units (L's fielding order, as its drafts take them): the Monarch on
// basic's parking cell, the souls by role row from the middle lane (every other lane against blasts).
// Cohorts and orders are kept.
function basicCells (run, party, L) {
  const s = run.state
  const camp = campGrid(s.camp)
  const cell = rearCell(s.camp)
  const cols = blasts(currentNode(run).foes) ? SPREAD : CENTRE_OUT
  const grid = { rows: camp.rows, open: (slot) => slot !== cell && camp.open(slot) }
  const placed = autoPlace(party.filter((u) => !isMonarch(u) && u.hp > 0).sort(L.wounds ? byFieldPower : byPower).map((u) => ({ ...u, slot: -1 })), { cols, grid })
  const at = new Map(placed.map((u) => [u.uid, u.slot]))
  return party.map((u) => ({ ...u, slot: isMonarch(u) ? cell : at.get(u.uid) ?? -1 }))
}

const hpPct = (u) => u.hp / u.maxHp
const partyHealth = (party) => party.reduce((n, u) => n + hpPct(u), 0) / party.length
const byPower = (a, b) => power(b) - power(a) || a.uid - b.uid
// An expert counts wounds: a soul at 10% HP is not worth fielding at full price.
const byFieldPower = (a, b) => fieldPower(b) - fieldPower(a) || a.uid - b.uid

// Rough fighting worth from its stats, path tiers included: how long it lasts times how hard it hits,
// square-rooted. A tier that grants an ability or an aura counts as a tenth more. 0 for the fallen, and
// for the Monarch, which never strikes: what it is worth only a rehearsal can tell.
function worth (u) {
  if (u.hp <= 0 || isMonarch(u)) return 0
  const s = statsOf(u)
  const lasts = s.hp * (1 + s.def / 100) / s.damage.taken * (1 + s.eva / 60)
  const hits = s.atk * s.damage.dealt * (TUNING.gauge.base + s.spd / TUNING.gauge.spdDivisor) * s.gauge.rate *
    (1 + s.crt / 100 * (TUNING.crit.mult - 1)) * (s.acc / (s.acc + 15)) * (1 + 0.3 * (s.heal.given - 1))
  const signature = tiersOf(u).filter((t) => t.ability || t.aura).length
  return Math.sqrt(lasts * hits) * (1 + 0.1 * signature)
}
const power = worth
const fieldPower = (u) => worth(u) * Math.sqrt(hpPct(u))

// The run as it would be standing in another room: what battleSetup needs, nothing copied.
const atNode = (run, node, state = {}) => ({ ...run, state: { ...run.state, ...state, at: node.id } })
// A copy to play ahead on, with its own rolls. A rollout's copy (`roll`) is the floor as a player knows it:
// the elite captains' orders, never shown, are struck from its rooms, so its fights are rehearsals too.
function fork (run, roll) {
  const state = structuredClone(run.state)
  if (roll !== undefined) {
    state.seed = `${state.seed}|rollout|${roll}`
    for (const n of state.map.nodes) for (const f of [n.foes ?? [], ...(n.waves ?? []).map((w) => w.foes)].flat()) { delete f.order; delete f.square }
  }
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
  const w = { fight: 3, elite: health > 0.7 ? 1.5 : 0.3, reliquary: 2, altar: health < 0.6 ? 5 : 0.5, rite: 1.5, boss: 1, siege: health > 0.7 ? 1.5 : 0.3 }
  return { type: 'node', id: rng.weighted(nodes, nodes.map((n) => w[n.type])).id }
}

// The expert walks every route over the next `horizon` rooms `rollouts` times on its own rolls, with
// quick formations and basic offers, and takes the first room of the route that ends best on average. A
// rollout's quick formation can win a fight by luck, so first it sizes up each battle room it could walk into
// next (RISK: every draft, its orders' too, on two rolls): a room where its best formation still loses a
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
// retinue's strength at the route's end over its strength now. Routes that share their first rooms share
// those fights: the walk only branches where the map does.
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
    if (s.floor !== floor || here.length >= depth) return [[here.join(' '), 1 + 0.5 * strength(s) / start]]
    return rollout(branch, start, depth, R, here)
  })
}

// What a retinue brings to its next fight: the fieldable souls' wounded power and the bodies their
// cohorts lead, raised by relics.
function strength (s) {
  const best = souls(s.party).map(fieldPower).sort((a, b) => b - a).slice(0, fieldCap({ state: s }))
  const bodies = souls(s.party).reduce((n, u) => n + (u.cohort ? u.cohort.count * worth(makeUnit(u.cohort.kind, { lvl: s.muster })) : 0), 0)
  return (best.reduce((n, p) => n + p, 0) + bodies) * (1 + 0.08 * s.relics.length) || 1
}

// ── prep: the formation ──────────────────────────────────────────────────────────────────────────────

// The autoplayer arranges its souls with the same choice a player has: any open camp cell. It drafts a
// few formations and rehearses each against the scouted foes on a different battle seed (it knows the
// rules, not the rolls), keeping the one that does best; ties keep the earlier draft:
//   rows       each role's row, packed from the middle lane (bonds and auras want neighbours)
//   spread     each role's row, every other lane first (against area attacks)
//   sheltered  the melee where foes walking in arrive first; ranged souls behind the walls, where foes
//              must walk furthest to reach them for how close they stand
// An expert then hill-climbs from the best draft: swapping two souls, moving one to another cell, trading
// one for a standing soul from the bench, changing a cohort's shape, kind or count, or a captain's order
// (replan), keeping each change that rehearses better.
// The Monarch takes its cell first: basic parks it on the rear row, middle lane; an expert drafts it
// mid-camp (its role's row, behind the souls) and once at the back, and its search moves it like a soul
// (it is never traded away). Every draft gives the captains their cohorts by rule of thumb (cohortsFor).
// An expert also drafts orders: on the first mid-camp formation every captain on Stay (a line where it
// stands), and that line with its toughest captain on Stay on the cell ahead of the Monarch (a screen); with
// the Monarch at the back, every captain on Stay at the domain's edge (a line as far ahead as the domain
// holds it); the first formation with its weakest captain held back until a body falls (a reserve that
// plugs the breach), and in a room with waves one held for the wave; and the Monarch in its pocket, the
// cell with the fewest approach tiles, with all of them,
// or half, held by its toughest captains on Stay (a screen against flankers). A soul's order rides on its formation entry as `order` ({ where, square, when }, or
// null for Hunt at once); captains with the same order make one detachment (detachmentsOf).

const SPREAD = [3, 1, 5, 2, 4, 0, 6]
const blasts = (foes) => foes.some((f) => unitDef(f.id).abilities.some((id) => abilityDef(id).shape === 'blast'))
const reachOf = (u) => Math.max(1, ...unitDef(u.id).abilities.map(abilityDef).filter((a) => !isAllyShape(a.shape)).map(rangeOf))

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

function sheltered (units, camp, taken) {
  const walk = walkIn(camp)
  const free = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(camp, slot) && slot !== taken)
  const lane = (slot) => CENTRE_OUT.indexOf(colOf(slot))
  const melee = (u) => reachOf(u) === 1
  const row = (u) => ROLES[unitDef(u.id).role].autoRow
  const order = units.slice().sort((a, b) => melee(b) - melee(a) || row(a) - row(b))
  for (const u of order) {
    const off = (slot) => Math.abs(rowOf(slot) - row(u))
    const score = melee(u) ? (slot) => walk(slot) : (slot) => -(walk(slot) - rowOf(slot) - 1)
    free.sort((a, b) => score(a) - score(b) || off(a) - off(b) || lane(a) - lane(b))
    u.slot = free.shift()
  }
  return units
}

// The Monarch's parking spot: the rear row's middle lane, or the open cell nearest it; the expert's other
// draft, mid-camp. Neither ever a cell where the Monarch would seal souls in (seatNear).
const rearCell = (camp) => seatNear(camp)
const midCell = (camp) => seatNear(camp, slotAt(ROLES.monarch.autoRow, CENTRE_OUT[0]))

// Cohorts by rule of thumb: the captains in turn (strongest first) each take the kind they can lead with
// the most bodies left (ties to the higher tier), as many as Command allows, in `shape`. Mutates captains.
function cohortsFor (s, captains, shape = 'line', L = {}) {
  if (L.ablate === 'army') return captains.map((c) => Object.assign(c, { cohort: null }))
  const left = Object.fromEntries(Object.keys(s.ossuary).map((k) => [k, standingOf(s, k)]))
  for (const c of captains) {
    const kind = Object.keys(left).filter((k) => left[k] > 0 && canLead(c, k))
      .sort((a, b) => left[b] - left[a] || unitDef(b).tier - unitDef(a).tier || (a < b ? -1 : 1))[0]
    const count = kind ? Math.min(cohortCap(s, c), left[kind]) : 0
    c.cohort = count ? { kind, count, shape } : null
    if (count) left[kind] -= count
  }
  return captains
}

function drafts (run, want, L) {
  const s = run.state
  const camp = campGrid(s.camp)
  const blank = () => cohortsFor(s, want.map((u) => ({ ...u, slot: -1 })), 'line', L)
  const lanes = blasts(currentNode(run).foes) ? [SPREAD, CENTRE_OUT] : [CENTRE_OUT, SPREAD]
  const around = (cell) => {
    const m = { ...monarchOf(s), slot: cell }
    const grid = { rows: camp.rows, open: (slot) => slot !== cell && camp.open(slot) }
    return {
      rows: (cols) => [m, ...autoPlace(blank(), { cols, grid })].map((u) => ({ ...u })),
      sheltered: () => [{ ...m }, ...sheltered(blank(), s.camp, cell)]
    }
  }
  const rear = around(rearCell(s.camp))
  if (L.park) return [rear.rows(lanes[0]), rear.rows(lanes[1]), rear.sheltered()]
  const mid = around(midCell(s.camp))
  const out = [mid.rows(lanes[0]), mid.rows(lanes[1]), mid.sheltered(), rear.rows(lanes[0])]
  if (!L.orders) return out
  const copy = (party) => party.map((u) => ({ ...u }))
  const line = out[0].map((u) => (isMonarch(u) ? { ...u } : { ...u, order: STAY }))
  const toughest = line.filter((u) => !isMonarch(u)).sort((a, b) => toughness(b) - toughness(a) || a.uid - b.uid)[0]
  const open = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(s.camp, slot))
  const reserve = copy(out[0])
  const last = reserve.find((u) => u.uid === want.at(-1)?.uid)
  if (last && want.length > 1) last.order = FALLS
  const nook = around(pocketCell(s.camp)).rows(lanes[0])
  // Where more foes will come, that reserve held for the wave instead.
  const wave = currentNode(run).waves && last && want.length > 1 ? copy(reserve).map((u) => (u.uid === last.uid ? { ...u, order: WAVE } : u)) : null
  // The banners that would find no place on the board (fielding order, captain and cohort counted) held until
  // a body falls: held, they stand past the board's cap in places of their own.
  const spill = (party) => {
    let n = 0
    const over = new Set()
    for (const w of want) {
      const u = party.find((x) => x.uid === w.uid)
      if (!u) continue
      n += 1 + (u.cohort?.count ?? 0)
      if (n > TUNING.army.board && w !== want[0]) over.add(u.uid)
    }
    return over.size ? party.map((u) => (over.has(u.uid) ? { ...u, order: FALLS } : u)) : null
  }
  const spills = [spill(copy(out[0])), spill(copy(line))].filter(Boolean)
  return [
    ...out, line, ...(toughest ? [screen(copy(line), toughest.uid, open)] : []), edgeLine(copy(out[3]), s),
    ...(last && want.length > 1 ? [reserve] : []), pocket(copy(nook), s, Infinity), pocket(copy(nook), s, Math.ceil(want.length / 2)),
    ...(wave ? [wave] : []), ...spills
  ]
}

// The Monarch's pocket: the open camp cell with the fewest approach tiles (the open tiles a step onto it
// can come from: walls and the board's edge close the rest), the rearmost first, then the middle lanes.
function pocketCell (camp) {
  const walls = new Set(wallTiles(camp))
  const lane = (slot) => CENTRE_OUT.indexOf(colOf(slot))
  const ways = (slot) => steps(deployTile('party', slot), walls).length
  return [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(camp, slot))
    .sort((a, b) => ways(a) - ways(b) || rowOf(b) - rowOf(a) || lane(a) - lane(b))[0]
}

// A screen against flankers, who walk through any line to the deepest foe: the Monarch's approach tiles in
// the camp held by its toughest captains on Stay, up to `n` of them (ahead first), so a flanker finds no
// open tile beside it.
function pocket (out, s, n) {
  const m = deployTile('party', out.find(isMonarch).slot)
  const cells = steps(m, new Set(wallTiles(s.camp))).filter((t) => tileY(t) < CAMP_ROWS)
    .map((t) => slotAt(CAMP_ROWS - 1 - tileY(t), tileX(t))).sort((a, b) => rowOf(a) - rowOf(b) || a - b)
  const caps = out.filter((u) => !isMonarch(u)).sort((a, b) => toughness(b) - toughness(a) || a.uid - b.uid)
  cells.slice(0, n).forEach((slot, i) => caps[i] && post(out, caps[i].uid, slot))
  return out
}

// What a captain is worth on a tile it must hold: how much it takes to fell.
const toughness = (u) => {
  const st = statsOf(u)
  return st.hp * (1 + st.def / 100)
}

// ── orders ───────────────────────────────────────────────────────────────────────────────────────

const STAY = { where: 'stay', square: null, when: { at: 'once' } }
const FALLS = { where: 'hunt', square: null, when: { at: 'falls' } }
const WAVE = { where: 'hunt', square: null, when: { at: 'wave' } }

// The camp row at the domain's edge: the furthest ahead of its centre still inside it.
export const edgeRow = (s, party) => CAMP_ROWS - 1 - Math.min(CAMP_ROWS - 1, tileY(centreOf(s, party)) + domainOf(s))

// A line at the domain's edge: each captain, front ones first, on Stay on the open cell nearest the edge row
// in its lane.
function edgeLine (out, s) {
  const row = edgeRow(s, out)
  for (const c of out.filter((u) => !isMonarch(u)).sort((a, b) => rowOf(a.slot) - rowOf(b.slot) || a.uid - b.uid)) {
    const slot = nearestOpen(campGrid(s.camp), slotAt(row, colOf(c.slot)), new Set(out.filter((u) => u !== c).map((u) => u.slot)))
    if (slot >= 0) post(out, c.uid, slot)
  }
  return out
}

// The detachments a formation's orders make: captains with the same order, in formation order, as the run
// keeps them (ids from 1, each with its colour). No more than the run allows (TUNING.army.detachments): a
// formation's search keeps within that (replan), and any order past it is dropped here (those captains
// Hunt, at once), so a rehearsal fights what the run can be told, and pickPrep never asks for an order
// the run refuses.
export function detachmentsOf (party) {
  const groups = new Map()
  for (const u of party) {
    if (!u.order || isMonarch(u)) continue
    const key = JSON.stringify(u.order)
    if (!groups.has(key)) groups.set(key, { plan: u.order, members: [] })
    groups.get(key).members.push(u.uid)
  }
  return [...groups.values()].slice(0, TUNING.army.detachments)
    .map((g, i) => ({ id: i + 1, color: DETACHMENT_COLORS[i % DETACHMENT_COLORS.length], members: g.members, plan: g.plan }))
}

// The tile a formation's domain centres on as the battle begins (domainCentre, on its cells and the
// detachments its orders make): the Monarch's, or under Vanguard Crown its front-most captain's.
const centreOf = (s, party) => deployTile('party', domainCentre({ ...s, party, detachments: detachmentsOf(party) }))

// The menu a captain's order is drawn from: where (Stay; Hunt; Move to the domain's edge in its lane, the
// furthest tile ahead of its centre still inside the domain; Move to a wing of the foes' front) and when (at once, or
// held until a body falls or the Monarch is struck, or in a room with waves until one enters). Hunt at once is
// no order at all: null.
function drawOrder (s, party, c, rng) {
  const where = rng.pick(['stay', 'hunt', 'edge', 'wing'])
  const at = rng.pick(['once', 'once', 'falls', 'struck', ...(nodeOf(s.map, s.at)?.waves ? ['wave'] : [])])
  if (where === 'hunt' && at === 'once') return null
  const m = centreOf(s, party)
  const lane = colOf(c.slot)
  let square = null
  if (where === 'edge') {
    for (let y = Math.min(DEPTH - 1, tileY(m) + domainOf(s)); square === null && y >= tileY(m); y--) if (isSquare(s, tileAt(lane, y))) square = tileAt(lane, y)
  } else if (where === 'wing') {
    square = tileAt(rng.chance(0.5) ? 0 : LANES - 1, CAMP_ROWS + 1)
  }
  return { where: square === null ? (where === 'hunt' ? 'hunt' : 'stay') : 'move', square, when: { at } }
}

// Moves a captain to `slot` (whoever stands there takes its old cell), on Stay: the cell is its post.
function post (out, uid, slot) {
  const c = out.find((u) => u.uid === uid)
  const other = out.find((u) => u.slot === slot && u !== c)
  if (other) other.slot = c.slot
  c.slot = slot
  c.order = STAY
  return out
}

// A screen: the captain on Stay on an open cell beside the Monarch, the cells ahead of it first, then the
// nearest lanes (never the Monarch's own cell).
function screen (out, uid, open) {
  const m = out.find(isMonarch)
  const cells = open.filter((slot) => slot !== m.slot && distance(deployTile('party', slot), deployTile('party', m.slot)) === 1)
    .sort((a, b) => rowOf(a) - rowOf(b) || Math.abs(colOf(a) - colOf(m.slot)) - Math.abs(colOf(b) - colOf(m.slot)) || a - b)
  const free = cells.filter((slot) => !out.some((u) => u.slot === slot))
  const slot = free[0] ?? cells.find((slot) => out.some((u) => u.slot === slot && !isMonarch(u)))
  return slot === undefined ? out : post(out, uid, slot)
}

// One change to the orders: a captain's order cleared (it Hunts), set to one another detachment has (it
// joins it), set afresh from the menu (drawOrder), or the captain posted on Stay: beside the Monarch (a
// screen) or on the camp's cell nearest the domain's edge in its lane (a line). Never more than
// TUNING.army.detachments different orders, whichever way the change came: a captain whose new order
// would be one past that joins an existing one instead (where it was posted, if it was).
export function replan (out, s, rng, open) {
  const caps = out.filter((u) => !isMonarch(u))
  if (!caps.length) return out
  const c = rng.pick(caps)
  const others = [...new Set(caps.filter((u) => u !== c && u.order).map((u) => JSON.stringify(u.order)))]
  const roll = rng()
  if (c.order && roll < 0.15) {
    c.order = null
  } else if (others.length && roll < 0.35) {
    c.order = JSON.parse(rng.pick(others))
  } else if (roll < 0.5) {
    screen(out, c.uid, open)
  } else if (roll < 0.65) {
    const slot = nearestOpen(campGrid(s.camp), slotAt(edgeRow(s, out), colOf(c.slot)), new Set(out.filter((u) => u !== c).map((u) => u.slot)))
    if (slot >= 0) post(out, c.uid, slot)
  } else {
    c.order = drawOrder(s, out, c, rng)
  }
  if (c.order && others.length >= TUNING.army.detachments && !others.includes(JSON.stringify(c.order))) c.order = JSON.parse(rng.pick(others))
  return out
}

const rehearsalSeed = (setup, k) => setup.seed + '|rehearsal' + (k ? '|' + k : '')

// The budget rehearsals run on (TUNING.autoplay): a battle still going at `ceiling` ticks counts as a loss,
// and a battle of more than `bigBattle` units on the board at the start is rehearsed on one roll (the
// reserve is not counted: it only enters as bodies fall, which they seldom do). Foe waves need no more: a
// ceiling counts from the last foe to enter (battle.js checkEnd), so a rehearsal always meets every wave
// (each comes at most TUNING.spawn.waves.t after the one before, well inside the budget). → { seeds, ceiling }
export function rehearsalBudget (setup, seeds) {
  const A = TUNING.autoplay
  const big = setup.party.length + setup.foes.length > A.bigBattle
  return { seeds: big ? Math.min(seeds, 1) : seeds, ceiling: A.rehearsalCeiling }
}

// A rehearsal's worth, averaged over its budget's rolls: a win by how much HP it keeps (wounds carry
// over; the Monarch's counts as much as all the souls', and shadows leave anyway), from 1 to 2; a loss by how
// much of the foes' HP it took, from −LOSS − 1 to −LOSS. A fallen Monarch is a loss, whoever else stands, and
// so is the ceiling. A loss ends the run, so it weighs LOSS more than the worst win: a formation that loses
// one roll in six to save a few wounds in the other five is not the better one.
// The formation is rehearsed in the run's party order with the detachments its orders make, as the real
// fight will set it up: the order decides which captain's bodies take the board first and which wait in
// reserve (armyLayout).
export function rehearse (run, party, want = 1, { from = 0, full = false, beats = null } = {}) {
  const order = new Map(run.state.party.map((u, i) => [u.uid, i]))
  const rank = (u) => order.get(u.uid) ?? Infinity
  party = party.slice().sort((a, b) => rank(a) - rank(b))
  // Scouted: the foes' orders are what it cannot know. What it does know, as a player who has met them does,
  // is what each kind may be bidden (its foeOrders, hinted in its flavour): so in an elite each rehearsal
  // gives every captain an order drawn from its kind's list on the rehearsal's own seed (guessOrders), never
  // the one it was given, and an elite is rehearsed on at least two seeds (two guesses) where it may.
  // `from`, `full`: a validation (plan) rehearses on seeds of its own, from `from` on, all `want` of them
  // however big the battle. `beats` (a search's: plan): told the best mean the rolls still to come could reach
  // (every one of them scoring BEST), whether that could still change the search's choice; once it could not,
  // the rest are not fought and the formation's score is null. Exact: the score it would have had is no higher.
  const setup = battleSetup(run, { party, detachments: detachmentsOf(party), scout: true })
  const elite = currentNode(run).type === 'elite'
  const budget = rehearsalBudget(setup, want)
  const { ceiling } = budget
  const seeds = full ? want : elite ? Math.max(budget.seeds, Math.min(want, 2)) : budget.seeds
  let total = 0
  for (let k = from; k < from + seeds; k++) {
    total += rehearsed({ ...setup, ...(elite && guessOrders(setup, rehearsalSeed(setup, k))), seed: rehearsalSeed(setup, k), ceiling })
    if (beats && k + 1 < from + seeds) {
      // Added roll by roll, as the total itself is: rounding is monotone, so the mean it ends on is no higher.
      let most = total
      for (let j = k + 1; j < from + seeds; j++) most += BEST
      if (!beats(most / seeds)) return null
    }
  }
  return total / seeds
}

// A rehearsal's score (scoreOf) for one battle's input, fought once: a battle is a pure function of its setup
// (and of TUNING and the content), so the same setup on the same seed is never refought, from whichever plan,
// draft, climb step or size-up it comes. Keyed on the setup's content (a SHA-1 digest of its JSON with TUNING's),
// not its identity. The memo is the thread's own (a Map, bounded: cleared when full), or in a pool's worker the
// table all its workers share (shareMemo). Either way a miss only costs the fight.
const MEMO_CAP = 600000
const memo = new Map()
export const memoStats = { hits: 0, misses: 0 }
function rehearsed (input) {
  const digest = createHash('sha1').update(tuningKey()).update(JSON.stringify(input)).digest()
  const have = table ? tableGet(digest) : memo.get(digest.toString('base64'))
  if (have !== undefined) { memoStats.hits++; return have }
  memoStats.misses++
  const score = scoreOf(playOut(createBattle({ ...input, quiet: true, settle: TUNING.autoplay.settle })))
  if (table) {
    tablePut(digest, score)
  } else {
    if (memo.size >= MEMO_CAP) memo.clear()
    memo.set(digest.toString('base64'), score)
  }
  return score
}
// TUNING as JSON, for the memo's key: tests change it between runs. Re-read on every call (it is small).
const tuningKey = () => JSON.stringify(TUNING)

// The memo a pool's workers share (playAll): an open-addressed hash table in a SharedArrayBuffer, MEMO_SLOTS
// slots of six 32-bit words: [state, key, key, key, score, score] (state 0 empty, 1 being written, 2 ready; the
// key the digest's first 96 bits; the score a float64). A worker claims an empty slot by compare-and-swap, writes
// it, then marks it ready; a reader takes a slot only once it is ready. Two workers may fight the same battle at
// once and both write it (the same score): that costs a fight, never a result. Nothing is ever removed; a key
// that finds no free slot within MEMO_PROBES is not kept.
const MEMO_SLOTS = 1 << 23
const MEMO_BYTES = MEMO_SLOTS * 24
const MEMO_PROBES = 64
let table = null
export function shareMemo (buffer) {
  table = { words: new Int32Array(buffer), scores: new Float64Array(buffer), mask: buffer.byteLength / 24 - 1 }
}
function tableGet (digest) {
  const { words, scores, mask } = table
  const k0 = digest.readInt32LE(0)
  const k1 = digest.readInt32LE(4)
  const k2 = digest.readInt32LE(8)
  for (let p = 0, i = k0 & mask; p < MEMO_PROBES; p++, i = (i + 1) & mask) {
    const b = i * 6
    const state = Atomics.load(words, b)
    if (state === 0) return undefined
    if (state === 2 && words[b + 1] === k0 && words[b + 2] === k1 && words[b + 3] === k2) return scores[i * 3 + 2]
  }
  return undefined
}
function tablePut (digest, score) {
  const { words, scores, mask } = table
  const k0 = digest.readInt32LE(0)
  const k1 = digest.readInt32LE(4)
  const k2 = digest.readInt32LE(8)
  for (let p = 0, i = k0 & mask; p < MEMO_PROBES; p++, i = (i + 1) & mask) {
    const b = i * 6
    const state = Atomics.load(words, b)
    if (state === 2 && words[b + 1] === k0 && words[b + 2] === k1 && words[b + 3] === k2) return
    if (state === 0 && Atomics.compareExchange(words, b, 0, 1) === 0) {
      words[b + 1] = k0
      words[b + 2] = k1
      words[b + 3] = k2
      scores[i * 3 + 2] = score
      Atomics.store(words, b, 2)
      return
    }
  }
}

// An elite's captains with the orders a rehearsal guesses for them (see rehearse): each foe that leads a
// cohort takes one of its kind's foeOrders, drawn on `seed`, a flank toward the wing nearer its lane as the
// room's own draw makes it (run.js foeOrder), and its cohort with it. → { foes, reserve }
export function guessOrders (setup, seed) {
  const rng = createRng(seed).stream('orders')
  const all = [...setup.foes, ...setup.reserve.filter((u) => u.side === 'foe')]
  const plans = new Map()
  for (const c of all.filter((u) => all.some((m) => m.cohortOf === u.uid))) {
    const order = rng.pick(unitDef(c.id).foeOrders ?? ['hunt'])
    const lane = c.lane ?? colOf(c.slot)
    const wing = lane * 2 < LANES - 1 ? 0 : lane * 2 > LANES - 1 ? LANES - 1 : rng.pick([0, LANES - 1])
    plans.set(c.uid, { where: FOE_ORDERS[order].where, square: order === 'flank' ? tileAt(wing, CAMP_ROWS) : null })
  }
  const give = (u) => {
    const plan = plans.get(u.uid) ?? plans.get(u.cohortOf)
    return plan ? { ...u, plan } : u
  }
  return { foes: setup.foes.map(give), reserve: setup.reserve.map((u) => (u.side === 'foe' ? give(u) : u)) }
}

const LOSS = 3
// The best a rehearsal can score: a win that keeps every HP (heals never pass max HP).
export const BEST = 2
export function scoreOf (b) {
  const share = (us) => us.length ? us.reduce((n, u) => n + u.hp, 0) / us.reduce((n, u) => n + u.maxHp, 0) : 0
  if (b.winner !== 'party') return -LOSS - share(b.units.filter((u) => u.side === 'foe'))
  const party = b.units.filter((u) => u.side === 'party' && !u.shadow)
  const kept = share(party.filter((u) => u !== b.monarch))
  return 1 + (b.monarch ? (kept + share([b.monarch])) / 2 : kept)
}

// Who stands in the camp: the strongest standing souls, wounds counted at the expert's level.
const standing = (party) => party.filter((u) => u.hp > 0)
const wanted = (run, L) => standing(souls(run.state.party)).sort(L.wounds ? byFieldPower : byPower).slice(0, fieldCap(run))

// → { party, score }: the best formation found for the current room. Formations that put everyone in
// the same cells with the same cohorts and orders are only rehearsed once. `enough` (the room veto's: pickRoute):
// the caller asks only whether the best score reaches it; with pruning on, the plan stops at the first formation
// that does, and a formation that cannot reach it is not fought on its remaining rolls. The answer is the same.
function plan (run, L, { enough = Infinity } = {}) {
  const want = wanted(run, L)
  const options = drafts(run, want, L).slice(0, L.drafts ?? Infinity).map((party) => allowed(run, party, L))
  if (!L.seeds) return { party: options[0], score: 0 }
  const tried = new Map()
  const forms = new Map()
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
  // A formation whose Monarch seals part of the camp in (sealedBy) is never taken: whoever stands behind it
  // could never reach the fight.
  const score = (party) => {
    if (sealedBy(run.state.camp, party.find(isMonarch).slot).length) return -Infinity
    const key = party.map((u) => `${u.uid}@${u.slot}${u.cohort ? `:${u.cohort.kind}×${u.cohort.count}:${u.cohort.shape}` : ''}${u.order ? JSON.stringify(u.order) : ''}`).sort().join()
    if (!tried.has(key)) {
      const bar = cut()
      const beats = enough < Infinity ? (most) => most >= enough : (most) => most > bar
      tried.set(key, rehearse(run, party, L.seeds, { beats: TUNING.autoplay.prune && beats }) ?? -Infinity)
      forms.set(key, party)
    }
    return tried.get(key)
  }
  let best = null
  let bestScore = -Infinity
  for (const party of options) {
    const v = score(party)
    if (!best || v > bestScore) { best = party; bestScore = v }
    if (bestScore >= enough && TUNING.autoplay.prune) return { party: best, score: bestScore }
  }
  const rng = createRng(JSON.stringify([run.state.seed, run.state.floor, run.state.at, best.map((u) => u.uid)])).stream('climb')
  const open = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(run.state.camp, slot))
  for (let i = 0; i < L.search; i++) {
    const next = allowed(run, mutate(best, standing(souls(run.state.party)), open, rng, run.state, L), L)
    const v = score(next)
    if (v > bestScore) { best = next; bestScore = v }
  }
  if (!L.validate) return { party: best, score: bestScore }
  // A big battle is rehearsed on one roll, and the climb keeps whatever beat the best so far on it: it learns
  // that roll, not the fight (a formation it took could win a third of fresh rolls where a draft it passed
  // over won them all). So the best `finalists` formations it found, drafts and climbs alike, are fought again
  // on `validate` fresh rolls of their own, and the best of those is taken (ties: the earlier rehearsal).
  const top = [...tried].filter(([, v]) => v > -Infinity).sort((a, b) => b[1] - a[1]).slice(0, L.finalists)
  let pick = null
  for (const [key, v] of top) {
    // A finalist whose rolls left cannot beat the pick so far (nor tie it with the better search score) is not
    // fought on them (exact, as above).
    const beats = TUNING.autoplay.prune && pick && ((most) => most > pick.fresh || (most === pick.fresh && v > pick.v))
    const fresh = rehearse(run, forms.get(key), L.validate, { from: 100, full: true, beats })
    if (fresh === null) continue
    if (!pick || fresh > pick.fresh || (fresh === pick.fresh && v > pick.v)) pick = { key, v, fresh }
  }
  return pick ? { party: forms.get(pick.key), score: pick.fresh } : { party: best, score: bestScore }
}

// One change to a formation: trade a soul for one from the bench (it takes over the cohort if it can lead
// it, and the order), swap two, move one to a free cell (a near one more often than not), or, with bodies
// to lead, a third of the time change a cohort; with `orders`, a third of the time change an order first.
// The Monarch is never traded, and with `park` never moved. With 'formation' ablated nothing is moved (the cells
// are basic's: see allowed): a change is a trade, an order or a cohort.
function mutate (party, pool, open, rng, s, L) {
  const out = party.map((u) => ({ ...u }))
  const fixed = L.ablate === 'formation'
  if (L.orders && rng.chance(0.35)) return replan(out, s, rng, open)
  if (armed(s, out, L) && rng.chance(0.3)) return recohort(out, s, rng)
  const movable = L.park || fixed ? out.filter((u) => !isMonarch(u)) : out
  const a = movable[rng.int(movable.length)]
  const spare = pool.filter((u) => !out.some((x) => x.uid === u.uid))
  const roll = rng()
  if (fixed && !(spare.length && a)) return L.orders ? replan(out, s, rng, open) : armed(s, out, L) ? recohort(out, s, rng) : out
  if (spare.length && (roll < 0.2 || fixed) && !isMonarch(a)) {
    const b = rng.pick(spare)
    // The cohort passes only as far as the newcomer's rank leads (cohortCap).
    const n = a.cohort && canLead(b, a.cohort.kind) ? Math.min(a.cohort.count, cohortCap(s, b)) : 0
    return out.map((u) => (u === a ? { ...b, slot: a.slot, cohort: n > 0 ? { ...a.cohort, count: n } : null, order: a.order ?? null } : u))
  }
  if (movable.length > 1 && roll < 0.55) {
    const b = rng.pick(movable.filter((u) => u !== a));
    [a.slot, b.slot] = [b.slot, a.slot]
    return out
  }
  const free = open.filter((slot) => !out.some((u) => u.slot === slot))
  const near = free.filter((slot) => distance(deployTile('party', slot), deployTile('party', a.slot)) <= 2)
  a.slot = rng.pick(near.length && rng.chance(0.7) ? near : free)
  return out
}

// Whether any captain of the formation could lead a body: Command, and bodies of a kind it can lead.
const armed = (s, party, L = {}) => L.ablate !== 'army' && party.some((c) => !isMonarch(c) && cohortCap(s, c) > 0 && Object.keys(s.ossuary).some((k) => standingOf(s, k) > 0 && canLead(c, k)))

// One change to the cohorts: a captain's shape, its kind (as many as it can take of another it can lead),
// or one body more or fewer, always within Command and the bodies the other captains leave.
function recohort (out, s, rng) {
  const caps = out.filter((c) => !isMonarch(c))
  const left = (c, k) => standingOf(s, k) - caps.reduce((n, x) => n + (x !== c && x.cohort?.kind === k ? x.cohort.count : 0), 0)
  const c = rng.pick(caps.filter((x) => x.cohort || Object.keys(s.ossuary).some((k) => left(x, k) > 0 && canLead(x, k))))
  const kinds = Object.keys(s.ossuary).filter((k) => left(c, k) > 0 && canLead(c, k))
  const roll = rng()
  if (c.cohort && roll < 0.5) {
    c.cohort = { ...c.cohort, shape: rng.pick(Object.keys(SHAPES).filter((x) => x !== c.cohort.shape)) }
  } else if (c.cohort && roll < 0.75) {
    const most = Math.min(cohortCap(s, c), left(c, c.cohort.kind))
    const count = c.cohort.count + (c.cohort.count < most && rng.chance(0.5) ? 1 : -1)
    c.cohort = count > 0 ? { ...c.cohort, count } : null
  } else if (kinds.length) {
    const kind = rng.pick(kinds)
    c.cohort = { kind, count: Math.min(cohortCap(s, c), left(c, kind)), shape: c.cohort?.shape ?? 'line' }
  }
  return out
}

// The plan only depends on the room, the camp, the relics, who is standing (not where, nor whom it leads),
// the bodies standing, the muster and the uids the foes will take, so it is made once per prep however many
// steps carry it out.
const plans = new WeakMap()
export function planFor (run, L) {
  const s = run.state
  const key = JSON.stringify([L, s.floor, s.at, s.camp, s.relics, s.keystones, s.monarch, s.nextUid, s.muster, bodiesKey(s), s.party.map((u) => [u.uid, u.id, u.lvl, u.hp])])
  const have = plans.get(run)
  if (have?.key === key) return have.plan
  const made = plan(run, L).party.map((u) => ({ uid: u.uid, slot: u.slot, cohort: u.cohort ?? null, order: u.order ?? null }))
  plans.set(run, { key, plan: made })
  return made
}
const bodiesKey = (s) => Object.entries(s.ossuary).map(([k, o]) => `${k}:${o.standing}`).join()
const sameCohort = (a, b) => (a ?? null) === (b ?? null) || (!!a && !!b && a.kind === b.kind && a.count === b.count && a.shape === b.shape)

// One step toward the plan: the souls it leaves out benched, then the Monarch to its cell (no one else
// is planned there, so it is never displaced again), then each soul in its planned cell (whoever stood
// there takes the mover's old one; a soul in place is never moved again), then every cohort that differs
// from the plan cleared (so the bodies are free), then the planned ones given; then every detachment the
// plan does not hold disbanded, then the planned ones ordered (basic plans none: it fights on default
// orders); then fight.
function pickPrep (run, L) {
  const s = run.state
  const spend = pickSpend(run, L)
  if (spend) return spend
  const goal = planFor(run, L)
  const out = fielded(souls(s.party)).find((u) => !goal.some((p) => p.uid === u.uid))
  if (out) return { type: 'place', uid: out.uid, slot: -1 }
  const m = goal.find((p) => isMonarch(p))
  if (m && monarchOf(s).slot !== m.slot) return { type: 'place', uid: m.uid, slot: m.slot }
  const off = goal.find((p) => s.party.find((u) => u.uid === p.uid).slot !== p.slot)
  if (off) return { type: 'place', uid: off.uid, slot: off.slot }
  const want = (u) => goal.find((p) => p.uid === u.uid)?.cohort ?? null
  const differs = souls(s.party).filter((u) => !sameCohort(u.cohort, want(u)))
  const clear = differs.find((u) => u.cohort)
  if (clear) return { type: 'cohort', uid: clear.uid, kind: null }
  const give = differs.find((u) => want(u))
  if (give) return { type: 'cohort', uid: give.uid, ...want(give) }
  if (!L.orders && L.keepOrders) return { type: 'fight' }
  const orders = L.orders ? detachmentsOf(goal) : []
  const same = (a, b) => a.members.length === b.members.length && a.members.every((uid) => b.members.includes(uid)) && JSON.stringify(a.plan) === JSON.stringify(b.plan)
  const stale = s.detachments.find((d) => !orders.some((o) => same(o, d)))
  if (stale) return { type: 'disband', id: stale.id }
  const missing = orders.find((o) => !s.detachments.some((d) => same(o, d)))
  if (missing) return { type: 'order', uids: missing.members, plan: missing.plan }
  return { type: 'fight' }
}

// ── essence ──────────────────────────────────────────────────────────────────────────────────────

// Essence goes to the souls that will fight: the strongest standing ones. Basic levels the lowest of
// them, but buys a path tier (its first path, or the one it is on) once a soul's level is three per
// tier it would hold; it buys Command first once two standing souls would wait on the bench with every
// banner filled (counted from the cap, not the camp: it spends before it places, so the souls a new banner
// will take still sit on the bench), and no other Monarch point; then the muster, once it is the cheapest
// thing to buy (musterFirst). An expert buys whatever adds the most worth per essence, committing a soul to
// the path whose three tiers add the most, unless rehearsal says a Monarch point or the next muster level is
// worth more (armyWish): then it saves for that and buys it. Before any of that, as promotion costs bodies,
// not essence, an expert promotes whenever a rank would buy something (promotion).
function pickSpend (run, L) {
  const s = run.state
  const up = L.spend && L.ablate !== 'ranks' && promotion(run, L)
  if (up) return up
  if (!L.spend) {
    if (statsFor(L).includes('command') && standing(souls(s.party)).length - fieldCap(run) >= 2 && s.essence >= monarchCost(run)) return { type: 'monarch', stat: 'command' }
    if (L.ablate !== 'army' && musterFirst(run, L)) return { type: 'muster' }
  } else {
    const wish = armyWish(run, L)
    if (wish === 'muster') return s.essence >= musterCost(run) ? { type: 'muster' } : null
    if (wish) return s.essence >= monarchCost(run) ? { type: 'monarch', stat: wish } : null
  }
  return soulSpend(run, L)
}

// The expert's rule for ranks: a rank only when it buys something, for the strongest fielded standing captain
// first, or null. A captain is made a Knight once its path stands at tier III (tier IV is next); a rank's might,
// cohort and a Marshal's domain show in a battle, so a Knight is made a Marshal, or (round 3) the strongest
// fielded Soldier a Knight, when rehearsing the fights ahead with it promoted, and its bodies eaten, beats keeping
// the bodies.
// (Promoting whenever bodies allowed made Knights of every captain on floor 2 and left their cohorts empty.)
// With paths ablated tier IV is out of reach, so a Knight buys nothing by itself; it is weighed as the step
// toward a Marshal instead: rehearsing both ranks taken (a Marshal, a Knight's bodies and a Marshal's eaten)
// against neither, once the kin's bodies stand for both.
const promotions = new WeakMap()
function promotion (run, L) {
  const s = run.state
  const ready = standing(fielded(souls(s.party))).sort(byFieldPower).filter((x) => canPromote(run, x))
  const knight = ready.find((u) => !u.grade && u.tier >= 3)
  if (knight) return { type: 'promote', uid: knight.uid }
  const twoStep = (x) => !x.grade && kinStanding(s, unitDef(x.id).kin) >= TUNING.ranks.knight + TUNING.ranks.marshal
  // A Knight's might and cohort (ranks.might, ranks.cohort) show in a battle too: with no Knight's rule firing,
  // the strongest fielded Soldier is weighed as a Knight (necessity round 3: with Command 0 the expert never
  // promoted, so it led no bodies at all).
  const u = ready.find((x) => x.grade === 1) ?? (L.ablate === 'paths' ? ready.find(twoStep) : null) ?? ready.find((x) => !x.grade)
  if (!u) return null
  const to = u.grade === 1 || (L.ablate === 'paths' && twoStep(u)) ? 2 : 1
  const key = JSON.stringify([L.ablate, s.floor, s.at, s.phase, s.camp, s.relics, s.keystones, s.monarch, s.nextUid, s.muster, bodiesKey(s), s.party.map((x) => [x.uid, x.id, x.lvl, x.grade, x.tier, x.hp > 0])])
  const have = promotions.get(run)
  if (have?.key === key) return have.up
  const value = valueAhead(run, L)
  const kin = unitDef(u.id).kin
  let ossuary = s.ossuary
  for (let g = u.grade ?? 0; g < to; g++) ossuary = eaten({ ...s, ossuary }, kin, promoteNeed({ grade: g }))
  const party = s.party.map((x) => (x.uid === u.uid ? { ...x, grade: to } : x))
  const up = value({ party, ossuary }) - value({}) > 0.01 ? { type: 'promote', uid: u.uid } : null
  promotions.set(run, { key, up })
  return up
}

// The ossuary once a promotion has eaten `n` bodies of `kin` (by the run's own rule: feedOf).
function eaten (s, kin, n) {
  const fed = feedOf(s, kin, n)
  return Object.fromEntries(Object.entries(s.ossuary).map(([k, o]) => [k, { ...o, standing: o.standing - (fed[k] ?? 0) }]))
}

// Basic's muster rule: while a fielded captain leads a cohort, muster once it costs no more than any level
// or path tier its fighting souls could take next (of those L may buy: none of an ablated kind).
function musterFirst (run, L = {}) {
  const s = run.state
  if (s.muster >= TUNING.army.muster.cap || s.essence < musterCost(run)) return false
  if (!fielded(souls(s.party)).some((u) => u.cohort && u.hp > 0)) return false
  const field = standing(souls(s.party)).sort(byFieldPower).slice(0, fieldCap(run))
  // Each path it could advance on, at that path's own price: a Marshal past tier IV still has its second.
  const costs = field.flatMap((u) => [u.lvl < TUNING.level.cap && L.ablate !== 'levels' ? levelCost(run, u) : Infinity,
    ...(L.ablate === 'paths' ? [] : nextPaths(u).map((path) => tierCost(run, u, path)))])
  return musterCost(run) <= Math.min(...costs)
}

function soulSpend (run, L) {
  const s = run.state
  const field = standing(souls(s.party)).sort(byFieldPower).slice(0, fieldCap(run))
  const options = field.flatMap((u) => [
    L.ablate !== 'levels' && s.essence >= levelCost(run, u) && u.lvl < TUNING.level.cap && { type: 'level', uid: u.uid, u, cost: levelCost(run, u), after: { ...u, lvl: u.lvl + 1 } },
    ...nextPaths(u).filter((path) => L.ablate !== 'paths' && s.essence >= tierCost(run, u, path))
      .map((path) => ({ type: 'upgrade', uid: u.uid, path, u, cost: tierCost(run, u, path), after: advanced(u, path) }))
  ]).filter(Boolean)
  if (!options.length) return null
  if (!L.spend) {
    // With levels ablated no soul ever reaches the level gate, so the tier is bought as soon as it is affordable.
    const due = (u) => L.ablate === 'levels' || u.lvl >= 3 * (u.tier + 1)
    const ready = options.find((o) => o.type === 'upgrade' && due(o.u) && o.path === (o.u.path ?? pathsOf(o.u.id)[0].id))
    const pick = ready ?? options.filter((o) => o.type === 'level').sort((a, b) => a.u.lvl - b.u.lvl || a.uid - b.uid)[0]
    return pick ? { type: pick.type, uid: pick.uid, ...(pick.path && { path: pick.path }) } : null
  }
  const gain = (o) => (o.type === 'upgrade' && !o.u.path ? pathWorth(o.u, o.path) / 3 : worth(o.after) - worth(o.u)) / o.cost
  const best = options.sort((a, b) => gain(b) - gain(a) || a.uid - b.uid)[0]
  if (best.type === 'upgrade' && !best.u.path) {
    const path = nextPaths(best.u).sort((a, b) => pathWorth(best.u, b) - pathWorth(best.u, a))[0]
    return { type: 'upgrade', uid: best.uid, path }
  }
  return { type: best.type, uid: best.uid, ...(best.path && { path: best.path }) }
}

// The paths it could take a tier on next: its own up to tier III (or any, before it commits); a Knight's or
// Marshal's tier IV and second path too.
const nextPaths = (u) => pathsOf(u.id).map((p) => p.id).filter((path) => canAdvance(u, path))
// What a whole path adds to a soul that has not chosen one.
const pathWorth = (u, path) => worth({ ...u, path, tier: 3 }) - worth(u)

// What an expert would put its next essence into besides its souls: a Monarch stat or the muster ('muster'),
// or null for the souls. Worth only shows in a battle, so it rehearses the fights ahead (as weighOffers
// does) with the next point bought each way, and with the next muster level while a captain could lead
// bodies, against the same essence spent on its souls its usual way, and wants what does best if it beats
// the souls. Made once per room, retinue, Monarch and army (not per purchase of levels).
const wishes = new WeakMap()
export function armyWish (run, L = LEVELS.expert) {
  const s = run.state
  const key = JSON.stringify([L.ablate, s.floor, s.at, s.phase, s.camp, s.relics, s.keystones, s.monarch, s.nextUid, s.muster, bodiesKey(s), s.party.map((u) => [u.uid, u.id, u.hp > 0])])
  const have = wishes.get(run)
  if (have?.key === key) return have.wish
  const value = valueAhead(run, L)
  const candidates = statsFor(L).map((stat) => ({ wish: stat, cost: monarchCost(run), state: withPoint(s, stat) }))
  if (s.muster < TUNING.army.muster.cap && armed(s, souls(s.party), L)) candidates.push({ wish: 'muster', cost: musterCost(run), state: { muster: s.muster + 1 } })
  const base = new Map()
  let wish = null
  let gain = 0.01
  for (const c of candidates) {
    if (!base.has(c.cost)) base.set(c.cost, soulsValue(run, value, c.cost, L))
    const g = value(c.state) - base.get(c.cost)
    if (g > gain) { wish = c.wish; gain = g }
  }
  wishes.set(run, { key, wish })
  return wish
}

// How a run would fare in the battle rooms ahead with `state` changed: its rehearsal score, averaged.
function valueAhead (run, L = LEVELS.expert) {
  const rooms = roomsAhead(run)
  const size = as(SIZE_UP, L)
  return (state) => rooms.reduce((n, node) => n + plan(atNode(run, node, state), size).score, 0) / rooms.length
}

// The same rooms with `cost` essence spent on the souls as the expert would, on a copy (bought as on the
// map, whatever the phase: a reap weighs bodies against the levels it would buy next).
function soulsValue (run, value, cost, L = LEVELS.expert) {
  const sim = fork(run)
  sim.state.essence = cost
  sim.state.phase = 'map'
  const E = as(LEVELS.expert, L)
  for (let buy; (buy = soulSpend(sim, E));) apply(sim, buy)
  return value({ party: sim.state.party })
}

// The retinue as it would be with one more Monarch point in `stat`: its HP grows, healing by the gain (unless
// nothing may heal it: Court of Bone).
export function withPoint (s, stat) {
  const lvl = monarchPoints(s) + 1
  const party = s.party.map((u) => {
    if (!isMonarch(u)) return u
    const maxHp = baseStats(u.id, lvl).hp
    return { ...u, lvl, maxHp, hp: holds(s, 'unhealable') ? u.hp : Math.min(maxHp, u.hp + maxHp - u.maxHp) }
  })
  return { party, monarch: { ...s.monarch, [stat]: s.monarch[stat] + 1 } }
}

// The battle rooms whose fights a choice is weighed on: the room being prepared for, those within two
// steps, and the floor's last (or the room just won, at the floor's end).
function roomsAhead (run) {
  const s = run.state
  const near = ahead(s.map, s.at, 2)
  const end = nodeOf(s.map, s.map.end)
  const here = s.phase === 'prep' ? [currentNode(run)] : []
  const rooms = [...here, ...near, ...(near.includes(end) || s.at === end.id ? [] : [end])].filter((n) => n.foes)
  if (!rooms.length) rooms.push(currentNode(run))
  return rooms
}

// ── reap ─────────────────────────────────────────────────────────────────────────────────────────

// The bodies a player binds after a win, or null for none. Basic binds only the free ones, on the kinds
// its fielded captains can lead first (then in offer order). An expert binds its free ones on the kind
// that rehearses best in the fights ahead (ties: one its captains can lead, then the higher tier), and
// pays for more of a kind its cohorts have room for (Command a captain that can lead it, past what stands)
// when rehearsing the bodies beats the same essence spent on its souls. With the army ablated bodies are
// never led, but they still feed ranks: it binds its free ones and pays for more as rank food (chooseFood).
const binds = new WeakMap()
function pickBind (run, L) {
  const s = run.state
  const offers = s.offers.filter((o) => o.type === 'bind')
  if (!offers.length) return null
  const key = JSON.stringify([L, s.at, s.essence, s.freeBinds, offers, s.ossuary, s.monarch, s.muster, s.party.map((u) => [u.uid, u.id, u.lvl, u.hp, u.slot])])
  const have = binds.get(run)
  if (have?.key === key) return have.bind
  const bind = chooseBind(run, L, offers)
  binds.set(run, { key, bind })
  return bind
}

function chooseBind (run, L, offers) {
  const s = run.state
  if (L.ablate === 'army' && L.reap) return chooseFood(run, L, offers)
  const captains = fielded(souls(s.party))
  const leads = (id) => captains.some((c) => canLead(c, id))
  if (s.freeBinds > 0) {
    const n = (o) => Math.min(s.freeBinds, o.max)
    let pick = offers.slice().sort((a, b) => leads(b.id) - leads(a.id))[0]
    if (L.reap) {
      const value = valueAhead(run, L)
      const v = new Map(offers.map((o) => [o, value({ ossuary: withBodies(s, o.id, n(o)) })]))
      pick = offers.slice().sort((a, b) => v.get(b) - v.get(a) || leads(b.id) - leads(a.id) || unitDef(b.id).tier - unitDef(a.id).tier)[0]
    }
    return { type: 'bind', id: pick.id, count: n(pick) }
  }
  if (!L.reap) return null
  const value = valueAhead(run, L)
  let best = null
  let gain = 0.01
  for (const o of offers) {
    const per = bindCost(run, o.id, 1)
    const room = captains.filter((c) => canLead(c, o.id)).reduce((n, c) => n + cohortCap(s, c), 0) - standingOf(s, o.id)
    const count = Math.min(o.max, room, Math.floor(s.essence / per))
    if (count < 1) continue
    const g = value({ ossuary: withBodies(s, o.id, count) }) - soulsValue(run, value, per * count, L)
    if (g > gain) { best = { type: 'bind', id: o.id, count }; gain = g }
  }
  return best
}

// Bodies as rank food only (the army ablated): what they are worth is the ranks they let the expert's own rule
// take (fedRanks). Its free ones go on the kind whose ranks rehearse best (ties: the kin of its strongest
// fielded captain short of Marshal, then the most bodies); it pays for as many of a kind as its next rank still
// needs when rehearsing that rank beats the same essence spent on its souls.
function chooseFood (run, L, offers) {
  const s = run.state
  const value = valueAhead(run, L)
  const fed = (ossuary) => value(fedRanks(run, ossuary))
  const hungry = standing(fielded(souls(s.party))).sort(byFieldPower).filter((c) => (c.grade ?? 0) < 2)
  const rankOf = (id) => { const i = hungry.findIndex((c) => unitDef(c.id).kin === unitDef(id).kin); return i < 0 ? Infinity : i }
  if (s.freeBinds > 0) {
    const n = (o) => Math.min(s.freeBinds, o.max)
    const v = new Map(offers.map((o) => [o, fed(withBodies(s, o.id, n(o)))]))
    const pick = offers.slice().sort((a, b) => v.get(b) - v.get(a) || rankOf(a.id) - rankOf(b.id) || n(b) - n(a))[0]
    return { type: 'bind', id: pick.id, count: n(pick) }
  }
  const base = fed(s.ossuary)
  let best = null
  let gain = 0.01
  for (const o of offers) {
    const c = hungry[rankOf(o.id)]
    if (!c) continue
    const per = bindCost(run, o.id, 1)
    // The bodies still missing for its next rank not yet covered (a Knight's, then a Marshal's on top).
    const have = kinStanding(s, unitDef(c.id).kin)
    let short = 0
    for (let g = c.grade ?? 0, total = 0; g < 2 && !short; g++) { total += promoteNeed({ grade: g }); short = Math.max(0, total - have) }
    const count = Math.min(o.max, Math.floor(s.essence / per), short)
    if (!short || count < short) continue
    const g = fed(withBodies(s, o.id, count)) - base - (soulsValue(run, value, per * count, L) - value({}))
    if (g > gain) { best = { type: 'bind', id: o.id, count }; gain = g }
  }
  return best
}

// The retinue once these bodies have fed the ranks the expert's rule takes (promotion), strongest fielded
// captain first: a Knight once its path stands at tier III (its tier IV bought with it), a Knight to Marshal;
// as { party, ossuary } for valueAhead.
function fedRanks (run, ossuary) {
  const s = run.state
  const order = standing(fielded(souls(s.party))).sort(byFieldPower).map((c) => c.uid)
  let party = s.party
  for (const uid of order) {
    let c = party.find((x) => x.uid === uid)
    const kin = unitDef(c.id).kin
    for (;;) {
      const need = promoteNeed(c)
      if (need === null || kinStanding({ ...s, ossuary }, kin) < need || (!c.grade && c.tier < 3)) break
      ossuary = eaten({ ...s, party, ossuary }, kin, need)
      c = { ...c, grade: (c.grade ?? 0) + 1 }
      if (c.grade === 1 && c.path && canAdvance(c, c.path)) c = advanced(c, c.path)
      const next = c
      party = party.map((x) => (x.uid === uid ? next : x))
    }
  }
  return { party, ossuary }
}

const withBodies = (s, id, n) => ({ ...s.ossuary, [id]: { standing: standingOf(s, id) + n, fallen: s.ossuary[id]?.fallen ?? 0 } })

// Free offers (a relic, a rite's tier, a keystone) first: basic takes the first, an expert rehearses the
// retinue each would make against the battle rooms within two steps and the floor's last room (or the room
// just won, at the floor's end): a keystone, like a relic, as the run holding it. Then the bodies it binds (pickBind). Then the one recruit a battle allows: basic buys the highest tier it can
// afford while the field has room, an expert the soul worth most if it beats the weakest it would
// field (or nearly, with no one on the bench). A full retinue lets its weakest benched soul go to make room.
function pickReap (run, L) {
  const s = run.state
  const free = s.offers.flatMap((o, index) => (o.type === 'soul' || o.type === 'bind' || o.type === BANNED[L.ablate] ? [] : [index]))
  if (free.length) return { type: 'reap', index: L.reap ? weighOffers(run, free, L) : free[0] }
  const bind = pickBind(run, L)
  if (bind) return bind
  const index = recruit(run, L)
  if (index === null || souls(s.party).length < rosterCap(run)) return { type: 'reap', index }
  // Never the last soul standing (the run refuses that release): with every other soul fallen, the recruit
  // is passed over instead.
  const spare = (u) => souls(s.party).some((x) => x !== u && x.hp > 0)
  const weakest = benched(s.party).filter(spare).sort(L.wounds ? byFieldPower : byPower).at(-1)
  return weakest ? { type: 'release', uid: weakest.uid } : { type: 'reap', index: null }
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
  // With no standing soul on the bench, one nearly as good as the weakest fielded is worth keeping for the
  // next banner Command buys (and makes that point worth buying in rehearsal).
  const weakest = room ? 0 : fieldPower(field.at(-1)) * (benched(standing(souls(s.party))).length ? 1.1 : 0.8)
  const best = affordable.sort((a, b) => b.w - a.w || a.index - b.index)[0]
  return best && best.w > weakest ? best.index : null
}

const offered = (s, o) => makeUnit(o.id, { uid: s.nextUid + 1000, lvl: o.lvl })

// The state an offer would make, for rehearsal: a relic or a keystone held, or the soul with that tier by
// the run's own rule (advanced: its first path's next tier, tier IV, or the second path's next); else as is.
export const offerState = (s, o) => (o.type === 'relic'
  ? { relics: [...s.relics, o.id] }
  : o.type === 'keystone'
    ? { keystones: [...s.keystones, o.id] }
    : o.type === 'tier' ? { party: s.party.map((u) => (u.uid === o.uid ? advanced(u, o.path) : u)) } : {})

function weighOffers (run, indices, L) {
  const s = run.state
  const value = valueAhead(run, L)
  let best = indices[0]
  let bestValue = -Infinity
  for (const index of indices) {
    const v = value(offerState(s, s.offers[index]))
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

// Of a battle's army (your souls and bodies that took the board, the reserve's that entered included; not the
// Monarch, not shadows): how many there were, how many acted at least once (an action event of theirs), and
// the share of their time on the board they spent faltering (from the falter events; a unit is on the board
// from the start or its entry to its last death, or the end).
export function armyMeasures (b) {
  const mine = (uid) => {
    const u = b.byUid.get(uid)
    return !!u && u.side === 'party' && !u.shadow && u !== b.monarch
  }
  const since = new Map()
  const until = new Map()
  const acted = new Set()
  const from = new Map()
  let faltered = 0
  for (const e of b.events) {
    if (e.type === 'battle:start') {
      for (const u of e.units) if (mine(u.uid)) since.set(u.uid, 0)
    } else if (e.type === 'enter') {
      if (mine(e.unit.uid)) since.set(e.unit.uid, e.t)
    } else if (e.type === 'action') {
      if (mine(e.actor)) acted.add(e.actor)
    } else if (e.type === 'death') {
      if (mine(e.target)) until.set(e.target, e.t)
    } else if (e.type === 'falter' && mine(e.target)) {
      if (e.on) from.set(e.target, e.t)
      else if (from.has(e.target)) faltered += e.t - from.get(e.target)
      if (!e.on) from.delete(e.target)
    }
  }
  const end = (uid) => (b.byUid.get(uid).hp > 0 ? b.t : until.get(uid) ?? b.t)
  for (const [uid, t] of from) faltered += Math.max(0, end(uid) - t)
  const time = [...since].reduce((n, [uid, t]) => n + Math.max(0, end(uid) - t), 0)
  return { army: since.size, acted: [...since.keys()].filter((uid) => acted.has(uid)).length, falter: time ? faltered / time : 0 }
}

// A run's build, as the ladder's spread reads it: its keystones, the kin most of its fielded souls share
// (ties to the first by name; none without souls), and the paths they took.
const buildOf = (s) => {
  const kins = {}
  for (const u of fielded(souls(s.party))) kins[unitDef(u.id).kin] = (kins[unitDef(u.id).kin] ?? 0) + 1
  const kin = Object.entries(kins).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '-'
  const paths = [...new Set(fielded(souls(s.party)).flatMap((u) => [u.path, u.path2].filter(Boolean)))].sort()
  return { keystones: s.keystones.slice().sort().join('+') || '-', kin, paths: paths.join('+') || '-' }
}

// One seeded run at `level` (with `ablate`, that level with one mechanic taken away: ABLATIONS), as the
// reports need it: each battle as the retinue entered it (its souls: not the Monarch, not the shadows it
// raised, not the rank-and-file), its army (bodies on the board at the start, in reserve, how many of those
// entered, how many bodies fell; how many acted, the share of time spent faltering: armyMeasures), with
// `setups` what it was built from (for refighting) and with `snapshots` the run's state just before the fight
// (for refighting with a mechanic stripped: necessity; its log left out); how the run ended, what felled the
// Monarch, the army it ended with, its build (buildOf), and how many of each action it took (`acts`, by type;
// `tiers`: path tiers held at the end, fielded or not; `relics`/`keystones` held).
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
      const party = b.units.filter((u) => u.side === 'party' && !u.shadow && !u.rank && u !== b.monarch)
      // The reserve ends with the foe waves' bodies (`side: 'foe'`, each with a `when`), and foes on a
      // flank order arrive too: the army columns count your side only.
      const reserve = r.setup.reserve.filter((u) => u.side !== 'foe')
      const ours = (uid) => b.byUid.get(uid)?.side === 'party'
      battles.push({
        floor: b.floor + (b.boss ? 'B' : ''),
        t: b.t,
        ceiling: b.reason === 'tick-ceiling',
        won: b.winner === 'party',
        lvl: party.reduce((n, u) => n + u.lvl, 0) / Math.max(1, party.length),
        size: party.length,
        roster: souls(r.state.party).length,
        foes: b.units.filter((u) => u.side === 'foe').length,
        relics: r.state.relics.length,
        raised: b.raised,
        members: r.setup.party.filter((u) => u.rank).length,
        reserve: reserve.length,
        entered: b.events.filter((e) => e.type === 'enter' && e.unit.side === 'party').length,
        fell: b.units.filter((u) => u.rank && u.side === 'party' && u.hp <= 0).length,
        waves: b.events.filter((e) => e.type === 'wave').length,
        foesIn: b.events.filter((e) => e.type === 'enter' && e.unit.side === 'foe').length,
        detachments: r.setup.detachments.length,
        planned: r.setup.party.filter((u) => u.plan && u.plan.where !== 'hunt').length,
        held: reserve.filter((u) => u.when).length,
        called: b.events.filter((e) => e.type === 'call').length,
        heldIn: b.events.filter((e) => e.type === 'enter' && e.unit.side === 'party' && reserve.some((u) => u.when && u.uid === e.unit.uid)).length,
        arrived: b.events.filter((e) => e.type === 'arrive' && ours(e.uid)).length,
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
    points: monarchPoints(s), monarch: s.monarch, death: s.death, keystones: s.keystones, build: buildOf(s),
    muster: s.muster, bound: s.stats.bound, bodies: Object.values(s.ossuary).reduce((n, o) => n + o.standing, 0),
    acts: s.log.reduce((n, a) => ({ ...n, [a.type]: (n[a.type] ?? 0) + 1 }), {}),
    tiers: souls(s.party).reduce((n, u) => n + u.tier + u.tier2, 0),
    grades: souls(s.party).reduce((n, u) => n + (u.grade ?? 0), 0),
    // How far it got (progressOf), and where it fell (null for a clear).
    progress: progressOf({ result: s.result, floor: s.floor, rank: fell?.rank ?? 1, share: fell?.share ?? 0 }),
    fell,
    // Wall time of the run, in seconds (the only field that is not a pure function of the job).
    secs: (Date.now() - t0) / 1000,
    // Its rehearsals: how many were fought, and how many the memo already had (rehearsed).
    rehearsals: { fought: memoStats.misses - memo0.misses, memo: memoStats.hits - memo0.hits }
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
  // The Monarch: points bought by the run's end (dominion/command/will), shadows raised per battle, and
  // what ended the run, by the killer's first threat or the ceiling (causesOf).
  console.log('\nlevel   monarch pts  dom  com  will  raised/battle  deaths by threat')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const avg = (f) => (mine.reduce((n, r) => n + f(r), 0) / runs).toFixed(1)
    const battles = mine.flatMap((r) => r.battles)
    const causes = {}
    for (const r of mine) for (const k of causesOf(r.death)) causes[k] = (causes[k] ?? 0) + 1
    const tally = Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '-'
    const raised = (battles.reduce((n, b) => n + b.raised, 0) / Math.max(1, battles.length)).toFixed(2)
    console.log(`${level.padEnd(6)}  ${avg((r) => r.points).padStart(11)}  ${avg((r) => r.monarch.dominion).padStart(3)}  ${avg((r) => r.monarch.command).padStart(3)}  ${avg((r) => r.monarch.will).padStart(4)}  ${raised.padStart(13)}  ${tally}`)
  })
  // The army: the muster, bodies bound and standing by the run's end; per battle, the bodies on the board
  // at the start, those in reserve, those of the reserve that entered, and the bodies that fell.
  console.log('\nlevel   muster  bound  standing  members/battle  reserve/battle  entered/battle  fell/battle')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const avg = (f) => (mine.reduce((n, r) => n + f(r), 0) / runs).toFixed(1)
    const battles = mine.flatMap((r) => r.battles)
    const per = (key) => (battles.reduce((n, b) => n + b[key], 0) / Math.max(1, battles.length)).toFixed(2)
    console.log(`${level.padEnd(6)}  ${avg((r) => r.muster).padStart(6)}  ${avg((r) => r.bound).padStart(5)}  ${avg((r) => r.bodies).padStart(8)}  ${per('members').padStart(14)}  ${per('reserve').padStart(14)}  ${per('entered').padStart(14)}  ${per('fell').padStart(11)}`)
  })
  // Orders, per battle: detachments with orders, units on the board starting on Stay or Move, bodies held
  // for a later start, held detachments called and held bodies that entered, and Move units that arrived.
  console.log('\nlevel   detachments/battle  stay|move/battle  held/battle  called/battle  held in/battle  arrived/battle')
  levels.forEach((level, i) => {
    const battles = played.slice(i * runs, (i + 1) * runs).flatMap((r) => r.battles)
    const per = (key) => (battles.reduce((n, b) => n + b[key], 0) / Math.max(1, battles.length)).toFixed(2)
    console.log(`${level.padEnd(6)}  ${per('detachments').padStart(18)}  ${per('planned').padStart(16)}  ${per('held').padStart(11)}  ${per('called').padStart(13)}  ${per('heldIn').padStart(14)}  ${per('arrived').padStart(14)}`)
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
  // (70%+), of battles from floor 3 where a reserve entered (30%+), of defeats where the Monarch died (30–60%),
  // the largest single cause's share of those deaths (no threat above 40%), and the deaths by a foe of a later
  // wave (depth); the share of the army's time spent faltering (a diagnostic); the median battle length by
  // floor; and the build spread in wins (no build in more than ~25%): the commonest keystones, kin and paths.
  console.log('\nlevel   acted   reserve in fl3+  faltering  Monarch deaths/defeats  top threat  depth  ceiling')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const battles = mine.flatMap((r) => r.battles)
    const share = (n, d) => (d ? `${(100 * n / d).toFixed(0)}%` : '-')
    const army = battles.reduce((n, b) => n + b.army, 0)
    const late = battles.filter((b) => parseInt(b.floor) >= 3)
    const time = battles.reduce((n, b) => n + b.falter, 0) / Math.max(1, battles.length)
    const lost = mine.filter((r) => r.death)
    const killed = lost.filter((r) => r.death.reason === 'monarch')
    const causes = {}
    for (const r of killed) for (const k of causesOf(r.death)) causes[k] = (causes[k] ?? 0) + 1
    const top = Object.entries(causes).sort((a, b) => b[1] - a[1])[0]
    const cols = [
      level.padEnd(6),
      share(battles.reduce((n, b) => n + b.acted, 0), army).padStart(5),
      share(late.filter((b) => b.entered > 0).length, late.length).padStart(15),
      `${(100 * time).toFixed(0)}%`.padStart(9),
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
  console.log('\nlevel   wins  build spread in wins: the commonest keystones, kin, paths, and keystones+kin')
  levels.forEach((level, i) => {
    const wins = played.slice(i * runs, (i + 1) * runs).filter((r) => r.result === 'victory')
    const commonest = (f) => {
      const n = {}
      for (const r of wins) n[f(r.build)] = (n[f(r.build)] ?? 0) + 1
      const [k, c] = Object.entries(n).sort((a, b) => b[1] - a[1])[0] ?? ['-', 0]
      return `${k} ${wins.length ? (100 * c / wins.length).toFixed(0) : 0}%`
    }
    console.log(`${level.padEnd(6)}  ${String(wins.length).padStart(4)}  ${[(b) => b.keystones, (b) => b.kin, (b) => b.paths, (b) => `${b.keystones}|${b.kin}`].map(commonest).join('; ')}`)
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
    const shuffle = (party) => {
      const cells = rng.shuffle(open)
      return party.map((u, j) => ({ ...u, slot: cells[j] }))
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
// end, keystones and relics taken), so an ablation can be seen to take its mechanic away. `variants` (the CLI's
// `--variants orders,reserves`) plays only those ablations beside the full expert, for a quicker check. Each drop
// is checked against its band (BANDS): a core mechanic should cost 25–50 points, an extra one 8–25.
export const CORE = ['monarch-stats', 'arise', 'orders', 'reserves', 'army']
export const EXTRA = ['ranks', 'paths', 'keystones', 'relics', 'synergies', 'formation']
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
  console.log('\nuses over the runs: Monarch points, promotions, binds, cohorts given, musters, orders, path tiers held,')
  console.log('levels bought, keystones and relics held at the end')
  console.log('variant        points  promote  bind  cohort  muster  order  tiers  levels  keyst  relics')
  for (const { ablate, mine } of rows) {
    const sum = (f) => String(mine.reduce((n, r) => n + f(r), 0)).padStart(6)
    console.log(`${(ablate ?? 'full').padEnd(13)}  ${[(r) => r.points, (r) => r.acts.promote ?? 0, (r) => r.acts.bind ?? 0, (r) => r.acts.cohort ?? 0, (r) => r.acts.muster ?? 0,
      (r) => r.acts.order ?? 0, (r) => r.tiers, (r) => r.acts.level ?? 0, (r) => r.keystones.length, (r) => r.relics].map(sum).join(' ')}`)
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
  console.log(`\ncheck: full expert ${(100 * full).toFixed(0)}% (target >= 90%), progress ${(100 * mean(prog[0])).toFixed(1)}; drops against their bands (core 25–50, extra 8–25; levels not targeted)`)
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
//   monarch-stats  the Monarch at 0 points: its base HP (its wounds kept as a share), base domain, Will 0 and
//                  Command 0: only the base banners fight (the strongest standing captains), each cohort
//                  cut to its rank's (TUNING.ranks.cohort)
//   arise, synergies  the rules switch (as the full ablation's)
//   orders         every plan Hunts (its start kept)
//   reserves       every held detachment starts at once
//   army           no cohort: no rank-and-file on the board or in reserve
//   ranks          every captain a Soldier: no tier IV, no second path
//   paths          no tier on any path
//   keystones      none (the domain and banners as without them)
//   relics         none (no relic mods, no trigger relics, the banners as without them)
//   formation      the souls in basic's first draft's cells, the Monarch parked where basic parks it
//   levels         every soul at level 2 (its wounds kept as a share)
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
  if (mechanic === 'monarch-stats') {
    s.monarch = { dominion: 0, command: 0, will: 0 }
    relevel(monarchOf(s), 0)
  } else if (RULE_SWITCHES.includes(mechanic)) {
    s.ablate = [...(s.ablate ?? []), mechanic]
  } else if (mechanic === 'orders') {
    for (const d of s.detachments) d.plan = { ...d.plan, where: 'hunt', square: null }
  } else if (mechanic === 'reserves') {
    for (const d of s.detachments) d.plan = { ...d.plan, when: { at: 'once' } }
  } else if (mechanic === 'army') {
    for (const u of team) u.cohort = null
  } else if (mechanic === 'ranks') {
    for (const u of team) Object.assign(u, { grade: 0, tier: Math.min(u.tier, 3), path2: null, tier2: 0 })
  } else if (mechanic === 'paths') {
    for (const u of team) Object.assign(u, { path: null, tier: 0, path2: null, tier2: 0 })
  } else if (mechanic === 'keystones') {
    s.keystones = []
  } else if (mechanic === 'relics') {
    s.relics = []
  } else if (mechanic === 'formation') {
    const at = new Map(basicCells(run, fielded(s.party), LEVELS.expert).map((u) => [u.uid, u.slot]))
    for (const u of s.party) if (at.has(u.uid)) u.slot = at.get(u.uid)
  } else if (mechanic === 'levels') {
    for (const u of team) relevel(u, 2)
  } else if (mechanic !== null) {
    throw new Error(`unknown mechanic "${mechanic}": ${NECESSITY.join(', ')}`)
  }
  // Each cohort cut to what its captain now leads (cohortCap: Command plus its rank's), none at 0.
  for (const u of team) if (u.cohort) u.cohort = cohortCap(s, u) > 0 ? { ...u.cohort, count: Math.min(u.cohort.count, cohortCap(s, u)) } : null
  // Fewer banners (no Command, keystone or relic adding any): the weakest standing captains past them benched.
  const cap = fieldCap(run)
  const over = standing(fielded(team)).sort(byFieldPower).slice(cap)
  for (const u of over) u.slot = -1
  if (over.length) {
    s.detachments = s.detachments.map((d) => ({ ...d, members: d.members.filter((uid) => !over.some((u) => u.uid === uid)) })).filter((d) => d.members.length)
  }
  return run
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
    const play = (job) => (job.refight ? refight(job) : record(job))
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
    if (process.argv.includes('--ablations')) await ablations({ ...opts, variants, runs: Number(arg('runs', RUNS.ablations)), out: arg('out', null) })
    else if (process.argv.includes('--necessity')) await necessity({ ...opts, runs: Number(arg('runs', RUNS.necessity)), setups: arg('setups', null) })
    else if (process.argv.includes('--decisions')) await decisions({ ...opts, runs: Number(arg('runs', RUNS.decisions)) })
    else if (process.argv.includes('--ladder')) await ladder({ ...opts, runs: Number(arg('runs', RUNS.ladder)) })
    else await report({ ...opts, ablate, runs: Number(arg('runs', RUNS.sim)) })
  }
}
