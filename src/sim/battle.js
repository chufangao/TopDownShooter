import { TUNING } from '../tuning.js'
import { unitDef, statusDef, elementDef, abilityDef } from '../content.js'
import { createRng, hashString } from './rng.js'
import { alive, livingOn, SLOTS, rowMods, statsOf, activeSynergies, rowOf, COLS, ROWS, reachable, expand, enemySide, isAllyShape } from './unit.js'

// Everything inside a fight: the tick loop, effects and statuses, the player's Commands, unit AI and
// the combat formulas. Real-time in 50 ms ticks; pure: all randomness comes from battle.rng.

// ── battle loop ──────────────────────────────────────────────────────────────────────────────────

// party/foes are run units { uid, id, lvl, hp, maxHp, slot }; the battle works on copies.
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
    syn: {}, cache: new Map()
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

// Plays a battle to the end, issuing each { t, verb, target } at its tick.
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

// ── events, stats, effects, statuses ─────────────────────────────────────────────────────────────

function emit (battle, ev) {
  ev = { t: battle.t, ...ev }
  battle.events.push(ev)
  return ev
}

const unitOf = (battle, uid) => battle.units.find((u) => u.uid === uid)

// Units only ever leave a battle (death, recruit), never return, so the living count versions the roster.
function synergiesOf (battle, side) {
  const living = livingOn(battle.units, side)
  const c = battle.syn[side]
  if (c?.n === living.length) return c.list
  return (battle.syn[side] = { n: living.length, list: activeSynergies(living) }).list
}

function modsFor (battle, unit) {
  const mods = []
  for (const s of unit.statuses) {
    for (const m of statusDef(s.id).mods ?? []) for (let n = 0; n < s.stacks; n++) mods.push(m)
  }
  for (const syn of synergiesOf(battle, unit.side)) mods.push(...syn.mods)
  mods.push(...(unit.side === 'party' ? battle.partyMods : battle.foeMods))
  return mods
}

// Cached on everything stats depend on, so nothing has to remember to invalidate it.
export function stats (battle, unit) {
  synergiesOf(battle, unit.side)
  const key = `${unit.slot}|${battle.syn[unit.side].n}|${unit.statuses.map((s) => s.id + s.stacks).join()}`
  const hit = battle.cache.get(unit.uid)
  if (hit?.key === key) return hit.s
  const s = statsOf(unit, modsFor(battle, unit))
  battle.cache.set(unit.uid, { key, s })
  return s
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
  emit(battle, { type: 'death', target: target.uid, actor: actor.uid })
}

function addStatus (battle, target, id, dur) {
  const def = statusDef(id)
  dur = dur || def.dur
  const have = target.statuses.find((s) => s.id === id)
  if (have) {
    have.dur = have.dur === 'battle' || dur === 'battle' ? 'battle' : Math.max(have.dur, dur)
    have.stacks = Math.min(def.stacks, have.stacks + 1)
  } else {
    target.statuses.push({ id, dur, stacks: 1, age: 0 })
  }
  emit(battle, { type: 'status', target: target.uid, status: id, dur })
}

// ── commands ─────────────────────────────────────────────────────────────────────────────────────

// Focus · Parley · Brace · Unleash. Issued between ticks, applied at the start of the next step, and
// logged in battle.commandLog so a battle replays exactly.

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

