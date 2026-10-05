import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { UNITS, ABILITIES, STATUSES, ELEMENTS, KIN, ROLES, SYNERGIES, RELIC_LIST, ANIMS } from '../src/content.js'
import { TUNING } from '../src/tuning.js'
import { statsOf, makeUnit } from '../src/sim/unit.js'

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)))
const atlas = new Set(json('../src/assets/atlas-0.json').frames.map((f) => f.filename))
const anims = new Map(json('../src/assets/anims.json').map((a) => [a.key, a]))

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
    assert.ok(TUNING.persuade.base[u.tier], `${u.id} tier`)
    for (const a of u.abilities) assert.ok(ABILITIES[a], `${u.id} ability ${a}`)
    for (const p of u.phases ?? []) assert.ok(STATUSES[p.grant], `${u.id} phase ${p.grant}`)
    assert.ok(u.boss || u.spawn, `${u.id} spawns`)
  }
  assert.equal(Object.keys(UNITS).length, 7)
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
  for (const s of SYNERGIES) assert.equal(typeof s.active({ kin: {}, role: {} }), 'boolean')
})

test('every unit has its frames and anims in the atlas', () => {
  const keys = new Set(Object.values(ANIMS).flatMap((t) => t.steps.filter((s) => s.op === 'anim').map((s) => s.key)))
  keys.add('idle').add('faint')
  for (const u of Object.values(UNITS)) {
    for (const k of keys) {
      const anim = anims.get(`${u.art}/${k}`)
      assert.ok(anim, `${u.id} anim ${k}`)
      for (const f of anim.frames) assert.ok(atlas.has(f), `${u.id} frame ${f}`)
    }
  }
})

test('a status shapes stats the way its mods say', () => {
  const u = makeUnit('frost_sprite', { uid: 1, lvl: 3 })
  const base = statsOf(u)
  assert.equal(base.atk, 15 + 2 * 2)
  const s = statsOf(u, [{ path: 'atk', op: 'add', v: 1 }, { path: 'atk', op: 'mul', v: 2 }, { path: 'charm', op: 'set', v: 7 }])
  assert.equal(s.atk, (base.atk + 1) * 2)
  assert.equal(s.charm, 7)
  const front = statsOf({ ...u, slot: 0 }, [{ path: 'def', op: 'mul', v: 2, row: 2 }])
  const back = statsOf({ ...u, slot: 8 }, [{ path: 'def', op: 'mul', v: 2, row: 2 }])
  assert.equal(back.def, front.def * 2)
  assert.throws(() => statsOf(u, [{ path: 'nope', op: 'add', v: 1 }]))
})
