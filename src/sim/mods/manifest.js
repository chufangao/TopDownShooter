// Manifest validation and load order (§13.1).
//
// A mod declaring an api we don't support is disabled with a readable message rather than
// crashing the game — mods failing gracefully is the difference between a modding scene and a bug
// tracker full of our name.
//
// Load order is a topological sort by requires/loadAfter with ties broken by id, so it is total
// and reproducible. Combined with `registry.all()` sorting by id (§11.1), that is what makes
// invariant §18.6 (load in any permutation → identical registry hash) hold.

/** The kernel contract version. Bumped when HOOK_POINTS, op signatures or the pack shape change. */
export const API_VERSION = 1

const PACK_ID_RE = /^[a-z0-9_]+$/
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/

export function parseVersion (v) {
  const m = VERSION_RE.exec(String(v ?? ''))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/**
 * Range check. Supports `*`, `1.2.3`, `^1.2`, `~1.2.3`, `>=1.2`. Deliberately small — a full
 * semver implementation is a dependency we do not need to decide "can this pack load".
 */
export function satisfies (version, range) {
  const r = String(range ?? '*').trim()
  if (r === '*' || r === '') return true
  const v = parseVersion(version)
  if (!v) return false
  const op = /^[~^]|^>=|^<=|^>|^</.exec(r)?.[0] ?? ''
  const wanted = (r.slice(op.length).trim() + '.0.0').split('.').slice(0, 3).map(Number)
  const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0 }
  switch (op) {
    case '^': return v[0] === wanted[0] && cmp(v, wanted) >= 0
    case '~': return v[0] === wanted[0] && v[1] === wanted[1] && cmp(v, wanted) >= 0
    case '>=': return cmp(v, wanted) >= 0
    case '>': return cmp(v, wanted) > 0
    case '<=': return cmp(v, wanted) <= 0
    case '<': return cmp(v, wanted) < 0
    default: return cmp(v, wanted) === 0
  }
}

const STRING_ARRAY_KEYS = ['content', 'patches', 'scripts', 'loadAfter', 'loadBefore']

/** @returns {string[]} problems, empty when the manifest is usable */
export function validateManifest (m, where = 'mod.json') {
  if (m === null || typeof m !== 'object') return [`${where}: must be a JSON object`]
  const errs = []
  if (typeof m.id !== 'string' || !PACK_ID_RE.test(m.id)) {
    errs.push(`${where}: id ${JSON.stringify(m.id)} must match /^[a-z0-9_]+$/ — it is the namespace of every id in the pack`)
  }
  if (typeof m.name !== 'string' || !m.name) errs.push(`${where}: name is required`)
  if (!parseVersion(m.version)) errs.push(`${where}: version ${JSON.stringify(m.version)} must be MAJOR.MINOR.PATCH`)
  if (!Number.isInteger(m.api)) errs.push(`${where}: api must be an integer (current: ${API_VERSION})`)
  for (const k of STRING_ARRAY_KEYS) {
    if (m[k] !== undefined && (!Array.isArray(m[k]) || m[k].some((s) => typeof s !== 'string'))) {
      errs.push(`${where}: ${k} must be an array of strings`)
    }
  }
  if (m.requires !== undefined && (m.requires === null || typeof m.requires !== 'object' || Array.isArray(m.requires))) {
    errs.push(`${where}: requires must be an object of {packId: versionRange}`)
  }
  if (m.art !== undefined && (m.art === null || typeof m.art !== 'object')) {
    errs.push(`${where}: art must be an object of {descriptors, baked}`)
  }
  return errs
}

/**
 * Resolve load order.
 * @param {Array<{manifest: object}>} packs
 * @returns {{order: string[], disabled: Array<{id, reason}>, errors: string[]}}
 */
export function resolveLoadOrder (packs, { api = API_VERSION } = {}) {
  const byId = new Map()
  const disabled = []
  const errors = []

  for (const p of packs) {
    const m = p.manifest
    if (byId.has(m.id)) { errors.push(`two packs both claim the id "${m.id}"`); continue }
    if (m.api > api) {
      disabled.push({ id: m.id, reason: `needs api ${m.api}, this build provides ${api} — update the game` })
      continue
    }
    byId.set(m.id, m)
  }

  // Requirements. A pack whose dependency is missing or too old is disabled, not fatal — and so
  // is anything that depended on it, transitively.
  let changed = true
  while (changed) {
    changed = false
    for (const [id, m] of [...byId]) {
      for (const [dep, range] of Object.entries(m.requires ?? {})) {
        const have = byId.get(dep)
        if (!have) {
          byId.delete(id)
          disabled.push({ id, reason: `requires "${dep}" ${range}, which is not loaded` })
          changed = true
          break
        }
        if (!satisfies(have.version, range)) {
          byId.delete(id)
          disabled.push({ id, reason: `requires "${dep}" ${range}, found ${have.version}` })
          changed = true
          break
        }
      }
    }
  }

  // Edges: dep → dependent. loadAfter/loadBefore are soft — they name packs that may be absent.
  const ids = [...byId.keys()].sort()
  const edges = new Map(ids.map((id) => [id, new Set()]))
  const addEdge = (from, to) => { if (byId.has(from) && byId.has(to) && from !== to) edges.get(from).add(to) }
  for (const id of ids) {
    const m = byId.get(id)
    for (const dep of Object.keys(m.requires ?? {}).sort()) addEdge(dep, id)
    for (const dep of [...(m.loadAfter ?? [])].sort()) addEdge(dep, id)
    for (const dep of [...(m.loadBefore ?? [])].sort()) addEdge(id, dep)
  }

  // Kahn's algorithm, always taking the alphabetically-first ready pack: a total, reproducible order.
  const indeg = new Map(ids.map((id) => [id, 0]))
  for (const [, outs] of edges) for (const to of outs) indeg.set(to, indeg.get(to) + 1)
  const ready = ids.filter((id) => indeg.get(id) === 0)
  const order = []
  while (ready.length) {
    ready.sort()
    const id = ready.shift()
    order.push(id)
    for (const to of [...edges.get(id)].sort()) {
      indeg.set(to, indeg.get(to) - 1)
      if (indeg.get(to) === 0) ready.push(to)
    }
  }
  if (order.length !== ids.length) {
    const cycle = ids.filter((id) => !order.includes(id)).sort()
    errors.push(`load order cycle between packs: ${cycle.join(', ')}`)
  }

  return { order, disabled: disabled.sort((a, b) => (a.id < b.id ? -1 : 1)), errors }
}
