// Everything inside a fight: the tick loop, effects and statuses, unit AI and movement, and the combat
// formulas. Real-time in 50 ms ticks, and no input once it starts: the same setup always plays out the
// same. Pure: all randomness comes from battle.rng.
import { TUNING } from '../tuning.js'
import { unitDef, statusDef, abilityDef, ROLES, BEHAVIOURS, keystoneDef, relicDef, TRIGGERS } from '../content.js'
import { createRng, hashString } from './rng.js'
import {
  alive, livingOn, statsOf, activeSynergies, expand, enemySide, isAllyShape,
  deployTile, depthFor, distance, steps, NEIGHBOURS, rangeOf, TILES, tileX, tileY, tileAt, onBoard, activeBonds,
  boardPlace, abilitiesOf, auraOf, cheapestOf, costliestOf, makeUnit, slotAt, CAMP_ROWS, ROWS, CENTRE_OUT, LANES, DEPTH, summonsOf, summonTile
} from './unit.js'

// ── battle loop ──────────────────────────────────────────────────────────────────────────────────

// party/foes are run units { uid, id, lvl, path, tier, hp, maxHp, slot }; the battle works on copies, and
// only units on the field (slot ≥ 0) with HP left take part. Each starts on its slot's board tile (the
// party's in its camp, past `walls`, a list of board tiles), and the formation bonds it holds there last
// the whole battle. A battle still going at `ceiling` ticks ends undecided (the autoplayer rehearses on
// a shorter budget than the real fight's); the ticks count from the last foe to enter (see checkEnd).
//
// The Monarch (a party unit whose def is `monarch`) stands in the party's camp. Its domain reaches
// `domain` tiles from it; `will` is its Will (Arise raises corpses of tier up to raiseTier + will, raises × (1 +
// will) a battle, and its gauge fills willHaste × will faster). Units created mid-battle (shadows, summons) take
// uids from `nextUid` on (by default, past every uid here, the reserve's included); battle.nextUid is the first
// one still free when the battle ends. A battle with no Monarch (a test, a sample) has no domain and ends on a
// wipe, as before it.
//
// Summons: a party soul whose path tiers raise summons (unit.js summonsOf) has them appear on the open tiles
// nearest it as the battle begins, or as it enters from the reserve (see summon): battle units `summoned`, with
// `summoner` its uid, that keep to it on the leash as a foe's cohort keeps to its captain (`cohortOf`, the same
// uid), on its plan, and are gone when the battle ends. They take no place on the board (TUNING.army.board),
// pay nothing, and never rise as anyone's shadow. The `summons` switch (ablate) raises none.
//
// A party unit with `cohortOf` keeps to that unit on the leash (see leader): a summon to its summoner, a shadow
// to the Marshal whose banner it joined. `reserve` lists the units off the board, in the order they enter, one
// a tick on each side: a party one (a held detachment's soul, with a `when`) enters beside the Monarch once its
// start comes and it has room (see reinforce); one with `side: 'foe'` is a foe still to come, entering at the
// top edge (in its `lane`, or beside its captain once its captain stands) when its `when` fires. A foe's `wave`
// is the wave it comes in: 0 (or none) for the foes on the board from the start, 1 for the next, and so on; a
// wave's foes wait for it with `{ at: 'break', wave, t }`: the wave before is down to TUNING.spawn.waves.share
// of its foes, or `t` ticks have passed since it began to enter.
//
// The enemy as an army: a foe with `cohortOf` and `rank: true` is rank-and-file of its captain's cohort, kept on
// the leash, and a foe with a `plan` follows it as yours do (an elite's captain and its cohort). A unit on a
// leash whose leader falls is an orphan (it falters and Hunts), on either side. A boss's fall ends the battle:
// every foe still standing crumbles (see crumble), and its Grave Tide raises the dead on its side.
//
// Ranks: a soul with `grade` 2 is a Marshal. Within TUNING.ranks.domain tiles of it, its banner (itself, its
// summons and the shadows that joined it) never falters and so heeds every order, wherever the Monarch's domain
// ends; a shadow that rises within that reach joins its banner (see heeded, raise).
//
// Plans: a party unit with `plan: { where, square }` (and `det`, its detachment's id) follows it once
// nothing calls for a reaction (see chooseAction): 'hunt' (the default), 'stay' (hold the tile it started
// or entered on) or 'move' (walk to `square`, a board tile; on it or next to it, it has arrived and
// Hunts). `detachments` ([{ id, color, where, square, when }]) are announced at the start, one `order` event
// each, for the renderer.
//
// `keystones` and `relics` are the run's (ids): the keystones' rules bend the party's side of the battle (see
// keystoneRules), and the relics that trigger (`on`) fire for the party (see trigger).
//
// `ablate` (a measuring switch, never a player's: the autoplayer's ablation reports, autoplay.js ABLATIONS) lists
// rules taken away from the party's side: 'arise' (the Monarch's Arise never casts), 'synergies' (the party
// holds no synergy, at any step, its 8-step rules too) and 'summons' (no soul raises its summons). Empty in
// every real run.
//
// `quiet` (a rehearsal's, autoplay.js): the battle keeps no events (battle.events stays empty). It plays out
// exactly as it would otherwise: nothing in a battle reads its own events.
//
// `settle` (a rehearsal's only, never a real fight's: TUNING.autoplay.settle) lets playOut end the battle once its
// result is settled (see settled), with the units as they stand then: reason 'settled'.
export function createBattle ({
  party, foes, seed, floor = 1, boss = false, partyMods = [], foeMods = [], walls = [], ceiling = TUNING.tick.ceiling,
  domain = TUNING.monarch.domain, will = 0, nextUid = null, reserve = [], detachments = [],
  keystones = [], relics = [], foeRules = true, ablate = [], quiet = false, settle = null
}) {
  const stamp = (u, side) => fresh({ ...u, side, tile: deployTile(side, u.slot) }, 0)
  const units = [...party.map((u) => stamp(u, 'party')), ...foes.map((u) => stamp(u, 'foe'))]
    .filter((u) => u.hp > 0 && u.slot >= 0)
    .sort((a, b) => (a.side < b.side ? -1 : a.side > b.side ? 1 : a.slot - b.slot))
  const ks = keystoneRules(keystones)

  const battle = {
    t: 0, seed, floor, boss, ceiling, over: false, winner: null, reason: null, foeRules, ablate: new Set(ablate), quiet,
    // monarch: its battle unit, or null; death: what felled it ({ by, uid, ability, from, shape, threat });
    // raised: how many shadows Arise has raised.
    monarch: units.find((u) => u.side === 'party' && unitDef(u.id).monarch) ?? null, death: null,
    domain, will, raised: 0, nextUid: nextUid ?? Math.max(0, ...units.map((u) => u.uid), ...reserve.map((u) => u.uid)) + 1,
    // reserve: the bodies still to enter, in order; entered: the tick of the last entry, either side (the
    // escalation clock counts from it); byUid: every unit that has taken its place, by uid. signals: the
    // starts a held detachment can wait for, each given once and for good (the Monarch struck, a foe
    // entered, a party body fallen); called: the detachments whose start has come.
    reserve: reserve.map((u) => ({ ...u })), entered: 0, byUid: new Map(),
    // waveAt: the tick each foe wave began to enter (wave 0 stands from the start); crumbled: a boss fell and
    // its side crumbled with it. foeIn: the tick the last foe entered (0: none has; the ceiling counts from it).
    waveAt: [0], crumbled: false, foeIn: 0,
    signals: { struck: false, wave: false, falls: false }, called: new Set(),
    units: [], events: [], walls: new Set(walls), paths: new Map(),
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
    // adj, open, dist, queue: the path search's (searchStep), made at its first search.
    adj: null, open: null, dist: null, queue: null,
    syn: {}, cache: new Map(),
    // ks: the keystones' rules (keystoneRules); triggers: the relics that fire, by moment; centre: the tile the
    // domain centres on with Vanguard Crown (null: the Monarch's).
    ks, triggers: triggersOf(relics), centre: null,
    bonds: ['party', 'foe'].flatMap((side) => activeBonds(units.filter((u) => u.side === side), { alias: side === 'party' ? ks.alias : null }))
  }
  for (const u of units) occupy(battle, u)
  for (const u of units) fit(battle, u)
  // The souls' summons appear beside them, announced with everyone in the start event.
  for (const u of units) summon(battle, u, false)
  // One Army: each soul starts pooled with its summons, every unit at the same share (a soul carried in
  // wounded evens out with its fresh summons); the start event carries the spread HP.
  for (const u of battle.units) {
    const banner = ks.pool && u.cohortOf == null && bannerOf(battle, u)
    if (banner) spread(banner, poolOf(banner)[0])
  }
  if (ks.crown && battle.monarch) battle.centre = frontOf(battle)
  // Ambush (Skirmisher 8): a side holding it starts with every gauge full.
  for (const u of units) if (rulesOf(battle, u.side).has('ambush')) u.gauge = u.costliest

  emit(battle, {
    type: 'battle:start',
    walls: [...battle.walls],
    units: battle.units.map((u) => ({ uid: u.uid, id: u.id, side: u.side, slot: u.slot, tile: u.tile, lvl: u.lvl, hp: u.hp, maxHp: u.maxHp, ...marks(u) })),
    synergies: ['party', 'foe'].flatMap((side) => synergiesOf(battle, side).filter((s) => !s.rule || rulesOf(battle, side).has(s.rule)).map((s) => ({ side, id: s.id, name: s.name }))),
    bonds: battle.bonds.map((b) => ({ id: b.bond.id, uid: b.uid, partner: b.partner })),
    // The Monarch's uid (null without one) and its domain's reach, for the renderer.
    monarch: battle.monarch?.uid ?? null,
    domain: battle.monarch ? domain : null,
    // The bodies waiting to enter, in order (with the start a held one waits for, and the side of a foe).
    reserve: battle.reserve.map((u) => ({ uid: u.uid, id: u.id, lvl: u.lvl, ...marks(u), ...(u.when && { when: u.when }), ...(u.side === 'foe' && { side: 'foe' }) }))
  })
  for (const d of detachments) emit(battle, { type: 'order', detachment: d.id, color: d.color, where: d.where, square: d.square, when: d.when })
  // Vanguard Crown: where the domain stands at the start, for the renderer (it moves with the front).
  if (battle.centre !== null) emit(battle, { type: 'domain', centre: battle.centre })
  for (const side of ['party', 'foe']) if (rulesOf(battle, side).has('ambush')) emit(battle, { type: 'rule', rule: 'ambush', side })
  for (const u of battle.units) orphan(battle, u)
  for (const u of battle.units) falter(battle, u)
  for (const u of battle.units) arrive(battle, u)
  return battle
}

