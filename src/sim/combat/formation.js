// The 3×4 formation grid, reach, and ability shapes (§3).
//
//   front row (0)  melee reach · draws ~60% of single-target aggro · +10% melee damage dealt
//   mid   row (1)  reachable by melee only when the front row is empty · neutral
//   back  row (2)  −30% melee damage taken · −25% melee damage dealt · ranged unaffected
//
// Melee abilities reach only the enemy's frontmost occupied row. That single rule is what makes
// "who goes in front" a real decision every time you recruit, and it is most of where the tactical
// depth comes from — for the price of the twenty lines below.
//
// Every row constant comes from tuning.json, so the whole thing is rebalanceable without code.

export const COLS = 4
export const ROWS = 3
export const SLOTS = COLS * ROWS

export const rowOf = (slot) => Math.floor(slot / COLS)
export const colOf = (slot) => slot % COLS
export const slotAt = (row, col) => row * COLS + col

/** `left` covers a unit that walked off the field rather than died — a successful persuade (§2). */
export const alive = (u) => u.hp > 0 && !u.left
export const livingOn = (battle, side) => battle.units.filter((u) => u.side === side && alive(u))

/** The row a melee attacker can reach: the enemy's frontmost row that still has anyone standing. */
export function frontmostRow (battle, side) {
  for (let r = 0; r < ROWS; r++) {
    if (battle.units.some((u) => u.side === side && alive(u) && rowOf(u.slot) === r)) return r
  }
  return -1
}

/** Candidate primary targets for an ability, before its shape is expanded. */
export function reachable (battle, actor, ability) {
  const enemySide = actor.side === 'party' ? 'foe' : 'party'
  const allySide = actor.side

  if (ability.shape === 'self') return [actor]
  if (ability.shape === 'ally' || ability.shape === 'all_allies') return livingOn(battle, allySide)

  const enemies = livingOn(battle, enemySide)
  if (!ability.melee) return enemies
  const front = frontmostRow(battle, enemySide)
  return enemies.filter((u) => rowOf(u.slot) === front)
}

/**
 * Expand a chosen primary target into the full target list. Shapes read directly off the grid,
 * which is why adding `column` or `adjacent` cost nothing beyond these three lines each.
 */
export function expand (battle, actor, ability, primary) {
  const side = primary.side
  const living = livingOn(battle, side)

  switch (ability.shape) {
    case 'self': return [actor]
    case 'single':
    case 'ally': return [primary]
    case 'column': return living.filter((u) => colOf(u.slot) === colOf(primary.slot))
    case 'row': return living.filter((u) => rowOf(u.slot) === rowOf(primary.slot))
    case 'adjacent': {
      const r = rowOf(primary.slot), c = colOf(primary.slot)
      return living.filter((u) => {
        const dr = Math.abs(rowOf(u.slot) - r), dc = Math.abs(colOf(u.slot) - c)
        return dr + dc <= 1
      })
    }
    case 'all':
    case 'all_allies': return living
    case 'slot': return living.filter((u) => u.slot === ability.slot)
    default: return [primary]
  }
}

/** Row damage modifiers (§3), read from tuning. Only melee cares; ranged and magic are unaffected. */
export function rowMods (tuning, slot) {
  return tuning.rows[String(rowOf(slot))] ?? { meleeDealt: 1, meleeTaken: 1, aggro: 1 }
}

/**
 * Place a party in the grid (§4, Formation).
 *
 * Three passes, in this order, and the order is the whole design:
 *
 *   1. **Pins.** Where the player dragged a unit. Nothing outranks a hand placement. A pin names a
 *      unit *def*, not an instance (§19 debt 7) — a uid belongs to a run, so a uid-keyed pin died
 *      with the run that made it and meant nothing in a shared Doctrine. When a party holds two of
 *      the same def, the pin goes to the one with the lowest uid and the other auto-fills; there is
 *      no way to say "the second Frost Sprite" and no reason to want one.
 *   2. **Keep.** Anyone already standing in a legal free slot stays in it.
 *   3. **Auto-fill.** Everyone left — a fresh party, or a recruit that just joined — goes to the
 *      frontmost free slot its Role allows, per the doctrine's override or the Role def's own
 *      `autoRow` (`Vanguard → front, Ranger → back`).
 *
 * Pass 2 is the one that was missing. `addRecruits` re-places the whole roster after every fight,
 * and without it a party is re-derived from scratch each time — so recruiting a Vanguard on floor 3
 * can silently push a Ranger out of the back row it was built for. That is survivable while the
 * formation is generated, and unusable the moment a player is allowed to arrange one, since the
 * grid would quietly undo their work between nodes. A unit that should be re-placed says so by
 * arriving with `slot = -1`.
 *
 * @param {Array} units
 * @param {object} registry
 * @param {{pins?: object, autoRow?: object}} [formation]  the Doctrine's `formation` section
 */
export function assignFormation (units, registry, formation = null) {
  const pins = formation?.pins ?? {}
  const autoRow = formation?.autoRow ?? {}
  const placeable = units.slice(0, SLOTS)
  const taken = new Set()
  const done = new Set()

  const claim = (unit, slot) => { taken.add(slot); unit.slot = slot; done.add(unit) }

  // 1 — pins. A pin onto a slot an earlier pin already claimed falls through to auto-fill rather
  // than throwing: the editor prevents the collision, and a hand-edited import must not brick a run.
  // Lowest uid first, so which of two identical units takes the pin is a fact and not a coincidence
  // of roster order.
  for (const unit of placeable.slice().sort((a, b) => a.uid - b.uid)) {
    const pinned = pins[unit.defId]
    if (!Number.isInteger(pinned) || pinned < 0 || pinned >= SLOTS || taken.has(pinned)) continue
    claim(unit, pinned)
  }

  // 2 — keep. Only for units that already hold a legal slot; a new arrival carries -1 and skips this.
  for (const unit of placeable) {
    if (done.has(unit)) continue
    if (Number.isInteger(unit.slot) && unit.slot >= 0 && unit.slot < SLOTS && !taken.has(unit.slot)) claim(unit, unit.slot)
  }

  // 3 — auto-fill, frontmost free slot in the preferred row, spilling row by row.
  for (const unit of placeable) {
    if (done.has(unit)) continue
    const def = registry.get('unit', unit.defId)
    const role = registry.has('role', def.role) ? registry.get('role', def.role) : null
    const preferred = autoRow[def.role] ?? role?.autoRow ?? 1
    unit.slot = -1
    for (const row of [preferred, ...[0, 1, 2].filter((r) => r !== preferred)]) {
      let placed = false
      for (let c = 0; c < COLS && !placed; c++) {
        const s = slotAt(row, c)
        if (!taken.has(s)) { claim(unit, s); placed = true }
      }
      if (placed) break
    }
  }

  return units
}
