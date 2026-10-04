// The draft/live split, which is the whole reason editing a rule mid-run is safe.
//
// The editors themselves are DOM and are exercised in a browser; this is the part of `src/ui/` that
// is pure data and therefore belongs in the same `node --test` suite as the sim. It is also the
// piece that would break silently: if `commit()` ever published a Doctrine with an unknown expr
// form, the game would throw on whichever tick first reached that rule — three nodes later, with a
// stack trace pointing at the evaluator rather than at the typo.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks } from '../../tools/packsource.node.js'
import { createDoctrineStore } from '../../src/ui/store.js'
import { DEFAULT_DOCTRINE } from '../../src/sim/doctrine.js'

const { kernel } = await createGame({ packs: discoverPacks('packs'), seed: 1 })

/** A localStorage stand-in, so the store is testable with no browser anywhere. */
function memory () {
  const map = new Map()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    dump: () => map
  }
}

test('a fresh store starts from the shipped set, with nothing bought and nothing to apply', () => {
  const store = createDoctrineStore({ kernel, storage: memory() })
  assert.equal(store.dirty, false)
  assert.deepEqual(store.draft.recruit, store.live.recruit)
  assert.deepEqual(store.errors(), [])
  assert.deepEqual(store.owned(), [], 'run 1 owns nothing, and nothing will hand it anything (§4.2)')
  assert.equal(store.codex(), 0)
})

/** A store holding one tenet, which is the smallest thing that can say anything at all. */
function bought (ids = ['core:parley_threshold']) {
  const store = createDoctrineStore({ kernel, storage: memory() })
  for (const id of ids) {
    // Discoveries first — a purchase is spending, and there is nothing to spend on run 1.
    store.discover(Array.from({ length: 9 }, (_, i) => `recruit:core:filler_${i}`))
    const res = store.purchase(id)
    assert.equal(res.bought, true, res.reason ?? '')
  }
  return store
}

test('★ nothing can be said until something has been bought', () => {
  const store = createDoctrineStore({ kernel, storage: memory() })
  store.update((d) => d.recruit.push({ when: ['lte', ['hpPct', '$target'], 0.5], action: 'persuade', at: 0.5 }))

  const errs = store.errors()
  assert.ok(errs.length, 'a rule in a field nothing was bought for must not be publishable')
  assert.match(errs[0].msg, /nothing bought/)
  assert.equal(store.commit(), false)
})

test('★ buying a tenet is the only thing that widens what the Doctrine may say', () => {
  const store = bought()
  assert.deepEqual(store.owned(), ['core:parley_threshold'])

  const cap = store.capabilities()
  assert.equal(cap.can('recruit'), true)
  assert.equal(cap.slotsFor('recruit'), 1)
  assert.equal(cap.hasForm('hpPct', 'unit'), true)
  assert.equal(cap.hasForm('kinCount', 'party'), false, 'a chip you did not buy is not in the menu')
  assert.equal(cap.hasAction('persuade'), true)
  assert.equal(cap.hasAction('decline'), false)

  store.update((d) => d.recruit.push({ when: ['lte', ['hpPct', '$target'], 0.5], action: 'persuade', at: 0.5 }))
  assert.deepEqual(store.errors(), [])
  assert.equal(store.commit(), true)
})

test('a purchase you cannot afford changes nothing and says why', () => {
  const store = createDoctrineStore({ kernel, storage: memory() })
  const res = store.purchase('core:parley_threshold')
  assert.equal(res.bought, false)
  assert.match(res.reason, /costs 2 Codex/)
  assert.deepEqual(store.owned(), [])
})

test('a prerequisite is a prerequisite, not a price rise', () => {
  const store = createDoctrineStore({ kernel, storage: memory() })
  store.discover(Array.from({ length: 9 }, (_, i) => `recruit:core:filler_${i}`))
  const res = store.purchase('core:parley_by_kin')
  assert.equal(res.bought, false)
  assert.match(res.reason, /needs Parley threshold first/)
})

