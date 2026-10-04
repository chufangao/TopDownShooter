// Spawn tables and depth scaling (§6.2) — which foes a floor fields, and at what level.
//
// This used to be twelve lines inside `party.js` that weighted every unit in the registry by how
// close its tier was to the floor. That worked, and it was a §12 violation in slow motion: a pack
// could ship a unit but could not say *where* it appears, so the one thing content most obviously
// wants to control lived in code. The unit schema had reserved a `spawn` block since K1 and nothing
// read it — dead data, which §19's debt 0 names as the failure mode that hides longest.
//
// Two mechanisms, and the split is deliberate:
//
//   a unit's own `spawn` block   "here is where I show up"      — one file per unit, still
//   a `spawn` table def          "here is what this depth is"   — themed pools, per-floor
//
// A table's rows and the wildcard pool ADD, never override, and a unit's weight is the sum of every
// row naming it. Summing is not laziness: it is commutative, so no pack load order can change what
// spawns, which is invariant §18.6 holding somewhere it would otherwise be very easy to break.
//
// Pure JS. No clock, no Math.random, no Phaser.

/** Foe level by depth (§6.2) — the curve `progression.js` has to keep pace with. */
export function foeLevel (floor, tuning) {
  const s = tuning.spawn
  return Math.max(1, Math.round(1 + (floor - 1) * s.levelPerFloor))
}

/** The tier a floor is aiming at. Tables may offer anything; this is what the shaping favours. */
export function targetTier (floor, tuning) {
  const s = tuning.spawn
  return Math.min(s.tierMax, 1 + Math.floor((floor - 1) * s.tierPerFloor))
}

/**
 * Every unit that could appear on a floor, with its resolved weight.
 *
 * @param {object} kernel
 * @param {object} opts
 * @param {number} opts.floor
 * @param {object} opts.tuning
 * @param {boolean} [opts.boss]   draw from boss units instead of ordinary ones (§6.3)
 * @param {object} [opts.bias]    Kin → multiplier, the Lattice's Bias nodes (§5)
 * @returns {Array<{def: object, w: number}>} sorted by id, never empty unless nothing matches
 */
export function spawnPool (kernel, { floor, tuning, boss = false, bias = null }) {
  const R = kernel.registry
  const vars = exprVars(kernel, floor)
  const weights = new Map()

  const add = (unitId, w) => {
    if (!(w > 0) || !R.has('unit', unitId)) return
    const def = R.get('unit', unitId)
    if (!!def.boss !== boss) return
    weights.set(unitId, (weights.get(unitId) ?? 0) + w)
  }

  for (const table of R.all('spawn')) {
    const [from, to] = table.floors
    if (floor < from || floor > to) continue
    if (table.when && !kernel.forms.eval(table.when, vars)) continue

    if (table.units === '*') {
      for (const def of R.all('unit')) {
        const s = def.spawn
        if (!s) continue
        if (s.floors && (floor < s.floors[0] || floor > s.floors[1])) continue
        if (s.when && !kernel.forms.eval(s.when, vars)) continue
        add(def.id, s.weight ?? 1)
      }
    }

    for (const row of table.weights ?? []) {
      if (row.when && !kernel.forms.eval(row.when, vars)) continue
      add(row.unit, row.w ?? R.get('unit', row.unit).spawn?.weight ?? 1)
    }
  }

  // Depth shaping, applied once at the end rather than per table, so a themed pool cannot
  // accidentally opt out of it. A flat draw put two tier-3 Drakes in the first encounter of floor 1
  // and wiped a level-2 party before it could talk to anything (§6.2).
  const target = targetTier(floor, tuning)
  const s = tuning.spawn
  const out = []
  for (const [id, w] of [...weights].sort()) {
    const def = R.get('unit', id)
    // A hard ceiling one tier above the floor's target, then a steep falloff inside it. Bosses skip
    // the shaping entirely: a boss is chosen because the floor called for it, not because its tier
    // happened to land near the band.
    if (!boss) {
      if (def.tier > target + s.tierOverCap) continue
      out.push({ def, w: w / Math.pow(1 + Math.abs(def.tier - target), s.tierFalloff) * biasFor(bias, def) })
    } else {
      out.push({ def, w: w * biasFor(bias, def) })
    }
  }
  return out.filter((e) => e.w > 0)
}

/**
 * Draw `size` units from the floor's pool.
 *
 * @returns {string[]} unit def ids, with repeats — a pack of four of the same thing is a real
 *   encounter, and de-duplicating here would quietly make swarms impossible to author.
 */
export function pickSpawns (kernel, rng, { floor, tuning, size = 3, boss = false, bias = null }) {
  const pool = spawnPool(kernel, { floor, tuning, boss, bias })
  if (!pool.length) {
    throw new Error(`no ${boss ? 'boss' : 'unit'} can spawn on floor ${floor} — ` +
      'every spawn table missed. Check floors[] ranges in packs/*/content/spawn.json')
  }
  const defs = pool.map((e) => e.def)
  const weights = pool.map((e) => e.w)
  return Array.from({ length: size }, () => rng.weighted(defs, weights).id)
}

/**
 * The variables a spawn expression sees. Deliberately thin — a spawn weight is a statement about
 * *depth*, and giving it the party would make what spawns depend on what you recruited, which is a
 * feedback loop nobody asked for and every balance sweep would have to model.
 */
function exprVars (kernel, floor) {
  return {
    vars: { floor },
    registry: kernel.registry,
    rng: kernel.rng,
    party: [],
    enemies: [],
    t: 0,
    run: { floor }
  }
}

/** Bias nodes (§5) multiply a Kin's weight — the bridge between the Lattice and the roster. */
const biasFor = (bias, def) => (bias?.[def.kin] ?? 1)
