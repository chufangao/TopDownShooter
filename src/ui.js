// The DOM side: title, floor map, prep, reap and end screens, the playback bar under the battle canvas,
// and the parts they share. Screens only read run.state and report input upward; the retinue editor
// sends its actions through act(action), which returns an error message or null. Every control has a
// tooltip saying exactly what it does (rules text lives in codex.js).
import { TUNING } from './tuning.js'
import {
  availableNodes, fieldCap, rosterCap, fielded, benched, currentNode, levelCost, tierCost, souls, isMonarch, monarchOf, monarchCost,
  MONARCH_STATS, faltersAt, canLead, freeBodies, standingOf, musterCost, bindCost, DEFAULT_PLAN, isSquare, waits, detachmentOf,
  promoteNeed, kinStanding, feedOf, canPromote, canAdvance, nextTier, holds, domainCentre, keptShadows, essenceByWave, canDescend, depthOf, cohortCap
} from './sim/run.js'
import { RANKS, WIDTH } from './sim/map.js'
import { unitDef, relicDef, campDef, KIN, ROLES, SHAPES, ORDERS, GRADES, keystoneDef, abilityDef } from './content.js'
import {
  COLS, ROWS, CAMP_ROWS, slotAt, rowOf, colOf, activeBonds, isWall, pathsOf, pathDef, baseStats, LANES, DEPTH, tileAt, deployTile, wallTiles, onField,
  distance, tileY, pathsClash, sealedBy, neighbours, isAllyShape, rangeOf
} from './sim/unit.js'
import { h, fill, icon, portrait, prefs } from './dom.js'
import {
  unitCard, partyMods, roomFoeMods, roomTip, threatMeter, foeSynergyLine, synergyTracker, bondTracker, bondMods, bondNotes, relicTip, ROOM,
  campRowLabel, campRowText, pathTiers, ROMAN, realmOf, MONARCH_TEXT, monarchPointText, deathText, tileText, fieldRule, armyOf, ARMY_TEXT, bodies,
  leadsText, armyCount, ORDER_TEXT, planText, whenText, whenTag, isHeld, takesPart,
  GRADE_ICON, RANK_TEXT, clashText, marshalOf, startsFaltering, SECOND_TIERS, keystoneTip, aliasOf, TRIGGER_TEXT,
  foeCountText, waveName, waveWhen, cohortSizes, ENEMY_TEXT, DEEP_TEXT
} from './codex.js'

// ── title ────────────────────────────────────────────────────────────────────────────────────────

export function titleScreen ({ seed, onStart, onHelp }) {
  const input = h('input', { value: seed, spellcheck: 'false', 'aria-label': 'seed' })
  const start = () => onStart(input.value.trim() || seed)
  const step = (ico, title, text) => h('div', { class: 'step' }, h('div', { class: 'step-ico' }, icon(ico, 26)), h('b', null, title), h('p', null, text))
  const el = h('div', { class: 'screen title-screen' },
    h('div', { class: 'title-box' },
      h('div', { class: 'sigil' }, icon('soul', 54)),
      h('h1', { class: 'logo' }, 'RETINUE'),
      h('p', { class: 'tagline' }, 'You are the Monarch, a necromancer, and the dead fight for you.', h('br'), 'Descend four floors and unmake the Hollow Sovereign, then go on into the deep for as long as you last.'),
      h('div', { class: 'steps four' },
        step('crown', 'Stand', `You stand in your own camp and never strike. Souls within your domain (${TUNING.monarch.domain} tiles) fight at full strength; beyond it they falter. If you fall, the run ends.`),
        step('fight', 'Scout', 'Hover rooms on the map to see the foes waiting inside: their formation, their captains, and the waves behind them. What they will do, you learn by fighting.'),
        step('start', 'Arrange', `Place yourself and up to ${TUNING.party.field} souls (more with Command) in the camp, each a captain that may lead a cohort of bodies, and give them orders: hold, move, or wait behind the camp. Once a battle begins, it plays out on its own.`),
        step('soul', 'Reap', 'Slain foes pay essence, and their bodies may be bound as rank-and-file. Spend it on souls, the muster and your Dominion, Command and Will. In battle you raise the fallen as shadows.')),
      h('div', { class: 'title-actions' },
        h('button', { class: 'primary big', onclick: start, tip: () => 'Start a new run with this seed. (Enter)' }, 'Begin the descent ', h('kbd', null, 'Enter')),
        h('button', { class: 'ghost', onclick: onHelp, tip: () => 'Rules, the board, synergies and relics. (H)' }, icon('help'), ' How to play')),
      h('label', { class: 'seed', tip: () => 'The same seed always makes the same maps, foes and battles. Share one to play the same run.' }, 'seed ', input)))
  return { el, key: (e) => { if (e.key === 'Enter') start() } }
}

// ── shared chrome ────────────────────────────────────────────────────────────────────────────────

function topbar (run, onHelp) {
  const s = run.state
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, icon('soul', 20), h('span', null, 'RETINUE')),
    floorPips(s),
    h('div', { class: 'chips' },
      h('span', { class: 'chip-stat essence', tip: () => `Essence: slain foes pay it. Spend it on your souls, the Monarch and the ossuary. ${s.stats.essence} earned, ${s.stats.spent} spent this run.` },
        icon('soul', 14), h('b', null, s.essence)),
      monarchChip(run)),
    h('button', { class: 'icon-btn', onclick: onHelp, tip: () => 'How to play (H)' }, icon('help', 20)))
}

// The floors: a pip each down to the Sovereign's, lit as they are cleared; past it, in the deep, a deep pip
// and how far down the run has gone.
function floorPips (s) {
  const n = TUNING.run.floors
  const deep = depthOf(s.floor)
  return h('div', {
    class: 'floors' + (deep ? ' deep' : ''),
    tip: () => deep
      ? h('div', { class: 'syn-tip' }, h('b', null, `Floor ${s.floor} · the deep, ${deep} floor${deep === 1 ? '' : 's'} below the Sovereign's`), h('p', null, 'The run is cleared: the Hollow Sovereign fell to you, and that stands.'),
        h('p', null, DEEP_TEXT.now(s.floor)), h('p', { class: 'dim' }, DEEP_TEXT.growth), h('p', { class: 'warn' }, DEEP_TEXT.fall))
      : `Floor ${s.floor} of ${n}. Each floor ends in an elite; floor ${n} ends with the Hollow Sovereign, and slaying it clears the run. Past it, you may descend into the deep.`
  },
  Array.from({ length: n }, (_, i) => h('span', { class: 'pip' + (i + 1 < s.floor ? ' done' : i + 1 === s.floor ? ' now' : '') })),
  deep > 0 && h('span', { class: 'pip deep now' }),
  h('span', null, deep ? `Floor ${s.floor} · deep ${deep}` : `Floor ${s.floor}`))
}

