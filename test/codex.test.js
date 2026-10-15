// The words the interface shows (codex.js, keywords.js), read as text: what a card, the glossary and How to play
// tell the player must be the rules' truth. codex.js builds DOM, so it is loaded under a bare stand-in for the page:
// elements that keep their children (their text is read back), and storage that keeps the bestiary.
import { test } from 'node:test'
import assert from 'node:assert/strict'

class El {
  constructor (tag) {
    this.tagName = tag.toUpperCase()
    this.nodeType = 1
    this.childNodes = []
    this.style = { setProperty () {} }
    this.className = ''
    const classes = () => this.className.split(' ').filter(Boolean)
    this.classList = {
      add: (...c) => { this.className = [...new Set([...classes(), ...c])].join(' ') },
      remove: (...c) => { this.className = classes().filter((x) => !c.includes(x)).join(' ') },
      toggle: (c, on = !classes().includes(c)) => (on ? this.classList.add(c) : this.classList.remove(c)),
      contains: (c) => classes().includes(c)
    }
  }

  setAttribute () {}
  addEventListener () {}
  remove () {}
  replaceChildren (...kids) { this.childNodes = kids }
  append (...kids) { this.childNodes.push(...kids) }
  getBoundingClientRect () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  get textContent () { return this.childNodes.map((c) => (typeof c === 'string' ? c : c.textContent)).join('') }
  set textContent (v) { this.childNodes = [String(v)] }
}
const store = new Map()
const page = {
  document: {
    createElement: (tag) => new El(tag), getElementById: () => new El('div'), body: new El('body'), documentElement: new El('html'),
    addEventListener () {}
  },
  window: globalThis,
  addEventListener () {},
  matchMedia: () => ({ matches: false, addEventListener () {} }),
  MutationObserver: class { observe () {} },
  ResizeObserver: class { observe () {} },
  screen: {},
  localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) }
}
for (const [k, value] of Object.entries(page)) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true })

const { reachRule, reachText, bestiary, codexView, recruitWorth, unitCard, relicTip, relicKind, synergyLabels, ariseFor, realmOf, roomSynergies, roomTip, DEEP_TEXT, ENEMY_TEXT, riteNote, transmuteWorth, ROOM } = await import('../src/codex.js')
const { KEYWORDS } = await import('../src/keywords.js')
const { UNIT_LIST, BEHAVIOURS, FUSION_LIST, RELIC_LIST, SYNERGIES, temperLine } = await import('../src/content.js')
const { makeUnit } = await import('../src/sim/unit.js')
const { createRun, souls, rosterCap, apply, START_PARTY, availableNodes, transmuteOffer, legalActions } = await import('../src/sim/run.js')
const { temperOf } = await import('../src/sim/turns.js')

const FOES = UNIT_LIST.filter((u) => u.spawn || u.boss)
bestiary.record(FOES.map((u) => u.id))

test('a met foe\'s card tells its reach, its Move, its way and its way line; no word is Flank, ring or gauge', () => {
  for (const u of FOES) {
    const text = reachRule({ id: u.id, lvl: 1 }, true)
    assert.ok(text.includes(BEHAVIOURS[u.behaviour ?? 'walk'].desc), `${u.id}: its way`)
    if (u.temper) assert.ok(text.includes(temperLine(temperOf(u.id)).toLowerCase()), `${u.id}: ${text}`)
    assert.match(reachText({ id: u.id, lvl: 1 }, true), /^Reach \d+ · (melee|ranged) · Move \d+/)
    assert.ok(!/flank|\bring|gauge|halts?\b/i.test(text + reachText({ id: u.id, lvl: 1 }, true)), `${u.id}: ${text}`)
  }
  assert.ok(FOES.filter((u) => u.temper).length >= 8, 'the floor-1 kinds carry a temperament')
  const met = localStorage.getItem('retinue:met')
  localStorage.setItem('retinue:met', '')
  assert.match(reachRule({ id: FOES[0].id, lvl: 1 }, true), /^Not met yet/)
  localStorage.setItem('retinue:met', met)
})

// The seventeen of redesign.md §2.14, Line of fire (§2.19, 2026-10-11): a rule the player must read to screen the
// Monarch, so it is a word of its own; Trine (the improvement plan's §4.1, 2026-10-15): three of a kind fused; and Altar
// (its §4.5): one rite of three.
test('the glossary\'s words are the seventeen, Line of fire, Trine and Altar; each way is its own line; no word is Ring, Gauge, ACC, EVA, CRT or Flank', () => {
  const names = Object.values(KEYWORDS).filter((k) => k.group === 'Words').map((k) => k.name)
  assert.deepEqual(names.slice().sort(), ['Altar', 'Command', 'Cooldown', 'Counter', 'Essence', 'Fusion', 'Line of fire', 'Move', 'Piece', 'Relic', 'Road', 'Shadow', 'Shop', 'Skill',
    'Summon', 'Synergy', 'Tier', 'Trine', 'Turn', 'Wave'])
  for (const [id, b] of Object.entries(BEHAVIOURS)) assert.equal(KEYWORDS[id].line, b.desc)
  for (const k of Object.values(KEYWORDS)) assert.ok(!/\bring\b|gauge|\b(ACC|EVA|CRT)\b|crit|flank|chance/i.test(k.line), `${k.name}: ${k.line}`)
})

