// Slice 6, ranks: promotion by level and essence, a Knight's tier IV or second path, a Marshal's second path and
// its summons; and how the autoplayer uses them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRun, apply, legalActions, join, souls, monarchCost, tierCost, promoteLevel, promoteCost, canPromote, canAdvance,
  nextTier, battleSetup, availableNodes, inOssuary, OSSUARY
} from '../src/sim/run.js'
import { createBattle, stepBattle } from '../src/sim/battle.js'
import { policy, autoplay, offerState } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { tuned, FIRST_ARISE } from './tuned.js'
// The tier prices these scenes were built on (30/60/100/150), with Arise as first built: the rules under test
// read TUNING.
const FIRST_RANKS = { ...FIRST_ARISE, essence: { tier: [30, 60, 100, 150] } }
import { UNITS, ABILITIES, PATHS, GRADES } from '../src/content.js'
import { makeUnit, abilitiesOf, auraOf, statsOf, pathsOf, pathsClash, tiersOf, expand, slotAt, tileAt, distance } from '../src/sim/unit.js'

// A soul brought to the level its next rank takes, and promoted (the run pays the essence).
function rankUp (run, u) {
  u.lvl = Math.max(u.lvl, promoteLevel(u))
  apply(run, { type: 'promote', uid: u.uid })
}
const soul = (run, id) => run.state.party.find((u) => u.id === id)
const copyOf = (run) => ({ ...run, state: structuredClone(run.state) })
function command (run, n) {
  for (let k = 0; k < n; k++) {
    run.state.essence += monarchCost(run)
    apply(run, { type: 'monarch', stat: 'command' })
  }
}

// ── content ──────────────────────────────────────────────────────────────────────────────────────

test('every path has a tier IV that is a rule, not a percentage, and every path has another to pair with', () => tuned(FIRST_RANKS, () => {
  assert.deepEqual(GRADES.map((g) => g.id), ['soldier', 'knight', 'marshal'])
  assert.ok(GRADES.every((g) => g.name && g.desc))
  assert.equal(TUNING.essence.tier[3], 150)
  for (const [id, paths] of Object.entries(PATHS)) {
    for (const p of paths) {
      const iv = p.tiers[3]
      const where = `${id} ${p.id} IV`
      assert.ok(iv.desc && !iv.mods && (iv.ability || iv.aura), `${where}: a rule (an ability or an aura), no mods`)
      const at3 = { ...makeUnit(id, { uid: 1 }), path: p.id, tier: 3 }
      const at4 = { ...at3, tier: 4 }
      if (iv.ability) {
        assert.ok(ABILITIES[iv.ability.id], `${where}: ${iv.ability.id}`)
        assert.ok(!abilitiesOf(at3).includes(iv.ability.id) && abilitiesOf(at4).includes(iv.ability.id), `${where}: a new ability`)
        if (iv.ability.replace) assert.ok(!abilitiesOf(at4).includes(iv.ability.replace), `${where}: remakes ${iv.ability.replace}`)
      }
      // A soul on any path can still take a second one.
      assert.ok(paths.some((q) => q.id !== p.id && !pathsClash(id, p.id, q.id)), `${id} ${p.id}: no second path pairs with it`)
    }
  }
  // Both of the Ghoul's first paths remake Gnaw: they never pair, and the Pack Leader pairs with either.
  assert.ok(pathsClash('grave_ghoul', 'glutton', 'plague_bearer') && pathsClash('grave_ghoul', 'plague_bearer', 'glutton'))
  assert.ok(!pathsClash('grave_ghoul', 'glutton', 'pack_leader') && !pathsClash('grave_ghoul', 'pack_leader', 'plague_bearer'))
  // Two auras never pair either: a soul has one.
  const temp = { id: 'temp', name: 'Temp', desc: 'x', tiers: [{ desc: 'x', aura: { range: 1, desc: 'x', mods: [] } }, { desc: 'x', mods: [] }, { desc: 'x', mods: [] }, { desc: 'x', mods: [] }] }
  PATHS.tomb_knight.push(temp)
  try {
    assert.ok(pathsClash('tomb_knight', 'bulwark', 'temp') && !pathsClash('tomb_knight', 'reaver', 'temp'))
  } finally {
    PATHS.tomb_knight.pop()
  }
}))

