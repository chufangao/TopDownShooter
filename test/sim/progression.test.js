// XP and levelling (§3) — and the gate it exists to pass.
//
// Foes scale with floor depth from the first encounter (§6.2). The party's only answer is this
// system, so the load-bearing test at the bottom is not "does XP arithmetic work" but "can a run
// that gets no help from a hand-built party actually reach floor 4". Before this existed, it could
// not — every run died on floor 2 regardless of how well it was assembled.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks } from '../../tools/packsource.node.js'
import { makeParty, addRecruits, medianLevel, unitBaseStats } from '../../src/sim/party.js'
import { createBattle } from '../../src/sim/combat/battle.js'
import { awardXp, gainXp, xpToNext, levelCap, defeatXp, battleXp } from '../../src/sim/progression.js'
import { createRun, playRun } from '../../src/sim/run.js'

const { kernel, tuning } = await createGame({ packs: discoverPacks('packs'), seed: 1 })
const R = kernel.registry

const STARTERS = ['core:bone_chanter', 'core:tomb_knight', 'core:clockwork_page', 'core:frost_sprite']
const fresh = (ids = STARTERS, lvl = 1) => (kernel.defs.restore({ uid: 1 }), makeParty(kernel, ids, { lvl }))

// ── the curve ───────────────────────────────────────────────────────────────────────────────────

test('the level curve rises and is finite', () => {
  let last = 0
  for (let l = 1; l <= 10; l++) {
    const n = xpToNext(l, tuning)
    assert.ok(n > last, `level ${l} must cost more than ${l - 1}`)
    last = n
  }
  // The whole climb to 10 is a run's worth of fighting, not a grind — if this ever needs three
  // runs, the depth curve has outpaced the party again and floor 2 comes back.
  const total = Array.from({ length: 9 }, (_, i) => xpToNext(i + 1, tuning)).reduce((a, b) => a + b)
  assert.ok(total > 1000 && total < 5000, `cumulative XP to level 10 is ${total}`)
})

test('★1 caps at 10 and every fusion star buys five more', () => {
  assert.equal(levelCap(1, tuning), 10)
  assert.equal(levelCap(2, tuning), 15)
  assert.equal(levelCap(3, tuning), 20)
  assert.equal(levelCap(undefined, tuning), 10)
})

test('a defeat is worth more the higher the tier and the level', () => {
  const t1 = R.get('unit', 'core:frost_sprite')      // tier 1
  const t3 = R.get('unit', 'core:ember_drake')       // tier 3
  assert.ok(defeatXp(t3, 1, tuning) > defeatXp(t1, 1, tuning))
  assert.ok(defeatXp(t1, 6, tuning) > defeatXp(t1, 1, tuning))
})

test('a recruit is worth half a kill — you traded the XP for the unit', () => {
  const def = R.get('unit', 'core:ember_drake')
  assert.equal(defeatXp(def, 4, tuning, { recruited: true }),
    Math.round(defeatXp(def, 4, tuning) * tuning.xp.recruitShare))
})

// ── awarding ────────────────────────────────────────────────────────────────────────────────────

test('XP is per participant, not a pool split by headcount', () => {
  // The property that keeps levelling from fighting the acquisition loop: recruiting an 8th unit
  // must not slow down the seven already on the roster.
  const small = fresh(STARTERS.slice(0, 2))
  const large = fresh([...STARTERS, ...STARTERS])
  const foes = makeParty(kernel, ['core:frost_sprite', 'core:frost_sprite'], { side: 'foe', lvl: 1 })
  const battle = createBattle({ kernel, tuning, party: large, foes, seed: 1 })
  for (const u of battle.units) if (u.side === 'foe') u.hp = 0

  const base = battleXp(R, battle, tuning)
  const smallBattle = createBattle({ kernel, tuning, party: small, foes, seed: 1 })
  for (const u of smallBattle.units) if (u.side === 'foe') u.hp = 0

  assert.equal(battleXp(R, smallBattle, tuning), base)
})

test('participation, not kill credit — everyone who fought earns the same', () => {
  const party = fresh()
  const foes = makeParty(kernel, ['core:frost_sprite'], { side: 'foe', lvl: 1 })
  const battle = createBattle({ kernel, tuning, party, foes, seed: 1 })
  for (const u of battle.units) if (u.side === 'foe') u.hp = 0

  const { awards } = awardXp(kernel, party, battle, { tuning })
  assert.equal(awards.length, party.length)
  const gains = new Set(awards.map((a) => a.gained))
  assert.equal(gains.size, 1, 'a Vanguard that soaked the front row earns what the Ranger earned')
})

