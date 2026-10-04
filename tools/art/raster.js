// The rasteriser (§15.1) — descriptors in, RGBA frames out.
//
//   walk the joint tree → transform each part by its clip track at frame f → z-sort → draw into
//   an RGBA buffer → quantise to the palette → add a 1px dark outline
//
// That outline step is most of what makes procedural sprites read as deliberate rather than as
// programmer art, which is why it is not optional.
//
// 6 clips × ~6 frames = ~36 frames per unit, generated in milliseconds. Per-unit art cost is one
// ~40-line descriptor, not 24 drawn frames — that is what makes a 120-unit roster affordable.
//
// Pure JS: no Node APIs, no DOM. Only the PNG *writer* touches node:zlib, so this same module can
// bake a user pack in the browser straight to a canvas (§15.3).
//
// Randomness comes from the descriptor's seed through the kernel RNG (§11.7), never Math.random —
// for exactly the reason baked art must be byte-reproducible (§15.2, invariant §18.2).

import { makeRng } from '../../src/sim/kernel/rng.js'

/** Bump to rebake everything on purpose. Part of the art hash (§15.2). */
export const GENERATOR_VERSION = 1

/** The six animation sets every unit has, and nothing else (§7). */
export const CLIP_KEYS = ['idle', 'walk', 'attack', 'cast', 'hurt', 'faint']

const DEG = Math.PI / 180

// ── colour ──────────────────────────────────────────────────────────────────────────────────────

function parseHex (hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255]
}

/**
 * `fill` is "ramp.2" or "accent.0" — a slot into one of the descriptor's two ramps, never a raw
 * colour. That indirection is what makes a full-roster recolour mod a dozen patch ops (§15.5).
 */
function resolveFill (fill, ramps) {
  const [which, idx] = String(fill ?? 'ramp.2').split('.')
  const ramp = ramps[which] ?? ramps.ramp
  const i = Math.min(ramp.length - 1, Math.max(0, Number(idx) || 0))
  return parseHex(ramp[i])
}

// ── canvas ──────────────────────────────────────────────────────────────────────────────────────

const makeCanvas = (w, h) => ({ w, h, px: new Uint8ClampedArray(w * h * 4) })

function put (c, x, y, rgba) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return
  const i = (y * c.w + x) * 4
  c.px[i] = rgba[0]; c.px[i + 1] = rgba[1]; c.px[i + 2] = rgba[2]; c.px[i + 3] = 255
}

const alphaAt = (c, x, y) =>
  (x < 0 || y < 0 || x >= c.w || y >= c.h) ? 0 : c.px[(y * c.w + x) * 4 + 3]

/** 1px dark outline on the outside of the silhouette. */
function outline (c, colour) {
  const edges = []
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      if (alphaAt(c, x, y) !== 0) continue
      if (alphaAt(c, x - 1, y) || alphaAt(c, x + 1, y) || alphaAt(c, x, y - 1) || alphaAt(c, x, y + 1)) {
        edges.push(x, y)
      }
    }
  }
  for (let i = 0; i < edges.length; i += 2) put(c, edges[i], edges[i + 1], colour)
}

// ── transforms ──────────────────────────────────────────────────────────────────────────────────

const track = (clip, joint, channel, f, dflt) => {
  const arr = clip.tracks?.[joint]?.[channel]
  if (!arr || arr.length === 0) return dflt
  return arr[f % arr.length]
}

