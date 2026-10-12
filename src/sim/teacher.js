// The stronger teacher (redesign.md §2.23, §6 "The teacher, stronger"): teach.js's teacher (the labeller as a player:
// every battle decision the best of its options played out to the battle's end) given width where its shortlist sees
// only losses, and a search over our next decisions jointly, across End Turn, where no option of the one decision wins.
// Offline only, like teach.js and the combo book: never imported by the expert's play code (policy.js, autoplay.js's
// play, the game); it measures how far battle play alone can take the expert, and it is the teacher the expert learns
// from.
//
// The base (step a): teach.js's teacher as master plays it. Out of battle the expert in use decides (autoplay.js policy:
// its prep, its buys, and the route in use, the learned route.json where autoplay.js ROUTE_LEARNED is on); in battle,
// each turn, one piece at a time in the order the expert in use would take them (teach.js nextPiece), its shortlist
// (teach.js optionsAt, at most `cap`, the expert's own choice added) each played out to the battle's end by the expert in
// use (teach.js playout: policy.js expertTurn, the forest of forest.js forestModel correcting today's tree where one is
// in use), the best taken (teach.js bestOf: the best value, ties to the expert's own score). Every lost option is worth
// −lost alike, so where all of them lose the one decision has nothing to go on and takes the expert's own best by its
// score. Every run's line records the forest, the route and the expert that played (`base`).
//
// Width (step b, `width`): where the shortlist's best playout loses ('lost', the default), every legal option of the
// piece (policy.js expertOptions: each tile it may end on, and from there each act at each target or holding, each
// fusion) is played out too, those the shortlist played left out by the orders they give; the best of all taken.
// 'danger' widens also where the board is in danger as the labeller's draw reads it (teach.js drawOf by the state: the
// Monarch in the foes' reach, or a foe with a clear line on it), the shortlist's best won or not; 'off' never.
//
// The search (step c, `budget` playouts, 0 for none): where no option of the one decision wins (width's included), a
// search over lines of our next decisions: this piece's options, then the next pieces' in the order the expert in use
// would take them, across End Turn (the untouched act, the foes' real turn, a wave due: End Turn as the game plays it)
// into our next turn, at most `depth` End Turns ahead (1: to the end of our next turn). A line is the expert's own play
// from its first option on (its spine: each decision the expert's own orders, read decision by decision as the teacher
// would give them) but at its deviations, each a shortlisted option other than the expert's at one decision of the
// spine; it is measured by the playout to the battle's end of its last deviation (the base finishing it), or, without
// one past its first option, of the spine's end. The lines are tried by the fewest deviations first, then by the lowest
// sum of their options' ranks by today's score, then the nearest (cheap lines first: limited discrepancy search over the
// expert's own line), each line's spine built only once its own deviations are the cheapest left; the search stops at
// the first line that wins the battle, or once `budget` playouts are spent (a spine built counts as one), at most
// `deviations` deviations a line. A winning line is kept: its first option taken now, its later decisions given on the
// decisions that follow while the board is the one the line expected (the teacher's copy of the turn, read as a key:
// every unit's tile, HP, acts, statuses and cooldowns, the decided pieces), then the rest of its winning playout given
// turn by turn as the playout gave it, each turn on the board it expected; where the board is not the one expected
// (a piece that only moved acts at End Turn in the game where a playout had marked it done), the normal teacher again.
// Where nothing wins, every line lost alike (−lost), and the one decision's own pick stands. A battle spends at most
// `battle` playouts on searches; one that fails waits `retry` turns before the next (its window would be the same
// lines less one decision).
//
// Shaped losses (`shape`, 'flat' by default: every lost playout worth −lost alike, as teach.js values it): with 'foes', a
// lost playout is worth −lost + the share of the battle's foe HP removed by its end (autoplay.js foeShare, the partial
// credit progress gives a lost battle), never more than −lost + 1, below every won one. Why: in the fatal battles of the
// teacher's lost runs every option of every decision lost alike from the battle's first decision on (§6), so the one
// decision had nothing to go on and played the expert's own best by its score to the end; shaped, it plays the option
// whose playout fell furthest into the foes, and the search, where no line wins, keeps its best line by that value
// (its decisions followed, then the normal teacher again) where it is better than the one decision's own best.
//
// Deterministic: the same board gives the same orders, the search included.
//
//   npm run teacher -- [--runs 64] [--seed sim] [--from 0] [--workers 4] [--out dir] [--cap 16] [--turns 150]
//                      [--width off|lost|danger] [--budget 2000] [--depth 1] [--deviations 3] [--battle 10000]
//                      [--retry 1] [--inner short|all] [--shape flat|foes] [--expert file.json] [--forest file.json|none]
//                      [--route learned|hand|file.json] [--report-only]
// plays seeds `<seed>-<from>`…`<seed>-<from + runs − 1>` (sim-0…sim-63, the bar's seeds), each by this teacher and by
// the expert in use (teach.js expertRun: autoplay.js record), paired (teach.js pairedReport), in worker threads of this
// module; runs.jsonl in `--out` (the OS's temp directory, retinue-teacher2-<seed>, by default) a line a run, each with
// its settings, its base (the forest, route and expert that played), its time, its decisions, the playouts in all, and
// its escalations (`esc`: decisions widened, searched, their playouts and time, lines found and followed); a stage stopped
// part way goes on from where it was (the runs done skipped; other settings refused); report.json the paired report.
// `--inner all`: a spine's deviations every legal option (width inside the search), not its shortlist.
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from './run.js'
import { createRng, hashString } from './rng.js'
import { policy, progressOf, ablatedRun, useRoute, routeModel, ROUTE_LEARNED, foeShare } from './autoplay.js'
import * as P from './policy.js'
import * as E from './expert.js'
import { forestModel } from './forest.js'
import { fork, order, stalled } from './turns.js'
import { DEFAULTS, END_WEIGHTS, give, signature, playout, endTally, endValue, bestOf, labelled, readDecision, marked, nextPiece, install, closeOf, fromSignature, drawOf, expertRun, pairedReport, pairedLines } from './teach.js'

