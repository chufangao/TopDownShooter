// Export / import (§11.6).
//
// > Because expressions are plain JSON, three things come free: Doctrine sets serialise into the
// > save with no special casing, a Doctrine is a **shareable export string** (a genuinely good
// > social feature for a game about authoring policy), and the Doctrine editor UI is a tree editor
// > over a data structure rather than a bespoke rule compiler.
//
// This tab is the second of those, and it costs the two function calls below. It is also the escape
// hatch for the editors that do not exist yet: Formation, Ability and Route all have backing fields
// in the sim, and until each has a surface of its own they can be written here by hand.

import { el } from '../dom.js'
import { exportDoctrine, importDoctrine } from '../../sim/doctrine.js'

export const meta = {
  id: 'share',
  title: 'SHARE',
  lede: 'A Doctrine is plain JSON, so this text is the whole thing. Paste someone else\'s in, or ' +
        'copy yours out. Fields with no editor yet — formation pins, ability rules, the route — ' +
        'are here in full and take effect exactly the same way.'
}

export function render ({ store, rerender }) {
  const root = el('div')
  root.appendChild(el('h2', { text: meta.title }))
  root.appendChild(el('p', { class: 'lede', text: meta.lede }))

  const status = el('div', { class: 'hint', text: '' })
  const area = el('textarea', { class: 'share', spellcheck: 'false' })
  area.value = exportDoctrine(store.draft)

  root.appendChild(area)
  root.appendChild(el('div', { class: 'strip', style: 'margin-top:10px' }, [
    el('button', {
      class: 'act',
      text: 'load this text',
      onclick: () => {
        const { doctrine, error } = importDoctrine(area.value)
        if (error) { status.textContent = `✕ ${error}`; return }
        store.replace(doctrine)
        rerender()
      }
    }),
    el('button', {
      class: 'act',
      text: 'copy',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(area.value)
          status.textContent = 'copied'
        } catch {
          area.select()
          status.textContent = 'selected — press ⌘C'
        }
      }
    }),
    el('button', { class: 'act', text: 'back to the shipped set', onclick: () => { store.reset(); rerender() } })
  ]))
  root.appendChild(status)

  return { root, badges: [] }
}
