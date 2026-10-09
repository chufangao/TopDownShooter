// Slice 6, ranks: promotion by level and essence, a Knight's tier IV or second path, a Marshal's domain, second
// path and the shadows and summons of its banner; and how the autoplayer uses them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRun, apply, legalActions, join, souls, monarchCost, tierCost, promoteLevel, promoteCost, canPromote, canAdvance,
  nextTier, battleSetup, availableNodes, faltersIn, faltersAt, fielded, inOssuary, OSSUARY
} from '../src/sim/run.js'
import { createBattle, stepBattle, falters, stats } from '../src/sim/battle.js'
import { policy, autoplay, offerState } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { tuned, FIRST_ARISE } from './tuned.js'
// The Marshal's reach and tier prices these scenes were built on (a reach of 2, tiers at 30/60/100/150), with
// Arise as first built: the rules under test read TUNING.
const FIRST_RANKS = { ...FIRST_ARISE, ranks: { domain: 2 }, essence: { tier: [30, 60, 100, 150] } }
import { UNITS, ABILITIES, PATHS, GRADES } from '../src/content.js'
import {
  makeUnit, abilitiesOf, auraOf, statsOf, pathsOf, pathsClash, tiersOf, expand, slotAt, tileAt, tileX, tileY, distance, DEPTH, deployTile
} from '../src/sim/unit.js'

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

// ── the Marshal's domain ─────────────────────────────────────────────────────────────────────────

const on = (id, uid, side, x, y, lvl = 3) => ({ ...makeUnit(id, { uid, lvl }), side, tile: tileAt(x, y) })
// A summon of `captain`'s on a tile (as battle.js summon makes them: on its leash, `summoned`).
const member = (id, uid, captain, x, y) => ({ ...on(id, uid, 'party', x, y), cohortOf: captain, summoned: true, summoner: captain })
const ordered = (u, where, square = null, det = 1) => ({ ...u, det, plan: { where, square } })
const marshal = (u, grade = 2) => ({ ...u, grade })

// A battle of units on tiles (as battle.test.js builds them): those not in `moving` never step. Summon tiers
// raise nothing here (the summons switch): the scenes place every unit themselves.
function scene (units, { moving = [], ...opts } = {}) {
  const foeRow0 = DEPTH - 3
  const spare = [...Array(21).keys()].filter((slot) => !units.some((u) => u.side === 'foe' && tileY(u.tile) >= foeRow0 && slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) === slot))
  const slot = (u) => u.side === 'party' ? slotAt(6 - tileY(u.tile), tileX(u.tile))
    : tileY(u.tile) >= foeRow0 ? slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) : spare.shift()
  const placed = units.map((u) => ({ ...u, slot: slot(u) }))
  const b = createBattle({ party: placed.filter((u) => u.side === 'party'), foes: placed.filter((u) => u.side === 'foe'), seed: 'scene', ablate: ['summons'], ...opts })
  for (const u of b.units) {
    const want = units.find((x) => x.uid === u.uid).tile
    if (u.tile !== want) {
      b.at[u.tile] = null
      u.tile = want
      u.anchor = want
      b.at[want] = u
    }
    if (!moving.includes(u.uid)) u.nextStep = Infinity
  }
  return b
}
const unit = (b, uid) => b.units.find((u) => u.uid === uid)

test('a Marshal carries its own domain: its banner keeps its plan beyond the Monarch\'s, and never falters there', () => {
  // A Marshal on Move to the foes' ground with its Ghoul: both pass far beyond the Monarch's domain (3), and
  // neither falters nor drops the plan; it arrives. The same banner under a Knight drops it at the edge.
  const build = (grade) => scene([on('monarch', 0, 'party', 3, 0), marshal(ordered(on('tomb_knight', 1, 'party', 3, 2), 'move', tileAt(3, 9)), grade),
    ordered(member('grave_ghoul', 2, 1, 3, 1), 'move', tileAt(3, 9)), on('iron_golem', 10, 'foe', 0, 10, 1)], { moving: [1, 2] })
  const b = build(2)
  const [m, ghoul] = [1, 2].map((uid) => unit(b, uid))
  let arrived = false
  while (!arrived && b.t < 600) {
    for (const e of stepBattle(b)) {
      assert.ok(!(e.type === 'falter' && e.on), `t ${e.t}: ${e.target} faltered`)
      if (e.type === 'arrive' && e.uid === 1) arrived = true
    }
    assert.ok(!falters(b, m) && (distance(ghoul.tile, m.tile) > TUNING.ranks.domain || !falters(b, ghoul)))
  }
  assert.ok(arrived, 'the Marshal arrived')
  assert.ok(tileY(m.tile) > b.domain + 1 && tileY(ghoul.tile) > b.domain, 'both far outside the Monarch\'s domain')
  // Full damage there: as a Knight, standing where it stands, it would deal the faltering share of it (and a
  // Knight's might, not a Marshal's: TUNING.ranks.might).
  const full = stats(b, m).damage.dealt
  m.grade = 1
  const might = TUNING.ranks.might[1] / TUNING.ranks.might[2]
  assert.ok(Math.abs(stats(b, m).damage.dealt / full - TUNING.monarch.falter * might) < 1e-9)
  m.grade = 2
  const k = build(1)
  while (!k.events.some((e) => e.type === 'falter' && e.target === 1 && e.on) && k.t < 600) stepBattle(k)
  assert.equal(unit(k, 1).where, 'hunt', 'a Knight has no domain of its own: it drops its plan at the edge')
  assert.ok(!k.events.some((e) => e.type === 'arrive'))
})

