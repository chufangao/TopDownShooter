// Relics (redesign.md §2.11, §2.15): four tiers, bought in Shops; a run relic works unheld and its copies stack, a piece
// relic works only through the soul holding it (its mods, its moments, a Legendary's rule scoped to it), at most
// TUNING.relic.perPiece a soul, given and taken back out of battle; Arise a skill its holder learns. The Monarch's HP and
// Command are run relics alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, order, playOut, playTurns, preview, perform, stats, corpses, ariseOf as ariseIn, synergiesOf, timelineHash, legalOrders } from '../src/sim/turns.js'
import { expertTurn, basicTurn } from '../src/sim/policy.js'
import {
  createRun, apply, battleSetup, fieldCap, rosterCap, souls, monarchOf, fielded, legalActions, join, reapedShadows, encounter,
  relicCount, ariseHeld, relicWeights, replay, tierCost, ariseOf, monarchHp, commandOf, isRunPath, floorPrice, shopOffers, relicTier,
  unheld, canHold, isRunRelic, fuseParts, OSSUARY, START_PARTY
} from '../src/sim/run.js'
import { policy, planFor, LEVELS, autoplay, offerState } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { tuned, relicMod } from './tuned.js'
import { RELIC_LIST, RELICS } from '../src/content.js'
import { makeUnit, alive, baseStats, footprint } from '../src/sim/unit.js'
import { on, scene as sceneOf, slay, unit, turns } from './scene.js'
import { visit, win, fight } from './rooms.js'

// Legion's mods on your souls (its Command is the run's: run.js RUN_PATHS).
const LEGION = RELICS.legion.mods.filter((m) => !isRunPath(m.path))
const LEGENDARIES = RELIC_LIST.filter((r) => r.tier === 'legendary').map((r) => r.id)

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

// A battle of units placed on tiles (scene.js scene), no summons called (the scenes set every piece themselves).
const scene = (units, opts = {}) => sceneOf(units, { ablate: ['summons'], ...opts })
// A foe's act on the board as it stands (as its own turn would give it). → its events.
function strike (b, uid, target) {
  const u = unit(b, uid)
  const from = b.events.length
  b.stage = 'foes'
  u.acted = false
  perform(b, u, u.basic, unit(b, target))
  b.stage = 'party'
  return b.events.slice(from)
}
// The events after the first matching `first`.
const after = (events, first) => {
  const i = events.findIndex(first)
  assert.ok(i >= 0, 'the moment came')
  return events.slice(i + 1)
}
// A run on its first room of `type`, a soul of each start kind fielded.
const runIn = (seed, type = 'fight') => {
  const run = createRun({ start: START_PARTY, seed })
  visit(run, type)
  return run
}
const soul = (run, id) => souls(run.state.party).find((u) => u.id === id)

// ── holding (§2.15) ──────────────────────────────────────────────────────────────────────────────

test('hold and unhold: a piece relic bought waits unheld; a soul holds at most perPiece, one copy each; a hold onto a full soul swaps; never the Monarch; never in battle', () => {
  const run = runIn('hold')
  const s = run.state
  s.relics = ['whetstone', 'whetstone', 'heartwood', 'grave_banner']
  assert.deepEqual(unheld(s), ['whetstone', 'whetstone', 'heartwood'], 'a run relic is never unheld: it works as it is')
  const [knight, chanter] = ['tomb_knight', 'bone_chanter'].map((id) => soul(run, id))
  const holds = () => legalActions(run).filter((a) => a.type === 'hold')
  assert.deepEqual(new Set(holds().map((a) => a.relic)), new Set(['whetstone', 'heartwood']))
  assert.ok(!holds().some((a) => a.uid === monarchOf(s).uid || a.relic === 'grave_banner'))
  apply(run, { type: 'hold', relic: 'whetstone', uid: knight.uid })
  assert.deepEqual([knight.relics, unheld(s)], [['whetstone'], ['whetstone', 'heartwood']])
  // At the cap, a hold swaps: the first it held goes back.
  apply(run, { type: 'hold', relic: 'heartwood', uid: knight.uid })
  assert.deepEqual([knight.relics, unheld(s).sort()], [['heartwood'], ['whetstone', 'whetstone']])
  assert.equal(TUNING.relic.perPiece, 1)
  tuned({ relic: { ...TUNING.relic, perPiece: 2 } }, () => {
    apply(run, { type: 'hold', relic: 'whetstone', uid: knight.uid })
    assert.deepEqual(knight.relics, ['heartwood', 'whetstone'])
    assert.ok(!canHold(s, 'whetstone', knight), 'one copy a holder: copies are more holders')
    apply(run, { type: 'unhold', uid: knight.uid, relic: 'heartwood' })
    assert.deepEqual(knight.relics, ['whetstone'])
  })
  apply(run, { type: 'hold', relic: 'whetstone', uid: chanter.uid })
  assert.deepEqual(unheld(s), ['heartwood'])
  assert.throws(() => apply(run, { type: 'hold', relic: 'whetstone', uid: knight.uid }), /cannot hold/, 'no copy left unheld')
  assert.throws(() => apply(run, { type: 'hold', relic: 'heartwood', uid: monarchOf(s).uid }), /cannot hold/)
  apply(run, { type: 'unhold', uid: knight.uid })
  assert.deepEqual([knight.relics, unheld(s).sort()], [[], ['heartwood', 'whetstone']])
  assert.throws(() => apply(run, { type: 'unhold', uid: knight.uid }), /holds no/)
  // In battle: no hold, no unhold.
  apply(run, { type: 'fight' })
  assert.equal(s.phase, 'battle')
  assert.ok(!legalActions(run).some((a) => a.type === 'hold' || a.type === 'unhold'))
  assert.throws(() => apply(run, { type: 'hold', relic: 'heartwood', uid: knight.uid }), /no order/)
  assert.throws(() => apply(run, { type: 'unhold', uid: chanter.uid }), /no order/)
})

test('a held relic comes back unheld when its holder is released or fused away; a fallen holder keeps it', () => {
  const run = runIn('return')
  const s = run.state
  s.essence = 1e4
  s.relics = ['whetstone', 'heartwood', 'glass_crown']
  const knight = soul(run, 'tomb_knight')
  apply(run, { type: 'hold', relic: 'whetstone', uid: knight.uid })
  apply(run, { type: 'release', uid: knight.uid })
  assert.deepEqual(unheld(s).sort(), ['glass_crown', 'heartwood', 'whetstone'])
  // Fused away, out of battle: the relics its parts held come back; the fused piece holds none.
  const parts = [join(run, 'tomb_knight'), join(run, 'tomb_knight')]
  apply(run, { type: 'hold', relic: 'heartwood', uid: parts[0].uid })
  apply(run, { type: 'fuse', id: 'bone_colossus', parts: fuseParts(run, 'bone_colossus') })
  const colossus = soul(run, 'bone_colossus')
  assert.ok(colossus && !colossus.relics?.length)
  assert.deepEqual(unheld(s).sort(), ['glass_crown', 'heartwood', 'whetstone'])
  // A fallen holder keeps it.
  const sprite = soul(run, 'frost_sprite')
  apply(run, { type: 'hold', relic: 'glass_crown', uid: sprite.uid })
  sprite.hp = 0
  sprite.slot = OSSUARY
  assert.deepEqual([sprite.relics, unheld(s).includes('glass_crown')], [['glass_crown'], false])
  // (Fused away in battle, the parts' relics come back as the battle ends: run.test.js.)
})

