// The battle teacher, offline and never shipped: labels for the model tree and the forest, made by playing each of a
// piece's options out on a copy of the board; the teacher as a player, the afterstates, the route's labels and fit.
//
//   npm run teach -- [flags]                   label the battle decisions of expert runs
//   npm run teach -- --teacher [flags]         seeds played by the teacher and by the expert, paired
//   npm run teach -- --augment <dir> [flags]   a label set's afterstates written beside it
//   npm run teach -- --route [--fit] [flags]   label the room choices of expert runs, or fit the route's tree to them
//     --runs 300 --seed teach   seeds <seed>-1…<seed>-<runs> (--teacher: 64 of sim-<from>…, --from 0; --route: route)
//     --workers 5               worker threads (--teacher 4)
//     --out dir                 the stage's directory (retinue-<mode>-<seed> in the OS temp dir); one stopped part way goes on
//     --report-only             the report alone, from what --out holds
//     --ascension 0 --monarch id   the runs' ascension level and Monarch (the base one by default)
//     --expert file.json        the battle expert that plays (src/sim/expert.json by default)
//     --forest file.json|none   the forest it plays with (the one forest.js holds by default)
//     --rounds 0                0: each option played to the battle's end; n: stopped after n End Turns
//     --turns 150               the rounds a playout to the end may last; a battle still going then is a stall, lost
//     --cap 16                  a decision's options labelled at most, the expert's choice added
//     --weights k=x,…           the value's weights over the defaults (positional: WEIGHTS' order; --route: its kind's)
//     --keep 1,0.5,0.25,0.03    a decision's chance to be labelled by its danger: lost, near, reach, calm
//     --draw outcome|state      the danger read with the battle's outcome, or from the board alone
//     --keep-floor 1=2,…        a factor on that chance for each floor named
//     --smooth 1 --epsilon 0.1 --top 3   k playouts an option, the first exact, in the rest each decision with chance
//                               epsilon one of its top options at random
//     --rooms end               --route: end, each room played to the run's end; n, until n rooms are done
//     --policy learned          --route: the route that plays (learned, hand or a tree's file)
//     --compare a.json,…        --route: more route trees measured against the labels
//     --fit                     --route: fit the tree to --out's labels, into src/sim/expert.json's route
//     --model file, --dry       --fit: the tree written to this file instead, or nowhere
//     --depth 3 --leaves 8 --lambda 3 --tau 0 --min-leaf 0 --weighted   --fit: fit.js fitExpert's
//     --hand                    --fit: the hand-built route's rules kept, only the rooms they leave fitted
//     --prior file.json --structure grow|prior   --fit: the tree to start from (the hand-built route's weights by
//                               default), grown or its leaves refitted
//
// labels.jsonl, a line a position: { id, seed, run, split ('held' where the seed's number ≡ 0 mod 5, else 'train'),
//   floor, room, battle, turn, uid, kind, at (the run's log index), group (0 won, 1 near-lost, 2 lost), danger,
//   wt (1 / its chance), sit (policy.js conditions), options, chosen, best (bestOf's) }
// an option: { i, tile, steps, ability, target, f (optionFeatures, zeros left out), prior, kept, legal, chosen, added,
//   value, values (each playout's, smoothed only), parts }
// value to the battle's end (END_WEIGHTS) = −lost where lost (a stall too), else −monarch·monarch − own·own − turn·turns
// value after `rounds` End Turns (WEIGHTS) = −monarch·monarch − own·own + foe·foe − lost·lost + won·won
// Beside it runs.jsonl (a line a run), report.json (report's) and manifest.json { made, settings, expert, forest, draw,
//   smooth, value, features, conditions, counts, throughput }.
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRun, apply, currentNode, availableNodes, monarchOf, souls, ascensionTop, BASE_MONARCH, copyRun } from './run.js'
import { createRng, hashString } from './rng.js'
import {
  policy, survey, roomFeatures, routeConditions, routeFeatures, tierScale, ROUTE_FEATURES, progressOf, foeShare, routeRooms, useRoute, routeModel, record, ablatedRun,
  asMonarch, monarchArg
} from './autoplay.js'
import * as P from './policy.js'
import * as E from './expert.js'
import { useForest, forestModel, afterDiff, afterNames, r6 } from './forest.js'
import { holds, screenLines, kindOf, spread, untouchedOrder } from './policy.js'
import { pool as workerPool } from './pool.js'
import { readPlan } from './plan.js'
import { fork, order, canAct, allowed, targetsFrom, pick, helped, lined, stalled } from './turns.js'
import { alive, footprint, isBlow, blowReach, distanceBetween, lineEnds, LINE_AT, LINE_TILES, TILES, tileX } from './unit.js'
import { LANE } from './field.js'
import { TUNING } from '../tuning.js'
import { arg, has, isMain } from './cli.js'

export const WEIGHTS = Object.freeze({ monarch: 3, own: 1, foe: 1, lost: 10, won: 1 })
export const END_WEIGHTS = Object.freeze({ lost: 10, monarch: 3, own: 1, turn: 0.02 })
export const KEEP = Object.freeze({ lost: 1, near: 0.5, reach: 0.25, calm: 0.03 })
export const DEFAULTS = Object.freeze({ rounds: 0, cap: 16, turns: 150, weights: null, keep: KEEP, keepFloor: null, draw: 'outcome', smooth: 1, epsilon: 0.1, top: 3 })
const DRAWS = Object.freeze(['outcome', 'state'])
const weightsOf = (c) => c.weights ?? (c.rounds > 0 ? WEIGHTS : END_WEIGHTS)

// A won battle is near-lost where the Monarch is at or under `share` of its max at a turn's start or the end, or lost `drop`.
const NEAR = Object.freeze({ share: 0.35, drop: 0.4 })
// A seed's number (`teach-17` → 17): what the split by run reads.
const seedNo = (seed) => Number(String(seed).match(/(\d+)$/)?.[1] ?? 0)

const NONE = Object.freeze([])
const EPS = 1e-9

// ── the options ──────────────────────────────────────────────────────────────────────────────────

// The better of two options by the prior; ties: the fewer steps, the lower lane, the lower target uid (policy.js better).
const byPrior = (a, b) => b.prior - a.prior || a.path.length - b.path.length || LANE[tileX(a.tile)] - LANE[tileX(b.tile)] || (a.target?.uid ?? -1) - (b.target?.uid ?? -1)
// The same as policy.js better weighs two options (its EPS on the score), for a sort: below 0 where `a` comes first.
const expertOrder = (a, b) => (Math.abs(a.prior - b.prior) > EPS ? b.prior - a.prior : 0) || a.path.length - b.path.length ||
  LANE[tileX(a.tile)] - LANE[tileX(b.tile)] || (a.target?.uid ?? -1) - (b.target?.uid ?? -1)

// The expert's reading of a decision on conditions `c` (expert.js readTree over the model in use); null without a tree.
const readOf = (c) => (typeof E.readTree === 'function' && typeof E.expertModel === 'function' ? E.readTree(E.expertModel(), c) : null)

// Piece `u`'s options read (`v`, `prior`, `kept` by the hard rules), shortlisted to `cap` as policy.js shortlist does.
export function optionsAt (battle, u, sit, cap = DEFAULTS.cap, c = P.conditions(sit, u)) {
  const all = P.expertOptions(battle, u)
  const read = readOf(c)
  const w = TUNING.expert?.battle?.option
  for (const o of all) {
    o.v = P.optionFeatures(battle, u, o, sit)
    o.prior = read ? E.scoreOf(read, o.v) : w ? E.value(o.v, w) : 0
    if (!Number.isFinite(o.prior)) o.prior = 0
  }
  const left = read && typeof E.hardFilter === 'function' ? new Set(E.hardFilter(read, all).left) : null
  for (const o of all) o.kept = left ? left.has(o) : true
  const list = all.slice().sort(byPrior)
  if (list.length <= cap) return { short: list, all }
  const field = sit.plan?.goals?.get(u.uid)?.field
  const steps = (t) => (field && Number.isFinite(field[t]) ? field[t] : TILES)
  const risks = new Map()
  const risk = (t) => {
    let r = risks.get(t)
    if (r === undefined) risks.set(t, (r = P.dangerAt(battle, u, t, sit.map)))
    return r
  }
  const best = (xs, cmp) => xs.reduce((a, b) => (a === null || cmp(b, a) < 0 ? b : a), null)
  const safer = (a, b) => risk(a.tile) - risk(b.tile) || steps(a.tile) - steps(b.tile)
  const nearer = (a, b) => steps(a.tile) - steps(b.tile) || risk(a.tile) - risk(b.tile)
  const keep = new Set()
  const groups = new Map()
  const moves = []
  for (const o of list) {
    if (o.ability) {
      const k = kindOf(o)
      if (groups.has(k)) groups.get(k).push(o)
      else groups.set(k, [o])
    } else moves.push(o)
  }
  const stay = moves.find((o) => o.tile === u.tile)
  if (stay) keep.add(stay)
  for (const g of groups.values()) {
    keep.add(g[0])
    keep.add(best(g, safer))
  }
  if (moves.length > 1) {
    keep.add(best(moves, nearer))
    keep.add(best(moves, safer))
    const here = holds(u, u.tile, sit)
    const blocks = moves.filter((o) => holds(u, o.tile, sit) > here)
    if (blocks.length) keep.add(best(blocks, (a, b) => holds(u, b.tile, sit) - holds(u, a.tile, sit) || safer(a, b)))
    const lines = screenLines(battle, sit)
    const on = lines.size ? moves.filter((o) => (footprint(o.tile, u.size) ?? [o.tile]).some((t) => lines.has(t))) : NONE
    if (on.length) keep.add(best(on, safer))
  }
  for (const o of spread(list, cap - keep.size, keep, 3)) keep.add(o)
  return { short: list.filter((o) => keep.has(o)), all }
}

// ── giving an option, and playing it out ─────────────────────────────────────────────────────────

// Option `o` given on copy `g` (a move or stay with what End Turn would have it do), the piece then done. → its orders
export function give (g, uid, o) {
  const u = g.byUid.get(uid)
  const out = []
  const put = (x) => {
    order(g, x)
    out.push(x)
  }
  if (o.tile !== u.tile) put({ type: 'move', uid, tile: o.tile })
  if (!g.over) {
    if (o.ability) put({ type: 'act', uid, ability: o.ability.id, target: o.target.uid })
    else {
      const x = untouchedOrder(g, u)
      if (x) put(x)
    }
  }
  if (alive(u)) u.acted = true
  return out
}

// A piece's orders as one decision: the tile it ends on and its act or fusion. `from`: the tile it stood on.
export function signature (orders, from) {
  let tile = from
  let act = ''
  for (const o of orders) {
    if (o.type === 'move') tile = o.tile
    else if (o.type === 'act') act = `a:${o.ability}:${o.target}`
  }
  return `${tile}|${act}`
}

// What the value after `rounds` reads of a board: the Monarch's HP, your pieces' HP and max, each standing foe's HP.
function tally (b) {
  const m = b.monarch
  let own = 0
  let ownMax = 0
  let foeMax = 0
  const foes = new Map()
  for (const u of b.units) {
    if (!alive(u)) continue
    if (u.side === 'foe') {
      foes.set(u.uid, u.hp)
      foeMax += u.maxHp
    } else if (u !== m && !u.shadow) {
      own += u.hp
      ownMax += u.maxHp
    }
  }
  return { m: m ? Math.max(0, m.hp) : 0, mMax: m ? m.maxHp : 1, own, ownMax, foes, foeMax }
}

