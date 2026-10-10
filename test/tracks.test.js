// Upgrades per kind (DESIGN §2.6): a kind's two tracks of tiers and the level they give, held by every soul of it,
// the crosspath rule, the costs, recruits at the kind's level, and how the autoplayer spends on them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRun, apply, legalActions, join, souls, monarchOf, tierCost, canAdvance, heldKinds, battleSetup, availableNodes,
  OSSUARY, fielded, levelOf, kindLevel, lowerTrack
} from '../src/sim/run.js'
import { createBattle, stepBattle } from '../src/sim/battle.js'
import { policy, autoplay, offerState } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { tuned, LEVEL_A_TIER } from './tuned.js'
import { ABILITIES, TRACKS, FUSION_LIST, unitDef } from '../src/content.js'
import {
  makeUnit, abilitiesOf, auraOf, statsOf, tiersOf, canTrack, nextTracks, expand, slotAt, tileAt, baseStats, sizeOf, footprintSlots, campOpen,
  isMonarchCell
} from '../src/sim/unit.js'

const soul = (run, id) => run.state.party.find((u) => u.id === id)
const copyOf = (run) => ({ ...run, state: structuredClone(run.state) })

// ── the crosspath rule ───────────────────────────────────────────────────────────────────────────

test('the crosspath rule: either track to II freely; one past II, and the other stops at II; IV the top', () => {
  assert.ok(canTrack([0, 0], 0) && canTrack([0, 0], 1))
  assert.ok(canTrack([2, 2], 0) && canTrack([2, 2], 1), 'both at II: either may go on')
  assert.ok(canTrack([3, 2], 0) && !canTrack([3, 2], 1), 'one past II: the other stops at II')
  assert.ok(canTrack([3, 1], 1) && !canTrack(nextTracks([3, 1], 1), 1))
  assert.ok(!canTrack([4, 0], 0) && canTrack([4, 0], 1) && !canTrack([4, 2], 1))
  assert.ok(!canTrack([2, 3], 0) && canTrack([2, 3], 1))
  assert.deepEqual(nextTracks([1, 2], 0), [2, 2])
  // Walked every way, no kind ever holds both tracks past II, nor a track past IV.
  const seen = new Set()
  const walk = (t) => {
    const key = t.join()
    if (seen.has(key)) return
    seen.add(key)
    assert.ok(t.every((x) => x <= 4) && !(t[0] > 2 && t[1] > 2), key)
    for (const k of [0, 1]) if (canTrack(t, k)) walk(nextTracks(t, k))
  }
  walk([0, 0])
  assert.equal(seen.size, 9 + 2 * 2 * 3, 'II×II, then III–IV on one track beside 0–II on the other')
})

test('a kind\'s tiers: both tracks\' kits and mods together, one aura; IV is a rule', () => {
  // Tomb Knight: Bulwark IV beside Reaver II; then Reaver IV beside Bulwark II.
  const u = { ...makeUnit('tomb_knight', { uid: 1, lvl: 5 }), tracks: [4, 2] }
  assert.equal(tiersOf(u).length, 6)
  assert.equal(auraOf(u).range, 2, "Bulwark's aura")
  const plain = { ...u, tracks: [4, 0] }
  assert.ok(Math.abs(statsOf(u).atk / statsOf(plain).atk - 1.15) < 0.01, "Reaver's +15% ATK")
  assert.deepEqual(abilitiesOf({ ...u, tracks: [2, 4] }), ['reaving_cleave', 'rending_strike'])
  for (const [id, tracks] of Object.entries(TRACKS)) {
    for (const [k, t] of tracks.entries()) {
      const iv = t.tiers[3]
      // A new or remade ability, an aura, a wider ring, or Colossus (DESIGN §2.6); Banner is gone.
      assert.ok(iv.desc && !iv.mods && !iv.banner && (iv.ability || iv.aura || iv.ring || iv.size === 2), `${id} ${t.id} IV: a rule, no mods`)
      if (!iv.ability) continue
      const at = (n) => ({ ...makeUnit(id, { uid: 1 }), tracks: k ? [0, n] : [n, 0] })
      assert.ok(ABILITIES[iv.ability.id] && !abilitiesOf(at(3)).includes(iv.ability.id) && abilitiesOf(at(4)).includes(iv.ability.id), `${id} ${t.id} IV`)
    }
  }
})

