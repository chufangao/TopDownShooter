// The expert plans with every mechanic (Job: the measuring instrument): formations drafted and climbed with each
// piece where its footprint fits, 2×2 pieces too, every fusion it can make weighed by rehearsal, and stacks against
// splits weighed by rehearsal; basic never fuses; and the audit that says what it considered against what it chose.
// Functional only: what is generated and considered, never how often it is chosen or how it fares.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRun, apply, availableNodes, souls, join, legalActions, fuseParts, MONARCH_UID, monarchOf, levelOf } from '../src/sim/run.js'
import {
  drafts, planFor, LEVELS, AUDIT, resetAudit, auditRecord, spendOptions, policy, fusionOptions, gateOf, BOOK, combosOf,
  roomsAhead, rehearseAhead
} from '../src/sim/autoplay.js'
import { TUNING } from '../src/tuning.js'
import { createRng } from '../src/sim/rng.js'
import { CAMP_LIST, FUSION_LIST, unitDef, fusionDef, relicDef, TRACKS } from '../src/content.js'
import { slotAt, CAMP_SLOTS, sizeOf, footprintSlots, fits, monarchSlot, makeUnit } from '../src/sim/unit.js'

// A run standing in a fight's prep whose room has a second wave and a far-reaching foe on lane 6.
function prep (seed) {
  const run = createRun({ seed })
  const node = availableNodes(run)[0]
  node.type = 'fight'
  node.foes = [{ id: 'grave_ghoul', lvl: 1, slot: slotAt(0, 3) }, { id: 'will_o_wisp', lvl: 1, slot: slotAt(1, 6) }]
  node.waves = [{ foes: [{ id: 'grave_ghoul', lvl: 1, slot: slotAt(0, 2) }], when: { at: 'break', t: 600 } }]
  apply(run, { type: 'node', id: node.id })
  return run
}

// The cells a formation's fielded pieces but `except` cover.
const covered = (party, except = null) => new Set(party.filter((u) => u !== except && u.slot >= 0).flatMap((u) => footprintSlots(u.slot, sizeOf(u))))

test('the drafts, in every camp: the Monarch on its seat, every piece where its footprint fits, a 2×2 piece left out only where it fits nowhere', () => {
  for (const c of CAMP_LIST) {
    const run = prep('drafts-' + c.id)
    const s = run.state
    s.camp = c.id
    s.party.find((u) => u.uid === MONARCH_UID).slot = monarchSlot(c.id)
    for (const u of souls(s.party)) u.slot = -1
    s.relics.push('grave_banner', 'grave_banner', 'grave_banner')
    join(run, 'bone_colossus')
    join(run, 'clockwork_titan')
    join(run, 'grave_ghoul')
    const want = souls(s.party)
    for (const L of [LEVELS.basic, LEVELS.expert]) {
      const all = drafts(run, want, L)
      // Basic's three; the expert's four zone drafts and basic's three, and one more, its gate held, where the camp
      // has a gate (gateOf) its pieces can hold.
      if (L === LEVELS.basic) assert.equal(all.length, 3, c.id)
      else assert.ok(all.length === 7 || (all.length === 8 && gateOf(c.id).length > 0), `${c.id}: ${all.length}`)
      for (const [k, party] of all.entries()) {
        const at = `${c.id} draft ${k}`
        assert.equal(party[0].uid, MONARCH_UID, at)
        assert.equal(party[0].slot, monarchSlot(c.id), at)
        assert.deepEqual(party.slice(1).map((u) => u.uid).sort(), want.map((u) => u.uid).sort(), at)
        const taken = new Set()
        for (const u of party.slice(1).filter((x) => x.slot >= 0)) {
          assert.ok(fits(c.id, u.slot, sizeOf(u), taken), `${at}: ${u.id} on ${u.slot}`)
          for (const x of footprintSlots(u.slot, sizeOf(u))) taken.add(x)
        }
        for (const u of party.slice(1).filter((x) => x.slot < 0)) {
          assert.ok(![...Array(CAMP_SLOTS).keys()].some((x) => fits(c.id, x, sizeOf(u), covered(party, u))), `${at}: ${u.id} left out, though it fits`)
        }
      }
      assert.ok(all.some((party) => party.some((u) => sizeOf(u) === 2 && u.slot >= 0)), `${c.id}: some draft fields a 2×2 piece`)
    }
  }
})

