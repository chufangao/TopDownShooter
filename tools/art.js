#!/usr/bin/env node
// The art baker (§15) — descriptors in, committed atlases out.
//
//   descriptor.json ─┐
//   rig / clips ─────┼─→ tools/art.js ─→ atlas-N.png · atlas-N.json · anims.json · manifest.json
//   parts / palettes ┘      (Node)              packs/<pack>/art/baked/   ← committed
//
// Generation is what makes 120 units affordable; baking ahead of time is what keeps startup
// instant, keeps the renderer ignorant of the generator, and makes the art a reviewable, diffable
// artifact instead of something that might come out different on someone else's machine.
//
//   node tools/art.js                      # bake stale descriptors
//   node tools/art.js --force              # rebake everything
//   node tools/art.js --pack core          # one pack
//   node tools/art.js --check              # CI: fail if committed art is stale (§18.13)

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createGame } from '../src/sim/boot.js'
import { discoverPacks } from './packsource.node.js'
import { stableStringify, digest } from '../src/sim/kernel/registry.js'
import { encodePng } from './art/png.js'
import { bakeDescriptor, bakeTileset, GENERATOR_VERSION, CLIP_KEYS } from './art/raster.js'

const args = process.argv.slice(2)
const force = args.includes('--force')
const checkOnly = args.includes('--check')
const onlyPack = args[args.indexOf('--pack') + 1] !== undefined && args.includes('--pack') ? args[args.indexOf('--pack') + 1] : null

const ATLAS_WIDTH = 1024

const packs = discoverPacks('packs')
const { kernel, report } = await createGame({ packs, seed: 0 })
if (report.errors.length) {
  console.error('content does not load; fix that first:\n  ' + report.errors.join('\n  '))
  process.exit(1)
}
const R = kernel.registry
const lib = {
  rigs: (id) => R.get('art_rig', id),
  clips: (id) => R.get('art_clip', id),
  parts: (id) => R.get('art_part', id),
  palettes: (id) => R.get('art_palette', id)
}

/**
 * Same inputs → byte-identical PNG (§15.2). Which buys incremental bakes, a meaningful git diff on
 * baked output, and a CI check that fails if committed art is stale. Bumping GENERATOR_VERSION
 * rebakes everything on purpose.
 */
function artHash (d) {
  const deps = { generator: GENERATOR_VERSION, descriptor: d }
  if (d.type === 'tileset') {
    deps.parts = d.tiles.map((t) => lib.parts(t.shape))
  } else {
    const rig = lib.rigs(d.rig)
    deps.rig = rig
    deps.clips = CLIP_KEYS.map((k) => lib.clips(d.overrides?.clips?.[k] ?? rig.clips[k]))
    deps.parts = Object.values(d.parts).flatMap((b) => [lib.parts(b.shape), b.held ? lib.parts(b.held) : null])
  }
  deps.palettes = [lib.palettes(d.palette.ramp), lib.palettes(d.palette.accent ?? d.palette.ramp)]
  return digest(stableStringify(deps))
}

/** Shelf packing over id-sorted frames — deterministic layout, so the atlas diffs cleanly. */
function packAtlas (entries) {
  const frames = []
  let x = 0, y = 0, shelfH = 0
  for (const e of entries) {
    for (const key of CLIP_KEYS) {
      const clip = e.baked.clips[key]
      clip.frames.forEach((px, i) => {
        if (x + e.baked.w > ATLAS_WIDTH) { x = 0; y += shelfH; shelfH = 0 }
        frames.push({ name: `${e.id}/${key}/${i}`, x, y, w: e.baked.w, h: e.baked.h, px })
        x += e.baked.w
        shelfH = Math.max(shelfH, e.baked.h)
      })
    }
  }
  const height = y + shelfH
  const canvas = new Uint8ClampedArray(ATLAS_WIDTH * height * 4)
  for (const f of frames) {
    for (let row = 0; row < f.h; row++) {
      const src = row * f.w * 4
      const dst = ((f.y + row) * ATLAS_WIDTH + f.x) * 4
      canvas.set(f.px.subarray(src, src + f.w * 4), dst)
    }
  }
  return { canvas, width: ATLAS_WIDTH, height, frames }
}

let staleCount = 0
let bakedPacks = 0