test('a second path stacks on the first: both kits, both mods, one aura', () => {
  // A Marshal Tomb Knight: Bulwark I–IV, then Reaver I–III on top.
  const u = { ...makeUnit('tomb_knight', { uid: 1, lvl: 5 }), grade: 2, path: 'bulwark', tier: 4, path2: 'reaver', tier2: 3 }
  assert.deepEqual(abilitiesOf(u), ['shield_wall', 'cleave', 'rending_strike'])
  assert.equal(auraOf(u).range, 2, "Bulwark's aura")
  assert.equal(tiersOf(u).length, 7)
  const plain = { ...u, path2: null, tier2: 0 }
  assert.ok(Math.abs(statsOf(u).atk / statsOf(plain).atk - 1.15) < 0.01, "Reaver's +15% ATK")
  assert.ok(statsOf(u).def === statsOf(plain).def && statsOf(u).hp === statsOf(plain).hp)
})

test('an `all` ability with a range reaches every foe within it of the caster, and no further', () => {
  const at = (uid, side, x, y) => ({ ...makeUnit('tomb_knight', { uid }), side, tile: tileAt(x, y) })
  const sprite = { ...makeUnit('frost_sprite', { uid: 1 }), side: 'party', tile: tileAt(3, 3) }
  const foes = [at(10, 'foe', 3, 6), at(11, 'foe', 0, 6), at(12, 'foe', 3, 7), at(13, 'foe', 6, 0)]
  const hit = expand([sprite, ...foes], sprite, ABILITIES.deep_winter, foes[0]).map((u) => u.uid)
  assert.deepEqual(hit, [10, 11, 13])
})

// ── promotion ────────────────────────────────────────────────────────────────────────────────────

test('promotion takes the level and the essence: a Knight at level[0] for cost[0], a Marshal at level[1] for cost[1]', () => {
  const run = createRun({ seed: 'ranks' })
  const s = run.state
  const knight = soul(run, 'tomb_knight')
  const chanter = soul(run, 'bone_chanter')
  const [L0, L1] = TUNING.ranks.level
  const [C0, C1] = TUNING.ranks.cost
  assert.deepEqual([promoteLevel(knight), promoteCost(run, knight)], [L0, C0])
  s.essence = 1000
  // Below the level: never, essence or not.
  knight.lvl = L0 - 1
  assert.ok(!canPromote(run, knight))
  assert.throws(() => apply(run, { type: 'promote', uid: knight.uid }), /cannot promote/)
  // At the level with too little essence: never.
  knight.lvl = L0
  s.essence = C0 - 1
  assert.ok(!canPromote(run, knight) && !legalActions(run).some((a) => a.type === 'promote'))
  // At the level with the essence: a Knight, for exactly its price.
  s.essence = C0 + 5
  assert.deepEqual(legalActions(run).filter((a) => a.type === 'promote'), [{ type: 'promote', uid: knight.uid }], 'the others are below the level')
  apply(run, { type: 'promote', uid: knight.uid })
  assert.deepEqual([knight.grade, s.essence, s.stats.spent], [1, 5, C0])
  // A Marshal takes the next level and price.
  assert.deepEqual([promoteLevel(knight), promoteCost(run, knight)], [L1, C1])
  s.essence = 1000
  assert.throws(() => apply(run, { type: 'promote', uid: knight.uid }), /cannot promote/, `a Marshal takes level ${L1}`)
  knight.lvl = L1
  apply(run, { type: 'promote', uid: knight.uid })
  assert.deepEqual([knight.grade, s.essence], [2, 1000 - C1])
  // A Marshal is the top; never the Monarch, never a soul that is not there.
  assert.deepEqual([promoteLevel(knight), promoteCost(run, knight)], [null, null])
  knight.lvl = TUNING.level.cap
  assert.throws(() => apply(run, { type: 'promote', uid: knight.uid }), /cannot promote/, 'a Marshal is the top')
  assert.ok(!legalActions(run).some((a) => a.type === 'promote' && a.uid === knight.uid))
  assert.throws(() => apply(run, { type: 'promote', uid: 0 }), /cannot promote/, 'never the Monarch')
  assert.throws(() => apply(run, { type: 'promote', uid: 99 }), /cannot promote/)
  // A soul in the ossuary may be promoted too; promote is a map and prep action, never a reap one.
  apply(run, { type: 'place', uid: chanter.uid, slot: OSSUARY })
  assert.ok(inOssuary(souls(s.party)).includes(chanter))
  rankUp(run, chanter)
  assert.equal(chanter.grade, 1)
  s.phase = 'reap'
  assert.throws(() => apply(run, { type: 'promote', uid: chanter.uid }), /needs phase/)
})

