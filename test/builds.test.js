// The harness (src/sim/builds.js, redesign.md §3, §6 Step 0): a run committed to an archetype, the difficulty's scale,
// the pool's table and the report's shape. Functional only: what a committed run plays toward, never how well it does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ARCHETYPES, archetypeCombos, useCommit, withCommit, commitOf, targetOf, BOOK, policy, record, synergyOf
} from '../src/sim/autoplay.js'
import { buildRow, buildLines, diversity, diversityChecks, diversityLines, poolTable, poolLines, buildJobs, commitsOf, visits, floorOf } from '../src/sim/builds.js'
import { createRun, apply, battleSetup, foeMods } from '../src/sim/run.js'
import { createRng } from '../src/sim/rng.js'
import { FUSION_LIST, SYNERGIES, fusionDef, UNIT_LIST } from '../src/content.js'

test('the archetypes are the fused kinds and the synergies, and each has its combos in the book', () => {
  const all = ARCHETYPES()
  for (const r of FUSION_LIST) assert.ok(all.includes(r.result), r.result)
  for (const x of SYNERGIES) assert.ok(all.includes(x.id), x.id)
  assert.equal(all.length, new Set(FUSION_LIST.map((r) => r.result)).size + SYNERGIES.length)
  for (const arch of all) {
    const combos = archetypeCombos(arch)
    assert.ok(combos.length, `${arch}: no combo in the book`)
    const syn = synergyOf(arch)
    for (const c of combos) {
      if (syn) for (const [axis, need] of Object.entries(syn.needs)) for (const [k, n] of Object.entries(need)) assert.ok((c[axis]?.[k] ?? 0) >= n, `${arch}: ${c.id}`)
      else assert.equal(fusionDef(c.fuse).result, arch, `${arch}: ${c.id}`)
    }
  }
  assert.throws(() => archetypeCombos('no_such_build'), /unknown archetype/)
})

test('a committed run plays toward its archetype alone: every target it reads is one of its combos', () => {
  for (const arch of ['rime_drake', 'channeler_4']) {
    const ids = new Set(archetypeCombos(arch).map((c) => c.id))
    withCommit(arch, () => {
      assert.equal(commitOf(), arch)
      const run = createRun({ seed: `commit-${arch}` })
      const rng = createRng(run.state.seed).stream('autoplay')
      let targets = 0
      for (let k = 0; k < 400 && run.state.phase !== 'over'; k++) {
        if (run.state.phase !== 'battle') {
          const t = targetOf(run.state)
          if (t) {
            assert.ok(ids.has(t.id), `${arch}: target ${t.id}`)
            targets++
          }
        }
        apply(run, policy(run, rng, 'expert'))
      }
      assert.ok(targets > 0, `${arch}: never had a target`)
    })
    assert.equal(commitOf(), null)
  }
  // Free play reads the whole book.
  useCommit(null)
  assert.ok(BOOK.combos.length > archetypeCombos('pale_court').length)
})

test('a run at a scale: its foes\' HP and ATK × it in every battle, and no field at 1', () => {
  assert.ok(!('scale' in createRun({ seed: 'sc' }).state))
  const run = createRun({ seed: 'sc', scale: 1.5, start: ['tomb_knight', 'bone_chanter', 'frost_sprite'] })
  assert.equal(run.state.scale, 1.5)
  apply(run, { type: 'node', id: run.state.map.nodes.find((n) => n.rank === 1).id })
  const mods = battleSetup(run).foeMods
  const base = foeMods(1, false)
  for (const path of ['hp', 'atk']) {
    assert.ok(Math.abs(mods.find((m) => m.path === path).v - 1.5 * base.find((m) => m.path === path).v) < 1e-9, path)
  }
  // The boss's own multipliers too.
  const boss = foeMods(4, true, 2)
  for (const m of foeMods(4, true)) assert.ok(Math.abs(boss.find((x) => x.path === m.path && x.who.boss === m.who.boss).v - 2 * m.v) < 1e-9)
})

