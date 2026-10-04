// The pack loader — the ONLY path into the registry (§13.1, invariant §18.12).
//
//   discover → validate manifests → topological sort → define content → apply patches →
//   run scripts → validate every reference → resolve art → registry.freeze()
//
// `packs/core/` goes through this function exactly as a stranger's pack does. There is no
// privileged path: the reason to build the loader before any content exists is that there is then
// never a pre-mod way of doing things to migrate away from.
//
// (The ~20 core op *implementations* are JS shipped with the kernel, per §16.1 — content is JSON,
// verbs are code. A third-party pack registers its own verbs through the same ops registry via a
// tier-3 script, so both parties have both doors.)

import { namespaceOf } from '../kernel/registry.js'
import { validateManifest, resolveLoadOrder, API_VERSION } from './manifest.js'
import { patchesIn, validatePatch, applyPatch } from './patch.js'
import { createModApi, runScript } from './sandbox.js'

/** Walk a ref path like `abilities[]` or `branches[].opts[]` and yield every id it names. */
export function collectRefs (def, path) {
  let nodes = [def]
  for (const seg of path.split('.')) {
    const isArray = seg.endsWith('[]')
    const key = isArray ? seg.slice(0, -2) : seg
    const next = []
    for (const n of nodes) {
      if (n === null || typeof n !== 'object') continue
      const v = key === '' ? n : n[key]
      if (v === undefined || v === null) continue
      if (isArray) { if (Array.isArray(v)) next.push(...v) } else next.push(v)
    }
    nodes = next
  }
  return nodes.filter((v) => typeof v === 'string')
}

/**
 * @param {Array} packs           `createPack()` results, in any order
 * @param {object} kernel         `createKernel()`
 * @param {object} opts
 * @param {object} opts.kinds     content kind specs: `{[kind]: {refs?, validate?}}`
 * @param {boolean} [opts.allowScripts]  tier 3 is off by default — a per-pack trust decision
 * @param {(pack, path) => Promise<object>} [opts.importScript] host-provided module importer
 * @param {(...args) => void} [opts.log]
 * @returns {Promise<object>} report
 */