test('legalActions lists exactly the promotions apply accepts', () => {
  const run = createRun({ seed: 'ranks-legal' })
  const s = run.state
  join(run, 'grave_ghoul')
  join(run, 'will_o_wisp')
  for (const [lvl, essence, grade] of [[2, 0, 0], [4, 39, 0], [4, 40, 0], [7, 200, 1], [6, 200, 1], [10, 500, 2]]) {
    for (const u of souls(s.party)) Object.assign(u, { lvl, grade })
    s.essence = essence
    const listed = legalActions(run).filter((a) => a.type === 'promote').map((a) => a.uid)
    const accepted = souls(s.party).filter((u) => {
      try {
        apply(copyOf(run), { type: 'promote', uid: u.uid })
        return true
      } catch {
        return false
      }
    }).map((u) => u.uid)
    assert.deepEqual(listed, accepted, JSON.stringify([lvl, essence, grade]))
  }
})

// ── tier IV and the second path ──────────────────────────────────────────────────────────────────

test('a Knight takes tier IV on its path (150) or tier I of a second path, not both; a Marshal takes both and the second path\'s II–III', () => tuned(FIRST_RANKS, () => {
  const ready = (seed) => {
    const run = createRun({ seed })
    const s = run.state
    s.essence = 5000
    const knight = soul(run, 'tomb_knight')
    for (let k = 0; k < 3; k++) apply(run, { type: 'upgrade', uid: knight.uid, path: 'bulwark' })
    return { run, s, knight }
  }
  // A Soldier at tier III has no more: no IV, no second path.
  const { run, s, knight } = ready('tiers')
  assert.ok(!canAdvance(knight, 'bulwark') && !canAdvance(knight, 'reaver'))
  assert.throws(() => apply(run, { type: 'upgrade', uid: knight.uid, path: 'bulwark' }), /cannot upgrade/)
  assert.throws(() => apply(run, { type: 'upgrade', uid: knight.uid, path: 'reaver' }), /cannot upgrade/)
  // A Knight: tier IV costs 150.
  rankUp(run, knight)
  const ups = () => legalActions(run).filter((a) => a.type === 'upgrade' && a.uid === knight.uid).map((a) => a.path)
  assert.deepEqual(ups(), ['bulwark', 'reaver'])
  assert.deepEqual([tierCost(run, knight), tierCost(run, knight, 'bulwark'), tierCost(run, knight, 'reaver')], [150, 150, 30])
  const before = s.essence
  apply(run, { type: 'upgrade', uid: knight.uid, path: 'bulwark' })
  assert.deepEqual([knight.tier, s.essence, abilitiesOf(knight)[0]], [4, before - 150, 'shield_wall'])
  assert.deepEqual(ups(), [], 'tier IV taken: no second path for a Knight')
  assert.throws(() => apply(run, { type: 'upgrade', uid: knight.uid, path: 'reaver' }), /cannot upgrade/)
  // A Marshal takes the second path too, I to III, and no more.
  rankUp(run, knight)
  for (const cost of [30, 60, 100]) {
    const was = s.essence
    assert.deepEqual(ups(), ['reaver'])
    apply(run, { type: 'upgrade', uid: knight.uid, path: 'reaver' })
    assert.equal(s.essence, was - cost)
  }
  assert.deepEqual([knight.path, knight.tier, knight.path2, knight.tier2], ['bulwark', 4, 'reaver', 3])
  assert.deepEqual(ups(), [])
  assert.deepEqual(abilitiesOf(knight), ['shield_wall', 'cleave', 'rending_strike'])
  // The other choice: a Knight starts a second path, and then tier IV waits for the Marshal.
  const other = ready('tiers2')
  rankUp(other.run, other.knight)
  apply(other.run, { type: 'upgrade', uid: other.knight.uid, path: 'reaver' })
  assert.deepEqual([other.knight.path2, other.knight.tier2, nextTier(other.knight, 'reaver'), nextTier(other.knight, 'bulwark')], ['reaver', 1, 1, 3])
  assert.ok(!canAdvance(other.knight, 'bulwark') && !canAdvance(other.knight, 'reaver'), 'one more tier is all a Knight gets')
  rankUp(other.run, other.knight)
  assert.ok(canAdvance(other.knight, 'bulwark') && canAdvance(other.knight, 'reaver'))
}))

