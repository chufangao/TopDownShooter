// The Monarchs (redesign.md §4.8, the meta; content.js MONARCH_LIST): who the player is. The base Monarch is every run's
// unless another is chosen, and changes nothing; each other starts holding its relic and drafts its kin more often, is
// carried by replay, the save, the history, the harness and the offline tools, and is opened by a clear at its level.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MONARCH_LIST, MONARCHS, KIN, relicDef, unitDef } from '../src/content.js'
import { TUNING } from '../src/tuning.js'
import {
  createRun, apply, replay, draftOffer, draftPool, partners, souls, BASE_MONARCH, monarchDef, biasOf, monarchsOpen, monarchsAt
} from '../src/sim/run.js'
import { saveOf, restore } from '../src/sim/save.js'
import { recordOf } from '../src/sim/history.js'
import { policy, record, ablatedRun, asMonarch, monarchArg, autoplay, LEVELS } from '../src/sim/autoplay.js'
import { outsideRun, configOf } from '../src/sim/outside.js'
import { teacherRun } from '../src/sim/teach.js'
import { createRng } from '../src/sim/rng.js'

test('the Monarchs: the base first with nothing more; each other a run relic, a kin to favour and the clear that opens it', () => {
  const [base, ...others] = MONARCH_LIST
  assert.equal(BASE_MONARCH, base.id)
  assert.ok(!base.relic && !base.bias && base.unlock === undefined)
  assert.ok(others.length >= 3)
  for (const m of others) {
    assert.ok(relicDef(m.relic).run, `${m.id}: its relic a run relic`)
    assert.ok(KIN[m.bias], `${m.id}: its bias a kin`)
    assert.ok(draftPool().some((id) => unitDef(id).kin === m.bias), `${m.id}: its kin in the draft's pool`)
    assert.ok(Number.isInteger(m.unlock) && m.unlock >= 0, `${m.id}: opened by a clear at a level`)
    assert.ok(m.name && m.line, m.id)
  }
  assert.equal(new Set(MONARCH_LIST.map((m) => m.id)).size, MONARCH_LIST.length)
  assert.throws(() => createRun({ seed: 'x', monarch: 'nobody' }), /monarch "nobody"/)
})

test('the base Monarch changes nothing: the same run, no field, the even draft', () => {
  for (const seed of ['mb-0', 'mb-1', 'mb-2']) {
    const plain = createRun({ seed })
    assert.deepEqual(createRun({ seed, monarch: BASE_MONARCH }).state, plain.state)
    assert.equal('monarch' in plain.state, false)
    assert.deepEqual(plain.state.relics, [])
    assert.equal(monarchDef(plain.state), MONARCHS[BASE_MONARCH])
    assert.equal(biasOf(plain.state), null)
    for (let pick = 0; pick < 3; pick++) assert.deepEqual(draftOffer(seed, pick, ['grave_ghoul'], null), draftOffer(seed, pick, ['grave_ghoul']))
  }
})

test('another Monarch holds its relic from the start and drafts its kin more often, the offer a plan still', () => {
  // mv0-: a seed whose draft offers each Monarch's kin (the draft of one soul, 2026-10-18: mv- offered Ember none).
  for (const m of MONARCH_LIST.slice(1)) {
    const run = createRun({ seed: `mv0-${m.id}`, monarch: m.id })
    const s = run.state
    assert.equal(s.monarch, m.id)
    assert.deepEqual(s.relics, [m.relic])
    assert.equal(s.phase, 'draft')
    assert.deepEqual(s.draft.offer, draftOffer(s.seed, 0, [], m.bias))
    // Its relic is its kin's banner; its draft picks on with the bias, to the map.
    assert.ok(relicDef(m.relic).mods.every((x) => x.who?.kin === m.bias), `${m.id}: its relic its kin's`)
    while (s.phase === 'draft') {
      const k = s.draft.offer.findIndex((id) => unitDef(id).kin === m.bias)
      apply(run, { type: 'pick', index: Math.max(0, k) })
      if (s.draft) assert.deepEqual(s.draft.offer, draftOffer(s.seed, s.draft.pick, souls(s.party).map((u) => u.id), m.bias))
    }
    assert.equal(s.phase, 'map')
    assert.ok(souls(s.party).some((u) => unitDef(u.id).kin === m.bias), `${m.id}: a soul of its kin drafted`)
    // Over many seeds its kin is offered far more often than evenly, every offer distinct kinds of the pool, every later
    // one with a partner of what is held.
    let seen = 0
    const n = 300
    for (let i = 0; i < n; i++) {
      const offer = draftOffer(`mvd-${i}`, 0, [], m.bias)
      assert.equal(new Set(offer).size, TUNING.draft.offer)
      assert.ok(offer.every((id) => draftPool().includes(id)))
      seen += offer.some((id) => unitDef(id).kin === m.bias)
      const held = [offer[0]]
      assert.ok(draftOffer(`mvd-${i}`, 1, held, m.bias).some((id) => held.some((h) => partners(h, id))))
    }
    assert.ok(seen / n > 0.6, `${m.id}: its kin offered in ${seen} of ${n} first offers`)
  }
})