// The Monarch's HP, always in view: if it falls, the run ends.
function monarchChip (run) {
  const m = monarchOf(run.state)
  const low = m.hp / m.maxHp < 0.35
  return h('span', {
    class: 'chip-stat monarch' + (low ? ' low' : ''),
    tip: () => unitCard(m, {
      mods: partyMods(run, m),
      realm: realmOf(run),
      notes: [holds(run.state, 'unhealable')
        ? 'The Monarch is you. Its wounds carry from battle to battle, and under Court of Bone nothing heals them: not a win, not an altar.'
        : 'The Monarch is you. Its wounds carry from battle to battle: it heals like a soul after a win and at altars.']
    })
  }, icon('crown', 14), h('span', { class: 'dim' }, `Lv ${m.lvl}`), h('b', null, `${m.hp}/${m.maxHp}`))
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

// A row of tabs: [{ id, name, count?, key? }]. `count` is a small badge, shown when above 0; `key` its shortcut.
function tabBar (tabs, on, pick, cls = '') {
  return h('div', { class: 'tabs ' + cls, role: 'tablist' }, tabs.map((t) => h('button', {
    class: 'tab' + (t.id === on ? ' on' : ''), role: 'tab', 'aria-selected': t.id === on ? 'true' : 'false',
    onclick: () => pick(t.id), tip: t.tip
  }, t.name, t.count > 0 && h('span', { class: 'tab-count' }, t.count), t.key && h('kbd', null, t.key))))
}

// ── map ──────────────────────────────────────────────────────────────────────────────────────────

const NODE_W = 400
const ROW_H = 64
const H = RANKS * ROW_H
const LANE_W = (NODE_W - 100) / (WIDTH - 1)
const pos = (n) => ({ x: 50 + n.lane * LANE_W, y: (RANKS - 1 - n.rank) * ROW_H + ROW_H / 2 })

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

  // A floor is taller than the screen: the route scrolls, and opens on the room you stand in.
  const scroller = h('div', { class: 'dag-scroll' }, h('div', { class: 'dag', style: `height:${H}px` }, svg, nodes))

  // Two tabs: the route, with the retinue's wounds beside it; and the camp, to arrange and spend between rooms.
  let tab = 'route'
  const body = h('div')
  const show = (id) => {
    tab = id
    fill(body,
      tabBar([
        { id: 'route', name: 'Route', key: 'R', tip: () => 'The floor\'s rooms: scout them and pick the next. (R)' },
        { id: 'camp', name: 'Camp', key: 'C', tip: () => 'Arrange your souls and spend essence before the next room. (C)' }], tab, show, 'screen-tabs'),
      tab === 'route'
        ? h('div', { class: 'cols' },
          h('section', { class: 'panel mapcol' },
            h('h2', null, 'Route', h('span', { class: 'dim' }, ` · floor ${s.floor}${depthOf(s.floor) ? ` · deep ${depthOf(s.floor)}` : ''}`)),
            scroller),
          h('section', { class: 'panel side' },
            h('h2', null, `Your retinue ${souls(s.party).length}/${rosterCap(run)}`),
            h('div', { class: 'units' }, s.party.slice().sort(fieldOrder).map((u) => unitRow(run, u)))))
        : h('div', { class: 'panel camp-panel' }, editor.el))
    if (tab === 'route') requestAnimationFrame(() => { scroller.scrollTop = pos(currentNode(run)).y - scroller.clientHeight / 2 })
  }
  show('route')

  const el = h('div', { class: 'screen map-screen' },
    bar,
    note && h('div', { class: 'note' }, note),
    guide('map', [
      [h('b', null, 'Hover'), ' a room to scout it.'],
      [h('b', null, 'Click'), ' a glowing room (or press its number) to enter it.'],
      ['Open ', h('b', null, 'Camp'), ' to arrange your souls.']]),
    body)
  return {
    el,
    key (e) {
      const n = reach[Number(e.key) - 1]
      if (n) onNode(n.id)
      else if (e.key === 'r' || e.key === 'R') show('route')
      else if (e.key === 'c' || e.key === 'C') show('camp')
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
  // What the Begin tooltip warns of: no soul to fight for the Monarch, souls that will falter (a held
  // detachment enters beside the Monarch, so it is not counted), or a Move square past the domain.
  const warnings = () => {
    const field = souls(fielded(s.party)).filter((u) => u.hp > 0)
    const out = field.filter((u) => !isHeld(s, u) && startsFaltering(s, u))
    const outM = armyOf(run).members.filter((u) => startsFaltering(s, u))
    const centre = deployTile('party', domainCentre(s))
    const far = s.detachments.filter((d) => takesPart(s, d) && oneWay(s, d, centre, realmOf(run).domain))
    return [
      !field.length && 'No soul stands on the field: the Monarch fights alone, and it never strikes.',
      field.length > 0 && field.every((u) => isHeld(s, u)) && 'Every soul is held behind the camp: the Monarch starts the battle alone.',
      out.length > 0 && `${out.length} of your souls stand${out.length === 1 ? 's' : ''} outside the domain and will falter (×${TUNING.monarch.falter} damage).`,
      outM.length > 0 && `${outM.length} cohort member${outM.length === 1 ? ' stands' : 's stand'} outside the domain and will falter.`,
      far.length > 0 && (far.length === 1
        ? `Detachment ${far[0].id} moves to a square outside the domain: a one-way trip. It drops its plan the moment it steps out, and Hunts from there.`
        : `Detachments ${far.map((d) => d.id).join(' and ')} move to squares outside the domain: one-way trips. Each drops its plan the moment it steps out, and Hunts from there.`)].filter(Boolean)
  }
  // The foes still to come: how many, in how many waves (when each comes is on their previews).
  const wavesNote = () => {
    const w = node.waves ?? []
    const n = w.reduce((m, x) => m + x.foes.length, 0)
    return n > 0 && `${n} more ${n === 1 ? 'foe' : 'foes'} will come over the far edge after the battle begins, in ${w.length === 1 ? (w[0].when.at === 'time' ? 'a late pair' : 'one more wave') : `${w.length} more waves`}.`
  }
  const reserveNote = () => {
    const { reserve, held } = armyOf(run)
    const n = reserve.length
    const ds = [...new Set(held.map((b) => b.det))].map((id) => s.detachments.find((d) => d.id === id))
    return [n > 0 && `${n} bod${n === 1 ? 'y waits' : 'ies wait'} in reserve behind the camp, entering beside the Monarch one at a time as your bodies on the board fall below ${TUNING.army.board}.`,
      ds.length > 0 && `Held behind the camp, off the board: ${ds.map((d) => {
        const k = held.filter((b) => b.det === d.id).length
        return `detachment ${d.id} (${k} bod${k === 1 ? 'y' : 'ies'}, captains included) enters ${whenText(d.plan.when)}`
      }).join('; ')}. Once called, they enter ahead of the reserve.`].filter(Boolean)
  }
  const el = h('div', { class: 'screen prep-screen' },
    bar,
    guide('prep', [
      [h('b', null, 'Click'), ' a soul, then a cell, to move it. ', h('b', null, 'Hover'), ' anything for details.'],
      [h('b', null, 'Shift-click'), ' souls to give them orders.'],
      ['Keep souls inside the ', h('b', null, holds(s, 'crown') ? 'gold' : 'green'), ' domain, or they falter.'],
      ['Press ', h('b', null, 'Begin'), '. ', h('b', null, 'If the Monarch falls, the run ends.')]]),
    h('div', { class: 'panel prep-head' },
      h('div', { class: 'ph-title' },
        h('span', { class: `room-ico t-${node.type}` }, icon(node.type, 22)),
        h('div', null,
          h('h2', null, ROOM[node.type].name),
          h('div', { class: 'dim' }, `${foeCountText(node)} · level ${node.foes[0].lvl}`),
          foeSynergyLine(node.foes, run))),
      meter,
      h('button', {
        class: 'primary big begin-btn',
        onclick: go,
        tip: () => canGo()
          ? h('div', { class: 'syn-tip' }, h('b', null, 'Begin the battle'), h('p', null, 'It plays out on its own: you cannot move or command anyone until it ends.'),
            warnings().map((w) => h('p', { class: 'warn' }, w)),
            reserveNote().map((n) => h('p', { class: 'dim' }, n)),
            wavesNote() && h('p', { class: 'dim' }, wavesNote()),
            h('p', { class: 'warn' }, `Losing ends the run: the Monarch falling loses at once, and so does a battle still undecided ${TUNING.tick.ceiling * TUNING.tick.ms / 1000} s after the start, or after the last foe entered.`))
          : 'The Monarch has fallen.'
      }, icon('play', 16), ' Begin ', h('kbd', null, 'Enter'))),
    h('div', { class: 'panel' }, editor.el))
  return {
    el,
    key (e) {
      if (e.key === 'Enter') go()
      else editor.key(e)
    }
  }
}

// ── reap ─────────────────────────────────────────────────────────────────────────────────────────

// An offer's number key: 1 to 9, then 0 for the tenth (an elite can lay out ten); none past that.
const offerKey = (i) => (i < 9 ? i + 1 : i === 9 ? 0 : null)

// onDone(index): take offer `index`, or null to move on. onBind(id, count): bind that many of a kind.
export function reapScreen ({ run, title, act, onDone, onBind, onHelp }) {
  const s = run.state
  const el = h('div', { class: 'screen reap-screen' })
  const full = () => souls(s.party).length >= rosterCap(run)
  const blocked = (o) => o.type === 'soul' && (full() ? 'full' : o.cost > s.essence ? 'poor' : null)
  // How many of each bind offer's kind to bind: by default every free one it can take, else one.
  const picks = new Map()
  const picked = (o) => Math.max(1, Math.min(o.max, picks.get(o.id) ?? (s.freeBinds || 1)))
  const bindPoor = (o) => bindCost(run, o.id, picked(o)) > s.essence
  // A bind offer is taken by binding (its picked count), never by `reap`.
  const take = (i) => {
    const o = i === null ? null : s.offers[i]
    if (o?.type === 'bind') return bindPoor(o) ? null : onBind(o.id, picked(o))
    if (o && blocked(o)) return
    onDone(i)
  }
  const has = (type) => s.offers.some((o) => o.type === type)
  // Hollow Court: the shadows that stood at the end of the battle just won joined the ossuary (if it was
  // fought under the keystone: one taken here keeps nothing of it), in any battle room that ends in spoils
  // (a siege's too). A reliquary's or a rite's spoils follow no battle: run.battle is still the last one's.
  const shades = ['fight', 'elite', 'siege'].includes(currentNode(run).type) ? keptShadows(run) : []
  const kept = shades.length > 0 && `Hollow Court: ${shades.length} shadow${shades.length === 1 ? '' : 's'} stayed, standing in your ossuary now: ` +
    `${Object.entries(Object.groupBy(shades, (u) => u.id)).map(([id, us]) => bodies(id, us.length)).join(', ')}.`
  const lede = [
    has('relic') && 'Choose one relic, free. It lasts for the rest of the run.',
    has('tier') && 'Choose one soul to advance along its path, free.',
    has('keystone') && `Choose one keystone, free. It rewrites a rule for the rest of the run (${s.keystones.length} of ${TUNING.keystone.max} held).`,
    has('soul') && 'The slain linger: recruit one of them as a soul for essence, at the level it fought at.',
    has('bind') && (s.freeBinds > 0
      ? `Bind the slain as rank-and-file into the ossuary: ${s.freeBinds === 1 ? '1 more bind is' : `${s.freeBinds} more binds are`} free (1 + Will a battle), then ${TUNING.army.bindPerTier} × tier essence each.`
      : `Bind the slain as rank-and-file into the ossuary, ${TUNING.army.bindPerTier} × tier essence each: the free binds (1 + Will a battle) are spent.`)].filter(Boolean).join(' ')
  // A battle of waves (a siege's) paid each wave as it fell: what each paid, relics included.
  const node = currentNode(run)
  const paid = node.waves?.length && run.battle ? essenceByWave(run.battle) : null
  const boost = 1 + s.relics.reduce((n, id) => n + (relicDef(id).essence ?? 0), 0)
  const wavePay = paid && h('p', { class: 'wave-pay', tip: () => 'Every foe slain paid essence into one purse; this is what each wave paid of it, relics included.' },
    icon('soul', 14), ' Paid wave by wave: ', paid.map((v, k) => [k ? ' · ' : '', k ? waveName(node, k - 1) : 'Wave 1', ' ', h('b', null, Math.round(v * boost))]))

  // A kind of slain foe to bind: how many (1 to all that fell), which of them are free, the price of the rest.
  function bindCard (o, i) {
    const d = unitDef(o.id)
    const n = picked(o)
    const cost = bindCost(run, o.id, n)
    const free = Math.min(n, s.freeBinds)
    const poor = cost > s.essence
    const set = (k) => { picks.set(o.id, Math.max(1, Math.min(o.max, k))); render() }
    const step = (label, k, why) => h('button', {
      class: 'small step-btn', 'aria-disabled': k < 1 || k > o.max ? 'true' : null,
      onclick: () => { if (k >= 1 && k <= o.max) set(k) }, tip: () => why
    }, label)
    const leaders = souls(s.party).filter((u) => canLead(u, o.id)).map((u) => unitDef(u.id).name)
    return h('div', {
      class: 'offer o-bind' + (poor ? ' locked' : ''),
      tip: () => unitCard({ id: o.id, lvl: s.muster, path: null, tier: 0, slot: -1, rank: true }, {
        mods: partyMods(run),
        notes: [ARMY_TEXT.bind(run), `Bound bodies stand in the ossuary and fight at the muster level (${s.muster}), whatever level they fell at.`,
          leaders.length ? `Your souls that can lead them (${leadsText(o.id)}): ${[...new Set(leaders)].join(', ')}.` : `None of your souls can lead them yet: a captain leads bodies of its own kin or role (${leadsText(o.id)}).`]
      })
    },
    h('div', { class: 'offer-tag' }, offerKey(i) !== null && h('kbd', null, offerKey(i)), ' Bind'),
    h('div', { class: 'offer-art' }, portrait(o.id, 84)),
    h('div', { class: 'offer-name' }, d.name),
    h('div', { class: 'dim' }, `${KIN[d.kin].name} ${ROLES[d.role].name} · ${o.max} left to bind`),
    h('div', { class: 'offer-desc' }, standingOf(s, o.id) ? `${standingOf(s, o.id)} stand in your ossuary.` : 'New to your ossuary.'),
    h('div', { class: 'stepper' },
      step('−', n - 1, 'Bind one fewer.'), h('b', null, n), step('+', n + 1, n >= o.max ? `Only ${o.max} ${o.max === 1 ? 'is' : 'are'} left to bind.` : 'Bind one more.'),
      o.max > 1 && n < o.max && h('button', { class: 'small link', onclick: () => set(o.max), tip: () => `Bind all ${o.max}.` }, 'all')),
    h('div', { class: 'dim small' }, [free && `${free} free`, n - free > 0 && `${n - free} × ${TUNING.army.bindPerTier * d.tier}`].filter(Boolean).join(' + ')),
    h('button', {
      class: 'buy bind-btn' + (poor ? ' poor' : ''), 'aria-disabled': poor ? 'true' : null,
      onclick: () => take(i),
      tip: () => poor ? `You need ${cost} essence; you have ${s.essence}.` : `Bind ${bodies(o.id, n)} into the ossuary, standing${cost ? `, for ${cost} essence` : ', free'}.${offerKey(i) !== null ? ` (${offerKey(i)})` : ''}`
    }, `Bind ${n} `, h('span', { class: 'price' }, cost ? [icon('soul', 12), cost] : 'free')))
  }

  function card (o, i) {
    if (o.type === 'bind') return bindCard(o, i)
    const why = blocked(o)
    const owned = o.type === 'soul' ? s.party.filter((u) => u.id === o.id).length : 0
    const soul = o.type === 'tier' ? s.party.find((u) => u.uid === o.uid) : null
    // A Knight's or Marshal's rite may offer its second path: its tiers held are tier2, three at most.
    const second = soul?.path && o.path !== soul.path
    // Which soul a path offer is for (the retinue may hold several of its kind): its level, rank and where it
    // stands.
    const who = soul && `Level ${soul.lvl}${soul.grade ? ` ${GRADES[soul.grade].name}` : ''}, ${onField(soul) ? tileText(deployTile('party', soul.slot)).replace('your camp, ', '') : 'on the bench'}`
    const tip = o.type === 'soul'
      ? () => unitCard({ id: o.id, lvl: o.lvl, path: null, tier: 0, slot: -1 }, {
        mods: partyMods(run),
        notes: [why === 'full' ? 'Your retinue is full: release a soul first.' : why === 'poor' ? `You need ${o.cost} essence; you have ${s.essence}.` : `Click to recruit it for ${o.cost} essence. It joins the field if there is room, else the bench.`,
          owned && `You already hold ${owned}.`]
      })
      : o.type === 'relic' ? () => relicTip(o.id)
        : o.type === 'keystone' ? () => h('div', null, keystoneTip(o.id, run), h('p', { class: 'dim' }, `Click to take it, free.${offerKey(i) !== null ? ` (${offerKey(i)})` : ''}`))
          : () => h('div', { class: 'syn-tip' }, h('b', null, o.name), h('p', { class: 'dim' }, `For your ${unitDef(soul.id).name}: ${who.toLowerCase()}.`),
            second ? pathTiers(pathDef(soul.id, o.path), soul.tier2, SECOND_TIERS) : pathTiers(pathDef(soul.id, o.path), soul.tier), h('p', { class: 'dim' },
              second ? (soul.path2 ? 'Click to grant the next tier of its second path, free.' : `Click to take it as a second path, on top of ${pathDef(soul.id, soul.path).name}, and grant tier I, free.`)
                : soul.path ? 'Click to grant the next tier, free.' : 'Click to commit it to this path and grant tier I, free.'),
            // A Knight's tier IV or second path's tier I rules out the other: say so on either.
            soul.grade === 1 && (second || nextTier(soul, o.path) === 3) && h('p', { class: 'dim' }, RANK_TEXT.knight))
    return h('button', { class: `offer o-${o.type}` + (why ? ' locked' : ''), onclick: () => take(i), 'aria-disabled': why ? 'true' : null, tip },
      h('div', { class: 'offer-tag' }, offerKey(i) !== null && h('kbd', null, offerKey(i)), { soul: ' Recruit', relic: ' Relic', tier: ' Path', keystone: ' Keystone' }[o.type]),
      h('div', { class: 'offer-art' }, o.type === 'relic' ? icon('reliquary', 48) : o.type === 'keystone' ? icon('keystone', 48) : portrait(o.type === 'soul' ? o.id : soul.id, 100)),
      h('div', { class: 'offer-name' }, o.name),
      o.type === 'soul' && h('div', { class: 'dim' }, `${KIN[unitDef(o.id).kin].name} ${ROLES[unitDef(o.id).role].name} · level ${o.lvl}`),
      o.type === 'tier' && h('div', { class: 'dim' }, who),
      o.type === 'relic' && relicDef(o.id).on && h('div', { class: 'trig-tag' }, TRIGGER_TEXT[relicDef(o.id).on].name),
      h('div', { class: 'offer-desc' }, o.type === 'soul' ? (owned ? `You hold ${owned}.` : 'New to your retinue.') : o.desc),
      h('div', { class: 'offer-price' + (why === 'poor' ? ' poor' : '') }, o.type === 'soul' ? [icon('soul', 12), ` ${o.cost}`] : 'Free'))
  }

  function render () {
    fill(el,
      topbar(run, onHelp),
      h('div', { class: 'center' },
        h('div', { class: 'reap-title' }, icon(has('soul') || has('bind') ? 'soul' : has('tier') ? 'rite' : has('keystone') && !has('relic') ? 'keystone' : 'reliquary', 30), h('h1', null, title)),
        h('p', { class: 'dim' }, lede),
        kept && h('p', { class: 'note-line' }, kept),
        wavePay,
        h('div', { class: 'offers' }, s.offers.map(card)),
        h('button', { class: 'ghost', onclick: () => take(null), tip: () => `Leave what is left and go on.${has('bind') ? ' The slain left unbound are lost.' : ''} (S)` }, 'Move on ', h('kbd', null, 'S')),
        full() && has('soul') && h('p', { class: 'warn' }, `Your retinue is full (${rosterCap(run)}). Release a soul below to make room.`),
        h('div', { class: 'panel' },
          h('h2', null, `Your retinue ${souls(s.party).length}/${rosterCap(run)}`),
          h('div', { class: 'units' }, s.party.slice().sort(fieldOrder).map((u) =>
            unitRow(run, u, full() && has('soul') && !isMonarch(u) && h('button', {
              class: 'danger small',
              onclick: () => { act({ type: 'release', uid: u.uid }); render() },
              tip: () => `Release ${unitDef(u.id).name} forever, freeing a place in your retinue. This can't be undone.`
            }, icon('release', 14), ' Release')))))))
  }

  render()
  return {
    el,
    key (e) {
      const i = e.key === '0' ? 9 : Number(e.key) - 1
      if (s.offers[i]) take(i) // a bind offer binds the count picked on its card
      else if (e.key === 's' || e.key === 'S' || e.key === 'Escape') take(null)
    }
  }
}

// ── end ──────────────────────────────────────────────────────────────────────────────────────────

// Three ends. The Sovereign slain (over, 'victory', no death): the run is cleared, and the deep lies below
// (Descend, or stop here with a new run). A fall in the deep after that clear ('victory' with a death): the
// clear stands. A defeat on the way down: as it was.
export function endScreen ({ run, onNew, onDescend }) {
  const s = run.state
  const won = s.result === 'victory'
  const lost = s.death
  const descend = canDescend(s)
  const deep = depthOf(s.floor)
  const n = TUNING.run.floors
  const cleared = Math.min(s.stats.floorsCleared, n)
  const deeper = s.stats.floorsCleared - cleared
  const fell = lost?.reason === 'tick-ceiling' ? 'a battle dragged on past its last moment, and the dark took you' : 'the Monarch fell'
  const tagline = descend ? 'The Hollow Sovereign falls, its court crumbles to dust with it, and its soul is yours. The run is cleared, and that stands whatever comes next.'
    : won ? `The Hollow Sovereign fell to you. Then, on floor ${s.floor}, ${deep} floor${deep === 1 ? '' : 's'} below it, ${fell}. The clear stands.`
      : lost?.reason === 'tick-ceiling' ? `On floor ${s.floor} the battle dragged on past its last moment, and the dark took you.`
        : `The Monarch fell on floor ${s.floor}, and the run with it.`
  const newRun = h('button', { class: descend ? 'ghost big' : 'primary big', onclick: onNew, tip: () => `Start again with a new seed. (${descend ? 'N' : 'Enter'})` },
    'New run ', h('kbd', null, descend ? 'N' : 'Enter'))
  const el = h('div', { class: 'screen end-screen' },
    h('div', { class: 'center' },
      h('div', { class: 'sigil ' + (won ? 'win' : 'lose') }, icon(won ? 'boss' : 'elite', 54)),
      h('h1', { class: 'logo ' + (won ? 'win' : 'lose') }, descend ? 'VICTORY' : won ? 'CLEARED' : 'DEFEAT'),
      h('p', { class: 'tagline' }, tagline),
      lost && deathPanel(s, run.battle),
      h('div', { class: 'end-stats' },
        [['Floors cleared', deeper > 0 ? `${cleared}/${n} + ${deeper} deep` : `${cleared}/${n}`],
          ['Battles won', `${s.stats.wins}/${s.stats.fights}`], ['Souls recruited', s.stats.reaped], ['Bodies bound', s.stats.bound], ['Essence earned', s.stats.essence], ['Relics', s.relics.length]]
          .map(([k, v]) => h('div', null, h('b', null, v), h('span', { class: 'dim' }, k)))),
      descend
        ? [h('div', { class: 'panel descend' },
            h('h2', null, 'The deep'),
            h('p', null, DEEP_TEXT.descend),
            h('p', { class: 'dim' }, DEEP_TEXT.growth),
            h('p', { class: 'warn' }, DEEP_TEXT.fall)),
          h('div', { class: 'title-actions' },
            h('button', {
              class: 'primary big', onclick: onDescend,
              tip: () => `Go on to floor ${s.floor + 1}, the first of the deep, with your retinue, relics, essence and wounds as they are. The clear is already yours. (Enter)`
            }, 'Descend ', h('kbd', null, 'Enter')),
            newRun)]
        : newRun,
      h('p', { class: 'dim' }, `seed ${s.seed}`),
      (s.relics.length > 0 || s.keystones.length > 0) && h('div', { class: 'panel' },
        h('h2', null, 'Relics'), relicList(s.relics),
        h('h2', null, 'Keystones'), keystoneList(s.keystones)),
      h('div', { class: 'panel' },
        h('h2', null, descend ? 'Your retinue' : 'Final retinue'),
        h('div', { class: 'units' }, s.party.slice().sort(fieldOrder).map((u) => unitRow(run, u))))))
  return {
    el,
    key (e) {
      if (descend && e.key === 'Enter') onDescend()
      else if (descend ? e.key === 'n' || e.key === 'N' : e.key === 'Enter') onNew()
    }
  }
}

// What felled the Monarch: who, with what, from where (a small board with both marked), and its threat.
function deathPanel (s, battle) {
  const d = deathText(s, battle)
  const m = monarchOf(s)
  const mine = m.slot >= 0 ? deployTile('party', m.slot) : null
  const from = s.death.reason === 'monarch' && s.death.uid !== m.uid ? s.death.from : null
  const walls = new Set(wallTiles(s.camp))
  const rows = []
  for (let y = DEPTH - 1; y >= 0; y--) {
    const cells = []
    for (let x = 0; x < LANES; x++) {
      const t = tileAt(x, y)
      const zone = y < CAMP_ROWS ? 'camp' : y < DEPTH - ROWS ? 'gap' : 'foe'
      cells.push(h('span', { class: `mini-cell ${zone}` + (walls.has(t) ? ' wall' : '') + (t === mine ? ' me' : '') + (t === from ? ' killer' : '') },
        t === from ? portrait(s.death.by, 20) : t === mine ? portrait('monarch', 20, true) : null))
    }
    rows.push(h('div', { class: 'mini-row' }, cells))
  }
  return h('div', { class: 'panel death' },
    h('div', { class: 'death-text' },
      h('h2', null, s.death.reason === 'tick-ceiling' ? 'How the run ended' : 'What felled the Monarch'),
      h('p', { class: 'death-head' }, d.head),
      d.lines.map((l) => h('p', { class: 'dim' }, l)),
      d.threat && h('p', { class: 'death-threat' }, 'Threat: ', h('b', null, d.threat.name), h('span', { class: 'dim' }, ` · ${d.threat.desc}`))),
    from != null && h('div', { class: 'death-board', tip: () => `The board as the blow landed: their side at the top, your camp below. The Monarch stood on ${tileText(mine)}; the killer struck from ${tileText(from)}.` },
      h('div', { class: 'mini-grid' }, rows)))
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
  const clock = h('span', { class: 'clock', tip: () => `Battle time. ${TUNING.escalation.startTick * TUNING.tick.ms / 1000} s after the start, or after the last entry (your reserve or their waves), all damage ramps up so no fight stalls; never later than ${TUNING.escalation.startTick * TUNING.escalation.bossMult * TUNING.tick.ms / 1000} s after the last foe entered.` })
  const el = h('div', { class: 'battlebar' },
    h('div', { class: 'legend' },
      h('span', null, h('i', { class: 'lg hp' }), 'HP'),
      h('span', { tip: () => 'The gold bar under each unit fills by speed toward its next ability, or its cheapest one with nothing in reach. It acts once the bar is full and a target is in reach. Walking never uses the gauge: a unit may step once every ' +
        `${TUNING.board.stepTicks * TUNING.tick.ms / 1000} s, and stops once a foe is in reach (all but a flanker on the hunt).` }, h('i', { class: 'lg gauge' }), 'gauge: ready when full'),
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

// The camp and the bench, with a tray of tabs beside them, one open at a time: the selected soul, the
// Monarch's panel, the orders, the ossuary (rank-and-file counts and the muster), and the bonuses in
// effect (synergies, bonds, relics, keystones). Click a soul (or the Monarch), then a cell or another soul, to move or swap them; click the
// bench to bench a soul. The Monarch stands on some open cell always: it never goes to the bench, and no
// benched soul takes its cell. Its domain is outlined on the camp, and on their formation when it reaches
// that far; souls outside it are marked as faltering. A selected soul's panel gives it a cohort; each
// banner (a captain and its cohort) wears one colour, its members ghosted on the cells armyLayout gives
// them, and the bodies with no room on the board wait in the reserve strip behind the camp. A member's
// cell is open ground to the rules: a soul placed there sends the member elsewhere. With `facing` (a
// battle room), its formation is drawn above your camp, past the open ground's row. Orders: shift- or
// ctrl-click souls (or click them in Pick mode) to pick them, form a detachment of them in the orders panel,
// and give it Where and When; a Move's square is the next cell clicked on the board (their ground too).
// Each detachment wears a colour of its own (its tag on its captains, a dot on its members, its square and
// the arrow to it); a held detachment (a later start) stands ghosted on its cells and waits in the reserve
// strip, ahead of the overflow. onChange runs after every action it sends.

const FOE_ROW_LABEL = ['Front', 'Mid', 'Back']

// A banner's colour, by its captain's place among the souls holding a cohort (benched ones too, so a
// banner keeps its colour while it waits).
const BANNER = ['#66c8ff', '#f08a98', '#c9a0ff', '#ffb86b', '#c9e07b', '#ff7ad9', '#7ad0ff', '#e0d090']
export const bannerColours = (party) => new Map(souls(party).filter((u) => u.cohort).map((u, i) => [u.uid, BANNER[i % BANNER.length]]))

// A shape's first n cells around its captain (the gold dot), as a small grid, the front on top: the captain's
// row, or the row of a mouth's horns ahead of it.
function shapeGlyph (shape, n) {
  const cells = [[0, 0], ...SHAPES[shape].offsets.slice(0, n)]
  const cols = cells.map(([, c]) => c)
  const r0 = Math.min(...cells.map(([r]) => r))
  const [c0, rows] = [Math.min(...cols), Math.max(...cells.map(([r]) => r)) - r0 + 1]
  const w = Math.max(...cols) - c0 + 1
  const at = new Map(cells.map(([r, c], i) => [`${r}:${c}`, i]))
  return h('span', { class: 'glyph', style: `grid-template-columns:repeat(${w},5px)` },
    Array.from({ length: rows * w }, (_, k) => {
      const i = at.get(`${Math.floor(k / w) + r0}:${k % w + c0}`)
      return h('i', { class: i === 0 ? 'cap' : i ? 'mem' : '' })
    }))
}

// The Monarch's domain on the camp grid: a square of `r` cells around its cell (`m`: anything with the
// centre's slot, which under Vanguard Crown is the front-most captain's, domainCentre), rows and lanes alike
// (camp row r is board row CAMP_ROWS − 1 − r, so camp distance is board distance). Board rows past the
// camp's front are the gap row, then their formation's front, middle and back rows.
const domainOn = (m, r) => {
  const top = rowOf(m.slot) - r // the camp row of its front edge; below 0, it reaches past the front
  const inside = (row, col) => Math.abs(row - rowOf(m.slot)) <= r && Math.abs(col - colOf(m.slot)) <= r
  // The square's outline, closed where the board ends (their back row is camp row −2 − (ROWS − 1)); none
  // along the camp's front when it reaches on past it.
  const edges = (row, col) => !inside(row, col) ? '' : [
    row === Math.max(top, -1 - ROWS) && ' d-t', row === Math.min(rowOf(m.slot) + r, CAMP_ROWS - 1) && ' d-b',
    col === Math.max(0, colOf(m.slot) - r) && ' d-l', col === Math.min(COLS - 1, colOf(m.slot) + r) && ' d-r'
  ].filter(Boolean).join('')
  return { top, inside, edges, beyond: Math.max(0, -top) }
}

// Cells apart on the camp grid, rows and lanes alike: board distance between the two cells' tiles.
const campDistance = (a, b) => Math.max(Math.abs(rowOf(a) - rowOf(b)), Math.abs(colOf(a) - colOf(b)))
const MARSHAL_GOLD = '#e8b04b'
// The Marshals' own domains (domainOn, TUNING.ranks.domain) a cell lies in, as dashed squares in each one's
// colour, drawn inside the cells: camp row r, the open ground at −1, or their formation's row at r ≤ −2
// (see domainOn). With no row past the front drawn (`past` false: the map, nothing aimed there), a square
// reaching past it is closed along the camp's front, so it never reads as open.
const marshalSquares = (marshals, r, c, past = true) => marshals.filter((m) => m.d.inside(r, c)).map((m) =>
  h('span', { class: 'mdom' + m.d.edges(r, c).replaceAll(' d-', ' m-') + (r === 0 && !past && m.d.top < 0 ? ' m-t' : ''), style: `--m:${m.colour}` }))
// Whether a detachment's Move is a one-way trip: its square lies outside the Monarch's domain (from `mTile`,
// `domain` tiles), and a soul of it is no Marshal. Out there a soul that falters drops its plan; a Marshal
// never falters, and neither does its banner within its own domain, so a detachment of Marshals keeps it.
const oneWay = (s, d, mTile, domain) => d.plan.where === 'move' && distance(d.plan.square, mTile) > domain &&
  fielded(s.party).some((u) => d.members.includes(u.uid) && u.hp > 0 && marshalOf(s, u) !== u)

// The tray's open tab, kept across screens (and visits, while storage allows) so it stays where you left it.
const TRAY = ['soul', 'monarch', 'orders', 'ossuary', 'bonuses']
let trayTab = TRAY.includes(prefs.get('tray')) ? prefs.get('tray') : 'soul'

function retinueEditor ({ run, act, facing = null, onChange = null }) {
  const s = run.state
  const el = h('div', { class: 'retinue' })
  let sel = null // { uid } or { slot } (an empty field slot)
  // The selection outlived a cohort edit: it stays so that its panel stays, but the next click on a cell,
  // a soul or the bench picks afresh instead of moving it (giving one captain a cohort and then clicking
  // the next must not swap the two).
  let soft = false
  let error = ''
  // Orders: the souls picked for a detachment, in pick order; Pick mode (a plain click on a soul picks it);
  // the detachment whose Move square the next click on the board sets; the observer that redraws the plan
  // arrows once the board has its layout.
  let pick = []
  let picking = false
  let aim = null
  let observer = null
  // The tray's last selection and pick count, to open the right tab when either changes.
  let lastSel = null
  let lastPick = 0

  // Every action clears the selection, but a purchase, a cohort or an order keeps it, so you can go on.
  function send (action) {
    error = said(act(action))
    if (!['level', 'upgrade', 'monarch', 'muster', 'cohort', 'order', 'disband', 'promote'].includes(action.type)) sel = null
    if (action.type === 'cohort') soft = sel !== null
    else if (!sel) soft = false
    render()
    onChange?.()
  }

  // Several actions in turn (re-forming a detachment), stopping at the first the rules refuse.
  function sendAll (actions) {
    error = ''
    for (const a of actions) if ((error = said(act(a)))) break
    render()
    onChange?.()
  }

  // The rules' refusal of an order names the action as data: say it in words instead. The editor checks
  // the refusals it knows of before sending, so this is the fallback.
  const said = (e) => !e ? '' : /^cannot give the order/.test(e) ? 'The rules refuse that order.' : e

  // Before a click: a soft selection lets go, unless the click is on the selected soul itself.
  function settle (u) {
    if (soft && selected() !== u) sel = null
    soft = false
  }

  // A move the rules refuse, explained instead of sent.
  function refuse (why) {
    error = why
    render()
  }

  const buyButton = (label, cost, action, why) => h('button', {
    class: 'buy' + (s.essence < cost ? ' poor' : ''),
    'aria-disabled': s.essence < cost ? 'true' : null,
    onclick: () => { if (s.essence >= cost) send(action) },
    tip: () => s.essence < cost ? `You need ${cost} essence; you have ${s.essence}.` : why
  }, label, h('span', { class: 'price' }, icon('soul', 12), cost))

  // Spending essence on the selected soul: its next level, and its next tier on each path it may advance
  // (canAdvance): a path to take; then its path's tiers, tier IV a Knight's or a Marshal's; then, for a
  // Knight or a Marshal, a second path's tiers I–III on top of the first's (never one that clashes).
  function upgradePanel (u) {
    const d = unitDef(u.id)
    const lvlCost = levelCost(run, u)
    const capped = u.lvl >= TUNING.level.cap
    const next = !capped && baseStats(u.id, u.lvl + 1)
    const now = baseStats(u.id, u.lvl)
    const grade = u.grade ?? 0
    const first = u.path ? pathDef(u.id, u.path) : null
    const paths = first ? [first] : pathsOf(u.id)
    const others = first ? pathsOf(u.id).filter((p) => p.id !== u.path && (!u.path2 || p.id === u.path2)) : []
    // Each tier button says what the tier does and, for a Knight, what taking it rules out.
    const why = (p, n, second) => {
      const t = p.tiers[n].desc
      if (!first) return `Commits ${d.name} to ${p.name} for good, and grants tier I: ${t}`
      const either = grade === 1 && (second ? !u.path2 : n === 3)
        ? ` A Knight takes tier IV or a second path's tier I, not both: this rules out ${second ? `tier IV on ${first.name}` : 'a second path'} until it is a Marshal.` : ''
      return second && !u.path2 ? `Takes ${p.name} as ${d.name}'s second path, its tiers on top of ${first.name}'s, and grants tier I: ${t}${either}` : `${t}${either}`
    }
    const tierButton = (p) => {
      if (!canAdvance(u, p.id)) return null
      const n = nextTier(u, p.id)
      const second = !!first && p.id !== u.path
      return buyButton(!first ? `Take ${p.name} ` : second && !u.path2 ? `Second path: tier I ` : `Tier ${ROMAN[n]} `, tierCost(run, u, p.id), { type: 'upgrade', uid: u.uid, path: p.id }, why(p, n, second))
    }
    // Why a path's next tier is shut, when the rank is what shuts it.
    const shut = (p) => {
      if (canAdvance(u, p.id)) return null
      if (p.id === u.path) {
        return u.tier !== 3 ? null
          : grade === 0 ? `Tier IV is a Knight's: promote ${d.name} first.`
            : `As a Knight it took a second path: tier IV waits until it is a Marshal.`
      }
      if (pathsClash(u.id, u.path, p.id)) return `It cannot pair with ${first.name}: ${clashText(u.id, u.path, p.id)}.`
      if ((u.tier2 ?? 0) >= SECOND_TIERS) return null
      return u.tier2 ? 'A Knight holds only tier I of a second path: tiers II and III are a Marshal\'s.'
        : u.tier >= 4 ? 'As a Knight it took tier IV: a second path waits until it is a Marshal.' : null
    }
    const pathRow = (p, held, upto, second) => h('div', { class: 'path' + (held > 0 ? ' on' : '') + (second ? ' second' : '') + (second && pathsClash(u.id, u.path, p.id) ? ' clash' : '') },
      h('div', null, second && h('span', { class: 'dim small' }, held ? 'Second path · ' : 'A second path? '), h('b', null, p.name), h('span', { class: 'dim' }, ' · ' + p.desc)),
      !(second && pathsClash(u.id, u.path, p.id)) && pathTiers(p, held, upto),
      tierButton(p),
      shut(p) && h('p', { class: 'dim small shut' }, shut(p)))
    return h('div', { class: 'upgrade' },
      h('h2', null, `Spend essence on ${d.name} `, h('span', { class: 'dim' }, `Lv ${u.lvl}`)),
      capped
        ? h('p', { class: 'dim' }, `Level ${TUNING.level.cap}: it can rise no further.`)
        : buyButton(`Level ${u.lvl + 1} `, lvlCost, { type: 'level', uid: u.uid }, `+${next.hp - now.hp} HP, +${(next.atk - now.atk).toFixed(1)} ATK, and more.`),
      h('div', { class: 'paths' }, paths.map((p) => pathRow(p, u.path === p.id ? u.tier : 0, p.tiers.length, false)),
        grade >= 1 && others.map((p) => pathRow(p, p.id === u.path2 ? u.tier2 : 0, SECOND_TIERS, true))),
      !u.path && h('p', { class: 'dim small' }, 'A soul follows one path: its first tier rules out the others. A Knight or a Marshal may add a second.'),
      u.path && grade === 0 && h('p', { class: 'dim small' }, `Tier IV and a second path are for Knights and Marshals: promote ${d.name} above.`),
      grade === 1 && h('p', { class: 'dim small' }, RANK_TEXT.knight),
      grade === 2 && h('p', { class: 'dim small' }, 'A Marshal holds both: tier IV, and a second path\'s tiers I–III.'))
  }

  // What a promotion would do to the cohorts: which shrink, and to how many, once its bodies are eaten
  // (as fitCohorts in run.js settles it: souls in party order keep theirs first).
  function shrinks (take) {
    const left = {}
    const out = []
    for (const c of souls(s.party)) {
      if (!c.cohort) continue
      const k = c.cohort.kind
      left[k] ??= standingOf(s, k) - (take[k] ?? 0)
      const count = Math.min(c.cohort.count, left[k])
      left[k] -= count
      if (count < c.cohort.count) out.push({ c, to: count })
    }
    return out
  }

  // The selected soul's rank and its promotion: bodies of its kin, how many stand, and which would go.
  function rankPanel (u) {
    const d = unitDef(u.id)
    const grade = u.grade ?? 0
    const need = promoteNeed(u)
    const kin = KIN[d.kin].name
    const have = kinStanding(s, d.kin)
    const up = need !== null && GRADES[grade + 1]
    const ok = canPromote(run, u)
    const take = ok ? feedOf(s, d.kin, need) : null
    const shrink = take ? shrinks(take) : []
    const ate = take && Object.entries(take).map(([k, n]) => bodies(k, n)).join(', ')
    const shrinkText = shrink.map(({ c, to }) => `${unitDef(c.id).name}'s cohort shrinks from ${c.cohort.count} to ${to || 'none'}`).join('; ')
    return h('div', { class: 'rank-panel' },
      h('h2', { tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'Ranks'), h('p', null, RANK_TEXT.promote), h('p', null, RANK_TEXT.knight), h('p', null, RANK_TEXT.marshal)) },
        `${d.name}'s rank `, h('span', { class: 'dim' }, GRADES[grade].name)),
      h('div', { class: 'rank-row' },
        h('span', { class: `rank-ins big g${grade}` }, icon(GRADE_ICON[grade], 22)),
        h('div', { class: 'grow' }, h('b', null, GRADES[grade].name), h('div', { class: 'dim small' }, GRADES[grade].desc))),
      up
        ? h('button', {
          class: 'buy promote' + (ok ? '' : ' poor'), 'aria-disabled': ok ? null : 'true',
          onclick: () => { if (ok) send({ type: 'promote', uid: u.uid }) },
          tip: () => ok
            ? h('div', { class: 'syn-tip' }, h('b', null, `Promote ${d.name} to ${up.name}`), h('p', null, up.desc),
              h('p', null, `Feeds it ${need} ${kin} bodies of the ${have} standing: ${ate}. They are gone for good, not fallen.`),
              shrink.length > 0 && h('p', { class: 'warn' }, `Led bodies go too: ${shrinkText}.`),
              h('p', { class: 'dim' }, 'Costs no essence.'))
            : `${d.name} needs ${need} ${kin} bodies standing in the ossuary (any ${kin} kinds) to become a ${up.name}; ${have} stand. Fallen bodies do not count. Bind the ${kin} slain after a win.`
        }, icon(GRADE_ICON[grade + 1], 14), `Promote to ${up.name} `, h('span', { class: 'price' }, `${need} ${kin}`), h('span', { class: 'dim small' }, `${have} stand`))
        : h('p', { class: 'dim small' }, 'A Marshal: the highest rank.'),
      shrink.length > 0 && h('p', { class: 'warn small' }, `Promoting eats led bodies: ${shrinkText}.`))
  }

  // The Monarch's three stats: what each does now, and a point of it for the same price.
  function monarchPanel (picked) {
    const m = monarchOf(s)
    const cost = monarchCost(run)
    return h('div', { class: 'monarch-panel' + (picked ? ' on' : '') },
      h('h2', { tip: () => unitCard(m, { mods: partyMods(run, m), realm: realmOf(run) }) }, 'The Monarch ',
        h('span', { class: 'dim' }, `Lv ${m.lvl} · ${m.hp}/${m.maxHp} HP`)),
      h('div', { class: 'mstats' }, MONARCH_STATS.map((k) => {
        const t = MONARCH_TEXT[k]
        return h('div', { class: 'mstat', tip: () => h('div', { class: 'syn-tip' }, h('b', null, `${t.name} ${s.monarch[k]}`), h('p', null, t.desc(run)), h('p', { class: 'dim' }, monarchPointText(run))) },
          h('div', { class: 'mstat-name' }, h('b', null, t.name), h('span', { class: 'mstat-pts' }, s.monarch[k])),
          h('div', { class: 'dim small' }, t.now(run)),
          buyButton('+1 ', cost, { type: 'monarch', stat: k }, [t.desc(run), ` +${TUNING.monarch.hpPerPoint} max HP.`, holds(s, 'unhealable') ? ' It heals nothing: Court of Bone.' : ''].join('')))
      })),
      h('p', { class: 'dim small' }, monarchPointText(run)))
  }

  // The selected soul's cohort: which kind it leads (of its kin or role, from the bodies standing in the
  // ossuary that no other cohort leads), how many (up to Command, plus its rank's), in which shape; or clear it.
  function cohortPanel (u) {
    const c = u.cohort
    const cmd = cohortCap(s, u)
    const name = unitDef(u.id).name
    const kinds = Object.keys(s.ossuary).filter((k) => canLead(u, k) && standingOf(s, k) > 0)
    const most = (k) => Math.min(cmd, freeBodies(s, k, u))
    const give = (kind, count, shape) => send(kind === null ? { type: 'cohort', uid: u.uid, kind } : { type: 'cohort', uid: u.uid, kind, count, shape })
    const kindBtn = (k) => {
      const free = freeBodies(s, k, u)
      const on = c?.kind === k
      return h('button', {
        class: 'kind' + (on ? ' on' : '') + (free < 1 ? ' locked' : ''), 'aria-disabled': free < 1 && !on ? 'true' : null,
        onclick: () => on ? null : free < 1 ? refuse(`Every ${unitDef(k).name} standing is led by another cohort: clear one of those first.`) : give(k, most(k), c?.shape ?? 'line'),
        tip: () => h('div', { class: 'syn-tip' }, h('b', null, unitDef(k).name),
          h('p', null, `${standingOf(s, k)} stand in the ossuary; ${free} of them ${free === 1 ? 'is' : 'are'} not led by another cohort.`),
          h('p', { class: 'dim' }, on ? `${name} leads ${bodies(k, c.count)}.` : free < 1 ? 'None to spare.' : `Click to have ${name} lead ${bodies(k, most(k))} of them${c ? ` instead of its ${unitDef(c.kind).name}s` : ''}.`))
      }, portrait(k, 26), h('span', null, unitDef(k).name), h('span', { class: 'dim small' }, `${free} free`))
    }
    const body = !onField(u)
      ? h('p', { class: 'dim small' }, c ? `Benched, so its cohort stays out of battle with it and keeps its ${bodies(c.kind, c.count)} from other cohorts. Field it again, or clear the cohort to free them.`
        : 'A benched soul leads no cohort. Field it to give it one.')
      : u.hp <= 0 && !c && !kinds.length ? h('p', { class: 'dim small' }, 'Fallen: it fights no battle until an altar raises it, and leads no cohort into one.')
      : cmd < 1 ? h('p', { class: 'dim small' }, 'A cohort holds no bodies: buy a point of Command in the Monarch panel.')
        : !kinds.length ? h('p', { class: 'dim small' }, `It leads ${leadsText(u.id)} bodies, and the ossuary holds none standing. After a win, bind the slain.`)
          : [h('div', { class: 'kinds' }, kinds.map(kindBtn)),
              c && h('div', { class: 'cohort-row' },
                h('span', { class: 'dim small' }, 'Bodies'),
                h('button', { class: 'small step-btn', 'aria-disabled': c.count <= 1 ? 'true' : null, onclick: () => { if (c.count > 1) give(c.kind, c.count - 1, c.shape) }, tip: () => c.count > 1 ? 'One fewer.' : 'At least one: Clear removes the cohort.' }, '−'),
                h('b', null, c.count),
                h('button', {
                  class: 'small step-btn', 'aria-disabled': c.count >= most(c.kind) ? 'true' : null,
                  onclick: () => { if (c.count < most(c.kind)) give(c.kind, c.count + 1, c.shape) },
                  tip: () => c.count < most(c.kind) ? 'One more.' : c.count >= cmd ? `A cohort holds up to Command (${cmd}) bodies.` : `No more ${unitDef(c.kind).name}s stand unled in the ossuary.`
                }, '+'),
                h('span', { class: 'dim small' }, `of up to ${cmd} (Command)`)),
              c && h('div', { class: 'shapes' }, Object.entries(SHAPES).map(([k, sh]) => h('button', {
                class: 'shape' + (c.shape === k ? ' on' : ''),
                onclick: () => { if (c.shape !== k) give(c.kind, c.count, k) },
                tip: () => h('div', { class: 'syn-tip' }, h('b', null, sh.name), h('p', null, sh.desc), h('p', { class: 'dim' }, ARMY_TEXT.shapes))
              }, shapeGlyph(k, c.count), h('span', null, sh.name)))),
              !c && h('p', { class: 'dim small' }, 'Pick a kind to lead: it takes as many as Command allows, in a line. Then set the count and the shape.')]
    // A fallen soul on the field may still be given a cohort (ready for when an altar raises it), but its
    // bodies sit the battles out with it: say so above the controls.
    const fallen = onField(u) && u.hp <= 0 && (c || kinds.length) && h('p', { class: 'warn small' },
      `Fallen: ${name} fights no battle until an altar raises it, and its cohort stays out with it` +
      (c ? `, its ${bodies(c.kind, c.count)} kept from other cohorts. Clear it to free them.` : '. Bodies given to it now wait for that.'))
    return h('div', { class: 'cohort-panel' },
      h('h2', { tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'Cohorts'), h('p', null, ARMY_TEXT.cohort(run)), h('p', null, ARMY_TEXT.ai)) },
        `${name}'s cohort `, h('span', { class: 'dim' }, c ? `${bodies(c.kind, c.count)} · ${SHAPES[c.shape].name}` : 'none')),
      h('p', { class: 'dim small' }, `It can lead ${leadsText(u.id)} bodies.`),
      fallen,
      body,
      c && h('button', { class: 'small ghost', onclick: () => give(null), tip: () => `Clear ${name}'s cohort: its ${bodies(c.kind, c.count)} go back to the ossuary, free for any captain.` }, icon('close', 12), ' Clear'))
  }

  // The rank-and-file: the muster level (with its buy button) and, per kind, how many stand and have
  // fallen, and who leads them.
  function ossuaryPanel () {
    const kinds = Object.entries(s.ossuary).filter(([, o]) => o.standing + o.fallen > 0)
    const cap = TUNING.army.muster.cap
    const leaders = (k) => souls(s.party).filter((u) => u.cohort?.kind === k)
    return h('div', { class: 'ossuary-panel' },
      h('h2', { tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'The ossuary'), h('p', null, ARMY_TEXT.ossuary), h('p', null, ARMY_TEXT.bind(run))) },
        'Ossuary ', h('span', { class: 'dim' }, `${armyCount(s, 'standing')} standing · ${armyCount(s, 'fallen')} fallen`)),
      h('div', { class: 'muster', tip: () => h('div', { class: 'syn-tip' }, h('b', null, `Muster ${s.muster}`), h('p', null, ARMY_TEXT.muster(run))) },
        h('div', { class: 'mstat-name' }, h('b', null, 'Muster'), h('span', { class: 'mstat-pts' }, s.muster)),
        h('div', { class: 'dim small grow' }, `Every body fights at level ${s.muster}.`),
        s.muster < cap ? buyButton(`Level ${s.muster + 1} `, musterCost(run), { type: 'muster' }, ARMY_TEXT.muster(run)) : h('span', { class: 'dim small' }, `At its cap (${cap}).`)),
      kinds.length
        ? h('div', { class: 'bones' }, kinds.map(([k, o]) => {
          const led = leaders(k)
          const n = led.reduce((m, u) => m + u.cohort.count, 0)
          return h('div', {
            class: 'bone',
            tip: () => unitCard({ id: k, lvl: s.muster, path: null, tier: 0, slot: -1, rank: true }, {
              mods: partyMods(run),
              notes: [`${o.standing} standing, ${o.fallen} fallen (an altar raises them).`,
                led.length ? `Led: ${led.map((u) => `${unitDef(u.id).name} ${u.cohort.count}`).join(', ')}.` : 'No cohort leads them.',
                `A captain of its kin or role (${leadsText(k)}) can lead them: select one in the camp.`,
                `Bodies of its kin promote ${KIN[unitDef(k).kin].name} souls: ${TUNING.ranks.knight} make a Knight, ${TUNING.ranks.marshal} more a Marshal (${kinStanding(s, unitDef(k).kin)} ${KIN[unitDef(k).kin].name} stand).`]
            })
          }, portrait(k, 30, o.standing === 0),
          h('div', { class: 'grow' }, h('b', null, unitDef(k).name),
            h('div', { class: 'dim small' }, `${o.standing} standing`, o.fallen ? h('span', { class: 'fell' }, ` · ${o.fallen} fallen`) : null, ` · ${n ? `${n} led` : 'none led'}`)))
        }))
        : h('p', { class: 'dim small' }, `No bodies yet. After a win, bind the slain here: ${s.monarch.will ? `the first ${1 + s.monarch.will} bound after each battle are` : 'the first bound after each battle is'} free.`))
  }

  // The detachments and their plans: picking souls and forming one, then for each its souls, Where (a Move
  // aims at the next cell clicked on the board), When (a time with its stepper), and disbanding it. `one`,
  // the selected soul on the field, may join a detachment, leave its own, or start one.
  function ordersPanel (picked) {
    const one = picked && !isMonarch(picked) && onField(picked) ? picked : null
    const mine = one && detOf(one)
    const name = (u) => unitDef(u.id).name
    // A tooltip of a title and paragraphs, the last (when there are several) dimmed.
    const tip = (title, ...ps) => () => {
      const lines = ps.filter(Boolean)
      return h('div', { class: 'syn-tip' }, h('b', null, title), lines.map((p, i) => h('p', { class: i === lines.length - 1 && lines.length > 1 ? 'dim' : null }, p)))
    }
    const seg = (on, label, onclick, t) => h('button', { class: 'seg' + (on ? ' active' : ''), onclick, tip: t }, label)
    const dom = realmOf(run).domain
    const mTile = deployTile('party', domainCentre(s)) // the domain's centre: the Monarch's, but under Vanguard Crown
    const step = 100 // ticks: 5 s
    const tMax = Math.floor((TUNING.tick.ceiling - 1) / step) * step
    const secs = (t) => `${t * TUNING.tick.ms / 1000} s`

    function card (d) {
      const p = d.plan
      const members = d.members.map(soulOf)
      const n = members.filter((u) => onField(u) && u.hp > 0 && u.cohort).reduce((k, u) => k + u.cohort.count, 0)
      const out = p.where === 'move' && distance(p.square, mTile) > dom
      const far = oneWay(s, d, mTile, dom)
      const t = p.when.t ?? 400
      const setT = (v) => setPlan(d, { when: { at: 'time', t: Math.max(step, Math.min(tMax, v)) } })
      const whereTip = (k, o) => tip(o.name, o.desc,
        k === 'move' ? (p.where === 'move' ? 'Click, then click another cell of the board to change its square.' : 'Click, then click a cell of the board for its square: your camp, the open ground or their formation.')
          : k === 'stay' ? 'Each soul and body holds the tile it starts on (or enters on).' : 'The default: on Hunt each role moves its own way.',
        ORDER_TEXT.reaction)
      return h('div', { class: 'det' + (aim === d.id ? ' aiming' : ''), style: `--d:${d.color}` },
        h('div', { class: 'det-head' },
          h('span', { class: 'det-sw', tip: () => `Detachment ${d.id} wears this colour: its tag on its souls' cells, a dot on its bodies, its square and the arrow to it.` }, d.id),
          h('div', { class: 'grow' }, h('b', null, `Detachment ${d.id}`), h('div', { class: 'dim small' }, planText(p))),
          h('button', { class: 'small ghost', onclick: () => send({ type: 'disband', id: d.id }), tip: () => `Disband detachment ${d.id}: its souls Hunt, at once, like any soul with no orders.` }, icon('close', 12), ' Disband')),
        h('div', { class: 'det-souls' },
          members.map((u) => h('button', {
            class: 'det-soul' + (picked === u ? ' on' : '') + (onField(u) ? '' : ' benched'),
            onclick: () => { sel = { uid: u.uid }; soft = false; aim = null; error = ''; render() },
            tip: () => `${name(u)}${onField(u) ? '' : ', on the bench: it keeps its place here but does not fight'}${u.cohort && onField(u) ? `, leading ${bodies(u.cohort.kind, u.cohort.count)}` : ''}. Click to select it.`
          }, portrait(u.id, 26))),
          n > 0 && h('span', { class: 'dim small' }, `+ ${n} bod${n === 1 ? 'y' : 'ies'}`),
          h('span', { class: 'grow' }),
          one && mine === d && h('button', { class: 'small link', onclick: () => leaveDet(d, one), tip: () => `Take ${name(one)} out of detachment ${d.id}: it Hunts, at once. The others on the field keep the plan.${benchedOut(d)}` }, `Take ${name(one)} out`),
          one && mine !== d && !pick.length && h('button', { class: 'small link', onclick: () => join(d, [one.uid]), tip: () => `${name(one)} joins detachment ${d.id} and takes its plan${mine ? `, leaving detachment ${mine.id}` : ''}.${benchedOut(d)}` }, `+ ${name(one)}`),
          pick.length > 0 && h('button', { class: 'small link', onclick: () => join(d, pick), tip: () => `The picked souls join detachment ${d.id} and take its plan, leaving any other.${benchedOut(d)}` }, `+ ${pick.length} picked`)),
        h('div', { class: 'det-row' }, h('span', { class: 'det-k dim small' }, 'Where'),
          h('div', { class: 'segs' }, Object.entries(ORDERS.where).map(([k, o]) => seg(p.where === k || (k === 'move' && aim === d.id), o.name,
            () => {
              error = ''
              if (k !== 'move') { aim = null; return setPlan(d, { where: k }) }
              aim = aim === d.id ? null : d.id
              render()
            }, whereTip(k, o))))),
        aim === d.id && h('p', { class: 'aim-hint small' }, `Click a cell of the board for detachment ${d.id}'s square: your camp, the open ground, or their formation. Esc cancels.`),
        p.where === 'move' && aim !== d.id && h('p', { class: 'small' + (far ? ' warn' : ' dim') }, far
          ? `Its square lies outside the domain (${distance(p.square, mTile)} tiles from ${holds(s, 'crown') ? 'its centre, your front-most captain' : 'the Monarch'}, the domain ${dom}): a one-way trip. It drops its plan the moment it steps out, and Hunts from there.`
          : out ? `Its square lies outside the domain, but a Marshal never falters: it keeps its plan out there, and so does its banner within ${TUNING.ranks.domain} tiles of it.`
            : `Square: ${tileText(p.square)}. On it or next to it, it has arrived and Hunts.`),
        h('div', { class: 'det-row' }, h('span', { class: 'det-k dim small' }, 'When'),
          h('div', { class: 'segs wrap' }, Object.entries(ORDERS.when).map(([k, o]) => seg(p.when.at === k, k === 'time' ? `After ${secs(t)}` : o.name,
            () => { error = ''; setPlan(d, { when: k === 'time' ? { at: k, t } : { at: k } }) },
            tip(o.name, o.desc, k === 'wave' && ORDER_TEXT.wave, k !== 'once' && ORDER_TEXT.held))))),
        p.when.at === 'time' && h('div', { class: 'cohort-row' },
          h('span', { class: 'dim small' }, 'Enters after'),
          h('button', { class: 'small step-btn', 'aria-disabled': t <= step ? 'true' : null, onclick: () => { if (t > step) setT(t - step) }, tip: () => t > step ? '5 s sooner.' : `${secs(step)} at the soonest.` }, '−'),
          h('b', null, secs(t)),
          h('button', { class: 'small step-btn', 'aria-disabled': t >= tMax ? 'true' : null, onclick: () => { if (t < tMax) setT(t + step) }, tip: () => t < tMax ? '5 s later.' : `The battle is lost at ${secs(TUNING.tick.ceiling)}.` }, '+'),
          h('span', { class: 'dim small' }, 'of battle time')))
    }

    const ds = s.detachments.slice().sort((a, b) => a.id - b.id)
    return h('div', { class: 'orders-panel' },
      h('h2', { tip: tip('Orders', ORDER_TEXT.detachments, ORDER_TEXT.pick, ORDER_TEXT.reaction, ORDER_TEXT.leash, ORDER_TEXT.held, ORDER_TEXT.cohort + ' ' + ORDER_TEXT.flank) },
        'Orders ', h('span', { class: 'dim' }, `${s.detachments.length}/${cap} detachments`)),
      h('div', { class: 'pick-row' },
        h('button', {
          class: 'small' + (picking ? ' on' : ''),
          onclick: () => { picking = !picking; aim = null; error = ''; render() },
          tip: () => picking ? 'Stop picking: a click on a soul selects it again.' : 'Pick souls for a detachment: while on, a click on a soul on the field picks it, or drops it. Shift- or Ctrl-click does the same at any time.'
        }, picking ? 'Picking: done' : 'Pick'),
        pick.length
          ? [h('span', { class: 'picked' }, pick.map((uid) => portrait(soulOf(uid).id, 24))),
              h('button', { class: 'small', onclick: () => form(pick), tip: () => `Form detachment of ${pick.map((uid) => name(soulOf(uid))).join(', ')}: they Hunt, at once, until you give it a plan below. Each leaves any other detachment.` }, `Form detachment (${pick.length})`),
              h('button', { class: 'small link', onclick: () => { unpick(); error = ''; render() }, tip: () => 'Drop the picked souls.' }, 'Clear')]
          : one && !mine
            ? h('button', { class: 'small', onclick: () => form([one.uid]), tip: () => `A detachment of ${name(one)} alone: it Hunts, at once, until you give it a plan below.` }, `New detachment of ${name(one)}`)
            : h('span', { class: 'dim small' }, picking ? 'Click souls on the field to pick them.' : 'Shift- or Ctrl-click souls on the field to pick them.')),
      ds.length ? ds.map(card) : h('p', { class: 'dim small' }, 'No detachments: every soul Hunts, at once.'))
  }

  // A shift-, ctrl- or cmd-click (or any click in Pick mode) picks souls for a detachment.
  const picks = (e) => picking || !!(e?.shiftKey || e?.ctrlKey || e?.metaKey)

  function clickSlot (slot, e) {
    if (aim != null) return setSquare(deployTile('party', slot))
    const o = s.party.find((u) => u.slot === slot)
    if (picks(e)) {
      const who = o ?? captainOf(armyOf(run).members.find((x) => x.slot === slot) ?? {})
      return who ? togglePick(who) : refuse('Nobody stands here to pick: pick souls on the field (a member\'s cell picks its captain).')
    }
    settle(o)
    const picked = selected()
    // A member's cell is open ground; with no soul selected, clicking it picks up its banner's captain.
    const m = !o && !picked && armyOf(run).members.find((x) => x.slot === slot)
    if (m) sel = { uid: m.cohortOf }
    else if (!sel) sel = o ? { uid: o.uid } : { slot }
    else if (sel.uid != null) {
      if (o?.uid === sel.uid) sel = null
      else if (o && isMonarch(o) && picked.slot < 0) return refuse(`The Monarch never goes to the bench: place ${unitDef(picked.id).name} on another cell.`)
      else if (!o && picked.slot < 0 && full()) return refuse(fullText(picked))
      else return send({ type: 'place', uid: sel.uid, slot })
    } else if (o) return send({ type: 'place', uid: o.uid, slot: sel.slot })
    else sel = sel.slot === slot ? null : { slot }
    error = ''
    render()
  }

  function clickBench (u, e) {
    if (aim != null) return refuse('The bench is not on the board: click a cell of the board for the square, or press Esc.')
    if (picks(e)) return togglePick(u)
    settle(u)
    const picked = selected()
    if (picked && isMonarch(picked)) return refuse('The Monarch never goes to the bench. Pick a soul to swap with this one.')
    if (picked && picked !== u && picked.slot >= 0) return send({ type: 'place', uid: u.uid, slot: picked.slot })
    if (sel?.slot != null) return full() ? refuse(fullText(u)) : send({ type: 'place', uid: u.uid, slot: sel.slot })
    sel = picked === u ? null : { uid: u.uid }
    error = ''
    render()
  }

  function clickBenchSpace () {
    if (soft) {
      settle(null)
      return render()
    }
    const picked = selected()
    if (picked && isMonarch(picked)) return refuse('The Monarch never goes to the bench: it stands in every battle.')
    if (picked && picked.slot >= 0) send({ type: 'place', uid: picked.uid, slot: -1 })
  }

  const selected = () => sel?.uid != null && s.party.find((x) => x.uid === sel.uid)
  // The soul a click elsewhere would move: the selected one, unless its selection is soft.
  const mover = () => !soft && selected()
  const benchable = (u) => u && u.slot >= 0 && !isMonarch(u)
  // A benched soul can only take an open cell while a banner is free; it can always swap with a soul.
  const full = () => fielded(souls(s.party)).length >= fieldCap(run)
  const fullText = (u) => `The field is full (${fieldCap(run)} souls): swap ${unitDef(u.id).name} with a soul on the field, bench one first, or buy Command.`

  const captainOf = (m) => s.party.find((u) => u.uid === m.cohortOf)

  // ── orders ──

  const cap = TUNING.army.detachments
  const soulOf = (uid) => s.party.find((u) => u.uid === uid)
  const detOf = (u) => detachmentOf(s, u.uid)
  const inOrder = (uids) => s.party.filter((u) => uids.includes(u.uid)).map((u) => u.uid)
  // The detachments that stand once `uids` leave theirs (one left empty is gone): the cap counts these.
  const kept = (uids) => s.detachments.filter((d) => d.members.some((uid) => !uids.includes(uid)))

  function togglePick (u) {
    if (isMonarch(u)) return refuse('The Monarch takes no orders: it never takes a step. Pick souls on the field.')
    if (!onField(u)) return refuse(`${unitDef(u.id).name} is on the bench, and a benched soul takes no orders: field it first.`)
    pick = pick.includes(u.uid) ? pick.filter((x) => x !== u.uid) : [...pick, u.uid]
    error = ''
    render()
  }

  const unpick = () => { pick = []; picking = false }

  // A new detachment of `uids` (each taken out of any other), with `plan`. The cap and a detachment of
  // exactly these souls are refused here, in words.
  function form (uids, plan = DEFAULT_PLAN) {
    uids = inOrder(uids)
    const same = s.detachments.find((d) => d.members.length === uids.length && uids.every((uid) => d.members.includes(uid)))
    if (same) return refuse(`They already are detachment ${same.id}.`)
    if (kept(uids).length >= cap) return refuse(`At most ${cap} detachments: disband one first, or add these souls to one.`)
    unpick()
    send({ type: 'order', uids, plan })
  }

  // Souls join detachment d, keeping its plan: d is disbanded and formed anew of its souls on the field and
  // them (its colour follows its new id, the lowest free). The rules order only souls on the field, so a
  // benched soul of d leaves it (the tooltips say so); disbanding d first keeps it from lingering, held by
  // its benched soul alone, beside a second detachment on the same plan, and from counting toward the cap.
  function join (d, uids) {
    uids = inOrder([...d.members.filter((uid) => onField(soulOf(uid))), ...uids])
    const same = s.detachments.find((x) => x !== d && x.members.length === uids.length && uids.every((uid) => x.members.includes(uid)))
    if (same) return refuse(`They already are detachment ${same.id}.`)
    if (kept(uids).filter((x) => x !== d).length >= cap) return refuse(`At most ${cap} detachments: disband one first.`)
    unpick()
    sendAll([{ type: 'disband', id: d.id }, { type: 'order', uids, plan: d.plan }])
  }

  // The benched souls of d, who leave it whenever it is formed anew (join, leaveDet): words for a tooltip.
  const benchedOut = (d) => {
    const out = d.members.map(soulOf).filter((u) => !onField(u))
    return out.length ? ` ${out.map((u) => unitDef(u.id).name).join(' and ')}, on the bench, leave${out.length === 1 ? 's' : ''} it too.` : ''
  }

  // A soul leaves its detachment: the rest on the field are formed anew with its plan (its benched souls
  // leave it too), or it is disbanded if none is left.
  function leaveDet (d, u) {
    const rest = d.members.filter((uid) => uid !== u.uid && onField(soulOf(uid)))
    sendAll([{ type: 'disband', id: d.id }, ...(rest.length ? [{ type: 'order', uids: rest, plan: d.plan }] : [])])
  }

  // A detachment's new plan; the same plan is not sent (the rules refuse it).
  function setPlan (d, patch) {
    const p = { ...d.plan, ...patch }
    const plan = { where: p.where, square: p.where === 'move' ? p.square : null, when: p.when }
    if (JSON.stringify(plan) === JSON.stringify(d.plan)) return render()
    send({ type: 'order', id: d.id, plan })
  }

  // A click on the board while a detachment aims: its Move square.
  function setSquare (tile) {
    const d = s.detachments.find((x) => x.id === aim)
    if (!d) { aim = null; return render() }
    if (!isSquare(s, tile)) return refuse('A wall: a Move square must be open ground.')
    aim = null
    error = ''
    setPlan(d, { where: 'move', square: tile })
  }

  // A soul's orders, for its tooltip.
  function orderNotes (u) {
    if (isMonarch(u)) return []
    const d = detOf(u)
    if (!d) return [onField(u) && 'No orders: it Hunts, at once. Shift- or Ctrl-click to pick it for a detachment.']
    return [`Detachment ${d.id}: ${planText(d.plan)}.`,
      !onField(u) && 'On the bench: it keeps its place in the detachment, but does not fight.',
      onField(u) && waits(d) && `Held: it waits behind the camp, off the board, and enters beside the Monarch ${whenText(d.plan.when)}. Its cell stays its own, but it takes its bonds where it enters.`,
      onField(u) && !waits(d) && d.plan.where !== 'hunt' && startsFaltering(s, u) && 'It stands outside the domain, so it falters from the start and drops its plan: only Hunt is heeded out there.']
  }

  // What clicking here would do, given the current selection (`member`: the rank-and-file standing on it).
  // In the order clickSlot decides.
  function slotHint (slot, o, member = null) {
    if (o && selected() === o) return 'Click again to deselect.'
    const picked = mover()
    if (picked && o && isMonarch(o) && picked.slot < 0) return `The Monarch never goes to the bench, so ${unitDef(picked.id).name} cannot take its cell.`
    if (picked && !o && picked.slot < 0 && full()) return fullText(picked)
    if (!o && member) {
      if (!picked) return `Click to select its captain, ${unitDef(captainOf(member).id).name}.`
      return `Click to move ${unitDef(picked.id).name} here: the ${unitDef(member.id).name} makes way` + (picked.slot < 0
        ? ', and with one more soul on the board a body may have to wait in reserve.' : ' and stands elsewhere in its banner.')
    }
    if (picked && isMonarch(picked) && !o && sealedBy(s.camp, slot).length) return `Click to move the Monarch here. ${sealText(sealedBy(s.camp, slot).length)}`
    if (picked) return o ? `Click to swap ${unitDef(picked.id).name} with ${unitDef(o.id).name}.` : `Click to move ${unitDef(picked.id).name} here.`
    if (sel?.slot != null && o) return `Click to move ${unitDef(o.id).name} into the selected slot.`
    return o ? 'Click to select, then click a slot or soul to move or swap.' : null
  }

  // Inside the domain or not, in words, for a cell's tooltip; and inside a Marshal's own, for its banner.
  // Under Vanguard Crown the domain centres on the front-most captain, not the Monarch.
  const crowned = holds(s, 'crown')
  const whose = crowned ? 'the domain (on your front-most captain, Vanguard Crown)' : "the Monarch's domain"
  const domainLine = (slot, u) => {
    if (isMonarch(u ?? {})) {
      const sealed = sealedBy(s.camp, slot).length
      return (crowned ? `Vanguard Crown: its domain (${realmOf(run).domain} tiles) centres on your front-most captain, not here. The Monarch itself never falters.` : `Its domain reaches ${realmOf(run).domain} tiles from here.`) +
        (sealed ? ` ${sealText(sealed)}` : '')
    }
    const who = u?.rank ? 'a body' : 'a soul'
    const centred = crowned && slot === domainCentre(s) && u && !u.rank
      ? ` Vanguard Crown: the domain (${realmOf(run).domain} tiles) centres here as the battle begins, on your front-most captain, and moves with the front from then on.` : ''
    if (!faltersAt(s, slot)) return `Inside ${whose}: ${who} here fights at full strength.${centred}`
    const m = u && marshalOf(s, u)
    if (u && !startsFaltering(s, u)) {
      return m === u ? `Outside ${whose}, but a Marshal never falters: it carries a domain of its own (${TUNING.ranks.domain} tiles) wherever it goes.${centred}`
        : `Outside ${whose}, but within ${unitDef(m.id).name}'s own (${TUNING.ranks.domain} tiles): ${who} of its banner fights at full strength and keeps its orders while it stays there.`
    }
    const near = marshalsOn().filter((x) => x !== m && campDistance(x.slot, slot) <= TUNING.ranks.domain)
    return `Outside ${whose}: ${who} here falters, dealing ×${TUNING.monarch.falter} damage while it stands out here.` +
      (near.length ? ` A Marshal's own domain reaches here (${near.map((x) => unitDef(x.id).name).join(', ')}): ${u ? 'only bodies of its banner' : 'its banner'} would not falter.` : '')
  }
  // The Marshals standing on the field, whose own domains the camp outlines.
  const marshalsOn = () => souls(fielded(s.party)).filter((u) => marshalOf(s, u) === u && !isHeld(s, u))

  function soulTip (u, where, extra) {
    const all = [...fielded(s.party).filter((x) => !isHeld(s, x)), ...armyOf(run).members]
    const alias = aliasOf(run)
    const c = u.cohort
    return unitCard(u, {
      mods: [...partyMods(run, u), ...bondMods(all, u, alias)],
      realm: realmOf(run),
      notes: [
        where,
        u.slot >= 0 && !isHeld(s, u) && domainLine(u.slot, u),
        ...orderNotes(u),
        c && `Captain of a banner: leads ${bodies(c.kind, c.count)} in a ${SHAPES[c.shape].name.toLowerCase()}${onField(u) && u.hp > 0 ? '' : ', who stay out of battle while it does'}.`,
        ...bondNotes(all, u, alias),
        u.hp <= 0 && 'Fallen: it will not fight until an altar raises it.',
        ...[extra].flat()]
    })
  }

  function render () {
    const cap = fieldCap(run)
    const field = fielded(s.party)
    const fieldSouls = souls(field)
    const bench = benched(s.party)
    const picked = selected()
    const moving = mover()
    // The army as it will stand: the members on their cells (bonds and synergies count them), the rest
    // in reserve; a held detachment's souls stand ghosted on their cells, and wait with their bodies behind
    // the camp (they count for nothing on the board until they enter).
    const army = armyOf(run)
    const held = new Set(army.held.filter((b) => !b.rank).map((b) => b.uid))
    const memberAt = new Map(army.members.map((m) => [m.slot, m]))
    const all = [...field.filter((u) => !held.has(u.uid)), ...army.members]
    const colours = bannerColours(s.party)
    const alias = aliasOf(run)
    const bonded = new Set(activeBonds(all, { alias }).map((b) => b.uid))
    const standing = fieldSouls.filter((u) => u.hp > 0 && !held.has(u.uid)).length
    const alive = fieldSouls.filter((u) => u.hp > 0).length
    const onBoard = standing + army.members.length
    const m = monarchOf(s)
    const realm = realmOf(run)
    const centre = domainCentre(s)
    const dom = domainOn({ slot: centre }, realm.domain)
    // The Monarch's tile (a held detachment enters beside it) and the domain's centre (a Move square past it
    // is a one-way trip): one and the same but under Vanguard Crown.
    const mTile = deployTile('party', m.slot)
    const cTile = deployTile('party', centre)
    // Who takes the board at the start, by tile: the souls not held back, and the members.
    const starters = [...fieldSouls.filter((u) => u.hp > 0 && !held.has(u.uid)), ...army.members]
    const startAt = new Map(starters.map((u) => [deployTile('party', u.slot), u]))
    // The Monarch's approach tiles (reDESIGN, what prep shows): the open tiles around it, where a foe stands to
    // strike it and a flanker makes for. Each one held at the start screens it; a bare one is a way in.
    const walls = new Set(wallTiles(s.camp))
    const approach = new Set(neighbours(mTile).filter((t) => !walls.has(t) && tileY(t) <= CAMP_ROWS))
    const bare = [...approach].filter((t) => !startAt.has(t))
    const approachNote = (tile) => approach.has(tile) && (startAt.has(tile)
      ? 'Beside the Monarch: an approach tile, held. A foe has to fell or pass whoever stands here to strike from it.'
      : 'Beside the Monarch: an approach tile, open. A foe that reaches it strikes the Monarch from here, and a flanker makes for the nearest open one. Hold it with a soul or a body to screen the Monarch.')
    // The line: the front-most row anyone starts on; how far it stands ahead of the Monarch, and how far short
    // of their front (Reach strikes over the gap; a long one is open ground to cross).
    const lineY = starters.length ? Math.max(...starters.map((u) => tileY(deployTile('party', u.slot)))) : null
    // Melee behind melee does nothing (reDESIGN §10): a melee captain with a melee unit of another banner
    // right ahead of it in its lane strikes nothing until that one falls or it walks round.
    const melee = (u) => Math.max(1, ...unitDef(u.id).abilities.map(abilityDef).filter((a) => !isAllyShape(a.shape) && a.shape !== 'corpse').map(rangeOf)) === 1
    const behind = (u) => {
      if (isMonarch(u) || u.hp <= 0 || held.has(u.uid) || !melee(u) || rowOf(u.slot) === 0) return null
      const ahead = startAt.get(deployTile('party', slotAt(rowOf(u.slot) - 1, colOf(u.slot))))
      return ahead && !isMonarch(ahead) && melee(ahead) && (ahead.cohortOf ?? ahead.uid) !== u.uid ? ahead : null
    }
    const behindNote = (u) => {
      const a = behind(u)
      return a && `Melee behind melee: ${unitDef(a.id).name}${a.rank ? ` (of ${unitDef(captainOf(a).id).name}'s banner)` : ''} stands right ahead of it in this lane. Melee strikes only the tiles around it, so this banner adds nothing at the front until that one falls or it walks round: stand it beside the other, or behind a ranged one.`
    }
    const banner = (uid) => colours.has(uid) ? `--b:${colours.get(uid)}` : null
    const styles = (...xs) => xs.filter(Boolean).join(';') || null
    // Plans on the board: each Move square in its detachment's colour (faded when it lies outside the domain:
    // a one-way trip), and every cell a target while a detachment aims.
    // A one-way trip: a square outside the domain, for a detachment with a soul that is no Marshal (a Marshal
    // never falters, so it keeps its plan out there; see oneWay).
    const far = (d) => oneWay(s, d, cTile, realm.domain)
    const squares = new Map()
    for (const d of s.detachments) if (d.plan.where === 'move' && takesPart(s, d)) squares.set(d.plan.square, [...(squares.get(d.plan.square) ?? []), d])
    const deco = (tile) => {
      const ds = squares.get(tile)
      return {
        cls: (ds ? ' square' + (ds.every(far) ? ' far' : '') : '') + (aim != null ? ' aim' : ''),
        style: ds ? `--q:${ds[0].color}` : null,
        // A held detachment's start is a tag on its square too (reDESIGN §3), as on its souls' cells.
        tags: ds && h('span', { class: 'sq-tags' }, ds.map((d) => h('span', { class: 'sq-tag', style: `--d:${d.color}` }, waits(d) ? `${d.id} · ${whenTag(d.plan.when)}` : d.id)))
      }
    }
    const squareNotes = (tile) => [...(squares.get(tile) ?? []).map((d) => `Detachment ${d.id}'s Move square${waits(d) ? ` (it enters ${whenText(d.plan.when)})` : ''}: on it or next to it, it has arrived and Hunts.` +
      (far(d) ? ` It lies outside the domain: a one-way trip, for it drops its plan the moment it steps out, and Hunts from there.` : '')),
    aim != null && `Click to make this detachment ${aim}'s square.`]
    // Empty ground past the camp (the open row, their formation's): what it is, the domain, squares, the aim.
    const groundTip = (title, text, tile, inside) => () => h('div', { class: 'syn-tip' }, h('b', null, title), h('p', null, text),
      h('p', null, inside ? 'Inside the Monarch\'s domain.' : 'Outside the Monarch\'s domain: a soul or body out here falters, and only Hunt is heeded.'),
      approachNote(tile) && h('p', { class: 'warn' }, approachNote(tile)),
      squareNotes(tile).filter(Boolean).map((n) => h('p', { class: 'dim' }, n)),
      aim == null && !squares.has(tile) && h('p', { class: 'dim' }, 'A detachment on Move can be sent here: press Move on it in the orders panel, then click.'))
    // Each Marshal's own domain, a dashed square in its banner's colour (gold with no cohort), drawn per cell
    // (a held Marshal enters beside the Monarch, so it outlines nothing in the camp).
    const marshals = marshalsOn().map((x) => ({ x, d: domainOn(x, TUNING.ranks.domain), colour: colours.get(x.uid) ?? MARSHAL_GOLD }))
    // Their ground on the map, with no room scouted: shown while a detachment aims, or holds a square there.
    const beyond = !facing && (aim != null || [...squares.keys()].some((t) => tileY(t) >= CAMP_ROWS))
    const realms = (r, c) => marshalSquares(marshals, r, c, !!facing || beyond)
    const fieldGrid = []
    for (let r = 0; r < CAMP_ROWS; r++) {
      const cells = []
      for (let c = 0; c < COLS; c++) {
        const slot = slotAt(r, c)
        const tile = deployTile('party', slot)
        const area = (dom.inside(r, c) ? ' dom' : ' out') + dom.edges(r, c)
        if (isWall(s.camp, slot)) {
          cells.push(h('div', {
            class: 'cell wall' + area, 'data-tile': tile, onclick: aim != null ? () => setSquare(tile) : null,
            tip: () => 'Wall. It blocks walking, yours and theirs, but not attacks.' + (aim != null ? ' A Move square must be open ground.' : '')
          }, realms(r, c)))
          continue
        }
        const u = field.find((x) => x.slot === slot)
        const mem = memberAt.get(slot) ?? null
        const isSel = sel && (sel.uid != null ? u?.uid === sel.uid : sel.slot === slot)
        const heldHere = u && held.has(u.uid)
        const falters = u && !isMonarch(u) && u.hp > 0 && !heldHere ? startsFaltering(s, u) : !u && mem ? startsFaltering(s, mem) : false
        const ledBySel = mem && picked && mem.cohortOf === picked.uid
        const det = u ? detOf(u) : mem ? detOf(captainOf(mem)) : null
        const sq = deco(tile)
        // A fallen soul's cell may hold a member (the fallen do not fight): the soul shows, the member is noted.
        const memNote = mem && `In battle a ${unitDef(mem.id).name} of ${unitDef(captainOf(mem).id).name}'s banner stands here, rank-and-file at muster level ${s.muster}.`
        cells.push(h('button', {
          class: 'cell' + area + (u ? ' has' : mem ? ' member' : ' empty') + (isSel ? ' sel' : '') + (u && u.hp <= 0 ? ' fallen' : '') +
            (moving && !u && !(moving.slot < 0 && full()) && aim == null ? ' drop' : '') + (u && isMonarch(u) ? ' monarch' : '') + (falters ? ' falter' : '') +
            (u && colours.has(u.uid) ? ' captain' : '') + (ledBySel ? ' led' : '') + (heldHere ? ' held' : '') + (u && pick.includes(u.uid) ? ' pick' : '') +
            (crowned && u && !isMonarch(u) && slot === centre ? ' centre' : '') + sq.cls +
            (approach.has(tile) ? (startAt.has(tile) ? ' approach' : ' approach bare') : '') + (u && behind(u) ? ' behind' : '') +
            (u && isMonarch(u) && sealedBy(s.camp, slot).length ? ' seal' : ''),
          style: styles(u ? banner(u.uid) : mem ? banner(mem.cohortOf) : null, det && `--d:${det.color}`, sq.style),
          'data-tile': tile,
          onclick: (e) => clickSlot(slot, e),
          tip: () => u
            ? soulTip(u, `In the camp: ${campRowLabel(r).toLowerCase()}.`, [u.hp <= 0 && memNote, behindNote(u), approachNote(tile), ...squareNotes(tile), aim == null && slotHint(slot, u)])
            : mem
              ? unitCard(mem, {
                mods: [...partyMods(run), ...bondMods(all, mem, alias)],
                notes: [`Rank-and-file of ${unitDef(captainOf(mem).id).name}'s banner (${SHAPES[captainOf(mem).cohort.shape].name}), at muster level ${s.muster}. In the camp: ${campRowLabel(r).toLowerCase()}.`,
                  det && `Detachment ${det.id}: it follows its captain's plan, ${planText(det.plan)}.`,
                  domainLine(slot, mem), ...bondNotes(all, mem, alias), approachNote(tile), ...squareNotes(tile), aim == null && slotHint(slot, null, mem)]
              })
              : h('div', { class: 'syn-tip' },
                h('b', null, `Open ground: ${campRowLabel(r).toLowerCase()}`),
                h('p', null, campRowText(r)),
                h('p', null, domainLine(slot, null)),
                approachNote(tile) && h('p', { class: 'warn' }, approachNote(tile)),
                squareNotes(tile).filter(Boolean).map((n) => h('p', null, n)),
                aim == null && h('p', { class: 'dim' }, slotHint(slot, null) ?? (full() ? `The field is full (${cap} souls): swap a benched soul with one on the field, bench one first, or buy Command.` : 'Select a soul, then click here to move it.')))
        }, realms(r, c), u ? [cellBody(u, bonded.has(u.uid), falters, u.hp <= 0 && mem, mem && colours.get(mem.cohortOf), det), crowned && !isMonarch(u) && slot === centre && h('span', { class: 'centre-mark', 'aria-label': 'the domain centres here' }, icon('crown', 15)),
          behind(u) && h('span', { class: 'behind-mark', 'aria-label': 'melee behind melee' }, '⇈')]
          : mem ? memberBody(mem, bonded.has(mem.uid), falters, s.muster, det) : null, sq.tags))
      }
      fieldGrid.push(h('div', { class: 'row' }, h('span', { class: 'rowname', tip: () => `${campRowLabel(r)}. ${campRowText(r)}` }, campRowLabel(r)), cells))
    }
    // The open ground: one row of the board between your camp's front and their formation (camp row −1).
    const gapRow = h('div', { class: 'grid gap' }, h('div', { class: 'row' },
      h('span', { class: 'rowname', tip: () => 'The open ground: one empty row between your camp\'s front and their formation.' }, 'Open'),
      Array.from({ length: COLS }, (_, c) => {
        const tile = tileAt(c, CAMP_ROWS)
        const sq = deco(tile)
        return h('div', {
          class: 'cell gap-cell' + (dom.inside(-1, c) ? ' dom' + dom.edges(-1, c) : '') + sq.cls + (approach.has(tile) ? ' approach bare' : ''), style: sq.style, 'data-tile': tile,
          onclick: aim != null ? () => setSquare(tile) : null,
          tip: groundTip(`The open ground, lane ${c + 1}`, 'Between your camp\'s front and their formation\'s.', tile, dom.inside(-1, c))
        }, realms(-1, c), sq.tags)
      })))
    const ground = { deco, onTile: aim != null ? setSquare : null, tip: groundTip, notes: squareNotes }
    // Past the camp's front lie only DEPTH − CAMP_ROWS rows: the open ground, then their formation's.
    const reachText = !dom.beyond ? 'It stays inside your camp.'
      : dom.beyond > DEPTH - CAMP_ROWS ? 'It reaches past your front to the far edge of the board.'
        : `It reaches ${dom.beyond} row${dom.beyond > 1 ? 's' : ''} past your front: ${['the open ground', 'their front row', 'their middle row', 'their back row'][dom.beyond - 1]}.`
    const out = [...fieldSouls.filter((u) => u.hp > 0 && !held.has(u.uid)), ...army.members].filter((u) => startsFaltering(s, u))
    const board = TUNING.army.board
    // Held bodies, by detachment, in the order they enter once called.
    const heldBy = [...new Set(army.held.map((b) => b.det))].map((id) => s.detachments.find((d) => d.id === id)).map((d) => [d, army.held.filter((b) => b.det === d.id)])
    const waiting = army.reserve.length + army.held.length
    // From each Move detachment to its square: from its souls' cells, or from the Monarch for a held one
    // (it enters beside it).
    const arrows = s.detachments.filter((d) => d.plan.where === 'move' && takesPart(s, d)).map((d) => ({
      color: d.color, to: d.plan.square, far: far(d), held: waits(d),
      from: waits(d) ? [mTile] : fieldSouls.filter((u) => d.members.includes(u.uid) && u.hp > 0).map((u) => deployTile('party', u.slot))
    })).filter((a) => a.from.length)
    const boardEl = h('div', { class: 'board' + (aim != null ? ' aiming' : '') + (crowned ? ' crowned' : '') },
      facing && [
        facing.waves?.length > 0 && [
          h('div', { class: 'gridlabel foe', tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'Still to come'), h('p', null, facing.waves[0].when.at === 'time' ? ENEMY_TEXT.late : ENEMY_TEXT.waves), h('p', { class: 'dim' }, ENEMY_TEXT.entry)) },
            'Still to come, from the far edge'),
          wavePreview(run, facing)],
        h('div', { class: 'gridlabel foe' }, 'Their formation'),
        foeGrid(run, facing, dom, ground, marshals)],
      beyond && [
        h('div', { class: 'gridlabel foe', tip: () => 'Their side of the board. Enter a battle room to see the foes standing here.' }, 'Their ground'),
        foeGrid(run, { type: 'fight', foes: [] }, dom, ground, marshals)],
      (facing || beyond) && gapRow,
      h('div', { class: 'gridlabel', tip: () => `Your camp on this floor. Each floor draws a different one. ${fieldSouls.length} of up to ${cap} souls stand on the field as captains (${fieldRule(run)}), and the Monarch with them. ${ARMY_TEXT.board}` },
        `Your camp: ${campDef(s.camp).name} `, h('span', { class: 'dim' }, `${fieldSouls.length}/${cap} souls${alive < fieldSouls.length ? ` · ${alive} standing` : ''}${held.size ? ` · ${held.size} held` : ''} · ${onBoard}/${board} bodies`)),
      h('div', { class: 'grid camp' }, fieldGrid),
      waiting > 0 && h('div', {
        class: 'reserve-strip on',
        tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'Behind the camp: the reserve'), h('p', null, ARMY_TEXT.board),
          heldBy.length > 0 && [h('p', null, ORDER_TEXT.held),
            heldBy.map(([d, bs]) => h('p', { class: 'dim' }, `Detachment ${d.id} (${bs.map((b) => unitDef(b.id).name).join(', ')}) enters ${whenText(d.plan.when)}.`))],
          h('p', { class: 'dim' }, army.reserve.length
            ? `${army.reserve.length} find no room and sit this battle out: ${army.reserve.map((b) => unitDef(b.id).name).join(', ')}. Members fill the board round the banners, each captain's first, then each one's second, and so on; only a held detachment (a later start) enters once the battle is under way.`
            : `${onBoard} of ${board} bodies take the board: none wait in reserve.`))
      },
      h('span', { class: 'rs-label' }, 'Behind the camp'),
      heldBy.map(([d, bs]) => h('span', { class: 'rs-held', style: `--d:${d.color}` },
        h('span', { class: 'rs-tag' }, `${d.id} · ${whenTag(d.plan.when)}`),
        h('span', { class: 'rs-bodies' }, bs.map((b) => h('span', { class: 'rs-body' + (b.rank ? '' : ' soul'), style: b.rank ? banner(b.cohortOf) : null }, portrait(b.id, 22)))))),
      army.reserve.length
        ? [h('span', { class: 'rs-count' }, `${army.reserve.length} sit out`),
            h('span', { class: 'rs-bodies' }, army.reserve.map((b) => h('span', { class: 'rs-body', style: banner(b.cohortOf) }, portrait(b.id, 22))))]
        : null),
      h('div', {
        class: 'domain-key',
        tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'The Monarch\'s domain'),
          h('p', null, `Every tile within ${realm.domain} of ${crowned ? 'your front-most captain (Vanguard Crown: it moves with the front in battle)' : 'the Monarch'}, diagonals counting as one. A soul or member outside it falters: ×${TUNING.monarch.falter} damage dealt while it stands out there. Arise only raises corpses inside it.`),
          h('p', null, ORDER_TEXT.leash),
          h('p', null, reachText), h('p', { class: 'dim' }, 'Dominion widens it by a tile a point.' + (s.keystones.some((id) => keystoneDef(id).domain)
            ? ` Keystones: ${s.keystones.filter((id) => keystoneDef(id).domain).map((id) => `${keystoneDef(id).name} ${keystoneDef(id).domain > 0 ? '+' : '−'}${Math.abs(keystoneDef(id).domain)}`).join(', ')}.` : '')))
      }, h('i', { class: 'dk-box' }), `Domain: ${realm.domain} tiles. `, h('span', { class: 'dim' }, reachText),
      out.length > 0 && h('span', { class: 'falter-note' }, ` ${out.length} ${army.members.some((x) => out.includes(x)) ? `bod${out.length > 1 ? 'ies' : 'y'}` : `soul${out.length > 1 ? 's' : ''}`} outside will falter.`)),
      lineKey(lineY, mTile, approach, bare),
      marshals.length > 0 && h('div', {
        class: 'domain-key marshal-key',
        tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'A Marshal\'s domain'), h('p', null, RANK_TEXT.marshal),
          h('p', { class: 'dim' }, 'Outlined here around where each Marshal starts; in battle it moves with the Marshal.'))
      }, marshals.map(({ x, colour }) => h('span', { class: 'mk' }, h('i', { class: 'mk-box', style: `--m:${colour}` }), `${unitDef(x.id).name}: ${TUNING.ranks.domain} tiles`)),
      h('span', { class: 'dim' }, 'Its banner never falters within it.')))
    // The bench sits under the board: it is where a selected soul is dropped to bench it.
    const benchEl = h('div', { class: 'bench-row' },
      h('span', { class: 'rs-label', tip: () => 'Souls here are kept but do not fight, and lead no cohort into battle. Swap them onto the field at any time before a battle. The Monarch never comes here.' }, `Bench ${bench.length}`),
      h('div', {
        class: 'bench' + (benchable(moving) ? ' target' : ''),
        onclick: (e) => { if (e.target === e.currentTarget) clickBenchSpace() },
        tip: () => benchable(moving) ? `Click empty space here to bench ${unitDef(moving.id).name}.`
          : moving && isMonarch(moving) ? 'The Monarch never goes to the bench.' : 'Benched souls. Select a soul on the field, then click here to bench it.'
      },
      bench.length
        ? bench.map((u) => h('button', {
          class: 'cell has' + (picked === u ? ' sel' : '') + (u.hp <= 0 ? ' fallen' : '') + (colours.has(u.uid) ? ' captain' : ''),
          style: styles(banner(u.uid), detOf(u) && `--d:${detOf(u).color}`),
          onclick: (e) => clickBench(u, e),
          tip: () => soulTip(u, 'On the bench: does not fight.',
            picked === u ? 'Click again to deselect.' : moving && isMonarch(moving) ? 'The Monarch cannot trade places with a benched soul.'
              : moving && moving.slot >= 0 ? `Click to swap it with ${unitDef(moving.id).name} on the field.`
                : sel?.slot != null ? (full() ? fullText(u) : 'Click to place it in the selected cell.') : 'Click to select, then click a field slot to place it.')
        }, cellBody(u, false, false, null, null, detOf(u))))
        : h('span', { class: 'dim empty-bench', onclick: clickBenchSpace }, benchable(moving) ? 'Click here to bench the selected soul.' : 'Empty.')))

    // The tray: one tab at a time. Selecting a soul opens its tab, the Monarch its own, and picking souls
    // for a detachment the orders (unless the orders are already open: there a click joins or starts one).
    const selUid = picked ? picked.uid : null
    if (selUid !== null && selUid !== lastSel && trayTab !== 'orders') trayTab = isMonarch(picked) ? 'monarch' : 'soul'
    if (pick.length > lastPick || aim != null) trayTab = 'orders'
    lastSel = selUid
    lastPick = pick.length
    const synergies = synergyTracker(all, alias)
    const tabs = [
      { id: 'soul', name: 'Soul', tip: () => 'The selected soul: its level, path, rank and cohort.' },
      { id: 'monarch', name: 'Monarch', tip: () => 'Dominion, Command and Will: the Monarch\'s three stats.' },
      { id: 'orders', name: 'Orders', count: s.detachments.length, tip: () => 'Detachments and their plans: Hunt, Stay or Move, now or later.' },
      { id: 'ossuary', name: 'Ossuary', count: armyCount(s, 'standing'), tip: () => 'Your rank-and-file bodies and the muster level they fight at.' },
      { id: 'bonuses', name: 'Bonuses', count: synergies.querySelectorAll('.syn.on').length + s.relics.length + s.keystones.length, tip: () => 'Synergies, bonds, relics and keystones in effect.' }]
    const pickTab = (id) => { trayTab = id; prefs.set('tray', id); render() }
    const body = {
      soul: () => picked && !isMonarch(picked)
        ? [cohortPanel(picked), rankPanel(picked), upgradePanel(picked)]
        : h('p', { class: 'dim upgrade-hint' }, picked
          ? 'The Monarch grows by its own points: see the Monarch tab.'
          : `Select a soul in the camp to level it, give it a cohort or promote it. You have ${s.essence} essence.`),
      monarch: () => monarchPanel(picked && isMonarch(picked)),
      orders: () => ordersPanel(picked),
      ossuary: () => ossuaryPanel(),
      bonuses: () => [h('h2', null, 'Synergies'), synergies, h('h2', null, 'Bonds'), bondTracker(all, alias),
        h('h2', null, 'Relics'), relicList(s.relics), h('h2', null, 'Keystones'), keystoneList(s.keystones)]
    }
    fill(el,
      h('div', { class: 'board-col' }, boardEl, benchEl),
      h('div', { class: 'tray' },
        tabBar(tabs, trayTab, pickTab),
        error && h('p', { class: 'warn' }, error),
        h('div', { class: 'tab-body' }, body[trayTab]())))
    drawArrows(boardEl, arrows)
  }

  // The arrows from each Move detachment to its square, over the board: an SVG laid on it once it has its
  // layout (and again whenever it changes size), from the cells' own positions. Dashed for a held
  // detachment (it walks from beside the Monarch); faded for a square outside the domain.
  function drawArrows (board, arrows) {
    observer?.disconnect()
    observer = null
    if (!arrows.length || typeof ResizeObserver === 'undefined') return
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('class', 'plan-arrows')
    svg.setAttribute('aria-hidden', 'true')
    board.append(svg)
    const make = (tag, attrs) => {
      const e = document.createElementNS(NS, tag)
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
      return e
    }
    const draw = () => {
      const box = board.getBoundingClientRect()
      if (!box.width) return
      svg.setAttribute('width', box.width)
      svg.setAttribute('height', box.height)
      const centre = (tile) => {
        const c = board.querySelector(`[data-tile="${tile}"]`)
        if (!c) return null
        const r = c.getBoundingClientRect()
        return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top, w: r.width }
      }
      svg.replaceChildren(...arrows.flatMap((a) => {
        const ps = a.from.map(centre).filter(Boolean)
        const to = centre(a.to)
        if (!ps.length || !to) return []
        const fx = ps.reduce((n, p) => n + p.x, 0) / ps.length
        const fy = ps.reduce((n, p) => n + p.y, 0) / ps.length
        const [dx, dy] = [to.x - fx, to.y - fy]
        const len = Math.hypot(dx, dy)
        const stop = to.w * 0.42
        if (len < stop + 16) return []
        const [ux, uy] = [dx / len, dy / len]
        const [ex, ey] = [to.x - ux * stop, to.y - uy * stop]
        const [bx, by] = [ex - ux * 10, ey - uy * 10]
        const g = make('g', { opacity: a.far ? 0.45 : 0.9 })
        g.append(
          make('line', { x1: fx + ux * 12, y1: fy + uy * 12, x2: bx, y2: by, stroke: a.color, 'stroke-width': 2.5, 'stroke-linecap': 'round', ...(a.far || a.held ? { 'stroke-dasharray': '6 5' } : {}) }),
          make('polygon', { points: `${ex},${ey} ${bx - uy * 6},${by + ux * 6} ${bx + uy * 6},${by - ux * 6}`, fill: a.color }),
          make('circle', { cx: fx, cy: fy, r: 3.5, fill: a.color }))
        return [g]
      }))
    }
    observer = new ResizeObserver(draw)
    observer.observe(board)
  }

  render()
  return {
    el,
    key (e) {
      if (e.key !== 'Escape') return
      if (aim != null) aim = null
      else if (pick.length || picking) unpick()
      else if (sel) { sel = null; soft = false }
      else return
      error = ''
      render()
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
  return h('div', { class: 'unit' + (u.hp <= 0 ? ' fallen' : '') + (d.monarch ? ' monarch' : ''), tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run) }) },
    h('span', { class: 'cell-port' }, portrait(u.id, 32, u.hp <= 0)),
    h('div', { class: 'grow' },
      h('div', null, h('b', null, d.name), ` Lv ${u.lvl}`, u.grade > 0 && h('span', { class: `rank-tag g${u.grade}` }, icon(GRADE_ICON[u.grade], 12), GRADES[u.grade].name),
        u.path && h('span', { class: 'path-tag' }, ` ${pathDef(u.id, u.path).name} ${ROMAN[u.tier - 1]}`), u.path2 && h('span', { class: 'path-tag p2' }, ` · ${pathDef(u.id, u.path2).name} ${ROMAN[u.tier2 - 1]}`),
        h('span', { class: 'dim' }, ` · ${d.monarch ? 'you' : `${KIN[d.kin].name} ${ROLES[d.role].name}`}${u.slot < 0 ? ' · bench' : ` · ${campRowLabel(rowOf(u.slot)).toLowerCase()}`}${u.cohort ? ` · leads ${bodies(u.cohort.kind, u.cohort.count)}` : ''}`)),
      h('div', { class: 'line' }, hpBar(u), h('span', { class: 'dim' }, u.hp > 0 ? `${u.hp}/${u.maxHp}` : 'fallen'))),
    extra)
}