test('a second path never clashes with the first; a rite offers a Knight its tier IV and its second path', () => {
  const run = createRun({ seed: 'clash' })
  const s = run.state
  s.essence = 5000
  const ghoul = join(run, 'grave_ghoul')
  for (let k = 0; k < 3; k++) apply(run, { type: 'upgrade', uid: ghoul.uid, path: 'glutton' })
  rankUp(run, ghoul)
  rankUp(run, ghoul)
  assert.throws(() => apply(run, { type: 'upgrade', uid: ghoul.uid, path: 'plague_bearer' }), /cannot upgrade/, 'both remake Gnaw')
  apply(run, { type: 'upgrade', uid: ghoul.uid, path: 'pack_leader' })
  assert.equal(ghoul.path2, 'pack_leader')
  // A rite: every other soul has no tier to take, so the Knight's two choices are what it offers.
  const rite = createRun({ seed: 'rite-knight' })
  const r = rite.state
  for (const u of souls(r.party)) Object.assign(u, { path: pathsOf(u.id)[0].id, tier: 3 })
  const knight = soul(rite, 'tomb_knight')
  knight.grade = 1
  const node = availableNodes(rite)[0]
  node.type = 'rite'
  apply(rite, { type: 'node', id: node.id })
  assert.deepEqual(r.offers.map((o) => [o.uid, o.path, o.name]).sort(), [
    [knight.uid, 'bulwark', 'Tomb Knight: Bulwark IV'], [knight.uid, 'reaver', 'Tomb Knight: Reaver I']
  ])
  const iv = r.offers.findIndex((o) => o.path === 'bulwark')
  assert.equal(r.offers[iv].desc, PATHS.tomb_knight[0].tiers[3].desc)
  apply(rite, { type: 'reap', index: iv })
  assert.deepEqual([knight.tier, knight.tier2], [4, 0])
})

test('the battle fights with both paths: battleSetup carries the ranks and the second path into the kit', () => {
  const run = createRun({ seed: 'kit' })
  const knight = soul(run, 'tomb_knight')
  Object.assign(knight, { grade: 2, path: 'reaver', tier: 4, path2: 'bulwark', tier2: 3 })
  const node = availableNodes(run)[0]
  node.type = 'fight'
  node.foes ??= run.state.map.nodes.find((n) => n.foes).foes
  apply(run, { type: 'node', id: node.id })
  const b = createBattle(battleSetup(run))
  const u = b.units.find((x) => x.uid === knight.uid)
  assert.deepEqual(u.kit.map((a) => a.id), ['reaving_cleave', 'rending_strike'])
  assert.equal(u.aura.range, 2)
  assert.equal(b.events[0].units.find((x) => x.uid === knight.uid).grade, 2, 'battle:start marks a Marshal')
})

