// The labeller (src/sim/teach.js, redesign.md §2.22, §5 Step 9a): options played out through the foes' real turn,
// offline; and the teacher (§2.23, §5 Step 10a), the labeller as a player. Functional only: what a playout reads, that
// it is deterministic, the rows' shape, and what the teacher takes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { labelPosition, teachRun, valueOf, loadLabels, report, give, signature, WEIGHTS, DEFAULTS, labelChoice, ROUTE_WEIGHTS, END_WEIGHTS, endTally, endValue, bestOf, teacherPick, teacherTurn, teacherRun, pairedReport, pairedLines } from '../src/sim/teach.js'
import { createRun, apply } from '../src/sim/run.js'
import { nodeOf } from '../src/sim/map.js'
import { survey, pickRoute, learnedRoute, useRoute, routeConditions, routeFeatures, ROUTE_FEATURES } from '../src/sim/autoplay.js'
import { conditions, OPTION_FEATURES } from '../src/sim/policy.js'
import { fork, order } from '../src/sim/turns.js'
import { tileAt } from '../src/sim/unit.js'
import { on, scene } from './scene.js'
import { teachRoutes, routeEndOf, routePick, routeAgreement, ROUTE_END_WEIGHTS } from '../src/sim/teach.js'
import { record, routeModel, policy } from '../src/sim/autoplay.js'
import { useRanker, rankerModel } from '../src/sim/ranker.js'
import { createRng } from '../src/sim/rng.js'

// A board of units on tiles (scene.js): [{ id, uid, side, x, y, lvl?, hp? }], `hp` the HP it stands at.
const board = (units) => {
  const b = scene(units.map((u) => on(u.id, u.uid, u.side, u.x, u.y, u.lvl ?? 3)))
  for (const u of units) if (u.hp) b.byUid.get(u.uid).hp = u.hp
  return b
}

// A Grave Ghoul two tiles from a Monarch at 1 HP, itself at 1 HP; your Tomb Knight within a walk of it; another foe far
// off, so the battle goes on. Felling the Ghoul (or standing where End Turn's blow fells it) saves the Monarch; walking
// away loses the battle.
const peril = () => board([
  { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0, hp: 1 },
  { id: 'tomb_knight', uid: 1, side: 'party', x: 1, y: 1 },
  { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 2, hp: 1 },
  { id: 'grave_ghoul', uid: 10, side: 'foe', x: 6, y: 10 }
])

test('the option that saves the Monarch has the higher playout value', () => {
  const b = peril()
  const L = labelPosition(b, 1, null, { rounds: 2 })
  const legal = L.options.filter((o) => o.legal)
  const saving = legal.filter((o) => !o.parts.lost)
  const losing = legal.filter((o) => o.parts.lost)
  assert.ok(saving.length && losing.length, `${saving.length} saving, ${losing.length} losing`)
  // A blow at the Ghoul is among the saving.
  assert.ok(saving.some((o) => o.target === 9), JSON.stringify(saving.map((o) => [o.tile, o.ability, o.target])))
  assert.ok(Math.min(...saving.map((o) => o.value)) > Math.max(...losing.map((o) => o.value)))
  assert.ok(!L.options[L.best].parts.lost)
  for (const o of losing) assert.ok(o.value <= -WEIGHTS.lost)
  // The board the piece decided on is never touched.
  assert.equal(b.byUid.get(0).hp, 1)
  assert.equal(b.byUid.get(9).hp, 1)
  assert.equal(b.turn, 1)
})