test('How to play counts your souls as the cap does: one soul, one piece', () => {
  const run = createRun({ start: START_PARTY, seed: 'codex' })
  run.state.party.push({ ...makeUnit('tomb_knight', { uid: 50 }), slot: -1 })
  const text = codexView(run).textContent
  assert.ok(text.includes(`Souls ${souls(run.state.party).length}/${rosterCap(run)} `), text.match(/Souls [^·]*/)?.[0])
})

test('no word and no line of How to play speaks of stacked pieces or their bodies (a status\'s stacks are its own)', () => {
  for (const [id, k] of Object.entries(KEYWORDS)) {
    if (k.group === 'Words') assert.ok(!/stack|\bbod(y|ies)\b|\bpool\b/i.test(k.line), `${id}: ${k.line}`)
  }
  assert.ok(!('stack' in KEYWORDS))
  const text = codexView(createRun({ start: START_PARTY, seed: 'codex' })).textContent
  assert.ok(!/stack|\bbod(y|ies)\b/i.test(text), text.match(/.{0,40}(stack|bod(y|ies)).{0,40}/i)?.[0])
})

test('a recruit of a kind held says what one more is worth: how many you hold, and each fusion its kind is part of', () => {
  const run = createRun({ start: START_PARTY, seed: 'codex' })
  const held = new Set(souls(run.state.party).map((u) => u.id))
  for (const id of held) {
    const w = recruitWorth(run, id)
    assert.equal(w.held, souls(run.state.party).filter((u) => u.id === id).length, id)
    assert.equal(w.recipes.length, FUSION_LIST.filter((f) => Object.hasOwn(f.needs, id)).length, id)
    assert.ok(w.lines.length >= 3 && w.chips[0].text === `Held ${w.held}`, id)
  }
  const stranger = UNIT_LIST.find((u) => u.spawn && !held.has(u.id))
  assert.equal(recruitWorth(run, stranger.id), null)
})

