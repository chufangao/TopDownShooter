// The DOM side: the title, the run's screen (its Field, Map and Codex tabs), the spoils and the end, the playback
// bar and the panels beside the battle, and the parts they share. Screens only read run.state and report input
// upward; the Field sends its actions through act(action), which returns an error message or null. Every
// control has a tooltip saying exactly what it does (rules text lives in codex.js).
import { TUNING } from './tuning.js'
import {
  availableNodes, fieldCap, rosterCap, fielded, inOssuary, currentNode, souls, isMonarch, monarchOf, holds,
  reapedShadows, essenceByWave, canDescend, depthOf, OSSUARY, domainOf, soulCount, canAdvance, tierCost, canPlace, canFuse,
  fuseCost, fuseParts, relicCount, ariseHeld, offerGroup, onePick, levelOf, kindLevel, floorPrice
} from './sim/run.js'
import { RANKS, WIDTH } from './sim/map.js'
import { unitDef, relicDef, KIN, ROLES, FUSION_LIST, RELIC_TIERS } from './content.js'
import {
  COLS, ROWS, CAMP_ROWS, slotAt, rowOf, isWall, LANES, DEPTH, tileAt, deployTile, wallTiles, onField, tileX, tileY, ringOf,
  statsOf, abilitiesOf, distance, tracksOf, canTrack, bodiesOf, livingBodies, activeSynergies, sizeOf, footprint, footprintSlots,
  fits, campOpen, isMonarchCell, distanceBetween, holdOf, bodiesHp
} from './sim/unit.js'
import { field, stopLine } from './sim/battle.js'
import { h, fill, icon, portrait, prefs, showTip, hideTip, pinTip, hold, HOLD, touchy, say } from './dom.js'
import { kw, secs } from './keywords.js'
import { sfx } from './sfx.js'
// The Field's board: the battle's own, drawn in Phaser (board.js), under a layer that takes the pointer.
import { board } from './board.js'
// The page is scaled whole (frame.js): what is placed over it by a viewport point goes into the frame's px.
import { frame, toLocal } from './frame.js'
import {
  unitCard, partyMods, roomFoeMods, roomTip, threatMeter, foeSynergyLine, synergyTracker, synergyGroups, relicTip, ROOM, campRowLabel, realmOf,
  MONARCH_TEXT, MONARCH_RULE, WOUNDS_TEXT, deathText, tileText, fieldRule, foeCountText, waveName, waveWhen,
  ENEMY_TEXT, DEEP_TEXT, ROMAN, relicName, relicsByTier, aliasOf, TRIGGER_TEXT, codexView, ringText, ringRule, foeReach, bestiary, standing, abilityBlock,
  auraBlock, hpBar, poolHp, foeRulesOn
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
        step('crown', 'monarch', 'Stand', 'You never strike. The foes walk the ', kw('road', 'roads'), ' to you, and halt in your ', kw('ring', 'rings'), ' where they can strike back.'),
        step('fight', 'foe', 'Scout', say('Hover', 'Tap'), ' a room to see its foes. What they do, you learn by fighting.'),
        step('start', 'plan', 'Plan', 'Place your souls: each fights from its cell, and never moves. The battle then plays out alone.'),
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
  const n = soulCount(s.party)
  if (fresh) Object.assign(drawn, { run, essence: s.essence, hp: monarchOf(s).hp, souls: n, held: heldCounts(s) })
  const purse = h('b', null, Math.round(drawn.essence))
  const chip = h('span', { class: 'chip-stat essence', tip: () => `Essence: every foe slain pays it, by its tier. Spend it on your kinds' tiers, on fusions and on recruits; every price grows each floor down (here ×${+floorPrice(s.floor).toFixed(2)} its floor-1 price). ${s.stats.essence} earned, ${s.stats.spent} spent this run.` },
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
    t > 0 && h('div', { class: 'trinkets' + (t > 6 ? ' crowded' : '') },
      Object.keys(counts).map(tile)),
    h('div', { class: 'top-btns' }, muteButton(), helpButton(onHelp)))
}

// Each relic's own glyph (dom.js PATHS); a Legendary with none wears the wedge, any other the reliquary's.
const RELIC_ICON = {
  whetstone: 'r-whetstone', grave_banner: 'r-banner', soul_lantern: 'r-lantern', hourglass: 'r-hourglass', heartwood: 'r-heartwood',
  tower_shield: 'r-tower', blood_chalice: 'r-chalice', war_drum: 'r-drum', balm: 'r-balm', tithe_bowl: 'r-bowl', grave_ledger: 'r-ledger',
  rite_candle: 'r-candle', binding_chain: 'r-chain', ossuary_key: 'r-key', iron_oath: 'r-oath', arcane_focus: 'r-focus', hunters_mark: 'r-claw',
  bone_idol: 'r-idol', glass_crown: 'r-glass', grave_bell: 'r-bell', rally_horn: 'r-horn'
}
const relicIcon = (id) => RELIC_ICON[id] ?? (relicDef(id).tier === 'legendary' ? 'legendary' : 'reliquary')
// A Legendary's tag, its words' initials ("Court of Bone" CB), small words skipped.
const letterPair = (name) => name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('').slice(0, 2)

// Counts `el` from `from` to `to` (rounded as it goes), then flashes `host` (green for a gain, red for a
// loss); onStep sees every value drawn, so a re-render mid-roll carries on from where it got to. Reduced
// motion: it jumps, and still flashes.
function roll (el, from, to, host = el, onStep = null) {
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
      notes: [holds(run.state, 'unhealable')
        ? 'The Monarch is you. Its wounds carry from battle to battle, and under Court of Bone nothing heals them: not a win, not an altar.'
        : `The Monarch is you. Its wounds carry from battle to battle, as a soul's do: ${WOUNDS_TEXT}.`]
    })
  }, icon('crown', 20), h('b', null, `${m.hp}/${m.maxHp}`))
}

// The Field's gestures, taught one at a time in a slim pill atop the panel (never over the board), on every frame,
// each until it has been done once (remembered in this browser): select, then place a soul, then fuse.
const done = (k) => prefs.get('did:' + k) === '1'
const learnt = (k) => { if (!done(k)) prefs.set('did:' + k, '1') }

// ── the run's screen: Field · Map · Codex ───────────────────────────────────────────────────────

