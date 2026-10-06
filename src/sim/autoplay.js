// A player for tests and balance runs: a policy that picks one action at a time for apply(). It plays at
// one of two levels (LEVELS), on the same choices and the same scouting a player has:
//   basic   rules of thumb: rooms by weighted dice, the strongest souls fielded, the best of three
//           drafted formations, the first free offer, recruits only to fill the field, and essence on
//           the lowest level (a path tier once a soul is ready for it)
//   expert  plans: every route over the next few ranks played out, wounds counted when fielding, the
//           formation hill-climbed over cells and the ossuary, free offers weighed by rehearsing the
//           fights ahead, recruits that would make the field, and essence on whatever buys the most
//           worth per essence
// It knows the rules, not the rolls: rehearsals and rollouts never use a battle's own seed.
// Run directly for a balance report:  node src/sim/autoplay.js [--runs 200] [--seed sim] [--level expert]
// for the gap between the levels:     … --ladder [--runs 60]
// or for a report on how much the player's choices decide battles:  … --decisions [--runs 60]
import { createRng } from './rng.js'
import {
  statsOf, pathsOf, tiersOf, autoPlace, CENTRE_OUT, CAMP_SLOTS, CAMP_ROWS, campGrid, campOpen, wallTiles, steps, deployTile,
  tileAt, TILES, LANES, rowOf, colOf, rangeOf, isAllyShape, distance, makeUnit
} from './unit.js'
import { createBattle, runBattle } from './battle.js'
import {
  createRun, apply, availableNodes, fieldCap, rosterCap, fielded, benched, currentNode, battleSetup, levelCost, tierCost
} from './run.js'
import { nodeOf } from './map.js'
import { TUNING } from '../tuning.js'
import { unitDef, abilityDef, campDef, ROLES } from '../content.js'

// seeds: rehearsals per formation (0: take the first draft unrehearsed); drafts: how many of the three
// drafts to try (all by default); search: formations tried by hill-climbing from the best draft;
// wounds: field by worth with wounds counted; rollouts: walks per route when choosing a room (0:
// weighted dice), over the next `horizon` rooms; reap: weigh free offers by rehearsing the fights
// ahead, and recruit by worth; spend: buy by worth per essence rather than by rule of thumb.
export const LEVELS = {
  basic: { seeds: 1, search: 0, wounds: false, rollouts: 0, reap: false, spend: false },
  expert: { seeds: 2, search: 12, wounds: true, rollouts: 1, horizon: 3, reap: true, spend: true }
}
// How an expert imagines a route (quick formations, basic offers), and sizes up an offer.
const ROLLOUT = { seeds: 0, search: 0, wounds: true, rollouts: 0, reap: false, spend: false }
const SIZE_UP = { ...ROLLOUT, seeds: 1, drafts: 1 }

const hpPct = (u) => u.hp / u.maxHp
const partyHealth = (party) => party.reduce((n, u) => n + hpPct(u), 0) / party.length
const byPower = (a, b) => power(b) - power(a) || a.uid - b.uid
// An expert counts wounds: a soul at 10% HP is not worth fielding at full price.
const byFieldPower = (a, b) => fieldPower(b) - fieldPower(a) || a.uid - b.uid

// Rough fighting worth from its stats, path tiers included: how long it lasts times how hard it hits,
// square-rooted. A tier that grants an ability or an aura counts as a tenth more. 0 for the fallen.
function worth (u) {
  if (u.hp <= 0) return 0
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
// A copy to play ahead on, with its own rolls.
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
  const w = { fight: 3, elite: health > 0.7 ? 1.5 : 0.3, reliquary: 2, altar: health < 0.6 ? 5 : 0.5, boss: 1 }
  return { type: 'node', id: rng.weighted(nodes, nodes.map((n) => w[n.type])).id }
}

