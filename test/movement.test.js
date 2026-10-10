import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stepBattle, field, fieldOf, airOf, sight, stopLine, ringTarget, arrowOf } from '../src/sim/battle.js'
import {
  makeUnit, tileAt, tileX, tileY, DEPTH, ROWS, TILES, distance, holdOf, ringOf, sizeOf, fits, footprintSlots,
  distanceBetween, deployTile, monarchSlot, wallTiles, unitDistance, armOf
} from '../src/sim/unit.js'
import { CAMP_LIST } from '../src/content.js'
import { frontier, START_PARTY } from '../src/sim/run.js'
import { on, scene, moves, actions, slay } from './scene.js'

// How a foe comes at you (DESIGN §2.3–§2.4): it walks its road (a flyer the air road, over the walls), doing nothing
// else, until it halts where it can hit back: in a ring of yours that can strike it (a flyer only a ranged ring; the
// Monarch's ring of 1 holds anything) once one of its blows has a target there, a Flank kind once its blows reach the
// Monarch, or with its next tile held (a flyer's by a piece of yours, ground or air, or a flyer; by a comrade, only one
// halted itself); halted, it fights, its melee reaching only the piece in its way, the Monarch, and a piece beside it
// that struck it. Your melee reaches 1, or 2 for a long arm.

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

// Steps until `done()` or the battle ends (or tick `max`).
function until (b, done, max = 600) {
  while (!b.over && b.t < max && !done()) stepBattle(b)
  return b
}
// What a battle's units hold, as the prep board reckons it from the run's pieces (unit.js holdOf).
const holders = (b) => b.units.filter((u) => u.side === 'party' && u.hp > 0).map((u) => ({ tile: u.tile, size: u.size, ...holdOf(u) }))

// ── holding ──────────────────────────────────────────────────────────────────────────────────────

test('what a piece holds: a walker within its ring, a flyer only within its ranged reach; the Monarch anything within 1; a holder with no reach holds nothing', () => {
  assert.deepEqual(holdOf({ id: 'tomb_knight' }), { ground: 1, air: -1 }, 'melee: never a flyer')
  assert.deepEqual(holdOf({ id: 'grave_ghoul' }), { ground: 2, air: -1 })
  assert.deepEqual(holdOf({ id: 'frost_sprite' }), { ground: 3, air: 3 })
  assert.deepEqual(holdOf({ id: 'bone_chanter' }), { ground: 4, air: 4 })
  assert.deepEqual(holdOf({ id: 'monarch' }), { ground: 1, air: 1 }, 'it never strikes, but holds')
  // sight counts the holders of each tile, a ring measured from the footprint (a 2×2's from all four tiles).
  const s = sight([{ tile: tileAt(3, 3), size: 2, ground: 1, air: -1 }, { tile: tileAt(0, 0), ground: 0, air: 0 }, { tile: tileAt(6, 6), ground: -1, air: -1 }])
  assert.equal(s.ground.filter(Boolean).length, 16 + 1, 'the 4×4 round a 2×2, and a ring of 0 its own tile')
  assert.deepEqual([s.ground[tileAt(2, 2)], s.ground[tileAt(5, 5)], s.ground[tileAt(6, 5)], s.ground[tileAt(6, 6)]], [1, 1, 0, 0])
  assert.deepEqual([s.air[tileAt(3, 3)], s.air[tileAt(0, 0)]], [0, 1])
})

test('a piece sees only as far as its blows that need no condition reach: no shooter halts to strike one that cannot strike back', () => {
  // Killing Cold (the Frost Wyrm's Rime Tyrant IV) widens its ring to the board, but strikes only once a foe is below
  // half HP: the Wyrm holds a foe only as far as its breath, 3, on the ground and in the air. Briar Lash, Miasma and
  // Pyre Rain (2+ foes) likewise hold nothing past their kinds' other blows; Ashfall, Pyre Rain's tier before, needs no
  // condition, and holds as far as it reaches.
  const wyrm = { id: 'frost_wyrm', tracks: [0, 4] }
  assert.equal(ringOf(wyrm), 10)
  assert.deepEqual(holdOf(wyrm), { ground: 3, air: 3 })
  assert.deepEqual(holdOf({ id: 'thorn_dryad', tracks: [0, 4] }), { ground: 1, air: -1 })
  assert.deepEqual(holdOf({ id: 'rot_bloat', tracks: [0, 4] }), { ground: 1, air: -1 })
  assert.deepEqual(holdOf({ id: 'ash_wyvern', tracks: [4, 0] }), { ground: 1, air: 1 }, 'its only ranged blow needs 2+ foes: it holds by its Strike, which a flyer\'s reaches up as well as down')
  assert.deepEqual(holdOf({ id: 'ash_wyvern', tracks: [3, 0] }), { ground: 3, air: 3 })
  // The stall it was: a Wyrm of yours at (3, 2), the Monarch at (3, 0), and a foe Bone Chanter (its reach 4) down the
  // centre lane. At (3, 6) it has the Wyrm in its reach, and the Wyrm's ring covers it, but only Killing Cold reaches
  // it there, and no foe is below half HP: it walks on to (3, 5), within the breath, halts there, and the Wyrm
  // breathes on it. (It halted at (3, 6) and shot the Wyrm, unanswered, while a ring held a foe by any blow.)
  const b = scene([on('monarch', 0, 'party', 3, 0), on('frost_wyrm', 1, 'party', 3, 2, 9, [0, 4]), on('bone_chanter', 10, 'foe', 3, 10, 9)], { moving: [10] })
  until(b, () => actions(b.events, 1).length > 0)
  assert.deepEqual(moves(b.events, 10).map((e) => e.to), [9, 8, 7, 6, 5].map((y) => tileAt(3, y)), 'past the edge of its reach')
  assert.deepEqual(b.byUid.get(10).tile, tileAt(3, 5))
  const [breath] = actions(b.events, 1)
  assert.deepEqual([breath.ability, breath.targets], ['glacial_breath', [10]], 'the Wyrm answers it')
  // The stop line reads the same sight: its bar on the centre road where the breath begins, none out at the foes'
  // rows, where the ring alone would put it.
  const stops = stopLine(fieldOf(b), holders(b))
  assert.ok(stops.includes(tileAt(3, 5)) && stops.every((t) => tileY(t) <= 5))
})

