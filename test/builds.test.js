// The harness (autoplay.js --builds and --pool, redesign.md §3, §6 Step 0): a run committed to an archetype, the
// difficulty's scale, the pool's table and the report's shape. Functional only: what a committed run plays toward,
// never how well it does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ARCHETYPES, archetypeCombos, recipesOf, synergyOf, useCommit, withCommit, commitOf, targetOf, survey, BOOK, policy, autoplay, record,
  buildRecord, buildJobs, commitsOf, buildRow, buildLines, diversity, diversityChecks, diversityLines, reachedAt, poolTable, poolLines,
  floorOf, visits, LEVELS, altarRites, pivots
} from '../src/sim/autoplay.js'
import { createRun, apply, battleSetup, foeMods, draftPool } from '../src/sim/run.js'
import { FUSION_LIST, SYNERGIES, UNIT_LIST, fusionDef } from '../src/content.js'
import { TUNING } from '../src/tuning.js'

test('the archetypes come from content: every fused kind and every synergy, each with its combos in the book', () => {
  const all = ARCHETYPES()
  assert.deepEqual(all, [...new Set(FUSION_LIST.map((r) => r.result)), ...SYNERGIES.map((x) => x.id)])
  for (const arch of all) {
    const combos = archetypeCombos(arch)
    assert.ok(combos.length, `${arch}: no combo in the book`)
    const syn = synergyOf(arch)
    const recipes = syn ? null : new Set(recipesOf(arch).map((r) => r.id))
    for (const c of combos) {
      if (syn) for (const [axis, need] of Object.entries(syn.needs)) for (const [k, n] of Object.entries(need)) assert.ok((c[axis]?.[k] ?? 0) >= n, `${arch}: ${c.id}`)
      else assert.ok(recipes.has(c.fuse), `${arch}: ${c.id}`)
    }
  }
  // A fused kind's recipes: its own first, and none whose result is another kind unless a fused part needs it.
  for (const r of FUSION_LIST) {
    const below = recipesOf(r.result)
    assert.equal(below[0].result, r.result)
    for (const x of below.slice(1)) assert.ok(Object.keys(below.find((y) => y.needs[x.result])?.needs ?? {}).includes(x.result))
  }
  assert.throws(() => archetypeCombos('no_such_build'), /unknown archetype/)
  assert.deepEqual(commitsOf('all'), all)
  assert.deepEqual(commitsOf('fused'), all.filter((a) => !synergyOf(a)))
  assert.deepEqual(commitsOf('synergies'), SYNERGIES.map((x) => x.id))
  assert.deepEqual(commitsOf('none'), [])
  assert.deepEqual(commitsOf('pale_court,fae_4'), ['pale_court', 'fae_4'])
  assert.throws(() => commitsOf('pale_court,nope'), /unknown archetype/)
})

test('a committed run plays toward its archetype alone: every target it reads is one of its combos; free play reads the book', () => {
  // sim-10's expert falls on floor 1: a whole committed run in about a second.
  for (const arch of ['pale_court', 'channeler_4']) {
    const ids = new Set(archetypeCombos(arch).map((c) => c.id))
    let targets = 0
    withCommit(arch, () => {
      assert.equal(commitOf(), arch)
      const run = createRun({ seed: 'sim-10' })
      autoplay(run, {
        act: (r, rng) => {
          if (r.state.phase !== 'battle') {
            const t = targetOf(r.state)
            if (t) {
              assert.ok(ids.has(t.id), `${arch}: target ${t.id}`)
              assert.equal(survey(r, LEVELS.expert).target.id, t.id)
              targets++
            }
          }
          return policy(r, rng, 'expert')
        }
      })
    })
    assert.ok(targets > 0, `${arch}: never had a target`)
    assert.equal(commitOf(), null)
  }
  // Free play's target, once the draft is taken, is the whole book's best; committed elsewhere, the run reads another.
  useCommit(null)
  const run = createRun({ seed: 'sim-10' })
  while (run.state.phase === 'draft') apply(run, policy(run, null, 'expert'))
  const free = targetOf(run.state)
  assert.ok(free && BOOK.combos.includes(free))
  const other = ARCHETYPES().find((a) => !archetypeCombos(a).includes(free))
  const t = withCommit(other, () => targetOf(run.state))
  assert.ok(t === null || (t !== free && archetypeCombos(other).includes(t)))
})

