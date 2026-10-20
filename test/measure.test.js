// Cheaper measurement: the paired comparison stopped once decided
// (src/sim/sequential.js: the design's bounds, the rule at each look) and the run cache (src/sim/runcache.js: its key
// and what a hit returns), and --paired --sequential end to end on a few basic runs. Functional only: the rule on
// made-up paired data, never a measured difference.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { boundaries, crossings, plan, look, decide, sequence, stopLine, MIN_GAIN } from '../src/sim/sequential.js'
import { runCache, codeHash } from '../src/sim/runcache.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const near = (x, want, tol, what) => assert.ok(Math.abs(x - want) <= tol, `${what}: ${x} against ${want}`)
// Paired records of `n` seeds: a's progress `pa`, b's a's plus `d(i)` (in points), b clearing where `clears(i)`.
const pairs = (n, d, { pa = 0.5, clears = () => false } = {}) => ({
  a: Array.from({ length: n }, () => ({ progress: pa, result: 'defeat' })),
  b: Array.from({ length: n }, (_, i) => ({ progress: pa + d(i) / 100, result: clears(i) ? 'victory' : 'defeat' }))
})

test('the designs\' bounds: the published constants, and the default plan spends α at its last look', () => {
  const eq = (K) => Array.from({ length: K }, (_, k) => (k + 1) / K)
  // Jennison and Turnbull, table 2.1 and 2.3: Pocock's C_P(5, 0.05) 2.413, O'Brien–Fleming's C_B(5, 0.05) 2.040.
  near(boundaries(eq(5), { design: 'pocock' })[0], 2.413, 0.002, 'Pocock, five looks')
  const obf = boundaries(eq(5), { design: 'obf' })
  near(obf[4], 2.040, 0.002, "O'Brien–Fleming at the last look")
  near(obf[0], 2.040 * Math.sqrt(5), 0.005, "O'Brien–Fleming at the first")
  const p = plan({ runs: 768, block: 64 })
  assert.deepEqual(p.looks, Array.from({ length: 12 }, (_, k) => 64 * (k + 1)))
  assert.ok(p.bounds.slice(0, -1).every((b) => b === 3), 'Haybittle–Peto: 3 before the last look')
  near(p.bounds.at(-1), 2.03, 0.01, 'its last look')
  near(crossings(p.bounds, p.t).total, 0.05, 0.0005, 'α spent')
  // Under a difference of 2.8 standard errors at the last look (the fixed test's 80% power), most of the power kept.
  assert.ok(crossings(p.bounds, p.t, 2.8).total > 0.77)
  assert.deepEqual(plan({ runs: 100, block: 64 }).looks, [64, 100])
  assert.equal(plan({ runs: 768, block: 64 }), p, 'memoized')
  assert.throws(() => plan({ runs: 64, design: 'bayes' }), /unknown design/)
})

