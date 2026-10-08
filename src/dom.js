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
// above) and never leaves the viewport.

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

// target: an element, or a { left, top, right, bottom } rect in viewport pixels.
export function showTip (target, content) {
  anchor = target
  fill(tipEl, content())
  tipEl.classList.add('on')
  const r = target.getBoundingClientRect ? target.getBoundingClientRect() : target
  const vw = window.innerWidth
  const vh = window.innerHeight
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
  tipEl.style.top = `${Math.round(Math.min(Math.max(8, y), vh - ht - 8))}px`
}

export function hideTip () {
  anchor = null
  tipEl.classList.remove('on')
}

// A re-render can remove the hovered element without a mouseleave; drop a tooltip left orphaned.
new MutationObserver(() => { if (anchor?.nodeType && !anchor.isConnected) hideTip() })
  .observe(document.body, { childList: true, subtree: true })

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
  siege: '<path d="M3.5 20.5V9h3v2.5h3V9h5v2.5h3V9h3v11.5z"/><path d="M9.5 20.5v-4a2.5 2.5 0 0 1 5 0v4M3.5 4.5c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 3.5.4"/>'
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
