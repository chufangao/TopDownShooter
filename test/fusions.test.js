// The fusion graph in play: a trine fused out of battle, generically, as any recipe is; a trine's
// summons its parts' kind; a capstone made of fused parts; the four capstones' rules (rules.js), each scoped to
// the piece of its kind; and the book reading a fused part as its own recipe's parts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UNITS, FUSION_LIST, trineOf, isTriple } from '../src/content.js'
import { perform, applyDamage } from '../src/sim/turns.js'
import { call } from '../src/sim/rules.js'
import { createRun, apply, join, souls, canFuse, fuseParts, fuseCost, legalActions, START_PARTY } from '../src/sim/run.js'
import { combosOf, growthOf, LEVELS } from '../src/sim/autoplay.js'
import { alive, tileAt, summonsOf } from '../src/sim/unit.js'
import { TUNING } from '../src/tuning.js'
import { on, scene, unit } from './scene.js'

const at = (x, y) => tileAt(x, y)
const rose = (b, rule) => b.events.filter((e) => e.type === 'arise' && e.rule === rule)

test('out of battle: a triple and a capstone are made as any recipe is, the result fresh', () => {
  const run = createRun({ start: START_PARTY, seed: 'graph' })
  run.state.essence = 1e4
  for (let i = 0; i < 2; i++) join(run, 'grave_ghoul')
  assert.ok(!canFuse(run, 'trine:grave_ghoul'), 'two are no triple')
  join(run, 'grave_ghoul')
  assert.ok(legalActions(run).some((a) => a.type === 'fuse' && a.id === 'trine:grave_ghoul'))
  apply(run, { type: 'fuse', id: 'trine:grave_ghoul', parts: fuseParts(run, 'trine:grave_ghoul') })
  const trine = souls(run.state.party).find((u) => u.id === 'trine:grave_ghoul')
  assert.deepEqual([trine.lvl, trine.tracks], [TUNING.level.base, [0, 0]], 'fresh: its first level, no tier')
  assert.equal(fuseCost(run, 'trine:grave_ghoul'), 8 * UNITS['trine:grave_ghoul'].tier)
  // The Charnel Cathedral: a Bone Colossus and the trine.
  assert.ok(!canFuse(run, 'charnel_cathedral'))
  join(run, 'bone_colossus')
  const before = run.state.essence
  apply(run, { type: 'fuse', id: 'charnel_cathedral', parts: fuseParts(run, 'charnel_cathedral') })
  assert.equal(before - run.state.essence, fuseCost(run, 'charnel_cathedral'))
  assert.ok(souls(run.state.party).some((u) => u.id === 'charnel_cathedral') && !souls(run.state.party).some((u) => u.id === 'bone_colossus' || u.id === 'trine:grave_ghoul'))
})

test('a trine\'s summon tier calls up the kind it was made of, at its level and tiers', () => {
  const b = scene([on('monarch', 0, 'party', 0, 0), on('trine:bone_chanter', 1, 'party', 3, 3, 4, [0, 2]), on('iron_golem', 9, 'foe', 6, 10)])
  const called = b.units.filter((u) => u.summoner === 1)
  assert.deepEqual(called.map((u) => [u.id, u.lvl, u.summoned, u.tracks.join()]), [['bone_chanter', 4, true, '0,2'], ['bone_chanter', 4, true, '0,2']])
})

// The expert's sketch (autoplay.js strength, worth) reads a summon as a whole one of the kind it is, at the root of a
// summon's share of HP: a kind's own as the soul itself, a trine's as the kind it was made of (the first bug hunt,
// 2026-10-15: it read a trine's as trines, a Bone Chanter Trine's two Chanters at 4.75 times their worth).
test('the sketch reads a trine\'s summons as the kind they are, at its level and tiers; a kind\'s own as itself', () => {
  const k = Math.sqrt(TUNING.summon.hp)
  // One soul alone, whole, its kind two tiers up Marrowcaller (two summons), and the field's strength with them and,
  // under the summons ablation, without.
  const alone = (id) => {
    const run = createRun({ seed: 'summoned', start: [id] })
    run.state.essence = 1e4
    for (let i = 0; i < 2; i++) apply(run, { type: 'upgrade', uid: souls(run.state.party)[0].uid, track: 1 })
    return run.state
  }
  const strength = (s, summons = true) => Math.exp(growthOf(s, summons ? LEVELS.expert : { ...LEVELS.expert, ablate: 'summons' }).strength)
  const chanter = alone('bone_chanter')
  const trine = alone('trine:bone_chanter')
  for (const s of [chanter, trine]) assert.deepEqual([summonsOf(souls(s.party)[0]), souls(s.party)[0].tracks], [2, [0, 2]])
  assert.equal(souls(chanter.party)[0].lvl, souls(trine.party)[0].lvl)
  // A Bone Chanter's two are Bone Chanters: as much again each, at the root of a summon's share.
  assert.ok(Math.abs(strength(chanter) / strength(chanter, false) - (1 + 2 * k)) < 1e-9)
  // The trine's two are Bone Chanters too, at its level and tiers: the Chanter's own worth each, not the trine's.
  const want = strength(trine, false) + 2 * k * strength(chanter, false)
  assert.ok(Math.abs(strength(trine) - want) < 1e-9 * want, `${strength(trine)} against ${want}`)
})

