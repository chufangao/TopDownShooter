// The ablation harness (autoplay.js ABLATIONS, stripped): the expert with one mechanic taken away, and its
// battles refought with one mechanic stripped. Each ablation must take its mechanic away and change nothing
// else; the un-ablated players must play exactly as before the harness existed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createRun, apply, availableNodes, battleSetup, join, monarchCost, souls, fieldCap, currentNode, fielded, isMonarch, replay,
  promoteLevel, promoteCost
} from '../src/sim/run.js'
import { createBattle, runBattle, timelineHash } from '../src/sim/battle.js'
import { createRng } from '../src/sim/rng.js'
import { campGrid, seatNear, autoPlace, CENTRE_OUT, pathsOf, baseStats, summonsOf } from '../src/sim/unit.js'
import {
  autoplay, policy, LEVELS, ABLATIONS, RULE_SWITCHES, ablatedRun, planFor, armyWish, stripped, refight, NECESSITY, statsFor, CORE, EXTRA, BANDS
} from '../src/sim/autoplay.js'
import { TUNING } from '../src/tuning.js'
import { tuned } from './tuned.js'

const BASELINE = JSON.parse(readFileSync(new URL('./ablate-baseline.json', import.meta.url), 'utf8'))
const without = (ablate) => ({ ...LEVELS.expert, ablate })

function visit (run, type) {
  const node = availableNodes(run)[0]
  node.type = type
  if (['fight', 'elite', 'boss'].includes(type)) node.foes ??= run.state.map.nodes.find((n) => n.foes).foes
  apply(run, { type: 'node', id: node.id })
  return node
}

// Plays `level` from a fresh run of `seed` until `fights` fights are fought (or the run ends).
function playTo (run, level, fights) {
  const rng = createRng(run.state.seed).stream('autoplay')
  let n = 0
  const battles = []
  while (run.state.phase !== 'over' && n < fights) {
    const a = policy(run, rng, level)
    apply(run, a)
    if (a.type === 'fight') { n++; battles.push(run.battle) }
  }
  return battles
}

// The runs a basic player fights, each as the run stood just before the fight (to refight with a rule off).
function snapshots (seed, fights = 6) {
  const snaps = []
  const run = createRun({ seed })
  autoplay(run, {
    level: 'basic',
    beforeFight: (r) => { if (snaps.length < fights) snaps.push(structuredClone({ ...r.state, log: [] })) }
  })
  return snaps
}

test('the un-ablated players are unchanged: the same actions as before the harness, for fixed seeds', () => {
  for (const [seed, { fights, log }] of Object.entries(BASELINE.expert)) {
    const run = createRun({ seed })
    playTo(run, 'expert', fights)
    assert.deepEqual(run.state.log, log, `expert ${seed}`)
  }
  for (const [seed, log] of Object.entries(BASELINE.basic)) {
    assert.deepEqual(autoplay(createRun({ seed }), { level: 'basic' }).state.log, log, `basic ${seed}`)
  }
  // A run made with no ablation has no `ablate`, and its battles none in their setups.
  const run = createRun({ seed: 'plain' })
  assert.ok(!('ablate' in run.state))
  visit(run, 'fight')
  assert.ok(!('ablate' in battleSetup(run)))
})

test('ablation: the names, the rules switches carried by the run and its replay, and a policy that refuses a run without its switch', () => {
  assert.deepEqual(ABLATIONS, ['monarch-stats', 'arise', 'orders', 'reserves', 'summons', 'ranks', 'paths', 'keystones', 'relics', 'synergies', 'formation', 'levels'])
  assert.deepEqual(RULE_SWITCHES, ['arise', 'synergies', 'summons'])
  assert.deepEqual(CORE, ['monarch-stats', 'arise', 'orders', 'reserves', 'summons'])
  // Every ablation but levels is targeted: a core one at 25–50 points, an extra one at 8–25.
  assert.deepEqual([...CORE, ...EXTRA, 'levels'].sort(), ABLATIONS.slice().sort())
  assert.ok(CORE.every((m) => BANDS[m].join() === '25,50') && EXTRA.every((m) => BANDS[m].join() === '8,25') && !BANDS.levels)
  assert.deepEqual(ablatedRun('sw', 'arise').state.ablate, ['arise'])
  assert.ok(!('ablate' in ablatedRun('sw', 'orders').state))
  const run = ablatedRun('sw', 'synergies')
  visit(run, 'fight')
  assert.deepEqual(battleSetup(run).ablate, ['synergies'])
  const rng = createRng('sw').stream('autoplay')
  assert.throws(() => policy(createRun({ seed: 'sw' }), rng, without('arise')), /needs a run made with it/)
  assert.throws(() => policy(createRun({ seed: 'sw' }), rng, without('nothing')), /unknown ablation/)
  // replay carries the switch: the same run, battle for battle.
  const played = ablatedRun('swr', 'arise')
  playTo(played, 'basic', 3)
  const again = replay('swr', played.state.log, { ablate: ['arise'] })
  assert.equal(timelineHash(again.battle.events), timelineHash(played.battle.events))
})

