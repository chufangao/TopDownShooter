// The altar's choice (run.js): one rite of three, the Monarch's heal, a transmutation or a free tier, legal
// and exclusive; a transmutation keeps the soul (its level, its relics, its wounds, its cell) and draws its new kind
// from the floor's pool at its tier, by the seed; a consecration is one tier, free; a log of each replays; basic heals,
// the expert weighs them (autoplay.js pickAltar). Functional only: never which rite wins runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRun, apply, legalActions, availableNodes, replay, souls, canAdvance, levelOf, spawnPool, monarchOf, join,
  altarActions, transmuteOffer, canTransmute, START_PARTY
} from '../src/sim/run.js'
import { nextTracks, baseStats, tiersOf, tracksOf } from '../src/sim/unit.js'
import { policy, pickAltar, altarOptions, altarCandidates, survey, LEVELS } from '../src/sim/autoplay.js'
import { UNITS } from '../src/content.js'
import { TUNING } from '../src/tuning.js'
import { fight } from './rooms.js'

const RITES = ['heal', 'transmute', 'consecrate']
const copyOf = (run) => ({ state: structuredClone(run.state), battle: null, setup: null })

// The trio one fight into a floor whose map holds an altar at rank 2 (the first seed `rite-<i>` with one whose first
// fight the expert wins), on the map with the altar next: { run, altar (its id) }. Every run below is a copy of it.
const BEFORE = (() => {
  for (let i = 0; i < 100; i++) {
    const run = createRun({ start: START_PARTY, seed: `rite-${i}` })
    const altar = run.state.map.nodes.find((n) => n.rank === 2 && n.type === 'altar')
    const into = altar && availableNodes(run).find((n) => n.next.includes(altar.id))
    if (!into) continue
    apply(run, { type: 'node', id: into.id })
    fight(run)
    if (run.state.phase !== 'reap') continue
    apply(run, { type: 'reap', index: null })
    return { run, altar: altar.id }
  }
  assert.fail('no rite seed reached an altar')
})()
// A copy of it made `ready` on the map, then walked into the altar.
function atAltar (ready = () => {}) {
  const run = copyOf(BEFORE.run)
  ready(run)
  apply(run, { type: 'node', id: BEFORE.altar })
  return run
}

test('an altar asks one rite of three: the heal, each soul\'s transmutations, each soul\'s free tiers; nothing else', () => {
  const run = atAltar()
  const s = run.state
  assert.equal(s.phase, 'altar')
  const legal = legalActions(run)
  assert.deepEqual(legal, altarActions(run))
  assert.deepEqual(legal[0], { type: 'heal' })
  assert.ok(legal.every((a) => RITES.includes(a.type)))
  for (const u of souls(s.party)) {
    const offered = legal.filter((a) => a.type === 'transmute' && a.uid === u.uid)
    assert.deepEqual(offered.map((a) => a.index), transmuteOffer(s, u.id).map((_, i) => i), u.id)
    assert.ok(offered.length > 0, `${u.id}: a drafted kind is offered others`)
  }
  for (const u of souls(s.party)) for (const track of [0, 1]) assert.equal(legal.some((a) => a.type === 'consecrate' && a.uid === u.uid && a.track === track), canAdvance(s, u, track))
  // No room walked, no soul placed, released or given a relic there.
  const u = souls(s.party)[0]
  for (const a of [{ type: 'node', id: availableNodes(BEFORE.run)[0].id }, { type: 'place', uid: u.uid, slot: -1 }, { type: 'release', uid: u.uid }, { type: 'buy', index: 0 }]) {
    assert.throws(() => apply(run, a), /needs phase/, a.type)
  }
})

test('one rite and the room ends: none of the three is left, and the purse and the souls\' count are as they were', () => {
  const at = atAltar()
  const legal = legalActions(at)
  for (const type of RITES) {
    const run = copyOf(at)
    const s = run.state
    const n = souls(s.party).length
    const essence = s.essence
    apply(run, legal.find((a) => a.type === type))
    assert.equal(s.phase, 'map', type)
    assert.deepEqual([souls(s.party).length, s.essence], [n, essence], type)
    assert.ok(!legalActions(run).some((a) => RITES.includes(a.type)), type)
    for (const a of legal.filter((x, i) => legal.findIndex((y) => y.type === x.type) === i)) assert.throws(() => apply(run, a), /needs phase altar/, `${type}, then ${a.type}`)
  }
})

