// The ablation harness (autoplay.js ABLATIONS, stripped): the expert with one mechanic taken away, and its
// battles refought with one mechanic stripped. Each ablation must take its mechanic away and change nothing
// else; the un-ablated players must play exactly as before the harness existed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createRun, apply, availableNodes, battleSetup, join, monarchCost, souls, fieldCap, currentNode, fielded, isMonarch, replay
} from '../src/sim/run.js'
import { createBattle, runBattle, timelineHash } from '../src/sim/battle.js'
import { createRng } from '../src/sim/rng.js'
import { campGrid, seatNear, autoPlace, CENTRE_OUT, pathsOf, baseStats } from '../src/sim/unit.js'
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
const bones = (counts) => Object.fromEntries(Object.entries(counts).map(([id, n]) => [id, { standing: n, fallen: 0 }]))

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
  assert.deepEqual(ABLATIONS, ['monarch-stats', 'arise', 'orders', 'reserves', 'army', 'ranks', 'paths', 'keystones', 'relics', 'synergies', 'formation', 'levels'])
  assert.deepEqual(RULE_SWITCHES, ['arise', 'synergies'])
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

test('ablating the army: a short expert run never gives a cohort or musters, but still binds rank food; a plan never leads bodies', () => {
  // (Seed ablate-b3: since rehearsals settle early, ablate-b2's army run falls in its second fight, to a roll its
  // rehearsals never met.)
  const run = ablatedRun('ablate-b3', 'army')
  playTo(run, without('army'), 6)
  assert.ok(run.state.stats.fights >= 6)
  assert.ok(!run.state.log.some((a) => ['cohort', 'muster'].includes(a.type)))
  // Bodies are still bound (rank food), so ranks stay within reach: the army's drop does not carry the ranks'.
  assert.ok(run.state.log.some((a) => a.type === 'bind'))
  assert.ok(Object.values(run.state.ossuary).some((o) => o.standing > 0))
  const promoter = createRun({ seed: 'promoter' })
  promoter.state.ossuary = bones({ grave_ghoul: 4 })
  const chanter = promoter.state.party.find((u) => u.id === 'bone_chanter')
  Object.assign(chanter, { path: pathsOf('bone_chanter')[0].id, tier: 3 })
  assert.deepEqual(policy(promoter, createRng('promoter').stream('autoplay'), without('army')), { type: 'promote', uid: chanter.uid })
  // With bodies standing and Command to lead them, still no cohort.
  const rich = createRun({ seed: 'army-off' })
  rich.state.ossuary = bones({ grave_ghoul: 6, frost_sprite: 6 })
  rich.state.monarch.command = 2
  visit(rich, 'fight')
  assert.ok(planFor(rich, LEVELS.expert).some((p) => p.cohort), 'the full expert does lead them')
  assert.ok(planFor(rich, without('army')).every((p) => !p.cohort))
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
  run.state.ossuary = bones({ grave_ghoul: 4 })
  const chanter = run.state.party.find((u) => u.id === 'bone_chanter')
  Object.assign(chanter, { path: pathsOf('bone_chanter')[0].id, tier: 3 })
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

test('ablating paths: a Knight (tier IV out of reach) is weighed as the step to a Marshal, once bodies stand for both', () => {
  const at = (bodies) => {
    const run = createRun({ seed: 'tw-0' })
    visit(run, 'fight')
    join(run, 'grave_ghoul', { lvl: 6 })
    run.state.ossuary = bones({ grave_ghoul: bodies })
    return run
  }
  const rng = createRng('tw-0').stream('autoplay')
  const knight = at(TUNING.ranks.knight + TUNING.ranks.marshal)
  const u = knight.state.party.find((x) => x.id === 'tomb_knight')
  assert.deepEqual([u.tier, u.grade], [0, 0])
  // With no rank cohort and no might a Knight of a tier-0 soul buys nothing: the full expert makes none; with paths
  // ablated it does when both ranks (the Marshal's domain) rehearse better.
  tuned({ ranks: { cohort: [0, 0, 0], might: [1, 1, 1] } }, () => {
    assert.notEqual(policy(knight, rng, 'expert').type, 'promote')
    assert.deepEqual(policy(at(TUNING.ranks.knight + TUNING.ranks.marshal), rng, without('paths')), { type: 'promote', uid: u.uid })
    // One body short of both ranks: the Knight alone is weighed, and buys nothing.
    assert.notEqual(policy(at(TUNING.ranks.knight + TUNING.ranks.marshal - 1), rng, without('paths')).type, 'promote')
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
  // A retinue with everything to strip: points, cohorts, tiers, a Marshal, a keystone, a relic, orders, a held
  // detachment.
  const s = run.state
  s.essence = 0
  const rng = createRng('nec-0').stream('autoplay')
  visit(run, 'fight')
  for (const stat of ['command', 'dominion', 'will']) { s.essence = monarchCost(run); apply(run, { type: 'monarch', stat }) }
  join(run, 'grave_ghoul', { lvl: 5 })
  s.ossuary = bones({ grave_ghoul: 4, frost_sprite: 2 })
  const [knight, chanter, sprite] = souls(s.party)
  Object.assign(knight, { path: pathsOf(knight.id)[0].id, tier: 4, grade: 2, path2: pathsOf(knight.id)[1].id, tier2: 1 })
  Object.assign(chanter, { path: pathsOf(chanter.id)[0].id, tier: 2 })
  s.keystones = ['vanguard_crown']
  s.relics = ['bone_idol']
  for (let a; (a = policy(run, rng, 'basic')).type !== 'fight';) apply(run, a)
  assert.ok(fielded(souls(s.party)).some((u) => u.cohort), 'basic gave a cohort')
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
  const ranks = (x) => [...x.party, ...x.reserve].filter((u) => u.rank && u.side !== 'foe').length
  assert.ok(ranks(full) > 0 && full.will === 1 && full.detachments.length === 2 && full.keystones.length && full.partyMods.length + full.relics.length > 0)
  const m = setup('monarch-stats')
  const monarch = m.party.find((u) => u.uid === 0)
  assert.deepEqual([monarch.lvl, monarch.maxHp, m.will, m.domain], [0, baseStats('monarch', 0).hp, 0, TUNING.monarch.domain - 1])
  // Command 0: only a ranked captain leads a cohort, of its rank's bodies (the Marshal knight's).
  const led = [...m.party, ...m.reserve].filter((u) => u.rank && u.side !== 'foe')
  assert.ok(led.length > 0 && led.length <= TUNING.ranks.cohort[2] && led.every((u) => u.cohortOf === knight.uid))
  assert.ok(m.party.filter((u) => !u.rank && u.uid !== 0).length + m.reserve.filter((u) => !u.rank && u.side !== 'foe').length <= TUNING.party.field)
  assert.ok(setup('orders').party.every((u) => !u.plan || u.plan.where === 'hunt'))
  assert.ok(setup('orders').reserve.some((u) => u.when), 'a held start kept')
  assert.ok(setup('reserves').reserve.every((u) => !u.when))
  assert.equal(ranks(setup('army')), 0)
  assert.ok(setup('ranks').party.every((u) => !u.grade && u.tier <= 3 && !u.path2))
  assert.ok(setup('paths').party.every((u) => !u.path && !u.tier && !u.path2))
  assert.deepEqual([setup('keystones').keystones, setup('keystones').domain], [[], TUNING.monarch.domain + 1])
  assert.deepEqual([setup('relics').relics, setup('relics').partyMods], [[], []])
  assert.deepEqual(setup('arise').ablate, ['arise'])
  assert.deepEqual(setup('synergies').ablate, ['synergies'])
  assert.ok(setup('levels').party.filter((u) => u.uid !== 0 && !u.rank).every((u) => u.lvl === 2))
  assert.equal(setup('formation').party.find((u) => u.uid === 0).slot, seatNear(s.camp))
  assert.throws(() => stripped(snaps[0].snapshot, 'nothing'), /unknown mechanic/)
})