test('a Marshal\'s domain reaches 2 tiles: a member beyond it falters, and a Marshal\'s step carries the domain away from it', () => tuned(FIRST_RANKS, () => {
  // The Marshal at (2,5) on Move to the far left; its Ghoul frozen at (4,5), 2 tiles off, outside the
  // Monarch's domain. The step that takes the Marshal 3 tiles from it makes it falter, in that very tick, but
  // a step behind its Marshal it keeps its plan (the grace): its own next step decides.
  const b = scene([on('monarch', 0, 'party', 3, 0), marshal(ordered(on('tomb_knight', 1, 'party', 2, 5), 'move', tileAt(0, 9))),
    ordered(member('grave_ghoul', 2, 1, 4, 5), 'stay'), on('iron_golem', 10, 'foe', 6, 10, 1)], { moving: [1] })
  const ghoul = unit(b, 2)
  assert.ok(!falters(b, ghoul) && ghoul.where === 'stay', 'within 2 of its Marshal')
  const steps = []
  let mark = null
  while (!mark && b.t < 200) {
    const events = stepBattle(b)
    steps.push(...events.filter((e) => e.type === 'move' && e.actor === 1))
    mark = events.find((e) => e.type === 'falter' && e.target === 2)
  }
  assert.deepEqual(mark, { t: steps.at(-1).t, type: 'falter', target: 2, on: true })
  assert.ok(distance(steps.at(-1).from, ghoul.tile) <= TUNING.ranks.domain && distance(steps.at(-1).to, ghoul.tile) > TUNING.ranks.domain)
  assert.ok(steps.length > 1, 'the steps before it kept the Ghoul inside')
  assert.equal(ghoul.where, 'stay', 'left a step behind, it keeps its plan for now')
  // The Marshal walks on; the Ghoul, let go, steps after it but is still beyond its domain: that step reads
  // its place again, and outside every domain only Hunt is heeded.
  const m = unit(b, 1)
  while (distance(m.tile, ghoul.tile) <= TUNING.ranks.domain + 1 && b.t < 300) stepBattle(b)
  assert.equal(ghoul.where, 'stay', 'the Marshal\'s steps never cast it off')
  ghoul.nextStep = b.t
  const own = []
  while (!own.length && b.t < 400) own.push(...stepBattle(b).filter((e) => e.type === 'move' && e.actor === 2))
  assert.ok(own.length && distance(m.tile, ghoul.tile) > TUNING.ranks.domain && falters(b, ghoul))
  assert.equal(ghoul.where, 'hunt', 'outside every domain only Hunt is heeded')
  // A Ghoul starting 3 tiles from its Marshal, outside the Monarch's domain, falters from the start.
  const far = scene([on('monarch', 0, 'party', 3, 0), marshal(on('tomb_knight', 1, 'party', 0, 5)), member('grave_ghoul', 2, 1, 3, 5),
    on('iron_golem', 10, 'foe', 6, 10, 1)])
  assert.ok(falters(far, unit(far, 2)) && !falters(far, unit(far, 1)))
  // Without a Monarch there is no domain to leave: a Marshal changes nothing.
  const none = scene([marshal(on('tomb_knight', 1, 'party', 0, 5)), member('grave_ghoul', 2, 1, 3, 5), on('iron_golem', 10, 'foe', 6, 10, 1)])
  assert.ok(!falters(none, unit(none, 2)))
}))

