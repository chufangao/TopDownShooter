// Lines of fire: a single-target blow from range strikes the first piece of its target's side
// standing strictly between them on a supercover line; the shooter's own side never blocks; melee, shapes and a blow
// that arcs ignore lines; a Bodyguard comes after the line. And the policy reads it: the danger map, the camp's scoring,
// the expert's threat read and features count the piece a blow would actually strike.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { order, perform, preview, legalOrders, lineOf, struckBy, lined, fork } from '../src/sim/turns.js'
import { danger, dangerAt, situation, features, expertOptions } from '../src/sim/policy.js'
import { abilityDef } from '../src/content.js'
import { tileAt, tileX, tileY, between, lineEnds } from '../src/sim/unit.js'
import { on, scene } from './scene.js'

const at = (x, y) => tileAt(x, y)
const unit = (b, uid) => b.byUid.get(uid)
const xy = (tiles) => tiles.map((t) => [tileX(t), tileY(t)])
const act = (events, uid) => events.find((e) => e.type === 'action' && e.actor === uid && !e.counter)
const hurt = (events) => events.filter((e) => e.type === 'damage' && !e.status).map((e) => e.target)

// A Bone Chanter of yours (Marrow Bolt, range 4) at (3,2) aims at a Tomb Knight of the camp at (3,6); `between` stands
// at (3,4).
const shot = (between) => scene([on('bone_chanter', 1, 'party', 3, 2), on('tomb_knight', 101, 'foe', 3, 6), ...between])

test('the supercover line: every tile the segment touches, both beside a corner it passes, from the first end', () => {
  assert.deepEqual(xy(between(at(0, 0), at(4, 0))), [[1, 0], [2, 0], [3, 0]])
  assert.deepEqual(xy(between(at(0, 0), at(2, 2))), [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]])
  assert.deepEqual(xy(between(at(0, 0), at(3, 1))), [[1, 0], [2, 0], [1, 1], [2, 1]])
  assert.deepEqual(between(at(3, 1), at(0, 0)).slice().sort(), between(at(0, 0), at(3, 1)).slice().sort(), 'the same tiles either way')
  assert.deepEqual(between(at(2, 2), at(3, 3)), [at(3, 2), at(2, 3)], 'next to it, a diagonal still passes a corner')
  assert.deepEqual(between(at(2, 2), at(3, 2)), [], 'next to it in a row: nothing between')
  // A 2×2 end is its footprint's tile nearest the other end.
  assert.deepEqual(xy(lineEnds(at(2, 2), 2, at(3, 7), 1)), [[3, 3], [3, 7]])
  assert.deepEqual(xy(lineEnds(at(6, 9), 1, at(2, 4), 2)), [[6, 9], [3, 5]])
})

test('a ranged blow strikes the first piece of its target\'s side in its line; a piece of the shooter\'s own never blocks it', () => {
  const b = shot([on('clockwork_page', 102, 'foe', 3, 4)])
  const u = unit(b, 1)
  const bolt = abilityDef('marrow_bolt')
  assert.ok(lined(bolt))
  assert.deepEqual(xy(lineOf(b, u, unit(b, 101))), [[3, 3], [3, 4], [3, 5]])
  assert.equal(struckBy(b, u, 'marrow_bolt', unit(b, 101)), unit(b, 102))
  // Still an order the player may give: the preview says who takes it.
  assert.ok(legalOrders(b).some((o) => o.type === 'act' && o.uid === 1 && o.ability === 'marrow_bolt' && o.target === 101))
  const events = order(b, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 101 })
  const a = act(events, 1)
  assert.deepEqual([a.primary, a.struck, a.targets], [101, 102, [102]])
  assert.deepEqual(hurt(events), [102])
  assert.equal(unit(b, 101).hp, unit(b, 101).maxHp)
  // A friend in the way: fired over.
  const f = shot([on('tomb_knight', 2, 'party', 3, 4)])
  const g = order(f, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 101 })
  assert.deepEqual([act(g, 1).primary, act(g, 1).struck, hurt(g)], [101, undefined, [101]])
  // Either side alike: the camp's shooter at the Monarch, one of yours in the way.
  const theirs = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 2), on('bone_chanter', 101, 'foe', 3, 4)])
  theirs.stage = 'foes'
  const from = theirs.events.length
  perform(theirs, unit(theirs, 101), abilityDef('marrow_bolt'), unit(theirs, 0))
  assert.deepEqual(hurt(theirs.events.slice(from)), [1])
})

