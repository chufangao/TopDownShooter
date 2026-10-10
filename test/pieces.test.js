// One soul, one piece, one body (2026-10-10, when stacking left the game): the summons the tiers that once added
// bodies call instead, the foes' cohorts as foes of their own, what a soul let go pays back, a piece moved onto the
// one piece its footprint covers (a 2×2 too) swapping with it, and a soul offer priced as the run stands when it is
// read. (The reserve letting in the first due foe with room is in battle.test.js, the abilitiesOf guard in
// content.test.js.) Functional only: what the rules do, never how a run fares.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stepBattle, stats } from '../src/sim/battle.js'
import {
  createRun, apply, legalActions, join, drawRoom, battleSetup, availableNodes, souls, fielded, monarchOf, canPlace, swapWith, releaseRefund,
  recruitCost, soulOffer, levelOf, kindLevel, OSSUARY
} from '../src/sim/run.js'
import {
  makeUnit, tileAt, tileX, tileY, distanceBetween, summonsOf, footprintSlots, fits, monarchSlot, CAMP_ROWS, CAMP_SLOTS, COLS, LANES, SLOTS
} from '../src/sim/unit.js'
import { TUNING } from '../src/tuning.js'
import { TRACKS, unitDef } from '../src/content.js'
import { tuned } from './tuned.js'
import { on, scene, unit, moves } from './scene.js'

const MARROW_II = [0, 2]
const summonsIn = (b) => b.units.filter((u) => u.summoned)

// ── summons ──────────────────────────────────────────────────────────────────────────────────────

test('a soul whose tiers bring summons calls them as the battle begins: shadows of its kind beside it, at a share of its HP, announced, holding', () => {
  // A Bone Chanter on Marrowcaller II at (3, 3), the Monarch at (3, 0), a Golem far off.
  const b = scene([on('monarch', 0, 'party', 3, 0), on('bone_chanter', 1, 'party', 3, 3, 4, MARROW_II), on('iron_golem', 50, 'foe', 3, 10)])
  const chanter = unit(b, 1)
  const called = summonsIn(b)
  const n = TRACKS.bone_chanter[1].tiers[1].summon
  assert.equal(summonsOf(chanter), n)
  // As many as its tiers bring; none of them brings any (a summon holds its summoner's tiers, and calls none).
  assert.equal(called.length, n)
  for (const s of called) {
    assert.deepEqual([s.id, s.side, s.shadow, s.summoned, s.summoner, s.lvl, s.tracks], ['bone_chanter', 'party', true, true, 1, 4, MARROW_II])
    assert.ok(s.uid > 50, 'a uid past every unit there')
    // TUNING.summon.hp of a whole one's HP, whole.
    assert.deepEqual([s.hp, s.maxHp], [Math.round(stats(b, s).hp * TUNING.summon.hp), Math.round(stats(b, s).hp * TUNING.summon.hp)])
    assert.ok(s.maxHp < chanter.maxHp)
  }
  // Each on the free tile nearest the Chanter, ties to the tile nearest the Monarch, then the centre lane: (3, 2), then
  // (2, 2).
  assert.deepEqual(called.map((s) => s.tile), [tileAt(3, 2), tileAt(2, 2)])
  assert.ok(called.every((s) => distanceBetween(s.tile, 1, chanter.tile, 1) === 1 && b.at[s.tile] === s))
  // Announced at the start with the rest, as shadows called by the Chanter.
  const start = b.events[0].units.filter((u) => u.summoned)
  assert.deepEqual(start.map((u) => [u.uid, u.id, u.shadow, u.summoner, u.tile]), called.map((s) => [s.uid, 'bone_chanter', true, 1, s.tile]))
  // They hold where they rose, as every piece of yours does.
  for (let k = 0; k < 200; k++) {
    const events = stepBattle(b)
    for (const s of called) assert.deepEqual(moves(events, s.uid), [], 'it holds')
  }
})

