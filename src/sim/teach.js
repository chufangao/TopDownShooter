// The labeller (redesign.md §2.22, §5 Step 9a): labels for the learned decision tree, made by playing a piece's options
// out, offline. Never imported by the expert's play code: like the combo book and train.js, it is training, and it is
// the one place the foes' real turn is played ahead of a decision of yours.
//
// Positions: expert runs (autoplay.js policy, the default expert, the stream autoplay's; seeds `<seed>-1`…`<seed>-<runs>`)
// played live; each piece decision of each battle turn (the board as the expert's orders before it in that turn left it,
// the piece whose orders come next) a candidate, kept by a deterministic draw (a hash of the seed, the battle and the
// decision's place) with a chance by its danger (KEEP): every decision of a battle the expert lost, half of a near-lost
// one's (train.js NEAR: the Monarch at or under 35% of its max at a turn's start or the end, or 40% of it lost in the
// battle), a quarter of those of a won battle where the Monarch is in the foes' reach or a foe has a clear line on it
// (the plan's shooters), 3% of the rest; each kept one weighed 1 / its chance (`wt`), so the data can stand for every
// decision. That is the draw by the outcome (`draw` 'outcome', the default; L2's and L3's labels). With `draw` 'state'
// (`--draw state`) a decision's chance reads only the board as it stands when the piece decides, never how the battle
// ended: a quarter where the Monarch is in the foes' reach or a foe has a clear line on it ('reach'), 3% else ('calm'),
// KEEP's `lost` and `near` unused; the row's `group` is still the battle's, its `danger` the board's class. (Drawn by the
// outcome, a lost battle's rows are biased: there the option the expert took loses by construction, in a near-lost one
// it wins; the ranker's variants that trusted those rows played worse, 2026-10-12.) Held out by seed: a seed number ≡ 0
// (mod 5) is `held`, the rest `train`.
//
// Options: the deciding piece's options as the expert lists them (policy.js expertOptions: each tile and act or
// fusion), cut to a shortlist of at most `cap` (options: the one it has where it stands, for each act at each target
// the best tile by the prior and the least endangered, the tile nearest its role, the least endangered, the best block
// and screen, each fusion, then the best by the prior, no more than two of one act at one target), and the option the
// expert took added where the shortlist lacks it. The prior is the expert's own score of the option (the model tree in
// use, expert.js expertModel: its leaf's weights and soft rules over policy.js optionFeatures, the conditions policy.js
// conditions reads), only to choose what is labelled; `kept` says whether the model's hard rules leave it.
//
// Label (playout): each option given exactly on a copy of the board (turns.js fork: its move, then its act or fusion;
// one that only moves or stays is given what End Turn would have it do from there now, as the expert's turn gives a
// hold), the piece then done (marked acted); the rest of that turn played by the current expert (policy.js expertTurn
// on the copy, the piece left out), End Turn (the untouched act, the foes' real turn: policy.js foeTurn, the turn's end,
// a wave due), then, by default (`rounds` 0), the battle played out to its end by the current expert, its turn and End
// Turn round after round (at most `cap.turns` 150 rounds past the decision: a battle still going then is labelled a
// stall, lost, as the run's guard would end it). Measured from the board the piece decided on to the battle's end, and
// what of it the run carries (run.js finishBattle: each living soul and the Monarch, unless nothing heals it, heals
// TUNING.run.postBattleHeal of its max; the fallen stay down until an altar):
//   value = −lost                                         the battle (the run) lost, a stall among them; else
//           −monarch·(the share of its max HP the Monarch lost, as it carries)
//           −own·(the share of your souls' max HP summed lost, as it carries: a fallen soul all of its share, its HP
//                 before and the rest, its fall being for the run)
//           −turn·(the rounds the battle took after the decision: a faster win, a bonus per round saved)
// with END_WEIGHTS { lost 10, monarch 3, own 1, turn 0.02 } (`--weights monarch=3,own=1,lost=10,turn=0.02`). Shadows
// and summons count in neither; a fusion's parts are the fused piece's (its HP carried, they fallen in none). Two rounds
// and no more (`rounds` 2, the round-1 labels of 2026-10-11) price neither a soul's fall for the run, nor a slow battle,
// nor the wounds that carry out of it, and the weights fitted to them lean on the expert to finish what they start.
// With `rounds` > 0 the playout stops after that many End Turns, measured to the board then:
//   value = −monarch·(the Monarch's HP lost, a share of its max) − own·(your pieces' HP lost, a share of their max HP
//           summed as the board stood; a fusion's parts lost and the fused piece's HP gained) + foe·(the HP the foes
//           standing then lost, a share of their max HP summed) − lost·(the battle lost) + won·(the battle won)
// with WEIGHTS { monarch 3, own 1, foe 1, lost 10, won 1 } (`--weights`). Each part is written beside it, so other
// weights can be read off the same data (fit.js readRows `weights`). HP lost is net of healing (below 0 when mended).
// Two options that leave the same orders (a stay whose End-Turn blow is another option's act) are one: the first kept.
// Deterministic: the same seed gives the same positions and the same labels.
//
// Rows, one JSON line a position (labels.jsonl, in `--out`): { id, seed, run (its number), split, floor, room, battle,
// turn, uid, kind, at (the run's log index of the decision: the run replayed to it stands there), group (0 won, 1
// near-lost, 2 lost), danger ('lost', 'near', 'reach', 'calm'), wt, sit (policy.js conditions: the tree's vocabulary,
// the piece's own `self.*` among them), options: [{ i, tile, steps, ability, target, fusion, f (policy.js
// optionFeatures, a named vector; zeros left out), prior, kept, legal (it could be given), chosen (the expert took it),
// added (listed for being chosen), value, parts (to the battle's end: { lost, stall, monarch, own, fell (souls fallen),
// turns }; else { monarch, own, foe, lost, won }) }], chosen (its index), best (the index of the option the teacher takes,
// bestOf: the best value of the legal; ties, within 1e-9, to the expert's own score, the higher prior, then its own tie
// order, the fewer steps, the lower lane, the lower target uid, as policy.js better) }. (Before 2026-10-12, L2's and L3's
// labels, `best` was the first best value in the rows' order: the shortlist's, in the prior's order, the added option
// last. The two differ only where an added option ties the best value with a higher prior.)
// Beside it runs.jsonl (a line a run played: its result, decisions, positions kept, time), manifest.json (the names of
// the features and conditions, the counts, the settings, the throughput) and report.json (how often the expert's
// choice was the playout's best, and its regret, by floor and by danger: report). loadLabels reads it back.
//
//   npm run teach -- [--runs 300] [--seed teach] [--workers 5] [--out dir] [--rounds 0] [--cap 16] [--turns 150]
//                    [--weights monarch=3,own=1,…] [--keep lost,near,reach,calm] [--draw outcome|state]
//                    [--expert file.json] [--ranker file.json|none] [--report-only]
// (`--expert`: the expert configuration that plays and completes the turns, src/sim/expert.json by default. `--ranker`:
// the ranker configuration it plays with (redesign.md §2.23; ranker.js useRanker), installed in this thread and in every
// worker before a run is played, so the runs and every playout's rest are the expert's with that ranker; `none` for
// none, today's expert; without it, the one ranker.js holds. The labels' prior stays today's score, the ranker's
// correction aside. The ranker's file and `name` go into manifest.json. `--draw`: how a decision's chance to be
// labelled is read, see Positions above; `--keep`'s `lost` and `near` are unused under `state`; the draw goes into
// manifest.json, and into its settings where it is not the default.)
//
// The teacher (below, `--teacher`): this labeller as a player, every battle decision of a run the playout-best.
// The afterstates (below, `--augment <dir>`): a label set's runs replayed and each option's afterstate written beside its
// labels (after.jsonl), for the ranker's "after the move" inputs (ranker.js aft.*).
//
// `--out` defaults to the OS's temp directory (retinue-teach-<seed>); a stage stopped part way goes on from where it
// was (runs.jsonl names the runs done). Delete it (or take another --seed) once the game or the expert has changed.
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRun, apply, currentNode, availableNodes, monarchOf, souls } from './run.js'
import { createRng, hashString } from './rng.js'
import { policy, survey, roomFeatures, routeConditions, routeFeatures, tierScale, ROUTE_FEATURES, progressOf, foeShare, routeRooms, useRoute, routeModel, record, ablatedRun } from './autoplay.js'
import * as P from './policy.js'
import * as E from './expert.js'
import { useRanker, rankerModel, afterDiff, afterNames } from './ranker.js'
import { readPlan } from './plan.js'
import { fork, order, canAct, allowed, targetsFrom, pick, helped, lined, stalled } from './turns.js'
import { alive, footprint, isBlow, blowReach, distanceBetween, lineEnds, LINE_AT, LINE_TILES, TILES, tileX } from './unit.js'
import { LANE } from './field.js'
import { TUNING } from '../tuning.js'
import { seedNo, NEAR } from './train.js'

