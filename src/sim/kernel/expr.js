// Kernel primitive 6 of 7 — the serialisable expression DSL (§11.6).
//
// A tiny s-expression evaluator over JSON arrays. No eval, no new Function, no string parsing at
// runtime. One evaluator for Doctrine rules, ability `when` gates, Pact activation, spawn weights,
// node quotas, shrine offers and Codex triggers — one test suite, one debugger, one syntax the
// player learns once.
//
//   ['and', ['lte', ['hpPct', '$target'], 0.3],
//           ['lt',  ['kinCount', 'Drake'], 4]]
//
// Node grammar:
//   number | boolean | null        literal
//   "$name" | "$name.path"         lookup in ctx.vars (throws if absent — use ['var', …] for optional)
//   "text"                         literal string
//   [formName, ...args]            call
//
// The kernel ships only domain-free forms. Game forms (hpPct, kin, kinCount, coherence, …) are
// registered by the sim layer through `forms.register` — the same door a mod uses (§13.3), which
// is what keeps the kernel free of any knowledge about units.

const isNode = (v) => Array.isArray(v)

/** How many worked sub-expressions one traced evaluation keeps. A rule deeper than this is a rule. */
const MAX_STEPS = 32

export function createForms () {
  /** @type {Map<string, {fn: Function, lazy: boolean, arity: [number, number], src: string}>} */
  const forms = new Map()
  let frozen = false

  const F = {
    /**
     * @param {string} name
     * @param {object} spec
     * @param {Function} spec.fn
     *   Eager forms receive `(args, ctx)` with args already evaluated.
     *   Lazy forms receive `(rawArgs, ctx, ev)` and decide what to evaluate — this is only for
     *   short-circuiting (and / or / if).
     * @param {boolean} [spec.lazy]
     * @param {[number, number|null]} [spec.arity]
     * @param {string} [spec.src]
     * @param {string} [spec.label]   what the editor's dropdown calls it
     * @param {string} [spec.desc]    the one-line description beside it
     * @param {string} [spec.group]   which submenu it sits under
     * @param {{args?: string[], rest?: string, returns?: string}} [spec.sig]
     *   The type signature the editor generates its menus from (§4.1). Because every form is
     *   registered with one, the dropdown at any position *lists exactly the predicates that fit* —
     *   including a mod's, with no UI work. That is the whole payoff of having one evaluator, and
     *   it only works if the signature travels with the registration rather than living in a table
     *   the UI keeps in sync by hand.
     * @param {string} [spec.scope]
     *   Where this form is legal. Absent means everywhere. A form that names a scope is refused by
     *   `validate` anywhere else, which is how §11.6's one deliberate asymmetry is *enforced*
     *   rather than documented: `signalCount` and friends read state from outside a battle, they
     *   are legal in a Precedent's `when`, and they are illegal in an ability's, a Pact's or a
     *   Doctrine rule's. A signal read inside `resolveTick` would make combat depend on save
     *   history, and §18.5's determinism regression would start depending on how much you played.
     */
    register (name, spec) {
      if (frozen) throw new Error(`forms are frozen — cannot register ${name}`)
      if (forms.has(name)) throw new Error(`duplicate expr form ${name} (defined by ${forms.get(name).src})`)
      if (typeof spec.fn !== 'function') throw new Error(`expr form ${name}: fn must be a function`)
      forms.set(name, {
        fn: spec.fn,
        lazy: !!spec.lazy,
        arity: spec.arity ?? [0, null],
        src: spec.src ?? 'core',
        label: spec.label ?? name,
        desc: spec.desc ?? '',
        group: spec.group ?? 'other',
        scope: spec.scope ?? null,
        sig: spec.sig ?? { args: [], rest: 'any', returns: 'any' }
      })
      return F
    },

    has: (name) => forms.has(name),
    names: () => [...forms.keys()].sort(),
    freeze () { frozen = true; return F },
    get frozen () { return frozen },

    /**
     * Attach the editor-facing half of a registration after the fact — label, description, group,
     * type signature. Separate from `register` because the kernel ships the *machinery* for the
     * standard forms and knows nothing about how a person reads them; `sim/content/forms.js` says
     * what they are called (§16.1 puts UI strings in the content layer, not in code).
     *
     * It is also the seam a localisation or relabelling pack would use, since it works on a form
     * somebody else registered.
     */
    describe (name, meta) {
      if (frozen) throw new Error(`forms are frozen — cannot describe ${name}`)
      const form = forms.get(name)
      if (!form) throw new Error(`expr: cannot describe unknown form "${name}"`)
      Object.assign(form, meta)
      return F
    },

    /** One form's registration, minus its implementation. What the editor builds a menu row from. */
    spec (name) {
      const f = forms.get(name)
      if (!f) return null
      const { fn, ...rest } = f
      return { name, ...rest }
    },

    /**
     * Every registered form legal in a scope, sorted by name, as menu rows. A modder's form appears
     * here the moment it is registered — the editor never enumerates a hardcoded list (§4.1).
     *
     * The scope filter is the same rule `validate` enforces, applied one step earlier: a chip the
     * dropdown offers and the validator then refuses is worse than a chip that was never offered.
     */
    list: (scope = null) => [...forms.keys()].sort()
      .filter((n) => !forms.get(n).scope || forms.get(n).scope === scope)
      .map((n) => F.spec(n)),

    /**
     * Evaluate a node. `ctx.vars` holds `$` lookups; `ctx.rng` is a named stream if the expression
     * uses `rand`. Everything else on ctx is whatever the domain forms need.
     */
    eval (node, ctx = {}) {
      return ev(node, ctx)
    },

    /**
     * The same evaluation, keeping every sub-expression's value (§4.1).
     *
     * This is what turns a fire-count badge reading `0` into "`kinCount(Drake)` was 4, not < 4".
     * Steps are collected post-order, so the innermost value is read first and the whole rule reads
     * as a worked example. Short-circuiting is preserved and *visible*: a lazy `and` that stopped
     * at its first false argument leaves the rest out of the list, which is itself the answer.
     *
     * Costs an array and a rendered string per node, so it is only ever called on a sampled
     * evaluation (§`sim/trace.js`), never on the hot path.
     *
     * @returns {{value: *, steps: Array<{text: string, value: *}>}}
     */
    evalTraced (node, ctx = {}) {
      const steps = []
      const value = evT(node, ctx, steps)
      return { value, steps }
    },

    /** A rule rendered as something a person reads: `kinCount(kin($target)) < 3`. */
    text: (node) => exprText(node),

    /**
     * Static check — every form known, arity satisfied, and every form legal where it is written.
     * Run by tools/lint.js so content bugs surface in under a second instead of at tick time.
     *
     * @param {string|null} [scope]  the caller's scope; a scoped form is refused outside it.
     * @returns {string[]} problems, empty when valid
     */
    validate (node, path = '$', scope = null) {
      const errs = []
      walk(node, path, errs, scope)
      return errs
    }
  }

  function ev (node, ctx) {
    if (node === null || typeof node === 'number' || typeof node === 'boolean') return node
    if (typeof node === 'string') return node.charCodeAt(0) === 36 /* $ */ ? lookup(node, ctx) : node
    if (!isNode(node)) throw new Error(`expr: cannot evaluate ${typeof node}`)
    const [name, ...args] = node
    if (typeof name !== 'string') throw new Error(`expr: form name must be a string, got ${JSON.stringify(name)}`)
    const form = forms.get(name)
    if (!form) throw new Error(`expr: unknown form "${name}" — known forms: ${F.names().join(' ')}`)
    checkArity(name, form, args.length)
    return form.lazy ? form.fn(args, ctx, (n) => ev(n, ctx)) : form.fn(args.map((a) => ev(a, ctx)), ctx)
  }

  /** `ev`, plus a post-order record of every call node's value. Same results, same short-circuits. */
  function evT (node, ctx, steps) {
    if (!isNode(node)) return ev(node, ctx)
    const [name, ...args] = node
    if (typeof name !== 'string') throw new Error(`expr: form name must be a string, got ${JSON.stringify(name)}`)
    const form = forms.get(name)
    if (!form) throw new Error(`expr: unknown form "${name}" — known forms: ${F.names().join(' ')}`)
    checkArity(name, form, args.length)
    const value = form.lazy
      ? form.fn(args, ctx, (n) => evT(n, ctx, steps))
      : form.fn(args.map((a) => evT(a, ctx, steps)), ctx)
    if (steps.length < MAX_STEPS) steps.push({ text: exprText(node), value })
    return value
  }

  function walk (node, path, errs, scope) {
    if (!isNode(node)) return
    const [name, ...args] = node
    if (typeof name !== 'string') { errs.push(`${path}: form name must be a string`); return }
    const form = forms.get(name)
    if (!form) { errs.push(`${path}: unknown expr form "${name}"`); return }
    if (form.scope && form.scope !== scope) {
      errs.push(`${path}: form "${name}" is only legal in a ${form.scope} expression, not here`)
    }
    const [min, max] = form.arity
    if (args.length < min || (max !== null && args.length > max)) {
      errs.push(`${path}: form "${name}" takes ${arityText(form.arity)}, got ${args.length}`)
    }
    args.forEach((a, i) => walk(a, `${path}.${name}[${i}]`, errs, scope))
  }

  return F
}