test('the expert\'s plan: drafts and climbs over the cells with a 2×2 piece among them, every one a formation the run can field', () => {
  const run = prep('climb')
  const s = run.state
  s.relics.push('grave_banner', 'grave_banner')
  join(run, 'bone_colossus')
  resetAudit(true)
  try {
    const plan = planFor(run, LEVELS.expert)
    assert.ok(AUDIT.candidates > 7, `${AUDIT.candidates} formations rehearsed`)
    for (const f of ['2×2 fielded', 'fused fielded', 'beside the Monarch']) assert.ok(AUDIT.considered[f] > 0, `${f}: ${JSON.stringify(AUDIT.considered)}`)
    const pieces = plan.map((p) => ({ ...s.party.find((u) => u.uid === p.uid), slot: p.slot }))
    assert.equal(pieces.find((u) => u.uid === MONARCH_UID).slot, monarchSlot(s.camp))
    const taken = new Set()
    for (const u of pieces.filter((x) => x.uid !== MONARCH_UID && x.slot >= 0)) {
      assert.ok(fits(s.camp, u.slot, sizeOf(u), taken), `${u.id} on ${u.slot}`)
      for (const x of footprintSlots(u.slot, sizeOf(u))) taken.add(x)
    }
  } finally {
    resetAudit(false)
  }
})

test('fusions: the expert weighs every one it can make by rehearsal (as legalActions lists them), and makes one only of those; basic never fuses', () => {
  const run = prep('fuse')
  const s = run.state
  s.essence = 2000
  // Two recipes made: Bone Colossus (a second Tomb Knight beside the start's Knight and Chanter) and Rime Drake (an
  // Ember Drake and a second Frost Sprite beside the start's Sprite).
  join(run, 'tomb_knight')
  join(run, 'ember_drake')
  join(run, 'frost_sprite')
  const listed = legalActions(run).filter((a) => a.type === 'fuse')
  assert.deepEqual(listed.map((a) => a.id).sort(), ['bone_colossus', 'rime_drake'])
  assert.deepEqual(fusionOptions(run, LEVELS.expert), listed)
  assert.ok(listed.every((a) => JSON.stringify(a.parts) === JSON.stringify(fuseParts(run, a.id))))
  assert.deepEqual(fusionOptions(run, LEVELS.basic), [])
  assert.deepEqual(fusionOptions(run, { ...LEVELS.expert, ablate: 'fusions' }), [])
  resetAudit(true, run)
  try {
    const a = policy(run, createRng('fuse').stream('autoplay'), 'expert')
    for (const r of FUSION_LIST) assert.equal(AUDIT.considered[`fuse ${r.id}`] ?? 0, listed.some((x) => x.id === r.id) ? 1 : 0, r.id)
    if (a.type === 'fuse') assert.ok(listed.some((x) => JSON.stringify(x) === JSON.stringify(a)), JSON.stringify(a))
  } finally {
    resetAudit(false)
  }
  // Basic, from the same prep to its fight: never a fusion.
  const basic = prep('fuse')
  basic.state.essence = 2000
  join(basic, 'tomb_knight')
  join(basic, 'ember_drake')
  join(basic, 'frost_sprite')
  const rng = createRng('fuse-basic').stream('autoplay')
  for (let a; (a = policy(basic, rng, 'basic')).type !== 'fight';) {
    assert.notEqual(a.type, 'fuse')
    apply(basic, a)
  }
})

// The fights ahead are rehearsed in a row, the Monarch's HP carried from one into the next and mended only as the run
// would mend it: under Court of Bone not at all, so a Monarch already low starts every rehearsal low, never whole;
// without it, by a battle's heal. (Whatever the rehearsals' outcomes: a room none of whose rolls was won passes on the
// HP it began with.)
test('the expert rehearses the fights ahead in a row: the Monarch\'s HP carries from each into the next, mended only as the run would', () => {
  const run = prep('carry')
  const m = monarchOf(run.state)
  const low = Math.round(m.maxHp * 0.3)
  m.hp = low
  const L = { seeds: 1, search: 0, wounds: true, rollouts: 0, reap: false, spend: false, fuse: false, more: true, drafts: 1 }
  const rooms = roomsAhead(run)
  assert.ok(rooms.length >= 2 && rooms[0].id === run.state.at, 'the room being prepared for first, then the rooms ahead')
  const carried = (r) => (r.left >= 0 ? Math.max(1, Math.round(r.left)) : r.hp)
  // Court of Bone held: each fight starts where the one before it left the Monarch, never mended.
  run.state.relics = ['arise', 'court_of_bone']
  const court = rehearseAhead(run, rooms, L)
  assert.deepEqual(court.map((r) => r.node.id), rooms.map((n) => n.id))
  assert.equal(court[0].hp, low)
  for (let k = 1; k < court.length; k++) assert.equal(court[k].hp, carried(court[k - 1]), `room ${k}`)
  assert.ok(court.every((r) => r.hp <= low && r.hp < m.maxHp), 'never whole again')
  // The next fight is rehearsed at that HP: the same as rehearsing it alone from there.
  const at = (hp) => ({ party: run.state.party.map((u) => (u === m ? { ...u, hp } : u)) })
  assert.equal(rehearseAhead(run, [rooms[1]], L, at(court[1].hp))[0].score, court[1].score)
  // Without it, a battle won mends the Monarch by the battle's heal on the way to the next (an altar the way cannot
  // miss, to its altarHeal).
  run.state.relics = ['arise']
  const mended = rehearseAhead(run, rooms, L)
  assert.equal(mended[0].hp, low)
  const heal = Math.ceil(m.maxHp * TUNING.run.postBattleHeal)
  for (let k = 1; k < mended.length; k++) {
    const r = mended[k - 1]
    assert.ok(mended[k].hp >= (r.left >= 0 ? Math.min(m.maxHp, carried(r) + heal) : r.hp) && mended[k].hp <= m.maxHp, `room ${k}`)
  }
  assert.equal(run.state.party.find((u) => u === m).hp, low, 'the run untouched')
})

