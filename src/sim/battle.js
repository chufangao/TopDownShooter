// Everything inside a fight: the tick loop, effects and statuses, rings, footprints and roads, and the combat
// formulas. Real-time in 50 ms ticks, and no input once it starts: the same setup always plays out the
// same. Pure: all randomness comes from battle.rng.
import { TUNING } from '../tuning.js'
import { unitDef, statusDef, abilityDef, relicDef, TRIGGERS } from '../content.js'
import { createRng, hashString } from './rng.js'
import {
  alive, livingOn, statsOf, activeSynergies, expand, enemySide, isAllyShape, isBlow, deployTile, distance, steps, NEIGHBOURS, rangeOf, TILES,
  tileX, tileY, tileAt, abilitiesOf, auraOf, cheapestOf, costliestOf, makeUnit, slotAt, ROWS, CENTRE_OUT, LANES, DEPTH, bodiesOf,
  livingBodies, ringOf, strideOf, sizeOf, footprint, unitDistance, distanceBetween, holdOf, armOf
} from './unit.js'

// ── battle loop ──────────────────────────────────────────────────────────────────────────────────

// party/foes are run pieces { uid, id, lvl, tracks, count, hp, maxHp, slot }; the battle works on copies, and
// only pieces on the field (slot ≥ 0) with HP left take part. Each starts on its slot's board tile (the
// party's in its camp, past `walls`, a list of board tiles). A battle still going at `ceiling` ticks ends
// undecided (the autoplayer rehearses on a shorter budget than the real fight's); the ticks count from the
// last foe to enter (see checkEnd).
//
// The Monarch (a party unit whose def is `monarch`) stands on its seat in the party's camp: the roads run to it
// (fieldOf). Its domain, Arise's reach, is `domain` tiles from it (the run's: run.js domainOf); the rest of Arise's
// numbers the battle reads from the copies of the relic it holds (`relics`: ariseCap, ariseTier, ariseHaste): while
// the run holds it, Arise raises corpses up to a tier, up to a number a battle, and with a copy past the first the
// Monarch's gauge fills faster. Units created mid-battle (shadows) take uids from `nextUid` on (by default, past
// every uid here, the reserve's included); battle.nextUid is the first one still free when the battle ends. A battle
// with no Monarch (a test, a sample) has no domain, its roads run to the camp's rear middle tile, and it ends on a
// wipe.
//
// Your pieces never move (DESIGN §2.3): each fights from the tile it was given, all battle, whatever its blows
// reach in its ring (a melee one its kind's arm: reachOf), and otherwise waits. Only the foes step: a walker along the
// one road every walker takes (the Walk field: walls bend it, your pieces never do), a flyer along the air road,
// straight at the Monarch over the walls but never through your pieces (see stepOf). A foe walks, doing nothing else,
// until it halts where it can hit back: in the sight of a piece of yours (as far as its blows that need no condition
// reach: unit.js holdOf) with something of yours its blows reach, or with its way held; and only fights once halted,
// its melee reaching no further than what blocks it, the Monarch, and a piece beside it that struck it (DESIGN §2.4;
// see chooseAction, wayOf, closeIn).
//
// Stacks and footprints (DESIGN §2.2): a unit is a piece, `count` bodies of one kind on a footprint, its HP one
// pool of count × `body` (one body's HP, fitted as it takes its place: see fit). Its living bodies are ⌈hp ÷
// body⌉ (unit.js livingBodies): they fall one at a time, the pool's blows and heals scale with them, and a heal
// never lifts a fallen body (so a heal's condition and aim count no stack whose living bodies are whole: helps). A
// piece of yours of size 2 (its kind's, or a Colossus tier's) stands on a 2×2 footprint: its tile is the footprint's
// anchor, and the tile index holds it on all four tiles; a foe piece is always size 1. Every hit lands on the pool
// once, a Shape's too, whatever the footprint: the piece is one target.
// A soul whose tiers add bodies (unit.js bodiesOf) fights with them in its pool, whole, for the battle alone; the
// `bodies` switch (ablate) adds none.
//
// The foes: `reserve` lists the foes still to come, in the order they enter, one a tick, each at the top edge in
// its `lane` when its `when` fires. A foe's `wave` is the wave it comes in: 0 (or none) for the foes on the board
// from the start, 1 for the next, and so on; a wave's foes wait for it with `{ at: 'break', wave, t }`: the wave
// before is down to TUNING.spawn.waves.share of its foes, or `t` ticks have passed since it began to enter. Every
// foe walks the roads, or flies (DESIGN §2.4). A boss's fall ends the battle: every foe still standing crumbles
// (see crumble), and its Grave Tide raises the dead on its side.
//
// `relics` are the run's (ids, a copy held twice named twice): the Legendaries' rules bend the party's side of the
// battle (see relicRules: Arise among them, without which the Monarch raises no one), and the relics that trigger
// (`on`) fire for the party, once a copy (see trigger). Their mods come in `partyMods`.
//
// `ablate` (a measuring switch, never a player's: the autoplayer's ablation reports, autoplay.js ABLATIONS) lists
// rules taken away from the party's side: 'arise' (the Monarch's Arise never casts, held or not), 'synergies'
// (the party holds no synergy, at any step, its 8-step rules too) and 'bodies' (no tier adds a body). Empty in
// every real run.
//
// `quiet` (a rehearsal's, autoplay.js): the battle keeps no events (battle.events stays empty). It plays out
// exactly as it would otherwise: nothing in a battle reads its own events.
//
// `settle` (a rehearsal's only, never a real fight's: TUNING.autoplay.settle) lets playOut end the battle once its
// result is settled (see settled), with the units as they stand then: reason 'settled'.
export function createBattle ({
  party, foes, seed, floor = 1, boss = false, partyMods = [], foeMods = [], walls = [], ceiling = TUNING.tick.ceiling,
  domain = TUNING.arise.domain, nextUid = null, reserve = [],
  relics = [], foeRules = true, ablate = [], quiet = false, settle = null
}) {
  // A living soul's piece takes the bodies its tiers add, whole (not the Monarch's; none with the `bodies` switch).
  const added = (u) => (u.hp > 0 && !unitDef(u.id).monarch && !ablate.includes('bodies') ? bodiesOf(u) : 0)
  const grown = (u, k) => (k ? { count: u.count + k, hp: u.hp + k * u.maxHp / u.count, maxHp: u.maxHp + k * u.maxHp / u.count } : {})
  const stamp = (u, side) => fresh({ ...u, side, tile: deployTile(side, u.slot), ...(side === 'party' && grown(u, added(u))) }, 0)
  const units = [...party.map((u) => stamp(u, 'party')), ...foes.map((u) => stamp(u, 'foe'))]
    .filter((u) => u.hp > 0 && u.slot >= 0)
    .sort((a, b) => (a.side < b.side ? -1 : a.side > b.side ? 1 : a.slot - b.slot))
  const held = relicRules(relics)
  const monarch = units.find((u) => u.side === 'party' && unitDef(u.id).monarch) ?? null

  const battle = {
    t: 0, seed, floor, boss, ceiling, over: false, winner: null, reason: null, foeRules, ablate: new Set(ablate), quiet,
    // monarch: its battle unit, or null; death: what felled it ({ by, uid, ability, from, shape, threat });
    // raised: how many shadows Arise has raised.
    monarch, death: null,
    domain, raised: 0, nextUid: nextUid ?? Math.max(0, ...units.map((u) => u.uid), ...reserve.map((u) => u.uid)) + 1,
    // reserve: the foes still to enter, in order; byUid: every unit that has taken its place, by uid.
    reserve: reserve.map((u) => ({ ...u })), byUid: new Map(),
    // waveAt: the tick each foe wave began to enter (wave 0 stands from the start); crumbled: a boss fell and
    // its side crumbled with it. foeIn: the tick the last foe entered (0: none has; the escalation clock and the
    // ceiling count from it). blown: the battle's first blow has landed (the 'blow' moment has come).
    waveAt: [0], crumbled: false, foeIn: 0, blown: false,
    units: [], events: [], walls: new Set(walls),
    // root: the tile the roads run to (the Monarch's; with none, the camp's rear middle). roads: the Walk field and
    // the air road, each made when first read (fieldOf, airOf). watch: what your pieces' sight holds (watchOf), made
    // again whenever `ours` (bumped as a unit of yours enters or falls) has moved on from its `at`.
    root: monarch?.tile ?? tileAt(CENTRE_OUT[0], 0), roads: { walk: null, air: null }, ours: 0,
    watch: { ground: null, air: null, at: -1 },
    partyMods, foeMods,
    rng: createRng(seed).stream('battle'),
    // at: the living unit on the ground on each tile (a 2×2 piece on each of its four), or null; sky: the living
    // flyer in the air over each tile, or null (DESIGN §2.4: flyers hold the air, so a tile holds one of each, and
    // neither blocks the other). roster: bumped whenever a unit dies or enters, so caches of who is on the board key
    // on it. auraReach: the widest aura on the board, how far to look for givers.
    // auras, phased: the units with an aura, and with HP phases, in acting order.
    at: new Array(TILES).fill(null), sky: new Array(TILES).fill(null), roster: 0, auraReach: 0, auras: [], phased: [],
    // risen: bumped when a fallen unit rises where it fell (Undying), the one way back to life with no change of
    // roster; living: the living on each side as last listed (livingNow).
    risen: 0, living: { party: null, foe: null },
    // harm: the damage each side has taken so far (every blow that landed, shadows' too), for a rehearsal's
    // settle check (settled).
    harm: { party: 0, foe: 0 },
    // settle, probes: the settle rule and its look back (every HP and the party's harm, every `every` ticks).
    // won: the tick the 'won' verdict began to hold, unbroken since (null while it does not).
    settle, probes: settle ? [] : null, won: null,
    syn: {}, cache: new Map(),
    // held: the relics' rules (relicRules); triggers: the relics that fire, by moment, a copy each.
    held, triggers: triggersOf(relics)
  }
  for (const u of units) occupy(battle, u)
  for (const u of units) fit(battle, u)
  // Ambush (Skirmisher 8): a side holding it starts with every gauge full.
  for (const u of units) if (rulesOf(battle, u.side).has('ambush')) u.gauge = u.costliest

  emit(battle, {
    type: 'battle:start',
    walls: [...battle.walls],
    units: battle.units.map((u) => ({
      uid: u.uid, id: u.id, side: u.side, slot: u.slot, tile: u.tile, lvl: u.lvl, hp: u.hp, maxHp: u.maxHp, ...marks(u)
    })),
    synergies: ['party', 'foe'].flatMap((side) => synergiesOf(battle, side).filter((s) => !s.rule || rulesOf(battle, side).has(s.rule)).map((s) => ({ side, id: s.id, name: s.name }))),
    // The Monarch's uid (null without one), its domain's reach, and the tile the roads run to, for the renderer.
    monarch: battle.monarch?.uid ?? null,
    domain: battle.monarch ? domain : null,
    root: battle.root,
    // The foes still to enter, in order, with what each waits for.
    reserve: battle.reserve.map((u) => ({ uid: u.uid, id: u.id, lvl: u.lvl, ...marks(u), ...(u.when && { when: u.when }), side: 'foe' }))
  })
  for (const side of ['party', 'foe']) if (rulesOf(battle, side).has('ambush')) emit(battle, { type: 'rule', rule: 'ambush', side })
  return battle
}

