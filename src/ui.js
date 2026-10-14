// The DOM side: the title, the run's screen (its Field, Map and Codex tabs), the spoils and the end, the playback
// bar and the panels beside the battle, and the parts they share. Screens only read run.state and report input
// upward; the Field sends its actions through act(action), which returns an error message or null. Every
// control has a tooltip saying exactly what it does (rules text lives in codex.js).
import { TUNING } from './tuning.js'
import {
  availableNodes, fieldCap, rosterCap, fielded, inOssuary, currentNode, souls, isMonarch, monarchOf,
  reapedShadows, essenceByWave, canDescend, depthOf, OSSUARY, canAdvance, tierCost, canPlace, canFuse,
  fuseCost, fuseParts, relicCount, levelOf, kindLevel, floorPrice, swapWith, releaseRefund,
  soulOffer, shopOffers, canBuy, eliteBonus, runStat, unheld, canHold, isRunRelic, heldKinds, foeEssence
} from './sim/run.js'
import { RANKS, WIDTH } from './sim/map.js'
import { unitDef, relicDef, KIN, ROLES, FUSION_LIST, RELIC_TIERS } from './content.js'
import {
  COLS, ROWS, CAMP_ROWS, slotAt, rowOf, isWall, LANES, DEPTH, tileAt, deployTile, wallTiles, onField, tileX, tileY,
  statsOf, tracksOf, canTrack, sizeOf, footprint, footprintSlots,
  campOpen, isMonarchCell, distanceBetween, summonsOf, reachOf, baseStats
} from './sim/unit.js'
import { field } from './sim/field.js'
import { h, fill, icon, portrait, prefs, showTip, hideTip, pinTip, hold, HOLD, touchy, say } from './dom.js'
import { kw } from './keywords.js'
import { sfx } from './sfx.js'
// The Field's board: the battle's own, drawn in Phaser (board.js), under a layer that takes the pointer.
import { board } from './board.js'
// The page is scaled whole (frame.js): what is placed over it by a viewport point goes into the frame's px.
import { frame, toLocal } from './frame.js'
import {
  unitCard, partyMods, roomTip, synergyTracker, synergyGroups, relicTip, ROOM, campRowLabel, realmOf,
  MONARCH_TEXT, MONARCH_RULE, deathText, tileText, fieldRule,
  DEEP_TEXT, ROMAN, relicsByTier, alsoOf, TRIGGER_TEXT, codexView, reachText, reachRule, standing, abilityBlocks,
  auraBlock, hpBar, hpAt, summonText, recruitWorth, relicIcon, relicKind, ariseFor, actText, theirText,
  monarchHpText, statTip, recruitSteps, tally, bestiaryCount
} from './codex.js'

// ── title ────────────────────────────────────────────────────────────────────────────────────────

export function titleScreen ({ seed, onStart, onHelp }) {
  const input = h('input', { value: seed, spellcheck: 'false', 'aria-label': 'seed' })
  const start = () => onStart(input.value.trim() || seed)
  // The four steps of a run, one line each in its system's colour; the terms explain themselves on hover.
  const step = (ico, sys, title, ...text) => h('div', { class: 'step', style: `--s:var(--c-${sys})` }, h('div', { class: 'step-ico' }, icon(ico, 26)), h('div', null, h('b', null, title), h('p', null, text)))
  const el = h('div', { class: 'screen title-screen' },
    h('div', { class: 'title-box' },
      h('div', { class: 'sigil' }, icon('soul', 50)),
      h('h1', { class: 'logo' }, 'RETINUE'),
      h('p', { class: 'tagline' }, 'You are the Monarch, a necromancer, and the dead fight for you.', h('br'), 'Descend four floors, unmake the Hollow Sovereign, then go on into the deep.'),
      h('div', { class: 'steps brief' },
        step('crown', 'monarch', 'Stand', 'You never strike. The foes come down the ', kw('road', 'roads'), ' to you, and choose when to come in.'),
        step('fight', 'foe', 'Scout', say('Hover', 'Tap'), ' a room to see its foes. What they do, you learn by fighting.'),
        step('start', 'plan', 'Command', 'Place your souls, then fight turn by turn: each piece moves, then strikes. What you leave alone strikes anyway.'),
        step('soul', 'essence', 'Reap', 'The slain pay ', kw('essence'), ', and one of them joins you.')),
      h('div', { class: 'title-actions' },
        h('button', { class: 'primary big', onclick: start, tip: () => 'Start a new run with this seed. (Enter)' }, 'Begin the descent ', h('kbd', null, 'Enter')),
        h('button', { class: 'ghost', onclick: onHelp, tip: () => 'Rules, the board, fusions and the foes met. (H)' }, icon('help', 22), ' How to play'),
        h('label', { class: 'seed', tip: () => 'The same seed always makes the same maps, foes and battles. Share one to play the same run.' }, 'seed', input))),
    cornerButtons(onHelp))
  return { el, key: (e) => { if (e.key === 'Enter') start() } }
}

// Sound and How to play in the top corner of a screen with no top bar (the title, the end): a finger has no M
// or H key.
function cornerButtons (onHelp) {
  return h('div', { class: 'corner-btns' }, muteButton(), helpButton(onHelp))
}
const helpButton = (onHelp) => h('button', { class: 'icon-btn', 'aria-label': 'How to play', onclick: onHelp, tip: () => 'How to play (H)' }, icon('help', 22))

// ── shared chrome ────────────────────────────────────────────────────────────────────────────────

// The run as a row of icons (the Slay the Spire bar): the floors, the purse, the Monarch's HP, your souls, a
// tile per relic held in its tier's colour, a count on it for copies (hover one for what it does), then sound and
// help. The bar is rebuilt on every change: `drawn` keeps what it last showed, so a changed purse rolls to its new
// value and flashes, and a relic just taken (a copy more too) pops in.
const drawn = { run: null, essence: 0, hp: 0, souls: 0, held: {} }
// The copies held of each relic: { id: n }, in the order first taken.
const heldCounts = (s) => Object.fromEntries([...new Set(s.relics)].map((id) => [id, relicCount(s, id)]))

// `tabs`: the run's tabs (runScreen), folded into the bar as compact icons, so the board keeps the screen's width.
function topbar (run, onHelp, tabs = null) {
  const s = run.state
  const fresh = drawn.run !== run
  const n = souls(s.party).length
  if (fresh) Object.assign(drawn, { run, essence: s.essence, hp: monarchOf(s).hp, souls: n, held: heldCounts(s) })
  const purse = h('b', null, Math.round(drawn.essence))
  const chip = h('span', { class: 'chip-stat essence', tip: () => essenceTip(run) }, icon('soul', 20), purse)
  if (drawn.purse) cancelAnimationFrame(drawn.purse.rolling)
  drawn.purse = purse
  roll(purse, drawn.essence, s.essence, chip, (v) => { drawn.essence = v })
  // Your souls, the field's and the ossuary's, of the most you may hold.
  const count = h('b', null, Math.round(drawn.souls))
  const kept = h('span', {
    class: 'chip-stat souls',
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, `Souls ${n}/${rosterCap(run)}`),
      h('p', null, ossuaryCount(run)))
  }, icon('hood', 20), count, h('span', { class: 'of' }, `/${rosterCap(run)}`))
  if (drawn.count) cancelAnimationFrame(drawn.count.rolling)
  drawn.count = count
  roll(count, drawn.souls, n, kept, (v) => { drawn.souls = v })
  const held = drawn.held
  const counts = drawn.held = heldCounts(s)
  // A relic's tile wears its own glyph in its tier's colour; the Legendaries share one, told apart by a letter pair.
  // A copy more shows as ×N in the top corner.
  const tile = (id) => {
    const r = relicDef(id)
    const n = counts[id]
    return h('span', {
      class: `trinket rt-${r.tier}` + (r.on ? ' trig' : '') + ((held[id] ?? 0) < n ? ' new' : ''), 'data-id': id, tabindex: '0',
      'aria-label': n > 1 ? `${r.name} ×${n}` : r.name, tip: () => relicTip(id, run)
    }, icon(relicIcon(id), 22), r.tier === 'legendary' && h('i', { class: 'badge' }, letterPair(r.name)), n > 1 && h('i', { class: 'count' }, `×${n}`))
  }
  const t = Object.keys(counts).length
  return h('header', { class: 'topbar' },
    floorPips(s),
    h('div', { class: 'chips' }, chip, monarchChip(run), kept),
    tabs,
    // A column a tile, all but the last free to narrow (feel.css .trinkets).
    t > 0 && h('div', { class: 'trinkets', style: `grid-template-columns: ${t > 1 ? `repeat(${t - 1}, minmax(0, var(--tap))) ` : ''}var(--tap)` },
      Object.keys(counts).map(tile)),
    h('div', { class: 'top-btns' }, muteButton(), helpButton(onHelp)))
}

// Your souls by where they are: "4/5 on the field, 2 in the ossuary (1 fallen)".
function ossuaryCount (run) {
  const all = souls(run.state.party)
  const kept = inOssuary(all)
  const fallen = kept.filter((u) => u.hp <= 0).length
  return `${fielded(all).length}/${fieldCap(run)} on the field, ${kept.length} in the ossuary${fallen ? ` (${fallen} fallen)` : ''}.`
}

// The purse's tooltip: the essence held, earned and spent this run, the floor's prices against floor 1's (run.js
// floorPrice), the cheapest tier a kind you hold may take now, and what a slain foe pays.
function essenceTip (run) {
  const s = run.state
  const scale = floorPrice(s.floor)
  const next = heldKinds(s).flatMap((id) => [0, 1].filter((t) => canAdvance(s, id, t)).map((t) => ({ id, t, cost: tierCost(run, id, t) })))
    .sort((a, b) => a.cost - b.cost)[0]
  return h('div', { class: 'syn-tip' }, h('b', null, `${s.essence} essence`),
    h('p', null, `${s.stats.essence} earned, ${s.stats.spent} spent this run · ${scale === 1 ? 'floor 1 prices' : `prices ×${+scale.toFixed(2)} floor 1's`}.`),
    next && h('p', null, `Cheapest tier now: ${unitDef(next.id).name}, ${tracksOf(next.id)[next.t].name} ${ROMAN[s.kinds[next.id].tracks[next.t]]}, for ${next.cost}${next.cost > s.essence ? ` (${next.cost - s.essence} short)` : ''}.`),
    h('p', { class: 'dim' }, `A slain foe pays ${TUNING.essence.perTier} × its tier.`))
}

// A Legendary's tag, its words' initials ("Court of Bone" CB), small words skipped.
const letterPair = (name) => name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('').slice(0, 2)

// Counts `el` from `from` to `to` (rounded as it goes), then flashes `host` (green for a gain, red for a
// loss); onStep sees every value drawn, so a re-render mid-roll carries on from where it got to. Reduced
// motion: it jumps, and still flashes.
function roll (el, from, to, host = el, onStep = null) {
  cancelAnimationFrame(el.rolling)
  if (from === to) { el.textContent = Math.round(to); onStep?.(to); return }
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!still) holdWidth(el, from, to)
  host.classList.remove('gain', 'spend')
  void host.offsetWidth
  host.classList.add(to > from ? 'gain' : 'spend')
  const ms = still ? 0 : Math.min(700, 260 + Math.abs(to - from) * 6)
  const t0 = performance.now()
  const step = (now) => {
    const f = ms ? Math.min(1, (now - t0) / ms) : 1
    const v = from + (to - from) * (1 - (1 - f) ** 3)
    el.textContent = Math.round(f >= 1 ? to : v)
    onStep?.(f >= 1 ? to : v)
    if (f < 1) el.rolling = requestAnimationFrame(step)
    else Object.assign(el.style, { minWidth: '', display: '', textAlign: '' })
  }
  el.rolling = requestAnimationFrame(step)
}

// The display face's digits are not all one width (Fredoka has no tabular figures), so while a number rolls its box
// is held as wide as that many of its widest digit, right-aligned, and the bar beside it never jitters; it lets go
// once the number lands.
function holdWidth (el, from, to) {
  const n = Math.max(String(Math.round(from)).length, String(Math.round(to)).length)
  const text = el.textContent
  Object.assign(el.style, { minWidth: '', display: 'inline-block', textAlign: 'right' })
  let w = 0
  for (let d = 0; d < 10; d++) { el.textContent = String(d).repeat(n); w = Math.max(w, el.offsetWidth) }
  el.textContent = text
  el.style.minWidth = `${w}px`
}

// The speaker: sound on or off (M), remembered between visits. It draws both icons; <html data-muted>
// (set by sfx) shows the one that holds.
function muteButton () {
  return h('button', {
    class: 'icon-btn mute-btn',
    'data-sfx': 'none',
    'aria-label': 'Sound on or off',
    onclick: () => { if (!sfx.toggle()) sfx.play('click') },
    tip: () => 'Sound on or off. (M)'
  }, icon('sound', 22), icon('mute', 22))
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

// The Monarch's HP, always in view: if it falls, the run ends. A wound or a heal since the bar was last drawn
// flashes it (see topbar's `drawn`).
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
      live: monarchHpText(run),
      notes: [MONARCH_TEXT.hp.rule(run)[0]]
    })
  }, icon('crown', 20), h('b', null, `${m.hp}/${m.maxHp}`))
}

// The Field's gestures, taught one at a time in a slim pill atop the panel (never over the board), on every frame,
// each until it has been done once (remembered in this browser): select, then place a soul, then fuse.
const done = (k) => prefs.get('did:' + k) === '1'
const learnt = (k) => { if (!done(k)) prefs.set('did:' + k, '1') }

// ── the run's screen: Field · Map · Codex ───────────────────────────────────────────────────────

// The run between battles, one screen with its three tabs folded into the top bar (DESIGN §4), one view at a time:
// the Field (the board, as large as the screen holds, and one slim panel beside it: the selected piece's card, the
// ossuary at its foot like a Bloons TD shop), the Map (the floor's rooms: scout them, and walk to the next; a battle
// room's battle starts as it is entered) and the Codex (the rules, the words, the foes met). The Map opens first.
// Each tab's tooltip leads with its counts (`now`).
const TABS = [
  { id: 'field', name: 'Field', ico: 'field', key: 'F', desc: 'The board: place your souls and read the roads.', now: ossuaryCount },
  { id: 'map', name: 'Map', ico: 'map', key: 'R', desc: 'The floor: scout its rooms.',
    now: (run) => { const n = availableNodes(run).length; return `Floor ${run.state.floor}: ${n} room${n === 1 ? '' : 's'} open to you next.` } },
  { id: 'codex', name: 'Codex', ico: 'codex', key: 'C', desc: 'The rules, the words and the foes you have met.',
    now: () => { const b = bestiaryCount(); return `${b.met} of ${b.of} foe kinds met.` } }]

// trail: node ids visited on this floor, in order (starts with the start node). onNode: walk to a room.
export function runScreen ({ run, act, trail, note = '', onNode, onHelp }) {
  const bar = h('div', { class: 'bar-slot' })
  const tabsEl = h('nav', { class: 'top-tabs', role: 'tablist', 'aria-label': 'Views' })
  const refresh = () => fill(bar, topbar(run, onHelp, tabsEl))
  const editor = fieldEditor({ run, act, onChange: refresh })
  refresh()

  const body = h('div', { class: 'run-body' })
  // The note (what just happened) floats over the foot of the view: a tap dismisses it, and it fades by itself.
  const toast = note && h('div', { class: 'note', role: 'status', onclick: (e) => e.currentTarget.remove() }, note)
  const reach = availableNodes(run)
  let tab = null
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
        : h('section', { class: 'panel codex-panel' }, codexView(run)))
    if (id === 'field') editor.shown()
  }
  show('map')
  const el = h('div', { class: 'screen fit run-screen' }, bar, body, toast)
  return {
    el,
    key (e) {
      const n = reach[Number(e.key) - 1]
      if (n) { editor.release(); onNode(n.id) } else if (e.key === 'f' || e.key === 'F') show('field')
      else if (e.key === 'r' || e.key === 'R') show('map')
      else if (e.key === 'c' || e.key === 'C') show('codex')
      else if (tab === 'field') editor.key(e)
    }
  }
}

