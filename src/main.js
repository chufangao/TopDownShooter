// Composition root: the Phaser engine (battles only), the DOM screens, and the run that links them.
// Every player input becomes one apply(run, action); the screens only read run.state.
// The DOM screens are laid out at one logical size and scaled to the screen; the canvas is not.
import { frame, onFrame } from './frame.js'
import { createEngine } from './engine.js'
import {
  createRun, apply, currentNode, depthOf, runStat, ascensionTop, openTo, clearAt, tutorialRun, bountyOf, BASE_MONARCH, monarchsOpen, monarchsAt,
  BATTLE_NODES, fielded, souls
} from './sim/run.js'
import { saveOf, restore, SAVE_VERSION } from './sim/save.js'
import { recordOf, readBook, withRun } from './sim/history.js'
import { stats, ariseOf, targetsFrom, canAct, stride } from './sim/turns.js'
import { deployTile } from './sim/unit.js'
import { RELICS, TUTORIAL } from './content.js'
import {
  coach, titleScreen, runScreen, NODE, reapScreen, endScreen, battleChrome, draftScreen, altarScreen, askOverlay, tutorialCard, placeText,
  historyScreen, soundControls
} from './ui.js'
import { helpOverlay, unitCard, tipDetail, deathText, bestiary, floorNote, riteNote, recruitNote, summonedBy } from './codex.js'
import { showTip, pinTip, hideTip, refreshTip, tipMore, tipPinned, touchy, prefs, say } from './dom.js'
import { sfx } from './sfx.js'
import { music, trackOf } from './music.js'
import { board } from './board.js'

// The display face is in before the board draws a word (a canvas draws its text once, in whatever face is ready); only
// the board waits, 1.5 s at most, then takes the system's. The screens never wait: CSS swaps the face in.
const face = Promise.race([
  document.fonts?.load('700 16px Fredoka').catch(() => {}),
  new Promise((resolve) => setTimeout(resolve, 1500))
])

const ui = document.getElementById('ui')
const engine = createEngine('game', { gate: face })
board.attach(engine)
let screen = null
let run = null
// The options the run in play was made with (saved with its log); null for the tutorial.
let made = null
// What the interface keeps with the run (null for the tutorial): `begun`, ms since the epoch (with its seed, its id in
// the history), and `time`, the ms played.
let meta = null
let trail = null
let note = ''
let help = null
// A question or a tutorial screen over the page: it takes the keys while it is up.
let over = null

// A new kind of screen fades in; one re-shown in place (the spoils after each pick) swaps without a blink and keeps its
// scroll. A screen's kind is its class as it went up, not one it adds to itself later.
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

// Every press of a button clicks, unless its own handler already played a sound (sfx.count moved) or it says otherwise:
// data-sfx="none" for silence, data-sfx="<name>" for another. Disabled ones stay quiet.
let sounded = 0
document.addEventListener('click', () => { sounded = sfx.count }, true)
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('button, [role="button"], [role="tab"]')
  if (!b || b.getAttribute('aria-disabled') === 'true' || sfx.count !== sounded) return
  const own = b.dataset.sfx
  if (own !== 'none') sfx.play(own || 'click')
})

// What covers the battle (How to play, the rotate prompt) pauses it until the last of them goes; one paused before stays so.
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
// Held upright, the battle waits for the screen to turn back.
const upright = matchMedia('(orientation: portrait)')
const turned = () => cover('rotate', upright.matches)
upright.addEventListener?.('change', turned)
turned()
// The page hidden (the phone locked, another app): the battle pauses, and stays paused for the player's return.
document.addEventListener('visibilitychange', () => {
  const b = battleScene()
  if (document.hidden && b && !b.paused && !b.ending) b.setPaused(true)
})

// How to play pauses a battle and focuses its search box: never by touch, where that would raise the keyboard.
function toggleHelp () {
  hideTip()
  if (help) {
    help.remove()
    help = null
    cover('help', false)
    return hint()
  }
  help = helpOverlay(toggleHelp, run, { sound: soundControls() })
  frame.el.append(help)
  cover('help', true)
  hint()
  if (!touchy()) help.querySelector('.gl-search')?.focus({ preventScroll: true })
}

