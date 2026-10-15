// The calculator, and the teacher over it (redesign.md §3, the spike of 2026-10-15). A player with no weight fitted or
// searched: every decision is legal options read by exact arithmetic and taken by a fixed order that names no kind,
// relic or number of the content. The teacher plays the calculator's candidates out to the run's end and takes the
// best (the outside teacher's method, outside.js, over this base instead of the hand expert). Offline only, like
// teach.js and outside.js: nothing in the game imports it.
//
// In battle (calcTurn): each piece of yours, one at a time, takes the option (policy.js options: a tile its Move
// reaches, then an act from there, or none) whose consequences, read by policy.js features on the board as it stands,
// score best by
//   [ the Monarch out of the foes' reach to fell next turn, material ]
// in that order, material being HP at unit weight, both sides alike: what it deals (damage, and a kill's max HP more),
// mends, lays as a status (content.js STATUS_WORTH, the content's own price) and raises, less the counter it draws and
// what the foes would take of yours next turn where it ends (souls, shadows and the Monarch, a fall its max HP more:
// features' `loss`, `shadowLoss`, `hit` with TUNING.expert.battle.brink and .peril at 0, so a wound counts its HP and
// no more). A hold counts what End Turn will have it strike or mend from there. The pieces go in the order of their
// best option on the turn's first board, each read again on the board as the ones before left it. No fusion in battle
// (a fusion is a purchase: the teacher's, out of battle).
//
// Out of battle (calcStep, calcDecision), each decision's options in a fixed order, the first its pick:
//   draft    the offers, the highest tier first
//   map      each purchase the purse affords (a fusion first, the highest tier; then a tier, the most souls of its kind
//            an essence) and each room open (an altar first while the Monarch stands below half or a soul is fallen,
//            then a Shop while the purse buys its cheapest relic, then a fight, an elite, the rest): the pick the first
//            purchase, else the first room
//   prep     the strongest souls standing (tier, level, max HP) up to Command, on the camp's default frontier
//            (run.js frontier), walked to as outside.js prepStep walks
//   reap     each soul offered the purse affords (the highest tier, then a kind held), and none; a full retinue lets its
//            weakest soul go first
//   shop     each relic the purse affords, the rarest first, and leaving; a piece relic then given
//   hold     an unheld piece relic to each fielded soul that may take it, the strongest first
//   altar    its rites (run.js altarActions): the heal first while the Monarch stands below half or a soul is fallen,
//            else each free tier first (in the purchases' order, as if the purse paid) and then the heal; the
//            transmutations last
import { createRun, apply, availableNodes, currentNode, souls, fielded, fieldCap, canFuse, fuseParts, tierCost, heldKinds, canAdvance,
  canTake, canBuy, relicPrice, canHold, unheld, soulCount, rosterCap, frontier, monarchOf, relicTier, soulOffer, altarActions, OSSUARY } from './run.js'
import { fork, orderable, stalled, order } from './turns.js'
import { situation, features, options, untouchedOrders } from './policy.js'
import { prepStep } from './outside.js'
import { progressOf } from './autoplay.js'
import { hashString } from './rng.js'
import { unitDef, FUSION_LIST } from '../content.js'
import { TUNING } from '../tuning.js'

// The readers' two searched numbers at 0: a wound counts its HP, a fall the piece's max HP more, the Monarch's HP its HP.
export function plainReaders () {
  TUNING.expert.battle.brink = 0
  TUNING.expert.battle.peril = 0
}

// ── in battle ─────────────────────────────────────────────────────────────────────────────────────

