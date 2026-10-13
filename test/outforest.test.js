// The forest out of battle (src/sim/outforest.js, redesign.md §2.25): forests that may overrule today's recruit and
// purchases where they read another candidate the better by more than their margin; the reads they decide by, alike in a
// label row (outside.js --label) and in play (autoplay.js outsideRead), the labeller, the fitting's plumbing and the
// measurement's (autoplay.js withOutForest, record's `outforest`, playerOf). Functional only: what a forest decides and
// how it is read, never how often it wins.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  useOutForest, outForestModel, outDecides, checkOutForest, outInputNames, encodeOut, chooseOut, predictOut, readOutDecision, readOutTable, fitOutForest, SIT_KEYS, CAND_KEYS, OUT_D
} from '../src/sim/outforest.js'
import { labelRun, rereadRun, baseStep } from '../src/sim/outside.js'
import { createRun, apply } from '../src/sim/run.js'
import {
  policy, autoplay, record, withOutForest, playerOf, survey, LEVELS, recruitCandidates, spendCandidates, outCandidates, outsideRead
} from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'

const L = LEVELS.expert
// sim-0's expert falls on floor 1 after five battles: four recruits and a purchase, a whole run in about a second.
const SEED = 'sim-0'
const CAP = 3

// A phase's forest (outforest.json's shape) from trees given as nested nodes ({ f: an input's name, t: its threshold, l,
// r } or a leaf's number), its margin `delta` and target.
function phaseOf (trees, { delta = 0.1, target = 'today' } = {}) {
  const m = { inputs: outInputNames().slice(), target, delta, size: [], feat: [], thr: [], right: [], value: [] }
  const emit = (n) => {
    const at = m.feat.length
    if (typeof n === 'number') {
      m.feat.push(-1)
      m.value.push(n)
      return
    }
    const j = m.inputs.indexOf(n.f)
    assert.ok(j >= 0, n.f)
    m.feat.push(j)
    m.thr.push(n.t)
    const k = m.right.length
    m.right.push(0)
    emit(n.l)
    m.right[k] = m.feat.length - at
    emit(n.r)
  }
  for (const t of trees) {
    const before = m.feat.length
    emit(t)
    m.size.push(m.feat.length - before)
  }
  return m
}
const outOf = (phases, name = 'test-outforest') => ({ kind: 'outforest', name, phases })
// A forest that reads passing on (no recruit, no purchase) far above every other candidate: it never recruits or buys
// where today would.
const passer = () => outOf({ recruit: phaseOf([{ f: 'f.none', t: 0.5, l: -1, r: 5 }]), spend: phaseOf([{ f: 'f.none', t: 0.5, l: -1, r: 5 }]) }, 'passer')

// The labels of SEED (labelRun at a cap of CAP), made once.
let LABELS = null
const labels = () => (LABELS ??= labelRun(SEED, { cap: CAP }))

// The base's run on `seed`, each step out of battle handed to `visit(run, action)` before it is applied.
function walk (seed, visit) {
  const run = createRun({ seed })
  const rng = createRng(seed).stream('autoplay')
  while (run.state.phase !== 'over') {
    const a = policy(run, rng, 'expert')
    if (run.state.phase !== 'battle') visit(run, a)
    apply(run, a)
  }
  return run
}

test('a label row\'s candidates and reads are play\'s for the same decision', () => {
  const before = outForestModel()
  try {
    useOutForest(null)
    const { rows } = labels()
    assert.ok(rows.some((r) => r.phase === 'recruit') && rows.some((r) => r.phase === 'spend'))
    const at = new Map(rows.map((r) => [r.at, r]))
    let met = 0
    walk(SEED, (run) => {
      const row = at.get(run.state.log.length)
      if (!row) return
      const sit = survey(run, L)
      const d = row.phase === 'recruit' ? recruitCandidates(run, L, sit) : spendCandidates(run, L, sit)
      const cands = outCandidates(d, CAP)
      assert.deepEqual(cands.map((c) => c.id), row.options.map((o) => o.id))
      const read = outsideRead(run, L, sit, row.phase, cands)
      assert.deepEqual(read.sit, row.sit)
      assert.deepEqual(read.f, row.options.map((o) => o.f))
      assert.deepEqual(Object.keys(read.sit), SIT_KEYS)
      for (const f of read.f) assert.deepEqual(Object.keys(f), CAND_KEYS)
      met++
    })
    assert.equal(met, rows.length)
  } finally {
    useOutForest(before)
  }
})

