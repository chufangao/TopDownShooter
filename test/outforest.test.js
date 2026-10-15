// The forest out of battle (src/sim/outforest.js, redesign.md §2.25): forests that may overrule today's recruit,
// purchases and formation where they read another candidate the better by more than their margin; the reads they decide
// by, alike in a label row (outside.js --label) and in play (autoplay.js outsideRead, prepRead), the labeller, the
// fitting's plumbing and the measurement's (autoplay.js withOutForest, record's `outforest`, playerOf). Functional only:
// what a forest decides and how it is read, never how often it wins.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  useOutForest, outForestModel, outDecides, checkOutForest, outInputNames, encodeOut, chooseOut, predictOut, readOutDecision, readOutTable, fitOutForest, SIT_KEYS, CAND_KEYS, OUT_D,
  PREP_SIT_KEYS, PREP_CAND_KEYS, layoutOf, opensBoard
} from '../src/sim/outforest.js'
import { labelRun, rereadRun, baseStep, candidatesAt } from '../src/sim/outside.js'
import { createRun, apply, availableNodes, souls, join, START_PARTY } from '../src/sim/run.js'
import { slotAt } from '../src/sim/unit.js'
import { fight } from './rooms.js'
import {
  policy, autoplay, record, withOutForest, playerOf, survey, LEVELS, recruitCandidates, spendCandidates, outCandidates, outsideRead, plan, planFor, prepCandidates,
  prepRead, formationName, PREP_CAP
} from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'

const L = LEVELS.expert
// sim-10's expert drafts, then falls on floor 1 after five battles: three recruits and a purchase, a whole run in about
// a second; a seed ≡ 0 mod 5, so its rows are held out. (sim-0 was the seed before the draft: drafted, its run clears,
// and labelling it to the end takes minutes; sim-395 until the fusion graph, whose lines run longer; sim-540 until the
// pool was flattened, 2026-10-15: its run clears.)
const SEED = 'sim-10'
const CAP = 3

// A phase's forest (outforest.json's shape) from trees given as nested nodes ({ f: an input's name, t: its threshold, l,
// r } or a leaf's number), its margin `delta` and target, over the inputs of `phase` (the recruit's and the purchases'
// alike).
function phaseOf (trees, { delta = 0.1, target = 'today', phase = 'recruit' } = {}) {
  const m = { inputs: outInputNames(phase).slice(), target, delta, size: [], feat: [], thr: [], right: [], value: [] }
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
// A prep's forest that reads every draft far above the hill-climb's formations: it fields a draft wherever one is read.
const drafter = () => phaseOf([{ f: 'f.draft', t: 0.5, l: -1, r: 5 }], { phase: 'prep' })
// A forest that reads passing on (no recruit, no purchase) far above every other candidate: it never recruits or buys
// where today would.
const passer = () => outOf({ recruit: phaseOf([{ f: 'f.none', t: 0.5, l: -1, r: 5 }]), spend: phaseOf([{ f: 'f.none', t: 0.5, l: -1, r: 5 }]) }, 'passer')

// The labels of SEED (labelRun at a cap of CAP), made once; and of its formations (FORMATIONS a prep), made once: each
// by today's expert, no forest out of battle in use (whatever outforest.json ships), as the tests that walk it again read
// it.
const todays = (fn) => {
  const before = outForestModel()
  try {
    useOutForest(null)
    return fn()
  } finally {
    useOutForest(before)
  }
}
let LABELS = null
const labels = () => (LABELS ??= todays(() => labelRun(SEED, { cap: CAP })))
const FORMATIONS = 4
let PREPS = null
const preps = () => (PREPS ??= todays(() => labelRun(SEED, { phases: 'prep', formations: FORMATIONS })))

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
      assert.equal(row.run, 10)
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
    // A prep forest's formation is the base's: walked to step for step, and the teacher's first formation.
    useOutForest(outOf({ ...passer().phases, prep: drafter() }, 'passer-drafter'))
    let met = 0
    walk(SEED, (run, a) => {
      assert.deepEqual(baseStep(run), a, `${run.state.phase} step`)
      const d = candidatesAt(run, { phases: 'prep' })
      if (d.phase !== 'prep') return
      assert.equal(d.cands[0].id, formationName(planFor(run, L)))
      met++
    })
    assert.ok(met > 0)
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
    // The labels of two seeds, one held out (SEED) and one fitted (sim-1's first rows), its formations' among them.
    const own = [...labels().rows, ...preps().rows]
    const rows = [...own, ...own.map((r) => ({ ...r, seed: 'sim-1', run: 1, split: 'val' }))]
    fs.writeFileSync(path.join(dir, 'labels.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    for (const phase of ['recruit', 'spend', 'prep']) {
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
      d.rows.forEach((o, i) => assert.ok(Math.abs(predictOut(m, o.x, phase) - r.held[t.start[p] + i]) < 1e-4 * (1 + Math.abs(r.held[t.start[p] + i]))))
      const opts = row.options.filter((o) => Number.isFinite(o.value))
      const pick = chooseOut(outOf({ [phase]: m }), phase, { sit: row.sit, f: [opts.find((o) => o.today), ...opts.filter((o) => !o.today)].map((o) => o.f) })
      assert.ok(pick.index >= 0 && pick.index < d.rows.length)
      // Weighed by floor, the same plumbing: the weights recorded with the forest.
      const w = await fitOutForest(t, { trees: 2, minLeaf: 1, depth: 3, floors: [2, 1] })
      assert.deepEqual(w.config.made.floors, [2, 1])
      checkOutForest(outOf({ [phase]: w.config }))
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
    const formations = preps().rows
    assert.deepEqual(rereadRun(SEED, formations, CAP, FORMATIONS), formations)
  } finally {
    useOutForest(before)
  }
})