test('the autoplayer: basic never promotes; the expert makes a Knight of a soul whose tier IV is next, and never one the rank does nothing for', () => {
  const run = createRun({ seed: 'promoter' })
  const s = run.state
  const chanter = soul(run, 'bone_chanter')
  chanter.lvl = promoteLevel(chanter)
  s.essence = promoteCost(run, chanter)
  assert.ok(legalActions(run).some((a) => a.type === 'promote'))
  const rng = createRng('promoter').stream('autoplay')
  assert.notEqual(policy(run, rng, 'basic').type, 'promote')
  // With no might and no summons a Knight's rank does nothing in battle yet: no soul at tier III, no promotion.
  tuned({ ranks: { might: [1, 1, 1], summons: [0, 0, 0] } }, () => {
    assert.notEqual(policy(copyOf(run), rng, 'expert').type, 'promote', 'no soul stands at tier III, and a Knight buys nothing in battle')
  })
  Object.assign(chanter, { path: pathsOf('bone_chanter')[0].id, tier: 3 })
  const up = policy(run, rng, 'expert')
  assert.deepEqual(up, { type: 'promote', uid: chanter.uid }, 'its tier IV is next')
  // Short of the essence, or of the level, it waits.
  s.essence = promoteCost(run, chanter) - 1
  assert.notEqual(policy(copyOf(run), rng, 'expert').type, 'promote')
  s.essence = promoteCost(run, chanter)
  chanter.lvl = promoteLevel(chanter) - 1
  assert.notEqual(policy(copyOf(run), rng, 'expert').type, 'promote')
  chanter.lvl = promoteLevel(chanter)
  apply(run, up)
  assert.equal(chanter.grade, 1)
  // A whole basic run never promotes.
  const basic = createRun({ seed: 'promoter-basic' })
  basic.state.essence = 500
  autoplay(basic, { level: 'basic' })
  assert.ok(!basic.state.log.some((a) => a.type === 'promote'))
})


// ── fuzz: ranks bought at random, then a fight ───────────────────────────────────────────────────

// The run fuzz seldom gets a soul past Knight; here every run starts rich in essence, so random levels,
// promotions and tiers reach Marshals, tier IV, second paths and summons, and then fight with them.
test('ranks fuzz: random levels, promotions and tiers keep every rank rule, and the battle fights them', () => {
  const seen = { marshal: 0, iv: 0, second: 0, joined: 0, summoned: 0 }
  for (let i = 0; i < 24; i++) {
    const run = createRun({ seed: 'rankfuzz' + i })
    const s = run.state
    const rng = createRng('rankfuzz' + i).stream('fuzz')
    command(run, 3)
    s.essence = 6000
    s.monarch.will = 2
    join(run, 'grave_ghoul')
    join(run, 'clockwork_page')
    const node = availableNodes(run)[0]
    node.type = 'fight'
    node.foes ??= s.map.nodes.find((n) => n.foes).foes
    apply(run, { type: 'node', id: node.id })
    for (let k = 0; k < 120; k++) {
      // A kind of action first, then one of that kind: places would drown out the rest.
      const legal = legalActions(run).filter((a) => ['promote', 'upgrade', 'level', 'place'].includes(a.type))
      if (!legal.length) break
      const type = rng.pick([...new Set(legal.map((a) => a.type))])
      apply(run, rng.pick(legal.filter((a) => a.type === type)))
      for (const u of souls(s.party)) {
        const where = `rankfuzz${i}: ${u.id} ${JSON.stringify([u.lvl, u.grade, u.path, u.tier, u.path2, u.tier2])}`
        const extra = (u.tier === 4 ? 1 : 0) + (u.tier2 ? 1 : 0)
        assert.ok(u.grade === 2 ? u.tier2 <= 3 : u.grade === 1 ? extra <= 1 && u.tier2 <= 1 : extra === 0 && u.tier <= 3, where)
        if (u.path2) assert.ok(u.path2 !== u.path && !pathsClash(u.id, u.path, u.path2), where)
        // A rank is never held below its level.
        if (u.grade) assert.ok(u.lvl >= TUNING.ranks.level[u.grade - 1], where)
      }
    }
    for (const u of souls(s.party)) {
      seen.marshal += u.grade === 2
      seen.iv += u.tier === 4
      seen.second += u.tier2 > 0
    }
    const before = s.party.length
    apply(run, { type: 'fight' })
    const b = run.battle
    seen.joined += b.units.filter((u) => u.shadow && u.cohortOf != null).length
    seen.summoned += b.units.filter((u) => u.summoned).length
    // Summons and shadows never come back to the run.
    assert.equal(s.party.length, before)
    assert.ok(!s.party.some((u) => u.summoned || u.shadow))
  }
  assert.ok(seen.marshal && seen.iv && seen.second && seen.summoned, JSON.stringify(seen))
})

