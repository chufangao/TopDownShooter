// The DOM side: title, floor map, prep, reap and end screens, the playback bar under the battle canvas,
// and the parts they share. Screens only read run.state and report input upward; the retinue editor
// sends its actions through act(action), which returns an error message or null. Every control has a
// tooltip saying exactly what it does (rules text lives in codex.js).
import { TUNING } from './tuning.js'
import { availableNodes, fieldCap, fielded, benched, mergeable, currentNode } from './sim/run.js'
import { RANKS } from './sim/map.js'
import { unitDef, relicDef, campDef, KIN, ROLES } from './content.js'
import { COLS, ROWS, CAMP_ROWS, slotAt, rowOf, activeBonds, isWall } from './sim/unit.js'
import { h, fill, icon, portrait, prefs } from './dom.js'
import { unitCard, partyMods, roomFoeMods, roomTip, threatMeter, foeSynergyLine, synergyTracker, bondTracker, bondMods, bondNotes, relicTip, mergeTip, ROOM, campRowLabel, campRowText } from './codex.js'

// ── title ────────────────────────────────────────────────────────────────────────────────────────

export function titleScreen ({ seed, onStart, onHelp }) {
  const input = h('input', { value: seed, spellcheck: 'false', 'aria-label': 'seed' })
  const start = () => onStart(input.value.trim() || seed)
  const step = (ico, title, text) => h('div', { class: 'step' }, h('div', { class: 'step-ico' }, icon(ico, 26)), h('b', null, title), h('p', null, text))
  const el = h('div', { class: 'screen title-screen' },
    h('div', { class: 'title-box' },
      h('div', { class: 'sigil' }, icon('soul', 54)),
      h('h1', { class: 'logo' }, 'RETINUE'),
      h('p', { class: 'tagline' }, 'You are a necromancer, and the dead fight for you.', h('br'), 'Descend four floors and unmake the Hollow Sovereign.'),
      h('div', { class: 'steps' },
        step('fight', 'Scout', 'Hover rooms on the map to see the foes and formation waiting inside.'),
        step('start', 'Arrange', `Place up to ${TUNING.party.field} souls on the field. Once a battle begins, it plays out on its own.`),
        step('soul', 'Reap', 'Bind the soul of a foe you slew. Three of a kind merge into a stronger shade.')),
      h('div', { class: 'title-actions' },
        h('button', { class: 'primary big', onclick: start, tip: () => 'Start a new run with this seed. (Enter)' }, 'Begin the descent ', h('kbd', null, 'Enter')),
        h('button', { class: 'ghost', onclick: onHelp, tip: () => 'Rules, the board, synergies, elements and relics. (H)' }, icon('help'), ' How to play')),
      h('label', { class: 'seed', tip: () => 'The same seed always makes the same maps, foes and battles. Share one to play the same run.' }, 'seed ', input)))
  return { el, key: (e) => { if (e.key === 'Enter') start() } }
}

// ── shared chrome ────────────────────────────────────────────────────────────────────────────────

function topbar (run, onHelp) {
  const s = run.state
  const chip = (label, value, text) => h('span', { class: 'chip-stat', tip: () => text }, h('span', { class: 'dim' }, label), h('b', null, value))
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, icon('soul', 20), h('span', null, 'RETINUE')),
    h('div', { class: 'floors', tip: () => `Floor ${s.floor} of ${TUNING.run.floors}. Each floor ends in an elite; floor ${TUNING.run.floors} ends with the boss.` },
      Array.from({ length: TUNING.run.floors }, (_, i) => h('span', { class: 'pip' + (i + 1 < s.floor ? ' done' : i + 1 === s.floor ? ' now' : '') })),
      h('span', null, `Floor ${s.floor}`)),
    h('div', { class: 'chips' },
      chip('Souls', `${s.party.length}/${TUNING.party.roster}`, `Souls you hold, on the field and in the ossuary. You can hold up to ${TUNING.party.roster}.`),
      chip('Won', s.stats.wins, 'Battles won this run.'),
      chip('Reaped', s.stats.reaped, 'Souls bound after battles.'),
      chip('Merges', s.stats.merges, 'Times three souls fused into one of a higher star.'),
      chip('Seed', s.seed, 'This run\'s seed. The same seed always makes the same run.')),
    h('button', { class: 'icon-btn', onclick: onHelp, tip: () => 'How to play (H)' }, icon('help', 20)))
}