test('a ranged walker halts in a ring of yours only where a piece of yours is in its reach; a melee one walks on through it', () => {
  // The Monarch at (3, 0), a Bone Chanter of yours at (3, 2) whose ring (4) reaches y 6. A foe Frost Sprite (its reach
  // 3) walks down the centre lane from the far edge: at (3, 6) it comes into the ring with nothing of yours in its
  // reach, and walks on; at (3, 5) the Chanter is 3 tiles off, and it halts there and shoots.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('bone_chanter', 1, 'party', 3, 2, 9), on('frost_sprite', 10, 'foe', 3, 10, 9)], { moving: [10] })
  const sprite = b.byUid.get(10)
  until(b, () => actions(b.events, 10).length >= 2)
  const steps = moves(b.events, 10)
  assert.deepEqual(steps.map((e) => e.to), [9, 8, 7, 6, 5].map((y) => tileAt(3, y)), 'into the ring, and a tile on')
  assert.deepEqual(steps.map((e) => e.t), steps.map((_, k) => k * sprite.every), 'a step every clock while nothing halted it')
  assert.ok(actions(b.events, 10).every((e) => e.t > steps.at(-1).t && e.targets[0] === 1), 'it shoots the Chanter, only once halted')
  // The stop line marks where it came into the ring: the earliest it could halt, a tile before it did.
  const stops = stopLine(fieldOf(b), holders(b))
  assert.ok(stops.includes(tileAt(3, 6)) && !stops.includes(tileAt(3, 5)))
  // A Pyre Hound (melee) down the same lane past an Ember Drake of yours (ring 4) standing off its road at (5, 4):
  // struck in the ring, with nothing of yours beside it, it walks on to the Monarch, and bites it there.
  const m = scene([on('monarch', 0, 'party', 3, 0), on('ember_drake', 1, 'party', 5, 4, 9), on('pyre_hound', 10, 'foe', 3, 10, 9)], { moving: [10] })
  until(m, () => actions(m.events, 10).length > 0)
  const hit = m.events.find((e) => e.type === 'damage' && e.target === 10)
  assert.ok(hit && moves(m.events, 10).some((e) => e.t > hit.t), 'struck, and still walking after')
  assert.deepEqual(moves(m.events, 10).map((e) => e.to), [9, 8, 7, 6, 5, 4, 3, 2, 1].map((y) => tileAt(3, y)))
  assert.deepEqual(actions(m.events, 10)[0].targets, [0])
  assert.ok(stopLine(fieldOf(m), holders(m)).some((t) => tileX(t) === 3 && tileY(t) > 1), 'past a bar of the stop line')
})

test('a walking foe never acts, struck or not: it fights only once halted', () => {
  // A Frost Sprite (ring 3) walks down the centre lane past a knight of yours at (0, 5), in its reach from y 2 to 8;
  // nothing holds it until the Monarch's ring does, beside it: only there does it shoot, and at the Monarch.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 5), on('frost_sprite', 10, 'foe', 3, 10, 9)], { moving: [10] })
  until(b, () => actions(b.events, 10).length > 0)
  const first = actions(b.events, 10)[0]
  assert.ok(moves(b.events, 10).every((e) => e.t <= first.t), 'every step before its first shot')
  assert.deepEqual([b.byUid.get(10).tile, first.targets], [tileAt(3, 1), [0]])
  // A Wisp (a Flank kind) walks through the ring of a Frost Sprite of yours, which shoots it as it goes: struck, it walks
  // on all the same, and halts as soon as its witchfire (range 4) reaches the Monarch, at (3, 4), and shoots it from
  // there.
  const w = scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 5, 5, 1), on('will_o_wisp', 10, 'foe', 3, 10, 15)], { moving: [10] })
  until(w, () => actions(w.events, 10).length > 1)
  const [shot, again] = actions(w.events, 10)
  const hit = w.events.find((e) => e.type === 'damage' && e.target === 10)
  assert.ok(hit && moves(w.events, 10).some((e) => e.t > hit.t), 'struck, and still walking after')
  assert.ok(moves(w.events, 10).every((e) => e.t <= shot.t))
  assert.deepEqual([w.byUid.get(10).tile, shot.targets, again.targets], [tileAt(3, 4), [0], [0]])
  assert.equal(unitDistance(w.byUid.get(10), w.monarch), 4, 'its range from the Monarch, never beside it')
})

// ── fighting, halted ─────────────────────────────────────────────────────────────────────────────

test('a ranged foe halted in the Knight\'s ring shoots it, and the Knight strikes it', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4, 9), on('frost_sprite', 10, 'foe', 3, 10, 9)], { moving: [10] })
  const sprite = b.byUid.get(10)
  until(b, () => actions(b.events, 1).length >= 2 && actions(b.events, 10).length >= 2)
  assert.equal(sprite.tile, tileAt(3, 5), 'halted on entering the Knight\'s ring')
  const halted = moves(b.events, 10).at(-1).t
  assert.ok(actions(b.events, 10).every((e) => e.t >= halted && e.targets[0] === 1), 'it shoots the Knight in its way')
  assert.ok(actions(b.events, 1).every((e) => e.targets.includes(10)), 'the Knight strikes it')
})

