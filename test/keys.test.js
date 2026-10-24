// Keys and locks: a blow keyed to a status deals its multiple on a key laid this turn, in its side's own turn, by
// another piece of its side and spends it; never on its own key, a last turn's, the other side's, nor in the other
// side's turn (a counter); a locked foe takes its lock's share of all damage but a status's tick unless such a key is on
// it, which opening spends not; a lock stands on foes alone; the previews, the intents and the foes' reckoning say so;
// the combos ablation switches both off for yours; the Brass Sentry is a floor-1 lock a floor-1 soul keys. The numbers
// are the content's (a lock's share, a blow's multiple), never the test's. Functional only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { order, preview, intents, addStatus, keyOn, lockShare, applyDamage, perform } from '../src/sim/turns.js'
import { estimate, NOBODY } from '../src/sim/foe.js'
import { abilityDef, unitDef, RELICS, UNITS, ABILITIES } from '../src/content.js'
import { unkeyed, laysKey, spawnPool } from '../src/sim/spawn.js'
import { makeUnit, tileAt } from '../src/sim/unit.js'
import { on, scene, unit } from './scene.js'

const keyedBy = (id) => abilityDef(id).effects.find((e) => e.op === 'damage')?.keyed ?? null
// The content's numbers: the Iron Golem's lock's share, the Frost Lance's multiple on its key.
const GOLEM = UNITS.iron_golem.lock.share
const LANCE = ABILITIES.frost_lance.effects.find((e) => e.op === 'damage').keyed.mul
const struck = (events, uid) => events.filter((e) => e.type === 'damage' && e.target === uid && !e.status).reduce((n, e) => n + e.damage, 0)

test('the content: a Frost Lance is keyed to Brittle, a Marrow Bolt lays it; the Iron Golem is locked to Brittle; every key is a status', () => {
  assert.equal(keyedBy('frost_lance').status, 'brittle')
  assert.ok(LANCE > 1, 'a keyed blow pays more than one blow')
  assert.ok(abilityDef('marrow_bolt').effects.some((e) => e.op === 'apply_status' && e.status === 'brittle'))
  assert.deepEqual(unitDef('iron_golem').lock.keys, ['brittle'])
  assert.ok(GOLEM > 0 && GOLEM < 1, 'a lock cuts, never shuts')
  assert.ok(unitDef('hollow_sovereign').lock.keys.length >= 2, 'the Sovereign is locked')
})

