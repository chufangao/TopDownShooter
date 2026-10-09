// A player for tests and balance runs: a policy that picks one action at a time for apply(). It plays at
// one of two levels (LEVELS), on the same choices and the same scouting a player has:
//   basic   rules of thumb: a standing piece the field has no place for stacks onto the strongest fielded piece
//           of its kind, and with room on the field and none standing left in the ossuary a stack splits a body off
//           (pickStack); rooms by weighted dice, the strongest souls fielded, the Monarch parked on
//           the camp's rear row in the middle lane, the best of three drafted formations, the first free
//           offer (a relic, a tier, a keystone), recruits only to fill the field, essence on the lowest kind's level (a
//           track tier once a kind is ready for it), and Command only once two standing souls would wait in the
//           ossuary with the field full; no lines (every soul holds: a line it finds is cleared)
//   expert  plans: every route over the next few ranks played out, wounds counted when fielding, the
//           formation hill-climbed over cells and the ossuary, every seat screened for the Monarch, and the souls'
//           lines in every shape (up the lane, onto the foes' road, toward their shooters, back to the Monarch:
//           SHAPES) on every signal with them; an advance, a charge on the first blow, a hold for the last wave, a
//           guard, a reach, a Banner's wing, a screen beside the Monarch and the Monarch in a pocket among its
//           drafts; stacks and splits weighed once a room by rehearsal (deliberate); free offers (keystones too) weighed by
//           rehearsing the fights ahead, recruits that would make the field (or join a fielded piece of their
//           kind), essence on whatever buys the most worth per essence for a kind's every soul (a tier that adds
//           bodies worth them), and Monarch points when
//           rehearsing the fights ahead says they beat the same essence spent on the souls
// It knows the rules, not the rolls: rehearsals and rollouts never use a battle's own seed. A rehearsal ends once
// its result is settled (battle.js settled), and the formation search fights a formation's remaining rolls only
// while they could still change its choice (plan: TUNING.autoplay.settle, prune).
// Run directly for a balance report:  node src/sim/autoplay.js [--runs 8] [--seed sim] [--level expert]
// for the gap between the levels:     … --ladder [--runs 8]
// or for a report on how much the player's choices decide battles:  … --decisions [--runs 8]
// or the expert with one mechanic taken away (ABLATIONS):  … --ablate lines  (a report as above)
// for how much each mechanic carries the expert, full runs:  … --ablations [--runs 8] [--variants full,lines,bodies] [--out runs.json]
// or as a fast battle-level proxy (its battles refought stripped): … --necessity [--runs 8] [--setups file]
// or what the expert considers against what it chooses, mechanic by mechanic (AUDIT):  … --audit [--runs 4] [--seed audit]
// (the defaults, RUNS, are sized to one expert run per core: an expert run takes minutes; see README)
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRng } from './rng.js'
import {
  statsOf, tracksOf, tiersOf, nextTracks, CENTRE_OUT, CAMP_SLOTS, CAMP_ROWS, campGrid, campOpen, wallTiles, steps, deployTile, tileAt, tileY, TILES,
  LANES, rowOf, colOf, rangeOf, isAllyShape, distance, makeUnit, slotAt, baseStats, seatNear, sealedBy, bodiesOf, isSeat, onBoard, tileX,
  livingBodies, DEPTH, bannerOf
} from './unit.js'
import { createBattle, playOut, timelineHash, field } from './battle.js'
import {
  createRun, apply, availableNodes, fieldCap, rosterCap, fielded, inOssuary, currentNode, battleSetup, levelCost, tierCost,
  isMonarch, monarchOf, souls, MONARCH_STATS, monarchCost, monarchPoints, canAdvance, holds, isMarch, soulCount, heldKinds
} from './run.js'
import { nodeOf, RANKS } from './map.js'
import { TUNING } from '../tuning.js'
import { unitDef, abilityDef, campDef, SIGNALS } from '../content.js'

// seeds: rehearsals per formation (0: take the first draft unrehearsed); drafts: how many of the
// drafts to try (all by default); search: formations tried by hill-climbing from the best draft;
// wounds: field by worth with wounds counted; rollouts: walks per route when choosing a room (0:
// weighted dice), over the next `horizon` rooms; reap: weigh free offers by rehearsing the fights
// ahead, and recruit by worth; spend: buy by worth per essence (and Monarch points by rehearsal) rather
// than by rule of thumb; park: the Monarch always on the rear row, middle lane, never moved by the search;
// lines: draft and search the souls' lines (else every soul holds); shapes: draft them in every shape on every signal
// too (shapedDrafts); seats: screen every seat for the Monarch (each on one roll, the best two rehearsed in full);
// finalists, validate: the best
// `finalists` formations of the search fought again on `validate` fresh rolls, the best of them taken; keepLines (no level has
// it: the fuzz test's) fights on whatever lines it finds instead of clearing them, when it plans none.
export const LEVELS = {
  basic: { seeds: 1, search: 0, wounds: false, rollouts: 0, reap: false, spend: false, park: true, lines: false },
  expert: { seeds: 4, search: 12, finalists: 8, validate: 4, wounds: true, rollouts: 1, horizon: 3, reap: true, spend: true, park: false, lines: true, seats: true, shapes: true }
}
// How an expert imagines a route (quick formations, basic offers), and sizes up an offer.
const ROLLOUT = { seeds: 0, search: 0, wounds: true, rollouts: 0, reap: false, spend: false, park: false, lines: false }
const SIZE_UP = { ...ROLLOUT, seeds: 1, drafts: 1 }
// How it sizes up a room it could walk into next: every draft, lines too, on two rolls (pickRoute).
const RISK = { ...ROLLOUT, seeds: 2, lines: true }

// ── ablation: the expert with one mechanic taken away ─────────────────────────────────────────────

// For measuring how much each mechanic carries the expert (--ablations, --necessity): a level's `ablate`
// takes ONE mechanic from it and changes nothing else; essence it would have spent there goes where its
// spending logic already sends it. Everything it plays ahead with (rehearsals, rollouts, sizing up an offer
// or a point) carries the same ablation:
//   monarch-stats  never buys a Monarch point (HP, Dominion, Command, Will): the field stays at TUNING.party.field
//   arise          the Monarch's Arise never casts (a rules switch: the run's `ablate`, carried in every
//                  battle's setup) and it never buys Will
//   lines          no line: every soul holds its cell
//   bodies         no tier adds a body in battle (a rules switch, as arise), and such a tier is worth only its
//                  place on the track (worth: its bodies not counted), so the essence goes elsewhere
//   tracks         never buys a track tier, and takes nothing of a rite's tiers
//   keystones      never takes a keystone
//   relics         never takes a relic
//   synergies      the party holds no synergy in battle, at any step (a rules switch, as arise)
//   formation      no formation search: its souls in basic's first draft's cells (who it fields and its
//                  lines still its own, each from its new cell) and the Monarch parked where basic parks it
//   levels         never buys a level (reported, not targeted)
// A run of an ablation that is a rules switch must be made with it (ablatedRun); policy refuses one that is not.
export const ABLATIONS = ['monarch-stats', 'arise', 'lines', 'bodies', 'tracks', 'keystones', 'relics', 'synergies', 'formation', 'levels']
export const RULE_SWITCHES = ['arise', 'synergies', 'bodies']
export const ablatedRun = (seed, ablate = null) => createRun({ seed, ablate: RULE_SWITCHES.includes(ablate) ? [ablate] : null })
// A level as it plays ahead for L: the same ablation carried.
const as = (base, L) => (L.ablate ? { ...base, ablate: L.ablate } : base)
// The Monarch stats L may buy.
export const statsFor = (L) => MONARCH_STATS.filter((stat) => L.ablate !== 'monarch-stats' && !(L.ablate === 'arise' && stat === 'will'))
// The free offer type L never takes.
const BANNED = { tracks: 'tier', keystones: 'keystone', relics: 'relic' }

// A formation as L may field it: under 'lines' with no line (every soul holds); under 'formation' the cells
// basic's first draft gives (basicCells). Anything else as it is.
function allowed (run, party, L) {
  if (L.ablate === 'lines') party = party.map((u) => (u.line ? { ...u, line: null } : u))
  return L.ablate === 'formation' ? basicCells(run, party, L) : party
}

