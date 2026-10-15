// Small DOM toolkit for the screens: element builder, the one shared tooltip, icons and portraits.
import { artUrl, unitDef } from './content.js'
import { frame, toLocal, toLocalRect, onFrame } from './frame.js'

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
// above) and never leaves the frame, nor covers the battle's playback bar. It lives in the frame (frame.js), so
// it is laid out in logical px: the anchor's viewport rect is taken into the frame first.

const tipEl = h('div', { class: 'tip', role: 'tooltip' })
frame.el.append(tipEl)
let anchor = null

// A mouse or a pen shows an element's tooltip while over it (and the keyboard while focused on it); a finger
// shows it by a long press (hold), pinned until the next tap. A plain tap only does what the element does.
function tip (el, content) {
  el.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') showTip(el, content) })
  el.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && !pinned) hideTip() })
  // A tap focuses a button too: only the keyboard's focus (or a mouse's) shows the tooltip.
  el.addEventListener('focus', () => { if (!finger || focusVisible(el)) showTip(el, content) })
  el.addEventListener('blur', () => { if (!pinned) hideTip() })
  // Not inside the tooltip itself (a keyword on a card): there it would take the card's place.
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && e.isPrimary && !tipEl.contains(el)) hold(e, () => { pinTip(el, content); felt(el) })
  })
  // A mouse's click on a unit's card that is no control (a portrait, a row, a face in a wave) pins it as a long
  // press does by touch, so its details open by More ▾ and never need Shift (DESIGN §7).
  el.addEventListener('click', (e) => {
    if (finger || tipEl.contains(el) || e.target.closest?.(ACTIVE)) return
    if (content()?.classList?.contains('card-tip')) pinTip(el, content)
  })
  return el
}
const focusVisible = (el) => { try { return el.matches(':focus-visible') } catch { return true } }

// target: an element, or a { left, top, right, bottom } rect in viewport pixels. None while a soul is dragged.
// `pin` (a long press, a click on a card, pinTip): it stays after the finger lifts, until the next tap anywhere or
// a scroll.
export function showTip (target, content, pin = false) {
  if (document.body.classList.contains('dragging')) return hideTip()
  // A pinned tooltip stays over whatever the pointer passes; another pinned in its place goes first (its anchor
  // lets go, its details close).
  if (pinned && !pin) return
  if (pinned && target !== anchor) hideTip()
  anchor = target
  shown = content
  pinned = pin
  fill(tipEl, content())
  if (finger) touchWords(tipEl)
  if (pin) tipEl.append(moreButton() ?? '')
  tipEl.classList.add('on')
  tipEl.classList.toggle('pinned', pin)
  place()
}

// The tooltip on show, built again in place: Shift opens or closes a card's details (main.js).
let shown = null
export function refreshTip () {
  if (anchor && shown && tipEl.classList.contains('on')) showTip(anchor, shown, pinned)
}

// ── touch: the long press, the pinned tooltip, the wording ──

// Whether the last pointer was a finger (before any, a screen that cannot hover). The gestures and the wording
// ("Tap" or "Click", touchText) read it; a mouse moved again takes it back.
let finger = matchMedia('(hover: none)').matches
export const touchy = () => finger
// The text a guide or a hint shows: the mouse's words, or the finger's.
export const say = (mouse, touch) => (finger ? touch : mouse)

// The tooltips speak to the mouse and the keyboard ("Click to…", "(Enter)"); to a finger they say Tap, and
// drop the key in brackets (the button is the way).
const WORDS = [
  [/\b([Cc])lick(s|ed|ing)?\b/g, (_, c, end = '') => (c === 'C' ? 'T' : 't') + 'ap' + ({ s: 's', ed: 'ped', ing: 'ping' }[end] ?? '')],
  [/\bHover\b/g, 'Long-press'],
  [/\bhover\b/g, 'long press'],
  [/\s?\((?:⇧?[A-Z0-9?]|Enter|Esc|Space|[A-Z0-9] or [A-Z0-9?]+|S or Esc|← →|→|←|Shift)\)/g, '']
]
const touchText = (s) => WORDS.reduce((t, [re, to]) => t.replace(re, to), s)
function touchWords (el) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const t = touchText(n.nodeValue)
    if (t !== n.nodeValue) n.nodeValue = t
  }
}

// A long press: HOLD ms still (within SLOP px) under one finger. → { cancel }; fire() runs as it fires.
// Its release is then no tap: the click it would make is eaten (and a press that starts anew forgets that).
export const HOLD = 400
const SLOP = 8
const LATE = 50 // ms past HOLD a timer may run before the page counts as having been busy (hold)
export function hold (e, fire) {
  const { pointerId: id, clientX: x0, clientY: y0 } = e
  let live = true
  let waited = false
  // Under load (End Turn's foe turn, a preview) the page can be busy past HOLD: the timer then comes due beside a
  // lift already made but not yet dispatched, and may run first, turning a quick tap into a long press. A timer that
  // runs late waits a frame and a task for that lift to be read first.
  const check = () => {
    if (!live) return
    if (!waited && performance.now() - e.timeStamp > HOLD + LATE) {
      waited = true
      return requestAnimationFrame(() => setTimeout(check))
    }
    stop()
    eat = true
    navigator.vibrate?.(10)
    ring(x0, y0)
    fire(e)
  }
  const timer = setTimeout(check, HOLD)
  const move = (m) => { if (m.pointerId === id && Math.hypot(m.clientX - x0, m.clientY - y0) > SLOP) cancel() }
  const up = (m) => { if (m.pointerId === id) cancel() }
  function stop () {
    live = false
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', up, true)
  }
  function cancel () { clearTimeout(timer); stop() }
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', up, true)
  return { cancel }
}

