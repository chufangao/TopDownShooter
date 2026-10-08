// Composition root: the Phaser engine (battles only), the DOM screens, and the run that links them.
// Every player input becomes one apply(run, action); the screens only read run.state.
import { createEngine } from './engine.js'
import { createRun, apply, currentNode, holds, depthOf } from './sim/run.js'
import { createBattle, stats, ariseCap } from './sim/battle.js'
import { TUNING } from './tuning.js'
import { unitDef, ORDERS, relicDef } from './content.js'
import { titleScreen, mapScreen, NODE, prepScreen, reapScreen, endScreen, battleBar, bannerColours } from './ui.js'
import { helpOverlay, unitCard, bodies, tileText, whenText, ENEMY_TEXT, tipDetail } from './codex.js'
import { showTip, hideTip, refreshTip } from './dom.js'
import { sfx } from './sfx.js'
import { distance } from './sim/unit.js'
import { board } from './board.js'

const ui = document.getElementById('ui')
const engine = createEngine('game')
// The retinue editor's board (prep, the map's Camp) is the battle's own, drawn by the same Phaser game.
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

// How to play pauses a battle playing out while it is open (one already paused stays so after), and puts
// the cursor in its search box.
let helpPaused = null
function toggleHelp () {
  hideTip()
  if (help) {
    help.remove()
    help = null
    if (helpPaused?.sys.isActive() && helpPaused.paused) helpPaused.setPaused(false)
    helpPaused = null
    return
  }
  help = helpOverlay(toggleHelp, run)
  document.body.append(help)
  const battle = engine.game.scene.getScene('Battle')
  if (battle?.sys.isActive() && !battle.paused && !battle.ending) { battle.setPaused(true); helpPaused = battle }
  help.querySelector('.gl-search')?.focus({ preventScroll: true })
}

// Holding Shift opens the details of the card under the pointer (codex.js tipDetail); letting go closes them.
const detail = (on) => { if (tipDetail.on !== on) { tipDetail.on = on; refreshTip() } }
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') detail(true) })
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') detail(false) })
window.addEventListener('blur', () => detail(false))

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

function route () {
  const s = run.state
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
    show(mapScreen({ run, trail: trail.ids, note, onNode, act, onHelp: toggleHelp }))
    note = ''
  } else if (s.phase === 'prep') {
    show(prepScreen({ run, act, onFight: fight, onHelp: toggleHelp }))
  } else if (s.phase === 'reap') {
    const title = { reliquary: 'Reliquary', rite: 'Rite' }[currentNode(run).type] ?? 'Spoils'
    show(reapScreen({ run, title, act, onDone: reap, onBind: bind, onHelp: toggleHelp }))
  } else {
    show(endScreen({ run, onNew: () => title(newSeed()), onDescend: descend }))
  }
}

function onNode (id) {
  apply(run, { type: 'node', id })
  trail.ids.push(id)
  if (currentNode(run).type === 'altar') {
    note = holds(run.state, 'unhealable')
      ? 'The altar burns: your souls are healed, and the fallen, souls and bodies, rise again. Under Court of Bone the Monarch is not healed.'
      : 'The altar burns: everyone is healed, and the fallen, souls and bodies, rise again.'
  }
  // A reliquary with nothing to offer (the relics already at their most) is used up on the spot.
  if (currentNode(run).type === 'reliquary' && run.state.phase === 'map') {
    note = run.state.relics.length >= TUNING.essence.relicMax
      ? `The reliquary stands empty to you: you already hold ${TUNING.essence.relicMax} relics, the most you can carry.`
      : 'The reliquary holds nothing you do not already carry.'
  }
  route()
}

// Past the slain Sovereign, on into the deep: the next floor's map (route() notes the new floor).
function descend () {
  apply(run, { type: 'descend' })
  route()
}

// The spoils may take several steps (a recruit and binds), each re-showing the room until it ends: the
// notes add up for the map.
const addNote = (line) => { note = note ? `${note} ${line}` : line }