test('the arise switch: the party Monarch raises no one; the synergies switch: the party holds no synergy, the foes keep theirs', () => {
  let raised = 0
  let held = 0
  for (const snap of [...snapshots('switch-a'), ...snapshots('switch-b')]) {
    const fight = (mechanic) => {
      const b = createBattle(battleSetup(stripped(snap, mechanic)))
      runBattle(b)
      return b
    }
    const full = fight(null)
    raised += full.events.filter((e) => e.type === 'arise' && e.actor === 0).length
    held += full.events[0].synergies.filter((x) => x.side === 'party').length
    const noArise = fight('arise')
    assert.equal(noArise.events.filter((e) => e.type === 'arise' && e.actor === 0).length, 0)
    assert.equal(noArise.raised, 0)
    const noSyn = fight('synergies')
    assert.deepEqual(noSyn.events[0].synergies.filter((x) => x.side === 'party'), [])
    assert.deepEqual(noSyn.events[0].synergies.filter((x) => x.side === 'foe'), full.events[0].synergies.filter((x) => x.side === 'foe'))
    assert.equal(noSyn.syn.party.list.length, 0)
    assert.equal(noSyn.syn.party.rules.size, 0)
  }
  assert.ok(raised > 0, 'the battles refought do raise shadows with Arise on')
  assert.ok(held > 0, 'and do hold synergies with them on')
})

test('ablating summons: no soul raises any in battle, and a summon tier is worth only its place on the path', () => {
  // The switch: the same setup raises the chanter's Skeletons without it, none with it.
  const run = ablatedRun('ablate-sum', 'summons')
  assert.deepEqual(run.state.ablate, ['summons'])
  visit(run, 'fight')
  const chanter = run.state.party.find((u) => u.id === 'bone_chanter')
  Object.assign(chanter, { path: 'marrowcaller', tier: 2, lvl: 5 })
  assert.equal(createBattle(battleSetup(run)).units.filter((u) => u.summoned).length, 0)
  const plain = createRun({ seed: 'ablate-sum' })
  visit(plain, 'fight')
  Object.assign(plain.state.party.find((u) => u.id === 'bone_chanter'), { path: 'marrowcaller', tier: 2, lvl: 5 })
  assert.equal(createBattle(battleSetup(plain)).units.filter((u) => u.summoned).length, 2)
  // Spending: with a purse for one tier, the full expert takes Marrowcaller II (its Skeletons) on a chanter at
  // Marrowcaller I; ablated, it never values the tier for its summons (it buys something else, or the tier for
  // the path's sake only).
  const rich = (seed, ablate) => {
    const r = ablatedRun(seed, ablate)
    for (const u of souls(r.state.party)) u.lvl = 10
    Object.assign(r.state.party.find((u) => u.id === 'bone_chanter'), { path: 'marrowcaller', tier: 1 })
    r.state.essence = 2000
    return r
  }
  const rng = createRng('ablate-sum').stream('autoplay')
  const buys = (r, L) => {
    const out = []
    for (let a, k = 0; k < 40 && (a = policy(r, rng, L)).type !== 'node'; k++) { out.push(a); apply(r, a) }
    return out
  }
  const full = buys(rich('sum-buy', null), LEVELS.expert)
  assert.ok(full.some((a) => a.type === 'upgrade' && a.path === 'marrowcaller'), 'the full expert buys the summon tier')
  const off = rich('sum-buy', 'summons')
  const order = buys(off, without('summons')).filter((a) => a.type === 'upgrade' || a.type === 'level')
  const at = (list) => list.findIndex((a) => a.type === 'upgrade' && a.path === 'marrowcaller')
  assert.ok(at(order) === -1 || at(order) > at(full.filter((a) => a.type === 'upgrade' || a.type === 'level')), 'ablated, the summon tier comes later or never')
  // A plan under the ablation rehearses with no summons, and a run of it never raises one.
  const short = ablatedRun('ablate-b3', 'summons')
  const battles = playTo(short, without('summons'), 4)
  assert.ok(battles.every((b) => !b.units.some((u) => u.summoned)))
})

