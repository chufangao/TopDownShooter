// Dispatches (§4.1) — what happened, and nothing else.
//
// > **Superseded — the Precedent.** §4.1 defined a Precedent as an event you *answer*, where every
// > option was a real rule and answering was `rules.unshift(offer.rule)`. It was built and it
// > worked. What it got wrong is that the card knew the answer: it named the thing that went wrong
// > *and* the fix, so the player's move was to approve a suggestion. Handing over a whole panel for
// > free made that worse, because the most consequential decision in the system — what you are able
// > to say at all — was also being made for them.
//
// A **Dispatch** reports and stops. It says three enemies dropped below the threshold and were
// killed, and the last was a Frost Sprite at 22%. It does not say that you should have parleyed, it
// does not offer a rule, and it does not offer a capability. **What to do about it is the player's
// to deduce and the player's to buy** (§4.2, tenets).
//
// Everything that made the Precedent worth building survives, because it was never the offers:
//
//   * It names the concrete thing that happened, not a form field. That is what makes it readable
//     as a fact about your own run rather than a tutorial.
//   * It never blocks. The run does not pause, nothing waits, and an ignored dispatch costs the
//     player exactly nothing — which is what keeps §1's loop D intact, because a headless run in a
//     Worker with no UI has to be able to raise them into a queue nobody ever reads.
//   * It is retroactive. It fires after the fact and changes nothing at all by itself.
//
// The test for whether a dispatch is written correctly is one question: **could two players read
// this and reasonably do different things?** If there is only one sensible response, the copy has
// smuggled the answer back in and it should be cut down to the measurement.
//
// Pure JS. No clock, no Math.random, no Phaser, and no RNG stream either — see `raise()`.

/** How many reports may be live at once. A feed you have to clear is a chore, and a chore is a tab. */
export const QUEUE_CAP = 4

/**
 * Which dispatches are true right now.
 *
 * ★ **No RNG reaches this function, deliberately.** A `when` that could draw from a stream would
 * make noticing something a step in the run's random sequence, and "an ignored dispatch costs
 * nothing" would be false by construction rather than by accident. `rand` therefore throws inside a
 * dispatch's `when`, which is the correct failure: it names the content instead of silently
 * shifting everyone's loot.
 *
 * @param {object} opts
 * @param {object} opts.kernel
 * @param {object} opts.ledger    the signal ledger (§4.3)
 * @param {object} opts.doctrine  normalised — read only so a dispatch can be quiet about a thing
 *   the player has already spoken to
 * @returns {Array<object>} cards, highest `prio` first, at most `cap`
 */
export function raise ({ kernel, ledger, doctrine, floor = 1, cap = QUEUE_CAP }) {
  const R = kernel.registry
  if (!R.kinds().includes('dispatch')) return []

  const ctx = { vars: {}, registry: R, signals: ledger, doctrine, run: { floor } }
  const live = []

  // `R.all` is sorted by id, so which dispatches are considered — and how ties break — cannot
  // depend on which pack loaded first (§11.1).
  for (const def of R.all('dispatch')) {
    const once = def.once ?? 'run'
    if (ledger.wasRaised(def.id)) continue
    if (once !== 'never' && ledger.wasAnswered(def.id, once)) continue

    let fires = false
    try {
      fires = !!kernel.forms.eval(def.when, ctx)
    } catch {
      // A dispatch whose gate throws is a content bug, and the honest response is for it never to
      // fire rather than for the run to stop. `tools/lint.js` is where that should have been caught,
      // in under a second, with the pack's name on it (§16.2).
      continue
    }
    if (fires) live.push(def)
  }

  // Marked seen only after the cap is applied. Marking on the way in looks equivalent and is not:
  // the fifth report of a busy node would be stamped as shown, dropped by the slice, and never
  // appear again this run. The cap means "not all at once", not "the rest never happened".
  const shown = live.sort((a, b) => (b.prio ?? 0) - (a.prio ?? 0) || (a.id < b.id ? -1 : 1)).slice(0, cap)
  for (const def of shown) ledger.markRaised(def.id)
  return shown.map((def) => toCard(def, { ledger, floor }))
}

/** One def, rendered into what a person actually reads. The UI touches no registry and no ledger. */
function toCard (def, { ledger, floor }) {
  return {
    id: def.id,
    prio: def.prio ?? 0,
    once: def.once ?? 'run',
    floor,
    /** Loose grouping for the feed's left rule — `combat` · `party` · `route` · `run`. Cosmetic. */
    topic: def.topic ?? 'run',
    title: interpolate(def.title, ledger),
    body: interpolate(def.body, ledger)
  }
}

/**
 * Dismissing is the only interaction a dispatch has, and it is not an answer.
 *
 * `once: 'profile'` reports — a measurement that is only interesting the first time you meet it —
 * are recorded so they do not return. Everything else is `once: 'run'` and comes back next run if
 * it is still true then, which is the point: a thing that keeps happening should keep being
 * reported, and it is the player's business whether to do anything about it.
 */
export function dismiss (card, { ledger }) {
  if (card.once === 'profile') ledger.markAnswered(card.id, 'profile')
  return ledger
}

/**
 * `"{signalCount:recruit:missed} enemies went below the threshold and died anyway."`
 *
 * Three forms and no more: this run's count, the lifetime count, and a field off the most recent
 * payload. A dispatch body is a measurement with words around it — the moment it needs a fourth
 * form, what is being written is a report and belongs in the post-mortem (§4.5).
 *
 * A fraction renders as a percentage, because every fraction in this game is one.
 */
export function interpolate (text, ledger) {
  if (typeof text !== 'string') return ''
  return text.replace(/\{(signalCount|signalTotal|last):([a-z0-9_:]+)(?:\.([a-z0-9_]+))?\}/gi, (whole, kind, name, field) => {
    if (kind === 'signalCount') return String(ledger.count(name, 'run'))
    if (kind === 'signalTotal') return String(ledger.count(name, 'profile'))
    const payload = ledger.last(name)
    const v = field ? payload?.[field] : payload
    if (v === null || v === undefined) return '—'
    return typeof v === 'number' && !Number.isInteger(v) ? `${Math.round(v * 100)}%` : String(v)
  })
}