export const NODE = Object.fromEntries(Object.entries(ROOM).map(([k, v]) => [k, { name: k === 'boss' ? 'Boss' : v.name }]))

// ── the map ──────────────────────────────────────────────────────────────────────────────────────

// The whole floor at once, left to right: its ranks across (the start on the left, the elite or the boss on the
// right), its lanes down. Places are in % of the floor's box (style.css .dag), so the floor fits any frame.
const pos = (n) => ({ x: n.rank / (RANKS - 1) * 100, y: n.lane / (WIDTH - 1) * 100 })

// A mouse's click enters a glowing room. By touch a tap scouts, since entering is for good: a glowing room's first
// tap chooses it, its tooltip pinned with Enter ▸, and a second tap on it (or Enter ▸) enters; a tap anywhere else
// lets it go.
function mapView ({ run, trail, onNode }) {
  const s = run.state
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
    pinTip(el, () => [roomTip(run, n, { reachable: ok, enter: ok }),
      ok && h('button', { class: 'primary small tip-act', onclick: () => onNode(n.id) }, 'Enter ▸')], {
      keep: true,
      onHide: () => { el.classList.remove('chosen'); if (chosen === el) chosen = null }
    })
  }
  const nodes = s.map.nodes.map((n) => {
    const p = pos(n)
    const ok = reachIds.has(n.id)
    const key = ok ? reach.findIndex((x) => x.id === n.id) + 1 : null
    return h('button', {
      class: `node t-${n.type}` + (ok ? ' reach' : '') + (trail.includes(n.id) ? ' visited' : '') + (n.id === s.at ? ' here' : '') + (!ok && !trail.includes(n.id) ? ' far' : ''),
      style: `left:${p.x}%;top:${p.y}%`,
      'aria-disabled': ok ? null : 'true',
      'aria-label': NODE[n.type].name,
      tip: () => roomTip(run, n, { reachable: ok }),
      onclick: (e) => {
        if (!touchy()) { if (ok) onNode(n.id); return }
        if (ok && chosen === e.currentTarget) return onNode(n.id)
        scout(e.currentTarget, n, ok)
      }
    }, h('span', { class: 'medal' }, icon(n.type, 24)), h('span', { class: 'node-name' }, NODE[n.type].name), key && h('kbd', null, key))
  })
  return h('section', { class: 'panel mapcol', 'aria-label': 'The floor' },
    h('div', { class: 'map-head' }, h('h2', null, `Floor ${s.floor}`),
      h('span', { class: 'dim' }, say('Click a glowing room to enter it (or its number); hover any to scout it.', 'Tap a glowing room twice to enter it; tap any to scout it.'))),
    h('div', { class: 'dag-wrap' }, h('div', { class: 'dag' }, svg, nodes)))
}

// ── the Field ────────────────────────────────────────────────────────────────────────────────────

// The camp and the ossuary under it, the board's plan laid over it (board.js), and beside them the panel of
// the selected piece: a soul's, or with nothing selected the Monarch's. onChange runs after every action it sends.
//
// The gestures (DESIGN §4), the same by mouse and by touch, none needing hover, Shift or a key:
//   tap a piece            select it (its panel); tap it again, or empty ground, and the Monarch's
//                          panel is back (Escape too)
//   drag a piece           move it onto open ground (a 2×2 shows its four cells under the finger, red where
//                          they do not fit), onto another piece (they swap: a footprint over one piece, never
//                          two, nor the Monarch's seat), or onto the bench to keep it in the ossuary; the
//                          Monarch never moves
//   drag a soul from the bench  place it; tap it, then an open camp tile, places it too
//   tap a relic in the Relics strip, then a soul (on the board, in the ossuary, or its panel's slot)
//                          give it (redesign.md §2.15); a soul holding one swaps; its panel's Take back returns it
//   long press (touch)     the card of whatever is there, pinned

