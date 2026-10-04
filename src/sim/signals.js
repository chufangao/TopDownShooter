// The signal ledger (§4.3) — what a Precedent watches.
//
// A Precedent's `when` needs to ask *how many times did X happen*, and nothing in the sim could
// answer that. The seam existed and was never built: `emit_signal` was one of §11.4's ~20 core ops
// and the only one on that list with no stated consumer. This is its consumer.
//
//   signals.emit('recruit:missed', { defId, hpPct })   // counted, scoped, ordered
//
// It is deliberately NOT an event log. A Precedent needs "three times" and "the last one was a
// Frost Sprite" and nothing more, so this is counters plus a small ring of recent payloads. Three
// planned systems collapse onto it rather than each growing their own privately: §4.4's fire counts
// (`trace.js` counts rule firings today), §4.5's post-mortem attribution, and §5's Codex, which is a
// signal ledger with a threshold of one.
//
// ★ **The one rule, and it is an invariant (§18.16): a signal may never be read by anything inside
// `resolveTick`.** Precedents read signals; combat does not. Profile-scoped counters persist (§14),
// so a save carries them — and without that line the ledger would become a hidden input to the sim,
// at which point §18.5's determinism regression would start passing or failing according to how
// much you had played. Emission is safe in either direction; reading is what is banned.
//
// Pure JS. No clock, no Math.random, no Phaser.

/** Counters exist at three scopes. Only `profile` is save state; the other two are derived. */
export const SCOPES = ['battle', 'run', 'profile']

/** How many recent payloads each name keeps. Enough for "the last one was a Frost Sprite". */
export const RING = 6

/**
 * The signals core emits, and what each payload carries. A pack emits its own through its own
 * namespace — `kindled:ignite:cast` — so a pack's Precedent can watch a pack's signal with no core
 * change (§4.3). Documented here rather than in a schema because a signal name is not content: it
 * is a fact about what the sim noticed, and the ledger accepts any name at all.
 */
export const CORE_SIGNALS = Object.freeze({
  'recruit:missed': 'a foe fell below the persuade threshold and died without ever being approached',
  'recruit:failed': 'a persuade attempt was spent and did not land',
  'recruit:joined': 'a foe was talked round and joined the party',
  'recruit:declined': 'a recruit was refused because the party was full and nothing could be cut',
  'recruit:cut': 'a unit was dropped to make room for a recruit',
  'ally:down': 'a party unit died in a battle',
  'ally:down_front': 'a party unit died standing further forward than its Role would place it',
  'battle:won': 'a battle ended with the party standing',
  'battle:lost': 'a battle ended with the party down',
  'boss:felled': 'a boss was killed',
  'floor:cleared': 'the party took the stairs off a floor',
  'descend:wounded': 'the party descended below half health with no campfire behind it',
  'unit:levelled': 'a unit gained a level',
  'unit:branch': 'a unit took a branch choice at level 5 or 10 (§3)',
  'run:end': 'a run ended, however it ended'
})

/**
 * @param {object} [saved]  a `ledger.save()` result — profile-scoped counters and answered
 *   Precedents, the only two halves that outlive a session.
 * @returns {object} the ledger
 */
