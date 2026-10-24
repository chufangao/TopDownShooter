// The page's logic in node: the screens built under a bare stand-in for the DOM, and the battle scene's drawing read off
// a stand-in for Phaser whose game objects record their calls. Functional only: what the page draws and says, as the
// sim has it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as nodeModule from 'node:module'

// ── the stand-ins ────────────────────────────────────────────────────────────────────────────────

// An element that keeps its children (their text is read back) and its attributes.
class El {
  constructor (tag) {
    this.tagName = tag.toUpperCase()
    this.nodeType = 1
    this.childNodes = []
    this.attrs = {}
    this.dataset = {}
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

  setAttribute (k, v) { this.attrs[k] = v }
  getAttribute (k) { return this.attrs[k] ?? null }
  addEventListener () {}
  removeEventListener () {}
  remove () {}
  querySelector () { return null }
  replaceChildren (...kids) { this.childNodes = kids }
  append (...kids) { this.childNodes.push(...kids) }
  prepend (...kids) { this.childNodes.unshift(...kids) }
  getBoundingClientRect () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  get textContent () { return this.childNodes.map((c) => (typeof c === 'string' ? c : c.textContent)).join('') }
  set textContent (v) { this.childNodes = [String(v)] }
}
const store = new Map()
const page = {
  document: {
    createElement: (tag) => new El(tag), createElementNS: (ns, tag) => new El(tag), getElementById: () => new El('div'),
    body: new El('body'), documentElement: new El('html'), addEventListener () {}
  },
  window: globalThis,
  addEventListener () {},
  removeEventListener () {},
  matchMedia: () => ({ matches: false, addEventListener () {} }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: () => 0,
  cancelAnimationFrame () {},
  MutationObserver: class { observe () {} },
  ResizeObserver: class { observe () {} },
  screen: {},
  localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
}
for (const [k, value] of Object.entries(page)) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true })

// Phaser, as far as the modules read it at load: the scene's base class and a few enums.
const PHASER = 'data:text/javascript,' + encodeURIComponent('export default { Scene: class {}, BlendModes: { ADD: 1, NORMAL: 0 }, TintModes: { MULTIPLY: 0, SCREEN: 1 } }')
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({ resolve: (s, c, next) => (s.endsWith('vendor/phaser.js') ? { url: PHASER, shortCircuit: true } : next(s, c)) })
} else {
  nodeModule.register('data:text/javascript,' + encodeURIComponent(`export async function resolve (s, c, next) { return s.endsWith('vendor/phaser.js') ? { url: ${JSON.stringify(PHASER)}, shortCircuit: true } : next(s, c) }`))
}

const { BattleScene } = await import('../src/engine/scene.js')
const { posAt } = await import('../src/engine/geometry.js')
const { runScreen } = await import('../src/ui/run.js')
const { battleChrome } = await import('../src/ui/battle.js')
const { unitDef } = await import('../src/content.js')
const { createRun, apply } = await import('../src/sim/run.js')
const { order, stride, reach, intents, preview } = await import('../src/sim/turns.js')
const { alive, tileAt } = await import('../src/sim/unit.js')
const { FOE } = await import('../src/engine/palette.js')
const { on, scene, unit } = await import('./scene.js')

// A game object: every call chains and is recorded (`calls`, emptied by clear()); data kept; destroy() marks it.
function fake (props = {}) {
  const o = { x: 0, y: 0, alpha: 1, displayHeight: 12, displayWidth: 30, height: 12, width: 30, ...props, calls: [], data: {}, destroyed: false }
  const self = new Proxy(o, {
    get (t, p) {
      if (p in t) return t[p]
      if (typeof p === 'symbol' || p === 'then') return undefined
      return (...args) => {
        if (p === 'getData') return t.data[args[0]]
        if (p === 'setData') t.data[args[0]] = args[1]
        else if (p === 'destroy') t.destroyed = true
        else if (p === 'clear') t.calls.length = 0
        else if (p === 'setAlpha') t.alpha = args[0]
        t.calls.push([p, ...args])
        return self
      }
    }
  })
  return self
}