// The playout value of board `g` against `before` (tally of the board the piece decided on), by `w`. → { value, parts }
export function valueOf (before, g, w = WEIGHTS) {
  const after = tally(g)
  let foeLeft = 0
  for (const uid of before.foes.keys()) {
    const x = g.byUid.get(uid)
    foeLeft += x ? Math.max(0, x.hp) : 0
  }
  let foeHad = 0
  for (const hp of before.foes.values()) foeHad += hp
  const parts = {
    monarch: (before.m - after.m) / before.mMax,
    own: before.ownMax > 0 ? (before.own - after.own) / before.ownMax : 0,
    foe: before.foeMax > 0 ? (foeHad - foeLeft) / before.foeMax : 0,
    lost: g.over && g.winner !== 'party' ? 1 : 0,
    won: g.over && g.winner === 'party' ? 1 : 0
  }
  const value = -w.monarch * parts.monarch - w.own * parts.own + w.foe * parts.foe - w.lost * parts.lost + w.won * parts.won
  return { value: r6(value), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r6(v)])) }
}

// What the value to the end reads of a board: the Monarch's HP share, each soul's HP and max (no shadow), the round.
export function endTally (b) {
  const m = b.monarch
  const souls = new Map()
  let max = 0
  for (const u of b.units) {
    if (!alive(u) || u.side !== 'party' || u === m || u.shadow) continue
    souls.set(u.uid, { hp: u.hp, maxHp: u.maxHp })
    max += u.maxHp
  }
  return { m: m ? Math.max(0, m.hp) / m.maxHp : 0, souls, max, turn: b.turn }
}

// The label to the battle's end of played-out `g` against `before` (endTally): monarch the share of its max HP lost, as
// the run carries it; own the souls' share lost in the battle (the run heals it back: the margin is the label's, a
// fallen soul all of its share). `stall`: the playout ran out of rounds.
export function endValue (before, g, w = END_WEIGHTS, stall = false) {
  const won = g.over && g.winner === 'party'
  const m = g.monarch
  const mAfter = m && m.hp > 0 ? m.hp / m.maxHp : 0
  let had = 0
  let kept = 0
  let fell = 0
  let fallen = 0
  for (const [uid, s] of before.souls) {
    had += s.hp
    const x = g.byUid.get(uid)
    if (x && !alive(x)) {
      fell++
      fallen += s.maxHp - s.hp
    }
  }
  for (const u of g.units) if (alive(u) && u.side === 'party' && u !== m && !u.shadow) kept += u.hp
  const parts = {
    lost: won ? 0 : 1,
    stall: stall ? 1 : 0,
    monarch: won ? before.m - mAfter : 0,
    own: won && before.max > 0 ? (had - kept + fallen) / before.max : 0,
    fell,
    turns: g.turn - before.turn
  }
  const value = won ? -w.monarch * parts.monarch - w.own * parts.own - w.turn * parts.turns : -w.lost
  return { value: r6(value), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r6(v)])) }
}

// One option played out: given on a copy of `board`, then turn after turn by `turn` to the battle's end (at most `turns`
// rounds) or for `rounds` End Turns. `seen`: the signatures played (a repeat → null). → { legal, sig, orders, value, parts }
export function playout (board, uid, o, { rounds = DEFAULTS.rounds, turns = DEFAULTS.turns, weights = null, before = null, seen = null, turn = P.expertTurn } = {}) {
  const end = !(rounds > 0)
  before ??= end ? endTally(board) : tally(board)
  const g = fork(board)
  let sig
  let orders
  try {
    orders = give(g, uid, o)
    sig = signature(orders, board.byUid.get(uid).tile)
  } catch {
    return { legal: false }
  }
  if (seen) {
    if (seen.has(sig)) return null
    seen.add(sig)
  }
  for (let r = 0; (end ? r <= turns : r < rounds) && !g.over; r++) {
    for (const x of turn(g)) {
      if (g.over || x.type === 'end') break
      try {
        order(g, x)
      } catch {
        break
      }
    }
    if (!g.over) order(g, { type: 'end' })
  }
  if (end) return { legal: true, sig, orders, ...endValue(before, g, weights ?? END_WEIGHTS, !g.over) }
  return { legal: true, sig, orders, ...valueOf(before, g, weights ?? WEIGHTS) }
}

// A named vector with its zeros left out, rounded.
const sparse = (v) => {
  const out = {}
  for (const k in v) {
    const x = typeof v[k] === 'boolean' ? +v[k] : v[k]
    if (typeof x === 'number' && x !== 0 && Number.isFinite(x)) out[k] = r6(x)
  }
  return out
}

// Piece `uid`'s decision on `board` (a copy as it decided) read: its conditions and options. → { u, cond, short, all }
export function readDecision (board, uid, cap) {
  const u = board.byUid.get(uid)
  const sit = P.situation(board)
  sit.plan = readPlan(board, sit)
  const cond = P.conditions(sit, u)
  return { u, cond, ...optionsAt(board, u, sit, cap, cond) }
}

// The turn a smoothed playout continues by: the expert's, exploring with the rng of position `key`, option `i`, playout `j`.
function perturbed (c, key, i, j) {
  const explore = { rng: createRng(`smooth|${key}|${i}|${j}`), epsilon: c.epsilon, top: c.top, weigh: true }
  return (g) => P.expertTurn(g, { explore })
}

// Playouts `ps` of one option as one label: their mean value, each one's, and each part's mean.
function averaged (ps) {
  const parts = {}
  for (const k in ps[0].parts) parts[k] = r6(ps.reduce((t, p) => t + p.parts[k], 0) / ps.length)
  const values = ps.map((p) => p.value)
  return { value: r6(values.reduce((t, v) => t + v, 0) / ps.length), values, parts }
}

// Each option of decision `read` played out (smoothed where `c.smooth` > 1), the expert's `chosen` added where the
// shortlist lacks it. → { rows, plays (each row's option and orders), at (the chosen's index), best }
export function labelled (board, uid, chosen, c, read = readDecision(board, uid, c.cap)) {
  const { short, all } = read
  const before = c.rounds > 0 ? tally(board) : endTally(board)
  const seen = new Set()
  const rows = []
  const plays = []
  const how = { rounds: c.rounds, turns: c.turns, weights: weightsOf(c), before }
  const label = (o, added) => {
    const p = playout(board, uid, o, { ...how, seen })
    if (p === null) return null
    const i = rows.length
    const k = p.legal ? Math.max(1, Math.floor(c.smooth ?? 1)) : 1
    const more = Array.from({ length: k - 1 }, (_, j) => playout(board, uid, o, { ...how, turn: perturbed(c, c.key ?? '', i, j + 1) }))
    const m = more.length ? averaged([p, ...more]) : null
    const row = {
      i, tile: o.tile, steps: o.path.length, ability: o.ability?.id ?? null, target: o.target?.uid ?? null,
      f: sparse(o.v), prior: r6(o.prior ?? 0), kept: o.kept === false ? 0 : 1, legal: p.legal ? 1 : 0, chosen: p.legal && p.sig === chosen ? 1 : 0, added: added ? 1 : 0,
      value: p.legal ? (m ? m.value : p.value) : null, ...(m && { values: m.values }), parts: p.legal ? (m ? m.parts : p.parts) : null
    }
    rows.push(row)
    plays.push({ o, orders: p.legal ? p.orders : null })
    return row
  }
  for (const o of short) label(o, false)
  let at = rows.findIndex((r) => r.chosen)
  if (at < 0 && chosen) {
    const o = fromSignature(all, chosen)
    if (o) {
      const row = label(o, true)
      at = row ? row.i : rows.findIndex((r) => r.chosen)
    }
  }
  return { rows, plays, at, best: bestOf(rows, plays.map((x) => x.o)) }
}

// One position labelled; `cfg.key`, the position's id, seeds its smoothed playouts. → { uid, kind, sit, options, chosen, best }
export function labelPosition (board, uid, chosen = null, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg }
  const read = readDecision(board, uid, c.cap)
  const { rows, at, best } = labelled(board, uid, chosen, c, read)
  return { uid, kind: read.u.id, sit: sparse(read.cond), options: rows, chosen: at, best }
}

// The teacher's pick of played-out `rows`: the best value of the legal, ties by policy.js better's order. → its index or −1
export function bestOf (rows, opts) {
  let best = -1
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].legal) continue
    if (best < 0) best = i
    else if (Math.abs(rows[i].value - rows[best].value) > EPS ? rows[i].value > rows[best].value : expertOrder(opts[i], opts[best]) < 0) best = i
  }
  return best
}

function fromSignature (opts, sig) {
  const [tile, act] = sig.split('|')
  const t = Number(tile)
  return opts.find((o) => o.tile === t && (o.ability ? `a:${o.ability.id}:${o.target.uid}` : '') === act) ??
    // A stay or a move whose End-Turn act is the act: the option that only moves there.
    opts.find((o) => o.tile === t && !o.ability) ?? null
}

// ── positions from runs ──────────────────────────────────────────────────────────────────────────

// Installs for the thread `c.expert` (a configuration's file) and `c.forest` (a forest, its file, or null) where named.
export function install (c) {
  if (c.expert) E.useExpert(JSON.parse(fs.readFileSync(c.expert, 'utf8')))
  if (c.forest !== undefined) useForest(modelOf(c.forest))
}
// A configuration or its file (a forest's), null for none.
const modelOf = (r) => (typeof r === 'string' ? JSON.parse(fs.readFileSync(r, 'utf8')) : r ?? null)

const draw = (seed, battle, seq) => parseInt(hashString(`teach|${seed}|${battle}|${seq}`).slice(0, 8), 16) / 2 ** 32

// A decision's danger: its battle's `group` (null: the board alone), else 'reach' (the Monarch in reach or line), else 'calm'.
function dangerOf (b, group) {
  if (group === 2) return 'lost'
  if (group === 1) return 'near'
  const sit = P.situation(b, { lean: true })
  const reach = !!sit.monarch && sit.monarch.danger > 0
  const line = (b.plan?.turn === b.turn ? b.plan.shooters?.length : 0) > 0
  return reach || line ? 'reach' : 'calm'
}

// A decision's danger by `cfg.draw` and its chance to be labelled, times its floor's `cfg.keepFloor`, at most 1.
export function drawOf (b, group, cfg = {}, floor = null) {
  const how = cfg.draw ?? DEFAULTS.draw
  if (!DRAWS.includes(how)) throw new Error(`no draw "${how}": ${DRAWS.join(', ')}`)
  const danger = dangerOf(b, how === 'state' ? null : group)
  const keep = { ...KEEP, ...cfg.keep }[danger] * (cfg.keepFloor?.[floor] ?? 1)
  return { danger, keep: Math.min(1, keep) }
}

