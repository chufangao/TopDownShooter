// The battle solver, offline and never shipped: a beam search over whole turns to the battle's end, the strong player
// a battle's difficulty is read with. The battle is deterministic and one-sided (foe.js plays the foes as a function of
// the board), so a line found on copies plays the same on the board, and is checked to. It reads the board with the
// game's own code alone (turns.js, foe.js).
//   A node: a board at the start of your orders, and the turns' orders that reached it.
//   A turn, piece by piece, in two piece orders (acting order, and its keys-first one: a keyed blow's or a lock's key
//   before the blows that pay it): each piece's options filtered (candidates: the K best by what each does less what it
//   takes, every kill, every act laying a status a piece yet to act can pay, the hold with its End-Turn act given at
//   once, the move nearest the foes); after each piece the B best plans by the board's score (scoreOf), one board once.
//   Then End Turn: the foes reply, a child.
//   Across turns: the W best children by the score, ties by the value so far, one board once (boardHash).
//   A battle's end is valued by END_WEIGHTS (valueOf): the best won line, else the one that held out longest. Widening:
//   WIDTHS in turn, stopping at the first that wins, under a wall-clock cap, or a budget of plans given (the search then
//   a pure function of the board).
import { unitDef } from '../content.js'
import { fork, order, orderable, canAct, usable, stalled, targetsFrom, helped, pick } from './turns.js'
import { danger, dangerAt, options, estimate, better, EPS, NOBODY } from './foe.js'
import { alive, isBlow, distanceBetween } from './unit.js'

// (K, B, W) a level: options kept a piece, plans kept a turn, nodes kept across turns.
export const WIDTHS = Object.freeze([Object.freeze([4, 16, 16]), Object.freeze([6, 48, 64]), Object.freeze([8, 128, 256])])
// `cap` seconds a battle's search, and half as much again for its slack; `budget` plans a battle's search (pieces'
// options given; with one, no cap unless named); `per` each act at a target kept once of the K (a move alone twice);
// `sharp` the slack under which a turn of the line is sharp; `sample` the children a turn's slack reads at most; `turns`
// a line's rounds at most.
export const SOLVER = Object.freeze({ cap: 20, budget: Infinity, per: 1, sharp: 0.1, sample: 16, turns: Infinity })
// The board's score (scoreOf) past the value so far: `foes` the weight of the foes' share of HP left against the souls'
// share lost (1); `danger` the share of what the foes could deal yours next turn counted as dealt, `threat` the share of
// what yours could deal them.
export const SCORE = Object.freeze({ foes: 2, danger: 0.1, threat: 0.5 })
// The defaults as the environment sets them (autoplay.js --solver-cap, --solver-budget, --solver-widths, --solver-slack:
// a pool's workers inherit them).
const budgetOf = () => Number(process.env.RETINUE_SOLVER_BUDGET ?? SOLVER.budget)
const capOf = (budget = budgetOf()) => Number(process.env.RETINUE_SOLVER_CAP ?? (budget < Infinity ? Infinity : SOLVER.cap))
const widthsOf = () => process.env.RETINUE_SOLVER_WIDTHS?.split(',').map((w) => w.split('/').map(Number)) ?? WIDTHS
const slackOn = () => process.env.RETINUE_SOLVER_SLACK !== '0'
// The knobs as the environment sets them; `pure`: a budget and no cap, so that a solved battle is a function of its board.
export function solverKnobs () {
  const budget = budgetOf()
  const cap = capOf(budget)
  return { budget, cap, widths: widthsOf(), slack: slackOn(), pure: budget < Infinity && cap === Infinity }
}

const END = Object.freeze({ type: 'end' })

// ── the board's identity ─────────────────────────────────────────────────────────────────────────

