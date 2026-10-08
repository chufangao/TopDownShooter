// The DOM side: title, floor map, prep, reap and end screens, the playback bar under the battle canvas,
// and the parts they share. Screens only read run.state and report input upward; the retinue editor
// sends its actions through act(action), which returns an error message or null. Every control has a
// tooltip saying exactly what it does (rules text lives in codex.js).
import { TUNING } from './tuning.js'
import {
  apply, availableNodes, fieldCap, rosterCap, fielded, benched, currentNode, levelCost, tierCost, souls, isMonarch, monarchOf, monarchCost,
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
import { statsOf } from './sim/unit.js'
import { kw, KEYWORDS } from './keywords.js'
import { sfx } from './sfx.js'
import { monarchNextText } from './codex.js'
// The retinue editor's board: the battle's own, drawn in Phaser (board.js), under a layer that takes the pointer.
import { board, capsTag } from './board.js'
import { showTip, hideTip } from './dom.js'
import { armyLayout } from './sim/run.js'
import { tileX } from './sim/unit.js'
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
  // The four steps of a run, one line each in its system's colour; the terms explain themselves on hover.
  const step = (ico, sys, title, ...text) => h('div', { class: 'step', style: `--s:var(--c-${sys})` }, h('div', { class: 'step-ico' }, icon(ico, 22)), h('div', null, h('b', null, title), h('p', null, text)))
  const el = h('div', { class: 'screen title-screen' },
    h('div', { class: 'title-box' },
      h('div', { class: 'sigil' }, icon('soul', 54)),
      h('h1', { class: 'logo' }, 'RETINUE'),
      h('p', { class: 'tagline' }, 'You are the Monarch, a necromancer, and the dead fight for you.', h('br'), 'Descend four floors and unmake the Hollow Sovereign, then go on into the deep for as long as you last.'),
      h('div', { class: 'steps brief' },
        step('crown', 'monarch', 'Stand', 'You are the ', kw('monarch'), ' and never strike. Beyond your ', kw('domain'), ', souls ', kw('falter'), '.'),
        step('fight', 'foe', 'Scout', 'Hover a room to see its foes. What they do, you learn by fighting.'),
        step('start', 'orders', 'Arrange', 'Place your ', kw('banner', 'banners'), ' in the camp. The battle then plays out alone.'),
        step('soul', 'essence', 'Reap', 'The slain pay ', kw('essence'), ', and you ', kw('bind'), ' their bodies.')),
      h('div', { class: 'title-actions' },
        h('button', { class: 'primary big', onclick: start, tip: () => 'Start a new run with this seed. (Enter)' }, 'Begin the descent ', h('kbd', null, 'Enter')),
        h('button', { class: 'ghost', onclick: onHelp, tip: () => 'Rules, the board, synergies and relics. (H)' }, icon('help'), ' How to play')),
      h('label', { class: 'seed', tip: () => 'The same seed always makes the same maps, foes and battles. Share one to play the same run.' }, 'seed ', input)))
  return { el, key: (e) => { if (e.key === 'Enter') start() } }
}

// ── shared chrome ────────────────────────────────────────────────────────────────────────────────

// The run as a row of icons (the Slay the Spire bar): the floors, the purse, the Monarch's HP, a tile per
// relic and keystone held (hover one for what it does), then sound and help. The bar is rebuilt on every
// change: `drawn` keeps what it last showed, so a changed purse rolls to its new value and flashes, and a
// relic or keystone just taken pops in.
// The bodies standing in the ossuary get the same: a count that rolls, except while bound bodies are still
// flying to it (`landing`, set by the spoils: flyBones rolls it as they land).
const drawn = { run: null, essence: 0, hp: 0, bones: 0, landing: false, held: new Set() }
const standingBodies = (s) => Object.values(s.ossuary).reduce((n, k) => n + k.standing, 0)

function topbar (run, onHelp) {
  const s = run.state
  const fresh = drawn.run !== run
  if (fresh) Object.assign(drawn, { run, essence: s.essence, hp: monarchOf(s).hp, bones: standingBodies(s), landing: false, held: new Set([...s.relics, ...s.keystones]) })
  const purse = h('b', null, Math.round(drawn.essence))
  const chip = h('span', { class: 'chip-stat essence', tip: () => `Essence: slain foes pay it. Spend it on your souls, the Monarch and the ossuary. ${s.stats.essence} earned, ${s.stats.spent} spent this run.` },
    icon('soul', 14), purse)
  if (drawn.purse) cancelAnimationFrame(drawn.purse.rolling)
  drawn.purse = purse
  roll(purse, drawn.essence, s.essence, chip, (v) => { drawn.essence = v })
  const kinds = Object.entries(s.ossuary).filter(([, k]) => k.standing > 0)
  const count = h('b', null, Math.round(drawn.bones))
  const bones = h('span', {
    class: 'chip-stat bodies',
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'The ossuary'),
      h('p', null, kinds.length ? `${standingBodies(s)} bodies standing: ${kinds.map(([id, k]) => bodies(id, k.standing)).join(', ')}.` : 'No bodies standing: bind the slain after a battle to raise them.'),
      h('p', { class: 'dim' }, `They fight at the muster level (${s.muster}), whatever level they fell at.`))
  }, icon('bone', 14), count)
  if (drawn.count) cancelAnimationFrame(drawn.count.rolling)
  drawn.count = count
  if (!drawn.landing) roll(count, drawn.bones, standingBodies(s), bones, (v) => { drawn.bones = v })
  const held = drawn.held
  drawn.held = new Set([...s.relics, ...s.keystones])
  // A relic's tile wears its own glyph; the keystones share one, told apart by a letter pair.
  const tile = (cls, id, name, glyph, tag, tipFn) => h('span', { class: `trinket ${cls}` + (held.has(id) ? '' : ' new'), 'data-id': id, tabindex: '0', 'aria-label': name, tip: tipFn },
    icon(glyph, 15), tag && h('i', null, tag))
  const n = s.relics.length + s.keystones.length
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, icon('soul', 20), h('span', null, 'RETINUE')),
    floorPips(s),
    h('div', { class: 'chips' }, chip, monarchChip(run), bones),
    n > 0 && h('div', { class: 'trinkets' },
      s.relics.map((id) => tile('t-relic' + (relicDef(id).on ? ' trig' : ''), id, relicDef(id).name, relicIcon(id), null, () => relicTip(id))),
      s.keystones.map((id) => tile('t-keystone', id, keystoneDef(id).name, 'keystone', letterPair(keystoneDef(id).name), () => keystoneTip(id, run)))),
    h('div', { class: 'top-btns' },
      muteButton(),
      h('button', { class: 'icon-btn', onclick: onHelp, tip: () => 'How to play (H)' }, icon('help', 20))))
}

// Each relic's own glyph (dom.js PATHS); one with none falls back to the reliquary's.
const RELIC_ICON = {
  whetstone: 'r-whetstone', grave_banner: 'r-banner', soul_lantern: 'r-lantern', hourglass: 'r-hourglass', heartwood: 'r-heartwood',
  tower_shield: 'r-tower', blood_chalice: 'r-chalice', war_drum: 'r-drum', balm: 'r-balm', tithe_bowl: 'r-bowl', grave_ledger: 'r-ledger',
  rite_candle: 'r-candle', binding_chain: 'r-chain', ossuary_key: 'r-key', iron_oath: 'r-oath', arcane_focus: 'r-focus', hunters_mark: 'r-claw',
  bone_idol: 'r-idol', glass_crown: 'r-glass', grave_bell: 'r-bell', rally_horn: 'r-horn'
}
const relicIcon = (id) => RELIC_ICON[id] ?? 'reliquary'
// A keystone's tag: its words' initials ("One Army" OA), or a one-word name's first two letters ("Legion" Le).
const letterPair = (name) => {
  const words = name.split(/\s+/)
  return words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 2).toUpperCase() : name.slice(0, 2)
}

// Counts `el` from `from` to `to` (rounded as it goes), then flashes `host` (green for a gain, red for a
// loss); onStep sees every value drawn, so a re-render mid-roll carries on from where it got to. Reduced
// motion: it jumps, and still flashes.
export function roll (el, from, to, host = el, onStep = null) {
  cancelAnimationFrame(el.rolling)
  if (from === to) { el.textContent = Math.round(to); onStep?.(to); return }
  host.classList.remove('gain', 'spend')
  void host.offsetWidth
  host.classList.add(to > from ? 'gain' : 'spend')
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const ms = still ? 0 : Math.min(700, 260 + Math.abs(to - from) * 6)
  const t0 = performance.now()
  const step = (now) => {
    const f = ms ? Math.min(1, (now - t0) / ms) : 1
    const v = from + (to - from) * (1 - (1 - f) ** 3)
    el.textContent = Math.round(f >= 1 ? to : v)
    onStep?.(f >= 1 ? to : v)
    if (f < 1) el.rolling = requestAnimationFrame(step)
  }
  el.rolling = requestAnimationFrame(step)
}

// The speaker: sound on or off (M), remembered between visits. It draws both icons; <html data-muted>
// (set by sfx) shows the one that holds.
export function muteButton () {
  return h('button', {
    class: 'icon-btn mute-btn',
    'data-sfx': 'none',
    'aria-label': 'Sound on or off',
    onclick: () => { if (!sfx.toggle()) sfx.play('click') },
    tip: () => 'Sound on or off. (M)'
  }, icon('sound', 20), icon('mute', 20))
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
  h('span', null, `Floor ${s.floor}`, deep > 0 && h('span', { class: 'fl-deep' }, ` · deep ${deep}`)))
}

// The Monarch's HP, always in view: if it falls, the run ends.
// A wound or a heal since the bar was last drawn flashes it (see topbar's `drawn`).
function monarchChip (run) {
  const m = monarchOf(run.state)
  const low = m.hp / m.maxHp < 0.35
  const moved = drawn.run === run && drawn.hp !== m.hp ? (m.hp > drawn.hp ? ' gain' : ' spend') : ''
  if (drawn.run === run) drawn.hp = m.hp
  return h('span', {
    class: 'chip-stat monarch' + (low ? ' low' : '') + moved,
    tip: () => unitCard(m, {
      mods: partyMods(run, m),
      realm: realmOf(run),
      notes: [holds(run.state, 'unhealable')
        ? 'The Monarch is you. Its wounds carry from battle to battle, and under Court of Bone nothing heals them: not a win, not an altar.'
        : 'The Monarch is you. Its wounds carry from battle to battle: it heals like a soul after a win and at altars.']
    })
  }, icon('crown', 14), m.lvl > 0 && h('span', { class: 'dim' }, `Lv ${m.lvl}`), h('b', null, `${m.hp}/${m.maxHp}`))
}

// A dismissible strip of numbered steps for a screen; it remembers being closed. On a short screen, where it
// costs the board its room, it starts closed from the second visit on (unless brought back with Show tips).
function guide (key, steps) {
  const el = h('div', { class: 'guide' })
  const seen = prefs.get('seen:' + key) === '1'
  prefs.set('seen:' + key, '1')
  const render = () => {
    const pref = prefs.get('guide:' + key)
    const hidden = pref === 'off' || (pref !== 'on' && seen && matchMedia('(max-height: 820px)').matches)
    fill(el, hidden
      ? h('button', { class: 'link', onclick: () => { prefs.set('guide:' + key, 'on'); render() }, tip: () => 'Show the steps for this screen again.' }, 'Show tips')
      : h('div', { class: 'guide-box' },
        h('ol', null, steps.map((s) => h('li', null, s))),
        h('button', { class: 'icon-btn small', onclick: () => { prefs.set('guide:' + key, 'off'); render() }, tip: () => 'Hide these tips. "Show tips" brings them back.' }, icon('close', 14))))
  }
  render()
  return el
}

// A row of tabs: [{ id, name, short?, count?, key?, ico?, desc? }]. `count` is a small badge, shown when above 0;
// `key` its shortcut. With an `ico`, the count is a pill on the icon's corner and the label (`short`, else the
// name) may go when the row is short of room (the tray's tabs, by a container query in style.css); `desc` and
// the full name are on hover.
function tabBar (tabs, on, pick, cls = '') {
  return h('div', { class: 'tabs ' + cls, role: 'tablist' }, tabs.map((t) => h('button', {
    class: 'tab' + (t.id === on ? ' on' : ''), role: 'tab', 'aria-selected': t.id === on ? 'true' : 'false', 'aria-label': t.ico ? t.name : null,
    onclick: () => pick(t.id), tip: t.desc ? () => h('div', { class: 'syn-tip' }, h('b', null, t.name), h('p', null, t.desc)) : t.tip
  }, t.ico
    ? [h('span', { class: 'tab-ico' }, icon(t.ico, 17), t.count > 0 && h('span', { class: 'tab-count' }, t.count)), h('span', { class: 'tab-name' }, t.short ?? t.name)]
    : [t.name, t.count > 0 && h('span', { class: 'tab-count' }, t.count)], t.key && h('kbd', null, t.key))))
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

  // A floor is taller than the screen: the route scrolls, and opens on the room you stand in. Its top edge falls
  // between two rows of rooms, never through one: a little space is added under the floor's start when the
  // bottom of the scroll would stop short of that.
  const aim = (sc) => {
    sc.style.paddingBottom = ''
    if (sc.scrollHeight <= sc.clientHeight) return
    const pad = parseFloat(getComputedStyle(sc).paddingTop)
    const max = sc.scrollHeight - sc.clientHeight
    const want = Math.min(pos(currentNode(run)).y - sc.clientHeight / 2, max)
    // A room (its medal and name) stands centred in its row's band, with a sliver between bands: the edge goes
    // on a band's boundary. Near the bottom, the one above when that leaves only the floor's padding unseen.
    const at = (k) => (k > 0 ? pad + k * ROW_H : 0)
    let k = Math.round((want - pad) / ROW_H)
    if (at(k) > max && max - at(k - 1) <= parseFloat(getComputedStyle(sc).paddingBottom)) k--
    const top = at(k)
    const short = top - max
    if (short > 0) sc.style.paddingBottom = `${parseFloat(getComputedStyle(sc).paddingBottom) + short}px`
    sc.scrollTop = top
  }
  const scroller = h('div', { class: 'dag-scroll' }, h('div', { class: 'dag', style: `height:${H}px` }, svg, nodes))

  // Two tabs: the route, with the retinue's wounds beside it; and the camp, to arrange and spend between rooms.
  let tab = 'route'
  const body = h('div', { class: 'map-body' })
  // A switch drops the old tab's tooltip, and any press or drag still held on the camp's board.
  const show = (id) => {
    tab = id
    hideTip()
    editor.release()
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
        : h('div', { class: 'camp-panel' }, editor.el))
    if (tab === 'route') requestAnimationFrame(() => aim(scroller))
    else editor.shown()
  }
  show('route')

  const el = h('div', { class: 'screen map-screen' },
    bar,
    note && h('div', { class: 'note' }, note),
    guide('map', [
      [h('b', null, 'Hover'), ' a room to scout it.'],
      [h('b', null, 'Click'), ' a glowing room (or its number).'],
      [h('b', null, 'Camp'), ' (C): arrange and spend ', kw('essence'), '.']]),
    body)
  return {
    el,
    key (e) {
      const n = reach[Number(e.key) - 1]
      if (n) { editor.release(); onNode(n.id) }
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
  // Begin lets go of a press or a drag still held on the board first: its release must do nothing.
  const go = () => { if (canGo()) { editor.release(); onFight() } }
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
    return [n > 0 && ARMY_TEXT.reserve(n),
      ds.length > 0 && `Held behind the camp: ${ds.map((d) => {
        const k = held.filter((b) => b.det === d.id).length
        return `detachment ${d.id} (${k}) enters ${whenText(d.plan.when)}`
      }).join('; ')}.${TUNING.army.overflow ? ' Once called, they enter ahead of the reserve.' : ''}`].filter(Boolean)
  }
  // Begin, in the room's head.
  const beginButton = () => h('button', {
    class: 'primary big begin-btn',
    onclick: go,
    tip: () => canGo()
      ? h('div', { class: 'syn-tip' }, h('b', null, 'Begin the battle'), h('p', null, 'It plays out on its own: you cannot move or command anyone until it ends.'),
        warnings().map((w) => h('p', { class: 'warn' }, w)),
        reserveNote().map((n) => h('p', { class: 'dim' }, n)),
        wavesNote() && h('p', { class: 'dim' }, wavesNote()),
        h('p', { class: 'warn' }, `Losing ends the run: the Monarch falling loses at once, and so does a battle still undecided ${TUNING.tick.ceiling * TUNING.tick.ms / 1000} s after the start, or after the last foe entered.`))
      : 'The Monarch has fallen.'
  }, icon('play', 16), ' Begin ', h('kbd', null, 'Enter'))
  const el = h('div', { class: 'screen prep-screen' },
    bar,
    guide('prep', [
      [h('b', null, 'Drag'), ' a soul onto a tile. Keep souls in the ', kw('domain', holds(s, 'crown') ? 'gold domain' : 'green domain'), '.'],
      [h('b', null, 'Shift-click'), ' souls for a ', kw('detachment'), ' with orders.'],
      [h('b', null, 'Begin'), '. If the ', kw('monarch'), ' falls, the run ends.']]),
    h('div', { class: 'panel prep-head' },
      h('div', { class: 'ph-title' },
        h('span', { class: `room-ico t-${node.type}` }, icon(node.type, 22)),
        h('div', null,
          h('h2', null, ROOM[node.type].name),
          h('div', { class: 'dim' }, `${foeCountText(node)} · level ${node.foes[0].lvl}`),
          foeSynergyLine(node.foes, run))),
      meter,
      beginButton()),
    // The editor fills the rest of the screen: the board, and the tray beside it (board.css).
    editor.el)
  return {
    el,
    key (e) {
      if (e.key === 'Enter') go()
      else editor.key(e)
    }
  }
}

