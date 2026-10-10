// Relics (DESIGN §2.6): four tiers, the Legendaries the rules that rewrite the game (once keystones), copies that
// stack with no cap, the Monarch's HP and Command (relics alone grow them), and Arise a Legendary that opens the
// Monarch's raising, its numbers its own, a copy at a time.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, stepBattle, runBattle, relicRules, ariseCap, ariseTier, ariseHaste, stats } from '../src/sim/battle.js'
import {
  createRun, apply, battleSetup, fieldCap, rosterCap, domainOf, souls, monarchOf, fielded, legalActions, join, reapedShadows, encounter,
  foeEssence, relicCount, ariseHeld, offerGroup, relicWeights, replay, tierCost, ariseOf, monarchHp, commandOf, onePick
} from '../src/sim/run.js'
import { policy, planFor, LEVELS, autoplay, offerState } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { tuned, FIRST_ARISE } from './tuned.js'
import { RELIC_LIST, RELICS, RELIC_TIERS, TRIGGERS, STATUSES, UNIT_LIST, unitDef } from '../src/content.js'
import { makeUnit, tileAt, tileX, tileY, slotAt, alive, activeSynergies, baseStats, footprint } from '../src/sim/unit.js'
import { on, stackOn, scene as sceneOf, slay, unit } from './scene.js'
import { visit, win } from './rooms.js'
// The Legendaries' numbers, as content sets them: Legion's HP share, Undying's rise, Blood Tithe's tithe.
const LEGION = RELICS.legion.mods
const LEGION_HP = LEGION[0].v
const RISE = RELICS.undying.rise
const TITHE = RELICS.blood_tithe.tithe
const LEGENDARIES = RELIC_LIST.filter((r) => r.tier === 'legendary').map((r) => r.id)
// The Legendaries that need Arise, and the other relics that do (the Monarch's gauge is Arise's alone).
const NEEDS_ARISE = ['hollow_court', 'blood_tithe', 'court_of_bone']

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

// A battle of units placed on tiles (scene.js scene). A soul's tiers add no bodies here (the bodies switch) unless
// `bodies`: the scenes set every piece's count themselves.
const scene = (units, { bodies = false, ...opts } = {}) => sceneOf(units, { ...(!bodies && { ablate: ['bodies'] }), ...opts })

// Steps until `done(events so far)` holds; the events of every tick stepped.
function until (b, done, limit = 600) {
  const events = []
  while (!b.over && b.t < limit && !done(events)) events.push(...stepBattle(b))
  assert.ok(done(events), `not by tick ${b.t}`)
  return events
}

// The events right after the first one matching `first` in the same tick.
const after = (events, first) => {
  const i = events.findIndex(first)
  assert.ok(i >= 0, 'the moment came')
  return events.slice(i + 1).filter((e) => e.t === events[i].t)
}

// ── content ──────────────────────────────────────────────────────────────────────────────────────

test('relics come in four tiers, every relic of one; the Legendaries are the six keystones and Arise, each a rule; most others trigger, a few flat ones stay', () => {
  assert.deepEqual(RELIC_TIERS.map((t) => t.id), ['common', 'uncommon', 'rare', 'legendary'])
  for (const t of RELIC_TIERS) assert.ok(t.name && /^--c-/.test(t.colour), JSON.stringify(t))
  const tiers = RELIC_TIERS.map((t) => t.id)
  for (const r of RELIC_LIST) assert.ok(tiers.includes(r.tier), `${r.id}: ${r.tier}`)
  for (const t of tiers) assert.ok(RELIC_LIST.some((r) => r.tier === t), `a ${t} relic`)
  assert.deepEqual(LEGENDARIES, ['arise', 'legion', 'undying', 'mimicry', 'hollow_court', 'blood_tithe', 'court_of_bone'])
  // The twenty-one relics that were are the first three tiers, with the five that hold the Monarch's HP and Command.
  assert.equal(RELIC_LIST.filter((r) => r.tier !== 'legendary').length, 26)
  const RULES = ['arise', 'command', 'mods', 'rise', 'alias', 'domain', 'reap', 'raises', 'tithe', 'unhealable', 'needsArise']
  for (const id of LEGENDARIES) {
    const k = RELICS[id]
    assert.ok(k.name && k.desc, k.id)
    const rules = Object.keys(k).filter((key) => !['id', 'name', 'desc', 'tier'].includes(key))
    assert.ok(rules.length && rules.every((r) => RULES.includes(r)), `${k.id}: ${rules}`)
  }
  // The ones that need Arise say so, and a pure on/off rule says what a copy more does.
  assert.deepEqual(LEGENDARIES.filter((id) => RELICS[id].needsArise), NEEDS_ARISE)
  assert.deepEqual(RELIC_LIST.filter((r) => r.tier !== 'legendary' && r.needsArise).map((r) => r.id).sort(), ['bone_idol', 'hourglass'])
  for (const id of ['arise', 'undying', 'mimicry']) assert.match(RELICS[id].desc, /Each copy: /, id)
  assert.deepEqual(relicRules(['legion', 'blood_tithe', 'court_of_bone']), {
    arise: 0, rise: 0, rises: 0, alias: null, raises: 1, tithe: TITHE, unhealable: true
  })
  assert.deepEqual(relicRules([]), { arise: 0, rise: 0, rises: 0, alias: null, raises: 0, tithe: 0, unhealable: false })
  // At least half the relics but the Legendaries (and the Monarch's HP and Command) trigger, each on a known moment
  // with effects whose ops, statuses and targets resolve; a few flat stat relics stay as filler.
  const others = RELIC_LIST.filter((r) => r.tier !== 'legendary' && !r.command && !r.monarchHp)
  const triggers = RELIC_LIST.filter((r) => r.on)
  assert.ok(triggers.length * 2 >= others.length, `${triggers.length} of ${others.length}`)
  assert.ok(others.filter((r) => r.mods).length >= 2, 'flat relics stay')
  assert.deepEqual(new Set(triggers.map((r) => r.on)), new Set(TRIGGERS))
  for (const r of triggers) {
    assert.ok(!r.mods && r.effects.length, r.id)
    for (const e of r.effects) {
      assert.ok(['heal', 'apply_status', 'gauge', 'cleanse', 'damage'].includes(e.op), `${r.id} ${e.op}`)
      assert.ok(['self', 'other', 'monarch', 'allies', 'foes'].includes(e.to), `${r.id} to ${e.to}`)
      if (['allies', 'foes'].includes(e.to)) assert.ok(Number.isInteger(e.range) && e.range >= 1, `${r.id} range`)
      if (e.status) assert.ok(STATUSES[e.status], `${r.id} status ${e.status}`)
      if (e.op === 'heal') assert.ok(e.pct > 0 && e.pct < 1, `${r.id} pct`)
    }
  }
  assert.equal(new Set(RELIC_LIST.map((r) => r.id)).size, RELIC_LIST.length)
})

// ── trigger relics ───────────────────────────────────────────────────────────────────────────────

// The 'kill' moment: a lvl-9 knight (uid 1, wounded) beside a Ghoul (10) at 1 HP; another Ghoul (11) stands
// next to the slain's tile, a third (12) far off. The knight is ready to strike.
function killing (relics) {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 6, 9),
    on('grave_ghoul', 10, 'foe', 3, 7, 1), on('grave_ghoul', 11, 'foe', 4, 8, 1), on('grave_ghoul', 12, 'foe', 0, 10, 1)], { relics })
  unit(b, 1).hp = 50
  unit(b, 1).gauge = unit(b, 1).costliest
  unit(b, 10).hp = 1
  const events = until(b, (ev) => ev.some((e) => e.type === 'death' && e.target === 10))
  return { b, next: after(events, (e) => e.type === 'death' && e.target === 10) }
}

test('Blood Chalice: when one of yours slays a foe, the killer heals 15% of its max HP', () => {
  const { b, next } = killing(['blood_chalice'])
  const knight = unit(b, 1)
  assert.deepEqual(next.slice(0, 2), [
    { t: next[0].t, type: 'trigger', relic: 'blood_chalice', on: 'kill', unit: 1 },
    { t: next[0].t, type: 'heal', actor: 1, target: 1, heal: Math.round(knight.maxHp * RELICS.blood_chalice.effects[0].pct), hp: next[1].hp }
  ])
  // Without the relic, no heal follows the kill.
  assert.ok(!killing([]).next.some((e) => e.type === 'heal' || e.type === 'trigger'))
})

test('Arcane Focus: when one of yours slays a foe, the killer gains 40 gauge', () => {
  const { next } = killing(['arcane_focus'])
  assert.deepEqual(next.slice(0, 2).map(({ t, ...e }) => e), [
    { type: 'trigger', relic: 'arcane_focus', on: 'kill', unit: 1 }, { type: 'gauge', actor: 1, target: 1, amount: 40 }
  ])
})