// The teacher's settings (see the head of this file): the labeller's `cap` and `turns`, the value's weights (teach.js
// END_WEIGHTS: to the battle's end), `width`, the search's `budget` (playouts a search), `depth` (End Turns a line may
// cross), `deviations` (at most, a line), `battle` (the search playouts a battle may spend), `retry` (turns a failed
// search waits), `inner` (a spine's deviations: its shortlist, or all), `spine` (decisions a spine may hold at most),
// `shape` (a lost playout's value: 'flat', or 'foes').
export const SETTINGS = Object.freeze({ cap: DEFAULTS.cap, turns: DEFAULTS.turns, weights: END_WEIGHTS, width: 'lost', budget: 2000, depth: 1, deviations: 3, battle: 10000, retry: 1, inner: 'short', spine: 24, shape: 'flat' })
export const WIDTHS = Object.freeze(['off', 'lost', 'danger'])
export const SHAPES = Object.freeze(['flat', 'foes'])

const NONE = Object.freeze([])
const END = Object.freeze({ type: 'end' })
// A playout won: every lost one is worth −lost (a stall among them).
const won = (p) => !!p && p.legal !== false && p.parts?.lost === 0

// ── the board as a key ───────────────────────────────────────────────────────────────────────────

// Board `b` (and the pieces decided this turn, `done`) as a key: the turn, the stage and its end, the purse spent, the
// reserve, and each unit's kind, tile, HP, acts, Move spent, statuses and cooldowns. Two boards of one battle with one
// key are one board, as far as any order can tell. (Not the event beats: a Hexed piece the teacher decided loses its act
// at End Turn with a beat where a playout, which marks it done, has none; nothing else differs. Kept as it reads, not
// hashed: where a line's board is not the one it expected, the two keys say how.)
export function keyOf (b, done = null) {
  let k = `${b.turn}|${b.phase}|${b.over ? b.winner ?? '-' : ''}|${b.spent}|${b.roster}|${b.nextUid}|${b.reserve.length}|${done ? [...done].sort((x, y) => x - y).join(',') : ''}|`
  for (const u of b.units) {
    k += `${u.uid}:${u.id}:${u.side}:${u.tile}:${u.hp}:${u.maxHp}:${u.acted ? 1 : 0}:${u.moved}:${u.into ?? ''}:`
    for (const s of u.statuses) k += `${s.id}/${s.dur}/${s.stacks}/${s.fresh ? 1 : 0},`
    for (const id in u.cooldowns) k += `${id}=${u.cooldowns[id]},`
    k += ';'
  }
  return k
}

// ── lines: the teacher's turn read decision by decision ─────────────────────────────────────────

// A node of a line: the teacher's copy of the turn (`f`: the orders of the turn given on it, as teach.js teacherTurn
// gives them; never touched once made), the pieces decided on it this turn (`done`), the next piece the expert in use
// would order and its orders for it (`next`: teach.js nextPiece), and the End Turns crossed since the search's root.
// From board `f` (this node's own) with `done` decided: the next decision, or where the expert would order no piece,
// the turn ended as the teacher ends it (what End Turn has the untouched do, policy.js untouchedOrders, then End Turn)
// and our next turn read on the board itself first (its plan kept on it, as the live battle keeps it). → the node
// (`over` once the battle is: `f.winner` who won)
function nodeAt (f, done, crossed) {
  while (!f.over) {
    const next = done.size ? nextPiece(marked(f, done)) : nextPiece(f)
    if (next.uid !== null) return { f, done, next, crossed }
    for (const x of P.untouchedOrders(fork(f))) order(f, x)
    if (!f.over) order(f, END)
    crossed++
    done = new Set()
  }
  return { f, done, next: null, crossed, over: true }
}

// Node `n`'s piece given `orders` (on a copy: each as teacherTurn gives it, one that may not be given ending them). →
// the node after it
function stepNode (n, orders) {
  const f = fork(n.f)
  for (const x of orders) {
    if (f.over) break
    try {
      order(f, x)
    } catch {
      break
    }
  }
  return nodeAt(f, new Set(n.done).add(n.next.uid), n.crossed)
}

// The board node `n`'s piece decides on (its copy with the decided pieces marked done, as the teacher reads it), and
// what the playout value reads of it, made once.
function boardOf (n) {
  if (!n.board) {
    n.board = marked(n.f, n.done)
    n.before = endTally(n.board)
  }
  return n.board
}

