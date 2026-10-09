// The DOM side: the title, the run's screen (its Field, Map and Codex tabs), the spoils and the end, the playback
// bar and the panels beside the battle, and the parts they share. Screens only read run.state and report input
// upward; the Field sends its actions through act(action), which returns an error message or null. Every
// control has a tooltip saying exactly what it does (rules text lives in codex.js).
import { TUNING } from './tuning.js'
import {
  availableNodes, fieldCap, rosterCap, fielded, inOssuary, currentNode, souls, isMonarch, monarchOf, monarchCost, MONARCH_STATS, holds,
  reapedShadows, essenceByWave, canDescend, depthOf, OSSUARY, domainOf, LINE_MAX, soulCount, canAdvance, levelCost, tierCost
} from './sim/run.js'
import { RANKS, WIDTH } from './sim/map.js'
import { unitDef, relicDef, KIN, ROLES, keystoneDef, SIGNALS } from './content.js'
import {
  COLS, ROWS, CAMP_ROWS, slotAt, rowOf, isWall, LANES, DEPTH, tileAt, deployTile, wallTiles, onField, tileX, tileY, steps, isSeat, ringOf,
  statsOf, abilitiesOf, auraOf, onBoard, distance, tracksOf, canTrack, bannerOf, bodiesOf, livingBodies, nearestOpen, campGrid, activeSynergies
} from './sim/unit.js'
import { field, timingMarks } from './sim/battle.js'
import { h, fill, icon, portrait, prefs, showTip, hideTip, pinTip, hold, HOLD, touchy, say } from './dom.js'
import { kw } from './keywords.js'
import { sfx } from './sfx.js'
// The Field's board: the battle's own, drawn in Phaser (board.js), under a layer that takes the pointer.
import { board } from './board.js'
// The page is scaled whole (frame.js): what is placed over it by a viewport point goes into the frame's px.
import { frame, toLocal } from './frame.js'
import {
  unitCard, partyMods, roomFoeMods, roomTip, threatMeter, foeSynergyLine, synergyTracker, synergyGroups, relicTip, ROOM, campRowLabel, realmOf,
  MONARCH_TEXT, monarchNextText, monarchPointText, deathText, tileText, fieldRule, foeCountText, waveName, waveWhen,
  ENEMY_TEXT, DEEP_TEXT, ROMAN, keystoneTip, aliasOf, TRIGGER_TEXT, codexView, ringText, ringRule, signalText, signalTag, signalName, SIGNAL_ICON,
  SIGNAL_CYCLE, nextSignal, sameSignal, bestiary, standing, abilityBlock, secs, foeRulesOn
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
        step('crown', 'monarch', 'Stand', 'You never strike. The foes walk the ', kw('road', 'roads'), ' to you.'),
        step('fight', 'foe', 'Scout', say('Hover', 'Tap'), ' a room to see its foes. What they do, you learn by fighting.'),
        step('start', 'orders', 'Plan', 'Place your souls and draw their ', kw('line', 'lines'), '. The battle then plays out alone.'),
        step('soul', 'essence', 'Reap', 'The slain pay ', kw('essence'), ', and one of them joins you.')),
      h('div', { class: 'title-actions' },
        h('button', { class: 'primary big', onclick: start, tip: () => 'Start a new run with this seed. (Enter)' }, 'Begin the descent ', h('kbd', null, 'Enter')),
        h('button', { class: 'ghost', onclick: onHelp, tip: () => 'Rules, the board, signals and the foes met. (H)' }, icon('help', 22), ' How to play'),
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

// The run as a row of icons (the Slay the Spire bar): the floors, the purse, the Monarch's HP, your souls, a
// tile per relic and keystone held (hover one for what it does), then sound and help. The bar is rebuilt on
// every change: `drawn` keeps what it last showed, so a changed purse rolls to its new value and flashes, and a
// relic or keystone just taken pops in.
const drawn = { run: null, essence: 0, hp: 0, souls: 0, held: new Set() }

// `tabs`: the run's tabs (runScreen), folded into the bar as compact icons, so the board keeps the screen's width.
function topbar (run, onHelp, tabs = null) {
  const s = run.state
  const fresh = drawn.run !== run
  const n = soulCount(s.party)
  if (fresh) Object.assign(drawn, { run, essence: s.essence, hp: monarchOf(s).hp, souls: n, held: new Set([...s.relics, ...s.keystones]) })
  const purse = h('b', null, Math.round(drawn.essence))
  const chip = h('span', { class: 'chip-stat essence', tip: () => `Essence: slain foes pay it. Spend it on your kinds and the Monarch. ${s.stats.essence} earned, ${s.stats.spent} spent this run.` },
    icon('soul', 20), purse)
  if (drawn.purse) cancelAnimationFrame(drawn.purse.rolling)
  drawn.purse = purse
  roll(purse, drawn.essence, s.essence, chip, (v) => { drawn.essence = v })
  // Your souls, the field's and the ossuary's, of the most you may hold.
  const count = h('b', null, Math.round(drawn.souls))
  const kept = h('span', {
    class: 'chip-stat souls',
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, `Souls ${n}/${rosterCap(run)}`),
      h('p', null, `${soulCount(fielded(s.party))} on the field in ${fielded(souls(s.party)).length} pieces, ${soulCount(inOssuary(s.party))} in the ossuary. Recruit one of the slain after a win.`))
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
  return h('header', { class: 'topbar' },
    floorPips(s),
    h('div', { class: 'chips' }, chip, monarchChip(run), kept),
    tabs,
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
// A keystone's tag, its words' initials ("Court of Bone" CB), small words skipped.
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
      notes: [holds(run.state, 'unhealable')
        ? 'The Monarch is you. Its wounds carry from battle to battle, and under Court of Bone nothing heals them: not a win, not an altar.'
        : 'The Monarch is you. Its wounds carry from battle to battle: it heals like a soul after a win and at altars.']
    })
  }, icon('crown', 20), h('b', null, `${m.hp}/${m.maxHp}`))
}

// The Field's gestures, taught one at a time in a slim pill atop the panel (never over the board), on every frame,
// each until it has been done once (remembered in this browser): select, then draw a line, then set its signal.
const done = (k) => prefs.get('did:' + k) === '1'
const learnt = (k) => { if (!done(k)) prefs.set('did:' + k, '1') }

// ── the run's screen: Field · Map · Codex ───────────────────────────────────────────────────────

// The run between battles and before one, one screen with its three tabs folded into the top bar (DESIGN §4), one
// view at a time: the Field (the board, as large as the screen holds, and one slim panel beside it: the room and
// Begin, the selected piece's card, the ossuary at its foot like a Bloons TD shop), the Map (the floor's rooms:
// scout them, and on the map walk to the next) and the Codex (the rules, the words, the foes met). On the map the
// Map opens first; in a battle room's prep, the Field, their formation on it.
const TABS = [
  { id: 'field', name: 'Field', ico: 'field', key: 'F', desc: 'The board: place your souls, draw their lines, read the roads.' },
  { id: 'map', name: 'Map', ico: 'map', key: 'R', desc: 'The floor: scout its rooms.' },
  { id: 'codex', name: 'Codex', ico: 'codex', key: 'C', desc: 'The rules, the words and the foes you have met.' }]

// trail: node ids visited on this floor, in order (starts with the start node). onNode: walk to a room (the
// map's); onFight: Begin (prep's).
function runScreen ({ run, act, trail, note = '', onNode = null, onFight = null, onHelp }) {
  const s = run.state
  const prep = s.phase === 'prep'
  const node = currentNode(run)
  const bar = h('div', { class: 'bar-slot' })
  const meter = h('div')
  const tabsEl = h('nav', { class: 'top-tabs', role: 'tablist', 'aria-label': 'Views' })
  const refresh = () => { fill(bar, topbar(run, onHelp, tabsEl)); if (prep) fill(meter, threatMeter(run, node)) }
  const head = prep ? h('div', { class: 'prep-head' }) : null
  const editor = fieldEditor({ run, act, facing: prep ? node : null, onChange: refresh, head })
  refresh()
  const canGo = () => fielded(s.party).some((u) => u.hp > 0)
  // Begin lets go of a press or a drag still held on the board first: its release must do nothing.
  const go = () => { if (prep && canGo()) { editor.release(); onFight() } }
  if (prep) {
    const lone = () => !souls(fielded(s.party)).some((u) => u.hp > 0)
    fill(head,
      h('div', { class: 'ph-top' },
        h('div', { class: 'ph-title', tip: () => h('div', { class: 'syn-tip' }, h('b', null, ROOM[node.type].name), h('p', null, ROOM[node.type].text)) },
          h('span', { class: `room-ico t-${node.type}` }, icon(node.type, 24)),
          h('div', { class: 'ph-id' },
            h('h2', null, ROOM[node.type].name),
            h('div', { class: 'dim' }, `${foeCountText(node)} · Lv ${node.foes[0].lvl}`))),
        h('button', {
          class: 'primary big begin-btn',
          onclick: go,
          tip: () => canGo()
            ? h('div', { class: 'syn-tip' }, h('b', null, 'Begin the battle'), say(' (Enter)', ''), h('p', null, 'It plays out on its own: every piece walks the line you drew, and nothing else.'),
              lone() && h('p', { class: 'warn' }, 'No soul stands on the field: the Monarch fights alone, and it never strikes.'),
              h('p', { class: 'warn' }, `Losing ends the run: the Monarch falling loses at once, and so does a battle still undecided ${secs(TUNING.tick.ceiling)} after the last foe entered.`))
            : 'The Monarch has fallen.'
        }, icon('play', 22), ' Begin ', h('kbd', null, 'Enter'))),
      meter,
      node.waves?.length > 0 && waveChips(run, node),
      activeFoeSynergies(node.foes, run) && foeSynergyLine(node.foes, run))
  }

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
      onclick: () => show(t.id), tip: () => h('div', { class: 'syn-tip' }, h('b', null, t.name), say(` (${t.key})`, ''), h('p', null, t.desc))
    }, icon(t.ico, 22), h('span', { class: 'top-tab-name' }, t.name))))
    fill(body, id === 'field' ? editor.el
      : id === 'map' ? mapView({ run, trail, onNode })
        : h('section', { class: 'panel codex-panel' }, codexView(run)))
    if (id === 'field') editor.shown()
  }
  show(prep ? 'field' : 'map')
  const el = h('div', { class: 'screen fit run-screen' + (prep ? ' prep' : '') }, bar, body, toast)
  return {
    el,
    key (e) {
      const n = !prep && reach[Number(e.key) - 1]
      if (n) { editor.release(); onNode(n.id) } else if (e.key === 'Enter' && prep) go()
      else if (e.key === 'f' || e.key === 'F') show('field')
      else if (e.key === 'r' || e.key === 'R') show('map')
      else if (e.key === 'c' || e.key === 'C') show('codex')
      else if (tab === 'field') editor.key(e)
    }
  }
}