test('a piece relic works only through its holder: its mods on the holder, its moments the holder\'s; unheld, it does nothing', () => {
  const run = runIn('through')
  const s = run.state
  s.relics = ['whetstone', 'blood_chalice']
  const atk = (b, id) => stats(b, b.units.find((u) => u.id === id)).atk
  const bare = createBattle(battleSetup(run))
  const knight = soul(run, 'tomb_knight')
  apply(run, { type: 'hold', relic: 'whetstone', uid: knight.uid })
  const held = createBattle(battleSetup(run))
  const w = RELICS.whetstone.mods[0].v
  assert.ok(Math.abs(atk(held, 'tomb_knight') - atk(bare, 'tomb_knight') * w) < 1e-6, 'the holder')
  assert.equal(atk(held, 'bone_chanter'), atk(bare, 'bone_chanter'), 'no one else')
  assert.equal(atk(held, 'monarch'), atk(bare, 'monarch'))
  // A trigger fires on its holder's kill, never another's.
  const kill = (relics, killer) => {
    const b = scene([on('tomb_knight', 1, 'party', 3, 6, 9, [0, 0], relics), on('tomb_knight', 2, 'party', 2, 6, 9), on('grave_ghoul', 10, 'foe', 3, 7, 1),
      on('iron_golem', 50, 'foe', 6, 10)])
    for (const u of [1, 2]) unit(b, u).hp = 50
    unit(b, 10).hp = 1
    return order(b, { type: 'act', uid: killer, ability: 'strike', target: 10 })
  }
  assert.ok(kill(['blood_chalice'], 1).some((e) => e.type === 'trigger' && e.relic === 'blood_chalice'))
  assert.ok(!kill(['blood_chalice'], 2).some((e) => e.type === 'trigger'), 'the other knight\'s kill')
  // Unheld, a piece relic does nothing in battle.
  const none = createBattle({ ...battleSetup(runIn('through')), relics: ['whetstone'] })
  assert.ok(none.units.every((u) => !u.relicMods?.length))
})

test('a run relic works unheld: its side-wide cost on every soul (never the Monarch), its Command and HP the run\'s; its copies stack', () => {
  const run = runIn('run-relic')
  const s = run.state
  s.relics = ['legion', 'legion', 'grave_banner']
  assert.deepEqual(unheld(s), [])
  assert.equal(fieldCap(run), TUNING.party.field + 5)
  const setup = battleSetup(run)
  assert.deepEqual(setup.partyMods, [...LEGION, ...LEGION])
  const b = createBattle(setup)
  const knight = b.units.find((u) => u.id === 'tomb_knight')
  assert.equal(knight.maxHp, Math.round(soul(run, 'tomb_knight').maxHp * LEGION[0].v * LEGION[0].v))
  assert.equal(b.monarch.maxHp, monarchOf(s).maxHp)
  assert.ok(!legalActions(run).some((a) => a.type === 'hold'), 'nothing to hold')
})

// ── trigger relics: the holder's moments ─────────────────────────────────────────────────────────

// The 'kill' moment: a lvl-9 knight (uid 1, wounded, holding `relics`) slays a Ghoul (10) at 1 HP; another Ghoul (11)
// stands next to the slain's tile, a third (12) far off.
function killing (relics) {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 6, 9, [0, 0], relics),
    on('grave_ghoul', 10, 'foe', 3, 7, 1), on('grave_ghoul', 11, 'foe', 4, 8, 1), on('grave_ghoul', 12, 'foe', 0, 10, 1)])
  unit(b, 1).hp = 50
  unit(b, 10).hp = 1
  const events = order(b, { type: 'act', uid: 1, ability: 'strike', target: 10 })
  return { b, next: after(events, (e) => e.type === 'death' && e.target === 10) }
}

test('Blood Chalice: when its holder slays a foe, it heals 15% of its max HP', () => {
  const { b, next } = killing(['blood_chalice'])
  const knight = unit(b, 1)
  assert.deepEqual(next.slice(0, 2).map(({ beat, ...e }) => e), [
    { type: 'trigger', relic: 'blood_chalice', on: 'kill', unit: 1 },
    { type: 'heal', actor: 1, target: 1, heal: Math.round(knight.maxHp * RELICS.blood_chalice.effects[0].pct), hp: next[1].hp }
  ])
  assert.ok(!killing([]).next.some((e) => e.type === 'heal' || e.type === 'trigger'))
})

test("Hunter's Mark: when its holder slays a foe, the foes next to the slain turn Brittle, and no one else", () => {
  const { next } = killing(['hunters_mark'])
  assert.equal(next[0].relic, 'hunters_mark')
  assert.deepEqual(next.filter((e) => e.type === 'status' && e.status === 'brittle').map((e) => e.target), [11])
})

// The 'fall' moment: a Ghoul (2, holding `relics`) at 1 HP beside a foe knight; a wounded knight (1) of yours within 2
// tiles of it, a Sprite (3) far away.
function falling (relics) {
  const b = scene([on('monarch', 0, 'party', 0, 0), on('tomb_knight', 1, 'party', 4, 4), on('grave_ghoul', 2, 'party', 3, 5, 1, [0, 0], relics),
    on('frost_sprite', 3, 'party', 6, 1), on('tomb_knight', 10, 'foe', 3, 6, 9)])
  unit(b, 1).hp = 40
  unit(b, 2).hp = 1
  return { b, next: after(strike(b, 10, 2), (e) => e.type === 'death' && e.target === 2) }
}

test('War Drum and Balm: when its holder falls, your side within 2 tiles of it gains Hasten, or heals 18% of its max HP', () => {
  const drum = falling(['war_drum']).next
  assert.equal(drum[0].relic, 'war_drum')
  assert.deepEqual(drum.filter((e) => e.type === 'status' && e.status === 'hasten').map((e) => e.target), [1], 'the knight beside, not the Sprite far off')
  const { b, next } = falling(['balm'])
  assert.deepEqual(next.filter((e) => e.type === 'heal').map((e) => [e.target, e.heal]), [[1, Math.round(unit(b, 1).maxHp * RELICS.balm.effects[0].pct)]])
})

// The 'struck' moment: a Wisp (10) shoots a knight of yours (1, holding `relics`) beside the Monarch; a Sprite (3)
// far off.
function striking (relics) {
  const b = scene([on('monarch', 0, 'party', 3, 1), on('tomb_knight', 1, 'party', 3, 2, 3, [0, 0], relics), on('frost_sprite', 3, 'party', 6, 0),
    on('will_o_wisp', 10, 'foe', 3, 4, 1)])
  return { b, next: after(strike(b, 10, 1), (e) => e.type === 'damage' && e.target === 1) }
}

