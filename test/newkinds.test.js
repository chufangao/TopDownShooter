// The floor-1 pool of 2026-10-18 (the user's word: "First battle is too hard. Add more enemies and units. Tomb knight
// is too strong with many abilities for early game."): the Tomb Knight met from floor 2, its kit, tracks and recipes
// kept, the threshold's fixed party keeping it; and four simple kinds of tier 1 on floor 1, one each where a kin's slice
// lacked it, so a lone first soul of any kin can hold a road or shoot from behind one. Rules, not balance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { UNITS, ABILITIES, TEMPERS, BEHAVIOURS, THREATS, FUSIONS, FUSION_LIST, TUTORIAL, trineOf, isTriple } from '../src/content.js'
import { spawnPool, draftPool, draftOffer, tutorialRun, createRun, souls } from '../src/sim/run.js'
import { isBlow } from '../src/sim/unit.js'
import { basicOf } from '../src/sim/turns.js'

const NEW = ['cinder_whelp', 'brass_sentry', 'hive_spitter', 'thornling']
const ids = (p) => p.units.map((u) => u.id)
const hpAtk = (id) => UNITS[id].base.hp * UNITS[id].base.atk

test('the Tomb Knight is met from floor 2: never in floor 1\'s pool nor the draft\'s, in floor 2\'s, its kit and recipes kept', () => {
  const k = UNITS.tomb_knight
  assert.equal(k.spawn.minFloor, 2)
  assert.ok(!ids(spawnPool(1)).includes('tomb_knight'))
  assert.ok(!ids(spawnPool(1, 1)).includes('tomb_knight'), 'nor a floor-1 elite\'s')
  assert.ok(!draftPool().includes('tomb_knight'))
  assert.ok(ids(spawnPool(2)).includes('tomb_knight'))
  for (let i = 0; i < 200; i++) assert.ok(!draftOffer(`tk-${i}`, 0).includes('tomb_knight'), `tk-${i}`)
  // Its kit, tracks and recipes as they were: the Bone Colossus reached from floor 2, its trine still made.
  assert.deepEqual(k.abilities, ['cleave', 'strike'])
  assert.ok(k.aura && k.tracks.length === 2 && k.tracks.every((t) => t.tiers.length === 4))
  assert.deepEqual(FUSIONS.bone_colossus.needs, { tomb_knight: 2, bone_chanter: 1 })
  assert.ok(trineOf('tomb_knight') && FUSIONS[trineOf('tomb_knight').id])
  // The threshold's party is fixed, not drafted: it keeps its Tomb Knight.
  assert.ok(TUTORIAL.party.includes('tomb_knight'))
  const run = tutorialRun()
  assert.ok(run.state.party.some((u) => u.id === 'tomb_knight'))
  // One on one: the Knight alone against one foe.
  assert.deepEqual(souls(run.state.party).map((u) => u.id), ['tomb_knight'])
  assert.equal(run.state.map.nodes.find((n) => n.type === 'fight').foes.length, 1)
})

test('four new kinds of tier 1 on floor 1, each in the floor-1 pool and offered by the draft on some seed', () => {
  for (const id of NEW) {
    assert.ok(ids(spawnPool(1)).includes(id), `${id}: floor 1's pool`)
    assert.ok(draftPool().includes(id), `${id}: the draft's pool`)
    let seed = null
    for (let i = 0; i < 200 && !seed; i++) if (draftOffer(`nk-${i}`, 0).includes(id)) seed = `nk-${i}`
    assert.ok(seed, `${id}: offered by the draft on some seed`)
    assert.ok(createRun({ seed }).state.draft.offer.includes(id), `${id}: a run on ${seed} offers it`)
  }
})

