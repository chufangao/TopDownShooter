// Composition root: the Phaser engine (battles only), the DOM screens, and the run that links them.
// Every player input becomes one apply(run, action); the screens only read run.state.
import { createEngine } from './engine.js'
import { createRun, apply, currentNode } from './sim/run.js'
import { unitDef } from './content.js'
import { titleScreen, mapScreen, NODE, spoilsScreen, swapScreen, endScreen, battleBar } from './ui.js'

const ui = document.getElementById('ui')
const engine = createEngine('game')
let screen = null
let run = null
let trail = null
let note = ''

function show (s) {
  screen = s
  ui.replaceChildren(s.el)
  ui.scrollTop = 0
}

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.target.tagName === 'INPUT' && e.key !== 'Enter') return
  screen?.key?.(e)
})

const newSeed = () => (Date.now() % 1e8).toString(36) + Math.floor(Math.random() * 1296).toString(36)
const act = (action) => apply(run, action)

function title (seed) {
  run = null
  show(titleScreen({ seed, onStart: start }))
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
    show(mapScreen({ run, trail: trail.ids, note, onNode, onSwap: (a, b) => act({ type: 'slots', a, b }) }))
    note = ''
  } else if (s.phase === 'battle') battle()
  else if (s.phase === 'spoils') {
    const title = currentNode(run).type === 'treasure' ? 'Treasure' : 'Spoils'
    show(spoilsScreen({ run, title, onPick: (index) => { act({ type: 'spoil', index }); route() } }))
  } else if (s.phase === 'swap') {
    show(swapScreen({ run, onRelease: (uid) => { act({ type: 'release', uid }); route() } }))
  } else {
    show(endScreen({ run, onNew: () => title(newSeed()) }))
  }
}

function onNode (id) {
  act({ type: 'node', id })
  trail.ids.push(id)
  if (currentNode(run).type === 'campfire') note = 'Campfire: everyone is healed and the fallen stand again.'
  route()
}

// The run moves on as soon as the sim ends the battle; the scene keeps playing it out, then routes.
async function battle () {
  const b = run.battle
  const node = currentNode(run)
  const bar = battleBar({ max: b.commandsLeft })
  show(bar)
  const scene = await engine.battle({
    battle: b,
    act,
    title: `FLOOR ${b.floor} · ${NODE[node.type].name.toUpperCase()}`,
    barHeight: () => bar.el.offsetHeight,
    onChange: (st) => bar.update(st),
    onDone: () => {
      const joined = b.recruited.map((uid) => unitDef(b.units.find((u) => u.uid === uid).id).name)
      if (joined.length && run.state.phase !== 'over') note = `${joined.join(', ')} joined your retinue.`
      route()
    }
  })
  bar.attach(scene)
}

const seed = new URLSearchParams(location.search).get('seed') ?? newSeed()
title(seed)

// Console access for debugging: retinue.run.state, retinue.run.state.log, …
window.retinue = { engine, get run () { return run } }