test('summons count toward synergies as shadows do; none with the summons switch, none for a fallen soul, none without the tier', () => {
  const party = (b) => b.events[0].synergies.filter((x) => x.side === 'party').map((x) => x.id)
  const chanter = (tracks, opts = {}, hp = undefined) => scene([on('monarch', 0, 'party', 3, 0), { ...on('bone_chanter', 1, 'party', 3, 3, 4, tracks), ...(hp !== undefined && { hp }) },
    on('iron_golem', 50, 'foe', 3, 10)], opts)
  // A lone Chanter is one undead; with its two summons, three: Undead 2.
  assert.ok(party(chanter(MARROW_II)).includes('undead_2'))
  assert.ok(!party(chanter([0, 1])).includes('undead_2'))
  assert.equal(summonsIn(chanter([0, 1])).length, 0, 'Marrowcaller I calls none')
  const off = chanter(MARROW_II, { ablate: ['summons'] })
  assert.equal(summonsIn(off).length, 0)
  assert.ok(!party(off).includes('undead_2'))
  // A fallen soul does not fight, and calls none.
  const fallen = chanter(MARROW_II, {}, 0)
  assert.deepEqual([unit(fallen, 1), summonsIn(fallen).length], [undefined, 0])
})

test('with no free tile beside it, fewer summons rise: never on a wall, the seat, a held tile or out of the camp', () => {
  // Every camp tile walled but the Chanter's (0, 0) and (1, 0): one summon rises, on (1, 0); the other finds no tile in
  // the camp, and rises nowhere (never in the gap row past the walls).
  const walls = [...Array(LANES * CAMP_ROWS).keys()].filter((t) => t !== tileAt(0, 0) && t !== tileAt(1, 0))
  const b = scene([on('bone_chanter', 1, 'party', 0, 0, 4, MARROW_II), on('iron_golem', 50, 'foe', 3, 10)], { walls })
  assert.deepEqual(summonsIn(b).map((s) => s.tile), [tileAt(1, 0)])
  // In the open, beside the Monarch: never on its seat, never on a tile someone holds, always in the camp.
  const open = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 2, 'party', 3, 2), on('bone_chanter', 1, 'party', 3, 1, 4, MARROW_II),
    on('iron_golem', 50, 'foe', 3, 10)])
  const tiles = summonsIn(open).map((s) => s.tile)
  assert.equal(tiles.length, 2)
  assert.ok(tiles.every((t) => t !== tileAt(3, 0) && t !== tileAt(3, 2) && t !== tileAt(3, 1) && tileY(t) < CAMP_ROWS), tiles.map((t) => [tileX(t), tileY(t)]).join(' '))
})

test('in a run, a soul\'s summons fight its battles and are gone after: nothing of them comes back, and the run moves past their uids', () => {
  const run = createRun({ seed: 'summons' })
  const s = run.state
  s.essence = 1000
  apply(run, { type: 'upgrade', kind: 'bone_chanter', track: 1 })
  apply(run, { type: 'upgrade', kind: 'bone_chanter', track: 1 })
  const chanter = souls(s.party).find((u) => u.id === 'bone_chanter')
  assert.ok(chanter.slot >= 0 && summonsOf(chanter) === TRACKS.bone_chanter[1].tiers[1].summon)
  const node = availableNodes(run).find((n) => n.foes)
  apply(run, { type: 'node', id: node.id })
  const before = s.party.map((u) => u.uid)
  apply(run, { type: 'fight' })
  const called = summonsIn(run.battle)
  assert.equal(called.length, summonsOf(chanter))
  assert.deepEqual(s.party.map((u) => u.uid), before, 'no summon joins the retinue')
  assert.ok(called.every((u) => u.uid < s.nextUid), 'the run moves past their uids')
  assert.ok(s.party.every((u) => !('count' in u) && u.hp >= 0 && u.hp <= u.maxHp))
})

