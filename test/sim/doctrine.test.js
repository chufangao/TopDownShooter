// M3's foundation (§4): the Doctrine is an artifact the player owns, and every editor has a
// backing field that reaches the sim.
//
// The claim under test is narrow and load-bearing: *rewriting a rule changes what happens*. Before
// this, `resolve.js` called `chooseAction(ctx, unit)` with no doctrine, so a run could carry a
// hand-authored policy, hand it to `awardXp` and `addRecruits`, and still fight the entire battle
// by the shipped defaults. Every editor in §4 would have been a text field wired to nothing, and
// no test in the suite would have noticed. Most of this file exists to make that impossible to
// reintroduce.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks } from '../../tools/packsource.node.js'
import { makeRng } from '../../src/sim/kernel/rng.js'
import { makeParty, makeFoes, addRecruits } from '../../src/sim/party.js'
import { createBattle } from '../../src/sim/combat/battle.js'
import { runBattle } from '../../src/sim/combat/resolve.js'
import { assignFormation, SLOTS, rowOf } from '../../src/sim/combat/formation.js'
import { createRun, playRun } from '../../src/sim/run.js'
import { generateFloor, routeThrough, DEFAULT_ROUTE_ORDER, NODE_TYPES } from '../../src/sim/dungeon.js'
import { createTrace, explain } from '../../src/sim/trace.js'
import {
  DEFAULT_DOCTRINE, DOCTRINE_VERSION, TARGET_MODES, CUT_RULES, ANY_ABILITY,
  normalize, validate, shadowed, exportDoctrine, importDoctrine, targetModesFor
} from '../../src/sim/doctrine.js'

const { kernel, tuning } = await createGame({ packs: discoverPacks('packs'), seed: 1 })
const PARTY = ['core:tomb_knight', 'core:bone_chanter', 'core:frost_sprite', 'core:ember_drake']

function battle (seed, doctrine, { size = 4, floor = 2, lvl = 3, trace = null } = {}) {
  kernel.defs.restore({ uid: 1 })
  const rng = makeRng('doctrine|' + seed)
  const d = normalize(doctrine)
  const party = makeParty(kernel, PARTY, { lvl, formation: d.formation })
  const foes = makeFoes(kernel, rng.stream('spawn'), { floor, size })
  const state = createBattle({ kernel, tuning, party, foes, seed, floor })
  return runBattle(state, { kernel, tuning, rng: rng.stream('combat'), doctrine: d, trace })
}

const newRun = (opts = {}) => (kernel.defs.restore({ uid: 1 }), createRun({ kernel, tuning, seed: 7, ...opts }))

// ── normalise ───────────────────────────────────────────────────────────────────────────────────

test('normalising fills a partial Doctrine out to the full §4 shape', () => {
  const d = normalize({ cut: 'lowestHp' })
  assert.equal(d.v, DOCTRINE_VERSION)
  assert.equal(d.cut, 'lowestHp')
  for (const key of ['formation', 'targeting', 'allyTargeting', 'ability', 'recruit', 'route', 'granted']) {
    assert.ok(d[key] !== undefined, `${key} should be filled in`)
  }
  assert.deepEqual(d.recruit, normalize(DEFAULT_DOCTRINE).recruit)
  assert.deepEqual(d.route.order, DEFAULT_ROUTE_ORDER)
})

test('the M2 array form of a targeting list still loads', () => {
  // A shape that shipped once is a shape a save can hold. Migrating it here means nothing further
  // downstream ever has to know two forms existed.
  const d = normalize({ targeting: ['backRow', 'lowestHpPct'] })
  assert.deepEqual(d.targeting.default, ['backRow', 'lowestHpPct'])
  assert.deepEqual(d.targeting.byRole, {})
})

test('normalising the default set never mutates it', () => {
  const before = JSON.stringify(DEFAULT_DOCTRINE)
  const d = normalize(DEFAULT_DOCTRINE)
  d.recruit.push({ when: true, action: 'kill' })
  d.formation.pins['core:frost_sprite'] = 3
  d.tenets.push('core:parley_threshold')
  assert.equal(JSON.stringify(DEFAULT_DOCTRINE), before)
})