const cmp = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  return 0
}
// An option's key, the higher the better: the Monarch safe next turn, then material in HP; ties to the shorter walk,
// the lower tile, the lower target (so a board gives one turn).
function keyOf (v, o) {
  const dealt = v.damage + v.kill + v.mend + v.status + v.shadow + (o.ability ? 0 : v.basic + v.basicKill - v.basicCounter)
  const lost = v.counter + v.loss + v.shadowLoss + v.hit
  return [-v.lethal, dealt - lost, -o.path.length, -o.tile, -(o.target?.uid ?? -1)]
}
// The plan the readers ask for (features' sit.plan): none, so the plan's features (progress, role, post, listed) read
// nothing; its forecast map is the danger map itself (`forecast`, unscored).
const NONE = new Map()
function best (f, u) {
  const sit = situation(f)
  sit.plan = { goals: NONE, listed: NONE, kills: [], shooters: [], get fmap () { return sit.map } }
  let pick = null
  for (const o of options(f, u)) {
    const k = keyOf(features(f, u, o, sit), o)
    if (!pick || cmp(k, pick.k) > 0) pick = { o, k }
  }
  return pick
}
const copyOf = (battle) => {
  const f = fork(battle)
  f.cache = new Map(battle.cache)
  f.syn = { ...battle.syn }
  return f
}
const give = (f, o, out) => { order(f, o); out.push(o) }
function commit (f, u, o, out) {
  if (o.tile !== u.tile) give(f, { type: 'move', uid: u.uid, tile: o.tile }, out)
  if (!f.over && o.ability) give(f, { type: 'act', uid: u.uid, ability: o.ability.id, target: o.target.uid }, out)
}
// One turn's orders, End Turn last.
export function calcTurn (battle) {
  if (battle.over) return []
  const f = copyOf(battle)
  const out = []
  const pieces = f.units.filter((u) => orderable(f, u) && !u.acted)
  const first = new Map(pieces.map((u) => [u.uid, best(f, u)]))
  const order = pieces.filter((u) => first.get(u.uid)).sort((a, b) => cmp(first.get(b.uid).k, first.get(a.uid).k) || a.uid - b.uid)
  order.forEach((u, i) => {
    if (f.over || !orderable(f, u) || u.acted) return
    const p = i === 0 ? first.get(u.uid) : best(f, u)
    if (p) commit(f, u, p.o, out)
  })
  if (!f.over) out.push(...untouchedOrders(f))
  out.push({ type: 'end' })
  return out
}

// ── out of battle ─────────────────────────────────────────────────────────────────────────────────

const tierOf = (id) => unitDef(id).tier
// A soul's strength in order: standing, tier, level, max HP, the older first.
const strength = (u) => [u.hp > 0 ? 1 : 0, tierOf(u.id), u.lvl, u.maxHp, -u.uid]
const strongest = (a, b) => cmp(strength(b), strength(a))
const RARITY = { legendary: 3, rare: 2, uncommon: 1, common: 0 }
const standing = (s) => souls(s.party).filter((u) => u.hp > 0)

// What the purse buys now: each fusion (the highest tier first), then each tier of a kind held (tiers).
export function purchases (run) {
  const fuses = FUSION_LIST.filter((r) => canFuse(run, r.id))
    .sort((a, b) => tierOf(b.result) - tierOf(a.result) || (a.id < b.id ? -1 : 1))
    .map((r) => ({ type: 'fuse', id: r.id, parts: fuseParts(run, r.id) }))
  return [...fuses, ...tiers(run)]
}
// Each next tier of a kind held with a soul standing, the most souls of the kind standing an essence first, as `type`
// actions: those the purse affords (upgrades), or with `free` every one as if it paid (an altar's consecrations).
function tiers (run, { type = 'upgrade', free = false } = {}) {
  const s = run.state
  const out = []
  for (const kind of heldKinds(s)) {
    const n = standing(s).filter((u) => u.id === kind).length
    if (!n) continue
    for (const track of [0, 1]) {
      if (!canAdvance(s, kind, track)) continue
      const cost = tierCost(run, kind, track)
      if (free || s.essence >= cost) out.push({ a: { type, kind, track }, rate: n / cost })
    }
  }
  out.sort((a, b) => b.rate - a.rate || (a.a.kind < b.a.kind ? -1 : a.a.kind > b.a.kind ? 1 : a.a.track - b.a.track))
  return out.map((t) => t.a)
}
// Whether the calculator would heal: the Monarch below half its HP, or a soul fallen.
function hurt (s) {
  const m = monarchOf(s)
  return m.hp < m.maxHp / 2 || souls(s.party).some((u) => u.hp <= 0)
}
// The rooms open, in the calculator's order.
export function rooms (run) {
  const s = run.state
  const sore = hurt(s)
  const rich = s.essence >= relicPrice(run, 'whetstone')
  const rank = (n) => n.type === 'altar' ? (sore ? 0 : 6) : n.type === 'shop' ? (rich ? 1 : 5) : { fight: 2, boss: 2, siege: 3, elite: 4 }[n.type] ?? 7
  return availableNodes(run).slice().sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1)).map((n) => ({ type: 'node', id: n.id }))
}
// A relic waiting: the strongest fielded soul that may take it, each a candidate.
function holds (run) {
  const s = run.state
  const relic = unheld(s)[0]
  if (!relic) return []
  return fielded(souls(s.party)).filter((u) => u.hp > 0 && !u.relics?.length && canHold(s, relic, u)).sort(strongest)
    .map((u) => ({ type: 'hold', relic, uid: u.uid }))
}
// An altar's rites in the calculator's order (see the head): the transmutations, a soul for another kind of its tier,
// are a strategy's, not a sum's, so last, in the run's order.
function rites (run) {
  const heal = { type: 'heal' }
  const free = tiers(run, { type: 'consecrate', free: true })
  return [...(hurt(run.state) ? [heal, ...free] : [...free, heal]), ...altarActions(run).filter((a) => a.type === 'transmute')]
}
// The formation: the strongest standing up to Command, on the camp's default frontier.
function goalOf (run) {
  const s = run.state
  const chosen = standing(s).sort(strongest).slice(0, fieldCap(run))
  const slots = frontier(s.camp, chosen)
  return chosen.map((u, i) => ({ uid: u.uid, slot: slots[i] }))
}
// The recruits: each offer the purse affords (with the weakest soul let go first, where the retinue is full), and none.
function recruits (run) {
  const s = run.state
  const full = soulCount(s.party) >= rosterCap(run)
  const spare = full ? souls(s.party).filter((u) => souls(s.party).some((x) => x !== u && x.hp > 0)).sort(strongest).at(-1) : null
  const held = new Set(heldKinds(s))
  const out = []
  s.offers.forEach((o, index) => {
    const cost = soulOffer(run, o).cost
    if (s.essence < cost || (full && !spare)) return
    out.push({ o, acts: [...(full ? [{ type: 'release', uid: spare.uid }] : []), { type: 'reap', index }] })
  })
  out.sort((a, b) => tierOf(b.o.id) - tierOf(a.o.id) || held.has(b.o.id) - held.has(a.o.id) || a.acts.at(-1).index - b.acts.at(-1).index)
  return [...out.map((x) => x.acts), [{ type: 'reap', index: null }]]
}
// The relics the purse affords, the rarest first, then the dearest, then the shelf's order; and leaving.
function relics (run) {
  const s = run.state
  const out = s.shop.map((id, index) => ({ id, index })).filter((x) => x.id && canBuy(run, x.index))
    .sort((a, b) => RARITY[relicTier(b.id)] - RARITY[relicTier(a.id)] || relicPrice(run, b.id) - relicPrice(run, a.id) || a.index - b.index)
  return [...out.map((x) => [{ type: 'buy', index: x.index }]), [{ type: 'leave' }]]
}