test('a run at a scale: its foes\' HP and ATK × it in every battle, and no field at 1', () => {
  assert.ok(!('scale' in createRun({ seed: 'sc' }).state))
  const run = createRun({ seed: 'sc', scale: 1.5, start: ['tomb_knight', 'bone_chanter', 'frost_sprite'] })
  assert.equal(run.state.scale, 1.5)
  run.state.at = run.state.map.nodes.find((n) => n.rank === 1).id
  const mods = battleSetup(run).foeMods
  for (const m of foeMods(1, false)) assert.ok(Math.abs(mods.find((x) => x.path === m.path).v - 1.5 * m.v) < 1e-9, m.path)
  // The boss's own multipliers too; at 1, as before.
  for (const m of foeMods(4, true)) assert.ok(Math.abs(foeMods(4, true, 2).find((x) => x.path === m.path && x.who.boss === m.who.boss).v - 2 * m.v) < 1e-9)
  assert.deepEqual(foeMods(2, true, 1), foeMods(2, true))
})

test('the pool\'s table: each floor\'s draws sum to one, a walk\'s chances to its rooms, every recipe\'s parts read', () => {
  const t = poolTable({ runs: 4, seed: 'pooltest' })
  for (const d of t.draws) {
    for (const kind of ['fight', 'elite']) {
      const sum = Object.values(d[kind]).reduce((a, b) => a + b, 0)
      assert.ok(Math.abs(sum - 1) < 1e-9, `floor ${d.floor} ${kind}: ${sum}`)
    }
  }
  // A walk stands in exactly one room of each rank.
  const map = floorOf('pooltest-0', 1)
  const p = visits(map)
  for (const rank of new Set(map.nodes.map((n) => n.rank))) {
    const sum = map.nodes.filter((n) => n.rank === rank).reduce((n, x) => n + (p.get(x.id) ?? 0), 0)
    assert.ok(Math.abs(sum - 1) < 1e-9, `rank ${rank}: ${sum}`)
  }
  // A walk's battles each offer a kind or more, and no kind in more battles than there are.
  for (const b of t.battles) {
    assert.ok(b.battles > 5, `floor ${b.floor}`)
    for (const [kind, n] of Object.entries(b.kinds)) assert.ok(n > 0 && n <= b.battles + 1e-9, kind)
  }
  assert.deepEqual(t.recipes.map((r) => r.id), FUSION_LIST.map((r) => r.id))
  // A recipe's reach its parts' least by the end of floor 2, a fused part's its own recipe's (a capstone's, a trine of
  // a fused kind's: redesign.md §4.1).
  const reach = (id) => t.recipes.find((x) => x.result === id).reach
  for (const r of t.recipes) {
    assert.equal(r.parts.length, Object.keys(fusionDef(r.id).needs).length)
    assert.equal(r.reach, Math.min(...r.parts.map((x) => (x.fused ? reach(x.id) : x.byTwo))))
  }
  assert.deepEqual(Object.keys(t.synergies), SYNERGIES.map((x) => x.id))
  // The draft's offers, each pick taken evenly: every pick offers TUNING.draft.offer floor-1 kinds.
  const offered = Object.values(t.draft).reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(offered - TUNING.draft.picks * TUNING.draft.offer) < 1e-9, `draft: ${offered}`)
  assert.ok(Object.keys(t.draft).every((id) => draftPool().includes(id)))
  const lines = poolLines(t)
  assert.ok(FUSION_LIST.every((r) => lines.some((l) => l.includes(`${r.result} `) && l.includes('reach'))))
})

test('the jobs: free play, then each archetype, on the same seeds', () => {
  const jobs = buildJobs({ commits: ['pale_court', 'fae_4'], runs: 3, seed: 'j' })
  assert.equal(jobs.length, 9)
  assert.deepEqual(jobs.map((j) => j.commit), [null, null, null, 'pale_court', 'pale_court', 'pale_court', 'fae_4', 'fae_4', 'fae_4'])
  assert.deepEqual(jobs.slice(3, 6).map((j) => j.seed), jobs.slice(0, 3).map((j) => j.seed))
  assert.ok(jobs.every((j) => j.builds && j.player === 'expert' && j.scale === 1))
})

