// Rules text, generated from the content data so it is never out of date: unit stat cards, ability
// and status text, room and threat tooltips, the synergy tracker, merge previews and How to play.
import { TUNING } from './tuning.js'
import { unitDef, abilityDef, statusDef, relicDef, KIN, ROLES, ROLE_LIST, BEHAVIOURS, ELEMENTS, ELEMENT_LIST, SYNERGIES, RELIC_LIST, BONDS } from './content.js'
import { statsOf, activeSynergies, synergyActive, baseStats, COLS, ROWS, slotAt, rangeOf, isAllyShape, activeBonds, CAMP_ROWS } from './sim/unit.js'
import { xpToNext, foeMods, fielded } from './sim/run.js'
import { h, icon, portrait } from './dom.js'

const pct = (v) => `${Math.round(v * 100)}%`
const secs = (ticks) => `${(ticks * TUNING.tick.ms / 1000).toFixed(1)} s`
const ROW_NAMES = ['front', 'middle', 'back']

// Camp rows by name, front first, and what standing in one means once the battle starts.
export const campRowLabel = (r) => (r === 0 ? 'Front' : r === CAMP_ROWS - 1 ? 'Rear' : `Row ${r + 1}`)
export const campRowText = (r) => r === 0
  ? 'Closest to the foes: first to meet them, and in the way of anyone coming into the camp.'
  : `${r} row${r > 1 ? 's' : ''} back from the front: their melee has to find a way through the camp to get here, but your ranged souls may need to walk up to reach them.`

// Gauge filled per tick, and how long a cost takes to fill from empty.
const gaugeRate = (s) => (TUNING.gauge.base + s.spd / TUNING.gauge.spdDivisor) * s.gauge.rate
const fillTime = (s, cost) => secs(cost / gaugeRate(s))

// ── mods: what a unit really fights with ─────────────────────────────────────────────────────────

const relicMods = (relics) => relics.flatMap((id) => relicDef(id).mods ?? [])

// The mods a fielded soul starts a battle with: relics plus the field's synergies.
export const partyMods = (run) => [...relicMods(run.state.relics), ...activeSynergies(livingField(run)).flatMap((s) => s.mods)]
const livingField = (run) => fielded(run.state.party).filter((u) => u.hp > 0)

// Foes of a room on the current floor start with the floor's multipliers plus their synergies.
export const roomFoeMods = (run, node) => [...foeMods(run.state.floor, node.type === 'boss'), ...activeSynergies(node.foes).flatMap((s) => s.mods)]

// The formation bonds one unit holds among `units` (its side's formation), and what they add.
export const heldBonds = (units, u) => activeBonds(units).filter((b) => b.uid === u.uid)
export const bondMods = (units, u) => heldBonds(units, u).flatMap((b) => b.bond.mods)
export const bondNotes = (units, u) => heldBonds(units, u).map((b) =>
  `Bond: ${b.bond.name} with ${unitDef(units.find((x) => x.uid === b.partner).id).name}. ${b.bond.desc.split(': ').at(-1)}`)

// ── abilities and statuses ───────────────────────────────────────────────────────────────────────

const SHAPE = {
  single: 'one foe',
  ally: 'the most wounded ally',
  self: 'itself',
  row: 'a foe and everyone level with it, in every lane',
  blast: 'a foe and everyone next to it, wherever they stand thickest',
  column: 'a foe and everyone in its lane',
  all: 'every foe',
  all_allies: 'every ally'
}