export function createLedger (saved = null) {
  /** @type {Record<string, Map<string, number>>} scope → name → count */
  const counts = {
    battle: new Map(),
    run: new Map(),
    profile: new Map(Object.entries(saved?.counts ?? {}).filter(([, n]) => Number.isFinite(n)))
  }
  /**
   * name → the last RING payloads, oldest first.
   *
   * The *most recent* payload per name is save state alongside the profile counters, and the rest
   * is not. That asymmetry was found by playing it: a card gated on a lifetime count ("two of your
   * units have gone down at the front") fires on a fresh session, at which point a run-scoped ring
   * has nothing in it and the body reads "the last was —, a —". A counter that outlives a run and a
   * payload that does not are not two independent decisions — the sentence needs both.
   */
  const ring = new Map(Object.entries(saved?.last ?? {}).map(([name, payload]) => [name, [payload]]))

  /** Precedents already answered, and therefore spent at `once: 'profile'`. Save state. */
  const answered = new Set(saved?.answered ?? [])
  /** Raised this run — the cap and the "a Precedent that can fire twice a run will" rule (§4.1). */
  let raised = new Set()
  /** Answered during this run, for `once: 'run'`. */
  let answeredThisRun = new Set()

  const L = {
    /**
     * Record one occurrence. Never throws and never validates the name: a pack's signal is a string
     * in the pack's own namespace, and a ledger that rejected unknown names would need a registry of
     * them, which is a content kind nobody would ever author.
     */
    emit (name, payload = null) {
      if (typeof name !== 'string' || !name) return L
      for (const scope of SCOPES) counts[scope].set(name, (counts[scope].get(name) ?? 0) + 1)
      if (payload !== null && payload !== undefined) {
        const list = ring.get(name) ?? []
        list.push(payload)
        if (list.length > RING) list.shift()
        ring.set(name, list)
      }
      return L
    },

    /** @param {'battle'|'run'|'profile'} [scope] */
    count: (name, scope = 'run') => counts[scope]?.get(name) ?? 0,

    /** The most recent payload for a name, or null. "The last one was a Frost Sprite." */
    last: (name) => {
      const list = ring.get(name)
      return list?.length ? list[list.length - 1] : null
    },

    recent: (name) => (ring.get(name) ?? []).slice(),

    beginBattle () { counts.battle.clear(); return L },

    /**
     * A new run clears the run and battle scopes, the ring, and the raised set — which is what makes
     * "expire anything older than a run" (§4.1) free rather than a sweep with a timestamp in it.
     * `answered` survives, because `once: 'profile'` is the whole reason it is save state.
     */
    beginRun () {
      counts.run.clear()
      counts.battle.clear()
      // The ring collapses to its last entry rather than clearing, for the reason above: a card
      // gated on a lifetime count still has to be able to name the last one.
      for (const [name, list] of ring) ring.set(name, list.slice(-1))
      raised = new Set()
      answeredThisRun = new Set()
      return L
    },

    // ── Precedent bookkeeping (§4.1) ────────────────────────────────────────────────────────────

    /** Whether a Precedent has already been offered this run — one card per run, always. */
    wasRaised: (id) => raised.has(id),
    markRaised (id) { raised.add(id); return L },

    /** Whether the player has taken a position on it, at the scope the Precedent declared. */
    wasAnswered: (id, once = 'profile') => (once === 'run' ? answeredThisRun.has(id) : answered.has(id)),
    markAnswered (id, once = 'profile') {
      answeredThisRun.add(id)
      if (once !== 'run') answered.add(id)
      return L
    },

    // ── persistence (§14) ───────────────────────────────────────────────────────────────────────

    /**
     * The save half. Sorted on the way out so two saves of the same state are the same string —
     * the same reason `registry.all()` sorts, one layer down.
     */
    save () {
      const out = {}
      for (const name of [...counts.profile.keys()].sort()) out[name] = counts.profile.get(name)
      const last = {}
      for (const name of [...ring.keys()].sort()) {
        const payload = L.last(name)
        if (payload !== null) last[name] = payload
      }
      return { counts: out, answered: [...answered].sort(), last }
    },

    /** Everything, for a debug view and for the post-mortem at M5. Copies; safe to call freely. */
    snapshot () {
      const out = { battle: {}, run: {}, profile: {}, recent: {} }
      for (const scope of SCOPES) {
        for (const name of [...counts[scope].keys()].sort()) out[scope][name] = counts[scope].get(name)
      }
      for (const name of [...ring.keys()].sort()) out.recent[name] = ring.get(name).slice()
      return out
    }
  }

  return L
}

/**
 * A ledger that swallows everything, for the callers that have no profile to write into — the
 * fuzzer, the balance harness, a battle in a test. Cheaper than threading `?.` through every call
 * site, and it makes "no ledger" and "an unread ledger" the same code path.
 */
export const NULL_LEDGER = Object.freeze({
  emit: () => NULL_LEDGER,
  count: () => 0,
  last: () => null,
  recent: () => [],
  beginBattle: () => NULL_LEDGER,
  beginRun: () => NULL_LEDGER,
  wasRaised: () => false,
  markRaised: () => NULL_LEDGER,
  wasAnswered: () => false,
  markAnswered: () => NULL_LEDGER,
  save: () => ({ counts: {}, answered: [] }),
  snapshot: () => ({ battle: {}, run: {}, profile: {}, recent: {} })
})

/**
 * ★ The write-only face of the ledger handed to a battle (§4.3, invariant §18.16).
 *
 * `emit_signal` is an op, so content can raise a signal from inside a fight — that half is fine and
 * intended. What must be impossible is the other half: a read inside `resolveTick` would make
 * combat depend on save history. The grep in `tools/lint.js` catches a read written in JS; this
 * makes one written in *content* impossible too, because there is nothing on the object to call.
 */
export const writeOnly = (ledger) => Object.freeze({ emit: (name, payload) => { ledger.emit(name, payload); } })

// ── what the sim notices ────────────────────────────────────────────────────────────────────────