// One expert run played live, its kept decisions labelled (`battles`, `limit`: stop early). → its runs.jsonl line, `positions`
export function teachRun (seed, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg, keep: { ...KEEP, ...cfg.keep } }
  install(c)
  const t0 = performance.now()
  let labelMs = 0
  const run = createRun({ seed, ascension: c.ascension ?? 0, ...asMonarch(c.monarch) })
  const rng = createRng(run.state.seed).stream('autoplay')
  const positions = []
  let decisions = 0
  let battles = -1
  let cur = null
  const share = (b) => Math.max(0, b.monarch.hp) / b.monarch.maxHp
  const close = () => {
    const b = cur.b
    const won = b.winner === 'party'
    const shares = [...cur.shares, share(b)]
    const least = Math.min(...shares)
    const group = !won ? 2 : least <= NEAR.share || shares[0] - least >= NEAR.drop ? 1 : 0
    for (const p of cur.points) {
      decisions++
      if (c.limit && positions.length >= c.limit) break
      const { danger, keep } = drawOf(p.board, group, c, cur.floor)
      if (!(draw(seed, cur.no, p.seq) < keep)) continue
      const t = performance.now()
      const id = `${seed}:${cur.no}:${p.turn}:${p.uid}`
      const L = labelPosition(p.board, p.uid, signature(p.orders, p.tile), c.smooth > 1 ? { ...c, key: id } : c)
      labelMs += performance.now() - t
      positions.push({
        id, seed, run: seedNo(seed), split: seedNo(seed) % 5 === 0 ? 'held' : 'train', floor: cur.floor, room: cur.room,
        battle: cur.no, turn: p.turn, at: p.at, group, danger, wt: r6(1 / keep), ...L
      })
    }
    cur = null
  }
  for (let guard = 0; run.state.phase !== 'over'; guard++) {
    if (guard > 1e6) throw new Error(`${seed}: stuck`)
    const action = policy(run, rng, 'expert')
    const b = run.state.phase === 'battle' ? run.battle : null
    if (b) {
      if (!cur || cur.b !== b) cur = { b, no: ++battles, floor: run.state.floor, room: currentNode(run)?.type ?? null, points: [], shares: [], last: -1, open: null, decided: null }
      if (b.turn !== cur.last) {
        cur.last = b.turn
        cur.shares.push(share(b))
        cur.decided = new Set()
      }
      if (action.type === 'move' || action.type === 'act') {
        if (cur.open?.uid === action.uid) cur.open.orders.push(action)
        else {
          cur.open = null
          // A piece's decision is its orders together; one it gives again later in the turn is not another.
          if (!cur.decided.has(action.uid)) {
            cur.decided.add(action.uid)
            cur.open = { uid: action.uid, turn: b.turn, seq: cur.points.length, at: run.state.log.length, board: fork(b), tile: b.byUid.get(action.uid).tile, orders: [action] }
            cur.points.push(cur.open)
          }
        }
      } else cur.open = null
    }
    apply(run, action)
    if (b && b.over && cur) {
      close()
      if (c.battles && battles + 1 >= c.battles) break
      if (c.limit && positions.length >= c.limit) break
    }
  }
  return { seed, result: run.state.result ?? null, floor: run.state.floor, decisions, positions, ms: Math.round(performance.now() - t0), labelMs: Math.round(labelMs) }
}

// ── the afterstates ──────────────────────────────────────────────────────────────────────────────

// The afterstates of labelled `row` on `board` (the run replayed to it): each option's conditions given as play gives it,
// as they differ from the row's `sit` (forest.js afterDiff); null where not found. `same`: the replay is the run.
export function afterRow (board, row) {
  const u = board.byUid.get(row.uid)
  if (!u) return { same: false, a: row.options.map(() => null) }
  const sit = P.situation(board)
  sit.plan = readPlan(board, sit)
  const same = JSON.stringify(sparse(P.conditions(sit, u))) === JSON.stringify(row.sit)
  const key = (tile, ability, target) => `${tile}|${ability ?? ''}|${target ?? ''}`
  const live = new Map()
  for (const o of P.expertOptions(board, u)) {
    const k = key(o.tile, o.ability?.id, o.target?.uid)
    if (!live.has(k)) live.set(k, o)
  }
  const a = row.options.map((r) => {
    const o = live.get(key(r.tile, r.ability, r.target))
    const after = o ? P.afterOf(board, u, o, sit.plan) : null
    return after ? afterDiff(after, row.sit) : null
  })
  return { same, a }
}

// A worker's job { seed, positions }: the run replayed as teachRun plays it, each position's afterRow read at its `at`.
export function augmentRun ({ seed, positions }, cfg = {}) {
  install(cfg)
  const run = createRun({ seed, ascension: cfg.ascension ?? 0, ...asMonarch(cfg.monarch) })
  const rng = createRng(run.state.seed).stream('autoplay')
  const todo = positions.slice().sort((x, y) => x.at - y.at)
  const rows = []
  let k = 0
  for (let guard = 0; run.state.phase !== 'over' && k < todo.length; guard++) {
    if (guard > 1e6) throw new Error(`${seed}: stuck`)
    const action = policy(run, rng, 'expert')
    while (k < todo.length && todo[k].at < run.state.log.length) rows.push({ id: todo[k++].id, missed: true })
    while (k < todo.length && todo[k].at === run.state.log.length && run.state.phase === 'battle') rows.push({ id: todo[k].id, ...afterRow(fork(run.battle), todo[k++]) })
    apply(run, action)
  }
  while (k < todo.length) rows.push({ id: todo[k++].id, missed: true })
  return { seed, rows }
}

// --augment: after.jsonl (a line a position: { id, a }) and after.json { made, conditions, forest, expert, positions,
// same, missed, differ, seconds }, replayed with the expert and forest the manifest names, or `--forest`'s.
async function augmentMain (dir, arg, workers) {
  const t0 = performance.now()
  const mf = path.join(dir, 'manifest.json')
  if (!fs.existsSync(mf) && arg('forest', null) === null) throw new Error(`${dir} has no manifest.json: give --forest <file|none>`)
  const manifest = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : {}
  if (manifest.ranker?.name) throw new Error(`${dir} was played with ranker ${manifest.ranker.name}, which is gone`)
  const givenForest = arg('forest', null)
  const named = manifest.settings?.forest
  const forestFile = givenForest !== null ? (givenForest === 'none' ? null : path.resolve(givenForest)) : named?.file ?? null
  if (givenForest === null && named && !named.file && manifest.forest?.name) throw new Error(`${dir} was played with forest ${manifest.forest.name}, its file unnamed: give --forest <file>`)
  const forest = forestFile ? JSON.parse(fs.readFileSync(forestFile, 'utf8')) : null
  const cfg = {
    forest, ...(manifest.settings?.expert && { expert: manifest.settings.expert }), ...(manifest.settings?.ascension && { ascension: manifest.settings.ascension }),
    ...asMonarch(manifest.settings?.monarch)
  }
  const labels = path.join(dir, 'labels.jsonl')
  const bySeed = new Map()
  const order = []
  for (const line of fs.readFileSync(labels, 'utf8').split('\n')) {
    if (!line) continue
    const r = JSON.parse(line)
    order.push(r.id)
    if (!bySeed.has(r.seed)) bySeed.set(r.seed, [])
    bySeed.get(r.seed).push({ id: r.id, at: r.at, uid: r.uid, sit: r.sit, options: r.options.map((o) => ({ i: o.i, tile: o.tile, ability: o.ability, target: o.target })) })
  }
  console.log(`augmenting ${order.length} positions of ${bySeed.size} runs in ${dir} on ${workers} workers (forest ${forest?.name ?? 'none'})`)
  const got = new Map()
  let n = 0
  await pool([...bySeed].map(([seed, positions]) => ({ seed, positions })), workers, cfg, (r) => {
    for (const x of r.rows) got.set(x.id, x)
    if (++n % Math.max(1, Math.round(bySeed.size / 10)) === 0) console.log(`  ${n}/${bySeed.size} runs, ${((performance.now() - t0) / 1000).toFixed(0)} s`)
  }, 'augment')
  const out = fs.createWriteStream(path.join(dir, 'after.jsonl'))
  let same = 0
  let missed = 0
  const differ = []
  for (const id of order) {
    const x = got.get(id) ?? { missed: true }
    if (x.missed) missed++
    else if (x.same) same++
    else if (differ.length < 10) differ.push(id)
    out.write(JSON.stringify({ id, a: x.missed ? null : x.a }) + '\n')
  }
  await new Promise((resolve) => out.end(resolve))
  const info = {
    made: new Date().toISOString(), conditions: afterNames(), forest: forest && { file: forestFile, name: forest.name ?? null }, expert: manifest.settings?.expert ?? null,
    positions: order.length, same, missed, differ, seconds: +((performance.now() - t0) / 1000).toFixed(1)
  }
  fs.writeFileSync(path.join(dir, 'after.json'), JSON.stringify(info, null, 1) + '\n')
  console.log(`wrote ${path.join(dir, 'after.jsonl')}: ${same} of ${order.length} positions replayed to the board they were labelled on, ${missed} missed (${info.seconds} s)`)
}

// ── reading the labels ───────────────────────────────────────────────────────────────────────────

// The option features' and conditions' names: the code's own in its order, then any other the rows carry, sorted.
export function names (positions = NONE) {
  const seen = (key) => [...new Set(positions.flatMap(key))].sort()
  const own = (list, extra) => [...list, ...extra.filter((k) => !list.includes(k))]
  const piece = { uid: -1, hp: 1, maxHp: 1, move: 0 }
  return {
    features: own(P.OPTION_FEATURES ?? NONE, seen((p) => p.options.flatMap((o) => Object.keys(o.f)))),
    conditions: own(Object.keys(P.conditions({}, piece)), seen((p) => Object.keys(p.sit)))
  }
}

// The labels in `dir`, sorted by run, battle and place; `flat` adds arrays for a fitter: { features, conditions,
// X (rows × features), S (positions × conditions), rows: { pos, value, chosen, legal, kept, prior } }, a row an option.
export function loadLabels (dir, { flat = false } = {}) {
  const text = fs.readFileSync(path.join(dir, 'labels.jsonl'), 'utf8')
  const positions = text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  positions.sort((a, b) => a.run - b.run || String(a.seed).localeCompare(String(b.seed)) || a.battle - b.battle || a.at - b.at)
  if (!flat) return { positions }
  const file = path.join(dir, 'manifest.json')
  const had = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  const all = names(positions)
  const fNames = had ? [...had.features, ...all.features.filter((k) => !had.features.includes(k))] : all.features
  const sNames = had ? [...had.conditions, ...all.conditions.filter((k) => !had.conditions.includes(k))] : all.conditions
  const n = positions.reduce((k, p) => k + p.options.length, 0)
  const X = new Float32Array(n * fNames.length)
  const S = new Float32Array(positions.length * sNames.length)
  const rows = { pos: new Int32Array(n), value: new Float32Array(n), chosen: new Uint8Array(n), legal: new Uint8Array(n), kept: new Uint8Array(n), prior: new Float32Array(n) }
  const fi = new Map(fNames.map((k, i) => [k, i]))
  const si = new Map(sNames.map((k, i) => [k, i]))
  let r = 0
  positions.forEach((p, j) => {
    for (const k in p.sit) S[j * sNames.length + si.get(k)] = p.sit[k]
    for (const o of p.options) {
      for (const k in o.f) X[r * fNames.length + fi.get(k)] = o.f[k]
      rows.pos[r] = j
      rows.value[r] = o.value ?? NaN
      rows.chosen[r] = o.chosen
      rows.legal[r] = o.legal
      rows.kept[r] = o.kept
      rows.prior[r] = o.prior
      r++
    }
  })
  return { positions, features: fNames, conditions: sNames, X, S, rows }
}