// Holding Shift opens the details of the card under the pointer; letting go closes them.
const detail = (on) => { if (tipDetail.on !== on) { tipDetail.on = on; refreshTip() } }
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') detail(true) })
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') detail(false) })
window.addEventListener('blur', () => detail(false))
// By touch, a pinned card's More ▾ / Less ▴ does what Shift does.
Object.assign(tipMore, { get: () => tipDetail.on, set: detail })

// A control the keyboard focused presses itself on Enter or Space; one a click just focused lets the key go to the
// screen instead, so a click never turns the next Enter into a second click.
const CONTROL = 'button, [role="button"], [role="tab"], a[href], summary, select, textarea'
let pressing = false
let clicked = null
document.addEventListener('pointerdown', () => { pressing = true }, true)
for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, () => { pressing = false }, true)
document.addEventListener('focusin', (e) => { clicked = pressing ? e.target : null })

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
  // The seed box takes Enter (start); the rules' search box handles its own keys.
  if (e.target.tagName === 'INPUT' && e.key !== 'Enter') return
  if (e.key === 'Enter' || e.key === ' ') {
    const c = e.target.closest?.(CONTROL)
    if (c && c !== clicked) return
    if (c) { e.preventDefault(); c.blur() }
  }
  // H opens How to play or closes it; kept from the search box it focuses, so the key does not type.
  if (e.key === 'h' || e.key === 'H' || e.key === '?') { e.preventDefault(); return toggleHelp() }
  if (e.key === 'm' || e.key === 'M') { if (!sfx.toggle()) sfx.play('click'); return }
  if (help) { if (e.key === 'Escape') toggleHelp(); return }
  if (over) return over.key?.(e)
  screen?.key?.(e)
})

const newSeed = () => (Date.now() % 1e8).toString(36) + Math.floor(Math.random() * 1296).toString(36)

// Every action given the run (a battle's orders too) is applied, then the run saved. → what apply returns.
function play (action) {
  const out = apply(run, action)
  keep()
  return out
}

// The highest level cleared in this browser (prefs 'ascended'; −1 for none) opens the one above it; the level chosen is
// kept in the URL (?ascension=, read first) and in prefs, never above the highest open.
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
// Who the next run is played as, held to the Monarchs opened here; kept in the URL (?monarch=, read first) and in prefs.
const opens = (id) => (id && monarchsOpen(cleared()).includes(id) ? id : null)
let monarch = opens(new URLSearchParams(location.search).get('monarch')) ?? opens(prefs.get('monarch')) ?? BASE_MONARCH
function crown (id) {
  monarch = id
  prefs.set('monarch', id)
  const url = new URL(location.href)
  if (id !== BASE_MONARCH) url.searchParams.set('monarch', id)
  else url.searchParams.delete('monarch')
  history.replaceState(null, '', url)
}

// A clear opens the level above it, and any Monarch its level reaches, once a run. → { level, monarchs }, or null
let opened = null
function ascend () {
  const s = run.state
  if (s.result !== 'victory') return null
  if (opened?.run !== run) {
    const before = cleared()
    const c = clearAt(before, s.ascension ?? 0)
    prefs.set('ascended', String(c.cleared))
    opened = { run, level: c.opened, monarchs: monarchsAt(before, s.ascension ?? 0) }
  }
  return opened
}

// For the screens: an illegal action comes back as a message instead of a throw.
function act (action) {
  try {
    play(action)
    if (action.type === 'place') placed = true
    hint()
    return null
  } catch (e) {
    return e.message
  }
}

// ── the run saved ────────────────────────────────────────────────────────────────────────────────

// After every action the run in play is saved with its options and log; a finished run drops its save, and is kept in
// the history and opens what its clear opens at once, before its battle plays back (a tab closed then loses neither).
function keep () {
  if (!run || run.state.tutorial) return
  played()
  if (run.state.phase === 'over') {
    chronicle()
    ascend()
  }
  const text = saveOf(run, made, meta)
  if (text) prefs.set('save', text)
  else prefs.drop('save')
}

// ── the history ──────────────────────────────────────────────────────────────────────────────────

// The run's play time: the time between its actions, a gap counted at most IDLE, the page's hidden spells not at all.
const IDLE = 120000
let ticked = null
function played () {
  const now = performance.now()
  if (meta && ticked !== null) meta.time += Math.min(now - ticked, IDLE)
  ticked = document.hidden ? null : now
}
document.addEventListener('visibilitychange', played)

