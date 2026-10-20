// The battle solver (solver.js): a beam search over whole turns to the battle's end. Functional only: that it is
// deterministic, that its line replays order by order and every order is legal, that it finds forced wins (a key before
// its blow), that its score ranks a won board first and a lost one last, that its filter keeps every kill and key, that
// its value is the labels' (values.js), and that it plays as a turn policy, the expert's battles; never how often it
// wins; that a budget of plans makes it a function of the board.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, fork, order, legalOrders, preview } from '../src/sim/turns.js'
import { solve, solverTurn, solverKnobs, boardHash, tallyOf, valueOf, scoreOf, candidates, replay, useSolverHook } from '../src/sim/solver.js'
import { endTally, endValue } from '../src/sim/values.js'
import { record, LEVELS, TURNS, turnsOf } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { on, scene } from './scene.js'

// Narrow levels and short lines, so that a test solves in a moment.
const NARROW = [[3, 8, 8]]
const QUICK = { cap: Infinity, widths: NARROW, turns: 6 }

// `fn()` with the environment's solver knobs set to `knobs` (autoplay.js --solver-*), then put back.
function withKnobs (knobs, fn) {
  const env = { ...process.env }
  try {
    for (const [k, v] of Object.entries(knobs)) process.env[`RETINUE_SOLVER_${k.toUpperCase()}`] = String(v)
    return fn()
  } finally {
    for (const k of Object.keys(knobs).map((k) => `RETINUE_SOLVER_${k.toUpperCase()}`)) {
      if (env[k] === undefined) delete process.env[k]
      else process.env[k] = env[k]
    }
  }
}
// The battles of one expert run, as each began, its battles solved under a small budget (quick, and a function of the
// boards).
const setupsOf = (seed) => withKnobs({ budget: 300, slack: 0 }, () => record({ seed, level: 'expert', setups: true }))
  .battles.map((b) => ({ floor: b.floor, won: b.won, setup: b.setup }))
const RUNS = Object.fromEntries(['solver-1', 'solver-2'].map((seed) => [seed, setupsOf(seed)]))
// A few battles of those runs: each run's first, middle and last.
const SAMPLE = Object.values(RUNS).flatMap((list) => [list[0], list[Math.floor(list.length / 2)], list.at(-1)])

// A board a few turns into a battle, played by legal orders at random (a move or an act, up to eight a turn, End Turn
// drawn a time in seven).
function fuzzed (setup, seed, turns) {
  const b = createBattle(setup)
  const rng = createRng(seed).stream('fuzz')
  for (let t = 0; t < turns && !b.over; t++) {
    for (let k = 0; k < 8 && !b.over; k++) {
      const os = legalOrders(b).filter((o) => o.type === 'move' || o.type === 'act')
      if (!os.length || rng() < 1 / 7) break
      order(b, os[Math.floor(rng() * os.length)])
    }
    if (!b.over) order(b, { type: 'end' })
  }
  return b
}

// Whether order `o` is among the board's legal orders.
const legal = (b, o) => legalOrders(b).some((x) => x.type === o.type && x.uid === o.uid && x.tile === o.tile && x.ability === o.ability && x.target === o.target)

// The stats as the same board gives them: all but the clock.
const timeless = (s) => ({ ...s, ms: 0, slackMs: 0 })

test('the board\'s hash: a copy hashes alike, a walk parts it, its Undo merges it back; a status laid parts it', () => {
  const b = createBattle(SAMPLE[0].setup)
  assert.equal(boardHash(fork(b)), boardHash(b))
  const u = b.units.find((x) => x.side === 'party' && x !== b.monarch && !x.shadow)
  const tile = legalOrders(b).find((o) => o.type === 'move' && o.uid === u.uid).tile
  const f = fork(b)
  order(f, { type: 'move', uid: u.uid, tile })
  assert.notEqual(boardHash(f), boardHash(b))
  order(f, { type: 'undo', uid: u.uid })
  assert.equal(boardHash(f), boardHash(b))
  const g = fork(b)
  g.byUid.get(u.uid).statuses.push({ id: 'brittle', dur: 2, stacks: 1, by: null, fresh: false, turn: g.turn, stage: g.stage })
  assert.notEqual(boardHash(g), boardHash(b))
})

test('the solver is deterministic: the same board twice gives the same line and the same stats but the clock', () => {
  for (const x of SAMPLE.slice(0, 3)) {
    const a = solve(createBattle(x.setup), { cap: Infinity, widths: [[4, 16, 16]] })
    const b = solve(createBattle(x.setup), { cap: Infinity, widths: [[4, 16, 16]] })
    assert.deepEqual(b.line, a.line)
    assert.deepEqual(timeless(b.stats), timeless(a.stats))
    assert.ok(a.line.length > 0)
  }
})

