// The Doctrine (§4) — where the player actually plays.
//
// You never touch the controls, so authoring policy is the game. Every rule here is a plain JSON
// expression tree (§11.6), which buys three things immediately: the Doctrine serialises into the
// save with no special casing, it is a shareable export string, and the M3 editor is a tree editor
// over a data structure rather than a bespoke rule compiler.
//
// This file owns the *vocabulary* — the five editors' shapes, the legal values in each position,
// the defaults, and the validator. `policy/` owns applying it and `ui/` owns editing it. That split
// is why the editor imports exactly one module from the sim, and why adding a targeting mode is one
// row here rather than an edit in three places.
//
// Pure JS. No clock, no Math.random, no Phaser.

import { rowOf, ROWS, SLOTS } from './combat/formation.js'
import { DEFAULT_ROUTE_ORDER, NODE_TYPES } from './dungeon.js'
import { ID_RE } from './kernel/registry.js'
import { capabilities } from './tenet.js'

/**
 * Bumped whenever a stored Doctrine's shape changes; `normalize` migrates older ones forward.
 *
 * **v2 re-keyed `formation.pins` from uid to defId** (§19 debt 7). A uid belongs to a run, so a
 * pinned Doctrine was dead the moment the run that made it ended — and worse, a Doctrine is meant
 * to be a shareable export string (§11.6), which a uid makes broken by construction: your pins name
 * *your* instances and mean nothing in anyone else's game. Naming the unit is the only key that is
 * true across a run boundary and across a share. v1 pins are dropped by `normalize` rather than
 * guessed at, because there is nothing in a stored uid to translate from.
 */
export const DOCTRINE_VERSION = 2

/** The five editors of §4, in the order the UI shows them. */
export const EDITORS = ['formation', 'targeting', 'ability', 'recruit', 'route']

/**
 * Every field a Discipline may own a panel over (§4.2) — the five above plus Succession's `branch`.
 *
 * A `discipline` def names one of these, and that is the whole binding between a learned capability
 * and the policy it edits. Six panels, six keys; adding a seventh Discipline means adding a key
 * here and an editor, which is exactly as expensive as it should be.
 */
export const PANELS = [...EDITORS, 'branch']

/** The panels whose policy is an ordered, first-match-wins rule list. A Precedent unshifts into one. */
export const RULE_PANELS = ['recruit', 'ability', 'branch']

// ── targeting ───────────────────────────────────────────────────────────────────────────────────

/**
 * The targeting priority list of §4, as comparators. A list is applied in order and the first
 * comparator that separates two candidates wins, so `['healersFirst', 'lowestHpPct']` reads exactly
 * as it sounds.
 *
 * Every entry carries its own label and description because the editor's dropdown is *generated*
 * from this table (§4.1) — a mode that exists in code and not in the menu is a mode nobody can use.
 */
