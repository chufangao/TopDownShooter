// M1's gate (§9): a battle resolves in pure JS and nothing outside it can change the outcome.
//
// The determinism regression here is the single most valuable test in the project (§10) — it is
// what catches an accidental Math.random and any leak of wall-clock time into logic.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks } from '../../tools/packsource.node.js'
import { makeRng } from '../../src/sim/kernel/rng.js'
import { makeParty, makeFoes } from '../../src/sim/party.js'
import { createBattle, createContext, initBattle, timelineHash } from '../../src/sim/combat/battle.js'
import { resolveTick, runBattle } from '../../src/sim/combat/resolve.js'

const packs = discoverPacks('packs')
const { kernel, tuning } = await createGame({ packs, seed: 1 })

const PARTY = ['core:tomb_knight', 'core:bone_chanter', 'core:ember_drake', 'core:hive_warden']

/**
 * A reproducible battle. Two things are deliberate here and both are part of the replay contract:
 *
 *   * uids are reset, because they appear in the timeline and the instancer counter is save state
 *     (§11.2, §14) — a replay restores it rather than renumbering.
 *   * spawn and combat draw from separate named streams (§11.7), so changing how foes are picked
 *     cannot shift a single die roll inside the fight.
 */
function battleFor (kernelIn, tuningIn, seed, { size = 4, floor = 2, lvl = 3 } = {}) {
  kernelIn.defs.restore({ uid: 1 })
  const rng = makeRng(seed)
  const party = makeParty(kernelIn, PARTY, { lvl })
  const foes = makeFoes(kernelIn, rng.stream('spawn'), { floor, size })
  const battle = createBattle({ kernel: kernelIn, tuning: tuningIn, party, foes, seed, floor })
  return { battle, rng: rng.stream('combat') }
}

const run = (seed, opts) => {
  const { battle, rng } = battleFor(kernel, tuning, seed, opts)
  return runBattle(battle, { kernel, tuning, rng })
}

// ── §18.5 determinism regression ───────────────────────────────────────────────────────────────

test('a fixed seed produces a stable timeline hash', async () => {
  const a = run(42)
  // A second kernel, loaded from scratch: nothing may carry over between games.
  const fresh = await createGame({ packs, seed: 1 })
  const { battle, rng } = battleFor(fresh.kernel, fresh.tuning, 42)
  const b = runBattle(battle, { kernel: fresh.kernel, tuning: fresh.tuning, rng })

  assert.equal(a.hash, b.hash)
  assert.equal(a.ticks, b.ticks)
  assert.equal(a.state.winner, b.state.winner)
  assert.deepEqual(a.events.map((e) => e.type), b.events.map((e) => e.type))
})

test('different seeds produce different timelines', () => {
  const hashes = new Set([1, 2, 3, 4, 5].map((s) => run(s).hash))
  assert.equal(hashes.size, 5)
})

// The ×1 / ×8 gate (§9, M1): playback speed is a property of the renderer's clock. The sim has no
// clock, so stepping it one tick at a time and stepping it in one go must be indistinguishable.
test('tick-by-tick and all-at-once resolution are byte-identical', () => {
  const whole = run(9)

  const { battle, rng } = battleFor(kernel, tuning, 9)
  const ctx = createContext(battle, { kernel, tuning, rng })
  initBattle(ctx)
  ctx.hooks.emit('battle:start', {}, ctx)
  ctx.emit({
    t: 0,
    type: 'battle:start',
    units: battle.units.map((u) => ({ uid: u.uid, defId: u.defId, side: u.side, slot: u.slot, hp: u.hp, maxHp: u.maxHp })),
    synergies: ['party', 'foe'].flatMap((side) =>
      ctx.synergies(side).map((s) => ({ side, id: s.id, kind: s.kind, name: s.name })))
  })
  while (!battle.over && battle.t < tuning.tick.ceiling) resolveTick(battle, rng, ctx)

  assert.equal(timelineHash(ctx.events), whole.hash)
})

// ── §18.11 battle fuzzer ───────────────────────────────────────────────────────────────────────