test('no blow slips between two diagonal blockers; a piece beside the line, off it, blocks nothing', () => {
  // From (2,2) to (4,4): the line passes the corner of (3,2) and (2,3) between them.
  const play = (blockers) => {
    const b = scene([on('bone_chanter', 1, 'party', 2, 2), on('tomb_knight', 101, 'foe', 4, 4), ...blockers])
    return act(order(b, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 101 }), 1)
  }
  assert.deepEqual(play([on('clockwork_page', 102, 'foe', 3, 2), on('clockwork_page', 103, 'foe', 2, 3)]).targets, [102], 'the lower tile of the pinch first')
  assert.deepEqual(play([on('clockwork_page', 103, 'foe', 2, 3)]).targets, [103], 'one at the corner is touched')
  assert.deepEqual(play([on('clockwork_page', 102, 'foe', 4, 2), on('clockwork_page', 103, 'foe', 2, 4)]).targets, [101], 'off the line')
})

test('2×2 pieces: one blocks on any tile of its footprint, and a line to one ends at its nearest tile', () => {
  // The camp's shooter at (3,8) at a Bone Chanter of yours at (3,4); a Bone Colossus of yours anchored at (2,5) covers
  // (2,5), (3,5), (2,6), (3,6).
  const b = scene([on('bone_chanter', 1, 'party', 3, 4), on('bone_colossus', 2, 'party', 2, 5), on('bone_chanter', 101, 'foe', 3, 8)])
  assert.equal(unit(b, 2).size, 2)
  assert.equal(struckBy(b, unit(b, 101), 'marrow_bolt', unit(b, 1)), unit(b, 2))
  // At the Colossus itself: the line runs to (3,6), its nearest tile, and one of yours on (3,7) takes it.
  assert.deepEqual(xy(lineOf(b, unit(b, 101), unit(b, 2))), [[3, 7]])
  const c = scene([on('bone_colossus', 2, 'party', 2, 5), on('tomb_knight', 3, 'party', 3, 7), on('bone_chanter', 101, 'foe', 3, 9)])
  assert.equal(struckBy(c, unit(c, 101), 'marrow_bolt', unit(c, 2)), unit(c, 3))
  // A 2×2 shooter's line starts at its footprint's tile nearest the target.
  assert.deepEqual(xy(lineOf(b, { tile: at(2, 2), size: 2 }, { tile: at(3, 7), size: 1 })), [[3, 4], [3, 5], [3, 6]])
})

test('a flyer blocks and is blocked like any piece: the line is the board\'s, not a layer\'s', () => {
  // The camp's Hive Drone in the air on the line.
  const b = shot([on('hive_drone', 102, 'foe', 3, 4)])
  assert.ok(unit(b, 102).flies)
  assert.deepEqual(act(order(b, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 101 }), 1).targets, [102])
  // A bolt at a drone in the air meets a page on the ground.
  const c = scene([on('bone_chanter', 1, 'party', 3, 2), on('hive_drone', 101, 'foe', 3, 6), on('clockwork_page', 102, 'foe', 3, 5)])
  assert.deepEqual(act(order(c, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 101 }), 1).targets, [102])
  // A tile holding two of the side, one aloft: the one on the ground takes it.
  const d = shot([on('clockwork_page', 102, 'foe', 3, 4), on('hive_drone', 103, 'foe', 3, 4)])
  assert.deepEqual(act(order(d, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 101 }), 1).targets, [102])
})

