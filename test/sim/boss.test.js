// Bosses (§6.3) — and the claim that they cost no code.
//
// §6.3's whole argument is that a boss is a unit def with a flag: one slot, three things the flag
// turns on, and every mechanic expressed as a data row. The test that matters is therefore not
// "does the boss work" but "is any of this special-cased" — so the last test in this file builds a
// boss out of an ordinary unit at runtime and asserts it behaves identically.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks } from '../../tools/packsource.node.js'
import { makeParty, makeFoes } from '../../src/sim/party.js'
import { createBattle } from '../../src/sim/combat/battle.js'
import { runBattle } from '../../src/sim/combat/resolve.js'
import { persuadable } from '../../src/sim/combat/persuade.js'
import { makeRng } from '../../src/sim/kernel/rng.js'
import { createRun, playRun, BATTLE_NODES } from '../../src/sim/run.js'

const { kernel, tuning } = await createGame({ packs: discoverPacks('packs'), seed: 1 })
const BOSS = 'core:hollow_sovereign'
const PARTY = ['core:tomb_knight', 'core:bone_chanter', 'core:frost_sprite', 'core:hive_warden',
  'core:ember_drake', 'core:clockwork_page']

function bossFight (seed = 'boss', lvl = 10) {
  // uids are stamped by the shared instancer and they appear in every event, so two fights are only
  // comparable by hash if they start numbering from the same place.
  kernel.defs.restore({ uid: 1 })
  const rng = makeRng(seed)
  const party = makeParty(kernel, PARTY, { side: 'party', lvl })
  const foes = makeFoes(kernel, rng.stream('spawn'), { floor: 8, tuning, boss: true })
  const battle = createBattle({ kernel, tuning, party, foes, seed: 1, floor: 8, boss: true })
  return { foes, result: runBattle(battle, { kernel, tuning, rng: rng.stream('combat') }) }
}

// ── the flag ────────────────────────────────────────────────────────────────────────────────────

test('a boss node fields one unit, not a large encounter', () => {
  assert.equal(BATTLE_NODES.boss, 1)
  const { foes } = bossFight()
  assert.equal(foes.length, 1)
  assert.equal(foes[0].defId, BOSS)
  assert.equal(foes[0].slot, 1, 'front-centre, so a melee party can always reach it')
})

test('a boss is drawn only for a boss node, and only a boss is', () => {
  const rng = makeRng('pool')
  const ordinary = makeFoes(kernel, rng.stream('spawn'), { floor: 8, size: 6, tuning })
  assert.ok(ordinary.every((u) => !kernel.registry.get('unit', u.defId).boss))
  const boss = makeFoes(kernel, rng.stream('spawn'), { floor: 8, tuning, boss: true })
  assert.ok(boss.every((u) => kernel.registry.get('unit', u.defId).boss))
})

// ── persuade immunity ───────────────────────────────────────────────────────────────────────────

test('persuade immunity is a default off the flag, not a hardcoded check', () => {
  assert.equal(persuadable({ boss: true }), false)
  assert.equal(persuadable({}), true)
  // A recruitable boss is a designed exception, and it has to be expressible.
  assert.equal(persuadable({ boss: true, persuadable: true }), true)
})

test('★ nobody spends a gauge fill talking to a boss', () => {
  // Both halves matter: policy must not *choose* the attempt (or the party loses the fight to its
  // own doctrine), and the op must refuse it (because a mod's ability can reach the op directly).
  const { result } = bossFight('immune', 12)
  const attempts = result.events.filter((e) => e.type === 'persuade')
  assert.equal(attempts.length, 0, JSON.stringify(attempts.slice(0, 3)))
  assert.deepEqual(result.state.recruited, [])
})

test('the op refuses an attempt aimed straight at a boss, and says why', () => {
  const rng = makeRng('direct')
  const party = makeParty(kernel, PARTY, { side: 'party', lvl: 10 })
  const foes = makeFoes(kernel, rng.stream('spawn'), { floor: 8, tuning, boss: true })
  foes[0].hp = 1                                       // well under any threshold
  const battle = createBattle({ kernel, tuning, party, foes, seed: 1, floor: 8, boss: true })
  const ctx = {
    battle, tuning, kernel, registry: kernel.registry, hooks: kernel.hooks, rng: rng.stream('combat'),
    t: 0, emit: (ev) => events.push(ev), statsOf: () => ({ persuade: { threshold: 1, chance: 1 }, charm: 0 })
  }
  const events = []
  kernel.ops.run({ op: 'core:persuade' }, ctx, battle.units[0], [battle.units.find((u) => u.side === 'foe')])
  assert.equal(events.length, 1)
  assert.equal(events[0].success, false)
  assert.equal(events[0].reason, 'immune')
})