function parleyChance (battle, target, p = partyPersuade(battle)) {
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

function applyCommands (battle) {
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
function checkParley (battle) {
  if (!battle.parley || alive(unitOf(battle, battle.parley.target))) return
  emit(battle, { type: 'refund', verb: 'parley', target: battle.parley.target })
  battle.parley = null
  battle.commandsLeft++
}

function attemptParley (battle, actor) {
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
  emit(battle, { type: 'recruit', target: target.uid, id: target.id })
}

// ── unit AI ──────────────────────────────────────────────────────────────────────────────────────

// Default policy: try abilities in def order; skip one whose `when` fails or that has no legal
// target; if the first viable one is unaffordable, bank gauge rather than fall through.

function view (battle, unit) {
  return {
    self: unit,
    allies: livingOn(battle.units, unit.side),
    enemies: livingOn(battle.units, enemySide(unit.side)),
    t: battle.t
  }
}

// Abilities that pass their condition and have a legal target, in def order.
export function viable (battle, unit) {
  const s = view(battle, unit)
  const out = []
  for (const id of unitDef(unit.id).abilities) {
    const ability = abilityDef(id)
    if (ability.when && !ability.when(s)) continue
    const candidates = reachable(battle.units, unit, ability)
    if (candidates.length) out.push({ ability, candidates })
  }
  return out
}

const byHpPct = (a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.slot - b.slot
const lowest = (list) => list.slice().sort(byHpPct)[0]

// Aggro roll over the rows that hold a candidate (front draws most).
function pickRow (candidates, rng) {
  const rows = []
  const weights = []
  for (let r = 0; r < ROWS; r++) {
    const inRow = candidates.filter((u) => rowOf(u.slot) === r)
    if (!inRow.length) continue
    rows.push(inRow)
    weights.push(rowMods(r * 4).aggro)
  }
  return rows.length === 1 ? rows[0] : rng.weighted(rows, weights)
}

function pickTarget (battle, unit, ability, candidates) {
  if (isAllyShape(ability.shape)) return lowest(candidates)
  const f = battle.focus
  if (unit.side === 'party' && f && battle.t < f.until) {
    const hit = candidates.find((u) => u.uid === f.target)
    if (hit) return hit
  }
  return lowest(pickRow(candidates, battle.rng))
}

// → { ability, targets, cost } or null (banking, or nothing to do).
function chooseAction (battle, unit) {
  const options = viable(battle, unit)
  let pick = options[0]
  if (unit.unleash) pick = options.find((o) => o.ability.id === unit.unleash) ?? pick
  if (!pick || unit.gauge < pick.ability.castCost) return null
  const primary = pickTarget(battle, unit, pick.ability, pick.candidates)
  return { ability: pick.ability, targets: expand(battle.units, unit, pick.ability, primary), cost: pick.ability.castCost }
}

// ── formulas ─────────────────────────────────────────────────────────────────────────────────────

const clamp = (lo, hi, v) => Math.min(hi, Math.max(lo, v))

export function hitChance (acc, eva, tuning = TUNING) {
  const denom = acc + eva
  return clamp(tuning.hit.min, tuning.hit.max, denom <= 0 ? 0.5 : acc / denom)
}

export function critChance (crt, tuning = TUNING) {
  const t = tuning.crit
  return clamp(t.min, t.max, crt / t.divisor)
}

export function affinity (attackElement, defenderElementId) {
  if (!attackElement || !defenderElementId) return 1
  return attackElement.affinity?.[defenderElementId] ?? 1
}

function rollVariance (rng, tuning = TUNING) {
  const [lo, hi] = tuning.variance
  return rng.range(lo, hi)
}

// p: { power, atk, def, affinity, isCrit, critMul, variance, mul }
export function computeDamage (p, tuning = TUNING) {
  const t = tuning.damage
  const raw = p.power * (p.atk / t.atkDivisor)
  const mitigated = raw * (t.defConstant / (t.defConstant + Math.max(0, p.def)))
  const crit = p.isCrit ? (p.critMul ?? tuning.crit.mult) : 1
  const total = mitigated * (p.affinity ?? 1) * crit * (p.variance ?? 1) * (p.mul ?? 1)
  return Math.max(t.min, Math.round(total))
}

// chance = base[tier] × (1 + charm/100) × (1 + 2(1 − hp%)) × kinAffinity × itemMods × decay^attempts
export function persuadeChance (p, tuning = TUNING) {
  const t = tuning.persuade
  const base = t.base[p.tier] ?? t.base.default
  const chance = base *
    (1 + (p.charm ?? 0) / t.charmDivisor) *
    (1 + t.weakenBonus * (1 - clamp(0, 1, p.hpPct))) *
    (p.kinAffinity ?? 1) *
    (p.itemMods ?? 1) *
    Math.pow(t.decay, p.attempts ?? 0)
  return clamp(0, t.max, chance)
}