test('melee (a reach-2 arm too), shapes and a blow that arcs ignore lines', () => {
  // A Grave Ghoul's arm of 2 over a page.
  const m = scene([on('grave_ghoul', 1, 'party', 3, 4), on('tomb_knight', 101, 'foe', 3, 6), on('clockwork_page', 102, 'foe', 3, 5)])
  assert.ok(!lined(abilityDef('strike')))
  assert.deepEqual(lineOf(m, unit(m, 1), unit(m, 101), 'strike'), [])
  assert.equal(act(order(m, { type: 'act', uid: 1, ability: 'strike', target: 101 }), 1).targets[0], 101)
  // Ember Burst, a blast: aimed at the knight, it bursts on it.
  const s = scene([on('ember_drake', 1, 'party', 3, 2), on('tomb_knight', 101, 'foe', 3, 6), on('clockwork_page', 102, 'foe', 3, 4)])
  const burst = act(order(s, { type: 'act', uid: 1, ability: 'ember_burst', target: 101 }), 1)
  assert.ok(!lined(abilityDef('ember_burst')) && burst.targets.includes(101) && !burst.targets.includes(102) && burst.struck === undefined)
  // Skyfall and Killing Cold arc: no one in the way takes them.
  assert.deepEqual(['skyfall', 'killing_cold'].map((id) => [abilityDef(id).arc, lined(abilityDef(id))]), [[true, false], [true, false]])
  const sky = scene([on('ember_drake', 1, 'party', 3, 2, 3, [0, 4]), on('tomb_knight', 101, 'foe', 3, 6), on('clockwork_page', 102, 'foe', 3, 4)])
  assert.ok(unit(sky, 1).kit.some((a) => a.id === 'skyfall'))
  assert.deepEqual(act(order(sky, { type: 'act', uid: 1, ability: 'skyfall', target: 101 }), 1).targets, [101])
})

test('a Bodyguard comes after the line: the line picks who is struck, then a Vanguard beside that one takes it', () => {
  // The camp holds Vanguard 4 (four Tomb Knights); one of them, 104, stands beside the page in the line (and not beside
  // the target, a Frost Sprite, which no Vanguard guards where it stands).
  const b = scene([
    on('bone_chanter', 1, 'party', 3, 2), on('frost_sprite', 101, 'foe', 3, 6), on('clockwork_page', 102, 'foe', 3, 4),
    on('tomb_knight', 104, 'foe', 2, 3), ...[0, 1, 6].map((x, i) => on('tomb_knight', 105 + i, 'foe', x, 10))
  ])
  assert.equal(struckBy(b, unit(b, 1), 'marrow_bolt', unit(b, 101)), unit(b, 104))
  const events = order(b, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 101 })
  const guard = events.find((e) => e.type === 'rule' && e.rule === 'bodyguard')
  assert.deepEqual([guard.actor, guard.target], [104, 102], 'it guards the line\'s piece')
  assert.deepEqual([act(events, 1).primary, act(events, 1).struck, hurt(events)], [101, 104, [104]])
  // No rule is said by a read.
  const c = fork(b, { quiet: false })
  const n = c.events.length
  struckBy(c, unit(c, 1), 'marrow_bolt', unit(c, 101))
  assert.equal(c.events.length, n)
})

test('the preview names the struck, the line, and the damage the blow then deals it', () => {
  const b = shot([on('clockwork_page', 102, 'foe', 3, 4)])
  const p = preview(b, 1, 'marrow_bolt', 101)
  assert.deepEqual([p.struck, xy(p.line)], [102, [[3, 3], [3, 4], [3, 5]]])
  const events = order(b, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 101 })
  const dealt = events.filter((e) => e.type === 'damage' && e.target === 102).reduce((n, e) => n + e.damage, 0)
  assert.ok(dealt > 0)
  assert.deepEqual([p.damage, p.hits, p.kills], [dealt, { 102: dealt }, unit(b, 102).hp <= 0])
  // Felled, it is marked so.
  const c = shot([on('clockwork_page', 102, 'foe', 3, 4)])
  unit(c, 102).hp = 1
  const q = preview(c, 1, 'marrow_bolt', 101)
  assert.deepEqual([q.struck, q.kills, q.falls], [102, true, [102]])
  // A melee blow keeps no line.
  const m = scene([on('tomb_knight', 1, 'party', 3, 5), on('tomb_knight', 101, 'foe', 3, 6)])
  assert.deepEqual(preview(m, 1, 'strike', 101).line, [])
})

