// Battle state, the op context, and the one place statuses turn into numbers.
//
// This file exists so `resolve.js` can stay ~200 lines and know nothing about any ability (§12).
// Everything an op is allowed to do to the world is a method on the context built here; ops never
// reach past it, and neither does the resolver.
//
// Pure JS. No clock, no Math.random, no Phaser.

import { resolveStats } from '../kernel/modifiers.js'
import { stableStringify, digest } from '../kernel/registry.js'
import { statBlock } from '../party.js'
import { activeSynergies } from '../synergy.js'
import { DEFAULT_DOCTRINE } from '../doctrine.js'
import { alive, livingOn, SLOTS } from './formation.js'

/**
 * @param {object} opts
 * @param {object} opts.kernel
 * @param {object} opts.tuning
 * @param {Array} opts.party  unit instances with `slot` already assigned
 * @param {Array} opts.foes
 * @returns {object} plain-JSON battle state
 */
export function createBattle ({ kernel, tuning, party, foes, seed = 0, floor = 1, boss = false }) {
  // `phase: 0` is reset here rather than carried: a boss met twice starts at phase 1 both times,
  // and a party unit that somehow has phases must not arrive at a fight already enraged (§6.3).
  const stamp = (u, side) => ({ ...u, side, gauge: 0, statuses: [], persuadeAttempts: 0, left: false, phase: 0 })
  const units = [
    ...party.map((u) => stamp(u, 'party')),
    ...foes.map((u) => stamp(u, 'foe'))
  ].filter((u) => u.slot >= 0 && u.slot < SLOTS)

  return {
    t: 0,
    seed,
    floor,
    /** Defers damage escalation (§6.3) — a 35 s bound on a fight designed to last 60 hides phase 3. */
    boss,
    over: false,
    winner: null,
    reason: null,
    /** uids that were talked round rather than killed (§2). The run reads this after the fight. */
    recruited: [],
    /**
     * The whole party, wounded and fallen included. Resonance counts who is still standing, but a
     * Recruit rule asking `kinCount(Drake) < 4` means "how many Drakes do I own" — otherwise a
     * party that is losing silently starts recruiting things it already has four of.
     */
    roster: party.map((u) => ({ uid: u.uid, defId: u.defId })),
    // Sorted once, never re-sorted: iteration order is (side, slot) forever, so two runs of the
    // same seed step units in the same order (§18.5).
    units: units.sort((a, b) => (a.side < b.side ? -1 : a.side > b.side ? 1 : a.slot - b.slot))
  }
}

/** A stable hash of the whole event timeline — the determinism regression's single assertion. */
export const timelineHash = (events) => digest(stableStringify(events))

/**
 * The context every op and hook runs against. One per battle; `actor`/`target` are attached per
 * emit rather than rebuilt, so a 4000-tick fuzz run does not allocate a context per hit.
 */