// What marks a unit in the events that announce it: its count (its living bodies are ⌈hp ÷ (maxHp ÷ count)⌉), a
// foe's wave (k ≥ 1: it came after the first formation), and a 2×2 piece's size.
const marks = (u) => ({ count: u.count ?? 1, ...(u.wave && { wave: u.wave }), ...(u.size > 1 && { size: u.size }) })

// The per-battle fields a unit fights with: an empty gauge, a step due at once (`nextStep`: a foe's; one of
// yours never steps), no statuses, no one yet who has aimed a blow at it (`struck`: their uids, a Set made at
// the first: a foe strikes back at one beside it, closeIn), and on the move (`walking`: whether a foe's last turn
// walked it, or kept it waiting behind a comrade on the move, which a comrade queued behind it reads: wayOf).
// Every battle unit is made with the same fields in the same order (UNIT_FIELDS; one it was not given, or that
// the battle sets later, is there as undefined, which reads as its absence does), so all of them share one
// shape and the tick loop's reads of them stay fast. A field outside the list is copied on after them.
const UNIT_FIELDS = new Set([
  'uid', 'id', 'lvl', 'tracks', 'count', 'hp', 'maxHp', 'slot', 'side', 'tile',
  'when', 'wave', 'lane', 'shadow', 'corpse', 'arisen', 'raised', 'foiled', 'rose', 'stood',
  'gauge', 'nextStep', 'statuses', 'phase', 'struck', 'walking', 'ord', 'kit', 'aura', 'cheapest', 'costliest', 'ring', 'arm',
  'every', 'flies', 'size', 'body'
])
const fresh = (u, t) => {
  const out = {
    uid: u.uid,
    id: u.id,
    lvl: u.lvl,
    tracks: u.tracks,
    count: u.count ?? 1,
    hp: u.hp,
    maxHp: u.maxHp,
    slot: u.slot,
    side: u.side,
    tile: u.tile,
    when: u.when,
    wave: u.wave,
    lane: u.lane,
    shadow: u.shadow,
    corpse: u.corpse,
    arisen: u.arisen,
    raised: u.raised,
    foiled: u.foiled,
    rose: u.rose,
    stood: u.stood,
    gauge: 0,
    nextStep: t,
    statuses: [],
    phase: 0,
    struck: null,
    walking: true,
    // set as it takes its place (occupy)
    ord: undefined,
    kit: undefined,
    aura: undefined,
    cheapest: undefined,
    costliest: undefined,
    ring: undefined,
    arm: undefined,
    every: undefined,
    flies: undefined,
    size: undefined,
    // set as it is fitted (fit)
    body: undefined
  }
  for (const k in u) if (!UNIT_FIELDS.has(k)) out[k] = u[k]
  return out
}

// A unit takes its place in the battle: on the board's index (on every tile of its footprint; a flyer's in the air,
// battle.sky, anyone else's on the ground, battle.at), in the order it acts (after everyone already there), with
// what its kit makes fixed for the battle: its abilities in priority order, its aura, its cheapest and costliest
// ability, its ring, its arm (unit.js armOf: how far a melee blow of yours reaches), how often it may step (`every`
// ticks: a foe's, by its stride; never, for one of yours: your pieces never move, DESIGN §2.3), whether it flies
// (a foe that does takes the air road, any other the Walk field: roadOf), and its size (a piece of yours its kind's
// and tiers', a foe piece always 1).
// A flyer may hover over a wall; nothing else stands on one. Two flyers never share a tile, nor two on the ground.
// Everything that enters mid-battle comes through here too (enterBattle).
function occupy (battle, u) {
  if (!alive(u)) throw new Error(`${u.id} has no HP to fight with`)
  u.flies = !!unitDef(u.id).flies
  u.size = u.side === 'party' ? sizeOf(u) : 1
  const tiles = Number.isInteger(u.tile) && u.tile >= 0 && u.tile < TILES ? footprint(u.tile, u.size) : null
  if (!tiles || (!u.flies && tiles.some((t) => battle.walls.has(t)))) throw new Error(`tile ${u.tile} cannot be stood on`)
  const layer = layerOf(battle, u)
  if (tiles.some((t) => layer[t])) throw new Error(`tile ${u.tile} is taken`)
  u.ord = battle.units.length
  u.kit = abilitiesOf(u).map(abilityDef)
  u.aura = auraOf(u)
  u.cheapest = cheapestOf(u)
  u.costliest = costliestOf(u)
  u.ring = ringOf(u)
  u.arm = armOf(u)
  u.every = u.side === 'foe' ? Math.max(1, Math.round(TUNING.board.stepTicks / strideOf(u))) : Infinity
  if (u.every === Infinity) u.nextStep = Infinity
  battle.units.push(u)
  battle.byUid.set(u.uid, u)
  for (const t of tiles) layer[t] = u
  battle.auraReach = Math.max(battle.auraReach, u.aura?.range ?? 0)
  if (u.aura) battle.auras.push(u)
  if (phasesOf(u.id)) battle.phased.push(u)
}

// One body's HP includes the unit's HP mods (synergies, relics, track tiers), and a shadow's bodies rise at
// TUNING.arise.hp of it; max HP is count × body, and current HP keeps its fraction. Read once, as it takes
// its place: HP mods that come and go mid-battle do not stretch the bar. The Monarch's max HP is the run's (its
// base and its HP relics) and nothing else's (see modsFor): the one the camp shows.
function fit (battle, u) {
  if (u === battle.monarch) {
    u.body = u.maxHp
    return
  }
  u.body = Math.max(1, Math.round(stats(battle, u).hp * (u.shadow ? TUNING.arise.hp : 1)))
  const max = u.count * u.body
  if (max === u.maxHp) return
  u.hp = Math.max(1, Math.round(u.hp * max / u.maxHp))
  u.maxHp = max
}

// A unit joins a battle under way (a shadow, a foe from the reserve): `u` is a living run unit with its
// `side` and an open `tile` on the board; it gets the per-battle fields and its max HP fitted to its mods, as a
// unit there from the start does, acts after everyone already there (this very tick, if it enters before the
// turns are done), and may step at once. The caller emits the event that announces it. The roster changes, so
// every cache of who is on the board refreshes (one of yours entering, your sight's too: watchOf). Returns the
// battle unit.
export function enterBattle (battle, u) {
  const unit = fresh(u, battle.t)
  occupy(battle, unit)
  battle.roster++
  if (unit.side === 'party') battle.ours++
  fit(battle, unit)
  // Ambush (Skirmisher 8): an entrant on a side holding it comes in with a full gauge.
  if (rulesOf(battle, unit.side).has('ambush')) unit.gauge = unit.costliest
  return unit
}

// One tick. Returns the events it emitted.
export function stepBattle (battle) {
  if (battle.over) return []
  const from = battle.events.length
  tick(battle)
  return battle.events.slice(from)
}

function tick (battle) {
  phases(battle)
  tickStatuses(battle)
  if (battle.t === 0) open(battle)
  // The battle is lost the instant the Monarch falls (a Burning tick may fell it): no one acts after it.
  if (!fallen(battle)) reinforce(battle)
  for (const u of battle.units) {
    if (fallen(battle)) break
    if (!alive(u)) continue
    const s = stats(battle, u)
    // Gauge banks up to the costliest thing the unit can do, and no further: a unit kept waiting does not
    // come out of it with a string of casts.
    u.gauge = Math.min(u.costliest, u.gauge + Math.max(0, (TUNING.gauge.base + s.spd / TUNING.gauge.spdDivisor) * s.gauge.rate))
    act(battle, u)
  }
  checkEnd(battle)
  battle.t++
}

// Whether the Monarch has fallen (never, in a battle with none).
const fallen = (battle) => battle.monarch !== null && !alive(battle.monarch)

// Plays a battle to the end.
export function runBattle (battle) {
  while (!battle.over) tick(battle)
  return { events: battle.events, hash: timelineHash(battle.events), winner: battle.winner, ticks: battle.t }
}

// Plays a battle to the end and returns it, with no summary made (a rehearsal reads only how it ended). With
// `settle`, it may end early, once settled says the result is settled.
export function playOut (battle) {
  const every = battle.settle?.every
  while (!battle.over) {
    tick(battle)
    if (every && !battle.over && battle.t % every === 0) settled(battle)
  }
  return battle
}

// A rehearsal's early end (battle.settle: { k, window, recent, every }), checked every `every` ticks. Settled:
//   won   no foe is still to come; every foe standing has lost HP over the last `recent` ticks (none stands out of
//         reach); and at the rate the foes' HP fell over the last `window` ticks, the party fells the rest in T
//         ticks with k·T still short of the ceiling, while the Monarch's HP exceeds k times what the foes dealt the
//         party in T at their rate over that window: even every blow on the Monarch would not fell it in k times
//         the time the party needs. The Monarch's fall is the only way to lose that does not wait on the ceiling.
//         The verdict must hold unbroken for `window` ticks: a stack's opening volley can fell most of a room in a
//         few ticks while the last foe walks on through every ring to the Monarch (your pieces never follow it),
//         and that battle is lost.
//   lost  the Monarch stands alone: no other unit of its side standing, and Arise spent (or taken away): the
//         battle can only end in its fall or at the ceiling, both losses.
// k is the margin. The battle ends there, scored by the units as they stand (rehearse's scoreOf): a win keeps a
// little more HP than it would by the end (or less, if healers would mend it after the last foe falls). Measured
// on 27,905 rehearsal battles (Speed 2 in the necessity report): at k 4, 29 verdicts (about 1 battle in 960) differ
// from the full battle's, 23 of them a stalemate that runs to the ceiling, 6 a late fall of the Monarch. (That was
// before stacks: a nine-body stack's volley could then settle a battle won at its first check that its last foe,
// walking on through every ring to the Monarch, went on to win; hence the window the verdict must hold.)
function settled (battle) {
  const { window, every } = battle.settle
  const probes = battle.probes
  probes.push({ hp: battle.units.map((u) => u.hp), harm: battle.harm.party })
  if (probes.length > window / every + 1) probes.shift()
  const m = battle.monarch
  if (!m || probes.length <= window / every) return
  if (!battle.units.some((u) => u.side === 'party' && alive(u) && u !== m) &&
    (battle.ablate.has('arise') || battle.raised >= ariseCap(battle.held))) return settle(battle, 'foe')
  if (!winning(battle)) {
    battle.won = null
    return
  }
  battle.won ??= battle.t
  if (battle.t - battle.won >= window) settle(battle, 'party')
}

// The 'won' verdict, now (see settled).
function winning (battle) {
  const { k, window, recent, every } = battle.settle
  const probes = battle.probes
  if (battle.reserve.length) return false
  const then = probes[0]
  const lately = probes[probes.length - 1 - recent / every]
  let now = 0
  let was = 0
  for (let i = 0; i < battle.units.length; i++) {
    const u = battle.units[i]
    if (u.side !== 'foe') continue
    if (i < then.hp.length) was += then.hp[i]
    if (!alive(u)) continue
    if (!(i < lately.hp.length && lately.hp[i] > u.hp)) return false
    now += u.hp
  }
  const rate = (was - now) / window
  if (!(rate > 0)) return false
  const T = now / rate
  const dealt = (battle.harm.party - then.harm) / window
  return battle.t + k * T < battle.foeIn + battle.ceiling && battle.monarch.hp > k * dealt * T
}

function settle (battle, winner) {
  battle.over = true
  battle.winner = winner
  battle.reason = 'settled'
  emit(battle, { type: 'battle:end', winner, reason: 'settled' })
}

export const timelineHash = (events) => hashString(JSON.stringify(events))

