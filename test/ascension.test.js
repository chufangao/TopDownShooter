// The ascension ladder (redesign.md §4.6, §6 Step 7): TUNING.ascension's rows, a run's level and what it reaches (every
// foe, the boss and the foes' shadows too; a fight's and an elite's counts; the waves' spacing; the Monarch's HP; the
// prices), level 0 the base game, replay at a level, the unlock rule, and the ladder report's shape.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  createRun, replay, battleSetup, foeMods, foeScale, waveEvery, monarchBase, monarchHp, monarchOf, priceScale, roomSize, ascensionOf,
  ascensionTop, openTo, clearAt, drawRoom, tierCost, recruitCost, fuseCost, relicPrice, floorPrice, START_PARTY
} from '../src/sim/run.js'
import { createBattle, enterBattle, stats, entryTurn } from '../src/sim/turns.js'
import { makeUnit, tileAt, DEPTH } from '../src/sim/unit.js'
import {
  autoplay, record, RUNGS, ascensionsOf, ladderJobs, ladderTable, ladderLines, ladderRecord, buildJobs, auditRecord
} from '../src/sim/autoplay.js'
import { configOf } from '../src/sim/outside.js'
import { FUSION_LIST, UNITS } from '../src/content.js'
import { TUNING } from '../src/tuning.js'
import { on, scene, turns } from './scene.js'

