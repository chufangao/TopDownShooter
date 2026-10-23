// The one DEF ward: Barkskin and Veiled merged into
// Barkskin, DEF ×1.25; every ability, tier, relic or rule that laid Veiled lays Barkskin. Functional: the records.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STATUSES, STATUS_WORTH, ABILITIES, UNIT_LIST, RELIC_LIST, SYNERGIES, FUSION_LIST, MONARCH_LIST } from '../src/content.js'

// Every status an effect lays, anywhere in a record (an ability's effects, a relic's, a tier's ability or aura).
function laid (x, out = new Set()) {
  if (Array.isArray(x)) for (const y of x) laid(y, out)
  else if (x && typeof x === 'object') {
    if (x.op === 'apply_status' && x.status) out.add(x.status)
    for (const v of Object.values(x)) laid(v, out)
  }
  return out
}

test('nothing lays Veiled: it is no status and has no worth; Veil and Court Eternal lay Barkskin', () => {
  // The glossary's statuses are STATUSES' own (keywords.js): no word for it either.
  assert.ok(!('veiled' in STATUSES) && !('veiled' in STATUS_WORTH))
  assert.equal(Object.keys(STATUSES).length, 14)
  const all = laid([Object.values(ABILITIES), UNIT_LIST, RELIC_LIST, Object.values(SYNERGIES), FUSION_LIST, MONARCH_LIST])
  assert.ok(!all.has('veiled'), [...all].join(', '))
  for (const id of all) assert.ok(STATUSES[id], `${id}: a status`)
  for (const id of ['veil', 'court_eternal']) assert.ok(laid(ABILITIES[id]).has('barkskin'), id)
  for (const text of [...UNIT_LIST, ...RELIC_LIST].map((r) => JSON.stringify(r))) assert.ok(!/Veiled/.test(text), text.slice(0, 80))
  assert.deepEqual(STATUSES.barkskin.mods, [{ path: 'def', op: 'mul', v: 1.25 }])
})