const book = () => readBook(prefs.get('history'))
// Keeps run `r` (`m` its meta) in the history as it stands, over or left; again as it changes, as one line.
function chronicle (r = run, m = meta) {
  if (!r || r.state.tutorial || !m) return
  const at = Date.now()
  prefs.set('history', JSON.stringify(withRun(book(), recordOf(r, {
    id: `${r.state.seed}@${m.begun ?? at}`, at, time: m.time
  }))))
}

const SET_ASIDE = 'Your saved run was made by an older version of the game and no longer plays the same: it was set aside.'
// The saved run's place, for the title's Continue, or null; a save of another version is dropped and the title says so.
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

// Continue: the saved run played back from its log, mid-battle too; one that no longer plays is dropped with a note.
function resume () {
  const back = restore(prefs.get('save') ?? '')
  if (back.error) {
    console.warn(`saved run set aside (${back.error}): ${back.why}`)
    prefs.drop('save')
    return title(newSeed(), SET_ASIDE)
  }
  run = back.run
  made = back.made
  meta = metaOf(back.meta)
  ticked = performance.now()
  note = ''
  trail = trailOf(run)
  route()
}

// A save's meta as the run in play keeps it: one that does not read begins now.
function metaOf (m) {
  return { begun: Number.isFinite(m?.begun) ? m.begun : Date.now(), time: Number.isFinite(m?.time) && m.time >= 0 ? m.time : 0 }
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
  hint()
}

function title (seed, said = '') {
  run = null
  made = null
  meta = null
  overlay(null)
  ascension = Math.min(ascension, openTo(cleared()))
  if (!opens(monarch)) crown(BASE_MONARCH)
  const at = saved()
  music.set('title')
  show(titleScreen({
    seed, level: ascension, open: openTo(cleared()), onLevel: choose, onStart: start, onHelp: toggleHelp,
    monarch, monarchs: monarchsOpen(cleared()), onMonarch: crown, overlay,
    saved: at, note: said || aside, onContinue: resume, onTutorial: tutorial,
    onHistory: (now) => chronicles(now)
  }))
  aside = ''
  // A first visit (no run saved, the tutorial never played) is offered the tutorial, once.
  if (!at && prefs.get('did:tutorial') !== '1' && prefs.get('did:offer') !== '1') {
    prefs.set('did:offer', '1')
    overlay(askOverlay({
      title: 'New here?',
      text: 'The tutorial is one battle before floor 1, one soul given you against one foe, and three short screens of text: a few minutes, never saved. The title offers it again whenever you like.',
      yes: 'Play the tutorial', no: 'Not now', lead: 'yes',
      onYes: tutorial, onNo: () => overlay(null)
    }))
  }
}

// The History: the runs kept and their totals; back to the title with its seed.
function chronicles (seed) {
  overlay(null)
  music.set('title')
  show(historyScreen({ book: book(), onBack: () => title(seed), onHelp: toggleHelp }))
}

// A new run at the level and as the Monarch chosen; over a saved one it asks first (the saved run ends for good).
function start (seed) {
  const at = saved()
  if (at) {
    return overlay(askOverlay({
      title: 'End your saved run?',
      text: `A run is saved at ${placeText(at)}. A new run ends it for good: defeat is absolute, and so is leaving.`,
      yes: 'End it and begin', no: 'Keep it',
      onYes: () => { overlay(null); abandon(); start(seed) },
      onNo: () => overlay(null)
    }))
  }
  made = { seed, ...(ascension && { ascension }), ...(monarch !== BASE_MONARCH && { monarch }) }
  run = createRun(made)
  meta = { begun: Date.now(), time: 0 }
  ticked = null
  note = ''
  trail = null
  keep()
  route()
}

// The saved run ended for a new one: kept in the history as left (one that no longer plays unkept), its save dropped.
function abandon () {
  const back = restore(prefs.get('save') ?? '')
  if (back.run) chronicle(back.run, metaOf(back.meta))
  prefs.drop('save')
}

// ── the coach ────────────────────────────────────────────────────────────────────────────────────