// The expert walks every route over the next `horizon` rooms `rollouts` times on its own rolls, with
// quick formations and basic offers, and takes the first room of the route that ends best on average.
function pickRoute (run, L) {
  const start = strength(run.state)
  const totals = new Map() // route → summed value
  for (let k = 0; k < L.rollouts; k++) {
    for (const [route, value] of rollout(fork(run, k), start, L.horizon)) totals.set(route, (totals.get(route) ?? 0) + value)
  }
  let best = null
  for (const [route, value] of totals) if (!best || value > best.value) best = { route, value }
  return best.route.split(' ')[0]
}

// Every route from here, `depth` rooms deep or to the floor's end, as [route, value]: 0 for a run lost
// on the way, 2 for the boss slain, else 1 plus half the retinue's strength at the route's end over its
// strength now. Routes that share their first rooms share those fights: the walk only branches where
// the map does.
function rollout (sim, start, depth, route = []) {
  const next = nodeOf(sim.state.map, sim.state.at).next
  return next.flatMap((id, i) => {
    const branch = i === next.length - 1 ? sim : fork(sim)
    const floor = branch.state.floor
    apply(branch, { type: 'node', id })
    while (branch.state.phase === 'prep' || branch.state.phase === 'reap') apply(branch, policy(branch, null, ROLLOUT))
    const s = branch.state
    const here = [...route, id]
    if (s.phase === 'over') return [[here.join(' '), s.result === 'victory' ? 2 : 0]]
    if (s.floor !== floor || here.length >= depth) return [[here.join(' '), 1 + 0.5 * strength(s) / start]]
    return rollout(branch, start, depth, here)
  })
}

// What a retinue brings to its next fight: the fieldable souls' wounded power, raised by relics.
function strength (s) {
  const cap = TUNING.party.field + s.relics.filter((r) => r === 'grave_banner').length
  const best = s.party.map(fieldPower).sort((a, b) => b - a).slice(0, cap)
  return best.reduce((n, p) => n + p, 0) * (1 + 0.08 * s.relics.length) || 1
}

// ── prep: the formation ──────────────────────────────────────────────────────────────────────────────

// The autoplayer arranges its souls with the same choice a player has: any open camp cell. It drafts a
// few formations and rehearses each against the scouted foes on a different battle seed (it knows the
// rules, not the rolls), keeping the one that does best; ties keep the earlier draft:
//   rows       each role's row, packed from the middle lane (bonds and auras want neighbours)
//   spread     each role's row, every other lane first (against area attacks)
//   sheltered  the melee where foes walking in arrive first; ranged souls behind the walls, where foes
//              must walk furthest to reach them for how close they stand
// An expert then hill-climbs from the best draft: swapping two souls, moving one to another cell, or
// trading one for a standing soul from the ossuary, keeping each change that rehearses better.

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

function sheltered (units, camp) {
  const walk = walkIn(camp)
  const free = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(camp, slot))
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

function drafts (run, want) {
  const s = run.state
  const blank = () => want.map((u) => ({ ...u, slot: -1 }))
  const rows = (cols) => autoPlace(blank(), { cols, grid: campGrid(s.camp) })
  const lanes = blasts(currentNode(run).foes) ? [SPREAD, CENTRE_OUT] : [CENTRE_OUT, SPREAD]
  return [rows(lanes[0]), rows(lanes[1]), sheltered(blank(), s.camp)]
}

const rehearsalSeed = (setup, k) => setup.seed + '|rehearsal' + (k ? '|' + k : '')

// A rehearsal's worth, averaged over `seeds` rolls: a win by how much HP it keeps (wounds carry over), a
// loss by how much of the foes' HP it took.
function rehearse (run, party, seeds = 1) {
  const setup = battleSetup(run, { party })
  let total = 0
  for (let k = 0; k < seeds; k++) {
    const b = createBattle({ ...setup, seed: rehearsalSeed(setup, k) })
    runBattle(b)
    const share = (side) => {
      const us = b.units.filter((u) => u.side === side)
      return us.reduce((n, u) => n + u.hp, 0) / us.reduce((n, u) => n + u.maxHp, 0)
    }
    total += b.winner === 'party' ? 1 + share('party') : -share('foe')
  }
  return total / seeds
}

