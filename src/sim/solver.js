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
// The formation before a battle (bestFormation): the coming battle solved once a candidate formation, the best fielded;
// its line is the battle's.
import { unitDef } from '../content.js'
import { fork, order, orderable, canAct, usable, stalled, targetsFrom, helped, pick, createBattle } from './turns.js'
import { danger, dangerAt, mitigation, options, estimate, better, stepsOf, EPS, NOBODY } from './foe.js'
import { alive, isBlow, distanceBetween, footprint, tileX, tileY, LANES, DEPTH } from './unit.js'
import { battleSetup } from './run.js'

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
// The formation's (bestFormation): `budget` plans the solve of each candidate but the first (never more than a battle's
// own), `cap` the candidates solved at most.
export const PREP = Object.freeze({ budget: 5000, cap: 3 })
// The defaults as the environment sets them (autoplay.js --solver-cap, --solver-budget, --solver-widths, --solver-slack,
// --prep-budget, --prep-cap: a pool's workers inherit them).
const budgetOf = () => Number(process.env.RETINUE_SOLVER_BUDGET ?? SOLVER.budget)
const capOf = (budget = budgetOf()) => Number(process.env.RETINUE_SOLVER_CAP ?? (budget < Infinity ? Infinity : SOLVER.cap))
const widthsOf = () => process.env.RETINUE_SOLVER_WIDTHS?.split(',').map((w) => w.split('/').map(Number)) ?? WIDTHS
const slackOn = () => process.env.RETINUE_SOLVER_SLACK !== '0'
const prepBudgetOf = () => Math.min(Number(process.env.RETINUE_PREP_BUDGET ?? PREP.budget), budgetOf())
const prepCapOf = () => Number(process.env.RETINUE_PREP_CAP ?? PREP.cap)
// The knobs as the environment sets them; `pure`: a budget and no cap, so that a solved battle is a function of its board;
// `prep` the formation's.
export function solverKnobs () {
  const budget = budgetOf()
  const cap = capOf(budget)
  return { budget, cap, widths: widthsOf(), slack: slackOn(), pure: budget < Infinity && cap === Infinity, prep: { budget: prepBudgetOf(), cap: prepCapOf() } }
}

const END = Object.freeze({ type: 'end' })

// ── the board's identity ─────────────────────────────────────────────────────────────────────────

