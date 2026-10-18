// The learned decision tree: the vocabulary of conditions, the model tree as data and its soft
// rules (expert.js), today's scorer as a configuration, the fast turn (policy.js), and the fitter on a planted problem
// (fit.js). Functional only: what a configuration decides, never how often it wins.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { order, fork, legalOrders } from '../src/sim/turns.js'
import { expertTurn, situation, expertOptions, features, conditions, optionFeatures, OPTION_FEATURES } from '../src/sim/policy.js'
import { readPlan } from '../src/sim/plan.js'
import {
  decide, decideTree, defaultExpert, expertModel, useExpert, checkModel, leafOf, readTree, RULES, holds, conditions as conditionsOf
} from '../src/sim/expert.js'
import { synthetic, tabulate, fitExpert, choices, agreement, readRows, relabel } from '../src/sim/fit.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { on, scene } from './scene.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const board = (units) => {
  const b = scene(units.map((u) => on(u.id, u.uid, u.side, u.x, u.y, u.lvl ?? 3)), { walls: [] })
  for (const u of units) if (u.hp) b.byUid.get(u.uid).hp = u.hp
  return b
}
const M = (x, y, hp) => ({ id: 'monarch', uid: 0, side: 'party', x, y, hp })
const piece = (b, uid) => b.byUid.get(uid)

// Boards that put each of today's rules and modes to work: the Monarch threatened and wounded, a lethal turn, a
// protect, foes far off, a ward that would be wasted.
const boards = () => [
  board([M(3, 0), { id: 'tomb_knight', uid: 1, side: 'party', x: 3, y: 3 }, { id: 'bone_chanter', uid: 2, side: 'party', x: 2, y: 2 },
    { id: 'frost_sprite', uid: 3, side: 'party', x: 4, y: 2 }, { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 6 },
    { id: 'will_o_wisp', uid: 10, side: 'foe', x: 2, y: 8 }, { id: 'pyre_hound', uid: 11, side: 'foe', x: 4, y: 8 }]),
  board([M(3, 0, 5), { id: 'frost_sprite', uid: 1, side: 'party', x: 3, y: 3 }, { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 2, hp: 10 },
    { id: 'tomb_knight', uid: 10, side: 'foe', x: 5, y: 5, hp: 20 }]),
  board([M(3, 0, 30), { id: 'tomb_knight', uid: 1, side: 'party', x: 1, y: 1 }, { id: 'frost_sprite', uid: 2, side: 'party', x: 5, y: 1 },
    { id: 'tomb_knight', uid: 9, side: 'foe', x: 3, y: 2, lvl: 9 }]),
  board([M(3, 0), { id: 'frost_sprite', uid: 1, side: 'party', x: 1, y: 3 }, { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 3, hp: 12 },
    { id: 'tomb_knight', uid: 10, side: 'foe', x: 1, y: 6, lvl: 6 }]),
  board([M(3, 0), { id: 'frost_sprite', uid: 1, side: 'party', x: 3, y: 3, hp: 12 }, { id: 'tomb_knight', uid: 9, side: 'foe', x: 2, y: 7, lvl: 9 },
    { id: 'tomb_knight', uid: 10, side: 'foe', x: 3, y: 7, lvl: 9 }, { id: 'tomb_knight', uid: 11, side: 'foe', x: 4, y: 7, lvl: 9 }]),
  board([M(3, 0), { id: 'tomb_knight', uid: 1, side: 'party', x: 6, y: 0 }, { id: 'grave_ghoul', uid: 9, side: 'foe', x: 3, y: 10 }])
]