export const TARGET_MODES = [
  { id: 'lowestHpPct', label: 'lowest HP %', desc: 'Finish what is already hurt.', cmp: (a, b) => a.hp / a.maxHp - b.hp / b.maxHp },
  { id: 'highestHpPct', label: 'highest HP %', desc: 'Spread damage instead of concentrating it.', cmp: (a, b) => b.hp / b.maxHp - a.hp / a.maxHp },
  { id: 'lowestHp', label: 'lowest HP', desc: 'Raw HP, not a fraction — favours small units.', cmp: (a, b) => a.hp - b.hp },
  { id: 'highestHp', label: 'highest HP', desc: 'Raw HP, not a fraction — favours the wall.', cmp: (a, b) => b.hp - a.hp },
  { id: 'backRow', label: 'back row first', desc: 'Reach past the wall when the ability allows it.', cmp: (a, b) => rowOf(b.slot) - rowOf(a.slot) },
  { id: 'frontRow', label: 'front row first', desc: 'Clear the wall before anything behind it.', cmp: (a, b) => rowOf(a.slot) - rowOf(b.slot) },
  { id: 'nearestColumn', label: 'nearest column', desc: 'Stay in your lane; cheap and predictable.', cmp: (a, b) => (a.slot % 4) - (b.slot % 4) },
  { id: 'weakest', label: 'weakest defence', desc: 'Whoever mitigates the least.', cmp: (a, b, ctx) => statOf(ctx, a, 'def') - statOf(ctx, b, 'def') },
  { id: 'strongest', label: 'strongest attack', desc: 'Kill the thing hitting hardest.', cmp: (a, b, ctx) => statOf(ctx, b, 'atk') - statOf(ctx, a, 'atk') },
  { id: 'fastest', label: 'fastest', desc: 'Deny the next action rather than the biggest one.', cmp: (a, b, ctx) => statOf(ctx, b, 'spd') - statOf(ctx, a, 'spd') },
  { id: 'healersFirst', label: 'healers first', desc: 'Anything whose Role is Channeler or Warden.', cmp: (a, b, ctx) => healerRank(ctx, a) - healerRank(ctx, b) },
  { id: 'lowestTier', label: 'lowest tier', desc: 'Clear the chaff so the aggro roll concentrates.', cmp: (a, b, ctx) => tierOf(ctx, a) - tierOf(ctx, b) },
  { id: 'highestTier', label: 'highest tier', desc: 'Go for the prize — and the thing worth persuading.', cmp: (a, b, ctx) => tierOf(ctx, b) - tierOf(ctx, a) }
]

/** id → comparator, for the hot path. */
export const TARGET_RULES = Object.fromEntries(TARGET_MODES.map((m) => [m.id, m.cmp]))

const defOf = (ctx, u) => ctx.registry.get('unit', u.defId)
const tierOf = (ctx, u) => defOf(ctx, u).tier ?? 0

/**
 * "Healers first" reads a flag on the Role def, not a list of Role ids in here. Naming
 * `core:channeler` in code would mean a mod's sustain Role could never be targeted by this mode —
 * the exact second-class citizenship §12 exists to prevent, for the price of one boolean in JSON.
 */
function healerRank (ctx, u) {
  const role = defOf(ctx, u).role
  return ctx.registry.has('role', role) && ctx.registry.get('role', role).heals ? 0 : 1
}
// A comparator may need resolved stats, which only a battle context can produce. Outside one it
// falls back to the def's base, so a targeting list stays sortable in a test with no battle.
const statOf = (ctx, u, key) => (ctx.statsOf ? ctx.statsOf(u)[key] : defOf(ctx, u).base?.[key]) ?? 0

// ── the cut rule ────────────────────────────────────────────────────────────────────────────────

export const CUT_MODES = [
  { id: 'lowestLevel', label: 'lowest level', desc: 'The unit with the least invested in it.' },
  { id: 'lowestTier', label: 'lowest tier', desc: 'The unit with the lowest ceiling.' },
  { id: 'lowestHp', label: 'smallest HP pool', desc: 'The unit least able to hold a slot.' },
  { id: 'worstTagFit', label: 'worst tag fit', desc: 'Whoever shares fewest tags with the rest of the party.' }
]

export const CUT_RULES = {
  lowestLevel: (a, b) => (a.lvl - b.lvl) || (a.maxHp - b.maxHp),
  lowestTier: (a, b, registry) =>
    registry.get('unit', a.defId).tier - registry.get('unit', b.defId).tier,
  lowestHp: (a, b) => a.maxHp - b.maxHp,
  worstTagFit: (a, b, registry, roster) => tagFit(registry, roster, a) - tagFit(registry, roster, b)
}

/** How many other roster members share this unit's Kin or Role — the thing coherence is made of. */
function tagFit (registry, roster, unit) {
  const def = registry.get('unit', unit.defId)
  let n = 0
  for (const other of roster) {
    if (other.uid === unit.uid) continue
    const d = registry.get('unit', other.defId)
    if (d.kin === def.kin) n++
    if (d.role === def.role) n++
  }
  return n
}

// ── recruit ─────────────────────────────────────────────────────────────────────────────────────

