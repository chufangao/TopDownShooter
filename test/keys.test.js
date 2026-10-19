// Keys and locks: a blow keyed to a status deals its multiple on a key laid this turn by another piece of its side and
// spends it; never on its own key, a last turn's, or the other side's; a locked kind takes its lock's share of any blow
// while no key is on it; the previews and the intents say so; the combos ablation switches both off. Functional only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { order, preview, intents, addStatus, keyOn, lockShare } from '../src/sim/turns.js'
import { abilityDef, unitDef } from '../src/content.js'
import { on, scene, unit } from './scene.js'

const keyedBy = (id) => abilityDef(id).effects.find((e) => e.op === 'damage')?.keyed ?? null
const struck = (events, uid) => events.filter((e) => e.type === 'damage' && e.target === uid && !e.status).reduce((n, e) => n + e.damage, 0)

test('the content: a Frost Lance is keyed to Brittle, a Marrow Bolt lays it; the Iron Golem is locked to Brittle; every key is a status', () => {
  assert.deepEqual(keyedBy('frost_lance'), { status: 'brittle', mul: 2 })
  assert.ok(abilityDef('marrow_bolt').effects.some((e) => e.op === 'apply_status' && e.status === 'brittle'))
  assert.deepEqual(unitDef('iron_golem').lock, { keys: ['brittle'], share: 0.3 })
  assert.ok(unitDef('hollow_sovereign').lock.keys.length >= 2, 'the Sovereign is locked')
})

test('a keyed blow: ×2 on a key another piece laid this turn, the key spent; plain on its own key, on a last turn\'s, and with combos ablated', () => {
  const make = (opts = {}) => scene([
    on('monarch', 0, 'party', 3, 0),
    on('bone_chanter', 1, 'party', 3, 3, 10),
    on('frost_sprite', 2, 'party', 2, 3, 10),
    on('tomb_knight', 9, 'foe', 3, 6, 10)
  ], opts)
  // The plain lance first, for the number.
  const plain = make()
  const base = struck(order(plain, { type: 'act', uid: 2, ability: 'frost_lance', target: 9 }), 9)
  assert.ok(base > 0)
  // The chanter's bolt lays Brittle, then the lance: twice the plain lance on the brittler foe, less its lost DEF.
  const b = make()
  order(b, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 9 })
  assert.ok(keyOn(b, unit(b, 2), unit(b, 9), keyedBy('frost_lance')), 'a key for the sprite')
  const p = preview(b, 2, 'frost_lance', 9)
  assert.deepEqual(p.keyed, [{ uid: 9, status: 'brittle', mul: 2 }])
  const events = order(b, { type: 'act', uid: 2, ability: 'frost_lance', target: 9 })
  const keyed = struck(events, 9)
  assert.ok(events.some((e) => e.type === 'key' && e.actor === 2 && e.target === 9 && e.status === 'brittle'))
  assert.ok(keyed >= 2 * base, `keyed ${keyed} against plain ${base}`)
  assert.ok(!unit(b, 9).statuses.some((s) => s.id === 'brittle'), 'the key spent')
  // Its own key is none: the sprite's Shatter Lance lays Brittle, but the sprite cannot pay it.
  const own = make()
  addStatus(own, unit(own, 9), 'brittle', 3, unit(own, 2))
  assert.equal(keyOn(own, unit(own, 2), unit(own, 9), keyedBy('frost_lance')), null)
  // A key laid last turn is none: the sprite acts before the bolt (an untouched sprite would spend the key at End Turn).
  const old = make()
  order(old, { type: 'act', uid: 2, ability: 'frost_lance', target: 9 })
  order(old, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 9 })
  order(old, { type: 'end' })
  assert.ok(unit(old, 9).statuses.some((s) => s.id === 'brittle'), 'Brittle still on it')
  assert.equal(keyOn(old, unit(old, 2), unit(old, 9), keyedBy('frost_lance')), null)
  // Combos ablated: no key for yours; a foe's keyed blow on a key another foe laid still pays.
  const off = make({ ablate: ['combos'] })
  order(off, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 9 })
  assert.equal(keyOn(off, unit(off, 2), unit(off, 9), keyedBy('frost_lance')), null)
  assert.equal(preview(off, 2, 'frost_lance', 9).keyed.length, 0)
  const theirs = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3, 10), on('bone_chanter', 8, 'foe', 3, 5, 10), on('tomb_knight', 9, 'foe', 2, 4, 10)], { ablate: ['combos'] })
  theirs.stage = 'foes'
  addStatus(theirs, unit(theirs, 1), 'brittle', 3, unit(theirs, 8))
  assert.ok(keyOn(theirs, unit(theirs, 9), unit(theirs, 1), keyedBy('strike')), 'the foe knight pays the foe chanter\'s key')
})

test('a locked kind takes its lock\'s share of any blow while no key is on it, all of it once one is; a status tick passes; it stands with combos ablated', () => {
  const make = (opts = {}) => scene([
    on('monarch', 0, 'party', 3, 0),
    on('bone_chanter', 1, 'party', 3, 3, 10),
    on('tomb_knight', 2, 'party', 2, 5, 10),
    on('iron_golem', 9, 'foe', 3, 6, 10)
  ], opts)
  const b = make()
  assert.equal(lockShare(b, unit(b, 9), unit(b, 2)), 0.3)
  const p = preview(b, 2, 'strike', 9)
  assert.deepEqual(p.locked, [9])
  const cut = struck(order(b, { type: 'act', uid: 2, ability: 'strike', target: 9 }), 9)
  const open = make()
  addStatus(open, unit(open, 9), 'brittle', 3, unit(open, 1))
  assert.equal(lockShare(open, unit(open, 9), unit(open, 2)), 1)
  const full = struck(order(open, { type: 'act', uid: 2, ability: 'strike', target: 9 }), 9)
  assert.ok(cut < full && cut <= Math.ceil(full * 0.3 * 1.5), `locked ${cut} against open ${full}`)
  // The lock is the world's: with combos ablated it stands, and no status of yours is a key to it; a foe's blow reads it as ever.
  const off = make({ ablate: ['combos'] })
  addStatus(off, unit(off, 9), 'brittle', 3, unit(off, 1))
  assert.equal(lockShare(off, unit(off, 9), unit(off, 2)), 0.3)
  assert.equal(lockShare(off, unit(off, 9)), 1)
  assert.deepEqual(preview(off, 2, 'strike', 9).locked, [9])
  // Burning's tick is no blow: the lock lets it through whole.
  const tick = make()
  addStatus(tick, unit(tick, 9), 'burning', 3, unit(tick, 1))
  const hp = unit(tick, 9).hp
  order(tick, { type: 'end' })
  const dot = tick.events.filter((e) => e.type === 'damage' && e.target === 9 && e.status === 'burning').reduce((n, e) => n + e.damage, 0)
  assert.ok(dot > 0 && hp - unit(tick, 9).hp >= dot)
  assert.ok(!tick.events.some((e) => e.type === 'locked' && e.target === 9 && e.status))
})

test('the intents tell a key a foe would spend on one of yours, and a lock of theirs your untouched piece would meet', () => {
  const b = scene([
    on('monarch', 0, 'party', 3, 0),
    on('tomb_knight', 1, 'party', 3, 5, 10),
    on('iron_golem', 9, 'foe', 3, 6, 10)
  ])
  const c = intents(b)
  const mine = c.mine.find((x) => x.uid === 1)
  assert.deepEqual([mine.ability, mine.locked], ['strike', [9]])
})
