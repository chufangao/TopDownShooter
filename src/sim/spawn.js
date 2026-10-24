// The foes' side of the run: each battle room's foes (drawRoom: formations, waves, captains and courts), the routes'
// threats, the bosses and the elites that answer the army, and how the foes grow floor by floor.
import { TUNING } from '../tuning.js'
import { UNIT_LIST, unitDef, abilityDef, statusDef, relicDef, THREATS } from '../content.js'
import { createRng } from './rng.js'
import {
  makeUnit, autoPlace, slotAt, CENTRE_OUT, nearestOpen, colOf, FORMATION, SLOTS, meleeOnly, abilitiesOf, isBlow,
  isAllyShape, summonsOf, summonedOf
} from './unit.js'
import { lined, basicOf } from './turns.js'
import { nodeOf, RANKS } from './map.js'
import { BATTLE_NODES, at, roomSize } from './state.js'

// Every threat type of forcedThreats appears on every route: while some walk meets none of a type, one of its battle
// rooms from rank variety.from (never the boss's) is drawn again wanting it, keeping the types it had.
export function varyRoutes (s) {
  const v = TUNING.spawn.variety
  for (let pass = 0; pass < v.routePasses; pass++) {
    for (const type of forcedThreats(s.floor)) {
      for (let k = 0; k < v.routeTries; k++) {
        const rooms = walkWithout(s.map, type)?.filter((n) => BATTLE_NODES.includes(n.type) && n.type !== 'boss' && n.rank >= v.from)
        if (!rooms?.length) break
        const node = rooms[(pass + k) % rooms.length]
        const keep = [...roomThreats(node)].filter((t) => t !== 'depth' && t !== type)
        Object.assign(node, drawRoom(s.seed, s.floor, node, { want: [type, ...keep], redraw: `${pass}|${k}`, ascension: s.ascension }))
      }
    }
  }
}

// The threat types (but depth) the rooms of a floor can carry: those of its foes' pool, the elites' included.
export const routeThreats = (floor) => {
  const sp = TUNING.spawn
  const out = threatsOf([...spawnPool(poolFloor(floor)).units, ...spawnPool(poolFloor(floor), sp.eliteTier).units])
  return Object.keys(THREATS).filter((t) => out.has(t))
}
// The threat types every walk through a floor meets (varyRoutes): routeThreats but Fly, which a ground melee army cannot
// touch at all. Fly comes by the ordinary draw, and to an elite that answers the army (answerArmy): elites are optional.
export const forcedThreats = (floor) => routeThreats(floor).filter((t) => t !== 'fly')

// A walk from a floor's start to its end that meets no battle room carrying `type`, as its rooms in order
// (the first found, breadth first), or null if every walk meets one.
export function walkWithout (map, type) {
  const blocked = (n) => BATTLE_NODES.includes(n.type) && roomThreats(n).has(type)
  const back = new Map([[map.start, null]])
  const queue = [map.start]
  for (let i = 0; i < queue.length; i++) {
    const n = nodeOf(map, queue[i])
    if (n.id === map.end) {
      const walk = []
      for (let id = n.id; id !== null; id = back.get(id)) walk.unshift(nodeOf(map, id))
      return walk
    }
    for (const id of n.next) {
      if (back.has(id) || blocked(nodeOf(map, id))) continue
      back.set(id, n.id)
      queue.push(id)
    }
  }
  return null
}

const threatsOf = (foes) => new Set(foes.flatMap((f) => unitDef(f.id).threats ?? []))
// A room's ({ foes, waves? }): every wave's foes', and depth when more come behind the first.
export const roomThreats = (room) => {
  const out = threatsOf([room.foes, ...(room.waves ?? []).map((w) => w.foes)].flat())
  if (room.waves?.length) out.add('depth')
  return out
}

// A room's foes as [{ id, lvl, slot }]: its first wave, the formation on the board from the start (drawRoom).
export const encounter = (seed, floor, node) => drawRoom(seed, floor, node).foes