// A soul's cell. A captain wears its banner's flag (its colour comes from the cell's --b) with its cohort's
// size, a Knight or Marshal its insignia, and its path tiers as pips (a second path's in violet); `member`, a
// rank-and-file standing on a fallen soul's cell, shows as a small ghost in the corner, edged in its own
// banner's colour (`memberColour`). A soul in a detachment (`det`) wears its tag (the cell's --d): its id,
// ■ on Stay, → on Move; a held one's start sits at its top.
const WHERE_MARK = { hunt: '', stay: ' ■', move: ' →' }
function cellBody (u, bonded = false, falters = false, member = null, memberColour = null, det = null) {
  return [
    bonded && h('span', { class: 'bond-mark' }, '◆'),
    falters && h('span', { class: 'falter-mark', 'aria-label': 'falters' }, `×${TUNING.monarch.falter}`),
    det && waits(det) && onField(u) && h('span', { class: 'start-tag', 'aria-label': `enters ${whenText(det.plan.when)}` }, whenTag(det.plan.when)),
    portrait(u.id, 46, u.hp <= 0),
    h('span', { class: 'badge' }, ` ${u.lvl}`),
    u.tier > 0 && h('span', { class: 'tier-pips', 'aria-label': `path tier ${u.tier}` }, '▴'.repeat(u.tier)),
    u.tier2 > 0 && h('span', { class: 'tier-pips p2', 'aria-label': `second path tier ${u.tier2}` }, '▴'.repeat(u.tier2)),
    u.grade > 0 && h('span', { class: `rank-mark g${u.grade}`, 'aria-label': GRADES[u.grade].name }, icon(GRADE_ICON[u.grade], 13)),
    u.cohort && h('span', { class: 'flag', 'aria-label': `leads ${u.cohort.count}` }, u.cohort.count),
    det && h('span', { class: 'det-tag', 'aria-label': `detachment ${det.id}, ${det.plan.where}` }, det.id, WHERE_MARK[det.plan.where]),
    member && h('span', { class: 'under', style: memberColour ? `--b:${memberColour}` : null }, portrait(member.id, 20)),
    u.maxHp && hpBar(u)]
}

