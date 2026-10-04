// The dispatch feed (§4.1) — what happened, over the dungeon, while it keeps happening.
//
// > A self-playing game that hides its only interaction behind a tab has hidden the game.
//
// But the fix for that is not a card that tells the player what to do. This feed reports and stops:
// three enemies went under the threshold and died, the last a Frost Sprite at 22%. **What that is
// worth, and what to buy about it, is the player's to work out.** There is no offer, no
// recommendation, and no button that writes a rule — the only interaction is dismissing something
// you have finished reading.
//
// Three rules this file exists to keep:
//
//   * **It never blocks.** No modal, no overlay that swallows clicks, no pause. The run walks on
//     behind it — which is what keeps §1's loop D intact, because a headless run has to be able to
//     raise these into a queue nobody ever reads.
//   * **Ignoring it costs nothing.** The feed is capped, reports expire with the run, and nothing
//     accumulates that has to be cleared.
//   * **The sim decides; this shows.** Cards arrive already rendered from `sim/dispatch.js`. This
//     file evaluates nothing and knows no game rules (§18.15).

import { el, clear } from './dom.js'
import { injectStyles } from './styles.js'

/** How many reports are on screen at once. The rest wait; a wall of text is not a report. */
export const SHOWN = 2

/**
 * @param {object} opts
 * @param {HTMLElement} opts.mount
 * @param {object} opts.store  only `seen()` is called — there is nothing here to answer
 */
export function createDispatchFeed ({ mount, store }) {
  injectStyles()

  /** @type {Array<object>} unread reports, highest prio first */
  let queue = []

  const root = el('div', { class: 'dispatches' })
  mount.appendChild(root)

  /** Take newly raised reports. Deduped by id — one can still be on screen when the next arrives. */
  function push (cards = []) {
    if (!cards.length) return
    const seen = new Set(queue.map((c) => c.id))
    for (const card of cards) if (!seen.has(card.id)) queue.push(card)
    queue.sort((a, b) => b.prio - a.prio)
    render()
  }

  function dismiss (card) {
    store.seen(card)
    queue = queue.filter((c) => c.id !== card.id)
    render()
  }

  function render () {
    clear(root)
    for (const card of queue.slice(0, SHOWN)) root.appendChild(renderCard(card))
    if (queue.length > SHOWN) {
      root.appendChild(el('div', { class: 'more-cards', text: `+${queue.length - SHOWN} more — they can wait` }))
    }
  }

  function renderCard (card) {
    return el('div', { class: `card topic-${card.topic}` }, [
      el('div', { class: 'chead' }, [
        el('span', { class: 'tag', text: 'NOTED' }),
        el('span', { class: 'where', text: `floor ${card.floor}` })
      ]),
      el('h3', { text: card.title }),
      el('p', { class: 'cbody', text: card.body }),
      // Deliberately the only control. Anything else here would be the game answering its own
      // question, which is the shape §4.1 records as wrong.
      el('div', { class: 'cfoot' }, [
        el('span', { class: 'grow' }),
        el('button', { class: 'link', text: '[ dismiss ]', onclick: () => dismiss(card) })
      ])
    ])
  }

  render()

  return {
    push,
    get length () { return queue.length },
    clear () { queue = []; render() },
    destroy () { mount.removeChild(root) }
  }
}