// ── the foes' cohorts ────────────────────────────────────────────────────────────────────────────

test('a captain\'s cohort are foes of their own: of its kind, on the free slots nearest it, one body each; dropped when the formation is full', () => {
  const sp = TUNING.spawn
  for (let i = 0; i < 12; i++) {
    const room = drawRoom(`cohort${i}`, 2, { id: 'n', type: 'fight', rank: 2 })
    const g = room.foes
    const drawn = sp.fight[1]
    const cohort = sp.cohort[1]
    assert.equal(g.length, drawn + sp.captains.fight * cohort, `cohort${i}`)
    assert.equal(new Set(g.map((f) => f.slot)).size, g.length, 'a slot each')
    assert.ok(g.every((f) => !('count' in f)))
    // The cohort comes after the foes drawn, every one of the kind of a foe drawn (its captain), beside it.
    const band = g.slice(drawn)
    const captains = g.slice(0, drawn).filter((f) => f.id === band[0].id)
    assert.ok(band.every((f) => f.id === band[0].id) && captains.length > 0)
    const near = (a, b) => Math.abs(Math.floor(a / COLS) - Math.floor(b / COLS)) + Math.abs((a % COLS) - (b % COLS))
    assert.ok(band.every((f) => captains.some((c) => near(c.slot, f.slot) <= 2)), JSON.stringify(g))
    // In a battle each is a foe unit of its own, with its own uid and a body's HP.
    const run = createRun({ seed: `cohort${i}` })
    const node = availableNodes(run)[0]
    Object.assign(node, { type: 'fight' }, room)
    apply(run, { type: 'node', id: node.id })
    const setup = battleSetup(run)
    assert.equal(setup.foes.length, g.length)
    assert.equal(new Set(setup.foes.map((u) => u.uid)).size, g.length)
    assert.ok(setup.foes.every((u, k) => u.maxHp === makeUnit(g[k].id, { lvl: g[k].lvl }).maxHp && !('count' in u)))
  }
  // Cohorts too big for the formation: it fills, and the rest are dropped.
  tuned({ spawn: { cohort: [0, 40, 40, 40] } }, () => {
    const g = drawRoom('cohort-full', 2, { id: 'n', type: 'elite', rank: 2 }).foes
    assert.equal(g.length, SLOTS)
    assert.equal(new Set(g.map((f) => f.slot)).size, SLOTS)
  })
})

// ── release ──────────────────────────────────────────────────────────────────────────────────────

test('a soul let go pays back half of what recruiting it would cost now, rounded down; a fallen one too; never the Monarch', () => {
  const run = createRun({ seed: 'refund' })
  const s = run.state
  s.essence = 0
  const [knight, chanter, sprite] = ['tomb_knight', 'bone_chanter', 'frost_sprite'].map((id) => souls(s.party).find((u) => u.id === id))
  const refund = releaseRefund(run, knight)
  assert.equal(refund, Math.floor(TUNING.essence.refund * recruitCost(run, knight.id, knight.lvl)))
  assert.ok(refund > 0)
  apply(run, { type: 'release', uid: knight.uid })
  assert.equal(s.essence, refund)
  // A fallen soul pays its refund as well.
  chanter.hp = 0
  chanter.slot = OSSUARY
  const fallen = releaseRefund(run, chanter)
  apply(run, { type: 'release', uid: chanter.uid })
  assert.equal(s.essence, refund + fallen)
  // The price it reads is now's: the floor's price scale and the recruit discount.
  const here = releaseRefund(run, sprite)
  s.floor = 3
  assert.ok(releaseRefund(run, sprite) > here)
  s.relics = ['binding_chain']
  assert.equal(releaseRefund(run, sprite), Math.floor(TUNING.essence.refund * recruitCost(run, sprite.id, sprite.lvl)))
  assert.ok(recruitCost(run, sprite.id, sprite.lvl) < recruitCost({ state: { ...s, relics: [] } }, sprite.id, sprite.lvl))
  // The Monarch is never released, nor the last soul standing.
  assert.throws(() => apply(run, { type: 'release', uid: monarchOf(s).uid }))
  assert.throws(() => apply(run, { type: 'release', uid: sprite.uid }))
})