// The threshold's callouts (ui/coach.js): what to do next, beside the thing to do it with, read again on every change
// of the run, the screen, the tab, the battle's selection or an overlay; nothing outside the tutorial.
let tab = null
let fieldSeen = false
let placed = false
const tabEl = (id) => frame.el.querySelector(`.top-tab[data-tab="${id}"]`)
function hintFor () {
  const s = run.state
  if (s.phase === 'map') {
    const k = s.party.find((u) => u.id === 'tomb_knight')
    if (tab === 'field') {
      return placed ? { at: tabEl('map'), text: 'Now open the Map' }
        : { at: () => (k && k.slot >= 0 ? board.rectOf(deployTile('party', k.slot)) : null), text: 'Drag your Knight to a tile in front of the Monarch' }
    }
    if (!fieldSeen) return { at: tabEl('field'), text: 'Open the Field' }
    return { at: frame.el.querySelector('.node.reach'), text: say('Click the room to enter it', 'Tap the room twice to enter it') }
  }
  if (s.phase === 'battle') {
    const sc = battleScene()
    const b = run.battle
    if (!sc || !b || b.over || sc.locked() || sc.ending || sc.paused) return null
    const k = b.units.find((u) => u.side === 'party' && u.id === 'tomb_knight')
    const foe = b.units.find((u) => u.side === 'foe' && u.hp > 0)
    if (!k || k.hp <= 0 || !foe) return null
    const end = frame.el.querySelector('.end-turn')
    if (!canAct(b, k)) return { at: end, text: 'End Turn' }
    if (sc.sel?.uid !== k.uid) return { at: () => sc.rectOf(k.uid), text: 'Tap your Knight' }
    if (k.basic && targetsFrom(b, k, k.basic).some((x) => x.uid === foe.uid)) {
      return { at: () => sc.rectOf(foe.uid), text: sc.sel.aim === foe.uid ? 'Tap it again to strike' : 'Tap the foe to aim at it' }
    }
    // Walking on while a tile walked still leaves its basic paid (stride); else the foe comes to it.
    if (stride(k) > 0) return { at: () => sc.rectOf(k.uid), text: 'Tap a blue tile to move toward the foe' }
    return { at: end, text: 'End Turn: the foe comes to you' }
  }
  if (s.phase === 'reap') {
    const offer = frame.el.querySelector('.offer')
    return offer ? { at: offer, text: 'Recruit it, or move on' } : { at: frame.el.querySelector('.move-on'), text: 'Move on' }
  }
  return null
}
function hint () {
  if (!run?.state.tutorial || over || help) return coach.hide()
  const next = hintFor()
  if (next) coach.show(next)
  else coach.hide()
}

// ── the tutorial ─────────────────────────────────────────────────────────────────────────────────

// One room before floor 1, played as any run is, never saved; its three screens come once each (lesson).
const taught = new Set()
function tutorial () {
  overlay(null)
  run = tutorialRun()
  made = null
  meta = null
  note = ''
  trail = null
  taught.clear()
  tab = null
  fieldSeen = false
  placed = false
  route()
}

// The tutorial's screen `key` (field, battle, spoils), once.
function lesson (key) {
  if (!run?.state.tutorial || taught.has(key)) return
  taught.add(key)
  const keys = Object.keys(TUTORIAL.screens)
  overlay(tutorialCard({ screen: TUTORIAL.screens[key], step: keys.indexOf(key) + 1, of: keys.length, onGo: () => overlay(null) }))
}

function graduate () {
  const fell = !!run.state.death
  prefs.set('did:tutorial', '1')
  coach.hide()
  title(newSeed(), fell ? 'The Monarch fell on the threshold. In a run, that would be the end of it: try the tutorial again, or begin.'
    : 'The tutorial is done. Begin the descent when you are ready: your first floor is like the threshold, with more rooms and more foes.')
}

// An old run state carries on under the current rules: its keystones join its relics (Arise among them), ids no longer
// known are dropped from the relics and from what a soul holds, and a Monarch's points go.
function migrate (s) {
  if (!Array.isArray(s.relics)) s.relics = []
  if ('keystones' in s) {
    s.relics.push(...(s.keystones ?? []))
    if (!s.relics.includes('arise')) s.relics.push('arise')
    delete s.keystones
  }
  s.relics = s.relics.filter((id) => RELICS[id])
  for (const u of s.party) if (u.relics) u.relics = u.relics.filter((id) => RELICS[id])
  if (typeof s.monarch !== 'string') delete s.monarch
  s.shop ??= []
}