test('the labeller is deterministic, its run the base\'s untouched by its playouts, its rows as the forest reads them', () => {
  const before = outForestModel()
  try {
    useOutForest(null)
    const a = labels()
    const b = labelRun(SEED, { cap: CAP })
    assert.deepEqual(b.rows, a.rows)
    const base = record({ seed: SEED, level: 'expert' })
    assert.equal(a.line.result, base.result)
    assert.equal(a.line.floor, base.floor)
    assert.equal(a.line.progress, base.progress)
    assert.equal(a.line.battles.fought, base.battles.length)
    for (const row of a.rows) {
      assert.equal(row.seed, SEED)
      assert.equal(row.run, 0)
      assert.equal(row.split, 'held')
      assert.ok(row.options.length >= 2 && row.options.length <= CAP + 1)
      assert.ok(row.options.some((o) => o.f.none === 1))
      assert.ok(row.options[0].today && row.options.filter((o) => o.today).length === 1)
      assert.equal(row.options.filter((o) => o.base).length, 1)
      for (const o of row.options) {
        assert.ok(Number.isFinite(o.value))
        assert.ok(o.parts && Number.isFinite(o.parts.lost))
      }
      const d = readOutDecision(row)
      assert.equal(d.rows.length, row.options.length)
      // Today's pick against itself: every vs.* and the gap 0.
      assert.ok(d.rows[0].x.subarray(SIT_KEYS.length + CAND_KEYS.length).every((x) => x === 0))
    }
  } finally {
    useOutForest(before)
  }
})

test('with no forest out of battle the expert is today\'s; one whose advantages never pass its margin plays it move for move', () => {
  const before = outForestModel()
  try {
    useOutForest(null)
    assert.equal(outDecides('recruit'), false)
    const today = autoplay(createRun({ seed: SEED }), { level: 'expert' }).state.log
    // Of target 'today', every leaf at most delta: no candidate is ever read more than delta above today's pick.
    const level = outOf({ recruit: phaseOf([0.1, { f: 'f.recruit', t: 0.5, l: -3, r: 0.1 }]), spend: phaseOf([{ f: 'gap', t: 0, l: 0.05, r: -1 }]) })
    useOutForest(level)
    assert.ok(outDecides('recruit') && outDecides('spend'))
    assert.deepEqual(autoplay(createRun({ seed: SEED }), { level: 'expert' }).state.log, today)
    // Every tree a single leaf, of the centred target: every candidate reads alike, today's pick kept.
    useOutForest(outOf({ recruit: phaseOf([4, 2], { target: 'mean' }), spend: phaseOf([7], { target: 'mean' }) }))
    assert.deepEqual(autoplay(createRun({ seed: SEED }), { level: 'expert' }).state.log, today)
    // One that reads passing on far above the rest never recruits and never buys a tier, where today's expert does both.
    useOutForest(passer())
    const log = autoplay(createRun({ seed: SEED }), { level: 'expert' }).state.log
    const grows = (a) => (a.type === 'reap' && a.index !== null) || a.type === 'upgrade' || a.type === 'release'
    assert.ok(today.some((a) => a.type === 'reap' && a.index !== null) && today.some((a) => a.type === 'upgrade'))
    assert.ok(!log.some(grows))
  } finally {
    useOutForest(before)
  }
})

test('with a forest out of battle in use, the outside teacher\'s base step is still the expert\'s, step for step', () => {
  const before = outForestModel()
  try {
    useOutForest(passer())
    let n = 0
    walk(SEED, (run, a) => {
      n++
      assert.deepEqual(baseStep(run), a, `${run.state.phase} step ${n}`)
    })
    assert.ok(n > 10)
  } finally {
    useOutForest(before)
  }
})

