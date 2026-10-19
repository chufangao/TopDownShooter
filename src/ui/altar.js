// An altar: one rite of three, the Monarch's heal, a transmutation or a consecration.
import { unitCard, partyMods, realmOf, ROMAN, roomGain, transmuteWorth } from '../codex.js'
import { unitDef, KIN, ROLES } from '../content.js'
import { h, fill, icon, portrait, hideTip, touchy, say } from '../dom.js'
import { frame } from '../frame.js'
import { kw } from '../keywords.js'
import { sfx } from '../sfx.js'
import {
  souls, monarchOf, canAdvance, tierCost, levelOf, unhealed, transmuteOffer, canTransmute
} from '../sim/run.js'
import { tracksOf, nextTracks } from '../sim/unit.js'
import { TUNING } from '../tuning.js'
import { hiNums, still, cardDeck } from './cards.js'
import { topbar } from './chrome.js'
import { fieldOrder } from './parts.js'

// ── the altar ────────────────────────────────────────────────────────────────────────────────────

// One rite of three, and the room ends with it. The rites are tabs, the heal open first where the Monarch is hurt (or no
// soul has a tier left); whole, the heal's button leaves the altar unburnt. A card is taken as the spoils' are, its keys
// 1, 2, 3. onRite(action) takes the rite.
const RITES = [
  { id: 'heal', name: 'Heal', ico: 'altar', desc: 'The Monarch healed to full. Your souls are whole after every win.' },
  { id: 'transmute', name: 'Transmute', ico: 'soul', desc: 'One standing soul becomes another kind of its tier, one of this floor\'s foes.' },
  { id: 'consecrate', name: 'Consecrate', ico: 'levelup', desc: 'One soul takes its next tier on a track you choose, free.' }
]
export function altarScreen ({ run, onRite, onHelp }) {
  const s = run.state
  const el = h('div', { class: 'screen fit reap-screen altar-screen' })
  const deck = cardDeck()
  const t = TUNING.run
  const m = monarchOf(s)
  const turnable = souls(s.party).sort(fieldOrder).filter((u) => canTransmute(s, u))
  const rising = souls(s.party).sort(fieldOrder).filter((u) => canAdvance(s, u, 0) || canAdvance(s, u, 1))
  // What the heal would leave the Monarch at: nothing more under Court of Bone.
  const after = unhealed(s) ? m.hp : Math.max(m.hp, Math.round(m.maxHp * t.altarHeal))
  const mends = after > m.hp
  let tab = mends || !rising.length ? 'heal' : 'consecrate'
  let soul = turnable[0]?.uid ?? null
  let blessed = rising[0]?.uid ?? null
  let busy = false
  let deal = true
  const take = (action, i = null) => {
    if (busy) return
    busy = true
    hideTip()
    sfx.play(i === null ? 'buy' : 'card')
    if (i !== null) { el.classList.add('picking'); deck.cards[i]?.classList.add('taking') }
    i === null || still() ? onRite(action) : setTimeout(() => onRite(action), 300)
  }
  const pick = (k) => { tab = k; deal = true; hideTip(); sfx.play('select'); render() }

  // The rites' tabs, each with its count now.
  const count = {
    heal: () => (mends ? `the Monarch ${m.hp} → ${after}` : unhealed(s) && m.hp < m.maxHp ? 'Court of Bone: nothing heals it' : 'the Monarch whole'),
    transmute: () => `${turnable.length} soul${turnable.length === 1 ? '' : 's'}`,
    consecrate: () => `${rising.length} soul${rising.length === 1 ? '' : 's'}`
  }
  const tabs = () => h('div', { class: 'tabs rite-tabs', role: 'tablist', 'aria-label': 'Rites' }, RITES.map((r) => h('button', {
    class: `tab rite-tab r-${r.id}` + (tab === r.id ? ' on' : ''), role: 'tab', 'aria-selected': tab === r.id ? 'true' : 'false', 'data-rite': r.id,
    onclick: () => pick(r.id), tip: () => h('div', { class: 'syn-tip' }, h('b', null, r.name), h('p', null, r.desc), h('p', { class: 'dim' }, `Now: ${count[r.id]()}.`))
  }, icon(r.ico, 20), h('span', null, r.name), h('span', { class: 'rite-n dim' }, count[r.id]()))))

  // A chooser beside the cards: a column of buttons, a soul each, the chosen pressed.
  const chooser = (label, items) => h('div', { class: 'rite-side' }, h('div', { class: 'rite-label dim' }, label), h('div', { class: 'rite-choose', role: 'group', 'aria-label': label }, items))
  const split = (side, say, cards) => h('div', { class: 'rite-panel split' }, side,
    h('div', { class: 'rite-main' }, h('p', { class: 'rite-say' }, say),
      h('div', { class: 'offers picks' + (frame.h < 640 ? ' rows' : '') + (deal ? ' deal' : ''), style: `--cols:${cards.length}` }, cards)))
  const option = (on, face, name, sub, onclick, tip) => h('button', { class: 'rite-opt' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick, tip },
    h('span', { class: 'rank-port' }, face), h('span', { class: 'rite-opt-text' }, h('b', null, name), h('span', { class: 'dim' }, sub)))

  // Heal: the Monarch, and what the heal leaves it at.
  function healPanel () {
    return h('div', { class: 'rite-panel' },
      h('p', { class: 'rite-say' }, roomGain(run, { type: 'altar' })),
      unhealed(s) && m.hp < m.maxHp && h('p', { class: 'warn' }, 'Court of Bone: nothing heals the Monarch.'),
      h('div', { class: 'rite-mends' }, h('div', { class: 'rite-mend', tip: () => unitCard(m, { mods: partyMods(run, m), realm: realmOf(run), run }) },
        h('span', { class: 'rank-port monarch' }, portrait(m.id, 40)),
        h('span', null, h('b', null, 'The Monarch'), h('span', { class: 'dim' }, mends ? ` ${m.hp} → ${after}` : ` ${m.hp}/${m.maxHp}`)))))
  }

  // Transmute: the soul, then the kind it becomes, a card each.
  function transmutePanel () {
    if (!turnable.length) return h('div', { class: 'rite-panel' }, h('p', { class: 'rite-say' }, 'No soul here can be transmuted: a fused soul is made, not met.'))
    const u = s.party.find((x) => x.uid === soul)
    const offer = transmuteOffer(s, u.id)
    const card = (id, i) => {
      const d = unitDef(id)
      const worth = transmuteWorth(run, u, id)
      const tip = () => unitCard({ id, lvl: worth.lvl, tracks: u.tracks, slot: -1 }, {
        open: !touchy(), realm: realmOf(run), live: `${unitDef(u.id).name} → ${d.name}, Lv ${worth.lvl}`,
        notes: [`${say('Click', 'Tap it again (or Transmute ▸)')} to transmute it. (${i + 1})`, ...worth.lines]
      })
      const action = { type: 'transmute', uid: u.uid, index: i }
      return deck.cards[i] = h('button', { class: 'offer o-soul o-turn', style: `--i:${i}`, onclick: (e) => deck.press(e, i, tip, 'Transmute ▸', () => true, () => take(action, i)), tip },
        h('div', { class: 'offer-tag' }, h('kbd', null, i + 1), h('span', { class: 'tag-word' }, ' Becomes')),
        h('div', { class: 'offer-art' }, portrait(id, 104)),
        h('div', { class: 'offer-name' }, d.name),
        h('div', { class: 'offer-worth' }, worth.chips.map((c) => h('span', { class: 'ow-chip' + (c.up ? ' up' : '') }, c.text))),
        h('div', { class: 'offer-line' }, `${KIN[d.kin].name} ${ROLES[d.role].name} · `, h('span', { class: 'nowrap' }, 'level ', h('b', { class: 'num' }, worth.lvl))))
    }
    const cards = offer.map(card)
    return split(
      chooser('The soul', turnable.map((x) => option(x.uid === soul, portrait(x.id, 36), unitDef(x.id).name, ` Lv ${x.lvl} · tier ${unitDef(x.id).tier}`,
        () => { if (x.uid !== soul) { soul = x.uid; deal = true; sfx.play('select'); render() } },
        () => unitCard(x, { mods: partyMods(run, x), realm: realmOf(run), run, notes: [`${say('Click', 'Tap')} it, then the kind it becomes.`] })))),
      'It becomes one of this floor\'s foes of its tier, keeping its relic, its tiers (each on its new kind\'s track of the same number) and its level.',
      cards)
  }

  // Consecrate: the soul, then a track's next tier, a card each.
  function consecratePanel () {
    if (!rising.length) return h('div', { class: 'rite-panel' }, h('p', { class: 'rite-say' }, 'Every soul you hold has taken all the tiers its tracks allow.'))
    const u = s.party.find((x) => x.uid === blessed)
    const name = unitDef(u.id).name
    const lvl = u.lvl
    const card = (tr, i) => {
      const have = u.tracks[i]
      const can = canAdvance(s, u, i)
      const tier = tr.tiers[have]
      const up = can ? levelOf({ tracks: nextTracks(u.tracks, i) }) : lvl
      const why = can ? null : have >= tr.tiers.length ? 'Complete.' : `Locked: ${tracksOf(u.id)[1 - i].name} has passed II, so ${tr.name} stops at II.`
      const tip = () => h('div', { class: 'syn-tip' }, h('p', null, h('b', null, `${tr.name} ${can ? ROMAN[have] : ''}`), ' ', can ? tier.desc : tr.desc),
        can ? h('p', { class: 'dim' }, `Free here (${tierCost(run, u, i)} essence in the Field), for this ${name}. ${up > lvl ? `Level ${lvl} → ${up}.` : `Level stays ${lvl}.`} ${say('Click', 'Tap it again (or Consecrate ▸)')} to take it. (${i + 1})`)
          : h('p', { class: 'warn' }, why))
      const action = { type: 'consecrate', uid: u.uid, track: i }
      return deck.cards[i] = h('button', { class: 'offer o-tier' + (can ? '' : ' locked'), style: `--i:${i}`, 'aria-disabled': can ? null : 'true', onclick: (e) => deck.press(e, i, tip, 'Consecrate ▸', () => can, () => (can ? take(action, i) : deck.refuse(i))), tip },
        h('div', { class: 'offer-tag' }, h('kbd', null, i + 1), h('span', { class: 'tag-word' }, ` Track ${i + 1}`)),
        h('div', { class: 'offer-art' }, portrait(u.id, 84), h('span', { class: 'tier-badge' }, can ? ROMAN[have] : '✓')),
        h('div', { class: 'offer-name' }, tr.name, can && ` ${ROMAN[have]}`),
        h('div', { class: 'offer-line' }, can ? hiNums(tier.desc) : why),
        h('div', { class: 'offer-price' + (can ? '' : ' poor') }, can ? ['Free', up > lvl && h('span', { class: 'dim' }, ` · Lv ${lvl} → ${up}`)] : 'No tier'))
    }
    const cards = tracksOf(u.id).map(card)
    return split(
      chooser('The soul', rising.map((x) => option(x.uid === blessed, portrait(x.id, 36), unitDef(x.id).name, ` Lv ${x.lvl} · tiers ${x.tracks.join('·')}`,
        () => { if (x.uid !== blessed) { blessed = x.uid; deal = true; sfx.play('select'); render() } },
        () => h('div', { class: 'syn-tip' }, h('b', null, unitDef(x.id).name), h('p', null, tracksOf(x.id).map((tr, i) => `${tr.name} ${x.tracks[i]}/${tr.tiers.length}`).join(' · ')), h('p', { class: 'dim' }, `${say('Click', 'Tap')} it, then a track.`))))),
      `This ${name} takes its next tier on the track you choose, free, as buying it would give it.`,
      cards)
  }

  function render () {
    deck.cards.length = 0
    const panel = tab === 'heal' ? healPanel() : tab === 'transmute' ? transmutePanel() : consecratePanel()
    fill(el,
      topbar(run, onHelp),
      h('div', { class: 'reap-main' },
        h('div', { class: 'reap-head' },
          h('div', { class: 'reap-title' }, icon('altar', 34), h('h1', null, 'Altar')),
          h('p', { class: 'reap-lede' }, ['One rite, then the altar is spent: ', kw('altar', 'heal, transmute or consecrate'), '.'])),
        tabs(),
        h('div', { class: `reap-body rite-body r-${tab}` }, panel),
        h('div', { class: 'reap-foot rite-foot' },
          h('p', { class: 'dim rite-hint' }, tab === 'heal' ? RITES[0].desc : `${say('Click', 'Tap')} a card to ${tab}; another rite's tab to change your mind.`),
          h('div', { class: 'reap-actions' },
            tab === 'heal' && (mends
              ? h('button', { class: 'primary big', onclick: () => take({ type: 'heal' }), tip: () => `Heal: the Monarch ${m.hp} → ${after}. The altar is then spent.` }, icon('altar', 20), 'Heal ▸')
              : h('button', { class: 'ghost big', onclick: () => take({ type: 'heal' }), tip: () => 'Nothing to heal: the altar is left unburnt, and the room is done.' }, 'Leave ▸'))))))
    deal = false
  }

  render()
  return {
    el,
    key (e) {
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      const i = Number(e.key) - 1
      if (tab !== 'heal' && deck.cards[i]) deck.cards[i].click()
    }
  }
}