// A dismissible strip of numbered steps for a screen; it remembers being closed.
function guide (key, steps) {
  const el = h('div', { class: 'guide' })
  const render = () => {
    const hidden = prefs.get('guide:' + key) === 'off'
    fill(el, hidden
      ? h('button', { class: 'link', onclick: () => { prefs.set('guide:' + key, 'on'); render() }, tip: () => 'Show the steps for this screen again.' }, 'Show tips')
      : h('div', { class: 'guide-box' },
        h('ol', null, steps.map((s) => h('li', null, s))),
        h('button', { class: 'icon-btn small', onclick: () => { prefs.set('guide:' + key, 'off'); render() }, tip: () => 'Hide these tips. "Show tips" brings them back.' }, icon('close', 14))))
  }
  render()
  return el
}

// ── map ──────────────────────────────────────────────────────────────────────────────────────────

const NODE_W = 400
const ROW_H = 82
const H = RANKS * ROW_H
const pos = (n) => ({ x: 70 + n.lane * 130, y: (RANKS - 1 - n.rank) * ROW_H + ROW_H / 2 })

export const NODE = Object.fromEntries(Object.entries(ROOM).map(([k, v]) => [k, { name: k === 'boss' ? 'Boss' : v.name }]))

// trail: node ids visited on this floor, in order (starts with the start node).
export function mapScreen ({ run, trail, note = '', onNode, act, onHelp }) {
  const s = run.state
  const reach = availableNodes(run)
  const reachIds = new Set(reach.map((n) => n.id))
  const walked = new Set(trail.slice(1).map((id, i) => `${trail[i]}>${id}`))
  const bar = h('div', { class: 'bar-slot' })
  const refreshBar = () => fill(bar, topbar(run, onHelp))
  const editor = retinueEditor({ run, act, onChange: refreshBar })
  refreshBar()

  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${NODE_W} ${H}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  for (const n of s.map.nodes) {
    for (const id of n.next) {
      const a = pos(n)
      const b = pos(s.map.nodes.find((x) => x.id === id))
      const path = document.createElementNS(svgNS, 'path')
      const my = (a.y + b.y) / 2
      path.setAttribute('d', `M${a.x} ${a.y} C${a.x} ${my} ${b.x} ${my} ${b.x} ${b.y}`)
      const cls = walked.has(`${n.id}>${id}`) ? 'walked' : n.id === s.at && reachIds.has(id) ? 'open' : ''
      path.setAttribute('class', 'edge ' + cls)
      svg.append(path)
    }
  }
  // Unreachable rooms stay hoverable (scouting ahead is the point), so they are not `disabled`.
  const nodes = s.map.nodes.map((n) => {
    const p = pos(n)
    const ok = reachIds.has(n.id)
    const key = ok ? reach.indexOf(n) + 1 : null
    return h('button', {
      class: `node t-${n.type}` + (ok ? ' reach' : '') + (trail.includes(n.id) ? ' visited' : '') + (n.id === s.at ? ' here' : '') + (!ok && !trail.includes(n.id) ? ' far' : ''),
      style: `left:${p.x / NODE_W * 100}%;top:${p.y}px`,
      'aria-disabled': ok ? null : 'true',
      'aria-label': NODE[n.type].name,
      tip: () => roomTip(run, n, { reachable: ok }),
      onclick: () => { if (ok) onNode(n.id) }
    }, h('span', { class: 'medal' }, icon(n.type, 20)), h('span', { class: 'node-name' }, NODE[n.type].name), key && h('kbd', null, key))
  })

  const el = h('div', { class: 'screen map-screen' },
    bar,
    note && h('div', { class: 'note' }, note),
    guide('map', [
      [h('b', null, 'Hover'), ' any room to scout it: its foes, formation and threat.'],
      [h('b', null, 'Click'), ' a glowing room (or press its number) to enter it.'],
      [h('b', null, 'Arrange'), ' your souls on the field grid, now or just before the battle.']]),
    h('div', { class: 'cols' },
      h('section', { class: 'panel mapcol' },
        h('h2', null, 'Route', h('span', { class: 'dim' }, ` · floor ${s.floor}`)),
        h('div', { class: 'dag', style: `height:${H}px` }, svg, nodes)),
      h('section', { class: 'panel side' },
        editor.el,
        h('h2', null, 'Relics'),
        relicList(s.relics))))
  return {
    el,
    key (e) {
      const n = reach[Number(e.key) - 1]
      if (n) onNode(n.id)
      else editor.key(e)
    }
  }
}