test('an `all` ability with a range reaches every foe within it of the caster, and no further', () => {
  const at = (uid, side, x, y) => ({ ...makeUnit('tomb_knight', { uid }), side, tile: tileAt(x, y) })
  const sprite = { ...makeUnit('frost_sprite', { uid: 1 }), side: 'party', tile: tileAt(3, 3) }
  const foes = [at(10, 'foe', 3, 6), at(11, 'foe', 0, 6), at(12, 'foe', 3, 7), at(13, 'foe', 6, 0)]
  const hit = expand([sprite, ...foes], sprite, ABILITIES.deep_winter, foes[0]).map((u) => u.uid)
  assert.deepEqual(hit, [10, 11, 13])
})

// ── upgrades belong to the kind ──────────────────────────────────────────────────────────────────

test('a tier is the kind\'s, and so is the level it gives: every soul of it, fielded or in the ossuary, holds them, for the tier\'s price; no level is bought', () => tuned(LEVEL_A_TIER, () => {
  const run = createRun({ seed: 'kinds' })
  const s = run.state
  const first = levelOf({ tracks: [0, 0] })
  assert.equal(first, TUNING.level.base)
  assert.deepEqual(s.kinds, { tomb_knight: { lvl: first, tracks: [0, 0] }, bone_chanter: { lvl: first, tracks: [0, 0] }, frost_sprite: { lvl: first, tracks: [0, 0] } })
  const a = soul(run, 'tomb_knight')
  const b = join(run, 'tomb_knight')
  assert.equal(b.slot, OSSUARY, 'the field is full: it waits in the ossuary')
  assert.deepEqual([b.lvl, b.tracks], [first, [0, 0]])
  s.essence = 1000
  assert.throws(() => apply(run, { type: 'level', kind: 'tomb_knight' }), /unknown action "level"/)
  assert.ok(!legalActions(run).some((x) => x.type === 'level'))
  // A tier: its price is the kind's next tier's on that track; every soul of it holds it and rises to the level its
  // tiers give, each healing by what it gains (the fallen stay down).
  b.hp = 0
  a.hp = 10
  const was = a.maxHp
  const lvl1 = levelOf({ tracks: [1, 0] })
  assert.ok(lvl1 > first)
  apply(run, { type: 'upgrade', kind: 'tomb_knight', track: 0 })
  assert.deepEqual([s.kinds.tomb_knight.lvl, a.lvl, b.lvl, s.essence], [lvl1, lvl1, lvl1, 1000 - TUNING.essence.tier[0]])
  assert.deepEqual([a.maxHp, b.maxHp], [baseStats('tomb_knight', lvl1).hp, baseStats('tomb_knight', lvl1).hp])
  assert.deepEqual([a.hp, b.hp], [10 + a.maxHp - was, 0])
  assert.equal(soul(run, 'bone_chanter').lvl, first, 'another kind is untouched')
  // More tiers, either track, each at its price; the level counts them all.
  for (const [track, tier] of [[0, 1], [1, 0], [0, 2]]) {
    const price = tierCost(run, 'tomb_knight', track)
    assert.equal(price, TUNING.essence.tier[tier])
    const before = s.essence
    apply(run, { type: 'upgrade', kind: 'tomb_knight', track })
    assert.equal(s.essence, before - price)
  }
  assert.deepEqual([s.kinds.tomb_knight.tracks, a.tracks, b.tracks], [[3, 1], [3, 1], [3, 1]])
  assert.deepEqual([s.kinds.tomb_knight.lvl, a.lvl, b.lvl], Array(3).fill(levelOf({ tracks: [3, 1] })))
  assert.equal(auraOf(b).range, 2, 'the soul in the ossuary holds Bulwark III too')
  // Refused: the crosspath rule, a kind not held, a track that is not one, short of essence, the Monarch.
  apply(run, { type: 'upgrade', kind: 'tomb_knight', track: 1 })
  assert.throws(() => apply(run, { type: 'upgrade', kind: 'tomb_knight', track: 1 }), /cannot upgrade/, 'Reaver stops at II')
  assert.ok(!canAdvance(s, 'tomb_knight', 1) && canAdvance(s, 'tomb_knight', 0))
  for (const a of [{ kind: 'iron_golem', track: 0 }, { kind: 'tomb_knight', track: 2 }, { kind: 'monarch', track: 0 }]) {
    assert.throws(() => apply(run, { type: 'upgrade', ...a }), /cannot upgrade/, JSON.stringify(a))
  }
  s.essence = 0
  assert.throws(() => apply(run, { type: 'upgrade', kind: 'tomb_knight', track: 0 }), /cannot upgrade/)
  assert.deepEqual(heldKinds(s), ['tomb_knight', 'bone_chanter', 'frost_sprite'])
}))

