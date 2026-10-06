// Composition root: the Phaser engine (battles only), the DOM screens, and the run that links them.
// Every player input becomes one apply(run, action); the screens only read run.state.
import { createEngine } from './engine.js'
import { createRun, apply, currentNode } from './sim/run.js'
import { createBattle, stats } from './sim/battle.js'
import { unitDef } from './content.js'
import { titleScreen, mapScreen, NODE, prepScreen, reapScreen, endScreen, battleBar } from './ui.js'
import { helpOverlay, unitCard } from './codex.js'
import { showTip, hideTip } from './dom.js'

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
  help = helpOverlay(toggleHelp)
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
    if (trail && s.phase === 'map') note = `Floor ${s.floor}. The air grows colder.`
    trail = { floor: s.floor, ids: [s.map.start] }
  }
  if (s.phase === 'map') {
    show(mapScreen({ run, trail: trail.ids, note, onNode, act, onHelp: toggleHelp }))
    note = ''
  } else if (s.phase === 'prep') {
    show(prepScreen({ run, act, onFight: fight, onHelp: toggleHelp }))
  } else if (s.phase === 'reap') {
    const title = { reliquary: 'Reliquary', rite: 'Rite' }[currentNode(run).type] ?? 'Spoils'
    show(reapScreen({ run, title, act, onDone: reap, onHelp: toggleHelp }))
  } else {
    show(endScreen({ run, onNew: () => title(newSeed()) }))
  }
}

function onNode (id) {
  apply(run, { type: 'node', id })
  trail.ids.push(id)
  if (currentNode(run).type === 'altar') note = 'The altar burns: everyone is healed and the fallen rise again.'
  route()
}

function reap (index) {
  const o = index === null ? null : run.state.offers[index]
  apply(run, { type: 'reap', index })
  if (o?.type === 'soul') note = `${o.name} rises to serve you.`
  else if (o?.type === 'relic') note = `${o.name} claimed.`
  else if (o?.type === 'tier') note = `${o.name}: the rite is done.`
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
    title: `FLOOR ${run.setup.floor} · ${NODE[node.type].name.toUpperCase()}`,
    barHeight: () => bar.el.offsetHeight,
    onChange: (st) => bar.update(st),
    // Live stats and statuses for the unit under the pointer.
    onHover: (u, at) => {
      if (!u) return hideTip()
      showTip(at, () => unitCard(u, { stats: stats(battle, u), statuses: u.statuses, foe: u.side === 'foe' }))
    },
    onDone: () => {
      const fallen = run.battle.units.filter((u) => u.side === 'party' && u.hp <= 0).map((u) => unitDef(u.id).name)
      if (fallen.length && run.state.phase !== 'over') note = `Fallen: ${fallen.join(', ')}. An altar will raise them.`
      route()
    }
  })
  bar.attach(scene)
}

const seed = new URLSearchParams(location.search).get('seed') ?? newSeed()
title(seed)

// Console access for debugging: retinue.run.state, retinue.run.state.log, …
window.retinue = { engine, get run () { return run } }