// ── prep ─────────────────────────────────────────────────────────────────────────────────────────

// The last look before a battle: their formation facing yours. Once it starts, it plays out alone.

export function prepScreen ({ run, act, onFight, onHelp }) {
  const s = run.state
  const node = currentNode(run)
  const bar = h('div', { class: 'bar-slot' })
  const meter = h('div')
  const refresh = () => { fill(bar, topbar(run, onHelp)); fill(meter, threatMeter(run, node)) }
  const editor = retinueEditor({ run, act, facing: node, onChange: refresh })
  refresh()
  const canGo = () => fielded(s.party).some((u) => u.hp > 0)
  const go = () => { if (canGo()) onFight() }
  const el = h('div', { class: 'screen prep-screen' },
    bar,
    guide('prep', [
      ['Their formation is on top, yours below. ', h('b', null, 'Hover'), ' any unit for its stats and abilities.'],
      [h('b', null, 'Click'), ' a soul, then a slot or another soul, to move or swap. Click the ossuary to bench the selected soul.'],
      ['They come from above. Your camp\'s ', h('b', null, 'walls'), ' block walking but not bolts. ', h('b', null, '◆'), ' marks a soul in a formation bond.'],
      ['Press ', h('b', null, 'Begin'), ' when ready. You cannot act once the battle starts.']]),
    h('div', { class: 'panel prep-head' },
      h('div', { class: 'ph-title' },
        h('span', { class: `room-ico t-${node.type}` }, icon(node.type, 22)),
        h('div', null,
          h('h2', null, ROOM[node.type].name),
          h('div', { class: 'dim' }, `${node.foes.length} foe${node.foes.length > 1 ? 's' : ''} · level ${node.foes[0].lvl}`),
          foeSynergyLine(node.foes))),
      meter,
      h('button', {
        class: 'primary big begin-btn',
        onclick: go,
        tip: () => canGo()
          ? h('div', { class: 'syn-tip' }, h('b', null, 'Begin the battle'), h('p', null, 'It plays out on its own: you cannot move or command anyone until it ends.'), h('p', { class: 'warn' }, 'Losing ends the run.'))
          : 'Place at least one standing soul on the field first.'
      }, icon('play', 16), ' Begin ', h('kbd', null, 'Enter'))),
    h('div', { class: 'panel' }, editor.el),
    h('section', { class: 'panel' }, h('h2', null, 'Relics'), relicList(s.relics)))
  return {
    el,
    key (e) {
      if (e.key === 'Enter') go()
      else editor.key(e)
    }
  }
}

// ── reap ─────────────────────────────────────────────────────────────────────────────────────────