/** World transform of every joint at frame f. Parent-first, so one pass in declaration order. */
function poseOf (rig, clip, f) {
  const pose = {}
  const order = Object.keys(rig.joints)
  // Resolve parents first — rigs are small, so a fixed-point loop is simpler than a topo sort.
  let remaining = order.slice()
  let guard = 0
  while (remaining.length && guard++ < 64) {
    const next = []
    for (const name of remaining) {
      const j = rig.joints[name]
      if (j.parent && !pose[j.parent]) { next.push(name); continue }
      const lx = j.at[0] + track(clip, name, 'x', f, 0)
      const ly = j.at[1] + track(clip, name, 'y', f, 0)
      const lrot = track(clip, name, 'rot', f, 0) * DEG
      const lscale = track(clip, name, 'scale', f, 1)
      if (!j.parent) {
        pose[name] = { x: rig.origin[0] + lx, y: rig.origin[1] + ly, rot: lrot, scale: lscale }
      } else {
        const p = pose[j.parent]
        const cos = Math.cos(p.rot), sin = Math.sin(p.rot)
        pose[name] = {
          x: p.x + (lx * cos - ly * sin) * p.scale,
          y: p.y + (lx * sin + ly * cos) * p.scale,
          rot: p.rot + lrot,
          scale: p.scale * lscale
        }
      }
    }
    remaining = next
  }
  return pose
}

// ── shapes, tested in local space so rotation is exact ──────────────────────────────────────────

function localBounds (shape) {
  switch (shape.type) {
    case 'ellipse': return [shape.cx - shape.rx, shape.cy - shape.ry, shape.cx + shape.rx, shape.cy + shape.ry]
    case 'rect': return [shape.x, shape.y, shape.x + shape.w, shape.y + shape.h]
    case 'capsule': return [Math.min(shape.x1, shape.x2) - shape.r, Math.min(shape.y1, shape.y2) - shape.r,
      Math.max(shape.x1, shape.x2) + shape.r, Math.max(shape.y1, shape.y2) + shape.r]
    case 'poly': {
      const xs = shape.points.map((p) => p[0]), ys = shape.points.map((p) => p[1])
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    }
    default: return [0, 0, 0, 0]
  }
}

function inside (shape, x, y) {
  switch (shape.type) {
    case 'ellipse': {
      const dx = (x - shape.cx) / shape.rx, dy = (y - shape.cy) / shape.ry
      return dx * dx + dy * dy <= 1
    }
    case 'rect':
      return x >= shape.x && x < shape.x + shape.w && y >= shape.y && y < shape.y + shape.h
    case 'capsule': {
      const vx = shape.x2 - shape.x1, vy = shape.y2 - shape.y1
      const len2 = vx * vx + vy * vy
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - shape.x1) * vx + (y - shape.y1) * vy) / len2))
      const dx = x - (shape.x1 + t * vx), dy = y - (shape.y1 + t * vy)
      return dx * dx + dy * dy <= shape.r * shape.r
    }
    case 'poly': {
      const p = shape.points
      let hit = false
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        if ((p[i][1] > y) !== (p[j][1] > y) &&
            x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) hit = !hit
      }
      return hit
    }
    default: return false
  }
}

/** Draw one shape through a joint's world transform, sampling per destination pixel. */
function drawShape (c, shape, xf, scale, colour, flip) {
  const [lx0, ly0, lx1, ly1] = localBounds(shape)
  const cos = Math.cos(xf.rot), sin = Math.sin(xf.rot)
  const s = xf.scale * scale
  const corners = [[lx0, ly0], [lx1, ly0], [lx0, ly1], [lx1, ly1]].map(([x, y]) => {
    const fx = flip ? -x : x
    return [xf.x + (fx * cos - y * sin) * s, xf.y + (fx * sin + y * cos) * s]
  })
  const x0 = Math.floor(Math.min(...corners.map((p) => p[0])))
  const x1 = Math.ceil(Math.max(...corners.map((p) => p[0])))
  const y0 = Math.floor(Math.min(...corners.map((p) => p[1])))
  const y1 = Math.ceil(Math.max(...corners.map((p) => p[1])))

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      // Inverse transform the pixel centre back into shape space.
      const dx = (px + 0.5 - xf.x) / s, dy = (py + 0.5 - xf.y) / s
      let lxp = dx * cos + dy * sin
      const lyp = -dx * sin + dy * cos
      if (flip) lxp = -lxp
      if (inside(shape, lxp, lyp)) put(c, px, py, colour)
    }
  }
}