test('Iron Oath and Grave Bell: when its holder is struck, your side within 2 tiles of it gains Barkskin, or its attacker is Withered', () => {
  const oath = striking(['iron_oath']).next
  assert.equal(oath[0].relic, 'iron_oath')
  assert.deepEqual(oath.filter((e) => e.type === 'status' && e.status === 'barkskin').map((e) => e.target).sort(), [0, 1], 'it and the Monarch, not the Sprite')
  const bell = striking(['grave_bell']).next
  assert.deepEqual(bell.filter((e) => e.type === 'status').map((e) => [e.target, e.status]), [[10, 'withered']])
  // A fatal blow is no 'struck'.
  const b = scene([on('tomb_knight', 1, 'party', 3, 2, 3, [0, 0], ['grave_bell']), on('will_o_wisp', 10, 'foe', 3, 4, 9), on('iron_golem', 11, 'foe', 6, 10)])
  unit(b, 1).hp = 1
  assert.ok(!strike(b, 10, 1).some((e) => e.type === 'trigger'))
})

test('Shielded: the same blow lands 40% lighter', () => {
  const blow = (shielded) => {
    const b = scene([on('tomb_knight', 1, 'party', 3, 6, 3), on('frost_wyrm', 10, 'foe', 3, 8, 24)])
    if (shielded) b.byUid.get(1).statuses.push({ id: 'shield', dur: 'battle', stacks: 1 })
    return strike(b, 10, 1).find((e) => e.type === 'damage' && e.target === 1).damage
  }
  const [bare, shielded] = [blow(false), blow(true)]
  assert.ok(bare >= 60, `a big enough blow: ${bare}`)
  assert.ok(Math.abs(shielded - bare * 0.6) <= 1, `${shielded} vs ${bare}`)
})

test('Tower Shield: as the battle begins and as each later wave enters, while its holder stands, your side within 2 tiles of it is Shielded; Rally Horn: when its holder strikes, your side about it is Hastened', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 2, 3, [0, 0], ['tower_shield']), on('frost_sprite', 2, 'party', 3, 3), on('frost_sprite', 3, 'party', 6, 6),
    on('iron_golem', 10, 'foe', 6, 10)], { reserve: [{ ...makeUnit('grave_ghoul', { uid: 20, lvl: 1 }), side: 'foe', wave: 1, lane: 0 }] })
  const shielded = (events) => events.filter((e) => e.type === 'status' && e.status === 'shield').map((e) => e.target).sort()
  assert.deepEqual(shielded(b.events), [0, 1, 2], 'at the start: within 2 of its holder')
  const later = []
  while (!b.over && !later.some((e) => e.type === 'wave')) later.push(...turns(b))
  assert.ok(later.some((e) => e.type === 'trigger' && e.relic === 'tower_shield'), 'and as the wave enters')
  const horn = scene([on('tomb_knight', 1, 'party', 3, 5, 9, [0, 0], ['rally_horn']), on('frost_sprite', 2, 'party', 3, 4), on('frost_sprite', 3, 'party', 0, 0),
    on('iron_golem', 10, 'foe', 3, 6, 9)])
  const ev = order(horn, { type: 'act', uid: 1, ability: 'strike', target: 10 })
  assert.deepEqual(ev.filter((e) => e.type === 'status' && e.status === 'hasten').map((e) => e.target).sort(), [1, 2])
})

// ── the twelve that define a build (redesign.md §4.4) ───────────────────────────────────────────

// A kin banner works unheld on every soul of its kin (unit.js statsOf reads its `who`), never on another's, the
// Monarch's or a foe's; its copies stack. A scene's pieces each a kin, the run's partyMods given them.
test('the kin banners: run relics on their kin alone, unheld, copies stacking: a Drake gains, a non-Drake and a foe Drake do not', () => {
  const run = runIn('banners')
  const s = run.state
  s.relics = ['wyrm_standard', 'wyrm_standard', 'barrow_standard', 'brass_standard', 'gossamer_standard', 'hive_standard']
  assert.deepEqual(unheld(s), [], 'nothing to hold')
  const setup = battleSetup(run)
  assert.deepEqual(setup.partyMods, s.relics.flatMap((id) => RELICS[id].mods))
  // Hound (Drake), Knight (Undead), Page (Construct), Hag (Fae), Drone (Insect); a foe Hound and a Golem far off.
  const kinds = { 1: 'pyre_hound', 2: 'tomb_knight', 3: 'clockwork_page', 4: 'marsh_hag', 5: 'hive_drone' }
  const units = [on('monarch', 0, 'party', 3, 0), ...Object.entries(kinds).map(([uid, id]) => on(id, Number(uid), 'party', Number(uid), 2)),
    on('pyre_hound', 10, 'foe', 1, 10), on('iron_golem', 11, 'foe', 6, 10)]
  const bare = scene(units)
  const b = scene(units, { partyMods: setup.partyMods })
  const st = (x, uid) => stats(x, unit(x, uid))
  // What each banner moves, on its kin and on no one else.
  const moved = (uid) => ['atk', 'hp', 'move', 'damage.taken', 'cooldown.rate'].filter((k) => k === 'hp'
    ? unit(b, uid).maxHp !== unit(bare, uid).maxHp
    : k.includes('.') ? st(b, uid)[k.split('.')[0]][k.split('.')[1]] !== st(bare, uid)[k.split('.')[0]][k.split('.')[1]] : st(b, uid)[k] !== st(bare, uid)[k])
  assert.deepEqual([1, 2, 3, 4, 5, 0, 10, 11].map(moved), [['atk'], ['hp'], ['damage.taken'], ['cooldown.rate'], ['move'], [], [], []])
  assert.ok(Math.abs(st(b, 1).atk - st(bare, 1).atk * 1.25 * 1.25) < 1e-6, 'two Wyrm Standards: +25% ATK twice over')
  assert.equal(unit(b, 2).maxHp, Math.round(unit(bare, 2).maxHp * 1.2))
  assert.deepEqual([+(st(b, 3).damage.taken / st(bare, 3).damage.taken).toFixed(6), st(b, 4).cooldown.rate, st(b, 5).move - st(bare, 5).move], [0.9, 2, 1])
  // In play: a blow on the Construct lands 10% lighter; the Fae's skill rests no turn.
  const blow = (mods) => {
    const x = scene([on('clockwork_page', 1, 'party', 3, 6, 3), on('frost_wyrm', 10, 'foe', 3, 8, 24)], { partyMods: mods })
    return strike(x, 10, 1).find((e) => e.type === 'damage' && e.target === 1).damage
  }
  assert.ok(Math.abs(blow(RELICS.brass_standard.mods) - blow([]) * 0.9) <= 1, `${blow(RELICS.brass_standard.mods)} vs ${blow([])}`)
  const rested = (mods) => {
    const x = scene([on('marsh_hag', 1, 'party', 3, 5, 5), on('iron_golem', 10, 'foe', 3, 8, 9), on('iron_golem', 11, 'foe', 6, 10)], { partyMods: mods })
    order(x, { type: 'act', uid: 1, ability: 'hex', target: 10 })
    order(x, { type: 'end' })
    return unit(x, 1).cooldowns.hex
  }
  assert.deepEqual([rested([]), rested(RELICS.gossamer_standard.mods)], [1, 0], 'Hex rests a turn, but not under the Gossamer Standard')
})