test('the fuzzer finds no stalls, no negative HP and no double actions', () => {
  // Scaled by FUZZ so CI can run the full 10k while `npm test` stays under a second.
  const N = Number(process.env.FUZZ ?? 400)
  let stalls = 0
  const lengths = []

  for (let s = 0; s < N; s++) {
    const r = run(s, { size: 1 + (s % 5), floor: 1 + (s % 8), lvl: 1 + (s % 6) })
    lengths.push(r.ticks)

    assert.ok(r.ticks <= tuning.tick.ceiling, `seed ${s}: ran past the tick ceiling`)
    if (r.state.reason === 'tick-ceiling') stalls++

    for (const u of r.state.units) {
      assert.ok(u.hp >= 0, `seed ${s}: ${u.defId} has negative HP`)
      assert.ok(u.hp <= u.maxHp, `seed ${s}: ${u.defId} is over max HP`)
      assert.ok(Number.isFinite(u.gauge) && u.gauge >= 0, `seed ${s}: ${u.defId} has a broken gauge`)
    }

    // No unit acts twice on one gauge fill: at most one action per unit per tick.
    const seen = new Set()
    for (const e of r.events) {
      if (e.type !== 'action') continue
      const key = `${e.t}/${e.actor}`
      assert.ok(!seen.has(key), `seed ${s}: unit ${e.actor} acted twice on tick ${e.t}`)
      seen.add(key)
    }

    for (const e of r.events) {
      if (e.damage !== undefined) {
        assert.ok(Number.isInteger(e.damage) && e.damage >= 0, `seed ${s}: damage ${e.damage} is not a whole number`)
      }
    }

    assert.ok(r.state.over, `seed ${s}: battle never ended`)
  }

  lengths.sort((a, b) => a - b)
  assert.ok(stalls / N < 0.02, `${stalls}/${N} battles hit the tick ceiling — that is a mutual-immortality stall`)
  const median = lengths[Math.floor(lengths.length / 2)]
  assert.ok(median > 40 && median < 1200, `median battle was ${median} ticks (${(median / 20).toFixed(1)}s)`)
})

// ── the timeline is the sim's entire output surface (§12) ───────────────────────────────────────

test('every event carries a tick, a type, and integer damage where it claims damage', () => {
  for (const e of run(3).events) {
    assert.equal(typeof e.t, 'number')
    assert.equal(typeof e.type, 'string')
    if (e.type === 'damage') {
      assert.ok(Number.isInteger(e.damage))
      assert.ok(Number.isInteger(e.hp) && e.hp >= 0, 'the renderer reads event.hp; it must never compute it')
      assert.equal(typeof e.isCrit, 'boolean')
    }
  }
})

test('the timeline is plain JSON — a replay is a few hundred bytes (§14)', () => {
  const { events } = run(11)
  assert.deepEqual(JSON.parse(JSON.stringify(events)), events)
})

test('a battle always ends with exactly one battle:end event', () => {
  const ends = run(13).events.filter((e) => e.type === 'battle:end')
  assert.equal(ends.length, 1)
  assert.ok(['party', 'foe', null].includes(ends[0].winner))
})

test('HP in the events matches the final state exactly — no drift between them', () => {
  const r = run(17)
  const last = new Map()
  for (const e of r.events) if (e.hp !== undefined) last.set(e.target, e.hp)
  for (const [uid, hp] of last) {
    assert.equal(r.state.units.find((u) => u.uid === uid).hp, hp)
  }
})

// ── §18.9 the design alarm ─────────────────────────────────────────────────────────────────────

test('resolve.js stays under 250 lines', () => {
  const n = readFileSync('src/sim/combat/resolve.js', 'utf8').split('\n').length
  assert.ok(n <= 250, `resolve.js is ${n} lines — something that should be an op or a hook got hardcoded`)
})

test('statuses change the numbers through the modifier pipeline, not through special cases', () => {
  const { battle } = battleFor(kernel, tuning, 5)
  const rng = kernel.rng.stream('statuses')
  const ctx = createContext(battle, { kernel, tuning, rng })
  const unit = battle.units[0]

  const before = ctx.statsOf(unit).def
  ctx.addStatus(unit, 'core:brittle', 100)
  const brittle = ctx.statsOf(unit).def
  assert.ok(Math.abs(brittle - before * 0.75) < 1e-9, 'Brittle is one modifier row, applied by resolveStats')

  ctx.cleanse(unit, { tag: 'debuff', count: 1 })
  assert.ok(Math.abs(ctx.statsOf(unit).def - before) < 1e-9, 'and removing it just drops the row')
})
