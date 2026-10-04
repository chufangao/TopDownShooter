// The Targeting editor (§4) — an ordered priority list, overridable per Role.
//
//   lowest HP% → healers first → back row → nearest column
//
// It is a list rather than an expression tree on purpose. Targeting answers "of the candidates the
// formation already handed me, which one", and that is a sort, not a predicate — modelling it as a
// rule tree would make every player write the same comparison chain by hand. What the aggro roll
// leaves ambiguous, this decides; what it does not, it cannot (§3).

import { el, select } from '../dom.js'
import { TARGET_MODES } from '../../sim/doctrine.js'

export const meta = {
  id: 'targeting',
  title: 'TARGETING',
  lede: 'Which row gets attacked is an aggro roll — the front row draws about 60%. Which unit ' +
        'inside that row is this list, applied in order until two candidates differ. So the ' +
        'formation decides the shape of the fight and this decides the focus.'
}

export function render ({ store, kernel, cap, rerender }) {
  const doctrine = store.draft
  const root = el('div')

  root.appendChild(el('h2', { text: meta.title }))
  root.appendChild(el('p', { class: 'lede', text: meta.lede }))

  // Only the modes some tenet granted, and only as many rows as were paid for. The first entry is
  // free — it is the standing order — so a player who bought nothing here would see nothing at all,
  // and one who bought Mark by health sees four modes rather than thirteen.
  const modes = TARGET_MODES.filter((m) => !cap || cap.hasMode(m.id))
  const rows = Math.max(1, cap?.slotsFor('targeting.default') ?? 1)

  root.appendChild(listEditor({
    label: 'AGAINST ENEMIES',
    list: doctrine.targeting.default,
    modes,
    rows,
    onChange: (next) => { store.update((d) => { d.targeting.default = next }); rerender() }
  }))

  root.appendChild(listEditor({
    label: 'FOR HEALS AND BUFFS',
    list: doctrine.allyTargeting.default,
    modes,
    rows,
    onChange: (next) => { store.update((d) => { d.allyTargeting.default = next }); rerender() },
    hint: 'The same list, applied when the ability points at your own side.'
  }))

  // Per-Role overrides: a Vanguard and a Ranger are looking at the same field and should not
  // necessarily be looking for the same thing. Its own purchase, so absent until it is bought.
  if (!cap || cap.can('targeting.byRole')) {
  root.appendChild(el('h2', { text: 'BY ROLE', style: 'margin-top:20px' }))
  root.appendChild(el('p', { class: 'lede', text: 'An override replaces the list above for units of that Role. Anything left at “—” uses the default.' }))

  for (const role of kernel.registry.all('role')) {
    const override = doctrine.targeting.byRole[role.id]
    const row = el('div', { class: 'strip' }, [
      el('span', { style: 'width:12ch', text: role.name }),
      select(
        [{ value: '', label: '— default', title: 'Use the list above.' }, ...modes.map((m) => ({ value: m.id, label: m.label, title: m.desc }))],
        override?.[0] ?? '',
        (value) => {
          store.update((d) => {
            if (value) d.targeting.byRole[role.id] = [value, ...(d.targeting.byRole[role.id] ?? []).slice(1)]
            else delete d.targeting.byRole[role.id]
          })
          rerender()
        }
      )
    ])
    if (override?.length > 1) {
      row.appendChild(el('span', { class: 'kw', text: 'then ' + override.slice(1).map(labelOf).join(' → ') }))
    }
    root.appendChild(row)
  }
  }

  return { root, badges: [] }
}

/** One ordered priority list, as numbered dropdowns with add / remove / reorder. */
function listEditor ({ label, list, modes = TARGET_MODES, rows = Infinity, onChange, hint }) {
  const box = el('div', { style: 'margin-bottom:16px' })
  box.appendChild(el('div', { class: 'kw', style: 'margin-bottom:6px', text: label }))

  list.forEach((mode, i) => {
    box.appendChild(el('div', { class: 'strip' }, [
      el('span', { class: 'n', text: String(i + 1) }),
      select(
        modes.map((m) => ({ value: m.id, label: m.label, title: m.desc })),
        mode,
        (value) => onChange(list.map((m, j) => (j === i ? value : m)))
      ),
      el('span', { class: 'tools' }, [
        el('button', { text: '↑', title: 'higher priority', disabled: i === 0, onclick: () => onChange(swap(list, i, i - 1)) }),
        el('button', { text: '↓', title: 'lower priority', disabled: i === list.length - 1, onclick: () => onChange(swap(list, i, i + 1)) }),
        // A list has to keep at least one entry, or targeting falls back to slot order and the
        // editor looks broken rather than empty.
        el('button', { text: '×', title: 'remove', disabled: list.length < 2, onclick: () => onChange(list.filter((_, j) => j !== i)) })
      ]),
      el('span', { class: 'why', text: TARGET_MODES.find((m) => m.id === mode)?.desc ?? '' })
    ]))
  })

  box.appendChild(el('button', {
    class: 'act',
    text: list.length < rows ? `+ add a tie-break  (${list.length}/${rows})` : `all ${rows} priorit${rows === 1 ? 'y' : 'ies'} used`,
    disabled: list.length >= rows,
    title: list.length >= rows ? 'Another priority is a separate purchase in the Codex list.' : '',
    onclick: () => onChange([...list, modes.find((m) => !list.includes(m.id))?.id ?? modes[0].id])
  }))
  if (hint) box.appendChild(el('div', { class: 'hint', text: hint }))
  return box
}

function swap (list, a, b) {
  const copy = list.slice()
  ;[copy[a], copy[b]] = [copy[b], copy[a]]
  return copy
}

const labelOf = (id) => TARGET_MODES.find((m) => m.id === id)?.label ?? id