// Why a cell is a bad seat for the Monarch: it never steps, and only a flanker walks through a body.
const sealText = (n) => `Here it seals ${n} cell${n === 1 ? '' : 's'} of the camp off from the fight: the Monarch never steps, and only a flanker walks through a body, so whoever stands behind it can never get out.`

// The line and the Monarch's approach, for the camp editor (reDESIGN, what prep shows): how many rows the
// front-most row anyone starts on stands ahead of the Monarch and short of their formation's front, and how
// many of the tiles beside the Monarch are held at the start.
function lineKey (lineY, mTile, approach, bare) {
  const ahead = lineY === null ? null : lineY - tileY(mTile)
  const gap = lineY === null ? null : DEPTH - ROWS - lineY
  const rows = (n) => `${n} row${n === 1 ? '' : 's'}`
  return h('div', {
    class: 'domain-key line-key',
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'The line and the Monarch\'s approach'),
      h('p', null, 'The line is the front-most row any of yours starts on. Its distance from the Monarch is how far a foe must get past it to strike the Monarch; its distance from their front is the ground the two sides close over, where Reach strikes first.'),
      h('p', null, 'The approach tiles are the open tiles beside the Monarch (dashed red when bare): a foe that stands on one strikes it, and a flanker walks to the nearest open one. Held by a soul or a body, they screen it.'))
  },
  h('span', null, lineY === null ? 'No line: no one of yours starts on the board.'
    : ahead > 0 ? `Line: ${rows(ahead)} ahead of the Monarch, ${rows(gap)} short of their front.`
      : ahead === 0 ? `Line: level with the Monarch, ${rows(gap)} short of their front.`
        : `Line: the Monarch stands ${rows(-ahead)} ahead of it, ${rows(gap)} short of their front.`),
  h('span', { class: bare.length ? 'falter-note' : 'dim' }, ` Approach: ${approach.size - bare.length} of ${approach.size} tiles beside the Monarch held.`))
}

