// The chrome the screens share: the run's top bar and its rolling counters, the sound's buttons, the corner's buttons,
// and the Field's gestures remembered once done.
import {
  unitCard, partyMods, relicTip, realmOf, MONARCH_TEXT, DEEP_TEXT, ROMAN, relicIcon, monarchHpText, ascensionText
} from '../codex.js'
import { unitDef, relicDef, MONARCHS } from '../content.js'
import { h, icon, prefs } from '../dom.js'
import { music } from '../music.js'
import { sfx } from '../sfx.js'
import {
  fieldCap, rosterCap, fielded, inOssuary, souls, monarchOf, depthOf, canAdvance, tierCost, relicCount, heldKinds,
  payPer, ascensionOf, priceScale
} from '../sim/run.js'
import { tracksOf } from '../sim/unit.js'
import { TUNING } from '../tuning.js'

// ── shared chrome ────────────────────────────────────────────────────────────────────────────────

// The run as a row of icons: floors, purse, the Monarch's HP, souls, a tile per relic held, then sound and help. It is
// rebuilt on every change: `drawn` keeps what it last showed, so a changed purse rolls and a relic just taken pops in.
const drawn = { run: null, essence: 0, hp: 0, souls: 0, held: {} }
// The copies held of each relic: { id: n }, in the order first taken.
const heldCounts = (s) => Object.fromEntries([...new Set(s.relics)].map((id) => [id, relicCount(s, id)]))

// `tabs`: the run's tabs, folded into the bar as compact icons, so the board keeps the screen's width.
export function topbar (run, onHelp, tabs = null) {
  const s = run.state
  const fresh = drawn.run !== run
  const n = souls(s.party).length
  if (fresh) Object.assign(drawn, { run, essence: s.essence, hp: monarchOf(s).hp, souls: n, held: heldCounts(s) })
  const purse = h('b', null, Math.round(drawn.essence))
  const chip = h('span', { class: 'chip-stat essence', tip: () => essenceTip(run) }, icon('soul', 20), purse)
  if (drawn.purse) cancelAnimationFrame(drawn.purse.rolling)
  drawn.purse = purse
  roll(purse, drawn.essence, s.essence, chip, (v) => { drawn.essence = v })
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
  // A relic's tile wears its glyph in its tier's colour; the Legendaries share one, told apart by a letter pair.
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
    // A column a tile, all but the last free to narrow.
    t > 0 && h('div', { class: 'trinkets', style: `grid-template-columns: ${t > 1 ? `repeat(${t - 1}, minmax(0, var(--tap))) ` : ''}var(--tap)` },
      Object.keys(counts).map(tile)),
    h('div', { class: 'top-btns' }, musicButton(), muteButton(), helpButton(onHelp)))
}

// Your souls by where they are: "4/5 on the field, 2 in the ossuary (1 fallen)".
export function ossuaryCount (run) {
  const all = souls(run.state.party)
  const kept = inOssuary(all)
  const fallen = kept.filter((u) => u.hp <= 0).length
  return `${fielded(all).length}/${fieldCap(run)} on the field, ${kept.length} in the ossuary${fallen ? ` (${fallen} fallen)` : ''}.`
}