test("Hunter's Mark: when one of yours slays a foe, the foes next to the slain turn Brittle, and no one else", () => {
  const { next } = killing(['hunters_mark'])
  assert.equal(next[0].relic, 'hunters_mark')
  const brittle = next.filter((e) => e.type === 'status' && e.status === 'brittle').map((e) => e.target)
  assert.deepEqual(brittle, [11], 'the Ghoul beside the slain, not the one far off')
})

// The 'fall' moment: a party Ghoul (2) at 1 HP beside a ready lvl-9 foe knight; a wounded party knight (1)
// stands within 2 tiles of it, a Sprite (3) far away; the Monarch far off, its gauge low.
function falling (relics) {
  const b = scene([on('monarch', 0, 'party', 0, 0), on('tomb_knight', 1, 'party', 4, 4), on('grave_ghoul', 2, 'party', 3, 5, 1),
    on('frost_sprite', 3, 'party', 6, 1), on('tomb_knight', 10, 'foe', 3, 6, 9)], { relics })
  unit(b, 1).hp = 40
  unit(b, 2).hp = 1
  unit(b, 10).gauge = unit(b, 10).costliest
  const events = until(b, (ev) => ev.some((e) => e.type === 'death' && e.target === 2))
  return { b, next: after(events, (e) => e.type === 'death' && e.target === 2) }
}

test('War Drum: when one of yours falls, your side within 2 tiles of it gains Hasten', () => {
  const { next } = falling(['war_drum'])
  assert.deepEqual(next[0].relic, 'war_drum')
  assert.deepEqual(next.filter((e) => e.type === 'status' && e.status === 'hasten').map((e) => e.target), [1], 'the knight beside, not the Sprite far off')
})

test('Balm: when one of yours falls, your side within 2 tiles of it heals 18% of its max HP', () => {
  const { b, next } = falling(['balm'])
  assert.equal(next[0].relic, 'balm')
  const heals = next.filter((e) => e.type === 'heal')
  assert.deepEqual(heals.map((e) => [e.target, e.heal]), [[1, Math.round(unit(b, 1).maxHp * RELICS.balm.effects[0].pct)]])
})

test('Bone Idol: when one of yours falls, Arise gains 40 gauge', () => {
  const { next } = falling(['bone_idol'])
  assert.deepEqual(next.slice(0, 2).map(({ t, ...e }) => e), [
    { type: 'trigger', relic: 'bone_idol', on: 'fall', unit: 2 }, { type: 'gauge', actor: 2, target: 0, amount: 40 }
  ])
})

// The 'struck' moment: a Wisp (10), a Flank kind, halted beside the Monarch, shoots it (a diver aims at nothing
// else); a knight (1) stands beside the Monarch, a Sprite (3) far off.
function striking (relics, hp = null) {
  const b = scene([on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 2, 1), on('frost_sprite', 3, 'party', 6, 0),
    on('will_o_wisp', 10, 'foe', 3, 3, 1)], { relics })
  unit(b, 10).gauge = unit(b, 10).costliest
  if (hp !== null) b.monarch.hp = hp
  const events = until(b, (ev) => ev.some((e) => e.type === 'damage' && e.target === 0))
  return { b, events, next: after(events, (e) => e.type === 'damage' && e.target === 0) }
}

test('Hourglass: when the Monarch is struck and stands, Arise gains 30 gauge; a fatal blow triggers nothing', () => {
  const { next } = striking(['hourglass'])
  assert.deepEqual(next.slice(0, 2).map(({ t, ...e }) => e), [
    { type: 'trigger', relic: 'hourglass', on: 'struck', unit: 0 }, { type: 'gauge', actor: 0, target: 0, amount: 30 }
  ])
  // Nor any other: the Monarch's fall is not a 'fall' moment either (the battle's opening, its first wave, is one).
  const fatal = striking(RELIC_LIST.filter((r) => r.on).map((r) => r.id), 1)
  assert.ok(fatal.b.over && fatal.b.reason === 'monarch')
  assert.deepEqual(fatal.events.filter((e) => e.type === 'trigger').map((e) => [e.t, e.on]), [[0, 'wave']])
})

test('Iron Oath: when the Monarch is struck, your side within 2 tiles of it gains Barkskin', () => {
  const { next } = striking(['iron_oath'])
  assert.equal(next[0].relic, 'iron_oath')
  assert.deepEqual(next.filter((e) => e.type === 'status' && e.status === 'barkskin').map((e) => e.target).sort(), [0, 1], 'the Monarch and its knight, not the Sprite')
})

test('Grave Bell: when the Monarch is struck, its attacker is Withered', () => {
  const { next } = striking(['grave_bell'])
  assert.equal(next[0].relic, 'grave_bell')
  assert.deepEqual(next.filter((e) => e.type === 'status').map((e) => [e.target, e.status]), [[10, 'withered']])
})

// Shielded (Tower Shield's gift) cuts the damage a unit takes by 40%: the same blow, rolled the same, on the same
// knight with and without it. A Frost Wyrm's hit is big enough that a cut a few points off would show past rounding.
test('Shielded: the same blow lands 40% lighter', () => {
  const blow = (shielded) => {
    const party = [{ ...makeUnit('monarch', { uid: 0, lvl: 1 }), slot: slotAt(6, 3) }, { ...makeUnit('tomb_knight', { uid: 1, lvl: 3 }), slot: slotAt(0, 3) }]
    const b = createBattle({ party, foes: [{ ...makeUnit('frost_wyrm', { uid: 10, lvl: 24 }), slot: slotAt(2, 3) }], seed: 'shield' })
    const knight = unit(b, 1)
    if (shielded) knight.statuses.push({ id: 'shield', dur: 'battle', stacks: 1, age: 0 })
    const taken = stats(b, knight).damage.taken
    const hit = until(b, (ev) => ev.some((e) => e.type === 'damage' && e.target === 1)).find((e) => e.type === 'damage' && e.target === 1)
    return { taken, hit }
  }
  const bare = blow(false)
  const shielded = blow(true)
  assert.equal(shielded.taken, bare.taken * 0.6)
  assert.deepEqual({ ...shielded.hit, damage: 0, hp: 0 }, { ...bare.hit, damage: 0, hp: 0 }, 'the same blow, at the same tick')
  assert.ok(bare.hit.damage >= 60, `a big enough blow: ${bare.hit.damage}`)
  assert.ok(Math.abs(shielded.hit.damage - bare.hit.damage * 0.6) <= 1, `${shielded.hit.damage} vs ${bare.hit.damage}`)
})

test('Tower Shield: as the battle begins and as each later wave begins to enter, your side within 2 tiles of the Monarch is Shielded, once a wave; Rally Horn: the battle\'s first blow hastens your side about the Monarch', () => {
  // A knight beside the Monarch, a Sprite three tiles off; the foes standing from the start are the first wave, its
  // moment the battle's first tick; the next wave (two foes) enters at 20, the one after at 60. A foe of no wave
  // entering at 10 is no moment.
  const later = (uid, wave, t) => ({ ...makeUnit('grave_ghoul', { uid, lvl: 1 }), side: 'foe', lane: uid % 7, ...(wave && { wave }), when: { at: 'time', t } })
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 2, 1), on('frost_sprite', 3, 'party', 6, 0), on('iron_golem', 50, 'foe', 6, 10)],
    { relics: ['tower_shield'], reserve: [later(70, 0, 10), later(71, 1, 20), later(72, 1, 21), later(73, 2, 60)] })
  const ev = until(b, (e) => e.some((x) => x.type === 'enter' && x.unit.uid === 73), 200)
  const fired = ev.filter((e) => e.type === 'trigger')
  assert.deepEqual(fired.map((e) => [e.t, e.relic, e.on, e.unit]), [[0, 'tower_shield', 'wave', 0], [20, 'tower_shield', 'wave', 0], [60, 'tower_shield', 'wave', 0]])
  // A later wave's moment comes as it is announced, before its first foe enters.
  const i = ev.indexOf(fired[1])
  assert.deepEqual([ev[i - 1].type, ev[i - 1].wave], ['wave', 1])
  assert.ok(ev.slice(i).some((e) => e.type === 'enter' && e.unit.uid === 71))
  const shielded = ev.filter((e) => e.type === 'status' && e.status === 'shield').map((e) => [e.t, e.target]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  assert.deepEqual(shielded, [[0, 0], [0, 1], [20, 0], [20, 1], [60, 0], [60, 1]], 'the Monarch and the knight; the Sprite is three off')
  // With no foe standing at the start, the battle opens on no moment: the first wave's comes as it enters.
  const empty = scene([on('monarch', 0, 'party', 3, 0)], { relics: ['tower_shield'], reserve: [later(71, 1, 20)] })
  const opened = until(empty, (e) => e.some((x) => x.type === 'enter'), 100).filter((e) => e.type === 'trigger')
  assert.deepEqual(opened.map((e) => e.t), [20])
  // Rally Horn: the Wisp's blow on the Monarch is the battle's first; the Knight beside the Monarch is hastened, the
  // Sprite three tiles off is not.
  const { b: s } = striking(['rally_horn'])
  assert.deepEqual(s.events.filter((e) => e.type === 'trigger').map((e) => [e.relic, e.on, e.unit]), [['rally_horn', 'blow', 0]])
  assert.ok(unit(s, 1).statuses.some((x) => x.id === 'hasten') && !unit(s, 3).statuses.some((x) => x.id === 'hasten'))
})

