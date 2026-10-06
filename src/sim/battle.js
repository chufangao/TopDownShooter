// Everything inside a fight: the tick loop, effects and statuses, unit AI and movement, and the combat
// formulas. Real-time in 50 ms ticks, and no input once it starts: the same setup always plays out the
// same. Pure: all randomness comes from battle.rng.
import { TUNING } from '../tuning.js'
import { unitDef, statusDef, elementDef, abilityDef, ROLES, BEHAVIOURS } from '../content.js'
import { createRng, hashString } from './rng.js'
import {
  alive, livingOn, statsOf, activeSynergies, reachable, expand, enemySide, isAllyShape,
  deployTile, depthFor, distance, steps, neighbours, rangeOf, isEngaged, TILES, tileX, activeBonds, auraGivers
} from './unit.js'

// ── battle loop ──────────────────────────────────────────────────────────────────────────────────

// party/foes are run units { uid, id, lvl, star, hp, maxHp, slot }; the battle works on copies, and
// only units on the field (slot ≥ 0) with HP left take part. Each starts on its slot's board tile (the
// party's in its camp, past `walls`, a list of board tiles), and the formation bonds it holds there last
// the whole battle.
export function createBattle ({ party, foes, seed, floor = 1, boss = false, partyMods = [], foeMods = [], walls = [] }) {
  const stamp = (u, side) => ({ ...u, side, tile: deployTile(side, u.slot), gauge: 0, statuses: [], phase: 0, quarry: null })
  const units = [...party.map((u) => stamp(u, 'party')), ...foes.map((u) => stamp(u, 'foe'))]
    .filter((u) => u.hp > 0 && u.slot >= 0)
    .sort((a, b) => (a.side < b.side ? -1 : a.side > b.side ? 1 : a.slot - b.slot))

  const battle = {
    t: 0, seed, floor, boss, over: false, winner: null, reason: null,
    units, events: [], walls: new Set(walls), paths: new Map(),
    partyMods, foeMods,
    rng: createRng(seed).stream('battle'),
    syn: {}, cache: new Map(),
    bonds: ['party', 'foe'].flatMap((side) => activeBonds(units.filter((u) => u.side === side)))
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
    walls: [...battle.walls],
    units: units.map((u) => ({ uid: u.uid, id: u.id, side: u.side, slot: u.slot, tile: u.tile, lvl: u.lvl, star: u.star ?? 1, hp: u.hp, maxHp: u.maxHp })),
    synergies: ['party', 'foe'].flatMap((side) => synergiesOf(battle, side).map((s) => ({ side, id: s.id, name: s.name }))),
    bonds: battle.bonds.map((b) => ({ id: b.bond.id, uid: b.uid, partner: b.partner }))
  })
  return battle
}

// One tick. Returns the events it emitted.
export function stepBattle (battle) {
  if (battle.over) return []
  const from = battle.events.length
  phases(battle)
  tickStatuses(battle)
  for (const u of battle.units) {
    if (!alive(u)) continue
    const s = stats(battle, u)
    u.gauge += Math.max(0, (TUNING.gauge.base + s.spd / TUNING.gauge.spdDivisor) * s.gauge.rate)
    act(battle, u)
  }
  checkEnd(battle)
  battle.t++
  return battle.events.slice(from)
}

// Plays a battle to the end.
export function runBattle (battle) {
  while (!battle.over) stepBattle(battle)
  return { events: battle.events, hash: timelineHash(battle.events), winner: battle.winner, ticks: battle.t }
}

export const timelineHash = (events) => hashString(JSON.stringify(events))

function act (battle, u) {
  const chosen = chooseAction(battle, u)
  if (!chosen) return
  const { ability, targets, cost, to } = chosen
  u.gauge -= cost
  if (to !== undefined) {
    emit(battle, { type: 'move', actor: u.uid, from: u.tile, to })
    u.tile = to
    battle.paths.clear()
    return
  }
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

// Units only ever leave a battle (by dying), never return, so the living count versions the roster.
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
  for (const b of battle.bonds) if (b.uid === unit.uid) mods.push(...b.bond.mods)
  for (const giver of auraGivers(battle.units, unit)) mods.push(...unitDef(giver.id).aura.mods)
  mods.push(...(unit.side === 'party' ? battle.partyMods : battle.foeMods))
  return mods
}

