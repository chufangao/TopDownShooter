// Currencies (§5) — what a run pays out, and what a losing run still moves forward.
//
// Four currencies with four different jobs, and the one that matters most is the one §5 mentioned
// once and never explained:
//
//   Coin      in-run only            shops, rerolls, revives          not banked
//   Residue   run end, depth × coherence   Lattice nodes, respecs     banked
//   Insight   prestige only          global multipliers               forever
//   Codex     a COUNT OF DISCOVERIES not a resource you farm          forever
//
// Codex exists because it is the only currency a losing run reliably produces. A run that wipes on
// floor 2 having talked two new species into the party still moved something forward, and without
// that the early game is a sequence of runs that produced literally nothing. It is deliberately not
// farmable: the second Bone Chanter you recruit pays no Codex, so it rewards breadth exactly once
// and then stops.
//
// Every constant is in `tuning.json` (§16.1). Pure JS — no clock, no Math.random, no Phaser.

import { coherence } from './synergy.js'

/** What one floor is worth before coherence and the multipliers (§5). */
export const floorResidue = (floor, tuning) =>
  tuning.residue.floorBase * Math.pow(tuning.residue.floorGrowth, floor - 1)

/**
 * Residue for a run, summed over every floor reached.
 *
 * Summed rather than "the deepest floor's value", because a sum makes a deeper run worth strictly
 * more than a shallower one *and* pays for the floors a wipe got through. Taking only the deepest
 * would make floors 1–4 of a floor-5 run literally worthless, which is a strange thing to tell a
 * player about the twenty minutes they just spent.
 *
 * The `residue:compute` hook is where a keystone, a Lattice node or a Dissonance node moves it, so
 * nothing else in the game needs to know this function exists (§11.5).
 *
 * @param {object} opts
 * @param {number} opts.floors     deepest floor reached
 * @param {number} opts.coherence  0…1 (§3)
 * @param {object} [opts.hooks]    the kernel bus, if the run has one
 */
export function runResidue ({ floors, coherence: coh, tuning, hooks = null, ctx = null }) {
  let base = 0
  for (let f = 1; f <= floors; f++) base += floorResidue(f, tuning)

  const proposal = { add: 0, mul: 1 + tuning.residue.coherenceBonus * clamp01(coh) }
  hooks?.emit('residue:compute', proposal, ctx ?? {})
  return Math.max(0, Math.round((base + proposal.add) * proposal.mul))
}

/** Prestige currency (§5). Deliberately a hard floor of a square root: it moves slowly, on purpose. */
export const insightFrom = (lifetimeResidue, tuning) =>
  Math.floor(Math.sqrt(Math.max(0, lifetimeResidue) / tuning.insight.divisor))

/** Coin from a finished battle: what died, scaled by depth. Not banked — it dies with the run. */
export function battleCoin (registry, battle, floor, tuning) {
  const c = tuning.coin
  let total = 0
  for (const u of battle.units) {
    // A recruit pays no Coin. You did not take its things; it is standing in your formation.
    if (u.side !== 'foe' || u.hp > 0) continue
    total += c.perFoeTier * (registry.get('unit', u.defId).tier ?? 1)
  }
  return Math.round(total * (1 + c.perFloor * (floor - 1)))
}

/** Coin from a treasure node, on the same depth curve so one deep chest beats three shallow ones. */
export const treasureCoin = (floor, tuning) =>
  Math.round(tuning.coin.treasure * (1 + tuning.coin.perFloor * (floor - 1)))

// ── Codex ───────────────────────────────────────────────────────────────────────────────────────

/**
 * What a finished battle discovered, as stable string keys.
 *
 * Keys rather than counters because a discovery is a *set membership* question — "have I ever" —
 * and a counter would need deduplicating against history at every call site. The profile owns the
 * set; this function only reports candidates, and reports the same one every time it happens.
 *
 * @returns {string[]} sorted, deduplicated
 */
export function discoveriesFrom (registry, result) {
  const found = new Set()

  for (const u of result.state.units) {
    if (u.side !== 'foe') continue
    const def = registry.get('unit', u.defId)
    if (def.boss && u.hp <= 0) found.add(`boss:${def.id}`)
  }
  for (const uid of result.state.recruited) {
    const u = result.state.units.find((x) => x.uid === uid)
    if (u) found.add(`recruit:${u.defId}`)
  }
  // Pacts are read off the opening `battle:start` event, which is the one place the sim states
  // which synergies were live. A Pact that only came online mid-fight — after a death dropped a
  // count, say — is not credited. That is a known and deliberate under-count: crediting it would
  // mean either a second event or state the battle does not otherwise carry, and the honest
  // version of "you have seen this Pact" is "it was in force when the fight started".
  for (const ev of result.events) {
    if (ev.type !== 'battle:start') continue
    for (const s of ev.synergies ?? []) {
      if (s.kind === 'pact' && s.side === 'party') found.add(`pact:${s.id}`)
    }
  }

  return [...found].sort()
}

/** Which of a run's discoveries the profile has never seen. `null` profile means "all of them". */
export const newDiscoveries = (discovered, profile = null) =>
  discovered.filter((k) => !profile?.codex?.includes(k))

// ── run end ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Close a run out and report what it banked (§5, loop B → loop C).
 *
 * Called once, by whoever owns the run — `tools/sim.js`, the Worker, the scene. It does not touch a
 * profile: banking is a save-layer concern (§14), and keeping the calculation separate from the
 * persistence is what lets the post-mortem's counterfactual (§4.2) re-sim a run and price it
 * without writing anything.
 *
 * @returns {{floors, coherence, residue, coin, codex: string[], reason}}
 */
export function endRun (run, { profile = null } = {}) {
  const { kernel, tuning, state } = run
  const coh = coherence(kernel.registry, state.roster)

  const residue = runResidue({
    floors: state.deepest,
    coherence: coh,
    tuning,
    hooks: kernel.hooks,
    ctx: { registry: kernel.registry, tuning, run: { floor: state.deepest } }
  })

  return {
    floors: state.deepest,
    coherence: coh,
    residue,
    coin: state.coin ?? 0,
    codex: newDiscoveries(state.discovered ?? [], profile),
    reason: state.reason ?? 'cleared'
  }
}

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
