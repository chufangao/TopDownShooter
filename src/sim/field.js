// The board inside a battle (turns.js): the roads the foes keep to, and the tile index every reach is read from. Pure
// reads of a battle's `at`, `sky`, `walls`, `root` and `monarch`; nothing here changes a battle but the roads it makes
// the first time they are read.
import {
  steps, tileX, tileY, tileAt, distance, distanceBetween, unitDistance, footprint, deployTile, slotAt, enemySide, monarchSlot, wallTiles,
  TILES, LANES, DEPTH, ROWS, CENTRE_OUT, CAMP_ROWS, NEIGHBOURS
} from './unit.js'

// Each lane's place in CENTRE_OUT: the centre first.
export const LANE = CENTRE_OUT.reduce((rank, x, i) => { rank[x] = i; return rank }, [])

// ── roads ────────────────────────────────────────────────────────────────────────────────────────

// The order arrows break ties in, from `root` (DESIGN §2.4): the tile nearest the root's lane, then the one nearest
// its row (straight ahead), then the lane nearer the centre (CENTRE_OUT). Lower first.
const arrowKey = (root, n) => Math.abs(tileX(n) - tileX(root)) * 1e4 + Math.abs(tileY(n) - tileY(root)) * 100 + LANE[tileX(n)]

// The roads (DESIGN §2.4): a flood from `root` (the Monarch's tile) out through every tile no wall stands on, steps
// as unit.js steps them, giving each tile its road distance (the steps to the root; Infinity where no road reaches)
// and its arrow: the neighbouring tile with the lowest distance (−1 at the root and where no road reaches), ties in a
// fixed order (arrowKey), so two foes on one tile always walk the same way. Every arrow points strictly closer to the
// root. With no walls at all it is the air road (airOf), every tile's distance its Chebyshev distance to the root.
// Pure: the board draws it in prep as a battle walks it (fieldOf). → { root, dist, arrow }, each list by tile.
export function field ({ root, walls = [] }) {
  const closed = new Set(walls)
  closed.delete(root)
  const dist = new Array(TILES).fill(Infinity)
  const arrow = new Array(TILES).fill(-1)
  dist[root] = 0
  const queue = [root]
  for (let i = 0; i < queue.length; i++) {
    for (const n of steps(queue[i], closed)) {
      if (dist[n] === Infinity) { dist[n] = dist[queue[i]] + 1; queue.push(n) }
    }
  }
  for (const t of queue) {
    let best = -1
    for (const n of steps(t, closed)) if (dist[n] === dist[t] - 1 && (best < 0 || arrowKey(root, n) < arrowKey(root, best))) best = n
    arrow[t] = best
  }
  return { root, dist, arrow }
}

// A battle's road, the Walk field, made when first read: every ground foe's, its root the Monarch, which never moves.
// Your pieces are no wall to it: one standing on a foe's road holds it there (turns.js roadAhead); no foe routes round
// them.
export const fieldOf = (battle) => (battle.roads.walk ??= field({ root: battle.root, walls: battle.walls }))

// A battle's air road (DESIGN §2.4 Fly), made when first read: the road flooded from the Monarch's tile over every
// tile, walls and all (a flyer flies over them, and may hover over one). Your pieces are no wall to it either.
export const airOf = (battle) => (battle.roads.air ??= field({ root: battle.root, walls: [] }))

// The road a foe walks: a flyer's the air road (airOf), any other's the Walk field (fieldOf).
export const roadOf = (battle, u) => (u.flies ? airOf(battle) : fieldOf(battle))

// The tile a foe's road takes it to next; −1 where none does (the root, or a tile no road reaches).
export const arrowOf = (battle, u) => roadOf(battle, u).arrow[u.tile]

// How far a foe's road still runs to the Monarch, along the road it walks: its progress (redesign.md §2.6).
export const roadLeft = (battle, x) => roadOf(battle, x).dist[x.tile]

