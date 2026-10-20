// The expert decides with every mechanic: formations drafted and
// climbed on a static read of the scouted room with each piece where its footprint fits, 2×2 pieces too; the next room
// by its features; every fusion it can make weighed by the growth search; the tree's rules out of battle; basic never
// fuses; and the audit that says what it considered against what it chose, and which rule decided.
// Functional only: what is generated and considered, never how often it is chosen or how it fares.
import './budget.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRun, apply, availableNodes, souls, join, legalActions, fuseParts, MONARCH_UID, levelOf, battleSetup, START_PARTY } from '../src/sim/run.js'
import {
  drafts, planFor, LEVELS, AUDIT, resetAudit, auditRecord, spendOptions, policy, fusionOptions, gateOf, BOOK, combosOf, autoplay, formationFeatures,
  survey, pickRoute, roomFeatures, routeConditions, record, withRoute
} from '../src/sim/autoplay.js'
import { value, decide, TREES, situation, readPlan, formation as targetFormation } from '../src/sim/read.js'
import { tuned } from './tuned.js'
import { TUNING } from '../src/tuning.js'
import { createRng } from '../src/sim/rng.js'
import { CAMP_LIST, FUSION_LIST, unitDef, fusionDef, relicDef } from '../src/content.js'
import {
  slotAt, CAMP_SLOTS, sizeOf, footprintSlots, fits, monarchSlot, makeUnit, campOpen, wallTiles, deployTile, tileAt, tracksOf, TILES, DEPTH, ROWS,
  LANES
} from '../src/sim/unit.js'
import { field, createBattle } from '../src/sim/turns.js'
import { useOutForest, outForestModel } from '../src/sim/outforest.js'
import { fight } from './rooms.js'


