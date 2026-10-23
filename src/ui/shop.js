// The Shop: the floor's shelf of relics and the fusions, a tab of the run's screen.
import { unitCard, relicTip, realmOf, tileText, TRIGGER_TEXT, relicIcon, relicKind } from '../codex.js'
import { unitDef, relicDef, fusionDef, FUSION_LIST } from '../content.js'
import { h, fill, icon, portrait, hideTip, pinTip, touchy, say } from '../dom.js'
import { kw } from '../keywords.js'
import { sfx } from '../sfx.js'
import { souls, fuseCost, relicCount, shopOffers, shelfFusions, canBuy, isRunRelic, firstLevel } from '../sim/run.js'
import { deployTile, onField } from '../sim/unit.js'
import { hiNums, flyTrinket, RELIC_TIER_NAME, cardDeck, cardRow, mostCards } from './cards.js'
import { learnt } from './chrome.js'

// ── the Shop ─────────────────────────────────────────────────────────────────────────────────────

// Relics: the shelf's slots (null once bought, filled again after the next win), each lit while the purse pays for it.
// Fusions: every recipe whose parts are all held, then, dim, the recipes a kind held goes into.
// `onChange` runs after every action it sends. → { el, render }
export function shopView ({ run, act, onChange = null }) {
  const s = run.state
  const el = h('section', { class: 'panel shop-panel reap-screen shop-screen', 'aria-label': 'The Shop' })
  let deal = true
  let said = ''
  const deck = cardDeck()
  const done = () => { hideTip(); render(); onChange?.() }
  const buy = (i) => {
    const o = shopOffers(run)[i]
    if (!o) return
    if (!canBuy(run, i)) return deck.refuse(i)
    const rect = deck.artRect(i)
    if (act({ type: 'buy', index: i })) return deck.refuse(i)
    sfx.play('buy')
    said = ''
    done()
    flyTrinket(o, rect)
  }

  function card (o, i) {
    if (!o) {
      return deck.cards[i] = h('div', { class: 'offer o-sold', style: `--i:${i}`, tip: () => 'Bought. The slot fills again after your next win.' },
        h('div', { class: 'offer-art' }, icon('shop', 48)), h('div', { class: 'offer-name' }, 'Bought'), h('div', { class: 'offer-sub' }, 'Restocked after a win'))
    }
    const why = canBuy(run, i) ? null : 'poor'
    const r = relicDef(o.id)
    const copies = relicCount(s, o.id)
    const tip = () => h('div', null, relicTip(o.id, run),
      h('p', { class: 'dim' }, why ? `You need ${o.cost} essence; you have ${s.essence}.` : `${say('Click', 'Tap it again (or Buy ▸)')} to buy it for ${o.cost} essence.`))
    return deck.cards[i] = h('button', { class: `offer o-relic o-${o.tier} rt-${o.tier}` + (why ? ' locked' : ''), style: `--i:${i}`, onclick: (e) => deck.press(e, i, tip, 'Buy ▸', () => canBuy(run, i), buy), 'aria-disabled': why ? 'true' : null, tip },
      h('div', { class: 'offer-tag' }, h('span', { class: 'tag-word' }, RELIC_TIER_NAME[o.tier]),
        h('span', { class: 'kind-tag', tip: () => isRunRelic(o.id) ? 'A run relic: it works for the whole run, unheld.' : 'A piece relic: it works only through the soul you give it to, on the Field.' }, relicKind(o.id))),
      h('div', { class: 'offer-art' }, icon(relicIcon(o.id), 64),
        r.on && h('span', { class: 'trig-tag', tip: () => `Fires each time ${TRIGGER_TEXT[r.on].short}` }, TRIGGER_TEXT[r.on].name)),
      h('div', { class: 'offer-name' }, o.name),
      copies > 0 && h('div', { class: 'offer-sub' }, isRunRelic(o.id) ? `Owned ×${copies}: one more adds to it` : `Owned ×${copies}: one more is another holder`),
      h('div', { class: 'offer-line' }, hiNums(o.desc)),
      h('div', { class: 'offer-price' + (why ? ' poor' : '') }, icon('soul', 18), o.cost))
  }

  // The purse against the shelf: "You have 120: 2 of these 4 are within reach."
  function shelfLine () {
    const left = shopOffers(run).filter(Boolean)
    const k = left.filter((o) => o.cost <= s.essence).length
    return !left.length ? `You have ${s.essence}; the shelf is bare until your next win.`
      : `You have ${s.essence}: ${k === left.length ? (k === 1 ? 'the last relic is' : `all ${k} relics are`) : `${k} of these ${left.length} relics ${k === 1 ? 'is' : 'are'}`} within reach.`
  }

  // By touch a fusion is read before it is made: the first tap pins its text with `label`, a second makes it.
  let reading = null
  function twice (e, tip, label, ok, go) {
    const b = e.currentTarget
    if (!touchy() || reading === b) { reading = null; return go(e) }
    reading = b
    b.classList.add('chosen')
    pinTip(b, () => [tip(), ok() && h('button', { class: 'primary small tip-act', onclick: () => { hideTip(); reading = null; go(e) } }, label)], {
      keep: true,
      onHide: () => { b.classList.remove('chosen'); if (reading === b) reading = null }
    })
  }
  const shake = (e) => {
    const t = e?.currentTarget
    if (!t?.classList) return
    t.classList.remove('shake')
    void t.offsetWidth
    t.classList.add('shake')
  }

  // A recipe's row: its result (as it rises: fresh), its parts (how many of each you hold) and, where every part is
  // held, its button.
  const heldOf = (k) => souls(s.party).filter((x) => x.id === k).length
  function fuseRow (f, entry = null) {
    const d = unitDef(f.result)
    return h('div', { class: 'fuse-row' + (entry?.can ? ' ready' : '') + (entry ? '' : ' toward') },
      h('span', { tip: () => unitCard({ id: f.result, lvl: firstLevel(), tracks: [0, 0] }, { realm: realmOf(run), notes: [f.desc] }) }, portrait(f.result, 40)),
      h('div', { class: 'fuse-text' },
        h('div', null, h('b', null, f.name), h('span', { class: 'dim' }, ` · tier ${d.tier}${(d.size ?? 1) > 1 ? ' · 2×2' : ''}`)),
        h('div', { class: 'fuse-parts' }, Object.entries(f.needs).map(([id, n]) => {
          const have = heldOf(id)
          return h('span', { class: have >= n ? 'met' : 'short' }, `${unitDef(id).name} ${Math.min(have, n)}/${n}`)
        }))),
      entry ? fuseButton(f, entry) : h('span', { class: 'price dim', tip: () => `${fuseCost(run, f.id)} essence once every part is held.` }, icon('soul', 16), fuseCost(run, f.id)))
  }
  // A ready recipe's button, lit when it can be made now, its price and what its parts' tiers pay back (`back`).
  function fuseButton (f, entry) {
    const { cost, back, can } = entry
    const name = unitDef(f.result).name
    const parts = entry.action.parts.map((uid) => s.party.find((x) => x.uid === uid))
    const partsText = parts.map((p) => `the ${unitDef(p.id).name} ${onField(p) ? `on ${tileText(deployTile('party', p.slot)).replace(/^your camp, /, '')}` : 'in the ossuary'}`).join(', ')
    const trade = `it takes ${partsText}, for ${cost} essence${back > 0 ? `; its parts' tiers pay back ${back}` : ''}`
    const fresh = `The ${name} waits in the ossuary, fresh: level ${firstLevel()}, no tier.`
    // A part holding a relic gives it up: it comes back unheld (the run picks holders last, fuseParts).
    const freed = parts.flatMap((p) => (p.relics ?? []).map((r) => ({ kind: unitDef(p.id).name, relic: relicDef(r).name })))
    const gives = freed.map((x) => `The ${x.kind} gives up ${x.relic}: it comes back unheld, to give again on the Field.`).join(' ')
    const tip = () => h('div', { class: 'syn-tip' }, h('b', null, f.name), ' ', f.desc,
      s.essence < cost ? h('p', { class: 'warn' }, `Needs ${cost} essence; you have ${s.essence}.`)
        : h('p', { class: 'dim' }, `${trade[0].toUpperCase()}${trade.slice(1)}. ${fresh}`),
      freed.length > 0 && h('p', { class: 'warn' }, gives))
    const press = (e) => {
      if (!can) { sfx.play('poor'); return shake(e) }
      const error = act(entry.action)
      if (error) { said = error; sfx.play('poor'); return done() }
      learnt('fuse')
      sfx.play('buy')
      said = `${name} is made${back > 0 ? `, its parts' tiers paying back ${back}` : ''}: it waits in the ossuary, fresh at level ${firstLevel()}.${freed.length ? ` ${freed.map((x) => x.relic).join(' and ')} ${freed.length > 1 ? 'wait' : 'waits'} unheld.` : ''}`
      done()
    }
    // Dim while it cannot be made; its price red only when the essence is short.
    return h('button', {
      class: 'buy' + (can ? '' : ' off') + (s.essence < cost ? ' poor' : ''), 'aria-disabled': can ? null : 'true', 'aria-label': `Fuse ${f.name}`,
      onclick: (e) => twice(e, tip, `Fuse ${f.name} ▸`, () => can, press),
      tip
    }, icon('fuse', 18), 'Fuse', h('span', { class: 'price' }, icon('soul', 16), cost), back > 0 && h('span', { class: 'back dim' }, `+${back} back`))
  }
  function fusions () {
    const ready = shelfFusions(run)
    const share = (f) => Object.entries(f.needs).reduce((n, [id, k]) => n + Math.min(heldOf(id), k), 0) / Object.values(f.needs).reduce((n, k) => n + k, 0)
    const toward = FUSION_LIST.filter((f) => !ready.some((x) => x.id === f.id) && Object.keys(f.needs).some((id) => heldOf(id) > 0))
      .map((f) => ({ f, at: share(f) })).sort((a, b) => b.at - a.at).map((x) => x.f)
    return h('div', { class: 'shop-sec shop-fusions' },
      h('h3', null, kw('fusion', 'Fusions'), h('span', { class: 'dim' }, ` · ${ready.length} ready`)),
      ready.length ? h('div', { class: 'fuse-list' }, ready.map((x) => fuseRow(fusionDef(x.id), x)))
        : h('p', { class: 'dim small' }, 'No recipe has every part held yet. Recruit its kinds from the slain.'),
      toward.length > 0 && [h('p', { class: 'dim small shop-toward' }, 'Toward, from the kinds you hold:'), h('div', { class: 'fuse-list' }, toward.map((f) => fuseRow(f)))])
  }

  function render () {
    deck.cards.length = 0
    const stock = shopOffers(run).map(card)
    const cols = cardRow(stock.length, Math.min(4, mostCards()))
    fill(el,
      h('div', { class: 'shop-head' },
        h('div', { class: 'reap-title' }, icon('shop', 30), h('h2', null, 'Shop')),
        h('p', { class: 'reap-lede' }, [kw('relic', 'Relics'), ' and ', kw('fusion', 'fusions'), ' for ', kw('essence'), `. ${shelfLine()}`])),
      said && h('p', { class: 'note-line shop-said', role: 'status' }, said),
      h('div', { class: 'shop-cols' },
        h('div', { class: 'shop-sec shop-relics' },
          h('h3', null, kw('relic', 'Relics'), h('span', { class: 'dim' }, ` · a slot bought fills again after your next win`)),
          h('div', { class: 'offers picks' + (deal ? ' deal' : '') + (stock.length > cols ? ' rows' : ''), style: `--cols:${cols}` }, stock)),
        fusions()))
    deal = false
  }

  render()
  return { el, render }
}