function fieldEditor ({ run, act, onChange = null }) {
  const s = run.state
  const el = h('div', { class: 'retinue' })
  // The selection: { uid } a soul of yours or the Monarch (on the field or in the ossuary), or null: the Monarch's
  // panel.
  let sel = null
  let error = ''
  // A synergy whose chip was pressed: its pieces glow bright (synergyTracker's focus), until pressed again.
  let focusSyn = null
  // A piece relic tapped in the Relics strip, waiting for the soul to give it to (null: none).
  let giving = null
  const stage = h('div', { class: 'board-stage', 'aria-label': 'The board. Tap a piece to select it; drag a piece to move it. Keys: the arrows move a cursor, Enter taps, Escape lets go.' })
  const hintEl = h('div', { class: 'board-hint', role: 'status' })
  const stageWrap = h('div', { class: 'stage-wrap' }, stage)
  const benchEl = h('div', { class: 'bench-strip' })
  const relicEl = h('div', { class: 'relic-strip' })
  const panelBody = h('div', { class: 'tab-body' })
  const errEl = h('p', { class: 'warn panel-err' })
  const panelEl = h('div', { class: 'tray' }, errEl, panelBody)
  const sideEl = h('div', { class: 'side-col' }, hintEl, panelEl, benchEl, relicEl)
  el.append(stageWrap, sideEl)
  let shown = ''
  // The board's tooltips, by tile; the tile under the pointer; a press, which turns into a drag past a few pixels;
  // the drag (a piece moved); a bench soul's click to swallow after it was dragged.
  let tips = new Map()
  let hover = null
  let press = null
  let drag = null
  let swallow = false
  let keeping = false

  const soulOf = (uid) => s.party.find((u) => u.uid === uid)
  const selected = () => sel?.uid != null ? soulOf(sel.uid) ?? null : null
  // A fielded piece's board tiles (its footprint: four for a 2×2), and the piece whose footprint covers tile t.
  const cellsOf = (u) => footprint(deployTile('party', u.slot), sizeOf(u)) ?? [deployTile('party', u.slot)]
  const pieceAt = (t) => typeof t === 'number' ? fielded(s.party).find((u) => cellsOf(u).includes(t)) ?? null : null
  // A fielded piece's camp cells (its footprint's slots); the fielded piece but `except` whose footprint covers camp
  // cell `slot`; and the camp cells the fielded pieces but `except` hold.
  const slotsOf = (x) => footprintSlots(x.slot, sizeOf(x)) ?? [x.slot]
  const coverAt = (slot, except = null) => fielded(s.party).find((x) => x !== except && slotsOf(x).includes(slot)) ?? null
  const heldBut = (...except) => new Set(fielded(s.party).filter((x) => !except.includes(x)).flatMap(slotsOf))
  // The camp slot of a board tile, or null past the camp.
  const slotOfTile = (t) => typeof t === 'number' && tileY(t) < CAMP_ROWS ? slotAt(CAMP_ROWS - 1 - tileY(t), tileX(t)) : null
  const full = () => fielded(souls(s.party)).length >= fieldCap(run)
  const fullText = (u) => `The field is full (${fieldCap(run)} pieces): drop ${unitDef(u.id).name} onto one of yours to swap them, put one in the ossuary first, or take a Command relic.`

  // Every action keeps the selection but a move's: a purchase leaves it where it is.
  function send (action) {
    error = act(action) ?? ''
    render()
    onChange?.()
    return !error
  }
  function refuse (why) {
    error = why
    sfx.play('poor')
    render()
  }
  // By touch a purchase (a tier, a fusion) is read before it is made, as a Shop's card is (redesign.md §4: a second
  // tap commits): the first tap pins its text with `label` under it, and a second tap on it, or that button, makes
  // it. A click makes it at once: its hover read it. `ok()`: whether the button is offered (it can be paid for).
  let reading = null
  function twice (e, tip, label, ok, go) {
    const el = e.currentTarget
    if (!touchy() || reading === el) { reading = null; return go(e) }
    reading = el
    el.classList.add('chosen')
    pinTip(el, () => [tip(), ok() && h('button', { class: 'primary small tip-act', onclick: () => { hideTip(); reading = null; go(e) } }, label)], {
      keep: true,
      onHide: () => { el.classList.remove('chosen'); if (reading === el) reading = null }
    })
  }
  function select (next) {
    sel = next
    error = ''
    if (next) learnt('select')
    render()
  }

  // The gesture to learn next, if one is left (the hints: see learnt), in a few words for the pill atop the panel; while
  // a relic waits to be given, what to tap.
  function hint () {
    const p = selected()
    const tap = say('Click', 'Tap')
    if (giving) return [h('b', null, tap), ' a soul to give it ', h('b', { class: `c-${relicDef(giving).tier}` }, relicDef(giving).name), ' · again to cancel']
    if (!done('select')) return [h('b', null, tap), ' a piece to select it · ', h('b', null, 'drag'), ' one to move it']
    if (!done('place') && inOssuary(souls(s.party)).some((u) => u.hp > 0) && !full()) return [h('b', null, 'Drag'), ' a soul from the ossuary onto the camp to field it']
    const ready = !done('fuse') && FUSION_LIST.find((f) => canFuse(run, f.id))
    if (ready && !(p && Object.hasOwn(ready.needs, p.id))) return [h('b', null, ready.name), ' can be made: ', tap.toLowerCase(), ' one of its parts, then ', h('b', null, 'Fuse')]
    return null
  }

  // ── the picture ──

  // The selected soul's reach round its footprint, as its card tells it (codex.js reachText, unit.js reachOf: the
  // furthest its blows reach, its tiers' too); the battle draws the same round a selected piece. None for the
  // Monarch, which never strikes, for a soul in the ossuary, or while a piece is moved.
  function reachNow (picked) {
    const r = picked && !drag && onField(picked) && !isMonarch(picked) && picked.hp > 0 ? reachOf(picked) : 0
    return r > 0 ? { centre: deployTile('party', picked.slot), size: sizeOf(picked), r } : null
  }

  // Arise's reach (redesign.md §2.15), round the soul holding an Arise relic where it starts the battle: the selected
  // one if it holds one, else the first fielded holder. Null with none fielded.
  function domainNow (picked) {
    const holder = [picked, ...fielded(souls(s.party))].find((u) => u && onField(u) && u.hp > 0 && ariseFor(s, u))
    return holder ? { centre: deployTile('party', holder.slot), size: sizeOf(holder), r: ariseFor(s, holder).domain } : null
  }

  function render () {
    // A Release armed on one soul is let go of once another is selected.
    if (arming != null && selected()?.uid !== arming) arming = null
    const fieldNow = fielded(s.party)
    const m = monarchOf(s)
    const mTile = deployTile('party', m.slot)
    const walls = wallTiles(s.camp)
    const groups = synergyGroups(souls(standing(run)), alsoOf)
    const picked = selected()
    if (sel && !picked) sel = null
    // Who glows bright: the selected piece's partners in every synergy it counts toward, or a pressed chip's.
    const lit = new Set(groups.filter((g) => (focusSyn ? g.key === focusSyn : picked && g.uids.has(picked.uid))).flatMap((g) => [...g.uids]))
    const units = []
    tips = new Map()
    const roads = field({ root: mTile, walls })
    // A soul of a kind that flies hovers, as in battle.
    for (const u of fieldNow) {
      const tile = deployTile('party', u.slot)
      units.push({
        key: `s${u.uid}`, id: u.id, tile, size: sizeOf(u), side: 'party', hp: u.hp, maxHp: u.maxHp, lvl: u.lvl, tracks: u.tracks, relics: u.relics ?? [], monarch: isMonarch(u),
        fallen: u.hp <= 0, sel: sel?.uid === u.uid, glow: groups.filter((g) => g.uids.has(u.uid)).map((g) => g.colour), lit: lit.has(u.uid),
        offer: !!giving && canHold(s, giving, u), flies: !!unitDef(u.id).flies
      })
      for (const t of cellsOf(u)) tips.set(t, () => pieceTip(u))
    }
    // Empty ground: what it is, whether Arise reaches it (only while a holder stands on the field: without one it
    // does nothing, and is not drawn or told), and how far its road runs to the Monarch.
    const dom = domainNow(picked)
    for (let t = 0; t < LANES * DEPTH; t++) {
      if (tips.has(t)) continue
      const wall = walls.includes(t)
      const d = roads.dist[t]
      tips.set(t, () => h('div', { class: 'syn-tip tile-tip' },
        h('div', null, h('b', null, wall ? 'Wall' : sentence(tileText(t))), dom && [' · ', distanceBetween(dom.centre, dom.size, t, 1) <= dom.r ? 'within Arise\'s reach' : h('span', { class: 'dim' }, 'beyond Arise\'s reach')]),
        h('div', { class: 'dim' }, wall ? 'It blocks walking, not shots: the roads bend round it.'
          : Number.isFinite(d) ? `Its road runs ${d} step${d === 1 ? '' : 's'} to the Monarch.` : 'No road runs from here.')))
    }
    const moving = drag ? soulOf(drag.uid) : null
    const picture = {
      walls, units, domain: dom, reach: reachNow(picked), roads: roads.arrow, seat: mTile,
      drop: dropTiles(moving), dropSize: moving ? sizeOf(moving) : 1, selKey: picked && onField(picked) ? `s${picked.uid}` : null
    }
    stage.className = 'board-stage' + (drag ? ' dragging' : '') + (keyed ? ' kb' : '')
    const teach = hint()
    fill(hintEl, teach)
    hintEl.hidden = !teach || !!drag
    fill(benchEl, benchStrip())
    fill(relicEl, relicStrip())
    relicEl.hidden = !unheld(s).length
    keeping = document.activeElement === stage
    if (keeping && stage.isConnected) stage.focus({ preventScroll: true })
    keeping = false
    errEl.textContent = error
    errEl.hidden = !error
    const now = picked ? `s${picked.uid}` : 'monarch'
    fill(panelBody, picked && !isMonarch(picked) ? soulPanel(picked) : monarchPanel())
    if (now !== shown) panelBody.scrollTop = 0
    shown = now
    board.show(stage, picture)
    if (hover != null && !drag && tips.has(hover)) tileTip(hover)
  }

  // ── the bench ──

  // Under the board: your souls in the ossuary, each a cell to drag onto the camp (or tap, then tap an open
  // tile), a fallen one marked so where its HP bar would be (it waits for an altar); a piece dropped on the strip
  // goes to the ossuary. How many it keeps, and the field's, at its head.
  function benchStrip () {
    const bench = inOssuary(s.party)
    const moving = drag ? soulOf(drag.uid) : null
    const target = moving && onField(moving) && !isMonarch(moving)
    return [
      h('div', {
        class: 'bench-label',
        tip: () => {
          const kept = inOssuary(souls(s.party))
          const fallen = kept.filter((u) => u.hp <= 0).map((u) => unitDef(u.id).name)
          return h('div', { class: 'syn-tip' },
            h('b', null, `Ossuary · ${kept.length ? `${kept.length} kept: ${kept.length - fallen.length} ready${fallen.length ? `, ${fallen.length} fallen (${tally(fallen)})` : ''}` : 'empty'}`),
            h('p', null, `Field ${fielded(souls(s.party)).length}/${fieldCap(run)}, ${fieldRule(run)} · souls ${souls(s.party).length}/${rosterCap(run)}.`),
            h('p', { class: 'dim' }, 'Drag a soul from here onto the camp, or a piece from the camp onto here.'))
        }
      }, h('b', null, 'Ossuary'), h('span', { class: 'dim' }, `${bench.length ? `${bench.length} kept` : 'empty'} · field ${fielded(souls(s.party)).length}/${fieldCap(run)}`)),
      (bench.length || target) && h('div', { class: 'bench' + (target ? ' target' : '') + (drag?.target?.bench && drag.target.ok ? ' over' : '') },
        bench.length
          ? bench.map((u) => h('button', {
            class: 'cell has' + (sel?.uid === u.uid ? ' sel' : '') + (u.hp <= 0 ? ' fallen' : '') + (giving && canHold(s, giving, u) ? ' offer' : ''),
            'data-uid': u.uid,
            onpointerdown: (e) => pressBench(e, u),
            onclick: () => { if (swallow) { swallow = false; return } if (giving) return give(u); select(sel?.uid === u.uid ? null : { uid: u.uid }) },
            tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run), run, live: benchLead(u), notes: [u.hp > 0 && !full() && 'Drag it onto an open tile of the camp to field it.'] })
          }, portrait(u.id, 46, u.hp <= 0), u.maxHp && u.hp > 0 && hpBar(u.hp, u.maxHp), relicMark(u)))
          : h('span', { class: 'dim empty-bench' }, 'Drop it here to keep it in the ossuary.'))]
  }

  // A soul in the ossuary, its card's lead: whether the field has room for it, or that it lies fallen.
  function benchLead (u) {
    const f = `${fielded(souls(s.party)).length}/${fieldCap(run)}`
    return u.hp <= 0 ? `Fallen: an altar raises it at ${Math.round(TUNING.run.altarRevive * 100)}% HP`
      : full() ? `In the ossuary · field ${f}, full: drop it on a piece to swap` : `In the ossuary · field ${f}: room for it`
  }

  // ── relics ──

  // Beside the ossuary (redesign.md §2.15): the piece relics bought and held by no soul, a button each (a copy more a
  // ×N). A tap readies one to give, and the souls that may take it light up; a soul tapped then (on the board, in the
  // ossuary, or its panel's slot) takes it. Hidden while none waits.
  function relicStrip () {
    return relicChips(run, giving, (id) => { giving = giving === id ? null : id; error = ''; sfx.play('select'); render() })
  }

  // The relic readied (giving) goes to soul `u`, swapping out what it holds; refused in words where it cannot.
  function give (u, relic = giving) {
    if (!relic) return
    if (!u || isMonarch(u)) return refuse('The Monarch holds no relic: give it to a soul.')
    if (!canHold(s, relic, u)) return refuse(`${unitDef(u.id).name} already holds ${relicDef(relic).name}.`)
    giving = null
    if (send({ type: 'hold', relic, uid: u.uid })) sfx.play('buy')
  }

  // A soul's relic slot in its panel: the relic it holds (its rule on hover) and Take back; and the unheld piece
  // relics, each a button that gives it here (or swaps), the one readied in the strip lit.
  function relicSection (u) {
    const held = u.relics ?? []
    const full = held.length >= TUNING.relic.perPiece
    const ids = [...new Set(unheld(s))].filter((id) => canHold(s, id, u))
    return h('div', { class: 'uc-relic' },
      h('div', { class: 'uc-sec' }, kw('relic', 'Relic'), h('span', { class: 'dim' }, ` · ${held.length}/${TUNING.relic.perPiece}`)),
      h('div', { class: 'rs-row' },
        held.map((id) => [h('span', { class: `rs-relic rt-${relicDef(id).tier}`, tip: () => relicTip(id, run) }, icon(relicIcon(id), 18), relicDef(id).name),
          h('button', { class: 'ghost small', onclick: () => send({ type: 'unhold', uid: u.uid, relic: id }), tip: () => `Take ${relicDef(id).name} back: it waits unheld, to give again.` }, 'Take back')]),
        !full && h('span', { class: 'rs-empty dim' }, ids.length ? '◇ Empty: give it one' : '◇ Empty: buy a piece relic in a Shop')),
      ids.length > 0 && h('div', { class: 'rs-give' }, ids.map((id) => h('button', {
        class: `give-relic small rt-${relicDef(id).tier}` + (giving === id ? ' on' : ''),
        onclick: () => give(u, id),
        tip: () => h('div', null, relicTip(id, run), h('p', { class: 'dim' }, full ? `Swap it for ${held.map((x) => relicDef(x).name).join(', ')}, which waits unheld.` : `Give it to ${unitDef(u.id).name}.`))
      }, icon(relicIcon(id), 16), full ? `Swap: ${relicDef(id).name}` : relicDef(id).name))))
  }

  // ── the panels ──

  // A refused press shakes its button.
  function shake (e) {
    const t = e?.currentTarget
    if (!t?.classList) return
    t.classList.remove('shake')
    void t.offsetWidth
    t.classList.add('shake')
  }

  // A piece's head: its picture (its full card on hover), name, level, kin and role, and its stats as it fights
  // now, its HP at them.
  function pieceHead (u, mods) {
    const d = unitDef(u.id)
    const st = statsOf(u, mods)
    const [hp, maxHp] = hpAt(u, st)
    // Each stat's hover breaks it down (codex.js statTip): its kind's at its level, each tier and relic, what it means.
    const stat = (ico, v) => h('span', { class: 'uc-stat s-' + ico, tip: () => statTip(run, u, ico) }, icon(ico, 18), h('b', null, v))
    return [h('div', { class: 'uc-head' },
      h('div', { class: 'uc-art', tip: () => unitCard(u, { mods, realm: realmOf(run), run }) }, portrait(u.id, 56, u.hp <= 0), relicMark(u)),
      h('div', { class: 'uc-id' },
        h('div', { class: 'uc-name' }, d.name),
        h('div', { class: 'uc-sub dim' }, `Lv ${u.lvl} · ${d.kin ? `${KIN[d.kin].name} ` : ''}${ROLES[d.role].name}`))),
    h('div', { class: 'uc-stats' },
      stat('hp', hp < maxHp ? `${hp}/${maxHp}` : maxHp),
      stat('atk', Math.round(st.atk)), stat('def', Math.round(st.def)), stat('move', Math.round(st.move))),
    h('div', { class: 'uc-reach', tip: () => reachRule(u) }, icon('reach', 18), h('span', null, reachText(u)))]
  }

  // Its abilities and its aura, each a line (the card's).
  const abilities = (u, st) => h('div', { class: 'uc-abs' }, abilityBlocks(u, st, realmOf(run)), auraBlock(u))

  // A soul's panel: its head; its relic slot; the summons its kind's tiers bring it each battle, if any; where it
  // stands (how to field it); its kind (its level, read from its tiers, and the two tracks); Fuse (the recipes its
  // kind is part of); its abilities (Arise among them while it holds an Arise relic); to the ossuary.
  function soulPanel (u) {
    const mods = partyMods(run, u)
    const on = onField(u)
    return h('div', { class: 'uc' },
      pieceHead(u, mods),
      relicSection(u),
      summonsOf(u) > 0 && h('p', { class: 'uc-note uc-summons' }, summonText(u, statsOf(u, mods))),
      !on && h('p', { class: 'dim uc-note' }, u.hp <= 0 ? 'Fallen, in the ossuary: it cannot be fielded until an altar raises it.'
        : full() ? fullText(u) : say('In the ossuary. Drag it onto an open tile of the camp, or click one.', 'In the ossuary. Drag it onto an open tile of the camp, or tap one.')),
      kindPanel(u.id),
      fuseSection(u.id),
      h('div', { class: 'uc-sec' }, 'Abilities'),
      abilities(u, statsOf(u, mods)),
      h('div', { class: 'uc-acts' },
        on && h('button', { class: 'ghost small', onclick: () => place(u, OSSUARY), tip: () => `Keep ${unitDef(u.id).name} out of battle, in the ossuary.` }, icon('bone', 18), 'To the ossuary'),
        releaseButton(u)))
  }

  // Releasing a soul for good, for a share of its recruit price back (run.js releaseRefund): a duplicate is a choice of
  // field, fuse or sell. Never the last soul standing (run.js releasable). It cannot be undone, so the first press
  // only arms it and the second, on the same soul, releases.
  let arming = null
  function releaseButton (u) {
    const all = souls(s.party)
    if (all.length < 2 || !all.some((x) => x !== u && x.hp > 0)) return null
    const armed = arming === u.uid
    return h('button', {
      class: armed ? 'danger small' : 'ghost small',
      onclick: () => {
        if (!armed) { arming = u.uid; return render() }
        arming = null
        if (sel?.uid === u.uid) sel = null
        send({ type: 'release', uid: u.uid })
      },
      tip: () => `Release ${unitDef(u.id).name} forever, for ${releaseRefund(run, u)} essence back (${Math.round(TUNING.essence.refund * 100)}% of what recruiting it would cost now). Press twice: it can't be undone.`
    }, icon('release', 16), armed ? 'Release for good' : 'Release', h('span', { class: 'price' }, icon('soul', 14), `+${releaseRefund(run, u)}`))
  }

  // A kind's panel (DESIGN §2.6), the Bloons TD 6 way: its two tracks, each a row of tiers I–IV lit up to the one
  // held, the next priced at the row's end with what it does. Either track may go to II; once one passes II the
  // other stops there (the crosspath rule), its tiers past II locked. Every soul of the kind holds what is bought.
  // Its level is no buy: a read-out of its tiers (run.js levelOf), rising with each.
  function kindPanel (id) {
    const k = s.kinds[id]
    if (!k) return null
    const name = unitDef(id).name
    const held = s.party.filter((x) => x.id === id)
    const tracks = tracksOf(id)
    const lvl = kindLevel(s, id)
    const raw = levelOf({ tracks: k.tracks })
    // The level one tier more gives (either track's: a tier is a tier), and the words for it.
    const up = levelOf({ ...k, tracks: [k.tracks[0] + 1, k.tracks[1]] })
    const rise = up > lvl ? `Level ${lvl} → ${up}.` : `Level stays ${lvl}.`
    const row = (tr, t) => {
      const have = k.tracks[t]
      const can = canAdvance(s, id, t)
      const blocked = !can && have < 4
      const cost = can ? tierCost(run, id, t) : 0
      const next = tr.tiers[have]
      const other = tracks[1 - t]
      const lockText = `Locked: ${other.name} has passed II, so ${tr.name} stops at II.`
      const node = (tier, i) => {
        const lock = i >= have && !canTrack(k.tracks.map((v, j) => (j === t ? i : v)), t)
        const state = i < have ? 'own' : i === have && can ? (s.essence < cost ? 'next poor' : 'next') : lock ? 'lock' : 'later'
        const tip = () => h('div', { class: 'syn-tip' }, h('p', null, h('b', null, `${tr.name} ${ROMAN[i]}: `), tier.desc),
          i < have ? null : lock ? h('p', { class: 'warn' }, lockText) : i > have ? h('p', { class: 'dim' }, `After ${ROMAN[i - 1]}.`)
            : s.essence < cost ? h('p', { class: 'warn' }, `Needs ${cost} essence; you have ${s.essence}. ${rise}`) : h('p', { class: 'dim' }, `${cost} essence, for every ${name}. ${rise}`))
        const press = (e) => { if (i === have && can) return buyTier(e, id, t, cost); if (i >= have) { sfx.play('poor'); shake(e) } }
        return h('button', {
          class: `tnode ${state}` + (tier.size === 2 ? ' colossus' : ''), 'aria-label': `${tr.name} ${ROMAN[i]}`, 'aria-disabled': i === have && can && s.essence >= cost ? null : 'true',
          onclick: (e) => (i < have ? null : twice(e, tip, `Buy ${ROMAN[i]} ▸`, () => i === have && can && s.essence >= cost, press)),
          tip
        }, h('span', { class: 'tnum' }, ROMAN[i]), tier.size === 2 && h('span', { class: 'tbadge', 'aria-label': '2×2' }, icon('big', 14)))
      }
      return h('div', { class: 'track' + (have ? ' held' : '') + (t ? ' second' : '') },
        h('div', {
          class: 'track-head',
          tip: () => h('div', { class: 'syn-tip' }, h('b', null, `${tr.name} ${have}/${tr.tiers.length}`), ' ', tr.desc,
            h('p', { class: blocked ? 'warn' : 'dim' }, have >= tr.tiers.length ? 'Complete.' : blocked ? lockText
              : `Next: ${ROMAN[have]} for ${cost}${s.essence < cost ? `; you have ${s.essence}` : ''}. ${rise}`))
        }, h('b', null, tr.name), h('span', { class: 'track-desc dim' }, tr.desc)),
        h('div', { class: 'nodes' }, tr.tiers.map((tier, i) => [i > 0 && h('span', { class: 'tlink' + (i < have ? ' on' : '') }), node(tier, i)]),
          can && h('span', { class: 'tprice' + (s.essence < cost ? ' poor' : '') }, icon('soul', 16), cost)),
        h('div', { class: 'track-next' + (blocked ? ' warn' : '') }, have >= 4 ? 'Complete.' : blocked ? lockText : [h('b', null, `${ROMAN[have]} `), next.desc]))
    }
    return h('div', { class: 'uc-kind' },
      h('div', { class: 'uc-sec' }, `Every ${name}`, h('span', { class: 'dim' }, ` · ${held.length} held`)),
      h('div', {
        class: 'uc-level',
        tip: () => levelTip(id, lvl, up, raw < lvl)
      }, icon('levelup', 20), h('b', null, 'Level ', h('span', { class: 'num' }, lvl)), h('span', { class: 'dim' }, ' · rises with its tiers')),
      tracks.length === 2 && h('div', { class: 'tracks' }, tracks.map(row)))
  }
  // A kind's level, in its stats (unit.js baseStats): what it gives every soul of the kind now (`lvl`), and what the
  // next tier's level (`up`) adds to each; `fused`: the level is the kinds' fused into it, above its tiers'.
  function levelTip (id, lvl, up, fused) {
    const name = unitDef(id).name
    const [now, next] = [baseStats(id, lvl), baseStats(id, up)]
    const r = (st) => ({ hp: Math.round(st.hp), atk: Math.round(st.atk), def: Math.round(st.def) })
    const [a, b] = [r(now), r(next)]
    const gain = [['HP', 'hp'], ['ATK', 'atk'], ['DEF', 'def']].filter(([, k]) => b[k] !== a[k]).map(([w, k]) => `+${b[k] - a[k]} ${w}`).join(', ')
    const more = canAdvance(s, id, 0) || canAdvance(s, id, 1)
    return h('div', { class: 'syn-tip' },
      h('p', null, h('b', null, `Level ${lvl}: `), `HP ${a.hp}, ATK ${a.atk}, DEF ${a.def} for every ${name}, a recruit too${fused ? `; raised to ${lvl} by the kinds fused into it` : ''}.`),
      h('p', { class: 'dim' }, !more ? 'No tier left to buy.' : up > lvl ? `Next tier: Level ${up}${gain ? `, ${gain} each` : ''}.` : `Next tier: level stays ${lvl}.`))
  }
  // A Colossus tier sends each piece of the kind that no longer fits 2×2 where it stood to the ossuary: said.
  function buyTier (e, kind, track, cost) {
    if (s.essence < cost) { sfx.play('poor'); return shake(e) }
    const stood = fielded(s.party).filter((x) => x.id === kind).map((x) => x.uid)
    if (!send({ type: 'upgrade', kind, track })) return
    sfx.play('buy')
    const n = stood.filter((uid) => !onField(soulOf(uid))).length
    if (!n) return
    const name = unitDef(kind).name
    error = `${n === 1 ? `A ${name} no longer fits` : `${n} ${name} pieces no longer fit`} 2×2 where ${n === 1 ? 'it' : 'they'} stood: in the ossuary until you place ${n === 1 ? 'it' : 'them'} again.`
    render()
  }

  // Fuse (DESIGN §2.6, §4): the recipes this kind is part of, each its result's picture (its card on hover), its parts
  // (of the souls of each kind it takes, how many you hold) and one button, lit when every part is held and the
  // essence suffices. The run picks the pieces, whole (fuseParts: the ossuary's first, then the fielded); the fused
  // piece waits in the ossuary, selected.
  function fuseSection (kind) {
    const recipes = FUSION_LIST.filter((f) => Object.hasOwn(f.needs, kind))
    if (!recipes.length) return null
    const held = (k) => souls(s.party).filter((x) => x.id === k).length
    const row = (f) => {
      const d = unitDef(f.result)
      const k = s.kinds[f.result]
      return h('div', { class: 'fuse-row' + (canFuse(run, f.id) ? ' ready' : '') },
        h('span', { tip: () => unitCard({ id: f.result, lvl: k?.lvl ?? 1, tracks: k?.tracks ?? [0, 0] }, { realm: realmOf(run), notes: [f.desc] }) }, portrait(f.result, 40)),
        h('div', { class: 'fuse-text' },
          h('div', null, h('b', null, f.name), h('span', { class: 'dim' }, ` · tier ${d.tier}${(d.size ?? 1) > 1 ? ' · 2×2' : ''}`)),
          h('div', { class: 'fuse-parts' }, Object.entries(f.needs).map(([id, n]) => {
            const have = held(id)
            return h('span', { class: have >= n ? 'met' : 'short' }, `${unitDef(id).name} ${Math.min(have, n)}/${n}`)
          }))),
        fuseButton(f))
    }
    return h('div', { class: 'uc-fuse' },
      h('div', { class: 'uc-sec' }, kw('fusion', 'Fuse'), h('span', { class: 'dim' }, ` · ${recipes.length} recipe${recipes.length === 1 ? '' : 's'}`)),
      h('div', { class: 'fuse-list' }, recipes.map(row)))
  }
  function fuseButton (f) {
    const cost = fuseCost(run, f.id)
    const parts = fuseParts(run, f.id)
    const can = canFuse(run, f.id)
    // Each part a piece of its own: its name, and where it stands now.
    const partsText = (uids) => uids.map((uid) => {
      const p = soulOf(uid)
      return `the ${unitDef(p.id).name} ${onField(p) ? `on ${tileText(deployTile('party', p.slot)).replace(/^your camp, /, '')}` : 'in the ossuary'}`
    }).join(', ')
    const tip = () => h('div', { class: 'syn-tip' }, h('b', null, f.name), ' ', f.desc,
      !parts ? h('p', { class: 'warn' }, 'Not every part is held yet.')
        : s.essence < cost ? h('p', { class: 'warn' }, `Needs ${cost} essence; you have ${s.essence}.`)
          : h('p', { class: 'dim' }, `It takes ${partsText(parts)}, for ${cost} essence; the ${unitDef(f.result).name} waits in the ossuary.`))
    const press = (e) => {
      if (!can) { sfx.play('poor'); return shake(e) }
      if (!send({ type: 'fuse', id: f.id, parts: fuseParts(run, f.id) })) return
      learnt('fuse')
      sfx.play('buy')
      sel = { uid: s.party.at(-1).uid }
      render()
    }
    return h('button', {
      class: 'buy' + (can ? '' : ' poor'), 'aria-disabled': can ? null : 'true', 'aria-label': `Fuse ${f.name}`,
      onclick: (e) => twice(e, tip, `Fuse ${f.name} ▸`, () => can, press),
      tip
    }, icon('fuse', 18), 'Fuse', h('span', { class: 'price' }, icon('soul', 16), cost))
  }

  // The Monarch's panel, with nothing selected (DESIGN §4): a read-out, nothing to buy. Its HP and Command (the
  // relics give them: codex.js MONARCH_TEXT), and nothing else: it holds no relic, and Arise is a soul's skill. Then
  // your synergies, each chip a press that lights its pieces on the board.
  function monarchPanel () {
    const m = monarchOf(s)
    const stat = (k) => {
      const t = MONARCH_TEXT[k]
      return h('div', {
        class: 'mc-col',
        tip: () => h('div', { class: 'syn-tip' }, t.rule(run).filter(Boolean).map((line, i) => h('p', { class: i ? 'dim' : null }, i ? line : [h('b', null, `${t.name}: `), line])))
      },
      h('div', { class: 'mc-ico' }, icon(t.icon, 20)),
      h('div', { class: 'mc-name' }, t.name),
      h('div', { class: 'mc-val' }, t.value(run)),
      h('div', { class: 'mc-now' }, t.now(run)))
    }
    // Compact, so it shows whole in the slim panel: the head one line, the numbers two by two.
    return [h('div', { class: 'mc' },
      h('div', { class: 'uc-head' },
        h('div', { class: 'uc-art', tip: () => unitCard(m, { mods: partyMods(run, m), realm: realmOf(run), notes: ['Its seat is the camp\'s, marked by the crown: it never moves, and the roads run to it.'] }) }, portrait(m.id, 44, m.hp <= 0),
          h('span', { class: 'uc-ins crown' }, icon('crown', 14))),
        h('div', { class: 'uc-id' },
          h('div', { class: 'uc-name', tip: () => MONARCH_RULE }, 'The Monarch'),
          h('div', { class: 'mc-hp' }, hpBar(m.hp, m.maxHp), h('span', null, `${m.hp}/${m.maxHp}`)))),
      h('div', { class: 'mc-cols' }, ['hp', 'command'].map(stat))),
    h('div', { class: 'uc-sec' }, kw('synergy', 'Synergies'), h('span', { class: 'dim' }, say(' · click one to light its pieces', ' · tap one to light its pieces'))),
    synergyTracker(souls(standing(run)), alsoOf, { focus: focusSyn, onFocus: (key) => { focusSyn = focusSyn === key ? null : key; render() } }),
    h('div', { class: 'uc-sec' }, 'The board'),
    h('ul', { class: 'legend-list dim' },
      h('li', null, h('i', { class: 'lg-road' }), kw('road', 'Roads'), ': the arrows the foes walk to the Monarch.'),
      h('li', null, h('i', { class: 'lg-seat' }), 'The crown: the Monarch\'s seat, the camp\'s own. It never moves.'),
      domainNow(null) && h('li', null, h('i', { class: 'lg-dom' }), 'Arise\'s reach, round the soul holding it as the battle begins: the corpses it may raise.'))]
  }

  // ── tooltips ──

  // A fielded soul's card leads with where it starts the battle, its reach and Move, and the synergies it counts toward
  // ("Front row, lane 3 · Reach 2 · melee · Move 3 · Undead 4: Legion"), unless it holds Arise, whose reach leads.
  const pieceTip = (u) => {
    const at = !isMonarch(u) && [sentence(tileText(deployTile('party', u.slot)).replace(/^your camp, /, '')), reachText(u),
      ...synergyGroups(souls(standing(run)), alsoOf).filter((g) => g.uids.has(u.uid)).map((g) => g.name)].join(' · ')
    return unitCard(u, {
      mods: partyMods(run, u), realm: realmOf(run), run,
      live: isMonarch(u) ? 'If it falls, the run ends' : ariseFor(s, u) ? `Holds Arise: corpses within ${ariseFor(s, u).domain} tiles` : at,
      notes: [isMonarch(u) ? 'Its seat is the camp\'s, marked by the crown: it never moves.' : ariseFor(s, u) && at]
    })
  }
  function tileTip (t) {
    const r = t != null && tips.has(t) && board.rectOf(t)
    if (r) showTip(r, tips.get(t))
    else hideTip()
  }

  // ── acting ──

  // A soul to a camp slot (its footprint's anchor), or OSSUARY; the rules' refusals said in words before it is sent.
  function place (u, slot) {
    if (slot === u.slot) return render()
    if (isMonarch(u)) return refuse('The Monarch keeps the seat the camp gives it: it never moves.')
    if (slot !== OSSUARY && !canPlace(run, u, slot)) return refuse(placeRefusal(u, slot))
    const fresh = !onField(u) && slot !== OSSUARY
    if (sel?.uid === u.uid && fresh) sel = null
    if (send({ type: 'place', uid: u.uid, slot }) && fresh) learnt('place')
  }

  // Why piece u cannot stand anchored at camp cell `slot` (run.js canPlace said no), in words. Its footprint there
  // (a 2×2's four cells) is read whole: off the camp, the Monarch's seat, a wall, two pieces under it (a move swaps
  // with one piece, never two: run.js swapWith), the one under it with no room where u stands now, and only when
  // nothing would swap, a full field.
  function placeRefusal (u, slot) {
    const name = unitDef(u.id).name
    if (u.hp <= 0) return `${name} has fallen: it lies in the ossuary until an altar raises it.`
    const cells = footprintSlots(slot, sizeOf(u))
    if (!cells) return `${name} is 2×2: its four cells must all lie in the camp.`
    if (cells.some((c) => isMonarchCell(s.camp, c))) return 'The Monarch\'s seat is its own: nothing else stands on it.'
    if (cells.some((c) => isWall(s.camp, c))) return sizeOf(u) > 1 ? `A wall stands under ${name}'s four cells: a piece stands on open ground.` : 'A wall stands there: a piece stands on open ground.'
    const under = [...new Set(cells.map((c) => coverAt(c, u)).filter(Boolean))]
    if (under.length > 1) return `${name}'s footprint there covers ${under.length} pieces (${under.map((x) => unitDef(x.id).name).join(', ')}): a move swaps with one piece, never two.`
    const other = under[0]
    if (other && onField(u)) return `${unitDef(other.id).name} has no room where ${name} stands now, so they cannot swap.`
    if (!other && !onField(u) && full()) return fullText(u)
    return `${name} does not fit there.`
  }

  // The anchor a piece of u's size takes to cover camp cell `slot` (a tap on an open tile): the first of the
  // footprints over it that may be placed, else the cell itself.
  function anchorFor (u, slot) {
    if (sizeOf(u) === 1) return slot
    const [r, c] = [rowOf(slot), slot % COLS]
    const ways = [[r, c], [r, c - 1], [r + 1, c], [r + 1, c - 1]].filter(([y, x]) => y < CAMP_ROWS && x >= 0).map(([y, x]) => slotAt(y, x))
    return ways.find((a) => canPlace(run, u, a)) ?? slot
  }

  // A tap on the board: a piece selects it (or lets it go); an open camp tile with a soul from the ossuary selected
  // places it there; anything else returns to the Monarch.
  function tapTile (t) {
    const o = pieceAt(t)
    // A relic readied: the soul tapped takes it; anywhere else lets it go.
    if (giving) { if (o) return give(o); giving = null; return render() }
    if (t == null) return select(null)
    if (o) return select(sel?.uid === o.uid ? null : { uid: o.uid })
    const p = selected()
    const slot = slotOfTile(t)
    if (p && !onField(p) && slot != null && !isWall(s.camp, slot)) return place(p, anchorFor(p, slot))
    select(null)
  }

  // ── the board under the pointer ──
  // A press on the board is a tap unless it moves past a few pixels: on a piece of yours (never the Monarch) it
  // lifts it. The tooltip follows the mouse from tile to tile; a finger's comes by a long press.

  stage.addEventListener('pointermove', (e) => {
    if (press || drag || e.pointerType === 'touch') return
    const t = board.tileAt(e.clientX, e.clientY)
    if (t === hover && (t == null || document.querySelector('.tip.on'))) return
    hover = t
    board.hover(t)
    tileTip(t)
  })
  stage.addEventListener('pointerleave', (e) => {
    if (press || drag || e.pointerType === 'touch') return
    hover = null
    board.hover(null)
    hideTip()
  })
  stage.addEventListener('contextmenu', (e) => e.preventDefault())
  // The keyboard: the board takes focus (Tab); the arrows move a cursor over its tiles (from the Monarch's),
  // Enter or Space taps the tile under it. The tile's tooltip follows the cursor.
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
    } else if ((e.key === 'Enter' || e.key === ' ') && cursor != null) tapTile(cursor)
    else return
    e.preventDefault()
    e.stopPropagation()
  })
  stage.addEventListener('pointerdown', (e) => {
    swallow = false
    if (cursor != null) { cursor = null; board.focus(null) }
    keys(false)
    if (e.button !== 0) return
    const t = board.tileAt(e.clientX, e.clientY)
    const o = pieceAt(t)
    // The Monarch never moves: a press on it is only ever a tap.
    begin(e, { tile: t, uid: o && !isMonarch(o) ? o.uid : null })
    // A finger held still on a tile pins its tooltip; it is then no tap.
    const q = press
    if (e.pointerType === 'touch' && e.isPrimary) {
      q.hold = hold(e, () => {
        if (press !== q || drag) return
        q.long = true
        const r = t != null && tips.has(t) && board.rectOf(t)
        if (!r) return
        board.hover(t)
        pinTip(r, tips.get(t), { onHide: () => { if (!drag) board.hover(null) } })
      })
    }
  })

  function pressBench (e, u) {
    swallow = false
    if (e.button !== 0) return
    begin(e, { uid: u.uid, bench: true })
  }

  function begin (e, p) {
    press = { x: e.clientX, y: e.clientY, e, t0: performance.now(), touch: e.pointerType === 'touch', ...p }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  function end () {
    press?.hold?.cancel()
    press = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
  }

  // The screen changed under a press (a key, a room entered, a tab): it is let go of, and nothing it would do is done.
  function release () {
    end()
    if (drag) cancelDrag(false)
    hover = null
  }

  // A finger on a soul in the bench scrolls the strip only when it holds more than it shows, the finger sets off
  // sideways (within 25° of it) before a long press, and it stays over the strip: any other way the soul lifts.
  const FLAT = Math.tan(25 * Math.PI / 180)
  const over = (list, e) => { const r = list.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom }
  function onMove (e) {
    if (!el.isConnected) return release()
    if (!press || e.pointerId !== press.e.pointerId) return
    const [dx, dy] = [e.clientX - press.x, e.clientY - press.y]
    const far = Math.hypot(dx, dy) > 6
    if (press.scroll) {
      const { list, left } = press.scroll
      if (over(list, e)) { list.scrollLeft = left - dx / frame.k; return }
      press.scroll = null
    } else if (!drag && far && press.bench) {
      const list = press.touch && performance.now() - press.t0 < HOLD && el.querySelector('.bench')
      if (list && list.scrollWidth > list.clientWidth + 1 && Math.abs(dy) <= Math.abs(dx) * FLAT && over(list, e)) {
        press.scroll = { list, left: list.scrollLeft }
        swallow = true
        return
      }
    }
    if (!drag && far && press.uid != null) lift(e)
    if (drag) overMove(e)
  }

  function onUp (e) {
    if (!el.isConnected) return release()
    if (press && e.pointerId !== press.e.pointerId) return
    const p = press
    end()
    if (drag) return put(e)
    if (!p || p.long || p.bench) return
    tapTile(p.tile)
  }

  function onCancel () {
    if (!el.isConnected) return release()
    end()
    if (drag) cancelDrag()
  }

  // ── moving a piece ──

  function lift (e) {
    press.hold?.cancel()
    const u = soulOf(press.uid)
    drag = { uid: u.uid, at: undefined, target: null }
    if (press.bench) swallow = true
    hideTip()
    hover = null
    board.hover(null)
    document.body.classList.add('dragging')
    // Off the board (over the bench, the panel) the canvas is under the page: a picture of the piece carries it
    // there, at the board's size (the board's zoom is in viewport px, the ghost in the frame's).
    const size = Math.round(Math.max(40, 92 * board.zoom()) / frame.k)
    drag.ghost = h('div', { class: 'drag-ghost', hidden: true, style: `--s:${size}px` }, portrait(u.id, size, u.hp <= 0))
    frame.el.append(drag.ghost)
    board.lift(press.bench ? { id: u.id, size: sizeOf(u) } : `s${u.uid}`, e.clientX, e.clientY)
    render()
  }

  // The tiles a piece may be dropped on, by its footprint's anchor: every camp cell it may be placed at (run.js
  // canPlace: it fits there, or swaps with the one piece its footprint there covers).
  function dropTiles (u) {
    if (!u || isMonarch(u)) return []
    const out = []
    for (let slot = 0; slot < COLS * CAMP_ROWS; slot++) {
      if (slot !== u.slot && canPlace(run, u, slot)) out.push(deployTile('party', slot))
    }
    return out
  }

  // The drop under the pointer, and when it changes, what it would do (dragPreview) for the board to show. On the
  // board the tile is the footprint's anchor (board.js tileAt: for a 2×2, the cell under its rear-right quarter).
  function overMove (e) {
    const hit = document.elementFromPoint(e.clientX, e.clientY)
    const onBench = hit?.closest?.('.bench-strip')
    const benched = onBench ? hit.closest('[data-uid]')?.dataset.uid : undefined
    const t = onBench ? null : board.tileAt(e.clientX, e.clientY)
    const at = onBench ? `b${benched ?? ''}` : String(t)
    const off = !hit?.closest?.('.stage-wrap')
    drag.ghost.hidden = !off
    const g = toLocal(e.clientX, e.clientY)
    drag.ghost.style.transform = `translate(${g.x}px, ${g.y}px)`
    let preview
    if (at !== drag.at) {
      drag.at = at
      drag.target = dropAt(soulOf(drag.uid), t, !!onBench, benched != null ? soulOf(+benched) : null)
      preview = dragPreview(soulOf(drag.uid), drag.target)
      el.querySelector('.bench')?.classList.toggle('over', !!drag.target?.bench && drag.target.ok)
    }
    board.follow(e.clientX, e.clientY, preview, off)
  }

  // Where a drop would land: a camp cell (its footprint's anchor) with the board tiles the footprint would cover
  // (`cells`, those it cannot take in `bad`: off the camp, a wall, the seat, another piece's but the one it would
  // swap with: run.js swapWith, the one piece under the whole footprint, none where two are), a tile past the camp
  // (slot null: all of them bad), the bench or a soul on it (`benched`: they swap), or nowhere (null); and whether
  // the rules take it (a refused one in the camp is still put down there, for its message).
  function dropAt (u, t, bench, benched) {
    if (bench) return { bench: true, benched, ok: !isMonarch(u) && onField(u) }
    if (t == null) return null
    const slot = slotOfTile(t)
    const size = sizeOf(u)
    const [x, y] = [tileX(t), tileY(t)]
    const cells = []
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (x + dx < LANES && y + dy < DEPTH) cells.push(tileAt(x + dx, y + dy))
    // Past the camp: every cell red, and a drop there is let go of.
    if (slot == null) return { tile: t, slot, size, cells, bad: cells, ok: false }
    const o = swapWith(run, u, slot)
    const held = heldBut(u, o === 'many' ? null : o)
    const whole = cells.length === size * size
    const bad = cells.filter((c) => {
      const sl = slotOfTile(c)
      return sl == null || !campOpen(s.camp, sl) || isMonarchCell(s.camp, sl) || held.has(sl)
    })
    return { tile: t, slot, size, cells, bad: whole ? bad : cells, ok: slot === u.slot || canPlace(run, u, slot) }
  }

  // What a drop would make of the board: the footprint's cells, lit, red where they do not fit; the one piece it
  // would displace (run.js swapWith) shown ghosted where it would go.
  function dragPreview (u, target) {
    if (!target || target.bench) return { tile: null, ok: !!target?.ok, swap: null }
    const base = { tile: target.tile, size: target.size, cells: target.cells, bad: target.bad, ok: target.ok }
    if (!target.ok || target.slot === u.slot) return { ...base, swap: null }
    const other = swapWith(run, u, target.slot)
    return { ...base, swap: other && other !== 'many' ? { key: `s${other.uid}`, id: other.id, size: sizeOf(other), to: onField(u) ? deployTile('party', u.slot) : null } : null }
  }

  // The drop: the move it stands for is made, or refused in words.
  function put (e) {
    overMove(e)
    const { uid, target } = drag
    cancelDrag(false)
    const u = soulOf(uid)
    if (!target || (!target.bench && target.slot == null)) { error = ''; return render() }
    if (target.bench) {
      if (!onField(u)) return render()
      return target.benched && target.benched !== u ? place(target.benched, u.slot) : place(u, OSSUARY)
    }
    place(u, target.slot)
  }

  function cancelDrag (redraw = true) {
    drag?.ghost?.remove()
    drag = null
    stage.classList.remove('dragging')
    document.body.classList.remove('dragging')
    board.drop()
    if (redraw) render()
  }

  render()
  return {
    el,
    // Its screen is about to change (a room entered, a tab): a press or a drag still held is let go of, doing nothing.
    release,
    // Put back on the page as it was (the Field tab again): the board is shown again.
    shown: render,
    key (e) {
      if (e.key !== 'Escape') return
      if (drag) { end(); return cancelDrag() }
      if (giving) giving = null
      else if (focusSyn) focusSyn = null
      else if (sel) sel = null
      else if (!error) return
      error = ''
      render()
    }
  }
}