// A run standing in a fight's prep whose room has a second wave and a far-reaching foe on lane 6.
function prep (seed) {
  const run = createRun({ start: START_PARTY, seed })
  const node = availableNodes(run)[0]
  node.type = 'fight'
  node.foes = [{ id: 'grave_ghoul', lvl: 1, slot: slotAt(0, 3) }, { id: 'will_o_wisp', lvl: 1, slot: slotAt(1, 6) }]
  node.waves = [{ foes: [{ id: 'grave_ghoul', lvl: 1, slot: slotAt(0, 2) }] }]
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
      // Basic's three; the expert's plan's draft, four zone drafts and basic's three, and one more, its gate held, where
      // the camp has a gate (gateOf) its pieces can hold.
      if (L === LEVELS.basic) assert.equal(all.length, 3, c.id)
      else assert.ok(all.length === 8 || (all.length === 9 && gateOf(c.id).length > 0), `${c.id}: ${all.length}`)
      // The gate's draft, after the plan's and the four zone drafts: every gate cell under a piece's footprint, a 2×2
      // piece's too.
      if (all.length === 9) for (const cell of gateOf(c.id)) assert.ok(covered(all[5]).has(cell), `${c.id}: gate cell ${cell} held`)
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

// The Walk roads of `camp` (field.js field: the arrows the board draws, round the walls to the seat), one from each
// tile of the foes' rows, where the opening stands and every later wave enters; each as the set of camp cells it
// crosses, the seat aside. And each cell's road distance.
function walkRoads (camp) {
  const seat = monarchSlot(camp)
  const f = field({ root: deployTile('party', seat), walls: wallTiles(camp) })
  const cellAt = new Map([...Array(CAMP_SLOTS).keys()].filter((c) => c !== seat).map((c) => [deployTile('party', c), c]))
  const roads = []
  for (let t = tileAt(0, DEPTH - ROWS); t < TILES; t++) {
    if (f.dist[t] === Infinity) continue
    const cells = new Set()
    for (let x = t; x >= 0; x = f.arrow[x]) if (cellAt.has(x)) cells.add(cellAt.get(x))
    roads.push(cells)
  }
  return { roads, d: (c) => f.dist[deployTile('party', c)] }
}

// Prep's first draft is the plan's target formation (where you deploy and where you move are one
// idea): set up from it, the first turn's plan finds each of its blockers already on the choke it gives it.
test('the plan\'s draft, in every camp: the first turn\'s blockers already on their chokes, every road held', () => {
  for (const c of CAMP_LIST) {
    const run = prep('planned-' + c.id)
    const s = run.state
    s.camp = c.id
    s.party.find((u) => u.uid === MONARCH_UID).slot = monarchSlot(c.id)
    const want = souls(s.party).map((u) => ({ ...u, slot: -1 }))
    const draft = drafts(run, want, LEVELS.expert)[0]
    assert.equal(formationFeatures(run, draft).open, 0, c.id)
    const b = createBattle({ ...battleSetup(run, { party: draft.filter((u) => u.slot >= 0) }), quiet: true })
    const sit = situation(b)
    const blocks = [...targetFormation(b, readPlan(b, sit))].filter(([, g]) => g.role === 'block')
    assert.ok(blocks.length > 0, `${c.id}: a blocker`)
    for (const [uid, g] of blocks) assert.equal(b.byUid.get(uid).tile, g.tile, `${c.id}: ${b.byUid.get(uid).id} on its choke`)
  }
})

test('basic\'s sheltered draft: a piece fighting in melee alone stands in front, a long arm\'s too; one whose tiers teach it a ranged blow stands back', () => {
  for (const c of CAMP_LIST) {
    const run = prep('sheltered-' + c.id)
    run.state.camp = c.id
    const row = (id, tracks = [0, 0]) => Math.floor(drafts(run, [makeUnit(id, { uid: 50, lvl: 3, tracks })], LEVELS.basic)[2][1].slot / 7)
    assert.deepEqual([row('pyre_hound'), row('grave_ghoul')], [0, 0], c.id)
    assert.ok(row('pyre_hound', [2, 4]) > 0, `${c.id}: Pyre Hound with a ranged tier`)
  }
})

test('the gate, in every camp: every Walk road from the foes\' rows crosses one of its cells, and it holds none no road crosses', () => {
  for (const c of CAMP_LIST) {
    const gate = gateOf(c.id)
    const { roads, d } = walkRoads(c.id)
    const at = `${c.id}: gate ${gate}`
    assert.equal(roads.length, ROWS * LANES, `${c.id}: a road from every tile of the foes' rows`)
    assert.ok(gate.length >= 1 && gate.length <= 3, at)
    assert.equal(new Set(gate).size, gate.length, at)
    for (const r of roads) assert.ok(gate.some((x) => r.has(x)), `${at}: a road crosses none of it`)
    for (const cell of gate) {
      assert.ok(campOpen(c.id, cell) && cell !== monarchSlot(c.id), `${at}: ${cell} an open cell, not the seat`)
      assert.ok(roads.some((r) => r.has(cell)), `${at}: no road crosses ${cell}`)
      // The fewest: without it, some road would cross none of the gate.
      assert.ok(roads.some((r) => !gate.some((x) => x !== cell && r.has(x))), `${at}: ${cell} idle`)
    }
    // Where one cell not beside the seat carries every road, the gate is that cell alone, the furthest along the roads.
    const every = [...Array(CAMP_SLOTS).keys()].filter((x) => d(x) > 1 && roads.every((r) => r.has(x)))
    if (every.length) assert.deepEqual(gate, [every.sort((a, b) => d(b) - d(a))[0]], at)
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
    assert.ok(AUDIT.candidates > 7, `${AUDIT.candidates} formations met`)
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

test('fusions: the expert weighs every one it can make by the growth search (as legalActions lists them), and makes one only of those; basic never fuses', () => {
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

// A whole run at each level, and under the orders ablation (the expert ending every turn without an order), plays to
// its end without throwing (apply throws on any action it may not take); the same seed plays the same run (the whole of
// basic's, the expert's first fights, to keep the suite quick). Functional only: never how far it gets.
test('the autoplayer plays a run to its end at each level, the same seed the same run; under the orders ablation it gives no order but End Turn', () => {
  for (const [name, level] of [['basic', 'basic'], ['expert', 'expert'], ['orders', { ...LEVELS.expert, ablate: 'orders' }]]) {
    const s = autoplay(createRun({ start: START_PARTY, seed: 'whole' }), { level }).state
    assert.ok(s.phase === 'over' && ['victory', 'defeat'].includes(s.result) && s.log.some((a) => a.type === 'fight'), name)
    if (name !== 'expert') assert.ok(!s.log.some((a) => ['move', 'undo', 'act'].includes(a.type)), `${name}: End Turn alone`)
    const again = createRun({ start: START_PARTY, seed: 'whole' })
    const rng = createRng('whole').stream('autoplay')
    while (again.state.phase !== 'over' && (name === 'basic' || again.state.stats.fights < 3)) apply(again, policy(again, rng, level))
    assert.deepEqual(again.state.log, s.log.slice(0, again.state.log.length), `${name}: the same run again`)
  }
})

test('the audit counts what a run considered and chose, and leaves the audit off after', () => {
  const r = auditRecord({ seed: 'audit-basic', level: 'basic' })
  assert.ok(r.battles.n > 0 && r.plans === r.battles.n, JSON.stringify([r.plans, r.battles.n]))
  assert.ok(r.candidates >= r.plans)
  assert.ok(Object.values(r.chosen).every((n) => n <= r.plans))
  assert.equal(AUDIT.on, false)
})

test('idle essence: when its fielded souls can buy nothing, the expert weighs every tier it can afford, and nothing else', () => {
  const run = createRun({ start: START_PARTY, seed: 'idle' })
  const s = run.state
  s.essence = 5000
  // The Shop's shelf bare (it is weighed before the tiers on the map: autoplay.js pickNode), so the tiers are all there is.
  s.shop = []
  // Every soul's tracks full: nothing remains to buy (no level, nothing for the Monarch, Arise or not); then a soul
  // with room to grow.
  for (const u of souls(s.party)) Object.assign(u, { lvl: 10, tracks: [4, 2] })
  assert.deepEqual(spendOptions(run, LEVELS.expert), [])
  s.relics.push('arise')
  souls(s.party)[0].relics = ['arise']
  assert.deepEqual(spendOptions(run, LEVELS.expert), [])
  const ghoul = join(run, 'grave_ghoul')
  assert.deepEqual(spendOptions(run, LEVELS.expert), [0, 1].map((track) => ({ type: 'upgrade', uid: ghoul.uid, track })))
  assert.deepEqual(spendOptions(run, { ...LEVELS.expert, ablate: 'tracks' }), [])
  // The expert's purchase, if it makes one, is one of them.
  const a = policy(run, createRng('idle').stream('autoplay'), 'expert')
  assert.ok(a.type === 'node' || spendOptions(run, LEVELS.expert).some((o) => JSON.stringify(o) === JSON.stringify(a)), JSON.stringify(a))
})

test('the expert weighs a track\'s next two tiers together: a tier whose level rounds away is bought when the two make a level, and essence holds both', () => {
  // The Knight's and the Chanter's tracks full; a lone Frost Sprite at the first of these
  // tiers where its next tier on either track leaves its level as it is (the level rounds down) and the one after it
  // makes a level (at TUNING.level's 2 + 0.67 a tier: II and I, level 4; at 0.5 a tier it was I and I, level 3).
  // With essence for both, the expert buys the first (it declined it, weighing one tier at a time); then, any tier the
  // Sprite takes making the level, the next.
  const up = (tracks, track, n) => [0, 1].map((t) => tracks[t] + (t === track ? n : 0))
  const start = [[1, 1], [2, 1], [0, 0], [2, 2]].find((tracks) => [0, 1].every((track) =>
    levelOf({ tracks: up(tracks, track, 1) }) === levelOf({ tracks }) && levelOf({ tracks: up(tracks, track, 2) }) === levelOf({ tracks }) + 1))
  assert.ok(start, 'a Sprite whose next tier rounds away on both tracks')
  const build = () => {
    const run = createRun({ start: START_PARTY, seed: 'pair' })
    const s = run.state
    const [knight, chanter, sprite] = ['tomb_knight', 'bone_chanter', 'frost_sprite'].map((id) => souls(s.party).find((u) => u.id === id))
    const tier = (u, tracks) => Object.assign(u, makeUnit(u.id, { uid: u.uid, slot: u.slot, lvl: levelOf({ tracks }), tracks }))
    tier(knight, [4, 2])
    tier(chanter, [4, 2])
    tier(sprite, start)
    // The Shop's shelf bare (it is weighed before the tiers on the map: autoplay.js pickNode).
    s.shop = []
    s.essence = Math.max(...[0, 1].map((t) => TUNING.essence.tier[sprite.tracks[t]] + TUNING.essence.tier[sprite.tracks[t] + 1]))
    return run
  }
  const spriteOf = (s) => souls(s.party).find((u) => u.id === 'frost_sprite')
  const { state } = build()
  const { lvl, uid } = spriteOf(state)
  const after = (n, track) => levelOf({ tracks: [0, 1].map((t) => spriteOf(state).tracks[t] + (t === track ? n : 0)) })
  for (const track of [0, 1]) assert.deepEqual([after(1, track), after(2, track)], [lvl, lvl + 1], `track ${track}`)
  // The expert, and the expert with its book aside (a tier on the tracks of the combo it plays toward is worth something
  // to it alone): the field's own worth decides.
  for (const L of [LEVELS.expert, { ...LEVELS.expert, book: false }]) {
    const run = build()
    const s = run.state
    assert.deepEqual(spendOptions(run, L), [0, 1].map((track) => ({ type: 'upgrade', uid, track })), 'nothing else to buy')
    const rng = createRng('pair').stream('autoplay')
    const a = policy(run, rng, L)
    assert.deepEqual([a.type, a.uid], ['upgrade', uid], JSON.stringify(a))
    apply(run, a)
    assert.equal(spriteOf(s).lvl, lvl)
    const b = policy(run, rng, L)
    assert.deepEqual([b.type, b.uid], ['upgrade', uid], JSON.stringify(b))
    apply(run, b)
    assert.equal(spriteOf(s).lvl, lvl + 1)
  }
})

test('the expert lets a soul go only for a recruit it weighed worth it: the release, then that recruit', () => {
  // A won fight with a full retinue: whatever the expert does, a release is followed by a recruit of a soul. Today's
  // weighing (weighRecruits; the forest out of battle's, outforest.test.js, follows the same sequence).
  const before = outForestModel()
  useOutForest(null)
  try {
    let released = 0
    for (let i = 0; i < 12; i++) {
      const run = createRun({ start: START_PARTY, seed: 'letgo' + i })
      const node = availableNodes(run)[0]
      node.type = 'fight'
      // A Tomb Knight slain: its soul, a second Knight, is on offer.
      node.foes = [{ id: 'tomb_knight', lvl: 1, slot: slotAt(0, 3) }]
      apply(run, { type: 'node', id: node.id })
      fight(run)
      if (run.state.phase !== 'reap') continue
      const s = run.state
      s.essence = 1000
      while (souls(s.party).length < 12) join(run, 'clockwork_page')
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
  } finally {
    useOutForest(before)
  }
})

// The combo book (src/sim/combos.json, made by --combos, a static formula): every id in it resolves against the
// content, so it is made again whenever content or numbers change it out of date. Functional only: what it holds,
// never how it ranks.
test('the combo book: every combo, kind, track, recipe, synergy and relic in it resolves, and the book covers every fusion and core', () => {
  assert.ok(BOOK.combos.length > 0, 'the book is made: node src/sim/autoplay.js --combos')
  const floors = BOOK.combos[0].gain.length
  for (const c of BOOK.combos) {
    for (const id of [...Object.keys(c.needs), ...Object.keys(c.tracks)]) assert.ok(unitDef(id), `${c.id}: ${id}`)
    for (const [id, t] of Object.entries(c.tracks)) assert.ok(tracksOf(id)[t], `${c.id}: ${id} track ${t}`)
    if (c.fuse) assert.equal(Object.keys(c.tracks)[0], fusionDef(c.fuse).result, c.id)
    for (const k of Object.keys(c.kin ?? {})) assert.ok(Object.keys(c.needs).some((id) => unitDef(id).kin === k), `${c.id}: kin ${k}`)
    for (const r of Object.keys(c.role ?? {})) assert.ok(Object.keys(c.needs).some((id) => unitDef(id).role === r), `${c.id}: role ${r}`)
    for (const id of Object.keys(c.relics ?? {})) assert.ok(relicDef(id), `${c.id}: relic ${id}`)
    assert.equal(c.gain.length, floors, c.id)
    assert.ok(c.gain.every((g) => g === null || Number.isFinite(g)), c.id)
  }
  for (const id of Object.keys(BOOK.plain)) assert.ok(relicDef(id), `plain: relic ${id}`)
  const ids = new Set(BOOK.combos.map((c) => c.id))
  for (const c of combosOf()) assert.ok(ids.has(c.id), `the book is out of date: ${c.id} is missing (node src/sim/autoplay.js --combos)`)
})

// ── the expert's judgement out of battle ────────────────────────────────────

// A run standing in a fight's prep in camp `camp`, its three start souls fielded on `cells` (the Knight's, the
// Chanter's, the Sprite's), against two ground foes up the middle.
function formation (camp, cells) {
  const run = createRun({ start: START_PARTY, seed: 'form' })
  const node = availableNodes(run)[0]
  node.type = 'fight'
  node.foes = [{ id: 'grave_ghoul', lvl: 1, slot: slotAt(0, 3) }, { id: 'tomb_knight', lvl: 1, slot: slotAt(1, 2) }]
  node.waves = []
  apply(run, { type: 'node', id: node.id })
  const s = run.state
  s.camp = camp
  const m = { ...s.party.find((u) => u.uid === MONARCH_UID), slot: monarchSlot(camp) }
  const ids = ['tomb_knight', 'bone_chanter', 'frost_sprite']
  const party = [m, ...ids.map((id, i) => ({ ...souls(s.party).find((u) => u.id === id), slot: cells[i] }))]
  return { run, party, v: formationFeatures(run, party) }
}
const scored = (v) => value(v, TUNING.expert.formation)

test('the formation read: a melee piece holding the road with the shooters behind it scores over the reverse', () => {
  for (const [camp, cells] of [['funnel', [10, 32, 39]], ['keep', [10, 24, 23]], ['funnel', [25, 32, 39]]]) {
    const held = formation(camp, cells)
    const reverse = formation(camp, [cells[2], cells[1], cells[0]])
    assert.ok(held.v.blockers > reverse.v.blockers && held.v.behind > reverse.v.behind && held.v.exposed < reverse.v.exposed, `${camp} ${cells}`)
    assert.ok(scored(held.v) > scored(reverse.v), `${camp} ${cells}: ${scored(held.v)} ≤ ${scored(reverse.v)}`)
  }
})

test('rule fill-field: a formation that leaves a soul out where it fits never beats one that fields it', () => {
  const full = formation('funnel', [10, 32, 39])
  const short = formation('funnel', [10, 32, -1])
  const options = [{ name: 'short', v: { ...short.v, power: 1e3 } }, { name: 'full', v: full.v }]
  const pick = decide(TREES.formation, null, options, TUNING.expert.formation)
  assert.deepEqual([pick.option.name, pick.by], ['full', 'fill-field'])
})

test('rule block-roads: as few roads into the Monarch open as the pieces allow, whatever the weights say', () => {
  const held = formation('funnel', [10, 32, 39])
  const open = formation('funnel', [28, 35, 42])
  assert.ok(open.v.open > held.v.open, JSON.stringify([open.v.open, held.v.open]))
  const options = [{ name: 'open', v: { ...open.v, cover: 1e4 } }, { name: 'held', v: held.v }]
  const pick = decide(TREES.formation, null, options, TUNING.expert.formation)
  assert.deepEqual([pick.option.name, pick.by], ['held', 'block-roads'])
  // The expert's own plan for a room holds every road it can.
  const run = prep('blocked')
  const plan = planFor(run, LEVELS.expert)
  const party = plan.map((p) => ({ ...run.state.party.find((u) => u.uid === p.uid), slot: p.slot }))
  assert.equal(formationFeatures(run, party).open, 0)
})

// A run on the map with its next rooms made `types` (the first ones; a battle room keeps the floor's foes).
function crossroads (seed, types) {
  const run = createRun({ start: START_PARTY, seed })
  const nodes = availableNodes(run)
  assert.ok(nodes.length >= types.length, `${seed}: ${nodes.length} rooms`)
  const foes = run.state.map.nodes.find((n) => n.foes).foes
  types.forEach((type, i) => {
    nodes[i].type = type
    if (['fight', 'elite'].includes(type)) nodes[i].foes ??= foes
  })
  return { run, nodes }
}
const seedWith = (n) => [...Array(40).keys()].map((k) => `route-${k}`).find((seed) => availableNodes(createRun({ start: START_PARTY, seed })).length >= n)

// No room is a Shop: the route's Shop features are kept, for the fitted trees' columns, at 0.
test('the route: no room is a Shop, and its Shop features stay 0 whatever the purse', () => {
  const { run } = crossroads(seedWith(2), ['fight', 'altar'])
  for (const essence of [0, 1e4]) {
    run.state.essence = essence
    const sit = survey(run)
    for (const room of sit.rooms) {
      const v = roomFeatures(sit, room)
      assert.deepEqual([room.ahead.shop, v.shop, v.purse, v.shopAhead], [null, 0, 0, 0], `${room.type}, ${essence} essence`)
    }
    assert.equal(routeConditions(run, sit)['open.shop'], 0)
  }
})

test('rule wounded-altar: a badly wounded army takes the altar; rule wounded-no-elite: it never walks into an elite where another room is open', () => {
  const wound = (run, share) => { for (const u of souls(run.state.party)) u.hp = Math.max(1, Math.floor(u.maxHp * share)) }
  const seed = seedWith(3)
  const altar = crossroads(seed, ['fight', 'altar', 'fight'])
  wound(altar.run, 0.1)
  resetAudit(true, altar.run)
  try {
    assert.equal(withRoute('hand', () => pickRoute(altar.run)), altar.nodes[1].id)
    assert.equal(AUDIT.rules['route: wounded-altar'], 1)
  } finally {
    resetAudit(false)
  }
  const elite = crossroads(seed, ['elite', 'fight'])
  wound(elite.run, 0.3)
  const sit = survey(elite.run)
  const rooms = sit.rooms.map((room) => ({ node: elite.nodes.find((n) => n.id === room.id), v: { ...roomFeatures(sit, room), elite: room.type === 'elite' ? 1e3 : 0 } }))
  const pick = decide(TREES.route, sit, rooms, TUNING.expert.route)
  assert.deepEqual([pick.option.node.type, pick.by], ['fight', 'wounded-no-elite'])
  // Whole, the elite is a room like another.
  assert.ok(sit.health < TUNING.expert.tree.wounded && survey(crossroads(seed, ['elite', 'fight']).run).health >= TUNING.expert.tree.wounded)
})

test('rule give-relic: a piece relic waiting is given to a standing soul with room for it, though the weights would keep it', () => tuned({ expert: { ...TUNING.expert, growth: { ...TUNING.expert.growth, keep: 1e9 } } }, () => {
  const run = createRun({ start: START_PARTY, seed: 'give' })
  run.state.relics.push('whetstone')
  assert.deepEqual(survey(run).relics.unheld, ['whetstone'])
  resetAudit(true, run)
  try {
    const a = policy(run, createRng('give').stream('autoplay'), 'expert')
    assert.equal(a.type, 'hold', JSON.stringify(a))
    assert.ok(souls(run.state.party).find((u) => u.uid === a.uid).hp > 0)
    assert.equal(AUDIT.rules['hold: give-relic'], 1)
  } finally {
    resetAudit(false)
  }
}))

test('the survey: where the run stands, its purse and prices, wounds, the target, the relics waiting, and the rooms ahead with their threats', () => {
  const run = createRun({ start: START_PARTY, seed: 'survey' })
  const sit = survey(run)
  assert.deepEqual([sit.floor, sit.phase, sit.purse, sit.fallen], [1, 'map', run.state.essence, 0])
  assert.ok(sit.health === 1 && sit.monarch === 1 && sit.strength > 0)
  assert.ok(sit.prices.tier > 0 && sit.prices.relic > 0 && sit.prices.recruit === null)
  assert.deepEqual([sit.command, sit.fielded, sit.waiting], [TUNING.party.field, 3, 0])
  assert.deepEqual(sit.rooms.map((r) => r.id), availableNodes(run).map((n) => n.id))
  for (const r of sit.rooms) {
    assert.ok(r.threat > 0 && r.threats.length > 0 && r.unanswered.every((t) => r.threats.includes(t)), JSON.stringify(r))
    assert.equal(r.ahead.shop, null, 'no room is a Shop')
  }
})

// No decision of the expert's out of battle plays a battle or a turn of the foes: the camp's turn reads its pressure
// (TUNING.policy.press) and a battle played out reads the sim's bound on turns (TUNING.turn.guard), so both are counted
// while the expert decides, over whole runs (in battle the solver plays its lines ahead on copies, so there neither is).
test('no decision of the expert out of battle plays a battle or a turn of the foes, over whole runs', () => {
  const reads = { press: 0, guard: 0 }
  const spy = (o, key, count) => {
    const real = o[key]
    Object.defineProperty(o, key, { get () { reads[count]++; return real }, configurable: true })
    return () => Object.defineProperty(o, key, { value: real, writable: true, configurable: true, enumerable: true })
  }
  const undo = [spy(TUNING.policy, 'press', 'press'), spy(TUNING.turn, 'guard', 'guard')]
  try {
    for (const seed of ['norehearse-0', 'norehearse-1']) {
      const run = createRun({ start: START_PARTY, seed })
      const rng = createRng(seed).stream('autoplay')
      while (run.state.phase !== 'over') {
        const phase = run.state.phase
        reads.press = reads.guard = 0
        const a = policy(run, rng, 'expert')
        if (phase !== 'battle') assert.deepEqual([reads.press, reads.guard], [0, 0], `${seed} ${phase}: the camp's pressure read, or a battle played`)
        apply(run, a)
      }
    }
  } finally {
    for (const f of undo) f()
  }
})

// A full expert run on a few seeds plays to its end, the same seed the same run. Functional only: never how far it gets.
test('a full expert run finishes on a few seeds, the same seed the same run', () => {
  for (const seed of ['full-0', 'full-1', 'full-2']) {
    const r = record({ seed, level: 'expert' })
    assert.ok(['victory', 'defeat'].includes(r.result) && r.battles.length > 0, seed)
  }
  const log = autoplay(createRun({ start: START_PARTY, seed: 'full-0' }), { level: 'expert' }).state.log
  assert.deepEqual(autoplay(createRun({ start: START_PARTY, seed: 'full-0' }), { level: 'expert' }).state.log, log)
})