function act (battle, u) {
  const chosen = chooseAction(battle, u)
  if (!chosen) return
  if (chosen.to !== undefined) return step(battle, u, chosen.to)
  const { ability, targets, cost, guard } = chosen
  u.gauge -= cost
  if (guard) emit(battle, { type: 'rule', rule: 'bodyguard', side: guard.side, actor: guard.uid, target: guard.for })
  emit(battle, { type: 'action', actor: u.uid, ability: ability.id, anim: ability.anim, targets: targets.map((x) => x.uid) })
  // A blow is aimed at each of the other side it targets, hit or miss, and each remembers who aimed it: a foe strikes
  // back at a piece beside it that struck it (closeIn).
  if (isBlow(ability)) for (const x of targets) if (x.side !== u.side) (x.struck ??= new Set()).add(u.uid)
  for (const effect of ability.effects) runEffect(battle, effect, u, targets, ability)
  // Echo (Channeler 8): the ability rings out once more, free, on the same targets (those still standing);
  // Arise never echoes.
  if (alive(u) && !ability.effects.some((e) => e.op === 'raise') && rulesOf(battle, u.side).has('echo')) {
    emit(battle, { type: 'rule', rule: 'echo', side: u.side, actor: u.uid, ability: ability.id })
    for (const effect of ability.effects) runEffect(battle, effect, u, targets, ability)
  }
}

// A foe's step onto `to`, free (off the gauge; the next is due `every` ticks on), on the ground or in the air. Only
// a foe steps, and a foe piece is size 1.
function step (battle, u, to) {
  emit(battle, { type: 'move', actor: u.uid, from: u.tile, to })
  const layer = layerOf(battle, u)
  layer[u.tile] = null
  layer[to] = u
  u.tile = to
  u.nextStep = battle.t + u.every
}

// Each status ages, ticks its effects every `tickEvery` (a Burning tick may fell its holder: its statuses go with
// it, and once the Monarch has fallen nothing ticks on), and runs out.
function tickStatuses (battle) {
  for (const u of battle.units) {
    if (fallen(battle)) return
    if (!alive(u) || !u.statuses.length) continue
    // Most ticks nothing ticks and nothing runs out: then each status only ages, in place.
    if (u.statuses.every((s) => !(statusDef(s.id).tick && (s.age + 1) % statusDef(s.id).tickEvery === 0) && (s.dur === 'battle' || s.dur - 1 > 0))) {
      for (const s of u.statuses) {
        s.age++
        if (s.dur !== 'battle') s.dur--
      }
      continue
    }
    for (const s of u.statuses.slice()) {
      const def = statusDef(s.id)
      s.age++
      if (def.tick && s.age % def.tickEvery === 0) {
        for (const effect of def.tick) runEffect(battle, effect, u, [u], null, s)
        if (!u.statuses.includes(s)) break
      }
      if (s.dur === 'battle' || --s.dur > 0) continue
      u.statuses.splice(u.statuses.indexOf(s), 1)
      emit(battle, { type: 'expire', target: u.uid, status: s.id })
    }
  }
}

// HP thresholds grant a status; a loop, so one big hit can cross two.
const phaseLists = new Map()
const phasesOf = (id) => {
  let list = phaseLists.get(id)
  if (list === undefined) phaseLists.set(id, (list = unitDef(id).phases ?? null))
  return list
}
function phases (battle) {
  for (const u of battle.phased) {
    const list = phasesOf(u.id)
    if (!alive(u)) continue
    while (u.phase < list.length && u.hp / u.maxHp <= list[u.phase].at) {
      const { grant } = list[u.phase++]
      emit(battle, { type: 'phase', target: u.uid, phase: u.phase, status: grant })
      addStatus(battle, u, grant)
    }
  }
}

// Lost the instant the Monarch falls (reason 'monarch'), whoever else stands: a party wiped but for the
// Monarch fights on. Won when no foe stands or is still to enter ('sovereign' when the boss fell and its side
// crumbled with it, else 'wipe'). Still going at the ceiling: undecided, which the run counts as a defeat. A
// battle with no Monarch is lost when the party is wiped. The ceiling counts from the last foe to enter, as the
// escalation clock does: each wave gets the whole window the first had, so its ramp (×bossMult in the Sovereign's
// room) always comes before the ceiling. Foes enter on timers (a wave at most `waves.t` after the
// one before began), so the battle stays bounded.
function checkEnd (battle) {
  const m = battle.monarch
  let party = 0
  let foe = battle.reserve.length
  for (const u of battle.units) if (u.hp > 0) u.side === 'party' ? party++ : u.side === 'foe' && foe++
  const lost = m ? !alive(m) : !party
  if (!lost && foe && battle.t + 1 < battle.foeIn + battle.ceiling) return
  battle.over = true
  battle.winner = lost ? 'foe' : !foe ? 'party' : null
  battle.reason = lost && m ? 'monarch' : lost ? 'wipe' : !foe ? (battle.crumbled ? 'sovereign' : 'wipe') : 'tick-ceiling'
  emit(battle, { type: 'battle:end', winner: battle.winner, reason: battle.reason, ...(battle.death && { death: battle.death }) })
}

// ── the reserve ──────────────────────────────────────────────────────────────────────────────────

// The party's pieces on the board: everyone living but the Monarch (shadows too), each once whatever its count.
const pieces = (battle) => battle.units.reduce((n, u) => n + (u.side === 'party' && alive(u) && u !== battle.monarch ? 1 : 0), 0)
// Whether a shadow may rise on `side`: for the party, only while it has fewer than TUNING.army.board pieces on
// the board. Unbounded, the Legion's shadows (one for every foe slain) would pack the board in a long fight of
// waves until a later wave found no tile to enter on, and a battle already won would stall to the ceiling. A foe
// side needs no bound: its shadows only ever rise from your dead.
const roomFor = (battle, side) => side !== 'party' || pieces(battle) < TUNING.army.board

// Whether the time has come for a foe still to enter (its `when`): none, or 'once': at once; 'time': once the
// clock reaches `t`; a wave's 'break': once the wave before its own has broken.
function fired (battle, when) {
  if (!when || when.at === 'once') return true
  if (when.at === 'time') return battle.t >= when.t
  if (when.at === 'break') return broken(battle, when)
  throw new Error(`unknown moment "${when.at}"`)
}

// Whether the foe wave before `wave` has broken: `t` ticks gone since it began to enter, or down to
// TUNING.spawn.waves.share of its foes (those still to enter count as standing; shadows are no one's wave).
// A wave that has not begun to enter has not broken.
function broken (battle, { wave, t }) {
  const at = battle.waveAt[wave - 1]
  if (at === undefined) return false
  if (battle.t >= at + t) return true
  let size = 0
  let left = 0
  for (const list of [battle.units, battle.reserve]) {
    for (const u of list) {
      if ((u.side ?? 'foe') !== 'foe' || u.shadow || (u.wave ?? 0) !== wave - 1) continue
      size++
      if (u.hp > 0) left++
    }
  }
  return left <= size * TUNING.spawn.waves.share
}

// The next foe whose time has come enters, one a tick, in reserve order, at the top edge in its lane. It acts this
// very tick, after everyone already there. Every entry restarts the escalation clock (within bounds: see
// escalation); the first foe of a wave announces it ({ type: 'wave', wave }) and is the 'wave' moment, before it
// enters.
function reinforce (battle) {
  if (!battle.reserve.length) return
  // A wave's foes all wait on the same break: it is read once a look down the reserve (nothing changes while
  // the reserve is read).
  const breaks = new Map()
  const due = (when) => {
    if (when?.at !== 'break') return fired(battle, when)
    const key = `${when.wave}|${when.t}`
    if (!breaks.has(key)) breaks.set(key, broken(battle, when))
    return breaks.get(key)
  }
  const body = battle.reserve.find((b) => due(b.when))
  if (body) enter(battle, body)
}

// The battle's opening formation, the foes standing from the start, is its first wave (DESIGN §2.6): its moment, the
// 'wave' trigger, comes on the battle's first tick, before anyone acts (with no foe standing, the first wave's comes
// as it enters). Its foes keep wave 0 in the events (u.wave): a later wave k is the k + 1th to the player.
function open (battle) {
  if (battle.monarch && alive(battle.monarch) && battle.units.some((u) => u.side === 'foe' && alive(u))) trigger(battle, 'wave', battle.monarch, battle.monarch)
}

function enter (battle, body) {
  const tile = entryTile(battle, body.lane, !!unitDef(body.id).flies)
  if (tile < 0) return
  battle.reserve.splice(battle.reserve.indexOf(body), 1)
  if (body.wave && battle.waveAt[body.wave] === undefined) {
    battle.waveAt[body.wave] = battle.t
    emit(battle, { type: 'wave', wave: body.wave })
    if (battle.monarch) trigger(battle, 'wave', battle.monarch, battle.monarch)
  }
  const unit = enterBattle(battle, { ...body, side: 'foe', tile })
  battle.foeIn = battle.t
  emit(battle, {
    type: 'enter',
    unit: { uid: unit.uid, id: unit.id, side: unit.side, tile: unit.tile, lvl: unit.lvl, hp: unit.hp, maxHp: unit.maxHp, ...marks(unit) }
  })
}

// Where a foe enters: the open tile of the foes' rows nearest the top edge in its `lane` (the middle one by default),
// in the air for a flyer (over anyone on the ground, or a wall), ties going to tiles ahead of it (down the board),
// then level with it, then the nearest lane, then the lower tile; −1 while the foes' rows are full (it waits in the
// reserve: foes come from the top edge, never out of the gap row or your camp, past the pieces you placed).
function entryTile (battle, lane = CENTRE_OUT[0], flies = false) {
  const from = deployTile('foe', slotAt(ROWS - 1, lane))
  const layer = flies ? battle.sky : battle.at
  let best = -1
  let bestK = Infinity
  for (let t = tileAt(0, DEPTH - ROWS); t < TILES; t++) {
    if (layer[t] !== null || (!flies && battle.walls.has(t))) continue
    const dy = tileY(from) - tileY(t)
    const k = distance(t, from) * 1e4 + (dy > 0 ? 0 : dy === 0 ? 1 : 2) * 1e3 + Math.abs(tileX(t) - tileX(from)) * 100 + t / TILES
    if (k < bestK) { best = t; bestK = k }
  }
  return best
}

// ── the tile index ───────────────────────────────────────────────────────────────────────────────

// The questions unit.js answers from a list of units, answered from the index (battle.at, the ground, and
// battle.sky, the air: both are read): the same results, at the cost of a few tiles instead of every unit on the
// board. Lists come back in the order the units act (u.ord), as a filter over battle.units would give them, so
// effects and rolls happen in the same order. Every reach is measured from a footprint (DESIGN §2.3): `tile` its
// anchor and `size` its side; the tiles within r of it are a square r wider on every side, and a 2×2 piece found on
// several of them is listed once.

// Where a unit stands in the index: a flyer in the air, anyone else on the ground.
const layerOf = (battle, u) => (u.flies ? battle.sky : battle.at)