// "your camp, front row, lane 4" → "Your camp, front row, lane 4".
const sentence = (t) => t.charAt(0).toUpperCase() + t.slice(1)
// A soul's relic, worn as a small gem in its tier's colour on its portrait (the board draws it on the sprite: engine.js
// growthMarks).
const relicMark = (u) => u.relics?.length > 0 && h('i', { class: `relic-mark rt-${relicDef(u.relics[0]).tier}`, 'aria-hidden': 'true' })

// ── cards: the spoils' and the Shop's ────────────────────────────────────────────────────────────

// Every offer's key, in the order the cards are shown: 1 to 9 and 0, then Q, W, E… By offer index.
const PICK_KEYS = [...'1234567890QWERTYUIOP']
const offerKeys = (offers) => new Map(offers.slice(0, PICK_KEYS.length).map((o, i) => [i, PICK_KEYS[i]]))

// The numbers in a card's effect line, picked out in the card's colour: +12%, 8 s, ×2, 40%.
const hiNums = (text) => String(text).split(/([+−×-]?\d+(?:\.\d+)?%?)/).map((part, k) => (k % 2 ? h('b', { class: 'num' }, part) : part))
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// ── arrivals: what is taken flies to where it now lives ──

// The things in flight sit on a layer of their own over the page (in the frame, so they scale with it), never
// in the pointer's way. A screen re-shown under them (the spoils after a pick) does not cut them short.
let flyLayer = null
const layer = () => {
  if (!flyLayer?.isConnected) frame.el.append(flyLayer = h('div', { class: 'fly-layer', 'aria-hidden': 'true' }))
  return flyLayer
}
const centre = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 })