test('each new kind is simple: tier 1, one blow of its own and at most a basic, no aura, its numbers in the floor-1 band', () => {
  const ranger = { cinder_whelp: 'drake', brass_sentry: 'construct', hive_spitter: 'insect' }
  for (const id of NEW) {
    const d = UNITS[id]
    assert.ok(d.tier === 1 && d.spawn.minFloor === 1 && !d.fused && !d.boss, id)
    assert.ok(Number.isInteger(d.spawn.weight) && d.spawn.weight > 0, `${id}: a spawn weight`)
    assert.ok(d.abilities.length >= 1 && d.abilities.length <= 2 && (d.abilities.length === 1 || d.abilities.at(-1) === 'strike'), `${id}: ${d.abilities}`)
    assert.ok(!d.aura && !d.flies && !d.onFall && !d.rule && !d.arm && !d.size, `${id}: nothing more`)
    assert.equal(d.behaviour, 'walk')
    assert.ok(BEHAVIOURS[d.behaviour])
    assert.ok(Object.values(TEMPERS).includes(d.temper), `${id}: a preset temper`)
    assert.ok(d.threats.length && d.threats.every((t) => THREATS[t]), id)
    assert.ok(d.flavour && !d.flavour.includes('\n'), `${id}: one line`)
    assert.ok(hpAtk(id) <= hpAtk('grave_ghoul'), `${id}: HP × ATK ${hpAtk(id)} past the Grave Ghoul's`)
    // Two tracks of four: tiers I–II stat mods, III an ability, IV a rule (an ability or Colossus).
    assert.equal(d.tracks.length, 2)
    for (const t of d.tracks) {
      assert.equal(t.tiers.length, 4, `${id} ${t.id}`)
      assert.ok(t.tiers.slice(0, 2).every((x) => x.mods && !x.ability && !x.aura && !x.size && !x.summon), `${id} ${t.id}: I–II`)
      assert.ok(t.tiers[2].ability, `${id} ${t.id}: III an ability`)
      assert.ok(t.tiers[3].ability || t.tiers[3].size === 2, `${id} ${t.id}: IV a rule`)
    }
    // Its pictures borrowed from a kind with its own, until its own are drawn.
    assert.ok(UNITS[d.art] && UNITS[d.art].art === d.art)
  }
  // The three shooters: rangers of their kins, a basic of one foe at three tiles; the Sentry slow.
  for (const [id, kin] of Object.entries(ranger)) {
    const d = UNITS[id]
    assert.deepEqual([d.kin, d.role], [kin, 'ranger'], id)
    const a = ABILITIES[d.abilities[0]]
    assert.deepEqual([d.abilities.length, a.shape, a.range, !!a.melee, !!a.arc], [1, 'single', 3, false, false], id)
    assert.equal(basicOf(d.abilities.map((x) => ABILITIES[x])).id, a.id, `${id}: its spit its basic`)
  }
  assert.equal(UNITS.brass_sentry.move, 1)
  assert.ok(['cinder_whelp', 'hive_spitter', 'thornling'].every((id) => UNITS[id].move === 2))
  assert.ok(hpAtk('hive_spitter') < hpAtk('cinder_whelp') && UNITS.hive_spitter.base.hp < UNITS.cinder_whelp.base.hp, 'the Spitter frail')
  assert.ok(UNITS.brass_sentry.base.hp > UNITS.cinder_whelp.base.hp && UNITS.brass_sentry.base.def > UNITS.cinder_whelp.base.def, 'the Sentry sturdy')
  // The Thornling: the fae's blocker, sturdier than the Sprite and the Wisp, weaker than the Grave Ghoul.
  const t = UNITS.thornling
  assert.deepEqual([t.kin, t.role, t.abilities], ['fae', 'vanguard', ['thorn_lash', 'strike']])
  assert.ok(ABILITIES.thorn_lash.melee && ABILITIES.strike.melee)
  assert.ok(t.base.hp > UNITS.frost_sprite.base.hp && t.base.hp > UNITS.will_o_wisp.base.hp && t.base.hp < UNITS.grave_ghoul.base.hp)
  assert.ok(hpAtk('thornling') < hpAtk('grave_ghoul'))
})

test('every kin\'s floor-1 slice holds a kind whose basic is melee and one whose basic shoots', () => {
  const pool = spawnPool(1).units
  for (const kin of new Set(pool.map((u) => u.kin))) {
    const basics = pool.filter((u) => u.kin === kin).map((u) => basicOf(u.abilities.map((x) => ABILITIES[x]).filter(isBlow)))
    assert.ok(basics.some((a) => a.melee), `${kin}: a melee basic`)
    assert.ok(basics.some((a) => !a.melee && a.range >= 3), `${kin}: a ranged basic`)
  }
})

test('each new kind has its trine and its trine\'s trine, made by the rule, their triples in the book', () => {
  const book = JSON.parse(readFileSync(new URL('../src/sim/combos.json', import.meta.url), 'utf8'))
  const booked = new Set(book.combos.map((c) => c.fuse).filter(Boolean))
  for (const id of NEW) {
    const t = trineOf(id)
    assert.ok(t && t.id === `trine:${id}` && t.fused && t.tier === 3 && t.trineOf === id, `${id}: its trine`)
    const tt = trineOf(t.id)
    assert.ok(tt && tt.id === `trine:trine:${id}` && tt.tier === 5 && tt.size === 2, `${id}: its trine's trine`)
    for (const r of [FUSIONS[t.id], FUSIONS[tt.id]]) {
      assert.ok(r && isTriple(r) && FUSION_LIST.includes(r), `${id}: ${r?.id}`)
      assert.ok(booked.has(r.id), `${r.id} in the book`)
    }
    assert.deepEqual(FUSIONS[t.id].needs, { [id]: 3 })
  }
  // 44 recipes before the four, two triples each: 52.
  assert.equal(FUSION_LIST.length, 52)
})