export const RECRUIT_ACTIONS = [
  { id: 'persuade', label: 'PERSUADE', desc: 'Spend a gauge fill talking to it instead of hitting it.' },
  { id: 'kill', label: 'KILL', desc: 'Finish the fight. Every attempt is a swing not taken.' },
  { id: 'decline', label: 'DECLINE', desc: 'Never approach this one, whatever a later rule says.' }
]

// ── the default set ─────────────────────────────────────────────────────────────────────────────

/**
 * Shipped defaults, already in the normalised shape so `normalize(DEFAULT_DOCTRINE)` is a plain deep
 * copy. Nothing downstream knows the difference between these and a set the player wrote — which is
 * the point, and the reason the editor needed no new plumbing in the sim beyond threading it
 * through the battle.
 */
export const DEFAULT_DOCTRINE = Object.freeze({
  v: DOCTRINE_VERSION,

  /**
   * Formation (§4). `pins` is the player's hand placement, **unit defId → slot**; `autoRow` is the
   * by-Role auto-fill for units that arrive without one. Anything absent from both falls through to
   * the Role def's own `autoRow`, so an empty Formation doctrine behaves exactly as M2 did.
   */
  formation: Object.freeze({ pins: Object.freeze({}), autoRow: Object.freeze({}) }),

  targeting: Object.freeze({ default: Object.freeze(['lowestHpPct']), byRole: Object.freeze({}) }),
  allyTargeting: Object.freeze({ default: Object.freeze(['lowestHpPct']), byRole: Object.freeze({}) }),

  /**
   * Ability (§4): an ordered list of `IF ⟨when⟩ THEN ⟨use⟩`. Empty means "the unit's own list, in
   * def order" — which is what M1 and M2 did, so the default set changes nothing.
   */
  ability: Object.freeze([]),

  /**
   * ★ **The player's own rules, and nothing else. Empty is the shipped state.**
   *
   * This list used to hold the three rules below in STANDING_ORDERS, and moving them out is what
   * makes a one-slot purchase legible: a player who buys *Parley threshold* opens a panel holding
   * one empty row that is theirs, rather than three pre-written rows they did not write and cannot
   * be expected to read as anything but a settings screen someone else filled in.
   *
   * Nothing about behaviour changed with the move. The standing orders still run — they run *after*
   * whatever you wrote, which is the only ordering that makes an authored rule mean anything.
   */
  recruit: Object.freeze([]),

  /** Party full at 12? The Recruit doctrine must name a cut rule, or the recruit is declined (§2). */
  cut: 'lowestLevel',

  /**
   * Route / Risk (§4): which nodes to path toward, and when to stop and take the stairs. `order`
   * ranks node types — lower is visited sooner — and `maxNodes` is the descend-early decision.
   */
  route: Object.freeze({ order: Object.freeze({ ...DEFAULT_ROUTE_ORDER }), skip: Object.freeze([]), maxNodes: null }),

  /**
   * Succession (§3, §4.2): which branch a unit takes at level 5 and 10, as an ordered
   * `IF ⟨when⟩ THEN prefer ⟨branch⟩` list. Empty means "the first option", so a player who has
   * never heard of this is never blocked — the pick is taken by default the moment it is earned and
   * a Precedent afterwards offers to set the policy for every unit that reaches level 5 from here
   * on. That is the difference between asking a question and waiting for an answer (§4.1).
   */
  branch: Object.freeze([]),

  /** Abilities every unit may reach for, whatever its own list says. */
  granted: Object.freeze(['core:persuade']),

  /**
   * ★ Tenets bought with Codex (§4.2, §5) — the whole of what the player has chosen to be able to
   * say. **Empty, which is what run 1 is**, and nothing hands one over: the party fights by the
   * standing orders below and the player watches, which is the correct first experience for a game
   * whose premise is that it plays itself.
   *
   * A field the tenets do not cover is not greyed out; it does not appear.
   */
  tenets: Object.freeze([])
})

