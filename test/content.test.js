import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { UNITS, ABILITIES, STATUSES, KIN, ROLES, SYNERGIES, RELIC_LIST, ANIMS, CAMP_LIST, BEHAVIOURS, ART_POSES, artUrl, TRACKS, THREATS, SIGNALS } from '../src/content.js'
import {
  statsOf, abilitiesOf, auraOf, cheapestOf, costliestOf, makeUnit, baseStats, activeSynergies, COLS, CAMP_ROWS, CAMP_SLOTS, campOpen, slotAt, rowOf, colOf,
  deployTile, wallTiles, steps, bodiesOf, rangeOf, isAllyShape, ringOf, bannerOf
} from '../src/sim/unit.js'
import { TUNING } from '../src/tuning.js'

const checkEffect = (e, where) => {
  assert.ok(['damage', 'heal', 'apply_status', 'cleanse', 'gauge', 'raise'].includes(e.op), `${where}: op ${e.op}`)
  if (e.status) assert.ok(STATUSES[e.status], `${where}: status ${e.status}`)
}

test('every unit reference resolves; every foe carries its threats', () => {
  for (const u of Object.values(UNITS)) {
    if (u.monarch) continue
    assert.ok(KIN[u.kin], `${u.id} kin`)
    assert.ok(ROLES[u.role] && !ROLES[u.role].hidden, `${u.id} role`)
    assert.ok(Number.isInteger(u.tier) && u.tier >= 1, `${u.id} tier`)
    for (const a of u.abilities) assert.ok(ABILITIES[a], `${u.id} ability ${a}`)
    for (const p of u.phases ?? []) assert.ok(STATUSES[p.grant], `${u.id} phase ${p.grant}`)
    // A ring: 1 for a kind whose blows are all melee, a ranged kind's reach (its farthest blow's range).
    const blows = u.abilities.map((a) => ABILITIES[a]).filter((a) => !isAllyShape(a.shape) && a.shape !== 'corpse' && a.range)
    assert.equal(u.ring, Math.max(1, ...blows.map(rangeOf)), `${u.id} ring`)
    assert.ok(u.stride === undefined || u.stride > 0, `${u.id} stride`)
    assert.ok(!('summon' in u), `${u.id}: no summon kinds: a tier adds bodies to its own piece`)
    assert.ok(u.boss || u.spawn, `${u.id} spawns`)
    assert.ok(BEHAVIOURS[u.behaviour] && u.flavour, `${u.id} walks the roads by a known behaviour`)
    assert.ok(u.threats?.length && u.threats.every((t) => THREATS[t]), `${u.id} threats`)
    assert.equal(new Set(u.threats).size, u.threats.length, `${u.id} threats repeat`)
  }
  assert.equal(Object.keys(UNITS).length, 15)
  // Floor 1's pool carries every threat type but depth (a room's, not a kind's: it comes with waves).
  const floor1 = Object.values(UNITS).filter((u) => u.spawn?.minFloor === 1)
  assert.deepEqual(new Set(floor1.flatMap((u) => u.threats)), new Set(Object.keys(THREATS).filter((t) => t !== 'depth')))
  assert.ok(!Object.values(UNITS).some((u) => u.threats?.includes('depth')))
})

test('the Monarch: one of a kind, never spawned, never striking, its HP from the run, hidden from synergies', () => {
  const m = UNITS.monarch
  assert.deepEqual([m.name, m.kin, m.role, m.tier, m.monarch, m.spawn, m.abilities, m.ring], ['The Monarch', null, 'monarch', 0, true, undefined, ['arise'], 0])
  assert.equal(Object.values(UNITS).filter((u) => u.monarch).length, 1)
  assert.equal(ROLES.monarch.hidden, true)
  const arise = ABILITIES.arise
  assert.deepEqual([arise.castCost, arise.shape, arise.anim, arise.effects], [200, 'corpse', 'cast_beam', [{ op: 'raise' }]])
  assert.ok(!Object.values(UNITS).some((u) => !u.monarch && u.abilities.includes('arise')))
  // Level = points spent; only HP grows with it.
  const T = TUNING.monarch
  for (const lvl of [0, 1, 5]) assert.equal(baseStats('monarch', lvl).hp, T.hp + T.hpPerPoint * lvl)
  assert.deepEqual({ ...baseStats('monarch', 5), hp: 0 }, { ...baseStats('monarch', 0), hp: 0 })
  assert.equal(makeUnit('monarch', { uid: 0, lvl: 0 }).maxHp, T.hp)
  // Two undead and the Monarch are Undead 2, not 3.
  const at = (id, uid, row, col) => makeUnit(id, { uid, slot: slotAt(row, col) })
  const party = [at('bone_chanter', 1, 0, 3), at('monarch', 0, 0, 4), at('grave_ghoul', 2, 0, 5)]
  assert.deepEqual(activeSynergies(party).map((s) => s.id), ['undead_2'])
  assert.deepEqual(activeSynergies([party[1], party[1]]), [])
})