export function reapScreen ({ run, title, act, onDone, onHelp }) {
  const s = run.state
  const el = h('div', { class: 'screen reap-screen' })
  const full = () => s.party.length >= TUNING.party.roster
  const take = (i) => {
    if (i !== null && s.offers[i]?.type === 'soul' && full()) return
    onDone(i)
  }
  const souls = s.offers.some((o) => o.type === 'soul')

  function render () {
    const cards = s.offers.map((o, i) => {
      const locked = o.type === 'soul' && full()
      const owned = o.type === 'soul' ? s.party.filter((u) => u.id === o.id && u.star === 1).length : 0
      return h('button', {
        class: `offer o-${o.type}` + (locked ? ' locked' : ''),
        onclick: () => take(i),
        'aria-disabled': locked ? 'true' : null,
        tip: () => o.type === 'soul'
          ? unitCard({ id: o.id, lvl: o.lvl, star: 1, slot: -1 }, {
            mods: partyMods(run),
            notes: [locked ? 'Your retinue is full: release a soul first.' : 'Click to bind this soul. It joins the field if there is room, else the ossuary.',
              owned && `You already hold ${owned}.${owned + 1 >= TUNING.star.copies ? ' Binding this one lets you merge them.' : ''}`]
          })
          : relicTip(o.id)
      },
      h('div', { class: 'offer-tag' }, h('kbd', null, i + 1), o.type === 'soul' ? ' Soul' : ' Relic'),
      h('div', { class: 'offer-art' }, o.type === 'soul' ? portrait(o.id, 100) : icon('reliquary', 48)),
      h('div', { class: 'offer-name' }, o.name),
      o.type === 'soul' && h('div', { class: 'dim' }, `${KIN[unitDef(o.id).kin].name} ${ROLES[unitDef(o.id).role].name} · level ${o.lvl}`),
      h('div', { class: 'offer-desc' }, o.type === 'soul'
        ? (owned ? `You hold ${owned}.${owned + 1 >= TUNING.star.copies ? ' This completes a merge!' : ''}` : 'New to your retinue.')
        : o.desc))
    })
    fill(el,
      topbar(run, onHelp),
      h('div', { class: 'center' },
        h('div', { class: 'reap-title' }, icon(souls ? 'soul' : 'reliquary', 30), h('h1', null, title)),
        h('p', { class: 'dim' }, souls ? 'The slain linger. Bind one soul to your retinue: hover a card for its full stats.' : 'Choose one relic. It lasts for the rest of the run.'),
        h('div', { class: 'offers' }, cards),
        h('button', { class: 'ghost', onclick: () => take(null), tip: () => 'Leave with nothing. (S)' }, 'Take nothing ', h('kbd', null, 'S')),
        full() && souls && h('p', { class: 'warn' }, `Your retinue is full (${TUNING.party.roster}). Release a soul below to make room.`),
        h('div', { class: 'panel' },
          h('h2', null, `Your retinue ${s.party.length}/${TUNING.party.roster}`),
          h('div', { class: 'units' }, s.party.slice().sort(fieldOrder).map((u) =>
            unitRow(run, u, full() && h('button', {
              class: 'danger small',
              onclick: () => { act({ type: 'release', uid: u.uid }); render() },
              tip: () => `Release ${unitDef(u.id).name} forever, freeing a place in your retinue. This can't be undone.`
            }, icon('release', 14), ' Release')))))))
  }

  render()
  return {
    el,
    key (e) {
      const i = Number(e.key) - 1
      if (s.offers[i]) take(i)
      else if (e.key === 's' || e.key === 'S' || e.key === 'Escape') take(null)
    }
  }
}

// ── end ──────────────────────────────────────────────────────────────────────────────────────────

export function endScreen ({ run, onNew }) {
  const s = run.state
  const won = s.result === 'victory'
  const el = h('div', { class: 'screen end-screen' },
    h('div', { class: 'center' },
      h('div', { class: 'sigil ' + (won ? 'win' : 'lose') }, icon(won ? 'boss' : 'elite', 54)),
      h('h1', { class: 'logo ' + (won ? 'win' : 'lose') }, won ? 'VICTORY' : 'DEFEAT'),
      h('p', { class: 'tagline' }, won ? 'The Hollow Sovereign falls, and its soul is yours.' : `Your retinue fell on floor ${s.floor}.`),
      h('div', { class: 'end-stats' },
        [['Floors cleared', `${s.stats.floorsCleared}/${TUNING.run.floors}`], ['Battles won', `${s.stats.wins}/${s.stats.fights}`],
          ['Souls reaped', s.stats.reaped], ['Merges', s.stats.merges], ['Relics', s.relics.length]]
          .map(([k, v]) => h('div', null, h('b', null, v), h('span', { class: 'dim' }, k)))),
      h('button', { class: 'primary big', onclick: onNew, tip: () => 'Start again with a new seed. (Enter)' }, 'New run ', h('kbd', null, 'Enter')),
      h('p', { class: 'dim' }, `seed ${s.seed}`),
      h('div', { class: 'panel' },
        h('h2', null, 'Final retinue'),
        h('div', { class: 'units' }, s.party.slice().sort(fieldOrder).map((u) => unitRow(run, u))))))
  return { el, key: (e) => { if (e.key === 'Enter') onNew() } }
}

// ── battle playback bar ──────────────────────────────────────────────────────────────────────────

// Under the battle canvas: pause, speed and skip. They change only how the battle is shown.

const SPEEDS = [1, 2, 4]

