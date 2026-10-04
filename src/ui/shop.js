// The Codex shop (§4.2, §5) — where the player decides what they are able to say.
//
// This is the only place in the game that widens the Doctrine. Nothing offers a capability, nothing
// notices you struggling and hands you a panel, and no amount of play unlocks anything: a run pays
// in discoveries and you decide what those discoveries were worth.
//
// Two things the layout has to get right, and both are about making the decision reasonable rather
// than making it look impressive:
//
//   * **Everything is visible from the first minute, priced, including what you cannot afford.**
//     A shop that hides its shelves is the discovery-by-exhaustion problem again. Seeing that
//     *Mark by threat* exists and costs 3 is what makes saving for it a decision.
//   * **Each row is one sentence about what you could then say.** Not a feature name and not a
//     stat — "say how hurt something must be before anyone talks to it". If a row cannot be
//     explained in a line, it is too big to be sold, which was the whole problem with selling
//     panels.

import { el, clear } from './dom.js'
import { injectStyles } from './styles.js'

/** Section headings, in the order they appear. A section is a display grouping and nothing else. */
const SECTIONS = [
  ['parley', 'PARLEY', 'Who to talk to instead of killing, and who gets dropped to make room.'],
  ['formation', 'FORMATION', 'Where people stand. Melee only reaches the enemy\'s frontmost occupied row.'],
  ['focus', 'FOCUS', 'Which enemy inside a row gets hit, once the aggro roll has picked the row.'],
  ['route', 'ROUTE', 'What the leader walks to, what it walks past, and when it takes the stairs.'],
  ['orders', 'ORDERS', 'Which ability a unit reaches for, and what it is willing to wait for.'],
  ['succession', 'SUCCESSION', 'Which branch a unit takes when it levels without you.']
]

/**
 * @param {object} opts
 * @param {HTMLElement} opts.mount
 * @param {object} opts.store
 * @param {() => void} [opts.onBuy]  told after a purchase, so the panel beside this can rebuild
 */
export function createShop ({ mount, store, onBuy = () => {} }) {
  injectStyles()

  let open = false
  let note = null

  const opener = el('button', { class: 'opener shop-opener', onclick: () => toggle() })
  const body = el('div', { class: 'body' })
  const panel = el('div', { class: 'panel shop', hidden: true }, [
    el('div', { class: 'tabs' }, [
      el('button', { text: 'CODEX', 'aria-selected': 'true' }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'close', text: 'CLOSE  C', onclick: () => toggle(false) })
    ]),
    body
  ])

  mount.appendChild(opener)
  mount.appendChild(panel)

  const onKey = (e) => {
    if (e.key !== 'c' && e.key !== 'C') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
    e.preventDefault()
    toggle()
  }
  window.addEventListener('keydown', onKey)

  function toggle (next = !open) {
    open = next
    panel.hidden = !open
    if (open) render()
    paint()
  }

  function purchase (row) {
    const res = store.purchase(row.id)
    note = res.bought
      ? { text: `${row.name} — bought. It is in the Doctrine now.`, bad: false }
      : { text: `${row.name} — ${res.reason}`, bad: true }
    render()
    if (res.bought) onBuy()
  }

  function render () {
    clear(body)
    const rows = store.shop()
    const codex = store.codex()

    body.appendChild(el('h2', { text: 'CODEX' }))
    body.appendChild(el('p', {
      class: 'lede',
      text: 'Codex counts discoveries, not time: the first kill of each boss, the first time each ' +
            'species is talked round, the first firing of each Pact. The second Bone Chanter you ' +
            'recruit pays nothing. So this list is longer than you can afford, and what you buy is ' +
            'an argument about how you want to play.'
    }))

    body.appendChild(el('div', { class: 'purse' }, [
      el('span', { class: 'big', text: String(codex) }),
      el('span', { text: codex === 1 ? 'Codex to spend' : 'Codex to spend' }),
      el('span', { class: 'grow' }),
      el('span', { class: 'hint', text: `${rows.filter((r) => r.owned).length} of ${rows.length} held` })
    ]))

    if (note) body.appendChild(el('div', { class: 'receipt' + (note.bad ? ' bad' : ''), text: note.text }))

    for (const [key, title, blurb] of SECTIONS) {
      const inSection = rows.filter((r) => r.section === key)
      if (!inSection.length) continue
      body.appendChild(el('h3', { class: 'section', text: title }))
      body.appendChild(el('div', { class: 'hint section-blurb', text: blurb }))
      for (const row of inSection) body.appendChild(renderRow(row, rows))
    }
    paint()
  }

  function renderRow (row, all) {
    const nameOf = (id) => all.find((r) => r.id === id)?.name ?? id
    const state = row.owned ? 'held' : row.blocked.length ? 'blocked' : row.affordable ? 'ready' : 'short'

    const buy = el('button', {
      class: 'buy',
      // A held tenet shows its price struck through rather than vanishing: the shop is also the
      // record of what you decided, and a purchase that disappears makes the list read differently
      // every time you open it.
      text: row.owned ? 'held' : `${row.cost}`,
      disabled: row.owned || !row.affordable,
      title: row.owned ? 'already bought' : row.blocked.length ? `needs ${row.blocked.map(nameOf).join(', ')}` : `costs ${row.cost} Codex`,
      onclick: () => purchase(row)
    })

    return el('div', { class: `tenet ${state}` }, [
      buy,
      el('div', { class: 'about' }, [
        el('div', { class: 'nm', text: row.name }),
        el('div', { class: 'why', text: row.desc }),
        row.blocked.length
          ? el('div', { class: 'why blocked', text: `needs ${row.blocked.map(nameOf).join(' and ')}` })
          : null
      ])
    ])
  }

  function paint () {
    const codex = store.codex()
    opener.innerHTML = ''
    opener.appendChild(el('span', { text: 'CODEX  C' }))
    opener.appendChild(el('span', { class: 'count', text: String(codex) }))
    // Amber only when something is actually buyable — a permanent badge is a notification, and
    // this is a shop the player visits when they have decided to, not when it summons them.
    if (store.shop().some((r) => r.affordable)) opener.appendChild(el('span', { class: 'dot', text: '●' }))
    opener.hidden = open
  }

  paint()
  const off = store.subscribe((what) => { if (what === 'codex' || what === 'commit') { if (open) render(); else paint() } })

  return {
    get open () { return open },
    toggle,
    destroy () {
      off()
      window.removeEventListener('keydown', onKey)
      mount.removeChild(opener)
      mount.removeChild(panel)
    }
  }
}
