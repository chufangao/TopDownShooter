// Kernel primitive 2 of 7 — Def → Instance (§11.2).
//
//        | Def                    | Instance
// Where  | registry, frozen       | game state, mutable
// Life   | forever                | a battle, a run, or a save
// Holds  | data + ids             | numbers + defId
// Author | us and mods            | never — always instantiated
//
// Nothing else exists. No third category of "manager object", no class hierarchy. A kind's
// factory is a pure function, registered alongside the registry — which is how a mod adds a whole
// new content *kind* (say, `mount`) rather than just new rows of an existing one.

/** What to do with an instance whose def vanished because a pack was removed (§14). */
export const ORPHAN_POLICIES = ['drop', 'substitute', 'refund', 'keep']

export function createInstancer (registry) {
  /** @type {Map<string, {make: Function, orphanPolicy: string}>} */
  const kinds = new Map()
  let uid = 1

  const I = {
    /**
     * @param {string} kind
     * @param {{make: (def, ctx, api) => object, orphanPolicy?: string}} spec
     *   `make` returns the extra fields; uid and defId are stamped by the instancer so no factory
     *   can forget them.
     */
    registerKind (kind, spec) {
      if (kinds.has(kind)) throw new Error(`duplicate instance kind ${kind}`)
      if (typeof spec.make !== 'function') throw new Error(`kind ${kind}: make must be a function`)
      const policy = spec.orphanPolicy ?? 'drop'
      if (!ORPHAN_POLICIES.includes(policy)) {
        throw new Error(`kind ${kind}: orphanPolicy must be one of ${ORPHAN_POLICIES.join(' ')}`)
      }
      kinds.set(kind, { make: spec.make, orphanPolicy: policy })
      return I
    },

    hasKind: (kind) => kinds.has(kind),
    kinds: () => [...kinds.keys()].sort(),

    /**
     * @param {string} kind
     * @param {string} defId
     * @param {object} ctx  whatever the factory needs — rng stream, level, owner side, tuning
     * @returns {object} `{uid, defId, ...}` — plain JSON, no object references (§14)
     */
    instantiate (kind, defId, ctx = {}) {
      const spec = kinds.get(kind)
      if (!spec) throw new Error(`no instance factory for kind ${kind} — registerKind it first`)
      const def = registry.get(kind, defId)   // throws with a name if dangling
      const fields = spec.make(def, ctx, I) ?? {}
      // uid and defId are stamped last so a factory cannot overwrite them.
      return { ...fields, uid: uid++, defId }
    },

    /** The def behind an instance. Cheap — the registry is frozen, so this is a Map hit. */
    defOf (kind, inst) {
      return registry.get(kind, inst.defId)
    },

    orphanPolicy (kind, defId) {
      if (registry.has(kind, defId)) return null
      return kinds.get(kind)?.orphanPolicy ?? 'drop'
    },

    /** uid counter is save state — replays and saves must not renumber instances. */
    snapshot: () => ({ uid }),
    restore (snap) { uid = snap?.uid ?? uid; return I },
    peekUid: () => uid
  }

  return I
}
