// Small DOM toolkit for the screens: element builder, the one shared tooltip, icons and portraits.
import { artUrl } from './content.js'

// h('div', { class: 'x', onclick, tip }, ...children). null and false children are skipped; `tip`
// is a function returning the tooltip's content, built when the pointer arrives.
export function h (tag, attrs, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue
    if (k === 'tip') tip(el, v)
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  return fill(el, ...kids)
}

// Replaces el's children the way h() adds them.
export function fill (el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((c) => c != null && c !== false).map((c) => (c.nodeType ? c : String(c))))
  return el
}

// ── tooltip ──────────────────────────────────────────────────────────────────────────────────────

// One floating panel for the whole page. It sits beside its anchor (right, else left, else below or
// above) and never leaves the viewport, nor covers the battle's playback bar.

const tipEl = h('div', { class: 'tip', role: 'tooltip' })
document.body.append(tipEl)
let anchor = null

export function tip (el, content) {
  const show = () => showTip(el, content)
  el.addEventListener('mouseenter', show)
  el.addEventListener('focus', show)
  el.addEventListener('mouseleave', hideTip)
  el.addEventListener('blur', hideTip)
  return el
}

// target: an element, or a { left, top, right, bottom } rect in viewport pixels. None while a soul is dragged.
export function showTip (target, content) {
  if (document.body.classList.contains('dragging')) return hideTip()
  anchor = target
  shown = content
  fill(tipEl, content())
  tipEl.classList.add('on')
  place()
}

// The tooltip on show, built again in place: Shift opens or closes a card's details (main.js).
let shown = null
export function refreshTip () {
  if (anchor && shown && tipEl.classList.contains('on')) showTip(anchor, shown)
}

function place () {
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor
  const vw = window.innerWidth
  // The bottom it keeps above: the viewport's, or the battle's playback bar's.
  const bar = document.querySelector('.battlebar')?.getBoundingClientRect()
  const vh = bar?.height ? Math.min(window.innerHeight, bar.top) : window.innerHeight
  const w = tipEl.offsetWidth
  const ht = tipEl.offsetHeight
  const gap = 10
  let x
  let y
  if (r.right + gap + w <= vw - 8) { x = r.right + gap; y = r.top }
  else if (r.left - gap - w >= 8) { x = r.left - gap - w; y = r.top }
  else {
    x = Math.min(Math.max(8, (r.left + r.right) / 2 - w / 2), vw - w - 8)
    y = r.bottom + gap + ht <= vh - 8 ? r.bottom + gap : r.top - gap - ht
  }
  tipEl.style.left = `${Math.round(x)}px`
  tipEl.style.top = `${Math.round(Math.max(8, Math.min(y, vh - ht - 8)))}px`
}

export function hideTip () {
  anchor = null
  tipEl.classList.remove('on')
}

// A re-render can remove the hovered element without a mouseleave; drop a tooltip left orphaned.
new MutationObserver(() => { if (anchor?.nodeType && !anchor.isConnected) hideTip() })
  .observe(document.body, { childList: true, subtree: true })
// A scroll or a resize moves an element out from under its tooltip, which follows it; a rect (a board tile, a
// unit in battle) is only where it was, so its tooltip goes until the pointer moves again.
const moved = () => {
  if (!anchor) return
  if (anchor.nodeType) place()
  else hideTip()
}
window.addEventListener('scroll', moved, true)
window.addEventListener('resize', moved)

// ── icons ────────────────────────────────────────────────────────────────────────────────────────