/**
 * ★ The standing orders — how the party fights when you have said nothing.
 *
 * These are not defaults in the sense of "a value you will overwrite". They are the behaviour of a
 * competent retinue that has no orders, and they keep running forever: an authored rule is inserted
 * *before* them, never instead of them. So buying one rule slot buys the right to say one thing
 * first, which is a proposition a player can actually evaluate — unlike "here is the recruit
 * editor", which was the thing that made the previous shape unreasonable to choose.
 *
 * They are deliberately not editable at any price. What you buy is the right to *pre-empt* them.
 *
 *   1. IF enemy.tier ≥ 3 AND attempts < 3   → PERSUADE at hp ≤ 45%
 *   2. IF kinCount(enemy.kin) < 3 AND …     → PERSUADE at hp ≤ 30%
 *   3. ELSE                                 → KILL
 */
export const STANDING_ORDERS = Object.freeze({
  recruit: Object.freeze([
    Object.freeze({
      _note: 'Anything rare enough to be worth a slot is worth three attempts, and worth catching early.',
      when: ['and', ['gte', ['tier', '$target'], 3], ['lt', ['attempts', '$target'], 3]],
      action: 'persuade',
      at: 0.45
    }),
    Object.freeze({
      _note: 'Otherwise only chase tags we are actually short of — recruiting a fourth Undead is a slot ' +
             'spent on a Resonance we already have. This is the bridge between the tree and the roster (§5).',
      when: ['and', ['lt', ['kinCount', ['kin', '$target']], 3], ['lt', ['attempts', '$target'], 2]],
      action: 'persuade',
      at: 0.30
    }),
    Object.freeze({
      _note: 'Every attempt is a swing not taken. When the rules above stop matching, finish the fight.',
      when: true,
      action: 'kill'
    })
  ]),
  ability: Object.freeze([]),
  branch: Object.freeze([])
})

/**
 * What the sim actually walks: your rules, then the standing orders.
 *
 * One function, called at every read, so there is exactly one place that knows an authored rule
 * comes first — and no consumer anywhere has to remember to concatenate.
 */
export const rulesFor = (doctrine, panel) =>
  (doctrine?.[panel] ?? []).concat(STANDING_ORDERS[panel] ?? [])

/** How many of a panel's rules are the player's. The rest are standing orders and are not theirs. */
export const authoredCount = (doctrine, panel) => (doctrine?.[panel] ?? []).length

// ── normalise ───────────────────────────────────────────────────────────────────────────────────

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const clone = (v) => JSON.parse(JSON.stringify(v))

/** Accept both the M2 array form (`['lowestHpPct']`) and the §4 per-Role form. */
function normalizeTargeting (t, fallback) {
  if (Array.isArray(t)) return { default: t.slice(), byRole: {} }
  if (!isObj(t)) return clone(fallback)
  const byRole = {}
  for (const [role, list] of Object.entries(t.byRole ?? {})) {
    if (Array.isArray(list) && list.length) byRole[role] = list.slice()
  }
  return { default: Array.isArray(t.default) && t.default.length ? t.default.slice() : clone(fallback.default), byRole }
}

/**
 * Fill a partial or older Doctrine out to the full current shape. Every consumer in the sim calls
 * this once at the boundary rather than defaulting field by field at eleven call sites — the same
 * argument §11.3 makes for the modifier pipeline, one scale down.
 *
 * @returns {object} a fresh, mutable, fully-populated Doctrine
 */