// A board as play reads it, for merging and the replay check: the battle's turn, stage, outcome, waves and reserve;
// each unit's every plain field (uid, tile, HP, energy, moved, acted, shrugs, phase, raised…), its statuses (id, dur,
// stacks, turn, stage, by, fresh) and cooldowns. No cache, plan or event: they change no play.
export function boardHash (b) {
  let s = `${b.turn}|${b.phase}|${b.stage}|${b.over}|${b.winner}|${b.reason}|${b.foeIn}|${b.raised}|${b.crumbled}|${b.nextUid}|${b.roster}|` +
    `${b.waveAt.join()}|${b.waves.map((w) => `${w.wave}:${+w.entered}`).join()}|${b.reserve.map((u) => u.uid).join()}`
  for (const u of b.units) {
    s += '\n'
    for (const k in u) {
      const v = u[k]
      if (v === null || typeof v !== 'object') s += `${k}=${v};`
    }
    for (const x of u.statuses) s += `[${x.id},${x.dur},${x.stacks},${x.turn},${x.stage},${x.by},${x.fresh}]`
    for (const k in u.cooldowns) s += `{${k}:${u.cooldowns[k]}}`
  }
  return s
}

// ── the value and the score ──────────────────────────────────────────────────────────────────────

// What the value reads of a board as a battle's line begins: the Monarch's share of its max HP, each soul's HP and max
// (no shadow), their max summed, the round; and for the score the foes' HP (foesLeft).
export function tallyOf (b) {
  const m = b.monarch
  const souls = new Map()
  let max = 0
  for (const u of b.units) {
    if (!alive(u) || u.side !== 'party' || u === m || u.shadow) continue
    souls.set(u.uid, { hp: u.hp, maxHp: u.maxHp })
    max += u.maxHp
  }
  return { m: m ? Math.max(0, m.hp) / m.maxHp : 0, souls, max, turn: b.turn, foes: foesLeft(b) }
}

// The value of board `g` against `before` (tallyOf), the labels' value of a battle's end (END_WEIGHTS: lost 10, Monarch
// 3, own 1, turn 0.02): −lost where lost or stalled; else −Monarch × its share of max HP lost − own × the souls' share
// lost (a fallen soul all of its share) − turn × the rounds taken. `won` reads a battle under way as won now: the value
// so far.
export function valueOf (before, g, won = g.over && g.winner === 'party') {
  if (!won) return -END_WEIGHTS.lost
  const m = g.monarch
  const mAfter = m && m.hp > 0 ? m.hp / m.maxHp : 0
  let had = 0
  let kept = 0
  let fallen = 0
  for (const [uid, s] of before.souls) {
    had += s.hp
    const x = g.byUid.get(uid)
    if (x && !alive(x)) fallen += s.maxHp - s.hp
  }
  for (const u of g.units) if (alive(u) && u.side === 'party' && u !== m && !u.shadow) kept += u.hp
  const own = before.max > 0 ? (had - kept + fallen) / before.max : 0
  return r6(-END_WEIGHTS.monarch * (before.m - mAfter) - END_WEIGHTS.own * own - END_WEIGHTS.turn * (g.turn - before.turn))
}
export const END_WEIGHTS = Object.freeze({ lost: 10, monarch: 3, own: 1, turn: 0.02 })
const r6 = (x) => Math.round(x * 1e6) / 1e6

// The board's score against `before` (tallyOf), for the beam's plans and nodes. A won board ranks above every other (its
// value above WON), a lost one below (the fewer foes' HP left the higher); else
//   the value so far (valueOf as won) + the shadows' and summons' HP standing (each HP a soul's: they fight, and an
//   overrun counts them) − SCORE.foes × (the foes' HP left − SCORE.threat × what yours could deal them next turn), a
//   share of the foes' HP as the line began (the field's and the reserve's) − SCORE.danger × what the foes could deal
//   yours next turn, read as the value reads a loss (the Monarch 3 × its share, the battle lost where it would fall; a
//   soul its share, all of it where it would fall; a shadow its HP).
// Both sides' next turns are read off foe.js danger. `map`: the danger map for your side, made already.
export function scoreOf (g, before, map = null) {
  if (g.over) return g.winner === 'party' ? WON + valueOf(before, g, true) : -WON - foesLeft(g) / Math.max(1, before.foes)
  map ??= danger(g, 'party')
  const m = g.monarch
  const max = Math.max(1, before.max)
  let loss = 0
  let shadows = 0
  if (m && alive(m)) {
    const d = dangerAt(g, m, m.tile, map)
    loss += d >= m.hp ? END_WEIGHTS.lost : END_WEIGHTS.monarch * d / m.maxHp
  }
  for (const u of g.units) {
    if (!alive(u) || u.side !== 'party' || u === m) continue
    const d = dangerAt(g, u, u.tile, map)
    if (u.shadow) shadows += u.hp
    loss += END_WEIGHTS.own * (d >= u.hp && !u.shadow ? u.maxHp : d) / max
  }
  const theirs = danger(g, 'foe')
  let dealt = 0
  for (const x of g.units) if (x.side === 'foe' && alive(x)) dealt += dangerAt(g, x, x.tile, theirs)
  const foes = SCORE.foes * (foesLeft(g) - SCORE.threat * dealt) / Math.max(1, before.foes)
  return valueOf(before, g, true) + END_WEIGHTS.own * shadows / max - foes - SCORE.danger * loss
}
const WON = 1e6