// The decision the calculator meets now out of battle: its kind and its candidates (each a list of actions), the
// calculator's own pick first. → { kind, cands }
export function calcDecision (run) {
  const s = run.state
  if (s.phase === 'draft') {
    const ix = s.draft.offer.map((id, index) => ({ id, index })).sort((a, b) => tierOf(b.id) - tierOf(a.id) || a.index - b.index)
    return { kind: 'draft', cands: ix.map((x) => [{ type: 'pick', index: x.index }]) }
  }
  if (s.phase === 'reap') return { kind: 'recruit', cands: recruits(run) }
  if (s.phase === 'altar') return { kind: 'altar', cands: rites(run).map((a) => [a]) }
  const h = holds(run)
  if (h.length) return { kind: 'hold', cands: h.map((a) => [a]) }
  if (s.phase === 'shop') return { kind: 'shop', cands: relics(run) }
  if (s.phase === 'map') {
    const buys = purchases(run).map((a) => [a])
    const open = rooms(run).map((a) => [a])
    return { kind: buys.length ? 'spend' : 'route', cands: [...buys, ...open] }
  }
  if (s.phase === 'prep') return { kind: 'prep', cands: [[prepStep(run, goalOf(run))]] }
  throw new Error(`no decision out of battle for phase "${s.phase}"`)
}

// The calculator's action now: in battle its turn's next order (a turn planned once at its start), else its pick.
const planned = new WeakMap()
export function calcStep (run) {
  if (run.state.phase === 'battle') {
    const b = run.battle
    if (stalled(b)) return { type: 'stall' }
    let p = planned.get(b)
    if (!p || p.turn !== b.turn || !p.orders.length) planned.set(b, (p = { turn: b.turn, orders: calcTurn(b) }))
    return p.orders.shift()
  }
  return calcDecision(run).cands[0][0]
}

// ── the teacher over it ───────────────────────────────────────────────────────────────────────────

const copyRun = (run) => ({ state: structuredClone(run.state), battle: null, setup: null })
// The board at a fight: the run's state but its log, hashed (the calculator's play from there is a pure function of it).
const fightKey = (run) => {
  const { log, ...rest } = run.state
  return hashString(JSON.stringify(rest))
}
// Where a run stands at its end: cleared (1, and the Monarch's share of its HP more, a hair), else how far it got.
function endOf (run) {
  const s = run.state
  if (s.result === 'victory') {
    const m = monarchOf(s)
    return { won: true, value: 1 + 0.01 * Math.max(0, m.hp) / m.maxHp }
  }
  return { won: false, value: progressOf({ result: s.result, floor: s.floor, rank: currentNode(run)?.rank ?? 1 }) }
}

