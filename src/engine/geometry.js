// The board on screen: a tile as a point and a point as a tile, the boxes a reach covers, a line of fire, a
// reach's look, and the ground both boards stand on.
import Phaser from '../vendor/phaser.js'
import { holds, ariseOf } from '../sim/turns.js'
import { tileX, tileY, tileAt, LANES, DEPTH, TILES, ROWS, CAMP_ROWS, rangeOf, blowReach, isBlow } from '../sim/unit.js'
import { PARTY, FOE, SOUL, INK, NEUTRAL } from './palette.js'

// ── the board on screen ──────────────────────────────────────────────────────────────────────────

// The board lies on its side to take the screen's width: the DEPTH rows run across, your camp on the right and theirs on
// the left; the LANES lanes run down, lane 1 at the bottom (turned a quarter, never mirrored). Here, and only here, a
// tile becomes a point (posOf: where a unit's feet stand, FOOT below its cell's centre) and a point a tile (tileUnder).
export const TILE_W = 76
export const TILE_H = 68
export const FOOT = 12
export const HALF_W = DEPTH * TILE_W / 2
export const HALF_H = LANES * TILE_H / 2
export const posOf = (tile) => ({ x: ((DEPTH - 1) / 2 - tileY(tile)) * TILE_W, y: ((LANES - 1) / 2 - tileX(tile)) * TILE_H + FOOT })
// Where a piece of `size` anchored at `tile` stands: a 2×2's feet at the middle of its four tiles.
export const posAt = (tile, size = 1) => {
  const p = posOf(tile)
  return size > 1 ? { x: p.x - (size - 1) * TILE_W / 2, y: p.y - (size - 1) * TILE_H / 2 } : p
}
// A 2×2 piece is drawn BIG times larger; a flyer hovers HOVER world px over its shadow, bobbing BOB px.
export const BIG = 1.75
export const HOVER = 26
export const BOB = 3
// A flyer and a ground unit on one tile each ease SHARE.x world px aside (the flyer right and SHARE.up higher) and their
// bars narrow to SHARE.bar, so the two read apart; a 2×2 on the ground stands still.
export const SHARE = { x: 20, up: 6, bar: 0.6, ms: 140 }
// The tile whose cell holds world point (x, y), or off the board the nearest.
export function tileUnder (x, y) {
  const clamp = (v, n) => Math.max(0, Math.min(n - 1, v))
  return tileAt(clamp(Math.round((LANES - 1) / 2 - y / TILE_H), LANES), clamp(Math.round((DEPTH - 1) / 2 - x / TILE_W), DEPTH))
}
// Whether world point w lies past the board's cells (where tileUnder snaps to the nearest).
export const offBoard = (w) => Math.abs(w.x) > HALF_W || Math.abs(w.y) > HALF_H
// The world box of the cells of lanes x0 to x1 and rows y0 to y1 (inclusive, either order), inset by `pad`.
export function cellsBox (x0, x1, y0, y1, pad = 0) {
  return {
    l: ((DEPTH - 1) / 2 - Math.max(y0, y1)) * TILE_W - TILE_W / 2 + pad,
    r: ((DEPTH - 1) / 2 - Math.min(y0, y1)) * TILE_W + TILE_W / 2 - pad,
    t: ((LANES - 1) / 2 - Math.max(x0, x1)) * TILE_H - TILE_H / 2 + pad,
    b: ((LANES - 1) / 2 - Math.min(x0, x1)) * TILE_H + TILE_H / 2 - pad
  }
}
// The world box the camera keeps in view: the board, with room over its top lane for the heads there.
export const BOX = { l: -HALF_W - 8, r: HALF_W + 8, t: -HALF_H - 38, b: HALF_H + 6 }
// Your side faces left, across the board at theirs; theirs faces right (the pictures face right).
export const facesLeft = (side) => side === 'party'

// The camera onto `box` (world) inside `rect` (viewport), as large as it fits, at most `max`: its zoom, and a
// world point with the viewport point it shows at. → { z, wx, wy, sx, sy }
export function fitBox (rect, box, max = 1.35) {
  const z = Math.max(0.25, Math.min(max, (rect.width - 8) / (box.r - box.l), (rect.height - 6) / (box.b - box.t)))
  return { z, wx: (box.l + box.r) / 2, wy: (box.t + box.b) / 2, sx: rect.left + rect.width / 2, sy: rect.top + rect.height / 2 }
}

// The world box a reach or a domain covers: `r` tiles every way round a footprint of `size` at `tile`, clipped.
export function ringBox (tile, r, pad = 0, size = 1) {
  const [x, y] = [tileX(tile), tileY(tile)]
  return cellsBox(Math.max(0, x - r), Math.min(LANES - 1, x + size - 1 + r), Math.max(0, y - r), Math.min(DEPTH - 1, y + size - 1 + r), pad)
}