test('trigger relics fire for your side only: a foe slaying, falling or entering triggers nothing', () => {
  const relics = RELIC_LIST.filter((r) => r.on).map((r) => r.id)
  // A foe knight slays a party Ghoul: 'fall' fires (yours fell), never 'kill' (the battle's first blow is 'blow').
  const { next } = falling(relics)
  assert.ok(next.filter((e) => e.type === 'trigger').every((e) => e.on === 'fall' || e.on === 'blow'))
  // A foe falls to a party blow: 'kill' only; a foe that enters (a wave): nothing.
  assert.ok(killing(relics).next.filter((e) => e.type === 'trigger').every((e) => e.on === 'kill' || e.on === 'blow'))
  const b = scene([on('monarch', 0, 'party', 3, 1), on('iron_golem', 50, 'foe', 3, 10)],
    { relics, reserve: [{ ...makeUnit('grave_ghoul', { uid: 70, lvl: 2 }), side: 'foe', when: { at: 'time', t: 3 } }] })
  const ev = until(b, (e) => e.some((x) => x.type === 'enter'))
  assert.deepEqual(ev.filter((e) => e.type === 'trigger').map((e) => [e.t, e.on]), [[0, 'wave']], 'the battle\'s opening, and nothing as a foe enters')
})

// ── Legendaries in battle ──────────────────────────────────────────────────────────────────────────

test('Legion: two more souls on the field, and every soul (stacks and shadows too, never the Monarch) fights at 85% max HP', () => {
  const run = createRun({ seed: 'legion' })
  const s = run.state
  assert.equal(fieldCap(run), 3)
  s.relics = ['legion']
  assert.equal(fieldCap(run), 5)
  visit(run, 'fight')
  const mine = (relics) => {
    s.relics = relics
    const b = createBattle(battleSetup(run))
    return Object.fromEntries(b.units.filter((u) => u.side === 'party').map((u) => [u.uid, u.maxHp]))
  }
  const plain = mine([])
  const legion = mine(['legion'])
  for (const u of souls(s.party)) assert.equal(legion[u.uid], Math.round(plain[u.uid] * LEGION_HP), u.id)
  assert.equal(legion[0], plain[0], 'the Monarch keeps its HP')
  // A stack's every body as well.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3), stackOn('grave_ghoul', 2, 'party', 2, 3, 2), on('iron_golem', 50, 'foe', 3, 10)], { relics: ['legion'], partyMods: LEGION })
  assert.equal(unit(b, 2).maxHp, 2 * Math.round(baseStats('grave_ghoul', 3).hp * LEGION_HP))
  assert.equal(b.monarch.maxHp, baseStats('monarch', 3).hp)
  // And a shadow Arise raises.
  const shade = (partyMods) => {
    const a = scene([on('monarch', 0, 'party', 3, 0), on('grave_ghoul', 10, 'foe', 3, 2, 1), on('iron_golem', 50, 'foe', 6, 10)], { relics: ['arise'], partyMods })
    slay(a, unit(a, 10))
    a.monarch.gauge = 200
    stepBattle(a)
    return a.units.find((u) => u.shadow)
  }
  assert.equal(shade(LEGION).maxHp, Math.round(shade([]).maxHp * LEGION_HP))
})

// A lvl-9 foe knight, ready, beside `victim` (at 1 HP).
function felled (units, victim, relics) {
  const b = scene([...units, on('tomb_knight', 40, 'foe', tileX(units.find((u) => u.uid === victim).tile), tileY(units.find((u) => u.uid === victim).tile) + 1, 9)], { relics })
  unit(b, victim).hp = 1
  unit(b, 40).gauge = unit(b, 40).costliest
  return b
}

test('Undying: a fallen soul rises where it fell at 50% HP, once a battle (a stack as one piece); shadows and the Monarch never rise', () => {
  const units = [on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 5), stackOn('grave_ghoul', 2, 'party', 0, 1, 2), on('iron_golem', 50, 'foe', 6, 10)]
  const b = felled(units, 1, ['undying', 'bone_idol'])
  const knight = unit(b, 1)
  const roster = b.roster
  const events = until(b, (ev) => ev.some((e) => e.type === 'death' && e.target === 1))
  const next = after(events, (e) => e.type === 'death' && e.target === 1)
  assert.deepEqual(next[0], { t: next[0].t, type: 'rise', target: 1, hp: Math.round(knight.maxHp * RISE) })
  assert.deepEqual(next[1], { t: next[0].t, type: 'trigger', relic: 'bone_idol', on: 'fall', unit: 1 }, 'a rise is still a fall')
  assert.ok(alive(knight) && b.at[knight.tile] === knight && knight.tile === tileAt(3, 5), 'it stands where it fell')
  assert.equal(b.roster, roster, 'it never left the board')
  // The second fall is for good.
  knight.hp = 1
  unit(b, 40).gauge = unit(b, 40).costliest
  const again = until(b, (ev) => ev.some((e) => e.type === 'death' && e.target === 1))
  assert.ok(!after(again, (e) => e.type === 'death' && e.target === 1).some((e) => e.type === 'rise'))
  assert.ok(!alive(knight) && b.at[knight.tile] !== knight)
  // Without the relic, the first fall is for good.
  const plain = felled(units, 1, [])
  until(plain, (ev) => ev.some((e) => e.type === 'death' && e.target === 1))
  assert.ok(!alive(unit(plain, 1)) && !plain.events.some((e) => e.type === 'rise'))
  // A stack rises as one piece, at 50% of its pool: both its bodies stand again.
  const stack = felled(units, 2, ['undying'])
  const fell = until(stack, (ev) => ev.some((e) => e.type === 'death' && e.target === 2))
  assert.deepEqual(after(fell, (e) => e.type === 'death' && e.target === 2)[0], { t: fell.at(-1).t, type: 'rise', target: 2, hp: Math.round(unit(stack, 2).maxHp * RISE) })
  // A shadow never rises.
  // The shadow: raised beside the Monarch, next to a ready lvl-9 foe knight, and left at 1 HP, it falls for good.
  const sh = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 1), on('grave_ghoul', 10, 'foe', 3, 5, 1), on('tomb_knight', 40, 'foe', 3, 2, 9)],
    { relics: ['undying', 'arise'], domain: 6 })
  slay(sh, unit(sh, 10))
  sh.monarch.gauge = 200
  stepBattle(sh)
  const shadow = sh.units.find((u) => u.shadow)
  assert.equal(shadow.tile, tileAt(3, 1))
  shadow.hp = 1
  unit(sh, 40).gauge = unit(sh, 40).costliest
  until(sh, (ev) => ev.some((e) => e.type === 'death' && e.target === shadow.uid))
  assert.ok(!alive(shadow) && !sh.events.some((e) => e.type === 'rise'))
  // Nothing revives the Monarch: with every Legendary held, its fall is the battle lost.
  const m = felled([on('monarch', 0, 'party', 3, 4), on('tomb_knight', 1, 'party', 0, 0), on('iron_golem', 50, 'foe', 6, 10)], 0, LEGENDARIES)
  runBattle(m)
  assert.deepEqual([m.winner, m.reason, m.monarch.hp], ['foe', 'monarch', 0])
  assert.ok(!m.events.some((e) => e.type === 'rise'))
})

test('Mimicry: Vanguards count as Wardens too, for your synergies, not the foes\'', () => {
  // Unit-level: two Vanguards make Warden 2 with the alias, not without it.
  const two = [makeUnit('tomb_knight', { uid: 1 }), makeUnit('grave_ghoul', { uid: 2 })]
  const alias = RELICS.mimicry.alias
  assert.ok(activeSynergies(two, alias).some((s) => s.id === 'warden_2'))
  assert.ok(!activeSynergies(two).some((s) => s.id === 'warden_2'))
  // In battle: the party's knights hold Warden 2; the foes' knights, standing the same way, do not.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4), on('tomb_knight', 2, 'party', 3, 3),
    on('tomb_knight', 10, 'foe', 3, 8), on('tomb_knight', 11, 'foe', 3, 9)], { relics: ['mimicry'] })
  const start = b.events[0]
  assert.ok(start.synergies.some((s) => s.side === 'party' && s.id === 'warden_2'))
  assert.ok(!start.synergies.some((s) => s.side === 'foe' && s.id === 'warden_2'))
})