test('the rule on made-up paired data: a win and a loss at the first look, futility, the tiebreak spared, level at the last', () => {
  const runs = { runs: 768, block: 64 }
  // A gain far past the bound: decided at 64 seeds.
  let x = pairs(768, (i) => 10 + (i % 3))
  let s = sequence(x.a, x.b, runs)
  assert.deepEqual([s.stop.decision, s.stop.n, s.looks.length], ['win', 64, 1])
  s = sequence(x.b, x.a, runs)
  assert.deepEqual([s.stop.decision, s.stop.n], ['loss', 64])
  // Half a point worse, spread 10: past no bound, but its upper bound (−0.5 + 1.645 × 0.88) under a point at 128 seeds.
  x = pairs(768, (i) => (i % 2 ? 9.5 : -10.5))
  s = sequence(x.a, x.b, runs)
  assert.deepEqual([s.stop.decision, s.stop.n], ['futile', 128])
  assert.ok(s.stop.upper < MIN_GAIN && s.stop.z > -3)
  assert.match(stopLine(s.stop, s.plan), /futile/)
  // The same with b ahead on clears (the tiebreak's keep): never futile, played to the last look, level there.
  x = pairs(768, (i) => (i % 2 ? 9.5 : -10.5), { clears: (i) => i % 16 === 0 })
  s = sequence(x.a, x.b, runs)
  assert.deepEqual([s.stop.decision, s.stop.n, s.looks.length], ['level', 768, 12])
  assert.match(stopLine(s.stop, s.plan), /tiebreak.*b ahead/)
  // No difference and a wide spread: level at the last look; a minimum gain of 0 never cuts it either.
  x = pairs(768, (i) => (i % 2 ? 40 : -40))
  assert.equal(sequence(x.a, x.b, runs).stop.decision, 'level')
  assert.equal(sequence(x.a, x.b, { ...runs, minGain: 0 }).stop.n, 768)
  // Every look reads the seeds played so far, in seed order: a prefix of the fixed comparison's.
  x = pairs(768, (i) => (i % 2 ? 9.5 : -10.5))
  s = sequence(x.a, x.b, runs)
  for (const l of s.looks) assert.deepEqual({ ...look(x.a.slice(0, l.n), x.b.slice(0, l.n)) }, { n: l.n, diff: l.diff, se: l.se, z: l.z, won: l.won, lost: l.lost, cdiff: l.cdiff, cse: l.cse })
  // A look decides only what its bound and z say: at the last look a z inside it is level, never futile.
  const p = plan(runs)
  assert.equal(decide({ diff: -1, se: 1, z: -1, won: 0, lost: 0 }, 11, p).decision, 'level')
  assert.equal(decide({ diff: -1, se: 1, z: -1, won: 0, lost: 0 }, 0, p).decision, 'continue')
  assert.equal(decide({ diff: -1, se: 1, z: -1, won: 0, lost: 0 }, 1, p).decision, 'futile')
  assert.equal(decide({ diff: 6, se: 2, z: 3, won: 0, lost: 0 }, 0, p).decision, 'win')
})

