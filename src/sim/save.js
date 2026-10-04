// Save, load, and the repair pass (§14).
//
// `save.js` is `JSON.stringify` plus a version stamp. That is not modesty about the file — it is
// the payoff of two decisions made in the kernel: instances hold a `defId` string rather than an
// object reference, and the registry is frozen before the first tick (§11.1, §11.2). Between them
// there is no serialiser to maintain, no cycles to break, and no object graph to walk.
//
// What this file actually owns is the three things that are *not* free:
//
//   1. the version stamp and the migration chain (`migrations.js`)
//   2. `contentHash`, so removing a mod produces a report rather than a crash
//   3. the repair pass, which resolves orphaned ids through each kind's `orphanPolicy`
//
// Removing a mod must never brick a save. That alone decides whether anyone is willing to try one,
// which makes it a moddability feature wearing a persistence feature's clothes.
//
// ★ **What persists, and the open question it answers** (§19 open question 6). Units are collected
// permanently; levels are not. The profile owns a `collection` of unit ids — who is allowed to turn
// up at all, which is what Codex spends buy — and a run assembles fresh instances from it. So the
// Codex unlocks *who can appear* and the run decides *who gets strong*. The alternative, a roster
// that levels forever across runs, makes the roguelite frame of §1 decorative: there is nothing at
// stake in a wipe if the party walks away with its levels.
//
// Pure JS. No clock, no Math.random, no Phaser, no localStorage — a host passes storage in.

import { MIGRATIONS, SAVE_VERSION, migrate } from './migrations.js'
import { DEFAULT_DOCTRINE, normalize } from './doctrine.js'
import { insightFrom } from './economy.js'
import { STARTING_PARTY } from './run.js'
import { createLedger } from './signals.js'

export { SAVE_VERSION, MIGRATIONS }

/** Everything that outlives a run (§5). A run is the other half, and it is allowed to be null. */
export function newProfile ({ starters = STARTING_PARTY, doctrine = DEFAULT_DOCTRINE } = {}) {
  return {
    collection: [...starters].sort(),
    codex: [],
    residue: 0,
    lifetimeResidue: 0,
    insight: 0,
    prestiges: 0,
    /** Lattice node id → ranks. Empty until M5; the field exists so M5 costs no migration. */
    lattice: {},
    doctrine: normalize(doctrine),
    /**
     * Tenets bought with Codex (§4.2). On the profile rather than only inside the Doctrine because
     * a purchase outlives any particular Doctrine — you may rewrite every rule you own and you have
     * still bought the right to write them. `doctrine.tenets` is the copy a run reads; this is the
     * copy the shop spends against, and `bankRun` keeps them the same.
     */
    tenets: [],
    /**
     * The profile half of the signal ledger (§4.3): lifetime counters, the last payload per signal,
     * and which dispatches have been seen. Run and battle scopes are derived and are not here.
     *
     * This is the determinism cost §4.3 names out loud and accepts: a save now carries counters, a
     * migration has to know about them, and the fuzzer has one more thing that can differ between
     * two runs of "the same" seed. The rule that makes it safe is the one enforced in
     * `signals.js` and by invariant §18.16 — nothing inside `resolveTick` may read any of it.
     */
    signals: { counts: {}, answered: [] }
  }
}

/** A ledger restored from a loaded profile — the one way a run gets its lifetime counters back. */
export const ledgerFor = (profile) => createLedger(profile?.signals ?? null)

/**
 * Fold a finished run's payout into the profile (§5, loop B → loop C).
 *
 * Codex is a set, not a counter: the second Bone Chanter you recruit pays nothing, which is what
 * makes it a record of discovery rather than something to farm. Insight is recomputed from lifetime
 * Residue rather than accumulated, so it can never drift from its own definition.
 *
 * @param {object} banked  an `endRun()` result
 * @returns {{profile, gainedResidue, gainedCodex: string[], collected: string[]}}
 */
export function bankRun (profile, banked, tuning, { collected = [] } = {}) {
  const gainedCodex = banked.codex.filter((k) => !profile.codex.includes(k))
  const fresh = collected.filter((id) => !profile.collection.includes(id))

  profile.residue += banked.residue
  profile.lifetimeResidue += banked.residue
  profile.insight = insightFrom(profile.lifetimeResidue, tuning)
  profile.codex = [...profile.codex, ...gainedCodex].sort()
  profile.collection = [...profile.collection, ...fresh].sort()

  return { profile, gainedResidue: banked.residue, gainedCodex, collected: fresh }
}

/** Who a run may recruit from, and who it may start with (§5 — Codex unlocks the pool). */
export const collectionOf = (profile) => [...(profile?.collection ?? STARTING_PARTY)].sort()

// ── writing ─────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {object} opts.kernel
 * @param {object} opts.profile
 * @param {object|null} [opts.run]  a live run controller, or null between runs
 * @param {object|null} [opts.signals]  the live ledger, if the host holds one apart from the
 *   profile. Stamped over `profile.signals` so there is exactly one authority for it at rest.
 * @returns {object} plain JSON — ids and numbers only, no object references
 */
export function saveGame ({ kernel, profile, run = null, mods = [], signals = null }) {
  if (signals) profile = { ...profile, signals: signals.save() }
  return {
    v: SAVE_VERSION,
    contentHash: kernel.registry.hash(),
    mods: mods.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    // The instancer's uid counter is save state. Renumbering instances on load would make a replay
    // diverge from the run it replays, and would silently re-point every uid the save carries.
    uid: kernel.defs.snapshot().uid,
    state: {
      profile,
      // `floor` and `route` are excluded on purpose: both regenerate from (seed, floorNum), so
      // persisting them would store a derivation and invite it to drift from the generator.
      run: run ? { ...run.state } : null
    }
  }
}