test('the level a kind\'s tiers give: TUNING.level.base and perTier a tier on either track, rounded down; six tiers the cap a level once had; a fused kind never below its least', () => tuned(LEVEL_A_TIER, () => {
  const { base, perTier } = TUNING.level
  for (const tracks of [[0, 0], [1, 0], [0, 1], [2, 2], [4, 2], [2, 4], [3, 1]]) {
    assert.equal(levelOf({ tracks }), Math.floor(base + perTier * (tracks[0] + tracks[1])), JSON.stringify(tracks))
  }
  assert.equal(levelOf({ tracks: [4, 2] }), 10)
  for (let t = 0; t < 4; t++) assert.ok(levelOf({ tracks: [t, 0] }) <= levelOf({ tracks: [t + 1, 0] }), 'never falls with a tier')
  assert.deepEqual([levelOf({ tracks: [0, 0], least: 6 }), levelOf({ tracks: [4, 2], least: 6 })], [6, 10])
  const s = createRun({ seed: 'levels' }).state
  assert.deepEqual([kindLevel(s, 'tomb_knight'), kindLevel(s, 'iron_golem')], [base, base], 'a kind new to the run at its first')
  // The track a free tier goes on (Soul Lantern): the lower, the first on a tie, the other where the lower may not.
  assert.deepEqual([[0, 0], [1, 0], [1, 2], [3, 2], [4, 2], [2, 4]].map(lowerTrack), [0, 1, 0, 0, null, null])
}))