export function createContext (battle, { kernel, tuning, rng, onEvent, doctrine = DEFAULT_DOCTRINE, trace = null, signals = null }) {
  const R = kernel.registry
  const events = []
  let statCache = new Map()
  let synergyCache = new Map()

  const ctx = {
    battle,
    tuning,
    kernel,
    registry: R,
    hooks: kernel.hooks,
    forms: kernel.forms,
    rng,
    /**
     * ★ The player's policy, reaching the only place that consults it.
     *
     * Until now `resolve.js` called `chooseAction(ctx, unit)` with no doctrine, so policy fell back
     * to the frozen default on every tick — a run could carry a Doctrine, hand it to `awardXp` and
     * `addRecruits`, and still fight the whole battle by the shipped rules. Every editor in §4
     * would have been cosmetic. It lives on the context rather than being threaded through
     * `resolveTick`'s signature because that signature is the one contract in §12 that must not
     * grow.
     */
    doctrine,
    /** Rule instrumentation (§4.1), or null. Null is the default and costs one `?.` per gate. */
    trace,

    /**
     * The **write-only** face of the signal ledger (§4.3), or null. `core:emit_signal` writes into
     * it; nothing in a battle can read one back, because there is no read on the object to call.
     * That asymmetry is the invariant: a signal read inside `resolveTick` would make combat depend
     * on save history and §18.5's determinism regression would depend on how much you had played.
     */
    signals,
    get t () { return battle.t },
    events,

    emit (ev) {
      events.push(ev)
      onEvent?.(ev)
      return ev
    },

    /**
     * Active Resonances and Pacts on a side. Recomputed only when the roster changes — a death or
     * a recruit can drop a side below a threshold mid-fight, and it should.
     */
    synergies (side) {
      let list = synergyCache.get(side)
      if (!list) {
        list = activeSynergies(ctx, livingOn(battle, side))
        synergyCache.set(side, list)
      }
      return list
    },

    /** Modifier-resolved stats (§11.3). Cached per tick; any status change drops the cache. */
    statsOf (unit) {
      let s = statCache.get(unit.uid)
      if (!s) {
        const def = R.get('unit', unit.defId)
        s = resolveStats(statBlock(def, unit.lvl, tuning), collectModifiers(ctx, unit))
        statCache.set(unit.uid, s)
      }
      return s
    },

    invalidate (unit) { unit ? statCache.delete(unit.uid) : (statCache = new Map()) },

    /** A roster change invalidates both caches: synergies feed stats. */
    rosterChanged () {
      synergyCache = new Map()
      statCache = new Map()
    },

    unitOf: (uid) => battle.units.find((u) => u.uid === uid),

    damage (target, amount, meta = {}) {
      const ev = kernel.hooks.emit('damage:apply',
        { damage: Math.max(0, Math.round(amount)), absorbed: 0, cancel: false },
        withPair(ctx, meta.actor, target))
      if (ev.cancel) return 0

      // Rounded AFTER the hooks, not before: a status that multiplies damage by 0.95 would
      // otherwise leave a fraction on the wound and break "integer at the point of application"
      // (§2). The fuzzer caught this one.
      const applied = Math.max(0, Math.round(ev.damage - ev.absorbed))
      target.hp = Math.max(0, target.hp - applied)
      ctx.emit({
        t: battle.t,
        type: 'damage',
        actor: meta.actor?.uid ?? null,
        target: target.uid,
        damage: applied,
        isCrit: !!meta.isCrit,
        element: meta.element ?? null,
        hp: target.hp
      })
      if (target.hp === 0) kill(ctx, target, meta.actor)
      return applied
    },

    heal (target, amount, meta = {}) {
      const before = target.hp
      target.hp = Math.min(target.maxHp, target.hp + Math.max(0, Math.round(amount)))
      const healed = target.hp - before
      ctx.emit({ t: battle.t, type: 'heal', actor: meta.actor?.uid ?? null, target: target.uid, heal: healed, hp: target.hp })
      return healed
    },

    addStatus (target, statusId, dur, stacks = 1) {
      const def = R.get('status', statusId)
      // `def.dur` passes through whatever it is. A numeric duration counts down in `tickStatuses`;
      // the string 'battle' does not, which is how a status lasts the fight. Coercing a non-number
      // to 0 here — as this did — made every `dur: 'battle'` status expire on the tick after it
      // landed, silently, with no content shipping one yet to notice.
      const ev = kernel.hooks.emit('status:apply',
        { chance: 1, dur: dur || def.dur || 0, cancel: false },
        withPair(ctx, null, target))
      if (ev.cancel) return null

      const existing = target.statuses.find((s) => s.id === statusId)
      if (existing) {
        existing.dur = Math.max(existing.dur, ev.dur)
        existing.stacks = Math.min(def.stacks ?? 1, existing.stacks + stacks)
      } else {
        target.statuses.push({ id: statusId, dur: ev.dur, stacks: Math.min(def.stacks ?? 1, stacks), age: 0 })
      }
      ctx.invalidate(target)
      ctx.emit({ t: battle.t, type: 'status', target: target.uid, status: statusId, dur: ev.dur })
      return statusId
    },

    cleanse (target, { tag = 'debuff', count = 1 } = {}) {
      const hits = target.statuses.filter((s) => (R.get('status', s.id).tags ?? []).includes(tag)).slice(0, count)
      for (const s of hits) {
        target.statuses.splice(target.statuses.indexOf(s), 1)
        ctx.emit({ t: battle.t, type: 'cleanse', target: target.uid, status: s.id })
      }
      if (hits.length) ctx.invalidate(target)
      return hits.length
    },

    addGauge (target, amount) {
      target.gauge = Math.max(0, target.gauge + amount)
    },

    /**
     * Weaken then persuade (§2). The unit leaves the fight rather than dying — which is the whole
     * tension of the acquisition loop: you have to stop killing something while it is still
     * hitting you.
     */
    recruit (target, actor) {
      target.left = true
      target.recruitedBy = actor?.uid ?? null
      battle.recruited.push(target.uid)
      ctx.rosterChanged()
      ctx.emit({
        t: battle.t,
        type: 'recruit',
        actor: actor?.uid ?? null,
        target: target.uid,
        defId: target.defId,
        hp: target.hp
      })
    }
  }

  return ctx
}