/**
 * Read a finished battle and its consequences into the ledger.
 *
 * Derived from the timeline **after** the fight rather than emitted during it, for the same reason
 * `economy.js` prices a battle from its finished state: a fight that gets re-simmed for the
 * post-mortem's counterfactual (§4.5) must not need the resolver to know that any of this exists.
 * The resolver emits events; this reads them.
 *
 * @param {object} ledger
 * @param {object} opts
 * @param {object} opts.registry
 * @param {object} opts.tuning
 * @param {object} opts.result   a `runBattle()` result
 * @param {object} opts.report   the node report from `run.js` — recruits, cuts, levels
 */
export function recordBattle (ledger, { registry, tuning, result, report = {}, floor = 1 }) {
  const threshold = tuning?.persuade?.threshold ?? 0.3
  const units = new Map()
  for (const ev of result.events) {
    if (ev.type !== 'battle:start') continue
    for (const u of ev.units) units.set(u.uid, { ...u, minPct: u.maxHp > 0 ? u.hp / u.maxHp : 1, approached: false })
    break
  }

  for (const ev of result.events) {
    const u = units.get(ev.target)
    if (!u) continue
    if (ev.type === 'damage' || ev.type === 'heal') {
      // The killing blow is excluded on purpose: "a Frost Sprite dropped to 22% and the party killed
      // it" is the sentence §4.1 wants, and tracking through zero would make every one of them read
      // "dropped to 0%", which is true of literally every corpse and says nothing.
      if (ev.hp > 0) u.minPct = Math.min(u.minPct, u.maxHp > 0 ? ev.hp / u.maxHp : 0)
    } else if (ev.type === 'persuade') {
      u.approached = true
      // A failed attempt is its own signal: it is a gauge fill spent on talking, and a Precedent
      // about *when* to talk wants to know how often it went nowhere, not only how often it worked.
      if (!ev.success && ev.reason !== 'immune') ledger.emit('recruit:failed', { defId: u.defId, chance: ev.chance ?? 0 })
    } else if (ev.type === 'death') {
      if (u.side === 'foe') {
        // ★ The signal §4.1's first Precedent is built on. A foe that went below the threshold and
        // died anyway is the acquisition loop failing to happen — and it is invisible to the player
        // precisely because nothing happened.
        if (!u.approached && u.minPct <= threshold) {
          const def = registry.get('unit', u.defId)
          ledger.emit('recruit:missed', { ...names(registry, def), tier: def.tier ?? 1, hpPct: u.minPct })
        }
      } else {
        const def = registry.get('unit', u.defId)
        const row = Math.floor(u.slot / 4)
        ledger.emit('ally:down', { ...names(registry, def), row, floor })
        // "Your Ranger has died in the front row three times" (§4.2) — the Precedent that offers
        // Marching Order. Standing further forward than its Role would place it is the fact; the
        // Role's own `autoRow` is where "further forward" is defined, so a mod's Role gets this for
        // free and no list of Role ids appears in here.
        const home = registry.has('role', def.role) ? registry.get('role', def.role).autoRow ?? 0 : 0
        if (row < home) ledger.emit('ally:down_front', { ...names(registry, def), row, home, floor })
      }
    }
  }

  const won = result.state.winner === 'party'
  ledger.emit(won ? 'battle:won' : 'battle:lost', { floor })
  if (won && report.type === 'boss') ledger.emit('boss:felled', { floor })

  for (const u of report.joined ?? []) ledger.emit('recruit:joined', named(registry, u, { floor }))
  for (const u of report.declined ?? []) ledger.emit('recruit:declined', named(registry, u, { floor }))
  for (const u of report.cut ?? []) ledger.emit('recruit:cut', named(registry, u, { floor, lvl: u.lvl }))
  for (const a of report.levelled ?? []) ledger.emit('unit:levelled', named(registry, a, { to: a.to, floor }))
  for (const a of report.awards ?? []) {
    for (const opt of a.branched ?? []) ledger.emit('unit:branch', named(registry, a, { at: a.to, opt, floor }))
  }

  return ledger
}

/**
 * A payload carries display *names*, not only ids, because a Precedent's body is a sentence a
 * person reads — "the last was a Frost Sprite, a Skirmisher". The id is kept beside it so a gate
 * can still match on one; putting only the id in would push every card's copy toward naming
 * `core:trickster` at the player, which is the tell of a UI built out of a database.
 */
const names = (registry, def) => ({
  defId: def.id,
  name: def.name,
  kin: registry.has('kin', def.kin) ? registry.get('kin', def.kin).name : def.kin,
  role: registry.has('role', def.role) ? registry.get('role', def.role).name : def.role
})

const named = (registry, unit, extra) => ({ ...names(registry, registry.get('unit', unit.defId)), ...extra })