// A cohort member's cell: its portrait ghosted, in its banner's colour, at the muster level; a dot in its
// detachment's colour (the cell's --d) when its captain has one.
function memberBody (m, bonded, falters, muster, det = null) {
  return [
    bonded && h('span', { class: 'bond-mark' }, '◆'),
    falters && h('span', { class: 'falter-mark', 'aria-label': 'falters' }, `×${TUNING.monarch.falter}`),
    portrait(m.id, 40),
    h('span', { class: 'badge' }, ` ${muster}`),
    det && h('span', { class: 'det-dot', 'aria-label': `detachment ${det.id}` })]
}

// Scouted foes as units the cards and bonds can read: no uid yet, so the slot stands in for one (a member's
// cohortOf is already its captain's slot), and a member is rank-and-file of its captain's cohort.
const scouted = (foes) => foes.map((f) => ({ ...f, uid: f.slot, ...(f.cohortOf != null && { rank: true }) }))

// What a scouted foe's card says of its banner: a captain and the size of its cohort, or whose cohort a
// member is in. The rule, never the order a captain was given.
const bannerNote = (foes, u, led) => led.has(u.slot) ? ENEMY_TEXT.captain(led.get(u.slot), unitDef(u.id).boss)
  : u.cohortOf != null ? ENEMY_TEXT.of(foes.find((f) => f.slot === u.cohortOf).id) : null