test('the Charnel Cathedral: a foe it slays beside it rises as yours; one slain by another, or not beside it, does not', () => {
  const units = [on('monarch', 0, 'party', 0, 0), on('charnel_cathedral', 1, 'party', 3, 5), on('tomb_knight', 2, 'party', 6, 6),
    on('grave_ghoul', 9, 'foe', 3, 7, 1), on('grave_ghoul', 10, 'foe', 6, 7, 1), on('iron_golem', 11, 'foe', 0, 10, 20)]
  const b = scene(units, { ablate: ['summons'] })
  const slain = unit(b, 9)
  slain.hp = 1
  perform(b, unit(b, 1), unit(b, 1).basic, slain)
  assert.ok(!alive(slain))
  assert.deepEqual(rose(b, 'charnel_cathedral').map((e) => [e.corpse, e.unit.side, e.unit.id]), [[9, 'party', 'grave_ghoul']])
  // The Knight's kill is the Knight's.
  unit(b, 10).hp = 1
  perform(b, unit(b, 2), unit(b, 2).basic, unit(b, 10))
  assert.equal(rose(b, 'charnel_cathedral').length, 1)
  // A Bone Colossus beside it raises none.
  const c = scene(units.map((u) => (u.id === 'charnel_cathedral' ? { ...u, id: 'bone_colossus' } : u)), { ablate: ['summons'] })
  unit(c, 9).hp = 1
  perform(c, unit(c, 1), unit(c, 1).basic, unit(c, 9))
  assert.ok(!alive(unit(c, 9)) && !c.events.some((e) => e.type === 'arise'))
})

test('the Cinder Wyrm: a foe it slays sets every foe next to it Burning, laid by it; a burn it laid that slays spreads again', () => {
  const b = scene([on('monarch', 0, 'party', 0, 0), on('cinder_wyrm', 1, 'party', 3, 4),
    on('grave_ghoul', 9, 'foe', 3, 8, 1), on('grave_ghoul', 10, 'foe', 2, 8, 9), on('grave_ghoul', 11, 'foe', 4, 9, 9), on('grave_ghoul', 12, 'foe', 6, 10, 9)], { ablate: ['summons'] })
  const wyrm = unit(b, 1)
  unit(b, 9).hp = 1
  perform(b, wyrm, wyrm.kit.find((a) => a.id === 'wyrm_fire'), unit(b, 9))
  const burning = (uid) => unit(b, uid).statuses.find((s) => s.id === 'burning')
  assert.ok(burning(10) && burning(11) && !burning(12), 'its neighbours alight, no one else')
  assert.equal(burning(10).by, 1)
  // Its burn slays the next: the fire goes on to the slain one's neighbours.
  unit(b, 12).tile = at(1, 8)
  b.at[at(6, 10)] = null
  b.at[at(1, 8)] = unit(b, 12)
  unit(b, 10).hp = 1
  applyDamage(b, unit(b, 10), 5, { actor: wyrm, status: 'burning' })
  assert.ok(!alive(unit(b, 10)) && burning(12), 'spread again')
})

test('the Hive Mind: drones hatch beside it as the battle begins and as each later wave enters, while it stands and its side has room; one it slays has its skills ready again', () => {
  const b = scene([on('monarch', 0, 'party', 0, 0), on('hive_mind', 1, 'party', 3, 4), on('grave_ghoul', 9, 'foe', 3, 6, 1), on('iron_golem', 11, 'foe', 0, 10, 20)])
  const drones = () => b.units.filter((u) => u.summoner === 1 && u.id === 'hive_drone')
  assert.equal(drones().length, 2)
  assert.ok(drones().every((u) => u.summoned && u.shadow && u.side === 'party' && u.maxHp < UNITS.hive_drone.base.hp * 2))
  call(b, 'onWave', 'party', { wave: 2 })
  assert.equal(drones().length, 4)
  const mind = unit(b, 1)
  mind.cooldowns.hive_scythe = 2
  unit(b, 9).hp = 1
  perform(b, mind, mind.basic, unit(b, 9))
  assert.equal(mind.cooldowns.hive_scythe, 0, 'ready again')
  // Fallen, it hatches no more.
  mind.hp = 0
  call(b, 'onWave', 'party', { wave: 3 })
  assert.equal(drones().length, 4)
})

test('the Engine of Ages: the first damage each battle that would fell it leaves it at 1 HP; the next fells it', () => {
  const b = scene([on('monarch', 0, 'party', 0, 0), on('engine_of_ages', 1, 'party', 3, 4), on('iron_golem', 9, 'foe', 3, 9, 20)], { ablate: ['summons'] })
  const engine = unit(b, 1)
  applyDamage(b, engine, engine.hp + 100, { actor: unit(b, 9) })
  assert.equal(engine.hp, 1)
  assert.ok(b.events.some((e) => e.type === 'rule' && e.rule === 'engine_of_ages'))
  applyDamage(b, engine, 5, { actor: unit(b, 9) })
  assert.ok(!alive(engine))
})

test('the book: every recipe a combo of its own, a fused part met on the floor its parts are, a capstone\'s on its parts\' parts\'', () => {
  const combos = combosOf()
  for (const r of FUSION_LIST) assert.ok(combos.some((c) => c.fuse === r.id), r.id)
  const from = (id) => combos.find((c) => c.fuse === id).from
  // The Tomb Knight met from floor 2 (2026-10-18): the Bone Colossus and the Charnel Cathedral from there.
  assert.deepEqual(['charnel_cathedral', 'winter_court', 'hive_mind', 'engine_of_ages', 'iron_barrow'].map(from), [2, 1, 2, 2, 2])
  assert.equal(from('bone_colossus'), 2)
  assert.equal(from(trineOf('ash_wyvern').id), 3)
  assert.equal(FUSION_LIST.filter(isTriple).length, 41)
})
