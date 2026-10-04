// M2's gate (§17): "Resonance implemented as {modifiers, hooks, when} with no bespoke code — a
// Pact and a Resonance share one code path."
//
// These tests are written to fail loudly if the two ever diverge, because the day they do is the
// day shipping the 30th Pact costs more than the 12th and a mod's Pact stops being first-class.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks } from '../../tools/packsource.node.js'
import { makeParty } from '../../src/sim/party.js'
import { createBattle, createContext, initBattle } from '../../src/sim/combat/battle.js'
import { activeSynergies, tagCounts, coherence, tagSummary, synergyDefs } from '../../src/sim/synergy.js'
import { contentKinds, STAT_PATHS } from '../../src/sim/content/kinds.js'
import { createStatSchema, HOOK_POINTS } from '../../src/sim/kernel/index.js'
import { makeRng } from '../../src/sim/kernel/rng.js'

const { kernel, tuning } = await createGame({ packs: discoverPacks('packs'), seed: 1 })

function ctxFor (ids, lvl = 3) {
  kernel.defs.restore({ uid: 1 })
  const party = makeParty(kernel, ids, { lvl })
  const foes = makeParty(kernel, ['core:frost_sprite'], { side: 'foe', lvl })
  const battle = createBattle({ kernel, tuning, party, foes, seed: 1 })
  const ctx = createContext(battle, { kernel, tuning, rng: makeRng(1).stream('t') })
  initBattle(ctx)
  return ctx
}
const activeIds = (ctx, side = 'party') => ctx.synergies(side).map((s) => s.id)

// ── the gate itself ────────────────────────────────────────────────────────────────────────────

test('Resonance and Pact are validated by the same function', () => {
  const kinds = contentKinds({ statSchema: createStatSchema(STAT_PATHS), hookPoints: HOOK_POINTS })
  assert.deepEqual(Object.keys(kinds.resonance), Object.keys(kinds.pact))
  const badDef = { id: 'core:x', name: 'X', when: ['gte', ['kinCount', 'core:undead'], 2] }
  const api = { registry: kernel.registry, ops: kernel.ops, forms: kernel.forms }
  // Same def, same complaint, from both kinds.
  assert.deepEqual(kinds.resonance.validate(badDef, api), kinds.pact.validate(badDef, api))
  assert.match(kinds.resonance.validate(badDef, api)[0], /neither modifiers nor hooks/)
})

test('both kinds activate in one walk, sorted by id', () => {
  const defs = synergyDefs(kernel.registry)
  assert.ok(defs.length >= 20)
  assert.deepEqual(defs.map((d) => d.id), defs.map((d) => d.id).slice().sort())
  assert.ok(defs.some((d) => kernel.registry.has('pact', d.id)))
  assert.ok(defs.some((d) => kernel.registry.has('resonance', d.id)))
})

test('a Pact reaches the stats through the same pipeline a Resonance does', () => {
  // Glamour is a Pact; Humanoid 2 is a Resonance. Both are just modifier rows.
  const plain = ctxFor(['core:tomb_knight', 'core:bone_chanter'])
  const glamour = ctxFor(['core:frost_sprite', 'core:clockwork_page'])   // Fae 1… not enough
  assert.ok(!activeIds(glamour).includes('core:glamour'))

  const withPact = ctxFor(['core:frost_sprite', 'core:frost_sprite', 'core:clockwork_page', 'core:clockwork_page'])
  assert.ok(activeIds(withPact).includes('core:glamour'), activeIds(withPact).join(', '))

  // Units sort (side, slot), so 'foe' comes first — take a party member explicitly.
  const ally = (c) => c.battle.units.find((u) => u.side === 'party')
  assert.equal(withPact.statsOf(ally(withPact)).persuade.threshold, 0.6)
  assert.equal(plain.statsOf(ally(plain)).persuade.threshold, tuning.persuade.threshold)
  assert.equal(withPact.statsOf(withPact.battle.units.find((u) => u.side === 'foe')).persuade.threshold,
    tuning.persuade.threshold, 'and the Pact belongs to the side that earned it')
})

// ── thresholds ─────────────────────────────────────────────────────────────────────────────────

test('synergies count distinct units, and thresholds are exact', () => {
  const one = ctxFor(['core:tomb_knight'])
  assert.ok(!activeIds(one).includes('core:undead_2'))

  const two = ctxFor(['core:tomb_knight', 'core:bone_chanter'])
  assert.ok(activeIds(two).includes('core:undead_2'))
  assert.ok(!activeIds(two).includes('core:undead_4'))
})

