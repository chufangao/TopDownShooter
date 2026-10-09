// The DOM side: title, floor map, prep, reap and end screens, the playback bar under the battle canvas,
// and the parts they share. Screens only read run.state and report input upward; the retinue editor
// sends its actions through act(action), which returns an error message or null. Every control has a
// tooltip saying exactly what it does (rules text lives in codex.js).
import { TUNING } from './tuning.js'
import {
  apply, availableNodes, fieldCap, rosterCap, fielded, inOssuary, currentNode, levelCost, tierCost, souls, isMonarch, monarchOf, monarchCost,
  MONARCH_STATS, faltersAt, DEFAULT_PLAN, isSquare, waits, detachmentOf, promoteLevel, promoteCost, canPromote, canAdvance, nextTier, holds,
  domainCentre, reapedShadows, essenceByWave, canDescend, depthOf, OSSUARY
} from './sim/run.js'
import { RANKS, WIDTH } from './sim/map.js'
import { unitDef, relicDef, campDef, KIN, ROLES, ORDERS, GRADES, keystoneDef, abilityDef } from './content.js'
import {
  COLS, ROWS, CAMP_ROWS, slotAt, rowOf, colOf, activeBonds, isWall, pathsOf, pathDef, baseStats, LANES, DEPTH, tileAt, deployTile, wallTiles, onField,
  distance, tileY, pathsClash, sealedBy, neighbours, isAllyShape, rangeOf, summonsOf
} from './sim/unit.js'
import { h, fill, icon, portrait, prefs } from './dom.js'
import { statsOf } from './sim/unit.js'
import { kw, KEYWORDS } from './keywords.js'
import { sfx } from './sfx.js'
import { monarchNextText } from './codex.js'
// The retinue editor's board: the battle's own, drawn in Phaser (board.js), under a layer that takes the pointer.
import { board, capsTag } from './board.js'
import { showTip, hideTip, pinTip, hold, HOLD, touchy, say } from './dom.js'
// The page is scaled whole (frame.js): what is placed over it by a viewport point goes into the frame's px.
import { frame, toLocal, toLocalRect } from './frame.js'
import { tileX } from './sim/unit.js'
import {
  unitCard, partyMods, roomFoeMods, roomTip, threatMeter, foeSynergyLine, synergyTracker, bondTracker, bondMods, bondNotes, relicTip, ROOM,
  campRowLabel, pathTiers, ROMAN, realmOf, MONARCH_TEXT, deathText, tileText, fieldRule, armyOf, ARMY_TEXT, named, summonCount,
  ORDER_TEXT, planText, whenText, whenTag, isHeld, takesPart, rankNeed,
  GRADE_ICON, RANK_TEXT, clashText, marshalOf, startsFaltering, SECOND_TIERS, keystoneTip, aliasOf, TRIGGER_TEXT,
  foeCountText, waveName, waveWhen, cohortSizes, ENEMY_TEXT, DEEP_TEXT
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
        step('crown', 'monarch', 'Stand', 'You are the ', kw('monarch'), ' and never strike. Beyond your ', kw('domain'), ', souls ', kw('falter'), '.'),
        step('fight', 'foe', 'Scout', say('Hover', 'Tap'), ' a room to see its foes. What they do, you learn by fighting.'),
        step('start', 'orders', 'Arrange', 'Place your ', kw('banner', 'banners'), ' in the camp. The battle then plays out alone.'),
        step('soul', 'essence', 'Reap', 'The slain pay ', kw('essence'), ', and one of them joins you.')),
      h('div', { class: 'title-actions' },
        h('button', { class: 'primary big', onclick: start, tip: () => 'Start a new run with this seed. (Enter)' }, 'Begin the descent ', h('kbd', null, 'Enter')),
        h('button', { class: 'ghost', onclick: onHelp, tip: () => 'Rules, the board, synergies and relics. (H)' }, icon('help', 22), ' How to play'),
        h('label', { class: 'seed', tip: () => 'The same seed always makes the same maps, foes and battles. Share one to play the same run.' }, 'seed', input))),
    cornerButtons(onHelp))
  return { el, key: (e) => { if (e.key === 'Enter') start() } }
}

// Sound and How to play in the top corner of a screen with no top bar (the title, the end): a finger has no M
// or H key.
function cornerButtons (onHelp) {
  return h('div', { class: 'corner-btns' }, muteButton(),
    h('button', { class: 'icon-btn', 'aria-label': 'How to play', onclick: onHelp, tip: () => 'How to play (H)' }, icon('help', 22)))
}

// ── shared chrome ────────────────────────────────────────────────────────────────────────────────

// The run as a row of icons (the Slay the Spire bar): the floors, the purse, the Monarch's HP, a tile per
// relic and keystone held (hover one for what it does), then sound and help. The bar is rebuilt on every
// change: `drawn` keeps what it last showed, so a changed purse rolls to its new value and flashes, and a
// relic or keystone just taken pops in.
// The souls you hold get the same: a count that rolls as one is recruited or released.
const drawn = { run: null, essence: 0, hp: 0, souls: 0, held: new Set() }

function topbar (run, onHelp) {
  const s = run.state
  const fresh = drawn.run !== run
  const n = souls(s.party).length
  if (fresh) Object.assign(drawn, { run, essence: s.essence, hp: monarchOf(s).hp, souls: n, held: new Set([...s.relics, ...s.keystones]) })
  const purse = h('b', null, Math.round(drawn.essence))
  const chip = h('span', { class: 'chip-stat essence', tip: () => `Essence: slain foes pay it. Spend it on your souls and the Monarch. ${s.stats.essence} earned, ${s.stats.spent} spent this run.` },
    icon('soul', 20), purse)
  if (drawn.purse) cancelAnimationFrame(drawn.purse.rolling)
  drawn.purse = purse
  roll(purse, drawn.essence, s.essence, chip, (v) => { drawn.essence = v })
  // Your souls, the field's and the ossuary's, of the most you may hold.
  const count = h('b', null, Math.round(drawn.souls))
  const kept = h('span', {
    class: 'chip-stat souls',
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, `Souls ${n}/${rosterCap(run)}`),
      h('p', null, `${fielded(souls(s.party)).length} on the field, ${inOssuary(souls(s.party)).length} in the `, kw('ossuary'), '. Recruit one of the slain after a win.'))
  }, icon('hood', 20), count, h('span', { class: 'of' }, `/${rosterCap(run)}`))
  if (drawn.count) cancelAnimationFrame(drawn.count.rolling)
  drawn.count = count
  roll(count, drawn.souls, n, kept, (v) => { drawn.souls = v })
  const held = drawn.held
  drawn.held = new Set([...s.relics, ...s.keystones])
  // A relic's tile wears its own glyph; the keystones share one, told apart by a letter pair.
  const tile = (cls, id, name, glyph, tag, tipFn) => h('span', { class: `trinket ${cls}` + (held.has(id) ? '' : ' new'), 'data-id': id, tabindex: '0', 'aria-label': name, tip: tipFn },
    icon(glyph, 22), tag && h('i', { class: 'badge' }, tag))
  const t = s.relics.length + s.keystones.length
  // No brand: the title screen wears the name, and the bar keeps its width for six relics and three keystones.
  return h('header', { class: 'topbar' },
    floorPips(s),
    h('div', { class: 'chips' }, chip, monarchChip(run), kept),
    t > 0 && h('div', { class: 'trinkets' + (t > 6 ? ' crowded' : '') },
      s.relics.map((id) => tile('t-relic' + (relicDef(id).on ? ' trig' : ''), id, relicDef(id).name, relicIcon(id), null, () => relicTip(id))),
      s.keystones.map((id) => tile('t-keystone', id, keystoneDef(id).name, 'keystone', letterPair(keystoneDef(id).name), () => keystoneTip(id, run)))),
    h('div', { class: 'top-btns' },
      muteButton(),
      h('button', { class: 'icon-btn', 'aria-label': 'How to play', onclick: onHelp, tip: () => 'How to play (H)' }, icon('help', 22))))
}

// Each relic's own glyph (dom.js PATHS); one with none falls back to the reliquary's.
const RELIC_ICON = {
  whetstone: 'r-whetstone', grave_banner: 'r-banner', soul_lantern: 'r-lantern', hourglass: 'r-hourglass', heartwood: 'r-heartwood',
  tower_shield: 'r-tower', blood_chalice: 'r-chalice', war_drum: 'r-drum', balm: 'r-balm', tithe_bowl: 'r-bowl', grave_ledger: 'r-ledger',
  rite_candle: 'r-candle', binding_chain: 'r-chain', ossuary_key: 'r-key', iron_oath: 'r-oath', arcane_focus: 'r-focus', hunters_mark: 'r-claw',
  bone_idol: 'r-idol', glass_crown: 'r-glass', grave_bell: 'r-bell', rally_horn: 'r-horn'
}
const relicIcon = (id) => RELIC_ICON[id] ?? 'reliquary'
// A keystone's tag, in capitals as initials read: its words' initials ("One Army" OA), or a one-word name's
// first letter ("Undying" U); small words skipped ("Court of Bone" CB).
const letterPair = (name) => name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('').slice(0, 2)

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
  }, icon('crown', 20), h('b', null, `${m.hp}/${m.maxHp}`))
}