// The battle scene on battle `b`, the board free for orders, each unit's picture on its tile; `made`: every game
// object it made.
function sceneOf (b) {
  const sc = Object.create(BattleScene.prototype)
  const made = []
  const mk = (p) => { const o = fake(p); made.push(o); return o }
  Object.assign(sc, {
    battle: b, args: { met: () => true }, sel: null, focus: null, studied: null, waiting: false, ending: false, paused: false,
    player: { finished: true }, monarch: b.monarch?.uid ?? null, aimMarks: [], intentMarks: [], intentGhosts: [], lock: [],
    ghost: { tile: null, img: null }, pointer: null, intent: null, cameras: { main: { zoom: 1 } }, made, changed () {},
    tweens: { killTweensOf () {}, add () {} }, add: { image: (x, y) => mk({ x, y }), text: (x, y, str) => mk({ x, y, str }), graphics: () => mk() }
  })
  sc.planG = mk()
  sc.shotG = mk()
  sc.intentG = mk()
  sc.intentLines = mk()
  sc.actors = new Map(b.units.map((u) => {
    const p = posAt(u.tile, u.size ?? 1)
    return [u.uid, { uid: u.uid, tile: u.tile, sprite: { x: p.x, y: p.y, flipX: false }, vx: p.x, chest: 30, hover: 0, fp: u.size ?? 1, fly: 0, skin: 'unit', art: u.id, scale: 1, gone: !alive(u) }]
  }))
  return sc
}
const select = (sc, uid) => { sc.sel = { uid, ability: sc.firstAct(unit(sc.battle, uid)), aim: null, reach: new Map(), targets: new Set() } }
const marksOver = (sc, uid) => sc.intentMarks.filter((m) => m.data.uid === uid)

// ── the Map ──────────────────────────────────────────────────────────────────────────────────────

// A fresh run's first Map, its drafted soul alone: every room ahead draws, the locked boss's hint named in its label.
test('the Map draws after the draft: a locked room ahead is named in its hint and label, never a crash', () => {
  const run = createRun({ seed: 'map-lock' })
  apply(run, { type: 'pick', index: 0 })
  const screen = runScreen({ run, act: () => {}, trail: [run.state.map.start], onNode: () => {}, onHelp: null })
  const nodes = []
  const walk = (el) => { if (el?.classList?.contains('node')) nodes.push(el); for (const c of el?.childNodes ?? []) if (typeof c !== 'string') walk(c) }
  walk(screen.el)
  assert.equal(nodes.length, run.state.map.nodes.length)
  const end = run.state.map.nodes.find((n) => n.id === run.state.map.end)
  const boss = end.foes.map((f) => unitDef(f.id)).find((d) => d.boss)
  assert.ok(boss?.lock, 'the floor-1 boss is locked')
  const el = nodes.find((x) => x.className.includes(`t-${end.type}`))
  const label = el.getAttribute('aria-label')
  assert.ok(label.includes(`a lock on the ${boss.name} (`), label)
  // A lock is a hint, never a warning: its own tag, apart from the unmet threats'.
  const tags = (cls) => { let n = 0; const w = (x) => { if (x?.classList?.contains(cls)) n++; for (const c of x?.childNodes ?? []) if (typeof c !== 'string') w(c) }; w(el); return n }
  assert.equal(tags('keyhint'), 1, 'the lock\'s hint')
})

// ── the intents ──────────────────────────────────────────────────────────────────────────────────

// A sentry with nothing of yours in its reach: HOLDS over it on the board, and no walk drawn.
test('a sentry out of reach of everything is drawn as holding: HOLDS over it, no path, no ghost', () => {
  const b = scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3, 10), on('brass_sentry', 50, 'foe', 0, 10, 1)])
  const sc = sceneOf(b)
  sc.plan()
  assert.deepEqual(marksOver(sc, 50).map((m) => m.str), ['HOLDS'])
  assert.equal(sc.intentGhosts.length, 0)
})

// A knight beside a ghoul, another knight beside it too; a shooter far down the road.
const board = () => scene([
  on('monarch', 0, 'party', 3, 0),
  on('tomb_knight', 1, 'party', 3, 5, 30),
  on('tomb_knight', 2, 'party', 2, 5, 30),
  on('grave_ghoul', 101, 'foe', 3, 6, 30),
  on('bone_chanter', 102, 'foe', 1, 10, 30)
])