test('a foe queued behind a halted one shoots over it', () => {
  // A Clockwork Page halted in the knight's ring at (3, 5); a Frost Sprite walks down behind it and halts at (3, 6), out
  // of every ring of yours, its next tile held by its comrade: it shoots the knight over the Page's head.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4, 9), on('clockwork_page', 10, 'foe', 3, 5, 9),
    on('frost_sprite', 11, 'foe', 3, 9, 9)], { moving: [11] })
  until(b, () => actions(b.events, 11).length > 0)
  assert.equal(b.byUid.get(11).tile, tileAt(3, 6))
  assert.deepEqual(actions(b.events, 11)[0].targets, [1])
  // Two deep: a second Page stuck behind the first, with nothing it can strike, stands and does nothing; the Sprite
  // behind it, at (3, 7), its queue stopped, shoots the knight over both.
  const two = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4, 9), on('clockwork_page', 10, 'foe', 3, 5, 9),
    on('clockwork_page', 12, 'foe', 3, 6, 9), on('frost_sprite', 11, 'foe', 3, 9, 9)], { moving: [11, 12] })
  until(two, () => actions(two.events, 11).length > 0)
  assert.deepEqual([two.byUid.get(11).tile, actions(two.events, 11)[0].targets], [tileAt(3, 7), [1]])
  assert.deepEqual(actions(two.events, 12), [], 'the one between never acted')
})

test('a moving queue is no halt: a foe queued behind a comrade still walking waits, and shoots only once the one ahead halts', () => {
  // A Clockwork Page walks down the centre lane, a quicker Frost Sprite on its heels; a Tomb Knight of yours at (5, 6)
  // is in the Sprite's reach (3) from (3, 9) down to (3, 3), but no ring of yours holds it on the way. Each time its
  // step comes due the Page holds its next tile: it waits, never shooting, until the Page halts beside the Monarch.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 5, 6, 9), on('clockwork_page', 10, 'foe', 3, 9, 9),
    on('frost_sprite', 11, 'foe', 3, 10, 9)], { moving: [10, 11] })
  until(b, () => actions(b.events, 11).length > 0)
  const page = moves(b.events, 10)
  const sprite = moves(b.events, 11)
  assert.ok(b.byUid.get(11).every < b.byUid.get(10).every, 'the quicker of the two')
  assert.deepEqual(sprite.map((e) => e.t), page.slice(0, sprite.length).map((e) => e.t), 'held back to the Page\'s pace')
  assert.ok(sprite.some((e) => distanceBetween(e.to, 1, tileAt(5, 6), 1) <= 3), 'with the Knight in its reach on the way')
  const shot = actions(b.events, 11)[0]
  assert.ok(shot.t > page.at(-1).t, 'its first shot after the Page halted')
  assert.equal(b.byUid.get(10).tile, tileAt(3, 1))
})

test('a melee foe in a long ring with nothing beside it walks on; blocked by a piece of yours, it halts and fights it', () => {
  // A Frost Sprite of yours at (5, 4), off the road, shoots a Grave Ghoul walking down the centre lane: nothing of
  // yours stands beside the Ghoul, so it walks on through the ring, never acting, to beside the Monarch, and strikes it.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 5, 4, 1), on('grave_ghoul', 10, 'foe', 3, 10, 9)], { moving: [10] })
  until(b, () => actions(b.events, 10).length > 0)
  const first = actions(b.events, 10)[0]
  assert.deepEqual(moves(b.events, 10).map((e) => e.to), [9, 8, 7, 6, 5, 4, 3, 2, 1].map((y) => tileAt(3, y)))
  assert.ok(moves(b.events, 10).every((e) => e.t < first.t), 'it never acted on the way')
  assert.ok(actions(b.events, 1).filter((e) => e.targets.includes(10) && e.t < first.t).length >= 2, 'while the Sprite shot it')
  assert.deepEqual(first.targets, [0])
  // A Tomb Knight of yours on its road at (3, 3): the Ghoul halts in front of it, at (3, 4), and fights it.
  const k = scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 5, 4, 1), on('tomb_knight', 2, 'party', 3, 3, 9), on('grave_ghoul', 10, 'foe', 3, 10, 9)], { moving: [10] })
  until(k, () => actions(k.events, 10).length >= 2)
  assert.equal(k.byUid.get(10).tile, tileAt(3, 4))
  assert.ok(actions(k.events, 10).every((e) => e.targets[0] === 2), 'it strikes the Knight in its way')
})

test('a melee foe passing a piece of yours that strikes it halts there and strikes back; one that never strikes it, it walks past', () => {
  // A foe Grave Ghoul walks down the centre lane past a Tomb Knight of yours at (4, 5), beside its road: as it comes
  // beside the Knight, at (3, 6), the Knight strikes it, and it halts there and strikes the Knight back.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 4, 5, 6), on('grave_ghoul', 10, 'foe', 3, 10, 9)], { moving: [10] })
  until(b, () => actions(b.events, 10).length >= 2)
  const swing = actions(b.events, 1)[0]
  assert.deepEqual([b.byUid.get(10).tile, swing.targets], [tileAt(3, 6), [10]])
  assert.ok(moves(b.events, 10).every((e) => e.t <= swing.t), 'it halted as it was struck')
  assert.ok(actions(b.events, 10).every((e) => e.t > swing.t && e.targets[0] === 1), 'and struck back at the Knight')
  // The same Knight with no blow to strike (its kit emptied): the Ghoul walks past it to the Monarch.
  const idle = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 4, 5, 6), on('grave_ghoul', 10, 'foe', 3, 10, 9)], { moving: [10] })
  idle.byUid.get(1).kit = []
  until(idle, () => actions(idle.events, 10).length > 0)
  assert.deepEqual([idle.byUid.get(10).tile, actions(idle.events, 10)[0].targets], [tileAt(3, 1), [0]])
})