// Basic's first draft's cells for these units (L's fielding order, as its drafts take them): the Monarch on
// basic's parking cell, the souls by role row from the middle lane (every other lane against blasts). Each line
// is kept, moved with its soul to its new cell (shifted), unless it no longer fits the camp there.
function basicCells (run, party, L) {
  const s = run.state
  const camp = campGrid(s.camp)
  const cell = rearCell(s.camp)
  const cols = blasts(currentNode(run).foes) ? SPREAD : CENTRE_OUT
  const grid = { rows: camp.rows, open: (slot) => slot !== cell && camp.open(slot) }
  const placed = byRows(party.filter((u) => !isMonarch(u) && u.hp > 0).sort(L.wounds ? byFieldPower : byPower).map((u) => ({ ...u, slot: -1 })), cols, grid)
  const at = new Map(placed.map((u) => [u.uid, u.slot]))
  const walls = new Set(wallTiles(s.camp))
  return party.map((u) => {
    const slot = isMonarch(u) ? cell : at.get(u.uid) ?? -1
    return { ...u, slot, line: u.line && slot >= 0 ? shifted(u.line, u.slot, slot, walls) : null }
  })
}

// A line moved with its soul from cell `from` to cell `to`: every tile shifted alike, or null if that leaves the
// board or the steps the walls allow.
function shifted (line, from, to, walls) {
  const d = deployTile('party', to) - deployTile('party', from)
  const dx = colOf(to) - colOf(from)
  const tiles = line.tiles.map((t) => t + d)
  return line.tiles.every((t) => tileX(t) + dx >= 0 && tileX(t) + dx < LANES) && isMarch(deployTile('party', to), tiles, walls) ? { ...line, tiles } : null
}

const hpPct = (u) => u.hp / u.maxHp
const partyHealth = (party) => party.reduce((n, u) => n + hpPct(u), 0) / party.length
const byPower = (a, b) => power(b) - power(a) || a.uid - b.uid
// An expert counts wounds: a soul at 10% HP is not worth fielding at full price.
const byFieldPower = (a, b) => fieldPower(b) - fieldPower(a) || a.uid - b.uid

// Rough fighting worth from its stats, track tiers included: how long a body lasts times how hard it hits,
// square-rooted, for each living body and each body its tiers add (unless `bodies` is false: the bodies
// ablation's). A tier that grants an ability or an aura counts as a tenth more. 0 for the fallen, and for the
// Monarch, which never strikes: what it is worth only a rehearsal can tell.
function worth (u, bodies = true) {
  if (u.hp <= 0 || isMonarch(u)) return 0
  const s = statsOf(u)
  const lasts = s.hp * (1 + s.def / 100) / s.damage.taken * (1 + s.eva / 60)
  const hits = s.atk * s.damage.dealt * (TUNING.gauge.base + s.spd / TUNING.gauge.spdDivisor) * s.gauge.rate *
    (1 + s.crt / 100 * (TUNING.crit.mult - 1)) * (s.acc / (s.acc + 15)) * (1 + 0.3 * (s.heal.given - 1))
  const signature = tiersOf(u).filter((t) => t.ability || t.aura).length
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
  const w = { fight: 3, elite: health > 0.7 ? 1.5 : 0.3, reliquary: 2, altar: health < 0.6 ? 5 : 0.5, rite: 1.5, boss: 1, siege: health > 0.7 ? 1.5 : 0.3 }
  return { type: 'node', id: rng.weighted(nodes, nodes.map((n) => w[n.type])).id }
}

// The expert walks every route over the next `horizon` rooms `rollouts` times on its own rolls, with
// quick formations and basic offers, and takes the first room of the route that ends best on average. A
// rollout's quick formation can win a fight by luck, so first it sizes up each battle room it could walk into
// next (RISK: every draft, its lines' too, on two rolls): a room where its best formation still loses a
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

// What a retinue brings to its next fight: the fieldable pieces' wounded power (their bodies counted), raised
// by relics.
function strength (s) {
  const best = souls(s.party).map(fieldPower).sort((a, b) => b - a).slice(0, fieldCap({ state: s }))
  return best.reduce((n, p) => n + p, 0) * (1 + 0.08 * s.relics.length) || 1
}

// ── prep: the formation ──────────────────────────────────────────────────────────────────────────────

// The autoplayer arranges its souls with the same choice a player has: any open camp cell, and a line for each.
// It drafts a few formations and rehearses each against the scouted foes on a different battle seed (it knows the
// rules, not the rolls), keeping the one that does best; ties keep the earlier draft:
//   rows       each role's row (ROW), packed from the middle lane (auras want neighbours)
//   spread     each role's row, every other lane first (against area attacks)
//   sheltered  the melee where foes walking in arrive first; ranged souls behind the walls, where foes
//              must walk furthest to reach them for how close they stand
// An expert then hill-climbs from the best draft: swapping two souls, moving one to another cell, trading
// one for a standing soul from the ossuary, or redrawing a soul's line (redraw), keeping each change that
// rehearses better.
// The Monarch takes its seat first: basic parks it on the rear row, middle lane; an expert drafts it there and
// on the seat row ahead, and its search moves it like a soul, over the seats only (it is never traded away).
// An expert also drafts lines and placements: the first formation with every soul marching a short way up its
// lane, and a longer way; that formation with its toughest soul beside the Monarch (a screen); and the Monarch
// in its pocket, the seat with the fewest approach tiles, with all of them, or half, held by its toughest souls.
// A soul's line rides on its formation entry as `line` ({ tiles, when }, or null: it holds).

const SPREAD = [3, 1, 5, 2, 4, 0, 6]
const blasts = (foes) => foes.some((f) => unitDef(f.id).abilities.some((id) => abilityDef(id).shape === 'blast'))
const reachOf = (u) => Math.max(1, ...unitDef(u.id).abilities.map(abilityDef).filter((a) => !isAllyShape(a.shape)).map(rangeOf))
// Each role's row in a drafted formation (0 the camp's front): the line holders ahead, the ranged behind.
const ROW = { vanguard: 0, skirmisher: 1, warden: 1, trickster: 1, ranger: 2, channeler: 2 }
const rowFor = (u) => ROW[unitDef(u.id).role] ?? 1

