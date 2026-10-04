// The fire count (§4.1) — and the click that turns a `0` into a sentence.
//
// > Every rule shows a live fire count. Each row carries a badge: how many times it fired in the
// > last run, and in the last battle. A rule that never fires is the single most common authoring
// > bug and is otherwise completely invisible — the badge reads `0` in amber and that is the entire
// > debugging story. Clicking it opens the last three evaluations with each sub-expression's value
// > shown inline, so `0` becomes "`kinCount(Drake)` was 4, not < 4".
//
// The counts come from `sim/trace.js`, which the run owns. This file only formats them, which is
// why the same numbers are available to `tools/sim.js` and to the M5 post-mortem with no DOM.

import { el, clear } from './dom.js'
import { explain } from '../sim/trace.js'

/**
 * @param {object} opts
 * @param {() => object|null} opts.getTrace  the live run's trace, or null between runs
 * @param {string} opts.editor
 * @param {number} opts.index
 * @returns {{node: HTMLElement, panel: HTMLElement, sync: Function}}
 */
export function fireBadge ({ getTrace, editor, index }) {
  const panel = el('div', { class: 'trace', hidden: true })
  const node = el('button', {
    class: 'badge',
    text: '—',
    title: 'How often this rule fired. Click for the last three evaluations.',
    onclick: () => {
      panel.hidden = !panel.hidden
      if (!panel.hidden) fill()
    }
  })

  function fill () {
    const trace = getTrace()
    clear(panel)
    const samples = trace?.samplesFor(editor, index) ?? []
    if (samples.length === 0) {
      // A catch-all has no sub-expressions to work through, so an empty popover is the correct
      // answer for it — but "play a battle" would be a lie when the badge already reads 12.
      const seen = trace?.countsFor(editor, index).run.evaluated ?? 0
      panel.appendChild(el('div', {
        class: 'head',
        text: seen > 0
          ? 'This rule has no condition — it fires whenever nothing above it matched.'
          : 'No evaluation recorded yet — play a battle.'
      }))
      return
    }
    samples.forEach((sample, i) => {
      panel.appendChild(el('div', { class: 'head', text: `evaluation ${i + 1} of ${samples.length}` }))
      for (const line of explain(sample)) panel.appendChild(el('div', { text: '  ' + line }))
      panel.appendChild(el('div', {
        class: sample.fired ? 'yes' : 'no',
        text: sample.fired ? '  → the rule fired' : '  → the rule did not fire'
      }))
    })
  }

  function sync () {
    const trace = getTrace()
    if (!trace) { node.textContent = '—'; node.className = 'badge'; return }
    const { run, battle } = trace.countsFor(editor, index)
    node.textContent = `${run.fired}↑ ${battle.fired} here`
    node.title = `Fired ${run.fired} of ${run.evaluated} times this run, ${battle.fired} of ${battle.evaluated} in the last battle. Click for the last three evaluations.`
    // Amber is the whole point: a rule that has been asked and never said yes is almost always a
    // rule the player believes is doing something.
    node.className = 'badge ' + (run.fired > 0 ? 'hot' : run.evaluated > 0 ? 'cold' : '')
    if (!panel.hidden) fill()
  }

  return { node, panel, sync }
}