// The living units on `side` within `r` tiles of a footprint, in acting order; a flyer only within `air` tiles
// (a melee blow's −1: none).
// (The window clipped to the board, and each unit inserted in acting order as it is found, once: the same list
// as filtering every tile in reach and sorting it, with no sort to call.)
function around (battle, tile, r, side, size = 1, air = r) {
  const out = []
  const x0 = tileX(tile)
  const y0 = tileY(tile)
  const xa = Math.max(0, x0 - r)
  const xb = Math.min(LANES - 1, x0 + size - 1 + r)
  const yb = Math.min(DEPTH - 1, y0 + size - 1 + r)
  for (let y = Math.max(0, y0 - r); y <= yb; y++) {
    for (let x = xa, t = y * LANES + xa; x <= xb; x++, t++) {
      for (let k = 0; k < 2; k++) {
        const u = k ? battle.sky[t] : battle.at[t]
        if (u === null || u.side !== side || (u.flies && air < r && distanceBetween(u.tile, u.size, tile, size) > air)) continue
        let i = out.length
        while (i > 0 && out[i - 1].ord > u.ord) i--
        if (i > 0 && out[i - 1] === u) continue
        for (let j = out.length; j > i; j--) out[j] = out[j - 1]
        out[i] = u
      }
    }
  }
  return out
}

// Whether a living unit of the other side from `side` stands within `r` tiles of a footprint (a flyer only within
// `air`).
function foeWithin (battle, tile, r, side, size = 1, air = r) {
  const x0 = tileX(tile)
  const y0 = tileY(tile)
  const xa = Math.max(0, x0 - r)
  const xb = Math.min(LANES - 1, x0 + size - 1 + r)
  const yb = Math.min(DEPTH - 1, y0 + size - 1 + r)
  for (let y = Math.max(0, y0 - r); y <= yb; y++) {
    for (let x = xa, t = y * LANES + xa; x <= xb; x++, t++) {
      const u = battle.at[t]
      if (u !== null && u.side !== side) return true
      const f = battle.sky[t]
      if (f !== null && f.side !== side && (air >= r || distanceBetween(f.tile, f.size, tile, size) <= air)) return true
    }
  }
  return false
}

// The living foes next to a unit (on a tile beside it, or over or under it on its own).
export const foesNextTo = (battle, u) => around(battle, u.tile, 1, enemySide(u.side), u.size)
// Whether one stands there: the position its `pos` mods read ('engaged' with one, 'free' without).
function pressed (battle, u) {
  if (u.size > 1) return foeWithin(battle, u.tile, 1, u.side, u.size)
  const other = u.flies ? battle.at[u.tile] : battle.sky[u.tile]
  if (other !== null && other.side !== u.side) return true
  const next = NEIGHBOURS[u.tile]
  for (let i = 0; i < next.length; i++) {
    const x = battle.at[next[i]]
    if (x !== null && x.side !== u.side) return true
    const f = battle.sky[next[i]]
    if (f !== null && f.side !== u.side) return true
  }
  return false
}

// The living allies whose aura reaches this unit (from the giver's footprint to its).
export const auraGivers = (battle, u) => battle.auraReach
  ? around(battle, u.tile, battle.auraReach, u.side, u.size).filter((a) => a !== u && a.aura && unitDistance(a, u) <= a.aura.range)
  : []

// How far a unit's blow reaches a foe (DESIGN §2.3), never past its ring: a ranged blow its range (with none, the ring);
// a melee blow of yours its own range where it has one, else its kind's arm (u.arm: 1, or 2 for a long arm, which
// strikes two tiles off, never stepping; a tier that widens the ring lengthens no arm); a foe's melee never past 1, and
// only what closeIn lets it (DESIGN §2.4).
const reachOf = (u, ability) => Math.min(u.ring, !ability.melee ? ability.range ?? Infinity : u.side === 'foe' ? 1 : ability.range ?? u.arm)
// How far a blow of `u`'s reaches a flyer, its reach being `r`: a melee blow from the ground reaches up to none (−1),
// but a flyer's melee meets a flyer in the air; a ranged blow reaches it as anything else (DESIGN §2.3).
const aloft = (u, ability, r) => (ability.melee && !u.flies ? -1 : r)

// Candidate primary targets for an ability: Arise's corpses; an ally ability's allies within its range (all of
// them, with none); a blow's foes within its reach (reachOf), a flyer only for a ranged blow or a flyer's (aloft); a foe's
// melee blow only what closeIn lets it strike.
function reachableOn (battle, actor, ability) {
  if (ability.shape === 'corpse') return corpses(battle, actor)
  if (ability.shape === 'self' || isAllyShape(ability.shape)) return reachableIn(battle, actor, ability)
  if (actor.side === 'foe' && ability.melee) return closeIn(battle, actor)
  const r = reachOf(actor, ability)
  return around(battle, actor.tile, r, enemySide(actor.side), actor.size, aloft(actor, ability, r))
}

// What a foe's melee blow may strike (DESIGN §2.4: a foe has no melee reach): of your pieces beside it, in acting
// order, the one in its way (on its next road tile: a flyer's on its air road), the Monarch, and any that has aimed a
// blow at it this battle (u.struck), which it strikes back at for as long as both stand beside each other. A foe on the
// ground never reaches up to a flyer of yours; a foe flyer meets one in the air (aloft).
function closeIn (battle, u) {
  const block = inWay(battle, u)
  const out = around(battle, u.tile, 1, enemySide(u.side), u.size, u.flies ? 1 : -1)
  return out.filter((x) => x === block || x === battle.monarch || u.struck?.has(x.uid))
}

// Who holds tile `t` in foe `u`'s way, or null (DESIGN §2.4): for a walker, whoever stands on the ground there, its
// side's or the other's (a flyer over it holds the air, not the ground); for a flyer, a piece of the other side on the
// ground there (your pieces block a flyer, a ground foe never does), else whoever is in the air over it, a flyer of
// either side.
function holderOf (battle, u, t) {
  const ground = battle.at[t]
  if (!u.flies) return ground
  return ground !== null && ground.side !== u.side ? ground : battle.sky[t]
}

// Whoever holds a foe's next road tile (arrowOf: a flyer's on the air road), or null: the one in its way (holderOf).
function inWay (battle, u) {
  const next = arrowOf(battle, u)
  return next >= 0 ? holderOf(battle, u, next) : null
}

// unit.js's reachable over battle.units, in one pass: the units on the side it aims at, living, within its range.
function reachableIn (battle, actor, ability) {
  if (ability.shape === 'self') return [actor]
  const side = isAllyShape(ability.shape) ? actor.side : enemySide(actor.side)
  const range = rangeOf(ability)
  const out = []
  for (const u of battle.units) if (u.side === side && u.hp > 0 && unitDistance(actor, u) <= range) out.push(u)
  return out
}

// Arise's numbers are the relic's own, for the copies held (`held`: relicRules, `arise` the copies, `raises` Blood
// Tithe's share): TUNING.arise's for one copy, and TUNING.arise.more's more for each copy past the first. Its cap a
// battle, grown by Blood Tithe's share a copy (0 without the relic, so no shadow rises); the highest tier it raises;
// and how much faster the Monarch's gauge fills (modsFor). Its reach is the run's (run.js domainOf), as `domain`.
const arisePast = (held) => Math.max(0, (held?.arise ?? 0) - 1)
export const ariseCap = (held = {}) => (held.arise > 0 ? (TUNING.arise.raises + TUNING.arise.more.raises * arisePast(held)) * (1 + (held.raises ?? 0)) : 0)
export const ariseTier = (held = {}) => TUNING.arise.tier + TUNING.arise.more.tier * arisePast(held)
export const ariseHaste = (held = {}) => TUNING.arise.more.haste * arisePast(held)

// What Arise may raise: the other side's fallen, not raised yet, never a shadow (it fights on the actor's side) nor a
// boss, of tier up to Arise's (ariseTier), lying within the domain (DESIGN §2.5: `domain` tiles of the Monarch); a
// foe's raise only where no one living holds the corpse's tile in its layer (the ground, or the air for a flyer's);
// and only while the battle's raises last (ariseCap, grown by Blood Tithe), the Monarch never paying a tithe that
// would fell it.
function corpses (battle, actor) {
  if (actor === battle.monarch && battle.ablate.has('arise')) return []
  // A boss's fall has won the battle: its crumbled court never rises (crumble), nor does anyone else, though the units
  // after its slayer still take their turns in the tick it fell.
  if (battle.crumbled) return []
  // Arise is bounded by its own cap, not the board's: its shadows rise past it (they take no place a body needs).
  // Without the Arise relic its cap is 0: no corpse is Arise's to raise.
  if (battle.raised >= ariseCap(battle.held) || (actor !== battle.monarch && !roomFor(battle, actor.side))) return []
  if (actor === battle.monarch && battle.held.tithe && actor.hp <= titheOf(battle, actor)) return []
  // A shadow of yours rises beside the Monarch, whoever stands on its corpse; with no free tile for it in its layer
  // (the air for a flyer's), none rises.
  const mine = actor.side === 'party'
  const room = mine && { ground: riseTile(battle, actor.tile) >= 0, air: riseTile(battle, actor.tile, 1, true) >= 0 }
  if (mine && !room.ground && !room.air) return []
  return battle.units.filter((c) => c.side !== actor.side && !alive(c) && !c.raised && !c.shadow &&
    !unitDef(c.id).boss && unitDef(c.id).tier <= ariseTier(battle.held) &&
    (mine ? (c.flies ? room.air : room.ground) : layerOf(battle, c)[c.tile] === null) && unitDistance(c, actor) <= battle.domain)
}

// Whether a piece of `size` may stand anchored at `tile`: its whole footprint on the board, with no one on it in its
// layer: on open ground, or for a flyer (`flies`) in the air, over anyone on the ground or a wall.
function free (battle, tile, size = 1, flies = false) {
  const layer = flies ? battle.sky : battle.at
  const open = (t) => layer[t] === null && (flies || !battle.walls.has(t))
  if (size === 1) return open(tile)
  const tiles = footprint(tile, size)
  return tiles !== null && tiles.every(open)
}

// Where a shadow of yours of `size` rises (DESIGN §2.5): never where it fell, so the enemy's dead never block its
// roads, but anchored where its footprint is free (free; in the air for a flyer's, `flies`: over the Monarch itself,
// if that is free) closest to the Monarch (with none, to the tile the roads run to); ties to the footprint nearest
// `from`, where it fell, then lane order (CENTRE_OUT), then the lower tile. −1 when no footprint on the board is
// free.
function riseTile (battle, from, size = 1, flies = false) {
  const to = battle.monarch?.tile ?? battle.root
  let best = -1
  let bestK = null
  for (let t = 0; t < TILES; t++) {
    if (!free(battle, t, size, flies)) continue
    // Scanned in tile order, so a tie on all three keeps the lower tile.
    const k = [distanceBetween(t, size, to, 1), distanceBetween(t, size, from, 1), LANE[tileX(t)]]
    if (bestK === null || (k[0] - bestK[0] || k[1] - bestK[1] || k[2] - bestK[2]) < 0) {
      best = t
      bestK = k
    }
  }
  return best
}

// The units an ability hits, as unit.js's expand: a blast is its primary and its side's units around its
// footprint. Dragonfire (Drake 8) bursts a single-target attack like a blast; Sanctuary (Warden 8) carries an ally
// ability to every ally on the board. A melee blow from the ground never strikes a flyer, whatever its shape; a
// flyer's does (aloft, DESIGN §2.3).
function expandOn (battle, actor, ability, primary) {
  const allies = ability.shape === 'ally' || ability.shape === 'all_allies'
  if (allies && rulesOf(battle, actor.side).has('sanctuary')) return livingOn(battle.units, actor.side)
  const burst = ability.shape === 'single' && primary.side !== actor.side && rulesOf(battle, actor.side).has('dragonfire')
  const out = ability.shape === 'blast' || burst ? around(battle, primary.tile, 1, primary.side, primary.size) : expand(battle.units, actor, ability, primary)
  return ability.melee && !actor.flies && primary.side !== actor.side && out.some((u) => u.flies) ? out.filter((u) => !u.flies) : out
}