// Who stands in the camp: the strongest standing souls, wounds counted at the expert's level.
const standing = (party) => party.filter((u) => u.hp > 0)
const wanted = (run, L) => standing(run.state.party).sort(L.wounds ? byFieldPower : byPower).slice(0, fieldCap(run))

// → { party, score }: the best formation found for the current room. Formations that put everyone in
// the same cells are only rehearsed once.
function plan (run, L) {
  const want = wanted(run, L)
  const options = drafts(run, want).slice(0, L.drafts ?? 3)
  if (!L.seeds) return { party: options[0], score: 0 }
  const tried = new Map()
  const score = (party) => {
    const key = party.map((u) => `${u.uid}@${u.slot}`).sort().join()
    if (!tried.has(key)) tried.set(key, rehearse(run, party, L.seeds))
    return tried.get(key)
  }
  let best = null
  let bestScore = -Infinity
  for (const party of options) {
    const v = score(party)
    if (v > bestScore) { best = party; bestScore = v }
  }
  const rng = createRng(JSON.stringify([run.state.seed, run.state.floor, run.state.at, best.map((u) => u.uid)])).stream('climb')
  const open = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(run.state.camp, slot))
  for (let i = 0; i < L.search; i++) {
    const next = mutate(best, standing(run.state.party), open, rng)
    const v = score(next)
    if (v > bestScore) { best = next; bestScore = v }
  }
  return { party: best, score: bestScore }
}

// One change to a formation: trade a soul for one from the ossuary, swap two, or move one to a free
// cell (a near one more often than not).
function mutate (party, pool, open, rng) {
  const out = party.map((u) => ({ ...u }))
  const a = out[rng.int(out.length)]
  const spare = pool.filter((u) => !out.some((x) => x.uid === u.uid))
  const roll = rng()
  if (spare.length && roll < 0.2) return out.map((u) => (u === a ? { ...rng.pick(spare), slot: a.slot } : u))
  if (out.length > 1 && roll < 0.55) {
    const b = rng.pick(out.filter((u) => u !== a));
    [a.slot, b.slot] = [b.slot, a.slot]
    return out
  }
  const free = open.filter((slot) => !out.some((u) => u.slot === slot))
  const near = free.filter((slot) => distance(deployTile('party', slot), deployTile('party', a.slot)) <= 2)
  a.slot = rng.pick(near.length && rng.chance(0.7) ? near : free)
  return out
}


// The plan only depends on the room, the camp, the relics, who is standing (not where) and the uids the
// foes will take, so it is made once per prep however many steps carry it out.
const plans = new WeakMap()
function planFor (run, L) {
  const s = run.state
  const key = JSON.stringify([L, s.floor, s.at, s.camp, s.relics, s.nextUid, s.party.map((u) => [u.uid, u.id, u.lvl, u.hp])])
  const have = plans.get(run)
  if (have?.key === key) return have.plan
  const made = plan(run, L).party.map((u) => ({ uid: u.uid, slot: u.slot }))
  plans.set(run, { key, plan: made })
  return made
}

// One step toward the plan: the souls it leaves out benched, then each in its planned cell (whoever
// stood there takes the mover's old one; a soul in place is never moved again); then fight.
function pickPrep (run, L) {
  const s = run.state
  const spend = pickSpend(run, L)
  if (spend) return spend
  const goal = planFor(run, L)
  const out = fielded(s.party).find((u) => !goal.some((p) => p.uid === u.uid))
  if (out) return { type: 'place', uid: out.uid, slot: -1 }
  const off = goal.find((p) => s.party.find((u) => u.uid === p.uid).slot !== p.slot)
  if (off) return { type: 'place', uid: off.uid, slot: off.slot }
  return { type: 'fight' }
}

// ── essence ──────────────────────────────────────────────────────────────────────────────────────