export async function loadPacks (packs, kernel, {
  kinds = {},
  allowScripts = false,
  trusted = [],
  importScript = null,
  log = () => {}
} = {}) {
  const report = {
    order: [],
    disabled: [],
    errors: [],
    warnings: [],
    patchLog: [],
    counts: {},
    scripts: [],
    contentHash: null
  }

  // ── 1. manifests ─────────────────────────────────────────────────────────────────────────────
  const usable = []
  for (const pack of packs) {
    const errs = validateManifest(pack.manifest, `${pack.id ?? '?'}/mod.json`)
    if (errs.length) {
      // A broken manifest disables one pack; it never takes the game down.
      report.disabled.push({ id: pack.manifest?.id ?? '?', reason: errs.join('; ') })
    } else usable.push(pack)
  }

  // ── 2. load order ────────────────────────────────────────────────────────────────────────────
  const { order, disabled, errors } = resolveLoadOrder(usable, { api: API_VERSION })
  report.disabled.push(...disabled)
  report.errors.push(...errors)
  report.order = order
  const byId = new Map(usable.map((p) => [p.manifest.id, p]))
  const ordered = order.map((id) => byId.get(id))

  // ── 3. content ───────────────────────────────────────────────────────────────────────────────
  for (const pack of ordered) {
    for (const path of pack.match(pack.manifest.content ?? [])) {
      const doc = pack.json(path)
      const kind = doc?.kind
      const defs = doc?.defs
      if (typeof kind !== 'string' || !Array.isArray(defs)) {
        report.errors.push(`${pack.id}/${path}: content files are {"kind": "...", "defs": [...]}`)
        continue
      }
      for (const def of defs) {
        const id = def?.id
        if (typeof id !== 'string') {
          report.errors.push(`${pack.id}/${path}: a ${kind} def has no id`)
          continue
        }
        // A pack may only define ids in its own namespace. Squatting `core:` is how mod conflicts
        // become unfixable, so it is refused rather than reported.
        if (namespaceOf(id) !== pack.id) {
          report.errors.push(`${pack.id}/${path}: ${kind} "${id}" is outside the "${pack.id}:" namespace`)
          continue
        }
        try {
          kernel.registry.define(kind, id, def, pack.id)
        } catch (e) {
          report.errors.push(`${pack.id}/${path}: ${e.message}`)
        }
      }
    }
  }

  // ── 3b. art descriptors — art source lives beside the art, not in content/ (§15.1), but it is
  //        registry content like everything else so `unit.art.descriptor` gets ref-checked. ─────
  for (const pack of ordered) {
    const dir = pack.manifest.art?.descriptors
    if (!dir) continue
    for (const path of pack.match(dir.replace(/\/?$/, '/') + '*.json')) {
      const def = pack.json(path)
      if (typeof def?.id !== 'string') { report.errors.push(`${pack.id}/${path}: descriptor has no id`); continue }
      if (namespaceOf(def.id) !== pack.id) {
        report.errors.push(`${pack.id}/${path}: descriptor "${def.id}" is outside the "${pack.id}:" namespace`)
        continue
      }
      try {
        kernel.registry.define('art_descriptor', def.id, def, pack.id)
      } catch (e) {
        report.errors.push(`${pack.id}/${path}: ${e.message}`)
      }
    }
  }

  // ── 4. patches ───────────────────────────────────────────────────────────────────────────────
  for (const pack of ordered) {
    for (const path of pack.match(pack.manifest.patches ?? [])) {
      const doc = pack.json(path)
      patchesIn(doc).forEach((p, i) => {
        const where = `${pack.id}/${path}[${i}]`
        const errs = validatePatch(p, where)
        if (errs.length) { report.errors.push(...errs); return }
        try {
          const n = applyPatch(kernel.registry, p, { src: pack.id, forms: kernel.forms, log: report.patchLog })
          if (n === 0) report.warnings.push(`${where}: target "${p.target}" matched nothing`)
        } catch (e) {
          report.errors.push(`${where}: ${e.message}`)
        }
      })
    }
  }

  // ── 5. scripts (tier 3, opt-in per pack) ─────────────────────────────────────────────────────
  for (const pack of ordered) {
    const paths = pack.match(pack.manifest.scripts ?? [])
    if (paths.length === 0) continue
    if (!allowScripts && !trusted.includes(pack.id)) {
      report.warnings.push(`${pack.id}: ${paths.length} script(s) not run — this pack is not trusted`)
      continue
    }
    if (!importScript) {
      report.warnings.push(`${pack.id}: scripts declared but the host provides no importer`)
      continue
    }
    const api = createModApi(kernel, pack.id, { log })
    for (const path of paths) {
      try {
        runScript(await importScript(pack, path), api, pack.id, path)
        report.scripts.push(`${pack.id}/${path}`)
      } catch (e) {
        // One bad script disables its own pack's extras, not the game.
        report.errors.push(`${pack.id}/${path}: ${e.message}`)
      }
    }
  }

  // ── 6. validate every reference and every def ────────────────────────────────────────────────
  const api = { registry: kernel.registry, ops: kernel.ops, forms: kernel.forms, kernel }
  for (const kind of kernel.registry.kinds()) {
    const spec = kinds[kind]
    report.counts[kind] = kernel.registry.count(kind)
    if (!spec) {
      report.warnings.push(`content kind "${kind}" has no declared spec — refs in it go unchecked`)
      continue
    }
    for (const def of kernel.registry.all(kind)) {
      for (const ref of spec.refs ?? []) {
        for (const id of collectRefs(def, ref.path)) {
          if (!kernel.registry.has(ref.kind, id)) {
            report.errors.push(`${kind} ${def.id}: ${ref.path} → unknown ${ref.kind} "${id}"` +
              ` (from ${kernel.registry.sourceOf(kind, def.id)})`)
          }
        }
      }
      if (spec.validate) {
        for (const msg of spec.validate(def, api)) report.errors.push(`${kind} ${def.id}: ${msg}`)
      }
    }
  }

  // ── 7. freeze — nothing may mutate content after this point (invariant §18.8) ────────────────
  if (report.errors.length === 0) {
    kernel.freeze()
    report.contentHash = kernel.registry.hash()
  }

  return report
}

/** One-line summary for the boot log and for tools/lint.js. */
export function formatReport (r) {
  const lines = []
  lines.push(`packs: ${r.order.join(' → ') || '(none)'}`)
  const counts = Object.entries(r.counts).sort().map(([k, n]) => `${n} ${k}`).join(', ')
  if (counts) lines.push(`content: ${counts}`)
  if (r.contentHash) lines.push(`contentHash: ${r.contentHash}`)
  for (const d of r.disabled) lines.push(`DISABLED ${d.id}: ${d.reason}`)
  for (const w of r.warnings) lines.push(`warn: ${w}`)
  for (const e of r.errors) lines.push(`ERROR ${e}`)
  return lines.join('\n')
}
