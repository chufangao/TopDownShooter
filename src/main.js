// Composition root: the Phaser engine (battles only), the DOM screens, and the run that links them.
// Every player input becomes one apply(run, action); the screens only read run.state.
// The DOM screens are laid out at one logical size and scaled to the screen (frame.js); the canvas is not.
import { frame, onFrame } from './frame.js'
import { createEngine } from './engine.js'
import { createRun, apply, currentNode, depthOf, runStat, ascensionTop, openTo, clearAt, tutorialRun } from './sim/run.js'
import { saveOf, restore, SAVE_VERSION } from './sim/save.js'
import { stats, ariseOf } from './sim/turns.js'
import { unitDef, RELICS, TUTORIAL } from './content.js'
import {
  titleScreen, runScreen, NODE, reapScreen, shopScreen, endScreen, battleChrome, draftScreen, altarScreen, askOverlay, tutorialCard, placeText
} from './ui.js'
import { helpOverlay, unitCard, tipDetail, deathText, bestiary, floorNote, riteNote, recruitNote, summonedBy } from './codex.js'
import { showTip, pinTip, hideTip, refreshTip, tipMore, tipPinned, touchy, prefs } from './dom.js'
import { sfx } from './sfx.js'
import { board } from './board.js'

// The display face (style.css @font-face) is in before the board draws a word in it: a canvas draws its text once, in
// whatever face is ready then. Only the board waits (the engine's gate), a moment at most: blocked or slow, it takes
// the system's instead. The screens never wait: CSS swaps the face in when it lands.
const face = Promise.race([
  document.fonts?.load('700 16px Fredoka').catch(() => {}),
  new Promise((resolve) => setTimeout(resolve, 1500))
])

const ui = document.getElementById('ui')
const engine = createEngine('game', { gate: face })
// The Field's board (the map's Field tab) is the battle's own, drawn by the same Phaser game.
board.attach(engine)
let screen = null
let run = null
// The options the run in play was made with (createRun's: save.js keeps them with its log); null for the tutorial.
let made = null
let trail = null
let note = ''
let help = null
// A question or a tutorial screen over the page (askOverlay, tutorialCard): it takes the keys while it is up.
let over = null

// A new kind of screen fades in (feel.css: .screen-in fades its body, never the top bar, and never under
// reduced motion); a screen re-shown in place (the spoils after each pick) swaps without a blink, and keeps
// its scroll. A screen's kind is its class as it went up: one a screen adds to itself later (the spoils'
// 'picking') does not make the next one new.
let kind = null
function show (s) {
  const fresh = kind !== s.el.className
  kind = s.el.className
  screen = s
  hideTip()
  if (fresh) {
    s.el.classList.add('screen-in')
    const done = (e) => {
      if (e.animationName !== 'screen-in') return
      s.el.classList.remove('screen-in')
      s.el.removeEventListener('animationend', done)
    }
    s.el.addEventListener('animationend', done)
  }
  ui.replaceChildren(s.el)
  if (fresh) ui.scrollTop = 0
}

// Every press of a button clicks, unless its own handler already played a sound (buy, card, poor, place,
// select…: sfx.count moved while the click went through) or it says otherwise: data-sfx="none" for
// silence, or data-sfx="<name>" for another sound. Disabled ones stay quiet.
let sounded = 0
document.addEventListener('click', () => { sounded = sfx.count }, true)
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('button, [role="button"], [role="tab"]')
  if (!b || b.getAttribute('aria-disabled') === 'true' || sfx.count !== sounded) return
  const own = b.dataset.sfx
  if (own !== 'none') sfx.play(own || 'click')
})