// What marks a unit in the events that announce it: a foe's rank-and-file and whose cohort, a summon and whose
// (`summoned`, `summoner`), its detachment, a soul's rank (grade 1 Knight, 2 Marshal), and a foe's wave (k ≥ 1:
// it came after the first formation).
const marks = (u) => ({
  ...(u.rank && { rank: true, cohortOf: u.cohortOf }), ...(u.summoned && { summoned: true, summoner: u.summoner }),
  ...(u.det != null && { det: u.det }), ...(u.grade > 0 && { grade: u.grade }), ...(u.wave && { wave: u.wave })
})

// A soul's summons (summonsOf) appear one by one on the open tile nearest it, beside it first, then behind
// (unit.js summonTile):
// each a unit of its own, `summoned`, with `summoner` its uid, at its level, keeping to it on the leash
// (`cohortOf`) and on its plan as it stands (its own copy: Stay holds the tile it appears on), in its detachment.
// Summons of a soul that enters fresh (a held start) enter fresh with it. Mid-battle each is announced ({ type:
// 'summon', actor, unit }); at the start the start event lists them. Only a living party soul raises them (not
// the Monarch, a shadow or a summon), none with the `summons` switch, and none once the board has no open tile.
function summon (battle, u, announce = true) {
  if (u.side !== 'party' || u === battle.monarch || u.shadow || u.summoned || !alive(u) || battle.ablate.has('summons')) return
  for (const { id, count, lvl } of summonsOf(u)) {
    for (let k = 0; k < count; k++) {
      const tile = summonTile(u.tile, (t) => battle.at[t] === null && !battle.walls.has(t))
      if (tile < 0) return
      const made = makeUnit(id, { uid: battle.nextUid++, lvl })
      const unit = enterBattle(battle, {
        ...made, side: 'party', tile, summoned: true, summoner: u.uid, cohortOf: u.uid,
        plan: { where: u.where, square: u.square }, ...(u.det != null && { det: u.det })
      })
      if (heldBody(u) && TUNING.orders.fresh) {
        unit.gauge = unit.costliest
        addStatus(battle, unit, 'shield', TUNING.orders.fresh)
      }
      if (!announce) continue
      emit(battle, { type: 'summon', actor: u.uid, unit: { uid: unit.uid, id: unit.id, side: unit.side, tile: unit.tile, lvl: unit.lvl, hp: unit.hp, maxHp: unit.maxHp, ...marks(unit) } })
      falter(battle, unit)
      arrive(battle, unit)
    }
  }
}

// The per-battle fields a unit fights with: an empty gauge, a step due at once (`t`), no statuses, and its
// plan's where (Hunt by default), its square and its anchor (the tile it starts or enters on: where Stay
// holds).
// Every battle unit is made with the same fields in the same order (UNIT_FIELDS; one it was not given, or that
// the battle sets later, is there as undefined, which reads as its absence does), so all of them share one
// shape and the tick loop's reads of them stay fast. A field outside the list is copied on after them.
const UNIT_FIELDS = new Set([
  'uid', 'id', 'lvl', 'path', 'tier', 'hp', 'maxHp', 'slot', 'grade', 'path2', 'tier2', 'side', 'tile', 'order', 'det', 'plan',
  'cohortOf', 'rank', 'summoned', 'summoner', 'when', 'wave', 'lane', 'shadow', 'corpse', 'arisen', 'raised', 'orphan', 'foiled', 'rose', 'stood',
  'gauge', 'nextStep', 'statuses', 'phase', 'quarry', 'falter', 'where', 'square', 'anchor', 'ord', 'kit', 'aura', 'cheapest', 'costliest', 'move'
])
const fresh = (u, t) => {
  const out = {
    uid: u.uid,
    id: u.id,
    lvl: u.lvl,
    path: u.path,
    tier: u.tier,
    hp: u.hp,
    maxHp: u.maxHp,
    slot: u.slot,
    grade: u.grade,
    path2: u.path2,
    tier2: u.tier2,
    side: u.side,
    tile: u.tile,
    order: u.order,
    det: u.det,
    plan: u.plan,
    cohortOf: u.cohortOf,
    rank: u.rank,
    summoned: u.summoned,
    summoner: u.summoner,
    when: u.when,
    wave: u.wave,
    lane: u.lane,
    shadow: u.shadow,
    corpse: u.corpse,
    arisen: u.arisen,
    raised: u.raised,
    orphan: u.orphan,
    foiled: u.foiled,
    rose: u.rose,
    stood: u.stood,
    gauge: 0,
    nextStep: t,
    statuses: [],
    phase: 0,
    quarry: null,
    falter: false,
    where: u.plan?.where ?? 'hunt',
    square: u.plan?.square ?? null,
    anchor: u.tile,
    // set as it takes its place (occupy)
    ord: undefined,
    kit: undefined,
    aura: undefined,
    cheapest: undefined,
    costliest: undefined,
    move: undefined
  }
  for (const k in u) if (!UNIT_FIELDS.has(k)) out[k] = u[k]
  return out
}

// A unit takes its place in the battle: on the board's index, in the order it acts (after everyone
// already there), with what its kit makes fixed for the battle (its abilities in priority order, its
// aura, its cheapest and costliest ability, and how its role moves). Everything that enters mid-battle comes
// through here too (enterBattle).
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
  u.move = moveOf(u.id)
  battle.units.push(u)
  battle.byUid.set(u.uid, u)
  battle.at[u.tile] = u
  battle.auraReach = Math.max(battle.auraReach, u.aura?.range ?? 0)
  if (u.aura) battle.auras.push(u)
  if (phasesOf(u.id)) battle.phased.push(u)
}

// Max HP includes the unit's HP mods (synergies, relics, path tiers); current HP keeps its fraction.
// Read once, as it takes its place: HP mods that come and go mid-battle do not stretch the bar. The
// Monarch's max HP is its points' and nothing else's (see modsFor): the one the camp shows.
function fit (battle, u) {
  if (u === battle.monarch) return
  const max = Math.max(1, Math.round(stats(battle, u).hp))
  if (max === u.maxHp) return
  u.hp = Math.max(1, Math.round(u.hp * max / u.maxHp))
  u.maxHp = max
}

