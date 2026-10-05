// Real-time auto-battle in 50 ms ticks. Pure: all randomness comes from battle.rng.
import { TUNING, unitDef, abilityDef, statusDef, elementDef } from '../content/index.js'
import { createRng, hashString } from './rng.js'
import { hitChance, critChance, affinity, rollVariance, computeDamage } from './formula.js'
import { alive, livingOn, rowMods, SLOTS } from './formation.js'
import { statsOf, activeSynergies } from './stats.js'
import { chooseAction } from './ai.js'
import { issueCommand, applyCommands, attemptParley, checkParley } from './commands.js'

export function createBattle ({
  party, foes, seed, floor = 1, boss = false, partyMods = [], foeMods = [],
  commands = TUNING.commands.perBattle, braceTicks = TUNING.commands.braceTicks
}) {
  const stamp = (u, side) => ({ ...u, side, gauge: 0, statuses: [], persuadeAttempts: 0, left: false, phase: 0, unleash: null })
  const units = [...party.map((u) => stamp(u, 'party')), ...foes.map((u) => stamp(u, 'foe'))]
    .filter((u) => u.hp > 0 && u.slot >= 0 && u.slot < SLOTS)
    .sort((a, b) => (a.side < b.side ? -1 : a.side > b.side ? 1 : a.slot - b.slot))

  const battle = {
    t: 0, seed, floor, boss, over: false, winner: null, reason: null,
    units, events: [], recruited: [],
    commandsLeft: commands, commandLog: [], pending: [], focus: null, parley: null,
    partyMods, foeMods, braceTicks,
    rng: createRng(seed).stream('battle'),
    syn: null, cache: new Map()
  }

  // Max HP includes HP mods (synergies, relics); current HP keeps its fraction.
  for (const u of units) {
    const max = Math.max(1, Math.round(stats(battle, u).hp))
    if (max === u.maxHp) continue
    u.hp = Math.max(1, Math.round(u.hp * max / u.maxHp))
    u.maxHp = max
  }

  emit(battle, {
    type: 'battle:start',
    units: units.map((u) => ({ uid: u.uid, id: u.id, side: u.side, slot: u.slot, hp: u.hp, maxHp: u.maxHp })),
    synergies: ['party', 'foe'].flatMap((side) => synergiesOf(battle, side).map((s) => ({ side, id: s.id, name: s.name })))
  })
  return battle
}

// One tick. Returns the events it emitted.
export function stepBattle (battle) {
  if (battle.over) return []
  const from = battle.events.length
  if (battle.focus && (battle.t >= battle.focus.until || !alive(unitOf(battle, battle.focus.target)))) battle.focus = null
  applyCommands(battle)
  phases(battle)
  tickStatuses(battle)
  for (const u of battle.units) {
    if (!alive(u)) continue
    const s = stats(battle, u)
    u.gauge += Math.max(0, (TUNING.gauge.base + s.spd / TUNING.gauge.spdDivisor) * s.gauge.rate)
    act(battle, u)
  }
  checkParley(battle)
  checkEnd(battle)
  battle.t++
  return battle.events.slice(from)
}

export function runBattle (battle, { commands = [] } = {}) {
  const queue = commands.slice().sort((a, b) => a.t - b.t)
  let i = 0
  while (!battle.over) {
    for (; i < queue.length && queue[i].t <= battle.t; i++) {
      if (queue[i].t === battle.t) issueCommand(battle, queue[i])
    }
    stepBattle(battle)
  }
  return { events: battle.events, hash: timelineHash(battle.events), winner: battle.winner, ticks: battle.t }
}

export const timelineHash = (events) => hashString(JSON.stringify(events))

export function emit (battle, ev) {
  ev = { t: battle.t, ...ev }
  battle.events.push(ev)
  return ev
}

export const unitOf = (battle, uid) => battle.units.find((u) => u.uid === uid)

function synergiesOf (battle, side) {
  if (!battle.syn) {
    battle.syn = {
      party: activeSynergies(livingOn(battle.units, 'party')),
      foe: activeSynergies(livingOn(battle.units, 'foe'))
    }
  }
  return battle.syn[side]
}

export function modsFor (battle, unit) {
  const mods = []
  for (const s of unit.statuses) {
    for (const m of statusDef(s.id).mods ?? []) for (let n = 0; n < s.stacks; n++) mods.push(m)
  }
  for (const syn of synergiesOf(battle, unit.side)) mods.push(...syn.mods)
  mods.push(...(unit.side === 'party' ? battle.partyMods : battle.foeMods))
  return mods
}

// Cached; anything that changes statuses, rows or the roster calls invalidate().
export function stats (battle, unit) {
  let s = battle.cache.get(unit.uid)
  if (!s) battle.cache.set(unit.uid, (s = statsOf(unit, modsFor(battle, unit))))
  return s
}

export function invalidate (battle, roster = false) {
  battle.cache.clear()
  if (roster) battle.syn = null
}

function act (battle, u) {
  const parleyReady = u.side === 'party' && battle.parley && !u.unleash && u.gauge >= TUNING.commands.parleyCost
  if (parleyReady) return attemptParley(battle, u)
  const chosen = chooseAction(battle, u)
  u.unleash = null
  if (!chosen) return
  const { ability, targets, cost } = chosen
  u.gauge -= cost
  emit(battle, { type: 'action', actor: u.uid, ability: ability.id, anim: ability.anim, element: ability.element, targets: targets.map((x) => x.uid) })
  for (const effect of ability.effects) runEffect(battle, effect, u, targets, ability)
}