// The foes' HP left: the living on the field and the reserve's.
const foesLeft = (b) => b.units.reduce((n, u) => n + (u.side === 'foe' && alive(u) ? u.hp : 0), 0) + b.reserve.reduce((n, u) => n + u.hp, 0)

// What a won line keeps (the margin): the Monarch's share of its max HP, and the souls' HP left of their max as it began.
function marginOf (before, g) {
  const m = g.monarch
  let kept = 0
  for (const u of g.units) if (alive(u) && u.side === 'party' && u !== m && !u.shadow) kept += u.hp
  return { monarch: m ? +(Math.max(0, m.hp) / m.maxHp).toFixed(3) : null, souls: before.max > 0 ? +(kept / before.max).toFixed(3) : null }
}

// ── the search ───────────────────────────────────────────────────────────────────────────────────

// Solves the battle from `battle` (orders phase; never touched): the levels of `widths` in turn to the first that wins,
// under `cap` seconds and `budget` plans. → { line: [{ turn, hash, orders }] (each turn's board and its orders, End Turn
// last but where the battle ended in the turn), won, value, end (the line's last board), stats }
// stats: { solved, level (of widths, 1-based, after which a won line was held; null for none), ms, nodes (turns
// expanded), plans (pieces' options given), truncated (the cap or the budget cut a level short), margin (a won line's),
// value, turns, slack (slackOf; null for a turn not read), sharp (the line's turns, 0-based, with slack under `sharp`),
// slackMs }. `slack` false: no slack read. `moving` false: every piece acts from where it stands.
export function solve (battle, {
  budget = budgetOf(), cap = capOf(budget), widths = widthsOf(), per = SOLVER.per, sharp = SOLVER.sharp, sample = SOLVER.sample, turns = SOLVER.turns,
  slack = slackOn(), moving = true
} = {}) {
  const t0 = Date.now()
  const deadline = t0 + cap * 1000
  const root = fork(battle)
  const before = tallyOf(root)
  const stats = { solved: false, level: null, ms: 0, nodes: 0, plans: 0, truncated: false, margin: null, value: null, turns: 0, slack: [], sharp: [], slackMs: 0 }
  let best = null
  let won = null
  for (let i = 0; i < widths.length && !stats.truncated; i++) {
    const [K, B, W] = widths[i]
    const s = beam(root, before, { K, B, W, per, turns, deadline, budget: budget - stats.plans, moving })
    stats.nodes += s.nodes
    stats.plans += s.plans
    stats.truncated = s.truncated
    if (s.best && (!best || outranks(s.best, best))) best = s.best
    if (best?.won) {
      stats.level = i + 1
      won = s
      break
    }
  }
  best ??= endOf(before, root, [], true)
  replay(battle, best)
  stats.solved = best.won
  stats.value = best.value
  stats.turns = best.line.length
  if (best.won) stats.margin = marginOf(before, best.board)
  stats.ms = Date.now() - t0
  if (won && slack) {
    stats.slack = slackOf(won, root, best.line, { sample, deadline: Date.now() + cap * 500 })
    stats.sharp = stats.slack.flatMap((x, t) => (x !== null && x < sharp ? [t] : []))
    stats.slackMs = Date.now() - t0 - stats.ms
  }
  return { line: best.line, won: best.won, value: best.value, end: best.board, stats }
}

// The better of two lines' ends: won first, then the higher value; of lines not won, one still open (the cap cut it)
// before one lost, then the more rounds held, then the more of the foes' HP taken.
function outranks (a, b) {
  if (a.won !== b.won) return a.won
  if (a.won) return a.value > b.value + EPS
  if (a.open !== b.open) return a.open
  if (a.board.turn !== b.board.turn) return a.board.turn > b.board.turn
  return foesLeft(a.board) < foesLeft(b.board) - EPS
}