test('ablating Monarch stats, or Arise: no point (or no Will) is wished for', () => {
  const waiting = createRun({ seed: 'wish' })
  visit(waiting, 'fight')
  join(waiting, 'grave_ghoul', { lvl: 6 })
  join(waiting, 'tomb_knight', { lvl: 6 })
  waiting.state.essence = monarchCost(waiting)
  assert.equal(armyWish(waiting), 'command')
  assert.equal(armyWish(waiting, without('monarch-stats')), null)
  const rng = createRng('wish').stream('autoplay')
  assert.notEqual(policy(waiting, rng, without('monarch-stats')).type, 'monarch')
  // What each may buy: every stat, none, or all but Will (the stats armyWish and the basic Command rule draw from).
  assert.deepEqual(statsFor(LEVELS.expert), ['dominion', 'command', 'will'])
  assert.deepEqual(statsFor(without('monarch-stats')), [])
  assert.deepEqual(statsFor(without('arise')), ['dominion', 'command'])
  assert.deepEqual(statsFor(without('orders')), ['dominion', 'command', 'will'])
  // Basic's rule of thumb (as the expert's rollouts play) buys no Command either with the stats ablated.
  const basicRng = createRng('wish-b').stream('autoplay')
  assert.deepEqual(policy(waiting, basicRng, 'basic'), { type: 'monarch', stat: 'command' })
  assert.notEqual(policy(waiting, basicRng, { ...LEVELS.basic, ablate: 'monarch-stats' }).type, 'monarch')
})

test('ablating orders: every planned order Hunts; ablating reserves: every planned order starts at once', () => {
  let stays = 0
  for (const seed of ['ord-0', 'ord-1', 'ord-2']) {
    const run = createRun({ seed })
    join(run, 'grave_ghoul', { lvl: 3 })
    run.state.monarch.command = 1
    visit(run, 'fight')
    const full = planFor(run, LEVELS.expert)
    stays += full.filter((p) => p.order && p.order.where !== 'hunt').length
    for (const p of planFor(run, without('orders'))) assert.ok(!p.order || (p.order.where === 'hunt' && p.order.square === null && p.order.when.at !== 'once'))
    for (const p of planFor(run, without('reserves'))) assert.ok(!p.order || (p.order.when.at === 'once' && p.order.where !== 'hunt'))
  }
  assert.ok(stays > 0, 'the full expert does plan Stay or Move here')
})

test('ablating ranks: no promotion even when a Knight would buy tier IV', () => {
  const run = createRun({ seed: 'promoter' })
  const chanter = run.state.party.find((u) => u.id === 'bone_chanter')
  Object.assign(chanter, { path: pathsOf('bone_chanter')[0].id, tier: 3, lvl: promoteLevel(chanter) })
  run.state.essence = promoteCost(run, chanter)
  const rng = createRng('promoter').stream('autoplay')
  assert.deepEqual(policy(run, rng, 'expert'), { type: 'promote', uid: chanter.uid })
  assert.notEqual(policy(run, rng, without('ranks')).type, 'promote')
})

