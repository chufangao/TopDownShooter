import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import {
  UNITS, UNIT_LIST, ABILITIES, STATUSES, KIN, ROLES, SYNERGIES, RELIC_LIST, RELICS, RELIC_TIERS, ANIMS, CAMP_LIST, BEHAVIOURS, ART_POSES, artUrl, TRACKS,
  THREATS, TRIGGERS, FUSION_LIST, FUSIONS, fusionDef, TEMPERS, temperLine, STATUS_WORTH
} from '../src/content.js'
import { isRunPath, START_PARTY } from '../src/sim/run.js'
import {
  statsOf, abilitiesOf, auraOf, makeUnit, baseStats, activeSynergies, COLS, CAMP_ROWS, CAMP_SLOTS, campOpen, slotAt, rowOf, colOf, deployTile,
  wallTiles, steps, summonsOf, canTrack, nextTracks, isAllyShape, isBlow, sizeOf, monarchSlot, isMonarchCell, sealedBy, fits, tileAt, DEPTH, ROWS,
  TILES, armOf
} from '../src/sim/unit.js'
import { TUNING } from '../src/tuning.js'
import { RULES } from '../src/sim/rules.js'

// ── content is data (redesign.md §2.13): the vocabulary and the checklist ──────────────────────────

// What an ability is made of (§2.13.2): its ops (and a status tick's dot), its shapes (the ally shapes too), its anims.
const OPS = ['damage', 'heal', 'cleanse', 'apply_status', 'raise', 'cooldown']
const SHAPES = ['single', 'blast', 'column', 'row', 'all', 'corpse', 'ally', 'all_allies', 'self']
const ANIM_IDS = ['cast_beam', 'melee_lunge', 'ranged_bolt']
const PREYS = ['weakest', 'wounded', 'unarmoured', 'monarch', 'crowd', 'rested']
// A unit's stats (§2.2): HP, ATK and DEF on its base, Move on its def. No record carries a cut mechanic's key or stat
// path (§2.14, §2.16): no ring, stride, gauge price, chance or dice stat.
const STATS = ['hp', 'atk', 'def']
const GONE_PATHS = ['acc', 'eva', 'crt', 'spd', 'gauge.rate']
const GONE_KEYS = ['ring', 'stride', 'castCost', 'chance', 'dur', 'tickEvery', 'acc', 'eva', 'crt', 'spd']
// Every card speaks of turns and tiles (§2.14): no gauge, ring, dice, nor a clock in ticks and seconds.
const GONE_WORDS = /\bgauge\b|\brings?\b|\bACC\b|\bEVA\b|\bCRT\b|\bSPD\b|\bchance\b|\bmiss(es)?\b|\bcrit|\bticks?\b|\bticking\b|\bseconds?\b|\d s\b/i
// The conditions that are the rule itself, the only `when`s left (§2.7): Killing Cold's execute and Grave Tide's tide.
const RULE_CONDITIONS = ['killing_cold', 'grave_tide']
const turnsOk = (t) => t === undefined || t === 'battle' || (Number.isInteger(t) && t >= 1)

// A kind's basic blow and basic heal: the last of each in its kit (turns.js basicOf; a kit lists its basics last).
const lastOf = (kit, f) => kit.map((a) => ABILITIES[a]).filter(f).at(-1)
const mendish = (a) => isAllyShape(a.shape) && a.shape !== 'self' && a.effects.some((e) => (e.op === 'heal' && !e.self) || e.op === 'cleanse')

// Every key of every record, with the path to it: the cut keys are looked for everywhere at once.
function * keysIn (x, path) {
  if (!x || typeof x !== 'object') return
  for (const [k, v] of Object.entries(x)) {
    if (typeof v === 'function') continue
    yield [k, v, `${path}.${k}`]
    yield * keysIn(v, `${path}.${k}`)
  }
}

// Every mod a unit carries: its aura's, its tiers' and their auras'.
const modsOf = (u) => [...(u.aura?.mods ?? []), ...(u.tracks ?? []).flatMap((t) => t.tiers.flatMap((x) => [...(x.mods ?? []), ...(x.aura?.mods ?? [])]))]

// Every line of text a player reads, with where it is from.
function * cardText () {
  for (const u of UNIT_LIST) {
    yield [u.flavour ?? '', `${u.id} flavour`]
    if (u.aura) yield [u.aura.desc, `${u.id} aura`]
    for (const t of u.tracks ?? []) {
      yield [`${t.name} ${t.desc}`, `${u.id} ${t.id}`]
      for (const [i, x] of t.tiers.entries()) yield [`${x.desc} ${x.aura?.desc ?? ''}`, `${u.id} ${t.id} ${i + 1}`]
    }
  }
  for (const a of Object.values(ABILITIES)) yield [`${a.name} ${a.cond ?? ''}`, a.id]
  for (const s of Object.values(STATUSES)) yield [`${s.name} ${s.desc}`, s.id]
  for (const r of RELIC_LIST) yield [`${r.name} ${r.desc}`, r.id]
  for (const s of SYNERGIES) yield [`${s.name} ${s.desc}`, s.id]
  for (const r of FUSION_LIST) yield [`${r.name} ${r.desc}`, r.id]
  for (const [id, b] of Object.entries(BEHAVIOURS)) yield [`${b.name} ${b.desc}`, id]
  for (const [id, t] of Object.entries(THREATS)) yield [`${t.name} ${t.desc}`, id]
}