test('the fallen earn a half share, never zero', () => {
  const party = fresh()
  const foes = makeParty(kernel, ['core:ember_drake'], { side: 'foe', lvl: 3 })
  const battle = createBattle({ kernel, tuning, party, foes, seed: 1 })
  for (const u of battle.units) if (u.side === 'foe') u.hp = 0
  party[0].hp = 0

  const { awards } = awardXp(kernel, party, battle, { tuning })
  const dead = awards.find((a) => a.uid === party[0].uid)
  const live = awards.find((a) => a.uid === party[1].uid)
  assert.ok(dead.gained > 0, 'zeroing the fallen is a death spiral wearing a progression system')
  assert.equal(dead.gained, Math.round(live.gained * tuning.xp.fallenShare))
})

test('a lost fight still pays for what it killed on the way down', () => {
  const party = fresh()
  const foes = makeParty(kernel, ['core:frost_sprite', 'core:frost_sprite'], { side: 'foe', lvl: 1 })
  const battle = createBattle({ kernel, tuning, party, foes, seed: 1 })
  for (const u of battle.units) {
    if (u.side === 'foe' && u.slot === foes[0].slot) u.hp = 0
    if (u.side === 'party') u.hp = 0
  }
  battle.winner = 'foe'
  const { awards } = awardXp(kernel, party, battle, { tuning })
  assert.ok(awards.every((a) => a.gained > 0))
})

test('a unit that sat out the battle earns nothing', () => {
  // One `fresh` call, then split — two calls would reset the uid counter and hand the bench a uid
  // that is already on the field.
  const all = fresh([...STARTERS, 'core:hive_warden'])
  const benched = all[all.length - 1]
  const party = all.slice(0, -1)
  const foes = makeParty(kernel, ['core:frost_sprite'], { side: 'foe', lvl: 1 })
  const battle = createBattle({ kernel, tuning, party, foes, seed: 1 })
  for (const u of battle.units) if (u.side === 'foe') u.hp = 0

  const { awards } = awardXp(kernel, all, battle, { tuning })
  assert.ok(awards.length === party.length && !awards.some((a) => a.uid === benched.uid))
})

// ── levelling ───────────────────────────────────────────────────────────────────────────────────

test('levelling raises stats through the one growth formula', () => {
  const [u] = fresh(['core:tomb_knight'])
  const def = R.get('unit', u.defId)
  gainXp(R, u, xpToNext(1, tuning), tuning)
  assert.equal(u.lvl, 2)
  assert.equal(u.maxHp, Math.round(unitBaseStats(def, 2).hp))
})

test('levelling is not a stealth heal — HP carries across as a fraction', () => {
  const [u] = fresh(['core:tomb_knight'])
  u.hp = Math.round(u.maxHp * 0.2)
  const before = u.hp / u.maxHp
  gainXp(R, u, xpToNext(1, tuning) * 3, tuning)
  assert.ok(u.lvl > 1)
  assert.ok(Math.abs(u.hp / u.maxHp - before) < 0.02, 'a level-up must not be a second recovery channel')
})

test('the fallen stay fallen through a level-up', () => {
  const [u] = fresh(['core:tomb_knight'])
  u.hp = 0
  gainXp(R, u, xpToNext(1, tuning) * 2, tuning)
  assert.equal(u.hp, 0)
})

test('one award can cross several levels at once', () => {
  const [u] = fresh(['core:frost_sprite'])
  const enough = xpToNext(1, tuning) + xpToNext(2, tuning) + xpToNext(3, tuning)
  const rec = gainXp(R, u, enough, tuning)
  assert.equal(rec.from, 1)
  assert.equal(u.lvl, 4)
})

test('XP past the cap is banked, not discarded — fusion is what unlocks it', () => {
  const [u] = fresh(['core:frost_sprite'])
  gainXp(R, u, 1e6, tuning)
  assert.equal(u.lvl, levelCap(1, tuning))
  assert.ok(u.xp > 0, 'the levels it already earned must be waiting when a star raises the cap')

  u.star = 2
  gainXp(R, u, 0, tuning)
  assert.ok(u.lvl > levelCap(1, tuning), 'raising the cap should cash in the banked XP immediately')
})