// Today's TREES.battle (2026-10-11, before the tree was learned), as code: the reference defaultExpert reproduces.
const T = () => TUNING.expert.tree
const TODAY = [
  { id: 'no-waste', when: () => true, keep: (o) => !o.v.waste },
  { id: 'monarch-lethal', when: (sit) => !!sit.monarch?.lethal, keep: (o) => !o.v.lethal },
  { id: 'kill-first', when: (sit) => sit.monarch?.threats.length > 0, keep: (o) => o.v.cull > 0 },
  { id: 'never-die', when: () => true, keep: (o) => !o.v.fall || o.v.kill > 0 || o.v.guard > 0 || o.v.harry > 0 },
  { id: 'guard', when: (sit) => sit.monarch?.danger > 0, mode: 'guard' },
  { id: 'protect', when: (sit) => sit.plan?.kind === 'protect', mode: 'protect' },
  { id: 'hold-the-line', when: (sit) => sit.plan?.kind === 'protect', keep: (o) => o.v.post > 0 && o.v.guard > 0 },
  { id: 'frail', when: (sit) => !!sit.monarch && (sit.monarch.danger > 0 || sit.plan?.kind === 'protect'), add: 'frail', scale: (sit) => 1 - sit.monarch.share },
  { id: 'push', when: (sit) => sit.plan?.kind === 'push', mode: 'push' },
  { id: 'no-stall', when: (sit) => sit?.patience >= T().stall, mode: 'press' }
]

test('the conditions: every numeric field of the situation by name, finite, the piece\'s own with it; a lean read reads 0 where it lacks', () => {
  const b = boards()[0]
  const sit = situation(b)
  sit.plan = readPlan(b, sit, { store: false })
  const c = conditions(sit, piece(b, 1))
  for (const k of ['turn', 'patience', 'monarch.danger', 'monarch.peril', 'monarch.lethal', 'monarch.threats', 'monarch.lack', 'roads.open', 'pieces.dies', 'killable',
    'foes', 'wave', 'wave.in', 'plan.hold', 'plan.focus', 'plan.push', 'plan.protect', 'plan.shooters', 'self.share', 'self.block']) assert.ok(k in c, k)
  for (const [k, x] of Object.entries(c)) assert.ok(Number.isFinite(x), k)
  assert.equal(c.foes, 3)
  assert.equal(c['monarch.lack'], 1 - sit.monarch.share)
  assert.equal(Object.values(c).length, Object.keys(conditionsOf(sit, piece(b, 1))).length)
  // Without the piece, none of its own; a lean read, what it lacks at 0.
  assert.ok(!Object.keys(conditions(sit)).some((k) => k.startsWith('self.')))
  const lean = conditions(situation(b, { lean: true }))
  assert.equal(lean.killable, 0)
  assert.deepEqual(Object.keys(lean), Object.keys(conditions(sit)))
  // The option features by name, in order: features' own vector.
  assert.deepEqual(Object.keys(optionFeatures(b, piece(b, 1), expertOptions(b, piece(b, 1))[0], sit)), [...OPTION_FEATURES])
})

test('today\'s scorer as a configuration decides as TREES.battle and the modes did, option for option', () => {
  const W = TUNING.expert.battle
  const model = checkModel(JSON.parse(JSON.stringify(defaultExpert())))
  let n = 0
  for (const b of boards()) {
    const sit = situation(b)
    sit.plan = readPlan(b, sit, { store: false })
    for (const u of b.units.filter((x) => x.side === 'party' && x !== b.monarch)) {
      const opts = expertOptions(b, u)
      for (const o of opts) o.v = features(b, u, o, sit)
      const was = decide(TODAY, sit, opts.map((o) => ({ ...o })), W.option, { modes: W.modes })
      const now = decideTree(model, conditions(sit, u), opts.map((o) => ({ ...o })))
      assert.deepEqual([now.option.tile, now.option.ability?.id, now.option.target?.uid], [was.option.tile, was.option.ability?.id, was.option.target?.uid])
      assert.ok(Math.abs(now.option.score - was.option.score) < 1e-9 * Math.max(1, Math.abs(was.option.score)))
      // The rules that filtered, in order, then the modes, as the path's named nodes passed.
      const filter = (r) => r in RULES
      assert.deepEqual(now.rules, [...was.rules.filter(filter), ...was.rules.filter((r) => !filter(r) && r !== 'frail')])
      n++
    }
  }
  assert.ok(n >= 8)
})