export const mapScreen = (o) => runScreen(o)
export const prepScreen = (o) => runScreen(o)

export const NODE = Object.fromEntries(Object.entries(ROOM).map(([k, v]) => [k, { name: k === 'boss' ? 'Boss' : v.name }]))

// ── the map ──────────────────────────────────────────────────────────────────────────────────────

// The whole floor at once, left to right: its ranks across (the start on the left, the elite or the boss on the
// right), its lanes down. Places are in % of the floor's box (style.css .dag), so the floor fits any frame.
const pos = (n) => ({ x: n.rank / (RANKS - 1) * 100, y: n.lane / (WIDTH - 1) * 100 })
// Whether a formation holds any synergy its foes can use here (codex.js foeSynergyLine says which).
const activeFoeSynergies = (foes, run) => activeSynergies(foes).some((syn) => !syn.rule || foeRulesOn(run))

// On the map (onNode) a mouse's click enters a glowing room. By touch a tap scouts, since entering is for good:
// a glowing room's first tap chooses it, its tooltip pinned with Enter ▸, and a second tap on it (or Enter ▸)
// enters; a tap anywhere else lets it go. In prep (no onNode) every room is only scouted.
function mapView ({ run, trail, onNode }) {
  const s = run.state
  const reach = availableNodes(run)
  const reachIds = new Set((onNode ? reach : currentNode(run).next.map((id) => ({ id }))).map((n) => n.id))
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
    const key = onNode && ok ? reach.findIndex((x) => x.id === n.id) + 1 : null
    return h('button', {
      class: `node t-${n.type}` + (ok ? ' reach' : '') + (trail.includes(n.id) ? ' visited' : '') + (n.id === s.at ? ' here' : '') + (!ok && !trail.includes(n.id) ? ' far' : ''),
      style: `left:${p.x}%;top:${p.y}%`,
      'aria-disabled': ok && onNode ? null : 'true',
      'aria-label': NODE[n.type].name,
      tip: () => roomTip(run, n, { reachable: ok, scout: !onNode }),
      onclick: (e) => {
        if (!onNode) return
        if (!touchy()) { if (ok) onNode(n.id); return }
        if (ok && chosen === e.currentTarget) return onNode(n.id)
        scout(e.currentTarget, n, ok)
      }
    }, h('span', { class: 'medal' }, icon(n.type, 24)), h('span', { class: 'node-name' }, NODE[n.type].name), key && h('kbd', null, key))
  })
  return h('section', { class: 'panel mapcol', 'aria-label': 'The floor' },
    h('div', { class: 'map-head' }, h('h2', null, `Floor ${s.floor}`),
      h('span', { class: 'dim' }, onNode ? say('Click a glowing room to enter it (or its number); hover any to scout it.', 'Tap a glowing room twice to enter it; tap any to scout it.')
        : 'You stand in this room: Begin on the Field. Scout what lies past it.')),
    h('div', { class: 'dag-wrap' }, h('div', { class: 'dag' }, svg, nodes)))
}

// ── the Field ────────────────────────────────────────────────────────────────────────────────────

// The camp and the ossuary under it, the board's plan laid over it (board.js), and beside them the panel of
// the selected piece: a soul's, a foe's, or with nothing selected the Monarch's. With `facing` (a battle room)
// their formation stands above your camp. onChange runs after every action it sends.
//
// The gestures (DESIGN §4), the same by mouse and by touch, none needing hover, Shift or a key:
//   tap a piece            select it (its panel, its ring, its line bold); tap it again, or empty ground, and
//                          the Monarch's panel is back (Escape too)
//   drag a piece           move it (and clear its line), onto open ground or another piece (they swap), or
//                          onto the bench to keep it in the ossuary; the Monarch moves only among its seats
//   drag the selected one  draw its line, tile by tile; back over the line to cut it short; from the end of its
//                          line, go on with it
//   tap a line's marker    step its signal on: at once, 5 / 10 / 15 s, the first blow, wave 2 / 3, the Monarch
//                          struck, one of yours fallen (the panel sets any of them directly)
//   drag a soul from the bench  place it; tap it, then an open camp tile, places it too
//   long press (touch)     the card of whatever is there, pinned
// Seconds of the timing marks (DESIGN §3): where each piece stands at 5, 10 and 15 s.
const MARK_TICKS = [100, 200, 300]