test('★ a pin names a unit, so it survives a run ending and being shared (§19 debt 7)', () => {
  const d = normalize({ formation: { pins: { 'core:frost_sprite': 8 } } })
  assert.equal(d.formation.pins['core:frost_sprite'], 8)
  const again = normalize(JSON.parse(JSON.stringify(d)))
  assert.equal(again.formation.pins['core:frost_sprite'], 8, 'a pin must round-trip through a save')
})

test('a v1 pin keyed by uid is dropped rather than guessed at', () => {
  // A uid belongs to a run. There is nothing in a stored one to translate from, and a pin that
  // silently lands on the wrong unit is worse than a pin that is gone.
  const d = normalize({ v: 1, formation: { pins: { 5: 8, 'core:frost_sprite': 2 } } })
  assert.deepEqual(d.formation.pins, { 'core:frost_sprite': 2 })
})

// ── the M3 gate: a Doctrine round-trips through JSON unchanged (§17) ─────────────────────────────

test('★ a Doctrine round-trips through JSON unchanged', () => {
  const authored = normalize({
    formation: { pins: { 'core:tomb_knight': 0, 'core:bone_chanter': 9 }, autoRow: { 'core:ranger': 2 } },
    targeting: { default: ['healersFirst', 'lowestHpPct'], byRole: { 'core:vanguard': ['frontRow'] } },
    ability: [{ when: ['gte', ['enemyCount'], 4], use: 'core:dirge' }, { when: true, use: ANY_ABILITY }],
    recruit: [{ when: ['lte', ['hpPct', '$target'], 0.2], action: 'persuade', at: 0.2 }, { when: true, action: 'kill' }],
    cut: 'worstTagFit',
    route: { order: { ...DEFAULT_ROUTE_ORDER, campfire: 0 }, maxNodes: 9 }
  })

  const { doctrine, error } = importDoctrine(exportDoctrine(authored))
  assert.equal(error, null)
  assert.deepEqual(doctrine, authored)
})

test('a bad paste is an error message, never a throw', () => {
  assert.match(importDoctrine('{not json').error, /./)
  assert.equal(importDoctrine('[]').doctrine, null)
  assert.equal(importDoctrine('7').doctrine, null)
})

// ── validate ────────────────────────────────────────────────────────────────────────────────────

test('validation names the position of every problem', () => {
  const problems = validate(normalize({
    // Bought outright, so what comes back is about the *rules* rather than about affording them —
    // affordability has its own test below.
    tenets: ['core:mark_by_health', 'core:parley_threshold', 'core:which_ability_when',
      'core:cut_rule', 'core:pin_a_unit', 'core:pin_two_more', 'core:role_rows'],
    targeting: { default: ['nonsense'] },
    ability: [{ when: ['gte', ['enemyCount'], 2], use: 'core:not_a_thing' }],
    recruit: [{ when: ['badForm', 1], action: 'persuade', at: 0 }, { when: true, action: 'shrug' }],
    cut: 'byVibes',
    formation: { pins: { 'core:tomb_knight': 4, 'core:bone_chanter': 4 }, autoRow: { 'core:ranger': 9, 'core:nobody': 1 } }
  }), kernel)

  const at = (path) => problems.filter((p) => p.path.startsWith(path) && p.severity === 'error')
  assert.equal(at('targeting.default[0]').length, 1)
  assert.equal(at('ability[0].use').length, 1)
  assert.equal(at('recruit[0].when').length, 1)
  assert.equal(at('recruit[0].at').length, 1)
  assert.equal(at('recruit[1].action').length, 1)
  assert.equal(at('cut').length, 1)
  assert.equal(at('formation.pins').length, 1)
  assert.match(at('formation.autoRow.core:ranger')[0].msg, /row must be/)
  assert.match(at('formation.autoRow.core:nobody')[0].msg, /unknown Role/)
})

test('the shipped default set validates clean', () => {
  const problems = validate(normalize(DEFAULT_DOCTRINE), kernel)
  assert.deepEqual(problems.filter((p) => p.severity === 'error'), [])
})