test('a recruit joins its kind at the kind\'s level and tiers (a kind new to the run at its first, with Soul Lantern\'s free tiers); the offer says that level and is priced by it; a kind\'s state outlives its souls', () => {
  const run = createRun({ seed: 'recruits' })
  const s = run.state
  s.essence = 1000
  apply(run, { type: 'upgrade', kind: 'bone_chanter', track: 0 })
  apply(run, { type: 'upgrade', kind: 'bone_chanter', track: 0 })
  const lvl = levelOf({ tracks: [2, 0] })
  const chanter = join(run, 'bone_chanter')
  assert.deepEqual([chanter.lvl, chanter.tracks], [lvl, [2, 0]])
  const golem = join(run, 'iron_golem')
  assert.deepEqual([golem.lvl, golem.tracks, s.kinds.iron_golem], [TUNING.level.base, [0, 0], { lvl: TUNING.level.base, tracks: [0, 0] }])
  apply(run, { type: 'release', uid: golem.uid })
  assert.deepEqual(s.kinds.iron_golem, { lvl: TUNING.level.base, tracks: [0, 0] }, 'kept with no soul of it')
  assert.ok(!heldKinds(s).includes('iron_golem') && !legalActions(run).some((a) => a.kind === 'iron_golem'))
  // The spoils: whatever level the slain fought at, each soul is offered at its kind's level, at that level's price.
  const fought = (relics) => {
    for (let i = 0; i < 100; i++) {
      const r = createRun({ seed: 'recruit-spoils' + i })
      r.state.relics = relics
      r.state.essence = 1000
      apply(r, { type: 'upgrade', kind: 'tomb_knight', track: 1 })
      const node = availableNodes(r)[0]
      node.type = 'fight'
      apply(r, { type: 'node', id: node.id })
      apply(r, { type: 'fight' })
      if (r.state.phase === 'reap' && r.state.offers.some((o) => o.type === 'soul' && !r.state.kinds[o.id])) return r
    }
    assert.fail('no won fight offered a kind new to the run')
  }
  const won = fought([])
  const w = won.state
  for (const o of w.offers.filter((x) => x.type === 'soul')) {
    assert.equal(o.lvl, kindLevel(w, o.id), o.id)
    assert.equal(o.desc, `Rises at level ${o.lvl}.`)
    assert.equal(o.cost, Math.round(TUNING.essence.recruit * unitDef(o.id).tier * (1 + TUNING.essence.perLevel * (o.lvl - 1))), o.id)
  }
  const fresh = w.offers.findIndex((o) => o.type === 'soul' && !w.kinds[o.id])
  const id = w.offers[fresh].id
  apply(won, { type: 'reap', index: fresh })
  assert.deepEqual([w.kinds[id], souls(w.party).find((u) => u.id === id).lvl], [{ lvl: TUNING.level.base, tracks: [0, 0] }, TUNING.level.base])
  // Two Soul Lanterns: a kind new to the run joins with a free tier on each track (each on the lower), at their
  // level, and its offer says so; a kind held already joins as it is.
  const lit = fought(['soul_lantern', 'soul_lantern'])
  const l = lit.state
  const i = l.offers.findIndex((o) => o.type === 'soul' && !l.kinds[o.id])
  const kind = l.offers[i].id
  assert.equal(l.offers[i].lvl, levelOf({ tracks: [1, 1] }))
  for (const o of l.offers.filter((x) => x.type === 'soul' && l.kinds[x.id])) assert.equal(o.lvl, kindLevel(l, o.id))
  apply(lit, { type: 'reap', index: i })
  assert.deepEqual(l.kinds[kind], { lvl: levelOf({ tracks: [1, 1] }), tracks: [1, 1] })
  assert.deepEqual(souls(l.party).filter((u) => u.id === kind).map((u) => [u.lvl, u.tracks]), [[levelOf({ tracks: [1, 1] }), [1, 1]]])
})

test('legalActions lists exactly the tiers apply accepts, and no level', () => {
  const run = createRun({ seed: 'kinds-legal' })
  const s = run.state
  join(run, 'grave_ghoul')
  for (const [tracks, essence] of [[[0, 0], 0], [[0, 0], 15], [[2, 2], 100], [[3, 2], 2000], [[4, 2], 2000], [[2, 4], 30]]) {
    const lvl = levelOf({ tracks })
    for (const k of Object.values(s.kinds)) Object.assign(k, { lvl, tracks: tracks.slice() })
    for (const u of souls(s.party)) Object.assign(u, { lvl, tracks: tracks.slice() })
    s.essence = essence
    assert.ok(!legalActions(run).some((a) => a.type === 'level'))
    const listed = legalActions(run).filter((a) => a.type === 'upgrade').map((a) => JSON.stringify(a))
    const tries = heldKinds(s).flatMap((kind) => [{ type: 'upgrade', kind, track: 0 }, { type: 'upgrade', kind, track: 1 }])
    const accepted = tries.filter((a) => {
      try {
        apply(copyOf(run), a)
        return true
      } catch {
        return false
      }
    }).map((a) => JSON.stringify(a))
    assert.deepEqual(listed, accepted, JSON.stringify([tracks, essence]))
  }
})

test('a reliquary offers a kind its next tiers, each for a different kind where it can, after its relics', () => {
  const rite = createRun({ seed: 'rite-kinds' })
  const r = rite.state
  // Every kind past II on track 0 but the Knight, which stands at III with Reaver at II: Bulwark IV is its only tier.
  for (const k of Object.keys(r.kinds)) r.kinds[k].tracks = [4, 2]
  r.kinds.tomb_knight.tracks = [3, 2]
  for (const u of souls(r.party)) u.tracks = r.kinds[u.id].tracks.slice()
  const node = availableNodes(rite)[0]
  node.type = 'reliquary'
  apply(rite, { type: 'node', id: node.id })
  // Its relics (TUNING.relic.offer.reliquary; no Legendary on floor 1), then its tiers.
  assert.deepEqual(r.offers.filter((o) => o.type === 'tier').map((o) => [o.type, o.kind, o.track, o.name]), [['tier', 'tomb_knight', 0, 'Tomb Knight: Bulwark IV']])
  assert.deepEqual(r.offers.map((o) => o.type), [...Array(TUNING.relic.offer.reliquary).fill('relic'), 'tier'])
  const index = r.offers.findIndex((o) => o.type === 'tier')
  assert.equal(r.offers[index].desc, TRACKS.tomb_knight[0].tiers[3].desc)
  apply(rite, { type: 'reap', index })
  assert.deepEqual([r.kinds.tomb_knight.tracks, soul(rite, 'tomb_knight').tracks], [[4, 2], [4, 2]])
})