export function normalize (doctrine = DEFAULT_DOCTRINE) {
  const d = isObj(doctrine) ? doctrine : {}
  const out = {
    v: DOCTRINE_VERSION,
    formation: {
      pins: {},
      autoRow: { ...(isObj(d.formation?.autoRow) ? d.formation.autoRow : {}) }
    },
    targeting: normalizeTargeting(d.targeting, DEFAULT_DOCTRINE.targeting),
    allyTargeting: normalizeTargeting(d.allyTargeting, DEFAULT_DOCTRINE.allyTargeting),
    ability: Array.isArray(d.ability) ? clone(d.ability) : [],
    recruit: Array.isArray(d.recruit) ? clone(d.recruit) : clone(DEFAULT_DOCTRINE.recruit),
    branch: Array.isArray(d.branch) ? clone(d.branch) : [],
    cut: typeof d.cut === 'string' ? d.cut : DEFAULT_DOCTRINE.cut,
    route: {
      order: { ...DEFAULT_ROUTE_ORDER, ...(isObj(d.route?.order) ? d.route.order : {}) },
      skip: Array.isArray(d.route?.skip) ? [...new Set(d.route.skip)].sort() : [],
      maxNodes: Number.isInteger(d.route?.maxNodes) && d.route.maxNodes > 0 ? d.route.maxNodes : null
    },
    granted: Array.isArray(d.granted) ? d.granted.slice() : DEFAULT_DOCTRINE.granted.slice(),

    // Sorted and deduped: what you own is a set, and two players who bought the same six tenets in
    // a different order hold the same Doctrine (the §11.1 argument, one layer up).
    tenets: Array.isArray(d.tenets)
      ? [...new Set(d.tenets.filter((id) => typeof id === 'string' && ID_RE.test(id)))].sort()
      : []
  }

  // Pins name a unit def (v2 — see DOCTRINE_VERSION). A v1 key is a bare number, and there is
  // nothing in it to translate from, so it is dropped here rather than guessed at: a pin that
  // silently moves to the wrong unit is worse than a pin that is gone.
  for (const [key, slot] of Object.entries(isObj(d.formation?.pins) ? d.formation.pins : {})) {
    if (!ID_RE.test(key)) continue
    if (Number.isInteger(slot) && slot >= 0 && slot < SLOTS) out.formation.pins[key] = slot
  }

  return out
}

// ── validate ────────────────────────────────────────────────────────────────────────────────────

/**
 * Static check, run by the editor on every keystroke and by `tools/lint.js` on a shipped preset.
 * Content bugs should be caught in under a second, never at tick time by a stack trace (§16.2).
 *
 * @param {object} doctrine  already normalised
 * @param {object} kernel    for `forms.validate` and id resolution
 * @returns {Array<{path: string, msg: string, severity: 'error'|'warn'}>}
 */
