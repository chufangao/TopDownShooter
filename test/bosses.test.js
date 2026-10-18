// A boss a floor: each floor's boss, the one that answers what the army leans on as the floor opens,
// its counter in its kit and in its rule; the elites that answer the army; the run's boss rooms as any boss's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { order, corpses, risable, addStatus, applyDamage, settle } from '../src/sim/turns.js'
import {
  createRun, apply, replay, legalActions, bossPool, bossFor, bossIn, leaningOf, leanings, LEANINGS, courtPool, foeMods, foeScale,
  roomThreats, unanswered, answerArmy, ANSWERS, routeThreats, ascensionTop, ascensionOf, souls, START_PARTY, currentNode, eliteBonus, foeEssence
} from '../src/sim/run.js'
import { RULES } from '../src/sim/rules.js'
import { floorOf, policy, LEVELS } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { TUNING } from '../src/tuning.js'
import { UNITS, UNIT_LIST, STATUSES, ABILITIES, THREATS } from '../src/content.js'
import { makeUnit, statsOf, alive, slotAt, CENTRE_OUT } from '../src/sim/unit.js'
import { on, scene, unit, slay } from './scene.js'
import { tuned, grant } from './tuned.js'

const F = TUNING.run.floors
const at = (list, floor) => list[Math.min(floor, list.length) - 1]
const FLOOR_BOSSES = ['mire_mother', 'molting_abbess', 'barrow_marshal', 'swarm_queen']
const souled = (ids) => ids.map((id, i) => makeUnit(id, { uid: i + 1, lvl: 2 }))

// ── the records ──────────────────────────────────────────────────────────────────────────────────

test('the floors\' bosses: one record each, tagged with the floors before the last, one for each counter; the Sovereign the last floor\'s', () => {
  assert.deepEqual(UNIT_LIST.filter((u) => u.boss && !u.last).map((u) => u.id), FLOOR_BOSSES)
  assert.deepEqual(UNIT_LIST.filter((u) => u.last).map((u) => u.id), ['hollow_sovereign'])
  // One for each counter of: casters, statuses, shooters, walls.
  assert.deepEqual(FLOOR_BOSSES.map((id) => UNITS[id].answers).sort(), LEANINGS.slice().sort())
  for (const id of FLOOR_BOSSES) {
    const d = UNITS[id]
    assert.ok(d.boss && !d.spawn && !d.tracks && !d.fused && d.tier === 4, `${id}: a boss`)
    assert.ok(d.floors.length && d.floors.every((f) => Number.isInteger(f) && f >= 1 && f < F), `${id}: floors ${d.floors}`)
    assert.ok(d.name.startsWith('The '), `${id}: its name reads "The …" on its banners`)
    // Its pictures borrowed from a kind the foes bring, never a capstone's lender (drawn washed and bigger: codex.test.js).
    assert.ok(d.art !== id && UNITS[d.art].spawn && UNITS[d.art].art === d.art, `${id}: art`)
    assert.ok(!UNIT_LIST.some((u) => u.fused && !u.trineOf && u.art === d.art), `${id}: its lender no capstone's`)
    // One phase or two, each a status; its rule in the registry where it has one.
    assert.ok(d.phases?.length >= 1 && d.phases.every((p) => STATUSES[p.grant] && p.at > 0 && p.at < 1), `${id}: phases`)
    if (d.rule) assert.ok(RULES[d.rule] && !RULES[d.rule].grants, `${id}: its rule`)
    // Its court resolves on every floor it may end: foes the pool spawns, never a boss.
    for (const f of d.floors) {
      const c = courtPool(f, d.court)
      assert.ok(c.units.length && c.units.every((u) => u.spawn && !u.boss) && c.weights.every((w) => w > 0), `${id} floor ${f}: court`)
    }
  }
  // Each floor before the last has its pool; the last the Sovereign; the deep none.
  for (let f = 1; f < F; f++) assert.ok(bossPool(f).length >= 3, `floor ${f}: ${bossPool(f).map((u) => u.id)}`)
  assert.deepEqual(bossPool(F).map((u) => u.id), ['hollow_sovereign'])
  assert.deepEqual(bossPool(F + 1), [])
  // The counters, in their kits: a court and two skills that Hex; Molt and Purge, and a rule; a rule that screens and a
  // court of Vanguards before it; it flies with a court of flyers.
  const hexes = (a) => ABILITIES[a].effects.some((e) => e.status === 'hexed')
  assert.ok(UNITS.mire_mother.abilities.filter(hexes).length >= 2 && UNITS.mire_mother.court.kinds.every((k) => UNITS[k].abilities.some(hexes)))
  assert.ok(['molt', 'purge'].every((a) => UNITS.molting_abbess.abilities.includes(a)) && UNITS.molting_abbess.court.kinds.every((k) => UNITS[k].abilities.includes('purge')))
  assert.ok(UNITS.barrow_marshal.court.role === 'vanguard' && UNITS.barrow_marshal.court.front && UNITS.barrow_marshal.role !== 'vanguard')
  assert.ok(UNITS.swarm_queen.flies && UNITS.swarm_queen.court.kinds.every((k) => UNITS[k].flies))
})