export function battleBar () {
  let scene = null
  let st = { paused: false, speed: 1, seconds: 0, over: false }
  const noFocus = (e) => e.preventDefault()
  const btn = (attrs, ...kids) => h('button', { tabindex: '-1', onmousedown: noFocus, ...attrs }, ...kids)

  const speeds = SPEEDS.map((n) => btn({ class: 'seg', onclick: () => scene?.setSpeed(n), tip: () => `Play at ${n}× speed. (${n})` }, `${n}×`))
  const pause = btn({ class: 'seg', onclick: () => scene?.togglePause(), tip: () => 'Pause or resume the playback. (Space)' })
  const skip = btn({ class: 'seg', onclick: () => scene?.skip(), tip: () => 'Skip to the result. The outcome is already decided. (S)' }, icon('skip', 14), ' Skip')
  const clock = h('span', { class: 'clock', tip: () => `Battle time. After ${TUNING.escalation.startTick * TUNING.tick.ms / 1000} s all damage ramps up so no fight stalls.` })
  const el = h('div', { class: 'battlebar' },
    h('div', { class: 'legend' },
      h('span', null, h('i', { class: 'lg hp' }), 'HP'),
      h('span', null, h('i', { class: 'lg gauge' }), 'gauge: acts when full'),
      h('span', { class: 'dim' }, 'Hover a unit for live stats.')),
    h('div', { class: 'controls' }, clock, pause, h('div', { class: 'segs' }, speeds), skip))

  function render () {
    SPEEDS.forEach((n, i) => speeds[i].classList.toggle('active', st.speed === n))
    fill(pause, icon(st.paused ? 'play' : 'pause', 14), st.paused ? ' Resume' : ' Pause')
    pause.classList.toggle('active', st.paused)
    clock.textContent = `${st.seconds.toFixed(0)}s`
  }
  render()

  return {
    el,
    attach (s) { scene = s },
    update (next) { st = next; render() },
    key (e) {
      if (!scene) return
      if (e.code === 'Space') scene.togglePause()
      else if (e.code === 'KeyS' || e.code === 'Escape') scene.skip()
      else if (['Digit1', 'Digit2', 'Digit4'].includes(e.code)) scene.setSpeed(Number(e.code.slice(5)))
      else return
      e.preventDefault()
    }
  }
}

// ── the retinue editor ───────────────────────────────────────────────────────────────────────────

// The camp, ossuary (bench), merges, synergies and bonds. Click a soul, then a cell or another soul, to
// move or swap them; click the ossuary to bench one. With `facing` (a battle room), its formation is
// drawn above your camp. onChange runs after every action it sends.

const FOE_ROW_LABEL = ['Front', 'Mid', 'Back']

