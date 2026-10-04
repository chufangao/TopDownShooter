// The trait engine (§3) — tag counting, and the one activation check every synergy shares.
//
// Three layers of synergy sit on top of two tag axes:
//
//   Resonance  automatic, threshold-driven      `Ranger 3` → back row ignores the melee penalty
//   Pact       named, cross-axis, discoverable  `Fae 4 + Trickster 2` → Glamour
//   Coherence  tag-concentration entropy        multiplies Residue (§5)
//
// Resonance and Pact are the SAME kind of object — `{when, modifiers[], hooks[]}` — and this file
// is the only place either is activated. That is the M2 gate: if a Pact needed a line of code a
// Resonance did not, then shipping the 30th Pact would cost more than the 12th, and a mod's Pact
// would be a second-class citizen (§11.5).
//
// Pure JS. Reads defs and living units; touches nothing else.

/** Synergies count DISTINCT units holding a tag, never stacks or copies (§3). */
export function tagCounts (registry, units) {
  const kin = new Map()
  const role = new Map()
  for (const u of units) {
    const def = registry.get('unit', u.defId)
    kin.set(def.kin, (kin.get(def.kin) ?? 0) + 1)
    role.set(def.role, (role.get(def.role) ?? 0) + 1)
  }
  return { kin, role }
}

/** Both synergy kinds, in one list, sorted by id — activation order can never depend on load order. */
export function synergyDefs (registry) {
  return [...registry.all('resonance'), ...registry.all('pact')]
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * @param {object} ctx      needs `registry`, `forms`, `tuning`
 * @param {Array}  units    the living units of one side
 * @returns {Array} active `{id, kind, modifiers, hooks}` rows, sorted by id
 */
export function activeSynergies (ctx, units) {
  const vars = { vars: {}, registry: ctx.registry, rng: ctx.rng, party: units, enemies: [], t: ctx.battle?.t ?? 0 }
  const active = []
  for (const def of synergyDefs(ctx.registry)) {
    // One `when` expression, one evaluator, for both kinds. No special cases anywhere.
    if (def.when && !ctx.forms.eval(def.when, vars)) continue
    active.push({
      id: def.id,
      kind: ctx.registry.has('pact', def.id) ? 'pact' : 'resonance',
      name: def.name,
      modifiers: def.modifiers ?? [],
      hooks: def.hooks ?? []
    })
  }
  return active
}

/**
 * Coherence: how concentrated the party's tags are, 0 (perfectly spread) to 1 (monobuild).
 * Normalised Shannon entropy, inverted — so it does not reward simply having fewer units.
 * High coherence multiplies Residue; the Lattice sells Dissonance nodes that pay for breadth (§5).
 */
export function coherence (registry, units) {
  if (units.length < 2) return 1
  const { kin, role } = tagCounts(registry, units)
  const score = (counts) => {
    const n = units.length
    const distinct = counts.size
    if (distinct <= 1) return 1
    let h = 0
    for (const c of counts.values()) {
      const p = c / n
      h -= p * Math.log(p)
    }
    return 1 - h / Math.log(distinct)
  }
  return (score(kin) + score(role)) / 2
}

/** Human-readable tag line for the HUD and the post-mortem: "Undead 3 · Channeler 2". */
export function tagSummary (registry, units) {
  const { kin, role } = tagCounts(registry, units)
  const parts = []
  for (const [map, kind] of [[kin, 'kin'], [role, 'role']]) {
    for (const [id, n] of [...map].sort()) {
      if (n < 2) continue
      parts.push(`${registry.get(kind, id).name} ${n}`)
    }
  }
  return parts
}
