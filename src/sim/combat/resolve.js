// ★ The load-bearing file (§8, §12).
//
//   const { state, events } = resolveTick(state, rng, ctx)
//
// Combat resolves entirely here, in pure JS. The sim emits an ordered event timeline; Phaser plays
// that timeline back; animation never feeds back into resolution. Damage is an explicit computed
// field on an event, not an emergent property of anything visual.
//
// This file fills gauges, asks policy for an action, looks up ops, runs them, and emits events. It
// knows nothing about any specific ability, and it must stay under 250 lines permanently
// (invariant §18.9) — if it grows, something that should have been an op or a hook got hardcoded.

import { chooseAction } from '../policy/index.js'
import { createContext, initBattle, timelineHash, alive, livingOn } from './battle.js'

const child = (ctx, fields) => Object.assign(Object.create(ctx), fields)

/**
 * One 50 ms logical tick (§2). Deterministic: nothing here reads wall-clock time or frame delta.
 *
 * @param {object} state  battle state, mutated in place and returned
 * @param {object} rng    the battle's named stream (§11.7) — the only source of randomness
 * @param {object} ctx    the op context from `createContext`
 * @returns {{state: object, events: Array}} events emitted during this tick, in order
 */
export function resolveTick (state, rng, ctx) {
  const from = ctx.events.length
  if (state.over) return { state, events: [] }

  ctx.hooks.emit('tick:start', {}, ctx)
  tickStatuses(state, ctx)

  for (const unit of state.units) {
    if (state.over || !alive(unit)) continue
    fillGauge(unit, ctx)
    act(unit, ctx)
  }

  checkEnd(state, ctx)
  state.t++
  return { state, events: ctx.events.slice(from) }
}

/** gaugeRate = (base + spd / divisor) × the modifier pipeline's multiplier (§2, §11.3). */
function fillGauge (unit, ctx) {
  const stats = ctx.statsOf(unit)
  const base = ctx.tuning.gauge.base + stats.spd / ctx.tuning.gauge.spdDivisor
  const ev = ctx.hooks.emit('gauge:fill', { rate: base * (stats.gauge.rate ?? 1) }, child(ctx, { actor: unit, target: unit }))
  unit.gauge += Math.max(0, ev.rate)
}

/** At most one action per unit per gauge fill (invariant §18.11). */
function act (unit, ctx) {
  const chosen = chooseAction(ctx, unit)
  if (!chosen || unit.gauge < chosen.cost) return

  const { ability, targets, cost } = chosen
  unit.gauge -= cost                                   // overflow is kept, never discarded (§2)

  ctx.emit({
    t: ctx.battle.t,
    type: 'action',
    actor: unit.uid,
    ability: ability.id,
    anim: ability.anim ?? null,
    element: ability.element ?? null,
    targets: targets.map((u) => u.uid)
  })
  ctx.hooks.emit('action:chosen', {}, child(ctx, { actor: unit, ability }))

  const actionCtx = child(ctx, { actor: unit, ability })
  for (const effect of ability.effects) {
    ctx.kernel.ops.run(effect, actionCtx, unit, targets)
  }
}

/** Statuses tick before anyone acts, so a 1-tick debuff is worth exactly one tick. */
function tickStatuses (state, ctx) {
  for (const unit of state.units) {
    if (!alive(unit) || unit.statuses.length === 0) continue
    const bearerCtx = child(ctx, { actor: unit, target: unit })

    for (const status of unit.statuses.slice()) {
      const def = ctx.registry.get('status', status.id)
      // Tick effects fire on a period, not every tick. At 20 Hz an "every tick" Regen heals 20×
      // a second and out-heals the entire field — the fuzzer found exactly that stall.
      status.age = (status.age ?? 0) + 1
      if (def.tick?.length && status.age % (def.tickEvery ?? ctx.tuning.tick.hz) === 0) {
        for (const effect of def.tick) ctx.kernel.ops.run(effect, bearerCtx, unit, [unit])
      }
      if (typeof status.dur !== 'number') continue
      status.dur--
      if (status.dur > 0) continue
      const at = unit.statuses.indexOf(status)
      if (at >= 0) unit.statuses.splice(at, 1)
      ctx.invalidate(unit)
      ctx.emit({ t: state.t, type: 'expire', target: unit.uid, status: status.id })
    }
  }
}

function checkEnd (state, ctx) {
  const party = livingOn(state, 'party').length
  const foe = livingOn(state, 'foe').length
  if (party && foe && state.t + 1 < ctx.tuning.tick.ceiling) return

  state.over = true
  state.winner = party && !foe ? 'party' : foe && !party ? 'foe' : null
  // A stall is a bug, not a draw — the fuzzer asserts it never happens (§10).
  state.reason = party && foe ? 'tick-ceiling' : 'wipe'
  ctx.hooks.emit('battle:end', {}, ctx)
  ctx.emit({ t: state.t, type: 'battle:end', winner: state.winner, reason: state.reason })
}

/**
 * Run a whole battle headless. This is what `tools/sim.js`, the balance harness, the fuzzer and
 * the Web Worker all call; the renderer calls it too and then plays the events back (§8).
 *
 * @returns {{state, events, hash, ticks}}
 */
export function runBattle (battle, { kernel, tuning, rng, onEvent = null, maxTicks = null, doctrine, trace = null, signals = null } = {}) {
  trace?.beginBattle()                              // "fired in the last battle" means this one
  const ctx = createContext(battle, { kernel, tuning, rng, onEvent, doctrine, trace, signals })
  initBattle(ctx)                                   // synergies decide max HP before anyone acts

  ctx.hooks.emit('battle:start', {}, ctx)
  ctx.emit({
    t: 0,
    type: 'battle:start',
    units: battle.units.map((u) => ({ uid: u.uid, defId: u.defId, side: u.side, slot: u.slot, hp: u.hp, maxHp: u.maxHp })),
    synergies: ['party', 'foe'].flatMap((side) =>
      ctx.synergies(side).map((s) => ({ side, id: s.id, kind: s.kind, name: s.name })))
  })

  const ceiling = maxTicks ?? tuning.tick.ceiling
  while (!battle.over && battle.t < ceiling) resolveTick(battle, rng, ctx)

  return { state: battle, events: ctx.events, hash: timelineHash(ctx.events), ticks: battle.t }
}