test('the audit counts what a run considered and chose, and leaves the audit off after', () => {
  const r = auditRecord({ seed: 'audit-basic', level: 'basic' })
  assert.ok(r.battles.n > 0 && r.plans === r.battles.n, JSON.stringify([r.plans, r.battles.n]))
  assert.ok(r.candidates >= r.plans)
  assert.ok(Object.values(r.chosen).every((n) => n <= r.plans))
  assert.equal(AUDIT.on, false)
})

test('idle essence: when its fielded kinds can buy nothing, the expert weighs every tier it can afford, and nothing else', () => {
  const run = createRun({ seed: 'idle' })
  const s = run.state
  s.essence = 5000
  // Every held kind's tracks full: nothing remains to buy (no level, nothing for the Monarch, Arise or not); then a
  // kind with room to grow.
  for (const k of Object.values(s.kinds)) Object.assign(k, { lvl: 10, tracks: [4, 2] })
  for (const u of souls(s.party)) Object.assign(u, { lvl: 10, tracks: [4, 2] })
  assert.deepEqual(spendOptions(run, LEVELS.expert), [])
  s.relics.push('arise')
  assert.deepEqual(spendOptions(run, LEVELS.expert), [])
  join(run, 'grave_ghoul')
  assert.deepEqual(spendOptions(run, LEVELS.expert), [0, 1].map((track) => ({ type: 'upgrade', kind: 'grave_ghoul', track })))
  assert.deepEqual(spendOptions(run, { ...LEVELS.expert, ablate: 'tracks' }), [])
  // The expert's purchase, if it makes one, is one of them.
  const a = policy(run, createRng('idle').stream('autoplay'), 'expert')
  assert.ok(a.type === 'node' || spendOptions(run, LEVELS.expert).some((o) => JSON.stringify(o) === JSON.stringify(a)), JSON.stringify(a))
})

test('the expert weighs a track\'s next two tiers together: a tier whose level rounds away is bought when the two make a level, and essence holds both', () => {
  // The Knight's and the Chanter's tracks full, the Chanter a stack of eight; a lone Frost Sprite at the first of these
  // tiers where its next tier on either track leaves its level as it is (the level rounds down) and the one after it
  // makes a level (at TUNING.level's 2 + 0.67 a tier: II and I, level 4; at 0.5 a tier it was I and I, level 3).
  // With essence for both, the expert buys the first (it declined it, weighing one tier at a time); then, any tier the
  // Sprite takes making the level, the next.
  const up = (tracks, track, n) => [0, 1].map((t) => tracks[t] + (t === track ? n : 0))
  const start = [[1, 1], [2, 1], [0, 0], [2, 2]].find((tracks) => [0, 1].every((track) =>
    levelOf({ tracks: up(tracks, track, 1) }) === levelOf({ tracks }) && levelOf({ tracks: up(tracks, track, 2) }) === levelOf({ tracks }) + 1))
  assert.ok(start, 'a Sprite whose next tier rounds away on both tracks')
  const build = () => {
    const run = createRun({ seed: 'pair' })
    const s = run.state
    const [knight, chanter, sprite] = ['tomb_knight', 'bone_chanter', 'frost_sprite'].map((id) => souls(s.party).find((u) => u.id === id))
    const tier = (u, tracks) => {
      s.kinds[u.id] = { tracks, lvl: levelOf({ tracks }) }
      Object.assign(u, makeUnit(u.id, { uid: u.uid, slot: u.slot, lvl: s.kinds[u.id].lvl, tracks, count: u.count }))
    }
    tier(knight, [4, 2])
    chanter.count = 8
    tier(chanter, [4, 2])
    tier(sprite, start)
    const tracks = s.kinds.frost_sprite.tracks
    s.essence = Math.max(...[0, 1].map((t) => TUNING.essence.tier[tracks[t]] + TUNING.essence.tier[tracks[t] + 1]))
    return run
  }
  const { state } = build()
  const lvl = state.kinds.frost_sprite.lvl
  const after = (n, track) => levelOf({ tracks: [0, 1].map((t) => state.kinds.frost_sprite.tracks[t] + (t === track ? n : 0)) })
  for (const track of [0, 1]) assert.deepEqual([after(1, track), after(2, track)], [lvl, lvl + 1], `track ${track}`)
  // The expert, and the expert with its book aside (a tier on the tracks of the combo it plays toward is worth something
  // to it alone): the field's own worth decides.
  for (const L of [LEVELS.expert, { ...LEVELS.expert, book: false }]) {
    const run = build()
    const s = run.state
    assert.deepEqual(spendOptions(run, L), [0, 1].map((track) => ({ type: 'upgrade', kind: 'frost_sprite', track })), 'nothing else to buy')
    const rng = createRng('pair').stream('autoplay')
    const a = policy(run, rng, L)
    assert.deepEqual([a.type, a.kind], ['upgrade', 'frost_sprite'], JSON.stringify(a))
    apply(run, a)
    assert.equal(s.kinds.frost_sprite.lvl, lvl)
    const b = policy(run, rng, L)
    assert.deepEqual([b.type, b.kind], ['upgrade', 'frost_sprite'], JSON.stringify(b))
    apply(run, b)
    assert.equal(s.kinds.frost_sprite.lvl, lvl + 1)
  }
})

