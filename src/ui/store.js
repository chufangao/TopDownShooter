// The player's Doctrine, and the one path it takes into a run.
//
// Two rules the rest of the UI depends on:
//
//   * **The store holds a draft; the run holds a policy.** Editing never reaches into a fight in
//     progress. `commit()` publishes, and the renderer adopts it at the next node boundary (§4) —
//     so the timeline being played back is always the one the sim already decided.
//   * **Persistence is `JSON.stringify` and nothing else.** A Doctrine is plain JSON (§11.6), so
//     this file has no serialiser to maintain and the save format at M4 is the same string.

import { DEFAULT_DOCTRINE, normalize, validate } from '../sim/doctrine.js'
import { createLedger } from '../sim/signals.js'
import { capabilities, spendable, shop, buy } from '../sim/tenet.js'

const KEY = 'retinue:doctrine:v1'
const LEDGER_KEY = 'retinue:signals:v1'
const PROFILE_KEY = 'retinue:profile:v1'

/**
 * @param {object} opts
 * @param {object} opts.kernel
 * @param {Storage|null} [opts.storage]  null disables persistence (private mode, tests)
 */
export function createDoctrineStore ({ kernel, storage = safeStorage() } = {}) {
  let draft = normalize(load(storage, KEY) ?? DEFAULT_DOCTRINE)
  let live = normalize(draft)
  const listeners = new Set()

  /**
   * The profile's signal ledger (§4.3), which is save state in the same sense the Doctrine is: the
   * profile-scoped counters and the set of Precedents already answered. Run and battle scopes are
   * derived and are deliberately not stored. It lives here rather than in the scene because it
   * outlives every run, and because the run is handed it rather than owning it.
   */
  const ledger = createLedger(load(storage, LEDGER_KEY))

  /**
   * The slice of the profile (§14) the UI needs before `save.js` is wired into the browser: what
   * has been discovered, and what has been bought with it. `codex` is a set of discovery keys and
   * `tenets` is what those keys were spent on — the two halves of §5's only losing-run currency.
   */
  let profile = { codex: [], tenets: [], ...(load(storage, PROFILE_KEY) ?? {}) }
  syncTenets()

  const S = {
    /** Read by dispatches and by the panel; never by anything inside a battle (§18.16). */
    signals: ledger,

    get profile () { return profile },

    /** What the player has bought (§4.2). Empty is what run 1 looks like, and nothing changes it but a purchase. */
    owned: () => live.tenets ?? [],
    /** What those purchases add up to — which fields exist, how many rules, which chips. */
    capabilities: () => capabilities(kernel.registry, live.tenets ?? []),
    /** Codex earned by discovery, minus what tenets have already cost. */
    codex: () => spendable(kernel.registry, profile),
    /** The shop, as rows: price, prerequisites, whether it is affordable right now. */
    shop: () => shop(kernel.registry, profile),

    /**
     * ★ Buy a tenet (§4.2).
     *
     * The only way anything is ever added to what the player can say. Nothing offers, nothing
     * unlocks itself, and no amount of play grants one — a run pays in discoveries and the player
     * decides what those discoveries are worth.
     *
     * It writes straight to the live Doctrine rather than into the draft, because a purchase is not
     * an edit awaiting approval; it reaches the run at the next node boundary exactly as a commit
     * does.
     *
     * @returns {{bought: boolean, reason: string|null}}
     */
    purchase (id) {
      const res = buy(kernel.registry, profile, id)
      if (!res.bought) return res

      profile = { ...profile, tenets: res.tenets }
      live = normalize({ ...live, tenets: res.tenets })
      draft = normalize({ ...draft, tenets: res.tenets })
      persist()
      emit('commit')
      return res
    },

    /** Record a run's discoveries. The one thing that makes Codex go up (§5). */
    discover (keys = []) {
      const fresh = keys.filter((k) => !profile.codex.includes(k))
      if (!fresh.length) return 0
      profile = { ...profile, codex: [...profile.codex, ...fresh].sort() }
      persist()
      emit('codex')
      return fresh.length
    },
    /** The version being edited. Mutate through `update`, never in place. */
    get draft () { return draft },
    /** The version the run is fighting by. */
    get live () { return live },
    get dirty () { return JSON.stringify(draft) !== JSON.stringify(live) },

    problems: () => validate(draft, kernel),
    errors: () => S.problems().filter((p) => p.severity === 'error'),

    /** @param {(d: object) => void} fn  mutate the draft; the UI re-renders and nothing else moves */
    update (fn) {
      fn(draft)
      draft = normalize(draft)
      emit('draft')
      return draft
    },

    replace (next) {
      draft = normalize(next)
      emit('draft')
      return draft
    },

    reset () { return S.replace(DEFAULT_DOCTRINE) },

    /**
     * Publish the draft. Refused while it has errors: a Doctrine that names a form the evaluator
     * does not know would throw on the tick that reached it, and a crash three nodes later is the
     * worst possible way to learn about a typo.
     * @returns {boolean} whether it went live
     */
    commit () {
      if (S.errors().length) return false
      live = normalize(draft)
      persist()
      emit('commit')
      return true
    },

    /** A dispatch was read and put down. It was never a question, so this records nothing but that. */
    seen (card) {
      if (card?.once === 'profile') {
        ledger.markAnswered(card.id, 'profile')
        save(storage, LEDGER_KEY, ledger.save())
      }
      return S
    },

    /** Throw away the edits and go back to what the run is actually using. */
    revert () {
      draft = normalize(live)
      emit('draft')
      return draft
    },

    subscribe (fn) { listeners.add(fn); return () => listeners.delete(fn) }
  }

  function emit (what) { for (const fn of listeners) fn(what, S) }

  function persist () {
    save(storage, KEY, live)
    save(storage, PROFILE_KEY, profile)
    save(storage, LEDGER_KEY, ledger.save())
  }

  /**
   * The profile owns the purchases; the Doctrine carries a copy so that a run — and an export
   * string — is self-describing. They are reconciled here, in one direction, so there is never a
   * question about which is right: **the profile is what was bought.**
   */
  function syncTenets () {
    const owned = [...new Set(profile.tenets ?? [])].sort()
    profile.tenets = owned
    live = normalize({ ...live, tenets: owned })
    draft = normalize({ ...draft, tenets: owned })
  }

  return S
}

function load (storage, key) {
  try {
    const raw = storage?.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    // A corrupt or unreadable draft must never stop the game from starting; the shipped default is
    // always a valid fallback, which is the whole reason it is a plain data object (§4).
    return null
  }
}

function save (storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)) } catch { /* quota or private mode */ }
}

function safeStorage () {
  try { return globalThis.localStorage ?? null } catch { return null }
}