// ── which boss a floor meets ─────────────────────────────────────────────────────────────────────

test('what a soul leans on: a Channeler casts, a Ranger or a shot shoots, a blow that lays a debuff is statuses, melee alone on the ground a wall', () => {
  const lean = (id, tracks = [0, 0]) => leaningOf(makeUnit(id, { lvl: 1, tracks }))
  assert.deepEqual(['will_o_wisp', 'bone_chanter', 'pale_court', 'winter_court', 'trine:bone_chanter'].map((id) => lean(id)), Array(5).fill('casters'))
  assert.deepEqual(['ember_drake', 'rime_drake', 'frost_wyrm'].map((id) => lean(id)), Array(3).fill('shooters'))
  assert.equal(lean('frost_sprite'), 'shooters', 'a lance from range down a line')
  assert.equal(lean('frost_sprite', [3, 0]), 'statuses', 'its Shatter Lance leaves Brittle')
  assert.deepEqual(['grave_ghoul', 'pyre_hound', 'mantis_reaper'].map((id) => lean(id)), Array(3).fill('statuses'))
  assert.deepEqual(['tomb_knight', 'clockwork_page', 'hive_warden', 'bone_colossus'].map((id) => lean(id)), Array(4).fill('walls'))
  assert.equal(lean('hive_drone'), null, 'a flyer is no wall')
  assert.deepEqual(leanings(souled(['will_o_wisp', 'tomb_knight', 'hive_drone'])), { casters: 1, shooters: 0, statuses: 0, walls: 1 })
})

test('a floor\'s boss answers what the army leans on most; a tie, or an army leaning on nothing, drawn by the seed; the last floor the Sovereign whatever the army', () => {
  const armies = {
    casters: ['will_o_wisp', 'bone_chanter', 'frost_sprite'],
    statuses: ['pyre_hound', 'grave_ghoul', 'tomb_knight'],
    shooters: ['frost_sprite', 'frost_sprite', 'clockwork_page'],
    walls: ['tomb_knight', 'hive_warden', 'grave_ghoul', 'clockwork_page']
  }
  for (const [word, ids] of Object.entries(armies)) {
    for (let f = 1; f < F; f++) {
      for (const seed of ['b0', 'b1', 'b2']) {
        const b = bossFor(seed, f, souled(ids))
        assert.deepEqual([UNITS[b.id].answers, b.lean], [word, word], `${word} floor ${f} ${seed}`)
      }
    }
  }
  // A tie (a caster, a shooter, a wall): the seed draws among the tied, the same every time; none is drawn outside it.
  const tied = souled(['bone_chanter', 'frost_sprite', 'tomb_knight'])
  const drawn = new Set()
  for (let i = 0; i < 40; i++) {
    const b = bossFor(`tie${i}`, 1, tied)
    assert.deepEqual(bossFor(`tie${i}`, 1, tied), b)
    assert.ok(['casters', 'shooters', 'walls'].includes(b.lean) && UNITS[b.id].answers === b.lean, JSON.stringify(b))
    drawn.add(b.id)
  }
  assert.deepEqual([...drawn].sort(), ['barrow_marshal', 'mire_mother', 'swarm_queen'])
  // No army (or one leaning on nothing a boss answers): the whole pool, by the seed, and no lean.
  const any = new Set()
  for (let i = 0; i < 60; i++) {
    const b = bossFor(`none${i}`, 1, souled(['hive_drone']))
    assert.equal(b.lean, null)
    assert.deepEqual(b, bossFor(`none${i}`, 1))
    any.add(b.id)
  }
  assert.deepEqual([...any].sort(), FLOOR_BOSSES.slice().sort())
  assert.deepEqual(bossFor('x', F, souled(armies.casters)), { id: 'hollow_sovereign', lean: null })
  assert.equal(bossFor('x', F + 1, souled(armies.casters)), null)
})