// Bodyguard (Vanguard 8): a single-target blow from the other side at a unit of a side holding it, not itself
// a Vanguard, falls instead on a Vanguard of its side standing next to it (the one with the most HP, then
// the first to act); null if none stands there.
function bodyguard (battle, actor, ability, primary) {
  const vanguard = (u) => unitDef(u.id).role === 'vanguard'
  if (ability.shape !== 'single' || primary.side === actor.side || !rulesOf(battle, primary.side).has('bodyguard') || vanguard(primary)) return null
  return around(battle, primary.tile, 1, primary.side, primary.size).filter(vanguard).sort((a, b) => b.hp - a.hp || a.ord - b.ord)[0] ?? null
}

// ── events, stats, effects, statuses ─────────────────────────────────────────────────────────────

// A quiet battle (a rehearsal's: autoplay.js) keeps no events: nothing in the battle reads them back.
function emit (battle, ev) {
  if (battle.quiet) return
  battle.events.push({ t: battle.t, ...ev })
}

// Who stands on a side only changes when someone dies or enters, and both bump the roster version.
function synergiesOf (battle, side) {
  const c = battle.syn[side]
  if (c?.v === battle.roster) return c.list
  const list = side === 'party' && battle.ablate.has('synergies') ? [] : activeSynergies(livingOn(battle.units, side), side === 'party' ? battle.held.alias : null)
  const rules = side === 'foe' && !battle.foeRules ? [] : list.flatMap((syn) => syn.rule ?? [])
  return (battle.syn[side] = { v: battle.roster, list, rules: new Set(rules) }).list
}

// The rules a side holds now (the `rule` of each active synergy: the 8 steps). Every rule works for either
// side, but the foes hold theirs only where `foeRules` lets them (the deep: see TUNING.spawn.endless.rules;
// above it their ladders stop at the stat steps). A rule that changes what happens announces it ({ type: 'rule',
// rule, side, … }); those that only
// reshape an attack (Dragonfire, Sanctuary) or its roll (Deadeye) show in the attack itself.
export function rulesOf (battle, side) {
  synergiesOf(battle, side)
  return battle.syn[side].rules
}

// What bends a unit's stats now. The Monarch takes no synergy's or relic's mods: its stats are its own, its max HP
// the run's (guarding it is a placement problem, never a stat purchase). What stands around it still counts (a status
// on it, an aura it stands in).
function modsFor (battle, unit) {
  const mods = []
  const own = unit !== battle.monarch
  for (const s of unit.statuses) {
    for (const m of statusDef(s.id).mods ?? []) for (let n = 0; n < s.stacks; n++) mods.push(m)
  }
  if (own) for (const syn of synergiesOf(battle, unit.side)) mods.push(...syn.mods)
  for (const giver of auraGivers(battle, unit)) mods.push(...giver.aura.mods)
  if (own) mods.push(...(unit.side === 'party' ? battle.partyMods : battle.foeMods))
  // Each copy of Arise past the first hastens the Monarch's gauge: Arise comes sooner (TUNING.arise.more.haste a copy).
  const haste = unit === battle.monarch ? ariseHaste(battle.held) : 0
  if (haste) mods.push({ path: 'gauge.rate', op: 'mul', v: 1 + haste })
  return mods
}

// Cached on everything stats depend on, so nothing has to remember to invalidate it: whether a foe stands next
// to it, the allies whose aura reaches it, its statuses with their stacks (in order), and its side's synergies
// (the Monarch takes none). Everything else modsFor reads is the battle's for good. The key is compared field by
// field, with no string built. The synergies are read again only once the roster has changed (they are the
// roster's), and a change of roster that leaves them as they were keeps the stats.
export function stats (battle, unit) {
  const engaged = pressed(battle, unit)
  const hit = battle.cache.get(unit.uid)
  if (hit !== undefined && hit.engaged === engaged && sameStatuses(hit.statuses, unit.statuses) && sameGivers(battle, unit, hit.givers)) {
    if (hit.roster === battle.roster) return hit.s
    if (sameList(hit.syn, unit === battle.monarch ? null : synergiesOf(battle, unit.side))) {
      hit.roster = battle.roster
      return hit.s
    }
  }
  // (statsOf reads only these of a unit: its kind, level and track tiers, and its position.)
  const pos = engaged ? 'engaged' : 'free'
  const s = statsOf({ id: unit.id, lvl: unit.lvl, tracks: unit.tracks, pos }, modsFor(battle, unit))
  const givers = auraGivers(battle, unit).map((u) => u.uid)
  const statuses = unit.statuses.map((x) => [x.id, x.stacks])
  const syn = unit === battle.monarch ? null : synergiesOf(battle, unit.side)
  battle.cache.set(unit.uid, { engaged, roster: battle.roster, s, givers, statuses, syn })
  return s
}