test('the pool\'s table: each pool\'s draws sum to one, a walk\'s chances to its rooms, every recipe\'s parts read', () => {
  const t = poolTable({ maps: 2, seed: 'pooltest' })
  for (const d of t.draws) {
    for (const kind of ['fight', 'elite']) {
      const sum = Object.values(d[kind]).reduce((a, b) => a + b, 0)
      assert.ok(Math.abs(sum - 1) < 1e-9, `floor ${d.floor} ${kind}: ${sum}`)
    }
  }
  // A walk stands in exactly one room of each rank: its chances on a rank sum to one.
  const map = floorOf('pooltest-0', 1)
  const p = visits(map)
  for (const rank of new Set(map.nodes.map((n) => n.rank))) {
    const sum = map.nodes.filter((n) => n.rank === rank).reduce((n, x) => n + (p.get(x.id) ?? 0), 0)
    assert.ok(Math.abs(sum - 1) < 1e-9, `rank ${rank}: ${sum}`)
  }
  // Every battle a walk meets on floor 1 offers a floor-1 kind, so the floor-1 pool's kinds are offered in battles there.
  assert.ok(t.battles[0].battles > 5)
  assert.deepEqual(t.recipes.map((r) => r.id), FUSION_LIST.map((r) => r.id))
  for (const r of t.recipes) {
    assert.equal(r.parts.length, Object.keys(fusionDef(r.id).needs).length)
    assert.equal(r.reach, Math.min(...r.parts.map((x) => x.byTwo)))
  }
  const lines = poolLines(t)
  assert.ok(lines.some((l) => l.includes('pale_court')) && lines.some((l) => l.startsWith('kins:')))
})

test('the jobs: free play, then each archetype, on the same seeds', () => {
  const jobs = buildJobs({ commits: ['pale_court', 'fae_4'], runs: 3, seed: 'j' })
  assert.equal(jobs.length, 9)
  assert.deepEqual(jobs.map((j) => j.commit), [null, null, null, 'pale_court', 'pale_court', 'pale_court', 'fae_4', 'fae_4', 'fae_4'])
  assert.deepEqual(jobs.slice(3, 6).map((j) => j.seed), jobs.slice(0, 3).map((j) => j.seed))
  assert.deepEqual(commitsOf('all'), ARCHETYPES())
  assert.deepEqual(commitsOf('none'), [])
  assert.throws(() => commitsOf('pale_court,nope'), /unknown archetype/)
})

test('the report\'s shape: a row an archetype with its margin, and the diversity block', () => {
  // Basic's runs are short (it falls on floor 1), and record's fields are the same at every level.
  const R = ['rep-0', 'rep-1'].map((seed) => record({ seed, level: 'basic' }))
  for (const r of R) {
    assert.deepEqual(Object.keys(r.end).sort(), ['essence', 'lost', 'monarch', 'souls', 'turns'])
    assert.deepEqual(Object.keys(r.built).sort(), ['army', 'bought', 'made', 'reached'])
    assert.ok(r.battles.every((b) => Array.isArray(b.syn) && Array.isArray(b.fused)))
    assert.equal(r.end.lost, r.battles.filter((b) => !b.won).length)
  }
  const free = buildRow(R)
  const row = buildRow(R, 'pale_court', R)
  for (const x of [free, row]) {
    for (const k of ['runs', 'clears', 'progress', 'deaths', 'monarch', 'souls', 'lost', 'essence', 'turns']) assert.ok(k in x, k)
    assert.equal(x.deaths.length, 4)
  }
  assert.equal(free.reached, null)
  assert.equal(row.diff, 0)
  assert.ok(row.reached >= 0 && row.reached <= 1)
  const d = diversity(R)
  assert.equal(d.runs, 2)
  for (const k of ['archetypes', 'fused', 'made', 'fusions', 'synergies', 'kinds', 'roles', 'kins', 'relics']) assert.ok(k in d, k)
  const kinds = Object.values(d.kinds)
  assert.ok(kinds.every((v) => v > 0 && v <= 1))
  const c = diversityChecks(d)
  assert.equal(c.kinds.of, UNIT_LIST.filter((u) => u.spawn || u.fused).length)
  const lines = buildLines([free, row], { player: 'expert', scale: 1, seeds: '2 seeds' })
  assert.equal(lines.filter((l) => l.startsWith('free play') || l.startsWith('pale_court')).length, 2)
  assert.ok(diversityLines(d).length >= 8)
})