// The expert's own line from node `n` (its spine): each decision the expert's own orders, up to `c.depth` End Turns
// ahead or `c.spine` decisions. → { nodes (its decisions), end (the node after the last: over, a turn's start past the
// window, or mid-turn) }
function spineOf (n, c) {
  const nodes = []
  let x = n
  while (!x.over && x.crossed <= c.depth && nodes.length < c.spine) {
    nodes.push(x)
    x = stepNode(x, x.next.orders)
  }
  return { nodes, end: x }
}

// A spine decision's deviations: its piece's options other than the expert's own (`c.inner` 'short': its shortlist,
// teach.js optionsAt, by today's score; 'all': every legal one, by today's score), each set of orders once (`n.seen`,
// the expert's own in it from the first). → the options, cheapest first
function deviationsAt (n, c) {
  const b = boardOf(n)
  const u = b.byUid.get(n.next.uid)
  const read = readDecision(b, u.uid, c.cap)
  n.seen = new Set([signature(n.next.orders, u.tile)])
  if (read.all.length <= 1) return NONE
  return c.inner === 'all' ? read.all.slice().sort((p, q) => q.prior - p.prior) : read.short
}

// The rest of the battle from board `b` (a copy is played: `b` is never touched) by the expert in use, as a playout's
// rest is played (teach.js playout: the rest of this turn, End Turn, then turn after turn, at most `c.turns` rounds),
// measured from `before` (teach.js endTally), shaped as `play` shapes it. With `record`, each round's orders (`chunks`:
// { key (the board as the round began, keyOf; `mid` for the first, a turn under way), orders }). → { value, parts,
// chunks }
function rollout (b, before, c, { record = false, mid = null, uid = null, o = null } = {}) {
  const g = fork(b)
  const chunks = []
  if (o) give(g, uid, o)
  for (let r = 0; r <= c.turns && !g.over; r++) {
    const chunk = record ? { key: r === 0 && mid !== null ? mid : keyOf(g), turn: r > 0 || mid === null, orders: [] } : null
    for (const x of P.expertTurn(g)) {
      if (g.over || x.type === 'end') break
      try {
        order(g, x)
      } catch {
        break
      }
      chunk?.orders.push(x)
    }
    if (chunk) chunks.push(chunk)
    if (!g.over) order(g, END)
  }
  const v = endValue(before, g, c.weights, !g.over)
  if (c.shape === 'foes' && v.parts.lost) v.value += foeShare(g)
  return { ...v, chunks }
}

// A found line's steps, for the teacher to follow: each decision of it ({ kind 'decide', key (keyOf the teacher's copy
// and the decided pieces), uid, orders }), then the rest of its winning playout, round by round ({ kind 'tail', key,
// orders }: the rest of the turn under way; { kind 'turn', key, orders }: a turn from its start). `L` the line (its
// `parent`, `via` the spine decisions before its own, `at` its own decision and `o` its option there, or `end`, the
// spine's end, for a line measured there).
function stepsOf (L, c, { tail: rest = true } = {}) {
  const decisions = []
  const walk = (x) => {
    if (x.parent) walk(x.parent)
    for (const n of x.via) decisions.push({ n, orders: n.next.orders })
    if (x.at) decisions.push({ n: x.at, orders: x.orders })
  }
  walk(L)
  const steps = decisions.map(({ n, orders }) => ({ kind: 'decide', key: keyOf(n.f, n.done), uid: n.next.uid, orders }))
  if (!rest) return { steps }
  let tail
  if (L.at) {
    // The rest of the winning playout: from the board the deviation was given on, the deviation given as it played.
    const n = L.at
    const after = fork(n.f)
    for (const x of L.orders) {
      if (after.over) break
      try {
        order(after, x)
      } catch {
        break
      }
    }
    tail = rollout(boardOf(n), n.before, c, { record: true, mid: keyOf(after, new Set(n.done).add(n.next.uid)), uid: n.next.uid, o: L.o })
  } else {
    const e = L.end
    if (e.over) return { steps, value: null }
    const mid = e.done.size ? keyOf(e.f, e.done) : null
    tail = rollout(e.done.size ? marked(e.f, e.done) : e.f, endTally(e.f), c, { record: true, mid })
  }
  for (const ch of tail.chunks) steps.push({ kind: ch.turn ? 'turn' : 'tail', key: ch.key, orders: ch.orders })
  return { steps, value: tail.value, won: tail.parts.lost === 0 }
}

// A small binary heap of tasks by cost (ties: the first pushed first).
function heap () {
  const a = []
  const less = (i, j) => a[i].cost < a[j].cost || (a[i].cost === a[j].cost && a[i].seq < a[j].seq)
  const swap = (i, j) => ([a[i], a[j]] = [a[j], a[i]])
  let seq = 0
  return {
    get size () { return a.length },
    push (cost, task) {
      a.push({ cost, seq: seq++, task })
      for (let i = a.length - 1; i > 0;) {
        const p = (i - 1) >> 1
        if (!less(i, p)) break
        swap(i, p)
        i = p
      }
    },
    pop () {
      const top = a[0]
      const last = a.pop()
      if (a.length) {
        a[0] = last
        for (let i = 0; ;) {
          const l = 2 * i + 1
          const r = l + 1
          let m = i
          if (l < a.length && less(l, m)) m = l
          if (r < a.length && less(r, m)) m = r
          if (m === i) break
          swap(i, m)
          i = m
        }
      }
      return top.task
    }
  }
}