test('its line replays: on fuzzed boards, each order is legal where it is given and the line reaches its boards', () => {
  let n = 0
  for (const [seed, list] of Object.entries(RUNS)) {
    for (const [i, x] of list.entries()) {
      if (i % 6) continue
      const b = fuzzed(x.setup, `${seed}|${i}`, 1 + (i % 3))
      if (b.over) continue
      const before = boardHash(b)
      const r = solve(b, QUICK)
      assert.equal(boardHash(b), before, 'the board solved is never touched')
      const g = fork(b)
      for (const step of r.line) {
        assert.equal(boardHash(g), step.hash)
        for (const o of step.orders) {
          assert.ok(legal(g, o), `turn ${step.turn}: ${JSON.stringify(o)} is legal`)
          order(g, o)
        }
      }
      assert.equal(boardHash(g), boardHash(r.end))
      assert.equal(boardHash(replay(b, { line: r.line, hash: boardHash(r.end) })), boardHash(r.end))
      n++
    }
  }
  assert.ok(n >= 4, `${n} boards solved`)
})

test('a forced win: a lock that only a key and then a blow opens, the striker acting first, the Monarch felled next turn', () => {
  // The golem beside the Monarch at 1 HP; the knight acts before the chanter, so End Turn alone spends no key.
  const make = () => {
    const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 2, 1), on('bone_chanter', 2, 'party', 5, 1), on('iron_golem', 9, 'foe', 3, 1)])
    b.byUid.get(9).hp = 57
    b.monarch.hp = 1
    return b
  }
  const b = make()
  assert.ok(b.byUid.get(1).ord < b.byUid.get(2).ord, 'the knight acts first')
  const plain = preview(b, 1, 'strike', 9).damage + preview(b, 2, 'marrow_bolt', 9).damage
  assert.ok(plain < 57, `the two blows unkeyed deal ${plain}`)
  const idle = fork(b)
  order(idle, { type: 'end' })
  assert.equal(idle.winner, 'foe', 'End Turn alone loses')
  const r = solve(make(), { cap: Infinity })
  assert.ok(r.won)
  assert.equal(r.line.length, 1)
  const acts = r.line[0].orders.filter((o) => o.type === 'act' && o.target === 9)
  const key = acts.findIndex((o) => o.uid === 2 && o.ability === 'marrow_bolt')
  const blow = acts.findIndex((o) => o.uid === 1)
  assert.ok(key >= 0 && blow > key, `the key, then the blow: ${JSON.stringify(acts)}`)
  assert.equal(r.stats.level, 1)
  assert.deepEqual(r.stats.slack.length, 1)
})

test('keys first for a lock: the key-layer later in acting order lays its key before the blow it opens', () => {
  // The wisp's Witchfire is keyed to Burning alone; the chanter's Marrow Bolt lays Brittle, the golem's lock's key.
  const make = (hp) => {
    const b = scene([on('monarch', 0, 'party', 3, 0), on('will_o_wisp', 1, 'party', 2, 1), on('bone_chanter', 2, 'party', 5, 1), on('iron_golem', 9, 'foe', 3, 1)])
    b.monarch.hp = 1
    if (hp) b.byUid.get(9).hp = hp
    return b
  }
  const dealt = (first, second) => {
    const f = make()
    const hp = f.byUid.get(9).hp
    for (const [uid, ability] of [first, second]) order(f, { type: 'act', uid, ability, target: 9 })
    return hp - f.byUid.get(9).hp
  }
  const keyed = dealt([2, 'marrow_bolt'], [1, 'witchfire'])
  assert.ok(make().byUid.get(1).ord < make().byUid.get(2).ord, 'the wisp acts first')
  assert.ok(dealt([1, 'witchfire'], [2, 'marrow_bolt']) < keyed, 'the lock cuts the wisp\'s blow without the key')
  const r = solve(make(keyed), { cap: Infinity })
  assert.ok(r.won)
  const acts = r.line[0].orders.filter((o) => o.type === 'act' && o.target === 9)
  assert.deepEqual(acts.map((o) => o.uid), [2, 1], JSON.stringify(acts))
})