test('Blood Tithe: Arise\'s cap is doubled, each shadow costs the Monarch 3% of its max HP, and it never pays with its last', () => tuned(FIRST_ARISE, () => {
  // Rally Horn and Tower Shield (a wave; but the battle's opening) and the Hourglass (struck) never fire on a raise: a
  // shadow rising is no wave, and the tithe is no blow.
  const build = (relics, hp = null) => {
    const b = scene([on('monarch', 0, 'party', 3, 1), on('tomb_knight', 1, 'party', 0, 0),
      on('grave_ghoul', 10, 'foe', 3, 2, 1), on('grave_ghoul', 11, 'foe', 2, 2, 1), on('grave_ghoul', 12, 'foe', 4, 2, 1), on('iron_golem', 50, 'foe', 6, 10)],
    { relics: ['arise', ...relics, 'rally_horn', 'tower_shield', 'hourglass'] })
    for (const uid of [10, 11, 12]) slay(b, unit(b, uid))
    if (hp !== null) b.monarch.hp = hp
    return b
  }
  const raise = (b) => {
    b.monarch.gauge = 200
    return stepBattle(b)
  }
  const b = build(['blood_tithe'])
  const cost = Math.ceil(b.monarch.maxHp * TITHE)
  let hp = b.monarch.hp
  for (let k = 0; k < 2; k++) {
    const ev = raise(b)
    assert.ok(ev.some((e) => e.type === 'arise'), `raise ${k + 1}`)
    assert.deepEqual(ev.filter((e) => e.type === 'tithe').map(({ t, ...e }) => e), [{ type: 'tithe', target: 0, damage: cost, hp: hp - cost }])
    hp -= cost
    assert.equal(b.monarch.hp, hp)
    assert.ok(!ev.some((e) => e.type === 'trigger' && !(e.on === 'wave' && e.t === 0)), 'no relic fires on a raise or a tithe')
    assert.equal(b.blown, false, 'the tithe is not a blow')
  }
  assert.ok(!raise(b).some((e) => e.type === 'arise'), 'one copy: two raises with the tithe')
  // Without it, one raise and no tithe.
  const plain = build([])
  assert.ok(raise(plain).some((e) => e.type === 'arise') && !plain.events.some((e) => e.type === 'tithe'))
  assert.ok(!raise(plain).some((e) => e.type === 'arise'))
  // A Monarch the tithe would fell raises nothing.
  const weak = build(['blood_tithe'], cost)
  assert.ok(!raise(weak).some((e) => e.type === 'arise') && weak.monarch.hp === cost)
}))

test('Court of Bone: nothing heals the Monarch in battle; healers spend their heals elsewhere', () => {
  const build = (relics) => {
    const b = scene([on('monarch', 0, 'party', 3, 1), on('hive_warden', 1, 'party', 3, 2, 9), on('tomb_knight', 2, 'party', 0, 0),
      on('iron_golem', 50, 'foe', 6, 10)], { relics: [...relics, 'balm'] })
    b.monarch.hp = 30
    unit(b, 2).hp = Math.round(unit(b, 2).maxHp * 0.45)
    unit(b, 1).gauge = unit(b, 1).costliest
    return b
  }
  const b = build(['court_of_bone'])
  for (let k = 0; k < 300; k++) stepBattle(b)
  assert.equal(b.monarch.hp, 30)
  assert.ok(!b.events.some((e) => e.type === 'heal' && e.target === 0))
  assert.ok(b.events.some((e) => e.type === 'heal' && e.target === 2), 'the knight got the heal')
  // Without it, the Monarch (the most wounded) is healed first.
  const plain = build([])
  const ev = until(plain, (e) => e.some((x) => x.type === 'heal'))
  assert.equal(ev.find((x) => x.type === 'heal').target, 0)
  // Nor does a relic's heal: Balm mends the side around a fallen Ghoul, the wounded Monarch beside it aside.
  const balm = (relics) => {
    const b = scene([on('monarch', 0, 'party', 2, 4), on('tomb_knight', 1, 'party', 4, 4), on('grave_ghoul', 2, 'party', 3, 5, 1),
      on('tomb_knight', 10, 'foe', 3, 6, 9)], { relics: ['balm', ...relics] })
    b.monarch.hp = 30
    unit(b, 1).hp = 40
    unit(b, 2).hp = 1
    unit(b, 10).gauge = unit(b, 10).costliest
    const events = until(b, (e) => e.some((x) => x.type === 'death' && x.target === 2))
    return after(events, (e) => e.type === 'death' && e.target === 2).filter((e) => e.type === 'heal').map((e) => e.target)
  }
  assert.deepEqual(balm(['court_of_bone']), [1])
  assert.deepEqual(balm([]).sort(), [0, 1])
})

// ── Legendaries in the run ─────────────────────────────────────────────────────────────────────────

test('the run bends the domain: Court of Bone 2 tiles larger a copy, and the battle gets the bent radius', () => {
  const run = createRun({ seed: 'domain' })
  const s = run.state
  const D = TUNING.arise.domain
  const C = RELICS.court_of_bone.domain
  assert.equal(domainOf(s), D)
  s.relics = ['arise', 'court_of_bone']
  assert.equal(domainOf(s), D + C)
  visit(run, 'fight')
  const setup = battleSetup(run)
  assert.deepEqual([setup.domain, setup.relics], [D + C, ['arise', 'court_of_bone']])
  assert.equal(createBattle(setup).domain, D + C)
  s.relics.push('court_of_bone')
  assert.equal(domainOf(s), D + 2 * C)
})

test('Court of Bone: nothing heals the Monarch out of battle: not a win, not an altar, not an HP relic taken', () => {
  const wound = (run) => {
    run.state.relics = ['court_of_bone']
    monarchOf(run.state).hp = 40
  }
  const run = win('bone', wound)
  const m = monarchOf(run.state)
  assert.ok(m.hp <= 40, `${m.hp} after the win`)
  const hp = m.hp
  run.state.offers = [{ type: 'relic', id: 'phylactery', tier: 'rare', name: '', desc: '' }]
  apply(run, { type: 'reap', index: 0 })
  assert.equal(m.hp, hp, 'an HP relic raises its max HP, not its HP')
  assert.equal(m.maxHp, monarchHp(run.state))
  assert.ok(m.maxHp > hp)
  visit(run, 'altar')
  assert.equal(m.hp, hp, 'an altar does not heal it')
  // Without the relic a win heals it.
  const plain = win('bone', (r) => { monarchOf(r.state).hp = 40 })
  assert.ok(monarchOf(plain.state).hp > 40)
})

test('Hollow Court: the shadows still standing when a battle is won pay their essence again; the fallen do not', () => tuned({ arise: { ...FIRST_ARISE.arise, domain: 7 } }, () => {
  // A Monarch with a wide domain and three copies of Arise raises shadows; find a won fight where some still
  // stand and some fell. Shadows rise beside the Monarch, so the foes must reach it for one to fall: one soul fields,
  // and the Monarch has HP enough to outlast them.
  const fight = (seed, relics) => {
    const run = createRun({ seed })
    Object.assign(run.state, { relics: ['arise', 'arise', 'arise', ...relics] })
    const m = monarchOf(run.state)
    m.maxHp = m.hp = 3000
    for (const u of souls(run.state.party).slice(1)) u.slot = -1
    visit(run, 'fight')
    apply(run, { type: 'fight' })
    return run
  }
  for (let i = 0; i < 300; i++) {
    const run = fight('court' + i, ['hollow_court'])
    const shadows = run.state.phase === 'reap' ? run.battle.units.filter((u) => u.shadow && u.side === 'party') : []
    const kept = shadows.filter((u) => u.hp > 0)
    if (!kept.length || kept.length === shadows.length) continue
    // The same battle without the relic (it bends nothing in battle) pays the slain only.
    const plain = fight('court' + i, [])
    assert.equal(plain.battle.units.filter((u) => u.shadow && u.hp > 0).length, kept.length, 'the same battle')
    const court = kept.reduce((n, u) => n + foeEssence(u), 0)
    assert.ok(Math.abs(run.state.essence - plain.state.essence - court) <= 1, `${run.state.essence} − ${plain.state.essence} vs ${court}`)
    // Nothing is kept: no soul joins, no shadow outlives the battle, and the spoils are the same.
    assert.equal(run.state.party.length, plain.state.party.length)
    assert.deepEqual(run.state.offers, plain.state.offers)
    // Arise's shadows are the ones reaped (each `arisen`).
    assert.ok(kept.every((u) => u.arisen))
    assert.deepEqual(reapedShadows(run), kept)
    // A party shadow raised some other way is not Arise's: it is not reaped.
    const stray = { ...kept[0], uid: 9999, arisen: false }
    run.battle.units.push(stray)
    assert.ok(!reapedShadows(run).includes(stray))
    // The rules the battle was fought with decide: Hollow Court taken on the spoils after it reaps nothing of it.
    plain.state.relics.push('hollow_court')
    assert.deepEqual(reapedShadows(plain), [])
    // Two copies: each pays its essence twice again.
    const twice = fight('court' + i, ['hollow_court', 'hollow_court'])
    assert.ok(Math.abs(twice.state.essence - plain.state.essence - 2 * court) <= 1, `${twice.state.essence} − ${plain.state.essence} vs 2 × ${court}`)
    return
  }
  assert.fail('no battle left a shadow standing and one fallen')
}))