test('a boss a floor: floors 1 and 2 end in a floor\'s boss and its court, the last in the Sovereign\'s siege, the deep in a big elite; drawn as the floor opens, on the army, and the map shows it', () => {
  for (let i = 0; i < 12; i++) {
    const seed = `bf${i}`
    for (let f = 1; f <= F + 1; f++) {
      const map = floorOf(seed, f)
      const end = map.nodes.find((n) => n.id === map.end)
      assert.equal(end.type, f <= F ? 'boss' : 'elite', `${seed} floor ${f}`)
      if (f > F) continue
      const id = bossIn(end)
      assert.equal(id, bossFor(seed, f).id, `${seed} floor ${f}: the seed's boss`)
      const d = UNITS[id]
      const forms = [end.foes, ...(end.waves ?? []).map((w) => w.foes)]
      const court = forms.at(-1)
      assert.equal(court.length, 1 + at(TUNING.spawn.court, f), `${seed} floor ${f}: the boss and its court`)
      assert.equal(court[0].id, id)
      assert.ok(court.slice(1).every((x) => courtPool(f, d.court).units.some((u) => u.id === x.id)), `${seed} floor ${f}: its court's kinds`)
      if (f < F) {
        // A floor's boss stands with its court alone, as the floor's last room: no waves before it.
        assert.equal(forms.length, 1, `${seed} floor ${f}: one formation`)
        assert.ok(d.floors.includes(f))
        // The Barrow Marshal behind the middle of the front row, its court across it from the middle out.
        if (d.court.front) assert.deepEqual(court.map((x) => x.slot), [slotAt(1, CENTRE_OUT[0]), ...CENTRE_OUT.slice(0, court.length - 1).map((c) => slotAt(0, c))])
        else assert.equal(court[0].slot, slotAt(0, CENTRE_OUT[0]))
      } else {
        assert.equal(forms.length, TUNING.spawn.waves.siege)
        assert.ok(d.last)
      }
    }
  }
  // As a run opens floor 1 (the draft done, or a fixed start): its boss the army's, said on the room (`lean`).
  for (const [start, want] of [[['will_o_wisp', 'bone_chanter', 'frost_sprite'], 'mire_mother'], [['tomb_knight', 'hive_warden', 'clockwork_page'], 'swarm_queen']]) {
    const run = createRun({ seed: 'open', start })
    const end = run.state.map.nodes.find((n) => n.id === run.state.map.end)
    assert.deepEqual([bossIn(end), end.lean], [want, UNITS[want].answers])
  }
})