test('the stopping rule\'s false positives stay under α on comparisons of nothing', () => {
  // mulberry32: seeded, so the test reads the same every time.
  let r = 7
  const rand = () => {
    r = (r + 0x6D2B79F5) | 0
    let t = Math.imul(r ^ (r >>> 15), 1 | r)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  // A run's progress as the expert's spread it: a clear (1) three times in four, else somewhere on the way.
  const run = () => (rand() < 0.75 ? { progress: 1, result: 'victory' } : { progress: rand(), result: 'defeat' })
  let wrong = 0
  let seeds = 0
  const K = 300
  for (let i = 0; i < K; i++) {
    const a = Array.from({ length: 256 }, run)
    const b = Array.from({ length: 256 }, run)
    const s = sequence(a, b, { runs: 256, block: 64 }).stop
    if (s.decision === 'win' || s.decision === 'loss') wrong++
    seeds += s.n
  }
  assert.ok(wrong / K < 0.07, `${wrong} of ${K}`)
  assert.ok(seeds < K * 256, 'futility cuts some')
})

test('the run cache: its key follows the code, a model file\'s bytes and the run\'s options; a hit is the record kept', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retinue-cache-'))
  try {
    const root = path.join(tmp, 'src')
    fs.cpSync(path.join(ROOT, 'src/sim'), path.join(root, 'sim'), { recursive: true })
    for (const f of ['content.js', 'tuning.js']) fs.copyFileSync(path.join(ROOT, 'src', f), path.join(root, f))
    assert.equal(codeHash(root), codeHash(path.join(ROOT, 'src')), 'the same code, wherever it lies')
    const dir = path.join(tmp, 'cache')
    const c = runCache({ dir, root })
    const job = { seed: 'k-0', level: 'expert', ascension: 2 }
    const k = c.key(job)
    assert.equal(c.key({ ascension: 2, level: 'expert', seed: 'k-0', outforest: undefined }), k, 'the keys\' order and an undefined one read nothing')
    for (const other of [{ ...job, seed: 'k-1' }, { ...job, level: 'basic' }, { ...job, ascension: 3 }, { ...job, monarch: 'brass' }, { ...job, scale: 1.2 },
      { ...job, ablate: 'orders' }, { builds: true, ...job, commit: 'pale_court', strict: true }, { builds: true, ...job, commit: 'pale_court' }]) assert.notEqual(c.key(other), k, JSON.stringify(other))
    // A forest out of battle's file by its bytes: two paths alike are one key; a byte changed, another.
    const e1 = path.join(tmp, 'e1.json')
    const e2 = path.join(tmp, 'e2.json')
    fs.writeFileSync(e1, '{"name":"x"}')
    fs.writeFileSync(e2, '{"name":"x"}')
    assert.equal(c.key({ ...job, outforest: e1 }), c.key({ ...job, outforest: e2 }))
    assert.notEqual(c.key({ ...job, outforest: e1 }), k)
    fs.writeFileSync(e2, '{"name":"y"}')
    fs.utimesSync(e2, new Date(), new Date(Date.now() + 5000))
    assert.notEqual(c.key({ ...job, outforest: e1 }), c.key({ ...job, outforest: e2 }))
    assert.equal(c.key({ ...job, outforest: 'none' }), c.key({ ...job, outforest: 'none' }))
    // A hit: what was kept, read back as JSON reads it (an undefined field left out, as the record a miss returns).
    const rec = { seed: 'k-0', progress: 0.5, battles: [{ won: true, setup: undefined }], secs: 1.5 }
    assert.equal(c.get(k), null)
    const kept = c.put(k, rec)
    assert.deepEqual(kept, { seed: 'k-0', progress: 0.5, battles: [{ won: true }], secs: 1.5 })
    assert.deepEqual(c.get(k), kept)
    assert.deepEqual(runCache({ dir, root }).get(k), kept, 'another process, the same code')
    assert.deepEqual([c.hits, c.played], [1, 1])
    // A changed source file misses: the sim's, the content's, a new one beside them.
    for (const change of [() => fs.appendFileSync(path.join(root, 'sim/rng.js'), '\n// a comment\n'), () => fs.appendFileSync(path.join(root, 'content.js'), '\n'),
      () => fs.writeFileSync(path.join(root, 'sim/new.json'), '{}')]) {
      const before = runCache({ dir, root })
      change()
      const after = runCache({ dir, root })
      assert.notEqual(after.code, before.code)
      assert.notEqual(after.key(job), before.key(job))
      assert.equal(after.get(after.key(job)), null)
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('--paired --sequential end to end: blocks in seed order, the fixed comparison\'s seeds, its runs read back from the cache', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retinue-seq-'))
  try {
    const cli = (...args) => {
      const r = spawnSync(process.execPath, ['src/sim/autoplay.js', '--paired', 'none,none', '--level', 'basic', '--seed', 'sqt', '--workers', '1', '--cache', tmp, ...args], { cwd: ROOT, encoding: 'utf8' })
      assert.equal(r.status, 0, r.stderr)
      return r
    }
    const seq = cli('--sequential', '--runs', '4', '--block', '2')
    assert.match(seq.stdout, /look 1\/2: +2 seeds/)
    assert.match(seq.stdout, /look 2\/2: +4 seeds/)
    assert.match(seq.stdout, /paired, sequential: 4 of at most 4 seeds sqt-0…sqt-3/)
    assert.match(seq.stdout, /level after every seed/)
    // a and b are one job a seed: played once.
    assert.match(seq.stderr, /0 runs read, 4 played/)
    const again = cli('--sequential', '--runs', '4', '--block', '2')
    assert.equal(again.stdout, seq.stdout)
    assert.match(again.stderr, /4 runs read, 0 played/)
    const fixed = cli('--runs', '4')
    assert.match(fixed.stderr, /4 runs read, 0 played/)
    const row = (out, k) => out.split('\n').find((l) => l.startsWith(`${k} `))
    assert.equal(row(fixed.stdout, 'a'), row(seq.stdout, 'a'))
    assert.equal(row(fixed.stdout, 'b'), row(seq.stdout, 'b'))
    const none = spawnSync(process.execPath, ['src/sim/autoplay.js', '--paired', 'none,none', '--level', 'basic', '--seed', 'sqt', '--workers', '1', '--runs', '2', '--no-cache'], { cwd: ROOT, encoding: 'utf8' })
    assert.equal(none.status, 0, none.stderr)
    assert.doesNotMatch(none.stderr, /run cache/)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