function reap (index) {
  const o = index === null ? null : run.state.offers[index]
  apply(run, { type: 'reap', index })
  if (o?.type === 'soul') addNote(`${o.name} rises to serve you.`)
  else if (o?.type === 'relic') addNote(`${o.name} claimed.`)
  else if (o?.type === 'tier') addNote(`${o.name}: the rite is done.`)
  else if (o?.type === 'keystone') addNote(`${o.name}: a rule of the run is rewritten.`)
  route()
}

// Bind `count` of the slain of kind `id` as rank-and-file. A bind offer is never taken by `reap`.
function bind (id, count) {
  apply(run, { type: 'bind', id, count })
  addNote(`${bodies(id, count)} bound to the ossuary.`)
  route()
}

// The run settles the battle the moment it starts; the scene rebuilds the same battle from run.setup
// and plays it out, then routes to wherever the run went (reap, or the end).
// From prep, the board you arranged stays up while the battle is built under it, then fades into it with
// everyone where they stood (board.leave); the battle skips its own fade in.
async function fight () {
  const node = currentNode(run)
  const handoff = board.leave()
  apply(run, { type: 'fight' })
  const bar = battleBar()
  show(bar)
  const battle = createBattle(run.setup)
  const scene = await engine.battle({
    battle,
    seamless: !!handoff,
    title: `FLOOR ${run.setup.floor}${depthOf(run.setup.floor) ? ` · DEEP ${depthOf(run.setup.floor)}` : ''} · ${NODE[node.type].name.toUpperCase()}`,
    barHeight: () => bar.el.offsetHeight,
    banners: bannerColours(run.state.party),
    onChange: (st) => bar.update(st),
    // A slain foe's essence is multiplied by this as the purse takes it, for the per-wave popups.
    essence: 1 + run.state.relics.reduce((n, id) => n + (relicDef(id).essence ?? 0), 0),
    // Live stats and statuses for the unit under the pointer, and what the Monarch's rules and its orders do
    // to it. Only your own plans are told: a foe's never are. A foe's card tells its banner and its wave,
    // never where it is bound.
    onHover: (u, at) => {
      if (!u) return hideTip()
      const foe = u.side === 'foe'
      const captain = u.cohortOf != null ? battle.byUid.get(u.cohortOf) : null
      const mine = battle.reserve.filter((r) => r.side !== 'foe')
      const held = mine.filter((r) => r.when && r.when.at !== 'once' && !battle.called.has(r.det))
      const n = mine.length - held.length
      // A foe captain's cohort still standing or still to come (the fallen no longer keep by it).
      const led = battle.units.filter((x) => x.cohortOf === u.uid && x.side === u.side && x.hp > 0).length + battle.reserve.filter((x) => x.cohortOf === u.uid && x.side === u.side).length
      // An elite's captain or cohort may march under orders (never shown which); an orphan only Hunts.
      const ordered = foe && node.type === 'elite' && !u.orphan && (u.rank || battle.units.some((x) => x.cohortOf === u.uid) || led > 0)
      // A Marshal's banner (itself, its cohort, the shadows that joined it) within its own domain.
      const R = TUNING.ranks.domain
      const marshal = foe ? null : u.grade >= 2 ? u : captain?.grade >= 2 && captain.hp > 0 ? captain : null
      const kept = marshal && battle.monarch && distance(u.tile, marshal.tile) <= R && distance(u.tile, battle.centre ?? battle.monarch.tile) > battle.domain
      // Faltering drops a plan for good, so one back inside may only be hunting: say so (Stay never ends in
      // a Hunt otherwise; Move may have arrived, so that stays neutral).
      const orders = u.where !== 'hunt' ? ', orders kept' : u.plan?.where === 'stay' ? ', orders dropped when it faltered' : ', hunting'
      // A shadow the Legion (Undead 8) raised is marked on its arise event; on the foes' side it is one of yours.
      const legion = u.shadow && battle.events.some((e) => e.type === 'arise' && e.rule === 'legion' && e.unit.uid === u.uid)
      const me = u.uid === battle.monarch?.uid
      // Short phrases, most a few words: the card above carries the numbers, the glossary the rules.
      const notes = [
        u.shadow && (foe
          ? legion ? 'Your fallen, raised against you by their Legion: it falters.' : 'Raised by Grave Tide: it falters, and crumbles with the Sovereign.'
          : `${legion ? 'Legion' : 'Arise'} shadow${captain ? ` of ${unitDef(captain.id).name}'s banner` : ''}` +
            (u.arisen && holds(run.state, 'keep') ? '; Hollow Court keeps it if it stands.' : '; gone after the battle.')),
        foe && u.wave && (u.when?.at === 'time' ? 'Came with the late pair.' : `Came with wave ${u.wave + 1}.`),
        foe && !u.rank && led > 0 && ENEMY_TEXT.captain(led, unitDef(u.id).boss),
        u.grade >= 2 && !foe && `Marshal: its banner never falters within ${R} tiles.`,
        kept && u !== marshal && !u.shadow && `Past the domain, in its Marshal's: full strength${orders}.`,
        u.rank && (foe ? (captain ? ENEMY_TEXT.of(captain.id) : 'Of a captain\'s cohort.') : `Of ${captain ? `${unitDef(captain.id).name}'s` : 'a'} banner, muster ${u.lvl}.`),
        u.orphan && 'Its captain fell: it falters and hunts.',
        !foe && !u.orphan && !kept && u.falter && `Faltering ×${TUNING.monarch.falter}: outside the domain${battle.ks.crown ? ' (it follows your front captain)' : ''}.`,
        u.rose && 'Risen by Undying: its next fall is final.',
        battle.ks.pool && !foe && !u.shadow && (u.cohortOf != null ? !u.orphan : battle.units.some((x) => x.cohortOf === u.uid && !x.orphan && x.hp > 0)) &&
          'One Army: shares its banner\'s HP pool.',
        ...(!foe ? planNotes(battle, u, captain) : []),
        me && [`Arise ${battle.raised}/${ariseCap(battle.will, battle.ks.raises)}`,
          battle.ks.tithe > 0 && `${Math.ceil(u.maxHp * battle.ks.tithe)} HP a shadow`,
          battle.ks.unhealable && 'unhealable',
          n > 0 && `${n} still to enter`,
          held.length > 0 && `held: ${[...new Set(held.map((r) => r.det))].map((id) => `${id} ${whenText(held.find((r) => r.det === id).when)}`).join(', ')}`].filter(Boolean).join(' · ')]
      // The card's one live line: the first of these that holds, most pressing first (the notes above wait
      // under Shift).
      const plan = !foe && planLine(battle, u, captain)
      const live = [
        u.hp <= 0 && (foe || u.shadow ? 'Fallen' : 'Fallen: an altar raises it'),
        me && `Arise ${battle.raised}/${ariseCap(battle.will, battle.ks.raises)} · if it falls, the run ends`,
        u.shadow && (foe ? (legion ? 'Your fallen, raised by their Legion' : 'Grave Tide shadow: falls with the Sovereign')
          : u.arisen && holds(run.state, 'keep') ? 'Shadow: Hollow Court keeps it if it stands' : 'Shadow: gone after the battle'),
        u.orphan && 'Its captain fell: it falters and hunts',
        !foe && !kept && u.falter && `Faltering ×${TUNING.monarch.falter}: outside the domain`,
        kept && u !== marshal && 'In its Marshal\'s domain: full strength',
        u.rose && 'Risen by Undying: its next fall is final',
        plan,
        u.grade >= 2 && !foe && `Marshal: no falter within ${R} tiles`,
        foe && !u.rank && led > 0 && (unitDef(u.id).boss ? `Leads a court of ${led}` : `Captain of ${led}: kill it, they falter`),
        u.rank && captain && (foe ? `Of ${unitDef(captain.id).name}'s ${unitDef(captain.id).boss ? 'court' : 'cohort'}` : `Of ${unitDef(captain.id).name}'s banner`),
        foe && u.wave && (u.when?.at === 'time' ? 'Came with the late pair' : `Came with wave ${u.wave + 1}`),
        !foe && 'Hunting'].find(Boolean) || null
      const realm = { domain: battle.domain, will: battle.will, raises: battle.ks.raises, tithe: battle.ks.tithe, keep: holds(run.state, 'keep') }
      showTip(at, () => unitCard(u, { stats: stats(battle, u), statuses: u.statuses, foe, realm, notes, ordered, live }))
    },
    onDone: () => {
      // Skipped before its end: the result still sounds (a played-out battle sounded it as its banner rose).
      if (!scene?.ending) sfx.play(run.battle.winner === 'party' ? 'win' : 'lose')
      // Shadows are not souls: they were never yours to lose. Rank-and-file are counted by kind.
      const lost = run.battle.units.filter((u) => u.side === 'party' && !u.shadow && u.hp <= 0)
      const fallen = lost.filter((u) => !u.rank).map((u) => unitDef(u.id).name)
      const kinds = Object.entries(Object.groupBy(lost.filter((u) => u.rank), (u) => u.id)).map(([id, us]) => bodies(id, us.length))
      const what = [fallen.length && `Fallen: ${fallen.join(', ')}.`, kinds.length && `${kinds.join(', ')} of the rank-and-file fell.`].filter(Boolean)
      if (what.length && run.state.phase !== 'over') note = `${what.join(' ')} An altar will raise them.`
      route()
    }
  })
  handoff?.(scene)
  bar.attach(scene)
}

// A unit's orders in a battle, live: its detachment's plan, and what it is doing with it now (holding its
// ground, moving to its square, arrived, dropped outside the domain, following its captain into the Hunt).
function planNotes (battle, u, captain) {
  const p = planNow(battle, u, captain)
  if (!p) return []
  const now = p.following ? 'hunting with its captain'
    : u.where === 'stay' ? `holding ${tileText(u.anchor)}`
      : u.where === 'move' ? `moving to ${tileText(u.square)}`
        : p.arrived ? 'arrived, now hunting'
          : p.dropped ? (p.placed ? 'placed outside the domain, so hunting' : 'stepped out of the domain, so hunting') : null
  return [`Detachment ${u.det}, ${ORDERS.where[u.plan.where].name}${u.when ? ` (entered ${whenText(u.when)})` : ''}${now ? `: ${now}` : ''}.`]
}

// The same in a few words, for the card's live line: "A, Stay: holding its tile".
function planLine (battle, u, captain) {
  const p = planNow(battle, u, captain)
  if (!p) return null
  const now = p.following ? 'hunting with its captain' : u.where === 'stay' ? 'holding its tile' : u.where === 'move' ? 'moving to its square'
    : p.arrived ? 'arrived, hunting' : p.dropped ? 'faltered, so hunting' : null
  return `${u.det}, ${ORDERS.where[u.plan.where].name}${now ? `: ${now}` : ''}`
}

// Where a unit stands with its detachment's plan: following its captain into the Hunt, arrived at its square,
// or dropped (outside the domain: `placed` there from t 0, when it never stepped anywhere). Null with no plan.
function planNow (battle, u, captain) {
  if (u.det == null || !u.plan) return null
  return {
    arrived: u.plan.where === 'move' && battle.events.some((e) => e.type === 'arrive' && e.uid === u.uid),
    following: captain && captain.hp > 0 && captain.where === 'hunt' && u.where !== 'hunt',
    placed: battle.events.find((e) => e.type === 'falter' && e.target === u.uid && e.on)?.t === 0,
    dropped: u.plan.where !== 'hunt' && !u.orphan && u.where === 'hunt'
  }
}

const seed = new URLSearchParams(location.search).get('seed') ?? newSeed()
title(seed)

// Console access for debugging: retinue.run.state, retinue.run.state.log, …
window.retinue = { engine, get run () { return run } }
