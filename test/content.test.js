import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { UNITS, ABILITIES, STATUSES, KIN, ROLES, SYNERGIES, RELIC_LIST, ANIMS, CAMP_LIST, BEHAVIOURS, ART_POSES, artUrl, PATHS, THREATS, SHAPES, ORDERS, DETACHMENT_COLORS } from '../src/content.js'
import { statsOf, abilitiesOf, auraOf, cheapestOf, costliestOf, makeUnit, baseStats, activeSynergies, activeBonds, COLS, CAMP_ROWS, CAMP_SLOTS, campOpen, slotAt, rowOf, colOf, deployTile, wallTiles, steps } from '../src/sim/unit.js'
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
    assert.ok(u.boss || u.spawn, `${u.id} spawns`)
    assert.ok(u.threats?.length && u.threats.every((t) => THREATS[t]), `${u.id} threats`)
    assert.equal(new Set(u.threats).size, u.threats.length, `${u.id} threats repeat`)
  }
  assert.equal(Object.keys(UNITS).length, 15)
  // Floor 1's pool carries every threat type but depth (a room's, not a kind's: it comes with waves).
  const floor1 = Object.values(UNITS).filter((u) => u.spawn?.minFloor === 1)
  assert.deepEqual(new Set(floor1.flatMap((u) => u.threats)), new Set(Object.keys(THREATS).filter((t) => t !== 'depth')))
  assert.ok(!Object.values(UNITS).some((u) => u.threats?.includes('depth')))
})

test('the Monarch: one of a kind, never spawned, never striking, its HP from the run, hidden from synergies and bonds', () => {
  const m = UNITS.monarch
  assert.deepEqual([m.name, m.kin, m.role, m.tier, m.monarch, m.spawn, m.abilities], ['The Monarch', null, 'monarch', 0, true, undefined, ['arise']])
  assert.equal(Object.values(UNITS).filter((u) => u.monarch).length, 1)
  assert.deepEqual([ROLES.monarch.move, ROLES.monarch.autoRow, ROLES.monarch.hidden], ['stand', 3, true])
  assert.equal(BEHAVIOURS.stand.slips, false)
  const arise = ABILITIES.arise
  assert.deepEqual([arise.castCost, arise.shape, arise.anim, arise.effects], [200, 'corpse', 'cast_beam', [{ op: 'raise' }]])
  assert.ok(!Object.values(UNITS).some((u) => !u.monarch && u.abilities.includes('arise')))
  // Level = points spent; only HP grows with it.
  const T = TUNING.monarch
  for (const lvl of [0, 1, 5]) assert.equal(baseStats('monarch', lvl).hp, T.hp + T.hpPerPoint * lvl)
  assert.deepEqual({ ...baseStats('monarch', 5), hp: 0 }, { ...baseStats('monarch', 0), hp: 0 })
  assert.equal(makeUnit('monarch', { uid: 0, lvl: 0 }).maxHp, T.hp)
  // Two undead and the Monarch are Undead 2, not 3; it holds and gives no bond, though it stands beside.
  const at = (id, uid, row, col) => makeUnit(id, { uid, slot: slotAt(row, col) })
  const party = [at('bone_chanter', 1, 0, 3), at('monarch', 0, 0, 4), at('grave_ghoul', 2, 0, 5)]
  assert.deepEqual(activeSynergies(party).map((s) => s.id), ['undead_2'])
  assert.deepEqual(activeSynergies([party[1], party[1]]), [])
  assert.deepEqual(activeBonds(party), [])
  assert.deepEqual(activeBonds([at('bone_chanter', 1, 0, 3), at('grave_ghoul', 2, 0, 4)]).map((b) => b.bond.id), ['kinship', 'kinship'])
})