// The run between battles and before one, one screen with its three tabs folded into the top bar (DESIGN §4), one
// view at a time: the Field (the board, as large as the screen holds, and one slim panel beside it: the room and
// Begin, the selected piece's card, the ossuary at its foot like a Bloons TD shop), the Map (the floor's rooms:
// scout them, and on the map walk to the next) and the Codex (the rules, the words, the foes met). On the map the
// Map opens first; in a battle room's prep, the Field, their formation on it.
const TABS = [
  { id: 'field', name: 'Field', ico: 'field', key: 'F', desc: 'The board: place your souls, read the roads and your rings.' },
  { id: 'map', name: 'Map', ico: 'map', key: 'R', desc: 'The floor: scout its rooms.' },
  { id: 'codex', name: 'Codex', ico: 'codex', key: 'C', desc: 'The rules, the words and the foes you have met.' }]

// trail: node ids visited on this floor, in order (starts with the start node). onNode: walk to a room (the
// map's); onFight: Begin (prep's).
export function runScreen ({ run, act, trail, note = '', onNode = null, onFight = null, onHelp }) {
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
            ? h('div', { class: 'syn-tip' }, h('b', null, 'Begin the battle'), say(' (Enter)', ''), h('p', null, 'It plays out on its own: every piece fights from its cell, and only the foes move.'),
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
//   tap a piece            select it (its panel, its ring); tap it again, or empty ground, and the Monarch's
//                          panel is back (Escape too)
//   drag a piece           move it onto open ground (a 2×2 shows its four cells under the finger, red where
//                          they do not fit), onto a piece of its kind (a stack), onto another piece (they swap),
//                          or onto the bench to keep it in the ossuary; the Monarch never moves
//   drag a soul from the bench  place it; tap it, then an open camp tile, places it too
//   long press (touch)     the card of whatever is there, pinned

function fieldEditor ({ run, act, facing = null, onChange = null, head = null }) {
  const s = run.state
  const el = h('div', { class: 'retinue' })
  // The selection: { uid } a soul of yours or the Monarch (on the field or in the ossuary), { foe: slot } a
  // scouted foe, or null: the Monarch's panel.
  let sel = null
  let error = ''
  // A synergy whose chip was pressed: its pieces glow bright (synergyTracker's focus), until pressed again.
  let focusSyn = null
  const stage = h('div', { class: 'board-stage', 'aria-label': 'The board. Tap a piece to select it; drag a piece to move it. Keys: the arrows move a cursor, Enter taps, Escape lets go.' })
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
  const foes = facing?.foes ?? []
  const foeAt = (t) => foes.find((f) => deployTile('foe', f.slot) === t) ?? null
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
    if (!done('place') && inOssuary(souls(s.party)).some((u) => u.hp > 0) && !full()) return [h('b', null, 'Drag'), ' a soul from the ossuary onto the camp to field it']
    const ready = !done('fuse') && FUSION_LIST.find((f) => canFuse(run, f.id))
    if (ready && !(p && Object.hasOwn(ready.needs, p.id))) return [h('b', null, ready.name), ' can be made: ', tap.toLowerCase(), ' one of its parts, then ', h('b', null, 'Fuse')]
    return null
  }

  // ── the picture ──

  // Coverage (DESIGN §3): on every road tile (each open tile but the Monarch's), how many of `rings` (your standing
  // pieces', measured from their footprints; melee rings count too) reach it on the ground as far as they hold a foe
  // (their sight, unit.js holdOf: a ring whose far blows need a condition only as far as its other blows reach, as the
  // battle holds a foe). → an array by tile (0: none).
  function coverage (rings, dist) {
    const out = new Array(LANES * DEPTH).fill(0)
    for (let t = 0; t < out.length; t++) {
      if (!(dist[t] > 0 && Number.isFinite(dist[t]))) continue
      for (const g of rings) if (distanceBetween(g.tile, g.size, t, 1) <= g.ground) out[t]++
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
    // Your standing pieces' footprints and holds (unit.js holdOf: how far each one's sight holds a foe). Coverage
    // counts every piece's but the Monarch's; the stop line (DESIGN §3), where a walker coming down a road first comes
    // under one of them, the Monarch's among them: the earliest it can halt, never that it will (it halts only where it
    // can hit back).
    const rings = fieldNow.filter((u) => u.hp > 0).map((u) => ({ tile: deployTile('party', u.slot), size: sizeOf(u), monarch: isMonarch(u), ...holdOf(u) }))
    const cover = coverage(rings.filter((g) => !g.monarch), roads.dist)
    const stops = stopLine(roads, rings)
    for (const u of fieldNow) {
      const tile = deployTile('party', u.slot)
      units.push({
        key: `s${u.uid}`, id: u.id, tile, size: sizeOf(u), side: 'party', hp: u.hp, maxHp: u.maxHp, lvl: u.lvl, tracks: u.tracks, count: u.count, monarch: isMonarch(u),
        fallen: u.hp <= 0, sel: sel?.uid === u.uid, glow: groups.filter((g) => g.uids.has(u.uid)).map((g) => g.colour), lit: lit.has(u.uid)
      })
      for (const t of cellsOf(u)) tips.set(t, () => pieceTip(u))
    }
    // A foe of a kind met that flies hovers (the bestiary: its way is told once met).
    for (const f of foes) {
      const tile = deployTile('foe', f.slot)
      units.push({ key: `f${f.slot}`, id: f.id, tile, side: 'foe', hp: 1, maxHp: 1, lvl: f.lvl, count: f.count ?? 1, sel: sel?.foe === f.slot, flies: !!unitDef(f.id).flies && bestiary.has(f.id) })
      tips.set(tile, () => foeTip(f))
    }
    // Empty ground: what it is, whether Arise reaches it, how far its road runs to the Monarch, how many of your
    // rings cover it, and whether a walker first comes into them there.
    // Arise's reach (the domain) only while the run holds the relic: without it the domain does nothing, and is not
    // drawn or told.
    const dom = ariseHeld(s) ? domainOf(s) : -1
    for (let t = 0; t < LANES * DEPTH; t++) {
      if (tips.has(t)) continue
      const wall = walls.includes(t)
      const d = roads.dist[t]
      tips.set(t, () => h('div', { class: 'syn-tip tile-tip' },
        h('div', null, h('b', null, wall ? 'Wall' : sentence(tileText(t))), dom >= 0 && [' · ', distance(t, mTile) <= dom ? 'within Arise\'s reach' : h('span', { class: 'dim' }, 'beyond Arise\'s reach')]),
        h('div', { class: 'dim' }, wall ? 'It blocks walking, not shots: the roads bend round it.'
          : Number.isFinite(d) ? `Its road runs ${d} step${d === 1 ? '' : 's'} to the Monarch.` : 'No road runs from here.'),
        !wall && Number.isFinite(d) && h('div', { class: 'dim' }, cover[t] ? `${cover[t]} of your rings cover it.` : 'None of your rings covers it.'),
        stops.includes(t) && h('div', { class: 'dim' }, 'On the stop line: a foe walking this road comes into your rings here, the earliest it can halt in them. It halts only where it can strike something of yours.')))
    }
    // The selected piece's ring; a scouted foe's met kind, how far it shoots (codex.js foeReach): a foe has no melee
    // reach, so one whose every blow is melee draws none, and its panel says why.
    const ring = picked && onField(picked) && !isMonarch(picked) ? { tile: deployTile('party', picked.slot), r: ringOf(picked), size: sizeOf(picked) }
      : foe && bestiary.has(foe.id) ? { tile: deployTile('foe', foe.slot), r: foeReach(foe), foe: true } : null
    const moving = drag ? soulOf(drag.uid) : null
    const picture = {
      walls, units, domain: dom >= 0 ? { centre: mTile, r: dom } : null, roads: roads.arrow, ring, seat: mTile, cover, stops,
      drop: dropTiles(moving), dropSize: moving ? sizeOf(moving) : 1, selKey: picked && onField(picked) ? `s${picked.uid}` : foe ? `f${foe.slot}` : null
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
  // tile), a fallen one marked so where its HP bar would be (it waits for an altar); a piece dropped on the strip
  // goes to the ossuary. Its count, and the field's, at its head.
  function benchStrip () {
    const bench = inOssuary(s.party)
    const moving = drag ? soulOf(drag.uid) : null
    const target = moving && onField(moving) && !isMonarch(moving)
    return [
      h('div', {
        class: 'bench-label',
        tip: () => h('div', { class: 'syn-tip' }, h('b', null, `Ossuary · souls ${soulCount(s.party)}/${rosterCap(run)}`),
          h('p', null, `Your souls not on the field: kept, never fighting. The field takes ${fieldCap(run)} (${fieldRule(run)}). A piece that falls in battle comes here, freeing its cell, and lies fallen until an altar raises it.`),
          h('p', { class: 'dim' }, 'Drag a soul from here onto the camp, or a piece from the camp onto here. The Monarch never comes here.'))
      }, h('b', null, 'Ossuary'), h('span', { class: 'dim' }, `${bench.length ? `${bench.length} kept` : 'empty'} · field ${fielded(souls(s.party)).length}/${fieldCap(run)}`)),
      (bench.length || target) && h('div', { class: 'bench' + (target ? ' target' : '') + (drag?.target?.bench && drag.target.ok ? ' over' : '') },
        bench.length
          ? bench.map((u) => h('button', {
            class: 'cell has' + (sel?.uid === u.uid ? ' sel' : '') + (u.hp <= 0 ? ' fallen' : ''),
            'data-uid': u.uid,
            onpointerdown: (e) => pressBench(e, u),
            onclick: () => { if (swallow) { swallow = false; return } select(sel?.uid === u.uid ? null : { uid: u.uid }) },
            tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run), live: u.hp > 0 ? 'In the ossuary: it does not fight' : 'Fallen: an altar raises it', notes: [u.hp > 0 ? 'Drag it onto an open tile of the camp to field it.' : 'It fell in battle and lies in the ossuary: it cannot be fielded until an altar raises it.'] })
          }, portrait(u.id, 46, u.hp <= 0), u.count > 1 && h('span', { class: 'badge' }, `×${u.count}`), u.maxHp && u.hp > 0 && hpBar(u.hp, u.maxHp)))
          : h('span', { class: 'dim empty-bench' }, 'Drop it here to keep it in the ossuary.'))]
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

  // A piece's head: its picture (its full card on hover), name and count, level, kin and role, and its stats as
  // it fights now, its HP the stack's pool.
  function pieceHead (u, { mods, foe = false, sub = null }) {
    const d = unitDef(u.id)
    const st = statsOf(u, mods)
    const n = u.count ?? 1
    const [hp, maxHp] = poolHp(u, st)
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

  // Its abilities and its aura, each a line (the card's).
  const abilities = (u, st) => h('div', { class: 'uc-abs' }, abilitiesOf(u).map((id) => abilityBlock(id, st, realmOf(run))), auraBlock(u))

  // A soul's panel: its head; its stack (its bodies, splitting them off); where it stands (how to field it); its kind
  // (its level, read from its tiers, and the two tracks); Fuse (the recipes its kind is part of); its abilities; to
  // the ossuary.
  function soulPanel (u) {
    const mods = partyMods(run, u)
    const on = onField(u)
    return h('div', { class: 'uc' },
      pieceHead(u, { mods }),
      stackSection(u),
      !on && h('p', { class: 'dim uc-note' }, u.hp <= 0 ? 'Fallen, in the ossuary: it cannot be fielded until an altar raises it.'
        : full() ? fullText(u) : say('In the ossuary. Drag it onto an open tile of the camp, or click one.', 'In the ossuary. Drag it onto an open tile of the camp, or tap one.')),
      kindPanel(u.id),
      fuseSection(u.id),
      h('div', { class: 'uc-sec' }, 'Abilities'),
      abilities(u, statsOf(u, mods)),
      on && h('div', { class: 'uc-acts' },
        h('button', { class: 'ghost small', onclick: () => place(u, OSSUARY), tip: () => `Keep ${unitDef(u.id).name} out of battle, in the ossuary.` }, icon('bone', 18), 'To the ossuary')))
  }

  // A piece's stack (DESIGN §2.2): its bodies (the living ones, and those its kind's tiers add each battle), how
  // to add one (drag a soul of its kind onto it), and splitting bodies off, the hindmost first: one beside it
  // (while the field has room, and one of them stands: the fallen are fielded nowhere) or into the ossuary, or half
  // of them.
  function stackSection (u) {
    const n = u.count
    const alive = livingBodies(u)
    const extra = bodiesOf(u)
    const room = onField(u) && !full() && besideSlot(u) !== OSSUARY
    const stands = (k) => bodiesHp(u).slice(n - k).some((hp) => hp > 0)
    const kin = s.party.filter((x) => x !== u && x.id === u.id).length
    return h('div', { class: 'uc-stack' },
      h('div', { class: 'uc-sec' }, kw('stack', 'Stack'), h('span', { class: 'dim' }, ` · ${n} bod${n === 1 ? 'y' : 'ies'}${alive < n ? `, ${alive} standing` : ''}${extra ? `, +${extra} each battle (its tiers)` : ''}`)),
      n === 1 && h('p', { class: 'dim uc-note' }, kin ? `Drag another ${unitDef(u.id).name} onto it to stack them: one piece, one footprint, one pool.` : 'Recruit more of its kind to stack them: one piece, one footprint, one pool.'),
      n > 1 && h('div', { class: 'uc-acts' },
        room && stands(1) && h('button', { class: 'ghost small', onclick: () => splitOff(u, 1, true), tip: () => `Split one body off onto the open ${sizeOf(u) > 1 ? 'cells' : 'tile'} nearest it: a piece of its own.` }, icon('release', 16), 'Split 1 beside it'),
        h('button', { class: 'ghost small', onclick: () => splitOff(u, 1), tip: () => 'Split one body off into the ossuary: a piece of its own.' }, icon('bone', 16), 'Split 1 to the ossuary'),
        n > 3 && h('button', { class: 'ghost small', onclick: () => splitOff(u, Math.floor(n / 2), room && stands(Math.floor(n / 2))), tip: () => `Split ${Math.floor(n / 2)} bodies off into a piece of their own, ${room && stands(Math.floor(n / 2)) ? 'beside it' : 'in the ossuary'}.` }, 'Split in half')))
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
    const bodies = held.reduce((n, x) => n + x.count, 0)
    const tracks = tracksOf(id)
    const lvl = kindLevel(s, id)
    const tiers = k.tracks[0] + k.tracks[1]
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
        return h('button', {
          class: `tnode ${state}` + (tier.size === 2 ? ' colossus' : ''), 'aria-label': `${tr.name} ${ROMAN[i]}`, 'aria-disabled': i === have && can && s.essence >= cost ? null : 'true',
          onclick: (e) => { if (i === have && can) return buyTier(e, id, t, cost); if (i >= have) { sfx.play('poor'); shake(e) } },
          tip: () => h('div', { class: 'syn-tip' }, h('p', null, h('b', null, `${tr.name} ${ROMAN[i]}: `), tier.desc),
            i < have ? null : lock ? h('p', { class: 'warn' }, lockText) : i > have ? h('p', { class: 'dim' }, `After ${ROMAN[i - 1]}.`)
              : s.essence < cost ? h('p', { class: 'warn' }, `Needs ${cost} essence; you have ${s.essence}. ${rise}`) : h('p', { class: 'dim' }, `${cost} essence, for every ${name}. ${rise}`))
        }, h('span', { class: 'tnum' }, ROMAN[i]), tier.size === 2 && h('span', { class: 'tbadge' }, '2×2'))
      }
      return h('div', { class: 'track' + (have ? ' held' : '') + (t ? ' second' : '') },
        h('div', { class: 'track-head', tip: () => tr.desc }, h('b', null, tr.name), h('span', { class: 'track-desc dim' }, tr.desc)),
        h('div', { class: 'nodes' }, tr.tiers.map((tier, i) => [i > 0 && h('span', { class: 'tlink' + (i < have ? ' on' : '') }), node(tier, i)]),
          can && h('span', { class: 'tprice' + (s.essence < cost ? ' poor' : '') }, icon('soul', 16), cost)),
        h('div', { class: 'track-next' + (blocked ? ' warn' : '') }, have >= 4 ? 'Complete.' : blocked ? lockText : [h('b', null, `${ROMAN[have]} `), next.desc]))
    }
    return h('div', { class: 'uc-kind' },
      h('div', { class: 'uc-sec' }, `Every ${name}`, h('span', { class: 'dim' }, ` · ${held.length} piece${held.length === 1 ? '' : 's'}, ${bodies} bod${bodies === 1 ? 'y' : 'ies'}`)),
      h('div', {
        class: 'uc-level',
        tip: () => h('div', { class: 'syn-tip' }, h('p', null, h('b', null, `Level ${lvl}: `), `its tiers', never bought. ${TUNING.level.base} + ${TUNING.level.perTier} × the ${tiers} tier${tiers === 1 ? '' : 's'} it holds, rounded down${raw < lvl ? `, raised to ${lvl} by the kinds fused into it` : ''}.`),
          h('p', { class: 'dim' }, `Every ${name} stands at it, and a recruit joins at it. The next tier: ${rise.toLowerCase()}`))
      }, icon('levelup', 20), h('b', null, 'Level ', h('span', { class: 'num' }, lvl)), h('span', { class: 'dim' }, ' · rises with its tiers')),
      tracks.length === 2 && h('div', { class: 'tracks' }, tracks.map(row)))
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
  // (of the bodies each takes, how many you hold) and one button, lit when every part is held and the essence
  // suffices. The run picks the bodies (fuseParts: the ossuary's first, then the smallest stacks), splitting a bigger
  // stack for you; the fused piece waits in the ossuary, selected.
  function fuseSection (kind) {
    const recipes = FUSION_LIST.filter((f) => Object.hasOwn(f.needs, kind))
    if (!recipes.length) return null
    const held = (k) => souls(s.party).filter((x) => x.id === k).reduce((n, x) => n + x.count, 0)
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
    const partsText = (ps) => ps.map(({ uid, n }) => {
      const p = soulOf(uid)
      return `${n} ${unitDef(p.id).name}${n < p.count ? ` of a stack of ${p.count}` : ''}${onField(p) ? '' : ' (ossuary)'}`
    }).join(', ')
    return h('button', {
      class: 'buy' + (can ? '' : ' poor'), 'aria-disabled': can ? null : 'true', 'aria-label': `Fuse ${f.name}`,
      onclick: (e) => {
        if (!can) { sfx.play('poor'); return shake(e) }
        if (!send({ type: 'fuse', id: f.id, parts: fuseParts(run, f.id) })) return
        learnt('fuse')
        sfx.play('buy')
        sel = { uid: s.party.at(-1).uid }
        render()
      },
      tip: () => h('div', { class: 'syn-tip' }, h('b', null, f.name), ' ', f.desc,
        !parts ? h('p', { class: 'warn' }, 'Not every part is held yet.')
          : s.essence < cost ? h('p', { class: 'warn' }, `Needs ${cost} essence; you have ${s.essence}.`)
            : h('p', { class: 'dim' }, `It takes ${partsText(parts)}, for ${cost} essence; the ${unitDef(f.result).name} waits in the ossuary.`))
    }, icon('fuse', 18), 'Fuse', h('span', { class: 'price' }, icon('soul', 16), cost))
  }

  // A scouted foe's panel: its head with the floor's multipliers, its reach and way once met (in words too, since a
  // melee kind's no reach draws no ring on the board), its stack, its lore.
  function foePanel (f) {
    const mods = roomFoeMods(run, facing)
    const d = unitDef(f.id)
    return h('div', { class: 'uc foe' },
      pieceHead(f, { mods, foe: true, sub: `Enemy · Lv ${f.lvl} · ${d.kin ? `${KIN[d.kin].name} ` : ''}${ROLES[d.role].name}` }),
      h('p', { class: 'dim uc-note' }, ringRule(f, true)),
      f.count > 1 && h('p', { class: 'dim uc-note' }, ENEMY_TEXT.stack(f.count)),
      d.flavour && h('p', { class: 'flavour uc-note' }, d.flavour),
      h('div', { class: 'uc-sec' }, 'Abilities'),
      abilities(f, statsOf(f, mods)),
      h('p', { class: 'dim uc-note' }, 'Stats include this floor\'s multipliers and their synergies.'))
  }

  // The Monarch's panel, with nothing selected (DESIGN §4): a read-out, nothing to buy. Its HP and Command (the
  // relics give them: codex.js MONARCH_TEXT), and nothing else: Arise's numbers are the relic's, told on the
  // Monarch's card and the relic's once it is held. Then your synergies, each chip a press that lights its pieces
  // on the board.
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
    synergyTracker(souls(standing(run)), aliasOf(run), { focus: focusSyn, onFocus: (key) => { focusSyn = focusSyn === key ? null : key; render() } }),
    h('div', { class: 'uc-sec' }, 'The board'),
    h('ul', { class: 'legend-list dim' },
      h('li', null, h('i', { class: 'lg-road' }), kw('road', 'Roads'), ': the arrows the foes walk to the Monarch.'),
      h('li', null, h('i', { class: 'lg-cover' }), 'Coverage: each road tile shaded by how many of your ', kw('ring', 'rings'), ' reach it.'),
      h('li', null, h('i', { class: 'lg-stop' }), 'The stop line: where a foe walking a road first comes into your ', kw('ring', 'rings'), ': the earliest it can halt in them. It halts only where it can strike something of yours.'),
      h('li', null, h('i', { class: 'lg-seat' }), 'The crown: the Monarch\'s seat, the camp\'s own. It never moves.'),
      ariseHeld(s) && h('li', null, h('i', { class: 'lg-dom' }), relicName('arise'), '\'s reach: where a slain foe may rise for you.'))]
  }

  // ── tooltips ──

  const pieceTip = (u) => unitCard(u, {
    mods: partyMods(run, u), realm: realmOf(run),
    live: isMonarch(u) ? `${ariseHeld(s) ? `Arise reaches ${domainOf(s)} tiles · ` : ''}if it falls, the run ends` : 'It fights from its cell all battle',
    notes: [isMonarch(u) ? 'Its seat is the camp\'s, marked by the crown: it never moves.'
      : sel?.uid === u.uid ? 'Selected: its ring is drawn on the board.' : say('Drag it to move it; click it to select it.', 'Drag it to move it; tap it to select it.')]
  })
  const foeTip = (f) => unitCard(f, {
    mods: roomFoeMods(run, facing), foe: true,
    notes: ['Enemy. Stats include this floor\'s multipliers and their synergies.', f.count > 1 && ENEMY_TEXT.stack(f.count)]
  })
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

  // Why piece u cannot stand anchored at camp cell `slot` (run.js canPlace said no), in words.
  function placeRefusal (u, slot) {
    const name = unitDef(u.id).name
    if (u.hp <= 0) return `${name} has fallen: it lies in the ossuary until an altar raises it.`
    const other = coverAt(slot, u)
    const cells = footprintSlots(slot, sizeOf(u)) ?? []
    if (isMonarchCell(s.camp, slot) || (other && isMonarch(other)) || cells.some((c) => isMonarchCell(s.camp, c))) return 'The Monarch\'s seat is its own: nothing else stands on it.'
    if (isWall(s.camp, slot)) return 'A wall stands there: a piece stands on open ground.'
    if (!onField(u) && !other && full()) return fullText(u)
    if (other && onField(u)) return `${unitDef(other.id).name} has no room where ${name} stands now, so they cannot swap.`
    if (sizeOf(u) > 1) return `${name} is 2×2: it needs four open cells with nothing else on them (the red ones are not).`
    return `${name} does not fit there.`
  }

  // A piece onto another of its kind: one stack where `onto` stands.
  function stackOnto (u, onto) {
    if (sel?.uid === u.uid) sel = { uid: onto.uid }
    if (send({ type: 'stack', uid: u.uid, onto: onto.uid })) { sfx.play('place'); board.pop(`s${onto.uid}`) }
  }

  // `n` bodies off a piece, the hindmost, into a piece of their own: beside it while the field has room
  // (`beside`), else in the ossuary.
  function splitOff (u, n, beside = false) {
    const slot = beside ? besideSlot(u) : OSSUARY
    if (send({ type: 'split', uid: u.uid, n, slot })) sfx.play('place')
  }

  // The camp cell nearest piece u where a piece of its size fits (unit.js fits), the first in slot order on a tie;
  // OSSUARY if there is none.
  function besideSlot (u) {
    const taken = heldBut()
    const size = sizeOf(u)
    const at = deployTile('party', u.slot)
    let best = { slot: OSSUARY, d: Infinity }
    for (let slot = 0; slot < COLS * CAMP_ROWS; slot++) {
      if (!fits(s.camp, slot, size, taken)) continue
      const d = distanceBetween(at, size, deployTile('party', slot), size)
      if (d < best.d) best = { slot, d }
    }
    return best.slot
  }

  // The anchor a piece of u's size takes to cover camp cell `slot` (a tap on an open tile): the first of the
  // footprints over it that may be placed, else the cell itself.
  function anchorFor (u, slot) {
    if (sizeOf(u) === 1) return slot
    const [r, c] = [rowOf(slot), slot % COLS]
    const ways = [[r, c], [r, c - 1], [r + 1, c], [r + 1, c - 1]].filter(([y, x]) => y < CAMP_ROWS && x >= 0).map(([y, x]) => slotAt(y, x))
    return ways.find((a) => canPlace(run, u, a)) ?? slot
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

  // Whether piece `u` dropped on piece `o` stacks onto it (DESIGN §2.2): one kind, neither the Monarch.
  const stacks = (u, o) => !!o && o !== u && o.id === u.id && !isMonarch(u) && !isMonarch(o)
  // The tiles a piece may be dropped on, by its footprint's anchor: every camp cell it may be placed at (run.js
  // canPlace: it fits there, or swaps with the piece there), and every cell of a piece of its kind (a stack).
  function dropTiles (u) {
    if (!u || isMonarch(u)) return []
    const out = []
    for (let slot = 0; slot < COLS * CAMP_ROWS; slot++) {
      if (slot !== u.slot && (stacks(u, coverAt(slot, u)) || canPlace(run, u, slot))) out.push(deployTile('party', slot))
    }
    return out
  }

  // The drop under the pointer, and when it changes, what it would do (dragPreview) for the board to show. On the
  // board the tile is the footprint's anchor (board.js tileAt: for a 2×2, the cell under its rear-right quarter).
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

  // Where a drop would land: a camp cell (its footprint's anchor) with the board tiles the footprint would cover
  // (`cells`, those it cannot take in `bad`: off the camp, a wall, the seat, another piece's but the one it would
  // swap with), a tile past the camp (slot null: all of them bad), the bench or a soul on it, or nowhere (null);
  // and whether the rules take it (a refused one in the camp is still put down there, for its message).
  function dropAt (u, t, bench, onto) {
    if (bench) return { bench: true, onto, stack: stacks(u, onto) ? onto : null, ok: stacks(u, onto) || (!isMonarch(u) && onField(u)) }
    if (t == null) return null
    const slot = slotOfTile(t)
    const size = sizeOf(u)
    const [x, y] = [tileX(t), tileY(t)]
    const cells = []
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (x + dx < LANES && y + dy < DEPTH) cells.push(tileAt(x + dx, y + dy))
    // Past the camp: every cell red, and a drop there is let go of.
    if (slot == null) return { tile: t, slot, size, cells, bad: cells, stack: null, ok: false }
    const o = coverAt(slot, u)
    const stack = stacks(u, o) ? o : null
    if (stack) return { tile: t, slot, size, cells: cellsOf(o), bad: [], stack, ok: true }
    const held = heldBut(u, o)
    const whole = cells.length === size * size
    const bad = cells.filter((c) => {
      const sl = slotOfTile(c)
      return sl == null || !campOpen(s.camp, sl) || isMonarchCell(s.camp, sl) || held.has(sl) || (o && isMonarch(o))
    })
    return { tile: t, slot, size, cells, bad: whole ? bad : cells, stack: null, ok: slot === u.slot || canPlace(run, u, slot) }
  }

  // What a drop would make of the board: the footprint's cells, lit, red where they do not fit; a piece it would
  // displace shown ghosted where it would go.
  function dragPreview (u, target) {
    if (!target || target.bench) return { tile: null, ok: !!target?.ok, swap: null }
    const base = { tile: target.tile, size: target.size, cells: target.cells, bad: target.bad, ok: target.ok, stack: !!target.stack }
    if (!target.ok || target.stack || target.slot === u.slot) return { ...base, swap: null }
    const other = coverAt(target.slot, u)
    return { ...base, swap: other ? { key: `s${other.uid}`, id: other.id, size: sizeOf(other), to: onField(u) ? deployTile('party', u.slot) : null } : null }
  }

  // The drop: the move it stands for is made, or refused in words.
  function put (e) {
    overMove(e)
    const { uid, target } = drag
    cancelDrag(false)
    const u = soulOf(uid)
    if (!target || (!target.bench && target.slot == null)) { error = ''; return render() }
    if (target.stack) return stackOnto(u, target.stack)
    if (target.bench) {
      if (!onField(u)) return render()
      return target.onto && target.onto !== u ? place(target.onto, u.slot) : place(u, OSSUARY)
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

// The room whose cards were last dealt: a release re-shows the same room, and its cards should not deal in
// again. `seen`: the room's groups of offers as dealt; `on`: the group in view.
let dealt = null

// The offers come in groups (run.js offerGroup), one decision each, in this order: a recruit, a relic, a
// Legendary relic, a tier. Taking one offer of a group takes the group off the table; in a reliquary (onePick) its
// relics, Legendaries and tiers are one decision in all, laid out together, and taking any ends the room.
const GROUPS = ['soul', 'relic', 'legendary', 'tier']
const GROUP_NAME = { soul: 'Recruit', relic: 'Relic', legendary: 'Legendary', tier: 'Tier' }
const RELIC_TIER_NAME = Object.fromEntries(RELIC_TIERS.map((x) => [x.id, x.name]))

// onDone(index): take offer `index`, or null to move on. The offers are cards to pick, framed in their system's
// colour. A room with more than one group to take one of each shows them a group at a time behind a row of steps,
// each step its group's one line; every offer's key works from any step, and brings its group into view. A
// reliquary's one pick shows every card at once.
export function reapScreen ({ run, title, act, onDone, onHelp }) {
  const s = run.state
  const el = h('div', { class: 'screen fit reap-screen' })
  const full = () => soulCount(s.party) >= rosterCap(run)
  const blocked = (o) => o.type === 'soul' && (full() ? 'full' : o.cost > s.essence ? 'poor' : null)
  const room = `${s.floor}|${s.at}`
  let deal = !(dealt?.run === run && dealt.room === room)
  const groups = () => GROUPS.filter((g) => s.offers.some((o) => offerGroup(o) === g))
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
  // By touch a card is read before it is taken, as the map's rooms are entered (nothing needs a hover): the first
  // tap chooses it and pins its full text with Take ▸ (Recruit ▸) under it; a second tap on it, or the button,
  // takes it; a tap anywhere else lets it go. A mouse's click (its hover reads the card) and a card's key take it
  // at once.
  let chosen = null
  const choose = (card, o, i, tip) => {
    chosen = card
    card.classList.add('chosen')
    pinTip(card, () => [tip(), !blocked(o) && h('button', { class: 'primary small tip-act', onclick: () => { hideTip(); take(i) } }, o.type === 'soul' ? 'Recruit ▸' : 'Take ▸')], {
      keep: true,
      onHide: () => { card.classList.remove('chosen'); if (chosen === card) chosen = null }
    })
  }
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
        tip: () => `Recruit ${unitDef(o.id).name} for ${o.cost} essence as a body more in the ${unitDef(u.id).name}${u.count > 1 ? ` stack of ${u.count}` : ''} on ${tileText(deployTile('party', u.slot))}: one piece, one footprint, one pool.`
      }, portrait(o.id, 30), h('span', null, `${unitDef(o.id).name} ×${u.count} → ×${u.count + 1}`), h('span', { class: 'price' }, icon('soul', 16), o.cost))))
  }
  const has = (g) => s.offers.some((o) => offerGroup(o) === g)
  // Hollow Court: the shadows that stood at the end of the battle just won paid their essence again.
  const shades = ['fight', 'elite', 'siege'].includes(currentNode(run).type) ? reapedShadows(run) : []
  const reaped = shades.length > 0 && `Hollow Court: ${shades.length} shadow${shades.length === 1 ? '' : 's'} still stood, and paid ${shades.length === 1 ? 'its' : 'their'} essence again.`
  const part = {
    soul: () => ['Recruit one for ', kw('essence')],
    relic: () => ['Pick one ', kw('relic'), ', free'],
    legendary: () => ['Pick one Legendary ', kw('relic'), ', free'],
    tier: () => ['Take one ', kw('tier'), ', free']
  }
  // A reliquary: one pick in all, whatever its groups (run.js onePick).
  const single = onePick(run)
  const pickWords = { relic: 'a relic', legendary: 'a Legendary', tier: 'a tier' }
  const lede = () => single && groups().length > 1
    ? ['Take one, free: ', groups().map((g) => pickWords[g] ?? GROUP_NAME[g]).join(', ').replace(/, ([^,]*)$/, ' or $1'), '. ', say('The rest stays behind.', 'Tap one to read it, again to take it.')]
    : groups().map((g) => part[g]()).flatMap((p, k) => [k ? ' · ' : '', p])
  const ledeTip = () => h('div', { class: 'syn-tip' },
    has('soul') && h('p', null, 'A recruit rises whole, one body, at its kind\'s level: the field takes it if there is room, else the ossuary. One a battle.'),
    has('tier') && h('p', null, 'A tier, free: one kind\'s next tier of a track. Every soul of that kind holds it, and the kind\'s level rises with its tiers.'),
    single && h('p', null, 'A reliquary gives one thing: its relics, its Legendaries and its tiers are one pick in all.'))
  // The ⓘ after the lede (or the steps) holding those rules, if there are any.
  const ledeMore = () => ledeTip().childElementCount > 0 && h('span', { class: 'lede-more', tabindex: '0', tip: ledeTip }, icon('help', 22))
  // A battle of waves paid each wave as it fell: what each paid, relics included.
  const node = currentNode(run)
  const paid = node.waves?.length && run.battle ? essenceByWave(run.battle) : null
  const boost = 1 + s.relics.reduce((n, id) => n + (relicDef(id).essence ?? 0), 0)
  const wavePay = paid && h('p', { class: 'wave-pay', tip: () => 'Every foe slain paid essence into one purse; this is what each wave paid of it, relics included.' },
    icon('soul', 18), ' Paid wave by wave: ', paid.map((v, k) => [k ? ' · ' : '', `Wave ${k + 1}`, ' ', h('b', null, Math.round(v * boost))]))

  // What a tier more does to its kind's level (run.js levelOf: a kind's level is its tiers'), in words.
  const tierRise = (kind) => {
    const k = s.kinds[kind]
    const up = k ? levelOf({ ...k, tracks: [k.tracks[0] + 1, k.tracks[1]] }) : 0
    return k && up > kindLevel(s, kind) ? `, and the kind rises from level ${kindLevel(s, kind)} to ${up}` : ''
  }
  // A card: big art, the name, one line of effect; the rest is on the hover. A tier is a kind's (o.kind; its
  // track's name and tier are in its name).
  function card (o, i) {
    const why = blocked(o)
    const owned = o.type === 'soul' ? s.party.filter((u) => u.id === o.id).reduce((n, u) => n + u.count, 0) : 0
    const kind = o.type === 'tier' ? o.kind ?? s.party.find((u) => u.uid === o.uid)?.id : null
    const tip = o.type === 'soul'
      ? () => unitCard({ id: o.id, lvl: o.lvl, slot: -1 }, {
        // A click takes the card: a mouse reads its details on the hover itself, never under Shift.
        open: !touchy(),
        mods: partyMods(run),
        notes: [why === 'full' ? 'Your souls are at their most: release one first.' : why === 'poor' ? `You need ${o.cost} essence; you have ${s.essence}.` : `${say('Click', 'Tap it again (or Recruit ▸)')} to recruit it for ${o.cost} essence: a piece of its own, on the field if there is room, else in the ossuary.`,
          owned && `You already hold ${owned}.`, kin(o.id).length > 0 && 'Or recruit it onto a piece of its kind on the field: see under the cards.']
      })
      : o.type === 'relic' ? () => h('div', null, relicTip(o.id, run), h('p', { class: 'dim' }, `${say('Click', 'Tap it again (or Take ▸)')} to take it, free.${single ? ' The rest stays behind.' : ''}${keyNote(i)}`))
        : () => h('div', { class: 'syn-tip' }, h('b', null, o.name), ' ', o.desc, h('p', { class: 'dim' }, `Every ${unitDef(kind).name} you hold takes it, free${tierRise(kind)}.${say('', ' Tap it again (or Take ▸) to take it.')}${single ? ' The rest stays behind.' : ''}${keyNote(i)}`))
    const d = o.type === 'soul' && unitDef(o.id)
    const on = o.type === 'relic' && relicDef(o.id).on
    // A relic's card wears its tier (o-common … o-legendary) and says so; one already held says a copy stacks.
    const tier = o.type === 'relic' && relicDef(o.id).tier
    const copies = tier ? relicCount(s, o.id) : 0
    return cards[i] = h('button', { class: `offer o-${o.type}` + (tier ? ` o-${tier} rt-${tier}` : '') + (why ? ' locked' : ''), style: `--i:${i}`, onclick: (e) => (touchy() && chosen !== e.currentTarget ? choose(e.currentTarget, o, i, tip) : take(i)), 'aria-disabled': why ? 'true' : null, tip },
      h('div', { class: 'offer-tag' }, keyTag(i), h('span', { class: 'tag-word' }, ` ${tier ? RELIC_TIER_NAME[tier] : GROUP_NAME[o.type]}`)),
      h('div', { class: 'offer-art' }, o.type === 'relic' ? icon(relicIcon(o.id), 64) : portrait(o.type === 'soul' ? o.id : kind, 104),
        on && h('span', { class: 'trig-tag', tip: () => `Fires each time ${TRIGGER_TEXT[on].short}` }, TRIGGER_TEXT[on].name)),
      h('div', { class: 'offer-name' }, kind ? o.name.replace(`${unitDef(kind).name}: `, '') : o.name),
      kind && h('div', { class: 'offer-sub' }, `Every ${unitDef(kind).name}`),
      copies > 0 && h('div', { class: 'offer-sub' }, `Held ×${copies}: one more stacks`),
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
        const n = s.offers.filter((o) => offerGroup(o) === g).length
        return h('button', {
          class: `reap-step s-${g}` + (g === view.on ? ' on' : '') + (done ? ' done' : ''), role: 'tab',
          'aria-selected': g === view.on ? 'true' : 'false', 'aria-disabled': done ? 'true' : null,
          onclick: () => show(g),
          tip: () => done ? `${GROUP_NAME[g]}: done.` : `${GROUP_NAME[g]}: ${n} on the table.${say(' Every card\'s key works from any step. (← →)', '')}`
        },
        h('span', { class: 'rs-num' }, done ? '✓' : k + 1),
        h('span', { class: 'rs-text' }, h('b', null, GROUP_NAME[g]), h('span', { class: 'rs-part' }, done ? 'done' : part[g]())))
      }),
      ledeMore())
  }

  // Cards per row: up to `most` in one, more in rows as even as they come.
  const rowOf = (n, most) => (n <= most ? Math.max(n, 1) : Math.ceil(n / Math.ceil(n / most)))
  const most = () => Math.max(3, Math.min(6, Math.floor((frame.w - 44 + 18) / (168 + 18))))
  function render () {
    cards.length = 0
    const left = view.seen.filter((g) => groups().includes(g))
    const one = single || left.length < 2
    const on = one ? null : view.on
    const offers = s.offers.map((o, i) => (!on || offerGroup(o) === on) && card(o, i))
    const shown = s.offers.map((o, i) => ({ o, i })).filter(({ o }) => !on || offerGroup(o) === on)
    offers.filter(Boolean).forEach((c, k) => c.style.setProperty('--i', k))
    const next = on && left[left.indexOf(on) + 1]
    const picksN = offers.filter(Boolean).length
    const cols = rowOf(picksN, most())
    fill(el,
      topbar(run, onHelp),
      h('div', { class: 'reap-main' + (one ? '' : ' stepped') },
        h('div', { class: 'reap-head' },
          h('div', { class: 'reap-title' }, icon(has('soul') ? 'soul' : single ? 'reliquary' : has('tier') ? 'tier' : has('legendary') && !has('relic') ? 'legendary' : 'reliquary', 34), h('h1', null, title)),
          one
            ? h('p', { class: 'reap-lede' }, lede(), ledeMore())
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
      if (hit) { reveal(offerGroup(s.offers[hit[0]])); take(hit[0]) } else if (e.key === 's' || e.key === 'S') take(null)
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
function deathPanel (s, battle) {
  const d = deathText(s, battle)
  const m = monarchOf(s)
  const mine = m.slot >= 0 ? deployTile('party', m.slot) : null
  const from = s.death.reason === 'monarch' && s.death.uid !== m.uid ? s.death.from : null
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

// The battle keeps prep's layout, so the board does not move as one fades into the other: a thin strip over the
// board (the room, the wave under way, the escalation bar, always in view: DESIGN §2.8, the essence carried, the
// clock), and the slim panel beside it (the Monarch's HP, their synergies and yours, the rules as they strike,
// and at its foot pause, speed and skip, which change only how the battle is shown). The board takes the rest
// (stage: engine.js fits it there).
const SPEEDS = [1, 2, 4]

export function battleChrome ({ onHelp = null, node = null } = {}) {
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
  // The next wave's coming as the room's scouting tells it (codex.js waveWhen: a floor-1 elite's late pair at its set
  // time, any other wave once the last is down to its share or after its time); none after the last.
  const next = () => node?.waves?.[st.wave - 1]
  const wave = h('span', { class: 'wave-n', tip: () => h('div', { class: 'syn-tip' }, h('b', null, `Wave ${st.wave} of ${st.waves}`), ' ',
    next() ? [kw('wave', 'Next wave'), `: ${waveWhen(next()).replace(/^./, (c) => c.toLowerCase())}`] : 'No more come.') },
    icon('wave', 18), waveN)
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

// A soul in a list (the spoils' release list, the end screen): its name, level and tiers on one line; its HP, and
// that it is you or waits in the ossuary, on the next, then its kin, role and camp row.
function unitRow (run, u, extra = null) {
  const d = unitDef(u.id)
  const more = d.monarch ? 'you' : u.slot < 0 ? 'ossuary' : ''
  const kin = !d.monarch && `${KIN[d.kin].name} ${ROLES[d.role].name}${u.slot >= 0 ? ` · ${campRowLabel(rowOf(u.slot)).toLowerCase()}` : ''}`
  const tiers = (u.tracks ?? []).filter(Boolean)
  return h('div', { class: 'unit' + (u.hp <= 0 ? ' fallen' : '') + (d.monarch ? ' monarch' : ''), tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run) }) },
    h('span', { class: 'rank-port' + (d.monarch ? ' monarch' : '') + (u.hp <= 0 ? ' fallen' : '') }, portrait(u.id, 40)),
    h('div', { class: 'grow' },
      h('div', { class: 'u-name' }, h('b', null, d.name), u.count > 1 && h('b', { class: 'u-count' }, ` ×${u.count}`), !d.monarch && h('span', { class: 'dim' }, ` Lv ${u.lvl}`),
        tiers.length > 0 && h('span', { class: 'path-tag' }, ` tiers ${u.tracks.join('·')}`)),
      h('div', { class: 'line' }, hpBar(u.hp, u.maxHp), h('span', { class: 'dim' }, u.hp > 0 ? `${u.hp}/${u.maxHp}` : 'fallen', more && ` · ${more}`),
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

// The relics held as chips, one per relic in its tier's colour (×N for copies; a trigger relic marked with a
// spark), grouped by tier; hover one for its rule.
function relicList (ids, run = null) {
  if (!ids.length) return h('p', { class: 'dim small' }, 'None yet: reliquaries and won elites offer them.')
  return h('div', { class: 'relics by-tier' }, relicsByTier(ids, ({ id, n }) =>
    h('span', { class: `relic rt-${relicDef(id).tier}` + (relicDef(id).on ? ' trig' : ''), tip: () => relicTip(id, run) },
      icon(relicIcon(id), 14), relicDef(id).name, n > 1 && h('span', { class: 'relic-n' }, `×${n}`))))
}
