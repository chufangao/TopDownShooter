import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBattle, stepBattle, runBattle, keystoneRules, stats } from '../src/sim/battle.js'
import {
  createRun, apply, availableNodes, battleSetup, fieldCap, domainOf, souls, monarchOf, fielded, legalActions, join, reapedShadows, encounter, foeEssence
} from '../src/sim/run.js'
import { policy, planFor, LEVELS, withPoint } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { tuned, FIRST_ARISE } from './tuned.js'
import { KEYSTONE_LIST, KEYSTONES, RELIC_LIST, RELICS, TRIGGERS, STATUSES } from '../src/content.js'
// The keystones' numbers, as content sets them: Legion's HP share, Undying's rise, Blood Tithe's tithe.
const LEGION_HP = KEYSTONES.legion.mods[0].v
const RISE = KEYSTONES.undying.rise
const TITHE = KEYSTONES.blood_tithe.tithe
import { makeUnit, tileAt, tileX, tileY, slotAt, DEPTH, alive, activeSynergies, baseStats } from '../src/sim/unit.js'

// ── helpers (as battle.test.js and run.test.js have them) ───────────────────────────────────────

// A unit placed on a board tile directly, for battles built tile by tile.
const on = (id, uid, side, x, y, lvl = 3) => ({ ...makeUnit(id, { uid, lvl }), side, tile: tileAt(x, y) })
// A summon of `captain`'s, standing on a tile from the start (as battle.js summon makes them: holding there).
const member = (id, uid, captain, x, y, lvl = 3) => ({ ...on(id, uid, 'party', x, y, lvl), summoned: true, summoner: captain })

// A battle of units placed on tiles (the party in its camp, y 0–6; a foe anywhere). The ones not named in
// `moving` never step. A soul's summon tiers raise nothing here (the summons switch) unless `summons`: the
// scenes place every unit themselves.
function scene (units, { moving = [], summons = false, ...opts } = {}) {
  const foeRow0 = DEPTH - 3
  const spare = [...Array(21).keys()].filter((slot) => !units.some((u) => u.side === 'foe' && tileY(u.tile) >= foeRow0 && slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) === slot))
  const slot = (u) => u.side === 'party' ? slotAt(6 - tileY(u.tile), tileX(u.tile))
    : tileY(u.tile) >= foeRow0 ? slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) : spare.shift()
  const placed = units.map((u) => ({ ...u, slot: slot(u) }))
  const b = createBattle({ party: placed.filter((u) => u.side === 'party'), foes: placed.filter((u) => u.side === 'foe'), seed: 'scene', ...(!summons && { ablate: ['summons'] }), ...opts })
  for (const u of b.units) {
    const want = units.find((x) => x.uid === u.uid)?.tile
    if (want === undefined) continue
    if (u.tile !== want) {
      b.at[u.tile] = null
      u.tile = want
      b.at[want] = u
    }
    if (!moving.includes(u.uid)) u.nextStep = Infinity
  }
  return b
}

// Lays a unit dead where it stands (a corpse for Arise), as a blow would.
function slay (b, u) {
  u.hp = 0
  u.statuses = []
  b.at[u.tile] = null
  b.roster++
  if (u.side === 'party') b.ours++
}

const unit = (b, uid) => b.units.find((u) => u.uid === uid)

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

// Turn the first reachable node into `type` and walk in (battle rooms keep their foes).
function visit (run, type) {
  const node = availableNodes(run)[0]
  node.type = type
  if (['fight', 'elite', 'boss'].includes(type)) node.foes ??= run.state.map.nodes.find((n) => n.foes).foes
  apply(run, { type: 'node', id: node.id })
  return node
}

// ── content ──────────────────────────────────────────────────────────────────────────────────────

