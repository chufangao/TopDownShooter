// The stronger teacher (src/sim/teacher.js, redesign.md §2.23, §6): width where the shortlist sees only losses, and a
// search over our next decisions jointly where no option of the one decision wins. Functional only: with no budget it is
// teach.js's teacher; a line it finds is legal order by order and, followed, plays the battle it was found in as its
// playout did; the same board gives the same orders; a board not the one a line expected leaves the line; a run records
// what played. The boards are played by today's tree alone (useForest(null)), so a forest refitted moves none of them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTeacher, search, keyOf, strongRun, escalations, SETTINGS } from '../src/sim/teacher.js'
import { teacherTurn, labelPosition, nextPiece, signature, readDecision, labelled, marked, DEFAULTS } from '../src/sim/teach.js'
import { useForest } from '../src/sim/forest.js'
import { useRoute } from '../src/sim/autoplay.js'
import { fork, order, reach } from '../src/sim/turns.js'
import { on, scene } from './scene.js'

// A board of units on tiles (scene.js): [{ id, uid, side, x, y, hp? }], `hp` the HP it stands at.
const board = (units) => {
  const b = scene(units.map((u) => on(u.id, u.uid, u.side, u.x, u.y, u.lvl ?? 3)))
  for (const u of units) if (u.hp) b.byUid.get(u.uid).hp = u.hp
  return b
}

// A Monarch at about half its HP, a Barrow Wight and a Grave Ghoul of yours; a Rot Bloat, a Mantis Reaper and a Grave
// Ghoul walking down on it (found by a search over random boards, 2026-10-12). At the Ghoul's first decision every
// option of it, played out by today's expert, loses the battle; a line of two decisions together wins it.
const pinch = () => board([
  { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0, hp: 87 },
  { id: 'barrow_wight', uid: 1, side: 'party', x: 6, y: 1 },
  { id: 'grave_ghoul', uid: 2, side: 'party', x: 5, y: 3 },
  { id: 'rot_bloat', uid: 9, side: 'foe', x: 0, y: 7 },
  { id: 'mantis_reaper', uid: 10, side: 'foe', x: 6, y: 7 },
  { id: 'grave_ghoul', uid: 11, side: 'foe', x: 0, y: 6 }
])

// Gives `orders` on battle `b`, each as it comes (order throws on one that may not be given), up to the battle's end.
const play = (b, orders) => {
  for (const x of orders) {
    if (b.over) break
    order(b, x)
  }
}
// Plays battle `b` to its end (at most `n` rounds), `turn` giving each of your turns' orders.
const playOut = (b, turn, n = 60) => {
  for (let r = 0; r < n && !b.over; r++) play(b, turn(b))
}
// Runs `fn` with today's tree alone deciding (no forest), the forest in use put back after.
const today = (fn) => {
  useForest(null)
  try {
    return fn()
  } finally {
    useForest(undefined)
  }
}

// The one decision's options of the first piece of `b`'s turn, as the teacher plays them (all lost on `pinch`). → the
// search's root and its options played
function rootOf (b) {
  const f = fork(b)
  const next = nextPiece(b)
  const at = marked(f, new Set())
  const read = readDecision(at, next.uid, SETTINGS.cap)
  const L = labelled(at, next.uid, signature(next.orders, f.byUid.get(next.uid).tile), { ...DEFAULTS, cap: SETTINGS.cap, turns: SETTINGS.turns, weights: SETTINGS.weights }, read)
  return { root: { f, done: new Set(), next, crossed: 0 }, plays: L.plays.filter((p) => p.orders), rows: L.rows }
}

test('with no budget and no width, the teacher is teach.js\'s: the same orders, turn by turn', () => today(() => {
  const T = createTeacher({ budget: 0, width: 'off' })
  const b = pinch()
  for (let r = 0; r < 4 && !b.over; r++) {
    const mine = T.turn(b)
    assert.deepEqual(mine, teacherTurn(b), `turn ${b.turn}`)
    play(b, mine)
  }
  assert.deepEqual([T.stats.searched, T.stats.widened], [0, 0])
}))

test('where every option of the one decision loses, the search finds a line; followed, it is legal order by order and wins the battle it was found in', () => today(() => {
  const b = pinch()
  const next = nextPiece(b)
  const L = labelPosition(b, next.uid, signature(next.orders, b.byUid.get(next.uid).tile))
  const legal = L.options.filter((o) => o.legal)
  assert.ok(legal.length > 1 && legal.every((o) => o.parts.lost), JSON.stringify(legal.map((o) => o.value)))
  const T = createTeacher({ budget: 400 })
  playOut(b, T.turn)
  const s = T.stats
  assert.ok(s.searched >= 1 && s.found >= 1, JSON.stringify(s))
  assert.equal(s.wideWins, 0)
  assert.ok(s.searches[0].found?.dev >= 2, JSON.stringify(s.searches[0]))
  // The line followed to the battle's end, every board the one it expected.
  assert.ok(s.followed > 0)
  assert.equal(s.broken, 0)
  assert.equal(b.winner, 'party')
}))

