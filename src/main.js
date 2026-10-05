// Composition root: the Phaser engine (battles only), the DOM screens, and the run that links them.
import './ui/style.css'
import { createEngine } from './engine/boot.js'
import { createRun, chooseNode, finishBattle, pickSpoil, resolveSwap, swapSlots, currentNode, commandsFor } from './sim/run.js'
import { unitDef } from './content/index.js'
import { titleScreen } from './ui/title.js'
import { mapScreen, NODE } from './ui/map.js'
import { battleBar } from './ui/battlebar.js'
import { spoilsScreen, swapScreen } from './ui/spoils.js'
import { endScreen } from './ui/end.js'

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
    show(mapScreen({ run, trail: trail.ids, note, onNode, onSwap: (a, b) => swapSlots(run, a, b) }))
    note = ''
  } else if (s.phase === 'battle') battle()
  else if (s.phase === 'spoils') {
    show(spoilsScreen({ run, title: currentNode(run).type === 'treasure' ? 'Treasure' : 'Spoils', onPick: (i) => { pickSpoil(run, i); route() } }))
  } else if (s.phase === 'swap') {
    show(swapScreen({ run, onRelease: (uid) => { resolveSwap(run, uid); route() } }))
  } else {
    show(endScreen({ run, onNew: () => title(newSeed()) }))
  }
}

function onNode (id) {
  chooseNode(run, id)
  trail.ids.push(id)
  if (currentNode(run).type === 'campfire') note = 'Campfire: everyone is healed and the fallen stand again.'
  route()
}

async function battle () {
  const b = run.battle
  const node = currentNode(run)
  const bar = battleBar({ max: commandsFor(run) })
  show(bar)
  const scene = await engine.battle({
    battle: b,
    title: `FLOOR ${b.floor} · ${NODE[node.type].name.toUpperCase()}`,
    barHeight: () => bar.el.offsetHeight,
    onChange: (st) => bar.update(st),
    onDone: () => {
      const joined = b.recruited.map((uid) => unitDef(b.units.find((u) => u.uid === uid).id).name)
      finishBattle(run)
      if (joined.length && run.state.phase !== 'over') note = `${joined.join(', ')} joined your retinue.`
      route()
    }
  })
  bar.attach(scene)
}

const seed = new URLSearchParams(location.search).get('seed') ?? newSeed()
title(seed)

if (import.meta.env.DEV) window.retinue = { engine, get run () { return run } }