test('the draft opens floor 1: its boss and elites read the souls drafted, the same on replay; nothing is drawn before', () => {
  for (let i = 0; i < 6; i++) {
    const seed = `draft${i}`
    const run = createRun({ seed })
    const s = run.state
    assert.equal(s.phase, 'draft')
    assert.ok(!s.map.nodes.some((n) => n.foes), 'the rooms wait for the draft')
    const rng = createRng(seed).stream('picks')
    while (s.phase === 'draft') apply(run, rng.pick(legalActions(run)))
    const end = s.map.nodes.find((n) => n.id === s.map.end)
    const army = souls(s.party)
    assert.deepEqual({ id: bossIn(end), lean: end.lean }, bossFor(seed, 1, army), seed)
    assert.ok(s.map.nodes.filter((n) => ['fight', 'elite', 'boss'].includes(n.type)).every((n) => n.foes?.length), 'every battle room drawn')
    // Replayed, the same map, rooms and all.
    assert.deepEqual(replay(seed, s.log).state.map, s.map)
  }
})

// ── a run through the bosses ─────────────────────────────────────────────────────────────────────

// A rich run (essence topped up, an HP relic and three Command relics a floor, outside the log) through rooms emptied
// of foes but the bosses' and a court of one, each boss frail: what a boss room is in the run under test here.
function walk (seed) {
  const sp = TUNING.spawn
  const empty = { fight: sp.fight.map(() => 0), elite: sp.elite.map(() => 0), court: [1, 1, 1], bossHp: [0.05, 0.05, 0.02], bossAtk: [0.05, 0.05, 0.02], late: { ...sp.late, n: 0 }, waves: { ...sp.waves, siege: 1 } }
  return tuned({ spawn: empty }, () => {
    const run = createRun({ start: START_PARTY, seed })
    const s = run.state
    const rng = createRng(seed).stream('autoplay')
    const rooms = []
    for (let granted = 0; s.phase !== 'over';) {
      if (s.essence < 5000) s.essence = 1e5
      if (['map', 'prep'].includes(s.phase) && granted < s.floor) {
        granted++
        grant(run, ['bone_mantle', 'grave_banner', 'grave_banner', 'grave_banner'])
      }
      const fighting = s.phase === 'battle'
      const was = s.stats.essence
      apply(run, policy(run, rng, { ...LEVELS.basic, wounds: true, turns: 'expert' }))
      if (fighting && s.phase !== 'battle' && currentNode(run).type === 'boss') {
        rooms.push({ floor: run.battle.floor, boss: bossIn(currentNode(run)), phase: s.phase, offers: s.offers.map((o) => o.id), earned: s.stats.essence - was, battle: run.battle })
      }
    }
    return { run, rooms }
  })
}

test('a run meets a boss a floor: a floor\'s boss won as an elite (its bounty, its court\'s souls offered, never its own), the Sovereign\'s fall the clear', () => {
  const { run, rooms } = walk('bossrun')
  const s = run.state
  assert.deepEqual([s.phase, s.result, s.floor], ['over', 'victory', F])
  assert.deepEqual(rooms.map((r) => r.floor), Array.from({ length: F }, (_, f) => f + 1))
  for (const r of rooms) {
    const d = UNITS[r.boss]
    assert.equal(r.battle.reason, 'crumble', `floor ${r.floor}: its fall crumbled its court`)
    if (r.floor < F) {
      assert.ok(d.floors.includes(r.floor) && !d.last, r.boss)
      assert.equal(r.phase, 'reap', 'its spoils')
      assert.ok(r.offers.length && !r.offers.some((id) => UNITS[id].boss), `floor ${r.floor}: ${r.offers}`)
      const slain = r.battle.units.filter((u) => u.side === 'foe' && !u.shadow && !alive(u)).reduce((n, u) => n + foeEssence(u, r.floor), 0)
      assert.equal(r.earned, Math.round(slain + eliteBonus(r.floor)), `floor ${r.floor}: the bounty`)
    } else {
      assert.deepEqual([r.boss, r.phase], ['hollow_sovereign', 'over'])
    }
  }
})

// ── the bosses' rules ────────────────────────────────────────────────────────────────────────────

