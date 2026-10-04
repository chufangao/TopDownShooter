// The Route / Risk editor (§4) — which dungeon nodes to path toward, and when to descend.
//
// A floor is 14–22 nodes and you do not have to take all of them. Two decisions live here and they
// pull against each other: an elite is a fight you might not survive and a recruit you might not get
// otherwise, and a campfire taken too early heals a party that is still at full health.
//
// The third lever is §6.1's, restated: recovery is 25% of max HP after a won fight and a full heal
// only at a campfire, so "how many nodes before the stairs" is a question about how much HP you are
// willing to spend to see the rest of the floor.

import { el, select } from '../dom.js'
import { NODE_TYPES, DEFAULT_ROUTE_ORDER } from '../../sim/dungeon.js'
import { BATTLE_NODES } from '../../sim/run.js'

export const meta = {
  id: 'route',
  title: 'ROUTE',
  lede: 'The leader walks the floor in this order, nearest first within a rank, then takes the ' +
        'stairs. Skipping a type walks past it entirely; descending early leaves the rest behind.'
}

/** Every node type a floor can hold, plus the boss the eighth floor ends on. */
const ALL_TYPES = [...new Set([...NODE_TYPES.map((n) => n.type), ...Object.keys(DEFAULT_ROUTE_ORDER)])].sort()

const RANKS = [0, 1, 2, 3, 4, 5]

const NOTE = {
  encounter: 'most of your XP and recruits',
  treasure: 'an item, once items exist',
  shrine: 'a buff at a cost',
  merchant: 'spends Coin',
  campfire: 'full heal; the only revive',
  elite: 'best odds of a high tier, likeliest wipe',
  rare: 'an uncommon spawn',
  secret: 'quiet',
  boss: 'ends the floor; cannot be skipped'
}

export function render ({ store, cap, rerender }) {
  const doctrine = store.draft
  const root = el('div')
  const skip = new Set(doctrine.route.skip)

  root.appendChild(el('h2', { text: meta.title }))
  root.appendChild(el('p', { class: 'lede', text: meta.lede }))

  // The resulting walk, spelled out. A rank table is hard to read as an order; the order is the
  // thing the player is actually choosing.
  const visiting = ALL_TYPES.filter((t) => !skip.has(t))
  const byRank = new Map()
  for (const t of visiting) {
    const r = doctrine.route.order[t] ?? 2
    byRank.set(r, [...(byRank.get(r) ?? []), t])
  }
  const order = [...byRank.entries()].sort((a, b) => a[0] - b[0])
    .map(([, types]) => types.sort().join(' · '))
  root.appendChild(el('div', { class: 'walk' }, [
    el('span', { class: 'kw', text: 'WALK  ' }),
    el('span', { text: (order.join('  →  ') || 'nothing') + '  →  ' }),
    el('span', { class: 'kw', text: 'STAIRS' })
  ]))

  root.appendChild(el('div', { style: 'margin-top:12px' }))
  for (const type of ALL_TYPES) {
    const skipped = skip.has(type)
    const fights = BATTLE_NODES[type]
    const row = el('div', { class: 'noderow' }, [
      el('span', { text: type }),
      select(
        RANKS.map((r) => ({ value: String(r), label: ordinal(r), title: 'Lower goes first.' })),
        String(doctrine.route.order[type] ?? 2),
        (value) => { store.update((d) => { d.route.order[type] = Number(value) }); rerender() },
        { className: 'chip narrow' }
      ),
      // Skipping is its own purchase: ranking a node type last and refusing to walk to it at all
      // are different decisions, and the second one is the one that can lose you a run.
      el('input', {
        type: 'checkbox', id: `skip-${type}`, checked: skipped, disabled: type === 'boss' || !(cap?.can('route.skip') ?? true),
        onchange: (e) => {
          store.update((d) => {
            d.route.skip = e.target.checked
              ? [...new Set([...d.route.skip, type])]
              : d.route.skip.filter((t) => t !== type)
          })
          rerender()
        }
      }),
      el('label', { class: 'why', for: `skip-${type}`, text: 'skip' }),
      el('span', { class: 'why', text: (fights ? `${fights} foes · ` : '') + (NOTE[type] ?? '') })
    ])
    if (skipped) row.style.opacity = '.5'
    root.appendChild(row)
  }

  if (cap && !cap.can('route.skip')) {
    root.appendChild(el('div', { class: 'hint', text: 'Walking past a node type outright is a separate tenet.' }))
  }

  if (!cap || cap.can('route.maxNodes')) {
  root.appendChild(el('h2', { text: 'WHEN TO DESCEND', style: 'margin-top:20px' }))
  root.appendChild(el('p', {
    class: 'lede',
    text: 'A won fight gives back a quarter of everyone\'s health, which absorbs a clean win and not ' +
          'a bad one. Taking fewer nodes is the safest a floor gets, and the least it pays.'
  }))

  const max = doctrine.route.maxNodes
  root.appendChild(el('div', { class: 'strip' }, [
    select(
      [{ value: '', label: 'clear the whole floor', title: 'Visit every node that is not skipped.' },
        ...[3, 5, 8, 10, 12, 15, 18].map((n) => ({ value: String(n), label: `after ${n} nodes` }))],
      max === null ? '' : String(max),
      (value) => {
        store.update((d) => { d.route.maxNodes = value === '' ? null : Number(value) })
        rerender()
      }
    ),
    el('span', { class: 'why', text: max === null ? 'every node, then the stairs' : `${max} nodes, then the stairs` })
  ]))
  }

  root.appendChild(el('div', { class: 'strip', style: 'margin-top:14px' }, [
    el('button', {
      class: 'act', text: 'back to the shipped route',
      onclick: () => {
        store.update((d) => { d.route = { order: { ...DEFAULT_ROUTE_ORDER }, skip: [], maxNodes: null } })
        rerender()
      }
    })
  ]))

  return { root, badges: [] }
}

const ordinal = (n) => ['1st', '2nd', '3rd', '4th', '5th', '6th'][n] ?? String(n + 1)
