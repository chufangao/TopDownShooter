// The battle: the board, pieces, effects, statuses and relics, played as rounds of orders. Pure and dice-free: the same
// setup and orders give the same battle. A round: your turn (each piece moves, then acts once), then End Turn: the
// untouched strike with their basics, the foes take their turn (foe.js foeTurn), statuses tick, waves enter.
import { TUNING } from '../tuning.js'
import { unitDef, abilityDef, statusDef, relicDef, SYNERGIES } from '../content.js'
import { hashString } from './rng.js'
import {
  alive, livingOn, enemySide, isAllyShape, isBlow, footprint, distanceBetween, unitDistance, rangeOf, expand, makeUnit, sizeOf, tileX, tileY,
  tileAt, NEIGHBOURS, deployTile, statsOf, synergyCounts, synergyActive, abilitiesOf, auraOf, armOf, blowReach, summonsOf, summonedOf, heldMods, CENTRE_OUT, TILES,
  LINE_AT, LINE_TILES, lineEnds, between
} from './unit.js'
import {
  LANE, field, fieldOf, airOf, roadOf, arrowOf, roadLeft, layerOf, around, foesNextTo, pressed, auraGivers, riseTile, summonTile, entryTile
} from './field.js'
import { call, heldRules, grantsOf, unhealable } from './rules.js'
import { foeTurn, basicTurn } from './foe.js'

// The board's reads and the rules a side holds, for the interface and the tests: one module to import the battle from.
export { field, fieldOf, airOf, roadOf, arrowOf, foesNextTo, auraGivers, riseTile }
export { rulesOf, holds } from './rules.js'

// ── the battle ───────────────────────────────────────────────────────────────────────────────────

// `setup` (run.js battleSetup): run pieces `party` and `foes` (copied; those on the field with HP fight), `reserve` (each
// with its `wave` and `lane`), side `partyMods`/`foeMods` (never the Monarch's), `ablate` ('arise', 'synergies', 'summons').
// The battle: `units` (acting order, the dead too), `byUid`, `monarch` (null: the roads run to the camp's rear middle),
//   `at`/`sky` the tile index (the living unit on each tile, ground and air; a 2×2 piece on all four),
//   `turn` (1-based), `phase` ('orders' | 'resolving'), `stage` ('party' | 'foes' | 'end'), `beat` (the events' index),
//   `waves` ([{ wave, turn, foes, entered }]), `foeIn` (the turn the last came in), `over`, `winner`, `reason`, `death`.
export function createBattle ({
  party, foes, floor = 1, boss = false, partyMods = [], foeMods = [], walls = [], arise = TUNING.arise, nextUid = null,
  reserve = [], relics = [], ablate = [], quiet = false, every = null
}) {
  const stamp = (u, side) => fresh({ ...u, side, tile: deployTile(side, u.slot) })
  const units = [...party.map((u) => stamp(u, 'party')), ...foes.map((u) => stamp(u, 'foe'))]
    .filter((u) => u.hp > 0 && u.slot >= 0)
    .sort((a, b) => (a.side < b.side ? -1 : a.side > b.side ? 1 : a.slot - b.slot))
  const monarch = units.find((u) => u.side === 'party' && unitDef(u.id).monarch) ?? null
  const battle = {
    floor, boss, over: false, winner: null, reason: null, ablate: new Set(ablate), quiet,
    monarch, death: null, arise: { domain: arise.domain, tier: arise.tier }, raised: 0,
    nextUid: nextUid ?? Math.max(0, ...units.map((u) => u.uid), ...reserve.map((u) => u.uid)) + 1,
    reserve: reserve.map((u) => ({ ...u })), byUid: new Map(), waveAt: [1], crumbled: false,
    units: [], events: [], walls: new Set(walls),
    root: monarch?.tile ?? tileAt(CENTRE_OUT[0], 0), roads: { walk: null, air: null },
    partyMods, foeMods, relics: relics.slice(), unhealable: unhealable(relics),
    at: new Array(TILES).fill(null), sky: new Array(TILES).fill(null), roster: 0, auraReach: 0, auras: [], phased: [],
    syn: {}, cache: new Map(), ruleList: {},
    turn: 1, phase: 'orders', stage: 'party', beat: 0, foeIn: 1,
    ...(every && { every })
  }
  for (const u of units) occupy(battle, u)
  for (const u of units) fit(battle, u)
  if (!battle.ablate.has('summons')) for (const u of units) if (u.side === 'party' && u !== monarch) summon(battle, u)
  battle.waves = schedule(battle.reserve, battle.every)
  emit(battle, {
    type: 'battle:start',
    walls: [...battle.walls],
    units: battle.units.map((u) => ({
      uid: u.uid, id: u.id, side: u.side, slot: u.slot, tile: u.tile, lvl: u.lvl, hp: u.hp, maxHp: u.maxHp, ...marks(u),
      ...(u.summoned && { shadow: true, summoned: true, summoner: u.summoner }), ...(u.relics.length && { relics: u.relics.slice() })
    })),
    synergies: ['party', 'foe'].flatMap((side) => synergiesOf(battle, side).map((s) => ({ side, id: s.id, name: s.name }))),
    monarch: monarch?.uid ?? null,
    root: battle.root,
    reserve: battle.reserve.map((u) => ({ uid: u.uid, id: u.id, lvl: u.lvl, ...marks(u), side: 'foe' }))
  })
  // The opening formation is the first wave: its moment comes before anyone acts.
  if (battle.units.some((u) => u.side === 'foe' && alive(u)) && !fallen(battle)) waveMoment(battle)
  startTurn(battle)
  settle(battle)
  return battle
}

// What marks a unit in the events that announce it: a later wave's foe its `wave`, a 2×2 piece its `size`.
const marks = (u) => ({ ...(u.wave && { wave: u.wave }), ...(u.size > 1 && { size: u.size }) })

const fresh = (u) => ({ ...u, relics: (u.relics ?? []).slice(), statuses: [], phase: 0 })

// A unit takes its place: on the tile index in its layer, last in acting order, its kit and turn fields set for the battle.
function occupy (battle, u) {
  if (!alive(u)) throw new Error(`${u.id} has no HP to fight with`)
  u.flies = !!unitDef(u.id).flies
  u.size = u.side === 'party' ? sizeOf(u) : 1
  const tiles = Number.isInteger(u.tile) && u.tile >= 0 && u.tile < TILES ? footprint(u.tile, u.size) : null
  if (!tiles || (!u.flies && tiles.some((t) => battle.walls.has(t)))) throw new Error(`tile ${u.tile} cannot be stood on`)
  const layer = layerOf(battle, u)
  if (tiles.some((t) => layer[t])) throw new Error(`tile ${u.tile} is taken`)
  u.ord = battle.units.length
  u.held = heldRules(u)
  const monarch = !!unitDef(u.id).monarch
  u.kit = monarch ? [] : [...abilitiesOf(u).map(abilityDef), ...grantsOf(battle, u)].filter((a, i, list) => list.indexOf(a) === i)
  u.relicMods = heldMods(u)
  u.aura = auraOf(u)
  u.arm = armOf(u)
  battle.units.push(u)
  battle.byUid.set(u.uid, u)
  for (const t of tiles) layer[t] = u
  battle.auraReach = Math.max(battle.auraReach, u.aura?.range ?? 0)
  if (u.aura) battle.auras.push(u)
  if (unitDef(u.id).phases) battle.phased.push(u)
  u.move = 0
  u.moved = 0
  u.told = 0
  u.watched = 0
  u.acted = false
  u.from = u.tile
  u.cooldowns = {}
  u.temper = temperOf(u.id)
  u.basic = basicOf(u.kit)
  u.mend = mendOf(u.kit)
}

// Max HP with its HP mods, read once as it takes its place (a summon's × TUNING.summon.hp), HP keeping its fraction.
function fit (battle, u) {
  if (u === battle.monarch) return
  const max = Math.max(1, Math.round(stats(battle, u).hp * (u.summoned ? TUNING.summon.hp : 1)))
  if (max === u.maxHp) return
  u.hp = Math.max(1, Math.round(u.hp * max / u.maxHp))
  u.maxHp = max
}

// A living run unit with its `side` and an open `tile` joins a battle under way; the caller announces it. → the battle unit.
export function enterBattle (battle, u) {
  const unit = fresh(u)
  occupy(battle, unit)
  battle.roster++
  fit(battle, unit)
  unit.move = unit === battle.monarch ? 0 : Math.max(0, Math.floor(stats(battle, unit).move))
  return unit
}

