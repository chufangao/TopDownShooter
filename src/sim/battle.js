// Everything inside a fight: the tick loop, effects and statuses, rings, lines and roads, and the combat
// formulas. Real-time in 50 ms ticks, and no input once it starts: the same setup always plays out the
// same. Pure: all randomness comes from battle.rng.
import { TUNING } from '../tuning.js'
import { unitDef, statusDef, abilityDef, keystoneDef, relicDef, TRIGGERS } from '../content.js'
import { createRng, hashString } from './rng.js'
import {
  alive, livingOn, statsOf, activeSynergies, expand, enemySide, isAllyShape, deployTile, distance, steps, NEIGHBOURS, rangeOf, TILES,
  tileX, tileY, tileAt, abilitiesOf, auraOf, cheapestOf, costliestOf, makeUnit, slotAt, ROWS, CENTRE_OUT, LANES, DEPTH, bodiesOf,
  livingBodies, ringOf, strideOf, behaviourOf, bannerOf
} from './unit.js'

// ── battle loop ──────────────────────────────────────────────────────────────────────────────────

// party/foes are run pieces { uid, id, lvl, tracks, count, hp, maxHp, slot }; the battle works on copies, and
// only pieces on the field (slot ≥ 0) with HP left take part. Each starts on its slot's board tile (the
// party's in its camp, past `walls`, a list of board tiles). A battle still going at `ceiling` ticks ends
// undecided (the autoplayer rehearses on a shorter budget than the real fight's); the ticks count from the
// last foe to enter (see checkEnd).
//
// The Monarch (a party unit whose def is `monarch`) stands in the party's camp and never steps: the roads run
// to it (fieldOf). Its domain reaches `domain` tiles from it; `will` is its Will (Arise raises corpses of tier up
// to raiseTier + will, raises × (1 + will) a battle, and its gauge fills willHaste × will faster). Units created
// mid-battle (shadows) take uids from `nextUid` on (by default, past every uid here, the reserve's
// included); battle.nextUid is the first one still free when the battle ends. A battle with no Monarch (a test,
// a sample) has no domain, its roads run to the camp's rear middle tile, and it ends on a wipe.
//
// Lines (DESIGN §2.4): a party unit with a `line` ({ tiles, when }) walks its tiles in order, one a step, once the
// signal it waits for (`when`: see fired) has come, and holds at the last; one with none holds where it stands.
// Banners (DESIGN §2.8): a piece of yours with Banner (a tier IV) and a line leads a wing: each piece of yours
// standing beside it as the battle begins (the first Banner's, in acting order, if beside two) is its follower,
// and walks its line shifted by where it stands from it (`offset`), never a step ahead of it while it stands; a
// follower's own line is set aside. A shadow of yours that rises on a tile of a Banner's line joins the wing
// (`leader` the Banner's uid, no offset): it walks the rest of that line from where it rose, on the Banner's
// signal, ahead of the Banner or behind it, a marcher like any other (see raise, join).
//
// Stacks (DESIGN §2.2): a unit is a piece, `count` bodies of one kind on one tile, its HP one pool of count ×
// `body` (one body's HP, fitted as it takes its place: see fit). Its living bodies are ⌈hp ÷ body⌉ (unit.js
// livingBodies): they fall one at a time, the pool's blows and heals scale with them, and a heal never lifts a
// fallen body. Every hit lands on the pool once, a Shape's too: the piece is one target on one tile. A soul whose
// tiers add bodies (unit.js bodiesOf) fights with them in its pool, whole, for the battle alone; the `bodies`
// switch (ablate) adds none.
//
// The foes: `reserve` lists the foes still to come, in the order they enter, one a tick, each at the top edge in
// its `lane` when its `when` fires. A foe's `wave` is the wave it comes in: 0 (or none) for the foes on the board
// from the start, 1 for the next, and so on; a wave's foes wait for it with `{ at: 'break', wave, t }`: the wave
// before is down to TUNING.spawn.waves.share of its foes, or `t` ticks have passed since it began to enter. Every
// foe walks the roads (DESIGN §2.6). A boss's fall ends the battle: every foe still standing crumbles (see
// crumble), and its Grave Tide raises the dead on its side.
//
// `keystones` and `relics` are the run's (ids): the keystones' rules bend the party's side of the battle (see
// keystoneRules), and the relics that trigger (`on`) fire for the party (see trigger).
//
// `ablate` (a measuring switch, never a player's: the autoplayer's ablation reports, autoplay.js ABLATIONS) lists
// rules taken away from the party's side: 'arise' (the Monarch's Arise never casts), 'synergies' (the party
// holds no synergy, at any step, its 8-step rules too) and 'bodies' (no tier adds a body). Empty in
// every real run.
//
// `quiet` (a rehearsal's, autoplay.js): the battle keeps no events (battle.events stays empty). It plays out
// exactly as it would otherwise: nothing in a battle reads its own events.
//
// `settle` (a rehearsal's only, never a real fight's: TUNING.autoplay.settle) lets playOut end the battle once its
// result is settled (see settled), with the units as they stand then: reason 'settled'.
export function createBattle ({
  party, foes, seed, floor = 1, boss = false, partyMods = [], foeMods = [], walls = [], ceiling = TUNING.tick.ceiling,
  domain = TUNING.monarch.domain, will = 0, nextUid = null, reserve = [],
  keystones = [], relics = [], foeRules = true, ablate = [], quiet = false, settle = null
}) {
  // A living soul's piece takes the bodies its tiers add, whole (not the Monarch's; none with the `bodies` switch).
  const added = (u) => (u.hp > 0 && !unitDef(u.id).monarch && !ablate.includes('bodies') ? bodiesOf(u) : 0)
  const grown = (u, k) => (k ? { count: u.count + k, hp: u.hp + k * u.maxHp / u.count, maxHp: u.maxHp + k * u.maxHp / u.count } : {})
  const stamp = (u, side) => fresh({ ...u, side, tile: deployTile(side, u.slot), ...(side === 'party' && grown(u, added(u))) }, 0)
  const units = [...party.map((u) => stamp(u, 'party')), ...foes.map((u) => stamp(u, 'foe'))]
    .filter((u) => u.hp > 0 && u.slot >= 0)
    .sort((a, b) => (a.side < b.side ? -1 : a.side > b.side ? 1 : a.slot - b.slot))
  const ks = keystoneRules(keystones)
  const monarch = units.find((u) => u.side === 'party' && unitDef(u.id).monarch) ?? null

  const battle = {
    t: 0, seed, floor, boss, ceiling, over: false, winner: null, reason: null, foeRules, ablate: new Set(ablate), quiet,
    // monarch: its battle unit, or null; death: what felled it ({ by, uid, ability, from, shape, threat });
    // raised: how many shadows Arise has raised.
    monarch, death: null,
    domain, will, raised: 0, nextUid: nextUid ?? Math.max(0, ...units.map((u) => u.uid), ...reserve.map((u) => u.uid)) + 1,
    // reserve: the foes still to enter, in order; byUid: every unit that has taken its place, by uid.
    reserve: reserve.map((u) => ({ ...u })), byUid: new Map(),
    // waveAt: the tick each foe wave began to enter (wave 0 stands from the start); crumbled: a boss fell and
    // its side crumbled with it. foeIn: the tick the last foe entered (0: none has; the escalation clock and the
    // ceiling count from it).
    waveAt: [0], crumbled: false, foeIn: 0,
    // signals: the moments a line can wait for, each given once and for good (DESIGN §2.5): the first blow,
    // either side; a blow on the Monarch; a piece of yours fallen. (Time and Wave read the clock and waveAt.)
    signals: { blow: false, struck: false, falls: false },
    units: [], events: [], walls: new Set(walls),
    // root: the tile the roads run to (the Monarch's; with none, the camp's rear middle). roads: the Walk field
    // and the Flank field, each made when first read (fieldOf), the Flank field again whenever `ours` (bumped as
    // a unit of yours enters or falls) has moved on from `at`. adj: each tile's steps past the walls.
    root: monarch?.tile ?? tileAt(CENTRE_OUT[0], 0), roads: { walk: null, flank: null, at: -1 }, ours: 0, adj: null,
    partyMods, foeMods,
    rng: createRng(seed).stream('battle'),
    // at: the living unit on each tile, or null. roster: bumped whenever a unit dies or enters, so
    // caches of who is on the board key on it. auraReach: the widest aura on the board, how far to
    // look for givers.
    // auras, phased: the units with an aura, and with HP phases, in acting order.
    at: new Array(TILES).fill(null), roster: 0, auraReach: 0, auras: [], phased: [],
    // risen: bumped when a fallen unit rises where it fell (Undying), the one way back to life with no change of
    // roster; living: the living on each side as last listed (livingNow).
    risen: 0, living: { party: null, foe: null },
    // harm: the damage each side has taken so far (every blow that landed, shadows' too), for a rehearsal's
    // settle check (settled).
    harm: { party: 0, foe: 0 },
    // settle, probes: the settle rule and its look back (every HP and the party's harm, every `every` ticks).
    settle, probes: settle ? [] : null,
    syn: {}, cache: new Map(),
    // ks: the keystones' rules (keystoneRules); triggers: the relics that fire, by moment.
    ks, triggers: triggersOf(relics)
  }
  for (const u of units) occupy(battle, u)
  for (const u of units) fit(battle, u)
  // The Banners' wings form.
  for (const lead of battle.units) {
    if (!lead.banner || lead.line === null || lead.leader !== null) continue
    for (const u of battle.units) if (u.side === 'party' && u !== lead && u !== battle.monarch && !u.banner && u.leader === null && distance(u.tile, lead.tile) === 1) follow(u, lead)
  }
  // Ambush (Skirmisher 8): a side holding it starts with every gauge full.
  for (const u of units) if (rulesOf(battle, u.side).has('ambush')) u.gauge = u.costliest

  emit(battle, {
    type: 'battle:start',
    walls: [...battle.walls],
    units: battle.units.map((u) => ({
      uid: u.uid, id: u.id, side: u.side, slot: u.slot, tile: u.tile, lvl: u.lvl, hp: u.hp, maxHp: u.maxHp, ...marks(u), ...(u.line && { line: u.line })
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
// Banner's follower and whose (`leader`), and a foe's wave (k ≥ 1: it came after the first formation).
const marks = (u) => ({ count: u.count ?? 1, ...(u.leader != null && { leader: u.leader }), ...(u.wave && { wave: u.wave }) })

// The per-battle fields a unit fights with: an empty gauge, a step due at once (`nextStep`), no statuses, the
// next tile of its line to walk (`leg`), the tile it lunged from (`home`, null while it has not), and the Banner
// it follows with where it stands from it (`leader`, `offset`: null while it follows none).
// Every battle unit is made with the same fields in the same order (UNIT_FIELDS; one it was not given, or that
// the battle sets later, is there as undefined, which reads as its absence does), so all of them share one
// shape and the tick loop's reads of them stay fast. A field outside the list is copied on after them.
const UNIT_FIELDS = new Set([
  'uid', 'id', 'lvl', 'tracks', 'count', 'hp', 'maxHp', 'slot', 'side', 'tile', 'line',
  'when', 'wave', 'lane', 'shadow', 'corpse', 'arisen', 'raised', 'foiled', 'rose', 'stood',
  'gauge', 'nextStep', 'statuses', 'phase', 'leg', 'home', 'leader', 'offset', 'ord', 'kit', 'aura', 'cheapest', 'costliest', 'ring', 'every',
  'behaviour', 'lunges', 'banner', 'body'
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
    line: u.line ?? null,
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
    leg: 0,
    home: null,
    leader: null,
    offset: null,
    // set as it takes its place (occupy)
    ord: undefined,
    kit: undefined,
    aura: undefined,
    cheapest: undefined,
    costliest: undefined,
    ring: undefined,
    every: undefined,
    behaviour: undefined,
    lunges: undefined,
    banner: undefined,
    // set as it is fitted (fit)
    body: undefined
  }
  for (const k in u) if (!UNIT_FIELDS.has(k)) out[k] = u[k]
  return out
}

// A unit takes its place in the battle: on the board's index, in the order it acts (after everyone
// already there), with what its kit makes fixed for the battle: its abilities in priority order, its aura,
// its cheapest and costliest ability, its ring, how often it may step (`every` ticks: never, for the Monarch),
// how it walks the roads as a foe, whether it lunges (one of yours, not a shadow, whose every blow is a melee one: see
// lunge; a shadow holds its tile, DESIGN §2.7),
// and whether it leads a wing (Banner). Everything that enters mid-battle comes through here too (enterBattle).
function occupy (battle, u) {
  if (!alive(u)) throw new Error(`${u.id} has no HP to fight with`)
  if (!Number.isInteger(u.tile) || u.tile < 0 || u.tile >= TILES || battle.walls.has(u.tile)) {
    throw new Error(`tile ${u.tile} cannot be stood on`)
  }
  if (battle.at[u.tile]) throw new Error(`tile ${u.tile} is taken`)
  u.ord = battle.units.length
  u.kit = abilitiesOf(u).map(abilityDef)
  u.aura = auraOf(u)
  u.cheapest = cheapestOf(u)
  u.costliest = costliestOf(u)
  u.ring = ringOf(u)
  u.every = unitDef(u.id).monarch ? Infinity : Math.max(1, Math.round(TUNING.board.stepTicks / strideOf(u)))
  if (u.every === Infinity) u.nextStep = Infinity
  u.behaviour = behaviourOf(u)
  const blows = u.kit.filter((a) => !isAllyShape(a.shape) && a.shape !== 'corpse')
  u.lunges = u.side === 'party' && !u.shadow && blows.length > 0 && blows.every((a) => a.melee)
  u.banner = u.side === 'party' && bannerOf(u)
  battle.units.push(u)
  battle.byUid.set(u.uid, u)
  battle.at[u.tile] = u
  battle.auraReach = Math.max(battle.auraReach, u.aura?.range ?? 0)
  if (u.aura) battle.auras.push(u)
  if (phasesOf(u.id)) battle.phased.push(u)
}

// One body's HP includes the unit's HP mods (synergies, relics, track tiers), and a shadow's bodies rise at
// TUNING.monarch.raiseHp of it; max HP is count × body, and current HP keeps its fraction. Read once, as it takes
// its place: HP mods that come and go mid-battle do not stretch the bar. The Monarch's max HP is its points' and
// nothing else's (see modsFor): the one the camp shows.
function fit (battle, u) {
  if (u === battle.monarch) {
    u.body = u.maxHp
    return
  }
  u.body = Math.max(1, Math.round(stats(battle, u).hp * (u.shadow ? TUNING.monarch.raiseHp : 1)))
  const max = u.count * u.body
  if (max === u.maxHp) return
  u.hp = Math.max(1, Math.round(u.hp * max / u.maxHp))
  u.maxHp = max
}

// A unit joins a battle under way (a shadow, a foe from the reserve): `u` is a living run unit with its
// `side` and an open `tile` on the board; it gets the per-battle fields and its max HP fitted to its mods, as a
// unit there from the start does, acts after everyone already there (this very tick, if it enters before the
// turns are done), and may step at once. The caller emits the event that announces it. The roster changes, so
// every cache of who is on the board refreshes (one of yours entering is the Flank field's too). Returns the
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
  reinforce(battle)
  for (const u of battle.units) {
    if (!alive(u)) continue
    const s = stats(battle, u)
    // Gauge banks up to the costliest thing the unit can do, and no further: a unit kept waiting does not
    // come out of it with a string of casts.
    u.gauge = Math.min(u.costliest, u.gauge + Math.max(0, (TUNING.gauge.base + s.spd / TUNING.gauge.spdDivisor) * s.gauge.rate))
    act(battle, u)
    // The battle is lost the instant the Monarch falls: no one acts after it.
    if (battle.monarch && !alive(battle.monarch)) break
  }
  checkEnd(battle)
  battle.t++
}

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
//   lost  the Monarch stands alone: no other unit of its side standing, and Arise spent (or taken away): the
//         battle can only end in its fall or at the ceiling, both losses.
// k is the margin. The battle ends there, scored by the units as they stand (rehearse's scoreOf): a win keeps a
// little more HP than it would by the end (or less, if healers would mend it after the last foe falls). Measured
// on 27,905 rehearsal battles (Speed 2 in the necessity report): at k 4, 29 verdicts (about 1 battle in 960) differ
// from the full battle's, 23 of them a stalemate that runs to the ceiling, 6 a late fall of the Monarch.
function settled (battle) {
  const { k, window, recent, every } = battle.settle
  const probes = battle.probes
  probes.push({ hp: battle.units.map((u) => u.hp), harm: battle.harm.party })
  if (probes.length > window / every + 1) probes.shift()
  const m = battle.monarch
  if (!m || probes.length <= window / every) return
  if (!battle.units.some((u) => u.side === 'party' && alive(u) && u !== m) &&
    (battle.ablate.has('arise') || battle.raised >= ariseCap(battle.will, battle.ks.raises))) return settle(battle, 'foe')
  if (battle.reserve.length) return
  const then = probes[0]
  const lately = probes[probes.length - 1 - recent / every]
  let now = 0
  let was = 0
  for (let i = 0; i < battle.units.length; i++) {
    const u = battle.units[i]
    if (u.side !== 'foe') continue
    if (i < then.hp.length) was += then.hp[i]
    if (!alive(u)) continue
    if (!(i < lately.hp.length && lately.hp[i] > u.hp)) return
    now += u.hp
  }
  const rate = (was - now) / window
  if (!(rate > 0)) return
  const T = now / rate
  const dealt = (battle.harm.party - then.harm) / window
  if (battle.t + k * T < battle.foeIn + battle.ceiling && m.hp > k * dealt * T) settle(battle, 'party')
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
  if (chosen.to !== undefined) return step(battle, u, chosen)
  const { ability, targets, cost, guard } = chosen
  u.gauge -= cost
  if (guard) emit(battle, { type: 'rule', rule: 'bodyguard', side: guard.side, actor: guard.uid, target: guard.for })
  emit(battle, { type: 'action', actor: u.uid, ability: ability.id, anim: ability.anim, targets: targets.map((x) => x.uid) })
  for (const effect of ability.effects) runEffect(battle, effect, u, targets, ability)
  // Echo (Channeler 8): the ability rings out once more, free, on the same targets (those still standing);
  // Arise never echoes.
  if (alive(u) && !ability.effects.some((e) => e.op === 'raise') && rulesOf(battle, u.side).has('echo')) {
    emit(battle, { type: 'rule', rule: 'echo', side: u.side, actor: u.uid, ability: ability.id })
    for (const effect of ability.effects) runEffect(battle, effect, u, targets, ability)
  }
}

// A step, free (off the gauge; the next is due `every` ticks on). A step along its line moves a unit on to the
// line's next tile; a lunge remembers the tile it left (u.home), and a step back onto that tile ends the lunge.
function step (battle, u, { to, kind }) {
  emit(battle, { type: 'move', actor: u.uid, from: u.tile, to })
  // One of yours setting out on its line: the 'march' moment, once it stands on the line's first tile.
  const sets = kind === 'line' && u.leg === 0
  if (kind === 'line') u.leg++
  else if (kind === 'lunge') u.home ??= u.tile
  else if (kind === 'back' && to === u.home) u.home = null
  battle.at[u.tile] = null
  battle.at[to] = u
  u.tile = to
  u.nextStep = battle.t + u.every
  if (sets) trigger(battle, 'march', u, to)
}
function tickStatuses (battle) {
  for (const u of battle.units) {
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
        for (const effect of def.tick) runEffect(battle, effect, u, [u])
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

// ── signals and the reserve ──────────────────────────────────────────────────────────────────────

// The party's pieces on the board: everyone living but the Monarch (shadows too), each once whatever its count.
const pieces = (battle) => battle.units.reduce((n, u) => n + (u.side === 'party' && alive(u) && u !== battle.monarch ? 1 : 0), 0)
// Whether a shadow may rise on `side`: for the party, only while it has fewer than TUNING.army.board pieces on
// the board. Unbounded, the Legion's shadows (one for every foe slain) would pack the board in a long fight of
// waves until a later wave found no tile to enter on, and a battle already won would stall to the ceiling. A foe
// side needs no bound: its shadows only ever rise from your dead.
const roomFor = (battle, side) => side !== 'party' || pieces(battle) < TUNING.army.board

// Whether a signal has come (DESIGN §2.5): a line's `when`, or a foe's still to come. None, or 'once': at once;
// 'time': once the clock reaches `t`; 'wave': once wave `wave` has begun to enter; 'blow', 'struck', 'falls': once
// the first blow has landed (either side), a blow has landed on the Monarch, a piece of yours has fallen; and a
// foe wave's 'break': once the wave before its own has broken. A signal stays given.
const fired = (battle, when) => !when || when.at === 'once' ||
  (when.at === 'time' ? battle.t >= when.t : when.at === 'wave' ? battle.waveAt[when.wave] !== undefined
    : when.at === 'break' ? broken(battle, when) : !!battle.signals[when.at])

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
// escalation); the first foe of a wave announces it ({ type: 'wave', wave }) and gives its Wave signal.
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

function enter (battle, body) {
  const tile = entryTile(battle, body.lane)
  if (tile < 0) return
  battle.reserve.splice(battle.reserve.indexOf(body), 1)
  if (body.wave && battle.waveAt[body.wave] === undefined) {
    battle.waveAt[body.wave] = battle.t
    emit(battle, { type: 'wave', wave: body.wave })
  }
  const unit = enterBattle(battle, { ...body, side: 'foe', tile })
  battle.foeIn = battle.t
  emit(battle, {
    type: 'enter',
    unit: { uid: unit.uid, id: unit.id, side: unit.side, tile: unit.tile, lvl: unit.lvl, hp: unit.hp, maxHp: unit.maxHp, ...marks(unit) }
  })
}

// Where a foe enters: the open tile nearest the top edge in its `lane` (the middle one by default), ties going to
// tiles ahead of it (down the board), then level with it, then the nearest lane, then the lower tile; −1 if the
// board is full.
function entryTile (battle, lane = CENTRE_OUT[0]) {
  const from = deployTile('foe', slotAt(ROWS - 1, lane))
  let best = -1
  let bestK = Infinity
  for (let t = 0; t < TILES; t++) {
    if (battle.at[t] !== null || battle.walls.has(t)) continue
    const dy = tileY(from) - tileY(t)
    const k = distance(t, from) * 1e4 + (dy > 0 ? 0 : dy === 0 ? 1 : 2) * 1e3 + Math.abs(tileX(t) - tileX(from)) * 100 + t / TILES
    if (k < bestK) { best = t; bestK = k }
  }
  return best
}

// ── the tile index ───────────────────────────────────────────────────────────────────────────────

// The questions unit.js answers from a list of units, answered from battle.at: the same results, at the
// cost of a few tiles instead of every unit on the board. Lists come back in the order the units act
// (u.ord), as a filter over battle.units would give them, so effects and rolls happen in the same order.

// The living units on `side` within `r` tiles of `tile`, in acting order.
// (The window clipped to the board, and each unit inserted in acting order as it is found: the same list as
// filtering every tile in reach and sorting it, with no sort to call.)
function around (battle, tile, r, side) {
  const out = []
  const x0 = tileX(tile)
  const y0 = tileY(tile)
  const xa = Math.max(0, x0 - r)
  const xb = Math.min(LANES - 1, x0 + r)
  const yb = Math.min(DEPTH - 1, y0 + r)
  const at = battle.at
  for (let y = Math.max(0, y0 - r); y <= yb; y++) {
    for (let x = xa, t = y * LANES + xa; x <= xb; x++, t++) {
      const u = at[t]
      if (u === null || u.side !== side) continue
      let i = out.length
      while (i > 0 && out[i - 1].ord > u.ord) { out[i] = out[i - 1]; i-- }
      out[i] = u
    }
  }
  return out
}

// Whether a living unit of the other side from `side` stands within `r` tiles of `tile`.
function foeWithin (battle, tile, r, side) {
  const x0 = tileX(tile)
  const y0 = tileY(tile)
  const xa = Math.max(0, x0 - r)
  const xb = Math.min(LANES - 1, x0 + r)
  const yb = Math.min(DEPTH - 1, y0 + r)
  for (let y = Math.max(0, y0 - r); y <= yb; y++) {
    for (let x = xa, t = y * LANES + xa; x <= xb; x++, t++) {
      const u = battle.at[t]
      if (u !== null && u.side !== side) return true
    }
  }
  return false
}

// The living foes next to a unit.
export const foesNextTo = (battle, u) => around(battle, u.tile, 1, enemySide(u.side))
// Whether one stands there: the position its `pos` mods read ('engaged' with one, 'free' without).
function pressed (battle, u) {
  const next = NEIGHBOURS[u.tile]
  for (let i = 0; i < next.length; i++) {
    const x = battle.at[next[i]]
    if (x !== null && x.side !== u.side) return true
  }
  return false
}

// The living allies whose aura reaches this unit.
export const auraGivers = (battle, u) => battle.auraReach
  ? around(battle, u.tile, battle.auraReach, u.side).filter((a) => a !== u && a.aura && distance(a.tile, u.tile) <= a.aura.range)
  : []

// How far a unit's ability reaches a foe: its range (a melee one's the 8 tiles around), never past its ring.
const reachOf = (u, ability) => Math.min(rangeOf(ability), u.ring)

// Candidate primary targets for an ability: Arise's corpses; an ally ability's allies within its range (all of
// them, with none); a blow's foes within its reach (reachOf).
function reachableOn (battle, actor, ability) {
  if (ability.shape === 'corpse') return corpses(battle, actor)
  if (ability.shape === 'self' || isAllyShape(ability.shape)) return reachableIn(battle, actor, ability)
  return around(battle, actor.tile, reachOf(actor, ability), enemySide(actor.side))
}

// unit.js's reachable over battle.units, in one pass: the units on the side it aims at, living, within its range.
function reachableIn (battle, actor, ability) {
  if (ability.shape === 'self') return [actor]
  const side = isAllyShape(ability.shape) ? actor.side : enemySide(actor.side)
  const range = rangeOf(ability)
  const out = []
  for (const u of battle.units) if (u.side === side && u.hp > 0 && distance(actor.tile, u.tile) <= range) out.push(u)
  return out
}

// What Arise may raise: the other side's fallen, not raised yet, never a boss, of tier up to raiseTier + Will,
// lying within the domain (DESIGN §2.7: `domain` tiles of the Monarch) on a tile no one living stands on; and
// only while the battle's raises last. A shadow is never a corpse to raise: it fights on the actor's side.
// Blood Tithe doubles the raises (battle.ks.raises), and the Monarch never pays a tithe that would fell it.
// Arise's cap a battle (TUNING.monarch.raises a Will step, from Will 0) and the highest tier it raises.
export const ariseCap = (will, raises = 1) => TUNING.monarch.raises * (1 + will) * raises
export const ariseTier = (will) => TUNING.monarch.raiseTier + will

function corpses (battle, actor) {
  if (actor === battle.monarch && battle.ablate.has('arise')) return []
  // Arise is bounded by its own cap, not the board's: its shadows rise past it (they take no place a body needs).
  if (battle.raised >= ariseCap(battle.will, battle.ks.raises) || (actor !== battle.monarch && !roomFor(battle, actor.side))) return []
  if (actor === battle.monarch && battle.ks.tithe && actor.hp <= titheOf(battle, actor)) return []
  // A shadow of yours rises beside the Monarch, whoever stands on its corpse; with no free tile for it, none rises.
  const mine = actor.side === 'party'
  if (mine && riseTile(battle, actor.tile) < 0) return []
  return battle.units.filter((c) => c.side !== actor.side && !alive(c) && !c.raised && !c.shadow &&
    !unitDef(c.id).boss && unitDef(c.id).tier <= ariseTier(battle.will) && (mine || battle.at[c.tile] === null) &&
    distance(c.tile, actor.tile) <= battle.domain)
}

// Where a shadow of yours rises (DESIGN §2.7): never where it fell, so the enemy's dead never block its roads, but
// on the free tile (open ground no one stands on) closest to the Monarch (with none, to the tile the roads run to);
// ties to the tile nearest `from`, where it fell, then lane order (CENTRE_OUT), then the lower tile. −1 when no tile
// on the board is free.
function riseTile (battle, from) {
  const to = battle.monarch?.tile ?? battle.root
  let best = -1
  let bestK = null
  for (let t = 0; t < TILES; t++) {
    if (battle.at[t] !== null || battle.walls.has(t)) continue
    // Scanned in tile order, so a tie on all three keeps the lower tile.
    const k = [distance(t, to), distance(t, from), LANE[tileX(t)]]
    if (bestK === null || (k[0] - bestK[0] || k[1] - bestK[1] || k[2] - bestK[2]) < 0) {
      best = t
      bestK = k
    }
  }
  return best
}

// The units an ability hits, as unit.js's expand: a blast is its primary and its side's units around it.
// Dragonfire (Drake 8) bursts a single-target attack like a blast; Sanctuary (Warden 8) carries an ally
// ability to every ally on the board.
function expandOn (battle, actor, ability, primary) {
  const burst = ability.shape === 'single' && primary.side !== actor.side && rulesOf(battle, actor.side).has('dragonfire')
  if (ability.shape === 'blast' || burst) return around(battle, primary.tile, 1, primary.side)
  const allies = ability.shape === 'ally' || ability.shape === 'all_allies'
  if (allies && rulesOf(battle, actor.side).has('sanctuary')) return livingOn(battle.units, actor.side)
  return expand(battle.units, actor, ability, primary)
}

// Bodyguard (Vanguard 8): a single-target blow from the other side at a unit of a side holding it, not itself
// a Vanguard, falls instead on a Vanguard of its side standing next to it (the one with the most HP, then
// the first to act); null if none stands there.
function bodyguard (battle, actor, ability, primary) {
  const vanguard = (u) => unitDef(u.id).role === 'vanguard'
  if (ability.shape !== 'single' || primary.side === actor.side || !rulesOf(battle, primary.side).has('bodyguard') || vanguard(primary)) return null
  return around(battle, primary.tile, 1, primary.side).filter(vanguard).sort((a, b) => b.hp - a.hp || a.ord - b.ord)[0] ?? null
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
  const list = side === 'party' && battle.ablate.has('synergies') ? [] : activeSynergies(livingOn(battle.units, side), side === 'party' ? battle.ks.alias : null)
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

// What bends a unit's stats now. The Monarch takes no synergy's, relic's or keystone's mods: its stats are
// its points' (reDESIGN: guarding it is a formation problem, never a stat purchase; there is no Might). What
// stands around it still counts (a status on it, an aura it stands in).
function modsFor (battle, unit) {
  const mods = []
  const own = unit !== battle.monarch
  for (const s of unit.statuses) {
    for (const m of statusDef(s.id).mods ?? []) for (let n = 0; n < s.stacks; n++) mods.push(m)
  }
  if (own) for (const syn of synergiesOf(battle, unit.side)) mods.push(...syn.mods)
  if (unit.side === 'party' && own) mods.push(...battle.ks.mods)
  for (const giver of auraGivers(battle, unit)) mods.push(...giver.aura.mods)
  if (own) mods.push(...(unit.side === 'party' ? battle.partyMods : battle.foeMods))
  // Will hastens the Monarch's gauge: Arise comes sooner (TUNING.monarch.willHaste a point).
  if (unit === battle.monarch && battle.will && TUNING.monarch.willHaste) mods.push({ path: 'gauge.rate', op: 'mul', v: 1 + TUNING.monarch.willHaste * battle.will })
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
    if (a === u || a.side !== u.side || battle.at[a.tile] !== a || distance(a.tile, u.tile) > a.aura.range) continue
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

function runEffect (battle, effect, actor, targets, ability = null) {
  // A `self` heal mends the actor once, whoever it struck and whether they still stand.
  if (effect.self) return alive(actor) && heal(battle, actor, actor, effect.power)
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
      // A stack strikes with every living body (DESIGN §2.2).
      const mul = a.damage.dealt * d.damage.taken * escalation(battle) * livingBodies(actor)
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
      if (effect.chance === undefined || battle.rng.chance(effect.chance)) addStatus(battle, target, effect.status, effect.dur)
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
  if (target === battle.monarch && battle.ks.unhealable) return
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

// A blow lands: the Blow signal (the first one the 'blow' moment), and a blow the Monarch stands the 'struck' moment. Last Stand (see stands, a
// Deathblow included) turns the first blow that would fell its target: the target is left at 1 HP. Last Stand
// comes first and Undying after it: a unit that stood falls to a later blow, and may rise then.
function applyDamage (battle, target, amount, { actor, isCrit, ability }) {
  const stand = amount >= target.hp && stands(battle, target)
  if (stand) {
    target.stood = true
    amount = target.hp - 1
  }
  target.hp = Math.max(0, target.hp - amount)
  battle.harm[target.side] += amount
  const first = !battle.signals.blow
  battle.signals.blow = true
  emit(battle, { type: 'damage', actor: actor.uid, target: target.uid, damage: amount, isCrit, ability, hp: target.hp })
  if (stand) emit(battle, { type: 'rule', rule: 'last_stand', side: target.side, target: target.uid })
  if (target === battle.monarch) battle.signals.struck = true
  if (!alive(target)) fall(battle, target, actor, ability)
  if (target === battle.monarch && alive(target)) trigger(battle, 'struck', target, target.tile, actor)
  // The battle's first blow: the 'blow' moment, at the Monarch while it stands.
  if (first && battle.monarch && alive(battle.monarch)) trigger(battle, 'blow', battle.monarch, battle.monarch.tile, actor)
}

// A unit falls to `actor`'s blow. With Undying a soul rises at once where it fell, once a battle. A fallen party
// unit (never the Monarch, whose fall ends the battle) is the Fallen signal and the 'fall' moment, and a foe
// slain by the party the 'kill' moment. A soul Undying lifts again has still fallen (decided: it was struck down,
// and the death shows): the Fallen signal comes and the fall relics fire over it, but the roster does not change.
function fall (battle, target, actor, ability) {
  target.statuses = []
  emit(battle, { type: 'death', target: target.uid, actor: actor.uid })
  if (target.side === 'party' && target !== battle.monarch) battle.signals.falls = true
  if (battle.ks.rise && isSoul(battle, target) && !target.rose) {
    target.rose = true
    target.hp = Math.max(1, Math.round(target.maxHp * battle.ks.rise))
    battle.risen++
    emit(battle, { type: 'rise', target: target.uid, hp: target.hp })
    trigger(battle, 'fall', target, target.tile, actor)
    return
  }
  battle.at[target.tile] = null
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
  if (target.side === 'party') trigger(battle, 'fall', target, target.tile, actor)
  else if (actor.side === 'party') trigger(battle, 'kill', actor, target.tile, target)
  // The Legion (Undead 8), last (the relics fire over the corpse before it rises): a unit slain rises at
  // once as a shadow of the side holding it against its own, past Arise's limit and its tier, never a boss,
  // a shadow or a Monarch, while that side has room for it (roomFor: the party's board cap). Its raiser is
  // the killer when it stands on that side, else no one (a status ran it down). It is not Arise's: Blood
  // Tithe takes nothing for it and Hollow Court reaps none. A crumbled court never rises (crumble is no blow).
  const side = enemySide(target.side)
  if (alive(target) || target.raised || target.shadow || unitDef(target.id).boss || !rulesOf(battle, side).has('legion') || !roomFor(battle, side)) return
  // One rising on your side needs a free tile beside the Monarch (raise); with none, the Legion raises nothing.
  if (side === 'party' && riseTile(battle, target.tile) < 0) return
  emit(battle, { type: 'rule', rule: 'legion', side, actor: actor.side === side ? actor.uid : null, target: target.uid })
  raise(battle, actor.side === side ? actor : null, target, { side, rule: 'legion' })
}

// A boss's fall: its court and every other foe still standing crumble with it, each a death (`crumble:
// true`) as if slain (they pay essence), and the foes still to come never enter. The battle is won.
function crumble (battle, boss) {
  battle.crumbled = true
  battle.reserve = []
  for (const u of battle.units) {
    if (u.side !== 'foe' || !alive(u)) continue
    u.hp = 0
    u.statuses = []
    battle.at[u.tile] = null
    emit(battle, { type: 'death', target: u.uid, actor: boss.uid, crumble: true })
  }
  battle.roster++
}

// Arise: the corpse rises on the actor's side as a shadow of itself, at its level with its own kit and its count,
// each body at TUNING.monarch.raiseHp of its HP (see fit) (DESIGN §2.7). One of yours rises on the free tile
// closest to the Monarch (riseTile), never where it fell: with none free it does not rise (null; its corpse may
// rise later). It has no line: it holds the tile it rose on, unless that tile lies on a Banner's line, when it
// falls in with the Banner's wing (follow). One on the foes' side rises where it fell, a foe like any other, and
// walks the roads. A shadow counts toward synergies and leaves when the battle ends; its corpse cannot rise again.
// The shadow keeps the uid of the corpse it rose from (`corpse`); the event says where it fell (`from`). The
// Legion raises on `side` with no actor (null) when no one of that side slew it, its event marked `rule:
// 'legion'` (`rule`). Arise's cap is counted by the caller (runEffect). Returns the shadow, or null.
function raise (battle, actor, corpse, { side = actor.side, rule = null } = {}) {
  const tile = side === 'party' ? riseTile(battle, corpse.tile) : corpse.tile
  if (tile < 0) return null
  const u = makeUnit(corpse.id, { uid: battle.nextUid++, lvl: corpse.lvl, count: corpse.count })
  corpse.raised = true
  const shadow = enterBattle(battle, { ...u, side, shadow: true, corpse: corpse.uid, tile })
  const lead = side === 'party' ? battle.units.find((x) => x.banner && alive(x) && x.leader === null && x.line?.tiles.includes(shadow.tile)) : null
  if (lead) join(shadow, lead)
  emit(battle, {
    type: 'arise', actor: actor?.uid ?? null, corpse: corpse.uid, from: corpse.tile,
    unit: { uid: shadow.uid, id: shadow.id, side: shadow.side, tile: shadow.tile, lvl: shadow.lvl, hp: shadow.hp, maxHp: shadow.maxHp, shadow: true, ...marks(shadow), ...(shadow.line && { line: shadow.line }) },
    ...(rule && { rule })
  })
  // Blood Tithe: the Monarch pays for each shadow with its own HP (never its last: see corpses).
  if (actor === battle.monarch && battle.ks.tithe) {
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
  const d = (c) => distance(actor.tile, c.tile)
  const dead = battle.units.filter((c) => !alive(c) && !c.raised && !c.shadow && !unitDef(c.id).boss && !unitDef(c.id).monarch)
    .sort((a, b) => unitDef(b.id).tier - unitDef(a.id).tier || d(a) - d(b) || a.uid - b.uid)
  for (const c of dead) {
    if (count <= 0) break
    if (battle.at[c.tile] !== null) continue
    raise(battle, actor, c)
    count--
  }
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

// For a heal under Court of Bone (`mend`), its allies leave out the Monarch nothing can heal: a healer whose
// only wounded ally is that Monarch has no one to mend, and strikes instead of casting heals that land for 0.
// Its lists are made when a condition first reads them (nothing changes the board while conditions are read).
const view = (battle, unit, mend = false) => new View(battle, unit, mend)
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
      this._allies = this.mend ? allies.filter((u) => u !== this.battle.monarch) : allies
    }
    return this._allies
  }

  get enemies () { return (this._enemies ??= livingNow(this.battle, enemySide(this.self.side))) }

  // How far a unit stands from it, for a condition that reads only its area (content.js `near`).
  dist (u) { return distance(u.tile, this.self.tile) }
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

// The first ability in def order that passes its condition and has a target in reach, or null. The
// view a condition reads is only made if one asks (a heal's, under Court of Bone, its own: see view).
function nextAbility (battle, unit) {
  const ability = firstAbility(battle, unit)
  return ability ? { ability, candidates: reachableOn(battle, unit, ability) } : null
}

// That ability alone, its candidates not listed. Both tests are pure, so the cheap one comes first: whether
// anything is in reach (no list made), then its condition.
function firstAbility (battle, unit) {
  let s = null
  let m = null
  for (const ability of unit.kit) {
    if (!inReach(battle, unit, ability)) continue
    if (ability.when && !ability.when(mends(battle, ability) ? (m ??= view(battle, unit, true)) : (s ??= view(battle, unit)))) continue
    return ability
  }
  return null
}

// Whether reachableOn would list anyone: Arise a corpse, a blow a foe within its reach (reachOf), anything else a
// living unit of the side it aims at within its range.
function inReach (battle, actor, ability) {
  if (ability.shape === 'corpse') return corpses(battle, actor).length > 0
  if (ability.shape === 'self') return true
  if (!isAllyShape(ability.shape)) return foeWithin(battle, actor.tile, reachOf(actor, ability), actor.side)
  const range = rangeOf(ability)
  for (const u of battle.units) if (u.side === actor.side && u.hp > 0 && distance(actor.tile, u.tile) <= range) return true
  return false
}

// Whether an ability heals others while nothing can heal the Monarch (Court of Bone).
const mends = (battle, ability) => battle.ks.unhealable && ability.effects.some((e) => e.op === 'heal' && !e.self)

// The gauge the unit is saving for: its next ability, or with nothing in reach its cheapest.
export const nextCost = (battle, unit) => nextAbility(battle, unit)?.ability.castCost ?? unit.cheapest

const byHpPct = (a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.uid - b.uid
const lowest = (list) => list.slice().sort(byHpPct)[0]

// Each lane's place in CENTRE_OUT: the centre first.
const LANE = CENTRE_OUT.reduce((rank, x, i) => { rank[x] = i; return rank }, [])

// Whom a blow is aimed at among `list` (DESIGN §2.3). Yours aim at the foe furthest along its road (the lowest road
// distance to the Monarch), ties by lane, centre first, then the nearest, then the first to act. A foe aims at the
// piece of yours on its next road tile if listed, else the nearest, ties by lane, then the first to act.
function pick (battle, u, list) {
  if (list.length <= 1) return list[0] ?? null
  if (u.side === 'foe') {
    const next = arrowOf(battle, u)
    const there = list.find((x) => x.tile === next)
    if (there) return there
  }
  const dist = fieldOf(battle).dist
  let best = list[0]
  for (let i = 1; i < list.length; i++) {
    const x = list[i]
    const lane = LANE[tileX(x.tile)] - LANE[tileX(best.tile)]
    const near = distance(x.tile, u.tile) - distance(best.tile, u.tile)
    if ((u.side === 'party' ? (dist[x.tile] - dist[best.tile]) || lane || near : near || lane) < 0) best = x
  }
  return best
}

function pickTarget (battle, unit, ability, candidates) {
  if (isAllyShape(ability.shape)) {
    // A heal is not spent on a Monarch nothing can heal (Court of Bone) while anyone else could use it.
    const mendable = mends(battle, ability) ? candidates.filter((u) => u !== battle.monarch) : candidates
    return lowest(mendable.length ? mendable : candidates)
  }
  if (ability.shape === 'corpse') {
    // The strongest body first, then the nearest, then the first to have stood.
    const d = (c) => distance(unit.tile, c.tile)
    return candidates.slice().sort((a, b) => unitDef(b.id).tier - unitDef(a.id).tier || d(a) - d(b) || a.uid - b.uid)[0]
  }
  return pick(battle, unit, candidates)
}

// The target of a unit's ring: the foe its blows aim at (pick) among those within its ring of the tile it holds
// (for one of yours that lunged, the tile it left), or null with none.
export const ringTarget = (battle, u) => pick(battle, u, around(battle, u.home ?? u.tile, u.ring, enemySide(u.side)))

// ── rings, lines and roads ───────────────────────────────────────────────────────────────────────

// Each tick a unit does the first of these that applies (DESIGN §2.3–§2.6):
//   1. with a foe in its ring (u.ring tiles of the tile it holds, through walls), it fights: the first ability in
//      its list whose condition holds and that has a target (a blow's within its ring and its own range, a melee
//      one's next to it) is used, or banked for; with none, one of yours whose every blow is a melee one lunges
//      (see lunge) or waits, and anyone else walks on;
//   2. when its step is due, it walks (stepOf): one of yours back from a lunge, else along its line; a foe along
//      its road;
//   3. between steps, it uses what it can afford (a heal, a ward, Arise).
// Walking is off the gauge: a unit steps once per TUNING.board.stepTicks ÷ its stride (u.every), whatever its
// speed, so an arrival time is a distance. The Monarch never steps; it banks for Arise until a corpse lies in its
// domain.
// → { ability, targets, cost }, a step { to, kind }, or null (banking, waiting, or nothing to do).
function chooseAction (battle, u) {
  const due = battle.t >= u.nextStep
  if (!due && u.gauge < u.cheapest) return null
  if (foeWithin(battle, u.home ?? u.tile, u.ring, u.side)) {
    const ability = firstAbility(battle, u)
    if (ability) return u.gauge < ability.castCost ? null : use(battle, u, ability)
    if (!due) return null
    if (u.lunges && u.ring > 1) return lunge(battle, u)
  }
  const go = due ? stepOf(battle, u) : null
  if (go) return go
  const ability = firstAbility(battle, u)
  return ability && u.gauge >= ability.castCost ? use(battle, u, ability) : null
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

// The tiles a step from each tile may reach past the walls (unit.js steps), made at first need.
const adjOf = (battle) => (battle.adj ??= Array.from({ length: TILES }, (_, t) => steps(t, battle.walls)))

// Where a unit walks now (DESIGN §2.4, §2.6), as a step { to, kind }, or null: one of yours that lunged back toward
// the tile it left ('back'), else on to the next tile of its line once its signal has come ('line'); a foe along
// its road ('road'). Each waits while its next tile is held, by anyone.
function stepOf (battle, u) {
  if (u.side === 'foe') {
    const to = arrowOf(battle, u)
    return to >= 0 && battle.at[to] === null ? { to, kind: 'road' } : null
  }
  if (u.home !== null) {
    let best = -1
    for (const n of adjOf(battle)[u.tile]) {
      if (battle.at[n] === null && distance(n, u.home) < distance(best < 0 ? u.tile : best, u.home)) best = n
    }
    return best < 0 ? null : { to: best, kind: 'back' }
  }
  const to = lineStep(battle, u)
  return to >= 0 && battle.at[to] === null ? { to, kind: 'line' } : null
}

// The next tile of a unit's line, once the signal it waits for has come: −1 before then, past its last tile, and
// where the line breaks off (a tile no step from here reaches: a wall, or one not beside it). A follower walks
// its Banner's line shifted by its offset, and never takes a step its living Banner has not taken. (A shadow that
// joined a wing has no offset: it walks a line of its own, the rest of the Banner's: see join.)
function lineStep (battle, u) {
  const lead = u.offset === null ? u : battle.byUid.get(u.leader)
  const line = lead.line
  if (line === null || u.leg >= line.tiles.length || !fired(battle, line.when)) return -1
  if (lead !== u && alive(lead) && u.leg >= lead.leg) return -1
  let to = line.tiles[u.leg]
  if (lead !== u) {
    const x = tileX(to) + u.offset[0]
    const y = tileY(to) + u.offset[1]
    if (x < 0 || x >= LANES || y < 0 || y >= DEPTH) return -1
    to = tileAt(x, y)
  }
  return adjOf(battle)[u.tile].includes(to) ? to : -1
}

// A piece falls in with a Banner's wing (DESIGN §2.7, §2.8): from where it stands now it walks the rest of the
// Banner's line, shifted by where it stands from the Banner; its own line is set aside.
function follow (u, lead) {
  u.leader = lead.uid
  u.offset = [tileX(u.tile) - tileX(lead.tile), tileY(u.tile) - tileY(lead.tile)]
  u.leg = lead.leg
  u.line = null
}

// A shadow risen on a tile of a Banner's line joins its wing (DESIGN §2.7): it walks the rest of the line from that
// tile, on the Banner's signal. Rising beside the Monarch, it may stand on the Banner's way ahead: walking the
// line itself, it clears the way (a follower held to the Banner's steps never would).
function join (u, lead) {
  const rest = lead.line.tiles.slice(lead.line.tiles.indexOf(u.tile) + 1)
  u.leader = lead.uid
  u.leg = 0
  u.line = rest.length ? { tiles: rest, when: lead.line.when } : null
}

// A lunge (DESIGN §2.3): one of yours whose ring holds a foe, and none it can strike, steps toward its ring's
// target onto an open tile nearer it, never more than ring − 1 from the tile it left its line on (u.home, set by
// the step), so the strike that follows stays inside its ring: beside the target if it can, then the straight
// step, then the lane nearer the centre. With no such tile it waits. Once its ring is clear it walks back (stepOf).
function lunge (battle, u) {
  const target = ringTarget(battle, u)
  const from = u.home ?? u.tile
  const d0 = distance(u.tile, target.tile)
  let best = null
  let bestK = Infinity
  for (const n of adjOf(battle)[u.tile]) {
    const d = distance(n, target.tile)
    if (battle.at[n] !== null || d >= d0 || distance(n, from) > u.ring - 1) continue
    const k = d * 100 + (tileX(n) !== tileX(u.tile) && tileY(n) !== tileY(u.tile) ? 10 : 0) + LANE[tileX(n)]
    if (k < bestK) { best = n; bestK = k }
  }
  return best === null ? null : { to: best, kind: 'lunge' }
}

// The roads (DESIGN §2.6): a flood from `root` (the Monarch's tile) out through every tile no wall stands on, nor
// a blocker (the Flank field's: your pieces), steps as unit.js steps them, giving each tile its road distance (the
// steps to the root; Infinity where no road reaches) and its arrow: the neighbouring tile with the lowest distance
// (−1 at the root and where no road reaches). Among equals the order is fixed: the tile nearest the root's lane,
// then the one nearest its row (straight ahead), then the lane nearer the centre (CENTRE_OUT), so two foes on one
// tile always walk the same way. Every arrow points strictly closer to the root. Pure: the board draws it in prep
// as a battle walks it (fieldOf). → { root, dist, arrow }, each list by tile.
export function field ({ root, walls = [], blockers = [] }) {
  const closed = new Set([...walls, ...blockers])
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
  const key = (n) => Math.abs(tileX(n) - tileX(root)) * 1e4 + Math.abs(tileY(n) - tileY(root)) * 100 + LANE[tileX(n)]
  for (const t of queue) {
    let best = -1
    for (const n of steps(t, closed)) if (dist[n] === dist[t] - 1 && (best < 0 || key(n) < key(best))) best = n
    arrow[t] = best
  }
  return { root, dist, arrow }
}

// A battle's roads, made when first read: the Walk field (its root, the Monarch, never moves), or with `flank`
// the Flank field, your living pieces counted as walls, made again only once a piece of yours has entered or
// fallen since (battle.ours), never because one walked.
export function fieldOf (battle, flank = false) {
  const r = battle.roads
  if (!flank) return (r.walk ??= field({ root: battle.root, walls: battle.walls }))
  if (r.at !== battle.ours) {
    r.flank = field({ root: battle.root, walls: battle.walls, blockers: battle.units.filter((u) => u.side === 'party' && alive(u)).map((u) => u.tile) })
    r.at = battle.ours
  }
  return r.flank
}

// The tile a foe's road takes it to next: a Flank kind's on the Flank field while a road round your pieces reaches
// it there, else the Walk field's; −1 where none does.
export function arrowOf (battle, u) {
  if (u.behaviour === 'flank') {
    const f = fieldOf(battle, true)
    if (f.dist[u.tile] < Infinity) return f.arrow[u.tile]
  }
  return fieldOf(battle).arrow[u.tile]
}

// Timing marks (DESIGN §3): where each piece of yours stands at each tick of `at` (5, 10 and 15 s by default),
// walking its line against an empty field with your pieces the only blockers, as a battle with no
// foe in reach walks it. `party` is the fielded run units (the Monarch too), `lines` their lines by uid (a unit's
// own `line` if it carries one), `walls` the camp's tiles. A Time signal fires at its tick; no other signal ever
// does, so a line waiting on one holds. → { [uid]: [tile at each tick of `at`] }, for every soul and the Monarch.
export function timingMarks ({ party, lines = {}, walls = [], at = [100, 200, 300] }) {
  const b = createBattle({ party: party.map((u) => (lines[u.uid] ? { ...u, line: lines[u.uid] } : u)), foes: [], walls, seed: 'marks', quiet: true })
  const out = {}
  for (const u of b.units) out[u.uid] = []
  for (const end = Math.max(...at); b.t <= end; b.t++) {
    if (at.includes(b.t)) for (const u of b.units) out[u.uid][at.indexOf(b.t)] = u.tile
    for (const u of b.units) {
      if (b.t < u.nextStep) continue
      const go = stepOf(b, u)
      if (go) step(b, u, go)
    }
  }
  return out
}

// ── keystones and trigger relics ─────────────────────────────────────────────────────────────────

// The keystones' rules (KEYSTONE_LIST), merged, as the battle reads them: `mods` on every party unit but the
// Monarch; `rise`, the share of max HP a fallen soul rises with (0: none); `alias` (a role → role map for the
// party's synergies, or null); `raises`, what Arise's cap a battle is multiplied by; `tithe`, the share of the
// Monarch's max HP a shadow costs; and `unhealable` (Court of Bone). The domain's size comes from the run
// (domainOf), already bent.
export function keystoneRules (ids = []) {
  const ks = ids.map(keystoneDef)
  return {
    mods: ks.flatMap((k) => k.mods ?? []),
    rise: Math.max(0, ...ks.map((k) => k.rise ?? 0)),
    alias: ks.some((k) => k.alias) ? Object.assign({}, ...ks.map((k) => k.alias ?? {})) : null,
    raises: ks.reduce((n, k) => n * (k.raises ?? 1), 1),
    tithe: ks.reduce((n, k) => n + (k.tithe ?? 0), 0),
    unhealable: ks.some((k) => k.unhealable)
  }
}

// The relics that trigger, by the moment they fire on (TRIGGERS), in the order they were taken.
const triggersOf = (ids) => Object.fromEntries(TRIGGERS.map((on) => [on, ids.map(relicDef).filter((r) => r.on === on)]))

// A moment of the battle for the party: each relic that fires on it is announced ({ type: 'trigger', relic,
// on, unit: the subject }) and its effects run, the subject as their caster, on the targets each picks (see
// RELIC_LIST): the subject, the one on the other end, the Monarch, or either side around the place.
function trigger (battle, on, subject, place, other = null) {
  for (const relic of battle.triggers[on]) {
    emit(battle, { type: 'trigger', relic: relic.id, on, unit: subject.uid })
    for (const effect of relic.effects) runEffect(battle, effect, subject, triggered(battle, effect, subject, place, other))
  }
}

function triggered (battle, effect, subject, place, other) {
  switch (effect.to) {
    case 'self': return alive(subject) ? [subject] : []
    // The one on the other end, never the subject itself: a status ticking on the Monarch strikes it with no
    // attacker but itself, and Grave Bell must not wither it.
    case 'other': return other && other !== subject && alive(other) ? [other] : []
    case 'monarch': return battle.monarch && alive(battle.monarch) ? [battle.monarch] : []
    case 'allies': return around(battle, place, effect.range, subject.side)
    case 'foes': return around(battle, place, effect.range, enemySide(subject.side))
    default: throw new Error(`unknown trigger target "${effect.to}"`)
  }
}

// A soul: a party unit that is neither the Monarch nor a shadow.
const isSoul = (battle, u) => u.side === 'party' && u !== battle.monarch && !u.shadow

// Blood Tithe: what a shadow costs the Monarch.
const titheOf = (battle, m) => Math.ceil(m.maxHp * battle.ks.tithe)

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

function rollVariance (rng, tuning = TUNING) {
  const [lo, hi] = tuning.variance
  return rng.range(lo, hi)
}

// p: { power, atk, def, isCrit, critMul, variance, mul }
export function computeDamage (p, tuning = TUNING) {
  const t = tuning.damage
  const raw = p.power * (p.atk / t.atkDivisor)
  const mitigated = raw * (t.defConstant / (t.defConstant + Math.max(0, p.def)))
  const crit = p.isCrit ? (p.critMul ?? tuning.crit.mult) : 1
  const total = mitigated * crit * (p.variance ?? 1) * (p.mul ?? 1)
  return Math.max(t.min, Math.round(total))
}