test('a keyed blow: its multiple on a key another piece laid this turn, the key spent; plain on its own key, on a last turn\'s, and with combos ablated', () => {
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
  // The chanter's bolt lays Brittle, then the lance: its multiple of the plain lance on the brittler foe, less its lost DEF.
  const b = make()
  order(b, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 9 })
  assert.ok(keyOn(b, unit(b, 2), unit(b, 9), keyedBy('frost_lance')), 'a key for the sprite')
  const p = preview(b, 2, 'frost_lance', 9)
  assert.deepEqual(p.keyed, [{ uid: 9, status: 'brittle', mul: LANCE }])
  const events = order(b, { type: 'act', uid: 2, ability: 'frost_lance', target: 9 })
  const keyed = struck(events, 9)
  assert.ok(events.some((e) => e.type === 'key' && e.actor === 2 && e.target === 9 && e.status === 'brittle'))
  assert.ok(keyed >= LANCE * base, `keyed ${keyed} against plain ${base}`)
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

test('a locked kind takes its lock\'s share of a blow while no key for the striker is on it, all of it once one is; a status tick passes; it stands with combos ablated', () => {
  const make = (opts = {}) => scene([
    on('monarch', 0, 'party', 3, 0),
    on('bone_chanter', 1, 'party', 3, 3, 10),
    on('tomb_knight', 2, 'party', 2, 5, 10),
    on('iron_golem', 9, 'foe', 3, 6, 10)
  ], opts)
  const b = make()
  assert.equal(lockShare(b, unit(b, 9), unit(b, 2)), GOLEM)
  const p = preview(b, 2, 'strike', 9)
  assert.deepEqual(p.locked, [9])
  const cut = struck(order(b, { type: 'act', uid: 2, ability: 'strike', target: 9 }), 9)
  const open = make()
  addStatus(open, unit(open, 9), 'brittle', 3, unit(open, 1))
  assert.equal(lockShare(open, unit(open, 9), unit(open, 2)), 1)
  const full = struck(order(open, { type: 'act', uid: 2, ability: 'strike', target: 9 }), 9)
  assert.ok(cut < full && cut <= Math.ceil(full * GOLEM * 1.5), `locked ${cut} against open ${full}`)
  // The lock is the world's: with combos ablated it stands, and no status of yours is a key to it; damage with no
  // actor meets it too.
  const off = make({ ablate: ['combos'] })
  addStatus(off, unit(off, 9), 'brittle', 3, unit(off, 1))
  assert.equal(lockShare(off, unit(off, 9), unit(off, 2)), GOLEM)
  assert.equal(lockShare(off, unit(off, 9)), GOLEM)
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

test('a keyed blow that misses spends no key and tells none: the key waits for a blow that lands, the preview as the blow', () => {
  // Four fae foes: Mirage stands on their side, so each piece's first blow at them in the battle misses.
  const b = scene([
    on('monarch', 0, 'party', 3, 0), on('bone_chanter', 1, 'party', 3, 3, 10), on('frost_sprite', 2, 'party', 2, 3, 10),
    on('thornling', 9, 'foe', 3, 6, 10), on('frost_sprite', 10, 'foe', 0, 9, 1), on('will_o_wisp', 11, 'foe', 1, 9, 1), on('frost_sprite', 12, 'foe', 6, 9, 1)
  ])
  // The chanter's first blow was foiled before: its bolt lands, and the Brittle it lays is a key for the sprite.
  unit(b, 1).foiled = true
  order(b, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 9 })
  assert.ok(keyOn(b, unit(b, 2), unit(b, 9), keyedBy('frost_lance')))
  const p = preview(b, 2, 'frost_lance', 9)
  assert.deepEqual([p.damage, p.keyed], [0, []])
  const events = order(b, { type: 'act', uid: 2, ability: 'frost_lance', target: 9 })
  assert.ok(events.some((e) => e.type === 'miss' && e.target === 9), 'the lance misses')
  assert.ok(!events.some((e) => e.type === 'key'), 'no key told')
  assert.ok(unit(b, 9).statuses.some((s) => s.id === 'brittle'), 'the key still on it')
})

test('a room\'s locked kind is keyed by a relic that lays its key, and a soul\'s summons are pieces of their own', () => {
  const room = { type: 'fight', foes: [{ id: 'rot_bloat', lvl: 1 }] }
  const soul = (id, uid, relics = [], tracks = [0, 0]) => ({ ...makeUnit(id, { uid, lvl: 1, tracks }), relics })
  assert.deepEqual(unkeyed(room, [soul('tomb_knight', 1), soul('tomb_knight', 2)]).map((x) => x.id), ['rot_bloat'], 'nothing lays Burning')
  assert.deepEqual(unkeyed(room, [soul('tomb_knight', 1, ['firebrand']), soul('tomb_knight', 2)]), [], 'Firebrand lays it')
  // In battle the Firebrand blow lays Burning, and the bloat's lock is open to the other knight.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4, 3, [0, 0], ['firebrand']), on('tomb_knight', 2, 'party', 2, 4, 3), on('rot_bloat', 9, 'foe', 3, 5, 1)])
  unit(b, 9).hp = unit(b, 9).maxHp = 9999
  order(b, { type: 'act', uid: 1, ability: 'strike', target: 9 })
  assert.equal(lockShare(b, unit(b, 9), unit(b, 2)), 1)
  // One soul alone has no second piece to pay a key; one that summons has.
  const golem = { type: 'fight', foes: [{ id: 'iron_golem', lvl: 1 }] }
  assert.deepEqual(unkeyed(golem, [soul('bone_chanter', 1)]).map((x) => x.id), ['iron_golem'])
  const summoner = soul('bone_chanter', 1, [], [0, 2])
  const b2 = scene([on('monarch', 0, 'party', 3, 0), on('bone_chanter', 1, 'party', 3, 3, 1, [0, 2]), on('iron_golem', 9, 'foe', 3, 6, 1)])
  assert.ok(b2.units.filter((u) => u.summoner === 1).length >= 1, 'its summons stand')
  assert.deepEqual(unkeyed(golem, [summoner]), [])
})

// A Bone Chanter's bolt lays Brittle, the Iron Golem's key; a Will-o'-Wisp's Witchfire (keyed to Burning) meets the
// lock and spends nothing of it; a Frost Sprite's lance is keyed to Brittle. The Golem lasts; the Hag is the other side.
const lockScene = () => {
  const b = scene([
    on('monarch', 0, 'party', 3, 0),
    on('bone_chanter', 1, 'party', 3, 3, 10),
    on('will_o_wisp', 2, 'party', 2, 3, 10),
    on('frost_sprite', 3, 'party', 4, 3, 10),
    on('iron_golem', 9, 'foe', 3, 6, 10),
    on('marsh_hag', 8, 'foe', 6, 9, 1)
  ])
  unit(b, 9).hp = unit(b, 9).maxHp = 9999
  return b
}
const brittle = (u) => u.statuses.some((s) => s.id === 'brittle')
const locked = (events, actor) => events.some((e) => e.type === 'locked' && e.actor === actor)
const reckon = (b, uid, ability, target) => estimate(b, unit(b, uid), { tile: unit(b, uid).tile, ability: abilityDef(ability), target: unit(b, target) }, NOBODY).damage

test('a lock opens only on a real key: laid this turn by another of the striker\'s side; never its own, a last turn\'s, nor the other side\'s; opening spends none, a keyed blow opens and pays', () => {
  // No key: the Witchfire is cut, as the preview and the foes' reckoning say.
  const shut = lockScene()
  const p = preview(shut, 2, 'witchfire', 9)
  const est = reckon(shut, 2, 'witchfire', 9)
  const cut = order(shut, { type: 'act', uid: 2, ability: 'witchfire', target: 9 })
  assert.ok(locked(cut, 2))
  assert.deepEqual([struck(cut, 9), est, p.locked], [p.damage, p.damage, [9]])
  // The chanter's Brittle, laid this turn: a key for the wisp, which its Witchfire opens and leaves on it.
  const open = lockScene()
  order(open, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 9 })
  assert.equal(lockShare(open, unit(open, 9), unit(open, 2)), 1)
  const q = preview(open, 2, 'witchfire', 9)
  const whole = order(open, { type: 'act', uid: 2, ability: 'witchfire', target: 9 })
  assert.ok(!locked(whole, 2) && q.locked.length === 0, 'open')
  assert.ok(struck(cut, 9) < q.damage)
  assert.equal(struck(whole, 9), q.damage)
  assert.ok(brittle(unit(open, 9)), 'opening spends no key')
  // A blow keyed to it both opens the lock and pays: its multiple, the key spent.
  const pays = order(open, { type: 'act', uid: 3, ability: 'frost_lance', target: 9 })
  assert.ok(!locked(pays, 3) && pays.some((e) => e.type === 'key' && e.actor === 3 && e.status === 'brittle'))
  assert.ok(!brittle(unit(open, 9)), 'the payoff spends it')
  // Its own key opens nothing to the one that laid it.
  const own = lockScene()
  order(own, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 9 })
  assert.deepEqual([lockShare(own, unit(own, 9), unit(own, 1)), lockShare(own, unit(own, 9), unit(own, 2))], [GOLEM, 1])
  // A key laid last turn: opened in End Turn's untouched pass (your turn still), shut on the next.
  const last = lockScene()
  order(last, { type: 'act', uid: 3, ability: 'frost_lance', target: 9 })
  order(last, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 9 })
  const ended = order(last, { type: 'end' })
  const mine = ended.slice(0, ended.findIndex((e) => e.type === 'stage' && e.stage === 'foes'))
  assert.ok(mine.some((e) => e.type === 'action' && e.actor === 2 && e.primary === 9) && !locked(mine, 2), 'the untouched wisp\'s Witchfire, opened')
  assert.ok(brittle(unit(last, 9)), 'Brittle still on it')
  assert.equal(lockShare(last, unit(last, 9), unit(last, 2)), GOLEM)
  // The other side's Brittle opens nothing to yours.
  const other = lockScene()
  addStatus(other, unit(other, 9), 'brittle', 3, unit(other, 8))
  assert.equal(lockShare(other, unit(other, 9), unit(other, 2)), GOLEM)
})

