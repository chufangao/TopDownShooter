// The ablation harness (autoplay.js ABLATIONS, stripped): the expert with one mechanic taken away, and its
// battles refought with one mechanic stripped. Each ablation must take its mechanic away and change nothing
// else; a level with no ablation plays exactly as the level itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRun, apply, battleSetup, join, souls, fielded, replay, levelOf, monarchHp, monarchOf, commandOf
} from '../src/sim/run.js'
import { createBattle, runBattle, timelineHash } from '../src/sim/battle.js'
import { createRng } from '../src/sim/rng.js'
import { monarchSlot } from '../src/sim/unit.js'
import {
  autoplay, policy, LEVELS, ABLATIONS, RULE_SWITCHES, ablatedRun, planFor, stripped, refight, NECESSITY, CORE, EXTRA, BANDS,
  AUDIT, resetAudit
} from '../src/sim/autoplay.js'
import { unitDef, RELICS, TRACKS } from '../src/content.js'
import { TUNING } from '../src/tuning.js'
import { tuned } from './tuned.js'
import { visit } from './rooms.js'

const without = (ablate) => ({ ...LEVELS.expert, ablate })

// A kind's tiers, and the level they give, set on the kind and every soul of it.
function hold (run, kind, tracks, lvl = levelOf({ tracks })) {
  run.state.kinds[kind] = { lvl, tracks }
  for (const u of souls(run.state.party)) if (u.id === kind) Object.assign(u, { tracks: tracks.slice(), lvl })
  return run.state.party.find((u) => u.id === kind)
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

test('the un-ablated players: a level with no ablation plays exactly as the level itself, seed for seed', () => {
  for (const seed of ['ablate-b4', 'ablate-b3']) {
    const plain = createRun({ seed })
    playTo(plain, 'expert', 3)
    const none = createRun({ seed })
    playTo(none, { ...LEVELS.expert, ablate: null }, 3)
    assert.deepEqual(none.state.log, plain.state.log, `expert ${seed}`)
  }
  for (const seed of ['ablate-basic', 'ablate-basic2']) {
    const log = autoplay(createRun({ seed }), { level: 'basic' }).state.log
    assert.deepEqual(autoplay(createRun({ seed }), { level: { ...LEVELS.basic, ablate: null } }).state.log, log, `basic ${seed}`)
    assert.deepEqual(autoplay(createRun({ seed }), { level: 'basic' }).state.log, log, `basic ${seed}, again`)
  }
  // A run made with no ablation has no `ablate`, and its battles none in their setups.
  const run = createRun({ seed: 'plain' })
  assert.ok(!('ablate' in run.state))
  visit(run, 'fight')
  assert.ok(!('ablate' in battleSetup(run)))
})

test('ablation: the names, the rules switches carried by the run and its replay, and a policy that refuses a run without its switch', () => {
  // No monarch-stats and no levels: the Monarch's points and the bought levels are gone (2026-10-09).
  assert.deepEqual(ABLATIONS, ['fusions', 'summons', 'tracks', 'legendaries', 'relics', 'synergies', 'formation'])
  assert.deepEqual(RULE_SWITCHES, ['arise', 'synergies', 'summons'])
  assert.deepEqual(CORE, ['tracks', 'formation', 'summons'])
  // Every ablation is targeted: a core one at 25–50 points, an extra one at 8–25.
  assert.deepEqual([...CORE, ...EXTRA].sort(), ABLATIONS.slice().sort())
  assert.ok(CORE.every((m) => BANDS[m].join() === '25,50') && EXTRA.every((m) => BANDS[m].join() === '8,25'))
  assert.throws(() => policy(createRun({ seed: 'sw' }), createRng('sw').stream('autoplay'), without('monarch-stats')), /unknown ablation/)
  assert.deepEqual(ablatedRun('sw', 'summons').state.ablate, ['summons'])
  assert.ok(!('ablate' in ablatedRun('sw', 'fusions').state))
  const run = ablatedRun('sw', 'synergies')
  visit(run, 'fight')
  assert.deepEqual(battleSetup(run).ablate, ['synergies'])
  const rng = createRng('sw').stream('autoplay')
  assert.throws(() => policy(createRun({ seed: 'sw' }), rng, without('summons')), /needs a run made with it/)
  assert.throws(() => policy(createRun({ seed: 'sw' }), rng, without('nothing')), /unknown ablation/)
  // replay carries the switch: the same run, battle for battle.
  const played = ablatedRun('swr', 'synergies')
  playTo(played, 'basic', 3)
  const again = replay('swr', played.state.log, { ablate: ['synergies'] })
  assert.equal(timelineHash(again.battle.events), timelineHash(played.battle.events))
})

test('the arise switch: the party Monarch raises no one; the synergies switch: the party holds no synergy, the foes keep theirs', () => tuned({ arise: { domain: 11 } }, () => {
  let raised = 0
  let held = 0
  // Each refought holding Arise, with a domain over the whole camp, so that the corpses fall in its reach.
  for (const snap of [...snapshots('switch-a'), ...snapshots('switch-b')]) {
    const fight = (mechanic) => {
      const b = createBattle(battleSetup(stripped({ ...snap, relics: [...snap.relics, 'arise'] }, mechanic)))
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
}))

test('ablating summons: no tier calls a summon in battle, and such a tier is worth only its place on the track', () => {
  // The switch: the same setup fights the chanter with Marrowcaller II's summons without it, none with it.
  const run = ablatedRun('ablate-sum', 'summons')
  assert.deepEqual(run.state.ablate, ['summons'])
  visit(run, 'fight')
  const chanter = hold(run, 'bone_chanter', [0, 2])
  const called = (r) => createBattle(battleSetup(r)).units.filter((u) => u.summoned && u.summoner === chanter.uid).length
  assert.equal(called(run), 0)
  const plain = createRun({ seed: 'ablate-sum' })
  visit(plain, 'fight')
  hold(plain, 'bone_chanter', [0, 2])
  assert.equal(called(plain), TRACKS.bone_chanter[1].tiers[1].summon)
  // Spending: with a rich purse, the full expert takes Marrowcaller II (its summons) for chanters at Marrowcaller I;
  // ablated, it never values the tier for its summons (it buys something else first, or the tier for the track's
  // sake only).
  const rich = (seed, ablate) => {
    const r = ablatedRun(seed, ablate)
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
  const off = rich('sum-buy', 'summons')
  const order = buys(off, without('summons')).filter((a) => a.type === 'upgrade')
  const at = (list) => list.findIndex(marrow)
  // (The combo book still values the track itself: so no earlier, never sooner for its summons.)
  assert.ok(at(order) === -1 || at(order) >= at(full.filter((a) => a.type === 'upgrade')), 'ablated, the tier comes no earlier, or never')
  // A run under the ablation fights every battle with the switch.
  const short = ablatedRun('ablate-b3', 'summons')
  const battles = playTo(short, without('summons'), 4)
  assert.ok(battles.length && battles.every((b) => b.ablate.has('summons')))
})

test('ablating relics: neither an HP nor a Command relic is taken, so the field stays at the base Command; the legendaries ablation passes Legion\'s Command over', () => {
  const rng = createRng('wish').stream('autoplay')
  const relic = (id) => ({ type: 'relic', id, tier: RELICS[id].tier, name: '', desc: '' })
  const room = (ids) => {
    const run = createRun({ seed: 'wish' })
    visit(run, 'fight')
    for (const id of ['grave_ghoul', 'tomb_knight']) join(run, id)
    Object.assign(run.state, { phase: 'reap', offers: ids.map(relic) })
    return run
  }
  const both = room(['grave_banner', 'bone_mantle'])
  assert.ok([0, 1].includes(policy(both, rng, 'expert').index))
  assert.deepEqual(policy(both, rng, 'basic'), { type: 'reap', index: 0 })
  for (const L of [without('relics'), { ...LEVELS.basic, ablate: 'relics' }]) assert.deepEqual(policy(room(['grave_banner', 'bone_mantle']), rng, L), { type: 'reap', index: null })
  // A whole run under it ends at the base Command and the Monarch's base HP (Legion aside).
  const run = createRun({ seed: 'no-relics' })
  playTo(run, { ...LEVELS.basic, ablate: 'relics' }, 6)
  assert.ok(run.state.relics.every((id) => RELICS[id].tier === 'legendary'))
  if (!run.state.relics.includes('legion')) assert.deepEqual([commandOf(run.state), monarchOf(run.state).maxHp], [TUNING.party.field, TUNING.monarch.hp])
  // Legion is a Legendary: the legendaries ablation's, not the relics'.
  assert.deepEqual(policy(room(['legion']), rng, without('legendaries')), { type: 'reap', index: null })
  assert.deepEqual(policy(room(['legion']), rng, { ...LEVELS.basic, ablate: 'relics' }), { type: 'reap', index: 0 })
})

test('ablating fusions: never fuses, nor weighs one, where the full expert weighs every one it can make', () => {
  const fusable = (seed) => {
    const run = createRun({ seed })
    visit(run, 'fight')
    run.state.essence = 2000
    // Bone Colossus and Rime Drake made.
    join(run, 'tomb_knight')
    join(run, 'ember_drake')
    join(run, 'frost_sprite')
    return run
  }
  for (const seed of ['fus-0', 'fus-1']) {
    const weighed = (L) => {
      const run = fusable(seed)
      resetAudit(true, run)
      try {
        const acts = []
        const rng = createRng(seed).stream('autoplay')
        for (let a; (a = policy(run, rng, L)).type !== 'fight';) { acts.push(a.type); apply(run, a) }
        return { weighed: Object.keys(AUDIT.considered).filter((k) => k.startsWith('fuse ')).length, acts }
      } finally {
        resetAudit(false)
      }
    }
    assert.equal(weighed(LEVELS.expert).weighed, 2, 'the full expert weighs both')
    const off = weighed(without('fusions'))
    assert.deepEqual([off.weighed, off.acts.includes('fuse')], [0, false])
  }
})

test('ablating tracks: never bought; in a Shop, the relics and Legendaries ablations leave what they ablate on the shelf', () => {
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
  const full = buys(rich(), LEVELS.expert)
  assert.ok(full.includes('upgrade') && !full.includes('level') && !full.includes('monarch'))
  assert.ok(!buys(rich(), without('tracks')).includes('upgrade'))
  assert.ok(!buys(rich(), { ...LEVELS.basic, ablate: 'tracks' }).includes('upgrade'))
  // A Shop stocked by hand, the purse full: a Command relic is bought (autoplay.js pickShop), but not ablated.
  const shop = (stock, floor = 1) => {
    const run = createRun({ seed: 'shopx' })
    run.state.floor = floor
    visit(run, 'shop')
    Object.assign(run.state, { shop: stock.slice(), essence: 5000 })
    return run
  }
  for (const L of ['basic', 'expert']) assert.deepEqual(policy(shop(['whetstone', 'grave_banner']), rng, L), { type: 'buy', index: 1 }, L)
  assert.deepEqual(policy(shop(['whetstone', 'grave_banner']), rng, without('relics')), { type: 'leave' })
  assert.deepEqual(policy(shop(['legion'], 2), rng, 'expert'), { type: 'buy', index: 0 })
  assert.deepEqual(policy(shop(['legion'], 2), rng, without('legendaries')), { type: 'leave' })
  assert.deepEqual(policy(shop(['grave_banner'], 2), rng, without('legendaries')), { type: 'buy', index: 0 }, 'a Common–Rare relic is not a Legendary')
})

test('ablating formation: basic\'s first draft\'s cells, the Monarch on its seat; who fights still the expert\'s', () => {
  for (const seed of ['form-0', 'form-1']) {
    const run = createRun({ seed })
    join(run, 'grave_ghoul')
    run.state.relics.push('grave_banner')
    visit(run, 'fight')
    const plan = planFor(run, without('formation'))
    const s = run.state
    assert.equal(plan.find((p) => p.uid === 0).slot, monarchSlot(s.camp))
    // Basic's own first draft for the same souls, all at full health: the cells must match.
    const basic = planFor({ ...run, state: structuredClone(s) }, { ...LEVELS.basic, seeds: 0 })
    const cells = (p) => Object.fromEntries(p.filter((u) => u.slot >= 0).map((u) => [u.uid, u.slot]))
    assert.deepEqual(cells(plan), cells(basic))
  }
})

test('necessity: the snapshots refight exactly as recorded, and each mechanic is stripped from the setup', () => {
  const snaps = []
  const run = createRun({ seed: 'nec-0' })
  // A retinue with everything to strip: a tier that calls summons, tiers (a Colossus among them), a fused piece, two
  // copies of Arise and another Legendary, relics (the Monarch's HP and Command among them).
  const s = run.state
  s.essence = 0
  const rng = createRng('nec-0').stream('autoplay')
  visit(run, 'fight')
  s.relics = ['arise', 'arise', 'court_of_bone', 'bone_idol', 'grave_banner', 'bone_mantle']
  Object.assign(monarchOf(s), { hp: monarchHp(s), maxHp: monarchHp(s) })
  join(run, 'grave_ghoul')
  join(run, 'pale_court')
  const chanter = souls(s.party).find((u) => u.id === 'bone_chanter')
  // The Knight's kind at Bulwark IV (Barrow Wall: 2×2) and Reaver II; the chanter's calls summons (Marrowcaller II).
  hold(run, 'tomb_knight', [4, 2])
  hold(run, 'bone_chanter', [0, 2])
  for (let a; (a = policy(run, rng, 'basic')).type !== 'fight';) apply(run, a)
  assert.ok(fielded(souls(s.party)).includes(chanter), 'the chanter fights')
  assert.ok(fielded(souls(s.party)).some((u) => u.id === 'pale_court'), 'the fused piece fights')
  snaps.push({ snapshot: structuredClone({ ...s, log: [] }) })
  apply(run, { type: 'fight' })
  snaps[0].outcome = { hash: timelineHash(run.battle.events) }
  const [r] = refight({ snaps })
  assert.equal(r.same, true, 'as it stood, the refight is the real battle')
  assert.deepEqual(Object.keys(r).filter((k) => k !== 'same'), ['full', ...NECESSITY])
  const setup = (m) => battleSetup(stripped(snaps[0].snapshot, m))
  const full = setup(null)
  // The summons the tiers call as the battle begins.
  const raised = (x) => createBattle(x).units.filter((u) => u.summoned).length
  assert.ok(raised(full) > 0 && full.relics.filter((id) => id === 'arise').length === 2 && full.relics.length === 6)
  const bone = RELICS.court_of_bone.mods.find((m) => m.path === 'arise.domain').v
  assert.deepEqual([full.domain, full.party.find((u) => u.uid === 0).maxHp], [TUNING.arise.domain + TUNING.arise.more.domain + bone, monarchHp(s)])
  // Fusions: the Pale Court back in its three Wisps, three pieces, wounded as it was; no fused piece fights.
  const unfused = stripped(snaps[0].snapshot, 'fusions').state
  assert.ok(!souls(unfused.party).some((u) => unitDef(u.id).fused))
  assert.equal(souls(unfused.party).filter((u) => u.id === 'will_o_wisp').length, 3)
  assert.ok(full.party.some((u) => unitDef(u.id).fused) && !setup('fusions').party.some((u) => unitDef(u.id).fused))
  assert.deepEqual(setup('summons').ablate, ['summons'])
  assert.equal(raised(setup('summons')), 0)
  assert.equal(raised(setup('tracks')), 0, 'no tier, no summons')
  assert.ok(setup('tracks').party.every((u) => u.tracks.join() === '0,0'))
  assert.ok(setup('tracks').party.filter((u) => u.uid !== 0).every((u) => u.lvl === TUNING.level.base), 'and so no level past the first')
  const colossus = (x) => createBattle(x).units.some((u) => u.side === 'party' && u.id === 'tomb_knight' && u.size === 2)
  assert.ok(colossus(full) && !colossus(setup('tracks')), 'Barrow Wall makes the Knight 2×2; without tiers it is not')
  assert.deepEqual([setup('legendaries').relics, setup('legendaries').domain], [['bone_idol', 'grave_banner', 'bone_mantle'], TUNING.arise.domain])
  // The relics stripped: the Monarch at its base HP (its wounds a share), the field at its base Command.
  const bare = setup('relics')
  assert.deepEqual([bare.relics, bare.partyMods, bare.party.find((u) => u.uid === 0).maxHp], [['arise', 'arise', 'court_of_bone'], [], TUNING.monarch.hp])
  assert.ok(bare.party.filter((u) => u.uid !== 0).length <= TUNING.party.field)
  assert.deepEqual(setup('arise').ablate, ['arise'])
  assert.deepEqual(setup('synergies').ablate, ['synergies'])
  assert.equal(setup('formation').party.find((u) => u.uid === 0).slot, monarchSlot(s.camp))
  assert.throws(() => stripped(snaps[0].snapshot, 'nothing'), /unknown mechanic/)
})