// A line's cost (cheap lines first): its deviations (DEV each past the first option), the ranks of its options by
// today's score (RANK each), and how far along its spine each deviation stands (1 a decision).
const DEV = 1e6
const RANK = 100

// The search (see the head of this file) from root node `root` (the decision under way, every option of which lost):
// `plays` its options played ({ o, orders }, the legal), `limit` the playouts it may spend. → { line (the steps to follow,
// null where none won), playouts, spines, ms, found ({ dev, rank, at, kind }), and shaped (`c.shape` 'foes') where none
// won, `best`: the best line by its playout's value ({ value, line: its decisions' steps }) }
export function search (root, plays, c, limit = c.budget) {
  const t0 = performance.now()
  const q = heap()
  let spent = 0
  let spines = 0
  let best = null
  const lost = (L, value) => {
    if (c.shape === 'foes' && (!best || value > best.value + 1e-9)) best = { value, L }
  }
  const result = (line, L = null, kind = null) => ({
    line, playouts: spent, spines, ms: Math.round(performance.now() - t0), found: L && { dev: L.dev, rank: L.rank, at: L.index ?? null, kind },
    ...(!line && best && { best: { value: best.value, line: stepsOf(best.L, c, { tail: false }), dev: best.L.dev } })
  })
  // The root's lines: each of its options, by today's score.
  plays.filter((p) => p.orders).sort((a, b) => b.o.prior - a.o.prior).forEach((p, r) => {
    const L = { parent: null, via: NONE, at: root, o: p.o, orders: p.orders, dev: 1, rank: r, cost: r * RANK }
    q.push(L.cost + DEV, { expand: L })
  })
  while (q.size && spent < limit) {
    const task = q.pop()
    if (task.expand) {
      const L = task.expand
      // Its spine: the expert's own line after it, then its own end measured (a line of no more deviations).
      const sp = spineOf(stepNode(L.at, L.orders), c)
      spent++
      spines++
      const end = { parent: L, via: sp.nodes, at: null, end: sp.end, dev: L.dev, rank: L.rank, index: sp.nodes.length }
      if (sp.end.over ? sp.end.f.winner === 'party' : false) return result(stepsOf(end, c), end, 'spine')
      if (!sp.end.over && spent < limit) {
        const e = sp.end
        const p = rollout(e.done.size ? marked(e.f, e.done) : e.f, endTally(e.f), c)
        spent++
        if (p.parts.lost === 0) {
          const s = stepsOf(end, c)
          if (s.won) return result(s, end, 'spine')
        } else lost(end, p.value)
      }
      if (L.dev >= c.deviations) continue
      sp.nodes.forEach((n, i) => {
        deviationsAt(n, c).forEach((o, j) => {
          const child = { parent: L, via: sp.nodes.slice(0, i), at: n, o, orders: null, dev: L.dev + 1, rank: L.rank + j, index: i, cost: L.cost + DEV + j * RANK + i }
          q.push(child.cost, { evaluate: child })
        })
      })
    } else {
      const L = task.evaluate
      const n = L.at
      const b = boardOf(n)
      const p = play(b, n.next.uid, L.o, c, n.before, n.seen)
      if (p === null || !p.legal) continue
      spent++
      L.orders = p.orders
      if (won(p)) {
        const s = stepsOf(L, c)
        if (s.won) return result(s, L, 'deviation')
      } else lost(L, p.value)
      q.push(L.cost + DEV, { expand: L })
    }
  }
  return result(null)
}

// ── the teacher ──────────────────────────────────────────────────────────────────────────────────

// Option `o` of piece `uid` played out from `board` (teach.js playout, to the battle's end; `seen` the orders already
// played, `before` the board's endTally), its value shaped by `c.shape` (see the head of this file: 'foes', a lost one
// worth −lost + the share of the battle's foe HP removed by its end, autoplay.js foeShare, as progress reads it). → the
// playout ({ legal, sig, orders, value, parts }) or null for orders already played
function play (board, uid, o, c, before, seen) {
  if (c.shape !== 'foes') return playout(board, uid, o, { rounds: 0, turns: c.turns, weights: c.weights, before, seen })
  let last = null
  const turn = (g) => {
    last = g
    return P.expertTurn(g)
  }
  const p = playout(board, uid, o, { rounds: 0, turns: c.turns, weights: c.weights, before, seen, turn })
  return p?.legal && p.parts.lost ? { ...p, value: p.value + (last ? foeShare(last) : 0) } : p
}