// What covers the battle (How to play, the rotate prompt) pauses it while it is there, and it plays on once the
// last of them goes (one already paused stays so after). A battle begun under one is held from its start.
const covers = new Set()
let coverPaused = null
const battleScene = () => {
  const b = engine.game.scene.getScene('Battle')
  return b?.sys.isActive() ? b : null
}
function hush () {
  const b = battleScene()
  if (covers.size && b && !b.paused && !b.ending) { b.setPaused(true); coverPaused = b }
}
function cover (why, on) {
  if (on) { covers.add(why); return hush() }
  if (!covers.delete(why) || covers.size) return
  if (coverPaused && coverPaused === battleScene() && coverPaused.paused) coverPaused.setPaused(false)
  coverPaused = null
}
// Held upright (style.css #rotate shows): the battle waits for the screen to turn back.
const upright = matchMedia('(orientation: portrait)')
const turned = () => cover('rotate', upright.matches)
upright.addEventListener?.('change', turned)
turned()
// The page hidden (the phone locked, another app): the battle pauses, and stays paused for the player's return.
document.addEventListener('visibilitychange', () => {
  const b = battleScene()
  if (document.hidden && b && !b.paused && !b.ending) b.setPaused(true)
})

// How to play pauses a battle (above), and puts the cursor in its search box: never by touch, where that would
// raise the on-screen keyboard over half the screen.
function toggleHelp () {
  hideTip()
  if (help) {
    help.remove()
    help = null
    return cover('help', false)
  }
  help = helpOverlay(toggleHelp, run)
  frame.el.append(help)
  cover('help', true)
  if (!touchy()) help.querySelector('.gl-search')?.focus({ preventScroll: true })
}

// Holding Shift opens the details of the card under the pointer (codex.js tipDetail); letting go closes them.
const detail = (on) => { if (tipDetail.on !== on) { tipDetail.on = on; refreshTip() } }
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') detail(true) })
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') detail(false) })
window.addEventListener('blur', () => detail(false))
// By touch, a pinned card's More ▾ / Less ▴ does what Shift does (dom.js).
Object.assign(tipMore, { get: () => tipDetail.on, set: detail })

// A control the keyboard focused (a button, a tab, a fold of the rules) presses itself on Enter or Space: its
// own press wins over the screen's keys. One a click just focused holds nothing: the key lets go of it and
// goes to the screen (Enter starts a run, Space pauses), so a click never turns the next Enter into a second click.
const CONTROL = 'button, [role="button"], [role="tab"], a[href], summary, select, textarea'
let pressing = false
let clicked = null
document.addEventListener('pointerdown', () => { pressing = true }, true)
for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, () => { pressing = false }, true)
document.addEventListener('focusin', (e) => { clicked = pressing ? e.target : null })

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
  // The seed box takes Enter (start); the rules' search box handles its own keys (codex.js helpOverlay).
  if (e.target.tagName === 'INPUT' && e.key !== 'Enter') return
  if (e.key === 'Enter' || e.key === ' ') {
    const c = e.target.closest?.(CONTROL)
    if (c && c !== clicked) return
    if (c) { e.preventDefault(); c.blur() }
  }
  // Opens How to play, or closes it from anywhere but its search box (which closes it on its own while empty).
  // Kept from the search box it focuses: the key that opens it does not type.
  if (e.key === 'h' || e.key === 'H' || e.key === '?') { e.preventDefault(); return toggleHelp() }
  if (e.key === 'm' || e.key === 'M') { if (!sfx.toggle()) sfx.play('click'); return }
  if (help) { if (e.key === 'Escape') toggleHelp(); return }
  if (over) return over.key?.(e)
  screen?.key?.(e)
})

const newSeed = () => (Date.now() % 1e8).toString(36) + Math.floor(Math.random() * 1296).toString(36)

// Every action main.js gives the run (and every battle order the scene gives) goes through play: applied, then the run
// saved (keep). Returns what apply returns (an order's events).
function play (action) {
  const out = apply(run, action)
  keep()
  return out
}

// The ascension ladder (redesign.md §4.6): the highest level cleared in this browser (prefs 'ascended'; −1 for none)
// opens the one above it (run.js openTo); the level chosen is kept in the URL (?ascension=) and in prefs ('ascension'),
// the URL's first, and never above the highest open.
const level = (v) => (v !== null && /^\d+$/.test(v) ? Math.min(Number(v), ascensionTop()) : null)
const cleared = () => level(prefs.get('ascended')) ?? -1
let ascension = Math.min(openTo(cleared()), level(new URLSearchParams(location.search).get('ascension')) ?? level(prefs.get('ascension')) ?? 0)
function choose (a) {
  ascension = a
  prefs.set('ascension', String(a))
  const url = new URL(location.href)
  if (a) url.searchParams.set('ascension', a)
  else url.searchParams.delete('ascension')
  history.replaceState(null, '', url)
}
// A clear opens the level above it, once a run (run.js clearAt): what it opened is its end screen's to say.
let opened = null
function ascend () {
  const s = run.state
  if (s.result !== 'victory') return null
  if (opened?.run !== run) {
    const c = clearAt(cleared(), s.ascension ?? 0)
    prefs.set('ascended', String(c.cleared))
    opened = { run, level: c.opened }
  }
  return opened.level
}