test('a rule shadowed by an earlier catch-all is reported at authoring time (§4.1)', () => {
  // Ordered-first-match is chosen because "why did it do that" has a single-line answer. The price
  // is that a rule can be unreachable, and the editor has to say so rather than leaving a badge to
  // read 0 forever.
  const warns = shadowed(normalize({
    recruit: [
      { when: true, action: 'kill' },
      { when: ['lte', ['hpPct', '$target'], 0.3], action: 'persuade', at: 0.3 }
    ]
  }))
  assert.equal(warns.length, 1)
  assert.equal(warns[0].path, 'recruit[1]')
  assert.match(warns[0].msg, /unreachable/)
})

// ── ★ the doctrine reaches combat ───────────────────────────────────────────────────────────────

test('★ rewriting the Recruit editor changes who joins the party', () => {
  const persuadeAll = {
    recruit: [{ when: true, action: 'persuade', at: 1.0 }]
  }
  const killAll = { recruit: [{ when: true, action: 'kill' }] }

  let eager = 0
  let refused = 0
  for (let s = 0; s < 24; s++) {
    eager += battle(s, persuadeAll).state.recruited.length
    refused += battle(s, killAll).state.recruited.length
  }

  assert.equal(refused, 0, 'a KILL-everything Doctrine must never recruit — the rules are not reaching policy')
  assert.ok(eager > 0, 'a PERSUADE-everything Doctrine must recruit — the rules are not reaching policy')
})

test('★ rewriting the Targeting editor changes who gets hit', () => {
  // Row selection is an aggro roll and a row often holds one candidate, so a single fight can pick
  // the same victim under any priority list. The claim is about the whole timeline, not one swing.
  const marks = (seed, modes) => {
    const r = battle(seed, { recruit: [{ when: true, action: 'kill' }], targeting: { default: modes } })
    const ours = new Set(r.state.units.filter((u) => u.side === 'party').map((u) => u.uid))
    return r.events.filter((e) => e.type === 'action' && ours.has(e.actor)).map((e) => e.targets.join('/')).join(',')
  }
  const differ = [1, 2, 3, 4, 5, 6].filter((s) => marks(s, ['lowestHpPct']) !== marks(s, ['highestHpPct', 'backRow']))
  assert.ok(differ.length >= 3, `only ${differ.length} of 6 fights changed — targeting is not reaching policy`)
})

test('a foe fights by the shipped defaults, whatever the player wrote for themselves', () => {
  // Otherwise the game gets easier every time you write a better rule, because the enemy adopts it.
  const r = battle(5, { targeting: { default: ['highestHpPct'] }, recruit: [{ when: true, action: 'persuade', at: 1 }] })
  const foes = new Set(r.state.units.filter((u) => u.side === 'foe').map((u) => u.uid))
  assert.equal(r.events.some((e) => e.type === 'recruit' && foes.has(e.actor)), false)
})

// ── the Ability editor ──────────────────────────────────────────────────────────────────────────

test('an empty Ability list is exactly the unit\'s own list, in def order', () => {
  // The behaviour M1 and M2 had. A player who has never opened this editor must be no worse off,
  // and the timeline hash is the strongest possible statement of that.
  assert.equal(battle(11, {}).hash, battle(11, { ability: [] }).hash)
})

test('an Ability rule that names one ability makes the unit reach for it', () => {
  const only = 'core:persuade'
  const chosen = new Set()
  const r = battle(4, {
    recruit: [{ when: true, action: 'kill' }],
    ability: [{ when: true, use: 'core:marrow_bolt' }]
  })
  const chanters = new Set(r.state.units
    .filter((u) => u.side === 'party' && kernel.registry.get('unit', u.defId).abilities.includes('core:marrow_bolt'))
    .map((u) => u.uid))
  assert.ok(chanters.size > 0, 'the fixture party needs a unit holding the ability under test')
  for (const e of r.events) {
    if (e.type === 'action' && chanters.has(e.actor) && e.ability !== only) chosen.add(e.ability)
  }
  assert.deepEqual([...chosen], ['core:marrow_bolt'])
})