// The playout value's weights (see above: END_WEIGHTS to the battle's end, WEIGHTS for `rounds` > 0), the chance a
// decision is kept by its danger, and the defaults (`turns`: the rounds a playout to the end may last).
export const WEIGHTS = Object.freeze({ monarch: 3, own: 1, foe: 1, lost: 10, won: 1 })
export const END_WEIGHTS = Object.freeze({ lost: 10, monarch: 3, own: 1, turn: 0.02 })
export const KEEP = Object.freeze({ lost: 1, near: 0.5, reach: 0.25, calm: 0.03 })
export const DEFAULTS = Object.freeze({ rounds: 0, cap: 16, turns: 150, weights: null, keep: KEEP, draw: 'outcome' })
// How a decision's chance to be labelled is read (see above): by its battle's outcome, or by the board alone.
export const DRAWS = Object.freeze(['outcome', 'state'])
// The weights a configuration's labels are read by: its own, else its kind's.
const weightsOf = (c) => c.weights ?? (c.rounds > 0 ? WEIGHTS : END_WEIGHTS)

const NONE = Object.freeze([])
const EPS = 1e-9
const r6 = (x) => Math.round(x * 1e6) / 1e6

// ── the options ──────────────────────────────────────────────────────────────────────────────────

// The roads into the Monarch piece `u` would hold standing on `tile` (sit.entries over its footprint: policy.js holds).
const holds = (u, tile, sit) => (footprint(tile, u.size) ?? [tile]).reduce((n, t) => n + sit.entries.air[t] + (u.flies ? 0 : sit.entries.ground[t]), 0)

// The tiles strictly between the Monarch and each foe whose blow that keeps to a line reaches it, or would but for a
// screen of yours (policy.js screenLines).
function screenLines (battle, sit) {
  const out = new Set()
  const m = battle.monarch
  if (!sit.monarch || !m) return out
  for (const x of [...sit.monarch.deals.keys(), ...sit.monarch.screened]) {
    if (!x.kit.some((b) => isBlow(b) && lined(b) && distanceBetween(x.tile, x.size, m.tile, m.size) <= blowReach(x, b))) continue
    const [p, q] = lineEnds(x.tile, x.size, m.tile, m.size)
    const k = p * TILES + q
    for (let i = LINE_AT[k]; i < LINE_AT[k + 1]; i++) out.add(LINE_TILES[i])
  }
  return out
}

const kindOf = (o) => (o.ability ? `${o.ability.id}:${o.target.uid}` : o.fusion ? `fuse:${o.fusion.id}` : 'move')
// The first `n` of `list` not in `taken`, no more than `per` of one act at one target (twice that of moves alone).
function spread (list, n, taken, per = 2) {
  const out = []
  const count = new Map()
  for (const o of taken) count.set(kindOf(o), (count.get(kindOf(o)) ?? 0) + 1)
  for (const o of list) {
    if (out.length >= n) break
    if (taken.has(o)) continue
    const k = kindOf(o)
    const c = count.get(k) ?? 0
    if (c >= (k === 'move' ? 2 * per : per)) continue
    count.set(k, c + 1)
    out.push(o)
  }
  return out
}

// The better of two options by the prior; ties: the fewer steps, the lower lane, the lower target uid (policy.js better).
const byPrior = (a, b) => b.prior - a.prior || a.path.length - b.path.length || LANE[tileX(a.tile)] - LANE[tileX(b.tile)] || (a.target?.uid ?? -1) - (b.target?.uid ?? -1)
// The same as policy.js better weighs two options (its EPS on the score), for a sort: below 0 where `a` comes first.
const expertOrder = (a, b) => (Math.abs(a.prior - b.prior) > EPS ? b.prior - a.prior : 0) || a.path.length - b.path.length ||
  LANE[tileX(a.tile)] - LANE[tileX(b.tile)] || (a.target?.uid ?? -1) - (b.target?.uid ?? -1)

// The expert's reading of a decision (expert.js readTree over the model in use, on conditions `c`), where the expert
// has a model tree; else null (the prior then TUNING.expert.battle.option's weighted sum).
const readOf = (c) => (typeof E.readTree === 'function' && typeof E.expertModel === 'function' ? E.readTree(E.expertModel(), c) : null)