// Whether the Monarch has fallen (never, in a battle with none).
export const fallen = (battle) => battle.monarch !== null && !alive(battle.monarch)

// The turn a reserve foe's wave comes on, `every` turns apart from turn 1: it enters as the turn before ends (arrive).
export const entryTurn = (foe, every = TUNING.spawn.waves.every) => 1 + (foe.wave || 1) * every

function schedule (reserve, every) {
  const out = []
  for (const foe of reserve) {
    const wave = foe.wave || 1
    const w = out.find((x) => x.wave === wave)
    if (w) w.foes++
    else out.push({ wave, turn: entryTurn(foe, every), foes: 1, entered: false })
  }
  return out.sort((a, b) => a.turn - b.turn || a.wave - b.wave)
}

export const nextWave = (battle) => {
  const w = battle.waves.find((x) => !x.entered)
  return w ? { wave: w.wave, turn: w.turn } : null
}

// How far the camp's patience has run, 0 to 1: the turns since the last wave came in, of TUNING.policy.press.turns.
export const impatience = (battle) => Math.min(1, Math.max(0, (battle.turn - battle.foeIn) / Math.max(1, TUNING.policy.press.turns)))

function startTurn (battle) {
  battle.stage = 'party'
  battle.phase = 'orders'
  for (const u of battle.units) if (u.side === 'party') ready(u)
  call(battle, 'onTurn', 'party', { side: 'party', turn: battle.turn })
  refresh(battle)
  battle.beat++
  emit(battle, { type: 'turn', turn: battle.turn, next: nextWave(battle) })
}

// A unit's turn fields set back as its side's turn begins: nothing moved, told, acted or watched; Undo's tile its own.
const ready = (u) => {
  u.moved = 0
  u.told = 0
  u.watched = 0
  u.acted = false
  u.from = u.tile
}

// Every living unit's Move as its stats give it now; the Monarch never moves.
function refresh (battle) {
  for (const u of battle.units) if (alive(u)) u.move = u === battle.monarch ? 0 : Math.max(0, Math.floor(stats(battle, u).move))
}

// Whether the battle is over: won once no foe stands nor is to come; lost the instant the Monarch falls (none: a wipe).
export function settle (battle) {
  if (battle.over) return true
  const m = battle.monarch
  let party = 0
  let foe = battle.reserve.length
  for (const u of battle.units) if (u.hp > 0) u.side === 'party' ? party++ : foe++
  const lost = m ? !alive(m) : !party
  if (!lost && foe) return false
  finish(battle, lost ? 'foe' : 'party', lost ? (m ? 'monarch' : 'wipe') : battle.crumbled ? 'crumble' : 'wipe')
  return true
}

function finish (battle, winner, reason) {
  battle.over = true
  battle.winner = winner
  battle.reason = reason
  battle.phase = 'orders'
  battle.beat++
  emit(battle, { type: 'battle:end', winner, reason, ...(battle.death && { death: battle.death }) })
}

// An event: { beat, type, … }, the events of one beat playing together. A quiet battle (a fork's) keeps none.
export function emit (battle, ev) {
  if (battle.quiet) return
  battle.events.push({ beat: battle.beat, ...ev })
}

export const timelineHash = (events) => hashString(JSON.stringify(events))

// ── kinds on turns ───────────────────────────────────────────────────────────────────────────────

export const temperOf = (id) => unitDef(id).temper ?? null

// A kit's basic blow: the blow its def marks `basic`, else its last (a kit lists its basics last); its basic heal, the
// same among its abilities that mend or cleanse an ally.
const basicIn = (list) => list.find((a) => a.basic) ?? list.at(-1) ?? null
export const basicOf = (kit) => basicIn(kit.filter(isBlow))
export const mendOf = (kit) => basicIn(kit.filter((a) => isAllyShape(a.shape) && a.shape !== 'self' && a.effects.some((e) => (e.op === 'heal' && !e.self) || e.op === 'cleanse')))
// A skill: anything not a basic; it rests once used (restOf).
export const isSkill = (u, a) => a !== u.basic && a !== u.mend

// How long a skill of `u`'s rests once used: its def's `cooldown` (2 where absent), or less where a rule granting it says.
const restOf = (u, a) => Math.min(a.cooldown ?? 2, ...u.held.filter((r) => r.grants === a.id && r.params.cooldown).map((r) => r.params.cooldown))

// ── stats and synergies ──────────────────────────────────────────────────────────────────────────

// The synergies `side` holds, kept until the roster changes; a holder of Mimicry counts as its role too (rules.js `roles`).
export function synergiesOf (battle, side) {
  const c = battle.syn[side]
  if (c?.v === battle.roster) return c.list
  const also = (u) => u.held.flatMap((r) => r.roles?.(battle, u, r) ?? [])
  const counts = synergyCounts(livingOn(battle.units, side), also)
  const list = side === 'party' && battle.ablate.has('synergies') ? [] : SYNERGIES.filter((s) => synergyActive(s, counts))
  battle.syn[side] = { v: battle.roster, list, counts }
  return list
}
// The counts `side` holds its synergies by, kept with them (a split rule reads how far it holds).
export const synergyCountsOf = (battle, side) => {
  synergiesOf(battle, side)
  return battle.syn[side].counts
}

// What bends a unit's stats now: its statuses (or those given), its side's synergies, the auras it stands in, its side's
// mods and its piece relics. The Monarch takes no synergy's, side's or relic's mods, only its statuses and auras.
function modsFor (battle, unit, statuses = unit.statuses) {
  const mods = []
  const own = unit !== battle.monarch
  for (const s of statuses) {
    for (const m of statusDef(s.id).mods ?? []) for (let n = 0; n < s.stacks; n++) mods.push(m)
  }
  if (own) for (const syn of synergiesOf(battle, unit.side)) mods.push(...(syn.mods ?? []))
  for (const giver of auraGivers(battle, unit)) mods.push(...giver.aura.mods)
  if (own) mods.push(...(unit.side === 'party' ? battle.partyMods : battle.foeMods), ...(unit.relicMods ?? []))
  return mods
}

// A unit's stats now, cached on everything they depend on, so nothing has to remember to invalidate them.
export function stats (battle, unit) {
  const engaged = pressed(battle, unit)
  const hit = battle.cache.get(unit.uid)
  if (hit !== undefined && hit.engaged === engaged && sameStatuses(hit.statuses, unit.statuses) && sameGivers(battle, unit, hit.givers)) {
    if (hit.roster === battle.roster) return hit.s
    if (hit.syn === (unit === battle.monarch ? null : synergiesOf(battle, unit.side))) {
      hit.roster = battle.roster
      return hit.s
    }
  }
  const s = statsOf({ id: unit.id, lvl: unit.lvl, tracks: unit.tracks, pos: engaged ? 'engaged' : 'free' }, modsFor(battle, unit))
  const givers = auraGivers(battle, unit).map((u) => u.uid)
  const statuses = unit.statuses.map((x) => [x.id, x.stacks])
  const syn = unit === battle.monarch ? null : synergiesOf(battle, unit.side)
  battle.cache.set(unit.uid, { engaged, roster: battle.roster, s, givers, statuses, syn })
  return s
}

const sameStatuses = (had, now) => {
  if (had.length !== now.length) return false
  for (let i = 0; i < had.length; i++) if (had[i][0] !== now[i].id || had[i][1] !== now[i].stacks) return false
  return true
}

// Whether the allies whose aura reaches `u` are those listed (uids), as auraGivers finds them, with no list made.
function sameGivers (battle, u, had) {
  let n = 0
  for (const a of battle.auras) {
    if (a === u || a.side !== u.side || layerOf(battle, a)[a.tile] !== a || unitDistance(a, u) > a.aura.range) continue
    if (!had.includes(a.uid)) return false
    n++
  }
  return n === had.length
}

// ── effects ──────────────────────────────────────────────────────────────────────────────────────

// A blow's damage: power × ATK ÷ atkDivisor, mitigated by DEF, × `mul` (dealt and taken), rounded, never below the min.
export function computeDamage ({ power, atk, def, mul = 1 }) {
  const t = TUNING.damage
  const raw = power * (atk / t.atkDivisor)
  return Math.max(t.min, Math.round(raw * (t.defConstant / (t.defConstant + Math.max(0, def))) * mul))
}