test('every soul has two or three upgrade paths of four tiers (IV a rank\'s), and every tier resolves', () => {
  for (const u of Object.values(UNITS)) {
    const paths = PATHS[u.id] ?? []
    if (u.boss || u.monarch) { assert.equal(paths.length, 0); continue }
    assert.ok(paths.length >= 2 && paths.length <= 3, `${u.id} paths`)
    assert.equal(new Set(paths.map((p) => p.id)).size, paths.length, `${u.id} path ids`)
    for (const p of paths) {
      assert.ok(p.name && p.desc && p.tiers.length === 4, `${u.id} ${p.id}`)
      const soul = { ...makeUnit(u.id, { uid: 1 }), path: p.id }
      for (const [i, t] of p.tiers.entries()) {
        const where = `${u.id} ${p.id} ${i + 1}`
        assert.ok(t.desc && (t.mods || t.ability || t.aura), where)
        const before = abilitiesOf({ ...soul, tier: i })
        if (t.ability) {
          assert.ok(ABILITIES[t.ability.id], `${where}: ability ${t.ability.id}`)
          if (t.ability.replace) assert.ok(before.includes(t.ability.replace), `${where}: replaces ${t.ability.replace}`)
          assert.ok(abilitiesOf({ ...soul, tier: i + 1 }).includes(t.ability.id), where)
        }
        if (t.aura) assert.ok(t.aura.range >= 1 && t.aura.mods.length && auraOf({ ...soul, tier: i + 1 }) === t.aura, where)
        statsOf({ ...soul, tier: i + 1 })
        // The gauge saves toward abilities only (a step is free) and banks no further than the dearest.
        const costs = abilitiesOf({ ...soul, tier: i + 1 }).map((a) => ABILITIES[a].castCost)
        assert.deepEqual([cheapestOf({ ...soul, tier: i + 1 }), costliestOf({ ...soul, tier: i + 1 })], [Math.min(...costs), Math.max(...costs)], where)
      }
    }
  }
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
  for (const r of Object.values(ROLES)) assert.ok(BEHAVIOURS[r.move], `${r.id} moves by a known behaviour`)
})

// A banner's shape: offsets from its captain's cell, each a different cell, never the captain's own, behind or
// level with it (the camp's rows rise toward the rear) but for the mouth's horns, a row ahead; within the
// camp's reach; enough of them for a cohort as large as the board holds bodies besides its captain, before the
// nearest open cell takes the rest.
test('banner shapes: pair, line, wedge, block and mouth, each an ordered list of distinct offsets from the captain', () => {
  assert.deepEqual(Object.keys(SHAPES), ['pair', 'line', 'wedge', 'block', 'mouth'])
  for (const [id, shape] of Object.entries(SHAPES)) {
    assert.ok(shape.name && shape.desc, id)
    const keys = shape.offsets.map(([r, c]) => `${r},${c}`)
    assert.equal(new Set(keys).size, keys.length, `${id}: repeats an offset`)
    assert.ok(!keys.includes('0,0'), `${id}: the captain's own cell`)
    for (const [r, c] of shape.offsets) assert.ok(Number.isInteger(r) && Number.isInteger(c) && r >= (id === 'mouth' ? -1 : 0) && r < CAMP_ROWS && Math.abs(c) < COLS, `${id}: ${r},${c}`)
    assert.ok(shape.offsets.length >= TUNING.army.board - 2, `${id}: ${shape.offsets.length} offsets`)
  }
  // Each shape is its own: the first members of a cohort stand differently in each.
  assert.equal(new Set(Object.values(SHAPES).map((x) => JSON.stringify(x.offsets.slice(0, 3)))).size, 5)
  // The mouth: its first seven all within a tile of the captain (none walks to close it), and the tile ahead
  // of the captain never among them: the gap the trap is.
  const mouth = SHAPES.mouth.offsets.slice(0, 7)
  assert.ok(mouth.every(([r, c]) => Math.max(Math.abs(r), Math.abs(c)) === 1))
  assert.ok(!SHAPES.mouth.offsets.some(([r, c]) => r === -1 && c === 0))
  assert.deepEqual(mouth.slice(0, 2), [[-1, -1], [-1, 1]], 'the horns first')
})

test('orders: where (Hunt, Stay, Move) and when (at once, a time, three triggers), and a colour for every detachment', () => {
  assert.deepEqual(Object.keys(ORDERS.where), ['hunt', 'stay', 'move'])
  assert.deepEqual(Object.keys(ORDERS.when), ['once', 'time', 'struck', 'wave', 'falls'])
  for (const o of [...Object.values(ORDERS.where), ...Object.values(ORDERS.when)]) assert.ok(o.name && o.desc, JSON.stringify(o))
  assert.ok(DETACHMENT_COLORS.length >= TUNING.army.detachments)
  assert.equal(new Set(DETACHMENT_COLORS).size, DETACHMENT_COLORS.length)
  assert.ok(DETACHMENT_COLORS.every((c) => /^#[0-9a-f]{6}$/.test(c)))
})