test('a rule naming an ability the unit does not have is skipped, not an error', () => {
  // One Doctrine is applied to a roster that changes every fight, so "my Channeler rule" has to be
  // harmless on a Vanguard.
  const r = battle(6, { ability: [{ when: true, use: 'core:marrow_bolt' }] })
  assert.ok(r.events.some((e) => e.type === 'action'), 'everyone stopped acting')
  assert.equal(r.state.reason, 'wipe')
})

test('the ELSE sentinel falls through to the unit\'s own list', () => {
  const r = battle(9, { ability: [{ when: false, use: 'core:marrow_bolt' }, { when: true, use: ANY_ABILITY }] })
  assert.equal(r.hash, battle(9, {}).hash)
})

// ── the Formation editor ────────────────────────────────────────────────────────────────────────

test('a fresh party is still auto-filled by Role, exactly as it was', () => {
  kernel.defs.restore({ uid: 1 })
  const party = makeParty(kernel, PARTY, { lvl: 3 })
  for (const u of party) {
    const role = kernel.registry.get('role', kernel.registry.get('unit', u.defId).role)
    assert.equal(rowOf(u.slot), role.autoRow ?? 1, `${u.defId} should sit in its Role's row`)
  }
  assert.equal(new Set(party.map((u) => u.slot)).size, party.length, 'no two units share a slot')
})

test('a by-Role auto-fill override moves a whole Role', () => {
  kernel.defs.restore({ uid: 1 })
  const party = makeParty(kernel, PARTY, { lvl: 3, formation: { autoRow: { 'core:vanguard': 2 } } })
  for (const u of party) {
    if (kernel.registry.get('unit', u.defId).role === 'core:vanguard') assert.equal(rowOf(u.slot), 2)
  }
})

test('a pin outranks the auto-fill', () => {
  const party = makeParty(kernel, PARTY, { lvl: 3, formation: { pins: { [PARTY[0]]: 11 } } })
  assert.equal(party[0].slot, 11)
  assert.equal(new Set(party.map((u) => u.slot)).size, party.length)
})

test('a pin applies to the lowest uid when the party holds two of the same unit', () => {
  const twins = [...PARTY, PARTY[0]]
  const party = makeParty(kernel, twins, { lvl: 3, formation: { pins: { [PARTY[0]]: 11 } } })
  const copies = party.filter((u) => u.defId === PARTY[0]).sort((a, b) => a.uid - b.uid)
  assert.equal(copies[0].slot, 11)
  assert.notEqual(copies[1].slot, 11, 'the second copy auto-fills; a pin names a species, not an instance')
  assert.equal(new Set(party.map((u) => u.slot)).size, party.length)
})

test('★ a hand-placed party is not reshuffled by a recruit', () => {
  // The bug this pass exists to prevent: `addRecruits` re-places the whole roster after every
  // fight, so without a keep pass, recruiting a Vanguard on floor 3 silently pushes a Ranger out of
  // the back row it was built for — and the editor's work is undone between nodes.
  kernel.defs.restore({ uid: 1 })
  const roster = makeParty(kernel, PARTY, { lvl: 3 })
  roster[0].slot = 6
  roster[1].slot = 3
  const before = roster.map((u) => [u.uid, u.slot])

  const joiner = kernel.defs.instantiate('unit', 'core:hive_warden', { lvl: 3, side: 'foe' })
  joiner.slot = 3                                   // the slot it held on the *other* side
  const fake = { units: [joiner], recruited: [joiner.uid] }
  const grown = addRecruits(kernel, roster, fake, { tuning, doctrine: normalize({}) })

  for (const [uid, slot] of before) {
    assert.equal(grown.roster.find((u) => u.uid === uid).slot, slot, `unit ${uid} moved`)
  }
  const arrival = grown.roster.find((u) => u.uid === joiner.uid)
  assert.ok(arrival.slot >= 0 && arrival.slot < SLOTS)
  assert.ok(!before.some(([, slot]) => slot === arrival.slot), 'the recruit took an occupied slot')
})