test('Legendaries are offered at won elites and reliquaries from floor 2, free, one held too, with no cap; an elite\'s apart from its other relics, a reliquary\'s one pick with everything else', () => {
  // Floor 1: a reliquary offers relics and tiers, no Legendary.
  const one = createRun({ seed: 'ks' })
  visit(one, 'reliquary')
  assert.ok(!one.state.offers.some((o) => offerGroup(o) === 'legendary'))
  assert.equal(one.state.offers.filter((o) => offerGroup(o) === 'relic').length, TUNING.relic.offer.reliquary)
  // Floor 2: a reliquary offers TUNING.relic.legendary.offer Legendaries beside its tiers and its relics.
  for (let i = 0; i < 30; i++) {
    const run = createRun({ seed: 'ks' + i })
    const s = run.state
    s.floor = 2
    s.relics = i % 2 ? ['legion', 'undying', 'arise'] : []
    visit(run, 'reliquary')
    const ks = s.offers.filter((o) => offerGroup(o) === 'legendary')
    assert.equal(ks.length, TUNING.relic.legendary.offer)
    assert.equal(new Set(ks.map((o) => o.id)).size, ks.length)
    for (const o of ks) assert.ok(o.type === 'relic' && o.tier === 'legendary' && o.name === RELICS[o.id].name && o.desc === RELICS[o.id].desc)
    assert.ok(s.offers.some((o) => o.type === 'tier'))
    assert.ok(legalActions(run).some((a) => a.type === 'reap' && offerGroup(s.offers[a.index] ?? {}) === 'legendary'))
  }
  // Taking one: it is held, and the reliquary is done (one pick): the tiers and the relics go with the other Legendary.
  const run = createRun({ seed: 'ks0' })
  const s = run.state
  s.floor = 2
  visit(run, 'reliquary')
  const index = s.offers.findIndex((o) => offerGroup(o) === 'legendary')
  const id = s.offers[index].id
  assert.ok(onePick(run))
  apply(run, { type: 'reap', index })
  assert.deepEqual([s.relics, s.offers, s.phase], [[id], [], 'map'])
  // Every Legendary held, twice: they are still offered, and one held is taken again.
  s.relics = [...LEGENDARIES, ...LEGENDARIES]
  visit(run, 'reliquary')
  const again = s.offers.findIndex((o) => offerGroup(o) === 'legendary')
  assert.ok(again >= 0)
  const twice = s.offers[again].id
  apply(run, { type: 'reap', index: again })
  assert.equal(relicCount(s, twice), 3)
  // A won elite on floor 2 offers its relics and Legendaries, one of each; on floor 1, relics only.
  const elite = win('kselite', (r) => { r.state.floor = 2 }, 'elite')
  assert.ok(!onePick(elite))
  assert.deepEqual([elite.state.offers.filter((o) => offerGroup(o) === 'relic').length, elite.state.offers.filter((o) => offerGroup(o) === 'legendary').length], [TUNING.relic.offer.elite, TUNING.relic.legendary.offer])
  const first = win('kselite', () => {}, 'elite')
  assert.ok(!first.state.offers.some((o) => offerGroup(o) === 'legendary'))
  assert.equal(first.state.offers.filter((o) => offerGroup(o) === 'relic').length, TUNING.relic.offer.elite)
  // A fought fight (not elite) offers none, floor 2 or not.
  assert.ok(!win('ksfight', (r) => { r.state.floor = 2 }).state.offers.some((o) => o.type === 'relic'))
})

test('the autoplayer and Legendaries: basic takes the first free offer; the expert weighs Legendaries by rehearsal and takes one', () => tuned({ party: { fieldPerFloor: 0 } }, () => {
  // The scene is built on a floor-2 field of 3 banners (before round 2 gave a banner a floor down).
  const offerRoom = (seed) => {
    const run = createRun({ seed })
    run.state.floor = 2
    visit(run, 'reliquary')
    // Only the Legendaries are left on the table.
    run.state.offers = run.state.offers.filter((o) => offerGroup(o) === 'legendary')
    return run
  }
  const rng = createRng('ksauto').stream('autoplay')
  const basic = offerRoom('ksauto')
  assert.deepEqual(policy(basic, rng, 'basic'), { type: 'reap', index: 0 })
  const mixed = createRun({ seed: 'ksauto' })
  mixed.state.floor = 2
  visit(mixed, 'reliquary')
  assert.deepEqual(policy(mixed, rng, 'basic'), { type: 'reap', index: 0 }, 'the first free offer, whatever it is')
  assert.equal(offerGroup(mixed.state.offers[0]), 'relic')
  // A reliquary is one pick: with the relic taken the room is done.
  apply(mixed, policy(mixed, rng, 'basic'))
  assert.deepEqual([mixed.state.relics.length, mixed.state.offers, mixed.state.phase], [1, [], 'map'])
  const expert = offerRoom('ksauto')
  const a = policy(expert, rng, 'expert')
  assert.equal(a.type, 'reap')
  assert.equal(offerGroup(expert.state.offers[a.index]), 'legendary')
  apply(expert, a)
  assert.equal(expert.state.relics.length, 1)
  // The rehearsal sees what a Legendary does: with two strong souls waiting on the bench, Legion's two more
  // banners beat Hollow Court (which changes no battle), though Hollow Court is offered first.
  const bench = offerRoom('ksbench')
  for (const id of ['tomb_knight', 'grave_ghoul']) {
    const u = join(bench, id)
    Object.assign(u, { lvl: 6, hp: baseStats(id, 6).hp, maxHp: baseStats(id, 6).hp })
  }
  assert.equal(souls(bench.state.party).filter((u) => u.slot < 0).length, 2)
  bench.state.offers = [{ type: 'relic', id: 'hollow_court', tier: 'legendary', name: '', desc: '' }, { type: 'relic', id: 'legion', tier: 'legendary', name: '', desc: '' }]
  assert.deepEqual(policy(bench, rng, 'expert'), { type: 'reap', index: 1 })
  // A plan (made once and kept while nothing it rests on changes) is keyed on the relics held: once Legion
  // is, it fields the souls waiting.
  const placed = (run) => planFor(run, LEVELS.basic).filter((p) => p.uid !== 0 && p.slot >= 0).length
  assert.equal(placed(bench), 3)
  bench.state.relics.push('legion')
  assert.equal(placed(bench), fieldCap(bench))
  assert.equal(fieldCap(bench), 5)
  // Weighing an HP relic under Court of Bone, it counts on no heal from it; another relic leaves the Monarch as it is.
  const s = createRun({ seed: 'kspoint' }).state
  monarchOf(s).hp = 40
  const hpRelic = { type: 'relic', id: 'bone_mantle' }
  const healed = offerState(s, hpRelic).party.find((u) => u.uid === 0)
  assert.deepEqual([healed.hp, healed.maxHp], [40 + RELICS.bone_mantle.monarchHp, monarchOf(s).maxHp + RELICS.bone_mantle.monarchHp])
  s.relics = ['court_of_bone']
  const court = offerState(s, hpRelic).party.find((u) => u.uid === 0)
  assert.deepEqual([court.hp, court.maxHp], [40, healed.maxHp])
  assert.deepEqual(offerState(s, { type: 'relic', id: 'grave_banner' }), { relics: ['court_of_bone', 'grave_banner'] })
}))


// ── Court of Bone's aim ─────────────────────────────────────────────────────────────────────────

test('Court of Bone turns only heals away from the Monarch: a buff still goes to it', () => {
  // A Gearwright page (Purge become Overclock: Hasten, on the most wounded ally), holding its tile; the Monarch is
  // the most wounded.
  const b = scene([on('monarch', 0, 'party', 3, 1), { ...on('clockwork_page', 1, 'party', 3, 2, 9), tracks: [0, 3] }, on('tomb_knight', 2, 'party', 0, 0),
    on('iron_golem', 50, 'foe', 6, 10)], { relics: ['court_of_bone'] })
  b.monarch.hp = 30
  unit(b, 1).gauge = unit(b, 1).costliest
  const events = until(b, (ev) => ev.some((e) => e.type === 'action' && e.actor === 1))
  const cast = events.find((e) => e.type === 'action' && e.actor === 1)
  assert.deepEqual([cast.ability, cast.targets], ['overclock', [0]])
})