const TOP = ascensionTop()
const F = TUNING.run.floors
const KEYS = ['foeHp', 'foeAtk', 'fight', 'elite', 'every', 'monarchHp', 'price']
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} against ${b}`)

test('the rows: level 0 every multiplier 1, the top the placeholders, each between on the straight line to it', () => {
  const rows = TUNING.ascension
  assert.ok(TOP >= 5, 'a ladder of levels')
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), KEYS.slice().sort())
  assert.ok(KEYS.every((k) => rows[0][k] === 1), 'level 0 is the base game')
  for (const k of KEYS) {
    for (let a = 1; a <= TOP; a++) {
      near(rows[a][k], 1 + (rows[TOP][k] - 1) * a / TOP, `${k} at ${a}`)
      // Every step a little harder: more of the foes, sooner waves, a frailer Monarch, dearer prices.
      assert.ok(k === 'every' || k === 'monarchHp' ? rows[a][k] <= rows[a - 1][k] : rows[a][k] >= rows[a - 1][k], `${k} at ${a}`)
    }
  }
  assert.ok(rows[TOP].foeHp > 1 && rows[TOP].every < 1 && rows[TOP].monarchHp < 1 && rows[TOP].price > 1)
})

test('level 0 is the base game: no field on the run, the setup and the numbers as without a level', () => {
  const base = createRun({ seed: 'asc0' })
  const zero = createRun({ seed: 'asc0', ascension: 0 })
  assert.ok(!('ascension' in base.state))
  assert.deepEqual(zero.state, base.state)
  const s = base.state
  assert.deepEqual(foeScale(s), { hp: 1, atk: 1 })
  for (const floor of [1, 2, 3, 4, 6]) for (const boss of [false, true]) assert.deepEqual(foeMods(floor, boss, foeScale(s)), foeMods(floor, boss))
  assert.deepEqual([waveEvery(s), monarchBase(s), monarchHp(s), monarchOf(s).maxHp], [TUNING.spawn.waves.every, TUNING.monarch.hp, TUNING.monarch.hp, TUNING.monarch.hp])
  for (let floor = 1; floor <= 4; floor++) {
    assert.deepEqual([roomSize(floor, false), roomSize(floor, true)], [TUNING.spawn.fight[floor - 1], TUNING.spawn.elite[floor - 1]])
    assert.equal(priceScale({ ...s, floor }), floorPrice(floor))
  }
  // A battle's setup carries no spacing of its own; and a run played at 0 is the one played without a level.
  const run = createRun({ seed: 'asc0', start: START_PARTY })
  run.state.at = run.state.map.nodes.find((n) => n.rank === 1).id
  assert.ok(!('every' in battleSetup(run)))
  const a = autoplay(createRun({ seed: 'asc0-b' }), { level: 'basic' })
  const b = autoplay(createRun({ seed: 'asc0-b', ascension: 0 }), { level: 'basic' })
  assert.deepEqual(b.state.log, a.state.log)
  const r = record({ seed: 'asc0-b', level: 'basic' })
  assert.ok(!('ascension' in r))
})

test('a level is the run\'s from its start: its field, checked, and a record of its runs carries it', () => {
  assert.equal(createRun({ seed: 'lv', ascension: 3 }).state.ascension, 3)
  for (const bad of [-1, TOP + 1, 1.5, '2', null]) assert.throws(() => createRun({ seed: 'lv', ascension: bad }), /ascension/)
  assert.equal(record({ seed: 'lv-0', level: 'basic', ascension: 2 }).ascension, 2)
  assert.equal(configOf({ ascension: 4 }).ascension, 4)
  assert.throws(() => configOf({ ascension: TOP + 1 }), /ascension/)
  assert.ok(buildJobs({ commits: [], runs: 2, ascension: 3 }).every((j) => j.ascension === 3))
})

test('a level reaches every foe: the formation, the boss, a wave come in and a foe\'s shadow, HP and ATK × its row', () => {
  const s = createRun({ seed: 'foes', ascension: TOP }).state
  const row = ascensionOf(s)
  assert.deepEqual(foeScale(s), { hp: row.foeHp, atk: row.foeAtk })
  // The setup's mods, a fight's and the boss's (the boss's own and its court's): each the base's × the row.
  for (const [floor, boss] of [[1, false], [3, false], [4, true]]) {
    const base = foeMods(floor, boss)
    const mods = foeMods(floor, boss, foeScale(s))
    assert.equal(mods.length, base.length)
    mods.forEach((m, i) => near(m.v, base[i].v * (m.path === 'hp' ? row.foeHp : row.foeAtk), `floor ${floor} ${m.path}${m.who ? ` boss ${m.who.boss}` : ''}`))
  }
  const run = createRun({ seed: 'foes', ascension: TOP, start: START_PARTY })
  run.state.at = run.state.map.nodes.find((n) => n.rank === 1).id
  assert.deepEqual(battleSetup(run).foeMods, foeMods(1, false, foeScale(s)))
  // In battle: the Sovereign and a ghoul of its court, a knight of a later wave once it enters, and a shadow raised on
  // their side (a Legion's), each against the same battle at the base.
  const fightAt = (mods) => scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 0, 9), on('hollow_sovereign', 10, 'foe', 3, 10, 7), on('grave_ghoul', 11, 'foe', 5, 10, 7)], {
    foeMods: mods, boss: true, floor: 4, every: 2, reserve: [{ ...makeUnit('tomb_knight', { uid: 20, lvl: 7 }), side: 'foe', wave: 1, lane: 1 }]
  })
  const base = fightAt(foeMods(4, true))
  const high = fightAt(foeMods(4, true, foeScale(s)))
  turns(base, 2)
  turns(high, 2)
  for (const b of [base, high]) enterBattle(b, { ...makeUnit('grave_ghoul', { uid: 30, lvl: 7 }), side: 'foe', shadow: true, tile: tileAt(6, DEPTH - 2) })
  for (const uid of [10, 11, 20, 30]) {
    const [x, y] = [base, high].map((b) => b.byUid.get(uid))
    assert.ok(x && y, `${uid} on the board`)
    near(stats(high, y).hp / stats(base, x).hp, row.foeHp, `${y.id} HP`)
    near(stats(high, y).atk / stats(base, x).atk, row.foeAtk, `${y.id} ATK`)
    assert.ok(y.maxHp > x.maxHp, `${y.id}'s max HP`)
  }
  // The Monarch and yours take none of it.
  for (const uid of [0, 1]) assert.deepEqual(stats(high, high.byUid.get(uid)), stats(base, base.byUid.get(uid)))
})

