import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  UNITS, ABILITIES, STATUSES, KIN, ROLES, SYNERGIES, RELIC_LIST, RELICS, ANIMS, CAMP_LIST, BEHAVIOURS, ART_POSES, artUrl, TRACKS, THREATS, TRIGGERS,
  FUSION_LIST, FUSIONS, fusionDef
} from '../src/content.js'
import {
  statsOf, abilitiesOf, auraOf, cheapestOf, costliestOf, makeUnit, baseStats, activeSynergies, COLS, CAMP_ROWS, CAMP_SLOTS, campOpen, slotAt, rowOf, colOf,
  deployTile, wallTiles, steps, bodiesOf, rangeOf, isAllyShape, ringOf, sizeOf, monarchSlot, isMonarchCell, sealedBy, fits, tileAt, DEPTH, ROWS, TILES
} from '../src/sim/unit.js'
import { TUNING } from '../src/tuning.js'

const checkEffect = (e, where) => {
  assert.ok(['damage', 'heal', 'apply_status', 'cleanse', 'gauge', 'raise', 'dot'].includes(e.op), `${where}: op ${e.op}`)
  if (e.status) assert.ok(STATUSES[e.status], `${where}: status ${e.status}`)
}

// The blows of a kind that carry a range of their own (a ranged kind's reach).
const rangedBlows = (u) => u.abilities.map((a) => ABILITIES[a]).filter((a) => !isAllyShape(a.shape) && a.shape !== 'corpse' && a.range)