// `node` flies in an arc from viewport point `from` to `to`, shrinking to `scale`, after `delay` ms; the
// promise settles as it lands. The flight itself is drawn in the frame's px.
function flyOne (node, from, to, { delay = 0, ms = 560, scale = 0.5, lift = 60 } = {}) {
  from = toLocal(from.x, from.y)
  to = toLocal(to.x, to.y)
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

// A relic just taken flies from its card to its new tile in the top bar, and the tile pops in as
// it lands; a recruit's face flies to the souls' count.
function flyTrinket (o, rect) {
  const soul = o.type === 'soul'
  const find = () => document.querySelector(soul ? '.topbar .chip-stat.souls' : `.topbar .trinket[data-id="${o.id}"]`)
  const tile = find()
  if (!tile || !rect || still()) return
  if (!soul) tile.classList.add('arriving')
  const glyph = soul ? h('span', { class: 'soul-flyer' }, portrait(o.id, 64))
    : h('span', { class: `trinket-flyer rt-${relicDef(o.id).tier}` }, icon(relicIcon(o.id), 44))
  flyOne(glyph, centre(rect), centre(tile.getBoundingClientRect()), { ms: 680, scale: 0.36, lift: 90 }).then(() => {
    const now = find()
    if (!now) return
    now.classList.remove('arriving', 'new', 'gain')
    void now.offsetWidth
    now.classList.add(soul ? 'gain' : 'new')
  })
}

// The room whose cards were last dealt: a release (a buy) re-shows the same room, and its cards should not deal in
// again.
let dealt = null
const freshRoom = (run) => {
  const room = `${run.state.floor}|${run.state.at}`
  const fresh = !(dealt?.run === run && dealt.room === room)
  dealt = { run, room }
  return fresh
}
const RELIC_TIER_NAME = Object.fromEntries(RELIC_TIERS.map((x) => [x.id, x.name]))

// The parts the spoils and the Shop share: a card's refusal, its art's rect (for what flies from it), and by touch a
// card read before it is taken, as the map's rooms are entered (nothing needs a hover): the first tap chooses it and
// pins its full text with the taking button (`label`) under it; a second tap on it, or the button, takes it; a tap
// anywhere else lets it go. A mouse's click (its hover reads the card) and a card's key take it at once.
function cardDeck () {
  const cards = []
  let chosen = null
  return {
    cards,
    refuse (i) {
      sfx.play('poor')
      const c = cards[i]
      if (!c) return
      c.classList.remove('refuse')
      void c.offsetWidth
      c.classList.add('refuse')
    },
    artRect: (i) => (cards[i]?.querySelector('.offer-art') ?? cards[i])?.getBoundingClientRect(),
    press (e, i, tip, label, ok, take) {
      if (!touchy() || chosen === e.currentTarget) return take(i)
      const card = e.currentTarget
      chosen = card
      card.classList.add('chosen')
      pinTip(card, () => [tip(), ok() && h('button', { class: 'primary small tip-act', onclick: () => { hideTip(); take(i) } }, label)], {
        keep: true,
        onHide: () => { card.classList.remove('chosen'); if (chosen === card) chosen = null }
      })
    }
  }
}

// Your souls, one line at the foot: how many. Where a soul may be let go (`open`: always in a Shop, for its refund;
// on the spoils only with no room for a recruit), the line opens (a press) a panel over the cards: each soul but the
// Monarch, with a Release button that says the essence it pays back (run.js releaseRefund: a share of what
// recruiting it would cost now). `busy()`: a card on its way, nothing pressed now; `again()`: the screen redrawn.
function soulsStrip ({ run, act, busy, again, why }) {
  const s = run.state
  let roster = false
  return (open) => {
    const n = souls(s.party).length
    const cap = rosterCap(run)
    if (!open) {
      return h('div', { class: 'ret-line', tip: () => `Souls ${n}/${cap}: ${ossuaryCount(run)}` },
        icon('hood', 20), h('b', null, 'Souls'), ` ${n}/${cap}`)
    }
    return h('div', { class: 'ret-strip' + (n >= cap ? ' full' : '') + (roster ? ' open' : '') },
      h('button', {
        class: 'ret-toggle', 'aria-expanded': roster ? 'true' : 'false',
        onclick: () => { roster = !roster; hideTip(); again() },
        tip: () => roster ? 'Close the list.' : why
      }, icon('hood', 20), h('b', null, `${n >= cap ? 'Full ' : 'Souls '}${n}/${cap}`), h('span', null, n >= cap ? ' · Release one to recruit' : ' · Release one'), h('span', { class: 'ret-caret', 'aria-hidden': 'true' }, roster ? '▾' : '▴')),
      roster && h('div', { class: 'ret-pop', role: 'region', 'aria-label': 'Release a soul' },
        h('div', { class: 'units' }, s.party.filter((u) => !isMonarch(u)).sort(fieldOrder).map((u) => unitRow(run, u, h('button', {
          class: 'danger small',
          onclick: () => { if (!busy()) { act({ type: 'release', uid: u.uid }); roster = false; again() } },
          tip: () => `Release ${unitDef(u.id).name} forever, freeing a place among your souls, for ${releaseRefund(run, u)} essence back (${Math.round(TUNING.essence.refund * 100)}% of what recruiting it would cost now). This can't be undone.`
        }, icon('release', 16), 'Release', h('span', { class: 'price' }, icon('soul', 14), `+${releaseRefund(run, u)}`)))))))
  }
}

// The Relics strip's parts (the Field's, and the Shop's and spoils' below): its label, and the piece relics held by no
// soul, a button each (a copy more a ×N); `giving` is the one readied, `pick(id)` readies or lets go of one.
function relicChips (run, giving, pick) {
  const ids = unheld(run.state)
  const kinds = [...new Set(ids)]
  return [
    h('div', {
      class: 'bench-label',
      tip: () => {
        const free = souls(run.state.party).filter((u) => (u.relics?.length ?? 0) < TUNING.relic.perPiece).length
        return h('div', { class: 'syn-tip' }, h('b', null, `Relics to give · ${ids.length} unheld`),
          ids.length > 0 && h('p', null, `${tally(ids.map((id) => relicDef(id).name))} · ${free} soul${free === 1 ? ' has' : 's have'} a free slot.`),
          h('p', { class: 'dim' }, `${say('Click', 'Tap')} one, then a soul; a soul holding one swaps. Out of battle only.`))
      }
    }, h('b', null, 'Relics'), h('span', { class: 'dim' }, ` ${ids.length} unheld`)),
    h('div', { class: 'relics-unheld' }, kinds.map((id) => {
      const r = relicDef(id)
      const n = ids.filter((x) => x === id).length
      return h('button', {
        class: `give-relic rt-${r.tier}` + (giving === id ? ' on' : ''), 'aria-pressed': giving === id ? 'true' : 'false',
        onclick: () => pick(id),
        tip: () => h('div', null, relicTip(id, run), h('p', { class: 'dim' }, giving === id ? `${say('Click', 'Tap')} a soul to give it, or this again to cancel.` : `${say('Click', 'Tap')} it, then a soul, to give it.`))
      }, icon(relicIcon(id), 20), h('span', { class: 'gr-name' }, r.name), n > 1 && h('span', { class: 'relic-n' }, `×${n}`))
    }))]
}

// The piece relics, at the foot of the Shop and the spoils (redesign.md §2.15: give, take back and swap out of battle,
// as the Field's Relics strip does, and by its gesture): a line of how many wait unheld; a press opens, over the cards,
// the same strip of them and a compact list of your souls, a row each: tap a relic, then a soul to give it (a soul
// holding one swaps); a soul's relic slot takes it back. Nothing while no piece relic is owned. `busy()`, `again()`:
// as soulsStrip's.
function relicsStrip ({ run, act, busy, again }) {
  const s = run.state
  let open = false
  let giving = null
  let error = ''
  return () => {
    if (!s.relics.some((id) => !isRunRelic(id))) return null
    if (giving && !unheld(s).includes(giving)) giving = null
    const n = unheld(s).length
    const go = (action) => { if (busy()) return; error = act(action) ?? ''; if (!error) sfx.play('buy'); again() }
    const give = (u) => {
      if (!giving) return
      if (!canHold(s, giving, u)) { error = `${unitDef(u.id).name} already holds ${relicDef(giving).name}.`; sfx.play('poor'); return again() }
      const relic = giving
      giving = null
      go({ type: 'hold', relic, uid: u.uid })
    }
    const row = (u) => {
      const held = u.relics ?? []
      const slot = (id) => h('button', {
        class: `give-relic small on rt-${relicDef(id).tier}`, onclick: () => (giving ? give(u) : go({ type: 'unhold', uid: u.uid, relic: id })),
        tip: () => giving ? `Swap it for ${relicDef(id).name}, which waits unheld.` : `Take ${relicDef(id).name} back from ${unitDef(u.id).name}: it waits unheld, to give again.`
      }, icon(relicIcon(id), 16), relicDef(id).name, giving ? '' : ' ✕')
      return h('div', { class: 'give-soul' + (giving && canHold(s, giving, u) ? ' offer' : '') },
        h('button', { class: 'gs-soul', onclick: () => give(u), tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run), run }) },
          h('span', { class: 'rank-port' + (u.hp <= 0 ? ' fallen' : '') }, portrait(u.id, 32, u.hp <= 0)), h('b', null, unitDef(u.id).name)),
        held.length ? held.map(slot) : h('button', { class: 'give-relic small empty dim', onclick: () => give(u) }, '◇ empty'))
    }
    return h('div', { class: 'ret-strip relics' + (open ? ' open' : '') },
      h('button', {
        class: 'ret-toggle', 'aria-expanded': open ? 'true' : 'false',
        onclick: () => { open = !open; giving = null; error = ''; hideTip(); again() },
        tip: () => open ? 'Close the list.' : 'Give a piece relic to a soul, take one back, or swap: it works only through its holder.'
      }, icon('reliquary', 20), h('b', null, `Relics ${n} unheld`), h('span', { class: 'ret-caret', 'aria-hidden': 'true' }, open ? '▾' : '▴')),
      open && h('div', { class: 'ret-pop', role: 'region', 'aria-label': 'Give a relic' },
        n > 0 ? h('div', { class: 'relic-strip' }, relicChips(run, giving, (id) => { giving = giving === id ? null : id; error = ''; sfx.play('select'); again() }))
          : h('p', { class: 'dim' }, 'Every piece relic is held: a soul\'s slot takes one back.'),
        giving && h('p', { class: 'give-hint' }, h('b', null, say('Click', 'Tap')), ' a soul to give it ', h('b', { class: `c-${relicDef(giving).tier}` }, relicDef(giving).name), ' · again to cancel'),
        error && h('p', { class: 'warn' }, error),
        h('div', { class: 'give-souls' }, souls(s.party).sort(fieldOrder).map(row))))
  }
}

