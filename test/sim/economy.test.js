// Currencies (§5) — and the one that a losing run still pays.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks } from '../../tools/packsource.node.js'
import {
  floorResidue, runResidue, insightFrom, battleCoin, treasureCoin,
  discoveriesFrom, newDiscoveries, endRun
} from '../../src/sim/economy.js'
import { createRun, playRun } from '../../src/sim/run.js'

const { kernel, tuning } = await createGame({ packs: discoverPacks('packs'), seed: 1 })
const newRun = (seed = 1) => (kernel.defs.restore({ uid: 1 }), createRun({ kernel, tuning, seed }))

// ── Residue ─────────────────────────────────────────────────────────────────────────────────────

test('a floor is worth more than the one above it, geometrically', () => {
  const per = [1, 2, 3, 4].map((f) => floorResidue(f, tuning))
  for (let i = 1; i < per.length; i++) {
    assert.ok(per[i] > per[i - 1])
    assert.equal(Math.round((per[i] / per[i - 1]) * 100) / 100, tuning.residue.floorGrowth)
  }
})

test('★ a run is paid for every floor it reached, not only the deepest', () => {
  // Taking only the deepest floor's value would make floors 1-4 of a floor-5 run literally
  // worthless, which is a strange thing to tell a player about the twenty minutes they just spent.
  const deep = runResidue({ floors: 5, coherence: 0, tuning })
  const sum = [1, 2, 3, 4, 5].reduce((n, f) => n + floorResidue(f, tuning), 0)
  assert.equal(deep, Math.round(sum))
  assert.ok(deep > floorResidue(5, tuning))
})

test('coherence multiplies, and a monobuild is worth the full bonus (§3)', () => {
  // Rounded once, at the end. Rounding the base and then multiplying it would compound the error,
  // which is why the expectation here is built from the unrounded sum rather than from `spread`.
  const raw = [1, 2, 3].reduce((n, f) => n + floorResidue(f, tuning), 0)
  const spread = runResidue({ floors: 3, coherence: 0, tuning })
  const mono = runResidue({ floors: 3, coherence: 1, tuning })
  assert.equal(spread, Math.round(raw))
  assert.equal(mono, Math.round(raw * (1 + tuning.residue.coherenceBonus)))
})

test('a nonsense coherence cannot inflate or negate a payout', () => {
  const sane = runResidue({ floors: 2, coherence: 1, tuning })
  assert.equal(runResidue({ floors: 2, coherence: 9, tuning }), sane)
  assert.equal(runResidue({ floors: 2, coherence: NaN, tuning }), runResidue({ floors: 2, coherence: 0, tuning }))
})

test('the residue:compute hook is where a keystone or a Lattice node moves it (§11.5)', () => {
  let called = false
  const hooks = { emit: (point, p) => { called = point === 'residue:compute'; p.mul *= 2; return p } }
  const raw = [1, 2, 3].reduce((n, f) => n + floorResidue(f, tuning), 0)
  assert.equal(runResidue({ floors: 3, coherence: 0, tuning, hooks }), Math.round(raw * 2))
  assert.ok(called)
})

test('Insight is recomputed from lifetime Residue, so it can never drift', () => {
  assert.equal(insightFrom(0, tuning), 0)
  assert.equal(insightFrom(tuning.insight.divisor, tuning), 1)
  assert.equal(insightFrom(tuning.insight.divisor * 4, tuning), 2)
  assert.equal(insightFrom(-500, tuning), 0)
})

// ── Coin ────────────────────────────────────────────────────────────────────────────────────────

test('Coin pays for what died, on the depth curve, and never for a recruit', () => {
  const battle = {
    units: [
      { side: 'foe', defId: 'core:ember_drake', hp: 0 },      // tier 3, killed
      { side: 'foe', defId: 'core:frost_sprite', hp: 4 },     // alive — talked round or still up
      { side: 'party', defId: 'core:tomb_knight', hp: 0 }     // ours; pays nothing
    ]
  }
  const shallow = battleCoin(kernel.registry, battle, 1, tuning)
  assert.equal(shallow, tuning.coin.perFoeTier * 3)
  assert.ok(battleCoin(kernel.registry, battle, 5, tuning) > shallow)
})