test('the intents are drawn as the board stands, redrawn whole on every plan with nothing left behind, gone while the board is locked', () => {
  const b = board()
  const sc = sceneOf(b)
  sc.plan()
  const c = intents(b)
  assert.ok(sc.intentMarks.length > 0 && sc.intentLines.calls.length > 0, 'marks and lines')
  // Each of yours left untouched strikes the ghoul: its number over the ghoul, the knights' together.
  const hits = c.mine.filter((x) => x.hits[101] > 0).length
  assert.equal(hits, 2)
  assert.ok(marksOver(sc, 101).length >= 2)
  // Drawn again: the same marks, the old ones destroyed; no game object left alive but the four layers and these.
  const n = sc.intentMarks.length
  for (let i = 0; i < 5; i++) sc.plan()
  assert.equal(sc.intentMarks.length, n)
  assert.equal(sc.made.filter((o) => !o.destroyed).length, 4 + sc.intentMarks.length + sc.intentGhosts.length)
  // The selected knight's own intent is not drawn: one number fewer over the ghoul.
  select(sc, 1)
  sc.plan()
  assert.equal(marksOver(sc, 101).length, marksOver(sceneOfPlanned(b), 101).length - 1)
  sc.sel = null
  // A foe tapped: its intent in full, every other faint.
  sc.focus = 102
  sc.plan()
  assert.ok(sc.intentMarks.every((m) => m.alpha === 1 || m.alpha === 0.35))
  assert.ok(sc.intentMarks.some((m) => m.alpha === 0.35), 'the rest faint')
  // Locked (an order playing back): nothing of the intents stands.
  sc.waiting = true
  sc.plan()
  assert.deepEqual([sc.intentMarks.length, sc.intentGhosts.length], [0, 0])
  assert.equal(sc.made.filter((o) => !o.destroyed).length, 4)
  // An order taken: read again.
  sc.waiting = false
  order(b, { type: 'move', uid: 2, tile: tileAt(2, 4) })
  sc.plan()
  assert.equal(sc.intent.key, `${b.turn}|${b.events.length}`)
})
const sceneOfPlanned = (b) => { const sc = sceneOf(b); sc.plan(); return sc }

// The aim's marks stand nearest the struck, the intents' over them, with no gap where the intents' stood before.
test('an aimed blow\'s numbers stand nearest the struck, the intents\' over them', () => {
  const b = board()
  const sc = sceneOf(b)
  select(sc, 1)
  sc.plan()
  assert.ok(marksOver(sc, 101).length > 0, 'the other knight\'s intent over the ghoul')
  sc.aim(101)
  const a = sc.actors.get(101)
  const base = a.sprite.y - a.chest - a.hover - 24
  assert.ok(sc.aimMarks.length > 0)
  assert.equal(sc.aimMarks.filter((m) => m.data.uid === 101)[0].y, base)
  assert.ok(marksOver(sc, 101).every((m) => m.y < base), 'the intents over the aim')
})

// A Move-2 knight (energy 4, its basic 2) three tiles short of a ghoul: lit to walk four, paid to strike from two.
const short = () => scene([on('monarch', 0, 'party', 3, 0), on('tomb_knight', 1, 'party', 3, 3, 30), on('grave_ghoul', 101, 'foe', 3, 7, 30)])
const FAR = tileAt(3, 6)

test('a hovered tile the armed blow is no longer paid from after the walk lights no target there', () => {
  const b = short()
  const u = unit(b, 1)
  const sc = sceneOf(b)
  select(sc, 1)
  sc.plan()
  assert.ok(sc.sel.reach.has(FAR) && !reach(b, u, stride(u, u.basic)).has(FAR), 'lit, not paid')
  const foot = posAt(unit(b, 101).tile)
  // The fill under a ringed target: solid (0.14) where the blow reaches from the plan's tile, faint (0.08) after a walk.
  const solid = () => {
    const calls = sc.planG.calls
    return calls.some((c, i) => c[0] === 'fillEllipse' && c[1] === foot.x && c[2] === foot.y + 4 && calls[i - 1]?.[0] === 'fillStyle' && calls[i - 1][1] === FOE && calls[i - 1][2] === 0.14)
  }
  sc.pointedAt = () => FAR
  sc.plan()
  assert.ok(!solid(), 'nothing ringed solid from a tile it could not strike from')
})

// Walked there for real, it cannot strike: the panel, End Turn's card and its card say it is the energy, not the reach.
test('a piece that walked its energy away is told short of energy, not of a target', () => {
  const b = short()
  const u = unit(b, 1)
  order(b, { type: 'move', uid: 1, tile: FAR })
  const sc = sceneOf(b)
  select(sc, 1)
  sc.plan()
  const p = sc.panel()
  const basic = p.acts.find((x) => x.id === u.basic.id)
  assert.deepEqual([basic.can, basic.short, p.left], [false, true, 1])
  const bar = battleChrome()
  bar.update({ busy: false, panel: p })
  assert.ok(bar.el.textContent.includes(`${u.basic.name} costs ${basic.cost} energy: 1 left.`), bar.el.textContent)
  // End Turn's card and its card's line: out of energy, not out of reach.
  const info = sc.endInfo()
  assert.deepEqual(info.acts.map((x) => [x.act, x.short]), [[null, true]])
  assert.match(sc.pieceLine(1), new RegExp(`no energy for ${u.basic.name}`))
  // Once it has acted, no act of its is short of energy: it has acted.
  const c = board()
  const k = unit(c, 1)
  order(c, { type: 'act', uid: 1, ability: k.basic.id, target: 101 })
  const after = sceneOf(c)
  select(after, 1)
  assert.ok(after.panel().acts.every((x) => !x.short && !x.can))
})

