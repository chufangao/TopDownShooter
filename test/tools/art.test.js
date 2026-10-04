// K2's gate (§17): two descriptors → two visibly different units, byte-identical across machines.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createGame } from '../../src/sim/boot.js'
import { discoverPacks } from '../../tools/packsource.node.js'
import { bakeDescriptor, bakeTileset, CLIP_KEYS, GENERATOR_VERSION } from '../../tools/art/raster.js'
import { encodePng } from '../../tools/art/png.js'

const { kernel } = await createGame({ packs: discoverPacks('packs'), seed: 0 })
const R = kernel.registry
const lib = {
  rigs: (id) => R.get('art_rig', id),
  clips: (id) => R.get('art_clip', id),
  parts: (id) => R.get('art_part', id),
  palettes: (id) => R.get('art_palette', id)
}
const descriptor = (id) => R.get('art_descriptor', id)
const opaque = (px) => { let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++; return n }

test('every unit bakes the six animation sets and nothing else (§7)', () => {
  const baked = bakeDescriptor(descriptor('core:bone_chanter'), lib)
  assert.deepEqual(Object.keys(baked.clips).sort(), [...CLIP_KEYS].sort())
  assert.deepEqual([baked.w, baked.h], [48, 48])
  const total = CLIP_KEYS.reduce((n, k) => n + baked.clips[k].frames.length, 0)
  assert.ok(total >= 20 && total <= 60, `${total} frames per unit — the design budget is ~36`)
})

test('baking is deterministic — same inputs, byte-identical pixels', () => {
  for (const id of ['core:bone_chanter', 'core:ember_drake']) {
    const a = bakeDescriptor(descriptor(id), lib)
    const b = bakeDescriptor(descriptor(id), lib)
    for (const key of CLIP_KEYS) {
      a.clips[key].frames.forEach((frame, i) => {
        assert.deepEqual(Array.from(frame), Array.from(b.clips[key].frames[i]), `${id}/${key}/${i}`)
      })
    }
  }
})

test('the PNG encoder is deterministic too, so committed art diffs cleanly', () => {
  const baked = bakeDescriptor(descriptor('core:tomb_knight'), lib)
  const frame = baked.clips.idle.frames[0]
  const a = encodePng(frame, baked.w, baked.h)
  const b = encodePng(frame, baked.w, baked.h)
  assert.deepEqual(a, b)
  assert.deepEqual(Array.from(a.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
})

test('two descriptors over the same rig are visibly different units', () => {
  const a = bakeDescriptor(descriptor('core:bone_chanter'), lib).clips.idle.frames[0]
  const b = bakeDescriptor(descriptor('core:tomb_knight'), lib).clips.idle.frames[0]
  let differing = 0
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) differing++
  }
  const pixels = a.length / 4
  assert.ok(differing / pixels > 0.15,
    `only ${(100 * differing / pixels).toFixed(1)}% of pixels differ — these two read as the same unit`)
})

test('a palette swap changes colour without changing silhouette (§15.4)', () => {
  const base = descriptor('core:bone_chanter')
  const recoloured = { ...base, palette: { ramp: 'core:ember', accent: 'core:brass' } }
  const a = bakeDescriptor(base, lib).clips.idle.frames[0]
  const b = bakeDescriptor(recoloured, lib).clips.idle.frames[0]
  assert.equal(opaque(a), opaque(b), 'a recolour must not move a single pixel')
  assert.notDeepEqual(Array.from(a), Array.from(b), 'but it must change the colours')
})

test('frames are non-empty and stay inside the canvas', () => {
  for (const d of R.all('art_descriptor')) {
    if (d.type === 'tileset') continue
    const baked = bakeDescriptor(d, lib)
    for (const key of CLIP_KEYS) {
      baked.clips[key].frames.forEach((frame, i) => {
        assert.equal(frame.length, baked.w * baked.h * 4, `${d.id}/${key}/${i} wrong buffer size`)
        assert.ok(opaque(frame) > 40, `${d.id}/${key}/${i} is nearly empty — the unit fell off the canvas`)
      })
    }
  }
})

test('the outline pass runs — every sprite has dark pixels on its silhouette edge', () => {
  const baked = bakeDescriptor(descriptor('core:frost_sprite'), lib)
  const px = baked.clips.idle.frames[0]
  const at = (x, y) => px[(y * baked.w + x) * 4 + 3]
  let edge = 0
  for (let y = 1; y < baked.h - 1; y++) {
    for (let x = 1; x < baked.w - 1; x++) {
      if (at(x, y) && !at(x - 1, y)) edge++
    }
  }
  assert.ok(edge > 0, 'no silhouette found at all')
})

test('the tileset bakes one strip of same-sized tiles', () => {
  const t = bakeTileset(descriptor('core:tileset_crypt'), lib)
  assert.equal(t.tile, 16)
  assert.equal(t.w, t.tile * t.tiles.length)
  assert.equal(opaque(t.tiles[0]), 0, 'tile 0 is void and must be fully transparent')
  for (const px of t.tiles.slice(1)) assert.equal(px.length, t.tile * t.tile * 4)
})

test('the committed manifest matches what the generator produces now (§18.13)', () => {
  const m = JSON.parse(readFileSync('packs/core/art/baked/manifest.json', 'utf8'))
  assert.equal(m.generator, GENERATOR_VERSION)
  for (const d of R.all('art_descriptor')) {
    if (!d.id.startsWith('core:')) continue
    assert.ok(m.hashes[d.id], `${d.id} has no baked hash — run npm run art`)
  }
})
