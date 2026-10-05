// The DOM side: title, floor map, spoils, swap and end screens, the command bar under the battle
// canvas, and the small parts they share. Screens only read run.state and report input upward.
import { TUNING } from './tuning.js'
import { availableNodes, commandsFor, xpToNext } from './sim/run.js'
import { RANKS } from './sim/map.js'
import { unitDef, relicDef, KIN, ROLES } from './content.js'
import atlas from './assets/atlas-0.json' with { type: 'json' }
import { activeSynergies, COLS, ROWS, slotAt } from './sim/unit.js'

// ── title ────────────────────────────────────────────────────────────────────────────────────────

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

// ── map ──────────────────────────────────────────────────────────────────────────────────────────

// The floor map: a DAG of rooms you walk upward through, plus the party, formation, relics and synergies.

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

// ── spoils and swap ──────────────────────────────────────────────────────────────────────────────

// 1-of-3 spoils, and the swap screen when a recruit arrives to a full party.

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

// ── end ──────────────────────────────────────────────────────────────────────────────────────────

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

// ── battle command bar ───────────────────────────────────────────────────────────────────────────

// The command bar under the battle canvas. Keyboard and buttons both drive the BattleScene.

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

// ── parts ────────────────────────────────────────────────────────────────────────────────────────

// h('div', { class: 'x', onclick }, ...children)
function h (tag, attrs, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c))
  return el
}

const atlasPng = new URL('./assets/atlas-0.png', import.meta.url).href
const frames = new Map(atlas.frames.map((f) => [f.filename, f.frame]))
const { w: AW, h: AH } = atlas.meta.size

// A unit's first idle frame, cut from the battle atlas.
function portrait (id, size = 32) {
  const f = frames.get(`${unitDef(id).art}/idle/0`)
  const k = size / f.w
  return h('span', {
    class: 'portrait',
    style: `width:${size}px;height:${size}px;background-image:url(${atlasPng});` +
      `background-size:${AW * k}px ${AH * k}px;background-position:${-f.x * k}px ${-f.y * k}px`
  })
}

function hpBar (u) {
  const pct = Math.max(0, Math.min(1, u.hp / u.maxHp))
  return h('span', { class: 'hpbar' + (pct <= 0 ? ' dead' : pct < 0.35 ? ' low' : '') },
    h('span', { style: `width:${pct * 100}%` }))
}

function unitRow (u, extra = null) {
  const d = unitDef(u.id)
  return h('div', { class: 'unit' + (u.hp <= 0 ? ' fallen' : '') },
    portrait(u.id),
    h('div', { class: 'grow' },
      h('div', null, h('b', null, d.name), ` Lv ${u.lvl}`, h('span', { class: 'dim' }, ` · ${KIN[d.kin].name} ${ROLES[d.role].name}`)),
      h('div', { class: 'line' }, hpBar(u), h('span', { class: 'dim' }, u.hp > 0 ? `${u.hp}/${u.maxHp}` : 'fallen'),
        u.xp != null && h('span', { class: 'dim' }, ` xp ${u.xp}/${xpToNext(u.lvl)}`))),
    extra)
}

const partyList = (party) => h('div', { class: 'units' }, party.slice().sort((a, b) => a.slot - b.slot).map((u) => unitRow(u)))

// 3×4 grid, front row on top (nearest the enemy). Click two slots to swap them.
function formationGrid (party, { selected = null, onSlot = null } = {}) {
  const at = new Map(party.map((u) => [u.slot, u]))
  const rows = []
  for (let r = 0; r < ROWS; r++) {
    const cells = []
    for (let c = 0; c < COLS; c++) {
      const slot = slotAt(r, c)
      const u = at.get(slot)
      cells.push(h('button', {
        class: 'cell' + (u ? '' : ' empty') + (selected === slot ? ' sel' : '') + (u && u.hp <= 0 ? ' fallen' : ''),
        title: u ? `${unitDef(u.id).name} Lv ${u.lvl}` : 'empty',
        disabled: !onSlot,
        onclick: () => onSlot?.(slot)
      }, u ? [portrait(u.id, 36), hpBar(u)] : '·'))
    }
    rows.push(h('div', { class: 'row' }, h('span', { class: 'rowname' }, ['front', 'mid', 'back'][r]), cells))
  }
  return h('div', { class: 'grid' }, rows)
}

function relicList (ids) {
  if (!ids.length) return h('p', { class: 'dim' }, 'None yet. Relics come from elites, treasure and spoils.')
  return h('ul', { class: 'list' }, ids.map((id) => {
    const r = relicDef(id)
    return h('li', null, h('b', null, r.name), h('span', { class: 'dim' }, ' ' + r.desc))
  }))
}

function synergyList (party) {
  const active = activeSynergies(party.filter((u) => u.hp > 0))
  if (!active.length) return h('p', { class: 'dim' }, 'None. Field 2+ of one kin or role.')
  return h('ul', { class: 'list' }, active.map((s) => h('li', null, h('b', null, s.name), h('span', { class: 'dim' }, ' ' + s.desc))))
}