// An end of a line: its board, its line, won, value, open (still under way).
const endOf = (before, board, line, open = false) => {
  const won = board.over && board.winner === 'party'
  return { board, hash: boardHash(board), line, won, value: open ? null : valueOf(before, board, won), open }
}

// One level of the search, `budget` plans at most. → { nodes, plans, truncated, best (the best end of a line met, by
// outranks: won, lost, or open where the cap or the budget stopped it), edges (Map an expanded node's digest → its
// children's), wins (won ends' digests), ctx }. The books keep digests, not boards: a line may run to the turn guard.
function beam (root, before, { K, B, W, per, turns, deadline, budget, moving }) {
  const out = { nodes: 0, plans: 0, truncated: false, best: null, edges: new Map(), wins: new Set() }
  const meet = (end) => {
    if (!out.best || outranks(end, out.best)) out.best = end
  }
  const ctx = { K, B, per, deadline, budget, before, out, moving }
  out.ctx = ctx
  let layer = [{ board: root, hash: boardHash(root), line: [] }]
  let bestWon = -Infinity
  for (let depth = 0; layer.length; depth++) {
    const next = new Map()
    for (const node of layer) {
      let kids
      try {
        kids = expand(node, ctx)
      } catch (err) {
        if (err !== CUT) throw err
        out.truncated = true
        break
      }
      out.nodes++
      out.edges.set(digest(node.hash), kids.map((c) => digest(c.hash)))
      for (const c of kids) {
        const line = [...node.line, { turn: node.board.turn, hash: node.hash, orders: c.orders }]
        if (c.board.over || stalled(c.board) || line.length >= turns) {
          const end = endOf(before, c.board, line, !c.board.over && !stalled(c.board))
          meet(end)
          if (end.won) {
            out.wins.add(digest(c.hash))
            bestWon = Math.max(bestWon, end.value)
          }
        } else if (!next.has(c.hash)) next.set(c.hash, { board: c.board, hash: c.hash, line })
      }
    }
    if (out.truncated) {
      // The line still open where the cap or the budget stopped the search: the best of this layer by the score.
      if (layer[0].line.length) meet(endOf(before, layer[0].board, layer[0].line, true))
      break
    }
    // The W best by the score, ties by the value so far; none that cannot better a win found.
    const ranked = [...next.values()]
    for (const c of ranked) {
      c.score = scoreOf(c.board, before)
      c.soFar = valueOf(before, c.board, true)
    }
    ranked.sort((a, b) => (Math.abs(a.score - b.score) > EPS ? b.score - a.score : b.soFar - a.soFar))
    layer = ranked.slice(0, W)
    if (bestWon > -Infinity) layer = layer.filter((c) => c.soFar - END_WEIGHTS.turn > bestWon + EPS)
  }
  return out
}
const CUT = new Error('the solver\'s cap or budget')

// A node's children: the plans of its turn in each piece order (turnPlans), End Turn given, one board once.
// → [{ board, hash, orders }]
function expand (node, ctx) {
  const board = node.board
  const pieces = board.units.filter((u) => orderable(board, u) && !u.acted).sort((a, b) => a.ord - b.ord)
  const turnOrder = pieces.map((u) => u.uid)
  const keyOrder = keysFirst(board, pieces)
  const orders = keyOrder && keyOrder.join() !== turnOrder.join() ? [turnOrder, keyOrder] : [turnOrder]
  const kids = new Map()
  for (const seq of orders) {
    for (const p of turnPlans(board, seq, ctx)) {
      const os = p.orders.slice()
      if (!p.f.over) {
        order(p.f, END)
        os.push(END)
      }
      const h = boardHash(p.f)
      if (!kids.has(h)) kids.set(h, { board: p.f, hash: h, orders: os })
    }
  }
  return [...kids.values()]
}

