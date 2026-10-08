// Composition root: the Phaser engine (battles only), the DOM screens, and the run that links them.
// Every player input becomes one apply(run, action); the screens only read run.state.
import { createEngine } from './engine.js'
import { createRun, apply, currentNode, holds, depthOf } from './sim/run.js'
import { createBattle, stats, ariseCap } from './sim/battle.js'
import { TUNING } from './tuning.js'
import { unitDef, ORDERS, relicDef } from './content.js'
import { titleScreen, mapScreen, NODE, prepScreen, reapScreen, endScreen, battleBar, bannerColours } from './ui.js'
import { helpOverlay, unitCard, bodies, tileText, whenText, ENEMY_TEXT } from './codex.js'
import { showTip, hideTip } from './dom.js'
import { distance } from './sim/unit.js'

const ui = document.getElementById('ui')
const engine = createEngine('game')
let screen = null
let run = null
let trail = null
let note = ''
let help = null

function show (s) {
  screen = s
  hideTip()
  ui.replaceChildren(s.el)
  ui.scrollTop = 0
}

function toggleHelp () {
  hideTip()
  if (help) { help.remove(); help = null; return }
  help = helpOverlay(toggleHelp, run)
  document.body.append(help)
}

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.target.tagName === 'INPUT' && e.key !== 'Enter') return
  if (e.key === 'h' || e.key === 'H' || e.key === '?') return toggleHelp()
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
async function fight () {
  const node = currentNode(run)
  apply(run, { type: 'fight' })
  const bar = battleBar()
  show(bar)
  const battle = createBattle(run.setup)
  const scene = await engine.battle({
    battle,
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
      const orders = u.where !== 'hunt' ? ' and keeps its orders'
        : u.plan?.where === 'stay' ? ', but it dropped its orders when it faltered and hunts' : ' and hunts'
      // A shadow the Legion (Undead 8) raised is marked on its arise event; on the foes' side it is one of yours.
      const legion = u.shadow && battle.events.some((e) => e.type === 'arise' && e.rule === 'legion' && e.unit.uid === u.uid)
      const how = legion ? 'the Legion (Undead 8), past Arise\'s limit' : 'Arise'
      const notes = [
        u.shadow && (foe
          ? legion ? 'A shadow of one of your fallen, risen against you by their Legion (Undead 8): it always falters and is gone when the battle ends.'
            : 'A shadow raised by the Sovereign\'s Grave Tide: it always falters, and crumbles if the Sovereign falls.'
          : captain
            ? `A shadow, raised by ${how} within ${unitDef(captain.id).name}'s domain: it joined its banner, and falters only beyond ${R} tiles of it (or once it falls). It is gone when the battle ends${u.arisen && holds(run.state, 'keep') ? ', unless it still stands when the battle is won: then Hollow Court keeps it as rank-and-file' : ''}.`
            : u.arisen && holds(run.state, 'keep')
              ? 'A shadow, raised by Arise: it always falters. Hollow Court: if it still stands when the battle is won, it stays as rank-and-file.'
              : `A shadow, raised by ${how}: it always falters and is gone when the battle ends.`),
        foe && u.wave && (u.when?.at === 'time' ? 'It came with the late pair, over the far edge.' : `It came with wave ${u.wave + 1}, over the far edge.`),
        foe && !u.rank && led > 0 && ENEMY_TEXT.captain(led, unitDef(u.id).boss),
        u.grade >= 2 && !foe && `A Marshal: within ${R} tiles of it, wherever it goes, its banner never falters, so none of it drops its orders there, and a shadow raised there joins it. It never falters itself.`,
        kept && u !== marshal && !u.shadow && `Beyond the ${battle.ks.crown ? '' : "Monarch's "}domain, but within its Marshal's: it fights at full strength${orders}.`,
        u.rank && (foe ? (captain ? ENEMY_TEXT.of(captain.id) : 'Of a captain\'s cohort.') : `Rank-and-file of ${captain ? `${unitDef(captain.id).name}'s` : 'a'} banner, at muster level ${u.lvl}.`),
        u.orphan ? 'Its captain has fallen: it falters and hunts.' : u.rank && 'It keeps within a tile of its captain.',
        !foe && !u.shadow && !u.orphan && u.falter && (battle.ks.crown
          ? `Outside the domain, which follows your front-most captain (Vanguard Crown): it falters, dealing ×${TUNING.monarch.falter} damage until the domain reaches it again.`
          : `Outside the Monarch's domain: it falters, dealing ×${TUNING.monarch.falter} damage until it steps back in.`),
        u.rose && 'Risen by Undying this battle: its next fall is final.',
        battle.ks.pool && !foe && !u.shadow && (u.cohortOf != null ? !u.orphan : battle.units.some((x) => x.cohortOf === u.uid && !x.orphan && x.hp > 0)) &&
          'One Army: it shares one HP pool with its banner, and the banner falls together.',
        ...(!foe ? planNotes(battle, u, captain) : []),
        u.uid === battle.monarch?.uid && `Arise: ${battle.raised} of ${ariseCap(battle.will, battle.ks.raises)} raised this battle.`,
        u.uid === battle.monarch?.uid && battle.ks.tithe > 0 && `Blood Tithe: each shadow costs it ${Math.ceil(u.maxHp * battle.ks.tithe)} HP.`,
        u.uid === battle.monarch?.uid && battle.ks.unhealable && 'Court of Bone: nothing heals it.',
        u.uid === battle.monarch?.uid && n > 0 && `Reserve: ${n} wait${n === 1 ? 's' : ''} behind the camp to enter beside it.`,
        u.uid === battle.monarch?.uid && held.length > 0 && `Held: ${held.length} wait behind the camp for their start (${[...new Set(held.map((r) => r.det))].map((id) => `detachment ${id} ${whenText(held.find((r) => r.det === id).when)}`).join(', ')}).`]
      const realm = { domain: battle.domain, will: battle.will, raises: battle.ks.raises, tithe: battle.ks.tithe, keep: holds(run.state, 'keep') }
      showTip(at, () => unitCard(u, { stats: stats(battle, u), statuses: u.statuses, foe, realm, notes, ordered }))
    },
    onDone: () => {
      // Shadows are not souls: they were never yours to lose. Rank-and-file are counted by kind.
      const lost = run.battle.units.filter((u) => u.side === 'party' && !u.shadow && u.hp <= 0)
      const fallen = lost.filter((u) => !u.rank).map((u) => unitDef(u.id).name)
      const kinds = Object.entries(Object.groupBy(lost.filter((u) => u.rank), (u) => u.id)).map(([id, us]) => bodies(id, us.length))
      const what = [fallen.length && `Fallen: ${fallen.join(', ')}.`, kinds.length && `${kinds.join(', ')} of the rank-and-file fell.`].filter(Boolean)
      if (what.length && run.state.phase !== 'over') note = `${what.join(' ')} An altar will raise them.`
      route()
    }
  })
  bar.attach(scene)
}