test('a melee foe strikes back at a piece beside it that struck it, and never at one not beside it, nor one that never struck it', () => {
  // An Iron Golem walks down the centre lane to (3, 6), between two knights of yours, at (2, 5) and (4, 5), and halts
  // there as the one at (4, 5) strikes it; a Frost Sprite of yours at (3, 3) reaches it too. The knight at (2, 5)
  // never swings (its kit emptied): its ring holds the Golem, but it never strikes it. Nothing stands on the Golem's
  // next tile, (3, 5).
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 4, 5, 6), on('tomb_knight', 2, 'party', 2, 5, 6), on('frost_sprite', 3, 'party', 3, 3, 1),
    on('iron_golem', 10, 'foe', 3, 10, 9)], { moving: [10] })
  b.byUid.get(2).kit = []
  until(b, () => false, 800)
  const golem = b.byUid.get(10)
  assert.equal(golem.tile, tileAt(3, 6))
  const swing = actions(b.events, 1).find((e) => e.targets.includes(10))
  const blows = actions(b.events, 10).filter((e) => !e.targets.every((uid) => b.byUid.get(uid).side === 'foe'))
  assert.ok(swing && blows.length >= 2, `${blows.length} blows`)
  assert.ok(blows.every((e) => e.t > swing.t), 'only after the knight beside it struck it')
  assert.ok(blows.every((e) => e.targets.length === 1 && e.targets[0] === 1), 'and only that knight')
  assert.ok(actions(b.events, 3).some((e) => e.targets.includes(10)), 'the Sprite, three tiles off, struck it too, and was never struck back')
  assert.deepEqual(actions(b.events, 2), [], 'the idle knight never struck, and was never struck')
})

test('a foe\'s melee has no long arm: a foe Grave Ghoul (ring 2) never strikes a piece two tiles off, struck or not, and strikes back once beside it', () => {
  // A Grave Ghoul of yours (ring 2: your melee keeps its long arm) at (3, 3) holds and strikes a foe Grave Ghoul at (3, 5).
  // The Monarch at (0, 0), so the foe's road runs off to the left, past your Ghoul, never into it.
  const far = scene([on('monarch', 0, 'party', 0, 0), on('grave_ghoul', 1, 'party', 3, 3, 3), on('grave_ghoul', 10, 'foe', 3, 5, 12)])
  until(far, () => false, 300)
  assert.ok(actions(far.events, 1).some((e) => e.targets.includes(10)), 'yours strikes two tiles off')
  assert.deepEqual(actions(far.events, 10), [], 'the foe never strikes back from there')
  // Beside it (at (3, 4)), the foe strikes back at it once struck.
  const near = scene([on('monarch', 0, 'party', 0, 0), on('grave_ghoul', 1, 'party', 3, 3, 3), on('grave_ghoul', 10, 'foe', 3, 4, 12)])
  assert.notEqual(near.at[fieldOf(near).arrow[tileAt(3, 4)]], near.byUid.get(1), 'not in its way')
  until(near, () => actions(near.events, 10).length > 0, 300)
  const swing = actions(near.events, 1)[0]
  assert.ok(swing && actions(near.events, 10)[0].t > swing.t)
  assert.deepEqual(actions(near.events, 10)[0].targets, [1])
})

// ── your melee ───────────────────────────────────────────────────────────────────────────────────

test('your melee reaches 1, or 2 for a long arm: a tier that widens the ring lengthens no arm, and Phantom Edge reaches past it', () => {
  assert.deepEqual(['tomb_knight', 'ember_drake', 'grave_ghoul', 'mantis_reaper', 'hive_queen'].map((id) => armOf({ id })), [1, 1, 2, 2, 1])
  // Frozen foes (the Monarch far off at (0, 0), so no road runs through them) round a piece of yours at (3, 4).
  const at = (piece, ...foes) => {
    const b = scene([on('monarch', 0, 'party', 0, 0), piece, ...foes.map(([x, y], i) => on('iron_golem', 10 + i, 'foe', x, y, 9))])
    until(b, () => false, 200)
    return (uid) => actions(b.events, 1).filter((e) => e.targets.includes(uid)).map((e) => e.ability)
  }
  // An Ember Drake (ring 4) with only its Strike: the Golem beside it struck, the one 2 tiles off never.
  const drake = on('ember_drake', 1, 'party', 3, 4)
  const struck = (() => {
    const b = scene([on('monarch', 0, 'party', 0, 0), drake, on('iron_golem', 10, 'foe', 4, 5, 9), on('iron_golem', 11, 'foe', 3, 6, 9)])
    b.byUid.get(1).kit = b.byUid.get(1).kit.filter((a) => a.id === 'strike')
    until(b, () => false, 200)
    return (uid) => actions(b.events, 1).filter((e) => e.targets.includes(uid)).length
  })()
  assert.ok(struck(10) > 0 && struck(11) === 0, 'a melee blow of a ring-4 kind reaches 1')
  // A Grave Ghoul (a long arm) strikes a Golem 2 tiles off.
  assert.ok(at(on('grave_ghoul', 1, 'party', 3, 4), [3, 6])(10).length > 0)
  // A Thorn Dryad with Bramble IV: its ring grows to 2 (for Briar Lash, while 2+ foes stand), its arm stays 1: a lone
  // Golem 2 tiles off is never struck.
  const dryad = on('thorn_dryad', 1, 'party', 3, 4, 3, [0, 4])
  assert.equal(ringOf(dryad), 2)
  assert.deepEqual(at(dryad, [3, 6])(10), [])
  // A Mantis Reaper with Phantom IV (ring 3): Reap 2 tiles off, Phantom Edge 3, a tile past its arm.
  const mantis = on('mantis_reaper', 1, 'party', 3, 3, 3, [0, 4])
  assert.equal(ringOf(mantis), 3)
  assert.ok(at(mantis, [3, 5])(10).every((id) => id === 'reap') && at(mantis, [3, 5])(10).length > 0)
  assert.ok(at(mantis, [3, 6])(10).every((id) => id === 'phantom_edge') && at(mantis, [3, 6])(10).length > 0)
})