// One effect run by `actor` on `targets`: of `ability`, or of the status whose tick runs it (`status`).
export function runEffect (battle, effect, actor, targets, ability = null, status = null) {
  if (effect.op === 'cooldown') return cooldown(battle, effect, effect.self ? [actor] : targets)
  // A `self` heal mends the actor once, whoever it struck and whether they still stand.
  if (effect.self) return alive(actor) && heal(battle, actor, actor, effect.power)
  // A damage-over-time tick: `power` true damage a stack, no blow, dealt by whoever laid the status (`by`), else its holder.
  if (effect.op === 'dot') {
    const by = (status?.by != null && battle.byUid.get(status.by)) || actor
    for (const target of targets) {
      if (alive(target)) applyDamage(battle, target, effect.power * (status?.stacks ?? 1), { actor: by, ability: null, status: status?.id ?? null })
    }
    return
  }
  // Raising works on the dead: an Arise's corpse (its shadow `arisen`; onRaise), a relic's slain of up to `tier`
  // (risable), or `count` of the field's dead (Grave Tide: raiseDead).
  if (effect.op === 'raise') {
    if (effect.count) return raiseDead(battle, actor, effect.count)
    for (const corpse of targets) {
      if (effect.tier !== undefined && !(unitDef(corpse.id).tier <= effect.tier && risable(battle, corpse, actor.side))) continue
      const shadow = raise(battle, actor, corpse)
      if (!shadow) continue
      battle.raised++
      shadow.arisen = true
      shadow.raiser = actor.uid
      call(battle, 'onRaise', actor.side, { actor, corpse, shadow })
    }
    return
  }
  for (const target of targets) {
    if (!alive(target)) continue
    if (effect.op === 'damage') {
      // `power` by ATK against DEF; a flat `amount` as true damage. With `per`, the amount once a stack of `per.status` or a
      // status tagged `per.tag` on the target (`consume`: those are spent as it lands), or once a tile the one `per.moved`
      // names moved this turn, or once if the one `per.walked` names moved at all; nothing for none.
      let damage = effect.amount
      const counted = effect.per && (effect.per.status || effect.per.tag) ? perOf(target, effect.per) : null
      if (effect.per) {
        const times = counted ? counted.reduce((n, s) => n + (effect.per.status ? s.stacks : 1), 0) : tilesOf(effect.per, actor, target)
        if (!times) continue
        damage *= times
      }
      if (damage === undefined) {
        const a = stats(battle, actor)
        const d = stats(battle, target)
        damage = computeDamage({ power: effect.power, atk: a.atk, def: d.def, mul: a.damage.dealt * d.damage.taken })
      }
      applyDamage(battle, target, damage, { actor, ability: ability?.id ?? null })
      if (counted && effect.consume && alive(target)) {
        for (const s of counted) {
          if (!target.statuses.includes(s)) continue
          target.statuses.splice(target.statuses.indexOf(s), 1)
          emit(battle, { type: 'cleanse', target: target.uid, status: s.id })
        }
      }
    } else if (effect.op === 'heal') {
      heal(battle, actor, target, effect.power, effect.pct)
    } else if (effect.op === 'apply_status') {
      // A status an effect lays always lands.
      addStatus(battle, target, effect.status, effect.turns, actor)
    } else if (effect.op === 'cleanse') {
      const hits = target.statuses.filter((s) => statusDef(s.id).tags.includes(effect.tag)).slice(0, effect.count)
      for (const s of hits) {
        target.statuses.splice(target.statuses.indexOf(s), 1)
        emit(battle, { type: 'cleanse', target: target.uid, status: s.id })
      }
    } else {
      throw new Error(`unknown effect op "${effect.op}"`)
    }
  }
}

// The statuses on `u` a `per` names: the one of `per.status`, or every one tagged `per.tag`.
const perOf = (u, per) => u.statuses.filter((s) => (per.status ? s.id === per.status : statusDef(s.id).tags.includes(per.tag)))
// How many times a `per` on movement counts: the tiles `per.moved`'s one moved this turn, or 1 if `per.walked`'s moved.
const tilesOf = (per, actor, target) => {
  const who = (per.moved ?? per.walked) === 'actor' ? actor : target
  return per.moved ? who.moved : who.moved > 0 ? 1 : 0
}

// The `cooldown` op: `amount` turns on each target's skill cooldowns (a delay never touches a boss), none below 0.
function cooldown (battle, effect, targets) {
  for (const x of targets) {
    if (!alive(x) || (effect.amount > 0 && unitDef(x.id).boss)) continue
    for (const a of x.kit) {
      if (!isSkill(x, a)) continue
      const was = x.cooldowns[a.id] ?? 0
      const now = Math.max(0, was + effect.amount)
      if (now !== was) cool(battle, x, a.id, now)
    }
  }
}

// A skill of `u`'s set to rest `turns` (0: ready), and announced.
export function cool (battle, u, id, turns) {
  u.cooldowns[id] = turns
  emit(battle, { type: 'cooldown', target: u.uid, ability: id, turns })
}

// A heal mends `power` by the healer's ATK and healing given, or `pct` of the target's max HP, never past its max.
// Nothing heals the Monarch while the run holds Court of Bone.
export function heal (battle, actor, target, power, pct = 0) {
  if (target === battle.monarch && battle.unhealable) return
  let amount
  if (pct) {
    amount = Math.max(1, Math.round(target.maxHp * pct))
  } else {
    const a = stats(battle, actor)
    amount = Math.max(1, Math.round(power * a.atk / TUNING.damage.atkDivisor * a.heal.given))
  }
  const before = target.hp
  target.hp = Math.min(target.maxHp, target.hp + amount)
  emit(battle, { type: 'heal', actor: actor.uid, target: target.uid, heal: target.hp - before, hp: target.hp })
}

// The rules bend damage as it lands (modify: the actor's side's, then the target's), then those of the target's side
// that stand against a fall (stand). → { damage, mend }, or null: it missed.
function land (battle, target, amount, { actor, ability, status }) {
  const ctx = { actor, target, ability: ability ? abilityDef(ability) : null, status, damage: amount, miss: false, as: 'actor' }
  if (actor) call(battle, 'modify', actor.side, ctx)
  ctx.as = 'target'
  call(battle, 'modify', target.side, ctx)
  if (ctx.miss) {
    emit(battle, { type: 'miss', actor: actor.uid, target: target.uid })
    return null
  }
  ctx.damage = Math.max(0, Math.round(ctx.damage))
  ctx.mend = 0
  call(battle, 'stand', target.side, ctx)
  return ctx
}

// Damage lands, a blow's or a status's tick (`status`: no blow); a blow on one that still stands is its 'struck' moment.
export function applyDamage (battle, target, amount, { actor, ability = null, status = null }) {
  const landed = land(battle, target, amount, { actor, ability, status })
  if (!landed) return
  target.hp = Math.max(0, target.hp - landed.damage)
  emit(battle, { type: 'damage', actor: actor.uid, target: target.uid, damage: landed.damage, ability, hp: target.hp, ...(status && { status }) })
  if (!alive(target)) fall(battle, target, actor, ability)
  else {
    if (landed.mend) heal(battle, target, target, 0, landed.mend)
    if (!status) trigger(battle, 'struck', target, target, actor)
  }
}

// A unit falls to `actor`'s blow (or a status it laid): it bursts, its side's rules hear first (onFall: Undying may lift
// it again); else it leaves the board, a boss crumbles its side, and the fall and kill moments and onKill follow.
export function fall (battle, target, actor, ability) {
  target.statuses = []
  emit(battle, { type: 'death', target: target.uid, actor: actor.uid })
  burst(battle, target)
  if (target !== battle.monarch) {
    call(battle, 'onFall', target.side, { fallen: target, by: actor })
    if (alive(target)) {
      // Its burst read its stats while it lay dead, and with them its side's synergies without it: both are read again.
      battle.syn[target.side] = null
      battle.cache.delete(target.uid)
      emit(battle, { type: 'rise', target: target.uid, hp: target.hp })
      trigger(battle, 'fall', target, target, actor)
      return
    }
  }
  vacate(battle, target)
  battle.roster++
  if (target.side === 'foe' && unitDef(target.id).boss) crumble(battle, target)
    // What felled the Monarch, for the defeat screen and the ladder.
  if (target === battle.monarch) {
    battle.death = {
      by: actor.id, uid: actor.uid, ability, from: actor.tile,
      shape: ability ? abilityDef(ability).shape : null,
      threat: unitDef(actor.id).threats?.[0] ?? null,
      ...(actor.side === 'foe' && actor.wave && { wave: actor.wave })
    }
    return
  }
  trigger(battle, 'fall', target, target, actor)
  if (actor.side !== target.side) trigger(battle, 'kill', actor, target, target)
  const side = enemySide(target.side)
  call(battle, 'onKill', side, { slain: target, by: actor, side })
}

