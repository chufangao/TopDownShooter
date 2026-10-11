// The battle (redesign.md §2.3–2.10): the board, pieces, effects, statuses and relics, played as rounds of orders.
// Pure: the same setup and the same orders give the same battle. No dice (§2.16): nothing here reads a random number;
// every blow hits, none crits, and deals computeDamage's mean.
//
// A round: your turn, where each piece of yours may move up to its Move and then act once (order); End Turn ('end'),
// where every piece of yours given no act strikes or mends with its basic alone (untouched), the camp plays its turn
// as one opponent (policy.js foeTurn), and the turn ends: statuses tick, cooldowns fall, a wave whose turn has come
// enters, the turn count advances, and the battle is checked for its end. It is won when no foe stands and none is
// still to come, and lost only the instant the Monarch falls: there is no clock (redesign.md §2.10). The camp's
// impatience ends a battle that would drag (policy.js press: full `TUNING.policy.press.turns` after the last wave
// entered, every foe comes, and tends no one). Only a side that never acts can still hold one forever (it mends the
// Monarch as fast as the foes in reach hurt it): for the autoplayer and the tests, played out past TUNING.turn.guard
// turns, a battle ends as a stall (playOut, the `stall` order), never in play order by order, as the interface's.
//
// The battle (createBattle) carries: `units` (every unit that has taken its place, in acting order, the dead too),
// `at` and `sky` (the tile index: the living unit on the ground and in the air on each tile, a 2×2 piece on all four),
// `byUid`, `monarch`, `walls`, `root` (the tile the roads run to), `reserve` (the foes still to enter), `events`,
// `relics` (the run's, every copy owned: run relics work unheld), `arise` (Arise's reach and tier for a holder, the
// run's: run.js ariseOf), `over`, `winner`, `reason`, `death` (what felled the Monarch); and the turns':
// `turn` (1-based), `phase` ('orders' while your orders are taken, 'resolving' inside End Turn), `stage` ('party',
// 'foes' or 'end': whose part of the round it is), `beat` (the index its events carry), `foeIn` (the turn the last
// wave came in: the camp's patience counts from it), `waves` ([{ wave, turn, foes, entered }]: the later waves and the
// turn each enters on), `purse` (the essence the run held as the battle began, less what it has spent here), `spent`,
// `fused` ([{ recipe, uid, id, lvl, tracks, parts, by, price }]: the fusions made here, for the run; `by` the fuser).
// On each unit: `move` (its Move now), `moved` (tiles spent this turn), `acted`, `from` (where it stood as its turn
// began: Undo's tile), `cooldowns` ({ ability id: turns left }), `temper`, `basic` and `mend` (its basic blow and
// basic heal, ability defs or null), `kit` (its abilities, with what its relics grant: Arise), `relics` (the piece
// relics it holds, ids: redesign.md §2.15) and `held` (their rules, and its kind's override: rules.js heldRules).
//
// Orders (legalOrders lists every one the player may give now; order applies one, throwing on an illegal one):
//   { type: 'move', uid, tile }                a piece of yours moves to `tile` (reach: within its Move, by a path)
//   { type: 'undo', uid }                      it goes back to `from`, its Move whole again (until it acts)
//   { type: 'act', uid, ability, target }      it acts: `target` is always a unit's uid: a blow's primary (a Shape's
//                                              too), an ally for a heal, itself for a self or all-allies ability, the
//                                              corpse for Arise (a skill of the piece holding an Arise relic)
//   { type: 'fuse', id, uid, parts }           piece `uid` fuses recipe `id` of `parts` (uids, `uid` among them)
//   { type: 'end' }                            End Turn
//   { type: 'stall' }                          past TUNING.turn.guard turns, the battle ends as a stall: never the
//                                              player's (legalOrders never lists it), the autoplayer's and playOut's
//
// Events, each stamped with its `beat` (events of one beat play together):
//   battle:start, enter, wave, action, damage, miss, heal, status (`dur` in turns), expire, cleanse, death, burst, arise,
//   tithe, rise, rule, trigger, phase, battle:end (reason 'monarch', 'wipe', 'sovereign', or 'stall': no winner)
//   { type: 'turn', turn, next }               a turn begins: `next` the next wave ({ wave, turn }) or null
//   { type: 'stage', stage }                   'untouched', 'foes' or 'end': a part of the round begins
//   { type: 'move', actor, from, to, path }    a move (`path`: each tile stepped onto, `to` the last)
//   { type: 'undo', actor, from, to }          a move undone
//   { type: 'action', …, tile, counter? }      `tile`: where it acts from; `counter`: a counter, the target's answer
//   { type: 'cooldown', target, ability, turns }  a skill's cooldown set or fallen (0: ready)
//   { type: 'hexed', target }                  a Hexed unit's act lost
//   { type: 'fuse', actor, recipe, parts, price, unit }  a fusion in battle: `unit` the fused piece, as `enter`'s
//
// `ablate` (a measuring switch, never a player's: autoplay.js ABLATIONS) lists rules taken from your side: 'arise' (no
// relic grants Arise), 'synergies' (your side holds no synergy) and 'summons' (no tier brings a summon). `quiet` (a
// rehearsal's): the battle keeps no events; it plays out exactly as it would otherwise.
import { TUNING } from '../tuning.js'
import { unitDef, abilityDef, statusDef, relicDef, FUSION_LIST, FUSIONS } from '../content.js'
import { hashString } from './rng.js'
import {
  alive, livingOn, enemySide, isAllyShape, isBlow, footprint, distanceBetween, unitDistance, rangeOf, expand, makeUnit, sizeOf, tileX, tileY,
  tileAt, NEIGHBOURS, deployTile, statsOf, activeSynergies, abilitiesOf, auraOf, armOf, blowReach, summonsOf, heldMods, CENTRE_OUT, TILES
} from './unit.js'
import {
  LANE, field, fieldOf, airOf, roadOf, arrowOf, roadLeft, layerOf, around, foesNextTo, pressed, auraGivers, riseTile, summonTile, entryTile
} from './field.js'
import { call, heldRules, grantsOf, unhealable } from './rules.js'
import { foeTurn, basicTurn } from './policy.js'

// The board's reads and the rules a side holds, for the interface and the tests: one module to import the battle from.
export { field, fieldOf, airOf, roadOf, arrowOf, foesNextTo, auraGivers, riseTile }
export { rulesOf, holds } from './rules.js'

// ── the battle ───────────────────────────────────────────────────────────────────────────────────

