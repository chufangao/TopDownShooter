// Player Commands: focus · parley · brace · unleash. Issued between ticks, applied at the start of
// the next step, logged so a battle replays exactly.
import { TUNING, unitDef } from '../content/index.js'
import { persuadeChance } from './formula.js'
import { alive, livingOn, rowOf, COLS, ROWS } from './formation.js'
import { viable } from './ai.js'
import { emit, unitOf, stats, addStatus, invalidate } from './battle.js'

export const VERBS = ['focus', 'parley', 'brace', 'unleash']

const no = (reason) => ({ ok: false, reason })

// Party-wide persuade numbers: charm sums, threshold and chance multiplier take the best unit's.
function partyPersuade (battle) {
  const p = { charm: 0, threshold: TUNING.persuade.threshold, chance: 1, kin: new Set() }
  for (const u of livingOn(battle.units, 'party')) {
    const s = stats(battle, u)
    p.charm += s.charm
    p.threshold = Math.max(p.threshold, s.persuade.threshold)
    p.chance = Math.max(p.chance, s.persuade.chance)
    p.kin.add(unitDef(u.id).kin)
  }
  return p
}

export function parleyChance (battle, target, p = partyPersuade(battle)) {
  const def = unitDef(target.id)
  return persuadeChance({
    tier: def.tier,
    hpPct: target.hp / target.maxHp,
    charm: p.charm,
    kinAffinity: p.kin.has(def.kin) ? TUNING.persuade.kinAffinity : 1,
    itemMods: p.chance,
    attempts: target.persuadeAttempts
  })
}

// The ability Unleash would fire: the most expensive viable one.
export function unleashPick (battle, unit) {
  let best = null
  for (const { ability } of viable(battle, unit)) if (!best || ability.castCost > best.castCost) best = ability
  return best
}

export function canIssue (battle, verb, targetUid) {
  if (battle.over) return no('battle over')
  if (!VERBS.includes(verb)) return no('unknown command')
  if (battle.commandsLeft <= 0) return no('no commands left')
  const u = unitOf(battle, targetUid)
  if (!u || !alive(u)) return no('needs a living target')
  const wantFoe = verb === 'focus' || verb === 'parley'
  if ((u.side === 'foe') !== wantFoe) return no(wantFoe ? 'target a foe' : 'target an ally')
  if (verb === 'parley') {
    if (unitDef(u.id).boss) return no('cannot be persuaded')
    if (battle.parley || battle.pending.some((c) => c.verb === 'parley')) return no('a parley is already pending')
    const p = partyPersuade(battle)
    if (u.hp / u.maxHp > p.threshold) return no(`not weak enough (≤${Math.round(p.threshold * 100)}% HP)`)
    return { ok: true, chance: parleyChance(battle, u, p) }
  }
  if (verb === 'unleash' && !unleashPick(battle, u)) return no('nothing to unleash')
  return { ok: true }
}

export function issueCommand (battle, { verb, target }) {
  const check = canIssue(battle, verb, target)
  if (!check.ok) return check
  battle.commandsLeft--
  const cmd = { t: battle.t, verb, target }
  battle.commandLog.push(cmd)
  battle.pending.push(cmd)
  return { ok: true }
}

export function applyCommands (battle) {
  for (const { verb, target } of battle.pending) {
    const u = unitOf(battle, target)
    if (!alive(u)) { battle.commandsLeft++; continue }
    emit(battle, { type: 'command', verb, target })
    if (verb === 'focus') {
      battle.focus = { target, until: battle.t + TUNING.commands.focusTicks }
    } else if (verb === 'parley') {
      battle.parley = { target }
    } else if (verb === 'brace') {
      const behind = u.slot + COLS
      const free = rowOf(u.slot) < ROWS - 1 && !battle.units.some((x) => x.side === u.side && alive(x) && x.slot === behind)
      if (free) {
        u.slot = behind
        invalidate(battle)
        emit(battle, { type: 'move', target, slot: behind })
      }
      addStatus(battle, u, 'braced', battle.braceTicks)
    } else if (verb === 'unleash') {
      const pick = unleashPick(battle, u)
      if (pick) {
        u.gauge = Math.max(u.gauge, pick.castCost)
        u.unleash = pick.id
      }
    }
  }
  battle.pending = []
}

// Refund a pending parley whose target died or left before anyone could try it.
export function checkParley (battle) {
  if (!battle.parley || alive(unitOf(battle, battle.parley.target))) return
  emit(battle, { type: 'refund', verb: 'parley', target: battle.parley.target })
  battle.parley = null
  battle.commandsLeft++
}

export function attemptParley (battle, actor) {
  const target = unitOf(battle, battle.parley.target)
  if (!alive(target)) return checkParley(battle)
  battle.parley = null
  actor.gauge -= TUNING.commands.parleyCost
  const chance = parleyChance(battle, target)
  emit(battle, { type: 'action', actor: actor.uid, ability: 'parley', anim: 'cast_beam', element: 'holy', targets: [target.uid] })
  const success = battle.rng.chance(chance)
  emit(battle, { type: 'persuade', actor: actor.uid, target: target.uid, success, chance })
  if (!success) { target.persuadeAttempts++; return }
  target.left = true
  battle.recruited.push(target.uid)
  invalidate(battle, true)
  emit(battle, { type: 'recruit', target: target.uid, id: target.id })
}