test('the report\'s shape: a row an archetype with its margin, and the diversity block', async () => {
  // Basic's runs are short (it falls on floor 1), and record's fields are the same at every level.
  const R = ['rep-0', 'rep-1'].map((seed) => record({ seed, level: 'basic' }))
  for (const r of R) {
    assert.deepEqual(Object.keys(r.end).sort(), ['essence', 'lost', 'monarch', 'souls', 'turns'])
    assert.deepEqual(Object.keys(r.built).sort(), ['army', 'bought', 'field', 'made'])
    assert.ok(r.battles.every((b) => Array.isArray(b.syn)))
    assert.equal(r.end.lost, r.battles.filter((b) => !b.won).length)
    assert.equal(r.commit, null)
  }
  // The harness's own job: committed, its commitment put back after.
  const c = await buildRecord({ seed: 'sim-10', commit: 'pale_court' })
  assert.equal(c.commit, 'pale_court')
  assert.equal(c.player, 'expert')
  assert.equal(commitOf(), null)
  const free = buildRow(R)
  const row = buildRow(R, 'channeler_4', R)
  for (const x of [free, row]) {
    for (const k of ['runs', 'clears', 'progress', 'deaths', 'monarch', 'souls', 'lost', 'essence', 'turns', 'reached', 'first']) assert.ok(k in x, k)
    assert.equal(x.deaths.length, TUNING.run.floors)
  }
  assert.equal(free.reached, null)
  assert.equal(row.diff, 0)
  assert.equal(row.reached, R.filter((r) => reachedAt(r, 'channeler_4') !== null).length / R.length)
  const d = diversity(R)
  assert.equal(d.runs, 2)
  for (const k of ['archetypes', 'kinds', 'roles', 'kins', 'made', 'fusions', 'synergies', 'none', 'relics', 'perRun', 'command', 'altar', 'pivot']) assert.ok(k in d, k)
  assert.ok(R.every((r) => r.battles.every((b) => b.lead && 'kin' in b.lead && 'fused' in b.lead)))
  assert.ok(Object.values(d.kinds).every((v) => v > 0 && v <= 1))
  const checks = diversityChecks(d)
  assert.equal(checks.kinds.of, UNIT_LIST.filter((u) => (u.spawn || u.fused) && !u.boss).length)
  const lines = buildLines([free, row], { runs: 2, seed: 'rep' })
  assert.equal(lines.filter((l) => l.startsWith('free play') || l.startsWith('channeler_4')).length, 2)
  // The deaths' column names the run's floors, as many as it has (the second bug hunt: it said 1/2/3/4 over three).
  const floors = Array.from({ length: TUNING.run.floors }, (_, f) => f + 1).join('/')
  assert.ok(lines[1].includes(`died fl ${floors} `), lines[1])
  assert.ok(diversityLines(d).length >= 7)
})

test('the altars\' rites and the turns after floor 1, read off the records', () => {
  const lead = (kin, fused = null) => ({ kin, fused })
  const run = (result, battles, acts = {}) => ({ result, acts, battles: battles.map(([floor, l]) => ({ floor, lead: l })) })
  const R = [
    run('victory', [['1', lead('undead', 'trine:bone_chanter')], ['2', lead('fae', 'pale_court')], ['4B', lead('fae', 'pale_court')]], { heal: 1, transmute: 1 }),
    run('defeat', [['1', lead('fae', 'pale_court')], ['3', lead('fae', 'pale_court')]], { consecrate: 2 }),
    run('defeat', [['1', lead('drake')], ['2', lead('undead', 'trine:grave_ghoul')]]),
    // Fell on floor 1, or a record of before the lead: not counted.
    run('defeat', [['1', lead('fae')]]),
    { result: 'defeat', acts: {}, battles: [{ floor: '1' }, { floor: '2' }] }
  ]
  assert.deepEqual(pivots(R), { of: 3, kin: 2, kinCleared: 1, fusedOf: 2, fused: 1, fusedCleared: 1 })
  assert.deepEqual(altarRites(R), { perRun: 4 / 5, heal: 0.25, transmute: 0.25, consecrate: 0.5 })
})