export function validate (doctrine, kernel) {
  const problems = []
  const err = (path, msg) => problems.push({ path, msg, severity: 'error' })
  const warn = (path, msg) => problems.push({ path, msg, severity: 'warn' })
  const R = kernel?.registry
  const F = kernel?.forms

  const checkModes = (list, path) => {
    list.forEach((mode, i) => {
      if (!TARGET_RULES[mode]) err(`${path}[${i}]`, `unknown targeting mode "${mode}"`)
    })
    if (list.length === 0) err(path, 'a targeting list needs at least one mode')
  }
  checkModes(doctrine.targeting.default, 'targeting.default')
  checkModes(doctrine.allyTargeting.default, 'allyTargeting.default')
  for (const [role, list] of Object.entries(doctrine.targeting.byRole)) {
    if (R && !R.has('role', role)) err(`targeting.byRole.${role}`, `unknown Role "${role}"`)
    checkModes(list, `targeting.byRole.${role}`)
  }

  const checkWhen = (when, path) => {
    if (when === true || when === undefined) return
    for (const e of F?.validate(when, path) ?? []) err(path, e)
  }

  doctrine.ability.forEach((rule, i) => {
    checkWhen(rule.when, `ability[${i}].when`)
    if (rule.use !== ANY_ABILITY && R && !R.has('ability', rule.use)) {
      err(`ability[${i}].use`, `unknown ability "${rule.use}"`)
    }
  })

  doctrine.recruit.forEach((rule, i) => {
    checkWhen(rule.when, `recruit[${i}].when`)
    if (!RECRUIT_ACTIONS.some((a) => a.id === rule.action)) {
      err(`recruit[${i}].action`, `unknown action "${rule.action}"`)
    }
    if (rule.action === 'persuade' && !(rule.at > 0 && rule.at <= 1)) {
      err(`recruit[${i}].at`, 'a PERSUADE rule needs an HP threshold between 0 and 1')
    }
  })

  doctrine.branch.forEach((rule, i) => {
    checkWhen(rule.when, `branch[${i}].when`)
    if (typeof rule.prefer !== 'string') {
      err(`branch[${i}].prefer`, 'a Succession rule must name the branch it prefers')
    } else if (R && !R.has('branch', rule.prefer)) {
      // A warning rather than an error, for the same reason a formation pin is: a Succession rule
      // outlives the pack that named the branch, and a shared Doctrine may name branches the
      // recipient has not installed. It simply never matches.
      warn(`branch[${i}].prefer`, `unknown branch "${rule.prefer}" — this rule can never match`)
    }
  })

  for (const id of doctrine.tenets) {
    if (R && R.kinds().includes('tenet') && !R.has('tenet', id)) {
      warn('tenets', `unknown tenet "${id}" — whatever it granted, this Doctrine no longer has`)
    }
  }
  problems.push(...affordable(doctrine, kernel))

  if (!CUT_RULES[doctrine.cut]) err('cut', `unknown cut rule "${doctrine.cut}"`)

  for (const id of doctrine.granted) {
    if (R && !R.has('ability', id)) err('granted', `unknown ability "${id}"`)
  }

  const slots = new Map()
  for (const [defId, slot] of Object.entries(doctrine.formation.pins)) {
    if (R && !R.has('unit', defId)) {
      // A warning, not an error: a Doctrine outlives the pack that named the unit, and a shared one
      // may name units the recipient has not installed. Removing a mod must never brick a Doctrine
      // any more than it may brick a save (§14).
      warn(`formation.pins.${defId}`, `unknown unit "${defId}" — this pin does nothing`)
    }
    if (slots.has(slot)) err('formation.pins', `slot ${slot} is pinned to two units (${slots.get(slot)} and ${defId})`)
    slots.set(slot, defId)
  }
  for (const [role, row] of Object.entries(doctrine.formation.autoRow)) {
    if (R && !R.has('role', role)) err(`formation.autoRow.${role}`, `unknown Role "${role}"`)
    if (!Number.isInteger(row) || row < 0 || row >= ROWS) err(`formation.autoRow.${role}`, `row must be 0–${ROWS - 1}`)
  }

  const known = new Set(NODE_TYPES.map((n) => n.type).concat(['boss', 'exit']))
  for (const type of Object.keys(doctrine.route.order)) {
    if (!known.has(type)) warn(`route.order.${type}`, `unknown node type "${type}" — it will never be routed to`)
  }
  for (const type of doctrine.route.skip) {
    if (!known.has(type)) warn('route.skip', `unknown node type "${type}"`)
    // Skipping the stairs is not expressible — the exit is not a node — but skipping every *kind*
    // of node is, and it turns a floor into a corridor. Worth a word rather than a silent shrug.
    if (type === 'boss') warn('route.skip', 'a boss cannot be walked past — the floor ends at it')
  }
  if (doctrine.route.skip.length >= NODE_TYPES.length) {
    warn('route.skip', 'every node type is skipped — the party will walk straight to the stairs')
  }

  problems.push(...shadowed(doctrine))
  return problems
}

/**
 * ★ Does this Doctrine only say things its holder paid for? (§4.2)
 *
 * The check that makes Codex prices mean anything. Without it the export string (§11.6) is a way to
 * hand someone the whole game — paste in a stranger's Doctrine and you have their targeting list,
 * their parley rules and their route, none of which you bought. With it, an import tells you
 * exactly what it would cost you, which is a far more interesting thing for a shared Doctrine to
 * say than "applied".
 *
 * Reported as errors so `store.commit()` refuses them, rather than silently deleting the offending
 * rows: a Doctrine that quietly loses half of itself on paste is worse than one that will not load
 * and says why.
 */