test('the battle fights with a kind\'s tiers: battleSetup carries them into the kit', () => {
  const run = createRun({ seed: 'kit' })
  const knight = soul(run, 'tomb_knight')
  run.state.kinds.tomb_knight.tracks = [2, 4]
  knight.tracks = [2, 4]
  const node = availableNodes(run)[0]
  node.type = 'fight'
  node.foes ??= run.state.map.nodes.find((n) => n.foes).foes
  apply(run, { type: 'node', id: node.id })
  const b = createBattle(battleSetup(run))
  const u = b.units.find((x) => x.uid === knight.uid)
  assert.deepEqual(u.kit.map((a) => a.id), ['reaving_cleave', 'rending_strike'])
  assert.deepEqual(u.tracks, [2, 4])
  assert.ok(!('grade' in b.events[0].units.find((x) => x.uid === knight.uid)))
})

// ── the autoplayer ───────────────────────────────────────────────────────────────────────────────

test('the autoplayer spends on kinds: basic buys its lowest kind\'s next tier, on the track it is on; the expert by worth; neither buys a level', () => {
  const run = createRun({ seed: 'spender' })
  const s = run.state
  s.essence = TUNING.essence.tier[0]
  const rng = createRng('spender').stream('autoplay')
  const a = policy(copyOf(run), rng, 'basic')
  assert.deepEqual([a.type, a.track], ['upgrade', 0])
  assert.ok(Object.keys(s.kinds).includes(a.kind))
  // That kind ahead by two tiers: the lowest is another, on its own track; short of its price, basic waits.
  apply(run, { type: 'upgrade', kind: a.kind, track: 0 })
  s.essence = 1000
  apply(run, { type: 'upgrade', kind: a.kind, track: 0 })
  s.essence = TUNING.essence.tier[0]
  const b = policy(copyOf(run), rng, 'basic')
  assert.equal(b.type, 'upgrade')
  assert.notEqual(b.kind, a.kind)
  assert.ok(kindLevel(s, b.kind) < kindLevel(s, a.kind))
  s.essence = TUNING.essence.tier[0] - 1
  assert.notEqual(policy(copyOf(run), rng, 'basic').type, 'upgrade')
  // On the track it is on: a kind on track 1 stays on it.
  s.essence = 1000
  for (const kind of Object.keys(s.kinds).filter((k) => k !== a.kind)) apply(run, { type: 'upgrade', kind, track: 1 })
  const c = policy(copyOf(run), rng, 'basic')
  assert.deepEqual([c.type, c.track], ['upgrade', 1])
  s.essence = 500
  const e = policy(copyOf(run), rng, 'expert')
  assert.ok(['upgrade', 'fuse'].includes(e.type), JSON.stringify(e))
  // Whole runs buy only what the run takes.
  for (const level of ['basic']) {
    const r = autoplay(createRun({ seed: 'spender-run' }), { level })
    assert.ok(!r.state.log.some((x) => ['promote', 'level', 'monarch'].includes(x.type)))
    assert.ok(r.state.log.filter((x) => x.type === 'upgrade').every((x) => typeof x.kind === 'string'))
  }
})

