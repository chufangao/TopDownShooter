// The ablation harness (autoplay.js ABLATIONS, stripped): the expert with one mechanic taken away, and its
// battles refought with one mechanic stripped. Each ablation must take its mechanic away and change nothing
// else; the un-ablated players must play exactly as before the harness existed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createRun, apply, availableNodes, battleSetup, join, monarchCost, souls, fielded, replay, legalActions
} from '../src/sim/run.js'
import { createBattle, runBattle, timelineHash } from '../src/sim/battle.js'
import { createRng } from '../src/sim/rng.js'
import { seatNear, baseStats } from '../src/sim/unit.js'
import {
  autoplay, policy, LEVELS, ABLATIONS, RULE_SWITCHES, ablatedRun, planFor, armyWish, stripped, refight, NECESSITY, statsFor, CORE, EXTRA, BANDS,
  AUDIT, resetAudit
} from '../src/sim/autoplay.js'
import { TUNING } from '../src/tuning.js'

const BASELINE = JSON.parse(readFileSync(new URL('./ablate-baseline.json', import.meta.url), 'utf8'))
const without = (ablate) => ({ ...LEVELS.expert, ablate })

// A kind's level and tiers, set on the kind and every soul of it.
function hold (run, kind, tracks, lvl = run.state.kinds[kind].lvl) {
  run.state.kinds[kind] = { lvl, tracks }
  for (const u of souls(run.state.party)) if (u.id === kind) Object.assign(u, { tracks: tracks.slice(), lvl })
  return run.state.party.find((u) => u.id === kind)
}

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
  assert.deepEqual(ABLATIONS, ['monarch-stats', 'arise', 'lines', 'bodies', 'tracks', 'keystones', 'relics', 'synergies', 'formation', 'levels'])
  assert.deepEqual(RULE_SWITCHES, ['arise', 'synergies', 'bodies'])
  assert.deepEqual(CORE, ['monarch-stats', 'arise', 'lines', 'bodies'])
  // Every ablation but levels is targeted: a core one at 25–50 points, an extra one at 8–25.
  assert.deepEqual([...CORE, ...EXTRA, 'levels'].sort(), ABLATIONS.slice().sort())
  assert.ok(CORE.every((m) => BANDS[m].join() === '25,50') && EXTRA.every((m) => BANDS[m].join() === '8,25') && !BANDS.levels)
  assert.deepEqual(ablatedRun('sw', 'arise').state.ablate, ['arise'])
  assert.ok(!('ablate' in ablatedRun('sw', 'lines').state))
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
  // Each refought with a domain over the whole camp, so that the corpses fall in Arise's reach.
  for (const snap of [...snapshots('switch-a'), ...snapshots('switch-b')]) {
    const fight = (mechanic) => {
      const b = createBattle(battleSetup(stripped({ ...snap, monarch: { ...snap.monarch, dominion: 8 } }, mechanic)))
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

test('ablating bodies: no tier adds a body in battle, and such a tier is worth only its place on the track', () => {
  // The switch: the same setup fights the chanter's piece with Marrowcaller II's body without it, none with it.
  const run = ablatedRun('ablate-sum', 'bodies')
  assert.deepEqual(run.state.ablate, ['bodies'])
  visit(run, 'fight')
  const chanter = hold(run, 'bone_chanter', [0, 2], 5)
  const count = (r) => createBattle(battleSetup(r)).byUid.get(chanter.uid).count
  assert.equal(count(run), 1)
  const plain = createRun({ seed: 'ablate-sum' })
  visit(plain, 'fight')
  hold(plain, 'bone_chanter', [0, 2], 5)
  assert.equal(count(plain), 2)
  // Spending: with a rich purse, the full expert takes Marrowcaller II (its body) for chanters at Marrowcaller I;
  // ablated, it never values the tier for its body (it buys something else first, or the tier for the track's
  // sake only).
  const rich = (seed, ablate) => {
    const r = ablatedRun(seed, ablate)
    for (const kind of Object.keys(r.state.kinds)) hold(r, kind, [0, 0], 10)
    hold(r, 'bone_chanter', [0, 1])
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
  const marrow = (a) => a.type === 'upgrade' && a.kind === 'bone_chanter' && a.track === 1
  assert.ok(full.some(marrow), 'the full expert buys the tier')
  const off = rich('sum-buy', 'bodies')
  const order = buys(off, without('bodies')).filter((a) => a.type === 'upgrade' || a.type === 'level')
  const at = (list) => list.findIndex(marrow)
  assert.ok(at(order) === -1 || at(order) > at(full.filter((a) => a.type === 'upgrade' || a.type === 'level')), 'ablated, the tier comes later or never')
  // A run under the ablation fights every battle with the switch.
  const short = ablatedRun('ablate-b3', 'bodies')
  const battles = playTo(short, without('bodies'), 4)
  assert.ok(battles.length && battles.every((b) => b.ablate.has('bodies')))
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
  assert.deepEqual(statsFor(LEVELS.expert), ['hp', 'dominion', 'command', 'will'])
  assert.deepEqual(statsFor(without('monarch-stats')), [])
  assert.deepEqual(statsFor(without('arise')), ['hp', 'dominion', 'command'])
  assert.deepEqual(statsFor(without('lines')), ['hp', 'dominion', 'command', 'will'])
  // Basic's rule of thumb (as the expert's rollouts play) buys no Command either with the stats ablated.
  const basicRng = createRng('wish-b').stream('autoplay')
  assert.deepEqual(policy(waiting, basicRng, 'basic'), { type: 'monarch', stat: 'command' })
  assert.notEqual(policy(waiting, basicRng, { ...LEVELS.basic, ablate: 'monarch-stats' }).type, 'monarch')
})

test('ablating lines: no formation considered draws a line, and no planned soul does, where the full expert considers some', () => {
  const considered = (L, run) => {
    resetAudit(true)
    try {
      const plan = planFor(run, L)
      return { lines: AUDIT.considered.line ?? 0, plan }
    } finally {
      resetAudit(false)
    }
  }
  for (const seed of ['ord-0', 'ord-1']) {
    const run = createRun({ seed })
    join(run, 'grave_ghoul', { lvl: 3 })
    run.state.essence = monarchCost(run)
    apply(run, { type: 'monarch', stat: 'command' })
    visit(run, 'fight')
    assert.ok(considered(LEVELS.expert, run).lines > 0, 'the full expert considers lines here')
    const off = considered(without('lines'), run)
    assert.ok(off.lines === 0 && off.plan.every((p) => p.line === null))
  }
})

test('ablating tracks, levels: never bought; tracks: a rite\'s tiers declined; keystones, relics: never taken', () => {
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
  assert.ok(!buys(rich(), without('tracks')).includes('upgrade'))
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
  const a = policy(declined, rng, without('tracks'))
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

test('ablating formation: basic\'s first draft\'s cells and the Monarch where basic parks it; who fights and their lines still the expert\'s', () => {
  for (const seed of ['form-0', 'form-1']) {
    const run = createRun({ seed })
    join(run, 'grave_ghoul', { lvl: 3 })
    run.state.essence = monarchCost(run)
    apply(run, { type: 'monarch', stat: 'command' })
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
  // A retinue with everything to strip: points, a tier that adds a body, tiers, a Banner, a keystone, a relic, a line, and one
  // waiting on a signal.
  const s = run.state
  s.essence = 0
  const rng = createRng('nec-0').stream('autoplay')
  visit(run, 'fight')
  for (const stat of ['hp', 'command', 'dominion', 'will']) { s.essence = monarchCost(run); apply(run, { type: 'monarch', stat }) }
  join(run, 'grave_ghoul', { lvl: 5 })
  const [knight, chanter, sprite] = souls(s.party)
  // The Knight's kind at Bulwark IV (Banner) and Reaver II; the chanter's fights a body more (Marrowcaller II).
  hold(run, 'tomb_knight', [4, 2])
  hold(run, 'bone_chanter', [0, 2])
  s.keystones = ['court_of_bone']
  s.relics = ['bone_idol']
  for (let a; (a = policy(run, rng, 'basic')).type !== 'fight';) apply(run, a)
  assert.ok(fielded(souls(s.party)).includes(chanter), 'the chanter fights')
  const lineOf = (u) => legalActions(run).find((a) => a.type === 'line' && a.uid === u.uid && a.tiles)
  apply(run, lineOf(knight))
  const second = [sprite, ...fielded(souls(s.party))].find((u) => u !== knight && lineOf(u))
  apply(run, { ...lineOf(second), when: { at: 'struck' } })
  snaps.push({ snapshot: structuredClone({ ...s, log: [] }) })
  apply(run, { type: 'fight' })
  snaps[0].outcome = { hash: timelineHash(run.battle.events) }
  const [r] = refight({ snaps })
  assert.equal(r.same, true, 'as it stood, the refight is the real battle')
  assert.deepEqual(Object.keys(r).filter((k) => k !== 'same'), ['full', ...NECESSITY])
  const setup = (m) => battleSetup(stripped(snaps[0].snapshot, m))
  const full = setup(null)
  // The bodies the tiers add: the battle's pieces' counts past the setup's.
  const raised = (x) => {
    const b = createBattle(x)
    return x.party.reduce((n, u) => n + (b.byUid.get(u.uid)?.count ?? u.count) - u.count, 0)
  }
  assert.ok(raised(full) > 0 && full.will === 1 && full.party.filter((u) => u.line).length === 2 && full.keystones.length && full.partyMods.length + full.relics.length > 0)
  const m = setup('monarch-stats')
  const monarch = m.party.find((u) => u.uid === 0)
  assert.deepEqual([full.party.find((u) => u.uid === 0).lvl, monarch.lvl, monarch.maxHp, m.will, m.domain], [1, 0, baseStats('monarch', 0).hp, 0, TUNING.monarch.domain + 2])
  // Command 0: only the base field fights, and the souls past it lose their lines.
  assert.ok(m.party.filter((u) => u.uid !== 0).length <= TUNING.party.field)
  assert.ok(m.party.filter((u) => u.line).length <= 2)
  assert.ok(setup('lines').party.every((u) => !u.line))
  assert.deepEqual(setup('bodies').ablate, ['bodies'])
  assert.equal(raised(setup('bodies')), 0)
  assert.equal(raised(setup('tracks')), 0, 'no tier, no body added')
  assert.ok(setup('tracks').party.every((u) => u.tracks.join() === '0,0'))
  assert.ok(createBattle(full).units.some((u) => u.banner) && !createBattle(setup('tracks')).units.some((u) => u.banner))
  assert.deepEqual([setup('keystones').keystones, setup('keystones').domain], [[], TUNING.monarch.domain + 1])
  assert.deepEqual([setup('relics').relics, setup('relics').partyMods], [[], []])
  assert.deepEqual(setup('arise').ablate, ['arise'])
  assert.deepEqual(setup('synergies').ablate, ['synergies'])
  assert.ok(setup('levels').party.filter((u) => u.uid !== 0).every((u) => u.lvl === 2))
  assert.equal(setup('formation').party.find((u) => u.uid === 0).slot, seatNear(s.camp))
  assert.throws(() => stripped(snaps[0].snapshot, 'nothing'), /unknown mechanic/)
})
