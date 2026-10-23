// The spoils of a won battle: the recruits as cards and what the battle paid.
import { unitCard, partyMods, recruitWorth, recruitSteps } from '../codex.js'
import { unitDef, KIN, ROLES } from '../content.js'
import { h, fill, icon, portrait, touchy, say } from '../dom.js'
import { kw } from '../keywords.js'
import { sfx } from '../sfx.js'
import {
  fieldCap, rosterCap, fielded, currentNode, souls, essenceByWave, floorPrice, soulOffer, eliteBonus,
  runStat, freshTracks
} from '../sim/run.js'
import { TUNING } from '../tuning.js'
import {
  offerKeys, still, flyTrinket, freshRoom, cardDeck, soulsStrip, cardRow, mostCards
} from './cards.js'
import { topbar } from './chrome.js'

// ── reap ─────────────────────────────────────────────────────────────────────────────────────────

// One of the slain to recruit, what each wave paid, and a won elite's essence on top of its foes'. onDone(index):
// recruit offer `index`, or null to move on.
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
  // A battle of waves paid each wave as it fell, relics included.
  const boost = runStat(s, 'essence.gain', 1)
  const paid = node.waves?.length && run.battle ? essenceByWave(run.battle) : null
  const times = (v) => `×${+v.toFixed(2)}`
  const wavePay = paid && h('p', {
    class: 'wave-pay',
    tip: () => `${paid.map((v, k) => `Wave ${k + 1} ${Math.round(v * boost)}`).join(' + ')} = ${Math.round(paid.reduce((a, b) => a + b, 0) * boost)} essence${boost !== 1 ? `, relics' ${times(boost)} in` : ''}.`
  }, icon('soul', 18), ' Paid wave by wave: ', paid.map((v, k) => [k ? ' · ' : '', `Wave ${k + 1}`, ' ', h('b', null, Math.round(v * boost))]))
  // A won elite's or a floor boss's bounty: its essence on top of its foes', relics included.
  const bounty = node.type === 'elite' || node.type === 'boss'
  const elitePay = bounty && h('p', {
    class: 'wave-pay elite-pay',
    tip: () => `${TUNING.essence.eliteBonus} at floor-1 prices, ${times(floorPrice(s.floor))} here${boost !== 1 ? `, ${times(boost)} by relics` : ''}: +${Math.round(eliteBonus(s.floor) * boost)}, on top of its foes'. ${node.type === 'boss' ? 'A boss' : 'An elite'} lays out no relic: the Shop sells those.`
  }, icon('soul', 18), ` The ${node.type === 'boss' ? 'boss' : 'elite'}'s bounty: `, h('b', null, `+${Math.round(eliteBonus(s.floor) * boost)}`), ' essence, on top of its foes\'.')
  // What the battle paid in all: its slain, an elite's bounty, × the relics' gain.
  const won = run.battle && Math.round((essenceByWave(run.battle).reduce((a, b) => a + b, 0) +
    (bounty ? eliteBonus(s.floor) : 0)) * boost)
  const ledeTip = () => {
    const f = fielded(souls(s.party)).length
    return h('div', { class: 'syn-tip' },
      won != null && h('p', null, `This battle paid +${won} essence; you have ${s.essence}.`),
      h('p', null, `One recruit a battle. Field ${f}/${fieldCap(run)}: ${f < fieldCap(run) ? 'a recruit joins it' : 'a recruit waits in the ossuary'} · souls ${souls(s.party).length}/${rosterCap(run)}.`))
  }
  const strip = soulsStrip({ run, act, busy: () => busy, again: () => render(), why: 'Your souls are at their most: open the list to release one, and make room for a recruit.' })

  // A card: big art, the name, one line; the rest is on the hover (for a kind already held, what one more is worth).
  function card (o, i) {
    const why = blocked(o)
    const worth = recruitWorth(run, o.id)
    // Its lead: its price, the level it joins at and where it would go (the field while it has room).
    const lead = () => {
      const f = fielded(souls(s.party)).length
      return why === 'full' ? `Souls ${souls(s.party).length}/${rosterCap(run)}: release one to recruit`
        : `Recruit for ${o.cost}: joins at Lv ${o.lvl}, ${f < fieldCap(run) ? `on the field (${f + 1}/${fieldCap(run)})` : `in the ossuary (field ${f}/${fieldCap(run)})`}`
    }
    // A kind new to your souls: the synergy steps it would bring, fielded.
    const fresh = () => {
      const steps = recruitSteps(run, o.id)
      return `New to your souls. Fielded, it brings ${steps.length ? steps.join(', ') : 'no new synergy'}.`
    }
    const tip = () => unitCard({ id: o.id, lvl: o.lvl, tracks: freshTracks(s), slot: -1 }, {
      // A click takes the card: a mouse reads it on the hover, never under Shift.
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
        wavePay,
        h('div', { class: 'reap-body' },
          h('div', { class: 'reap-picks' },
            offers.length > 0 && h('div', { class: 'offers picks' + (deal ? ' deal' : '') + (offers.length > cols ? ' rows' : ''), style: `--cols:${cols}` }, offers))),
        h('div', { class: 'reap-foot' },
          strip(s.offers.length > 0 && full()),
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
