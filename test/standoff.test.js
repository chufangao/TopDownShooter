// Standoffs end (README, 2026-10-18): no battle may run on with nothing landing either way. Two boards the sims held to
// the turn guard, rebuilt small and played by End Turn alone. Both stood on Mirage (rules.js mirage, Fae 4) while it
// foiled each foe's first blow each turn: a piece acts once a turn, so every single-target blow a Fae 4 side took
// missed, and a missed blow still fired its relics. Now Mirage foils each foe's first blow a battle, and a miss lays
// nothing (turns.js runEffect).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TUNING } from '../src/tuning.js'
import { synergiesOf } from '../src/sim/turns.js'
import { tileAt } from '../src/sim/unit.js'
import { on, scene, turns } from './scene.js'

const landed = (events) => events.some((e) => e.type === 'damage' && e.damage > 0)
const holds = (b, side, id) => synergiesOf(b, side).some((s) => s.id === id)

// Both sides Fae 4, every piece a single-target shooter, no Channeler 4 (no echo): m1s-223 #22 and sa0-29 #13, floor 2's
// ditch camp, stalled at the queue into the Monarch with every blow either way a miss.
test('two sides holding Mirage, every piece a single-target shooter: damage lands within a few turns', () => {
  const b = scene([
    on('monarch', 0, 'party', 3, 0),
    on('will_o_wisp', 1, 'party', 1, 2), on('will_o_wisp', 2, 'party', 2, 2), on('frost_sprite', 3, 'party', 4, 2), on('will_o_wisp', 4, 'party', 5, 2),
    on('frost_sprite', 11, 'foe', 1, 7), on('thorn_dryad', 12, 'foe', 2, 7), on('thorn_dryad', 13, 'foe', 4, 7), on('frost_sprite', 14, 'foe', 5, 7)
  ])
  assert.deepEqual([holds(b, 'party', 'fae_4'), holds(b, 'foe', 'fae_4'), holds(b, 'party', 'channeler_4')], [true, true, false])
  assert.ok(landed(turns(b, TUNING.policy.press.turns + 4)))
})

// A lone Snare holder whose every blow the camp's Mirage foiled: the blow's Snare still Rooted the hag on the wall's one
// gap, the head of the camp's single file, every turn, so the camp never came on (m1s-145 #29, the solver's line of 300
// rounds with nothing landing).
test('a lone Snare holder whose blows Mirage foils cannot hold the camp at the gap: within a few turns of full pressure damage lands', () => {
  const b = scene([
    on('monarch', 0, 'party', 0, 3),
    on('bone_chanter', 1, 'party', 2, 0, 3, [0, 0], ['snare']),
    on('marsh_hag', 11, 'foe', 6, 4), on('marsh_hag', 12, 'foe', 6, 5), on('marsh_hag', 13, 'foe', 6, 6), on('marsh_hag', 14, 'foe', 6, 7)
  ], { walls: [0, 1, 2, 3, 4, 5].map((x) => tileAt(x, 4)) })
  assert.ok(holds(b, 'foe', 'fae_4'))
  assert.ok(landed(turns(b, TUNING.policy.press.turns + 6)))
})