/**
 * Max HP is resolved once, after synergies are known, because a Pact that grants +25% HP has to
 * mean something. Current HP scales with it so a mid-run party is not silently healed or hurt.
 */
export function initBattle (ctx) {
  for (const u of ctx.battle.units) {
    const max = Math.max(1, Math.round(ctx.statsOf(u).hp))
    if (max === u.maxHp) continue
    u.hp = Math.max(u.hp > 0 ? 1 : 0, Math.round(u.hp * (max / u.maxHp)))
    u.maxHp = max
  }
  return ctx
}

/**
 * A child context carrying who is involved. Prototype-linked rather than spread, so anything the
 * caller already attached (the ability, for instance) survives into the hook handlers.
 */
export const withPair = (ctx, actor, target) => Object.assign(Object.create(ctx), { actor, target })

function kill (ctx, unit, killer) {
  const ev = ctx.hooks.emit('unit:death', { cancel: false }, withPair(ctx, killer, unit))
  if (ev.cancel) { unit.hp = Math.max(1, unit.hp); return }
  unit.statuses = []
  // A death can drop a side below a synergy threshold mid-fight, and it should.
  ctx.rosterChanged()
  ctx.emit({ t: ctx.battle.t, type: 'death', target: unit.uid, actor: killer?.uid ?? null })
}

/**
 * Every modifier acting on a unit, from every source, in one flat list (§11.3). A status, a
 * Resonance and a Pact are indistinguishable by the time they get here — and because the pipeline
 * is order-independent, it does not matter that they arrive in this order rather than any other.
 */
function collectModifiers (ctx, unit) {
  const mods = []

  for (const s of unit.statuses) {
    const def = ctx.registry.get('status', s.id)
    for (const m of def.modifiers ?? []) {
      // A stacking status applies its multiplier once per stack, which keeps `stacks` meaningful
      // without a second syntax for it.
      for (let n = 0; n < (s.stacks ?? 1); n++) mods.push({ ...m, src: def.id })
    }
  }

  for (const syn of ctx.synergies(unit.side)) {
    for (const m of syn.modifiers) mods.push({ ...m, src: syn.id })
  }

  return mods
}

/** Variables the expression DSL sees (§11.6). Rebuilt per evaluation — expressions are cheap. */
export function exprContext (ctx, actor, target) {
  const side = actor?.side ?? 'party'
  return {
    // `melee` is bound so a hook row can gate on the incoming ability without a form that reaches
    // into the resolver — Scaled Wall needs exactly this and nothing more.
    vars: { self: actor, actor, target, melee: !!ctx.ability?.melee, ability: ctx.ability?.id ?? null },
    registry: ctx.registry,
    rng: ctx.rng,
    party: livingOn(ctx.battle, side),
    enemies: livingOn(ctx.battle, side === 'party' ? 'foe' : 'party'),
    partyCap: ctx.tuning.party.cap,
    t: ctx.battle.t,
    run: { floor: ctx.battle.floor }
  }
}

export { alive, livingOn }