// For the retinue editor: an illegal action comes back as a message instead of a throw.
function act (action) {
  try {
    play(action)
    return null
  } catch (e) {
    return e.message
  }
}

// ── the run saved (redesign.md §4.8; sim/save.js) ──────────────────────────────────────────────

// After every action the run in play is saved in this browser: the options it was made with and its log. A finished
// run (cleared or lost) drops its save; the tutorial never has one.
function keep () {
  if (!run || run.state.tutorial) return
  const text = saveOf(run, made)
  if (text) prefs.set('save', text)
  else prefs.drop('save')
}

const SET_ASIDE = 'Your saved run was made by an older version of the game and no longer plays the same: it was set aside.'
// The saved run's place (save.js `at`), for the title's Continue, or null for none. One that is not a save of this
// version is dropped, and the title says so (`aside`).
let aside = ''
function saved () {
  const text = prefs.get('save')
  if (!text) return null
  try {
    const s = JSON.parse(text)
    if (s?.v === SAVE_VERSION && s.at && typeof s.run?.seed === 'string') return s.at
  } catch {}
  prefs.drop('save')
  aside = SET_ASIDE
  return null
}

// Continue: the saved run played back from its log (save.js restore), as it stood, mid-battle too; one that no longer
// plays is dropped with a note, back on the title.
function resume () {
  const back = restore(prefs.get('save') ?? '')
  if (back.error) {
    console.warn(`saved run set aside (${back.error}): ${back.why}`)
    prefs.drop('save')
    return title(newSeed(), SET_ASIDE)
  }
  run = back.run
  made = back.made
  note = ''
  trail = trailOf(run)
  route()
}

// The rooms walked on the floor the run stands on, from its log: the start, then its last `rank` walks (a walk a rank).
function trailOf (run) {
  const s = run.state
  const rank = currentNode(run)?.rank ?? 0
  const walks = rank ? s.log.filter((a) => a.type === 'node').slice(-rank).map((a) => a.id) : []
  return { floor: s.floor, ids: [s.map.start, ...walks] }
}

// A question or a tutorial screen up over the page (and the battle paused under it), or taken down (null).
function overlay (el) {
  over?.remove()
  over = el
  if (el) frame.el.append(el)
  cover('overlay', !!el)
}

function title (seed, said = '') {
  run = null
  made = null
  overlay(null)
  ascension = Math.min(ascension, openTo(cleared()))
  const at = saved()
  show(titleScreen({
    seed, level: ascension, open: openTo(cleared()), onLevel: choose, onStart: start, onHelp: toggleHelp,
    saved: at, note: said || aside, onContinue: resume, onTutorial: tutorial
  }))
  aside = ''
  // A first visit (no run saved, the tutorial never played) is offered the tutorial, once.
  if (!at && prefs.get('did:tutorial') !== '1' && prefs.get('did:offer') !== '1') {
    prefs.set('did:offer', '1')
    overlay(askOverlay({
      title: 'New here?',
      text: 'The tutorial is one battle before floor 1, with three souls given you and three short screens of text: a few minutes, never saved. The title offers it again whenever you like.',
      yes: 'Play the tutorial', no: 'Not now', lead: 'yes',
      onYes: tutorial, onNo: () => overlay(null)
    }))
  }
}