export const serialize = (save) => JSON.stringify(save)

// ── reading ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Load a save, migrate it forward, and repair whatever the current content set no longer knows.
 *
 * Never throws on damaged or foreign content — the whole point is that a save survives a mod being
 * removed. It throws only on a save from a *newer* build, where loading would mean silently
 * dropping fields this build cannot see.
 *
 * @returns {{profile, run: object|null, report: {migrated: number[], contentChanged: boolean,
 *   dropped: Array<{what, id, policy}>, notes: string[]}}}
 */
export function loadGame (save, { kernel, tuning }) {
  const report = { migrated: [], contentChanged: false, dropped: [], notes: [] }
  if (!save || typeof save !== 'object') {
    report.notes.push('no save found — starting fresh')
    return { profile: newProfile(), run: null, report }
  }

  const { state, applied } = migrate(save)
  report.migrated = applied

  const hash = kernel.registry.hash()
  if (save.contentHash && save.contentHash !== hash) {
    // A *Content changed* report, not a crash (§14). The repair pass below decides what that
    // actually costs, and the host shows the difference before the player commits to it.
    report.contentChanged = true
    report.notes.push(`content changed since this save (${save.contentHash} → ${hash})`)
  }

  kernel.defs.restore({ uid: Math.max(1, save.uid ?? 1) })

  const profile = repairProfile(state?.profile, kernel, report, tuning)
  const run = repairRun(state?.run, kernel, report)
  return { profile, run, report }
}

export const deserialize = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ── the repair pass ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve an orphaned id through its kind's declared policy (§11.2, §14).
 *
 * The policy is declared once, on the kind, rather than decided here per call site — so a mod that
 * registers a whole new content kind gets a repair story for free, and the answer to "what happens
 * to my mounts if I remove the mount mod" is one word in that mod's own registration.
 */
function orphan (kernel, kind, id, report, what) {
  const policy = kernel.defs.hasKind(kind) ? kernel.defs.orphanPolicy(kind, id) : (kernel.registry.has(kind, id) ? null : 'drop')
  if (!policy) return null
  report.dropped.push({ what, id, policy })
  return policy
}

function repairProfile (raw, kernel, report, tuning) {
  const profile = { ...newProfile(), ...(raw && typeof raw === 'object' ? raw : {}) }

  profile.collection = collectionOf(profile).filter((id) => !orphan(kernel, 'unit', id, report, 'collected unit'))
  if (profile.collection.length === 0) {
    // Never hand back a profile that cannot start a run. Losing every collected unit means the pack
    // that provided them is gone, and an empty collection is a save that loads and then does
    // nothing — which reads to a player exactly like a corrupt one.
    profile.collection = STARTING_PARTY.filter((id) => kernel.registry.has('unit', id))
    report.notes.push('every collected unit came from content that is no longer installed — ' +
      'the collection has been reset to whatever this build ships')
  }

  // Codex keys name content too, but a lost one is not repaired: it is a record that something
  // happened, and a mod being reinstalled should find its discoveries waiting rather than re-earned.
  profile.codex = [...new Set(profile.codex ?? [])].sort()
  profile.doctrine = normalize(profile.doctrine)

  // A ledger round-trips through its own constructor rather than being trusted as it arrives, so a
  // hand-edited save cannot put a string where a counter goes and have a Precedent's `when` throw
  // three nodes into the next run. Answered ids for Precedents that no longer exist are kept: the
  // pack may come back, and re-asking a question the player already answered is worse than carrying
  // a dead id (the same argument the Codex makes two lines up).
  profile.signals = createLedger(profile.signals).save()

  // A tenet whose pack is gone is dropped rather than refunded: Codex is a count of discoveries and
  // is not a balance you hold, so there is nothing to give back. Reinstalling the pack finds the
  // purchase waiting, because the id stays in the Doctrine's own list.
  profile.tenets = [...new Set(profile.tenets ?? [])].filter((id) => kernel.registry.has('tenet', id)).sort()
  profile.doctrine.tenets = profile.tenets.slice()
  profile.residue = Math.max(0, Math.round(profile.residue ?? 0))
  profile.lifetimeResidue = Math.max(profile.residue, Math.round(profile.lifetimeResidue ?? 0))
  profile.insight = insightFrom(profile.lifetimeResidue, tuning)
  return profile
}

function repairRun (raw, kernel, report) {
  if (!raw || typeof raw !== 'object') return null
  const run = { ...raw }

  run.roster = (raw.roster ?? []).filter((u) => !orphan(kernel, 'unit', u.defId, report, 'party unit'))
  // Statuses are dropped rather than substituted: a status is a temporary thing by construction, and
  // the worst case is a unit that stops being Brittle a few seconds early.
  for (const u of run.roster) {
    u.statuses = (u.statuses ?? []).filter((s) => kernel.registry.has('status', s.id))
    u.branch = (u.branch ?? []).filter((id) => kernel.registry.has('branch', id))
  }

  if (run.roster.length === 0 && (raw.roster ?? []).length > 0) {
    run.over = true
    run.reason = 'content-changed'
    report.notes.push('the whole party came from content that is no longer installed — ' +
      'the run in progress has been ended rather than resumed with nobody in it')
  }
  return run
}