function vacate (battle, u) {
  const layer = layerOf(battle, u)
  for (const t of footprint(u.tile, u.size)) if (layer[t] === u) layer[t] = null
}

// A death burst (its kind's `onFall`: { range, effects }), run from where it fell on the other side within `range`.
export function burst (battle, u) {
  const on = unitDef(u.id).onFall
  if (!on) return
  const targets = around(battle, u.tile, on.range, enemySide(u.side), u.size)
  emit(battle, { type: 'burst', actor: u.uid, tile: u.tile, targets: targets.map((x) => x.uid) })
  for (const effect of on.effects) runEffect(battle, effect, u, targets)
}

// A boss's fall: every other foe standing crumbles with it, a death (`crumble: true`) as if slain (they pay), and the
// foes still to come never enter. No crumbled foe bursts, rises, or is a moment.
export function crumble (battle, boss) {
  battle.crumbled = true
  battle.reserve = []
  for (const w of battle.waves) w.entered = true
  for (const u of battle.units) {
    if (u.side !== 'foe' || !alive(u)) continue
    u.hp = 0
    u.statuses = []
    vacate(battle, u)
    emit(battle, { type: 'death', target: u.uid, actor: boss.uid, crumble: true })
  }
  battle.roster++
}

// The party's pieces on the board: everyone living but the Monarch (shadows and summons too).
const pieces = (battle) => battle.units.reduce((n, u) => n + (u.side === 'party' && alive(u) && u !== battle.monarch ? 1 : 0), 0)
// Whether a shadow may rise on `side`: for the party, while it has fewer than TUNING.army.board pieces, so a later wave
// still finds tiles to enter on; a foe side needs no bound.
export const roomFor = (battle, side) => side !== 'party' || pieces(battle) < TUNING.army.board

// The size a shadow of `corpse` rising on `side` stands at: a foe piece's 1, one of yours its kind's (no tiers).
export const shadowSize = (corpse, side) => (side === 'party' ? sizeOf({ id: corpse.id }) : 1)

// The corpse rises on `side` as a shadow of itself at full HP: yours on the free tile closest to the Monarch (riseTile),
// a foe's where it fell if free; its corpse never rises again. → the shadow, or null with no tile.
export function raise (battle, actor, corpse, { side = actor.side, rule = null } = {}) {
  const tile = side === 'party' ? riseTile(battle, corpse.tile, shadowSize(corpse, side), corpse.flies)
    : layerOf(battle, corpse)[corpse.tile] === null ? corpse.tile : -1
  if (tile < 0) return null
  const u = makeUnit(corpse.id, { uid: battle.nextUid++, lvl: corpse.lvl })
  corpse.raised = true
  const shadow = enterBattle(battle, { ...u, side, shadow: true, corpse: corpse.uid, tile })
  emit(battle, {
    type: 'arise', actor: actor?.uid ?? null, corpse: corpse.uid, from: corpse.tile,
    unit: { uid: shadow.uid, id: shadow.id, side: shadow.side, tile: shadow.tile, lvl: shadow.lvl, hp: shadow.hp, maxHp: shadow.maxHp, shadow: true, ...marks(shadow) },
    ...(rule && { rule })
  })
  return shadow
}

// Whether `corpse` may rise on `side` as Legion raises: fallen, never risen, no shadow, boss or Monarch, while there is room.
export const risable = (battle, corpse, side) => !alive(corpse) && !corpse.raised && !corpse.shadow &&
  !unitDef(corpse.id).boss && !unitDef(corpse.id).monarch && roomFor(battle, side)

// Grave Tide: up to `count` of the field's dead (no shadow, boss, Monarch or one risen) rise on the actor's side where
// they fell, where no one living lies; the highest tier first, then the nearest, then the lowest uid.
function raiseDead (battle, actor, count) {
  const d = (c) => unitDistance(actor, c)
  const dead = battle.units.filter((c) => !alive(c) && !c.raised && !c.shadow && !unitDef(c.id).boss && !unitDef(c.id).monarch)
    .sort((a, b) => unitDef(b.id).tier - unitDef(a.id).tier || d(a) - d(b) || a.uid - b.uid)
  for (const c of dead) {
    if (count <= 0) break
    if (layerOf(battle, c)[c.tile] !== null) continue
    raise(battle, actor, c)
    count--
  }
}

// A status laid on `target` by `by` for `turns` (its def's when not given; 'battle': the battle): a second of one held
// stacks and lasts the longer. One laid after its holder's turn has passed, or a Hex on one that has acted, is `fresh`:
// the round's end does not count against it. A boss that lost its act to a Hex shrugs off Hexes (`shrugs`) till it acts.
export function addStatus (battle, target, id, turns, by = null) {
  if (id === 'hexed' && target.shrugs) {
    emit(battle, { type: 'shrug', target: target.uid, status: id })
    return
  }
  const def = statusDef(id)
  const dur = turns || def.turns
  const own = battle.stage === (target.side === 'party' ? 'party' : 'foes')
  const recent = battle.stage === 'end' || (target.side === 'party' && battle.stage === 'foes') || (id === 'hexed' && own && target.acted)
  const have = target.statuses.find((s) => s.id === id)
  if (have) {
    const longer = have.dur !== 'battle' && (dur === 'battle' || dur > have.dur || (dur === have.dur && recent && !have.fresh))
    have.dur = have.dur === 'battle' || dur === 'battle' ? 'battle' : Math.max(have.dur, dur)
    have.stacks = Math.min(def.stacks, have.stacks + 1)
    have.by = by?.uid ?? null
    if (longer) have.fresh = recent
  } else {
    target.statuses.push({ id, dur, stacks: 1, by: by?.uid ?? null, fresh: recent })
  }
  emit(battle, { type: 'status', target: target.uid, status: id, dur })
}

// HP thresholds grant a status; a loop, so one big hit can cross two.
export function phases (battle) {
  for (const u of battle.phased) {
    const list = unitDef(u.id).phases
    if (!alive(u)) continue
    while (u.phase < list.length && u.hp / u.maxHp <= list[u.phase].at) {
      const { grant } = list[u.phase++]
      emit(battle, { type: 'phase', target: u.uid, phase: u.phase, status: grant })
      addStatus(battle, u, grant)
    }
  }
}

// ── relics: the moments their holders meet ───────────────────────────────────────────────────────

// A holder's moment `on`: each relic it holds firing on it whose `when` holds is announced, its effects run with the
// holder as caster on each's `to` (the holder, the 'other' end, the Monarch, or 'allies' / 'foes' around `place`).
export function trigger (battle, on, subject, place, other = null) {
  for (const id of subject.relics) {
    const relic = relicDef(id)
    if (relic.on !== on || !moving(relic.when, subject)) continue
    emit(battle, { type: 'trigger', relic: id, on, unit: subject.uid })
    for (const effect of relic.effects) runEffect(battle, effect, subject, triggered(battle, effect, subject, place, other))
  }
}

function triggered (battle, effect, subject, place, other) {
  switch (effect.to) {
    case 'self': return alive(subject) ? [subject] : []
    // The one on the other end, never the subject itself: standing, or for a raise lying dead (the slain).
    case 'other': return other && other !== subject && alive(other) !== (effect.op === 'raise') ? [other] : []
    case 'monarch': return battle.monarch && alive(battle.monarch) ? [battle.monarch] : []
    case 'allies': return around(battle, place.tile, effect.range, subject.side, place.size)
    case 'foes': return around(battle, place.tile, effect.range, enemySide(subject.side), place.size)
    default: throw new Error(`unknown trigger target "${effect.to}"`)
  }
}

// Whether a trigger's `when` holds for its holder `u` (none: always).
const moving = (when, u) => !when || (when.still ? u.moved === 0 : u.moved >= when.moved)

// A wave's moment: every living holder of a 'wave' relic, in acting order.
function waveMoment (battle) {
  for (const u of battle.units.slice()) if (alive(u) && u.relics.length) trigger(battle, 'wave', u, u)
}

// A move's moment, fired as `u`'s walk is committed, never on the walk (an Undo leaves nothing to unwind), for tiles not
// told yet (`told`): the rules hear first (onMove), then, if it still stands, its holder's 'move' moment.
export function moveMoment (battle, u) {
  if (battle.over || !alive(u) || !(u.moved > u.told)) return
  u.told = u.moved
  const ctx = { actor: u, from: u.from, to: u.tile, moved: u.moved, as: 'actor' }
  call(battle, 'onMove', u.side, ctx)
  ctx.as = 'other'
  call(battle, 'onMove', enemySide(u.side), ctx)
  if (!battle.over && alive(u)) trigger(battle, 'move', u, u)
}