// A battle room { foes, waves? }: `foes` the formation on the board from the start, each of `waves` ({ foes }) one that
// enters at the top edge, wave k at the end of turn 1 + k × the run's spacing; a foe is { id, lvl, slot }. By room:
//   fight   `fight` foes; floor 3+ from rank waves.fightRank: waves.fight such waves
//   elite   `elite` foes of a higher tier; floor 1: and a late pair of the floor's pool, a wave; floor 3+: waves.elite
//   siege   waves.siege fight-sized waves, from floor 3
//   boss    its boss (bossFor) at the centre of its court (courtPool); from floor waves.floor, the last of waves.siege
// From floor 2 each wave but a boss's has captains leading cohorts (formation; a fight's drawn from captainPool). From
// rank `variety.from` a draw short of enough distinct threats is redrawn, keeping the most varied; the deep grows it all.
export function drawRoom (seed, floor, node, { want = [], redraw = null, ascension = 0, boss = null } = {}) {
  const sp = TUNING.spawn
  const W = sp.waves
  const grow = deepGrowth(floor, node)
  const lvl = foeLevel(floor, node.rank) + grow.level
  const rng = createRng(seed).stream(`foes|${floor}|${node.id}${redraw === null ? '' : `|route|${redraw}`}`)
  const elite = node.type === 'elite'
  if (node.type === 'boss') boss ??= bossFor(seed, floor)?.id
  else boss = null
  // Floor 1's fights of the first TUNING.spawn.openingTier ranks draw from its tier-1 kinds alone.
  const drawn = spawnPool(poolFloor(floor), elite ? sp.eliteTier : 0)
  const keep = !elite && !boss && floor === 1 && node.rank <= sp.openingTier ? (u) => u.tier === 1 : () => true
  const pool = { units: drawn.units.filter(keep), weights: drawn.weights.filter((_, i) => keep(drawn.units[i])) }
  const n = Math.min(SLOTS, roomSize(floor, elite, ascension, node.rank) + grow.count)
  const cohort = at(sp.cohort, floor) + grow.cohort
  // A fight's captains, from floor 2 (where cohorts come): the first of each wave's draws, from the pool a tier up.
  const lead = !elite && !boss && cohort > 0 ? Math.min(n, sp.captains.fight) : 0
  const heads = lead ? captainPool(poolFloor(floor)) : null
  const waved = floor >= W.floor
  const base = node.type === 'siege' || (boss && waved) ? W.siege : !waved || boss ? 1 : elite ? W.elite : node.rank >= W.fightRank ? W.fight : 1
  // The deep's extra waves come to every room (a single formation becomes a room of waves), up to the cap.
  const waves = grow.waves ? Math.max(base, Math.min(TUNING.spawn.endless.maxWaves, base + grow.waves)) : base
  // Each wave's kinds as drawn (a boss's: its court), then the late pair.
  const floorPool = spawnPool(poolFloor(floor))
  const court = boss && courtPool(floor, unitDef(boss).court)
  const pair = elite && floor === 1
  const draw = () => [
    ...Array.from({ length: waves }, (_, k) => boss && k === waves - 1
      ? Array.from({ length: at(sp.court, floor) }, () => rng.weighted(court.units, court.weights).id)
      : Array.from({ length: n }, (_, i) => (i < lead ? rng.weighted(heads.units, heads.weights) : rng.weighted(pool.units, pool.weights)).id)),
    ...(pair ? [Array.from({ length: sp.late.n }, () => rng.weighted(floorPool.units, floorPool.weights).id)] : [])
  ]
  const v = sp.variety
  const need = node.rank >= v.from ? (elite ? v.elite : v.fight) : 0
  const asFoes = (list) => list.map((id) => ({ id }))
  // How varied a draw is: its distinct threats, and far before that the type it wants (want[0]), then each type it
  // keeps: a draw that has them all and `need` types scores `goal`.
  const threats = (ids) => roomThreats({ foes: asFoes([...ids[0], ...(boss ? [boss] : [])]), waves: ids.slice(1).map((list) => ({ foes: asFoes(list) })) })
  const kinds = (ids) => {
    const t = threats(ids)
    return t.size + (want.length && t.has(want[0]) ? 1000 : 0) + 10 * want.slice(1).filter((x) => t.has(x)).length
  }
  const goal = need + (want.length ? 1000 + 10 * (want.length - 1) : 0)
  let ids = null
  for (let k = 0, best = -1; k < v.tries && best < goal; k++) {
    const d = draw()
    const c = kinds(d)
    if (c > best) { ids = d; best = c }
  }
  const level = lvl + (elite ? sp.eliteLevel : 0)
  const forms = ids.map((list, k) => boss && k === waves - 1
    ? courtOf(list, level)
    : formation(rng, list, level, pair && k === waves ? 0 : elite ? sp.captains.elite : sp.captains.fight, cohort, lead))
  const room = { foes: forms[0] }
  if (forms.length > 1) room.waves = forms.slice(1).map((foes) => ({ foes }))
  return room

  // The boss at the centre of its first row, its court on the slots nearest it; a court that stands ahead of it
  // (`front`: the Barrow Marshal's) across the front row from the middle lanes out, the boss behind its middle.
  function courtOf (list, level) {
    const front = !!unitDef(boss).court.front
    const foes = [{ id: boss, lvl: level, slot: slotAt(front ? 1 : 0, CENTRE_OUT[0]) }]
    const taken = new Set([foes[0].slot])
    for (const id of list) {
      const slot = (front ? CENTRE_OUT.map((c) => slotAt(0, c)).find((x) => !taken.has(x)) : null) ?? nearestOpen(FORMATION, foes[0].slot, taken)
      if (slot < 0) break
      taken.add(slot)
      foes.push({ id, lvl: level, slot })
    }
    return foes
  }
}