test('every unit reference resolves; every foe carries its threats; a fused kind none', () => {
  for (const u of Object.values(UNITS)) {
    if (u.monarch) continue
    assert.ok(KIN[u.kin], `${u.id} kin`)
    assert.ok(ROLES[u.role] && !ROLES[u.role].hidden, `${u.id} role`)
    assert.ok(Number.isInteger(u.tier) && u.tier >= 1, `${u.id} tier`)
    for (const a of u.abilities) assert.ok(ABILITIES[a], `${u.id} ability ${a}`)
    for (const p of u.phases ?? []) assert.ok(STATUSES[p.grant], `${u.id} phase ${p.grant}`)
    // A ring: a ranged kind's reach (its farthest blow's range); a melee kind's 1, or 2 for a long arm. A stride, if
    // any: slow (0.5, 0.75) or quick (1.5). A size, if any: 2.
    const blows = rangedBlows(u)
    if (blows.length) assert.equal(u.ring, Math.max(...blows.map(rangeOf)), `${u.id} ring`)
    else assert.ok([1, 2].includes(u.ring), `${u.id} ring`)
    assert.ok(u.stride === undefined || [0.5, 0.75, 1.5].includes(u.stride), `${u.id} stride`)
    assert.ok(u.size === undefined || u.size === 2, `${u.id} size`)
    assert.equal(sizeOf(makeUnit(u.id, { uid: 1 })), u.size ?? 1, `${u.id} sizeOf`)
    assert.ok(!('summon' in u), `${u.id}: no summon kinds: a tier adds bodies to its own piece`)
    for (const k of ['line', 'leg', 'home', 'leader', 'offset', 'lunges', 'banner']) assert.ok(!(k in u), `${u.id}: no ${k}`)
    assert.ok(u.flavour, `${u.id} flavour`)
    // A death burst: its effects resolve and reach a tile or more.
    if (u.onFall) {
      assert.ok(Number.isInteger(u.onFall.range) && u.onFall.range >= 1 && u.onFall.effects.length, `${u.id} onFall`)
      for (const e of u.onFall.effects) checkEffect(e, `${u.id} onFall`)
    }
    // A fused kind is made, never met: no spawn, no threats, no behaviour, never a boss.
    if (u.fused) {
      assert.ok(!u.spawn && !u.boss && !u.threats && !u.behaviour && !u.flies && !u.onFall, `${u.id}: fused`)
      continue
    }
    // Flank is rare, and a Flank kind carries the flank threat; a Walk kind never does. A flyer flies, carries the
    // fly threat and keeps no road; no other kind does.
    assert.equal(u.behaviour === 'flank', !!u.threats?.includes('flank'), `${u.id} flank`)
    assert.equal(u.behaviour === 'fly', !!u.flies, `${u.id} flies`)
    assert.equal(u.behaviour === 'fly', !!u.threats?.includes('fly'), `${u.id} fly threat`)
    assert.ok(u.boss || u.spawn, `${u.id} spawns`)
    assert.ok(BEHAVIOURS[u.behaviour], `${u.id} walks the roads by a known behaviour`)
    assert.ok(u.threats?.length && u.threats.every((t) => THREATS[t]), `${u.id} threats`)
    assert.equal(new Set(u.threats).size, u.threats.length, `${u.id} threats repeat`)
  }
  assert.equal(Object.keys(UNITS).length, 25)
  // Identity on the board: two long arms, the slow and the quick, three Flank kinds, two flyers, one death burst.
  const of = (f) => Object.values(UNITS).filter(f).map((u) => u.id).sort()
  assert.deepEqual(of((u) => u.ring === 2 && !rangedBlows(u).length), ['grave_ghoul', 'mantis_reaper'])
  assert.deepEqual(of((u) => u.stride < 1), ['frost_wyrm', 'iron_golem', 'rot_bloat', 'thorn_dryad', 'tomb_knight'])
  assert.deepEqual(of((u) => u.stride > 1), ['frost_sprite', 'mantis_reaper', 'pyre_hound'])
  assert.deepEqual(of((u) => u.behaviour === 'flank'), ['barrow_wight', 'mantis_reaper', 'will_o_wisp'])
  assert.deepEqual(of((u) => u.flies), ['ash_wyvern', 'hive_drone'])
  assert.deepEqual(of((u) => u.onFall), ['rot_bloat'])
  assert.deepEqual(of((u) => u.size === 2), ['bone_colossus', 'clockwork_titan', 'hive_queen'])
  // The foes scale in kind by floor (DESIGN §2.4): floor 1's pool carries every threat type but depth (a room's, not
  // a kind's: it comes with waves) and fly; floor 2 brings the flyer and the death burst; floor 3 the hex and the
  // flying burner.
  const pool = (floor) => Object.values(UNITS).filter((u) => u.spawn?.minFloor === floor)
  assert.deepEqual(new Set(pool(1).flatMap((u) => u.threats)), new Set(Object.keys(THREATS).filter((t) => t !== 'depth' && t !== 'fly')))
  assert.ok(pool(1).some((u) => u.abilities.some((a) => ABILITIES[a].effects.some((e) => e.status === 'burning'))), 'Burning on floor 1')
  assert.ok(pool(2).some((u) => u.flies) && pool(2).some((u) => u.onFall), 'Fly and the death burst on floor 2')
  assert.ok(!pool(1).some((u) => u.flies || u.onFall))
  assert.ok(pool(3).some((u) => u.abilities.some((a) => ABILITIES[a].effects.some((e) => e.status === 'hexed'))), 'Hexed on floor 3')
  assert.ok(pool(3).some((u) => u.flies && u.threats.includes('burn')), 'a flying burner on floor 3')
  assert.ok(![1, 2].some((f) => pool(f).some((u) => u.abilities.some((a) => ABILITIES[a].effects.some((e) => e.status === 'hexed')))), 'no Hexed before floor 3')
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
  // No level and no points: its base HP whatever `lvl` says (its HP relics are the run's: run.js monarchHp).
  const T = TUNING.monarch
  for (const lvl of [0, 1, 5]) assert.equal(baseStats('monarch', lvl).hp, T.hp)
  assert.deepEqual(baseStats('monarch', 5), baseStats('monarch', 0))
  assert.equal(makeUnit('monarch', { uid: 0, lvl: 0 }).maxHp, T.hp)
  // Two undead and the Monarch are Undead 2, not 3.
  const at = (id, uid, row, col) => makeUnit(id, { uid, slot: slotAt(row, col) })
  const party = [at('bone_chanter', 1, 0, 3), at('monarch', 0, 0, 4), at('grave_ghoul', 2, 0, 5)]
  assert.deepEqual(activeSynergies(party).map((s) => s.id), ['undead_2'])
  assert.deepEqual(activeSynergies([party[1], party[1]]), [])
})