// Cards per row: up to `most` in one, more in rows as even as they come.
const cardRow = (n, most) => (n <= most ? Math.max(n, 1) : Math.ceil(n / Math.ceil(n / most)))
const mostCards = () => Math.max(3, Math.min(6, Math.floor((frame.w - 44 + 18) / (168 + 18))))

// ── reap ─────────────────────────────────────────────────────────────────────────────────────────

// The spoils of a won battle: one of the slain to recruit (relics are the Shop's alone, redesign.md §2.11), what
// each wave paid, and a won elite's essence on top of its foes'. onDone(index): recruit offer `index`, or null to
// move on. The offers are cards to pick, framed in essence's colour.
export function reapScreen ({ run, title, act, onDone, onHelp }) {
  const s = run.state
  const el = h('div', { class: 'screen fit reap-screen' })
  const full = () => souls(s.party).length >= rosterCap(run)
  const blocked = (o) => (full() ? 'full' : o.cost > s.essence ? 'poor' : null)
  let deal = freshRoom(run)
  const deck = cardDeck()
  let busy = false
  const keys = offerKeys(s.offers)
  const keyTag = (i) => keys.has(i) && h('kbd', null, keys.get(i))
  const later = (fn) => (still() ? fn() : setTimeout(fn, 300))
  const take = (i) => {
    if (busy) return
    if (i === null) return onDone(null)
    const o = soulOffer(run, s.offers[i])
    if (blocked(o)) return deck.refuse(i)
    const rect = deck.artRect(i)
    busy = true
    sfx.play('card')
    el.classList.add('picking')
    deck.cards[i]?.classList.add('taking')
    later(() => {
      onDone(i)
      flyTrinket(o, rect)
    })
  }
  const node = currentNode(run)
  // Hollow Court: the shadows that stood at the end of the battle just won paid their essence again.
  const shades = ['fight', 'elite', 'siege'].includes(node.type) ? reapedShadows(run) : []
  const reaped = shades.length > 0 && `Hollow Court: ${shades.length} shadow${shades.length === 1 ? '' : 's'} still stood, and paid ${shades.length === 1 ? 'its' : 'their'} essence again.`
  // A battle of waves paid each wave as it fell: what each paid, relics included (essence gain).
  const boost = runStat(s, 'essence.gain', 1)
  const paid = node.waves?.length && run.battle ? essenceByWave(run.battle) : null
  const times = (v) => `×${+v.toFixed(2)}`
  const wavePay = paid && h('p', {
    class: 'wave-pay',
    tip: () => `${paid.map((v, k) => `Wave ${k + 1} ${Math.round(v * boost)}`).join(' + ')} = ${Math.round(paid.reduce((a, b) => a + b, 0) * boost)} essence${boost !== 1 ? `, relics' ${times(boost)} in` : ''}.`
  }, icon('soul', 18), ' Paid wave by wave: ', paid.map((v, k) => [k ? ' · ' : '', `Wave ${k + 1}`, ' ', h('b', null, Math.round(v * boost))]))
  // A won elite's panel: its essence on top of its foes' (run.js eliteBonus, relics included), and its recruit.
  const elitePay = node.type === 'elite' && h('p', {
    class: 'wave-pay elite-pay',
    tip: () => `${TUNING.essence.eliteBonus} at floor-1 prices, ${times(floorPrice(s.floor))} here${boost !== 1 ? `, ${times(boost)} by relics` : ''}: +${Math.round(eliteBonus(s.floor) * boost)}, on top of its foes'. An elite lays out no relic: the Shops sell those.`
  }, icon('soul', 18), ' The elite\'s bounty: ', h('b', null, `+${Math.round(eliteBonus(s.floor) * boost)}`), ' essence, on top of its foes\'.')
  // What the battle just won paid in all (run.js finishBattle: its slain, Hollow Court's shadows, an elite's bounty, ×
  // the relics' gain), and where a recruit would go.
  const won = run.battle && Math.round((essenceByWave(run.battle).reduce((a, b) => a + b, 0) + shades.reduce((n, u) => n + foeEssence(u) * u.reap, 0) +
    (node.type === 'elite' ? eliteBonus(s.floor) : 0)) * boost)
  const ledeTip = () => {
    const f = fielded(souls(s.party)).length
    return h('div', { class: 'syn-tip' },
      won != null && h('p', null, `This battle paid +${won} essence; you have ${s.essence}.`),
      h('p', null, `One recruit a battle. Field ${f}/${fieldCap(run)}: ${f < fieldCap(run) ? 'a recruit joins it' : 'a recruit waits in the ossuary'} · souls ${souls(s.party).length}/${rosterCap(run)}.`))
  }
  const strip = soulsStrip({ run, act, busy: () => busy, again: () => render(), why: 'Your souls are at their most: open the list to release one, and make room for a recruit.' })
  const relics = relicsStrip({ run, act, busy: () => busy, again: () => render() })

  // A card: big art, the name, one line; the rest is on the hover. A recruit of a kind you already hold says what one
  // more is worth (codex.js recruitWorth): how many you hold, the synergy steps one more fielded would reach, the
  // tiers it shares, and how far it takes each fusion its kind is part of.
  function card (o, i) {
    const why = blocked(o)
    const worth = recruitWorth(run, o.id)
    // Its lead: its price, the level it joins at and where it would go (run.js join: the field while it has room).
    const lead = () => {
      const f = fielded(souls(s.party)).length
      return why === 'full' ? `Souls ${souls(s.party).length}/${rosterCap(run)}: release one to recruit`
        : `Recruit for ${o.cost}: joins at Lv ${o.lvl}, ${f < fieldCap(run) ? `on the field (${f + 1}/${fieldCap(run)})` : `in the ossuary (field ${f}/${fieldCap(run)})`}`
    }
    // A kind new to your souls: the synergy steps it would bring, fielded (codex.js recruitSteps).
    const fresh = () => {
      const steps = recruitSteps(run, o.id)
      return `New to your souls. Fielded, it brings ${steps.length ? steps.join(', ') : 'no new synergy'}.`
    }
    const tip = () => unitCard({ id: o.id, lvl: o.lvl, slot: -1 }, {
      // A click takes the card: a mouse reads its details on the hover itself, never under Shift.
      open: !touchy(),
      mods: partyMods(run),
      live: lead(),
      notes: [why === 'poor' ? `You need ${o.cost} essence; you have ${s.essence}.` : !why && `${say('Click', 'Tap it again (or Recruit ▸)')} to recruit it.`,
        ...(worth?.lines ?? [fresh()])]
    })
    const d = unitDef(o.id)
    return deck.cards[i] = h('button', { class: 'offer o-soul' + (why ? ' locked' : ''), style: `--i:${i}`, onclick: (e) => deck.press(e, i, tip, 'Recruit ▸', () => !blocked(o), take), 'aria-disabled': why ? 'true' : null, tip },
      h('div', { class: 'offer-tag' }, keyTag(i), h('span', { class: 'tag-word' }, ' Recruit')),
      h('div', { class: 'offer-art' }, portrait(o.id, 104)),
      h('div', { class: 'offer-name' }, o.name),
      worth && h('div', { class: 'offer-worth' }, worth.chips.map((c) => h('span', { class: 'ow-chip' + (c.up ? ' up' : '') }, c.text))),
      h('div', { class: 'offer-line' }, `${KIN[d.kin].name} ${ROLES[d.role].name} · `, h('span', { class: 'nowrap' }, 'level ', h('b', { class: 'num' }, o.lvl))),
      h('div', { class: 'offer-price' + (why ? ` ${why}` : '') }, icon('soul', 18), o.cost, why === 'full' && h('span', null, ' · full')))
  }

  function render () {
    deck.cards.length = 0
    // A recruit read as the run stands now (run.js soulOffer).
    const offers = s.offers.map((o, i) => card(soulOffer(run, o), i))
    const cols = cardRow(offers.length, mostCards())
    fill(el,
      topbar(run, onHelp),
      h('div', { class: 'reap-main' },
        h('div', { class: 'reap-head' },
          h('div', { class: 'reap-title' }, icon(node.type === 'elite' ? 'elite' : 'soul', 34), h('h1', null, title)),
          h('p', { class: 'reap-lede' }, s.offers.length ? ['Recruit one of the slain for ', kw('essence'), ', or move on.'] : 'None of the slain can be recruited.',
            h('span', { class: 'lede-more', tabindex: '0', tip: ledeTip }, icon('help', 22)))),
        elitePay,
        reaped && h('p', { class: 'note-line reap-note' }, reaped),
        wavePay,
        h('div', { class: 'reap-body' },
          h('div', { class: 'reap-picks' },
            offers.length > 0 && h('div', { class: 'offers picks' + (deal ? ' deal' : '') + (offers.length > cols ? ' rows' : ''), style: `--cols:${cols}` }, offers))),
        h('div', { class: 'reap-foot' },
          strip(s.offers.length > 0 && full()),
          relics(),
          h('div', { class: 'reap-actions' },
            h('button', { class: 'ghost big move-on', onclick: () => take(null), tip: () => `Go on.${s.offers.length ? ' The slain not recruited are lost.' : ''} (S)` }, 'Move on ', h('kbd', null, 'S'))))))
    deal = false
  }

  render()
  return {
    el,
    key (e) {
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      const hit = [...keys].find(([, k]) => e.key.toUpperCase() === k)
      if (hit) take(hit[0])
      else if (e.key === 's' || e.key === 'S') take(null)
    }
  }
}

// ── the Shop ─────────────────────────────────────────────────────────────────────────────────────

// A Shop (redesign.md §2.11): its stock of relics (run.js shopOffers: a slot null once bought), each card with its
// price; a card lights only while the purse (the bar's essence) pays for it, and any number may be bought. Leave is
// free (onLeave). A soul may be released here for its refund.
export function shopScreen ({ run, act, onLeave, onHelp }) {
  const s = run.state
  const el = h('div', { class: 'screen fit reap-screen shop-screen' })
  let deal = freshRoom(run)
  const deck = cardDeck()
  const keys = offerKeys(s.shop)
  const keyTag = (i) => keys.has(i) && h('kbd', null, keys.get(i))
  const keyNote = (i) => keys.has(i) ? ` (${keys.get(i)})` : ''
  const buy = (i) => {
    const o = shopOffers(run)[i]
    if (!o) return
    if (!canBuy(run, i)) return deck.refuse(i)
    const rect = deck.artRect(i)
    if (act({ type: 'buy', index: i })) return deck.refuse(i)
    sfx.play('buy')
    hideTip()
    render()
    flyTrinket(o, rect)
  }
  const strip = soulsStrip({ run, act, busy: () => false, again: () => render(), why: 'Let a soul go for part of what recruiting it would cost now.' })
  const relics = relicsStrip({ run, act, busy: () => false, again: () => render() })

  function card (o, i) {
    if (!o) return deck.cards[i] = h('div', { class: 'offer o-sold', style: `--i:${i}` }, h('div', { class: 'offer-art' }, icon('shop', 48)), h('div', { class: 'offer-name' }, 'Bought'))
    const why = canBuy(run, i) ? null : 'poor'
    const r = relicDef(o.id)
    const copies = relicCount(s, o.id)
    const tip = () => h('div', null, relicTip(o.id, run),
      h('p', { class: 'dim' }, why ? `You need ${o.cost} essence; you have ${s.essence}.` : `${say('Click', 'Tap it again (or Buy ▸)')} to buy it for ${o.cost} essence.${keyNote(i)}`))
    return deck.cards[i] = h('button', { class: `offer o-relic o-${o.tier} rt-${o.tier}` + (why ? ' locked' : ''), style: `--i:${i}`, onclick: (e) => deck.press(e, i, tip, 'Buy ▸', () => canBuy(run, i), buy), 'aria-disabled': why ? 'true' : null, tip },
      h('div', { class: 'offer-tag' }, keyTag(i), h('span', { class: 'tag-word' }, ` ${RELIC_TIER_NAME[o.tier]}`),
        h('span', { class: 'kind-tag', tip: () => isRunRelic(o.id) ? 'A run relic: it works for the whole run, unheld.' : 'A piece relic: it works only through the soul you give it to, on the Field.' }, relicKind(o.id))),
      h('div', { class: 'offer-art' }, icon(relicIcon(o.id), 64),
        r.on && h('span', { class: 'trig-tag', tip: () => `Fires each time ${TRIGGER_TEXT[r.on].short}` }, TRIGGER_TEXT[r.on].name)),
      h('div', { class: 'offer-name' }, o.name),
      copies > 0 && h('div', { class: 'offer-sub' }, isRunRelic(o.id) ? `Owned ×${copies}: one more adds to it` : `Owned ×${copies}: one more is another holder`),
      h('div', { class: 'offer-line' }, hiNums(o.desc)),
      h('div', { class: 'offer-price' + (why ? ' poor' : '') }, icon('soul', 18), o.cost))
  }

  // The purse against the shelf: "You have 120: 2 of these 4 are within reach."
  function shelfLine () {
    const left = shopOffers(run).filter(Boolean)
    const k = left.filter((o) => o.cost <= s.essence).length
    return !left.length ? `You have ${s.essence}; the shelves are bare.`
      : `You have ${s.essence}: ${k === left.length ? (k === 1 ? 'the last one is' : `all ${k} are`) : `${k} of these ${left.length} ${k === 1 ? 'is' : 'are'}`} within reach.`
  }

  function render () {
    deck.cards.length = 0
    const stock = shopOffers(run).map(card)
    const cols = cardRow(stock.length, mostCards())
    fill(el,
      topbar(run, onHelp),
      h('div', { class: 'reap-main' },
        h('div', { class: 'reap-head' },
          h('div', { class: 'reap-title' }, icon('shop', 34), h('h1', null, 'Shop')),
          h('p', { class: 'reap-lede' }, [kw('relic', 'Relics'), ' for ', kw('essence'), `. ${shelfLine()} Leaving is free.`])),
        h('div', { class: 'reap-body' },
          h('div', { class: 'reap-picks' },
            h('div', { class: 'offers picks' + (deal ? ' deal' : '') + (stock.length > cols ? ' rows' : ''), style: `--cols:${cols}` }, stock))),
        h('div', { class: 'reap-foot' },
          strip(true),
          relics(),
          h('div', { class: 'reap-actions' },
            h('button', { class: 'ghost big move-on', onclick: onLeave, tip: () => 'Leave the Shop and go on. (S)' }, 'Leave ', h('kbd', null, 'S'))))))
    deal = false
  }

  render()
  return {
    el,
    key (e) {
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      const hit = [...keys].find(([, k]) => e.key.toUpperCase() === k)
      if (hit) buy(hit[0])
      else if (e.key === 's' || e.key === 'S') onLeave()
    }
  }
}

// ── end ──────────────────────────────────────────────────────────────────────────────────────────