test('a won line on real battles: the Monarch standing, and each turn\'s slack a share', () => {
  let won = 0
  for (const x of SAMPLE) {
    const r = solve(createBattle(x.setup), { cap: Infinity, widths: NARROW })
    if (!r.won) continue
    won++
    assert.ok(r.stats.margin.monarch > 0)
    assert.equal(r.stats.slack.length, r.line.length)
    for (const s of r.stats.slack) assert.ok(s === null || (s >= 0 && s <= 1))
    for (const t of r.stats.sharp) assert.ok(r.stats.slack[t] < 0.1)
  }
  assert.ok(won > 0, 'a battle of the sample won')
})

test('the score: a won board above every board under way, a lost one below; under way, the foes\' HP and the Monarch\'s count', () => {
  for (const x of SAMPLE) {
    const b = createBattle(x.setup)
    const before = tallyOf(b)
    // Boards under way at the extremes: the foes all but felled and yours whole; the Monarch at 1 HP, the souls at 1, the
    // foes whole.
    const best = fork(b)
    for (const u of best.units) if (u.side === 'foe' && u.hp > 0) u.hp = 1
    best.reserve = best.reserve.map((u) => ({ ...u, hp: 1 }))
    const worst = fork(b)
    for (const u of worst.units) if (u.side === 'party' && u.hp > 0) u.hp = 1
    const going = [b, best, worst, fuzzed(x.setup, `score|${x.floor}`, 2)].filter((g) => !g.over)
    // A won board at its worst (the Monarch at 1 HP, every soul fallen) and a lost one at its best (one foe at 1 HP left).
    const won = fork(worst)
    for (const u of won.units) if (u.side === 'party' && u !== won.monarch) u.hp = 0
    for (const u of won.units) if (u.side === 'foe') u.hp = 0
    won.reserve = []
    Object.assign(won, { over: true, winner: 'party' })
    const lost = fork(best)
    Object.assign(lost, { over: true, winner: 'foe' })
    const scores = going.map((g) => scoreOf(g, before))
    for (const v of scores) {
      assert.ok(Number.isFinite(v))
      assert.ok(scoreOf(won, before) > v, `won ${scoreOf(won, before)} above ${v}`)
      assert.ok(scoreOf(lost, before) < v, `lost ${scoreOf(lost, before)} below ${v}`)
    }
    assert.ok(scoreOf(best, before) > scoreOf(b, before), 'the foes\' HP taken counts')
    const hurt = fork(b)
    if (hurt.monarch) {
      hurt.monarch.hp = Math.max(1, Math.floor(hurt.monarch.hp / 2))
      assert.ok(scoreOf(hurt, before) < scoreOf(b, before), 'the Monarch\'s HP lost counts')
    }
  }
})

test('the filter: at the narrowest it keeps every kill, every key a later piece pays, a lock\'s key, and the hold', () => {
  // Marrow Bolt lays Brittle: the knight's Strike is keyed to it, and the golem's lock opens to it. The thornling at 1
  // HP is a kill; the one at full HP no lock.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 2, 1), on('bone_chanter', 2, 'party', 5, 1),
    on('bone_chanter', 3, 'party', 4, 1), on('iron_golem', 9, 'foe', 3, 3), on('thornling', 10, 'foe', 5, 3), on('thornling', 11, 'foe', 6, 4)])
  b.byUid.get(10).hp = 1
  const act = (o) => (o.ability ? `${o.ability.id}:${o.target.uid}` : 'move')
  const kept = (uid, later) => {
    const u = b.byUid.get(uid)
    const list = candidates(b, u, later, 1)
    const all = candidates(b, u, later, Infinity)
    assert.ok(list.length < all.length, 'the filter drops some')
    assert.ok(list.some((o) => !o.ability && o.tile === u.tile), 'the hold')
    for (const o of all) if (o.ability && o.kill > 0) assert.ok(list.some((x) => act(x) === act(o)), `the kill ${act(o)}`)
    assert.ok(all.some((o) => o.kill > 0), 'a kill to keep')
    return new Set(list.map(act))
  }
  const keyed = kept(2, [1, 3])
  assert.ok(keyed.has('marrow_bolt:9') && keyed.has('marrow_bolt:11'), 'the keys the knight pays')
  const locked = kept(2, [3])
  assert.ok(locked.has('marrow_bolt:9'), 'the lock\'s key, opened by any blow after it')
  kept(1, [2, 3])
})