function effectText (e, st) {
  const est = (power) => Math.round(power * st.atk / TUNING.damage.atkDivisor)
  switch (e.op) {
    case 'damage': return [h('b', null, `${e.power} power`), ` ${ELEMENTS[e.element].name.toLowerCase()} damage `, h('span', { class: 'dim' }, `(≈${est(e.power)} before DEF)`)]
    case 'heal': return [`heals `, h('b', null, `${e.power} power`), h('span', { class: 'dim' }, ` (≈${Math.round(est(e.power) * st.heal.given)} HP)`)]
    case 'apply_status': {
      const s = statusDef(e.status)
      return [e.chance !== undefined ? `${pct(e.chance)} chance of ` : '', h('b', { class: 'status' }, s.name), ` for ${secs(e.dur ?? s.dur)}: ${s.desc.replace(/\.$/, '')}`]
    }
    case 'cleanse': return `removes up to ${e.count} debuffs`
    case 'gauge': return `${e.amount < 0 ? 'drains' : 'adds'} ${Math.abs(e.amount)} gauge (bosses are immune)`
    default: return e.op
  }
}

function reachTag (a) {
  if (a.melee) return h('span', { class: 'tag-melee' }, 'Melee')
  const r = rangeOf(a)
  if (isAllyShape(a.shape) && !Number.isFinite(r)) return null
  return h('span', { class: 'tag-ranged' }, Number.isFinite(r) ? `Range ${r}` : 'Any range')
}

export function abilityBlock (id, st) {
  const a = abilityDef(id)
  return h('div', { class: 'ability' },
    h('div', { class: 'ab-head' },
      h('b', null, a.name),
      h('span', { class: 'chip', style: `--c:${ELEMENTS[a.element].tint}` }, ELEMENTS[a.element].name),
      h('span', { class: 'dim right' }, `${a.castCost} gauge · ${fillTime(st, a.castCost)}`)),
    h('div', { class: 'ab-body' },
      reachTag(a),
      ` Targets ${a.shape === 'all_allies' && Number.isFinite(rangeOf(a)) ? `every ally within ${rangeOf(a)} tiles` : SHAPE[a.shape]}: `,
      a.effects.map((e, i) => [i ? '; ' : '', effectText(e, st)]),
      '.',
      a.cond && h('div', { class: 'dim' }, `Only ${a.cond}.`)))
}

export function statusLine (s) {
  const d = statusDef(s.id)
  return h('div', { class: 'status-line' }, h('b', { class: 'status' }, d.name), s.stacks > 1 ? ` ×${s.stacks}` : '',
    h('span', { class: 'dim' }, ` ${s.dur === 'battle' ? 'all battle' : secs(s.dur)} · ${d.desc}`))
}

// ── elements ─────────────────────────────────────────────────────────────────────────────────────

// What hurts a defender of this element more, or less, than normal.
export function elementLine (id) {
  const taken = ELEMENT_LIST.filter((e) => (e.affinity[id] ?? 1) !== 1).map((e) => ({ e, m: e.affinity[id] }))
  const weak = taken.filter((x) => x.m > 1)
  const resist = taken.filter((x) => x.m < 1)
  const name = (x) => h('span', { style: `color:${x.e.tint}` }, `${x.e.name} ×${x.m}`)
  return h('div', { class: 'dim' },
    h('span', { style: `color:${ELEMENTS[id].tint}` }, ELEMENTS[id].name), ' element.',
    weak.length ? [' Takes ', weak.map((x, i) => [i ? ', ' : '', name(x)]), '.'] : ' No weakness.',
    resist.length ? [' Resists ', resist.map((x, i) => [i ? ', ' : '', name(x)]), '.'] : '')
}

// ── unit card ────────────────────────────────────────────────────────────────────────────────────

