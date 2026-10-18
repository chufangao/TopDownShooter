// The runs kept in this browser and the daily (redesign.md §4.8, the meta; src/sim/history.js): a run's line as it
// ended, the book of them newest first with its totals, read as far as it holds whatever was kept, and the day's seed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRun, apply } from '../src/sim/run.js'
import { saveOf, restore } from '../src/sim/save.js'
import { recordOf, armyOf, readBook, withRun, totalOf, isEntry, dailySeed, dayOf, HISTORY_CAP } from '../src/sim/history.js'
import { policy } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { unitDef } from '../src/content.js'

function played (made, stop = () => false, level = 'basic') {
  const run = createRun(made)
  const rng = createRng(made.seed).stream('autoplay')
  for (let i = 0; i < 20000 && run.state.phase !== 'over' && !stop(run); i++) apply(run, policy(run, rng, level))
  return run
}

test('the daily is the UTC day\'s seed, the same wherever it is played', () => {
  assert.equal(dayOf(new Date('2026-10-15T12:00:00Z')), '2026-10-15')
  // Late on the 15th in New York is the 16th in UTC; early on the 16th in Tokyo is the 15th.
  assert.equal(dailySeed(new Date('2026-10-15T23:30:00-05:00')), 'daily-2026-10-16')
  assert.equal(dailySeed(new Date('2026-10-16T08:00:00+09:00')), 'daily-2026-10-15')
  const a = createRun({ seed: dailySeed(new Date('2026-10-15T01:00:00Z')) })
  const b = createRun({ seed: dailySeed(new Date('2026-10-15T23:00:00Z')) })
  assert.deepEqual(a.state, b.state)
})

test('a run\'s line: how it ended and where, its battles, its army and its killer', () => {
  const fell = played({ seed: 'hist-fell' })
  assert.equal(fell.state.phase, 'over')
  const e = recordOf(fell, { id: 'x@1', at: 1000, time: 61234.4, daily: '2026-10-15', practice: true })
  assert.ok(isEntry(e))
  assert.equal(e.end, 'fell')
  assert.equal(e.cleared, false)
  assert.deepEqual([e.id, e.at, e.seed, e.ascension, e.time, e.daily, e.practice], ['x@1', 1000, 'hist-fell', 0, 61234, '2026-10-15', true])
  assert.deepEqual([e.floor, e.wins, e.fights], [fell.state.floor, fell.state.stats.wins, fell.state.stats.fights])
  assert.equal(e.fell.by, fell.state.death.by)
  assert.equal(e.fell.threat, fell.state.death.threat ?? null)
  assert.ok(e.room >= 1)
  assert.equal(e.monarch, undefined)
  // Under way, it is a run left; cleared, a clear; fallen after a clear (in the deep), both. (hist-going-18: a seed whose
  // run under basic wins a battle, to a reap; 'hist-going' until the draft of one soul, 2026-10-18, falls in its first.)
  const going = played({ seed: 'hist-going-18' }, (r) => r.state.phase === 'reap')
  assert.equal(going.state.phase, 'reap')
  assert.equal(recordOf(going).end, 'left')
  assert.equal(recordOf(going).fell, undefined)
  const won = structuredClone(fell)
  Object.assign(won.state, { result: 'victory', death: null })
  assert.deepEqual([recordOf(won).end, recordOf(won).cleared], ['cleared', true])
  won.state.death = fell.state.death
  assert.deepEqual([recordOf(won).end, recordOf(won).cleared], ['fell', true])
  // Not the daily: no mark.
  assert.equal('daily' in recordOf(fell), false)
  assert.equal('practice' in recordOf(fell, { practice: true }), false)
})

test('the army a line keeps: the kinds most held, every fused kind, the kin most held', () => {
  const run = createRun({ seed: 'hist-army', start: ['will_o_wisp', 'pale_court', 'will_o_wisp', 'bone_chanter', 'tomb_knight', 'bone_colossus', 'grave_ghoul'] })
  const army = armyOf(run.state)
  assert.deepEqual(army.kinds[0], { id: 'will_o_wisp', n: 2 })
  assert.equal(army.kinds.length, 3)
  // Among the kinds held once, the higher tier first.
  assert.ok(unitDef(army.kinds[1].id).tier >= unitDef(army.kinds[2].id).tier)
  assert.deepEqual(new Set(army.fused), new Set(['pale_court', 'bone_colossus']))
  assert.equal(army.kin, 'undead')
  assert.deepEqual(armyOf(createRun({ seed: 'none' }).state), { kinds: [], fused: [], kin: null })
})

