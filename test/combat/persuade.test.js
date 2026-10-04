// §10's M2 check, verbatim: "set persuade threshold to 30%, run 100 seeded battles, assert
// observed recruit rate matches the formula within tolerance."
//
// The strong form of that claim is what is asserted here: every attempt logs the exact chance the
// sim rolled against, so the expected number of successes is the sum of those chances. If the roll
// ever drifts from the formula — a stray multiplier, a hook applied twice, a clamp in the wrong
// place — the observed count walks away from the expected one and this fails.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks } from '../../tools/packsource.node.js'
import { makeParty, makeFoes, addRecruits } from '../../src/sim/party.js'
import { createBattle, createContext, initBattle } from '../../src/sim/combat/battle.js'
import { runBattle } from '../../src/sim/combat/resolve.js'
import { persuadeInputs, partyCharm, kinAffinity } from '../../src/sim/combat/persuade.js'
import { persuadeChance } from '../../src/sim/combat/formula.js'
import { makeRng } from '../../src/sim/kernel/rng.js'
import { DEFAULT_DOCTRINE } from '../../src/sim/doctrine.js'

const { kernel, tuning } = await createGame({ packs: discoverPacks('packs'), seed: 1 })
const PARTY = ['core:tomb_knight', 'core:bone_chanter', 'core:frost_sprite']

function battle (seed, { size = 3, floor = 1, lvl = 2 } = {}) {
  kernel.defs.restore({ uid: 1 })
  const rng = makeRng('persuade|' + seed)
  const party = makeParty(kernel, PARTY, { lvl })
  const foes = makeFoes(kernel, rng.stream('spawn'), { floor, size, lvl })
  const state = createBattle({ kernel, tuning, party, foes, seed, floor })
  return { result: runBattle(state, { kernel, tuning, rng: rng.stream('combat') }), party }
}

test('the shipped threshold is the 30% the check assumes', () => {
  assert.equal(tuning.persuade.threshold, 0.30)
})

// ── the gate ───────────────────────────────────────────────────────────────────────────────────

test('over 100 seeded battles the recruit rate matches the formula', () => {
  let attempts = 0
  let successes = 0
  let expected = 0

  for (let s = 0; s < 100; s++) {
    for (const ev of battle(s).result.events) {
      if (ev.type !== 'persuade' || ev.chance === undefined) continue
      attempts++
      expected += ev.chance
      if (ev.success) successes++
    }
  }

  assert.ok(attempts > 100, `only ${attempts} attempts across 100 battles — the loop is not being exercised`)

  // Sum of Bernoulli trials with known, differing p: sd = sqrt(Σ p(1−p)) ≤ sqrt(n)/2.
  const sd = Math.sqrt(attempts) / 2
  const drift = Math.abs(successes - expected)
  assert.ok(drift < 4 * sd,
    `observed ${successes} recruits, formula predicts ${expected.toFixed(1)} (±${(4 * sd).toFixed(1)}) over ${attempts} attempts`)
})

test('an attempt above the threshold is refused without a roll', () => {
  let refusals = 0
  for (let s = 0; s < 40; s++) {
    for (const ev of battle(s).result.events) {
      if (ev.type !== 'persuade') continue
      if (ev.reason === 'too_strong') { refusals++; continue }
      assert.ok(ev.hpPct <= 0.30 + 1e-9, `rolled on a target at ${(100 * ev.hpPct).toFixed(0)}% HP`)
    }
  }
  assert.equal(refusals, 0, 'the policy should never even offer a target above the threshold')
})

// ── the formula's own terms ────────────────────────────────────────────────────────────────────

test('each failure hardens the mark by exactly the decay', () => {
  const at = (attempts) => persuadeChance({ tier: 2, charm: 0, hpPct: 0.2, attempts }, tuning)
  for (let n = 1; n < 6; n++) {
    assert.ok(Math.abs(at(n) - at(n - 1) * tuning.persuade.decay) < 1e-12,
      `attempt ${n} was ${at(n)}, expected ${at(n - 1) * tuning.persuade.decay}`)
  }
})

// The sim's half of the same claim. The formula only decays if something actually counts failures,
// and only the resolver can do that — the battle is where the two halves have to meet.
test('a failed attempt is counted, and a successful one never is', () => {
  let checked = 0
  for (let s = 0; s < 60; s++) {
    const { result } = battle(s)
    const failures = new Map()
    for (const ev of result.events) {
      if (ev.type !== 'persuade' || ev.chance === undefined) continue
      assert.equal(ev.attempts, failures.get(ev.target) ?? 0,
        `target ${ev.target} rolled with attempts=${ev.attempts} after ${failures.get(ev.target) ?? 0} failures`)
      if (!ev.success) failures.set(ev.target, (failures.get(ev.target) ?? 0) + 1)
      checked++
    }
    for (const [uid, n] of failures) {
      const unit = result.state.units.find((u) => u.uid === uid)
      if (!unit.left) assert.equal(unit.persuadeAttempts, n)
    }
  }
  assert.ok(checked > 100, `only ${checked} rolls seen`)
})

