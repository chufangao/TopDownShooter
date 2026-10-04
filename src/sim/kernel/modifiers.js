// Kernel primitive 3 of 7 — the one stat pipeline (§11.3).
//
// This is the ONLY way any number in the game is ever changed. Equipment, statuses, Resonance,
// Pacts, keystones, Lattice ranks, shrine curses and mod scripts all contribute the same shape:
//
//   { path, op, v, prio?, src }        op ∈ set | add | mul | clamp
//
// Within a path, application is always set → add → mul → clamp, ties inside an op broken by
// (prio, src). The property that matters: **the result does not depend on collection order.** A
// mod that injects a modifier cannot produce an order-dependent bug, because there is no order to
// depend on. That is the whole reason this is a file instead of `stat *= 1.2` at eleven call sites.

export const OPS = ['set', 'add', 'mul', 'clamp']
const OP_RANK = { set: 0, add: 1, mul: 2, clamp: 3 }

const PATH_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/

export function getPath (obj, path) {
  let v = obj
  for (const k of path.split('.')) {
    if (v == null) return undefined
    v = v[k]
  }
  return v
}

export function setPath (obj, path, value) {
  const parts = path.split('.')
  let o = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {}
    o = o[parts[i]]
  }
  o[parts[parts.length - 1]] = value
  return obj
}

/**
 * Shape check for one modifier. Called at load time by the loader and by tools/lint.js, never at
 * tick time — a typo should fail the build naming the mod, not surface as NaN on floor 7.
 * @param {object} m
 * @param {Set<string>|null} allowedPaths stat schema; null skips the path check
 */
export function validateModifier (m, allowedPaths = null) {
  const where = m?.src ? ` (from ${m.src})` : ''
  if (m === null || typeof m !== 'object') return [`modifier must be an object${where}`]
  const errs = []
  if (typeof m.path !== 'string' || !PATH_RE.test(m.path)) {
    errs.push(`modifier path ${JSON.stringify(m.path)} is not a dotted lowercase path${where}`)
  } else if (allowedPaths && !allowedPaths.has(m.path)) {
    errs.push(`unknown modifier path "${m.path}"${where} — not in the stat schema`)
  }
  if (!OPS.includes(m.op)) errs.push(`modifier op ${JSON.stringify(m.op)} must be one of ${OPS.join(' ')}${where}`)
  if (m.op === 'clamp') {
    const [lo, hi] = clampBounds(m.v)
    if (!Number.isFinite(lo) && !Number.isFinite(hi)) {
      errs.push(`clamp modifier on "${m.path}" needs [min,max] or {min,max}${where}`)
    }
  } else if (m.op !== 'set' && typeof m.v !== 'number') {
    errs.push(`modifier ${m.op} on "${m.path}" needs a numeric v, got ${JSON.stringify(m.v)}${where}`)
  }
  if (m.prio !== undefined && typeof m.prio !== 'number') errs.push(`modifier prio must be a number${where}`)
  return errs
}

function clampBounds (v) {
  if (Array.isArray(v)) return [v[0] ?? -Infinity, v[1] ?? Infinity]
  if (v && typeof v === 'object') return [v.min ?? -Infinity, v.max ?? Infinity]
  return [-Infinity, Infinity]
}

/** Total order over modifiers. Deterministic, and independent of the array it arrived in. */
function compare (a, b) {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1
  const ra = OP_RANK[a.op], rb = OP_RANK[b.op]
  if (ra !== rb) return ra - rb
  const pa = a.prio ?? 0, pb = b.prio ?? 0
  if (pa !== pb) return pa - pb
  const sa = a.src ?? '', sb = b.src ?? ''
  if (sa !== sb) return sa < sb ? -1 : 1
  // Last resort: value, so two anonymous identical-priority modifiers still order stably.
  return String(a.v) < String(b.v) ? -1 : String(a.v) > String(b.v) ? 1 : 0
}

function clone (v) {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(clone)
  const o = {}
  for (const k of Object.keys(v)) o[k] = clone(v[k])
  return o
}

function deepFreeze (o) {
  if (o === null || typeof o !== 'object' || Object.isFrozen(o)) return o
  Object.freeze(o)
  for (const k of Object.keys(o)) deepFreeze(o[k])
  return o
}

/**
 * @param {object} base       base stat block (nested objects allowed)
 * @param {Array}  modifiers  flat concat from every source, in any order
 * @returns {object} frozen stat block
 */
export function resolveStats (base, modifiers = []) {
  const out = clone(base)
  if (modifiers.length === 0) return deepFreeze(out)

  const sorted = modifiers.slice().sort(compare)

  let i = 0
  while (i < sorted.length) {
    const path = sorted[i].path
    let j = i
    while (j < sorted.length && sorted[j].path === path) j++

    let value = getPath(out, path)
    let sum = 0
    let factor = 1
    let lo = -Infinity
    let hi = Infinity
    let touched = false

    for (let k = i; k < j; k++) {
      const m = sorted[k]
      switch (m.op) {
        case 'set': value = m.v; touched = true; break
        case 'add': sum += m.v; touched = true; break
        case 'mul': factor *= m.v; touched = true; break
        case 'clamp': {
          const [a, b] = clampBounds(m.v)
          lo = Math.max(lo, a)
          hi = Math.min(hi, b)
          touched = true
          break
        }
      }
    }

    if (touched) {
      if (typeof value === 'number') {
        value = (value + sum) * factor
        if (lo > -Infinity) value = Math.max(lo, value)
        if (hi < Infinity) value = Math.min(hi, value)
      } else if (sum !== 0 || factor !== 1) {
        throw new Error(`modifier path "${path}" is ${typeof value}; add/mul need a number ` +
          `(sources: ${[...new Set(sorted.slice(i, j).map((m) => m.src ?? '?'))].join(', ')})`)
      }
      setPath(out, path, value)
    }
    i = j
  }

  return deepFreeze(out)
}

/**
 * The stat schema: every legal modifier path. Anything not listed is a boot error naming the mod
 * that used it (§11.3). Extended by content kinds, not by editing this file.
 */
export function createStatSchema (paths = []) {
  const set = new Set(paths)
  return {
    has: (p) => set.has(p),
    add (p) { set.add(p); return this },
    paths: () => [...set].sort(),
    /** @returns {string[]} problems */
    check (modifiers) {
      const errs = []
      for (const m of modifiers) errs.push(...validateModifier(m, set))
      return errs
    }
  }
}