test('a deep chest beats a shallow one', () => {
  assert.ok(treasureCoin(6, tuning) > treasureCoin(1, tuning))
})

// ── Codex ───────────────────────────────────────────────────────────────────────────────────────

test('Codex records a boss first-kill, a first recruit and a live Pact', () => {
  const result = {
    state: {
      units: [
        { uid: 1, side: 'foe', defId: 'core:hollow_sovereign', hp: 0 },
        { uid: 2, side: 'foe', defId: 'core:frost_sprite', hp: 5, left: true }
      ],
      recruited: [2]
    },
    events: [{
      type: 'battle:start',
      synergies: [
        { side: 'party', kind: 'pact', id: 'core:scaled_wall' },
        { side: 'party', kind: 'resonance', id: 'core:undead_2' },
        { side: 'foe', kind: 'pact', id: 'core:glamour' }
      ]
    }]
  }
  assert.deepEqual(discoveriesFrom(kernel.registry, result), [
    'boss:core:hollow_sovereign', 'pact:core:scaled_wall', 'recruit:core:frost_sprite'
  ])
})

test('a boss that survives is not a discovery, and neither is the enemy\'s Pact', () => {
  const result = {
    state: { units: [{ uid: 1, side: 'foe', defId: 'core:hollow_sovereign', hp: 200 }], recruited: [] },
    events: [{ type: 'battle:start', synergies: [{ side: 'foe', kind: 'pact', id: 'core:glamour' }] }]
  }
  assert.deepEqual(discoveriesFrom(kernel.registry, result), [])
})

test('★ Codex is a set, so the second one of anything pays nothing', () => {
  const profile = { codex: ['recruit:core:frost_sprite'] }
  assert.deepEqual(
    newDiscoveries(['recruit:core:frost_sprite', 'recruit:core:hive_warden'], profile),
    ['recruit:core:hive_warden']
  )
  assert.equal(newDiscoveries(['recruit:core:frost_sprite'], profile).length, 0)
})

// ── the run pays out ────────────────────────────────────────────────────────────────────────────

test('a run banks Residue, Coin and Codex, and a wipe still pays', () => {
  const run = newRun(4)
  const out = playRun(run, { maxFloors: 2 })
  const banked = endRun(run)

  assert.equal(banked.floors, run.state.deepest)
  assert.equal(banked.reason, out.reason)
  assert.ok(banked.residue > 0, 'even a wipe on floor 1 is paid for floor 1')
  assert.ok(banked.coin >= 0)
  assert.ok(Array.isArray(banked.codex))
  assert.ok(banked.coherence >= 0 && banked.coherence <= 1)
})

test('★ a losing run still moves the Codex forward, and that is the whole point (§5)', () => {
  // Codex exists because it is the only currency a losing run *can* produce. Note the exact claim
  // §5 makes and the one it does not: a wipe that recruited a new species banks something, and a
  // wipe that recruited nothing banks nothing. Ordinary kills are deliberately not a Codex source —
  // a farmable discovery currency is a contradiction.
  const wipes = [1, 2, 4, 12, 19].map((s) => {
    const run = newRun(s)
    playRun(run, { maxFloors: 8 })
    return { run, banked: endRun(run) }
  }).filter((r) => r.run.state.reason === 'wipe')

  assert.ok(wipes.length, 'expected at least one of these seeds to wipe')
  assert.ok(wipes.some(({ banked }) => banked.codex.length > 0), 'no losing run produced any discovery')
  for (const { run, banked } of wipes) {
    const recruited = run.state.discovered.filter((k) => k.startsWith('recruit:'))
    if (recruited.length) assert.ok(banked.codex.length >= recruited.length)
    assert.ok(banked.residue > 0, 'and a losing run is always paid Residue for the floors it cleared')
  }
})

test('Coin accrues during the run and is reported node by node', () => {
  const run = newRun(5)
  const out = playRun(run, { maxFloors: 2 })
  const reported = out.reports.reduce((n, r) => n + r.coin, 0)
  assert.equal(reported, run.state.coin, 'the reports must add up to the run total')
  assert.ok(out.reports.some((r) => r.coin > 0))
})