test('a Monarch rides with the run: replay, the save, the history, the harness', () => {
  const made = { seed: 'mr-0', monarch: 'ember', ascension: 1 }
  const run = createRun(made)
  const rng = createRng(made.seed).stream('autoplay')
  for (let i = 0; i < 300 && run.state.phase !== 'over'; i++) apply(run, policy(run, rng, 'basic'))
  assert.deepEqual(replay(made.seed, run.state.log, made).state, run.state)
  if (run.state.phase !== 'over') {
    const back = restore(saveOf(run, made))
    assert.deepEqual(back.made, made)
    assert.deepEqual(back.run.state, run.state)
  }
  assert.equal(recordOf(run).monarch, 'ember')
  assert.equal('monarch' in recordOf(createRun({ seed: 'mr-1' })), false)
  // The harness: --monarch, a job's spec, a record's `variant`.
  assert.equal(monarchArg(), BASE_MONARCH)
  assert.equal(monarchArg('hive'), 'hive')
  assert.throws(() => monarchArg('nobody'), /--monarch "nobody"/)
  assert.deepEqual(asMonarch(BASE_MONARCH), {})
  assert.deepEqual(asMonarch(null), {})
  assert.deepEqual(asMonarch('hive'), { monarch: 'hive' })
  assert.equal(ablatedRun('mr-2', null, null, { monarch: 'hive' }).state.monarch, 'hive')
  const r = record({ seed: 'mr-3', level: 'basic', monarch: 'brass' })
  assert.equal(r.variant, 'brass')
  assert.equal('variant' in record({ seed: 'mr-3', level: 'basic' }), false)
  // Played whole by basic as each, to its end.
  for (const m of MONARCH_LIST) assert.equal(autoplay(createRun({ seed: `mw-${m.id}`, monarch: m.id }), { level: LEVELS.basic }).state.phase, 'over')
})

// The offline tools as autoplay.js and calc.js (--monarch): the outside teacher's run and the battle teacher's played as
// the Monarch named, their logs its runs' (a biased draft: not the base one's), the outside teacher's settings naming it.
test('a Monarch rides with the offline tools: outside.js and teach.js play their runs as it', () => {
  assert.equal(configOf().monarch, BASE_MONARCH)
  assert.throws(() => configOf({ monarch: 'nobody' }), /--monarch "nobody"/)
  const as = outsideRun('cmo-0', { phases: 'hold', battles: 1, log: true, monarch: 'brass' })
  assert.equal(as.settings.monarch, 'brass')
  assert.equal('monarch' in outsideRun('cmo-0', { phases: 'hold', battles: 1 }).settings, false)
  const teacher = teacherRun('cmo-0', { fights: 1, log: true, monarch: 'brass' })
  for (const r of [as, teacher]) {
    const back = replay('cmo-0', r.log, { monarch: 'brass' }).state
    assert.ok(back.monarch === 'brass' && back.relics.includes(MONARCHS.brass.relic))
  }
  assert.notDeepEqual(teacher.log, teacherRun('cmo-0', { fights: 1, log: true }).log)
})

test('the unlock rule: the base always; each other by a clear at its level or above', () => {
  const ids = (k) => MONARCH_LIST.filter((m) => m.unlock === undefined || k >= m.unlock).map((m) => m.id)
  assert.deepEqual(monarchsOpen(-1), [BASE_MONARCH])
  for (let k = -1; k <= 10; k++) assert.deepEqual(monarchsOpen(k), ids(k))
  // The first clear opens the first; a clear at a level opens every one it reaches, once.
  assert.deepEqual(monarchsAt(-1, 0), MONARCH_LIST.filter((m) => m.unlock === 0).map((m) => m.id))
  assert.deepEqual(monarchsAt(-1, 10), MONARCH_LIST.slice(1).map((m) => m.id))
  assert.deepEqual(monarchsAt(10, 10), [])
  assert.deepEqual(monarchsAt(5, 1), [])
  for (const m of MONARCH_LIST.slice(1)) {
    assert.ok(!monarchsOpen(m.unlock - 1).includes(m.id) && monarchsOpen(m.unlock).includes(m.id), m.id)
    assert.ok(monarchsAt(m.unlock - 1, m.unlock).includes(m.id), m.id)
  }
})