function retinueEditor ({ run, act, facing = null, onChange = null }) {
  const s = run.state
  const el = h('div', { class: 'retinue' })
  let sel = null // { uid } or { slot } (an empty field slot)
  let error = ''

  // Every action clears the selection.
  function send (action) {
    error = act(action) ?? ''
    sel = null
    render()
    onChange?.()
  }

  function clickSlot (slot) {
    const o = s.party.find((u) => u.slot === slot)
    if (!sel) sel = o ? { uid: o.uid } : { slot }
    else if (sel.uid != null) {
      if (o?.uid === sel.uid) sel = null
      else return send({ type: 'place', uid: sel.uid, slot })
    } else if (o) return send({ type: 'place', uid: o.uid, slot: sel.slot })
    else sel = sel.slot === slot ? null : { slot }
    render()
  }

  function clickBench (u) {
    const picked = sel?.uid != null && s.party.find((x) => x.uid === sel.uid)
    if (picked && picked !== u && picked.slot >= 0) return send({ type: 'place', uid: u.uid, slot: picked.slot })
    if (sel?.slot != null) return send({ type: 'place', uid: u.uid, slot: sel.slot })
    sel = picked === u ? null : { uid: u.uid }
    render()
  }

  function clickOssuary () {
    const picked = sel?.uid != null && s.party.find((x) => x.uid === sel.uid)
    if (picked && picked.slot >= 0) send({ type: 'place', uid: picked.uid, slot: -1 })
  }

  const selected = () => sel?.uid != null && s.party.find((x) => x.uid === sel.uid)

  // What clicking here would do, given the current selection.
  function slotHint (slot, o) {
    const picked = selected()
    if (picked && o?.uid === picked.uid) return 'Click again to deselect.'
    if (picked) return o ? `Click to swap ${unitDef(picked.id).name} with ${unitDef(o.id).name}.` : `Click to move ${unitDef(picked.id).name} here.`
    if (sel?.slot != null && o) return `Click to move ${unitDef(o.id).name} into the selected slot.`
    return o ? 'Click to select, then click a slot or soul to move or swap.' : null
  }

  function soulTip (u, where, extra) {
    const copies = s.party.filter((x) => x.id === u.id && x.star === u.star).length
    const field = fielded(s.party)
    return unitCard(u, {
      mods: [...partyMods(run), ...bondMods(field, u)],
      notes: [
        where,
        ...bondNotes(field, u),
        u.hp <= 0 && 'Fallen: it will not fight until an altar raises it, or it is merged.',
        u.star < TUNING.star.max && copies > 1 && `You hold ${copies} of ${TUNING.star.copies} ${'★'.repeat(u.star)} needed to merge.`,
        extra]
    })
  }

  function render () {
    const cap = fieldCap(run)
    const field = fielded(s.party)
    const bench = benched(s.party)
    const merges = mergeable(s.party)
    const picked = selected()
    const bonded = new Set(activeBonds(field).map((b) => b.uid))
    const fieldGrid = []
    for (let r = 0; r < CAMP_ROWS; r++) {
      const cells = []
      for (let c = 0; c < COLS; c++) {
        const slot = slotAt(r, c)
        if (isWall(s.camp, slot)) {
          cells.push(h('div', { class: 'cell wall', tip: () => 'Wall. It blocks walking, yours and theirs, but not attacks.' }))
          continue
        }
        const u = field.find((x) => x.slot === slot)
        const isSel = sel && (sel.uid != null ? u?.uid === sel.uid : sel.slot === slot)
        cells.push(h('button', {
          class: 'cell' + (u ? ` has star${u.star}` : ' empty') + (isSel ? ' sel' : '') + (u && u.hp <= 0 ? ' fallen' : '') + (picked && !u ? ' drop' : ''),
          onclick: () => clickSlot(slot),
          tip: () => u
            ? soulTip(u, `In the camp: ${campRowLabel(r).toLowerCase()}.`, slotHint(slot, u))
            : h('div', { class: 'syn-tip' },
              h('b', null, `Open ground: ${campRowLabel(r).toLowerCase()}`),
              h('p', null, campRowText(r)),
              h('p', { class: 'dim' }, slotHint(slot, null) ?? (field.length >= cap ? `The field is full (${cap}). Swap a soul in instead.` : 'Select a soul, then click here to move it.')))
        }, u ? cellBody(u, bonded.has(u.uid)) : null))
      }
      fieldGrid.push(h('div', { class: 'row' }, h('span', { class: 'rowname', tip: () => `${campRowLabel(r)}. ${campRowText(r)}` }, campRowLabel(r)), cells))
    }
    fill(el,
      h('div', { class: 'board' },
        facing && [
          h('div', { class: 'gridlabel foe' }, 'Their formation'),
          foeGrid(run, facing),
          h('div', { class: 'vs' }, h('span', null, 'VS'))],
        h('div', { class: 'gridlabel', tip: () => 'Your camp on this floor. Each floor draws a different one.' }, `Your camp: ${campDef(s.camp).name} `, h('span', { class: 'dim' }, `${field.length}/${cap} · ${field.filter((u) => u.hp > 0).length} standing`)),
        h('div', { class: 'grid' }, fieldGrid)),
      h('div', { class: 'tray' },
        h('h2', { tip: () => 'Souls here are kept but do not fight or gain XP. Swap them onto the field at any time before a battle.' },
          'Ossuary ', h('span', { class: 'dim' }, `${bench.length} · benched souls do not fight`)),
        h('div', {
          class: 'bench' + (picked && picked.slot >= 0 ? ' target' : ''),
          onclick: (e) => { if (e.target === e.currentTarget) clickOssuary() },
          tip: () => picked && picked.slot >= 0 ? `Click empty space here to bench ${unitDef(picked.id).name}.` : 'Benched souls. Select a soul on the field, then click here to bench it.'
        },
        bench.length
          ? bench.map((u) => h('button', {
            class: `cell has star${u.star}` + (picked === u ? ' sel' : '') + (u.hp <= 0 ? ' fallen' : ''),
            onclick: () => clickBench(u),
            tip: () => soulTip(u, 'In the ossuary: does not fight or gain XP.',
              picked && picked !== u && picked.slot >= 0 ? `Click to swap it with ${unitDef(picked.id).name} on the field.` : picked === u ? 'Click again to deselect.' : 'Click to select, then click a field slot to place it.')
          }, cellBody(u)))
          : h('span', { class: 'dim empty-bench', onclick: clickOssuary }, picked ? 'Click here to bench the selected soul.' : 'Empty.')),
        merges.length > 0 && h('div', { class: 'merges' }, merges.map((m) =>
          h('button', { class: 'merge', onclick: () => send({ type: 'merge', ...m }), tip: () => mergeTip(s.party, m) },
            icon('merge', 16), portrait(m.id, 26), ` Merge ${unitDef(m.id).name} `, h('span', { class: 'stars' }, '★'.repeat(m.star + 1))))),
        error && h('p', { class: 'warn' }, error),
        h('h2', null, 'Synergies'),
        synergyTracker(field),
        h('h2', null, 'Bonds'),
        bondTracker(field)))
  }

  render()
  return {
    el,
    key (e) {
      if (e.key === 'Escape' && sel) { sel = null; render() }
    }
  }
}

