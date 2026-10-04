// The core effect verbs (§11.4). Content is JSON; verbs are JS — that is the one line in §16.1
// that decides what lives where. A pack registers its own verbs through the same `ops.register`
// via a tier-3 script (§13.3), so both parties have both doors.
//
// Every op runs against this context, which combat/resolve.js supplies at M1. Ops never reach
// past it, which is why `resolve.js` can stay ~200 lines and know nothing about any ability:
//
//   ctx = {
//     t                      current tick
//     rng                    the battle's named stream (§11.7) — the ONLY source of randomness
//     tuning                 the resolved tuning def (§16.1)
//     registry, hooks
//     emit(event)            append to the ordered timeline the renderer will play back (§8)
//     statsOf(unit)          modifier-resolved stat block (§11.3)
//     damage(unit, n, meta)  applies damage:apply hooks, clamps, handles death → returns applied
//     heal(unit, n, meta)
//     addStatus(unit, statusId, dur, stacks)
//     cleanse(unit, filter)
//     addGauge(unit, amount)
//   }

import { hitChance, critChance, affinity, rollVariance, computeDamage } from '../combat/formula.js'
import { withPair } from '../combat/battle.js'
import { persuadeInputs, rollChance, persuadable } from '../combat/persuade.js'

export function registerCoreOps (ops) {
  // Elements are content ids, not bare strings (invariant §18.3), so a mod can add one and the
  // loader's dangling-reference pass is what proves an ability names a real element.
  ops.register('core:damage', {
    schema: {
      power: 'number',
      element: 'id?',
      pierce: { type: 'number', default: 0, min: 0, max: 1 },
      cannotMiss: { type: 'boolean', default: false }
    },
    run (ctx, args, actor, targets) {
      const a = ctx.statsOf(actor)
      const elDef = args.element ? ctx.registry.get('element', args.element) : null

      for (const target of targets) {
        if (target.hp <= 0) continue
        const d = ctx.statsOf(target)

        if (!args.cannotMiss && !ctx.rng.chance(hitChance(a.acc, d.eva, ctx.tuning))) {
          ctx.emit({ t: ctx.t, type: 'miss', actor: actor.uid, target: target.uid })
          continue
        }

        const isCrit = ctx.rng.chance(critChance(a.crt, ctx.tuning))
        const targetDef = ctx.registry.get('unit', target.defId)

        // Rows, Pacts, statuses and keystones all negotiate here, through one proposal (§11.5).
        const ev = ctx.hooks.emit('damage:compute', {
          add: 0,
          mul: (a.damage?.dealt ?? 1) * (d.damage?.taken ?? 1),
          crit: isCrit,
          critMul: ctx.tuning.crit.mult,
          element: args.element ?? null,
          pierce: args.pierce
        }, withPair(ctx, actor, target))

        const damage = computeDamage({
          power: args.power,
          atk: a.atk,
          def: d.def,
          affinity: affinity(elDef, targetDef.element),
          isCrit: ev.crit,
          critMul: ev.critMul,
          variance: rollVariance(ctx.rng, ctx.tuning),
          add: ev.add,
          mul: ev.mul,
          pierce: ev.pierce
        }, ctx.tuning)

        // The renderer reads event.damage; it never computes it (§7).
        ctx.damage(target, damage, { actor, element: ev.element, isCrit: ev.crit })
      }
    }
  })

  ops.register('core:heal', {
    schema: { power: 'number', overheal: { type: 'boolean', default: false } },
    run (ctx, args, actor, targets) {
      const a = ctx.statsOf(actor)
      for (const target of targets) {
        if (target.hp <= 0) continue
        const amount = Math.max(1, Math.round(args.power * (a.atk / ctx.tuning.damage.atkDivisor) *
          (a.heal?.given ?? 1) * (ctx.statsOf(target).heal?.taken ?? 1)))
        ctx.heal(target, amount, { actor, overheal: args.overheal })
      }
    }
  })

  ops.register('core:apply_status', {
    schema: {
      status: 'id',
      dur: { type: 'int', default: 0 },
      chance: { type: 'number', default: 1, min: 0, max: 1 },
      stacks: { type: 'int', default: 1 }
    },
    run (ctx, args, actor, targets) {
      for (const target of targets) {
        if (target.hp <= 0) continue
        if (args.chance < 1 && !ctx.rng.chance(args.chance)) {
          ctx.emit({ t: ctx.t, type: 'resist', actor: actor.uid, target: target.uid, status: args.status })
          continue
        }
        ctx.addStatus(target, args.status, args.dur, args.stacks)
      }
    }
  })

  ops.register('core:cleanse', {
    schema: { tag: 'string?', count: { type: 'int', default: 1 } },
    run (ctx, args, actor, targets) {
      for (const target of targets) {
        if (target.hp <= 0) continue
        ctx.cleanse(target, { tag: args.tag ?? 'debuff', count: args.count })
      }
    }
  })

  ops.register('core:persuade', {
    // Persuade is an action a unit spends its gauge on, not a post-battle roll (§2). Failure costs
    // the action, deals no damage, and hardens the target — which is exactly what makes "stop
    // hitting it and talk" a real decision rather than a free upside.
    schema: { bonus: { type: 'number', default: 1 } },
    run (ctx, args, actor, targets) {
      for (const target of targets) {
        if (target.hp <= 0 || target.left) continue

        // Immunity is refused here as well as filtered by policy (§6.3), because an op is reachable
        // by a mod's ability and by a hand-written Doctrine, and "a boss cannot be talked to" must
        // hold for every path into this function rather than for the one the shipped policy takes.
        if (!persuadable(ctx.registry.get('unit', target.defId))) {
          ctx.emit({ t: ctx.t, type: 'persuade', actor: actor.uid, target: target.uid, success: false, reason: 'immune' })
          continue
        }

        const inputs = persuadeInputs(ctx, actor, target)
        if (inputs.hpPct > inputs.threshold) {
          ctx.emit({ t: ctx.t, type: 'persuade', actor: actor.uid, target: target.uid, success: false, reason: 'too_strong' })
          continue
        }

        const roll = ctx.hooks.emit('persuade:roll',
          { chance: rollChance(inputs, ctx.tuning) * args.bonus },
          withPair(ctx, actor, target))

        const result = ctx.hooks.emit('persuade:result',
          { success: ctx.rng.chance(roll.chance) },
          withPair(ctx, actor, target))

        ctx.emit({
          t: ctx.t,
          type: 'persuade',
          actor: actor.uid,
          target: target.uid,
          success: result.success,
          chance: roll.chance,
          hpPct: inputs.hpPct,
          attempts: inputs.attempts
        })

        if (result.success) ctx.recruit(target, actor)
        else target.persuadeAttempts = (target.persuadeAttempts ?? 0) + 1
      }
    }
  })

  ops.register('core:emit_signal', {
    // ★ The verb §11.4 shipped with no consumer, now that it has one (§4.3).
    //
    //   "A verb with no consumer is worth keeping only when something later grows into it, and this
    //    is the example."
    //
    // Content writes into the signal ledger, a Precedent watches it, and a pack's ability can raise
    // a pack's own signal — `kindled:ignite:cast` — with no core change. The direction is one-way by
    // construction: `ctx.signals` is the write-only face of the ledger (§`signals.js`), so an op
    // cannot read one back and make combat depend on save history.
    schema: {
      name: 'string',
      /** Recorded alongside the count, so a Precedent can say which one it was. */
      tag: 'string?',
      /** `actor` names the unit that acted; `target` raises one signal per unit it landed on. */
      who: { type: 'string', default: 'target' }
    },
    run (ctx, args, actor, targets) {
      const emit = ctx.signals?.emit
      if (!emit) return
      const subjects = args.who === 'actor' ? [actor] : targets
      for (const u of subjects) {
        if (!u) continue
        ctx.signals.emit(args.name, { defId: u.defId, tag: args.tag ?? null, t: ctx.t })
      }
    }
  })

  ops.register('core:gauge', {
    // Positive fills the action gauge, negative delays. Swarm Logic (§3) is this op plus a hook.
    schema: { amount: 'number' },
    run (ctx, args, actor, targets) {
      for (const target of targets) {
        if (target.hp <= 0) continue
        ctx.addGauge(target, args.amount)
        ctx.emit({ t: ctx.t, type: 'gauge', actor: actor.uid, target: target.uid, amount: args.amount })
      }
    }
  })

  return ops
}