// The one decision (teach.js teacherPick's, its rows kept): piece `uid` on `board` (the teacher's copy, the decided
// pieces marked done), `chosen` the expert's own orders' signature: its shortlist (teach.js optionsAt, the expert's own
// choice added where it lacks it) played out, the best taken (teach.js bestOf). With `c.shape` 'flat' it is teach.js's
// own (labelled); shaped, the same options played by `play`. → { orders, value, won (the best's playout won), playouts,
// single, plays (the legal options played: { o, orders }), rows (their { legal, value, lost }), read }
function decideOne (board, uid, chosen, c) {
  const read = readDecision(board, uid, c.cap)
  if (read.all.length === 1) {
    let orders = NONE
    try {
      orders = give(fork(board), uid, read.all[0])
    } catch {}
    return { orders, value: null, won: false, playouts: 0, single: true, plays: NONE, rows: NONE, read }
  }
  const plays = []
  const rows = []
  let n = 0
  if (c.shape !== 'foes') {
    const L = labelled(board, uid, chosen, { ...DEFAULTS, cap: c.cap, turns: c.turns, weights: c.weights }, read)
    n = L.rows.length
    L.plays.forEach((p, i) => {
      if (!p.orders) return
      plays.push({ o: p.o, orders: p.orders })
      rows.push({ legal: 1, value: L.rows[i].value, lost: L.rows[i].parts.lost })
    })
  } else {
    const before = endTally(board)
    const seen = new Set()
    let had = false
    const one = (o) => {
      const p = play(board, uid, o, c, before, seen)
      if (p === null) return
      n++
      if (p.sig === chosen) had = true
      if (!p.legal) return
      plays.push({ o, orders: p.orders })
      rows.push({ legal: 1, value: p.value, lost: p.parts.lost })
    }
    for (const o of read.short) one(o)
    const own = !had && chosen ? fromSignature(read.all, chosen) : null
    if (own) one(own)
  }
  return pickOf({ playouts: n, single: false, plays, rows, read })
}

// Decision `d` with its best taken: of its rows the best value (teach.js bestOf: ties to today's score). → `d` with
// orders, value, won and o (none for no legal option)
function pickOf (d) {
  const i = bestOf(d.rows, d.plays.map((p) => p.o))
  if (i < 0) return { ...d, orders: NONE, value: null, won: false, o: null }
  return { ...d, orders: d.plays[i].orders, value: d.rows[i].value, won: !d.rows[i].lost, o: d.plays[i].o }
}

// Width (see the head of this file): every legal option of piece `uid` on `board` the one decision `d` did not play,
// played out; the best of all of them taken where it is better (bestOf over all, ties to today's score), else `d`'s own.
// → `d` with `plays` and `rows` grown, and the extra `playouts`.
function widen (board, uid, d, c) {
  const u = board.byUid.get(uid)
  const seen = new Set(d.plays.map((p) => signature(p.orders, u.tile)))
  const before = endTally(board)
  let extra = 0
  const plays = d.plays.slice()
  const rows = d.rows.slice()
  for (const o of d.read.all) {
    const p = play(board, uid, o, c, before, seen)
    if (p === null) continue
    extra++
    if (!p.legal) continue
    plays.push({ o, orders: p.orders })
    rows.push({ legal: 1, value: p.value, lost: p.parts.lost })
  }
  const w = pickOf({ ...d, plays, rows })
  const better = w.o && (d.value === null || w.value > d.value + 1e-9)
  return { ...(better ? w : { ...d, plays, rows }), playouts: extra }
}

// Whether board `b` is in danger as the labeller's draw by the state reads it (teach.js drawOf): the Monarch in the foes'
// reach, or a foe with a clear line on it.
const inDanger = (b) => drawOf(b, null, { draw: 'state' }).danger === 'reach'

