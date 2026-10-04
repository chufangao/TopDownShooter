// Floor generation (§6) — pure JS, returns a plain data structure.
//
//   { w, h, tiles: Uint8Array, rooms, nodes, entry, exit }
//
// The leader walks this by tweening between tile centres. There is no physics and no collision
// system: walkability is a lookup in the tile array, which is the whole reason the dungeon costs
// almost nothing to build or to test.
//
// Everything here is seeded (§11.7). Same seed and floor → same floor, on any machine, in the
// renderer or in a headless Worker.

import { makeRng } from './kernel/rng.js'

/** Tile ids double as indices into the baked tileset strip (§15.4), so the renderer needs no map. */
export const TILE = { VOID: 0, FLOOR: 1, FLOOR_ALT: 2, WALL: 3, DOOR: 4, STAIRS: 5, NODE: 6 }
const WALKABLE = new Set([TILE.FLOOR, TILE.FLOOR_ALT, TILE.DOOR, TILE.STAIRS, TILE.NODE])

/** Node types (§6). `weight` is the per-floor draw; fixed counts are placed first. */
export const NODE_TYPES = [
  { type: 'encounter', weight: 52 },
  { type: 'treasure', weight: 16 },
  { type: 'shrine', weight: 10 },
  { type: 'elite', weight: 9 },
  { type: 'rare', weight: 5 },
  { type: 'secret', weight: 4 },
  { type: 'merchant', weight: 2 },
  { type: 'campfire', weight: 6 }
]

const DEFAULTS = {
  w: 56,
  h: 42,
  roomAttempts: 220,
  maxRooms: 11,
  roomMin: [5, 4],
  roomMax: [11, 8],
  nodes: [14, 22],
  extraLoops: 2,
  nodeSpacing: 4
}

export const idx = (d, x, y) => y * d.w + x
export const tileAt = (d, x, y) => (x < 0 || y < 0 || x >= d.w || y >= d.h ? TILE.VOID : d.tiles[idx(d, x, y)])
export const walkable = (d, x, y) => WALKABLE.has(tileAt(d, x, y))

function carveRect (d, x0, y0, w, h, value) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) d.tiles[idx(d, x, y)] = value
}

/** L-shaped corridor. The elbow side is a coin flip so floors do not all bend the same way. */
function carveCorridor (d, a, b, rng) {
  const horizontalFirst = rng.chance(0.5)
  const stepX = (y) => {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
      if (d.tiles[idx(d, x, y)] === TILE.VOID) d.tiles[idx(d, x, y)] = TILE.FLOOR
    }
  }
  const stepY = (x) => {
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
      if (d.tiles[idx(d, x, y)] === TILE.VOID) d.tiles[idx(d, x, y)] = TILE.FLOOR
    }
  }
  if (horizontalFirst) { stepX(a.y); stepY(b.x) } else { stepY(a.x); stepX(b.y) }
}

const centre = (r) => ({ x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) })
const overlaps = (a, b) =>
  a.x - 1 < b.x + b.w + 1 && a.x + a.w + 1 > b.x - 1 && a.y - 1 < b.y + b.h + 1 && a.y + a.h + 1 > b.y - 1

/**
 * Breadth-first path over walkable tiles. Used by the reachability guarantee below and by the
 * renderer to walk the leader — one function, so a floor the scene can walk is exactly a floor the
 * generator proved walkable.
 * @returns {Array<{x,y}>|null} inclusive of both ends, or null if unreachable
 */
export function findPath (d, from, to) {
  if (!walkable(d, to.x, to.y)) return null
  const prev = new Int32Array(d.w * d.h).fill(-1)
  const start = idx(d, from.x, from.y)
  const goal = idx(d, to.x, to.y)
  prev[start] = start
  const queue = [start]
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    if (cur === goal) break
    const cx = cur % d.w, cy = (cur - (cur % d.w)) / d.w
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy
      if (!walkable(d, nx, ny)) continue
      const n = idx(d, nx, ny)
      if (prev[n] !== -1) continue
      prev[n] = cur
      queue.push(n)
    }
  }
  if (prev[goal] === -1) return null
  const path = []
  for (let cur = goal; cur !== start; cur = prev[cur]) path.push({ x: cur % d.w, y: (cur - (cur % d.w)) / d.w })
  path.push({ x: from.x, y: from.y })
  return path.reverse()
}

