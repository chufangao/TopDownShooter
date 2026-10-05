// Party panel, formation grid, relics and synergies: shared by the map, spoils and swap screens.
import { h, portrait, hpBar } from './el.js'
import { unitDef, relicDef, KIN, ROLES } from '../content/index.js'
import { activeSynergies } from '../sim/stats.js'
import { xpToNext } from '../sim/run.js'
import { COLS, ROWS, slotAt } from '../sim/formation.js'

export function unitRow (u, extra = null) {
  const d = unitDef(u.id)
  return h('div', { class: 'unit' + (u.hp <= 0 ? ' fallen' : '') },
    portrait(u.id),
    h('div', { class: 'grow' },
      h('div', null, h('b', null, d.name), ` Lv ${u.lvl}`, h('span', { class: 'dim' }, ` · ${KIN[d.kin].name} ${ROLES[d.role].name}`)),
      h('div', { class: 'line' }, hpBar(u), h('span', { class: 'dim' }, u.hp > 0 ? `${u.hp}/${u.maxHp}` : 'fallen'),
        u.xp != null && h('span', { class: 'dim' }, ` xp ${u.xp}/${xpToNext(u.lvl)}`))),
    extra)
}

export const partyList = (party) => h('div', { class: 'units' }, party.slice().sort((a, b) => a.slot - b.slot).map((u) => unitRow(u)))

// 3×4 grid, front row on top (nearest the enemy). Click two slots to swap them.
export function formationGrid (party, { selected = null, onSlot = null } = {}) {
  const at = new Map(party.map((u) => [u.slot, u]))
  const rows = []
  for (let r = 0; r < ROWS; r++) {
    const cells = []
    for (let c = 0; c < COLS; c++) {
      const slot = slotAt(r, c)
      const u = at.get(slot)
      cells.push(h('button', {
        class: 'cell' + (u ? '' : ' empty') + (selected === slot ? ' sel' : '') + (u && u.hp <= 0 ? ' fallen' : ''),
        title: u ? `${unitDef(u.id).name} Lv ${u.lvl}` : 'empty',
        disabled: !onSlot,
        onclick: () => onSlot?.(slot)
      }, u ? [portrait(u.id, 36), hpBar(u)] : '·'))
    }
    rows.push(h('div', { class: 'row' }, h('span', { class: 'rowname' }, ['front', 'mid', 'back'][r]), cells))
  }
  return h('div', { class: 'grid' }, rows)
}

export function relicList (ids) {
  if (!ids.length) return h('p', { class: 'dim' }, 'None yet. Relics come from elites, treasure and spoils.')
  return h('ul', { class: 'list' }, ids.map((id) => {
    const r = relicDef(id)
    return h('li', null, h('b', null, r.name), h('span', { class: 'dim' }, ' ' + r.desc))
  }))
}

export function synergyList (party) {
  const active = activeSynergies(party.filter((u) => u.hp > 0))
  if (!active.length) return h('p', { class: 'dim' }, 'None. Field 2+ of one kin or role.')
  return h('ul', { class: 'list' }, active.map((s) => h('li', null, h('b', null, s.name), h('span', { class: 'dim' }, ' ' + s.desc))))
}