export function affordable (doctrine, kernel) {
  const R = kernel?.registry
  if (!R?.kinds || !R.kinds().includes('tenet')) return []

  const out = []
  const cap = capabilities(R, doctrine.tenets ?? [])
  const err = (path, msg) => out.push({ path, msg, severity: 'error' })
  const need = (what) => `needs a tenet granting ${what}`

  for (const panel of RULE_PANELS) {
    const rules = doctrine[panel] ?? []
    if (rules.length === 0) continue
    const slots = cap.slotsFor(panel)
    if (slots === 0) {
      // Nothing bought here at all. One message, not one per chip and action inside every rule —
      // an itemised bill for a shelf you have not walked up to is noise, and it buries the sentence
      // that actually explains the state.
      err(panel, `${rules.length} rule(s) here and nothing bought that holds one`)
      continue
    }
    if (rules.length > slots) err(panel, `${rules.length} rules against ${slots} slot(s) — ${need('another slot')}`)
    rules.forEach((rule, i) => {
      for (const name of formsUsed(rule.when)) {
        const spec = kernel.forms?.spec(name)
        if (spec && !cap.hasForm(name, spec.group)) err(`${panel}[${i}].when`, need(`"${spec.label ?? name}"`))
      }
      // A value that is not a real action at all already has its own error a few lines up. Charging
      // for it as well would report a typo twice and bury the message that says what it was.
      if (panel === 'recruit' && RECRUIT_ACTIONS.some((a) => a.id === rule.action) && !cap.hasAction(rule.action)) {
        err(`${panel}[${i}].action`, need(`${rule.action.toUpperCase()}`))
      }
    })
  }

  for (const [path, list] of [['targeting.default', doctrine.targeting.default], ['allyTargeting.default', doctrine.allyTargeting.default]]) {
    const slots = cap.slotsFor(path)
    // One mode is the standing order and is free; everything past it is a priority you bought.
    if (list.length > Math.max(1, slots)) err(path, `${list.length} priorities against ${slots} — ${need('another')}`)
    list.forEach((mode, i) => {
      // The standing order is free; everything past it is a priority you bought. And a mode that is
      // not a mode is already an error of its own — one typo, one message.
      if (i === 0 && mode === DEFAULT_DOCTRINE.targeting.default[0]) return
      const known = TARGET_MODES.find((m) => m.id === mode)
      if (known && !cap.hasMode(mode)) err(`${path}[${i}]`, need(`"${known.label}"`))
    })
  }
  if (Object.keys(doctrine.targeting.byRole).length && !cap.can('targeting.byRole')) {
    err('targeting.byRole', need('orders per Role'))
  }

  const pins = Object.keys(doctrine.formation.pins).length
  if (pins > cap.slotsFor('formation.pins')) err('formation.pins', `${pins} pinned and ${cap.slotsFor('formation.pins')} bought`)
  if (Object.keys(doctrine.formation.autoRow).length && !cap.can('formation.autoRow')) {
    err('formation.autoRow', need('Role rows'))
  }
  if (doctrine.cut !== DEFAULT_DOCTRINE.cut && !cap.can('cut')) err('cut', need('the cut rule'))
  if (!sameOrder(doctrine.route.order, DEFAULT_ROUTE_ORDER) && !cap.can('route.order')) err('route.order', need('what to walk to'))
  if (doctrine.route.skip.length && !cap.can('route.skip')) err('route.skip', need('what to walk past'))
  if (doctrine.route.maxNodes !== null && !cap.can('route.maxNodes')) err('route.maxNodes', need('when to take the stairs'))

  return out
}

/** Every form name an expression mentions, so `affordable` can price the chips it uses. */
function formsUsed (node, into = new Set()) {
  if (!Array.isArray(node)) return into
  if (typeof node[0] === 'string') into.add(node[0])
  for (const arg of node.slice(1)) formsUsed(arg, into)
  return into
}

const sameOrder = (a, b) => Object.keys(b).every((k) => a[k] === b[k]) && Object.keys(a).length === Object.keys(b).length

/**
 * Ordered-first-match is chosen over a scoring system because it is the only model where "why did
 * it do that" has a single-line answer (§4.1) — and the price of that choice is that a rule can be
 * unreachable. The editor says so at authoring time rather than leaving the player to wonder why a
 * badge reads 0 forever.
 */
export function shadowed (doctrine) {
  const out = []
  for (const editor of RULE_PANELS) {
    const rules = doctrine[editor] ?? []
    let catchAll = -1
    rules.forEach((rule, i) => {
      if (catchAll >= 0) {
        out.push({
          path: `${editor}[${i}]`,
          msg: `unreachable — rule ${catchAll + 1} matches everything above it`,
          severity: 'warn'
        })
        return
      }
      if (rule.when === true || rule.when === undefined) catchAll = i
    })
  }
  return out
}

