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

const { reachRule, reachText, bestiary, codexView, recruitWorth, unitCard, relicTip, relicKind, synergyLabels, ariseFor, realmOf } = await import('../src/codex.js')
const { KEYWORDS } = await import('../src/keywords.js')
const { UNIT_LIST, BEHAVIOURS, FUSION_LIST, RELIC_LIST, SYNERGIES, temperLine } = await import('../src/content.js')
const { makeUnit } = await import('../src/sim/unit.js')
const { createRun, souls, rosterCap, apply } = await import('../src/sim/run.js')
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

test('the glossary\'s words are the seventeen; each way is its own line; no word is Ring, Gauge, ACC, EVA, CRT or Flank', () => {
  const names = Object.values(KEYWORDS).filter((k) => k.group === 'Words').map((k) => k.name)
  assert.deepEqual(names.slice().sort(), ['Command', 'Cooldown', 'Counter', 'Essence', 'Fusion', 'Move', 'Piece', 'Relic', 'Road', 'Shadow', 'Shop', 'Skill',
    'Summon', 'Synergy', 'Tier', 'Turn', 'Wave'])
  for (const [id, b] of Object.entries(BEHAVIOURS)) assert.equal(KEYWORDS[id].line, b.desc)
  for (const k of Object.values(KEYWORDS)) assert.ok(!/\bring\b|gauge|\b(ACC|EVA|CRT)\b|crit|flank|chance/i.test(k.line), `${k.name}: ${k.line}`)
})

test('How to play counts your souls as the cap does: one soul, one piece', () => {
  const run = createRun({ seed: 'codex' })
  run.state.party.push({ ...makeUnit('tomb_knight', { uid: 50 }), slot: -1 })
  const text = codexView(run).textContent
  assert.ok(text.includes(`Souls ${souls(run.state.party).length}/${rosterCap(run)} `), text.match(/Souls [^·]*/)?.[0])
})

test('no word and no line of How to play speaks of stacked pieces or their bodies (a status\'s stacks are its own)', () => {
  for (const [id, k] of Object.entries(KEYWORDS)) {
    if (k.group === 'Words') assert.ok(!/stack|\bbod(y|ies)\b|\bpool\b/i.test(k.line), `${id}: ${k.line}`)
  }
  assert.ok(!('stack' in KEYWORDS))
  const text = codexView(createRun({ seed: 'codex' })).textContent
  assert.ok(!/stack|\bbod(y|ies)\b/i.test(text), text.match(/.{0,40}(stack|bod(y|ies)).{0,40}/i)?.[0])
})

test('a recruit of a kind held says what one more is worth: how many you hold, and each fusion its kind is part of', () => {
  const run = createRun({ seed: 'codex' })
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
  const text = codexView(createRun({ seed: 'codex' })).textContent
  assert.ok(text.includes('A turn is yours'), text.slice(0, 200))
  assert.ok(text.includes('never a skill') && text.includes('No dice'))
  assert.ok(/piece relic works through the soul you give it to/.test(text) && /Arise is one/.test(text), 'held relics (redesign.md §2.15)')
  assert.ok(!/never moves'?\.|stop line|rings? cover|\bring\b|gauge|\b(ACC|EVA|CRT)\b|crit/i.test(text), text.match(/.{0,40}(never moves|stop line|rings? cover|\bring\b|gauge|ACC|EVA|CRT|crit).{0,40}/i)?.[0])
})

test('a relic card says Run or Held; a soul\'s card shows its relic slot, the Monarch\'s none, and no stat but HP, ATK, DEF and Move', () => {
  for (const r of RELIC_LIST) {
    assert.equal(relicKind(r.id), r.run ? 'Run' : 'Held', r.id)
    assert.ok(relicTip(r.id).textContent.includes(r.run ? 'Run' : 'Held'), r.id)
  }
  const run = createRun({ seed: 'codex' })
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
  const run = createRun({ seed: 'codex' })
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