test('a death mid-fight can drop a side below a threshold', () => {
  const ctx = ctxFor(['core:tomb_knight', 'core:bone_chanter'])
  assert.ok(activeIds(ctx).includes('core:undead_2'))

  const victim = ctx.battle.units.find((u) => u.side === 'party')
  victim.hp = 0
  ctx.rosterChanged()
  assert.ok(!activeIds(ctx).includes('core:undead_2'), 'the survivor should have lost the Resonance')
})

test('synergy modifiers go through resolveStats like everything else', () => {
  const solo = ctxFor(['core:tomb_knight', 'core:clockwork_page'])
  const pair = ctxFor(['core:tomb_knight', 'core:bone_chanter'])
  const knight = (c) => c.battle.units.find((u) => u.defId === 'core:tomb_knight')
  assert.ok(Math.abs(pair.statsOf(knight(pair)).def - solo.statsOf(knight(solo)).def * 1.12) < 1e-9,
    'Undead 2 is one mul row on `def`')
})

test('an HP synergy moves max HP before the first tick', () => {
  const plain = ctxFor(['core:tomb_knight', 'core:bone_chanter'])
  const vigil = ctxFor(['core:tomb_knight', 'core:bone_chanter', 'core:tomb_knight', 'core:bone_chanter', 'core:hive_warden', 'core:hive_warden'])
  assert.ok(activeIds(vigil).includes('core:grave_vigil'), activeIds(vigil).join(', '))
  const knight = (c) => c.battle.units.find((u) => u.defId === 'core:tomb_knight')
  assert.ok(knight(vigil).maxHp > knight(plain).maxHp)
  assert.equal(knight(vigil).hp, knight(vigil).maxHp, 'a fresh unit starts full whatever its max became')
})

// ── hook rows ──────────────────────────────────────────────────────────────────────────────────

test('Scaled Wall is a data row and reduces front-row melee damage only', () => {
  const ctx = ctxFor(['core:ember_drake', 'core:ember_drake', 'core:tomb_knight', 'core:tomb_knight'])
  assert.ok(activeIds(ctx).includes('core:scaled_wall'), activeIds(ctx).join(', '))

  const front = ctx.battle.units.find((u) => u.side === 'party' && Math.floor(u.slot / 4) === 0)
  const back = ctx.battle.units.find((u) => u.side === 'party' && Math.floor(u.slot / 4) === 2)
  const foe = ctx.battle.units.find((u) => u.side === 'foe')

  const hit = (target, melee) => kernel.hooks.emit('damage:compute', { mul: 1, add: 0, crit: false },
    Object.assign(Object.create(ctx), { actor: foe, target, ability: { melee, id: 'core:strike' } })).mul

  assert.ok(hit(front, true) < hit(back, true) / 0.7 * 0.99, 'the front row should be taking less melee')
  assert.equal(hit(front, false), 1, 'ranged is untouched by Scaled Wall or by row modifiers')
})

test('a hook row on a Pact and one on a status compose without knowing about each other', () => {
  const ctx = ctxFor(['core:ember_drake', 'core:ember_drake', 'core:tomb_knight', 'core:tomb_knight'])
  const front = ctx.battle.units.find((u) => u.side === 'party' && Math.floor(u.slot / 4) === 0)
  const foe = ctx.battle.units.find((u) => u.side === 'foe')
  const emit = () => kernel.hooks.emit('damage:apply', { damage: 100, absorbed: 0, cancel: false },
    Object.assign(Object.create(ctx), { actor: foe, target: front })).damage

  const before = emit()
  ctx.addStatus(front, 'core:regen', 100)
  assert.ok(Math.abs(emit() - before * 0.95) < 1e-9, 'Regen\'s row multiplies whatever the Pact left')
})

// ── coherence (§3, §5) ─────────────────────────────────────────────────────────────────────────

test('coherence rewards concentration and punishes breadth', () => {
  const mono = makeParty(kernel, ['core:tomb_knight', 'core:tomb_knight', 'core:tomb_knight'], { lvl: 1 })
  const spread = makeParty(kernel, ['core:tomb_knight', 'core:ember_drake', 'core:frost_sprite'], { lvl: 1 })
  assert.ok(coherence(kernel.registry, mono) > coherence(kernel.registry, spread))
  assert.equal(coherence(kernel.registry, mono), 1)
  assert.ok(coherence(kernel.registry, spread) < 0.2)
})

test('tag counting and the HUD summary agree', () => {
  const party = makeParty(kernel, ['core:tomb_knight', 'core:bone_chanter', 'core:frost_sprite'], { lvl: 1 })
  const { kin } = tagCounts(kernel.registry, party)
  assert.equal(kin.get('core:undead'), 2)
  assert.deepEqual(tagSummary(kernel.registry, party), ['Undead 2'])
})