// A new run. Over a saved one, it asks first: the saved run ends for good.
function start (seed) {
  const at = saved()
  if (at) {
    return overlay(askOverlay({
      title: 'End your saved run?',
      text: `A run is saved at ${placeText(at)}. A new run ends it for good: defeat is absolute, and so is leaving.`,
      yes: 'End it and begin', no: 'Keep it',
      onYes: () => { overlay(null); prefs.drop('save'); start(seed) },
      onNo: () => overlay(null)
    }))
  }
  made = ascension ? { seed, ascension } : { seed }
  run = createRun(made)
  note = ''
  keep()
  route()
}

// ── the tutorial (redesign.md §4.8; content.js TUTORIAL, run.js tutorialRun) ───────────────────

// One room before floor 1, played as any run is, never saved; its three screens come once each, at their moments
// (lesson). Won, the spoils end it and the title takes over; lost, the title says so.
const taught = new Set()
function tutorial () {
  overlay(null)
  run = tutorialRun()
  made = null
  note = ''
  taught.clear()
  route()
}

// The tutorial's screen `key` (content.js TUTORIAL.screens: field, battle, spoils), once.
function lesson (key) {
  if (!run?.state.tutorial || taught.has(key)) return
  taught.add(key)
  const keys = Object.keys(TUTORIAL.screens)
  overlay(tutorialCard({ screen: TUTORIAL.screens[key], step: keys.indexOf(key) + 1, of: keys.length, onGo: () => overlay(null) }))
}

// The tutorial over: won (its spoils taken or passed on) or lost.
function graduate () {
  const fell = !!run.state.death
  prefs.set('did:tutorial', '1')
  title(newSeed(), fell ? 'The Monarch fell on the threshold. In a run, that would be the end of it: try the tutorial again, or begin.'
    : 'The tutorial is done. Begin the descent when you are ready: your first floor is like the threshold, with more rooms and more foes.')
}

// A run state from before relics had tiers (one with `keystones`, its Arise free) carries on under the new rules:
// its keystones join its relics (the same ids, now Legendaries, waiting unheld: redesign.md §2.15), and an id no
// longer known is dropped, from the relics and from what a soul holds, so an old state never breaks the page. One
// from before the Monarch lost its points drops them, and its rites and reliquaries are shops.
function migrate (s) {
  if (!Array.isArray(s.relics)) s.relics = []
  if ('keystones' in s) {
    s.relics.push(...(s.keystones ?? []))
    if (!s.relics.includes('arise')) s.relics.push('arise')
    delete s.keystones
  }
  s.relics = s.relics.filter((id) => RELICS[id])
  for (const u of s.party) if (u.relics) u.relics = u.relics.filter((id) => RELICS[id])
  delete s.monarch
  for (const n of s.map?.nodes ?? []) if (n.type === 'rite' || n.type === 'reliquary') n.type = 'shop'
  s.shop ??= []
}

function route () {
  const s = run.state
  if (s.tutorial && s.phase === 'over') return graduate()
  migrate(s)
  if (!trail || trail.floor !== s.floor) {
    // A new floor: its number and its prices (codex.js floorNote); in the deep, how the foes have grown.
    if (trail && s.phase === 'map') note = floorNote(s)
    trail = { floor: s.floor, ids: [s.map.start] }
  }
  if (s.phase === 'battle') {
    // A saved run resumed mid-battle: the battle as it stood, its orders played again.
    fight({ resume: true })
  } else if (s.phase === 'draft') {
    show(draftScreen({ run, onPick: pick, onHelp: toggleHelp }))
  } else if (s.phase === 'map') {
    show(runScreen({ run, trail: trail.ids, note, onNode, act, onHelp: toggleHelp }))
    note = ''
    lesson('field')
  } else if (s.phase === 'prep') {
    // A battle room entered: its battle starts at once, with the souls where the Field left them.
    fight()
  } else if (s.phase === 'reap') {
    show(reapScreen({ run, title: currentNode(run).type === 'elite' ? 'The elite falls' : 'Spoils', act, onDone: reap, onHelp: toggleHelp }))
    lesson('spoils')
  } else if (s.phase === 'shop') {
    show(shopScreen({ run, act, onLeave: leave, onHelp: toggleHelp }))
  } else if (s.phase === 'altar') {
    show(altarScreen({ run, onRite: rite, onHelp: toggleHelp }))
  } else {
    show(endScreen({ run, opened: ascend(), onNew: () => title(newSeed()), onDescend: descend, onHelp: toggleHelp }))
  }
}