// `setup` (run.js battleSetup): `party` and `foes` are run pieces { uid, id, lvl, tracks, hp, maxHp, slot, relics? };
// the battle works on copies, and only pieces on the field (slot ≥ 0) with HP left take part, each on its slot's board
// tile (the party's in its camp, past `walls`, a list of board tiles). `reserve`: the foes still to come, each with
// its `wave` (1, 2…: wave k enters at turn 1 + k × TUNING.spawn.waves.every) and its slot's `lane`. `partyMods` and
// `foeMods`: mods on every unit of the side but the Monarch (the run relics' side-wide costs; the floor's growth);
// `relics`: the run's, every copy owned; `arise`: { domain, tier }, Arise's reach and tier for any holder (run.js
// ariseOf; TUNING.arise by default); `essence`, the run's purse as the battle begins (what a fusion here may spend:
// default 0); `fuse`, per recipe id { price, lvl, tracks }: what it costs here (run.js fuseCost), and the level and
// tiers its fused kind stands at in the run (a recipe with no price is not made here; no level, the parts' highest; no
// tiers, none); `nextUid`: where the uids of units made here start (by default past every uid here, the reserve's
// included); battle.nextUid is the first still free when it ends. The foes hold their synergies' rules on every floor,
// as yours do (redesign.md §2.12).
//
// The Monarch (a party unit whose def is `monarch`) stands on its seat: the roads run to it. It holds no relic, never
// moves, never strikes and never raises. A battle with no Monarch (a test, a sample) has its roads run to the camp's
// rear middle tile, and ends on a wipe.
export function createBattle ({
  party, foes, floor = 1, boss = false, partyMods = [], foeMods = [], walls = [], arise = TUNING.arise, nextUid = null,
  reserve = [], relics = [], ablate = [], quiet = false, essence = 0, fuse = {}
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
    purse: essence, spent: 0, fused: [], fuse
  }
  for (const u of units) occupy(battle, u)
  for (const u of units) fit(battle, u)
  // Each soul of yours whose tiers bring summons calls them now, in acting order (none with the `summons` switch).
  if (!battle.ablate.has('summons')) for (const u of units) if (u.side === 'party' && u !== monarch) summon(battle, u)
  battle.waves = schedule(battle.reserve)
  emit(battle, {
    type: 'battle:start',
    walls: [...battle.walls],
    // A summon is marked as a shadow (and `summoned`), with the uid of the soul that called it (`summoner`); a piece
    // holding relics names them (`relics`).
    units: battle.units.map((u) => ({
      uid: u.uid, id: u.id, side: u.side, slot: u.slot, tile: u.tile, lvl: u.lvl, hp: u.hp, maxHp: u.maxHp, ...marks(u),
      ...(u.summoned && { shadow: true, summoned: true, summoner: u.summoner }), ...(u.relics.length && { relics: u.relics.slice() })
    })),
    synergies: ['party', 'foe'].flatMap((side) => synergiesOf(battle, side).map((s) => ({ side, id: s.id, name: s.name }))),
    // The Monarch's uid (null without one) and the tile the roads run to, for the renderer.
    monarch: monarch?.uid ?? null,
    root: battle.root,
    // The foes still to enter, in order, with the wave each comes in.
    reserve: battle.reserve.map((u) => ({ uid: u.uid, id: u.id, lvl: u.lvl, ...marks(u), side: 'foe' }))
  })
  // The opening formation is the first wave: its moment comes before anyone acts.
  if (battle.units.some((u) => u.side === 'foe' && alive(u)) && !fallen(battle)) waveMoment(battle)
  startTurn(battle)
  settle(battle)
  return battle
}

// What marks a unit in the events that announce it: a foe's wave (k ≥ 1: it came after the first formation), and a
// 2×2 piece's size.
const marks = (u) => ({ ...(u.wave && { wave: u.wave }), ...(u.size > 1 && { size: u.size }) })

// The per-battle fields a unit fights with, on a copy: no statuses yet, no phase reached; the rest is set as it takes
// its place (occupy).
const fresh = (u) => ({ ...u, relics: (u.relics ?? []).slice(), statuses: [], phase: 0 })

// A unit takes its place in the battle: on the board's index (on every tile of its footprint; a flyer's in the air,
// battle.sky, anyone else's on the ground, battle.at), in the order it acts (after everyone already there), with
// what its kit makes fixed for the battle: its abilities (and what its relics' rules grant it: Arise), its aura, its
// arm, whether it flies, its size (a piece of yours its kind's and tiers', a foe piece always 1), its relics' rules
// and mods; and its turn fields. The Monarch has no ability: it never acts. A flyer may hover over a wall; nothing
// else stands on one. Two flyers never share a tile, nor two on the ground. Everything that enters mid-battle comes
// through here too (enterBattle).
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
  // A piece relic's mods are its holder's (redesign.md §2.15).
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
  u.acted = false
  u.from = u.tile
  u.cooldowns = {}
  u.temper = temperOf(u.id)
  u.basic = basicOf(u.kit)
  u.mend = mendOf(u.kit)
}

// Max HP includes the unit's HP mods (synergies, relics, track tiers); a summon rises at TUNING.summon.hp of it;
// current HP keeps its fraction. Read once, as it takes its place: HP mods that come and go mid-battle do not stretch
// the bar. The Monarch's max HP is the run's (its base and its HP relics) and nothing else's (see modsFor).
function fit (battle, u) {
  if (u === battle.monarch) return
  const max = Math.max(1, Math.round(stats(battle, u).hp * (u.summoned ? TUNING.summon.hp : 1)))
  if (max === u.maxHp) return
  u.hp = Math.max(1, Math.round(u.hp * max / u.maxHp))
  u.maxHp = max
}

// A unit joins a battle under way (a shadow, a foe from the reserve, a fused piece): `u` is a living run unit with its
// `side` and an open `tile` on the board; it gets the per-battle fields and its max HP fitted to its mods, as a unit
// there from the start does, and acts after everyone already there. The caller emits the event that announces it.
// The roster changes, so every cache of who is on the board refreshes. Returns the battle unit.
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

// The turn a foe of the reserve's wave comes on (redesign.md §2.10: "wave 2 on turn 5"), TUNING.spawn.waves.every turns
// apart from the first (turn 1): it enters as the turn before ends (arrive), and stands on the board for that turn.
export const entryTurn = (foe) => 1 + (foe.wave || 1) * TUNING.spawn.waves.every

function schedule (reserve) {
  const out = []
  for (const foe of reserve) {
    const wave = foe.wave || 1
    const w = out.find((x) => x.wave === wave)
    if (w) w.foes++
    else out.push({ wave, turn: entryTurn(foe), foes: 1, entered: false })
  }
  return out.sort((a, b) => a.turn - b.turn || a.wave - b.wave)
}

// The next wave still to enter ({ wave, turn }), or null.
export const nextWave = (battle) => {
  const w = battle.waves.find((x) => !x.entered)
  return w ? { wave: w.wave, turn: w.turn } : null
}

// How far the camp's patience has run, 0 to 1: the turns since the last wave came in (foeIn), of
// TUNING.policy.press.turns. At 1 the camp is out of it (policy.js press, hasty): every foe comes. Never shown.
export const impatience = (battle) => Math.min(1, Math.max(0, (battle.turn - battle.foeIn) / Math.max(1, TUNING.policy.press.turns)))