// A camp's roads to the Monarch on its seat, as a battle there makes them (fieldOf, airOf), with no battle: `field` the
// ground foes', round the camp's walls, and `air` the flyers', over every tile. Made once per camp (run.js frontier,
// autoplay.js gateOf).
const campRoads = new Map()
export function roadsTo (camp) {
  if (!campRoads.has(camp)) {
    const root = deployTile('party', monarchSlot(camp))
    campRoads.set(camp, { field: field({ root, walls: wallTiles(camp) }), air: field({ root, walls: [] }) })
  }
  return campRoads.get(camp)
}

// ── the tile index ───────────────────────────────────────────────────────────────────────────────

// Who stands where, answered from the index (battle.at, the ground, and battle.sky, the air: both are read) at the
// cost of a few tiles instead of every unit on the board (test/scene.js holds it to a filter over the units). Lists
// come back in the order the units act (u.ord), as a filter over battle.units would give them, so effects happen in
// the same order. Every reach is measured from a footprint (DESIGN §2.3): `tile` its anchor and
// `size` its side; the tiles within r of it are a square r wider on every side, and a 2×2 piece found on several of
// them is listed once.

// Where a unit stands in the index: a flyer in the air, anyone else on the ground.
export const layerOf = (battle, u) => (u.flies ? battle.sky : battle.at)

// The living units on `side` within `r` tiles of a footprint, in acting order; a flyer only within `air` tiles
// (a melee blow's −1: none).
// (The window clipped to the board, and each unit inserted in acting order as it is found, once: the same list
// as filtering every tile in reach and sorting it, with no sort to call.)
export function around (battle, tile, r, side, size = 1, air = r) {
  const out = []
  const x0 = tileX(tile)
  const y0 = tileY(tile)
  const xa = Math.max(0, x0 - r)
  const xb = Math.min(LANES - 1, x0 + size - 1 + r)
  const yb = Math.min(DEPTH - 1, y0 + size - 1 + r)
  for (let y = Math.max(0, y0 - r); y <= yb; y++) {
    for (let x = xa, t = y * LANES + xa; x <= xb; x++, t++) {
      for (let k = 0; k < 2; k++) {
        const u = k ? battle.sky[t] : battle.at[t]
        if (u === null || u.side !== side || (u.flies && air < r && distanceBetween(u.tile, u.size, tile, size) > air)) continue
        let i = out.length
        while (i > 0 && out[i - 1].ord > u.ord) i--
        if (i > 0 && out[i - 1] === u) continue
        for (let j = out.length; j > i; j--) out[j] = out[j - 1]
        out[i] = u
      }
    }
  }
  return out
}

// The living foes next to a unit (on a tile beside it, or over or under it on its own).
export const foesNextTo = (battle, u) => around(battle, u.tile, 1, enemySide(u.side), u.size)

// Whether a foe of `u`'s stands next to it: the position its `pos` mods read ('engaged' with one, 'free' without).
export function pressed (battle, u) {
  if (u.size > 1) return foesNextTo(battle, u).length > 0
  const other = u.flies ? battle.at[u.tile] : battle.sky[u.tile]
  if (other !== null && other.side !== u.side) return true
  const next = NEIGHBOURS[u.tile]
  for (let i = 0; i < next.length; i++) {
    const x = battle.at[next[i]]
    if (x !== null && x.side !== u.side) return true
    const f = battle.sky[next[i]]
    if (f !== null && f.side !== u.side) return true
  }
  return false
}

// The living allies whose aura reaches this unit (from the giver's footprint to its).
export const auraGivers = (battle, u) => battle.auraReach
  ? around(battle, u.tile, battle.auraReach, u.side, u.size).filter((a) => a !== u && a.aura && unitDistance(a, u) <= a.aura.range)
  : []

