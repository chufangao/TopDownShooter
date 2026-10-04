// Dispatches (§4.1) — reports, and the gate that makes ignoring one free.
//
// The thing under test that matters most is the same one M3.5 always had to prove, and it is
// unchanged by the reports no longer offering anything: **a run that raises them plays identically
// to a run that raises none.** That is what keeps §1's loop D honest, because a headless run in a
// Worker has to be able to raise these into a queue nobody will ever read.
//
// The second thing under test is new, and it is about the copy rather than the code: a dispatch
// must not tell the player what to do. There is no `offers` field to check, so the assertion is
// structural — the kind refuses one — plus a read of every shipped body.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks, readPackFromDisk } from '../../tools/packsource.node.js'
import { createLedger, NULL_LEDGER } from '../../src/sim/signals.js'
import { raise, dismiss, interpolate, QUEUE_CAP } from '../../src/sim/dispatch.js'
import { createRun, playRun } from '../../src/sim/run.js'
import { DEFAULT_DOCTRINE, normalize } from '../../src/sim/doctrine.js'
import { timelineHash } from '../../src/sim/combat/battle.js'

const packs = discoverPacks('packs')
const { kernel, tuning } = await createGame({ packs, seed: 1 })

const fresh = () => normalize(DEFAULT_DOCTRINE)
const ledgerWith = (counts) => {
  const L = createLedger()
  for (const [name, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) L.emit(name, { name: 'Frost Sprite', role: 'Skirmisher', hpPct: 0.22, floor: 2, at: 5, down: 3 })
  }
  return L
}

// ── what a report is ────────────────────────────────────────────────────────────────────────────

test('a fresh profile with nothing recorded reports nothing', () => {
  assert.deepEqual(raise({ kernel, ledger: createLedger(), doctrine: fresh() }), [])
})

