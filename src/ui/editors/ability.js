// The Ability editor (§4) — conditional usage.
//
//   IF allies.below(50% HP) ≥ 3  THEN heal_pulse
//   IF enemy.count ≥ 5           THEN row_sweep
//   ELSE                         basic
//
// The load-bearing behaviour, from §2, is what happens when the named ability is unaffordable: the
// unit **banks its gauge and waits**. It does not quietly fall through to something cheaper, because
// silent fall-through means a unit only ever casts its cheapest ability and every expensive ability
// in the game becomes dead data. Falling back is opt-in, per rule — that is the checkbox on each row.

import { el, select } from '../dom.js'
import { createExprEditor } from '../expr.js'
import { fireBadge } from '../badge.js'
import { ANY_ABILITY, shadowed } from '../../sim/doctrine.js'
import { RULE_VARS } from '../../sim/content/forms.js'

export const meta = {
  id: 'ability',
  title: 'ABILITY',
  lede: 'When a unit\'s gauge fills, these decide what it reaches for. First match wins, and a rule ' +
        'naming an ability the unit does not have is skipped — one Doctrine has to work for a roster ' +
        'that changes every fight.'
}

export function render ({ store, kernel, getTrace, cap, rerender }) {
  const doctrine = store.draft
  const R = kernel.registry
  const badges = []
  const root = el('div')

  root.appendChild(el('h2', { text: meta.title }))
  root.appendChild(el('p', { class: 'lede', text: meta.lede }))

  const abilities = R.all('ability')
  const options = [
    { value: ANY_ABILITY, label: 'whatever it has', title: 'Fall through to the unit\'s own list, in the order its def gives.', group: 'any' },
    ...abilities.map((a) => ({
      value: a.id,
      label: a.name ?? a.id,
      title: `${a.castCost} gauge · ${a.shape ?? 'single'}${a.element ? ' · ' + a.element : ''}`,
      group: a.melee ? 'melee' : a.shape === 'ally' || a.shape === 'all_allies' ? 'support' : 'ranged'
    }))
  ]

  if (doctrine.ability.length === 0) {
    root.appendChild(el('div', { class: 'rule' }, [
      el('span', { class: 'ord', text: '—' }),
      el('div', { class: 'main' }, [
        el('div', { text: 'No rules. Every unit uses its own abilities in the order its def lists them.' }),
        el('div', { class: 'why', text: 'That is what the game did before this editor existed, so an empty list costs you nothing.' })
      ])
    ]))
  }

  const warns = new Map(shadowed(doctrine).map((w) => [w.path, w.msg]))

  doctrine.ability.forEach((rule, i) => {
    const badge = fireBadge({ getTrace, editor: 'ability', index: i })
    badges.push(badge)

    const line = el('div', { class: 'line' })
    line.appendChild(el('span', { class: 'kw', text: 'IF' }))

    const expr = createExprEditor({
      kernel,
      cap,
      vars: RULE_VARS.ability,
      onChange: (next) => { store.update((d) => { d.ability[i].when = next }); rerender() }
    })
    line.appendChild(expr.render(rule.when ?? true, 'bool'))

    line.appendChild(el('span', { class: 'kw', text: 'THEN USE' }))
    line.appendChild(select(options, rule.use, (value) => {
      store.update((d) => { d.ability[i].use = value })
      rerender()
    }))

    line.appendChild(badge.node)
    line.appendChild(el('span', { class: 'tools' }, [
      el('button', { text: '↑', title: 'earlier', disabled: i === 0, onclick: () => move(i, -1) }),
      el('button', { text: '↓', title: 'later', disabled: i === doctrine.ability.length - 1, onclick: () => move(i, 1) }),
      el('button', { text: '×', title: 'delete', onclick: () => { store.update((d) => d.ability.splice(i, 1)); rerender() } })
    ]))

    const main = el('div', { class: 'main' }, [line, badge.panel])

    if (rule.use !== ANY_ABILITY) {
      const box = el('input', {
        type: 'checkbox', id: `else-${i}`, checked: !!rule.orElse,
        onchange: (e) => { store.update((d) => { d.ability[i].orElse = e.target.checked }); rerender() }
      })
      main.appendChild(el('div', { class: 'strip', style: 'margin:6px 0 0' }, [
        box,
        el('label', {
          class: 'why', for: `else-${i}`,
          text: rule.orElse
            ? 'cannot afford it → try the next rule'
            : 'cannot afford it → wait and bank gauge'
        })
      ]))
    }

    const shadow = warns.get(`ability[${i}]`)
    if (shadow) main.appendChild(el('div', { class: 'why', text: `⚠ ${shadow}` }))

    root.appendChild(el('div', { class: 'rule' + (shadow ? ' unreachable' : '') }, [
      el('span', { class: 'ord', text: String(i + 1) }),
      main
    ]))
  })

  root.appendChild(el('div', { class: 'strip', style: 'margin-top:4px' }, [
    el('button', {
      class: 'act', text: '+ add a rule',
      onclick: () => {
        store.update((d) => d.ability.push({
          when: ['gte', ['enemyCount'], 3],
          use: abilities[0]?.id ?? ANY_ABILITY
        }))
        rerender()
      }
    }),
    doctrine.ability.length > 0 && !doctrine.ability.some((r) => r.use === ANY_ABILITY && r.when === true)
      ? el('button', {
        class: 'act', text: '+ add ELSE',
        title: 'A final catch-all: use whatever the unit has. Without one, a unit no rule matched falls back to its own list anyway.',
        onclick: () => { store.update((d) => d.ability.push({ when: true, use: ANY_ABILITY })); rerender() }
      })
      : null
  ]))

  function move (i, by) {
    store.update((d) => {
      const [rule] = d.ability.splice(i, 1)
      d.ability.splice(i + by, 0, rule)
    })
    rerender()
  }

  return { root, badges }
}
