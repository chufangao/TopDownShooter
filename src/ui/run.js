// The run's screen between battles, its four tabs folded into the top bar, and the Map: the floor's rooms.
import { roomTip, ROOM, codexView, bestiaryCount, roomLacks, lackName } from '../codex.js'
import { h, fill, icon, hideTip, pinTip, touchy, say } from '../dom.js'
import { RANKS, WIDTH } from '../sim/map.js'
import { availableNodes, shopOffers, shelfFusions, fielded, souls } from '../sim/run.js'
import { topbar, ossuaryCount } from './chrome.js'
import { fieldEditor } from './field.js'
import { shopView } from './shop.js'

// ── the run's screen: Field · Map · Shop · Codex ────────────────────────────────────────────────

// One view at a time; the Map opens first. Each tab's tooltip leads with its counts (`now`).
const TABS = [
  { id: 'field', name: 'Field', ico: 'field', key: 'F', desc: 'The board: place your souls and read the roads.', now: ossuaryCount },
  { id: 'map', name: 'Map', ico: 'map', key: 'R', desc: 'The floor: scout its rooms.',
    now: (run) => { const n = availableNodes(run).length; return `Floor ${run.state.floor}: ${n} room${n === 1 ? '' : 's'} open to you next.` } },
  { id: 'shop', name: 'Shop', ico: 'shop', key: 'B', desc: 'Relics and fusions for essence, open between battles.', now: shopCount },
  { id: 'codex', name: 'Codex', ico: 'codex', key: 'C', desc: 'The rules, the words and the foes you have met.',
    now: () => { const b = bestiaryCount(); return `${b.met} of ${b.of} foe kinds met.` } }]

// The Shop's counts: the relics on the shelf the purse reaches, and the fusions ready (every part held) and affordable.
function shopCount (run) {
  const left = shopOffers(run).filter(Boolean)
  const reach = left.filter((o) => o.cost <= run.state.essence).length
  const ready = shelfFusions(run)
  const afford = ready.filter((x) => x.can).length
  return `${reach} of ${left.length} relic${left.length === 1 ? '' : 's'} within reach; ${ready.length} fusion${ready.length === 1 ? '' : 's'} ready, ${afford} affordable.`
}

// trail: node ids visited on this floor, in order (starts with the start node). onNode: walk to a room.
export function runScreen ({ run, act, trail, note = '', onNode, onHelp, onTab = null }) {
  const bar = h('div', { class: 'bar-slot' })
  const tabsEl = h('nav', { class: 'top-tabs', role: 'tablist', 'aria-label': 'Views' })
  const body = h('div', { class: 'run-body' })
  let tab = null
  // Every change read again: the top bar, and the Map where it is open (its marks follow the field).
  const refresh = () => {
    fill(bar, topbar(run, onHelp, tabsEl))
    if (tab === 'map') fill(body, mapView({ run, trail, onNode }))
  }
  const editor = fieldEditor({ run, act, onChange: refresh })
  refresh()

  // The note (what just happened) floats over the foot of the view: a tap dismisses it, and it fades by itself.
  const toast = note && h('div', { class: 'note', role: 'status', onclick: (e) => e.currentTarget.remove() }, note)
  const reach = availableNodes(run)
  const show = (id) => {
    if (tab === id) return
    if (tab && toast) toast.remove()
    tab = id
    hideTip()
    editor.release()
    fill(tabsEl, TABS.map((t) => h('button', {
      class: 'top-tab' + (t.id === tab ? ' on' : ''), role: 'tab', 'aria-selected': t.id === tab ? 'true' : 'false', 'data-tab': t.id,
      onclick: () => show(t.id), tip: () => h('div', { class: 'syn-tip' }, h('b', null, t.name), say(` (${t.key})`, ''), h('p', null, t.now(run)), h('p', { class: 'dim' }, t.desc))
    }, icon(t.ico, 22), h('span', { class: 'top-tab-name' }, t.name))))
    fill(body, id === 'field' ? editor.el
      : id === 'map' ? mapView({ run, trail, onNode })
        : id === 'shop' ? shopView({ run, act, onChange: refresh }).el
          : h('section', { class: 'panel codex-panel' }, codexView(run)))
    if (id === 'field') editor.shown()
    onTab?.(id)
  }
  show('map')
  const el = h('div', { class: 'screen fit run-screen' }, bar, body, toast)
  return {
    el,
    // A battle refused for want of a soul on the field: the Field opens, asking for one.
    wantSoul () {
      show('field')
      editor.wantSoul()
    },
    key (e) {
      const n = reach[Number(e.key) - 1]
      if (n) { editor.release(); onNode(n.id) } else if (e.key === 'f' || e.key === 'F') show('field')
      else if (e.key === 'r' || e.key === 'R') show('map')
      else if (e.key === 'b' || e.key === 'B') show('shop')
      else if (e.key === 'c' || e.key === 'C') show('codex')
      else if (tab === 'field') editor.key(e)
    }
  }
}

