// Battles built tile by tile, for the tests: units made on board tiles (on, stackOn), a battle of them (scene), and
// what the tests read of one or do to it (unit, moves, actions, slay).
import { createBattle } from '../src/sim/battle.js'
import { makeUnit, slotAt, tileAt, tileX, tileY, DEPTH, ROWS, footprint } from '../src/sim/unit.js'

// A unit placed on a board tile directly (its kind's tiers `tracks`), and a stack of `count` so placed.
export const on = (id, uid, side, x, y, lvl = 3, tracks = [0, 0]) => ({ ...makeUnit(id, { uid, lvl, tracks }), side, tile: tileAt(x, y) })
export const stackOn = (id, uid, side, x, y, count, lvl = 3) => ({ ...makeUnit(id, { uid, lvl, count }), side, tile: tileAt(x, y) })

// A battle of units placed on tiles: the party in its camp (y 0–6), a foe anywhere (it deploys in a spare slot of its
// formation and is moved there). The ones not named in `moving` never step (all of them do with `moving: true`), so a
// scene stays put; summons stand where they appear. `opts` go to createBattle, its seed 'scene' unless they name one.
export function scene (units, { moving = [], ...opts } = {}) {
  const foeRow0 = DEPTH - ROWS
  const spare = [...Array(21).keys()].filter((slot) => !units.some((u) => u.side === 'foe' && tileY(u.tile) >= foeRow0 && slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) === slot))
  const slot = (u) => u.side === 'party' ? slotAt(6 - tileY(u.tile), tileX(u.tile))
    : tileY(u.tile) >= foeRow0 ? slotAt(tileY(u.tile) - foeRow0, tileX(u.tile)) : spare.shift()
  const placed = units.map((u) => ({ ...u, slot: slot(u) }))
  const b = createBattle({ party: placed.filter((u) => u.side === 'party'), foes: placed.filter((u) => u.side === 'foe'), seed: 'scene', ...opts })
  for (const u of b.units) {
    const want = units.find((x) => x.uid === u.uid)?.tile
    if (want === undefined) continue
    if (u.tile !== want) {
      const layer = u.flies ? b.sky : b.at
      layer[u.tile] = null
      u.tile = want
      layer[want] = u
    }
    if (moving !== true && !moving.includes(u.uid)) u.nextStep = Infinity
  }
  return b
}

export const unit = (b, uid) => b.units.find((u) => u.uid === uid)
export const moves = (events, uid) => events.filter((e) => e.type === 'move' && e.actor === uid)
export const actions = (events, uid) => events.filter((e) => e.type === 'action' && e.actor === uid)

// Lays a unit dead where it stands (a corpse for Arise), as a blow would: off the index, every tile of it; the roster
// bumped; one of yours, your sight too.
export function slay (b, u) {
  u.hp = 0
  u.statuses = []
  const layer = u.flies ? b.sky : b.at
  for (const t of footprint(u.tile, u.size)) if (layer[t] === u) layer[t] = null
  b.roster++
  if (u.side === 'party') b.ours++
}