// A turn of yours begins: every piece of yours whole again, the rules' moment, its Move read, the counts announced.
function startTurn (battle) {
  battle.stage = 'party'
  battle.phase = 'orders'
  for (const u of battle.units) if (u.side === 'party') ready(u)
  call(battle, 'onTurn', 'party', { side: 'party', turn: battle.turn })
  refresh(battle)
  battle.beat++
  emit(battle, { type: 'turn', turn: battle.turn, next: nextWave(battle) })
}

const ready = (u) => {
  u.moved = 0
  u.acted = false
  u.from = u.tile
}

// Every living unit's Move as its stats give it now (statuses, auras and tiers counted), for the board to show and
// the orders to read. The Monarch never moves, whatever hastens it.
function refresh (battle) {
  for (const u of battle.units) if (alive(u)) u.move = u === battle.monarch ? 0 : Math.max(0, Math.floor(stats(battle, u).move))
}

// Won when no foe stands and none is to come (the Sovereign's fall crumbles its side: 'sovereign'); lost the instant
// the Monarch falls, or, with none, when the party is wiped. Whether the battle is over.
export function settle (battle) {
  if (battle.over) return true
  const m = battle.monarch
  let party = 0
  let foe = battle.reserve.length
  for (const u of battle.units) if (u.hp > 0) u.side === 'party' ? party++ : foe++
  const lost = m ? !alive(m) : !party
  if (!lost && foe) return false
  finish(battle, lost ? 'foe' : 'party', lost ? (m ? 'monarch' : 'wipe') : battle.crumbled ? 'sovereign' : 'wipe')
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

// A quiet battle (a rehearsal's) keeps no events: nothing in the battle reads them back.
export function emit (battle, ev) {
  if (battle.quiet) return
  battle.events.push({ beat: battle.beat, ...ev })
}

export const timelineHash = (events) => hashString(JSON.stringify(events))

// ── kinds on turns ───────────────────────────────────────────────────────────────────────────────

// A kind's temperament (content.js TEMPERS): its def's three values; none for the Monarch, which never acts.
export const temperOf = (id) => unitDef(id).temper ?? null

// A kind's basic blow: the blow its def marks `basic`, else the last in its kit (a kit lists its basics last, and a
// tier that teaches a skill puts it before them); its basic heal, the same among its abilities that mend or cleanse an
// ally. A tier that swaps a basic swaps a basic (Shatter Lance for Frost Lance).
const basicIn = (list) => list.find((a) => a.basic) ?? list.at(-1) ?? null
export const basicOf = (kit) => basicIn(kit.filter(isBlow))
export const mendOf = (kit) => basicIn(kit.filter((a) => isAllyShape(a.shape) && a.shape !== 'self' && a.effects.some((e) => (e.op === 'heal' && !e.self) || e.op === 'cleanse')))
// A skill: anything not a basic. Every skill rests a turn: cooldown 2 unless its def says (restOf).
export const isSkill = (u, a) => a !== u.basic && a !== u.mend

// How long a skill of `u`'s rests once used: its def's `cooldown`, 2 where absent, or what a rule granting it says
// (Blood Tithe's Arise rests no turn).
const restOf = (u, a) => Math.min(a.cooldown ?? 2, ...u.held.filter((r) => r.grants === a.id && r.params.cooldown).map((r) => r.params.cooldown))

// ── stats and synergies ──────────────────────────────────────────────────────────────────────────

// Who stands on a side only changes when someone dies, enters or rises, and each bumps the roster (a rise clears the
// side's list). A holder of Mimicry counts as its role besides its own (rules.js `roles`).
export function synergiesOf (battle, side) {
  const c = battle.syn[side]
  if (c?.v === battle.roster) return c.list
  const also = (u) => u.held.flatMap((r) => r.roles?.(battle, u, r) ?? [])
  const list = side === 'party' && battle.ablate.has('synergies') ? [] : activeSynergies(livingOn(battle.units, side), also)
  battle.syn[side] = { v: battle.roster, list }
  return list
}

// What bends a unit's stats now: its statuses (or those given: rateOf's), its side's synergies, the auras it stands
// in, its side's mods, and the piece relics it holds. The Monarch takes no synergy's or relic's mods: its stats are its
// own, its max HP the run's (guarding it is a placement problem, never a stat purchase). What stands around it still
// counts (a status on it, an aura it stands in).
export function modsFor (battle, unit, statuses = unit.statuses) {
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

// Cached on everything stats depend on, so nothing has to remember to invalidate it: whether a foe stands next
// to it, the allies whose aura reaches it, its statuses with their stacks (in order), and its side's synergies
// (the Monarch takes none). Everything else modsFor reads is the battle's, or the unit's, for good.
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
  // (statsOf reads only these of a unit: its kind, level and track tiers, and its position.)
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

// A blow's damage, with no dice: the mean of power × ATK ÷ atkDivisor, mitigated by DEF, × `mul` (damage dealt and
// taken), rounded, never below the minimum.
export function computeDamage ({ power, atk, def, mul = 1 }) {
  const t = TUNING.damage
  const raw = power * (atk / t.atkDivisor)
  return Math.max(t.min, Math.round(raw * (t.defConstant / (t.defConstant + Math.max(0, def))) * mul))
}

// `status` is the status whose tick runs the effect, if one does.
export function runEffect (battle, effect, actor, targets, ability = null, status = null) {
  if (effect.op === 'cooldown') return cooldown(battle, effect, effect.self ? [actor] : targets)
  // A `self` heal mends the actor once, whoever it struck and whether they still stand.
  if (effect.self) return alive(actor) && heal(battle, actor, actor, effect.power)
  // A damage-over-time tick (Burning): `power` true damage a stack of the status: it takes no DEF and no mod, and is no
  // blow. Whoever laid the status deals it (its `by`, standing or fallen), else its holder.
  if (effect.op === 'dot') {
    const by = (status?.by != null && battle.byUid.get(status.by)) || actor
    for (const target of targets) {
      if (alive(target)) applyDamage(battle, target, effect.power * (status?.stacks ?? 1), { actor: by, ability: null, status: status?.id ?? null })
    }
    return
  }
  // Raising works on the dead: an Arise's corpse (its shadow `arisen`, its raiser's: the rules hear of it, onRaise), or
  // with `count` the field's dead (Grave Tide: raiseDead).
  if (effect.op === 'raise') {
    if (effect.count) return raiseDead(battle, actor, effect.count)
    for (const corpse of targets) {
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
      const a = stats(battle, actor)
      const d = stats(battle, target)
      const damage = computeDamage({ power: effect.power, atk: a.atk, def: d.def, mul: a.damage.dealt * d.damage.taken })
      applyDamage(battle, target, damage, { actor, ability: ability?.id ?? null })
    } else if (effect.op === 'heal') {
      heal(battle, actor, target, effect.power, effect.pct)
    } else if (effect.op === 'apply_status') {
      // A status an effect lays always lands (§2.16), for the effect's `turns`, else its own.
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

// The `cooldown` op: `amount` turns added to every cooldown of each target (−1: its skills a turn sooner; a delay
// never touches a boss), none below 0.
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

// A skill of `u`'s set to rest `turns` (0: ready), and said (the sprite's pip reads it).
export function cool (battle, u, id, turns) {
  u.cooldowns[id] = turns
  emit(battle, { type: 'cooldown', target: u.uid, ability: id, turns })
}

// A heal mends `power` scaled by the healer's ATK and healing given, or with `pct` that share of the target's max
// HP (a relic's), never past its max HP. While the run holds Court of Bone nothing heals the Monarch.
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

// The rules that bend damage as it lands (rules.js modify: the actor's side's, then the target's); null: it missed.
function land (battle, target, amount, { actor, ability, status }) {
  const ctx = { actor, target, ability: ability ? abilityDef(ability) : null, status, damage: amount, miss: false, as: 'actor' }
  if (actor) call(battle, 'modify', actor.side, ctx)
  ctx.as = 'target'
  call(battle, 'modify', target.side, ctx)
  if (ctx.miss) {
    emit(battle, { type: 'miss', actor: actor.uid, target: target.uid })
    return null
  }
  return Math.max(0, Math.round(ctx.damage))
}

// Damage lands: a blow's, or a status's tick (`status`, its id: Burning's), which is no blow. The rules bend it
// first (land: Last Stand leaves the first damage that would fell at 1 HP, Mirage turns the first blow a foe would
// land). A blow that lands on one that stands is the 'struck' moment of the relics it holds.
export function applyDamage (battle, target, amount, { actor, ability = null, status = null }) {
  amount = land(battle, target, amount, { actor, ability, status })
  if (amount === null) return
  target.hp = Math.max(0, target.hp - amount)
  emit(battle, { type: 'damage', actor: actor.uid, target: target.uid, damage: amount, ability, hp: target.hp, ...(status && { status }) })
  if (!alive(target)) fall(battle, target, actor, ability)
  else if (!status) trigger(battle, 'struck', target, target, actor)
}

// A unit falls to `actor`'s blow (or a status `actor` laid). A kind that bursts on death bursts (burst). The rules of
// its side hear of it first (onFall): Undying may lift its holder again where it fell, which has still fallen (it was
// struck down, and the death shows: it burst, and the fall relics fire over it) but leaves the board as it was.
// Otherwise it leaves the board; a boss's fall crumbles its side; the Monarch's is recorded and ends the battle; the
// fallen's relics fire ('fall'), its slayer's ('kill'), and the other side's rules hear of the kill (onKill: the
// Legion, Frenzy).
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
  // What felled the Monarch, for the defeat screen and the ladder: who, with what, from where, the first threat its
  // kind carries, and for a foe that came in a later wave, which one.
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

// A fallen piece leaves the tile index, every tile of its footprint, in its layer.
export function vacate (battle, u) {
  const layer = layerOf(battle, u)
  for (const t of footprint(u.tile, u.size)) if (layer[t] === u) layer[t] = null
}

// A death burst (its kind's `onFall`, { range, effects }): as a piece of the kind falls, its effects run from where it
// fell, the fallen piece their caster, on the other side's living within `range` of its footprint. Announced first.
export function burst (battle, u) {
  const on = unitDef(u.id).onFall
  if (!on) return
  const targets = around(battle, u.tile, on.range, enemySide(u.side), u.size)
  emit(battle, { type: 'burst', actor: u.uid, tile: u.tile, targets: targets.map((x) => x.uid) })
  for (const effect of on.effects) runEffect(battle, effect, u, targets)
}

// A boss's fall: its court and every other foe still standing crumble with it, each a death (`crumble: true`) as if
// slain (they pay essence), and the foes still to come never enter. The battle is won: no crumbled foe bursts, rises,
// or is a moment.
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
// Whether a Legion's shadow may rise on `side`: for the party, only while it has fewer than TUNING.army.board pieces on
// the board (unbounded, one for every foe slain would pack the board until a later wave found no tile to enter on). A
// foe side needs no bound: its shadows only ever rise from your dead.
export const roomFor = (battle, side) => side !== 'party' || pieces(battle) < TUNING.army.board

// The size a shadow of `corpse` rising on `side` stands at: a foe piece's 1; one of yours its kind's (a shadow holds
// no tiers).
export const shadowSize = (corpse, side) => (side === 'party' ? sizeOf({ id: corpse.id }) : 1)

// The corpse rises on `side` (the actor's) as a shadow of itself, at its level with its own kit, at full HP. One of
// yours rises where its footprint is free closest to the Monarch (riseTile; in the air, for a flying kind's), never
// where it fell: with none free it does not rise (null). One on the foes' side rises where it fell, if no one holds
// that tile in its layer (else null). A shadow counts toward synergies and leaves when the battle ends; its corpse
// cannot rise again. It keeps the uid of the corpse it rose from (`corpse`); the event says where it fell (`from`), and
// marks a Legion's (`rule`). Returns the shadow, or null.
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

// The Sovereign's Grave Tide: up to `count` of the field's dead rise on the actor's side as shadows, where they fell
// (raise): the fallen of either side, never a shadow, a boss, the Monarch, one consumed by a fusion or one risen
// already, lying where no one living stands; the strongest first, then the nearest, then the first to have stood.
function raiseDead (battle, actor, count) {
  const d = (c) => unitDistance(actor, c)
  const dead = battle.units.filter((c) => !alive(c) && !c.raised && !c.shadow && !c.into && !unitDef(c.id).boss && !unitDef(c.id).monarch)
    .sort((a, b) => unitDef(b.id).tier - unitDef(a.id).tier || d(a) - d(b) || a.uid - b.uid)
  for (const c of dead) {
    if (count <= 0) break
    if (layerOf(battle, c)[c.tile] !== null) continue
    raise(battle, actor, c)
    count--
  }
}

// A status laid on `target` by `by` (a unit, or none) for `turns` (its def's when not given; 'battle' for the battle):
// a second of one held stacks (up to its def's stacks) and lasts the longer (one as long but `fresh` lasts a turn
// more); `by` is who laid it last, the one its damage ticks are dealt by. A status laid after its holder's turn of the
// round has passed (on one of yours in the foes' turn, on anyone at the turn's end) is `fresh`: the round's end does not
// count against it (redesign.md §2.8). Hexed always costs an act: laid on one that has already acted this round (a
// counter's on its attacker), it is fresh too, and holds until its next act is lost.
export function addStatus (battle, target, id, turns, by = null) {
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

// A moment of a holder's (redesign.md §2.15: a piece relic's `on` fires on its holder's events): 'kill' (it slays a
// foe: the slain the place and the other end), 'struck' (a blow lands on it and it stands: its attacker the other
// end), 'fall' (it falls: its killer the other end), 'blow' (it strikes, an act of its: its primary the other end),
// 'wave' (a foe wave begins while it stands: the battle's opening, then each later wave). Each relic it holds that
// fires on the moment is announced ({ type: 'trigger', relic, on, unit: the holder }) and its effects run, the holder
// their caster, on the targets each picks: the holder, the one on the other end, the Monarch, or either side around
// the place (`place`, a unit: around its footprint).
export function trigger (battle, on, subject, place, other = null) {
  for (const id of subject.relics) {
    const relic = relicDef(id)
    if (relic.on !== on) continue
    emit(battle, { type: 'trigger', relic: id, on, unit: subject.uid })
    for (const effect of relic.effects) runEffect(battle, effect, subject, triggered(battle, effect, subject, place, other))
  }
}

function triggered (battle, effect, subject, place, other) {
  switch (effect.to) {
    case 'self': return alive(subject) ? [subject] : []
    // The one on the other end, never the subject itself.
    case 'other': return other && other !== subject && alive(other) ? [other] : []
    case 'monarch': return battle.monarch && alive(battle.monarch) ? [battle.monarch] : []
    case 'allies': return around(battle, place.tile, effect.range, subject.side, place.size)
    case 'foes': return around(battle, place.tile, effect.range, enemySide(subject.side), place.size)
    default: throw new Error(`unknown trigger target "${effect.to}"`)
  }
}

// A wave's moment: every living holder of a 'wave' relic, in acting order.
function waveMoment (battle) {
  for (const u of battle.units.slice()) if (alive(u) && u.relics.length) trigger(battle, 'wave', u, u)
}

// ── reach and targets ────────────────────────────────────────────────────────────────────────────

export const hexed = (u) => u.statuses.some((s) => s.id === 'hexed')

// How far a blow of `u`'s reaches a flyer, its reach being `r`: melee from the ground reaches none (−1), a flyer's
// melee meets a flyer in the air.
export const aloft = (u, a, r) => (a.melee && !u.flies ? -1 : r)

// Whether an ally ability of `u`'s can do anything for `x`: mend it (the ability heals, its HP is short, and it is no
// Monarch nothing may heal), or strip a status it would cleanse.
export function canMend (battle, u, a, x) {
  if (mends(a) && x.hp < x.maxHp && !(x === battle.monarch && battle.unhealable)) return true
  return a.effects.some((e) => e.op === 'cleanse' && x.statuses.some((s) => statusDef(s.id).tags.includes(e.tag)))
}

// How far ability `a` of `u`'s reaches its primaries: a blow its reach (blowReach), an ally ability its range, as the
// rules of its side bend it (rules.js reach: Sanctuary's anywhere).
function rangeFor (battle, u, a) {
  const ctx = { actor: u, ability: a, range: isBlow(a) ? blowReach(u, a) : rangeOf(a) }
  call(battle, 'reach', u.side, ctx)
  return ctx.range
}

// The primaries ability `a` of `u`'s may take with `u` standing on `tile`: a blow's foes within its reach; an ally
// ability's allies within its range; itself for a self or all-allies ability; Arise's corpses.
export function targetsFrom (battle, u, a, tile = u.tile) {
  if (a.shape === 'corpse') return corpses(battle, u, tile)
  if (a.shape === 'self' || a.shape === 'all_allies') return [u]
  const r = rangeFor(battle, u, a)
  if (isAllyShape(a.shape)) return battle.units.filter((x) => x.side === u.side && alive(x) && (x === u || distanceBetween(tile, u.size, x.tile, x.size) <= r))
  return around(battle, tile, r, enemySide(u.side), u.size, aloft(u, a, r))
}

// Whether a heal of others (`mends`): an ability that heals someone not its caster.
export const mends = (a) => a.effects.some((e) => e.op === 'heal' && !e.self)

// Whether `a`'s condition holds for `u` (content.js `when`, where the condition is the rule): a heal's allies those it
// can do something for.
export function allowed (battle, u, a) {
  if (!a.when) return true
  const enemies = livingOn(battle.units, enemySide(u.side))
  let allies = livingOn(battle.units, u.side)
  if (mends(a)) allies = allies.filter((x) => canMend(battle, u, a, x) && unitDistance(u, x) <= rangeOf(a))
  return a.when({ self: u, allies, enemies })
}

// Whether `u` may use `a` now, whatever its target: a basic always; a skill off cooldown; its condition holding.
export const usable = (battle, u, a) => (!isSkill(u, a) || !(u.cooldowns[a.id] > 0)) && allowed(battle, u, a)

// Whether `u` may still act this turn.
export const canAct = (battle, u) => !battle.over && alive(u) && !u.acted && !hexed(u)

// Arise's reach and tier for a holder `u` (redesign.md §2.15): the battle's (the run's: TUNING.arise and the run
// relics on `arise.domain` and `arise.tier`), and what the rules granting it add (Court of Bone's tiles). → { domain,
// tier }, or null for a unit whose kit holds no Arise.
export function ariseOf (battle, u) {
  if (!u.kit.some((a) => a.shape === 'corpse')) return null
  const grants = u.held.filter((r) => r.grants)
  return {
    domain: battle.arise.domain + grants.reduce((n, r) => n + (r.params.domain ?? 0), 0),
    tier: battle.arise.tier + grants.reduce((n, r) => n + (r.params.tier ?? 0), 0)
  }
}

// What `u`'s Arise may raise, it standing on `tile`: a fallen foe, never raised, never a shadow, a boss or one consumed
// by a fusion, of a tier up to its Arise's, within its Arise's reach of it (ariseOf), with a free tile for its shadow
// beside the Monarch; none once a boss has fallen (its court is dust), and none while a rule of its holder's says no
// (Blood Tithe with the Monarch's HP at the tithe).
export function corpses (battle, u, tile = u.tile) {
  const arise = ariseOf(battle, u)
  if (!arise || !alive(u) || battle.crumbled) return []
  if (u.held.some((r) => r.raisable && !r.raisable(battle, u, r))) return []
  return battle.units.filter((c) => c.side !== u.side && !alive(c) && !c.raised && !c.shadow && !c.into && !unitDef(c.id).boss &&
    unitDef(c.id).tier <= arise.tier && distanceBetween(c.tile, c.size, tile, u.size) <= arise.domain &&
    (u.side !== 'party' || riseTile(battle, c.tile, shadowSize(c, u.side), c.flies) >= 0))
}

// Who an ability touches, aimed at `primary`: its shape's spread, turned first by the rules of the target's side (a
// Bodyguard), then by the actor's (Dragonfire, Sanctuary). → { primary, targets }.
function spread (battle, u, a, primary) {
  const ctx = { actor: u, ability: a, primary, targets: null, as: 'target' }
  if (isBlow(a)) call(battle, 'targets', primary.side, ctx)
  ctx.targets = shape(battle, u, a, ctx.primary)
  ctx.as = 'actor'
  call(battle, 'targets', u.side, ctx)
  return ctx
}

// The units a shape touches from its primary: a blast its primary and its side's units around its footprint, the
// rest as unit.js expand; a melee blow from the ground never strikes a flyer.
export function shape (battle, u, a, primary) {
  if (a.shape === 'corpse') return [primary]
  const out = a.shape === 'blast' ? around(battle, primary.tile, 1, primary.side, primary.size) : expand(battle.units, u, a, primary)
  return a.melee && !u.flies && primary.side !== u.side ? out.filter((x) => !x.flies) : out
}

// ── acting ───────────────────────────────────────────────────────────────────────────────────────

// `u` uses `a` on `primary`, from where it stands: its act for the turn. A skill rests (its cooldown set first, so a
// rule that readies it, Frenzy's, may undo that); the rules hear of it (onStruck, onBlow: Echo); a blow is its
// holder's 'blow' moment; a melee blow's target answers it (counter); the HP phases are read; the battle may end. The
// battle is lost the instant the Monarch falls: once a blow has felled it, nothing of the blow follows.
export function perform (battle, u, a, primary) {
  battle.beat++
  const { primary: aimed, targets } = spread(battle, u, a, primary)
  emit(battle, { type: 'action', actor: u.uid, ability: a.id, anim: a.anim, primary: aimed.uid, targets: targets.map((x) => x.uid), tile: u.tile })
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

// A counter (redesign.md §2.6): the target of a melee blow, still standing within its own basic blow's reach of the
// attacker (the attacker on `from`: where it stands, or where the policy weighs striking from), answers at once with
// that blow, if it is melee, on the attacker alone; never a Hexed piece, never the Monarch, never ground at a flyer;
// one a blow, and a counter is never answered. → the blow, or null.
export function counterOf (battle, defender, attacker, from = attacker.tile) {
  if (!alive(defender) || !alive(attacker) || defender.side === attacker.side || defender === battle.monarch || hexed(defender)) return null
  const b = defender.basic
  if (!b?.melee || (attacker.flies && !defender.flies) || distanceBetween(defender.tile, defender.size, from, attacker.size) > blowReach(defender, b)) return null
  return b
}

function counter (battle, defender, attacker) {
  if (battle.over || fallen(battle)) return
  const b = counterOf(battle, defender, attacker)
  if (!b) return
  battle.beat++
  emit(battle, { type: 'action', actor: defender.uid, ability: b.id, anim: b.anim, targets: [attacker.uid], tile: defender.tile, counter: true })
  for (const effect of b.effects) runEffect(battle, effect, defender, [attacker], b)
}

// Whom one of yours left untouched aims a blow at among `list`: the foe furthest along its road (roadLeft: the lowest
// road distance to the Monarch), ties by lane, centre first, then the nearest, then the first to act.
export function pick (battle, u, list) {
  let best = list[0] ?? null
  for (let i = 1; i < list.length; i++) {
    const x = list[i]
    const k = (roadLeft(battle, x) - roadLeft(battle, best)) || (LANE[tileX(x.tile)] - LANE[tileX(best.tile)]) || (unitDistance(x, u) - unitDistance(best, u))
    if (k < 0) best = x
  }
  return best
}

// One left untouched this turn acts at End Turn (redesign.md §2.5), from where it stands, with its basics alone: its
// basic blow at the foe furthest along its road (pick), else its basic heal on the most wounded it can do something
// for, else nothing. A Hexed one loses its act.
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

// The allies a heal of `u`'s standing on `tile` can do something for (canMend), as primaries: for an all-allies one,
// itself, once anyone in its range can use it.
export function helped (battle, u, a, tile) {
  if (a.shape === 'all_allies') {
    const r = rangeFor(battle, u, a)
    return battle.units.some((x) => x.side === u.side && alive(x) && distanceBetween(tile, u.size, x.tile, x.size) <= r && canMend(battle, u, a, x)) ? [u] : []
  }
  return targetsFrom(battle, u, a, tile).filter((x) => canMend(battle, u, a, x))
}

const lowest = (list) => list.slice().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.uid - b.uid)[0]

// ── moving ───────────────────────────────────────────────────────────────────────────────────────

// Whether piece `u`'s footprint may pass anchored at `t`: on the board, and on the ground no wall and no foe on it (a
// flyer goes over anything).
function passes (battle, u, t) {
  const tiles = footprint(t, u.size)
  if (!tiles) return false
  if (u.flies) return true
  for (const x of tiles) if (battle.walls.has(x) || (battle.at[x] !== null && battle.at[x].side !== u.side)) return false
  return true
}

// Whether no wall stands on `u`'s footprint anchored at `t` (a diagonal step's corner test: unit.js steps).
const clear = (battle, u, t) => footprint(t, u.size)?.every((x) => !battle.walls.has(x)) ?? false

// Whether `u` may end a move anchored at `t`: its footprint free in its layer (but for itself), no wall under one on
// the ground.
export function endable (battle, u, t) {
  const tiles = footprint(t, u.size)
  if (!tiles) return false
  const layer = layerOf(battle, u)
  return tiles.every((x) => (layer[x] === null || layer[x] === u) && (u.flies || !battle.walls.has(x)))
}

// The tiles a piece of yours may move to now, each with its path (redesign.md §2.2): within `budget` steps (its Move
// left, by default), stepping as unit.js steps (no wall, never diagonally past a wall's corner), through your own
// pieces but never through a foe, never ending on a held tile; a flyer over anything. → Map tile → path (each tile
// stepped onto, the last the tile), in the order a flood finds them.
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

// The road a foe may take this turn (redesign.md §2.9.3): its road's tiles from where it stands, up to `steps` ahead,
// stopping before the first held one (a ground foe's by anyone on the ground; a flyer's by a piece of yours below or
// anyone in the air) or a wall. → [{ tile, path }], its own tile first.
export function roadAhead (battle, u, steps = u.move - u.moved) {
  const road = roadOf(battle, u)
  const out = [{ tile: u.tile, path: [] }]
  const path = []
  for (let t = road.arrow[u.tile], k = 0; t >= 0 && k < steps; t = road.arrow[t], k++) {
    const holder = u.flies ? (battle.at[t] !== null && battle.at[t].side !== u.side ? battle.at[t] : battle.sky[t]) : battle.at[t]
    if ((holder !== null && holder !== u) || (!u.flies && battle.walls.has(t))) break
    path.push(t)
    out.push({ tile: t, path: path.slice() })
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

// A soul's summons (unit.js summonsOf: its tiers' `summon`), called as the battle begins: each a shadow of its kind on
// your side (`shadow`, `summoned`, and `summoner`: the soul's uid), at its level and with its tiers, at
// TUNING.summon.hp of a whole one's HP (see fit), on the free tile nearest it (field.js summonTile); with no free tile
// left, fewer rise. A summon is a shadow in every other way: it takes no orders, counts toward synergies, holds no
// relic, pays nothing, and is gone when the battle ends. It brings no summons of its own.
export function summon (battle, u) {
  const size = sizeOf(u)
  const flies = !!unitDef(u.id).flies
  for (let k = summonsOf(u); k > 0; k--) {
    const tile = summonTile(battle, u, size, flies)
    if (tile < 0) return
    const piece = makeUnit(u.id, { uid: battle.nextUid++, lvl: u.lvl, tracks: u.tracks })
    enterBattle(battle, { ...piece, side: 'party', shadow: true, summoned: true, summoner: u.uid, tile })
  }
}

// ── fusing in battle (redesign.md §2.4) ──────────────────────────────────────────────────────────

// What fusion `id` costs here and the level and tiers its piece stands at, as the setup gives them (the run's: run.js
// battleSetup, its fuseCost; the battle keeps no price of its own), or null: a recipe the setup does not price is not
// made here. The piece stands at least at its parts' highest level (fuse), its tiers none where none are given.
function fusing (battle, id) {
  const given = Object.hasOwn(FUSIONS, id) ? battle.fuse?.[id] : null
  if (!Number.isFinite(given?.price)) return null
  return { recipe: FUSIONS[id], price: given.price, lvl: given.lvl ?? 1, tracks: (given.tracks ?? [0, 0]).slice() }
}

// Whether `parts` (units) are recipe `id`'s exactly, fused by `u` among them: souls, each within a tile of `u`, the
// recipe priced here (fusing) and the purse holding the price, and the fused piece's footprint free on `u`'s anchor once
// the parts' tiles count free.
function fusible (battle, u, id, parts) {
  const terms = fusing(battle, id)
  if (!terms || !parts.includes(u) || new Set(parts).size !== parts.length) return false
  const { recipe, price, tracks } = terms
  const got = {}
  for (const p of parts) {
    if (!orderable(battle, p) || unitDistance(p, u) > 1 || !Object.hasOwn(recipe.needs, p.id)) return false
    got[p.id] = (got[p.id] ?? 0) + 1
  }
  if (!Object.entries(recipe.needs).every(([kind, n]) => got[kind] === n) || battle.purse < price) return false
  const flies = !!unitDef(recipe.result).flies
  const tiles = footprint(u.tile, sizeOf({ id: recipe.result, tracks }))
  const layer = flies ? battle.sky : battle.at
  return !!tiles && tiles.every((t) => (flies || !battle.walls.has(t)) && (layer[t] === null || parts.includes(layer[t])))
}

// The fusions `u` may make where it stands, as orders: per recipe it is a part of, its nearest parts (then the lower
// uids). Whether it may act at all is the caller's (legalOrders, policy.js expertTurn: canAct).
export function fusionsOf (battle, u) {
  const out = []
  if (!orderable(battle, u)) return out
  for (const r of FUSION_LIST) {
    if (!Object.hasOwn(r.needs, u.id)) continue
    const parts = [u]
    for (const [kind, n] of Object.entries(r.needs)) {
      const near = battle.units.filter((x) => x !== u && x.id === kind && orderable(battle, x) && unitDistance(x, u) <= 1)
        .sort((a, b) => unitDistance(a, u) - unitDistance(b, u) || a.uid - b.uid)
      parts.push(...near.slice(0, n - (kind === u.id ? 1 : 0)))
    }
    if (fusible(battle, u, r.id, parts)) out.push({ type: 'fuse', id: r.id, uid: u.uid, parts: parts.map((p) => p.uid) })
  }
  return out
}

// The parts are consumed where they stand (off the board: `into` the fused piece's uid, never a corpse; the relics they
// held go back to the run unheld, and their rules with them), the price is paid from the purse, and the fused piece
// stands on `u`'s anchor, full HP, fresh cooldowns, holding no relic, its act spent.
function fuse (battle, u, id, parts) {
  const { recipe, price, lvl, tracks } = fusing(battle, id)
  battle.beat++
  battle.purse -= price
  battle.spent += price
  const uid = battle.nextUid++
  for (const p of parts) {
    vacate(battle, p)
    p.hp = 0
    p.statuses = []
    p.raised = true
    p.into = uid
    // Its relics go back to the run with their rules: none fires for it again (a Burning it laid that slays later).
    p.relics = []
    p.held = []
  }
  battle.roster++
  const level = Math.max(lvl, ...parts.map((p) => p.lvl))
  const unit = enterBattle(battle, { ...makeUnit(recipe.result, { uid, lvl: level, tracks }), side: 'party', tile: u.tile })
  unit.acted = true
  battle.fused.push({ recipe: id, uid, id: recipe.result, lvl: level, tracks, parts: parts.map((p) => p.uid), by: u.uid, price })
  emit(battle, {
    type: 'fuse', actor: u.uid, recipe: id, parts: parts.map((p) => p.uid), price,
    unit: { uid, id: unit.id, side: 'party', tile: unit.tile, lvl: unit.lvl, hp: unit.hp, maxHp: unit.maxHp, ...(unit.size > 1 && { size: unit.size }) }
  })
}

// ── orders ───────────────────────────────────────────────────────────────────────────────────────

// A piece the player orders, and a soul that may go into a fusion: one of yours, living, no shadow (summons and
// shadows act as the untouched do), never the Monarch (it never moves nor acts).
export const orderable = (battle, u) => u.side === 'party' && alive(u) && !u.shadow && u !== battle.monarch

function mine (battle, uid) {
  const u = battle.byUid.get(uid)
  if (battle.over || battle.phase !== 'orders') throw new Error('no orders are taken now')
  if (!u || !orderable(battle, u)) throw new Error(`no piece ${uid} of yours takes orders`)
  return u
}

// The acts `u` may make from where it stands: each ability it may use at each target it may take (a shape that
// touches all it reaches, once).
export function actsOf (battle, u) {
  const out = []
  if (!canAct(battle, u)) return out
  for (const a of u.kit) {
    if (!usable(battle, u, a)) continue
    const list = targetsFrom(battle, u, a)
    for (const x of a.shape === 'all' ? list.slice(0, 1) : list) out.push({ type: 'act', uid: u.uid, ability: a.id, target: x.uid })
  }
  return out
}

// Every order the player may give now (none once the battle is over).
export function legalOrders (battle) {
  if (battle.over || battle.phase !== 'orders') return []
  const out = []
  for (const u of battle.units) {
    if (!orderable(battle, u) || u.acted) continue
    for (const tile of reach(battle, u).keys()) out.push({ type: 'move', uid: u.uid, tile })
    out.push(...actsOf(battle, u))
    if (canAct(battle, u)) out.push(...fusionsOf(battle, u))
    if (u.moved > 0 && endable(battle, u, u.from)) out.push({ type: 'undo', uid: u.uid })
  }
  out.push({ type: 'end' })
  return out
}

// Applies one order (legalOrders' kinds) and returns the events it made; End Turn runs the rest of the round.
export function order (battle, o) {
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
    const path = u.acted ? null : reach(battle, u).get(o.tile)
    if (!path) throw new Error(`${u.id} ${u.uid} cannot move to ${o.tile}`)
    walk(battle, u, path)
  } else if (o.type === 'undo') {
    if (u.acted || !(u.moved > 0) || !endable(battle, u, u.from)) throw new Error(`${u.id} ${u.uid} has no move to undo`)
    battle.beat++
    emit(battle, { type: 'undo', actor: u.uid, from: u.tile, to: u.from })
    relocate(battle, u, u.from)
    u.moved = 0
  } else if (o.type === 'act') {
    const a = u.kit.find((x) => x.id === o.ability)
    const target = a && canAct(battle, u) && usable(battle, u, a) ? targetsFrom(battle, u, a).find((x) => x.uid === o.target) : null
    if (!target) throw new Error(`${u.id} ${u.uid} cannot use ${o.ability} on ${o.target}`)
    perform(battle, u, a, target)
  } else if (o.type === 'fuse') {
    const parts = Array.isArray(o.parts) ? o.parts.map((uid) => battle.byUid.get(uid)) : []
    if (!canAct(battle, u) || parts.some((p) => !p) || !fusible(battle, u, o.id, parts)) throw new Error(`${u.id} ${u.uid} cannot fuse ${o.id} of ${JSON.stringify(o.parts)}`)
    fuse(battle, u, o.id, parts)
    settle(battle)
  } else {
    throw new Error(`unknown order "${o.type}"`)
  }
  refresh(battle)
  return battle.events.slice(from)
}

// End Turn (redesign.md §2.3, steps 2–4): the untouched act, the foes take their turn, the turn ends; then your next
// turn begins, unless the battle is over.
function endTurn (battle) {
  battle.phase = 'resolving'
  battle.beat++
  emit(battle, { type: 'stage', stage: 'untouched' })
  // In acting order, and anyone who rises meanwhile (a Legion's shadow) too.
  for (let i = 0; i < battle.units.length && !battle.over; i++) {
    const u = battle.units[i]
    if (u.side === 'party' && alive(u) && !u.acted && u !== battle.monarch) untouched(battle, u)
  }
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

// The turn's end: statuses tick and age, cooldowns fall, the turn count advances, a wave whose turn has come enters,
// and the battle is checked for its end. Each one's cooldowns fall at the rate it played the turn at, read before its
// statuses age (rateOf).
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

// How many turns `u`'s cooldowns fall at this turn's end (`cooldown.rate`: Hasten's 2): as the turn was played, with
// every status that held through it, the one whose last turn it was too (so a Hasten of one turn, Ambush's, brings a
// skill back sooner), but none laid since its holder's turn passed (`fresh`), which counts from its holder's next.
export function rateOf (battle, u) {
  const s = u.statuses.some((x) => x.fresh)
    ? statsOf({ id: u.id, lvl: u.lvl, tracks: u.tracks, pos: pressed(battle, u) ? 'engaged' : 'free' }, modsFor(battle, u, u.statuses.filter((x) => !x.fresh)))
    : stats(battle, u)
  return Math.max(1, Math.round(s.cooldown.rate))
}

// Each status's tick runs once (a damage-over-time its power a stack, a turn's worth), then it ages a turn and may
// run out; one laid since its holder's turn passed (`fresh`) waits a round. Nothing ticks once the Monarch has fallen.
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

// The foes whose wave's turn has come enter at the top edge (entryTile: each its lane; one with no free entry tile
// waits for a later turn's end). Each wave is announced as its first foe enters; once they are in, it is its holders'
// moment ('wave') and the rules hear of it (onWave). The camp's patience counts from the last wave's first entry
// (foeIn): a straggler that waited for a free tile is that wave's, and never sets it back.
function arrive (battle) {
  const begun = []
  for (const foe of battle.reserve.slice()) {
    if (entryTurn(foe) > battle.turn) continue
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

// Plays `n` turns, `policy(battle)` giving each of your turns' orders (policy.js expertTurn; basicTurn by default: End
// Turn alone) up to End Turn, which ends a turn whose orders do not; fewer if the battle ends first. Returns the battle.
export function playTurns (battle, n, policy = basicTurn) {
  for (let k = 0; k < n && !battle.over; k++) {
    const orders = policy(battle)
    for (let i = 0; i < orders.length && !battle.over && orders[i].type !== 'end'; i++) order(battle, orders[i])
    if (!battle.over) order(battle, { type: 'end' })
  }
  return battle
}

// Plays a battle to its end (playTurns), or, still going once TUNING.turn.guard turns are played, to a stall (the
// autoplayer's rehearsals and the tests: a passive side may hold a battle forever). Returns the battle.
export function playOut (battle, policy = basicTurn) {
  playTurns(battle, Math.max(0, TUNING.turn.guard + 1 - battle.turn), policy)
  if (stalled(battle)) order(battle, { type: 'stall' })
  return battle
}

// What a blow would do, shown before it is committed (redesign.md §2.4): the act played on a copy of the battle
// (fork), read back from its events: `damage` dealt to `target`, `counter` the damage its answer would deal the actor,
// `heal` mended on it, `hits` damage by uid (a Shape's every target, a Bodyguard's), `struck` the uid the blow lands on
// (`target`, or a Bodyguard that takes it in its place), `kills` whether that one would fall, and `falls` every one of
// the other side the act would fell (uids: the interface marks FALLS on each). Null for an act that may not be given.
export function preview (battle, uid, ability, target) {
  const f = fork(battle, { quiet: false })
  try {
    order(f, { type: 'act', uid, ability, target })
  } catch {
    return null
  }
  const out = { damage: 0, counter: 0, heal: 0, hits: {}, struck: target, kills: false, falls: [] }
  let answered = false
  for (const e of f.events) {
    if (e.type === 'action' && e.counter) answered = true
    else if (e.type === 'action' && e.actor === uid && e.primary != null && !answered) out.struck = e.primary
    else if (e.type === 'death' && !answered && f.byUid.get(e.target)?.side !== f.byUid.get(uid).side && !out.falls.includes(e.target)) out.falls.push(e.target)
    else if (e.type === 'damage' && !e.status) {
      if (answered) {
        if (e.target === uid) out.counter += e.damage
      } else {
        out.hits[e.target] = (out.hits[e.target] ?? 0) + e.damage
        if (e.target === target) out.damage += e.damage
      }
    } else if (e.type === 'heal' && e.target === target && !answered) out.heal += e.heal
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
    fused: battle.fused.slice(),
    events: [],
    quiet,
    syn: {},
    cache: new Map(),
    ruleList: {}
  }
}
