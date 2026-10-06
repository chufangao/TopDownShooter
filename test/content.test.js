import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { UNITS, ABILITIES, STATUSES, ELEMENTS, KIN, ROLES, SYNERGIES, RELIC_LIST, ANIMS, CAMP_LIST, BEHAVIOURS, ART_POSES, artUrl } from '../src/content.js'
import { statsOf, makeUnit, COLS, CAMP_ROWS, CAMP_SLOTS, campOpen, slotAt, rowOf, colOf, deployTile, wallTiles, steps } from '../src/sim/unit.js'
import { TUNING } from '../src/tuning.js'


const checkEffect = (e, where) => {
  assert.ok(['damage', 'heal', 'apply_status', 'cleanse', 'gauge'].includes(e.op), `${where}: op ${e.op}`)
  if (e.element) assert.ok(ELEMENTS[e.element], `${where}: element ${e.element}`)
  if (e.status) assert.ok(STATUSES[e.status], `${where}: status ${e.status}`)
}

test('every unit reference resolves', () => {
  for (const u of Object.values(UNITS)) {
    assert.ok(KIN[u.kin], `${u.id} kin`)
    assert.ok(ROLES[u.role], `${u.id} role`)
    assert.ok(ELEMENTS[u.element], `${u.id} element`)
    assert.ok(Number.isInteger(u.tier) && u.tier >= 1, `${u.id} tier`)
    for (const a of u.abilities) assert.ok(ABILITIES[a], `${u.id} ability ${a}`)
    for (const p of u.phases ?? []) assert.ok(STATUSES[p.grant], `${u.id} phase ${p.grant}`)
    assert.ok(u.boss || u.spawn, `${u.id} spawns`)
  }
  assert.equal(Object.keys(UNITS).length, 14)
})

test('every ability, status and synergy reference resolves', () => {
  for (const a of Object.values(ABILITIES)) {
    assert.ok(ELEMENTS[a.element], `${a.id} element`)
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
