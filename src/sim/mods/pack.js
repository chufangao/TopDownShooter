// One in-memory shape for every pack, whatever it came from (§13.1).
//
//   bundled (import.meta.glob) · dev (vite watch) · user zip → OPFS · remote fetch
//
// All four converge on `{manifest, files: Map<path, string|Uint8Array>}` before the loader sees
// them, so the loader has exactly one input format and knows nothing about zips, OPFS or Vite.

const decoder = new TextDecoder()

/** Glob → RegExp. Supports `*` (within a path segment) and `**` (across segments). */
export function globToRe (glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++ } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + re + '$')
}

/**
 * @param {object} manifest parsed mod.json
 * @param {Map<string, string|Uint8Array>|object} files paths relative to the pack root
 */
export function createPack (manifest, files) {
  const map = files instanceof Map ? files : new Map(Object.entries(files ?? {}))
  const id = manifest?.id

  const P = {
    id,
    manifest,
    files: map,
    paths: () => [...map.keys()].sort(),
    has: (path) => map.has(path),

    text (path) {
      if (!map.has(path)) throw new Error(`pack ${id}: missing file ${path}`)
      const v = map.get(path)
      return typeof v === 'string' ? v : decoder.decode(v)
    },

    json (path) {
      const raw = P.text(path)
      try {
        return JSON.parse(raw)
      } catch (e) {
        // Plain JSON, not JSON5 — a parse error should say where (§16.1, invariant §18.14).
        throw new Error(`pack ${id}: ${path} is not valid JSON — ${e.message}`)
      }
    },

    bytes (path) {
      if (!map.has(path)) throw new Error(`pack ${id}: missing file ${path}`)
      const v = map.get(path)
      return typeof v === 'string' ? new TextEncoder().encode(v) : v
    },

    /** Sorted matches for a glob or list of globs — sorted, so file order never varies by host. */
    match (globs) {
      const list = (Array.isArray(globs) ? globs : [globs]).filter(Boolean)
      if (list.length === 0) return []
      const res = list.map(globToRe)
      return P.paths().filter((p) => res.some((re) => re.test(p)))
    }
  }

  return P
}