// ── the bake ────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} d descriptor
 * @param {{rigs, clips, parts, palettes}} lib registry-backed lookups, each `(id) => def`
 * @returns {{w, h, clips: {[key]: {fps, loop, frames: Uint8ClampedArray[]}}}}
 */
export function bakeDescriptor (d, lib) {
  const rig = lib.rigs(d.rig)
  const ramps = {
    ramp: lib.palettes(d.palette.ramp).ramp,
    accent: lib.palettes(d.palette.accent ?? d.palette.ramp).ramp
  }
  const outlineColour = parseHex(d.palette.outline ?? ramps.ramp[0])
  const [w, h] = rig.size
  const out = { w, h, clips: {} }

  for (const key of CLIP_KEYS) {
    const clipId = d.overrides?.clips?.[key] ?? rig.clips[key]
    const clip = lib.clips(clipId)
    const frames = []
    for (let f = 0; f < clip.frames; f++) {
      // A stream per (unit, clip, frame): jitter in one frame can never shift another's draws.
      const rng = makeRng(d.seed ?? 0).stream(`${d.id}|${key}|${f}`)
      const c = makeCanvas(w, h)
      const pose = poseOf(rig, clip, f)

      for (const joint of rig.z) {
        const bind = d.parts[joint]
        if (!bind || !pose[joint]) continue
        const part = lib.parts(bind.shape)
        const scale = (bind.scale ?? 1) * (d.scale ?? 1)
        const flip = !!bind.flip
        // A sub-pixel wobble per joint, seeded — asymmetry is what stops six units from reading
        // as one unit in six palettes.
        const xf = { ...pose[joint] }
        if (d.jitter !== 0) {
          xf.x += rng.range(-0.5, 0.5) * (d.jitter ?? 1)
          xf.y += rng.range(-0.5, 0.5) * (d.jitter ?? 1)
        }
        for (const shape of part.shapes) {
          drawShape(c, shape, xf, scale, resolveFill(shape.fill, ramps), flip)
        }
        if (bind.held) {
          const held = lib.parts(bind.held)
          for (const shape of held.shapes) drawShape(c, shape, xf, scale, resolveFill(shape.fill, ramps), flip)
        }
      }

      outline(c, outlineColour)
      frames.push(c.px)
    }
    out.clips[key] = { fps: clip.fps, loop: !!clip.loop, frames }
  }

  return out
}

/**
 * The same generator pointed at a different part set (§15.4): dungeon tilesets, so each floor gets
 * its own palette and floors read differently without any new art.
 * @returns {{w, h, tile, tiles: Uint8ClampedArray[]}}
 */
export function bakeTileset (d, lib) {
  const ramps = {
    ramp: lib.palettes(d.palette.ramp).ramp,
    accent: lib.palettes(d.palette.accent ?? d.palette.ramp).ramp
  }
  const size = d.tile ?? 16
  const tiles = []
  for (const [i, tile] of d.tiles.entries()) {
    const c = makeCanvas(size, size)
    const xf = { x: 0, y: 0, rot: 0, scale: 1 }
    for (const shape of lib.parts(tile.shape).shapes) {
      drawShape(c, shape, xf, 1, resolveFill(shape.fill, ramps), false)
    }
    // Speckle: a fixed number of draws in a fixed order, so the tile is reproducible.
    const rng = makeRng(d.seed ?? 0).stream(`${d.id}|tile|${i}`)
    for (let n = 0; n < (tile.speckle ?? 0); n++) {
      const x = rng.int(size), y = rng.int(size)
      if (alphaAt(c, x, y)) put(c, x, y, resolveFill(tile.speckleFill ?? 'ramp.1', ramps))
    }
    tiles.push(c.px)
  }
  return { w: size * tiles.length, h: size, tile: size, tiles }
}