// A dismissible line of numbered steps for a screen; it remembers being closed. Every frame is short (720
// logical px), so it costs the board its room: it starts closed from the second visit on. Closed, it takes no
// room at all; How to play's "Show the tips again" brings every screen's back (codex.js helpOverlay), and a
// screen may offer its own Tips button: el.toggle() shows or hides them, onChange(shown) follows each change.
function guide (key, steps, onChange = null) {
  const el = h('div', { class: 'guide' })
  const seen = prefs.get('seen:' + key) === '1'
  prefs.set('seen:' + key, '1')
  let hidden = false
  const render = () => {
    const pref = prefs.get('guide:' + key)
    hidden = pref === 'off' || (pref !== 'on' && seen)
    fill(el, !hidden && h('div', { class: 'guide-box' },
      h('ol', null, steps.map((s) => h('li', null, s))),
      h('button', { class: 'icon-btn', 'aria-label': 'Hide the tips', onclick: () => { prefs.set('guide:' + key, 'off'); render() }, tip: () => onChange ? 'Hide these tips. Tips brings them back.' : 'Hide these tips. How to play brings them back.' }, icon('close', 18))))
    onChange?.(!hidden)
  }
  el.toggle = () => { prefs.set('guide:' + key, hidden ? 'on' : 'off'); render() }
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

// The whole floor at once, left to right: its ranks across the route panel (the start on the left, the elite
// or the boss on the right), its lanes down it. Places are in % of the panel's floor box (style.css .dag), so
// the floor fits any frame without scrolling.
const pos = (n) => ({ x: n.rank / (RANKS - 1) * 100, y: n.lane / (WIDTH - 1) * 100 })

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
  // Unreachable rooms stay hoverable (scouting ahead is the point), so they are not `disabled`.
  // A mouse's click enters a glowing room. By touch a tap scouts, since entering is for good: a glowing room's
  // first tap chooses it, its tooltip pinned with Enter ▸, and a second tap on it (or Enter ▸) enters; a tap
  // anywhere else lets it go. Any other room's tap only scouts it.
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
    const key = ok ? reach.indexOf(n) + 1 : null
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

  // The floor's box: the edges under the rooms, both in its own % (the svg stretched to it).
  const floor = h('div', { class: 'dag-wrap' }, h('div', { class: 'dag' }, svg, nodes))

  // The note (what just happened) is a toast in the tabs' row, right of the tabs, where it covers nothing: a tap
  // dismisses it, and it fades by itself (a switch of tab drops it). Beside it, Tips brings the tips back once
  // they are closed.
  const toast = note && h('div', { class: 'note', role: 'status', onclick: (e) => e.currentTarget.remove() }, note)
  const tipsBtn = h('button', { class: 'ghost small tips-btn', 'aria-label': 'Show the tips', onclick: () => tips.toggle(), tip: () => 'Show this screen\'s tips again.' }, icon('help', 18), 'Tips')
  const tips = guide('map', [
    [h('b', null, say('Hover', 'Tap')), ' a room to scout it.'],
    say([h('b', null, 'Click'), ' a glowing room (or its number).'], [h('b', null, 'Tap'), ' a glowing room again to enter.']),
    [h('b', null, 'Camp'), say(' (C)', ''), ': arrange and spend ', kw('essence'), '.']], (shown) => { tipsBtn.hidden = shown })
  const extras = h('div', { class: 'tabs-extra' }, toast, tipsBtn)

  // Two tabs: the route, the whole floor across the frame with the retinue's wounds under it; and the camp, to
  // arrange and spend between rooms.
  let tab = 'route'
  const body = h('div', { class: 'map-body' })
  // A switch drops the old tab's tooltip, and any press or drag still held on the camp's board.
  const show = (id) => {
    if (tab !== id && toast) toast.remove()
    tab = id
    hideTip()
    editor.release()
    const tabs = tabBar([
      { id: 'route', name: 'Route', key: 'R', tip: () => 'The floor\'s rooms: scout them and pick the next. (R)' },
      { id: 'camp', name: 'Camp', key: 'C', tip: () => 'Arrange your souls and spend essence before the next room. (C)' }], tab, show, 'screen-tabs')
    tabs.append(extras)
    fill(body, tabs,
      tab === 'route'
        // The floor whole, start to end (the tab and the top bar already name it); the retinue under it, its list
        // in columns, scrolling in its own panel.
        ? h('div', { class: 'route-cols' },
          h('section', { class: 'panel mapcol', 'aria-label': 'The floor' }, floor),
          h('section', { class: 'panel side' },
            h('h2', null, `Your retinue ${souls(s.party).length}/${rosterCap(run)}`),
            h('div', { class: 'units' }, s.party.slice().sort(fieldOrder).map((u) => unitRow(run, u)))))
        : h('div', { class: 'camp-panel' }, editor.el))
    if (tab !== 'route') editor.shown()
  }
  show('route')

  const el = h('div', { class: 'screen fit map-screen' }, bar, tips, body)
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
  // The room's head, Begin in it, stands in the side column over the tray (filled below), so the board takes
  // the screen's whole height.
  const head = h('div', { class: 'prep-head' })
  const editor = retinueEditor({ run, act, facing: node, onChange: refresh, head })
  refresh()
  const canGo = () => fielded(s.party).some((u) => u.hp > 0)
  // Begin lets go of a press or a drag still held on the board first: its release must do nothing.
  const go = () => { if (canGo()) { editor.release(); onFight() } }
  // What the Begin tooltip warns of: no soul to fight for the Monarch, souls that will falter (a held
  // detachment enters beside the Monarch, so it is not counted), or a Move square past the domain.
  const warnings = () => {
    const field = souls(fielded(s.party)).filter((u) => u.hp > 0)
    const out = field.filter((u) => !isHeld(s, u) && startsFaltering(s, u))
    const outM = armyOf(run).summons.filter((u) => startsFaltering(s, u))
    const centre = deployTile('party', domainCentre(s))
    const far = s.detachments.filter((d) => takesPart(s, d) && oneWay(s, d, centre, realmOf(run).domain))
    return [
      !field.length && 'No soul stands on the field: the Monarch fights alone, and it never strikes.',
      field.length > 0 && field.every((u) => isHeld(s, u)) && 'Every soul is held behind the camp: the Monarch starts the battle alone.',
      out.length > 0 && `${out.length} of your souls stand${out.length === 1 ? 's' : ''} outside the domain and will falter (×${TUNING.monarch.falter} damage).`,
      outM.length > 0 && `${outM.length} summon${outM.length === 1 ? ' is' : 's are'} likely to appear outside the domain and falter.`,
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
  // The held detachments, and when each enters.
  const reserveNote = () => {
    const { held } = armyOf(run)
    const ds = [...new Set(held.map((b) => b.det))].map((id) => s.detachments.find((d) => d.id === id))
    return [ds.length > 0 && `Held behind the camp: ${ds.map((d) => {
      const k = held.filter((b) => b.det === d.id).length
      return `detachment ${d.id} (${k}) enters ${whenText(d.plan.when)}`
    }).join('; ')}.`].filter(Boolean)
  }
  // Begin, in the room's head.
  const beginButton = () => h('button', {
    class: 'primary big begin-btn',
    onclick: go,
    tip: () => canGo()
      ? h('div', { class: 'syn-tip' }, h('b', null, 'Begin the battle'), say(' (Enter)', ''), h('p', null, 'It plays out on its own: you cannot move or command anyone until it ends.'),
        warnings().map((w) => h('p', { class: 'warn' }, w)),
        reserveNote().map((n) => h('p', { class: 'dim' }, n)),
        wavesNote() && h('p', { class: 'dim' }, wavesNote()),
        h('p', { class: 'warn' }, `Losing ends the run: the Monarch falling loses at once, and so does a battle still undecided ${TUNING.tick.ceiling * TUNING.tick.ms / 1000} s after the start, or after the last foe entered.`))
      : 'The Monarch has fallen.'
  }, icon('play', 22), ' Begin ', h('kbd', null, 'Enter'))
  const el = h('div', { class: 'screen prep-screen' },
    bar,
    guide('prep', [
      [h('b', null, 'Drag'), ' a soul onto a tile. Keep souls in the ', kw('domain', holds(s, 'crown') ? 'gold domain' : 'green domain'), '.'],
      say([h('b', null, 'Shift-click'), ' souls for a ', kw('detachment'), ' with orders.'],
        [h('b', null, 'Pick'), ' souls in Orders for a ', kw('detachment'), '.']),
      [h('b', null, 'Begin'), '. If the ', kw('monarch'), ' falls, the run ends.']]),
    // The editor fills the rest of the screen: the board, and beside it the room's head and the tray (board.css).
    editor.el)
  // The room in two lines (its rule on hover) beside Begin, the screen's one big press; their synergies; the
  // waves still to come; the threat.
  fill(head,
    h('div', { class: 'ph-top' },
      h('div', { class: 'ph-title', tip: () => h('div', { class: 'syn-tip' }, h('b', null, ROOM[node.type].name), h('p', null, ROOM[node.type].text)) },
        h('span', { class: `room-ico t-${node.type}` }, icon(node.type, 24)),
        h('div', { class: 'ph-id' },
          h('h2', null, ROOM[node.type].name),
          h('div', { class: 'dim' }, `${foeCountText(node)} · Lv ${node.foes[0].lvl}`))),
      beginButton()),
    foeSynergyLine(node.foes, run),
    node.waves?.length > 0 && waveChips(run, node),
    meter)
  return {
    el,
    key (e) {
      if (e.key === 'Enter') go()
      else editor.key(e)
    }
  }
}

// ── reap ─────────────────────────────────────────────────────────────────────────────────────────

// Every offer's key, in the order the cards are shown: 1 to 9 and 0, then Q, W, E… By offer index.
const PICK_KEYS = [...'1234567890QWERTYUIOP']
const offerKeys = (offers) => new Map(offers.slice(0, PICK_KEYS.length).map((o, i) => [i, PICK_KEYS[i]]))
// A rite's offer as the soul card's track (card.css: .nodes, .tnode): the path's tiers I–IV (a second path's
// I–III), the held ones lit, the one offered glowing, a Knight's tier IV badged, a summon tier its summon's face.
// Shown, not pressed.
function tierTrack (u, path, second) {
  const p = pathDef(u.id, path)
  const held = path === u.path ? u.tier : path === u.path2 ? u.tier2 ?? 0 : 0
  const upto = second ? SECOND_TIERS : p.tiers.length
  return h('div', { class: 'nodes offer-track', 'aria-label': `${p.name}: tier ${ROMAN[held]} of ${upto}, ${held} held` },
    Array.from({ length: upto }, (_, k) => [
      k > 0 && h('span', { class: 'tlink' + (k < held ? ' on' : k === held ? ' to' : '') }),
      h('span', { class: 'tnode ' + (k < held ? 'own' : k === held ? 'next' : 'later') }, h('span', { class: 'tnum' }, ROMAN[k]),
        !second && k === 3 && h('span', { class: 'tbadge g1' }, icon('knight', 10)),
        p.tiers[k].summon && summonBadge(p.tiers[k].summon.id))]))
}
// A summon tier's mark on a track's node: the face of what it raises, on the node's corner.
const summonBadge = (id) => h('span', { class: 'tbadge sum', 'aria-label': `raises ${unitDef(id).name}s` }, portrait(id, 16))

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

// A relic or keystone just taken flies from its card to its new tile in the top bar, and the tile pops in as
// it lands; a recruit's face flies to the souls' count.
function flyTrinket (o, rect) {
  const soul = o.type === 'soul'
  const find = () => document.querySelector(soul ? '.topbar .chip-stat.souls' : `.topbar .trinket[data-id="${o.id}"]`)
  const tile = find()
  if (!tile || !rect || still()) return
  if (!soul) tile.classList.add('arriving')
  const glyph = soul ? h('span', { class: 'soul-flyer' }, portrait(o.id, 64))
    : h('span', { class: 'trinket-flyer ' + (o.type === 'relic' ? 'f-relic' : 'f-keystone') }, icon(o.type === 'relic' ? relicIcon(o.id) : 'keystone', 44))
  flyOne(glyph, centre(rect), centre(tile.getBoundingClientRect()), { ms: 680, scale: 0.36, lift: 90 }).then(() => {
    // The bar may have been drawn again meanwhile: land on whatever stands there now.
    const now = find()
    if (!now) return
    now.classList.remove('arriving', 'new', 'gain')
    void now.offsetWidth
    now.classList.add(soul ? 'gain' : 'new')
  })
}

// The room whose cards were last dealt: a release re-shows the same room, and its cards should not deal in
// again. `seen`: the room's groups of offers as dealt (a group taken is gone from the offers, and its step shows
// it done); `on`: the group in view.
let dealt = null

// The offers come in groups, one decision each, in this order: a recruit, a relic, a keystone, a path's tier.
// Taking one offer of a group takes the group off the table.
const GROUPS = ['soul', 'relic', 'keystone', 'tier']
const GROUP_NAME = { soul: 'Recruit', relic: 'Relic', keystone: 'Keystone', tier: 'Path' }

// onDone(index): take offer `index`, or null to move on. The offers are cards to pick, framed in their system's
// colour. A room with more than one group shows them a group at a time behind a row of steps (Recruit · Relic
// · Keystone), each step its group's one line; every offer's key works from any step, and brings its group into
// view. A room of one group shows its cards under one line, no steps.
export function reapScreen ({ run, title, act, onDone, onHelp }) {
  const s = run.state
  const el = h('div', { class: 'screen fit reap-screen' })
  const full = () => souls(s.party).length >= rosterCap(run)
  const blocked = (o) => o.type === 'soul' && (full() ? 'full' : o.cost > s.essence ? 'poor' : null)
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
  const keyTag = (i) => keys.has(i) && h('kbd', null, keys.get(i))
  const keyNote = (i) => keys.has(i) ? ` (${keys.get(i)})` : ''
  const refuse = (i) => {
    sfx.play('poor')
    const c = cards[i]
    if (!c) return
    c.classList.remove('refuse')
    void c.offsetWidth // restart the shake
    c.classList.add('refuse')
  }
  // A pick plays out (the card lifts away), then the run moves on.
  const later = (fn) => (still() ? fn() : setTimeout(fn, 300))
  // Where a card's picture stands now (before it lifts away), for what flies from it.
  const artRect = (i) => (cards[i]?.querySelector('.offer-art') ?? cards[i])?.getBoundingClientRect()
  const take = (i) => {
    if (busy) return
    if (i === null) return onDone(null)
    const o = s.offers[i]
    if (blocked(o)) return refuse(i)
    const rect = artRect(i)
    busy = true
    sfx.play('card')
    el.classList.add('picking')
    cards[i]?.classList.add('taking')
    later(() => {
      onDone(i)
      if (o.type !== 'tier') flyTrinket(o, rect)
    })
  }
  const has = (type) => s.offers.some((o) => o.type === type)
  // Hollow Court: the shadows that stood at the end of the battle just won paid their essence again (if it was
  // fought under the keystone: one taken here reaps nothing of it), in any battle room that ends in spoils (a
  // siege's too). A reliquary's or a rite's spoils follow no battle: run.battle is still the last one's.
  const shades = ['fight', 'elite', 'siege'].includes(currentNode(run).type) ? reapedShadows(run) : []
  const reaped = shades.length > 0 && `Hollow Court: ${shades.length} shadow${shades.length === 1 ? '' : 's'} still stood, and paid ${shades.length === 1 ? 'its' : 'their'} essence again.`
  // Each group's part of the line (and, with more than one group, its step's words).
  const part = {
    soul: () => ['Recruit one for ', kw('essence')],
    relic: () => ['Pick one ', kw('relic'), ', free'],
    keystone: () => ['Pick one ', kw('keystone'), ` · ${s.keystones.length}/${TUNING.keystone.max} held`],
    tier: () => ['Advance one path, free']
  }
  const lede = () => groups().map((g) => part[g]()).flatMap((p, k) => [k ? ' · ' : '', p])
  const ledeTip = () => h('div', { class: 'syn-tip' },
    has('soul') && h('p', null, 'A recruit rises whole at the level it fought at: the field takes it if there is room, else the ', kw('ossuary'), '. One a battle.'),
    has('tier') && h('p', null, 'A rite grants one soul the next tier of a path.'))
  // A battle of waves (a siege's) paid each wave as it fell: what each paid, relics included.
  const node = currentNode(run)
  const paid = node.waves?.length && run.battle ? essenceByWave(run.battle) : null
  const boost = 1 + s.relics.reduce((n, id) => n + (relicDef(id).essence ?? 0), 0)
  const wavePay = paid && h('p', { class: 'wave-pay', tip: () => 'Every foe slain paid essence into one purse; this is what each wave paid of it, relics included.' },
    icon('soul', 18), ' Paid wave by wave: ', paid.map((v, k) => [k ? ' · ' : '', k ? waveName(node, k - 1) : 'Wave 1', ' ', h('b', null, Math.round(v * boost))]))

  function card (o, i) {
    const why = blocked(o)
    const owned = o.type === 'soul' ? s.party.filter((u) => u.id === o.id).length : 0
    const soul = o.type === 'tier' ? s.party.find((u) => u.uid === o.uid) : null
    // A Knight's or Marshal's rite may offer its second path: its tiers held are tier2, three at most.
    const second = soul?.path && o.path !== soul.path
    // Which soul a path offer is for (the retinue may hold several of its kind): its level, rank and where it
    // stands.
    const who = soul && `Level ${soul.lvl}${soul.grade ? ` ${GRADES[soul.grade].name}` : ''}, ${onField(soul) ? tileText(deployTile('party', soul.slot)).replace('your camp, ', '') : 'in the ossuary'}`
    const tip = o.type === 'soul'
      ? () => unitCard({ id: o.id, lvl: o.lvl, path: null, tier: 0, slot: -1 }, {
        mods: partyMods(run),
        notes: [why === 'full' ? 'Your souls are at their most: release one first.' : why === 'poor' ? `You need ${o.cost} essence; you have ${s.essence}.` : `Click to recruit it for ${o.cost} essence. It joins the field if there is room, else the ossuary.`,
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
      h('div', { class: 'offer-tag' }, keyTag(i), h('span', { class: 'tag-word' }, { soul: ' Recruit', relic: ' Relic', tier: ' Path', keystone: ' Keystone' }[o.type])),
      h('div', { class: 'offer-art' }, o.type === 'relic' ? icon(relicIcon(o.id), 64) : o.type === 'keystone' ? icon('keystone', 64) : portrait(o.type === 'soul' ? o.id : soul.id, 104),
        soul && soul.grade > 0 && h('span', { class: `offer-ins g${soul.grade}`, 'aria-label': GRADES[soul.grade].name }, icon(GRADE_ICON[soul.grade], 18)),
        on && h('span', { class: 'trig-tag', tip: () => `Fires each time ${TRIGGER_TEXT[on].when}` }, TRIGGER_TEXT[on].name)),
      // A path tier's name is the path and tier ("Reaver II"); whose it is goes under it.
      h('div', { class: 'offer-name' }, soul ? o.name.replace(`${unitDef(soul.id).name}: `, '') : o.name),
      soul && h('div', { class: 'offer-sub' }, `${unitDef(soul.id).name} · ${who.toLowerCase()}`),
      soul && tierTrack(soul, o.path, second),
      h('div', { class: 'offer-line' }, d ? [`${KIN[d.kin].name} ${ROLES[d.role].name} · `, h('span', { class: 'nowrap' }, 'level ', h('b', { class: 'num' }, o.lvl))] : hiNums(o.desc)),
      h('div', { class: 'offer-price' + (why ? ` ${why}` : '') }, o.type === 'soul' ? [icon('soul', 18), o.cost, why === 'full' && h('span', null, ' · full')] : 'Free'))
  }

  // Your souls, one line at the foot: their count. On the Recruit step with no room for one more, the line says
  // so and opens (a press) a panel over the cards: each soul but the Monarch as in the map's list, with a
  // Release button. `roster`: that panel is open.
  let roster = false
  function strip (recruiting) {
    const n = souls(s.party).length
    const cap = rosterCap(run)
    if (!recruiting || !full()) {
      return h('div', { class: 'ret-line', tip: () => `Your souls: ${n} of ${cap}, on the field and in the ossuary. Each is on the map's Route tab, and in the camp.` },
        icon('hood', 20), h('b', null, 'Souls'), ` ${n}/${cap}`)
    }
    return h('div', { class: 'ret-strip full' + (roster ? ' open' : '') },
      h('button', {
        class: 'ret-toggle', 'aria-expanded': roster ? 'true' : 'false',
        onclick: () => { roster = !roster; hideTip(); render() },
        tip: () => roster ? 'Close the list.' : 'Your souls are at their most: open the list to release one, and make room for a recruit.'
      }, icon('hood', 20), h('b', null, `Full ${n}/${cap}`), h('span', null, ' · Release one to recruit'), h('span', { class: 'ret-caret', 'aria-hidden': 'true' }, roster ? '▾' : '▴')),
      roster && h('div', { class: 'ret-pop', role: 'region', 'aria-label': 'Release a soul' },
        h('div', { class: 'units' }, s.party.filter((u) => !isMonarch(u)).sort(fieldOrder).map((u) => unitRow(run, u, h('button', {
          class: 'danger small',
          onclick: () => { if (!busy) { act({ type: 'release', uid: u.uid }); roster = false; render() } },
          tip: () => `Release ${unitDef(u.id).name} forever, freeing a place among your souls. This can't be undone.`
        }, icon('release', 16), 'Release'))))))
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
          tip: () => done ? `${GROUP_NAME[g]}: done.` : `${GROUP_NAME[g]}: ${n} on the table.${say(' Every card\'s key works from any step. (← →)', '')}`
        },
        h('span', { class: 'rs-num' }, done ? '✓' : k + 1),
        h('span', { class: 'rs-text' }, h('b', null, GROUP_NAME[g]), h('span', { class: 'rs-part' }, done ? 'done' : part[g]())))
      }),
      ledeTip().childElementCount > 0 && h('span', { class: 'lede-more', tabindex: '0', tip: ledeTip }, icon('help', 22)))
  }

  // Cards per row: up to `most` in one, more in rows as even as they come (eight recruits: four and four). As
  // many as the frame's width holds at 168 each (spoils.css), five in a 4:3 frame, six at the most.
  const rowOf = (n, most) => (n <= most ? Math.max(n, 1) : Math.ceil(n / Math.ceil(n / most)))
  const most = () => Math.max(3, Math.min(6, Math.floor((frame.w - 44 + 18) / (168 + 18))))
  function render () {
    cards.length = 0
    // Steps only while more than one group is left on the table: the last one standing shows alone.
    const left = view.seen.filter((g) => groups().includes(g))
    const one = left.length < 2
    const on = one ? null : view.on
    const offers = s.offers.map((o, i) => (!on || o.type === on) && card(o, i))
    // The row deals in from its first card, whatever the offers' indices.
    offers.filter(Boolean).forEach((c, k) => c.style.setProperty('--i', k))
    const next = on && left[left.indexOf(on) + 1]
    const picksN = offers.filter(Boolean).length
    const cols = rowOf(picksN, most())
    // Fitted to the frame: the head (the title and the steps or the lede), the cards in the middle, and the
    // foot: the souls' strip, then the next step and Move on.
    fill(el,
      topbar(run, onHelp),
      h('div', { class: 'reap-main' + (one ? '' : ' stepped') },
        h('div', { class: 'reap-head' },
          h('div', { class: 'reap-title' }, icon(has('soul') ? 'soul' : has('tier') ? 'rite' : has('keystone') && !has('relic') ? 'keystone' : 'reliquary', 34), h('h1', null, title)),
          one
            ? h('p', { class: 'reap-lede' }, lede(), ledeTip().childElementCount > 0 && h('span', { class: 'lede-more', tabindex: '0', tip: ledeTip }, icon('help', 22)))
            : steps()),
        reaped && h('p', { class: 'note-line reap-note' }, reaped),
        wavePay,
        // The middle scrolls when its cards outgrow it (rows of recruits on a short frame); the foot stays.
        h('div', { class: 'reap-body' },
          picksN > 0 && h('div', { class: 'offers picks' + (deal ? ' deal' : '') + (picksN > cols ? ' rows' : ''), style: `--cols:${cols}` }, offers)),
        h('div', { class: 'reap-foot' },
          strip(one ? has('soul') : on === 'soul'),
          h('div', { class: 'reap-actions' },
            next && h('button', { class: 'next-step big', onclick: () => show(next), tip: () => `On to the next step: ${GROUP_NAME[next]}. (→)` }, `${GROUP_NAME[next]} `, h('span', { 'aria-hidden': 'true' }, '→')),
            h('button', { class: 'ghost big move-on', onclick: () => take(null), tip: () => `Leave what is left and go on.${has('soul') ? ' The slain not recruited are lost.' : ''} (S)` }, 'Move on ', h('kbd', null, 'S'))))))
    deal = false
  }

  // A key for an offer out of view brings its group into view first, so its card plays the pick.
  const reveal = (g) => { if (view.on !== g && !busy) show(g) }
  render()
  return {
    el,
    key (e) {
      // Escape is not Move on: a second Escape to close the help must never leave the room and its offers behind.
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      const hit = [...keys].find(([, k]) => e.key.toUpperCase() === k)
      if (hit) { reveal(s.offers[hit[0]].type); take(hit[0]) }
      else if (e.key === 's' || e.key === 'S') take(null)
      else if (e.key === 'ArrowRight') stepTo(1)
      else if (e.key === 'ArrowLeft') stepTo(-1)
    }
  }
}

