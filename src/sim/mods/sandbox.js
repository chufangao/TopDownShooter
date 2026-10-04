// Tier 3 — the script sandbox (§13.3).
//
//   export default function ({ ops, hooks, forms, registry, log, rng }) {
//     ops.register('kindled:ignite', { schema: {...}, run (ctx, args, actor, targets) {...} })
//     hooks.on('damage:compute', 'kindled:pyre', 60, (ev, ctx) => { ... })
//   }
//
// This is a COOPERATIVE sandbox. It makes accidental sim corruption nearly impossible while making
// no claim to resist a hostile mod — that is the honest tradeoff for local JS mods, and the
// modding docs say so plainly rather than implying a security boundary.
//
// What it does enforce, and why:
//   * every registration is namespaced to the pack, so a mod cannot squat `core:` ids
//   * registration only during load — after freeze, register throws
//   * Math.random / Date.now / new Date / performance.now throw *inside mod code*, including inside
//     handlers the mod registered. Silent nondeterminism is otherwise undebuggable; this turns it
//     into an error naming the mod.
//   * the mod sees only its own RNG stream (§11.7)

const denied = (what, packId) => () => {
  throw new Error(`${packId} called ${what} — mod code must draw from its own rng stream (§13.3). ` +
    'Nondeterminism here would change every player\'s run in a way nobody could reproduce.')
}

/**
 * Wrap a mod-supplied callback so the nondeterminism traps are installed for its whole call,
 * however deep. Nesting is safe: the inner wrapper restores whatever it found.
 */
export function guardDeterminism (packId, fn) {
  return function guarded (...args) {
    const realRandom = Math.random
    const realNow = Date.now
    const realDate = globalThis.Date
    const perf = globalThis.performance
    const realPerfNow = perf?.now

    Math.random = denied('Math.random', packId)
    Date.now = denied('Date.now', packId)
    globalThis.Date = new Proxy(realDate, {
      construct: denied('new Date()', packId),
      apply: denied('Date()', packId)
    })
    if (perf && realPerfNow) perf.now = denied('performance.now', packId)

    try {
      return fn.apply(this, args)
    } finally {
      Math.random = realRandom
      Date.now = realNow
      globalThis.Date = realDate
      if (perf && realPerfNow) perf.now = realPerfNow
    }
  }
}

/** Read-only view of the registry — scripts extend behaviour, content comes from JSON. */
function readOnlyRegistry (registry) {
  return Object.freeze({
    get: (kind, id) => registry.get(kind, id),
    has: (kind, id) => registry.has(kind, id),
    all: (kind) => registry.all(kind),
    ids: (kind) => registry.ids(kind),
    kinds: () => registry.kinds()
  })
}

/**
 * @param {object} kernel
 * @param {string} packId
 * @param {{log?: Function}} opts
 * @returns {object} the frozen `api` object a script receives
 */
export function createModApi (kernel, packId, { log = () => {} } = {}) {
  const own = (id, what) => {
    if (typeof id !== 'string' || !id.startsWith(packId + ':')) {
      throw new Error(`${packId} tried to register ${what} "${id}" — must be namespaced "${packId}:…"`)
    }
    return id
  }

  return Object.freeze({
    packId,

    ops: Object.freeze({
      register (id, spec) {
        own(id, 'op')
        return kernel.ops.register(id, { ...spec, src: packId, run: guardDeterminism(packId, spec.run) })
      },
      has: (id) => kernel.ops.has(id),
      ids: () => kernel.ops.ids()
    }),

    hooks: Object.freeze({
      on (point, id, prio, fn) {
        own(id, 'hook subscriber')
        return kernel.hooks.on(point, id, prio, guardDeterminism(packId, fn))
      }
    }),

    forms: Object.freeze({
      register (name, spec) {
        own(name, 'expr form')
        return kernel.forms.register(name, { ...spec, src: packId, fn: guardDeterminism(packId, spec.fn) })
      },
      has: (name) => kernel.forms.has(name)
    }),

    registry: readOnlyRegistry(kernel.registry),

    /** The mod's own stream, and no other. */
    rng: kernel.rng.stream('mod:' + packId),

    log: (...args) => log(`[${packId}]`, ...args)
  })
}

/**
 * Run one pack's script module.
 * @param {object} mod the imported module — its default export is called with the api
 */
export function runScript (mod, api, packId, path) {
  const fn = mod?.default ?? mod
  if (typeof fn !== 'function') {
    throw new Error(`${packId}: ${path} must default-export a function taking the api object`)
  }
  guardDeterminism(packId, fn)(api)
}
