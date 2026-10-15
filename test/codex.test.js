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
  const saved = { add: globalThis.addEventListener, remove: globalThis.removeEventListener, raf: globalThis.requestAnimationFrame }
  globalThis.addEventListener = (type, f) => { (on[type] ??= new Set()).add(f) }
  globalThis.removeEventListener = (type, f) => { on[type]?.delete(f) }
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 16)
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const lift = (id) => { for (const f of [...(on.pointerup ?? [])]) f({ pointerId: id }) }
  try {
    let fired = 0
    // Pressed long before the timer could run: the page was busy, and the lift is read just after the timer.
    hold({ pointerId: 1, clientX: 0, clientY: 0, timeStamp: performance.now() - HOLD - 300 }, () => fired++)
    await wait(HOLD + 2)
    lift(1)
    await wait(60)
    assert.equal(fired, 0, 'a quick tap read late is no long press')
    // The same late timer with no lift: a long press after all.
    hold({ pointerId: 2, clientX: 0, clientY: 0, timeStamp: performance.now() - HOLD - 300 }, () => fired++)
    await wait(HOLD + 60)
    assert.equal(fired, 1)
    // A press held on an idle page fires on time.
    hold({ pointerId: 3, clientX: 0, clientY: 0, timeStamp: performance.now() }, () => fired++)
    await wait(HOLD + 20)
    assert.equal(fired, 2)
  } finally {
    globalThis.addEventListener = saved.add
    globalThis.removeEventListener = saved.remove
    globalThis.requestAnimationFrame = saved.raf
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
  for (const u of souls(s.party)) assert.ok(reachRule(u).includes(`it uses ${basicOf(abilitiesOf(u).map(abilityDef)).name}`), reachRule(u))
})

// The fusion graph told (redesign.md §4.1): the Fusions page lists the mixed recipes and the capstones and tells the
// triple rule in one line; every kind's card, a made trine's 2×2 one with borrowed pictures too, names its own trine.
test('the codex\'s Fusions lists the mixed recipes and the capstones, the triples in one line; a kind\'s card names its own trine', async () => {
  const { fusionsView } = await import('../src/codex.js')
  const { isTriple, trineOf } = await import('../src/content.js')
  const text = fusionsView().textContent
  for (const f of FUSION_LIST) assert.equal(text.includes(f.desc), !isTriple(f), f.id)
  assert.ok(/Trines: every kind of tier 4 or less fuses three of itself/.test(text) && /the Will-o'-Wisp's is the Pale Court/i.test(text), text.slice(0, 400))
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
