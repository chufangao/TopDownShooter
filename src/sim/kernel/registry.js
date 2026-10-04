// Kernel primitive 1 of 7 — the content store (§11.1).
//
// Two rules here carry disproportionate weight:
//   * `all()` sorts by id, so iteration order never depends on which mod loaded first. That one
//     line is why mod load order cannot change simulation outcomes.
//   * The registry is frozen before the first tick, so an instance can hold a `defId` string
//     instead of an object reference — which is what makes state trivially serialisable (§14).
//
// `get` throws rather than returning undefined: a dangling reference fails at boot with a name,
// not on floor 7 with a TypeError.

export const ID_RE = /^[a-z0-9_]+:[a-z0-9_]+$/

/** Bare ids are a load-time error, not a convenience — ambiguity makes mod conflicts unfixable. */
export function assertId (id, what = 'id') {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error(`bad ${what} ${JSON.stringify(id)} — content ids must be "namespace:name" ` +
      'matching /^[a-z0-9_]+:[a-z0-9_]+$/')
  }
  return id
}

export function namespaceOf (id) {
  return id.slice(0, id.indexOf(':'))
}

/** Deterministic JSON: object keys sorted at every depth. The basis of every content hash. */
export function stableStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}'
}

/** FNV-1a over a string, as 8 lowercase hex chars. Not cryptographic — a change detector. */
export function digest (str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function deepFreeze (o) {
  if (o === null || typeof o !== 'object' || Object.isFrozen(o)) return o
  Object.freeze(o)
  for (const k of Object.keys(o)) deepFreeze(o[k])
  return o
}

function didYouMean (id, candidates) {
  const name = id.slice(id.indexOf(':') + 1)
  const near = candidates.filter((c) => c.endsWith(':' + name) || c.includes(name)).slice(0, 3)
  return near.length ? ` — did you mean ${near.join(', ')}?` : ''
}

export function createRegistry () {
  /** @type {Map<string, Map<string, object>>} kind → id → def */
  const byKind = new Map()
  /** id → mod id that defined it, for patch logs and error messages. */
  const sources = new Map()
  const sortedCache = new Map()
  let frozen = false

  const kindMap = (kind) => {
    let m = byKind.get(kind)
    if (!m) { m = new Map(); byKind.set(kind, m) }
    return m
  }

  const R = {
    get frozen () { return frozen },

    /**
     * @param {string} kind  'unit' | 'ability' | 'status' | … — kinds are open; a mod may add one.
     * @param {string} id    namespaced
     * @param {object} def   plain data. Deep-frozen on define.
     * @param {string} [src] mod id that contributed it.
     */
    define (kind, id, def, src = namespaceOf(String(id))) {
      if (frozen) throw new Error(`registry is frozen — cannot define ${kind} ${id}`)
      assertId(id, `${kind} id`)
      if (def === null || typeof def !== 'object') {
        throw new Error(`${kind} ${id}: def must be an object, got ${typeof def}`)
      }
      const m = kindMap(kind)
      if (m.has(id)) {
        throw new Error(`duplicate ${kind} id ${id} (already defined by ${sources.get(kind + '/' + id)}). ` +
          'Two packs cannot define the same id — one of them should patch instead (§13.2).')
      }
      if (def.id !== undefined && def.id !== id) {
        throw new Error(`${kind} ${id}: def.id is ${def.id} — they must agree`)
      }
      m.set(id, deepFreeze({ ...def, id }))
      sources.set(kind + '/' + id, src)
      sortedCache.delete(kind)
      return R
    },

    /** Replace an existing def. Only the patch phase of the loader should use this (§13.2). */
    redefine (kind, id, def, src) {
      if (frozen) throw new Error(`registry is frozen — cannot redefine ${kind} ${id}`)
      const m = kindMap(kind)
      if (!m.has(id)) throw new Error(`cannot patch ${kind} ${id}: not defined`)
      m.set(id, deepFreeze({ ...def, id }))
      if (src) sources.set(kind + '/' + id, src)
      sortedCache.delete(kind)
      return R
    },

    has (kind, id) {
      return byKind.has(kind) && byKind.get(kind).has(id)
    },

    get (kind, id) {
      const m = byKind.get(kind)
      const def = m && m.get(id)
      if (!def) {
        const known = m ? [...m.keys()] : []
        throw new Error(`unknown ${kind} ${JSON.stringify(id)}` +
          (m ? didYouMean(String(id), known) : ` — no ${kind} content is registered at all`))
      }
      return def
    },

    /** ALWAYS sorted by id. Frozen, cached, safe to hold. */
    all (kind) {
      let out = sortedCache.get(kind)
      if (!out) {
        const m = byKind.get(kind)
        out = m ? [...m.keys()].sort().map((id) => m.get(id)) : []
        Object.freeze(out)
        sortedCache.set(kind, out)
      }
      return out
    },

    ids (kind) {
      const m = byKind.get(kind)
      return m ? [...m.keys()].sort() : []
    },

    kinds () {
      return [...byKind.keys()].sort()
    },

    count (kind) {
      return kind === undefined
        ? [...byKind.values()].reduce((n, m) => n + m.size, 0)
        : (byKind.get(kind)?.size ?? 0)
    },

    sourceOf (kind, id) {
      return sources.get(kind + '/' + id)
    },

    freeze () {
      frozen = true
      return R
    },

    /**
     * Hash of the whole content set, independent of definition order (invariant §18.6) and of
     * key order inside any def. Same content from packs loaded in any permutation → same hash.
     */
    hash () {
      const parts = []
      for (const kind of R.kinds()) {
        for (const id of R.ids(kind)) parts.push(kind + '/' + id + '=' + stableStringify(R.get(kind, id)))
      }
      return digest(parts.join('\n'))
    }
  }

  return R
}