// ── Flank and Fly ────────────────────────────────────────────────────────────────────────────────

test('a Flank kind walks through your rings: it halts once its blows reach the Monarch (a melee one beside it), or where its next tile is held', () => {
  // A Bone Chanter of yours at (0, 5): its ring (4) spans lanes 0 to 4 from y 1 to 9. A Mantis Reaper walks down the
  // centre lane through all of it, and halts beside the Monarch at (3, 0), and strikes it. (A Wisp, a ranged Flank
  // kind, halts at its range from the Monarch: see above.)
  const b = scene([on('monarch', 0, 'party', 3, 0), on('bone_chanter', 1, 'party', 0, 5, 1), on('mantis_reaper', 10, 'foe', 3, 10, 9)], { moving: [10] })
  until(b, () => actions(b.events, 10).length > 0)
  const steps = moves(b.events, 10)
  assert.ok(steps.filter((e) => distance(e.from, tileAt(0, 5)) <= 4).length >= 5, 'it stepped on inside the ring')
  assert.deepEqual([b.byUid.get(10).tile, actions(b.events, 10)[0].targets], [tileAt(3, 1), [0]])
  assert.ok(steps.every((e) => e.t <= actions(b.events, 10)[0].t))
})

test('a flyer flies the air road over the walls: each step its arrow, hovering over a wall on the way, to the Monarch', () => {
  // A wall across the board at y 5: no road reaches the foes' rows. A Hive Drone flies down the centre lane by the air
  // road (airOf: the roads flooded over every tile, walls and all), over the wall, to beside the Monarch at (3, 0), and
  // strikes it there.
  const walls = [...Array(7).keys()].map((x) => tileAt(x, 5))
  const b = scene([on('monarch', 0, 'party', 3, 0), on('hive_drone', 10, 'foe', 3, 9, 1)], { moving: [10], walls })
  assert.equal(fieldOf(b).dist[tileAt(3, 9)], Infinity, 'no road for a walker')
  until(b, () => actions(b.events, 10).length > 0)
  const path = moves(b.events, 10)
  assert.deepEqual(path.map((e) => e.to), [8, 7, 6, 5, 4, 3, 2, 1].map((y) => tileAt(3, y)), 'straight down its lane')
  assert.ok(path.every((e) => e.to === airOf(b).arrow[e.from]), 'each step the air road\'s arrow')
  assert.ok(path.some((e) => walls.includes(e.to)), 'hovering over the wall on the way')
  assert.deepEqual(actions(b.events, 10)[0].targets, [0])
})

test('a flyer is blocked by a piece of yours on its air road: it halts there and strikes it; a melee blocker cannot strike it back, a ranged piece can', () => {
  // A Tomb Knight of yours at (3, 5), on the air road down the centre lane, and a Frost Sprite of yours at (0, 3), whose
  // reach (3) takes in (3, 6) and nothing of the lane above it. A Hive Drone flies down from the top edge: nothing that
  // can strike it holds it on the way (the Knight's melee never touches a flyer), but at (3, 6) the Knight holds its
  // next tile, and it halts there and stings the Knight. The Knight, beside it all the while, never strikes it: the
  // Sprite shoots it down.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 5, 9), on('frost_sprite', 2, 'party', 0, 3, 3),
    on('hive_drone', 10, 'foe', 3, 10, 3)], { moving: [10] })
  until(b, () => b.byUid.get(10).hp <= 0, 3000)
  const path = moves(b.events, 10)
  assert.deepEqual(path.map((e) => e.to), [9, 8, 7, 6].map((y) => tileAt(3, y)), 'held before the Knight')
  const stings = actions(b.events, 10)
  assert.ok(stings.length > 0 && stings.every((e) => e.t > path.at(-1).t && e.targets[0] === 1), 'it stings the Knight in its way')
  assert.deepEqual(actions(b.events, 1), [], 'the Knight never strikes it')
  assert.ok(actions(b.events, 2).length > 0 && actions(b.events, 2).every((e) => e.targets[0] === 10), 'the Sprite shoots it')
  assert.equal(b.events.find((e) => e.type === 'death' && e.target === 10)?.actor, 2, 'and brings it down')
})

test('a flyer queues behind a foe flyer in its way: behind one halted it stands, and flies on once the way clears', () => {
  // Two Hive Drones down the centre lane at a Tomb Knight of yours at (3, 5): the first halts at (3, 6), blocked by the
  // Knight, and stings it; the second comes up behind it to (3, 7), its next tile held in the air by its comrade, and
  // stands there, with nothing of yours beside it to sting. Once the first falls it flies on to (3, 6), and stings the
  // Knight in its turn.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 5, 9), on('hive_drone', 10, 'foe', 3, 9, 3),
    on('hive_drone', 11, 'foe', 3, 10, 3)], { moving: [10, 11] })
  until(b, () => actions(b.events, 10).length >= 2)
  until(b, () => false, b.t + 100)
  assert.deepEqual([b.byUid.get(10).tile, b.byUid.get(11).tile], [tileAt(3, 6), tileAt(3, 7)])
  assert.deepEqual(actions(b.events, 11), [], 'the one behind never acted')
  const t = b.t
  slay(b, b.byUid.get(10))
  until(b, () => actions(b.events, 11).length > 0, t + 600)
  assert.deepEqual(moves(b.events, 11).filter((e) => e.t >= t).map((e) => e.to), [tileAt(3, 6)])
  assert.ok(actions(b.events, 11).every((e) => e.targets[0] === 1))
})