// u: a run unit, a battle unit or a scouted foe { id, lvl, slot }. opts.mods: the mods it fights with;
// opts.stats overrides them with live battle stats; opts.statuses lists live statuses; opts.notes adds
// lines at the bottom.
export function unitCard (u, { mods = [], stats = null, statuses = null, notes = [], foe = false } = {}) {
  const d = unitDef(u.id)
  const star = u.star ?? 1
  const st = stats ?? statsOf({ ...u, star }, mods)
  const hp = u.hp ?? null
  const maxHp = Math.round(st.hp)
  const shown = hp === null ? maxHp : Math.round(hp / (u.maxHp || 1) * maxHp)
  const stat = (label, v) => h('div', { class: 'stat' }, h('span', { class: 'dim' }, label), h('b', null, v))
  const next = !foe && u.xp != null && u.lvl < TUNING.xp.cap && baseStats(u.id, u.lvl + 1, star)
  const now = baseStats(u.id, u.lvl, star)
  return h('div', { class: 'card-tip' + (foe ? ' foe' : '') },
    h('div', { class: 'ct-head' },
      h('div', { class: 'ct-port' + (star > 1 ? ` star${star}` : '') }, portrait(u.id, 52, shown <= 0)),
      h('div', null,
        h('div', { class: 'ct-name' }, d.name, star > 1 && h('span', { class: 'stars' }, ' ' + '★'.repeat(star))),
        h('div', { class: 'dim' }, `Level ${u.lvl} · ${KIN[d.kin].name} · ${ROLES[d.role].name}${d.boss ? ' · Boss' : ''}`),
        h('div', { class: 'ct-hp' },
          h('span', { class: 'hpbar' + (shown <= 0 ? ' dead' : shown / maxHp < 0.35 ? ' low' : '') }, h('span', { style: `width:${Math.max(0, Math.min(1, shown / maxHp)) * 100}%` })),
          h('span', null, shown <= 0 ? 'fallen' : `${shown} / ${maxHp} HP`)))),
    h('div', { class: 'stats-grid' },
      stat('ATK', Math.round(st.atk)),
      stat('DEF', Math.round(st.def)),
      stat('SPD', Math.round(st.spd)),
      stat('ACC', Math.round(st.acc)),
      stat('EVA', Math.round(st.eva)),
      stat('CRT', `${Math.round(st.crt)}%`)),
    (st.damage.dealt !== 1 || st.damage.taken !== 1 || st.gauge.rate !== 1) && h('div', { class: 'dim small' },
      [st.damage.dealt !== 1 && `damage dealt ×${st.damage.dealt.toFixed(2)}`, st.damage.taken !== 1 && `damage taken ×${st.damage.taken.toFixed(2)}`, st.gauge.rate !== 1 && `gauge rate ×${st.gauge.rate.toFixed(2)}`].filter(Boolean).join(' · ')),
    h('div', { class: 'ct-sec' }, 'Abilities ', h('span', { class: 'dim' }, '· in priority order')),
    d.abilities.map((id) => abilityBlock(id, st)),
    d.aura && [h('div', { class: 'ct-sec' }, 'Aura ', h('span', { class: 'dim' }, `· within ${d.aura.range} tile${d.aura.range > 1 ? 's' : ''}`)), h('div', { class: 'ability' }, d.aura.desc)],
    statuses?.length > 0 && [h('div', { class: 'ct-sec' }, 'Statuses'), statuses.map(statusLine)],
    h('div', { class: 'ct-foot' },
      elementLine(d.element),
      behaviourLine(d.role),
      h('div', { class: 'dim' }, `${ROLES[d.role].name}s are placed in the ${ROW_NAMES[ROLES[d.role].autoRow]} row by default.`),
      next && h('div', { class: 'dim' }, `XP ${u.xp} / ${xpToNext(u.lvl)}. Next level: +${next.hp - now.hp} HP, +${(next.atk - now.atk).toFixed(1)} ATK.`),
      notes.filter(Boolean).map((n) => h('div', { class: 'note-line' }, n))))
}

function behaviourLine (role) {
  const r = ROLES[role]
  const b = BEHAVIOURS[r.move]
  return h('div', null, h('b', null, b.name), h('span', { class: 'dim' }, ` · ${b.desc} Targets the ${r.target === 'weakest' ? 'foe with the lowest HP%' : 'nearest foe'} in reach.`))
}

// ── threat ───────────────────────────────────────────────────────────────────────────────────────