test('every kind of soul has two tracks of four tiers, IV a rule, I–II never remaking what the other track does, and every tier resolves', () => {
  const banners = []
  for (const u of Object.values(UNITS)) {
    const paths = TRACKS[u.id] ?? []
    if (u.boss || u.monarch) { assert.equal(paths.length, 0); continue }
    assert.equal(paths.length, 2, `${u.id} tracks`)
    assert.equal(new Set(paths.map((p) => p.id)).size, paths.length, `${u.id} track ids`)
    for (const [k, p] of paths.entries()) {
      assert.ok(p.name && p.desc && p.tiers.length === 4, `${u.id} ${p.id}`)
      const soul = makeUnit(u.id, { uid: 1 })
      const at = (n) => ({ ...soul, tracks: k ? [0, n] : [n, 0] })
      // Tiers I–II, which the other track may sit beside, remake no ability and grant no aura; IV is a rule.
      assert.ok(p.tiers.slice(0, 2).every((t) => !t.ability && !t.aura), `${u.id} ${p.id}: I–II`)
      assert.ok(p.tiers[3].ability || p.tiers[3].banner, `${u.id} ${p.id}: IV a rule`)
      if (p.tiers[3].banner) banners.push(`${u.id}:${k}`)
      assert.ok(p.tiers.slice(0, 3).every((t) => !t.banner), `${u.id} ${p.id}: Banner at IV only`)
      for (const [i, t] of p.tiers.entries()) {
        const where = `${u.id} ${p.id} ${i + 1}`
        assert.ok(t.desc && (t.mods || t.ability || t.aura || t.count || t.banner || t.ring || t.stride), where)
        assert.ok(!('summon' in t), where)
        // A tier with a count adds that many bodies to the piece each battle, from that tier on.
        if (t.count) assert.ok(Number.isInteger(t.count) && t.count >= 1 && bodiesOf(at(i + 1)) === bodiesOf(at(i)) + t.count, `${where}: count`)
        const before = abilitiesOf(at(i))
        if (t.ability) {
          assert.ok(ABILITIES[t.ability.id], `${where}: ability ${t.ability.id}`)
          if (t.ability.replace) assert.ok(before.includes(t.ability.replace), `${where}: replaces ${t.ability.replace}`)
          assert.ok(abilitiesOf(at(i + 1)).includes(t.ability.id), where)
        }
        if (t.aura) assert.ok(t.aura.range >= 1 && t.aura.mods.length && auraOf(at(i + 1)) === t.aura, where)
        assert.equal(bannerOf(at(i + 1)), !!t.banner, where)
        assert.ok(ringOf(at(i + 1)) >= ringOf(at(i)), where)
        statsOf(at(i + 1))
        // The gauge saves toward abilities only (a step is free) and banks no further than the dearest.
        const costs = abilitiesOf(at(i + 1)).map((a) => ABILITIES[a].castCost)
        assert.deepEqual([cheapestOf(at(i + 1)), costliestOf(at(i + 1))], [Math.min(...costs), Math.max(...costs)], where)
      }
    }
  }
  // Banner leads on the front-line kinds, its first track's tier IV.
  assert.deepEqual(banners, ['tomb_knight:0', 'grave_ghoul:0', 'iron_golem:0'])
})