test('the expert rehearses a reliquary\'s tier offer as the run would make it: the kind\'s every soul with the tier and the level it gives', () => {
  const lvl = levelOf({ tracks: [3, 0] })
  const u = { ...makeUnit('tomb_knight', { uid: 1, lvl }), tracks: [3, 0] }
  const v = { ...makeUnit('tomb_knight', { uid: 2, lvl }), tracks: [3, 0] }
  const s = { party: [u, v, makeUnit('frost_sprite', { uid: 3 })], kinds: { tomb_knight: { lvl, tracks: [3, 0] }, frost_sprite: { lvl: 1, tracks: [0, 0] } }, relics: [] }
  const after = offerState(s, { type: 'tier', kind: 'tomb_knight', track: 1 })
  const next = levelOf({ tracks: [3, 1] })
  assert.ok(next > lvl)
  assert.deepEqual(after.kinds.tomb_knight, { lvl: next, tracks: [3, 1] })
  assert.deepEqual(after.party.map((x) => [x.lvl, x.tracks]), [[next, [3, 1]], [next, [3, 1]], [1, [0, 0]]])
  assert.equal(auraOf(after.party[0]).range, 2, 'Bulwark\'s aura stays')
  assert.deepEqual(offerState(s, { type: 'relic', id: 'whetstone' }), { relics: ['whetstone'] })
  assert.deepEqual(s.kinds.tomb_knight.tracks, [3, 0], 'the state as it was')
})

// A tier IV whose condition reads the whole board would bank for a cast its area cannot use: each reads
// only what it reaches, so the soul goes on attacking.
test('a tier IV area ability waits for something in its area: the soul still attacks', () => {
  // A Dirgemaster IV whose far allies lack Hasten: it still bolts, and Hastens those near it.
  const b = createBattle({
    party: [{ ...makeUnit('monarch', { uid: 0, lvl: 3 }), slot: slotAt(6, 3) }, { ...makeUnit('bone_chanter', { uid: 1, lvl: 6 }), tracks: [4, 0], slot: slotAt(3, 3) },
      ...[[0, 3], [0, 0], [0, 6]].map(([r, c], i) => ({ ...makeUnit(i ? 'tomb_knight' : 'grave_ghoul', { uid: 2 + i, lvl: 5 }), slot: slotAt(r, c) }))],
    foes: [0, 2, 4, 6].map((c, i) => ({ ...makeUnit('iron_golem', { uid: 10 + i, lvl: 4 }), slot: slotAt(1, c) })), seed: 'tier4', domain: 9
  })
  const acts = {}
  while (!b.over && b.t < 1500) for (const e of stepBattle(b)) if (e.type === 'action' && e.actor === 1) acts[e.ability] = (acts[e.ability] ?? 0) + 1
  assert.ok(acts.marrow_bolt > 0 && acts.dirge_unending > 0, JSON.stringify(acts))
  // Molt only when a debuff lies within its 2 tiles: each cast strips at least one.
  const m = createBattle({
    party: [{ ...makeUnit('monarch', { uid: 0, lvl: 3 }), slot: slotAt(6, 3) },
      { ...makeUnit('hive_warden', { uid: 1, lvl: 5 }), tracks: [0, 4], slot: slotAt(5, 0) },
      ...[[0, 3], [0, 6], [0, 5]].map(([r, c], i) => ({ ...makeUnit(i === 2 ? 'grave_ghoul' : 'tomb_knight', { uid: 2 + i, lvl: 5 }), slot: slotAt(r, c) }))],
    foes: [2, 3, 4, 5].map((c, i) => ({ ...makeUnit('barrow_wight', { uid: 10 + i, lvl: 4 }), slot: slotAt(1, c) })), seed: 'molt', domain: 6
  })
  let molts = 0
  let stripped = 0
  let last = null
  while (!m.over && m.t < 3000) {
    for (const e of stepBattle(m)) {
      if (e.type === 'action') last = e.actor === 1 ? e.ability : null
      if (e.type === 'action' && last === 'molt') molts++
      if (e.type === 'cleanse' && last === 'molt') stripped++
    }
  }
  assert.ok(stripped >= molts, `${molts} Molts stripped ${stripped} debuffs`)
})

// ── fuzz: levels and tiers bought at random, then a fight ────────────────────────────────────────

