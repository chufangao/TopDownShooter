// Save, load, migrations and the repair pass (§14) — invariant §18.10.
//
// Two things are being defended here, and the second is the one that decides whether anyone ever
// installs a mod:
//
//   1. a save round-trips to deep equality, and every committed fixture walks the whole migration
//      chain to the current version and validates;
//   2. **removing a pack must never brick a save.** It produces a report and a repaired state.
//
// The fixtures under `test/fixtures/saves/` are frozen on the day their version shipped. They are
// not regenerated — the point of a fixture is that it is what an old build actually wrote.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks, readPackFromDisk } from '../../tools/packsource.node.js'
import {
  SAVE_VERSION, MIGRATIONS, newProfile, saveGame, loadGame, bankRun,
  serialize, deserialize, collectionOf
} from '../../src/sim/save.js'
import { migrate } from '../../src/sim/migrations.js'
import { createRun, playRun, STARTING_PARTY } from '../../src/sim/run.js'
import { endRun } from '../../src/sim/economy.js'

const corePacks = () => discoverPacks('packs')
const { kernel, tuning } = await createGame({ packs: corePacks(), seed: 1 })
const newRun = (seed = 1) => (kernel.defs.restore({ uid: 1 }), createRun({ kernel, tuning, seed }))

const FIXTURES = 'test/fixtures/saves'

// ── round-trip ──────────────────────────────────────────────────────────────────────────────────

test('★ a save round-trips to deep equality (§18.10)', () => {
  const run = newRun(7)
  run.enterFloor()
  run.arriveAt(run.nodes()[0])

  const save = saveGame({ kernel, profile: newProfile(), run, mods: [{ id: 'core', version: '1.0.0' }] })
  const back = deserialize(serialize(save))
  assert.deepEqual(back, save)
  // The claim underneath: instances hold defId strings and the registry is frozen, so state is
  // plain JSON with no serialiser to maintain and no cycles to break (§11.1, §11.2).
  assert.deepEqual(back.state.run.roster, run.state.roster)
})

test('a save carries ids and numbers only — no references, and no undefined', () => {
  const run = newRun(2)
  playRun(run, { maxFloors: 1 })
  const save = saveGame({ kernel, profile: newProfile(), run })

  const walk = (v, path = 'save') => {
    assert.ok(typeof v !== 'function', `${path} is a function`)
    // An undefined value is a present key in memory and an absent one after JSON.stringify, so it
    // breaks round-trip equality silently. A recruit carried `recruitedBy: undefined` and this is
    // the assertion that found it.
    assert.notEqual(v, undefined, `${path} is undefined — it will vanish through JSON`)
    if (v === null || typeof v !== 'object') return
    for (const [k, child] of Object.entries(v)) walk(child, `${path}.${k}`)
  }
  walk(save)
  assert.ok(!('floor' in save.state.run) && !('route' in save.state.run), 'derived state must not persist')
})

test('a reloaded run resumes where it was, and plays on identically', () => {
  const a = newRun(11)
  playRun(a, { maxFloors: 1 })
  const save = deserialize(serialize(saveGame({ kernel, profile: newProfile(), run: a })))

  const { run: state, report } = loadGame(save, { kernel, tuning })
  assert.deepEqual(report.dropped, [])
  const b = createRun({ kernel, tuning, state })
  assert.deepEqual(b.state, a.state)
})

test('the uid counter is save state — instances must never be renumbered', () => {
  const run = newRun(3)
  run.enterFloor()
  run.arriveAt(run.nodes()[0])
  const save = saveGame({ kernel, profile: newProfile(), run })
  assert.ok(save.uid > 1)

  kernel.defs.restore({ uid: 1 })
  loadGame(save, { kernel, tuning })
  assert.equal(kernel.defs.peekUid(), save.uid, 'a reload that renumbers uids desyncs every replay')
})

// ── the migration chain ─────────────────────────────────────────────────────────────────────────