test('the expert lets a soul go only for a recruit it weighed worth it: the release, then that recruit', () => {
  // A won fight with a full retinue: whatever the expert does, a release is followed by a recruit of a soul.
  let released = 0
  for (let i = 0; i < 12; i++) {
    const run = createRun({ seed: 'letgo' + i })
    const node = availableNodes(run)[0]
    node.type = 'fight'
    // A Tomb Knight slain: its soul may join the fielded Knight's piece.
    node.foes = [{ id: 'tomb_knight', lvl: 1, slot: slotAt(0, 3) }]
    apply(run, { type: 'node', id: node.id })
    apply(run, { type: 'fight' })
    if (run.state.phase !== 'reap') continue
    const s = run.state
    s.essence = 1000
    while (souls(s.party).reduce((n, u) => n + u.count, 0) < 12) join(run, 'clockwork_page')
    const rng = createRng('letgo').stream('autoplay')
    const a = policy(run, rng, 'expert')
    if (a.type !== 'release') {
      assert.ok(a.type === 'reap', JSON.stringify(a))
      continue
    }
    apply(run, a)
    const b = policy(run, rng, 'expert')
    assert.ok(b.type === 'reap' && b.index !== null && s.offers[b.index].type === 'soul', JSON.stringify(b))
    released++
  }
  assert.ok(released > 0, 'some full retinue let a soul go for a recruit')
})

// The combo book (src/sim/combos.json, made by --combos): every id in it resolves against the content, so it is made
// again whenever content or numbers change it out of date. Functional only: what it holds, never how it ranks.
test('the combo book: every combo, kind, track, recipe, synergy and relic in it resolves, and the book covers every fusion and core', () => {
  assert.ok(BOOK.combos.length > 0, 'the book is made: node src/sim/autoplay.js --combos')
  const floors = BOOK.combos[0].gain.length
  for (const c of BOOK.combos) {
    for (const id of [...Object.keys(c.needs), ...Object.keys(c.tracks)]) assert.ok(unitDef(id), `${c.id}: ${id}`)
    for (const [id, t] of Object.entries(c.tracks)) assert.ok(TRACKS[id]?.[t], `${c.id}: ${id} track ${t}`)
    if (c.fuse) assert.equal(Object.keys(c.tracks)[0], fusionDef(c.fuse).result, c.id)
    for (const k of Object.keys(c.kin ?? {})) assert.ok(Object.keys(c.needs).some((id) => unitDef(id).kin === k), `${c.id}: kin ${k}`)
    for (const r of Object.keys(c.role ?? {})) assert.ok(Object.keys(c.needs).some((id) => unitDef(id).role === r), `${c.id}: role ${r}`)
    for (const id of Object.keys(c.relics ?? {})) assert.ok(relicDef(id), `${c.id}: relic ${id}`)
    assert.equal(c.gain.length, floors, c.id)
    assert.ok(Number.isInteger(c.draft) && c.draft >= 0, c.id)
  }
  for (const id of Object.keys(BOOK.plain)) assert.ok(relicDef(id), `plain: relic ${id}`)
  const ids = new Set(BOOK.combos.map((c) => c.id))
  for (const c of combosOf()) assert.ok(ids.has(c.id), `the book is out of date: ${c.id} is missing (node src/sim/autoplay.js --combos)`)
})