// Essence goes to the souls that will fight: the strongest standing ones. Basic levels the lowest of
// them, but buys a path tier (its first path, or the one it is on) once a soul's level is three per
// tier it would hold. An expert buys whatever adds the most worth per essence, committing a soul to the
// path whose three tiers add the most.
function pickSpend (run, L) {
  const s = run.state
  const field = standing(s.party).sort(byFieldPower).slice(0, fieldCap(run))
  const options = field.flatMap((u) => [
    s.essence >= levelCost(run, u) && u.lvl < TUNING.level.cap && { type: 'level', uid: u.uid, u, cost: levelCost(run, u), after: { ...u, lvl: u.lvl + 1 } },
    ...nextPaths(u).filter(() => s.essence >= tierCost(run, u))
      .map((path) => ({ type: 'upgrade', uid: u.uid, path, u, cost: tierCost(run, u), after: { ...u, path, tier: u.tier + 1 } }))
  ]).filter(Boolean)
  if (!options.length) return null
  if (!L.spend) {
    const ready = options.find((o) => o.type === 'upgrade' && o.u.lvl >= 3 * (o.u.tier + 1) && o.path === (o.u.path ?? pathsOf(o.u.id)[0].id))
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

const nextPaths = (u) => (u.tier >= 3 ? [] : u.path ? [u.path] : pathsOf(u.id).map((p) => p.id))
// What a whole path adds to a soul that has not chosen one.
const pathWorth = (u, path) => worth({ ...u, path, tier: 3 }) - worth(u)

// ── reap ─────────────────────────────────────────────────────────────────────────────────────────

// Free offers (a relic, a rite's tier) first: basic takes the first, an expert rehearses the retinue
// each would make against the battle rooms within two steps and the floor's last room (or the room
// just won, at the floor's end). Then the one recruit a battle allows: basic buys the highest tier it can
// afford while the field has room, an expert the soul worth most if it beats the weakest it would
// field. A full retinue lets its weakest benched soul go to make room.
function pickReap (run, L) {
  const s = run.state
  const free = s.offers.flatMap((o, index) => (o.type === 'soul' ? [] : [index]))
  if (free.length) return { type: 'reap', index: L.reap ? weighOffers(run, free) : free[0] }
  const index = recruit(run, L)
  if (index === null || s.party.length < rosterCap(run)) return { type: 'reap', index }
  const weakest = benched(s.party).sort(L.wounds ? byFieldPower : byPower).at(-1)
  return weakest ? { type: 'release', uid: weakest.uid } : { type: 'reap', index: null }
}

function recruit (run, L) {
  const s = run.state
  const affordable = s.offers.flatMap((o, index) => (o.type === 'soul' && o.cost <= s.essence ? [{ o, index, w: worth(offered(s, o)) }] : []))
  const field = standing(s.party).sort(byFieldPower).slice(0, fieldCap(run))
  const room = field.length < fieldCap(run)
  if (!L.reap) {
    if (!room) return null
    return affordable.sort((a, b) => unitDef(b.o.id).tier - unitDef(a.o.id).tier || a.index - b.index)[0]?.index ?? null
  }
  const weakest = room ? 0 : fieldPower(field.at(-1))
  const best = affordable.sort((a, b) => b.w - a.w || a.index - b.index)[0]
  return best && best.w > weakest * 1.1 ? best.index : null
}

const offered = (s, o) => makeUnit(o.id, { uid: s.nextUid + 1000, lvl: o.lvl })

function weighOffers (run, indices) {
  const s = run.state
  const near = ahead(s.map, s.at, 2)
  const end = nodeOf(s.map, s.map.end)
  const rooms = [...near, ...(near.includes(end) || s.at === end.id ? [] : [end])].filter((n) => n.foes)
  if (!rooms.length) rooms.push(currentNode(run))
  const value = (state) => rooms.reduce((n, node) => n + plan(atNode(run, node, state), SIZE_UP).score, 0) / rooms.length
  let best = indices[0]
  let bestValue = -Infinity
  for (const index of indices) {
    const o = s.offers[index]
    const state = o.type === 'relic'
      ? { relics: [...s.relics, o.id] }
      : { party: s.party.map((u) => (u.uid === o.uid ? { ...u, path: o.path, tier: u.tier + 1 } : u)) }
    const v = value(state)
    if (v > bestValue) { best = index; bestValue = v }
  }
  return best
}

export function policy (run, rng, level = 'basic') {
  const L = typeof level === 'string' ? LEVELS[level] : level
  const s = run.state
  if (s.phase === 'map') return pickNode(run, rng, L)
  if (s.phase === 'prep') return pickPrep(run, L)
  if (s.phase === 'reap') return pickReap(run, L)
  throw new Error(`no policy for phase "${s.phase}"`)
}

// Plays the run to the end. onBattle(battle, run) fires after each battle, once the run has moved on.
export function autoplay (run, { rng = createRng(run.state.seed).stream('autoplay'), level = 'basic', onBattle = null } = {}) {
  for (let guard = 0; run.state.phase !== 'over'; guard++) {
    if (guard > 1e5) throw new Error('autoplay is stuck')
    const action = policy(run, rng, level)
    apply(run, action)
    if (action.type === 'fight') onBattle?.(run.battle, run)
  }
  return run
}

// ── playing many runs ─────────────────────────────────────────────────────────────────────────────

// One seeded run at `level`, as the reports need it: each battle as the retinue entered it, and with
// `setups` what it was built from (for refighting).
function record ({ seed, level, setups = false }) {
  const battles = []
  const run = createRun({ seed })
  autoplay(run, {
    level,
    onBattle: (b, r) => {
      const party = b.units.filter((u) => u.side === 'party')
      battles.push({
        floor: b.floor + (b.boss ? 'B' : ''),
        t: b.t,
        ceiling: b.reason === 'tick-ceiling',
        won: b.winner === 'party',
        lvl: party.reduce((n, u) => n + u.lvl, 0) / party.length,
        size: party.length,
        roster: r.state.party.length,
        foes: b.units.length - party.length,
        relics: r.state.relics.length,
        camp: r.state.camp,
        setup: setups ? r.setup : undefined
      })
    }
  })
  const s = run.state
  return { battles, result: s.result, floor: s.floor, camp: s.camp, relics: s.relics.length, reaped: s.stats.reaped }
}

// Plays every job in worker threads, one per core: an expert run takes seconds.
async function playAll (jobs) {
  const { Worker } = await import('node:worker_threads')
  const { availableParallelism } = await import('node:os')
  const out = new Array(jobs.length)
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++
      out[i] = await new Promise((resolve, reject) => {
        const w = new Worker(new URL(import.meta.url), { workerData: jobs[i] })
        w.once('message', resolve)
        w.once('error', reject)
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs.length, availableParallelism()) }, worker))
  return out
}