test('a lock cuts all damage but a status\'s tick: a relic\'s, a rule\'s and any with no blow, opened by the same key', () => {
  const share = GOLEM
  // Momentum on the wisp: a tile walked, then its Witchfire; the relic's 6 a tile is cut unless the chanter's key opens it.
  const momentum = (key) => {
    const b = scene([on('monarch', 0, 'party', 3, 0), on('bone_chanter', 1, 'party', 3, 3, 10), on('will_o_wisp', 2, 'party', 2, 2, 10, [0, 0], ['momentum']), on('iron_golem', 9, 'foe', 3, 6, 10)])
    unit(b, 9).hp = unit(b, 9).maxHp = 9999
    if (key) order(b, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 9 })
    order(b, { type: 'move', uid: 2, tile: tileAt(2, 3) })
    return order(b, { type: 'act', uid: 2, ability: 'witchfire', target: 9 }).filter((e) => e.type === 'damage' && e.ability === null && e.actor === 2).map((e) => e.damage)
  }
  assert.deepEqual([momentum(false), momentum(true)], [[Math.round(6 * share)], [6]])
  // Grave Powder: a shadow of yours falls beside the Golem; its holder's burst is cut the same way.
  const powder = (key) => {
    const b = scene([on('monarch', 0, 'party', 3, 0), on('bone_chanter', 1, 'party', 3, 2, 10), on('tomb_knight', 4, 'party', 1, 2, 10, [0, 0], ['grave_powder']), on('grave_ghoul', 5, 'party', 3, 5, 3), on('iron_golem', 9, 'foe', 3, 6, 10)], { ablate: ['summons'] })
    unit(b, 9).hp = unit(b, 9).maxHp = 9999
    unit(b, 5).shadow = true
    if (key) order(b, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 9 })
    const from = b.events.length
    applyDamage(b, unit(b, 5), 9999, { actor: unit(b, 9) })
    return b.events.slice(from).filter((e) => e.type === 'damage' && e.target === 9 && e.actor === 4).map((e) => e.damage)
  }
  const burst = RELICS.grave_powder.params.amount
  assert.deepEqual([powder(false), powder(true)], [[Math.round(burst * share)], [burst]])
  // Damage with no blow at all: its share with no key, whole with one, whole as a status's tick.
  const b = lockScene()
  const g = unit(b, 9)
  const hp = () => g.hp
  let was = hp()
  applyDamage(b, g, 100, { actor: unit(b, 2) })
  assert.equal(was - hp(), Math.round(100 * share))
  was = hp()
  applyDamage(b, g, 100, { actor: unit(b, 2), status: 'burning' })
  assert.equal(was - hp(), 100, 'a tick passes')
  order(b, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 9 })
  was = hp()
  applyDamage(b, g, 100, { actor: unit(b, 2) })
  assert.equal(was - hp(), 100, 'a key opens it')
})

