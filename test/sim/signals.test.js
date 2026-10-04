// The signal ledger (§4.3) — counters, scopes, and the one rule that makes it safe to exist.
//
// The rule under test everywhere below: a signal is written by the run and read by a Precedent, and
// never the other way round. `writeOnly` is the enforcement; the rest is bookkeeping that three
// planned systems (fire counts, the post-mortem, the Codex) will each grow into.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks } from '../../tools/packsource.node.js'
import { createLedger, recordBattle, writeOnly, NULL_LEDGER } from '../../src/sim/signals.js'
import { createRun, playRun } from '../../src/sim/run.js'

const { kernel, tuning } = await createGame({ packs: discoverPacks('packs'), seed: 1 })

test('a signal counts at all three scopes at once', () => {
  const L = createLedger()
  L.emit('recruit:missed', { name: 'Frost Sprite' })
  L.emit('recruit:missed', { name: 'Bone Chanter' })

  assert.equal(L.count('recruit:missed', 'battle'), 2)
  assert.equal(L.count('recruit:missed', 'run'), 2)
  assert.equal(L.count('recruit:missed', 'profile'), 2)
  assert.equal(L.count('never:happened'), 0, 'an unknown name is zero, never undefined')
})

test('the scopes clear independently — profile is the one that survives', () => {
  const L = createLedger()
  L.emit('battle:won')
  L.beginBattle()
  assert.equal(L.count('battle:won', 'battle'), 0)
  assert.equal(L.count('battle:won', 'run'), 1)

  L.emit('battle:won')
  L.beginRun()
  assert.equal(L.count('battle:won', 'run'), 0, 'a new run starts the run scope over')
  assert.equal(L.count('battle:won', 'profile'), 2, 'lifetime counters outlive a wipe (§4.3)')
})

test('the ring keeps the last few payloads and nothing more', () => {
  const L = createLedger()
  for (let i = 0; i < 20; i++) L.emit('recruit:missed', { n: i })

  assert.equal(L.count('recruit:missed'), 20, 'counting is unbounded')
  assert.equal(L.last('recruit:missed').n, 19, 'the last one was a Frost Sprite (§4.3)')
  assert.ok(L.recent('recruit:missed').length <= 6, 'a long fight must not allocate megabytes of history')
})

test('answered Precedents are save state; raised ones are not', () => {
  const L = createLedger()
  L.markRaised('core:first_parley')
  L.markAnswered('core:first_parley', 'profile')
  assert.equal(L.wasRaised('core:first_parley'), true)
  assert.equal(L.wasAnswered('core:first_parley', 'profile'), true)

  const restored = createLedger(L.save())
  assert.equal(restored.wasAnswered('core:first_parley', 'profile'), true, 'a position taken outlives the session')
  assert.equal(restored.wasRaised('core:first_parley'), false, 'the queue itself expires with the run')
})

test('a run-scoped answer does not spend a profile-scoped Precedent', () => {
  const L = createLedger()
  L.markAnswered('core:learn_focus', 'run')
  assert.equal(L.wasAnswered('core:learn_focus', 'run'), true)
  assert.equal(L.wasAnswered('core:learn_focus', 'profile'), false)
  L.beginRun()
  assert.equal(L.wasAnswered('core:learn_focus', 'run'), false, 'declining "not now" means not now')
})

test('save() is sorted, so two saves of the same state are the same string', () => {
  const a = createLedger()
  const b = createLedger()
  for (const n of ['z:one', 'a:two', 'm:three']) a.emit(n)
  for (const n of ['m:three', 'z:one', 'a:two']) b.emit(n)
  assert.equal(JSON.stringify(a.save()), JSON.stringify(b.save()))
})

test('★ the battle face of the ledger can write and cannot read (§18.16)', () => {
  const L = createLedger()
  const inBattle = writeOnly(L)

  inBattle.emit('kindled:ignite:cast', { defId: 'kindled:emberdirge' })
  assert.equal(L.count('kindled:ignite:cast'), 1, 'content may raise its own signal from inside a fight')

  // The whole invariant, as a shape rather than as a convention: there is nothing to call.
  assert.equal(typeof inBattle.count, 'undefined')
  assert.equal(typeof inBattle.last, 'undefined')
  assert.equal(typeof inBattle.snapshot, 'undefined')
  assert.deepEqual(Object.keys(inBattle), ['emit'])
})

test('the null ledger swallows everything, so "no ledger" is not a second code path', () => {
  assert.doesNotThrow(() => NULL_LEDGER.emit('anything', { at: 'all' }))
  assert.equal(NULL_LEDGER.count('anything'), 0)
  assert.equal(NULL_LEDGER.wasAnswered('x'), false)
})

test('a real run notices what happened without being told to', () => {
  kernel.defs.restore({ uid: 1 })
  const ledger = createLedger()
  const run = createRun({ kernel, tuning, seed: 3, signals: ledger })
  playRun(run, { maxFloors: 3 })

  const seen = ledger.snapshot().run
  assert.ok(seen['battle:won'] > 0, 'a run that fought must have noticed winning one')
  assert.ok(seen['recruit:missed'] > 0,
    'foes go under the persuade threshold and die every run — that this was invisible is the reason §4.3 exists')
  assert.equal(seen['run:end'], 1, 'a run ends exactly once, however it ends')

  const missed = ledger.last('recruit:missed')
  assert.ok(missed.hpPct > 0 && missed.hpPct <= tuning.persuade.threshold,
    'the recorded fraction is where it was before the killing blow, not the zero every corpse shares')
  assert.equal(typeof missed.name, 'string', 'a card names a Frost Sprite, not core:frost_sprite')
})

test('recordBattle reads a finished fight and needs nothing from the resolver', () => {
  kernel.defs.restore({ uid: 1 })
  const ledger = createLedger()
  const run = createRun({ kernel, tuning, seed: 11, signals: ledger })
  run.enterFloor()
  const node = run.nodes().find((n) => n.type === 'encounter')
  const report = run.arriveAt(node)

  const replay = createLedger()
  recordBattle(replay, {
    registry: kernel.registry,
    tuning,
    result: report.battle.result,
    report,
    floor: 1
  })
  // Same finished battle, same signals — which is what lets M5's counterfactual re-sim a fight
  // without the resolver knowing the ledger exists.
  assert.deepEqual(replay.save().counts, subtractRunEnd(ledger.save().counts))
})

const subtractRunEnd = (counts) => Object.fromEntries(Object.entries(counts).filter(([k]) => k !== 'run:end'))

test('the last payload survives a session, because a lifetime-gated card still has to name it', () => {
  const L = createLedger()
  L.emit('ally:down_front', { name: 'Ember Drake', role: 'Ranger' })
  L.emit('ally:down_front', { name: 'Frost Sprite', role: 'Skirmisher' })

  const restored = createLedger(L.save())
  assert.equal(restored.last('ally:down_front').name, 'Frost Sprite')
  assert.equal(restored.count('ally:down_front', 'profile'), 2)
  assert.equal(restored.count('ally:down_front', 'run'), 0, 'only the counter is lifetime, not the run')

  restored.beginRun()
  assert.equal(restored.last('ally:down_front').name, 'Frost Sprite',
    'a card that fires on a fresh session must not read "the last was —"')
  assert.equal(restored.recent('ally:down_front').length, 1, 'and it keeps exactly one, not the whole history')
})