function fieldEditor ({ run, act, facing = null, onChange = null, head = null }) {
  const s = run.state
  const el = h('div', { class: 'retinue' })
  // The selection: { uid } a soul of yours or the Monarch (on the field or in the ossuary), { foe: slot } a
  // scouted foe, or null: the Monarch's panel.
  let sel = null
  let error = ''
  // A synergy whose chip was pressed: its pieces glow bright (synergyTracker's focus), until pressed again.
  let focusSyn = null
  const stage = h('div', { class: 'board-stage', 'aria-label': 'The board. Tap a piece to select it; drag a piece to move it; drag from the selected piece to draw its line. Keys: the arrows move a cursor, Enter taps, Escape lets go.' })
  const hintEl = h('div', { class: 'board-hint', role: 'status' })
  const stageWrap = h('div', { class: 'stage-wrap' }, stage)
  const benchEl = h('div', { class: 'bench-strip' })
  const panelBody = h('div', { class: 'tab-body' })
  const errEl = h('p', { class: 'warn panel-err' })
  const panelEl = h('div', { class: 'tray' }, errEl, panelBody)
  const sideEl = h('div', { class: 'side-col' }, head, hintEl, panelEl, benchEl)
  el.append(stageWrap, sideEl)
  let shown = ''
  // The board's tooltips, by tile; the tile under the pointer; a press, which turns into a drag past a few pixels;
  // the drag (a piece moved, a line drawn); a bench soul's click to swallow after it was dragged.
  let tips = new Map()
  let hover = null
  let press = null
  let drag = null
  let swallow = false
  let keeping = false

  const soulOf = (uid) => s.party.find((u) => u.uid === uid)
  const selected = () => sel?.uid != null ? soulOf(sel.uid) ?? null : null
  const pieceAt = (t) => typeof t === 'number' ? fielded(s.party).find((u) => deployTile('party', u.slot) === t) ?? null : null
  const foes = facing?.foes ?? []
  const foeAt = (t) => foes.find((f) => deployTile('foe', f.slot) === t) ?? null
  // The camp slot of a board tile, or null past the camp.
  const slotOfTile = (t) => typeof t === 'number' && tileY(t) < CAMP_ROWS ? slotAt(CAMP_ROWS - 1 - tileY(t), tileX(t)) : null
  const full = () => fielded(souls(s.party)).length >= fieldCap(run)
  const fullText = (u) => `The field is full (${fieldCap(run)} pieces): drop ${unitDef(u.id).name} onto one of yours to swap them, put one in the ossuary first, or buy Command.`
  const said = (e) => e ?? ''

  // Every action keeps the selection but a move's: a purchase, a line, a signal leave it where it is.
  function send (action) {
    error = said(act(action))
    render()
    onChange?.()
    return !error
  }
  function refuse (why) {
    error = why
    sfx.play('poor')
    render()
  }
  function select (next) {
    sel = next
    error = ''
    if (next) learnt('select')
    render()
  }

  // The gesture to learn next, if one is left (the hints: see learnt), in a few words for the pill atop the panel.
  function hint () {
    const p = selected()
    const tap = say('Click', 'Tap')
    if (!done('select')) return [h('b', null, tap), ' a piece to select it · ', h('b', null, 'drag'), ' one to move it']
    if (!done('line') && p && onField(p) && !isMonarch(p)) return [h('b', null, `Drag from the ${unitDef(p.id).name}`), ' along the tiles to draw its line']
    if (!done('line')) return [tap, ' a soul, then ', h('b', null, 'drag from it'), ' to draw its line']
    if (!done('signal') && Object.keys(s.lines).length) return [h('b', null, `${tap} a line's marker`), ' to choose when it starts']
    return null
  }

  // ── the picture ──

  // Each piece's timing marks (DESIGN §3) as the board draws them: on each tile it will stand on at a moment,
  // the moments ("5s", "10·15s"), leaving out the tile it starts on (a piece that has not left it yet).
  function marksOf (pieces) {
    const at = timingMarks({ party: pieces, lines: s.lines, walls: wallTiles(s.camp), at: MARK_TICKS })
    const out = []
    for (const u of pieces) {
      if (!s.lines[u.uid] || !at[u.uid]) continue
      const start = deployTile('party', u.slot)
      const runs = []
      at[u.uid].forEach((tile, i) => {
        const last = runs.at(-1)
        if (last?.tile === tile) last.at.push(i)
        else runs.push({ tile, at: [i] })
      })
      for (const r of runs) {
        if (r.tile === start) continue
        out.push({ tile: r.tile, uid: u.uid, text: `${r.at.map((i) => MARK_TICKS[i] * TUNING.tick.ms / 1000).join('·')}s`, sel: sel?.uid === u.uid })
      }
    }
    return out
  }

  // The Banners' wings as the battle will form them (battle.js createBattle): in slot order, each living Banner
  // with a line takes every living piece beside it, not a Banner and in no wing yet, as its follower.
  // → Map: a follower's uid → its Banner.
  function wings () {
    const order = fielded(souls(s.party)).filter((u) => u.hp > 0).sort((a, b) => a.slot - b.slot)
    const out = new Map()
    for (const b of order) {
      if (!bannerOf(b) || !s.lines[b.uid]) continue
      for (const u of order) {
        if (u !== b && !bannerOf(u) && !out.has(u.uid) && distance(deployTile('party', u.slot), deployTile('party', b.slot)) === 1) out.set(u.uid, b)
      }
    }
    return out
  }

  function render () {
    const fieldNow = fielded(s.party)
    const m = monarchOf(s)
    const mTile = deployTile('party', m.slot)
    const walls = wallTiles(s.camp)
    const alias = aliasOf(run)
    const groups = synergyGroups(souls(standing(run)), alias)
    const picked = selected()
    const foe = sel?.foe != null ? foes.find((f) => f.slot === sel.foe) ?? null : null
    if (sel && !picked && !foe) sel = null
    // Who glows bright: the selected piece's partners in every synergy it counts toward, or a pressed chip's.
    const lit = new Set(groups.filter((g) => (focusSyn ? g.key === focusSyn : picked && g.uids.has(picked.uid))).flatMap((g) => [...g.uids]))
    const units = []
    tips = new Map()
    const roads = field({ root: mTile, walls })
    const wing = wings()
    for (const u of fieldNow) {
      const tile = deployTile('party', u.slot)
      units.push({
        key: `s${u.uid}`, id: u.id, tile, side: 'party', hp: u.hp, maxHp: u.maxHp, lvl: u.lvl, tracks: u.tracks, count: u.count, monarch: isMonarch(u), fallen: u.hp <= 0,
        sel: sel?.uid === u.uid, glow: groups.filter((g) => g.uids.has(u.uid)).map((g) => g.colour), lit: lit.has(u.uid),
        banner: [...wing.values()].includes(u), follows: wing.has(u.uid)
      })
      tips.set(tile, () => pieceTip(u))
    }
    for (const f of foes) {
      const tile = deployTile('foe', f.slot)
      units.push({ key: `f${f.slot}`, id: f.id, tile, side: 'foe', hp: 1, maxHp: 1, lvl: f.lvl, count: f.count ?? 1, sel: sel?.foe === f.slot })
      tips.set(tile, () => foeTip(f))
    }
    // Empty ground: what it is, whether the domain reaches it, and how far its road runs to the Monarch.
    const dom = domainOf(s)
    for (let t = 0; t < LANES * DEPTH; t++) {
      if (tips.has(t)) continue
      const wall = walls.includes(t)
      const d = roads.dist[t]
      tips.set(t, () => h('div', { class: 'syn-tip tile-tip' },
        h('div', null, h('b', null, wall ? 'Wall' : sentence(tileText(t))), ' · ', distance(t, mTile) <= dom ? h('span', { class: 'dom-note' }, 'in the domain') : h('span', { class: 'dim' }, 'outside the domain')),
        h('div', { class: 'dim' }, wall ? 'It blocks walking, not shots: the roads bend round it.'
          : Number.isFinite(d) ? `Its road runs ${d} step${d === 1 ? '' : 's'} to the Monarch.` : 'No road runs from here.')))
    }
    // Every line; a follower's own set aside for its Banner's, shifted (the wing's: DESIGN §2.8).
    const lines = []
    for (const u of fieldNow) {
      const lead = wing.get(u.uid)
      const l = s.lines[lead?.uid ?? u.uid]
      if (!l) continue
      const from = deployTile('party', u.slot)
      const tiles = lead ? wingLine(from, deployTile('party', lead.slot), l.tiles, new Set(walls)) : l.tiles
      const near = sel?.uid === u.uid || (lead && sel?.uid === lead.uid)
      if (tiles.length) lines.push({ key: `s${u.uid}`, uid: u.uid, from, tiles, tag: signalTag(l.when), signal: l.when?.at !== 'once', sel: near, dim: !!sel && !near, wing: !!lead })
    }
    const ring = picked && onField(picked) && !isMonarch(picked) ? { tile: deployTile('party', picked.slot), r: ringOf(picked) }
      : foe && bestiary.has(foe.id) ? { tile: deployTile('foe', foe.slot), r: ringOf(foe), foe: true } : null
    const movingTiles = drag?.kind === 'move' ? dropTiles(soulOf(drag.uid)) : []
    const picture = {
      walls, facing: !!facing, units, domain: { centre: mTile, r: dom }, roads: roads.arrow, ring, lines,
      marks: marksOf(fieldNow.filter((u) => u.hp > 0)), drop: movingTiles,
      selTile: null, selKey: picked && onField(picked) ? `s${picked.uid}` : foe ? `f${foe.slot}` : null
    }
    stage.className = 'board-stage' + (drag ? ' dragging' : '') + (keyed ? ' kb' : '')
    const teach = hint()
    fill(hintEl, teach)
    hintEl.hidden = !teach || !!drag
    fill(benchEl, benchStrip())
    keeping = document.activeElement === stage
    if (keeping && stage.isConnected) stage.focus({ preventScroll: true })
    keeping = false
    errEl.textContent = error
    errEl.hidden = !error
    const now = picked ? `s${picked.uid}` : foe ? `f${foe.slot}` : 'monarch'
    fill(panelBody, picked && !isMonarch(picked) ? soulPanel(picked) : foe ? foePanel(foe) : monarchPanel())
    if (now !== shown) panelBody.scrollTop = 0
    shown = now
    board.show(stage, picture)
    if (hover != null && !drag && tips.has(hover)) tileTip(hover)
  }

  // ── the bench ──

  // Under the board: your souls in the ossuary, each a cell to drag onto the camp (or tap, then tap an open
  // tile); a piece dropped on the strip goes to the ossuary. Its count, and the field's, at its head.
  function benchStrip () {
    const bench = inOssuary(s.party)
    const moving = drag?.kind === 'move' ? soulOf(drag.uid) : null
    const target = moving && onField(moving) && !isMonarch(moving)
    return [
      h('div', {
        class: 'bench-label',
        tip: () => h('div', { class: 'syn-tip' }, h('b', null, `Ossuary · souls ${soulCount(s.party)}/${rosterCap(run)}`),
          h('p', null, `Your souls not on the field: kept, never fighting. The field takes ${fieldCap(run)} (${fieldRule(run)}).`),
          h('p', { class: 'dim' }, 'Drag a soul from here onto the camp, or a piece from the camp onto here. The Monarch never comes here.'))
      }, h('b', null, 'Ossuary'), h('span', { class: 'dim' }, `${bench.length ? `${bench.length} kept` : 'empty'} · field ${fielded(souls(s.party)).length}/${fieldCap(run)}`)),
      (bench.length || target) && h('div', { class: 'bench' + (target ? ' target' : '') + (drag?.target?.bench && drag.target.ok ? ' over' : '') },
        bench.length
          ? bench.map((u) => h('button', {
            class: 'cell has' + (sel?.uid === u.uid ? ' sel' : '') + (u.hp <= 0 ? ' fallen' : ''),
            'data-uid': u.uid,
            onpointerdown: (e) => pressBench(e, u),
            onclick: () => { if (swallow) { swallow = false; return } select(sel?.uid === u.uid ? null : { uid: u.uid }) },
            tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run), live: 'In the ossuary: it does not fight', notes: ['Drag it onto an open tile of the camp to field it.'] })
          }, portrait(u.id, 46, u.hp <= 0), u.count > 1 && h('span', { class: 'badge' }, `×${u.count}`), u.maxHp && hpBar(u)))
          : h('span', { class: 'dim empty-bench' }, 'Drop it here to keep it in the ossuary.'))]
  }

  // ── the panels ──

  const buyButton = (label, cost, action, why, cls = '') => h('button', {
    class: 'buy' + cls + (s.essence < cost ? ' poor' : ''),
    'aria-disabled': s.essence < cost ? 'true' : null,
    onclick: (e) => {
      if (s.essence < cost) { sfx.play('poor'); return shake(e) }
      if (send(action)) sfx.play('buy')
    },
    tip: () => s.essence < cost ? `Needs ${cost} essence; you have ${s.essence}.` : why
  }, label, h('span', { class: 'price' }, icon('soul', 16), cost))
  function shake (e) {
    const t = e?.currentTarget
    if (!t?.classList) return
    t.classList.remove('shake')
    void t.offsetWidth
    t.classList.add('shake')
  }

  // A piece's head: its picture (its full card on hover), name and count, level, kin and role, and its stats as
  // it fights now, its HP the stack's pool.
  function pieceHead (u, { mods, foe = false, sub = null }) {
    const d = unitDef(u.id)
    const st = statsOf(u, mods)
    const n = u.count ?? 1
    const maxHp = Math.round(st.hp * n)
    const hp = u.hp == null ? maxHp : Math.max(0, Math.round(u.hp / (u.maxHp || 1) * maxHp))
    const stat = (ico, name, v) => h('span', { class: 'uc-stat s-' + ico, tip: () => name }, icon(ico, 18), h('b', null, v))
    return [h('div', { class: 'uc-head' },
      h('div', { class: 'uc-art', tip: () => unitCard(u, { mods, foe, realm: realmOf(run) }) }, portrait(u.id, 56, u.hp <= 0)),
      h('div', { class: 'uc-id' },
        h('div', { class: 'uc-name' }, d.name, n > 1 && h('span', { class: 'uc-count' }, ` ×${n}`)),
        h('div', { class: 'uc-sub dim' }, sub ?? `Lv ${u.lvl} · ${d.kin ? `${KIN[d.kin].name} ` : ''}${ROLES[d.role].name}`))),
    h('div', { class: 'uc-stats' },
      stat('hp', u.hp > 0 || u.hp == null ? 'HP' : 'Fallen: an altar raises it.', hp < maxHp ? `${hp}/${maxHp}` : maxHp),
      stat('atk', 'Attack', Math.round(st.atk)), stat('def', 'Defence', Math.round(st.def)), stat('spd', 'Speed: how fast its gauge fills', Math.round(st.spd))),
    h('div', { class: 'uc-ring', tip: () => ringRule(u, foe) }, icon('ring', 18), h('span', null, ringText(u, foe)))]
  }

  // Its abilities, each a line (the card's).
  const abilities = (u, st) => {
    const aura = auraOf(u)
    return h('div', { class: 'uc-abs' }, abilitiesOf(u).map((id) => abilityBlock(id, st, realmOf(run))),
      aura && h('div', { class: 'ability' }, h('b', null, 'Aura'), ' ', h('span', { class: 'tag-shape' }, `≤${aura.range}`), ' ', aura.desc))
  }

  // A soul's panel: its head; its stack (its bodies, splitting them off); its line (how long, what it waits for,
  // the signals to pick from, Clear) or how to draw one, or the Banner whose line it walks; its kind (Level and
  // the two tracks); its abilities; where it stands (to the ossuary, or how to field it).
  function soulPanel (u) {
    const mods = partyMods(run, u)
    const on = onField(u)
    const l = s.lines[u.uid]
    const lead = on ? wings().get(u.uid) : null
    const led = on ? [...wings()].filter(([, b]) => b === u).length : 0
    return h('div', { class: 'uc' },
      pieceHead(u, { mods }),
      stackSection(u),
      on && (lead
        ? h('div', { class: 'uc-line' }, h('div', { class: 'uc-sec' }, kw('line', 'Line')),
          h('p', { class: 'dim uc-note' }, 'It stands beside ', h('b', null, unitDef(lead.id).name), ', a ', kw('banner'), ': it walks the Banner\'s line, keeping its place in the wing (dashed), and its own is set aside.'))
        : lineSection(u, l)),
      on && led > 0 && h('p', { class: 'dim uc-note' }, kw('banner'), `: ${led} piece${led === 1 ? '' : 's'} beside it follow${led === 1 ? 's' : ''} its line.`),
      on && bannerOf(u) && !l && h('p', { class: 'dim uc-note' }, kw('banner'), ': draw it a line, and the pieces beside it will follow.'),
      !on && h('p', { class: 'dim uc-note' }, u.hp <= 0 ? 'Fallen, in the ossuary: an altar raises it.'
        : full() ? fullText(u) : say('In the ossuary. Drag it onto an open tile of the camp, or click one.', 'In the ossuary. Drag it onto an open tile of the camp, or tap one.')),
      kindPanel(u.id),
      h('div', { class: 'uc-sec' }, 'Abilities'),
      abilities(u, statsOf(u, mods)),
      on && h('div', { class: 'uc-acts' },
        h('button', { class: 'ghost small', onclick: () => place(u, OSSUARY), tip: () => `Keep ${unitDef(u.id).name} out of battle, in the ossuary.` }, icon('bone', 18), 'To the ossuary')))
  }

  // A piece's stack (DESIGN §2.2): its bodies (the living ones, and those its kind's tiers add each battle), how
  // to add one (drag a soul of its kind onto it), and splitting bodies off, the hindmost first: one beside it
  // (while the field has room) or into the ossuary, or half of them.
  function stackSection (u) {
    const n = u.count
    const alive = livingBodies(u)
    const extra = bodiesOf(u)
    const room = onField(u) && !full()
    const kin = s.party.filter((x) => x !== u && x.id === u.id).length
    return h('div', { class: 'uc-stack' },
      h('div', { class: 'uc-sec' }, kw('stack', 'Stack'), h('span', { class: 'dim' }, ` · ${n} bod${n === 1 ? 'y' : 'ies'}${alive < n ? `, ${alive} standing` : ''}${extra ? `, +${extra} each battle (its tiers)` : ''}`)),
      n === 1 && h('p', { class: 'dim uc-note' }, kin ? `Drag another ${unitDef(u.id).name} onto it to stack them: one piece, one tile, one pool.` : 'Recruit more of its kind to stack them: one piece, one tile, one pool.'),
      n > 1 && h('div', { class: 'uc-acts' },
        room && h('button', { class: 'ghost small', onclick: () => splitOff(u, 1, true), tip: () => 'Split one body off onto the open tile nearest it: a piece of its own.' }, icon('release', 16), 'Split 1 beside it'),
        h('button', { class: 'ghost small', onclick: () => splitOff(u, 1), tip: () => 'Split one body off into the ossuary: a piece of its own.' }, icon('bone', 16), 'Split 1 to the ossuary'),
        n > 3 && h('button', { class: 'ghost small', onclick: () => splitOff(u, Math.floor(n / 2), room), tip: () => `Split ${Math.floor(n / 2)} bodies off into a piece of their own, ${room ? 'beside it' : 'in the ossuary'}.` }, 'Split in half')))
  }

  // A kind's panel (DESIGN §2.8), the Bloons TD 6 way: its Level, one buy; then its two tracks, each a row of
  // tiers I–IV lit up to the one held, the next priced at the row's end with what it does. Either track may go
  // to II; once one passes II the other stops there (the crosspath rule), its tiers past II locked. Every soul of
  // the kind holds what is bought.
  function kindPanel (id) {
    const k = s.kinds[id]
    if (!k) return null
    const name = unitDef(id).name
    const held = s.party.filter((x) => x.id === id)
    const bodies = held.reduce((n, x) => n + x.count, 0)
    const tracks = tracksOf(id)
    const lcost = levelCost(run, id)
    const capped = k.lvl >= TUNING.level.cap
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
        return h('button', {
          class: `tnode ${state}` + (tier.banner ? ' banner' : ''), 'aria-label': `${tr.name} ${ROMAN[i]}`, 'aria-disabled': i === have && can && s.essence >= cost ? null : 'true',
          onclick: (e) => { if (i === have && can) return buyTier(e, id, t, cost); if (i >= have) { sfx.play('poor'); shake(e) } },
          tip: () => h('div', { class: 'syn-tip' }, h('p', null, h('b', null, `${tr.name} ${ROMAN[i]}: `), tier.desc),
            i < have ? null : lock ? h('p', { class: 'warn' }, lockText) : i > have ? h('p', { class: 'dim' }, `After ${ROMAN[i - 1]}.`)
              : s.essence < cost ? h('p', { class: 'warn' }, `Needs ${cost} essence; you have ${s.essence}.`) : h('p', { class: 'dim' }, `${cost} essence, for every ${name}.`))
        }, h('span', { class: 'tnum' }, ROMAN[i]), tier.banner && h('span', { class: 'tbadge' }, icon('command', 12)))
      }
      return h('div', { class: 'track' + (have ? ' held' : '') + (t ? ' second' : '') },
        h('div', { class: 'track-head', tip: () => tr.desc }, h('b', null, tr.name), h('span', { class: 'track-desc dim' }, tr.desc)),
        h('div', { class: 'nodes' }, tr.tiers.map((tier, i) => [i > 0 && h('span', { class: 'tlink' + (i < have ? ' on' : '') }), node(tier, i)]),
          can && h('span', { class: 'tprice' + (s.essence < cost ? ' poor' : '') }, icon('soul', 16), cost)),
        h('div', { class: 'track-next' + (blocked ? ' warn' : '') }, have >= 4 ? 'Complete.' : blocked ? lockText : [h('b', null, `${ROMAN[have]} `), next.desc]))
    }
    return h('div', { class: 'uc-kind' },
      h('div', { class: 'uc-sec' }, `Every ${name}`, h('span', { class: 'dim' }, ` · ${held.length} piece${held.length === 1 ? '' : 's'}, ${bodies} bod${bodies === 1 ? 'y' : 'ies'}`)),
      capped ? h('p', { class: 'dim uc-note' }, `Level ${TUNING.level.cap}: the kind can rise no further.`)
        : buyButton([icon('levelup', 22), h('span', { class: 'grow' }, 'Level ', h('span', { class: 'dim' }, `${k.lvl} → ${k.lvl + 1}`))],
          lcost, { type: 'level', kind: id }, `Every ${name} you hold rises a level.`, ' lvl-up'),
      tracks.length === 2 && h('div', { class: 'tracks' }, tracks.map(row)))
  }
  function buyTier (e, kind, track, cost) {
    if (s.essence < cost) { sfx.play('poor'); return shake(e) }
    if (send({ type: 'upgrade', kind, track })) sfx.play('buy')
  }

  // A fielded soul's line: its length and signal, then the signals as a row of chips (the marker on the board
  // steps through the same), and Clear. A Wave signal the room in prep does not have is marked: the piece would
  // hold all battle.
  function lineSection (u, l) {
    const waves = facing ? 1 + (facing.waves?.length ?? 0) : null
    const never = (w) => w.at === 'wave' && waves !== null && w.wave >= waves
    const pick = (w) => () => {
      if (!l) return
      if (sameSignal(l.when, w)) return
      learnt('signal')
      if (send({ type: 'line', uid: u.uid, tiles: l.tiles, when: w })) sfx.play('select')
    }
    return h('div', { class: 'uc-line' },
      h('div', { class: 'uc-sec' }, kw('line', 'Line'), l && h('span', { class: 'dim' }, ` · ${l.tiles.length} step${l.tiles.length === 1 ? '' : 's'}, ${signalText(l.when)}`)),
      !l && h('p', { class: 'dim uc-note' }, 'No line: it holds its tile. ', h('b', null, 'Drag from it'), ' on the board to draw one, tile by tile.'),
      l && never(l.when) && h('p', { class: 'warn uc-note' }, `This room has no wave ${l.when.wave + 1}: it would hold all battle.`),
      l && h('div', { class: 'signals', role: 'radiogroup', 'aria-label': 'Signal' }, SIGNAL_CYCLE.map((w) => h('button', {
        class: 'sig' + (sameSignal(l.when, w) ? ' on' : '') + (never(w) ? ' never' : ''), role: 'radio', 'aria-checked': sameSignal(l.when, w) ? 'true' : 'false',
        onclick: pick(w),
        tip: () => h('div', { class: 'syn-tip' }, h('b', null, signalName(w)), ' ', SIGNALS[w.at].desc.replace('its wave', `wave ${w.wave + 1}`).replace('its time', secs(w.t ?? 0)),
          never(w) && h('p', { class: 'warn' }, `This room has no wave ${w.wave + 1}.`))
      }, icon(SIGNAL_ICON[w.at], 16), h('span', null, signalName(w))))),
      l && h('div', { class: 'uc-acts' },
        h('button', { class: 'ghost small', onclick: () => send({ type: 'line', uid: u.uid, tiles: [] }), tip: () => 'Clear its line: it holds its tile.' }, icon('close', 16), 'Clear line'),
        h('span', { class: 'dim small' }, 'Drag from its end to go on.')))
  }

  // A scouted foe's panel: its head with the floor's multipliers, its ring and way once met, its cohort, its lore.
  function foePanel (f) {
    const mods = roomFoeMods(run, facing)
    const d = unitDef(f.id)
    return h('div', { class: 'uc foe' },
      pieceHead(f, { mods, foe: true, sub: `Enemy · Lv ${f.lvl} · ${d.kin ? `${KIN[d.kin].name} ` : ''}${ROLES[d.role].name}` }),
      f.count > 1 && h('p', { class: 'dim uc-note' }, ENEMY_TEXT.stack(f.count)),
      d.flavour && h('p', { class: 'flavour uc-note' }, d.flavour),
      h('div', { class: 'uc-sec' }, 'Abilities'),
      abilities(f, statsOf(f, mods)),
      h('p', { class: 'dim uc-note' }, 'Stats include this floor\'s multipliers and their synergies.'))
  }

  // The Monarch's panel, with nothing selected: its HP, its domain and field, its stats (a point each, for the
  // same rising price), and your synergies, each chip a press that lights its pieces on the board.
  function monarchPanel () {
    const m = monarchOf(s)
    const cost = monarchCost(run)
    const col = (k) => {
      const t = MONARCH_TEXT[k]
      return h('div', {
        class: `mc-col s-${k}`,
        tip: () => h('div', { class: 'syn-tip' }, h('p', null, h('b', null, `${t.name}: `), t.line), h('p', { class: 'dim' }, monarchNextText(run, k)))
      },
      h('div', { class: 'mc-ico' }, icon(k, 20)),
      h('div', { class: 'mc-name' }, t.name),
      h('div', { class: 'mc-pts' }, s.monarch[k] ?? 0),
      h('div', { class: 'mc-now' }, t.now(run)),
      buyButton('+1', cost, { type: 'monarch', stat: k }, `${monarchNextText(run, k)} Each point costs ${TUNING.monarch.costPerPoint} more than the last.`))
    }
    // Compact, so its four stats show whole in the slim panel: the head one line, the stats two by two.
    return [h('div', { class: 'mc' },
      h('div', { class: 'uc-head' },
        h('div', { class: 'uc-art', tip: () => unitCard(m, { mods: [], realm: realmOf(run), notes: ['Drag it to another seat of the rear two rows: the roads run to it.'] }) }, portrait(m.id, 44, m.hp <= 0),
          h('span', { class: 'uc-ins crown' }, icon('crown', 14))),
        h('div', { class: 'uc-id' },
          h('div', { class: 'uc-name', tip: () => monarchPointText(run) }, 'The Monarch'),
          h('div', { class: 'mc-hp' }, hpBar(m), h('span', null, `${m.hp}/${m.maxHp}`)))),
      h('div', { class: 'mc-cols' + (MONARCH_STATS.length > 3 ? ' four' : '') }, MONARCH_STATS.map(col))),
    h('div', { class: 'uc-sec' }, kw('synergy', 'Synergies'), h('span', { class: 'dim' }, say(' · click one to light its pieces', ' · tap one to light its pieces'))),
    synergyTracker(souls(standing(run)), aliasOf(run), { focus: focusSyn, onFocus: (key) => { focusSyn = focusSyn === key ? null : key; render() } }),
    h('div', { class: 'uc-sec' }, 'The board'),
    h('ul', { class: 'legend-list dim' },
      h('li', null, h('i', { class: 'lg-road' }), kw('road', 'Roads'), ': the arrows the foes walk to the Monarch.'),
      h('li', null, h('i', { class: 'lg-line' }), kw('line', 'Lines'), ' and their markers; the dots on them are where each piece stands at 5, 10 and 15 s (select one for its times).'),
      h('li', null, h('i', { class: 'lg-dom' }), kw('domain', 'Domain'), ': where a slain foe may rise for you.'))]
  }

  // ── tooltips ──

  const pieceTip = (u) => unitCard(u, {
    mods: partyMods(run, u), realm: realmOf(run),
    live: isMonarch(u) ? `Domain ${domainOf(s)} · if it falls, the run ends` : s.lines[u.uid] ? `Line of ${s.lines[u.uid].tiles.length}, ${signalText(s.lines[u.uid].when)}` : 'No line: it holds its tile',
    notes: [isMonarch(u) ? 'Drag it to another seat of the rear two rows.'
      : sel?.uid === u.uid ? 'Selected: drag from it to draw its line.' : say('Drag it to move it; click it to select it.', 'Drag it to move it; tap it to select it.')]
  })
  const foeTip = (f) => unitCard(f, {
    mods: roomFoeMods(run, facing), foe: true,
    notes: ['Enemy. Stats include this floor\'s multipliers and their synergies.', f.count > 1 && ENEMY_TEXT.stack(f.count)]
  })
  const markerTip = (uid) => {
    const l = s.lines[uid]
    const u = soulOf(uid)
    return l && u && h('div', { class: 'syn-tip' }, h('b', null, `${unitDef(u.id).name}'s signal: ${signalName(l.when)}`), ' ', `It walks ${signalText(l.when)}.`,
      h('p', { class: 'dim' }, say('Click to step to the next signal.', 'Tap to step to the next signal.')))
  }
  function tileTip (t) {
    const r = t != null && tips.has(t) && board.rectOf(t)
    if (r) showTip(r, tips.get(t))
    else hideTip()
  }

  // ── acting ──

  // A soul (or the Monarch) to a camp slot, or OSSUARY; the rules' refusals said in words before it is sent.
  function place (u, slot) {
    if (slot === u.slot) return render()
    if (isMonarch(u) && slot === OSSUARY) return refuse('The Monarch never goes to the ossuary: it stands in every battle.')
    if (slot !== OSSUARY && isWall(s.camp, slot)) return refuse('A wall stands there: a piece stands on open ground.')
    const other = slot === OSSUARY ? null : s.party.find((x) => x.slot === slot)
    if (isMonarch(u) && !isSeat(s.camp, slot)) return refuse('The Monarch stands on a seat of the rear two rows.')
    if (other && isMonarch(other) && !isSeat(s.camp, u.slot)) return refuse(`The Monarch takes ${unitDef(u.id).name}'s place in a swap, and it stands only in the rear two rows.`)
    if (!onField(u) && !other && slot !== OSSUARY && full()) return refuse(fullText(u))
    if (sel?.uid === u.uid && !onField(u) && slot !== OSSUARY) sel = null
    send({ type: 'place', uid: u.uid, slot })
  }

  // A piece onto another of its kind: one stack where `onto` stands, with its line (the moved piece's goes).
  function stackOnto (u, onto) {
    if (sel?.uid === u.uid) sel = { uid: onto.uid }
    if (send({ type: 'stack', uid: u.uid, onto: onto.uid })) { sfx.play('place'); board.pop(`s${onto.uid}`) }
  }

  // `n` bodies off a piece, the hindmost, into a piece of their own: beside it while the field has room
  // (`beside`), else in the ossuary.
  function splitOff (u, n, beside = false) {
    const slot = beside ? nearestOpen(campGrid(s.camp), u.slot, new Set(s.party.map((x) => x.slot))) : OSSUARY
    if (send({ type: 'split', uid: u.uid, n, slot: slot >= 0 ? slot : OSSUARY })) sfx.play('place')
  }

  // The marker's press: the line's next signal (its tooltip, if up, says the new one).
  function cycle (uid) {
    const l = s.lines[uid]
    if (!l) return
    sel = { uid }
    learnt('signal')
    if (send({ type: 'line', uid, tiles: l.tiles, when: nextSignal(l.when) })) sfx.play('select')
    const r = document.querySelector('.tip.on') && board.markerRect(uid)
    if (r) showTip(r, () => markerTip(uid))
  }

  // A tap on the board: a piece selects it (or lets it go), a foe likewise; an open camp tile with a soul from
  // the ossuary selected places it there; anything else returns to the Monarch.
  function tapTile (t) {
    if (t == null) return select(null)
    const o = pieceAt(t)
    if (o) return select(sel?.uid === o.uid ? null : { uid: o.uid })
    const f = foeAt(t)
    if (f) return select(sel?.foe === f.slot ? null : { foe: f.slot })
    const p = selected()
    const slot = slotOfTile(t)
    if (p && !onField(p) && slot != null && !isWall(s.camp, slot)) return place(p, slot)
    select(null)
  }

  // ── the board under the pointer ──
  // A press on the board is a tap unless it moves past a few pixels: on the selected piece (or its line's end)
  // that draws its line, on any other piece of yours it lifts it. The tooltip follows the mouse from tile to
  // tile; a finger's comes by a long press.

  stage.addEventListener('pointermove', (e) => {
    if (press || drag || e.pointerType === 'touch') return
    const mk = board.markerAt(e.clientX, e.clientY)
    if (mk != null) {
      hover = null
      board.hover(null)
      const r = board.markerRect(mk)
      return r ? showTip(r, () => markerTip(mk)) : hideTip()
    }
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
    const mk = board.markerAt(e.clientX, e.clientY)
    if (mk != null) return begin(e, { marker: mk })
    const t = board.tileAt(e.clientX, e.clientY)
    const o = pieceAt(t)
    const p = selected()
    const l = p && onField(p) && !isMonarch(p) ? s.lines[p.uid] : null
    // The selected piece (never the Monarch, which has no line) draws its line; its line's end goes on with it.
    if (p && onField(p) && !isMonarch(p) && (o === p || (l && t === l.tiles.at(-1) && o !== p && !o))) begin(e, { tile: t, draw: p.uid, extend: o !== p })
    else begin(e, { tile: t, uid: o?.uid ?? null })
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

  // The screen changed under a press (a key, Begin, a tab): it is let go of, and nothing it would do is done.
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
    if (!drag && far && press.draw != null) startLine(e)
    else if (!drag && far && press.uid != null) lift(e)
    if (drag?.kind === 'line') growLine(e.clientX, e.clientY)
    else if (drag) overMove(e)
  }

  function onUp (e) {
    if (!el.isConnected) return release()
    if (press && e.pointerId !== press.e.pointerId) return
    const p = press
    end()
    if (drag?.kind === 'line') return commitLine()
    if (drag) return put(e)
    if (!p || p.long || p.bench) return
    if (p.marker != null) return cycle(p.marker)
    tapTile(p.tile)
  }

  function onCancel () {
    if (!el.isConnected) return release()
    end()
    if (drag) cancelDrag()
  }

  // ── drawing a line ──

  function startLine (e) {
    press.hold?.cancel()
    const u = soulOf(press.draw)
    const old = s.lines[u.uid]
    drag = {
      kind: 'line', uid: u.uid, from: deployTile('party', u.slot), tiles: press.extend && old ? old.tiles.slice() : [],
      when: old?.when ?? { at: 'once' }, walls: new Set(wallTiles(s.camp)), ok: true
    }
    hideTip()
    hover = null
    board.hover(null)
    stage.classList.add('dragging')
    document.body.classList.add('dragging')
    board.trace(e.clientX, e.clientY, growLine)
    growLine(e.clientX, e.clientY)
  }

  function growLine (x, y) {
    if (drag?.kind !== 'line') return
    const t = board.tileAt(x, y)
    if (t != null) drag.ok = extendLine(drag, t)
    board.sketch({ from: drag.from, tiles: drag.tiles, ok: drag.ok }, x, y)
  }

  // The line runs on to tile `to`: back onto a tile it already passes (the piece's own: none at all) it is cut
  // there; else it walks on toward `to` one legal step at a time (DESIGN §2.1: no wall, no squeeze past a wall's
  // corner), the diagonal first, then the straight step along the longer way, until it gets there, can go no
  // further, or is LINE_MAX long. → whether it reached `to`.
  function extendLine (d, to) {
    const path = [d.from, ...d.tiles]
    const k = path.lastIndexOf(to)
    if (k >= 0) { d.tiles = d.tiles.slice(0, k); return true }
    let at = path.at(-1)
    while (at !== to && d.tiles.length < LINE_MAX) {
      const [ex, ey] = [tileX(to) - tileX(at), tileY(to) - tileY(at)]
      const [sx, sy] = [Math.sign(ex), Math.sign(ey)]
      const ways = [[sx, sy], ...(sx && sy ? (Math.abs(ex) >= Math.abs(ey) ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]]) : [])]
      const open = steps(at, d.walls)
      const next = ways.map(([a, b]) => onBoard(tileX(at) + a, tileY(at) + b) ? tileAt(tileX(at) + a, tileY(at) + b) : -1).find((n) => n >= 0 && open.includes(n))
      if (next === undefined) return false
      d.tiles.push(next)
      at = next
    }
    return at === to
  }

  // The line let go: drawn (its signal kept), cut back to nothing (cleared), or unchanged (nothing sent).
  function commitLine () {
    const d = drag
    cancelDrag(false)
    const had = s.lines[d.uid]
    if (!d.tiles.length) return had ? send({ type: 'line', uid: d.uid, tiles: [] }) : render()
    if (had && String(had.tiles) === String(d.tiles)) return render()
    if (send({ type: 'line', uid: d.uid, tiles: d.tiles, when: d.when })) { learnt('line'); sfx.play('place'); render() }
  }

  // ── moving a piece ──

  function lift (e) {
    press.hold?.cancel()
    const u = soulOf(press.uid)
    drag = { kind: 'move', uid: u.uid, at: undefined, target: null }
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
    board.lift(press.bench ? { id: u.id } : `s${u.uid}`, e.clientX, e.clientY)
    render()
  }

  // Whether piece `u` dropped on piece `o` stacks onto it (DESIGN §2.2): one kind, neither the Monarch.
  const stacks = (u, o) => !!o && o !== u && o.id === u.id && !isMonarch(u) && !isMonarch(o)
  // The tiles a piece may be dropped on: the Monarch's seats; for a soul every open camp tile (from the
  // ossuary with the field full, only another piece's: a swap, or a stack onto one of its kind).
  function dropTiles (u) {
    if (!u) return []
    const out = []
    for (let slot = 0; slot < COLS * CAMP_ROWS; slot++) {
      if (isWall(s.camp, slot) || slot === u.slot) continue
      const o = s.party.find((x) => x.slot === slot)
      const ok = isMonarch(u) ? isSeat(s.camp, slot) && (!o || isSeat(s.camp, u.slot))
        : o ? stacks(u, o) || !(isMonarch(o) && !isSeat(s.camp, u.slot)) : onField(u) || !full()
      if (ok) out.push(deployTile('party', slot))
    }
    return out
  }

  // The drop under the pointer, and when it changes, what it would do (dragPreview) for the board to show.
  function overMove (e) {
    const hit = document.elementFromPoint(e.clientX, e.clientY)
    const onBench = hit?.closest?.('.bench-strip')
    const onto = onBench ? hit.closest('[data-uid]')?.dataset.uid : undefined
    const t = onBench ? null : board.tileAt(e.clientX, e.clientY)
    const at = onBench ? `b${onto ?? ''}` : String(t)
    const off = !hit?.closest?.('.stage-wrap')
    drag.ghost.hidden = !off
    const g = toLocal(e.clientX, e.clientY)
    drag.ghost.style.transform = `translate(${g.x}px, ${g.y}px)`
    let preview
    if (at !== drag.at) {
      drag.at = at
      drag.target = dropAt(soulOf(drag.uid), t, !!onBench, onto != null ? soulOf(+onto) : null)
      preview = dragPreview(soulOf(drag.uid), drag.target)
      el.querySelector('.bench')?.classList.toggle('over', !!drag.target?.bench && drag.target.ok)
    }
    board.follow(e.clientX, e.clientY, preview, off)
  }

  // Where a drop would land: a camp slot, the bench or a soul on it, or nowhere (null); and whether the rules
  // take it (a refused one is still put down there, for its message).
  function dropAt (u, t, bench, onto) {
    if (bench) return { bench: true, onto, stack: stacks(u, onto) ? onto : null, ok: stacks(u, onto) || (!isMonarch(u) && onField(u)) }
    const slot = slotOfTile(t)
    if (slot == null) return null
    if (isWall(s.camp, slot)) return { tile: t, slot, wall: true, ok: false }
    const o = s.party.find((x) => x.slot === slot)
    return { tile: t, slot, stack: stacks(u, o) ? o : null, ok: dropTiles(u).includes(t) || slot === u.slot }
  }

  // What a drop would make of the board: a dragged Monarch carries its domain and the roads, which run to it
  // (DESIGN §2.6), and a piece it would displace is shown ghosted where it would go.
  function dragPreview (u, target) {
    if (!target?.ok) return { tile: target?.tile ?? null, ok: false, centre: null, roads: null, swap: null }
    if (target.bench || target.stack) return { tile: target.tile ?? null, ok: true, stack: !!target.stack, centre: null, roads: null, swap: null }
    const other = s.party.find((x) => x.slot === target.slot && x !== u)
    const to = deployTile('party', target.slot)
    const swap = other ? { key: `s${other.uid}`, id: other.id, to: onField(u) ? deployTile('party', u.slot) : null } : null
    const king = isMonarch(u) ? to : isMonarch(other ?? {}) ? deployTile('party', u.slot) : null
    return { tile: to, ok: true, centre: king, roads: king != null ? field({ root: king, walls: wallTiles(s.camp) }).arrow : null, swap }
  }

  // The drop: the move it stands for is made, or refused in words.
  function put (e) {
    overMove(e)
    const { uid, target } = drag
    cancelDrag(false)
    const u = soulOf(uid)
    if (!target) { error = ''; return render() }
    if (target.stack) return stackOnto(u, target.stack)
    if (target.bench) {
      if (!onField(u)) return render()
      if (isMonarch(u)) return refuse('The Monarch never goes to the ossuary: it stands in every battle.')
      return target.onto && target.onto !== u ? place(target.onto, u.slot) : place(u, OSSUARY)
    }
    if (target.wall) return refuse('A wall stands there: a piece stands on open ground.')
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
    // Its screen is about to change (Begin, a tab): a press or a drag still held is let go of, doing nothing.
    release,
    // Put back on the page as it was (the Field tab again): the board is shown again.
    shown: render,
    key (e) {
      if (e.key !== 'Escape') return
      if (drag) { end(); return cancelDrag() }
      if (focusSyn) focusSyn = null
      else if (sel) sel = null
      else if (!error) return
      error = ''
      render()
    }
  }
}