// Piece `u`'s options to label on `battle` (`sit` its situation, the plan on it; `c` its conditions): every option the
// expert lists, each read as its features (`v`), its prior and whether the model's hard rules keep it (`kept`), and the
// shortlist of at most `cap` kept as the expert's beam keeps one (policy.js shortlist's rules). → the shortlist, the
// best by the prior first, and `all` its options as read.
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
    if (o.fusion) keep.add(o)
    else if (o.ability) {
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

// What End Turn has one of yours yet to act do from where it stands, as an order (turns.js untouched; policy.js
// untouchedOrder): its basic blow at the foe furthest along its road, else its basic heal on the most wounded it can
// do something for; null for nothing.
function untouchedOrder (f, u) {
  if (!canAct(f, u)) return null
  const b = u.basic
  const foes = b && allowed(f, u, b) ? targetsFrom(f, u, b, u.tile) : NONE
  if (foes.length) return { type: 'act', uid: u.uid, ability: b.id, target: pick(f, u, foes).uid }
  const m = u.mend
  const allies = m && allowed(f, u, m) ? helped(f, u, m, u.tile) : NONE
  if (allies.length) return { type: 'act', uid: u.uid, ability: m.id, target: allies.slice().sort((p, q) => p.hp / p.maxHp - q.hp / q.maxHp || p.uid - q.uid)[0].uid }
  return null
}

// Option `o` of piece `uid` given on `g` (a copy): its move, then its act or fusion, or for a move alone or a stay what
// End Turn would have it do from there; the piece then marked done. → its orders (throws where one may not be given).
export function give (g, uid, o) {
  const u = g.byUid.get(uid)
  const out = []
  const put = (x) => {
    order(g, x)
    out.push(x)
  }
  if (o.tile !== u.tile) put({ type: 'move', uid, tile: o.tile })
  if (!g.over) {
    if (o.fusion) put({ type: 'fuse', id: o.fusion.id, uid, parts: o.fusion.parts.slice() })
    else if (o.ability) put({ type: 'act', uid, ability: o.ability.id, target: o.target.uid })
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
    else if (o.type === 'fuse') act = `f:${o.id}:${o.parts}`
  }
  return `${tile}|${act}`
}

// What the playout value reads of a board: the Monarch's HP and max, your pieces' HP and max HP summed (those that take
// orders), and each standing foe's HP (by uid) with their max HP summed.
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

// What the label to the battle's end reads of the board a piece decided on: the Monarch's share of its max HP, each of
// your souls standing (not the Monarch, no shadow or summon) with its HP and max, their max summed, and the round.
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

// The label to the battle's end (see the head of this file) of board `g`, played out, against `before` (endTally of the
// board the piece decided on), by `w` (END_WEIGHTS'). `stall`: the playout reached its bound on rounds still going. →
// { value, parts: { lost, stall, monarch, own, fell, turns } }
export function endValue (before, g, w = END_WEIGHTS, stall = false) {
  const won = g.over && g.winner === 'party'
  const heal = TUNING.run.postBattleHeal
  const carried = (hp, max, healed = true) => (hp > 0 ? Math.min(max, hp + (healed ? Math.ceil(max * heal) : 0)) : 0)
  const m = g.monarch
  const mAfter = m && m.hp > 0 ? carried(m.hp, m.maxHp, !g.unhealable) / m.maxHp : 0
  // Your souls as the run gets them back: each standing one carried; each fallen of those that stood, all its share.
  let had = 0
  let kept = 0
  let fell = 0
  let fallen = 0
  for (const [uid, s] of before.souls) {
    had += s.hp
    const x = g.byUid.get(uid)
    if (x && !alive(x) && x.into == null) {
      fell++
      fallen += s.maxHp - s.hp
    }
  }
  for (const u of g.units) if (alive(u) && u.side === 'party' && u !== m && !u.shadow) kept += carried(u.hp, u.maxHp)
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

// One option played out from `board` (see the head of this file): given on a copy, the rest of the turn by the expert,
// End Turn, then to the battle's end (`rounds` 0: at most `turns` rounds past the decision), or `rounds` − 1 rounds more.
// `seen`: the signatures already played (one that repeats is not played again: null). `before`: the board's tally
// (endTally to the end, else tally). → { sig, orders (the option's, as given), value, parts } or { legal: false }.
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

// Piece `uid`'s decision on `board` (a copy taken as it decided; the plan on it as the turn's) read: its situation, its
// conditions and its options (optionsAt, at most `cap` shortlisted). → { u, cond, short, all }
function readDecision (board, uid, cap) {
  const u = board.byUid.get(uid)
  const sit = P.situation(board)
  // The turn's plan, as the expert's turn read it (one the board carries), else read now.
  sit.plan = readPlan(board, sit)
  const cond = P.conditions(sit, u)
  return { u, cond, ...optionsAt(board, u, sit, cap, cond) }
}

// Each option of a decision read (readDecision) played out, `chosen` the signature of what the expert did (null for
// none), its option added where the shortlist lacks it. → { rows (the labels' options), plays (each row's option and its
// orders as given), at (the chosen's index), best (bestOf's) }
function labelled (board, uid, chosen, c, read = readDecision(board, uid, c.cap)) {
  const { short, all } = read
  const before = c.rounds > 0 ? tally(board) : endTally(board)
  const seen = new Set()
  const rows = []
  const plays = []
  const label = (o, added) => {
    const p = playout(board, uid, o, { rounds: c.rounds, turns: c.turns, weights: weightsOf(c), before, seen })
    if (p === null) return null
    const row = {
      i: rows.length, tile: o.tile, steps: o.path.length, ability: o.ability?.id ?? null, target: o.target?.uid ?? null, fusion: o.fusion?.id ?? null,
      f: sparse(o.v), prior: r6(o.prior ?? 0), kept: o.kept === false ? 0 : 1, legal: p.legal ? 1 : 0, chosen: p.legal && p.sig === chosen ? 1 : 0, added: added ? 1 : 0,
      value: p.legal ? p.value : null, parts: p.legal ? p.parts : null
    }
    rows.push(row)
    plays.push({ o, orders: p.legal ? p.orders : null })
    return row
  }
  for (const o of short) label(o, false)
  let at = rows.findIndex((r) => r.chosen)
  if (at < 0 && chosen) {
    // The expert's choice, where the shortlist lacks it: found among all its options by its signature.
    const o = fromSignature(all, chosen)
    if (o) {
      const row = label(o, true)
      at = row ? row.i : rows.findIndex((r) => r.chosen)
    }
  }
  return { rows, plays, at, best: bestOf(rows, plays.map((x) => x.o)) }
}

// One position labelled: piece `uid` deciding on `board` (a copy taken as it decided; the plan on it as the turn's),
// `chosen` the signature of what the expert did (null for none). → { uid, kind, sit, options, chosen, best }
export function labelPosition (board, uid, chosen = null, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg }
  const read = readDecision(board, uid, c.cap)
  const { rows, at, best } = labelled(board, uid, chosen, c, read)
  return { uid, kind: read.u.id, sit: sparse(read.cond), options: rows, chosen: at, best }
}

// The option the teacher takes of a decision's rows played out (`opts` their options, each with its prior, path, tile
// and target): the best value among the legal; ties (within EPS: every lost option is worth −lost alike, and many won
// ones tie too) to the expert's own score, the higher prior, then the expert's own tie order (the fewer steps, the
// lower lane, the lower target uid: policy.js better); of those alike in all, the first. → its index, −1 for none legal
export function bestOf (rows, opts) {
  let best = -1
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].legal) continue
    if (best < 0) best = i
    else if (Math.abs(rows[i].value - rows[best].value) > EPS ? rows[i].value > rows[best].value : expertOrder(opts[i], opts[best]) < 0) best = i
  }
  return best
}

// Of options `opts`, the one a decision's signature (signature) names: its tile and act or fusion.
function fromSignature (opts, sig) {
  const [tile, act] = sig.split('|')
  const t = Number(tile)
  return opts.find((o) => o.tile === t && (o.fusion ? `f:${o.fusion.id}:${o.fusion.parts}` : o.ability ? `a:${o.ability.id}:${o.target.uid}` : '') === act) ??
    // A stay or a move whose End-Turn act is the act: the option that only moves there.
    opts.find((o) => o.tile === t && !o.ability && !o.fusion) ?? null
}

// ── positions from runs ──────────────────────────────────────────────────────────────────────────

// The expert a run plays by and completes its playouts with, installed for the thread (a worker's: each run installs
// it again) where `c` names it: `expert` a configuration file (expert.js useExpert), else the one in use; `ranker` a
// ranker configuration or its file (ranker.js useRanker; null for none, today's expert), else the one in use.
function install (c) {
  if (c.expert) E.useExpert(JSON.parse(fs.readFileSync(c.expert, 'utf8')))
  if (c.ranker !== undefined) useRanker(rankerOf(c.ranker))
}
const rankerOf = (r) => (typeof r === 'string' ? JSON.parse(fs.readFileSync(r, 'utf8')) : r ?? null)

// A decision's draw in [0, 1): a hash of the seed, the battle and its place.
const draw = (seed, battle, seq) => parseInt(hashString(`teach|${seed}|${battle}|${seq}`).slice(0, 8), 16) / 2 ** 32

// The danger of a decision: its battle's group (lost, near-lost), else the Monarch in the foes' reach or a foe with a
// clear line on it (the plan's shooters), else calm. `b` the board, `group` its battle's (null: the board alone).
function dangerOf (b, group) {
  if (group === 2) return 'lost'
  if (group === 1) return 'near'
  const sit = P.situation(b, { lean: true })
  const reach = !!sit.monarch && sit.monarch.danger > 0
  const line = (b.plan?.turn === b.turn ? b.plan.shooters?.length : 0) > 0
  return reach || line ? 'reach' : 'calm'
}

// A decision's class and its chance to be labelled (KEEP's, or `cfg.keep`'s) by `cfg.draw`: by the outcome, its battle's
// `group` first (dangerOf); by the state, the board `b` alone, whatever `group` is. → { danger, keep }
export function drawOf (b, group, cfg = {}) {
  const how = cfg.draw ?? DEFAULTS.draw
  if (!DRAWS.includes(how)) throw new Error(`no draw "${how}": ${DRAWS.join(', ')}`)
  const danger = dangerOf(b, how === 'state' ? null : group)
  return { danger, keep: { ...KEEP, ...cfg.keep }[danger] }
}