// The foes' formation, read-only, front row at the bottom so it faces yours. `dom` (domainOn) marks the
// cells the Monarch's domain reaches: their front row is the second row past your camp's front. `ground`
// (the camp editor's): { deco(tile) → { cls, style, tags }, the Move squares and the aim on a tile;
// onTile(tile), a click while a detachment aims; tip(title, text, tile, inside), an empty cell's tooltip }.
// `marshals`: the Marshals' own domains to outline (marshalSquares). A captain carries a flag with its
// cohort's size; its members stand a size smaller, edged like it.
function foeGrid (run, node, dom = null, ground = null, marshals = []) {
  const mods = roomFoeMods(run, node)
  const foes = scouted(node.foes)
  const led = cohortSizes(foes)
  const at = new Map(foes.map((f) => [f.slot, f]))
  const bonded = new Set(activeBonds(foes).map((b) => b.uid))
  const rows = []
  for (let r = ROWS - 1; r >= 0; r--) {
    const cells = []
    for (let c = 0; c < COLS; c++) {
      const slot = slotAt(r, c)
      const u = at.get(slot)
      const tile = deployTile('foe', slot)
      // Their row r is camp row −2 − r on the Monarch's grid (the gap row is −1).
      const inside = !!dom?.inside(-2 - r, c)
      const area = inside ? ' dom' + dom.edges(-2 - r, c) : ''
      const sq = ground?.deco(tile) ?? {}
      const where = `${FOE_ROW_LABEL[r].toLowerCase()} row, lane ${c + 1}`
      cells.push(h('div', {
        class: 'cell foe' + area + (u ? ' has' : ' empty') + (u && led.has(u.slot) ? ' foe-cap' : '') + (u?.rank ? ' foe-mem' : '') + (sq.cls ?? ''), style: sq.style, 'data-tile': tile,
        onclick: ground?.onTile ? () => ground.onTile(tile) : null,
        tip: u ? () => unitCard(u, { mods: [...mods, ...bondMods(foes, u)], foe: true, ordered: node.type === 'elite' && (led.has(u.slot) || u.cohortOf != null), notes: [`Enemy, ${FOE_ROW_LABEL[r].toLowerCase()} row. Stats include this floor's multipliers and their synergies.`, bannerNote(foes, u, led), ...bondNotes(foes, u), ...(ground?.notes?.(tile) ?? [])] })
          : ground ? ground.tip(`Their ground: ${where}`, 'Where their formation stands when the battle begins.', tile, inside) : null
      }, marshalSquares(marshals, -2 - r, c), u && [bonded.has(u.uid) && h('span', { class: 'bond-mark' }, '◆'), portrait(u.id, u.rank ? 38 : 46), h('span', { class: 'badge' }, ` ${u.lvl}`),
        led.has(u.slot) && h('span', { class: 'flag', 'aria-label': `captain of ${led.get(u.slot)}` }, led.get(u.slot))], sq.tags))
    }
    rows.push(h('div', { class: 'row' }, h('span', { class: 'rowname foe' }, FOE_ROW_LABEL[r]), cells))
  }
  return h('div', { class: 'grid foes' }, rows)
}

