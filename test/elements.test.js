// The elements of 2026-10-17: ten individual rules a player combines, each one
// relic or status, none a synergy. A hold (Snare: Rooted), strength that grows (Butcher's Hook: Bloodlust), four payoffs
// that read what the foe struck carries (`per` on a damage effect, turns.js runEffect: Powder Keg and Glass Hammer spend
// it, Headsman's Hood and Plague Mask do not), and four Legendary rules (rules.js): an act refunded on a kill (Reaper's
// Hunger), a charge (Seven-League Boots), a glass Monarch (Last Candle) and a horde that bursts (Grave Powder).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { order, perform, applyDamage, addStatus, stats, legalOrders, hexed } from '../src/sim/turns.js'
import { RELICS, STATUSES } from '../src/content.js'
import { alive } from '../src/sim/unit.js'
import { on, scene as sceneOf, unit } from './scene.js'

// A battle of units on tiles, no summons called; the far foe keeps every battle from ending on a wipe.
const scene = (units, opts = {}) => sceneOf([...units, on('iron_golem', 99, 'foe', 6, 10, 1)], { ablate: ['summons'], ...opts })
const monarch = () => on('monarch', 0, 'party', 3, 0)
// Piece `uid` uses its basic on `target`, as an order: → the events.
const basic = (b, uid, target) => order(b, { type: 'act', uid, ability: unit(b, uid).basic.id, target })
// The damage events the relic's effect dealt (no ability: a trigger's), by `actor`.
const dealt = (events, actor) => events.filter((e) => e.type === 'damage' && e.ability === null && e.actor === actor)
const near = (v, w, tol = 0.011) => Math.abs(v / w - 1) <= tol

test('Snare: its holder\'s target is Rooted, Move 0 whatever adds to it, and stands where it is through the foes\' turn', () => {
  const field = (relics) => scene([monarch(), on('frost_sprite', 1, 'party', 3, 1, 3, [0, 0], relics), on('grave_ghoul', 10, 'foe', 3, 4, 9)])
  const b = field(['snare'])
  const ghoul = unit(b, 10)
  const events = basic(b, 1, 10)
  assert.ok(events.some((e) => e.type === 'trigger' && e.relic === 'snare'))
  assert.deepEqual(events.filter((e) => e.type === 'status').map((e) => [e.target, e.status, e.dur]), [[10, 'rooted', 1]])
  assert.equal(stats(b, ghoul).move, 0)
  addStatus(b, ghoul, 'hasten', null, ghoul)
  assert.equal(stats(b, ghoul).move, 0, 'set beats add')
  const was = ghoul.tile
  order(b, { type: 'end' })
  assert.equal(ghoul.tile, was, 'it did not move')
  assert.ok(!ghoul.statuses.some((s) => s.id === 'rooted'), 'for one turn')
  // Without the Snare the same Ghoul walks on toward the Monarch.
  const free = field([])
  basic(free, 1, 10)
  const stood = unit(free, 10).tile
  order(free, { type: 'end' })
  assert.notEqual(unit(free, 10).tile, stood)
  assert.deepEqual([STATUSES.rooted.tags, STATUSES.rooted.turns], [['debuff'], 1])
})

test('Butcher\'s Hook: a kill gives its holder Bloodlust, +6% ATK a stack for the battle, stacking to 8', () => {
  const b = scene([monarch(), on('tomb_knight', 1, 'party', 3, 3, 9, [0, 0], ['butchers_hook']), on('grave_ghoul', 10, 'foe', 2, 4), on('grave_ghoul', 11, 'foe', 4, 4)])
  const knight = unit(b, 1)
  for (const uid of [10, 11]) unit(b, uid).hp = 1
  const atk = stats(b, knight).atk
  const events = basic(b, 1, 10)
  assert.ok(events.some((e) => e.type === 'trigger' && e.relic === 'butchers_hook'))
  assert.deepEqual(knight.statuses.map((s) => [s.id, s.stacks, s.dur]), [['bloodlust', 1, 'battle']])
  assert.ok(near(stats(b, knight).atk, atk * 1.06), `${stats(b, knight).atk} against ${atk * 1.06}`)
  knight.acted = false
  basic(b, 1, 11)
  assert.deepEqual(knight.statuses.map((s) => [s.id, s.stacks]), [['bloodlust', 2]])
  assert.ok(near(stats(b, knight).atk, atk * 1.06 ** 2))
  for (let i = 0; i < 10; i++) addStatus(b, knight, 'bloodlust', null, knight)
  assert.equal(knight.statuses[0].stacks, STATUSES.bloodlust.stacks)
})