// The camp's Bone Chanter, pinned by the forecast at (3,7) (Marrow Bolt, range 4), and a Tomb Knight of yours at (3,5).
const screened = (knight = true) => scene([
  on('monarch', 0, 'party', 3, 0), ...(knight ? [on('tomb_knight', 1, 'party', 3, 5)] : []), on('bone_chanter', 2, 'party', 0, 0), on('bone_chanter', 101, 'foe', 3, 7)
])

test('the danger map counts lines: a tile behind a screen is safe from the shooter; the screen itself is not, read elsewhere', () => {
  const pin = new Map([[101, at(3, 7)]])
  const b = screened()
  const map = danger(b, 'party', pin)
  const open = danger(screened(false), 'party', pin)
  const knight = at(3, 5)
  for (let t = 0; t < map.ground.length; t++) {
    const hidden = between(at(3, 7), t).includes(knight)
    assert.equal(map.ground[t], hidden ? 0 : open.ground[t], `(${tileX(t)},${tileY(t)})`)
    assert.equal(map.air[t], hidden ? 0 : open.air[t])
  }
  assert.ok(open.ground[at(3, 4)] > 0 && map.ground[at(3, 4)] === 0, 'behind the knight')
  // As if no one stood in the way: the formation's.
  assert.deepEqual(danger(screened(), 'party', pin, { lines: false }).ground, open.ground)
  // The knight itself, read on the tile behind it, has left it: no screen there for it; for another piece there is.
  assert.ok(dangerAt(b, unit(b, 1), at(3, 4), map) > 0)
  assert.equal(dangerAt(b, unit(b, 2), at(3, 4), map), 0)
  assert.equal(dangerAt(b, unit(b, 1), at(3, 4), map), dangerAt(b, unit(b, 1), at(3, 4), open))
  assert.equal(dangerAt(b, unit(b, 1), at(3, 5), map), dangerAt(b, unit(b, 1), at(3, 5), open), 'where it stands, as before')
})

test('the camp shoots the screen: a Monarch at 1 HP behind a piece of yours is not struck', () => {
  // The camp's Bone Chanter comes down the middle lane; your knight on it stands between it and the Monarch.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 1), on('bone_chanter', 101, 'foe', 3, 5)])
  unit(b, 0).hp = 1
  const events = order(b, { type: 'end' })
  const shots = events.filter((e) => e.type === 'action' && e.actor === 101)
  assert.ok(shots.length > 0, 'it acts')
  assert.ok(shots.every((e) => !e.targets.includes(0)))
  assert.ok(!b.over && unit(b, 0).hp === 1, 'the Monarch stands')
})

test('the expert reads screens: a screened shooter is no threat to the Monarch, and a move that screens it guards the Monarch', () => {
  // The camp's Bone Chanter at (3,6) can come to (3,4) and bolt the Monarch at (3,0); a knight of yours at (2,1) can
  // step into its line.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 2, 1), on('bone_chanter', 101, 'foe', 3, 6)])
  const sit = situation(b)
  assert.ok(sit.monarch.deals.has(unit(b, 101)) && sit.monarch.danger > 0)
  const opts = expertOptions(b, unit(b, 1))
  const into = opts.find((o) => o.tile === at(3, 1) && !o.ability)
  const aside = opts.find((o) => o.tile === at(1, 1) && !o.ability)
  const v = features(b, unit(b, 1), into, sit)
  assert.equal(v.guard, Math.min(sit.monarch.hp, sit.monarch.danger), 'all of it')
  assert.equal(features(b, unit(b, 1), aside, sit).guard, 0)
  // Once it stands there: the shooter is screened, and the threat read has it strike the knight, never the Monarch.
  order(b, { type: 'move', uid: 1, tile: at(3, 1) })
  const now = situation(b)
  assert.ok(!now.monarch.deals.has(unit(b, 101)) && now.monarch.screened.includes(unit(b, 101)))
  const row = now.threat.d.get(now.threat.foes.find((f) => f.x.uid === 101))
  assert.ok(row.has(unit(b, 1)) && !row.has(unit(b, 0)))
})