// A melee blow a Vanguard steps into is guarded, not screened: no line of fire took it.
test('an intent whose melee blow a Vanguard takes says GUARDED over the one aimed at, never SCREENED', () => {
  const b = scene([
    on('monarch', 0, 'party', 3, 0),
    on('grave_ghoul', 1, 'party', 0, 4, 30),
    on('bone_chanter', 101, 'foe', 0, 5, 30),
    ...[[1, 6], [2, 9], [3, 9], [4, 9]].map(([x, y], i) => on('tomb_knight', 102 + i, 'foe', x, y, 30))
  ])
  const x = intents(b).mine.find((m) => m.uid === 1)
  assert.deepEqual([x.target, x.struck], [101, 102], 'the knight beside it takes the blow')
  const sc = sceneOf(b)
  sc.plan()
  assert.deepEqual(marksOver(sc, 101).map((m) => m.str), ['GUARDED'])
})

// A shot a guard takes says GUARDED over the one it shielded; a screen on the line, SCREENED over the one aimed at; a
// screen a guard steps in for, both: the intents as the aim, from the act's own record of who took it.
test('a shot a guard takes says GUARDED over the one it shielded, never SCREENED; past a screen a guard steps in for, both, the intent as the aim', () => {
  const vanguards = (first) => [first, [2, 9], [3, 9], [4, 9]].map(([x, y], i) => on('tomb_knight', 102 + i, 'foe', x, y, 30))
  // The sprite's one foe in reach is the chanter; the Vanguard beside it takes the lance (Bodyguard: four Vanguards).
  const b = scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 0, 3, 30), on('bone_chanter', 101, 'foe', 0, 6, 30), ...vanguards([1, 7])])
  const x = intents(b).mine.find((m) => m.uid === 1)
  assert.deepEqual([x.target, x.struck, x.guarded], [101, 102, 101])
  const sc = sceneOf(b)
  sc.plan()
  assert.deepEqual(marksOver(sc, 101).map((m) => m.str), ['GUARDED'])
  // A wisp on the line screens the chanter, and the Vanguard beside the wisp steps in for it.
  const c = scene([on('monarch', 0, 'party', 3, 0), on('frost_sprite', 1, 'party', 0, 3, 30), on('will_o_wisp', 100, 'foe', 0, 4, 30), on('bone_chanter', 101, 'foe', 0, 6, 30), ...vanguards([1, 4])])
  const p = preview(c, 1, 'frost_lance', 101)
  assert.deepEqual([p.struck, p.guarded], [102, 100])
  const words = (list, uid) => list.filter((m) => m.data.uid === uid).map((m) => m.str)
  const aim = sceneOf(c)
  select(aim, 1)
  aim.aim(101)
  assert.deepEqual([words(aim.aimMarks, 101), words(aim.aimMarks, 100)], [['SCREENED'], ['GUARDED']])
  const drawn = sceneOf(c)
  const act = { uid: 1, ability: 'frost_lance', target: 101, struck: p.struck, guarded: p.guarded, hits: p.hits, falls: p.falls, lost: [], heals: {}, statuses: {}, keyed: [], locked: [], counter: 0, to: null, path: null }
  drawn.intentOf(act, 'party', 1)
  assert.deepEqual([words(drawn.intentMarks, 101), words(drawn.intentMarks, 100)], [['SCREENED'], ['GUARDED']])
  // No guard: the screen alone, SCREENED over the one aimed at and nothing over the screen.
  drawn.dropIntents()
  drawn.intentOf({ ...act, struck: 100, guarded: null, hits: { 100: 9 } }, 'party', 1)
  assert.deepEqual([words(drawn.intentMarks, 101), words(drawn.intentMarks, 100)], [['SCREENED'], ['−9']])
})

test('the purse\'s card reads the run\'s purse', () => {
  const sc = sceneOf(board())
  sc.args.bank = () => 52
  sc.owed = 0
  sc.essence = 1
  assert.equal(sc.tally().bank, 52)
})