// ── placing: swaps, a 2×2 too ────────────────────────────────────────────────────────────────────

// A run in its first map with a Bone Colossus (2×2) besides its start souls, every soul in the ossuary; and two anchors
// where a 2×2 fits, their footprints apart (`a`, `b`).
function camp () {
  const run = createRun({ seed: 'swap' })
  const s = run.state
  const colossus = join(run, 'bone_colossus')
  for (const u of souls(s.party)) u.slot = OSSUARY
  const [knight, chanter, sprite] = ['tomb_knight', 'bone_chanter', 'frost_sprite'].map((id) => souls(s.party).find((u) => u.id === id))
  const seat = monarchSlot(s.camp)
  const cells = (a) => footprintSlots(a, 2)
  const fit = (a) => fits(s.camp, a, 2, new Set([seat]))
  let pair = null
  for (let a = 0; a < CAMP_SLOTS && !pair; a++) {
    for (let b = 0; b < CAMP_SLOTS && !pair; b++) if (fit(a) && fit(b) && !cells(b).some((c) => cells(a).includes(c))) pair = { a, b }
  }
  assert.ok(pair, 'two footprints apart')
  return { run, s, colossus, knight, chanter, sprite, seat, cells, ...pair }
}

test('a 2×2 moved onto a footprint over exactly one piece swaps with it, from the field or the ossuary; over two pieces or the seat, nowhere', () => {
  // On the field: the Colossus at a, the Knight on a cell of b's footprint (the next lane, not b itself).
  {
    const { run, colossus, knight, a, b } = camp()
    colossus.slot = a
    knight.slot = b + 1
    assert.equal(swapWith(run, colossus, b), knight)
    assert.ok(canPlace(run, colossus, b))
    apply(run, { type: 'place', uid: colossus.uid, slot: b })
    assert.deepEqual([colossus.slot, knight.slot], [b, a], 'the Knight takes the Colossus\'s old place')
  }
  // From the ossuary: the piece under it goes to the ossuary.
  {
    const { run, colossus, knight, b } = camp()
    knight.slot = b + 1
    assert.ok(canPlace(run, colossus, b))
    apply(run, { type: 'place', uid: colossus.uid, slot: b })
    assert.deepEqual([colossus.slot, knight.slot], [b, OSSUARY])
  }
  // Over two pieces: 'many', and no place.
  {
    const { run, s, colossus, knight, chanter, a, b } = camp()
    colossus.slot = a
    knight.slot = b + 1
    chanter.slot = b - COLS
    assert.equal(swapWith(run, colossus, b), 'many')
    assert.ok(!canPlace(run, colossus, b))
    assert.throws(() => apply(run, { type: 'place', uid: colossus.uid, slot: b }))
    assert.deepEqual([colossus.slot, knight.slot, chanter.slot], [a, b + 1, b - COLS])
    assert.ok(!legalActions(run).some((x) => x.type === 'place' && x.uid === colossus.uid && x.slot === b))
    assert.equal(s.phase, 'map')
  }
  // Over the Monarch's seat: 'many' too, whatever else is there.
  {
    const { run, colossus, seat, cells } = camp()
    const over = [...Array(CAMP_SLOTS).keys()].find((x) => cells(x)?.includes(seat))
    assert.ok(over !== undefined)
    assert.equal(swapWith(run, colossus, over), 'many')
    assert.ok(!canPlace(run, colossus, over))
  }
})