// ── the Legendaries soaked ─────────────────────────────────────────────────────────────────────────

test('every Legendary, alone, together and twice over, plays deterministically and keeps the battle\'s invariants', () => {
  // Real elites from floors 2–4, against souls of level 9 with a summoner, three copies of Arise (a wider domain
  // and more raises, so Arise raises), every trigger relic, and souls carried in wounded (so some fall and rise).
  const all = LEGENDARIES
  const combos = [...all.map((id) => [id]), all, ['undying', 'legion'], ['court_of_bone', 'blood_tithe'], [...all, ...all], ['undying', 'undying', 'blood_tithe', 'blood_tithe']]
  const seen = new Set()
  const counts = {}
  for (let i = 0; i < 6; i++) {
    const run = createRun({ seed: 'soak' + i })
    const s = run.state
    s.floor = 2
    const node = visit(run, 'elite')
    node.foes = encounter(s.seed, 2 + (i % 3), node)
    const caps = fielded(souls(s.party))
    // The chanter fights with a body more (Marrowcaller II).
    Object.assign(caps.find((u) => u.id === 'bone_chanter'), { tracks: [0, 2] })
    for (const u of caps) Object.assign(u, { lvl: 9, maxHp: baseStats(u.id, 9).hp, hp: Math.max(1, Math.round(baseStats(u.id, 9).hp * (i % 2 ? 0.25 : 0.6))) })
    for (const legend of combos) {
      for (const id of legend) seen.add(id)
      s.relics = [...RELIC_LIST.filter((r) => r.on).map((r) => r.id), 'heartwood', 'arise', 'arise', 'arise', ...legend]
      const setup = battleSetup(run)
      const b = createBattle(setup)
      const ks = b.held
      while (!b.over) {
        for (const e of stepBattle(b)) {
          counts[e.type] = (counts[e.type] ?? 0) + 1
          if (e.type === 'rise') assert.notEqual(e.target, 0, 'the Monarch never rises')
          if (e.type === 'heal' && ks.unhealable) assert.notEqual(e.target, 0, 'Court of Bone: no heal for the Monarch')
          if (e.type === 'tithe') assert.ok(e.hp > 0, 'the tithe never fells the Monarch')
        }
        for (const u of b.units) {
          assert.ok(u.hp >= 0 && u.hp <= u.maxHp, `${legend} t${b.t}: ${u.uid} at ${u.hp}/${u.maxHp}`)
          if (alive(u)) assert.equal((u.flies ? b.sky : b.at)[u.tile], u, `${legend} t${b.t}: ${u.uid} off the index`)
        }
        for (const [layer, flies] of [[b.at, false], [b.sky, true]]) {
          assert.ok(layer.every((u, t) => u === null || (alive(u) && !!u.flies === flies && footprint(u.tile, u.size).includes(t))), `${legend} t${b.t}: the index`)
        }
      }
      // The same setup plays the same battle.
      assert.deepEqual(runBattle(createBattle(setup)).events, b.events, `${legend}: replayed`)
    }
  }
  assert.deepEqual([...seen].sort(), all.slice().sort(), 'every Legendary soaked')
  for (const type of ['rise', 'tithe', 'arise', 'move', 'trigger']) assert.ok(counts[type] > 0, `no ${type} in the soak`)
})

test('a reliquary lays a kind\'s tier IV beside its relics and the Legendaries, one pick in all; and Legion\'s souls stop at the board', () => {
  const run = createRun({ seed: 'm7' })
  const s = run.state
  s.relics = ['legion']
  assert.equal(fieldCap(run), TUNING.party.field + 2)
  s.relics = ['legion', ...Array(20).fill('grave_banner')]
  assert.equal(fieldCap(run), TUNING.army.board)
  assert.equal(commandOf(s), TUNING.party.field + 22, 'Command itself has no cap; the field has')
  s.relics = ['legion']
  s.floor = 2
  const k = souls(s.party)[0]
  assert.equal(k.id, 'tomb_knight')
  // Track 1 stopped at II by the crosspath rule: its one tier to offer is track 0's IV.
  s.kinds.tomb_knight.tracks = [3, 2]
  k.tracks = [3, 2]
  visit(run, 'reliquary')
  assert.ok(s.offers.some((o) => o.type === 'tier' && o.kind === 'tomb_knight' && o.track === 0), JSON.stringify(s.offers))
  assert.equal(s.offers.filter((o) => offerGroup(o) === 'legendary').length, TUNING.relic.legendary.offer)
  assert.equal(s.offers.filter((o) => offerGroup(o) === 'relic').length, TUNING.relic.offer.reliquary)
  apply(run, { type: 'reap', index: s.offers.findIndex((o) => o.type === 'tier' && o.kind === 'tomb_knight') })
  assert.deepEqual([s.kinds.tomb_knight.tracks, k.tracks], [[4, 2], [4, 2]])
  assert.deepEqual([s.relics, s.offers, s.phase], [['legion'], [], 'map'], 'one pick: the relics and Legendaries go with it')
})

// ── the Monarch's HP and Command ─────────────────────────────────────────────────────────────────

test('the Monarch\'s HP and Command are relics: a family of each, every copy adding in full (HP healed by its gain), Command widening the field up to the board', () => {
  const run = createRun({ seed: 'hp-command' })
  const s = run.state
  const m = monarchOf(s)
  assert.deepEqual([m.maxHp, monarchHp(s), commandOf(s), fieldCap(run)], [TUNING.monarch.hp, TUNING.monarch.hp, TUNING.party.field, TUNING.party.field])
  const HP = RELIC_LIST.filter((r) => r.monarchHp)
  const COMMAND = RELIC_LIST.filter((r) => r.command && r.tier !== 'legendary')
  assert.deepEqual(HP.map((r) => r.tier), ['common', 'uncommon', 'rare'])
  assert.deepEqual(COMMAND.map((r) => r.tier), ['common', 'uncommon', 'rare'])
  assert.ok([...HP, ...COMMAND].every((r) => !r.needsArise && r.desc), 'offered from the start')
  // Taken one after another, copies too: each adds its HP (healing by as much) or its Command.
  m.hp = 100
  let [hp, max, command] = [100, m.maxHp, commandOf(s)]
  for (const r of [...HP, ...COMMAND, HP[0], HP[0], COMMAND[2], COMMAND[2]]) {
    Object.assign(s, { phase: 'reap', offers: [{ type: 'relic', id: r.id, tier: r.tier, name: r.name, desc: r.desc }] })
    apply(run, { type: 'reap', index: 0 })
    hp += r.monarchHp ?? 0
    max += r.monarchHp ?? 0
    command += r.command ?? 0
    assert.deepEqual([m.hp, m.maxHp, monarchHp(s), commandOf(s), fieldCap(run)], [hp, max, max, command, Math.min(TUNING.army.board, command)], r.id)
  }
  assert.equal(command, TUNING.party.field + 5)
  // The cheaper Command relics cost the souls HP, compounding a copy each (as Legion's does); the battle's Monarch is
  // the run's, max HP and all.
  visit(run, 'fight')
  const setup = battleSetup(run)
  const hpMods = setup.partyMods.filter((x) => x.path === 'hp').map((x) => x.v)
  assert.deepEqual(hpMods, COMMAND.filter((r) => r.mods).map((r) => r.mods[0].v))
  const b = createBattle(setup)
  assert.deepEqual([b.monarch.hp, b.monarch.maxHp], [m.hp, m.maxHp])
})

test('every won elite lays out a Command relic among its relics, on every floor and whatever the tier weights, so the field never grows by luck alone', () => {
  // The souls at level 10 and a Monarch that takes a while to fell, so most elites are won.
  const strong = (run, floor) => {
    run.state.floor = floor
    for (const u of souls(run.state.party)) Object.assign(u, { lvl: 10, hp: baseStats(u.id, 10).hp, maxHp: baseStats(u.id, 10).hp })
    Object.assign(monarchOf(run.state), { hp: 5000, maxHp: 5000 })
  }
  const elites = (prefix, n) => {
    let seen = 0
    for (let i = 0; i < 4 * n && seen < n; i++) {
      const run = createRun({ seed: `${prefix}${i}` })
      strong(run, 1 + (i % 4))
      visit(run, 'elite')
      apply(run, { type: 'fight' })
      if (run.state.phase !== 'reap') continue
      seen++
      const relics = run.state.offers.filter((o) => offerGroup(o) === 'relic')
      assert.equal(relics.length, TUNING.relic.offer.elite)
      assert.equal(relics.filter((o) => RELICS[o.id].command > 0).length >= 1, true, JSON.stringify(relics))
    }
    assert.ok(seen >= n / 2, `${seen} elites won`)
  }
  elites('cmd', 12)
  // With every tier weighed but one, the Command relic is that tier's.
  for (const tier of ['common', 'rare']) {
    tuned({ relic: { ...TUNING.relic, weights: { ...TUNING.relic.weights, elite: [{ common: 0, uncommon: 0, rare: 0, [tier]: 1 }] } } }, () => elites(`cmd-${tier}`, 4))
  }
})