// Rough fighting power: √(HP × ATK × gauge rate), wounds included. The ratio of the two sides tracks
// the autoplayer's win rate closely: ≤0.6 almost always won, ~1.0 about even, ≥1.2 mostly lost.
function power (u, mods) {
  const s = statsOf({ ...u, star: u.star ?? 1 }, mods)
  const hpFrac = u.maxHp ? u.hp / u.maxHp : 1
  return Math.sqrt(Math.max(0, s.hp * hpFrac) * s.atk * gaugeRate(s))
}

const THREAT = [
  { below: 0.6, label: 'Low', cls: 't-low', text: 'Should be an easy win.' },
  { below: 0.8, label: 'Moderate', cls: 't-mod', text: 'Very likely a win.' },
  { below: 1.0, label: 'High', cls: 't-high', text: 'Usually a win, with losses.' },
  { below: 1.2, label: 'Severe', cls: 't-sev', text: 'Close to a coin flip.' },
  { below: Infinity, label: 'Deadly', cls: 't-dead', text: 'Usually a loss.' }
]

export function threat (run, node) {
  const mine = livingField(run).reduce((n, u) => n + power(u, partyMods(run)), 0)
  const theirs = node.foes.reduce((n, f) => n + power(f, roomFoeMods(run, node)), 0)
  const ratio = mine > 0 ? theirs / mine : Infinity
  return { mine, theirs, ratio, ...THREAT.find((t) => ratio < t.below) }
}

export function threatMeter (run, node) {
  const t = threat(run, node)
  const share = t.theirs / (t.theirs + t.mine || 1)
  return h('div', { class: `threat ${t.cls}` },
    h('div', { class: 'threat-head' }, h('span', { class: 'dim' }, 'Threat '), h('b', null, t.label),
      h('span', { class: 'dim' }, ` · ${t.text}`)),
    h('div', { class: 'threat-bar' }, h('span', { class: 'theirs', style: `width:${share * 100}%` })),
    h('div', { class: 'threat-legend dim' }, h('span', null, `Their power ${Math.round(t.theirs)}`), h('span', null, `Your field ${Math.round(t.mine)}`)))
}

// ── rooms ────────────────────────────────────────────────────────────────────────────────────────

export const ROOM = {
  start: { name: 'Start', text: 'Where this floor begins.' },
  fight: { name: 'Fight', text: 'A battle. Win and reap the soul of one kind of foe you slew.' },
  elite: { name: 'Elite', text: 'A tougher battle, one tier stronger. Win and reap a soul, or claim a relic instead.' },
  reliquary: { name: 'Reliquary', text: 'No battle. Choose 1 of 3 relics: lasting bonuses for the rest of the run.' },
  altar: { name: 'Altar', text: `No battle. Every soul heals to full; the fallen rise at ${pct(TUNING.run.altarRevive)} HP.` },
  boss: { name: 'The Hollow Sovereign', text: 'The final battle. It grows stronger at 60% and 25% HP. Kill it to win the run.' }
}

// A small read-only formation: front row at the bottom, facing the player's grid.
export function miniGrid (foes) {
  const at = new Map(foes.map((f) => [f.slot, f]))
  const rows = []
  for (let r = ROWS - 1; r >= 0; r--) {
    const cells = []
    for (let c = 0; c < COLS; c++) {
      const f = at.get(slotAt(r, c))
      cells.push(h('span', { class: 'mini-cell' + (f ? ' on' : '') }, f && portrait(f.id, 24)))
    }
    rows.push(h('div', { class: 'mini-row' }, cells))
  }
  return h('div', { class: 'mini-grid' }, rows, h('div', { class: 'mini-label dim' }, 'front row ↓'))
}