test('the Molting Abbess sheds every debuff on itself as the foes\' turn begins: a Hex laid in your turn never costs it its act', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 4, 9), on('molting_abbess', 50, 'foe', 3, 5, 3)])
  const ab = unit(b, 50)
  for (const id of ['hexed', 'brittle', 'burning', 'withered']) addStatus(b, ab, id, null, unit(b, 1))
  addStatus(b, ab, 'hasten', null, ab)
  const ev = order(b, { type: 'end' })
  const shed = ev.findIndex((e) => e.type === 'rule' && e.rule === 'molting_abbess' && e.target === 50)
  assert.ok(shed >= 0, 'its shell')
  assert.deepEqual(ev.filter((e) => e.type === 'cleanse' && e.target === 50).map((e) => e.status).sort(), ['brittle', 'burning', 'hexed', 'withered'])
  assert.ok(!ev.some((e) => e.type === 'hexed' && e.target === 50), 'no act lost')
  assert.ok(ev.some((e) => e.type === 'action' && e.actor === 50 && !e.counter && ev.indexOf(e) > shed), 'it acted after shedding')
  assert.ok(!ev.some((e) => e.type === 'damage' && e.target === 50 && e.status === 'burning'), 'no burn ticked on it')
  assert.deepEqual(ab.statuses.map((x) => x.id), ['hasten'], 'a buff stays')
  // Fallen, it sheds nothing.
  const c = scene([on('tomb_knight', 1, 'party', 3, 4, 9), on('molting_abbess', 50, 'foe', 3, 5, 3), on('hive_warden', 51, 'foe', 5, 6, 3)])
  slay(c, unit(c, 50))
  addStatus(c, unit(c, 50), 'brittle', null, unit(c, 1))
  assert.ok(!order(c, { type: 'end' }).some((e) => e.type === 'rule'))
})

test('the Barrow Marshal screens its side: a shot at one not a Vanguard lands on a Vanguard beside it; a melee blow, a shape, or with it fallen, as aimed', () => {
  // A Frost Sprite of yours shoots (a lance from 3, down a line) at the Marshal, a Knight of its court beside it and a
  // Wisp of its court beside the Knight.
  const build = () => scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 3, 5, 9), on('tomb_knight', 2, 'party', 4, 7, 9), on('ember_drake', 3, 'party', 5, 5, 9),
    on('barrow_marshal', 50, 'foe', 3, 8, 3), on('tomb_knight', 51, 'foe', 2, 8, 3), on('will_o_wisp', 52, 'foe', 1, 8, 3)])
  const shot = (b, uid, ability, target) => {
    const ev = order(b, { type: 'act', uid, ability, target })
    return { hit: ev.find((e) => e.type === 'action' && e.actor === uid), rule: ev.find((e) => e.type === 'rule' && e.rule === 'barrow_marshal') }
  }
  let b = build()
  let r = shot(b, 1, 'frost_lance', 50)
  assert.deepEqual([r.hit.primary, r.hit.struck, r.hit.targets], [50, 51, [51]], 'the Knight takes it')
  assert.deepEqual([r.rule.actor, r.rule.target], [51, 50])
  b = build()
  r = shot(b, 1, 'frost_lance', 52)
  assert.deepEqual([r.hit.struck, r.hit.targets], [51, [51]], 'and the Wisp\'s, beside the Knight')
  // A melee blow strikes the Marshal as aimed (your Knight beside it).
  b = build()
  r = shot(b, 2, 'strike', 50)
  assert.ok(!r.rule && r.hit.targets.includes(50) && !r.hit.struck)
  // A blast is no shot: the Ember Drake's burst lands where aimed.
  b = build()
  r = shot(b, 3, 'ember_burst', 50)
  assert.ok(!r.rule && !r.hit.struck && r.hit.targets.includes(50))
  // With the Marshal fallen, its screens are only lines again.
  b = build()
  slay(b, unit(b, 50))
  r = shot(b, 1, 'frost_lance', 52)
  assert.ok(!r.rule && !r.hit.struck && r.hit.targets.includes(52))
})