// The 'blow' moment: a lvl-9 knight of yours (1, holding `relics`, wounded) strikes a Golem (10) beside it that stands;
// its own skill (Cleave) or its basic.
function blowing (relics, ability = 'strike') {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 6, 9, [0, 0], relics), on('iron_golem', 10, 'foe', 3, 7, 9),
    on('iron_golem', 11, 'foe', 6, 10)])
  unit(b, 1).hp = 50
  return { b, events: order(b, { type: 'act', uid: 1, ability, target: 10 }) }
}

test('Firebrand, Leech Fang and Quicksilver: when its holder strikes, its target is set Burning, it heals 10% of its max HP, or its skills come back a turn sooner', () => {
  const fire = blowing(['firebrand']).events
  assert.deepEqual(after(fire, (e) => e.type === 'trigger' && e.relic === 'firebrand').filter((e) => e.type === 'status').map((e) => [e.target, e.status]), [[10, 'burning']])
  assert.ok(!killing(['firebrand']).next.some((e) => e.type === 'status'), 'a blow that fells its target sets no one alight')
  const { b, events } = blowing(['leech_fang'])
  const heal = after(events, (e) => e.type === 'trigger' && e.relic === 'leech_fang')[0]
  assert.deepEqual([heal.type, heal.target, heal.heal], ['heal', 1, Math.round(unit(b, 1).maxHp * RELICS.leech_fang.effects[0].pct)])
  // Cleave rests a turn (2), the trigger brings it a turn sooner (1): ready again after the turn's end, where it rests one more.
  const rest = (relics) => {
    const x = blowing(relics, 'cleave')
    const turns = x.events.filter((e) => e.type === 'cooldown' && e.target === 1).map((e) => e.turns)
    order(x.b, { type: 'end' })
    return [turns, unit(x.b, 1).cooldowns.cleave]
  }
  assert.deepEqual(rest(['quicksilver']), [[2, 1], 0])
  assert.deepEqual(rest([]), [[2], 1])
})

test('Briar Mail: when its holder is struck, its attacker takes 12 true damage, its DEF and ATK nothing to it; a fatal blow is no strike back', () => {
  const { next } = striking(['briar_mail'])
  assert.deepEqual(next.slice(0, 2).map(({ beat, hp, ...e }) => e), [
    { type: 'trigger', relic: 'briar_mail', on: 'struck', unit: 1 },
    { type: 'damage', actor: 1, target: 10, damage: RELICS.briar_mail.effects[0].amount, ability: null }
  ])
  // A Golem (DEF 30, at level 9) takes as much as the Wisp did; the knight's counter follows.
  const b = scene([on('tomb_knight', 1, 'party', 3, 5, 9, [0, 0], ['briar_mail']), on('iron_golem', 10, 'foe', 3, 6, 9), on('iron_golem', 11, 'foe', 6, 10)])
  const ev = after(strike(b, 10, 1), (e) => e.type === 'trigger' && e.relic === 'briar_mail')
  assert.deepEqual([ev[0].type, ev[0].target, ev[0].damage], ['damage', 10, 12])
  const dead = scene([on('tomb_knight', 1, 'party', 3, 2, 3, [0, 0], ['briar_mail']), on('will_o_wisp', 10, 'foe', 3, 4, 9), on('iron_golem', 11, 'foe', 6, 10)])
  unit(dead, 1).hp = 1
  assert.ok(!strike(dead, 10, 1).some((e) => e.type === 'trigger'))
})

test("Raider's Spur and Rowan Charm: its holder gains Hasten when it slays a foe; your side within 2 tiles of it gains Barkskin as each wave comes", () => {
  const spur = killing(['raiders_spur']).next
  assert.deepEqual(spur.slice(0, 2).map((e) => [e.type, e.relic ?? e.status, e.target ?? e.unit]), [['trigger', 'raiders_spur', 1], ['status', 'hasten', 1]])
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 2, 3, [0, 0], ['rowan_charm']), on('frost_sprite', 2, 'party', 3, 3), on('frost_sprite', 3, 'party', 6, 6),
    on('iron_golem', 10, 'foe', 6, 10)], { reserve: [{ ...makeUnit('grave_ghoul', { uid: 20, lvl: 1 }), side: 'foe', wave: 1, lane: 0 }] })
  const bark = (events) => events.filter((e) => e.type === 'status' && e.status === 'barkskin').map((e) => e.target).sort()
  assert.deepEqual(bark(b.events), [0, 1, 2], 'at the start: within 2 of its holder')
  const later = []
  while (!b.over && !later.some((e) => e.type === 'wave')) later.push(...turns(b))
  assert.ok(later.some((e) => e.type === 'trigger' && e.relic === 'rowan_charm'), 'and as the wave enters')
})

// The raise op with a `tier` (Gravedigger's Spade): the slain of that tier or lower rises as yours, as Legion would raise
// it (turns.js risable), and Legion finds it risen.
test("Gravedigger's Spade: when its holder slays a foe of tier 1, the slain rises at once as your shadow; a tier 2 stays down; Legion raises it no second time", () => {
  const { b, next } = killing(['gravediggers_spade'])
  assert.equal(next[0].relic, 'gravediggers_spade')
  const rise = next.find((e) => e.type === 'arise')
  assert.deepEqual([rise.actor, rise.corpse, rise.unit.side, rise.unit.id], [1, 10, 'party', 'grave_ghoul'])
  assert.ok(unit(b, rise.unit.uid).shadow && alive(unit(b, rise.unit.uid)) && unit(b, 10).raised)
  assert.ok(!killing([]).next.some((e) => e.type === 'arise'), 'held by no one, no one rises')
  // A Pyre Hound (tier 2) slain stays down.
  const hound = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 6, 9, [0, 0], ['gravediggers_spade']), on('pyre_hound', 10, 'foe', 3, 7, 1),
    on('iron_golem', 11, 'foe', 6, 10)])
  unit(hound, 10).hp = 1
  const ev = order(hound, { type: 'act', uid: 1, ability: 'strike', target: 10 })
  assert.ok(ev.some((e) => e.type === 'trigger' && e.relic === 'gravediggers_spade') && !ev.some((e) => e.type === 'arise'))
  // Under Legion (four Undead of yours), the Spade's holder raises the slain first, and Legion leaves it be.
  const legion = (relics) => {
    const x = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 6, 9, [0, 0], relics), ...[0, 1, 2].map((k) => on('grave_ghoul', 2 + k, 'party', k, 1)),
      on('grave_ghoul', 10, 'foe', 3, 7, 1), on('iron_golem', 11, 'foe', 6, 10)])
    unit(x, 10).hp = 1
    return order(x, { type: 'act', uid: 1, ability: 'strike', target: 10 }).filter((e) => e.type === 'arise').map((e) => [e.corpse, e.rule ?? null])
  }
  assert.deepEqual(legion(['gravediggers_spade']), [[10, null]])
  assert.deepEqual(legion([]), [[10, 'legion']])
})