test('a level\'s counts and waves: a fight\'s and an elite\'s foes × its row, its waves on its spacing', () => {
  const sp = TUNING.spawn
  for (let a = 0; a <= TOP; a++) {
    for (let floor = 1; floor <= 4; floor++) {
      assert.equal(roomSize(floor, false, a), Math.round(sp.fight[floor - 1] * TUNING.ascension[a].fight))
      assert.equal(roomSize(floor, true, a), Math.round(sp.elite[floor - 1] * TUNING.ascension[a].elite))
    }
  }
  assert.ok(roomSize(4, false, TOP) > roomSize(4, false) && roomSize(4, true, TOP) > roomSize(4, true))
  // Floor 1's rooms have no cohorts: a fight's formation is its count, an elite's too, its late pair a wave of its own;
  // its boss's court, as the Sovereign's, is the floor's at every level (redesign.md §4.7). The rooms are drawn as the
  // floor opens: a run from the fixed start here, not the draft.
  const run = createRun({ seed: 'counts', ascension: TOP, start: START_PARTY })
  const rooms = run.state.map.nodes.filter((n) => n.foes && n.type !== 'boss')
  assert.ok(rooms.some((n) => n.type === 'fight') && rooms.some((n) => n.type === 'elite'))
  for (const n of rooms) {
    assert.equal(n.foes.length, roomSize(1, n.type === 'elite', TOP), `${n.id} ${n.type}`)
    if (n.type === 'elite') assert.deepEqual(n.waves.map((w) => w.foes.length), [sp.late.n])
  }
  assert.equal(run.state.map.nodes.find((n) => n.type === 'boss').foes.length, 1 + sp.court[0])
  // The same draw, its count aside: a level's room is drawn on the room's own stream.
  const node = { id: 'x', type: 'fight', rank: 2 }
  assert.deepEqual(drawRoom('counts', 1, node, { ascension: 0 }), drawRoom('counts', 1, node))
  // The waves: the setup carries the level's spacing where it is not the base's, and the battle's waves come on it.
  const s = run.state
  const every = waveEvery(s)
  assert.equal(every, Math.max(1, Math.round(sp.waves.every * ascensionOf(s).every)))
  assert.ok(every < sp.waves.every, 'sooner at the top')
  const elite = rooms.find((n) => n.type === 'elite')
  const r = createRun({ seed: 'counts', ascension: TOP, start: START_PARTY })
  r.state.at = elite.id
  const setup = battleSetup(r)
  assert.equal(setup.every, every)
  const b = createBattle(setup)
  assert.deepEqual(b.waves.map((w) => w.turn), [1 + every])
  assert.equal(entryTurn({ wave: 2 }, every), 1 + 2 * every)
  const late = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 0, 0, 9), on('grave_ghoul', 10, 'foe', 3, 10, 1)], {
    every, reserve: [{ ...makeUnit('frost_sprite', { uid: 70, lvl: 1 }), side: 'foe', wave: 1, lane: 1 }]
  })
  while (late.turn < every) assert.ok(!turns(late).some((e) => e.type === 'wave'), 'nothing before its turn')
  assert.ok(turns(late).some((e) => e.type === 'wave'))
  assert.equal(late.foeIn, 1 + every)
})

test('a level\'s Monarch: its base HP × the row, its HP relics on top, in battle as in the run', () => {
  const s = createRun({ seed: 'mon', ascension: TOP }).state
  const base = Math.round(TUNING.monarch.hp * ascensionOf(s).monarchHp)
  assert.ok(base < TUNING.monarch.hp)
  assert.deepEqual([monarchBase(s), monarchHp(s), monarchOf(s).hp, monarchOf(s).maxHp], [base, base, base, base])
  assert.equal(monarchHp({ ...s, relics: ['grave_shroud'] }), base + 30)
  const run = createRun({ seed: 'mon', ascension: TOP, start: START_PARTY })
  run.state.at = run.state.map.nodes.find((n) => n.rank === 1).id
  const b = createBattle(battleSetup(run))
  assert.deepEqual([b.monarch.hp, b.monarch.maxHp], [base, base])
})

test('a level\'s prices: a tier, a recruit, a fusion and a relic, each the base\'s × the row, rounded', () => {
  for (const a of [0, Math.ceil(TOP / 2), TOP]) {
    const run = createRun({ seed: 'price', ascension: a, start: START_PARTY })
    const s = run.state
    const row = TUNING.ascension[a]
    for (const floor of [1, 3]) {
      s.floor = floor
      const at = (base) => Math.max(1, Math.round(base * floorPrice(floor) * row.price))
      assert.equal(tierCost(run, 'tomb_knight', 0), at(TUNING.essence.tier[0]), `tier, level ${a} floor ${floor}`)
      assert.equal(recruitCost(run, 'tomb_knight', 1), at(TUNING.essence.recruit * UNITS.tomb_knight.tier), `recruit, level ${a}`)
      const r = FUSION_LIST[0]
      assert.equal(fuseCost(run, r.id), at(TUNING.essence.fuse * UNITS[r.result].tier), `fusion, level ${a}`)
      assert.equal(relicPrice(run, 'whetstone'), at(TUNING.shop.price.common), `relic, level ${a}`)
      near(priceScale(s), floorPrice(floor) * row.price, 'the price scale')
    }
  }
  assert.ok(tierCost(createRun({ seed: 'p', ascension: TOP, start: START_PARTY }), 'tomb_knight', 0) > TUNING.essence.tier[0])
})