// An ability's record (§2.7, §2.13.2): ops, a shape and an anim from the vocabulary, every status it lays known and for
// whole turns, a cooldown only where it is not 2, no gauge price, and no condition but the rule ones.
function checkAbility (id, where) {
  const a = ABILITIES[id]
  assert.ok(a, `${where}: ability ${id}`)
  assert.ok(a.name && SHAPES.includes(a.shape) && ANIM_IDS.includes(a.anim) && ANIMS[a.anim], `${where} ${id}: shape ${a.shape}, anim ${a.anim}`)
  assert.match(a.tint, /^#[0-9a-f]{6}$/, `${id} tint`)
  assert.ok(a.cooldown === undefined || (Number.isInteger(a.cooldown) && a.cooldown >= 1 && a.cooldown !== 2), `${where} ${id}: cooldown ${a.cooldown}`)
  assert.ok(a.range === undefined || (Number.isInteger(a.range) && a.range >= 1), `${where} ${id}: range`)
  assert.equal(!!a.when, RULE_CONDITIONS.includes(id), `${where} ${id}: a condition only where it is the rule`)
  assert.equal(!!a.when, !!a.cond, `${id}: a condition says itself in words`)
  assert.ok(a.effects.length, `${id}: effects`)
  for (const e of a.effects) checkEffect(e, `${where} ${id}`)
}

function checkEffect (e, where) {
  assert.ok(OPS.includes(e.op), `${where}: op ${e.op}`)
  if (e.op === 'apply_status') assert.ok(STATUSES[e.status] && turnsOk(e.turns), `${where}: ${e.status} for ${e.turns}`)
  else assert.ok(!e.status && e.turns === undefined, `${where}: a status only with apply_status`)
  if (e.op === 'cooldown') assert.ok(Number.isInteger(e.amount) && e.amount !== 0, `${where}: cooldown ${e.amount}`)
  if (e.op === 'damage' || e.op === 'heal') assert.ok(e.power > 0 || e.pct > 0, `${where}: ${e.op} power`)
}

// ── units ─────────────────────────────────────────────────────────────────────────────────────────

// The Move placeholders (redesign.md §2.2): 1 for the slowest, 3 for the quickest and the flyers, the fused and the
// boss 2, the Monarch 0.
const MOVE = {
  monarch: 0, bone_chanter: 2, tomb_knight: 2, ember_drake: 2, frost_sprite: 3, hive_warden: 2, clockwork_page: 2, grave_ghoul: 2, will_o_wisp: 2,
  thorn_dryad: 1, mantis_reaper: 3, iron_golem: 1, barrow_wight: 2, frost_wyrm: 2, pyre_hound: 3, hive_drone: 3, rot_bloat: 2, marsh_hag: 2,
  ash_wyvern: 3, bone_colossus: 2, rime_drake: 2, hive_queen: 2, clockwork_titan: 2, pale_court: 2, hollow_sovereign: 2
}
// The temperaments (§2.9.4): each kind on its preset; the fused on the preset their parts would have.
const TEMPER = {
  charger: ['tomb_knight', 'pyre_hound', 'rot_bloat', 'bone_colossus'],
  shooter: ['frost_sprite', 'bone_chanter', 'barrow_wight'],
  seeker: ['will_o_wisp', 'hive_drone', 'ash_wyvern', 'pale_court'],
  keeper: ['hive_warden', 'clockwork_page', 'thorn_dryad', 'hive_queen'],
  sieger: ['iron_golem', 'clockwork_titan'],
  stalker: ['mantis_reaper'],
  hexer: ['marsh_hag'],
  crowd: ['ember_drake', 'rime_drake'],
  court: ['hollow_sovereign']
}

test('every kind is one record: base, Move, temper, threats, two tracks of four on its def, pictures, every ability in the vocabulary', () => {
  assert.equal(Object.keys(UNITS).length, 25)
  assert.deepEqual(Object.keys(MOVE).sort(), Object.keys(UNITS).sort())
  for (const u of UNIT_LIST) {
    const where = u.id
    assert.ok(u.name && Number.isInteger(u.tier) && u.tier >= 0, `${where}: name and tier`)
    assert.deepEqual(Object.keys(u.base), STATS, `${where}: base HP, ATK, DEF`)
    assert.ok(Object.keys(u.growth).every((k) => STATS.includes(k)), `${where}: growth`)
    assert.equal(u.move, MOVE[u.id], `${where}: Move`)
    for (const k of GONE_KEYS) assert.ok(!(k in u), `${where}: no ${k}`)
    for (const k of ['line', 'leg', 'home', 'leader', 'offset', 'lunges', 'banner', 'summon', 'foeOrders']) assert.ok(!(k in u), `${where}: no ${k}`)
    assert.ok(u.arm === undefined || u.arm === 2, `${where}: arm`)
    assert.ok(u.size === undefined || u.size === 2, `${where}: size`)
    assert.equal(sizeOf(makeUnit(u.id, { uid: 1 })), u.size ?? 1, `${where} sizeOf`)
    // Its pictures, its own or another kind's it borrows (`art`).
    assert.ok(UNITS[u.art], `${where}: art ${u.art}`)
    for (const pose of ART_POSES) assert.ok(existsSync(new URL(artUrl(u.id, pose))), `${where}: its ${pose} picture`)
    for (const a of u.abilities) checkAbility(a, where)
    for (const x of modsOf(u)) assert.ok(!GONE_PATHS.includes(x.path), `${where}: a mod on ${x.path}`)
    if (u.monarch) continue
    assert.ok(KIN[u.kin] && ROLES[u.role] && !ROLES[u.role].hidden, `${where}: kin and role`)
    assert.ok(u.flavour, `${where} flavour`)
    // How it thinks as a foe: three values, a known prey, and the way line made from them.
    const t = u.temper
    assert.ok(t && t.aggression >= 0 && t.caution >= 0 && PREYS.includes(t.prey), `${where}: a temper with a known prey`)
    assert.match(temperLine(t), /^[A-Z][a-z].*; .*; .+/, `${where}: its way line`)
    // What it does to a Monarch, every kind's (the fused too, though never met).
    assert.ok(u.threats?.length && u.threats.every((x) => THREATS[x]) && new Set(u.threats).size === u.threats.length, `${where}: threats`)
    for (const p of u.phases ?? []) assert.ok(STATUSES[p.grant] && p.at > 0 && p.at < 1, `${where}: phase ${p.grant}`)
    // Its tracks are on its def, and TRACKS reads them there; the boss has none.
    if (u.boss) {
      assert.ok(!u.tracks && !TRACKS[u.id], `${where}: a boss has no tracks`)
    } else {
      assert.ok(Array.isArray(u.tracks) && u.tracks.length === 2 && u.tracks.every((x) => x.tiers.length === 4), `${where}: two tracks of four, on its def`)
      assert.equal(TRACKS[u.id], u.tracks, `${where}: TRACKS reads the def`)
    }
    // A death burst: its effects resolve and reach a tile or more.
    if (u.onFall) {
      assert.ok(Number.isInteger(u.onFall.range) && u.onFall.range >= 1 && u.onFall.effects.length, `${where} onFall`)
      for (const e of u.onFall.effects) checkEffect(e, `${where} onFall`)
    }
    // A fused kind is made, never met: no spawn, no behaviour, never a boss, nothing that flies or bursts.
    if (u.fused) {
      assert.ok(!u.spawn && !u.boss && !u.behaviour && !u.flies && !u.onFall, `${where}: fused`)
      continue
    }
    // A flyer flies, carries the fly threat and keeps the air road; no other kind does.
    assert.equal(u.behaviour === 'fly', !!u.flies, `${where} flies`)
    assert.equal(u.behaviour === 'fly', u.threats.includes('fly'), `${where} fly threat`)
    assert.ok(u.boss || u.spawn, `${where} spawns`)
    assert.ok(BEHAVIOURS[u.behaviour], `${where} moves by a known behaviour`)
  }
  assert.deepEqual(Object.keys(TRACKS).sort(), UNIT_LIST.filter((u) => !u.monarch && !u.boss).map((u) => u.id).sort(), 'TRACKS is the defs\', no table apart')
  // The temperaments: a preset by name, or a copy of one tweaked. The Ghoul hunts where the armour is thinnest; the
  // Wyrm makes the field come to it.
  for (const [name, ids] of Object.entries(TEMPER)) {
    for (const id of ids) {
      const t = UNITS[id].temper
      if (id === 'grave_ghoul' || id === 'frost_wyrm') continue
      assert.equal(t, TEMPERS[name], `${id}: ${name}`)
    }
  }
  assert.deepEqual(UNITS.grave_ghoul.temper, { ...TEMPERS.charger, prey: 'unarmoured' })
  assert.deepEqual(UNITS.frost_wyrm.temper, { ...TEMPERS.shooter, aggression: 0, caution: 2.5 })
  assert.deepEqual(UNIT_LIST.filter((u) => !u.monarch).map((u) => u.id).sort(), [...Object.values(TEMPER).flat(), 'grave_ghoul', 'frost_wyrm'].sort())
  // Identity on the board: two long arms, the slow and the quick, two flyers, one death burst, three 2×2s.
  const of = (f) => UNIT_LIST.filter(f).map((u) => u.id).sort()
  assert.deepEqual(of((u) => u.arm === 2), ['grave_ghoul', 'mantis_reaper'])
  assert.deepEqual(of((u) => u.move === 1), ['iron_golem', 'thorn_dryad'])
  assert.deepEqual(of((u) => u.move === 3 && !u.flies), ['frost_sprite', 'mantis_reaper', 'pyre_hound'])
  assert.deepEqual(of((u) => u.flies), ['ash_wyvern', 'hive_drone'])
  assert.ok(of((u) => u.flies).every((id) => UNITS[id].move === 3), 'flyers 3')
  assert.deepEqual(of((u) => u.onFall), ['rot_bloat'])
  assert.deepEqual(of((u) => u.size === 2), ['bone_colossus', 'clockwork_titan', 'hive_queen'])
})

test('the foes by floor: each pool brings its threats and its statuses', () => {
  // The foes scale in kind by floor (DESIGN §2.4): floor 1's pool carries every threat type but depth (a room's, not a
  // kind's: it comes with waves), fly and bleed; floor 2 brings the flyer, the death burst, the Mantis's Bleed and the
  // Golem's Quake, which Hexes; floor 3 the hexer and the flying burner.
  const pool = (floor) => UNIT_LIST.filter((u) => u.spawn?.minFloor === floor)
  const lays = (u, status) => u.abilities.some((a) => ABILITIES[a].effects.some((e) => e.status === status))
  assert.deepEqual(new Set(pool(1).flatMap((u) => u.threats)), new Set(Object.keys(THREATS).filter((t) => t !== 'depth' && t !== 'fly' && t !== 'bleed')))
  assert.ok(pool(1).some((u) => lays(u, 'burning')), 'Burning on floor 1')
  assert.ok(!pool(1).some((u) => u.flies || u.onFall || lays(u, 'hexed')), 'no flyer, burst or Hex on floor 1')
  assert.ok(pool(2).some((u) => u.threats.includes('bleed') && lays(u, 'bleeding')), 'Bleed on floor 2')
  assert.ok(pool(2).some((u) => u.flies) && pool(2).some((u) => u.onFall), 'Fly and the death burst on floor 2')
  assert.ok(pool(2).some((u) => lays(u, 'hexed')), 'the Golem Hexes on floor 2')
  assert.ok(pool(3).some((u) => u.temper === TEMPERS.hexer && lays(u, 'hexed')), 'the hexer on floor 3')
  assert.ok(pool(3).some((u) => u.flies && u.threats.includes('burn')), 'a flying burner on floor 3')
  assert.ok(!UNIT_LIST.some((u) => u.threats?.includes('depth')))
})

test('the Monarch: one of a kind, never spawned, never moving, never striking, never raising, its HP from the run, hidden from synergies', () => {
  const m = UNITS.monarch
  assert.deepEqual([m.name, m.kin, m.role, m.tier, m.monarch, m.spawn, m.abilities, m.move, m.tracks, m.temper], ['The Monarch', null, 'monarch', 0, true, undefined, [], 0, undefined, undefined])
  assert.equal(UNIT_LIST.filter((u) => u.monarch).length, 1)
  assert.equal(ROLES.monarch.hidden, true)
  // Arise is a skill of the piece that holds an Arise relic (§2.15): no kind holds it of its own.
  const arise = ABILITIES.arise
  assert.deepEqual([arise.shape, arise.anim, arise.effects, arise.cooldown], ['corpse', 'cast_beam', [{ op: 'raise' }], undefined])
  assert.ok(!UNIT_LIST.some((u) => u.abilities.includes('arise') || Object.values(u.tracks ?? []).some((t) => t.tiers.some((x) => x.ability?.id === 'arise'))))
  // No level and no points: its base HP whatever `lvl` says (its HP relics are the run's: run.js monarchHp).
  const T = TUNING.monarch
  for (const lvl of [0, 1, 5]) assert.equal(baseStats('monarch', lvl).hp, T.hp)
  assert.deepEqual(baseStats('monarch', 5), baseStats('monarch', 0))
  assert.equal(makeUnit('monarch', { uid: 0, lvl: 0 }).maxHp, T.hp)
  // Three undead and the Monarch are not Undead 4; four are.
  const at = (id, uid, row, col) => makeUnit(id, { uid, slot: slotAt(row, col) })
  const party = [at('bone_chanter', 1, 0, 3), at('monarch', 0, 0, 4), at('grave_ghoul', 2, 0, 5), at('tomb_knight', 3, 1, 3)]
  assert.deepEqual(activeSynergies(party), [])
  assert.deepEqual(activeSynergies([...party, at('rot_bloat', 4, 1, 4)]).map((s) => s.id), ['undead_4'])
})

// The Sovereign carries its override as a rule (§2.9.6), on top of its temperament: only a boss may.
test('the boss: phases, an override named as a rule, no tracks, never offered', () => {
  const b = UNITS.hollow_sovereign
  assert.equal(b.rule, 'sovereign')
  assert.deepEqual(UNIT_LIST.filter((u) => u.rule).map((u) => u.id), ['hollow_sovereign'])
  assert.ok(b.boss && !b.spawn && !b.tracks && b.phases.length === 2)
  assert.ok(b.abilities.includes('grave_tide') && ABILITIES.grave_tide.effects.some((e) => e.op === 'raise'))
})

// ── tracks ────────────────────────────────────────────────────────────────────────────────────────

test('every kind of soul has two tracks of four tiers, IV a rule, I–II never remaking what the other track does, and every tier resolves', () => {
  const colossi = []
  for (const [id, paths] of Object.entries(TRACKS)) {
    assert.equal(paths.length, 2, `${id} tracks`)
    assert.equal(new Set(paths.map((p) => p.id)).size, paths.length, `${id} track ids`)
    for (const [k, p] of paths.entries()) {
      assert.ok(p.name && p.desc && p.tiers.length === 4, `${id} ${p.id}`)
      const soul = makeUnit(id, { uid: 1 })
      const at = (n) => ({ ...soul, tracks: k ? [0, n] : [n, 0] })
      // Tiers I–II, which the other track may sit beside, remake no ability and grant no aura. IV is a rule, never a
      // percentage: a new or remade ability, an aura, or Colossus (DESIGN §2.6).
      assert.ok(p.tiers.slice(0, 2).every((t) => !t.ability && !t.aura), `${id} ${p.id}: I–II`)
      const iv = p.tiers[3]
      assert.ok(!iv.mods && (iv.ability || iv.aura || iv.size === 2), `${id} ${p.id}: IV a rule`)
      assert.ok(p.tiers.slice(0, 3).every((t) => !('size' in t)), `${id} ${p.id}: Colossus at IV only`)
      if (iv.size) {
        assert.ok(iv.size === 2 && !UNITS[id].size, `${id} ${p.id}: Colossus grows a kind of size 1 to 2`)
        colossi.push(`${id}:${k}`)
      }
      for (const [i, t] of p.tiers.entries()) {
        const where = `${id} ${p.id} ${i + 1}`
        assert.ok(t.desc && (t.mods || t.ability || t.aura || t.summon || t.size), where)
        for (const gone of ['count', 'banner', 'stride', 'ring']) assert.ok(!(gone in t), `${where}: no ${gone}`)
        // A tier with a summon calls that many shadows of its kind each battle, from that tier on, and its card says
        // how many.
        if (t.summon) {
          assert.ok(Number.isInteger(t.summon) && t.summon >= 1 && summonsOf(at(i + 1)) === summonsOf(at(i)) + t.summon, `${where}: summon`)
          assert.ok(t.desc.includes(`${t.summon} of its kind`), `${where}: the card names its ${t.summon}`)
        }
        const before = abilitiesOf(at(i))
        if (t.ability) {
          checkAbility(t.ability.id, where)
          if (t.ability.replace) assert.ok(before.includes(t.ability.replace), `${where}: replaces ${t.ability.replace}`)
          assert.ok(abilitiesOf(at(i + 1)).includes(t.ability.id), where)
        }
        if (t.aura) assert.ok(t.aura.range >= 1 && t.aura.desc && t.aura.mods.length && auraOf(at(i + 1)) === t.aura, where)
        for (const x of [...(t.mods ?? []), ...(t.aura?.mods ?? [])]) assert.ok(['add', 'mul', 'set'].includes(x.op) && typeof x.v === 'number', `${where}: ${x.path}`)
        assert.equal(sizeOf(at(i + 1)), t.size ?? sizeOf(at(i)), `${where}: size`)
        statsOf(at(i + 1))
      }
    }
  }
  // Colossus where Banner was, on the front-line kinds' first track (Tomb Knight's Barrow Wall the first), and the Rot
  // Bloat's.
  assert.deepEqual(colossi, ['tomb_knight:0', 'grave_ghoul:0', 'iron_golem:0', 'rot_bloat:0'])
  // Your kinds can learn to inflict Burning and Hexed too (DESIGN §2.4): a tier of a kind met on floors 1–2 grants a
  // blow that does each.
  const early = Object.keys(TRACKS).filter((id) => UNITS[id].spawn?.minFloor <= 2)
  const grants = (status) => early.filter((id) => TRACKS[id].some((p) => p.tiers.some((t) => t.ability && ABILITIES[t.ability.id].effects.some((e) => e.status === status))))
  assert.ok(grants('burning').includes('ember_drake') && grants('hexed').includes('clockwork_page'), `${grants('burning')} / ${grants('hexed')}`)
  // A tier on `move` adds a whole tile (§2.7).
  const moves = Object.values(TRACKS).flat().flatMap((p) => p.tiers.flatMap((t) => [...(t.mods ?? []), ...(t.aura?.mods ?? [])])).filter((x) => x.path === 'move')
  assert.ok(moves.length >= 12 && moves.every((x) => x.op === 'add' && x.v === 1), `${moves.length} Move tiers`)
})

// The card never lies about reach (§2.6): a tier that says how far the blow it grants reaches ("reaches 2 tiles", "at
// range 5", "within 3 tiles", "from up to 3 tiles") says what its range gives it: a ranged blow its range, a melee one
// its own range where it has one, else the kind's arm.
test('a tier that says how far its blow reaches says what the blow\'s range gives it', () => {
  const said = /(?:reaches (\d+) tiles?|within (\d+) tiles?|at range (\d+)|from up to (\d+) tiles?)/
  let n = 0
  for (const [id, tracks] of Object.entries(TRACKS)) {
    for (const [k, p] of tracks.entries()) {
      for (const [i, t] of p.tiers.entries()) {
        const a = t.ability && ABILITIES[t.ability.id]
        const m = a && !isAllyShape(a.shape) && said.exec(t.desc)
        if (!m) continue
        const u = { ...makeUnit(id, { uid: 1 }), tracks: k ? [0, i + 1] : [i + 1, 0] }
        const reach = a.melee ? a.range ?? armOf(u) : a.range ?? Infinity
        assert.equal(reach, Number(m.slice(1).find(Boolean)), `${id} ${p.id} ${i + 1}: ${t.desc}`)
        n++
      }
    }
  }
  assert.ok(n >= 20, `${n} tiers say a reach`)
})

// A tier that replaces an ability (DESIGN §2.6) replaces one the kind holds at that point, whatever the other track
// holds: every holding the crosspath rule allows (canTrack), for every kind, makes a whole kit of known abilities whose
// last blow, its basic (turns.js basicOf), is usable every turn: no cooldown, no condition. One that does not is a
// content error, and abilitiesOf says so rather than leaving a hole in the kit.
test('abilitiesOf: every legal holding of every kind\'s tiers makes a whole kit, its basics last; a tier replacing an ability the kit lacks throws', () => {
  let holdings = 0
  for (const id of Object.keys(TRACKS)) {
    const seen = new Set(['0,0'])
    const queue = [[0, 0]]
    while (queue.length) {
      const tracks = queue.shift()
      holdings++
      const kit = abilitiesOf({ id, tracks })
      assert.ok(kit.length > 0 && kit.every((a) => ABILITIES[a]), `${id} ${tracks}: ${kit}`)
      assert.equal(new Set(kit).size, kit.length, `${id} ${tracks}: no ability twice`)
      const basic = lastOf(kit, isBlow)
      assert.ok(basic && !basic.when && basic.cooldown === undefined, `${id} ${tracks}: its basic blow ${basic?.id}`)
      const mend = lastOf(kit, mendish)
      assert.ok(!mend || (!mend.when && mend.cooldown === undefined), `${id} ${tracks}: its basic heal ${mend?.id}`)
      for (const t of [0, 1]) {
        if (!canTrack(tracks, t)) continue
        const next = nextTracks(tracks, t)
        if (next[t] > TRACKS[id][t].tiers.length || seen.has(String(next))) continue
        seen.add(String(next))
        queue.push(next)
      }
    }
  }
  assert.ok(holdings > Object.keys(TRACKS).length * 10, `${holdings} holdings walked`)
  // The basics (§2.7): a tier that adds a blow puts it before them.
  const basicOf = (id, tracks = [0, 0]) => lastOf(abilitiesOf({ id, tracks }), isBlow).id
  assert.deepEqual(['tomb_knight', 'bone_chanter', 'frost_sprite', 'pyre_hound', 'pale_court', 'rime_drake'].map((id) => basicOf(id)), ['strike', 'marrow_bolt', 'frost_lance', 'pyre_bite', 'pale_fire', 'frost_lance'])
  assert.equal(basicOf('pyre_hound', [2, 4]), 'pyre_bite', 'Cinder Spit is a skill')
  assert.equal(basicOf('frost_sprite', [4, 2]), 'glacier_lance', 'a tier that swaps a basic swaps a basic')
  // A tier remade to replace what the kit lacks: a clear error, naming the kind and the ability.
  const tier = TRACKS.bone_chanter[0].tiers[0]
  const was = tier.ability
  tier.ability = { id: 'requiem', replace: 'nothing_held' }
  try {
    assert.throws(() => abilitiesOf({ id: 'bone_chanter', tracks: [1, 0] }), /bone_chanter.*"nothing_held"/)
  } finally {
    if (was === undefined) delete tier.ability
    else tier.ability = was
  }
  assert.deepEqual(abilitiesOf({ id: 'bone_chanter', tracks: [1, 0] }), abilitiesOf({ id: 'bone_chanter', tracks: [0, 0] }))
})

// Summon tiers (DESIGN §2.6): one per kin, at tier II, two summons each.
test('summon tiers: one kin each, at tier II, two summons each battle', () => {
  const tiers = Object.entries(TRACKS).flatMap(([id, tracks]) => tracks.flatMap((p) => p.tiers.flatMap((t, i) => (t.summon ? [{ id, track: p.id, i, summon: t.summon }] : []))))
  assert.deepEqual(tiers.map((t) => [t.id, t.track, t.summon]), [
    ['bone_chanter', 'marrowcaller', 2], ['hive_warden', 'brood_mother', 2], ['clockwork_page', 'gearwright', 2],
    ['thorn_dryad', 'heartwood', 2], ['frost_wyrm', 'ancient', 2]
  ])
  assert.ok(tiers.every((t) => t.i === 1), 'tier II')
  assert.equal(new Set(tiers.map((t) => UNITS[t.id].kin)).size, 5, 'every kin has one')
})

// ── abilities and statuses ────────────────────────────────────────────────────────────────────────

test('every ability is ops, a shape and an anim; Hexed for one act or two; no condition but the rule', () => {
  for (const id of Object.keys(ABILITIES)) checkAbility(id, 'ABILITIES')
  // No cooldown exception yet (the balance pass grants them): every skill rests a turn.
  assert.deepEqual(Object.values(ABILITIES).filter((a) => a.cooldown !== undefined).map((a) => a.id), [])
  // Hexed (§2.7): for one act, or two from Wrench and Gear Lock; the frost blows deal damage and lay none.
  const hex = (id) => ABILITIES[id].effects.find((e) => e.status === 'hexed')
  const one = ['quake', 'hoarfrost', 'spanner', 'earthshatter', 'deep_winter', 'worldbreaker', 'ice_age', 'piston_slam', 'bone_quake', 'equinox', 'kindled_lance', 'steam_hammer']
  for (const id of one) assert.equal(hex(id)?.turns ?? STATUSES.hexed.turns, 1, id)
  for (const id of ['wrench', 'gear_lock']) assert.equal(hex(id)?.turns, 2, id)
  for (const id of ['frost_lance', 'shatter_lance', 'glacial_breath', 'blizzard', 'glacier_lance', 'rimefire', 'rimestorm']) {
    assert.ok(!hex(id) && ABILITIES[id].effects.some((e) => e.op === 'damage'), id)
  }
  // Killing Cold's condition is its execute; Grave Tide's is the Sovereign's tide.
  assert.equal(ABILITIES.killing_cold.cond, 'once a foe is below half HP')
  assert.equal(ABILITIES.grave_tide.cond, 'once it is at 60% HP or less')
})

// The statuses' turns (§2.8): 'battle' the battle; Hexed's turns the acts it costs.
const TURNS = {
  brittle: 3, hasten: 2, regen: 5, barkskin: 4, veiled: 3, withered: 3, enraged: 'battle', desperate: 'battle', burning: 3, bleeding: 2, hexed: 1, shield: 4
}

test('every status lasts turns, is drawn in its colour, has a worth, and its text is for turns', () => {
  assert.deepEqual(Object.keys(STATUSES).sort(), Object.keys(TURNS).sort())
  const unit = makeUnit('tomb_knight', { uid: 1 })
  for (const s of Object.values(STATUSES)) {
    assert.ok(s.name && s.desc && ['buff', 'debuff'].some((t) => s.tags.includes(t)), s.id)
    assert.equal(s.turns, TURNS[s.id], `${s.id} turns`)
    assert.match(s.colour, /^#[0-9a-f]{6}$/, `${s.id} colour`)
    assert.ok(STATUS_WORTH[s.id] > 0, `${s.id} worth`)
    assert.ok(Number.isInteger(s.stacks) && s.stacks >= 1, `${s.id} stacks`)
    assert.ok(!('dur' in s), `${s.id}: no dur`)
    for (const x of s.mods) assert.ok(!GONE_PATHS.includes(x.path), `${s.id}: ${x.path}`)
    statsOf(unit, s.mods)
    for (const e of s.tick ?? []) assert.ok(['dot', 'heal'].includes(e.op) && e.power > 0, `${s.id} tick`)
  }
  // A damage-over-time or Regen ticks once a turn, for its power (§2.8), and its card says how much.
  assert.deepEqual(['burning', 'bleeding', 'regen'].map((id) => STATUSES[id].tick[0].power), [12, 8, 48])
  for (const id of ['burning', 'bleeding', 'regen']) {
    const s = STATUSES[id]
    assert.ok(s.desc.includes(`${s.tick[0].power} `) && !('tickEvery' in s), `${id}: ${s.desc}`)
  }
  // Burning a damage-over-time up to 3 stacks; Hexed the one that disables (no mods: it costs its next act), both
  // debuffs, so Purge and Molt cleanse them.
  const { burning, hexed } = STATUSES
  assert.deepEqual([burning.stacks, burning.tick.map((e) => e.op), burning.tags], [3, ['dot'], ['debuff']])
  assert.deepEqual([hexed.tags, hexed.mods], [['debuff'], []])
  assert.match(hexed.desc, /next act/)
  // Hasten, Enraged and Desperate: +1 Move, and cooldowns a turn faster (`cooldown.rate`).
  for (const id of ['hasten', 'enraged', 'desperate']) {
    const mods = STATUSES[id].mods
    assert.ok(['move', 'cooldown.rate'].every((path) => mods.some((x) => x.path === path && x.op === 'add' && x.v === 1)), id)
  }
  // Veiled: +20% DEF.
  assert.deepEqual(STATUSES.veiled.mods, [{ path: 'def', op: 'mul', v: 1.2 }])
})

test('a status shapes stats the way its mods say', () => {
  const u = makeUnit('frost_sprite', { uid: 1, lvl: 3 })
  const base = statsOf(u)
  assert.equal(base.atk, 15 + 2 * 2)
  assert.equal(base.move, 3)
  const s = statsOf(u, [{ path: 'atk', op: 'add', v: 1 }, { path: 'atk', op: 'mul', v: 2 }, { path: 'def', op: 'set', v: 7 }, { path: 'move', op: 'add', v: 1 }])
  assert.equal(s.atk, (base.atk + 1) * 2)
  assert.equal(s.def, 7)
  assert.equal(s.move, 4)
  const engaged = [{ path: 'def', op: 'mul', v: 2, pos: 'engaged' }]
  assert.equal(statsOf({ ...u, pos: 'engaged' }, engaged).def, base.def * 2)
  assert.equal(statsOf({ ...u, pos: 'free' }, engaged).def, base.def)
  assert.equal(statsOf(u, engaged).def, base.def, 'outside a battle a position mod does not apply')
  assert.throws(() => statsOf(u, [{ path: 'nope', op: 'add', v: 1 }]))
})

// ── synergies ─────────────────────────────────────────────────────────────────────────────────────

// One rule a kin and one a role, at 4 (§2.12): the rules that stood at 8, under the ids the registry knows.
const SYNERGY_RULES = {
  undead: 'legion', drake: 'dragonfire', fae: 'mirage', insect: 'frenzy', construct: 'last_stand',
  vanguard: 'bodyguard', ranger: 'deadeye', skirmisher: 'ambush', channeler: 'echo', warden: 'sanctuary', trickster: 'deathblow'
}

test('every kin and every role has one synergy, a rule at 4 pieces, and no stat steps', () => {
  const axes = [...Object.keys(KIN).map((id) => ['kin', id]), ...Object.values(ROLES).filter((r) => !r.hidden).map((r) => ['role', r.id])]
  assert.equal(SYNERGIES.length, axes.length)
  assert.deepEqual(Object.keys(SYNERGY_RULES).sort(), axes.map(([, id]) => id).sort())
  for (const [axis, id] of axes) {
    const s = SYNERGIES.filter((x) => x.needs[axis]?.[id])
    assert.equal(s.length, 1, `${axis} ${id}: one synergy`)
    const [syn] = s
    assert.deepEqual(syn.needs, { [axis]: { [id]: 4 } }, `${syn.id}: at 4`)
    assert.equal(syn.id, `${id}_4`)
    assert.equal(syn.rule, SYNERGY_RULES[id], `${syn.id}: rule`)
    assert.ok(!('mods' in syn), `${syn.id}: no stat step`)
    assert.ok(syn.name && syn.desc.includes(': '), `${syn.id}: its text says what the rule does`)
  }
  // Deadeye's card says its number; Deathblow's its execute (§2.16).
  assert.ok(SYNERGIES.find((s) => s.rule === 'deadeye').desc.includes(`${Math.round((RULES.deadeye.params.mul - 1) * 100)}% more`))
  assert.match(SYNERGIES.find((s) => s.rule === 'deathblow').desc, /below a quarter of its HP deals double/)
})

// ── relics ────────────────────────────────────────────────────────────────────────────────────────

// The keys a relic may carry: its identity, its form (§2.13.3) and, for a run relic, `run`; for a Legendary, a rule
// and its params. The sixteen bespoke keys of before are none of them.
const RELIC_KEYS = ['id', 'tier', 'name', 'desc', 'run', 'mods', 'on', 'effects', 'rule', 'params', 'needsArise']
// A run relic's side-wide cost (§2.15): a loss on a unit's path for every soul (Legion's −15% HP).
const isCost = (x) => x.path === 'hp' && x.op === 'mul' && x.v < 1
const ARISE_RELICS = ['arise', 'hollow_court', 'blood_tithe', 'court_of_bone']

test('every relic is a run relic or a piece relic, in one of the three forms, its tier and form matching: no rule below Legendary', () => {
  const unit = makeUnit('tomb_knight', { uid: 1 })
  for (const r of RELIC_LIST) {
    assert.ok(RELIC_TIERS.some((t) => t.id === r.tier) && r.name && r.desc, r.id)
    for (const k of Object.keys(r)) assert.ok(RELIC_KEYS.includes(k), `${r.id}: no ${k}`)
    const forms = [!!r.mods, !!r.on, !!r.rule].filter(Boolean).length
    assert.equal(forms, 1, `${r.id}: one form`)
    assert.equal(!!r.on, !!r.effects, `${r.id}: a trigger is its moment and its effects`)
    if (r.tier !== 'legendary') for (const k of ['rule', 'params']) assert.ok(!(k in r), `${r.id}: no ${k} below Legendary`)
    assert.ok(!r.params || r.rule, `${r.id}: params are a rule's`)
    for (const x of r.mods ?? []) assert.ok(['add', 'mul', 'set'].includes(x.op) && typeof x.v === 'number', `${r.id}: ${JSON.stringify(x)}`)
    if (r.run) {
      // A run relic names only the run's paths, and a side-wide cost where it has one; it works unheld.
      assert.equal(r.run, true, r.id)
      assert.ok(r.mods?.length && !r.on && !r.rule, `${r.id}: a run relic is mods`)
      assert.ok(r.mods.some((x) => isRunPath(x.path)), `${r.id}: on the run`)
      for (const x of r.mods) assert.ok(isRunPath(x.path) || isCost(x), `${r.id}: ${x.path} is the run's or a cost`)
      for (const x of r.mods.filter(isCost)) statsOf(unit, [x])
      assert.doesNotMatch(r.desc, /\bits holder\b/i, `${r.id}: no holder`)
    } else {
      // A piece relic works through its holder alone, and says so; no run path.
      for (const x of r.mods ?? []) {
        assert.ok(!isRunPath(x.path), `${r.id}: a piece relic on ${x.path}`)
        statsOf(unit, [x])
      }
      assert.match(r.desc, /\b[Ii]ts holder\b/, `${r.id}: its text speaks of its holder`)
      assert.ok(!r.needsArise, `${r.id}: needs nothing`)
    }
    if (r.on) {
      assert.ok(TRIGGERS.includes(r.on), `${r.id} on ${r.on}`)
      for (const e of r.effects) {
        checkEffect(e, r.id)
        assert.ok(['self', 'other', 'allies', 'foes'].includes(e.to), `${r.id}: to ${e.to}`)
        assert.ok(!['allies', 'foes'].includes(e.to) || Number.isInteger(e.range), `${r.id}: range`)
      }
    }
    // Arise's numbers need an Arise relic held: the run relics on them are stocked only then.
    assert.equal(!!r.needsArise, !!r.mods?.some((x) => x.path.startsWith('arise.')), `${r.id}: needsArise`)
  }
  assert.deepEqual(RELIC_TIERS.map((t) => t.id), ['common', 'uncommon', 'rare', 'legendary'])
  for (const t of RELIC_TIERS) assert.ok(t.name && /^--c-/.test(t.colour), JSON.stringify(t))
  assert.deepEqual(TRIGGERS, ['kill', 'fall', 'wave', 'blow', 'struck'])
  assert.deepEqual(new Set(RELIC_LIST.filter((r) => r.on).map((r) => r.on)), new Set(TRIGGERS), 'every moment some relic\'s')
  // A Shop always stocks a Command relic: there are some at every tier but the Legendary's own.
  for (const tier of ['common', 'uncommon', 'rare', 'legendary']) {
    assert.ok(RELIC_LIST.some((r) => r.tier === tier && r.run && r.mods.some((x) => x.path === 'run.command' && x.v > 0)), `a Command relic, ${tier}`)
  }
  // Arcane Focus: the killer's skills come back a turn sooner (§2.7). Hourglass and Bone Idol
  // are run relics on every Arise's reach and tier.
  assert.deepEqual(RELICS.arcane_focus.effects, [{ op: 'cooldown', amount: -1, to: 'self' }])
  assert.deepEqual([RELICS.hourglass.mods, RELICS.bone_idol.mods].map((x) => x.map((y) => y.path)), [['arise.domain'], ['arise.tier']])
  assert.ok(RELICS.hourglass.run && RELICS.bone_idol.run)
})

test('the Legendaries: a rule scoped to the holder, Arise a skill it teaches, and the Arise variants', () => {
  const legendary = RELIC_LIST.filter((r) => r.tier === 'legendary')
  assert.deepEqual(legendary.map((r) => r.id), ['arise', 'legion', 'undying', 'mimicry', 'hollow_court', 'blood_tithe', 'court_of_bone'])
  // Legion is a run relic, Command at a cost; every other a piece relic with a rule.
  assert.ok(RELICS.legion.run && !RELICS.legion.rule)
  for (const r of legendary.filter((x) => !x.run)) assert.equal(r.rule, r.id, `${r.id}: its rule is its own`)
  // Arise and its variants teach the holder the skill Arise (their rules' `grants`), and say so; nothing else does.
  assert.deepEqual(RELIC_LIST.filter((r) => RULES[r.rule]?.grants).map((r) => r.id), ARISE_RELICS)
  for (const id of ARISE_RELICS) {
    assert.equal(RULES[RELICS[id].rule].grants, 'arise', id)
    assert.match(RELICS[id].desc, /^Its holder learns Arise\b/, id)
  }
  // Arise's numbers are TUNING.arise's, and its card says them.
  assert.ok(RELICS.arise.desc.includes(`tier ${TUNING.arise.tier} `) && RELICS.arise.desc.includes(`within ${TUNING.arise.domain} tiles`), RELICS.arise.desc)
  // The variants: Court of Bone reaches farther, and its card says how far; Blood Tithe's Arise rests no turn, for a
  // share of the Monarch's HP; Undying rises at its share; Mimicry counts as a Warden.
  assert.ok(RELICS.court_of_bone.desc.includes(`${RELICS.court_of_bone.params.domain} tiles farther`))
  assert.deepEqual(RELICS.blood_tithe.params, { cooldown: 1, tithe: 0.02 })
  assert.ok(RELICS.blood_tithe.desc.includes(`${RELICS.blood_tithe.params.tithe * 100}%`))
  assert.ok(RELICS.undying.desc.includes(`${RELICS.undying.params.hp * 100}% HP`))
  assert.ok(ROLES[RELICS.mimicry.params.role] && RELICS.mimicry.desc.includes(ROLES[RELICS.mimicry.params.role].name))
  // An Arise relic grants Arise itself, so needs none held.
  assert.ok(ARISE_RELICS.every((id) => !RELICS[id].needsArise))
})

// One registry for rules (§2.13.4): what a synergy, a relic or a boss's def names as its rule is an entry of it, and
// every entry is brought by one.
test('the rules registry: every rule a synergy, a relic or a boss names is in it, and every rule in it is named by one', () => {
  const named = [...SYNERGIES, ...RELIC_LIST, ...UNIT_LIST].filter((x) => x.rule)
  for (const x of named) assert.ok(Object.hasOwn(RULES, x.rule), `${x.id}: rule ${x.rule}`)
  for (const id of Object.keys(RULES)) assert.ok(named.some((x) => x.rule === id), `${id}: named by nothing`)
})

// A rule's hooks and flags are its entry's (§2.13.4: a new rule is one entry in one file): no module of the sim but the
// registry branches on a rule's name.
test('nothing in the sim but the registry branches on a rule\'s name', () => {
  const name = `'(${Object.keys(RULES).join('|')})'`
  const branch = new RegExp(`(===|!==)\\s*${name}|${name}\\s*(===|!==)|has\\(${name}\\)`)
  for (const file of ['turns.js', 'policy.js', 'field.js', 'unit.js', 'run.js', 'map.js', 'autoplay.js']) {
    readFileSync(new URL(`../src/sim/${file}`, import.meta.url), 'utf8').split('\n').forEach((line, i) => {
      if (!line.trim().startsWith('//')) assert.doesNotMatch(line, branch, `${file}:${i + 1}`)
    })
  }
})

// ── no dice, no gauge, and the cards (§2.14–2.16) ──────────────────────────────────────────────────

test('no dice and no gauge anywhere: no chance, no ACC, EVA or CRT, no ring, stride, gauge price or tick span', () => {
  const records = { UNITS, ABILITIES, STATUSES, RELICS, SYNERGIES, FUSIONS }
  for (const [name, list] of Object.entries(records)) {
    for (const [k, v, path] of keysIn(list, name)) {
      assert.ok(!GONE_KEYS.includes(k), `${path}`)
      if (k === 'path') assert.ok(!GONE_PATHS.includes(v), `${path}: ${v}`)
      if (k === 'op') assert.notEqual(v, 'gauge', path)
    }
  }
  // Every status an effect lays lands: no ability, death burst, relic or tick names a chance (checked above), and the
  // statuses keep no `dur` but the battle's turns.
  for (const s of Object.values(STATUSES)) assert.ok(turnsOk(s.turns))
})

test('every card is for turns and tiles: no gauge, ring, dice, chance, ticks or seconds', () => {
  let n = 0
  for (const [text, where] of cardText()) {
    assert.doesNotMatch(text, GONE_WORDS, where)
    n++
  }
  assert.ok(n > 300, `${n} lines read`)
  // The ways say how a kind moves on turns, and carry no rule of their own for a foe's melee (§2.6).
  for (const b of Object.values(BEHAVIOURS)) assert.ok(b.name && b.desc && !('melee' in b), b.name)
})

// ── pictures, camps, fusions ─────────────────────────────────────────────────────────

// The battle anchors a picture at its feet, FEET (11/12) of the way down a square viewBox.
// The battle swaps between a unit's pictures in place, so all three share one box.
test('every kind has its alive, attack and dead pictures, its own or another kind\'s it borrows', () => {
  for (const u of UNIT_LIST) {
    const sizes = new Set()
    for (const pose of ART_POSES) {
      const svg = readFileSync(new URL(artUrl(u.id, pose)), 'utf8')
      const box = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
      assert.ok(box && box[1] === box[2], `${u.id} ${pose}: square viewBox`)
      assert.match(svg, new RegExp(`width="${box[1]}" height="${box[1]}"`), `${u.id} ${pose}: width and height match the viewBox`)
      assert.doesNotMatch(svg, /<(image|script|style|text)\b|href="http/, `${u.id} ${pose}: self-contained shapes only`)
      sizes.add(box[1])
    }
    assert.equal(sizes.size, 1, `${u.id}: every picture has the same box`)
    // A kind with its own pictures names none; one that borrows names a kind with pictures of its own.
    assert.ok(u.art === u.id || UNITS[u.art].art === u.art, `${u.id}: borrows ${u.art}`)
  }
})

test('camps: twelve, every floor some; each 7×7 with one seat, a road from every tile of the foes\' rows to it, no cell sealed in, and room for a 2×2', () => {
  assert.equal(CAMP_LIST.length, 12)
  for (let floor = 1; floor <= TUNING.run.floors; floor++) assert.ok(CAMP_LIST.some((c) => c.floor === floor), `floor ${floor} has a camp`)
  assert.equal(new Set(CAMP_LIST.map((c) => c.id)).size, CAMP_LIST.length, 'unique ids')
  for (const c of CAMP_LIST) {
    assert.ok(c.name, c.id)
    assert.equal(c.map.length, CAMP_ROWS, c.id)
    for (const line of c.map) assert.match(line, new RegExp(`^[.#M]{${COLS}}$`), c.id)
    assert.equal(c.map.join('').split('M').length, 2, `${c.id}: one seat`)
    const seat = monarchSlot(c.id)
    assert.ok(isMonarchCell(c.id, seat) && campOpen(c.id, seat) && rowOf(seat) > 0, `${c.id}: the seat, behind the front row`)
    const open = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(c.id, slot))
    assert.ok(open.length >= 24, `${c.id}: ${open.length} open cells`)
    assert.ok(open.filter((slot) => rowOf(slot) === 0).length >= 3, `${c.id}: the front row is open enough to come through`)
    // Walk from the front row, as the foes would, with the same step rules as the battle.
    const walls = new Set(wallTiles(c.id))
    const flood = (from) => {
      const seen = new Set(from)
      const queue = [...seen]
      while (queue.length) {
        for (const n of steps(queue.shift(), walls)) if (!seen.has(n)) { seen.add(n); queue.push(n) }
      }
      return seen
    }
    const seen = flood(open.filter((slot) => rowOf(slot) === 0).map((slot) => deployTile('party', slot)))
    for (const slot of open) assert.ok(seen.has(deployTile('party', slot)), `${c.id}: row ${rowOf(slot)} lane ${colOf(slot)} is sealed off`)
    // From the seat a road reaches every tile of the foes' rows, and the seat cuts no cell off from the open ground
    // ahead of the camp.
    const roads = flood([deployTile('party', seat)])
    for (let t = tileAt(0, DEPTH - ROWS); t < TILES; t++) assert.ok(roads.has(t), `${c.id}: no road from tile ${t}`)
    assert.deepEqual(sealedBy(c.id, seat), [], c.id)
    // A 2×2 has somewhere to stand.
    assert.ok(open.some((slot) => fits(c.id, slot, 2)), `${c.id}: no room for a 2×2`)
    assert.ok(c.map.every((line, r) => [...line].every((ch, col) => (ch === '#') === !campOpen(c.id, slotAt(r, col)))))
  }
})

// Fusions (DESIGN §2.6): five recipes to start, public, each of real parts into a fused kind (§2.13: a recipe fails if
// its result is not one).
test('fusions: every recipe\'s parts and result resolve, the result is fused, and every fused kind is one recipe\'s', () => {
  assert.deepEqual(FUSION_LIST.map((r) => [r.id, r.result, r.needs]), [
    ['bone_colossus', 'bone_colossus', { tomb_knight: 2, bone_chanter: 1 }],
    ['rime_drake', 'rime_drake', { ember_drake: 1, frost_sprite: 2 }],
    ['hive_queen', 'hive_queen', { hive_warden: 2, mantis_reaper: 1 }],
    ['clockwork_titan', 'clockwork_titan', { clockwork_page: 2, iron_golem: 1 }],
    ['pale_court', 'pale_court', { will_o_wisp: 3 }]
  ])
  assert.equal(new Set(FUSION_LIST.map((r) => r.id)).size, FUSION_LIST.length)
  for (const r of FUSION_LIST) {
    assert.ok(r.name && r.desc, r.id)
    assert.equal(FUSIONS[r.id], r)
    assert.equal(fusionDef(r.id), r)
    const result = UNITS[r.result]
    assert.ok(result?.fused && TRACKS[r.result]?.length === 2, `${r.id}: the result is a fused kind with two tracks`)
    const parts = Object.entries(r.needs)
    assert.ok(parts.reduce((n, [, k]) => n + k, 0) >= 2, `${r.id}: more than one piece`)
    for (const [kind, n] of parts) {
      const def = UNITS[kind]
      assert.ok(def && def.spawn && !def.fused && !def.boss && !def.monarch && Number.isInteger(n) && n >= 1, `${r.id}: part ${kind}`)
    }
  }
  assert.throws(() => fusionDef('nothing'))
  const fused = UNIT_LIST.filter((u) => u.fused).map((u) => u.id).sort()
  assert.deepEqual(FUSION_LIST.map((r) => r.result).sort(), fused, 'every fused kind, once')
})

// The floor-1 slice's kinds (§5 Step 2) are still the floor-1 pool, and the start souls among them.
test('the floor-1 pool and the start souls', () => {
  const pool = UNIT_LIST.filter((u) => u.spawn?.minFloor === 1).map((u) => u.id).sort()
  assert.deepEqual(pool, ['bone_chanter', 'clockwork_page', 'frost_sprite', 'grave_ghoul', 'hive_warden', 'pyre_hound', 'tomb_knight', 'will_o_wisp'])
  assert.ok(START_PARTY.every((id) => pool.includes(id)))
})