// ── parts ────────────────────────────────────────────────────────────────────────────────────────

// Field first, front to back, then the bench.
const fieldOrder = (a, b) => (a.slot < 0) - (b.slot < 0) || a.slot - b.slot || a.uid - b.uid

function hpBar (u) {
  const pct = Math.max(0, Math.min(1, u.hp / u.maxHp))
  return h('span', { class: 'hpbar' + (pct <= 0 ? ' dead' : pct < 0.35 ? ' low' : '') }, h('span', { style: `width:${pct * 100}%` }))
}

function unitRow (run, u, extra = null) {
  const d = unitDef(u.id)
  return h('div', { class: 'unit' + (u.hp <= 0 ? ' fallen' : ''), tip: () => unitCard(u, { mods: partyMods(run) }) },
    h('span', { class: `cell-port star${u.star}` }, portrait(u.id, 32, u.hp <= 0)),
    h('div', { class: 'grow' },
      h('div', null, h('b', null, d.name), u.star > 1 && h('span', { class: 'stars' }, ' ' + '★'.repeat(u.star)), ` Lv ${u.lvl}`,
        h('span', { class: 'dim' }, ` · ${KIN[d.kin].name} ${ROLES[d.role].name}${u.slot < 0 ? ' · ossuary' : ` · ${campRowLabel(rowOf(u.slot)).toLowerCase()}`}`)),
      h('div', { class: 'line' }, hpBar(u), h('span', { class: 'dim' }, u.hp > 0 ? `${u.hp}/${u.maxHp}` : 'fallen'))),
    extra)
}

function cellBody (u, bonded = false) {
  return [
    bonded && h('span', { class: 'bond-mark' }, '◆'),
    portrait(u.id, 46, u.hp <= 0),
    h('span', { class: 'badge' }, u.star > 1 && h('span', { class: 'stars' }, '★'.repeat(u.star)), ` ${u.lvl}`),
    u.maxHp && hpBar(u)]
}

// The foes' formation, read-only, front row at the bottom so it faces yours.
function foeGrid (run, node) {
  const mods = roomFoeMods(run, node)
  // Scouted foes have no uid yet; their slot stands in for one.
  const foes = node.foes.map((f) => ({ ...f, uid: f.slot, star: 1 }))
  const at = new Map(foes.map((f) => [f.slot, f]))
  const bonded = new Set(activeBonds(foes).map((b) => b.uid))
  const rows = []
  for (let r = ROWS - 1; r >= 0; r--) {
    const cells = []
    for (let c = 0; c < COLS; c++) {
      const u = at.get(slotAt(r, c))
      cells.push(h('div', {
        class: 'cell foe' + (u ? ' has' : ' empty'),
        tip: u ? () => unitCard(u, { mods: [...mods, ...bondMods(foes, u)], foe: true, notes: [`Enemy, ${FOE_ROW_LABEL[r].toLowerCase()} row. Stats include this floor's multipliers and their synergies.`, ...bondNotes(foes, u)] }) : null
      }, u && [bonded.has(u.uid) && h('span', { class: 'bond-mark' }, '◆'), portrait(u.id, 46), h('span', { class: 'badge' }, ` ${u.lvl}`)]))
    }
    rows.push(h('div', { class: 'row' }, h('span', { class: 'rowname foe' }, FOE_ROW_LABEL[r]), cells))
  }
  return h('div', { class: 'grid foes' }, rows)
}

function relicList (ids) {
  if (!ids.length) return h('p', { class: 'dim' }, 'None yet. Relics come from reliquaries and elites.')
  return h('div', { class: 'relics' }, ids.map((id) =>
    h('span', { class: 'relic', tip: () => relicTip(id) }, icon('reliquary', 14), relicDef(id).name)))
}