test('a transmutation draws a kind of the floor\'s pool at the soul\'s tier, never its own, by the seed and the altar', () => {
  const run = atAltar()
  const s = run.state
  const pool = spawnPool(s.floor).units
  for (const kind of new Set(souls(s.party).map((u) => u.id))) {
    const offer = transmuteOffer(s, kind)
    const same = pool.filter((k) => k.tier === UNITS[kind].tier && k.id !== kind)
    assert.equal(offer.length, Math.min(TUNING.run.altarOffer, same.length), kind)
    assert.equal(new Set(offer).size, offer.length)
    for (const id of offer) assert.ok(same.some((k) => k.id === id), `${kind}: ${id}`)
    // The same seed, floor and altar draw the same; other seeds and other altars, others.
    assert.deepEqual(transmuteOffer(structuredClone(s), kind), offer)
    const draws = new Set(Array.from({ length: 16 }, (_, i) => transmuteOffer({ ...s, seed: `other-${i}` }, kind).join()))
    assert.ok(draws.size > 1, kind)
    assert.ok(new Set(s.map.nodes.map((n) => transmuteOffer({ ...s, at: n.id }, kind).join())).size > 1, kind)
  }
  // No offer for a fused kind (made, not met), and none taken by a fallen soul or the Monarch.
  assert.deepEqual(transmuteOffer(s, 'pale_court'), [])
  const u = souls(s.party)[0]
  u.hp = 0
  assert.ok(!canTransmute(s, u) && !canTransmute(s, monarchOf(s)))
  assert.ok(!legalActions(run).some((a) => a.type === 'transmute' && a.uid === u.uid))
  assert.throws(() => apply(run, { type: 'transmute', uid: u.uid, index: 0 }), /cannot transmute/)
  assert.throws(() => apply(run, { type: 'transmute', uid: monarchOf(s).uid, index: 0 }), /cannot transmute/)
  const v = souls(s.party)[1]
  for (const index of [TUNING.run.altarOffer, -1, null, '0']) assert.throws(() => apply(run, { type: 'transmute', uid: v.uid, index }), /cannot transmute/, String(index))
})

test('a transmutation keeps the soul: its uid, level, tiers, relics, share of HP and cell', () => {
  let u = null
  let into = null
  const run = atAltar((r) => {
    const s = r.state
    u = souls(s.party).find((x) => x.hp > 0)
    // Two tiers bought on it (a level above its first), a relic held, half its HP.
    s.essence = 5000
    apply(r, { type: 'upgrade', uid: u.uid, track: 0 })
    apply(r, { type: 'upgrade', uid: u.uid, track: 0 })
    s.relics.push('whetstone')
    apply(r, { type: 'hold', relic: 'whetstone', uid: u.uid })
    u.hp = Math.round(u.maxHp / 2)
    into = 0
  })
  const s = run.state
  const was = { ...structuredClone(u), n: souls(s.party).length, essence: s.essence }
  assert.ok(was.lvl > levelOf({ tracks: [0, 0] }))
  apply(run, { type: 'transmute', uid: u.uid, index: into })
  const v = s.party.find((x) => x.uid === was.uid)
  assert.equal(v.id, transmuteOffer({ ...s, at: BEFORE.altar }, was.id)[into])
  assert.deepEqual([v.lvl, v.tracks, v.relics, v.slot], [was.lvl, [2, 0], ['whetstone'], was.slot])
  assert.ok(Math.abs(v.hp / v.maxHp - was.hp / was.maxHp) < 0.01, `${v.hp}/${v.maxHp}`)
  assert.equal(v.maxHp, baseStats(v.id, v.lvl).hp)
  // Its tiers come with it, each on its new kind's track of the same number: the first track's I and II of the new kind.
  assert.deepEqual(tiersOf(v).map((t) => t.desc), tracksOf(v.id)[0].tiers.slice(0, 2).map((t) => t.desc))
  assert.deepEqual([souls(s.party).length, s.essence], [was.n, was.essence])
})

test('a transmutation touches the soul alone: another soul of the kind it becomes keeps its own tiers and level', () => {
  let u = null
  let other = null
  const run = atAltar((r) => {
    const s = r.state
    u = souls(s.party).find((x) => x.hp > 0)
    other = join(r, transmuteOffer({ ...s, at: BEFORE.altar }, u.id)[0])
    s.essence = 5000
    for (let k = 0; k < 2; k++) apply(r, { type: 'upgrade', uid: other.uid, track: 0 })
  })
  const s = run.state
  const was = { u: structuredClone(u), other: structuredClone(other) }
  apply(run, { type: 'transmute', uid: u.uid, index: 0 })
  const v = s.party.find((x) => x.uid === was.u.uid)
  const o = s.party.find((x) => x.uid === was.other.uid)
  assert.equal(v.id, o.id)
  assert.deepEqual([v.lvl, v.tracks], [was.u.lvl, was.u.tracks])
  assert.deepEqual([o.lvl, o.tracks, o.maxHp], [was.other.lvl, was.other.tracks, was.other.maxHp])
  assert.ok(o.lvl > v.lvl)
})