// A follower's march: its Banner's line (from `lead`'s tile) shifted by where it stands from it (`from`), as far
// as each shifted tile is a step from the one before (battle.js lineStep: there it stops).
function wingLine (from, lead, tiles, walls) {
  const [ox, oy] = [tileX(from) - tileX(lead), tileY(from) - tileY(lead)]
  const out = []
  for (const t of tiles) {
    const [x, y] = [tileX(t) + ox, tileY(t) + oy]
    const to = onBoard(x, y) ? tileAt(x, y) : -1
    if (to < 0 || !steps(out.at(-1) ?? from, walls).includes(to)) break
    out.push(to)
  }
  return out
}

// "your camp, front row, lane 4" → "Your camp, front row, lane 4".
const sentence = (t) => t.charAt(0).toUpperCase() + t.slice(1)

// ── reap ─────────────────────────────────────────────────────────────────────────────────────────

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
    const now = find()
    if (!now) return
    now.classList.remove('arriving', 'new', 'gain')
    void now.offsetWidth
    now.classList.add(soul ? 'gain' : 'new')
  })
}

// The room whose cards were last dealt: a release re-shows the same room, and its cards should not deal in
// again. `seen`: the room's groups of offers as dealt; `on`: the group in view.
let dealt = null

// The offers come in groups, one decision each, in this order: a recruit, a relic, a keystone, a tier.
// Taking one offer of a group takes the group off the table.
const GROUPS = ['soul', 'relic', 'keystone', 'tier']
const GROUP_NAME = { soul: 'Recruit', relic: 'Relic', keystone: 'Keystone', tier: 'Tier' }