// The tooltip pinned (a long press). `keep`: a tap on its anchor still goes through to it (a room on the map,
// tapped again, is entered); `onHide` runs when it goes (the room is let go of).
let pinned = false
let pinOpts = {}
export function pinTip (target, content, opts = {}) {
  showTip(target, content, true)
  if (pinned) pinOpts = opts
}
export const tipPinned = () => pinned

// A long press answered: the element swells a moment (touch.css), a ring spreads under the finger.
function felt (el) {
  el.classList.remove('held')
  void el.offsetWidth
  el.classList.add('held')
  setTimeout(() => el.classList.remove('held'), 400)
}
function ring (x, y) {
  const p = toLocal(x, y)
  const r = h('div', { class: 'hold-ring', 'aria-hidden': 'true', style: `left:${p.x}px;top:${p.y}px` })
  frame.el.append(r)
  setTimeout(() => r.remove(), 600)
}

// A card's details (Shift, held) on a pinned tooltip: More ▾ opens them, Less ▴ closes them. main.js links it to
// codex.js's tipDetail; only a tooltip with details (a unit card) shows it.
export const tipMore = { get: () => false, set: () => {} }
function moreButton () {
  if (!tipEl.querySelector('.card-tip')) return null
  const on = tipMore.get()
  return h('button', { class: 'tip-more small', onclick: () => tipMore.set(!on) }, on ? 'Less ▴' : 'More ▾')
}

// The click a long press would make, eaten; a new press forgets it. A press while a tooltip is pinned closes it
// and goes on to do what it would (a tap on a button presses it; on another room scouts it, on the board
// selects, a drag drags, a swipe scrolls, a long press pins the next tooltip). Its click is eaten only on nothing
// that answers a click (that tap just closes the tooltip). A tap inside it (on its buttons) acts as ever.
const ACTIVE = 'button, a, input, select, textarea, label, summary, [role="tab"], [tabindex], .node, .stage-wrap, .bench, #game'
let eat = false
window.addEventListener('pointerdown', (e) => {
  eat = false
  if (e.pointerType === 'touch') finger = true
  if (!pinned) return
  const t = e.target
  if (t.closest?.('.tip button')) return
  if (pinOpts.keep && anchor?.nodeType && anchor.contains(t)) return
  hideTip()
  if (t.closest?.(ACTIVE)) return
  eat = true
}, true)
window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') finger = false }, true)
window.addEventListener('click', (e) => {
  if (!eat) return
  eat = false
  e.stopPropagation()
  e.preventDefault()
}, true)
// A finger held down asks for the page's menu (Android) or a callout: the long press is the game's.
document.addEventListener('contextmenu', (e) => { if (finger && !e.target.closest?.('input, textarea')) e.preventDefault() })

function place () {
  const r = toLocalRect(anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor)
  const vw = frame.w
  const vh = frame.h
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
  tipEl.classList.remove('on', 'pinned')
  if (!pinned) return
  // A pinned tooltip gone: its details close again (a held Shift is the mouse's own), and its anchor lets go.
  const { onHide } = pinOpts
  pinned = false
  pinOpts = {}
  if (tipMore.get()) tipMore.set(false)
  onHide?.()
}

// A re-render can remove the hovered element without a mouseleave; drop a tooltip left orphaned.
new MutationObserver(() => { if (anchor?.nodeType && !anchor.isConnected) hideTip() })
  .observe(document.body, { childList: true, subtree: true })
// A scroll or a resize moves an element out from under its tooltip, which follows it; a rect (a board tile, a
// unit in battle) is only where it was, so its tooltip goes until the pointer moves again. A scroll closes a
// pinned one (but one inside it, of its own text).
const moved = (e) => {
  if (!anchor) return
  if (pinned && e?.type === 'scroll' && !tipEl.contains(e.target)) hideTip()
  else if (anchor.nodeType) place()
  else hideTip()
}
window.addEventListener('scroll', moved, true)
window.addEventListener('resize', moved)
onFrame(moved)

// ── icons ────────────────────────────────────────────────────────────────────────────────────────