// ── reach and targets ────────────────────────────────────────────────────────────────────────────

export const hexed = (u) => u.statuses.some((s) => s.id === 'hexed')

// How far a blow of `u`'s reaches a flyer, its reach being `r`: melee from the ground none (−1).
export const aloft = (u, a, r) => (a.melee && !u.flies ? -1 : r)

// Whether ally ability `a` of `u`'s can do anything for `x`: mend it (hurt and healable), or strip a status it cleanses.
function canMend (battle, u, a, x) {
  if (mends(a) && x.hp < x.maxHp && !(x === battle.monarch && battle.unhealable)) return true
  return a.effects.some((e) => e.op === 'cleanse' && x.statuses.some((s) => statusDef(s.id).tags.includes(e.tag)))
}

// How far ability `a` of `u`'s reaches its primaries (a blow by blowReach, else rangeOf), as its side's rules bend it.
function rangeFor (battle, u, a) {
  const ctx = { actor: u, ability: a, range: isBlow(a) ? blowReach(u, a) : rangeOf(a) }
  call(battle, 'reach', u.side, ctx)
  return ctx.range
}

// The primaries ability `a` of `u`'s may take with `u` on `tile`: foes in reach, allies in range, itself, or corpses.
export function targetsFrom (battle, u, a, tile = u.tile) {
  if (a.shape === 'corpse') return corpses(battle, u, tile)
  if (a.shape === 'self' || a.shape === 'all_allies') return [u]
  const r = rangeFor(battle, u, a)
  if (isAllyShape(a.shape)) return battle.units.filter((x) => x.side === u.side && alive(x) && (x === u || distanceBetween(tile, u.size, x.tile, x.size) <= r))
  return around(battle, tile, r, enemySide(u.side), u.size, aloft(u, a, r))
}

export const mends = (a) => a.effects.some((e) => e.op === 'heal' && !e.self)

// Whether `a`'s condition (content.js `when`) holds for `u`; a heal's allies are those it can do something for.
export function allowed (battle, u, a) {
  if (!a.when) return true
  const enemies = livingOn(battle.units, enemySide(u.side))
  let allies = livingOn(battle.units, u.side)
  if (mends(a)) allies = allies.filter((x) => canMend(battle, u, a, x) && unitDistance(u, x) <= rangeOf(a))
  return a.when({ self: u, allies, enemies })
}

export const usable = (battle, u, a) => (!isSkill(u, a) || !(u.cooldowns[a.id] > 0)) && allowed(battle, u, a)

export const canAct = (battle, u) => !battle.over && alive(u) && !u.acted && !hexed(u)

// Arise's reach and tier for holder `u`, the battle's and its granting rules': { domain, tier }, or null with no Arise.
export function ariseOf (battle, u) {
  if (!u.kit.some((a) => a.shape === 'corpse')) return null
  const grants = u.held.filter((r) => r.grants)
  return {
    domain: battle.arise.domain + grants.reduce((n, r) => n + (r.params.domain ?? 0), 0),
    tier: battle.arise.tier + grants.reduce((n, r) => n + (r.params.tier ?? 0), 0)
  }
}

// What `u`'s Arise may raise from `tile`: a fallen foe, never raised, no shadow nor boss, of a tier and within a reach
// up to its Arise's, with a tile for its shadow; none once a boss has fallen, nor while a held rule says no (raisable).
export function corpses (battle, u, tile = u.tile) {
  const arise = ariseOf(battle, u)
  if (!arise || !alive(u) || battle.crumbled) return []
  if (u.held.some((r) => r.raisable && !r.raisable(battle, u, r))) return []
  return battle.units.filter((c) => c.side !== u.side && !alive(c) && !c.raised && !c.shadow && !unitDef(c.id).boss &&
    unitDef(c.id).tier <= arise.tier && distanceBetween(c.tile, c.size, tile, u.size) <= arise.domain &&
    (u.side !== 'party' || riseTile(battle, c.tile, shadowSize(c, u.side), c.flies) >= 0))
}

// ── lines of fire ────────────────────────────────────────────────────────────────────────────────

// Whether blow `a` keeps to a line: a single-target blow from range (above 1), never melee nor arcing (`arc`).
export const lined = (a) => a.shape === 'single' && !a.melee && !a.arc && (a.range ?? Infinity) > 1

// The tiles a blow of `u`'s (on `from`) at `x` crosses, strictly between, in order from u; none for an ability that
// keeps to no line. The interface draws it.
export function lineOf (battle, u, x, a = null, from = u.tile) {
  if (a && !lined(defOf(a))) return []
  const [p, q] = lineEnds(from, u.size ?? 1, x.tile, x.size ?? 1)
  return between(p, q)
}

// An ability given by its def or its id (the interface's).
const defOf = (a) => (typeof a === 'string' ? abilityDef(a) : a)

// The first unit of `side` on the tiles strictly between p and q (the ground's first on a shared tile), `not` aside.
export function lineBlocker (battle, p, q, side, not = null) {
  const k = p * TILES + q
  for (let i = LINE_AT[k]; i < LINE_AT[k + 1]; i++) {
    const t = LINE_TILES[i]
    const g = battle.at[t]
    if (g !== null && g.side === side && g !== not) return g
    const s = battle.sky[t]
    if (s !== null && s.side === side && s !== not) return s
  }
  return null
}

// Whom blow `a` of `u`'s (on `from`) aimed at `x` meets first on its line: the first of x's side between them, else x.
// The shooter's own side never blocks: it fires over its friends.
export function lineStruck (battle, u, a, x, from = u.tile) {
  if (!lined(a) || x.side === u.side) return x
  const [p, q] = lineEnds(from, u.size ?? 1, x.tile, x.size ?? 1)
  return lineBlocker(battle, p, q, x.side, x) ?? x
}

// The unit blow `a` of `u`'s aimed at `x` strikes: the line's, then as the rules of that one's side turn it (a
// Bodyguard), read without a word said. What perform resolves and the policy scores.
export function struckBy (battle, u, a, x, from = u.tile) {
  a = defOf(a)
  if (!isBlow(a)) return x
  const ctx = { actor: u, ability: a, primary: lineStruck(battle, u, a, x, from), targets: null, as: 'target' }
  const quiet = battle.quiet
  battle.quiet = true
  try {
    call(battle, 'targets', ctx.primary.side, ctx)
  } finally {
    battle.quiet = quiet
  }
  return ctx.primary
}

// Who an ability aimed at `primary` touches: the line's pick and its side's rules, then its shape, then the actor's
// rules (Dragonfire, Sanctuary). → { primary, targets }.
function spread (battle, u, a, primary) {
  const ctx = { actor: u, ability: a, primary, targets: null, as: 'target' }
  if (isBlow(a)) {
    ctx.primary = lineStruck(battle, u, a, primary)
    call(battle, 'targets', ctx.primary.side, ctx)
  }
  ctx.targets = shape(battle, u, a, ctx.primary)
  ctx.as = 'actor'
  call(battle, 'targets', u.side, ctx)
  return ctx
}

// The units a shape touches from its primary (blast: its side around its footprint; else unit.js expand); a melee blow
// from the ground never strikes a flyer.
export function shape (battle, u, a, primary) {
  if (a.shape === 'corpse') return [primary]
  const out = a.shape === 'blast' ? around(battle, primary.tile, 1, primary.side, primary.size) : expand(battle.units, u, a, primary)
  return a.melee && !u.flies && primary.side !== u.side ? out.filter((x) => !x.flies) : out
}

// ── acting ───────────────────────────────────────────────────────────────────────────────────────

// `u` uses `a` on `primary`: its act for the turn. A skill rests (set first, so a rule may ready it again); the rules
// hear of it; a blow is its 'blow' moment and a melee one is countered. Once the Monarch falls nothing follows.
export function perform (battle, u, a, primary) {
  battle.beat++
  const { primary: aimed, targets } = spread(battle, u, a, primary)
  emit(battle, { type: 'action', actor: u.uid, ability: a.id, anim: a.anim, primary: primary.uid, ...(aimed !== primary && { struck: aimed.uid }), targets: targets.map((x) => x.uid), tile: u.tile })
  u.acted = true
  if (isSkill(u, a)) cool(battle, u, a.id, restOf(u, a))
  const before = targets.map((x) => x.hp)
  for (const effect of a.effects) runEffect(battle, effect, u, targets, a)
  if (a.shape !== 'corpse' && !fallen(battle)) {
    targets.forEach((x, i) => {
      if (x.side !== u.side && alive(x) && x.hp < before[i]) call(battle, 'onStruck', x.side, { actor: u, target: x, ability: a, damage: before[i] - x.hp })
    })
    call(battle, 'onBlow', u.side, { actor: u, ability: a, primary: aimed, targets })
    if (isBlow(a)) {
      if (!fallen(battle)) trigger(battle, 'blow', u, u, aimed)
      if (a.melee) counter(battle, aimed, u)
    }
  }
  phases(battle)
  settle(battle)
}