test('the search: its root untouched, its line\'s first step one of the root\'s options, a budget kept, the same line again', () => today(() => {
  const { root, plays, rows } = rootOf(pinch())
  assert.ok(rows.every((r) => r.parts.lost))
  const before = keyOf(root.f)
  const s = search(root, plays, { ...SETTINGS }, 400)
  assert.ok(s.line, 'a line found')
  assert.ok(s.playouts > 0 && s.playouts <= 400, `${s.playouts}`)
  assert.equal(keyOf(root.f), before)
  const steps = s.line.steps
  assert.deepEqual([steps[0].kind, steps[0].key, steps[0].uid], ['decide', keyOf(root.f, new Set()), root.next.uid])
  assert.ok(plays.some((p) => JSON.stringify(p.orders) === JSON.stringify(steps[0].orders)))
  // Decisions first, then the rest of its winning playout: the turn under way, then turn by turn.
  const kinds = steps.map((x) => x.kind).join(' ')
  assert.match(kinds, /^(decide )+(tail |turn )(turn ?)*$/)
  // With nothing to spend, nothing found.
  assert.equal(search(root, plays, { ...SETTINGS }, 0).line, null)
  const again = rootOf(pinch())
  assert.deepEqual(search(again.root, again.plays, { ...SETTINGS }, 400).line.steps, steps)
}))

test('the same board gives the same orders; the board given is never touched', () => today(() => {
  const b = pinch()
  const k = keyOf(b)
  const orders = createTeacher({ budget: 400 }).turn(b)
  assert.equal(keyOf(b), k)
  assert.deepEqual(createTeacher({ budget: 400 }).turn(pinch()), orders)
  assert.equal(orders.at(-1).type, 'end')
}))

test('a board not the one a line expected: the line left, the normal teacher deciding', () => today(() => {
  const b = pinch()
  const T = createTeacher({ budget: 400 })
  play(b, T.turn(b))
  assert.equal(T.stats.found, 1)
  assert.ok(!b.over)
  // A foe a point of HP down that the line's playout never saw.
  const x = b.units.find((u) => u.side === 'foe' && u.hp > 1)
  x.hp--
  const decided = T.stats.decisions
  play(b, T.turn(b))
  assert.equal(T.stats.broken, 1)
  assert.ok(T.stats.decisions > decided)
}))

test('keys: a copy is the same board; a step, an HP or a piece decided is another', () => {
  const b = pinch()
  assert.equal(keyOf(fork(b)), keyOf(b))
  assert.notEqual(keyOf(b, new Set([2])), keyOf(b))
  const g = fork(b)
  g.byUid.get(9).hp--
  assert.notEqual(keyOf(g), keyOf(b))
  const h = fork(b)
  const u = h.byUid.get(2)
  order(h, { type: 'move', uid: 2, tile: [...reach(h, u).keys()].find((t) => t !== u.tile) })
  assert.notEqual(keyOf(h), keyOf(b))
})

test('a run records its settings and what played: the forest, the route, the expert', () => {
  try {
    const r = strongRun('teacher-test-1', { fights: 1 })
    assert.deepEqual([r.player, r.battles.fought, r.decisions], ['teacher', 0, 0])
    assert.deepEqual([r.settings.width, r.settings.budget, r.settings.depth, r.settings.route], [SETTINGS.width, SETTINGS.budget, SETTINGS.depth, 'learned'])
    assert.ok('forest' in r.base && 'route' in r.base && 'expert' in r.base)
    assert.ok(r.esc && 'searched' in r.esc && 'searchPlayouts' in r.esc)
    const h = strongRun('teacher-test-1', { fights: 1, forest: null, route: 'hand', width: 'off', budget: 0 })
    assert.deepEqual([h.base.forest, h.base.route, h.settings.route, h.settings.width, h.settings.budget], [null, 'hand', 'hand', 'off', 0])
  } finally {
    useForest(undefined)
    useRoute(undefined)
  }
})

test('escalations summed over the teacher\'s lines', () => {
  const line = (esc) => ({ player: 'teacher', esc: { widened: 0, wideWins: 0, widePlayouts: 0, searched: 0, searchPlayouts: 0, searchMs: 0, found: 0, followed: 0, broken: 0, skipped: 0, ...esc } })
  const x = escalations([line({ widened: 3, wideWins: 1, searched: 2, searchPlayouts: 300, searchMs: 1000, found: 1 }), line({ searched: 1, searchPlayouts: 100, searchMs: 500 }), { player: 'expert' }])
  assert.deepEqual([x.runs, x.widened, x.wideWins, x.searched, x.found, x.playoutsPerSearch, x.msPerSearch], [2, 3, 1, 3, 1, 133.3, 500])
})