// The kinds a boss's court is drawn from: its `kinds` by their spawn weights, else the floor's elite pool of its `kin` or
// `role`. → { units, weights }
export function courtPool (floor, court) {
  if (court.kinds) {
    const units = court.kinds.map(unitDef)
    return { units, weights: units.map((u) => u.spawn.weight) }
  }
  const p = spawnPool(poolFloor(floor), TUNING.spawn.eliteTier)
  const keep = (u) => (!court.kin || u.kin === court.kin) && (!court.role || u.role === court.role)
  return { units: p.units.filter(keep), weights: p.weights.filter((_, i) => keep(p.units[i])) }
}

// ── the bosses and the army ──────────────────────────────────────────────────────────────────────

// The bosses floor `floor` may end in: on the last floor those marked `last` (the Hollow Sovereign), before it those
// tagged with the floor (`floors`); none past it.
export const bossPool = (floor) => UNIT_LIST.filter((u) => u.boss && (floor === TUNING.run.floors ? !!u.last : floor < TUNING.run.floors && !!u.floors?.includes(floor)))

// What a soul leans on, as a boss reads an army (`answers`), the first that holds: casters (a Channeler), shooters (a
// Ranger), statuses (a blow that lays a debuff), shooters (a lined basic blow), walls (melee alone, on the ground); or null.
export const LEANINGS = ['casters', 'shooters', 'statuses', 'walls']
export function leaningOf (u) {
  const d = unitDef(u.id)
  if (d.role === 'channeler') return 'casters'
  if (d.role === 'ranger') return 'shooters'
  const kit = abilitiesOf(u).map(abilityDef)
  if (kit.some((a) => isBlow(a) && a.effects.some((e) => e.op === 'apply_status' && statusDef(e.status).tags.includes('debuff')))) return 'statuses'
  const basic = basicOf(kit)
  if (basic && lined(basic)) return 'shooters'
  if (!d.flies && meleeOnly(u)) return 'walls'
  return null
}
// How many of `army`'s souls lean on each (leaningOf): { casters, shooters, statuses, walls }.
export function leanings (army) {
  const out = Object.fromEntries(LEANINGS.map((w) => [w, 0]))
  for (const u of army) {
    const w = leaningOf(u)
    if (w) out[w]++
  }
  return out
}

// The boss floor `floor` ends in, `army` the living souls held: of bossPool, the one that answers what most of them lean
// on, ties (or no leaning answered) drawn on the floor's stream. → { id, lean: null when drawn } | null for no boss.
export function bossFor (seed, floor, army = []) {
  const pool = bossPool(floor)
  if (pool.length < 2) return pool.length ? { id: pool[0].id, lean: null } : null
  const n = leanings(army)
  const most = Math.max(0, ...pool.map((d) => n[d.answers] ?? 0))
  const top = most > 0 ? pool.filter((d) => (n[d.answers] ?? 0) === most) : pool
  const d = top.length === 1 ? top[0] : createRng(seed).stream(`boss|${floor}`).pick(top)
  return { id: d.id, lean: most > 0 ? d.answers : null }
}

// The boss a room holds, its id, in whichever wave it comes (null for none).
export const bossIn = (node) => [node.foes ?? [], ...(node.waves ?? []).map((w) => w.foes)].flat().find((f) => unitDef(f.id).boss)?.id ?? null

