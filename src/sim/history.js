// The runs played in this browser, newest first, the last HISTORY_CAP of them, beside running totals of every run kept.
// Pure: main.js keeps the book's text in prefs ('history'); a book that does not read is read as far as it holds.
//   book   { v, total: { runs, clears, best, time }, runs: [entry, …] }; best: the highest ascension cleared (−1: none)
//   entry  { id, at, seed, ascension, monarch?, end, cleared, floor, room, fell?, wins, fights, army, time }
//     id: the run's own (main.js), so a run cleared then fallen is one line; at, time: when it ended, its play time (ms)
//     end: 'cleared', 'fell' or 'left' (for a new run); room: the rank of the room it stood in (0: the floor's start)
//     fell: { by: a kind | null, threat | null }; army: { kinds: [{ id, n }] (the three most held), fused, kin | null }
import { unitDef } from '../content.js'
import { currentNode, souls } from './run.js'

const HISTORY_VERSION = 1
export const HISTORY_CAP = 100

// ── a run's line ─────────────────────────────────────────────────────────────────────────────────

// The line a run ends with (over, or left under way); `id`, `at`, `time` are what main.js knows and the run does not.
export function recordOf (run, { id, at = Date.now(), time = 0 } = {}) {
  const s = run.state
  const cleared = s.result === 'victory'
  const end = s.phase !== 'over' ? 'left' : s.death ? 'fell' : 'cleared'
  const entry = {
    id: id ?? `${s.seed}@${at}`,
    at,
    seed: s.seed,
    ascension: s.ascension ?? 0,
    end,
    cleared,
    floor: s.floor,
    room: s.map ? currentNode(run)?.rank ?? 0 : 0,
    wins: s.stats.wins,
    fights: s.stats.fights,
    army: armyOf(s),
    time: Math.max(0, Math.round(time))
  }
  if (s.monarch) entry.monarch = s.monarch
  if (end === 'fell') entry.fell = { by: s.death.by ?? null, threat: s.death.threat ?? null }
  return entry
}

// The souls a run holds, as a line keeps them (the entry's `army`).
export function armyOf (s) {
  const held = souls(s.party).map((u) => u.id)
  const count = (key) => {
    const n = new Map()
    for (const id of held) { const k = key(id); if (k) n.set(k, (n.get(k) ?? 0) + 1) }
    return n
  }
  const tier = (id) => unitDef(id).tier
  const kinds = [...count((id) => id)].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n || tier(b.id) - tier(a.id) || (a.id < b.id ? -1 : 1))
  const fused = [...new Set(held.filter((id) => unitDef(id).fused))].sort((a, b) => tier(b) - tier(a) || (a < b ? -1 : 1))
  const kin = [...count((id) => unitDef(id).kin)].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null
  return { kinds: kinds.slice(0, 3), fused, kin }
}

// ── the book ─────────────────────────────────────────────────────────────────────────────────────

const EMPTY = () => ({ runs: 0, clears: 0, best: -1, time: 0 })
const count = (x) => Number.isInteger(x) && x >= 0
const isTotal = (t) => !!t && count(t.runs) && count(t.clears) && t.clears <= t.runs && Number.isInteger(t.best) && t.best >= -1 && count(t.time)
// Whether a kept line reads as one: what the History screen draws from it, each of its kind.
export function isEntry (e) {
  return !!e && typeof e === 'object' && typeof e.id === 'string' && typeof e.seed === 'string' && Number.isFinite(e.at) &&
    ['cleared', 'fell', 'left'].includes(e.end) && typeof e.cleared === 'boolean' && count(e.ascension) && count(e.floor) &&
    count(e.room) && count(e.wins) && count(e.fights) && count(e.time) && !!e.army && Array.isArray(e.army.kinds) && Array.isArray(e.army.fused)
}

// The totals of the lines `runs` alone (a book whose totals do not read).
export function totalOf (runs) {
  const t = EMPTY()
  for (const e of runs) add(t, e, 1)
  return t
}
function add (t, e, sign) {
  t.runs += sign
  t.clears += sign * e.cleared
  t.time += sign * e.time
  if (sign > 0 && e.cleared) t.best = Math.max(t.best, e.ascension)
}

// The book kept as `text` (prefs 'history'), read as far as it holds: an empty one for none.
export function readBook (text) {
  let b = null
  try { b = JSON.parse(text ?? '') } catch {}
  const runs = (Array.isArray(b?.runs) ? b.runs.filter(isEntry) : []).slice(0, HISTORY_CAP)
  // Totals that hold fewer runs than the lines kept, or any that do not read, are counted again from the lines.
  const ok = isTotal(b?.total) && b.total.runs >= runs.length && b.total.clears >= runs.filter((e) => e.cleared).length
  return { v: HISTORY_VERSION, total: ok ? { ...b.total } : totalOf(runs), runs }
}

// The book with `entry` kept: the same id's line brought up to date and to the top, the oldest past `cap` let go.
export function withRun (book, entry, cap = HISTORY_CAP) {
  const total = { ...book.total }
  const before = book.runs.find((e) => e.id === entry.id)
  if (before) add(total, before, -1)
  add(total, entry, 1)
  return { v: HISTORY_VERSION, total, runs: [entry, ...book.runs.filter((e) => e.id !== entry.id)].slice(0, cap) }
}
