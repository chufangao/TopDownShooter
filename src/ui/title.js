import { h } from './el.js'

export function titleScreen ({ seed, onStart }) {
  const input = h('input', { value: seed, spellcheck: 'false', 'aria-label': 'seed' })
  const start = () => onStart(input.value.trim() || seed)
  const el = h('div', { class: 'screen title-screen' },
    h('div', { class: 'title-box' },
      h('h1', null, 'RETINUE'),
      h('p', null, 'A roguelite autobattler. Choose your route, overrule the fight with Commands, recruit your foes.'),
      h('ul', { class: 'how dim' },
        h('li', null, 'Battles play out on their own. You get 3 Commands per fight:'),
        h('li', null, h('kbd', null, 'Q'), ' Focus a foe · ', h('kbd', null, 'W'), ' Parley with a weakened foe to recruit it'),
        h('li', null, h('kbd', null, 'E'), ' Brace an ally · ', h('kbd', null, 'R'), ' Unleash an ally\'s strongest ability now'),
        h('li', null, h('kbd', null, 'Space'), ' pause · ', h('kbd', null, '1'), ' ', h('kbd', null, '2'), ' ', h('kbd', null, '4'), ' speed')),
      h('label', { class: 'seed' }, 'seed ', input),
      h('button', { class: 'primary', onclick: start }, 'Start run ', h('kbd', null, 'Enter'))))
  return { el, key: (e) => { if (e.key === 'Enter') start() } }
}