// A counter: the target of a melee blow, standing within its melee basic blow's reach of the attacker (on `from`),
// answers with it; never Hexed, never the Monarch, never ground at a flyer. → the blow, or null.
export function counterOf (battle, defender, attacker, from = attacker.tile) {
  if (!alive(defender) || !alive(attacker) || defender.side === attacker.side || defender === battle.monarch || hexed(defender)) return null
  const b = defender.basic
  if (!b?.melee || (attacker.flies && !defender.flies) || distanceBetween(defender.tile, defender.size, from, attacker.size) > blowReach(defender, b)) return null
  return b
}

function counter (battle, defender, attacker) {
  if (battle.over || fallen(battle)) return
  const b = counterOf(battle, defender, attacker)
  if (b) answer(battle, defender, b, attacker, { counter: true })
}

// Blow `b` of `u`'s at `x` alone, as a counter: no line, no shape, no blow's moment, never answered; the action marked
// by `mark` (`counter`, or Overwatch's `rule`).
export function answer (battle, u, b, x, mark) {
  battle.beat++
  emit(battle, { type: 'action', actor: u.uid, ability: b.id, anim: b.anim, targets: [x.uid], tile: u.tile, ...mark })
  for (const effect of b.effects) runEffect(battle, effect, u, [x], b)
}

// Whom one of yours left untouched strikes among `list`: the foe furthest along its road, then by lane (centre first),
// then the nearest, then the first to act.
export function pick (battle, u, list) {
  let best = list[0] ?? null
  for (let i = 1; i < list.length; i++) {
    const x = list[i]
    const k = (roadLeft(battle, x) - roadLeft(battle, best)) || (LANE[tileX(x.tile)] - LANE[tileX(best.tile)]) || (unitDistance(x, u) - unitDistance(best, u))
    if (k < 0) best = x
  }
  return best
}

// One left untouched acts at End Turn with its basics alone: its blow at `pick`'s foe, else its heal on the most
// wounded it can help, else nothing. A Hexed one loses its act.
function untouched (battle, u) {
  if (hexed(u)) {
    battle.beat++
    emit(battle, { type: 'hexed', target: u.uid })
    u.acted = true
    return
  }
  const b = u.basic
  if (b && allowed(battle, u, b)) {
    const list = targetsFrom(battle, u, b)
    if (list.length) return perform(battle, u, b, pick(battle, u, list))
  }
  const m = u.mend
  if (m && allowed(battle, u, m)) {
    const list = helped(battle, u, m, u.tile)
    if (list.length) return perform(battle, u, m, lowest(list))
  }
}

// The allies a heal of `u`'s on `tile` can do something for, as primaries (an all-allies one: itself, once anyone can).
export function helped (battle, u, a, tile) {
  if (a.shape === 'all_allies') {
    const r = rangeFor(battle, u, a)
    return battle.units.some((x) => x.side === u.side && alive(x) && distanceBetween(tile, u.size, x.tile, x.size) <= r && canMend(battle, u, a, x)) ? [u] : []
  }
  return targetsFrom(battle, u, a, tile).filter((x) => canMend(battle, u, a, x))
}

const lowest = (list) => list.slice().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.uid - b.uid)[0]

// ── moving ───────────────────────────────────────────────────────────────────────────────────────

// Whether `u`'s footprint may pass anchored at `t`: on the board, and on the ground no wall nor foe on it.
function passes (battle, u, t) {
  if (u.size === 1) return u.flies || !(battle.walls.has(t) || (battle.at[t] !== null && battle.at[t].side !== u.side))
  const tiles = footprint(t, u.size)
  if (!tiles) return false
  if (u.flies) return true
  for (const x of tiles) if (battle.walls.has(x) || (battle.at[x] !== null && battle.at[x].side !== u.side)) return false
  return true
}

// Whether no wall stands on `u`'s footprint anchored at `t` (a diagonal step's corner test: unit.js steps).
const clear = (battle, u, t) => (u.size === 1 ? !battle.walls.has(t) : footprint(t, u.size)?.every((x) => !battle.walls.has(x)) ?? false)

// Whether `u` may end a move anchored at `t`: its footprint free in its layer but for itself, and on the ground no wall.
export function endable (battle, u, t) {
  const layer = layerOf(battle, u)
  if (u.size === 1) return (layer[t] === null || layer[t] === u) && (u.flies || !battle.walls.has(t))
  const tiles = footprint(t, u.size)
  if (!tiles) return false
  return tiles.every((x) => (layer[x] === null || layer[x] === u) && (u.flies || !battle.walls.has(x)))
}

// The tiles a piece of yours may move to now within `budget` steps (no wall, no corner cut, through your own but never
// a foe, never ending on a held tile; a flyer over anything). → Map tile → path (each tile stepped onto, the last it).
export function reach (battle, u, budget = u.move - u.moved) {
  const out = new Map()
  if (!(budget > 0)) return out
  const prev = new Map([[u.tile, -1]])
  const cost = new Map([[u.tile, 0]])
  const queue = [u.tile]
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i]
    const c = cost.get(t)
    if (c >= budget) continue
    const x = tileX(t)
    const y = tileY(t)
    for (const n of NEIGHBOURS[t]) {
      if (cost.has(n) || !passes(battle, u, n)) continue
      if (!u.flies && tileX(n) !== x && tileY(n) !== y && !(clear(battle, u, tileAt(tileX(n), y)) && clear(battle, u, tileAt(x, tileY(n))))) continue
      cost.set(n, c + 1)
      prev.set(n, t)
      queue.push(n)
    }
  }
  for (const t of queue) {
    if (t === u.tile || !endable(battle, u, t)) continue
    const path = []
    for (let s = t; s !== u.tile; s = prev.get(s)) path.unshift(s)
    out.set(t, path)
  }
  return out
}

// The road a foe may take this turn: its road's tiles up to `steps` ahead, stopping before the first held one or a
// wall. → [{ tile, path }], its own tile first.
export function roadAhead (battle, u, steps = u.move - u.moved) {
  const tiles = roadTiles(battle, u, steps)
  const out = [{ tile: tiles[0], path: [] }]
  for (let i = 1; i < tiles.length; i++) out.push({ tile: tiles[i], path: tiles.slice(1, i + 1) })
  return out
}
// roadAhead's tiles alone, its own first, with no path made.
export function roadTiles (battle, u, steps = u.move - u.moved) {
  const road = roadOf(battle, u)
  const out = [u.tile]
  for (let t = road.arrow[u.tile], k = 0; t >= 0 && k < steps; t = road.arrow[t], k++) {
    const holder = u.flies ? (battle.at[t] !== null && battle.at[t].side !== u.side ? battle.at[t] : battle.sky[t]) : battle.at[t]
    if ((holder !== null && holder !== u) || (!u.flies && battle.walls.has(t))) break
    out.push(t)
  }
  return out
}

// A unit moves along `path` (a piece of yours by reach, a foe by roadAhead), its footprint with it.
export function walk (battle, u, path) {
  const from = u.tile
  const to = path[path.length - 1]
  battle.beat++
  relocate(battle, u, to)
  u.moved += path.length
  emit(battle, { type: 'move', actor: u.uid, from, to, path })
}

function relocate (battle, u, to) {
  vacate(battle, u)
  u.tile = to
  for (const t of footprint(to, u.size)) layerOf(battle, u)[t] = u
}

// ── summons ──────────────────────────────────────────────────────────────────────────────────────

// A soul's summons, called as the battle begins: shadows of the kind it summons (`summoned`, `summoner` its uid), at its
// level and tiers and TUNING.summon.hp of the HP, each on the free tile nearest it (summonTile); fewer with none free.
export function summon (battle, u) {
  const kind = summonedOf(u)
  const size = sizeOf({ id: kind, tracks: u.tracks })
  const flies = !!unitDef(kind).flies
  for (let k = summonsOf(u); k > 0; k--) {
    const tile = summonTile(battle, u, size, flies)
    if (tile < 0) return
    const piece = makeUnit(kind, { uid: battle.nextUid++, lvl: u.lvl, tracks: u.tracks })
    enterBattle(battle, { ...piece, side: 'party', shadow: true, summoned: true, summoner: u.uid, tile })
  }
}

