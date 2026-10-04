// A small JSON Schema validator — enough of draft 2020-12 to check our content files, and zero
// dependencies (§15.3 sets the tone: `npm ci`-clean, no native build step).
//
// Supported: type, const, enum, required, properties, additionalProperties, patternProperties,
// propertyNames, items, minItems, maxItems, minimum, maximum, exclusiveMinimum, exclusiveMaximum,
// pattern, allOf, oneOf, anyOf, not, and local $ref ("#/$defs/x").
//
// Unsupported keywords are ignored rather than guessed at: a linter that invents rules is worse
// than one that checks fewer of them.

const typeOf = (v) => {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (Number.isInteger(v)) return 'integer'
  return typeof v
}

const typeMatches = (v, t) => {
  const actual = typeOf(v)
  if (t === 'number') return actual === 'number' || actual === 'integer'
  return actual === t
}

function deref (schema, root) {
  let s = schema
  let guard = 0
  while (s && typeof s.$ref === 'string' && guard++ < 32) {
    const path = s.$ref.replace(/^#\//, '').split('/')
    let node = root
    for (const seg of path) node = node?.[seg.replace(/~1/g, '/').replace(/~0/g, '~')]
    if (!node) return s
    const { $ref, ...rest } = s
    s = { ...node, ...rest }
  }
  return s
}

/**
 * @returns {string[]} problems, empty when valid
 */
export function validate (value, schema, { root = schema, path = '' } = {}) {
  const errs = []
  const s = deref(schema, root)
  if (!s || typeof s !== 'object') return errs
  const at = path || '(root)'

  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type]
    if (!types.some((t) => typeMatches(value, t))) {
      errs.push(`${at}: expected ${types.join(' or ')}, got ${typeOf(value)}`)
      return errs
    }
  }
  if (s.const !== undefined && JSON.stringify(value) !== JSON.stringify(s.const)) {
    errs.push(`${at}: must be ${JSON.stringify(s.const)}`)
  }
  if (s.enum !== undefined && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errs.push(`${at}: must be one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}`)
  }

  if (typeof value === 'string') {
    if (s.pattern !== undefined && !new RegExp(s.pattern).test(value)) {
      errs.push(`${at}: ${JSON.stringify(value)} does not match /${s.pattern}/`)
    }
    if (s.minLength !== undefined && value.length < s.minLength) errs.push(`${at}: shorter than ${s.minLength}`)
  }

  if (typeof value === 'number') {
    if (s.minimum !== undefined && value < s.minimum) errs.push(`${at}: ${value} < minimum ${s.minimum}`)
    if (s.maximum !== undefined && value > s.maximum) errs.push(`${at}: ${value} > maximum ${s.maximum}`)
    if (s.exclusiveMinimum !== undefined && value <= s.exclusiveMinimum) errs.push(`${at}: ${value} must exceed ${s.exclusiveMinimum}`)
    if (s.exclusiveMaximum !== undefined && value >= s.exclusiveMaximum) errs.push(`${at}: ${value} must be under ${s.exclusiveMaximum}`)
  }

  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) errs.push(`${at}: needs at least ${s.minItems} items`)
    if (s.maxItems !== undefined && value.length > s.maxItems) errs.push(`${at}: allows at most ${s.maxItems} items`)
    if (s.items) value.forEach((v, i) => errs.push(...validate(v, s.items, { root, path: `${at}[${i}]` })))
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of s.required ?? []) {
      if (!(key in value)) errs.push(`${at}: missing required property "${key}"`)
    }
    const props = s.properties ?? {}
    const patterns = Object.entries(s.patternProperties ?? {})
    for (const [key, v] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key
      if (s.propertyNames) errs.push(...validate(key, s.propertyNames, { root, path: `${at} key "${key}"` }))
      if (props[key]) {
        errs.push(...validate(v, props[key], { root, path: childPath }))
        continue
      }
      const pat = patterns.find(([re]) => new RegExp(re).test(key))
      if (pat) { errs.push(...validate(v, pat[1], { root, path: childPath })); continue }
      if (s.additionalProperties === false) errs.push(`${at}: unknown property "${key}"`)
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
        errs.push(...validate(v, s.additionalProperties, { root, path: childPath }))
      }
    }
  }

  for (const sub of s.allOf ?? []) errs.push(...validate(value, sub, { root, path }))
  if (s.anyOf && !s.anyOf.some((sub) => validate(value, sub, { root, path }).length === 0)) {
    errs.push(`${at}: matches none of the allowed shapes`)
  }
  if (s.oneOf && s.oneOf.filter((sub) => validate(value, sub, { root, path }).length === 0).length !== 1) {
    errs.push(`${at}: must match exactly one of the allowed shapes`)
  }
  if (s.not && validate(value, s.not, { root, path }).length === 0) errs.push(`${at}: matches a forbidden shape`)

  return errs
}