// How the expert's choices stand against the playouts, over all and by each of `by`: positions, options, decisive (the
// share where the values differ), agree (its choice a best), agreeDecisive, regret (the best value less the chosen's),
// regretDecisive, random (a random option's regret), spread (the best less the worst), scoreOnly (by the prior alone).
export function report (positions, by = { byFloor: 'floor', byDanger: 'danger', bySplit: 'split' }) {
  const stats = (list) => {
    let n = 0
    let opts = 0
    let decisive = 0
    let agree = 0
    let agreeD = 0
    let regret = 0
    let regretD = 0
    let random = 0
    let spread = 0
    let prior = 0
    for (const p of list) {
      const legal = p.options.filter((o) => o.legal)
      if (p.chosen < 0 || !legal.length) continue
      const vals = legal.map((o) => o.value)
      const top = Math.max(...vals)
      const low = Math.min(...vals)
      const mine = p.options[p.chosen].value
      const d = top - low > 1e-6
      const g = top - mine
      const ok = g <= 1e-6
      n++
      opts += legal.length
      if (d) decisive++
      if (ok) agree++
      if (d && ok) agreeD++
      regret += g
      if (d) regretD += g
      random += vals.reduce((k, v) => k + (top - v), 0) / vals.length
      spread += top - low
      const byPrior = legal.reduce((a, o) => (a === null || o.prior > a.prior ? o : a), null)
      if (top - byPrior.value <= 1e-6) prior++
    }
    const f = (x, k = n) => (k ? +(x / k).toFixed(4) : null)
    return { positions: n, options: f(opts), decisive: f(decisive), agree: f(agree), agreeDecisive: f(agreeD, decisive), regret: f(regret), regretDecisive: f(regretD, decisive), random: f(random), spread: f(spread), scoreOnly: f(prior) }
  }
  const group = (key) => {
    const groups = new Map()
    for (const p of positions) {
      const k = typeof key === 'function' ? key(p) : p[key]
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(p)
    }
    return Object.fromEntries([...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, list]) => [k, stats(list)]))
  }
  return { all: stats(positions), ...Object.fromEntries(Object.entries(by).map(([name, key]) => [name, group(key)])) }
}

// ── the teacher ──────────────────────────────────────────────────────────────────────────────────

// The labeller as a player: each battle decision the playout-best of the piece's options (the expert's own choice among
// them), the pieces in the order the expert would order them; out of battle the expert decides.
// --teacher runs.jsonl, a line a run: { seed, player ('teacher' or 'expert'), result, floor, progress, battles: { won,
//   fought }, ms, and the teacher's decisions, playouts, single (decisions of one option), decisionMs };
//   manifest.json { made, settings, expert, forest, counts, wall, workers }; report.json pairedReport's.

// A copy of board `b` with the pieces in `done` marked done (acted), as the labeller's playout marks the piece it gives.
export function marked (b, done) {
  const g = fork(b)
  for (const uid of done) {
    const x = g.byUid.get(uid)
    if (x && alive(x)) x.acted = true
  }
  return g
}

// The piece the expert would order next on `b` and the orders its turn gives it. → { uid (null: End Turn), orders }
function nextPiece (b) {
  let uid = null
  const turn = P.expertTurn(b, { note: (r) => { if (uid === null && r.decision === 'battle') uid = r.uid } })
  const orders = []
  if (uid !== null) {
    for (const x of turn) {
      if (x.type === 'end' || x.uid !== uid) break
      orders.push(x)
    }
  }
  return { uid, orders }
}

// The teacher's decision for piece `uid`: the playout-best of the labeller's options; a lone option taken unplayed.
export function teacherPick (board, uid, chosen = null, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg }
  const read = readDecision(board, uid, c.cap)
  if (read.all.length === 1) {
    const o = read.all[0]
    let orders = NONE
    try {
      orders = give(fork(board), uid, o)
    } catch {}
    return { option: o, orders, playouts: 0, value: null }
  }
  const L = labelled(board, uid, chosen, c, read)
  if (L.best < 0) return { option: null, orders: NONE, playouts: L.rows.length, value: null }
  return { option: L.plays[L.best].o, orders: L.plays[L.best].orders, playouts: L.rows.length, value: L.rows[L.best].value }
}

// The teacher's turn on `battle`; `count` adds up its decisions, playouts, single and ms. → its orders, End Turn last
export function teacherTurn (battle, cfg = {}, count = null) {
  if (battle.over || battle.phase !== 'orders') return []
  const c = { ...DEFAULTS, ...cfg }
  const done = new Set()
  const out = []
  // The first read on the board itself, so the turn's plan is kept on it as the expert's turn keeps it; the rest on a copy.
  let next = nextPiece(battle)
  const f = fork(battle)
  const put = (x) => {
    order(f, x)
    out.push(x)
  }
  while (!f.over && next.uid !== null) {
    const u = f.byUid.get(next.uid)
    const t = performance.now()
    const pick = teacherPick(marked(f, done), u.uid, signature(next.orders, u.tile), c)
    // Given on a copy that differs only in the pieces marked done; an order that does not stand here is dropped.
    for (const x of pick.orders) {
      if (f.over) break
      try {
        put(x)
      } catch {
        break
      }
    }
    done.add(u.uid)
    if (count) {
      count.decisions++
      count.playouts += pick.playouts
      if (!pick.playouts) count.single++
      count.ms += performance.now() - t
    }
    if (!f.over) next = nextPiece(marked(f, done))
  }
  if (f.over) return out
  for (const x of P.untouchedOrders(fork(f))) put(x)
  if (!f.over) out.push({ type: 'end' })
  return out
}

// A battle's tally for a run's line: won, and where the run fell in it (progressOf's rank and share).
export function closeOf (run) {
  const b = run.battle
  return b.winner === 'party' ? { won: true, fell: null } : { won: false, fell: { rank: currentNode(run)?.rank ?? 1, share: foeShare(b) } }
}

// One run by the teacher; `battles` and `fights` stop it early, `log` adds the run's log. → its runs.jsonl line
export function teacherRun (seed, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg }
  install(c)
  const t0 = performance.now()
  const run = ablatedRun(seed, null, null, { ascension: c.ascension ?? 0, ...asMonarch(c.monarch) })
  const rng = createRng(run.state.seed).stream('autoplay')
  const count = { decisions: 0, playouts: 0, single: 0, ms: 0 }
  let won = 0
  let fought = 0
  let fights = 0
  let fell = null
  let queue = null
  for (let guard = 0; run.state.phase !== 'over'; guard++) {
    if (guard > 1e6) throw new Error(`${seed}: stuck`)
    const was = run.state.phase
    let action
    if (was === 'battle') {
      const b = run.battle
      if (stalled(b)) action = { type: 'stall' }
      else {
        if (!queue || queue.b !== b || queue.turn !== b.turn || !queue.orders.length) queue = { b, turn: b.turn, orders: teacherTurn(b, c, count) }
        action = queue.orders.shift()
      }
    } else action = policy(run, rng, 'expert')
    apply(run, action)
    // A battle is over once the phase leaves it, after an order or the fight that opened it.
    if (run.state.phase !== 'battle' && (action.type === 'fight' || was === 'battle')) {
      const x = closeOf(run)
      fought++
      if (x.won) won++
      else fell = x.fell
      if (c.battles && fought >= c.battles) break
    }
    if (action.type === 'fight' && c.fights && ++fights >= c.fights) break
  }
  const s = run.state
  return {
    seed, player: 'teacher', result: s.result ?? null, floor: s.floor,
    progress: progressOf({ result: s.result, floor: s.floor, rank: fell?.rank ?? 1, share: fell?.share ?? 0 }),
    battles: { won, fought }, ms: Math.round(performance.now() - t0),
    decisions: count.decisions, playouts: count.playouts, single: count.single, decisionMs: Math.round(count.ms),
    ...(c.log && { log: s.log })
  }
}

// One run of today's expert (autoplay.js record), as the teacher's runs.jsonl line.
export function expertRun (seed, cfg = {}) {
  install(cfg)
  const t0 = performance.now()
  const r = record({ seed, level: 'expert', ascension: cfg.ascension ?? 0, ...asMonarch(cfg.monarch) })
  return {
    seed, player: 'expert', result: r.result ?? null, floor: r.floor, progress: r.progress,
    battles: { won: r.battles.filter((b) => b.won).length, fought: r.battles.length }, ms: Math.round(performance.now() - t0)
  }
}

// The teacher against the expert, paired by seed over runs.jsonl's `lines`. → { n, teacher, expert, clears: { gained,
// lost }, progress: { diff, se } (the paired difference ± one standard error), cost }
export function pairedReport (lines) {
  const by = new Map()
  for (const r of lines) {
    if (!by.has(r.seed)) by.set(r.seed, {})
    by.get(r.seed)[r.player] = r
  }
  const pairs = [...by.values()].filter((p) => p.teacher && p.expert)
  const n = pairs.length
  const mean = (xs) => (xs.length ? xs.reduce((k, x) => k + x, 0) / xs.length : 0)
  const cleared = (r) => r.result === 'victory'
  const side = (k) => {
    const rs = pairs.map((p) => p[k])
    const won = rs.reduce((t, r) => t + r.battles.won, 0)
    const fought = rs.reduce((t, r) => t + r.battles.fought, 0)
    const deaths = {}
    for (const r of rs) if (!cleared(r)) deaths[r.floor] = (deaths[r.floor] ?? 0) + 1
    return {
      clears: rs.filter(cleared).length, rate: n ? +(rs.filter(cleared).length / n).toFixed(4) : null, progress: +mean(rs.map((r) => r.progress)).toFixed(4),
      battles: { won, fought, rate: fought ? +(won / fought).toFixed(4) : null }, deaths, msPerRun: Math.round(mean(rs.map((r) => r.ms)))
    }
  }
  const d = pairs.map((p) => p.teacher.progress - p.expert.progress)
  const dm = mean(d)
  const se = n > 1 ? Math.sqrt(d.reduce((t, x) => t + (x - dm) ** 2, 0) / (n - 1) / n) : 0
  const T = pairs.map((p) => p.teacher)
  const decisions = T.reduce((t, r) => t + r.decisions, 0)
  return {
    n, teacher: side('teacher'), expert: side('expert'),
    clears: { gained: pairs.filter((p) => cleared(p.teacher) && !cleared(p.expert)).length, lost: pairs.filter((p) => !cleared(p.teacher) && cleared(p.expert)).length },
    progress: { diff: +dm.toFixed(4), se: +se.toFixed(4) },
    cost: {
      decisionsPerRun: Math.round(decisions / Math.max(1, n)), playoutsPerDecision: +(T.reduce((t, r) => t + r.playouts, 0) / Math.max(1, decisions)).toFixed(2),
      single: +(T.reduce((t, r) => t + r.single, 0) / Math.max(1, decisions)).toFixed(4), msPerDecision: +(T.reduce((t, r) => t + r.decisionMs, 0) / Math.max(1, decisions)).toFixed(1)
    }
  }
}