// Cached on everything stats depend on, so nothing has to remember to invalidate it.
export function stats (battle, unit) {
  synergiesOf(battle, unit.side)
  const pos = isEngaged(battle.units, unit) ? 'engaged' : 'free'
  const auras = auraGivers(battle.units, unit).map((u) => u.uid).join()
  const key = `${pos}|${auras}|${battle.syn[unit.side].n}|${unit.statuses.map((s) => s.id + s.stacks).join()}`
  const hit = battle.cache.get(unit.uid)
  if (hit?.key === key) return hit.s
  const s = statsOf({ ...unit, pos }, modsFor(battle, unit))
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
      const mul = a.damage.dealt * d.damage.taken * escalation(battle)
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
  battle.paths.clear()
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

// ── unit AI ──────────────────────────────────────────────────────────────────────────────────────

// Each tick, a unit does the first of these that applies:
//   1. a flanker whose quarry is out of reach steps toward it;
//   2. the first ability in def order whose `when` holds and that has a target in reach is used, or
//      the unit banks gauge for it if it cannot afford it yet;
//   3. with nothing in reach, the unit steps toward the foes.
// A step costs TUNING.board.moveCost gauge and never enters a wall. An engaged unit only steps if its
// behaviour slips (BEHAVIOURS). A unit's behaviour is its role's.

export const behaviourOf = (unit) => ROLES[unitDef(unit.id).role].move

function view (battle, unit) {
  return {
    self: unit,
    allies: livingOn(battle.units, unit.side),
    enemies: livingOn(battle.units, enemySide(unit.side)),
    t: battle.t
  }
}

// The first ability in def order that passes its condition and has a target in reach, or null.
function nextAbility (battle, unit) {
  const s = view(battle, unit)
  for (const id of unitDef(unit.id).abilities) {
    const ability = abilityDef(id)
    if (ability.when && !ability.when(s)) continue
    const candidates = reachable(battle.units, unit, ability)
    if (candidates.length) return { ability, candidates }
  }
  return null
}

// The gauge the unit is saving for: its next ability, or a step.
export const nextCost = (battle, unit) => nextAbility(battle, unit)?.ability.castCost ?? TUNING.board.moveCost

// How far the unit's foe-targeting abilities that pass their condition reach: where it walks to.
function reachOf (battle, unit) {
  const s = view(battle, unit)
  let r = 1
  for (const id of unitDef(unit.id).abilities) {
    const a = abilityDef(id)
    if (!isAllyShape(a.shape) && (!a.when || a.when(s))) r = Math.max(r, rangeOf(a))
  }
  return r
}

const byHpPct = (a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.uid - b.uid
const lowest = (list) => list.slice().sort(byHpPct)[0]

// A flanker's quarry: the foe deepest in its own formation, kept until it falls.
function quarryOf (battle, unit) {
  const held = battle.units.find((u) => u.uid === unit.quarry)
  if (held && alive(held)) return held
  const foes = livingOn(battle.units, enemySide(unit.side))
  const q = foes.sort((a, b) => depthFor(b.side, b.tile) - depthFor(a.side, a.tile) || byHpPct(a, b))[0]
  unit.quarry = q?.uid ?? null
  return q
}

// The tile to step to on the cheapest path toward any tile within `range` of a target, or null if the
// unit is there already or no path is open. Walls and tiles held by the living are closed; with
// `avoid`, so are tiles next to a foe. Entering a tile next to a foe costs `danger` steps. Ties keep
// to the lane.
// Memoised until someone moves or dies: nothing else changes the answer.
function stepToward (battle, unit, targets, opts) {
  const key = `${unit.uid}|${targets.map((e) => e.uid)}|${opts.range}|${opts.avoid}|${opts.danger}`
  if (!battle.paths.has(key)) battle.paths.set(key, searchStep(battle, unit, targets, opts))
  return battle.paths.get(key)
}

function searchStep (battle, unit, targets, { range, avoid = false, danger = 1 }) {
  // The board flattened into typed arrays: near (next to a foe) and open (may be stepped on).
  const adj = (battle.adj ??= Array.from({ length: TILES }, (_, t) => steps(t, battle.walls)))
  const near = new Uint8Array(TILES)
  const open = new Uint8Array(TILES).fill(1)
  for (const t of battle.walls) open[t] = 0
  for (const u of battle.units) {
    if (!alive(u)) continue
    if (u !== unit) open[u.tile] = 0
    if (u.side !== unit.side) for (const n of neighbours(u.tile)) near[n] = 1
  }
  if (avoid) for (let t = 0; t < TILES; t++) if (near[t]) open[t] = 0
  const cost = (t) => (near[t] ? danger : 1)
  const passable = (t) => open[t] || t === unit.tile
  // Cost to the nearest goal: Dijkstra outward from the goals, with a bucket per cost (step costs are
  // whole numbers). It stops once the unit's own cost is final: by then so is every tile nearer the
  // goals, and only those can be its best step.
  const dist = new Float64Array(TILES).fill(Infinity)
  const buckets = [[]]
  for (let t = 0; t < TILES; t++) {
    if (passable(t) && targets.some((e) => distance(e.tile, t) <= range)) { dist[t] = 0; buckets[0].push(t) }
  }
  for (let d = 0; d < buckets.length && d < dist[unit.tile]; d++) {
    for (const t of buckets[d] ?? []) {
      if (dist[t] !== d) continue
      const next = d + cost(t)
      for (const n of adj[t]) {
        if (next < dist[n] && passable(n)) { dist[n] = next; (buckets[next] ??= []).push(n) }
      }
    }
  }
  if (dist[unit.tile] === 0 || dist[unit.tile] === Infinity) return null
  const lane = tileX(unit.tile)
  let best = null
  let bestD = Infinity
  for (const n of adj[unit.tile]) {
    if (!open[n]) continue
    const d = cost(n) + dist[n] - (tileX(n) === lane ? 0.5 : 0)
    if (d < bestD) { best = n; bestD = d }
  }
  return best
}

function pickTarget (battle, unit, ability, candidates) {
  if (isAllyShape(ability.shape)) return lowest(candidates)
  if (ability.shape === 'blast') {
    // Where it catches the most: the candidate with the most of its side around it.
    const caught = (c) => livingOn(battle.units, c.side).filter((u) => distance(u.tile, c.tile) <= 1).length
    return candidates.slice().sort((a, b) => caught(b) - caught(a) || byHpPct(a, b))[0]
  }
  const quarry = candidates.find((u) => u.uid === unit.quarry)
  if (quarry) return quarry
  if (ROLES[unitDef(unit.id).role].target === 'weakest') return lowest(candidates)
  const d = (u) => distance(unit.tile, u.tile)
  return candidates.slice().sort((a, b) => d(a) - d(b) || byHpPct(a, b))[0]
}

// → { ability, targets, cost }, { to, cost } for a step, or null (banking, or nothing to do).
function chooseAction (battle, unit) {
  const move = behaviourOf(unit)
  const free = BEHAVIOURS[move].slips || !isEngaged(battle.units, unit)
  const step = (to) => (to === null ? undefined : unit.gauge < TUNING.board.moveCost ? null : { to, cost: TUNING.board.moveCost })

  if (move === 'flank' && free) {
    const quarry = quarryOf(battle, unit)
    const range = reachOf(battle, unit)
    if (quarry && distance(unit.tile, quarry.tile) > range) {
      const go = step(stepToward(battle, unit, [quarry], { range, danger: TUNING.board.dangerCost }))
      if (go !== undefined) return go
    }
  }

  const pick = nextAbility(battle, unit)
  if (pick) {
    if (unit.gauge < pick.ability.castCost) return null
    const primary = pickTarget(battle, unit, pick.ability, pick.candidates)
    return { ability: pick.ability, targets: expand(battle.units, unit, pick.ability, primary), cost: pick.ability.castCost }
  }

  if (!free) return null
  const foes = livingOn(battle.units, enemySide(unit.side))
  const range = reachOf(battle, unit)
  // A ranged unit holding back keeps off the tiles next to foes, unless that leaves it no way in.
  let to = move === 'keep' && range > 1 ? stepToward(battle, unit, foes, { range, avoid: true }) : null
  if (to === null) to = stepToward(battle, unit, foes, { range })
  return step(to) ?? null
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