// ── orders ───────────────────────────────────────────────────────────────────────────────────────

// A piece the player orders: one of yours, living, no shadow, never the Monarch.
export const orderable = (battle, u) => u.side === 'party' && alive(u) && !u.shadow && u !== battle.monarch

function mine (battle, uid) {
  const u = battle.byUid.get(uid)
  if (battle.over || battle.phase !== 'orders') throw new Error('no orders are taken now')
  if (!u || !orderable(battle, u)) throw new Error(`no piece ${uid} of yours takes orders`)
  return u
}

// The acts `u` may make from where it stands: each usable ability at each target (an `all` shape's once).
function actsOf (battle, u) {
  const out = []
  if (!canAct(battle, u)) return out
  for (const a of u.kit) {
    if (!usable(battle, u, a)) continue
    const list = targetsFrom(battle, u, a)
    for (const x of a.shape === 'all' ? list.slice(0, 1) : list) out.push({ type: 'act', uid: u.uid, ability: a.id, target: x.uid })
  }
  return out
}

export function legalOrders (battle) {
  if (battle.over || battle.phase !== 'orders') return []
  const out = []
  for (const u of battle.units) {
    if (!orderable(battle, u) || u.acted) continue
    for (const tile of reach(battle, u).keys()) out.push({ type: 'move', uid: u.uid, tile })
    out.push(...actsOf(battle, u))
    if (u.moved > 0 && endable(battle, u, u.from)) out.push({ type: 'undo', uid: u.uid })
  }
  out.push({ type: 'end' })
  return out
}

// Applies order `o` and returns the events it made, throwing on an illegal one (`path`: a move's, as reach found it here):
//   { type: 'move', uid, tile }             a piece of yours moves, within its Move by a path
//   { type: 'undo', uid }                   it goes back where its turn began, its Move whole again (until it acts)
//   { type: 'act', uid, ability, target }   it acts: `target` a unit's uid (a corpse's for Arise)
//   { type: 'end' }                         End Turn: the rest of the round
//   { type: 'stall' }                       past TUNING.turn.guard turns the battle ends with no winner (never the player's)
export function order (battle, o, path = null) {
  const from = battle.events.length
  if (o.type === 'end') {
    if (battle.over || battle.phase !== 'orders') throw new Error('no orders are taken now')
    endTurn(battle)
    return battle.events.slice(from)
  }
  if (o.type === 'stall') {
    if (!stalled(battle) || battle.phase !== 'orders') throw new Error(`a battle stalls only past ${TUNING.turn.guard} turns`)
    finish(battle, null, 'stall')
    return battle.events.slice(from)
  }
  const u = mine(battle, o.uid)
  if (o.type === 'move') {
    const way = u.acted ? null : path ?? reach(battle, u).get(o.tile)
    if (!way) throw new Error(`${u.id} ${u.uid} cannot move to ${o.tile}`)
    walk(battle, u, way)
  } else if (o.type === 'undo') {
    if (u.acted || !(u.moved > 0) || !endable(battle, u, u.from)) throw new Error(`${u.id} ${u.uid} has no move to undo`)
    battle.beat++
    emit(battle, { type: 'undo', actor: u.uid, from: u.tile, to: u.from })
    relocate(battle, u, u.from)
    u.moved = 0
    u.told = 0
  } else if (o.type === 'act') {
    const a = u.kit.find((x) => x.id === o.ability)
    const target = a && canAct(battle, u) && usable(battle, u, a) ? targetsFrom(battle, u, a).find((x) => x.uid === o.target) : null
    if (!target) throw new Error(`${u.id} ${u.uid} cannot use ${o.ability} on ${o.target}`)
    perform(battle, u, a, target)
    moveMoment(battle, u)
  } else {
    throw new Error(`unknown order "${o.type}"`)
  }
  refresh(battle)
  return battle.events.slice(from)
}

// End Turn: the untouched act, the foes take their turn, the turn ends; then your next begins, unless the battle is over.
function endTurn (battle) {
  battle.phase = 'resolving'
  battle.beat++
  emit(battle, { type: 'stage', stage: 'untouched' })
  untouchedAll(battle)
  if (!battle.over) {
    battle.stage = 'foes'
    for (const u of battle.units) if (u.side === 'foe') ready(u)
    battle.beat++
    emit(battle, { type: 'stage', stage: 'foes' })
    call(battle, 'onTurn', 'foe', { side: 'foe', turn: battle.turn })
    refresh(battle)
    if (!battle.over) foeTurn(battle)
  }
  if (!battle.over) closeTurn(battle)
  if (!battle.over) startTurn(battle)
  battle.phase = 'orders'
}

// Every piece of yours given no act acts as the untouched do, in acting order (one risen meanwhile too); `each(u, from)`
// hears of each after it acts, `from` the index of its first event.
function untouchedAll (battle, each = null) {
  for (let i = 0; i < battle.units.length && !battle.over; i++) {
    const u = battle.units[i]
    if (u.side !== 'party' || !alive(u) || u.acted || u === battle.monarch) continue
    const from = battle.events.length
    untouched(battle, u)
    moveMoment(battle, u)
    each?.(u, from)
  }
}

// What End Turn's untouched pass would do now, played on a fork, for the End Turn button's card: { acts: [{ uid, id,
// shadow, hexed, ability, target, struck, hits, missed, heals, statuses, falls, counter, lost }], over, winner }, one
// per piece that would act; never the foes' turn. Null while no orders are taken.
export function untouchedPreview (battle) {
  if (battle.over || battle.phase !== 'orders') return null
  const f = fork(battle, { quiet: false })
  f.phase = 'resolving'
  f.beat++
  const acts = []
  untouchedAll(f, (u, from) => {
    const out = { uid: u.uid, id: u.id, shadow: !!u.shadow, hexed: false, ability: null, target: null, struck: null, hits: {}, missed: [], heals: {}, statuses: {}, falls: [], counter: 0, lost: [] }
    const events = f.events.slice(from)
    let answered = false
    for (const e of events) {
      if (e.type === 'hexed' && e.target === u.uid) out.hexed = true
      else if (e.type === 'action' && e.counter) answered = true
      // Its move's moment comes once its act is over, a counter's answer too (moveMoment): what it does is the piece's.
      else if (e.type === 'trigger' && e.on === 'move' && e.unit === u.uid) answered = false
      else if (e.type === 'action' && e.actor === u.uid && out.ability === null) {
        out.ability = e.ability
        out.target = e.primary ?? null
        out.struck = e.struck ?? e.primary ?? null
      } else if (e.type === 'damage' && !e.status) {
        if (!answered) out.hits[e.target] = (out.hits[e.target] ?? 0) + e.damage
        else if (e.target === u.uid) out.counter += e.damage
      } else if (e.type === 'miss' && !answered) out.missed.push(e.target)
      else if (e.type === 'heal' && !answered) out.heals[e.target] = (out.heals[e.target] ?? 0) + e.heal
      else if (e.type === 'death') (f.byUid.get(e.target)?.side === u.side ? out.lost : out.falls).push(e.target)
    }
    out.statuses = laid(f, events)
    acts.push(out)
  })
  // One lifted again where it fell (Undying) has not fallen.
  for (const x of acts) {
    x.falls = [...new Set(x.falls)].filter((uid) => !alive(f.byUid.get(uid)))
    x.lost = [...new Set(x.lost)].filter((uid) => !alive(f.byUid.get(uid)))
  }
  return { acts, over: f.over, winner: f.winner }
}

// The statuses `events` lay (none a boss's phase grants), as each holder wears them in `f` now: { uid: [{ id, dur,
// stacks }] }; none on one fallen since or that lost it.
function laid (f, events) {
  const out = {}
  const phase = new Set(events.filter((e) => e.type === 'phase').map((e) => `${e.target}|${e.status}`))
  for (const e of events) {
    if (e.type !== 'status' || phase.has(`${e.target}|${e.status}`)) continue
    const x = f.byUid.get(e.target)
    const s = x && alive(x) && x.statuses.find((y) => y.id === e.status)
    if (!s || out[e.target]?.some((y) => y.id === s.id)) continue
    ;(out[e.target] ??= []).push({ id: s.id, dur: s.dur, stacks: s.stacks })
  }
  return out
}