/** Infix rendering for the forms a person already reads as operators. Everything else is a call. */
const INFIX = { lt: '<', lte: '≤', gt: '>', gte: '≥', eq: '=', ne: '≠', add: '+', sub: '−', mul: '×', div: '÷' }
const JOIN = { and: ' AND ', or: ' OR ' }

/** A node as a readable line. Used by the trace popover and by `tools/sim.js`, never by the sim. */
export function exprText (node) {
  if (node === null || node === undefined) return '—'
  if (!isNode(node)) return typeof node === 'string' ? node : JSON.stringify(node)
  const [name, ...args] = node
  if (INFIX[name] && args.length === 2) return `${exprText(args[0])} ${INFIX[name]} ${exprText(args[1])}`
  if (JOIN[name] && args.length > 1) return `(${args.map(exprText).join(JOIN[name])})`
  if (name === 'not' && args.length === 1) return `NOT ${exprText(args[0])}`
  return `${name}(${args.map(exprText).join(', ')})`
}

function arityText ([min, max]) {
  if (max === null) return `at least ${min} args`
  return min === max ? `${min} args` : `${min}–${max} args`
}

function checkArity (name, form, n) {
  const [min, max] = form.arity
  if (n < min || (max !== null && n > max)) {
    throw new Error(`expr: form "${name}" takes ${arityText(form.arity)}, got ${n}`)
  }
}