test('replay at a level: the same run again, and the level is part of it', () => {
  const run = autoplay(createRun({ seed: 'rep-asc', ascension: TOP }), { level: 'basic' })
  const again = replay('rep-asc', run.state.log, { ascension: TOP })
  assert.equal(JSON.stringify(again.state), JSON.stringify(run.state))
  let other = null
  try { other = JSON.stringify(replay('rep-asc', run.state.log).state) } catch {}
  assert.notEqual(other, JSON.stringify(run.state), 'the log at another level is another run (or none)')
})

test('the unlock rule: level 0 always open, a level opened by each clear of the one below, never past the top', () => {
  assert.equal(openTo(-1), 0)
  assert.equal(openTo(0), 1)
  assert.equal(openTo(TOP - 1), TOP)
  assert.equal(openTo(TOP), TOP)
  assert.deepEqual(clearAt(-1, 0), { cleared: 0, opened: 1 })
  assert.deepEqual(clearAt(0, 1), { cleared: 1, opened: 2 })
  assert.deepEqual(clearAt(3, 1), { cleared: 3, opened: null }, 'a level below the highest cleared opens nothing')
  assert.deepEqual(clearAt(3, 3), { cleared: 3, opened: null }, 'nor the highest again')
  assert.deepEqual(clearAt(TOP - 2, TOP - 1), { cleared: TOP - 1, opened: TOP })
  assert.deepEqual(clearAt(TOP - 1, TOP), { cleared: TOP, opened: null }, 'the top opens nothing more')
})

test('the ladder report\'s shape: the levels a --ascension names, a job a rung a level a seed, a row a level and rung with its gap', async () => {
  assert.deepEqual(ascensionsOf('all'), Array.from({ length: TOP + 1 }, (_, k) => k))
  assert.deepEqual(ascensionsOf('0'), [0])
  assert.deepEqual(ascensionsOf('0,5'), [0, 5])
  for (const bad of [String(TOP + 1), '-1', 'x', '1.5', '']) assert.throws(() => ascensionsOf(bad), /ascension/)
  assert.deepEqual(RUNGS, ['basic', 'calc', 'expert', 'teacher'])
  const jobs = ladderJobs({ ascensions: [0, 3], rungs: ['basic', 'calc'], runs: 2, seed: 'l' })
  assert.deepEqual(jobs.map((j) => [j.ascension, j.player, j.seed]), [[0, 'basic', 'l-0'], [0, 'basic', 'l-1'], [0, 'calc', 'l-0'], [0, 'calc', 'l-1'], [3, 'basic', 'l-0'], [3, 'basic', 'l-1'], [3, 'calc', 'l-0'], [3, 'calc', 'l-1']])
  assert.ok(jobs.every((j) => j.ladder))
  // Records as the rungs leave them (only the fields the table reads): at 0 the order kept, at 5 the expert below the
  // calculator on one seed.
  const rec = (player, ascension, i, result, floor, progress, battles) => ({ seed: `l-${i}`, player, ascension, result, floor, progress, battles: Array.from({ length: battles }, (_, k) => ({ won: k < battles - 1 || result === 'victory' })), secs: 1 })
  const records = [
    rec('basic', 0, 0, 'defeat', 1, 0.05, 2), rec('basic', 0, 1, 'defeat', 1, 0.04, 2),
    rec('calc', 0, 0, 'defeat', 2, 0.3, 12), rec('calc', 0, 1, 'defeat', 1, 0.1, 6),
    rec('expert', 0, 0, 'victory', F, 1, 50), rec('expert', 0, 1, 'defeat', F, 0.8, 40),
    rec('basic', 5, 0, 'defeat', 1, 0.02, 1), rec('basic', 5, 1, 'defeat', 1, 0.02, 1),
    rec('calc', 5, 0, 'defeat', 1, 0.2, 4), rec('calc', 5, 1, 'defeat', 1, 0.1, 3),
    rec('expert', 5, 0, 'defeat', 1, 0.1, 3), rec('expert', 5, 1, 'defeat', 1, 0.15, 4)
  ]
  const t = ladderTable(records.slice().reverse(), { ascensions: [0, 5], rungs: ['basic', 'calc', 'expert'], runs: 2, seed: 'l' })
  assert.deepEqual(t.rows.map((r) => [r.ascension, r.rung, r.below]), [[0, 'basic', null], [0, 'calc', 'basic'], [0, 'expert', 'calc'], [5, 'basic', null], [5, 'calc', 'basic'], [5, 'expert', 'calc']])
  const ex = t.rows[2]
  assert.deepEqual([ex.runs, ex.clears, ex.deaths, ex.battles, ex.won, ex.lost], [2, 1, Array.from({ length: F }, (_, f) => (f === F - 1 ? 1 : 0)), 45, 1, 0])
  near(ex.progress, 90, 'progress in points')
  near(ex.diff, 70, 'the gap to the calculator')
  assert.ok(t.rows[0].diff === null && t.rows[0].won === null)
  assert.deepEqual(t.ordered, { 0: true, 5: false })
  const lines = ladderLines(t)
  assert.equal(lines.length, 2 + t.rows.length + 1)
  assert.ok(lines[1].includes(`died fl ${Array.from({ length: F }, (_, f) => f + 1).join('/')} `), `the run's floors: ${lines[1]}`)
  assert.ok(lines[0].includes('ascension 0, 5'))
  assert.ok(lines.some((l) => l.includes('calc → expert: +1 −0, +70.0')))
  assert.ok(lines.at(-1).includes('0 yes') && lines.at(-1).includes('5 NO'))
})