function escalation (battle) {
  const e = TUNING.escalation
  const over = battle.t - e.startTick * (battle.boss ? e.bossMult : 1)
  return over > 0 ? Math.min(e.max, 1 + over * e.perTick) : 1
}

function runEffect (battle, effect, actor, targets, ability = null) {
  const a = stats(battle, actor)
  for (const target of targets) {
    if (!alive(target)) continue
    if (effect.op === 'damage') {
      const d = stats(battle, target)
      if (!battle.rng.chance(hitChance(a.acc, d.eva))) {
        emit(battle, { type: 'miss', actor: actor.uid, target: target.uid })
        continue
      }
      const isCrit = battle.rng.chance(critChance(a.crt))
      let mul = a.damage.dealt * d.damage.taken * escalation(battle)
      if (ability?.melee) mul *= rowMods(actor.slot).meleeDealt * rowMods(target.slot).meleeTaken
      const damage = computeDamage({
        power: effect.power,
        atk: a.atk,
        def: d.def,
        affinity: affinity(elementDef(effect.element), unitDef(target.id).element),
        isCrit,
        variance: rollVariance(battle.rng),
        mul
      })
      applyDamage(battle, target, damage, { actor, isCrit, element: effect.element })
    } else if (effect.op === 'heal') {
      const amount = Math.max(1, Math.round(effect.power * a.atk / TUNING.damage.atkDivisor * a.heal.given))
      const before = target.hp
      target.hp = Math.min(target.maxHp, target.hp + amount)
      emit(battle, { type: 'heal', actor: actor.uid, target: target.uid, heal: target.hp - before, hp: target.hp })
    } else if (effect.op === 'apply_status') {
      if (effect.chance === undefined || battle.rng.chance(effect.chance)) addStatus(battle, target, effect.status, effect.dur)
    } else if (effect.op === 'cleanse') {
      const hits = target.statuses.filter((s) => statusDef(s.id).tags.includes(effect.tag)).slice(0, effect.count)
      for (const s of hits) {
        target.statuses.splice(target.statuses.indexOf(s), 1)
        emit(battle, { type: 'cleanse', target: target.uid, status: s.id })
      }
      if (hits.length) invalidate(battle)
    } else if (effect.op === 'gauge') {
      if (effect.amount < 0 && unitDef(target.id).boss) continue
      target.gauge = Math.max(0, target.gauge + effect.amount)
      emit(battle, { type: 'gauge', actor: actor.uid, target: target.uid, amount: effect.amount })
    } else {
      throw new Error(`unknown effect op "${effect.op}"`)
    }
  }
}

function applyDamage (battle, target, amount, { actor, isCrit, element }) {
  target.hp = Math.max(0, target.hp - amount)
  emit(battle, { type: 'damage', actor: actor.uid, target: target.uid, damage: amount, isCrit, element, hp: target.hp })
  if (target.hp > 0) return
  target.statuses = []
  invalidate(battle, true)
  emit(battle, { type: 'death', target: target.uid, actor: actor.uid })
}

export function addStatus (battle, target, id, dur) {
  const def = statusDef(id)
  dur = dur || def.dur
  const have = target.statuses.find((s) => s.id === id)
  if (have) {
    have.dur = have.dur === 'battle' || dur === 'battle' ? 'battle' : Math.max(have.dur, dur)
    have.stacks = Math.min(def.stacks, have.stacks + 1)
  } else {
    target.statuses.push({ id, dur, stacks: 1, age: 0 })
  }
  invalidate(battle)
  emit(battle, { type: 'status', target: target.uid, status: id, dur })
}

function tickStatuses (battle) {
  for (const u of battle.units) {
    if (!alive(u) || !u.statuses.length) continue
    for (const s of u.statuses.slice()) {
      const def = statusDef(s.id)
      s.age++
      if (def.tick && s.age % def.tickEvery === 0) {
        for (const effect of def.tick) runEffect(battle, effect, u, [u])
      }
      if (s.dur === 'battle' || --s.dur > 0) continue
      u.statuses.splice(u.statuses.indexOf(s), 1)
      invalidate(battle)
      emit(battle, { type: 'expire', target: u.uid, status: s.id })
    }
  }
}

// HP thresholds grant a status; a loop, so one big hit can cross two.
function phases (battle) {
  for (const u of battle.units) {
    const list = unitDef(u.id).phases
    if (!list || !alive(u)) continue
    while (u.phase < list.length && u.hp / u.maxHp <= list[u.phase].at) {
      const { grant } = list[u.phase++]
      emit(battle, { type: 'phase', target: u.uid, phase: u.phase, status: grant })
      addStatus(battle, u, grant)
    }
  }
}

function checkEnd (battle) {
  const party = livingOn(battle.units, 'party').length
  const foe = livingOn(battle.units, 'foe').length
  if (party && foe && battle.t + 1 < TUNING.tick.ceiling) return
  battle.over = true
  battle.winner = party && !foe ? 'party' : foe && !party ? 'foe' : null
  battle.reason = party && foe ? 'tick-ceiling' : 'wipe'
  emit(battle, { type: 'battle:end', winner: battle.winner, reason: battle.reason })
}