// The pieces' uids in acting order with the key-layers first: those with a usable blow laying a status another piece's
// usable keyed blow pays, or a key of a living foe's lock where another piece has a usable blow (turns.js keyOn,
// lockShare); null where none does.
function keysFirst (board, pieces) {
  const locks = new Set()
  for (const x of board.units) if (x.side === 'foe' && alive(x)) for (const k of unitDef(x.id).lock?.keys ?? NONE) locks.add(k)
  const blows = (u) => u.kit.filter((a) => isBlow(a) && usable(board, u, a))
  const laid = (u) => blows(u).flatMap((a) => a.effects.filter((e) => e.op === 'apply_status').map((e) => e.status))
  const paid = (u) => blows(u).flatMap((a) => a.effects.filter((e) => e.keyed).map((e) => e.keyed.status))
  const pays = (v, k) => paid(v).includes(k) || (locks.has(k) && blows(v).length > 0)
  const layers = new Set(pieces.filter((u) => laid(u).some((k) => pieces.some((v) => v !== u && pays(v, k)))))
  if (!layers.size) return null
  return [...pieces.filter((u) => layers.has(u)), ...pieces.filter((u) => !layers.has(u))].map((u) => u.uid)
}

// The turn's plans on `board` in piece order `seq`: each plan's next piece takes each of its candidates on a copy, a move
// alone with its End-Turn act given at once; the B best by the score kept after each piece. Each plan keeps its board's
// danger map for your side (`map`: its shields are that board's units). → [{ f (the board, End Turn not yet), orders }]
function turnPlans (board, seq, { K, B, per, deadline, budget, before, out, moving }) {
  const f = copy(board)
  let plans = [{ f, orders: [], value: 0, map: danger(f, 'party') }]
  for (let i = 0; i < seq.length; i++) {
    const uid = seq[i]
    const later = seq.slice(i + 1)
    const next = new Map()
    for (const p of plans) {
      if (out.plans >= budget || Date.now() > deadline) throw CUT
      const u = p.f.byUid.get(uid)
      if (p.f.over || !u || !orderable(p.f, u) || u.acted) {
        const h = boardHash(p.f)
        if (!next.has(h)) next.set(h, p)
        continue
      }
      for (const o of candidates(p.f, u, later, K, per, p.map, moving)) {
        const g = copy(p.f)
        const gu = g.byUid.get(uid)
        let given
        try {
          given = commit(g, gu, o)
          if (!o.ability && !g.over) {
            const x = untouchedOrder(g, gu)
            if (x) {
              order(g, x)
              given.push(x)
            }
          }
        } catch {
          continue
        }
        out.plans++
        const h = boardHash(g)
        if (next.has(h)) continue
        const gm = g.over ? null : danger(g, 'party')
        next.set(h, { f: g, orders: [...p.orders, ...given], value: scoreOf(g, before, gm), map: gm })
      }
    }
    plans = [...next.values()].sort((a, b) => (Math.abs(a.value - b.value) > EPS ? b.value - a.value : 0)).slice(0, B)
  }
  return plans
}

// Piece `u`'s candidates on `f` (`map` its danger map for your side), the best first: its options (foe.js options), each
// scored by what it would do (foe.js estimate: dealt and kills, keys paid and locks read) less what it would take (the
// danger where it would stand and the counter it draws); the K best, an act at a target `per` times (a move alone
// twice), the hold where it stands, the best move alone of those nearest the foes where it nears them, and the best tile
// of every kill and of every act laying a key one of `later` can pay. `moving` false: its options where it stands alone.
export function candidates (f, u, later, K, per = SOLVER.per, map = danger(f, 'party'), moving = true) {
  const list = options(f, u, { moving })
  for (const o of list) {
    const e = estimate(f, u, o, NOBODY)
    o.kill = e.kill
    o.score = e.dealt + e.kill - dangerAt(f, u, o.tile, map) - e.counter
    o.road = -o.path.length
  }
  list.sort(byScore)
  const keep = new Set(spread(list, K, per))
  const stay = list.find((o) => !o.ability && o.tile === u.tile)
  if (stay) keep.add(stay)
  const near = nearest(f, u, list)
  if (near) keep.add(near)
  const pays = paidBy(f, later)
  const acts = new Set()
  for (const o of list) {
    if (!o.ability || acts.has(kindOf(o))) continue
    if (o.kill > 0 || lays(u, o, pays)) {
      keep.add(o)
      acts.add(kindOf(o))
    }
  }
  return list.filter((o) => keep.has(o))
}
const byScore = (a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0)