function onNode (id) {
  play({ type: 'node', id })
  trail.ids.push(id)
  route()
}

// An altar's rite (redesign.md §4.5): its note on the map says what it did, read against each piece as it stood before.
function rite (action) {
  const before = structuredClone(run.state.party)
  play(action)
  note = riteNote(run.state, action, before)
  route()
}

// A pick of the draft: its soul joins; the last opens the floor's map.
function pick (index) {
  play({ type: 'pick', index })
  route()
}

// Out of a Shop, free; what was bought is already in the bar.
function leave () {
  play({ type: 'leave' })
  route()
}

// Past the slain Sovereign, on into the deep: the next floor's map (route() notes the new floor).
function descend () {
  play({ type: 'descend' })
  route()
}

// The spoils are one recruit at most (relics are the Shop's): a recruit rises a piece of its own, and its note says
// where it went (run.js join pushes it last into the party).
function reap (index) {
  const o = index === null ? null : run.state.offers[index]
  play({ type: 'reap', index })
  if (o) {
    const said = recruitNote(run, run.state.party.at(-1))
    note = note ? `${note} ${said}` : said
  }
  route()
}

// The battle is the run's own (run.battle, phase 'battle'): the scene gives the player's orders to the run (apply),
// which returns each one's events to play, and once the battle is over the run has finished it itself (its phase
// moved on). Entered from the Field (a room's key), the board you arranged stays up while the battle is built under
// it, then fades into it with everyone where they stood (board.leave), and the battle skips its own fade in; entered
// from the Map, the battle fades in on its own. A lost battle ends on a replay beat of what felled the Monarch
// (engine.js finish), the facts the end screen keeps. `resume`: a saved run's battle under way (resume), its scene
// built from the battle's start with every order since played again at once, out of sight (engine.js `resume`).
async function fight ({ resume = false } = {}) {
  const node = currentNode(run)
  // The fight first: refused, the Field's board is never left glided half out.
  if (!resume) play({ type: 'fight' })
  const handoff = resume ? null : board.leave()
  // The battle's chrome keeps the Field's layout (ui.js battleChrome): the board fits its stage, as the Field's did.
  const bar = battleChrome({ onHelp: toggleHelp })
  show(bar)
  const battle = run.battle
  const s = run.state
  // What the run has paid out so far: what it holds more once the battle is won is the battle's pay (the banner's).
  const paid = s.stats?.essence ?? 0
  // The tutorial's foes are met as its battle opens, so its second screen can say so (tap one for its reach).
  if (s.tutorial) bestiary.record(battle.units.filter((u) => u.side === 'foe').map((u) => u.id))
  const scene = await engine.battle({
    battle,
    order: (o) => play(o),
    hud: bar.hud,
    stage: bar.stage,
    seamless: !!handoff,
    resume,
    // A foe kind met (the bestiary): tapped, its reach is drawn (redesign.md §4.8).
    met: (id) => bestiary.has(id),
    title: `${s.tutorial ? 'The threshold' : `Floor ${run.setup.floor}${depthOf(run.setup.floor) ? ` · deep ${depthOf(run.setup.floor)}` : ''}`} · ${NODE[node.type].name}`,
    onChange: (st) => bar.update(st),
    // A slain foe's essence is multiplied by this as the purse takes it, for the per-wave popups.
    essence: runStat(s, 'essence.gain', 1),
    // An elite pays its bounty on a win (the purse's card); what the run took for the battle, read as it ends.
    elite: node.type === 'elite',
    earned: () => (s.stats?.essence ?? 0) - paid,
    // Read as the battle ends (it is decided only then).
    // A status's tick struck from nowhere: no blow is replayed for it (codex.js deathText `tick`).
    death: () => {
      if (!s.death || battle.winner === 'party') return null
      const d = deathText(s, battle)
      return { ...d, from: d.tick ? null : s.death.from ?? null, by: s.death.uid ?? null }
    },
    // Live stats and statuses for the unit under the pointer. Only your own plans are told: a foe's never are.
    // `pin`: a long press (touch) or a click, the card stays until the next press, the pointer leaving it or not.
    onHover: (u, at, pin = false) => {
      if (!u) return tipPinned() || hideTip()
      const foe = u.side === 'foe'
      // A shadow the Legion (Undead 4) raised is marked on its arise event; on the foes' side it is one of yours. A
      // summon (a kind's tier called it up as the battle began) holds beside the piece of its kind that called it.
      const legion = u.shadow && battle.events.some((e) => e.type === 'arise' && e.rule === 'legion' && e.unit.uid === u.uid)
      const me = u.uid === battle.monarch?.uid
      const arise = !foe && u.hp > 0 && u.kit && ariseOf(battle, u)
      // One of yours leads with its turn as it stands (engine.js pieceLine: its Move left, each skill ready or resting,
      // how many foes its basic reaches), or for a shadow the basic it uses each turn and what Hollow Court pays for it.
      const turn = !foe && u.hp > 0 ? battleScene()?.pieceLine(u.uid) ?? null : null
      const live = [
        u.hp <= 0 && (foe || u.shadow ? 'Fallen' : 'Fallen: an altar raises it'),
        me && 'If it falls, the run ends',
        turn,
        u.shadow && (foe ? (legion ? 'Your fallen, raised by their Legion' : 'Grave Tide shadow: falls with the Sovereign')
          : u.summoned ? `${summonedBy(battle, u)}: gone after the battle`
            : u.reap > 0 ? 'Shadow: Hollow Court reaps it if it stands' : 'Shadow: acts on its own each turn, gone after the battle'),
        u.rose && 'Risen by Undying: its next fall is final',
        arise && `Arise: corpses within ${arise.domain} tiles, tier ≤ ${arise.tier}`,
        u.flies && 'Flying: only a ranged blow (or a flyer\'s melee) can strike it',
        foe && u.wave && `Came with wave ${u.wave + 1}`].find(Boolean) || null
      const realm = { arise: (x) => (x.kit ? ariseOf(battle, x) : null) }
      const tip = pin ? pinTip : showTip
      // `u` is the unit as the playback shows it (engine.js seen): its stats are read off the battle's own.
      tip(at, () => unitCard(u, { stats: stats(battle, battle.byUid.get(u.uid) ?? u), statuses: u.statuses, foe, realm, run, live }))
    },
    onDone: () => {
      // Skipped before its end: the result still sounds (a played-out battle sounded it as its banner rose).
      if (!scene?.ending) sfx.play(battle.winner === 'party' ? 'win' : 'lose')
      // Every foe kind that took the field is met: its reach and its way are told from now on (the bestiary).
      bestiary.record(battle.units.filter((u) => u.side === 'foe' && !u.shadow).map((u) => u.id))
      // Shadows are not souls: they were never yours to keep. The fallen souls have left the field for the ossuary
      // (run.js finishBattle), their cells and Command free, and wait there for an altar. A part fused away is no fall.
      const fallen = battle.units.filter((u) => u.side === 'party' && !u.shadow && !u.into && u.hp <= 0 && u.uid !== battle.monarch?.uid).map((u) => unitDef(u.id).name)
      if (fallen.length && s.phase !== 'over') note = `Fallen: ${fallen.join(', ')}. ${fallen.length > 1 ? 'They lie' : 'It lies'} in the ossuary, ${fallen.length > 1 ? 'their cells' : 'its cell'} and Command free, until an altar raises ${fallen.length > 1 ? 'them' : 'it'}.`
      route()
    }
  })
  handoff?.(scene)
  bar.attach(scene)
  hush()
  lesson('battle')
}

// The frame rescaled (a resize, a rotation, the iOS toolbar): a battle playing fits itself under its bar again.
// The Field's board needs nothing: board.js checks the stage's rect every frame.
onFrame(() => {
  const battle = engine.game.scene.getScene('Battle')
  if (battle?.sys.isActive()) battle.fit()
})

const seed = new URLSearchParams(location.search).get('seed') ?? newSeed()
choose(ascension)
title(seed)

// Console access for debugging: retinue.run.state, retinue.run.state.log, retinue.route() (redraw the screen after
// applying actions by hand), …
window.retinue = { engine, route, get run () { return run } }