// The waves still to come behind their formation, scouted like it: each a small formation of its own (its
// captains flagged), with when it comes, and every foe's card on hover. Never what they will do. The grid is
// a picture of roles and lanes only: a wave enters at the far edge in its lane (a cohort beside its captain),
// not in its scouted row, and takes its bonds and synergies from where it enters and who still stands then,
// so its cards carry the floor's multipliers alone.
function wavePreview (run, node) {
  return h('div', { class: 'waves' }, node.waves.map((w, k) => {
    const mods = roomFoeMods(run, node, [])
    const foes = scouted(w.foes)
    const led = cohortSizes(foes)
    const at = new Map(foes.map((f) => [f.slot, f]))
    const rows = []
    for (let r = ROWS - 1; r >= 0; r--) {
      const cells = []
      for (let c = 0; c < COLS; c++) {
        const u = at.get(slotAt(r, c))
        cells.push(h('span', {
          class: 'wcell' + (u ? ' has' : '') + (u && led.has(u.slot) ? ' cap' : '') + (u?.rank ? ' mem' : ''),
          tip: u ? () => unitCard(u, { mods, foe: true, ordered: node.type === 'elite' && (led.has(u.slot) || u.cohortOf != null), notes: [`${waveName(node, k)}, in this lane. ${waveWhen(w)}`, 'Stats include this floor\'s multipliers only: its bonds and synergies come from where it enters and who still stands.', bannerNote(foes, u, led)] }) : null
        }, u && portrait(u.id, u.rank ? 17 : 20), u && led.has(u.slot) && h('i', { class: 'mini-flag' }, led.get(u.slot))))
      }
      rows.push(h('div', { class: 'wrow' }, cells))
    }
    return h('div', { class: 'wave-card' },
      h('div', { class: 'wave-head' }, h('b', null, waveName(node, k)), h('span', { class: 'dim small' }, ` · ${w.foes.length} foe${w.foes.length > 1 ? 's' : ''}`)),
      h('div', { class: 'wgrid' }, rows),
      h('div', { class: 'dim small' }, waveWhen(w)))
  }))
}

function relicList (ids) {
  if (!ids.length) return h('p', { class: 'dim' }, 'None yet. Relics come from reliquaries and elites.')
  return h('div', { class: 'relics' }, ids.map((id) =>
    h('span', { class: 'relic', tip: () => relicTip(id) }, icon('reliquary', 14), relicDef(id).name)))
}

function keystoneList (ids) {
  if (!ids.length) return h('p', { class: 'dim' }, `None yet. From floor ${TUNING.keystone.fromFloor}, won elites and rites offer them.`)
  return h('div', { class: 'relics' }, ids.map((id) =>
    h('span', { class: 'relic keystone', tip: () => keystoneTip(id) }, icon('keystone', 14), keystoneDef(id).name)))
}