test('a ground foe and a flyer never block each other: a drone flies over a comrade standing on its road, a walker walks under one hovering on its', () => {
  // A Hive Drone flies down the centre lane over an Iron Golem standing at (3, 6), and on to the Monarch.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('iron_golem', 20, 'foe', 3, 6, 1), on('hive_drone', 10, 'foe', 3, 10, 3)], { moving: [10] })
  until(b, () => actions(b.events, 10).length > 0)
  assert.deepEqual(moves(b.events, 10).map((e) => e.to), [9, 8, 7, 6, 5, 4, 3, 2, 1].map((y) => tileAt(3, y)))
  // A Grave Ghoul walks the same lane under a Hive Drone hovering at (3, 6), and on to the Monarch.
  const w = scene([on('monarch', 0, 'party', 3, 0), on('hive_drone', 20, 'foe', 3, 6, 1), on('grave_ghoul', 10, 'foe', 3, 10, 3)], { moving: [10] })
  until(w, () => actions(w.events, 10).length > 0)
  assert.deepEqual(moves(w.events, 10).map((e) => e.to), [9, 8, 7, 6, 5, 4, 3, 2, 1].map((y) => tileAt(3, y)))
})

test('a flyer halts in a ranged ring only where it can strike back', () => {
  // A Frost Sprite of yours at (5, 5), two lanes off the air road: its ranged ring (3) holds the air the Drone flies
  // through, and it shoots the Drone, but nothing of yours is ever beside it to strike back at: it flies on to the
  // Monarch, halts beside it, never over the seat, and strikes it there.
  const r = scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 5, 5, 1), on('hive_drone', 10, 'foe', 3, 10, 9)], { moving: [10] })
  until(r, () => actions(r.events, 10).length > 0)
  const hit = r.events.find((e) => e.type === 'damage' && e.target === 10)
  assert.ok(hit && moves(r.events, 10).some((e) => e.t > hit.t), 'struck, and flying on')
  assert.deepEqual([r.byUid.get(10).tile, actions(r.events, 10)[0].targets], [tileAt(3, 1), [0]])
  until(r, () => false, r.t + 100)
  assert.equal(r.byUid.get(10).tile, tileAt(3, 1), 'held beside the Monarch')
  // The Sprite beside the air road, at (4, 5): it shoots the Drone, which halts as it comes beside it, at (3, 6), its
  // way still open, and stings it.
  const s = scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 4, 5, 1), on('hive_drone', 10, 'foe', 3, 10, 9)], { moving: [10] })
  until(s, () => actions(s.events, 10).length > 0)
  assert.deepEqual([s.byUid.get(10).tile, actions(s.events, 10)[0].targets], [tileAt(3, 6), [1]])
  assert.equal(airOf(s).arrow[tileAt(3, 6)], tileAt(3, 5))
})

test('a flyer of yours blocks a foe flyer as any piece of yours does, and the two meet in the air; melee from the ground never reaches up', () => {
  // A shadow Hive Drone of yours hovers at (3, 4), on the air road down the centre lane. A foe Hive Drone flies down to
  // (3, 5) and is held there, and stings the shadow in its way: a flyer's melee meets a flyer in the air. The shadow,
  // a flyer too, stings it back.
  const shadow = { ...on('hive_drone', 1, 'party', 3, 4, 3), shadow: true }
  const b = scene([on('monarch', 0, 'party', 3, 0), shadow, on('hive_drone', 10, 'foe', 3, 10, 3)], { moving: [10] })
  until(b, () => actions(b.events, 10).length > 0 && actions(b.events, 1).length > 0, 400)
  assert.deepEqual(moves(b.events, 10).map((e) => e.to), [9, 8, 7, 6, 5].map((y) => tileAt(3, y)))
  assert.deepEqual([actions(b.events, 10)[0].targets, actions(b.events, 1)[0].targets], [[1], [10]])
  // A Tomb Knight on the ground in the drone's way holds it as well, stung, but never reaches up to strike it.
  const k = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4, 3), on('hive_drone', 10, 'foe', 3, 10, 3)], { moving: [10] })
  until(k, () => actions(k.events, 10).length > 0, 400)
  until(k, () => false, 200)
  assert.equal(k.byUid.get(10).tile, tileAt(3, 5))
  assert.deepEqual([actions(k.events, 10)[0].targets, actions(k.events, 1)], [[1], []])
  // An Ash Wyvern held so breathes its fire on the shadow (a ranged blow touches a flyer).
  const w = scene([on('monarch', 0, 'party', 3, 0), shadow, on('ash_wyvern', 10, 'foe', 3, 10, 3)], { moving: [10] })
  until(w, () => actions(w.events, 10).length > 0)
  assert.deepEqual([w.byUid.get(10).tile, actions(w.events, 10)[0].targets[0]], [tileAt(3, 5), 1])
})