// A unit joins a battle under way (a shadow, a summon, a reserve): `u` is a living run unit with its `side` and an
// open `tile` on the board; it gets the per-battle fields and its max HP fitted to its mods, as a unit
// there from the start does, acts after everyone already there (this very tick, if it enters before the
// turns are done), and may step at once. It takes its bonds from the board where it enters (beside: the
// same row, the next lane; behind and ahead: along its lane); those already there keep theirs. The
// caller emits the event that announces it. The roster changes, so every cache of who is on the board
// refreshes. Returns the battle unit.
export function enterBattle (battle, u) {
  const unit = fresh(u, battle.t)
  occupy(battle, unit)
  battle.roster++
  battle.paths.clear()
  battle.bonds.push(...activeBonds(livingOn(battle.units, unit.side), { place: boardPlace, holders: [unit], alias: unit.side === 'party' ? battle.ks.alias : null }))
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
//   lost  the Monarch stands alone: no other unit of its side standing, none still to come, and Arise spent (or
//         taken away): the battle can only end in its fall or at the ceiling, both losses.
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
  let foeComing = false
  let partyComing = false
  for (const b of battle.reserve) sideOf(b) === 'foe' ? (foeComing = true) : (partyComing = true)
  if (!partyComing && !battle.units.some((u) => u.side === 'party' && alive(u) && u !== m) &&
    (battle.ablate.has('arise') || battle.raised >= ariseCap(battle.will, battle.ks.raises))) return settle(battle, 'foe')
  if (foeComing) return
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
  const { ability, targets, cost, to, via, guard } = chosen
  if (to !== undefined) {
    // A step is free; a hop through bodies lists the tiles it passes over (`via`).
    emit(battle, { type: 'move', actor: u.uid, from: u.tile, to, ...(via && { via }) })
    battle.at[u.tile] = null
    battle.at[to] = u
    u.tile = to
    u.nextStep = battle.t + TUNING.board.stepTicks
    battle.paths.clear()
    if (u.side === 'party') recentre(battle)
    falter(battle, u)
    // A Marshal carries its domain with it: its banner may step into it or out of it. A member it leaves a
    // step behind is not cast off for that: it falters while it trails, but keeps its plan until its own next
    // step reads its place again (the grace in falter).
    if (u.grade >= 2) for (const m of battle.units) if (m.cohortOf === u.uid && alive(m)) falter(battle, m, true)
    arrive(battle, u)
    return
  }
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
// crumbled with it, else 'wipe'). Still going at the ceiling: undecided,
// which the run counts as a defeat. A battle with no Monarch is lost when the party is wiped with no one
// left in reserve. The ceiling counts from the last foe to enter, as the escalation clock does from any
// entry: each wave gets the whole window the first had, so its ramp (×bossMult in the Sovereign's room) always
// comes before the ceiling. Foes enter on timers (a wave at most `waves.t` after the one before began), so
// the battle stays bounded; your reserve's entries do not push the ceiling, or a long reserve could stall
// a fight for minutes, and they push the ramp only so far (see escalation).
function checkEnd (battle) {
  const m = battle.monarch
  let party = 0
  let foe = 0
  for (const u of battle.units) if (u.hp > 0) u.side === 'party' ? party++ : u.side === 'foe' && foe++
  for (const b of battle.reserve) if (sideOf(b) === 'foe') foe++
  const lost = m ? !alive(m) : !party && !battle.reserve.some((b) => sideOf(b) === 'party')
  if (!lost && foe && battle.t + 1 < battle.foeIn + battle.ceiling) return
  battle.over = true
  battle.winner = lost ? 'foe' : !foe ? 'party' : null
  battle.reason = lost && m ? 'monarch' : lost ? 'wipe' : !foe ? (battle.crumbled ? 'sovereign' : 'wipe') : 'tick-ceiling'
  emit(battle, { type: 'battle:end', winner: battle.winner, reason: battle.reason, ...(battle.death && { death: battle.death }) })
}

// ── the reserve ──────────────────────────────────────────────────────────────────────────────────

// A held detachment's soul (one whose start was not 'once').
export const heldBody = (u) => u.det != null && u.when != null && u.when.at !== 'once'
// The party's units on the board: everyone living but the Monarch (shadows and summons too). Not `all`: only
// those that take one of the board's places (Arise's shadows, summons and held detachments' souls stand past it).
const bodies = (battle, all = true) => battle.units.reduce((n, u) => n + (u.side === 'party' && alive(u) && u !== battle.monarch && (all || (!u.arisen && !u.summoned && !heldBody(u))) ? 1 : 0), 0)
// The held detachments' souls standing on the board (they have TUNING.orders.reserve places of their own).
const heldOn = (battle) => battle.units.reduce((n, u) => n + (u.side === 'party' && alive(u) && heldBody(u) ? 1 : 0), 0)
// Whether a shadow may rise on `side`: for the party, only while it has fewer than TUNING.army.board bodies on
// the board, as for a body entering. Unbounded, the Legion's shadows (one for every foe slain) would pack the
// board in a long fight of waves until a later wave found no tile to enter on, and a battle already won would
// stall to the ceiling. A foe side needs no bound: its shadows only ever rise from your dead.
const roomFor = (battle, side) => side !== 'party' || bodies(battle) < TUNING.army.board
const sideOf = (body) => body.side ?? 'party'

// Whether a body's start has come: at once (no `when`, or 'once'), at its tick ('time'), once the wave
// before its own has broken ('break', a foe wave's), or once its signal has been given ('struck': the
// Monarch took a blow; 'wave': a foe entered; 'falls': a party body on the board fell). A signal stays
// given, so a start that has come never goes again.
const ready = (battle, when) => !when || when.at === 'once' ||
  (when.at === 'time' ? battle.t >= when.t : when.at === 'break' ? broken(battle, when) : battle.signals[when.at])

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
      if (sideOf(u) !== 'foe' || u.shadow || (u.wave ?? 0) !== wave - 1) continue
      size++
      if (u.hp > 0) left++
    }
  }
  return left <= size * TUNING.spawn.waves.share
}

// The next unit whose start has come enters, one a tick on each side: a party soul beside the Monarch while it
// has room (a held soul in TUNING.orders.reserve places of its own; any other while the party has fewer than
// TUNING.army.board on the board), a foe at the top edge in its lane (a cohort's beside its captain, once the
// captain stands). Units go in reserve order. An entrant acts this very tick, after everyone already there, takes its bonds from
// where it enters, and holds its plan from there (Stay holds the tile it entered on). Every entry restarts
// the escalation clock (within bounds: see escalation): a reserve never walks into ramped blows; a foe's entry is the 'wave' signal, and the
// first of a foe wave's announces it ({ type: 'wave', wave }).
function reinforce (battle) {
  if (!battle.reserve.length) return
  call(battle)
  // Arise's shadows stand past the board's cap: they take no place a body entering needs. A held detachment's
  // bodies stand past it too, in TUNING.orders.reserve places of their own (the reserve's payoff: a later start
  // is how more than the board's bodies fight at once).
  const room = bodies(battle, false) < TUNING.army.board
  const heldRoom = heldOn(battle) < TUNING.orders.reserve
  for (const side of ['party', 'foe']) {
    // A wave's bodies all wait on the same break: it is read once a look down the reserve (nothing changes
    // while the reserve is read).
    const breaks = new Map()
    const due = (when) => {
      if (when?.at !== 'break') return ready(battle, when)
      const key = `${when.wave}|${when.t}`
      if (!breaks.has(key)) breaks.set(key, broken(battle, when))
      return breaks.get(key)
    }
    const body = battle.reserve.find((b) => sideOf(b) === side && (side === 'foe' || (heldBody(b) ? heldRoom : room)) && due(b.when))
    if (body) enter(battle, body)
  }
}

function enter (battle, body) {
  const side = sideOf(body)
  const lead = side === 'foe' && body.cohortOf != null ? battle.byUid.get(body.cohortOf) : null
  const tile = entryTile(battle, side, lead && alive(lead) ? lead.tile : null, body.lane)
  if (tile < 0) return
  battle.reserve.splice(battle.reserve.indexOf(body), 1)
  if (side === 'foe' && body.wave && battle.waveAt[body.wave] === undefined) {
    battle.waveAt[body.wave] = battle.t
    emit(battle, { type: 'wave', wave: body.wave })
  }
  const unit = enterBattle(battle, { ...body, side, tile })
  battle.entered = battle.t
  if (side === 'foe') {
    battle.signals.wave = true
    battle.foeIn = battle.t
  }
  emit(battle, {
    type: 'enter',
    unit: { uid: unit.uid, id: unit.id, side: unit.side, tile: unit.tile, lvl: unit.lvl, hp: unit.hp, maxHp: unit.maxHp, ...marks(unit) }
  })
  orphan(battle, unit)
  falter(battle, unit)
  arrive(battle, unit)
  if (side !== 'party') return
  // Fresh: a held detachment's soul (a start other than 'once') enters with a full gauge and Shielded
  // (TUNING.orders.fresh ticks): the blow kept back lands at once, on a line that can take the reply.
  if (body.det != null && body.when && body.when.at !== 'once' && TUNING.orders.fresh) {
    unit.gauge = unit.costliest
    addStatus(battle, unit, 'shield', TUNING.orders.fresh)
  }
  recentre(battle)
  // Its summons appear beside it (and join its pool, under One Army).
  summon(battle, unit)
  pool(battle, unit)
  trigger(battle, 'enter', unit, unit.tile)
}