export function roomTip (run, node, { reachable }) {
  const r = ROOM[node.type]
  const kinds = node.foes && [...new Set(node.foes.map((f) => unitDef(f.id).name))]
  return h('div', { class: 'room-tip' },
    h('div', { class: `rt-head t-${node.type}` }, icon(node.type === 'boss' ? 'boss' : node.type, 22), h('b', null, r.name)),
    h('p', null, r.text),
    node.foes && [
      h('div', { class: 'dim' }, `${node.foes.length} foe${node.foes.length > 1 ? 's' : ''} · level ${node.foes[0].lvl} · ${kinds.join(', ')}`),
      miniGrid(node.foes),
      foeSynergyLine(node.foes),
      threatMeter(run, node)],
    h('div', { class: 'rt-foot ' + (reachable ? 'go' : 'dim') }, reachable ? 'Click to enter.' : node.id === run.state.at ? 'You are here.' : 'Not reachable from here yet. Plan your route.'))
}

export function foeSynergyLine (foes) {
  const active = activeSynergies(foes)
  return h('div', { class: 'dim small' }, active.length ? ['Their synergies: ', active.map((s, i) => [i ? ' · ' : '', h('b', null, s.name)])] : 'They have no synergies.')
}

// ── synergies ────────────────────────────────────────────────────────────────────────────────────

const countsOf = (units) => {
  const c = { kin: {}, role: {} }
  for (const u of units) {
    const d = unitDef(u.id)
    c.kin[d.kin] = (c.kin[d.kin] ?? 0) + 1
    c.role[d.role] = (c.role[d.role] ?? 0) + 1
  }
  return c
}

const needText = (syn, c) => ['kin', 'role'].flatMap((axis) => Object.entries(syn.needs[axis] ?? {}).map(([id, n]) => {
  const name = (axis === 'kin' ? KIN : ROLES)[id].name
  return { name, have: c[axis][id] ?? 0, n, axis, id }
}))

// Active synergies, then the ones you are partway to; each with a tooltip of who counts.
export function synergyTracker (units) {
  const living = units.filter((u) => u.hp > 0)
  const c = countsOf(living)
  const rows = SYNERGIES.map((s) => ({ s, needs: needText(s, c), on: synergyActive(s, c) }))
    .filter((x) => x.on || x.needs.every((n) => n.have > 0))
    .sort((a, b) => b.on - a.on)
  if (!rows.length) return h('p', { class: 'dim' }, 'None yet. Field two or more souls of one kin or role.')
  return h('div', { class: 'syns' }, rows.map(({ s, needs, on }) => h('div', {
    class: 'syn' + (on ? ' on' : ''),
    tip: () => h('div', { class: 'syn-tip' },
      h('b', null, s.name), h('p', null, s.desc),
      needs.map((n) => h('div', null, `${n.name}: ${n.have} / ${n.n} `,
        h('span', { class: 'dim' }, living.filter((u) => unitDef(u.id)[n.axis] === n.id).map((u) => unitDef(u.id).name).join(', ') || 'none fielded'))),
      h('p', { class: 'dim' }, on ? 'Active: every fielded soul gets this bonus.' : 'Inactive. Only fielded, standing souls count.'))
  },
  h('span', { class: 'syn-name' }, s.name),
  h('span', { class: 'syn-prog' }, needs.map((n, i) => [i ? ' + ' : '', `${Math.min(n.have, n.n)}/${n.n}`])))))
}

// Active formation bonds, each with who holds it and with whom.
export function bondTracker (units) {
  const held = activeBonds(units.filter((u) => u.hp > 0))
  const name = (uid) => unitDef(units.find((u) => u.uid === uid).id).name
  if (!held.length) return h('p', { class: 'dim' }, 'None. Souls bond with who stands beside, behind or ahead of them: see How to play (H).')
  return h('div', { class: 'syns' }, held.map((b) => h('div', {
    class: 'syn on',
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, b.bond.name), h('p', null, b.bond.desc),
      h('p', { class: 'dim' }, `Held by ${name(b.uid)}, thanks to ${name(b.partner)}. Bonds are set by the formation when the battle begins.`))
  }, h('span', { class: 'syn-name' }, '◆ ', b.bond.name), h('span', { class: 'syn-prog' }, `${name(b.uid)} · ${name(b.partner)}`))))
}

// ── relics and merges ────────────────────────────────────────────────────────────────────────────

