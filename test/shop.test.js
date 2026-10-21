// The Shop between battles: no room, but the
// floor's shelf, drawn as the floor is arrived at and kept across its rooms, a slot bought filled again after the next
// battle won, both on streams of the seed, so a replay stocks it the same; bought from in map, prep and reap, never in
// battle; its fusions the fuse action itself. Functional: the rules, never a seed's outcome.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRun, apply, legalActions, replay, stockShop, shelfFusions, fuseParts, copyRun, relicTier, relicPrice, join, souls,
  START_PARTY
} from '../src/sim/run.js'
import { generateFloor, RANKS } from '../src/sim/map.js'
import { policy } from '../src/sim/autoplay.js'
import { createRng } from '../src/sim/rng.js'
import { saveOf, restore, SAVE_VERSION } from '../src/sim/save.js'
import { TUNING } from '../src/tuning.js'
import { FUSION_LIST, RELICS, RELIC_LIST } from '../src/content.js'
import { visit, win } from './rooms.js'
import { relicMod } from './tuned.js'

const isCommand = (id) => !!id && relicMod(id, 'run.command') > 0 && relicTier(id) !== 'legendary'
const isLegendary = (id) => !!id && relicTier(id) === 'legendary'
const buys = (run) => legalActions(run).filter((a) => a.type === 'buy')
// A slot bought: its price paid, its relic owned, the slot empty.
function bought (run, index) {
  const s = run.state
  const id = s.shop[index]
  const [essence, cost] = [s.essence, relicPrice(run, id)]
  assert.ok(buys(run).some((a) => a.index === index), `slot ${index} on sale in ${s.phase}`)
  apply(run, { type: 'buy', index })
  assert.deepEqual([s.shop[index], s.relics.at(-1), essence - s.essence], [null, id, cost], s.phase)
}

test('a buy is legal on the map, in prep and on the spoils, never in battle; there is no Shop phase and no leave', () => {
  const run = createRun({ start: START_PARTY, seed: 'shop-phases' })
  const s = run.state
  s.essence = 1e4
  assert.equal(s.phase, 'map')
  assert.equal(buys(run).length, s.shop.length, 'every slot, the purse full')
  bought(run, 0)
  visit(run, 'fight')
  assert.equal(s.phase, 'prep')
  bought(run, 1)
  apply(run, { type: 'fight' })
  assert.equal(s.phase, 'battle')
  assert.throws(() => apply(run, { type: 'buy', index: 2 }))
  assert.notEqual(s.shop[2], null, 'nothing bought in battle')
  assert.throws(() => apply(createRun({ start: START_PARTY, seed: 'shop-phases' }), { type: 'leave' }), /unknown action "leave"/)
  // On the spoils: the shelf just restocked, any slot the purse pays for.
  const spoils = win('shop-reap', (r) => { r.state.essence = 1e4 })
  assert.equal(spoils.state.phase, 'reap')
  bought(spoils, 0)
  assert.equal(spoils.state.phase, 'reap', 'the spoils stay open')
})

test('the shelf is drawn as each floor is arrived at, the first at the run\'s start: kept across the floor\'s rooms, the next floor\'s its own', () => {
  for (let i = 0; i < 12; i++) {
    const run = createRun({ start: START_PARTY, seed: `shelf-${i}` })
    const s = run.state
    assert.equal(s.shop.length, TUNING.shop.relics)
    assert.deepEqual(s.shop, stockShop(s), 'drawn on the floor\'s own stream')
    assert.ok(s.shop.some(isCommand) && !s.shop.some(isLegendary), JSON.stringify(s.shop))
    // A drafted run's floor 1 has its shelf from the start, during the draft.
    const drafted = createRun({ seed: `shelf-${i}` })
    assert.equal(drafted.state.phase, 'draft')
    assert.equal(drafted.state.shop.length, TUNING.shop.relics)
    // An altar walked through leaves the shelf as it was.
    const shelf = s.shop.slice()
    visit(run, 'altar')
    apply(run, { type: 'heal' })
    assert.deepEqual([s.phase, s.shop], ['map', shelf])
    // On to the next floor (the last room's spoils taken, set outside the log): its own shelf, with a Legendary.
    Object.assign(s, { at: s.map.end, phase: 'reap', offers: [] })
    apply(run, { type: 'reap', index: null })
    assert.equal(s.floor, 2)
    assert.deepEqual(s.shop, stockShop(s))
    assert.equal(s.shop.filter(isLegendary).length, 1, JSON.stringify(s.shop))
    assert.ok(s.shop.some(isCommand), JSON.stringify(s.shop))
  }
})