// pairedReport's in lines, for the console.
export const pc = (x) => (x === null ? '-' : `${(100 * x).toFixed(1)}%`)
const deathsText = (x) => Object.entries(x).map(([k, v]) => `floor ${k} ${v}`).join(', ') || 'none'
export function pairedLines (rep, { who = 'the teacher', vs = "today's expert", a = 'teacher', b = "today's", more = `${pc(rep.cost.single)} of one option` } = {}) {
  const { teacher: t, expert: e } = rep
  return [
    `${who} against ${vs}, ${rep.n} seeds paired:`,
    `  clears          ${a} ${t.clears}/${rep.n} (${pc(t.rate)}), ${b} ${e.clears}/${rep.n} (${pc(e.rate)}); ${who} cleared ${rep.clears.gained} ${b} lost, lost ${rep.clears.lost} ${b} cleared`,
    `  progress        ${a} ${t.progress.toFixed(4)}, ${b} ${e.progress.toFixed(4)}; difference ${rep.progress.diff >= 0 ? '+' : ''}${rep.progress.diff.toFixed(4)} ± ${rep.progress.se.toFixed(4)} (one standard error, paired)`,
    `  battles won     ${a} ${t.battles.won}/${t.battles.fought} (${pc(t.battles.rate)}), ${b} ${e.battles.won}/${e.battles.fought} (${pc(e.battles.rate)})`,
    `  deaths by floor ${a} ${deathsText(t.deaths)}; ${b} ${deathsText(e.deaths)}`,
    `  time a run      ${a} ${(t.msPerRun / 1000).toFixed(1)} s (${rep.cost.decisionsPerRun} decisions, ${rep.cost.playoutsPerDecision} playouts and ${rep.cost.msPerDecision} ms a decision, ${more}), ${b} ${(e.msPerRun / 1000).toFixed(1)} s`
  ]
}

// ── the route ────────────────────────────────────────────────────────────────────────────────────

// Room choices labelled as the battle's options are: each map decision of an expert run with more than one room open,
// kept by a draw (ROUTE_KEEP, by floor and an open elite), each open room played out by the expert on a copy of the run
// to the run's end (`rooms` 0) or until `rooms` rooms are done; to the end, the chosen room's playout is the run's own rest.
// value to the end (ROUTE_END_WEIGHTS) = −lost·lost + Σ w·part over rooms, floors, monarch, own, souls, won
// value over a window (ROUTE_WEIGHTS) = −lost·lost − monarch·monarch − own·own + Σ w·part over essence, cleared, power, purse
// labels.jsonl, a line a choice: { id, seed, run, split, floor, rank, elite, wt, sit (routeConditions), options, chosen,
//   best, hand (the hand-built route's room) }; an option: { i, id, type, f (routeFeatures), prior, legal, chosen,
//   value, parts, rooms, and to the end share (the run's progress at its end) and end (its floor) }
// Beside it runs.jsonl, report.json, manifest.json, and the route and expert that play (route-policy.json, expert.json).
export const ROUTE_WEIGHTS = Object.freeze({ lost: 10, monarch: 3, own: 1, essence: 1, cleared: 1, power: 0, purse: 0 })
export const ROUTE_END_WEIGHTS = Object.freeze({ lost: 10, rooms: 1, floors: 1, monarch: 1, own: 1, souls: 0, won: 0 })
const ROUTE_KEEP = Object.freeze({ early: 1, earlyCalm: 0.6, late: 0.6, lateCalm: 0.25 })
const ROUTE_DEFAULTS = Object.freeze({ rooms: 0, weights: null, keep: ROUTE_KEEP, reuse: true })
const routeWeightsOf = (c) => c.weights ?? (c.rooms > 0 ? ROUTE_WEIGHTS : ROUTE_END_WEIGHTS)

// What the route's value reads of a run: floor, the HP shares, essence, purse, log strength, and on the map its progress.
function runTally (run) {
  const s = run.state
  const m = monarchOf(s)
  let hp = 0
  let max = 0
  for (const u of souls(s.party)) {
    hp += Math.max(0, u.hp)
    max += u.maxHp
  }
  const share = s.phase === 'map' ? progressOf({ result: null, floor: s.floor, rank: (currentNode(run)?.rank ?? 0) + 1 }) : null
  return { floor: s.floor, m: Math.max(0, m.hp) / m.maxHp, own: max ? hp / max : 0, essence: s.stats.essence, purse: s.essence, power: Math.log(survey(run).strength), share }
}

// The route's window value of `run` against `before` (runTally at the choice), `cleared` the rooms done. → { value, parts }
export function routeValue (before, run, cleared, w = ROUTE_WEIGHTS) {
  const after = runTally(run)
  const scale = tierScale(before.floor)
  const parts = {
    lost: run.state.death ? 1 : 0,
    monarch: before.m - after.m,
    own: before.own - after.own,
    essence: (after.essence - before.essence) / scale,
    cleared,
    power: after.power - before.power,
    purse: (after.purse - before.purse) / scale
  }
  return { value: r6(routeWindowOf(parts, w)), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r6(v)])) }
}
// A window label's value from its parts, by `w`.
const routeWindowOf = (p, w = ROUTE_WEIGHTS) => -w.lost * p.lost - w.monarch * p.monarch - w.own * p.own + w.essence * p.essence + w.cleared * p.cleared +
  (w.power ?? 0) * (p.power ?? 0) + (w.purse ?? 0) * (p.purse ?? 0)
// A label to the end's value from its parts, by `w`.
export const routeEndOf = (p, w = ROUTE_END_WEIGHTS) => -w.lost * p.lost + w.rooms * p.rooms + w.floors * p.floors + w.monarch * p.monarch + w.own * p.own +
  w.souls * p.souls + w.won * p.won

// The route's value to the end of `run` (over) against `before` (runTally at the choice): lost 1 − the progress, the HP
// shares and souls at the end (none from a lost run). → { value, parts, share (the progress at the end), floor }
export function routeEndValue (before, run, w = ROUTE_END_WEIGHTS) {
  const s = run.state
  if (s.phase !== 'over') throw new Error(`${s.seed}: a route's value to the end, the run not over`)
  const won = s.result === 'victory'
  const b = run.battle
  const fell = !won && b ? { rank: currentNode(run)?.rank ?? 1, share: foeShare(b) } : null
  const share = progressOf({ result: s.result, floor: s.floor, rank: fell?.rank ?? 1, share: fell?.share ?? 0 })
  const m = monarchOf(s)
  const all = souls(s.party)
  const up = all.filter((u) => u.hp > 0)
  const max = all.reduce((n, u) => n + u.maxHp, 0)
  const parts = {
    lost: won ? 0 : 1 - share,
    rooms: (share - before.share) * routeRooms(),
    floors: (won ? s.floor + 1 : s.floor) - before.floor,
    monarch: won ? Math.max(0, m.hp) / m.maxHp : 0,
    own: won && max ? up.reduce((n, u) => n + u.hp, 0) / max : 0,
    souls: won ? up.length : 0,
    won: won ? 1 : 0
  }
  return { value: r6(routeEndOf(parts, w)), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r6(v)])), share: r6(share), floor: s.floor }
}

// A room done: back on the map from a room's battle or Shop, or through an altar; or the run over, the Monarch standing.
const roomDone = (was, now, action, run) => (now === 'over' ? !run.state.death : now === 'map' && (was !== 'map' || action.type === 'node'))

// Room `id` played out by the expert on a copy of `run`, to the run's end (`rooms` 0) or `rooms` rooms.
// → { value, parts, rooms, floor, at, share (to the end) }
function playRoute (run, id, { rooms = ROUTE_DEFAULTS.rooms, weights = null, before = runTally(run) } = {}) {
  const w = weights ?? routeWeightsOf({ rooms })
  const r = copyRun(run)
  const rng = createRng(r.state.seed).stream('autoplay')
  let done = 0
  let action = { type: 'node', id }
  for (let guard = 0; ; guard++) {
    if (guard > 1e6) throw new Error(`${r.state.seed}: a route's playout is stuck`)
    const was = r.state.phase
    apply(r, action)
    const now = r.state.phase
    if (roomDone(was, now, action, r)) done++
    if (now === 'over' || (rooms > 0 && now === 'map' && done >= rooms && roomDone(was, now, action, r))) break
    action = policy(r, rng, 'expert')
  }
  if (rooms > 0) return { ...routeValue(before, r, done, w), rooms: done, floor: r.state.floor, at: r.state.at }
  return { ...routeEndValue(before, r, w), rooms: done, at: r.state.at }
}

// The room the hand-built route takes: TREES.route's rules, then TUNING.expert.route's weights. → its id
const handRoom = (sit) => E.decide(E.TREES.route, sit, sit.rooms.map((room) => ({ id: room.id, node: { type: room.type }, v: roomFeatures(sit, room) })), TUNING.expert.route).option?.id

// One room choice labelled (`chosen` the expert's room; `cfg.known` the rooms already played out, by id).
export function labelChoice (run, chosen = null, cfg = {}) {
  const c = { ...ROUTE_DEFAULTS, ...cfg }
  const w = routeWeightsOf(c)
  const sit = survey(run)
  const before = runTally(run)
  const cond = routeConditions(run, sit)
  const hand = handRoom(sit)
  const options = sit.rooms.map((room, i) => {
    const p = c.known?.[room.id] ?? playRoute(run, room.id, { rooms: c.rooms, weights: w, before })
    return {
      i, id: room.id, type: room.type, f: sparse(routeFeatures(run, sit, room)), prior: r6(E.value(roomFeatures(sit, room), TUNING.expert.route)),
      legal: 1, chosen: room.id === chosen ? 1 : 0, value: p.value, parts: p.parts, rooms: p.rooms, ...(p.share !== undefined && { share: p.share, end: p.floor })
    }
  })
  let best = -1
  for (const o of options) if (best < 0 || o.value > options[best].value + EPS) best = o.i
  return { elite: cond['open.elite'], sit: sparse(cond), options, chosen: options.findIndex((o) => o.chosen), best, hand: options.findIndex((o) => o.id === hand) }
}

const routeDraw = (seed, floor, rank) => parseInt(hashString(`route|${seed}|${floor}|${rank}`).slice(0, 8), 16) / 2 ** 32
const routeKeep = (keep, floor, elite) => (floor <= 2 ? (elite ? keep.early : keep.earlyCalm) : elite ? keep.late : keep.lateCalm)

// One expert run with `route` and `expert` installed, its kept room choices labelled. → its runs.jsonl line, `positions`
export function teachRoutes (seed, cfg = {}) {
  const c = { ...ROUTE_DEFAULTS, ...cfg, keep: { ...ROUTE_KEEP, ...cfg.keep } }
  const w = routeWeightsOf(c)
  const hadRoute = c.route !== undefined ? routeModel() : null
  const hadExpert = c.expert ? E.expertModel() : null
  if (c.route !== undefined) useRoute(c.route || false)
  if (c.expert) E.useExpert(c.expert)
  try {
    const t0 = performance.now()
    let labelMs = 0
    const run = createRun({ seed, ascension: c.ascension ?? 0, ...asMonarch(c.monarch) })
    const rng = createRng(run.state.seed).stream('autoplay')
    const positions = []
    const later = []
    let choices = 0
    let done = 0
    const place = (s, rank, keep) => ({ id: `${seed}:${s.floor}:${rank}`, seed, run: seedNo(seed), split: seedNo(seed) % 5 === 0 ? 'held' : 'train', floor: s.floor, rank, wt: r6(1 / keep) })
    for (let guard = 0; run.state.phase !== 'over'; guard++) {
      if (guard > 1e6) throw new Error(`${seed}: stuck`)
      const action = policy(run, rng, 'expert')
      if (action.type === 'node' && run.state.phase === 'map' && availableNodes(run).length > 1) {
        choices++
        const s = run.state
        const rank = currentNode(run).rank
        const elite = availableNodes(run).some((n) => n.type === 'elite')
        const keep = routeKeep(c.keep, s.floor, elite)
        if (routeDraw(seed, s.floor, rank) < keep && !(c.limit && positions.length + later.length >= c.limit)) {
          if (c.rooms > 0 || !c.reuse) {
            const t = performance.now()
            positions.push({ ...place(s, rank, keep), ...labelChoice(run, action.id, c) })
            labelMs += performance.now() - t
          } else later.push({ at: place(s, rank, keep), run: copyRun(run), chosen: action.id, done })
        }
      }
      const was = run.state.phase
      apply(run, action)
      if (roomDone(was, run.state.phase, action, run)) done++
    }
    for (const k of later) {
      const t = performance.now()
      const own = { ...routeEndValue(runTally(k.run), run, w), rooms: done - k.done }
      positions.push({ ...k.at, ...labelChoice(k.run, k.chosen, { ...c, known: { [k.chosen]: own } }) })
      labelMs += performance.now() - t
    }
    const end = routeEndValue(runTally(createRun({ seed, ascension: c.ascension ?? 0, ...asMonarch(c.monarch) })), run, w)
    return { seed, result: run.state.result ?? null, floor: run.state.floor, progress: end.share, choices, positions, ms: Math.round(performance.now() - t0), labelMs: Math.round(labelMs) }
  } finally {
    if (c.route !== undefined) useRoute(hadRoute ?? false)
    if (c.expert) E.useExpert(hadExpert)
  }
}