// A Shop stocks the twelve as it stocks every relic: by its tier's weights, at its tier's price.
test('the Shop stocks the twelve by their tiers, each at its tier\'s price', () => {
  const twelve = ['wyrm_standard', 'brass_standard', 'barrow_standard', 'gossamer_standard', 'hive_standard', 'gravediggers_spade', 'firebrand', 'briar_mail',
    'leech_fang', 'quicksilver', 'rowan_charm', 'raiders_spur']
  for (const tier of ['common', 'uncommon', 'rare']) {
    tuned({ relic: { ...TUNING.relic, weights: { shop: [{ common: 0, uncommon: 0, rare: 0, [tier]: 1 }] } } }, () => {
      const seen = new Set()
      for (let i = 0; i < 60; i++) {
        const run = createRun({ start: START_PARTY, seed: `twelve-${tier}-${i}` })
        visit(run, 'shop')
        for (const o of shopOffers(run)) {
          assert.equal(o.tier, tier, o.id)
          assert.equal(o.cost, Math.round(TUNING.shop.price[tier] * floorPrice(1)), o.id)
          seen.add(o.id)
        }
      }
      assert.deepEqual(twelve.filter((id) => RELICS[id].tier === tier && !seen.has(id)), [], `${tier}: every one stocked`)
    })
  }
})

// ── the Legendaries, scoped to their holders ─────────────────────────────────────────────────────

test('Undying: its holder rises where it fell at its share of HP, once a battle; one beside it holding none stays down; a soul that bursts and rises still counts', () => {
  const b = scene([on('rot_bloat', 1, 'party', 3, 5, 3, [0, 0], ['undying']), ...[0, 1, 2].map((x) => on('grave_ghoul', 2 + x, 'party', x, 3)), on('grave_ghoul', 5, 'party', 4, 5),
    on('tomb_knight', 10, 'foe', 3, 6, 20), on('iron_golem', 11, 'foe', 6, 10)])
  const bloat = unit(b, 1)
  bloat.hp = 1
  const ev = strike(b, 10, 1)
  assert.deepEqual(ev.filter((e) => ['death', 'burst', 'rise'].includes(e.type) && (e.target === 1 || e.actor === 1)).map((e) => e.type), ['death', 'burst', 'rise'])
  assert.equal(bloat.hp, Math.max(1, Math.round(bloat.maxHp * RELICS.undying.params.hp)))
  assert.equal(bloat.tile, b.at.indexOf(bloat), 'where it fell')
  assert.ok(synergiesOf(b, 'party').some((s) => s.id === 'undead_4'), 'it still counts')
  bloat.hp = 1
  strike(b, 10, 1)
  assert.ok(!alive(bloat), 'once a battle')
  unit(b, 5).hp = 1
  strike(b, 10, 5)
  assert.ok(!alive(unit(b, 5)) && !b.events.some((e) => e.type === 'rise' && e.target === 5), 'its neighbour holds none')
})

test('Mimicry: its holder counts as a Warden too, for its side\'s synergies; copies are more holders', () => {
  const wardens = (relics) => scene([on('hive_warden', 1, 'party', 0, 0), on('thorn_dryad', 2, 'party', 1, 0), on('tomb_knight', 3, 'party', 2, 0, 3, [0, 0], relics[0] ?? []),
    on('grave_ghoul', 4, 'party', 3, 0, 3, [0, 0], relics[1] ?? []), on('iron_golem', 10, 'foe', 6, 10)])
  const sanctuary = (b) => synergiesOf(b, 'party').some((s) => s.id === 'warden_4')
  assert.ok(!sanctuary(wardens([])))
  assert.ok(!sanctuary(wardens([['mimicry']])), 'three')
  assert.ok(sanctuary(wardens([['mimicry'], ['mimicry']])), 'two Wardens and two holders: four')
})

test('Blood Tithe: its holder\'s Arise raises two corpses a turn, the chosen then the highest tier, each costing the Monarch its share of max HP, never its last', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 2, 3, [0, 0], ['blood_tithe']), on('tomb_knight', 2, 'party', 0, 0, 3, [0, 0], ['arise']),
    ...[0, 1, 2].map((x) => on(x === 2 ? 'pyre_hound' : 'grave_ghoul', 10 + x, 'foe', x, 4, 1)), on('iron_golem', 20, 'foe', 6, 10)])
  for (const uid of [10, 11, 12]) slay(b, unit(b, uid))
  const m = b.monarch
  const tithe = Math.ceil(m.maxHp * RELICS.blood_tithe.params.tithe)
  const ev = order(b, { type: 'act', uid: 1, ability: 'arise', target: 10 })
  assert.deepEqual(ev.filter((e) => e.type === 'arise').map((e) => [e.actor, e.corpse]), [[1, 10], [1, 12]], 'the chosen, then the tier 2 over the tier 1')
  assert.deepEqual(ev.filter((e) => e.type === 'tithe').map((e) => [e.target, e.damage]), [[0, tithe], [0, tithe]], 'a tithe a shadow')
  assert.equal(m.hp, m.maxHp - 2 * tithe)
  assert.equal(b.raised, 2)
  assert.ok(ev.some((e) => e.type === 'cooldown' && e.ability === 'arise' && e.turns === 1), 'no rest, as every Arise')
  // A plain Arise raises one: the holder beside it takes the last.
  const plain = order(b, { type: 'act', uid: 2, ability: 'arise', target: 11 })
  assert.deepEqual(plain.filter((e) => e.type === 'arise').map((e) => e.corpse), [11])
  assert.ok(!plain.some((e) => e.type === 'tithe'), 'and pays no tithe')
  // The next turn: one corpse left in reach, one raised; and no more than the Monarch's HP pays for, never its last.
  order(b, { type: 'end' })
  assert.ok(legalOrders(b).every((o) => o.ability !== 'arise'), 'no corpse left')
  const two = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 2, 3, [0, 0], ['blood_tithe']), ...[0, 1].map((x) => on('grave_ghoul', 10 + x, 'foe', x, 4, 1)),
    on('iron_golem', 20, 'foe', 6, 10)])
  for (const uid of [10, 11]) slay(two, unit(two, uid))
  two.monarch.hp = 2 * tithe
  const once = order(two, { type: 'act', uid: 1, ability: 'arise', target: 11 })
  assert.deepEqual([once.filter((e) => e.type === 'arise').map((e) => e.corpse), two.monarch.hp], [[11], tithe], 'its HP pays for one')
  order(two, { type: 'end' })
  assert.deepEqual(corpses(two, unit(two, 1)), [], 'never with its last HP')
})

test('Court of Bone: its holder\'s Arise reaches 2 farther; and while the run holds it nothing heals the Monarch, in battle or out, though a buff still reaches it', () => {
  const b = scene([on('monarch', 0, 'party', 3, 1), on('tomb_knight', 1, 'party', 0, 0, 3, [0, 0], ['court_of_bone']), on('clockwork_page', 2, 'party', 3, 2, 9, [0, 3]),
    on('iron_golem', 50, 'foe', 6, 10)], { relics: ['court_of_bone'] })
  assert.deepEqual(ariseIn(b, unit(b, 1)).domain, TUNING.arise.domain + RELICS.court_of_bone.params.domain)
  b.monarch.hp = 30
  const kit = unit(b, 2).kit.map((a) => a.id)
  assert.ok(kit.includes('overclock'), kit.join())
  assert.ok(legalOrders(b).some((o) => o.uid === 2 && o.ability === 'overclock' && o.target === 0), 'a buff still reaches it')
  const mend = scene([on('monarch', 0, 'party', 3, 1), on('hive_warden', 1, 'party', 3, 2, 5), on('iron_golem', 50, 'foe', 6, 10)], { relics: ['court_of_bone'] })
  mend.monarch.hp = 30
  assert.ok(!legalOrders(mend).some((o) => o.ability === 'mend' && o.target === 0) || !preview(mend, 1, 'mend', 0)?.heal, 'no heal lands on it')
  assert.ok(!turns(mend).some((e) => e.type === 'heal' && e.target === 0))
  // Out of battle: not an altar (a win's mending and an HP relic bought: run.test.js, offerState above).
  const run = createRun({ start: START_PARTY, seed: 'cob-out' })
  const s = run.state
  s.relics = ['court_of_bone']
  monarchOf(s).hp = 40
  visit(run, 'altar')
  assert.equal(monarchOf(s).hp, 40)
})