function route () {
  const s = run.state
  if (s.tutorial && s.phase === 'over') return graduate()
  migrate(s)
  // The floor's loop (the deep's below), its battle layer while a battle is entered or under way; the title's once over.
  music.set(s.phase === 'over' ? 'title' : trackOf(s.floor, depthOf(s.floor) > 0), s.phase === 'battle' || s.phase === 'prep')
  if (!trail || trail.floor !== s.floor) {
    // A new floor: its number and its prices; in the deep, how the foes have grown.
    if (trail && s.phase === 'map') note = note ? `${note} ${floorNote(s)}` : floorNote(s)
    trail = { floor: s.floor, ids: [s.map.start] }
  }
  if (s.phase === 'battle') {
    fight({ resume: true })
  } else if (s.phase === 'draft') {
    show(draftScreen({ run, onPick: pick, onHelp: toggleHelp }))
  } else if (s.phase === 'map') {
    tab = 'map'
    show(runScreen({ run, trail: trail.ids, note, onNode, act, onHelp: toggleHelp, onTab: (id) => { tab = id; if (id === 'field') fieldSeen = true; hint() } }))
    note = ''
    lesson('field')
    hint()
  } else if (s.phase === 'prep') {
    // A battle room entered: its battle starts at once, with the souls where the Field left them.
    fight()
  } else if (s.phase === 'reap') {
    show(reapScreen({ run, title: { elite: 'The elite falls', boss: 'The boss falls' }[currentNode(run).type] ?? 'Spoils', act, onDone: reap, onHelp: toggleHelp }))
    lesson('spoils')
    hint()
  } else if (s.phase === 'altar') {
    show(altarScreen({ run, onRite: rite, onHelp: toggleHelp }))
  } else {
    // The run over: kept in the history (again, as one line, for a clear gone on into the deep).
    chronicle()
    const o = ascend()
    show(endScreen({ run, opened: o?.level ?? null, crowned: o?.monarchs ?? [], onNew: () => title(newSeed()), onDescend: descend, onHelp: toggleHelp }))
  }
}

// A battle room is entered only with a living soul on the field: refused, the Field opens asking for one.
function onNode (id) {
  const s = run.state
  const node = s.map.nodes.find((n) => n.id === id)
  if (BATTLE_NODES.includes(node?.type) && !fielded(souls(s.party)).some((u) => u.hp > 0)) return screen?.wantSoul?.()
  play({ type: 'node', id })
  trail.ids.push(id)
  route()
}

// An altar's rite: its note on the map says what it did, read against each piece as it stood before.
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


// Past the slain Sovereign, on into the deep.
function descend () {
  play({ type: 'descend' })
  route()
}

// The spoils are one recruit at most; its note says where it went (it joins last in the party).
function reap (index) {
  const o = index === null ? null : run.state.offers[index]
  play({ type: 'reap', index })
  if (o) {
    const said = recruitNote(run, run.state.party.at(-1))
    note = note ? `${note} ${said}` : said
  }
  route()
}