test('How to play is the turn\'s: a turn is yours, the untouched strike with their basics, no dice, held relics; nothing of rings or the gauge', () => {
  const text = codexView(createRun({ start: START_PARTY, seed: 'codex' })).textContent
  assert.ok(text.includes('A turn is yours'), text.slice(0, 200))
  assert.ok(text.includes('never a skill') && text.includes('No dice'))
  assert.ok(/piece relic works through the soul you give it to/.test(text) && /Arise is one/.test(text), 'held relics (redesign.md §2.15)')
  assert.ok(!/never moves'?\.|stop line|rings? cover|\bring\b|gauge|\b(ACC|EVA|CRT)\b|crit/i.test(text), text.match(/.{0,40}(never moves|stop line|rings? cover|\bring\b|gauge|ACC|EVA|CRT|crit).{0,40}/i)?.[0])
})

// No clock (redesign.md §2.10): nothing the player reads speaks of one, of turns left, or of a battle lost by time.
test('no word, no line of How to play and no wave tip speaks of a clock, a cap on turns or a battle lost undecided', () => {
  const text = [codexView(createRun({ start: START_PARTY, seed: 'codex' })).textContent, ...Object.values(KEYWORDS).map((k) => k.line), ...Object.values(ENEMY_TEXT)].join(' ')
  const gone = /\bclock\b|undecided|turns? left|last turn|\bthe cap\b|dragged on/i
  assert.ok(!gone.test(text), text.match(new RegExp(`.{0,40}(${gone.source}).{0,40}`, 'i'))?.[0])
  assert.ok(/lost only the instant the Monarch falls|lasts until no foe is left, or the Monarch falls/.test(text), 'what ends a battle')
})

test('a relic card says Run or Held; a soul\'s card shows its relic slot, the Monarch\'s none, and no stat but HP, ATK, DEF and Move', () => {
  for (const r of RELIC_LIST) {
    assert.equal(relicKind(r.id), r.run ? 'Run' : 'Held', r.id)
    assert.ok(relicTip(r.id).textContent.includes(r.run ? 'Run' : 'Held'), r.id)
  }
  const run = createRun({ start: START_PARTY, seed: 'codex' })
  const soul = souls(run.state.party)[0]
  const piece = RELIC_LIST.find((r) => !r.run && !r.rule)
  assert.match(unitCard(soul, { run }).textContent, /no relic/)
  run.state.relics.push(piece.id)
  apply(run, { type: 'hold', relic: piece.id, uid: soul.uid })
  const card = unitCard(soul, { run }).textContent
  assert.ok(card.includes(piece.name) && !/no relic/.test(card), card)
  assert.ok(relicTip(piece.id, run).textContent.includes('held by'), 'its tip says who holds it')
  const monarch = run.state.party.find((u) => u.id === 'monarch')
  assert.ok(!/relic/.test(unitCard(monarch, { run }).textContent))
  for (const u of [soul, monarch]) assert.ok(!/\b(ACC|EVA|CRT|SPD)\b/.test(unitCard(u, { run, open: true }).textContent))
})

test('Arise is its holder\'s skill on its card, with its reach and tier; a soul holding none has no Arise', () => {
  const run = createRun({ start: START_PARTY, seed: 'codex' })
  const [holder, other] = souls(run.state.party)
  run.state.relics.push('arise')
  apply(run, { type: 'hold', relic: 'arise', uid: holder.uid })
  const a = ariseFor(run.state, holder)
  assert.ok(a && a.domain > 0 && a.tier > 0)
  assert.equal(ariseFor(run.state, other), null)
  const card = (u) => unitCard(u, { run, realm: realmOf(run), open: true }).textContent
  assert.ok(card(holder).includes('Arise') && card(holder).includes(`${a.domain} tiles`), card(holder))
  assert.ok(!card(other).includes('Arise'))
})

test('a battle\'s synergy labels name the rule each brings at 4', () => {
  const labels = synergyLabels(SYNERGIES)
  assert.equal(labels.length, SYNERGIES.length)
  for (const x of labels) {
    const syn = SYNERGIES.find((s) => s.id === x.id)
    assert.ok(syn.name.endsWith(' 4') && syn.desc.startsWith(`${x.rule}: `) && x.text.length > 0, x.id)
  }
})

// Echo split (the improvement plan's §4.3): its ladder a step at 4 and one at its `full`, 8, the codex's Synergies and
// the tracker's chip telling both; every rule's card from content.
test('the codex\'s Synergies and the tracker tell Echo\'s two steps: its lesser form at 4, in full at 8', async () => {
  const { synergiesView, synergyTracker } = await import('../src/codex.js')
  const text = synergiesView().textContent
  for (const syn of SYNERGIES) assert.ok(text.includes(`4: ${syn.desc.split(': ')[0]} ${syn.desc.slice(syn.desc.indexOf(': ') + 2)}`), syn.id)
  assert.ok(text.includes('8: Echo in full as at 4, at its full effect.'), text)
  const channelers = (n) => Array.from({ length: n }, (_, i) => ({ id: i % 2 ? 'will_o_wisp' : 'bone_chanter', uid: i + 1, hp: 1 }))
  const chip = (n) => synergyTracker(channelers(n)).childNodes.find((c) => c.textContent.startsWith('Channeler'))
  for (const [n, top] of [[4, false], [7, false], [8, true]]) {
    const c = chip(n)
    assert.equal(c.textContent, `Channeler ${n}48`, 'its count, then its steps')
    assert.deepEqual([c.classList.contains('on'), c.classList.contains('top')], [true, top], `${n}`)
  }
})

test('a fall to a status\'s tick is told as that status, from no tile and with no blow replayed; a blow\'s keeps its tile', async () => {
  const { deathText } = await import('../src/codex.js')
  const { deployTile } = await import('../src/sim/unit.js')
  const run = createRun({ start: START_PARTY, seed: 'codex' })
  const s = run.state
  const m = s.party.find((u) => u.id === 'monarch')
  const from = deployTile('foe', 0)
  s.death = { by: 'pyre_hound', uid: 900, ability: null, from, shape: null, threat: null, reason: 'monarch' }
  const battle = (status) => ({ units: [], events: [{ type: 'damage', actor: 900, target: m.uid, damage: 9, hp: 0, ability: null, ...(status && { status }) }] })
  const tick = deathText(s, battle('burning'))
  assert.equal(tick.tick, 'burning')
  assert.ok(tick.lines.some((l) => l.includes('Burning')) && !tick.lines.some((l) => /^From |a blow/.test(l)), tick.lines.join(' | '))
  s.death = { ...s.death, ability: 'strike' }
  const blow = deathText(s, battle(null))
  assert.equal(blow.tick, null)
  assert.ok(blow.lines.some((l) => l.startsWith('From ')), blow.lines.join(' | '))
})

test('the glossary never says most kinds have a basic heal: only menders do', async () => {
  const { basicOf, mendOf } = await import('../src/sim/turns.js')
  const { abilitiesOf } = await import('../src/sim/unit.js')
  const { abilityDef } = await import('../src/content.js')
  const kinds = UNIT_LIST.filter((d) => !d.monarch)
  const menders = kinds.filter((d) => mendOf(abilitiesOf({ id: d.id, lvl: 1, tracks: [0, 0] }).map(abilityDef))).length
  assert.ok(menders * 2 < kinds.length, 'menders are the few')
  for (const d of kinds) assert.ok(basicOf(abilitiesOf({ id: d.id, lvl: 1, tracks: [0, 0] }).map(abilityDef)), `${d.id}: a basic blow`)
  const text = codexView(createRun({ start: START_PARTY, seed: 'codex' })).textContent + Object.values(KEYWORDS).map((k) => k.line).join(' ')
  assert.ok(!/most a basic heal/.test(text))
  assert.match(KEYWORDS.turn.line, /basic heal/)
})

test('a quick tap read late (the page busy past the long press) stays a tap; a press held, or a late timer with no lift, is a long press', async () => {
  const { hold, HOLD } = await import('../src/dom.js')
  const on = {}
  const saved = {
    add: globalThis.addEventListener, remove: globalThis.removeEventListener, raf: globalThis.requestAnimationFrame,
    set: globalThis.setTimeout, clear: globalThis.clearTimeout
  }
  globalThis.addEventListener = (type, f) => { (on[type] ??= new Set()).add(f) }
  globalThis.removeEventListener = (type, f) => { on[type]?.delete(f) }
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 16)
  // The page's clock is the test's own, so a loaded machine cannot make a timer late: it moves only by wait(ms), which
  // runs each timer come due at its own time and in order, the ones they set included.
  let now = 0
  const timers = new Set()
  globalThis.setTimeout = (f, ms = 0) => { const t = { f, at: now + ms }; timers.add(t); return t }
  globalThis.clearTimeout = (t) => timers.delete(t)
  performance.now = () => now
  const next = (end) => [...timers].filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0]
  const wait = (ms) => {
    const end = now + ms
    for (let t = next(end); t; t = next(end)) {
      timers.delete(t)
      now = t.at
      t.f()
    }
    now = end
  }
  const lift = (id) => { for (const f of [...(on.pointerup ?? [])]) f({ pointerId: id }) }
  try {
    let fired = 0
    // Pressed long before the timer could run: the page was busy, and the lift is read just after the timer.
    hold({ pointerId: 1, clientX: 0, clientY: 0, timeStamp: now - HOLD - 300 }, () => fired++)
    wait(HOLD + 2)
    lift(1)
    wait(60)
    assert.equal(fired, 0, 'a quick tap read late is no long press')
    // The same late timer with no lift: a long press after all, a frame and a task late.
    hold({ pointerId: 2, clientX: 0, clientY: 0, timeStamp: now - HOLD - 300 }, () => fired++)
    wait(HOLD + 2)
    assert.equal(fired, 0)
    wait(60)
    assert.equal(fired, 1)
    // A press held on an idle page fires on time.
    hold({ pointerId: 3, clientX: 0, clientY: 0, timeStamp: now }, () => fired++)
    wait(HOLD - 1)
    assert.equal(fired, 1)
    wait(1)
    assert.equal(fired, 2)
  } finally {
    globalThis.addEventListener = saved.add
    globalThis.removeEventListener = saved.remove
    globalThis.requestAnimationFrame = saved.raf
    globalThis.setTimeout = saved.set
    globalThis.clearTimeout = saved.clear
    delete performance.now
  }
})