test('a forest that recruits with a full retinue lets the weakest go, then makes that recruit, and a decision reads the base\'s pick as it stands', () => {
  const before = outForestModel()
  try {
    // A forest that reads every recruit far above passing on.
    useOutForest(outOf({ recruit: phaseOf([{ f: 'f.recruit', t: 0.5, l: -1, r: 5 }]) }, 'recruiter'))
    let released = 0
    for (let i = 0; i < 6; i++) {
      const run = createRun({ start: START_PARTY, seed: 'letgo' + i })
      const node = availableNodes(run)[0]
      node.type = 'fight'
      node.foes = [{ id: 'tomb_knight', lvl: 1, slot: slotAt(0, 3) }]
      apply(run, { type: 'node', id: node.id })
      fight(run)
      if (run.state.phase !== 'reap') continue
      const s = run.state
      s.essence = 1000
      while (souls(s.party).length < 12) join(run, 'clockwork_page')
      const rng = createRng('letgo').stream('autoplay')
      const a = policy(run, rng, 'expert')
      assert.equal(a.type, 'release', JSON.stringify(a))
      // The outside teacher's base pick, before the release and after it, is the forest's.
      assert.equal(candidatesAt(run).cands[0].actions[0].type, 'release')
      apply(run, a)
      const b = policy(run, rng, 'expert')
      assert.ok(b.type === 'reap' && b.index !== null, JSON.stringify(b))
      assert.deepEqual(candidatesAt(run).cands[0].actions, [b])
      released++
    }
    assert.ok(released > 0)
  } finally {
    useOutForest(before)
  }
})

test('a prep label row\'s formations and reads are play\'s for the same decision, its base the formation play fields', () => {
  const before = outForestModel()
  try {
    useOutForest(null)
    const { rows } = preps()
    assert.ok(rows.length > 0 && rows.every((r) => r.phase === 'prep'))
    const at = new Map(rows.map((r) => [r.at, r]))
    let met = 0
    walk(SEED, (run) => {
      const row = run.state.phase === 'prep' ? at.get(run.state.log.length) : null
      if (!row) return
      const sit = survey(run, L)
      const { cands } = prepCandidates(run, L, plan(run, L), { cap: FORMATIONS })
      assert.deepEqual(cands.map((c) => c.id), row.options.map((o) => o.id))
      const read = prepRead(run, L, sit, cands)
      assert.deepEqual(read.sit, row.sit)
      assert.deepEqual(read.f, row.options.map((o) => o.f))
      assert.deepEqual(Object.keys(read.sit), PREP_SIT_KEYS)
      for (const f of read.f) assert.deepEqual(Object.keys(f), PREP_CAND_KEYS)
      // Its reads in play are the same with the survey read there, as planFor reads them.
      assert.deepEqual(prepRead(run, L, null, cands), read)
      assert.equal(formationName(planFor(run, L)), row.options.find((o) => o.base).id)
      met++
    })
    assert.equal(met, rows.length)
  } finally {
    useOutForest(before)
  }
})

test('the prep labeller is deterministic, its run the base\'s untouched, each formation\'s battle played out once a plan', () => {
  const before = outForestModel()
  try {
    useOutForest(null)
    const a = preps()
    const b = labelRun(SEED, { phases: 'prep', formations: FORMATIONS })
    assert.deepEqual(b.rows, a.rows)
    const base = record({ seed: SEED, level: 'expert' })
    assert.equal(a.line.result, base.result)
    assert.equal(a.line.progress, base.progress)
    assert.equal(a.line.battles.fought, base.battles.length)
    // One prep decision a battle at most (SEED's every battle is a prep's), labelled with every formation.
    assert.ok(a.rows.length >= 1 && a.rows.length <= base.battles.length)
    assert.equal(a.line.phases.prep.labelled, a.rows.length)
    assert.equal(new Set(a.rows.map((r) => r.at)).size, a.rows.length)
    const { V0, D } = layoutOf('prep')
    for (const row of a.rows) {
      assert.ok(row.options.length >= 2 && row.options.length <= FORMATIONS)
      assert.ok(row.options[0].today && row.options.filter((o) => o.today).length === 1)
      assert.equal(row.options.filter((o) => o.base).length, 1)
      assert.equal(new Set(row.options.map((o) => o.id)).size, row.options.length)
      for (const o of row.options) {
        assert.ok(Number.isFinite(o.value) && Number.isFinite(o.parts.turns))
        assert.equal(o.won, o.parts.lost === 0)
        assert.equal(o.won, o.value > -10)
      }
      const d = readOutDecision(row)
      assert.equal(d.rows[0].x.length, D)
      assert.ok(d.rows[0].x.subarray(V0).every((x) => x === 0))
    }
  } finally {
    useOutForest(before)
  }
})