// A line of fire on `g`: solid from `from` (the shooter) to `to` (the piece that takes the blow), a ring where it lands;
// then, when another was aimed at (`past`), on to it dashed and faint, a small cross there.
export function lineOfFire (g, from, to, past, colour, zoom, alpha = 1) {
  if (!from || !to) return
  const k = 1 / Math.max(0.35, Math.min(1, zoom || 1))
  g.lineStyle(7 * k, INK, 0.7 * alpha).lineBetween(from.x, from.y, to.x, to.y)
  g.lineStyle(3 * k, colour, 0.95 * alpha).lineBetween(from.x, from.y, to.x, to.y)
  g.fillStyle(colour, 0.95 * alpha).fillCircle(from.x, from.y, 3.5 * k)
  g.lineStyle(5.5 * k, INK, 0.7 * alpha).strokeCircle(to.x, to.y, 10 * k)
  g.lineStyle(2.5 * k, colour, alpha).strokeCircle(to.x, to.y, 10 * k)
  if (!past) return
  const len = Math.hypot(past.x - to.x, past.y - to.y)
  if (len < 1) return
  const [ux, uy] = [(past.x - to.x) / len, (past.y - to.y) / len]
  const c = 6 * k
  for (const [w, col, a] of [[4.5 * k, INK, 0.5], [2 * k, colour, 0.5]]) {
    g.lineStyle(w, col, a * alpha)
    for (let d = 14 * k; d < len - 8 * k; d += 14 * k) {
      const e = Math.min(len - 8 * k, d + 7 * k)
      g.lineBetween(to.x + ux * d, to.y + uy * d, to.x + ux * e, to.y + uy * e)
    }
  }
  for (const [w, col, a] of [[5 * k, INK, 0.6], [2.5 * k, colour, 0.7]]) {
    g.lineStyle(w, col, a * alpha).lineBetween(past.x - c, past.y - c, past.x + c, past.y + c).lineBetween(past.x - c, past.y + c, past.x + c, past.y - c)
  }
}

// Dots along `pts` (world points, feet), `step` apart, on the ground (4 px under the feet): a dot of `colour` at `alpha`
// on a dot of ink at `ink`. A walk's, a road's.
export function dottedPath (g, pts, colour, alpha = 1, ink = 0.45, step = 12) {
  for (let i = 1, d = step; i < pts.length; i++) {
    const [v, w] = [pts[i - 1], pts[i]]
    const len = Math.hypot(w.x - v.x, w.y - v.y)
    for (; d < len; d += step) {
      const [x, y] = [v.x + (w.x - v.x) * d / len, v.y + 4 + (w.y - v.y) * d / len]
      g.fillStyle(INK, ink).fillCircle(x, y, 3.8).fillStyle(colour, alpha).fillCircle(x, y, 2.5)
    }
    d -= len
  }
}

// A reach's look: a rounded box round the piece, faintly filled and edged in its act's colour; what a move first adds,
// a dashed line on a grid fixed to the board. Every line stands on a wider stroke of ink (INKED), as the art's outlines.
export const REACH = { pad: 4, round: 12, fill: 0.06, line: 2, alpha: 0.85 }
// A studied foe's reach: its cells' fill and hatch (alpha, width, world px between lines) and its edge's width.
export const STUDY = { fill: 0.1, hatch: 0.3, hatchW: 1.5, step: 14, edge: 2 }
const DASH = { on: 8, period: 14 }
const INKED = { extra: 2.5, alpha: 0.7 }

// Strokes on `g` twice, the ink under the colour: draw(g) strokes the shape with the line style set.
export function inked (g, width, colour, alpha, draw) {
  g.lineStyle(width + INKED.extra, INK, alpha * INKED.alpha)
  draw(g)
  g.lineStyle(width, colour, alpha)
  draw(g)
  return g
}

export function paintReach (g, box, colour) {
  g.fillStyle(colour, REACH.fill).fillRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, REACH.round)
  inked(g, REACH.line, colour, REACH.alpha, (g) => g.strokeRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, REACH.round))
}

// An upright or level dash run on `g` (its line style set) from world point p to q, on the board's dash grid.
function dashes (g, p, q) {
  const flat = p.y === q.y
  const [a, b] = flat ? [Math.min(p.x, q.x), Math.max(p.x, q.x)] : [Math.min(p.y, q.y), Math.max(p.y, q.y)]
  for (let s = Math.floor(a / DASH.period) * DASH.period; s < b; s += DASH.period) {
    const [lo, hi] = [Math.max(a, s), Math.min(b, s + DASH.on)]
    if (hi > lo) flat ? g.lineBetween(lo, p.y, hi, p.y) : g.lineBetween(p.x, lo, p.x, hi)
  }
}

