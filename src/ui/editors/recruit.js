// The Recruit editor — "the most important editor in the game" (§4).
//
//   1. IF enemy.kin = Drake AND kinCount(Drake) < 4   → PERSUADE at hp ≤ 30%
//   2. IF enemy.tier ≥ 4                              → PERSUADE at hp ≤ 40%
//   3. ELSE                                           → KILL
//
// This is where §2's tension lives: you have to stop killing something while it is still hitting
// you, and because you never touch the controls, the decision is a line you wrote hours ago. So
// this editor is the first one built — it is the one that changes what a run *is*, rather than how
// efficiently it does what it was already doing.

import { el, select } from '../dom.js'
import { createExprEditor } from '../expr.js'
import { fireBadge } from '../badge.js'
import { RECRUIT_ACTIONS, CUT_MODES, STANDING_ORDERS, shadowed } from '../../sim/doctrine.js'
import { RULE_VARS } from '../../sim/content/forms.js'

export const meta = {
  id: 'recruit',
  title: 'RECRUIT',
  lede: 'Every fight, each unit checks these rules against the weakest enemy still standing. ' +
        'First match wins — so order is the argument you are making. A PERSUADE spends a whole ' +
        'gauge fill on talking instead of hitting, and only lands below the HP you name.'
}

export function render ({ store, kernel, getTrace, cap, rerender }) {
  const doctrine = store.draft
  const badges = []
  const root = el('div')
  const slots = cap?.slotsFor('recruit') ?? 0
  const actions = RECRUIT_ACTIONS.filter((a) => !cap || cap.hasAction(a.id))

  root.appendChild(el('h2', { text: meta.title }))
  root.appendChild(el('p', { class: 'lede', text: meta.lede }))

  const warns = new Map(shadowed(doctrine).map((w) => [w.path, w.msg]))

  doctrine.recruit.forEach((rule, i) => {
    const badge = fireBadge({ getTrace, editor: 'recruit', index: i })
    badges.push(badge)

    const line = el('div', { class: 'line' })
    line.appendChild(el('span', { class: 'kw', text: 'IF' }))

    const expr = createExprEditor({
      kernel,
      cap,
      vars: RULE_VARS.recruit,
      onChange: (next) => { store.update((d) => { d.recruit[i].when = next }); rerender() }
    })
    line.appendChild(expr.render(rule.when ?? true, 'bool'))

    line.appendChild(el('span', { class: 'kw', text: 'THEN' }))
    line.appendChild(select(
      actions.map((a) => ({ value: a.id, label: a.label, title: a.desc })),
      rule.action,
      (value) => {
        store.update((d) => {
          d.recruit[i].action = value
          // A PERSUADE with no threshold would never fire and would read as a broken editor rather
          // than as an unfinished rule, so it arrives with the shipped default already in it.
          if (value === 'persuade' && !(d.recruit[i].at > 0)) d.recruit[i].at = 0.3
        })
        rerender()
      }
    ))

    if (rule.action === 'persuade') {
      line.appendChild(el('span', { class: 'kw', text: 'at hp ≤' }))
      const readout = el('span', { text: pct(rule.at) })
      line.appendChild(el('input', {
        class: 'chip', type: 'range', min: '0.05', max: '1', step: '0.05', value: String(rule.at ?? 0.3),
        title: 'The weaker they are, the better the odds — up to 3× at a sliver of HP (§2).',
        oninput: (e) => {
          readout.textContent = pct(Number(e.target.value))
          store.update((d) => { d.recruit[i].at = Number(e.target.value) })
          for (const b of badges) b.sync()
        }
      }))
      line.appendChild(readout)
    }

    line.appendChild(badge.node)
    line.appendChild(el('span', { class: 'tools' }, [
      el('button', { text: '↑', title: 'earlier', disabled: i === 0, onclick: () => move(i, -1) }),
      el('button', { text: '↓', title: 'later', disabled: i === doctrine.recruit.length - 1, onclick: () => move(i, 1) }),
      el('button', { text: '×', title: 'delete', onclick: () => remove(i) })
    ]))

    const main = el('div', { class: 'main' }, [line, badge.panel])
    if (rule._note) main.appendChild(el('div', { class: 'why', text: rule._note }))
    const shadow = warns.get(`recruit[${i}]`)
    if (shadow) main.appendChild(el('div', { class: 'why', text: `⚠ ${shadow}` }))

    root.appendChild(el('div', { class: 'rule' + (shadow ? ' unreachable' : '') }, [
      el('span', { class: 'ord', text: String(i + 1) }),
      main
    ]))
  })

  root.appendChild(el('button', {
    class: 'act',
    text: doctrine.recruit.length < slots ? `+ add a rule  (${doctrine.recruit.length}/${slots})` : `all ${slots} slot(s) used`,
    disabled: doctrine.recruit.length >= slots,
    title: doctrine.recruit.length >= slots ? 'Another slot is a separate purchase in the Codex list.' : '',
    onclick: () => {
      store.update((d) => d.recruit.push({ when: ['lte', ['hpPct', '$target'], 0.3], action: actions[0]?.id ?? 'persuade', at: 0.3 }))
      rerender()
    }
  }))

  // ★ The standing orders, shown and not editable (§4). They are how a competent retinue behaves
  // with no orders, they run after everything above, and no price buys them — what a slot buys is
  // the right to be heard first. Showing them is what makes that sentence legible rather than a
  // claim: the player can see exactly what they are pre-empting.
  root.appendChild(el('h2', { text: 'STANDING ORDERS', style: 'margin-top:22px' }))
  root.appendChild(el('p', {
    class: 'lede',
    text: 'What the party does when nothing above has matched. These are not yours and cannot be ' +
          'edited or bought — a rule you write goes in front of them.'
  }))
  STANDING_ORDERS.recruit.forEach((rule, i) => {
    const badge = fireBadge({ getTrace, editor: 'recruit', index: doctrine.recruit.length + i })
    badges.push(badge)
    const line = el('div', { class: 'line' }, [
      el('span', { class: 'kw', text: 'IF' }),
      el('span', { text: rule.when === true ? 'ALWAYS' : kernel.forms.text(rule.when) }),
      el('span', { class: 'kw', text: 'THEN' }),
      el('span', { text: rule.action.toUpperCase() + (rule.at ? `  at hp ≤ ${pct(rule.at)}` : '') }),
      badge.node
    ])
    const main = el('div', { class: 'main' }, [line, badge.panel])
    if (rule._note) main.appendChild(el('div', { class: 'why', text: rule._note }))
    root.appendChild(el('div', { class: 'rule standing' }, [
      el('span', { class: 'ord', text: String(doctrine.recruit.length + i + 1) }),
      main
    ]))
  })

  // The cut rule is part of this editor because it is part of the same decision: every recruit past
  // twelve is a statement about what you are willing to lose (§2). It is its own purchase, though,
  // so it is absent rather than greyed for a player who bought only the threshold.
  if (cap?.can('cut')) {
  root.appendChild(el('div', { class: 'strip', style: 'margin-top:18px' }, [
    el('span', { class: 'kw', text: 'WHEN THE PARTY IS FULL, CUT' }),
    select(
      CUT_MODES.map((c) => ({ value: c.id, label: c.label, title: c.desc })),
      doctrine.cut,
      (value) => { store.update((d) => { d.cut = value }); rerender() }
    )
  ]))
  root.appendChild(el('div', {
    class: 'hint',
    text: 'A recruit that cannot be fitted is declined outright — nothing is ever dropped silently.'
  }))
  }

  function move (i, by) {
    store.update((d) => {
      const [rule] = d.recruit.splice(i, 1)
      d.recruit.splice(i + by, 0, rule)
    })
    rerender()
  }

  function remove (i) {
    store.update((d) => d.recruit.splice(i, 1))
    rerender()
  }

  return { root, badges }
}

const pct = (v) => `${Math.round((v ?? 0) * 100)}%`
