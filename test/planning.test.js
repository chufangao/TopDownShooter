// The expert plans with every mechanic (Job: the measuring instrument): lines in every shape on every signal, a
// Banner's wing on purpose, every seat for the Monarch, and stacks against splits weighed by rehearsal; and the
// audit that says what it considered against what it chose. Functional only: what is generated and considered,
// never how often it is chosen or how it fares.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRun, apply, availableNodes, souls, cleanLine, fielded, join, MONARCH_UID } from '../src/sim/run.js'
import { createBattle } from '../src/sim/battle.js'
import { battleSetup } from '../src/sim/run.js'
import {
  SHAPES, whensFor, lineContext, shapedLine, turns, redraw, wing, planFor, LEVELS, AUDIT, resetAudit, featuresOf, auditRecord
} from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { SIGNALS } from '../src/content.js'
import { slotAt, isSeat, CAMP_SLOTS, deployTile, distance, seatNear } from '../src/sim/unit.js'

// A run standing in a fight's prep whose room has a second wave and a far-reaching foe on lane 6.
function prep (seed) {
  const run = createRun({ seed })
  const node = availableNodes(run)[0]
  node.type = 'fight'
  node.foes = [{ id: 'grave_ghoul', lvl: 1, slot: slotAt(0, 3) }, { id: 'will_o_wisp', lvl: 1, slot: slotAt(1, 6) }]
  node.waves = [{ foes: [{ id: 'grave_ghoul', lvl: 1, slot: slotAt(0, 2) }], when: { at: 'break', t: 600 } }]
  apply(run, { type: 'node', id: node.id })
  return run
}

test('the line shapes: every shape on every signal the room can give, each a legal line, some turning off the lane', () => {
  const run = prep('shapes')
  const s = run.state
  const party = s.party.map((u) => ({ ...u }))
  const ctx = lineContext(s, party)
  assert.deepEqual(ctx.whens.map((w) => w.at), ['once', 'time', 'time', 'blow', 'wave', 'struck', 'falls'])
  assert.deepEqual(whensFor({ waves: [{}, {}] }).filter((w) => w.at === 'wave'), [{ at: 'wave', wave: 1 }, { at: 'wave', wave: 2 }])
  const seen = new Set()
  let turning = 0
  for (const u of fielded(souls(s.party))) {
    for (const shape of SHAPES) {
      for (const when of ctx.whens) {
        const line = shapedLine(ctx, u.slot, shape, when)
        if (!line) continue
        assert.deepEqual(cleanLine(s, u.uid, line.tiles, line.when), line, `${u.id} ${shape} ${JSON.stringify(when)}`)
        seen.add(`${shape}:${when.at}`)
        turning += turns(line, u.slot)
      }
    }
  }
  for (const shape of SHAPES) for (const at of Object.keys(SIGNALS)) assert.ok(seen.has(`${shape}:${at}`), `${shape} on ${at}`)
  assert.ok(turning > 0, 'some line turns')
  // A climb's redraw reaches them all too, every line legal.
  const rng = createRng('shapes').stream('climb')
  const drawn = new Set()
  let turned = 0
  for (let k = 0; k < 400; k++) {
    redraw(party, s, rng)
    for (const u of party.filter((x) => x.line)) {
      assert.deepEqual(cleanLine(s, u.uid, u.line.tiles, u.line.when), u.line)
      drawn.add(u.line.when.at)
      turned += turns(u.line, u.slot)
    }
  }
  assert.deepEqual([...drawn].sort(), Object.keys(SIGNALS).sort())
  assert.ok(turned > 0)
})

test('the expert can plan a Banner\'s wing: the Banner keeps its cell and takes a line, its mates beside it follow in battle', () => {
  const run = prep('wing')
  const s = run.state
  // The Knights' kind at Bulwark IV (Banner); a Ghoul and a second Knight to stand beside it.
  join(run, 'grave_ghoul')
  s.monarch.command = 2
  s.kinds.tomb_knight.tracks = [4, 0]
  for (const u of souls(s.party)) if (u.id === 'tomb_knight') u.tracks = [4, 0]
  for (const u of souls(s.party)) if (u.slot < 0) u.slot = [...Array(CAMP_SLOTS).keys()].find((x) => x < 21 && !s.party.some((p) => p.slot === x))
  const base = s.party.filter((u) => u.slot >= 0).map((u) => ({ ...u, line: null }))
  const out = wing(base, lineContext(s, base))
  const banner = out.find((u) => u.id === 'tomb_knight')
  assert.ok(banner.line, 'the Banner takes a line')
  const beside = out.filter((u) => u.uid !== MONARCH_UID && u !== banner && distance(deployTile('party', u.slot), deployTile('party', banner.slot)) === 1)
  assert.ok(beside.length >= 1)
  assert.ok(featuresOf(s, out).includes('Banner wing'))
  // Fought: its mates beside it are its wing.
  const b = createBattle(battleSetup(run, { party: out.map((u) => ({ ...s.party.find((x) => x.uid === u.uid), slot: u.slot })), lines: Object.fromEntries(out.filter((u) => u.line).map((u) => [u.uid, u.line])) }))
  assert.ok(beside.every((u) => b.byUid.get(u.uid).leader === banner.uid))
  // The expert's plan considers it among its formations.
  resetAudit(true)
  try {
    planFor(run, LEVELS.expert)
    assert.ok(AUDIT.considered['Banner wing'] > 0, JSON.stringify(AUDIT.considered))
  } finally {
    resetAudit(false)
  }
})

test('the expert considers every seat for the Monarch, and lines on the room\'s signals and turning lines, in one plan', () => {
  const run = prep('seats')
  const s = run.state
  resetAudit(true)
  try {
    planFor(run, LEVELS.expert)
    const seats = [...Array(CAMP_SLOTS).keys()].filter((x) => isSeat(s.camp, x))
    assert.ok(AUDIT.considered['seat off the rear middle'] >= seats.length - 1, `${AUDIT.considered['seat off the rear middle']} of ${seats.length}`)
    assert.ok(seats.includes(seatNear(s.camp)))
    // (Fallen comes with the guard's melee pieces, and here only the Knight is one: it guards on Struck.)
    for (const at of ['once', 'blow', 'wave', 'struck']) assert.ok(AUDIT.considered[`line:${at}`] > 0, `${at}: ${JSON.stringify(AUDIT.considered)}`)
    assert.ok(AUDIT.considered['turning line'] > 0)
    assert.ok(AUDIT.candidates > 0)
  } finally {
    resetAudit(false)
  }
})

test('the audit counts what a run considered and chose, and leaves the audit off after', () => {
  const r = auditRecord({ seed: 'audit-basic', level: 'basic' })
  assert.ok(r.battles.n > 0 && r.plans === r.battles.n, JSON.stringify([r.plans, r.battles.n]))
  assert.ok(r.candidates >= r.plans)
  assert.ok(Object.values(r.chosen).every((n) => n <= r.plans))
  assert.equal(AUDIT.on, false)
})