test('Hollow Court: the shadows its holder raised that stand when the battle is won pay their essence again; a plain Arise\'s do not', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 2, 2, 3, [0, 0], ['hollow_court']), on('tomb_knight', 2, 'party', 4, 2, 3, [0, 0], ['arise']),
    on('grave_ghoul', 10, 'foe', 2, 4, 1), on('grave_ghoul', 11, 'foe', 4, 4, 1), on('iron_golem', 20, 'foe', 6, 10)])
  slay(b, unit(b, 10))
  slay(b, unit(b, 11))
  const court = order(b, { type: 'act', uid: 1, ability: 'arise', target: 10 }).find((e) => e.type === 'arise')
  const plain = order(b, { type: 'act', uid: 2, ability: 'arise', target: 11 }).find((e) => e.type === 'arise')
  assert.deepEqual([unit(b, court.unit.uid).reap, unit(b, plain.unit.uid).reap], [1, undefined])
  b.winner = 'party'
  assert.deepEqual(reapedShadows({ battle: b }).map((u) => u.uid), [court.unit.uid])
  b.winner = 'foe'
  assert.deepEqual(reapedShadows({ battle: b }), [])
})

test('every Legendary, held alone, together and twice over, plays deterministically and keeps the battle\'s invariants', () => {
  const pieceLegends = LEGENDARIES.filter((id) => !isRunRelic(id))
  const combos = [...pieceLegends.map((id) => [id]), pieceLegends, ['undying', 'undying'], ['court_of_bone', 'blood_tithe', 'arise']]
  const counts = {}
  for (let i = 0; i < 4; i++) {
    const run = createRun({ start: START_PARTY, seed: 'soak' + i })
    const s = run.state
    s.floor = 2
    const node = visit(run, 'elite')
    node.foes = encounter(s.seed, 2 + (i % 3), node)
    const caps = fielded(souls(s.party))
    for (const u of caps) Object.assign(u, { lvl: 9, maxHp: baseStats(u.id, 9).hp, hp: Math.max(1, Math.round(baseStats(u.id, 9).hp * (i % 2 ? 0.25 : 0.6))) })
    for (const legend of combos) {
      s.relics = [...legend, 'court_of_bone']
      caps.forEach((u, k) => { u.relics = legend[k] ? [legend[k]] : [] })
      const setup = battleSetup(run)
      for (const policy of [basicTurn, expertTurn]) {
        const b = createBattle(setup)
        while (!b.over) {
          const from = b.events.length
          playTurns(b, 1, policy)
          for (const e of b.events.slice(from)) {
            counts[e.type] = (counts[e.type] ?? 0) + 1
            if (e.type === 'rise') assert.notEqual(e.target, 0, 'the Monarch never rises')
            if (e.type === 'heal') assert.notEqual(e.target, 0, 'Court of Bone: no heal for the Monarch')
            if (e.type === 'tithe') assert.ok(e.hp > 0, 'the tithe never fells the Monarch')
          }
          for (const u of b.units) {
            assert.ok(u.hp >= 0 && u.hp <= u.maxHp, `${legend} turn ${b.turn}: ${u.uid} at ${u.hp}/${u.maxHp}`)
            if (alive(u)) assert.equal((u.flies ? b.sky : b.at)[u.tile], u, `${legend} turn ${b.turn}: ${u.uid} off the index`)
          }
          for (const [layer, flies] of [[b.at, false], [b.sky, true]]) {
            assert.ok(layer.every((u, t) => u === null || (alive(u) && !!u.flies === flies && footprint(u.tile, u.size).includes(t))), `${legend}: the index`)
          }
        }
        // The same setup under the same policy plays the same battle.
        assert.equal(timelineHash(playOut(createBattle(setup), policy).events), timelineHash(b.events), `${legend}: replayed`)
      }
    }
  }
  assert.ok(counts.move > 0, 'no move in the soak')
})

// ── the Shop's Legendaries, and the autoplayer ───────────────────────────────────────────────────

test('Legendaries are sold in Shops from floor 2, one a Shop, one owned too, with no cap; never on floor 1, and no elite lays one out', () => {
  const legendary = (id) => id && relicTier(id) === 'legendary'
  for (let i = 0; i < 10; i++) {
    const one = createRun({ start: START_PARTY, seed: 'ks' + i })
    visit(one, 'shop')
    assert.ok(!one.state.shop.some(legendary), JSON.stringify(one.state.shop))
  }
  for (let i = 0; i < 30; i++) {
    const run = createRun({ start: START_PARTY, seed: 'ks' + i })
    const s = run.state
    s.floor = 2
    s.relics = i % 2 ? ['legion', 'undying', 'arise'] : []
    visit(run, 'shop')
    const ks = shopOffers(run).filter((o) => legendary(o?.id))
    assert.equal(ks.length, 1)
    for (const o of ks) {
      assert.ok(o.type === 'relic' && o.tier === 'legendary' && o.name === RELICS[o.id].name && o.desc === RELICS[o.id].desc)
      assert.equal(o.cost, Math.round(TUNING.shop.price.legendary * floorPrice(2)))
    }
  }
  const run = createRun({ start: START_PARTY, seed: 'ks0' })
  const s = run.state
  s.floor = 2
  visit(run, 'shop')
  s.essence = 1e4
  const index = s.shop.findIndex(legendary)
  const id = s.shop[index]
  apply(run, { type: 'buy', index })
  assert.deepEqual([s.relics, s.shop[index], s.phase], [[id], null, 'shop'])
  assert.deepEqual(unheld(s), isRunRelic(id) ? [] : [id], 'a piece relic bought waits unheld')
  apply(run, { type: 'leave' })
  s.relics = [...LEGENDARIES, ...LEGENDARIES]
  visit(run, 'shop')
  const again = s.shop.findIndex(legendary)
  const twice = s.shop[again]
  apply(run, { type: 'buy', index: again })
  assert.equal(relicCount(s, twice), 3)
  assert.ok(win('kselite', (r) => { r.state.floor = 2 }, 'elite').state.offers.every((o) => o.type === 'soul'))
})

