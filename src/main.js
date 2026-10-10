// Composition root: the Phaser engine (battles only), the DOM screens, and the run that links them.
// Every player input becomes one apply(run, action); the screens only read run.state.
// The DOM screens are laid out at one logical size and scaled to the screen (frame.js); the canvas is not.
import { frame, onFrame } from './frame.js'
import { createEngine } from './engine.js'
import { createRun, apply, currentNode, holds, depthOf, relicCount } from './sim/run.js'
import { createBattle, stats, ariseCap } from './sim/battle.js'
import { unitDef, relicDef, RELICS } from './content.js'
import { titleScreen, runScreen, NODE, reapScreen, endScreen, battleChrome } from './ui.js'
import { helpOverlay, unitCard, tipDetail, deathText, bestiary } from './codex.js'
import { livingBodies } from './sim/unit.js'
import { showTip, pinTip, hideTip, refreshTip, tipMore, tipPinned, touchy } from './dom.js'
import { sfx } from './sfx.js'
import { board } from './board.js'

const ui = document.getElementById('ui')
const engine = createEngine('game')
// The Field's board (prep's, and the map's Field tab) is the battle's own, drawn by the same Phaser game.
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
// goes to the screen (Enter begins, Space pauses), so a click never turns the next Enter into a second click.
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
// its keystones join its relics (the same ids, now Legendaries), it holds Arise, and an id no longer known is
// dropped, so an old state never breaks the page. One from before the Monarch lost its points drops them, and its
// rites are reliquaries.
function migrate (s) {
  if (!Array.isArray(s.relics)) s.relics = []
  if ('keystones' in s) {
    s.relics.push(...(s.keystones ?? []))
    if (!s.relics.includes('arise')) s.relics.push('arise')
    delete s.keystones
  }
  s.relics = s.relics.filter((id) => RELICS[id])
  delete s.monarch
  for (const n of s.map?.nodes ?? []) if (n.type === 'rite') n.type = 'reliquary'
}

function route () {
  const s = run.state
  migrate(s)
  if (!trail || trail.floor !== s.floor) {
    if (trail && s.phase === 'map') {
      const deep = depthOf(s.floor)
      note = !deep ? `Floor ${s.floor}. The air grows colder.`
        : deep === 1 ? `Floor ${s.floor}, the first of the deep. The clear is yours; below the Sovereign's floor, the dead grow thicker and stronger with every floor.`
          : `Floor ${s.floor}, ${deep} floors below the Sovereign's. The dark presses closer.`
    }
    trail = { floor: s.floor, ids: [s.map.start] }
  }
  if (s.phase === 'map') {
    show(runScreen({ run, trail: trail.ids, note, onNode, act, onHelp: toggleHelp }))
    note = ''
  } else if (s.phase === 'prep') {
    show(runScreen({ run, trail: trail.ids, act, onFight: fight, onHelp: toggleHelp }))
  } else if (s.phase === 'reap') {
    const title = currentNode(run).type === 'reliquary' ? 'Reliquary' : 'Spoils'
    show(reapScreen({ run, title, act, onDone: reap, onHelp: toggleHelp }))
  } else {
    show(endScreen({ run, onNew: () => title(newSeed()), onDescend: descend, onHelp: toggleHelp }))
  }
}

function onNode (id) {
  apply(run, { type: 'node', id })
  trail.ids.push(id)
  if (currentNode(run).type === 'altar') {
    note = holds(run.state, 'unhealable')
      ? 'The altar burns: your souls are healed, and the fallen rise again in the ossuary, to be placed. Under Court of Bone the Monarch is not healed.'
      : 'The altar burns: everyone is healed, and the fallen rise again in the ossuary, to be placed.'
  }
  // A reliquary with nothing to offer is used up on the spot.
  if (currentNode(run).type === 'reliquary' && run.state.phase === 'map') note = 'The reliquary holds nothing for you.'
  route()
}

// Past the slain Sovereign, on into the deep: the next floor's map (route() notes the new floor).
function descend () {
  apply(run, { type: 'descend' })
  route()
}

// The spoils may take several steps (a recruit, a relic, a Legendary), each re-showing the room until it ends:
// the notes add up for the map.
const addNote = (line) => { note = note ? `${note} ${line}` : line }

// `onto`: a recruit joins that fielded piece of its kind.
function reap (index, onto = null) {
  const o = index === null ? null : run.state.offers[index]
  apply(run, { type: 'reap', index, ...(onto != null && { onto }) })
  if (o?.type === 'soul') addNote(onto != null ? `${o.name} rises, and joins its kind's stack.` : `${o.name} rises to serve you.`)
  else if (o?.type === 'relic') {
    const n = relicCount(run.state, o.id)
    addNote(o.id === 'arise' ? (n > 1 ? `Arise ×${n}: it reaches farther, raises stronger dead and more of them, and comes sooner.` : 'Arise: the dead about the Monarch are yours to raise.')
      : o.tier === 'legendary' ? `${o.name}${n > 1 ? ` ×${n}` : ''}: a rule of the run is rewritten.` : `${o.name} claimed${n > 1 ? `: ×${n}` : ''}.`)
  } else if (o?.type === 'tier') addNote(`${o.name}: every one you hold has it.`)
  route()
}