test('the foes\' synergies are told on every floor, a later wave\'s too, as the battle holds them; no text reads NaN', () => {
  const run = createRun({ start: START_PARTY, seed: 'told' })
  const four = (id) => [0, 1, 2, 3].map((slot) => ({ id, lvl: 1, slot }))
  const node = { id: 'x', type: 'fight', rank: 1, next: [], foes: four('hive_drone'), waves: [{ foes: four('tomb_knight') }] }
  assert.equal(run.state.floor, 1)
  const told = ['Insect 4: Frenzy', 'Skirmisher 4: Ambush', 'Undead 4: Legion', 'Vanguard 4: Bodyguard']
  assert.deepEqual(roomSynergies(node), told)
  const tip = roomTip(run, node, { reachable: true }).textContent
  for (const name of told) assert.ok(tip.includes(name), name)
  assert.ok(tip.includes('Not counted: their Frenzy, Ambush, Legion, Bodyguard'), 'the threat names their rules')
  assert.deepEqual(roomSynergies({ ...node, foes: four('hive_drone').slice(1), waves: [] }), [])
  for (const text of [DEEP_TEXT.growth, DEEP_TEXT.now(7), tip]) assert.ok(!/NaN|undefined/.test(text), text)
})

// Lines of fire (redesign.md §2.19): a kind whose blow keeps to a line says so on its card, every lobbed blow's line
// says it ignores lines, and How to play tells the rule.
test('a kind with a blow that keeps to its line says so; a lobbed blow says it ignores lines; How to play tells the line of fire', async () => {
  const { abilityBlock } = await import('../src/codex.js')
  const { lined } = await import('../src/sim/turns.js')
  const { ABILITIES, abilityDef } = await import('../src/content.js')
  const { abilitiesOf } = await import('../src/sim/unit.js')
  for (const d of UNIT_LIST.filter((x) => !x.monarch)) {
    const u = { id: d.id, lvl: 1, tracks: [0, 0] }
    const keeps = abilitiesOf(u).map(abilityDef).some(lined)
    assert.equal(/line of fire/.test(reachRule(u)), keeps, `${d.id}: ${reachRule(u)}`)
  }
  const st = { atk: 10, heal: { given: 1 } }
  for (const a of Object.values(ABILITIES).filter((x) => x.arc && x.shape !== 'corpse')) {
    assert.ok(!lined(a), a.id)
    assert.match(abilityBlock(a.id, st).textContent, /ignores lines/, a.id)
  }
  const text = codexView(createRun({ start: START_PARTY, seed: 'codex' })).textContent
  assert.ok(/line of fire/.test(text) && /SCREENED/.test(text), 'the primer and the battle gestures tell it')
})

