// 1-of-3 spoils, and the swap screen when a recruit arrives to a full party.
import { h, portrait } from './el.js'
import { partyList, unitRow } from './party.js'
import { TUNING, unitDef } from '../content/index.js'

const TAG = { relic: 'RELIC', drill: 'DRILL', rest: 'REST', recruit: 'RECRUIT' }

export function spoilsScreen ({ run, title, onPick }) {
  const s = run.state
  const cards = s.offers.map((o, i) => h('button', { class: `card o-${o.type}`, onclick: () => onPick(i) },
    h('div', { class: 'tag' }, h('kbd', null, i + 1), ' ', TAG[o.type]),
    o.type === 'recruit' && portrait(o.id, 64),
    h('div', { class: 'name' }, o.name),
    h('div', { class: 'desc' }, o.desc)))
  const el = h('div', { class: 'screen spoils-screen' },
    h('div', { class: 'center' },
      h('h1', null, title),
      h('p', { class: 'dim' }, 'Choose one.'),
      h('div', { class: 'cards' }, cards),
      h('button', { class: 'skip', onclick: () => onPick(null) }, 'Skip ', h('kbd', null, 'S')),
      s.pending.length > 0 && h('p', { class: 'warn' }, `${s.pending.length} recruit(s) waiting: your party is full.`),
      h('h2', null, `Party ${s.party.length}/${TUNING.party.cap}`),
      partyList(s.party)))
  return {
    el,
    key (e) {
      const i = Number(e.key) - 1
      if (s.offers[i]) onPick(i)
      else if (e.key === 's' || e.key === 'S' || e.key === 'Escape') onPick(null)
    }
  }
}

export function swapScreen ({ run, onRelease }) {
  const s = run.state
  const r = s.pending[0]
  const d = unitDef(r.id)
  const el = h('div', { class: 'screen swap-screen' },
    h('div', { class: 'center' },
      h('h1', null, 'Party full'),
      h('p', null, `${d.name} wants to join, but you already lead ${TUNING.party.cap}. Release someone to make room, or turn it away.`),
      h('div', { class: 'units recruit' }, unitRow(r)),
      h('button', { class: 'skip', onclick: () => onRelease(null) }, `Turn ${d.name} away `, h('kbd', null, 'Esc')),
      h('h2', null, 'Release one'),
      h('div', { class: 'units' }, s.party.slice().sort((a, b) => a.slot - b.slot).map((u) =>
        unitRow(u, h('button', { class: 'release', onclick: () => onRelease(u.uid) }, 'Release'))))))
  return { el, key: (e) => { if (e.key === 'Escape') onRelease(null) } }
}