// A teacher for one run (see the head of this file): `turn(battle)` its orders for a turn of yours (End Turn last; none
// once the battle is over), `stats` what it spent: decisions, playouts (in all), single (decisions of one option), ms
// (the decisions' time), and its escalations: widened (decisions widened), widePlayouts, wideWins (where width found a
// win the shortlist had not), searched (searches made), searchPlayouts, searchMs, found (searches that found a line),
// followed (decisions and turns given by a line), broken (lines left: the board not the one expected), skipped (searches
// not made: the battle's budget spent, or a failed search's wait), and `searches` (each search: { battle, turn, uid,
// playouts, ms, found }).
export function createTeacher (cfg = {}) {
  const c = { ...SETTINGS, ...cfg }
  if (!WIDTHS.includes(c.width)) throw new Error(`width "${c.width}": one of ${WIDTHS.join(', ')}`)
  if (!SHAPES.includes(c.shape)) throw new Error(`shape "${c.shape}": one of ${SHAPES.join(', ')}`)
  const stats = { decisions: 0, playouts: 0, single: 0, ms: 0, widened: 0, widePlayouts: 0, wideWins: 0, searched: 0, searchPlayouts: 0, searchMs: 0, found: 0, bettered: 0, followed: 0, broken: 0, skipped: 0, searches: [] }
  const state = { battle: null, no: -1, line: null, spent: 0, wait: -Infinity }
  // The line's next step where it is of `kind` and the board is the one it expected (`key`, and the piece `uid` for a
  // decision); else the line is left (a board not the one expected), and the normal teacher decides.
  const follow = (kind, key, uid = null) => {
    const L = state.line
    if (!L) return null
    const s = L.steps[L.at]
    if (s && s.kind === kind && s.key === key && (uid === null || s.uid === uid)) {
      L.at++
      stats.followed++
      if (L.at >= L.steps.length) state.line = null
      return s
    }
    state.line = null
    stats.broken++
    return null
  }
  const decide = (f, done, next, turn) => {
    const u = f.byUid.get(next.uid)
    const board = marked(f, done)
    let d = decideOne(board, u.uid, signature(next.orders, u.tile), c)
    stats.playouts += d.playouts
    if (d.single) {
      stats.single++
      return d.orders
    }
    if (c.width !== 'off' && (!d.won || (c.width === 'danger' && inDanger(board)))) {
      const lost = !d.won
      d = widen(board, u.uid, d, c)
      stats.widened++
      stats.widePlayouts += d.playouts
      stats.playouts += d.playouts
      if (lost && d.won) stats.wideWins++
    }
    if (d.won) return d.orders
    if (!(c.budget > 0) || !d.plays.length) return d.orders
    if (state.spent >= c.battle || turn < state.wait) {
      stats.skipped++
      return d.orders
    }
    const root = { f, done, next, crossed: 0 }
    const s = search(root, d.plays, c, Math.min(c.budget, c.battle - state.spent))
    state.spent += s.playouts
    stats.searched++
    stats.searchPlayouts += s.playouts
    stats.playouts += s.playouts
    stats.searchMs += s.ms
    if (stats.searches.length < 200) stats.searches.push({ battle: state.no, turn, uid: u.uid, playouts: s.playouts, spines: s.spines, ms: s.ms, found: s.found, ...(s.best && { best: +s.best.value.toFixed(4), own: d.value }) })
    if (!s.line) {
      state.wait = turn + c.retry
      // Shaped, the best line by value where it is better than the one decision's own best (its decisions followed,
      // then the normal teacher again).
      if (!s.best || !(s.best.value > d.value + 1e-9)) return d.orders
      stats.bettered++
      state.line = s.best.line.steps.length > 1 ? { steps: s.best.line.steps, at: 1 } : null
      return s.best.line.steps[0].orders
    }
    stats.found++
    state.line = { steps: s.line.steps, at: 1 }
    return s.line.steps[0].orders
  }
  const turn = (battle) => {
    if (battle.over || battle.phase !== 'orders') return []
    if (state.battle !== battle) Object.assign(state, { battle, no: state.no + 1, line: null, spent: 0, wait: -Infinity })
    // A line's turn from its start: given as its playout gave it (the turn's plan read on the board first, as there).
    if (state.line?.steps[state.line.at]?.kind === 'turn') {
      nextPiece(battle)
      const s = follow('turn', keyOf(battle))
      if (s) return [...s.orders, END]
    }
    const out = []
    let next = nextPiece(battle)
    const f = fork(battle)
    const done = new Set()
    const put = (x) => {
      order(f, x)
      out.push(x)
    }
    const tail = () => {
      const s = follow('tail', keyOf(f, done))
      if (!s) return false
      for (const x of s.orders) {
        if (f.over) break
        put(x)
      }
      if (!f.over) out.push(END)
      return true
    }
    while (!f.over && next.uid !== null) {
      if (state.line?.steps[state.line.at]?.kind === 'tail' && tail()) return out
      const t = performance.now()
      const s = state.line ? follow('decide', keyOf(f, done), next.uid) : null
      const orders = s ? s.orders : decide(f, done, next, battle.turn)
      // (Given on a copy that differs only in the pieces marked done, its orders stand on the teacher's; one that would
      // not is left, as a playout leaves it.)
      for (const x of orders) {
        if (f.over) break
        try {
          put(x)
        } catch {
          break
        }
      }
      done.add(next.uid)
      stats.decisions++
      stats.ms += performance.now() - t
      if (!f.over) next = nextPiece(marked(f, done))
    }
    if (f.over) return out
    if (state.line?.steps[state.line.at]?.kind === 'tail' && tail()) return out
    for (const x of P.untouchedOrders(fork(f))) put(x)
    if (!f.over) out.push(END)
    return out
  }
  return { c, stats, turn, get line () { return state.line } }
}

// ── runs ─────────────────────────────────────────────────────────────────────────────────────────

// The route `c.route` names installed (autoplay.js useRoute): 'learned' route.json's, where ROUTE_LEARNED is on (else
// the hand-built route); 'hand' the hand-built route; else a route configuration or its file; none named, the one in
// use. And the expert, ranker and forest as teach.js installs them.
function installAll (c) {
  install(c)
  if (c.route === 'learned') useRoute(undefined)
  else if (c.route === 'hand') useRoute(false)
  else if (c.route) useRoute(typeof c.route === 'string' ? JSON.parse(fs.readFileSync(c.route, 'utf8')) : c.route)
}

// What played (the base): the expert's model, the forest in use (its name, and a hash of it), the route in use (the
// learned tree's name, or 'hand').
export function baseOf () {
  const F = forestModel()
  const R = routeModel()
  return {
    expert: E.expertModel()?.name ?? null,
    forest: F ? { name: F.name ?? null, hash: hashString(JSON.stringify(F.data ?? F)).slice(0, 12) } : null,
    route: R ? { name: R.name ?? null, learned: ROUTE_LEARNED, about: (R.about ?? '').slice(0, 60) } : 'hand'
  }
}