// The tooltips out of battle tell the run's own numbers, not the design: what a room pays or mends now, what one more
// copy of a run relic makes of the run, what a soul does when left alone.
test('a room\'s tip tells its pay and recruit prices, an altar what it would mend now; a run relic one more copy; a soul its basic left alone', async () => {
  const { roomGain } = await import('../src/codex.js')
  const { foeEssence, commandOf, monarchOf, soulOffer } = await import('../src/sim/run.js')
  const { abilitiesOf } = await import('../src/sim/unit.js')
  const { abilityDef } = await import('../src/content.js')
  const { basicOf } = await import('../src/sim/turns.js')
  const run = createRun({ start: START_PARTY, seed: 'told' })
  const s = run.state
  const node = s.map.nodes.find((n) => n.type === 'fight')
  const pay = [node.foes, ...(node.waves ?? []).map((w) => w.foes)].flat().reduce((n, f) => n + foeEssence(f), 0)
  const said = roomTip(run, node, { reachable: true }).textContent
  assert.ok(said.includes(`Win: +${Math.round(pay)} essence and a recruit: `), said)
  // Each kind on offer by name with its price: "A for 11, B for 22", or "A or B for 11 essence each".
  const offers = [...new Set(node.foes.map((f) => f.id))].map((id) => ({ name: UNIT_LIST.find((u) => u.id === id).name, cost: soulOffer(run, { id }).cost }))
  const same = offers.every((o) => o.cost === offers[0].cost)
  for (const o of offers) assert.ok(said.includes(same ? o.name : `${o.name} for ${o.cost}`), o.name)
  if (same) assert.ok(said.includes(`for ${offers[0].cost} essence`), said)
  const altar = { id: 'a', type: 'altar', next: [] }
  const text = (x) => [x].flat(Infinity).filter((c) => c != null && c !== false).map((c) => (typeof c === 'object' ? c.textContent : String(c))).join('')
  assert.equal(text(roomGain(run, altar)), 'Nothing to heal now.')
  monarchOf(s).hp -= 30
  assert.match(text(roomGain(run, altar)), /^Heals the Monarch \+30\b/)
  assert.ok(relicTip('grave_banner', run).textContent.includes(`One more: Command ${commandOf(s)} → ${commandOf(s) + 1}`))
  // A kin banner's tip tells its kin's stat, its own copies apart from every soul's cost (redesign.md §4.4).
  s.relics.push('bone_horn', 'wyrm_standard')
  assert.ok(relicTip('wyrm_standard', run).textContent.includes('×1 owned: every Drake\'s ATK ×1 → ×1.25 · one more: every Drake\'s ATK ×1.25 → ×1.56'), relicTip('wyrm_standard', run).textContent)
  assert.ok(relicTip('bone_horn', run).textContent.includes('every soul\'s HP ×1 → ×0.9'), relicTip('bone_horn', run).textContent)
  assert.ok(relicTip('hive_standard', run).textContent.includes('One more: every Insect\'s Move +0 → +1'), relicTip('hive_standard', run).textContent)
  for (const u of souls(s.party)) assert.ok(reachRule(u).includes(`it uses ${basicOf(abilitiesOf(u).map(abilityDef)).name}`), reachRule(u))
})