// onDone(index): take offer `index`, or null to move on. The offers are cards to pick, framed in their system's
// colour. A room with more than one group shows them a group at a time behind a row of steps, each step its
// group's one line; every offer's key works from any step, and brings its group into view.
export function reapScreen ({ run, title, act, onDone, onHelp }) {
  const s = run.state
  const el = h('div', { class: 'screen fit reap-screen' })
  const full = () => soulCount(s.party) >= rosterCap(run)
  const blocked = (o) => o.type === 'soul' && (full() ? 'full' : o.cost > s.essence ? 'poor' : null)
  const room = `${s.floor}|${s.at}`
  let deal = !(dealt?.run === run && dealt.room === room)
  const groups = () => GROUPS.filter((g) => s.offers.some((o) => o.type === g))
  if (deal) dealt = { run, room, seen: groups(), on: groups()[0] }
  const view = dealt
  const settle = () => {
    const left = groups()
    if (left.includes(view.on)) return
    view.on = view.seen.slice(view.seen.indexOf(view.on) + 1).find((g) => left.includes(g)) ?? left[0]
    deal = true
  }
  settle()
  const cards = []
  let busy = false
  const keys = offerKeys(s.offers)
  const keyTag = (i) => keys.has(i) && h('kbd', null, keys.get(i))
  const keyNote = (i) => keys.has(i) ? ` (${keys.get(i)})` : ''
  const refuse = (i) => {
    sfx.play('poor')
    const c = cards[i]
    if (!c) return
    c.classList.remove('refuse')
    void c.offsetWidth
    c.classList.add('refuse')
  }
  const later = (fn) => (still() ? fn() : setTimeout(fn, 300))
  const artRect = (i) => (cards[i]?.querySelector('.offer-art') ?? cards[i])?.getBoundingClientRect()
  // `onto`: a recruit joins that fielded piece of its kind instead of standing alone.
  const take = (i, onto = null) => {
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
      onDone(i, onto)
      if (o.type !== 'tier') flyTrinket(o, rect)
    })
  }
  // The fielded pieces a recruit of kind `id` could join (DESIGN §2.2: a stack).
  const kin = (id) => fielded(souls(s.party)).filter((u) => u.id === id)
  // Under the recruits: for each with pieces of its kind on the field, a press to recruit it straight onto one.
  const ontoRow = (offers) => {
    const opts = offers.flatMap(({ o, i }) => o.type === 'soul' && !blocked(o) ? kin(o.id).map((u) => ({ o, i, u })) : [])
    return opts.length > 0 && h('div', { class: 'onto-row' },
      h('span', { class: 'dim' }, 'Or recruit onto a piece of its kind on the field:'),
      opts.map(({ o, i, u }) => h('button', {
        class: 'ghost onto', onclick: () => take(i, u.uid),
        tip: () => `Recruit ${unitDef(o.id).name} for ${o.cost} essence as a body more in the ${unitDef(u.id).name}${u.count > 1 ? ` stack of ${u.count}` : ''} on ${tileText(deployTile('party', u.slot))}: one piece, one tile, one pool.`
      }, portrait(o.id, 30), h('span', null, `${unitDef(o.id).name} ×${u.count} → ×${u.count + 1}`), h('span', { class: 'price' }, icon('soul', 16), o.cost))))
  }
  const has = (type) => s.offers.some((o) => o.type === type)
  // Hollow Court: the shadows that stood at the end of the battle just won paid their essence again.
  const shades = ['fight', 'elite', 'siege'].includes(currentNode(run).type) ? reapedShadows(run) : []
  const reaped = shades.length > 0 && `Hollow Court: ${shades.length} shadow${shades.length === 1 ? '' : 's'} still stood, and paid ${shades.length === 1 ? 'its' : 'their'} essence again.`
  const part = {
    soul: () => ['Recruit one for ', kw('essence')],
    relic: () => ['Pick one ', kw('relic'), ', free'],
    keystone: () => ['Pick one ', kw('keystone'), ` · ${s.keystones.length}/${TUNING.keystone.max} held`],
    tier: () => ['Take one ', kw('tier'), ', free']
  }
  const lede = () => groups().map((g) => part[g]()).flatMap((p, k) => [k ? ' · ' : '', p])
  const ledeTip = () => h('div', { class: 'syn-tip' },
    has('soul') && h('p', null, 'A recruit rises whole at the level it fought at: the field takes it if there is room, else the ossuary. One a battle.'),
    has('tier') && h('p', null, 'A rite grants one kind the next tier of a track: every soul of that kind holds it.'))
  // A battle of waves paid each wave as it fell: what each paid, relics included.
  const node = currentNode(run)
  const paid = node.waves?.length && run.battle ? essenceByWave(run.battle) : null
  const boost = 1 + s.relics.reduce((n, id) => n + (relicDef(id).essence ?? 0), 0)
  const wavePay = paid && h('p', { class: 'wave-pay', tip: () => 'Every foe slain paid essence into one purse; this is what each wave paid of it, relics included.' },
    icon('soul', 18), ' Paid wave by wave: ', paid.map((v, k) => [k ? ' · ' : '', `Wave ${k + 1}`, ' ', h('b', null, Math.round(v * boost))]))

  // A card: big art, the name, one line of effect; the rest is on the hover. A tier is a kind's (o.kind; its
  // track's name and tier are in its name). [Step 5, part 2: the kind's two tracks drawn on the card.]
  function card (o, i) {
    const why = blocked(o)
    const owned = o.type === 'soul' ? s.party.filter((u) => u.id === o.id).reduce((n, u) => n + u.count, 0) : 0
    const kind = o.type === 'tier' ? o.kind ?? s.party.find((u) => u.uid === o.uid)?.id : null
    const tip = o.type === 'soul'
      ? () => unitCard({ id: o.id, lvl: o.lvl, slot: -1 }, {
        mods: partyMods(run),
        notes: [why === 'full' ? 'Your souls are at their most: release one first.' : why === 'poor' ? `You need ${o.cost} essence; you have ${s.essence}.` : `Click to recruit it for ${o.cost} essence: a piece of its own, on the field if there is room, else in the ossuary.`,
          owned && `You already hold ${owned}.`, kin(o.id).length > 0 && 'Or recruit it onto a piece of its kind on the field: see under the cards.']
      })
      : o.type === 'relic' ? null
        : o.type === 'keystone' ? () => h('div', null, keystoneTip(o.id, run), h('p', { class: 'dim' }, `Click to take it, free.${keyNote(i)}`))
          : () => h('div', { class: 'syn-tip' }, h('b', null, o.name), ' ', o.desc, h('p', { class: 'dim' }, `Every ${unitDef(kind).name} you hold takes it, free.${keyNote(i)}`))
    const d = o.type === 'soul' && unitDef(o.id)
    const on = o.type === 'relic' && relicDef(o.id).on
    return cards[i] = h('button', { class: `offer o-${o.type}` + (why ? ' locked' : ''), style: `--i:${i}`, onclick: () => take(i), 'aria-disabled': why ? 'true' : null, tip },
      h('div', { class: 'offer-tag' }, keyTag(i), h('span', { class: 'tag-word' }, ` ${GROUP_NAME[o.type]}`)),
      h('div', { class: 'offer-art' }, o.type === 'relic' ? icon(relicIcon(o.id), 64) : o.type === 'keystone' ? icon('keystone', 64) : portrait(o.type === 'soul' ? o.id : kind, 104),
        on && h('span', { class: 'trig-tag', tip: () => `Fires each time ${TRIGGER_TEXT[on].short}` }, TRIGGER_TEXT[on].name)),
      h('div', { class: 'offer-name' }, kind ? o.name.replace(`${unitDef(kind).name}: `, '') : o.name),
      kind && h('div', { class: 'offer-sub' }, `${unitDef(kind).name} · every one you hold`),
      h('div', { class: 'offer-line' }, d ? [`${KIN[d.kin].name} ${ROLES[d.role].name} · `, h('span', { class: 'nowrap' }, 'level ', h('b', { class: 'num' }, o.lvl))] : hiNums(o.desc)),
      h('div', { class: 'offer-price' + (why ? ` ${why}` : '') }, o.type === 'soul' ? [icon('soul', 18), o.cost, why === 'full' && h('span', null, ' · full')] : 'Free'))
  }

  // Your souls, one line at the foot: their count. On the Recruit step with no room for one more, the line says
  // so and opens (a press) a panel over the cards: each soul but the Monarch, with a Release button.
  let roster = false
  function strip (recruiting) {
    const n = soulCount(s.party)
    const cap = rosterCap(run)
    if (!recruiting || !full()) {
      return h('div', { class: 'ret-line', tip: () => `Your souls: ${n} of ${cap}, on the field and in the ossuary.` },
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

  // Cards per row: up to `most` in one, more in rows as even as they come.
  const rowOf = (n, most) => (n <= most ? Math.max(n, 1) : Math.ceil(n / Math.ceil(n / most)))
  const most = () => Math.max(3, Math.min(6, Math.floor((frame.w - 44 + 18) / (168 + 18))))
  function render () {
    cards.length = 0
    const left = view.seen.filter((g) => groups().includes(g))
    const one = left.length < 2
    const on = one ? null : view.on
    const offers = s.offers.map((o, i) => (!on || o.type === on) && card(o, i))
    const shown = s.offers.map((o, i) => ({ o, i })).filter(({ o }) => !on || o.type === on)
    offers.filter(Boolean).forEach((c, k) => c.style.setProperty('--i', k))
    const next = on && left[left.indexOf(on) + 1]
    const picksN = offers.filter(Boolean).length
    const cols = rowOf(picksN, most())
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
        h('div', { class: 'reap-body' },
          h('div', { class: 'reap-picks' },
            picksN > 0 && h('div', { class: 'offers picks' + (deal ? ' deal' : '') + (picksN > cols ? ' rows' : ''), style: `--cols:${cols}` }, offers),
            ontoRow(shown))),
        h('div', { class: 'reap-foot' },
          strip(one ? has('soul') : on === 'soul'),
          h('div', { class: 'reap-actions' },
            next && h('button', { class: 'next-step big', onclick: () => show(next), tip: () => `On to the next step: ${GROUP_NAME[next]}. (→)` }, `${GROUP_NAME[next]} `, h('span', { 'aria-hidden': 'true' }, '→')),
            h('button', { class: 'ghost big move-on', onclick: () => take(null), tip: () => `Leave what is left and go on.${has('soul') ? ' The slain not recruited are lost.' : ''} (S)` }, 'Move on ', h('kbd', null, 'S'))))))
    deal = false
  }

  const reveal = (g) => { if (view.on !== g && !busy) show(g) }
  render()
  return {
    el,
    key (e) {
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      const hit = [...keys].find(([, k]) => e.key.toUpperCase() === k)
      if (hit) { reveal(s.offers[hit[0]].type); take(hit[0]) } else if (e.key === 's' || e.key === 'S') take(null)
      else if (e.key === 'ArrowRight') stepTo(1)
      else if (e.key === 'ArrowLeft') stepTo(-1)
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
  const fell = lost?.reason === 'tick-ceiling' ? 'a battle dragged on past its last moment, and the dark took you' : 'the Monarch fell'
  const tagline = descend ? 'The Hollow Sovereign falls, its court crumbles to dust with it, and its soul is yours. The run is cleared, and that stands whatever comes next.'
    : won ? `The Hollow Sovereign fell to you. Then, on floor ${s.floor}, ${deep} floor${deep === 1 ? '' : 's'} below it, ${fell}. The clear stands.`
      : lost?.reason === 'tick-ceiling' ? `On floor ${s.floor} the battle dragged on past its last moment, and the dark took you.`
        : `The Monarch fell on floor ${s.floor}, and the run with it.`
  const newRun = h('button', { class: descend ? 'ghost big' : 'primary big', onclick: onNew, tip: () => `Start again with a new seed. (${descend ? 'N' : 'Enter'})` },
    'New run ', h('kbd', null, descend ? 'N' : 'Enter'))
  const stat = (ico, sys, v, label, name) => h('div', { class: 'end-stat', style: `--s:var(--c-${sys})`, tip: () => name }, h('span', { class: 'end-val' }, icon(ico, 22), h('b', null, v)), h('span', { class: 'lbl' }, label))
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
          stat('bone', 'ossuary', soulCount(s.party), 'souls', 'Souls held at the end, on the field and in the ossuary.'),
          stat('soul', 'essence', s.stats.essence, 'essence', 'Essence earned.'),
          stat('reliquary', 'relic', s.relics.length, 'relics', 'Relics claimed.')),
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
export function deathPanel (s, battle) {
  const d = deathText(s, battle)
  const m = monarchOf(s)
  const mine = m.slot >= 0 ? deployTile('party', m.slot) : null
  const from = s.death.reason === 'monarch' && s.death.uid !== m.uid ? s.death.from : null
  const walls = new Set(wallTiles(s.camp))
  const row = (y) => DEPTH - 1 - y
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

// ── the battle's chrome ──────────────────────────────────────────────────────────────────────────

// The battle keeps prep's layout, so the board does not move as one fades into the other: a thin strip over the
// board (the room, the wave under way, the escalation bar, always in view: DESIGN §2.10, the essence carried, the
// clock), and the slim panel beside it (the Monarch's HP, their synergies and yours, the rules as they strike,
// and at its foot pause, speed and skip, which change only how the battle is shown). The board takes the rest
// (stage: engine.js fits it there).
const SPEEDS = [1, 2, 4]

export function battleChrome ({ onHelp = null } = {}) {
  let scene = null
  let st = { paused: false, speed: 1, seconds: 0, over: false, essence: 0, wave: 1, waves: 1, left: 1, ramp: 0.4, esc: 1 }
  let carried = 0
  const noFocus = (e) => e.preventDefault()
  const btn = (attrs, ...kids) => h('button', { tabindex: '-1', onmousedown: noFocus, ...attrs }, ...kids)
  const speeds = SPEEDS.map((n) => btn({ class: 'seg', onclick: () => scene?.setSpeed(n), tip: () => `Play at ${n}× speed. (${n})` }, `${n}×`))
  const pause = btn({ class: 'seg pause', onclick: () => scene?.togglePause(), tip: () => 'Pause or resume the playback. (Space)' })
  const skip = btn({ class: 'primary skip', 'data-sfx': 'none', onclick: () => scene?.skip(), tip: () => st.over ? 'On to what comes next. (S or Esc)' : 'Skip to the result. The outcome is already decided. (S or Esc)' })
  const E = TUNING.escalation
  const clock = h('span', { class: 'clock', tip: () => 'Battle time.' })
  const count = h('b', null, '0')
  const purse = h('span', {
    class: 'purse',
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'Essence'), h('p', null, 'Carried by the foes slain so far, relics included. A won battle pays it into your purse.'))
  }, icon('soul', 20), h('span', { class: 'purse-plus' }, '+'), count)
  const waveN = h('b')
  const wave = h('span', { class: 'wave-n', tip: () => h('div', { class: 'syn-tip' }, h('b', null, `Wave ${st.wave} of ${st.waves}`), ' ', kw('wave', 'Waves'), ` come over the far edge: once the last is down to a third, or after ${secs(TUNING.spawn.waves.t)}.`) },
    icon('w-wave', 18), waveN)
  const fillEl = h('span', { class: 'esc-fill' })
  const mark = h('span', { class: 'esc-ramp' })
  const escN = h('b', { class: 'esc-n' })
  const esc = h('span', {
    class: 'esc',
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'Escalation'), ' ',
      `The bar runs down from the last foe to enter. Past the mark (${secs(E.startTick)} in, ${secs(E.startTick * E.bossMult)} in the boss's room) every blow climbs, up to ×${E.max}. Empty: the battle is lost, and with it the run.`,
      h('p', { class: 'dim' }, st.esc > 1 ? `Every blow ×${st.esc.toFixed(2)} now.` : 'No blow is ramped yet.'))
  }, h('span', { class: 'esc-bar' }, fillEl, mark), escN)
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
  const list = (box, names) => fill(box, names.length ? names.map((n) => h('span', { class: 'bs-syn' + (n.startsWith('★') ? ' rule' : '') }, n)) : h('span', { class: 'dim' }, 'none'))
  const stage = h('div', { class: 'battle-stage' }, h('div', { class: 'pause-veil', 'aria-hidden': 'true' }, h('span', null, icon('pause', 26), 'Paused')))
  const el = h('div', { class: 'battle-screen' },
    h('header', { class: 'battle-top' }, title, wave, esc, h('span', { class: 'grow' }), purse, clock),
    h('div', { class: 'battle-main' },
      stage,
      h('aside', { class: 'battle-panel' },
        crown,
        h('div', { class: 'bs-k foe' }, 'Their synergies'), theirs, theirRules,
        h('div', { class: 'bs-k' }, 'Yours'), mine, myRules,
        h('div', { class: 'bs-controls' },
          h('div', { class: 'bs-row' }, pause, h('div', { class: 'segs' }, speeds)),
          h('div', { class: 'bs-row' }, skip, muteButton(),
            onHelp && btn({ class: 'icon-btn', 'aria-label': 'How to play', onclick: onHelp, tip: () => 'How to play: the battle waits while it is open. (H)' }, icon('help', 20)))))))

  function render () {
    SPEEDS.forEach((n, i) => speeds[i].classList.toggle('active', st.speed === n))
    fill(pause, icon(st.paused ? 'play' : 'pause', 20), st.paused ? ' Resume' : ' Pause')
    fill(skip, icon('skip', 22), st.over ? ' Continue' : ' Skip', h('kbd', null, 'S'))
    pause.classList.toggle('active', st.paused)
    el.classList.toggle('paused', st.paused && !st.over)
    el.classList.toggle('over', !!st.over)
    clock.textContent = `${st.seconds.toFixed(0)}s`
    waveN.textContent = `${st.wave}/${st.waves}`
    wave.hidden = st.waves < 2
    fillEl.style.width = `${st.left * 100}%`
    mark.style.left = `${(1 - st.ramp) * 100}%`
    esc.classList.toggle('hot', st.esc > 1)
    esc.classList.toggle('low', st.left < 0.15)
    escN.textContent = st.esc > 1 ? `×${st.esc.toFixed(1)}` : ''
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
      start ({ title: t, theirs: th, mine: m, monarch }) {
        title.textContent = t
        list(theirs, th)
        list(mine, m)
        crown.hidden = !monarch
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
      if (e.code === 'KeyS' || e.code === 'Escape') { e.preventDefault(); return scene.skip() }
      if (e.code === 'Space') scene.togglePause()
      else if (['Digit1', 'Digit2', 'Digit4'].includes(e.code)) scene.setSpeed(Number(e.code.slice(5)))
      else return
      sfx.play('click')
      e.preventDefault()
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

// A soul in a list (the spoils' release list, the end screen): its name and level on one line; its HP, and what
// it raises or that it waits in the ossuary, on the next, then its kin, role and camp row.
function unitRow (run, u, extra = null) {
  const d = unitDef(u.id)
  const more = d.monarch ? 'you' : u.slot < 0 ? 'ossuary' : ''
  const kin = !d.monarch && `${KIN[d.kin].name} ${ROLES[d.role].name}${u.slot >= 0 ? ` · ${campRowLabel(rowOf(u.slot)).toLowerCase()}` : ''}`
  const tiers = (u.tracks ?? []).filter(Boolean)
  return h('div', { class: 'unit' + (u.hp <= 0 ? ' fallen' : '') + (d.monarch ? ' monarch' : ''), tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run) }) },
    h('span', { class: 'rank-port ' + (d.monarch ? 'monarch' : 'g0') + (u.hp <= 0 ? ' fallen' : '') }, portrait(u.id, 40)),
    h('div', { class: 'grow' },
      h('div', { class: 'u-name' }, h('b', null, d.name), u.count > 1 && h('b', { class: 'u-count' }, ` ×${u.count}`), (!d.monarch || u.lvl > 0) && h('span', { class: 'dim' }, ` Lv ${u.lvl}`),
        tiers.length > 0 && h('span', { class: 'path-tag' }, ` tiers ${u.tracks.join('·')}`)),
      h('div', { class: 'line' }, hpBar(u), h('span', { class: 'dim' }, u.hp > 0 ? `${u.hp}/${u.maxHp}` : 'fallen', more && ` · ${more}`),
        kin && h('span', { class: 'dim u-kin' }, `· ${kin}`))),
    extra)
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
      const foes = w.foes.map((f) => ({ ...f, uid: f.slot }))
      const faces = [...new Map(foes.map((f) => [f.id, f])).values()].slice(0, 3)
      return h('span', { class: 'wave-chip' },
        h('b', { tip: () => h('div', { class: 'syn-tip' }, h('b', null, waveName(node, k)), ' ', waveWhen(w)) }, waveName(node, k)),
        faces.map((u) => h('span', {
          class: 'wc-face',
          tip: () => unitCard(u, { mods, foe: true, live: `${waveName(node, k)}: ${waveWhen(w).replace(/\.$/, '').toLowerCase()}`, notes: [waveWhen(w)] })
        }, portrait(u.id, 28))),
        h('span', { class: 'dim' }, `×${w.foes.reduce((n, f) => n + (f.count ?? 1), 0)}`))
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
