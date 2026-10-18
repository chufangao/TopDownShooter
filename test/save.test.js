// A run saved and resumed: a save is the run's createRun options and its log, and
// playing it back rebuilds the run as it stood, mid-battle too, order by order; a save that no longer plays is set
// aside, never thrown.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRun, apply, legalActions, replay } from '../src/sim/run.js'
import { saveOf, restore, placeOf, SAVE_VERSION } from '../src/sim/save.js'
import { policy } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { tutorialRun } from '../src/sim/run.js'

// A run made with `made`, played by the expert (or `level`) until `stop(run)` holds (or it ends).
function played (made, stop, level = 'expert') {
  const run = createRun(made)
  const rng = createRng(made.seed).stream('autoplay')
  for (let i = 0; i < 20000 && run.state.phase !== 'over' && !stop(run); i++) apply(run, policy(run, rng, level))
  return run
}

// Mid-battle: the second battle's third turn, with orders given in it (a move or an act since the turn began).
const midBattle = (run) => run.state.phase === 'battle' && run.state.stats.fights >= 1 && run.battle.turn >= 3 &&
  ['move', 'act'].includes(run.state.log.at(-1).type)

test('a run saved mid-battle plays back as it stood: the state, the battle board order by order, and what it may do next', () => {
  const made = { seed: 'save-mid' }
  const run = played(made, midBattle)
  assert.equal(run.state.phase, 'battle', 'the expert reached a second battle')
  const text = saveOf(run, made)
  const back = restore(text)
  assert.ok(back.run, back.why)
  assert.deepEqual(back.run.state, run.state)
  assert.deepEqual(back.made, made)
  assert.deepEqual(back.at, placeOf(run))
  const [a, b] = [back.run.battle, run.battle]
  assert.equal(a.turn, b.turn)
  assert.deepEqual(a.units.map((u) => [u.uid, u.id, u.tile, u.hp, u.moved, u.acted, u.statuses, u.cooldowns]),
    b.units.map((u) => [u.uid, u.id, u.tile, u.hp, u.moved, u.acted, u.statuses, u.cooldowns]))
  assert.deepEqual(a.events, b.events)
  assert.deepEqual(legalActions(back.run), legalActions(run))
  // And on from there, the two the same.
  const rng = createRng('on').stream('autoplay')
  for (let i = 0; i < 40 && run.state.phase !== 'over'; i++) {
    const o = policy(run, rng, 'expert')
    apply(run, o)
    apply(back.run, o)
  }
  assert.deepEqual(back.run.state, run.state)
})

test('a save keeps the run\'s createRun options whatever they are (its ascension, a scale), and plays it back with them', () => {
  for (const made of [{ seed: 'save-asc', ascension: 2 }, { seed: 'save-scale', scale: 1.3 }]) {
    const run = played(made, (r) => r.state.phase === 'map' && r.state.stats.fights >= 1)
    const text = saveOf(run, made)
    assert.deepEqual(JSON.parse(text).run, made)
    const back = restore(text)
    assert.ok(back.run, back.why)
    assert.deepEqual(back.made, made)
    assert.deepEqual(back.run.state, run.state)
    assert.equal(back.run.state.ascension, made.ascension)
    assert.equal(back.run.state.scale, made.scale)
    // Played back without them, it is another run, or none: set aside.
    const { ascension, scale, ...bare } = made
    assert.equal(restore(JSON.stringify({ ...JSON.parse(text), run: bare })).error, 'outdated')
  }
  // A saved run from the draft, before a single pick.
  const fresh = createRun({ seed: 'save-draft' })
  assert.deepEqual(restore(saveOf(fresh, { seed: 'save-draft' })).run.state, fresh.state)
})

test('a save is the options, the log and where it stood, as JSON; a finished run and the tutorial have none', () => {
  // save-shape-1: a seed whose run under the expert wins a battle, to a reap ('save-shape' until the draft of one soul,
  // 2026-10-18, falls in its first).
  const made = { seed: 'save-shape-1' }
  const run = played(made, (r) => r.state.phase === 'reap')
  assert.equal(run.state.phase, 'reap')
  const save = JSON.parse(saveOf(run, made))
  assert.deepEqual(Object.keys(save).sort(), ['at', 'log', 'run', 'v'])
  assert.equal(save.v, SAVE_VERSION)
  assert.deepEqual(save.run, made)
  assert.deepEqual(save.log, run.state.log)
  assert.deepEqual(save.at, { floor: 1, room: save.at.room, phase: 'reap', turn: null, essence: run.state.essence, hp: run.state.party[0].hp, actions: run.state.log.length })
  assert.ok(save.at.room >= 1)
  const over = played({ seed: 'save-over' }, () => false, 'basic')
  assert.equal(over.state.phase, 'over')
  assert.equal(saveOf(over, { seed: 'save-over' }), null)
  assert.equal(saveOf(tutorialRun(), { seed: 'tutorial' }), null)
})

test('a save that no longer plays is set aside with its reason, never thrown', () => {
  const made = { seed: 'save-bad' }
  const run = played(made, midBattle)
  const good = JSON.parse(saveOf(run, made))
  const bad = (change) => { const s = structuredClone(good); change(s); return JSON.stringify(s) }
  assert.equal(restore('{ not json').error, 'unreadable')
  assert.equal(restore('null').error, 'unreadable')
  assert.equal(restore(JSON.stringify({ v: SAVE_VERSION })).error, 'unreadable')
  assert.equal(restore(bad((s) => { s.v = SAVE_VERSION + 1 })).error, 'outdated')
  // An older game's log: an action that is no longer legal where it stands (a room that is not there), or one
  // that plays to another place than the save says (a log cut short, a seed's maps no longer the same).
  assert.equal(restore(bad((s) => { s.log.splice(5, 0, { type: 'node', id: '99.9' }) })).error, 'outdated')
  assert.equal(restore(bad((s) => { s.log = s.log.slice(0, -3) })).error, 'outdated')
  assert.equal(restore(bad((s) => { s.run.seed = 'another' })).error, 'outdated')
  assert.equal(restore(bad((s) => { s.at.phase = 'over' })).error, 'over')
  // The good one still plays.
  assert.deepEqual(restore(JSON.stringify(good)).run.state, run.state)
})

test('replay passes every createRun option it is given, and the start a log was played from', () => {
  const run = createRun({ seed: 'rp', scale: 1.5 })
  apply(run, { type: 'pick', index: 0 })
  assert.deepEqual(replay('rp', run.state.log, { scale: 1.5 }).state, run.state)
  assert.deepEqual(replay('rp', run.state.log, { seed: 'ignored', scale: 1.5 }).state, run.state)
})