// A unit's orders in a battle, live: its detachment's plan, and what it is doing with it now (holding its
// ground, moving to its square, arrived, dropped outside the domain, following its captain into the Hunt).
function planNotes (battle, u, captain) {
  if (u.det == null || !u.plan) return []
  const plan = u.plan
  const arrived = plan.where === 'move' && battle.events.some((e) => e.type === 'arrive' && e.uid === u.uid)
  const following = captain && captain.hp > 0 && captain.where === 'hunt' && u.where !== 'hunt'
  // It falters from t 0 when it was placed outside the domain: it never stepped anywhere.
  const placed = battle.events.find((e) => e.type === 'falter' && e.target === u.uid && e.on)?.t === 0
  return [
    `Detachment ${u.det}: ${ORDERS.where[plan.where].name}${plan.where === 'move' ? ` to ${tileText(plan.square)}` : ''}${u.when ? `, entered ${whenText(u.when)}` : ''}.`,
    following ? 'Its captain hunts, so it hunts.'
      : u.where === 'stay' ? `Holding its ground at ${tileText(u.anchor)}: it strikes what comes in reach, steps in to engage a foe within 2 tiles, and walks back.`
        : u.where === 'move' ? `Moving to ${tileText(u.square)}: it stops to fight what comes near, and once on its square or next to it, it has arrived and hunts.`
          : arrived ? 'It reached its square, and now hunts.'
            : plan.where !== 'hunt' && !u.orphan && (placed
              ? 'Outside the domain only Hunt is heeded: it stood outside from the start, so it dropped its plan at once, and hunts for the rest of the battle.'
              : 'Outside the domain only Hunt is heeded: it stepped out, dropped its plan, and hunts for the rest of the battle.')]
}

const seed = new URLSearchParams(location.search).get('seed') ?? newSeed()
title(seed)

// Console access for debugging: retinue.run.state, retinue.run.state.log, …
window.retinue = { engine, get run () { return run } }