function lookup (ref, ctx) {
  const parts = ref.slice(1).split('.')
  const vars = ctx.vars ?? {}
  if (!(parts[0] in vars)) {
    throw new Error(`expr: unbound variable ${ref} (bound: ${Object.keys(vars).sort().join(', ') || 'none'})`)
  }
  let v = vars[parts[0]]
  for (let i = 1; i < parts.length && v != null; i++) v = v[parts[i]]
  return v
}

const num = (v, form) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`expr: ${form} expects finite numbers, got ${JSON.stringify(v)}`)
  }
  return v
}

/** The ~30 domain-free built-ins. Registered into a fresh forms registry by `standardForms()`. */
export function registerStandardForms (F) {
  const eager = (name, arity, fn) => F.register(name, { arity, fn })

  // --- logic (lazy where short-circuiting matters) -------------------------------------------
  F.register('and', { arity: [0, null], lazy: true, fn: (a, c, ev) => a.every((n) => truthy(ev(n))) })
  F.register('or', { arity: [0, null], lazy: true, fn: (a, c, ev) => a.some((n) => truthy(ev(n))) })
  F.register('if', { arity: [2, 3], lazy: true, fn: (a, c, ev) => truthy(ev(a[0])) ? ev(a[1]) : (a.length > 2 ? ev(a[2]) : null) })
  eager('not', [1, 1], (a) => !truthy(a[0]))

  // --- comparison ----------------------------------------------------------------------------
  eager('eq', [2, 2], (a) => a[0] === a[1])
  eager('ne', [2, 2], (a) => a[0] !== a[1])
  eager('lt', [2, 2], (a) => num(a[0], 'lt') < num(a[1], 'lt'))
  eager('lte', [2, 2], (a) => num(a[0], 'lte') <= num(a[1], 'lte'))
  eager('gt', [2, 2], (a) => num(a[0], 'gt') > num(a[1], 'gt'))
  eager('gte', [2, 2], (a) => num(a[0], 'gte') >= num(a[1], 'gte'))

  // --- arithmetic ----------------------------------------------------------------------------
  eager('add', [1, null], (a) => a.reduce((x, y) => x + num(y, 'add'), 0))
  eager('sub', [2, 2], (a) => num(a[0], 'sub') - num(a[1], 'sub'))
  eager('mul', [1, null], (a) => a.reduce((x, y) => x * num(y, 'mul'), 1))
  eager('div', [2, 2], (a) => num(a[1], 'div') === 0 ? 0 : num(a[0], 'div') / a[1])
  eager('mod', [2, 2], (a) => num(a[1], 'mod') === 0 ? 0 : num(a[0], 'mod') % a[1])
  eager('min', [1, null], (a) => Math.min(...a.map((v) => num(v, 'min'))))
  eager('max', [1, null], (a) => Math.max(...a.map((v) => num(v, 'max'))))
  eager('clamp', [3, 3], (a) => Math.min(Math.max(num(a[1], 'clamp'), num(a[0], 'clamp')), num(a[2], 'clamp')))
  eager('abs', [1, 1], (a) => Math.abs(num(a[0], 'abs')))
  eager('floor', [1, 1], (a) => Math.floor(num(a[0], 'floor')))
  eager('ceil', [1, 1], (a) => Math.ceil(num(a[0], 'ceil')))
  eager('round', [1, 1], (a) => Math.round(num(a[0], 'round')))
  eager('pow', [2, 2], (a) => Math.pow(num(a[0], 'pow'), num(a[1], 'pow')))

  // --- data ----------------------------------------------------------------------------------
  F.register('lit', { arity: [1, 1], lazy: true, fn: (a) => a[0] })
  F.register('var', {
    arity: [1, 2],
    lazy: true,
    fn: (a, ctx, ev) => {
      const name = String(ev(a[0]))
      const vars = ctx.vars ?? {}
      return name in vars ? vars[name] : (a.length > 1 ? ev(a[1]) : null)
    }
  })
  eager('len', [1, 1], (a) => (a[0]?.length ?? 0))
  eager('at', [2, 2], (a) => (a[0] == null ? null : a[0][a[1]] ?? null))
  eager('includes', [2, 2], (a) => Array.isArray(a[0]) ? a[0].includes(a[1]) : false)
  eager('list', [0, null], (a) => a)

  // --- randomness — always from a named stream, never Math.random (§11.7) ---------------------
  eager('rand', [0, 0], (a, ctx) => requireRng(ctx, 'rand')())
  eager('rand_int', [1, 1], (a, ctx) => requireRng(ctx, 'rand_int').int(num(a[0], 'rand_int')))

  return F
}

function requireRng (ctx, form) {
  if (!ctx.rng) throw new Error(`expr: form "${form}" needs ctx.rng (a named stream, §11.7)`)
  return ctx.rng
}

/** Truthiness is explicit: only false, null, undefined, 0 and '' are false. No empty-array trap. */
function truthy (v) {
  return !(v === false || v === null || v === undefined || v === 0 || v === '')
}

/** Convenience for tests and boot: a forms registry preloaded with the standard set. */
export function standardForms () {
  return registerStandardForms(createForms())
}