test('a configuration: its path and leaf recorded; a soft rule a bonus (none at 0, hard in effect when strong); hard rules filter', () => {
  const W = Object.fromEntries(OPTION_FEATURES.map((k) => [k, 0]))
  const model = checkModel({
    tree: { id: 'danger', if: 'monarch.danger', gt: 5, then: { leaf: 'hurt', w: { ...W, damage: 1 } }, else: { leaf: 'calm', w: { ...W, damage: 1, kill: 1 } } },
    rules: [{ id: 'no-waste', on: true, hard: false, strength: 0, when: null }]
  })
  const opts = () => [{ v: { ...W, damage: 3, waste: 1 } }, { v: { ...W, damage: 2, kill: 2 } }]
  let r = decideTree(model, { 'monarch.danger': 9 }, opts())
  assert.deepEqual([r.option.v.damage, r.leaf, r.path, r.rules, r.by], [3, 'hurt', 'monarch.danger>5 → hurt', ['danger'], 'leaf hurt'])
  r = decideTree(model, { 'monarch.danger': 1 }, opts())
  assert.deepEqual([r.option.v.kill, r.leaf, r.path], [2, 'calm', 'monarch.danger≤5 → calm'])
  // No-waste soft: weak, outvoted; strong, it decides; its condition false, none.
  model.rules[0].strength = 0.5
  assert.equal(decideTree(model, { 'monarch.danger': 9 }, opts()).option.v.waste, 1)
  model.rules[0].strength = 1e4
  r = decideTree(model, { 'monarch.danger': 9 }, opts())
  assert.deepEqual([r.option.v.waste, r.by], [0, 'no-waste'])
  model.rules[0].when = { field: 'patience', op: 'gt', at: 3 }
  assert.equal(decideTree(model, { 'monarch.danger': 9, patience: 2 }, opts()).option.v.waste, 1)
  assert.ok(holds(model.rules[0].when, { patience: 4 }) && !holds({ field: 'patience', op: 'le', at: 3 }, { patience: 4 }))
  // Hard: a filter, whatever the weights.
  model.rules[0] = { id: 'no-waste', on: true, hard: true, strength: 0, when: null }
  r = decideTree(model, { 'monarch.danger': 9 }, opts())
  assert.deepEqual([r.option.v.waste, r.rules], [0, ['no-waste', 'danger']])
  // `by`: weights added × a condition's value.
  model.tree.then.by = { 'monarch.lack': { kill: 2 } }
  assert.equal(leafOf(model, { 'monarch.danger': 9, 'monarch.lack': 0.5 }).w.kill, 1)
  assert.equal(readTree(model, { 'monarch.danger': 9 }).w.kill, 0)
  // Unknown rules and malformed nodes refused.
  assert.throws(() => checkModel({ tree: { leaf: 'x', w: {} }, rules: [{ id: 'nope', on: true }] }))
  assert.throws(() => checkModel({ tree: { if: 'turn', then: { leaf: 'x', w: {} } } }))
  assert.deepEqual(Object.keys(RULES), ['no-waste', 'monarch-lethal', 'kill-first', 'shooters-first', 'never-die', 'hold-the-line'])
})

test('the configuration in use: expert.json, every leaf a weight for every option feature; useExpert installs another and back', () => {
  const shipped = JSON.parse(fs.readFileSync(new URL('../src/sim/expert.json', import.meta.url), 'utf8'))
  checkModel(shipped)
  const walk = (n) => (n.leaf !== undefined ? [n] : [...walk(n.then), ...walk(n.else)])
  for (const leaf of walk(shipped.tree)) for (const k of OPTION_FEATURES) assert.ok(Number.isFinite(leaf.w[k]), `${leaf.leaf}: ${k}`)
  for (const r of shipped.rules) assert.ok(RULES[r.id] && typeof r.on === 'boolean' && Number.isFinite(r.strength))
  assert.deepEqual(expertModel(), shipped)
  const other = defaultExpert()
  other.name = 'other'
  try {
    assert.equal(useExpert(other).name, 'other')
    assert.equal(expertModel(), other)
  } finally {
    useExpert(null)
  }
  assert.deepEqual(expertModel(), shipped)
})

