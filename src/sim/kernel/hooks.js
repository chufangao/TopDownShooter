// Kernel primitive 5 of 7 — one hook bus, deterministic order (§11.5).
//
//   bus.on('damage:compute', 'core:scaled_wall', 50, (ev, ctx) => { ev.mul *= 0.8 })
//
// A fixed, documented set of hook points, each with a named mutable **proposal** object. Handlers
// mutate declared fields only (dev builds Proxy-guard the rest). Ordering is (priority,
// subscriberId) — deterministic without depending on subscription order.
//
// The payoff is that seven "systems" collapse into one shape. An item, a status, a Resonance, a
// Pact, a keystone, a shrine curse and a Lattice node are all `{modifiers[], hooks[], when?}`.
// One type, one activation check, one deactivation path, one place to debug — which is why
// Grave Choir and Scaled Wall are data rows and shipping the 30th Pact costs the same as the 12th.

/**
 * Every hook point, with the fields a handler may write. Adding a point is a kernel change on
 * purpose: the set is a contract mods build against, and `api: 1` in a manifest means this list.
 */
export const HOOK_POINTS = {
  'tick:start': [],
  'gauge:fill': ['rate'],
  'action:choose': ['action'],
  'action:chosen': [],
  'target:select': ['targets'],
  'damage:compute': ['add', 'mul', 'crit', 'critMul', 'element', 'pierce'],
  'damage:apply': ['damage', 'absorbed', 'cancel'],
  'status:apply': ['chance', 'dur', 'cancel'],
  'unit:death': ['cancel'],
  'unit:revive': ['hpPct', 'cancel'],
  'persuade:roll': ['chance'],
  'persuade:result': ['success'],
  'battle:start': [],
  'battle:end': [],
  'loot:roll': ['rolls', 'mul'],
  'node:enter': [],
  'floor:end': [],
  'run:end': [],
  'residue:compute': ['add', 'mul']
}

const DEV = globalThis.process?.env?.NODE_ENV !== 'production'

/** In dev, writing an undeclared field on a proposal throws, naming the subscriber. */
function guard (point, proposal, subscriberId) {
  if (!DEV) return proposal
  const allowed = HOOK_POINTS[point]
  return new Proxy(proposal, {
    set (target, key, value) {
      if (!allowed.includes(key)) {
        throw new Error(`${subscriberId} wrote "${String(key)}" on the ${point} proposal — ` +
          `mutable fields are: ${allowed.join(', ') || '(none, this point is read-only)'}`)
      }
      target[key] = value
      return true
    },
    deleteProperty (target, key) {
      throw new Error(`${subscriberId} deleted "${String(key)}" from the ${point} proposal`)
    }
  })
}

export function createHooks () {
  /** @type {Map<string, Array<{id: string, prio: number, fn: Function}>>} */
  const subs = new Map()
  const sorted = new Map()
  let frozen = false

  const H = {
    /**
     * @param {string} point one of HOOK_POINTS
     * @param {string} id    namespaced subscriber id — also the tiebreaker, so it must be unique-ish
     * @param {number} prio  lower runs first
     * @param {(proposal, ctx) => void} fn
     */
    on (point, id, prio, fn) {
      if (frozen) throw new Error(`hooks are frozen — cannot subscribe ${id} to ${point}`)
      if (!(point in HOOK_POINTS)) {
        throw new Error(`unknown hook point ${JSON.stringify(point)} — known points: ${Object.keys(HOOK_POINTS).join(' ')}`)
      }
      if (typeof id !== 'string' || !id) throw new Error(`hook on ${point}: subscriber id is required`)
      if (typeof fn !== 'function') throw new Error(`hook ${id} on ${point}: handler must be a function`)
      if (!subs.has(point)) subs.set(point, [])
      subs.get(point).push({ id, prio: prio ?? 0, fn })
      sorted.delete(point)
      return H
    },

    freeze () { frozen = true; return H },
    get frozen () { return frozen },
    has: (point) => (subs.get(point)?.length ?? 0) > 0,
    subscribers: (point) => order(point).map((s) => s.id),
    count: () => [...subs.values()].reduce((n, a) => n + a.length, 0),

    /**
     * Run every handler for `point` against a mutable proposal. Returns the proposal, so callers
     * read the negotiated result: `const ev = hooks.emit('damage:compute', {mul: 1, add: 0}, ctx)`.
     */
    emit (point, proposal, ctx) {
      if (DEV && !(point in HOOK_POINTS)) throw new Error(`unknown hook point ${point}`)
      const list = order(point)
      for (let i = 0; i < list.length; i++) {
        const s = list[i]
        s.fn(DEV ? guard(point, proposal, s.id) : proposal, ctx)
      }
      return proposal
    }
  }

  /** (priority, subscriberId) — a total order that never depends on subscription order. */
  function order (point) {
    let list = sorted.get(point)
    if (!list) {
      list = (subs.get(point) ?? []).slice().sort((a, b) => (a.prio - b.prio) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      Object.freeze(list)
      sorted.set(point, list)
    }
    return list
  }

  return H
}