test('ablating paths, levels: never bought; paths: a rite\'s tiers declined; keystones, relics: never taken', () => {
  const rng = createRng('spend').stream('autoplay')
  const rich = () => {
    const run = createRun({ seed: 'spend' })
    run.state.essence = 2000
    return run
  }
  const buys = (run, L) => {
    const types = []
    for (let a, k = 0; k < 60 && (a = policy(run, rng, L)).type !== 'node'; k++) { types.push(a.type); apply(run, a) }
    return types
  }
  // With levels ablated, basic's rule of thumb (as rollouts play it) buys tiers rather than stranding essence
  // behind a level gate no soul can reach.
  const gated = rich()
  visit(gated, 'fight')
  assert.equal(policy(gated, rng, { ...LEVELS.basic, ablate: 'levels' }).type, 'upgrade')
  const full = buys(rich(), LEVELS.expert)
  assert.ok(full.includes('upgrade') && full.includes('level'))
  assert.ok(!buys(rich(), without('paths')).includes('upgrade'))
  assert.ok(!buys(rich(), without('levels')).includes('level'))
  // A rite of tiers only: taken in full, declined ablated (the room ends with nothing).
  const rite = (seed) => {
    const run = createRun({ seed })
    visit(run, 'rite')
    run.state.offers = run.state.offers.filter((o) => o.type === 'tier')
    return run
  }
  const taken = rite('rite-x')
  assert.equal(taken.state.offers[policy(taken, rng, 'expert').index]?.type, 'tier')
  const declined = rite('rite-x')
  const a = policy(declined, rng, without('paths'))
  assert.deepEqual(a, { type: 'reap', index: null })
  // Keystones at a rite on floor 2; relics at a reliquary.
  const ks = createRun({ seed: 'ksauto' })
  ks.state.floor = 2
  visit(ks, 'rite')
  ks.state.offers = ks.state.offers.filter((o) => o.type === 'keystone')
  assert.equal(ks.state.offers[policy(ks, rng, 'expert').index].type, 'keystone')
  assert.deepEqual(policy(ks, rng, without('keystones')), { type: 'reap', index: null })
  const rel = createRun({ seed: 'relx' })
  visit(rel, 'reliquary')
  assert.equal(rel.state.offers[policy(rel, rng, 'expert').index].type, 'relic')
  assert.deepEqual(policy(rel, rng, without('relics')), { type: 'reap', index: null })
  // Mixed offers: the keystone ablated takes the rite's tier instead.
  const mixed = createRun({ seed: 'ksauto' })
  mixed.state.floor = 2
  visit(mixed, 'rite')
  const pick = policy(mixed, rng, without('keystones'))
  assert.equal(mixed.state.offers[pick.index].type, 'tier')
})

test('ablating paths: a Knight (tier IV out of reach) is weighed as the step to a Marshal, once it has the level and the essence for both', () => {
  // Every other soul at the level cap, so that with paths ablated the purse has nothing else to buy for the souls:
  // the ranks are weighed against keeping it; and foes at level 9, so that a fight is close enough for the
  // Marshal's domain to show (it depends on balance: at floor 1's own levels every fight is a rout either way, and
  // at 8, 10 or 12 the domain changes no rehearsal's score by the 0.01 the expert asks).
  const at = (lvl, essence) => {
    const run = createRun({ seed: 'tw-0' })
    for (const n of run.state.map.nodes) if (n.foes) n.foes = n.foes.map((f) => ({ ...f, lvl: 9 }))
    visit(run, 'fight')
    join(run, 'grave_ghoul', { lvl: 6 })
    for (const x of souls(run.state.party)) x.lvl = TUNING.level.cap
    const u = run.state.party.find((x) => x.id === 'tomb_knight')
    u.lvl = lvl
    run.state.essence = essence
    return run
  }
  const rng = createRng('tw-0').stream('autoplay')
  const [L0, L1] = TUNING.ranks.level
  const [C0, C1] = TUNING.ranks.cost
  const top = TUNING.level.cap
  const knight = at(top, C0 + C1)
  const u = knight.state.party.find((x) => x.id === 'tomb_knight')
  assert.deepEqual([u.tier, u.grade], [0, 0])
  // With no might and no summons a Knight of a tier-0 soul buys nothing: the full expert makes none; with paths
  // ablated it does when both ranks (the Marshal's domain) rehearse better than the essence on the souls.
  tuned({ ranks: { might: [1, 1, 1], summons: [0, 0, 0] } }, () => {
    assert.notEqual(policy(knight, rng, 'expert').type, 'promote')
    assert.deepEqual(policy(at(top, C0 + C1), rng, without('paths')), { type: 'promote', uid: u.uid })
    // Short of a Marshal's level, or of the essence for both: the Knight alone is weighed, and buys nothing.
    assert.notEqual(policy(at(L1 - 1, C0 + C1), rng, without('paths')).type, 'promote')
    assert.notEqual(policy(at(top, C0 + C1 - 1), rng, without('paths')).type, 'promote')
    assert.ok(L0 <= L1)
  })
})

test('ablating formation: basic\'s first draft\'s cells and the Monarch where basic parks it; who fights and their orders still the expert\'s', () => {
  for (const seed of ['form-0', 'form-1']) {
    const run = createRun({ seed })
    join(run, 'grave_ghoul', { lvl: 3 })
    run.state.monarch.command = 1
    visit(run, 'fight')
    const plan = planFor(run, without('formation'))
    const s = run.state
    assert.equal(plan.find((p) => p.uid === 0).slot, seatNear(s.camp))
    // Basic's own first draft for the same souls, all at full health: the cells must match.
    const basic = planFor({ ...run, state: structuredClone(s) }, { ...LEVELS.basic, seeds: 0 })
    const cells = (p) => Object.fromEntries(p.filter((u) => u.slot >= 0).map((u) => [u.uid, u.slot]))
    assert.deepEqual(cells(plan), cells(basic))
  }
})