// The threat meter counts a summon as a whole one of the kind it is, at the root of a summon's share of HP: a kind's own
// as the soul, a trine's as the kind it was made of, at its level and tiers (the first bug hunt, 2026-10-15: it counted a
// trine's as trines).
test('the threat meter counts a trine\'s summons as the kind they are, a kind\'s own as itself', async () => {
  const { threat } = await import('../src/codex.js')
  const { statsOf, summonsOf } = await import('../src/sim/unit.js')
  const { TUNING } = await import('../src/tuning.js')
  const k = Math.sqrt(TUNING.summon.hp)
  const node = { id: 'x', type: 'fight', rank: 1, next: [], foes: [{ id: 'tomb_knight', lvl: 1, slot: 3 }] }
  // One soul alone, whole, its kind two tiers up Marrowcaller (two summons).
  const alone = (id) => {
    const run = createRun({ seed: 'meter', start: [id] })
    run.state.essence = 1e4
    for (let i = 0; i < 2; i++) apply(run, { type: 'upgrade', kind: id, track: 1 })
    return run
  }
  const whole = (id, u) => {
    const st = statsOf({ id, lvl: u.lvl, tracks: u.tracks })
    return Math.sqrt(st.hp * st.atk * st.damage.dealt)
  }
  const chanter = alone('bone_chanter')
  const trine = alone('trine:bone_chanter')
  const [c, t] = [souls(chanter.state.party)[0], souls(trine.state.party)[0]]
  assert.deepEqual([summonsOf(c), summonsOf(t), threat(chanter, node).summons], [2, 2, 2])
  const near = (a, b) => Math.abs(a - b) < 1e-9 * b
  assert.ok(near(threat(chanter, node).mine, (1 + 2 * k) * whole('bone_chanter', c)), 'a Chanter\'s two, Chanters')
  const want = whole('trine:bone_chanter', t) + 2 * k * whole('bone_chanter', t)
  assert.ok(near(threat(trine, node).mine, want), `${threat(trine, node).mine} against ${want}: the trine's two, Chanters`)
})

// The fusion graph told (redesign.md §4.1): the Fusions page lists the mixed recipes and the capstones and tells the
// triple rule in one line, each triple a tile under it (its trine and its kind ×3, never its line); every kind's card,
// a made trine's 2×2 one with borrowed pictures too, names its own trine.
test('the codex\'s Fusions lists the mixed recipes and the capstones, the triples in one line and a tile each; a kind\'s card names its own trine', async () => {
  const { fusionsView } = await import('../src/codex.js')
  const { isTriple, trineOf, unitDef } = await import('../src/content.js')
  const text = fusionsView().textContent
  for (const f of FUSION_LIST) assert.equal(text.includes(f.desc), !isTriple(f), f.id)
  assert.ok(/Trines: every kind of tier 4 or less fuses three of itself/.test(text) && /the Will-o'-Wisp's is the Pale Court/i.test(text), text.slice(0, 400))
  for (const f of FUSION_LIST.filter(isTriple)) assert.ok(text.includes(`${f.name}${unitDef(Object.keys(f.needs)[0]).name} ×3`), f.id)
  for (const d of UNIT_LIST.filter((x) => !x.monarch)) {
    for (const tracks of [[0, 0], [4, 2], [2, 4]]) {
      const card = unitCard({ id: d.id, lvl: 3, tracks }, { open: true }).textContent
      const t = trineOf(d.id)
      assert.equal(card.includes('three fuse into the'), !!t, d.id)
      if (t) assert.ok(card.includes(`three fuse into the ${t.name}, tier ${t.tier}`), `${d.id}: ${card}`)
      assert.ok(!/NaN|undefined/.test(card), `${d.id}: ${card}`)
    }
  }
})

// A kind that borrows its pictures is drawn as what it is (dom.js figures; redesign.md §4.1): a trine as three of the
// kind it was made of, the front one whole and two behind it smaller and darker (a trine of a trine, three trines:
// seven figures); a capstone as its lender washed, a floor's boss (redesign.md §4.7) too and as big as the Sovereign's
// pictures are drawn (144 to 96); a kind with pictures of its own (the Pale Court) by them.
test('a trine is drawn as three of its kind, a trine of a trine as seven, a capstone washed, a floor\'s boss washed and bigger; a kind with pictures of its own by them', async () => {
  const { figures, plainFigure, portrait } = await import('../src/dom.js')
  for (const d of UNIT_LIST) {
    const f = figures(d.id)
    if (d.art === d.id || !(d.fused || d.boss)) {
      assert.ok(plainFigure(d.id) && f[0].art === d.art, d.id)
      continue
    }
    if (d.boss) {
      assert.deepEqual(f, [{ art: d.art, x: 0, y: 0, k: 1.5, dim: 1, wash: true }], d.id)
      assert.equal(portrait(d.id, 40).childNodes.length, 1)
      continue
    }
    if (d.trineOf) {
      const inner = figures(d.trineOf)
      assert.equal(f.length, inner.length === 1 ? 3 : 7, d.id)
      assert.ok(f.every((x) => x.art === inner[0].art && x.wash === inner[0].wash), d.id)
      assert.deepEqual(f.at(-1), { ...inner.at(-1), x: 0, y: 0, k: 1, dim: 1 }, `${d.id}: the front one whole`)
      assert.ok(f.slice(0, -1).every((x) => x.k < 1 && x.dim < 1 && x.y < 0), `${d.id}: the rest behind it`)
    } else assert.ok(f.length === 1 && f[0].wash && f[0].art === d.art, `${d.id}: its lender, washed`)
  }
  assert.ok(UNIT_LIST.filter((d) => d.id.startsWith('trine:')).every((d) => figures(d.id).length >= 3))
  assert.equal(portrait('trine:grave_ghoul', 40).childNodes.length, 3)
  assert.equal(portrait('trine:trine:grave_ghoul', 40).childNodes.length, 7)
  assert.equal(portrait('pale_court', 40).tagName, 'IMG')
  assert.equal(portrait('winter_court', 40).childNodes.length, 1)
})