// The army's answers to a room's threat types, by what a soul can do: Fly by a blow that reaches a flyer, Reach by a
// ranged blow, Drain, Burn and Bleed by a heal of others or a cleanse (tends). Shape, Sustain and Depth have none.
export const tends = (u) => abilitiesOf(u).map(abilityDef).some((a) => isAllyShape(a.shape) && a.effects.some((e) => (e.op === 'heal' && !e.self) || e.op === 'cleanse'))
export const ANSWERS = {
  fly: (u) => abilitiesOf(u).map(abilityDef).some((a) => isBlow(a) && (!a.melee || !!unitDef(u.id).flies)),
  reach: (u) => abilitiesOf(u).map(abilityDef).some((a) => isBlow(a) && !a.melee),
  drain: tends,
  burn: tends,
  bleed: tends
}
// The threat types floor `floor`'s foes can bring that none of `army` answers, in THREATS' order.
export const unanswered = (floor, army) => routeThreats(floor).filter((t) => ANSWERS[t] && !army.some(ANSWERS[t]))

// Whether a soul lays status `k` on a foe (a key for a lock): with any blow or skill of its kit, a piece relic it holds
// (Firebrand, Hunter's Mark), or the kit of its summons.
export const laysKey = (u, k) => kitLays(u, k) || (u.relics ?? []).some((id) => relicDef(id).effects?.some((e) => e.op === 'apply_status' && e.status === k && (e.to === 'other' || e.to === 'foes'))) ||
  (summonsOf(u) > 0 && kitLays({ id: summonedOf(u), tracks: u.tracks }, k))
const kitLays = (u, k) => abilitiesOf(u).map(abilityDef).some((a) => a.effects.some((e) => e.op === 'apply_status' && e.status === k))
// The locked kinds of battle room `node` that `army` holds no key to: each its lock's keys, none of which a soul lays,
// or every one where fewer than two pieces stand, a soul's summons among them (a key and a blow are two pieces' acts).
// The Map's hint, never a warning: a lock is fought unkeyed at its share, a slog, never a wall. → [{ id, keys }]
export function unkeyed (node, army) {
  const foes = [node.foes ?? [], ...(node.waves ?? []).map((w) => w.foes)].flat()
  const pieces = army.reduce((n, u) => n + 1 + summonsOf(u), 0)
  const out = []
  for (const id of new Set(foes.map((f) => f.id))) {
    const lock = unitDef(id).lock
    if (!lock) continue
    if (pieces < 2 || !lock.keys.some((k) => army.some((u) => laysKey(u, k)))) out.push({ id, keys: lock.keys })
  }
  return out
}

// Elites that answer the army, as the floor opens: where no elite carries a threat type `army` has no answer to, an
// elite (in a seeded order) is drawn again wanting one, keeping its types; the first draw that has them all is kept.
export function answerArmy (s, army) {
  const lack = unanswered(s.floor, army)
  const elites = s.map.nodes.filter((n) => n.type === 'elite')
  if (!lack.length || !elites.length || elites.some((n) => lack.some((t) => roomThreats(n).has(t)))) return
  for (const node of createRng(s.seed).stream(`answer|${s.floor}`).shuffle(elites)) {
    const keep = [...roomThreats(node)].filter((t) => t !== 'depth')
    for (const type of lack) {
      const room = drawRoom(s.seed, s.floor, node, { want: [type, ...keep], redraw: `army|${type}`, ascension: s.ascension })
      const got = roomThreats(room)
      if (got.has(type) && keep.every((t) => got.has(t))) return Object.assign(node, room)
    }
  }
}

// A wave's formation: `ids` placed from the front row, then `captains` of them (by the shuffle, or the first `led`) each
// leading `cohort` more foes on the free slots nearest it (nearestOpen), dropped when none is free. A captain leads its
// own kind, a `led` one the wave's other kinds. Each is an ordinary foe: it pays essence, and may be recruited.
function formation (rng, ids, lvl, captains, cohort, led = 0) {
  const foes = ids.map((id) => ({ id, lvl, slot: -1 }))
  const cols = [CENTRE_OUT.slice(0, 3), ...[3, 5].map((i) => CENTRE_OUT.slice(i, i + 2))].flatMap((band) => rng.shuffle(band))
  autoPlace(led ? rng.shuffle(foes) : foes, { cols })
  if (!cohort || !captains) return foes
  const taken = new Set(foes.map((f) => f.slot))
  const rest = foes.slice(led)
  for (const c of led ? foes.slice(0, led) : rng.shuffle(foes.slice()).slice(0, captains)) {
    for (let k = 0; k < cohort; k++) {
      const slot = nearestOpen(FORMATION, c.slot, taken)
      if (slot < 0) break
      taken.add(slot)
      foes.push({ id: led && rest.length ? rng.pick(rest).id : c.id, lvl, slot })
    }
  }
  return foes
}