const sameList = (a, b) => {
  if (a === b) return true
  if (a === null || b === null || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const sameStatuses = (had, now) => {
  if (had.length !== now.length) return false
  for (let i = 0; i < had.length; i++) if (had[i][0] !== now[i].id || had[i][1] !== now[i].stacks) return false
  return true
}

// Whether the allies whose aura reaches `u` are those listed (uids), as auraGivers finds them, with no list
// made: auraGivers takes the units on the board index within the widest aura's reach, so a giver is a unit
// with an aura standing on the index at its tile (battle.at), on u's side, within its aura's range of u (the
// widest reach always covers that). Only the units with an aura are looked at (battle.auras).
function sameGivers (battle, u, had) {
  let n = 0
  for (const a of battle.auras) {
    if (a === u || a.side !== u.side || layerOf(battle, a)[a.tile] !== a || unitDistance(a, u) > a.aura.range) continue
    if (!had.includes(a.uid)) return false
    n++
  }
  return n === had.length
}

// Every blow ramps up startTick (×bossMult for a boss) after the last foe entered (battle.foeIn, the clock the
// ceiling counts on): a wave never walks into ramped damage, and every battle meets at least ceiling − startTick ×
// bossMult ticks of ramp before the ceiling.
export function escalation (battle) {
  const e = TUNING.escalation
  const from = battle.foeIn + e.startTick * (battle.boss ? e.bossMult : 1)
  const over = battle.t - from
  return over > 0 ? Math.min(e.max, 1 + over * e.perTick) : 1
}

// `status` is the status whose tick runs the effect (tickStatuses), if one does.
function runEffect (battle, effect, actor, targets, ability = null, status = null) {
  // A `self` heal mends the actor once, whoever it struck and whether they still stand.
  if (effect.self) return alive(actor) && heal(battle, actor, actor, effect.power)
  // A damage-over-time tick (Burning, DESIGN §2.4): `power` true damage a stack of the status: it never misses,
  // takes no DEF, crit or mod, and is no blow. Whoever laid the status deals it (its `by`, standing or fallen), else
  // its holder.
  if (effect.op === 'dot') {
    const by = (status?.by != null && battle.byUid.get(status.by)) || actor
    for (const target of targets) {
      if (alive(target)) applyDamage(battle, target, effect.power * (status?.stacks ?? 1), { actor: by, isCrit: false, ability: null, status: status?.id ?? null })
    }
    return
  }
  // Raising works on the dead: Arise's corpse (counted toward its cap; Arise's shadows are marked `arisen`:
  // Hollow Court reaps those, and only those), or with `count` the field's dead (raiseDead, uncounted).
  if (effect.op === 'raise') {
    if (effect.count) return raiseDead(battle, actor, effect.count)
    return targets.forEach((corpse) => {
      const shadow = raise(battle, actor, corpse)
      if (!shadow) return
      battle.raised++
      shadow.arisen = true
    })
  }
  const a = stats(battle, actor)
  for (const target of targets) {
    if (!alive(target)) continue
    if (effect.op === 'damage') {
      const d = stats(battle, target)
      const foe = actor.side !== target.side
      // Deadeye (Ranger 8): a ranged blow from a side holding it never misses, and crits.
      const deadeye = foe && !!ability && !ability.melee && rulesOf(battle, actor.side).has('deadeye')
      if (!deadeye && !battle.rng.chance(hitChance(a.acc, d.eva))) {
        emit(battle, { type: 'miss', actor: actor.uid, target: target.uid })
        continue
      }
      // Mirage (Fae 8): the first blow each foe would land on a side holding it misses (actor.foiled: spent).
      if (foe && !actor.foiled && rulesOf(battle, target.side).has('mirage')) {
        actor.foiled = true
        emit(battle, { type: 'rule', rule: 'mirage', side: target.side, actor: actor.uid, target: target.uid })
        emit(battle, { type: 'miss', actor: actor.uid, target: target.uid })
        continue
      }
      const isCrit = deadeye || battle.rng.chance(critChance(a.crt))
      // A stack strikes with every living body (DESIGN §2.2); a fallen piece's death burst (onFall) as one.
      const mul = a.damage.dealt * d.damage.taken * escalation(battle) * Math.max(1, livingBodies(actor))
      let damage = computeDamage({
        power: effect.power,
        atk: a.atk,
        def: d.def,
        isCrit,
        variance: rollVariance(battle.rng),
        mul
      })
      // Deathblow (Trickster 8): a crit from a side holding it slays a body outright (a stack's first: the one
      // wounded, if one is), a boss and the Monarch excepted (no rule ends the run on one roll). Last Stand outranks
      // it: the blow is still raised to a felling one, but a target with its stand unspent takes it at 1 HP
      // (applyDamage), so Deathblow is announced only when it truly slays.
      const front = target.hp - (livingBodies(target) - 1) * target.body
      if (isCrit && foe && damage < front && !unitDef(target.id).boss && target !== battle.monarch && rulesOf(battle, actor.side).has('deathblow')) {
        damage = front
        if (!stands(battle, target)) emit(battle, { type: 'rule', rule: 'deathblow', side: actor.side, actor: actor.uid, target: target.uid })
      }
      applyDamage(battle, target, damage, { actor, isCrit, ability: ability?.id })
    } else if (effect.op === 'heal') {
      heal(battle, actor, target, effect.power, effect.pct)
    } else if (effect.op === 'apply_status') {
      if (effect.chance === undefined || battle.rng.chance(effect.chance)) addStatus(battle, target, effect.status, effect.dur, actor)
    } else if (effect.op === 'cleanse') {
      const hits = target.statuses.filter((s) => statusDef(s.id).tags.includes(effect.tag)).slice(0, effect.count)
      for (const s of hits) {
        target.statuses.splice(target.statuses.indexOf(s), 1)
        emit(battle, { type: 'cleanse', target: target.uid, status: s.id })
      }
    } else if (effect.op === 'gauge') {
      if (effect.amount < 0 && unitDef(target.id).boss) continue
      target.gauge = Math.min(target.costliest, Math.max(0, target.gauge + effect.amount))
      emit(battle, { type: 'gauge', actor: actor.uid, target: target.uid, amount: effect.amount })
    } else {
      throw new Error(`unknown effect op "${effect.op}"`)
    }
  }
}

// A heal mends `power` scaled by the healer's ATK and healing given and its living bodies, or with `pct` that
// share of the target's max HP (a relic's). It mends the living bodies only: a body fallen stays down. With Court
// of Bone nothing heals the Monarch.
function heal (battle, actor, target, power, pct = 0) {
  if (target === battle.monarch && battle.held.unhealable) return
  let amount
  if (pct) {
    amount = Math.max(1, Math.round(target.maxHp * pct))
  } else {
    const a = stats(battle, actor)
    amount = Math.max(1, Math.round(power * a.atk / TUNING.damage.atkDivisor * a.heal.given * livingBodies(actor)))
  }
  const before = target.hp
  target.hp = Math.min(livingBodies(target) * target.body, target.hp + amount)
  emit(battle, { type: 'heal', actor: actor.uid, target: target.uid, heal: target.hp - before, hp: target.hp })
}

// Last Stand (Construct 8): whether the first blow that would fell this unit leaves it at 1 HP instead:
// its side holds the rule, it is not the Monarch, and its stand is unspent (target.stood).
const stands = (battle, u) => !u.stood && u !== battle.monarch && rulesOf(battle, u.side).has('last_stand')

// Damage lands: a blow's (the battle's first the 'blow' moment, one the Monarch stands the 'struck' moment), or a
// status's tick (`status`, its id: Burning's), which is no blow and no moment. Last Stand (see stands, a Deathblow
// included) turns the first that would fell its target: the target is left at 1 HP. Last Stand comes first and
// Undying after it: a unit that stood falls to a later blow, and may rise then.
function applyDamage (battle, target, amount, { actor, isCrit, ability, status = null }) {
  const stand = amount >= target.hp && stands(battle, target)
  if (stand) {
    target.stood = true
    amount = target.hp - 1
  }
  target.hp = Math.max(0, target.hp - amount)
  battle.harm[target.side] += amount
  const first = !status && !battle.blown
  if (!status) battle.blown = true
  emit(battle, { type: 'damage', actor: actor.uid, target: target.uid, damage: amount, isCrit, ability, hp: target.hp, ...(status && { status }) })
  if (stand) emit(battle, { type: 'rule', rule: 'last_stand', side: target.side, target: target.uid })
  if (!alive(target)) fall(battle, target, actor, ability)
  if (status) return
  if (target === battle.monarch && alive(target)) trigger(battle, 'struck', target, target, actor)
  // The battle's first blow: the 'blow' moment, at the Monarch while it stands.
  if (first && battle.monarch && alive(battle.monarch)) trigger(battle, 'blow', battle.monarch, battle.monarch, actor)
}

// A unit falls to `actor`'s blow (or a status `actor` laid). A kind that bursts on death bursts (burst). With
// Undying a soul rises at once where it fell, once a battle a copy. A fallen party unit (never the Monarch, whose fall
// ends the battle) is the 'fall' moment, and a foe slain by the party the 'kill' moment. A soul Undying lifts
// again has still fallen (decided: it was struck down, and the death shows): it bursts and the fall relics fire
// over it, but the roster does not change.
function fall (battle, target, actor, ability) {
  target.statuses = []
  emit(battle, { type: 'death', target: target.uid, actor: actor.uid })
  burst(battle, target)
  if (battle.held.rise && isSoul(battle, target) && (target.rose ?? 0) < battle.held.rises) {
    target.rose = (target.rose ?? 0) + 1
    target.hp = Math.max(1, Math.round(target.maxHp * battle.held.rise))
    battle.risen++
    // Its burst read its stats while it lay dead, and with them its side's synergies without it (synergiesOf, kept
    // until the roster moves on): both are read again.
    battle.syn[target.side] = null
    battle.cache.delete(target.uid)
    emit(battle, { type: 'rise', target: target.uid, hp: target.hp })
    trigger(battle, 'fall', target, target, actor)
    return
  }
  vacate(battle, target)
  battle.roster++
  if (target.side === 'party') battle.ours++
  if (target.side === 'foe' && unitDef(target.id).boss) crumble(battle, target)
  // Frenzy (Insect 8): one that slays a foe for a side holding it has its gauge filled.
  if (actor.side !== target.side && alive(actor) && rulesOf(battle, actor.side).has('frenzy')) {
    actor.gauge = actor.costliest
    emit(battle, { type: 'rule', rule: 'frenzy', side: actor.side, actor: actor.uid, target: target.uid })
  }
  // What felled the Monarch, for the defeat screen and the ladder: who, with what, from where, the first
  // threat its kind carries (always its own: the Sovereign and its court are what they are, whichever wave
  // brought them), and for a foe that came in a later wave, which one (`wave`: the ladder tallies depth from
  // it).
  if (target === battle.monarch) {
    battle.death = {
      by: actor.id, uid: actor.uid, ability, from: actor.tile,
      shape: ability ? abilityDef(ability).shape : null,
      threat: unitDef(actor.id).threats?.[0] ?? null,
      ...(actor.side === 'foe' && actor.wave && { wave: actor.wave })
    }
    return
  }
  if (target.side === 'party') trigger(battle, 'fall', target, target, actor)
  else if (actor.side === 'party') trigger(battle, 'kill', actor, target, target)
  // The Legion (Undead 8), last (the relics fire over the corpse before it rises): a unit slain rises at
  // once as a shadow of the side holding it against its own, past Arise's limit and its tier, never a boss,
  // a shadow or a Monarch, while that side has room for it (roomFor: the party's board cap). Its raiser is
  // the killer when it stands on that side, else no one (a status ran it down). It is not Arise's: Blood
  // Tithe takes nothing for it and Hollow Court reaps none. A crumbled court never rises (crumble is no blow).
  const side = enemySide(target.side)
  if (alive(target) || target.raised || target.shadow || unitDef(target.id).boss || !rulesOf(battle, side).has('legion') || !roomFor(battle, side)) return
  // One rising on your side needs a free tile beside the Monarch (raise); with none, the Legion raises nothing.
  if (side === 'party' && riseTile(battle, target.tile, shadowSize(target, side), target.flies) < 0) return
  emit(battle, { type: 'rule', rule: 'legion', side, actor: actor.side === side ? actor.uid : null, target: target.uid })
  raise(battle, actor.side === side ? actor : null, target, { side, rule: 'legion' })
}

// A fallen piece leaves the tile index, every tile of its footprint, in its layer.
function vacate (battle, u) {
  const layer = layerOf(battle, u)
  for (const t of footprint(u.tile, u.size)) if (layer[t] === u) layer[t] = null
}

// A death burst (DESIGN §2.4: its kind's `onFall`, { range, effects }): as a piece of the kind falls, its effects run
// from where it fell, the fallen piece their caster (as one body), on the other side's living within `range` of
// its footprint. Announced first ({ type: 'burst', actor, tile, targets }).
function burst (battle, u) {
  const on = unitDef(u.id).onFall
  if (!on) return
  const targets = around(battle, u.tile, on.range, enemySide(u.side), u.size)
  emit(battle, { type: 'burst', actor: u.uid, tile: u.tile, targets: targets.map((x) => x.uid) })
  for (const effect of on.effects) runEffect(battle, effect, u, targets)
}

// A boss's fall: its court and every other foe still standing crumble with it, each a death (`crumble:
// true`) as if slain (they pay essence), and the foes still to come never enter. The battle is won: no crumbled
// foe bursts (onFall), rises, or is a moment.
function crumble (battle, boss) {
  battle.crumbled = true
  battle.reserve = []
  for (const u of battle.units) {
    if (u.side !== 'foe' || !alive(u)) continue
    u.hp = 0
    u.statuses = []
    vacate(battle, u)
    emit(battle, { type: 'death', target: u.uid, actor: boss.uid, crumble: true })
  }
  battle.roster++
}

// The size a shadow of `corpse` rising on `side` stands at: a foe piece's 1; one of yours its kind's (a shadow
// holds no tiers).
const shadowSize = (corpse, side) => (side === 'party' ? sizeOf({ id: corpse.id }) : 1)

// Arise: the corpse rises on the actor's side as a shadow of itself, at its level with its own kit and its count,
// each body at TUNING.arise.hp of its HP (see fit) (DESIGN §2.5). One of yours rises where its footprint is
// free closest to the Monarch (riseTile; in the air, for a flying kind's), never where it fell: with none free it
// does not rise (null; its corpse may rise later), and holds there all battle, as every piece of yours does. One on
// the foes' side rises where it fell, if no one holds that tile in its layer (else null), a foe like any other, and
// walks the roads or flies. A shadow counts toward synergies and leaves when the battle ends; its corpse cannot rise
// again. The shadow keeps the uid of the corpse it rose from (`corpse`); the event says where it fell (`from`). The
// Legion raises on `side` with no actor (null) when no one of that side slew it, its event marked `rule: 'legion'`
// (`rule`). Arise's cap is counted by the caller (runEffect). Returns the shadow, or null.
function raise (battle, actor, corpse, { side = actor.side, rule = null } = {}) {
  const tile = side === 'party' ? riseTile(battle, corpse.tile, shadowSize(corpse, side), corpse.flies)
    : layerOf(battle, corpse)[corpse.tile] === null ? corpse.tile : -1
  if (tile < 0) return null
  const u = makeUnit(corpse.id, { uid: battle.nextUid++, lvl: corpse.lvl, count: corpse.count })
  corpse.raised = true
  const shadow = enterBattle(battle, { ...u, side, shadow: true, corpse: corpse.uid, tile })
  emit(battle, {
    type: 'arise', actor: actor?.uid ?? null, corpse: corpse.uid, from: corpse.tile,
    unit: { uid: shadow.uid, id: shadow.id, side: shadow.side, tile: shadow.tile, lvl: shadow.lvl, hp: shadow.hp, maxHp: shadow.maxHp, shadow: true, ...marks(shadow) },
    ...(rule && { rule })
  })
  // Blood Tithe: the Monarch pays for each shadow with its own HP (never its last: see corpses).
  if (actor === battle.monarch && battle.held.tithe) {
    const cost = titheOf(battle, actor)
    actor.hp -= cost
    emit(battle, { type: 'tithe', target: actor.uid, damage: cost, hp: actor.hp })
  }
  return shadow
}

// The Sovereign's Grave Tide: up to `count` of the field's dead rise on the actor's side as shadows, where they fell
// (raise): the fallen of either side, never a shadow, a boss, the Monarch or one risen already, lying where no one
// living stands; the strongest first, then the nearest, then the first to have stood. Arise's cap does not count
// them.
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

// A status laid on `target` by `by` (a unit, or none): a second of one held stacks (up to its def's stacks) and
// lasts the longer; `by` is who laid it last, the one its damage ticks are dealt by (runEffect 'dot').
function addStatus (battle, target, id, dur, by = null) {
  const def = statusDef(id)
  dur = dur || def.dur
  const have = target.statuses.find((s) => s.id === id)
  if (have) {
    have.dur = have.dur === 'battle' || dur === 'battle' ? 'battle' : Math.max(have.dur, dur)
    have.stacks = Math.min(def.stacks, have.stacks + 1)
    have.by = by?.uid ?? null
  } else {
    target.statuses.push({ id, dur, stacks: 1, age: 0, by: by?.uid ?? null })
  }
  emit(battle, { type: 'status', target: target.uid, status: id, dur })
}

// ── unit AI ──────────────────────────────────────────────────────────────────────────────────────

// What a condition reads (content.js `when`). For a heal of others (`mend`, the ability: mends), its allies are only
// those it can do something for (helps): a healer with no one to mend strikes instead of casting heals that land for
// 0, both sides' alike. Its lists are made when a condition first reads them (nothing changes the board while
// conditions are read).
const view = (battle, unit, mend = null) => new View(battle, unit, mend)
class View {
  constructor (battle, unit, mend) {
    this.self = unit
    this.t = battle.t
    this.battle = battle
    this.mend = mend
    this._allies = null
    this._enemies = null
  }

  get allies () {
    if (this._allies === null) {
      const allies = livingNow(this.battle, this.self.side)
      this._allies = this.mend ? allies.filter((u) => helps(this.battle, this.self, this.mend, u)) : allies
    }
    return this._allies
  }

  get enemies () { return (this._enemies ??= livingNow(this.battle, enemySide(this.self.side))) }

  // How far a unit stands from it, for a condition that reads only its area (content.js `near`).
  dist (u) { return unitDistance(u, this.self) }
}

// livingOn(battle.units, side), kept from one call to the next while it still holds: the roster is the same (no
// one has entered, and no one's fall has been counted), no one has risen (battle.risen), and everyone listed
// still has HP. Then no one has joined the living (entering or rising are the only ways), and no one has left
// them, so the list is the one livingOn would make, in the same order. Shared: read it, never change it.
function livingNow (battle, side) {
  const c = battle.living[side]
  if (c !== null && c.roster === battle.roster && c.risen === battle.risen) {
    let ok = true
    for (let i = 0; i < c.list.length && ok; i++) ok = c.list[i].hp > 0
    if (ok) return c.list
  }
  const list = livingOn(battle.units, side)
  battle.living[side] = { roster: battle.roster, risen: battle.risen, list }
  return list
}

// The first ability in def order that passes its condition and has a target in reach, or null, its candidates not
// listed (use lists them). Both tests are pure, so the cheap one comes first: whether anything is in reach (no list
// made), then its condition. The view a condition reads is only made if one asks (a heal's its own: see view).
function firstAbility (battle, unit) {
  let s = null
  for (const ability of unit.kit) {
    if (!inReach(battle, unit, ability)) continue
    if (ability.when && !ability.when(mends(ability) ? view(battle, unit, ability) : (s ??= view(battle, unit)))) continue
    return ability
  }
  return null
}

// Whether reachableOn would list anyone: Arise a corpse, a blow a foe within its reach (reachOf; a flyer only for a
// ranged one; a foe's melee blow what closeIn lets it strike), anything else a living unit of the side it aims at
// within its range.
function inReach (battle, actor, ability) {
  if (ability.shape === 'corpse') return corpses(battle, actor).length > 0
  if (ability.shape === 'self') return true
  if (!isAllyShape(ability.shape)) {
    if (actor.side === 'foe' && ability.melee) return closeIn(battle, actor).length > 0
    const r = reachOf(actor, ability)
    return foeWithin(battle, actor.tile, r, actor.side, actor.size, aloft(actor, ability, r))
  }
  const range = rangeOf(ability)
  for (const u of battle.units) if (u.side === actor.side && u.hp > 0 && unitDistance(actor, u) <= range) return true
  return false
}

// Whether an ability heals others (a heal not its caster's own: `self`).
const mends = (ability) => ability.effects.some((e) => e.op === 'heal' && !e.self)

// Whether a heal of others (`ability`: mends) cast by `actor` can do anything for its ally `u`: it reaches it (its
// range; anywhere under Sanctuary, which touches every ally), and either it can mend it, its living bodies not whole
// (a heal never lifts a fallen body: DESIGN §2.2) and it no Monarch that nothing can heal (Court of Bone), or the
// ability cleanses and `u` carries a status it would strip (Purge, Hive Mind: a debuff). A stack whose living bodies
// are whole is no one's to mend, however many of its bodies lie fallen.
function helps (battle, actor, ability, u) {
  if (unitDistance(actor, u) > rangeOf(ability) && !rulesOf(battle, actor.side).has('sanctuary')) return false
  if (u.hp < livingBodies(u) * u.body && !(u === battle.monarch && battle.held.unhealable)) return true
  return ability.effects.some((e) => e.op === 'cleanse' && u.statuses.some((x) => statusDef(x.id).tags.includes(e.tag)))
}

// The gauge the unit is saving for: its next ability (firstAbility), or with nothing in reach its cheapest.
export const nextCost = (battle, unit) => firstAbility(battle, unit)?.castCost ?? unit.cheapest

const byHpPct = (a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.uid - b.uid
const lowest = (list) => list.slice().sort(byHpPct)[0]

// Each lane's place in CENTRE_OUT: the centre first.
const LANE = CENTRE_OUT.reduce((rank, x, i) => { rank[x] = i; return rank }, [])

// Whom a blow is aimed at among `list` (DESIGN §2.3). Yours aim at the foe furthest along its road (roadLeft: the
// lowest road distance to the Monarch), ties by lane, centre first, then the nearest, then the first to act. A foe
// aims at the piece of yours in its way (inWay: on its next road tile, a flyer's on its air road) if listed (whatever
// tile of its footprint that is), else the nearest, ties by lane, then the first to act.
function pick (battle, u, list) {
  if (list.length <= 1) return list[0] ?? null
  if (u.side === 'foe') {
    const there = inWay(battle, u)
    if (there !== null && list.includes(there)) return there
  }
  const road = (x) => roadLeft(battle, x)
  let best = list[0]
  for (let i = 1; i < list.length; i++) {
    const x = list[i]
    const lane = LANE[tileX(x.tile)] - LANE[tileX(best.tile)]
    const near = unitDistance(x, u) - unitDistance(best, u)
    if ((u.side === 'party' ? (road(x) - road(best)) || lane || near : near || lane) < 0) best = x
  }
  return best
}

// How far a foe's road still runs to the Monarch, along the road it walks (roadOf: a walker's the Walk field, a
// flyer's the air road, its distance to the Monarch, no wall standing in the air).
const roadLeft = (battle, x) => roadOf(battle, x).dist[x.tile]

function pickTarget (battle, unit, ability, candidates) {
  if (isAllyShape(ability.shape)) {
    // A heal goes to the lowest of those it can do something for (helps), never to a stack whose living bodies are
    // whole or a Monarch nothing can heal (Court of Bone) while anyone else could use it.
    const mendable = mends(ability) ? candidates.filter((u) => helps(battle, unit, ability, u)) : candidates
    return lowest(mendable.length ? mendable : candidates)
  }
  if (ability.shape === 'corpse') {
    // The strongest body first, then the nearest, then the first to have stood.
    const d = (c) => unitDistance(unit, c)
    return candidates.slice().sort((a, b) => unitDef(b.id).tier - unitDef(a.id).tier || d(a) - d(b) || a.uid - b.uid)[0]
  }
  return pick(battle, unit, candidates)
}

// The target of a unit's ring: the foe its blows aim at (pick) among those it can strike within its ring of its
// footprint (a flyer only within what reaches it aloft: a ranged blow's reach, a flyer's melee too), or null with none. A
// foe's ranged blows aim so too; its melee reaches only what closeIn allows.
export const ringTarget = (battle, u) => pick(battle, u, around(battle, u.tile, u.ring, enemySide(u.side), u.size,
  Math.max(-1, ...u.kit.filter((a) => isBlow(a)).map((a) => aloft(u, a, reachOf(u, a))))))

// ── rings and roads ──────────────────────────────────────────────────────────────────────────────

// Each tick (DESIGN §2.3–§2.4):
//   - a foe takes its way (wayOf): it walks while nothing halts it, doing nothing else, struck or not: it steps when
//     its step is due (along its road, a flyer's the air road), and its gauge fills meanwhile. It halts only where it
//     can hit back, and fights there; queued behind a comrade still on the move, or stuck with nothing to strike, it
//     waits, and does nothing. Once nothing halts it any more (the piece fell, the tile cleared, the one that struck
//     it fell) it walks on;
//   - anyone else, a halted foe and every piece of yours, uses the first ability in its list whose condition holds
//     and that has a target (a blow's within its reach: reachOf; a foe's melee only what closeIn allows), or banks
//     for it; with none, it banks. A halted foe's ally abilities are among them, though they never halt it.
// Your pieces never step (u.every is Infinity): a piece of yours strikes what its blows reach in its ring, and with
// nothing there banks gauge and casts what it can on its allies. Walking is off the gauge: a foe steps once per
// TUNING.board.stepTicks ÷ its stride (u.every), whatever its speed, so an arrival time is a distance. The Monarch
// never strikes; it banks for Arise until a corpse lies in its domain.
// → { ability, targets, cost }, a foe's step { to }, or null (banking, waiting, or nothing to do).
function chooseAction (battle, u) {
  if (u.side === 'foe') {
    const way = wayOf(battle, u)
    u.walking = way >= 0 || way === QUEUE
    if (way !== HALT) return way >= 0 && battle.t >= u.nextStep ? { to: way } : null
  }
  if (u.gauge < u.cheapest) return null
  const ability = firstAbility(battle, u)
  return ability && u.gauge >= ability.castCost ? use(battle, u, ability) : null
}

// A foe's way where it stands now (DESIGN §2.4): HALT (it fights), QUEUE or STUCK (it stands and does nothing), or the
// tile it walks to, as its step comes due. Every foe walks one road, a walker the Walk field, a flyer the air road
// (roadOf), and halts only where it can hit back:
//   - in the sight of a piece of yours that can strike it (sighted: as far as the piece's blows that need no condition
//     reach, never past its ring), once one of its blows has a target there (armed: a ranged blow a piece of yours
//     within its reach, a melee one what closeIn lets it strike: the piece in its way, the Monarch beside it, a piece
//     beside it that struck it). A melee walker passing a ring with none of those beside it walks on; struck by a
//     piece beside it, it halts and strikes back;
//   - with its way held (stepOf −1: its next road tile held, holderOf: a walker's by anyone on the ground, a flyer's by
//     a piece of yours on the ground or in the air, or by a flyer of its own side; or nowhere to go), once it is armed
//     there: blocked by a piece of yours or the seat, a melee foe fights the blocker (a flyer of yours only if it flies
//     too: aloft); queued behind a comrade that has stopped (halted, or stuck itself), a ranged one shoots over it. Held,
//     no foe goes round. Queued behind a comrade still on the move (`walking`: its last turn walked it, or queued it
//     behind one on the move), it waits its turn (QUEUE): a moving queue is no halt. The flag is set each turn and read
//     as it stands, this tick's if the comrade has acted, else the last tick's: the order the two act in delays a halt
//     a tick at most, and the battle stays a function of its setup. Stuck with nothing to strike (STUCK), it stands too.
// A queue never deadlocks: a comrade holds a foe's way only in its own layer (a walker's on the ground, a flyer's in
// the air), every foe of a layer walks the one road, and each of its arrows points strictly nearer the Monarch, so no
// foes ever stand each in the next one's way in a circle.
// Ally abilities halt no one (armed reads the blows alone): a foe halted uses them, a walker or a waiter never.
const HALT = -1
const STUCK = -2
const QUEUE = -3
function wayOf (battle, u) {
  if (sighted(battle, u) && armed(battle, u)) return HALT
  const to = stepOf(battle, u)
  if (to >= 0) return to
  const by = inWay(battle, u)
  if (by?.side === u.side && by.walking) return QUEUE
  return armed(battle, u) ? HALT : STUCK
}

// Whether your sight holds foe `u` where it stands (DESIGN §2.4; watchOf): the sight of a piece of yours that can
// strike it there with a blow that needs no condition (a flyer only within a ranged reach; unit.js holdOf), or the
// Monarch's ring.
function sighted (battle, u) {
  const w = watchOf(battle)
  return (u.flies ? w.air : w.ground)[u.tile] > 0
}

// Whether a unit has a blow with a target where it stands (DESIGN §2.4: a foe halts only where it can hit back): the
// test firstAbility makes, its reach (inReach) and its condition, over its blows alone, whatever its gauge.
const armed = (battle, u) => blowWith(battle, u, (a) => inReach(battle, u, a))

// Whether one of `u`'s blows, in kit order, passes `can` with its condition holding, whatever its gauge (the view the
// condition reads made only if one asks).
function blowWith (battle, u, can) {
  let s = null
  for (const ability of u.kit) {
    if (!isBlow(ability) || !can(ability)) continue
    if (ability.when && !ability.when(s ??= view(battle, u))) continue
    return true
  }
  return false
}

// What your living units' sight holds, as sight() reckons it from each one's holdOf (the Monarch's ring among them),
// made when first read and again only once a unit of yours has entered or fallen since (battle.ours): your pieces
// never move.
function watchOf (battle) {
  const w = battle.watch
  if (w.at !== battle.ours) {
    const holders = []
    for (const u of battle.units) if (u.side === 'party' && alive(u)) holders.push({ tile: u.tile, size: u.size, ...holdOf(u) })
    Object.assign(w, sight(holders), { at: battle.ours })
  }
  return w
}

// What a side's sight holds (DESIGN §2.4), for a battle and the prep board alike: `holders` are footprints ({ tile,
// size }), each holding the tiles within `ground` of it on the ground and within `air` of it in the air (unit.js
// holdOf: as far as its blows that need no condition reach; −1: none). → { ground, air }: by tile, how many hold
// it. Pure.
export function sight (holders) {
  const ground = new Array(TILES).fill(0)
  const air = new Array(TILES).fill(0)
  for (const { tile, size = 1, ground: g, air: a } of holders) {
    for (const [list, r] of [[ground, g], [air, a]]) {
      if (!(r >= 0)) continue
      const x0 = tileX(tile)
      const y0 = tileY(tile)
      for (let y = Math.max(0, y0 - r); y <= Math.min(DEPTH - 1, y0 + size - 1 + r); y++) {
        for (let x = Math.max(0, x0 - r); x <= Math.min(LANES - 1, x0 + size - 1 + r); x++) list[y * LANES + x]++
      }
    }
  }
  return { ground, air }
}

// The stop line (DESIGN §3): the road tiles where a walker coming down the Walk field (`roads`, a field()) first comes
// into the sight of one of `holders` on the ground (sight: the battle's own, so a ring whose far blows need a
// condition draws its bar only as far as its other blows reach): the earliest it can halt in them, never that it will
// (it halts only where it can hit back, wayOf: a melee walker walks on past the bars to what blocks it; a ranged one
// queued behind a stopped comrade halts and shoots before it reaches them). A walker starts on a tile of the foes'
// rows (in the formation, or entering at the top edge) and keeps to the arrows from there to the root: on each such
// road, every held tile it comes to from a tile nothing holds, and its first tile if one is held (where it may halt
// where it stands). Only tiles a road from the foes' rows passes count: a held tile beside the roads, where no walker
// ever comes, is none of it. In tile order. Pure: the prep board draws it.
export function stopLine (roads, holders) {
  const held = sight(holders).ground
  const out = new Set()
  for (let from = tileAt(0, DEPTH - ROWS); from < TILES; from++) {
    if (roads.dist[from] === Infinity) continue
    let was = false
    for (let t = from; t >= 0; t = roads.arrow[t]) {
      if (held[t] && !was) out.add(t)
      was = held[t] > 0
    }
  }
  return [...out].sort((a, b) => a - b)
}

// An ability used: its target picked among its candidates, and a blow turned by a Bodyguard.
function use (battle, unit, ability) {
  const aimed = pickTarget(battle, unit, ability, reachableOn(battle, unit, ability))
  const guard = bodyguard(battle, unit, ability, aimed)
  return {
    ability, targets: expandOn(battle, unit, ability, guard ?? aimed), cost: ability.castCost,
    ...(guard && { guard: { uid: guard.uid, side: guard.side, for: aimed.uid } })
  }
}

// Where a foe walks now (DESIGN §2.4): to its road's next tile (arrowOf: a flyer's on the air road, over a wall too);
// −1 while anyone holds that tile in its way (holderOf: a walker's anyone on the ground, a flyer's a piece of yours on
// the ground or in the air, or a flyer of its own; a ground foe and a flyer never block each other), or with nowhere
// to go (a walker never onto a wall: in a battle with no Monarch the roads' root may be one).
function stepOf (battle, u) {
  const to = arrowOf(battle, u)
  return to >= 0 && holderOf(battle, u, to) === null && (u.flies || !battle.walls.has(to)) ? to : -1
}

// The order arrows break ties in, from `root` (DESIGN §2.4): the tile nearest the root's lane, then the one nearest
// its row (straight ahead), then the lane nearer the centre (CENTRE_OUT). Lower first.
const arrowKey = (root, n) => Math.abs(tileX(n) - tileX(root)) * 1e4 + Math.abs(tileY(n) - tileY(root)) * 100 + LANE[tileX(n)]

// The roads (DESIGN §2.4): a flood from `root` (the Monarch's tile) out through every tile no wall stands on, steps
// as unit.js steps them, giving each tile its road distance (the steps to the root; Infinity where no road reaches)
// and its arrow: the neighbouring tile with the lowest distance (−1 at the root and where no road reaches), ties in a
// fixed order (arrowKey), so two foes on one tile always walk the same way. Every arrow points strictly closer to the
// root. With no walls at all it is the air road (airOf), every tile's distance its Chebyshev distance to the root.
// Pure: the board draws it in prep as a battle walks it (fieldOf). → { root, dist, arrow }, each list by tile.
export function field ({ root, walls = [] }) {
  const closed = new Set(walls)
  closed.delete(root)
  const dist = new Array(TILES).fill(Infinity)
  const arrow = new Array(TILES).fill(-1)
  dist[root] = 0
  const queue = [root]
  for (let i = 0; i < queue.length; i++) {
    for (const n of steps(queue[i], closed)) {
      if (dist[n] === Infinity) { dist[n] = dist[queue[i]] + 1; queue.push(n) }
    }
  }
  for (const t of queue) {
    let best = -1
    for (const n of steps(t, closed)) if (dist[n] === dist[t] - 1 && (best < 0 || arrowKey(root, n) < arrowKey(root, best))) best = n
    arrow[t] = best
  }
  return { root, dist, arrow }
}

// A battle's road, the Walk field, made when first read: every walker's, its root the Monarch, which never moves. Your
// pieces are no wall to it: one standing on a walker's next tile holds it there (stepOf); no walker routes round them.
export const fieldOf = (battle) => (battle.roads.walk ??= field({ root: battle.root, walls: battle.walls }))

// A battle's air road (DESIGN §2.4 Fly), made when first read: the road flooded from the Monarch's tile over every
// tile, walls and all (field with no walls: a flyer flies over them, and may hover over one). Your pieces are no wall
// to it, as they are none to the Walk field: one standing on a flyer's next tile holds it there (stepOf); no flyer
// routes round them.
export const airOf = (battle) => (battle.roads.air ??= field({ root: battle.root, walls: [] }))

// The tile a foe's road takes it to next (roadOf): a walker's on the Walk field, a flyer's on the air road; −1 where
// none does (the root, or a tile no road reaches).
export const arrowOf = (battle, u) => roadOf(battle, u).arrow[u.tile]

// The road a foe walks: a flyer's the air road (airOf), any other's the Walk field (fieldOf).
export const roadOf = (battle, u) => (u.flies ? airOf(battle) : fieldOf(battle))

// ── relics: the Legendaries' rules and the triggers ──────────────────────────────────────────────

// The relics' rules (content.js RELIC_LIST), every copy counted, as the battle reads them: `arise`, the copies of
// Arise (0: the Monarch raises no one; each past the first grows its numbers: ariseCap, ariseTier, ariseHaste);
// `rise`, the share of max HP a fallen soul rises with (0: none), and `rises`, how many times a battle it may (a copy
// of Undying each); `alias` (a role → [role, …] map for the party's synergies, a role once a copy, or null);
// `raises`, the share Arise's cap a battle grows by; `tithe`, the share of the Monarch's max HP a shadow costs; and
// `unhealable` (Court of Bone). Their mods come with the party's (battleSetup's partyMods); the domain's size comes
// from the run (domainOf), already bent, and Hollow Court's reaping is the run's too (reapedShadows).
export function relicRules (ids = []) {
  const rs = ids.map(relicDef)
  const sum = (key) => rs.reduce((n, r) => n + (r[key] ?? 0), 0)
  const alias = {}
  for (const r of rs) for (const [from, to] of Object.entries(r.alias ?? {})) (alias[from] ??= []).push(to)
  return {
    arise: sum('arise'),
    rise: Math.max(0, ...rs.map((r) => r.rise ?? 0)),
    rises: rs.filter((r) => r.rise).length,
    alias: Object.keys(alias).length ? alias : null,
    raises: sum('raises'),
    tithe: sum('tithe'),
    unhealable: rs.some((r) => r.unhealable)
  }
}

// The relics that trigger, by the moment they fire on (TRIGGERS), in the order they were taken.
const triggersOf = (ids) => Object.fromEntries(TRIGGERS.map((on) => [on, ids.map(relicDef).filter((r) => r.on === on)]))

// A moment of the battle for the party: each relic that fires on it is announced ({ type: 'trigger', relic,
// on, unit: the subject }) and its effects run, the subject as their caster, on the targets each picks (see
// RELIC_LIST): the subject, the one on the other end, the Monarch, or either side around the place (`place`, a
// unit: around its footprint).
function trigger (battle, on, subject, place, other = null) {
  for (const relic of battle.triggers[on]) {
    emit(battle, { type: 'trigger', relic: relic.id, on, unit: subject.uid })
    for (const effect of relic.effects) runEffect(battle, effect, subject, triggered(battle, effect, subject, place, other))
  }
}

function triggered (battle, effect, subject, place, other) {
  switch (effect.to) {
    case 'self': return alive(subject) ? [subject] : []
    // The one on the other end, never the subject itself (Grave Bell must never wither the Monarch).
    case 'other': return other && other !== subject && alive(other) ? [other] : []
    case 'monarch': return battle.monarch && alive(battle.monarch) ? [battle.monarch] : []
    case 'allies': return around(battle, place.tile, effect.range, subject.side, place.size)
    case 'foes': return around(battle, place.tile, effect.range, enemySide(subject.side), place.size)
    default: throw new Error(`unknown trigger target "${effect.to}"`)
  }
}

// A soul: a party unit that is neither the Monarch nor a shadow.
const isSoul = (battle, u) => u.side === 'party' && u !== battle.monarch && !u.shadow

// Blood Tithe: what a shadow costs the Monarch.
const titheOf = (battle, m) => Math.ceil(m.maxHp * battle.held.tithe)

// ── formulas ─────────────────────────────────────────────────────────────────────────────────────

const clamp = (lo, hi, v) => Math.min(hi, Math.max(lo, v))

export function hitChance (acc, eva) {
  const denom = acc + eva
  return clamp(TUNING.hit.min, TUNING.hit.max, denom <= 0 ? 0.5 : acc / denom)
}

export function critChance (crt) {
  const t = TUNING.crit
  return clamp(t.min, t.max, crt / t.divisor)
}

function rollVariance (rng) {
  const [lo, hi] = TUNING.variance
  return rng.range(lo, hi)
}

// p: { power, atk, def, isCrit, variance, mul }
export function computeDamage (p) {
  const t = TUNING.damage
  const raw = p.power * (p.atk / t.atkDivisor)
  const mitigated = raw * (t.defConstant / (t.defConstant + Math.max(0, p.def)))
  const crit = p.isCrit ? TUNING.crit.mult : 1
  const total = mitigated * crit * (p.variance ?? 1) * (p.mul ?? 1)
  return Math.max(t.min, Math.round(total))
}
