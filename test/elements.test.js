// The elements of 2026-10-17: ten individual rules a player combines, each one
// relic or status, none a synergy. A hold (Snare: Rooted), strength that grows (Butcher's Hook: Bloodlust), four payoffs
// that read what the foe struck carries (`per` on a damage effect, turns.js runEffect: Powder Keg and Glass Hammer spend
// it, Headsman's Hood and Plague Mask do not), and four Legendary rules (rules.js): a turn begun again on a kill (Reaper's
// Hunger), a charge (Seven-League Boots), a candle burning (Last Candle) and a horde that bursts (Grave Powder).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { order, perform, applyDamage, addStatus, stats, legalOrders, hexed, enterBattle, stride } from '../src/sim/turns.js'
import { RELICS, STATUSES } from '../src/content.js'
import { alive, makeUnit, tileAt } from '../src/sim/unit.js'
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

// The payoffs, each on a Tomb Knight's basic at a foe Tomb Knight (DEF 22: the relic's damage is true, DEF nothing to
// it; no lock, which would cut it: keys.test.js).
const struck = (relic, lay) => {
  const b = scene([monarch(), on('tomb_knight', 1, 'party', 3, 3, 9, [0, 0], [relic]), on('tomb_knight', 10, 'foe', 3, 4, 9)])
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

test('Reaper\'s Hunger: a kill in your turn begins its holder\'s turn again, as often as it slays; never a kill outside your orders', () => {
  const b = scene([monarch(), on('tomb_knight', 1, 'party', 3, 3, 9, [0, 0], ['reapers_hunger']), on('grave_ghoul', 10, 'foe', 2, 4), on('grave_ghoul', 11, 'foe', 4, 4)])
  const knight = unit(b, 1)
  for (const uid of [10, 11]) unit(b, uid).hp = 1
  const first = basic(b, 1, 10)
  assert.ok(first.some((e) => e.type === 'rule' && e.rule === 'reapers_hunger' && e.actor === 1 && e.target === 10))
  assert.deepEqual([knight.acted, knight.spent], [false, 0], 'its act and its whole energy')
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

test('Seven-League Boots: its holder has +1 Move, and a blow deals half again on a turn it has moved 2 tiles or more, not after 1', () => {
  // A Frost Sprite (Move 3, Frost Lance at 3) against a Golem at (3, 6): from (3, 4) in reach, from (3, 2) after a move of 2.
  const field = (y, relics) => scene([monarch(), on('frost_sprite', 1, 'party', 3, y, 3, [0, 0], relics), on('iron_golem', 10, 'foe', 3, 6, 9)])
  const shoot = (y, relics) => {
    const b = field(y, relics)
    if (y !== 4) order(b, { type: 'move', uid: 1, tile: unit(b, 10).tile - 2 * 7 })
    assert.equal(unit(b, 1).moved, 4 - y)
    return basic(b, 1, 10).find((e) => e.type === 'damage').damage
  }
  const plain = shoot(4, [])
  assert.equal(RELICS.seven_league_boots.params.tiles, 2)
  assert.equal(shoot(4, ['seven_league_boots']), plain, 'standing still')
  assert.equal(shoot(3, ['seven_league_boots']), plain, 'one tile')
  const charge = shoot(2, ['seven_league_boots'])
  assert.ok(near(charge, plain * RELICS.seven_league_boots.params.mul, 0.1), `${charge} against ${plain} × 1.5`)
  assert.equal(shoot(2, []), plain, 'without the boots a move is no charge')
  // +1 Move: a tile more in its energy, so a tile more it may walk and still strike.
  const pace = (relics) => {
    const b = field(1, relics)
    const u = unit(b, 1)
    return [stats(b, u).move, u.energy, stride(u)]
  }
  const [move, energy, steps] = pace([])
  assert.deepEqual(pace(['seven_league_boots']), [move + 1, energy + 1, steps + 1])
  // Shod, 4 tiles from (3, 1) to (3, 5), and its blow still paid for, half again.
  const b = field(1, ['seven_league_boots'])
  order(b, { type: 'move', uid: 1, tile: tileAt(3, 5) })
  assert.equal(unit(b, 1).moved, 4)
  assert.ok(near(basic(b, 1, 10).find((e) => e.type === 'damage').damage, charge, 0.1))
})

test('Last Candle: its holder is Enraged for the battle from your first turn, the Monarch full; while the Monarch is below half, Desperate too as each of your turns begins; mended past it, the Desperate goes out', () => {
  const field = (relics) => scene([monarch(), on('tomb_knight', 1, 'party', 3, 2, 9, [0, 0], relics)])
  const b = field(['last_candle'])
  const m = unit(b, 0)
  const knight = unit(b, 1)
  assert.equal(m.hp, m.maxHp)
  assert.ok(b.events.some((e) => e.type === 'rule' && e.rule === 'last_candle' && e.actor === 1), 'lit as the battle begins')
  assert.deepEqual(knight.statuses.map((s) => [s.id, s.dur]), [['enraged', 'battle']])
  // Enraged on turn 1: its ATK, and its Move in this turn's energy.
  const bare = field([])
  const plain = unit(bare, 1)
  assert.ok(near(stats(b, knight).atk, stats(bare, plain).atk * 1.35))
  assert.deepEqual([stats(b, knight).move, knight.energy], [stats(bare, plain).move + 1, plain.energy + 1])
  m.hp = Math.floor(m.maxHp * 0.4)
  const events = order(b, { type: 'end' })
  assert.ok(events.some((e) => e.type === 'rule' && e.rule === 'last_candle' && e.actor === 1))
  assert.deepEqual(knight.statuses.map((s) => [s.id, s.dur]), [['enraged', 'battle'], ['desperate', 1]])
  assert.ok(stats(b, knight).damage.dealt > 1.4)
  m.hp = m.maxHp
  order(b, { type: 'end' })
  assert.deepEqual(knight.statuses.map((s) => s.id), ['enraged'], 'the Desperate out, the Enraged burning on')
  assert.equal(b.events.filter((e) => e.type === 'status' && e.status === 'enraged').length, 1, 'lit once')
})

test('Grave Powder: while its holder stands, a shadow of yours that falls bursts, 40 true damage to every foe within 2 tiles, the holder\'s blow', () => {
  const field = () => {
    const b = scene([monarch(), on('tomb_knight', 1, 'party', 3, 2, 9, [0, 0], ['grave_powder']), on('grave_ghoul', 2, 'party', 3, 4), on('tomb_knight', 10, 'foe', 3, 5, 9), on('grave_ghoul', 11, 'foe', 2, 5, 9),
      on('will_o_wisp', 12, 'foe', 3, 8, 9), on('clockwork_page', 13, 'foe', 5, 6, 9)])
    unit(b, 2).shadow = true
    return b
  }
  const b = field()
  const from = b.events.length
  applyDamage(b, unit(b, 2), 9999, { actor: unit(b, 10) })
  const ev = b.events.slice(from)
  assert.ok(ev.some((e) => e.type === 'rule' && e.rule === 'grave_powder' && e.actor === 1 && e.target === 2))
  const { amount, range } = RELICS.grave_powder.params
  assert.deepEqual([amount, range], [40, 2])
  assert.deepEqual(dealt(ev, 1).map((e) => [e.target, e.damage]).sort(), [[10, amount], [11, amount], [13, amount]], 'beside it and 2 tiles off, not the Wisp four tiles off')
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

// ── a miss lays nothing ──────────────────────────────────────────────────────────────────────────

// Four fae foes, Mirage on their side (rules.js mirage): each piece's first blow at them in the battle misses. The
// thornling in front is too tough to fall.
const faeFoes = (party) => {
  const b = scene([monarch(), ...party, on('thornling', 9, 'foe', 3, 6, 10), on('frost_sprite', 10, 'foe', 0, 9, 1), on('will_o_wisp', 11, 'foe', 1, 9, 1), on('frost_sprite', 12, 'foe', 5, 9, 1)])
  unit(b, 9).hp = unit(b, 9).maxHp = 9999
  return b
}
// Piece `uid` may act again this turn (the tests' shortcut past a turn's end).
const again = (b, uid) => Object.assign(unit(b, uid), { acted: false, spent: 0 })
const kinds = (events, type) => events.filter((e) => e.type === type)

test('Mirage foils each foe\'s first blow a battle and not its second; the miss lays no status and fires no relic, the hit both', () => {
  const b = faeFoes([on('bone_chanter', 1, 'party', 3, 3, 10, [0, 0], ['snare'])])
  const thornling = unit(b, 9)
  // The Marrow Bolt lays Brittle and the Snare Roots, but on a blow that lands.
  const miss = basic(b, 1, 9)
  assert.deepEqual(kinds(miss, 'miss').map((e) => [e.actor, e.target]), [[1, 9]])
  assert.deepEqual([kinds(miss, 'damage'), kinds(miss, 'status'), kinds(miss, 'trigger')], [[], [], []])
  assert.deepEqual(thornling.statuses, [])
  again(b, 1)
  const hit = basic(b, 1, 9)
  assert.ok(kinds(hit, 'damage').some((e) => e.actor === 1 && e.target === 9 && e.damage > 0), 'the second lands')
  assert.ok(!kinds(hit, 'miss').length)
  assert.deepEqual(kinds(hit, 'trigger').map((e) => e.relic), ['snare'])
  assert.deepEqual(thornling.statuses.map((s) => s.id).sort(), ['brittle', 'rooted'])
  // Turns on, the chanter's blows still land: a foe's one first blow, the battle's.
  b.turn++
  again(b, 1)
  assert.ok(kinds(basic(b, 1, 9), 'damage').some((e) => e.actor === 1 && e.damage > 0))
  assert.equal(b.events.filter((e) => e.type === 'rule' && e.rule === 'mirage').length, 1)
})

test('a blast at a Mirage side misses one target and hits the rest, each on its own: the missed one alone takes nothing', () => {
  // The wyvern's Cinder Breath (Burning on whom it hits) at the thornling, two more fae beside it; its Firebrand sets the
  // one it strikes Burning.
  const b = faeFoes([on('ash_wyvern', 1, 'party', 3, 4, 10, [0, 0], ['firebrand'])])
  for (const [uid, x] of [[13, 2], [14, 4]]) enterBattle(b, { ...makeUnit('thornling', { uid, lvl: 10 }), side: 'foe', tile: tileAt(x, 6) })
  const events = order(b, { type: 'act', uid: 1, ability: 'cinder_breath', target: 9 })
  assert.deepEqual(kinds(events, 'miss').map((e) => e.target), [9], 'the first blow, on the one it strikes')
  assert.deepEqual(kinds(events, 'damage').filter((e) => e.actor === 1).map((e) => e.target), [13, 14])
  const burning = (uid) => unit(b, uid).statuses.find((s) => s.id === 'burning')?.stacks ?? 0
  // The blow landed on the rest: the Firebrand is told, but lays nothing on the one it missed.
  assert.deepEqual(kinds(events, 'trigger').map((e) => e.relic), ['firebrand'])
  assert.deepEqual([9, 13, 14].map(burning), [0, 1, 1])
})

test('a status-only act at a Mirage side lands and leaves the foe\'s first blow to be foiled; a blow at one of yours that misses fires none of your relics, and is countered', () => {
  // An act that lays only a status (none in the content yet): it lands, and Mirage waits for the chanter's first damage.
  const b = faeFoes([on('bone_chanter', 1, 'party', 3, 3, 10)])
  const mark = { id: 'test_mark', shape: 'single', range: 9, effects: [{ op: 'apply_status', status: 'withered' }] }
  perform(b, unit(b, 1), mark, unit(b, 9))
  assert.ok(unit(b, 9).statuses.some((s) => s.id === 'withered'))
  again(b, 1)
  assert.ok(kinds(basic(b, 1, 9), 'miss').length, 'its first damage is foiled')
  // Mirage on your side: a thornling of yours holding Grave Bell (its attacker Withered when it is struck), and its
  // counter (a melee blow at it answered).
  const c = scene([
    monarch(), on('thornling', 1, 'party', 3, 4, 10, [0, 0], ['grave_bell']), on('frost_sprite', 2, 'party', 1, 2), on('will_o_wisp', 3, 'party', 2, 2), on('frost_sprite', 4, 'party', 4, 2),
    on('tomb_knight', 10, 'foe', 3, 5, 10)
  ])
  const knight = unit(c, 10)
  const strike = () => {
    const from = c.events.length
    c.stage = 'foes'
    knight.acted = false
    perform(c, knight, knight.basic, unit(c, 1))
    c.stage = 'party'
    return c.events.slice(from)
  }
  const missed = strike()
  assert.ok(kinds(missed, 'miss').some((e) => e.actor === 10 && e.target === 1))
  assert.deepEqual(kinds(missed, 'trigger'), [])
  assert.ok(missed.some((e) => e.type === 'action' && e.actor === 1 && e.counter), 'countered all the same')
  assert.ok(!knight.statuses.some((s) => s.id === 'withered'))
  const struck = strike()
  assert.deepEqual(kinds(struck, 'trigger').map((e) => e.relic), ['grave_bell'])
  assert.ok(knight.statuses.some((s) => s.id === 'withered'))
})