// The purse's tooltip: essence held, earned and spent, the floor's prices, the cheapest tier now, a slain foe's pay.
function essenceTip (run) {
  const s = run.state
  const scale = priceScale(s)
  const next = heldKinds(s).flatMap((id) => [0, 1].filter((t) => canAdvance(s, id, t)).map((t) => ({ id, t, cost: tierCost(run, id, t) })))
    .sort((a, b) => a.cost - b.cost)[0]
  return h('div', { class: 'syn-tip' }, h('b', null, `${s.essence} essence`),
    h('p', null, `${s.stats.essence} earned, ${s.stats.spent} spent this run · ${scale === 1 ? 'floor 1 prices' : `prices ×${+scale.toFixed(2)} floor 1's`}` +
      `${ascensionOf(s).price !== 1 ? `, ascension ${s.ascension}'s ×${+ascensionOf(s).price.toFixed(2)} among them` : ''}.`),
    next && h('p', null, `Cheapest tier now: ${unitDef(next.id).name}, ${tracksOf(next.id)[next.t].name} ${ROMAN[s.kinds[next.id].tracks[next.t]]}, for ${next.cost}${next.cost > s.essence ? ` (${next.cost - s.essence} short)` : ''}.`),
    h('p', { class: 'dim' }, `A slain foe pays ${payPer(s.floor)} × its tier on this floor.`))
}

// A Legendary's tag, its words' initials ("Court of Bone" CB), small words skipped.
const letterPair = (name) => name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('').slice(0, 2)

// Counts `el` from `from` to `to`, then flashes `host` (green a gain, red a loss); onStep sees every value drawn, so a
// re-render mid-roll carries on from there. Reduced motion: it jumps, and still flashes.
export function roll (el, from, to, host = el, onStep = null) {
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

// Fredoka has no tabular figures: while a number rolls, its box is held as wide as its widest digits, so nothing jitters.
function holdWidth (el, from, to) {
  const n = Math.max(String(Math.round(from)).length, String(Math.round(to)).length)
  const text = el.textContent
  Object.assign(el.style, { minWidth: '', display: 'inline-block', textAlign: 'right' })
  let w = 0
  for (let d = 0; d < 10; d++) { el.textContent = String(d).repeat(n); w = Math.max(w, el.offsetWidth) }
  el.textContent = text
  el.style.minWidth = `${w}px`
}

// Sound on or off (M), remembered; it draws both icons and <html data-muted> shows the one that holds.
export function muteButton () {
  return h('button', {
    class: 'icon-btn mute-btn',
    'data-sfx': 'none',
    'aria-label': 'Sound on or off',
    onclick: () => { if (!sfx.toggle()) sfx.play('click') },
    tip: () => 'Sound on or off. (M)'
  }, icon('sound', 22), icon('mute', 22))
}

// Music on or off, remembered, heard only while sound is on; <html data-music> shows the icon that holds.
export function musicButton () {
  return h('button', {
    class: 'icon-btn music-btn',
    'data-sfx': 'none',
    'aria-label': 'Music on or off',
    onclick: () => { music.toggle(); sfx.play('click') },
    tip: () => music.on ? (sfx.muted ? 'Music on, but sound is off: the speaker brings both back.' : 'Music on or off. Its volume is in How to play.') : 'Music off: turn it on.'
  }, icon('music', 22), icon('nomusic', 22))
}

// The sound's settings, for How to play's foot: the effects and the music, each on or off, and the music's volume.
export function soundControls () {
  const toggle = (label, get, flip) => {
    const b = h('button', { class: 'small ghost snd-toggle', 'data-sfx': 'none', role: 'switch' })
    const shown = () => { b.setAttribute('aria-checked', get() ? 'true' : 'false'); b.textContent = `${label}: ${get() ? 'on' : 'off'}` }
    b.addEventListener('click', () => { flip(); shown(); sfx.play('click') })
    shown()
    return b
  }
  const vol = h('input', {
    type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(music.volume * 100)), 'aria-label': 'Music volume',
    oninput: (e) => { music.volume = Number(e.target.value) / 100 }
  })
  return h('div', { class: 'snd-ctl' },
    toggle('Sound', () => !sfx.muted, () => sfx.toggle()),
    toggle('Music', () => music.on, () => music.toggle()),
    h('label', { class: 'snd-vol' }, 'Music volume', vol))
}

// Sound and How to play in the corner of a screen with no top bar: a finger has no M or H key.
export function cornerButtons (onHelp) {
  return h('div', { class: 'corner-btns' }, musicButton(), muteButton(), helpButton(onHelp))
}
const helpButton = (onHelp) => h('button', { class: 'icon-btn', 'aria-label': 'How to play', onclick: onHelp, tip: () => 'How to play (H)' }, icon('help', 22))

// The floors: a pip each down to the Sovereign's, lit as cleared; past it, a deep pip and how far down.
function floorPips (s) {
  const n = TUNING.run.floors
  const deep = depthOf(s.floor)
  if (s.tutorial) return h('div', { class: 'floors', tip: () => 'The threshold: the tutorial\'s one room, before floor 1. It is never saved; the run proper begins from the title.' }, h('span', null, 'The threshold'))
  const asc = s.ascension ?? 0
  const ascTip = asc > 0 && h('p', null, h('b', null, `Ascension ${asc}`), `: ${ascensionText(asc).short}.`)
  return h('div', {
    class: 'floors' + (deep ? ' deep' : ''),
    tip: () => deep
      ? h('div', { class: 'syn-tip' }, h('b', null, `Floor ${s.floor} · the deep, ${deep} floor${deep === 1 ? '' : 's'} below the Sovereign's`), h('p', null, 'The run is cleared: the Hollow Sovereign fell to you, and that stands.'),
        h('p', null, DEEP_TEXT.now(s.floor)), h('p', { class: 'dim' }, DEEP_TEXT.growth), h('p', { class: 'warn' }, DEEP_TEXT.fall), ascTip)
      : h('div', { class: 'syn-tip' }, h('p', null, `Floor ${s.floor} of ${n}. Each floor ends in a boss, the one that answers what your army leans on most as the floor opens; floor ${n} ends with the Hollow Sovereign, and slaying it clears the run. Past it, you may descend into the deep.`), ascTip)
  },
  Array.from({ length: n }, (_, i) => h('span', { class: 'pip' + (i + 1 < s.floor ? ' done' : i + 1 === s.floor ? ' now' : '') })),
  deep > 0 && h('span', { class: 'pip deep now' }),
  h('span', null, `Floor ${s.floor}`, deep > 0 && h('span', { class: 'fl-deep' }, ` · deep ${deep}`), asc > 0 && h('span', { class: 'fl-asc' }, ` · A${asc}`)))
}

// The Monarch's HP, always in view; a wound or a heal since the bar was last drawn flashes it.
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
      notes: [MONARCH_TEXT.hp.rule(run)[0], run.state.monarch && `${MONARCHS[run.state.monarch].name}: ${MONARCHS[run.state.monarch].line}`]
    })
  }, icon('crown', 20), h('b', null, `${m.hp}/${m.maxHp}`))
}

// The Field's gestures, taught one at a time until each has been done once (remembered in this browser).
export const done = (k) => prefs.get('did:' + k) === '1'
export const learnt = (k) => { if (!done(k)) prefs.set('did:' + k, '1') }