// Basic's Shop buys Command and nothing else (autoplay.js pickShop), and gives a piece relic waiting to a fielded soul
// holding none. (The expert weighs a relic against the tiers it displaces: run.test.js.)
test('basic in a Shop: it buys Legion for its Command, gives a piece relic waiting to a fielded soul, and fields the souls waiting; offerState sees an HP relic\'s Monarch', () => tuned({ party: { fieldPerFloor: 0 } }, () => {
  const rng = createRng('ksauto').stream('autoplay')
  for (const level of ['basic']) {
    const run = createRun({ start: START_PARTY, seed: 'ksauto' })
    run.state.floor = 2
    visit(run, 'shop')
    Object.assign(run.state, { shop: ['hollow_court', 'legion'], essence: 1e4 })
    assert.deepEqual(policy(run, rng, level), { type: 'buy', index: 1 }, level)
    apply(run, { type: 'buy', index: 1 })
    assert.deepEqual(policy(run, rng, level), { type: 'leave' }, level)
    run.state.relics.push('whetstone')
    const give = policy(run, rng, level)
    assert.equal(give.type, 'hold')
    assert.ok(fielded(run.state.party).some((u) => u.uid === give.uid) && give.relic === 'whetstone')
    apply(run, give)
    assert.deepEqual(policy(run, rng, level), { type: 'leave' }, level)
  }
  const bench = createRun({ start: START_PARTY, seed: 'ksbench' })
  bench.state.floor = 2
  visit(bench, 'fight')
  for (const id of ['tomb_knight', 'grave_ghoul']) {
    const u = join(bench, id)
    Object.assign(u, { lvl: 6, hp: baseStats(id, 6).hp, maxHp: baseStats(id, 6).hp })
  }
  const placed = (run) => planFor(run, LEVELS.basic).filter((p) => p.uid !== 0 && p.slot >= 0).length
  assert.equal(placed(bench), 3)
  bench.state.relics.push('legion')
  assert.equal(placed(bench), fieldCap(bench))
  assert.equal(fieldCap(bench), 5)
  const s = createRun({ start: START_PARTY, seed: 'kspoint' }).state
  monarchOf(s).hp = 40
  const hpRelic = { type: 'relic', id: 'bone_mantle' }
  const gain = relicMod('bone_mantle', 'run.monarchHp')
  const healed = offerState(s, hpRelic).party.find((u) => u.uid === 0)
  assert.deepEqual([healed.hp, healed.maxHp], [40 + gain, monarchOf(s).maxHp + gain])
  s.relics = ['court_of_bone']
  const court = offerState(s, hpRelic).party.find((u) => u.uid === 0)
  assert.deepEqual([court.hp, court.maxHp], [40, healed.maxHp])
}))

// ── the Monarch's HP and Command ─────────────────────────────────────────────────────────────────

test('Legion\'s souls stop at the board: Command itself has no cap; the field has', () => {
  const run = createRun({ start: START_PARTY, seed: 'm7' })
  const s = run.state
  s.relics = ['legion']
  assert.equal(fieldCap(run), TUNING.party.field + 2)
  s.relics = ['legion', ...Array(20).fill('grave_banner')]
  assert.equal(fieldCap(run), TUNING.army.board)
  assert.equal(commandOf(s), TUNING.party.field + 22)
})

test('the Monarch\'s HP and Command are run relics: a family of each, every copy adding in full (HP healed by its gain), Command widening the field up to the board', () => {
  const run = createRun({ start: START_PARTY, seed: 'hp-command' })
  const s = run.state
  const m = monarchOf(s)
  assert.deepEqual([m.maxHp, monarchHp(s), commandOf(s), fieldCap(run)], [TUNING.monarch.hp, TUNING.monarch.hp, TUNING.party.field, TUNING.party.field])
  const HP = RELIC_LIST.filter((r) => relicMod(r.id, 'run.monarchHp') > 0)
  const COMMAND = RELIC_LIST.filter((r) => relicMod(r.id, 'run.command') > 0 && r.tier !== 'legendary')
  assert.deepEqual(HP.map((r) => r.tier), ['common', 'uncommon', 'rare'])
  assert.deepEqual(COMMAND.map((r) => r.tier), ['common', 'uncommon', 'rare'])
  assert.ok([...HP, ...COMMAND].every((r) => r.run && !r.needsArise && r.desc), 'run relics, sold from the start')
  m.hp = 100
  let [hp, max, command] = [100, m.maxHp, commandOf(s)]
  visit(run, 'shop')
  for (const r of [...HP, ...COMMAND, HP[0], HP[0], COMMAND[2], COMMAND[2]]) {
    Object.assign(s, { shop: [r.id], essence: 1e4 })
    apply(run, { type: 'buy', index: 0 })
    hp += relicMod(r.id, 'run.monarchHp')
    max += relicMod(r.id, 'run.monarchHp')
    command += relicMod(r.id, 'run.command')
    assert.deepEqual([m.hp, m.maxHp, monarchHp(s), commandOf(s), fieldCap(run)], [hp, max, max, command, Math.min(TUNING.army.board, command)], r.id)
  }
  assert.equal(command, TUNING.party.field + 5)
  apply(run, { type: 'leave' })
  visit(run, 'fight')
  const setup = battleSetup(run)
  assert.deepEqual(setup.partyMods.filter((x) => x.path === 'hp').map((x) => x.v), COMMAND.flatMap((r) => r.mods.filter((x) => x.path === 'hp').map((x) => x.v)))
  assert.ok(setup.partyMods.every((x) => !isRunPath(x.path)))
  const b = createBattle(setup)
  assert.deepEqual([b.monarch.hp, b.monarch.maxHp], [m.hp, m.maxHp])
})

test('every Shop stocks a Command relic, on every floor and whatever the tier weights, so the field never grows by luck alone', () => {
  const command = (id) => relicMod(id, 'run.command') > 0 && relicTier(id) !== 'legendary'
  const shops = (prefix, n, tier = null) => {
    for (let i = 0; i < n; i++) {
      const run = createRun({ start: START_PARTY, seed: `${prefix}${i}` })
      run.state.floor = 1 + (i % 4)
      visit(run, 'shop')
      const ids = run.state.shop.filter(command)
      assert.ok(ids.length >= 1, JSON.stringify(run.state.shop))
      if (tier) assert.ok(ids.every((id) => relicTier(id) === tier), `${tier}: ${ids}`)
    }
  }
  shops('cmd', 24)
  for (const tier of ['common', 'uncommon', 'rare']) {
    tuned({ relic: { ...TUNING.relic, weights: { shop: [{ common: 0, uncommon: 0, rare: 0, [tier]: 1 }] } } }, () => shops(`cmd-${tier}`, 8, tier))
  }
})

// ── copies ───────────────────────────────────────────────────────────────────────────────────────