// Three ends. The Sovereign slain (over, 'victory', no death): the run is cleared, and the deep lies below
// (Descend, or stop here with a new run). A fall in the deep after that clear ('victory' with a death): the
// clear stands. A defeat on the way down: as it was.
export function endScreen ({ run, onNew, onDescend, onHelp }) {
  const s = run.state
  const won = s.result === 'victory'
  const lost = s.death
  const descend = canDescend(s)
  const deep = depthOf(s.floor)
  const n = TUNING.run.floors
  const cleared = Math.min(s.stats.floorsCleared, n)
  const deeper = s.stats.floorsCleared - cleared
  const tagline = descend ? 'The Hollow Sovereign falls, its court crumbles to dust with it, and its soul is yours. The run is cleared, and that stands whatever comes next.'
    : won ? `The Hollow Sovereign fell to you. Then, on floor ${s.floor}, ${deep} floor${deep === 1 ? '' : 's'} below it, the Monarch fell. The clear stands.`
      : `The Monarch fell on floor ${s.floor}, and the run with it.`
  const newRun = h('button', { class: descend ? 'ghost big' : 'primary big', onclick: onNew, tip: () => `Start again with a new seed. (${descend ? 'N' : 'Enter'})` },
    'New run ', h('kbd', null, descend ? 'N' : 'Enter'))
  const stat = (ico, sys, v, label, name) => h('div', { class: 'end-stat', style: `--s:var(--c-${sys})`, tip: () => name }, h('span', { class: 'end-val' }, icon(ico, 22), h('b', null, v)), h('span', { class: 'lbl' }, label))
  const views = [
    descend && { id: 'deep', name: 'The deep', body: () => [h('p', null, DEEP_TEXT.descend), h('p', { class: 'dim' }, DEEP_TEXT.growth), h('p', { class: 'warn' }, DEEP_TEXT.fall)] },
    lost && { id: 'death', name: 'What felled you', body: () => deathPanel(s, run.battle) },
    s.relics.length > 0 && { id: 'relics', name: 'Relics', body: () => [h('h2', null, 'Relics'), relicList(s.relics, run)] },
    { id: 'retinue', name: descend ? 'Your retinue' : 'Final retinue', body: () => h('div', { class: 'units' }, s.party.slice().sort(fieldOrder).map((u) => unitRow(run, u))) }].filter(Boolean)
  const tabs = h('div', { class: 'tabs end-tabs', role: 'tablist' })
  const panel = h('div', { class: 'panel end-panel', role: 'tabpanel' })
  const view = (id) => {
    hideTip()
    fill(tabs, views.map((v) => h('button', { class: 'tab' + (v.id === id ? ' on' : ''), role: 'tab', 'aria-selected': v.id === id ? 'true' : 'false', 'data-tab': v.id, onclick: () => view(v.id) }, v.name)))
    fill(panel, views.find((v) => v.id === id).body())
    panel.scrollTop = 0
  }
  view(views[0].id)
  const el = h('div', { class: `screen fit end-screen ${lost ? 'lost' : 'won'}` },
    h('div', { class: 'sting' }),
    h('div', { class: 'end-main' },
      h('div', { class: 'end-hero' },
        h('div', { class: 'sigil ' + (won ? 'win' : 'lose') }, icon(won ? 'boss' : 'elite', 46)),
        h('h1', { class: 'logo ' + (won ? 'win' : 'lose') }, descend ? 'VICTORY' : won ? 'CLEARED' : 'DEFEAT'),
        h('p', { class: 'tagline' }, tagline),
        h('div', { class: 'end-stats' },
          stat('stairs', 'monarch', deeper > 0 ? `${cleared}/${n} + ${deeper}` : `${cleared}/${n}`, 'floors', deeper > 0 ? `Floors cleared: ${cleared} of ${n}, and ${deeper} of the deep.` : `Floors cleared: ${cleared} of ${n}.`),
          stat('fight', 'foe', `${s.stats.wins}/${s.stats.fights}`, 'won', `Won ${s.stats.wins} of ${s.stats.fights} battle${s.stats.fights === 1 ? '' : 's'}.`),
          stat('hood', 'essence', s.stats.reaped, 'recruited', `Recruited ${s.stats.reaped} soul${s.stats.reaped === 1 ? '' : 's'}.`),
          stat('bone', 'ossuary', souls(s.party).length, 'souls', `${souls(s.party).length} souls at the end: ${ossuaryCount(run)}`),
          stat('soul', 'essence', s.stats.essence, 'essence', `Essence: ${s.stats.essence} earned, ${s.stats.spent} spent.`),
          stat('reliquary', 'relic', s.relics.length, 'relics', `Relics: ${s.relics.length} (${s.relics.filter(isRunRelic).length} run, ${s.relics.filter((id) => !isRunRelic(id)).length} held).`)),
        h('div', { class: 'title-actions end-actions' },
          descend && h('button', {
            class: 'primary big', onclick: onDescend,
            tip: () => `Go on to floor ${s.floor + 1}, the first of the deep, with your retinue, relics, essence and wounds as they are. The clear is already yours. (Enter)`
          }, 'Descend ', h('kbd', null, 'Enter')),
          newRun),
        h('p', { class: 'dim end-seed' }, `seed ${s.seed}`)),
      h('div', { class: 'end-detail' }, tabs, panel)),
    cornerButtons(onHelp))
  return {
    el,
    key (e) {
      if (descend && e.key === 'Enter') onDescend()
      else if (e.key === 'n' || e.key === 'N' || (!descend && e.key === 'Enter')) onNew()
    }
  }
}

// What felled the Monarch: who, with what, from where (a small board with both marked), and its threat. The
// battle's end replayed the same facts on the board itself (engine.js finish).
function deathPanel (s, battle) {
  const d = deathText(s, battle)
  const m = monarchOf(s)
  const mine = m.slot >= 0 ? deployTile('party', m.slot) : null
  const from = s.death.reason === 'monarch' && s.death.uid !== m.uid && !d.tick ? s.death.from : null
  const walls = new Set(wallTiles(s.camp))
  // On its side as the battle draws it: their side on the left, your camp on the right, the top lane at the top.
  const at = (t) => [DEPTH - 1 - tileY(t) + 0.5, LANES - 1 - tileX(t) + 0.5]
  const cells = []
  for (let x = LANES - 1; x >= 0; x--) {
    for (let y = DEPTH - 1; y >= 0; y--) {
      const t = tileAt(x, y)
      cells.push(h('span', { class: 'db-cell' + (walls.has(t) ? ' wall' : '') + (t === mine ? ' me' : '') + (t === from ? ' killer' : '') },
        walls.has(t) ? h('img', { src: WALL_ART[t % WALL_ART.length], alt: '', draggable: 'false' })
          : t === from ? portrait(s.death.by, 30) : t === mine ? portrait('monarch', 30) : null))
    }
  }
  const zone = (cls, left, cols) => h('span', { class: 'db-zone ' + cls, style: `left:calc(var(--pad) + var(--c) * ${left});width:calc(var(--c) * ${cols})` })
  const strike = mine != null && from != null && (() => {
    const [[x1, y1], [x2, y2]] = [at(from), at(mine)]
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'db-strike')
    svg.setAttribute('viewBox', `0 0 ${DEPTH} ${LANES}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.innerHTML = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" vector-effect="non-scaling-stroke"/>`
    return svg
  })()
  return h('div', { class: 'death' },
    h('div', { class: 'death-text' },
      h('p', { class: 'death-head' }, d.head),
      d.lines.map((l) => h('p', { class: 'dim' }, l)),
      d.threat && h('p', { class: 'death-threat' }, 'Threat: ', h('b', null, d.threat.name), h('span', { class: 'dim' }, ` · ${d.threat.desc}`))),
    mine != null && h('div', {
      class: 'death-board',
      tip: () => from != null ? `The board as the blow landed: their side on the left, your camp on the right. The Monarch stood on ${tileText(mine)}; the killer struck from ${tileText(from)}.`
        : `The board as the battle ended: their side on the left, your camp on the right. The Monarch stood on ${tileText(mine)}.`
    },
    h('div', { class: 'db', style: `--lanes:${LANES};--depth:${DEPTH}` },
      zone('db-foe', 0, ROWS), zone('db-camp', DEPTH - CAMP_ROWS, CAMP_ROWS), cells, strike),
    h('div', { class: 'db-key' },
      h('span', { class: 'k-me' }, 'the Monarch'), from != null && h('span', { class: 'k-killer' }, unitDef(s.death.by).name))))
}

// The camp's walls, as the battle draws them (engine.js WALLS).
const WALL_ART = ['wall-0', 'wall-1', 'wall-2'].map((w) => new URL(`./assets/props/${w}.svg`, import.meta.url).href)

// ── the battle's chrome ──────────────────────────────────────────────────────────────────────────