// ── reap ─────────────────────────────────────────────────────────────────────────────────────────

// Every offer's key, in the order the cards are shown: the cards to pick (a recruit, a relic, a keystone, a
// path's tier) take 1 to 9 and 0, then Q, W, E…; the slain to bind take Shift and the same keys in turn (⇧1…
// ⇧0, then ⇧Q, ⇧W…). An elite can lay out more than ten kinds to bind, and none goes without a key. Shift turns
// a digit into a symbol, so a bind's key is matched by its place (e.code). By offer index: { label, shift, code }.
const PICK_KEYS = [...'1234567890QWERTYUIOP']
const keyCode = (k) => (/\d/.test(k) ? `Digit${k}` : `Key${k}`)
function offerKeys (offers) {
  const keys = new Map()
  let p = 0
  let b = 0
  offers.forEach((o, i) => {
    if (o.type === 'bind') {
      if (b < PICK_KEYS.length) keys.set(i, { label: `⇧${PICK_KEYS[b]}`, shift: true, code: keyCode(PICK_KEYS[b++]) })
    } else if (p < PICK_KEYS.length) keys.set(i, { label: PICK_KEYS[p++], shift: false })
  })
  return keys
}
// A rite's offer as the soul card's track (card.css: .nodes, .tnode): the path's tiers I–IV (a second path's
// I–III), the held ones lit, the one offered glowing, a Knight's tier IV badged. Shown, not pressed.
function tierTrack (u, path, second) {
  const p = pathDef(u.id, path)
  const held = path === u.path ? u.tier : path === u.path2 ? u.tier2 ?? 0 : 0
  const upto = second ? SECOND_TIERS : p.tiers.length
  return h('div', { class: 'nodes offer-track', 'aria-label': `${p.name}: tier ${ROMAN[held]} of ${upto}, ${held} held` },
    Array.from({ length: upto }, (_, k) => [
      k > 0 && h('span', { class: 'tlink' + (k < held ? ' on' : k === held ? ' to' : '') }),
      h('span', { class: 'tnode ' + (k < held ? 'own' : k === held ? 'next' : 'later') }, h('span', { class: 'tnum' }, ROMAN[k]),
        !second && k === 3 && h('span', { class: 'tbadge g1' }, icon('knight', 10)))]))
}

// Shift and a digit by the key's place (Shift turns the digit into a symbol), the rest by what it types.
const pressed = (k, e) => k.shift ? e.shiftKey && e.code === k.code : !e.shiftKey && e.key.toUpperCase() === k.label

// The numbers in a card's effect line, picked out in the card's colour: +12%, 8 s, ×2, 40%.
const hiNums = (text) => String(text).split(/([+−×-]?\d+(?:\.\d+)?%?)/).map((part, k) => (k % 2 ? h('b', { class: 'num' }, part) : part))
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// ── arrivals: what is taken flies to where it now lives ──

// The things in flight sit on a layer of their own over the page, never in the pointer's way. A screen
// re-shown under them (the spoils after a bind) does not cut them short.
let flyLayer = null
const layer = () => {
  if (!flyLayer?.isConnected) document.body.append(flyLayer = h('div', { class: 'fly-layer', 'aria-hidden': 'true' }))
  return flyLayer
}
const centre = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 })
// A point kept inside the viewport: a target scrolled out of sight is flown at from the nearest edge.
const inView = (p) => ({ x: Math.min(Math.max(p.x, 28), innerWidth - 28), y: Math.min(Math.max(p.y, 28), innerHeight - 28) })

// `node` flies in an arc from viewport point `from` to `to`, shrinking to `scale`, after `delay` ms; the
// promise settles as it lands.
function flyOne (node, from, to, { delay = 0, ms = 560, scale = 0.5, lift = 60 } = {}) {
  node.classList.add('flyer')
  Object.assign(node.style, { left: `${from.x}px`, top: `${from.y}px` })
  layer().append(node)
  const [dx, dy] = [to.x - from.x, to.y - from.y]
  const at = (x, y, k) => `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${k})`
  const a = node.animate([
    { transform: at(0, 0, 0.6), opacity: 0 },
    { transform: at(0, -8, 1.15), opacity: 1, offset: 0.14 },
    { transform: at(dx / 2, dy / 2 - lift, 1), opacity: 1, offset: 0.55 },
    { transform: at(dx, dy, scale), opacity: 0.85 }
  ], { duration: ms, delay, easing: 'cubic-bezier(.45, .05, .5, 1)', fill: 'both' })
  return a.finished.catch(() => {}).finally(() => node.remove())
}

// A word that rises from a point and fades ("+3 bodies"); under reduced motion it only fades.
function popWord (at, text, cls = '') {
  const w = h('div', { class: 'fly-word ' + cls }, text)
  Object.assign(w.style, { left: `${at.x}px`, top: `${at.y}px` })
  layer().append(w)
  w.addEventListener('animationend', () => w.remove())
  setTimeout(() => w.remove(), 2000)
}

// The bodies just bound fly as bone chips from their cards (`from`: each card's rect and how many it bound)
// to the ossuary's count in the top bar, which counts up from `before` and pops "+N bodies" as they land. The
// bar was drawn meanwhile holding the old count (drawn.landing, set before the binds were sent).
function flyBones (from, before) {
  const total = from.reduce((n, f) => n + f.n, 0)
  const tally = document.querySelector('.topbar .chip-stat.bodies')
  const land = () => {
    drawn.landing = false
    const now = document.querySelector('.topbar .chip-stat.bodies')
    if (!now) return
    const r = now.getBoundingClientRect()
    roll(now.querySelector('b'), before, before + total, now, (v) => { drawn.bones = v })
    popWord({ x: (r.left + r.right) / 2, y: r.bottom + 30 }, `+${total} ${total === 1 ? 'body' : 'bodies'}`, 'w-bone')
  }
  if (!total || !tally || still()) return land()
  const end = centre(tally.getBoundingClientRect())
  let k = 0
  const flights = from.flatMap((f) => Array.from({ length: Math.min(f.n, 6) }, () => {
    const p = { x: f.rect.left + f.rect.width * (0.25 + 0.5 * Math.random()), y: f.rect.top + f.rect.height * (0.3 + 0.3 * Math.random()) }
    return flyOne(h('span', { class: 'bone-chip' }, icon('bone', 14)), p, end, { delay: (k++) * 55, ms: 640, scale: 0.7, lift: 50 + Math.random() * 40 })
  }))
  flights[0].then(land)
}

// A relic or keystone just taken flies from its card to its new tile in the top bar, and the tile pops in as
// it lands.
function flyTrinket (o, rect) {
  const find = () => document.querySelector(`.topbar .trinket[data-id="${o.id}"]`)
  const tile = find()
  if (!tile || !rect || still()) return
  tile.classList.add('arriving')
  const glyph = h('span', { class: 'trinket-flyer ' + (o.type === 'relic' ? 'f-relic' : 'f-keystone') }, icon(o.type === 'relic' ? relicIcon(o.id) : 'keystone', 44))
  flyOne(glyph, centre(rect), centre(tile.getBoundingClientRect()), { ms: 680, scale: 0.36, lift: 90 }).then(() => {
    // The bar may have been drawn again meanwhile: land on whatever stands there now.
    const now = find()
    if (!now) return
    now.classList.remove('arriving', 'new')
    void now.offsetWidth
    now.classList.add('new')
  })
}

// The room whose cards were last dealt: a bind or a release re-shows the same room, and its cards should not
// deal in again. `seen`: the room's groups of offers as dealt (a group taken is gone from the offers, and its
// step shows it done); `on`: the group in view.
let dealt = null

// The offers come in groups, one decision each, in this order: a recruit, a relic, a keystone, a path's tier,
// the slain to bind (so the keys run left to right: the picks' digits, then the binds' ⇧). Taking one offer of a
// group takes the group off the table; binding takes a kind's bodies, and the group goes with its last kind.
const GROUPS = ['soul', 'relic', 'keystone', 'tier', 'bind']
const GROUP_NAME = { soul: 'Recruit', relic: 'Relic', keystone: 'Keystone', tier: 'Path', bind: 'Bind' }