// ── share ───────────────────────────────────────────────────────────────────────────────────────

/**
 * A Doctrine is plain JSON, so export/import is `JSON.stringify` and `JSON.parse`. That is the
 * whole feature (§11.6), and it is what makes a policy a shareable object in a game about
 * authoring policy.
 */
export const exportDoctrine = (doctrine) => JSON.stringify(normalize(doctrine), null, 2)

/** @returns {{doctrine: object|null, error: string|null}} — never throws on a paste. */
export function importDoctrine (text) {
  try {
    const parsed = JSON.parse(text)
    if (!isObj(parsed)) return { doctrine: null, error: 'a Doctrine must be a JSON object' }
    return { doctrine: normalize(parsed), error: null }
  } catch (e) {
    return { doctrine: null, error: e.message }
  }
}

// ── reading it ──────────────────────────────────────────────────────────────────────────────────

/** The sentinel `use` meaning "fall through to the unit's own ability list, in def order". */
export const ANY_ABILITY = '*'

/** The targeting list that applies to one actor — its Role's override, or the default (§4). */
export function targetModesFor (doctrine, roleId, ally = false) {
  const t = (ally ? doctrine.allyTargeting : doctrine.targeting) ?? DEFAULT_DOCTRINE.targeting
  return (roleId && t.byRole?.[roleId]) || t.default || ['lowestHpPct']
}

/**
 * @returns {{action: 'persuade'|'kill'|'decline', at: number, rule: number}} the first matching
 *   rule's verdict, and which rule it was — the post-mortem names that number (§4.2).
 */
export function recruitVerdict (ctx, target, doctrine = DEFAULT_DOCTRINE, exprCtx) {
  // Your rules, then the standing orders — one list, walked in order, first match wins. The badge
  // index counts across both, so a fire count on a standing order is as readable as one on yours.
  const rules = rulesFor(doctrine, 'recruit')
  for (let i = 0; i < rules.length; i++) {
    if (!evalRule(ctx, rules[i].when, exprCtx, 'recruit', i)) continue
    return { action: rules[i].action, at: rules[i].at ?? 0, rule: i }
  }
  return { action: 'kill', at: 0, rule: -1 }
}

/**
 * Evaluate one rule's gate, recording whether it fired (§4.1).
 *
 * A rule that never fires is the single most common authoring bug and is otherwise completely
 * invisible. The badge reads 0 in amber and that is the entire debugging story — which only works
 * if every gate in the game goes through this one function.
 *
 * A catch-all (`when: true`) is counted too. Skipping it as an optimisation is tempting and wrong:
 * the ELSE row is where a run's behaviour usually actually comes from, and a permanent 0 on the one
 * rule that fires constantly is worse than no badge at all.
 */
export function evalRule (ctx, when, exprCtx, editor, index) {
  const trace = ctx.trace
  if (when === true || when === undefined) {
    trace?.record(editor, index, true, null)
    return true
  }
  if (!trace) return ctx.forms.eval(when, exprCtx)
  const { value, steps } = trace.wantsSample(editor, index)
    ? ctx.forms.evalTraced(when, exprCtx)
    : { value: ctx.forms.eval(when, exprCtx), steps: null }
  trace.record(editor, index, !!value, steps)
  return value
}

/**
 * Which unit to drop when a recruit would push the party past the cap. Returning null declines the
 * recruit — every recruit past 12 is a decision about what you are willing to lose (§2).
 */
export function chooseCut (roster, registry, doctrine = DEFAULT_DOCTRINE, protect = new Set()) {
  const cuttable = roster.filter((u) => !u.pinned && !protect.has(u.uid))
  if (cuttable.length === 0) return null
  const cmp = CUT_RULES[doctrine.cut]
  if (!cmp) return null
  return cuttable.slice().sort((a, b) => cmp(a, b, registry, roster) || (a.uid - b.uid))[0]
}