test('a key pays and opens only in its striker\'s own turn: a counter in the other side\'s meets the lock and pays none; End Turn\'s untouched pass is yours', () => {
  // Your knight beside the Golem, the chanter's Brittle on it.
  const make = () => {
    const b = scene([on('monarch', 0, 'party', 3, 0), on('bone_chanter', 1, 'party', 3, 3, 10), on('tomb_knight', 2, 'party', 3, 5, 10), on('iron_golem', 9, 'foe', 3, 6, 10)])
    for (const uid of [2, 9]) unit(b, uid).hp = unit(b, uid).maxHp = 9999
    order(b, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 9 })
    return b
  }
  // In your turn its Strike opens the lock and pays the key...
  const mine = make()
  const paid = order(mine, { type: 'act', uid: 2, ability: 'strike', target: 9 })
  assert.ok(paid.some((e) => e.type === 'key' && e.actor === 2) && !locked(paid, 2))
  // ...answering the Golem's blow in the foes' turn it meets the lock and pays nothing: the key stays.
  const theirs = make()
  theirs.phase = 'resolving'
  theirs.stage = 'foes'
  const golem = unit(theirs, 9)
  const from = theirs.events.length
  perform(theirs, golem, golem.basic, unit(theirs, 2))
  const ev = theirs.events.slice(from)
  const at = ev.findIndex((e) => e.type === 'action' && e.counter && e.actor === 2)
  assert.ok(at >= 0, 'the knight answers')
  assert.ok(locked(ev.slice(at), 2) && !ev.some((e) => e.type === 'key'))
  assert.ok(brittle(golem), 'the key stays')
  // A foe's keyed counter in your turn pays no key another foe laid in it.
  const foe = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 2, 'party', 3, 5, 10), on('tomb_knight', 9, 'foe', 3, 6, 10), on('bone_chanter', 8, 'foe', 5, 9, 10)])
  addStatus(foe, unit(foe, 2), 'brittle', 3, unit(foe, 8))
  assert.equal(keyOn(foe, unit(foe, 9), unit(foe, 2), keyedBy('strike')), null)
  const struckBack = order(foe, { type: 'act', uid: 2, ability: 'strike', target: 9 })
  assert.ok(struckBack.some((e) => e.type === 'action' && e.counter && e.actor === 9), 'the foe knight answers')
  assert.ok(!struckBack.some((e) => e.type === 'key') && brittle(unit(foe, 2)))
  // End Turn's untouched pass is yours: the sprite left alone spends the chanter's key, as its intent says.
  const end = scene([on('monarch', 0, 'party', 3, 0), on('bone_chanter', 1, 'party', 3, 3, 10), on('frost_sprite', 3, 'party', 4, 3, 10), on('iron_golem', 9, 'foe', 3, 6, 10)])
  unit(end, 9).hp = unit(end, 9).maxHp = 9999
  order(end, { type: 'act', uid: 1, ability: 'marrow_bolt', target: 9 })
  const read = intents(end).mine.find((x) => x.uid === 3)
  assert.deepEqual([read.keyed, read.locked], [[{ uid: 9, status: 'brittle', mul: LANCE }], []])
  const played = order(end, { type: 'end' })
  assert.ok(played.slice(0, played.findIndex((e) => e.type === 'stage' && e.stage === 'foes')).some((e) => e.type === 'key' && e.actor === 3 && e.target === 9))
})