test('copies: a run relic\'s stack, a piece relic\'s are more holders; numbers add a copy', () => {
  const run = runIn('copies')
  const s = run.state
  // Two Whetstones, two holders: each its own.
  s.relics = ['whetstone', 'whetstone']
  const [knight, chanter] = ['tomb_knight', 'bone_chanter'].map((id) => soul(run, id))
  apply(run, { type: 'hold', relic: 'whetstone', uid: knight.uid })
  apply(run, { type: 'hold', relic: 'whetstone', uid: chanter.uid })
  const b = createBattle(battleSetup(run))
  const bare = createBattle({ ...battleSetup(run), party: battleSetup(run).party.map((u) => ({ ...u, relics: [] })) })
  const w = RELICS.whetstone.mods[0].v
  const atk = (x, u) => stats(x, x.units.find((y) => y.uid === u.uid)).atk
  for (const u of [knight, chanter]) assert.ok(Math.abs(atk(b, u) - atk(bare, u) * w) < 1e-6, u.id)
  assert.deepEqual(b.units.filter((u) => u.relics.length).map((u) => u.relics), [['whetstone'], ['whetstone']])
  // A run relic twice: Legion's Command and HP twice over.
  s.relics = ['legion', 'legion']
  for (const u of souls(s.party)) u.relics = []
  assert.equal(fieldCap(run), TUNING.party.field + 4)
  assert.deepEqual(battleSetup(run).partyMods, [...LEGION, ...LEGION])
  // Numbers add: the field, the ossuary, the Monarch's max HP, a price's discount (never below 1 essence).
  s.relics = ['grave_banner', 'grave_banner', 'ossuary_key', 'ossuary_key', 'grave_shroud', 'grave_shroud']
  assert.deepEqual([fieldCap(run), rosterCap(run), monarchHp(s)], [TUNING.party.field + 2, TUNING.party.roster + 2 * relicMod('ossuary_key', 'run.roster'), TUNING.monarch.hp + 2 * relicMod('grave_shroud', 'run.monarchHp')])
  s.relics = []
  const full = tierCost(run, 'tomb_knight', 0)
  s.relics = ['grave_ledger']
  assert.equal(tierCost(run, 'tomb_knight', 0), Math.max(1, Math.round(full * (1 + relicMod('grave_ledger', 'price.lowTier')))))
  s.relics = Array(6).fill('grave_ledger')
  assert.equal(tierCost(run, 'tomb_knight', 0), 1)
})

test('no cap: a relic owned is stocked again and bought again, however many the run owns', () => {
  const others = RELIC_LIST.filter((r) => r.tier !== 'legendary' && !r.needsArise).map((r) => r.id)
  for (let i = 0; i < 10; i++) {
    const run = createRun({ start: START_PARTY, seed: 'nocap' + i })
    const s = run.state
    s.relics = [...others, ...others, ...others]
    visit(run, 'shop')
    s.essence = 1e4
    assert.equal(s.shop.length, TUNING.shop.relics)
    assert.equal(new Set(s.shop).size, s.shop.length, 'never the same relic twice on one shelf')
    const id = s.shop[0]
    apply(run, { type: 'buy', index: 0 })
    assert.equal(relicCount(s, id), 4)
  }
})

test('the tiers a Shop draws: by TUNING.relic.weights for its floor, the last entry past them; a tier weighed 0 never comes', () => {
  assert.deepEqual(relicWeights(1), TUNING.relic.weights.shop[0])
  assert.deepEqual(relicWeights(99), TUNING.relic.weights.shop.at(-1))
  assert.deepEqual(Object.keys(TUNING.relic.weights), ['shop'])
  const only = (tier) => ({ relic: { ...TUNING.relic, weights: { shop: [{ common: 0, uncommon: 0, rare: 0, [tier]: 1 }] } } })
  for (const tier of ['common', 'uncommon', 'rare']) {
    tuned(only(tier), () => {
      for (let i = 0; i < 8; i++) {
        const run = createRun({ start: START_PARTY, seed: `tier-${tier}-${i}` })
        visit(run, 'shop')
        assert.ok(run.state.shop.length && run.state.shop.every((id) => RELICS[id].tier === tier), JSON.stringify(run.state.shop))
      }
    })
  }
  const rares = RELIC_LIST.filter((r) => r.tier === 'rare').length
  tuned({ shop: { relics: rares + 2 }, relic: { ...TUNING.relic, weights: { shop: [{ common: 0, uncommon: 0, rare: 1 }] } } }, () => {
    const run = createRun({ start: START_PARTY, seed: 'tier-few' })
    visit(run, 'shop')
    assert.equal(run.state.shop.length, rares)
  })
})

// ── Arise ────────────────────────────────────────────────────────────────────────────────────────

test('Arise\'s reach and tier are the run\'s, a run relic at a time (Hourglass, Bone Idol), a variant\'s on top in battle; the battle takes them from the run', () => {
  const run = createRun({ start: START_PARTY, seed: 'gate' })
  const s = run.state
  const A = TUNING.arise
  assert.equal(ariseHeld(s), false)
  assert.deepEqual(ariseOf(s), { domain: A.domain, tier: A.tier })
  s.relics = ['arise', 'bone_idol', 'bone_idol', 'hourglass']
  assert.equal(ariseHeld(s), true)
  assert.deepEqual(ariseOf(s), { domain: A.domain + 1, tier: A.tier + 2 })
  soul(run, 'tomb_knight').relics = ['arise']
  visit(run, 'fight')
  const setup = battleSetup(run)
  assert.deepEqual([setup.arise, setup.partyMods], [ariseOf(s), []])
  const b = createBattle(setup)
  assert.deepEqual(ariseIn(b, b.units.find((u) => u.id === 'tomb_knight')), ariseOf(s))
  assert.equal(ariseIn(b, b.units.find((u) => u.id === 'bone_chanter')), null, 'only its holder raises')
  // Without an Arise relic held on the field, no shadow rises: none of the Monarch's.
  const none = scene([on('monarch', 0, 'party', 3, 1), on('tomb_knight', 1, 'party', 0, 0), on('grave_ghoul', 10, 'foe', 3, 3), on('iron_golem', 50, 'foe', 6, 10)], { relics: ['arise', 'hourglass'] })
  slay(none, unit(none, 10))
  assert.ok(!legalOrders(none).some((o) => o.ability === 'arise'))
})

test('what needs an Arise relic is stocked only once one is owned: Hourglass, Bone Idol; a variant counts', () => {
  const needs = RELIC_LIST.filter((r) => r.needsArise).map((r) => r.id)
  const stocked = (relics) => {
    const seen = new Set()
    for (let i = 0; i < 120; i++) {
      const run = createRun({ start: START_PARTY, seed: `needs-shop-${i}` })
      run.state.floor = 2 + (i % 3)
      run.state.relics = relics.slice()
      visit(run, 'shop')
      for (const id of run.state.shop) seen.add(id)
    }
    return seen
  }
  const without = stocked(['legion'])
  assert.deepEqual(needs.filter((id) => without.has(id)), [])
  assert.ok(without.has('arise'), 'Arise itself is stocked')
  assert.deepEqual(needs.filter((id) => !stocked(['arise']).has(id)), [], 'each comes once Arise is owned')
  assert.deepEqual(needs.filter((id) => !stocked(['court_of_bone']).has(id)), [], 'or a variant')
})

test('a run owning copies saves and replays exactly: the log rebuilds its relics, repeats and all, and who holds them', () => {
  const rare = { shop: [{ common: 0, uncommon: 0, rare: 1 }] }
  tuned({ relic: { ...TUNING.relic, weights: rare }, shop: { price: { common: 1, uncommon: 1, rare: 1, legendary: 1 } } }, () => {
    for (let i = 0; i < 60; i++) {
      const run = autoplay(createRun({ start: START_PARTY, seed: 'copysave' + i }))
      const s = run.state
      if (!s.relics.some((id) => relicCount(s, id) > 1)) continue
      assert.deepEqual(replay(s.seed, s.log).state, s)
      assert.deepEqual(structuredClone(s).relics, s.relics, 'the relics are plain ids')
      return
    }
    assert.fail('no run took a relic twice')
  })
})
