// Browser pack source — bundled packs via Vite's glob (§13.1).
//
// This is the fourth host for the same shape. Dev, build, a dragged zip unpacked into OPFS and a
// remote fetch all converge on `{manifest, files}` before the loader sees anything, which is why
// the loader knows nothing about Vite.
//
// Content arrives as raw text and goes through the pack loader — it is never `import`ed as a
// module (invariant §18.12). Baked art is different: it is a texture the renderer loads by URL,
// so it comes through `?url` and never enters the registry.

import { createPack } from '../sim/mods/pack.js'

const TEXT = {
  ...import.meta.glob('/packs/*/*.json', { eager: true, query: '?raw', import: 'default' }),
  ...import.meta.glob('/packs/*/**/*.json', { eager: true, query: '?raw', import: 'default' })
}

const ASSETS = {
  ...import.meta.glob('/packs/*/art/baked/*.png', { eager: true, query: '?url', import: 'default' })
}

const packIdOf = (path) => path.split('/')[2]
const relOf = (path) => path.split('/').slice(3).join('/')

/** @returns {Array} every bundled pack, sorted by id so discovery order is reproducible. */
export function bundledPacks () {
  const byPack = new Map()
  for (const [path, text] of Object.entries(TEXT)) {
    const id = packIdOf(path)
    if (!byPack.has(id)) byPack.set(id, new Map())
    byPack.get(id).set(relOf(path), text)
  }

  const packs = []
  for (const id of [...byPack.keys()].sort()) {
    const files = byPack.get(id)
    const raw = files.get('mod.json')
    if (!raw) continue
    try {
      packs.push(createPack(JSON.parse(raw), files))
    } catch (e) {
      console.error(`packs/${id}/mod.json is not valid JSON — ${e.message}`)
    }
  }
  return packs
}

/** Resolved URL for a baked asset, so Phaser's loader gets a real, cacheable file. */
export function assetUrl (packId, relPath) {
  return ASSETS[`/packs/${packId}/${relPath}`] ?? null
}