test('the keystones are the six left of the design\'s eight (One Army is the stack rule now, Vanguard Crown\'s centre the roads\' root), each a rule; most relics now trigger, a few flat ones stay', () => {
  assert.deepEqual(KEYSTONE_LIST.map((k) => k.id), ['legion', 'undying', 'mimicry', 'hollow_court', 'blood_tithe', 'court_of_bone'])
  const RULES = ['field', 'mods', 'rise', 'alias', 'domain', 'reap', 'raises', 'tithe', 'unhealable']
  for (const k of KEYSTONE_LIST) {
    assert.ok(k.name && k.desc, k.id)
    const rules = Object.keys(k).filter((key) => !['id', 'name', 'desc'].includes(key))
    assert.ok(rules.length && rules.every((r) => RULES.includes(r)), `${k.id}: ${rules}`)
  }
  assert.deepEqual(keystoneRules(['legion', 'blood_tithe', 'court_of_bone']), {
    mods: [{ path: 'hp', op: 'mul', v: LEGION_HP }], rise: 0, alias: null, raises: 2, tithe: TITHE, unhealable: true
  })
  assert.deepEqual(keystoneRules([]), { mods: [], rise: 0, alias: null, raises: 1, tithe: 0, unhealable: false })
  // At least half the relics trigger, each on a known moment with effects whose ops, statuses and targets
  // resolve; a few flat stat relics stay as filler.
  const triggers = RELIC_LIST.filter((r) => r.on)
  assert.ok(triggers.length * 2 >= RELIC_LIST.length, `${triggers.length} of ${RELIC_LIST.length}`)
  assert.ok(RELIC_LIST.filter((r) => r.mods).length >= 2, 'flat relics stay')
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

test('Blood Chalice: when one of yours slays a foe, the killer heals 10% of its max HP', () => {
  const { b, next } = killing(['blood_chalice'])
  const knight = unit(b, 1)
  assert.deepEqual(next.slice(0, 2), [
    { t: next[0].t, type: 'trigger', relic: 'blood_chalice', on: 'kill', unit: 1 },
    { t: next[0].t, type: 'heal', actor: 1, target: 1, heal: Math.round(knight.maxHp * 0.1), hp: next[1].hp }
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
function falling (relics, keystones = []) {
  const b = scene([on('monarch', 0, 'party', 0, 0), on('tomb_knight', 1, 'party', 4, 4), on('grave_ghoul', 2, 'party', 3, 5, 1),
    on('frost_sprite', 3, 'party', 6, 1), on('tomb_knight', 10, 'foe', 3, 6, 9)], { relics, keystones })
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

test('Balm: when one of yours falls, your side within 2 tiles of it heals 12% of its max HP', () => {
  const { b, next } = falling(['balm'])
  assert.equal(next[0].relic, 'balm')
  const heals = next.filter((e) => e.type === 'heal')
  assert.deepEqual(heals.map((e) => [e.target, e.heal]), [[1, Math.round(unit(b, 1).maxHp * 0.12)]])
})

test('Bone Idol: when one of yours falls, Arise gains 40 gauge', () => {
  const { next } = falling(['bone_idol'])
  assert.deepEqual(next.slice(0, 2).map(({ t, ...e }) => e), [
    { type: 'trigger', relic: 'bone_idol', on: 'fall', unit: 2 }, { type: 'gauge', actor: 2, target: 0, amount: 40 }
  ])
})

// The 'struck' moment: a Wisp (10) shoots the Monarch from 4 tiles off (no one else in its range); a knight
// (1) stands beside the Monarch, a Sprite (3) far off.
function striking (relics, hp = null) {
  const b = scene([on('monarch', 0, 'party', 3, 2), on('tomb_knight', 1, 'party', 2, 1), on('frost_sprite', 3, 'party', 6, 0),
    on('will_o_wisp', 10, 'foe', 3, 6, 1)], { relics })
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
  // Nor any other: the Monarch's fall is not a 'fall' moment either.
  const fatal = striking(RELIC_LIST.filter((r) => r.on).map((r) => r.id), 1)
  assert.ok(fatal.b.over && fatal.b.reason === 'monarch')
  assert.ok(!fatal.events.some((e) => e.type === 'trigger'))
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

test('trigger relics fire for your side only: a foe slaying, falling or entering triggers nothing', () => {
  const relics = RELIC_LIST.filter((r) => r.on).map((r) => r.id)
  // A foe knight slays a party Ghoul: 'fall' fires (yours fell), never 'kill'.
  const { next } = falling(relics)
  assert.ok(next.filter((e) => e.type === 'trigger').every((e) => e.on === 'fall'))
  // A foe falls to a party blow: 'kill' only; a foe that enters (a wave): nothing.
  assert.ok(killing(relics).next.filter((e) => e.type === 'trigger').every((e) => e.on === 'kill'))
  const b = scene([on('monarch', 0, 'party', 3, 1), on('iron_golem', 50, 'foe', 3, 10)],
    { relics, reserve: [{ ...makeUnit('grave_ghoul', { uid: 70, lvl: 2 }), side: 'foe', when: { at: 'time', t: 3 } }] })
  const ev = until(b, (e) => e.some((x) => x.type === 'enter'))
  assert.ok(!ev.some((e) => e.type === 'trigger'))
})

// ── keystones in battle ──────────────────────────────────────────────────────────────────────────

test('Legion: two more souls on the field, and every soul (summons and shadows too, never the Monarch) fights at 85% max HP', () => {
  const run = createRun({ seed: 'legion' })
  const s = run.state
  assert.equal(fieldCap(run), 3)
  s.keystones = ['legion']
  assert.equal(fieldCap(run), 5)
  visit(run, 'fight')
  const mine = (keystones) => {
    s.keystones = keystones
    const b = createBattle(battleSetup(run))
    return Object.fromEntries(b.units.filter((u) => u.side === 'party').map((u) => [u.uid, u.maxHp]))
  }
  const plain = mine([])
  const legion = mine(['legion'])
  for (const u of souls(s.party)) assert.equal(legion[u.uid], Math.round(plain[u.uid] * LEGION_HP), u.id)
  assert.equal(legion[0], plain[0], 'the Monarch keeps its HP')
  // A summon as well.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3), member('grave_ghoul', 2, 1, 2, 3), on('iron_golem', 50, 'foe', 3, 10)], { keystones: ['legion'] })
  assert.equal(unit(b, 2).maxHp, Math.round(baseStats('grave_ghoul', 3).hp * LEGION_HP))
  assert.equal(b.monarch.maxHp, baseStats('monarch', 3).hp)
  // And a shadow Arise raises.
  const shade = (keystones) => {
    const a = scene([on('monarch', 0, 'party', 3, 0), on('grave_ghoul', 10, 'foe', 3, 2, 1), on('iron_golem', 50, 'foe', 6, 10)], { keystones })
    slay(a, unit(a, 10))
    a.monarch.gauge = 200
    stepBattle(a)
    return a.units.find((u) => u.shadow)
  }
  assert.equal(shade(['legion']).maxHp, Math.round(shade([]).maxHp * LEGION_HP))
})

// A lvl-9 foe knight, ready, beside `victim` (at 1 HP).
function felled (units, victim, keystones, relics = []) {
  const b = scene([...units, on('tomb_knight', 40, 'foe', tileX(units.find((u) => u.uid === victim).tile), tileY(units.find((u) => u.uid === victim).tile) + 1, 9)], { keystones, relics })
  unit(b, victim).hp = 1
  unit(b, 40).gauge = unit(b, 40).costliest
  return b
}

test('Undying: a fallen soul rises where it fell at 50% HP, once a battle; summons, shadows and the Monarch never rise', () => {
  const units = [on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 5), member('grave_ghoul', 2, 1, 0, 1), on('iron_golem', 50, 'foe', 6, 10)]
  const b = felled(units, 1, ['undying'], ['bone_idol'])
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
  // Without the keystone, the first fall is for good.
  const plain = felled(units, 1, [])
  until(plain, (ev) => ev.some((e) => e.type === 'death' && e.target === 1))
  assert.ok(!alive(unit(plain, 1)) && !plain.events.some((e) => e.type === 'rise'))
  // A summon never rises, nor a shadow.
  const body = felled(units, 2, ['undying'])
  until(body, (ev) => ev.some((e) => e.type === 'death' && e.target === 2))
  assert.ok(!alive(unit(body, 2)) && !body.events.some((e) => e.type === 'rise'))
  // The shadow: raised beside a ready lvl-9 foe knight and left at 1 HP, it falls for good.
  const sh = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 1), on('grave_ghoul', 10, 'foe', 3, 5, 1), on('tomb_knight', 40, 'foe', 3, 6, 9)],
    { keystones: ['undying'], domain: 6 })
  slay(sh, unit(sh, 10))
  sh.monarch.gauge = 200
  stepBattle(sh)
  const shadow = sh.units.find((u) => u.shadow)
  assert.equal(shadow.tile, tileAt(3, 5))
  shadow.hp = 1
  unit(sh, 40).gauge = unit(sh, 40).costliest
  until(sh, (ev) => ev.some((e) => e.type === 'death' && e.target === shadow.uid))
  assert.ok(!alive(shadow) && !sh.events.some((e) => e.type === 'rise'))
  // Nothing revives the Monarch: with every keystone held, its fall is the battle lost.
  const m = felled([on('monarch', 0, 'party', 3, 4), on('tomb_knight', 1, 'party', 0, 0), on('iron_golem', 50, 'foe', 6, 10)], 0, KEYSTONE_LIST.map((k) => k.id))
  runBattle(m)
  assert.deepEqual([m.winner, m.reason, m.monarch.hp], ['foe', 'monarch', 0])
  assert.ok(!m.events.some((e) => e.type === 'rise'))
})

test('Mimicry: Vanguards count as Wardens too, for your synergies, not the foes\'', () => {
  // Unit-level: two Vanguards make Warden 2 with the alias, not without it.
  const two = [makeUnit('tomb_knight', { uid: 1 }), makeUnit('grave_ghoul', { uid: 2 })]
  const alias = KEYSTONES.mimicry.alias
  assert.ok(activeSynergies(two, alias).some((s) => s.id === 'warden_2'))
  assert.ok(!activeSynergies(two).some((s) => s.id === 'warden_2'))
  // In battle: the party's knights hold Warden 2; the foes' knights, standing the same way, do not.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4), on('tomb_knight', 2, 'party', 3, 3),
    on('tomb_knight', 10, 'foe', 3, 8), on('tomb_knight', 11, 'foe', 3, 9)], { keystones: ['mimicry'] })
  const start = b.events[0]
  assert.ok(start.synergies.some((s) => s.side === 'party' && s.id === 'warden_2'))
  assert.ok(!start.synergies.some((s) => s.side === 'foe' && s.id === 'warden_2'))
})

test('Blood Tithe: Arise\'s cap is doubled, each shadow costs the Monarch 3% of its max HP, and it never pays with its last', () => tuned(FIRST_ARISE, () => {
  // Rally Horn and Tower Shield (entry) and the Hourglass (struck) never fire: a shadow rising is no entry,
  // and the tithe is no blow.
  const build = (keystones, hp = null) => {
    const b = scene([on('monarch', 0, 'party', 3, 1), on('tomb_knight', 1, 'party', 0, 0),
      on('grave_ghoul', 10, 'foe', 3, 2, 1), on('grave_ghoul', 11, 'foe', 2, 2, 1), on('grave_ghoul', 12, 'foe', 4, 2, 1), on('iron_golem', 50, 'foe', 6, 10)],
    { keystones, relics: ['rally_horn', 'tower_shield', 'hourglass'] })
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
    assert.ok(!ev.some((e) => e.type === 'trigger'), 'no relic fires on a raise or a tithe')
    assert.equal(b.signals.struck, false, 'the tithe is not a blow')
  }
  assert.ok(!raise(b).some((e) => e.type === 'arise'), 'Will 0: two raises with the tithe')
  // Without it, one raise and no tithe.
  const plain = build([])
  assert.ok(raise(plain).some((e) => e.type === 'arise') && !plain.events.some((e) => e.type === 'tithe'))
  assert.ok(!raise(plain).some((e) => e.type === 'arise'))
  // A Monarch the tithe would fell raises nothing.
  const weak = build(['blood_tithe'], cost)
  assert.ok(!raise(weak).some((e) => e.type === 'arise') && weak.monarch.hp === cost)
}))

test('Court of Bone: nothing heals the Monarch in battle; healers spend their heals elsewhere', () => {
  const build = (keystones) => {
    const b = scene([on('monarch', 0, 'party', 3, 1), on('hive_warden', 1, 'party', 3, 2, 9), on('tomb_knight', 2, 'party', 0, 0),
      on('iron_golem', 50, 'foe', 6, 10)], { keystones, relics: ['balm'] })
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
  const balm = (keystones) => {
    const b = scene([on('monarch', 0, 'party', 2, 4), on('tomb_knight', 1, 'party', 4, 4), on('grave_ghoul', 2, 'party', 3, 5, 1),
      on('tomb_knight', 10, 'foe', 3, 6, 9)], { relics: ['balm'], keystones })
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

// ── keystones in the run ─────────────────────────────────────────────────────────────────────────

test('the run bends the domain: Court of Bone 2 tiles larger, and the battle gets the bent radius', () => {
  const run = createRun({ seed: 'domain' })
  const s = run.state
  assert.equal(domainOf(s), 3)
  s.keystones = ['court_of_bone']
  assert.equal(domainOf(s), 5)
  visit(run, 'fight')
  const setup = battleSetup(run)
  assert.deepEqual([setup.domain, setup.keystones], [5, ['court_of_bone']])
  assert.equal(createBattle(setup).domain, 5)
})

// A won fight on one of the seeds (with `ready` run first on each).
function win (prefix, ready, type = 'fight') {
  for (let i = 0; i < 200; i++) {
    const run = createRun({ seed: prefix + i })
    ready(run)
    visit(run, type)
    apply(run, { type: 'fight' })
    if (run.state.phase === 'reap') return run
  }
  assert.fail(`no ${prefix} seed won`)
}

test('Court of Bone: nothing heals the Monarch out of battle: not a win, not an altar, not a point bought', () => {
  const wound = (run) => {
    run.state.keystones = ['court_of_bone']
    monarchOf(run.state).hp = 40
  }
  const run = win('bone', wound)
  const m = monarchOf(run.state)
  assert.ok(m.hp <= 40, `${m.hp} after the win`)
  const hp = m.hp
  apply(run, { type: 'reap', index: null })
  run.state.essence = 1000
  apply(run, { type: 'monarch', stat: 'will' })
  assert.equal(m.hp, hp, 'a point raises its max HP, not its HP')
  assert.ok(m.maxHp > hp)
  visit(run, 'altar')
  assert.equal(m.hp, hp, 'an altar does not heal it')
  // Without the keystone a win heals it.
  const plain = win('bone', (r) => { monarchOf(r.state).hp = 40 })
  assert.ok(monarchOf(plain.state).hp > 40)
})

test('Hollow Court: the shadows still standing when a battle is won pay their essence again; the fallen do not', () => tuned(FIRST_ARISE, () => {
  // A Monarch with a wide domain and Will 2 raises shadows; find a won fight where some still stand and
  // some fell.
  const fight = (seed, keystones) => {
    const run = createRun({ seed })
    Object.assign(run.state, { keystones })
    Object.assign(run.state.monarch, { dominion: 6, will: 2 })
    visit(run, 'fight')
    apply(run, { type: 'fight' })
    return run
  }
  for (let i = 0; i < 300; i++) {
    const run = fight('court' + i, ['hollow_court'])
    const shadows = run.state.phase === 'reap' ? run.battle.units.filter((u) => u.shadow && u.side === 'party') : []
    const kept = shadows.filter((u) => u.hp > 0)
    if (!kept.length || kept.length === shadows.length) continue
    // The same battle without the keystone (it bends nothing in battle) pays the slain only.
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
    plain.state.keystones.push('hollow_court')
    assert.deepEqual(reapedShadows(plain), [])
    return
  }
  assert.fail('no battle left a shadow standing and one fallen')
}))

test('keystones are offered at won elites and rites from floor 2, free, never one held, at most 3 a run, and taken by reap', () => {
  // Floor 1: a rite offers tiers only.
  const one = createRun({ seed: 'ks' })
  visit(one, 'rite')
  assert.ok(!one.state.offers.some((o) => o.type === 'keystone'))
  // Floor 2: a rite offers TUNING.keystone.offer keystones beside its tiers.
  for (let i = 0; i < 30; i++) {
    const run = createRun({ seed: 'ks' + i })
    const s = run.state
    s.floor = 2
    s.keystones = i % 2 ? ['legion', 'undying'] : []
    visit(run, 'rite')
    const ks = s.offers.filter((o) => o.type === 'keystone')
    assert.equal(ks.length, TUNING.keystone.offer)
    assert.equal(new Set(ks.map((o) => o.id)).size, ks.length)
    for (const o of ks) assert.ok(KEYSTONES[o.id] && !s.keystones.includes(o.id) && o.name === KEYSTONES[o.id].name && o.desc === KEYSTONES[o.id].desc)
    assert.ok(s.offers.some((o) => o.type === 'tier'))
    assert.ok(legalActions(run).some((a) => a.type === 'reap' && s.offers[a.index].type === 'keystone'))
  }
  // Taking one: it is held, the other keystone goes, the tiers stay; taken again later, never twice.
  const run = createRun({ seed: 'ks0' })
  const s = run.state
  s.floor = 2
  visit(run, 'rite')
  const index = s.offers.findIndex((o) => o.type === 'keystone')
  const id = s.offers[index].id
  apply(run, { type: 'reap', index })
  assert.deepEqual(s.keystones, [id])
  assert.ok(!s.offers.some((o) => o.type === 'keystone') && s.offers.some((o) => o.type === 'tier'))
  // Three held: no more are offered.
  s.offers = []
  s.phase = 'map'
  s.keystones = ['legion', 'undying', 'mimicry']
  visit(run, 'rite')
  assert.ok(!s.offers.some((o) => o.type === 'keystone'))
  // One held cannot be taken again, nor a fourth.
  s.phase = 'reap'
  s.offers = [{ type: 'keystone', id: 'legion', name: 'Legion', desc: '' }, { type: 'keystone', id: 'blood_tithe', name: 'Blood Tithe', desc: '' }]
  assert.throws(() => apply(run, { type: 'reap', index: 0 }), /can't be taken/)
  assert.throws(() => apply(run, { type: 'reap', index: 1 }), /can't be taken/)
  // A won elite on floor 2 offers its relics and keystones; on floor 1, relics only.
  const elite = win('kselite', (r) => { r.state.floor = 2 }, 'elite')
  assert.deepEqual([elite.state.offers.filter((o) => o.type === 'relic').length, elite.state.offers.filter((o) => o.type === 'keystone').length], [TUNING.essence.eliteRelics, TUNING.keystone.offer])
  const first = win('kselite', () => {}, 'elite')
  assert.ok(!first.state.offers.some((o) => o.type === 'keystone'))
  // A fought fight (not elite) offers none, floor 2 or not.
  assert.ok(!win('ksfight', (r) => { r.state.floor = 2 }).state.offers.some((o) => o.type === 'keystone'))
})

test('the autoplayer and keystones: basic takes the first free offer; the expert weighs keystones by rehearsal and takes one', () => tuned({ party: { fieldPerFloor: 0 } }, () => {
  // The scene is built on a floor-2 field of 3 banners (before round 2 gave a banner a floor down).
  const offerRoom = (seed) => {
    const run = createRun({ seed })
    run.state.floor = 2
    visit(run, 'rite')
    // Only the keystones are left on the table.
    run.state.offers = run.state.offers.filter((o) => o.type === 'keystone')
    return run
  }
  const rng = createRng('ksauto').stream('autoplay')
  const basic = offerRoom('ksauto')
  assert.deepEqual(policy(basic, rng, 'basic'), { type: 'reap', index: 0 })
  const mixed = createRun({ seed: 'ksauto' })
  mixed.state.floor = 2
  visit(mixed, 'rite')
  assert.deepEqual(policy(mixed, rng, 'basic'), { type: 'reap', index: 0 }, 'the first free offer, whatever it is')
  assert.equal(mixed.state.offers[0].type, 'tier')
  // With the tier taken, the keystone left beside it is the next free offer.
  apply(mixed, policy(mixed, rng, 'basic'))
  const then = policy(mixed, rng, 'basic')
  assert.equal(then.type, 'reap')
  assert.equal(mixed.state.offers[then.index].type, 'keystone')
  const expert = offerRoom('ksauto')
  const a = policy(expert, rng, 'expert')
  assert.equal(a.type, 'reap')
  assert.equal(expert.state.offers[a.index].type, 'keystone')
  apply(expert, a)
  assert.equal(expert.state.keystones.length, 1)
  // The rehearsal sees what a keystone does: with two strong souls waiting on the bench, Legion's two more
  // banners beat Hollow Court (which changes no battle), though Hollow Court is offered first.
  const bench = offerRoom('ksbench')
  for (const id of ['tomb_knight', 'grave_ghoul']) join(bench, id, { lvl: 6 })
  assert.equal(souls(bench.state.party).filter((u) => u.slot < 0).length, 2)
  bench.state.offers = [{ type: 'keystone', id: 'hollow_court', name: '', desc: '' }, { type: 'keystone', id: 'legion', name: '', desc: '' }]
  assert.deepEqual(policy(bench, rng, 'expert'), { type: 'reap', index: 1 })
  // A plan (made once and kept while nothing it rests on changes) is keyed on the keystones held: once Legion
  // is, it fields the souls waiting.
  const placed = (run) => planFor(run, LEVELS.basic).filter((p) => p.uid !== 0 && p.slot >= 0).length
  assert.equal(placed(bench), 3)
  bench.state.keystones.push('legion')
  assert.equal(placed(bench), fieldCap(bench))
  assert.equal(fieldCap(bench), 5)
  // Weighing a Monarch point under Court of Bone, it counts on no heal from it.
  const s = createRun({ seed: 'kspoint' }).state
  monarchOf(s).hp = 40
  const healed = withPoint(s, 'will').party.find((u) => u.uid === 0)
  assert.ok(healed.hp > 40 && healed.maxHp > monarchOf(s).maxHp)
  s.keystones = ['court_of_bone']
  const court = withPoint(s, 'will').party.find((u) => u.uid === 0)
  assert.deepEqual([court.hp, court.maxHp], [40, healed.maxHp])
}))


// ── Court of Bone's aim ─────────────────────────────────────────────────────────────────────────

test('Court of Bone turns only heals away from the Monarch: a buff still goes to it', () => {
  // A Gearwright page (Purge become Overclock: Hasten, on the most wounded ally), holding its tile; the Monarch is
  // the most wounded.
  const b = scene([on('monarch', 0, 'party', 3, 1), { ...on('clockwork_page', 1, 'party', 3, 2, 9), path: 'gearwright', tier: 3 }, on('tomb_knight', 2, 'party', 0, 0),
    on('iron_golem', 50, 'foe', 6, 10)], { keystones: ['court_of_bone'] })
  b.monarch.hp = 30
  unit(b, 1).gauge = unit(b, 1).costliest
  const events = until(b, (ev) => ev.some((e) => e.type === 'action' && e.actor === 1))
  const cast = events.find((e) => e.type === 'action' && e.actor === 1)
  assert.deepEqual([cast.ability, cast.targets], ['overclock', [0]])
})

// ── the keystones soaked ─────────────────────────────────────────────────────────────────────────

test('every keystone, alone and together, plays deterministically and keeps the battle\'s invariants', () => {
  // Real elites from floors 2–4, against souls of level 9 with a summoner, a soul on a line held for a time, Will
  // and a wide domain (so Arise raises), every trigger relic, and souls carried in wounded (so some fall and rise).
  const all = KEYSTONE_LIST.map((k) => k.id)
  const combos = [...all.map((id) => [id]), all, ['undying', 'legion'], ['court_of_bone', 'blood_tithe']]
  const seen = new Set()
  const counts = {}
  for (let i = 0; i < 6; i++) {
    const run = createRun({ seed: 'soak' + i })
    const s = run.state
    s.floor = 2
    Object.assign(s.monarch, { will: 2, dominion: 5, command: 1 })
    s.relics = [...RELIC_LIST.filter((r) => r.on).map((r) => r.id), 'heartwood']
    const node = visit(run, 'elite')
    node.foes = encounter(s.seed, 2 + (i % 3), node)
    const caps = fielded(souls(s.party))
    // The chanter raises Skeletons (Marrowcaller II), a Knight one more.
    Object.assign(caps.find((u) => u.id === 'bone_chanter'), { path: 'marrowcaller', tier: 2, grade: 1 })
    apply(run, legalActions(run).find((a) => a.type === 'line' && a.uid === caps.at(-1).uid && a.when?.at === 'time'))
    for (const u of caps) Object.assign(u, { lvl: 9, maxHp: baseStats(u.id, 9).hp, hp: Math.max(1, Math.round(baseStats(u.id, 9).hp * (i % 2 ? 0.25 : 0.6))) })
    for (const keystones of combos) {
      for (const id of keystones) seen.add(id)
      s.keystones = keystones
      const setup = battleSetup(run)
      const b = createBattle(setup)
      const ks = b.ks
      while (!b.over) {
        for (const e of stepBattle(b)) {
          counts[e.type] = (counts[e.type] ?? 0) + 1
          if (e.type === 'rise') assert.notEqual(e.target, 0, 'the Monarch never rises')
          if (e.type === 'heal' && ks.unhealable) assert.notEqual(e.target, 0, 'Court of Bone: no heal for the Monarch')
          if (e.type === 'tithe') assert.ok(e.hp > 0, 'the tithe never fells the Monarch')
        }
        for (const u of b.units) {
          assert.ok(u.hp >= 0 && u.hp <= u.maxHp, `${keystones} t${b.t}: ${u.uid} at ${u.hp}/${u.maxHp}`)
          if (alive(u)) assert.equal(b.at[u.tile], u, `${keystones} t${b.t}: ${u.uid} off the index`)
        }
        assert.ok(b.at.every((u, t) => u === null || (alive(u) && u.tile === t)), `${keystones} t${b.t}: the index`)
      }
      // The same setup plays the same battle.
      assert.deepEqual(runBattle(createBattle(setup)).events, b.events, `${keystones}: replayed`)
    }
  }
  assert.deepEqual([...seen].sort(), all.slice().sort(), 'every keystone soaked')
  for (const type of ['rise', 'tithe', 'arise', 'move', 'trigger']) assert.ok(counts[type] > 0, `no ${type} in the soak`)
})

// ── keystones meeting lines ──────────────────────────────────────────────────────────────────────

test('Undying: a rise is still a fall, the Fallen signal a line waits on', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 2, 'party', 3, 5), { ...on('frost_sprite', 5, 'party', 0, 0), line: { tiles: [tileAt(0, 1)], when: { at: 'falls' } } },
    on('iron_golem', 50, 'foe', 3, 6, 9)], { keystones: ['undying'], moving: [5] })
  unit(b, 2).hp = 1
  unit(b, 50).gauge = unit(b, 50).costliest
  const events = until(b, (ev) => ev.some((e) => e.type === 'move' && e.actor === 5))
  const rise = events.find((e) => e.type === 'rise')
  assert.equal(rise.target, 2)
  assert.ok(alive(unit(b, 2)))
  const step = events.find((e) => e.type === 'move' && e.actor === 5)
  assert.ok(step.t === rise.t || step.t === rise.t + 1, `rose at ${rise.t}, stepped at ${step.t}`)
})

test('a rite lays a Knight\'s tier IV beside the keystones; taking one kind leaves the other, and Legion\'s souls stop at the board', () => {
  const run = createRun({ seed: 'm7' })
  const s = run.state
  s.keystones = ['legion']
  assert.equal(fieldCap(run), TUNING.party.field + 2)
  s.monarch.command = 20
  assert.equal(fieldCap(run), TUNING.army.board)
  s.monarch.command = 0
  s.floor = 2
  const k = souls(s.party)[0]
  Object.assign(k, { grade: 1, path: 'bulwark', tier: 3 })
  assert.equal(k.id, 'tomb_knight')
  visit(run, 'rite')
  assert.ok(s.offers.some((o) => o.type === 'tier' && o.uid === k.uid && o.path === 'bulwark'), JSON.stringify(s.offers))
  assert.equal(s.offers.filter((o) => o.type === 'keystone').length, TUNING.keystone.offer)
  apply(run, { type: 'reap', index: s.offers.findIndex((o) => o.type === 'tier' && o.uid === k.uid) })
  assert.equal(k.tier, 4)
  assert.deepEqual(s.offers.map((o) => o.type), ['keystone', 'keystone'])
  apply(run, { type: 'reap', index: 0 })
  assert.equal(s.keystones.length, 2)
  assert.equal(s.phase, 'map')
})