// A room's foes as battle units, uids from `uid` on; a later wave's off the board (slot −1), with its wave and lane.
export function foeUnits (node, uid) {
  const out = []
  for (const [k, foes] of [node.foes, ...(node.waves ?? []).map((w) => w.foes)].entries()) {
    for (const [i, f] of foes.entries()) {
      out.push({
        ...makeUnit(f.id, { uid: uid + i, lvl: f.lvl, slot: k ? -1 : f.slot }),
        ...(k && { side: 'foe', wave: k, lane: colOf(f.slot) })
      })
    }
    uid += foes.length
  }
  return out
}

// ── progression: the foes ────────────────────────────────────────────────────────────────────────

// Foes grow floor by floor and rank by rank: the floor's last room is `levelRamp` (its entry) levels above its first.
export const foeLevel = (floor, rank = 1) => {
  const sp = TUNING.spawn
  return Math.max(1, Math.round(1 + (floor - 1) * sp.levelPerFloor + at(sp.levelRamp, floor) * (rank - 1) / (RANKS - 2)))
}

// Floors past the Sovereign's: 0 down to it, then 1, 2…; an endless floor takes its camps and pool from the last one.
export const depthOf = (floor) => Math.max(0, floor - TUNING.run.floors)
export const poolFloor = (floor) => Math.min(floor, TUNING.run.floors)

// What a room `depth` floors past the Sovereign's adds to its foes (TUNING.spawn.endless): levels and foes a wave, more
// of both in the floor's big last elite, more waves and bigger cohorts. → { level, count, waves, cohort }
export function deepGrowth (floor, node) {
  const E = TUNING.spawn.endless
  const deep = depthOf(floor)
  const final = deep > 0 && node.rank === RANKS - 1
  return {
    level: deep * E.level + (final ? E.final.level : 0),
    count: Math.floor(deep * E.count) + (final ? E.final.count : 0),
    waves: Math.floor(deep * E.waves),
    cohort: Math.floor(deep * E.cohort)
  }
}

// Spawnable units for a floor, weighted toward its target tier + `tierBias` (TUNING.spawn.eliteTier: an elite's).
export function spawnPool (floor, tierBias = 0) {
  const sp = TUNING.spawn
  const target = targetTier(floor) + tierBias
  const units = UNIT_LIST.filter((u) => u.spawn && u.spawn.minFloor <= floor && u.tier <= target + sp.tierOverCap)
  return { units, weights: units.map((u) => u.spawn.weight / Math.pow(1 + Math.abs(u.tier - target), sp.tierFalloff)) }
}
// A floor's target tier, a fight's (spawnPool).
export const targetTier = (floor) => Math.min(TUNING.spawn.tierMax, 1 + Math.floor((floor - 1) * TUNING.spawn.tierPerFloor))
// What a fight's captains are drawn from: the pool `captains.above` tiers up, those of its kinds at least that far over
// the target and at the floor's `captains.minTier`; where none, the pool's highest tier. → { units, weights }
export function captainPool (floor) {
  const { above, minTier } = TUNING.spawn.captains
  const p = spawnPool(floor, above)
  const least = Math.max(targetTier(floor) + above, at(minTier, floor))
  const keep = (u) => u.tier >= least
  const top = p.units.some(keep) ? null : Math.max(...p.units.map((u) => u.tier))
  const ok = (u) => (top === null ? keep(u) : u.tier === top)
  return { units: p.units.filter(ok), weights: p.weights.filter((_, i) => ok(p.units[i])) }
}

// In a boss's room only the boss takes the boss's multipliers (TUNING.spawn.bossHp, bossAtk), the rest the floor's; each
// floor past the Sovereign's adds the endless shares, and `scale` (foeScale: { hp, atk } or one number) multiplies all.
export function foeMods (floor, boss, scale = 1) {
  const sp = TUNING.spawn
  const by = typeof scale === 'number' ? { hp: scale, atk: scale } : scale
  const grow = (key) => (1 + sp.endless[key] * depthOf(floor)) * by[key]
  const mods = [{ path: 'hp', op: 'mul', v: at(sp.foeHp, floor) * grow('hp') }, { path: 'atk', op: 'mul', v: at(sp.foeAtk, floor) * grow('atk') }]
  if (!boss) return mods
  return [
    { path: 'hp', op: 'mul', v: at(sp.bossHp, floor) * grow('hp'), who: { boss: true } },
    { path: 'atk', op: 'mul', v: at(sp.bossAtk, floor) * grow('atk'), who: { boss: true } },
    ...mods.map((m) => ({ ...m, who: { boss: false } }))
  ]
}