// ── copies, tiers and Arise ──────────────────────────────────────────────────────────────────────

test('copies stack: two of a mod relic compound, a trigger relic held twice fires twice, numbers add a copy', () => {
  // Two Whetstones: ATK × its mod twice, on every soul (never the Monarch).
  const run = createRun({ seed: 'copies' })
  const s = run.state
  visit(run, 'fight')
  const atk = (relics) => {
    s.relics = relics
    const b = createBattle(battleSetup(run))
    return stats(b, b.units.find((u) => u.side === 'party' && u !== b.monarch)).atk
  }
  const bare = atk([])
  const w = RELICS.whetstone.mods[0].v
  assert.ok(Math.abs(atk(['whetstone']) - bare * w) < 1e-6)
  assert.ok(Math.abs(atk(['whetstone', 'whetstone']) - bare * w * w) < 1e-6)
  // Legion twice: four more on the field, HP × 0.85 twice over.
  s.relics = ['legion', 'legion']
  assert.equal(fieldCap(run), TUNING.party.field + 4)
  assert.deepEqual(battleSetup(run).partyMods, [...LEGION, ...LEGION])
  // A trigger relic twice: Blood Chalice fires a copy at a time, and the killer heals twice.
  const { next } = killing(['blood_chalice', 'blood_chalice'])
  assert.deepEqual(next.filter((e) => e.type === 'trigger').map((e) => e.relic), ['blood_chalice', 'blood_chalice'])
  assert.equal(next.filter((e) => e.type === 'heal' && e.target === 1).length, 2)
  // Numbers add: the field, the ossuary, the Monarch's max HP, a price's discount (never below 1 essence).
  s.relics = ['grave_banner', 'grave_banner', 'ossuary_key', 'ossuary_key', 'grave_shroud', 'grave_shroud']
  assert.deepEqual([fieldCap(run), rosterCap(run), monarchHp(s)], [TUNING.party.field + 2, TUNING.party.roster + 6, TUNING.monarch.hp + 2 * RELICS.grave_shroud.monarchHp])
  s.relics = []
  const full = tierCost(run, 'tomb_knight', 0)
  s.relics = ['grave_ledger']
  assert.equal(tierCost(run, 'tomb_knight', 0), Math.max(1, Math.round(full * (1 - RELICS.grave_ledger.lowTierDiscount))))
  s.relics = ['grave_ledger', 'rite_candle']
  assert.equal(tierCost(run, 'tomb_knight', 0), Math.max(1, Math.round(full * (1 - RELICS.grave_ledger.lowTierDiscount - RELICS.rite_candle.tierDiscount))))
  s.relics = Array(6).fill('grave_ledger')
  assert.equal(tierCost(run, 'tomb_knight', 0), 1)
  // Undying twice: a soul rises twice a battle, and its third fall is for good.
  const units = [on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 5), on('iron_golem', 50, 'foe', 6, 10)]
  const b = felled(units, 1, ['undying', 'undying'])
  const knight = unit(b, 1)
  for (let k = 0; k < 3; k++) {
    knight.hp = 1
    unit(b, 40).gauge = unit(b, 40).costliest
    const ev = until(b, (e) => e.filter((x) => x.type === 'death' && x.target === 1).length > 0)
    const rose = after(ev, (e) => e.type === 'death' && e.target === 1).some((e) => e.type === 'rise')
    assert.equal(rose, k < 2, `fall ${k + 1}`)
  }
  assert.ok(!alive(knight))
  // Mimicry twice: a lone Vanguard counts as two Wardens.
  const lone = [makeUnit('tomb_knight', { uid: 1 })]
  assert.ok(!activeSynergies(lone, relicRules(['mimicry']).alias).some((x) => x.id === 'warden_2'))
  assert.ok(activeSynergies(lone, relicRules(['mimicry', 'mimicry']).alias).some((x) => x.id === 'warden_2'))
  // Blood Tithe twice: the cap grows by itself twice over, and each shadow costs twice the tithe.
  const tithe = relicRules(['arise', 'blood_tithe', 'blood_tithe'])
  assert.deepEqual([ariseCap(tithe), tithe.tithe], [TUNING.arise.raises * 3, 2 * TITHE])
})

test('no cap: a relic held is offered again and taken again, however many the run holds', () => {
  const others = RELIC_LIST.filter((r) => r.tier !== 'legendary' && !r.needsArise).map((r) => r.id)
  for (let i = 0; i < 10; i++) {
    const run = createRun({ seed: 'nocap' + i })
    const s = run.state
    // Every relic but the Legendaries held, three times over: a reliquary still lays out its full offer of relics.
    s.relics = [...others, ...others, ...others]
    visit(run, 'reliquary')
    const relics = s.offers.filter((o) => o.type === 'relic')
    assert.equal(relics.length, TUNING.relic.offer.reliquary)
    assert.equal(new Set(relics.map((o) => o.id)).size, relics.length, 'never the same relic twice in one offer')
    const o = s.offers[0]
    assert.ok(legalActions(run).some((a) => a.type === 'reap' && a.index === 0))
    apply(run, { type: 'reap', index: 0 })
    assert.equal(relicCount(s, o.id), 4)
    assert.equal(s.relics.length, 3 * others.length + 1)
  }
})

test('the tiers a room draws: by TUNING.relic.weights for its floor, the last entry past them; a tier weighed 0 never comes', () => {
  assert.deepEqual(relicWeights('reliquary', 1), TUNING.relic.weights.reliquary[0])
  assert.deepEqual(relicWeights('elite', 99), TUNING.relic.weights.elite.at(-1))
  assert.deepEqual(Object.keys(TUNING.relic.weights).sort(), ['elite', 'reliquary'], 'no rite')
  for (const room of ['reliquary', 'elite']) {
    for (const w of TUNING.relic.weights[room]) assert.deepEqual(Object.keys(w).sort(), ['common', 'rare', 'uncommon'], room)
  }
  const only = (tier) => ({ relic: { ...TUNING.relic, weights: { reliquary: [{ common: 0, uncommon: 0, rare: 0, [tier]: 1 }], elite: TUNING.relic.weights.elite } } })
  for (const tier of ['common', 'uncommon', 'rare']) {
    tuned(only(tier), () => {
      for (let i = 0; i < 8; i++) {
        const run = createRun({ seed: `tier-${tier}-${i}` })
        visit(run, 'reliquary')
        const relics = run.state.offers.filter((o) => o.type === 'relic')
        assert.ok(relics.length && relics.every((o) => o.tier === tier && RELICS[o.id].tier === tier), JSON.stringify(run.state.offers))
      }
    })
  }
  // Rare only, with fewer rares than the offer asks for: the offer is as many as there are.
  const rares = RELIC_LIST.filter((r) => r.tier === 'rare').length
  tuned({ relic: { ...TUNING.relic, offer: { ...TUNING.relic.offer, reliquary: rares + 2 }, weights: { ...TUNING.relic.weights, reliquary: [{ common: 0, uncommon: 0, rare: 1 }] } } }, () => {
    const run = createRun({ seed: 'tier-few' })
    visit(run, 'reliquary')
    assert.equal(run.state.offers.filter((o) => o.type === 'relic').length, rares)
  })
})

test('Arise is a Legendary: without it no shadow rises; each copy past the first raises more', () => tuned(FIRST_ARISE, () => {
  // Six slain Ghouls about the Monarch, its gauge filled again and again.
  const raised = (relics) => {
    const ghouls = [[2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3]].map(([x, y], k) => on('grave_ghoul', 10 + k, 'foe', x, y, 1))
    const b = scene([on('monarch', 0, 'party', 3, 1), on('tomb_knight', 1, 'party', 0, 0), ...ghouls, on('iron_golem', 50, 'foe', 6, 10)], { relics })
    for (const g of ghouls) slay(b, unit(b, g.uid))
    let n = 0
    for (let k = 0; k < 6; k++) {
      b.monarch.gauge = 200
      n += stepBattle(b).filter((e) => e.type === 'arise').length
    }
    return n
  }
  assert.equal(raised([]), 0)
  assert.equal(raised(['hourglass', 'court_of_bone']), 0, 'nor with what needs it, without it')
  const { raises, more } = TUNING.arise
  assert.equal(raised(['arise']), raises)
  assert.equal(raised(['arise', 'arise']), raises + more.raises)
  assert.equal(raised(['arise', 'arise', 'arise']), raises + 2 * more.raises)
  assert.deepEqual([ariseCap(relicRules([])), ariseCap(relicRules(['arise'])), ariseCap(relicRules(['arise', 'arise'])), ariseCap()],
    [0, raises, raises + more.raises, 0])
  // In a run's battles: a wide domain raises no one without Arise, and some with it.
  const fought = (relics) => tuned({ arise: { domain: 9 } }, () => {
    let n = 0
    for (let i = 0; i < 6; i++) {
      const run = createRun({ seed: 'arise-run' + i })
      run.state.relics = relics
      visit(run, 'fight')
      apply(run, { type: 'fight' })
      n += run.battle.events.filter((e) => e.type === 'arise').length
    }
    return n
  })
  assert.equal(fought([]), 0)
  assert.ok(fought(['arise', 'arise', 'arise']) > 0)
}))