// ── phases ──────────────────────────────────────────────────────────────────────────────────────

test('★ phases fire at their HP fractions, in order, once each', () => {
  const { result } = bossFight('phases', 10)
  const phases = result.events.filter((e) => e.type === 'phase')
  assert.deepEqual(phases.map((e) => e.status), ['core:enraged', 'core:desperate'])
  assert.deepEqual(phases.map((e) => e.phase), [1, 2])
  assert.ok(phases[0].t < phases[1].t, 'the fight only goes one way')
})

test('a phase grants an ordinary status, and it lasts the fight', () => {
  const { result } = bossFight('lasts', 10)
  const boss = result.state.units.find((u) => u.defId === BOSS)
  const granted = result.events.filter((e) => e.type === 'phase').map((e) => e.status)
  if (boss.hp > 0) {
    // `dur: 'battle'` is not a tick count, so it must never be counted down. Before this was fixed,
    // a non-numeric duration was coerced to 0 and the status expired on the very next tick.
    for (const id of granted) assert.ok(boss.statuses.some((s) => s.id === id), `${id} expired early`)
  }
  const expired = result.events.filter((e) => e.type === 'expire' && granted.includes(e.status))
  assert.deepEqual(expired, [])
})

test('phases are reset at the start of every battle, not carried between them', () => {
  const a = bossFight('reset', 10)
  const b = bossFight('reset', 10)
  assert.equal(a.result.hash, b.result.hash, 'the same seed must produce the same fight twice')
  assert.deepEqual(a.foes.map((u) => u.phase), b.foes.map((u) => u.phase))
})

// ── deferred escalation ─────────────────────────────────────────────────────────────────────────

test('★ escalation is deferred so the last phase is reachable (§6.3)', () => {
  // A 35-second bound on a fight designed to last 60 would make phase 3 content nobody ever sees.
  const { result } = bossFight('escalation', 10)
  const normal = tuning.escalation.startTick
  const deferred = normal * tuning.escalation.bossMult
  assert.ok(deferred > normal)
  const lastPhase = result.events.filter((e) => e.type === 'phase').at(-1)
  assert.ok(lastPhase && lastPhase.t < deferred,
    `the final phase landed at tick ${lastPhase?.t}, at or past the deferred escalation start ${deferred}`)
})

test('a boss fight still ends — deferral bounds it later, it does not unbound it', () => {
  const { result } = bossFight('bounded', 10)
  assert.equal(result.state.over, true)
  assert.notEqual(result.state.reason, 'tick-ceiling')
})

// ── the run ─────────────────────────────────────────────────────────────────────────────────────

test('killing the boss ends the run at the bottom rather than at the stairs', () => {
  const run = createRun({ kernel, tuning, seed: 3 })
  const out = playRun(run, { maxFloors: 8 })
  if (out.reason === 'boss') {
    assert.equal(run.state.deepest, 8)
    assert.ok(run.state.discovered.includes(`boss:${BOSS}`), 'a first boss kill is what feeds Codex (§5)')
  } else {
    assert.equal(out.reason, 'wipe', `unexpected run end: ${out.reason}`)
  }
})

// ── the claim ───────────────────────────────────────────────────────────────────────────────────

test('★ "boss" is three data fields — nothing in the sim knows this unit by name', () => {
  const def = kernel.registry.get('unit', BOSS)
  assert.deepEqual(Object.keys(def).filter((k) => ['boss', 'phases', 'persuadable'].includes(k)).sort(),
    ['boss', 'phases'])
  // Everything else about it is an ordinary unit: the same stat block, the same abilities list, the
  // same art descriptor over the same rig. A pack ships one of these the same way it ships a rat.
  assert.ok(def.base.hp > 0 && def.abilities.length && def.art.descriptor)
  for (const p of def.phases) assert.ok(kernel.registry.has('status', p.grant))
})