test('the Monarch\'s ring of 1 halts a foe beside it, on the ground too', () => {
  // A Mantis Reaper (a Flank kind) stands frozen beside the Monarch, off its road's end: only the Monarch's ring holds
  // it, and it strikes; two tiles off, nothing holds it, and it does nothing.
  const near = scene([on('monarch', 0, 'party', 3, 0), on('mantis_reaper', 10, 'foe', 4, 1, 9)])
  until(near, () => actions(near.events, 10).length > 0, 200)
  assert.deepEqual(actions(near.events, 10)[0]?.targets, [0])
  const far = scene([on('monarch', 0, 'party', 3, 0), on('mantis_reaper', 10, 'foe', 5, 2, 9)])
  until(far, () => false, 200)
  assert.deepEqual(actions(far.events, 10), [])
  assert.equal(unitDistance(far.byUid.get(10), far.monarch), 2)
})

// ── the camp: the default frontier and the stop line ─────────────────────────────────────────────

// The roads a walker takes from each tile of the foes' rows to the seat, each a list of tiles (the seat last).
function entryRoads (camp) {
  const seat = deployTile('party', monarchSlot(camp))
  const roads = field({ root: seat, walls: wallTiles(camp) })
  const out = []
  for (let t = tileAt(0, DEPTH - ROWS); t < TILES; t++) {
    const road = []
    for (let x = t; x >= 0; x = roads.arrow[x]) road.push(x)
    out.push(road)
  }
  return { seat, roads, out }
}

test('the default frontier: each start soul on a cell of its own, the Tomb Knight on the road most foes walk (so it blocks the melee walkers there), the others\' rings reaching all round it, and most entry roads first coming into its ring', () => {
  const start = START_PARTY.map((id, i) => makeUnit(id, { uid: 1 + i, lvl: 2 }))
  for (const c of CAMP_LIST.filter((x) => x.floor === 1)) {
    const slots = frontier(c.id, start)
    assert.deepEqual(frontier(c.id, start), slots, 'deterministic')
    assert.ok(start.every((u) => u.slot === -1), 'pure: the pieces untouched')
    const taken = new Set([monarchSlot(c.id)])
    start.forEach((u, i) => {
      assert.ok(fits(c.id, slots[i], sizeOf(u), taken), `${c.id}: ${u.id} on ${slots[i]}`)
      for (const x of footprintSlots(slots[i], sizeOf(u))) taken.add(x)
    })
    const { seat, out } = entryRoads(c.id)
    const knight = deployTile('party', slots[0])
    assert.equal(start[0].id, 'tomb_knight')
    assert.ok(out.filter((road) => road.includes(knight)).length > out.length / 2, `${c.id}: the Knight on most roads, in a melee walker's way`)
    start.slice(1).forEach((u, i) => assert.ok(distanceBetween(deployTile('party', slots[i + 1]), sizeOf(u), knight, 1) <= ringOf(u) - ringOf(start[0]), `${c.id}: ${u.id} reaches round the Knight`))
    const held = sight([{ tile: seat, ...holdOf({ id: 'monarch' }) }, ...start.map((u, i) => ({ tile: deployTile('party', slots[i]), size: sizeOf(u), ...holdOf(u) }))]).ground
    const first = out.map((road) => road.find((t) => held[t]))
    assert.ok(first.filter((t) => distance(t, knight) <= 1).length > out.length / 2, `${c.id}: halts ${first.map((t) => `${tileX(t)},${tileY(t)}`)}`)
  }
  // A bigger army, 2×2 pieces among them, finds a cell of its own in every camp; the tankiest melee piece leads.
  const army = ['frost_sprite', 'bone_colossus', 'tomb_knight', 'bone_chanter', 'hive_queen', 'grave_ghoul', 'ember_drake', 'clockwork_page', 'will_o_wisp', 'iron_golem']
    .map((id, i) => makeUnit(id, { uid: 1 + i, lvl: 3 }))
  for (const c of CAMP_LIST) {
    const slots = frontier(c.id, army)
    const taken = new Set([monarchSlot(c.id)])
    army.forEach((u, i) => {
      if (slots[i] < 0) return
      assert.ok(fits(c.id, slots[i], sizeOf(u), taken), `${c.id}: ${u.id} on ${slots[i]}`)
      for (const x of footprintSlots(slots[i], sizeOf(u))) taken.add(x)
    })
    assert.ok(slots.filter((s) => s >= 0).length >= 8, `${c.id}: ${slots}`)
  }
})