// A board as play reads it, for merging and the replay check: the battle's turn, stage, outcome, waves and reserve;
// each unit's every plain field (uid, tile, HP, energy, moved, acted, shrugs, phase, raised…), its statuses (id, dur,
// stacks, turn, stage, by, fresh) and cooldowns. No cache, plan or event: they change no play. → a 53-bit number: those
// values in that order as 32-bit words (word), each tagged by its type (val), a field by its name's own word (KEYS),
// each unit, status and cooldown opened by a word of its own, folded by two lanes; equal boards hash alike, two boards
// part but by a 53-bit collision.
export function boardHash (b) {
  ha = 0x9747b28c
  hb = 0x2545f491
  val(b.turn)
  val(b.phase)
  val(b.stage)
  val(b.over)
  val(b.winner)
  val(b.reason)
  val(b.foeIn)
  val(b.raised)
  val(b.crumbled)
  val(b.nextUid)
  val(b.roster)
  // The waves' turns as a list joins them: an empty one as nothing.
  word(b.waveAt.length)
  for (let i = 0; i < b.waveAt.length; i++) val(b.waveAt[i] ?? undefined)
  word(b.waves.length)
  for (const w of b.waves) {
    val(w.wave)
    val(+w.entered)
  }
  word(b.reserve.length)
  for (const u of b.reserve) val(u.uid)
  for (const u of b.units) {
    word(UNIT)
    let i = 0
    for (const k in u) {
      const v = u[k]
      if (v === null || typeof v !== 'object') {
        // The name's word, by the name last met in this place (the units' fields mostly come in one order).
        if (PLACED[i] !== k) {
          PLACED[i] = k
          PLACED_WORD[i] = keyOf(k)
        }
        word(PLACED_WORD[i])
        // A string by the one last met in this place, its word kept (the same string, the same word).
        if (typeof v === 'string' && PLACED_STRING[i] === v) word(PLACED_STRING_WORD[i])
        else {
          val(v)
          if (typeof v === 'string' && STRINGS.has(v)) {
            PLACED_STRING[i] = v
            PLACED_STRING_WORD[i] = STRINGS.get(v)
          }
        }
        i++
      }
    }
    for (const x of u.statuses) {
      word(STATUS)
      val(x.id)
      val(x.dur)
      val(x.stacks)
      val(x.turn)
      val(x.stage)
      val(x.by)
      val(x.fresh)
    }
    for (const k in u.cooldowns) {
      word(COOLDOWN)
      word(keyOf(k))
      val(u.cooldowns[k])
    }
  }
  return 4294967296 * (fmix(hb) & 0x1fffff) + (fmix(ha) >>> 0)
}
// The lanes, as boardHash folds its words.
let ha = 0
let hb = 0
// A word into both lanes: murmur3's mix of it, then lane a by murmur3's step, lane b by a multiply and a shift.
function word (w) {
  let k = Math.imul(w, 0xcc9e2d51)
  k = Math.imul((k << 15) | (k >>> 17), 0x1b873593)
  ha ^= k
  ha = (Math.imul((ha << 13) | (ha >>> 19), 5) + 0xe6546b64) | 0
  hb = Math.imul(hb ^ k, 0x2c1b3c6d)
  hb ^= hb >>> 15
}
// murmur3's finish.
function fmix (h) {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return h ^ (h >>> 16)
}
// A value as words, by its type: a 32-bit integer itself (−0 as 0), another number its 64 bits (every NaN one), a
// string its own word (STRINGS; past STRINGS_KEPT strings, its length and characters), true, false, null and undefined
// a word each; a function its source. Distinct values give distinct words, as their text would (but a number and a
// string of its digits).
function val (v) {
  if (typeof v === 'number') {
    if ((v | 0) === v) {
      word(INT)
      word(v)
    } else if (Number.isNaN(v)) word(NAN)
    else {
      F64[0] = v
      word(FLOAT)
      word(U32[0])
      word(U32[1])
    }
  } else if (typeof v === 'string') {
    const w = STRINGS.get(v) ?? named(v)
    if (w === undefined) str(STR, v)
    else word(w)
  } else if (v === true) word(TRUE)
  else if (v === false) word(FALSE)
  else if (v === null) word(NULL)
  else if (v === undefined) word(UNDEFINED)
  else str(TEXT, String(v))
}
function str (tag, s) {
  word(tag)
  word(s.length)
  for (let i = 0; i < s.length; i += 2) word(s.charCodeAt(i) | ((s.charCodeAt(i + 1) | 0) << 16))
}
// A string → its own word, in the order first met (from 3 × 2^29 on: no tag's, field's or opener's), STRINGS_KEPT at
// most: one met past them is read by its characters, every time (a string's words never change).
const STRINGS = new Map()
const STRINGS_KEPT = 4096
const named = (v) => (STRINGS.size < STRINGS_KEPT ? STRINGS.set(v, 0x60000000 + STRINGS.size).get(v) : undefined)
const F64 = new Float64Array(1)
const U32 = new Uint32Array(F64.buffer)
// The words that tag a value (val) and open a unit, a status, a cooldown: none a field's word (KEYS: from 2^29 on).
const [INT, FLOAT, NAN, STR, TEXT, TRUE, FALSE, NULL, UNDEFINED] = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const [UNIT, STATUS, COOLDOWN] = [0x40000001, 0x40000002, 0x40000003]
// A field's or a cooldown's name → its own word, in the order first met; the names last met at each place of a unit's
// plain fields, and their words; the strings last met there, and theirs.
const KEYS = new Map()
const keyOf = (k) => KEYS.get(k) ?? KEYS.set(k, 0x20000000 + KEYS.size).get(k)
const PLACED = []
const PLACED_WORD = []
const PLACED_STRING = []
const PLACED_STRING_WORD = []

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
// Both sides' next turns are read off foe.js danger (threatOn yours). `map`: the danger map for your side, made already.
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
  const foes = SCORE.foes * (foesLeft(g) - SCORE.threat * threatOn(g)) / Math.max(1, before.foes)
  return valueOf(before, g, true) + END_WEIGHTS.own * shadows / max - foes - SCORE.danger * loss
}
const WON = 1e6

// What yours could deal the foes next turn: each living foe's dangerAt on foe.js danger's map for the foes, summed in
// acting order; the map read at the foes' tiles alone (`only`: each tile's reading is its own) and your pieces' tiles
// kept in a book (stepsBy): the full map's numbers there.
export function threatOn (g) {
  const at = []
  for (const x of g.units) {
    if (x.side !== 'foe' || !alive(x)) continue
    for (const t of footprint(x.tile, x.size) ?? [x.tile]) if (!at.includes(t)) at.push(t)
  }
  const map = danger(g, 'foe', null, { only: at, steps: stepsBy(g) })
  let dealt = 0
  for (const x of g.units) if (x.side === 'foe' && alive(x)) dealt += dangerAt(g, x, x.tile, map)
  return dealt
}

