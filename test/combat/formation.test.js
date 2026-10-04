import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks } from '../../tools/packsource.node.js'
import { makeParty } from '../../src/sim/party.js'
import { createBattle } from '../../src/sim/combat/battle.js'
import { reachable, expand, frontmostRow, rowOf, colOf, slotAt, assignFormation } from '../../src/sim/combat/formation.js'

const { kernel, tuning } = await createGame({ packs: discoverPacks('packs'), seed: 1 })
const ability = (id) => kernel.registry.get('ability', id)

function fixture (partyIds, foeIds, slots = null) {
  const party = makeParty(kernel, partyIds, { side: 'party' })
  const foes = makeParty(kernel, foeIds, { side: 'foe' })
  if (slots) foes.forEach((u, i) => { u.slot = slots[i] })
  return createBattle({ kernel, tuning, party, foes, seed: 1 })
}

test('the grid is 3 rows × 4 columns and slot maths agrees with itself', () => {
  for (let s = 0; s < 12; s++) assert.equal(slotAt(rowOf(s), colOf(s)), s)
  assert.equal(rowOf(0), 0)
  assert.equal(rowOf(4), 1)
  assert.equal(rowOf(11), 2)
})

// The rule the whole formation layer exists for (§3).
test('melee reaches only the enemy\'s frontmost occupied row', () => {
  const b = fixture(['core:tomb_knight'], ['core:frost_sprite', 'core:bone_chanter'], [0, 8])
  const actor = b.units.find((u) => u.side === 'party')
  assert.equal(frontmostRow(b, 'foe'), 0)

  const melee = reachable(b, actor, ability('core:strike')).map((u) => u.slot)
  assert.deepEqual(melee, [0], 'the back-row Chanter is out of melee reach')

  const ranged = reachable(b, actor, ability('core:marrow_bolt')).map((u) => u.slot).sort()
  assert.deepEqual(ranged, [0, 8], 'ranged ignores depth entirely')
})

test('killing the front row exposes the next one — reach is recomputed, never cached', () => {
  const b = fixture(['core:tomb_knight'], ['core:frost_sprite', 'core:bone_chanter'], [0, 8])
  const actor = b.units.find((u) => u.side === 'party')
  b.units.find((u) => u.slot === 0 && u.side === 'foe').hp = 0
  assert.equal(frontmostRow(b, 'foe'), 2)
  assert.deepEqual(reachable(b, actor, ability('core:strike')).map((u) => u.slot), [8])
})

test('shapes read straight off the grid', () => {
  const foes = ['core:frost_sprite', 'core:frost_sprite', 'core:frost_sprite', 'core:frost_sprite']
  const b = fixture(['core:ember_drake'], foes, [0, 1, 4, 8])
  const actor = b.units.find((u) => u.side === 'party')
  const at = (slot) => b.units.find((u) => u.side === 'foe' && u.slot === slot)
  const slots = (list) => list.map((u) => u.slot).sort((a, c) => a - c)

  assert.deepEqual(slots(expand(b, actor, ability('core:marrow_bolt'), at(0))), [0], 'single')
  assert.deepEqual(slots(expand(b, actor, { shape: 'column' }, at(0))), [0, 4, 8], 'column pierces front to back')
  assert.deepEqual(slots(expand(b, actor, { shape: 'row' }, at(0))), [0, 1], 'row sweeps across')
  assert.deepEqual(slots(expand(b, actor, { shape: 'adjacent' }, at(0))), [0, 1, 4], 'adjacent is orthogonal splash')
  assert.deepEqual(slots(expand(b, actor, { shape: 'all' }, at(0))), [0, 1, 4, 8])
  assert.deepEqual(slots(expand(b, actor, { shape: 'slot', slot: 8 }, at(0))), [8], 'slot snipes past the front')
})

test('shapes never include the dead', () => {
  const b = fixture(['core:ember_drake'], ['core:frost_sprite', 'core:frost_sprite'], [0, 4])
  const actor = b.units.find((u) => u.side === 'party')
  const front = b.units.find((u) => u.side === 'foe' && u.slot === 0)
  b.units.find((u) => u.side === 'foe' && u.slot === 4).hp = 0
  assert.deepEqual(expand(b, actor, { shape: 'column' }, front).map((u) => u.slot), [0])
})

test('ally shapes target the actor\'s own side', () => {
  const b = fixture(['core:hive_warden', 'core:tomb_knight'], ['core:frost_sprite'])
  const actor = b.units.find((u) => u.side === 'party')
  for (const u of reachable(b, actor, ability('core:mend'))) assert.equal(u.side, 'party')
  assert.deepEqual(expand(b, actor, ability('core:dirge'), actor).map((u) => u.side), ['party', 'party'])
  assert.deepEqual(expand(b, actor, { shape: 'self' }, actor), [actor])
})

test('auto-fill puts Vanguards in front and Rangers in the back (§4)', () => {
  const units = makeParty(kernel, ['core:bone_chanter', 'core:tomb_knight', 'core:ember_drake'], { side: 'party' })
  const bySlot = Object.fromEntries(units.map((u) => [u.defId, rowOf(u.slot)]))
  assert.equal(bySlot['core:tomb_knight'], 0, 'Vanguard → front')
  assert.equal(bySlot['core:ember_drake'], 2, 'Ranger → back')
  assert.equal(bySlot['core:bone_chanter'], 2, 'Channeler → back')
})

test('auto-fill never double-books a slot, and overflows to the next row', () => {
  const ids = Array.from({ length: 12 }, () => 'core:tomb_knight')   // all want the front row
  const units = assignFormation(
    ids.map((id, i) => ({ uid: i, defId: id, slot: -1 })), kernel.registry
  )
  assert.equal(new Set(units.map((u) => u.slot)).size, 12)
  assert.deepEqual(units.map((u) => u.slot).sort((a, b) => a - b), [...Array(12).keys()])
})