// The kinds whose tier IV is a Colossus tier (`size: 2`).
const COLOSSI = Object.keys(TRACKS).filter((id) => TRACKS[id].some((t) => t.tiers[3].size === 2))

// Every run starts rich in essence, so random tiers reach tier IV, Colossus tiers and added bodies, and
// then fight; random places, stacks, splits and fusions move the bodies between pieces as they go. A soul of a kind
// with a Colossus tier and the souls a recipe needs are among them.
test('kinds fuzz: random tiers, stacks, splits and fusions keep the crosspath rule and the footprints, every piece of a kind holds its kind\'s, and the battle fights them', () => tuned({}, () => {
  const seen = { iv: 0, colossus: 0, added: 0, stacked: 0, fused: 0 }
  for (let i = 0; i < 24; i++) {
    const run = createRun({ seed: 'kindfuzz' + i })
    const s = run.state
    const rng = createRng('kindfuzz' + i).stream('fuzz')
    s.essence = 6000
    s.relics = ['grave_banner', 'grave_banner', 'grave_banner']
    join(run, 'grave_ghoul')
    join(run, 'clockwork_page')
    join(run, 'grave_ghoul')
    join(run, 'clockwork_page')
    if (COLOSSI.length) join(run, COLOSSI[i % COLOSSI.length])
    for (const [kind, n] of Object.entries(FUSION_LIST[i % FUSION_LIST.length].needs)) for (let j = 0; j < n; j++) join(run, kind)
    const node = availableNodes(run)[0]
    node.type = 'fight'
    node.foes ??= s.map.nodes.find((n) => n.foes).foes
    apply(run, { type: 'node', id: node.id })
    for (let k = 0; k < 120; k++) {
      // A kind of action first, then one of that kind: places would drown out the rest.
      const legal = legalActions(run).filter((a) => ['upgrade', 'place', 'stack', 'split', 'fuse'].includes(a.type))
      if (!legal.length) break
      const type = rng.pick([...new Set(legal.map((a) => a.type))])
      apply(run, rng.pick(legal.filter((a) => a.type === type)))
      for (const [kind, st] of Object.entries(s.kinds)) {
        assert.ok(st.tracks.every((t) => t >= 0 && t <= 4) && !(st.tracks[0] > 2 && st.tracks[1] > 2), `kindfuzz${i}: ${kind} ${st.tracks}`)
        assert.equal(st.lvl, levelOf(st), `kindfuzz${i}: ${kind}'s level is its tiers'`)
        for (const u of souls(s.party).filter((x) => x.id === kind)) assert.deepEqual([u.lvl, u.tracks, u.maxHp], [st.lvl, st.tracks, u.count * baseStats(kind, st.lvl).hp], `kindfuzz${i}: ${u.uid}`)
      }
      // Every fielded piece wholly on open ground, none on another's cells, only the Monarch on the seat.
      const cells = s.party.filter((u) => u.slot >= 0).flatMap((u) => (u.id === 'monarch' ? [u.slot] : footprintSlots(u.slot, sizeOf(u)) ?? [null]))
      assert.ok(new Set(cells).size === cells.length && cells.every((c) => campOpen(s.camp, c)), `kindfuzz${i}: footprints ${cells}`)
      assert.deepEqual(cells.filter((c) => isMonarchCell(s.camp, c)), [monarchOf(s).slot])
    }
    seen.fused += s.log.some((a) => a.type === 'fuse')
    for (const st of Object.values(s.kinds)) seen.iv += st.tracks.includes(4)
    seen.stacked += souls(s.party).some((u) => u.count > 1)
    const before = s.party.map((u) => [u.uid, u.count])
    seen.colossus += fielded(souls(s.party)).some((u) => sizeOf(u) === 2)
    apply(run, { type: 'fight' })
    const b = run.battle
    seen.added += fielded(souls(s.party)).filter((u) => b.byUid.get(u.uid)?.count > u.count).length
    assert.deepEqual(s.party.map((u) => [u.uid, u.count]), before, 'the run keeps its pieces and their counts')
    assert.ok(!s.party.some((u) => u.shadow))
  }
  assert.ok(seen.iv && seen.colossus && seen.added && seen.stacked && seen.fused, JSON.stringify(seen))
}))
