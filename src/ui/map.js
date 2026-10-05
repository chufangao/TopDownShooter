// The floor map: a DAG of rooms you walk upward through, plus the party, formation, relics and synergies.
import { h } from './el.js'
import { partyList, formationGrid, relicList, synergyList } from './party.js'
import { TUNING } from '../content/index.js'
import { availableNodes, commandsFor } from '../sim/run.js'
import { RANKS } from '../sim/map.js'

export const NODE = {
  start: { icon: '●', name: 'Start' },
  fight: { icon: '⚔', name: 'Fight' },
  elite: { icon: '✦', name: 'Elite' },
  treasure: { icon: '◆', name: 'Treasure' },
  campfire: { icon: '▲', name: 'Campfire' },
  boss: { icon: '♛', name: 'Boss' }
}
const HINT = {
  fight: '3 foes. Win for 1 of 3 spoils.',
  elite: '4 tougher foes. Spoils always include a relic.',
  treasure: 'Choose 1 of 3 relics.',
  campfire: 'Heal everyone fully; the fallen return at half HP.',
  boss: 'The Hollow Sovereign. Win the run.'
}

const W = 380
const ROW_H = 84
const H = RANKS * ROW_H
const pos = (n) => ({ x: 60 + n.lane * 130, y: (RANKS - 1 - n.rank) * ROW_H + ROW_H / 2 })

// trail: node ids visited on this floor, in order (starts with the start node).
export function mapScreen ({ run, trail, note = '', onNode, onSwap }) {
  const el = h('div', { class: 'screen map-screen' })
  let selected = null
  const s = run.state

  function render () {
    const reach = availableNodes(run)
    const reachIds = new Set(reach.map((n) => n.id))
    const walked = new Set(trail.slice(1).map((id, i) => `${trail[i]}>${id}`))
    const svgNS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(svgNS, 'svg')
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    for (const n of s.map.nodes) {
      for (const id of n.next) {
        const m = s.map.nodes.find((x) => x.id === id)
        const a = pos(n)
        const b = pos(m)
        const line = document.createElementNS(svgNS, 'line')
        for (const [k, v] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })) line.setAttribute(k, v)
        const cls = walked.has(`${n.id}>${id}`) ? 'walked' : n.id === s.at && reachIds.has(id) ? 'open' : ''
        line.setAttribute('class', 'edge ' + cls)
        svg.append(line)
      }
    }
    const nodes = s.map.nodes.map((n) => {
      const p = pos(n)
      const ok = reachIds.has(n.id)
      const key = ok ? reach.indexOf(n) + 1 : null
      return h('button', {
        class: `node t-${n.type}` + (ok ? ' reach' : ' dim') + (trail.includes(n.id) ? ' visited' : '') + (n.id === s.at ? ' here' : ''),
        style: `left:${p.x / W * 100}%;top:${p.y}px`,
        disabled: !ok,
        title: HINT[n.type] ?? '',
        onclick: () => onNode(n.id)
      }, h('span', { class: 'icon' }, NODE[n.type].icon), ' ', NODE[n.type].name, key && h('kbd', null, key))
    })

    const hint = reach.length ? reach.map((n, i) => `${i + 1} ${NODE[n.type].name}: ${HINT[n.type]}`) : []
    const living = s.party.filter((u) => u.hp > 0).length
    el.replaceChildren(
      h('header', null,
        h('h1', null, 'RETINUE'),
        h('span', null, `Floor ${s.floor} of ${TUNING.run.floors}`),
        h('span', { class: 'dim' }, `Fights won ${s.stats.wins} · Recruits ${s.stats.recruits} · ${commandsFor(run)} Commands per battle · seed ${s.seed}`)),
      note && h('div', { class: 'note' }, note),
      h('div', { class: 'cols' },
        h('section', { class: 'mapcol' },
          h('h2', null, 'Route'),
          h('div', { class: 'dag', style: `height:${H}px` }, svg, nodes),
          h('div', { class: 'hints dim' }, hint.map((t) => h('div', null, t)))),
        h('section', { class: 'side' },
          h('h2', null, `Party ${s.party.length}/${TUNING.party.cap}`, h('span', { class: 'dim' }, ` · ${living} standing`)),
          partyList(s.party),
          h('h2', null, 'Formation', h('span', { class: 'dim' }, ' · click two slots to swap')),
          formationGrid(s.party, { selected, onSlot: slotClick }),
          h('h2', null, 'Synergies'),
          synergyList(s.party),
          h('h2', null, 'Relics'),
          relicList(s.relics))))
  }

  function slotClick (slot) {
    if (selected === null) selected = slot
    else if (selected === slot) selected = null
    else {
      const a = selected
      selected = null
      if (s.party.some((u) => u.slot === a || u.slot === slot)) onSwap(a, slot)
    }
    render()
  }

  render()
  return {
    el,
    key (e) {
      const n = availableNodes(run)[Number(e.key) - 1]
      if (n) onNode(n.id)
      else if (e.key === 'Escape' && selected !== null) { selected = null; render() }
    }
  }
}
