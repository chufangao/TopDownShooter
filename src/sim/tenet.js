// Tenets (§4.2) — the small, named things a player buys with Codex.
//
// > **Superseded — six learned Disciplines.** M3.5 first shipped §4.2 as written: six panels, each
// > handed over by a Precedent that noticed a pattern and offered it. Two things were wrong with
// > that, and they are the same thing twice. It decided *when* you got a capability, so the player
// > was approving a suggestion rather than making a decision. And the unit it handed over was a
// > whole panel — twelve pins, thirteen targeting modes, an expression editor — which is not a
// > choice anyone can reasonably evaluate, only a room you are shown into.
//
// The replacement inverts both. A **Tenet** is one narrow power, plainly named, with a price:
// *Parley threshold*, *Pin a unit*, *Mark by threat*, *What to walk past*. You browse them, you
// spend Codex, and what you can express afterwards is exactly what you bought. Nothing offers, and
// nothing arrives.
//
//   Owned tenets  →  capabilities()  →  which Doctrine fields exist, how many rules each holds,
//                                       which chips are legal, which modes and actions are offered
//
// Three properties fall out, and each was a stated problem with the version before it:
//
//   * **The menu is as small as your purchases.** §4.4's chip dropdown is generated from registered
//     forms, which meant every form in the game on day one. It is now generated from the forms your
//     tenets grant, which on day one is none, and after your first purchase is two.
//   * **Cost makes it a decision.** Codex is a count of discoveries and is deliberately not
//     farmable (§5) — with the current roster the whole shop costs more than exists. You cannot buy
//     it all, so what you buy is an argument about how you want to play.
//   * **A shared Doctrine cannot smuggle power.** `validate` refuses a rule that uses a chip the
//     holder has not bought, so importing someone else's export string tells you what it would cost
//     rather than quietly granting it.
//
// Pure JS. No clock, no Math.random, no Phaser.

/**
 * Form groups that are free to everyone.
 *
 * The split is *shape* versus *content*: `ALL of`, `NOT` and `≤` are how any rule is built at all
 * and a rule cannot be written without them, while everything else — `hpPct`, `kinCount`, and the
 * arithmetic too — is something to say rather than a way of saying it.
 *
 * **Arithmetic is on the paid side, and that was decided by looking at the menu.** Leaving `maths`
 * and `data` free put thirteen forms (`+ − × ÷ remainder min max clamp abs floor ceil round pow`)
 * into the dropdown of a player who had bought exactly one thing, which is the "too many knobs to
 * reasonably choose between" problem reproduced inside a single rule. A freshly-bought *Parley
 * threshold* now offers the comparators and `hp%`, and nothing else.
 *
 * Gating on the group rather than on a list of names means a pack's form lands on the correct side
 * by declaring what kind of thing it is — and an unlabelled one lands on the free side, because the
 * gate exists to keep the early menu short, not to be a security boundary.
 */
export const STRUCTURAL_GROUPS = new Set(['logic', 'compare', 'other'])

/** Doctrine paths a tenet may open. A tenet naming anything else is a load error (§16.1). */
export const EDITABLE = [
  'formation.pins', 'formation.autoRow',
  'targeting.default', 'targeting.byRole', 'allyTargeting.default',
  'recruit', 'cut',
  'ability',
  'route.order', 'route.skip', 'route.maxNodes',
  'branch'
]

/**
 * Fold every owned tenet into one answer to "what may this player say?".
 *
 * Additive and order-independent by construction — a union of sets and a sum of integers — for the
 * same reason §11.3's modifier pipeline is: the result must not depend on which order the purchases
 * were made in, or two players holding the same tenets would hold different Doctrines.
 *
 * @param {object} registry
 * @param {string[]} owned  tenet ids
 * @returns {object} capabilities
 */