test('a consecration is one tier, free: the soul\'s next on the track chosen, as an upgrade would buy it; none past what the tracks allow', () => {
  const uid = souls(BEFORE.run.state.party)[0].uid
  for (const track of [0, 1]) {
    const run = atAltar()
    const s = run.state
    const before = { essence: s.essence, spent: s.stats.spent, party: structuredClone(s.party) }
    apply(run, { type: 'consecrate', uid, track })
    assert.deepEqual([s.essence, s.stats.spent], [before.essence, before.spent])
    const u = s.party.find((x) => x.uid === uid)
    assert.deepEqual([u.tracks, u.lvl], [nextTracks(before.party.find((x) => x.uid === uid).tracks, track), levelOf(u)])
    for (const x of s.party) if (x.uid !== uid) assert.deepEqual(x, before.party.find((y) => y.uid === x.uid))
    // As buying it would: the same retinue as the tier paid for on the map, but for the purse.
    const paid = copyOf(BEFORE.run)
    paid.state.essence = 5000
    apply(paid, { type: 'upgrade', uid, track })
    assert.deepEqual(s.party, paid.state.party)
  }
  // A track the crosspath rule stops (the other past II, this at II) takes none, nor a soul not held.
  const run = atAltar((r) => { r.state.party.find((x) => x.uid === uid).tracks = [3, 2] })
  assert.ok(!legalActions(run).some((a) => a.type === 'consecrate' && a.uid === uid && a.track === 1))
  assert.throws(() => apply(run, { type: 'consecrate', uid, track: 1 }), /cannot consecrate/)
  assert.throws(() => apply(run, { type: 'consecrate', uid: 999, track: 0 }), /cannot consecrate/)
  apply(run, { type: 'consecrate', uid, track: 0 })
  assert.deepEqual(run.state.party.find((x) => x.uid === uid).tracks, [4, 2])
})

test('a log with each rite replays to the same run', () => {
  const legal = legalActions(atAltar())
  for (const type of RITES) {
    const run = atAltar()
    apply(run, legal.filter((a) => a.type === type).at(-1))
    apply(run, { type: 'node', id: availableNodes(run)[0].id })
    const again = replay(run.state.seed, run.state.log)
    assert.deepEqual(again.state, run.state, type)
  }
})

test('basic heals; the expert takes the rite that adds most to its sketch, heals a wounded Monarch, and takes no free tier under the tracks ablation', () => {
  const run = atAltar()
  assert.deepEqual(policy(run, null, 'basic'), { type: 'heal' })
  const L = LEVELS.expert
  const pick = policy(run, null, 'expert')
  assert.ok(legalActions(run).some((a) => JSON.stringify(a) === JSON.stringify(pick)))
  assert.deepEqual(pickAltar(run, L, survey(run, L)), pick)
  // The best by the sketch's gain (altarCandidates': grow's score), where it beats keeping; else the heal.
  const d = altarCandidates(run, L)
  const best = d.cands.reduce((a, b) => (b.score > a.score ? b : a))
  assert.equal(d.today, best.score > TUNING.expert.growth.keep ? best.id : JSON.stringify({ type: 'heal' }))
  assert.equal(d.cands.length, altarOptions(run, L).length)
  // A Monarch below TUNING.expert.tree.altar of its HP is healed (TREES.altar's monarch-heal), unless nothing may heal it.
  const hurt = atAltar((r) => { const m = monarchOf(r.state); m.hp = Math.floor(m.maxHp * TUNING.expert.tree.altar * 0.5) })
  assert.deepEqual(policy(hurt, null, 'expert'), { type: 'heal' })
  const cob = atAltar((r) => { r.state.relics.push('court_of_bone'); const m = monarchOf(r.state); m.hp = Math.floor(m.maxHp * TUNING.expert.tree.altar * 0.5) })
  assert.notDeepEqual(policy(cob, null, 'expert'), { type: 'heal' })
  // The tracks ablation takes no tier, bought or free.
  assert.ok(!altarOptions(run, { ...L, ablate: 'tracks' }).some((a) => a.type === 'consecrate'))
  assert.ok(altarOptions(run, L).some((a) => a.type === 'consecrate'))
})