// Keep units already in an open free slot of `grid`; place the rest in the first open free slot of their role's
// row (rowFor), spilling to the nearest rows, columns in `cols` order. Mutates and returns units.
function byRows (units, cols, grid) {
  const taken = new Set()
  const rest = []
  for (const u of units) {
    if (grid.open(u.slot) && !taken.has(u.slot)) taken.add(u.slot)
    else rest.push(u)
  }
  const rows = [...Array(grid.rows).keys()]
  for (const u of rest) {
    const pref = rowFor(u)
    u.slot = -1
    for (const row of rows.slice().sort((a, b) => Math.abs(a - pref) - Math.abs(b - pref) || a - b)) {
      for (const c of cols) {
        const slot = slotAt(row, c)
        if (u.slot < 0 && grid.open(slot) && !taken.has(slot)) { u.slot = slot; taken.add(slot) }
      }
      if (u.slot >= 0) break
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

function sheltered (units, camp, taken) {
  const walk = walkIn(camp)
  const free = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(camp, slot) && slot !== taken)
  const lane = (slot) => CENTRE_OUT.indexOf(colOf(slot))
  const melee = (u) => reachOf(u) === 1
  const order = units.slice().sort((a, b) => melee(b) - melee(a) || rowFor(a) - rowFor(b))
  for (const u of order) {
    const off = (slot) => Math.abs(rowOf(slot) - rowFor(u))
    const score = melee(u) ? (slot) => walk(slot) : (slot) => -(walk(slot) - rowOf(slot) - 1)
    free.sort((a, b) => score(a) - score(b) || off(a) - off(b) || lane(a) - lane(b))
    u.slot = free.shift()
  }
  return units
}

// The Monarch's parking seat: the rear row's middle lane, or the seat nearest it; the expert's other draft, the
// seat row ahead of it. Each the seat that seals the fewest cells in (seatNear: none, but on the Spiral).
const rearCell = (camp) => seatNear(camp)
const nearCell = (camp) => seatNear(camp, slotAt(CAMP_ROWS - 2, CENTRE_OUT[0]))

function drafts (run, want, L) {
  const s = run.state
  const camp = campGrid(s.camp)
  const blank = () => want.map((u) => ({ ...u, slot: -1, line: null }))
  const lanes = blasts(currentNode(run).foes) ? [SPREAD, CENTRE_OUT] : [CENTRE_OUT, SPREAD]
  const around = (cell) => {
    const m = { ...monarchOf(s), slot: cell, line: null }
    const grid = { rows: camp.rows, open: (slot) => slot !== cell && camp.open(slot) }
    return {
      rows: (cols) => [m, ...byRows(blank(), cols, grid)].map((u) => ({ ...u })),
      sheltered: () => [{ ...m }, ...sheltered(blank(), s.camp, cell)]
    }
  }
  const rear = around(rearCell(s.camp))
  if (L.park) return [rear.rows(lanes[0]), rear.rows(lanes[1]), rear.sheltered()]
  const near = around(nearCell(s.camp))
  const out = [rear.rows(lanes[0]), rear.rows(lanes[1]), rear.sheltered(), near.rows(lanes[0])]
  if (!L.lines) return out
  const copy = (party) => party.map((u) => ({ ...u }))
  const walls = new Set(wallTiles(s.camp))
  const toughest = out[0].filter((u) => !isMonarch(u)).sort((a, b) => toughness(b) - toughness(a) || a.uid - b.uid)[0]
  const open = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(s.camp, slot))
  const nook = around(pocketCell(s.camp)).rows(lanes[0])
  return [
    ...out, advance(copy(out[0]), 2, walls), advance(copy(out[0]), 4, walls), ...(toughest ? [screen(copy(out[0]), toughest.uid, open)] : []),
    pocket(copy(nook), s, Infinity), pocket(copy(nook), s, Math.ceil(want.length / 2)), ...(L.shapes ? shapedDrafts(s, out[0]) : [])
  ]
}

// The first draft with its lines drawn to a plan, one each (SHAPES, whensFor): the melee meeting the foes on their
// road; every piece charging on the first blow; every piece holding for the room's last wave (with none, a time)
// and then advancing; a guard (the toughest falls back on the Monarch once it is struck, the melee step onto the
// road once one of yours falls); the ranged reaching for the foes' shooters; and a Banner's wing (wing).
function shapedDrafts (s, base) {
  const ctx = lineContext(s, base)
  const draw = (pick) => base.map((u) => (isMonarch(u) ? { ...u } : { ...u, line: pick(u) }))
  const melee = (u) => reachOf(u) === 1
  const last = ctx.node?.waves?.length ? { at: 'wave', wave: ctx.node.waves.length } : { at: 'time', t: 200 }
  const toughest = base.filter((u) => !isMonarch(u)).sort((a, b) => toughness(b) - toughness(a) || a.uid - b.uid)[0]
  const wings = wing(base, ctx)
  return [
    draw((u) => (melee(u) ? shapedLine(ctx, u.slot, 'intercept') : null)),
    draw((u) => shapedLine(ctx, u.slot, 'up', { at: 'blow' })),
    draw((u) => shapedLine(ctx, u.slot, 'up', last)),
    draw((u) => (u === toughest ? shapedLine(ctx, u.slot, 'back', { at: 'struck' }) : melee(u) ? shapedLine(ctx, u.slot, 'intercept', { at: 'falls' }) : null)),
    draw((u) => (melee(u) ? null : shapedLine(ctx, u.slot, 'reach'))),
    ...(wings ? [wings] : [])
  ]
}

// A Banner's wing, planned (DESIGN §2.8): the first fielded piece with Banner keeps its cell and takes a line (to meet
// the foes on their road, else up its lane), and the two toughest of the rest stand on the open cells beside it
// (behind it first, then at its sides), where the battle makes them its followers. Null with no Banner fielded.
export function wing (base, ctx) {
  const lead = base.find((u) => !isMonarch(u) && u.slot >= 0 && bannerOf(u))
  if (!lead) return null
  const out = base.map((u) => ({ ...u }))
  const banner = out.find((u) => u.uid === lead.uid)
  const tile = deployTile('party', banner.slot)
  const cells = [...Array(CAMP_SLOTS).keys()]
    .filter((slot) => campOpen(ctx.s.camp, slot) && distance(deployTile('party', slot), tile) === 1 && !out.some((u) => u.slot === slot && (isMonarch(u) || bannerOf(u))))
    .sort((a, b) => rowOf(b) - rowOf(a) || Math.abs(colOf(a) - colOf(banner.slot)) - Math.abs(colOf(b) - colOf(banner.slot)) || a - b)
  const mates = out.filter((u) => !isMonarch(u) && u !== banner && !bannerOf(u)).sort((a, b) => toughness(b) - toughness(a) || a.uid - b.uid)
  for (let k = 0; k < 2 && k < mates.length && k < cells.length; k++) post(out, mates[k].uid, cells[k])
  banner.line = shapedLine(ctx, banner.slot, 'intercept') ?? shapedLine(ctx, banner.slot, 'up')
  return out
}

// The Monarch's pocket: the seat with the fewest approach tiles (the open tiles a step onto it can come from:
// walls and the board's edge close the rest), the rearmost first, then the middle lanes.
function pocketCell (camp) {
  const walls = new Set(wallTiles(camp))
  const lane = (slot) => CENTRE_OUT.indexOf(colOf(slot))
  const ways = (slot) => steps(deployTile('party', slot), walls).length
  const sealed = (slot) => sealedBy(camp, slot).length
  return [...Array(CAMP_SLOTS).keys()].filter((slot) => isSeat(camp, slot))
    .sort((a, b) => sealed(a) - sealed(b) || ways(a) - ways(b) || rowOf(b) - rowOf(a) || lane(a) - lane(b))[0]
}

// A screen against flankers: the Monarch's approach tiles in the camp held by its toughest souls, up to `n` of
// them (ahead first).
function pocket (out, s, n) {
  const m = deployTile('party', out.find(isMonarch).slot)
  const cells = steps(m, new Set(wallTiles(s.camp))).filter((t) => tileY(t) < CAMP_ROWS)
    .map((t) => slotAt(CAMP_ROWS - 1 - tileY(t), tileX(t))).sort((a, b) => rowOf(a) - rowOf(b) || a - b)
  const caps = out.filter((u) => !isMonarch(u)).sort((a, b) => toughness(b) - toughness(a) || a.uid - b.uid)
  cells.slice(0, n).forEach((slot, i) => caps[i] && post(out, caps[i].uid, slot))
  return out
}

// What a soul is worth on a tile it must hold: how much it takes to fell.
const toughness = (u) => {
  const st = statsOf(u)
  return st.hp * (1 + st.def / 100)
}

// ── lines ────────────────────────────────────────────────────────────────────────────────────────

// A march `n` tiles straight up the lane from `slot` (fewer where a wall or the board's edge stops it), at once
// or on `when`; null if it cannot take a step.
function march (slot, n, walls, when = { at: 'once' }) {
  const tiles = []
  for (let t = deployTile('party', slot); tiles.length < n && onBoard(tileX(t), tileY(t) + 1) && steps(t, walls).includes(t + LANES); t += LANES) tiles.push(t + LANES)
  return tiles.length ? { tiles, when } : null
}

// Every soul of a formation on a march `n` tiles up its lane.
const advance = (out, n, walls) => out.map((u) => (isMonarch(u) ? u : { ...u, line: march(u.slot, n, walls) }))

// The lines a formation's souls walk, by uid.
export const linesOf = (party) => Object.fromEntries(party.filter((u) => u.line).map((u) => [u.uid, u.line]))

// Moves a soul to `slot` (whoever stands there takes its old cell); both lose their lines, as in the run.
function post (out, uid, slot) {
  const c = out.find((u) => u.uid === uid)
  const other = out.find((u) => u.slot === slot && u !== c)
  if (other) Object.assign(other, { slot: c.slot, line: null })
  Object.assign(c, { slot, line: null })
  return out
}

// A screen: the soul on an open cell beside the Monarch, the cells ahead of it first, then the nearest lanes
// (never the Monarch's own cell).
function screen (out, uid, open) {
  const m = out.find(isMonarch)
  const cells = open.filter((slot) => slot !== m.slot && distance(deployTile('party', slot), deployTile('party', m.slot)) === 1)
    .sort((a, b) => rowOf(a) - rowOf(b) || Math.abs(colOf(a) - colOf(m.slot)) - Math.abs(colOf(b) - colOf(m.slot)) || a - b)
  const free = cells.filter((slot) => !out.some((u) => u.slot === slot))
  const slot = free[0] ?? cells.find((slot) => out.some((u) => u.slot === slot && !isMonarch(u)))
  return slot === undefined ? out : post(out, uid, slot)
}

// ── the shapes of lines ─────────────────────────────────────────────────────────────────────────

// The lines the expert draws, beside a march up the lane, each waiting on any signal the room can give (whensFor):
//   intercept  to the busiest road tile in the camp nearest it: where the foes walk to the Monarch, to meet them
//   reach      to the camp's front row in the lane of the foes' farthest-reaching piece, to bring it in range: a
//              line that turns when that lane is not its own
//   back       to the free tile nearest the Monarch: to fall back on it (on Struck or Fallen, a guard)
// Each is the shortest march there past the walls (pathTo), so always a legal line; none where it stands already.
export const SHAPES = ['up', 'intercept', 'reach', 'back']

// The foes' roads to a Monarch on cell `seat` (battle.js field, the camp's walls only): each tile's traffic, a foe
// from each lane of the board's top edge walking the arrows. Made once per camp and seat.
const roadCache = new Map()
export function roadsTo (camp, seat) {
  const key = `${camp}|${seat}`
  if (!roadCache.has(key)) {
    const f = field({ root: deployTile('party', seat), walls: wallTiles(camp) })
    const traffic = new Map()
    for (let x = 0; x < LANES; x++) {
      for (let t = tileAt(x, DEPTH - 1), n = 0; t >= 0 && n < TILES; t = f.arrow[t], n++) traffic.set(t, (traffic.get(t) ?? 0) + 1)
    }
    roadCache.set(key, { field: f, traffic })
  }
  return roadCache.get(key)
}

// The shortest march from tile `from` to tile `to` past `walls` (a Set), as a line's tiles (`from` left out), its
// steps in unit.js's order; null when there is none, when it is no step at all, or when it is longer than `max`.
function pathTo (from, to, walls, max = 8) {
  if (from === to) return null
  const prev = new Map([[from, -1]])
  const queue = [from]
  for (let i = 0; i < queue.length && !prev.has(to); i++) {
    for (const n of steps(queue[i], walls)) if (!prev.has(n)) { prev.set(n, queue[i]); queue.push(n) }
  }
  if (!prev.has(to)) return null
  const tiles = []
  for (let t = to; t !== from; t = prev.get(t)) tiles.unshift(t)
  return tiles.length <= max ? tiles : null
}

// Every signal a line may wait on in a room (content.js SIGNALS): at once, two times, the first blow, each later
// wave of the room, a blow on the Monarch, and one of yours fallen.
export const whensFor = (node) => [
  { at: 'once' }, { at: 'time', t: 100 }, { at: 'time', t: 200 }, { at: 'blow' },
  ...Array.from({ length: node?.waves?.length ?? 0 }, (_, k) => ({ at: 'wave', wave: k + 1 })), { at: 'struck' }, { at: 'falls' }
]

// What drawing a formation's lines reads: the room (its foes, its waves), the camp's walls, and the roads to its
// Monarch's seat.
export function lineContext (s, party) {
  const node = nodeOf(s.map, s.at)
  const m = party.find(isMonarch)
  const seat = m && m.slot >= 0 ? m.slot : seatNear(s.camp)
  return { s, node, seat, walls: new Set(wallTiles(s.camp)), roads: roadsTo(s.camp, seat), whens: whensFor(node), taken: new Set(party.map((u) => u.slot)) }
}

// A line of `shape` (SHAPES) for the soul on cell `slot`, waiting on `when`; `n` the length of a march up its lane.
// Null where the shape has no way there (or it stands there already).
export function shapedLine (ctx, slot, shape, when = { at: 'once' }, n = 3) {
  if (shape === 'up') return march(slot, n, ctx.walls, when)
  const from = deployTile('party', slot)
  const monarch = deployTile('party', ctx.seat)
  let to = -1
  if (shape === 'intercept') {
    const busy = [...ctx.roads.traffic].filter(([t, k]) => k >= 2 && t !== monarch && tileY(t) < CAMP_ROWS)
    to = busy.sort((a, b) => distance(a[0], from) - distance(b[0], from) || b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? -1
  } else if (shape === 'reach') {
    const shooters = (ctx.node?.foes ?? []).filter((f) => unitDef(f.id).ring >= 3)
    if (!shooters.length) return null
    const lane = colOf(shooters.slice().sort((a, b) => unitDef(b.id).ring - unitDef(a.id).ring || CENTRE_OUT.indexOf(colOf(a.slot)) - CENTRE_OUT.indexOf(colOf(b.slot)))[0].slot)
    const row = [...Array(LANES).keys()].map((x) => tileAt(x, CAMP_ROWS - 1)).filter((t) => !ctx.walls.has(t))
    to = row.sort((a, b) => Math.abs(tileX(a) - lane) - Math.abs(tileX(b) - lane) || a - b)[0] ?? -1
  } else if (shape === 'back') {
    const beside = [...Array(TILES).keys()].filter((t) => distance(t, monarch) === 1 && tileY(t) < CAMP_ROWS && !ctx.walls.has(t))
    to = beside.sort((a, b) => distance(a, from) - distance(b, from) || a - b)[0] ?? -1
  }
  const tiles = to < 0 ? null : pathTo(from, to, ctx.walls)
  return tiles ? { tiles, when } : null
}

// Whether a line turns: steps off its lane.
export const turns = (line, slot) => !!line && line.tiles.some((t) => tileX(t) !== colOf(slot))

// One change to the lines: a soul's line cleared (it holds), or redrawn in any shape (SHAPES; a march up its lane 1
// to 6 tiles) on any signal the room can give (whensFor).
export function redraw (out, s, rng) {
  const caps = out.filter((u) => !isMonarch(u))
  if (!caps.length) return out
  const c = rng.pick(caps)
  if (c.line && rng.chance(0.25)) {
    c.line = null
    return out
  }
  const ctx = lineContext(s, out)
  const when = rng.pick(ctx.whens)
  c.line = shapedLine(ctx, c.slot, rng.pick(SHAPES), when, rng.pick([1, 2, 3, 4, 6])) ?? march(c.slot, rng.pick([1, 2, 3]), ctx.walls, when)
  return out
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

// A rehearsal's worth, averaged over its budget's rolls: a win by how much HP it keeps (wounds carry
// over; the Monarch's counts as much as all the souls', and shadows leave anyway), from 1 to 2; a loss by how
// much of the foes' HP it took, from −LOSS − 1 to −LOSS. A fallen Monarch is a loss, whoever else stands, and
// so is the ceiling. A loss ends the run, so it weighs LOSS more than the worst win: a formation that loses
// one roll in six to save a few wounds in the other five is not the better one.
// The formation is rehearsed in the run's party order with the lines it carries (each entry's `line`), as
// the real fight will set it up.
export function rehearse (run, party, want = 1, { from = 0, full = false, beats = null } = {}) {
  const order = new Map(run.state.party.map((u, i) => [u.uid, i]))
  const rank = (u) => order.get(u.uid) ?? Infinity
  party = party.slice().sort((a, b) => rank(a) - rank(b))
  // `from`, `full`: a validation (plan) rehearses on seeds of its own, from `from` on, all `want` of them
  // however big the battle. `beats` (a search's: plan): told the best mean the rolls still to come could reach
  // (every one of them scoring BEST), whether that could still change the search's choice; once it could not,
  // the rest are not fought and the formation's score is null. Exact: the score it would have had is no higher.
  const setup = battleSetup(run, { party, lines: linesOf(party) })
  const budget = rehearsalBudget(setup, want)
  const { ceiling } = budget
  const seeds = full ? want : budget.seeds
  let total = 0
  for (let k = from; k < from + seeds; k++) {
    total += rehearsed({ ...setup, seed: rehearsalSeed(setup, k), ceiling })
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
const wanted = (run, L) => {
  const w = (u) => worth(u, L.ablate !== 'bodies') * (L.wounds ? Math.sqrt(hpPct(u)) : 1)
  return standing(souls(run.state.party)).sort((a, b) => w(b) - w(a) || a.uid - b.uid).slice(0, fieldCap(run))
}

// → { party, score }: the best formation found for the current room. Formations that put everyone in
// the same cells with the same lines are only rehearsed once. `enough` (the room veto's: pickRoute):
// the caller asks only whether the best score reaches it; with pruning on, the plan stops at the first formation
// that does, and a formation that cannot reach it is not fought on its remaining rolls. The answer is the same.
function plan (run, L, { enough = Infinity, onCandidate = null } = {}) {
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
  // A formation whose Monarch seals a soul in (sealedBy) is never taken: no line out of there passes it, and no
  // road in leads anywhere but to the Monarch.
  const score = (party) => {
    const sealed = sealedBy(run.state.camp, party.find(isMonarch).slot)
    if (party.some((u) => !isMonarch(u) && sealed.includes(u.slot))) return -Infinity
    const key = party.map((u) => `${u.uid}@${u.slot}${u.line ? JSON.stringify(u.line) : ''}`).sort().join()
    if (!tried.has(key)) {
      const bar = cut()
      const beats = enough < Infinity ? (most) => most >= enough : (most) => most > bar
      tried.set(key, rehearse(run, party, L.seeds, { beats: TUNING.autoplay.prune && beats }) ?? -Infinity)
      forms.set(key, party)
      if (!screenedKeys.has(key)) onCandidate?.(party)
    }
    return tried.get(key)
  }
  const screenedKeys = new Set()
  let best = null
  let bestScore = -Infinity
  for (const party of options) {
    const v = score(party)
    if (!best || v > bestScore) { best = party; bestScore = v }
    if (bestScore >= enough && TUNING.autoplay.prune) return { party: best, score: bestScore }
  }
  // Every seat (L.seats): the best draft with the Monarch moved there (whoever stood there takes its old seat), each
  // fought on one roll of its own; the two best go on to the full rehearsal. The seat centres the domain and is
  // where the shadows rise beside (DESIGN §2.7). Never with the Monarch parked, nor under the formation ablation.
  if (L.seats && !L.park && L.ablate !== 'formation') {
    const m = best.find(isMonarch)
    const screened = [...Array(CAMP_SLOTS).keys()].filter((slot) => isSeat(run.state.camp, slot) && slot !== m.slot).map((slot) => {
      const party = allowed(run, post(best.map((u) => ({ ...u })), m.uid, slot), L)
      screenedKeys.add(party.map((u) => `${u.uid}@${u.slot}${u.line ? JSON.stringify(u.line) : ''}`).sort().join())
      onCandidate?.(party)
      return { party, v: rehearse(run, party, 1, { from: 300, full: true }) }
    })
    for (const { party } of screened.sort((a, b) => b.v - a.v).slice(0, 2)) {
      const v = score(party)
      if (v > bestScore) { best = party; bestScore = v }
    }
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

// One change to a formation: trade a soul for one from the ossuary (it takes over the cell and the line), swap
// two, move one to a free cell (a near one more often than not; a soul moved loses its line, as in the run); with
// `lines`, a third of the time redraw a line first (any shape, any signal: redraw), and now and then form a
// Banner's wing (wing). The Monarch is never traded, moves only over the seats, and with `park` never moves. With
// 'formation' ablated nothing is moved (the cells are basic's: see allowed): a change is a trade or a line.
function mutate (party, pool, open, rng, s, L) {
  const out = party.map((u) => ({ ...u }))
  const fixed = L.ablate === 'formation'
  if (L.lines && rng.chance(0.35)) return redraw(out, s, rng)
  if (L.lines && !fixed && rng.chance(0.1)) return wing(out, lineContext(s, out)) ?? out
  const movable = L.park || fixed ? out.filter((u) => !isMonarch(u)) : out
  const a = movable[rng.int(movable.length)]
  const spare = pool.filter((u) => !out.some((x) => x.uid === u.uid))
  const roll = rng()
  if (fixed && !(spare.length && a)) return L.lines ? redraw(out, s, rng) : out
  if (spare.length && (roll < 0.2 || fixed) && !isMonarch(a)) {
    const b = rng.pick(spare)
    return out.map((u) => (u === a ? { ...b, slot: a.slot, line: a.line ?? null } : u))
  }
  const seat = (u, slot) => !isMonarch(u) || isSeat(s.camp, slot)
  if (movable.length > 1 && roll < 0.55) {
    const b = rng.pick(movable.filter((u) => u !== a))
    if (seat(a, b.slot) && seat(b, a.slot)) {
      [a.slot, b.slot] = [b.slot, a.slot]
      a.line = b.line = null
    }
    return out
  }
  const free = open.filter((slot) => !out.some((u) => u.slot === slot) && seat(a, slot))
  if (!free.length) return out
  const near = free.filter((slot) => distance(deployTile('party', slot), deployTile('party', a.slot)) <= 2)
  a.slot = rng.pick(near.length && rng.chance(0.7) ? near : free)
  a.line = null
  return out
}

// The plan only depends on the room, the camp, the relics, who is standing (not where), their counts, levels and
// tiers, and the uids the foes will take, so it is made once per prep however many steps carry it
// out.
const plans = new WeakMap()
export function planFor (run, L) {
  const s = run.state
  const key = JSON.stringify([L, s.floor, s.at, s.camp, s.relics, s.keystones, s.monarch, s.nextUid, s.party.map((u) => [u.uid, u.id, u.lvl, u.count, u.hp, u.tracks])])
  const have = plans.get(run)
  if (have?.key === key) return have.plan
  const onCandidate = audited(run) ? (party) => { AUDIT.candidates++; for (const f of new Set(featuresOf(s, party))) note('considered', f) } : null
  const made = plan(run, L, { onCandidate }).party.map((u) => ({ uid: u.uid, slot: u.slot, line: u.line ?? null }))
  plans.set(run, { key, plan: made })
  return made
}

// One step toward the plan: the souls it leaves out to the ossuary, then the Monarch to its seat (no one else
// is planned there, so it is never displaced again), then each soul in its planned cell (whoever stood
// there takes the mover's old one; a soul in place is never moved again); then each fielded soul's line as the
// plan draws it (basic draws none, and clears any it finds); then fight.
function pickPrep (run, L) {
  const s = run.state
  const spend = pickSpend(run, L)
  if (spend) return spend
  const restack = pickStack(run, L)
  if (restack) return restack
  const goal = planFor(run, L)
  const out = fielded(souls(s.party)).find((u) => !goal.some((p) => p.uid === u.uid))
  if (out) return { type: 'place', uid: out.uid, slot: -1 }
  const m = goal.find((p) => isMonarch(p))
  if (m && monarchOf(s).slot !== m.slot) return { type: 'place', uid: m.uid, slot: m.slot }
  const off = goal.find((p) => s.party.find((u) => u.uid === p.uid).slot !== p.slot)
  if (off) return { type: 'place', uid: off.uid, slot: off.slot }
  if (!L.lines && L.keepLines) return { type: 'fight' }
  const want = (uid) => (L.lines ? goal.find((p) => p.uid === uid)?.line ?? null : null)
  const redrawn = fielded(souls(s.party)).find((u) => JSON.stringify(s.lines[u.uid] ?? null) !== JSON.stringify(want(u.uid)))
  if (redrawn) return want(redrawn.uid) ? { type: 'line', uid: redrawn.uid, ...want(redrawn.uid) } : { type: 'line', uid: redrawn.uid, tiles: null }
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

// The expert's stacks, once a room: each option (stackOptions) rehearsed over the rooms ahead (valueAhead) with the
// party as it would leave it, the best taken if it beats keeping what it has (ties keep). → the action, or null.
const decided = new WeakMap()
function deliberate (run, L) {
  const s = run.state
  const key = `${s.floor}|${s.at}`
  if (decided.get(run) === key) return null
  decided.set(run, key)
  const options = stackOptions(run)
  if (options.length < 2) return null
  const value = valueAhead(run, L)
  let best = value({})
  let pick = null
  for (const a of options.slice(1)) {
    if (audited(run)) note('considered', a.type)
    const sim = fork(run)
    apply(sim, a)
    const v = value({ party: sim.state.party, nextUid: sim.state.nextUid })
    if (v > best + 0.01) { best = v; pick = a }
  }
  return pick
}

// ── audit: what the expert considers, and what it chooses ───────────────────────────────────────────

// Off but for the audit (--audit): per mechanic, how many of the formations the plans rehearsed use it
// (`considered`; and each stack, split or Monarch point weighed), and how many of the formations fought do
// (`chosen`), with the lines fought by signal, their length and the Monarch's seats (`lines`, `seats`). Only the
// audited run's own plans and choices count (`run`: none of the copies it plays ahead on), and with no run named,
// every plan the audit sees.
export const AUDIT = { on: false, run: undefined, candidates: 0, plans: 0, considered: {}, chosen: {}, done: {}, lines: {}, length: 0, seats: {} }
const note = (book, key, n = 1) => { if (AUDIT.on) AUDIT[book][key] = (AUDIT[book][key] ?? 0) + n }
const audited = (run) => AUDIT.on && (AUDIT.run === undefined || AUDIT.run === run)
export function resetAudit (on = true, run = undefined) {
  Object.assign(AUDIT, { on, run, candidates: 0, plans: 0, considered: {}, chosen: {}, done: {}, lines: {}, length: 0, seats: {} })
}

// What a formation uses: a line (by signal; turning off its lane), a Banner's wing (a Banner with a line and a piece
// beside it), the Monarch off the rear row's middle lane, a stack fielded, a ring-2 kind fielded.
export function featuresOf (s, party) {
  const out = []
  const pieces = party.filter((u) => !isMonarch(u) && u.slot >= 0).map((p) => ({ ...s.party.find((x) => x.uid === p.uid), ...p }))
  for (const u of pieces) {
    if (u.line) out.push('line', `line:${u.line.when?.at ?? 'once'}`, ...(turns(u.line, u.slot) ? ['turning line'] : []))
    if (u.count > 1) out.push('stack fielded')
    if (unitDef(u.id).ring === 2) out.push('ring-2 fielded')
  }
  const at = (u) => deployTile('party', u.slot)
  if (pieces.some((b) => bannerOf(b) && b.line && pieces.some((x) => x !== b && distance(at(x), at(b)) === 1))) out.push('Banner wing')
  const m = party.find(isMonarch)
  if (m && m.slot !== seatNear(s.camp)) out.push('seat off the rear middle')
  return out
}

// A formation fought: its features once each, its lines one by one.
function chose (s, goal) {
  AUDIT.plans++
  for (const f of new Set(featuresOf(s, goal))) note('chosen', f)
  for (const p of goal) {
    if (!p.line) continue
    note('lines', p.line.when?.at ?? 'once')
    AUDIT.length += p.line.tiles.length
  }
  const m = goal.find((p) => isMonarch(p))
  if (m) note('seats', m.slot)
}

// ── essence ──────────────────────────────────────────────────────────────────────────────────────

// Essence goes to the kinds that will fight: those of the strongest standing souls. Basic levels the lowest of
// them, but buys a track tier (on the track it is on, the first before any) once a kind's level is three per tier
// that track would hold; it buys Command first once two standing souls would wait in the ossuary with the field
// full (counted from the cap, not the camp: it spends before it places, so the souls a wider field will take
// still sit in the ossuary), and no other Monarch point. An expert buys whatever adds the most worth per essence
// over every soul of the kind, starting a kind on the track whose three tiers add the most, unless rehearsal says
// a Monarch point is worth more (armyWish): then it saves for that and buys it.
function pickSpend (run, L) {
  const s = run.state
  if (!L.spend) {
    if (statsFor(L).includes('command') && standing(souls(s.party)).length - fieldCap(run) >= 2 && s.essence >= monarchCost(run)) return { type: 'monarch', stat: 'command' }
  } else {
    const wish = armyWish(run, L)
    if (wish) return s.essence >= monarchCost(run) ? { type: 'monarch', stat: wish } : null
  }
  return kindSpend(run, L) ?? (L.spend ? idleSpend(run, L) : null)
}

// What the expert's essence buys when its usual buys find nothing (its fielded kinds at their cap, or past its
// purse): every level and tier of any kind it holds and every Monarch point it may buy, each rehearsed over the
// fights ahead (valueAhead) with the retinue as it would leave it; the one that gains the most, if any gains. So
// essence never sits idle while a purchase is worth something. Weighed once a room for the purse it has.
const idles = new WeakMap()
// Every purchase the purse affords L: a level or a tier of any kind held (but under the levels or tracks ablation),
// and a Monarch point in any stat L may buy.
export function spendOptions (run, L) {
  const s = run.state
  return [
    ...heldKinds(s).flatMap((kind) => [
      ...(L.ablate !== 'levels' && s.kinds[kind].lvl < TUNING.level.cap && s.essence >= levelCost(run, kind) ? [{ type: 'level', kind }] : []),
      ...[0, 1].filter((track) => L.ablate !== 'tracks' && canAdvance(s, kind, track) && s.essence >= tierCost(run, kind, track)).map((track) => ({ type: 'upgrade', kind, track }))
    ]),
    ...(s.essence >= monarchCost(run) ? statsFor(L).map((stat) => ({ type: 'monarch', stat })) : [])
  ]
}
function idleSpend (run, L) {
  const s = run.state
  const key = JSON.stringify([s.floor, s.at, s.phase, s.essence, s.monarch, s.kinds, s.party.map((u) => [u.uid, u.count, u.hp])])
  if (idles.get(run)?.key === key) return idles.get(run).pick
  const options = spendOptions(run, L)
  if (audited(run)) for (const a of options) note('considered', `idle ${a.type}`)
  let pick = null
  if (options.length) {
    const value = valueAhead(run, L)
    let best = value({})
    for (const a of options) {
      const sim = fork(run)
      apply(sim, a)
      const v = value({ party: sim.state.party, monarch: sim.state.monarch, kinds: sim.state.kinds })
      if (v > best) { best = v; pick = a }
    }
  }
  idles.set(run, { key, pick })
  if (pick && audited(run)) note('done', `idle ${pick.type}`)
  return pick
}

function kindSpend (run, L) {
  const s = run.state
  const kinds = [...new Set(standing(souls(s.party)).sort(byFieldPower).slice(0, fieldCap(run)).map((u) => u.id))]
  const options = kinds.flatMap((kind) => {
    const k = s.kinds[kind]
    return [
      L.ablate !== 'levels' && k.lvl < TUNING.level.cap && s.essence >= levelCost(run, kind) && { type: 'level', kind, cost: levelCost(run, kind), after: { lvl: k.lvl + 1, tracks: k.tracks } },
      ...[0, 1].filter((track) => L.ablate !== 'tracks' && canAdvance(s, kind, track) && s.essence >= tierCost(run, kind, track))
        .map((track) => ({ type: 'upgrade', kind, track, cost: tierCost(run, kind, track), after: { lvl: k.lvl, tracks: nextTracks(k.tracks, track) } }))
    ]
  }).filter(Boolean)
  if (!options.length) return null
  const act = (o) => (o.type === 'level' ? { type: 'level', kind: o.kind } : { type: 'upgrade', kind: o.kind, track: o.track })
  if (!L.spend) {
    // The track a kind is on: the one with more tiers, the first while neither has one. With levels ablated no kind
    // ever reaches the level gate, so the tier is bought as soon as it is affordable.
    const on = (kind) => (s.kinds[kind].tracks[1] > s.kinds[kind].tracks[0] ? 1 : 0)
    const due = (kind) => L.ablate === 'levels' || s.kinds[kind].lvl >= 3 * (Math.max(...s.kinds[kind].tracks) + 1)
    const ready = options.find((o) => o.type === 'upgrade' && o.track === on(o.kind) && due(o.kind))
    const pick = ready ?? options.filter((o) => o.type === 'level').sort((a, b) => s.kinds[a.kind].lvl - s.kinds[b.kind].lvl || kinds.indexOf(a.kind) - kinds.indexOf(b.kind))[0]
    return pick ? act(pick) : null
  }
  // Under the bodies ablation a tier that adds bodies is worth only its place on the track: they never come.
  const raised = L.ablate !== 'bodies'
  const fresh = (o) => o.type === 'upgrade' && s.kinds[o.kind].tracks.every((t) => t === 0)
  const gain = (o) => (fresh(o) ? trackWorth(s, o.kind, o.track, raised) / 3 : kindWorth(s, o.kind, o.after, raised) - kindWorth(s, o.kind, s.kinds[o.kind], raised)) / o.cost
  const best = options.sort((a, b) => gain(b) - gain(a) || kinds.indexOf(a.kind) - kinds.indexOf(b.kind))[0]
  if (fresh(best)) {
    const track = [0, 1].filter((t) => canAdvance(s, best.kind, t)).sort((a, b) => trackWorth(s, best.kind, b, raised) - trackWorth(s, best.kind, a, raised))[0]
    return { type: 'upgrade', kind: best.kind, track }
  }
  return act(best)
}

// What every piece of a kind is worth at `k` ({ lvl, tracks }), the bodies its tiers add counted unless `bodies`
// is false.
const kindWorth = (s, kind, k, bodies = true) => souls(s.party).filter((u) => u.id === kind).reduce((n, u) => n + worth({ ...u, ...k }, bodies), 0)
// What three tiers of `track` add to a kind that holds none.
const trackWorth = (s, kind, track, bodies = true) =>
  kindWorth(s, kind, { lvl: s.kinds[kind].lvl, tracks: nextTracks(nextTracks(nextTracks(s.kinds[kind].tracks, track), track), track) }, bodies) - kindWorth(s, kind, s.kinds[kind], bodies)

// What an expert would put its next essence into besides its souls: a Monarch stat, or null for the souls.
// Worth only shows in a battle, so it rehearses the fights ahead (as weighOffers does) with the next point
// bought each way, against the same essence spent on its souls its usual way, and wants what does best if it
// beats the souls. Made once per room, retinue and Monarch (not per purchase of levels).
const wishes = new WeakMap()
export function armyWish (run, L = LEVELS.expert) {
  const s = run.state
  const key = JSON.stringify([L.ablate, s.floor, s.at, s.phase, s.camp, s.relics, s.keystones, s.monarch, s.nextUid, s.party.map((u) => [u.uid, u.id, u.hp > 0, u.lvl, u.tracks])])
  const have = wishes.get(run)
  if (have?.key === key) return have.wish
  const value = valueAhead(run, L)
  const candidates = statsFor(L).map((stat) => ({ wish: stat, cost: monarchCost(run), state: withPoint(s, stat) }))
  if (audited(run)) for (const c of candidates) note('considered', `Monarch ${c.wish}`)
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
// map, whatever the phase).
function soulsValue (run, value, cost, L = LEVELS.expert) {
  const sim = fork(run)
  sim.state.essence = cost
  sim.state.phase = 'map'
  const E = as(LEVELS.expert, L)
  for (let buy; (buy = kindSpend(sim, E));) apply(sim, buy)
  return value({ party: sim.state.party })
}

// The retinue as it would be with one more Monarch point in `stat`: for HP, its HP grows, healing by the gain
// (unless nothing may heal it: Court of Bone).
export function withPoint (s, stat) {
  const monarch = { ...s.monarch, [stat]: s.monarch[stat] + 1 }
  if (stat !== 'hp') return { monarch }
  const lvl = monarch.hp
  const party = s.party.map((u) => {
    if (!isMonarch(u)) return u
    const maxHp = baseStats(u.id, lvl).hp
    return { ...u, lvl, maxHp, hp: holds(s, 'unhealable') ? u.hp : Math.min(maxHp, u.hp + maxHp - u.maxHp) }
  })
  return { party, monarch }
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

// Free offers (a relic, a rite's tier, a keystone) first: basic takes the first, an expert rehearses the
// retinue each would make against the battle rooms within two steps and the floor's last room (or the room
// just won, at the floor's end): a keystone, like a relic, as the run holding it. Then the one recruit a
// battle allows: basic buys the highest tier it can afford while the field has room, an expert the soul worth
// most if it beats the weakest it would field (or nearly, with no one standing in the ossuary), else one that can
// join a fielded piece of its kind; with the field full it joins that piece (`onto`). A full retinue lets its
// weakest soul in the ossuary go to make room.
function pickReap (run, L) {
  const s = run.state
  const free = s.offers.flatMap((o, index) => (o.type === 'soul' || o.type === BANNED[L.ablate] ? [] : [index]))
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

// The expert's recruit, by rehearsal over the fights ahead (valueAhead): each soul it can afford, as a piece of its
// own or as a body more in the fielded piece of its kind, with the retinue as it would leave it (when the retinue
// is full, its weakest standing piece in the ossuary let go first: a release only ever comes with a recruit worth
// it), against keeping the essence for its souls' levels and tiers (soulsValue) or keeping it at all; the best that
// beats both, or none. Weighed once a room; a release it needs comes first, then the recruit it was for.
// → { index, onto?, release? } or null
const recruits = new WeakMap()
function weighRecruits (run, L) {
  const s = run.state
  const key = `${s.floor}|${s.at}`
  if (recruits.get(run)?.key === key) return recruits.get(run).pick
  const value = valueAhead(run, L)
  const keep = value({})
  const spend = new Map()
  const spare = (u) => souls(s.party).some((x) => x !== u && x.hp > 0)
  const weakest = inOssuary(s.party).filter(spare).sort(byFieldPower).at(-1)
  let pick = null
  let best = -Infinity
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
      const v = value({ party: sim.state.party, nextUid: sim.state.nextUid, kinds: sim.state.kinds })
      if (!spend.has(o.cost)) spend.set(o.cost, soulsValue(run, value, o.cost, L))
      if (v > Math.max(keep, spend.get(o.cost)) && v > best) {
        best = v
        pick = { index, ...(onto !== null && { onto }), ...(full && { release: weakest.uid }) }
      }
    }
  }
  recruits.set(run, { key, pick })
  if (pick && audited(run)) note('done', pick.onto != null ? 'recruit onto a piece' : 'recruit a new piece')
  return pick
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
  // next place Command buys on the field (and makes that point worth buying in rehearsal).
  const weakest = room ? 0 : fieldPower(field.at(-1)) * (inOssuary(standing(souls(s.party))).length ? 1.1 : 0.8)
  const best = affordable.sort((a, b) => b.w - a.w || a.index - b.index)[0]
  if (best && best.w > weakest) return best.index
  return affordable.find((a) => fielded(souls(s.party)).some((u) => u.id === a.o.id))?.index ?? null
}

// A soul on offer as it would join: at its kind's level or its own, the higher, with its kind's tiers.
const offered = (s, o) => makeUnit(o.id, { uid: s.nextUid + 1000, lvl: Math.max(o.lvl, s.kinds[o.id]?.lvl ?? 0), tracks: s.kinds[o.id]?.tracks })

// The state an offer would make, for rehearsal: a relic or a keystone held, or the kind (every soul of it) with
// that tier; else as is.
export function offerState (s, o) {
  if (o.type === 'relic') return { relics: [...s.relics, o.id] }
  if (o.type === 'keystone') return { keystones: [...s.keystones, o.id] }
  if (o.type !== 'tier') return {}
  const tracks = nextTracks(s.kinds[o.kind].tracks, o.track)
  return { kinds: { ...s.kinds, [o.kind]: { ...s.kinds[o.kind], tracks } }, party: s.party.map((u) => (u.id === o.kind ? { ...u, tracks } : u)) }
}

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

// A run's build, as the ladder's spread reads it: its keystones, the kin most of its fielded souls share
// (ties to the first by name; none without souls), and the tracks their kinds took.
const buildOf = (s) => {
  const kins = {}
  for (const u of fielded(souls(s.party))) kins[unitDef(u.id).kin] = (kins[unitDef(u.id).kin] ?? 0) + 1
  const kin = Object.entries(kins).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '-'
  const tracks = [...new Set(fielded(souls(s.party)).flatMap((u) => tracksOf(u.id).filter((_, i) => u.tracks[i] > 0).map((t) => t.id)))].sort()
  return { keystones: s.keystones.slice().sort().join('+') || '-', kin, tracks: tracks.join('+') || '-' }
}

// One seeded run at `level` (with `ablate`, that level with one mechanic taken away: ABLATIONS), as the
// reports need it: each battle as the retinue entered it (its pieces: not the Monarch, not the shadows it
// raised), its army (its bodies, the tiers' added included, and how many fell, the souls on a line, how many
// acted: armyMeasures), with
// `setups` what it was built from (for refighting) and with `snapshots` the run's state just before the fight
// (for refighting with a mechanic stripped: necessity; its log left out); how the run ended, what felled the
// Monarch, the army it ended with, its build (buildOf), and how many of each action it took (`acts`, by type;
// `tiers`: track tiers its kinds hold at the end; `relics`/`keystones` held).
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
        lines: r.setup.party.filter((u) => u.line).length,
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
// stacks, splits and Monarch points it weighed and took, and per battle Arise's raises and the party's synergies.
export function auditRecord ({ seed, level }) {
  const t0 = Date.now()
  const battles = { n: 0, won: 0, raised: 0, synergies: 0 }
  const run = createRun({ seed })
  resetAudit(true, run)
  autoplay(run, {
    level,
    beforeFight: (r) => chose(r.state, fielded(r.state.party).map((u) => ({ ...u, line: r.state.lines[u.uid] ?? null }))),
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
    const k = a.type === 'monarch' ? `Monarch ${a.stat}` : a.type === 'reap' && a.onto != null ? 'reap onto' : a.type
    acts[k] = (acts[k] ?? 0) + 1
  }
  const out = {
    seed, level, result: s.result, floor: s.floor, secs: (Date.now() - t0) / 1000, battles, acts,
    candidates: AUDIT.candidates, plans: AUDIT.plans, considered: AUDIT.considered, chosen: AUDIT.chosen, done: AUDIT.done, lines: AUDIT.lines, length: AUDIT.length, seats: AUDIT.seats
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
  const features = ['line', ...Object.keys(SIGNALS).map((k) => `line:${k}`), 'turning line', 'Banner wing', 'seat off the rear middle', 'stack fielded', 'ring-2 fielded']
  for (const f of features) row(f, (rs) => sum(rs, (r) => r.considered[f]), (rs) => sum(rs, (r) => r.chosen[f]))
  for (const k of ['stack', 'split']) row(`${k} (weighed/done)`, (rs) => sum(rs, (r) => r.considered[k]), (rs) => sum(rs, (r) => r.acts[k]))
  for (const k of ['recruit a new piece', 'recruit onto a piece']) row(`${k} (weighed/done)`, (rs) => sum(rs, (r) => r.considered[k]), (rs) => sum(rs, (r) => r.done[k]))
  row('release (done)', () => '-', (rs) => sum(rs, (r) => r.acts.release))
  for (const k of ['level', 'upgrade', 'monarch']) row(`idle essence: ${k} (weighed/bought)`, (rs) => sum(rs, (r) => r.considered[`idle ${k}`]), (rs) => sum(rs, (r) => r.done[`idle ${k}`]))
  for (const stat of MONARCH_STATS) row(`Monarch ${stat} (weighed/bought)`, (rs) => sum(rs, (r) => r.considered[`Monarch ${stat}`]), (rs) => sum(rs, (r) => r.acts[`Monarch ${stat}`]))
  console.log('\nfought, per level:')
  for (const [level, rs] of groups) {
    const n = Math.max(1, sum(rs, (r) => r.battles.n))
    const lines = Object.keys(SIGNALS).map((k) => `${k} ${sum(rs, (r) => r.lines[k])}`).join(', ')
    const all = sum(rs, (r) => Object.values(r.lines).reduce((a, b) => a + b, 0))
    const seats = {}
    for (const r of rs) for (const [slot, k] of Object.entries(r.seats)) seats[slot] = (seats[slot] ?? 0) + k
    console.log(`  ${level}: lines by signal: ${lines}; mean length ${(sum(rs, (r) => r.length) / Math.max(1, all)).toFixed(1)} tiles; ` +
      `${Object.keys(seats).length} seats used (${Object.entries(seats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}); ` +
      `Arise ${(sum(rs, (r) => r.battles.raised) / n).toFixed(2)} raises and ${(sum(rs, (r) => r.battles.synergies) / n).toFixed(2)} synergies a battle; ${sum(rs, (r) => r.battles.won)}/${n} won`)
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
  // The army: stacks made over the run and pieces in the ossuary at its end; per battle, the bodies fielded,
  // the bodies that fell, and the pieces that walked a line.
  console.log('\nlevel     stacks  ossuary   bodies/battle  fell/battle  lines/battle')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const avg = (f) => (mine.reduce((n, r) => n + f(r), 0) / runs).toFixed(1)
    const battles = mine.flatMap((r) => r.battles)
    const per = (key) => (battles.reduce((n, b) => n + b[key], 0) / Math.max(1, battles.length)).toFixed(2)
    console.log(`${level.padEnd(6)}  ${avg((r) => r.acts.stack ?? 0).padStart(8)}  ${avg((r) => r.ossuary).padStart(7)}  ${per('bodies').padStart(14)}  ${per('fell').padStart(11)}  ${per('lines').padStart(12)}`)
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
  // spread in wins (no build in more than ~25%): the commonest keystones, kin and tracks.
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
  console.log('\nlevel   wins  build spread in wins: the commonest keystones, kin, tracks, and keystones+kin')
  levels.forEach((level, i) => {
    const wins = played.slice(i * runs, (i + 1) * runs).filter((r) => r.result === 'victory')
    const commonest = (f) => {
      const n = {}
      for (const r of wins) n[f(r.build)] = (n[f(r.build)] ?? 0) + 1
      const [k, c] = Object.entries(n).sort((a, b) => b[1] - a[1])[0] ?? ['-', 0]
      return `${k} ${wins.length ? (100 * c / wins.length).toFixed(0) : 0}%`
    }
    console.log(`${level.padEnd(6)}  ${String(wins.length).padStart(4)}  ${[(b) => b.keystones, (b) => b.kin, (b) => b.tracks, (b) => `${b.keystones}|${b.kin}`].map(commonest).join('; ')}`)
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
// `--variants lines,bodies`) plays only those ablations beside the full expert, for a quicker check. Each drop
// is checked against its band (BANDS): a core mechanic should cost 25–50 points, an extra one 8–25.
export const CORE = ['monarch-stats', 'arise', 'lines', 'bodies']
export const EXTRA = ['tracks', 'keystones', 'relics', 'synergies', 'formation']
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
  console.log('\nuses over the runs: Monarch points, stacks made, lines drawn, track tiers held, levels bought,')
  console.log('keystones and relics held at the end')
  console.log('variant        points   stack   line  tiers  levels  keyst  relics')
  for (const { ablate, mine } of rows) {
    const sum = (f) => String(mine.reduce((n, r) => n + f(r), 0)).padStart(6)
    console.log(`${(ablate ?? 'full').padEnd(13)}  ${[(r) => r.points, (r) => r.acts.stack ?? 0,
      (r) => r.acts.line ?? 0, (r) => r.tiers, (r) => r.acts.level ?? 0, (r) => r.keystones.length, (r) => r.relics].map(sum).join(' ')}`)
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
//                  Command 0: only the base field fights (the strongest standing souls)
//   arise, synergies, bodies  the rules switch (as the full ablation's)
//   lines          no line: every soul holds
//   tracks         no tier on any track
//   keystones      none (the domain and the field as without them)
//   relics         none (no relic mods, no trigger relics, the field as without them)
//   formation      the souls in basic's first draft's cells (their lines moved with them), the Monarch parked
//                  where basic parks it
//   levels         every kind at level 2 (its souls' wounds kept as a share)
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
  if (mechanic === 'monarch-stats') {
    s.monarch = { hp: 0, dominion: 0, command: 0, will: 0 }
    relevel(monarchOf(s), 0)
  } else if (RULE_SWITCHES.includes(mechanic)) {
    s.ablate = [...(s.ablate ?? []), mechanic]
  } else if (mechanic === 'lines') {
    s.lines = {}
  } else if (mechanic === 'tracks') {
    for (const k of Object.values(s.kinds)) k.tracks = [0, 0]
    for (const u of team) u.tracks = [0, 0]
  } else if (mechanic === 'keystones') {
    s.keystones = []
  } else if (mechanic === 'relics') {
    s.relics = []
  } else if (mechanic === 'formation') {
    const at = new Map(basicCells(run, fielded(s.party).map((u) => ({ ...u, line: s.lines[u.uid] ?? null })), LEVELS.expert).map((u) => [u.uid, u]))
    for (const u of s.party) {
      if (!at.has(u.uid)) continue
      u.slot = at.get(u.uid).slot
      if (at.get(u.uid).line) s.lines[u.uid] = at.get(u.uid).line
      else delete s.lines[u.uid]
    }
  } else if (mechanic === 'levels') {
    for (const k of Object.values(s.kinds)) k.lvl = 2
    for (const u of team) relevel(u, 2)
  } else if (mechanic !== null) {
    throw new Error(`unknown mechanic "${mechanic}": ${NECESSITY.join(', ')}`)
  }
  // A smaller field (no Command, keystone or relic adding any): the weakest standing souls past it to the ossuary.
  const cap = fieldCap(run)
  const over = standing(fielded(team)).sort(byFieldPower).slice(cap)
  for (const u of over) {
    u.slot = -1
    delete s.lines[u.uid]
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
    const play = (job) => (job.audit ? auditRecord(job) : job.refight ? refight(job) : record(job))
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
    if (process.argv.includes('--audit')) await audit({ seed: arg('seed', 'audit'), runs: Number(arg('runs', 4)) })
    else if (process.argv.includes('--ablations')) await ablations({ ...opts, variants, runs: Number(arg('runs', RUNS.ablations)), out: arg('out', null) })
    else if (process.argv.includes('--necessity')) await necessity({ ...opts, runs: Number(arg('runs', RUNS.necessity)), setups: arg('setups', null) })
    else if (process.argv.includes('--decisions')) await decisions({ ...opts, runs: Number(arg('runs', RUNS.decisions)) })
    else if (process.argv.includes('--ladder')) await ladder({ ...opts, runs: Number(arg('runs', RUNS.ladder)) })
    else await report({ ...opts, ablate, runs: Number(arg('runs', RUNS.sim)) })
  }
}
