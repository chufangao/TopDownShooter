// Battles built tile by tile, for the tests: units made on board tiles (on), a battle of them (scene), and what the
// tests read of one or do to it (unit, moves, actions, slay, turns).
import { createBattle, playTurns } from '../src/sim/turns.js'
import { makeUnit, slotAt, tileX, tileY, tileAt, DEPTH, ROWS, CAMP_ROWS, footprint, alive, auraOf, unitDistance } from '../src/sim/unit.js'

// A unit placed on a board tile directly (its kind's tiers `tracks`; the piece relics it holds, `relics`).
export const on = (id, uid, side, x, y, lvl = 3, tracks = [0, 0], relics = []) => ({ ...makeUnit(id, { uid, lvl, tracks }), side, tile: tileAt(x, y), relics })

// A battle of units placed on tiles: each deploys where its slot puts it (one of yours off the camp's rows, or a foe
// off its formation's, in a spare slot), then is set on its tile, its turn starting there; the roads run to the
// Monarch where it is set (the camp's rear middle with none). Summons stand where they rose. `opts` go to createBattle.
export function scene (units, opts = {}) {
  const foeRow0 = DEPTH - ROWS
  const spare = [...Array(21).keys()].filter((slot) => !units.some((u) => u.side === 'foe' && tileY(u.tile) >= foeRow0 && slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) === slot))
  const camp = [...Array(49).keys()].filter((slot) => !units.some((u) => u.side === 'party' && tileY(u.tile) < CAMP_ROWS && slotAt(CAMP_ROWS - 1 - tileY(u.tile), tileX(u.tile)) === slot))
  const slot = (u) => u.side === 'party' ? (tileY(u.tile) < CAMP_ROWS ? slotAt(CAMP_ROWS - 1 - tileY(u.tile), tileX(u.tile)) : camp.pop())
    : tileY(u.tile) >= foeRow0 ? slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) : spare.shift()
  const placed = units.map((u) => ({ ...u, slot: slot(u) }))
  const b = createBattle({ party: placed.filter((u) => u.side === 'party'), foes: placed.filter((u) => u.side === 'foe'), ...opts })
  const moved = placed.map((u) => [b.byUid.get(u.uid), u.tile]).filter(([u]) => u)
  for (const [u] of moved) for (const t of footprint(u.tile, u.size)) if ((u.flies ? b.sky : b.at)[t] === u) (u.flies ? b.sky : b.at)[t] = null
  for (const [u, t] of moved) {
    u.tile = u.from = t
    for (const x of footprint(t, u.size)) (u.flies ? b.sky : b.at)[x] = u
  }
  if (b.monarch) b.root = b.monarch.tile
  b.roads = { walk: null, air: null }
  b.cache = new Map()
  return b
}

export const unit = (b, uid) => b.byUid.get(uid)
// The plain reckoning the battle's tile index is held to (field.js foesNextTo, auraGivers), from a list of units: the
// living foes next to `u` (beside it, or over or under it on its tile), and the living allies whose aura reaches it.
export const listFoesNextTo = (units, u) => units.filter((e) => e.side !== u.side && alive(e) && unitDistance(e, u) <= 1)
export const listAuraGivers = (units, u) => units.filter((a) => a !== u && a.side === u.side && alive(a) && auraOf(a) &&
  unitDistance(a, u) <= auraOf(a).range)
export const moves = (events, uid) => events.filter((e) => e.type === 'move' && e.actor === uid)
// Plays `n` turns under basic (End Turn alone), or fewer if the battle ends first; → the events they made.
export function turns (b, n = 1) {
  const from = b.events.length
  playTurns(b, n)
  return b.events.slice(from)
}

// Lays a unit dead where it stands (a corpse for Arise), as a blow would: off the index, every tile of it; the roster
// bumped.
export function slay (b, u) {
  u.hp = 0
  u.statuses = []
  const layer = u.flies ? b.sky : b.at
  for (const t of footprint(u.tile, u.size)) if (layer[t] === u) layer[t] = null
  b.roster++
}