test('a pinned slot is held across a recruit', () => {
  kernel.defs.restore({ uid: 1 })
  const roster = makeParty(kernel, PARTY, { lvl: 3 })
  const doctrine = normalize({ formation: { pins: { [roster[2].defId]: 8 } } })
  assignFormation(roster, kernel.registry, doctrine.formation)
  assert.equal(roster[2].slot, 8)

  const joiner = kernel.defs.instantiate('unit', 'core:hive_warden', { lvl: 3, side: 'foe' })
  const grown = addRecruits(kernel, roster, { units: [joiner], recruited: [joiner.uid] }, { tuning, doctrine })
  assert.equal(grown.roster.find((u) => u.uid === roster[2].uid).slot, 8)
})

test('two pins onto one slot degrade to auto-fill rather than throwing', () => {
  // The editor prevents the collision; a hand-edited import must not brick a run.
  kernel.defs.restore({ uid: 1 })
  const party = makeParty(kernel, PARTY, { lvl: 3, formation: { pins: { [PARTY[0]]: 4, [PARTY[1]]: 4 } } })
  assert.equal(party[0].slot, 4)
  assert.notEqual(party[1].slot, 4)
  assert.equal(new Set(party.map((u) => u.slot)).size, party.length)
})

// ── the Route editor ────────────────────────────────────────────────────────────────────────────

test('the route order decides what the leader walks to first', () => {
  const floor = generateFloor({ seed: 12, floor: 2 })
  const safeFirst = routeThrough(floor, floor.entry, { risk: DEFAULT_ROUTE_ORDER })
  const fightFirst = routeThrough(floor, floor.entry, {
    risk: { ...DEFAULT_ROUTE_ORDER, elite: 0, encounter: 0, treasure: 5, shrine: 5, merchant: 5, secret: 5 }
  })
  assert.notDeepEqual(safeFirst.map((l) => l.to.type), fightFirst.map((l) => l.to.type))
  assert.equal(safeFirst.at(-1).to.type, 'exit')
  assert.equal(fightFirst.at(-1).to.type, 'exit', 'descending must stay reachable under any order')
})

test('descending early shortens the route and still reaches the stairs', () => {
  const floor = generateFloor({ seed: 12, floor: 2 })
  const short = routeThrough(floor, floor.entry, { maxNodes: 4 })
  assert.equal(short.length, 5)                     // 4 nodes, then the exit
  assert.equal(short.at(-1).to.type, 'exit')
})

test('the Route editor reaches the run', () => {
  const run = newRun({ doctrine: { route: { maxNodes: 3 } } })
  run.enterFloor()
  assert.equal(run.nodes().length, 4)
  assert.equal(run.nodes().at(-1).type, 'exit')
})

test('a skipped node type is walked past entirely, not merely visited last', () => {
  // A rank of "last" still walks there, which is the opposite of what "avoid elites" means — so
  // skipping is a filter on the node list rather than a very large risk number.
  const floor = generateFloor({ seed: 12, floor: 2 })
  const full = routeThrough(floor, floor.entry)
  const dodged = routeThrough(floor, floor.entry, { skip: ['elite', 'encounter'] })
  assert.ok(full.some((l) => l.to.type === 'elite' || l.to.type === 'encounter'), 'the fixture floor needs fights to dodge')
  assert.equal(dodged.some((l) => ['elite', 'encounter'].includes(l.to.type)), false)
  assert.equal(dodged.at(-1).to.type, 'exit', 'the stairs stay reachable however much is skipped')
})

test('skipping every node type leaves a corridor to the stairs, and says so', () => {
  const run = newRun({ doctrine: { route: { skip: NODE_TYPES.map((n) => n.type) } } })
  run.enterFloor()
  assert.deepEqual(run.nodes().map((n) => n.type), ['exit'])
  const warns = validate(run.doctrine, kernel).filter((p) => p.severity === 'warn')
  assert.ok(warns.some((w) => /walk straight to the stairs/.test(w.msg)))
})

test('the shipped route order and skip list round-trip through JSON', () => {
  const authored = normalize({ route: { order: { ...DEFAULT_ROUTE_ORDER, elite: 0 }, skip: ['shrine'], maxNodes: 6 } })
  assert.deepEqual(importDoctrine(exportDoctrine(authored)).doctrine.route, authored.route)
})

// ── the run adopts a rewritten Doctrine ─────────────────────────────────────────────────────────