test('a playout\'s value: the parts weighed, net of healing, from the board the piece decided on', () => {
  const b = peril()
  const before = { m: 10, mMax: 20, own: 30, ownMax: 40, foes: new Map([[9, 8], [10, 12]]), foeMax: 50 }
  const g = fork(b)
  g.byUid.get(0).hp = 6 // the Monarch lost 4 of 20
  g.byUid.get(1).hp = 25
  g.byUid.get(1).maxHp = 40 // your pieces at 25 of 30: 5 of 40 lost
  g.byUid.get(9).hp = 0 // the foes lost 8 and 2 of 50
  g.byUid.get(10).hp = 10
  const { value, parts } = valueOf(before, g)
  assert.deepEqual(parts, { monarch: 0.2, own: 0.125, foe: 0.2, lost: 0, won: 0 })
  assert.ok(Math.abs(value - (-3 * 0.2 - 0.125 + 0.2)) < 1e-6)
  // Weights given are the weights used.
  assert.ok(Math.abs(valueOf(before, g, { ...WEIGHTS, monarch: 1 }).value - (-0.2 - 0.125 + 0.2)) < 1e-6)
})

test('an option given: its move, then its act; a stay given what End Turn would have it do; the piece done', () => {
  const b = peril()
  const g = fork(b)
  // The Knight walks beside the Ghoul and holds: End Turn's blow is given now.
  const orders = give(g, 1, { tile: tileAt(2, 1), path: [], ability: null, target: null, fusion: null })
  assert.deepEqual(orders.map((o) => o.type), ['move', 'act'])
  assert.equal(orders[1].target, 9)
  assert.equal(signature(orders, b.byUid.get(1).tile), `${tileAt(2, 1)}|a:${orders[1].ability}:9`)
  assert.ok(g.byUid.get(1).acted)
  assert.ok(g.byUid.get(9).hp <= 0)
})

test('the label to the battle\'s end: a loss −lost; else the shares lost as the run carries them, a fall all of its share', () => {
  const b = peril()
  const L = labelPosition(b, 1, null)
  const legal = L.options.filter((o) => o.legal)
  const w = END_WEIGHTS
  assert.ok(legal.some((o) => o.parts.lost) && legal.some((o) => !o.parts.lost))
  for (const o of legal) {
    if (o.parts.lost) assert.equal(o.value, -w.lost)
    else {
      assert.ok(Math.abs(o.value - (-w.monarch * o.parts.monarch - w.own * o.parts.own - w.turn * o.parts.turns)) < 1e-5)
      assert.ok(o.value > -w.lost && o.parts.turns >= 1)
    }
  }
  assert.ok(!L.options[L.best].parts.lost)
  // By hand: the Knight at half its HP falls, the battle won four rounds on; the Monarch at 1 HP heals as it carries.
  const k = b.byUid.get(1)
  k.hp = Math.ceil(k.maxHp / 2)
  const before = endTally(b)
  const g = fork(b)
  Object.assign(g, { over: true, winner: 'party', turn: b.turn + 4 })
  g.byUid.get(1).hp = 0
  const m = g.byUid.get(0)
  const { value, parts } = endValue(before, g)
  assert.equal(parts.fell, 1)
  assert.equal(parts.own, 1)
  assert.equal(parts.turns, 4)
  assert.ok(Math.abs(parts.monarch - (1 - Math.min(m.maxHp, 1 + Math.ceil(m.maxHp * 0.2))) / m.maxHp) < 1e-5)
  assert.ok(Math.abs(value - (-w.monarch * parts.monarch - w.own - 4 * w.turn)) < 1e-5)
  // The same board lost: −lost, whatever else.
  g.winner = 'foe'
  assert.equal(endValue(before, g).value, -w.lost)
})

