// The command bar under the battle canvas. Keyboard and buttons both drive the BattleScene.
import { h } from './el.js'

const VERBS = [
  { verb: 'focus', key: 'Q', name: 'Focus', tip: 'All your units target one foe for 6 s.' },
  { verb: 'parley', key: 'W', name: 'Parley', tip: 'Try to recruit a weakened foe. Refunded if it dies first.' },
  { verb: 'brace', key: 'E', name: 'Brace', tip: 'An ally steps back a row and takes 40% less damage for 5 s.' },
  { verb: 'unleash', key: 'R', name: 'Unleash', tip: 'An ally casts its strongest ability this tick.' }
]
const SPEEDS = [1, 2, 4]

export function battleBar ({ max }) {
  let scene = null
  let st = { paused: false, speed: 1, targeting: null, commandsLeft: max, seconds: 0, message: '', hover: '', over: false }
  const noFocus = (e) => e.preventDefault()
  const btn = (attrs, ...kids) => h('button', { tabindex: '-1', onmousedown: noFocus, ...attrs }, ...kids)

  const verbs = VERBS.map((v) => btn({ class: 'verb', title: v.tip, onclick: () => scene?.beginTarget(v.verb) }, h('kbd', null, v.key), ' ', v.name))
  const speeds = SPEEDS.map((n) => btn({ class: 'speed', onclick: () => scene?.setSpeed(n) }, `×${n}`))
  const pause = btn({ class: 'pause', onclick: () => scene?.togglePause() })
  const pips = h('span', { class: 'pips' })
  const count = h('span', { class: 'count' })
  const clock = h('span', { class: 'clock dim' })
  const msg = h('div', { class: 'msg' })
  const el = h('div', { class: 'battlebar' }, msg,
    h('div', { class: 'bar-row' },
      h('div', { class: 'cmds' }, h('span', { class: 'dim' }, 'Commands '), count, pips),
      h('div', { class: 'verbs' }, verbs),
      h('div', { class: 'time' }, clock, pause, speeds)))

  function render () {
    count.textContent = `${st.commandsLeft}/${max} `
    pips.replaceChildren(...Array.from({ length: max }, (_, i) => h('span', { class: i < st.commandsLeft ? 'on' : '' })))
    VERBS.forEach((v, i) => {
      verbs[i].classList.toggle('active', st.targeting === v.verb)
      verbs[i].disabled = st.over || st.commandsLeft <= 0
    })
    SPEEDS.forEach((n, i) => speeds[i].classList.toggle('active', st.speed === n))
    pause.replaceChildren(st.paused ? '▶ resume' : '❚❚ pause', ' ', h('kbd', null, 'Space'))
    pause.classList.toggle('active', st.paused)
    clock.textContent = `${st.seconds.toFixed(0)} s`
    msg.textContent = st.message || st.hover || (st.paused ? 'Paused.' : 'Hover a unit for details. Pick a Command to pause and choose its target.')
    msg.classList.toggle('active', !!st.targeting)
  }
  render()

  return {
    el,
    attach (s) { scene = s },
    update (next) { st = next; render() },
    key (e) {
      if (!scene) return
      const v = VERBS.find((x) => e.code === 'Key' + x.key)
      if (v) scene.beginTarget(v.verb)
      else if (e.code === 'Space') scene.togglePause()
      else if (e.code === 'Escape') scene.cancelTarget()
      else if (['Digit1', 'Digit2', 'Digit4'].includes(e.code)) scene.setSpeed(Number(e.code.slice(5)))
      else return
      e.preventDefault()
    }
  }
}