// 24×24 stroke icons, drawn in currentColor by the art's hand: fat round strokes, no perfect circle or square (each a
// slightly uneven path), the most seen of them drawn wonky on purpose.
const PATHS = {
  start: '<path d="M12.2 8.6c2 .1 3.4 1.6 3.2 3.6-.2 1.9-1.8 3.2-3.6 3-1.9-.2-3.1-1.8-2.9-3.6.2-1.8 1.5-3.1 3.3-3z"/><path d="M12 3.8c4.6 0 8.3 3.6 8.2 8.3-.1 4.5-3.8 8.1-8.4 8-4.4-.1-8-3.8-7.9-8.2.1-4.6 3.6-8.2 8.1-8.1z" stroke-dasharray="2.2 3"/>',
  fight: '<path d="M4.2 4.4l10.4 10M19.8 3.9L9.3 14.7M6.3 14.4l3.6 3.4M14 17.9l3.7-3.5M4 20.3l3.1-2.9M20.2 20.1l-3-3.2"/>',
  elite: '<path d="M12.2 3c-4.2-.1-7.4 3-7.3 7.1.1 2.5 1.4 4.2 3 5.2V19h8.3v-3.8c1.7-1 2.9-2.9 2.9-5.3 0-4-3-6.8-6.9-6.9z"/><path d="M9.3 9c.9 0 1.6.7 1.6 1.6 0 .9-.7 1.5-1.6 1.5s-1.6-.7-1.6-1.6c.1-.9.7-1.5 1.6-1.5z" fill="currentColor" stroke="none"/><path d="M14.9 9c.9 0 1.6.7 1.6 1.6 0 .9-.7 1.5-1.6 1.5s-1.6-.7-1.6-1.6c.1-.9.7-1.5 1.6-1.5z" fill="currentColor" stroke="none"/><path d="M10.4 19v2.1M13.8 19v1.8"/>',
  boss: '<path d="M3.6 18.6h16.9M4.6 18.6L3.2 7.6l5.1 4.6 3.9-7.4 4.2 7.1 4.6-4.4-1.4 11.1"/><path d="M12.1 13.3c.7 0 1.2.5 1.2 1.2s-.6 1.2-1.3 1.2-1.1-.6-1.1-1.2c0-.7.5-1.2 1.2-1.2z" fill="currentColor"/>',
  reliquary: '<path d="M6.5 3.5h11l3.5 5.5-9 11.5L3 9z"/><path d="M3 9h18M9 3.5L12 9l3-5.5M12 9v11.5"/>',
  shop: '<path d="M4.4 8.6h15.2l-1.5 12h-12.3z"/><path d="M8.6 8.6V7.1c.1-2 1.6-3.6 3.5-3.6s3.4 1.6 3.4 3.7v1.4"/><path d="M12 12.1l1.7 2-1.6 2.3-1.7-2.2z"/>',
  tier: '<path d="M12 2.5l2.4 6.6h7l-5.7 4.2 2.2 6.7L12 15.9 6.1 20l2.2-6.7L2.6 9.1h7z" fill="none"/><path d="M14.2 12.3C14.2 13.5 13.2 14.6 11.9 14.5C10.6 14.5 9.7 13.4 9.7 12.1C9.8 10.9 10.9 10.1 12.1 10.1C13.2 10.2 14.2 11 14.2 12.3z"/>',
  altar: '<path d="M12 3c2.3 3.1 4.1 4.6 4 7.6-.1 2.2-1.8 3.9-4.1 3.9-2.2 0-3.9-1.8-3.9-4C8 7.9 10.1 6.2 12 3z"/><path d="M5 21.1h14.2M8.1 21v-5.1h8.1v5"/>',
  soul: '<path d="M12.4 3c3.1 3.4 5.9 6.1 5.8 10.1-.1 3.4-2.8 6-6.2 5.9-3.3-.1-5.9-2.8-5.8-6.1.1-1.9 1.1-3.3 2.1-4.3-.1 2 .9 3.1 2 3-.1-3 .9-5.7 2.1-8.6z"/>',
  help: '<path d="M12.2 3c5 .1 8.9 4.1 8.8 9.1-.1 4.9-4.2 8.9-9.2 8.8-4.9-.1-8.8-4.2-8.7-9.1.1-5 4.2-8.9 9.1-8.8z"/><path d="M9.4 9.4c.3-1.4 1.5-2.3 2.9-2.2 1.5.1 2.6 1.2 2.5 2.7-.1 1.9-2.6 2.2-2.6 3.9"/><path d="M12.2 16.3c.6 0 1 .4 1 1s-.5 1-1.1 1c-.5 0-.9-.5-.9-1 0-.6.4-1 1-1z" fill="currentColor"/>',
  release: '<path d="M12 21.1V9.1M6.9 13.2l5.1-5.1 4.9 4.9M5.1 4.1l13.9-.3"/>',
  play: '<path d="M7.8 4.8l11.4 7.1-11.1 7.3z" fill="currentColor"/>',
  pause: '<path d="M8.2 5.2v13.7M15.9 4.8v14.3" stroke-width="3.4"/>',
  skip: '<path d="M4.8 5.2l8.2 6.9-8 7.1zM12.9 4.9l8.3 7.2-8.1 6.9z" fill="currentColor"/>',
  undo: '<path d="M9.1 7L4.5 11.6l4.4 4.5"/><path d="M4.6 11.6h9.6c2.5 0 4.6 2 4.5 4.6-.1 2.4-2.1 4.3-4.6 4.3H10.2"/>',
  // A turn: a round, two arrows chasing (yours, then the foes'), a count and never an hourglass: there is no clock.
  turn: '<path d="M21.1 5.4v5h-5M2.9 18.6v-5h5"/><path d="M5 9.5a7.5 7.5 0 0 1 12.3-2.8l3.8 3.6M2.9 13.7l3.8 3.6a7.5 7.5 0 0 0 12.3-2.8"/>',
  close: '<path d="M6.2 5.9l11.7 12.3M18.1 6.1L5.8 17.9"/>',
  // The Monarch: a circlet under a crown of three flames.
  crown: '<path d="M5.5 20.6l13.1-.2-.9-4.5H6.2z"/><path d="M8.5 16c-1.7-1.9-1-3.9.1-5.3.3 1.5 1.3 2.1 1.3 2.1M12 15.9c-2.3-2.7-1.4-6.1.1-8.6 1.3 2.6 2.1 6-.1 8.6M15.6 16.1c1.5-1.9.9-3.7-.2-5.2-.3 1.4-1.4 1.9-1.4 1.9"/>',
  // A Legendary relic: the keystone, the wedge at the crown of an arch, holding up the stones on either side.
  legendary: '<path d="M8.6 3h6.8l-1.2 7.2H9.8z" fill="currentColor" fill-opacity=".25"/><path d="M8.6 3h6.8l-1.2 7.2H9.8z"/><path d="M8.8 5.2C5.6 6.6 3.5 9.8 3.5 13.5V21h4v-7c0-1.6 1-3 2.3-3.8M15.2 5.2c3.2 1.4 5.3 4.6 5.3 8.3V21h-4v-7c0-1.6-1-3-2.3-3.8"/>',
  // The battle bar's wave counter: two swells.
  wave: '<path d="M2.5 9.2c2-2.1 4.1-2 6 .1s4.1 1.9 6-.2 4.2-1.9 7 .3M2.6 15.1c2.1-2 4-1.9 6 0s4 2.1 6.1-.1 4.1-2 6.9.2"/>',
  // A siege: a crenellated wall and its gate, wave after wave against it.
  siege: '<path d="M3.5 20.5V9h3v2.5h3V9h5v2.5h3V9h3v11.5z"/><path d="M9.5 20.5v-4a2.5 2.5 0 0 1 5 0v4M3.5 4.5c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 3.5.4"/>',
  // Sound on (a speaker and its waves) and muted (the speaker crossed out).
  sound: '<path d="M4 9.6h3.6L12.1 5.4v13.3l-4.6-4.1H4z" fill="currentColor" fill-opacity=".25"/><path d="M15.6 8.9c1.9 1.6 1.9 4.6-.1 6.2M18.1 6.3c3.6 3.1 3.6 8.4-.2 11.4"/>',
  mute: '<path d="M4 9.6h3.6L12.1 5.4v13.3l-4.6-4.1H4z" fill="currentColor" fill-opacity=".25"/><path d="M16.1 9.4l4.8 5.2M21.1 9.6l-5.2 4.9"/>',
  // A unit card's stats: HP a heart, ATK a sword, DEF a shield (Move's footprints below).
  hp: '<path d="M12 20.2s-7.6-4.5-7.6-10.3c0-2.4 1.8-4.3 4.1-4.3 1.6 0 2.8.8 3.5 2 .8-1.4 2.2-2.4 3.9-2.3 2.2.1 3.8 2 3.6 4.4-.3 5.7-7.5 10.5-7.5 10.5z" fill="currentColor" fill-opacity=".25"/>',
  atk: '<path d="M19.6 4.4L9.9 14.1M19.6 4.4h-4.2M19.6 4.4v4.1M6.9 11.4l5.7 5.5M9.8 14.2l-4.7 4.7"/><path d="M4.5 18.2c.7-.1 1.3.5 1.3 1.2 0 .7-.6 1.2-1.3 1.2-.6 0-1.1-.6-1.1-1.2.1-.7.5-1.1 1.1-1.2z"/>',
  def: '<path d="M12.1 3l7 2.9v5.3c-.1 4.7-3.1 7.9-7.1 9.8-4-1.8-7.1-5.3-7-9.9V5.7z" fill="currentColor" fill-opacity=".2"/>',
  // Move: a piece's steps, two footprints and the way ahead.
  move: '<path d="M3 16.6h3.1M8.6 16.4h3"/><path d="M14 16.5h6.6M17.4 13.4l3.2 3.1-3.1 3.1"/><path d="M5.9 6.1c1 0 1.7 1.2 1.7 2.6 0 1.5-.8 2.7-1.8 2.6-1 0-1.6-1.2-1.6-2.6.1-1.5.7-2.6 1.7-2.6z" fill="currentColor" fill-opacity=".25"/><path d="M12.1 3.2c1.3 0 2.2 1.5 2.1 3.4 0 1.8-1 3.3-2.2 3.2-1.2 0-2.1-1.5-2-3.3 0-1.9.9-3.3 2.1-3.3z" fill="currentColor" fill-opacity=".25"/>',
  levelup: '<path d="M6 12.5l6-6 6 6M6 18.5l6-6 6 6"/>',
  // The Monarch's Command: a banner.
  command: '<path d="M6 21.5V2.5"/><path d="M6 4h12v8l-3-2.2L12 12H6z" fill="currentColor" fill-opacity=".25"/>',
  // The end screen's tally: floors as stairs down, a recruit as a hooded soul, the souls held as a bone.
  stairs: '<path d="M3.5 6.5h4.5V11h4.5v4.5H17v4.5h3.5"/><path d="M3.5 20.5h17" stroke-opacity=".4"/>',
  hood: '<path d="M12 3c-4 0-6.5 3.6-6.5 8.2v9.3h13v-9.3C18.5 6.6 16 3 12 3z"/><path d="M9 13c0-2.2 1.3-3.8 3-3.8s3 1.6 3 3.8v2.5H9z" fill="currentColor" fill-opacity=".35"/>',
  bone: '<path d="M9.6 14.4l4.8-4.8"/><path d="M8.4 16.2C8.1 17.3 6.9 17.7 5.9 17.4C4.9 17.2 4.1 16.1 4.4 15C4.7 14 5.9 13.5 6.9 13.8C7.9 14.1 8.8 15.1 8.4 16.2z"/><path d="M10.3 17.9C10.1 19 9.2 19.8 8.1 19.6C7 19.4 6.4 18.3 6.6 17.3C6.7 16.3 7.6 15.5 8.7 15.7C9.8 15.8 10.5 16.9 10.3 17.9z"/><path d="M17.6 6.5C17.6 7.6 16.7 8.6 15.5 8.5C14.4 8.5 13.5 7.5 13.5 6.3C13.5 5.2 14.6 4.5 15.7 4.5C16.7 4.5 17.7 5.3 17.6 6.5z"/><path d="M19.5 8C19.7 9 19.1 10.1 18 10.4C16.9 10.6 15.9 9.9 15.7 8.8C15.4 7.8 16 6.6 17.1 6.3C18.3 6.1 19.2 7 19.5 8z"/>',
  // The run's tabs: the Field a board of tiles, the Map a route of rooms, the Codex a book.
  // A 2×2 piece: four cells, a hair uneven.
  big: '<path d="M4.2 4.4h6.6l.1 6.4-6.7.1zM13.1 4.3l6.7.1-.1 6.5h-6.5zM4.1 13.2l6.6-.1.2 6.6-6.8.1zM13.2 13.1h6.5l.1 6.7-6.7-.1z" fill="currentColor" fill-opacity=".35"/>',
  field: '<path d="M4.3 3.6l15.8-.2c.3 0 .5.2.5.5l-.1 16.1c0 .3-.2.5-.5.5L4 20.6c-.3 0-.5-.2-.5-.5l.2-16c0-.3.3-.5.6-.5z"/><path d="M3.6 9.3h16.9M3.6 14.7l16.9.2M9.1 3.5l.2 17M14.9 3.4l-.1 17.1"/><path d="M12 16.3c.8 0 1.4.6 1.3 1.4 0 .7-.6 1.3-1.4 1.3-.7 0-1.3-.6-1.3-1.4.1-.7.7-1.3 1.4-1.3z" fill="currentColor"/>',
  map: '<path d="M5 15.3c1.3 0 2.3 1 2.2 2.3 0 1.2-1 2.2-2.3 2.1-1.2 0-2.1-1-2.1-2.2.1-1.3 1-2.2 2.2-2.2z"/><path d="M12.1 5.2c1 0 1.8.8 1.8 1.8s-.8 1.9-1.9 1.8c-1 0-1.8-.8-1.7-1.9 0-1 .8-1.7 1.8-1.7z"/><path d="M19 12.6c1.4 0 2.4 1.1 2.3 2.4 0 1.3-1.1 2.3-2.4 2.3-1.3-.1-2.2-1.1-2.2-2.4.1-1.3 1.1-2.3 2.3-2.3z"/><path d="M6.4 15.9l4.3-7.3M13.6 8.4l3.9 5.1" stroke-dasharray="2 1.8"/>',
  codex: '<path d="M4 5.6c2.7-1.4 5.4-1.3 8 .1v14c-2.6-1.4-5.3-1.4-8-.1zM20 5.4c-2.7-1.3-5.4-1.2-8 .3v14c2.6-1.5 5.3-1.4 8-.2z" fill="currentColor" fill-opacity=".15"/>',
  // A piece's reach: the tile it stands on in the square its blows reach.
  reach: '<path d="M5.3 3.7L17.2 3.2Q20.5 3.2 20.5 6.5L20.6 16.7Q20.6 20.4 17 20.4L6.6 20.6Q3.8 20.6 3.8 17.8L3.3 5.7Q3.3 3.7 5.3 3.7z" stroke-dasharray="3.2 2.2"/><path d="M14.6 12.1C14.6 13.6 13.2 14.6 11.9 14.5C10.5 14.4 9.2 13.4 9.3 11.8C9.3 10.3 10.7 9.3 12.1 9.4C13.6 9.5 14.7 10.7 14.6 12.1z" fill="currentColor"/>',
  // A fusion: three souls drawn into one.
  fuse: '<path d="M7.6 6.2C7.8 7.3 7.1 8.5 5.9 8.7C4.6 8.9 3.4 8.2 3.2 6.9C2.9 5.6 4 4.6 5.1 4.4C6.3 4.2 7.4 5 7.6 6.2z"/><path d="M20.8 6.2C20.9 7.5 19.9 8.4 18.7 8.6C17.6 8.7 16.6 7.9 16.5 6.7C16.3 5.6 17.1 4.5 18.3 4.3C19.4 4.2 20.6 5 20.8 6.2z"/><path d="M13.8 3.4C14.1 4.4 13.3 5.2 12.4 5.5C11.5 5.7 10.5 5.2 10.2 4.2C10 3.2 10.5 2.2 11.6 1.9C12.6 1.7 13.6 2.4 13.8 3.4z"/><path d="M7 8.5l3.2 4.2M17 8.5l-3.2 4.2M12 5.8v6"/><path d="M16.3 17.2C15.9 19.5 13.8 21.5 11.3 21.1C8.8 20.7 7.1 18.3 7.5 15.8C7.9 13.3 10.1 11.3 12.7 11.8C15.4 12.2 16.7 14.8 16.3 17.2z" fill="currentColor" fill-opacity=".25"/>',
  search: '<path d="M10.6 4.4c3.4.1 6 2.8 5.9 6.2-.1 3.3-2.8 5.9-6.2 5.8-3.3-.1-5.9-2.8-5.8-6.1.1-3.4 2.8-6 6.1-5.9z"/><path d="M15.1 15.1l5.5 5.6"/>',
  // The title's meta (redesign.md §4.8): the History a scroll of lines, the daily a calendar's page with its day marked.
  history: '<path d="M16.4 6.2l.1 12.2c0 1.3-1 2.3-2.3 2.3l-9.9.1c1.2 0 2.2-1 2.2-2.3L6.4 6c0-1.3 1-2.4 2.3-2.4l9.1-.1c1.3 0 2.3 1 2.3 2.3l-.1 1.5h-3.6" fill="currentColor" fill-opacity=".15"/><path d="M9.4 9.4l4.3-.1M9.5 12.6h4.1M9.4 15.8l2.7-.1"/>',
  daily: '<path d="M4.6 6.1l14.9-.2c.5 0 .9.4.9.9l-.1 12.8c0 .5-.4.9-.9.9L4.5 20.6c-.5 0-.9-.4-.9-.9l.1-12.7c0-.5.4-.9.9-.9z" fill="currentColor" fill-opacity=".15"/><path d="M3.8 10.4l16.5-.1M8.2 3.4v4.3M15.9 3.3v4.4"/><path d="M12 13.1c1 0 1.8.8 1.8 1.8s-.8 1.9-1.9 1.8c-1 0-1.8-.8-1.7-1.9 0-1 .8-1.7 1.8-1.7z" fill="currentColor"/>',
  // A glyph per relic (ui.js RELIC_ICON maps each relic id to its own), so no two tiles look alike.
  'r-whetstone': '<path d="M3.5 17.5h17l-2 3h-13z" fill="currentColor" fill-opacity=".25"/><path d="M6.5 14.5L18 3.5l1.8 1.8L9 16.3zM6.5 14.5l-2 2"/>',
  'r-banner': '<path d="M4 3.5h16"/><path d="M6.5 3.5v15l5.5-3.5 5.5 3.5v-15" fill="currentColor" fill-opacity=".2"/><path d="M14.1 8.8C13.9 9.9 12.8 10.6 11.8 10.4C10.7 10.3 9.7 9.4 9.9 8.2C10 7.1 11.1 6.4 12.3 6.5C13.4 6.6 14.2 7.6 14.1 8.8z"/><path d="M11 10.5v1.5M13 10.5v1.5"/>',
  'r-lantern': '<path d="M9 5.5h6M12 2.5v3"/><path d="M8 7.5h8l-1 11H9z" fill="currentColor" fill-opacity=".15"/><path d="M7 20.5h10"/><path d="M12 10.5c1.4 1.6 1.7 3.1 0 4.6-1.7-1.5-1.4-3 0-4.6z" fill="currentColor"/>',
  'r-hourglass': '<path d="M6.5 3.5h11M6.5 20.5h11"/><path d="M8 3.5c0 4.5 4 5.5 4 8.5s-4 4-4 8.5M16 3.5c0 4.5-4 5.5-4 8.5s4 4 4 8.5"/><path d="M9.3 19h5.4L12 15.6z" fill="currentColor"/>',
  'r-heartwood': '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" fill="currentColor" fill-opacity=".15"/><path d="M12 18.5V9.5M12 14l-2.6-2.2M12 12.3l2.6-2.2"/>',
  'r-tower': '<path d="M6 3.5h12v11c0 3.3-2.7 5.5-6 7-3.3-1.5-6-3.7-6-7z" fill="currentColor" fill-opacity=".2"/><path d="M12 3.5v18M6 9h12"/>',
  'r-chalice': '<path d="M6 3.5h12c0 5-2.5 8-6 8s-6-3-6-8z" fill="currentColor" fill-opacity=".15"/><path d="M12 11.5v6M8 20.5h8M9.5 17.5h5"/><path d="M12 4.8c1.1 1.4 1.5 2.4 0 3.6-1.5-1.2-1.1-2.2 0-3.6z" fill="currentColor"/>',
  'r-drum': '<path d="M18.9 10.3C18.5 11.7 15.1 12.8 11.2 12.7C7.2 12.5 3.6 11.3 4.1 9.7C4.6 8 8.8 7.1 12.9 7.2C16.9 7.4 19.4 8.9 18.9 10.3z" fill="currentColor" fill-opacity=".2"/><path d="M4.5 10v6.5c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9V10M5 13l3.5 5.5L12 13l3.5 5.5L19 13M7.5 2.5l3.5 5M16.5 2.5L13 7.5"/>',
  'r-balm': '<path d="M7 8h10v10.5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" fill="currentColor" fill-opacity=".15"/><path d="M8 4h8v4H8zM12 11v6M9 14h6"/>',
  'r-bowl': '<path d="M3.5 12.5h17c0 4.5-3.8 7.5-8.5 7.5s-8.5-3-8.5-7.5z" fill="currentColor" fill-opacity=".2"/><path d="M11.4 9.4C11.1 10.7 9.7 11.3 8.5 11C7.3 10.7 6.3 9.6 6.6 8.3C6.9 7 8.2 6 9.6 6.3C11 6.6 11.8 8 11.4 9.4z"/><path d="M17.1 7.1C17.5 8.2 17 9.6 15.8 10C14.6 10.5 13.2 9.8 12.8 8.6C12.4 7.4 12.9 5.9 14.2 5.5C15.5 5 16.7 5.9 17.1 7.1z"/><path d="M12 3.5v1.5"/>',
  'r-ledger': '<path d="M5 4.5h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z" fill="currentColor" fill-opacity=".15"/><path d="M5 17.5a2 2 0 0 1 2-2h11M9 8h6M9 11h4"/>',
  'r-candle': '<path d="M9 10.5h6v10H9z" fill="currentColor" fill-opacity=".2"/><path d="M6.5 20.5h11M12 8.5v2"/><path d="M12 2.8c1.7 1.9 2.1 3.7 0 5.7-2.1-2-1.7-3.8 0-5.7z" fill="currentColor"/>',
  'r-chain': '<path d="M5.6 8.7L9.6 8.9Q12.7 8.9 12.7 12L12.9 11.5Q12.9 14.6 9.8 14.6L5.7 14.8Q2.6 14.8 2.6 11.7L2.8 11.5Q2.8 8.7 5.6 8.7z" transform="rotate(-35 7.8 11.7)"/><path d="M14.3 9L18.4 9.5Q21.5 9.5 21.5 12.6L21.3 13Q21.3 15.5 18.7 15.5L13.8 15.4Q10.7 15.4 10.7 12.3L11.2 12.1Q11.2 9 14.3 9z" transform="rotate(-35 16.2 12.3)"/>',
  'r-key': '<path d="M11.3 12.3C11.1 14.4 9.4 16.4 7.1 16.2C4.8 16 3.4 13.8 3.6 11.7C3.8 9.5 5.8 8.2 7.8 8.3C9.8 8.5 11.4 10.3 11.3 12.3z" fill="currentColor" fill-opacity=".2"/><path d="M8.8 12.3C8.6 13.1 7.9 13.4 7.2 13.3C6.5 13.1 6.1 12.3 6.3 11.7C6.5 11 7.1 10.5 7.8 10.7C8.5 10.9 9 11.6 8.8 12.3z"/><path d="M11.5 12h9M17 12v3.5M20.5 12v2.5"/>',
  'r-oath': '<path d="M16.6 8.8C16.5 11.4 14.4 13.6 11.7 13.5C8.9 13.3 6.5 11 6.7 8.1C6.9 5.2 9.7 3.5 12.3 3.7C15 3.9 16.8 6.3 16.6 8.8z" stroke-dasharray="2.4 1.8"/><path d="M12 2.5v14M8.5 16.5h7M12 16.5v3"/><path d="M12.9 20.3C13.1 20.8 12.7 21.4 12.2 21.5C11.7 21.6 11.1 21.2 11 20.7C10.9 20.2 11.2 19.6 11.8 19.5C12.3 19.4 12.8 19.8 12.9 20.3z"/>',
  'r-focus': '<path d="M16 8.8C16.7 11 15.8 13.7 13.3 14.5C10.9 15.2 8.5 13.6 7.8 11.3C7.1 8.9 8.1 6.1 10.6 5.4C13.2 4.6 15.4 6.6 16 8.8z" fill="currentColor" fill-opacity=".25"/><path d="M12 2v1.5M3 10h1.5M19.5 10H21M5.6 3.6l1.1 1.1M18.4 3.6l-1.1 1.1M8.5 20.5h7l-1.3-4.3H9.8z"/>',
  'r-claw': '<path d="M6.5 3.5c-1 5 0 11 3 17M12 3c-.5 5.5.5 11.5 3 17.5M17.5 3.5c-.2 5 .8 10 3 14"/>',
  'r-idol': '<path d="M12 3a5 5 0 0 0-5 5c0 1.8.9 3 2 3.7V14h6v-2.3c1.1-.7 2-1.9 2-3.7a5 5 0 0 0-5-5z" fill="currentColor" fill-opacity=".15"/><path d="M11 8.1C11 8.6 10.7 9.2 10.1 9.2C9.6 9.3 9.1 8.8 9.1 8.3C9 7.8 9.3 7.3 9.9 7.2C10.4 7.1 10.9 7.5 11 8.1z" fill="currentColor" stroke="none"/><path d="M15 8.4C14.8 8.9 14.3 9.3 13.8 9.2C13.2 9.1 13 8.5 13.1 8C13.2 7.5 13.7 7.1 14.2 7.2C14.8 7.3 15.1 7.9 15 8.4z" fill="currentColor" stroke="none"/><path d="M9.5 14v3M14.5 14v3M8 17h8M6.5 20.5h11"/>',
  'r-glass': '<path d="M4 18.5h16L21 8l-4.5 3.5L12 4.5l-4.5 7L3 8z" fill="currentColor" fill-opacity=".12"/><path d="M12 4.5v14M7.5 11.5l4.5 7 4.5-7"/>',
  'r-bell': '<path d="M12 3.5A5.5 5.5 0 0 0 6.5 9v5l-2 3.5h15l-2-3.5V9A5.5 5.5 0 0 0 12 3.5z" fill="currentColor" fill-opacity=".2"/><path d="M10 20a2 2 0 0 0 4 0M12 2v1.5"/>',
  'r-horn': '<path d="M3.5 7c4.5 0 7 1.3 9.5 4s5 4.5 7.5 4.5v4.5c-4.5 0-7.3-1.8-9.8-4.8S6.5 10.5 3.5 10.5z" fill="currentColor" fill-opacity=".2"/><path d="M3.5 7v3.5M7 9.5c1.2 3.2 3.8 6.3 7.5 7.8"/>'
}