// The battle is the run's own: the scene gives the player's orders to the run, which returns each one's events and
// finishes the battle itself. Entered from the Field, the board stays up while the battle is built, then fades into it.
// `resume`: a saved battle, its orders replayed out of sight. A scene that outlives its run speaks to none.
async function fight ({ resume = false } = {}) {
  const node = currentNode(run)
  const ours = run
  // The fight first: refused, the Field's board is never left glided half out.
  if (!resume) play({ type: 'fight' })
  const handoff = resume ? null : board.leave()
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
    order: (o) => {
      if (run !== ours) throw new Error('its run is over')
      return play(o)
    },
    hud: bar.hud,
    stage: bar.stage,
    seamless: !!handoff,
    resume,
    // A foe kind met (the bestiary): tapped, its reach is drawn.
    met: (id) => bestiary.has(id),
    title: `${s.tutorial ? 'The threshold' : `Floor ${run.setup.floor}${depthOf(run.setup.floor) ? ` · deep ${depthOf(run.setup.floor)}` : ''}`} · ${NODE[node.type].name}`,
    onChange: (st) => { bar.update(st); hint() },
    // A slain foe's essence is multiplied by this as the purse takes it, for the per-wave popups.
    essence: runStat(s, 'essence.gain', 1),
    // The run's purse, which a win adds the battle's pay to (the purse's card).
    bank: () => s.essence,
    // An elite or a floor's boss pays its bounty on a win (the purse's card); what the run took for the battle, read as it ends.
    elite: bountyOf(s, node) > 0,
    earned: () => (s.stats?.essence ?? 0) - paid,
    // Read as the battle ends; a status's tick struck from nowhere replays no blow.
    death: () => {
      if (!s.death || battle.winner === 'party') return null
      const d = deathText(s, battle)
      return { ...d, from: d.tick ? null : s.death.from ?? null, by: s.death.uid ?? null }
    },
    // Live stats and statuses for the unit under the pointer; a foe's coming turn is on the board. `pin`: a long press or a
    // click, the card stays until the next press.
    onHover: (u, at, pin = false) => {
      if (!u) return tipPinned() || hideTip()
      const foe = u.side === 'foe'
      // A shadow their Legion raised is marked on its arise event; a summon holds beside the piece that called it.
      const legion = u.shadow && battle.events.some((e) => e.type === 'arise' && e.rule === 'legion' && e.unit.uid === u.uid)
      const me = u.uid === battle.monarch?.uid
      const arise = !foe && u.hp > 0 && u.kit && ariseOf(battle, u)
      // One of yours leads with its turn as it stands (its energy left, its skills, how many foes its basic reaches).
      const turn = !foe && u.hp > 0 ? battleScene()?.pieceLine(u.uid) ?? null : null
      const live = [
        u.hp <= 0 && (foe || u.shadow ? 'Fallen' : 'Fallen: whole again after a win'),
        me && 'If it falls, the run ends',
        turn,
        u.shadow && (foe ? (legion ? 'Your fallen, raised by their Legion' : u.summoned ? `${summonedBy(battle, u)}: falls with it` : 'Grave Tide shadow: falls with the Sovereign')
          : u.summoned ? `${summonedBy(battle, u)}: gone after the battle` : 'Shadow: gone after the battle'),
        u.rose && 'Risen by Undying: its next fall is final',
        arise && `Arise: claims within ${arise.domain} tiles, tier ≤ ${arise.tier}`,
        u.flies && 'Flying: ranged blows and flyers alone reach it',
        foe && u.wave && `Came with wave ${u.wave + 1}`].find(Boolean) || null
      const realm = { arise: (x) => (x.kit ? ariseOf(battle, x) : null) }
      const tip = pin ? pinTip : showTip
      // `u` is the unit as the playback shows it; its stats are read off the battle's own.
      tip(at, () => unitCard(u, { stats: stats(battle, battle.byUid.get(u.uid) ?? u), statuses: u.statuses, foe, realm, run, live }))
    },
    onDone: () => {
      if (run !== ours) return
      // Skipped before its end: the result still sounds (a played-out battle sounded it as its banner rose).
      if (!scene?.ending) sfx.play(battle.winner === 'party' ? 'win' : 'lose')
      bestiary.record(battle.units.filter((u) => u.side === 'foe' && !u.shadow).map((u) => u.id))
      route()
    }
  })
  handoff?.(scene)
  bar.attach(scene)
  hush()
  lesson('battle')
}

// The frame rescaled: a battle playing fits itself again (the Field's board checks its stage every frame).
onFrame(() => {
  const battle = engine.game.scene.getScene('Battle')
  if (battle?.sys.isActive()) battle.fit()
})

const seed = new URLSearchParams(location.search).get('seed') ?? newSeed()
choose(ascension)
crown(monarch)
title(seed)

// The store build marks its page and ships a service worker, registered once the page has loaded so the app plays
// offline; the source tree registers none, and lets go of any a build on the same origin left behind.
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  const built = !!document.querySelector('meta[name="retinue-build"]')
  const go = () => {
    if (built) navigator.serviceWorker.register('sw.js').catch((e) => console.warn(`service worker not registered: ${e.message}`))
    else navigator.serviceWorker.getRegistrations().then((rs) => { for (const r of rs) r.unregister() }).catch(() => {})
  }
  if (document.readyState === 'complete') go()
  else addEventListener('load', go)
}

// Console access for debugging: retinue.run.state, retinue.route() (redraw after applying actions by hand).
window.retinue = { engine, route, music, get run () { return run } }