// The turn's end: statuses tick and age, cooldowns fall (at the rate the turn was played at: rateOf), the turn
// advances, a wave whose turn has come enters, and the battle is checked for its end.
function closeTurn (battle) {
  battle.stage = 'end'
  battle.beat++
  emit(battle, { type: 'stage', stage: 'end' })
  const rates = new Map()
  for (const u of battle.units) if (alive(u) && Object.values(u.cooldowns).some((n) => n > 0)) rates.set(u, rateOf(battle, u))
  age(battle)
  phases(battle)
  if (settle(battle)) return
  for (const [u, rate] of rates) {
    if (!alive(u)) continue
    for (const id in u.cooldowns) if (u.cooldowns[id] > 0) cool(battle, u, id, Math.max(0, u.cooldowns[id] - rate))
  }
  battle.turn++
  arrive(battle)
  settle(battle)
}

// Whether the battle has run past the sim's bound on turns (TUNING.turn.guard) and may end as a stall (order 'stall').
export const stalled = (battle) => !battle.over && battle.turn > TUNING.turn.guard

// How many turns `u`'s cooldowns fall at this turn's end (`cooldown.rate`): with every status that held through the
// turn, its last one's too, but none laid since its holder's turn passed (`fresh`).
export function rateOf (battle, u) {
  const s = u.statuses.some((x) => x.fresh)
    ? statsOf({ id: u.id, lvl: u.lvl, tracks: u.tracks, pos: pressed(battle, u) ? 'engaged' : 'free' }, modsFor(battle, u, u.statuses.filter((x) => !x.fresh)))
    : stats(battle, u)
  return Math.max(1, Math.round(s.cooldown.rate))
}

// Each status ticks once, then ages a turn and may run out; a `fresh` one waits a round. None once the Monarch falls.
function age (battle) {
  for (let i = 0; i < battle.units.length; i++) {
    const u = battle.units[i]
    if (fallen(battle)) return
    if (!alive(u) || !u.statuses.length) continue
    for (const s of u.statuses.slice()) {
      if (!u.statuses.includes(s)) continue
      if (s.fresh) {
        s.fresh = false
        continue
      }
      for (const effect of statusDef(s.id).tick ?? []) runEffect(battle, effect, u, [u], null, s)
      if (!alive(u)) break
      if (!u.statuses.includes(s) || s.dur === 'battle' || --s.dur > 0) continue
      u.statuses.splice(u.statuses.indexOf(s), 1)
      emit(battle, { type: 'expire', target: u.uid, status: s.id })
    }
  }
}

// The foes whose wave's turn has come enter at the top edge (entryTile; one with no free tile waits); each wave announced
// as its first foe enters, then its moment and onWave. `foeIn` counts from a wave's first entry, never a straggler's.
function arrive (battle) {
  const begun = []
  for (const foe of battle.reserve.slice()) {
    if (entryTurn(foe, battle.every) > battle.turn) continue
    const tile = entryTile(battle, foe.lane, !!unitDef(foe.id).flies)
    if (tile < 0) continue
    const wave = (foe.wave ||= 1)
    battle.reserve.splice(battle.reserve.indexOf(foe), 1)
    if (battle.waveAt[wave] === undefined) {
      battle.waveAt[wave] = battle.foeIn = battle.turn
      begun.push(wave)
      emit(battle, { type: 'wave', wave })
    }
    const unit = enterBattle(battle, { ...foe, side: 'foe', tile })
    emit(battle, { type: 'enter', unit: { uid: unit.uid, id: unit.id, side: unit.side, tile: unit.tile, lvl: unit.lvl, hp: unit.hp, maxHp: unit.maxHp, ...marks(unit) } })
    const w = battle.waves.find((x) => x.wave === wave)
    if (w) w.entered = true
  }
  for (const wave of begun) {
    if (fallen(battle)) return
    waveMoment(battle)
    for (const side of ['party', 'foe']) call(battle, 'onWave', side, { wave })
  }
}

// ── playing ──────────────────────────────────────────────────────────────────────────────────────

// Plays `n` turns, `policy(battle)` giving your turns' orders (basicTurn: End Turn alone), fewer if the battle ends.
export function playTurns (battle, n, policy = basicTurn) {
  for (let k = 0; k < n && !battle.over; k++) {
    const orders = policy(battle)
    for (let i = 0; i < orders.length && !battle.over && orders[i].type !== 'end'; i++) order(battle, orders[i])
    if (!battle.over) order(battle, { type: 'end' })
  }
  return battle
}

// Plays a battle to its end, or past TUNING.turn.guard turns to a stall (a passive side may hold one forever).
export function playOut (battle, policy = basicTurn) {
  playTurns(battle, Math.max(0, TUNING.turn.guard + 1 - battle.turn), policy)
  if (stalled(battle)) order(battle, { type: 'stall' })
  return battle
}

// What an act would do, played on a fork before it is committed: { struck, line, damage, counter, heal, hits, kills,
// falls, heals, statuses, cleansed, rises }: `struck` who it lands on (a blocker on the line, a Bodyguard), `line` the
// tiles it crosses, `damage` on the struck, `counter` its answer's on the actor, `heal` on `target`; `hits`, `heals`,
// `statuses`, `cleansed` by uid; `falls` the foes it fells, `rises` the corpses risen on its side. Null: not a legal act.
export function preview (battle, uid, ability, target) {
  const f = fork(battle, { quiet: false })
  try {
    order(f, { type: 'act', uid, ability, target })
  } catch {
    return null
  }
  const u = battle.byUid.get(uid)
  const out = {
    damage: 0, counter: 0, heal: 0, hits: {}, struck: target, line: lineOf(battle, u, battle.byUid.get(target), ability), kills: false, falls: [],
    heals: {}, statuses: laid(f, f.events), cleansed: {}, rises: []
  }
  let answered = false
  for (const e of f.events) {
    if (e.type === 'action' && e.counter) answered = true
    // The actor's move's moment, once its act and any answer are over (moveMoment): the act's again.
    else if (e.type === 'trigger' && e.on === 'move' && e.unit === uid) answered = false
    else if (e.type === 'action' && e.actor === uid && e.primary != null && !answered) out.struck = e.struck ?? e.primary
    else if (e.type === 'death' && !answered && f.byUid.get(e.target)?.side !== f.byUid.get(uid).side && !out.falls.includes(e.target)) out.falls.push(e.target)
    else if (e.type === 'damage' && !e.status) {
      if (answered) {
        if (e.target === uid) out.counter += e.damage
      } else {
        out.hits[e.target] = (out.hits[e.target] ?? 0) + e.damage
        if (e.target === out.struck) out.damage += e.damage
      }
    } else if (e.type === 'heal' && !answered) {
      out.heals[e.target] = (out.heals[e.target] ?? 0) + e.heal
      if (e.target === target) out.heal += e.heal
    } else if (e.type === 'cleanse' && !answered) (out.cleansed[e.target] ??= []).push(e.status)
    // A corpse risen on the actor's side (the one event that names a corpse).
    else if (e.corpse != null && e.unit?.side === u.side) out.rises.push(e.corpse)
  }
  // One lifted again where it fell (Undying) has not fallen.
  out.falls = out.falls.filter((x) => !alive(f.byUid.get(x)))
  out.kills = out.falls.includes(out.struck)
  return out
}

// A copy of the battle to play ahead on (preview, policy.js): every unit and status copied, the index, every list of
// units and every rule's holder pointing at the copies, and no events kept (`quiet`). The original is never touched.
export function fork (battle, { quiet = true } = {}) {
  const map = new Map()
  const units = battle.units.map((u) => {
    const c = { ...u, statuses: u.statuses.map((s) => ({ ...s })), cooldowns: { ...u.cooldowns } }
    map.set(u, c)
    return c
  })
  for (const c of units) c.held = c.held.map((r) => ({ ...r, holder: map.get(r.holder) ?? r.holder }))
  const re = (u) => (u === null ? null : map.get(u))
  return {
    ...battle,
    units,
    at: battle.at.map(re),
    sky: battle.sky.map(re),
    byUid: new Map(units.map((u) => [u.uid, u])),
    monarch: battle.monarch && re(battle.monarch),
    auras: battle.auras.map(re),
    phased: battle.phased.map(re),
    reserve: battle.reserve.map((u) => ({ ...u })),
    waveAt: battle.waveAt.slice(),
    waves: battle.waves.map((w) => ({ ...w })),
    events: [],
    quiet,
    syn: {},
    cache: new Map(),
    ruleList: {}
  }
}
