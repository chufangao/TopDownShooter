// The expression chip editor (§4.1) — how a person actually edits an expression tree.
//
// > Rules are rows; expressions are inline chips. A rule reads left to right as
// > `IF ⟨chip⟩ ⟨chip⟩ THEN ⟨action⟩`, where each chip is a dropdown over the forms that are *legal
// > in that position*. There is no free-text parser and no blank canvas. The player builds
// > `['lte', ['hpPct','$target'], 0.3]` by picking `hp%` → `≤` → dragging a slider, and never sees
// > a bracket. The tree is the storage format, not the interface.
//
// And the half that makes it worth building this way rather than as a form per editor:
//
// > Availability is discovered by exhaustion, not documentation. Because every form is registered
// > with a type signature, the dropdown at any position is *generated* — it lists exactly the
// > predicates that fit, including a mod's, with a one-line description.
//
// So there is no list of predicates in this file. Every menu comes from `kernel.forms.list()`, and
// a pack that registers a form gets an editor entry for it with no UI work at all. That is the
// entire payoff of §11.6's "one evaluator", collected here.

import { el, select } from './dom.js'

/** What a literal of each type starts life as when the player picks "a value". */
const LITERAL = { number: 0, bool: true, string: '', tag: null, list: ['list'], any: 0, unit: null }

/** Forms a person already reads as operators, rendered between their two arguments. */
const INFIX = new Set(['lt', 'lte', 'gt', 'gte', 'eq', 'ne', 'add', 'sub', 'mul', 'div'])

/** Whether a form returning `returns` may sit in a position that wants `want`. */
const fits = (returns, want) => want === 'any' || returns === 'any' || returns === want

/**
 * @param {object} opts
 * @param {object} opts.kernel
 * @param {Array<{id, label, desc, type}>} opts.vars  the `$` names legal in this editor
 * @param {object} [opts.cap]  what the player bought (§4.2). A form no tenet granted is not in the
 *   menu at all — which is how a freshly-bought Parley threshold offers two chips instead of thirty,
 *   and why "too many knobs to reasonably choose between" is now a function of what you paid for.
 * @param {Function} opts.onChange  called with the rewritten tree whenever anything changes
 */
