// The draft: the run's first souls, dealt as cards, each one taken flying into its seat.
import { unitCard, reachText, recruitWorth } from '../codex.js'
import { unitDef, KIN, ROLES, FUSION_LIST } from '../content.js'
import { h, fill, icon, portrait, hideTip, touchy, say } from '../dom.js'
import { sfx } from '../sfx.js'
import { souls, firstLevel } from '../sim/run.js'
import { TUNING } from '../tuning.js'
import { offerKeys, still, centre, flyOne, cardDeck } from './cards.js'
import { topbar } from './chrome.js'

// ── the draft ────────────────────────────────────────────────────────────────────────────────────

// Each pick deals the kinds offered as cards, free; the one taken flies into its seat. onPick(index) takes offer
// `index`; the last pick opens the map. A second soul of a kind says what it is worth, a first the fusions it goes into.
let draftDealt = null
export function draftScreen ({ run, onPick, onHelp }) {
  const s = run.state
  const el = h('div', { class: 'screen fit reap-screen draft-screen' })
  const n = TUNING.draft.picks
  const k = s.draft.pick
  const offer = s.draft.offer
  const deal = !(draftDealt?.run === run && draftDealt.pick === k)
  draftDealt = { run, pick: k }
  const deck = cardDeck()
  const keys = offerKeys(offer)
  let busy = false
  const take = (i) => {
    if (busy) return
    busy = true
    const rect = deck.artRect(i)
    hideTip()
    sfx.play('card')
    el.classList.add('picking')
    deck.cards[i]?.classList.add('taking')
    const go = () => {
      onPick(i)
      seatSoul(offer[i], rect, k)
    }
    still() ? go() : setTimeout(go, 300)
  }
  const recipesOf = (id) => FUSION_LIST.filter((f) => Object.hasOwn(f.needs, id))
  function card (id, i) {
    const d = unitDef(id)
    const worth = recruitWorth(run, id)
    const recipes = recipesOf(id)
    const notes = worth?.lines ?? (recipes.length ? recipes.map((f) => `Fusion: ${f.desc}`) : ['It goes into no fusion.'])
    const tip = () => unitCard({ id, lvl: firstLevel(), tracks: [0, 0], slot: -1 }, {
      open: !touchy(),
      live: `Joins free at Lv ${firstLevel()}, on the field`,
      notes: [`${say('Click', 'Tap it again (or Raise ▸)')} to raise it.`, ...notes]
    })
    const chips = worth?.chips ?? recipes.map((f) => ({ text: `Fuses into ${f.name}` }))
    return deck.cards[i] = h('button', { class: 'offer o-soul', style: `--i:${i}`, onclick: (e) => deck.press(e, i, tip, 'Raise ▸', () => true, take), tip },
      h('div', { class: 'offer-tag' }, keys.has(i) && h('kbd', null, keys.get(i)), h('span', { class: 'tag-word' }, ' Raise')),
      h('div', { class: 'offer-art' }, portrait(id, 104)),
      h('div', { class: 'offer-name' }, d.name),
      chips.length > 0 && h('div', { class: 'offer-worth' }, chips.map((c) => h('span', { class: 'ow-chip' + (c.up ? ' up' : '') }, c.text))),
      h('div', { class: 'offer-line' }, `${KIN[d.kin].name} ${ROLES[d.role].name}`),
      h('div', { class: 'offer-line draft-reach' }, reachText({ id, lvl: firstLevel(), tracks: [0, 0] })))
  }
  // The seats: one a pick, a soul's face in each taken, the next marked.
  const picked = souls(s.party)
  const seat = (j) => {
    const u = picked[j]
    return h('div', {
      class: 'draft-seat' + (u ? ' taken' : j === k ? ' next' : ''), 'data-n': j,
      tip: u ? () => unitCard(u, { notes: ['Taken.'] }) : () => (j === k ? 'This pick.' : `Pick ${j + 1}.`)
    }, u ? portrait(u.id, 54) : h('span', { class: 'seat-n' }, j + 1))
  }
  const cards = offer.map(card)
  fill(el,
    topbar(run, onHelp),
    h('div', { class: 'reap-main' },
      h('div', { class: 'reap-head' },
        h('div', { class: 'reap-title' }, icon('soul', 34), h('h1', null, 'Raise your retinue')),
        h('p', { class: 'reap-lede' }, n > 1 ? `Pick ${k + 1} of ${n}: choose a soul to walk with you. A kind can be offered again.` : 'Choose a soul to walk with you.')),
      h('div', { class: 'reap-body' },
        h('div', { class: 'reap-picks' },
          h('div', { class: 'offers picks' + (deal ? ' deal' : ''), style: `--cols:${cards.length}` }, cards))),
      h('div', { class: 'reap-foot draft-foot' },
        h('span', { class: 'draft-label' }, n > 1 ? 'Your souls' : 'Your soul'),
        h('div', { class: 'draft-seats' }, Array.from({ length: n }, (_, j) => seat(j))),
        h('p', { class: 'draft-after' }, `After ${n > 1 ? 'these' : 'it'}, every soul is recruited from the slain.`))))
  return {
    el,
    key (e) {
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      const hit = [...keys].find(([, key]) => e.key.toUpperCase() === key)
      if (hit) take(hit[0])
    }
  }
}

// A soul just drafted flies from its card into its seat on the next screen (after the last pick, to the top bar).
function seatSoul (id, rect, k) {
  const find = () => document.querySelector(`.draft-seat[data-n="${k}"]`) ?? document.querySelector('.topbar .chip-stat.souls')
  const to = find()
  if (!to || !rect || still()) return
  to.classList.add('arriving')
  flyOne(h('span', { class: 'soul-flyer' }, portrait(id, 64)), centre(rect), centre(to.getBoundingClientRect()), { ms: 620, scale: 0.7, lift: 70 }).then(() => {
    const now = find()
    if (!now) return
    now.classList.remove('arriving', 'gain')
    void now.offsetWidth
    now.classList.add('gain')
  })
}