test('the slots bought are filled again after the next battle won: a Command relic again for the Command relic, a Legendary for the Legendary, the rest left where they are', () => {
  const legendary = RELIC_LIST.find((r) => r.tier === 'legendary' && !r.needsArise).id
  for (const floor of [1, 2]) {
    const run = win(`refill-${floor}`, (r) => {
      const s = r.state
      s.floor = floor
      // The shelf set by hand (outside the log): its one Command relic, two others, and on floor 2 a Legendary.
      s.shop = ['grave_banner', 'whetstone', 'heartwood', ...(floor >= 2 ? [legendary] : [])]
      s.essence = 1e4
      apply(r, { type: 'buy', index: 0 })
      if (floor >= 2) apply(r, { type: 'buy', index: 3 })
      s.essence = 0
    })
    const s = run.state
    assert.equal(s.phase, 'reap')
    assert.ok(!s.shop.includes(null), JSON.stringify(s.shop))
    assert.deepEqual(s.shop.slice(1, 3), ['whetstone', 'heartwood'], 'the relics left stay where they are')
    const refilled = [0, 3].filter((i) => i < s.shop.length).map((i) => s.shop[i])
    assert.ok(refilled.some(isCommand), `a Command relic again: ${s.shop}`)
    assert.equal(refilled.filter(isLegendary).length, floor >= 2 ? 1 : 0, `a Legendary again on floor 2: ${s.shop}`)
    assert.equal(new Set(s.shop).size, s.shop.length, 'never the same relic twice on one shelf')
    assert.ok(s.shop.every((id) => RELICS[id]))
  }
})

test('the shelf, its buys and its refills replay exactly from the seed and the log', () => {
  let refilled = 0
  for (let i = 0; i < 6 && refilled < 2; i++) {
    const seed = `shelf-replay-${i}`
    const run = createRun({ seed })
    const rng = createRng(seed).stream('autoplay')
    for (let k = 0; k < 20000 && run.state.phase !== 'over' && run.state.stats.wins < 4; k++) {
      const was = run.state.phase
      const empty = run.state.shop.filter((id) => id === null).length
      apply(run, policy(run, rng, 'expert'))
      if (was === 'battle' && run.state.phase === 'reap' && empty) {
        refilled++
        assert.ok(!run.state.shop.includes(null), JSON.stringify(run.state.shop))
      }
    }
    assert.ok(run.state.log.some((a) => a.type === 'buy'), `${seed}: the expert bought`)
    assert.deepEqual(replay(seed, run.state.log).state, run.state)
  }
  assert.ok(refilled > 0, 'a slot bought was refilled')
})

test('no map holds a Shop room, on any floor', () => {
  for (let i = 0; i < 400; i++) {
    for (const floor of [1, 2, 3, 4, 5]) {
      const map = generateFloor({ seed: `noshop-${i}`, floor, boss: floor <= TUNING.run.floors })
      assert.ok(map.nodes.length > RANKS)
      assert.ok(!map.nodes.some((n) => n.type === 'shop'), `seed ${i} floor ${floor}`)
    }
  }
  for (let i = 0; i < 20; i++) assert.ok(!createRun({ start: START_PARTY, seed: `noshop-run-${i}` }).state.map.nodes.some((n) => n.type === 'shop'))
})

test('a fusion from the Shop is the fuse action itself: the one the panel fired, and legalActions lists, leaving the same state', () => {
  for (const recipe of FUSION_LIST.slice(0, 8)) {
    const run = createRun({ start: START_PARTY, seed: `shelf-fuse-${recipe.id}` })
    const s = run.state
    for (const [kind, n] of Object.entries(recipe.needs)) for (let j = 0; j < n; j++) join(run, kind)
    s.essence = 1e4
    const entry = shelfFusions(run).find((x) => x.id === recipe.id)
    assert.ok(entry && entry.open && entry.can, recipe.id)
    // Every recipe on the shelf's list has every part held.
    assert.ok(shelfFusions(run).every((x) => fuseParts(run, x.id)))
    const panel = { type: 'fuse', id: recipe.id, parts: fuseParts(run, recipe.id) }
    const listed = legalActions(run).find((a) => a.type === 'fuse' && a.id === recipe.id)
    assert.deepEqual(entry.action, panel)
    assert.deepEqual(entry.action, listed)
    const [a, b] = [copyRun(run), copyRun(run)]
    apply(a, entry.action)
    apply(b, panel)
    assert.deepEqual(a.state, b.state)
    assert.equal(souls(a.state.party).at(-1).id, recipe.result)
    // A purse short of its price: listed, not lit.
    s.essence = 0
    assert.deepEqual(shelfFusions(run).find((x) => x.id === recipe.id).can, false)
  }
  // On the spoils the Shop is open, but a fusion waits for the map (the fuse action's phases are unchanged).
  const spoils = win('shelf-fuse-reap', (r) => { for (const [kind, n] of Object.entries(FUSION_LIST[0].needs)) for (let j = 0; j < n; j++) join(r, kind) })
  spoils.state.essence = 1e4
  const entry = shelfFusions(spoils).find((x) => x.id === FUSION_LIST[0].id)
  assert.ok(entry && !entry.open && !entry.can)
  assert.throws(() => apply(spoils, entry.action), /needs phase/)
})

test('a save from before the Shop opened between battles (version 3) reads as outdated, as does a log that leaves a Shop', () => {
  assert.equal(SAVE_VERSION, 8)
  const made = { seed: 'shop-save' }
  const run = createRun(made)
  apply(run, { type: 'pick', index: 0 })
  const good = JSON.parse(saveOf(run, made))
  assert.ok(restore(JSON.stringify(good)).run, 'today\'s save plays')
  assert.deepEqual(restore(JSON.stringify({ ...good, v: 3 })), { error: 'outdated', why: 'version 3' })
  const left = { ...good, log: [...good.log, { type: 'leave' }] }
  assert.equal(restore(JSON.stringify(left)).error, 'outdated')
})
