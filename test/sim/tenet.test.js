// Tenets (§4.2) — what the player buys, and what buying it lets them say.
//
// The design these tests pin down replaced two earlier ones, and the reason is worth stating once:
// M3 gave the player every editor on minute one, M3.5 gave them a whole editor whenever the game
// decided they needed it, and both left the most consequential decision in the system — what you
// are able to say at all — being made by something other than the player. A tenet is small enough
// to price, plain enough to compare, and bought.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks } from '../../tools/packsource.node.js'
import { capabilities, spendable, spentOn, shop, buy, priceOf, STRUCTURAL_GROUPS } from '../../src/sim/tenet.js'
import { DEFAULT_DOCTRINE, normalize, validate, rulesFor, STANDING_ORDERS } from '../../src/sim/doctrine.js'

const { kernel } = await createGame({ packs: discoverPacks('packs'), seed: 1 })
const R = kernel.registry

/** A profile that has discovered `n` things and bought `owned`. */
const profile = (n = 0, owned = []) => ({
  codex: Array.from({ length: n }, (_, i) => `recruit:core:thing_${i}`),
  tenets: owned
})

// ── nothing, which is where everyone starts ─────────────────────────────────────────────────────

test('★ owning nothing means being able to say nothing', () => {
  const cap = capabilities(R, [])
  assert.equal(cap.empty, true)
  for (const path of ['recruit', 'ability', 'branch', 'cut', 'formation.pins', 'targeting.default']) {
    assert.equal(cap.can(path), false, path)
    assert.equal(cap.slotsFor(path), 0, path)
  }
  assert.equal(cap.hasMode('healersFirst'), false)
  assert.equal(cap.hasAction('persuade'), false)
})

test('the structural half of the language is always free', () => {
  const cap = capabilities(R, [])
  // `and`, `≤` and a number are how any rule is built and say nothing about the game.
  for (const group of STRUCTURAL_GROUPS) assert.equal(cap.hasForm('whatever', group), true, group)
  // Everything that reads a fact about the world is bought.
  assert.equal(cap.hasForm('hpPct', 'unit'), false)
  assert.equal(cap.hasForm('kinCount', 'party'), false)
})

test('★ the standing orders run for a player who has bought nothing, and are not theirs to edit', () => {
  const d = normalize(DEFAULT_DOCTRINE)
  assert.deepEqual(d.recruit, [], 'the panel would open empty — no pre-written rows they did not write')
  assert.equal(rulesFor(d, 'recruit').length, STANDING_ORDERS.recruit.length,
    'and the party still fights by three rules, because that is how a retinue with no orders behaves')
  assert.deepEqual(rulesFor(d, 'recruit'), [...STANDING_ORDERS.recruit])
})

test('a bought rule goes in front of the standing orders, never instead of them', () => {
  const mine = { when: ['lte', ['hpPct', '$target'], 0.5], action: 'persuade', at: 0.5 }
  const d = normalize({ tenets: ['core:parley_threshold'], recruit: [mine] })
  const all = rulesFor(d, 'recruit')
  assert.deepEqual(all[0], mine, 'what a slot buys is the right to be heard first')
  assert.equal(all.length, STANDING_ORDERS.recruit.length + 1)
})

// ── buying ──────────────────────────────────────────────────────────────────────────────────────

test('★ a purchase is the only thing that widens what may be said', () => {
  const before = capabilities(R, [])
  const after = capabilities(R, ['core:parley_threshold'])

  assert.equal(before.can('recruit'), false)
  assert.equal(after.can('recruit'), true)
  assert.equal(after.slotsFor('recruit'), 1)
  assert.equal(after.hasForm('hpPct', 'unit'), true)
  assert.equal(after.hasForm('kinCount', 'party'), false, 'and only as wide as the one thing bought')
})

test('capabilities are additive and order-independent', () => {
  const ids = ['core:parley_threshold', 'core:parley_by_kin', 'core:parley_second_rule']
  const a = capabilities(R, ids)
  const b = capabilities(R, [...ids].reverse())
  assert.deepEqual(a.owned, b.owned)
  assert.equal(a.slotsFor('recruit'), 2)
  assert.equal(b.slotsFor('recruit'), 2, 'two players who bought the same things hold the same Doctrine')
  assert.equal(a.hasForm('kin', 'unit'), true)
})