test('a ladder run at a level: basic\'s a record\'s, the calculator\'s its own, its readers put back after', async () => {
  const B = TUNING.expert.battle
  const was = [B.brink, B.peril]
  const calc = await ladderRecord({ seed: 'lad-0', player: 'calc', ascension: TOP })
  assert.deepEqual([B.brink, B.peril], was, 'the calculator\'s plain readers are its run\'s alone')
  assert.deepEqual([calc.player, calc.ascension, calc.seed], ['calc', TOP, 'lad-0'])
  assert.ok(calc.battles.length > 0 && calc.battles.every((b) => typeof b.won === 'boolean' && b.t > 0))
  assert.ok(calc.progress >= 0 && calc.progress <= 1 && Number.isInteger(calc.floor))
  const basic = await ladderRecord({ seed: 'lad-0', player: 'basic', ascension: TOP })
  assert.deepEqual([basic.player, basic.ascension], ['basic', TOP])
  assert.ok(Array.isArray(basic.battles) && 'progress' in basic && 'result' in basic)
  await assert.rejects(ladderRecord({ seed: 'lad-0', player: 'nobody' }), /unknown rung/)
})

// `--ascension <level>` plays any report at that level (autoplay.js's CLI): a paired report's runs and an audit's are
// the level's, as the ladder's and --builds' are (the second bug hunt: --paired, --ablations, --decisions, --necessity
// and --audit played the base game, the level read and dropped).
test('a report at a level plays its runs there: --paired and --audit as --builds and --ladder', () => {
  const runs = 2
  const at = (a) => Array.from({ length: runs }, (_, i) => record({ seed: `h2p-${i}`, level: 'basic', ascension: a }))
  const mean = (rs) => (100 * rs.reduce((n, r) => n + r.progress, 0) / runs).toFixed(1)
  const [base, top] = [at(0), at(TOP)]
  assert.notEqual(mean(top), mean(base), 'the seeds read the level')
  const out = execFileSync(process.execPath, ['src/sim/autoplay.js', '--paired', 'none,none', '--level', 'basic', '--runs', String(runs), '--seed', 'h2p', '--ascension', String(TOP), '--workers', '1'],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' })
  assert.ok(out.includes(`ascension ${TOP}`), out)
  const row = out.split('\n').find((l) => l.startsWith('a '))
  assert.equal(row.trim().split(/\s+/)[2], mean(top), out)
  const audit = auditRecord({ seed: 'h2p-0', level: 'basic', ascension: TOP })
  assert.equal(audit.ascension, TOP)
  assert.equal(audit.floor, top[0].floor)
})