export function icon (name, size = 18) {
  const span = document.createElement('span')
  span.className = 'ico'
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`
  return span
}

// ── how a kind is drawn ──────────────────────────────────────────────────────────────────────────

// Every picture is drawn on a square box, its feet at FEET of its height (engine.js reads it from here).
export const FEET = 11 / 12
// A kind that borrows another's pictures (content.js `art`, until its own are drawn) is drawn as what it is
// (redesign.md §4.1), never as the kind it borrows from. A trine is drawn as the three it was made of (`trineOf`):
// the front one whole, two behind it a step up and to either side (BACK), smaller and darker, each drawn as it is
// itself (a trine of a trine: three trines, seven figures, the two that would stand on one another drawn once). A
// fused kind that is no trine (a capstone) is its lender washed in WASH's pale ice. A kind with pictures of its own (the
// Pale Court, the Wisp's written trine) is drawn by them. The board and the battle draw a kind's figures as one picture
// (engine.js artOf), the screens as one portrait (portrait).
// → [{ art, x, y, k, dim, wash }], back to front: `art` a picture's kind, `x`, `y` where its feet stand from the
// front one's (in heights of a picture), `k` its scale, `dim` the share of its light it keeps, `wash` whether WASH
// takes it.
const BACK = { x: 0.24, y: -0.1, k: 0.78, dim: 0.7 }
const FIGURES = new Map()
export function figures (id) {
  if (FIGURES.has(id)) return FIGURES.get(id)
  const d = unitDef(id)
  let figs = [{ art: d.art, x: 0, y: 0, k: 1, dim: 1, wash: false }]
  if (d.art !== d.id && d.trineOf) {
    const one = figures(d.trineOf)
    const at = (x, y, k, dim) => one.map((f) => ({ ...f, x: x + f.x * k, y: y + f.y * k, k: f.k * k, dim: Math.max(0.5, f.dim * dim) }))
    const all = new Map()
    for (const f of [...at(-BACK.x, BACK.y, BACK.k, BACK.dim), ...at(BACK.x, BACK.y, BACK.k, BACK.dim), ...at(0, 0, 1, 1)]) {
      all.set([f.x, f.y, f.k].map((v) => v.toFixed(3)).join(), f)
    }
    figs = [...all.values()].sort((a, b) => a.k - b.k || a.y - b.y)
  } else if (d.art !== d.id && d.fused) figs = figures(d.art).map((f) => ({ ...f, wash: true }))
  FIGURES.set(id, figs)
  return figs
}
// Whether kind `id` is drawn by a picture as it is (its own or a plain borrowed one): no figures to make.
export const plainFigure = (id) => figures(id).length === 1 && !figures(id)[0].wash
// The wash a capstone wears over its lender's pictures, a colour matrix (feColorMatrix's, rows r g b a of
// r g b a 1): `k` of each pixel's colour given over to the tint at the pixel's light (a white to the tint's own pale),
// the rest kept, so its ink stays ink and its fills go ice. The same numbers wash its portrait (an SVG filter) and its
// pictures on the board (engine.js artOf).
const WASH_TINT = [0.56, 0.86, 1]
export const WASH = (() => {
  const k = 0.7
  const lum = [0.3, 0.59, 0.11]
  const rows = WASH_TINT.map((t, c) => [...lum.map((w, j) => (c === j ? 1 - k : 0) + k * t * 1.25 * w), 0, 0])
  return [...rows.flat(), 0, 0, 0, 1, 0].map((v) => Math.round(v * 1e4) / 1e4)
})()
// The SVG filter the portraits wash by, put in the page once.
let washed = false
function washFilter () {
  if (washed) return
  washed = true
  const defs = h('span', { class: 'wash-defs', 'aria-hidden': 'true' })
  defs.innerHTML = `<svg width="0" height="0"><filter id="wash" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${WASH.join(' ')}"/></filter></svg>`
  document.body.append(defs)
}