test('Codex spent is Codex gone', () => {
  const p = profile(9)
  assert.equal(spendable(R, p), 9)
  const res = buy(R, p, 'core:parley_threshold')
  assert.equal(res.bought, true)
  assert.equal(spentOn(R, res.tenets), 2)
  assert.equal(spendable(R, { ...p, tenets: res.tenets }), 7)
})

test('a purchase you cannot afford changes nothing and names the price', () => {
  const res = buy(R, profile(1), 'core:parley_threshold')
  assert.equal(res.bought, false)
  assert.match(res.reason, /costs 2 Codex; you have 1/)
  assert.deepEqual(res.tenets, [])
})

test('a prerequisite is a prerequisite, not a price rise', () => {
  const res = buy(R, profile(50), 'core:parley_by_kin')
  assert.equal(res.bought, false)
  assert.match(res.reason, /needs Parley threshold first/)

  const { affordable, blocked } = priceOf(R, 'core:parley_by_kin', { owned: ['core:parley_threshold'], codex: 50 })
  assert.deepEqual(blocked, [])
  assert.equal(affordable, true)
})

test('buying the same thing twice is refused rather than charged twice', () => {
  const res = buy(R, profile(50, ['core:cut_rule']), 'core:cut_rule')
  assert.equal(res.bought, false)
  assert.match(res.reason, /already held/)
})

// ── the shop ────────────────────────────────────────────────────────────────────────────────────

test('★ the shop is longer than the game can pay for, on purpose', () => {
  const rows = shop(R, profile(0))
  const total = rows.reduce((n, r) => n + r.cost, 0)

  // Codex is a count of discoveries and is not farmable (§5): with the current roster the ceiling
  // is one boss, seven species and six Pacts. A shop you can finish is a shop that stops being a
  // decision, so the whole list has to cost more than exists.
  const reachable = 1 + R.count('unit') + R.count('pact')
  assert.ok(total > reachable * 2,
    `the shop costs ${total} against a ceiling of about ${reachable} — it must not be completable`)
  assert.ok(rows.length >= 15, 'and it has to be made of small things, or the choice is unreasonable again')
})

test('the entry tenet of each area is the cheapest thing in it', () => {
  const rows = shop(R, profile(0))
  const bySection = new Map()
  for (const r of rows) bySection.set(r.section, [...(bySection.get(r.section) ?? []), r])

  for (const [section, list] of bySection) {
    const entry = list.filter((r) => r.requires.length === 0)
    assert.ok(entry.length, `${section} has no way in`)
    const cheapest = Math.min(...list.map((r) => r.cost))
    assert.equal(Math.min(...entry.map((r) => r.cost)), cheapest,
      `${section}: the first decision must be "do I care about this", not "can I afford anything"`)
  }
})

test('the shop is sorted independently of pack load order', () => {
  const a = shop(R, profile(0)).map((r) => r.id)
  const b = shop(R, profile(0)).map((r) => r.id)
  assert.deepEqual(a, b)
  assert.deepEqual(a, [...a], 'and stable across calls, which is what makes it a list rather than a feed')
})

// ── the check that makes prices mean anything ───────────────────────────────────────────────────

test('★ a Doctrine may not say what its holder did not buy', () => {
  const overreach = normalize({
    tenets: [],
    recruit: [{ when: ['lte', ['hpPct', '$target'], 0.5], action: 'persuade', at: 0.5 }]
  })
  const errs = validate(overreach, kernel).filter((p) => p.severity === 'error')
  assert.equal(errs.length, 1)
  assert.match(errs[0].msg, /nothing bought that holds one/)
})

test('a rule using a chip you did not buy names the chip', () => {
  const d = normalize({
    tenets: ['core:parley_threshold'],
    recruit: [{ when: ['lt', ['kinCount', 'core:drake'], 4], action: 'persuade', at: 0.3 }]
  })
  const errs = validate(d, kernel).filter((p) => p.severity === 'error')
  assert.equal(errs.length, 1)
  assert.match(errs[0].msg, /needs a tenet granting "Kin count"/)
})