// The altar's choice (the improvement plan's §4.5) told true: the room's line names the three rites; a transmutation's
// worth the level the soul will stand at and its new kind's tiers; each rite's note what it did.
test('an altar\'s rites are told as they are: the room names the three, a transmutation\'s card its level, each note what the rite did', () => {
  assert.match(ROOM.altar.text, /one rite of three.*[Hh]eal.*transmute.*consecrate/)
  assert.match(KEYWORDS.altar.line, /heal.*transmute.*consecrate/)
  const at = createRun({ start: START_PARTY, seed: 'told-altar' })
  const node = availableNodes(at)[0]
  delete node.foes
  node.type = 'altar'
  apply(at, { type: 'node', id: node.id })
  const copy = () => ({ state: structuredClone(at.state), battle: null, setup: null })
  const said = {}
  for (const a of legalActions(at)) {
    const run = copy()
    const before = structuredClone(run.state.party)
    const worth = a.type === 'transmute' ? transmuteWorth(run, run.state.party.find((u) => u.uid === a.uid), transmuteOffer(run.state, run.state.party.find((u) => u.uid === a.uid).id)[a.index]) : null
    apply(run, a)
    const note = riteNote(run.state, a, before)
    assert.ok(/^The altar burns/.test(note) && !/NaN|undefined/.test(note), note)
    if (worth) {
      const u = run.state.party.find((x) => x.uid === a.uid)
      assert.equal(worth.lvl, u.lvl)
      assert.ok(note.includes(UNIT_LIST.find((d) => d.id === u.id).name) && note.includes(`Lv ${u.lvl}`), note)
      assert.ok(worth.lines.every((l) => !/NaN|undefined/.test(l)) && worth.chips.length > 0)
    }
    if (a.type === 'consecrate') assert.ok(note.includes('free'), note)
    said[a.type] = note
  }
  assert.deepEqual(Object.keys(said).sort(), ['consecrate', 'heal', 'transmute'])
})

// The ascension ladder (the improvement plan's §4.6) told true: a level's words each number that moved, as run.js reads
// it; a room at a level scouted with its foes' mods and its waves' turns.
test('an ascension is told as it plays: level 0 the base game, a level each number that moved, its rooms on its numbers', async () => {
  const { ascensionText, ASCENSION_RULE, roomFoeMods } = await import('../src/codex.js')
  const { ascensionTop, waveEvery, monarchBase, foeScale, foeMods, roomSize, encounter } = await import('../src/sim/run.js')
  const { TUNING } = await import('../src/tuning.js')
  assert.equal(ascensionText(0).short, 'the base game')
  const top = ascensionTop()
  assert.ok(ASCENSION_RULE.includes(`up to ${top}`))
  for (let a = 1; a <= top; a++) {
    const s = { ascension: a, floor: 1 }
    const { short, lines } = ascensionText(a)
    assert.ok(short && lines.every((l) => !/NaN|undefined/.test(l)), `${a}: ${lines}`)
    assert.ok(lines[0].startsWith('Every foe ×'), `${a}`)
    assert.equal(lines.some((l) => l.includes(`Waves ${waveEvery(s)} turns apart`)), waveEvery(s) !== TUNING.spawn.waves.every, `${a}: the waves`)
    assert.equal(lines.some((l) => l.includes(`The Monarch ${monarchBase(s)} HP`)), monarchBase(s) !== TUNING.monarch.hp, `${a}: the Monarch`)
    // The counts on the run's floors (the second bug hunt: on floors 1–4, the fourth the deep's since there are three).
    const floors = Array.from({ length: TUNING.run.floors }, (_, f) => f + 1)
    assert.equal(short.includes('more foes'), floors.some((f) => roomSize(f, false, a) !== roomSize(f, false) || roomSize(f, true, a) !== roomSize(f, true)), `${a}: the counts`)
    const counts = lines.find((l) => l.startsWith('Fights of'))
    if (counts) assert.ok(counts.startsWith(`Fights of ${floors.map((f) => roomSize(f, false, a)).join('/')} foes on floors 1–${TUNING.run.floors} (`), counts)
  }
  // A room at the top: its foes' mods the level's, and its later wave's turn on the level's spacing.
  const run = createRun({ start: START_PARTY, seed: 'told-asc', ascension: top })
  const node = availableNodes(run)[0]
  assert.deepEqual(roomFoeMods(run, node), foeMods(1, false, foeScale(run.state)))
  node.type = 'elite'
  Object.assign(node, { foes: encounter('told-asc', 1, node), waves: [{ foes: encounter('told-asc', 1, { ...node, id: 'w' }).slice(0, 2) }] })
  const tip = roomTip(run, node, { reachable: true }).textContent
  assert.ok(tip.includes(`2 more as turn ${1 + waveEvery(run.state)} begins.`), tip)
  // How to play's Wave, in a run at a level whose waves come sooner, says when they come in it (the second bug hunt: it
  // told the base game's spacing alone).
  const { glossary } = await import('../src/codex.js')
  const wave = (r) => glossary(r).flatMap((g) => g.entries).find((e) => e.name === 'Wave').more
  assert.notEqual(waveEvery(run.state), TUNING.spawn.waves.every)
  assert.ok(wave(run).includes(`At ascension ${top} they come ${waveEvery(run.state)} turns apart.`), wave(run))
  assert.ok(!wave(createRun({ start: START_PARTY, seed: 'told-asc' })).includes('At ascension') && !wave(null).includes('At ascension'))
})