test('labels are deterministic, and every row has its shape', () => {
  const a = labelPosition(peril(), 1, null)
  const b = labelPosition(peril(), 1, null)
  assert.deepEqual(a, b)
  // From a run: the first battle's decisions, every one kept.
  const keep = { lost: 1, near: 1, reach: 1, calm: 1 }
  const r1 = teachRun('teach-test-1', { battles: 1, limit: 4, keep })
  const r2 = teachRun('teach-test-1', { battles: 1, limit: 4, keep })
  assert.ok(r1.positions.length > 0)
  assert.deepEqual(r1.positions, r2.positions)
  const names = new Set(OPTION_FEATURES)
  for (const p of r1.positions) {
    for (const k of ['id', 'seed', 'run', 'split', 'floor', 'room', 'battle', 'turn', 'uid', 'kind', 'at', 'group', 'danger', 'wt', 'sit', 'options', 'chosen', 'best']) assert.ok(k in p, k)
    assert.equal(p.split, p.run % 5 === 0 ? 'held' : 'train')
    assert.ok(p.options.length >= 1 && p.options.length <= DEFAULTS.cap + 1)
    assert.ok(p.chosen >= 0, 'the expert\'s choice is among the options')
    assert.equal(p.options.filter((o) => o.chosen).length, 1)
    assert.ok(p.options[p.best].legal)
    for (const k in p.sit) assert.ok(Number.isFinite(p.sit[k]), k)
    p.options.forEach((o, i) => {
      assert.equal(o.i, i)
      for (const k in o.f) assert.ok(names.has(k) && Number.isFinite(o.f[k]), k)
      if (!o.legal) return
      // (to the battle's end, by default)
      const w = END_WEIGHTS
      const v = o.parts.lost ? -w.lost : -w.monarch * o.parts.monarch - w.own * o.parts.own - w.turn * o.parts.turns
      assert.ok(Math.abs(v - o.value) < 1e-5)
      assert.ok(o.value <= p.options[p.best].value)
    })
  }
  // The conditions written are the tree's own (policy.js conditions), its zeros left out.
  const c = conditions({ turn: 3 })
  assert.ok(Object.keys(r1.positions[0].sit).every((k) => k in c || k.startsWith('self.')))
  // Read back, flat, and reported.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retinue-teach-test-'))
  try {
    fs.writeFileSync(path.join(dir, 'labels.jsonl'), r1.positions.map((p) => JSON.stringify(p) + '\n').join(''))
    const L = loadLabels(dir, { flat: true })
    const n = r1.positions.reduce((k, p) => k + p.options.length, 0)
    assert.equal(L.rows.pos.length, n)
    assert.equal(L.X.length, n * L.features.length)
    assert.equal(L.S.length, r1.positions.length * L.conditions.length)
    const rep = report(L.positions)
    assert.equal(rep.all.positions, r1.positions.length)
    assert.ok(rep.all.agree >= 0 && rep.all.agree <= 1 && rep.all.regret >= 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── the route (redesign.md §2.22: room choices played out) ───────────────────────────────────────

// A run at its first choice, its first two rooms made a deadly elite (the rank's foes at level 40) and an altar.
const deadlyChoice = () => {
  const run = createRun({ seed: 'route-test' })
  const s = run.state
  const start = nodeOf(s.map, s.at)
  const [a, b] = start.next.map((id) => nodeOf(s.map, id))
  start.next = [a.id, b.id]
  a.type = 'elite'
  a.foes = a.foes.map((f) => ({ ...f, lvl: 40 }))
  delete a.waves
  b.type = 'altar'
  delete b.foes
  delete b.waves
  return { run, elite: a.id, altar: b.id }
}

test('a room choice played out: the deadly elite gets the lower value, deterministically, the run untouched', () => {
  const { run, elite, altar } = deadlyChoice()
  const was = JSON.stringify(run.state)
  const L = labelChoice(run, altar, { rooms: 1 })
  assert.equal(JSON.stringify(run.state), was)
  assert.equal(L.options.length, 2)
  const e = L.options.find((o) => o.id === elite)
  const a = L.options.find((o) => o.id === altar)
  assert.equal(e.type, 'elite')
  assert.equal(e.parts.lost, 1)
  assert.equal(a.parts.lost, 0)
  assert.ok(e.value < a.value, `${e.value} < ${a.value}`)
  assert.equal(L.best, a.i)
  assert.equal(L.chosen, a.i)
  assert.equal(L.elite, 1)
  // Each value the weighted sum of its parts.
  for (const o of L.options) {
    const w = ROUTE_WEIGHTS
    const p = o.parts
    const v = -w.lost * p.lost - w.monarch * p.monarch - w.own * p.own + w.essence * p.essence + w.cleared * p.cleared + w.power * p.power + w.purse * p.purse
    assert.ok(Math.abs(v - o.value) < 1e-5)
    for (const k in o.f) assert.ok(ROUTE_FEATURES.includes(k) && Number.isFinite(o.f[k]), k)
  }
  for (const k in L.sit) assert.ok(Number.isFinite(L.sit[k]), k)
  assert.deepEqual(labelChoice(deadlyChoice().run, altar, { rooms: 1 }), L)
})

test('a learned route reads its leaf by the run\'s situation and takes the best room by its weights', () => {
  const { run, elite, altar } = deadlyChoice()
  const sit = survey(run)
  const leaf = (w) => ({ leaf: 'x', w })
  // Split on the Monarch's share: whole, it walks into the elite; else the altar.
  const model = { name: 'test', tree: { if: 'monarch', gt: 0.99, then: leaf({ elite: 1 }), else: leaf({ altar: 1 }) }, rules: [] }
  assert.equal(learnedRoute(model, run, sit).option.node.id, elite)
  run.state.party[0].hp = 1
  assert.equal(learnedRoute(model, run, survey(run)).option.node.id, altar)
  // Installed, it is the expert's route; useRoute(false) the hand-built's, useRoute() route.json's where switched on.
  try {
    useRoute(model)
    assert.equal(pickRoute(run), altar)
  } finally {
    useRoute()
  }
  // A model that keeps the hand-built route's rules (`hand`): its leaf would walk into the elite, but the rules leave it
  // out (TREES.route's no-long-odds: the deadly elite is the stronger), and force the altar for a badly wounded army.
  const keen = { name: 'test', tree: leaf({ elite: 1 }), rules: [] }
  const fresh = deadlyChoice().run
  assert.equal(learnedRoute(keen, fresh, survey(fresh)).option.node.id, elite)
  const kept = learnedRoute({ ...keen, hand: true }, fresh, survey(fresh))
  assert.equal(kept.option.node.id, altar)
  assert.equal(kept.by, 'no-long-odds')
  for (const u of fresh.state.party) if (u.uid) u.hp = 1
  const wounded = learnedRoute({ ...keen, hand: true }, fresh, survey(fresh))
  assert.equal(wounded.option.node.id, altar)
  assert.equal(wounded.by, 'wounded-altar')
  // The conditions and the features are named numbers, every feature a room's.
  const c = routeConditions(run, sit)
  for (const k in c) assert.ok(Number.isFinite(c[k]), k)
  for (const room of sit.rooms) {
    const f = routeFeatures(run, sit, room)
    assert.deepEqual(Object.keys(f).sort(), [...ROUTE_FEATURES].sort())
    for (const k in f) assert.ok(Number.isFinite(f[k]), k)
  }
})

// ── the route to the run's end (round 2: labels play to the end) ─────────────────────────────────

// deadlyChoice, every other battle room of the floor as deadly (its foes at level 40): past the altar the run soon ends.
const deadlyFloor = () => {
  const c = deadlyChoice()
  for (const n of c.run.state.map.nodes) if (n.foes) n.foes = n.foes.map((f) => ({ ...f, lvl: 40 }))
  return c
}

test('a room choice played to the run\'s end: the deadly elite loses the run, the value its parts weighed', () => {
  const { run, elite, altar } = deadlyFloor()
  const was = JSON.stringify(run.state)
  const L = labelChoice(run, altar)
  assert.equal(JSON.stringify(run.state), was)
  const e = L.options.find((o) => o.id === elite)
  const a = L.options.find((o) => o.id === altar)
  // The elite lost in the first room: the loss scaled by the progress it had, nothing carried, no floor cleared.
  assert.equal(e.parts.won, 0)
  assert.ok(e.parts.lost > 0.98 && e.parts.lost <= 1, `${e.parts.lost}`)
  assert.ok(Math.abs(e.parts.lost - (1 - e.share)) < 1e-5)
  assert.equal(e.parts.floors, 0)
  assert.equal(e.parts.monarch + e.parts.own + e.parts.souls, 0)
  // The altar walked through, the run played on by the expert to its end: further, so worth more.
  assert.ok(a.share > e.share && a.rooms >= 1)
  assert.ok(a.value > e.value, `${a.value} > ${e.value}`)
  assert.equal(L.best, a.i)
  // The hand-built route would take the altar (no long odds).
  assert.equal(L.hand, a.i)
  for (const o of L.options) {
    assert.ok(Math.abs(routeEndOf(o.parts, ROUTE_END_WEIGHTS) - o.value) < 1e-5)
    assert.ok(Math.abs(o.parts.rooms - (o.share - 0) * 60) < 1e-4, 'rooms from the choice, the run at its start')
  }
  assert.deepEqual(labelChoice(deadlyFloor().run, altar), L)
})

test('to the end, the chosen room\'s label is the run\'s own rest; the route installed is put back', () => {
  // A route tree that walks into fights; installed while the labeller plays, and taken out after.
  const model = { name: 'test', tree: { leaf: 'x', w: { fight: 1, weak: -1 } }, rules: [] }
  const a = teachRoutes('route-test-2', { route: model, limit: 1 })
  assert.equal(routeModel(), null)
  const b = teachRoutes('route-test-2', { route: model, limit: 1, reuse: false })
  assert.equal(a.positions.length, 1)
  assert.deepEqual(a.positions, b.positions)
  // Its progress as autoplay.js record reads it, under the same route.
  try {
    useRoute(model)
    assert.equal(a.progress.toFixed(6), record({ seed: 'route-test-2', level: 'expert' }).progress.toFixed(6))
  } finally {
    useRoute()
  }
  for (const p of a.positions) {
    assert.ok(p.chosen >= 0 && p.hand >= 0 && p.best >= 0)
    assert.equal(p.options[p.chosen].share, a.progress)
    for (const o of p.options) assert.ok(Number.isFinite(o.value) && o.share >= 0 && o.share <= 1)
  }
})

test('routes read off a labelled choice: a tree\'s pick, the hand-built\'s, and their regret against the labels', () => {
  const p = {
    sit: { monarch: 1, health: 1 }, chosen: 0, hand: 1,
    options: [
      { i: 0, type: 'elite', f: { elite: 1, odds: 0.5 }, prior: 1, value: 10, parts: { lost: 0 } },
      { i: 1, type: 'shop', f: { shop: 1, purse: 2 }, prior: 2, value: 4, parts: { lost: 0 } },
      { i: 2, type: 'fight', f: { fight: 1, odds: 1 }, prior: 0, value: -5, parts: { lost: 0.9 } }
    ]
  }
  const keen = { name: 'test', tree: { if: 'monarch', gt: 0.5, then: { leaf: 'a', w: { elite: 2, shop: 1 } }, else: { leaf: 'b', w: { fight: 1 } } }, rules: [] }
  assert.equal(routePick(keen, p), 0)
  assert.equal(routePick(keen, { ...p, sit: { monarch: 0.2 } }), 2)
  assert.equal(routePick('hand', p), 1)
  assert.equal(routePick('hand', { ...p, hand: undefined }), 1)
  assert.equal(routePick('chosen', p), 0)
  const ag = routeAgreement([p], { hand: (x) => routePick('hand', x), keen: (x) => routePick(keen, x) })
  assert.deepEqual([ag.hand.top1, ag.hand.regret, ag.keen.top1, ag.keen.regret, ag.keen.vs], [0, 6, 1, 0, -6])
  assert.equal(ag.keen.elite, 1)
  assert.equal(ag.hand.shop, 1)
})

// ── the teacher (redesign.md §2.23: the labeller as a player) ────────────────────────────────────

// A piece's options as the teacher weighs them: the prior, the steps, the tile and the target.
const opt = (prior, { steps = 0, tile = 0, target = null } = {}) => ({ prior, path: Array(steps).fill(0), tile, target: target === null ? null : { uid: target } })
const rowsOf = (values) => values.map((value, i) => ({ i, legal: value === null ? 0 : 1, value }))

test('the teacher\'s best: the best value; a tie to the higher prior, then the fewer steps, the lower lane, the lower target', () => {
  assert.equal(bestOf(rowsOf([-10, -10, -10]), [opt(1), opt(3), opt(2)]), 1)
  assert.equal(bestOf(rowsOf([-10, -0.5, -10]), [opt(1), opt(0), opt(9)]), 1)
  assert.equal(bestOf(rowsOf([-1, -1]), [opt(2, { steps: 3 }), opt(2, { steps: 1 })]), 1)
  assert.equal(bestOf(rowsOf([-1, -1]), [opt(2, { tile: tileAt(6, 1) }), opt(2, { tile: tileAt(0, 1) })]), 1)
  assert.equal(bestOf(rowsOf([-1, -1]), [opt(2, { target: 12 }), opt(2, { target: 7 })]), 1)
  // Within 1e-9 a tie; one never legal never taken; none legal, none.
  assert.equal(bestOf(rowsOf([-1, -1 + 1e-12]), [opt(5), opt(1)]), 0)
  assert.equal(bestOf(rowsOf([null, -10]), [opt(9), opt(0)]), 1)
  assert.equal(bestOf(rowsOf([null]), [opt(0)]), -1)
})

test('the teacher takes the labels\' best, a legal option; the same board gives the same orders, the board untouched', () => {
  const L = labelPosition(peril(), 1, null)
  const pick = teacherPick(peril(), 1, null)
  const row = L.options[L.best]
  assert.ok(pick.playouts > 1)
  assert.equal(pick.value, row.value)
  assert.deepEqual([pick.option.tile, pick.option.ability?.id ?? null, pick.option.target?.uid ?? null], [row.tile, row.ability, row.target])
  // Every legal option played out; none better than the one taken.
  for (const o of L.options) if (o.legal) assert.ok(o.value <= row.value)
  // The turn: its orders, End Turn last, each legal on the board as the ones before it left it.
  const b = peril()
  const count = { decisions: 0, playouts: 0, single: 0, ms: 0 }
  const orders = teacherTurn(b, {}, count)
  assert.equal(count.decisions, 1)
  assert.equal(count.playouts, pick.playouts)
  assert.equal(orders.at(-1).type, 'end')
  assert.equal(b.byUid.get(0).hp, 1)
  assert.equal(b.byUid.get(9).hp, 1)
  assert.equal(b.turn, 1)
  assert.deepEqual(teacherTurn(b), orders)
  assert.deepEqual(teacherTurn(peril()), orders)
  for (const x of orders) {
    if (b.over) break
    order(b, x)
  }
})

test('a piece with one option takes it with no playout', () => {
  const b = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 1, y: 1 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 6, y: 10 }
  ])
  // Its Move spent and no foe in its reach: it may only stand where it is.
  const k = b.byUid.get(1)
  k.moved = k.move
  const pick = teacherPick(b, 1, null)
  assert.equal(pick.playouts, 0)
  assert.equal(pick.option.tile, k.tile)
  const count = { decisions: 0, playouts: 0, single: 0, ms: 0 }
  assert.deepEqual(teacherTurn(b, {}, count), [{ type: 'end' }])
  assert.deepEqual([count.decisions, count.playouts, count.single], [1, 0, 1])
})

test('a hopeless board: every option lost alike, the teacher takes the expert\'s own best by its score', () => {
  // The Monarch at 1 HP, three Ghouls about it; the Knight too far off to matter.
  const b = board([
    { id: 'monarch', uid: 0, side: 'party', x: 3, y: 0, hp: 1 },
    { id: 'tomb_knight', uid: 1, side: 'party', x: 6, y: 6 },
    { id: 'grave_ghoul', uid: 9, side: 'foe', x: 2, y: 0 },
    { id: 'grave_ghoul', uid: 10, side: 'foe', x: 4, y: 0 },
    { id: 'grave_ghoul', uid: 11, side: 'foe', x: 3, y: 1 }
  ])
  const L = labelPosition(b, 1, null)
  const legal = L.options.filter((o) => o.legal)
  assert.ok(legal.length > 1 && legal.every((o) => o.value === legal[0].value), JSON.stringify(legal.map((o) => o.value)))
  const pick = teacherPick(b, 1, null)
  const top = Math.max(...legal.map((o) => o.prior))
  assert.ok(Math.abs(pick.option.prior - top) < 1e-5, `${pick.option.prior} against ${top}`)
  assert.equal(L.options[L.best].prior, legal.find((o) => o.prior === top).prior)
})

test('a teacher run plays out of battle as today\'s expert: the same actions up to its first battle', () => {
  const t = teacherRun('teacher-test-1', { fights: 1, log: true })
  const run = createRun({ seed: 'teacher-test-1' })
  const rng = createRng(run.state.seed).stream('autoplay')
  while (run.state.phase !== 'battle') apply(run, policy(run, rng, 'expert'))
  assert.ok(t.log.some((a) => a.type === 'fight'))
  assert.deepEqual(t.log, run.state.log)
  assert.deepEqual([t.player, t.battles.fought, t.decisions], ['teacher', 0, 0])
})

test('--ranker, a configuration\'s `ranker`: installed for the runs and their playouts, from a file too', () => {
  const cfg = { name: 'teacher-test-ranker' }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retinue-teacher-test-'))
  try {
    teacherRun('teacher-test-1', { fights: 1, ranker: cfg })
    assert.deepEqual(rankerModel(), cfg)
    useRanker(null)
    const file = path.join(dir, 'ranker.json')
    fs.writeFileSync(file, JSON.stringify(cfg))
    teacherRun('teacher-test-1', { fights: 1, ranker: file })
    assert.deepEqual(rankerModel(), cfg)
    teacherRun('teacher-test-1', { fights: 1, ranker: null })
    assert.equal(rankerModel(), null)
  } finally {
    useRanker(null)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the paired report: clears each and against each other, the progress difference ± its standard error', () => {
  const line = (seed, player, result, floor, progress, won, fought) => ({ seed, player, result, floor, progress, battles: { won, fought }, ms: 1000, decisions: 10, playouts: 50, single: 2, decisionMs: 500 })
  const rep = pairedReport([
    line('s-0', 'teacher', 'victory', 4, 1, 40, 40), line('s-0', 'expert', 'defeat', 2, 0.4, 15, 16),
    line('s-1', 'teacher', 'defeat', 1, 0.1, 3, 4), line('s-1', 'expert', 'defeat', 1, 0.05, 2, 3),
    line('s-2', 'teacher', 'defeat', 3, 0.6, 30, 31)
  ])
  assert.equal(rep.n, 2)
  assert.deepEqual([rep.teacher.clears, rep.expert.clears, rep.clears.gained, rep.clears.lost], [1, 0, 1, 0])
  assert.ok(Math.abs(rep.progress.diff - 0.325) < 1e-9)
  assert.ok(Math.abs(rep.progress.se - 0.275) < 1e-9)
  assert.deepEqual(rep.teacher.deaths, { 1: 1 })
  assert.deepEqual(rep.expert.deaths, { 1: 1, 2: 1 })
  assert.deepEqual(rep.teacher.battles, { won: 43, fought: 44, rate: 0.9773 })
  assert.equal(rep.cost.playoutsPerDecision, 5)
  assert.ok(pairedLines(rep).length > 3)
})
