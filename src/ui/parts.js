// Small parts several screens share: the field's order, a soul's row, the relics as chips, what a Monarch brings.
import { unitCard, partyMods, relicTip, campRowLabel, realmOf, relicsByTier, hpBar, relicIcon } from '../codex.js'
import { unitDef, relicDef, KIN, ROLES } from '../content.js'
import { h, icon, portrait } from '../dom.js'
import { rowOf } from '../sim/unit.js'
import { TUNING } from '../tuning.js'

// ── parts ────────────────────────────────────────────────────────────────────────────────────────

// Field first, front to back, then the ossuary.
export const fieldOrder = (a, b) => (a.slot < 0) - (b.slot < 0) || a.slot - b.slot || a.uid - b.uid

// A soul in a list: name, level and tiers; then its HP, where it waits, its kin, role and camp row.
export function unitRow (run, u, extra = null) {
  const d = unitDef(u.id)
  const more = d.monarch ? 'you' : u.slot < 0 ? 'ossuary' : ''
  const kin = !d.monarch && `${KIN[d.kin].name} ${ROLES[d.role].name}${u.slot >= 0 ? ` · ${campRowLabel(rowOf(u.slot)).toLowerCase()}` : ''}`
  const tiers = (u.tracks ?? []).filter(Boolean)
  return h('div', { class: 'unit' + (u.hp <= 0 ? ' fallen' : '') + (d.monarch ? ' monarch' : ''), tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run), run }) },
    h('span', { class: 'rank-port' + (d.monarch ? ' monarch' : '') + (u.hp <= 0 ? ' fallen' : '') }, portrait(u.id, 40)),
    h('div', { class: 'grow' },
      h('div', { class: 'u-name' }, h('b', null, d.name), !d.monarch && h('span', { class: 'dim' }, ` Lv ${u.lvl}`),
        tiers.length > 0 && h('span', { class: 'path-tag' }, ` tiers ${u.tracks.join('·')}`)),
      h('div', { class: 'line' }, hpBar(u.hp, u.maxHp), h('span', { class: 'dim' }, u.hp > 0 ? `${u.hp}/${u.maxHp}` : 'fallen', more && ` · ${more}`),
        kin && h('span', { class: 'dim u-kin' }, `· ${kin}`))),
    extra)
}

// The relics owned as chips in their tier's colour, grouped by tier (×N for copies; a trigger relic sparks).
export function relicList (ids, run = null) {
  if (!ids.length) return h('p', { class: 'dim small' }, 'None yet: the Shop sells them.')
  return h('div', { class: 'relics by-tier' }, relicsByTier(ids, ({ id, n }) =>
    h('span', { class: `relic rt-${relicDef(id).tier}` + (relicDef(id).on ? ' trig' : ''), tip: () => relicTip(id, run) },
      icon(relicIcon(id), 14), relicDef(id).name, n > 1 && h('span', { class: 'relic-n' }, `×${n}`))))
}

// What a Monarch brings: its relic and its draft's bias, a line each; the base one's none.
export function monarchRules (m) {
  const r = m.relic && relicDef(m.relic)
  const times = { 2: 'twice', 3: 'three times', 4: 'four times' }[TUNING.monarchs.bias] ?? `${TUNING.monarchs.bias} times`
  return [
    r && h('p', { class: 'mc-rule' }, h('b', null, 'Starts with '), `the ${r.name}: ${r.desc.charAt(0).toLowerCase()}${r.desc.slice(1)}`),
    m.bias && h('p', { class: 'mc-rule' }, h('b', null, 'Drafts '), `${KIN[m.bias].name} kinds ${times} as often as any other.`),
    !r && !m.bias && h('p', { class: 'mc-rule dim' }, 'No relic, and no kin favoured in the draft.')]
}