test('Arise\'s numbers are the relic\'s, a copy at a time: each past the first reaches farther, raises a tier higher and more a battle, and hastens its gauge; the battle takes them from the run', () => {
  const run = createRun({ seed: 'gate' })
  const s = run.state
  const A = TUNING.arise
  assert.equal(ariseHeld(s), false)
  assert.deepEqual(ariseOf(s), { copies: 0, domain: A.domain, raises: 0, tier: A.tier, haste: 0 })
  assert.ok(!('monarch' in s), 'the Monarch has no stats of its own')
  assert.deepEqual(Object.keys(TUNING.monarch), ['hp'], 'nor any of Arise\'s')
  for (const copies of [1, 2, 3, 4]) {
    s.relics = Array(copies).fill('arise')
    const more = copies - 1
    const a = ariseOf(s)
    assert.deepEqual(a, {
      copies, domain: A.domain + A.more.domain * more, raises: A.raises + A.more.raises * more, tier: A.tier + A.more.tier * more, haste: A.more.haste * more
    }, `${copies} copies`)
    assert.equal(domainOf(s), a.domain)
  }
  // The relic's words keep in step with its numbers (content.js writes them out).
  const step = (n, one, many) => (n === 1 ? `a ${one}` : `${n} ${many}`)
  assert.equal(RELICS.arise.desc, `A foe of tier ${A.tier} or lower slain within ${A.domain} tiles of the Monarch rises as your shadow, ${A.raises} a battle. ` +
    `Each copy: ${step(A.more.domain, 'tile', 'tiles')} farther, ${step(A.more.tier, 'tier', 'tiers')} higher, ${A.more.raises} more a battle, and it comes ${Math.round(A.more.haste * 100)}% sooner.`)
  // Court of Bone's tiles and Blood Tithe's raises come on top; the battle gets the reach, and reads the rest from the
  // relics it holds: its cap, its tier, and the Monarch's gauge.
  s.relics = ['arise', 'arise', 'court_of_bone', 'blood_tithe']
  const a = ariseOf(s)
  assert.deepEqual([a.domain, a.raises], [A.domain + A.more.domain + RELICS.court_of_bone.domain, ariseCap(relicRules(s.relics))])
  assert.equal(a.raises, (A.raises + A.more.raises) * 2)
  visit(run, 'fight')
  const setup = battleSetup(run)
  assert.equal(setup.domain, a.domain)
  const b = createBattle(setup)
  assert.deepEqual([b.domain, ariseCap(b.held), ariseTier(b.held), ariseHaste(b.held)], [a.domain, a.raises, a.tier, a.haste])
  assert.ok(Math.abs(stats(b, b.monarch).gauge.rate - (1 + a.haste)) < 1e-9, 'the Monarch\'s gauge, hastened')
  // A corpse a tier past Arise's rises only with a copy more (a tier higher).
  const corpse = UNIT_LIST.find((u) => u.spawn && !u.flies && u.tier === A.tier + 1).id
  const raisedTier = (relics) => {
    const b = scene([on('monarch', 0, 'party', 3, 1), on(corpse, 10, 'foe', 3, 3, 1), on('iron_golem', 50, 'foe', 6, 10)], { relics })
    slay(b, unit(b, 10))
    b.monarch.gauge = 200
    return stepBattle(b).filter((e) => e.type === 'arise').length
  }
  assert.equal(unitDef(corpse).tier, A.tier + 1)
  assert.deepEqual([raisedTier(['arise']), raisedTier(['arise', 'arise'])], [0, 1])
})

test('Arise\'s numbers a copy at a time are the ones its two points a copy past the first gave, for 0 to 3 copies, with and without Blood Tithe and Court of Bone', () => {
  // TUNING as it stood before (2026-10-09, late): the Monarch's domain, raiseTier, raises and willHaste, and a point
  // of each of the two a copy past the first; the reach domain + a point (and Court of Bone's tiles), the tier
  // raiseTier + the other point, the cap raises × (copies + that point) grown by Blood Tithe's share, the haste
  // willHaste × that point. With TUNING.arise at today's numbers, every one is the same.
  const was = { domain: 5, raiseTier: 3, raises: 3, haste: 0.1 }
  const old = (relics) => {
    const n = (id) => relics.filter((x) => x === id).length
    const point = Math.max(0, n('arise') - 1)
    return {
      copies: n('arise'), domain: was.domain + point + RELICS.court_of_bone.domain * n('court_of_bone'),
      raises: n('arise') ? was.raises * (n('arise') + point) * (1 + RELICS.blood_tithe.raises * n('blood_tithe')) : 0,
      tier: was.raiseTier + point, haste: was.haste * point
    }
  }
  tuned({ arise: { domain: 5, tier: 3, raises: 3, hp: 1, more: { domain: 1, tier: 1, raises: 6, haste: 0.1 } } }, () => {
    const run = createRun({ seed: 'was' })
    const s = run.state
    visit(run, 'fight')
    for (const copies of [0, 1, 2, 3]) {
      for (const also of [[], ['blood_tithe'], ['court_of_bone'], ['blood_tithe', 'court_of_bone'], ['blood_tithe', 'blood_tithe', 'court_of_bone']]) {
        s.relics = [...Array(copies).fill('arise'), ...also]
        const now = ariseOf(s)
        const then = old(s.relics)
        const at = `${copies} copies, ${also.join(' ') || 'alone'}`
        assert.deepEqual({ ...now, haste: +now.haste.toFixed(9) }, { ...then, haste: +then.haste.toFixed(9) }, at)
        // As the battle takes them: the reach from the run, the cap, the tier and the haste from the relics.
        const b = createBattle(battleSetup(run))
        assert.deepEqual([b.domain, ariseCap(b.held), ariseTier(b.held)], [then.domain, then.raises, then.tier], at)
        assert.ok(Math.abs(stats(b, b.monarch).gauge.rate - (1 + then.haste)) < 1e-9, at)
      }
    }
  })
})

test('what needs Arise is offered only once it is held: Hollow Court, Blood Tithe, Court of Bone, Hourglass, Bone Idol', () => {
  const needs = RELIC_LIST.filter((r) => r.needsArise).map((r) => r.id)
  const offered = (relics) => {
    const seen = new Set()
    for (let i = 0; i < 80; i++) {
      const run = createRun({ seed: `needs-reliquary-${i}` })
      run.state.floor = 2 + (i % 3)
      run.state.relics = relics.slice()
      visit(run, 'reliquary')
      for (const o of run.state.offers.filter((x) => x.type === 'relic')) seen.add(o.id)
    }
    return seen
  }
  const without = offered(['legion'])
  assert.deepEqual(needs.filter((id) => without.has(id)), [])
  assert.ok(without.has('arise'), 'Arise itself is offered')
  const held = offered(['arise'])
  assert.deepEqual(needs.filter((id) => !held.has(id)), [], 'each comes once Arise is held')
  assert.ok(held.has('arise'), 'and Arise again')
})

test('a run holding copies saves and replays exactly: the log rebuilds its relics, repeats and all', () => {
  // The reliquaries and elites draw from the rares alone, so copies come soon.
  const rare = { reliquary: [{ common: 0, uncommon: 0, rare: 1 }], elite: [{ common: 0, uncommon: 0, rare: 1 }] }
  tuned({ relic: { ...TUNING.relic, weights: rare } }, () => {
    for (let i = 0; i < 60; i++) {
      const run = autoplay(createRun({ seed: 'copysave' + i }))
      const s = run.state
      if (!s.relics.some((id) => relicCount(s, id) > 1)) continue
      const again = replay(s.seed, s.log)
      assert.deepEqual(again.state, s)
      assert.deepEqual(structuredClone(s).relics, s.relics, 'the relics are plain ids')
      return
    }
    assert.fail('no run took a relic twice')
  })
})