test('necessity: the snapshots refight exactly as recorded, and each mechanic is stripped from the setup', () => {
  const snaps = []
  const run = createRun({ seed: 'nec-0' })
  // A retinue with everything to strip: points, a summoner, tiers, a Marshal, a keystone, a relic, orders, a held
  // detachment.
  const s = run.state
  s.essence = 0
  const rng = createRng('nec-0').stream('autoplay')
  visit(run, 'fight')
  for (const stat of ['command', 'dominion', 'will']) { s.essence = monarchCost(run); apply(run, { type: 'monarch', stat }) }
  join(run, 'grave_ghoul', { lvl: 5 })
  const [knight, chanter, sprite] = souls(s.party)
  Object.assign(knight, { path: pathsOf(knight.id)[0].id, tier: 4, grade: 2, path2: pathsOf(knight.id)[1].id, tier2: 1 })
  // The chanter raises Skeletons (Marrowcaller II).
  Object.assign(chanter, { path: 'marrowcaller', tier: 2 })
  s.keystones = ['vanguard_crown']
  s.relics = ['bone_idol']
  for (let a; (a = policy(run, rng, 'basic')).type !== 'fight';) apply(run, a)
  assert.ok(fielded(souls(s.party)).includes(chanter), 'the summoner fights')
  apply(run, { type: 'order', uids: [knight.uid], plan: { where: 'stay', square: null, when: { at: 'once' } } })
  apply(run, { type: 'order', uids: [sprite.uid], plan: { where: 'hunt', square: null, when: { at: 'struck' } } })
  snaps.push({ snapshot: structuredClone({ ...s, log: [] }) })
  apply(run, { type: 'fight' })
  snaps[0].outcome = { hash: timelineHash(run.battle.events) }
  const [r] = refight({ snaps })
  assert.equal(r.same, true, 'as it stood, the refight is the real battle')
  assert.deepEqual(Object.keys(r).filter((k) => k !== 'same'), ['full', ...NECESSITY])
  const setup = (m) => battleSetup(stripped(snaps[0].snapshot, m))
  const full = setup(null)
  const raised = (x) => createBattle(x).units.filter((u) => u.summoned).length
  assert.ok(raised(full) > 0 && full.will === 1 && full.detachments.length === 2 && full.keystones.length && full.partyMods.length + full.relics.length > 0)
  const m = setup('monarch-stats')
  const monarch = m.party.find((u) => u.uid === 0)
  assert.deepEqual([monarch.lvl, monarch.maxHp, m.will, m.domain], [0, baseStats('monarch', 0).hp, 0, TUNING.monarch.domain - 1])
  // Command 0: only the base field fights.
  assert.ok(m.party.filter((u) => u.uid !== 0).length + m.reserve.filter((u) => u.side !== 'foe').length <= TUNING.party.field)
  assert.ok(setup('orders').party.every((u) => !u.plan || u.plan.where === 'hunt'))
  assert.ok(setup('orders').reserve.some((u) => u.when), 'a held start kept')
  assert.ok(setup('reserves').reserve.every((u) => !u.when))
  assert.deepEqual(setup('summons').ablate, ['summons'])
  assert.equal(raised(setup('summons')), 0)
  assert.equal(raised(setup('paths')), 0, 'no summon tier, no summons')
  assert.ok(setup('ranks').party.every((u) => !u.grade && u.tier <= 3 && !u.path2))
  assert.ok(setup('paths').party.every((u) => !u.path && !u.tier && !u.path2))
  assert.deepEqual([setup('keystones').keystones, setup('keystones').domain], [[], TUNING.monarch.domain + 1])
  assert.deepEqual([setup('relics').relics, setup('relics').partyMods], [[], []])
  assert.deepEqual(setup('arise').ablate, ['arise'])
  assert.deepEqual(setup('synergies').ablate, ['synergies'])
  assert.ok(setup('levels').party.filter((u) => u.uid !== 0).every((u) => u.lvl === 2))
  assert.equal(setup('formation').party.find((u) => u.uid === 0).slot, seatNear(s.camp))
  assert.throws(() => stripped(snaps[0].snapshot, 'nothing'), /unknown mechanic/)
})