// The rooms of labelled choice `p` the hand-built route's rules leave: their indices, one where a rule forces it.
function handLeft (p) {
  const sit = { health: p.sit.health ?? 0, monarch: p.sit.monarch ?? 0, unhealed: !!p.sit.unhealed }
  let left = p.options.map((o) => ({ i: o.i, node: { type: o.type }, v: { odds: o.f.odds ?? 0 } }))
  for (const node of E.TREES.route) {
    if (!left.length || !node.when(sit)) continue
    if (node.force) {
      const o = node.force(left, sit)
      if (o) return [o.i]
    } else if (node.keep) {
      const ranks = left.map((o) => +node.keep(o, sit))
      const top = Math.max(...ranks)
      if (!ranks.every((r) => r === top)) left = left.filter((_, k) => ranks[k] === top)
    }
  }
  return left.map((o) => o.i)
}

// The room a route takes at labelled choice `p`: `model` a route tree (its leaf's weights, the hand-built rules first
// where it keeps them), 'hand' the hand-built route, 'chosen' the expert's room. → its index (−1 for none)
export function routePick (model, p) {
  if (model === 'chosen') return p.chosen
  if (model === 'hand' && p.hand !== undefined) return p.hand
  const left = model === 'hand' || model.hand ? new Set(handLeft(p)) : null
  const w = model === 'hand' ? null : E.leafOf(model, p.sit).w
  let best = -1
  let top = -Infinity
  for (const o of p.options) {
    if (left && !left.has(o.i)) continue
    let s = 0
    if (w) for (const k in o.f) s += (w[k] ?? 0) * o.f[k]
    else s = o.prior
    if (s > top) {
      top = s
      best = o.i
    }
  }
  return best
}

// How routes' picks ({ name: (choice) → its room's index }) agree with the labels: top-1, regret, how often the room's
// playout lost or took an elite or a Shop, and the regret less the first pick's (`vs`, paired) ± one standard error (`se`).
export function routeAgreement (positions, picks) {
  const names = Object.keys(picks)
  const at = positions.map((p) => {
    const best = Math.max(...p.options.map((o) => o.value))
    return Object.fromEntries(names.map((k) => {
      const o = p.options[picks[k](p)]
      return [k, o ? { regret: best - o.value, top: o.value >= best - 1e-6 * Math.max(1, Math.abs(best)), lost: o.parts.lost > 0, elite: o.type === 'elite', shop: o.type === 'shop' } : null]
    }))
  })
  const out = {}
  for (const k of names) {
    const mine = at.filter((x) => x[k])
    const n = mine.length
    const mean = (f) => (n ? +(mine.reduce((t, x) => t + f(x), 0) / n).toFixed(4) : null)
    const d = at.filter((x) => x[k] && x[names[0]]).map((x) => x[k].regret - x[names[0]].regret)
    const dm = d.length ? d.reduce((t, x) => t + x, 0) / d.length : 0
    const se = d.length > 1 ? Math.sqrt(d.reduce((t, x) => t + (x - dm) ** 2, 0) / (d.length - 1) / d.length) : 0
    out[k] = { n, top1: mean((x) => +x[k].top), regret: mean((x) => x[k].regret), lost: mean((x) => +x[k].lost), elite: mean((x) => +x[k].elite), shop: mean((x) => +x[k].shop), vs: +dm.toFixed(4), se: +se.toFixed(4) }
  }
  return out
}

// Fits the route's tree (fit.js fitExpert, listwise over each choice's rooms) to the labels in `dir`, from `prior` (the
// hand-built route's weights by default). `weights`: the values read again off their parts; `hand`: see --hand.
async function fitRoute (dir, { depth = 3, maxLeaves = 8, lambda = 3, tau = 0, minLeaf = 0, weighted = false, weights = null, hand = false, prior = null, structure = 'grow', log = null } = {}) {
  const F = await import('./fit.js')
  const { positions } = loadLabels(dir)
  const end = positions.some((p) => p.options.some((o) => o.parts.rooms !== undefined))
  const w = weights && (end ? { ...ROUTE_END_WEIGHTS, ...weights } : { ...ROUTE_WEIGHTS, ...weights })
  const again = (p) => (end ? routeEndOf(p, w) : routeWindowOf(p, w))
  // A row a room, as fit.js readRows expands a position.
  const rows = positions.flatMap((p) => {
    const left = hand ? new Set(handLeft(p)) : null
    return p.options.filter((o) => !left || left.has(o.i)).map((o) => ({
      pos: p.id, seed: p.seed, sit: p.sit, split: p.split, wt: p.wt, v: o.f, legal: o.legal, chosen: o.chosen, value: w ? again(o.parts) : o.value
    }))
  })
  const d = F.tabulate(rows, { features: ROUTE_FEATURES })
  const start = prior ?? { name: 'hand', tree: { leaf: 'hand', w: Object.fromEntries(ROUTE_FEATURES.map((k) => [k, TUNING.expert.route[k] ?? 0])) }, rules: [] }
  const { model, report } = F.fitExpert(d, { depth, maxLeaves, lambda, tau, minLeaf, weighted, prior: { ...start, rules: [] }, structure, options: 'all', log })
  const t = report.test
  const pc = (x) => `${(100 * x).toFixed(1)}%`
  const about = `the route, learned ${new Date().toISOString().slice(0, 10)} on ${d.n} room choices (labels ${end ? 'to the run\'s end' : 'over a window'})${hand ? ', the hand-built rules kept' : ''}${structure === 'prior' ? `, ${start.name}'s tree refitted` : ''}: held out top-1 ${pc(t.learned.top1)}, ` +
    `regret ${t.learned.regret.toFixed(3)} (the expert's choices ${pc(t.chosen.top1)}, ${t.chosen.regret.toFixed(3)}; the prior's weights alone ${pc(t.today.top1)}, ${t.today.regret.toFixed(3)}); ` +
    `tau ${+report.tau.toPrecision(3)}, lambda ${lambda}, depth ≤ ${depth}`
  const out = { name: 'route', about, ...(hand && { hand: true }), tree: model.tree, rules: [], fit: model.fit }
  return { model: E.checkModel(out), report, d }
}

// ── run directly ─────────────────────────────────────────────────────────────────────────────────

// What a worker plays for a job, by the pool's `mode`.
const JOBS = {
  battle: (seed, cfg) => teachRun(seed, cfg),
  route: (seed, cfg) => teachRoutes(seed, cfg),
  teacher: (job, cfg) => (job.player === 'teacher' ? teacherRun : expertRun)(job.seed, cfg),
  augment: (job, cfg) => augmentRun(job, cfg)
}

const pool = (jobs, workers, cfg, done, mode = 'battle') => workerPool(import.meta.url, { teach: true, cfg, mode }, jobs, workers, (_, out) => done(out))

// `--forest file.json|none` read: { config (undefined: the one forest.js holds; null: none), setting ({ file, name }) }
function forestArg (arg) {
  const f = arg('forest', null)
  if (f === null) return { config: undefined, setting: undefined }
  if (f === 'none') return { config: null, setting: null }
  const file = path.resolve(f)
  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  return { config, setting: { file, name: config?.name ?? null } }
}
// The forest a manifest names: its file (null where none was named) and the `name` of the one in use (null for none).
const forestIn = (fk) => ({ file: fk.setting?.file ?? null, name: forestModel()?.name ?? null })

const table = (rep) => {
  const line = (k, s) => `  ${String(k).padEnd(8)} ${String(s.positions).padStart(6)}  options ${s.options}  decisive ${s.decisive}  agree ${s.agree} (decisive ${s.agreeDecisive})  regret ${s.regret} (decisive ${s.regretDecisive})  random ${s.random}  spread ${s.spread}  score-only agree ${s.scoreOnly}`
  const groups = Object.entries(rep).filter(([k]) => k !== 'all')
  return [line('all', rep.all), ...groups.flatMap(([name, g]) => [`${name.replace(/^by/, 'by ').toLowerCase()}:`, ...Object.entries(g).map(([k, s]) => line(k, s))])].join('\n')
}

// The route labels' report: report's by floor, by an open elite and by split, the expert's losses, and routeAgreement.
function routeReport (positions, picks = null) {
  const rep = report(positions, { byFloor: 'floor', byElite: 'elite', byFloorElite: (p) => `${p.floor}${p.elite ? ' elite' : ''}`, bySplit: 'split' })
  const losses = (list) => {
    const mine = list.filter((p) => p.chosen >= 0)
    const ch = (p) => p.options[p.chosen]
    const n = mine.length
    const lost = mine.filter((p) => ch(p).parts.lost).length
    const avoidable = mine.filter((p) => ch(p).parts.lost && p.options.some((o) => !o.parts.lost)).length
    const elite = mine.filter((p) => ch(p).type === 'elite').length
    const eliteLost = mine.filter((p) => ch(p).type === 'elite' && ch(p).parts.lost).length
    const f = (x) => (n ? +(x / n).toFixed(4) : null)
    return { n, lost: f(lost), avoidable: f(avoidable), elite: f(elite), eliteLost: f(eliteLost) }
  }
  const by = (key) => {
    const g = new Map()
    for (const p of positions) {
      const k = typeof key === 'function' ? key(p) : p[key]
      if (!g.has(k)) g.set(k, [])
      g.get(k).push(p)
    }
    return Object.fromEntries([...g].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, list]) => [k, losses(list)]))
  }
  rep.losses = { all: losses(positions), byFloorElite: by((p) => `${p.floor}${p.elite ? ' elite' : ''}`) }
  if (picks) {
    const split = (key) => {
      const g = new Map()
      for (const p of positions) {
        const k = key(p)
        if (!g.has(k)) g.set(k, [])
        g.get(k).push(p)
      }
      return Object.fromEntries([...g].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([k, list]) => [k, routeAgreement(list, picks)]))
    }
    rep.routes = { all: routeAgreement(positions, picks), byFloorElite: split((p) => `${p.floor}${p.elite ? ' elite' : ''}`), bySplit: split((p) => p.split) }
  }
  return rep
}

