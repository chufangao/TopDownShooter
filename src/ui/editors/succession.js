// Succession (§3, §4.2) — which branch a unit takes at level 5 and at level 10.
//
// The pick itself is never a prompt. It is taken the instant it is earned — first option if nothing
// here matches — because what breaks the never-touch-the-controls rule is *waiting for an answer*.
// So this panel is where you say what the default should have been, for every unit that gets there
// from here on, and a dispatch afterwards tells you when one chose for itself.

import { el, select } from '../dom.js'
import { createExprEditor } from '../expr.js'
import { fireBadge } from '../badge.js'
import { shadowed } from '../../sim/doctrine.js'
import { RULE_VARS } from '../../sim/content/forms.js'

export const meta = {
  id: 'branch',
  title: 'SUCCESSION',
  lede: 'At level 5 and 10 a unit picks one of two branches. It never waits for you — the first ' +
        'option is taken and this list is what changes that, in order, first match wins. A rule ' +
        'naming a branch a unit does not have is skipped, so one line can cover the whole roster.'
}

export function render ({ store, kernel, getTrace, cap, rerender }) {
  const doctrine = store.draft
  const R = kernel.registry
  const badges = []
  const root = el('div')

  root.appendChild(el('h2', { text: meta.title }))
  root.appendChild(el('p', { class: 'lede', text: meta.lede }))

  // Generated from the registry, like every other menu in this UI (§4.4): a pack's branch appears
  // here the moment it is defined, with no edit to this file.
  const branches = R.kinds().includes('branch')
    ? R.all('branch').map((b) => ({ value: b.id, label: b.name, title: b.desc ?? '' }))
    : []

  if (branches.length === 0) {
    root.appendChild(el('div', {
      class: 'hint',
      text: 'No content installed ships a branch yet, so there is nothing here to prefer. The rules ' +
            'below are still authored, stored and shared normally — the first pack that ships one ' +
            'will find them waiting.'
    }))
  }

  doctrine.branch.forEach((rule, i) => {
    const badge = fireBadge({ getTrace, editor: 'branch', index: i })
    badges.push(badge)

    const line = el('div', { class: 'line' })
    line.appendChild(el('span', { class: 'kw', text: 'IF' }))

    const expr = createExprEditor({
      kernel,
      cap,
      vars: RULE_VARS.branch,
      onChange: (next) => { store.update((d) => { d.branch[i].when = next }); rerender() }
    })
    line.appendChild(expr.render(rule.when ?? true, 'bool'))

    line.appendChild(el('span', { class: 'kw', text: 'THEN PREFER' }))
    line.appendChild(select(
      branches.length ? branches : [{ value: rule.prefer ?? '', label: rule.prefer ?? '(none installed)' }],
      rule.prefer ?? '',
      (value) => { store.update((d) => { d.branch[i].prefer = value }); rerender() }
    ))

    line.appendChild(badge.node)
    line.appendChild(el('span', { class: 'tools' }, [
      el('button', { text: '↑', title: 'earlier', disabled: i === 0, onclick: () => move(i, -1) }),
      el('button', { text: '↓', title: 'later', disabled: i === doctrine.branch.length - 1, onclick: () => move(i, 1) }),
      el('button', { text: '×', title: 'delete', onclick: () => remove(i) })
    ]))

    const main = el('div', { class: 'main' }, [line, badge.panel])
    const shadow = new Map(shadowed(doctrine).map((w) => [w.path, w.msg])).get(`branch[${i}]`)
    if (shadow) main.appendChild(el('div', { class: 'why', text: `⚠ ${shadow}` }))

    root.appendChild(el('div', { class: 'rule' + (shadow ? ' unreachable' : '') }, [
      el('span', { class: 'ord', text: String(i + 1) }),
      main
    ]))
  })

  const slots = cap?.slotsFor('branch') ?? 0
  root.appendChild(el('button', {
    class: 'act',
    text: doctrine.branch.length < slots ? `+ add a rule  (${doctrine.branch.length}/${slots})` : `all ${slots} slot(s) used`,
    disabled: doctrine.branch.length >= slots,
    onclick: () => {
      store.update((d) => d.branch.push({ when: true, prefer: branches[0]?.value ?? '' }))
      rerender()
    }
  }))

  root.appendChild(el('div', {
    class: 'hint',
    text: 'XP past the level cap is banked rather than discarded, so a branch you raise the cap to ' +
          'reach later is not a branch you missed.'
  }))

  function move (i, by) {
    store.update((d) => {
      const [rule] = d.branch.splice(i, 1)
      d.branch.splice(i + by, 0, rule)
    })
    rerender()
  }

  function remove (i) {
    store.update((d) => d.branch.splice(i, 1))
    rerender()
  }

  return { root, badges }
}
