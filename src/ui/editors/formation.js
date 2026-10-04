// The Formation editor (§4) — drag units into the 3×4 grid, plus auto-fill rules by Role.
//
// Position is a first-class mechanic (§3): melee reaches only the enemy's frontmost occupied row,
// the front row draws ~60% of single-target aggro, and the back row trades melee damage for melee
// protection. "Who goes in front" is therefore a real decision every time you recruit — this is
// where it gets made.
//
// The grid previews placement by running the sim's own `assignFormation` over a copy of the roster.
// That is deliberate and is the opposite of the §18.15 hazard: the alternative is a second
// placement algorithm living in the UI, which would drift from the real one and show the player a
// formation they do not actually get. Reading the sim is fine; deciding is what the renderer must
// not do, and nothing here is written back to the run.

import { el, select } from '../dom.js'
import { assignFormation, COLS, ROWS } from '../../sim/combat/formation.js'

export const meta = {
  id: 'formation',
  title: 'FORMATION',
  lede: 'Melee can only reach the enemy\'s frontmost occupied row, and the front row draws most of ' +
        'the aggro. Drag anyone to pin them to a slot. Everyone unpinned falls to their Role\'s ' +
        'row, which is the rule that places recruits you have not met yet.'
}

export function render ({ store, kernel, tuning, getRun, cap, rerender }) {
  const doctrine = store.draft
  const R = kernel.registry
  const root = el('div')
  const roster = getRun()?.state.roster ?? []
  // Pins and Role rows are separate purchases that share a screen, so each half appears only if it
  // was paid for — and the pin count is a number the player bought rather than a free twelve.
  const maxPins = cap?.slotsFor('formation.pins') ?? 12
  const canPin = maxPins > 0

  root.appendChild(el('h2', { text: meta.title }))
  root.appendChild(el('p', { class: 'lede', text: meta.lede }))

  // What the grid will look like once this draft is applied — computed by the sim, not by the UI.
  const preview = roster.map((u) => ({ ...u }))
  assignFormation(preview, R, doctrine.formation)
  const bySlot = new Map(preview.filter((u) => u.slot >= 0).map((u) => [u.slot, u]))

  const grid = el('div', { class: 'grid' })
  for (let row = 0; row < ROWS; row++) {
    const info = tuning?.rows?.[String(row)] ?? {}
    grid.appendChild(el('div', { class: 'rowlabel' }, [
      el('div', { text: (info.name ?? `row ${row}`).toUpperCase() }),
      el('div', { class: 'why', text: rowNote(info) })
    ]))
    for (let col = 0; col < COLS; col++) grid.appendChild(cell(row * COLS + col))
  }
  root.appendChild(grid)

  const pins = Object.keys(doctrine.formation.pins)
  const asleep = pins.filter((defId) => !roster.some((u) => u.defId === defId)).length

  root.appendChild(el('div', { class: 'strip', style: 'margin-top:12px' }, [
    el('button', {
      class: 'act', text: 'unpin everyone', disabled: pins.length === 0,
      onclick: () => { store.update((d) => { d.formation.pins = {} }); rerender() }
    }),
    el('span', { class: 'why', text: pins.length ? `${pins.length} pinned` : 'nobody pinned — everyone follows their Role' })
  ]))

  // A pin names a unit *def*, so it survives the run that made it and it survives being shared
  // (§19 debt 7). A pin for a species you are not currently fielding is dormant, not broken — the
  // difference is worth a sentence, because the old uid-keyed pins looked identical and were dead.
  if (roster.length === 0) {
    root.appendChild(el('div', { class: 'hint', text: 'No run in progress, so there is nobody to place. Pins and Role rules both apply to every run — a pin waits for the unit it names to turn up.' }))
  } else if (asleep) {
    root.appendChild(el('div', { class: 'hint', text: `${asleep} pin${asleep > 1 ? 's' : ''} name units this party does not hold. They take effect the moment you recruit one.` }))
  }

  if (canPin) {
    root.appendChild(el('div', {
      class: 'hint',
      text: `${Object.keys(doctrine.formation.pins).length} of ${maxPins} pin${maxPins > 1 ? 's' : ''} placed. More are a separate purchase.`
    }))
  }

  // ── the part that outlives the run ────────────────────────────────────────────────────────────
  if (!cap || cap.can('formation.autoRow')) {
  root.appendChild(el('h2', { text: 'BY ROLE', style: 'margin-top:22px' }))
  root.appendChild(el('p', { class: 'lede', text: 'Where a unit goes when nothing pins it — including every recruit you have not met yet. This is the half of the Formation doctrine that survives a wipe.' }))

  for (const role of R.all('role')) {
    const override = doctrine.formation.autoRow[role.id]
    root.appendChild(el('div', { class: 'strip' }, [
      el('span', { style: 'width:12ch', text: role.name }),
      select(
        [{ value: '', label: `default: ${rowName(tuning, role.autoRow ?? 1)}`, title: 'Use the row shipped with the Role.' },
          ...[0, 1, 2].map((r) => ({ value: String(r), label: rowName(tuning, r) }))],
        override === undefined ? '' : String(override),
        (value) => {
          store.update((d) => {
            if (value === '') delete d.formation.autoRow[role.id]
            else d.formation.autoRow[role.id] = Number(value)
          })
          rerender()
        }
      ),
      el('span', { class: 'why', text: role.heals ? 'sustains the party' : '' })
    ]))
  }
  }

  function cell (slot) {
    const unit = bySlot.get(slot)
    const isPinned = unit && doctrine.formation.pins[unit.defId] === slot
    const box = el('div', {
      class: 'slot' + (unit ? ' filled' : '') + (isPinned ? ' pinned' : ''),
      draggable: !!unit,
      title: unit ? `${R.get('unit', unit.defId).name} — drag to move, click to ${isPinned ? 'unpin' : 'pin here'}` : 'empty slot',
      ondragstart: (e) => unit && e.dataTransfer.setData('text/plain', String(unit.uid)),
      ondragover: (e) => { e.preventDefault(); box.classList.add('over') },
      ondragleave: () => box.classList.remove('over'),
      ondrop: (e) => {
        e.preventDefault()
        const uid = Number(e.dataTransfer.getData('text/plain'))
        if (Number.isInteger(uid)) place(uid, slot)
      },
      onclick: () => {
        if (!unit || !canPin) return
        // At the limit, clicking an unpinned unit does nothing rather than silently evicting
        // somebody: which pin to give up is a decision, and it belongs to the player.
        if (!isPinned && Object.keys(doctrine.formation.pins).length >= maxPins) return
        store.update((d) => {
          if (isPinned) delete d.formation.pins[unit.defId]
          else d.formation.pins[unit.defId] = slot
        })
        rerender()
      }
    })

    if (!unit) {
      box.appendChild(el('span', { class: 'why', text: '·' }))
      return box
    }
    const def = R.get('unit', unit.defId)
    box.appendChild(el('div', { class: 'nm', text: def.name }))
    box.appendChild(el('div', { class: 'why', text: `L${unit.lvl} · ${unit.hp}/${unit.maxHp}` }))
    if (isPinned) box.appendChild(el('div', { class: 'pin', text: '📌' }))
    if (unit.hp <= 0) box.classList.add('down')
    return box
  }

  /** Drop A onto B: both get pinned, so the swap is a statement and not a side effect. */
  function place (uid, slot) {
    const moving = preview.find((u) => u.uid === uid)
    if (!moving || moving.slot === slot) return
    const occupant = preview.find((u) => u.slot === slot && u.uid !== uid)
    // Dragging one of two identical units pins the species, so both move as one. Rare, and better
    // than the alternative of a pin that quietly applies to whichever copy sorted first.
    store.update((d) => {
      d.formation.pins[moving.defId] = slot
      if (occupant && occupant.defId !== moving.defId) d.formation.pins[occupant.defId] = moving.slot
    })
    rerender()
  }

  return { root, badges: [] }
}

const rowName = (tuning, row) => tuning?.rows?.[String(row)]?.name ?? ['front', 'mid', 'back'][row] ?? String(row)

function rowNote (info) {
  const bits = []
  if (info.aggro !== undefined) bits.push(`draws ${Math.round(info.aggro * 100)}%`)
  if (info.meleeDealt && info.meleeDealt !== 1) bits.push(`${pct(info.meleeDealt)} melee dealt`)
  if (info.meleeTaken && info.meleeTaken !== 1) bits.push(`${pct(info.meleeTaken)} melee taken`)
  return bits.join(' · ')
}

const pct = (v) => `${v > 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`