test('★ every committed fixture walks the chain to the current version (§18.10)', () => {
  const names = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort()
  assert.ok(names.length, 'the chain needs something true to be tested against')

  for (const name of names) {
    const save = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
    const expected = MIGRATIONS.filter((m) => m.to > save.v).map((m) => m.to)
    const { state, applied } = migrate(save)
    assert.deepEqual(applied, expected, `${name}: wrong migrations ran`)

    // The result must be loadable, not merely transformed — the chain is exercised end to end.
    const { profile, run, report } = loadGame(save, { kernel, tuning })
    assert.ok(Array.isArray(profile.collection) && profile.collection.length, `${name}: unusable collection`)
    assert.ok(Number.isInteger(profile.residue) && profile.residue >= 0, `${name}: bad residue`)
    assert.equal(typeof profile.doctrine.v, 'number', `${name}: doctrine not normalised`)
    if (run) assert.ok(Array.isArray(run.roster), `${name}: unusable run`)
    assert.ok(state, `${name}: migration produced nothing`)
    assert.ok(!report.notes.some((n) => /corrupt/i.test(n)), `${name}: ${report.notes.join('; ')}`)
  }
})

test('migrations are ordered, unique, and never above the current version', () => {
  let last = 0
  for (const m of MIGRATIONS) {
    assert.ok(Number.isInteger(m.to) && m.to > last, `migration ${m.to} is out of order`)
    assert.equal(typeof m.up, 'function')
    last = m.to
  }
  assert.ok(last <= SAVE_VERSION, 'SAVE_VERSION must be bumped alongside the last migration')
})

test('a save from a newer build is refused rather than silently truncated', () => {
  assert.throws(() => migrate({ v: SAVE_VERSION + 1, state: {} }), /understands up to/)
})

test('no save at all is a supported configuration', () => {
  const { profile, run, report } = loadGame(null, { kernel, tuning })
  assert.equal(run, null)
  assert.deepEqual(profile.collection, [...STARTING_PARTY].sort())
  assert.match(report.notes.join(' '), /starting fresh/)
})

test('a corrupt save string parses to null rather than throwing at the host', () => {
  assert.equal(deserialize('{not json'), null)
})

// ── the repair pass ─────────────────────────────────────────────────────────────────────────────

test('★ removing a pack loads the save with a readable report, never a crash (M4 gate)', async () => {
  // Build a save against core + the kindled fixture, then load it against core alone.
  const withMod = await createGame({ packs: [...corePacks(), readPackFromDisk('test/fixtures/kindled')], seed: 1 })
  const run = createRun({ kernel: withMod.kernel, tuning: withMod.tuning, seed: 5 })
  run.state.roster.push(withMod.kernel.defs.instantiate('unit', 'kindled:ash_seer', { lvl: 3, side: 'party' }))
  const profile = newProfile()
  profile.collection = [...profile.collection, 'kindled:ash_seer'].sort()
  const save = deserialize(serialize(saveGame({ kernel: withMod.kernel, profile, run })))

  const { profile: repaired, run: resumed, report } = loadGame(save, { kernel, tuning })
  assert.equal(report.contentChanged, true)
  assert.ok(report.notes.some((n) => /content changed/.test(n)), report.notes.join('; '))
  assert.ok(report.dropped.some((d) => d.id === 'kindled:ash_seer' && d.policy === 'drop'),
    JSON.stringify(report.dropped))
  assert.ok(!repaired.collection.includes('kindled:ash_seer'))
  assert.ok(!resumed.roster.some((u) => u.defId === 'kindled:ash_seer'))
  assert.ok(resumed.roster.length, 'the rest of the party survived the repair')
})

test('an orphan is resolved through its kind\'s declared policy, not a rule in save.js', () => {
  // `boot.js` registers the unit kind with orphanPolicy 'drop'. A pack registering a whole new kind
  // gets a repair story for free by declaring one word there.
  assert.equal(kernel.defs.orphanPolicy('unit', 'core:tomb_knight'), null, 'a live def is not an orphan')
  assert.equal(kernel.defs.orphanPolicy('unit', 'ghost:nobody'), 'drop')
})

test('a party of nothing but missing content ends the run instead of resuming empty', () => {
  const save = {
    v: SAVE_VERSION,
    contentHash: 'stale',
    state: {
      profile: newProfile(),
      run: { seed: 1, floorNum: 2, deepest: 2, over: false, reason: null, coin: 0, discovered: [], roster: [{ uid: 1, defId: 'ghost:nobody', hp: 5, maxHp: 5, lvl: 1, statuses: [], branch: [] }] }
    }
  }
  const { run, report } = loadGame(save, { kernel, tuning })
  assert.equal(run.over, true)
  assert.equal(run.reason, 'content-changed')
  assert.match(report.notes.join(' '), /ended rather than resumed/)
})

