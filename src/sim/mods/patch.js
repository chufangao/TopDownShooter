// Rebalancing without forking (§13.2).
//
//   { "target": "unit:core:bone_chanter",
//     "ops": [ { "op": "mul",  "path": "base.hp",  "v": 1.2 },
//              { "op": "push", "path": "abilities", "v": "kindled:emberdirge" },
//              { "op": "set",  "path": "tier",      "v": 3 } ] }
//
// Two mods patching the same path is NOT an error — the log names both, and tools/modcheck.js
// reports overlaps so authors can coordinate. Hard-failing on overlap is what makes large mod
// lists impossible; a shrug plus a good report is what makes them work.
//
// Wildcard targets (`unit:*` plus a `where` expression) make "rebalance every Drake" a four-line
// file rather than forty.

import { getPath, setPath } from '../kernel/modifiers.js'

export const PATCH_OPS = ['set', 'add', 'mul', 'push', 'remove', 'delete', 'merge']

function clone (v) {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(clone)
  const o = {}
  for (const k of Object.keys(v)) o[k] = clone(v[k])
  return o
}

/** A patch file may hold one patch, an array of them, or `{patches: [...]}`. */
export function patchesIn (doc) {
  if (Array.isArray(doc)) return doc
  if (Array.isArray(doc?.patches)) return doc.patches
  return doc ? [doc] : []
}

export function validatePatch (p, where = 'patch') {
  const errs = []
  if (p === null || typeof p !== 'object') return [`${where}: must be an object`]
  if (typeof p.target !== 'string' || !p.target.includes(':')) {
    errs.push(`${where}: target must be "kind:namespace:name" or "kind:*"`)
  }
  if (!Array.isArray(p.ops) || p.ops.length === 0) {
    errs.push(`${where}: ops must be a non-empty array`)
  } else {
    p.ops.forEach((op, i) => {
      if (!PATCH_OPS.includes(op?.op)) errs.push(`${where}.ops[${i}]: op must be one of ${PATCH_OPS.join(' ')}`)
      if (typeof op?.path !== 'string' || !op.path) errs.push(`${where}.ops[${i}]: path is required`)
      if (op?.op !== 'delete' && op?.v === undefined) errs.push(`${where}.ops[${i}]: v is required for ${op?.op}`)
      if ((op?.op === 'add' || op?.op === 'mul') && typeof op.v !== 'number') {
        errs.push(`${where}.ops[${i}]: ${op.op} needs a numeric v`)
      }
    })
  }
  return errs
}

function applyOp (def, op, target, log, src) {
  const before = getPath(def, op.path)
  switch (op.op) {
    case 'set': setPath(def, op.path, clone(op.v)); break
    case 'add':
      if (typeof before !== 'number') throw new Error(`patch ${src}: add on "${op.path}" of ${target}, which is ${typeof before}`)
      setPath(def, op.path, before + op.v)
      break
    case 'mul':
      if (typeof before !== 'number') throw new Error(`patch ${src}: mul on "${op.path}" of ${target}, which is ${typeof before}`)
      setPath(def, op.path, before * op.v)
      break
    case 'push': {
      const arr = Array.isArray(before) ? before.slice() : []
      arr.push(clone(op.v))
      setPath(def, op.path, arr)
      break
    }
    case 'remove': {
      const arr = Array.isArray(before) ? before.filter((x) => JSON.stringify(x) !== JSON.stringify(op.v)) : []
      setPath(def, op.path, arr)
      break
    }
    case 'delete': {
      const parts = op.path.split('.')
      const parent = parts.length > 1 ? getPath(def, parts.slice(0, -1).join('.')) : def
      if (parent && typeof parent === 'object') delete parent[parts[parts.length - 1]]
      break
    }
    case 'merge': {
      const base = (before !== null && typeof before === 'object' && !Array.isArray(before)) ? before : {}
      setPath(def, op.path, { ...base, ...clone(op.v) })
      break
    }
  }
  log.push({ src, target, op: op.op, path: op.path, before: clone(before), after: clone(getPath(def, op.path)) })
}

/**
 * @param {object} registry
 * @param {object} patch     one patch doc
 * @param {{src: string, forms?: object, log?: Array}} opts
 * @returns {number} how many defs it touched — 0 is worth reporting, it usually means a typo
 */
export function applyPatch (registry, patch, { src, forms, log = [] } = {}) {
  const [kind, ...rest] = patch.target.split(':')
  const idPart = rest.join(':')
  const wildcard = idPart === '*' || idPart.endsWith(':*')

  let ids
  if (!wildcard) {
    if (!registry.has(kind, idPart)) {
      // A patch aimed at content that isn't loaded is a warning, not a crash: mod lists are fluid.
      log.push({ src, target: patch.target, op: 'skip', path: '', note: 'target not loaded' })
      return 0
    }
    ids = [idPart]
  } else {
    const ns = idPart === '*' ? null : idPart.slice(0, idPart.indexOf(':'))
    ids = registry.ids(kind).filter((id) => ns === null || id.startsWith(ns + ':'))
  }

  let touched = 0
  for (const id of ids) {
    const current = registry.get(kind, id)
    if (patch.where) {
      if (!forms) throw new Error(`patch ${src}: "where" needs the expr forms registry`)
      if (!forms.eval(patch.where, { vars: { def: current } })) continue
    }
    const next = clone(current)
    for (const op of patch.ops) applyOp(next, op, `${kind}:${id}`, log, src)
    registry.redefine(kind, id, next, registry.sourceOf(kind, id))
    touched++
  }
  return touched
}

/** Patch-overlap report for tools/modcheck.js — two packs writing the same path on the same def. */
export function overlaps (log) {
  const seen = new Map()
  const out = []
  for (const e of log) {
    if (e.op === 'skip') continue
    const key = `${e.target}#${e.path}`
    if (!seen.has(key)) seen.set(key, new Set())
    seen.get(key).add(e.src)
  }
  for (const [key, srcs] of [...seen].sort()) {
    if (srcs.size > 1) out.push({ where: key, packs: [...srcs].sort() })
  }
  return out
}
