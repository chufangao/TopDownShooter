// The cards the screens deal, what is taken flying to where it now lives, and the spoils' strip of souls.
import { relicTip, relicIcon, tally, releaseText } from '../codex.js'
import { unitDef, relicDef, RELIC_TIERS } from '../content.js'
import { h, icon, portrait, hideTip, pinTip, touchy, say } from '../dom.js'
import { frame, toLocal } from '../frame.js'
import { sfx } from '../sfx.js'
import { rosterCap, souls, isMonarch, releaseRefund, unheld } from '../sim/run.js'
import { TUNING } from '../tuning.js'
import { ossuaryCount } from './chrome.js'
import { fieldOrder, unitRow } from './parts.js'

// ── cards: the spoils' and the Shop's ────────────────────────────────────────────────────────────

// Every offer's key, in the order the cards are shown: 1 to 9 and 0, then Q, W, E… By offer index.
const PICK_KEYS = [...'1234567890QWERTYUIOP']
export const offerKeys = (offers) => new Map(offers.slice(0, PICK_KEYS.length).map((o, i) => [i, PICK_KEYS[i]]))

// The numbers in a card's effect line, picked out in the card's colour: +12%, 8 s, ×2, 40%.
export const hiNums = (text) => String(text).split(/([+−×-]?\d+(?:\.\d+)?%?)/).map((part, k) => (k % 2 ? h('b', { class: 'num' }, part) : part))
export const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// ── arrivals: what is taken flies to where it now lives ──

// What flies sits on its own layer in the frame, out of the pointer's way; a screen re-shown under it does not cut it short.
let flyLayer = null
const layer = () => {
  if (!flyLayer?.isConnected) frame.el.append(flyLayer = h('div', { class: 'fly-layer', 'aria-hidden': 'true' }))
  return flyLayer
}
export const centre = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 })

// `node` flies in an arc from viewport point `from` to `to`, shrinking to `scale`; the promise settles as it lands.
export function flyOne (node, from, to, { delay = 0, ms = 560, scale = 0.5, lift = 60 } = {}) {
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

// A relic just taken flies from its card to its tile in the top bar, which pops as it lands; a recruit to the souls' count.
export function flyTrinket (o, rect) {
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

// The room whose cards were last dealt: a release re-shows the same room, whose cards should not deal in again.
let dealt = null
export const freshRoom = (run) => {
  const room = `${run.state.floor}|${run.state.at}`
  const fresh = !(dealt?.run === run && dealt.room === room)
  dealt = { run, room }
  return fresh
}
export const RELIC_TIER_NAME = Object.fromEntries(RELIC_TIERS.map((x) => [x.id, x.name]))

// A deck's parts: a card's refusal, its art's rect, and by touch a card read before it is taken: the first tap pins
// its text with the `label` button under it, a second takes it. A click or a card's key takes it at once.
export function cardDeck () {
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

// Your souls, one line at the foot. Where one may be let go (no room for a recruit), a press opens them over the cards,
// a Release button each with the essence it pays back. `busy()`: a card on its way; `again()`: the screen redrawn.
export function soulsStrip ({ run, act, busy, again, why }) {
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
          tip: () => `Release ${unitDef(u.id).name} forever, freeing a place among your souls, ${releaseText(run, u)}. This can't be undone.`
        }, icon('release', 16), 'Release', h('span', { class: 'price' }, icon('soul', 14), `+${releaseRefund(run, u)}`)))))))
  }
}

// The Relics strip's label and its unheld piece relics, a button each; `giving` is the one readied, `pick(id)` toggles one.
export function relicChips (run, giving, pick) {
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

// Cards per row: up to `most` in one, more in rows as even as they come.
export const cardRow = (n, most) => (n <= most ? Math.max(n, 1) : Math.ceil(n / Math.ceil(n / most)))
export const mostCards = () => Math.max(3, Math.min(6, Math.floor((frame.w - 44 + 18) / (168 + 18))))