// Every rule that says it is at work (a 'rule' event: rules.js) flares in battle (engine.js rule, by ruleFlares): a
// synergy's as its step and name ("Undead 4 · Legion"), a capstone's as its kind's name, over the piece (the second bug
// hunt: the capstones' rules emitted their events and the scene flared the synergies' alone).
test('every rule at work flares in battle: the synergies\' by step and name, a capstone\'s by its kind\'s name', async () => {
  const { ruleFlares } = await import('../src/codex.js')
  const { readFileSync } = await import('node:fs')
  const flares = ruleFlares()
  const said = [...readFileSync(new URL('../src/sim/rules.js', import.meta.url), 'utf8').matchAll(/type: 'rule', rule: '([a-z_]+)'/g)].map((m) => m[1])
  assert.ok(said.length >= 12, said.join())
  for (const rule of new Set(said)) assert.ok(flares[rule]?.name && flares[rule].step, `${rule} flares`)
  for (const syn of SYNERGIES.filter((x) => x.rule)) assert.deepEqual(flares[syn.rule], { step: syn.name, name: syn.desc.split(': ')[0] })
  for (const d of UNIT_LIST.filter((x) => x.rule && !x.boss)) assert.equal(flares[d.rule].name, d.name, d.id)
  // A boss's (redesign.md §4.7) as "Boss · its name".
  for (const d of UNIT_LIST.filter((x) => x.rule && x.boss)) assert.deepEqual(flares[d.rule], { step: 'Boss', name: d.name }, d.id)
})

// A boss a floor (redesign.md §4.7), told: the map's boss room names its boss, and a floor's what it came for of the
// army; the last floor's that its fall clears the run; a wave its boss comes in by its name; the bestiary, once met,
// where a boss meets you and what it comes for; How to play's lede.
test('a floor\'s boss is told: its room by its name and what it came for, the Sovereign\'s that it clears the run, its wave, its bestiary line', async () => {
  const { roomWords, waveName, bossLine } = await import('../src/codex.js')
  const { floorOf } = await import('../src/sim/autoplay.js')
  const { TUNING } = await import('../src/tuning.js')
  const run = createRun({ start: ['will_o_wisp', 'bone_chanter', 'frost_sprite'], seed: 'told-boss' })
  const end = run.state.map.nodes.find((n) => n.id === run.state.map.end)
  const w = roomWords(run, end)
  assert.equal(w.name, 'The Mire Mother')
  assert.match(w.text, /The floor's boss and its court\. Its fall crumbles them; then a bounty and a recruit, and the next floor\. It came for casters, your Channelers: what your army leaned on most as the floor opened\./)
  assert.match(roomTip(run, end, { reachable: false }).textContent, /The Mire Mother.*It came for casters/)
  // Drawn by the seed alone: said so.
  end.lean = null
  assert.match(roomWords(run, end).text, /The floor drew it/)
  // The last floor's: the Sovereign's siege, its last wave by its name.
  const F = TUNING.run.floors
  const last = floorOf('told-boss', F)
  const sov = last.nodes.find((n) => n.id === last.end)
  const there = { ...run, state: { ...run.state, floor: F } }
  assert.deepEqual(roomWords(there, sov), { name: 'The Hollow Sovereign', text: `${TUNING.spawn.waves.siege} waves, the last the Sovereign and its court. Kill it to clear the run.` })
  assert.equal(waveName(sov, sov.waves.length - 1), `Wave ${sov.waves.length + 1}: the Sovereign`)
  // The bestiary, once met.
  const d = UNIT_LIST.find((x) => x.id === 'swarm_queen')
  assert.equal(bossLine(d), 'it may end floors 1 and 2, and comes for an army that leans on walls, the souls that fight in melee alone.')
  assert.match(bossLine(UNIT_LIST.find((x) => x.id === 'hollow_sovereign')), /last floor's; its fall clears the run/)
  const text = codexView(createRun({ start: START_PARTY, seed: 'codex' })).textContent
  assert.match(text, /ending in a boss and its court, the last floor's the Hollow Sovereign/)
})