// ── end ──────────────────────────────────────────────────────────────────────────────────────────

// Three ends. The Sovereign slain (over, 'victory', no death): the run is cleared, and the deep lies below
// (Descend, or stop here with a new run). A fall in the deep after that clear ('victory' with a death): the
// clear stands. A defeat on the way down: as it was. Sound and How to play stand in its top corner, for a finger
// (no M or H key); without an onHelp the button asks for How to play the way the H key does.
export function endScreen ({ run, onNew, onDescend, onHelp }) {
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
  // The run's tally as tiles of icons, each in its system's colour; the full name on the hover.
  const stat = (ico, sys, v, label, name) => h('div', { class: 'end-stat', style: `--s:var(--c-${sys})`, tip: () => name }, h('span', { class: 'end-val' }, icon(ico, 22), h('b', null, v)), h('span', { class: 'lbl' }, label))
  // The rest of the run, one view at a time behind tabs: the deep below (a cleared run), what felled the
  // Monarch (a lost one), the relics and keystones held, the retinue. Each scrolls in its own panel.
  const views = [
    descend && { id: 'deep', name: 'The deep', body: () => [h('p', null, DEEP_TEXT.descend), h('p', { class: 'dim' }, DEEP_TEXT.growth), h('p', { class: 'warn' }, DEEP_TEXT.fall)] },
    lost && { id: 'death', name: lost.reason === 'tick-ceiling' ? 'How it ended' : 'What felled you', body: () => deathPanel(s, run.battle) },
    (s.relics.length > 0 || s.keystones.length > 0) && { id: 'relics', name: 'Relics', body: () => [h('h2', null, 'Relics'), relicList(s.relics), h('h2', null, 'Keystones'), keystoneList(s.keystones)] },
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
  // A short sting as the screen lands: a flash of gold or blood. Its sound already played, once, with the
  // battle that decided the run (its banner, or main.js's onDone for a skipped one). The verdict, the tally and
  // what to do next on the left; the tabs on the right.
  const el = h('div', { class: `screen fit end-screen ${lost ? 'lost' : 'won'}` },
    h('div', { class: 'sting' }),
    h('div', { class: 'end-main' },
      h('div', { class: 'end-hero' },
        h('div', { class: 'sigil ' + (won ? 'win' : 'lose') }, icon(won ? 'boss' : 'elite', 46)),
        h('h1', { class: 'logo ' + (won ? 'win' : 'lose') }, descend ? 'VICTORY' : won ? 'CLEARED' : 'DEFEAT'),
        h('p', { class: 'tagline' }, tagline),
        h('div', { class: 'end-stats' },
          stat('stairs', 'monarch', deeper > 0 ? `${cleared}/${n} + ${deeper}` : `${cleared}/${n}`, 'floors', deeper > 0 ? `Floors cleared: ${cleared} of ${n}, and ${deeper} of the deep.` : `Floors cleared: ${cleared} of ${n}.`),
          stat('fight', 'foe', `${s.stats.wins}/${s.stats.fights}`, 'won', 'Battles won, of those fought.'),
          stat('hood', 'essence', s.stats.reaped, 'recruited', 'Souls recruited.'),
          stat('bone', 'ossuary', souls(s.party).length, 'souls', 'Souls held at the end, on the field and in the ossuary.'),
          stat('soul', 'essence', s.stats.essence, 'essence', 'Essence earned.'),
          stat('reliquary', 'relic', s.relics.length, 'relics', 'Relics claimed.')),
        // What to do next stands right under the tally.
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
    // N starts a new run from any end (How to play says so); Enter descends, or starts one when there is no deep.
    key (e) {
      if (descend && e.key === 'Enter') onDescend()
      else if (e.key === 'n' || e.key === 'N' || (!descend && e.key === 'Enter')) onNew()
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
  // In the end screen's tab of that name: no heading of its own.
  return h('div', { class: 'death' },
    h('div', { class: 'death-text' },
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
export function battleBar ({ onHelp = null } = {}) {
  let scene = null
  let st = { paused: false, speed: 1, seconds: 0, over: false, essence: 0 }
  let carried = 0
  const noFocus = (e) => e.preventDefault()
  const btn = (attrs, ...kids) => h('button', { tabindex: '-1', onmousedown: noFocus, ...attrs }, ...kids)

  const speeds = SPEEDS.map((n) => btn({ class: 'seg', onclick: () => scene?.setSpeed(n), tip: () => `Play at ${n}× speed. (${n})` }, `${n}×`))
  const pause = btn({ class: 'seg pause', onclick: () => scene?.togglePause(), tip: () => 'Pause or resume the playback. (Space)' })
  const skip = btn({ class: 'seg skip', 'data-sfx': 'none', onclick: () => scene?.skip(), tip: () => st.over ? 'On to what comes next. (S or Esc)' : 'Skip to the result. The outcome is already decided. (S or Esc)' })
  const esc = (k = 1) => TUNING.escalation.startTick * k * TUNING.tick.ms / 1000
  const clock = h('span', { class: 'clock', tip: () => `Battle time. ${esc()} s after the start, or after the last entry (a held detachment of yours or a wave of theirs), all damage ramps up so no fight stalls; ${esc(TUNING.escalation.bossMult)} s in the boss's room. Never later than ${esc(TUNING.escalation.bossMult)} s after the last foe entered.` })
  const count = h('b', null, '0')
  const purse = h('span', {
    class: 'purse',
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'Essence'), h('p', null, 'Carried by the foes slain so far, relics included. A won battle pays it into your purse.'))
  }, icon('soul', 22), h('span', { class: 'purse-plus' }, '+'), count)
  const el = h('div', { class: 'battlebar' },
    // Paused: the battle dims under a quiet word (feel.css), over the board and never over this bar.
    h('div', { class: 'pause-veil', 'aria-hidden': 'true' }, h('span', null, icon('pause', 26), 'Paused')),
    h('div', { class: 'legend' },
      purse,
      h('span', { tip: () => 'The bright bar under each unit: its HP.' }, h('i', { class: 'lg hp' }), 'HP'),
      h('span', { tip: () => 'The pale bar under each unit fills by speed toward its next ability, or its cheapest one with nothing in reach. It acts once the bar is full and a target is in reach. Walking never uses the gauge: a unit may step once every ' +
        `${TUNING.board.stepTicks * TUNING.tick.ms / 1000} s, and stops once a foe is in reach (all but a flanker on the hunt).` }, h('i', { class: 'lg gauge' }), 'gauge'),
      h('span', { class: 'dim bar-hint' }, say('Hover', 'Long-press'), ' a unit for live stats.')),
    h('div', { class: 'controls' }, clock, pause, h('div', { class: 'segs' }, speeds), skip, muteButton(),
      // How to play, H on the keyboard (it pauses the battle while open): a button for a finger.
      onHelp && btn({ class: 'icon-btn', 'aria-label': 'How to play', onclick: onHelp, tip: () => 'How to play: the battle waits while it is open. (H)' }, icon('help', 20))))

  function render () {
    SPEEDS.forEach((n, i) => speeds[i].classList.toggle('active', st.speed === n))
    // Pause's key is on its tooltip (Space); Skip, the main action, wears its own.
    fill(pause, icon(st.paused ? 'play' : 'pause', 20), st.paused ? ' Resume' : ' Pause')
    fill(skip, icon('skip', 22), st.over ? ' Continue' : ' Skip', h('kbd', null, 'S'))
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

// The battle's words, in two panels in the bands beside the board (engine.js: the scene's args.hud), so the
// board itself takes the screen's height: on the left their room's title and synergies at the top, yours at
// the bottom; on the right the Monarch's HP, the reserve and the held detachments at the bottom. A rule named
// for the first time shows a moment in its side's panel. The scene tells them where the board stands (place).
export function battleSides () {
  const SIDE = 170 // logical px: the least each band keeps beside the board
  const head = h('div', { class: 'bs-title' })
  const theirs = h('div', { class: 'bs-syns foe' })
  const mine = h('div', { class: 'bs-syns' })
  const theirRules = h('div', { class: 'bs-rules foe' })
  const myRules = h('div', { class: 'bs-rules' })
  const hpText = h('b', { class: 'bs-hp-n' })
  const hpFill = h('span')
  const crown = h('div', { class: 'bs-crown' },
    h('div', { class: 'bs-crown-top' }, h('span', { class: 'bs-name' }, icon('crown', 18), 'The Monarch'), hpText),
    h('div', { class: 'bs-hpbar' }, hpFill))
  const reserve = h('div', { class: 'bs-reserve' })
  const left = h('div', { class: 'battle-side left' },
    h('div', { class: 'bs-top' }, head, h('div', { class: 'bs-k foe' }, 'Their synergies'), theirs, theirRules),
    h('div', { class: 'bs-bottom' }, myRules, h('div', { class: 'bs-k' }, 'Your retinue'), mine))
  const right = h('div', { class: 'battle-side right' }, h('div', { class: 'bs-bottom' }, crown, reserve))
  const el = h('div', { class: 'battle-sides', 'aria-hidden': 'true' }, left, right)
  const list = (box, names) => fill(box, names.length ? names.map((n) => h('span', { class: 'bs-syn' + (n.startsWith('★') ? ' rule' : '') }, n)) : h('span', { class: 'dim' }, 'no synergies'))
  return {
    el,
    side: () => SIDE * frame.k,
    start ({ title, theirs: t, mine: m, monarch }) {
      head.textContent = title
      list(theirs, t)
      list(mine, m)
      crown.hidden = !monarch
    },
    // The board's box in viewport px (its top over their heads, its bottom under your back row's bars) and the
    // bar's top (`floor`): each panel fills its band, its blocks at the board's top and bottom.
    place ({ left: l, top, right: r, bottom, floor }) {
      const a = toLocalRect({ left: l, top, right: r, bottom })
      const f = toLocalRect({ left: 0, top: floor, right: 0, bottom: floor }).top
      const pad = 14
      const t = Math.max(8, a.top)
      const b = Math.min(f - 8, a.bottom)
      left.style.cssText = `left:${pad}px;width:${Math.max(0, a.left - 2 * pad)}px;top:${t}px;height:${Math.max(0, b - t)}px`
      right.style.cssText = `left:${a.right + pad}px;width:${Math.max(0, frame.w - a.right - 2 * pad)}px;top:${t}px;height:${Math.max(0, b - t)}px`
    },
    hp (hp, max) {
      const f = max ? Math.max(0, hp / max) : 0
      hpText.textContent = `${hp} / ${max}`
      hpFill.style.width = `${f * 100}%`
      crown.classList.toggle('low', f < 0.35)
    },
    // [[text, colour]…]: the reserve's next and the held detachments' starts.
    reserve (lines) { fill(reserve, lines.map(([t, c]) => h('div', { style: `color:${c}` }, t))) },
    announce (text, side) {
      const box = side ? myRules : theirRules
      const line = h('div', { class: 'bs-rule' }, text)
      box.append(line)
      while (box.children.length > 3) box.firstChild.remove()
      setTimeout(() => line.classList.add('out'), 1400)
      setTimeout(() => line.remove(), 1900)
    }
  }
}

// ── the retinue editor ───────────────────────────────────────────────────────────────────────────

// The camp and the ossuary beside it, with a tray of tabs, one open at a time: the selected soul (its level,
// paths and rank), the Monarch's panel, the orders, and the bonuses in effect (synergies, bonds, relics,
// keystones). Click a soul (or the Monarch), then a cell or another soul, to move or swap them; click the
// ossuary to put a soul there. The Monarch stands on some open cell always: it never goes to the ossuary, and
// no soul from the ossuary takes its cell. Its domain is outlined on the camp, and on their formation when it
// reaches that far; souls outside it are marked as faltering. A soul whose path raises summons wears a flag
// with how many and one colour (its banner), and its summons stand faint on the tiles the battle will likely
// give them (summonLayout): open ground to the rules, so a soul placed there sends them elsewhere. With
// `facing` (a battle room), its formation is drawn above your camp, past the open ground's row. Orders: shift-
// or ctrl-click souls (or click them in Pick mode) to pick them, form a detachment of them in the orders panel,
// and give it Where and When; a Move's square is the next cell clicked on the board (their ground too). Each
// detachment wears a colour of its own (its tag on its souls, its square and the arrow to it); a held
// detachment (a later start) stands ghosted on its cells and waits behind the camp with its summons to come.
// onChange runs after every action it sends.

const FOE_ROW_LABEL = ['Front', 'Mid', 'Back']

// A banner's colour, by its soul's place among the souls whose paths raise summons (those in the ossuary too,
// so a banner keeps its colour while it waits).
// Banners are an identity, not a system: the hues no system wears (style.css :root), worn as a stripe on a
// bone flag, a ring at a summon's feet and a Marshal's realm.
// Their order is not the detachments' (content.js), so the first banners and the first detachments differ.
const BANNER = ['#f7f7fc', '#5a5cff', '#f020c8', '#fcbdb5', '#1bab62']
export const bannerColours = (party) => new Map(souls(party).filter((u) => summonsOf(u).length).map((u, i) => [u.uid, BANNER[i % BANNER.length]]))

// The Monarch's domain on the camp grid: a square of `r` cells around its cell (`m`: anything with the
// centre's slot, which under Vanguard Crown is the front-most soul's, domainCentre), rows and lanes alike
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
const TRAY = ['soul', 'monarch', 'orders', 'bonuses']
let trayTab = TRAY.includes(prefs.get('tray')) ? prefs.get('tray') : 'soul'

// The soul card's open section (Paths, Rank), kept as the selection moves from soul to soul.
let cardTab = 'paths'

// `head`, `foot`: elements to stand over and under the tray in the side column (prep's room and Begin).
function retinueEditor ({ run, act, facing = null, onChange = null, head = null, foot = null }) {
  const s = run.state
  const el = h('div', { class: 'retinue' })
  let sel = null // { uid } or { slot } (an empty field slot)
  let error = ''
  // Orders: the souls picked for a detachment, in pick order; Pick mode (a plain click on a soul picks it);
  // the detachment whose Move square the next click on the board sets.
  let pick = []
  let picking = false
  let aim = null
  // The detachment whose card the Orders tab shows open (the rest are one row each): see ordersPanel.
  let openDet = null
  // The board (board.js) draws in `stage`, which takes the pointer: each tile's tooltip, by tile ('reserve' for
  // the held souls behind the camp); the tile under the pointer; a press, which turns into a drag past a few
  // pixels; the soul being dragged; a click on a soul in the ossuary to swallow after it was dragged.
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
  // The side column: the head (if any), the tray, the foot (if any). Kept across redraws like the tray.
  const sideEl = h('div', { class: 'side-col' }, head, trayEl, foot)
  let shown = ''
  // Another tab is another subject: an old refusal goes with the last one.
  function openTab (id) {
    trayTab = id
    prefs.set('tray', id)
    error = ''
    render()
  }

  // Every action clears the selection, but a purchase or an order keeps it, so you can go on.
  function send (action) {
    error = said(act(action))
    if (!['level', 'upgrade', 'monarch', 'order', 'disband', 'promote'].includes(action.type)) sel = null
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
  }, label, h('span', { class: 'price' }, icon('soul', 16), cost))

  // The selected soul as a card, framed in its rank's colour: its head and its level-up, always; then its paths
  // or its rank, behind two tabs (the open one kept from soul to soul: cardTab). A promotion ready lights the
  // Rank tab.
  const soulCard = (u) => {
    const ready = canPromote(run, u)
    const sections = [
      { id: 'paths', name: 'Paths', tip: 'Its paths: tiers bought with essence. Taking one rules out the others.' },
      { id: 'rank', name: 'Rank', badge: ready && '!', tip: ready ? 'A promotion is ready: it has the level and you have the essence.' : 'Its rank, and what a promotion takes.' }]
    const open = sections.some((x) => x.id === cardTab) ? cardTab : 'paths'
    const panel = { paths: upgradePanel, rank: rankPanel }
    // Both are built; where the tray has the height for them together (fitCard) they both show, one under the
    // other, each under its name (Rank names itself), and the tabs go.
    return h('div', { class: `uc g${u.grade ?? 0}${popKey(`promote:${u.uid}`)}` },
      soulHead(u),
      levelButton(u),
      h('div', { class: 'uc-tabs', role: 'tablist' }, sections.map((x) => h('button', {
        class: 'uc-tab' + (x.id === open ? ' on' : '') + (x.id === 'rank' && ready ? ' ready' : ''), role: 'tab', 'aria-selected': x.id === open ? 'true' : 'false',
        onclick: () => { cardTab = x.id; render() }, tip: () => x.tip
      }, x.name, x.badge && h('span', { class: 'tab-count' }, x.badge)))),
      sections.map((x) => h('div', { class: 'uc-part' + (x.id === open ? ' on' : '') },
        x.id !== 'rank' && h('div', { class: 'uc-sec uc-part-head' }, x.name),
        panel[x.id](u))))
  }

  // The selected soul's card shows its paths and rank together where the tray's body holds them without
  // scrolling, else behind its two tabs (on every render, and as the tray changes size).
  function fitCard () {
    const card = trayBody.querySelector('.uc')
    if (!card) return
    card.classList.add('all')
    if (trayBody.scrollHeight > trayBody.clientHeight + 1) card.classList.remove('all')
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitCard).observe(trayBody)

  // The card's head: the soul's art (its full card on hover), name, level, kin and role, and under them its
  // HP, ATK, DEF and SPD as it fights now, with its relics', keystones' and bonds' mods (as soulTip). Its rank
  // is the card's frame and the art's insignia, named on the Rank tab.
  function soulHead (u) {
    const d = unitDef(u.id)
    const grade = u.grade ?? 0
    const st = statsOf(u, [...partyMods(run, u), ...bondMods(bondField(), u, aliasOf(run))])
    const maxHp = Math.round(st.hp)
    const hp = Math.max(0, Math.round(u.hp / (u.maxHp || 1) * maxHp))
    const stat = (ico, name, v) => h('span', { class: 'uc-stat s-' + ico, tip: () => name }, icon(ico, 18), h('b', null, v))
    return [h('div', { class: 'uc-head' },
      h('div', { class: 'uc-art', tip: () => soulTip(u, null) }, portrait(u.id, 56, u.hp <= 0),
        h('span', { class: `uc-ins g${grade}` }, icon(GRADE_ICON[grade], 16))),
      h('div', { class: 'uc-id' },
        h('div', { class: 'uc-name' }, d.name),
        h('div', { class: 'uc-sub dim' }, `Lv ${u.lvl} · ${KIN[d.kin].name} ${ROLES[d.role].name}`))),
    h('div', { class: 'uc-stats' },
      stat('hp', u.hp > 0 ? 'HP' : 'Fallen: an altar raises it.', hp < maxHp ? `${hp}/${maxHp}` : maxHp),
      stat('atk', 'Attack', Math.round(st.atk)), stat('def', 'Defence', Math.round(st.def)), stat('spd', 'Speed: how fast its gauge fills', Math.round(st.spd)))]
  }

  // The card's one big buy, under its head whichever tab is open: the next level (what it adds on hover).
  function levelButton (u) {
    if (u.lvl >= TUNING.level.cap) return h('p', { class: 'dim uc-cap' }, `Level ${TUNING.level.cap}: it can rise no further.`)
    const [now, next] = [baseStats(u.id, u.lvl), baseStats(u.id, u.lvl + 1)]
    const gain = [['hp', 'HP'], ['atk', 'ATK'], ['def', 'DEF'], ['spd', 'SPD']].filter(([k]) => next[k] > now[k])
      .map(([k, n]) => `+${+(next[k] - now[k]).toFixed(1)} ${n}`).join(', ') + '.'
    return buyButton([icon('levelup', 22), h('span', { class: 'grow' }, 'Level up ', h('span', { class: 'dim' }, `${u.lvl} → ${u.lvl + 1}`))],
      levelCost(run, u), { type: 'level', uid: u.uid }, gain, ' lvl-up')
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
      i === 3 && h('span', { class: 'tbadge g1' }, icon('knight', 13)),
      p.tiers[i].summon && !why && summonBadge(p.tiers[i].summon.id),
      why && h('span', { class: 'tbadge lock' }, icon('lock', 13)))
    }
    // What a path's summon tier raises, as this soul would raise it: the summon's face, how many (its rank's
    // more on the first summon tier it holds, TUNING.ranks.summons), and whether it raises them yet.
    const summonLine = (p, held, upto, second) => {
      const k = p.tiers.slice(0, upto).findIndex((t) => t.summon)
      if (k < 0) return null
      const { id, count } = p.tiers[k].summon
      const first = !pathsOf(u.id).some((q) => q.id !== p.id && (q.id === u.path || q.id === u.path2) && q.tiers.slice(0, q.id === u.path ? u.tier : u.tier2 ?? 0).some((t) => t.summon))
      const more = first ? TUNING.ranks.summons[grade] ?? 0 : 0
      const now = held > k
      return h('div', {
        class: 'track-sum' + (now ? ' on' : ''),
        tip: () => unitCard({ id, lvl: Math.max(1, Math.round(u.lvl * TUNING.summon.level)), path: null, tier: 0, slot: -1, summoned: true }, {
          live: `${ROMAN[k]}: ${count + more} each battle${more ? ` (${GRADES[grade].name} +${more})` : ''}`, notes: [ARMY_TEXT.summon]
        })
      }, portrait(id, 26), h('span', null, h('b', null, `×${count + more}`), ` ${unitDef(id).name}${count + more === 1 ? '' : 's'}`,
        h('span', { class: 'dim' }, now ? ' each battle' : ` at ${ROMAN[k]}`), more > 0 && h('span', { class: `rank-plus g${grade}` }, ` +${more} ${GRADES[grade].name}`)))
    }
    // A path's track: its name and line (in full on hover), then its nodes joined by links (lit up to the last
    // tier held) with the next tier's price at the end, then, once the path is taken, the next tier's effect;
    // under it, what its summon tier raises.
    const track = (p, held, upto, second) => {
      const clash = second && pathsClash(u.id, u.path, p.id)
      const next = !clash && held < upto && canAdvance(u, p.id) && p.tiers[held]
      const cost = next && tierCost(run, u, p.id)
      return h('div', { class: 'track' + (held ? ' held' : '') + (clash ? ' clash' : '') },
        h('div', { class: 'track-head', tip: () => clash ? shut(p) : p.desc }, h('b', null, p.name), h('span', { class: 'track-desc dim' }, clash ? 'clashes' : p.desc)),
        h('div', { class: 'nodes' }, p.tiers.slice(0, upto).map((_, i) => [i > 0 && h('span', { class: 'tlink' + (i < held ? ' on' : '') }), node(p, i, held, second)]),
          next && h('span', { class: 'tprice' + (s.essence < cost ? ' poor' : '') }, icon('soul', 16), cost)),
        next && held > 0 && h('div', { class: 'track-next', tip: () => next.desc }, h('b', null, `${ROMAN[held]} `), next.desc),
        !clash && summonLine(p, held, upto, second))
    }
    return h('div', { class: 'uc-spend' },
      !first && h('p', { class: 'dim uc-note' }, 'Taking one path rules out the others.'),
      h('div', { class: 'tracks' + (first ? '' : ' choose') }, paths.map((p) => track(p, u.path === p.id ? u.tier : 0, p.tiers.length, false))),
      grade >= 1 && first && others.length > 0 && [
        h('div', { class: 'uc-sec sub' }, 'Second path', !u.path2 && h('span', { class: 'dim' }, ' · I–III, on top')),
        h('div', { class: 'tracks choose' }, others.map((p) => track(p, p.id === u.path2 ? u.tier2 : 0, SECOND_TIERS, true)))],
      first && grade === 0 && h('p', { class: 'dim uc-note' }, 'Tier IV or a second path: promote to ', kw('knight'), '.'),
      either && first && h('p', { class: 'dim uc-note' }, 'A ', kw('knight'), ' takes tier IV or a second path, not both.'))
  }

  // The selected soul's rank, which the card's frame wears, and its promotion: at a level, for essence
  // ("Knight at level 4 · 40 essence"), the level it has against the level it needs as a bar.
  function rankPanel (u) {
    const grade = u.grade ?? 0
    const need = promoteLevel(u)
    const up = need !== null && GRADES[grade + 1]
    const head = h('div', { class: 'uc-sec' }, 'Rank · ', kw(GRADES[grade].id))
    if (!up) return h('div', { class: 'uc-rank' }, head, h('p', { class: 'dim small' }, 'The highest rank.'))
    const cost = promoteCost(run, u)
    const ok = canPromote(run, u)
    const why = u.lvl < need ? `Needs level ${need}; it is level ${u.lvl}.` : s.essence < cost ? poorText(cost) : null
    return h('div', { class: 'uc-rank' },
      head,
      h('div', { class: 'uc-promote' },
        h('button', {
          class: `buy promote g${grade + 1}` + (ok ? '' : ' poor'), 'aria-disabled': ok ? null : 'true',
          onclick: (e) => { if (ok) return commit({ type: 'promote', uid: u.uid }, `promote:${u.uid}`); sfx.play('poor'); shake(e) },
          tip: () => h('div', { class: 'syn-tip' }, h('p', null, h('b', null, `${up.name}: `), KEYWORDS[up.id].line),
            why ? h('p', { class: 'warn' }, why) : h('p', { class: 'dim' }, `${cost} essence.`))
        }, icon(GRADE_ICON[grade + 1], 20), `Promote to ${up.name}`, h('span', { class: 'price' }, icon('soul', 16), cost)),
        h('div', { class: 'feed' + (u.lvl >= need ? ' ok' : ''), tip: () => `${rankNeed(grade)}. It is level ${u.lvl}.` },
          Array.from({ length: need }, (_, k) => h('span', { class: 'feed-gap' + (k < u.lvl ? ' on' : '') })),
          h('span', { class: 'feed-n' }, `Lv ${Math.min(u.lvl, need)}/${need}`))),
      h('p', { class: 'dim small' }, rankNeed(grade)))
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
      h('div', { class: 'mc-ico' }, icon(k, 28)),
      h('div', { class: 'mc-name' }, MONARCH_TEXT[k].name),
      h('div', { class: 'mc-pts' }, s.monarch[k]),
      h('div', { class: 'mc-now' }, MONARCH_TEXT[k].now(run)),
      buyButton('+1', cost, action, `${monarchNextText(run, k)} +${M.hpPerPoint} max HP.`))
    }
    return h('div', { class: 'mc' + (picked ? ' on' : '') },
      h('div', { class: 'uc-head' },
        h('div', { class: 'uc-art', tip: () => unitCard(m, { mods: partyMods(run, m), realm: realmOf(run) }) }, portrait(m.id, 56, m.hp <= 0),
          h('span', { class: 'uc-ins crown' }, icon('crown', 16))),
        h('div', { class: 'uc-id' },
          h('div', { class: 'uc-name' }, 'The Monarch'),
          h('div', { class: 'uc-sub dim' }, m.lvl > 0 && `Lv ${m.lvl} · `, kw('monarch', 'you')),
          h('div', { class: 'mc-hp' }, hpBar(m), h('span', null, `${m.hp}/${m.maxHp}`)))),
      h('div', { class: 'mc-cols' }, MONARCH_STATS.map(col)),
      // What a point gives and costs, short; the rest is on each column's hover.
      h('p', { class: 'dim mc-foot', tip: () => `Each point also gives +${M.hpPerPoint} max HP${holds(s, 'unhealable') ? ' (not healed: Court of Bone)' : ', healed at once'}, and the next costs ${M.costPerPoint} more.` },
        `A point: +${M.hpPerPoint} max HP. Each costs ${M.costPerPoint} more.`))
  }

  // What essence buys a soul next: its level, and its next tier (on its path, else a second path's), each
  // { label, cost } or null; and whether it can be promoted (it has the level, and you the essence).
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
    const rows = [...fielded(souls(s.party)), ...inOssuary(souls(s.party))]
    const chip = (b, ico, what) => b && h('span', {
      class: 'sp-chip' + (affords(b) ? ' ok' : ''), tip: () => affords(b) ? what : poorText(b.cost)
    }, ico && icon(ico, 16), b.label, h('span', { class: 'price' }, icon('soul', 15), b.cost))
    const row = (u) => {
      const d = unitDef(u.id)
      const grade = u.grade ?? 0
      const b = nextBuys(u)
      const any = affords(b.level) || affords(b.tier) || b.promote
      return h('button', {
        class: 'sp-row' + (any ? ' can' : ''),
        onclick: () => { sel = { uid: u.uid }; aim = null; error = ''; render() },
        tip: () => soulTip(u, onField(u) ? null : 'In the ossuary: does not fight.', 'Click to select it: its card opens here.')
      },
      h('span', { class: 'sp-port' }, portrait(u.id, 44, u.hp <= 0), h('span', { class: `sp-ins g${grade}` }, icon(GRADE_ICON[grade], 13))),
      h('span', { class: 'sp-main' },
        h('span', { class: 'sp-id' }, h('b', null, d.name), h('span', { class: 'dim' }, `Lv ${u.lvl}${onField(u) ? '' : ' · ossuary'}`)),
        h('span', { class: 'sp-buys' },
          chip(b.level, 'levelup', `Level ${u.lvl + 1}.`),
          chip(b.tier, null, b.tier?.name ? `${b.tier.name} ${b.tier.label.replace('2nd ', '')}${b.tier.label.startsWith('2nd') ? ', a second path' : ''}.` : 'Its first path tier: choose the path on its card.'),
          b.promote && h('span', { class: `sp-chip promote g${grade + 1} ok`, tip: () => `Ready to promote to ${GRADES[grade + 1].name}: ${promoteCost(run, u)} essence.` },
            icon(GRADE_ICON[grade + 1], 16), 'Promote', h('span', { class: 'price' }, icon('soul', 15), promoteCost(run, u))))))
    }
    return h('div', { class: 'spend-panel' },
      h('div', { class: 'sp-head' },
        h('span', { class: 'sp-ess', tip: () => 'Essence: slain foes pay it. Spend it on levels, path tiers and the Monarch. Select a soul (here or on the board) for its card.' }, icon('soul', 24), h('b', null, s.essence)),
        h('span', { class: 'dim' }, 'to spend: pick a soul')),
      s.essence >= mCost && h('button', {
        class: 'sp-nudge', onclick: () => openTab('monarch'),
        tip: () => 'Dominion widens the domain, Command fields a soul more, Will makes Arise raise more, and sooner.'
      }, icon('crown', 20), h('span', { class: 'grow' }, 'Monarch point in reach'), h('span', { class: 'price' }, icon('soul', 16), mCost)),
      rows.length
        ? h('div', { class: 'sp-list' }, rows.map(row))
        : h('p', { class: 'dim small' }, 'No souls yet: recruit after a win.'))
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
    const seg = (on, ico, label, onclick, t) => h('button', { class: 'seg' + (on ? ' active' : ''), onclick, tip: t }, icon(ico, 18), h('span', null, label))
    const WHERE_ICON = { hunt: 'o-hunt', stay: 'o-stay', move: 'o-move' }
    const WHEN_ICON = { once: 'w-once', time: 'w-time', struck: 'w-struck', wave: 'w-wave', falls: 'w-falls' }
    const WHEN_WORD = { once: 'Now', struck: 'Struck', wave: 'Wave', falls: 'Falls' }
    const dom = realmOf(run).domain
    const mTile = deployTile('party', domainCentre(s)) // the domain's centre: the Monarch's, but under Vanguard Crown
    const step = 100 // ticks: 5 s
    const tMax = Math.floor((TUNING.tick.ceiling - 1) / step) * step
    const secs = (t) => `${t * TUNING.tick.ms / 1000} s`

    // A detachment's card folded to one row: its tag, its plan in short (where, when), its souls; a press opens
    // it (one card is open at a time).
    function folded (d) {
      const p = d.plan
      return h('button', {
        class: 'det det-fold', style: `--d:${d.color}`, onclick: () => { openDet = d.id; aim = null; error = ''; render() },
        tip: () => `Detachment ${d.id}: ${planText(p)}. Open its card to change the plan.`
      },
      h('span', { class: 'det-sw' }, d.id),
      h('span', { class: 'det-plan' }, icon(WHERE_ICON[p.where], 18), ORDERS.where[p.where].name, icon(WHEN_ICON[p.when.at], 18), p.when.at === 'time' ? secs(p.when.t) : WHEN_WORD[p.when.at]),
      h('span', { class: 'det-ports' }, d.members.map(soulOf).map((u) => portrait(u.id, 30))),
      h('span', { class: 'det-open', 'aria-hidden': 'true' }))
    }

    function card (d) {
      const p = d.plan
      const members = d.members.map(soulOf)
      const n = members.filter((u) => onField(u) && u.hp > 0).reduce((k, u) => k + summonCount(u), 0)
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
          h('button', { class: 'ghost det-x', onclick: () => send({ type: 'disband', id: d.id }), tip: () => `Disband: its souls Hunt, at once.` }, icon('close', 16), 'Disband')),
        // Its souls (a press selects one), the summons they raise; then what the selection or the picks can do here.
        h('div', { class: 'det-souls' },
          members.map((u) => h('button', {
            class: 'det-soul' + (picked === u ? ' on' : '') + (onField(u) ? '' : ' benched'), 'aria-label': name(u),
            onclick: () => { sel = { uid: u.uid }; aim = null; error = ''; render() },
            tip: () => `${name(u)}${onField(u) ? '' : ', in the ossuary: it keeps its place here but does not fight'}${summonCount(u) && onField(u) ? `, raising ${summonsOf(u).map((x) => named(x.id, x.count)).join(' and ')}` : ''}. Click to select it.`
          }, portrait(u.id, 34))),
          n > 0 && h('span', { class: 'dim' }, `+${n} summoned`)),
        (one || pick.length > 0) && h('div', { class: 'det-acts' },
          one && mine === d && h('button', { class: 'link', onclick: () => leaveDet(d, one), tip: () => `Take ${name(one)} out of detachment ${d.id}: it Hunts, at once. The others on the field keep the plan.${benchedOut(d)}` }, `Take ${name(one)} out`),
          one && mine !== d && !pick.length && h('button', { class: 'link', onclick: () => join(d, [one.uid]), tip: () => `${name(one)} joins detachment ${d.id} and takes its plan${mine ? `, leaving detachment ${mine.id}` : ''}.${benchedOut(d)}` }, `+ ${name(one)}`),
          pick.length > 0 && h('button', { class: 'link', onclick: () => join(d, pick), tip: () => `The picked souls join detachment ${d.id} and take its plan, leaving any other.${benchedOut(d)}` }, `+ ${pick.length} picked`)),
        // Where and When, each a row of icon-over-word buttons (what each means on hover).
        h('div', { class: 'det-row' },
          h('div', { class: 'segs icon-segs' }, Object.keys(ORDERS.where).map((k) => seg(p.where === k || (k === 'move' && aim === d.id), WHERE_ICON[k], ORDERS.where[k].name,
            () => {
              error = ''
              if (k !== 'move') { aim = null; return setPlan(d, { where: k }) }
              aim = aim === d.id ? null : d.id
              render()
            }, whereTip(k))))),
        aim === d.id && h('p', { class: 'aim-hint small' }, icon('o-move', 16), say(' Click a cell for its square. Esc cancels.', ' Tap a cell for its square; Move again cancels.')),
        p.where === 'move' && aim !== d.id && h('p', { class: 'det-note small' + (far ? ' warn' : ' dim') }, far
          ? ['One-way: its square is ', distance(p.square, mTile), ` tiles out, past the `, kw('domain'), ` (${dom}); it will `, kw('falter'), '.']
          : out ? ['Past the ', kw('domain'), ', but a ', kw('marshal'), ' keeps its plan there.']
            : `Square: ${tileText(p.square)}.`),
        h('div', { class: 'det-row' },
          h('div', { class: 'segs icon-segs' }, Object.entries(ORDERS.when).map(([k, o]) => seg(p.when.at === k, WHEN_ICON[k], k === 'time' ? secs(t) : WHEN_WORD[k],
            () => { error = ''; setPlan(d, { when: k === 'time' ? { at: k, t } : { at: k } }) },
            tip(o.name, o.desc, k === 'wave' && ORDER_TEXT.wave, k !== 'once' && KEYWORDS.held.line))))),
        p.when.at === 'time' && h('div', { class: 'det-time', tip: () => 'Seconds into the battle.' },
          icon('w-time', 18),
          h('button', { class: 'step-btn', 'aria-label': '5 s sooner', 'aria-disabled': t <= step ? 'true' : null, onclick: () => { if (t > step) setT(t - step) }, tip: () => t > step ? '5 s sooner.' : `${secs(step)} at the soonest.` }, '−'),
          h('b', null, secs(t)),
          h('button', { class: 'step-btn', 'aria-label': '5 s later', 'aria-disabled': t >= tMax ? 'true' : null, onclick: () => { if (t < tMax) setT(t + step) }, tip: () => t < tMax ? '5 s later.' : `The latest start: a battle still undecided ${secs(TUNING.tick.ceiling)} after its last foe entered is lost.` }, '+')))
    }

    // One card open at a time: the one aiming, else the selected soul's, else the last opened, else the first.
    const ds = s.detachments.slice().sort((a, b) => a.id - b.id)
    const opened = ds.find((d) => d.id === aim) ?? (mine && ds.includes(mine) ? mine : null) ?? ds.find((d) => d.id === openDet) ?? ds[0]
    // The head: the count (the rules on hover) and Pick; under it, the picks and what to do with them, or the
    // selected soul's own detachment to start.
    return h('div', { class: 'orders-panel' },
      h('div', { class: 'pick-row' },
        h('span', { class: 'ord-title', tip: tip('Orders', `Up to ${cap} detachments, each one plan: where it goes, and when it starts. A soul in none Hunts at once.`, 'Outside the domain a plan is dropped; a Marshal keeps its own.') },
          icon('o-move', 20), 'Orders ', h('span', { class: 'ord-count' }, `${s.detachments.length}/${cap}`)),
        h('span', { class: 'grow' }),
        h('button', {
          class: 'pick-btn' + (picking ? ' on' : ''),
          onclick: () => { picking = !picking; aim = null; error = ''; render() },
          tip: () => picking ? 'Stop picking: a click selects again.' : say('While on, a click on a soul on the field picks or drops it (Shift- or Ctrl-click always does).', 'While on, a tap on a soul on the field picks or drops it.')
        }, picking ? 'Done' : 'Pick')),
      (pick.length > 0 || (one && !mine)) && h('div', { class: 'pick-row' },
        pick.length
          ? [h('span', { class: 'picked' }, pick.map((uid) => portrait(soulOf(uid).id, 30))),
              h('span', { class: 'grow' }),
              h('button', { class: 'link', onclick: () => { unpick(); error = ''; render() }, tip: () => 'Drop the picked souls.' }, 'Clear'),
              h('button', { class: 'primary-ord', onclick: () => form(pick), tip: () => `${pick.map((uid) => name(soulOf(uid))).join(', ')}: a new detachment, Hunting at once until you plan it. Each leaves any other.` }, `Form (${pick.length})`)]
          : h('button', { class: 'new-det', onclick: () => form([one.uid]), tip: () => `${name(one)} alone: Hunts at once until you plan it.` }, `New: ${name(one)}`)),
      picking && !pick.length && h('p', { class: 'dim' }, say('Click souls to pick.', 'Tap souls to pick.')),
      ds.length ? ds.map((d) => d === opened ? card(d) : folded(d))
        : h('p', { class: 'dim' }, 'None: every soul ', kw('hunt', 'Hunts'), ', at once. ', say('Shift-click souls to pick.', 'Tap Pick, then souls.')))
  }

  // A shift-, ctrl- or cmd-click (or any click in Pick mode) picks souls for a detachment.
  const picks = (e) => picking || !!(e?.shiftKey || e?.ctrlKey || e?.metaKey)

  // A click on a cell: a soul there is selected (to inspect it), an empty cell takes the selected soul. `swap`
  // (a drop, or X on the keyboard) moves the selected soul onto the soul there instead: the two trade places.
  function clickSlot (slot, e, swap = false) {
    if (aim != null) return setSquare(deployTile('party', slot))
    const o = s.party.find((u) => u.slot === slot)
    if (picks(e)) {
      const who = o ?? summonerOf(summonAt(deployTile('party', slot)) ?? {})
      return who ? togglePick(who) : refuse('Nobody stands here to pick: pick souls on the field (a summon\'s tile picks its soul).')
    }
    const picked = selected()
    // A summon's tile is open ground; with no soul selected, clicking it picks up the soul that raises it.
    const m = !o && !picked && summonAt(deployTile('party', slot))
    if (m) sel = { uid: m.summoner }
    else if (!sel) sel = o ? { uid: o.uid } : { slot }
    else if (sel.uid != null) {
      if (o?.uid === sel.uid) sel = null
      else if (o && !swap) sel = { uid: o.uid }
      else if (o && isMonarch(o) && picked.slot < 0) return refuse(`The Monarch never goes to the ossuary: place ${unitDef(picked.id).name} on another cell.`)
      else if (!o && picked.slot < 0 && full()) return refuse(fullText(picked))
      else return send({ type: 'place', uid: sel.uid, slot })
    } else if (o) {
      if (!swap) sel = { uid: o.uid }
      else return send({ type: 'place', uid: o.uid, slot: sel.slot })
    } else sel = sel.slot === slot ? null : { slot }
    error = ''
    render()
  }

  // A click on a soul in the ossuary selects it, or places it in a selected empty cell; `swap` (a drop on it)
  // trades it for the selected soul on the field.
  function clickBench (u, e, swap = false) {
    if (aim != null) return refuse(say('The ossuary is not on the board: click a cell of the board for the square, or press Esc.', 'The ossuary is not on the board: tap a cell of the board for the square, or Move again to cancel.'))
    if (picks(e)) return togglePick(u)
    const picked = selected()
    if (swap && picked && isMonarch(picked)) return refuse('The Monarch never goes to the ossuary. Pick a soul to swap with this one.')
    if (swap && picked && picked !== u && picked.slot >= 0) return send({ type: 'place', uid: u.uid, slot: picked.slot })
    if (sel?.slot != null) return full() ? refuse(fullText(u)) : send({ type: 'place', uid: u.uid, slot: sel.slot })
    sel = picked === u ? null : { uid: u.uid }
    error = ''
    render()
  }

  // A click on the ossuary's empty space puts the selected soul there.
  function clickBenchSpace () {
    const picked = selected()
    if (picked && isMonarch(picked)) return refuse('The Monarch never goes to the ossuary: it stands in every battle.')
    if (picked && picked.slot >= 0) send({ type: 'place', uid: picked.uid, slot: OSSUARY })
  }

  const selected = () => sel?.uid != null && s.party.find((x) => x.uid === sel.uid)
  // The soul a click elsewhere would move: the selected one.
  const mover = selected
  const benchable = (u) => u && u.slot >= 0 && !isMonarch(u)
  // A soul leaves the ossuary for an open cell only while the field has room; it can always swap with a soul.
  const full = () => fielded(souls(s.party)).length >= fieldCap(run)
  const fullText = (u) => `The field is full (${fieldCap(run)} souls): swap ${unitDef(u.id).name} with a soul on the field, put one in the ossuary first, or buy Command.`
  // Who stands on the field from the start (not held), for the bonds: summons take none at the start.
  const bondField = () => fielded(s.party).filter((x) => !isHeld(s, x))
  // The summon likely raised on a tile (summonLayout, as the board last drew it), and its soul.
  let summonsNow = []
  const summonAt = (tile) => summonsNow.find((x) => x.tile === tile) ?? null
  const summonerOf = (m) => s.party.find((u) => u.uid === m.summoner)

  // ── orders ──

  const cap = TUNING.army.detachments
  const soulOf = (uid) => s.party.find((u) => u.uid === uid)
  // A soul still in the retinue and on the field: the only kind the rules take orders for.
  const fieldedUid = (uid) => { const u = soulOf(uid); return !!u && onField(u) }
  // Picks put in the ossuary or released since they were picked drop out (run before every redraw).
  const prunePicks = () => { if (pick.some((uid) => !fieldedUid(uid))) pick = pick.filter(fieldedUid) }
  const detOf = (u) => detachmentOf(s, u.uid)
  const inOrder = (uids) => s.party.filter((u) => uids.includes(u.uid)).map((u) => u.uid)
  // The detachments that stand once `uids` leave theirs (one left empty is gone): the cap counts these.
  const kept = (uids) => s.detachments.filter((d) => d.members.some((uid) => !uids.includes(uid)))

  function togglePick (u) {
    if (isMonarch(u)) return refuse('The Monarch takes no orders: it never takes a step. Pick souls on the field.')
    if (!onField(u)) return refuse(`${unitDef(u.id).name} is in the ossuary, and a soul there takes no orders: field it first.`)
    pick = pick.includes(u.uid) ? pick.filter((x) => x !== u.uid) : [...pick, u.uid]
    error = ''
    render()
  }

  const unpick = () => { pick = []; picking = false }

  // A new detachment of `uids` (each taken out of any other), with `plan`. The cap and a detachment of
  // exactly these souls are refused here, in words.
  function form (uids, plan = DEFAULT_PLAN) {
    uids = inOrder(uids.filter(fieldedUid))
    if (!uids.length) { unpick(); return refuse('Nobody picked stands on the field: a soul in the ossuary takes no orders.') }
    const same = s.detachments.find((d) => d.members.length === uids.length && uids.every((uid) => d.members.includes(uid)))
    if (same) return refuse(`They already are detachment ${same.id}.`)
    if (kept(uids).length >= cap) return refuse(`At most ${cap} detachments: disband one first, or add these souls to one.`)
    unpick()
    send({ type: 'order', uids, plan })
  }

  // Souls join detachment d, keeping its plan: d is disbanded and formed anew of its souls on the field and
  // them (its colour follows its new id, the lowest free). The rules order only souls on the field, so a soul
  // of d in the ossuary leaves it (the tooltips say so); disbanding d first keeps it from lingering, held by that
  // soul alone, beside a second detachment on the same plan, and from counting toward the cap.
  function join (d, uids) {
    // A pick put in the ossuary (or released) since it was picked takes no orders: it is dropped, and if no one
    // is left to join, refused in words before anything is sent.
    const gone = uids.filter((uid) => !fieldedUid(uid))
    pick = pick.filter((uid) => !gone.includes(uid))
    const fresh = uids.filter((uid) => !gone.includes(uid) && !d.members.includes(uid))
    if (!fresh.length) {
      const names = gone.map(soulOf).filter(Boolean).map((u) => unitDef(u.id).name)
      return refuse(names.length ? `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} in the ossuary now, and a soul there takes no orders: field ${names.length === 1 ? 'it' : 'them'} first.`
        : `Nobody new to add to detachment ${d.id}.`)
    }
    uids = inOrder([...d.members.filter((uid) => onField(soulOf(uid))), ...fresh])
    const same = s.detachments.find((x) => x !== d && x.members.length === uids.length && uids.every((uid) => x.members.includes(uid)))
    if (same) return refuse(`They already are detachment ${same.id}.`)
    if (kept(uids).filter((x) => x !== d).length >= cap) return refuse(`At most ${cap} detachments: disband one first.`)
    sendAll([{ type: 'disband', id: d.id }, { type: 'order', uids, plan: d.plan }], unpick)
  }

  // The souls of d in the ossuary, who leave it whenever it is formed anew (join, leaveDet): words for a tooltip.
  const benchedOut = (d) => {
    const out = d.members.map(soulOf).filter((u) => !onField(u))
    return out.length ? ` ${out.map((u) => unitDef(u.id).name).join(' and ')}, in the ossuary, leave${out.length === 1 ? 's' : ''} it too.` : ''
  }

  // A soul leaves its detachment: the rest on the field are formed anew with its plan (its souls in the ossuary
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
    if (!d) return [onField(u) && `No orders: it Hunts, at once. ${say('Shift- or Ctrl-click', 'Use Pick in Orders')} to pick it for a detachment.`]
    return [`Detachment ${d.id}: ${planText(d.plan)}.`,
      !onField(u) && 'In the ossuary: it keeps its place in the detachment, but does not fight.',
      onField(u) && waits(d) && `Held: it waits behind the camp, off the board, and enters beside the Monarch ${whenText(d.plan.when)}${summonCount(u) ? ', its summons with it' : ''}. Its cell stays its own, but it takes its bonds where it enters.`,
      onField(u) && !waits(d) && d.plan.where !== 'hunt' && startsFaltering(s, u) && 'It stands outside the domain, so it falters from the start and drops its plan: only Hunt is heeded out there.']
  }

  // What clicking here would do, given the current selection (`summon`: the summon likely raised on it). In
  // the order clickSlot decides.
  function slotHint (slot, o, summon = null) {
    if (o && selected() === o) return 'Click again to deselect.'
    const picked = mover()
    if (picked && o && isMonarch(o) && picked.slot < 0) return `Click to select it. The Monarch never goes to the ossuary, so ${unitDef(picked.id).name} cannot take its cell.`
    if (picked && o) return `Click to select it. Drag ${unitDef(picked.id).name} onto it to swap them.`
    if (picked && !o && picked.slot < 0 && full()) return fullText(picked)
    if (!o && summon) {
      if (!picked) return `Click to select its soul, ${unitDef(summonerOf(summon).id).name}.`
      return `Click to move ${unitDef(picked.id).name} here: the ${unitDef(summon.id).name} appears on another tile beside its soul.`
    }
    if (picked && isMonarch(picked) && !o && sealedBy(s.camp, slot).length) return `Click to move the Monarch here. ${sealText(sealedBy(s.camp, slot).length)}`
    if (picked) return `Click to move ${unitDef(picked.id).name} here.`
    return o ? 'Click to select it. Drag it to move it, or onto a soul to swap them.' : null
  }

  // Inside the domain or not, in words, for a cell's tooltip; and inside a Marshal's own, for its banner.
  // Under Vanguard Crown the domain centres on the front-most soul, not the Monarch.
  const crowned = holds(s, 'crown')
  const whose = crowned ? 'the domain (on your front-most soul, Vanguard Crown)' : "the Monarch's domain"
  const domainLine = (slot, u) => {
    if (isMonarch(u ?? {})) {
      const sealed = sealedBy(s.camp, slot).length
      return (crowned ? `Vanguard Crown: its domain (${realmOf(run).domain} tiles) centres on your front-most soul, not here. The Monarch itself never falters.` : `Its domain reaches ${realmOf(run).domain} tiles from here.`) +
        (sealed ? ` ${sealText(sealed)}` : '')
    }
    // A summon by where it will likely appear (it may stand past the camp).
    if (u?.summoned) {
      return startsFaltering(s, u) ? `Outside ${whose}: it falters, dealing ×${TUNING.monarch.falter} damage while it stands out here.`
        : `Inside ${whose}${faltersAt(s, slot) ? ' or its Marshal\'s' : ''}: it fights at full strength.`
    }
    const who = 'a soul'
    const centred = crowned && slot === domainCentre(s) && u
      ? ` Vanguard Crown: the domain (${realmOf(run).domain} tiles) centres here as the battle begins, on your front-most soul, and moves with the front from then on.` : ''
    if (!faltersAt(s, slot)) return `Inside ${whose}: ${who} here fights at full strength.${centred}`
    const m = u && marshalOf(s, u)
    if (u && !startsFaltering(s, u)) {
      return m === u ? `Outside ${whose}, but a Marshal never falters: it carries a domain of its own (${TUNING.ranks.domain} tiles) wherever it goes.${centred}`
        : `Outside ${whose}, but within ${unitDef(m.id).name}'s own (${TUNING.ranks.domain} tiles): ${who} of its banner fights at full strength and keeps its orders while it stays there.`
    }
    const near = marshalsOn().filter((x) => x !== m && campDistance(x.slot, slot) <= TUNING.ranks.domain)
    return `Outside ${whose}: ${who} here falters, dealing ×${TUNING.monarch.falter} damage while it stands out here.` +
      (near.length ? ` A Marshal's own domain reaches here (${near.map((x) => unitDef(x.id).name).join(', ')}): ${u ? 'only its own summons' : 'its banner'} would not falter.` : '')
  }
  // The Marshals standing on the field, whose own domains the camp outlines.
  const marshalsOn = () => souls(fielded(s.party)).filter((u) => marshalOf(s, u) === u && !isHeld(s, u))

  // A soul's one live line (its card's third): fallen, in the ossuary, held, faltering or not, its orders.
  // `lead` goes first when given (what a click would do with a soul selected, a melee blocked).
  function soulLive (u, lead = null) {
    if (lead) return lead
    if (u.hp <= 0) return 'Fallen: an altar raises it'
    if (!onField(u)) return 'In the ossuary: it does not fight'
    if (isMonarch(u)) return `Domain ${realmOf(run).domain} · if it falls, the run ends`
    const d = detOf(u)
    if (d && waits(d)) return `Held: ${d.id} enters ${whenText(d.plan.when)}`
    const m = marshalOf(s, u)
    const where = startsFaltering(s, u) ? `Falters ×${TUNING.monarch.falter}: outside the domain`
      : faltersAt(s, u.slot) && m ? (m === u ? 'Marshal: never falters' : `In ${unitDef(m.id).name}'s domain`) : 'In the domain'
    return `${where} · ${d ? `${d.id}: ${ORDERS.where[d.plan.where].name}` : 'Hunts'}`
  }

  function soulTip (u, where, extra, lead = null) {
    const all = bondField()
    const alias = aliasOf(run)
    const raised = summonsOf(u)
    return unitCard(u, {
      mods: [...partyMods(run, u), ...bondMods(all, u, alias)],
      realm: realmOf(run),
      live: soulLive(u, lead),
      notes: [
        where,
        u.slot >= 0 && !isHeld(s, u) && domainLine(u.slot, u),
        ...orderNotes(u),
        raised.length > 0 && `Raises ${raised.map((x) => named(x.id, x.count)).join(' and ')} each battle${onField(u) && u.hp > 0 ? '' : ', none while it sits out'}.`,
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
    const bench = inOssuary(s.party)
    const picked = selected()
    const moving = mover()
    // The army as it will stand: the souls on their cells, their summons faint on the tiles they will likely
    // take (synergies count them; the bonds, set before they appear, do not); a held detachment's souls stand
    // ghosted on their cells, and wait behind the camp (they count for nothing on the board until they enter).
    const army = armyOf(run)
    const held = new Set(army.held.map((b) => b.uid))
    summonsNow = army.summons
    const summonOn = new Map(army.summons.map((x) => [x.tile, x]))
    const all = field.filter((u) => !held.has(u.uid))
    const colours = bannerColours(s.party)
    const alias = aliasOf(run)
    const bonded = new Set(activeBonds(all, { alias }).map((b) => b.uid))
    const alive = fieldSouls.filter((u) => u.hp > 0).length
    const m = monarchOf(s)
    const realm = realmOf(run)
    const centre = domainCentre(s)
    const dom = domainOn({ slot: centre }, realm.domain)
    // The Monarch's tile (a held detachment enters beside it) and the domain's centre (a Move square past it
    // is a one-way trip): one and the same but under Vanguard Crown.
    const mTile = deployTile('party', m.slot)
    const cTile = deployTile('party', centre)
    // Who takes the board at the start, by tile: the souls not held back, and their summons.
    const starters = [...fieldSouls.filter((u) => u.hp > 0 && !held.has(u.uid)), ...army.summons]
    const startAt = new Map(starters.map((u) => [u.summoned ? u.tile : deployTile('party', u.slot), u]))
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
    // Melee behind melee does nothing (reDESIGN §10): a melee soul with a melee unit (not its own summon) right
    // ahead of it in its lane strikes nothing until that one falls or it walks round.
    const melee = (u) => Math.max(1, ...unitDef(u.id).abilities.map(abilityDef).filter((a) => !isAllyShape(a.shape) && a.shape !== 'corpse').map(rangeOf)) === 1
    const behind = (u) => {
      if (isMonarch(u) || u.hp <= 0 || held.has(u.uid) || !melee(u) || rowOf(u.slot) === 0) return null
      const ahead = startAt.get(deployTile('party', slotAt(rowOf(u.slot) - 1, colOf(u.slot))))
      return ahead && !isMonarch(ahead) && melee(ahead) && (ahead.summoner ?? ahead.uid) !== u.uid ? ahead : null
    }
    const behindNote = (u) => {
      const a = behind(u)
      return a && `Melee behind melee: ${unitDef(a.id).name}${a.summoned ? ` (${unitDef(summonerOf(a).id).name}'s summon)` : ''} stands right ahead of it in this lane. Melee strikes only the tiles around it, so it adds nothing at the front until that one falls or it walks round: stand it beside the other, or behind a ranged one.`
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
    // Each Marshal's own domain, a dashed square in its banner's colour (gold with no summons), drawn per cell
    // (a held Marshal enters beside the Monarch, so it outlines nothing in the camp).
    const marshals = marshalsOn().map((x) => ({ x, d: domainOn(x, TUNING.ranks.domain), colour: colours.get(x.uid) ?? MARSHAL_GOLD }))
    // ── the board: drawn by board.js on the battle's own picture ──
    // What stands on each tile and what the editor marks there (the picture board.js draws), each tile's
    // tooltip (`tips`) and what a click on it does (clickTile). Their ground is always drawn: empty on the map.
    const units = []
    tips = new Map()
    // A summon keeps its key while its soul moves, so the board walks it over: its soul, its place among them.
    const nth = new Map()
    const summonKey = new Map(army.summons.map((x) => {
      const i = nth.get(x.summoner) ?? 0
      nth.set(x.summoner, i + 1)
      return [x, `m${x.summoner}:${i}`]
    }))
    // A detachment's tag (id, ■ Stay, → Move, a held start); a summon wears its soul's as a dot.
    const detMark = (d, dot = false) => d && { id: d.id, color: d.color, where: d.plan.where, start: waits(d) ? whenTag(d.plan.when) : null, dot }
    // A soul's flag counts the summons it raises each battle, as the battle's.
    const selTile = sel?.slot != null ? deployTile('party', sel.slot) : null
    // A summon's card: where it will likely appear, whose it is, falter or not.
    const summonTip = (x, tile, doing) => unitCard(x, {
      mods: partyMods(run), realm,
      live: doing || (startsFaltering(s, x) ? `Falters ×${TUNING.monarch.falter}: outside the domain` : `${unitDef(summonerOf(x).id).name}'s summon`),
      notes: [`Raised by ${unitDef(summonerOf(x).id).name} as the battle begins: it will likely appear here, on ${tileText(tile)}.`, ARMY_TEXT.summon,
        detOf(summonerOf(x)) && `Detachment ${detOf(summonerOf(x)).id}: it takes its soul's plan, ${planText(detOf(summonerOf(x)).plan)}.`,
        domainLine(x.slot, x), approachNote(tile), ...squareNotes(tile), aim == null && slotHint(x.slot, null, x)]
    })
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
        // A fallen soul's cell may take a summon (the fallen do not fight): the soul shows, the summon beside it.
        const under = u && u.hp <= 0 ? summonOn.get(tile) : null
        const heldHere = u && held.has(u.uid)
        const falters = u && !isMonarch(u) && u.hp > 0 && !heldHere ? startsFaltering(s, u) : false
        if (moving && !u && !(moving.slot < 0 && full()) && aim == null) drop.push(tile)
        if (u) {
          units.push({
            key: `s${u.uid}`, id: u.id, tile, side: 'party', hp: u.hp, maxHp: u.maxHp, lvl: u.lvl, grade: u.grade ?? 0, tier: u.tier ?? 0, tier2: u.tier2 ?? 0,
            monarch: isMonarch(u), fallen: u.hp <= 0, ghost: heldHere ? 0.45 : 1, banner: colours.get(u.uid) ?? null, count: u.hp > 0 ? summonCount(u) : 0,
            det: detMark(detOf(u)), falters, bonded: bonded.has(u.uid), behind: !!behind(u), centre: crowned && !isMonarch(u) && slot === centre,
            seal: isMonarch(u) && sealedBy(s.camp, slot).length > 0, sel: sel?.uid === u.uid, pick: pick.includes(u.uid),
            under: under ? { id: under.id, colour: colours.get(under.summoner) ?? null, led: !!picked && under.summoner === picked.uid } : null
          })
        }
        // A unit's card leads with what a click would do now (the aim, a selected soul's move), else its state.
        const doing = (o) => (aim != null && squareNotes(tile).at(-1)) || (aim == null && mover() && selected() !== o && slotHint(slot, o)) || null
        tips.set(tile, () => u
          ? soulTip(u, `In the camp: ${campRowLabel(r).toLowerCase()}.`, [under && `In battle ${unitDef(summonerOf(under).id).name}'s ${unitDef(under.id).name} will likely appear here: the fallen do not fight.`, behindNote(u), approachNote(tile), ...squareNotes(tile), aim == null && slotHint(slot, u)],
            doing(u) || (behind(u) && `Melee behind ${unitDef(behind(u).id).name}: strikes nothing yet`))
          : tileTipOf(campRowLabel(r), !faltersAt(s, slot), tile,
            (aim == null && slotHint(slot, null)) || (full() ? `The field is full (${cap} souls): swap, or put one in the ossuary first.` : 'Drag a soul here.')))
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
    // The summons, faint and small on the tiles they will likely take, ringed in their soul's banner colour; a
    // click there selects their soul, a soul dropped there sends them elsewhere.
    for (const x of army.summons) {
      if (field.some((u) => u.hp <= 0 && deployTile('party', u.slot) === x.tile)) continue
      const d = detOf(summonerOf(x))
      units.push({
        key: summonKey.get(x), id: x.id, tile: x.tile, side: 'party', rank: true, summon: true, hp: 1, maxHp: 1, lvl: x.lvl, banner: colours.get(x.summoner) ?? null,
        det: detMark(d, true), falters: startsFaltering(s, x), led: !!picked && x.summoner === picked.uid, ghost: 0.6
      })
      const slot = x.slot
      const doing = () => (aim != null && squareNotes(x.tile).at(-1)) || (aim == null && slot >= 0 && mover() && slotHint(slot, null, x)) || null
      tips.set(x.tile, () => summonTip(x, x.tile, doing()))
    }
    // Past the camp's front lie only DEPTH − CAMP_ROWS rows: the open ground, then their formation's.
    const reachText = !dom.beyond ? 'It stays inside your camp.'
      : dom.beyond > DEPTH - CAMP_ROWS ? 'It reaches past your front to the far edge of the board.'
        : `It reaches ${dom.beyond} row${dom.beyond > 1 ? 's' : ''} past your front: ${['the open ground', 'their front row', 'their middle row', 'their back row'][dom.beyond - 1]}.`
    const out = [...fieldSouls.filter((u) => u.hp > 0 && !held.has(u.uid)), ...army.summons].filter((u) => startsFaltering(s, u))
    // Held souls, by detachment, in the order they enter once called.
    const heldBy = [...new Set(army.held.map((b) => b.det))].map((id) => s.detachments.find((d) => d.id === id)).map((d) => [d, army.held.filter((b) => b.det === d.id)])
    const waiting = army.held.length
    // From each Move detachment to its square: from its souls' cells, or from the Monarch for a held one
    // (it enters beside it).
    const arrows = s.detachments.filter((d) => d.plan.where === 'move' && takesPart(s, d)).map((d) => ({
      color: d.color, to: d.plan.square, far: far(d), held: waits(d),
      from: waits(d) ? [mTile] : fieldSouls.filter((u) => d.members.includes(u.uid) && u.hp > 0).map((u) => deployTile('party', u.slot))
    })).filter((a) => a.from.length)
    tips.set('reserve', () => h('div', { class: 'syn-tip tile-tip' }, h('div', null, h('b', null, 'Behind the camp'), ' · held detachments, with the summons they raise as they enter'),
      h('div', { class: 'dim' }, heldBy.length ? `Held: ${heldBy.map(([d, bs]) => `${d.id} (${bs.length}) enters ${whenText(d.plan.when)}`).join('; ')}.` : 'No one waits here.')))
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
      // Behind the camp: each held soul, then its summons to come, smaller (board.js drawWaiting).
      waiting: waiting > 0 ? {
        held: heldBy.map(([d, bs]) => ({
          tag: `${d.id} · ${capsTag(whenTag(d.plan.when))}`, color: d.color,
          bodies: bs.flatMap((b) => [{ id: b.id }, ...summonsOf(b).flatMap((x) => Array(x.count).fill({ id: x.id, banner: colours.get(b.uid) ?? null, summon: true }))])
        })),
        reserve: []
      } : null,
      selTile, selKey: picked ? `s${picked.uid}` : selTile != null ? `t${selTile}` : null, drop, aim: aim != null
    }
    // Under the board, short: the camp, the domain, the line and the approach, a Marshal's own domain. The
    // board shows each; the full rule is in the tooltip.
    // A column of chips in its corner, or a row over the board, whichever leaves the board bigger (board.js picks,
    // and the next legend starts as the last one was).
    const legend = h('div', { class: 'board-legend', 'data-forms': 'col row', 'data-form': el.querySelector('.board-legend')?.dataset.form ?? 'col' },
      // The camp's name, who stands and who is held are on hover: the chip is the souls on the field, and the
      // summons they will raise.
      h('span', {
        class: 'bk bk-camp',
        tip: () => h('div', { class: 'syn-tip tile-tip' }, h('div', null, h('b', null, campDef(s.camp).name), ` · this floor's camp, ${fieldSouls.length} of ${cap} souls on the field (${fieldRule(run)})`),
          (alive < fieldSouls.length || held.size > 0) && h('div', null, [alive < fieldSouls.length && `${alive} standing`, held.size && `${held.size} held behind the camp`].filter(Boolean).join(' · ') + '.'),
          army.summons.length > 0 && h('div', null, `${army.summons.length} summon${army.summons.length === 1 ? '' : 's'} as the battle begins, drawn faint where they will likely appear.`),
          h('div', { class: 'dim' }, ARMY_TEXT.board))
      }, h('b', null, `${fieldSouls.length}/${cap}`), ' souls', army.summons.length > 0 && [' · ', h('b', null, `+${army.summons.length}`), ' summoned']),
      h('span', {
        class: 'bk' + (crowned ? ' crowned' : ''),
        tip: () => h('div', { class: 'syn-tip tile-tip' },
          h('div', null, h('b', null, `Domain ${realm.domain}`), ` · within ${realm.domain} of ${crowned ? 'your front-most soul' : 'the Monarch'}; outside, yours falter ×${TUNING.monarch.falter}`),
          h('div', { class: out.length ? 'falter-note' : 'dim' }, out.length ? `${out.length} of yours stand${out.length === 1 ? 's' : ''} outside and will falter.` : reachText))
      }, h('i', { class: 'dk-box' }), `Domain ${realm.domain}`, out.length > 0 && h('span', { class: 'falter-note' }, ` · ${out.length} falter`)),
      lineKey(lineY, mTile, approach, bare),
      marshals.length > 0 && h('span', {
        class: 'bk',
        tip: () => h('div', { class: 'syn-tip tile-tip' }, h('div', null, h('b', null, `Marshal ${TUNING.ranks.domain}`), ` · ${marshals.map(({ x }) => unitDef(x.id).name).join(', ')}'s own domain (dashed)`),
          h('div', { class: 'dim' }, 'Its banner (itself, its summons, the shadows that join it) never falters within it; it moves with the Marshal.'))
      }, marshals.map(({ colour }) => h('i', { class: 'mk-box', style: `--m:${colour}` })), `Marshal ${TUNING.ranks.domain}`))
    stage.className = 'board-stage' + (aim != null ? ' aiming' : '') + (moving && aim == null ? ' moving' : '') + (keyed ? ' kb' : '')
    // The ossuary beside the board, your souls not on the field: where a soul is dropped (or a selected one
    // clicked) to keep it out of battle. Its count is all your souls, of the most you may hold.
    const held2 = souls(s.party).length
    const benchEl = h('div', { class: 'bench-row' },
      h('span', {
        class: 'rs-label',
        tip: () => h('div', { class: 'syn-tip' }, h('b', null, `Ossuary · souls ${held2}/${rosterCap(run)}`), h('p', null, ARMY_TEXT.ossuary(run)),
          h('p', { class: 'dim' }, 'Swap them onto the field at any time before a battle. The Monarch never comes here.'))
      }, 'Ossuary', h('span', { class: 'rs-count' }, h('b', null, `${held2}/${rosterCap(run)}`), ' souls')),
      h('div', {
        class: 'bench' + (benchable(moving) ? ' target' : ''),
        onclick: (e) => { if (e.target === e.currentTarget) clickBenchSpace() },
        tip: () => benchable(moving) ? `Click empty space here (or drop a soul here) to put ${unitDef(moving.id).name} in the ossuary.`
          : moving && isMonarch(moving) ? 'The Monarch never goes to the ossuary.' : 'Your souls not on the field. Drag a soul here to keep it out of battle, or select it and click here.'
      },
      bench.length
        ? bench.map((u) => h('button', {
          class: 'cell has' + (picked === u ? ' sel' : '') + (u.hp <= 0 ? ' fallen' : '') + (colours.has(u.uid) ? ' captain' : ''),
          style: styles(banner(u.uid), detOf(u) && `--d:${detOf(u).color}`),
          'data-uid': u.uid,
          onpointerdown: (e) => pressBench(e, u),
          onclick: (e) => { if (swallow) { swallow = false; return } clickBench(u, e) },
          tip: () => {
            const act = picked === u ? 'Click again to deselect.' : moving && isMonarch(moving) ? 'The Monarch cannot trade places with a soul in the ossuary.'
              : moving && moving.slot >= 0 ? `Click to select it. Drag ${unitDef(moving.id).name} onto it to swap them.`
                : sel?.slot != null ? (full() ? fullText(u) : 'Click to place it in the selected cell.') : null
            return soulTip(u, 'In the ossuary: does not fight.', act ?? 'Drag it onto the field to place it.', act)
          }
        }, cellBody(u, detOf(u))))
        : h('span', { class: 'dim empty-bench', onclick: clickBenchSpace }, benchable(moving) ? say('Click here to keep the selected soul here.', 'Tap here to keep the selected soul here.') : 'Empty.')))

    // The tray: one tab at a time. Selecting a soul opens its tab, the Monarch its own, and picking souls
    // for a detachment the orders (unless the orders are already open: there a click joins or starts one).
    const selUid = picked ? picked.uid : null
    if (selUid !== null && selUid !== lastSel && trayTab !== 'orders') trayTab = isMonarch(picked) ? 'monarch' : 'soul'
    if (pick.length > lastPick || aim != null) trayTab = 'orders'
    lastSel = selUid
    lastPick = pick.length
    const synergies = synergyTracker(all, alias)
    const tabs = [
      { id: 'soul', name: 'Soul', ico: 'hood', desc: 'The selected soul: its level, paths, summons and rank. With none selected, what essence buys.' },
      { id: 'monarch', name: 'Monarch', ico: 'crown', desc: 'Dominion, Command and Will: the Monarch\'s three stats.' },
      { id: 'orders', name: 'Orders', ico: 'o-move', count: s.detachments.length, desc: 'Detachments and their plans: Hunt, Stay or Move, now or later.' },
      { id: 'bonuses', name: 'Bonuses', short: 'Bonus', ico: 'bonuses', count: synergies.querySelectorAll('.syn.on').length + s.relics.length + s.keystones.length, desc: 'Synergies, bonds, relics and keystones in effect.' }]
    const pickTab = openTab
    const body = {
      soul: () => picked && !isMonarch(picked)
        ? soulCard(picked)
        : picked ? h('p', { class: 'dim upgrade-hint' }, 'The Monarch grows by its own points: see the Monarch tab.') : spendPanel(),
      monarch: () => monarchPanel(picked && isMonarch(picked)),
      orders: () => ordersPanel(picked),
      // Each kind of bonus a labelled row of chips: lit when in effect; hover one for its rule.
      bonuses: () => h('div', { class: 'bonuses' },
        h('div', { class: 'bn-sec' }, h('div', { class: 'bn-k' }, kw('synergy', 'Synergies')), synergies),
        h('div', { class: 'bn-sec' }, h('div', { class: 'bn-k' }, kw('bond', 'Bonds')), bondTracker(all, alias)),
        h('div', { class: 'bn-sec' }, h('div', { class: 'bn-k' }, kw('relic', 'Relics'), h('span', { class: 'bn-n' }, `${s.relics.length}/${TUNING.essence.relicMax}`)), relicList(s.relics)),
        h('div', { class: 'bn-sec' }, h('div', { class: 'bn-k' }, kw('keystone', 'Keystones'), h('span', { class: 'bn-n' }, `${s.keystones.length}/${TUNING.keystone.max}`)), keystoneList(s.keystones)))
    }
    // The stage moves into the new column: one with the keyboard's focus keeps it (and its cursor).
    keeping = document.activeElement === stage
    const col = h('div', { class: 'board-col' }, h('div', { class: 'board-main' }, benchEl, h('div', { class: 'stage-wrap' }, stage, legend)))
    // The side column is kept, not rebuilt (see trayEl): the board's column is swapped in front of it.
    if (sideEl.parentNode === el) el.firstElementChild.replaceWith(col)
    else fill(el, col, sideEl)
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
    fitCard()
    if (now !== shown) { trayBody.scrollTop = 0; trayEl.scrollTop = 0 }
    shown = now
    board.show(stage, picture, [legend])
    // The tooltip under the pointer follows what the click just changed.
    if (hover != null && !drag) tileTip(hover)
  }

  // ── the board under the pointer ──
  // A press on the board (or on a soul in the ossuary) is a click, unless it moves past a few pixels with a soul under
  // it: then that soul lifts and follows, and the drop does what a click on it and then on the tile would. The
  // tooltip follows the pointer from tile to tile; the board rings the tile under it.

  function tileTip (t) {
    const r = t != null && tips.has(t) && board.rectOf(t)
    if (r) showTip(r, tips.get(t))
    else hideTip()
  }

  // The camp slot of a board tile, or null past the camp.
  const slotOfTile = (t) => typeof t === 'number' && tileY(t) < CAMP_ROWS ? slotAt(CAMP_ROWS - 1 - tileY(t), tileX(t)) : null

  // A finger never hovers: its tile's tooltip comes by a long press (begin), and stays when it lifts.
  stage.addEventListener('pointermove', (e) => {
    if (press || drag || e.pointerType === 'touch') return
    const t = board.tileAt(e.clientX, e.clientY)
    // A scroll or a resize hides a tile's tooltip (dom.js) and leaves `hover` as it was: moving on in the same
    // tile brings it back.
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
    // A finger held still on a tile pins its tooltip (the board rings the tile meanwhile); it is then no tap.
    // Moved past the drag's few pixels first, it is a drag; moved after, the soul lifts all the same.
    const p = press
    if (e.pointerType === 'touch' && e.isPrimary) {
      p.hold = hold(e, () => {
        if (press !== p || drag) return
        p.long = true
        const r = t != null && tips.has(t) && board.rectOf(t)
        if (!r) return
        board.hover(t)
        pinTip(r, tips.get(t), { onHide: () => { if (!drag) board.hover(null) } })
      })
    }
  })

  function pressBench (e, u) {
    swallow = false
    if (e.button !== 0 || aim != null || picks(e)) return
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

  // The screen changed under a press (a key, Begin): it is let go of, and nothing it would do is done.
  function release () {
    end()
    if (drag) cancelDrag(false)
    hover = null
  }

  // A finger on a soul in the ossuary scrolls the ossuary (its souls keep the touch from the browser, for the
  // drag) only when it has more than it shows, the finger sets off straight up or down (within 25° of it) before
  // a long press, and it stays over the ossuary: any other way, or once it leaves it, the soul lifts.
  const STEEP = Math.tan(25 * Math.PI / 180)
  const inside = (list, e) => { const r = list.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right }
  function onMove (e) {
    if (!el.isConnected) return release()
    if (!press || e.pointerId !== press.e.pointerId) return
    const [dx, dy] = [e.clientX - press.x, e.clientY - press.y]
    if (press.scroll) {
      const { list, top } = press.scroll
      if (inside(list, e)) { list.scrollTop = top - dy / frame.k; return }
      press.scroll = null
    } else if (!drag && press.uid != null && Math.hypot(dx, dy) > 6) {
      const list = press.bench && press.touch && performance.now() - press.t0 < HOLD && el.querySelector('.bench')
      if (list && list.scrollHeight > list.clientHeight + 1 && Math.abs(dx) <= Math.abs(dy) * STEEP && inside(list, e)) {
        press.scroll = { list, top: list.scrollTop }
        swallow = true
        return
      }
    }
    if (!drag && press.uid != null && Math.hypot(dx, dy) > 6) lift(e)
    if (drag) over(e)
  }

  // A click on the board goes where the old cells' clicks went: a camp cell to clickSlot, any tile (theirs too)
  // to the square while a detachment aims; a soul in the ossuary's button clicks itself. A long press is no click.
  function onUp (e) {
    if (!el.isConnected) return release()
    if (press && e.pointerId !== press.e.pointerId) return
    const p = press
    end()
    if (drag) return put(e)
    if (p && !p.bench && !p.long) clickTile(p.tile, p.e)
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
    press.hold?.cancel()
    const u = soulOf(press.uid)
    drag = { uid: u.uid, at: undefined, target: null }
    if (press.bench) swallow = true
    hideTip()
    hover = null
    board.hover(null)
    stage.classList.add('dragging')
    document.body.classList.add('dragging')
    // Off the board (over the ossuary, the tray) the canvas is under the page: a picture of the soul carries it
    // there, at the board's size (the board's zoom is in viewport px, the ghost in the frame's).
    const size = Math.round(Math.max(40, 92 * board.zoom()) / frame.k)
    drag.ghost = h('div', { class: 'drag-ghost', hidden: true, style: `--s:${size}px` }, portrait(u.id, size, u.hp <= 0))
    frame.el.append(drag.ghost)
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
    const g = toLocal(e.clientX, e.clientY)
    drag.ghost.style.transform = `translate(${g.x}px, ${g.y}px)`
    let preview
    if (at !== drag.at) {
      drag.at = at
      drag.target = dropAt(soulOf(drag.uid), t, !!benchEl, onto != null ? soulOf(+onto) : null)
      preview = dragPreview(soulOf(drag.uid), drag.target)
      el.querySelector('.bench')?.classList.toggle('target', !!drag.target?.bench && drag.target.ok)
    }
    board.follow(e.clientX, e.clientY, preview, off)
  }

  // Where a drop would land: a camp cell (its slot), the ossuary or a soul in it, or nowhere (null); and
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
  // front), every tile whose soul or summon would start the battle faltering, the Monarch's approach tiles and
  // which would be held, and the soul it would displace and where to (a tile, or null for the ossuary). A drop
  // the rules refuse, or off the camp, tells none of it: nothing would change.
  function dragPreview (u, target) {
    if (!target?.ok) return { tile: target?.tile ?? null, ok: false, centre: null, falter: null, approach: null, swap: null }
    const other = target.bench ? target.onto : s.party.find((x) => x.slot === target.slot && x !== u)
    const to = target.bench ? OSSUARY : target.slot
    const party = s.party.map((x) => x === u ? { ...x, slot: to } : x === other ? { ...x, slot: u.slot } : x)
    const s2 = { ...s, party }
    const standing = souls(fielded(party)).filter((x) => x.hp > 0 && !isMonarch(x) && !isHeld(s2, x))
    const starters = [...standing, ...armyOf(run, s2).summons]
    const tileOf = (x) => x.summoned ? x.tile : deployTile('party', x.slot)
    const falter = starters.filter((x) => startsFaltering(s2, x)).map(tileOf)
    const held = new Set(starters.map(tileOf))
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
    // A drop that does nothing (off the camp, back on its own tile or the ossuary) clears an old message too.
    if (!target) { error = ''; return render() }
    sel = { uid }
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
      else if (sel) sel = null
      else if (!error) return
      error = ''
      render()
    }
  }
}

// ── parts ────────────────────────────────────────────────────────────────────────────────────────

// Field first, front to back, then the ossuary.
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

// A soul in a list (the map's Route tab, the end screen): its name, level, rank and paths on one line; its HP,
// and what it raises or that it waits in the ossuary, on the next, then its kin, role and camp row where the
// row is wide enough (style.css, a container query); they are on its card (hover) too.
function unitRow (run, u, extra = null) {
  const d = unitDef(u.id)
  const more = [d.monarch ? 'you' : u.slot < 0 && 'ossuary', summonCount(u) > 0 && `raises ${summonsOf(u).map((x) => named(x.id, x.count)).join(', ')}`].filter(Boolean).join(' · ')
  const kin = !d.monarch && `${KIN[d.kin].name} ${ROLES[d.role].name}${u.slot >= 0 ? ` · ${campRowLabel(rowOf(u.slot)).toLowerCase()}` : ''}`
  return h('div', { class: 'unit' + (u.hp <= 0 ? ' fallen' : '') + (d.monarch ? ' monarch' : ''), tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run) }) },
    rankPort(u, 40),
    h('div', { class: 'grow' },
      h('div', { class: 'u-name' }, h('b', null, d.name), (!d.monarch || u.lvl > 0) && h('span', { class: 'dim' }, ` Lv ${u.lvl}`), u.grade > 0 && h('span', { class: `rank-tag g${u.grade}` }, icon(GRADE_ICON[u.grade], 16), GRADES[u.grade].name),
        u.path && h('span', { class: 'path-tag' }, ` ${pathDef(u.id, u.path).name} ${ROMAN[u.tier - 1]}`), u.path2 && h('span', { class: 'path-tag p2' }, ` · ${pathDef(u.id, u.path2).name} ${ROMAN[u.tier2 - 1]}`)),
      h('div', { class: 'line' }, hpBar(u), h('span', { class: 'dim' }, u.hp > 0 ? `${u.hp}/${u.maxHp}` : 'fallen', more && ` · ${more}`),
        kin && h('span', { class: 'dim u-kin' }, `· ${kin}`))),
    extra)
}