test('a lock stands on foes alone: a locked kind of yours takes a foe\'s blow whole, as the foes reckon it', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('iron_golem', 1, 'party', 3, 5, 10), on('tomb_knight', 9, 'foe', 3, 6, 10)])
  assert.equal(lockShare(b, unit(b, 1), unit(b, 9)), 1)
  b.phase = 'resolving'
  b.stage = 'foes'
  const est = reckon(b, 9, 'strike', 1)
  const from = b.events.length
  perform(b, unit(b, 9), unit(b, 9).basic, unit(b, 1))
  const ev = b.events.slice(from)
  const answer = ev.findIndex((e) => e.type === 'action' && e.counter)
  assert.ok(!ev.some((e) => e.type === 'locked'))
  assert.equal(struck(ev.slice(0, answer < 0 ? ev.length : answer), 1), est)
})

// The Brass Sentry, a floor-1 kind, is locked to a key a floor-1 kind lays from its first tier (the Grave Ghoul's Gnaw):
// unkeyed it takes its share, a slog; the Ghoul's Brittle laid this turn opens it to the Frost Sprite, whose lance deals
// its multiple and spends the key; the Map's unkeyed reads it as any lock.
test('the Brass Sentry: a floor-1 lock a floor-1 soul keys; its share unkeyed, a keyed blow\'s multiple once opened; unkeyed reports it', () => {
  const lock = UNITS.brass_sentry.lock
  const pool = spawnPool(1).units
  assert.ok(pool.some((d) => d.id === 'brass_sentry'), 'the Sentry comes on floor 1')
  assert.ok(lock && lock.share > 0 && lock.share < 1, 'a lock that cuts, never shuts')
  const fresh = (id, uid) => ({ ...makeUnit(id, { uid, lvl: 1, tracks: [0, 0] }), relics: [] })
  const layers = pool.filter((d) => lock.keys.some((k) => laysKey(fresh(d.id, 1), k))).map((d) => d.id)
  assert.ok(layers.includes('grave_ghoul') && UNITS.grave_ghoul.tier === 1, `floor 1's key-layers: ${layers}`)
  assert.ok(lock.keys.includes(keyedBy('frost_lance').status) && pool.some((d) => d.id === 'frost_sprite'), 'a floor-1 blow keyed to it')
  // The Map's hint: no key laid, or one soul alone to lay it and strike; a key-layer and a second soul key it.
  const room = { type: 'fight', foes: [{ id: 'brass_sentry', lvl: 1 }] }
  assert.deepEqual(unkeyed(room, [fresh('will_o_wisp', 1), fresh('frost_sprite', 2)]), [{ id: 'brass_sentry', keys: lock.keys }])
  assert.deepEqual(unkeyed(room, [fresh('grave_ghoul', 1)]).map((x) => x.id), ['brass_sentry'], 'one soul alone')
  assert.deepEqual(unkeyed(room, [fresh('grave_ghoul', 1), fresh('frost_sprite', 2)]), [])
  // In battle: the Ghoul beside the Sentry, the Sprite three rows back.
  const make = () => {
    const b = scene([on('monarch', 0, 'party', 3, 0), on('grave_ghoul', 1, 'party', 3, 5, 10), on('frost_sprite', 2, 'party', 2, 3, 10), on('brass_sentry', 9, 'foe', 3, 6, 10)])
    unit(b, 9).hp = unit(b, 9).maxHp = 9999
    return b
  }
  const lance = { type: 'act', uid: 2, ability: 'frost_lance', target: 9 }
  // Unkeyed: its share of any blow, the lance cut as its preview says.
  const shut = make()
  assert.equal(lockShare(shut, unit(shut, 9), unit(shut, 2)), lock.share)
  const was = unit(shut, 9).hp
  applyDamage(shut, unit(shut, 9), 100, { actor: unit(shut, 2) })
  assert.equal(was - unit(shut, 9).hp, Math.round(100 * lock.share))
  const p = preview(shut, 2, 'frost_lance', 9)
  assert.deepEqual([p.locked, p.keyed], [[9], []])
  const cutEvents = order(shut, lance)
  const cut = struck(cutEvents, 9)
  assert.ok(locked(cutEvents, 2) && cut > 0 && cut === p.damage, `cut ${cut}`)
  // Keyed: the Ghoul's Gnaw lays Brittle; the lance opens the lock, deals its multiple and spends the key.
  const open = make()
  order(open, { type: 'act', uid: 1, ability: 'gnaw', target: 9 })
  assert.ok(brittle(unit(open, 9)))
  assert.equal(lockShare(open, unit(open, 9), unit(open, 2)), 1)
  const q = preview(open, 2, 'frost_lance', 9)
  assert.deepEqual([q.locked, q.keyed], [[], [{ uid: 9, status: 'brittle', mul: LANCE }]])
  const paidEvents = order(open, lance)
  const paid = struck(paidEvents, 9)
  assert.ok(!locked(paidEvents, 2) && paidEvents.some((e) => e.type === 'key' && e.actor === 2 && e.target === 9 && e.status === 'brittle'))
  assert.equal(paid, q.damage)
  assert.ok(paid >= LANCE * (cut - 1) / lock.share, `keyed ${paid} against locked ${cut}`)
  assert.ok(!brittle(unit(open, 9)), 'the payoff spends it')
})