test('its value is the labels\': values.js endValue on every end it reaches, won or lost, and the value so far as if won', () => {
  for (const x of SAMPLE) {
    const b = createBattle(x.setup)
    const r = solve(b, QUICK)
    const end = r.end
    if (end.over) assert.equal(valueOf(tallyOf(b), end), endValue(endTally(b), end).value)
    if (end.over) assert.equal(r.value, endValue(endTally(b), end).value)
    const asWon = { ...end, over: true, winner: 'party' }
    assert.equal(valueOf(tallyOf(b), end, true), endValue(endTally(b), asWon).value)
    const lost = { ...end, over: true, winner: 'foe' }
    assert.equal(valueOf(tallyOf(b), lost), endValue(endTally(b), lost).value)
  }
})

test('the solver as a turn policy: the expert\'s battles, its line given turn by turn, the battle solved once', () => {
  assert.equal(turnsOf(LEVELS.expert), 'solver')
  assert.deepEqual([turnsOf({ ...LEVELS.expert, ablate: 'moves' }), turnsOf({ ...LEVELS.expert, ablate: 'orders' })], ['still', 'basic'])
  const x = SAMPLE[0]
  const solved = solve(createBattle(x.setup), { cap: Infinity, widths: NARROW })
  const b = createBattle(x.setup)
  const seen = []
  const off = useSolverHook(({ stats }) => seen.push(stats))
  try {
    for (let t = 0; t < 50 && !b.over; t++) {
      const orders = TURNS.solver(b, { widths: NARROW, cap: Infinity })
      assert.deepEqual(orders, solverTurn(b, { widths: NARROW, cap: Infinity }))
      for (const o of orders) if (!b.over) order(b, o)
    }
  } finally {
    off()
  }
  assert.equal(seen.length, 1, 'solved once')
  assert.equal(seen[0].mismatch, false)
  assert.ok(b.over)
  assert.equal(b.winner === 'party', solved.won)
  assert.equal(boardHash(b), boardHash(solved.end))
})

// The largest battle of the sample, by pieces and foes: one whose search a small budget or cap cuts short.
const largest = () => SAMPLE.map((x) => x.setup).sort((a, b) => b.party.length + b.foes.length + b.reserve.length - (a.party.length + a.foes.length + a.reserve.length))[0]

test('a budget of plans: the same board and budget give the same line, the cap off; a battle solved once on the board as solve gives it', () => {
  const setup = largest()
  const a = solve(createBattle(setup), { budget: 2000, slack: false })
  const b = solve(createBattle(setup), { budget: 2000, slack: false })
  assert.deepEqual(b.line, a.line)
  assert.deepEqual(timeless(b.stats), timeless(a.stats))
  assert.ok(a.stats.truncated, 'the budget cut the search')
  assert.ok(a.stats.plans >= 2000 && a.stats.plans < 2100, `${a.stats.plans} plans, one piece's options past the budget at most`)
  assert.deepEqual(a.stats.slack, [])
  // The knobs as autoplay.js sets them for a pool's workers: a budget turns the cap off, and the slack read off with 0.
  const cap = process.env.RETINUE_SOLVER_CAP
  delete process.env.RETINUE_SOLVER_CAP
  try {
    withKnobs({ budget: 2000, slack: 0 }, () => {
      assert.deepEqual({ ...solverKnobs(), widths: null }, { budget: 2000, cap: Infinity, widths: null, slack: false, pure: true })
      const c = solve(createBattle(setup))
      assert.deepEqual(c.line, a.line)
      assert.deepEqual(timeless(c.stats), timeless(a.stats))
    })
    withKnobs({ budget: 2000, cap: 20 }, () => assert.equal(solverKnobs().pure, false, 'a cap named beside the budget: wall-clock again'))
  } finally {
    if (cap !== undefined) process.env.RETINUE_SOLVER_CAP = cap
  }
  // As a turn policy, the budget passed through.
  const seen = []
  const orders = solverTurn(createBattle(setup), { budget: 2000, slack: false, onSolve: ({ stats }) => seen.push(stats) })
  assert.deepEqual(orders, a.line[0].orders)
  assert.equal(seen[0].plans, a.stats.plans)
})

test('a budget stops the search where the cap would: the plans a cap cut at, given as the budget, give the same line', () => {
  const setup = largest()
  let cut = null
  for (const cap of [0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2]) {
    const r = solve(createBattle(setup), { cap, slack: false })
    if (r.stats.truncated && r.stats.nodes > 1) {
      cut = r
      break
    }
  }
  assert.ok(cut, 'a cap cut the search past its first turns')
  const r = solve(createBattle(setup), { budget: cut.stats.plans, cap: Infinity, slack: false })
  assert.deepEqual(r.line, cut.line)
  assert.deepEqual(timeless(r.stats), timeless(cut.stats))
})
