// Composition root: the Phaser engine (battles only), the DOM screens, and the run that links them.
// Every player input becomes one apply(run, action); the screens only read run.state.
// The DOM screens are laid out at one logical size and scaled to the screen (frame.js); the canvas is not.
import { frame, onFrame } from './frame.js'
import { createEngine } from './engine.js'
import { createRun, apply, currentNode, depthOf, runStat } from './sim/run.js'
import { stats, ariseOf } from './sim/turns.js'
import { unitDef, RELICS } from './content.js'
import { titleScreen, runScreen, NODE, reapScreen, shopScreen, endScreen, battleChrome, draftScreen } from './ui.js'
import { helpOverlay, unitCard, tipDetail, deathText, bestiary, floorNote, altarNote, recruitNote } from './codex.js'
import { showTip, pinTip, hideTip, refreshTip, tipMore, tipPinned, touchy } from './dom.js'
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
let trail = null
let note = ''
let help = null

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
  screen?.key?.(e)
})

const newSeed = () => (Date.now() % 1e8).toString(36) + Math.floor(Math.random() * 1296).toString(36)

// For the retinue editor: an illegal action comes back as a message instead of a throw.
function act (action) {
  try {
    apply(run, action)
    return null
  } catch (e) {
    return e.message
  }
}

function title (seed) {
  run = null
  show(titleScreen({ seed, onStart: start, onHelp: toggleHelp }))
}

function start (seed) {
  run = createRun({ seed })
  note = ''
  route()
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
  migrate(s)
  if (!trail || trail.floor !== s.floor) {
    // A new floor: its number and its prices (codex.js floorNote); in the deep, how the foes have grown.
    if (trail && s.phase === 'map') note = floorNote(s)
    trail = { floor: s.floor, ids: [s.map.start] }
  }
  if (s.phase === 'draft') {
    show(draftScreen({ run, onPick: pick, onHelp: toggleHelp }))
  } else if (s.phase === 'map') {
    show(runScreen({ run, trail: trail.ids, note, onNode, act, onHelp: toggleHelp }))
    note = ''
  } else if (s.phase === 'prep') {
    // A battle room entered: its battle starts at once, with the souls where the Field left them.
    fight()
  } else if (s.phase === 'reap') {
    show(reapScreen({ run, title: currentNode(run).type === 'elite' ? 'The elite falls' : 'Spoils', act, onDone: reap, onHelp: toggleHelp }))
  } else if (s.phase === 'shop') {
    show(shopScreen({ run, act, onLeave: leave, onHelp: toggleHelp }))
  } else {
    show(endScreen({ run, onNew: () => title(newSeed()), onDescend: descend, onHelp: toggleHelp }))
  }
}

// An altar's note says what it did: each piece's HP is kept before the room is entered, to be read against after.
function onNode (id) {
  const before = new Map(run.state.party.map((u) => [u.uid, u.hp]))
  apply(run, { type: 'node', id })
  trail.ids.push(id)
  if (currentNode(run).type === 'altar') note = altarNote(run.state, before)
  route()
}

// A pick of the draft: its soul joins; the last opens the floor's map.
function pick (index) {
  apply(run, { type: 'pick', index })
  route()
}

// Out of a Shop, free; what was bought is already in the bar.
function leave () {
  apply(run, { type: 'leave' })
  route()
}

// Past the slain Sovereign, on into the deep: the next floor's map (route() notes the new floor).
function descend () {
  apply(run, { type: 'descend' })
  route()
}

// The spoils are one recruit at most (relics are the Shop's): a recruit rises a piece of its own, and its note says
// where it went (run.js join pushes it last into the party).
function reap (index) {
  const o = index === null ? null : run.state.offers[index]
  apply(run, { type: 'reap', index })
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
// (engine.js finish), the facts the end screen keeps.
async function fight () {
  const node = currentNode(run)
  // The fight first: refused, the Field's board is never left glided half out.
  apply(run, { type: 'fight' })
  const handoff = board.leave()
  // The battle's chrome keeps the Field's layout (ui.js battleChrome): the board fits its stage, as the Field's did.
  const bar = battleChrome({ onHelp: toggleHelp })
  show(bar)
  const battle = run.battle
  const s = run.state
  // What the run has paid out so far: what it holds more once the battle is won is the battle's pay (the banner's).
  const paid = s.stats?.essence ?? 0
  const scene = await engine.battle({
    battle,
    order: (o) => apply(run, o),
    hud: bar.hud,
    stage: bar.stage,
    seamless: !!handoff,
    title: `Floor ${run.setup.floor}${depthOf(run.setup.floor) ? ` · deep ${depthOf(run.setup.floor)}` : ''} · ${NODE[node.type].name}`,
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
          : u.summoned ? `Summoned by its ${unitDef(u.id).name}: gone after the battle`
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
}

// The frame rescaled (a resize, a rotation, the iOS toolbar): a battle playing fits itself under its bar again.
// The Field's board needs nothing: board.js checks the stage's rect every frame.
onFrame(() => {
  const battle = engine.game.scene.getScene('Battle')
  if (battle?.sys.isActive()) battle.fit()
})

const seed = new URLSearchParams(location.search).get('seed') ?? newSeed()
title(seed)

// Console access for debugging: retinue.run.state, retinue.run.state.log, retinue.route() (redraw the screen after
// applying actions by hand), …
window.retinue = { engine, route, get run () { return run } }