export const relicTip = (id) => {
  const r = relicDef(id)
  return h('div', { class: 'syn-tip' }, h('b', null, r.name), h('p', null, r.desc), h('p', { class: 'dim' }, 'Relics last for the rest of the run.'))
}

// Which copies merge and what comes out.
export function mergeTip (party, { id, star }) {
  const copies = party.filter((u) => u.id === id && u.star === star)
    .sort((a, b) => b.lvl - a.lvl || b.xp - a.xp || a.uid - b.uid)
    .slice(0, TUNING.star.copies)
  const keep = copies[0]
  const before = baseStats(id, keep.lvl, star)
  const after = baseStats(id, keep.lvl, star + 1)
  return h('div', { class: 'syn-tip' },
    h('b', null, `Merge into ${unitDef(id).name} ${'★'.repeat(star + 1)}`),
    h('p', null, `Fuses ${copies.length} ${'★'.repeat(star)} copies (levels ${copies.map((u) => u.lvl).join(', ')}) into one at level ${keep.lvl}, fully healed, where the frontmost copy stood.`),
    h('div', { class: 'merge-cmp' },
      h('span', null, `HP ${before.hp} → `, h('b', null, after.hp)),
      h('span', null, `ATK ${Math.round(before.atk)} → `, h('b', null, Math.round(after.atk)))),
    h('p', { class: 'dim' }, `One body instead of ${copies.length}: stronger per field slot, but it counts once toward synergies. Can't be undone.`))
}

// ── how to play ──────────────────────────────────────────────────────────────────────────────────

