// Kernel primitive 4 of 7 — effect verbs, the primary extension seam (§11.4).
//
// An ability is not code. It is a `when` gate, a targeting shape, and an ordered list of effects,
// each naming a registered op:
//
//   { id: 'core:marrow_bolt', castCost: 100, shape: 'single', element: 'dark',
//     effects: [ { op: 'core:damage', power: 34, element: 'dark' },
//                { op: 'core:apply_status', status: 'core:brittle', dur: 6, chance: 0.35 } ] }
//
// A modder authoring 30 units writes zero JavaScript — they recombine ops. A modder who genuinely
// needs a new verb registers one op, and targeting, animation, the timeline and the balance
// harness all work on it immediately.
//
// Args are validated at LOAD time against the op's schema, never at tick time.

import { assertId, ID_RE } from './registry.js'

/** Built-in arg types. `ops.registerType` adds more — that is how `element` gets its values. */
const BASE_TYPES = {
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  int: (v) => Number.isInteger(v),
  string: (v) => typeof v === 'string',
  boolean: (v) => typeof v === 'boolean',
  id: (v) => typeof v === 'string' && ID_RE.test(v),
  expr: () => true,          // shape-checked by forms.validate, not here
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  any: () => true
}

function parseSpec (spec) {
  if (typeof spec === 'string') {
    const optional = spec.endsWith('?')
    return { type: optional ? spec.slice(0, -1) : spec, optional }
  }
  return { optional: false, ...spec }
}

export function createOps () {
  /** @type {Map<string, {schema: object, run: Function, src: string}>} */
  const ops = new Map()
  const types = { ...BASE_TYPES }
  let frozen = false

  const O = {
    /** Add an arg type, e.g. `registerType('element', v => ELEMENTS.has(v))`. */
    registerType (name, check) {
      if (frozen) throw new Error(`ops are frozen — cannot register type ${name}`)
      types[name] = check
      return O
    },

    /**
     * @param {string} id namespaced, e.g. 'core:damage'
     * @param {{schema?: object, run: Function, src?: string}} spec
     *   `run(ctx, args, actor, targets)` — uses ctx.rng, ctx.emit, ctx.hooks. Returns nothing;
     *   everything it does to the world goes through ctx.
     */
    register (id, spec) {
      if (frozen) throw new Error(`ops are frozen — cannot register ${id} (registration is load-time only)`)
      assertId(id, 'op id')
      if (ops.has(id)) throw new Error(`duplicate op ${id} (defined by ${ops.get(id).src})`)
      if (typeof spec.run !== 'function') throw new Error(`op ${id}: run must be a function`)
      const schema = spec.schema ?? {}
      for (const [key, s] of Object.entries(schema)) {
        const { type } = parseSpec(s)
        if (!types[type]) throw new Error(`op ${id}: arg "${key}" has unknown type "${type}"`)
      }
      ops.set(id, { schema, run: spec.run, src: spec.src ?? id.slice(0, id.indexOf(':')) })
      return O
    },

    has: (id) => ops.has(id),
    ids: () => [...ops.keys()].sort(),
    count: () => ops.size,
    freeze () { frozen = true; return O },
    get frozen () { return frozen },

    get (id) {
      const op = ops.get(id)
      // The sim must never run content it doesn't understand — unknown op is a hard error (§13.4).
      if (!op) throw new Error(`unknown op ${JSON.stringify(id)} — registered ops: ${O.ids().join(' ')}`)
      return op
    },

    /**
     * Load-time validation of one effect entry. @returns {string[]} problems.
     * Also fills nothing in — defaults are applied by `argsFor` at run time so defs stay authored.
     */
    validate (effect, where = 'effect') {
      if (effect === null || typeof effect !== 'object') return [`${where}: must be an object`]
      const id = effect.op
      if (typeof id !== 'string') return [`${where}: missing "op"`]
      const op = ops.get(id)
      if (!op) return [`${where}: unknown op "${id}"`]
      const errs = []
      for (const [key, rawSpec] of Object.entries(op.schema)) {
        const spec = parseSpec(rawSpec)
        const v = effect[key]
        if (v === undefined) {
          if (!spec.optional && spec.default === undefined) errs.push(`${where} (${id}): missing arg "${key}"`)
          continue
        }
        if (!types[spec.type](v)) errs.push(`${where} (${id}): arg "${key}" should be ${spec.type}, got ${JSON.stringify(v)}`)
        if (spec.min !== undefined && v < spec.min) errs.push(`${where} (${id}): arg "${key}" below min ${spec.min}`)
        if (spec.max !== undefined && v > spec.max) errs.push(`${where} (${id}): arg "${key}" above max ${spec.max}`)
      }
      for (const key of Object.keys(effect)) {
        if (key !== 'op' && key !== '_note' && !(key in op.schema)) {
          errs.push(`${where} (${id}): unknown arg "${key}" — schema has ${Object.keys(op.schema).sort().join(', ') || 'no args'}`)
        }
      }
      return errs
    },

    /** Effect entry → args object with schema defaults applied. */
    argsFor (effect) {
      const op = O.get(effect.op)
      const args = {}
      for (const [key, rawSpec] of Object.entries(op.schema)) {
        const spec = parseSpec(rawSpec)
        args[key] = effect[key] !== undefined ? effect[key] : spec.default
      }
      return args
    },

    /** Look up, apply defaults, run. `resolve.js` does nothing else with abilities. */
    run (effect, ctx, actor, targets) {
      const op = O.get(effect.op)
      return op.run(ctx, O.argsFor(effect), actor, targets)
    }
  }

  return O
}