// 24×24 stroke icons, drawn in currentColor.
const PATHS = {
  start: '<circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8" stroke-dasharray="2 3"/>',
  fight: '<path d="M4 4l10.5 10.5M20 4L9.5 14.5M6.5 14l3.5 3.5M14 17.5l3.5-3.5M4 20l3-3M20 20l-3-3"/>',
  elite: '<path d="M12 3a7 7 0 0 0-7 7c0 2.6 1.4 4.3 3 5.3V19h8v-3.7c1.6-1 3-2.7 3-5.3a7 7 0 0 0-7-7z"/><circle cx="9.3" cy="10.5" r="1.4" fill="currentColor"/><circle cx="14.7" cy="10.5" r="1.4" fill="currentColor"/><path d="M10.5 19v2M13.5 19v2"/>',
  boss: '<path d="M3.5 18.5h17M4.5 18.5L3 8l5 4 4-7 4 7 5-4-1.5 10.5"/><circle cx="12" cy="14" r="1.2" fill="currentColor"/>',
  reliquary: '<path d="M6.5 3.5h11l3.5 5.5-9 11.5L3 9z"/><path d="M3 9h18M9 3.5L12 9l3-5.5M12 9v11.5"/>',
  rite: '<path d="M12 2.5l2.4 6.6h7l-5.7 4.2 2.2 6.7L12 15.9 6.1 20l2.2-6.7L2.6 9.1h7z" fill="none"/><circle cx="12" cy="12.2" r="2.2"/>',
  altar: '<path d="M12 3c2.2 3 4 4.6 4 7.5a4 4 0 0 1-8 0C8 7.8 10 6.2 12 3z"/><path d="M5 21h14M8 21v-5h8v5"/>',
  soul: '<path d="M12 3c3 3.5 6 6 6 10a6 6 0 0 1-12 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3 1-5.5 2-8.5z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.3-2.5 3.8"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>',
  release: '<path d="M12 21V9M7 13l5-5 5 5M5 4h14"/>',
  play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  skip: '<path d="M5 5l8 7-8 7zM13 5l8 7-8 7z" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  // The Monarch: a circlet under a crown of three flames.
  crown: '<path d="M5.5 20.5h13l-.8-4.5H6.3z"/><path d="M8.5 16c-1.6-1.8-1-3.8 0-5.2.4 1.4 1.4 2 1.4 2M12 16c-2.2-2.6-1.4-6 0-8.5 1.4 2.5 2.2 5.9 0 8.5M15.5 16c1.6-1.8 1-3.8 0-5.2-.4 1.4-1.4 2-1.4 2"/>',
  // A captain's rank insignia (GRADES): a Soldier's chevron, a Knight's shield, a Marshal's standard.
  soldier: '<path d="M6 15.5l6-6 6 6" stroke-width="2.4"/>',
  knight: '<path d="M12 3l7 2.8v5.4c0 4.6-3 7.9-7 9.8-4-1.9-7-5.2-7-9.8V5.8z" fill="currentColor" fill-opacity=".25"/><path d="M8.5 12.5l3.5-3.5 3.5 3.5"/>',
  marshal: '<path d="M6 21.5V2.5" stroke-width="2"/><path d="M6 3.5h13l-3.2 4.5 3.2 4.5H6z" fill="currentColor" fill-opacity=".3"/><path d="M10.5 8h4"/>',
  // A keystone: the wedge at the crown of an arch, holding up the stones on either side.
  keystone: '<path d="M8.6 3h6.8l-1.2 7.2H9.8z" fill="currentColor" fill-opacity=".25"/><path d="M8.6 3h6.8l-1.2 7.2H9.8z"/><path d="M8.8 5.2C5.6 6.6 3.5 9.8 3.5 13.5V21h4v-7c0-1.6 1-3 2.3-3.8M15.2 5.2c3.2 1.4 5.3 4.6 5.3 8.3V21h-4v-7c0-1.6-1-3-2.3-3.8"/>',
  // A siege: a crenellated wall and its gate, wave after wave against it.
  siege: '<path d="M3.5 20.5V9h3v2.5h3V9h5v2.5h3V9h3v11.5z"/><path d="M9.5 20.5v-4a2.5 2.5 0 0 1 5 0v4M3.5 4.5c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 3.5.4"/>',
  // Sound on (a speaker and its waves) and muted (the speaker crossed out).
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" fill-opacity=".25"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" fill-opacity=".25"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  // A unit card's stats: HP a heart, ATK a sword, DEF a shield, SPD a bolt.
  hp: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" fill="currentColor" fill-opacity=".25"/>',
  atk: '<path d="M19.5 4.5L10 14M19.5 4.5h-4M19.5 4.5v4M7 11.5l5.5 5.5M9.8 14.2l-4.6 4.6"/><circle cx="4.6" cy="19.4" r="1"/>',
  def: '<path d="M12 3l7 2.8v5.4c0 4.6-3 7.9-7 9.8-4-1.9-7-5.2-7-9.8V5.8z" fill="currentColor" fill-opacity=".2"/>',
  spd: '<path d="M13.5 2.5L5.5 13.5h6l-1 8 8-11h-6z" fill="currentColor" fill-opacity=".2"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  levelup: '<path d="M6 12.5l6-6 6 6M6 18.5l6-6 6 6"/>',
  // The Monarch's three stats: Dominion a domain's square, Command a banner, Will an open eye.
  dominion: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5" stroke-dasharray="3 2.2"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" fill-opacity=".35"/>',
  command: '<path d="M6 21.5V2.5"/><path d="M6 4h12v8l-3-2.2L12 12H6z" fill="currentColor" fill-opacity=".25"/>',
  will: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3" fill="currentColor" fill-opacity=".35"/>',
  // The end screen's tally: floors as stairs down, a recruit as a hooded soul, a bound body as a bone.
  stairs: '<path d="M3.5 6.5h4.5V11h4.5v4.5H17v4.5h3.5"/><path d="M3.5 20.5h17" stroke-opacity=".4"/>',
  hood: '<path d="M12 3c-4 0-6.5 3.6-6.5 8.2v9.3h13v-9.3C18.5 6.6 16 3 12 3z"/><path d="M9 13c0-2.2 1.3-3.8 3-3.8s3 1.6 3 3.8v2.5H9z" fill="currentColor" fill-opacity=".35"/>',
  bone: '<path d="M9.6 14.4l4.8-4.8"/><circle cx="6.4" cy="15.6" r="2"/><circle cx="8.4" cy="17.6" r="2"/><circle cx="15.6" cy="6.4" r="2"/><circle cx="17.6" cy="8.4" r="2"/>',
  // The rest of a card's stats: ACC a crosshair, EVA a dodge's swept lines, CRT a burst.
  acc: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  eva: '<path d="M4 7h9M2.5 12h8M4 17h9"/><path d="M14.5 5.5c3.5 1.5 5 4 5 6.5s-1.5 5-5 6.5" />',
  crt: '<path d="M12 2.5l1.8 6 6-1.8-4.2 4.8 4.2 4.8-6-1.8-1.8 6-1.8-6-6 1.8 4.2-4.8L4.2 6.7l6 1.8z" fill="currentColor" fill-opacity=".2"/>',
  // A plan's Where: Hunt a crosshair arrow, Stay an anchor post, Move a flag on its square.
  'o-hunt': '<path d="M4 20L18 6M18 6h-6M18 6v6"/><circle cx="18" cy="6" r="3.2" stroke-opacity=".5"/>',
  'o-stay': '<path d="M12 4v15"/><circle cx="12" cy="5" r="1.8"/><path d="M5 13c0 4 3 6.5 7 6.5s7-2.5 7-6.5M8.5 9h7"/>',
  'o-move': '<path d="M7 21V4"/><path d="M7 4.5h10l-2.5 3.5L17 11.5H7z" fill="currentColor" fill-opacity=".25"/><path d="M3.5 21h10" stroke-dasharray="2 2"/>',
  // A plan's When: at once a bolt, a time a clock, the Monarch struck a cracked crown, a wave, a body falling.
  'w-once': '<path d="M13.5 2.5L5.5 13.5h6l-1 8 8-11h-6z"/>',
  'w-time': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2.5"/>',
  'w-struck': '<path d="M4.5 18.5h15l-1-8-4 3-2.5-6-2.5 6-4-3z"/><path d="M13 3.5l-2 4 2.5 1.5-2 4" stroke-width="1.4"/>',
  'w-wave': '<path d="M2.5 9c2-2 4-2 6 0s4 2 6 0 4-2 7 0M2.5 15c2-2 4-2 6 0s4 2 6 0 4-2 7 0"/>',
  'w-falls': '<path d="M12 3.5v10M8 10l4 4 4-4"/><path d="M5 20.5h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
  // The prep tray's Bonuses tab: what is in effect, as a large spark and a small one.
  bonuses: '<path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" fill="currentColor" fill-opacity=".2"/><path d="M18 14l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
  // A glyph per relic (ui.js RELIC_ICON maps each relic id to its own), so no two tiles look alike.
  'r-whetstone': '<path d="M3.5 17.5h17l-2 3h-13z" fill="currentColor" fill-opacity=".25"/><path d="M6.5 14.5L18 3.5l1.8 1.8L9 16.3zM6.5 14.5l-2 2"/>',
  'r-banner': '<path d="M4 3.5h16"/><path d="M6.5 3.5v15l5.5-3.5 5.5 3.5v-15" fill="currentColor" fill-opacity=".2"/><circle cx="12" cy="8.5" r="2"/><path d="M11 10.5v1.5M13 10.5v1.5"/>',
  'r-lantern': '<path d="M9 5.5h6M12 2.5v3"/><path d="M8 7.5h8l-1 11H9z" fill="currentColor" fill-opacity=".15"/><path d="M7 20.5h10"/><path d="M12 10.5c1.4 1.6 1.7 3.1 0 4.6-1.7-1.5-1.4-3 0-4.6z" fill="currentColor"/>',
  'r-hourglass': '<path d="M6.5 3.5h11M6.5 20.5h11"/><path d="M8 3.5c0 4.5 4 5.5 4 8.5s-4 4-4 8.5M16 3.5c0 4.5-4 5.5-4 8.5s4 4 4 8.5"/><path d="M9.3 19h5.4L12 15.6z" fill="currentColor"/>',
  'r-heartwood': '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" fill="currentColor" fill-opacity=".15"/><path d="M12 18.5V9.5M12 14l-2.6-2.2M12 12.3l2.6-2.2"/>',
  'r-tower': '<path d="M6 3.5h12v11c0 3.3-2.7 5.5-6 7-3.3-1.5-6-3.7-6-7z" fill="currentColor" fill-opacity=".2"/><path d="M12 3.5v18M6 9h12"/>',
  'r-chalice': '<path d="M6 3.5h12c0 5-2.5 8-6 8s-6-3-6-8z" fill="currentColor" fill-opacity=".15"/><path d="M12 11.5v6M8 20.5h8M9.5 17.5h5"/><path d="M12 4.8c1.1 1.4 1.5 2.4 0 3.6-1.5-1.2-1.1-2.2 0-3.6z" fill="currentColor"/>',
  'r-drum': '<ellipse cx="12" cy="10" rx="7.5" ry="2.8" fill="currentColor" fill-opacity=".2"/><path d="M4.5 10v6.5c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9V10M5 13l3.5 5.5L12 13l3.5 5.5L19 13M7.5 2.5l3.5 5M16.5 2.5L13 7.5"/>',
  'r-balm': '<path d="M7 8h10v10.5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" fill="currentColor" fill-opacity=".15"/><path d="M8 4h8v4H8zM12 11v6M9 14h6"/>',
  'r-bowl': '<path d="M3.5 12.5h17c0 4.5-3.8 7.5-8.5 7.5s-8.5-3-8.5-7.5z" fill="currentColor" fill-opacity=".2"/><circle cx="9" cy="8.8" r="2.4"/><circle cx="15" cy="7.8" r="2.4"/><path d="M12 3.5v1.5"/>',
  'r-ledger': '<path d="M5 4.5h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z" fill="currentColor" fill-opacity=".15"/><path d="M5 17.5a2 2 0 0 1 2-2h11M9 8h6M9 11h4"/>',
  'r-candle': '<path d="M9 10.5h6v10H9z" fill="currentColor" fill-opacity=".2"/><path d="M6.5 20.5h11M12 8.5v2"/><path d="M12 2.8c1.7 1.9 2.1 3.7 0 5.7-2.1-2-1.7-3.8 0-5.7z" fill="currentColor"/>',
  'r-chain': '<rect x="2.6" y="8.6" width="10.4" height="6.2" rx="3.1" transform="rotate(-35 7.8 11.7)"/><rect x="11" y="9.2" width="10.4" height="6.2" rx="3.1" transform="rotate(-35 16.2 12.3)"/>',
  'r-key': '<circle cx="7.5" cy="12" r="4" fill="currentColor" fill-opacity=".2"/><circle cx="7.5" cy="12" r="1.3"/><path d="M11.5 12h9M17 12v3.5M20.5 12v2.5"/>',
  'r-oath': '<circle cx="12" cy="8.5" r="5" stroke-dasharray="2.4 1.8"/><path d="M12 2.5v14M8.5 16.5h7M12 16.5v3"/><circle cx="12" cy="20.5" r="1"/>',
  'r-focus': '<circle cx="12" cy="10" r="4.5" fill="currentColor" fill-opacity=".25"/><path d="M12 2v1.5M3 10h1.5M19.5 10H21M5.6 3.6l1.1 1.1M18.4 3.6l-1.1 1.1M8.5 20.5h7l-1.3-4.3H9.8z"/>',
  'r-claw': '<path d="M6.5 3.5c-1 5 0 11 3 17M12 3c-.5 5.5.5 11.5 3 17.5M17.5 3.5c-.2 5 .8 10 3 14"/>',
  'r-idol': '<path d="M12 3a5 5 0 0 0-5 5c0 1.8.9 3 2 3.7V14h6v-2.3c1.1-.7 2-1.9 2-3.7a5 5 0 0 0-5-5z" fill="currentColor" fill-opacity=".15"/><circle cx="10" cy="8.2" r="1" fill="currentColor"/><circle cx="14" cy="8.2" r="1" fill="currentColor"/><path d="M9.5 14v3M14.5 14v3M8 17h8M6.5 20.5h11"/>',
  'r-glass': '<path d="M4 18.5h16L21 8l-4.5 3.5L12 4.5l-4.5 7L3 8z" fill="currentColor" fill-opacity=".12"/><path d="M12 4.5v14M7.5 11.5l4.5 7 4.5-7"/>',
  'r-bell': '<path d="M12 3.5A5.5 5.5 0 0 0 6.5 9v5l-2 3.5h15l-2-3.5V9A5.5 5.5 0 0 0 12 3.5z" fill="currentColor" fill-opacity=".2"/><path d="M10 20a2 2 0 0 0 4 0M12 2v1.5"/>',
  'r-horn': '<path d="M3.5 7c4.5 0 7 1.3 9.5 4s5 4.5 7.5 4.5v4.5c-4.5 0-7.3-1.8-9.8-4.8S6.5 10.5 3.5 10.5z" fill="currentColor" fill-opacity=".2"/><path d="M3.5 7v3.5M7 9.5c1.2 3.2 3.8 6.3 7.5 7.8"/>'
}

export function icon (name, size = 18) {
  const span = document.createElement('span')
  span.className = 'ico'
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`
  return span
}

// ── portraits ────────────────────────────────────────────────────────────────────────────────────

// A unit's picture: the fallen are shown dead.
export function portrait (id, size = 32, dead = false) {
  return h('img', { class: 'portrait', src: artUrl(id, dead ? 'dead' : 'alive'), width: size, height: size, alt: '', draggable: 'false' })
}

// Per-viewer UI preferences (dismissed guides). Storage can be missing or blocked; then nothing sticks.
export const prefs = {
  get (key) { try { return localStorage.getItem('retinue:' + key) } catch { return null } },
  set (key, v) { try { localStorage.setItem('retinue:' + key, v) } catch {} }
}