test('the Swarm Queen\'s brood hatches beside it every second turn as the foes\' turn begins, at most four standing; with it, they crumble', () => {
  const b = scene([on('tomb_knight', 1, 'party', 3, 2, 30), on('swarm_queen', 50, 'foe', 3, 9, 3)], { boss: true })
  const q = unit(b, 50)
  const brood = () => b.units.filter((u) => u.summoner === 50 && alive(u))
  const hatched = []
  for (let t = 1; t <= 6 && !b.over; t++) {
    q.hp = q.maxHp
    const ev = order(b, { type: 'end' })
    hatched.push(ev.filter((e) => e.type === 'enter' && e.unit.summoner === 50).length)
    assert.ok(brood().every((u) => u.side === 'foe' && u.shadow && u.summoned && u.flies && u.id === 'hive_drone'))
    assert.ok(brood().length <= RULES.swarm_queen.params.most)
  }
  assert.deepEqual(hatched.slice(0, 3), [0, 2, 0], 'turn 2: two hatch, none between')
  assert.ok(b.events.some((e) => e.type === 'rule' && e.rule === 'swarm_queen' && e.actor === 50))
  // Its fall crumbles its brood (summons: no essence), and the battle is won.
  const c = scene([on('frost_sprite', 1, 'party', 3, 5, 30), on('swarm_queen', 50, 'foe', 3, 9, 3)], { boss: true })
  c.turn = 2
  order(c, { type: 'end' })
  assert.ok(c.units.some((u) => u.summoner === 50 && alive(u)))
  applyDamage(c, unit(c, 50), 1e6, { actor: unit(c, 1) })
  settle(c)
  assert.deepEqual([c.over, c.winner, c.reason], [true, 'party', 'crumble'])
  assert.ok(c.units.filter((u) => u.side === 'foe').every((u) => !alive(u)))
})

// ── what every boss is held to ───────────────────────────────────────────────────────────────────

test('every boss: its fall crumbles its side, no Arise or Legion ever raises it, and its first phase fires as its HP crosses it', () => {
  for (const id of ['hollow_sovereign', ...FLOOR_BOSSES]) {
    // A Frost Sprite of yours, holding Arise, shoots it from 2 (a lance reaches a flyer); a ghoul of its court stands off.
    const build = (opts = {}) => scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 3, 5, 20, [0, 0], ['arise']), on(id, 50, 'foe', 3, 7, 3),
      on('grave_ghoul', 51, 'foe', 0, 10, 3)], { arise: { domain: 9, tier: 9 }, ...opts })
    const b = build({ boss: true })
    const u = unit(b, 50)
    const first = UNITS[id].phases[0]
    u.hp = Math.floor(u.maxHp * first.at) + 1
    const ev = order(b, { type: 'act', uid: 1, ability: 'frost_lance', target: 50 })
    assert.ok(ev.some((e) => e.type === 'phase' && e.target === 50 && e.status === first.grant), `${id}: phase ${first.grant}`)
    // Its fall: its court crumbles.
    const c = build({ boss: true })
    unit(c, 50).hp = 1
    order(c, { type: 'act', uid: 1, ability: 'frost_lance', target: 50 })
    assert.deepEqual([c.winner, c.reason], ['party', 'crumble'], id)
    assert.ok(!alive(unit(c, 51)))
    // Never raised: no corpse for Arise, Legion's rise refused.
    const d = build()
    slay(d, unit(d, 50))
    assert.ok(!corpses(d, unit(d, 1)).some((x) => x.uid === 50), `${id}: Arise`)
    assert.equal(risable(d, unit(d, 50), 'party'), false, `${id}: Legion`)
  }
})