test('the fast turn: each piece once, by the tree, legal, the same for the same board; the audit hears each path', () => {
  for (const b0 of boards()) {
    const b = fork(b0)
    const notes = []
    const orders = expertTurn(b, { note: (r) => notes.push(r) })
    assert.deepEqual(expertTurn(fork(b0)), orders)
    assert.deepEqual(orders.at(-1), { type: 'end' })
    const pieces = b0.units.filter((u) => u.side === 'party' && u !== b0.monarch)
    const decided = notes.filter((r) => r.decision === 'battle').map((r) => r.uid)
    assert.equal(new Set(decided).size, decided.length)
    assert.ok(decided.every((uid) => pieces.some((u) => u.uid === uid)))
    const paths = notes.filter((r) => r.decision === 'path')
    assert.equal(paths.length, decided.length)
    assert.ok(paths.every((r) => r.by.includes('→')))
    for (const o of orders) {
      if (b.over) break
      if (o.type !== 'end') assert.ok(legalOrders(b).some((l) => JSON.stringify(l) === JSON.stringify(o)), JSON.stringify(o))
      order(b, o)
    }
  }
})

test('the fast turn: record hears each decision, its options as scored and the one taken; explore takes one of the best few', () => {
  const b = boards()[0]
  const recs = []
  const orders = expertTurn(fork(b), { record: (f, info) => recs.push(info) })
  assert.deepEqual(orders, expertTurn(fork(b)))
  assert.ok(recs.length >= 1)
  for (const r of recs) {
    assert.ok(r.chosen === 0 && !r.explored, JSON.stringify(r.chosen))
    assert.ok(r.options.every((o, i) => Number.isFinite(o.value) && (i === 0 || o.value <= r.options[i - 1].value)))
  }
  const turn = (seed) => {
    const out = []
    return { orders: expertTurn(fork(b), { record: (f, info) => out.push(info), explore: { rng: createRng(seed).stream('x'), epsilon: 1, top: 3 } }), out }
  }
  const one = turn('a')
  assert.deepEqual(turn('a').orders, one.orders)
  assert.ok(one.out.every((r) => r.explored && r.chosen >= 0 && r.chosen < 3))
})