// Of `list` (the best first), the first move alone of those that end nearest a living foe, where nearer than `u` stands.
function nearest (f, u, list) {
  const foes = f.units.filter((x) => x.side !== u.side && alive(x))
  const gap = (t) => foes.reduce((n, x) => Math.min(n, distanceBetween(t, u.size, x.tile, x.size)), Infinity)
  let best = null
  let d = gap(u.tile)
  for (const o of list) {
    if (o.ability || o.tile === u.tile) continue
    const g = gap(o.tile)
    if (g < d) {
      d = g
      best = o
    }
  }
  return best
}

// What an option does: its act at its target, or a move alone.
const kindOf = (o) => (o.ability ? `${o.ability.id}:${o.target.uid}` : 'move')
// The first `n` of `list` (in its order), no more than `per` of one act at one target (twice that of moves alone): so
// that the same act from a dozen tiles does not crowd out the others.
function spread (list, n, per) {
  const out = []
  const count = new Map()
  for (const o of list) {
    if (out.length >= n) break
    const k = kindOf(o)
    const c = count.get(k) ?? 0
    if (c >= (k === 'move' ? 2 * per : per)) continue
    count.set(k, c + 1)
    out.push(o)
  }
  return out
}

// What the pieces of `later` could pay this turn: the statuses their usable keyed blows are keyed to (`keyed`), and
// whether any has a usable blow at all (`blows`: a lock's key opens it to any).
function paidBy (f, later) {
  const keyed = new Set()
  let blows = false
  for (const uid of later) {
    const v = f.byUid.get(uid)
    if (!v || !orderable(f, v) || !canAct(f, v)) continue
    for (const a of v.kit) {
      if (!isBlow(a) || !usable(f, v, a)) continue
      blows = true
      for (const e of a.effects) if (e.keyed) keyed.add(e.keyed.status)
    }
  }
  return { keyed, blows }
}
// Whether option `o` of `u` lays a key on a foe that `pays` (paidBy) pays: a keyed blow's status, or one of its lock's keys.
const lays = (u, o, pays) => o.target.side !== u.side && o.ability.effects.some((e) => e.op === 'apply_status' &&
  (pays.keyed.has(e.status) || (pays.blows && (unitDef(o.target.id).lock?.keys.includes(e.status) ?? false))))

// ── orders on a copy ─────────────────────────────────────────────────────────────────────────────

// A copy of the battle to play ahead on (turns.js fork), with the caches that stay true: each unit's stats (checked on
// read) and each side's synergies. Not the rules' list: its rules point at the units they were made with.
function copy (battle) {
  const f = fork(battle)
  f.cache = new Map(battle.cache)
  f.syn = { ...battle.syn }
  return f
}

// Option `o` of piece `u` given on `f`: its move, by the path the option was read with, then its act. → the orders.
function commit (f, u, o) {
  const out = []
  if (o.tile !== u.tile) {
    const mv = { type: 'move', uid: u.uid, tile: o.tile }
    order(f, mv, o.path)
    out.push(mv)
  }
  if (f.over || !o.ability) return out
  const act = { type: 'act', uid: u.uid, ability: o.ability.id, target: o.target.uid }
  order(f, act)
  out.push(act)
  return out
}

// What End Turn has piece `u` yet to act do where it stands (turns.js untouched), as an order: its basic blow at `pick`'s
// foe, else its basic heal on the most wounded it can help, each where its energy pays for it; null for nothing.
function untouchedOrder (f, u) {
  if (!canAct(f, u)) return null
  const b = u.basic
  const foes = b && usable(f, u, b) ? targetsFrom(f, u, b) : NONE
  if (foes.length) return { type: 'act', uid: u.uid, ability: b.id, target: pick(f, u, foes).uid }
  const m = u.mend
  const allies = m && usable(f, u, m) ? helped(f, u, m, u.tile) : NONE
  if (allies.length) return { type: 'act', uid: u.uid, ability: m.id, target: allies.slice().sort((p, q) => p.hp / p.maxHp - q.hp / q.maxHp || p.uid - q.uid)[0].uid }
  return null
}
const NONE = Object.freeze([])

// ── the slack and the replay check ───────────────────────────────────────────────────────────────