test('the shop prices everything against what has actually been discovered', () => {
  const store = createDoctrineStore({ kernel, storage: memory() })
  const rows = store.shop()
  assert.ok(rows.length >= 15, 'the shop is a list of small things, not six big ones')
  assert.equal(rows.every((r) => r.cost >= 1), true, 'nothing is free — a free tenet is one nobody chose')
  assert.equal(rows.some((r) => r.affordable), false, 'and none of it is affordable before a run has paid')

  store.discover(['boss:core:hollow_sovereign', 'recruit:core:ember_drake'])
  assert.equal(store.codex(), 2)
  const after = store.shop().filter((r) => r.affordable)
  assert.ok(after.length, 'two discoveries should reach the entry tenets')
  assert.equal(after.every((r) => r.cost <= 2 && r.requires.length === 0), true,
    'and reach exactly the ones that open an area, which is the first decision the player makes')
})

test('editing moves the draft and leaves the live version alone', () => {
  const store = bought()
  store.update((d) => d.recruit.push({ when: ['lte', ['hpPct', '$target'], 0.5], action: 'kill' }))
  assert.equal(store.draft.recruit[0].action, 'kill')
  assert.equal(store.live.recruit.length, 0, 'the run must keep fighting by the applied version')
  assert.equal(store.dirty, true)
})

test('committing publishes and persists; reverting throws the edits away', () => {
  const storage = memory()
  const store = createDoctrineStore({ kernel, storage })
  store.discover(['boss:core:hollow_sovereign', 'recruit:core:ember_drake'])
  assert.equal(store.purchase('core:cut_rule').bought, true)
  store.update((d) => { d.cut = 'lowestHp' })
  assert.equal(store.commit(), true)
  assert.equal(store.live.cut, 'lowestHp')
  assert.equal(store.dirty, false)

  const reloaded = createDoctrineStore({ kernel, storage })
  assert.equal(reloaded.live.cut, 'lowestHp', 'a committed Doctrine should survive a reload')
  assert.deepEqual(reloaded.owned(), ['core:cut_rule'], 'and so should what paid for it')

  reloaded.update((d) => { d.cut = 'lowestTier' })
  reloaded.revert()
  assert.equal(reloaded.draft.cut, 'lowestHp')
  assert.equal(reloaded.dirty, false)
})

test('★ a Doctrine with an error cannot go live', () => {
  const store = bought()
  store.update((d) => d.recruit.push({ when: ['no_such_form', 1], action: 'persuade', at: 0.3 }))
  assert.ok(store.errors().length > 0)
  assert.equal(store.commit(), false)
  assert.deepEqual(store.live.recruit, [], 'the run keeps fighting by what was last applied')
})

test('a corrupt stored draft falls back to the shipped set rather than failing to boot', () => {
  const storage = memory()
  storage.setItem('retinue:doctrine:v1', '{ not json')
  const store = createDoctrineStore({ kernel, storage })
  assert.deepEqual(store.live.recruit, store.draft.recruit)
  assert.deepEqual(store.errors(), [])
})

test('no storage at all is a supported configuration', () => {
  const store = createDoctrineStore({ kernel, storage: null })
  store.discover(['boss:core:hollow_sovereign', 'recruit:core:ember_drake'])
  assert.equal(store.purchase('core:cut_rule').bought, true)
  store.update((d) => { d.cut = 'lowestHp' })
  assert.equal(store.commit(), true)
  assert.equal(store.live.cut, 'lowestHp')
})

test('subscribers hear about edits, purchases and commits, and can tell them apart', () => {
  const store = createDoctrineStore({ kernel, storage: memory() })
  const heard = []
  store.subscribe((what) => heard.push(what))
  store.discover(['boss:core:hollow_sovereign', 'recruit:core:ember_drake'])
  store.purchase('core:cut_rule')
  store.update((d) => { d.cut = 'lowestHp' })
  store.commit()
  assert.deepEqual(heard, ['codex', 'commit', 'draft', 'commit'])
})