// A route model's tree in words, a line a node.
function treeWords (node, depth = 0) {
  const pad = '  '.repeat(depth)
  if (node.leaf !== undefined) {
    const top = Object.entries(node.w).filter(([, x]) => x).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8)
    return [`${pad}${node.leaf}: ${top.map(([k, x]) => `${k} ${+x.toPrecision(3)}`).join(', ')}`]
  }
  return [`${pad}${node.if} > ${node.gt}:`, ...treeWords(node.then, depth + 1), `${pad}${node.if} ≤ ${node.gt}:`, ...treeWords(node.else, depth + 1)]
}

// Every mode's `--ascension` and `--monarch`, checked: the level where it is not 0, the Monarch where not the base one.
function runArgs (arg) {
  const a = Number(arg('ascension', 0))
  if (!(Number.isInteger(a) && a >= 0 && a <= ascensionTop())) throw new Error(`--ascension ${a}: a level from 0 to ${ascensionTop()}`)
  return { ...(a && { ascension: a }), ...asMonarch(monarchArg(arg('monarch', BASE_MONARCH))) }
}

async function routeMain (arg, workers) {
  const seed = arg('seed', 'route')
  const runs = Number(arg('runs', 300))
  const dir = arg('out', path.join(os.tmpdir(), `retinue-route-${seed}`))
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
  const pc = (x) => `${(100 * x).toFixed(1)}%`
  const policyFile = path.join(dir, 'route-policy.json')
  const expertFile = path.join(dir, 'expert.json')
  const manifestFile = path.join(dir, 'manifest.json')
  const had = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null
  const r = arg('rooms', had?.settings?.rooms ?? 'end')
  const rooms = r === 'end' ? 0 : Number(r)
  const keys = Object.keys(rooms > 0 ? ROUTE_WEIGHTS : ROUTE_END_WEIGHTS)
  const w = arg('weights', null) && Object.fromEntries(keys.map((k, i) => [k, Number(arg('weights').split(',')[i] ?? 0)]))
  // The routes measured against the labels: hand-built, the expert's choices, the one that played and `--compare`'s.
  const picks = () => {
    const out = { hand: (p) => routePick('hand', p), chosen: (p) => p.chosen }
    const played = fs.existsSync(policyFile) ? json(policyFile) : false
    if (played) out.played = (p) => routePick(played, p)
    for (const f of (arg('compare', '') || '').split(',').filter(Boolean)) {
      const m = json(f)
      out[path.basename(f, '.json')] = (p) => routePick(m, p)
    }
    return out
  }
  const agreeLines = (ag) => Object.entries(ag).map(([k, x]) => `  ${k.padEnd(12)} ${String(x.n).padStart(6)}  top-1 ${pc(x.top1)}  regret ${x.regret.toFixed(3)} (${x.vs >= 0 ? '+' : ''}${x.vs.toFixed(3)} ± ${x.se.toFixed(3)} against the first)  lost ${pc(x.lost)}  elite ${pc(x.elite)}  shop ${pc(x.shop)}`)
  if (has('fit')) {
    const prior = arg('prior', null)
    const { model, report: rep } = await fitRoute(dir, {
      depth: Number(arg('depth', 3)), maxLeaves: Number(arg('leaves', 8)), lambda: Number(arg('lambda', 3)), tau: Number(arg('tau', 0)),
      minLeaf: Number(arg('min-leaf', 0)), weighted: has('weighted'), hand: has('hand'), log: console.log,
      weights: w, prior: prior && { name: path.basename(prior, '.json'), ...json(prior) }, structure: arg('structure', 'grow')
    })
    for (const name of ['train', 'test']) {
      const r = rep[name]
      if (r) console.log(`${name}: learned top-1 ${pc(r.learned.top1)} regret ${r.learned.regret.toFixed(3)}; the prior's weights alone ${pc(r.today.top1)} ${r.today.regret.toFixed(3)}; the expert's choices ${pc(r.chosen.top1)} ${r.chosen.regret.toFixed(3)} (${r.learned.n} choices)`)
    }
    const held = loadLabels(dir).positions.filter((p) => p.split === 'held').map((p) => {
      if (!w) return p
      const options = p.options.map((o) => ({ ...o, value: rooms > 0 ? routeWindowOf(o.parts, { ...ROUTE_WEIGHTS, ...w }) : routeEndOf(o.parts, { ...ROUTE_END_WEIGHTS, ...w }) }))
      return { ...p, options }
    })
    console.log('held out, against the labels:')
    console.log(agreeLines(routeAgreement(held, { ...picks(), fitted: (p) => routePick(model, p) })).join('\n'))
    console.log(treeWords(model.tree).join('\n'))
    // Written to src/sim/expert.json's route (bundle.js writePart), or to `--model`'s file.
    const out = arg('model', null)
    if (!has('dry')) {
      if (out) fs.writeFileSync(out, JSON.stringify(model, null, 1) + '\n')
      else (await import('./bundle.js')).writePart('route', model)
      console.log(`written to ${out ?? 'src/sim/expert.json (its route)'}`)
    }
    return
  }
  // The route and the battle expert that play, kept in `--out` as they were when its labelling began.
  const route = arg('policy', had?.settings?.policy ?? 'learned')
  const settings = { rooms, weights: routeWeightsOf({ rooms, weights: w }), keep: ROUTE_KEEP, reuse: ROUTE_DEFAULTS.reuse, policy: route, ...runArgs(arg) }
  if (had && JSON.stringify(had.settings) !== JSON.stringify(settings)) throw new Error(`${dir} was labelled with other settings (${JSON.stringify(had.settings)}): take another --out`)
  fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(policyFile)) fs.writeFileSync(policyFile, JSON.stringify(route === 'hand' ? false : (route === 'learned' ? E.shippedPart('route') : json(route)), null, 1) + '\n')
  if (!fs.existsSync(expertFile)) fs.writeFileSync(expertFile, JSON.stringify(arg('expert', null) ? json(arg('expert')) : E.expertModel(), null, 1) + '\n')
  const cfg = { ...settings, route: json(policyFile), expert: json(expertFile) }
  const labelsFile = path.join(dir, 'labels.jsonl')
  const runsFile = path.join(dir, 'runs.jsonl')
  const done = new Set(read(runsFile).map((r) => r.seed))
  const todo = Array.from({ length: runs }, (_, k) => `${seed}-${k + 1}`).filter((x) => !done.has(x))
  const t0 = performance.now()
  let made = 0
  if (todo.length && !has('report-only')) {
    console.log(`labelling the room choices of ${todo.length} expert runs (seeds ${seed}-1…${runs}, ${done.size} done in ${dir}) on ${workers} workers: ${rooms ? `rooms ${rooms}` : 'to the run\'s end'}, the route ${route}`)
    let n = 0
    await pool(todo, workers, cfg, (r) => {
      fs.appendFileSync(labelsFile, r.positions.map((p) => JSON.stringify(p) + '\n').join(''))
      const { positions, ...rest } = r
      fs.appendFileSync(runsFile, JSON.stringify({ ...rest, kept: positions.length }) + '\n')
      made += positions.length
      const s = (performance.now() - t0) / 1000
      if (++n % Math.max(1, Math.round(todo.length / 20)) === 0 || n === todo.length) console.log(`  ${n}/${todo.length} runs, ${made} choices, ${s.toFixed(0)} s, ${(made / s).toFixed(2)} choices/s`)
    }, 'route')
  }
  const wall = (performance.now() - t0) / 1000
  const runList = read(runsFile)
  const { positions } = loadLabels(dir)
  const rep = routeReport(positions, picks())
  const count = (key) => Object.fromEntries([...positions.reduce((m, p) => m.set(p[key], (m.get(p[key]) ?? 0) + 1), new Map())].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
  const options = positions.reduce((k, p) => k + p.options.length, 0)
  const total = (had?.throughput?.wall ?? 0) + (made ? wall : 0)
  const ms = runList.reduce((k, r) => k + r.ms, 0)
  const manifest = {
    made: new Date().toISOString(),
    settings,
    expert: { model: cfg.expert?.name ?? null, about: cfg.expert?.about ?? null },
    route: cfg.route ? { about: cfg.route.about ?? null } : 'hand',
    value: rooms
      ? 'value = −lost·[the run lost in the window] − monarch·(the share of its max HP the Monarch lost) − own·(the share of the souls\' max HP lost) + essence·(essence earned / autoplay.js tierScale) + cleared·(rooms done), over the room and the rooms after it to `rooms` (src/sim/teach.js, the route)'
      : 'value = −lost·(1 − the progress share at the end, a run lost) + rooms·(rooms cleared from the choice to the end) + floors·(floors cleared) + monarch·(the Monarch\'s HP share at the end) + own·(the souls\' HP share at the end) + souls·(souls standing at the end) + won·[cleared], the run played to its end by the expert (src/sim/teach.js, the route)',
    features: ROUTE_FEATURES,
    conditions: [...new Set(positions.flatMap((p) => Object.keys(p.sit)))].sort(),
    counts: {
      runs: runList.length, results: Object.fromEntries([...runList.reduce((m, r) => m.set(r.result, (m.get(r.result) ?? 0) + 1), new Map())]),
      choices: runList.reduce((k, r) => k + r.choices, 0), positions: positions.length, options,
      bySplit: count('split'), byFloor: count('floor'), byElite: count('elite')
    },
    throughput: { wall: +total.toFixed(1), workers, choicesPerSecond: +(positions.length / total).toFixed(2), roomsPerSecond: +(options / total).toFixed(2), perWorker: { msPerChoice: Math.round(ms / Math.max(1, positions.length)) } }
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1) + '\n')
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(rep, null, 1) + '\n')
  console.log(`${positions.length} choices (${options} rooms) from ${runList.length} runs in ${dir}; ${JSON.stringify(manifest.throughput)}`)
  const { losses, routes, ...rest } = rep
  console.log(table(rest))
  console.log('the expert\'s choices: ' + JSON.stringify(losses.all))
  for (const [k, x] of Object.entries(losses.byFloorElite)) console.log(`  ${k.padEnd(8)} ${JSON.stringify(x)}`)
  for (const [name, g] of Object.entries(routes)) {
    if (name === 'all') {
      console.log('the routes against the labels (all):')
      console.log(agreeLines(g).join('\n'))
      continue
    }
    for (const [k, ag] of Object.entries(g)) {
      console.log(`the routes against the labels (${name} ${k}):`)
      console.log(agreeLines(ag).join('\n'))
    }
  }
}

