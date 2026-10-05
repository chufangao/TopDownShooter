import { h } from './el.js'
import { partyList } from './party.js'
import { TUNING } from '../content/index.js'

export function endScreen ({ run, onNew }) {
  const s = run.state
  const won = s.result === 'victory'
  const el = h('div', { class: 'screen end-screen' },
    h('div', { class: 'center' },
      h('h1', { class: won ? 'win' : 'lose' }, won ? 'VICTORY' : 'DEFEAT'),
      h('p', null, won ? 'The Hollow Sovereign falls. Your retinue walks out of the dark.' : `Your retinue fell on floor ${s.floor}.`),
      h('table', { class: 'stats' },
        [['Floors cleared', `${s.stats.floorsCleared} of ${TUNING.run.floors}`],
          ['Fights won', `${s.stats.wins} of ${s.stats.fights}`],
          ['Recruits', s.stats.recruits],
          ['Commands spent', s.stats.commandsSpent],
          ['Relics', s.relics.length],
          ['Seed', s.seed]].map(([k, v]) => h('tr', null, h('td', { class: 'dim' }, k), h('td', null, v)))),
      h('button', { class: 'primary', onclick: onNew }, 'New run ', h('kbd', null, 'Enter')),
      h('h2', null, 'Final party'),
      partyList(s.party)))
  return { el, key: (e) => { if (e.key === 'Enter') onNew() } }
}