// One run played by this teacher (as teach.js teacherRun plays one: out of battle the expert in use, a battle past the
// sim's bound on turns a stall). `battles`: stop once that many battles are over (0: the whole run); `fights`: stop as
// that many fights open. → { seed, player 'teacher', result, floor, progress, battles: { won, fought }, ms, decisions,
// playouts, single, decisionMs, settings, base, esc }
export function strongRun (seed, cfg = {}) {
  const T = createTeacher(cfg)
  const c = T.c
  installAll(c)
  const t0 = performance.now()
  const run = ablatedRun(seed)
  const rng = createRng(run.state.seed).stream('autoplay')
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
        if (!queue || queue.b !== b || queue.turn !== b.turn || !queue.orders.length) queue = { b, turn: b.turn, orders: T.turn(b) }
        action = queue.orders.shift()
      }
    } else action = policy(run, rng, 'expert')
    apply(run, action)
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
  const st = T.stats
  return {
    seed, player: 'teacher', result: s.result ?? null, floor: s.floor,
    progress: progressOf({ result: s.result, floor: s.floor, rank: fell?.rank ?? 1, share: fell?.share ?? 0 }),
    battles: { won, fought }, ms: Math.round(performance.now() - t0),
    decisions: st.decisions, playouts: st.playouts, single: st.single, decisionMs: Math.round(st.ms),
    settings: settingsLine(c), base: baseOf(),
    esc: {
      widened: st.widened, widePlayouts: st.widePlayouts, wideWins: st.wideWins, searched: st.searched, searchPlayouts: st.searchPlayouts,
      searchMs: Math.round(st.searchMs), found: st.found, bettered: st.bettered, followed: st.followed, broken: st.broken, skipped: st.skipped, searches: st.searches
    },
    ...(c.log && { log: s.log })
  }
}

// The settings a run's line records (the teacher's, its route and its forest's file as named).
const settingsLine = (c) => ({
  cap: c.cap, turns: c.turns, width: c.width, budget: c.budget, depth: c.depth, deviations: c.deviations, battle: c.battle, retry: c.retry, inner: c.inner, shape: c.shape ?? 'flat',
  ...(c.weights !== END_WEIGHTS && { weights: c.weights }), route: typeof c.route === 'object' && c.route ? c.route.name ?? 'given' : c.route ?? 'learned',
  ...(c.forestFile !== undefined && { forest: c.forestFile }), ...(c.expert && { expert: c.expert })
})

// The escalations over a set of the teacher's lines: decisions widened and searched a run, the playouts each took,
// lines found and followed. → { runs, widened, wideWins, searched, found, playoutsPerSearch, msPerSearch, followed,
// broken, skipped }
export function escalations (lines) {
  const T = lines.filter((r) => r.player === 'teacher' && r.esc)
  const sum = (k) => T.reduce((t, r) => t + (r.esc[k] ?? 0), 0)
  const searched = sum('searched')
  return {
    runs: T.length, widened: sum('widened'), wideWins: sum('wideWins'), widePlayouts: sum('widePlayouts'), searched, found: sum('found'), bettered: sum('bettered'),
    playoutsPerSearch: searched ? +(sum('searchPlayouts') / searched).toFixed(1) : null, msPerSearch: searched ? Math.round(sum('searchMs') / searched) : null,
    followed: sum('followed'), broken: sum('broken'), skipped: sum('skipped')
  }
}

// ── run directly ─────────────────────────────────────────────────────────────────────────────────

// A worker's job: a run by this teacher or by the expert in use ({ seed, player }), the route, expert and forest of
// `cfg` installed for either.
function job (j, cfg) {
  installAll(cfg)
  return j.player === 'teacher' ? strongRun(j.seed, cfg) : expertRun(j.seed, cfg)
}

// Runs `jobs` in worker threads of this module, `workers` at a time, handing each result to `done` as it ends.
async function pool (jobs, workers, cfg, done) {
  const { Worker } = await import('node:worker_threads')
  const queue = jobs.slice()
  const worker = async () => {
    const w = new Worker(new URL(import.meta.url), { workerData: { strongTeacher: true, cfg } })
    try {
      while (queue.length) {
        const j = queue.shift()
        done(await new Promise((resolve, reject) => {
          w.once('message', resolve)
          w.once('error', reject)
          w.postMessage(j)
        }))
        w.removeAllListeners('error')
      }
    } finally {
      await w.terminate()
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, worker))
}