export function createExprEditor ({ kernel, vars = [], cap = null, onChange }) {
  const forms = kernel.forms
  const R = kernel.registry

  /** Kin, Role and element ids, labelled by name — every `tag` position draws from these. */
  const tagOptions = () => [
    ...R.all('kin').map((d) => ({ value: d.id, label: d.name, group: 'Kin' })),
    ...R.all('role').map((d) => ({ value: d.id, label: d.name, group: 'Role' })),
    ...R.all('element').map((d) => ({ value: d.id, label: d.name ?? d.id, group: 'Element' }))
  ]

  const specOf = (name) => forms.spec(name)

  /** The static type of a node, so a sibling position can be typed from it (see `eq` below). */
  function typeOf (node) {
    if (Array.isArray(node)) return specOf(node[0])?.sig?.returns ?? 'any'
    if (typeof node === 'string' && node.startsWith('$')) return vars.find((v) => v.id === node)?.type ?? 'any'
    if (typeof node === 'number') return 'number'
    if (typeof node === 'boolean') return 'bool'
    return 'string'
  }

  function defaultFor (type) {
    if (type === 'unit') return vars[0]?.id ?? '$target'
    if (type === 'tag') return R.all('kin')[0]?.id ?? ''
    return LITERAL[type] ?? 0
  }

  /** A freshly chosen form, filled with placeholder arguments of the right shape. */
  function build (name) {
    const spec = specOf(name)
    if (!spec) return name
    const [min] = spec.arity
    const args = (spec.sig.args ?? []).map(defaultFor)
    while (args.length < min) args.push(defaultFor(spec.sig.rest ?? 'any'))
    return [name, ...args]
  }

  /**
   * Render one position. `want` is the type the position accepts — it is what filters the menu, and
   * it is the only reason a player never sees a nonsensical option.
   */
  function chip (node, want, replace) {
    const wrap = el('span', { class: 'expr' })
    const current = Array.isArray(node) ? `form:${node[0]}`
      : (typeof node === 'string' && node.startsWith('$')) ? `var:${node}`
        : 'lit'

    const options = []
    for (const v of vars) {
      if (fits(v.type, want)) options.push({ value: `var:${v.id}`, label: v.label, title: v.desc, group: 'the fight' })
    }
    if (want !== 'unit') {
      options.push({ value: 'lit', label: want === 'bool' ? 'always' : 'value', title: 'A fixed value you type in.', group: 'the fight' })
    }
    for (const spec of forms.list()) {
      if (!fits(spec.sig?.returns ?? 'any', want)) continue
      if (cap && !cap.hasForm(spec.name, spec.group)) continue
      options.push({
        value: `form:${spec.name}`,
        label: spec.label ?? spec.name,
        // A mod's form is indistinguishable from ours here except for this suffix, which is the
        // point: it arrived through the same registration and reads the same in the menu.
        title: (spec.desc ?? '') + (spec.src && spec.src !== 'core' ? `  [${spec.src}]` : ''),
        group: spec.group ?? 'other'
      })
    }

    const picker = select(options, current, (value) => {
      if (value === 'lit') return replace(defaultFor(want === 'any' ? 'number' : want))
      if (value.startsWith('var:')) return replace(value.slice(4))
      replace(build(value.slice(5)))
    }, {
      title: describe(node),
      // A literal's picker only ever displays a short word, so it can be narrow and leave the room
      // to the value itself. It still carries the whole menu — that is how you switch away from one.
      className: 'chip' + (current === 'lit' ? ' narrow' : '')
    })

    if (!Array.isArray(node)) {
      wrap.appendChild(picker)
      if (current === 'lit') wrap.appendChild(literal(node, want, replace))
      return wrap
    }

    const spec = specOf(node[0])
    const rest = node.slice(1)

    // A comparison reads as one sentence when the operator sits between its two sides —
    // `tier(the enemy) ≥ 3` rather than `≥ · tier(the enemy) · 3`. §4.1 asks for a rule that reads
    // left to right, and for the six forms a person already reads as operators, this is that.
    if (spec && INFIX.has(node[0]) && rest.length === 2) {
      wrap.appendChild(argChip(node, 0, replace))
      wrap.appendChild(picker)
      wrap.appendChild(argChip(node, 1, replace))
      return wrap
    }

    wrap.appendChild(picker)
    if (!spec) return wrap

    // Everything else brackets its arguments, so a nested rule stays legible once it wraps.
    const [min, max] = spec.arity
    const declared = spec.sig.args ?? []
    const restType = spec.sig.rest ?? 'any'
    const grouped = rest.length > 1

    // A variadic predicate — `ALL of` and `ANY of`, and whatever a mod registers with the same
    // shape — puts each clause on its own line. Two comparisons side by side wrap into a shape
    // that reads as one long condition rather than as two, which is the opposite of what an
    // ordered, first-match rule set is trying to make obvious.
    const stack = grouped && restType === 'bool'
    const host = stack ? el('span', { class: 'rows' }) : wrap

    if (grouped) wrap.appendChild(el('span', { class: 'paren', text: '(' }))
    if (stack) wrap.appendChild(host)

    rest.forEach((_, i) => {
      const row = stack ? el('span', { class: 'expr' }) : host
      if (i > 0 && grouped && !stack) host.appendChild(el('span', { class: 'paren', text: '·' }))
      row.appendChild(argChip(node, i, replace))
      if (rest.length > min && (declared.length === 0 || i >= declared.length)) {
        row.appendChild(el('button', {
          class: 'more', text: '×', title: 'remove this one',
          onclick: () => replace([node[0], ...rest.filter((_, j) => j !== i)])
        }))
      }
      if (stack) host.appendChild(row)
    })

    if (max === null || rest.length < max) {
      host.appendChild(el('button', {
        class: 'more', text: '+', title: 'add another',
        onclick: () => replace([...node, defaultFor(declared[rest.length] ?? restType)])
      }))
    }
    if (grouped) wrap.appendChild(el('span', { class: 'paren', text: ')' }))

    return wrap
  }

  /** One argument of a call node, typed from the signature — or from its sibling, see below. */
  function argChip (node, i, replace) {
    const spec = specOf(node[0])
    const rest = node.slice(1)
    const declared = spec.sig.args ?? []
    let want = declared[i] ?? spec.sig.rest ?? 'any'

    // `eq`/`ne` compare two things of the same kind, and their declared signature cannot say which.
    // Typing each side from its sibling is what turns `enemy Kin = ⟨…⟩` into a dropdown of actual
    // Kin instead of a number box — and that rule is §4's own headline example.
    if (want === 'any' && rest.length === 2) {
      const sibling = typeOf(rest[1 - i])
      if (sibling !== 'any') want = sibling
    }

    return chip(rest[i], want, (next) => {
      const copy = node.slice()
      copy[i + 1] = next
      replace(copy)
    })
  }

  /** A typed input for a literal — a number box, a tag dropdown, a true/false. Never a parser. */
  function literal (node, want, replace) {
    if (want === 'tag') {
      return select(tagOptions(), typeof node === 'string' ? node : '', replace, { title: 'a Kin, Role or element' })
    }
    if (want === 'bool') {
      return select(
        [{ value: 'true', label: 'always' }, { value: 'false', label: 'never' }],
        node === false ? 'false' : 'true',
        (v) => replace(v === 'true'),
        { title: 'A rule with no condition. Put it last — anything after it is unreachable.' }
      )
    }
    if (want === 'string') {
      return el('input', {
        class: 'chip wide', type: 'text', value: node ?? '',
        oninput: (e) => replace(e.target.value)
      })
    }
    return el('input', {
      class: 'chip', type: 'number', step: 'any', value: Number(node) || 0,
      oninput: (e) => replace(e.target.value === '' ? 0 : Number(e.target.value))
    })
  }

  const describe = (node) => (Array.isArray(node) ? specOf(node[0])?.desc ?? '' : '')

  return {
    /** @returns {HTMLElement} the whole tree as a row of chips */
    render (node, want = 'bool') {
      return chip(node, want, (next) => onChange(next))
    },
    typeOf,
    build
  }
}