// A soul's cell in the ossuary (the board draws the field's). A summoner wears its banner's flag (its colour comes
// from the cell's --b) with how many it raises, a Knight or Marshal its insignia, and its path tiers as pips (a
// second path's in violet). A soul in a detachment (`det`) wears its tag (the cell's --d): its id, ■ on Stay,
// → on Move; a held one's start sits at its top.
const WHERE_MARK = { hunt: '', stay: ' ■', move: ' →' }
function cellBody (u, det = null) {
  return [
    det && waits(det) && onField(u) && h('span', { class: 'start-tag', 'aria-label': `enters ${whenText(det.plan.when)}` }, whenTag(det.plan.when)),
    portrait(u.id, 52, u.hp <= 0),
    // The marks are badges (board.css sizes them for the ossuary): the level, a path's tiers as one ▴ and their
    // count (a second path's beside it), the rank's insignia, a summoner's flag, a detachment's tag.
    h('span', { class: 'badge' }, ` ${u.lvl}`),
    (u.tier > 0 || u.tier2 > 0) && h('span', { class: 'tier-pips pill', 'aria-label': `path tier ${u.tier}${u.tier2 ? `, second path tier ${u.tier2}` : ''}` },
      u.tier > 0 && `▴${u.tier}`, u.tier2 > 0 && h('span', { class: 'p2' }, `▴${u.tier2}`)),
    u.grade > 0 && h('span', { class: `rank-mark g${u.grade}`, 'aria-label': GRADES[u.grade].name }, icon(GRADE_ICON[u.grade], 16)),
    summonCount(u) > 0 && h('span', { class: 'flag pill', 'aria-label': `raises ${summonCount(u)}` }, `+${summonCount(u)}`),
    det && h('span', { class: 'det-tag pill', 'aria-label': `detachment ${det.id}, ${det.plan.where}` }, det.id, WHERE_MARK[det.plan.where]),
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
    h('span', { class: 'bk', tip: lineTip }, h('i', { class: 'lk-line' }), lineY === null ? 'No line' : `Line ${ahead >= 0 ? '+' : '−'}${Math.abs(ahead)}`),
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

// A wave still to come behind their formation, scouted like it: a small formation of its own (its captains
// flagged), with when it comes, and every foe's card on hover. Never what they will do. The grid is a picture
// of roles and lanes only: a wave enters at the far edge in its lane (a cohort beside its captain), not in its
// scouted row, and takes its bonds and synergies from where it enters and who still stands then, so its cards
// carry the floor's multipliers alone.
function waveCard (run, node, w, k) {
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
}

// The waves still to come, a row in the room's head (prep): each a chip of its name, the faces of its named
// foes (each one's card on hover) and how many come; its formation and when it comes on its name's hover.
// Who comes, never what they will do.
function waveChips (run, node) {
  const mods = roomFoeMods(run, node, [])
  return h('div', { class: 'wave-chips' },
    h('span', { class: 'wc-label', tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'Still to come'), h('p', null, node.waves[0].when.at === 'time' ? ENEMY_TEXT.late : ENEMY_TEXT.waves), h('p', { class: 'dim' }, ENEMY_TEXT.entry)) },
      'Next'),
    node.waves.map((w, k) => {
      const foes = scouted(w.foes)
      const led = cohortSizes(foes)
      const faces = [...new Map(foes.filter((f) => !f.rank).map((f) => [f.id, f])).values()].slice(0, 3)
      return h('span', { class: 'wave-chip' },
        h('b', { tip: () => h('div', { class: 'wave-tip' }, waveCard(run, node, w, k)) }, waveName(node, k)),
        faces.map((u) => h('span', {
          class: 'wc-face',
          tip: () => unitCard(u, { mods, foe: true, ordered: node.type === 'elite' && (led.has(u.slot) || u.cohortOf != null), live: `${waveName(node, k)}: ${waveWhen(w).replace(/\.$/, '').toLowerCase()}`, notes: [waveWhen(w), bannerNote(foes, u, led)] })
        }, portrait(u.id, 28))),
        h('span', { class: 'dim' }, `×${w.foes.length}`))
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