test('a prep forest decides the formation: one never past its margin plays today\'s move for move, one that reads the drafts far above fields one', () => {
  const before = outForestModel()
  try {
    useOutForest(null)
    const today = autoplay(createRun({ seed: SEED }), { level: 'expert' }).state.log
    // Of target 'today', every leaf at most delta; of the centred target, every tree a single leaf.
    useOutForest(outOf({ prep: phaseOf([0.1, { f: 'f.v.open', t: 0.5, l: -3, r: 0.1 }], { phase: 'prep' }) }))
    assert.ok(outDecides('prep') && !outDecides('recruit'))
    assert.deepEqual(autoplay(createRun({ seed: SEED }), { level: 'expert' }).state.log, today)
    useOutForest(outOf({ prep: phaseOf([3, -1], { phase: 'prep', target: 'mean' }) }))
    assert.deepEqual(autoplay(createRun({ seed: SEED }), { level: 'expert' }).state.log, today)
    assert.throws(() => checkOutForest(outOf({ prep: phaseOf([0]) })), /unknown input/)
    useOutForest(outOf({ prep: drafter() }, 'drafter'))
    let met = 0
    let drafted = 0
    walk(SEED, (run) => {
      if (run.state.phase !== 'prep') return
      const { cands } = prepCandidates(run, L, plan(run, L))
      assert.ok(cands.length <= PREP_CAP)
      const pick = cands.find((c) => c.id === formationName(planFor(run, L)))
      assert.ok(pick, 'the formation planned is one of the forest\'s')
      if (cands.some((c) => c.draft)) assert.ok(pick.draft)
      drafted += !cands[0].draft && pick.draft
      met++
    })
    assert.ok(met > 0 && drafted > 0)
    assert.notDeepEqual(autoplay(createRun({ seed: SEED }), { level: 'expert' }).state.log, today)
  } finally {
    useOutForest(before)
  }
})

test('a prep forest that never reads the opening boards decides alike without them, and one fitted without them reads none', async () => {
  // Splits on the formation's static read and its shape alone, or on the board it opens on too.
  const blind = phaseOf([{ f: 'f.v.cover', t: 30, l: -0.5, r: { f: 'vs.seat1', t: 0.5, l: 0.3, r: -0.2 } }, { f: 'f.draft', t: 0.5, l: 0, r: 0.4 }], { phase: 'prep', target: 'mean', delta: 0.05 })
  const sighted = phaseOf([{ f: 'f.o.pieces.danger', t: 20, l: 0.5, r: -0.5 }], { phase: 'prep', target: 'mean', delta: 0.05 })
  assert.equal(opensBoard(blind), false)
  assert.equal(opensBoard(sighted), true)
  const model = outOf({ prep: blind })
  let met = 0
  walk(SEED, (run) => {
    if (run.state.phase !== 'prep') return
    const { cands } = prepCandidates(run, L, plan(run, L))
    const lean = prepRead(run, L, null, cands, { boards: false })
    assert.ok(lean.f.every((f) => Object.keys(f).filter((k) => k.startsWith('o.')).every((k) => f[k] === 0)))
    assert.deepEqual(chooseOut(model, 'prep', lean), chooseOut(model, 'prep', prepRead(run, L, null, cands)))
    met++
  })
  assert.ok(met > 0)
  // Fitted `without` the board's inputs, a forest names none of them.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retinue-outforest-blind-'))
  try {
    const rows = preps().rows
    fs.writeFileSync(path.join(dir, 'labels.jsonl'), [...rows, ...rows.map((r) => ({ ...r, seed: 'sim-1', run: 1, split: 'val' }))].map((r) => JSON.stringify(r)).join('\n') + '\n')
    const t = await readOutTable([dir], 'prep', { bins: 16 })
    const r = await fitOutForest(t, { trees: 3, minLeaf: 1, depth: 4, without: ['s.o.', 'f.o.', 'vs.o.'] })
    assert.ok(r.config.inputs.length < t.D && !r.config.inputs.some((n) => /^(s|f|vs)\.o\./.test(n)))
    checkOutForest(outOf({ prep: r.config }))
    assert.equal(opensBoard(r.config), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