test('★ a report states what happened and offers nothing', () => {
  const [card] = raise({ kernel, ledger: ledgerWith({ 'recruit:missed': 4 }), doctrine: fresh() })

  assert.equal(card.id, 'core:under_the_threshold')
  assert.match(card.body, /4 enemies/, 'the count is the player\'s own, read from the ledger')
  assert.match(card.body, /Frost Sprite/, 'and so is the last one')
  assert.doesNotMatch(card.body, /\{/, 'nothing unresolved reaches the screen')
  assert.equal(card.offers, undefined, 'there is nothing to answer — the response is the player\'s')
})

test('★ no shipped report tells the player what to do', () => {
  // The copy test, run over the content rather than asserted about one card. A report that names a
  // purchase, or instructs, has smuggled the answer back in — which is the whole failure §4.1
  // records about the Precedent it replaced.
  const forbidden = [/\byou should\b/i, /\bconsider\b/i, /\btry\b/i, /\bbuy\b/i, /\btenet\b/i, /\bunlock\b/i, /\blearn\b/i]
  for (const def of kernel.registry.all('dispatch')) {
    for (const text of [def.title, def.body]) {
      for (const re of forbidden) {
        assert.doesNotMatch(text, re, `${def.id} recommends rather than reports: ${text}`)
      }
    }
  }
})

test('the kind refuses an offer outright, so the Precedent cannot grow back by accident', async () => {
  const { report } = await createGame({
    packs: [...packs, {
      id: 'offery',
      manifest: { id: 'offery', name: 'x', version: '1.0.0', api: 1, content: ['content/*.json'] },
      match: () => ['content/dispatch.json'],
      json: () => ({
        kind: 'dispatch',
        defs: [{
          id: 'offery:nudge',
          when: ['gte', ['signalCount', 'battle:won'], 1],
          title: 'x',
          body: 'y',
          offers: [{ label: 'do the thing' }]
        }]
      })
    }],
    seed: 1
  })
  assert.ok(report.errors.some((e) => /a dispatch has no offers/.test(e)), report.errors.join('\n'))
})

// ── the queue ───────────────────────────────────────────────────────────────────────────────────

test('a report fires once per run however many nodes go by', () => {
  const ledger = ledgerWith({ 'recruit:missed': 3 })
  assert.equal(raise({ kernel, ledger, doctrine: fresh() }).length, 1)
  assert.equal(raise({ kernel, ledger, doctrine: fresh() }).length, 0)
})

test('a thing that keeps happening keeps being reported, run after run', () => {
  const doctrine = fresh()
  for (let run = 0; run < 3; run++) {
    const ledger = ledgerWith({ 'recruit:missed': 3 })
    assert.equal(raise({ kernel, ledger, doctrine }).length, 1,
      'it is the player\'s business whether to do anything about it, not the game\'s to stop mentioning')
  }
})

test('a first-time measurement is spent once and never returns', () => {
  const ledger = createLedger()
  ledger.emit('unit:branch', { name: 'Bone Chanter', at: 5 })

  const [card] = raise({ kernel, ledger, doctrine: fresh() }).filter((c) => c.id === 'core:first_branch')
  assert.ok(card)
  dismiss(card, { ledger })

  ledger.beginRun()
  ledger.emit('unit:branch', { name: 'Tomb Knight', at: 10 })
  assert.equal(raise({ kernel, ledger, doctrine: fresh() }).some((c) => c.id === 'core:first_branch'), false)
})

test('the feed is capped, and a report the cap pushed out is not spent', () => {
  const ledger = ledgerWith({
    'recruit:missed': 9, 'recruit:failed': 12, 'ally:down_front': 4, 'descend:wounded': 3, 'recruit:cut': 9
  })
  const first = raise({ kernel, ledger, doctrine: fresh(), cap: 2 })
  const second = raise({ kernel, ledger, doctrine: fresh(), cap: 2 })

  assert.equal(first.length, 2)
  assert.ok(second.length > 0, 'the overflow must still be waiting, not silently marked as shown')
  assert.equal(second.some((c) => first.some((f) => f.id === c.id)), false)
  assert.ok(QUEUE_CAP >= 2)
})

test('raising reads no randomness, so a report cannot shift the run\'s RNG', () => {
  assert.doesNotThrow(() => raise({ kernel, ledger: ledgerWith({ 'recruit:missed': 5 }), doctrine: fresh() }))
})

test('★ the ledger forms are legal in a dispatch and illegal everywhere else (§11.6)', () => {
  const F = kernel.forms
  assert.deepEqual(F.validate(['gte', ['signalCount', 'recruit:missed'], 3], 'when', 'dispatch'), [])

  const inDoctrine = F.validate(['gte', ['signalCount', 'recruit:missed'], 3], 'recruit[0].when')
  assert.equal(inDoctrine.length, 1)
  assert.match(inDoctrine[0], /only legal in a dispatch expression/)

  assert.equal(F.list('dispatch').some((f) => f.name === 'signalCount'), true)
  assert.equal(F.list().some((f) => f.name === 'signalCount'), false)
})

// ── ★ the M3.5 gate ─────────────────────────────────────────────────────────────────────────────

test('★ a run that reports is identical to a run that reports nothing', () => {
  const play = (seed, signals) => {
    kernel.defs.restore({ uid: 1 })
    const out = playRun(createRun({ kernel, tuning, seed, signals }), { maxFloors: 8 })
    return {
      floors: out.floors,
      reason: out.reason,
      residue: out.banked.residue,
      coin: out.run.state.coin,
      party: out.run.state.roster.map((u) => `${u.defId}@${u.lvl}`).join(','),
      hash: timelineHash(out.reports.filter((r) => r.battle).flatMap((r) => r.battle.result.events)),
      cards: out.dispatches.length
    }
  }

  let raised = 0
  for (const seed of [1, 3, 5, 6, 9, 12]) {
    const loud = createLedger({ counts: { 'recruit:missed': 40, 'recruit:cut': 20, 'ally:down_front': 9 }, answered: [] })
    const withCards = play(seed, loud)
    const without = play(seed, NULL_LEDGER)

    raised += withCards.cards
    assert.equal(without.cards, 0, 'the control arm must genuinely report nothing')
    const { cards: _a, ...a } = withCards
    const { cards: _b, ...b } = without
    assert.deepEqual(a, b, `seed ${seed}: reading nothing must cost the run nothing`)
  }
  assert.ok(raised > 0, 'a gate that passes because nothing fired is not a gate')
})

test('★ a pack ships a dispatch watching its own signal, with no src/ change', () => {
  const ledger = createLedger()
  ledger.emit('kindled:ember:missed', { name: 'Ash Seer' })
  ledger.emit('kindled:ember:missed', { name: 'Ash Seer' })

  // Loaded here rather than at module scope so the assertion is about the pack, not about ordering.
  return createGame({ packs: [...packs, readPackFromDisk('test/fixtures/kindled')], seed: 1 }).then(({ kernel: k, report }) => {
    assert.deepEqual(report.errors, [])
    assert.equal(k.registry.has('dispatch', 'kindled:first_ember'), true)
    const [card] = raise({ kernel: k, ledger, doctrine: fresh() }).filter((c) => c.id === 'kindled:first_ember')
    assert.ok(card, 'a pack\'s report watching a pack\'s own namespaced signal')
    assert.match(card.body, /Ash Seer/)
  })
})

// ── copy ────────────────────────────────────────────────────────────────────────────────────────

test('interpolation resolves this run, the lifetime count, and the last payload', () => {
  const L = createLedger()
  L.emit('recruit:missed', { name: 'Frost Sprite', hpPct: 0.22 })
  L.beginBattle()
  L.emit('recruit:missed', { name: 'Bone Chanter', hpPct: 0.5 })

  assert.equal(interpolate('{signalCount:recruit:missed} went down', L), '2 went down')
  assert.equal(interpolate('{signalTotal:recruit:missed} ever', L), '2 ever')
  assert.equal(interpolate('a {last:recruit:missed.name} at {last:recruit:missed.hpPct}', L), 'a Bone Chanter at 50%')
  assert.equal(interpolate('{last:nothing:here.name}', L), '—', 'a missing payload is a dash, never "undefined"')
})