test('a collection wiped out by a missing pack falls back to what this build ships', () => {
  const profile = newProfile()
  profile.collection = ['ghost:a', 'ghost:b']
  const save = { v: SAVE_VERSION, contentHash: 'stale', state: { profile, run: null } }
  const { profile: repaired, report } = loadGame(save, { kernel, tuning })
  assert.deepEqual(repaired.collection, STARTING_PARTY.filter((id) => kernel.registry.has('unit', id)))
  assert.match(report.notes.join(' '), /reset to whatever this build ships/)
})

test('a status from a removed pack is dropped without touching the unit carrying it', () => {
  const save = {
    v: SAVE_VERSION,
    state: {
      profile: newProfile(),
      run: {
        seed: 1, floorNum: 1, deepest: 1, over: false, reason: null, coin: 0, discovered: [],
        roster: [{
          uid: 1, defId: 'core:tomb_knight', hp: 40, maxHp: 60, lvl: 3, branch: [],
          statuses: [{ id: 'core:brittle', dur: 10 }, { id: 'ghost:cursed', dur: 10 }]
        }]
      }
    }
  }
  const { run } = loadGame(save, { kernel, tuning })
  assert.equal(run.roster.length, 1)
  assert.deepEqual(run.roster[0].statuses.map((s) => s.id), ['core:brittle'])
  assert.equal(run.roster[0].hp, 40, 'repairing a status must not touch the unit')
})

// ── banking ─────────────────────────────────────────────────────────────────────────────────────

test('★ Residue is conserved: what the run paid is what the profile gained (§10, M4)', () => {
  const run = newRun(6)
  playRun(run, { maxFloors: 3 })
  const banked = endRun(run)
  const profile = newProfile()
  const before = profile.residue

  const { gainedResidue } = bankRun(profile, banked, tuning)
  assert.equal(gainedResidue, banked.residue)
  assert.equal(profile.residue, before + banked.residue)
  assert.equal(profile.lifetimeResidue, banked.residue)
})

test('banking the same discoveries twice pays once', () => {
  const profile = newProfile()
  const banked = { residue: 10, codex: ['recruit:core:frost_sprite', 'boss:core:hollow_sovereign'], coin: 0, floors: 1, coherence: 0, reason: 'wipe' }
  assert.equal(bankRun(profile, banked, tuning).gainedCodex.length, 2)
  assert.equal(bankRun(profile, banked, tuning).gainedCodex.length, 0)
  assert.deepEqual(profile.codex, ['boss:core:hollow_sovereign', 'recruit:core:frost_sprite'])
})

test('★ units are collected permanently; levels are not (§19 open question 6)', () => {
  // The Codex unlocks who can appear; the run decides who gets strong. A roster that levelled
  // forever across runs would make the roguelite frame of §1 decorative — nothing is at stake in a
  // wipe if the party walks away with its levels.
  const profile = newProfile()
  bankRun(profile, { residue: 0, codex: [], coin: 0, floors: 1, coherence: 0, reason: 'wipe' }, tuning,
    { collected: ['core:ember_drake'] })
  assert.ok(profile.collection.includes('core:ember_drake'))

  const next = createRun({ kernel, tuning, seed: 9, starters: collectionOf(profile), lvl: 1 })
  assert.ok(next.state.roster.some((u) => u.defId === 'core:ember_drake'))
  for (const u of next.state.roster) assert.equal(u.lvl, 1, 'a new run starts from level 1')
})

test('Insight follows lifetime Residue and never the other way round', () => {
  const profile = newProfile()
  const big = { residue: tuning.insight.divisor, codex: [], coin: 0, floors: 8, coherence: 1, reason: 'boss' }
  bankRun(profile, big, tuning)
  assert.equal(profile.insight, 1)
  profile.residue = 0                              // spent on the Lattice
  bankRun(profile, { ...big, residue: 0 }, tuning)
  assert.equal(profile.insight, 1, 'spending Residue must not spend Insight')
})