export const NODE = Object.fromEntries(Object.entries(ROOM).map(([k, v]) => [k, { name: k === 'boss' ? 'Boss' : v.name }]))

// ── the map ──────────────────────────────────────────────────────────────────────────────────────

// The whole floor at once: ranks across (the start on the left), lanes down, in % of the floor's box to fit any frame.
const pos = (n) => ({ x: n.rank / (RANKS - 1) * 100, y: n.lane / (WIDTH - 1) * 100 })

// What a threat asks of the army (spawn.js ANSWERS), as a room ahead that nothing fielded answers wears it: its mark on
// the room, and what is missing; the three a mend answers share theirs.
const MENDS = { ico: 'hp', lack: 'nothing fielded mends another or cleanses' }
const UNMET = {
  fly: { ico: 'wing', lack: 'nothing fielded can strike a flyer' },
  reach: { ico: 'reach', lack: 'nothing fielded strikes from afar' },
  drain: MENDS,
  burn: MENDS,
  bleed: MENDS
}
const OTHER = { ico: 'elite', lack: 'nothing fielded answers it' }
// A locked kind (codex.js roomLacks): no key laid by anything fielded, or one piece alone (a soul's summons are pieces)
// to lay it and strike. A lock is a temptation, never a wall: its mark is a hint (the key's gold, apart from the
// warnings), and its line says the fight is a slog unkeyed and what would open it.
const LOCK = { ico: 'r-key', hint: true, head: 'A lock on', lack: 'a slog unkeyed, never a wall; a soul that lays its key makes it the payoff' }
const PAIR = { ico: 'r-key', hint: true, head: 'A lock on', lack: 'a slog unkeyed, never a wall; one soul lays its key, a second strikes for the payoff' }
const unmetOf = (t) => (t.startsWith('lock:') ? LOCK : t.startsWith('pair:') ? PAIR : UNMET[t] ?? OTHER)
const isHint = (t) => !!unmetOf(t).hint

// Its marks, one per missing answer, at the medal's upper left; a lock's hint at its left edge.
const marks = (cls, types) => types.length > 0 && h('span', { class: cls, 'aria-hidden': 'true' },
  [...new Set(types.map((t) => unmetOf(t).ico))].map((ico) => icon(ico, 14)))
const unmetMark = (types) => [marks('unmet', types.filter((t) => !isHint(t))), marks('keyhint', types.filter(isHint))]
// The room's tooltip, a line for each missing answer under its title, the locks' last (roomLacks' order).
function unmetTip (tip, types) {
  const by = new Map()
  for (const t of types) {
    const u = unmetOf(t)
    by.set(u, [...(by.get(u) ?? []), lackName(t)])
  }
  const lines = [...by].map(([u, names]) => h('p', { class: (u.hint ? 'rt-key' : 'warn') + ' rt-unmet' }, icon(u.ico, 16), `${u.head ?? 'No answer to'} ${names.join(', ')}: ${u.lack}.`))
  if (!lines.length) return tip
  const head = tip.querySelector('.rt-head')
  if (head) head.after(...lines)
  else tip.prepend(...lines)
  return tip
}