// One expert run played live, its battles' decisions drawn and the kept ones labelled. `battles`: stop after that many
// battles (0: the whole run); `limit`: at most that many positions labelled. → { seed, result, floor, decisions,
// positions, ms, labelMs }
export function teachRun (seed, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg, keep: { ...KEEP, ...cfg.keep } }
  install(c)
  const t0 = performance.now()
  let labelMs = 0
  const run = createRun({ seed })
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
      const { danger, keep } = drawOf(p.board, group, c)
      if (!(draw(seed, cur.no, p.seq) < keep)) continue
      const t = performance.now()
      const L = labelPosition(p.board, p.uid, signature(p.orders, p.tile), c)
      labelMs += performance.now() - t
      positions.push({
        id: `${seed}:${cur.no}:${p.turn}:${p.uid}`, seed, run: seedNo(seed), split: seedNo(seed) % 5 === 0 ? 'held' : 'train', floor: cur.floor, room: cur.room,
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
      if (action.type === 'move' || action.type === 'act' || action.type === 'fuse') {
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

// ── the afterstates (redesign.md §2.23: the ranker's "after the move") ────────────────────────────

// The board each option of a labelled position leaves, read for the ranker (its aft.* inputs): `row` (a labels.jsonl
// line) on `board` (a copy of the board it was labelled on: the run replayed to its decision, augmentRun). Each of the
// row's options found among the piece's (policy.js expertOptions, by its tile, act, target and fusion) and given on a
// copy as the playouts give it (policy.js afterOf, the very read play makes), its conditions written against the row's
// own (ranker.js afterDiff: those that differ, rounded as the rows are); null where it is not found or may not be given.
// `same`: whether the board's own conditions, read as the row's were, are the row's `sit` (the replay is the run). →
// { same, a (one an option, in the row's order) }
export function afterRow (board, row) {
  const u = board.byUid.get(row.uid)
  if (!u) return { same: false, a: row.options.map(() => null) }
  const sit = P.situation(board)
  sit.plan = readPlan(board, sit)
  const same = JSON.stringify(sparse(P.conditions(sit, u))) === JSON.stringify(row.sit)
  const key = (tile, ability, target, fusion) => `${tile}|${ability ?? ''}|${target ?? ''}|${fusion ?? ''}`
  const live = new Map()
  for (const o of P.expertOptions(board, u)) {
    const k = key(o.tile, o.ability?.id, o.target?.uid, o.fusion?.id)
    if (!live.has(k)) live.set(k, o)
  }
  const a = row.options.map((r) => {
    const o = live.get(key(r.tile, r.ability, r.target, r.fusion))
    const after = o ? P.afterOf(board, u, o, sit.plan) : null
    return after ? afterDiff(after, row.sit) : null
  })
  return { same, a }
}

// One run's positions augmented (a worker's job: { seed, positions: [{ id, at, uid, sit, options }] }, labels.jsonl's
// rows of that seed): the run replayed as teachRun plays it (the expert and ranker of `cfg` installed, the same stream,
// each action asked of the policy before the board is copied), and at each position's decision (`at`, the run's log
// index) its afterstates read on a copy of the board (afterRow). A position the replay never meets is `missed`. →
// { seed, rows: [{ id, same, a } or { id, missed: true }] }
export function augmentRun ({ seed, positions }, cfg = {}) {
  install(cfg)
  const run = createRun({ seed })
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

// `npm run teach -- --augment <dir> [--workers n] [--ranker file|none]`: a label set's afterstates (afterRow) written
// beside it, after.jsonl (a line a position, labels.jsonl's order: { id, a }) and after.json (the conditions `a`'s
// indices name, the expert and ranker the runs were replayed with, how many positions were replayed to the board they
// were labelled on). The runs are replayed with the expert and ranker their manifest names (its settings' `expert` and
// `ranker`; a label set made before rankers, or with none, none), or the `--ranker` given.
async function augmentMain (dir, arg, workers) {
  const t0 = performance.now()
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  const given = arg('ranker', null)
  const named = manifest.settings?.ranker
  const file = given !== null ? (given === 'none' ? null : path.resolve(given)) : named === undefined ? undefined : named?.file ?? null
  if (file === undefined && manifest.ranker?.name) throw new Error(`${dir} was played with ranker ${manifest.ranker.name}, its file unnamed: give --ranker <file>`)
  const ranker = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  const cfg = { ranker, ...(manifest.settings?.expert && { expert: manifest.settings.expert }) }
  const labels = path.join(dir, 'labels.jsonl')
  const bySeed = new Map()
  const order = []
  for (const line of fs.readFileSync(labels, 'utf8').split('\n')) {
    if (!line) continue
    const r = JSON.parse(line)
    order.push(r.id)
    if (!bySeed.has(r.seed)) bySeed.set(r.seed, [])
    bySeed.get(r.seed).push({ id: r.id, at: r.at, uid: r.uid, sit: r.sit, options: r.options.map((o) => ({ i: o.i, tile: o.tile, ability: o.ability, target: o.target, fusion: o.fusion })) })
  }
  console.log(`augmenting ${order.length} positions of ${bySeed.size} runs in ${dir} on ${workers} workers (ranker ${ranker?.name ?? 'none'})`)
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
    made: new Date().toISOString(), conditions: afterNames(), ranker: ranker && { file, name: ranker.name ?? null }, expert: manifest.settings?.expert ?? null,
    positions: order.length, same, missed, differ, seconds: +((performance.now() - t0) / 1000).toFixed(1)
  }
  fs.writeFileSync(path.join(dir, 'after.json'), JSON.stringify(info, null, 1) + '\n')
  console.log(`wrote ${path.join(dir, 'after.jsonl')}: ${same} of ${order.length} positions replayed to the board they were labelled on, ${missed} missed (${info.seconds} s)`)
}

// ── reading the labels ───────────────────────────────────────────────────────────────────────────

// The names of the option features and the conditions (the rows leave out zeros): the code's own, in its order
// (policy.js OPTION_FEATURES, the keys conditions gives a piece), then any other the rows carry, sorted.
export function names (positions = NONE) {
  const seen = (key) => [...new Set(positions.flatMap(key))].sort()
  const own = (list, extra) => [...list, ...extra.filter((k) => !list.includes(k))]
  const piece = { uid: -1, hp: 1, maxHp: 1, move: 0 }
  return {
    features: own(P.OPTION_FEATURES ?? NONE, seen((p) => p.options.flatMap((o) => Object.keys(o.f)))),
    conditions: own(Object.keys(P.conditions({}, piece)), seen((p) => Object.keys(p.sit)))
  }
}

// The labels in `dir` (labels.jsonl), sorted by run, battle and place; with `flat`, also as flat arrays for a fitter:
// { positions, features (names: the manifest's where there is one, else names), conditions (the same), X (rows ×
// features), S (positions × conditions), rows: { pos (its position's index), value, chosen, legal, kept, prior } (typed
// arrays, a row an option) }.
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

// How the expert's choices stand against the playouts, over `positions` (labelPosition's, with floor and danger; or
// labelChoice's, with floor and elite): for all, and grouped by each of `by` ({ name: a position's key, or a function of
// it }: by floor, danger and split by default), { positions, options (mean), decisive (the share where the options' values differ),
// agree (the share where the expert's choice is the playout's best, ties counted), agreeDecisive (the same among the
// decisive), regret (the mean of the best value less the chosen's), regretDecisive, random (a uniformly random
// option's mean regret), spread (the mean of the best value less the worst), scoreOnly (the agreement of the best by
// the expert's score alone, its hard rules aside) }.
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

// ── the teacher (redesign.md §2.23, §5 Step 10a) ─────────────────────────────────────────────────

// The labeller as a player: whole runs with every battle decision the playout-best, for the ranker's targets and for
// the ceiling (how far battle play alone can take the expert). Never shipped, like the combo book.
//
// Out of battle today's expert decides (autoplay.js policy, the default expert, on the 'autoplay' stream, as
// autoplay.js record plays it), so a teacher run of a seed is today's expert's run of that seed (record's) up to the
// first battle decision the two take differently. In battle, each turn, one piece at a time on the board as the ones
// before it left it: the next to decide is the one today's expert would order next on the board as it stands (its turn,
// policy.js expertTurn, read on the board at the turn's first decision, its plan kept on the board as the expert's turn
// keeps it, then on a copy with the pieces the teacher has decided marked done: the first piece it decides); its options
// the labeller's (optionsAt: at most `cap`), the expert's own choice added where the shortlist lacks it (so the teacher
// does no worse than the expert by its own playouts); each played out to the battle's end by the current expert
// (playout: the expert of the thread, the ranker in use with it), and the best taken (bestOf: the best value, ties to the
// expert's own score and its tie order); given as orders (its move, then its act or fusion; a move alone or a stay given
// what End Turn would have it do from there, as the labeller gives it). A piece with one option takes it with no
// playout. Where the expert would order no piece, the turn ends as the expert ends it: what End Turn has the untouched
// do (policy.js untouchedOrders), then End Turn. Nothing else changes: the same bound on a battle's rounds (a stall past
// TUNING.turn.guard, as autoplay.js ends it), the same End Turn; a turn is one decision a piece more than the expert
// reads, about ten playouts each (9–12 on the bar's seeds, 2026-10-12: ~40 ms a decision on floor 1 and ~200 ms over a
// run on four workers, a run of ~800 decisions 2–5 minutes). Deterministic: the same board gives the same orders.
//
//   npm run teach -- --teacher [--runs 64] [--seed sim] [--from 0] [--workers 4] [--out dir] [--cap 16] [--turns 150]
//                    [--weights monarch=3,own=1,…] [--expert file.json] [--ranker file.json|none] [--report-only]
// plays seeds `<seed>-<from>`…`<seed>-<from + runs − 1>` (autoplay.js's naming: sim-0…sim-63, the bar's seeds), each by
// the teacher and by today's expert (record), in worker threads; runs.jsonl in `--out` (the OS's temp directory,
// retinue-teacher-<seed>, by default) holds a line a run: { seed, player ('teacher' or 'expert'), result, floor, progress
// (autoplay.js progressOf, as record reads it), battles: { won, fought }, ms, and the teacher's decisions, playouts (in
// all), single (decisions of one option) and decisionMs }; manifest.json the settings (a stage stopped part way goes on
// from where it was, the runs done skipped; other settings refused); report.json the paired report (pairedReport),
// printed.

// A copy of board `b` with the pieces in `done` marked done (acted), as the labeller's playout marks the piece it gives.
function marked (b, done) {
  const g = fork(b)
  for (const uid of done) {
    const x = g.byUid.get(uid)
    if (x && alive(x)) x.acted = true
  }
  return g
}

// The piece today's expert would order next on board `b` (policy.js expertTurn read on it: the first piece its turn
// decides), and the orders its turn gives it there (the leading orders of the turn, that piece's). → { uid (null: none,
// End Turn), orders }
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

// The teacher's decision for piece `uid` on `board` (a copy as it decides, the turn's plan on it): the options read as
// the labeller reads them, `chosen` the signature of the expert's own choice (added where the shortlist lacks it), each
// played out to the battle's end and the best taken (bestOf); one option taken with no playout. → { option, orders
// (its orders, as given on a copy), playouts, value (its playout's; null unplayed) }
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

// The teacher's turn on `battle` (yours to order; read only but for the turn's plan, which the expert's turn keeps on it
// too): see the head of this section. `count` (optional) adds up its decisions, playouts, single (the decisions of one
// option) and ms (the time its decisions took). → the turn's orders, End Turn last (none once the battle is over)
export function teacherTurn (battle, cfg = {}, count = null) {
  if (battle.over || battle.phase !== 'orders') return []
  const c = { ...DEFAULTS, ...cfg }
  const done = new Set()
  const out = []
  // The first read on the board itself, so its plan is the turn's (plan.js readPlan keeps it on the board), as the
  // expert's turn reads it; the rest on the teacher's own copy, the turn's plan on it.
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
    // (Given on a copy that differs only in the pieces marked done, its orders stand on the teacher's; one that would
    // not is left, as a playout leaves it.)
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
function closeOf (run) {
  const b = run.battle
  return b.winner === 'party' ? { won: true, fell: null } : { won: false, fell: { rank: currentNode(run)?.rank ?? 1, share: foeShare(b) } }
}

// One run played by the teacher (see the head of this section), `expert` and `ranker` installed as teachRun installs
// them. `battles`: stop once that many battles are over (0: the whole run); `fights`: stop as that many fights open,
// before the last's first order; `log`: the run's log in the result. → { seed, player, result, floor, progress,
// battles: { won, fought }, ms, decisions, playouts, single, decisionMs }
export function teacherRun (seed, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg }
  install(c)
  const t0 = performance.now()
  const run = ablatedRun(seed)
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
      // Past the sim's bound on turns, as autoplay.js ends it: a stall.
      if (stalled(b)) action = { type: 'stall' }
      else {
        if (!queue || queue.b !== b || queue.turn !== b.turn || !queue.orders.length) queue = { b, turn: b.turn, orders: teacherTurn(b, c, count) }
        action = queue.orders.shift()
      }
    } else action = policy(run, rng, 'expert')
    apply(run, action)
    // On turns a battle ends with an order, not with the fight that opened it (autoplay.js autoplay's onBattle).
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

// One run of today's expert (autoplay.js record, `expert` and `ranker` installed as teachRun installs them), in the
// teacher's lines. → { seed, player, result, floor, progress, battles: { won, fought }, ms }
export function expertRun (seed, cfg = {}) {
  install(cfg)
  const t0 = performance.now()
  const r = record({ seed, level: 'expert' })
  return {
    seed, player: 'expert', result: r.result ?? null, floor: r.floor, progress: r.progress,
    battles: { won: r.battles.filter((b) => b.won).length, fought: r.battles.length }, ms: Math.round(performance.now() - t0)
  }
}

// The teacher against today's expert, paired by seed over runs.jsonl's lines (`lines`; a seed counted where both have
// played it): each one's clears, the seeds the teacher cleared and today's lost (`gained`) and the other way (`lost`),
// the mean progress and the paired difference (the teacher's less today's) ± one standard error, the battles won of
// those fought, the runs lost by the floor they fell on, and the mean time a run; the teacher's decisions a run,
// playouts a decision and time a decision. → { n, teacher, expert, clears: { gained, lost }, progress: { diff, se },
// cost }
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
export function pairedLines (rep) {
  const pc = (x) => (x === null ? '-' : `${(100 * x).toFixed(1)}%`)
  const deaths = (x) => Object.entries(x).map(([k, v]) => `floor ${k} ${v}`).join(', ') || 'none'
  const { teacher: t, expert: e } = rep
  return [
    `the teacher against today's expert, ${rep.n} seeds paired:`,
    `  clears          teacher ${t.clears}/${rep.n} (${pc(t.rate)}), today's ${e.clears}/${rep.n} (${pc(e.rate)}); the teacher cleared ${rep.clears.gained} today's lost, lost ${rep.clears.lost} today's cleared`,
    `  progress        teacher ${t.progress.toFixed(4)}, today's ${e.progress.toFixed(4)}; difference ${rep.progress.diff >= 0 ? '+' : ''}${rep.progress.diff.toFixed(4)} ± ${rep.progress.se.toFixed(4)} (one standard error, paired)`,
    `  battles won     teacher ${t.battles.won}/${t.battles.fought} (${pc(t.battles.rate)}), today's ${e.battles.won}/${e.battles.fought} (${pc(e.battles.rate)})`,
    `  deaths by floor teacher ${deaths(t.deaths)}; today's ${deaths(e.deaths)}`,
    `  time a run      teacher ${(t.msPerRun / 1000).toFixed(1)} s (${rep.cost.decisionsPerRun} decisions, ${rep.cost.playoutsPerDecision} playouts and ${rep.cost.msPerDecision} ms a decision, ${pc(rep.cost.single)} of one option), today's ${(e.msPerRun / 1000).toFixed(1)} s`
  ]
}

// ── the route (redesign.md §2.22: the route by the same machinery; §5 Step 9b) ───────────────────

// Room choices labelled as the battle's options are: each room the run may walk into played out, offline.
//
// Choices: expert runs (as above: autoplay.js policy, seeds `<seed>-1`…; its route the one `route` installs for the
// labelling, useRoute: a learned tree, false for the hand-built; `expert` the battle expert's configuration, useExpert),
// each map decision where the expert walks on and more than one room is open a candidate, kept by a deterministic draw
// (a hash of the seed, the floor and the rank) with a chance by its floor and whether an elite is open (ROUTE_KEEP:
// floors 1–2 with an elite open, all; floors 1–2 else, 0.6; later floors, 0.6 with an elite open and 0.25 else), each
// kept one weighed 1 / its chance (`wt`). Held out by seed, as above.
//
// Label (playout): for each open room, a copy of the run (its state cloned: the expert's play is a pure function of it)
// walks into it, and the expert plays on (autoplay.js policy: its prep, the battle with the foes' real turns, the reap,
// a Shop, its spending and its own choices of the rooms after, by the route installed) to the run's end (`rooms` 0, the
// default since round 2: labels play to the end, redesign.md §6 "The learned route"), or until `rooms` rooms are done
// (round 1's window: 2, the room and the next). To the end, the chosen room's playout is the run's own rest (`reuse`:
// the run played on is the same pure function of the same state; teach.test.js holds it to that).
//   To the end, measured at the run's end (ROUTE_END_WEIGHTS { lost 10, rooms 1, floors 1, monarch 1, own 1, souls 0,
//   won 0 }):
//     value = −lost·(the run lost: 1 − its progress at the end, autoplay.js progressOf, so a loss the later the less)
//             + rooms·(the rooms cleared from the choice to the end, the battle lost by the share of its foes' HP
//             removed: progressOf × routeRooms) + floors·(the floors cleared after the choice, the Sovereign's floor
//             the last) + monarch·(the Monarch's share of its max HP at the end) + own·(the souls' share of their max
//             HP at the end, the fallen at none) + souls·(the souls standing at the end) + won·(the run cleared)
//   with nothing carried out of a lost run (monarch, own and souls 0 there).
//   A window (round 1), measured from the run as it stood at the choice to the run at the window's end (ROUTE_WEIGHTS
//   { lost 10, monarch 3, own 1, essence 1, cleared 1 }):
//     value = −lost·(the run lost in the window: the Monarch fell, or a stall) − monarch·(the share of its max HP the
//             Monarch lost) − own·(the share of their max HP the souls lost, the fallen at none: net of healing, an
//             altar's below 0) + essence·(the essence earned, in tier prices: autoplay.js tierScale on the choice's
//             floor) + cleared·(the rooms done, the run standing)
//   and two more weighed 0 by default, so other weights can be read off the same data: `power` (the change in the log
//   of the army's strength, autoplay.js survey's: tiers, recruits, relics and wounds) and `purse` (the change in the
//   purse, in tier prices).
// Each part is written beside the value, so the labels can be read again by other weights (fitRoute's `weights`).
//
// Rows, one JSON line a choice (labels.jsonl in the route's `--out`), the battle's shape so fit.js reads them: { id,
// seed, run, split, floor, rank (the rank the run stands on: the rooms are the next), elite (an elite open: 0 or 1), wt,
// sit (autoplay.js routeConditions: the route tree's vocabulary), options: [{ i (the room's index among those open), id
// (its map id), type, f (autoplay.js routeFeatures), prior (the hand-built route's weighted sum, its rules aside), legal,
// chosen (the expert walked into it), value, parts, rooms (done), and to the end share (the run's progress at its end)
// and end (the floor it ended on) }], chosen, best, hand (the room the hand-built route takes: TREES.route's rules, then
// TUNING.expert.route's weights) }.
//
//   npm run teach -- --route [--runs 300] [--seed route] [--workers 5] [--out dir] [--rooms 0] [--report-only]
//                    [--policy learned|hand|file.json] [--expert file.json] [--ranker file.json|none] [--compare file.json]
//   npm run teach -- --route --fit [--out dir] [--model src/sim/route.json] [--depth 3] [--lambda 3] [--tau 0] [--hand]
//                    [--weights lost,rooms,floors,monarch,own,souls,won] [--prior file.json] [--structure prior] [--dry]
// (`--policy`: the route that plays the runs and their playouts, round 1's learned tree src/sim/route.json by default;
// `--expert`: the battle expert, src/sim/expert.json; both kept in `--out` as they were, route-policy.json and
// expert.json, so a stage gone on with plays the same; `--ranker`: the ranker the battles are played with, as the
// battle labeller's, its file and name in the settings (a stage gone on with names it again); `--compare`: another
// route tree to measure against the labels; `--weights`: a window's are lost,monarch,own,essence,cleared,power,purse.)
export const ROUTE_WEIGHTS = Object.freeze({ lost: 10, monarch: 3, own: 1, essence: 1, cleared: 1, power: 0, purse: 0 })
export const ROUTE_END_WEIGHTS = Object.freeze({ lost: 10, rooms: 1, floors: 1, monarch: 1, own: 1, souls: 0, won: 0 })
export const ROUTE_KEEP = Object.freeze({ early: 1, earlyCalm: 0.6, late: 0.6, lateCalm: 0.25 })
export const ROUTE_DEFAULTS = Object.freeze({ rooms: 0, weights: null, keep: ROUTE_KEEP, reuse: true })
// The weights a configuration's route labels are read by: its own, else its kind's (to the end, or a window).
export const routeWeightsOf = (c) => c.weights ?? (c.rooms > 0 ? ROUTE_WEIGHTS : ROUTE_END_WEIGHTS)

// What the route's playout value reads of a run: its floor, the Monarch's share of its max HP, the souls' HP over their
// max (the fallen's none), the essence earned so far, the purse, the army's strength (survey's, as a log), and at a
// map decision its progress (progressOf: the rooms done of the route's).
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

// The route's window value of `run` against `before` (runTally of the run at the choice), `cleared` the rooms done, by
// `w` (round 1's). → { value, parts }
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
export const routeWindowOf = (p, w = ROUTE_WEIGHTS) => -w.lost * p.lost - w.monarch * p.monarch - w.own * p.own + w.essence * p.essence + w.cleared * p.cleared +
  (w.power ?? 0) * (p.power ?? 0) + (w.purse ?? 0) * (p.purse ?? 0)
// A label to the end's value from its parts, by `w`.
export const routeEndOf = (p, w = ROUTE_END_WEIGHTS) => -w.lost * p.lost + w.rooms * p.rooms + w.floors * p.floors + w.monarch * p.monarch + w.own * p.own +
  w.souls * p.souls + w.won * p.won

// The route's value to the end of `run` (over: cleared or lost) against `before` (runTally of the run at the choice), by
// `w` (see the head above). → { value, parts, share (its progress at the end), floor }
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

// Counts a room done as the route's labels do: the run back on the map from a room's battle (its reap) or its Shop, or
// walked through an altar; or the run over, the Monarch standing (the Sovereign slain).
const roomDone = (was, now, action, run) => (now === 'over' ? !run.state.death : now === 'map' && (was !== 'map' || action.type === 'node'))

// Room `id` played out from `run` (at a map decision; never touched): a copy walks into it and the expert plays on to
// the run's end (`rooms` 0), or until `rooms` rooms are done or the run is over (see above). → { value, parts, rooms
// (done), floor, at (where it stands), and to the end share }
export function playRoute (run, id, { rooms = ROUTE_DEFAULTS.rooms, weights = null, before = runTally(run) } = {}) {
  const w = weights ?? routeWeightsOf({ rooms })
  const r = { state: structuredClone(run.state), battle: null, setup: null }
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

// The room the hand-built route takes at a choice (autoplay.js pickRoute without a learned tree: TREES.route's rules,
// then TUNING.expert.route's weights over roomFeatures). → its id
const handRoom = (sit) => E.decide(E.TREES.route, sit, sit.rooms.map((room) => ({ id: room.id, node: { type: room.type }, v: roomFeatures(sit, room) })), TUNING.expert.route).option?.id

// One room choice labelled: `run` at a map decision (more than one room open), `chosen` the id of the room the expert
// walked into (null for none); `known` ({ [room id]: playRoute's result }) the rooms already played out (the chosen
// one's, the run's own rest). → { elite, sit, options, chosen (its index), best (the index of the best value), hand }
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

// A choice's draw in [0, 1): a hash of the seed, the floor and the rank.
const routeDraw = (seed, floor, rank) => parseInt(hashString(`route|${seed}|${floor}|${rank}`).slice(0, 8), 16) / 2 ** 32
// The chance a choice is kept (ROUTE_KEEP) by its floor and whether an elite is open.
const routeKeep = (keep, floor, elite) => (floor <= 2 ? (elite ? keep.early : keep.earlyCalm) : elite ? keep.late : keep.lateCalm)

// One expert run played live, its room choices drawn and the kept ones labelled, with `route` (a route tree, false for
// the hand-built), `expert` (a battle configuration) and `ranker` (a ranker configuration or its file, null for none)
// installed while it plays, where given. To the end, the kept choices are labelled once the run is over: the chosen
// room's value its own rest (unless `reuse` is off). → { seed, result, floor, progress (progressOf, as autoplay.js
// record reads it), choices, positions, ms, labelMs }
export function teachRoutes (seed, cfg = {}) {
  const c = { ...ROUTE_DEFAULTS, ...cfg, keep: { ...ROUTE_KEEP, ...cfg.keep } }
  const w = routeWeightsOf(c)
  const hadRoute = c.route !== undefined ? routeModel() : null
  const hadExpert = c.expert ? E.expertModel() : null
  const hadRanker = rankerModel()
  if (c.route !== undefined) useRoute(c.route || false)
  if (c.expert) E.useExpert(c.expert)
  if (c.ranker !== undefined) useRanker(rankerOf(c.ranker))
  try {
    const t0 = performance.now()
    let labelMs = 0
    const run = createRun({ seed })
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
          } else later.push({ at: place(s, rank, keep), run: { state: structuredClone(run.state), battle: null, setup: null }, chosen: action.id, done })
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
    const end = routeEndValue(runTally(createRun({ seed })), run, w)
    return { seed, result: run.state.result ?? null, floor: run.state.floor, progress: end.share, choices, positions, ms: Math.round(performance.now() - t0), labelMs: Math.round(labelMs) }
  } finally {
    if (c.route !== undefined) useRoute(hadRoute ?? false)
    if (c.expert) E.useExpert(hadExpert)
    if (c.ranker !== undefined) useRanker(hadRanker)
  }
}

// The rooms of a labelled choice the hand-built route's rules leave (expert.js TREES.route, its own nodes, read off the
// choice's stored situation and rooms: the souls' health, the Monarch's share, whether it may be healed, each room's type
// and odds): the indices of its options, one where a rule forces it.
export function handLeft (p) {
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

// The room a route takes at a labelled choice, read off its stored situation and rooms: `model` a route tree (autoplay.js
// learnedRoute: its leaf by the conditions, the first best room by its weights, the hand-built rules first where it keeps
// them), 'hand' the hand-built route (the choice's `hand` where labelled, else handLeft and the prior), 'chosen' the
// room the expert walked into. → the room's index (−1 for none)
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

// How routes' picks (`picks`: { name: (choice) → its room's index }) agree with the labels over choices `positions`:
// each one's top-1 (its room a playout-best, within 1e-6), regret (the best value less its room's), how often its room's
// playout lost the run (`lost`), and walked into an elite (`elite`) or a Shop (`shop`); and each one's regret less the
// first's (`vs`, paired by choice, ± one standard error). → { [name]: { n, top1, regret, lost, elite, shop, vs, se } }
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

// Fits the route's model tree (fit.js fitExpert, the battle's fitter: a listwise loss over each choice's rooms, splits
// on routeConditions, each leaf's weights over routeFeatures) to the route labels in `dir`, from `prior` (a route tree:
// its else-most leaf the root's prior, or with `structure` 'prior' its own tree, its leaves refitted; the hand-built
// route's weights, TUNING.expert.route, by default); no rules (the battle's soft rules read no room). `weights`: each
// room's value read again off its parts by these (routeEndOf's or routeWindowOf's, by the labels' kind), else as
// labelled. `hand`: the hand-built route's rules kept in play (the model's `hand`: autoplay.js learnedRoute), so it is
// fitted only on the rooms they leave (handLeft), a choice they decide left out. → { model, report, d }
export async function fitRoute (dir, { depth = 3, maxLeaves = 8, lambda = 3, tau = 0, minLeaf = 0, weighted = false, weights = null, hand = false, prior = null, structure = 'grow', log = null } = {}) {
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

// What a worker plays for each job, by the pool's `mode`: a seed's run labelled (teachRun), its room choices (teachRoutes),
// or a run by the teacher or by today's expert ({ seed, player }: teacherRun, expertRun).
const JOBS = {
  battle: (seed, cfg) => teachRun(seed, cfg),
  route: (seed, cfg) => teachRoutes(seed, cfg),
  teacher: (job, cfg) => (job.player === 'teacher' ? teacherRun : expertRun)(job.seed, cfg),
  augment: (job, cfg) => augmentRun(job, cfg)
}

// Runs `jobs` (JOBS[mode]'s) in worker threads of this module, `workers` at a time, handing each result to `done` as it
// ends.
async function pool (jobs, workers, cfg, done, mode = 'battle') {
  const { Worker } = await import('node:worker_threads')
  const queue = jobs.slice()
  const worker = async () => {
    const w = new Worker(new URL(import.meta.url), { workerData: { teach: true, cfg, mode } })
    try {
      while (queue.length) {
        const job = queue.shift()
        done(await new Promise((resolve, reject) => {
          const off = () => {
            w.off('message', ok)
            w.off('error', fail)
          }
          const ok = (msg) => {
            off()
            resolve(msg)
          }
          const fail = (err) => {
            off()
            reject(err)
          }
          w.on('message', ok)
          w.on('error', fail)
          w.postMessage(job)
        }))
      }
    } finally {
      await w.terminate()
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, worker))
}

// `--ranker file.json|none` read (`arg` the command line's): the configuration to install (undefined where none is
// named: the one ranker.js holds; null for none, today's expert) and what the settings record of it ({ file, name }; null
// for none; undefined where none is named).
function rankerArg (arg) {
  const f = arg('ranker', null)
  if (f === null) return { config: undefined, setting: undefined }
  if (f === 'none') return { config: null, setting: null }
  const file = path.resolve(f)
  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  return { config, setting: { file, name: config?.name ?? null } }
}
// The ranker a manifest names: its file (null where none was named) and the `name` of the one in use (null for none).
const rankerIn = (rk) => ({ file: rk.setting?.file ?? null, name: rankerModel()?.name ?? null })

const table = (rep) => {
  const line = (k, s) => `  ${String(k).padEnd(8)} ${String(s.positions).padStart(6)}  options ${s.options}  decisive ${s.decisive}  agree ${s.agree} (decisive ${s.agreeDecisive})  regret ${s.regret} (decisive ${s.regretDecisive})  random ${s.random}  spread ${s.spread}  score-only agree ${s.scoreOnly}`
  const groups = Object.entries(rep).filter(([k]) => k !== 'all')
  return [line('all', rep.all), ...groups.flatMap(([name, g]) => [`${name.replace(/^by/, 'by ').toLowerCase()}:`, ...Object.entries(g).map(([k, s]) => line(k, s))])].join('\n')
}

// The route's labels in a report: report's, by floor, by whether an elite was open and by both, and by split; and of the
// expert's choices, how often its room's playout lost the run (`lost`), how often while another room's did not
// (`avoidable`), and how often it walked into an open elite (`elite`) and lost there (`eliteLost`).
export function routeReport (positions, picks = null) {
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
export function treeWords (node, depth = 0) {
  const pad = '  '.repeat(depth)
  if (node.leaf !== undefined) {
    const top = Object.entries(node.w).filter(([, x]) => x).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8)
    return [`${pad}${node.leaf}: ${top.map(([k, x]) => `${k} ${+x.toPrecision(3)}`).join(', ')}`]
  }
  return [`${pad}${node.if} > ${node.gt}:`, ...treeWords(node.then, depth + 1), `${pad}${node.if} ≤ ${node.gt}:`, ...treeWords(node.else, depth + 1)]
}

// `npm run teach -- --route …` (see the route's head above): label room choices, or with --fit fit the route's tree.
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
  // The routes measured against the labels: the hand-built, the expert's own choices, the route that played (its tree,
  // route-policy.json in `--out`), and `--compare`'s trees.
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
  if (process.argv.includes('--fit')) {
    const prior = arg('prior', null)
    const { model, report: rep } = await fitRoute(dir, {
      depth: Number(arg('depth', 3)), maxLeaves: Number(arg('leaves', 8)), lambda: Number(arg('lambda', 3)), tau: Number(arg('tau', 0)),
      minLeaf: Number(arg('min-leaf', 0)), weighted: process.argv.includes('--weighted'), hand: process.argv.includes('--hand'), log: console.log,
      weights: w, prior: prior && { name: path.basename(prior, '.json'), ...json(prior) }, structure: arg('structure', 'grow')
    })
    for (const name of ['train', 'test']) {
      const r = rep[name]
      if (r) console.log(`${name}: learned top-1 ${pc(r.learned.top1)} regret ${r.learned.regret.toFixed(3)}; the prior's weights alone ${pc(r.today.top1)} ${r.today.regret.toFixed(3)}; the expert's choices ${pc(r.chosen.top1)} ${r.chosen.regret.toFixed(3)} (${r.learned.n} choices)`)
    }
    // Held out, as the labels were read (`weights`): the fitted tree beside the hand-built route and the rest.
    const held = loadLabels(dir).positions.filter((p) => p.split === 'held').map((p) => {
      if (!w) return p
      const options = p.options.map((o) => ({ ...o, value: rooms > 0 ? routeWindowOf(o.parts, { ...ROUTE_WEIGHTS, ...w }) : routeEndOf(o.parts, { ...ROUTE_END_WEIGHTS, ...w }) }))
      return { ...p, options }
    })
    console.log('held out, against the labels:')
    console.log(agreeLines(routeAgreement(held, { ...picks(), fitted: (p) => routePick(model, p) })).join('\n'))
    console.log(treeWords(model.tree).join('\n'))
    const out = arg('model', fileURLToPath(new URL('./route.json', import.meta.url)))
    if (!process.argv.includes('--dry')) {
      fs.writeFileSync(out, JSON.stringify(model, null, 1) + '\n')
      console.log(`written to ${out}`)
    }
    return
  }
  // The route and the battle expert that play, kept in `--out` as they were when its labelling began.
  const route = arg('policy', had?.settings?.policy ?? 'learned')
  const rk = rankerArg(arg)
  const settings = { rooms, weights: routeWeightsOf({ rooms, weights: w }), keep: ROUTE_KEEP, reuse: ROUTE_DEFAULTS.reuse, policy: route, ...(rk.setting !== undefined && { ranker: rk.setting }) }
  if (had && JSON.stringify(had.settings) !== JSON.stringify(settings)) throw new Error(`${dir} was labelled with other settings (${JSON.stringify(had.settings)}): take another --out`)
  fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(policyFile)) fs.writeFileSync(policyFile, JSON.stringify(route === 'hand' ? false : json(route === 'learned' ? fileURLToPath(new URL('./route.json', import.meta.url)) : route), null, 1) + '\n')
  if (!fs.existsSync(expertFile)) fs.writeFileSync(expertFile, JSON.stringify(arg('expert', null) ? json(arg('expert')) : E.expertModel(), null, 1) + '\n')
  if (rk.config !== undefined) useRanker(rk.config)
  const cfg = { ...settings, route: json(policyFile), expert: json(expertFile), ...(rk.config !== undefined && { ranker: rk.config }) }
  const labelsFile = path.join(dir, 'labels.jsonl')
  const runsFile = path.join(dir, 'runs.jsonl')
  const done = new Set(read(runsFile).map((r) => r.seed))
  const todo = Array.from({ length: runs }, (_, k) => `${seed}-${k + 1}`).filter((x) => !done.has(x))
  const t0 = performance.now()
  let made = 0
  if (todo.length && !process.argv.includes('--report-only')) {
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
    expert: { model: cfg.expert?.name ?? null, about: cfg.expert?.about ?? null, beam: !!TUNING.expert.beam?.on },
    route: cfg.route ? { about: cfg.route.about ?? null } : 'hand',
    ranker: rankerIn(rk),
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
    // The wall time is every invocation's that labelled (a stage gone on with adds to it); per worker, a run's time
    // (its own play and its choices' playouts) summed.
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

// `npm run teach -- --teacher …` (see the teacher's head above): seeds played by the teacher and by today's expert,
// paired.
async function teacherMain (arg, workers) {
  const seed = arg('seed', 'sim')
  const runs = Number(arg('runs', 64))
  const from = Number(arg('from', 0))
  const dir = arg('out', path.join(os.tmpdir(), `retinue-teacher-${seed}`))
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const given = arg('weights', null)
  const rk = rankerArg(arg)
  // The settings it plays by (manifest.json's, a stage gone on with held to them), and what the workers get: the same
  // with the ranker's configuration in place of its file and name. Its playouts go to the battle's end.
  const settings = {
    cap: Number(arg('cap', DEFAULTS.cap)), turns: Number(arg('turns', DEFAULTS.turns)),
    weights: given ? { ...END_WEIGHTS, ...Object.fromEntries(given.split(',').map((kv) => kv.split('=')).map(([k, x]) => [k, Number(x)])) } : END_WEIGHTS,
    ...(arg('expert', null) && { expert: path.resolve(arg('expert')) }), ...(rk.setting !== undefined && { ranker: rk.setting })
  }
  const cfg = { ...settings, ...(rk.config !== undefined && { ranker: rk.config }) }
  install(cfg)
  fs.mkdirSync(dir, { recursive: true })
  const runsFile = path.join(dir, 'runs.jsonl')
  const manifestFile = path.join(dir, 'manifest.json')
  const had = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null
  if (had && JSON.stringify(had.settings) !== JSON.stringify(settings)) throw new Error(`${dir} was played with other settings (${JSON.stringify(had.settings)}): take another --out`)
  const manifest = (extra = {}) => ({
    made: new Date().toISOString(), settings, expert: { model: E.expertModel().name ?? null, beam: !!TUNING.expert.beam?.on }, ranker: rankerIn(rk), ...extra
  })
  if (!had) fs.writeFileSync(manifestFile, JSON.stringify(manifest(), null, 1) + '\n')
  const seeds = Array.from({ length: runs }, (_, k) => `${seed}-${from + k}`)
  const key = (r) => `${r.player}|${r.seed}`
  const done = new Set(read(runsFile).map(key))
  // A seed's two runs side by side in the queue (the teacher's first, the longer), so the pairs fill in order.
  const jobs = seeds.flatMap((s) => ['teacher', 'expert'].map((player) => ({ seed: s, player }))).filter((j) => !done.has(key(j)))
  const t0 = performance.now()
  if (jobs.length && !process.argv.includes('--report-only')) {
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
} else if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--route')) {
  const arg = (name, def) => {
    const i = process.argv.indexOf('--' + name)
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
  }
  await routeMain(arg, Number(arg('workers', Math.max(1, Math.min(5, os.availableParallelism() - 3)))))
} else if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--augment')) {
  const arg = (name, def) => {
    const i = process.argv.indexOf('--' + name)
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
  }
  await augmentMain(path.resolve(arg('augment')), arg, Number(arg('workers', Math.max(1, Math.min(5, os.availableParallelism() - 3)))))
} else if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--teacher')) {
  const arg = (name, def) => {
    const i = process.argv.indexOf('--' + name)
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
  }
  await teacherMain(arg, Number(arg('workers', Math.max(1, Math.min(4, os.availableParallelism() - 4)))))
} else if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, def) => {
    const i = process.argv.indexOf('--' + name)
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
  }
  const seed = arg('seed', 'teach')
  const runs = Number(arg('runs', 300))
  const workers = Number(arg('workers', Math.max(1, Math.min(5, os.availableParallelism() - 3))))
  const dir = arg('out', path.join(os.tmpdir(), `retinue-teach-${seed}`))
  const nums = (s, keys, def) => (s ? Object.fromEntries(keys.map((k, i) => [k, Number(s.split(',')[i])])) : def)
  const rounds = Number(arg('rounds', DEFAULTS.rounds))
  // `--weights`: named (monarch=3,own=1,…) over the kind's own, or in WEIGHTS' order for `rounds` > 0.
  const given = arg('weights', null)
  const base = rounds > 0 ? WEIGHTS : END_WEIGHTS
  const weights = !given ? base : given.includes('=') ? { ...base, ...Object.fromEntries(given.split(',').map((kv) => kv.split('=')).map(([k, x]) => [k, Number(x)])) }
    : nums(given, ['monarch', 'own', 'foe', 'lost', 'won'], WEIGHTS)
  const rk = rankerArg(arg)
  const how = arg('draw', DEFAULTS.draw)
  if (!DRAWS.includes(how)) throw new Error(`--draw ${how}: one of ${DRAWS.join(', ')}`)
  // The settings the labels are made by (manifest.json's, a stage gone on with held to them; the default draw left out,
  // as the labels before it were made), and what the workers get: the same with the ranker's configuration in place of
  // its file and name.
  const settings = {
    rounds, cap: Number(arg('cap', DEFAULTS.cap)), ...(!(rounds > 0) && { turns: Number(arg('turns', DEFAULTS.turns)) }),
    weights, keep: nums(arg('keep', null), ['lost', 'near', 'reach', 'calm'], KEEP), ...(arg('expert', null) && { expert: path.resolve(arg('expert')) }),
    ...(rk.setting !== undefined && { ranker: rk.setting }), ...(how !== DEFAULTS.draw && { draw: how })
  }
  const cfg = { ...settings, ...(rk.config !== undefined && { ranker: rk.config }) }
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
  if (todo.length && !process.argv.includes('--report-only')) {
    console.log(`labelling ${todo.length} expert runs (seeds ${seed}-1…${runs}, ${done.size} done in ${dir}) on ${workers} workers: rounds ${cfg.rounds}, cap ${cfg.cap}, drawn by the ${how}`)
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
    // The expert that played and completed the turns: its model tree (expert.js expertModel), whether its turn was the
    // beam (TUNING.expert.beam.on), and the ranker it played with (its file, where named, and its name; null for none).
    expert: { model: typeof E.expertModel === 'function' ? E.expertModel().name ?? null : null, beam: !!TUNING.expert.beam?.on },
    ranker: rankerIn(rk),
    // How the decisions were drawn: by their battle's outcome, or by the board alone (see the head of this file).
    draw: how,
    value: cfg.rounds > 0
      ? 'value = −monarch·(Monarch HP lost / its max) − own·(pieces\' HP lost / their max summed) + foe·(standing foes\' HP lost / their max summed) − lost·[lost] + won·[won], from the board the piece decided on to the board after `rounds` End Turns (src/sim/teach.js)'
      : 'value = −lost if the battle is lost (a stall past `turns` rounds among them), else −monarch·(the Monarch\'s share of its max HP lost, as the run carries it: the post-battle heal) − own·(the souls\' share of their max HP lost, as carried, a fallen soul all of its share) − turn·(the rounds the battle took after the decision), from the board the piece decided on to the battle\'s end (src/sim/teach.js)',
    ...names(positions),
    counts: {
      runs: runList.length, decisions: runList.reduce((k, r) => k + r.decisions, 0), positions: positions.length, options: positions.reduce((k, p) => k + p.options.length, 0),
      bySplit: count('split'), byFloor: count('floor'), byDanger: count('danger'), byGroup: count('group')
    },
    // The wall time is every invocation's that labelled (a stage gone on with adds to it), the rate the positions over it.
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