// ── recruits land on the curve ──────────────────────────────────────────────────────────────────

test('the median is the median', () => {
  assert.equal(medianLevel([]), 1)
  assert.equal(medianLevel([{ lvl: 3 }]), 3)
  assert.equal(medianLevel([{ lvl: 1 }, { lvl: 9 }]), 5)
  assert.equal(medianLevel([{ lvl: 2 }, { lvl: 4 }, { lvl: 9 }]), 4)
})

test('a recruit joins at the party median, not at its foe level and not at 1', () => {
  const party = fresh(STARTERS, 6)
  const foes = makeParty(kernel, ['core:ember_drake'], { side: 'foe', lvl: 1 })
  const battle = createBattle({ kernel, tuning, party, foes, seed: 1 })
  const drake = battle.units.find((u) => u.side === 'foe')
  drake.hp = Math.ceil(drake.maxHp * 0.2)
  drake.left = true
  battle.recruited.push(drake.uid)

  const { joined } = addRecruits(kernel, party, battle, { tuning })
  assert.equal(joined.length, 1)
  assert.equal(joined[0].lvl, 6, 'joining at foe level hands out free veterans; joining at 1 is worthless')
  assert.equal(joined[0].maxHp, Math.round(unitBaseStats(R.get('unit', joined[0].defId), 6).hp))
  assert.ok(joined[0].hp > 0 && joined[0].hp <= joined[0].maxHp)
})

// ── the gate ────────────────────────────────────────────────────────────────────────────────────

/**
 * A whole run through the real loop. Nothing is reimplemented here — an earlier draft of this file
 * had to copy `DungeonScene.afterBattle` line for line to play a single floor, and that duplication
 * across the §8 boundary is what `sim/run.js` exists to delete.
 */
function play (seed, { maxFloors = 6 } = {}) {
  kernel.defs.restore({ uid: 1 })
  const run = createRun({ kernel, tuning, seed })
  const levelByFloor = new Map()
  playRun(run, {
    maxFloors,
    onReport: () => levelByFloor.set(run.state.floorNum, medianLevel(run.state.roster))
  })
  return { run, depth: run.state.deepest, levelByFloor }
}

test('★ the gate: a seeded run reaches floor 4 without a hand-built party (§17 M4)', () => {
  const SEEDS = 12
  let reached = 0
  for (let s = 0; s < SEEDS; s++) if (play(1000 + s).depth >= 4) reached++

  // Not every seed should survive — a roguelite where the default party always wins has no run
  // structure. But floor 2 must stop being a wall, which is the whole reason this system exists.
  assert.ok(reached >= SEEDS * 0.5,
    `only ${reached}/${SEEDS} seeded runs reached floor 4 — the party is not keeping pace with §6.2's depth curve`)
})

test('★ the party stays ahead of the depth curve until the ★1 cap bites', () => {
  // Averaged over seeds, because one run's median swings by a level on a single unlucky recruit.
  // The claim under test is the shape recorded in tuning.json: ahead through floor 5, behind by
  // floor 7 — the window where fusion stops being optional.
  const SEEDS = 10
  const seen = new Map()
  for (let s = 0; s < SEEDS; s++) {
    for (const [f, lvl] of play(2000 + s, { maxFloors: 5 }).levelByFloor) {
      seen.set(f, [...(seen.get(f) ?? []), lvl])
    }
  }

  for (const [f, lvls] of [...seen].sort((a, b) => a[0] - b[0])) {
    if (lvls.length < SEEDS / 2) continue                  // too few survivors to mean anything
    const avg = lvls.reduce((a, b) => a + b) / lvls.length
    const foeLvl = Math.max(1, Math.round(1 + (f - 1) * 1.5))   // what floor f actually throws at them
    assert.ok(avg >= foeLvl,
      `on floor ${f} the party averages level ${avg.toFixed(1)} against the level ${foeLvl} foes it is fighting`)
  }
})

test('levelling never breaks determinism — same seed, same levels', () => {
  const snapshot = () => play(77, { maxFloors: 3 }).run.state.roster
    .map((u) => `${u.defId}:${u.lvl}:${u.xp}:${u.hp}`).join('|')
  assert.equal(snapshot(), snapshot())
})