test('a member trailing two behind its Marshal is not cast off by the Marshal\'s step: it falters for a moment, closes up, and keeps the plan', () => tuned(FIRST_RANKS, () => {
  // The Monarch at (0,0), its domain far behind; a Marshal at (5,5) on Move to (5,9), its Ghoul 2 tiles behind
  // it at (5,3), on the same plan. The Marshal steps first: 3 tiles off, the Ghoul falters, then closes up.
  const b = scene([on('monarch', 0, 'party', 0, 0), marshal(ordered(on('tomb_knight', 1, 'party', 5, 5), 'move', tileAt(5, 9))),
    ordered(member('grave_ghoul', 2, 1, 5, 3), 'move', tileAt(5, 9)), on('iron_golem', 10, 'foe', 0, 10, 1)], { moving: [1, 2] })
  const ghoul = unit(b, 2)
  assert.ok(!falters(b, ghoul) && ghoul.where === 'move')
  const marks = []
  let arrived = false
  while (!arrived && b.t < 600) {
    for (const e of stepBattle(b)) {
      if (e.type === 'falter' && e.target === 2) marks.push(e.on)
      if (e.type === 'arrive' && e.uid === 1) arrived = true
    }
    if (!arrived && !b.events.some((e) => e.type === 'arrive' && e.uid === 2)) assert.equal(ghoul.where, 'move', `t ${b.t}: it kept the plan`)
  }
  assert.ok(arrived, 'the Marshal arrived')
  assert.deepEqual(marks.slice(0, 2), [true, false], 'it faltered while it trailed, and no longer once it closed up')
}))

test('a shadow that rises within a Marshal\'s domain joins its banner, on its plan, and does not falter there', () => tuned(FIRST_RANKS, () => {
  // The Monarch at (3,0); a Marshal on Stay at (3,2); a Ghoul corpse a tile from it, inside both domains.
  const build = (x, y, grade = 2) => {
    const b = scene([on('monarch', 0, 'party', 3, 0), marshal(ordered(on('tomb_knight', 1, 'party', 3, 2), 'stay', null, 4), grade),
      on('grave_ghoul', 10, 'foe', x, y, 2), on('iron_golem', 11, 'foe', 6, 10, 1)])
    const corpse = unit(b, 10)
    corpse.hp = 0
    b.at[corpse.tile] = null
    b.roster++
    b.monarch.gauge = 200
    const events = stepBattle(b)
    return { b, events, arise: events.find((e) => e.type === 'arise'), shadow: b.units.find((u) => u.shadow) }
  }
  const { b, events, arise, shadow } = build(3, 3)
  assert.deepEqual([arise.unit.cohortOf, arise.unit.det, shadow.cohortOf, shadow.det, shadow.where], [1, 4, 1, 4, 'stay'])
  assert.ok(!shadow.rank && !shadow.summoned, 'a shadow, not a summon: nothing of it goes back to the run')
  assert.ok(!falters(b, shadow) && !events.some((e) => e.type === 'falter' && e.target === shadow.uid && e.on), 'within the domain it holds firm')
  // Three tiles from the Marshal (still inside the Monarch's domain): an ordinary shadow, faltering.
  const out = build(6, 3)
  assert.ok(out.arise && out.arise.unit.cohortOf === undefined && out.shadow.cohortOf === undefined && falters(out.b, out.shadow))
  // A Knight takes no shadows into its banner.
  const knight = build(3, 3, 1)
  assert.ok(knight.shadow.cohortOf === undefined && falters(knight.b, knight.shadow))
}))

// ── the autoplayer ───────────────────────────────────────────────────────────────────────────────

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

test('prep reads a Marshal\'s domain as the battle does: it does not start faltering, nor its summons within 2 tiles', () => {
  const run = createRun({ seed: 'prep-marshal' })
  const s = run.state
  command(run, 3)
  // The chanter raises Skeletons (Marrowcaller II): its banner in battle.
  const chanter = soul(run, 'bone_chanter')
  Object.assign(chanter, { path: 'marrowcaller', tier: 2 })
  const node = availableNodes(run)[0]
  node.type = 'fight'
  node.foes ??= s.map.nodes.find((n) => n.foes).foes
  apply(run, { type: 'node', id: node.id })
  // The chanter as far forward as it may stand, beyond the Monarch's domain.
  const front = legalActions(run).filter((a) => a.type === 'place' && a.uid === chanter.uid && a.slot >= 0).sort((a, b) => a.slot - b.slot)[0]
  apply(run, { type: 'place', uid: chanter.uid, slot: front.slot })
  assert.ok(faltersAt(s, chanter.slot), 'outside the Monarch\'s domain')
  for (const grade of [0, 2]) {
    chanter.grade = grade
    const b = createBattle(battleSetup(run))
    const me = b.units.find((u) => u.uid === chanter.uid)
    assert.equal(faltersIn(s, chanter), falters(b, me), `grade ${grade}`)
    assert.equal(faltersIn(s, chanter), !grade)
    // Its summons stand beside it: a Soldier's falter with it; a Marshal's hold where its own domain reaches.
    const summons = b.units.filter((u) => u.summoner === chanter.uid)
    assert.equal(summons.length, 2 + TUNING.ranks.summons[grade])
    for (const x of summons) {
      if (distance(x.tile, b.monarch.tile) <= b.domain) continue
      assert.equal(falters(b, x), !grade || distance(x.tile, me.tile) > TUNING.ranks.domain, `grade ${grade}, summon at ${x.tile}`)
    }
  }
})