test('more rules than slots is an error against the slot count, not a silent truncation', () => {
  const rule = { when: ['lte', ['hpPct', '$target'], 0.5], action: 'persuade', at: 0.5 }
  const d = normalize({ tenets: ['core:parley_threshold'], recruit: [rule, { ...rule }] })
  const errs = validate(d, kernel).filter((p) => p.severity === 'error')
  assert.match(errs[0].msg, /2 rules against 1 slot/)
})

test('an action you did not buy is an error, and the one you did is not', () => {
  const base = { when: ['lte', ['hpPct', '$target'], 0.4] }
  const bought = ['core:parley_threshold']
  assert.deepEqual(
    validate(normalize({ tenets: bought, recruit: [{ ...base, action: 'persuade', at: 0.4 }] }), kernel)
      .filter((p) => p.severity === 'error'), [])

  const declined = validate(normalize({ tenets: bought, recruit: [{ ...base, action: 'decline' }] }), kernel)
    .filter((p) => p.severity === 'error')
  assert.match(declined[0].msg, /needs a tenet granting DECLINE/)
})

test('a targeting mode you did not buy is an error; the standing one is free', () => {
  const free = normalize({ tenets: [], targeting: { default: ['lowestHpPct'] } })
  assert.deepEqual(validate(free, kernel).filter((p) => p.severity === 'error'), [],
    'the shipped priority is how the party already fights and costs nothing')

  const paid = normalize({ tenets: [], targeting: { default: ['healersFirst'] } })
  const errs = validate(paid, kernel).filter((p) => p.severity === 'error')
  assert.match(errs[0].msg, /needs a tenet granting "healers first"/)
})

test('★ a shared Doctrine tells you what it would cost rather than granting it', () => {
  // §11.6 makes a Doctrine a shareable export string. Without this check that is a way to hand
  // somebody the whole game; with it, an import is an itemised bill.
  const theirs = normalize({
    tenets: ['core:parley_threshold', 'core:parley_by_kin', 'core:cut_rule'],
    recruit: [{ when: ['eq', ['kin', '$target'], 'core:fae'], action: 'persuade', at: 0.4 }],
    cut: 'worstTagFit'
  })
  assert.deepEqual(validate(theirs, kernel).filter((p) => p.severity === 'error'), [], 'valid for its author')

  const mine = normalize({ ...theirs, tenets: [] })
  const errs = validate(mine, kernel).filter((p) => p.severity === 'error')
  assert.ok(errs.length >= 2, 'and refused, itemised, for somebody who bought none of it')
  assert.ok(errs.some((e) => e.path === 'recruit'), 'the rule they cannot hold')
  assert.ok(errs.some((e) => e.path === 'cut'), 'and the cut rule they did not buy')

  // Buying the parley slot moves the message on from "you cannot hold a rule here" to "you cannot
  // say *that*", which is the itemisation doing its job one purchase at a time.
  const partway = validate(normalize({ ...theirs, tenets: ['core:parley_threshold'] }), kernel)
    .filter((p) => p.severity === 'error')
  assert.ok(partway.some((e) => /Kin/.test(e.msg)))
})

test('every tenet in the shop can actually be bought, given enough Codex', () => {
  // A tenet behind a prerequisite that nothing satisfies is a row nobody can ever reach, and it
  // would look identical to one that is merely expensive.
  let owned = []
  const p = () => ({ codex: Array.from({ length: 999 }, (_, i) => `k${i}`), tenets: owned })
  for (let pass = 0; pass < 6 && owned.length < R.count('tenet'); pass++) {
    for (const row of shop(R, p())) {
      if (row.owned) continue
      const res = buy(R, p(), row.id)
      if (res.bought) owned = res.tenets
    }
  }
  assert.equal(owned.length, R.count('tenet'), 'every row is reachable')

  // And owning the lot validates, which is the other half: the shop cannot sell an illegal Doctrine.
  const everything = normalize({ tenets: owned })
  assert.deepEqual(validate(everything, kernel).filter((p) => p.severity === 'error'), [])
})