async function main (arg, workers) {
  const seed = arg('seed', 'sim')
  const runs = Number(arg('runs', 64))
  const from = Number(arg('from', 0))
  const dir = arg('out', path.join(os.tmpdir(), `retinue-teacher2-${seed}`))
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const given = arg('weights', null)
  const forest = arg('forest', null)
  const route = arg('route', 'learned')
  // The settings it plays by (manifest.json's, a stage gone on with held to them), and what the workers get: the same
  // with the forest's configuration in place of its file.
  const settings = {
    cap: Number(arg('cap', SETTINGS.cap)), turns: Number(arg('turns', SETTINGS.turns)),
    weights: given ? { ...END_WEIGHTS, ...Object.fromEntries(given.split(',').map((kv) => kv.split('=')).map(([k, x]) => [k, Number(x)])) } : END_WEIGHTS,
    width: arg('width', SETTINGS.width), budget: Number(arg('budget', SETTINGS.budget)), depth: Number(arg('depth', SETTINGS.depth)),
    deviations: Number(arg('deviations', SETTINGS.deviations)), battle: Number(arg('battle', SETTINGS.battle)), retry: Number(arg('retry', SETTINGS.retry)),
    inner: arg('inner', SETTINGS.inner), ...(arg('shape', 'flat') !== 'flat' && { shape: arg('shape') }), route: route === 'learned' || route === 'hand' ? route : path.resolve(route),
    ...(forest !== null && { forestFile: forest === 'none' ? null : path.resolve(forest) }), ...(arg('expert', null) && { expert: path.resolve(arg('expert')) })
  }
  if (!WIDTHS.includes(settings.width)) throw new Error(`--width ${settings.width}: one of ${WIDTHS.join(', ')}`)
  if (!['short', 'all'].includes(settings.inner)) throw new Error(`--inner ${settings.inner}: short or all`)
  if (settings.shape && !SHAPES.includes(settings.shape)) throw new Error(`--shape ${settings.shape}: one of ${SHAPES.join(', ')}`)
  const cfg = { ...settings, ...(forest !== null && { forest: forest === 'none' ? null : JSON.parse(fs.readFileSync(settings.forestFile, 'utf8')) }) }
  installAll(cfg)
  fs.mkdirSync(dir, { recursive: true })
  const runsFile = path.join(dir, 'runs.jsonl')
  const manifestFile = path.join(dir, 'manifest.json')
  const had = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null
  if (had && JSON.stringify(had.settings) !== JSON.stringify(settings)) throw new Error(`${dir} was played with other settings (${JSON.stringify(had.settings)}): take another --out`)
  const manifest = (extra = {}) => ({ made: new Date().toISOString(), settings, base: baseOf(), ...extra })
  if (!had) fs.writeFileSync(manifestFile, JSON.stringify(manifest(), null, 1) + '\n')
  const seeds = Array.from({ length: runs }, (_, k) => `${seed}-${from + k}`)
  const key = (r) => `${r.player}|${r.seed}`
  const done = new Set(read(runsFile).map(key))
  // A seed's two runs side by side in the queue (the teacher's first, the longer), so the pairs fill in order.
  const jobs = seeds.flatMap((s) => ['teacher', 'expert'].map((player) => ({ seed: s, player }))).filter((j) => !done.has(key(j)))
  const t0 = performance.now()
  if (jobs.length && !process.argv.includes('--report-only')) {
    console.log(`playing ${jobs.length} runs (seeds ${seeds[0]}…${seeds.at(-1)}, this teacher's and the expert's; ${done.size} done in ${dir}) on ${workers} workers: ${JSON.stringify(settingsLine(settings))}; base ${JSON.stringify(baseOf())}`)
    let n = 0
    await pool(jobs, workers, cfg, (r) => {
      fs.appendFileSync(runsFile, JSON.stringify(r) + '\n')
      const s = ((performance.now() - t0) / 1000).toFixed(0)
      const e = r.esc
      const cost = r.player === 'teacher' && r.decisions ? `; ${r.decisions} decisions, ${(r.decisionMs / r.decisions).toFixed(0)} ms and ${(r.playouts / r.decisions).toFixed(1)} playouts each; widened ${e.widened} (${e.wideWins} won), searched ${e.searched} (${e.found} found, ${e.searchPlayouts} playouts), followed ${e.followed}, broken ${e.broken}` : ''
      console.log(`  ${++n}/${jobs.length} ${r.player.padEnd(7)} ${r.seed}: ${r.result ?? 'lost'} on floor ${r.floor}, progress ${r.progress.toFixed(3)}, battles ${r.battles.won}/${r.battles.fought}, ${(r.ms / 1000).toFixed(1)} s${cost} (${s} s in)`)
    })
  }
  const wall = (performance.now() - t0) / 1000
  const want = new Set(seeds)
  const lines = read(runsFile).filter((r) => want.has(r.seed))
  const rep = { seeds: `${seeds[0]}…${seeds.at(-1)}`, ...pairedReport(lines), escalations: escalations(lines) }
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(rep, null, 1) + '\n')
  fs.writeFileSync(manifestFile, JSON.stringify(manifest({
    counts: { teacher: lines.filter((r) => r.player === 'teacher').length, expert: lines.filter((r) => r.player === 'expert').length },
    wall: +((had?.wall ?? 0) + (jobs.length ? wall : 0)).toFixed(1), workers
  }), null, 1) + '\n')
  const x = rep.escalations
  console.log([...pairedLines(rep),
    `  escalations     widened ${x.widened} decisions (${x.wideWins} found a win), searched ${x.searched} (${x.found} found a line, ${x.bettered} a better loss; ${x.playoutsPerSearch ?? '-'} playouts and ${x.msPerSearch ?? '-'} ms a search), followed ${x.followed}, broken ${x.broken}, skipped ${x.skipped} (${x.runs} runs)`
  ].join('\n'))
}

if (!isMainThread && workerData?.strongTeacher) {
  parentPort.on('message', (j) => parentPort.postMessage(job(j, workerData.cfg)))
} else if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, def) => {
    const i = process.argv.indexOf('--' + name)
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
  }
  await main(arg, Number(arg('workers', Math.max(1, Math.min(4, os.availableParallelism() - 4)))))
}