// ── balance report ─────────────────────────────────────────────────────────────────────────────

// Autoplays `runs` seeded runs and prints clear rate, battle length, per-floor progression and how each
// camp layout fares: a camp far off its floor's average is a balance outlier.
async function report ({ runs, seed: seed0, level }) {
  const played = await playAll(Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level })))
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
  console.log(`runs ${runs} (seed ${seed0}, ${level} player)`)
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
      const b = createBattle({ ...setup, party })
      runBattle(b)
      const mine = b.units.filter((u) => u.side === 'party')
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

// Run directly: a report, or (in a worker thread of playAll) one run.
if (typeof process !== 'undefined' && process.argv[1] === decodeURIComponent(new URL(import.meta.url).pathname)) {
  const { isMainThread, parentPort, workerData } = await import('node:worker_threads')
  if (!isMainThread) {
    parentPort.postMessage(record(workerData))
  } else {
    const arg = (name, def) => {
      const i = process.argv.indexOf('--' + name)
      return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
    }
    const opts = { seed: arg('seed', 'sim'), level: arg('level', 'expert') }
    if (!LEVELS[opts.level]) throw new Error(`unknown level "${opts.level}": ${Object.keys(LEVELS).join(', ')}`)
    if (process.argv.includes('--decisions')) await decisions({ ...opts, runs: Number(arg('runs', 60)) })
    else if (process.argv.includes('--ladder')) await ladder({ ...opts, runs: Number(arg('runs', 60)) })
    else await report({ ...opts, runs: Number(arg('runs', 200)) })
  }
}