// foe.js stepsOf, kept in a book by what it reads: a piece of yours (orderable: its reach) by its tile, size, flight and
// side, the stride, and the board's occupancy within the stride of its footprint (each tile's holder's side, on the
// ground and in the air: all reach reads of the board there but its walls, the battle's own). One book a battle (its
// walls' Set, which every copy shares), emptied at STEPS_KEPT entries; any other unit's read afresh.
function stepsBy (b) {
  let book = STEPS.get(b.walls)
  if (!book) STEPS.set(b.walls, (book = new Map()))
  return (f, u, at, tiles) => {
    if (at || !orderable(f, u)) return stepsOf(f, u, at, tiles)
    const x0 = tileX(u.tile)
    const y0 = tileY(u.tile)
    const xa = Math.max(0, x0 - tiles)
    const xb = Math.min(LANES - 1, x0 + u.size - 1 + tiles)
    const near = []
    for (let y = Math.max(0, y0 - tiles), yb = Math.min(DEPTH - 1, y0 + u.size - 1 + tiles); y <= yb; y++) {
      for (let t = y * LANES + xa, tb = y * LANES + xb; t <= tb; t++) near.push(48 + 3 * sideCode(f.at[t]) + sideCode(f.sky[t]))
    }
    const k = `${u.tile},${u.size},${u.flies},${u.side},${tiles},${String.fromCharCode.apply(null, near)}`
    let s = book.get(k)
    if (s === undefined) {
      if (book.size >= STEPS_KEPT) book.clear()
      s = stepsOf(f, u, at, tiles)
      book.set(k, s)
    }
    return s
  }
}
const STEPS = new WeakMap()
const STEPS_KEPT = 20000
const sideCode = (x) => (x === null ? 0 : x.side === 'party' ? 1 : 2)

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
// slackMs }. `slack` false: no slack read. `moving` false: every piece acts from where it stands. `beat`: a value to
// better, as a won line's is: a line that cannot better it is dropped.
export function solve (battle, {
  budget = budgetOf(), cap = capOf(budget), widths = widthsOf(), per = SOLVER.per, sharp = SOLVER.sharp, sample = SOLVER.sample, turns = SOLVER.turns,
  slack = slackOn(), moving = true, beat = -Infinity
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
    const s = beam(root, before, { K, B, W, per, turns, deadline, budget: budget - stats.plans, moving, beat })
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
  best ??= endOf(before, root, boardHash(root), [], true)
  // The line's last board, made again by its orders: the search keeps no board past its layer.
  const end = replay(battle, best)
  stats.solved = best.won
  stats.value = best.value
  stats.turns = best.line.length
  if (best.won) stats.margin = marginOf(before, end)
  stats.ms = Date.now() - t0
  if (won && slack) {
    stats.slack = slackOf(won, root, best.line, { sample, deadline: Date.now() + cap * 500 })
    stats.sharp = stats.slack.flatMap((x, t) => (x !== null && x < sharp ? [t] : []))
    stats.slackMs = Date.now() - t0 - stats.ms
  }
  return { line: best.line, won: best.won, value: best.value, end, stats }
}

// The better of two lines' ends: won first, then the higher value; of lines not won, one still open (the cap cut it)
// before one lost, then the more rounds held, then the more of the foes' HP taken.
function outranks (a, b) {
  if (a.won !== b.won) return a.won
  if (a.won) return a.value > b.value + EPS
  if (a.open !== b.open) return a.open
  if (a.turn !== b.turn) return a.turn > b.turn
  return a.foes < b.foes - EPS
}

// An end of a line: its board's hash, its line, won, value, open (still under way), and what outranks reads of its
// board past those, the round and the foes' HP left. No board: the line makes it again (replay).
const endOf = (before, board, hash, line, open = false) => {
  const won = board.over && board.winner === 'party'
  return { hash, line, won, value: open ? null : valueOf(before, board, won), open, turn: board.turn, foes: foesLeft(board) }
}

// One level of the search, `budget` plans at most. → { nodes, plans, truncated, best (the best end of a line met, by
// outranks: won, lost, or open where the cap or the budget stopped it), edges (Map an expanded node's hash → its
// children's), wins (won ends' hashes), ctx }. The books keep hashes, not boards: a line may run to the turn guard.
// One layer's boards are held at a time: a child keeps its hash, its line, its parent and the numbers it is ranked by,
// and the W kept are made again from their parents' boards (grow) once the layer is ranked.
function beam (root, before, { K, B, W, per, turns, deadline, budget, moving, beat = -Infinity }) {
  const out = { nodes: 0, plans: 0, truncated: false, best: null, edges: new Map(), wins: new Set() }
  const meet = (end) => {
    if (!out.best || outranks(end, out.best)) out.best = end
  }
  const ctx = { K, B, per, deadline, budget, before, out, moving }
  out.ctx = ctx
  let layer = [{ board: root, hash: boardHash(root), line: [] }]
  let bestWon = beat
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
      out.edges.set(node.hash, kids.map((c) => c.hash))
      for (const c of kids) {
        const line = [...node.line, { turn: node.board.turn, hash: node.hash, orders: c.orders }]
        if (c.board.over || stalled(c.board) || line.length >= turns) {
          const end = endOf(before, c.board, c.hash, line, !c.board.over && !stalled(c.board))
          meet(end)
          if (end.won) {
            out.wins.add(c.hash)
            bestWon = Math.max(bestWon, end.value)
          }
        } else if (!next.has(c.hash)) next.set(c.hash, { hash: c.hash, line, parent: node, score: scoreOf(c.board, before), soFar: valueOf(before, c.board, true) })
      }
    }
    if (out.truncated) {
      // The line still open where the cap or the budget stopped the search: the best of this layer by the score.
      if (layer[0].line.length) meet(endOf(before, layer[0].board, layer[0].hash, layer[0].line, true))
      break
    }
    // The W best by the score, ties by the value so far; none that cannot better a win found.
    const ranked = [...next.values()]
    ranked.sort((a, b) => (Math.abs(a.score - b.score) > EPS ? b.score - a.score : b.soFar - a.soFar))
    layer = ranked.slice(0, W)
    if (bestWon > -Infinity) layer = layer.filter((c) => c.soFar - END_WEIGHTS.turn > bestWon + EPS)
    for (const c of layer) grow(c)
  }
  return out
}