test('a 1×1 moved onto any cell of a 2×2 swaps with it (the 2×2 to the mover\'s old place, where it fits); onto free ground, with nothing', () => {
  const { run, colossus, sprite, knight, a, b } = camp()
  colossus.slot = a
  sprite.slot = b
  // The cell in the next lane from the Colossus's anchor: no anchor of anyone's, but the Colossus's.
  assert.equal(swapWith(run, sprite, a + 1), colossus)
  assert.ok(canPlace(run, sprite, a + 1))
  apply(run, { type: 'place', uid: sprite.uid, slot: a + 1 })
  assert.deepEqual([sprite.slot, colossus.slot], [a + 1, b])
  // Nothing under a free cell.
  const free = [...Array(CAMP_SLOTS).keys()].find((x) => canPlace(run, knight, x) && swapWith(run, knight, x) === null)
  assert.ok(free !== undefined)
  apply(run, { type: 'place', uid: knight.uid, slot: free })
  assert.deepEqual(fielded(souls(run.state.party)).map((u) => u.uid).sort(), [colossus.uid, sprite.uid, knight.uid].sort())
})

// ── soul offers ──────────────────────────────────────────────────────────────────────────────────

// A run on the spoils of a fight, its offers `offers` (souls: relics are bought in Shops, never laid out here).
function spoils (seed, offers, relics = []) {
  const run = createRun({ seed })
  const s = run.state
  s.at = s.map.nodes.find((n) => n.type === 'fight').id
  s.phase = 'reap'
  s.relics = relics
  s.offers = offers.map((o) => soulOffer(run, o))
  return run
}

test('a soul offer is levelled and priced as the run stands when it is read: Soul Lantern levels it, Binding Chain prices it', () => {
  // A kind new to the run, with a Soul Lantern held: one free tier makes no level; a second copy held, two do.
  const run = spoils('lantern', [{ type: 'soul', id: 'grave_ghoul', name: unitDef('grave_ghoul').name }], ['soul_lantern'])
  const s = run.state
  s.essence = 1000
  const before = soulOffer(run, s.offers[0])
  assert.deepEqual([before.lvl, before.cost], [levelOf({ tracks: [1, 0] }), recruitCost(run, 'grave_ghoul', levelOf({ tracks: [1, 0] }))])
  s.relics.push('soul_lantern')
  const lvl = levelOf({ tracks: [1, 1] })
  assert.ok(lvl > before.lvl)
  const now = soulOffer(run, s.offers[0])
  assert.deepEqual([now.lvl, now.cost, now.desc], [lvl, recruitCost(run, 'grave_ghoul', lvl), `Rises at level ${lvl}.`], 'the offer read again')
  const purse = s.essence
  apply(run, { type: 'reap', index: 0 })
  assert.equal(s.essence, purse - recruitCost(run, 'grave_ghoul', lvl))
  assert.deepEqual([s.kinds.grave_ghoul.tracks, kindLevel(s, 'grave_ghoul'), souls(s.party).find((u) => u.id === 'grave_ghoul').lvl], [[1, 1], lvl, lvl])
  // A kind held, the purse between the two prices: the recruit is not to be had without Binding Chain, and with it held
  // it is, at the lower price.
  const chain = spoils('chain', [{ type: 'soul', id: 'tomb_knight', name: unitDef('tomb_knight').name }])
  const c = chain.state
  const full = soulOffer(chain, c.offers[0]).cost
  const cut = recruitCost({ state: { ...c, relics: ['binding_chain'] } }, 'tomb_knight', kindLevel(c, 'tomb_knight'))
  assert.ok(cut < full)
  c.essence = cut
  assert.ok(!legalActions(chain).some((x) => x.type === 'reap' && x.index === 0))
  assert.throws(() => apply(chain, { type: 'reap', index: 0 }), /not enough essence/)
  c.relics.push('binding_chain')
  assert.equal(soulOffer(chain, c.offers[0]).cost, cut)
  assert.ok(legalActions(chain).some((x) => x.type === 'reap' && x.index === 0))
  apply(chain, { type: 'reap', index: 0 })
  assert.equal(c.essence, 0)
})