// The run settles the battle the moment it starts; the scene rebuilds the same battle from run.setup
// and plays it out, then routes to wherever the run went (reap, or the end).
// From prep, the board you arranged stays up while the battle is built under it, then fades into it with
// everyone where they stood (board.leave); the battle skips its own fade in. A lost battle ends on a replay
// beat of what felled the Monarch (engine.js finish), the facts the end screen keeps.
async function fight () {
  const node = currentNode(run)
  const handoff = board.leave()
  apply(run, { type: 'fight' })
  // The battle's chrome keeps prep's layout (ui.js battleChrome): the board fits its stage, as prep's did.
  const bar = battleChrome({ onHelp: toggleHelp, node })
  show(bar)
  const battle = createBattle(run.setup)
  const s = run.state
  const lost = s.death && run.battle.winner !== 'party'
  const scene = await engine.battle({
    battle,
    hud: bar.hud,
    stage: bar.stage,
    seamless: !!handoff,
    title: `Floor ${run.setup.floor}${depthOf(run.setup.floor) ? ` · deep ${depthOf(run.setup.floor)}` : ''} · ${NODE[node.type].name}`,
    onChange: (st) => bar.update(st),
    // A slain foe's essence is multiplied by this as the purse takes it, for the per-wave popups.
    essence: 1 + s.relics.reduce((n, id) => n + (relicDef(id).essence ?? 0), 0),
    death: lost ? { ...deathText(s, run.battle), from: s.death.from ?? null, by: s.death.uid ?? null } : null,
    // Live stats and statuses for the unit under the pointer. Only your own plans are told: a foe's never are.
    // `pin`: a long press (touch) or a click, the card stays until the next press, the pointer leaving it or not.
    onHover: (u, at, pin = false) => {
      if (!u) return tipPinned() || hideTip()
      const foe = u.side === 'foe'
      // A shadow the Legion (Undead 8) raised is marked on its arise event; on the foes' side it is one of yours.
      const legion = u.shadow && battle.events.some((e) => e.type === 'arise' && e.rule === 'legion' && e.unit.uid === u.uid)
      const me = u.uid === battle.monarch?.uid
      const live = [
        u.hp <= 0 && (foe || u.shadow ? 'Fallen' : 'Fallen: an altar raises it'),
        me && `${battle.held.arise ? `Arise ${battle.raised}/${ariseCap(battle.held)} · ` : ''}if it falls, the run ends`,
        u.shadow && (foe ? (legion ? 'Your fallen, raised by their Legion' : 'Grave Tide shadow: falls with the Sovereign')
          : u.arisen && holds(s, 'reap') ? 'Shadow: Hollow Court reaps it if it stands' : 'Shadow: holds where it rose, gone after the battle'),
        u.rose && (u.rose >= battle.held.rises ? 'Risen by Undying: its next fall is final' : `Risen by Undying: it may rise ${battle.held.rises - u.rose} more`),
        u.count > 1 && `A stack: ${livingBodies(u)} of ${u.count} bodies standing`,
        u.flies && 'Flying: only a ranged blow (or a flyer\'s melee) can strike it',
        !foe && !me && 'It fights from its cell all battle',
        foe && u.wave && `Came with wave ${u.wave + 1}`].find(Boolean) || null
      const realm = { domain: battle.domain, held: battle.held, reap: holds(s, 'reap') }
      const tip = pin ? pinTip : showTip
      tip(at, () => unitCard(u, { stats: stats(battle, u), statuses: u.statuses, foe, realm, live }))
    },
    onDone: () => {
      // Skipped before its end: the result still sounds (a played-out battle sounded it as its banner rose).
      if (!scene?.ending) sfx.play(run.battle.winner === 'party' ? 'win' : 'lose')
      // Every foe kind that took the field is met: its ring and its way are told from now on (the bestiary).
      bestiary.record(run.battle.units.filter((u) => u.side === 'foe' && !u.shadow).map((u) => u.id))
      // Shadows are not souls: they were never yours to keep. The fallen souls have left the field for the ossuary
      // (run.js finishBattle), their cells and Command free, and wait there for an altar.
      const fallen = run.battle.units.filter((u) => u.side === 'party' && !u.shadow && u.hp <= 0 && u.uid !== run.battle.monarch?.uid).map((u) => unitDef(u.id).name)
      if (fallen.length && s.phase !== 'over') note = `Fallen: ${fallen.join(', ')}. ${fallen.length > 1 ? 'They lie' : 'It lies'} in the ossuary, ${fallen.length > 1 ? 'their cells' : 'its cell'} and Command free, until an altar raises ${fallen.length > 1 ? 'them' : 'it'}.`
      route()
    }
  })
  handoff?.(scene)
  bar.attach(scene)
  hush()
}

// The frame rescaled (a resize, a rotation, the iOS toolbar): a battle playing fits itself under its bar again.
// The prep board needs nothing: board.js checks the stage's rect every frame.
onFrame(() => {
  const battle = engine.game.scene.getScene('Battle')
  if (battle?.sys.isActive()) battle.fit()
})

const seed = new URLSearchParams(location.search).get('seed') ?? newSeed()
title(seed)

// Console access for debugging: retinue.run.state, retinue.run.state.log, retinue.route() (redraw the screen after
// applying actions by hand), …
window.retinue = { engine, route, get run () { return run } }