async function teacherMain (arg, workers) {
  const seed = arg('seed', 'sim')
  const runs = Number(arg('runs', 64))
  const from = Number(arg('from', 0))
  const dir = arg('out', path.join(os.tmpdir(), `retinue-teacher-${seed}`))
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const given = arg('weights', null)
  const fk = forestArg(arg)
  // The settings, held to the manifest's; the workers get the forest's configuration in place of its file.
  const settings = {
    cap: Number(arg('cap', DEFAULTS.cap)), turns: Number(arg('turns', DEFAULTS.turns)),
    weights: given ? { ...END_WEIGHTS, ...Object.fromEntries(given.split(',').map((kv) => kv.split('=')).map(([k, x]) => [k, Number(x)])) } : END_WEIGHTS,
    ...(arg('expert', null) && { expert: path.resolve(arg('expert')) }), ...(fk.setting !== undefined && { forest: fk.setting }), ...runArgs(arg)
  }
  const cfg = { ...settings, ...(fk.config !== undefined && { forest: fk.config }) }
  install(cfg)
  fs.mkdirSync(dir, { recursive: true })
  const runsFile = path.join(dir, 'runs.jsonl')
  const manifestFile = path.join(dir, 'manifest.json')
  const had = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null
  if (had && JSON.stringify(had.settings) !== JSON.stringify(settings)) throw new Error(`${dir} was played with other settings (${JSON.stringify(had.settings)}): take another --out`)
  const manifest = (extra = {}) => ({
    made: new Date().toISOString(), settings, expert: { model: E.expertModel().name ?? null }, forest: forestIn(fk), ...extra
  })
  if (!had) fs.writeFileSync(manifestFile, JSON.stringify(manifest(), null, 1) + '\n')
  const seeds = Array.from({ length: runs }, (_, k) => `${seed}-${from + k}`)
  const key = (r) => `${r.player}|${r.seed}`
  const done = new Set(read(runsFile).map(key))
  // A seed's two runs side by side in the queue (the teacher's first, the longer), so the pairs fill in order.
  const jobs = seeds.flatMap((s) => ['teacher', 'expert'].map((player) => ({ seed: s, player }))).filter((j) => !done.has(key(j)))
  const t0 = performance.now()
  if (jobs.length && !has('report-only')) {
    console.log(`playing ${jobs.length} runs (seeds ${seeds[0]}…${seeds.at(-1)}, the teacher's and today's expert's; ${done.size} done in ${dir}) on ${workers} workers: cap ${settings.cap}, to the battle's end`)
    let n = 0
    await pool(jobs, workers, cfg, (r) => {
      fs.appendFileSync(runsFile, JSON.stringify(r) + '\n')
      const s = ((performance.now() - t0) / 1000).toFixed(0)
      const cost = r.player === 'teacher' && r.decisions ? `; ${r.decisions} decisions, ${(r.decisionMs / r.decisions).toFixed(0)} ms and ${(r.playouts / r.decisions).toFixed(1)} playouts each` : ''
      console.log(`  ${++n}/${jobs.length} ${r.player.padEnd(7)} ${r.seed}: ${r.result ?? 'lost'} on floor ${r.floor}, progress ${r.progress.toFixed(3)}, battles ${r.battles.won}/${r.battles.fought}, ${(r.ms / 1000).toFixed(1)} s${cost} (${s} s in)`)
    }, 'teacher')
  }
  const wall = (performance.now() - t0) / 1000
  const want = new Set(seeds)
  const lines = read(runsFile).filter((r) => want.has(r.seed))
  const rep = { seeds: `${seeds[0]}…${seeds.at(-1)}`, ...pairedReport(lines) }
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(rep, null, 1) + '\n')
  fs.writeFileSync(manifestFile, JSON.stringify(manifest({
    counts: { teacher: lines.filter((r) => r.player === 'teacher').length, expert: lines.filter((r) => r.player === 'expert').length },
    wall: +((had?.wall ?? 0) + (jobs.length ? wall : 0)).toFixed(1), workers
  }), null, 1) + '\n')
  console.log(pairedLines(rep).join('\n'))
}

if (!isMainThread && workerData?.teach) {
  parentPort.on('message', (job) => parentPort.postMessage(JOBS[workerData.mode](job, workerData.cfg)))
} else if (isMainThread && isMain(import.meta.url) && has('route')) {
  await routeMain(arg, Number(arg('workers', Math.max(1, Math.min(5, os.availableParallelism() - 3)))))
} else if (isMainThread && isMain(import.meta.url) && has('augment')) {
  await augmentMain(path.resolve(arg('augment') ?? undefined), arg, Number(arg('workers', Math.max(1, Math.min(5, os.availableParallelism() - 3)))))
} else if (isMainThread && isMain(import.meta.url) && has('teacher')) {
  await teacherMain(arg, Number(arg('workers', Math.max(1, Math.min(4, os.availableParallelism() - 4)))))
} else if (isMainThread && isMain(import.meta.url)) {
  const seed = arg('seed', 'teach')
  const runs = Number(arg('runs', 300))
  const workers = Number(arg('workers', Math.max(1, Math.min(5, os.availableParallelism() - 3))))
  const dir = arg('out', path.join(os.tmpdir(), `retinue-teach-${seed}`))
  const nums = (s, keys, def) => (s ? Object.fromEntries(keys.map((k, i) => [k, Number(s.split(',')[i])])) : def)
  const rounds = Number(arg('rounds', DEFAULTS.rounds))
  // `--weights`: named pairs over the kind's own weights, or positional in WEIGHTS' order.
  const given = arg('weights', null)
  const base = rounds > 0 ? WEIGHTS : END_WEIGHTS
  const weights = !given ? base : given.includes('=') ? { ...base, ...Object.fromEntries(given.split(',').map((kv) => kv.split('=')).map(([k, x]) => [k, Number(x)])) }
    : nums(given, ['monarch', 'own', 'foe', 'lost', 'won'], WEIGHTS)
  const fk = forestArg(arg)
  const how = arg('draw', DEFAULTS.draw)
  if (!DRAWS.includes(how)) throw new Error(`--draw ${how}: one of ${DRAWS.join(', ')}`)
  const byFloor = arg('keep-floor', null)
  const keepFloor = byFloor ? Object.fromEntries(byFloor.split(',').map((kv) => kv.split('=')).map(([f, x]) => [Number(f), Number(x)])) : null
  if (keepFloor && Object.entries(keepFloor).some(([f, x]) => !(Number.isInteger(Number(f)) && Number(f) >= 1) || !(x >= 0 && Number.isFinite(x)))) throw new Error(`--keep-floor ${byFloor}: floor=factor pairs, each floor a whole number from 1, each factor 0 or more`)
  const smooth = { k: Number(arg('smooth', DEFAULTS.smooth)), epsilon: Number(arg('epsilon', DEFAULTS.epsilon)), top: Number(arg('top', DEFAULTS.top)) }
  if (!(Number.isInteger(smooth.k) && smooth.k >= 1)) throw new Error(`--smooth ${smooth.k}: a whole number of playouts, 1 or more`)
  if (!(smooth.epsilon >= 0 && smooth.epsilon <= 1) || !(Number.isInteger(smooth.top) && smooth.top >= 1)) throw new Error('--epsilon in [0, 1], --top a whole number, 1 or more')
  // The settings, held to the manifest's (the default draw and one playout left out); the workers get the forest itself.
  const settings = {
    rounds, cap: Number(arg('cap', DEFAULTS.cap)), ...(!(rounds > 0) && { turns: Number(arg('turns', DEFAULTS.turns)) }),
    weights, keep: nums(arg('keep', null), ['lost', 'near', 'reach', 'calm'], KEEP), ...(keepFloor && { keepFloor }), ...(arg('expert', null) && { expert: path.resolve(arg('expert')) }),
    ...(fk.setting !== undefined && { forest: fk.setting }), ...(how !== DEFAULTS.draw && { draw: how }),
    ...(smooth.k > 1 && { smooth: smooth.k, epsilon: smooth.epsilon, top: smooth.top }), ...runArgs(arg)
  }
  const cfg = { ...settings, ...(fk.config !== undefined && { forest: fk.config }) }
  install(cfg)
  fs.mkdirSync(dir, { recursive: true })
  const labelsFile = path.join(dir, 'labels.jsonl')
  const runsFile = path.join(dir, 'runs.jsonl')
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const manifestFile = path.join(dir, 'manifest.json')
  const had = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null
  if (had && JSON.stringify(had.settings) !== JSON.stringify(settings)) throw new Error(`${dir} was labelled with other settings (${JSON.stringify(had.settings)}): take another --out`)
  const done = new Set(read(runsFile).map((r) => r.seed))
  const todo = Array.from({ length: runs }, (_, k) => `${seed}-${k + 1}`).filter((x) => !done.has(x))
  const t0 = performance.now()
  let made = 0
  if (todo.length && !has('report-only')) {
    console.log(`labelling ${todo.length} expert runs (seeds ${seed}-1…${runs}, ${done.size} done in ${dir}) on ${workers} workers: rounds ${cfg.rounds}, cap ${cfg.cap}, drawn by the ${how}` +
      (keepFloor ? ` (by floor ${byFloor})` : '') +
      (smooth.k > 1 ? `, ${smooth.k} playouts an option (epsilon ${smooth.epsilon}, top ${smooth.top})` : ''))
    let n = 0
    await pool(todo, workers, cfg, (r) => {
      fs.appendFileSync(labelsFile, r.positions.map((p) => JSON.stringify(p) + '\n').join(''))
      const { positions, ...rest } = r
      fs.appendFileSync(runsFile, JSON.stringify({ ...rest, kept: positions.length }) + '\n')
      made += positions.length
      const s = (performance.now() - t0) / 1000
      if (++n % Math.max(1, Math.round(todo.length / 20)) === 0 || n === todo.length) console.log(`  ${n}/${todo.length} runs, ${made} positions, ${s.toFixed(0)} s, ${(made / s).toFixed(1)} positions/s`)
    })
  }
  const wall = (performance.now() - t0) / 1000
  const runList = read(runsFile)
  const { positions } = loadLabels(dir)
  const rep = report(positions)
  const count = (key) => Object.fromEntries([...positions.reduce((m, p) => m.set(p[key], (m.get(p[key]) ?? 0) + 1), new Map())].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
  const ms = runList.reduce((k, r) => k + r.ms, 0)
  const labelMs = runList.reduce((k, r) => k + r.labelMs, 0)
  const manifest = {
    made: new Date().toISOString(),
    settings,
    expert: { model: typeof E.expertModel === 'function' ? E.expertModel().name ?? null : null },
    forest: forestIn(fk),
    draw: how,
    smooth: { k: smooth.k, epsilon: smooth.k > 1 ? smooth.epsilon : 0, top: smooth.top, exact: 'the first of the k playouts, values[0]' },
    value: cfg.rounds > 0
      ? 'value = −monarch·(Monarch HP lost / its max) − own·(pieces\' HP lost / their max summed) + foe·(standing foes\' HP lost / their max summed) − lost·[lost] + won·[won], from the board the piece decided on to the board after `rounds` End Turns (src/sim/teach.js)'
      : 'value = −lost if the battle is lost (a stall past `turns` rounds among them), else −monarch·(the Monarch\'s share of its max HP lost, as the run carries it: the post-battle heal) − own·(the souls\' share of their max HP lost, as carried, a fallen soul all of its share) − turn·(the rounds the battle took after the decision), from the board the piece decided on to the battle\'s end (src/sim/teach.js)',
    ...names(positions),
    counts: {
      runs: runList.length, decisions: runList.reduce((k, r) => k + r.decisions, 0), positions: positions.length, options: positions.reduce((k, p) => k + p.options.length, 0),
      bySplit: count('split'), byFloor: count('floor'), byDanger: count('danger'), byGroup: count('group')
    },
    throughput: {
      wall: +((had?.throughput?.wall ?? 0) + (made ? wall : 0)).toFixed(1), positionsPerSecond: +(positions.length / ((had?.throughput?.wall ?? 0) + (made ? wall : 0))).toFixed(2),
      workers,
      perWorker: { positionsPerSecond: +(positions.length / (ms / 1000)).toFixed(2), labelShare: +(labelMs / ms).toFixed(3), labelMsPerPosition: +(labelMs / positions.length).toFixed(1) }
    }
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1) + '\n')
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(rep, null, 1) + '\n')
  console.log(`${positions.length} positions (${manifest.counts.options} options) from ${runList.length} runs in ${dir}; ${JSON.stringify(manifest.throughput)}`)
  console.log(table(rep))
}