// The payoffs, each on a Tomb Knight's basic at an Iron Golem (DEF 30: the relic's damage is true, DEF nothing to it).
const struck = (relic, lay) => {
  const b = scene([monarch(), on('tomb_knight', 1, 'party', 3, 3, 9, [0, 0], [relic]), on('iron_golem', 10, 'foe', 3, 4, 9)])
  const golem = unit(b, 10)
  lay(b, golem)
  const hp = golem.hp
  const events = basic(b, 1, 10)
  const blow = events.find((e) => e.type === 'damage' && e.ability !== null)
  return { b, golem, events, extra: dealt(events, 1), lost: hp - golem.hp - blow.damage }
}

test('Powder Keg: 10 true damage a stack of Burning on the foe struck, and the fire goes out; nothing on a foe not burning', () => {
  const { golem, events, extra, lost } = struck('powder_keg', (b, g) => { for (let i = 0; i < 3; i++) addStatus(b, g, 'burning', null, unit(b, 1)) })
  assert.deepEqual(extra.map((e) => [e.target, e.damage]), [[10, 30]])
  assert.equal(lost, 30)
  assert.ok(!golem.statuses.some((s) => s.id === 'burning'), 'spent')
  assert.deepEqual(events.filter((e) => e.type === 'cleanse').map((e) => [e.target, e.status]), [[10, 'burning']])
  const cold = struck('powder_keg', () => {})
  assert.deepEqual([cold.extra, cold.lost], [[], 0])
  assert.deepEqual(RELICS.powder_keg.effects, [{ op: 'damage', amount: 10, per: { status: 'burning' }, consume: true, to: 'other' }])
})

test('Glass Hammer: 12 true damage a stack of Brittle, the Brittle spent', () => {
  const { golem, extra } = struck('glass_hammer', (b, g) => { addStatus(b, g, 'brittle', null, unit(b, 1)); addStatus(b, g, 'brittle', null, unit(b, 1)) })
  assert.deepEqual(extra.map((e) => e.damage), [24])
  assert.ok(!golem.statuses.some((s) => s.id === 'brittle'))
})

test('Headsman\'s Hood: 25 true damage more to a Hexed foe, the Hex left on it; nothing to one unhexed', () => {
  const { golem, extra } = struck('headsmans_hood', (b, g) => addStatus(b, g, 'hexed', null, unit(b, 1)))
  assert.deepEqual(extra.map((e) => e.damage), [25])
  assert.ok(hexed(golem), 'not spent')
  assert.deepEqual(struck('headsmans_hood', () => {}).extra, [])
})

test('Plague Mask: 8 true damage for each harmful status on the foe, a stack counted once, a buff not at all', () => {
  const lay = (b, g) => {
    for (const id of ['brittle', 'withered', 'burning', 'burning', 'barkskin']) addStatus(b, g, id, null, unit(b, 1))
  }
  const { golem, extra } = struck('plague_mask', lay)
  assert.deepEqual(extra.map((e) => e.damage), [24])
  assert.equal(golem.statuses.length, 4, 'nothing spent')
})

test('Reaper\'s Hunger: a kill in your turn gives its holder its act again, as often as it slays; never a kill outside your orders', () => {
  const b = scene([monarch(), on('tomb_knight', 1, 'party', 3, 3, 9, [0, 0], ['reapers_hunger']), on('grave_ghoul', 10, 'foe', 2, 4), on('grave_ghoul', 11, 'foe', 4, 4)])
  const knight = unit(b, 1)
  for (const uid of [10, 11]) unit(b, uid).hp = 1
  const first = basic(b, 1, 10)
  assert.ok(first.some((e) => e.type === 'rule' && e.rule === 'reapers_hunger' && e.actor === 1 && e.target === 10))
  assert.equal(knight.acted, false)
  const again = legalOrders(b).find((o) => o.type === 'act' && o.uid === 1 && o.target === 11)
  assert.ok(again, 'it may act again')
  order(b, again)
  assert.ok(!alive(unit(b, 11)) && knight.acted === false)
  // A kill in the foes' turn (a counter's, say) refunds nothing.
  const foes = scene([monarch(), on('tomb_knight', 1, 'party', 3, 3, 9, [0, 0], ['reapers_hunger']), on('grave_ghoul', 10, 'foe', 2, 4)])
  unit(foes, 10).hp = 1
  foes.phase = 'resolving'
  foes.stage = 'foes'
  const from = foes.events.length
  perform(foes, unit(foes, 1), unit(foes, 1).basic, unit(foes, 10))
  assert.ok(!alive(unit(foes, 10)) && unit(foes, 1).acted === true)
  assert.ok(!foes.events.slice(from).some((e) => e.type === 'rule'))
})