/**
 * @param {object} opts
 * @param {number|string} opts.seed  run seed
 * @param {number} [opts.floor]      1-based; deeper floors are larger and denser
 * @param {boolean} [opts.boss]      place a boss node on the exit
 * @returns {object} the floor
 */
export function generateFloor ({ seed, floor = 1, boss = false, ...over } = {}) {
  const cfg = { ...DEFAULTS, ...over }
  // One stream per floor: generating floor 3 must not depend on how much randomness floor 2 used.
  const rng = makeRng(seed).stream(`dungeon:${floor}`)

  const d = {
    floor,
    w: cfg.w,
    h: cfg.h,
    tiles: new Uint8Array(cfg.w * cfg.h),
    rooms: [],
    nodes: [],
    entry: { x: 1, y: 1 },
    exit: { x: 1, y: 1 }
  }

  // ── rooms ──────────────────────────────────────────────────────────────────────────────────
  for (let i = 0; i < cfg.roomAttempts && d.rooms.length < cfg.maxRooms; i++) {
    const w = cfg.roomMin[0] + rng.int(cfg.roomMax[0] - cfg.roomMin[0] + 1)
    const h = cfg.roomMin[1] + rng.int(cfg.roomMax[1] - cfg.roomMin[1] + 1)
    const room = { x: 2 + rng.int(cfg.w - w - 4), y: 2 + rng.int(cfg.h - h - 4), w, h }
    if (d.rooms.some((r) => overlaps(room, r))) continue
    d.rooms.push(room)
    carveRect(d, room.x, room.y, room.w, room.h, TILE.FLOOR)
  }

  // ── corridors: a spanning chain plus a couple of loops, so floors are not pure trees ────────
  const ordered = d.rooms.map((r, i) => ({ i, c: centre(r) })).sort((a, b) => a.c.x - b.c.x || a.c.y - b.c.y)
  for (let i = 1; i < ordered.length; i++) carveCorridor(d, ordered[i - 1].c, ordered[i].c, rng)
  for (let i = 0; i < cfg.extraLoops && ordered.length > 3; i++) {
    const a = ordered[rng.int(ordered.length)], b = ordered[rng.int(ordered.length)]
    if (a.i !== b.i) carveCorridor(d, a.c, b.c, rng)
  }

  // ── entry and exit at opposite ends of the chain ────────────────────────────────────────────
  d.entry = { ...ordered[0].c }
  d.exit = { ...ordered[ordered.length - 1].c }
  d.tiles[idx(d, d.entry.x, d.entry.y)] = TILE.DOOR
  d.tiles[idx(d, d.exit.x, d.exit.y)] = TILE.STAIRS

  // ── floor variation, then walls around everything walkable ──────────────────────────────────
  for (let i = 0; i < d.tiles.length; i++) {
    if (d.tiles[i] === TILE.FLOOR && rng.chance(0.14)) d.tiles[i] = TILE.FLOOR_ALT
  }
  const walls = []
  for (let y = 0; y < d.h; y++) {
    for (let x = 0; x < d.w; x++) {
      if (d.tiles[idx(d, x, y)] !== TILE.VOID) continue
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (WALKABLE.has(tileAt(d, x + dx, y + dy))) { walls.push(idx(d, x, y)); dy = 2; break }
        }
      }
    }
  }
  for (const i of walls) d.tiles[i] = TILE.WALL

  // ── nodes ───────────────────────────────────────────────────────────────────────────────────
  const wanted = cfg.nodes[0] + rng.int(cfg.nodes[1] - cfg.nodes[0] + 1) + Math.min(4, floor - 1)
  const candidates = []
  for (const room of d.rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (walkable(d, x, y)) candidates.push({ x, y })
      }
    }
  }
  const far = (p, q, dist) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) >= dist
  const taken = [d.entry, d.exit]
  const weights = NODE_TYPES.map((n) => n.weight)

  for (const spot of rng.shuffle(candidates)) {
    if (d.nodes.length >= wanted) break
    if (!taken.every((t) => far(spot, t, cfg.nodeSpacing))) continue
    taken.push(spot)
    const type = rng.weighted(NODE_TYPES, weights).type
    d.nodes.push({ x: spot.x, y: spot.y, type, payload: { floor, tier: Math.min(5, 1 + Math.floor(floor / 2)) } })
    d.tiles[idx(d, spot.x, spot.y)] = TILE.NODE
  }

  if (boss) d.nodes.push({ x: d.exit.x, y: d.exit.y, type: 'boss', payload: { floor } })

  // ── the guarantee: every node and the exit are reachable from the entry (§10, M0) ────────────
  d.reachable = findPath(d, d.entry, d.exit) !== null &&
    d.nodes.every((n) => findPath(d, d.entry, n) !== null)

  return d
}