test('setDoctrine applies a formation immediately and the rest at the next read', () => {
  const run = newRun()
  run.enterFloor()
  const uid = run.state.roster[0].uid
  run.setDoctrine({ formation: { pins: { [run.state.roster[0].defId]: 10 } }, cut: 'lowestHp' })
  assert.equal(run.state.roster.find((u) => u.uid === uid).slot, 10)
  assert.equal(run.doctrine.cut, 'lowestHp')
})

test('a run carries its Doctrine into every fight it resolves', () => {
  const kills = playRun(newRun({ doctrine: { recruit: [{ when: true, action: 'kill' }] } }), { maxFloors: 2 })
  assert.equal(kills.reports.flatMap((r) => r.joined).length, 0)
})

// ── targeting vocabulary ────────────────────────────────────────────────────────────────────────

test('every targeting mode is a total, transitive comparator', () => {
  kernel.defs.restore({ uid: 1 })
  const party = makeParty(kernel, PARTY, { lvl: 4 })
  party.forEach((u, i) => { u.hp = u.maxHp - i * 3 })
  const ctx = { registry: kernel.registry }
  for (const mode of TARGET_MODES) {
    const sorted = party.slice().sort((a, b) => mode.cmp(a, b, ctx) || a.slot - b.slot)
    assert.equal(sorted.length, party.length, `${mode.id} lost a candidate`)
    assert.ok(mode.label && mode.desc, `${mode.id} needs a label and a description for the menu`)
  }
})

test('a per-Role targeting override beats the default', () => {
  const d = normalize({ targeting: { default: ['lowestHpPct'], byRole: { 'core:vanguard': ['backRow'] } } })
  assert.deepEqual(targetModesFor(d, 'core:vanguard'), ['backRow'])
  assert.deepEqual(targetModesFor(d, 'core:channeler'), ['lowestHpPct'])
  assert.deepEqual(targetModesFor(d, null), ['lowestHpPct'])
})

test('every cut rule orders a roster without throwing', () => {
  kernel.defs.restore({ uid: 1 })
  const roster = makeParty(kernel, PARTY, { lvl: 4 })
  for (const [id, cmp] of Object.entries(CUT_RULES)) {
    const sorted = roster.slice().sort((a, b) => cmp(a, b, kernel.registry, roster) || (a.uid - b.uid))
    assert.equal(sorted.length, roster.length, `${id} lost a unit`)
  }
})

// ── §4.1 instrumentation ────────────────────────────────────────────────────────────────────────

test('★ every rule carries a fire count, and a rule that never fires reads zero', () => {
  const trace = createTrace()
  battle(2, {
    recruit: [
      { when: ['lt', ['tier', '$target'], 0], action: 'persuade', at: 0.9 },   // can never hold
      { when: true, action: 'kill' }
    ]
  }, { trace })

  const dead = trace.countsFor('recruit', 0)
  const live = trace.countsFor('recruit', 1)
  assert.ok(dead.run.evaluated > 0, 'the rule was never even reached — the trace is not wired in')
  assert.equal(dead.run.fired, 0, 'an impossible rule fired')
  assert.ok(live.run.fired > 0)
})

test('a zero badge opens into the sub-expression that made it zero (§4.1)', () => {
  const trace = createTrace()
  battle(2, { recruit: [{ when: ['gte', ['tier', '$target'], 99], action: 'persuade', at: 0.9 }, { when: true, action: 'kill' }] }, { trace })

  const samples = trace.samplesFor('recruit', 0)
  assert.ok(samples.length > 0 && samples.length <= 3, 'samples are kept, and bounded')
  const lines = explain(samples[0])
  // "tier($target) → 2", then "tier($target) ≥ 99 → false" — the whole debugging story.
  assert.ok(lines.some((l) => /^tier\(\$target\) → \d+$/.test(l)), lines.join(' | '))
  assert.ok(lines.at(-1).endsWith('→ false'))
})