// The battle keeps the Field's layout, so the board does not move as one fades into the other: a thin strip over the
// board (the room, the turn, the wave counter with the next wave's turn, the essence carried; no clock: redesign.md
// §2.10; sound and How to play at its end, as on the run's bar), and the slim panel beside it (redesign.md §4): the
// Monarch's HP, the selected piece's orders (its acts, each skill with its cooldown pip, Arise for a holder of its
// relic, Undo, Fuse), their synergies and yours (each with the rule it brings, live from the battle), the rules as they
// strike, and at its foot End Turn, always, then pause and skip, which change only how the playback is shown. The
// board takes the rest (stage: engine.js fits it there).
export function battleChrome ({ onHelp = null } = {}) {
  let scene = null
  let st = { paused: false, over: false, essence: 0, wave: 1, waves: 1, turn: 1, next: null, busy: true, panel: null }
  let carried = 0
  const noFocus = (e) => e.preventDefault()
  const btn = (attrs, ...kids) => h('button', { tabindex: '-1', onmousedown: noFocus, ...attrs }, ...kids)
  const pause = btn({ class: 'pause-btn', onclick: () => scene?.togglePause(), tip: () => 'Pause or resume the playback. (Space)' })
  const skip = btn({
    class: 'skip', 'data-sfx': 'none', onclick: () => scene?.skip(),
    tip: () => st.over ? 'On to what comes next. (S)' : 'Hurry the playback: what is playing shows at once. (S)'
  })
  // Names in a line, each kind once, ×n for more: "Grave Ghoul ×2, Bone Chanter"; and each its own: "the Tomb Knight and
  // the Bone Chanter".
  const group = (names) => {
    const m = new Map()
    for (const n of names) m.set(n, (m.get(n) ?? 0) + 1)
    return [...m].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(', ')
  }
  const the = (names) => names.map((n) => `the ${n}`).join(', ').replace(/, (?=[^,]*$)/, ' and ')
  const count = h('b', null, '0')
  // The purse's card (engine.js tally, as the playback has shown the battle): what the foes slain so far carry, the
  // relics' share in, and the purse a win pays it into; what a win adds besides (an elite's bounty, Hollow Court's
  // shadows standing).
  const purseTip = () => {
    const t = scene?.tally()
    return h('div', { class: 'syn-tip' }, h('b', null, 'Essence'), t && [
      h('p', null, h('b', null, `+${t.owed}`), ` from ${t.slain} ${t.slain === 1 ? 'foe' : 'foes'} slain. A win adds it to your `, h('b', null, `${t.bank}`), '.'),
      t.bonus > 0 && h('p', null, `The elite pays +${t.bonus} more on a win.`),
      t.court && h('p', null, `Hollow Court: +${t.court.essence} more if ${t.court.n === 1 ? 'its shadow stands' : `its ${t.court.n} shadows stand`} at the win.`),
      t.gain !== 1 && h('p', { class: 'dim' }, `Your relics make each foe pay ×${+t.gain.toFixed(2)}, counted in.`)])
  }
  const purse = h('span', { class: 'purse', tip: purseTip }, icon('soul', 20), h('span', { class: 'purse-plus' }, '+'), count)
  const title = h('b', { class: 'bt-title' })
  // The panel's words: the Monarch's HP, their synergies and yours, a rule's name a moment as it strikes.
  const hpText = h('b', { class: 'bs-hp-n' })
  const hpFill = h('span')
  const crown = h('div', { class: 'bs-crown' },
    h('div', { class: 'bs-crown-top' }, h('span', { class: 'bs-name' }, icon('crown', 18), 'The Monarch'), hpText),
    h('div', { class: 'bs-hpbar' }, hpFill))
  const theirs = h('div', { class: 'bs-syns foe' })
  const mine = h('div', { class: 'bs-syns' })
  const theirRules = h('div', { class: 'bs-rules foe' })
  const myRules = h('div', { class: 'bs-rules' })
  // A side's synergies (codex.js synergyLabels): each its name and the rule it brings, the rule's text and the pieces it
  // counts (engine.js members) on hover.
  const list = (box, syns, foe = false) => fill(box, syns.length
    ? syns.map((x) => h('span', {
      class: 'bs-syn rule',
      tip: () => h('div', { class: 'syn-tip' }, h('b', null, `${x.name}: ${x.rule}`), ' ', foe ? theirText(x.text) : x.text, x.members && h('p', { class: 'dim' }, `Counted: ${x.members}.`))
    }, `${x.name} · `, h('b', null, x.rule)))
    : h('span', { class: 'dim' }, 'none'))
  const stage = h('div', { class: 'battle-stage' }, h('div', { class: 'pause-veil', 'aria-hidden': 'true' }, h('span', null, icon('pause', 26), 'Paused')))
  // The turn and the wave counter: counts, never a clock. On hover, as the playback has shown the battle: yours still to
  // act (while the board takes orders), the foes standing, and the next wave's size and turn (scouted).
  const turnN = h('b')
  const coming = () => (st.next ? `${st.next.size ? `${st.next.size} more` : 'more'} on turn ${st.next.turn}` : 'no more to come')
  const turnEl = h('span', {
    class: 'turn-n',
    tip: () => {
      const t = scene?.tally()
      const r = st.roster
      return h('div', { class: 'syn-tip' }, h('b', null, `Turn ${st.turn}`),
        st.over ? ' · the battle is over' : [r && ` · ${r.ready.length} of ${r.total} of yours still to act`, t && ` · ${t.foes} ${t.foes === 1 ? 'foe' : 'foes'} standing, ${coming()}`])
    }
  }, icon('turn', 18), turnN)
  const waveT = h('b')
  const waveNext = h('span', { class: 'dim' })
  const waveTurn = h('span', {
    class: 'wave-n',
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, `Wave ${st.wave} of ${st.waves}`), ' ',
      !st.next ? 'No more come.'
        : st.next.size ? ['The next ', kw('wave'), `: ${st.next.size} ${st.next.size === 1 ? 'foe enters' : 'foes enter'} over the far edge as turn ${st.next.turn} begins.`]
          : ['The next ', kw('wave'), ` enters over the far edge as turn ${st.next.turn} begins.`])
  }, icon('wave', 18), waveT, waveNext)
  const selBox = h('div', { class: 'bs-sel' })
  // End Turn's card: what your side does as it is pressed (engine.js endInfo: the sim's own reckoning, on a copy), each
  // piece of yours still to act and what its basic does, in order; then the foes' turn, never what they will do.
  const laid = (list) => list.length > 0 && h('span', { class: 'dim' }, `, ${list.join(', ')}`)
  const endLine = (x) => h('li', null, x.name, x.shadow && h('span', { class: 'dim' }, ' (shadow)'),
    x.hexed ? h('span', { class: 'warn' }, ': Hexed, its act is lost')
      : [' → ', x.hits.length ? x.hits.map((t, i) => [i > 0 && '; ', t.name, t.n > 0 && h('b', { class: 'n-dmg' }, ` −${t.n}`), t.falls && h('b', { class: 'n-falls' }, ', falls'), laid(t.laid)])
        : x.heals.length ? x.heals.map((t, i) => [i > 0 && '; ', t.name, h('b', { class: 'n-heal' }, ` +${t.n}`), laid(t.laid)])
          : [x.target ?? x.act, x.missed && h('span', { class: 'dim' }, ': misses')]],
    x.counter > 0 && h('span', { class: 'n-counter' }, ` · takes −${x.counter} back${x.fell ? ', falls' : ''}`),
    x.lost.length > 0 && h('span', { class: 'n-falls' }, ` · ${x.lost.join(', ')} ${x.lost.length === 1 ? 'falls' : 'fall'}`))
  const endTip = () => {
    const info = scene?.endInfo()
    const head = [h('b', null, 'End Turn'), say(' (E)', '')]
    if (st.over || !info) return h('div', { class: 'syn-tip' }, head, h('p', { class: 'dim' }, st.over ? 'The battle is over.' : 'The turn plays out…'))
    // Those with nothing to do are one line, after the rest, in order.
    const n = info.acts.length
    const idle = info.acts.filter((x) => !x.hexed && !x.act).map((x) => (x.shadow ? `${x.name} (shadow)` : x.name))
    return h('div', { class: 'syn-tip act-tip' }, head,
      n ? [h('p', null, `${n} still to act ${n === 1 ? 'uses its' : 'use their'} basic:`),
        h('ul', { class: 'act-targets' }, info.acts.filter((x) => x.hexed || x.act).map(endLine), idle.length > 0 && h('li', { class: 'dim' }, `Nothing in reach: ${group(idle)}`)),
        h('p', { class: 'dim' }, info.won ? 'The last foe falls: the battle is won.' : 'Then the foes\' turn.')]
        : h('p', null, 'All yours have acted. The foes\' turn next.'))
  }
  const endBtn = btn({ class: 'primary big end-turn', onclick: () => scene?.endTurn(), tip: endTip }, icon('play', 20), ' End Turn')
  const el = h('div', { class: 'battle-screen' },
    h('header', { class: 'battle-top' }, title, turnEl, waveTurn, h('span', { class: 'grow' }), purse,
      h('div', { class: 'top-btns' }, muteButton(),
        onHelp && btn({ class: 'icon-btn', 'aria-label': 'How to play', onclick: onHelp, tip: () => 'How to play: the battle waits while it is open. (H)' }, icon('help', 22)))),
    h('div', { class: 'battle-main' },
      stage,
      h('aside', { class: 'battle-panel' },
        crown,
        selBox,
        h('div', { class: 'bs-syn-box' },
          h('div', { class: 'bs-k foe' }, 'Their synergies'), theirs, theirRules,
          h('div', { class: 'bs-k' }, 'Yours'), mine, myRules),
        h('div', { class: 'bs-controls' }, endBtn, h('div', { class: 'bs-row' }, pause, skip)))))

  // The selected piece's orders (engine.js panel): its name, HP, Move left and the relic it holds; an act a button
  // (the armed one lit), a skill with its cooldown pip (lit: ready; dark: resting a turn), Arise among them for a
  // holder of its relic; Undo while its move may be undone; a Fuse for each recipe whose parts stand beside it (a
  // second press makes it). With none selected, how to begin.
  let fusing = null
  function selection () {
    const p = st.panel
    // With none selected: how many of yours may still act, and which (engine.js roster, read while the board takes orders).
    if (!p) {
      fusing = null
      const r = st.roster
      return fill(selBox, h('p', { class: 'bs-hint dim' }, st.over ? 'The battle is over.' : st.busy || !r ? 'The turn plays out…'
        : r.ready.length ? [`${r.ready.length} of ${r.total} still to act: ${group(r.ready)}. `, say('Click', 'Tap'), ' one, or ', h('b', null, 'End Turn'), '.']
          : [!r.total ? 'None of yours takes orders: ' : r.total === 1 ? 'Yours has acted: ' : `All ${r.total} have acted: `, h('b', null, 'End Turn'), '.']))
    }
    const d = unitDef(p.id)
    const pip = (a) => a.skill && h('span', { class: 'cd-pip' + (a.rest > 0 ? ' rest' : ''), 'aria-label': a.rest > 0 ? 'resting' : 'ready' })
    // An act's card: what it does, with this piece's numbers (codex.js actText); how long it rests, as a skill; and what
    // it would do now to each it can take from here (the sim's preview, the same numbers aiming shows), or who only a
    // move first brings in reach.
    const turns = (n) => `${n} turn${n === 1 ? '' : 's'}`
    const target = (x) => h('li', null, x.self ? 'Itself' : x.name,
      x.by && h('span', { class: 'dim' }, `: the ${x.by} in the way takes it`),
      x.damage > 0 && h('b', { class: 'n-dmg' }, ` −${x.damage}`), x.falls && h('b', { class: 'n-falls' }, ' falls'),
      x.heal > 0 && h('b', { class: 'n-heal' }, ` +${x.heal}`), x.counter > 0 && h('span', { class: 'n-counter' }, ` · takes −${x.counter} back`))
    const actTip = (a) => () => {
      const info = scene?.actInfo(a.id)
      return h('div', { class: 'syn-tip act-tip' },
        h('b', null, a.name),
        a.skill && h('span', { class: 'dim' }, a.rest > 0 ? ` · ready in ${turns(a.rest)}` : a.rests > 0 ? ` · rests ${turns(a.rests)} after use` : ' · ready again next turn'),
        info && actText(info.a, info.st, info),
        !a.can ? (p.acted ? h('p', { class: 'warn' }, 'Already acted this turn.') : p.hexed ? h('p', { class: 'warn' }, 'Hexed: it cannot act this turn.')
          : a.rest > 0 ? null : h('p', { class: 'dim' }, a.heal ? 'No ally in reach needs it.' : 'Not usable now.'))
          : info?.now.length ? [h('p', { class: 'act-k' }, a.arise ? 'Corpses in reach:' : 'In reach now:'), h('ul', { class: 'act-targets' }, info.now.map(target))]
            : info?.later.length ? h('p', null, `Nothing in reach from here. Moving first brings in: ${group(info.later)}.`)
              : h('p', { class: 'dim' }, 'Nothing it can reach this turn.'))
    }
    const acts = p.acts.map((a) => btn({
      class: 'act-btn' + (a.armed ? ' armed' : '') + (a.skill ? ' skill' : '') + (a.arise ? ' arise' : ''), 'aria-pressed': a.armed ? 'true' : 'false',
      'aria-disabled': a.can ? null : 'true', onclick: () => a.can && scene?.arm(a.id), tip: actTip(a)
    }, pip(a), h('span', { class: 'act-name' }, a.name), h('span', { class: 'act-kind' }, a.skill ? 'skill' : 'basic')))
    const fuses = p.fusions.map((f) => btn({
      class: 'fuse-btn' + (fusing === f.order.id ? ' confirm' : ''), 'data-sfx': 'none',
      onclick: () => { if (fusing === f.order.id) { fusing = null; scene?.fuse(f.order) } else { fusing = f.order.id; sfx.play('select'); selection() } },
      tip: () => h('div', { class: 'syn-tip' }, h('b', null, f.name),
        `: takes this ${d.name}${f.parts.length ? `, ${the(f.parts)} beside it` : ''}, ${f.price ?? '?'} essence (you have ${p.purse}). Stands here at full HP as its act.`,
        h('p', { class: 'dim' }, 'Press again to fuse.'))
    }, icon('fuse', 18), fusing === f.order.id ? `Fuse: ${f.name}?` : `Fuse ${f.name}`, f.price != null && h('span', { class: 'price' }, icon('soul', 14), f.price)))
    const armed = p.acts.find((a) => a.armed)
    // The armed act with nothing to take from here: why (it rests, no ally needs it), and who a move brings in reach
    // (engine.js actInfo `later`), or that none would, or that it has no Move left.
    const moves = p.move > p.moved
    const later = !st.busy && armed?.can && !armed.targets ? scene?.actInfo(armed.id)?.later ?? [] : []
    const none = armed?.arise ? 'No corpse' : 'Nothing'
    const stuck = !armed || st.busy || armed.targets ? null
      : !armed.can ? (armed.rest > 0 ? `${armed.name} rests ${turns(armed.rest)} more.` : armed.heal ? `No ally in reach needs ${armed.name}.` : `${armed.name} cannot be used now.`)
        : later.length ? `${none} in reach of ${armed.name} from here: moving brings in ${group(later)}.`
          : moves ? `${none} in reach of ${armed.name} this turn, even after a move.` : `${none} in reach of ${armed.name} from here, and no Move left.`
    const line = p.hexed && !p.acted ? h('span', { class: 'warn' }, 'Hexed: it loses its act.')
      : p.acted ? h('span', { class: 'dim' }, 'Acted this turn.')
        : p.aim ? h('b', { class: 'aim-line' }, armed?.arise ? say('Click it again to raise it.', 'Tap it again to raise it.') : say('Click it again to strike.', 'Tap it again to strike.'),
          p.screen && [' ', h('span', { class: 'screened' }, 'Screened'), `: the ${p.screen} on its `, kw('line', 'line of fire'), ' takes it.'])
          : armed?.arise && armed.targets ? h('span', { class: 'dim' }, [say('Click', 'Tap'), ' a corpse ringed in green, again to raise it.'])
            : h('span', { class: 'dim' }, moves && armed?.targets ? [say('Click', 'Tap'), ' a lit tile to move, a ringed target to aim.']
              : armed?.targets ? [say('Click', 'Tap'), ' a ringed target to aim.']
                : [stuck, stuck && moves && ' ', moves && [say('Click', 'Tap'), ' a lit tile to move.']])
    fill(selBox,
      h('div', { class: 'sel-head' }, portrait(p.id, 38),
        h('div', { class: 'sel-id' },
          h('b', { class: 'sel-name' }, d.name),
          h('div', { class: 'sel-nums' },
            h('span', { class: 'sel-hp' }, hpBar(p.hp, p.maxHp), `${p.hp}/${p.maxHp}`),
            h('span', { class: 'sel-move', tip: () => `Move: ${p.move - p.moved} of ${p.move} tiles left this turn.` }, `Move ${Math.max(0, p.move - p.moved)}/${p.move}`)),
          p.relics.length > 0 && h('div', { class: 'sel-relic' }, p.relics.map((id) => h('span', { class: `rs-relic rt-${relicDef(id).tier}`, tip: () => relicTip(id) }, icon(relicIcon(id), 14), relicDef(id).name))))),
      acts.length > 0 && h('div', { class: 'sel-acts' }, acts),
      (p.undo || fuses.length > 0) && h('div', { class: 'sel-acts' },
        p.undo && btn({ class: 'undo-btn', onclick: () => scene?.undo(), tip: () => `Back to ${tileText(p.from)}, Move ${p.move}/${p.move} again. (U)` }, icon('undo', 18), 'Undo move'),
        fuses),
      h('div', { class: 'sel-line' }, line))
  }

  function render () {
    fill(pause, icon(st.paused ? 'play' : 'pause', 20), st.paused ? ' Resume' : ' Pause')
    fill(skip, icon('skip', 22), st.over ? ' Continue' : ' Skip', h('kbd', null, 'S'))
    el.classList.toggle('paused', st.paused && !st.over)
    el.classList.toggle('over', !!st.over)
    turnN.textContent = `Turn ${st.turn}`
    waveT.textContent = `${st.wave}/${st.waves}`
    waveNext.textContent = st.next ? ` · next on turn ${st.next.turn}` : ''
    waveTurn.hidden = st.waves < 2
    endBtn.setAttribute('aria-disabled', st.busy || st.paused || st.over ? 'true' : 'false')
    el.classList.toggle('busy', !!st.busy)
    selection()
    const e = st.essence ?? 0
    if (Math.round(e) !== Math.round(carried)) roll(count, carried, e, purse)
    carried = e
  }
  render()

  return {
    el,
    // Where the board goes, in viewport px.
    stage: () => stage.getBoundingClientRect(),
    hud: {
      start ({ title: t, monarch }) {
        title.textContent = t
        crown.hidden = !monarch
      },
      // Each side's synergies as the battle holds them now (engine.js changed: a fuse, a fall or a rise may change
      // them mid-battle).
      synergies ({ theirs: th, mine: m }) {
        list(theirs, th, true)
        list(mine, m)
      },
      hp (hp, max) {
        const f = max ? Math.max(0, hp / max) : 0
        hpText.textContent = `${hp} / ${max}`
        hpFill.style.width = `${f * 100}%`
        crown.classList.toggle('low', f < 0.35)
      },
      announce (text, side) {
        const box = side ? myRules : theirRules
        const line = h('div', { class: 'bs-rule' }, text)
        box.append(line)
        while (box.children.length > 2) box.firstChild.remove()
        setTimeout(() => line.classList.add('out'), 1400)
        setTimeout(() => line.remove(), 1900)
      }
    },
    attach (s) { scene = s; s.purseAt = () => count.getBoundingClientRect() },
    update (next) { st = { ...st, ...next }; render() },
    key (e) {
      if (!scene) return
      // E ends the turn, U undoes the selected piece's move, Esc lets go of it (and skips nothing).
      if (e.code === 'KeyE') { e.preventDefault(); return scene.endTurn() }
      if (e.code === 'KeyU') { e.preventDefault(); return scene.undo() }
      if (e.code === 'Escape') { e.preventDefault(); return scene.select(null) }
      if (e.code === 'KeyS') { e.preventDefault(); return scene.skip() }
      if (e.code !== 'Space') return
      scene.togglePause()
      sfx.play('click')
      e.preventDefault()
    }
  }
}

// ── parts ────────────────────────────────────────────────────────────────────────────────────────

// Field first, front to back, then the ossuary.
const fieldOrder = (a, b) => (a.slot < 0) - (b.slot < 0) || a.slot - b.slot || a.uid - b.uid

// A soul in a list (the spoils' release list, the end screen): its name, level and tiers on one line; its HP, and
// that it is you or waits in the ossuary, on the next, then its kin, role and camp row.
function unitRow (run, u, extra = null) {
  const d = unitDef(u.id)
  const more = d.monarch ? 'you' : u.slot < 0 ? 'ossuary' : ''
  const kin = !d.monarch && `${KIN[d.kin].name} ${ROLES[d.role].name}${u.slot >= 0 ? ` · ${campRowLabel(rowOf(u.slot)).toLowerCase()}` : ''}`
  const tiers = (u.tracks ?? []).filter(Boolean)
  return h('div', { class: 'unit' + (u.hp <= 0 ? ' fallen' : '') + (d.monarch ? ' monarch' : ''), tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run), run }) },
    h('span', { class: 'rank-port' + (d.monarch ? ' monarch' : '') + (u.hp <= 0 ? ' fallen' : '') }, portrait(u.id, 40)),
    h('div', { class: 'grow' },
      h('div', { class: 'u-name' }, h('b', null, d.name), !d.monarch && h('span', { class: 'dim' }, ` Lv ${u.lvl}`),
        tiers.length > 0 && h('span', { class: 'path-tag' }, ` tiers ${u.tracks.join('·')}`)),
      h('div', { class: 'line' }, hpBar(u.hp, u.maxHp), h('span', { class: 'dim' }, u.hp > 0 ? `${u.hp}/${u.maxHp}` : 'fallen', more && ` · ${more}`),
        kin && h('span', { class: 'dim u-kin' }, `· ${kin}`))),
    extra)
}

// The relics owned as chips, one per relic in its tier's colour (×N for copies; a trigger relic marked with a
// spark), grouped by tier; hover one for its rule, whether it is a run relic, and who holds it.
function relicList (ids, run = null) {
  if (!ids.length) return h('p', { class: 'dim small' }, 'None yet: the Shops sell them.')
  return h('div', { class: 'relics by-tier' }, relicsByTier(ids, ({ id, n }) =>
    h('span', { class: `relic rt-${relicDef(id).tier}` + (relicDef(id).on ? ' trig' : ''), tip: () => relicTip(id, run) },
      icon(relicIcon(id), 14), relicDef(id).name, n > 1 && h('span', { class: 'relic-n' }, `×${n}`))))
}