// The cells an act of reach `r` takes in from a piece of `size` on any of `anchors` (its tile and its Move's), a dashed
// line round them on `g`, none inside `inner` (the reach from where the plan stands, drawn solid). On the screen's grid:
// column i from the left (row DEPTH − 1 − i), row j from the top (lane LANES − 1 − j).
export function envelope (g, anchors, r, size, inner) {
  const on = new Uint8Array(TILES)
  for (const t of anchors) {
    const [x, y] = [tileX(t), tileY(t)]
    for (let xx = Math.max(0, x - r); xx <= Math.min(LANES - 1, x + size - 1 + r); xx++) {
      for (let yy = Math.max(0, y - r); yy <= Math.min(DEPTH - 1, y + size - 1 + r); yy++) on[tileAt(xx, yy)] = 1
    }
  }
  const has = (i, j) => i >= 0 && i < DEPTH && j >= 0 && j < LANES && on[tileAt(LANES - 1 - j, DEPTH - 1 - i)] === 1
  const p = REACH.pad
  for (let i = 0; i < DEPTH; i++) {
    for (let j = 0; j < LANES; j++) {
      const [cx, cy] = [(i - (DEPTH - 1) / 2) * TILE_W, (j - (LANES - 1) / 2) * TILE_H]
      if (!has(i, j) || (cx > inner.l && cx < inner.r && cy > inner.t && cy < inner.b)) continue
      for (const [nx, ny] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (has(i + nx, j + ny)) continue
        const [tx, ty] = [ny ? 1 : 0, nx ? 1 : 0]
        const end = (s) => {
          const k = !has(i + s * tx, j + s * ty) ? -p : has(i + s * tx + nx, j + s * ty + ny) ? p : 0
          return { x: cx + nx * (TILE_W / 2 - p) + s * tx * (TILE_W / 2 + k), y: cy + ny * (TILE_H / 2 - p) + s * ty * (TILE_H / 2 + k) }
        }
        dashes(g, end(-1), end(1))
      }
    }
  }
}

// A dashed ellipse on `g` (its line style set), centred at (x, y), `w` by `h`: `n` dashes, each half its share.
export function dashedEllipse (g, x, y, w, h, n = 14) {
  for (let i = 0; i < n; i++) {
    const pts = []
    for (let j = 0; j <= 4; j++) {
      const t = (i + j / 8) / n * 2 * Math.PI
      pts.push({ x: x + Math.cos(t) * w / 2, y: y + Math.sin(t) * h / 2 })
    }
    g.strokePoints(pts)
  }
}

// How far act `a` of `u`'s reaches round its footprint, in tiles, for its box: a blow its reach, an ally act its range
// (Sanctuary's anywhere), Arise its domain. Null for an act on itself or all its side, or one that takes the whole board.
export function actReach (b, u, a) {
  if (a.shape === 'self' || a.shape === 'all_allies') return null
  const r = a.shape === 'corpse' ? ariseOf(b, u)?.domain : isBlow(a) ? blowReach(u, a) : holds(b, u.side, 'sanctuary') ? Infinity : rangeOf(a)
  return r < DEPTH ? r : null
}

// The ground both boards stand on, so one fades into the other: the floor, a vignette, the two daises, a seam, motes.
export function drawGround (scene) {
  scene.add.tileSprite(0, 0, 4200, 3200, 'floor').setTileScale(0.6).setAlpha(0.62).setDepth(-1000)
  const [vw, vh] = [2 * HALF_W + 1100, 2 * HALF_H + 1000]
  scene.add.image(0, 0, 'vignette').setDisplaySize(vw, vh).setDepth(-999)
  for (const [x, y, w, h] of [[0, -vh / 2 - 1500, 9000, 3000], [0, vh / 2 + 1500, 9000, 3000], [-vw / 2 - 2000, 0, 4000, vh], [vw / 2 + 2000, 0, 4000, vh]]) {
    scene.add.rectangle(x, y, w + 2, h + 2, 0x06050a, 0.96).setDepth(-999)
  }
  const g = scene.add.graphics().setDepth(-401)
  for (const [y0, y1, colour] of [[0, CAMP_ROWS - 1, PARTY], [DEPTH - ROWS, DEPTH - 1, FOE]]) {
    const b = cellsBox(0, LANES - 1, y0, y1, -10)
    g.fillStyle(colour, 0.045).fillRoundedRect(b.l, b.t, b.r - b.l, b.b - b.t, 18)
    g.lineStyle(1, colour, 0.22).strokeRoundedRect(b.l, b.t, b.r - b.l, b.b - b.t, 18)
  }
  const seam = ((DEPTH - 1) / 2 - (CAMP_ROWS + DEPTH - ROWS - 1) / 2) * TILE_W
  scene.add.image(seam, 0, 'glow').setDisplaySize(26, 2 * HALF_H + 200).setTint(NEUTRAL).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(-390)
  scene.add.particles(0, 0, 'glow', {
    x: { min: -HALF_W - 60, max: HALF_W + 60 }, y: { min: -HALF_H - 40, max: HALF_H + 40 }, lifespan: 7000,
    speedY: { min: -14, max: -4 }, speedX: { min: -6, max: 6 }, scale: { start: 0.14, end: 0 }, alpha: { start: 0.45, end: 0 },
    tint: [SOUL, NEUTRAL], frequency: 160, blendMode: 'ADD'
  }).setDepth(-300)
}