// ── fixes round 1 ────────────────────────────────────────────────────────────────────────────────

test('promotion: a fallen soul may be promoted, and its rank stands when it is raised again', () => {
  const run = createRun({ seed: 'ranks-fallen' })
  const s = run.state
  const sprite = soul(run, 'frost_sprite')
  sprite.lvl = promoteLevel(sprite)
  sprite.hp = 0
  s.essence = promoteCost(run, sprite)
  assert.ok(legalActions(run).some((a) => a.type === 'promote' && a.uid === sprite.uid), 'a fallen soul is listed')
  apply(run, { type: 'promote', uid: sprite.uid })
  assert.deepEqual([sprite.grade, s.essence], [1, 0])
})

test('the expert promotes its strongest fielded standing soul first: not a weaker one, not one in the ossuary, not a purchase', () => {
  const run = createRun({ seed: 'promoter-pick' })
  const s = run.state
  const knight = soul(run, 'tomb_knight')
  const chanter = soul(run, 'bone_chanter')
  knight.lvl = 6
  chanter.lvl = promoteLevel(chanter)
  chanter.hp = Math.ceil(chanter.maxHp * 0.2)
  // A stronger undead soul in the ossuary, and essence enough to buy anything; every one of them at tier III.
  const wight = join(run, 'barrow_wight', { lvl: 10 })
  if (wight.slot >= 0) apply(run, { type: 'place', uid: wight.uid, slot: OSSUARY })
  for (const u of [knight, chanter, wight]) Object.assign(u, { path: pathsOf(u.id)[0].id, tier: 3 })
  s.essence = 2000
  assert.ok([knight, chanter, wight].every((u) => legalActions(run).some((a) => a.type === 'promote' && a.uid === u.uid)))
  assert.deepEqual(policy(run, createRng('pick').stream('autoplay'), 'expert'), { type: 'promote', uid: knight.uid })
})

test('the expert rehearses a rite\'s second-path offer as the run would make it', () => {
  const u = { ...makeUnit('tomb_knight', { uid: 1, lvl: 5 }), grade: 1, path: 'bulwark', tier: 3 }
  const s = { party: [u], relics: [] }
  const [after] = offerState(s, { type: 'tier', uid: 1, path: 'reaver' }).party
  assert.deepEqual([after.path, after.tier, after.path2, after.tier2], ['bulwark', 3, 'reaver', 1])
  assert.equal(tiersOf(after).length, 4)
  assert.deepEqual(abilitiesOf(after), abilitiesOf({ ...u, path2: 'reaver', tier2: 1 }))
  assert.equal(auraOf(after).range, 2, 'Bulwark\'s aura stays')
  assert.equal(offerState(s, { type: 'tier', uid: 1, path: 'bulwark' }).party[0].tier, 4)
  assert.deepEqual(offerState(s, { type: 'relic', id: 'x' }), { relics: ['x'] })
})