// A room's marks in words, for its label.
const label = (head, types) => (types.length ? `${head} ${types.map(lackName).join(', ')}` : '')

// A click enters a glowing room. By touch a tap scouts (its tooltip pinned with Enter ▸) and a second tap enters. A room
// ahead whose threats include one that no living fielded soul answers wears its mark (unmet); one with a lock nothing
// fielded keys, its hint.
function mapView ({ run, trail, onNode }) {
  const s = run.state
  const army = fielded(souls(s.party)).filter((u) => u.hp > 0)
  const here = s.map.nodes.find((n) => n.id === s.at)
  const lacks = (n) => trail.includes(n.id) || n.rank <= (here?.rank ?? -1) ? [] : roomLacks(n, army)
  const reach = availableNodes(run)
  const reachIds = new Set(reach.map((n) => n.id))
  const walked = new Set(trail.slice(1).map((id, i) => `${trail[i]}>${id}`))
  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNS, 'svg')
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('preserveAspectRatio', 'none')
  for (const n of s.map.nodes) {
    for (const id of n.next) {
      const a = pos(n)
      const b = pos(s.map.nodes.find((x) => x.id === id))
      const path = document.createElementNS(svgNS, 'path')
      const mx = (a.x + b.x) / 2
      path.setAttribute('d', `M${a.x} ${a.y} C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`)
      const cls = walked.has(`${n.id}>${id}`) ? 'walked' : n.id === s.at && reachIds.has(id) ? 'open' : ''
      path.setAttribute('class', 'edge ' + cls)
      svg.append(path)
    }
  }
  let chosen = null
  const scout = (el, n, ok) => {
    chosen = ok ? el : null
    el.classList.toggle('chosen', ok)
    pinTip(el, () => [unmetTip(roomTip(run, n, { reachable: ok, enter: ok }), lacks(n)),
      ok && h('button', { class: 'primary small tip-act', onclick: () => onNode(n.id) }, 'Enter ▸')], {
      keep: true,
      onHide: () => { el.classList.remove('chosen'); if (chosen === el) chosen = null }
    })
  }
  const nodes = s.map.nodes.map((n) => {
    const p = pos(n)
    const ok = reachIds.has(n.id)
    const key = ok ? reach.findIndex((x) => x.id === n.id) + 1 : null
    const lack = lacks(n)
    return h('button', {
      class: `node t-${n.type}` + (ok ? ' reach' : '') + (trail.includes(n.id) ? ' visited' : '') + (n.id === s.at ? ' here' : '') + (!ok && !trail.includes(n.id) ? ' far' : ''),
      style: `left:${p.x}%;top:${p.y}%`,
      'aria-disabled': ok ? null : 'true',
      'aria-label': NODE[n.type].name + label(', no answer to', lack.filter((t) => !isHint(t))) + label(', a lock on', lack.filter(isHint)),
      tip: () => unmetTip(roomTip(run, n, { reachable: ok }), lack),
      onclick: (e) => {
        if (!touchy()) { if (ok) onNode(n.id); return }
        if (ok && chosen === e.currentTarget) return onNode(n.id)
        scout(e.currentTarget, n, ok)
      }
    }, h('span', { class: 'medal' }, icon(n.type, 24)), h('span', { class: 'node-name' }, NODE[n.type].name), key && h('kbd', null, key), unmetMark(lack))
  })
  return h('section', { class: 'panel mapcol', 'aria-label': 'The floor' },
    h('div', { class: 'map-head' }, h('h2', null, s.tutorial ? 'The threshold' : `Floor ${s.floor}`),
      h('span', { class: 'dim' }, say('Click a glowing room to enter it (or its number); hover any to scout it.', 'Tap a glowing room twice to enter it; tap any to scout it.'))),
    h('div', { class: 'dag-wrap' }, h('div', { class: 'dag' }, svg, nodes)))
}