test('the stop line: on each road from the foes\' rows, each tile where a walker comes under a ring of yours, and only those', () => {
  // A corridor down lane 3 to the root at (3, 0): a ring 2 at (3, 2) holds y 0 to 4, a ring 1 at (3, 7) y 6 to 8, the
  // Monarch's y 0 to 1; a holder with no reach holds nothing. A walker coming down from (3, 10) first comes under a ring
  // at (3, 8), and again, after (3, 5), at (3, 4); for one standing at (3, 8) from the start, it is where it stands.
  // (Each is the earliest a walker may halt, never that it will: it halts only where it can hit back.)
  const walls = [...Array(TILES).keys()].filter((t) => tileX(t) !== 3)
  const roads = field({ root: tileAt(3, 0), walls })
  const line = [{ tile: tileAt(3, 0), ground: 1, air: 1 }, { tile: tileAt(3, 2), ground: 2, air: -1 }, { tile: tileAt(3, 7), ground: 1, air: -1 }, { tile: tileAt(3, 5), ground: -1, air: -1 }]
  assert.deepEqual(stopLine(roads, line), [tileAt(3, 4), tileAt(3, 8)])
  assert.deepEqual(stopLine(roads, line.slice(0, 2)), [tileAt(3, 4)])
  assert.deepEqual(stopLine(roads, []), [], 'no ring, no stop')
  // A ring reaching the foes' rows: a walker standing in it from the start halts where it stands, at (3, 8) and (3, 9).
  assert.deepEqual(stopLine(roads, [{ tile: tileAt(3, 6), ground: 3, air: 3 }]), [tileAt(3, 8), tileAt(3, 9)])
  // On open ground, a ring beside the roads that no walker from the foes' rows comes into is no stop, though a tile off
  // every road points an arrow into it: a ring 1 at (0, 3), the roads running from the top down to the root at (3, 0)
  // well to its right.
  const open = field({ root: tileAt(3, 0) })
  assert.ok([tileAt(0, 5), tileAt(1, 5)].some((t) => open.arrow[t] === tileAt(1, 4)), 'an arrow from off the roads into its ring')
  assert.deepEqual(stopLine(open, [{ tile: tileAt(0, 3), ground: 1, air: -1 }]), [])
  // In every camp, with the default frontier: on every road from a tile of the foes' rows, the first tile a ring holds is
  // a stop; every stop is held, on such a road, where the walker comes from an unheld tile or starts; and nothing else.
  const start = START_PARTY.map((id, i) => makeUnit(id, { uid: 1 + i, lvl: 2 }))
  for (const c of CAMP_LIST) {
    const slots = frontier(c.id, start)
    const { seat, roads: f, out } = entryRoads(c.id)
    const hs = [{ tile: seat, ...holdOf({ id: 'monarch' }) }, ...start.map((u, i) => ({ tile: deployTile('party', slots[i]), size: sizeOf(u), ...holdOf(u) }))]
    const held = sight(hs).ground
    const stops = stopLine(f, hs)
    for (const road of out) assert.ok(stops.includes(road.find((t) => held[t])), `${c.id}: a road's first halt`)
    const entered = new Set(out.flatMap((road) => road.filter((t, i) => held[t] && (i === 0 || !held[road[i - 1]]))))
    assert.deepEqual(stops, [...entered].sort((a, b) => a - b), c.id)
  }
})

test('yours aim at the foe furthest along its own road: a Flank kind\'s is the way round your pieces, not the Walk road', () => {
  // A wall of knights before the Monarch: the Wisp stands nearer by the Walk road, but its own road, the Flank
  // field's, goes the long way round them, and the Knight foe is nearer the end of its road.
  const b = scene([
    on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 2, 1), on('tomb_knight', 2, 'party', 3, 1),
    on('tomb_knight', 3, 'party', 4, 1), on('bone_chanter', 4, 'party', 1, 2),
    on('will_o_wisp', 10, 'foe', 3, 3), on('tomb_knight', 11, 'foe', 0, 4)
  ])
  const [wisp, knight] = [10, 11].map((uid) => b.units.find((u) => u.uid === uid))
  const walk = fieldOf(b).dist
  const flank = fieldOf(b, true).dist
  assert.ok(walk[wisp.tile] < walk[knight.tile] && walk[knight.tile] < flank[wisp.tile])
  assert.equal(ringTarget(b, b.units.find((u) => u.uid === 4)), knight)
})

test('walkers and flankers never jam each other: a foe held up by a comrade of the other kind steps round it; one kind\'s queue stays a queue', () => {
  // A Will-o'-Wisp (Flank, reach 4) stands four tiles before the Monarch and halts there to shoot it, on the Walk road
  // down the centre lane. The Grave Ghoul behind it steps round it, onto a free tile nearer by its own road.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('will_o_wisp', 10, 'foe', 3, 4), on('grave_ghoul', 11, 'foe', 3, 5)], { moving: [11] })
  until(b, () => moves(b.events, 11).length > 0, 60)
  const walk = fieldOf(b).dist
  const first = moves(b.events, 11)[0]
  assert.ok(first, 'the Ghoul steps round the Wisp')
  assert.ok(walk[first.to] < walk[tileAt(3, 5)] && first.to !== tileAt(3, 4))
  // Two Ghouls, the first halted fighting a Tomb Knight in its way: the second waits behind it, and never steps round.
  const q = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3), on('grave_ghoul', 10, 'foe', 3, 4), on('grave_ghoul', 11, 'foe', 3, 5)], { moving: [10, 11] })
  until(q, () => false, 150)
  assert.deepEqual(moves(q.events, 11), [])
})

test('foes standing each in the next one\'s way change places: a Walk foe and a Flank foe on two roads never stand stuck for good', () => {
  // A walled corridor down the centre lane to a Tomb Knight before the Monarch. The Walk road runs down it through the
  // Knight; the Flank road, the Knight a wall to it, leads back out of the corridor and round. A Mantis Reaper (Flank)
  // at (3, 2) and a Grave Ghoul (Walk) at (3, 3) each hold the other's next tile: they change places, and the Ghoul,
  // now before the Knight, fights it.
  const walls = [[2, 1], [2, 2], [2, 3], [4, 1], [4, 2], [4, 3]].map(([x, y]) => tileAt(x, y))
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 1), on('mantis_reaper', 10, 'foe', 3, 2), on('grave_ghoul', 11, 'foe', 3, 3)], { moving: [10, 11], walls })
  const [mantis, ghoul] = [10, 11].map((uid) => b.byUid.get(uid))
  assert.deepEqual([arrowOf(b, mantis), arrowOf(b, ghoul)], [tileAt(3, 3), tileAt(3, 2)], 'each in the other\'s way')
  until(b, () => moves(b.events, 10).length > 0 && moves(b.events, 11).length > 0, 60)
  assert.deepEqual([moves(b.events, 10)[0]?.to, moves(b.events, 11)[0]?.to], [tileAt(3, 3), tileAt(3, 2)])
  assert.deepEqual([b.at[tileAt(3, 3)], b.at[tileAt(3, 2)]], [mantis, ghoul])
  until(b, () => actions(b.events, 11).length > 0, 200)
  assert.deepEqual(actions(b.events, 11)[0].targets, [1])
})
