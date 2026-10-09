// Upgrades per kind (DESIGN §2.8): a kind's level and its two tracks of tiers, held by every soul of it, the
// crosspath rule, the costs, the Monarch's four stats, and how the autoplayer spends on them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRun, apply, legalActions, join, souls, monarchCost, monarchOf, levelCost, tierCost, canAdvance, heldKinds, battleSetup, availableNodes,
  OSSUARY, MONARCH_STATS, monarchPoints, fieldCap, domainOf, fielded
} from '../src/sim/run.js'
import { createBattle, stepBattle } from '../src/sim/battle.js'
import { policy, autoplay, offerState } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { tuned } from './tuned.js'
import { ABILITIES, TRACKS } from '../src/content.js'
import { makeUnit, abilitiesOf, auraOf, statsOf, tiersOf, canTrack, nextTracks, expand, slotAt, tileAt, baseStats } from '../src/sim/unit.js'

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
  // Tomb Knight: Bulwark IV (Banner) beside Reaver II; then Reaver IV beside Bulwark II.
  const u = { ...makeUnit('tomb_knight', { uid: 1, lvl: 5 }), tracks: [4, 2] }
  assert.equal(tiersOf(u).length, 6)
  assert.equal(auraOf(u).range, 2, "Bulwark's aura")
  const plain = { ...u, tracks: [4, 0] }
  assert.ok(Math.abs(statsOf(u).atk / statsOf(plain).atk - 1.15) < 0.01, "Reaver's +15% ATK")
  assert.deepEqual(abilitiesOf({ ...u, tracks: [2, 4] }), ['reaving_cleave', 'rending_strike'])
  for (const [id, tracks] of Object.entries(TRACKS)) {
    for (const [k, t] of tracks.entries()) {
      const iv = t.tiers[3]
      assert.ok(iv.desc && !iv.mods && (iv.ability || iv.banner), `${id} ${t.id} IV: a rule, no mods`)
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

test('a level and a tier are the kind\'s: every soul of it, fielded or in the ossuary, holds them, for their price', () => {
  const run = createRun({ seed: 'kinds' })
  const s = run.state
  assert.deepEqual(s.kinds, { tomb_knight: { lvl: 2, tracks: [0, 0] }, bone_chanter: { lvl: 2, tracks: [0, 0] }, frost_sprite: { lvl: 2, tracks: [0, 0] } })
  const a = soul(run, 'tomb_knight')
  const b = join(run, 'tomb_knight')
  assert.equal(b.slot, OSSUARY, 'the field is full: it waits in the ossuary')
  assert.deepEqual([b.lvl, b.tracks], [2, [0, 0]])
  s.essence = 1000
  // A level: its price is the kind's, every soul of it rises, and each heals by what it gains (the fallen stay down).
  b.hp = 0
  const cost = levelCost(run, 'tomb_knight')
  assert.equal(cost, Math.round(TUNING.level.cost * Math.pow(2, TUNING.level.exponent)))
  const was = a.maxHp
  a.hp = 10
  apply(run, { type: 'level', kind: 'tomb_knight' })
  assert.deepEqual([s.kinds.tomb_knight.lvl, a.lvl, b.lvl, s.essence], [3, 3, 3, 1000 - cost])
  assert.deepEqual([a.maxHp, b.maxHp], [baseStats('tomb_knight', 3).hp, baseStats('tomb_knight', 3).hp])
  assert.deepEqual([a.hp, b.hp], [10 + a.maxHp - was, 0])
  assert.equal(soul(run, 'bone_chanter').lvl, 2, 'another kind is untouched')
  // A tier: track 0, then 1, at the kind's next tier's price on that track.
  for (const [track, tier] of [[0, 0], [0, 1], [1, 0], [0, 2]]) {
    const price = tierCost(run, 'tomb_knight', track)
    assert.equal(price, TUNING.essence.tier[tier])
    const before = s.essence
    apply(run, { type: 'upgrade', kind: 'tomb_knight', track })
    assert.equal(s.essence, before - price)
  }
  assert.deepEqual([s.kinds.tomb_knight.tracks, a.tracks, b.tracks], [[3, 1], [3, 1], [3, 1]])
  assert.equal(auraOf(b).range, 2, 'the soul in the ossuary holds Bulwark III too')
  // Refused: the crosspath rule, a kind not held, a track that is not one, short of essence, the Monarch.
  apply(run, { type: 'upgrade', kind: 'tomb_knight', track: 1 })
  assert.throws(() => apply(run, { type: 'upgrade', kind: 'tomb_knight', track: 1 }), /cannot upgrade/, 'Reaver stops at II')
  assert.ok(!canAdvance(s, 'tomb_knight', 1) && canAdvance(s, 'tomb_knight', 0))
  for (const a of [{ kind: 'iron_golem', track: 0 }, { kind: 'tomb_knight', track: 2 }, { kind: 'monarch', track: 0 }]) {
    assert.throws(() => apply(run, { type: 'upgrade', ...a }), /cannot upgrade/, JSON.stringify(a))
  }
  assert.throws(() => apply(run, { type: 'level', kind: 'monarch' }), /cannot level/)
  s.essence = 0
  assert.throws(() => apply(run, { type: 'level', kind: 'tomb_knight' }), /cannot level/)
  assert.deepEqual(heldKinds(s), ['tomb_knight', 'bone_chanter', 'frost_sprite'])
})

test('a recruit joins its kind: at the kind\'s level and tiers, or raising the kind to its own level; a kind\'s state outlives its souls', () => {
  const run = createRun({ seed: 'recruits' })
  const s = run.state
  s.kinds.bone_chanter.tracks = [1, 0]
  soul(run, 'bone_chanter').tracks = [1, 0]
  const low = join(run, 'bone_chanter', { lvl: 1 })
  assert.deepEqual([low.lvl, low.tracks], [2, [1, 0]], 'below the kind: the kind\'s')
  const high = join(run, 'bone_chanter', { lvl: 5 })
  assert.deepEqual([high.lvl, soul(run, 'bone_chanter').lvl, low.lvl, s.kinds.bone_chanter.lvl], [5, 5, 5, 5], 'above it: the kind rises')
  const golem = join(run, 'iron_golem', { lvl: 4 })
  assert.deepEqual([golem.lvl, golem.tracks, s.kinds.iron_golem], [4, [0, 0], { lvl: 4, tracks: [0, 0] }])
  apply(run, { type: 'release', uid: golem.uid })
  assert.deepEqual(s.kinds.iron_golem, { lvl: 4, tracks: [0, 0] }, 'kept with no soul of it')
  assert.ok(!heldKinds(s).includes('iron_golem') && !legalActions(run).some((a) => a.kind === 'iron_golem'))
})

test('legalActions lists exactly the levels and tiers apply accepts', () => {
  const run = createRun({ seed: 'kinds-legal' })
  const s = run.state
  join(run, 'grave_ghoul')
  for (const [lvl, tracks, essence] of [[2, [0, 0], 0], [2, [0, 0], 15], [4, [2, 2], 100], [9, [3, 2], 2000], [10, [4, 2], 2000], [10, [2, 4], 30]]) {
    for (const k of Object.values(s.kinds)) Object.assign(k, { lvl, tracks: tracks.slice() })
    for (const u of souls(s.party)) Object.assign(u, { lvl, tracks: tracks.slice() })
    s.essence = essence
    const listed = legalActions(run).filter((a) => a.type === 'level' || a.type === 'upgrade').map((a) => JSON.stringify(a))
    const tries = heldKinds(s).flatMap((kind) => [{ type: 'level', kind }, { type: 'upgrade', kind, track: 0 }, { type: 'upgrade', kind, track: 1 }])
    const accepted = tries.filter((a) => {
      try {
        apply(copyOf(run), a)
        return true
      } catch {
        return false
      }
    }).map((a) => JSON.stringify(a))
    assert.deepEqual(listed, accepted, JSON.stringify([lvl, tracks, essence]))
  }
})

test('a rite offers a kind its next tiers, each for a different kind where it can', () => {
  const rite = createRun({ seed: 'rite-kinds' })
  const r = rite.state
  // Every kind past II on track 0 but the Knight, which stands at III with Reaver at II: Bulwark IV is its only tier.
  for (const k of Object.keys(r.kinds)) r.kinds[k].tracks = [4, 2]
  r.kinds.tomb_knight.tracks = [3, 2]
  for (const u of souls(r.party)) u.tracks = r.kinds[u.id].tracks.slice()
  const node = availableNodes(rite)[0]
  node.type = 'rite'
  apply(rite, { type: 'node', id: node.id })
  assert.deepEqual(r.offers.map((o) => [o.type, o.kind, o.track, o.name]), [['tier', 'tomb_knight', 0, 'Tomb Knight: Bulwark IV']])
  assert.equal(r.offers[0].desc, TRACKS.tomb_knight[0].tiers[3].desc)
  apply(rite, { type: 'reap', index: 0 })
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

// ── the Monarch's four stats ─────────────────────────────────────────────────────────────────────

test('the Monarch\'s four stats: HP raises its max HP (and heals by the gain), Dominion its domain, Command the field, Will Arise; one price for all', () => {
  const run = createRun({ seed: 'monarch4' })
  const s = run.state
  const m = monarchOf(s)
  assert.deepEqual(MONARCH_STATS, ['hp', 'dominion', 'command', 'will'])
  assert.deepEqual(s.monarch, { hp: 0, dominion: 0, command: 0, will: 0 })
  s.essence = 1000
  m.hp = 50
  for (const [k, stat] of ['dominion', 'command', 'will', 'hp', 'hp'].entries()) {
    const cost = monarchCost(run)
    assert.equal(cost, TUNING.monarch.cost + TUNING.monarch.costPerPoint * k)
    const hp = m.hp
    const maxHp = m.maxHp
    apply(run, { type: 'monarch', stat })
    assert.equal(monarchPoints(s), k + 1)
    if (stat === 'hp') {
      assert.deepEqual([m.lvl, m.maxHp, m.hp], [s.monarch.hp, baseStats('monarch', s.monarch.hp).hp, hp + m.maxHp - maxHp])
      assert.equal(m.maxHp - maxHp, TUNING.monarch.hpPerPoint)
    } else {
      assert.deepEqual([m.lvl, m.maxHp, m.hp], [0, maxHp, hp], `${stat} leaves its HP as it was`)
    }
  }
  assert.deepEqual(s.monarch, { hp: 2, dominion: 1, command: 1, will: 1 })
  assert.deepEqual([domainOf(s), fieldCap(run)], [TUNING.monarch.domain + 1, TUNING.party.field + 1])
  assert.throws(() => apply(run, { type: 'monarch', stat: 'might' }), /cannot raise/)
})

// ── the autoplayer ───────────────────────────────────────────────────────────────────────────────

test('the autoplayer spends on kinds: basic levels its lowest kind and buys a tier once the kind has the level for it; the expert by worth; neither promotes', () => {
  const run = createRun({ seed: 'spender' })
  const s = run.state
  s.essence = 40
  const rng = createRng('spender').stream('autoplay')
  const a = policy(copyOf(run), rng, 'basic')
  assert.equal(a.type, 'level')
  assert.ok(Object.keys(s.kinds).includes(a.kind))
  // Level 3 per tier: at 3 its track 0's first tier is due.
  for (const k of Object.keys(s.kinds)) s.kinds[k].lvl = 3
  for (const u of souls(s.party)) u.lvl = 3
  s.essence = TUNING.essence.tier[0]
  const t = policy(copyOf(run), rng, 'basic')
  assert.deepEqual([t.type, t.track], ['upgrade', 0])
  s.essence = 500
  const e = policy(copyOf(run), rng, 'expert')
  assert.ok(['level', 'upgrade', 'monarch'].includes(e.type), JSON.stringify(e))
  // Whole runs buy only what the run takes.
  for (const level of ['basic']) {
    const r = autoplay(createRun({ seed: 'spender-run' }), { level })
    assert.ok(!r.state.log.some((x) => x.type === 'promote'))
    assert.ok(r.state.log.filter((x) => x.type === 'level' || x.type === 'upgrade').every((x) => typeof x.kind === 'string'))
  }
})

test('the expert rehearses a rite\'s tier offer as the run would make it: the kind\'s every soul with the tier', () => {
  const u = { ...makeUnit('tomb_knight', { uid: 1, lvl: 5 }), tracks: [3, 0] }
  const v = { ...makeUnit('tomb_knight', { uid: 2, lvl: 5 }), tracks: [3, 0] }
  const s = { party: [u, v, makeUnit('frost_sprite', { uid: 3 })], kinds: { tomb_knight: { lvl: 5, tracks: [3, 0] }, frost_sprite: { lvl: 1, tracks: [0, 0] } }, relics: [] }
  const after = offerState(s, { type: 'tier', kind: 'tomb_knight', track: 1 })
  assert.deepEqual(after.kinds.tomb_knight, { lvl: 5, tracks: [3, 1] })
  assert.deepEqual(after.party.map((x) => x.tracks), [[3, 1], [3, 1], [0, 0]])
  assert.equal(auraOf(after.party[0]).range, 2, 'Bulwark\'s aura stays')
  assert.deepEqual(offerState(s, { type: 'relic', id: 'x' }), { relics: ['x'] })
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

// Every run starts rich in essence, so random levels and tiers reach tier IV, Banners and added bodies, and then
// fight; random stacks and splits move the bodies between pieces as they go.
test('kinds fuzz: random levels, tiers, stacks and splits keep the crosspath rule, every piece of a kind holds its kind\'s, and the battle fights them', () => tuned({}, () => {
  const seen = { iv: 0, banner: 0, added: 0, stacked: 0 }
  for (let i = 0; i < 24; i++) {
    const run = createRun({ seed: 'kindfuzz' + i })
    const s = run.state
    const rng = createRng('kindfuzz' + i).stream('fuzz')
    s.essence = 6000
    for (let k = 0; k < 3; k++) apply(run, { type: 'monarch', stat: 'command' })
    s.monarch.will = 2
    join(run, 'grave_ghoul')
    join(run, 'clockwork_page')
    join(run, 'grave_ghoul')
    join(run, 'clockwork_page')
    const node = availableNodes(run)[0]
    node.type = 'fight'
    node.foes ??= s.map.nodes.find((n) => n.foes).foes
    apply(run, { type: 'node', id: node.id })
    for (let k = 0; k < 120; k++) {
      // A kind of action first, then one of that kind: places would drown out the rest.
      const legal = legalActions(run).filter((a) => ['upgrade', 'level', 'place', 'line', 'stack', 'split'].includes(a.type))
      if (!legal.length) break
      const type = rng.pick([...new Set(legal.map((a) => a.type))])
      apply(run, rng.pick(legal.filter((a) => a.type === type)))
      for (const [kind, st] of Object.entries(s.kinds)) {
        assert.ok(st.tracks.every((t) => t >= 0 && t <= 4) && !(st.tracks[0] > 2 && st.tracks[1] > 2), `kindfuzz${i}: ${kind} ${st.tracks}`)
        for (const u of souls(s.party).filter((x) => x.id === kind)) assert.deepEqual([u.lvl, u.tracks, u.maxHp], [st.lvl, st.tracks, u.count * baseStats(kind, st.lvl).hp], `kindfuzz${i}: ${u.uid}`)
      }
    }
    for (const st of Object.values(s.kinds)) seen.iv += st.tracks.includes(4)
    seen.stacked += souls(s.party).some((u) => u.count > 1)
    const before = s.party.map((u) => [u.uid, u.count])
    apply(run, { type: 'fight' })
    const b = run.battle
    seen.banner += b.units.filter((u) => u.banner).length
    seen.added += fielded(souls(s.party)).filter((u) => b.byUid.get(u.uid)?.count > u.count).length
    assert.deepEqual(s.party.map((u) => [u.uid, u.count]), before, 'the run keeps its pieces and their counts')
    assert.ok(!s.party.some((u) => u.shadow))
  }
  assert.ok(seen.iv && seen.banner && seen.added && seen.stacked, JSON.stringify(seen))
}))