test('Seven-League Boots: a blow deals half again on a turn its holder has moved 3 tiles or more, not after 2', () => {
  // A Frost Sprite (Move 3, Frost Lance at 3) against a Golem at (3, 6): from (3, 4) in reach, from (3, 1) only after a move of 3.
  const shoot = (y, relics) => {
    const b = scene([monarch(), on('frost_sprite', 1, 'party', 3, y, 3, [0, 0], relics), on('iron_golem', 10, 'foe', 3, 6, 9)])
    if (y !== 4) order(b, { type: 'move', uid: 1, tile: unit(b, 10).tile - 2 * 7 })
    assert.equal(unit(b, 1).moved, 4 - y)
    return basic(b, 1, 10).find((e) => e.type === 'damage').damage
  }
  const plain = shoot(4, [])
  assert.equal(shoot(4, ['seven_league_boots']), plain, 'standing still')
  assert.equal(shoot(2, ['seven_league_boots']), plain, 'two tiles')
  const far = shoot(1, ['seven_league_boots'])
  assert.ok(near(far, plain * RELICS.seven_league_boots.params.mul, 0.1), `${far} against ${plain} × 1.5`)
  assert.equal(shoot(1, []), plain, 'without the boots a move is no charge')
})

test('Last Candle: while the Monarch is below half, its holder is Desperate as each of your turns begins; mended past it, the candle goes out', () => {
  const b = scene([monarch(), on('tomb_knight', 1, 'party', 3, 2, 9, [0, 0], ['last_candle'])])
  const m = unit(b, 0)
  const knight = unit(b, 1)
  m.hp = Math.floor(m.maxHp * 0.4)
  const events = order(b, { type: 'end' })
  assert.ok(events.some((e) => e.type === 'rule' && e.rule === 'last_candle' && e.actor === 1))
  assert.deepEqual(knight.statuses.map((s) => [s.id, s.dur]), [['desperate', 1]])
  assert.ok(stats(b, knight).damage.dealt > 1.4)
  m.hp = m.maxHp
  order(b, { type: 'end' })
  assert.ok(!knight.statuses.some((s) => s.id === 'desperate'), 'out')
})

test('Grave Powder: while its holder stands, a shadow of yours that falls bursts, 20 true damage to every foe beside it, the holder\'s blow', () => {
  const field = () => {
    const b = scene([monarch(), on('tomb_knight', 1, 'party', 3, 2, 9, [0, 0], ['grave_powder']), on('grave_ghoul', 2, 'party', 3, 4), on('iron_golem', 10, 'foe', 3, 5, 9), on('grave_ghoul', 11, 'foe', 2, 5, 9), on('will_o_wisp', 12, 'foe', 3, 8, 9)])
    unit(b, 2).shadow = true
    return b
  }
  const b = field()
  const from = b.events.length
  applyDamage(b, unit(b, 2), 9999, { actor: unit(b, 10) })
  const ev = b.events.slice(from)
  assert.ok(ev.some((e) => e.type === 'rule' && e.rule === 'grave_powder' && e.actor === 1 && e.target === 2))
  assert.deepEqual(dealt(ev, 1).map((e) => [e.target, e.damage]).sort(), [[10, 20], [11, 20]], 'beside it, not the Wisp three tiles off')
  // The holder fallen, nothing bursts; nor does a soul of yours that is no shadow.
  const down = field()
  unit(down, 1).hp = 0
  const at = down.events.length
  applyDamage(down, unit(down, 2), 9999, { actor: unit(down, 10) })
  assert.deepEqual(dealt(down.events.slice(at), 1), [])
  const soul = field()
  unit(soul, 2).shadow = false
  const since = soul.events.length
  applyDamage(soul, unit(soul, 2), 9999, { actor: unit(soul, 10) })
  assert.deepEqual(dealt(soul.events.slice(since), 1), [])
})