// ── portraits ────────────────────────────────────────────────────────────────────────────────────

// A unit's picture: the fallen are shown dead. A kind drawn as more than its picture (figures) stands its figures in
// one box: the group scaled to fit it, its feet on the picture's feet line (`--ps`: its size, which any rule sizing
// a .portrait overrides, as it would an image's width).
export function portrait (id, size = 32, dead = false) {
  const pose = dead ? 'dead' : 'alive'
  if (plainFigure(id)) return h('img', { class: 'portrait', src: artUrl(id, pose), width: size, height: size, alt: '', draggable: 'false' })
  const figs = figures(id)
  const s = 1 / Math.max(1, ...figs.map((f) => 2 * Math.abs(f.x) + f.k))
  const pct = (v) => `${Math.round(v * 1e4) / 100}%`
  if (figs.some((f) => f.wash)) washFilter()
  return h('span', { class: 'portrait figs', style: `--ps:${size}px` }, figs.map((f) => h('img', {
    src: artUrl(f.art, pose), alt: '', draggable: 'false',
    style: `left:${pct(0.5 + (f.x - f.k / 2) * s)};top:${pct(FEET + (f.y - f.k * FEET) * s)};width:${pct(f.k * s)};height:${pct(f.k * s)}` +
      (f.wash || f.dim < 1 ? `;filter:${f.wash ? 'url(#wash)' : ''}${f.dim < 1 ? ` brightness(${f.dim})` : ''}` : '')
  })))
}

// Per-viewer UI preferences (dismissed guides, the foes met, the run saved). Storage can be missing, blocked or full;
// then nothing sticks.
export const prefs = {
  get (key) { try { return localStorage.getItem('retinue:' + key) } catch { return null } },
  set (key, v) { try { localStorage.setItem('retinue:' + key, v) } catch {} },
  drop (key) { try { localStorage.removeItem('retinue:' + key) } catch {} }
}