test('the ascension scales every boss, the floor\'s boss multipliers under its row; a boss on floor 2 bigger than on floor 1', () => {
  for (const level of [0, 3, ascensionTop()]) {
    const s = { ascension: level }
    const row = ascensionOf(s)
    for (const id of ['hollow_sovereign', ...FLOOR_BOSSES]) {
      for (const f of UNITS[id].last ? [F] : UNITS[id].floors) {
        const u = makeUnit(id, { uid: 1, lvl: 3 })
        const mods = foeMods(f, true, foeScale(s))
        assert.ok(Math.abs(statsOf(u, mods).hp - statsOf(u).hp * at(TUNING.spawn.bossHp, f) * row.foeHp) < 1e-6, `${id} floor ${f} level ${level}: HP`)
        assert.ok(Math.abs(statsOf(u, mods).atk - statsOf(u).atk * at(TUNING.spawn.bossAtk, f) * row.foeAtk) < 1e-6, `${id} floor ${f} level ${level}: ATK`)
      }
    }
  }
  assert.ok(at(TUNING.spawn.bossHp, 2) > at(TUNING.spawn.bossHp, 1) && at(TUNING.spawn.court, 2) > at(TUNING.spawn.court, 1))
  // The Sovereign lighter since the user's rule of 2026-10-16 (a boss shrugs off a second Hex in a row): no Hex holds it
  // every turn now.
  assert.ok(at(TUNING.spawn.bossHp, F) < 1 && at(TUNING.spawn.bossAtk, F) < 1, 'the Sovereign lighter')
})

// ── the elites that answer the army ──────────────────────────────────────────────────────────────

test('the elites answer the army: where none brings a threat it has no answer to, one is drawn again wanting one, keeping its own; the same on the same army', () => {
  // An army of walls and shots: no heal of others, no cleanse, so Drain, Burn and Bleed go unanswered.
  const army = souled(['tomb_knight', 'frost_sprite', 'grave_ghoul'])
  assert.ok(army.every((u) => !ANSWERS.drain(u)) && army.some(ANSWERS.reach) && army.some(ANSWERS.fly))
  let changed = 0
  let held = 0
  // Seeds until one floor is drawn again (an elite that answers nothing is rare: a few floors in a thousand).
  for (let i = 0; i < 1000 && !changed; i++) {
    const seed = `ans${i}`
    for (const f of [1, 2, 3]) {
      const map = floorOf(seed, f)
      const lack = unanswered(f, army)
      assert.deepEqual(lack, routeThreats(f).filter((t) => ['drain', 'burn', 'bleed'].includes(t)), `floor ${f}: ${lack}`)
      const elites = map.nodes.filter((n) => n.type === 'elite')
      if (!elites.length) continue
      const before = structuredClone(map)
      const s = { seed, floor: f, map, ascension: 0 }
      answerArmy(s, army)
      const had = elites.some((n) => lack.some((t) => roomThreats(before.nodes.find((x) => x.id === n.id)).has(t)))
      const has = elites.some((n) => lack.some((t) => roomThreats(n).has(t)))
      if (had) {
        assert.deepEqual(map, before, `${seed} floor ${f}: one answered already, nothing drawn again`)
        continue
      }
      // Drawn again: one elite, keeping every type it had, now bringing an unanswered one.
      const moved = elites.filter((n) => JSON.stringify(n) !== JSON.stringify(before.nodes.find((x) => x.id === n.id)))
      assert.ok(moved.length <= 1, `${seed} floor ${f}`)
      if (has) {
        changed++
        const was = roomThreats(before.nodes.find((x) => x.id === moved[0].id))
        assert.ok([...was].every((t) => roomThreats(moved[0]).has(t)), `${seed} floor ${f}: kept its types`)
        // The same army, the same draw.
        const again = { seed, floor: f, map: structuredClone(before), ascension: 0 }
        answerArmy(again, army)
        assert.deepEqual(again.map, map)
      } else assert.deepEqual(map, before)
      held++
    }
  }
  assert.ok(changed > 0 && held >= changed, `${changed} of ${held} floors drawn again`)
  // An army answering every type the floor can bring leaves the elites as drawn.
  const whole = souled(['hive_warden', 'frost_sprite'])
  for (let i = 0; i < 10; i++) {
    const map = floorOf(`ans${i}`, 2)
    const before = structuredClone(map)
    answerArmy({ seed: `ans${i}`, floor: 2, map, ascension: 0 }, whole)
    assert.deepEqual(unanswered(2, whole), [])
    assert.deepEqual(map, before)
  }
  assert.ok(Object.keys(ANSWERS).every((t) => THREATS[t]))
})
