// The core rule set — registered on the hook bus exactly the way a mod's would be (§11.5).
//
// Split out of `battle.js` because these three subscribers are the only place in the sim where
// *game rules* are written as JavaScript rather than as data, and that makes them the one file
// worth watching. `resolve.js` has a line-count alarm (§18.9) for precisely this reason; `battle.js`
// was carrying the same risk with no alarm and no separation, which §19 listed as a debt. Everything
// here is now visible in one 60-line file: if a fourth rule appears, it should have to justify
// itself against "why is this not a status, a Resonance or a Pact?"
//
// Nothing in here knows about any specific ability, unit or Pact. Two of the three are pure
// arithmetic over tuning constants, and the first is the one subscriber that applies *all*
// declarative content.

import { HOOK_POINTS } from '../kernel/hooks.js'
import { exprContext } from './battle.js'
import { rowMods } from './formation.js'

/**
 * ★ The great unification (§11.5). Every declarative `hooks[]` row in the game — on a status, a
 * Resonance, a Pact, and later an item, a keystone, a shrine curse or a Lattice node — is applied
 * by this one subscriber. One activation check, one deactivation path, one place to debug.
 *
 * Scaled Wall is a row here and nothing else:
 *   { point: 'damage:compute', on: 'target', field: 'mul', op: 'mul', v: 0.8,
 *     when: ['and', ['eq', ['row', '$target'], 0], '$melee'] }
 */
function applyEffectRows (point, proposal, ctx) {
  for (const role of ['actor', 'target']) {
    const unit = ctx[role]
    if (!unit) continue
    for (const { row } of collectRows(ctx, unit, point, role)) {
      if (row.when && !ctx.forms.eval(row.when, exprContext(ctx, ctx.actor, ctx.target))) continue
      proposal[row.field] = row.op === 'set' ? row.v
        : row.op === 'add' ? (proposal[row.field] ?? 0) + row.v
          : (proposal[row.field] ?? 1) * row.v
    }
  }
}

/**
 * Every declarative hook row acting on a unit, from every source, with a total order.
 * @returns {Array<{row, src}>}
 */
function collectRows (ctx, unit, point, role) {
  const rows = []
  const take = (list, src) => {
    for (const row of list ?? []) {
      if (row.point === point && (row.on ?? 'target') === role) rows.push({ row, src })
    }
  }
  for (const s of unit.statuses) take(ctx.registry.get('status', s.id).hooks, s.id)
  for (const syn of ctx.synergies(unit.side)) take(syn.hooks, syn.id)

  return rows.sort((a, b) =>
    ((a.row.prio ?? 0) - (b.row.prio ?? 0)) || (a.src < b.src ? -1 : a.src > b.src ? 1 : 0))
}

/** Row modifiers (§3). Melee only — ranged and magic ignore the grid's depth. */
function applyRowModifiers (proposal, ctx) {
  if (!ctx.ability?.melee || !ctx.actor || !ctx.target) return
  proposal.mul *= rowMods(ctx.tuning, ctx.actor.slot).meleeDealt
  proposal.mul *= rowMods(ctx.tuning, ctx.target.slot).meleeTaken
}

/**
 * Escalation — the pressure valve that makes a stalemate impossible rather than merely unlikely.
 *
 * Two sides that both field healers can match each other's output indefinitely; the fuzzer found
 * 3.5% of battles running to the tick ceiling that way. Balancing healing down until it stops
 * happening is a treadmill, because every new heal, shield or Pact re-opens it. Instead damage
 * ramps once a fight has gone long, which bounds every battle by construction and reads as a fight
 * getting desperate rather than as a timer.
 */
function applyEscalation (proposal, ctx) {
  const e = ctx.tuning?.escalation
  if (!e || !ctx.battle) return
  const over = ctx.battle.t - e.startTick * (ctx.battle.boss ? (e.bossMult ?? 1) : 1)
  if (over <= 0) return
  proposal.mul *= Math.min(e.max, 1 + over * e.perTick)
}

/**
 * Boss phases (§6.3) — HP-fraction thresholds that apply a status.
 *
 * The fourth core rule, and it earns its place the same way the first does: it applies declarative
 * content rather than being any. A phase is a data row on a unit def — `{at: 0.6, grant: ...}` —
 * and a status is already `{modifiers, hooks, dur}`, so every boss mechanic in the game is JSON and
 * the code below is all of the machinery. That is the §6.3 claim, and it is why this is not "one
 * special case for bosses": any unit with `phases` gets them, ours or a pack's.
 *
 * Checked at tick start rather than inside `damage()`, because the arrangement layer had a rule
 * pulled back out of it once already (§19 debt 4) and a phase landing 50 ms late is invisible.
 */
function applyPhases (proposal, ctx) {
  for (const unit of ctx.battle.units) {
    const phases = ctx.registry.get('unit', unit.defId).phases
    if (!phases || unit.hp <= 0 || unit.left) continue
    // A loop, not an if: one enormous hit can cross two thresholds, and skipping the one it jumped
    // would mean the hardest-hitting party never sees the middle phase at all.
    while (unit.phase < phases.length && unit.hp / unit.maxHp <= phases[unit.phase].at) {
      const { grant } = phases[unit.phase++]
      ctx.emit({ t: ctx.battle.t, type: 'phase', target: unit.uid, phase: unit.phase, status: grant })
      ctx.addStatus(unit, grant)
    }
  }
}

export function registerCoreRules (kernel) {
  for (const [point, fields] of Object.entries(HOOK_POINTS)) {
    if (fields.length === 0) continue
    kernel.hooks.on(point, 'core:effect_rows', 50, (ev, ctx) => applyEffectRows(point, ev, ctx))
  }
  kernel.hooks.on('damage:compute', 'core:row_modifiers', 20, applyRowModifiers)
  kernel.hooks.on('damage:compute', 'core:escalation', 10, applyEscalation)
  kernel.hooks.on('tick:start', 'core:phases', 10, applyPhases)
  return kernel
}