export function capabilities (registry, owned = []) {
  const fields = new Set()
  const slots = new Map()
  const forms = new Set()
  const groups = new Set()
  const modes = new Set()
  const actions = new Set()
  const held = []

  const has = registry?.kinds?.().includes('tenet')
  for (const id of owned) {
    if (!has || !registry.has('tenet', id)) continue
    const def = registry.get('tenet', id)
    held.push(id)
    for (const path of def.grants?.edit ?? []) fields.add(path)
    for (const [path, n] of Object.entries(def.grants?.slots ?? {})) slots.set(path, (slots.get(path) ?? 0) + n)
    for (const f of def.grants?.forms ?? []) forms.add(f)
    // A whole group at once, for the tenets that sell a *way of saying things* rather than a fact
    // to say — arithmetic being the one core ships.
    for (const g of def.grants?.groups ?? []) groups.add(g)
    for (const m of def.grants?.modes ?? []) modes.add(m)
    for (const a of def.grants?.actions ?? []) actions.add(a)
  }

  return {
    owned: held.sort(),
    /** Whether a Doctrine path may be authored at all. An unowned field is absent, not greyed. */
    can: (path) => fields.has(path),
    /** How many rules may sit at a path. Zero means the list stays empty whatever else you own. */
    slotsFor: (path) => slots.get(path) ?? 0,
    hasForm: (name, group) => STRUCTURAL_GROUPS.has(group) || groups.has(group) || forms.has(name),
    hasMode: (id) => modes.has(id),
    hasAction: (id) => actions.has(id),
    fields,
    forms,
    groups,
    modes,
    actions,
    /** Nothing bought yet — the state every profile starts in, and run 1 never leaves. */
    get empty () { return held.length === 0 }
  }
}

/**
 * What a tenet costs and whether it can be bought yet.
 *
 * `requires` is a prerequisite rather than a price rise: *Parley by Kin* is meaningless without
 * *Parley threshold*, and selling it alone would be selling a chip with nowhere to put it.
 *
 * @returns {{affordable: boolean, blocked: string[], cost: number}}
 */
export function priceOf (registry, id, { owned = [], codex = 0 } = {}) {
  const def = registry.get('tenet', id)
  const blocked = (def.requires ?? []).filter((r) => !owned.includes(r))
  return { cost: def.cost ?? 0, blocked, affordable: codex >= (def.cost ?? 0) && blocked.length === 0 }
}

/** Total Codex committed to tenets — what `spendable` subtracts from the discovery count. */
export const spentOn = (registry, owned = []) =>
  owned.reduce((n, id) => n + (registry.has('tenet', id) ? registry.get('tenet', id).cost ?? 0 : 0), 0)

/**
 * Codex a profile can still spend: discoveries earned, minus what tenets already cost.
 *
 * Codex is a *count of discoveries*, not a resource you farm (§5) — the second Bone Chanter you
 * recruit pays nothing. So this number is small on purpose and grows with the roster rather than
 * with time played, which is what stops the shop from being something you eventually finish.
 */
export const spendable = (registry, profile) =>
  Math.max(0, (profile?.codex?.length ?? 0) - spentOn(registry, profile?.tenets ?? []))

/**
 * Every tenet, with its price and whether it is reachable — the shop, as data.
 *
 * Sorted by `registry.all`, so which tenets exist and in what order is independent of pack load
 * order (§11.1). Grouped by `section` for display only; the sim knows nothing about sections.
 */
export function shop (registry, profile) {
  if (!registry.kinds().includes('tenet')) return []
  const owned = profile?.tenets ?? []
  const codex = spendable(registry, profile)
  return registry.all('tenet').map((def) => ({
    id: def.id,
    name: def.name,
    desc: def.desc ?? '',
    section: def.section ?? 'other',
    order: def.order ?? 0,
    cost: def.cost ?? 0,
    requires: def.requires ?? [],
    owned: owned.includes(def.id),
    ...priceOf(registry, def.id, { owned, codex })
  })).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
}

/**
 * Buy one. Returns a new tenet list rather than mutating, so the caller decides when it is real —
 * the same contract every other decision in the sim has with its host.
 *
 * @returns {{tenets: string[], bought: boolean, reason: string|null}}
 */
export function buy (registry, profile, id) {
  const owned = profile?.tenets ?? []
  if (owned.includes(id)) return { tenets: owned, bought: false, reason: 'already held' }
  if (!registry.has('tenet', id)) return { tenets: owned, bought: false, reason: `no such tenet "${id}"` }

  const { cost, blocked } = priceOf(registry, id, { owned, codex: spendable(registry, profile) })
  if (blocked.length) {
    const names = blocked.map((r) => (registry.has('tenet', r) ? registry.get('tenet', r).name : r))
    return { tenets: owned, bought: false, reason: `needs ${names.join(' and ')} first` }
  }
  if (spendable(registry, profile) < cost) {
    return { tenets: owned, bought: false, reason: `costs ${cost} Codex; you have ${spendable(registry, profile)}` }
  }

  return { tenets: [...owned, id].sort(), bought: true, reason: null }
}