// A tier IV whose condition reads the whole board would bank for a cast its area cannot use: each reads
// only what it reaches, so the soul goes on walking and attacking.
test('a tier IV area ability waits for something in its area: the soul still attacks and still walks in', () => {
  const fight = (id, path, tier, party, foes, ticks) => {
    const b = createBattle({
      party: [{ ...makeUnit('monarch', { uid: 0, lvl: 3 }), slot: slotAt(6, 3) },
        { ...makeUnit(id, { uid: 1, lvl: 6 }), path, tier, grade: tier > 3 ? 1 : 0, slot: party }, ...foes.party],
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
  // A Juggernaut IV walks into melee as soon as a Juggernaut III does: Magnetize never halts it 2 tiles short.
  const sprites = { party: [], foes: [2, 3, 4].map((c, i) => ({ ...makeUnit('frost_sprite', { uid: 10 + i, lvl: 2 }), slot: slotAt(2, c) })) }
  const [g3, g4] = [3, 4].map((tier) => fight('iron_golem', 'juggernaut', tier, slotAt(0, 3), sprites, 400))
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

test('a joined shadow left behind by its Marshal\'s step falters on that step; the nearest Marshal claims a shadow', () => tuned(FIRST_RANKS, () => {
  // The Monarch at (3,0); a Marshal on Stay at (3,2); a Ghoul corpse beside it at (3,3).
  const raised = (units) => {
    const b = scene([on('monarch', 0, 'party', 3, 0), ...units, on('grave_ghoul', 10, 'foe', 3, 3, 2), on('iron_golem', 11, 'foe', 6, 10, 1)])
    const corpse = unit(b, 10)
    corpse.hp = 0
    b.at[corpse.tile] = null
    b.roster++
    b.monarch.gauge = 200
    const events = stepBattle(b)
    return { b, arise: events.find((e) => e.type === 'arise'), shadow: b.units.find((u) => u.shadow) }
  }
  const { b, shadow } = raised([marshal(ordered(on('tomb_knight', 1, 'party', 3, 2), 'stay'))])
  assert.equal(shadow.cohortOf, 1)
  // The Marshal walks off to the left; the shadow, frozen, stays where it rose.
  const m = unit(b, 1)
  Object.assign(m, { where: 'move', square: tileAt(0, 9), nextStep: b.t })
  shadow.nextStep = Infinity
  const steps = []
  let mark = null
  while (!mark && b.t < 300) {
    const events = stepBattle(b)
    steps.push(...events.filter((e) => e.type === 'move' && e.actor === 1))
    mark = events.find((e) => e.type === 'falter' && e.target === shadow.uid)
  }
  assert.deepEqual(mark, { t: steps.at(-1).t, type: 'falter', target: shadow.uid, on: true }, 'on the Marshal\'s step')
  assert.ok(distance(steps.at(-1).to, shadow.tile) > TUNING.ranks.domain)
  // A step behind, it keeps its plan (the grace); anything that reads its place again while it is still
  // out (here the Monarch's domain moving under Vanguard Crown would; its own step does) drops it to Hunt.
  assert.equal(shadow.where, 'stay')
  while (distance(m.tile, shadow.tile) <= TUNING.ranks.domain + 1 && b.t < 400) stepBattle(b)
  shadow.nextStep = b.t
  const own = []
  while (!own.length && b.t < 500) own.push(...stepBattle(b).filter((e) => e.type === 'move' && e.actor === shadow.uid))
  assert.equal(shadow.where, 'hunt')
  // Two Marshals: the one 2 tiles off acts first, but the one beside the corpse claims the shadow.
  const two = raised([marshal(on('tomb_knight', 1, 'party', 3, 5)), marshal(on('tomb_knight', 5, 'party', 4, 2))])
  assert.equal(two.arise.unit.cohortOf, 5)
  // A shadow that rises beside its Marshal's square has arrived, as any entrant would.
  const moved = raised([marshal(ordered(on('tomb_knight', 1, 'party', 2, 2), 'move', tileAt(3, 4)))])
  assert.ok(moved.b.events.some((e) => e.type === 'arrive' && e.uid === moved.shadow.uid) && moved.shadow.where === 'hunt')
}))