export function helpOverlay (onClose) {
  const sec = (title, ...body) => h('section', null, h('h3', null, title), ...body)
  const el = h('div', { class: 'overlay', onclick: (e) => { if (e.target === el) onClose() } },
    h('div', { class: 'modal help', role: 'dialog', 'aria-label': 'How to play' },
      h('button', { class: 'icon-btn close', onclick: onClose, tip: () => 'Close (Esc)' }, icon('close')),
      h('h2', { class: 'modal-title' }, 'How to play'),
      h('p', { class: 'lede' }, 'You are a necromancer. Your souls fight on their own; you win by choosing your route, ',
        'who stands on the field, and where. Hover anything in the game for exact numbers.'),
      h('div', { class: 'help-cols' },
        sec('1 · The route',
          h('p', null, 'Each floor is a map of rooms. You can only move up to a room connected to where you stand. ',
            'Hover any battle room to scout its foes, their formation and the threat they pose.'),
          h('ul', { class: 'room-list' }, ['fight', 'elite', 'reliquary', 'altar', 'boss'].map((t) =>
            h('li', null, h('span', { class: `room-ico t-${t}` }, icon(t, 16)), h('b', null, ROOM[t].name), ' ', ROOM[t].text)))),
        sec('2 · The camp',
          h('p', null, `Up to ${TUNING.party.field} souls stand in your `, h('b', null, 'camp'), `, ${COLS}×${CAMP_ROWS} cells. The rest wait in the `, h('b', null, 'ossuary'),
            ', where they neither fight nor gain XP. Click a soul, then a cell or another soul, to move or swap them.'),
          h('p', null, 'Each floor gives you a different camp. Its ', h('b', null, 'walls'), ' block walking, yours and theirs, but not attacks: bolts fly over them. ',
            `The foes always come from above, over open ground, ${ROWS} rows deep, so the walls decide which way their melee has to walk.`),
          h('p', null, `Units walk one tile at a time (a step costs ${TUNING.board.moveCost} gauge) until a foe is in reach: melee reaches the 8 tiles around, a ranged ability its range in tiles. `,
            'A unit with a foe next to it is ', h('b', null, 'engaged'), ' and cannot walk away. Each role moves its own way:'),
          h('table', { class: 'rows-table' },
            h('tr', null, h('th', null, 'Role'), h('th', null, 'Moves'), h('th', null, 'Targets')),
            ROLE_LIST.map((r) => h('tr', { tip: () => BEHAVIOURS[r.move].desc }, h('td', null, r.name), h('td', null, BEHAVIOURS[r.move].name), h('td', null, r.target === 'weakest' ? 'lowest HP%' : 'nearest')))),
          h('p', { class: 'dim' }, Object.values(BEHAVIOURS).map((b) => [h('b', null, b.name), ': ', b.desc, ' ']))),
        sec('3 · The battle',
          h('p', null, 'Once it begins you cannot act. Each unit fills its gold ', h('b', null, 'gauge'),
            ' by speed and acts when the gauge covers its next ability. It uses the first ability in its list whose condition holds and that has a target in reach, saving gauge for it. With nothing in reach it takes a step instead.'),
          h('p', null, h('b', null, 'Stats: '), 'ATK scales damage and healing. Damage taken is × 100 / (100 + DEF). SPD fills the gauge faster. ',
            `Hit chance is ACC / (ACC + EVA). CRT is the chance of a ×${TUNING.crit.mult} critical hit.`),
          h('p', null, `After ${secs(TUNING.escalation.startTick)} all damage starts ramping up, so no fight stalls. `,
            'Losing a battle ends the run. Space pauses, 1/2/4 change speed, S skips to the result: none of these change the outcome.')),
        sec('4 · Souls',
          h('p', null, 'After a win you reap the soul of one kind of foe you slew. It joins at your retinue\'s median level. ',
            `Fielded survivors share the XP of every foe slain and heal ${pct(TUNING.run.postBattleHeal)} of their HP. The fallen stay down until an altar raises them.`),
          h('p', null, h('b', null, 'Merging: '), `three souls of one kind at the same star fuse into one of the next star: ×${TUNING.star.mult[1]} HP and ATK at ★★, ×${TUNING.star.mult[2]} at ★★★, fully healed. `,
            `You can hold ${TUNING.party.roster} souls; release one to make room.`)),
        sec('5 · Synergies',
          h('p', null, 'Field souls that share a kin or role to unlock bonuses for the whole field.'),
          h('div', { class: 'syn-table' }, SYNERGIES.map((s) => h('div', null, h('b', null, s.name), h('span', { class: 'dim' }, ' ' + s.desc)))),
          h('h3', null, 'Bonds'),
          h('p', null, 'Set by the formation when a battle begins, and kept all battle: a soul bonds with the one beside it in its row, or right behind or ahead of it in its lane. ',
            h('b', null, '◆'), ' marks a bonded soul in prep.'),
          h('div', { class: 'syn-table' }, BONDS.map((b) => h('div', null, h('b', null, b.name), h('span', { class: 'dim' }, ' ' + b.desc)))),
          h('h3', null, 'Auras and area attacks'),
          h('p', null, 'Some souls lend an ', h('b', null, 'aura'), ' to allies near them while they stand, so packing close pays. ',
            'Area attacks punish it: a ', h('b', null, 'blast'), ' hits its target and everyone next to it, and aims wherever its targets stand thickest.')),
        sec('6 · Elements',
          h('p', null, 'Each attack has an element; each unit has one. Matchups multiply damage:'),
          h('div', { class: 'elem-table' }, ELEMENT_LIST.filter((e) => Object.keys(e.affinity).length).map((e) =>
            h('div', null, h('span', { style: `color:${e.tint}` }, e.name), ' → ',
              Object.entries(e.affinity).map(([k, v], i) => [i ? ', ' : '', h('span', { style: `color:${ELEMENTS[k].tint}` }, ELEMENTS[k].name), ` ×${v}`])))),
          h('h3', null, 'Relics'),
          h('div', { class: 'syn-table' }, RELIC_LIST.map((r) => h('div', null, h('b', null, r.name), h('span', { class: 'dim' }, ' ' + r.desc)))))),
      h('p', { class: 'dim center-text' }, 'Press ', h('kbd', null, 'H'), ' anywhere to open this again.')))
  return el
}