test('every kind of soul has two tracks of four tiers, IV a rule, I–II never remaking what the other track does, and every tier resolves', () => {
  const colossi = []
  for (const u of Object.values(UNITS)) {
    const paths = TRACKS[u.id] ?? []
    if (u.boss || u.monarch) { assert.equal(paths.length, 0); continue }
    assert.equal(paths.length, 2, `${u.id} tracks`)
    assert.equal(new Set(paths.map((p) => p.id)).size, paths.length, `${u.id} track ids`)
    for (const [k, p] of paths.entries()) {
      assert.ok(p.name && p.desc && p.tiers.length === 4, `${u.id} ${p.id}`)
      const soul = makeUnit(u.id, { uid: 1 })
      const at = (n) => ({ ...soul, tracks: k ? [0, n] : [n, 0] })
      // Tiers I–II, which the other track may sit beside, remake no ability and grant no aura. IV is a rule, never a
      // percentage: a new or remade ability, an aura, a wider ring, or Colossus (DESIGN §2.6).
      assert.ok(p.tiers.slice(0, 2).every((t) => !t.ability && !t.aura), `${u.id} ${p.id}: I–II`)
      const iv = p.tiers[3]
      assert.ok(!iv.mods && (iv.ability || iv.aura || iv.ring || iv.size === 2), `${u.id} ${p.id}: IV a rule`)
      assert.ok(p.tiers.slice(0, 3).every((t) => !('size' in t)), `${u.id} ${p.id}: Colossus at IV only`)
      if (iv.size) {
        assert.ok(iv.size === 2 && !u.size, `${u.id} ${p.id}: Colossus grows a kind of size 1 to 2`)
        colossi.push(`${u.id}:${k}`)
      }
      for (const [i, t] of p.tiers.entries()) {
        const where = `${u.id} ${p.id} ${i + 1}`
        assert.ok(t.desc && (t.mods || t.ability || t.aura || t.count || t.ring || t.size), where)
        for (const gone of ['summon', 'banner', 'stride']) assert.ok(!(gone in t), `${where}: no ${gone}`)
        // A tier with a count adds that many bodies to the piece each battle, from that tier on.
        if (t.count) assert.ok(Number.isInteger(t.count) && t.count >= 1 && bodiesOf(at(i + 1)) === bodiesOf(at(i)) + t.count, `${where}: count`)
        const before = abilitiesOf(at(i))
        if (t.ability) {
          assert.ok(ABILITIES[t.ability.id], `${where}: ability ${t.ability.id}`)
          if (t.ability.replace) assert.ok(before.includes(t.ability.replace), `${where}: replaces ${t.ability.replace}`)
          assert.ok(abilitiesOf(at(i + 1)).includes(t.ability.id), where)
        }
        if (t.aura) assert.ok(t.aura.range >= 1 && t.aura.mods.length && auraOf(at(i + 1)) === t.aura, where)
        assert.equal(sizeOf(at(i + 1)), t.size ?? sizeOf(at(i)), `${where}: size`)
        assert.ok(ringOf(at(i + 1)) >= ringOf(at(i)), where)
        // The card never lies: no blow it holds reaches past its ring (one with no range reaches the board, and so
        // must the ring).
        const reach = Math.max(1, ...abilitiesOf(at(i + 1)).map((a) => ABILITIES[a]).filter((a) => !isAllyShape(a.shape) && a.shape !== 'corpse').map((a) => Math.min(rangeOf(a), DEPTH - 1)))
        assert.ok(ringOf(at(i + 1)) >= reach, `${where}: ring ${ringOf(at(i + 1))}, reach ${reach}`)
        statsOf(at(i + 1))
        // The gauge saves toward abilities only (a step is free) and banks no further than the dearest.
        const costs = abilitiesOf(at(i + 1)).map((a) => ABILITIES[a].castCost)
        assert.deepEqual([cheapestOf(at(i + 1)), costliestOf(at(i + 1))], [Math.min(...costs), Math.max(...costs)], where)
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
  // The statuses the foes bring (DESIGN §2.4): Burning a damage-over-time up to 3 stacks, Hexed a slower gauge; both
  // debuffs, so Purge and Molt cleanse them.
  const { burning, hexed } = STATUSES
  assert.deepEqual([burning.stacks, burning.tick.map((e) => e.op), burning.tags], [3, ['dot'], ['debuff']])
  assert.ok(burning.tick[0].power > 0 && burning.tickEvery > 0)
  assert.ok(hexed.tags.includes('debuff') && hexed.mods.some((x) => x.path === 'gauge.rate' && x.op === 'mul' && x.v < 1))
  // A relic's moments: no march, the wave instead.
  assert.deepEqual(TRIGGERS, ['kill', 'fall', 'wave', 'blow', 'struck'])
  for (const r of RELIC_LIST) if (r.on) assert.ok(TRIGGERS.includes(r.on), `${r.id} on ${r.on}`)
  assert.equal(RELICS.tower_shield.on, 'wave')
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
  const arts = Object.values(UNITS).map((u) => u.art)
  assert.equal(new Set(arts).size, arts.length, 'every kind its own pictures')
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
    // From the seat a road reaches every tile of the foes' rows (the roads' flood: test/battle.test.js), and the seat
    // cuts no cell off from the open ground ahead of the camp.
    const roads = flood([deployTile('party', seat)])
    for (let t = tileAt(0, DEPTH - ROWS); t < TILES; t++) assert.ok(roads.has(t), `${c.id}: no road from tile ${t}`)
    assert.deepEqual(sealedBy(c.id, seat), [], c.id)
    // A 2×2 has somewhere to stand.
    assert.ok(open.some((slot) => fits(c.id, slot, 2)), `${c.id}: no room for a 2×2`)
    assert.ok(c.map.every((line, r) => [...line].every((ch, col) => (ch === '#') === !campOpen(c.id, slotAt(r, col)))))
  }
})

// The cohorts are gone, and their banner shapes with them; orders, detachments, bonds and foes' orders too; and with
// the lines, the signals and Banner (DESIGN §2.9).
test('banner shapes, orders, bonds, signals and Banner are gone', async () => {
  const content = await import('../src/content.js')
  for (const name of ['SHAPES', 'ORDERS', 'DETACHMENT_COLORS', 'FOE_ORDERS', 'BONDS', 'GRADES', 'PATHS', 'SIGNALS', 'BANNER']) assert.ok(!(name in content), name)
  assert.deepEqual(Object.keys(BEHAVIOURS), ['walk', 'flank', 'fly'])
  for (const b of Object.values(BEHAVIOURS)) assert.ok(b.name && b.desc, JSON.stringify(b))
  assert.ok(Object.values(ROLES).every((r) => !('move' in r) && !('target' in r) && !('autoRow' in r)))
  assert.ok(Object.values(UNITS).every((u) => !('foeOrders' in u)))
})

// The tiers that once raised summons add bodies to their kind's piece instead (DESIGN §2.6): one such tier per
// kin, at tier II (three bodies since the balance pass).
test('count tiers: one kin each, at tier II, bodies more each battle', () => {
  const tiers = Object.entries(TRACKS).flatMap(([id, tracks]) => tracks.flatMap((p) => p.tiers.flatMap((t, i) => (t.count ? [{ id, track: p.id, i, count: t.count }] : []))))
  assert.deepEqual(tiers.map((t) => [t.id, t.track, t.count]), [
    ['bone_chanter', 'marrowcaller', 3], ['hive_warden', 'brood_mother', 3], ['clockwork_page', 'gearwright', 3],
    ['thorn_dryad', 'heartwood', 3], ['frost_wyrm', 'ancient', 3]
  ])
  assert.ok(tiers.every((t) => t.i === 1), 'tier II')
  assert.equal(new Set(tiers.map((t) => UNITS[t.id].kin)).size, 5, 'every kin has one')
})

// Fusions (DESIGN §2.6): five recipes to start, public, each of real parts into a fused kind.
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
    assert.ok(parts.reduce((n, [, k]) => n + k, 0) >= 2, `${r.id}: more than one body`)
    for (const [kind, n] of parts) {
      const def = UNITS[kind]
      assert.ok(def && def.spawn && !def.fused && !def.boss && !def.monarch && Number.isInteger(n) && n >= 1, `${r.id}: part ${kind}`)
    }
  }
  assert.throws(() => fusionDef('nothing'))
  const fused = Object.values(UNITS).filter((u) => u.fused).map((u) => u.id).sort()
  assert.deepEqual(FUSION_LIST.map((r) => r.result).sort(), fused, 'every fused kind, once')
})