test('the fitter: a planted tree and rule found again from noisy playouts, judged on held-out positions', () => {
  const { rows, truth, F } = synthetic({ positions: 1500, options: 8, noise: 0.2, seed: 7 })
  const d = tabulate(rows, { features: F })
  assert.equal(d.n, 1500)
  assert.ok(d.held.reduce((a, b) => a + b, 0) > 200)
  const zero = { tree: { leaf: 'base', w: Object.fromEntries(F.map((f) => [f, 0])) }, rules: [] }
  const { model, report } = fitExpert(d, { prior: zero })
  // The planted splits: the Monarch's danger near its threshold, patience's exact (it is whole).
  const walk = (n) => (n.leaf !== undefined ? [] : [n, ...walk(n.then), ...walk(n.else)])
  const splits = JSON.stringify(walk(model.tree).map((n) => [n.if, n.gt]))
  assert.ok(walk(model.tree).some((n) => n.if === 'monarch.danger' && Math.abs(n.gt - 0.5) < 0.05), splits)
  assert.ok(walk(model.tree).some((n) => n.if === 'patience' && Math.abs(n.gt - 10.5) < 1e-9), splits)
  // The planted rule on, the others off.
  assert.deepEqual(model.rules.filter((r) => r.on).map((r) => r.id), ['no-waste'])
  // Held out: near the truth's own agreement, far above a model of the root alone.
  const test = Array.from({ length: d.n }, (_, j) => j).filter((j) => d.held[j])
  const truthAg = agreement(d, test, choices(truth, d, test).map((x) => x.pick))
  assert.ok(report.test.learned.top1 > truthAg.top1 - 0.06, `${report.test.learned.top1} vs ${truthAg.top1}`)
  const flat = fitExpert(d, { prior: zero, maxLeaves: 1 })
  assert.ok(report.test.learned.regret < flat.report.test.learned.regret / 3, `${report.test.learned.regret} vs ${flat.report.test.learned.regret}`)
  // Rows round-trip through a labels file (teach.js's: a line a position, its options within).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-'))
  try {
    const lines = []
    for (let j = 0; j < 20; j++) {
      const opts = rows.filter((r) => r.pos === `p${j}`)
      lines.push(JSON.stringify({ id: `p${j}`, seed: opts[0].seed, uid: 1, split: j % 5 ? 'train' : 'held', wt: 2, sit: opts[0].c, options: opts.map((o) => ({ f: o.v, legal: true, chosen: o.chosen, value: o.value })) }))
    }
    fs.writeFileSync(path.join(dir, 'labels.jsonl'), lines.join('\n') + '\n')
    const e = tabulate(readRows(dir), { features: F })
    assert.deepEqual([e.n, e.held.reduce((a, b) => a + b, 0), e.wt[0]], [20, 4, 2])
    assert.deepEqual(Array.from(e.y.slice(0, 8)), rows.filter((r) => r.pos === 'p0').map((r) => r.value))
    // The expert's own option left out of each position (`unchosen`).
    assert.equal(tabulate(readRows(dir, { unchosen: true }), { features: F }).m, e.m - 20)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the fitter\'s options: hard rules kept hard, positions alike left out, the L2 in the temperature\'s units, labels to the end read again', () => {
  const { rows, F } = synthetic({ positions: 400, options: 6, noise: 0.2, seed: 3 })
  // A position whose options all score alike is left out with `decisive`.
  const same = rows.filter((r) => r.pos === 'p0')
  for (const r of same) r.value = 1
  assert.equal(tabulate(rows, { features: F }).n, 400)
  const d = tabulate(rows, { features: F, decisive: true })
  assert.equal(d.n, 399)
  // `fixed` 'hard': the prior's hard rule kept, in its place and hard; the others fitted soft (the planted no-waste on).
  const prior = { tree: { leaf: 'base', w: Object.fromEntries(F.map((f) => [f, f === 'damage' ? 1 : 0])) }, rules: [{ id: 'monarch-lethal', on: true, hard: true, strength: 0, when: null }] }
  const { model } = fitExpert(d, { prior, fixed: 'hard', structure: 'prior', relative: true, lambda: 1 })
  assert.deepEqual(model.rules[0], { id: 'monarch-lethal', on: true, hard: true, strength: 0, when: null })
  assert.ok(model.rules.some((r) => r.id === 'no-waste' && r.on && !r.hard && r.strength > 0))
  assert.ok(model.rules.slice(1).every((r) => !r.hard))
  // With λ ÷ T² the leaf leaves its prior; with λ alone, at today's temperatures, it hardly could.
  assert.ok(Math.abs(model.tree.w.kill) > 0.1, JSON.stringify(model.tree.w))
  // A label to the battle's end read again by other weights: a loss is −lost, else the shares and the rounds.
  assert.equal(relabel({ lost: 1, stall: 0, monarch: 0.5, own: 0.5, fell: 1, turns: 9 }, { lost: 7 }), -7)
  assert.ok(Math.abs(relabel({ lost: 0, stall: 0, monarch: 0.1, own: 0.2, fell: 0, turns: 5 }, { turn: 0.1 }) - (-3 * 0.1 - 0.2 - 0.5)) < 1e-9)
})