const line = (n, extra = {}) => ({
  id: `s${n}@${n}`, at: n, seed: `s${n}`, ascension: 0, end: 'fell', cleared: false, floor: 1, room: 3, wins: 2, fights: 3,
  army: { kinds: [], fused: [], kin: null }, time: 1000, ...extra
})

test('the book: newest first, its oldest past the cap let go, its totals of every run kept', () => {
  let book = readBook(null)
  assert.deepEqual(book.total, { runs: 0, clears: 0, best: -1, time: 0 })
  for (let n = 1; n <= HISTORY_CAP + 5; n++) book = withRun(book, line(n, n % 10 === 0 ? { cleared: true, end: 'cleared', ascension: n % 3 } : {}))
  assert.equal(book.runs.length, HISTORY_CAP)
  assert.equal(book.runs[0].id, `s${HISTORY_CAP + 5}@${HISTORY_CAP + 5}`)
  assert.equal(book.runs.at(-1).id, 's6@6')
  assert.deepEqual(book.total, { runs: HISTORY_CAP + 5, clears: 10, best: 2, time: (HISTORY_CAP + 5) * 1000 })
  // A run kept again (a clear that went on into the deep and fell) is one line, brought up to date and to the top.
  const again = withRun(book, line(50, { cleared: true, end: 'fell', floor: 5, time: 4000, ascension: 7 }))
  assert.equal(again.runs.length, HISTORY_CAP)
  assert.equal(again.runs[0].id, 's50@50')
  assert.equal(again.runs.filter((e) => e.id === 's50@50').length, 1)
  assert.deepEqual(again.total, { runs: HISTORY_CAP + 5, clears: 10, best: 7, time: (HISTORY_CAP + 5) * 1000 + 3000 })
  // Kept and read back, the same.
  assert.deepEqual(readBook(JSON.stringify(again)), again)
})

test('a book that does not read is read as far as it holds, never thrown', () => {
  const empty = { v: 1, total: { runs: 0, clears: 0, best: -1, time: 0 }, runs: [] }
  for (const text of [null, undefined, '', '{ not json', 'null', '42', '[]', '"x"', '{"runs": "x"}', '{"runs": [null, 1, "a", {}]}']) {
    assert.deepEqual(readBook(text), empty, String(text))
  }
  // Its readable lines kept, the others dropped; totals that do not read counted again from what is kept.
  const good = [line(3, { cleared: true, end: 'cleared', ascension: 2 }), line(2)]
  const bad = [{ ...line(9), end: 'won' }, { ...line(8), army: null }, { ...line(7), time: -1 }, { ...line(6), seed: 6 }]
  const read = readBook(JSON.stringify({ v: 1, total: { runs: 'many' }, runs: [bad[0], good[0], bad[1], good[1], bad[2], bad[3]] }))
  assert.deepEqual(read.runs, good)
  assert.deepEqual(read.total, totalOf(good))
  assert.deepEqual(read.total, { runs: 2, clears: 1, best: 2, time: 2000 })
  // Totals that count fewer runs or clears than the lines kept are counted again; more are kept (lines let go).
  assert.deepEqual(readBook(JSON.stringify({ total: { runs: 1, clears: 0, best: -1, time: 0 }, runs: good })).total, totalOf(good))
  assert.deepEqual(readBook(JSON.stringify({ total: { runs: 2, clears: 0, best: -1, time: 0 }, runs: good })).total, totalOf(good))
  const more = { runs: 250, clears: 40, best: 5, time: 9e6 }
  assert.deepEqual(readBook(JSON.stringify({ total: more, runs: good })).total, more)
  // More lines than the cap: the newest kept.
  const many = Array.from({ length: HISTORY_CAP + 20 }, (_, i) => line(i))
  assert.equal(readBook(JSON.stringify({ runs: many })).runs.length, HISTORY_CAP)
})

test('a save carries what the interface keeps with its run, handed back as given', () => {
  const made = { seed: 'hist-meta' }
  const run = played(made, (r) => r.state.phase === 'reap', 'expert')
  const meta = { begun: 1760000000000, time: 123456, daily: '2026-10-15', practice: true }
  const back = restore(saveOf(run, made, meta))
  assert.deepEqual(back.meta, meta)
  assert.deepEqual(back.run.state, run.state)
  assert.equal(restore(saveOf(run, made)).meta, null)
  // A line of the run read back: the same as of the run itself.
  assert.deepEqual(recordOf(back.run, { id: 'a', at: 1, time: meta.time }), recordOf(run, { id: 'a', at: 1, time: meta.time }))
})