// The slack of each turn of `line` from `root` in level `s`: of its node's children (the distinct boards its turn's plans
// led to after End Turn, its board replayed and expanded again: the same children, or the search is not a function of
// the board; `sample` of them at most, evenly spread), the share with a won end found below it. → [share | null for a
// node not expanded, or one past `deadline`]
function slackOf (s, root, line, { sample, deadline }) {
  const memo = new Map()
  const found = (h) => {
    let v = memo.get(h)
    if (v !== undefined) return v
    memo.set(h, false)
    v = s.wins.has(h) || (s.edges.get(h) ?? NONE).some(found)
    memo.set(h, v)
    return v
  }
  const ctx = { ...s.ctx, deadline: Infinity, budget: Infinity, out: { plans: 0 } }
  const g = fork(root)
  return line.map((t) => {
    const had = s.edges.get(digest(t.hash))
    const kids = had && Date.now() <= deadline ? expand({ board: g, hash: t.hash, line: [] }, ctx).map((c) => digest(c.hash)) : null
    for (const o of t.orders) order(g, o)
    if (!kids) return null
    if (kids.join() !== had.join()) throw new Error(`solver: turn ${t.turn}'s node expanded twice gave two sets of children`)
    const read = kids.length <= sample ? kids : Array.from({ length: sample }, (_, i) => kids[Math.floor(i * kids.length / sample)])
    return +(read.filter(found).length / read.length).toFixed(3)
  })
}

// A board hash's digest (cyrb53), for the slack's books: two boards of one digest misread a share, never a play.
function digest (h) {
  let a = 0xdeadbeef
  let b = 0x41c6ce57
  for (let i = 0; i < h.length; i++) {
    const c = h.charCodeAt(i)
    a = Math.imul(a ^ c, 2654435761)
    b = Math.imul(b ^ c, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return 4294967296 * (2097151 & b) + (a >>> 0)
}

// The replay check: line `r` given on a fresh copy of `battle` order by order must reach its boards, each turn's start
// and its end, else the fork leaked or the battle is not deterministic: a game bug, thrown with the board.
export function replay (battle, r) {
  const g = fork(battle)
  for (const [t, step] of r.line.entries()) {
    const at = boardHash(g)
    if (at !== step.hash) throw new Error(`solver replay: turn ${t} (${step.turn}) begins on another board\n${diffOf(step.hash, at)}`)
    for (const o of step.orders) order(g, o)
  }
  const at = boardHash(g)
  if (at !== r.hash) throw new Error(`solver replay: the line ends on another board\n${diffOf(r.hash, at)}`)
  return g
}
// The lines where two board hashes part, for the report of a replay that failed.
const diffOf = (a, b) => {
  const x = a.split('\n')
  const y = b.split('\n')
  return x.flatMap((l, i) => (l === y[i] ? [] : [`  searched ${l}\n  replayed ${y[i]}`])).join('\n')
}

// ── the solver as a turn policy ──────────────────────────────────────────────────────────────────

// The solved lines by battle: Map board hash → that turn's orders, and the line's turns.
const LINES = new WeakMap()
// Listeners on each solve: fn({ stats, line }, battle), for the reports (useSolverHook).
const HOOKS = new Set()
export const useSolverHook = (fn) => {
  HOOKS.add(fn)
  return () => HOOKS.delete(fn)
}

// The solver's turn (player.js TURNS.solver): the battle solved once, its line's orders given turn by turn while the
// board is the line's, solved again where it is not (the line ran out, the cap having cut it; anything else is a
// determinism bug, `mismatch` in the stats). → that turn's orders (copies), End Turn last but where the battle ends.
export function solverTurn (battle, { cap, budget, widths, slack, moving, onSolve = null } = {}) {
  if (battle.over) return []
  const hash = boardHash(battle)
  const had = LINES.get(battle)
  let orders = had?.byHash.get(hash)
  if (!orders) {
    const r = solve(battle, {
      ...(budget !== undefined && { budget }), ...(cap !== undefined && { cap }), ...(widths !== undefined && { widths }), ...(slack !== undefined && { slack }), ...(moving !== undefined && { moving })
    })
    r.stats.mismatch = !!had?.turns.has(battle.turn)
    for (const fn of [onSolve, ...HOOKS]) fn?.({ stats: r.stats, line: r.line }, battle)
    const kept = { byHash: new Map(r.line.map((t) => [t.hash, t.orders])), turns: new Set(r.line.map((t) => t.turn)) }
    LINES.set(battle, kept)
    orders = kept.byHash.get(hash) ?? [END]
  }
  return orders.map((o) => ({ ...o }))
}
