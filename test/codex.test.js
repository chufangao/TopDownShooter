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

const { ringRule, ringText, bestiary, codexView, recruitWorth } = await import('../src/codex.js')
const { KEYWORDS } = await import('../src/keywords.js')
const { UNIT_LIST, BEHAVIOURS, FUSION_LIST, abilityDef } = await import('../src/content.js')
const { abilitiesOf, isBlow, makeUnit, behaviourOf } = await import('../src/sim/unit.js')
const { createRun, souls, rosterCap } = await import('../src/sim/run.js')

const FOES = UNIT_LIST.filter((u) => u.spawn || u.boss)
bestiary.record(FOES.map((u) => u.id))
const hasMelee = (id) => abilitiesOf(makeUnit(id, { uid: 1 })).map(abilityDef).some((a) => isBlow(a) && a.melee)

test('a met foe\'s card tells its way, and what its melee strikes only for a kind with a melee blow', () => {
  assert.ok(FOES.some((u) => !hasMelee(u.id)), 'a shooter with no melee blow to read')
  for (const u of FOES) {
    const way = BEHAVIOURS[behaviourOf(u)]
    const text = ringRule({ id: u.id, lvl: 1 }, true)
    assert.ok(text.includes(way.desc), `${u.id}: its way`)
    if (hasMelee(u.id)) assert.ok(text.endsWith(way.melee), `${u.id}: ${text}`)
    else assert.ok(!text.includes(way.melee) && !/Its (melee|blows are melee)/.test(text), `${u.id} has no melee blow: ${text}`)
    assert.ok(!/flank/i.test(text + ringText({ id: u.id, lvl: 1 }, true)), `${u.id}: Flank is gone`)
  }
})

test('the glossary tells each way, then what a foe\'s melee strikes on it; no word is Flank', () => {
  for (const [id, b] of Object.entries(BEHAVIOURS)) {
    assert.ok(!/melee reaches/.test(b.desc), `${id}: the way alone in its desc`)
    assert.equal(KEYWORDS[id].line, `${b.desc} ${b.melee}`)
  }
  assert.ok(!('flank' in KEYWORDS))
  for (const k of Object.values(KEYWORDS)) assert.ok(!/flank/i.test(k.line), k.name)
})

test('How to play counts your souls as the cap does: one soul, one piece', () => {
  const run = createRun({ seed: 'codex' })
  run.state.party.push({ ...makeUnit('tomb_knight', { uid: 50 }), slot: -1 })
  const text = codexView(run).textContent
  assert.ok(text.includes(`Souls ${souls(run.state.party).length}/${rosterCap(run)} `), text.match(/Souls [^·]*/)?.[0])
  assert.ok(!/flank/i.test(text))
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