// A tier IV whose condition reads the whole board would bank for a cast its area cannot use: each reads
// only what it reaches, so the soul goes on marching and attacking.
test('a tier IV area ability waits for something in its area: the soul still attacks and still marches in', () => {
  const fight = (id, path, tier, party, foes, ticks, line = null) => {
    const b = createBattle({
      party: [{ ...makeUnit('monarch', { uid: 0, lvl: 3 }), slot: slotAt(6, 3) },
        { ...makeUnit(id, { uid: 1, lvl: 6 }), path, tier, grade: tier > 3 ? 1 : 0, slot: party, ...(line && { line }) }, ...foes.party],
      foes: foes.foes, seed: 'tier4', domain: 9
    })
    const acts = {}
    let moves = 0
    let engaged = null
    const me = b.units.find((u) => u.uid === 1)
    while (!b.over && b.t < ticks) {
      for (const e of stepBattle(b)) {
        if (e.type === 'action' && e.actor === 1) acts[e.ability] = (acts[e.ability] ?? 0) + 1
        if (e.type === 'move' && e.actor === 1) moves++
      }
      if (engaged === null && b.units.some((u) => u.side === 'foe' && u.hp > 0 && distance(u.tile, me.tile) === 1)) engaged = b.t
    }
    return { acts, moves, engaged }
  }
  // A Dirgemaster IV whose far allies lack Hasten: it still bolts, and Hastens those near it.
  const line = { party: [[0, 3], [0, 0], [0, 6]].map(([r, c], i) => ({ ...makeUnit(i ? 'tomb_knight' : 'grave_ghoul', { uid: 2 + i, lvl: 5 }), slot: slotAt(r, c) })),
    foes: [0, 2, 4, 6].map((c, i) => ({ ...makeUnit('iron_golem', { uid: 10 + i, lvl: 4 }), slot: slotAt(1, c) })) }
  const chanter = fight('bone_chanter', 'dirgemaster', 4, slotAt(3, 3), line, 1500)
  assert.ok(chanter.acts.marrow_bolt > 0 && chanter.acts.dirge_unending > 0, JSON.stringify(chanter))
  // A Juggernaut IV marching up its lane walks into melee as soon as a Juggernaut III does: Magnetize never halts
  // it 2 tiles short.
  const sprites = { party: [], foes: [2, 3, 4].map((c, i) => ({ ...makeUnit('grave_ghoul', { uid: 10 + i, lvl: 2 }), slot: slotAt(2, c) })) }
  const up = { tiles: [7, 8, 9].map((y) => tileAt(3, y)), when: { at: 'once' } }
  const [g3, g4] = [3, 4].map((tier) => fight('iron_golem', 'juggernaut', tier, slotAt(0, 3), sprites, 400, up))
  assert.ok(g4.moves > 0 && g4.engaged !== null && g4.engaged === g3.engaged, JSON.stringify([g3, g4]))
  // Molt only when a debuff lies within its 2 tiles: each cast strips at least one.
  const b = createBattle({
    party: [{ ...makeUnit('monarch', { uid: 0, lvl: 3 }), slot: slotAt(6, 3) },
      { ...makeUnit('hive_warden', { uid: 1, lvl: 5 }), path: 'chitin_guard', tier: 4, grade: 1, slot: slotAt(5, 0) },
      ...[[0, 3], [0, 6], [0, 5]].map(([r, c], i) => ({ ...makeUnit(i === 2 ? 'grave_ghoul' : 'tomb_knight', { uid: 2 + i, lvl: 5 }), slot: slotAt(r, c) }))],
    foes: [2, 3, 4, 5].map((c, i) => ({ ...makeUnit('barrow_wight', { uid: 10 + i, lvl: 4 }), slot: slotAt(1, c) })), seed: 'molt', domain: 6
  })
  let molts = 0
  let stripped = 0
  let last = null
  while (!b.over && b.t < 3000) {
    for (const e of stepBattle(b)) {
      if (e.type === 'action') last = e.actor === 1 ? e.ability : null
      if (e.type === 'action' && last === 'molt') molts++
      if (e.type === 'cleanse' && last === 'molt') stripped++
    }
  }
  assert.ok(stripped >= molts, `${molts} Molts stripped ${stripped} debuffs`)
})