// onDone(index): take offer `index`, or null to move on. onBind(id, count): bind that many of a kind.
// The offers are cards to pick, framed in their system's colour. A room with more than one group shows them a
// group at a time behind a row of steps (Recruit · Relic · Bind), each step its group's one line; every
// offer's key works from any step, and brings its group into view.
export function reapScreen ({ run, title, act, onDone, onBind, onHelp }) {
  const s = run.state
  const el = h('div', { class: 'screen reap-screen' })
  const full = () => souls(s.party).length >= rosterCap(run)
  const blocked = (o) => o.type === 'soul' && (full() ? 'full' : o.cost > s.essence ? 'poor' : null)
  // How many of each bind offer's kind to bind: by default every free one it can take, else one.
  const picks = new Map()
  const picked = (o) => Math.max(1, Math.min(o.max, picks.get(o.id) ?? (s.freeBinds || 1)))
  const bindPoor = (o) => bindCost(run, o.id, picked(o)) > s.essence
  const room = `${s.floor}|${s.at}`
  let deal = !(dealt?.run === run && dealt.room === room)
  const groups = () => GROUPS.filter((g) => s.offers.some((o) => o.type === g))
  if (deal) dealt = { run, room, seen: groups(), on: groups()[0] }
  // The group in view was just taken: the next one still on the table comes into view (and deals in).
  const view = dealt
  const settle = () => {
    const left = groups()
    if (left.includes(view.on)) return
    view.on = view.seen.slice(view.seen.indexOf(view.on) + 1).find((g) => left.includes(g)) ?? left[0]
    deal = true
  }
  settle()
  // The cards by offer index, for the pick and refuse animations; `busy` while a pick plays out.
  const cards = []
  let busy = false
  // Each offer's key (offerKeys), shown on its card and named in its tooltip.
  const keys = offerKeys(s.offers)
  const keyTag = (i) => keys.has(i) && h('kbd', null, keys.get(i).label)
  const keyNote = (i) => keys.has(i) ? ` (${keys.get(i).label})` : ''
  const refuse = (i) => {
    sfx.play('poor')
    const c = cards[i]
    if (!c) return
    c.classList.remove('refuse')
    void c.offsetWidth // restart the shake
    c.classList.add('refuse')
  }
  // A pick plays out (the card lifts away, or pulses if some of its kind stay to bind), then the run moves on.
  const later = (fn) => (still() ? fn() : setTimeout(fn, 300))
  const pick = (i, cls, then) => {
    busy = true
    sfx.play('card')
    if (s.offers[i].type !== 'bind') el.classList.add('picking')
    cards[i]?.classList.add(cls)
    later(then)
  }
  // Where a card's picture stands now (before it lifts away), for what flies from it.
  const artRect = (i) => (cards[i]?.querySelector('.offer-art') ?? cards[i])?.getBoundingClientRect()
  const bodiesStanding = () => standingBodies(s)
  // A bind offer is taken by binding (its picked count), never by `reap`.
  const take = (i) => {
    if (busy) return
    if (i === null) return onDone(null)
    const o = s.offers[i]
    if (o.type === 'bind') {
      if (bindPoor(o)) return refuse(i)
      const n = picked(o)
      const from = [{ rect: artRect(i), n }]
      const before = bodiesStanding()
      return pick(i, n === o.max ? 'taking' : 'pulse', () => {
        drawn.landing = true
        try { onBind(o.id, n) } finally { flyBones(from, before) }
      })
    }
    if (blocked(o)) return refuse(i)
    const rect = artRect(i)
    pick(i, 'taking', () => {
      onDone(i)
      if (o.type === 'relic' || o.type === 'keystone') flyTrinket(o, rect)
    })
  }
  // Every free bind at once, across the kinds in offer order. Each kind is one onBind, and each re-shows the
  // room; the run's state is live, so the next kind's count is read after the last one's bind.
  const freeLeft = () => Math.min(s.freeBinds, s.offers.reduce((n, o) => n + (o.type === 'bind' ? o.max : 0), 0))
  const bindAll = () => {
    if (busy || !freeLeft()) return
    let left = s.freeBinds
    const plan = s.offers.flatMap((o, i) => {
      if (o.type !== 'bind' || left <= 0) return []
      const n = Math.min(o.max, left)
      left -= n
      return [{ i, id: o.id, n, all: n === o.max }]
    })
    busy = true
    sfx.play('card')
    const from = plan.map((p) => ({ rect: artRect(p.i), n: p.n }))
    const before = bodiesStanding()
    for (const p of plan) cards[p.i]?.classList.add(p.all ? 'taking' : 'pulse')
    later(() => {
      drawn.landing = true
      try {
        for (const p of plan) if (s.phase === 'reap' && s.offers.some((o) => o.type === 'bind' && o.id === p.id)) onBind(p.id, p.n)
      } finally { flyBones(from, before) }
    })
  }
  const has = (type) => s.offers.some((o) => o.type === type)
  // Hollow Court: the shadows that stood at the end of the battle just won joined the ossuary (if it was
  // fought under the keystone: one taken here keeps nothing of it), in any battle room that ends in spoils
  // (a siege's too). A reliquary's or a rite's spoils follow no battle: run.battle is still the last one's.
  const shades = ['fight', 'elite', 'siege'].includes(currentNode(run).type) ? keptShadows(run) : []
  const kept = shades.length > 0 && `Hollow Court: ${shades.length} shadow${shades.length === 1 ? '' : 's'} stayed, standing in your ossuary now: ` +
    `${Object.entries(Object.groupBy(shades, (u) => u.id)).map(([id, us]) => bodies(id, us.length)).join(', ')}.`
  // One short line of what is on the table; the rules behind it on the ⓘ beside it.
  const per = TUNING.army.bindPerTier
  // Each group's part of the line (and, with more than one group, its step's words).
  const part = {
    soul: () => ['Recruit one for ', kw('essence')],
    relic: () => ['Pick one ', kw('relic'), ', free'],
    keystone: () => ['Pick one ', kw('keystone'), ` · ${s.keystones.length}/${TUNING.keystone.max} held`],
    tier: () => ['Advance one path, free'],
    bind: () => [kw('bind'), ' the slain: ', s.freeBinds > 0 ? [h('b', { class: 'num' }, s.freeBinds), ' free'] : [`${per} × tier `, kw('essence')]]
  }
  const lede = () => groups().map((g) => part[g]()).flatMap((p, k) => [k ? ' · ' : '', p])
  const ledeTip = () => h('div', { class: 'syn-tip' },
    has('soul') && h('p', null, 'A recruit rises at the level it fought at, and joins the field if there is room.'),
    has('tier') && h('p', null, 'A rite grants one soul the next tier of a path.'),
    has('bind') && h('p', null, `The first 1 + Will binds after a battle are free, then ${per} × tier essence each. The unbound are lost when you move on.`))
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
    const standing = standingOf(s, o.id)
    return cards[i] = h('div', {
      class: 'offer o-bind' + (poor ? ' locked' : ''), style: `--i:${i}`,
      tip: () => unitCard({ id: o.id, lvl: s.muster, path: null, tier: 0, slot: -1, rank: true }, {
        mods: partyMods(run),
        notes: [ARMY_TEXT.bind(run), `Bound bodies stand in the ossuary and fight at the muster level (${s.muster}), whatever level they fell at.`,
          leaders.length ? `Your souls that can lead them (${leadsText(o.id)}): ${[...new Set(leaders)].join(', ')}.` : `None of your souls can lead them yet: a captain leads bodies of its own kin or role (${leadsText(o.id)}).`]
      })
    },
    h('div', { class: 'offer-tag' }, keyTag(i), ' Bind'),
    h('div', { class: 'offer-art' }, portrait(o.id, 76)),
    h('div', { class: 'offer-name' }, d.name),
    h('div', { class: 'offer-line' }, h('b', { class: 'num' }, o.max), ' slain · ', standing ? [h('b', { class: 'num' }, standing), ' standing'] : 'new kind'),
    h('div', { class: 'stepper' },
      step('−', n - 1, 'Bind one fewer.'), h('b', null, n), step('+', n + 1, n >= o.max ? `Only ${o.max} ${o.max === 1 ? 'is' : 'are'} left to bind.` : 'Bind one more.'),
      o.max > 1 && n < o.max && h('button', { class: 'small link', onclick: () => set(o.max), tip: () => `Bind all ${o.max}.` }, 'all')),
    h('button', {
      class: 'buy bind-btn' + (poor ? ' poor' : ''), 'aria-disabled': poor ? 'true' : null,
      onclick: () => take(i),
      tip: () => h('div', { class: 'syn-tip' },
        h('p', null, `Bind ${bodies(o.id, n)}: ${[free && `${free} free`, n - free > 0 && `${n - free} × ${TUNING.army.bindPerTier * d.tier} essence`].filter(Boolean).join(' + ')}.${keyNote(i)}`),
        poor && h('p', { class: 'warn' }, `You need ${cost} essence; you have ${s.essence}.`))
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
      // A relic's card already shows all its tooltip would (a trigger's moment is on its tag's own).
      : o.type === 'relic' ? null
        : o.type === 'keystone' ? () => h('div', null, keystoneTip(o.id, run), h('p', { class: 'dim' }, `Click to take it, free.${keyNote(i)}`))
          : () => h('div', { class: 'syn-tip' }, h('b', null, o.name), h('p', { class: 'dim' }, `For your ${unitDef(soul.id).name}: ${who.toLowerCase()}.`),
            second ? pathTiers(pathDef(soul.id, o.path), soul.tier2, SECOND_TIERS) : pathTiers(pathDef(soul.id, o.path), soul.tier), h('p', { class: 'dim' },
              second ? (soul.path2 ? 'Click to grant the next tier of its second path, free.' : `Click to take it as a second path, on top of ${pathDef(soul.id, soul.path).name}, and grant tier I, free.`)
                : soul.path ? 'Click to grant the next tier, free.' : 'Click to commit it to this path and grant tier I, free.'),
            // A Knight's tier IV or second path's tier I rules out the other: say so on either.
            soul.grade === 1 && (second || nextTier(soul, o.path) === 3) && h('p', { class: 'dim' }, RANK_TEXT.knight))
    // Big art, the name, one line of effect; the rest is on the hover.
    const d = o.type === 'soul' && unitDef(o.id)
    const on = o.type === 'relic' && relicDef(o.id).on
    return cards[i] = h('button', { class: `offer o-${o.type}` + (why ? ' locked' : ''), style: `--i:${i}`, onclick: () => take(i), 'aria-disabled': why ? 'true' : null, tip },
      h('div', { class: 'offer-tag' }, keyTag(i), { soul: ' Recruit', relic: ' Relic', tier: ' Path', keystone: ' Keystone' }[o.type]),
      h('div', { class: 'offer-art' }, o.type === 'relic' ? icon(relicIcon(o.id), 64) : o.type === 'keystone' ? icon('keystone', 64) : portrait(o.type === 'soul' ? o.id : soul.id, 104),
        soul && soul.grade > 0 && h('span', { class: `offer-ins g${soul.grade}`, 'aria-label': GRADES[soul.grade].name }, icon(GRADE_ICON[soul.grade], 14)),
        on && h('span', { class: 'trig-tag', tip: () => `Fires each time ${TRIGGER_TEXT[on].when}` }, TRIGGER_TEXT[on].name)),
      // A path tier's name is the path and tier ("Reaver II"); whose it is goes under it.
      h('div', { class: 'offer-name' }, soul ? o.name.replace(`${unitDef(soul.id).name}: `, '') : o.name),
      soul && h('div', { class: 'offer-sub' }, `${unitDef(soul.id).name} · ${who.toLowerCase()}`),
      soul && tierTrack(soul, o.path, second),
      h('div', { class: 'offer-line' }, d ? [`${KIN[d.kin].name} ${ROLES[d.role].name} · level `, h('b', { class: 'num' }, o.lvl)] : hiNums(o.desc)),
      h('div', { class: 'offer-price' + (why ? ` ${why}` : '') }, o.type === 'soul' ? [icon('soul', 14), o.cost, why === 'full' && h('span', null, ' · full')] : 'Free'))
  }

  // The retinue as a strip of portraits (hover one for its card). When it is full and a recruit is on the
  // table, each soul but the Monarch gets a Release button.
  function strip () {
    const releasing = full() && has('soul')
    return h('div', { class: 'ret-strip' + (releasing ? ' full' : '') },
      h('div', { class: 'ret-head' }, h('b', null, 'Retinue'), ` ${souls(s.party).length}/${rosterCap(run)}`,
        releasing && h('span', { class: 'warn' }, ' · full: release a soul to recruit')),
      h('div', { class: 'ret-souls' }, s.party.slice().sort(fieldOrder).map((u) => {
        const d = unitDef(u.id)
        return h('div', { class: 'ret-soul' + (u.hp <= 0 ? ' fallen' : '') + (d.monarch ? ' monarch' : ''), tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run) }) },
          (!d.monarch || u.lvl > 0) && h('span', { class: 'ret-lv' }, u.lvl), rankPort(u, 36), h('span', { class: 'ret-name' }, d.monarch ? 'Monarch' : d.name), hpBar(u),
          releasing && !isMonarch(u) && h('button', {
            class: 'danger small',
            onclick: () => { if (!busy) { act({ type: 'release', uid: u.uid }); render() } },
            tip: () => `Release ${d.name} forever, freeing a place in your retinue. This can't be undone.`
          }, icon('release', 12), 'Release'))
      })))
  }

  // The steps, one per group dealt: the group in view lit, a group taken done. A step names its group and
  // carries its part of the line; the rules behind them all on the ⓘ at the row's end.
  const show = (g) => {
    if (busy || g === view.on || !groups().includes(g)) return
    view.on = g
    deal = true
    hideTip()
    render()
  }
  const stepTo = (d) => {
    const left = view.seen.filter((g) => groups().includes(g))
    show(left[(left.indexOf(view.on) + d + left.length) % left.length])
  }
  function steps () {
    const left = groups()
    return h('div', { class: 'reap-steps', role: 'tablist' },
      view.seen.map((g, k) => {
        const done = !left.includes(g)
        const n = s.offers.filter((o) => o.type === g).length
        return h('button', {
          class: `reap-step s-${g}` + (g === view.on ? ' on' : '') + (done ? ' done' : ''), role: 'tab',
          'aria-selected': g === view.on ? 'true' : 'false', 'aria-disabled': done ? 'true' : null,
          onclick: () => show(g),
          tip: () => done ? `${GROUP_NAME[g]}: done.` : `${GROUP_NAME[g]}: ${n} on the table. Every card's key works from any step. (← →)`
        },
        h('span', { class: 'rs-num' }, done ? '✓' : k + 1),
        h('span', { class: 'rs-text' }, h('b', null, GROUP_NAME[g]), h('span', { class: 'rs-part' }, done ? 'done' : part[g]())))
      }),
      ledeTip().childElementCount > 0 && h('span', { class: 'lede-more', tabindex: '0', tip: ledeTip }, icon('help', 15)))
  }

  // Cards per row: up to `most` in one, more in rows as even as they come (eleven kinds to bind: six and five).
  const rowOf = (n, most) => (n <= most ? Math.max(n, 1) : Math.ceil(n / Math.ceil(n / most)))
  function render () {
    cards.length = 0
    const one = view.seen.length < 2
    const on = one ? null : view.on
    const shown = (o) => !on || o.type === on
    const offers = s.offers.map((o, i) => o.type !== 'bind' && shown(o) && card(o, i))
    const binds = s.offers.map((o, i) => o.type === 'bind' && shown(o) && card(o, i))
    // Each row deals in from its first card, whatever the offers' indices.
    for (const row of [offers, binds]) row.filter(Boolean).forEach((c, k) => c.style.setProperty('--i', k))
    const left = view.seen.filter((g) => groups().includes(g))
    const next = on && left[left.indexOf(on) + 1]
    fill(el,
      topbar(run, onHelp),
      h('div', { class: 'center' + (one ? '' : ' stepped') },
        h('div', { class: 'reap-title' }, icon(has('soul') || has('bind') ? 'soul' : has('tier') ? 'rite' : has('keystone') && !has('relic') ? 'keystone' : 'reliquary', 30), h('h1', null, title)),
        one
          ? h('p', { class: 'reap-lede' }, lede(), ledeTip().childElementCount > 0 && h('span', { class: 'lede-more', tabindex: '0', tip: ledeTip }, icon('help', 15)))
          : steps(),
        kept && h('p', { class: 'note-line' }, kept),
        wavePay,
        offers.some(Boolean) && h('div', { class: 'offers picks' + (deal ? ' deal' : ''), style: `--cols:${rowOf(offers.filter(Boolean).length, 5)}` }, offers),
        binds.some(Boolean) && h('section', { class: 'bind-row' },
          h('div', { class: 'bind-head' },
            h('h2', null, 'Bind the slain'),
            freeLeft() > 0 && h('button', {
              class: 'bind-all', onclick: bindAll,
              tip: () => `Bind every free body: ${freeLeft()}, across the kinds from the left. Use a card's stepper to pay for more. (B)`
            }, icon('bone', 16), `Bind all free · ${freeLeft()}`, h('kbd', null, 'B'))),
          h('div', { class: 'offers binds' + (deal ? ' deal' : ''), style: `--cols:${rowOf(binds.filter(Boolean).length, 7)}` }, binds)),
        h('div', { class: 'reap-actions' },
          next && h('button', { class: 'next-step', onclick: () => show(next), tip: () => `On to the next step: ${GROUP_NAME[next]}. (→)` }, `${GROUP_NAME[next]} `, h('span', { 'aria-hidden': 'true' }, '→')),
          h('button', { class: 'ghost move-on', onclick: () => take(null), tip: () => `Leave what is left and go on.${has('bind') ? ' The slain left unbound are lost.' : ''} (S)` }, 'Move on ', h('kbd', null, 'S'))),
        strip()))
    deal = false
  }

  // A key for an offer, or Bind all, out of view brings its group into view first, so its card plays the pick.
  const reveal = (g) => { if (view.seen.length > 1 && view.on !== g && !busy) show(g) }
  render()
  return {
    el,
    key (e) {
      // A bind offer binds the count picked on its card. Escape is not Move on: a second Escape to close the
      // help must never leave the room and its offers behind.
      const hit = [...keys].find(([, k]) => pressed(k, e))
      if (hit) { reveal(s.offers[hit[0]].type); take(hit[0]) }
      else if (e.shiftKey) return
      else if (e.key === 'b' || e.key === 'B') { if (freeLeft()) reveal('bind'); bindAll() }
      else if (e.key === 's' || e.key === 'S') take(null)
      else if (e.key === 'ArrowRight' && view.seen.length > 1) stepTo(1)
      else if (e.key === 'ArrowLeft' && view.seen.length > 1) stepTo(-1)
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
  // The run's tally as one row of icons, each in its system's colour; the full name on the hover.
  const stat = (ico, sys, v, label, name) => h('div', { class: 'end-stat', style: `--s:var(--c-${sys})`, tip: () => name }, icon(ico, 20), h('b', null, v), h('span', { class: 'lbl' }, label))
  // A short sting as the screen lands: a flash of gold or blood. Its sound already played, once, with the
  // battle that decided the run (its banner, or main.js's onDone for a skipped one).
  const el = h('div', { class: `screen end-screen ${lost ? 'lost' : 'won'}` },
    h('div', { class: 'sting' }),
    h('div', { class: 'center' },
      h('div', { class: 'sigil ' + (won ? 'win' : 'lose') }, icon(won ? 'boss' : 'elite', 54)),
      h('h1', { class: 'logo ' + (won ? 'win' : 'lose') }, descend ? 'VICTORY' : won ? 'CLEARED' : 'DEFEAT'),
      h('p', { class: 'tagline' }, tagline),
      h('div', { class: 'end-stats' },
        stat('stairs', 'monarch', deeper > 0 ? `${cleared}/${n} + ${deeper}` : `${cleared}/${n}`, 'floors', deeper > 0 ? `Floors cleared: ${cleared} of ${n}, and ${deeper} of the deep.` : `Floors cleared: ${cleared} of ${n}.`),
        stat('fight', 'foe', `${s.stats.wins}/${s.stats.fights}`, 'won', 'Battles won, of those fought.'),
        stat('hood', 'essence', s.stats.reaped, 'recruited', 'Souls recruited.'),
        stat('bone', 'ossuary', s.stats.bound, 'bound', 'Bodies bound to the ossuary.'),
        stat('soul', 'essence', s.stats.essence, 'essence', 'Essence earned.'),
        stat('reliquary', 'relic', s.relics.length, 'relics', 'Relics claimed.')),
      // What to do next stands right under the tally, above all there is to read.
      h('div', { class: 'title-actions end-actions' },
        descend && h('button', {
          class: 'primary big', onclick: onDescend,
          tip: () => `Go on to floor ${s.floor + 1}, the first of the deep, with your retinue, relics, essence and wounds as they are. The clear is already yours. (Enter)`
        }, 'Descend ', h('kbd', null, 'Enter')),
        newRun),
      h('p', { class: 'dim end-seed' }, `seed ${s.seed}`),
      descend && h('div', { class: 'panel descend' },
        h('h2', null, 'The deep'),
        h('p', null, DEEP_TEXT.descend),
        h('p', { class: 'dim' }, DEEP_TEXT.growth),
        h('p', { class: 'warn' }, DEEP_TEXT.fall)),
      lost && deathPanel(s, run.battle),
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
  // The board as the battle draws it (spoils.css): the crypt floor, the camp's walls, your camp and their
  // ground edged in their sides' colours, the Monarch where it fell, ringed in gold, and the killer, ringed in
  // red, a line struck between them.
  const walls = new Set(wallTiles(s.camp))
  const row = (y) => DEPTH - 1 - y // their back row at the top
  const cells = []
  for (let y = DEPTH - 1; y >= 0; y--) {
    for (let x = 0; x < LANES; x++) {
      const t = tileAt(x, y)
      cells.push(h('span', { class: 'db-cell' + (walls.has(t) ? ' wall' : '') + (t === mine ? ' me' : '') + (t === from ? ' killer' : '') },
        walls.has(t) ? h('img', { src: WALL_ART[t % WALL_ART.length], alt: '', draggable: 'false' })
          : t === from ? portrait(s.death.by, 30) : t === mine ? portrait('monarch', 30) : null))
    }
  }
  const at = (t) => [tileX(t) + 0.5, row(tileY(t)) + 0.5]
  const zone = (cls, top, rows) => h('span', { class: 'db-zone ' + cls, style: `top:calc(var(--pad) + var(--c) * ${top});height:calc(var(--c) * ${rows})` })
  const strike = mine != null && from != null && (() => {
    const [[x1, y1], [x2, y2]] = [at(from), at(mine)]
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'db-strike')
    svg.setAttribute('viewBox', `0 0 ${LANES} ${DEPTH}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.innerHTML = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" vector-effect="non-scaling-stroke"/>`
    return svg
  })()
  return h('div', { class: 'panel death' },
    h('div', { class: 'death-text' },
      h('h2', null, s.death.reason === 'tick-ceiling' ? 'How the run ended' : 'What felled the Monarch'),
      h('p', { class: 'death-head' }, d.head),
      d.lines.map((l) => h('p', { class: 'dim' }, l)),
      d.threat && h('p', { class: 'death-threat' }, 'Threat: ', h('b', null, d.threat.name), h('span', { class: 'dim' }, ` · ${d.threat.desc}`))),
    mine != null && h('div', {
      class: 'death-board',
      tip: () => from != null ? `The board as the blow landed: their side at the top, your camp below. The Monarch stood on ${tileText(mine)}; the killer struck from ${tileText(from)}.`
        : `The board as the battle ended: their side at the top, your camp below. The Monarch stood on ${tileText(mine)}.`
    },
    h('div', { class: 'db', style: `--lanes:${LANES};--depth:${DEPTH}` },
      zone('db-foe', 0, ROWS), zone('db-camp', DEPTH - CAMP_ROWS, CAMP_ROWS), cells, strike),
    h('div', { class: 'db-key' },
      h('span', { class: 'k-me' }, 'the Monarch'), from != null && h('span', { class: 'k-killer' }, unitDef(s.death.by).name))))
}

// The camp's walls, as the battle draws them (engine.js WALLS).
const WALL_ART = ['wall-0', 'wall-1', 'wall-2'].map((w) => new URL(`./assets/props/${w}.svg`, import.meta.url).href)

// ── battle playback bar ──────────────────────────────────────────────────────────────────────────

// Under the battle canvas: pause, speed and skip. They change only how the battle is shown.

const SPEEDS = [1, 2, 4]

// The essence counter on the left is where the slain foes' orbs fly (the scene finds it through
// scene.purseAt): it rolls up as each lands. The playback state reads at a glance: the speed lit, the bar
// edged violet while paused, and once the battle is over, Skip becomes Continue.
export function battleBar () {
  let scene = null
  let st = { paused: false, speed: 1, seconds: 0, over: false, essence: 0 }
  let carried = 0
  const noFocus = (e) => e.preventDefault()
  const btn = (attrs, ...kids) => h('button', { tabindex: '-1', onmousedown: noFocus, ...attrs }, ...kids)

  const speeds = SPEEDS.map((n) => btn({ class: 'seg', onclick: () => scene?.setSpeed(n), tip: () => `Play at ${n}× speed. (${n})` }, `${n}×`))
  const pause = btn({ class: 'seg pause', onclick: () => scene?.togglePause(), tip: () => 'Pause or resume the playback. (Space)' })
  const skip = btn({ class: 'seg skip', 'data-sfx': 'none', onclick: () => scene?.skip(), tip: () => st.over ? 'On to what comes next. (S or Esc)' : 'Skip to the result. The outcome is already decided. (S or Esc)' })
  const esc = (k = 1) => TUNING.escalation.startTick * k * TUNING.tick.ms / 1000
  const clock = h('span', { class: 'clock', tip: () => `Battle time. ${esc()} s after the start, or after the last entry (${TUNING.army.overflow ? 'your reserve or their waves' : 'a held detachment of yours or a wave of theirs'}), all damage ramps up so no fight stalls; ${esc(TUNING.escalation.bossMult)} s in the boss's room. Never later than ${esc(TUNING.escalation.bossMult)} s after the last foe entered.` })
  const count = h('b', null, '0')
  const purse = h('span', {
    class: 'purse',
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'Essence'), h('p', null, 'Carried by the foes slain so far, relics included. A won battle pays it into your purse.'))
  }, icon('soul', 16), h('span', { class: 'purse-plus' }, '+'), count)
  const el = h('div', { class: 'battlebar' },
    h('div', { class: 'legend' },
      purse,
      h('span', null, h('i', { class: 'lg hp' }), 'HP'),
      h('span', { tip: () => 'The pale bar under each unit fills by speed toward its next ability, or its cheapest one with nothing in reach. It acts once the bar is full and a target is in reach. Walking never uses the gauge: a unit may step once every ' +
        `${TUNING.board.stepTicks * TUNING.tick.ms / 1000} s, and stops once a foe is in reach (all but a flanker on the hunt).` }, h('i', { class: 'lg gauge' }), 'gauge'),
      h('span', { class: 'dim' }, 'Hover a unit for live stats.')),
    h('div', { class: 'controls' }, clock, pause, h('div', { class: 'segs' }, speeds), skip, muteButton()))

  function render () {
    SPEEDS.forEach((n, i) => speeds[i].classList.toggle('active', st.speed === n))
    fill(pause, icon(st.paused ? 'play' : 'pause', 14), st.paused ? ' Resume' : ' Pause', h('kbd', null, 'Space'))
    fill(skip, icon('skip', 14), st.over ? ' Continue' : ' Skip', h('kbd', null, 'S'))
    pause.classList.toggle('active', st.paused)
    el.classList.toggle('paused', st.paused && !st.over)
    el.classList.toggle('over', !!st.over)
    clock.textContent = `${st.seconds.toFixed(0)}s`
    const e = st.essence ?? 0
    if (Math.round(e) !== Math.round(carried)) roll(count, carried, e, purse)
    carried = e
  }
  render()

  return {
    el,
    attach (s) { scene = s; s.purseAt = () => count.getBoundingClientRect() },
    update (next) { st = next; render() },
    key (e) {
      if (!scene) return
      // Skip is heard as the battle's result (its win or lose sting), so it adds no click of its own.
      if (e.code === 'KeyS' || e.code === 'Escape') { e.preventDefault(); return scene.skip() }
      if (e.code === 'Space') scene.togglePause()
      else if (['Digit1', 'Digit2', 'Digit4'].includes(e.code)) scene.setSpeed(Number(e.code.slice(5)))
      else return
      sfx.play('click')
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
// Banners are an identity, not a system: the hues no system wears (style.css :root), worn as a stripe on a
// bone flag, a ring at a member's feet and a Marshal's realm.
// Their order is not the detachments' (content.js), so the first banners and the first detachments differ.
const BANNER = ['#f7f7fc', '#5a5cff', '#f020c8', '#fcbdb5', '#1bab62']
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
const MARSHAL_GOLD = '#f6e4b8' // style.css --c-marshal: champagne
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
  // the detachment whose Move square the next click on the board sets.
  let pick = []
  let picking = false
  let aim = null
  // The board (board.js) draws in `stage`, which takes the pointer: each tile's tooltip, by tile ('reserve' for
  // the bodies behind the camp); the tile under the pointer; a press, which turns into a drag past a few pixels;
  // the soul being dragged; a benched soul's click to swallow after it was dragged.
  const stage = h('div', { class: 'board-stage', 'aria-label': 'The board. Click a soul to select it, then an empty tile to move it there; drag a soul onto another to swap them. Keys: the arrows move, Enter selects or moves, X swaps the selected soul with the one here.' })
  let tips = new Map()
  let hover = null
  let press = null
  let drag = null
  let swallow = false
  // A redraw moving the focused stage into its new column (render): its blur and focus are not the user's.
  let keeping = false
  // The tray's last selection and pick count, to open the right tab when either changes.
  let lastSel = null
  let lastPick = 0
  // The tray stays one element across redraws, so it keeps its scroll; its body scrolls back to the top when
  // the tab or the soul it shows changes (`shown`).
  const trayBody = h('div', { class: 'tab-body' })
  const trayEl = h('div', { class: 'tray' })
  let shown = ''
  function openTab (id) {
    trayTab = id
    prefs.set('tray', id)
    render()
  }

  // Every action clears the selection, but a purchase, a cohort or an order keeps it, so you can go on.
  function send (action) {
    error = said(act(action))
    if (!['level', 'upgrade', 'monarch', 'muster', 'cohort', 'order', 'disband', 'promote'].includes(action.type)) sel = null
    if (action.type === 'cohort') soft = sel !== null
    else if (!sel) soft = false
    render()
    onChange?.()
  }

  // Several actions as one (re-forming a detachment: a disband, then an order). They are tried on a copy of
  // the run first, so a refusal part-way sends nothing and the detachment stands as it was; should the real
  // run still refuse one after a disband, the disbanded detachment is formed again on its plan.
  // `then` runs once they pass the trial, before they are sent (join drops its picks then).
  function sendAll (actions, then = null) {
    const trial = { ...run, state: structuredClone(s) }
    try {
      for (const a of actions) apply(trial, a)
    } catch (e) {
      return refuse(`${said(e.message)} Nothing changed.`)
    }
    then?.()
    const was = s.detachments.map((d) => ({ ...d, members: [...d.members] }))
    error = ''
    for (const [k, a] of actions.entries()) {
      if (!(error = said(act(a)))) continue
      for (const d of actions.slice(0, k).filter((x) => x.type === 'disband').map((x) => was.find((w) => w.id === x.id))) {
        const back = d.members.filter(fieldedUid)
        if (back.length) act({ type: 'order', uids: back, plan: d.plan })
      }
      break
    }
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

  // ── spending: the soul's card and the Monarch's ──

  // A purchase. Short of essence it is refused on the spot: the control shakes and sounds poor. Bought, it
  // sounds, and whatever the redraw builds under `key` (popKey) pops once.
  let popped = null
  const popKey = (key) => (popped === key ? ' pop' : '')
  function shake (e) {
    const t = e?.currentTarget
    if (!t?.classList) return
    t.classList.remove('shake')
    void t.offsetWidth // restarts the animation
    t.classList.add('shake')
  }
  function commit (action, key) {
    popped = key
    send(action)
    popped = null
    if (!error) sfx.play('buy')
  }
  function buy (e, cost, action, key = JSON.stringify(action)) {
    if (s.essence >= cost) return commit(action, key)
    sfx.play('poor')
    shake(e)
  }
  const poorText = (cost) => `Needs ${cost} essence; you have ${s.essence}.`

  const buyButton = (label, cost, action, why, cls = '') => h('button', {
    class: 'buy' + cls + (s.essence < cost ? ' poor' : '') + popKey(JSON.stringify(action)),
    'aria-disabled': s.essence < cost ? 'true' : null,
    onclick: (e) => buy(e, cost, action),
    tip: () => s.essence < cost ? poorText(cost) : why
  }, label, h('span', { class: 'price' }, icon('soul', 12), cost))

  // The selected soul as a card, framed in its rank's colour: its head, its level and paths, its rank, and
  // its cohort.
  const soulCard = (u) => h('div', { class: `uc g${u.grade ?? 0}${popKey(`promote:${u.uid}`)}` },
    soulHead(u), upgradePanel(u), rankPanel(u), cohortPanel(u))

  // The card's head: the soul's art (its full card on hover), name, level, kin and role, its wounds, and
  // its HP, ATK, DEF and SPD as it fights now, with its relics', keystones' and bonds' mods (as soulTip).
  function soulHead (u) {
    const d = unitDef(u.id)
    const grade = u.grade ?? 0
    const all = [...fielded(s.party).filter((x) => !isHeld(s, x)), ...armyOf(run).members]
    const st = statsOf(u, [...partyMods(run, u), ...bondMods(all, u, aliasOf(run))])
    const maxHp = Math.round(st.hp)
    const hp = Math.max(0, Math.round(u.hp / (u.maxHp || 1) * maxHp))
    const stat = (ico, name, v) => h('span', { class: 'uc-stat s-' + ico, tip: () => name }, icon(ico, 15), h('b', null, v))
    return h('div', { class: 'uc-head' },
      h('div', { class: 'uc-art', tip: () => soulTip(u, null) }, portrait(u.id, 64, u.hp <= 0),
        h('span', { class: `uc-ins g${grade}` }, icon(GRADE_ICON[grade], 14))),
      h('div', { class: 'uc-id' },
        h('div', { class: 'uc-name' }, d.name),
        h('div', { class: 'dim small' }, `Lv ${u.lvl} · ${KIN[d.kin].name} ${ROLES[d.role].name} · `, kw(GRADES[grade].id)),
        h('div', { class: 'uc-stats' },
          stat('hp', u.hp > 0 ? 'HP' : 'Fallen: an altar raises it.', hp < maxHp ? `${hp}/${maxHp}` : maxHp),
          stat('atk', 'Attack', Math.round(st.atk)), stat('def', 'Defence', Math.round(st.def)), stat('spd', 'Speed: how fast its gauge fills', Math.round(st.spd)))))
  }

  // Spending essence on the selected soul: its next level, then its paths as tracks of tier nodes (Bloons
  // TD style), each lit when held, priced when it is the next to buy (canAdvance: a path to take; then its
  // tiers, tier IV a Knight's or a Marshal's; then, for a Knight or a Marshal, a second path's tiers I–III on
  // top of the first's), and locked, the reason on hover, when the rank or a clash shuts it.
  function upgradePanel (u) {
    const d = unitDef(u.id)
    const grade = u.grade ?? 0
    const first = u.path ? pathDef(u.id, u.path) : null
    const paths = first ? [first] : pathsOf(u.id)
    const others = first ? pathsOf(u.id).filter((p) => p.id !== u.path && (!u.path2 || p.id === u.path2)) : []
    // A Knight takes tier IV or a second path's tier I, not both: said on either while neither is taken.
    const either = grade === 1 && u.tier < 4 && !u.tier2
    const gain = () => {
      const [now, next] = [baseStats(u.id, u.lvl), baseStats(u.id, u.lvl + 1)]
      return [['hp', 'HP'], ['atk', 'ATK'], ['def', 'DEF'], ['spd', 'SPD']].filter(([k]) => next[k] > now[k])
        .map(([k, n]) => `+${+(next[k] - now[k]).toFixed(1)} ${n}`).join(', ') + '.'
    }
    const marshalWaits = 'until it is a Marshal'
    // Why a path's next tier is shut, when the rank or a clash is what shuts it.
    const shut = (p) => {
      if (canAdvance(u, p.id)) return null
      if (p.id === u.path) {
        return u.tier !== 3 ? null
          : grade === 0 ? `Tier IV is a Knight's: promote ${d.name} first.`
            : `As a Knight it took a second path: tier IV waits ${marshalWaits}.`
      }
      if (pathsClash(u.id, u.path, p.id)) return `It cannot pair with ${first.name}: ${clashText(u.id, u.path, p.id)}.`
      if ((u.tier2 ?? 0) >= SECOND_TIERS) return null
      return u.tier2 ? 'A Knight holds only tier I of a second path: II and III are a Marshal\'s.'
        : u.tier >= 4 ? `As a Knight it took tier IV: a second path waits ${marshalWaits}.` : null
    }
    // Why tier i (0-based) of a path is locked: the next one by shut; a later one when the rank can never
    // reach it as things stand (tier IV for a Soldier, or a Knight with a second path; a second path's II–III
    // for a Knight); every one of a second path that clashes.
    const lockOf = (p, i, held, second) => {
      if (second && pathsClash(u.id, u.path, p.id)) return shut(p)
      if (i === held) return canAdvance(u, p.id) ? null : shut(p) ?? 'Not open to it.'
      if (!second && i === 3 && grade === 0) return `Tier IV is a Knight's: promote ${d.name} first.`
      if (!second && i === 3 && grade === 1 && u.tier2) return `As a Knight it took a second path: tier IV waits ${marshalWaits}.`
      if (second && i >= 1 && grade === 1) return 'A Knight holds only tier I of a second path: II and III are a Marshal\'s.'
      return null
    }
    const node = (p, i, held, second) => {
      const key = `tier:${u.uid}:${p.id}:${i}`
      const why = i < held ? null : lockOf(p, i, held, second)
      const open = i === held && !why
      const cost = open ? tierCost(run, u, p.id) : 0
      const poor = open && s.essence < cost
      const state = i < held ? 'own' : open ? (poor ? 'next poor' : 'next') : why ? 'lock' : 'later'
      const note = i < held ? null
        : why ? h('p', { class: 'warn' }, why)
          : !open ? h('p', { class: 'dim' }, `After tier ${ROMAN[i - 1]}.`)
            : poor ? h('p', { class: 'warn' }, poorText(cost))
              : !first ? h('p', { class: 'dim' }, `Takes ${p.name} for good: the other paths close.`)
                : either && (second || i === 3) ? h('p', { class: 'dim' }, `A Knight takes this or ${second ? `tier IV on ${first.name}` : 'a second path'}, not both.`)
                  : second && !u.path2 ? h('p', { class: 'dim' }, `Adds ${p.name} as a second path.`) : null
      return h('button', {
        class: `tnode ${state}${popKey(key)}`, 'aria-disabled': open && !poor ? null : 'true', 'aria-label': `${p.name} ${ROMAN[i]}`,
        onclick: (e) => open ? buy(e, cost, { type: 'upgrade', uid: u.uid, path: p.id }, key) : i >= held && shake(e),
        tip: () => h('div', { class: 'syn-tip' }, h('p', null, h('b', null, `${p.name} ${ROMAN[i]}: `), p.tiers[i].desc), note)
      }, h('span', { class: 'tnum' }, ROMAN[i]),
      i === 3 && h('span', { class: 'tbadge g1' }, icon('knight', 10)),
      why && h('span', { class: 'tbadge lock' }, icon('lock', 10)),
      open && h('span', { class: 'tprice' }, icon('soul', 10), cost))
    }
    // A path's track: its name, then its nodes joined by links (lit up to the last tier held), then the
    // next tier's effect in a line.
    const track = (p, held, upto, second) => {
      const clash = second && pathsClash(u.id, u.path, p.id)
      const next = !clash && held < upto && canAdvance(u, p.id) && p.tiers[held]
      return h('div', { class: 'track' + (held ? ' held' : '') + (clash ? ' clash' : '') },
        h('div', { class: 'track-head', tip: () => clash ? shut(p) : p.desc }, h('b', null, p.name), h('span', { class: 'track-desc dim' }, clash ? 'clashes' : p.desc)),
        h('div', { class: 'nodes' }, p.tiers.slice(0, upto).map((_, i) => [i > 0 && h('span', { class: 'tlink' + (i < held ? ' on' : '') }), node(p, i, held, second)])),
        next && h('div', { class: 'track-next', tip: () => next.desc }, h('b', null, `${ROMAN[held]} `), next.desc))
    }
    return h('div', { class: 'uc-spend' },
      u.lvl >= TUNING.level.cap
        ? h('p', { class: 'dim small' }, `Level ${TUNING.level.cap}: it can rise no further.`)
        : buyButton([icon('levelup', 18), h('span', { class: 'grow' }, 'Level up ', h('span', { class: 'dim' }, `${u.lvl} → ${u.lvl + 1}`))],
          levelCost(run, u), { type: 'level', uid: u.uid }, gain(), ' lvl-up'),
      h('div', { class: 'uc-sec' }, 'Paths', !first && h('span', { class: 'dim' }, ' · taking one rules out the others')),
      h('div', { class: 'tracks' + (first ? '' : ' choose') }, paths.map((p) => track(p, u.path === p.id ? u.tier : 0, p.tiers.length, false))),
      grade >= 1 && first && others.length > 0 && [
        h('div', { class: 'uc-sec sub' }, 'Second path', !u.path2 && h('span', { class: 'dim' }, ' · tiers I–III, on top')),
        h('div', { class: 'tracks choose' }, others.map((p) => track(p, p.id === u.path2 ? u.tier2 : 0, SECOND_TIERS, true)))],
      first && grade === 0 && h('p', { class: 'dim small' }, 'Tier IV or a second path: promote to ', kw('knight'), '.'),
      either && first && h('p', { class: 'dim small' }, 'A ', kw('knight'), ' takes tier IV or a second path, not both.'))
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

  // The selected soul's rank, which the card's frame wears, and its promotion: the bodies of its kin it eats,
  // as portraits (those standing, then empty places for the rest it needs), and the cohorts that shrink for it.
  function rankPanel (u) {
    const d = unitDef(u.id)
    const grade = u.grade ?? 0
    const need = promoteNeed(u)
    const up = need !== null && GRADES[grade + 1]
    const head = h('div', { class: 'uc-sec' }, 'Rank · ', kw(GRADES[grade].id))
    if (!up) return h('div', { class: 'uc-rank' }, head, h('p', { class: 'dim small' }, 'The highest rank.'))
    const kin = KIN[d.kin].name
    const have = kinStanding(s, d.kin)
    const ok = canPromote(run, u)
    const take = feedOf(s, d.kin, need)
    const shrink = ok ? shrinks(take) : []
    const ate = Object.entries(take).map(([k, n]) => bodies(k, n)).join(', ')
    const eaten = Object.entries(take).flatMap(([k, n]) => Array(n).fill(k))
    const shrinkText = shrink.map(({ c, to }) => `${unitDef(c.id).name} ${c.cohort.count} → ${to}`).join(', ')
    return h('div', { class: 'uc-rank' },
      head,
      h('div', { class: 'uc-promote' },
        h('button', {
          class: `buy promote g${grade + 1}` + (ok ? '' : ' poor'), 'aria-disabled': ok ? null : 'true',
          onclick: (e) => { if (ok) return commit({ type: 'promote', uid: u.uid }, `promote:${u.uid}`); sfx.play('poor'); shake(e) },
          tip: () => h('div', { class: 'syn-tip' }, h('p', null, h('b', null, `${up.name}: `), KEYWORDS[up.id].line),
            ok ? h('p', { class: 'dim' }, `Eats ${ate} for good. No essence.`)
              : h('p', { class: 'warn' }, `Needs ${need} ${kin} bodies standing; ${have} stand. Bind ${kin} slain after a win.`))
        }, icon(GRADE_ICON[grade + 1], 16), `Promote to ${up.name}`),
        h('div', { class: 'feed' + (ok ? ' ok' : ''), tip: () => `${kin} bodies standing in the ossuary: ${have} of the ${need} it needs.` },
          eaten.map((k) => portrait(k, 22)), Array.from({ length: need - eaten.length }, () => h('span', { class: 'feed-gap' })),
          h('span', { class: 'feed-n' }, `${Math.min(have, need)}/${need}`))),
      shrink.length > 0 && h('p', { class: 'warn small' }, `Shrinks cohorts: ${shrinkText}.`))
  }

  // The Monarch's card, in its gold frame: its art (its full card on hover) and HP, then its three stats as
  // columns, each with its points, what it does now, and a point more for the same price; the rule on hover.
  function monarchPanel (picked) {
    const m = monarchOf(s)
    const cost = monarchCost(run)
    const M = TUNING.monarch
    const col = (k) => {
      const action = { type: 'monarch', stat: k }
      return h('div', {
        class: `mc-col s-${k}${popKey(JSON.stringify(action))}`,
        tip: () => h('div', { class: 'syn-tip' }, h('p', null, h('b', null, `${MONARCH_TEXT[k].name}: `), KEYWORDS[k].line), h('p', { class: 'dim' }, monarchNextText(run, k)))
      },
      h('div', { class: 'mc-ico' }, icon(k, 26)),
      h('div', { class: 'mc-name' }, MONARCH_TEXT[k].name),
      h('div', { class: 'mc-pts' }, s.monarch[k]),
      h('div', { class: 'mc-now' }, MONARCH_TEXT[k].now(run)),
      buyButton('+1', cost, action, `${monarchNextText(run, k)} +${M.hpPerPoint} max HP.`))
    }
    return h('div', { class: 'mc' + (picked ? ' on' : '') },
      h('div', { class: 'uc-head' },
        h('div', { class: 'uc-art', tip: () => unitCard(m, { mods: partyMods(run, m), realm: realmOf(run) }) }, portrait(m.id, 64, m.hp <= 0),
          h('span', { class: 'uc-ins crown' }, icon('crown', 14))),
        h('div', { class: 'uc-id' },
          h('div', { class: 'uc-name' }, 'The Monarch'),
          h('div', { class: 'dim small' }, m.lvl > 0 && `Lv ${m.lvl} · `, kw('monarch', 'you')),
          h('div', { class: 'mc-hp' }, hpBar(m), h('span', { class: 'small' }, `${m.hp}/${m.maxHp}`)))),
      h('div', { class: 'mc-cols' }, MONARCH_STATS.map(col)),
      h('p', { class: 'dim small mc-foot' }, `A point: +${M.hpPerPoint} max HP${holds(s, 'unhealable') ? ' (no heal: Court of Bone)' : ', healed'}; each costs ${M.costPerPoint} more.`))
  }

  // What essence buys a soul next: its level, and its next tier (on its path, else a second path's), each
  // { label, cost } or null; and whether it can be promoted (that costs bodies, not essence).
  function nextBuys (u) {
    const level = u.lvl < TUNING.level.cap ? { label: `Lv ${u.lvl + 1}`, cost: levelCost(run, u) } : null
    const p = !u.path ? pathsOf(u.id)[0] : canAdvance(u, u.path) ? pathDef(u.id, u.path) : pathsOf(u.id).find((x) => x.id !== u.path && canAdvance(u, x.id))
    const tier = p && (!u.path || canAdvance(u, p.id))
      ? { label: !u.path ? 'Path I' : `${p.id === u.path ? '' : '2nd '}${ROMAN[nextTier(u, p.id)]}`, cost: tierCost(run, u, p.id), name: u.path ? p.name : null }
      : null
    return { level, tier, promote: canPromote(run, u) }
  }
  const affords = (b) => s.essence >= (b?.cost ?? Infinity)

  // The Soul tab with no soul selected: what essence buys now. Essence on top, a nudge when a Monarch point
  // is within reach, then every soul in a row with its next level's and next tier's prices (lit when
  // affordable) and a badge when a promotion is ready; a click selects the soul.
  function spendPanel () {
    const mCost = monarchCost(run)
    const rows = [...fielded(souls(s.party)), ...benched(souls(s.party))]
    const chip = (b, ico, what) => b && h('span', {
      class: 'sp-chip' + (affords(b) ? ' ok' : ''), tip: () => affords(b) ? what : poorText(b.cost)
    }, ico && icon(ico, 12), b.label, h('span', { class: 'price' }, icon('soul', 11), b.cost))
    const row = (u) => {
      const d = unitDef(u.id)
      const grade = u.grade ?? 0
      const b = nextBuys(u)
      const any = affords(b.level) || affords(b.tier) || b.promote
      return h('button', {
        class: 'sp-row' + (any ? ' can' : ''),
        onclick: () => { sel = { uid: u.uid }; soft = false; aim = null; error = ''; render() },
        tip: () => soulTip(u, onField(u) ? null : 'On the bench: does not fight.', 'Click to select it: its card opens here.')
      },
      h('span', { class: 'sp-port' }, portrait(u.id, 34, u.hp <= 0), h('span', { class: `sp-ins g${grade}` }, icon(GRADE_ICON[grade], 10))),
      h('span', { class: 'sp-main' },
        h('span', { class: 'sp-id' }, h('b', null, d.name), h('span', { class: 'dim' }, `Lv ${u.lvl}${onField(u) ? '' : ' · bench'}`)),
        h('span', { class: 'sp-buys' },
          chip(b.level, 'levelup', `Level ${u.lvl + 1}.`),
          chip(b.tier, null, b.tier?.name ? `${b.tier.name} ${b.tier.label.replace('2nd ', '')}${b.tier.label.startsWith('2nd') ? ', a second path' : ''}.` : 'Its first path tier: choose the path on its card.'),
          b.promote && h('span', { class: `sp-chip promote g${grade + 1}`, tip: () => `Ready to promote to ${GRADES[grade + 1].name}: it eats bodies of its kin, no essence.` },
            icon(GRADE_ICON[grade + 1], 12), 'Promote ready'))))
    }
    return h('div', { class: 'spend-panel' },
      h('div', { class: 'sp-head' },
        h('span', { class: 'sp-ess', tip: () => 'Essence: slain foes pay it. Spend it on levels, path tiers and the Monarch.' }, icon('soul', 18), h('b', null, s.essence)),
        h('span', { class: 'dim small' }, 'essence to spend. Select a soul for its card.')),
      s.essence >= mCost && h('button', {
        class: 'sp-nudge', onclick: () => openTab('monarch'),
        tip: () => 'Dominion widens the domain, Command grows every cohort, Will binds more of the slain.'
      }, icon('crown', 16), h('span', { class: 'grow' }, 'A Monarch point is in reach'), h('span', { class: 'price' }, icon('soul', 12), mCost)),
      rows.length
        ? h('div', { class: 'sp-list' }, rows.map(row))
        : h('p', { class: 'dim small' }, 'No souls yet: recruit after a win.'))
  }

  // The selected soul's cohort: which kind it leads (of its kin or role, from the bodies standing in the
  // ossuary that no other cohort leads), how many (up to Command, plus its rank's), in which shape; or clear it.
  function cohortPanel (u) {
    const c = u.cohort
    const cmd = cohortCap(s, u)
    const kinds = Object.keys(s.ossuary).filter((k) => canLead(u, k) && standingOf(s, k) > 0)
    const most = (k) => Math.min(cmd, freeBodies(s, k, u))
    const give = (kind, count, shape) => send(kind === null ? { type: 'cohort', uid: u.uid, kind } : { type: 'cohort', uid: u.uid, kind, count, shape })
    const line = (cls, ...kids) => h('p', { class: cls + ' small' }, ...kids)
    // A kind it may lead: its portrait, and how many of it no other cohort leads.
    const kindBtn = (k) => {
      const free = freeBodies(s, k, u)
      const on = c?.kind === k
      return h('button', {
        class: 'uc-kind' + (on ? ' on' : '') + (free < 1 ? ' locked' : ''), 'aria-disabled': free < 1 && !on ? 'true' : null, 'aria-label': unitDef(k).name,
        onclick: () => on ? null : free < 1 ? refuse(`Every ${unitDef(k).name} standing is led by another cohort: clear one of those first.`) : give(k, most(k), c?.shape ?? 'line'),
        tip: () => h('div', { class: 'syn-tip' }, h('b', null, unitDef(k).name),
          h('p', { class: 'dim' }, `${free} free of ${standingOf(s, k)} standing. ${on ? 'Led now.' : free < 1 ? 'Others lead them all.' : `Click to lead ${most(k)}.`}`))
      }, portrait(k, 30), h('span', { class: 'uc-kind-n' }, free))
    }
    // The bodies it leads, then the places left up to its cap, as a strip of small portraits.
    const strip = c && h('div', { class: 'strip', tip: () => `${bodies(c.kind, c.count)}, of up to ${cmd}: Command${u.grade ? ' and its rank' : ''}.` },
      Array.from({ length: Math.max(cmd, c.count) }, (_, i) => i < c.count ? portrait(c.kind, 24) : h('span', { class: 'feed-gap' })))
    const controls = c && h('div', { class: 'uc-ctl' },
      h('button', { class: 'step-btn', 'aria-label': 'One fewer', 'aria-disabled': c.count <= 1 ? 'true' : null, onclick: (e) => c.count > 1 ? give(c.kind, c.count - 1, c.shape) : shake(e), tip: () => c.count > 1 ? 'One fewer.' : 'At least one: ✕ clears it.' }, '−'),
      h('b', { class: 'uc-count' }, c.count),
      h('button', {
        class: 'step-btn', 'aria-label': 'One more', 'aria-disabled': c.count >= most(c.kind) ? 'true' : null,
        onclick: (e) => c.count < most(c.kind) ? give(c.kind, c.count + 1, c.shape) : shake(e),
        tip: () => c.count < most(c.kind) ? 'One more.' : c.count >= cmd ? `Full: up to ${cmd} (Command${u.grade ? ' and rank' : ''}).` : `No more ${unitDef(c.kind).name}s stand unled.`
      }, '+'),
      h('div', { class: 'uc-shapes' }, Object.entries(SHAPES).map(([k, sh]) => h('button', {
        class: 'uc-shape' + (c.shape === k ? ' on' : ''), 'aria-label': sh.name,
        onclick: () => { if (c.shape !== k) give(c.kind, c.count, k) },
        tip: () => h('div', { class: 'syn-tip' }, h('b', null, sh.name), h('p', null, sh.desc))
      }, shapeGlyph(k, Math.max(c.count, 4))))),
      h('button', { class: 'icon-btn small', 'aria-label': 'Clear', onclick: () => give(null), tip: () => `Clear: its ${bodies(c.kind, c.count)} go back to the ossuary.` }, icon('close', 14)))
    // One short line for each state where it leads no bodies into battle; a fallen soul on the field may
    // still be given a cohort (ready for when an altar raises it), its bodies sitting out with it.
    const fallen = onField(u) && u.hp <= 0 && (c || kinds.length > 0) && line('warn', 'Fallen: it and its cohort sit out until an altar raises it.')
    const state = !onField(u)
      ? (c ? line('dim', 'Benched: its ', bodies(c.kind, c.count), ' sit out with it.') : line('dim', 'Benched: field it to lead a ', kw('cohort'), '.'))
      : u.hp <= 0 && !c && !kinds.length ? line('dim', 'Fallen: it fights no battle until an altar raises it.')
        : cmd < 1 ? line('dim', 'No ', kw('command'), ': buy a point on the Monarch tab, or promote it: a ', kw('knight'), ` leads ${TUNING.ranks.cohort[1]} bodies even at Command 0.`)
            : !kinds.length ? line('dim', `No ${leadsText(u.id)} bodies stand. `, kw('bind'), ' some after a win.')
              : !c ? line('dim', 'Pick a kind to lead.') : null
    const open = onField(u) && cmd >= 1 && kinds.length > 0
    return h('div', { class: 'uc-cohort' },
      h('div', { class: 'uc-sec', tip: () => `It leads ${leadsText(u.id)} bodies.` }, kw('cohort'),
        c && h('span', { class: 'dim' }, ` · ${c.count}/${cmd} · ${SHAPES[c.shape].name}`)),
      fallen,
      state,
      strip,
      open && h('div', { class: 'uc-kinds' }, kinds.map(kindBtn)),
      open ? controls : c && h('button', { class: 'small ghost', onclick: () => give(null), tip: () => `Its ${bodies(c.kind, c.count)} go back to the ossuary.` }, icon('close', 12), ' Clear'))
  }

  // The rank-and-file: the muster in one row with its buy button, then the kinds as a portrait grid, each
  // with how many stand (and have fallen), and how many of them cohorts lead. The rest is on hover.
  function ossuaryPanel () {
    const kinds = Object.entries(s.ossuary).filter(([, o]) => o.standing + o.fallen > 0)
    const cap = TUNING.army.muster.cap
    const cost = musterCost(run)
    const leaders = (k) => souls(s.party).filter((u) => u.cohort?.kind === k)
    // The muster's buy: a refusal (too little essence) is only a sound; the tooltip says why.
    const buy = () => {
      if (s.essence < cost) return sfx.play('poor')
      send({ type: 'muster' })
      sfx.play(error ? 'poor' : 'buy')
    }
    return h('div', { class: 'ossuary-panel' },
      h('h2', { tip: () => h('div', { class: 'syn-tip' }, kw('ossuary'), ' ', ARMY_TEXT.ossuary, h('p', { class: 'dim' }, ARMY_TEXT.bind(run))) },
        icon('bone', 16), ' Ossuary ', h('span', { class: 'oss-count' }, h('b', null, armyCount(s, 'standing')), ' standing'),
        armyCount(s, 'fallen') > 0 && h('span', { class: 'oss-count fell' }, h('b', null, armyCount(s, 'fallen')), ' fallen')),
      h('div', { class: 'muster-row', tip: () => h('div', { class: 'syn-tip' }, kw('muster'), ' ', ARMY_TEXT.muster(run)) },
        h('span', { class: 'mu-name' }, 'Muster'),
        h('span', { class: 'mu-lvl' }, s.muster),
        s.muster < cap && [h('span', { class: 'mu-arrow dim' }, '→'), h('span', { class: 'mu-next' }, s.muster + 1)],
        h('span', { class: 'grow dim small' }, 'every body\'s level'),
        s.muster < cap
          ? h('button', {
            class: 'buy' + (s.essence < cost ? ' poor' : ''), 'aria-disabled': s.essence < cost ? 'true' : null, onclick: buy,
            tip: () => s.essence < cost ? `You need ${cost} essence; you have ${s.essence}.` : `Every body fights at level ${s.muster + 1}.`
          }, icon('levelup', 14), h('span', { class: 'price' }, icon('soul', 12), cost))
          : h('span', { class: 'chip-cap' }, 'cap')),
      kinds.length
        ? h('div', { class: 'bone-grid' }, kinds.map(([k, o]) => {
          const led = leaders(k)
          const n = led.reduce((m, u) => m + u.cohort.count, 0)
          const kin = KIN[unitDef(k).kin].name
          return h('div', {
            class: 'bone-tile' + (o.standing === 0 ? ' gone' : ''),
            tip: () => unitCard({ id: k, lvl: s.muster, path: null, tier: 0, slot: -1, rank: true }, {
              mods: partyMods(run),
              notes: [`${o.standing} standing · ${o.fallen} fallen · ${led.length ? `led by ${led.map((u) => `${unitDef(u.id).name} (${u.cohort.count})`).join(', ')}` : 'none led'}`,
                `Leads under ${leadsText(k)} captains; promotes ${kin} souls (${kinStanding(s, unitDef(k).kin)} ${kin} stand).`]
            })
          },
          h('div', { class: 'bt-port' }, portrait(k, 40, o.standing === 0),
            h('span', { class: 'bt-stand' }, o.standing),
            o.fallen > 0 && h('span', { class: 'bt-fell' }, `${o.fallen}`)),
          h('div', { class: 'bt-name' }, unitDef(k).name),
          h('div', { class: 'bt-led' + (n ? ' on' : '') }, n ? `${n} led` : 'unled'))
        }))
        : h('p', { class: 'dim small' }, 'No bodies yet: after a win, ', kw('bind'), ` the slain (${1 + s.monarch.will} free).`))
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
    // A segmented button: an icon over its word.
    const seg = (on, ico, label, onclick, t) => h('button', { class: 'seg' + (on ? ' active' : ''), onclick, tip: t }, icon(ico, 15), h('span', null, label))
    const WHERE_ICON = { hunt: 'o-hunt', stay: 'o-stay', move: 'o-move' }
    const WHEN_ICON = { once: 'w-once', time: 'w-time', struck: 'w-struck', wave: 'w-wave', falls: 'w-falls' }
    const WHEN_WORD = { once: 'Now', struck: 'Struck', wave: 'Wave', falls: 'Falls' }
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
      const whereTip = (k) => tip(ORDERS.where[k].name, KEYWORDS[k].line,
        k === 'move' && (p.where === 'move' ? 'Click, then a cell of the board, to move its square.' : 'Click, then a cell of the board: camp, open ground or their formation.'))
      // Its plan in one line: where, when, and whether it waits behind the camp.
      const state = [kw(p.where), p.where === 'move' && ' to its square', ` · ${whenText(p.when)}`, waits(d) && [' · ', kw('held')]]
      return h('div', { class: 'det' + (aim === d.id ? ' aiming' : ''), style: `--d:${d.color}` },
        h('div', { class: 'det-head' },
          h('span', { class: 'det-sw', tip: () => `Detachment ${d.id}'s colour: its souls' tag, its square and its arrow.` }, d.id),
          h('div', { class: 'grow det-state' }, state),
          h('button', { class: 'small ghost', onclick: () => send({ type: 'disband', id: d.id }), tip: () => `Disband: its souls Hunt, at once.` }, icon('close', 12), ' Disband')),
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
        h('div', { class: 'det-row' }, h('span', { class: 'det-k' }, 'Where'),
          h('div', { class: 'segs icon-segs' }, Object.keys(ORDERS.where).map((k) => seg(p.where === k || (k === 'move' && aim === d.id), WHERE_ICON[k], ORDERS.where[k].name,
            () => {
              error = ''
              if (k !== 'move') { aim = null; return setPlan(d, { where: k }) }
              aim = aim === d.id ? null : d.id
              render()
            }, whereTip(k))))),
        aim === d.id && h('p', { class: 'aim-hint small' }, icon('o-move', 13), ' Click a cell for its square. Esc cancels.'),
        p.where === 'move' && aim !== d.id && h('p', { class: 'det-note small' + (far ? ' warn' : ' dim') }, far
          ? ['One-way: its square is ', distance(p.square, mTile), ` tiles out, past the `, kw('domain'), ` (${dom}); it will `, kw('falter'), '.']
          : out ? ['Past the ', kw('domain'), ', but a ', kw('marshal'), ' keeps its plan there.']
            : `Square: ${tileText(p.square)}.`),
        h('div', { class: 'det-row' }, h('span', { class: 'det-k' }, 'When'),
          h('div', { class: 'segs icon-segs' }, Object.entries(ORDERS.when).map(([k, o]) => seg(p.when.at === k, WHEN_ICON[k], k === 'time' ? secs(t) : WHEN_WORD[k],
            () => { error = ''; setPlan(d, { when: k === 'time' ? { at: k, t } : { at: k } }) },
            tip(o.name, o.desc, k === 'wave' && ORDER_TEXT.wave, k !== 'once' && KEYWORDS.held.line))))),
        p.when.at === 'time' && h('div', { class: 'det-time' },
          icon('w-time', 14),
          h('button', { class: 'small step-btn', 'aria-disabled': t <= step ? 'true' : null, onclick: () => { if (t > step) setT(t - step) }, tip: () => t > step ? '5 s sooner.' : `${secs(step)} at the soonest.` }, '−'),
          h('b', null, secs(t)),
          h('button', { class: 'small step-btn', 'aria-disabled': t >= tMax ? 'true' : null, onclick: () => { if (t < tMax) setT(t + step) }, tip: () => t < tMax ? '5 s later.' : `The latest start: a battle still undecided ${secs(TUNING.tick.ceiling)} after its last foe entered is lost.` }, '+'),
          h('span', { class: 'dim small' }, 'into the battle')))
    }

    const ds = s.detachments.slice().sort((a, b) => a.id - b.id)
    return h('div', { class: 'orders-panel' },
      h('h2', { tip: tip('Orders', ORDER_TEXT.detachments, ORDER_TEXT.reaction, ORDER_TEXT.leash) },
        icon('o-move', 16), ' Orders ', h('span', { class: 'ord-count' }, `${s.detachments.length}/${cap}`)),
      h('div', { class: 'pick-row' },
        h('button', {
          class: 'small' + (picking ? ' on' : ''),
          onclick: () => { picking = !picking; aim = null; error = ''; render() },
          tip: () => picking ? 'Stop picking: a click selects again.' : 'While on, a click on a soul on the field picks or drops it (Shift- or Ctrl-click always does).'
        }, picking ? 'Done' : 'Pick'),
        pick.length
          ? [h('span', { class: 'picked' }, pick.map((uid) => portrait(soulOf(uid).id, 24))),
              h('button', { class: 'small primary-ord', onclick: () => form(pick), tip: () => `${pick.map((uid) => name(soulOf(uid))).join(', ')}: a new detachment, Hunting at once until you plan it. Each leaves any other.` }, `Form (${pick.length})`),
              h('button', { class: 'small link', onclick: () => { unpick(); error = ''; render() }, tip: () => 'Drop the picked souls.' }, 'Clear')]
          : one && !mine
            ? h('button', { class: 'small', onclick: () => form([one.uid]), tip: () => `${name(one)} alone: Hunts at once until you plan it.` }, `New: ${name(one)}`)
            : h('span', { class: 'dim small' }, picking ? 'Click souls to pick.' : 'Shift-click souls to pick.')),
      ds.length ? ds.map(card) : h('p', { class: 'dim small' }, 'None: every soul ', kw('hunt', 'Hunts'), ', at once.'))
  }

  // A shift-, ctrl- or cmd-click (or any click in Pick mode) picks souls for a detachment.
  const picks = (e) => picking || !!(e?.shiftKey || e?.ctrlKey || e?.metaKey)

  // A click on a cell: a soul there is selected (to inspect it), an empty cell takes the selected soul. `swap`
  // (a drop, or X on the keyboard) moves the selected soul onto the soul there instead: the two trade places.
  function clickSlot (slot, e, swap = false) {
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
      else if (o && !swap) sel = { uid: o.uid }
      else if (o && isMonarch(o) && picked.slot < 0) return refuse(`The Monarch never goes to the bench: place ${unitDef(picked.id).name} on another cell.`)
      else if (!o && picked.slot < 0 && full()) return refuse(fullText(picked))
      else return send({ type: 'place', uid: sel.uid, slot })
    } else if (o) {
      if (!swap) sel = { uid: o.uid }
      else return send({ type: 'place', uid: o.uid, slot: sel.slot })
    } else sel = sel.slot === slot ? null : { slot }
    error = ''
    render()
  }

  // A click on a benched soul selects it, or places it in a selected empty cell; `swap` (a drop on it) trades
  // it for the selected soul on the field.
  function clickBench (u, e, swap = false) {
    if (aim != null) return refuse('The bench is not on the board: click a cell of the board for the square, or press Esc.')
    if (picks(e)) return togglePick(u)
    settle(u)
    const picked = selected()
    if (swap && picked && isMonarch(picked)) return refuse('The Monarch never goes to the bench. Pick a soul to swap with this one.')
    if (swap && picked && picked !== u && picked.slot >= 0) return send({ type: 'place', uid: u.uid, slot: picked.slot })
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
  // A soul still in the retinue and on the field: the only kind the rules take orders for.
  const fieldedUid = (uid) => { const u = soulOf(uid); return !!u && onField(u) }
  // Picks benched or released since they were picked drop out (run before every redraw).
  const prunePicks = () => { if (pick.some((uid) => !fieldedUid(uid))) pick = pick.filter(fieldedUid) }
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
    uids = inOrder(uids.filter(fieldedUid))
    if (!uids.length) { unpick(); return refuse('Nobody picked stands on the field: a benched soul takes no orders.') }
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
    // A pick benched (or released) since it was picked takes no orders: it is dropped, and if no one is
    // left to join, refused in words before anything is sent.
    const gone = uids.filter((uid) => !fieldedUid(uid))
    pick = pick.filter((uid) => !gone.includes(uid))
    const fresh = uids.filter((uid) => !gone.includes(uid) && !d.members.includes(uid))
    if (!fresh.length) {
      const names = gone.map(soulOf).filter(Boolean).map((u) => unitDef(u.id).name)
      return refuse(names.length ? `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} on the bench now, and a benched soul takes no orders: field ${names.length === 1 ? 'it' : 'them'} first.`
        : `Nobody new to add to detachment ${d.id}.`)
    }
    uids = inOrder([...d.members.filter((uid) => onField(soulOf(uid))), ...fresh])
    const same = s.detachments.find((x) => x !== d && x.members.length === uids.length && uids.every((uid) => x.members.includes(uid)))
    if (same) return refuse(`They already are detachment ${same.id}.`)
    if (kept(uids).filter((x) => x !== d).length >= cap) return refuse(`At most ${cap} detachments: disband one first.`)
    sendAll([{ type: 'disband', id: d.id }, { type: 'order', uids, plan: d.plan }], unpick)
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
    if (picked && o && isMonarch(o) && picked.slot < 0) return `Click to select it. The Monarch never goes to the bench, so ${unitDef(picked.id).name} cannot take its cell.`
    if (picked && o) return `Click to select it. Drag ${unitDef(picked.id).name} onto it to swap them.`
    if (picked && !o && picked.slot < 0 && full()) return fullText(picked)
    if (!o && member) {
      if (!picked) return `Click to select its captain, ${unitDef(captainOf(member).id).name}.`
      return `Click to move ${unitDef(picked.id).name} here: the ${unitDef(member.id).name} makes way` + (picked.slot < 0
        ? `, and with one more soul on the board a body may ${TUNING.army.overflow ? 'have to wait in reserve' : 'find no room and sit the battle out'}.` : ' and stands elsewhere in its banner.')
    }
    if (picked && isMonarch(picked) && !o && sealedBy(s.camp, slot).length) return `Click to move the Monarch here. ${sealText(sealedBy(s.camp, slot).length)}`
    if (picked) return `Click to move ${unitDef(picked.id).name} here.`
    return o ? 'Click to select it. Drag it to move it, or onto a soul to swap them.' : null
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

  // A soul's one live line (its card's third): fallen, benched, held, faltering or not, its orders. `lead`
  // goes first when given (what a click would do with a soul selected, a melee blocked).
  function soulLive (u, lead = null) {
    if (lead) return lead
    if (u.hp <= 0) return 'Fallen: an altar raises it'
    if (!onField(u)) return 'On the bench: it does not fight'
    if (isMonarch(u)) return `Domain ${realmOf(run).domain} · if it falls, the run ends`
    const d = detOf(u)
    if (d && waits(d)) return `Held: ${d.id} enters ${whenText(d.plan.when)}`
    const m = marshalOf(s, u)
    const where = startsFaltering(s, u) ? `Falters ×${TUNING.monarch.falter}: outside the domain`
      : faltersAt(s, u.slot) && m ? (m === u ? 'Marshal: never falters' : `In ${unitDef(m.id).name}'s domain`) : 'In the domain'
    return `${where} · ${d ? `${d.id}: ${ORDERS.where[d.plan.where].name}` : 'Hunts'}`
  }

  function soulTip (u, where, extra, lead = null) {
    const all = [...fielded(s.party).filter((x) => !isHeld(s, x)), ...armyOf(run).members]
    const alias = aliasOf(run)
    const c = u.cohort
    return unitCard(u, {
      mods: [...partyMods(run, u), ...bondMods(all, u, alias)],
      realm: realmOf(run),
      live: soulLive(u, lead),
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
    prunePicks()
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
    // strike it. Each one held at the start screens it; a bare one is a way in.
    const walls = new Set(wallTiles(s.camp))
    const approach = new Set(neighbours(mTile).filter((t) => !walls.has(t) && tileY(t) <= CAMP_ROWS))
    const bare = [...approach].filter((t) => !startAt.has(t))
    const approachNote = (tile) => approach.has(tile) && (startAt.has(tile)
      ? 'Approach tile, held: it screens the Monarch.'
      : 'Approach tile, open: a foe here can strike the Monarch.')
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
    // a one-way trip), and every tile a target while a detachment aims.
    // A one-way trip: a square outside the domain, for a detachment with a soul that is no Marshal (a Marshal
    // never falters, so it keeps its plan out there; see oneWay).
    const far = (d) => oneWay(s, d, cTile, realm.domain)
    const squares = new Map()
    for (const d of s.detachments) if (d.plan.where === 'move' && takesPart(s, d)) squares.set(d.plan.square, [...(squares.get(d.plan.square) ?? []), d])
    const squareNotes = (tile) => [...(squares.get(tile) ?? []).map((d) => `${d.id}'s Move square${waits(d) ? `, entering ${whenText(d.plan.when)}` : ''}: on or beside it, it Hunts` +
      (far(d) ? '. Past the domain: one-way.' : '.')),
    aim != null && `Click: detachment ${aim}'s square.`]
    // A board tile's tooltip in two lines: what it is and whether the domain reaches it; then the one thing that
    // matters here now (the aim, a Move square, an approach tile, what a drop would do), else `text`.
    const tileTipOf = (title, inside, tile, text) => h('div', { class: 'syn-tip tile-tip' },
      h('div', null, h('b', null, title), ' · ', inside ? h('span', { class: 'dim' }, 'in the domain') : h('span', { class: 'falter-note' }, `past the domain: ×${TUNING.monarch.falter}`)),
      h('div', { class: 'dim' }, [aim != null && squareNotes(tile).at(-1), squareNotes(tile)[0], approachNote(tile), text].find(Boolean)))
    // Empty ground past the camp (the open row, their formation's).
    const groundTip = (title, text, tile, inside) => () => tileTipOf(title, inside, tile, text)
    // Each Marshal's own domain, a dashed square in its banner's colour (gold with no cohort), drawn per cell
    // (a held Marshal enters beside the Monarch, so it outlines nothing in the camp).
    const marshals = marshalsOn().map((x) => ({ x, d: domainOn(x, TUNING.ranks.domain), colour: colours.get(x.uid) ?? MARSHAL_GOLD }))
    // ── the board: drawn by board.js on the battle's own picture ──
    // What stands on each tile and what the editor marks there (the picture board.js draws), each tile's
    // tooltip (`tips`) and what a click on it does (clickTile). Their ground is always drawn: empty on the map.
    const units = []
    tips = new Map()
    // A member keeps its key while its captain moves, so the board walks it over: its captain, its place in the
    // banner.
    const nth = new Map()
    const memberKey = new Map(army.members.map((x) => {
      const i = nth.get(x.cohortOf) ?? 0
      nth.set(x.cohortOf, i + 1)
      return [x, `m${x.cohortOf}:${i}`]
    }))
    // A detachment's tag (id, ■ Stay, → Move, a held start); a member wears its captain's as a dot.
    const detMark = (d, dot = false) => d && { id: d.id, color: d.color, where: d.plan.where, start: waits(d) ? whenTag(d.plan.when) : null, dot }
    // A captain's flag counts the bodies it leads into the battle (on the board or held with it), as the battle's.
    const led = new Map()
    for (const b of [...army.members, ...army.held.filter((x) => x.rank)]) led.set(b.cohortOf, (led.get(b.cohortOf) ?? 0) + 1)
    const selTile = sel?.slot != null ? deployTile('party', sel.slot) : null
    const drop = []
    for (let r = 0; r < CAMP_ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const slot = slotAt(r, c)
        const tile = deployTile('party', slot)
        if (isWall(s.camp, slot)) {
          tips.set(tile, () => h('div', { class: 'syn-tip tile-tip' }, h('div', null, h('b', null, 'Wall'), ' · blocks walking, not attacks'), aim != null && h('div', { class: 'dim' }, 'A Move square must be open ground.')))
          continue
        }
        const u = field.find((x) => x.slot === slot)
        const mem = memberAt.get(slot) ?? null
        const heldHere = u && held.has(u.uid)
        const falters = u && !isMonarch(u) && u.hp > 0 && !heldHere ? startsFaltering(s, u) : !u && mem ? startsFaltering(s, mem) : false
        const det = u ? detOf(u) : mem ? detOf(captainOf(mem)) : null
        if (moving && !u && !(moving.slot < 0 && full()) && aim == null) drop.push(tile)
        // A fallen soul's cell may hold a member (the fallen do not fight): the soul shows, the member is noted.
        const memNote = mem && `In battle a ${unitDef(mem.id).name} of ${unitDef(captainOf(mem).id).name}'s banner stands here, rank-and-file at muster level ${s.muster}.`
        if (u) {
          units.push({
            key: `s${u.uid}`, id: u.id, tile, side: 'party', hp: u.hp, maxHp: u.maxHp, lvl: u.lvl, grade: u.grade ?? 0, tier: u.tier ?? 0, tier2: u.tier2 ?? 0,
            monarch: isMonarch(u), fallen: u.hp <= 0, ghost: heldHere ? 0.45 : 1, banner: colours.get(u.uid) ?? null, count: led.get(u.uid) ?? 0,
            det: detMark(det), falters, bonded: bonded.has(u.uid), behind: !!behind(u), centre: crowned && !isMonarch(u) && slot === centre,
            seal: isMonarch(u) && sealedBy(s.camp, slot).length > 0, sel: sel?.uid === u.uid, pick: pick.includes(u.uid),
            under: u.hp <= 0 && mem ? { id: mem.id, colour: colours.get(mem.cohortOf) ?? null, led: !!picked && mem.cohortOf === picked.uid } : null
          })
        } else if (mem) {
          units.push({
            key: memberKey.get(mem), id: mem.id, tile, side: 'party', rank: true, hp: mem.hp, maxHp: mem.maxHp, lvl: s.muster, banner: colours.get(mem.cohortOf) ?? null,
            det: detMark(det, true), falters, bonded: bonded.has(mem.uid), led: !!picked && mem.cohortOf === picked.uid, ghost: 0.72
          })
        }
        // A unit's card leads with what a click would do now (the aim, a selected soul's move), else its state.
        const doing = (o, m = null) => (aim != null && squareNotes(tile).at(-1)) || (aim == null && mover() && selected() !== o && slotHint(slot, o, m)) || null
        tips.set(tile, () => u
          ? soulTip(u, `In the camp: ${campRowLabel(r).toLowerCase()}.`, [u.hp <= 0 && memNote, behindNote(u), approachNote(tile), ...squareNotes(tile), aim == null && slotHint(slot, u)],
            doing(u) || (behind(u) && `Melee behind ${unitDef(behind(u).id).name}: strikes nothing yet`))
          : mem
            ? unitCard(mem, {
              mods: [...partyMods(run), ...bondMods(all, mem, alias)],
              live: doing(null, mem) || (falters ? `Falters ×${TUNING.monarch.falter}: outside the domain` : `${unitDef(captainOf(mem).id).name}'s banner · muster ${s.muster}`),
              notes: [`Rank-and-file of ${unitDef(captainOf(mem).id).name}'s banner (${SHAPES[captainOf(mem).cohort.shape].name}), at muster level ${s.muster}. In the camp: ${campRowLabel(r).toLowerCase()}.`,
                det && `Detachment ${det.id}: it follows its captain's plan, ${planText(det.plan)}.`,
                domainLine(slot, mem), ...bondNotes(all, mem, alias), approachNote(tile), ...squareNotes(tile), aim == null && slotHint(slot, null, mem)]
            })
            : tileTipOf(campRowLabel(r), !faltersAt(s, slot), tile,
              (aim == null && slotHint(slot, null)) || (full() ? `The field is full (${cap} souls): swap or bench one first.` : 'Drag a soul here.')))
      }
    }
    // The open ground: one row of the board between your camp's front and their formation (camp row −1).
    for (let c = 0; c < COLS; c++) {
      const tile = tileAt(c, CAMP_ROWS)
      tips.set(tile, groundTip(`Open ground, lane ${c + 1}`, 'Between your camp and their formation.', tile, dom.inside(-1, c)))
    }
    const ground = { tip: groundTip, notes: squareNotes }
    const theirs = foeTiles(run, facing, dom, ground)
    for (const [tile, tip] of theirs.tips) tips.set(tile, tip)
    // Past the camp's front lie only DEPTH − CAMP_ROWS rows: the open ground, then their formation's.
    const reachText = !dom.beyond ? 'It stays inside your camp.'
      : dom.beyond > DEPTH - CAMP_ROWS ? 'It reaches past your front to the far edge of the board.'
        : `It reaches ${dom.beyond} row${dom.beyond > 1 ? 's' : ''} past your front: ${['the open ground', 'their front row', 'their middle row', 'their back row'][dom.beyond - 1]}.`
    const out = [...fieldSouls.filter((u) => u.hp > 0 && !held.has(u.uid)), ...army.members].filter((u) => startsFaltering(s, u))
    const boardCap = TUNING.army.board
    // Held bodies, by detachment, in the order they enter once called.
    const heldBy = [...new Set(army.held.map((b) => b.det))].map((id) => s.detachments.find((d) => d.id === id)).map((d) => [d, army.held.filter((b) => b.det === d.id)])
    const waiting = army.reserve.length + army.held.length
    // From each Move detachment to its square: from its souls' cells, or from the Monarch for a held one
    // (it enters beside it).
    const arrows = s.detachments.filter((d) => d.plan.where === 'move' && takesPart(s, d)).map((d) => ({
      color: d.color, to: d.plan.square, far: far(d), held: waits(d),
      from: waits(d) ? [mTile] : fieldSouls.filter((u) => d.members.includes(u.uid) && u.hp > 0).map((u) => deployTile('party', u.slot))
    })).filter((a) => a.from.length)
    tips.set('reserve', () => h('div', { class: 'syn-tip tile-tip' }, h('div', null, h('b', null, 'Behind the camp'), ` · ${onBoard}/${boardCap} bodies on the board`),
      heldBy.length > 0 && h('div', { class: 'dim' }, `Held: ${heldBy.map(([d, bs]) => `${d.id} (${bs.length}) enters ${whenText(d.plan.when)}`).join('; ')}.`),
      h('div', { class: 'dim' }, army.reserve.length ? ARMY_TEXT.reserve(army.reserve.length) : heldBy.length ? null : 'No one waits here.')))
    const picture = {
      walls: [...walls], facing: !!facing, units: [...units, ...theirs.units],
      domain: { centre: cTile, r: realm.domain, crowned },
      marshals: marshals.map(({ x, colour }) => ({ key: `s${x.uid}`, tile: deployTile('party', x.slot), colour })),
      approach: [...approach].map((tile) => ({ tile, bare: !startAt.has(tile) })),
      line: lineY,
      // A held detachment's start is a tag on its square too (reDESIGN §3), as on its souls.
      squares: [...squares].map(([tile, ds]) => ({
        tile, color: ds[0].color, far: ds.every(far), tags: ds.map((d) => ({ text: waits(d) ? `${d.id} · ${capsTag(whenTag(d.plan.when))}` : String(d.id), color: d.color }))
      })),
      arrows,
      waiting: waiting > 0 ? {
        held: heldBy.map(([d, bs]) => ({ tag: `${d.id} · ${capsTag(whenTag(d.plan.when))}`, color: d.color, bodies: bs.map((b) => ({ id: b.id, banner: b.rank ? colours.get(b.cohortOf) ?? null : null })) })),
        reserve: army.reserve.map((b) => ({ id: b.id, banner: colours.get(b.cohortOf) ?? null }))
      } : null,
      selTile, selKey: picked ? `s${picked.uid}` : selTile != null ? `t${selTile}` : null, drop, aim: aim != null
    }
    // Under the board, short: the camp, the domain, the line and the approach, a Marshal's own domain. The
    // board shows each; the full rule is in the tooltip.
    // A column of chips in its corner, or a row over the board, whichever leaves the board bigger (board.js picks,
    // and the next legend starts as the last one was).
    const legend = h('div', { class: 'board-legend', 'data-forms': 'col row', 'data-form': el.querySelector('.board-legend')?.dataset.form ?? 'col' },
      h('span', { class: 'bk bk-camp', tip: () => h('div', { class: 'syn-tip tile-tip' }, h('div', null, h('b', null, campDef(s.camp).name), ` · this floor's camp, ${fieldSouls.length} of ${cap} souls (${fieldRule(run)})`), h('div', { class: 'dim' }, ARMY_TEXT.board)) },
        h('b', null, campDef(s.camp).name), ` ${fieldSouls.length}/${cap} souls${alive < fieldSouls.length ? ` · ${alive} standing` : ''}${held.size ? ` · ${held.size} held` : ''} · ${onBoard}/${boardCap} bodies`),
      h('span', {
        class: 'bk' + (crowned ? ' crowned' : ''),
        tip: () => h('div', { class: 'syn-tip tile-tip' },
          h('div', null, h('b', null, `Domain ${realm.domain}`), ` · within ${realm.domain} of ${crowned ? 'your front-most captain' : 'the Monarch'}; outside, yours falter ×${TUNING.monarch.falter}`),
          h('div', { class: out.length ? 'falter-note' : 'dim' }, out.length ? `${out.length} of yours stand${out.length === 1 ? 's' : ''} outside and will falter.` : reachText))
      }, h('i', { class: 'dk-box' }), `Domain ${realm.domain}`, out.length > 0 && h('span', { class: 'falter-note' }, ` · ${out.length} falter`)),
      lineKey(lineY, mTile, approach, bare),
      marshals.length > 0 && h('span', {
        class: 'bk',
        tip: () => h('div', { class: 'syn-tip tile-tip' }, h('div', null, h('b', null, `Marshal ${TUNING.ranks.domain}`), ` · ${marshals.map(({ x }) => unitDef(x.id).name).join(', ')}'s own domain (dashed)`),
          h('div', { class: 'dim' }, 'Its banner never falters within it; it moves with the Marshal.'))
      }, marshals.map(({ colour }) => h('i', { class: 'mk-box', style: `--m:${colour}` })), `Marshal ${TUNING.ranks.domain}`))
    // The waves still to come, a small strip over their corner of the board: who comes, never what they do.
    const waves = facing?.waves?.length > 0 && h('div', { class: 'board-waves' },
      h('div', { class: 'gridlabel foe', tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'Still to come'), h('p', null, facing.waves[0].when.at === 'time' ? ENEMY_TEXT.late : ENEMY_TEXT.waves), h('p', { class: 'dim' }, ENEMY_TEXT.entry)) },
        'Still to come'),
      wavePreview(run, facing))
    stage.className = 'board-stage' + (aim != null ? ' aiming' : '') + (moving && aim == null ? ' moving' : '') + (keyed ? ' kb' : '')
    // The bench beside the board: where a soul is dropped (or a selected one clicked) to bench it.
    const benchEl = h('div', { class: 'bench-row' },
      h('span', { class: 'rs-label', tip: () => 'Souls here are kept but do not fight, and lead no cohort into battle. Swap them onto the field at any time before a battle. The Monarch never comes here.' }, `Bench ${bench.length}`),
      h('div', {
        class: 'bench' + (benchable(moving) ? ' target' : ''),
        onclick: (e) => { if (e.target === e.currentTarget) clickBenchSpace() },
        tip: () => benchable(moving) ? `Click empty space here (or drop a soul here) to bench ${unitDef(moving.id).name}.`
          : moving && isMonarch(moving) ? 'The Monarch never goes to the bench.' : 'Benched souls. Drag a soul here to bench it, or select it and click here.'
      },
      bench.length
        ? bench.map((u) => h('button', {
          class: 'cell has' + (picked === u ? ' sel' : '') + (u.hp <= 0 ? ' fallen' : '') + (colours.has(u.uid) ? ' captain' : ''),
          style: styles(banner(u.uid), detOf(u) && `--d:${detOf(u).color}`),
          'data-uid': u.uid,
          onpointerdown: (e) => pressBench(e, u),
          onclick: (e) => { if (swallow) { swallow = false; return } clickBench(u, e) },
          tip: () => {
            const act = picked === u ? 'Click again to deselect.' : moving && isMonarch(moving) ? 'The Monarch cannot trade places with a benched soul.'
              : moving && moving.slot >= 0 ? `Click to select it. Drag ${unitDef(moving.id).name} onto it to swap them.`
                : sel?.slot != null ? (full() ? fullText(u) : 'Click to place it in the selected cell.') : null
            return soulTip(u, 'On the bench: does not fight.', act ?? 'Drag it onto the field to place it.', act)
          }
        }, cellBody(u, detOf(u))))
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
      { id: 'soul', name: 'Soul', ico: 'hood', desc: 'The selected soul: its level, path, rank and cohort. With none selected, what essence buys.' },
      { id: 'monarch', name: 'Monarch', ico: 'crown', desc: 'Dominion, Command and Will: the Monarch\'s three stats.' },
      { id: 'orders', name: 'Orders', ico: 'o-move', count: s.detachments.length, desc: 'Detachments and their plans: Hunt, Stay or Move, now or later.' },
      { id: 'ossuary', name: 'Ossuary', short: 'Bones', ico: 'bone', count: armyCount(s, 'standing'), desc: 'Your rank-and-file bodies and the muster level they fight at.' },
      { id: 'bonuses', name: 'Bonuses', short: 'Bonus', ico: 'bonuses', count: synergies.querySelectorAll('.syn.on').length + s.relics.length + s.keystones.length, desc: 'Synergies, bonds, relics and keystones in effect.' }]
    const pickTab = openTab
    const body = {
      soul: () => picked && !isMonarch(picked)
        ? soulCard(picked)
        : picked ? h('p', { class: 'dim upgrade-hint' }, 'The Monarch grows by its own points: see the Monarch tab.') : spendPanel(),
      monarch: () => monarchPanel(picked && isMonarch(picked)),
      orders: () => ordersPanel(picked),
      ossuary: () => ossuaryPanel(),
      // Each kind of bonus a labelled row of chips: lit when in effect; hover one for its rule.
      bonuses: () => h('div', { class: 'bonuses' },
        h('div', { class: 'bn-sec' }, h('div', { class: 'bn-k' }, kw('synergy', 'Synergies')), synergies),
        h('div', { class: 'bn-sec' }, h('div', { class: 'bn-k' }, kw('bond', 'Bonds')), bondTracker(all, alias)),
        h('div', { class: 'bn-sec' }, h('div', { class: 'bn-k' }, kw('relic', 'Relics'), h('span', { class: 'bn-n' }, `${s.relics.length}/${TUNING.essence.relicMax}`)), relicList(s.relics)),
        h('div', { class: 'bn-sec' }, h('div', { class: 'bn-k' }, kw('keystone', 'Keystones'), h('span', { class: 'bn-n' }, `${s.keystones.length}/${TUNING.keystone.max}`)), keystoneList(s.keystones)))
    }
    // The stage moves into the new column: one with the keyboard's focus keeps it (and its cursor).
    keeping = document.activeElement === stage
    const col = h('div', { class: 'board-col' }, h('div', { class: 'board-main' }, benchEl, h('div', { class: 'stage-wrap' }, stage, waves, legend)))
    // The tray is kept, not rebuilt (see trayEl): the board's column is swapped in front of it.
    if (trayEl.parentNode === el) el.firstElementChild.replaceWith(col)
    else fill(el, col, trayEl)
    if (keeping && stage.isConnected) stage.focus({ preventScroll: true })
    keeping = false
    const now = `${trayTab}:${selUid}`
    // Its body stays in place too (taken out and put back, it would lose its scroll): what is above it is redrawn.
    if (trayBody.parentNode !== trayEl) fill(trayEl, trayBody)
    while (trayEl.firstChild !== trayBody) trayEl.firstChild.remove()
    trayBody.before(...[
      tabBar(tabs, trayTab, pickTab, 'tray-tabs'),
      error && h('p', { class: 'warn' }, error)].filter(Boolean))
    fill(trayBody, body[trayTab]())
    if (now !== shown) { trayBody.scrollTop = 0; trayEl.scrollTop = 0 }
    shown = now
    board.show(stage, picture, [waves, legend])
    // The tooltip under the pointer follows what the click just changed.
    if (hover != null && !drag) tileTip(hover)
  }

  // ── the board under the pointer ──
  // A press on the board (or on a benched soul) is a click, unless it moves past a few pixels with a soul under
  // it: then that soul lifts and follows, and the drop does what a click on it and then on the tile would. The
  // tooltip follows the pointer from tile to tile; the board rings the tile under it.

  function tileTip (t) {
    const r = t != null && tips.has(t) && board.rectOf(t)
    if (r) showTip(r, tips.get(t))
    else hideTip()
  }

  // The camp slot of a board tile, or null past the camp.
  const slotOfTile = (t) => typeof t === 'number' && tileY(t) < CAMP_ROWS ? slotAt(CAMP_ROWS - 1 - tileY(t), tileX(t)) : null

  stage.addEventListener('pointermove', (e) => {
    if (press || drag) return
    const t = board.tileAt(e.clientX, e.clientY)
    // A scroll or a resize hides a tile's tooltip (dom.js) and leaves `hover` as it was: moving on in the same
    // tile brings it back.
    if (t === hover && (t == null || document.querySelector('.tip.on'))) return
    hover = t
    board.hover(t)
    tileTip(t)
  })
  stage.addEventListener('pointerleave', () => {
    if (press || drag) return
    hover = null
    board.hover(null)
    hideTip()
  })
  // A ctrl-click picks (a Mac's would open the menu).
  stage.addEventListener('contextmenu', (e) => e.preventDefault())
  // The keyboard: the board takes focus (Tab); the arrows move a cursor over its tiles (from the Monarch's),
  // Enter or Space clicks the tile under it, X swaps the selected soul with the one under it, Shift+Enter
  // picks. The tile's tooltip follows the cursor. The board's focus ring (.kb) shows only while the keyboard
  // has it: a click takes it away, even after a key pressed elsewhere.
  let cursor = null
  let keyed = false
  stage.tabIndex = 0
  const keys = (on) => { keyed = on; stage.classList.toggle('kb', on) }
  const point = (t) => { cursor = t; hover = t; board.focus(t); board.hover(t); tileTip(t); keys(true) }
  const home = () => deployTile('party', monarchOf(s).slot)
  stage.addEventListener('focus', () => { if (!keeping && !drag && !press && stage.matches(':focus-visible')) point(cursor ?? home()) })
  stage.addEventListener('blur', () => { if (keeping || cursor == null) return; board.focus(null); board.hover(null); hover = null; hideTip() })
  stage.addEventListener('keydown', (e) => {
    if (drag || e.metaKey || e.ctrlKey || e.altKey) return
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key]
    if (step && cursor == null) point(home())
    else if (step) {
      const [x, y] = [tileX(cursor) + step[0], tileY(cursor) + step[1]]
      if (x >= 0 && x < LANES && y >= 0 && y < DEPTH) point(tileAt(x, y))
    } else if ((e.key === 'Enter' || e.key === ' ') && cursor != null) clickTile(cursor, e)
    else if ((e.key === 'x' || e.key === 'X') && cursor != null) swapTile(cursor)
    else return
    e.preventDefault()
    e.stopPropagation()
  })
  stage.addEventListener('pointerdown', (e) => {
    swallow = false
    // The pointer takes over from the keyboard's cursor.
    if (cursor != null) { cursor = null; board.focus(null) }
    keys(false)
    if (e.button !== 0) return
    const t = board.tileAt(e.clientX, e.clientY)
    const slot = slotOfTile(t)
    const o = slot != null && aim == null && !picks(e) ? s.party.find((u) => u.slot === slot) : null
    begin(e, { tile: t, uid: o ? o.uid : null })
  })

  function pressBench (e, u) {
    swallow = false
    if (e.button !== 0 || aim != null || picks(e)) return
    begin(e, { uid: u.uid, bench: true })
  }

  function begin (e, p) {
    press = { x: e.clientX, y: e.clientY, e, ...p }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  function end () {
    press = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
  }

  // The screen changed under a press (a key, Begin): it is let go of, and nothing it would do is done.
  function release () {
    end()
    if (drag) cancelDrag(false)
    hover = null
  }

  function onMove (e) {
    if (!el.isConnected) return release()
    if (!press) return
    if (!drag && press.uid != null && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) lift(e)
    if (drag) over(e)
  }

  // A click on the board goes where the old cells' clicks went: a camp cell to clickSlot, any tile (theirs too)
  // to the square while a detachment aims; a benched soul's button clicks itself.
  function onUp (e) {
    if (!el.isConnected) return release()
    const p = press
    end()
    if (drag) return put(e)
    if (p && !p.bench) clickTile(p.tile, p.e)
  }

  function onCancel () {
    if (!el.isConnected) return release()
    end()
    if (drag) cancelDrag()
  }

  // X on the keyboard: the selected soul trades places with the one under the cursor (or moves to its cell).
  function swapTile (t) {
    const slot = slotOfTile(t)
    if (aim != null || slot == null || isWall(s.camp, slot)) return clickTile(t, null)
    if (!selected()) return refuse('Select a soul first (Enter), then press X over another to swap the two.')
    clickSlot(slot, null, true)
  }

  function clickTile (t, e) {
    if (t == null || t === 'reserve') return
    const slot = slotOfTile(t)
    if (slot == null || isWall(s.camp, slot)) return aim != null ? setSquare(t) : undefined
    clickSlot(slot, e)
  }

  function lift (e) {
    const u = soulOf(press.uid)
    drag = { uid: u.uid, at: undefined, target: null }
    if (press.bench) swallow = true
    hideTip()
    hover = null
    board.hover(null)
    stage.classList.add('dragging')
    document.body.classList.add('dragging')
    // Off the board (over the bench, the tray) the canvas is under the page: a picture of the soul carries it
    // there, at the board's size.
    const size = Math.round(Math.max(40, 92 * board.zoom()))
    drag.ghost = h('div', { class: 'drag-ghost', hidden: true, style: `--s:${size}px` }, portrait(u.id, size, u.hp <= 0))
    document.body.append(drag.ghost)
    board.lift(press.bench ? { id: u.id } : `s${u.uid}`, e.clientX, e.clientY)
  }

  // The drop under the pointer, and when it changes, what it would do (dragPreview) for the board to show.
  function over (e) {
    const hit = document.elementFromPoint(e.clientX, e.clientY)
    const benchEl = hit?.closest?.('.bench')
    const onto = benchEl ? hit.closest('[data-uid]')?.dataset.uid : undefined
    const t = benchEl ? null : board.tileAt(e.clientX, e.clientY)
    const at = benchEl ? `b${onto ?? ''}` : String(t)
    // Over the board (the stage, or what lies over it: the legend, the waves) the board's own sprite follows.
    const off = !hit?.closest?.('.stage-wrap')
    drag.ghost.hidden = !off
    drag.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
    let preview
    if (at !== drag.at) {
      drag.at = at
      drag.target = dropAt(soulOf(drag.uid), t, !!benchEl, onto != null ? soulOf(+onto) : null)
      preview = dragPreview(soulOf(drag.uid), drag.target)
      el.querySelector('.bench')?.classList.toggle('target', !!drag.target?.bench && drag.target.ok)
    }
    board.follow(e.clientX, e.clientY, preview, off)
  }

  // Where a drop would land: a camp cell (its slot), the bench or a benched soul on it, or nowhere (null); and
  // whether the rules take it (a refused one is still put down there, for its message).
  function dropAt (u, t, bench, onto) {
    if (bench) return { bench: true, onto, ok: !isMonarch(u) && (onto ? onto !== u && (u.slot >= 0) : u.slot >= 0) }
    const slot = slotOfTile(t)
    if (slot == null) return null
    if (isWall(s.camp, slot)) return { tile: t, slot, wall: true, ok: false }
    const o = s.party.find((x) => x.slot === slot)
    return { tile: t, slot, ok: !(o && isMonarch(o) && u.slot < 0) && !(!o && u.slot < 0 && full()) }
  }

  // What a drop would make of the board, read off a copy of the camp with the move made (the rules read, never
  // run): where the domain would centre (it moves with a dragged Monarch, and under Vanguard Crown with the
  // front), every tile whose soul or body would start the battle faltering, the Monarch's approach tiles and
  // which would be held, and the soul it would displace and where to (a tile, or null for the bench). A drop
  // the rules refuse, or off the camp, tells none of it: nothing would change.
  function dragPreview (u, target) {
    if (!target?.ok) return { tile: target?.tile ?? null, ok: false, centre: null, falter: null, approach: null, swap: null }
    const other = target.bench ? target.onto : s.party.find((x) => x.slot === target.slot && x !== u)
    const to = target.bench ? -1 : target.slot
    const party = s.party.map((x) => x === u ? { ...x, slot: to } : x === other ? { ...x, slot: u.slot } : x)
    const s2 = { ...s, party }
    const standing = souls(fielded(party)).filter((x) => x.hp > 0 && !isMonarch(x) && !isHeld(s2, x))
    const starters = [...standing, ...armyLayout(s2).members]
    const falter = starters.filter((x) => startsFaltering(s2, x)).map((x) => deployTile('party', x.slot))
    const held = new Set(starters.map((x) => deployTile('party', x.slot)))
    const walls = new Set(wallTiles(s.camp))
    const approach = neighbours(deployTile('party', monarchOf(s2).slot)).filter((t) => !walls.has(t) && tileY(t) <= CAMP_ROWS)
      .map((tile) => ({ tile, bare: !held.has(tile) }))
    const swap = other ? { key: other.slot >= 0 ? `s${other.uid}` : null, id: other.id, to: u.slot >= 0 ? deployTile('party', u.slot) : null } : null
    return { tile: target.tile ?? null, ok: true, centre: deployTile('party', domainCentre(s2)), falter, approach, swap }
  }

  // The drop: the dragged soul is selected and the click it stands for is made, so every refusal says the same.
  function put (e) {
    over(e)
    const { uid, target } = drag
    cancelDrag(false)
    const u = soulOf(uid)
    // A drop that does nothing (off the camp, back on its own tile or bench) clears an old message too.
    if (!target) { error = ''; return render() }
    sel = { uid }
    soft = false
    if (target.bench) {
      if (u.slot < 0) { sel = null; error = ''; return render() }
      return target.onto ? clickBench(target.onto, null, true) : clickBenchSpace()
    }
    if (target.wall) return refuse('A wall stands there: a soul stands on open ground.')
    if (target.slot === u.slot) { error = ''; return render() }
    clickSlot(target.slot, null, true)
  }

  function cancelDrag (redraw = true) {
    drag?.ghost.remove()
    drag = null
    stage.classList.remove('dragging')
    document.body.classList.remove('dragging')
    board.drop()
    if (redraw) render()
  }

  render()
  return {
    el,
    // Its screen is about to change (Begin): a press or a drag still held is let go of, doing nothing.
    release,
    // Put back on the page as it was (the map's Camp tab): the board is shown again.
    shown: render,
    key (e) {
      if (e.key !== 'Escape') return
      if (drag) { end(); return cancelDrag() }
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

// A soul's portrait in a frame of its rank's metal (Soldier bronze, Knight silver, Marshal gold; the Monarch
// its crown's gold), its insignia on the corner. The fallen stay readable: their living picture, greyed and
// dimmed (spoils.css), not the body on the ground.
function rankPort (u, size) {
  const d = unitDef(u.id)
  const grade = u.grade ?? 0
  return h('span', { class: 'rank-port ' + (d.monarch ? 'monarch' : `g${grade}`) + (u.hp <= 0 ? ' fallen' : ''), 'aria-label': d.monarch ? 'the Monarch' : GRADES[grade].name },
    portrait(u.id, size), h('span', { class: 'rp-ins' }, icon(d.monarch ? 'crown' : GRADE_ICON[grade], 11)))
}

function unitRow (run, u, extra = null) {
  const d = unitDef(u.id)
  return h('div', { class: 'unit' + (u.hp <= 0 ? ' fallen' : '') + (d.monarch ? ' monarch' : ''), tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run) }) },
    rankPort(u, 32),
    h('div', { class: 'grow' },
      h('div', null, h('b', null, d.name), !d.monarch || u.lvl > 0 ? ` Lv ${u.lvl}` : '', u.grade > 0 && h('span', { class: `rank-tag g${u.grade}` }, icon(GRADE_ICON[u.grade], 12), GRADES[u.grade].name),
        u.path && h('span', { class: 'path-tag' }, ` ${pathDef(u.id, u.path).name} ${ROMAN[u.tier - 1]}`), u.path2 && h('span', { class: 'path-tag p2' }, ` · ${pathDef(u.id, u.path2).name} ${ROMAN[u.tier2 - 1]}`),
        h('span', { class: 'dim' }, ` · ${d.monarch ? 'you' : `${KIN[d.kin].name} ${ROLES[d.role].name}`}${u.slot < 0 ? ' · bench' : ` · ${campRowLabel(rowOf(u.slot)).toLowerCase()}`}${u.cohort ? ` · leads ${bodies(u.cohort.kind, u.cohort.count)}` : ''}`)),
      h('div', { class: 'line' }, hpBar(u), h('span', { class: 'dim' }, u.hp > 0 ? `${u.hp}/${u.maxHp}` : 'fallen'))),
    extra)
}

// A soul's cell on the bench (the board draws the field's). A captain wears its banner's flag (its colour comes
// from the cell's --b) with its cohort's size, a Knight or Marshal its insignia, and its path tiers as pips (a
// second path's in violet). A soul in a detachment (`det`) wears its tag (the cell's --d): its id, ■ on Stay,
// → on Move; a held one's start sits at its top.
const WHERE_MARK = { hunt: '', stay: ' ■', move: ' →' }
function cellBody (u, det = null) {
  return [
    det && waits(det) && onField(u) && h('span', { class: 'start-tag', 'aria-label': `enters ${whenText(det.plan.when)}` }, whenTag(det.plan.when)),
    portrait(u.id, 46, u.hp <= 0),
    h('span', { class: 'badge' }, ` ${u.lvl}`),
    u.tier > 0 && h('span', { class: 'tier-pips', 'aria-label': `path tier ${u.tier}` }, '▴'.repeat(u.tier)),
    u.tier2 > 0 && h('span', { class: 'tier-pips p2', 'aria-label': `second path tier ${u.tier2}` }, '▴'.repeat(u.tier2)),
    u.grade > 0 && h('span', { class: `rank-mark g${u.grade}`, 'aria-label': GRADES[u.grade].name }, icon(GRADE_ICON[u.grade], 13)),
    u.cohort && h('span', { class: 'flag', 'aria-label': `leads ${u.cohort.count}` }, u.cohort.count),
    det && h('span', { class: 'det-tag', 'aria-label': `detachment ${det.id}, ${det.plan.where}` }, det.id, WHERE_MARK[det.plan.where]),
    u.maxHp && hpBar(u)]
}

// Why a cell is a bad seat for the Monarch: it never steps, and only a flanker walks through a body.
const sealText = (n) => `Here it seals ${n} cell${n === 1 ? '' : 's'} of the camp off from the fight: the Monarch never steps, and only a flanker walks through a body, so whoever stands behind it can never get out.`

// The line and the Monarch's approach, for the camp editor's legend (reDESIGN, what prep shows; the board
// draws both): how many rows the front-most row anyone starts on stands ahead of the Monarch and short of
// their formation's front, and how many of the tiles beside the Monarch are held at the start.
function lineKey (lineY, mTile, approach, bare) {
  const ahead = lineY === null ? null : lineY - tileY(mTile)
  const gap = lineY === null ? null : DEPTH - ROWS - lineY
  const rows = (n) => `${n} row${n === 1 ? '' : 's'}`
  const line = lineY === null ? 'No line: no one of yours starts on the board.'
    : ahead > 0 ? `Line: ${rows(ahead)} ahead of the Monarch, ${rows(gap)} short of their front.`
      : ahead === 0 ? `Line: level with the Monarch, ${rows(gap)} short of their front.`
        : `Line: the Monarch stands ${rows(-ahead)} ahead of it, ${rows(gap)} short of their front.`
  const lineTip = () => h('div', { class: 'syn-tip tile-tip' }, h('div', null, h('b', null, 'The line'), ' · the front-most row yours start on (dashed)'), h('div', { class: 'dim' }, line))
  const approachTip = () => h('div', { class: 'syn-tip tile-tip' }, h('div', null, h('b', null, `Approach ${approach.size - bare.length}/${approach.size} held`), ' · the open tiles beside the Monarch'),
    h('div', { class: bare.length ? 'warn' : 'dim' }, 'A foe on one can strike it; a soul or body there screens it.'))
  return [
    h('span', { class: 'bk', tip: lineTip }, h('i', { class: 'lk-line' }), lineY === null ? 'No line' : `Line ${ahead >= 0 ? '+' : '−'}${Math.abs(ahead)} · gap ${gap}`),
    h('span', { class: 'bk' + (bare.length ? ' bare' : ''), tip: approachTip }, h('i', { class: 'lk-ring' }), `Approach ${approach.size - bare.length}/${approach.size}`)]
}

// Scouted foes as units the cards and bonds can read: no uid yet, so the slot stands in for one (a member's
// cohortOf is already its captain's slot), and a member is rank-and-file of its captain's cohort.
const scouted = (foes) => foes.map((f) => ({ ...f, uid: f.slot, ...(f.cohortOf != null && { rank: true }) }))

// What a scouted foe's card says of its banner: a captain and the size of its cohort, or whose cohort a
// member is in. The rule, never the order a captain was given.
const bannerNote = (foes, u, led) => led.has(u.slot) ? ENEMY_TEXT.captain(led.get(u.slot), unitDef(u.id).boss)
  : u.cohortOf != null ? ENEMY_TEXT.of(foes.find((f) => f.slot === u.cohortOf).id) : null
// The same in a few words, for the card's live line.
const bannerLive = (foes, u, led) => {
  if (led.has(u.slot)) return unitDef(u.id).boss ? `Leads a court of ${led.get(u.slot)}` : `Captain of ${led.get(u.slot)}: kill it, they falter`
  const c = u.cohortOf != null && unitDef(foes.find((f) => f.slot === u.cohortOf).id)
  return c ? `Of ${c.name}'s ${c.boss ? 'court' : 'cohort'}` : null
}

// The foes' formation for the prep board, read-only: each foe as the board draws it (a captain with its
// cohort's size, a member a size smaller), and every tile of their side's tooltip, by board tile. Where they
// stand, never what they will do. `node`: the room faced, or null on the map (their ground stands empty).
// `dom` (domainOn) tells the cells the Monarch's domain reaches: their row r is camp row −2 − r on its grid.
// `ground` (the camp editor's): { tip(title, text, tile, inside), an empty tile's tooltip; notes(tile), its
// Move squares and the aim }.
function foeTiles (run, node, dom, ground) {
  const mods = node ? roomFoeMods(run, node) : []
  const foes = scouted(node?.foes ?? [])
  const led = cohortSizes(foes)
  const at = new Map(foes.map((f) => [f.slot, f]))
  const bonded = new Set(activeBonds(foes).map((b) => b.uid))
  const units = []
  const tips = new Map()
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const slot = slotAt(r, c)
      const u = at.get(slot)
      const tile = deployTile('foe', slot)
      const inside = !!dom?.inside(-2 - r, c)
      const where = `${FOE_ROW_LABEL[r].toLowerCase()} row, lane ${c + 1}`
      if (u) units.push({ key: `f${slot}`, id: u.id, tile, side: 'foe', rank: !!u.rank, hp: 1, maxHp: 1, lvl: u.lvl, count: led.get(u.slot) ?? 0, bonded: bonded.has(u.uid) })
      tips.set(tile, u ? () => unitCard(u, {
        mods: [...mods, ...bondMods(foes, u)], foe: true, ordered: node.type === 'elite' && (led.has(u.slot) || u.cohortOf != null),
        live: ground.notes(tile).at(-1) || bannerLive(foes, u, led) || `Enemy, ${FOE_ROW_LABEL[r].toLowerCase()} row`,
        notes: [`Enemy, ${FOE_ROW_LABEL[r].toLowerCase()} row. Stats include this floor's multipliers and their synergies.`, bannerNote(foes, u, led), ...bondNotes(foes, u), ...ground.notes(tile)]
      })
        : ground.tip(`Their ground, ${where}`, node ? 'Where their formation stands as the battle begins.' : 'Their formation stands here in a battle.', tile, inside))
    }
  }
  return { units, tips }
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
          tip: u ? () => unitCard(u, { mods, foe: true, ordered: node.type === 'elite' && (led.has(u.slot) || u.cohortOf != null), live: `${waveName(node, k)}: ${waveWhen(w).replace(/\.$/, '').toLowerCase()}`, notes: [`${waveName(node, k)}, in this lane. ${waveWhen(w)}`, 'Stats include this floor\'s multipliers only: its bonds and synergies come from where it enters and who still stands.', bannerNote(foes, u, led)] }) : null
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

// Relics and keystones as chips (a trigger relic marked with a spark); hover one for its rule.
function relicList (ids) {
  if (!ids.length) return h('p', { class: 'dim small' }, 'None yet: reliquaries and elites offer them.')
  return h('div', { class: 'relics' }, ids.map((id) =>
    h('span', { class: 'relic' + (relicDef(id).on ? ' trig' : ''), tip: () => relicTip(id) }, icon(relicIcon(id), 14), relicDef(id).name)))
}

function keystoneList (ids) {
  if (!ids.length) return h('p', { class: 'dim small' }, `None yet: elites and rites offer them from floor ${TUNING.keystone.fromFloor}.`)
  return h('div', { class: 'relics' }, ids.map((id) =>
    h('span', { class: 'relic keystone', tip: () => keystoneTip(id) }, icon('keystone', 14), keystoneDef(id).name)))
}