test('a forest decides by the best other candidate\'s advantage over today\'s pick, past its margin alone', () => {
  const sit = Object.fromEntries(SIT_KEYS.map((k) => [k, 0]))
  const f = (over) => ({ ...Object.fromEntries(CAND_KEYS.map((k) => [k, 0])), ...over })
  const read = { sit, f: [f({ score: 1 }), f({ 'k.tier': 2, score: 0.5 }), f({ 'k.tier': 3 })] }
  const x = encodeOut(sit, read.f[1], read.f[0])
  const names = outInputNames()
  assert.equal(x.length, OUT_D)
  assert.equal(x[names.indexOf('f.k.tier')], 2)
  assert.equal(x[names.indexOf('vs.k.tier')], 2)
  assert.equal(x[names.indexOf('gap')], 0.5)
  // R by the candidate's tier: 0 for today's, 0.4 and 0.6 for the others.
  const by = (delta, target) => outOf({ recruit: phaseOf([{ f: 'f.k.tier', t: 0.5, l: 0, r: { f: 'f.k.tier', t: 2.5, l: 0.4, r: 0.6 } }], { delta, target }) })
  assert.deepEqual(chooseOut(by(0.5, 'mean'), 'recruit', read), { index: 2, margin: 0.6 })
  assert.deepEqual(chooseOut(by(0.6, 'mean'), 'recruit', read), { index: 0, margin: 0 })
  assert.deepEqual(chooseOut(by(0.3, 'today'), 'recruit', read), { index: 2, margin: 0.6 })
  assert.deepEqual(chooseOut(by(0.3, 'today'), 'spend', read), { index: 0, margin: 0 })
  assert.throws(() => checkOutForest(outOf({ route: phaseOf([0]) })), /no phase/)
  assert.throws(() => checkOutForest(outOf({ recruit: { ...phaseOf([0]), inputs: ['s.nothing'] } })), /unknown input/)
  assert.throws(() => checkOutForest(outOf({ recruit: { ...phaseOf([0]), delta: undefined } })), /margin/)
  assert.throws(() => checkOutForest({ kind: 'forest', phases: {} }), /no phases/)
})

test('a forest is fitted on the labels, bagged by run, and reads in play as it was fitted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retinue-outforest-'))
  try {
    // The labels of two seeds, one held out (sim-0) and one fitted (sim-1's first rows).
    const rows = [...labels().rows, ...labels().rows.map((r) => ({ ...r, seed: 'sim-1', run: 1, split: 'val' }))]
    fs.writeFileSync(path.join(dir, 'labels.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    for (const phase of ['recruit', 'spend']) {
      const t = await readOutTable([dir], phase, { bins: 16 })
      assert.equal(t.P, rows.filter((r) => r.phase === phase).length)
      const r = await fitOutForest(t, { trees: 3, minLeaf: 1, depth: 3, delta: 0.2 })
      const m = r.config
      assert.equal(m.size.length, 3)
      checkOutForest(outOf({ [phase]: m }))
      assert.equal(r.heldOut.length, t.P / 2)
      // A held-out decision's predictions on its bins are the forest's on its raw inputs, as play reads them (its leaves
      // written to five figures).
      const p = r.heldOut[0]
      const row = rows.filter((x) => x.phase === phase)[p]
      const d = readOutDecision(row)
      d.rows.forEach((o, i) => assert.ok(Math.abs(predictOut(m, o.x) - r.held[t.start[p] + i]) < 1e-4 * (1 + Math.abs(r.held[t.start[p] + i]))))
      const opts = row.options.filter((o) => Number.isFinite(o.value))
      const pick = chooseOut(outOf({ [phase]: m }), phase, { sit: row.sit, f: [opts.find((o) => o.today), ...opts.filter((o) => !o.today)].map((o) => o.f) })
      assert.ok(pick.index >= 0 && pick.index < d.rows.length)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a job\'s forest out of battle is installed for its run and the one before put back; a paired player names it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retinue-outforest-job-'))
  const before = outForestModel()
  try {
    const file = path.join(dir, 'o.json')
    fs.writeFileSync(file, JSON.stringify(passer()))
    const mine = outOf({ spend: phaseOf([0]) }, 'mine')
    useOutForest(mine)
    assert.equal(withOutForest('none', () => outForestModel()), null)
    assert.equal(outForestModel(), mine)
    assert.equal(withOutForest(file, () => outForestModel().name), 'passer')
    assert.equal(withOutForest(undefined, () => outForestModel()), mine)
    assert.throws(() => withOutForest(file, () => { throw new Error('inside') }), /inside/)
    assert.equal(outForestModel(), mine)
    assert.equal(record({ seed: SEED, level: 'expert', outforest: file }).outforest, 'passer')
    assert.equal(outForestModel(), mine)
    assert.equal(record({ seed: SEED, level: 'expert', outforest: 'none' }).outforest, null)
    assert.equal(outForestModel(), mine)
    assert.deepEqual(playerOf(`outforest:${file}`), { outforest: file })
    assert.deepEqual(playerOf('outforest:none'), { outforest: 'none' })
  } finally {
    useOutForest(before)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a label set read again is the same rows where the read is the same', () => {
  const before = outForestModel()
  try {
    useOutForest(null)
    const { rows } = labels()
    assert.deepEqual(rereadRun(SEED, rows, CAP), rows)
    assert.throws(() => rereadRun(SEED, rows.map((r) => ({ ...r, options: r.options.slice(1) })), CAP), /no longer the labels'/)
  } finally {
    useOutForest(before)
  }
})