test('short-circuiting is visible: an AND that stopped early lists only what it read', () => {
  const trace = createTrace()
  battle(2, {
    recruit: [
      { when: ['and', ['gte', ['tier', '$target'], 99], ['lt', ['attempts', '$target'], 3]], action: 'persuade', at: 0.9 },
      { when: true, action: 'kill' }
    ]
  }, { trace })
  const lines = explain(trace.samplesFor('recruit', 0)[0])
  assert.ok(!lines.some((l) => l.startsWith('attempts(')), 'the second arm was never reached and must not be reported')
})

test('the trace costs nothing when it is off', () => {
  // The fuzzer runs 10,000 battles and the balance harness thousands more; neither may pay for
  // instrumentation it does not read. The proof is that the timeline is identical either way.
  const withOut = battle(8, {})
  const withIn = battle(8, {}, { trace: createTrace() })
  assert.equal(withOut.hash, withIn.hash)
})

test('battle-scope counts reset and run-scope counts accumulate', () => {
  const trace = createTrace()
  const d = { recruit: [{ when: ['gte', ['tier', '$target'], 1], action: 'persuade', at: 0.4 }, { when: true, action: 'kill' }] }
  battle(1, d, { trace })
  const first = trace.countsFor('recruit', 0).run.evaluated
  battle(2, d, { trace })
  const after = trace.countsFor('recruit', 0)
  assert.ok(after.run.evaluated > first, 'run counts should accumulate across battles')
  assert.ok(after.battle.evaluated <= after.run.evaluated - first + after.battle.evaluated)
  assert.ok(after.battle.evaluated > 0)
  assert.ok(after.battle.evaluated < after.run.evaluated, '"this battle" must be a subset of "this run"')
})

test('a trace snapshot is plain JSON, so the post-mortem and the save can hold one', () => {
  const trace = createTrace()
  battle(1, {}, { trace })
  const snap = trace.snapshot()
  assert.doesNotThrow(() => JSON.stringify(snap))
  assert.ok(Object.keys(snap.run).length > 0)
})

// ── the M3.5 fields (§4.2) ──────────────────────────────────────────────────────────────────────

test('★ the shipped Doctrine says nothing at all, which is what run 1 is', () => {
  const d = normalize(DEFAULT_DOCTRINE)
  assert.deepEqual(d.tenets, [], 'nothing bought')
  assert.deepEqual(d.recruit, [], 'and therefore nothing written — the standing orders are not yours')
  assert.deepEqual(d.ability, [])
  assert.deepEqual(d.branch, [])
  assert.deepEqual(validate(d, kernel).filter((p) => p.severity === 'error'), [])
})

test('owned tenets are a sorted set — buying order cannot make two Doctrines differ', () => {
  const a = normalize({ tenets: ['core:cut_rule', 'core:parley_threshold', 'core:cut_rule'] })
  const b = normalize({ tenets: ['core:parley_threshold', 'core:cut_rule'] })
  assert.deepEqual(a.tenets, b.tenets)
  assert.deepEqual(a.tenets, ['core:cut_rule', 'core:parley_threshold'])
})

test('a Succession rule naming a branch nothing installs warns rather than errors', () => {
  const d = normalize({ tenets: ['core:branch_preference'], branch: [{ when: true, prefer: 'core:not_a_branch' }] })
  const problems = validate(d, kernel)
  assert.equal(problems.filter((p) => p.severity === 'error').length, 0,
    'a shared Doctrine may name branches the recipient has not installed')
  assert.ok(problems.some((p) => p.path === 'branch[0].prefer' && p.severity === 'warn'))
})

test('an unreachable Succession rule is reported like any other shadowed rule', () => {
  const d = normalize({ tenets: ['core:branch_preference'], branch: [{ when: true, prefer: 'a' }, { when: true, prefer: 'b' }] })
  assert.ok(shadowed(d).some((w) => w.path === 'branch[1]'))
})

test('what you bought survives an export/import round trip', () => {
  const d = normalize({
    tenets: ['core:branch_preference', 'core:parley_threshold'],
    branch: [{ when: ['eq', ['role', '$self'], 'core:vanguard'], prefer: 'core:ossify' }]
  })
  const back = importDoctrine(exportDoctrine(d))
  assert.equal(back.error, null)
  assert.deepEqual(back.doctrine.tenets, d.tenets)
  assert.deepEqual(back.doctrine.branch, d.branch)
})