for (const pack of packs) {
  if (onlyPack && pack.id !== onlyPack) continue
  const bakedDir = pack.manifest.art?.baked
  if (!bakedDir) continue

  const descriptors = R.all('art_descriptor').filter((d) => d.id.startsWith(pack.id + ':'))
  if (descriptors.length === 0) continue

  const outDir = join('packs', pack.id, bakedDir)
  const manifestPath = join(outDir, 'manifest.json')
  const prev = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null

  const hashes = Object.fromEntries(descriptors.map((d) => [d.id, artHash(d)]))
  const unchanged = prev &&
    prev.generator === GENERATOR_VERSION &&
    stableStringify(prev.hashes ?? {}) === stableStringify(hashes) &&
    existsSync(join(outDir, 'atlas-0.png'))

  if (unchanged && !force) {
    console.log(`${pack.id}: up to date (${descriptors.length} descriptors)`)
    continue
  }

  staleCount++
  if (checkOnly) {
    console.error(`${pack.id}: baked art is STALE — run \`npm run art\` and commit the result`)
    continue
  }

  const units = descriptors.filter((d) => d.type !== 'tileset')
  const tilesets = descriptors.filter((d) => d.type === 'tileset')

  const entries = units.map((d) => ({ id: d.id, baked: bakeDescriptor(d, lib) }))
  const atlas = packAtlas(entries)

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'atlas-0.png'), encodePng(atlas.canvas, atlas.width, atlas.height))

  // Phaser TextureAtlas JSON Array format — the renderer loads this and knows nothing else.
  writeFileSync(join(outDir, 'atlas-0.json'), JSON.stringify({
    frames: atlas.frames.map((f) => ({
      filename: f.name,
      frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h },
      sourceSize: { w: f.w, h: f.h }
    })),
    meta: { app: 'tools/art.js', version: String(GENERATOR_VERSION), image: 'atlas-0.png', format: 'RGBA8888', size: { w: atlas.width, h: atlas.height }, scale: '1' }
  }, null, 1) + '\n')

  // Generated Phaser animation defs, one per (unit, clip) — no hand-authored anim config anywhere.
  const anims = []
  for (const e of entries) {
    for (const key of CLIP_KEYS) {
      const clip = e.baked.clips[key]
      anims.push({
        key: `${e.id}/${key}`,
        frames: clip.frames.map((_, i) => `${e.id}/${key}/${i}`),
        frameRate: clip.fps,
        repeat: clip.loop ? -1 : 0
      })
    }
  }
  writeFileSync(join(outDir, 'anims.json'), JSON.stringify(anims, null, 1) + '\n')

  const tiles = {}
  for (const d of tilesets) {
    const t = bakeTileset(d, lib)
    const strip = new Uint8ClampedArray(t.w * t.h * 4)
    t.tiles.forEach((px, i) => {
      for (let row = 0; row < t.tile; row++) {
        strip.set(px.subarray(row * t.tile * 4, (row + 1) * t.tile * 4), (row * t.w + i * t.tile) * 4)
      }
    })
    const name = d.id.split(':')[1]
    writeFileSync(join(outDir, `tiles-${name}.png`), encodePng(strip, t.w, t.h))
    tiles[d.id] = { file: `tiles-${name}.png`, tile: t.tile, count: t.tiles.length }
  }

  writeFileSync(manifestPath, JSON.stringify({
    generator: GENERATOR_VERSION,
    atlas: { image: 'atlas-0.png', data: 'atlas-0.json', anims: 'anims.json', w: atlas.width, h: atlas.height },
    tiles,
    hashes,
    frames: Object.fromEntries(entries.map((e) => [e.id, CLIP_KEYS.map((k) => `${e.id}/${k}`)]))
  }, null, 1) + '\n')

  bakedPacks++
  console.log(`${pack.id}: baked ${entries.length} unit(s) → ${atlas.frames.length} frames ` +
    `(${atlas.width}×${atlas.height}), ${tilesets.length} tileset(s)`)
}

if (checkOnly) {
  console.log(staleCount === 0 ? 'baked art is fresh' : `${staleCount} pack(s) stale`)
  process.exit(staleCount === 0 ? 0 : 1)
}
if (bakedPacks === 0 && staleCount === 0) console.log('nothing to do')