// A child's board made again: its parent's board copied and its turn's orders given (as replay gives them), checked by
// its hash (a board that parts is a game bug, thrown); its parent let go.
function grow (c) {
  const g = copy(c.parent.board)
  for (const o of c.line.at(-1).orders) order(g, o)
  const h = boardHash(g)
  if (h !== c.hash) throw new Error(`solver: turn ${c.line.at(-1).turn}'s child made again parts from the one searched (searched ${c.hash}, made ${h})`)
  c.board = g
  c.parent = null
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
// hash (`h`) and danger map for your side (`map`: its shields are that board's units). → [{ f (the board, End Turn not
// yet), orders }]
function turnPlans (board, seq, { K, B, per, deadline, budget, before, out, moving }) {
  const f = copy(board)
  let plans = [{ f, h: boardHash(f), orders: [], value: 0, map: danger(f, 'party') }]
  for (let i = 0; i < seq.length; i++) {
    const uid = seq[i]
    const later = seq.slice(i + 1)
    const next = new Map()
    for (const p of plans) {
      if (out.plans >= budget || Date.now() > deadline) throw CUT
      const u = p.f.byUid.get(uid)
      if (p.f.over || !u || !orderable(p.f, u) || u.acted) {
        if (!next.has(p.h)) next.set(p.h, p)
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
        next.set(h, { f: g, h, orders: [...p.orders, ...given], value: scoreOf(g, before, gm), map: gm })
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
  const mit = mitigation(f, u)
  for (const o of list) {
    const e = estimate(f, u, o, NOBODY)
    o.kill = e.kill
    o.score = e.dealt + e.kill - dangerAt(f, u, o.tile, map, mit) - e.counter
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
    const had = s.edges.get(t.hash)
    const kids = had && Date.now() <= deadline ? expand({ board: g, hash: t.hash, line: [] }, ctx).map((c) => c.hash) : null
    for (const o of t.orders) order(g, o)
    if (!kids) return null
    if (kids.join() !== had.join()) throw new Error(`solver: turn ${t.turn}'s node expanded twice gave two sets of children`)
    const read = kids.length <= sample ? kids : Array.from({ length: sample }, (_, i) => kids[Math.floor(i * kids.length / sample)])
    return +(read.filter(found).length / read.length).toFixed(3)
  })
}

// The replay check: line `r` given on a fresh copy of `battle` order by order must reach its boards, each turn's start
// and its end, else the fork leaked or the battle is not deterministic: a game bug, thrown with the two hashes.
export function replay (battle, r) {
  const g = fork(battle)
  for (const [t, step] of r.line.entries()) {
    const at = boardHash(g)
    if (at !== step.hash) throw new Error(`solver replay: turn ${t} (${step.turn}) begins on another board (searched ${step.hash}, replayed ${at})`)
    for (const o of step.orders) order(g, o)
  }
  const at = boardHash(g)
  if (at !== r.hash) throw new Error(`solver replay: the line ends on another board (searched ${r.hash}, replayed ${at})`)
  return g
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
// determinism bug, `mismatch` in the stats). A battle that opens on a board bestFormation solved takes that line (taken)
// and is not solved again; its stats say `prep`. → that turn's orders (copies), End Turn last but where the battle ends.
export function solverTurn (battle, { cap, budget, widths, slack, moving, onSolve = null } = {}) {
  if (battle.over) return []
  const hash = boardHash(battle)
  const had = LINES.get(battle)
  let orders = had?.byHash.get(hash)
  if (!orders) {
    const r = (!had && taken(hash, moving ?? true, budget === undefined && cap === undefined && widths === undefined && slack === undefined)) || solve(battle, {
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

// ── the formation ────────────────────────────────────────────────────────────────────────────────

// The battle the room in prep opens on with formation `goal` ([{ uid, slot }]: those souls in those cells, every other
// in the ossuary), no order given: run.js battleSetup as the run's fight makes it, quiet.
export function openingOf (run, goal) {
  const at = new Map(goal.map((p) => [p.uid, p.slot]))
  const party = run.state.party.map((u) => ({ ...u, slot: at.get(u.uid) ?? -1 })).filter((u) => u.slot >= 0)
  return createBattle({ ...battleSetup(run, { party }), quiet: true })
}

// The formation the coming battle is fought in, of `cands` (player.js prepCandidates': today's pick first, each with its
// `goal`), the first `cap`: each one's battle (openingOf) solved, the first as the battle would solve it (the knobs in
// use), every other at `budget` plans, no cap and no slack, a line that cannot better the best won value found so far
// dropped (solve's `beat`). The best by its line's end (outranks): won before not, then the higher value (valueOf); of
// lines not won, one the budget cut short before one lost, then the more rounds held, then the more of the foes' HP
// taken; ties to the earlier. Its line is kept for the battle (solverTurn) where it is the first's or won. `moving`
// false: the moves ablation's (TURNS.still).
// → { index, cand, stats: [{ won, value, margin, plans, ms, truncated, level } a candidate solved] }
export function bestFormation (run, cands, { budget = prepBudgetOf(), cap = prepCapOf(), moving = true } = {}) {
  const stats = []
  let best = null
  for (const [i, c] of cands.slice(0, Math.max(1, cap)).entries()) {
    const board = openingOf(run, c.goal)
    const r = i === 0 ? solve(board, { moving }) : solve(board, { budget, cap: Infinity, slack: false, moving, beat: best?.end.won ? best.end.value : -Infinity })
    const { margin, plans, ms, truncated, level } = r.stats
    stats.push({ won: r.won, value: r.value, margin, plans, ms, truncated, level })
    const end = { won: r.won, value: r.value, open: !r.end.over && !stalled(r.end), turn: r.end.turn, foes: foesLeft(r.end) }
    if (!best || outranks(end, best.end)) best = { i, r, board, end }
  }
  if (best.i === 0 || best.r.won) keep(boardHash(best.board), moving, best.r)
  for (const fn of FORMATION_HOOKS) fn({ index: best.i, stats }, run)
  return { index: best.i, cand: cands[best.i], stats }
}

// The lines bestFormation kept, by opening board (boardHash) and `moving`: the last PREPPED of them, each taken once.
const PREPPED = 4
const KEPT = new Map()
function keep (hash, moving, r) {
  const k = `${moving}|${hash}`
  KEPT.delete(k)
  KEPT.set(k, { line: r.line, won: r.won, stats: { ...r.stats, prep: true } })
  while (KEPT.size > PREPPED) KEPT.delete(KEPT.keys().next().value)
}
// The line kept for a battle opening on board `hash`, taken out; one not won (the first candidate's, solved as the
// battle would be) only for a battle solved by the knobs in use (`plain`). null for none.
function taken (hash, moving, plain) {
  const k = `${moving}|${hash}`
  const r = KEPT.get(k)
  if (!r || (!r.won && !plain)) return null
  KEPT.delete(k)
  return { line: r.line, stats: { ...r.stats } }
}
// Listeners on each formation chosen: fn({ index, stats }, run), for the reports (useFormationHook).
const FORMATION_HOOKS = new Set()
export const useFormationHook = (fn) => {
  FORMATION_HOOKS.add(fn)
  return () => FORMATION_HOOKS.delete(fn)
}