test('every ability, status and synergy reference resolves', () => {
  for (const a of Object.values(ABILITIES)) {
    assert.match(a.tint, /^#[0-9a-f]{6}$/, `${a.id} tint`)
    assert.ok(ANIMS[a.anim], `${a.id} anim ${a.anim}`)
    assert.ok(a.castCost > 0)
    for (const e of a.effects) checkEffect(e, a.id)
  }
  const unit = makeUnit('tomb_knight', { uid: 1 })
  for (const s of Object.values(STATUSES)) {
    for (const e of s.tick ?? []) checkEffect(e, s.id)
    statsOf(unit, s.mods)
  }
  for (const s of [...SYNERGIES, ...RELIC_LIST]) statsOf(unit, s.mods ?? [])
  for (const s of SYNERGIES) {
    for (const id of Object.keys(s.needs.kin ?? {})) assert.ok(KIN[id], `${s.id} kin ${id}`)
    for (const id of Object.keys(s.needs.role ?? {})) assert.ok(ROLES[id], `${s.id} role ${id}`)
  }
  for (const a of Object.values(ABILITIES)) assert.equal(!!a.when, !!a.cond, `${a.id}: a when needs a cond`)
  for (const s of Object.values(STATUSES)) assert.ok(s.desc, `${s.id} desc`)
})

// The battle anchors a picture at its feet, FEET (11/12) of the way down a square viewBox.
// The battle swaps between a unit's pictures in place, so all three share one box.
test('every unit has its alive, attack and dead pictures', () => {
  for (const u of Object.values(UNITS)) {
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
  }
})

test('a status shapes stats the way its mods say', () => {
  const u = makeUnit('frost_sprite', { uid: 1, lvl: 3 })
  const base = statsOf(u)
  assert.equal(base.atk, 15 + 2 * 2)
  const s = statsOf(u, [{ path: 'atk', op: 'add', v: 1 }, { path: 'atk', op: 'mul', v: 2 }, { path: 'crt', op: 'set', v: 7 }])
  assert.equal(s.atk, (base.atk + 1) * 2)
  assert.equal(s.crt, 7)
  const engaged = [{ path: 'def', op: 'mul', v: 2, pos: 'engaged' }]
  assert.equal(statsOf({ ...u, pos: 'engaged' }, engaged).def, base.def * 2)
  assert.equal(statsOf({ ...u, pos: 'free' }, engaged).def, base.def)
  assert.equal(statsOf(u, engaged).def, base.def, 'outside a battle a position mod does not apply')
  assert.throws(() => statsOf(u, [{ path: 'nope', op: 'add', v: 1 }]))
})

test('camps: every floor has some; each is 7×7 with every open cell reachable from the front row', () => {
  for (let floor = 1; floor <= TUNING.run.floors; floor++) assert.ok(CAMP_LIST.some((c) => c.floor === floor), `floor ${floor} has a camp`)
  assert.equal(new Set(CAMP_LIST.map((c) => c.id)).size, CAMP_LIST.length, 'unique ids')
  for (const c of CAMP_LIST) {
    assert.equal(c.map.length, CAMP_ROWS, c.id)
    for (const line of c.map) assert.match(line, new RegExp(`^[.#]{${COLS}}$`), c.id)
    const open = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(c.id, slot))
    assert.ok(open.length >= 24, `${c.id}: ${open.length} open cells`)
    assert.ok(open.filter((slot) => rowOf(slot) === 0).length >= 3, `${c.id}: the front row is open enough to come through`)
    // Walk from the front row, as the foes would, with the same step rules as the battle.
    const walls = new Set(wallTiles(c.id))
    const seen = new Set(open.filter((slot) => rowOf(slot) === 0).map((slot) => deployTile('party', slot)))
    const queue = [...seen]
    while (queue.length) {
      for (const n of steps(queue.shift(), walls)) if (!seen.has(n)) { seen.add(n); queue.push(n) }
    }
    for (const slot of open) assert.ok(seen.has(deployTile('party', slot)), `${c.id}: row ${rowOf(slot)} lane ${colOf(slot)} is sealed off`)
    assert.ok(c.map.every((line, r) => [...line].every((ch, col) => (ch === '#') === !campOpen(c.id, slotAt(r, col)))))
  }
})

// The cohorts are gone, and their banner shapes with them; orders, detachments, bonds and foes' orders too.
test('banner shapes, orders and bonds are gone', async () => {
  const content = await import('../src/content.js')
  for (const name of ['SHAPES', 'ORDERS', 'DETACHMENT_COLORS', 'FOE_ORDERS', 'BONDS', 'GRADES', 'PATHS']) assert.ok(!(name in content), name)
  assert.deepEqual(Object.keys(BEHAVIOURS), ['walk', 'flank'])
  assert.ok(Object.values(ROLES).every((r) => !('move' in r) && !('target' in r) && !('autoRow' in r)))
  assert.ok(Object.values(UNITS).every((u) => !('foeOrders' in u)))
})

// The tiers that once raised summons add a body to their kind's piece instead (DESIGN §2.8): one such tier per
// kin, at tier II.
test('count tiers: one kin each, at tier II, a body more each battle', () => {
  const tiers = Object.entries(TRACKS).flatMap(([id, tracks]) => tracks.flatMap((p) => p.tiers.flatMap((t, i) => (t.count ? [{ id, track: p.id, i, count: t.count }] : []))))
  assert.deepEqual(tiers.map((t) => [t.id, t.track, t.count]), [
    ['bone_chanter', 'marrowcaller', 1], ['hive_warden', 'brood_mother', 1], ['clockwork_page', 'gearwright', 1],
    ['thorn_dryad', 'heartwood', 1], ['frost_wyrm', 'ancient', 1]
  ])
  assert.ok(tiers.every((t) => t.i === 1), 'tier II')
  assert.equal(new Set(tiers.map((t) => UNITS[t.id].kin)).size, 5, 'every kin has one')
})

test('signals: at once, Time, Blow, Wave, Struck and Fallen, each named and described', () => {
  assert.deepEqual(Object.keys(SIGNALS), ['once', 'time', 'blow', 'wave', 'struck', 'falls'])
  for (const o of Object.values(SIGNALS)) assert.ok(o.name && o.desc, JSON.stringify(o))
})