// Whether a piece of `size` may stand anchored at `tile`: its whole footprint on the board, with no one on it in its
// layer: on open ground, or for a flyer (`flies`) in the air, over anyone on the ground or a wall.
export function free (battle, tile, size = 1, flies = false) {
  const layer = flies ? battle.sky : battle.at
  const open = (t) => layer[t] === null && (flies || !battle.walls.has(t))
  if (size === 1) return open(tile)
  const tiles = footprint(tile, size)
  return tiles !== null && tiles.every(open)
}

// Where a shadow of yours of `size` rises (DESIGN §2.5): never where it fell, so the enemy's dead never block its
// roads, but anchored where its footprint is free (free; in the air for a flyer's, `flies`: over the Monarch itself,
// if that is free) closest to the Monarch (with none, to the tile the roads run to); ties to the footprint nearest
// `from`, where it fell, then lane order (CENTRE_OUT), then the lower tile. −1 when no footprint on the board is
// free.
export function riseTile (battle, from, size = 1, flies = false) {
  const to = battle.monarch?.tile ?? battle.root
  let best = -1
  let bestK = null
  for (let t = 0; t < TILES; t++) {
    if (!free(battle, t, size, flies)) continue
    // Scanned in tile order, so a tie on all three keeps the lower tile.
    const k = [distanceBetween(t, size, to, 1), distanceBetween(t, size, from, 1), LANE[tileX(t)]]
    if (bestK === null || (k[0] - bestK[0] || k[1] - bestK[1] || k[2] - bestK[2]) < 0) {
      best = t
      bestK = k
    }
  }
  return best
}

// Where a summon of `u` (of `size`, a flyer's when `flies`) rises: anchored where its whole footprint lies on the camp
// (its rows, y below CAMP_ROWS), on no wall and not on the Monarch's seat, free in its layer (free: open ground, or
// the air for a flyer's), nearest the summoner's footprint (Chebyshev); ties as riseTile's: nearest the Monarch (with
// none, the tile the roads run to), then lane order (CENTRE_OUT), then the lower tile. −1 when no such footprint is
// free.
export function summonTile (battle, u, size, flies) {
  const to = battle.monarch?.tile ?? battle.root
  const seat = battle.monarch?.tile ?? -1
  let best = -1
  let bestK = null
  for (let t = 0; t < TILES; t++) {
    const tiles = footprint(t, size)
    if (!tiles || tiles.some((x) => tileY(x) >= CAMP_ROWS || x === seat || battle.walls.has(x)) || !free(battle, t, size, flies)) continue
    const k = [distanceBetween(t, size, u.tile, u.size), distanceBetween(t, size, to, 1), LANE[tileX(t)]]
    if (bestK === null || (k[0] - bestK[0] || k[1] - bestK[1] || k[2] - bestK[2]) < 0) {
      best = t
      bestK = k
    }
  }
  return best
}

// Where a foe enters: the open tile of the foes' rows nearest the top edge in its `lane` (the middle one by default),
// in the air for a flyer (over anyone on the ground, or a wall), ties going to tiles ahead of it (down the board),
// then level with it, then the nearest lane, then the lower tile; −1 while the foes' rows are full (it waits in the
// reserve: foes come from the top edge, never out of the gap row or your camp, past the pieces you placed).
export function entryTile (battle, lane = CENTRE_OUT[0], flies = false) {
  const from = deployTile('foe', slotAt(ROWS - 1, lane))
  const layer = flies ? battle.sky : battle.at
  let best = -1
  let bestK = Infinity
  for (let t = tileAt(0, DEPTH - ROWS); t < TILES; t++) {
    if (layer[t] !== null || (!flies && battle.walls.has(t))) continue
    const dy = tileY(from) - tileY(t)
    const k = distance(t, from) * 1e4 + (dy > 0 ? 0 : dy === 0 ? 1 : 2) * 1e3 + Math.abs(tileX(t) - tileX(from)) * 100 + t / TILES
    if (k < bestK) { best = t; bestK = k }
  }
  return best
}
