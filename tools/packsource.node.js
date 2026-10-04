// Node pack source — one of the four ways a pack reaches the loader (§13.1).
//
// This lives in tools/ rather than src/sim/ on purpose: reading a directory is a *host* concern,
// and src/sim/ must stay runnable in a browser and in a Worker with no Node APIs. Every source
// (bundled glob, dev watch, dragged zip → OPFS, remote fetch, this one) converges on the same
// `{manifest, files}` shape before the loader sees anything.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPack } from '../src/sim/mods/pack.js'

const TEXT = /\.(json|js|mjs|md|txt|csv)$/i

function walk (dir, root, out) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || name === 'node_modules') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, root, out)
    else out.set(relative(root, full).split(sep).join('/'), TEXT.test(name) ? readFileSync(full, 'utf8') : readFileSync(full))
  }
  return out
}

/** @returns {object} a pack, or throws if the directory has no mod.json */
export function readPackFromDisk (dir) {
  const manifestPath = join(dir, 'mod.json')
  if (!existsSync(manifestPath)) throw new Error(`${dir} is not a pack — no mod.json`)
  const files = walk(dir, dir, new Map())
  let manifest
  try {
    manifest = JSON.parse(files.get('mod.json'))
  } catch (e) {
    throw new Error(`${dir}/mod.json is not valid JSON — ${e.message}`)
  }
  return createPack(manifest, files)
}

/** Every pack directly under `root`, sorted by directory name for a reproducible discovery order. */
export function discoverPacks (root = 'packs') {
  if (!existsSync(root)) return []
  return readdirSync(root).sort()
    .map((name) => join(root, name))
    .filter((dir) => statSync(dir).isDirectory() && existsSync(join(dir, 'mod.json')))
    .map(readPackFromDisk)
}

/** Tier-3 script importer for Node hosts (tools, tests). Browsers supply their own. */
export function makeNodeImporter (root = 'packs') {
  return async (pack, path) => import(pathToFileURL(join(root, pack.id, path)).href)
}