test('the weaker the target, the better the odds — monotonically', () => {
  const at = (hpPct) => persuadeChance({ tier: 2, charm: 0, hpPct, attempts: 0 }, tuning)
  let last = 0
  for (const hp of [0.30, 0.25, 0.20, 0.15, 0.10, 0.05, 0]) {
    const c = at(hp)
    assert.ok(c > last, `${hp} gave ${c}, not better than ${last}`)
    last = c
  }
})

test('Charm is party-wide and a shared Kin tag helps', () => {
  kernel.defs.restore({ uid: 1 })
  // Humanoid 2 + Trickster 2 grants Silver Tongue's Charm; the base party has neither.
  const plain = makeParty(kernel, PARTY, { lvl: 2 })
  const foes = makeParty(kernel, ['core:tomb_knight'], { side: 'foe', lvl: 2 })
  const state = createBattle({ kernel, tuning, party: plain, foes, seed: 1 })
  const ctx = createContext(state, { kernel, tuning, rng: makeRng(1).stream('t') })
  initBattle(ctx)

  const actor = state.units.find((u) => u.side === 'party')
  const target = state.units.find((u) => u.side === 'foe')
  target.hp = Math.ceil(target.maxHp * 0.2)

  const inputs = persuadeInputs(ctx, actor, target)
  assert.equal(inputs.charm, partyCharm(ctx, 'party'))
  // The party fields Undead; so does the Tomb Knight we are talking to.
  assert.equal(inputs.kinAffinity, tuning.persuade.kinAffinity)
  assert.equal(kinAffinity(ctx, 'party', kernel.registry.get('unit', target.defId)), tuning.persuade.kinAffinity)
  assert.ok(persuadeChance(inputs, tuning) > persuadeChance({ ...inputs, kinAffinity: 1 }, tuning))
})

// ── what recruitment does to the run ───────────────────────────────────────────────────────────

test('a successful persuade removes the unit from the fight and banks it', () => {
  for (let s = 0; s < 60; s++) {
    const { result } = battle(s)
    for (const ev of result.events.filter((e) => e.type === 'recruit')) {
      const unit = result.state.units.find((u) => u.uid === ev.target)
      assert.equal(unit.left, true, 'a recruit leaves the field rather than dying')
      assert.ok(unit.hp > 0, 'and leaves it alive')
      assert.ok(result.state.recruited.includes(ev.target))
      // It must stop acting the moment it is persuaded.
      const after = result.events.filter((e) => e.type === 'action' && e.actor === ev.target && e.t > ev.t)
      assert.equal(after.length, 0, 'a recruited unit kept fighting')
    }
  }
})

test('recruits join the roster, and the cap forces a cut', () => {
  const { result, party } = battle(7)
  const joinedNow = result.state.recruited.length

  const grown = addRecruits(kernel, party, result.state, { tuning })
  assert.equal(grown.roster.length, party.length + joinedNow)
  assert.equal(grown.joined.length, joinedNow)
  for (const u of grown.joined) assert.ok(u.hp >= Math.ceil(u.maxHp * 0.25), 'a recruit arrives usable')
  assert.ok(grown.roster.every((u) => u.slot >= 0), 'and gets a slot in the formation')

  // Now do it against a full party: the cut rule has to name a victim or the recruit is declined.
  const full = Array.from({ length: tuning.party.cap }, (_, i) => ({
    uid: 9000 + i, defId: 'core:frost_sprite', lvl: 9 - (i % 3), hp: 10, maxHp: 10, slot: i, side: 'party'
  }))
  const capped = addRecruits(kernel, full, result.state, { tuning })
  assert.equal(capped.roster.length, tuning.party.cap, 'the cap holds')
  assert.equal(capped.cut.length, joinedNow)
  for (const victim of capped.cut) assert.equal(victim.lvl, 7, 'lowestLevel cut the lowest level')
})

test('with no cut rule, a recruit into a full party is declined rather than dropped silently', () => {
  const { result } = battle(7)
  const full = Array.from({ length: tuning.party.cap }, (_, i) => ({
    uid: 9000 + i, defId: 'core:frost_sprite', lvl: 3, hp: 10, maxHp: 10, slot: i, side: 'party', pinned: true
  }))
  const out = addRecruits(kernel, full, result.state, { tuning, doctrine: { ...DEFAULT_DOCTRINE, cut: 'none' } })
  assert.equal(out.roster.length, tuning.party.cap)
  assert.equal(out.joined.length, 0)
  assert.equal(out.declined.length, result.state.recruited.length)
})