// A held detachment is called the tick its start comes: announced once ({ type: 'call', detachment, at }),
// for the renderer; its bodies then enter one a tick as there is room.
function call (battle) {
  for (const b of battle.reserve) {
    if (b.det == null || !b.when || b.when.at === 'once' || battle.called.has(b.det) || !ready(battle, b.when)) continue
    battle.called.add(b.det)
    emit(battle, { type: 'call', detachment: b.det, at: b.when.at })
  }
}

// Where a body enters: the open tile nearest `near` if given (a foe's captain), else for the party nearest the
// domain's centre, the Monarch (under Vanguard Crown the front-most captain: a body entering beside a Monarch
// the domain has left would falter from its first tick and drop its plan; without a Monarch, the rear row in
// `lane` or the middle one), for a foe the top edge in `lane`, ties going to
// tiles ahead of it (toward the other side), then level with it, then the nearest lane, then the lower tile;
// −1 if the board is full.
function entryTile (battle, side, near = null, lane = CENTRE_OUT[0]) {
  const rear = slotAt((side === 'party' ? CAMP_ROWS : ROWS) - 1, lane)
  const from = near ?? (side === 'party' && battle.monarch && alive(battle.monarch) ? battle.centre ?? battle.monarch.tile : deployTile(side, rear))
  const fy = side === 'party' ? 1 : -1
  let best = -1
  let bestK = Infinity
  for (let t = 0; t < TILES; t++) {
    if (battle.at[t] !== null || battle.walls.has(t)) continue
    const dy = (tileY(t) - tileY(from)) * fy
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

// The living foes next to a unit; with any, it is engaged.
export const foesNextTo = (battle, u) => around(battle, u.tile, 1, enemySide(u.side))
export function isEngaged (battle, u) {
  const around = NEIGHBOURS[u.tile]
  for (let i = 0; i < around.length; i++) {
    const x = battle.at[around[i]]
    if (x !== null && x.side !== u.side) return true
  }
  return false
}

// The living allies whose aura reaches this unit.
export const auraGivers = (battle, u) => battle.auraReach
  ? around(battle, u.tile, battle.auraReach, u.side).filter((a) => a !== u && a.aura && distance(a.tile, u.tile) <= a.aura.range)
  : []

// Candidate primary targets for an ability, as unit.js's reachable: a melee strike looks at the 8 tiles
// around, Arise at the corpses it may raise, anything else down the list.
function reachableOn (battle, actor, ability) {
  if (ability.shape === 'corpse') return corpses(battle, actor)
  if (ability.shape !== 'self' && !isAllyShape(ability.shape) && rangeOf(ability) === 1) {
    return foesNextTo(battle, actor)
  }
  return reachableIn(battle, actor, ability)
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

// What Arise may raise: the other side's fallen, not raised yet, never a boss, of tier up to 1 + Will,
// lying within the domain on a tile no one living stands on; and only while the battle's raises (1 +
// Will) last. A shadow is never a corpse to raise: it fights on the actor's side.
// Blood Tithe doubles the raises (battle.ks.raises), and the Monarch never pays a tithe that would fell it.
// With Vanguard Crown the domain, and so Arise's reach, centres on the front-most captain. A shadow is a body
// on the board like any other: none rises while the party already has TUNING.army.board of them (roomFor).
// Arise's cap a battle (TUNING.monarch.raises a Will step, from Will 0) and the highest tier it raises.
export const ariseCap = (will, raises = 1) => TUNING.monarch.raises * (1 + will) * raises
export const ariseTier = (will) => TUNING.monarch.raiseTier + will

function corpses (battle, actor) {
  if (actor === battle.monarch && battle.ablate.has('arise')) return []
  // Arise is bounded by its own cap, not the board's: its shadows rise past the 14 (they take no place a body needs).
  if (battle.raised >= ariseCap(battle.will, battle.ks.raises) || (actor !== battle.monarch && !roomFor(battle, actor.side))) return []
  if (actor === battle.monarch && battle.ks.tithe && actor.hp <= titheOf(battle, actor)) return []
  const centre = battle.centre ?? actor.tile
  return battle.units.filter((c) => c.side !== actor.side && !alive(c) && !c.raised && !c.shadow &&
    !unitDef(c.id).boss && unitDef(c.id).tier <= ariseTier(battle.will) && battle.at[c.tile] === null &&
    distance(c.tile, centre) <= battle.domain)
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
// above it, with cohorts making eight of a kind common from floor 3, their ladders stop at the stat steps). A rule that changes what happens announces it ({ type: 'rule', rule, side, … }); those that only
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
  for (const b of battle.bonds) if (b.uid === unit.uid) mods.push(...b.bond.mods)
  for (const giver of auraGivers(battle, unit)) mods.push(...giver.aura.mods)
  if (own) mods.push(...(unit.side === 'party' ? battle.partyMods : battle.foeMods))
  // Will hastens the Monarch's gauge: Arise comes sooner (TUNING.monarch.willHaste a point).
  if (unit === battle.monarch && battle.will && TUNING.monarch.willHaste) mods.push({ path: 'gauge.rate', op: 'mul', v: 1 + TUNING.monarch.willHaste * battle.will })
  if (falters(battle, unit)) mods.push({ path: 'damage.dealt', op: 'mul', v: TUNING.monarch.falter })
  if (braced(battle, unit)) mods.push({ path: 'damage.taken', op: 'mul', v: TUNING.orders.braced })
  // A rank's might (TUNING.ranks.might): a Knight or a Marshal deals that × damage and takes 1 / that × (round 2).
  const might = TUNING.ranks.might[unit.grade ?? 0] ?? 1
  if (might !== 1) mods.push({ path: 'damage.dealt', op: 'mul', v: might }, { path: 'damage.taken', op: 'mul', v: 1 / might })
  return mods
}

// Braced: a unit of the party on Stay, standing on the tile it holds (its anchor), takes TUNING.orders.braced
// × damage. The line that holds where it was told is the line that holds (orders' payoff; Hunt never braces).
export const braced = (battle, u) => u.side === 'party' && u.where === 'stay' && distance(u.tile, u.anchor) <= TUNING.orders.post && u !== battle.monarch && !u.orphan

// A braced line holds flankers (TUNING.orders.holdFlank, necessity round 3): a flanker cannot vault a braced
// unit of the other side, and one with a braced foe next to it is engaged like anyone else (it cannot slip
// away). The Stay line is the answer to the foes that slip through to whoever hides at the back.
const pinned = (battle, u) => {
  if (!TUNING.orders.holdFlank || u.side === 'party') return false
  const around = NEIGHBOURS[u.tile]
  for (let i = 0; i < around.length; i++) {
    const x = battle.at[around[i]]
    if (x !== null && x.side !== u.side && braced(battle, x)) return true
  }
  return false
}

// A party unit outside the Monarch's domain falters, and so does every shadow: it deals less damage
// (TUNING.monarch.falter). Read from where it stands now; the Monarch itself never falters, nor do foes
// for the domain, and with no Monarch there is no domain. A unit on a leash whose leader has fallen (`orphan`: a
// foe's rank-and-file, a summon whose summoner fell, a shadow whose Marshal fell) falters for the rest of the
// battle, on either side, and so does a foe's shadow (the Sovereign's
// raised dead, or their Legion's) wherever it stands. A Marshal's banner within its own domain
// never falters (heeded): not even a shadow that joined it. With Vanguard Crown the Monarch's domain centres
// on the front-most captain (battle.centre) instead of the Monarch; a Marshal's own domain stays on it.
export const falters = (battle, u) => !!u.orphan || (u.side === 'foe' ? !!u.shadow : battle.monarch !== null && u.uid !== battle.monarch.uid &&
  !heeded(battle, u) && ((!!u.shadow && TUNING.monarch.shadowFalter) || distance(u.tile, battle.centre ?? battle.monarch.tile) > battle.domain))

// Whether a unit stands in its banner's Marshal's own domain: the Marshal itself, or one of its banner (a summon
// of it, a shadow that joined it) within TUNING.ranks.domain tiles of it while it stands.
const heeded = (battle, u) => {
  const m = u.grade >= 2 ? u : leader(battle, u)
  return !!m && m.grade >= 2 && distance(u.tile, m.tile) <= TUNING.ranks.domain
}

// The living Marshal on `side` whose domain holds `tile`, the nearest (then the first to act), or null.
const marshalAt = (battle, side, tile) =>
  around(battle, tile, TUNING.ranks.domain, side).filter((u) => u.grade >= 2).sort((a, b) => distance(a.tile, tile) - distance(b.tile, tile))[0] ?? null

// A leashed unit's leader (a foe's captain, a summon's summoner, a joined shadow's Marshal), while it stands:
// null for anyone else, and for one whose leader has fallen (or never took the field).
const leader = (battle, u) => {
  if (u.cohortOf == null || u.orphan) return null
  const c = battle.byUid.get(u.cohortOf)
  return c && alive(c) ? c : null
}

// A leashed unit whose leader is gone falters from now on and fights as its role does (it Hunts, whatever plan it
// had, on either side).
function orphan (battle, u) {
  if (u.cohortOf == null || !alive(u) || u.orphan || leader(battle, u)) return
  u.orphan = true
  u.where = 'hunt'
}

// A unit on Move that stands on its square or next to it has arrived: it Hunts from now on, announced
// ({ type: 'arrive', uid }) for the renderer.
function arrive (battle, u) {
  if (u.where !== 'move' || !alive(u) || distance(u.tile, u.square) > 1) return
  u.where = 'hunt'
  emit(battle, { type: 'arrive', uid: u.uid })
}

// Announces a change in whether a unit falters (it can only change when it moves or enters, or its
// captain falls: the Monarch never moves). Outside the domain only Hunt is heeded: a party unit that
// falters drops its plan to Hunt for the rest of the battle, back inside or not (a one-way trip). So does
// an orphan of either side (a foe falters only as one): its captain's plan fell with it. With `grace` (a
// Marshal's member its Marshal just stepped away from: on the leash it trails a step behind, so it is a
// tile past the Marshal's domain for a moment as a matter of course) it falters but keeps its plan; its own
// next step (or anything else that reads it again) decides.
function falter (battle, u, grace = false) {
  const on = alive(u) && falters(battle, u)
  if (on && !grace) u.where = 'hunt'
  if (on === u.falter) return
  u.falter = on
  emit(battle, { type: 'falter', target: u.uid, on })
}

// Cached on everything stats depend on, so nothing has to remember to invalidate it: whether it is engaged,
// the allies whose aura reaches it, whether it falters, its statuses with their stacks (in order), and its
// side's synergies (the Monarch takes none). Its bonds are fixed once it has entered, and everything else
// modsFor reads is the battle's for good. The key is compared field by field, with no string built. The
// synergies are read again only once the roster has changed (they are the roster's), and a change of roster
// that leaves them as they were keeps the stats.
export function stats (battle, unit) {
  const engaged = isEngaged(battle, unit)
  const f = falters(battle, unit)
  const b = braced(battle, unit)
  const hit = battle.cache.get(unit.uid)
  if (hit !== undefined && hit.engaged === engaged && hit.f === f && hit.b === b && sameStatuses(hit.statuses, unit.statuses) && sameGivers(battle, unit, hit.givers)) {
    if (hit.roster === battle.roster) return hit.s
    if (sameList(hit.syn, unit === battle.monarch ? null : synergiesOf(battle, unit.side))) {
      hit.roster = battle.roster
      return hit.s
    }
  }
  // (statsOf reads only these of a unit: its kind, level and path tiers, and its position.)
  const pos = engaged ? 'engaged' : 'free'
  const s = statsOf({ id: unit.id, lvl: unit.lvl, path: unit.path, tier: unit.tier, path2: unit.path2, tier2: unit.tier2, pos }, modsFor(battle, unit))
  const givers = auraGivers(battle, unit).map((u) => u.uid)
  const statuses = unit.statuses.map((x) => [x.id, x.stacks])
  const syn = unit === battle.monarch ? null : synergiesOf(battle, unit.side)
  battle.cache.set(unit.uid, { engaged, f, b, roster: battle.roster, s, givers, statuses, syn })
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

// Every blow ramps up startTick (×bossMult for a boss) after the last entry, either side (battle.entered): a
// reserve or a wave never walks into ramped damage. But never later than startTick × bossMult after the last
// foe entry (battle.foeIn), the clock the ceiling counts on: your own reserve, entering late in a long fight,
// cannot push the ramp past the ceiling and turn a grind the ramp would have broken into a defeat. So every
// battle meets at least ceiling − startTick × bossMult ticks of ramp (the boss room's whole window, where your
// entries never restart it).
export function escalation (battle) {
  const e = TUNING.escalation
  const from = Math.min(battle.entered + e.startTick * (battle.boss ? e.bossMult : 1), battle.foeIn + e.startTick * e.bossMult)
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
      battle.raised++
      raise(battle, actor, corpse).arisen = true
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
      const mul = a.damage.dealt * d.damage.taken * escalation(battle)
      let damage = computeDamage({
        power: effect.power,
        atk: a.atk,
        def: d.def,
        isCrit,
        variance: rollVariance(battle.rng),
        mul
      })
      // Deathblow (Trickster 8): a crit from a side holding it slays outright, a boss and the Monarch excepted
      // (no rule ends the run on one roll). Under One Army it slays the struck unit's whole banner: its blow
      // is the pool's HP, as the banner stands and falls together. Last Stand outranks it: the blow is still
      // raised to a felling one, but a target with its stand unspent takes it at 1 HP (applyDamage), so
      // Deathblow is announced only when it truly slays.
      const whole = bannerOf(battle, target)
      const hp = whole ? poolOf(whole)[0] : target.hp
      if (isCrit && foe && damage < hp && !unitDef(target.id).boss && target !== battle.monarch && rulesOf(battle, actor.side).has('deathblow')) {
        damage = hp
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

// A heal mends `power` scaled by the healer's ATK and healing given, or with `pct` that share of the
// target's max HP (a relic's). With Court of Bone nothing heals the Monarch; with One Army a heal goes into
// the banner's pool.
function heal (battle, actor, target, power, pct = 0) {
  if (target === battle.monarch && battle.ks.unhealable) return
  let amount
  if (pct) {
    amount = Math.max(1, Math.round(target.maxHp * pct))
  } else {
    const a = stats(battle, actor)
    amount = Math.max(1, Math.round(power * a.atk / TUNING.damage.atkDivisor * a.heal.given))
  }
  const banner = bannerOf(battle, target)
  if (banner) {
    const [hp, max] = poolOf(banner)
    spread(banner, Math.min(max, hp + amount))
    emit(battle, { type: 'heal', actor: actor.uid, target: target.uid, heal: poolOf(banner)[0] - hp, hp: target.hp })
    emit(battle, { type: 'share', banner: banner[0].uid, hp: banner.map((u) => [u.uid, u.hp]) })
    return
  }
  const before = target.hp
  target.hp = Math.min(target.maxHp, target.hp + amount)
  emit(battle, { type: 'heal', actor: actor.uid, target: target.uid, heal: target.hp - before, hp: target.hp })
}

// Last Stand (Construct 8): whether the first blow that would fell this unit leaves it at 1 HP instead:
// its side holds the rule, it is not the Monarch, and its stand is unspent (target.stood).
const stands = (battle, u) => !u.stood && u !== battle.monarch && rulesOf(battle, u.side).has('last_stand')

// A blow lands. With One Army it comes out of the banner's pool, spread over the banner (a `share` event
// after the blow's); every unit it leaves at 0 falls. A blow the Monarch stands is the 'struck' moment.
// Last Stand (see stands, a Deathblow included) turns the first blow that would fell its target: the
// target is left at 1 HP, or under One Army, whose banner stands and falls together, the pool is left at
// 1 HP a unit (the struck unit's stand is spent for it). Last Stand comes first and Undying after it: a
// unit that stood falls to a later blow, and may rise then.
function applyDamage (battle, target, amount, { actor, isCrit, ability }) {
  const banner = bannerOf(battle, target)
  const left = banner ? poolOf(banner)[0] - banner.length : target.hp - 1
  const stand = amount > left && stands(battle, target)
  if (stand) {
    target.stood = true
    amount = Math.max(0, left)
  }
  if (banner) spread(banner, Math.max(0, poolOf(banner)[0] - amount))
  else target.hp = Math.max(0, target.hp - amount)
  battle.harm[target.side] += amount
  emit(battle, { type: 'damage', actor: actor.uid, target: target.uid, damage: amount, isCrit, ability, hp: target.hp })
  if (banner) emit(battle, { type: 'share', banner: banner[0].uid, hp: banner.map((u) => [u.uid, u.hp]) })
  if (stand) emit(battle, { type: 'rule', rule: 'last_stand', side: target.side, target: target.uid })
  if (target === battle.monarch) battle.signals.struck = true
  for (const u of banner ?? [target]) if (!alive(u)) fall(battle, u, actor, ability)
  if (target === battle.monarch && alive(target)) trigger(battle, 'struck', target, target.tile, actor)
}

// A unit falls to `actor`'s blow. With Undying a captain rises at once where it fell, once a battle (its
// banner stands by it: it never left). A fallen party unit (never the Monarch, whose fall ends the battle) is
// the 'fall' moment, and a foe slain by the party the 'kill' moment. A captain Undying lifts again has still
// fallen (decided: it was struck down, and the death shows): the 'falls' start comes and the fall relics fire
// over it, a Marshal's too, but its banner is not orphaned and the roster does not change.
function fall (battle, target, actor, ability) {
  target.statuses = []
  emit(battle, { type: 'death', target: target.uid, actor: actor.uid })
  if (target.side === 'party' && target !== battle.monarch) battle.signals.falls = true
  if (battle.ks.rise && isCaptain(battle, target) && !target.rose) {
    target.rose = true
    target.hp = Math.max(1, Math.round(target.maxHp * battle.ks.rise))
    battle.risen++
    emit(battle, { type: 'rise', target: target.uid, hp: target.hp })
    trigger(battle, 'fall', target, target.tile, actor)
    return
  }
  battle.at[target.tile] = null
  battle.roster++
  battle.paths.clear()
  if (target.side === 'foe' && unitDef(target.id).boss) crumble(battle, target)
  // A fallen captain's cohort falters from now on, and Hunts.
  for (const u of battle.units) {
    if (u.cohortOf === target.uid && !u.orphan && alive(u)) {
      orphan(battle, u)
      falter(battle, u)
    }
  }
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
  if (target.side === 'party') {
    if (isCaptain(battle, target)) recentre(battle)
    trigger(battle, 'fall', target, target.tile, actor)
  } else if (actor.side === 'party') {
    trigger(battle, 'kill', actor, target.tile, target)
  }
  // The Legion (Undead 8), last (the relics fire over the corpse before it rises): a unit slain rises at
  // once as a shadow of the side holding it against its own, past Arise's limit and its tier, never a boss,
  // a shadow, a summon or a Monarch, while that side has room for it (roomFor: the party's board cap). Its raiser is
  // the killer when it stands on that side, else no one (a status ran it down). It is not Arise's: Blood
  // Tithe takes nothing for it and Hollow Court reaps none; like any shadow it joins a Marshal's banner when
  // it rises within that Marshal's domain. A crumbled court never rises (crumble is no blow).
  const side = enemySide(target.side)
  if (alive(target) || target.raised || target.shadow || target.summoned || unitDef(target.id).boss || !rulesOf(battle, side).has('legion') || !roomFor(battle, side)) return
  emit(battle, { type: 'rule', rule: 'legion', side, actor: actor.side === side ? actor.uid : null, target: target.uid })
  raise(battle, actor.side === side ? actor : null, target, { side, rule: 'legion' })
}

// A boss's fall: its court and every other foe still standing crumble with it, each a death (`crumble:
// true`) as if slain (they pay essence), and the foes still to come never enter. The battle is won.
function crumble (battle, boss) {
  battle.crumbled = true
  battle.reserve = battle.reserve.filter((b) => sideOf(b) !== 'foe')
  for (const u of battle.units) {
    if (u.side !== 'foe' || !alive(u)) continue
    u.hp = 0
    u.statuses = []
    battle.at[u.tile] = null
    emit(battle, { type: 'death', target: u.uid, actor: boss.uid, crumble: true })
  }
  battle.roster++
  battle.paths.clear()
}

// Arise: the corpse rises on the actor's side as a shadow of itself, at its level with its own kit and
// TUNING.monarch.raiseHp of its HP, where it fell. A shadow always falters, holds the bonds of where it
// rises, counts toward synergies, and leaves when the battle ends; its corpse cannot rise again. One that
// rises within a Marshal's domain joins its banner (`cohortOf`, as a summon keeps to its summoner), on the
// Marshal's plan as it stands, keeping to it by the leash, and not faltering
// while it stays inside that domain. The shadow keeps the uid of the corpse it rose from (`corpse`). The
// Legion raises on `side` with no actor (null) when no one of that side slew it, its event marked `rule:
// 'legion'` (`rule`). Arise's cap is counted by the caller (runEffect). Returns the shadow.
function raise (battle, actor, corpse, { side = actor.side, rule = null } = {}) {
  const u = makeUnit(corpse.id, { uid: battle.nextUid++, lvl: corpse.lvl })
  corpse.raised = true
  const m = marshalAt(battle, side, corpse.tile)
  const banner = m ? { cohortOf: m.uid, plan: { where: m.where, square: m.square }, ...(m.det != null && { det: m.det }) } : {}
  const shadow = enterBattle(battle, { ...u, side, shadow: true, corpse: corpse.uid, hp: Math.ceil(u.maxHp * TUNING.monarch.raiseHp), tile: corpse.tile, ...banner })
  emit(battle, {
    type: 'arise', actor: actor?.uid ?? null, corpse: corpse.uid,
    unit: {
      uid: shadow.uid, id: shadow.id, side: shadow.side, tile: shadow.tile, lvl: shadow.lvl, hp: shadow.hp, maxHp: shadow.maxHp, shadow: true,
      ...(m && { cohortOf: m.uid }), ...(m?.det != null && { det: m.det })
    },
    ...(rule && { rule })
  })
  // As every entrant: one that rises on or beside its Marshal's square has arrived.
  falter(battle, shadow)
  arrive(battle, shadow)
  // One Army: a shadow that joined a Marshal's banner joins its pool too, as a body entering does.
  pool(battle, shadow)
  // Blood Tithe: the Monarch pays for each shadow with its own HP (never its last: see corpses).
  if (actor === battle.monarch && battle.ks.tithe) {
    const cost = titheOf(battle, actor)
    actor.hp -= cost
    emit(battle, { type: 'tithe', target: actor.uid, damage: cost, hp: actor.hp })
  }
  return shadow
}

// The Sovereign's Grave Tide: up to `count` of the field's dead rise on the actor's side as shadows, as Arise
// raises them: the fallen of either side, never a shadow, a summon, a boss, the Monarch or one risen already, lying
// where no one living stands; the strongest first, then the nearest, then the first to have stood. Arise's
// cap does not count them.
function raiseDead (battle, actor, count) {
  const d = (c) => distance(actor.tile, c.tile)
  const dead = battle.units.filter((c) => !alive(c) && !c.raised && !c.shadow && !c.summoned && !unitDef(c.id).boss && !unitDef(c.id).monarch)
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

// Each tick, a unit does the first of these that applies:
//   1. a flanker on Hunt whose quarry is out of reach, with a way to it, steps toward it or waits for its
//      next step;
//   2. the first ability in def order whose `when` holds and that has a target in reach is used, or
//      the unit banks gauge for it if it cannot afford it yet;
//   3. the reaction rule, the same for every unit on every plan: a melee unit with a foe within 2 tiles
//      steps to engage it; a ranged unit with a foe in its range holds (2 already covers that: what is
//      in range is in reach, so it is spelled out for the rule's sake);
//   4. its plan: Hunt steps toward the foes (a flanker at its quarry, through bodies); Stay walks back to
//      its anchor, the tile it started or entered on, and holds it; Move walks to its square (a flanker
//      through bodies), arriving on it or next to it, and Hunts from then on.
// Walking is off the gauge: every unit may step once per TUNING.board.stepTicks (u.nextStep is the tick
// its next step is due), whatever its speed, so a line keeps its shape and an arrival time is a
// distance. A unit with nothing in reach and no step due does nothing; its gauge still fills, up to its
// costliest ability. A step never enters a wall. An engaged unit only steps if its behaviour slips
// (BEHAVIOURS); a flanker also walks through the living, yours and theirs, to the first open tile on
// its path, on any plan. One that stands (the Monarch) never steps: it banks for Arise until a corpse
// lies in its domain. A unit's behaviour is its role's; with no plan it Hunts, as every unit did before
// plans, and outside the domain a party unit drops its plan to Hunt (see falter).
// A rank-and-file member keeps to its captain while the captain stands: with nothing in reach and nothing
// to react to, one beyond its leash walks back (a flanker through bodies); one inside it takes its plan's
// step only where that keeps it inside, else holds. It follows its captain's plan (its own copy: Stay holds
// its own anchor), and Hunts once its captain does. A flanker in a cohort has no quarry to chase ahead of
// everything else. Once its captain falls it falters and Hunts: its role, unleashed.

export const behaviourOf = (unit) => moveOf(unit.id)
// By kind, read once: the content never changes under a battle.
const moves = new Map()
const moveOf = (id) => {
  let m = moves.get(id)
  if (m === undefined) moves.set(id, (m = ROLES[unitDef(id).role].move))
  return m
}

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

// Whether reachableOn would list anyone: a melee strike a foe next to it (isEngaged), Arise a corpse, anything
// else a living unit of the side it aims at within its range.
function inReach (battle, actor, ability) {
  if (ability.shape === 'corpse') return corpses(battle, actor).length > 0
  if (ability.shape === 'self') return true
  if (!isAllyShape(ability.shape) && rangeOf(ability) === 1) return isEngaged(battle, actor)
  const side = isAllyShape(ability.shape) ? actor.side : enemySide(actor.side)
  const range = rangeOf(ability)
  for (const u of battle.units) if (u.side === side && u.hp > 0 && distance(actor.tile, u.tile) <= range) return true
  return false
}

// Whether an ability heals others while nothing can heal the Monarch (Court of Bone).
const mends = (battle, ability) => battle.ks.unhealable && ability.effects.some((e) => e.op === 'heal' && !e.self)

// The gauge the unit is saving for: its next ability, or with nothing in reach its cheapest.
export const nextCost = (battle, unit) => nextAbility(battle, unit)?.ability.castCost ?? unit.cheapest

// How far the unit's foe-targeting abilities that pass their condition reach: where it walks to. Arise
// targets no living foe (its reach is the domain), so it never sets how close a unit walks.
function reachOf (battle, unit) {
  let s = null
  let r = 1
  for (const a of unit.kit) {
    if (!isAllyShape(a.shape) && a.shape !== 'corpse' && (!a.when || a.when(s ??= view(battle, unit)))) r = Math.max(r, rangeOf(a))
  }
  return r
}

const byHpPct = (a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.uid - b.uid
const lowest = (list) => list.slice().sort(byHpPct)[0]

// A flanker's quarry: the foe deepest in its own formation, kept until it falls; ties to the most
// wounded.
function quarryOf (battle, unit) {
  const held = unit.quarry === null ? undefined : battle.byUid.get(unit.quarry)
  if (held && alive(held)) return held
  const foes = livingOn(battle.units, enemySide(unit.side))
  const q = foes.sort((a, b) => depthFor(b.side, b.tile) - depthFor(a.side, a.tile) || byHpPct(a, b))[0]
  unit.quarry = q?.uid ?? null
  return q
}

// The step toward the nearest open tile within `range` of a target, as { to } or, for a hop through
// bodies, { to, via } (the occupied tiles passed over, in order); null if the unit is there already or
// no path is open. Walls are closed to everyone, tiles held by the living to all but a flanker
// (`through`); with `avoid`, so are tiles next to a foe. A flanker's step goes on along its path past
// every occupied tile to the first open one, so it never ends on a body. Ties keep to open tiles, then
// to the lane.
// Memoised until someone moves, dies or enters: nothing else changes the answer.
// (Kept by the unit's uid: its targets' uids, range and flags, compared as they are, no string built.)
function stepToward (battle, unit, targets, opts) {
  let list = battle.paths.get(unit.uid)
  if (list === undefined) battle.paths.set(unit.uid, (list = []))
  for (const e of list) {
    if (e.range !== opts.range || e.avoid !== opts.avoid || e.through !== opts.through || e.targets.length !== targets.length) continue
    let same = true
    for (let i = 0; i < targets.length && same; i++) same = e.targets[i] === targets[i].uid
    if (same) return e.step
  }
  const step = searchStep(battle, unit, targets, opts)
  list.push({ targets: targets.map((x) => x.uid), range: opts.range, avoid: opts.avoid, through: opts.through, step })
  return step
}

function searchStep (battle, unit, targets, { range, avoid = false, through = false }) {
  // The board flattened into typed arrays: open (may be stood on); adj lists the steps around walls.
  // (open, dist and the queue are the battle's own, reused search to search: nothing keeps them between.)
  const adj = (battle.adj ??= Array.from({ length: TILES }, (_, t) => steps(t, battle.walls)))
  const open = (battle.open ??= new Uint8Array(TILES))
  for (let t = 0; t < TILES; t++) open[t] = battle.at[t] === null || battle.at[t] === unit ? 1 : 0
  for (const t of battle.walls) open[t] = 0
  // A flanker vaults bodies, but never a braced one of the other side (holdFlank): that tile is a wall to it.
  const hold = through && TUNING.orders.holdFlank && unit.side !== 'party'
  const pass = (battle.pass ??= new Uint8Array(TILES))
  if (through) {
    for (let t = 0; t < TILES; t++) {
      const u = battle.at[t]
      pass[t] = hold && u !== null && u.side !== unit.side && braced(battle, u) ? 0 : 1
    }
    for (const t of battle.walls) pass[t] = 0
  }
  if (avoid) {
    for (let t = 0; t < TILES; t++) {
      const u = battle.at[t]
      if (u !== null && u.side !== unit.side) for (const n of NEIGHBOURS[t]) open[n] = 0
    }
  }
  const self = unit.tile
  // Steps to the nearest goal: a breadth-first search outward from the goals, stopped once it reaches
  // the unit. By then every tile nearer the goals has its final count, and only those lie on its path.
  const dist = (battle.dist ??= new Float64Array(TILES)).fill(Infinity)
  const queue = (battle.queue ??= new Int32Array(TILES))
  let tail = 0
  for (let t = 0; t < TILES; t++) {
    if (!open[t] && t !== self) continue
    for (let k = 0; k < targets.length; k++) {
      if (distance(targets[k].tile, t) <= range) { dist[t] = 0; queue[tail++] = t; break }
    }
  }
  for (let i = 0; i < tail && dist[self] === Infinity; i++) {
    const t = queue[i]
    for (const n of adj[t]) {
      if (dist[n] === Infinity && ((through && pass[n]) || open[n] || n === self)) { dist[n] = dist[t] + 1; queue[tail++] = n }
    }
  }
  if (dist[unit.tile] === 0 || dist[unit.tile] === Infinity) return null
  const lane = tileX(unit.tile)
  const next = (t) => {
    let best = -1
    let bestK = Infinity
    for (const n of adj[t]) {
      if (dist[n] !== dist[t] - 1) continue
      const k = (open[n] ? 0 : 2) + (tileX(n) === lane ? 0 : 1)
      if (k < bestK) { best = n; bestK = k }
    }
    return best
  }
  // Every goal is open, so a hop always comes down on an open tile, at the goal at the latest.
  const via = []
  let to = next(unit.tile)
  while (!open[to]) {
    via.push(to)
    to = next(to)
  }
  return via.length ? { to, via } : { to }
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
  if (ability.shape === 'blast') {
    // Where it catches the most: the candidate with the most of its side around it.
    const caught = (c) => around(battle, c.tile, 1, c.side).length
    return candidates.slice().sort((a, b) => caught(b) - caught(a) || byHpPct(a, b))[0]
  }
  const quarry = candidates.find((u) => u.uid === unit.quarry)
  if (quarry) return quarry
  if (ROLES[unitDef(unit.id).role].target === 'weakest') return lowest(candidates)
  const d = (u) => distance(unit.tile, u.tile)
  return candidates.slice().sort((a, b) => d(a) - d(b) || byHpPct(a, b))[0]
}

// → { ability, targets, cost }, a step { to, via? }, or null (banking, waiting, or nothing to do).
function chooseAction (battle, unit) {
  const move = unit.move
  // One that stands never has a step due.
  const due = move !== 'stand' && battle.t >= unit.nextStep
  const lead = leader(battle, unit)
  const where = planOf(unit, lead)
  // Nothing is affordable and no step is due, so nothing below could happen; a hunting flanker still keeps
  // its quarry current every tick, as it would there.
  if (!due && unit.gauge < unit.cheapest) {
    if (move === 'flank' && where === 'hunt' && (BEHAVIOURS[move].slips || !isEngaged(battle, unit))) quarryOf(battle, unit)
    return null
  }
  const free = (BEHAVIOURS[move].slips && !pinned(battle, unit)) || !isEngaged(battle, unit)

  if (move === 'flank' && free && !lead && where === 'hunt') {
    const quarry = quarryOf(battle, unit)
    const range = reachOf(battle, unit)
    if (quarry && distance(unit.tile, quarry.tile) > range) {
      // It has eyes only for its quarry while it has a way to it: it steps when its step is due and
      // waits between, striking nothing it passes. With no open tile in reach of the quarry, it fights
      // whatever is in reach.
      const go = stepToward(battle, unit, [quarry], { range, through: true })
      if (go) return due ? go : null
    }
  }

  const ability = firstAbility(battle, unit)
  if (ability) {
    if (unit.gauge < ability.castCost) return null
    const pick = { ability, candidates: reachableOn(battle, unit, ability) }
    const aimed = pickTarget(battle, unit, pick.ability, pick.candidates)
    const guard = bodyguard(battle, unit, pick.ability, aimed)
    const primary = guard ?? aimed
    return {
      ability: pick.ability, targets: expandOn(battle, unit, pick.ability, primary), cost: pick.ability.castCost,
      ...(guard && { guard: { uid: guard.uid, side: guard.side, for: aimed.uid } })
    }
  }

  if (!free || !due) return null
  // The reaction rule.
  const range = reachOf(battle, unit)
  const through = move === 'flank'
  if (range === 1) {
    const near = around(battle, unit.tile, 2, enemySide(unit.side))
    const go = near.length ? stepToward(battle, unit, near, { range: 1, through }) : null
    if (go) return go
  } else if (foeWithin(battle, unit, range)) {
    return null
  }
  if (!lead) return planStep(battle, unit, move, where, range)
  // A member with nothing in reach keeps to its captain: it walks back while it is beyond its leash, and
  // takes its plan's step only where that step keeps it inside. (Read literally, "otherwise it behaves by
  // its own role" would have it walk ahead and back every step; a led flanker likewise leaves its quarry
  // to its captain's banner.)
  const r = leash(battle, unit, lead)
  if (distance(unit.tile, lead.tile) > r) return stepToward(battle, unit, [lead], { range: r, through })
  const go = planStep(battle, unit, move, where, range)
  return go && distance(go.to, lead.tile) <= r ? go : null
}

// Whether a living foe of the unit stands within `range` tiles of it.
function foeWithin (battle, unit, range) {
  for (const e of battle.units) if (e.side !== unit.side && e.hp > 0 && distance(e.tile, unit.tile) <= range) return true
  return false
}

// Which plan a unit follows now: its own ('hunt', 'stay' or 'move'), or, for a member whose captain
// Hunts (it arrived, faltered or never had a plan), Hunt.
const planOf = (unit, lead) => (lead?.where === 'hunt' ? 'hunt' : unit.where)

// A tile to walk to, as stepToward takes its targets (keyed apart from every unit).
const spot = (tile) => ({ uid: `@${tile}`, tile })

// The step a unit's plan takes with nothing to react to: Stay back onto its anchor (nothing, on it or with
// it taken); Move toward a tile on or next to its square; Hunt as its role walks.
function planStep (battle, unit, move, where, range) {
  if (where === 'stay') return stepToward(battle, unit, [spot(unit.anchor)], { range: 0, through: move === 'flank' })
  if (where === 'move') return stepToward(battle, unit, [spot(unit.square)], { range: 1, through: move === 'flank' })
  return roleStep(battle, unit, move, range)
}

// How near a member keeps to its captain: within a tile, while there is room there. A captain has only
// eight tiles around it, so a member that finds them all taken (walls, the cohort, anyone) keeps to the
// nearest ring around the captain that still has an open tile, or it is already in: a big cohort stands
// two and three deep about its captain instead of idling where it started.
function leash (battle, unit, lead) {
  const d = distance(unit.tile, lead.tile)
  const x0 = tileX(lead.tile)
  const y0 = tileY(lead.tile)
  const open = (x, y) => onBoard(x, y) && battle.at[tileAt(x, y)] === null && !battle.walls.has(tileAt(x, y))
  for (let r = 1; r < d; r++) {
    for (let k = -r; k <= r; k++) {
      if (open(x0 + k, y0 - r) || open(x0 + k, y0 + r) || open(x0 - r, y0 + k) || open(x0 + r, y0 + k)) return r
    }
  }
  return Math.max(1, d)
}

// The step a unit's role takes with nothing in reach (Hunt): toward the foes, to within `range` (its
// reach). A ranged unit holding back keeps off the tiles next to foes, unless that leaves it no way in. A
// flanker walks at its quarry if it has a way to it, else at the nearest foe, still through bodies.
function roleStep (battle, unit, move, range) {
  const foes = livingOn(battle.units, enemySide(unit.side))
  if (move === 'flank') {
    const quarry = quarryOf(battle, unit)
    const go = quarry && distance(unit.tile, quarry.tile) > range && stepToward(battle, unit, [quarry], { range, through: true })
    if (go) return go
  }
  return (move === 'keep' && range > 1 && stepToward(battle, unit, foes, { range, avoid: true })) ||
    stepToward(battle, unit, foes, { range, through: move === 'flank' })
}

// ── keystones and trigger relics ─────────────────────────────────────────────────────────────────

// The keystones' rules (KEYSTONE_LIST), merged, as the battle reads them: `mods` on every party unit but the
// Monarch; `rise`, the share of max HP a fallen captain rises with (0: none); `pool` (One Army); `alias` (a
// role → role map for the party's synergies and bonds, or null); `crown` (Vanguard Crown); `raises`, what
// Arise's cap a battle is multiplied by; `tithe`, the share of the Monarch's max HP a shadow costs; and
// `unhealable` (Court of Bone). The domain's size comes from the run (domainOf), already bent.
export function keystoneRules (ids = []) {
  const ks = ids.map(keystoneDef)
  return {
    mods: ks.flatMap((k) => k.mods ?? []),
    rise: Math.max(0, ...ks.map((k) => k.rise ?? 0)),
    pool: ks.some((k) => k.pool),
    alias: ks.some((k) => k.alias) ? Object.assign({}, ...ks.map((k) => k.alias ?? {})) : null,
    crown: ks.some((k) => k.crown),
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

// A captain: a soul of the party (not the Monarch, not a summon or anyone else on a leash, not a shadow).
const isCaptain = (battle, u) => u.side === 'party' && u !== battle.monarch && u.cohortOf == null && !u.shadow

// Vanguard Crown: the tile of the party's front-most living captain on the board (nearest the foes; ties to
// the middle lane, then the lowest uid), or null with none (the domain falls back on the Monarch).
function frontOf (battle) {
  let best = null
  const k = (u) => [-tileY(u.tile), Math.abs(tileX(u.tile) - CENTRE_OUT[0]), u.uid]
  for (const u of battle.units) {
    if (!alive(u) || !isCaptain(battle, u)) continue
    const a = k(u)
    const b = best && k(best)
    if (!b || a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))) best = u
  }
  return best ? best.tile : null
}

// With Vanguard Crown the domain moves with the front: when a captain steps, falls or enters, the centre is
// found again; if it moved, it is announced ({ type: 'domain', centre: tile }) and every living party unit's
// faltering is read again (one that steps outside drops its plan, as ever).
function recentre (battle) {
  if (!battle.ks.crown || !battle.monarch) return
  const centre = frontOf(battle)
  if (centre === battle.centre) return
  battle.centre = centre
  emit(battle, { type: 'domain', centre: centre ?? battle.monarch.tile })
  for (const u of battle.units) if (u.side === 'party' && alive(u)) falter(battle, u)
}

// One Army: the living units of the banner a party unit fights in, its soul first, then its summons (and the
// shadows that joined a Marshal) still with it, in acting order; null without the keystone, for a foe or the
// Monarch, or for a banner of one.
function bannerOf (battle, u) {
  if (!battle.ks.pool || u.side !== 'party' || u === battle.monarch) return null
  const cap = u.cohortOf == null ? u : u.orphan ? null : battle.byUid.get(u.cohortOf)
  if (!cap || !alive(cap) || cap === battle.monarch) return null
  const banner = [cap, ...battle.units.filter((x) => x.cohortOf === cap.uid && !x.orphan && alive(x))]
  return banner.length > 1 ? banner : null
}

// A pool's HP and max HP: its units' summed.
const poolOf = (banner) => banner.reduce(([hp, max], u) => [hp + u.hp, max + u.maxHp], [0, 0])

// Spreads `total` HP over a banner by max HP, so that each unit stands at the same share of the pool: whole
// HP, the few left over going one apiece from the captain on (so a banner's last HP keeps its captain
// standing). Never past a unit's max HP. While the pool holds at least 1 HP a unit, every unit keeps 1 and
// the rest is spread by what each holds above it: a pool only fells its units once a blow leaves it fewer
// HP than units. A heal or an entry never lowers the pool, so neither ever leaves a living unit at 0 (one
// that would stand on the board, uncounted and unkillable, having never fallen).
function spread (banner, total) {
  const base = total >= banner.length ? 1 : 0
  const room = poolOf(banner)[1] - base * banner.length
  const rest = total - base * banner.length
  let left = rest
  for (const u of banner) {
    u.hp = base + (room > 0 ? Math.floor(rest * (u.maxHp - base) / room) : 0)
    left -= u.hp - base
  }
  for (const u of banner) if (left > 0 && u.hp < u.maxHp) { u.hp++; left-- }
}

// A unit joins its banner's pool as it enters (a soul with its summons, a shadow joining a Marshal): the pool is
// spread again over all of it.
function pool (battle, u) {
  const banner = bannerOf(battle, u)
  if (!banner) return
  spread(banner, poolOf(banner)[0])
  emit(battle, { type: 'share', banner: banner[0].uid, hp: banner.map((x) => [x.uid, x.hp]) })
}

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