/**
 * Visit order, low first. Not quite "risk": it is the order a sensible run takes a floor in.
 *
 * A floor that opens on a five-body elite ends the run before it starts, so the cheap nodes go
 * first and the dangerous ones last. Campfires sit *after* ordinary encounters on purpose — taken
 * first they heal a party that is still at full health and are gone when it matters.
 */
export const DEFAULT_ROUTE_ORDER = {
  treasure: 0, shrine: 0, merchant: 0, secret: 0,
  encounter: 1,
  campfire: 2,
  rare: 3, elite: 4, boss: 5
}

/**
 * The order the leader visits things: safest tier first, nearest within a tier, then the exit.
 *
 * The player never inputs anything (§1), so the route is already a policy — this is the Route /
 * Risk editor of §4, and both of its decisions are arguments here rather than constants:
 *
 *   `risk`     the order node types are worth walking to, low first
 *   `skip`     types not worth walking to at all
 *   `maxNodes` when to stop and take the stairs
 *
 * Descending early is expressed by *shortening the route* rather than by a flag the run loop has to
 * check, so nothing downstream — the headless loop, the walking scene, the tests — learns a second
 * way for a floor to end.
 *
 * @param {object} [opts]
 * @param {object} [opts.risk]      node type → visit rank, low first
 * @param {string[]} [opts.skip]    node types to walk past entirely
 * @param {number|null} [opts.maxNodes]  stop after this many nodes and head for the exit
 */
export function routeThrough (d, from = d.entry, { risk = DEFAULT_ROUTE_ORDER, skip = [], maxNodes = null } = {}) {
  const avoid = new Set(skip)
  // Skipping is a filter on the node list rather than a rank of Infinity: a rank would still walk
  // to the node last, which is the opposite of what "avoid elites" means.
  const remaining = d.nodes.filter((n) => !avoid.has(n.type)).map((n) => ({ x: n.x, y: n.y, type: n.type }))
  const cap = Number.isInteger(maxNodes) && maxNodes >= 0 ? maxNodes : Infinity
  const legs = []
  let cur = from

  while (remaining.length && legs.length < cap) {
    let best = -1
    let bestPath = null
    let bestRisk = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const path = findPath(d, cur, remaining[i])
      if (!path) continue
      const r = risk[remaining[i].type] ?? 2
      if (r > bestRisk) continue
      if (r < bestRisk || path.length < bestPath.length) { best = i; bestPath = path; bestRisk = r }
    }
    if (best === -1) break
    legs.push({ to: remaining[best], path: bestPath })
    cur = remaining[best]
    remaining.splice(best, 1)
  }

  const out = findPath(d, cur, d.exit)
  if (out) legs.push({ to: { ...d.exit, type: 'exit' }, path: out })
  return legs
}