// A candidate played out on a copy: its actions, then the calculator to the run's end, each fight it opens kept in
// `memo` with where it led (a later playout that opens it takes that end).
export function playout (run, acts, memo) {
  const r = copyRun(run)
  try {
    for (const a of acts) apply(r, a)
  } catch {
    return { won: false, value: -Infinity }
  }
  const passed = []
  let end = null
  for (let guard = 0; r.state.phase !== 'over'; guard++) {
    if (guard > 2e5) throw new Error(`${r.state.seed}: a playout is stuck`)
    const a = calcStep(r)
    if (a.type === 'fight') {
      const k = fightKey(r)
      if (memo.has(k)) { end = memo.get(k); break }
      passed.push(k)
    }
    apply(r, a)
  }
  end ??= endOf(r)
  for (const k of passed) memo.set(k, end)
  return end
}

export const PHASES = Object.freeze(['draft', 'spend', 'route', 'recruit', 'shop', 'hold', 'altar'])

// One run: the calculator (`teacher` false), or the teacher over it: at each decision of `phases` with two candidates or
// more, at most `cap` of them (the calculator's first) played out to the end, the first that clears taken, else the best.
export function calcRun (seed, { teacher = false, phases = PHASES, cap = 6, onBattle = null } = {}) {
  const t0 = Date.now()
  const run = createRun({ seed })
  const memo = new Map()
  const on = new Set(phases)
  const stats = { decisions: 0, decided: 0, overrides: 0, playouts: 0 }
  let battle = null
  for (let guard = 0; run.state.phase !== 'over'; guard++) {
    if (guard > 2e5) throw new Error(`${seed}: the run is stuck`)
    if (run.state.phase === 'battle') {
      battle = run.battle
      apply(run, calcStep(run))
      if (run.state.phase !== 'battle') onBattle?.(battle, run)
      continue
    }
    const d = calcDecision(run)
    stats.decisions++
    let acts = d.cands[0]
    if (teacher && on.has(d.kind) && d.cands.length > 1) {
      stats.decided++
      const cands = d.kind === 'spend' || d.kind === 'route'
        ? capMap(d.cands, cap)
        : d.cands.slice(0, cap - 1).concat(d.cands.length > cap - 1 ? [d.cands.at(-1)] : [])
      let pick = null
      for (const c of cands) {
        stats.playouts++
        const p = playout(run, c, memo)
        if (!pick || p.value > pick.p.value + 1e-9) pick = { c, p }
        if (p.won) break
      }
      if (pick.c !== cands[0]) stats.overrides++
      acts = pick.c
    }
    for (const a of acts) {
      const was = run.state.phase
      apply(run, a)
      if (was === 'battle' && run.state.phase !== 'battle') onBattle?.(battle, run)
    }
  }
  const s = run.state
  return {
    seed, player: teacher ? 'teacher' : 'calc', result: s.result, floor: s.floor, death: s.death ? { threat: s.death.threat ?? null, reason: s.death.reason ?? null } : null,
    end: endOf(run).value, stats, secs: (Date.now() - t0) / 1000
  }
}
// A map step's candidates within the cap: every room open, and the purchases before them as far as the cap allows (the
// calculator's pick always among them).
function capMap (cands, cap) {
  const roomsOf = cands.filter((c) => c[0].type === 'node')
  const buys = cands.filter((c) => c[0].type !== 'node')
  return [...buys.slice(0, Math.max(1, cap - roomsOf.length)), ...roomsOf].slice(0, Math.max(cap, roomsOf.length + 1))
}

// ── the command line ──────────────────────────────────────────────────────────────────────────────

// node src/sim/calc.js [--teacher] [--seed aud] [--from 0] [--runs 8]: a line a run (calcRun's, with its battles fought
// and won and their turns); run several at once on disjoint `--from` ranges for cores.
if (typeof process !== 'undefined' && process.argv[1] === decodeURIComponent(new URL(import.meta.url).pathname)) {
  const arg = (name, def) => {
    const i = process.argv.indexOf('--' + name)
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
  }
  plainReaders()
  const from = Number(arg('from', 0))
  for (let i = from; i < from + Number(arg('runs', 8)); i++) {
    let battles = 0
    let won = 0
    let turns = 0
    const r = calcRun(`${arg('seed', 'aud')}-${i}`, { teacher: process.argv.includes('--teacher'), onBattle: (b) => { battles++; won += b.winner === 'party'; turns += b.turn } })
    console.log(JSON.stringify({ ...r, battles, won, turns }))
  }
}
