// A player for tests and balance runs: a policy that picks one action at a time for apply(). It plays at one of two
// levels (LEVELS), on the same choices and the same scouting a player has:
//   basic   rules of thumb: rooms by weighted draws, the strongest souls fielded in its first draft (each role's row,
//           packed from the middle lane, every other lane against blasts), in a Shop a Command relic it can pay for
//           (pickShop), recruits only to fill the field, essence on the lowest kind's next tier (on the track it is on),
//           an altar's heal; it never fuses, and in battle it ends every turn without an order (policy.js basicTurn: what
//           it leaves alone strikes with its basic blow)
//   expert  judges (redesign.md §2.17; expert.js), and has studied the combo book (BOOK, src/sim/combos.json, ranked
//           by a static formula: --combos). Every decision is one shape: the situation read once (survey out of battle,
//           policy.js situation in it: what a player is shown, and the book), the options listed, each read as a named
//           vector of features, the tree of hard rules (expert.js TREES) forcing or filtering them, the weights
//           (TUNING.expert) scoring the rest. The next room by its type and the army's state (roomFeatures; or by
//           the learned route's tree, src/sim/expert.json's `route`, where ROUTE_LEARNED is on: learnedRoute); the
//           formation drafted (the plan's target formation as the first turn would read it: plan.js deployment; zone
//           drafts about the seat, its gate held, basic's three) and hill-climbed on a static score against the scouted
//           room's roads (formationFeatures); every purchase, fusion, recruit, relic bought or given and altar's rite
//           by one growth search on a sketch (the field's strength and the book's worth of the combo it plays toward:
//           targetOf), a relic against the tiers its price displaces (buyFor), the recruit, the purchases and the
//           formation decided by the forest out of battle where one decides them and reads another candidate more than
//           its margin above the growth search's or the plan's (outforest.js, src/sim/expert.json's `outforest`); its target's
//           kinds fielded first and never let go while another will do; in battle every turn policy.js expertTurn's (a
//           battle plan kept across turns, its target formation, kill list and forecast: plan.js; then each piece once,
//           on the board as the ones before it left it, by the model tree, the battle forest overruling it where it is
//           confident: forest.js). It never plays a battle, a turn of the foes, or a route ahead to decide anything.
// Essence buys tiers, recruits, fusions and relics (a Shop's): the Monarch's HP and Command come from run relics, a
// kind's level from its tiers (run.js). The Monarch is the camp's (run.js: on its seat, monarchSlot); nothing moves it.
// In a battle it gives the level's turn policy's orders, one at a time.
// Run directly for a balance report:  node src/sim/autoplay.js [--runs 8] [--seed sim] [--level expert] [--workers n]
// (`--forest <file|none>`: the expert's forest, forest.js, from that file or none; the shipped expert's by default)
// for two players on the same seeds, paired:  … --paired <a>,<b> [--runs 256] [--seed sel] [--workers 4]  (each a forest
// file, `forest:<file>`, `route:<route>`, `outforest:<file|none>`, `expert:<file>` a whole expert, or none: today's
// expert, playerOf)
// for the gap between the levels:     … --ladder [--runs 8] [--forest file|none]
// or for a report on how much the player's choices decide battles:  … --decisions [--runs 8]
// or the expert with one mechanic taken away (ABLATIONS):  … --ablate orders  (a report as above; --ablate moves: its
// pieces never move in battle)
// for how much each mechanic carries the expert, full runs:  … --ablations [--runs 8] [--variants full,orders,fusions] [--out runs.json]
// or as a fast battle-level proxy (its battles refought stripped): … --necessity [--runs 8] [--setups file]
// or what the expert considers against what it chooses, and which rule decided (AUDIT):  … --audit [--runs 4] [--seed audit]
// or the expert's combo book, ranked by its static formula and written to src/sim/combos.json (rerun when content or
// numbers change):  … --combos  (npm run combos)
// or the harness, each archetype committed against free play on the same seeds, and free play's diversity (redesign.md
// §3):  … --builds [--player expert|teacher] [--commit <archetype>|all] [--scale 1] [--runs 256] [--seed div]; or what a
// run can gather, floor by floor:  … --pool  (npm run builds, npm run pool; the harness's section says more)
// (--decisions and --necessity refight recorded battles to measure them: they decide nothing.)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRng } from './rng.js'
import {
  statsOf, tracksOf, tiersOf, nextTracks, CENTRE_OUT, CAMP_SLOTS, CAMP_ROWS, campOpen, wallTiles, steps, deployTile, tileAt, tileX, tileY, TILES,
  LANES, rowOf, colOf, distance, makeUnit, slotAt, baseStats, summonsOf, DEPTH, sizeOf, footprintSlots, fits,
  monarchSlot, abilitiesOf, isBlow, isAllyShape, blowReach, armOf, heldMods, isRunPath, cellsOf, meleeOnly, auraOf, activeSynergies, rangeOf, ROWS, reachOf
} from './unit.js'
import { roadsTo } from './field.js'
import { createBattle, playOut, timelineHash, legalOrders, stalled } from './turns.js'
import { expertTurn, basicTurn, brief, situation } from './policy.js'
import { forestModel, useForest } from './forest.js'
import {
  outForestModel, useOutForest, outDecides, chooseOut, opensBoard, zeros, put, SIT_KEYS, CAND_KEYS, FIELD_KEYS, OUT_THREATS, OUT_ROLES, OUT_ROOMS, PREP_SIT_KEYS,
  PREP_CAND_KEYS, FORMATION_KEYS, OPENING_KEYS, OPENING_ROOM_KEYS
} from './outforest.js'
import { deployment } from './plan.js'
import { value, decide, standing as keysOf, outranks, TREES, leafOf, checkModel, pathName, conditions, shippedPart, expertModel, useExpert } from './expert.js'
import { grantsArise, bleeds, ariseGrants } from './rules.js'
import {
  createRun, apply, availableNodes, fieldCap, rosterCap, fielded, inOssuary, currentNode, battleSetup, tierCost, foeMods, roomThreats,
  isMonarch, monarchOf, souls, canAdvance, unhealed, soulCount, heldKinds, canPlace, canFuse, fuseParts, fuseCost, OSSUARY, START_PARTY,
  relicTier, levelOf, kindLevel, monarchHp, ariseOf, commandOf, canBuy, relicPrice, isRunRelic, unheld, canHold, foeEssence, eliteBonus, floorPrice, runStat,
  spawnPool, draftOffer, drawRoom, varyRoutes, altarActions, transmuteOffer
} from './run.js'
import { nodeOf, RANKS, generateFloor } from './map.js'
import { TUNING } from '../tuning.js'
import { unitDef, abilityDef, campDef, relicDef, fusionDef, FUSION_LIST, UNIT_LIST, SYNERGIES, RELIC_LIST, STATUS_WORTH } from '../content.js'

// search: formations met by hill-climbing from the best draft, on the static score (0: the first draft, basic's rule
// of thumb); wounds: field by worth with wounds counted; route: choose the next room by its features (else weighted
// draws); spend: grow by the growth search (grow: purchases, recruits, the Shop's relics, who holds them) rather than by
// rule of thumb; fuse: weigh each fusion it can make (else it never fuses); book: play toward the combo book's best
// reachable combo (targetOf); more: draft the expert's formations too (zone drafts about the Monarch, its gate held:
// drafts); turns: how it plays its turns in battle ('basic': End Turn alone; 'expert': policy.js expertTurn).
export const LEVELS = {
  basic: { search: 0, wounds: false, route: false, spend: false, fuse: false, turns: 'basic' },
  expert: { search: 120, wounds: true, route: true, spend: true, fuse: true, more: true, book: true, turns: 'expert' }
}
// The turn policies by name (LEVELS `turns`; `unfused`, the expert's that never fuses in battle: the fusions
// ablation's; `still`, the expert's that never moves a piece: the moves ablation's). Each takes the battle and options
// (expertTurn's `note`, the audit's).
const TURNS = {
  basic: basicTurn,
  expert: (b, o) => expertTurn(b, o),
  unfused: (b, o) => expertTurn(b, { ...o, fuse: false }),
  still: (b, o) => expertTurn(b, { ...o, moving: false })
}
// The turn policy L fights by: its `turns`, with its ablation's mechanic taken from them (ablatedTurns).
const turnsOf = (L) => ablatedTurns(L.turns ?? 'basic', L.ablate)
// Turn policy `turns` with mechanic `m` taken away: End Turn alone without orders, the expert's unfused without
// fusions, its still without moves.
const ablatedTurns = (turns, m) => (m === 'orders' ? 'basic' : turns !== 'expert' ? turns : m === 'fusions' ? 'unfused' : m === 'moves' ? 'still' : turns)

// ── ablation: the expert with one mechanic taken away ─────────────────────────────────────────────

// For measuring how much each mechanic carries the expert (--ablations, --necessity): a level's `ablate`
// takes ONE mechanic from it and changes nothing else; essence it would have spent there goes where its
// spending logic already sends it:
//   orders         ends every turn of every battle without an order (policy.js basicTurn: what is left alone strikes
//                  or mends with its basic, and no skill is ever used): what in-battle play is worth
//   fusions        never fuses (fusionOptions lists none; its turns give no fuse order in battle either: TURNS unfused)
//   summons        no tier brings a summon in battle (a rules switch: the run's `ablate`, carried in every battle's
//                  setup, so a snapshot stripped of it, necessity, fights without it too), and such a tier is worth
//                  only its place on the track (worth: its summons not counted), so the essence goes elsewhere
//   tracks         never buys a track tier (its kinds stay at their first level: a level is its tiers')
//   legendaries    never buys a Legendary relic (Arise and its variants among them)
//   relics         never buys a Common, Uncommon or Rare relic (so neither HP nor Command: the field stays at
//                  TUNING.party.field, Legion's aside)
//   synergies      the party holds no synergy's rule in battle (a rules switch, as summons)
//   formation      no formation search: its souls in basic's first draft's cells (who it fields still its own)
//   moves          its pieces never move in battle: each acts from where it stands (policy.js expertTurn's `moving`:
//                  TURNS still); prep unchanged: what moving the pieces is worth (redesign.md §2.18)
// A run of an ablation that is a rules switch must be made with it (ablatedRun); policy refuses one that is not.
// 'arise' is a rules switch too (no relic grants Arise: the necessity's and the tests'), not an ablation: Arise is
// measured with the Legendaries (it is one), and fusions as an extra, both having substitutes the expert spends on
// instead (the user's call after the balance pass, 2026-10-09). The formation is measured with no band (MEASURED; the
// user's call after the turns pass, 2026-10-11): pieces move in battle, and the orders absorb where they start. So are
// the moves (2026-10-11, with the plan: redesign.md §2.18).
export const ABLATIONS = ['orders', 'fusions', 'summons', 'tracks', 'legendaries', 'relics', 'synergies', 'formation', 'moves']
export const RULE_SWITCHES = ['arise', 'synergies', 'summons']
// A run for a level under `ablate`: with its rules switch where it is one, and from `start` (createRun's fixed start: the
// tests') where given, else from the draft; at difficulty `scale` (createRun's: the harness's).
export const ablatedRun = (seed, ablate = null, start = null, scale = 1) => createRun({ seed, ablate: RULE_SWITCHES.includes(ablate) ? [ablate] : null, start, scale })
// Whether L never buys relic `id`.
const legendary = (id) => relicTier(id) === 'legendary'
const BANNED = {
  legendaries: legendary,
  relics: (id) => !legendary(id)
}
const banned = (L, id) => !!BANNED[L.ablate]?.(id)

// A formation as L may field it: under 'formation' the cells basic's first draft gives (basicCells). Anything
// else as it is.
const allowed = (run, party, L) => (L.ablate === 'formation' ? basicCells(run, party, L) : party)

// Basic's first draft's cells for these units (L's fielding order, as its drafts take them): the Monarch on its
// seat, the souls by role row from the middle lane (every other lane against blasts), each where its footprint
// fits.
function basicCells (run, party, L) {
  const s = run.state
  const cols = blasts(currentNode(run).foes) ? SPREAD : CENTRE_OUT
  const placed = byRows(party.filter((u) => !isMonarch(u) && u.hp > 0).sort(L.wounds ? byFieldPower : byPower).map((u) => ({ ...u, slot: -1 })), cols, s.camp, seated(s.camp))
  const at = new Map(placed.map((u) => [u.uid, u.slot]))
  return party.map((u) => ({ ...u, slot: isMonarch(u) ? monarchSlot(s.camp) : at.get(u.uid) ?? -1 }))
}

const hpPct = (u) => u.hp / u.maxHp
const partyHealth = (party) => party.reduce((n, u) => n + hpPct(u), 0) / party.length
const byPower = (a, b) => worth(b) - worth(a) || a.uid - b.uid
// An expert counts wounds: a soul at 10% HP is not worth fielding at full price.
export const byFieldPower = (a, b) => fieldPower(b) - fieldPower(a) || a.uid - b.uid

// Rough fighting worth from its stats, track tiers and the relics it holds included (`mods`: a foe's, its floor's):
// how long it lasts times how hard it hits (and how far it goes in a turn), square-rooted, and as much again for each
// summon its tiers bring, at the root of the share of HP a summon rises with (unless `summons` is false: the summons
// ablation's). A tier that grants an ability, an aura or a Colossus's footprint counts a share more, and each relic it
// holds a share more besides its mods (what its triggers and rules are worth no static read can tell):
// TUNING.expert.growth.worth. 0 for the fallen, and for the Monarch, which never strikes.
function worth (u, summons = true, mods = heldMods(u), h = TUNING.expert.growth.worth.hits, w = TUNING.expert.growth.worth) {
  if (u.hp <= 0 || isMonarch(u)) return 0
  const s = statsOf(u, mods)
  const lasts = s.hp * (1 + s.def / 100) / s.damage.taken
  const hits = s.atk * s.damage.dealt * (1 + w.move * s.move) + w.mend * mendOut(u, s)
  const signature = tiersOf(u).filter((t) => t.ability || t.aura || t.size).length
  return lasts ** (1 - h) * hits ** h * (1 + w.signature * signature) * (1 + w.relic * (u.relics?.length ?? 0)) *
    (1 + (summons ? summonsOf(u) * Math.sqrt(TUNING.summon.hp) : 0))
}
const fieldPower = (u) => worth(u) * Math.sqrt(hpPct(u))
// What a soul mends a turn (worth's `mend`): its best heal of others, each heal effect's HP and each ward it lays (its
// STATUS_WORTH, a Regen's among them), by its ATK and healing given as a heal lands.
const mendOut = (u, s) => Math.max(0, ...kitOf(u).filter((a) => isAllyShape(a.shape) && a.effects.some((e) => e.op === 'heal' && !e.self))
  .map((a) => a.effects.reduce((n, e) => n + (e.op === 'heal' && !e.self ? e.power : e.op === 'apply_status' ? STATUS_WORTH[e.status] ?? 0 : 0), 0))) *
  s.atk / TUNING.damage.atkDivisor * s.heal.given

// A copy of the run to weigh a choice on (the growth search's): the state cloned, no battle.
const fork = (run) => ({ state: structuredClone(run.state), battle: null, setup: null })

// What a retinue brings to its next fight: the fieldable pieces' wounded power (their summons and the relics they hold
// counted: a kin banner's mods on the souls it names, a trigger by what it brings: relicReads) and the shadows the
// Arise holders among them would raise (ariseWorth, a share of their worth: TUNING.expert.growth.raise), raised by each
// run relic as worth raises a piece by one it holds (a piece relic works only through its holder), but a kin banner,
// read on its kin alone (bought on that share, 17 of the first 21 went to armies another kin led: redesign.md §8).
function strength (s, summons = true) {
  const read = relicReads(s)
  const best = souls(s.party).map((u) => ({ u, p: read(u, (mods) => worth(u, summons, mods)) * Math.sqrt(hpPct(u)) })).sort((a, b) => b.p - a.p).slice(0, fieldCap({ state: s }))
  const raised = TUNING.expert.growth.raise.share * ariseWorth(s, best.filter((x) => x.p > 0).map((x) => x.u))
  return (best.reduce((n, x) => n + x.p, 0) + raised) * (1 + TUNING.expert.growth.worth.relic * s.relics.filter((id) => isRunRelic(id) && !isBanner(id)).length) || 1
}

// ── the relics a soul fights with, read (redesign.md §4.4; the sketch's and the book's) ───────────

// The run relics' mods on a unit's path scoped to a kin or a role (`who`: a kin banner's), a copy each: what they put on
// the souls they name, as statsOf reads `who` in battle (unit.js matches). A side-wide cost goes unread, as before.
const scopedMods = (s) => s.relics.filter(isRunRelic).flatMap((id) => (relicDef(id).mods ?? []).filter((m) => m.who && !isRunPath(m.path)))
// Whether run relic `id` is a kin banner: every mod of it scoped to a kin or a role.
const isBanner = (id) => !!relicDef(id).mods?.length && relicDef(id).mods.every((m) => m.who)
// What the relics at work make of soul `u` in state `s`: `of(mods)`, its worth on its held relics' mods and the banners'
// (scopedMods), a share more for each trigger it holds (triggerShare), and for skills that come back sooner (a
// `cooldown.rate` past 1, which worth does not read: the Gossamer Standard's), a cooldown a turn sooner each blow, as
// Quicksilver's is read. → (u, of) → its worth so read
function relicReads (s) {
  const banners = scopedMods(s)
  return (u, of) => {
    const mods = banners.length ? [...heldMods(u), ...banners] : heldMods(u)
    const st = banners.length ? statsOf(u, mods) : null
    const sooner = st ? Math.max(0, st.cooldown.rate - 1) * STATUS_WORTH.hasten * paid('status') * MOMENTS.blow / st.hp : 0
    return of(mods) * (1 + sooner + (u.relics ?? []).reduce((n, id) => n + (relicDef(id).on ? triggerShare(s, u, relicDef(id)) : 0), 0))
  }
}
// The moments a battle a fielded piece of the expert's meets, by trigger (content.js TRIGGERS), and how many of yours or
// theirs an effect about a place touches when it fires: measured on its battles, not searched (2026-10-15, the content of
// e6266bb: 170 battles of seeds `mom-0…5`, a piece's blows, the blows that landed on it and left it standing, its kills,
// its falls, the waves it stood through; with Rally Horn and Hunter's Mark given to every fielded soul, yours within 2 of
// a holder as it strikes, the Monarch and itself among them, and theirs within 1 of a slain foe).
const MOMENTS = { blow: 3.2, kill: 2.4, struck: 0.8, wave: 1.4, fall: 0.01 }
const AROUND = { allies: 3.4, foes: 1.7 }
// What the battle's weights pay for an HP of each (TUNING.expert.battle.option: a status's STATUS_WORTH, an HP mended, a
// shadow's max HP), in HP of damage.
const paid = (what) => TUNING.expert.battle.option[what] / TUNING.expert.battle.option.damage
// What piece relic `r`'s trigger brings holder `u` a battle, as a share of its max HP: each effect's worth where it lands,
// in HP of damage as the battle's weights pay for it (paid: a status its STATUS_WORTH a stack; a heal what it mends,
// its share of the holder's max HP or its power at the holder's ATK; damage its flat amount or its power at the holder's
// ATK; skills a turn sooner, Hasten's worth; a raise the max HP of the shadow it lifts: raiseHp), on whom it lands (one,
// or AROUND), as often as its moment comes (MOMENTS).
function triggerShare (s, u, r) {
  const st = statsOf(u, heldMods(u))
  const hit = (power) => power * st.atk / TUNING.damage.atkDivisor
  let hp = 0
  for (const e of r.effects) {
    const each = e.op === 'apply_status' ? (STATUS_WORTH[e.status] ?? 0) * paid('status')
      : e.op === 'heal' ? (e.pct ? e.pct * st.hp : hit(e.power) * st.heal.given) * paid('mend')
        : e.op === 'damage' ? e.amount ?? hit(e.power)
          : e.op === 'cooldown' ? Math.max(0, -e.amount) * STATUS_WORTH.hasten * paid('status')
            : e.op === 'raise' ? raiseHp(s.floor, e.tier ?? TUNING.arise.tier, u.lvl) * paid('shadow') : 0
    hp += each * (AROUND[e.to] ?? 1)
  }
  return hp * (MOMENTS[r.on] ?? 0) / st.hp
}
// What a slain foe of a floor's fights yields a raise to `tier` (redesign.md §4.4: a raise read as a shadow's HP): the
// max HP of a shadow of its kind at level `lvl` where its tier is no higher, else none, over the floor's draws
// (run.js spawnPool).
const raises = new Map()
function raiseHp (floor, tier, lvl) {
  const key = `${floor}|${tier}|${lvl}`
  if (!raises.has(key)) {
    const pool = spawnPool(floor)
    const all = pool.weights.reduce((n, w) => n + w, 0)
    raises.set(key, pool.units.reduce((n, d, i) => n + (d.tier <= tier ? pool.weights[i] * baseStats(d.id, lvl).hp : 0), 0) / all)
  }
  return raises.get(key)
}

// ── Arise's worth, read from the roads (redesign.md §2.15, §2.17) ────────────────────────────────

// Arise as soul `u` holds it, out of battle: the run's reach and tier (run.js ariseOf), what the rules granting it add
// (Court of Bone's tiles) and the corpses it raises a turn (Blood Tithe's `count`, else 1), as turns.js ariseOf and
// rules.js read them in battle. Null for a soul holding no Arise relic, and for every soul under the 'arise' rules switch.
function ariseIn (s, u) {
  const grants = ariseGrants(u)
  if (!grants.length || s.ablate?.includes('arise')) return null
  const a = ariseOf(s)
  const sum = (k) => grants.reduce((n, r) => n + (r.params[k] ?? 0), 0)
  return { domain: a.domain + sum('domain'), tier: a.tier + sum('tier'), count: Math.max(1, ...grants.map((r) => r.params.count ?? 1)) }
}

// The share of a scouted foe's road (scoutAt) where it may fall within `domain` tiles of `tiles`: each tile of its road
// but the seat weighed as threatOf weighs it, (1 + its road distance)^−1, the nearer the seat (where the fighting
// gathers) the more.
function fallShare (road, tiles, domain) {
  let all = 0
  let near = 0
  for (let i = 0; i < road.length - 1; i++) {
    const w = 1 / (road.length - i)
    all += w
    if (tiles.some((x) => distance(road[i], x) <= domain)) near += w
  }
  return all ? near / all : 0
}

// What the Arise holders among `pieces` (the souls strength counts) would raise a battle, in worth, with no battle
// played: each battle room of the floor from where the run stands on (the map scouts every room), each of its foes but
// a boss, of a tier a holder's Arise allows, rising with the share of its road within that holder's reach of where it
// stands (fallShare: from its cell, or the seat's for one in the ossuary; the best holder's), at its worth at its level
// (worth); a room's shadows no more than the holders' raises a battle (each its corpses a turn ×
// TUNING.expert.growth.raise.turns), its worth cut in proportion; the mean over the rooms. 0 with no holder.
function ariseWorth (s, pieces) {
  const holders = []
  for (const u of pieces) {
    const a = ariseIn(s, u)
    if (a) holders.push({ ...a, tiles: u.slot >= 0 ? tilesAt(u, u.slot) : [deployTile('party', monarchSlot(s.camp))] })
  }
  if (!holders.length || !s.map) return 0
  const rank = nodeOf(s.map, s.at)?.rank ?? 0
  const rooms = s.map.nodes.filter((n) => n.foes && n.rank >= rank)
  if (!rooms.length) return 0
  const cap = holders.reduce((n, h) => n + h.count, 0) * TUNING.expert.growth.raise.turns
  let total = 0
  for (const n of rooms) {
    let shadows = 0
    let worthOf = 0
    for (const f of scoutAt(s, n)) {
      if (f.boss) continue
      const p = Math.max(0, ...holders.filter((h) => f.tier <= h.tier).map((h) => fallShare(f.road, h.tiles, h.domain)))
      if (!p) continue
      shadows += p
      worthOf += p * shadowWorth(f.id, f.lvl)
    }
    total += shadows > cap ? worthOf * cap / shadows : worthOf
  }
  return total / rooms.length
}
// A shadow's worth: its kind's at the corpse's level, on your side (worth).
const shadowWorths = new Map()
function shadowWorth (id, lvl) {
  const key = `${id}|${lvl}`
  if (!shadowWorths.has(key)) shadowWorths.set(key, worth(makeUnit(id, { lvl })))
  return shadowWorths.get(key)
}

// ── the survey: what the expert reads of the run (redesign.md §2.17) ─────────────────────────────

// What the expert reads of the run before a decision out of battle, once a decision (policy): what the map, the field,
// the ossuary, the purse, the Shop and the bestiary show a player, and the combo book; never a room's battle played.
//   floor, rank, phase       where the run stands
//   purse, prices            its essence, and the cheapest next tier of a kind it holds (`tier`), recruit on offer
//                            (`recruit`) and relic of the floor (`relic`): null where there is none
//   health, fallen, monarch  its souls' HP over their max (the fallen's none), how many lie fallen, and the share of the
//                            Monarch's HP it has (its wounds carried from battle to battle: the route's tree reads it,
//                            redesign.md §2.18 C); `unhealed`: nothing may heal the Monarch (Court of Bone)
//   strength                 the field's (strength)
//   command, fielded, waiting  the field cap, the standing souls fielded, and those waiting in the ossuary
//   target                   the combo it plays toward ({ id, progress, missing: kinds still short }), null for none
//   relics                   `unheld`: the piece relics waiting; `free`: standing souls with room to hold one
//   rooms                    each room it may walk into next: { id, type, threat (its scouted foes' worth), threats
//                            (their types), unanswered (those the army has no answer to: ANSWERS), want (its foes of the
//                            target's kinds), ahead ({ shop, altar }: rooms to the nearest on a route through it, null
//                            for none) }
export function survey (run, L = LEVELS.expert) {
  const s = run.state
  const all = souls(s.party)
  const up = standing(all)
  const target = L.book ? targetOf(s) : null
  const keeps = targetKinds(target)
  const common = RELIC_LIST.find((r) => r.tier === 'common')
  const tiers = heldKinds(s).flatMap((kind) => [0, 1].filter((t) => canAdvance(s, kind, t)).map((t) => tierCost(run, kind, t)))
  const m = monarchOf(s)
  return {
    floor: s.floor,
    rank: currentNode(run)?.rank ?? 0,
    phase: s.phase,
    purse: s.essence,
    prices: {
      tier: tiers.length ? Math.min(...tiers) : null,
      recruit: s.offers?.length ? Math.min(...s.offers.map((o) => o.cost)) : null,
      relic: common ? relicPrice(run, common.id) : null
    },
    health: all.reduce((n, u) => n + Math.max(0, u.hp), 0) / Math.max(1, all.reduce((n, u) => n + u.maxHp, 0)),
    fallen: all.length - up.length,
    monarch: m.hp / m.maxHp,
    unhealed: unhealed(s),
    strength: strength(s, L.ablate !== 'summons'),
    command: fieldCap(run),
    fielded: fielded(up).length,
    waiting: inOssuary(up).length,
    target: target && { id: target.id, progress: comboProgress(s, target), missing: Object.entries(target.needs).filter(([id, n]) => up.filter((u) => u.id === id).length < n).map(([id]) => id) },
    relics: { unheld: unheld(s).filter((id) => !isRunRelic(id)), free: up.filter((u) => (u.relics?.length ?? 0) < TUNING.relic.perPiece).length },
    rooms: s.phase === 'map' ? availableNodes(run).map((n) => scoutRoom(run, n, up, keeps)) : []
  }
}

// A room the run may walk into, as the survey reads it (scouting shows its foes; the map, where the routes go).
function scoutRoom (run, n, up, keeps) {
  const s = run.state
  const foes = [...(n.foes ?? []), ...(n.waves ?? []).flatMap((w) => w.foes)]
  const mods = foeMods(s.floor, n.type === 'boss', s.scale)
  const threats = n.foes ? [...roomThreats(n)] : []
  return {
    id: n.id,
    type: n.type,
    threat: foes.reduce((t, f) => t + worth(makeUnit(f.id, { lvl: f.lvl }), false, mods), 0),
    threats,
    unanswered: threats.filter((t) => ANSWERS[t] && !up.some(ANSWERS[t])),
    want: foes.filter((f) => keeps.has(f.id)).length,
    ahead: { shop: roomsTo(s.map, n.id, 'shop'), altar: roomsTo(s.map, n.id, 'altar') }
  }
}

// The army's answers to a room's threat types (content.js THREATS), by what a standing soul can do: Fly by a blow that
// reaches a flyer (a ranged one, or a flyer's own), Reach by a ranged blow, Drain, Burn and Bleed by a heal of others or
// a cleanse. Shape, Sustain and Depth are met by numbers alone, so the survey counts no answer short for them.
const kitOf = (u) => abilitiesOf(u).map(abilityDef)
const tends = (u) => kitOf(u).some((a) => isAllyShape(a.shape) && a.effects.some((e) => (e.op === 'heal' && !e.self) || e.op === 'cleanse'))
const ANSWERS = {
  fly: (u) => kitOf(u).some((a) => isBlow(a) && (!a.melee || !!unitDef(u.id).flies)),
  reach: (u) => kitOf(u).some((a) => isBlow(a) && !a.melee),
  drain: tends,
  burn: tends,
  bleed: tends
}

// How many rooms on from room `from` the nearest room of `type` lies on a route through it (1: the next), null for
// none on the floor.
function roomsTo (map, from, type) {
  const seen = new Set([from])
  let edge = [from]
  for (let d = 1; edge.length; d++) {
    const next = []
    for (const id of edge) {
      for (const n of nodeOf(map, id).next) {
        if (seen.has(n)) continue
        if (nodeOf(map, n).type === type) return d
        seen.add(n)
        next.push(n)
      }
    }
    edge = next
  }
  return null
}

// ── map: the route ───────────────────────────────────────────────────────────────────────────────

function pickNode (run, rng, L, sit) {
  const spend = pickSpend(run, L, sit)
  if (spend) return spend
  const nodes = availableNodes(run)
  if (L.route && nodes.length > 1) return { type: 'node', id: pickRoute(run, sit) }
  const health = partyHealth(run.state.party)
  const w = { fight: 3, elite: health > 0.7 ? 1.5 : 0.3, shop: 2, altar: health < 0.6 ? 5 : 0.5, boss: 1, siege: health > 0.7 ? 1.5 : 0.3 }
  return { type: 'node', id: rng.weighted(nodes, nodes.map((n) => w[n.type])).id }
}

// The expert's next room: each room it may walk into, read against the survey (roomFeatures), decided by the tree's
// rules (TREES.route: a badly wounded army takes an altar, and walks into no elite) and then the weights
// (TUNING.expert.route). No route is walked ahead and no room's battle played: a room is what scouting shows of it.
// → the room's id.
export function pickRoute (run, sit = survey(run)) {
  const model = routeModel()
  if (model) {
    const pick = learnedRoute(model, run, sit)
    noteRule(run, 'route', pick, surveyLine(sit))
    return pick.option.node.id
  }
  const rooms = sit.rooms.map((room) => ({ node: nodeOf(run.state.map, room.id), v: roomFeatures(sit, room) }))
  const pick = decide(TREES.route, sit, rooms, TUNING.expert.route)
  noteRule(run, 'route', pick, surveyLine(sit))
  return pick.option.node.id
}

// ── the learned route (redesign.md §2.22: the route by the same machinery) ──────────────────────

// The route's model tree (src/sim/expert.json's `route`, fitted offline from room choices played out: teach.js --route): its
// splits on the run's situation (routeConditions), each leaf its weights over a room's features (routeFeatures), the
// best-scoring room taken; no hard rule unless the model keeps TREES.route's (`hand`). Read where ROUTE_LEARNED is on and
// the shipped expert has a route (Node only), else the hand-built route above; useRoute installs another (a test's, a measurement's).
// On (2026-10-12): route.json gained +5.4 ± 1.9 clears over 1024 paired seeds `sim` under the scorer of 2026-10-11
// (redesign.md §6 "The learned route"), and again with the forest playing the battles (§2.24): on 768 seeds `chk5`,
// 33.1% clears against the hand-built route's 29.0% (+146 −115), progress +1.43 ± 1.56, 5.3 s a run against 4.1 (it
// fights more battles). The hand-built route's tests (planning.test.js, puzzles.test.js: its rules' audit names, a Shop
// with a full purse) walk it by withRoute('hand').
export const ROUTE_LEARNED = true
let ROUTE_MODEL
// The shipped expert's route (expert.js shippedPart: src/sim/expert.json's `route`), null where it ships none.
const shippedRoute = () => shippedPart('route')
export function routeModel () {
  if (ROUTE_MODEL !== undefined) return ROUTE_MODEL
  ROUTE_MODEL = null
  if (!ROUTE_LEARNED) return null
  const json = shippedRoute()
  ROUTE_MODEL = json ? checkModel(json) : null
  return ROUTE_MODEL
}
// Installs route configuration `model` (false: the hand-built route; undefined: back to the shipped expert's). → the one
// in use.
export function useRoute (model) {
  ROUTE_MODEL = model === undefined ? undefined : model ? checkModel(model) : null
  return routeModel()
}

// One room choice by route model `model`: its leaf by the run's situation, each room scored by the leaf's weights over
// its features (a feature the leaf has no weight for counts 0), the first best taken; where the model keeps the hand-built
// route's rules (`hand`), they first force or filter the rooms as TREES.route does (expert.js decide). → { option: { node,
// v, score }, by (the rule that decided, else 'route <leaf>'), path }
export function learnedRoute (model, run, sit = survey(run)) {
  const r = leafOf(model, routeConditions(run, sit))
  const w = Object.fromEntries(ROUTE_FEATURES.map((k) => [k, r.w[k] ?? 0]))
  const rooms = sit.rooms.map((room) => ({ node: nodeOf(run.state.map, room.id), v: routeFeatures(run, sit, room) }))
  const pick = decide(model.hand ? TREES.route : [], sit, rooms, w)
  return { option: pick.option, by: pick.by === 'weights' ? `route ${r.leaf.leaf}` : pick.by, path: pathName(r) }
}

// The essence a tier costs on the run's floor, on the mean of the tiers' prices (TUNING.essence.tier × run.js
// floorPrice): the unit the route reads a purse and a room's pay in.
export const tierScale = (floor) => TUNING.essence.tier.reduce((n, x) => n + x, 0) / TUNING.essence.tier.length * floorPrice(floor)
const THREAT_TYPES = ['reach', 'shape', 'drain', 'sustain', 'fly', 'burn', 'bleed', 'depth']

// The run's situation a room choice is read in, as named numbers (the route tree's conditions; add, never rename):
// where the run stands (floor, rank), the army (its strength as a log, the souls standing, fielded and waiting, the
// fallen, the Command, the share of the souls' HP it has), the Monarch (the share of its HP it has and its HP, whether
// anything may heal it), the purse (in tier prices and in the floor's cheapest relic's), the relics owned, the combo
// it plays toward (how far along), and the rooms open (how many, whether an elite, an altar or a Shop is among them,
// and the army's odds against the elite open, the worst and the best battle room open: autoplay.js roomFeatures' odds).
export function routeConditions (run, sit = survey(run)) {
  const s = run.state
  const m = monarchOf(s)
  const odds = sit.rooms.filter((r) => r.threat > 0 && r.type !== 'shop' && r.type !== 'altar').map((r) => ({ type: r.type, odds: Math.log(sit.strength / r.threat) }))
  const elite = odds.find((x) => x.type === 'elite')
  return {
    floor: sit.floor,
    rank: sit.rank,
    strength: Math.log(sit.strength),
    souls: sit.fielded + sit.waiting,
    fielded: sit.fielded,
    waiting: sit.waiting,
    fallen: sit.fallen,
    command: sit.command,
    health: sit.health,
    monarch: sit.monarch,
    'monarch.hp': Math.max(0, m.hp),
    unhealed: sit.unhealed ? 1 : 0,
    purse: sit.purse / tierScale(sit.floor),
    'purse.relic': sit.prices.relic ? sit.purse / sit.prices.relic : 0,
    relics: s.relics.length,
    progress: sit.target?.progress ?? 0,
    rooms: sit.rooms.length,
    'open.elite': sit.rooms.some((r) => r.type === 'elite') ? 1 : 0,
    'open.altar': sit.rooms.some((r) => r.type === 'altar') ? 1 : 0,
    'open.shop': sit.rooms.some((r) => r.type === 'shop') ? 1 : 0,
    'odds.elite': elite ? elite.odds : 0,
    'odds.min': odds.length ? Math.min(...odds.map((x) => x.odds)) : 0,
    'odds.max': odds.length ? Math.max(...odds.map((x) => x.odds)) : 0
  }
}

// A room read for the learned route: the hand-built route's features (roomFeatures), and for a battle room what
// scouting shows of it besides: its foes (how many, the highest tier and the mean, the mean level), its waves after the
// first (a floor-1 elite's late pair among them: `late`), each threat type it carries (`t.<type>`, content.js
// THREATS), what it pays (its foes' essence and an elite's bonus, the relics' gain counted, in tier prices:
// tierScale), whether it is a battle the hand-built route calls long odds (`long`: its odds below
// TUNING.expert.tree.odds), and the army's wounds and the Monarch's against a battle (`hurt`: the share of the
// Monarch's HP it lacks, `worn`: of the souls', each where the room is a battle, else 0).
export const ROUTE_FEATURES = Object.freeze([
  'fight', 'elite', 'shop', 'altar', 'boss', 'siege', 'odds', 'weak', 'wounds', 'monarch', 'purse', 'want', 'unanswered', 'altarAhead', 'monarchAhead',
  'shopAhead', 'foes', 'tier', 'tierMean', 'lvl', 'waves', 'late', ...THREAT_TYPES.map((t) => `t.${t}`), 'pay', 'long', 'hurt', 'worn'
])
export function routeFeatures (run, sit, room) {
  const s = run.state
  const v = roomFeatures(sit, room)
  const out = { ...v, foes: 0, tier: 0, tierMean: 0, lvl: 0, waves: 0, late: 0 }
  for (const t of THREAT_TYPES) out[`t.${t}`] = 0
  Object.assign(out, { pay: 0, long: 0, hurt: 0, worn: 0 })
  const node = nodeOf(s.map, room.id)
  if (!node?.foes) return out
  const foes = [...node.foes, ...(node.waves ?? []).flatMap((w) => w.foes)]
  const tiers = foes.map((f) => unitDef(f.id).tier)
  out.foes = foes.length
  out.tier = Math.max(0, ...tiers)
  out.tierMean = tiers.length ? tiers.reduce((n, x) => n + x, 0) / tiers.length : 0
  out.lvl = foes.length ? foes.reduce((n, f) => n + f.lvl, 0) / foes.length : 0
  out.waves = node.waves?.length ?? 0
  out.late = node.type === 'elite' && s.floor === 1 && out.waves > 0 ? 1 : 0
  for (const t of room.threats) if (THREAT_TYPES.includes(t)) out[`t.${t}`] = 1
  const pay = foes.reduce((n, f) => n + foeEssence(f), 0) + (node.type === 'elite' ? eliteBonus(s.floor) : 0)
  out.pay = pay * runStat(s, 'essence.gain', 1) / tierScale(s.floor)
  const battle = room.threat > 0 && room.type !== 'shop' && room.type !== 'altar'
  out.long = battle && v.odds < TUNING.expert.tree.odds ? 1 : 0
  out.hurt = battle ? 1 - sit.monarch : 0
  out.worn = battle ? 1 - sit.health : 0
  return out
}

// A room read as the features its decision weighs (TUNING.expert.route): its type, one of six; for a battle room the
// odds (the log of the army's strength over the room's scouted threat; `weak` where the room is the stronger), its foes
// of the target's kinds (`want`) and its threat types the army has no answer to (`unanswered`); for an altar the souls'
// wounds and the Monarch's (none while nothing may heal it); for a Shop the purse over the floor's cheapest relic, up
// to 3; and an altar or a Shop on a route through it (`altarAhead`, `shopAhead`), the nearer the more, an altar by the
// souls' wounds and by the Monarch's (`monarchAhead`, none while nothing may heal it: redesign.md §2.18 C).
export function roomFeatures (sit, room) {
  const fights = room.threat > 0 && room.type !== 'shop' && room.type !== 'altar'
  const odds = fights ? Math.log(sit.strength / room.threat) : 0
  const purse = sit.prices.relic ? Math.min(3, sit.purse / sit.prices.relic) : 0
  const v = { fight: 0, elite: 0, shop: 0, altar: 0, boss: 0, siege: 0 }
  v[room.type] = 1
  return {
    ...v,
    odds,
    weak: Math.max(0, -odds),
    wounds: room.type === 'altar' ? 1 - sit.health : 0,
    monarch: room.type === 'altar' && !sit.unhealed ? 1 - sit.monarch : 0,
    purse: room.type === 'shop' ? purse : 0,
    want: room.want,
    unanswered: room.unanswered.length,
    altarAhead: room.ahead.altar === null ? 0 : (1 - sit.health) / (1 + room.ahead.altar),
    monarchAhead: room.ahead.altar === null || sit.unhealed ? 0 : (1 - sit.monarch) / (1 + room.ahead.altar),
    shopAhead: room.ahead.shop === null ? 0 : purse / (1 + room.ahead.shop)
  }
}

// ── prep: the formation ──────────────────────────────────────────────────────────────────────────────

// The autoplayer arranges its souls with the same choice a player has: any camp cell where a piece's footprint
// fits (unit.js fits: a 2×2 piece needs its four cells open), the Monarch on its seat (the camp's: it never
// moves). Basic takes its first draft, its rule of thumb; the expert drafts a few and decides between them, and
// between them and the formations a hill-climb finds from the best, by a static read of the scouted room
// (formationFeatures; plan). Basic's three drafts:
//   rows       each role's row (ROW), packed from the middle lane (auras want neighbours)
//   spread     each role's row, every other lane first (against area attacks)
//   sheltered  the melee where foes walking in arrive first; ranged souls behind the walls, where foes
//              must walk furthest to reach them for how close they stand
// The expert (`more`) reads the placement as the puzzle it is. Every foe keeps to its road to the seat, and a piece
// of yours strikes what it reaches once it has moved, so the fighting is where the foes' roads run within your pieces'
// Move and reach, most of it where the roads meet at the seat. The scouted room's roads (scout: each foe's, from where
// it stands or enters to the seat) become a threat map (threatOf: each road tile, the nearer the seat the more), a cell
// is worth to a piece what of that it covers from there (coverage: as the danger map counts a piece of yours, every
// tile its Move takes it to and its blows' reach from each, the air only for a blow that strikes a flyer), and its
// drafts are filled greedily from that (zone): at a few radii about the seat, the coverage shared out or bunched; with
// its gate held where the camp has one (gated: the fewest cells every drawn ground road crosses, so every ground foe's
// road runs into a piece that blocks it there). A piece that fits nowhere waits in the ossuary (slot −1).

const SPREAD = [3, 1, 5, 2, 4, 0, 6]
const blasts = (foes) => foes.some((f) => unitDef(f.id).abilities.some((id) => abilityDef(id).shape === 'blast'))
// Each role's row in a drafted formation (0 the camp's front): the vanguard ahead, the ranged behind.
const ROW = { vanguard: 0, skirmisher: 1, warden: 1, trickster: 1, ranger: 2, channeler: 2 }
const rowFor = (u) => ROW[unitDef(u.id).role] ?? 1

// The cells the Monarch holds before anything is placed: its seat.
const seated = (camp) => new Set([monarchSlot(camp)])
// The camp's open cells.
const openCells = (camp) => [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(camp, slot))
// The board tiles a piece anchored on `slot` stands on.
const tilesAt = (u, slot) => (footprintSlots(slot, sizeOf(u)) ?? [slot]).map((c) => deployTile('party', c))

// Whether a formation is one the run can field: the Monarch on its seat, every other fielded piece where its
// footprint fits (fits: open camp cells, never the seat), none on another's cells.
function legal (out, camp) {
  const taken = new Set()
  for (const u of out) {
    if (isMonarch(u)) {
      if (u.slot !== monarchSlot(camp)) return false
      continue
    }
    if (u.slot < 0) continue
    if (!fits(camp, u.slot, sizeOf(u), taken)) return false
    for (const c of cellsOf(u)) taken.add(c)
  }
  return true
}

// Keep units already where their footprint fits past `taken` (a Set of cells, claimed as they go); place the rest,
// the 2×2 first (they need the room), in the first cell they fit of their role's row (rowFor, an anchor's row),
// spilling to the nearest rows, columns in `cols` order; −1 where none is left. Mutates and returns units.
function byRows (units, cols, camp, taken) {
  const rest = []
  for (const u of units) {
    if (u.slot >= 0 && fits(camp, u.slot, sizeOf(u), taken)) cellsOf(u).forEach((c) => taken.add(c))
    else rest.push(u)
  }
  const rows = [...Array(CAMP_ROWS).keys()]
  for (const u of rest.slice().sort((a, b) => sizeOf(b) - sizeOf(a))) {
    const pref = rowFor(u)
    u.slot = -1
    for (const row of rows.slice().sort((a, b) => Math.abs(a - pref) - Math.abs(b - pref) || a - b)) {
      const c = cols.find((c) => fits(camp, slotAt(row, c), sizeOf(u), taken))
      if (c === undefined) continue
      u.slot = slotAt(row, c)
      cellsOf(u).forEach((x) => taken.add(x))
      break
    }
  }
  return units
}

// How many steps a foe needs from the open ground above the camp to each camp cell, around its walls.
function walkIn (camp) {
  const walls = new Set(wallTiles(camp))
  const dist = new Array(TILES).fill(Infinity)
  const queue = []
  for (let x = 0; x < LANES; x++) queue.push(tileAt(x, CAMP_ROWS))
  for (const t of queue) dist[t] = 0
  for (let i = 0; i < queue.length; i++) {
    for (const n of steps(queue[i], walls)) {
      if (dist[n] === Infinity) { dist[n] = dist[queue[i]] + 1; queue.push(n) }
    }
  }
  return (slot) => dist[deployTile('party', slot)]
}

// Each in turn, the melee first, on the free cell its footprint fits that scores best: for the melee the fewest
// steps in, for the ranged the most steps in for how far forward they stand.
function sheltered (units, camp, taken) {
  const walk = walkIn(camp)
  const open = openCells(camp)
  const lane = (slot) => CENTRE_OUT.indexOf(colOf(slot))
  const order = units.slice().sort((a, b) => meleeOnly(b) - meleeOnly(a) || rowFor(a) - rowFor(b))
  for (const u of order) {
    const off = (slot) => Math.abs(rowOf(slot) - rowFor(u))
    const score = meleeOnly(u) ? (slot) => walk(slot) : (slot) => -(walk(slot) - rowOf(slot) - 1)
    const free = open.filter((slot) => fits(camp, slot, sizeOf(u), taken))
    u.slot = free.sort((a, b) => score(a) - score(b) || off(a) - off(b) || lane(a) - lane(b))[0] ?? -1
    cellsOf(u).forEach((c) => taken.add(c))
  }
  return units
}

// The expert's zone drafts: [radius about the seat (Chebyshev, from a footprint's nearest tile), how much of a tile's
// threat stays once a piece reaches it (1: bunched, every piece on the busiest tiles; less: shared out over the
// roads), how steeply the threat grows toward the seat].
const ZONES = [[2, 1, 1], [Infinity, 0.5, 0.5], [1, 1, 2], [3, 0.5, 1]]

// The formations L drafts for these units (`want`, in fielding order), each with the Monarch on its seat first: the
// expert's the plan's first (planDraft), then its zone drafts, its gate held, and basic's three.
export function drafts (run, want, L) {
  const s = run.state
  const m = { ...monarchOf(s), slot: monarchSlot(s.camp) }
  const blank = () => want.map((u) => ({ ...u, slot: -1 }))
  const lanes = blasts(currentNode(run).foes) ? [SPREAD, CENTRE_OUT] : [CENTRE_OUT, SPREAD]
  const rows = (cols) => [{ ...m }, ...byRows(blank(), cols, s.camp, seated(s.camp))]
  const basic = [rows(lanes[0]), rows(lanes[1]), [{ ...m }, ...sheltered(blank(), s.camp, seated(s.camp))]]
  if (!L.more) return basic
  const gate = gated(blank(), s.camp, threatOf(run))
  return [
    [{ ...m }, ...planDraft(run, blank(), rows(lanes[0]))],
    ...ZONES.map(([radius, keep, steep]) => [{ ...m }, ...zone(blank(), s.camp, threatOf(run, steep), { radius, keep })]),
    ...(gate ? [[{ ...m }, ...gate]] : []), ...basic
  ]
}

// The plan's draft (redesign.md §2.18: where you deploy and where you move are one idea): the target formation the
// first turn's plan would walk to (plan.js deployment), read on the board as the room would set it up from `start` (a
// draft that fields these units: who stands is all it reads), no turn played and no summons called; each piece it
// gives a slot on its tile where its footprint fits the camp (the seat aside), the rest as the threat map's zone draft
// fills them. Mutates and returns units.
function planDraft (run, units, start) {
  const s = run.state
  const setup = battleSetup(run, { party: start.filter((u) => u.slot >= 0) })
  const b = createBattle({ ...setup, ablate: [...(setup.ablate ?? []), 'summons'], quiet: true })
  const within = new Set(openCells(s.camp).filter((c) => c !== monarchSlot(s.camp)).map((c) => deployTile('party', c)))
  const at = b.over ? new Map() : deployment(b, situation(b), within)
  const taken = seated(s.camp)
  for (const u of units) {
    const t = at.get(u.uid)
    if (t === undefined) continue
    const slot = slotAt(CAMP_ROWS - 1 - tileY(t), tileX(t))
    if (!fits(s.camp, slot, sizeOf(u), taken)) continue
    u.slot = slot
    cellsOf(u).forEach((c) => taken.add(c))
  }
  return zone(units, s.camp, threatOf(run), { taken })
}

// The scouted room's foes and their roads (made once a room; no battle is set up or played): each foe of the opening
// formation and of every wave, the road it will walk to the Monarch's seat from where it stands or enters (field.js
// roadsTo: a ground foe's the camp's Walk field, a flyer's the air road; a wave's foe enters at the top edge in its
// lane, as turns.js entryTile puts it), and what it strikes with (its hardest blow, raw, its floor's mods counted; how
// far its blows reach a piece on the ground, and one in the air, −1 for none). → [{ flies, road: [tile, …, the seat],
// raw, reach, air, hp, id, lvl, tier, boss }]
const scouts = new Map()
const scout = (run) => scoutAt(run.state, currentNode(run))
// The same for any battle room `node` of the run's floor (ariseWorth's). Each foe carries its kind, level and tier too.
function scoutAt (s, node) {
  const key = JSON.stringify([s.camp, s.floor, node.id, node.type, node.foes, node.waves?.map((w) => w.foes), s.scale])
  if (scouts.has(key)) return scouts.get(key)
  const roads = roadsTo(s.camp)
  const mods = foeMods(s.floor, node.type === 'boss', s.scale)
  const out = []
  for (const [k, foes] of [node.foes ?? [], ...(node.waves ?? []).map((w) => w.foes)].entries()) {
    for (const f of foes) {
      const u = makeUnit(f.id, { lvl: f.lvl })
      const flies = !!unitDef(f.id).flies
      const blows = kitOf(u).filter(isBlow)
      const far = (list) => Math.min(DEPTH, Math.max(-1, ...list.map((b) => blowReach(u, b))))
      const from = deployTile('foe', k ? slotAt(ROWS - 1, colOf(f.slot)) : f.slot)
      out.push({ flies, road: roadFrom(from, flies ? roads.air : roads.field), raw: punch(u, mods), reach: far(blows), air: far(blows.filter((b) => !b.melee || flies)), hp: statsOf(u, mods).hp,
        id: f.id, lvl: f.lvl, tier: unitDef(f.id).tier, boss: !!unitDef(f.id).boss })
    }
  }
  if (scouts.size > 500) scouts.clear()
  scouts.set(key, out)
  return out
}

// The scouted room as a threat map (the zone drafts' and `cover`'s): each tile of each scouted foe's road but the seat,
// taking (1 + its road distance)^−steep, once a foe: the nearer the seat, where every road ends and the fighting
// gathers, the more. → { ground, air } (a flyer's in the air), each a Float64Array by tile.
const threats = new WeakMap()
function threatOf (run, steep = 1) {
  const list = scout(run)
  const made = threats.get(list) ?? new Map()
  threats.set(list, made)
  if (made.has(steep)) return made.get(steep)
  const out = { ground: new Float64Array(TILES), air: new Float64Array(TILES) }
  for (const { road, flies } of list) {
    const to = flies ? out.air : out.ground
    for (let i = 0; i < road.length - 1; i++) to[road[i]] += 1 / (road.length - i) ** steep
  }
  made.set(steep, out)
  return out
}

// A foe's road from `t` to the root, by a field's arrows (a ground foe's the camp's roads, a flyer's the air road).
function roadFrom (t, f) {
  const out = []
  for (let n = 0; t >= 0 && n < TILES; t = f.arrow[t], n++) out.push(t)
  return out
}

// What a piece anchored on `slot` covers, as the danger map counts a piece of yours (policy.js danger): every tile its
// Move takes it to (unit.js steps, round the camp's walls, over them for a flyer; from any tile of its footprint), and
// from each, every tile its blows reach (unit.js blowReach), the air's only by a blow that strikes a flyer (a ranged
// one, or a flyer's melee). → { ground, air }: lists of tiles. Made once for each kind, level, tiers, relics held, cell
// and camp.
const covers = new Map()
function coverage (u, slot, camp) {
  const key = JSON.stringify([u.id, u.lvl, u.tracks, u.relics ?? [], slot, camp])
  if (covers.has(key)) return covers.get(key)
  const flies = !!unitDef(u.id).flies
  const walls = new Set(flies ? [] : wallTiles(camp))
  const move = Math.max(0, Math.floor(statsOf(u, heldMods(u)).move))
  const from = tilesAt(u, slot)
  const been = new Set(from)
  for (let edge = from, k = 0; k < move && edge.length; k++) {
    edge = edge.flatMap((t) => steps(t, walls)).filter((n) => !been.has(n) && (been.add(n), true))
  }
  const blows = abilitiesOf(u).map(abilityDef).filter(isBlow)
  const far = (list) => Math.min(DEPTH, Math.max(-1, ...list.map((a) => blowReach(u, a))))
  const out = { ground: dilate(been, far(blows)), air: dilate(been, far(blows.filter((a) => !a.melee || flies))) }
  if (covers.size > 50000) covers.clear()
  covers.set(key, out)
  return out
}
// Every tile within `r` of any of `tiles` (none for r < 0).
function dilate (tiles, r) {
  if (r < 0) return []
  const out = new Set()
  for (const t of tiles) {
    const x0 = tileX(t)
    const y0 = tileY(t)
    for (let y = Math.max(0, y0 - r); y <= Math.min(DEPTH - 1, y0 + r); y++) {
      for (let x = Math.max(0, x0 - r); x <= Math.min(LANES - 1, x0 + r); x++) out.add(tileAt(x, y))
    }
  }
  return [...out]
}
// How much of a threat map a coverage takes.
const covered = (c, threat) => c.ground.reduce((n, t) => n + threat.ground[t], 0) + c.air.reduce((n, t) => n + threat.air[t], 0)

// A zone draft: each piece in turn (the 2×2 first, then in fielding order) on the free cell its footprint fits
// within `radius` of the seat (anywhere, where none is left there) whose coverage of the threat is the most, nearer
// the seat on ties; each tile it covers then keeps `keep` of its threat for the pieces after it. Mutates and returns
// units.
function zone (units, camp, threat, { radius = Infinity, keep = 1, taken = seated(camp) } = {}) {
  const seat = deployTile('party', monarchSlot(camp))
  const left = { ground: threat.ground.slice(), air: threat.air.slice() }
  const near = (u, slot) => Math.min(...tilesAt(u, slot).map((t) => distance(t, seat)))
  for (const u of units.slice().sort((a, b) => sizeOf(b) - sizeOf(a))) {
    if (u.slot >= 0) continue
    const free = openCells(camp).filter((slot) => fits(camp, slot, sizeOf(u), taken))
    const inside = free.filter((slot) => near(u, slot) <= radius)
    const scored = (inside.length ? inside : free).map((slot) => ({ slot, n: covered(coverage(u, slot, camp), left), d: near(u, slot) }))
    u.slot = scored.sort((a, b) => b.n - a.n || a.d - b.d || a.slot - b.slot)[0]?.slot ?? -1
    if (u.slot < 0) continue
    cellsOf(u).forEach((c) => taken.add(c))
    if (keep < 1) {
      const c = coverage(u, u.slot, camp)
      for (const t of c.ground) left.ground[t] *= keep
      for (const t of c.air) left.air[t] *= keep
    }
  }
  return units
}

// The camp's gate (DESIGN §2.4): the fewest open cells (never the seat, at most GATE) that every drawn ground road
// crosses, so every ground foe's road runs into a piece there. The roads are the Walk field's arrows (field.js
// roadsTo's `field`), one from each tile of the foes' rows (where the opening stands and every later wave enters:
// field.js entryTile) to the seat; a piece on one blocks there each foe whose road it is, for a foe keeps to its road
// and never passes through a piece (turns.js roadAhead), so a cell no road crosses is never weighed. None of them
// beside the seat (a road step from it) if that can be had, and the furthest along the roads from it of those; none
// where it takes more than GATE. Flyers keep the air road: the gate is the ground's. Made once per camp. → [slot, …],
// [] for none.
const GATE = 3
const gates = new Map()
export function gateOf (camp) {
  if (gates.has(camp)) return gates.get(camp)
  const seat = monarchSlot(camp)
  const f = roadsTo(camp).field
  const d = (slot) => f.dist[deployTile('party', slot)]
  // Each road as the set of camp cells it crosses, the seat aside (roadFrom: the arrows to the root).
  const cellAt = new Map(openCells(camp).filter((c) => c !== seat).map((c) => [deployTile('party', c), c]))
  const roads = []
  for (let t = tileAt(0, DEPTH - ROWS); t < TILES; t++) {
    if (f.dist[t] < Infinity) roads.push(new Set(roadFrom(t, f).filter((x) => cellAt.has(x)).map((x) => cellAt.get(x))))
  }
  const crosses = (cells) => roads.length > 0 && roads.every((road) => cells.some((c) => road.has(c)))
  const sets = (cells, k, from = 0) => (k === 0 ? [[]] : cells.slice(from).flatMap((c, i) => sets(cells, k - 1, from + i + 1).map((rest) => [c, ...rest])))
  const far = (set) => set.reduce((n, c) => n + d(c), 0)
  const crossed = openCells(camp).filter((c) => roads.some((road) => road.has(c)))
  let gate = []
  for (const cells of [crossed.filter((c) => d(c) > 1), crossed]) {
    for (let k = 1; k <= GATE && !gate.length; k++) gate = sets(cells, k).sort((a, b) => far(b) - far(a)).find(crosses) ?? []
    if (gate.length) break
  }
  gates.set(camp, gate)
  return gate
}

// The gate held (gateOf): its cells each by the toughest piece left whose footprint covers it (a 2×2 piece's covers
// four cells, and a gate cell already under one is held), then every other piece as a zone draft fills it (zone, from
// the threat map). Null where the camp has no gate or the field too few pieces to hold it and fight beside it.
function gated (units, camp, threat) {
  const gate = gateOf(camp)
  if (!gate.length || units.length <= gate.length) return null
  const taken = seated(camp)
  const left = units.slice().sort((a, b) => toughness(b) - toughness(a) || a.uid - b.uid)
  for (const cell of gate) {
    if (taken.has(cell)) continue
    const anchors = (u) => (sizeOf(u) === 1 ? [cell] : [cell, cell - 1, cell + LANES, cell + LANES - 1].filter((a) => footprintSlots(a, 2)?.includes(cell)))
    const u = left.find((x) => x.slot < 0 && anchors(x).some((a) => fits(camp, a, sizeOf(x), taken)))
    if (!u) return null
    u.slot = anchors(u).find((a) => fits(camp, a, sizeOf(u), taken))
    cellsOf(u).forEach((c) => taken.add(c))
  }
  return zone(units, camp, threat, { taken })
}

// What a soul is worth on a tile it must hold: how much it takes to fell.
const toughness = (u) => {
  const st = statsOf(u)
  return st.hp * (1 + st.def / 100)
}

// ── the formation's read (redesign.md §2.17) ─────────────────────────────────────────────────────

// What a formation is read against, made once a plan: the scouted foes (scout), the threat map (threatOf) and its
// total, the seat's tile, the field's best (the fielded souls' worth L would want, wounds counted: wanted), and whether
// your side holds synergies (not under their rules switch).
export function formationContext (run, L, want = wanted(run, L)) {
  const s = run.state
  const threat = threatOf(run)
  return {
    foes: scout(run),
    threat,
    total: threat.ground.reduce((n, x) => n + x, 0) + threat.air.reduce((n, x) => n + x, 0) || 1,
    seat: deployTile('party', monarchSlot(s.camp)),
    best: want.reduce((n, u) => n + fieldPower(u), 0) || 1,
    tough: standing(souls(s.party)).map(tough).sort((a, b) => b - a).slice(0, fieldCap(run)).reduce((n, x) => n + x, 0) || 1,
    threats: new Set(scoutThreats(run)),
    synergies: !s.ablate?.includes('synergies')
  }
}

// A formation read against the scouted room, no battle played: the features its decision weighs
// (TUNING.expert.formation) and its tree's rules read (TREES.formation). Each scouted foe walks its road to the seat
// and stops before the first piece of yours on it (a piece on the ground holds anyone, a flyer only a flyer): the tiles
// it may stand on are its road up to there, and it strikes what is within its reach of one of them.
//   fielded    the pieces fielded
//   power      their worth, wounds counted (fieldPower), over the field's best (ctx.best)
//   cover      each piece's hardest blow (raw) × the share of the threat map its coverage takes, summed
//   exposed    each piece: the share of its HP the scouted foes that reach it could take in a turn, at most 1
//   open       scouted foes whose road reaches the seat with nothing of yours on it
//   blockers   scouted foes held first by a piece that fights in melee alone
//   behind     ranged pieces that cover the roads where no scouted foe reaches them
//   mend       each healer: the exposure of the allies within its Move and its heal's range
//   monarch    the share of the Monarch's HP the scouted foes that reach it could take in a turn, at most 2
//   synergies  the synergy rules its souls hold (a summon counting as its kind)
//   aura       the allies within an aura's range of its giver
//   arise      each Arise holder: the share of the threat map within its Arise's reach of it (ariseIn)
export function formationFeatures (run, party, ctx = formationContext(run, LEVELS.expert)) {
  const s = run.state
  const pieces = party.filter((u) => !isMonarch(u) && u.slot >= 0)
  const tiles = new Map(pieces.map((u) => [u, tilesAt(u, u.slot)]))
  const flies = (u) => !!unitDef(u.id).flies
  const ground = new Map()
  const air = new Map()
  for (const u of pieces) for (const t of tiles.get(u)) (flies(u) ? air : ground).set(t, u)
  const v = { fielded: pieces.length, air: pieces.filter(ANSWERS.fly).length, power: 0, cover: 0, exposed: 0, open: 0, blockers: 0, behind: 0, mend: 0, monarch: 0, synergies: 0, aura: 0, arise: 0, lasts: 0, heals: 0, answers: 0, dps: 0, focus: 0, contact: 0 }
  const reached = new Map(pieces.map((u) => [u, 0]))
  let onSeat = 0
  for (const f of ctx.foes) {
    let k = 0
    let by = null
    for (; k < f.road.length - 1 && !by; k++) by = ground.get(f.road[k]) ?? (f.flies ? air.get(f.road[k]) : null) ?? null
    const stands = f.road.slice(0, by ? k - 1 : k)
    if (!by) v.open++
    else if (meleeOnly(by)) v.blockers++
    const near = (list, r) => r >= 0 && stands.some((t) => list.some((x) => distance(t, x) <= r))
    for (const u of pieces) if (near(tiles.get(u), flies(u) ? f.air : f.reach)) reached.set(u, reached.get(u) + f.raw)
    if (near([ctx.seat], f.reach)) onSeat += f.raw
    // Where it first comes within its reach of a piece of yours: what yours could deal it there next turn (each
    // piece whose coverage takes that tile: its hardest blow), as a share of its HP, and the share of the HP of the
    // frailest piece it reaches there that its blow would take.
    const first = stands.find((t) => pieces.some((u) => tiles.get(u).some((x) => distance(t, x) <= (flies(u) ? f.air : f.reach))))
    if (first !== undefined) {
      let dealt = 0
      for (const u of pieces) {
        const c = coverage(u, u.slot, s.camp)
        if ((f.flies ? c.air : c.ground).includes(first)) dealt += punch(u)
      }
      v.focus += Math.min(1, dealt / Math.max(1, f.hp))
      let worst = 0
      for (const u of pieces) if (tiles.get(u).some((x) => distance(first, x) <= (flies(u) ? f.air : f.reach))) worst = Math.max(worst, Math.min(1, f.raw * mitigation(u) / Math.max(1, u.hp)))
      v.contact += worst
    }
  }
  const share = new Map(pieces.map((u) => [u, Math.min(1, reached.get(u) * mitigation(u) / Math.max(1, u.hp))]))
  const apart = (a, b) => Math.min(...tiles.get(a).flatMap((x) => tiles.get(b).map((y) => distance(x, y))))
  for (const u of pieces) {
    const st = statsOf(u, heldMods(u))
    const covers = covered(coverage(u, u.slot, s.camp), ctx.threat) / ctx.total
    v.power += fieldPower(u) / ctx.best
    v.cover += punch(u) * covers
    v.exposed += share.get(u)
    if (!meleeOnly(u) && covers > 0 && reached.get(u) === 0) v.behind++
    v.lasts += tough(u) / ctx.tough
    v.dps += punch(u)
    const heals = kitOf(u).filter((a) => isAllyShape(a.shape) && a.shape !== 'self' && a.effects.some((e) => e.op === 'heal' && !e.self))
    for (const a of heals) for (const e of a.effects) if (e.op === 'heal' && !e.self) v.heals += (e.pct ? e.pct * 100 : e.power * st.atk / TUNING.damage.atkDivisor * st.heal.given) / (a === heals[0] ? 1 : heals.length)
    if (heals.length) {
      const r = Math.max(...heals.map(rangeOf)) + Math.floor(st.move)
      for (const x of pieces) if (x !== u && apart(u, x) <= r) v.mend += share.get(x)
    }
    const aura = auraOf(u)
    if (aura) for (const x of pieces) if (x !== u && apart(u, x) <= aura.range) v.aura++
    const raises = ariseIn(s, u)
    if (raises) {
      let n = 0
      for (let t = 0; t < TILES; t++) if (tiles.get(u).some((x) => distance(t, x) <= raises.domain)) n += ctx.threat.ground[t] + ctx.threat.air[t]
      v.arise += n / ctx.total
    }
  }
  const m = monarchOf(s)
  v.monarch = Math.min(2, onSeat * mitigation(m) / Math.max(1, m.hp))
  if (ctx.synergies) v.synergies = activeSynergies(pieces.flatMap((u) => Array(1 + summonsOf(u)).fill(u))).length
  for (const t of ctx.threats) if (ANSWERS[t]) v.answers += pieces.some(ANSWERS[t]) ? 1 : -1
  return v
}

// What a soul takes to fell, wounds counted: its HP standing, its DEF's mitigation and its damage taken.
const tough = (u) => {
  const st = statsOf(u, heldMods(u))
  return Math.max(0, u.hp) * (1 + st.def / 100) / st.damage.taken
}
// The threat types of the room the run is in (its scouted foes').
const scoutThreats = (run) => {
  const n = currentNode(run)
  return n?.foes ? [...roomThreats(n)] : []
}

// The share of a blow's raw a soul takes out of battle: its DEF's mitigation and its damage taken (policy.js mitigation,
// with no battle: its held relics' mods alone).
const mitigation = (u) => {
  const st = statsOf(u, heldMods(u))
  return TUNING.damage.defConstant / (TUNING.damage.defConstant + Math.max(0, st.def)) * st.damage.taken
}
// A unit's hardest blow, raw (policy.js rawOf, out of battle), by `mods` (a soul's: its held relics'; a foe's: its
// floor's).
const punch = (u, mods = heldMods(u)) => {
  const st = statsOf(u, mods)
  return Math.max(0, ...kitOf(u).filter(isBlow).map((b) => b.effects.reduce((n, e) => n + (e.op === 'damage' ? e.power : 0), 0))) * st.atk / TUNING.damage.atkDivisor * st.damage.dealt
}

// Who stands in the camp: the strongest standing souls, wounds counted at the expert's level, a soul of the combo
// target's kinds as if worth TUNING.expert.book.target more.
const standing = (party) => party.filter((u) => u.hp > 0)
const wanted = (run, L) => {
  const keeps = L.book ? targetKinds(targetOf(run.state)) : null
  const w = (u) => worth(u, L.ablate !== 'summons') * (L.wounds ? Math.sqrt(hpPct(u)) : 1) * (keeps?.has(u.id) ? 1 + TUNING.expert.book.target : 1)
  return standing(souls(run.state.party)).sort((a, b) => w(b) - w(a) || a.uid - b.uid).slice(0, fieldCap(run))
}

// → { party, by, rules, met }: the formation for the current room. Basic (no `search`) takes its first draft, its rule
// of thumb. The expert decides between its drafts (the tree's rules, TREES.formation, then the weights,
// TUNING.expert.formation, on formationFeatures) and hill-climbs from the best (mutate), `search` steps, a change kept
// where it outranks the best (expert.js outranks: the tree's filters first, then the score). `by` and `rules` name the
// rules that turned a comparison (else 'weights'); `onCandidate` hears each formation met, once; `met` is each as it was
// judged ({ party, v (formationFeatures), keys (the tree's filters' standing), score, draft (one of the drafts, not a
// step of the climb) }), in the order met (the forest out of battle's prep reads them: prepCandidates).
export function plan (run, L, { onCandidate = null } = {}) {
  const want = wanted(run, L)
  const options = drafts(run, want, L).map((party) => allowed(run, party, L))
  if (!L.search) {
    onCandidate?.(options[0])
    return { party: options[0], by: 'first draft', rules: [], met: [] }
  }
  const ctx = formationContext(run, L, want)
  const w = TUNING.expert.formation
  const filters = TREES.formation.filter((n) => n.keep && n.when(ctx))
  const met = new Map()
  const judge = (party, draft = false) => {
    const key = party.map((u) => `${u.uid}@${u.slot}`).sort().join()
    if (!met.has(key)) {
      const v = formationFeatures(run, party, ctx)
      met.set(key, { party, v, keys: keysOf(TREES.formation, ctx, { v }), score: value(v, w), draft })
      onCandidate?.(party)
    }
    return met.get(key)
  }
  const turned = new Set()
  let best = null
  const take = (c) => {
    if (best === null) return (best = c)
    const won = outranks(c, best)
    const lost = won < 0 ? outranks(best, c) : -1
    if (won >= 0 && won < filters.length) turned.add(won)
    if (lost >= 0 && lost < filters.length) turned.add(lost)
    if (won >= 0) best = c
  }
  for (const party of options) take(judge(party, true))
  const rng = createRng(JSON.stringify([run.state.seed, run.state.floor, run.state.at, best.party.map((u) => u.uid)])).stream('climb')
  const open = openCells(run.state.camp)
  for (let i = 0; i < L.search; i++) take(judge(allowed(run, mutate(best.party, standing(souls(run.state.party)), open, rng, run.state, L), L)))
  const rules = [...turned].sort((a, b) => a - b).map((k) => filters[k].id)
  return { party: best.party, by: rules[0] ?? 'weights', rules, met: [...met.values()] }
}

// One change to a formation: trade a soul for one from the ossuary (it takes over the cell), swap two, or move
// one to a free cell its footprint fits (a near one more often than not); a change that leaves a footprint where
// it does not fit (legal) is no change. The Monarch never moves. With 'formation' ablated nothing is moved (the
// cells are basic's: see allowed): a change is a trade.
function mutate (party, pool, open, rng, s, L) {
  const out = party.map((u) => ({ ...u }))
  const fixed = L.ablate === 'formation'
  const movable = out.filter((u) => !isMonarch(u))
  if (!movable.length) return out
  const a = movable[rng.int(movable.length)]
  const spare = pool.filter((u) => !out.some((x) => x.uid === u.uid))
  const roll = rng()
  if (fixed && !spare.length) return out
  if (spare.length && (roll < 0.2 || fixed)) {
    const b = rng.pick(spare)
    const next = out.map((u) => (u === a ? { ...b, slot: a.slot } : u))
    return legal(next, s.camp) ? next : out
  }
  if (movable.length > 1 && roll < 0.55) {
    const b = rng.pick(movable.filter((u) => u !== a))
    const slot = a.slot
    a.slot = b.slot
    b.slot = slot
    return legal(out, s.camp) ? out : party.map((u) => ({ ...u }))
  }
  const taken = new Set(out.filter((u) => u !== a).flatMap(cellsOf))
  const free = open.filter((slot) => slot !== a.slot && fits(s.camp, slot, sizeOf(a), taken))
  if (!free.length) return out
  const near = a.slot < 0 ? [] : free.filter((slot) => distance(deployTile('party', slot), deployTile('party', a.slot)) <= 2)
  a.slot = rng.pick(near.length && rng.chance(0.7) ? near : free)
  return out
}

// The plan only depends on the room, the camp, the relics, who is standing (not where), their levels, tiers and the
// relics they hold, and the uids the foes will take, so it is made once per prep however many steps carry it out. The
// expert's is the plan's formation, or the one the forest out of battle takes among the plan's best where one decides the
// prep (prepPick; `sit`, the survey, read where not given: neither reads where a soul stands).
const plans = new WeakMap()
export function planFor (run, L, sit = null) {
  const s = run.state
  const key = JSON.stringify([L, s.floor, s.at, s.camp, s.relics, s.nextUid, s.party.map((u) => [u.uid, u.id, u.lvl, u.hp, u.maxHp, u.tracks, u.relics])])
  const have = plans.get(run)
  if (have?.key === key) return have.plan
  const onCandidate = audited(run) ? (party) => { AUDIT.candidates++; for (const f of new Set(featuresOf(s, party))) note('considered', f) } : null
  const made = plan(run, L, { onCandidate })
  noteRule(run, 'formation', made, `floor ${s.floor}, ${currentNode(run).type} in ${s.camp}`)
  const out = prepPick(run, L, made, sit).map((u) => ({ uid: u.uid, slot: u.slot }))
  plans.set(run, { key, plan: out })
  return out
}

// One step toward the plan (the Monarch is on its seat already, and stays): the souls it leaves out to the
// ossuary; then a soul into its planned cell where it can go straight there (run.js canPlace: whoever covers that
// cell takes its old one, never a soul in place, for no two planned footprints share a cell); with none that can,
// a soul not yet in place to the ossuary, to clear the way; then fight.
function pickPrep (run, L, sit) {
  const s = run.state
  const spend = pickSpend(run, L, sit)
  if (spend) return spend
  const goal = planFor(run, L, sit).filter((p) => !isMonarch(p))
  const piece = (p) => s.party.find((u) => u.uid === p.uid)
  const out = fielded(souls(s.party)).find((u) => !goal.some((p) => p.uid === u.uid && p.slot >= 0))
  if (out) return { type: 'place', uid: out.uid, slot: OSSUARY }
  const off = goal.filter((p) => piece(p).slot !== p.slot)
  const next = off.find((p) => canPlace(run, piece(p), p.slot))
  if (next) return { type: 'place', uid: next.uid, slot: next.slot }
  const blocker = off.find((p) => piece(p).slot >= 0)
  if (blocker) return { type: 'place', uid: blocker.uid, slot: OSSUARY }
  return { type: 'fight' }
}

// ── audit: what the expert considers, what it chooses, and which rule decided ─────────────────────

// Off but for the audit (--audit): per mechanic, how many of the formations the plans met use it (`considered`; and
// each fusion, recruit or tier weighed), and how many of the formations fought do (`chosen`); and per decision, the rule
// of the tree that decided it, or the weights (`rules`, by "decision: rule"), with the situation the first such
// decision was read in (`example`). Only the audited run's own plans and choices count (`run`), and with no run named,
// every plan the audit sees.
export const AUDIT = { on: false, run: undefined, candidates: 0, plans: 0, considered: {}, chosen: {}, done: {}, rules: {}, example: {} }
const note = (book, key, n = 1) => { if (AUDIT.on) AUDIT[book][key] = (AUDIT[book][key] ?? 0) + n }
const audited = (run) => AUDIT.on && (AUDIT.run === undefined || AUDIT.run === run)
export function resetAudit (on = true, run = undefined) {
  Object.assign(AUDIT, { on, run, candidates: 0, plans: 0, considered: {}, chosen: {}, done: {}, rules: {}, example: {} })
}
// A decision of `run`'s (expert.js decide's { by }), for the audit: counted by "decision: rule", and `line`, the
// situation it was read in, kept for the first of each.
function noteRule (run, decision, pick, line) {
  if (!audited(run)) return
  const key = `${decision}: ${pick.by}`
  note('rules', key)
  AUDIT.example[key] ??= line
}
// The survey in a line, for the audit.
const surveyLine = (sit) => `floor ${sit.floor} rank ${sit.rank}, ${sit.purse} essence, souls at ${Math.round(100 * sit.health)}% (${sit.fallen} fallen), ` +
  `Monarch ${Math.round(100 * sit.monarch)}%, ${sit.fielded}/${sit.command} fielded, ${sit.relics.unheld.length} relic(s) waiting` +
  (sit.target ? `, toward ${sit.target.id} (${Math.round(100 * sit.target.progress)}%)` : '') +
  (sit.rooms.length ? `; next: ${sit.rooms.map((r) => r.type + (r.threat ? ` (${(sit.strength / r.threat).toFixed(1)}×)` : '')).join(', ')}` : '')

// What a formation uses: a long-armed kind fielded, a 2×2 piece fielded, a fused piece fielded, a piece beside the
// Monarch, a piece left in the ossuary though the field had room for it.
export const FEATURES = ['long arm fielded', '2×2 fielded', 'fused fielded', 'beside the Monarch', 'left out']
export function featuresOf (s, party) {
  const out = []
  const pieces = party.filter((u) => !isMonarch(u)).map((p) => ({ ...s.party.find((x) => x.uid === p.uid), ...p }))
  const seat = deployTile('party', monarchSlot(s.camp))
  for (const u of pieces) {
    if (u.slot < 0) { out.push('left out'); continue }
    if (armOf(u) === 2) out.push('long arm fielded')
    if (sizeOf(u) === 2) out.push('2×2 fielded')
    if (unitDef(u.id).fused) out.push('fused fielded')
    if (cellsOf(u).some((c) => distance(deployTile('party', c), seat) === 1)) out.push('beside the Monarch')
  }
  return out
}

// A formation fought: its features once each.
function chose (s, goal) {
  AUDIT.plans++
  for (const f of new Set(featuresOf(s, goal))) note('chosen', f)
}

// ── growth: essence and fusions ─────────────────────────────────────────────────────────────────────

// Basic buys by rule of thumb (basicSpend) and never fuses. The expert grows by one search (grow): every choice it
// has — a fusion it can make, any held kind's next tier (and that tier with the one after it on its track, as one); a
// recruit (weighRecruits); a relic on a Shop's shelf (buyFor); a relic given to a soul (pickHold) — sketched (sketch:
// the strength of the field it leaves, and what the book says it is worth ahead), the best taken if it beats keeping
// what it has. Out of battle it gives its relics where they are worth most before it spends. Nothing is bought for the
// Monarch: its HP and Command are run relics.
function pickSpend (run, L, sit) {
  if (!L.spend) return basicSpend(run, L)
  return pickHold(run, L, sit) ?? spendPick(run, L, sit)
}

// Every purchase the purse affords L: a tier of any kind held (but under the tracks ablation).
export function spendOptions (run, L) {
  const s = run.state
  return heldKinds(s).flatMap((kind) => [0, 1].filter((track) => L.ablate !== 'tracks' && canAdvance(s, kind, track) && s.essence >= tierCost(run, kind, track))
    .map((track) => ({ type: 'upgrade', kind, track })))
}

// The fusions L may make now: one a recipe the run can make (run.js canFuse), of its canonical parts (fuseParts:
// the ossuary's pieces first, then the fielded), as legalActions lists them; none for a
// level that never fuses (basic) or under the fusions ablation.
export function fusionOptions (run, L) {
  if (!L.fuse || L.ablate === 'fusions') return []
  return FUSION_LIST.filter((r) => canFuse(run, r.id)).map((r) => ({ type: 'fuse', id: r.id, parts: fuseParts(run, r.id) }))
}

// Basic's essence goes to the kinds that will fight (those of the strongest standing souls): the lowest of them (by
// level, then by its order) its next tier, on the track it is on (the one with more tiers, the first before any; the
// other where the crosspath rule stops it), whatever its purse affords of it.
function basicSpend (run, L) {
  const s = run.state
  if (L.ablate === 'tracks') return null
  const kinds = [...new Set(standing(souls(s.party)).sort(byFieldPower).slice(0, fieldCap(run)).map((u) => u.id))]
  const affords = (kind, track) => canAdvance(s, kind, track) && s.essence >= tierCost(run, kind, track)
  const on = (kind) => (s.kinds[kind].tracks[1] > s.kinds[kind].tracks[0] ? 1 : 0)
  const low = (kind) => [kindLevel(s, kind), kinds.indexOf(kind)]
  const lowest = kinds.filter((kind) => [0, 1].some((t) => canAdvance(s, kind, t))).sort((a, b) => low(a)[0] - low(b)[0] || low(a)[1] - low(b)[1])[0]
  if (!lowest) return null
  const track = affords(lowest, on(lowest)) ? on(lowest) : !canAdvance(s, lowest, on(lowest)) && affords(lowest, 1 - on(lowest)) ? 1 - on(lowest) : null
  return track === null ? null : { type: 'upgrade', kind: lowest, track }
}

// What a state is worth to grow toward, as the features the growth search weighs (TUNING.expert.growth): the field it
// fields (strength, as a log: what a choice adds, as a share) and what the book says the combo it plays toward is worth
// ahead (bookValue; none without the book). Under the summons ablation a tier's summons are not counted: they never
// come. `sketch`: their weighted sum.
export const growthOf = (s, L) => ({ strength: Math.log(strength(s, L.ablate !== 'summons')), book: L.book ? bookValue(s) : 0 })
export const sketch = (s, L) => value(growthOf(s, L), TUNING.expert.growth)
// What a choice must beat: keeping what it has (TUNING.expert.growth.keep).
const KEEP = () => TUNING.expert.growth.keep

// The growth search, one decision (expert.js decide): keeping what it has, and each of `actions` (legal now) applied
// to a copy, read as what it adds to growthOf; the tree's rules for `why` (TREES.hold for a relic given), then the
// weights. A kind's next tier is weighed twice: alone, and with the tier after it on the same track as one option
// (where the crosspath rule allows it and the purse holds both prices together: nextTier), at their gain together,
// the first of the two bought for it; for a level is base + perTier × tiers, rounded down, and a tier whose level
// rounds away shows its worth only with the next (2026-10-10: on seed sim-0 the expert held 2,364 essence and declined
// a Frost Sprite tier of 194 for want of it). A hold onto a soul with room for the relic is `free` (the tree's
// give-relic). Weighed once for each run state and purpose (`why`). → the action, or null to keep.
const growths = new WeakMap()
const label = (a) => (a.type === 'fuse' ? `fuse ${a.id}` : a.type)
export function grow (run, L, actions, why, sit = null) {
  if (!actions.length) return null
  const s = run.state
  const key = JSON.stringify([L.ablate, s.floor, s.at, s.phase, s.essence, s.kinds, s.relics, s.party.map((u) => [u.uid, u.hp, u.slot >= 0, u.relics])])
  const seen = growths.get(run) ?? {}
  if (seen[why]?.key === key) return seen[why].pick
  if (audited(run)) for (const a of actions) note('considered', label(a))
  const base = growthOf(s, L)
  const gain = (st) => {
    const v = growthOf(st, L)
    return { strength: v.strength - base.strength, book: v.book - base.book, keep: 0 }
  }
  const room = (uid) => (s.party.find((u) => u.uid === uid)?.relics?.length ?? 0) < TUNING.relic.perPiece
  const options = [{ action: null, v: { strength: 0, book: 0, keep: 1, save: why === 'spend' ? saving(run, L) : 0 } }]
  for (const a of actions) {
    const sim = fork(run)
    apply(sim, a)
    options.push({ action: a, free: a.type === 'hold' && room(a.uid), v: { ...gain(sim.state), save: 0 } })
    if (!nextTier(sim, a)) continue
    apply(sim, a)
    options.push({ action: a, v: { ...gain(sim.state), save: 0 } })
  }
  const decided = decide(TREES[why] ?? [], sit, options, TUNING.expert.growth)
  const pick = decided.option.action
  // Each option's score by its action (a tier's the better of it alone and with the next: spendCandidates reads them).
  const scores = new Map()
  for (const o of options) {
    const id = outId(o.action)
    if (Number.isFinite(o.score) && !(scores.get(id) >= o.score)) scores.set(id, o.score)
  }
  growths.set(run, { ...seen, [why]: { key, pick, scores } })
  noteRule(run, why, decided, sit && surveyLine(sit))
  if (pick && audited(run)) note('done', label(pick))
  return pick
}

// Whether, on `sim` with tier `a` (an upgrade) just bought, the tier after it on the same track may be bought too: the
// crosspath rule allows it, and what is left of the purse pays its price (the two priced together, grow).
export const nextTier = (sim, a) => a.type === 'upgrade' && canAdvance(sim.state, a.kind, a.track) && sim.state.essence >= tierCost(sim, a.kind, a.track)

// A kind's state ({ lvl, tracks, least? }) with the next tier on `track` taken: its level with it (run.js levelOf).
const afterTier = (k, track) => {
  const next = { ...k, tracks: nextTracks(k.tracks, track) }
  return { ...next, lvl: levelOf(next) }
}

// ── the combo book ───────────────────────────────────────────────────────────────────────────────

// The expert comes to a run having studied every combo the content holds, ranked before the run by a static formula
// (--combos writes them to src/sim/combos.json, in under a second; the expert loads it as BOOK). Basic has none of it.
// The combos:
//   fusion:<recipe>:<track>   the recipe's parts, fused (on floor 1, its parts as they stand), the result on a track
//   core:<kind>:<track>       two pieces of a kind, on one of its two tracks (to its tier IV: a Colossus, an aura, a
//                             new or remade ability, Burning or Hexed)
//   kin:<kin>:<n>, role:<role>:<n>   the n pieces of a kin or a role its synergy's rule needs (content.js SYNERGIES:
//                             one rule each, at 4), each of the kind its cores rank best, those met soonest first
// Each is set up on every floor as the floor's army (BOOK_FLOORS: its Command, tiers and Monarch) with its pieces in it
// and the plain army's in the rest (FILLER), and weighed by bookPower; its `gain` on a floor is the log of its army's
// power over the plain army's (null on a floor its pieces cannot all stand). Then the relics that pair with it: what
// each battle relic adds to its army's power on floors 2 and 4 (a piece relic held by one of its pieces; one that needs
// Arise weighed against Arise alone). An entry:
//   { id, needs: { kind: pieces } (the pieces it is built from), fuse?: the recipe, tracks: { kind: track },
//     kin?: { kin: n }, role?: { role: n }, from: the first floor its kinds are met, gain: [per floor],
//     relics?: { relic: points } }
// The book also holds `plain`: the relics' points on the plain army.
const BOOK_FLOORS = [
  { command: 3, tiers: 1, hp: 220 }, { command: 5, tiers: 2, hp: 265 },
  { command: 7, tiers: 3, hp: 300 }, { command: 9, tiers: 4, hp: 340 }
]
// Whether relic def `r` has a mod on run-level stat path `path` (run.js RUN_PATHS).
const gives = (r, path) => (r.mods ?? []).some((m) => m.path === path)
// The relics a battle reads: their mods on a unit, their triggers, their rules, and Arise's reach and tier (not the
// purse's, the ossuary's, nor Command or the Monarch's HP, which the field's strength weighs).
const BATTLE_RELICS = () => RELIC_LIST.filter((r) => (r.mods?.some((m) => !isRunPath(m.path) || m.path.startsWith('arise.')) || r.on || r.rule) &&
  !gives(r, 'run.command') && !gives(r, 'run.monarchHp')).map((r) => r.id)
const RECRUITED = () => UNIT_LIST.filter((u) => u.spawn && tracksOf(u.id).length === 2)
// The plain army: the souls a run starts with (run.js START_PARTY), then the kinds the floors meet, floor 1's pool first
// and the commonest first (their spawn weights), as many as the deepest floor's Command.
const FILLER = [...START_PARTY, ...RECRUITED().filter((u) => !START_PARTY.includes(u.id))
  .sort((a, b) => a.spawn.minFloor - b.spawn.minFloor || b.spawn.weight - a.spawn.weight || (a.id < b.id ? -1 : 1)).map((u) => u.id)]
  .slice(0, Math.max(...BOOK_FLOORS.map((F) => F.command)))

// The recipe whose result is fused kind `id` (every fused kind has one: content.test.js), or undefined.
const RECIPES = new Map(FUSION_LIST.map((r) => [r.result, r]))
const recipeOf = (id) => RECIPES.get(id)
// The first floor a kind is met on: its spawn's, a fused kind's the latest of its recipe's parts' (a capstone's, its
// parts' parts', down to the kinds met).
const firstFloor = (id) => unitDef(id).spawn?.minFloor ?? Math.max(1, ...Object.keys(recipeOf(id)?.needs ?? {}).map(firstFloor))

// The book's combos, as content makes them; `cores` (id → mean gain), once ranked, picks each kin's and role's kinds.
export function combosOf (cores = null) {
  const kinds = RECRUITED()
  const first = firstFloor
  const out = []
  for (const r of FUSION_LIST) {
    for (const track of [0, 1]) {
      out.push({ id: `fusion:${r.id}:${track}`, needs: { ...r.needs }, fuse: r.id, tracks: { [r.result]: track }, from: Math.max(...Object.keys(r.needs).map(first)) })
    }
  }
  for (const u of kinds) for (const track of [0, 1]) out.push({ id: `core:${u.id}:${track}`, needs: { [u.id]: 2 }, tracks: { [u.id]: track }, from: first(u.id) })
  if (!cores) return out
  // A kind's better track, and its worth to a kin or role (its better core's mean gain).
  const best = (id) => [0, 1].map((t) => [t, cores[`core:${id}:${t}`] ?? -Infinity]).sort((a, b) => b[1] - a[1])[0]
  for (const syn of SYNERGIES) {
    for (const axis of ['kin', 'role']) {
      for (const [k, n] of Object.entries(syn.needs[axis] ?? {})) {
        const pool = kinds.filter((u) => u[axis] === k).sort((a, b) => first(a.id) - first(b.id) || best(b.id)[1] - best(a.id)[1])
        if (!pool.length) continue
        const needs = {}
        for (let i = 0; i < n; i++) needs[pool[i % pool.length].id] = (needs[pool[i % pool.length].id] ?? 0) + 1
        const tracks = Object.fromEntries(Object.keys(needs).map((id) => [id, best(id)[0]]))
        out.push({ id: `${axis}:${k}:${n}`, needs, tracks, from: Math.max(...Object.keys(needs).map(first)), [axis]: { [k]: n } })
      }
    }
  }
  return out
}

// A combo's army on a floor (null for none: the plain army), as a run standing in a room's prep: its pieces (a fusion
// made from floor 2, its parts as pieces on floor 1), each kind at the floor's tiers on its track (the plain kinds on
// their first), the rest of the floor's Command filled with the plain army's, `relics` owned (and held), and the
// Monarch the floor's. Null where its pieces outnumber the Command.
let bookBase = null
const bookRun = () => (bookBase ??= createRun({ seed: 'book', start: START_PARTY }))
function bookArmy (combo, floor, relics = []) {
  const F = BOOK_FLOORS[Math.min(floor, BOOK_FLOORS.length) - 1]
  const tracks = { ...(combo?.tracks ?? {}) }
  const ids = []
  if (combo?.fuse && floor > 1) ids.push(fusionDef(combo.fuse).result)
  else for (const [id, n] of Object.entries(combo?.needs ?? {})) for (let i = 0; i < n; i++) ids.push(id)
  if (ids.length > F.command) return null
  for (const id of FILLER) if (ids.length < F.command) ids.push(id)
  const run = { state: { ...bookRun().state }, battle: null, setup: null }
  const s = run.state
  const kindOf = (id) => {
    const t = tracks[id] ?? 0
    const tiers = [0, 0]
    tiers[t] = F.tiers
    tiers[1 - t] = Math.min(2, Math.max(0, F.tiers - 2))
    return { tracks: tiers, lvl: levelOf({ tracks: tiers }) }
  }
  s.kinds = Object.fromEntries([...new Set(ids)].map((id) => [id, kindOf(id)]))
  const monarch = { ...monarchOf(s), maxHp: F.hp, hp: F.hp }
  s.party = [monarch, ...ids.map((id, i) => makeUnit(id, { uid: i + 1, lvl: s.kinds[id].lvl, tracks: s.kinds[id].tracks }))]
  s.nextUid = ids.length + 1
  // The floor first: the base Command the banners make up to F.command is the floor's (run.js baseField).
  s.floor = floor
  s.relics = [...Array(Math.max(0, F.command - commandOf({ ...s, relics: [] }))).fill('grave_banner'), ...relics]
  // A piece relic works only held (redesign.md §2.15): each is given to the first piece with room for it, the combo's
  // own pieces first.
  for (const id of relics.filter((r) => !isRunRelic(r))) {
    const u = s.party.find((x) => !isMonarch(x) && (x.relics?.length ?? 0) < TUNING.relic.perPiece && !x.relics?.includes(id))
    if (u) u.relics = [...(u.relics ?? []), id]
  }
  s.phase = 'prep'
  return run
}

// A combo army's power (bookArmy's run), the book's static formula (TUNING.expert.book): each soul's worth (worth: its
// stats, its tiers and the summons they bring, and the relics it holds: a kin banner's mods on the souls it names, a
// trigger a share more by what it brings, relicReads), a fused soul's a share more, and a share of its holder's more for
// a relic's trigger or rule; the whole a share more for each synergy rule its souls hold (a summon counting as its
// kind), and for each run relic on Arise's reach or tier while a soul holds Arise.
function bookPower (run) {
  const b = TUNING.expert.book
  const s = run.state
  const pieces = souls(s.party)
  const read = relicReads(s)
  let power = 0
  for (const u of pieces) {
    const held = (u.relics ?? []).reduce((n, id) => n + (relicDef(id).on ? b.trigger : 0) + (relicDef(id).rule ? b.rule : 0), 0)
    power += read(u, (mods) => worth(u, true, mods, b.hits, b.worth)) * (1 + (unitDef(u.id).fused ? b.fused : 0) + held)
  }
  const rules = activeSynergies(pieces.flatMap((u) => Array(1 + summonsOf(u)).fill(u))).length
  const arise = pieces.some((u) => u.relics?.some(grantsArise)) ? s.relics.filter((id) => isRunRelic(id) && (relicDef(id).mods ?? []).some((m) => m.path.startsWith('arise.'))).length : 0
  return power * (1 + b.synergy * rules + b.arise * arise)
}

// --combos: the book, made. Every fusion and core on every floor, then the kin and role combos built from the best
// cores, each against the plain army (bookPower); then the battle relics on the plain army and on every combo's army
// (on floors 2 and 4), each against the same army without it. Kept: every combo, best first, with the relics that add
// more than TUNING.expert.book.floor to it.
const BOOK_FILE = new URL('./combos.json', import.meta.url)
export function makeBook ({ out = BOOK_FILE, quiet = false } = {}) {
  const t0 = Date.now()
  const floors = BOOK_FLOORS.map((_, i) => i + 1)
  const power = (combo, floor, relics = []) => {
    const army = bookArmy(combo, floor, relics)
    return army && Math.log(bookPower(army))
  }
  const plain = floors.map((floor) => power(null, floor))
  const rank = (combos) => combos.map((combo) => ({
    ...combo,
    gain: floors.map((floor, f) => {
      const p = power(combo, floor)
      return p === null ? null : +(p - plain[f]).toFixed(4)
    })
  }))
  const mean = (e) => {
    const g = e.gain.filter((x, f) => x !== null && f + 1 >= e.from)
    return g.length ? g.reduce((n, x) => n + x, 0) / g.length : -Infinity
  }
  const first = rank(combosOf())
  const cores = Object.fromEntries(first.filter((e) => e.id.startsWith('core:')).map((e) => [e.id, mean(e)]))
  const second = rank(combosOf(cores).filter((c) => !first.some((e) => e.id === c.id)))
  const book = [...first, ...second].sort((a, b) => mean(b) - mean(a) || (a.id < b.id ? -1 : 1))
  // The relics: on floors 2 and 4, each against the army without it (one that needs Arise, against Arise alone).
  const relicFloors = [2, 4]
  const pairs = (combo) => {
    const points = {}
    for (const id of BATTLE_RELICS()) {
      const base = relicDef(id).needsArise ? ['arise'] : []
      let sum = 0
      let n = 0
      for (const floor of relicFloors) {
        const got = power(combo, floor, [...base, id])
        const ref = power(combo, floor, base)
        if (got === null || ref === null) continue
        sum += got - ref
        n++
      }
      if (n && sum / n > TUNING.expert.book.floor) points[id] = +(sum / n).toFixed(4)
    }
    return Object.fromEntries(Object.entries(points).sort((x, y) => y[1] - x[1]))
  }
  for (const e of book) e.relics = pairs(e)
  const data = { made: 'node src/sim/autoplay.js --combos', plain: pairs(null), combos: book }
  fs.writeFileSync(out, JSON.stringify(data, null, 1) + '\n')
  if (quiet) return data
  console.log(`the combo book: ${book.length} combos ranked in ${((Date.now() - t0) / 1000).toFixed(1)} s; written to ${out.pathname ?? out}`)
  for (const e of book.slice(0, 15)) console.log(`  ${e.id.padEnd(34)} ${e.gain.map((g) => (g === null ? '    -   ' : g.toFixed(3).padStart(8))).join(' ')}  ${Object.keys(e.relics ?? {}).slice(0, 3).join(', ')}`)
}

// The book as the expert reads it: { margins, plain, combos }, empty where none was made.
export const BOOK = (() => {
  try {
    return JSON.parse(fs.readFileSync(BOOK_FILE, 'utf8'))
  } catch {
    return { margins: {}, plain: {}, combos: [] }
  }
})()

// ── archetypes: a run committed to a build (redesign.md §3, the harness) ────────────────────────

// The builds a run may commit to, as content makes them: every fused kind (a node of the recipe graph: the result of a
// recipe, FUSION_LIST) and every synergy (SYNERGIES: a kin's or a role's), by id.
export const ARCHETYPES = () => [...new Set(FUSION_LIST.map((r) => r.result)), ...SYNERGIES.map((x) => x.id)]
// The synergy archetype `arch` names, or null (a fused kind's).
export const synergyOf = (arch) => SYNERGIES.find((x) => x.id === arch) ?? null
// The recipes a fused kind is built by: those whose result it is, and below them, the recipes of every fused part they
// take (the recipe graph under it, so a fusion of fusions is played toward from its first fusion on).
export function recipesOf (kind, seen = new Set()) {
  const out = []
  for (const r of FUSION_LIST) {
    if (r.result !== kind || seen.has(r.id)) continue
    seen.add(r.id)
    out.push(r, ...Object.keys(r.needs).filter((id) => unitDef(id).fused).flatMap((id) => recipesOf(id, seen)))
  }
  return out
}
// An archetype's combos of the book: a fused kind's, those that fuse it or a fused part of it (`fuse`, recipesOf); a
// synergy's, the kin's or role's that reach every count its rule needs (`kin`, `role`). Throws for an unknown one.
export function archetypeCombos (arch, combos = BOOK.combos) {
  const syn = synergyOf(arch)
  if (syn) return combos.filter((c) => Object.entries(syn.needs).every(([axis, need]) => Object.entries(need).every(([k, n]) => (c[axis]?.[k] ?? 0) >= n)))
  if (!FUSION_LIST.some((r) => r.result === arch)) throw new Error(`unknown archetype "${arch}": ${ARCHETYPES().join(', ')}`)
  const recipes = new Set(recipesOf(arch).map((r) => r.id))
  return combos.filter((c) => recipes.has(c.fuse))
}
// The archetype the expert is committed to (useCommit; null, free play): the book it reads is that archetype's combos
// alone (bookValue, targetOf), so its draft, recruits, purchases and route, and the outside teacher's candidates
// (spendCandidates, recruitCandidates: the same sketch), all follow it. Set for the job a worker plays, as the forests are.
let COMMIT = null
export function useCommit (arch) {
  const combos = arch ? archetypeCombos(arch) : null
  if (arch && !combos.length) throw new Error(`archetype "${arch}" has no combo in the book (npm run combos)`)
  COMMIT = arch ? { arch, combos } : null
}
export const commitOf = () => COMMIT?.arch ?? null
// `fn()` committed to `arch` (null: free play), the commitment before it put back after; undefined: as it is. → what
// fn returns
export function withCommit (arch, fn) {
  if (arch === undefined) return fn()
  const before = commitOf()
  useCommit(arch)
  try {
    return fn()
  } finally {
    useCommit(before)
  }
}
// The combos the expert plays toward: the committed archetype's, else the whole book.
const bookCombos = () => COMMIT?.combos ?? BOOK.combos

// What the expert makes of the book. How far a run is along a combo, from 0 to 1, the mean of its parts: the pieces
// it is built from, standing (a kin's, a role's or a pact's: the pieces of that kin or role, any kind; a fused part not
// yet made counted by how far along its own recipe the run is, its share split among that recipe's pieces, each piece
// held counted once); a fusion's made (its parts then all counted); and the tiers on its tracks of the kinds it holds,
// of the four. `counts`: the standing souls of each kind (standingCounts), read once for every combo of a state.
function comboProgress (s, c, counts = standingCounts(s)) {
  const pieces = (id) => counts.get(id) ?? 0
  const share = (needs) => {
    let got = 0
    let all = 0
    let deep = false
    for (const id in needs) {
      const have = Math.min(pieces(id), needs[id])
      got += have
      all += needs[id]
      if (have < needs[id] && RECIPES.has(id)) deep = true
    }
    if (!deep) return got / all
    // A fused part short: each of its pieces counted once, down its recipe.
    const left = new Map()
    got = 0
    const count = (id, k, w) => {
      const have = Math.min(left.get(id) ?? pieces(id), k)
      left.set(id, (left.get(id) ?? pieces(id)) - have)
      got += have * w
      const r = have < k && recipeOf(id)
      if (!r) return
      const n = Object.values(r.needs).reduce((x, m) => x + m, 0)
      for (const [part, m] of Object.entries(r.needs)) count(part, (k - have) * m, w / n)
    }
    for (const [id, k] of Object.entries(needs)) count(id, k, 1)
    return got / all
  }
  const of = (axis, value) => {
    let n = 0
    for (const [id, m] of counts) if (unitDef(id)[axis] === value) n += m
    return n
  }
  const parts = []
  if (c.fuse) {
    const made = pieces(fusionDef(c.fuse).result) > 0
    parts.push(made ? 1 : share(c.needs), made ? 1 : 0)
  } else if (c.kin || c.role) {
    for (const [k, n] of Object.entries(c.kin ?? {})) parts.push(Math.min(1, of('kin', k) / n))
    for (const [r, n] of Object.entries(c.role ?? {})) parts.push(Math.min(1, of('role', r) / n))
  } else parts.push(share(c.needs))
  const held = Object.entries(c.tracks).filter(([id]) => pieces(id) > 0)
  parts.push(held.length ? held.reduce((n, [id, t]) => n + (s.kinds[id]?.tracks[t] ?? 0) / 4, 0) / Object.keys(c.tracks).length : 0)
  return parts.reduce((n, x) => n + x, 0) / parts.length
}
// The standing souls of each kind in state `s`.
function standingCounts (s) {
  const counts = new Map()
  for (const u of souls(s.party)) if (u.hp > 0) counts.set(u.id, (counts.get(u.id) ?? 0) + 1)
  return counts
}

// A combo's worth from here: its gain over the plain army on the floors left (the last floor's past them, none
// below 0), and the points of the relics at work that pair with it (its own, else the plain army's), each once. A relic
// that costs the Monarch HP (Blood Tithe's tithe) pays for it only while the Monarch mends between fights: while
// nothing may heal it (Court of Bone) the book counts none of its points.
const BOOK_CAP = BOOK_FLOORS.length
function comboWorth (s, c, work = atWork(s), bled = unhealed(s)) {
  const pairs = c.relics ?? BOOK.plain ?? {}
  let relics = 0
  for (const id of work) relics += bled && bleeds(id) ? 0 : pairs[id] ?? 0
  // A combo whose kinds are not met before a later floor (`from`) is worth TUNING.expert.book.ahead of it until then.
  return (gainFrom(c, Math.min(s.floor, BOOK_CAP)) + relics) * (c.from > s.floor ? TUNING.expert.book.ahead : 1)
}
// A combo's mean gain on the floors from `from` on (none below 0), made once a combo and floor.
const gains = new WeakMap()
function gainFrom (c, from) {
  let kept = gains.get(c)
  if (!kept) gains.set(c, (kept = []))
  if (kept[from] === undefined) {
    const g = c.gain.filter((x, f) => x !== null && f + 1 >= from)
    kept[from] = Math.max(0, g.length ? g.reduce((n, x) => n + x, 0) / g.length : 0)
  }
  return kept[from]
}
// The relics at work in a state, each once: the run relics owned, and the piece relics a standing soul holds (one
// unheld works for no one: redesign.md §2.15).
const atWork = (s) => new Set([...s.relics.filter(isRunRelic), ...standing(souls(s.party)).flatMap((u) => u.relics ?? [])])

// The book's value of a state: the best of its combos, by worth times progress. The target (targetOf) is that combo.
function bookValue (s) {
  const work = atWork(s)
  const bled = unhealed(s)
  const counts = standingCounts(s)
  let best = 0
  for (const c of bookCombos()) best = Math.max(best, comboWorth(s, c, work, bled) * comboProgress(s, c, counts))
  return best
}
export function targetOf (s) {
  const work = atWork(s)
  const bled = unhealed(s)
  const counts = standingCounts(s)
  let best = null
  let most = 0
  for (const c of bookCombos()) {
    const v = comboWorth(s, c, work, bled) * comboProgress(s, c, counts)
    if (v > most) { most = v; best = c }
  }
  return best
}
// The kinds a target is built of (its parts, its tracks'), and whether a soul is one of them.
export const targetKinds = (c) => new Set([...Object.keys(c?.needs ?? {}), ...Object.keys(c?.tracks ?? {})])

// ── reap ─────────────────────────────────────────────────────────────────────────────────────────

// The one recruit a battle allows (a battle's spoils are its souls: relics are bought, redesign.md §2.11): basic buys
// the highest tier it can afford while the field has room, an expert the soul that grows its sketch most
// (weighRecruits), or the one the forest out of battle reads the better where one decides recruits (recruitPick). A
// full retinue lets its weakest soul in the ossuary go to make room.
export function pickReap (run, L, sit) {
  const s = run.state
  if (L.spend && outDecides('recruit')) {
    const actions = recruitPick(run, L, sit)
    const release = actions.find((a) => a.type === 'release')
    if (release && soulCount(s.party) >= rosterCap(run)) return release
    return actions.find((a) => a.type === 'reap')
  }
  if (L.spend) {
    const pick = weighRecruits(run, L, sit)
    if (!pick) return { type: 'reap', index: null }
    if (pick.release != null && soulCount(s.party) >= rosterCap(run)) return { type: 'release', uid: pick.release }
    return { type: 'reap', index: pick.index }
  }
  const index = recruit(run)
  if (index === null || soulCount(s.party) < rosterCap(run)) return { type: 'reap', index }
  // Never the last soul standing (the run refuses that release): with every other soul fallen, the recruit
  // is passed over instead.
  const spare = (u) => souls(s.party).some((x) => x !== u && x.hp > 0)
  const weakest = inOssuary(s.party).filter(spare).sort(L.wounds ? byFieldPower : byPower).at(-1)
  return weakest ? { type: 'release', uid: weakest.uid } : { type: 'reap', index: null }
}

// The expert's recruit, by the growth search's sketch: each soul it can afford, a piece of its own, with the retinue
// as it would leave it (when the retinue is full, its weakest
// standing piece in the ossuary let go first, never one its target is built of while another will do: a release only
// ever comes with a recruit worth it), or a fusion it would complete; the best that beats keeping the essence, or none.
// Weighed once a room; a release it needs comes first, then the recruit it was for.
// → { index, release? } or null
const recruits = new WeakMap()
export function weighRecruits (run, L, sit = null) {
  const s = run.state
  // Once a room, for the offers it has (a release leaves them as they were; a recruit takes the souls away).
  const key = JSON.stringify([s.floor, s.at, s.offers.map((o) => o.id)])
  if (recruits.get(run)?.key === key) return recruits.get(run).pick
  const spare = (u) => souls(s.party).some((x) => x !== u && x.hp > 0)
  // The soul it lets go: the weakest standing in the ossuary, never one its target is built of while another will do.
  const keeps = L.book ? targetKinds(targetOf(s)) : new Set()
  const weakest = inOssuary(s.party).filter(spare).sort((a, b) => keeps.has(b.id) - keeps.has(a.id) || byFieldPower(a, b)).at(-1)
  const base = sketch(s, L)
  let pick = null
  let best = KEEP()
  for (const [index, o] of s.offers.entries()) {
    if (o.cost > s.essence) continue
    const sim = fork(run)
    const full = soulCount(s.party) >= rosterCap(run)
    if (full && !weakest) continue
    if (full) apply(sim, { type: 'release', uid: weakest.uid })
    apply(sim, { type: 'reap', index })
    if (audited(run)) note('considered', 'recruit')
    // A recruit is worth what it adds to the field and the book, or what a fusion it completes would (one the purse
    // cannot pay for yet, TUNING.expert.growth.later of that).
    const gain = Math.max(sketch(sim.state, L), ...completes(sim, L, true).map((x) => base + (sketch(x.state, L) - base) * (x.later ? TUNING.expert.growth.later : 1))) - base
    if (gain > best) {
      best = gain
      pick = { index, ...(full && { release: weakest.uid }) }
    }
  }
  recruits.set(run, { key, pick })
  noteRule(run, 'reap', { by: 'weights' }, sit && surveyLine(sit))
  if (pick && audited(run)) note('done', 'recruit')
  return pick
}

// The retinue as it would be after each fusion L may make on `sim` (a copy, after a recruit: weighed as on the map);
// with `later`, each fusion whose parts it holds though the purse is short of its price too (as if paid), marked
// `later`.
function completes (sim, L, later = false) {
  const map = { ...sim, state: { ...sim.state, phase: 'map' } }
  const out = fusionOptions(map, L).map((a) => {
    const next = fork(map)
    apply(next, a)
    return next
  })
  if (!later || !L.fuse || L.ablate === 'fusions') return out
  for (const r of FUSION_LIST) {
    if (canFuse(map, r.id) || fuseParts(map, r.id) === null) continue
    const next = fork(map)
    next.state.essence = fuseCost(map, r.id)
    apply(next, { type: 'fuse', id: r.id, parts: fuseParts(map, r.id) })
    next.later = true
    out.push(next)
  }
  return out
}

// What saving for a fusion is worth (grow's `save`): the most the sketch would gain from a fusion whose parts the run
// holds while the purse is short of its price (completes' `later`), 0 for none.
export function saving (run, L) {
  const base = sketch(run.state, L)
  return Math.max(0, ...completes(fork(run), L, true).filter((x) => x.later).map((x) => sketch(x.state, L) - base))
}

// A pick of the draft (run.js draftOffer). The expert takes the offer whose soul the growth search's sketch values most
// with the retinue as the pick leaves it (its field's strength and, with the book, the combo it plays toward: as a
// recruit is weighed, weighRecruits), the first offered among equals; but while its souls hold fewer than
// TUNING.expert.draft.ranged ranged pieces, only among the ranged kinds offered, where there are any. Basic takes the
// first offered of a kind it does not hold yet, else the first. No forest decides it: they were fitted on runs that
// started with START_PARTY.
export function pickDraft (run, L) {
  const s = run.state
  const offer = s.draft.offer
  if (!L.spend) {
    const fresh = offer.findIndex((id) => !s.kinds[id])
    return { type: 'pick', index: Math.max(0, fresh) }
  }
  const ranged = (id) => !meleeOnly(makeUnit(id, { lvl: 1 }))
  const short = souls(s.party).filter((u) => !meleeOnly(u)).length < TUNING.expert.draft.ranged && offer.some(ranged)
  let best = { index: 0, worth: -Infinity }
  for (const index of offer.keys()) {
    if (short && !ranged(offer[index])) continue
    const sim = fork(run)
    apply(sim, { type: 'pick', index })
    const worth = sketch(sim.state, L)
    if (worth > best.worth) best = { index, worth }
  }
  return { type: 'pick', index: best.index }
}

// Basic's recruit (the expert's is weighRecruits'): while the field has room for another standing soul, the soul of
// the highest tier it can afford (the first offered among equals); else none.
function recruit (run) {
  const s = run.state
  if (standing(souls(s.party)).length >= fieldCap(run)) return null
  const affordable = s.offers.flatMap((o, index) => (o.cost <= s.essence ? [{ o, index }] : []))
  return affordable.sort((a, b) => unitDef(b.o.id).tier - unitDef(a.o.id).tier || a.index - b.index)[0]?.index ?? null
}

// The state a purchase would make, for the sketch: a relic owned (a copy more; an HP relic's Monarch with its max HP
// raised, healed by as much unless nothing may heal it), or the kind (every soul of it) with a tier more on a track and
// the level it gives; else as is. Only what changes: { relics?, party?, kinds? }.
export function offerState (s, o) {
  if (o.type === 'relic') {
    const relics = [...s.relics, o.id]
    const gain = monarchHp({ ...s, relics }) - monarchHp(s)
    if (!gain) return { relics }
    const heal = !unhealed({ relics })
    return { relics, party: s.party.map((u) => (isMonarch(u) ? { ...u, maxHp: monarchHp({ ...s, relics }), hp: u.hp + (heal ? gain : 0) } : u)) }
  }
  if (o.type !== 'tier') return {}
  const k = afterTier(s.kinds[o.kind], o.track)
  return { kinds: { ...s.kinds, [o.kind]: k }, party: s.party.map((u) => (u.id === o.kind ? { ...u, lvl: k.lvl, tracks: k.tracks } : u)) }
}

// ── the Shop ─────────────────────────────────────────────────────────────────────────────────────

// Basic buys a Command relic it can pay for and L may take, the first on the shelf; then gives a piece relic waiting to
// the first fielded soul that holds none (the first such relic, the first such soul); else it leaves. The expert gives
// what waits where it is worth most (pickHold), then buys what is worth its price (buyFor), a relic at a time, and
// leaves when neither is.
function pickShop (run, L, sit) {
  if (L.spend) return pickHold(run, L, sit) ?? buyFor(run, L, sit) ?? { type: 'leave' }
  const s = run.state
  const index = s.shop.findIndex((id, i) => id && gives(relicDef(id), 'run.command') && !banned(L, id) && canBuy(run, i))
  if (index >= 0) return { type: 'buy', index }
  const relic = unheld(s)[0]
  const holder = relic && souls(s.party).find((u) => u.slot >= 0 && u.hp > 0 && !u.relics?.length && canHold(s, relic, u))
  return holder ? { type: 'hold', relic, uid: holder.uid } : { type: 'leave' }
}

// What the expert buys (redesign.md §2.11: a relic bought is a tier not bought): of the relics on the shelf it can pay
// for and L may take, the one whose sketch gains most for each essence it costs (owned, and a piece relic held where it
// is worth most: held; the book's worth of the combo it plays toward counts it at work, comboWorth), if that beats the
// tiers its price displaces, the best a tier of the retinue's kinds gives an essence (tierRate), and gains anything at
// all. → a buy, or null.
export function buyFor (run, L, sit = null) {
  const s = run.state
  const base = sketch(s, L)
  const bar = tierRate(run, L, base)
  let pick = null
  let most = bar
  for (const [index, id] of s.shop.entries()) {
    if (!id || banned(L, id) || !canBuy(run, index)) continue
    const gain = held({ ...s, ...offerState(s, { type: 'relic', id }) }, id, L) - base
    const rate = gain / relicPrice(run, id)
    if (gain > KEEP() && rate > most) { most = rate; pick = { type: 'buy', index } }
  }
  noteRule(run, 'buy', { by: 'weights' }, sit && surveyLine(sit))
  return pick
}

// The sketch of state `s`, owning relic `id`, with it held where it is worth most if it is a piece relic: given to the
// standing soul whose sketch it raises most (one holding its fill gives back its first), else left unheld.
export function held (s, id, L) {
  let best = sketch(s, L)
  if (isRunRelic(id)) return best
  for (const u of standing(souls(s.party))) {
    if (u.relics?.includes(id)) continue
    const relics = [...(u.relics ?? []).slice(Math.max(0, (u.relics?.length ?? 0) - TUNING.relic.perPiece + 1)), id]
    best = Math.max(best, sketch({ ...s, party: s.party.map((x) => (x === u ? { ...x, relics } : x)) }, L))
  }
  return best
}

// What an essence buys in tiers: the best sketch gain per essence among the next tiers of the kinds the retinue holds
// (and each with the tier after it on its track, as one: grow), whatever the purse holds now, for essence kept waits
// for them. 0 where no tier is left to buy, or none may be (the tracks ablation).
export function tierRate (run, L, base) {
  const s = run.state
  if (L.ablate === 'tracks') return 0
  let best = 0
  for (const kind of heldKinds(s)) {
    for (const track of [0, 1]) {
      let st = s
      let cost = 0
      for (let k = 0; k < 2 && canAdvance(st, kind, track); k++) {
        cost += tierCost({ state: st }, kind, track)
        st = { ...st, ...offerState(st, { type: 'tier', kind, track }) }
        best = Math.max(best, (sketch(st, L) - base) / cost)
      }
    }
  }
  return best
}

// The expert's relics in hand (out of battle: a held relic works only on the field): one a fallen soul holds is given
// back (it fights for no one until an altar), then each piece relic waiting goes to the standing soul where the sketch
// says it is worth most (grow: one holding its fill gives back its first, which waits to be weighed again), if that
// adds anything. → a hold or an unhold, or null.
export function pickHold (run, L, sit) {
  const s = run.state
  const fallen = souls(s.party).find((u) => u.hp <= 0 && u.relics?.length)
  if (fallen) return { type: 'unhold', uid: fallen.uid }
  const ids = [...new Set(unheld(s))]
  if (!ids.length) return null
  const options = ids.flatMap((relic) => standing(souls(s.party)).filter((u) => canHold(s, relic, u)).map((u) => ({ type: 'hold', relic, uid: u.uid })))
  return grow(run, L, options, 'hold', sit)
}

// ── the altar (redesign.md §4.5) ─────────────────────────────────────────────────────────────────

// An altar's one rite (run.js altarActions). Basic heals, as every altar did before it offered more. The expert weighs
// the heal, each transmutation and each free tier as a purchase is weighed (grow: each applied to a copy, read as what
// it adds to the sketch, the tree's rules first: TREES.altar, the route's reasons for walking to an altar its reasons to
// heal there), and heals where none beats keeping what it has. No free tier under the tracks ablation (it never takes
// one). → the rite
export function altarOptions (run, L) {
  return altarActions(run).filter((a) => a.type !== 'consecrate' || L.ablate !== 'tracks')
}
const HEAL = Object.freeze({ type: 'heal' })
export function pickAltar (run, L, sit = null) {
  if (!L.spend) return { ...HEAL }
  return grow(run, L, altarOptions(run, L), 'altar', sit ?? survey(run, L)) ?? { ...HEAL }
}
// A rite in words, for the candidates' labels: "heal", "transmute 7 frost_sprite into will_o_wisp", "consecrate
// frost_sprite 1".
export function riteLabel (run, a) {
  if (a.type !== 'transmute') return a.type === 'consecrate' ? `consecrate ${a.kind} ${a.track}` : a.type
  const u = run.state.party.find((x) => x.uid === a.uid)
  return `transmute ${a.uid} ${u.id} into ${transmuteOffer(run.state, u.id)[a.index]}`
}

// ── the forest out of battle (outforest.js; redesign.md §2.25) ──────────────────────────────────

// The expert's recruit and purchases are today's (weighRecruits, grow) unless a forest out of battle is in use for the
// decision (outforest.js outDecides: src/sim/outforest.json, Node only): then today's pick and the next best by today's
// own score (recruitCandidates, spendCandidates: at most OUT_CAP, and passing on: outCandidates) are read (outsideRead),
// and the forest's best taken where it reads it more than its margin above today's (outforest.js chooseOut).
// outside.js's labels read the same candidates by the same functions.
export const OUT_CAP = 6
// What names a candidate: the action it takes (null: stopping), or for a recruit the actions it takes (outside.js's).
const outId = (x) => JSON.stringify(x ?? null)

// Of `cands` (each { id, score }), the one named `own` first, then the rest by their score, the higher first (their
// order where equal), at most `cap`.
export function rankCandidates (cands, own, cap = OUT_CAP) {
  const base = cands.find((x) => x.id === own)
  if (!base) throw new Error(`the pick ${own} is no candidate`)
  const rest = cands.filter((x) => x !== base).map((x, i) => ({ x, i })).sort((a, b) => b.x.score - a.x.score || a.i - b.i).map((e) => e.x)
  return [base, ...rest].slice(0, cap)
}

// The candidates the forest reads of decision `d` (spendCandidates', recruitCandidates'): today's pick first, then the
// rest by today's score, at most `cap` (rankCandidates), and passing on (stopping, or no recruit: `d.cands[0]`) where
// it is not among them.
export function outCandidates (d, cap = OUT_CAP) {
  const list = rankCandidates(d.cands, d.today, cap)
  if (!list.includes(d.cands[0])) list.push(d.cands[0])
  return list
}

// A purchase's candidates: stopping (`actions` none: the run walks on, or its prep goes on), and each tier the purse
// affords and fusion it can make (spendOptions, fusionOptions), each with grow's score of it (a tier the better of it
// alone and with the next on its track), today's pick grow's. Null with nothing to buy. → { today (its id), cands:
// [{ id, label, actions, score }] } in grow's order (stopping first)
export function spendCandidates (run, L, sit = null) {
  const actions = [...fusionOptions(run, L), ...spendOptions(run, L)]
  if (!actions.length) return null
  const today = grow(run, L, actions, 'spend', sit)
  const { scores } = growths.get(run).spend
  const label = (a) => (a.type === 'fuse' ? `fuse ${a.id}` : `tier ${a.kind} ${a.track}`)
  return {
    today: outId(today),
    cands: [{ id: outId(null), label: 'stop', actions: [], score: scores.get(outId(null)) }, ...actions.map((a) => ({ id: outId(a), label: label(a), actions: [a], score: scores.get(outId(a)) }))]
  }
}

// The recruit's candidates: none, and each soul offered the purse affords (a full retinue letting go first the soul
// weighRecruits lets go: the weakest standing in the ossuary, never one the combo target is built of while another will
// do), each scored by what it adds to the sketch; today's pick weighRecruits'. → { today, cands } as spendCandidates'
export function recruitCandidates (run, L, sit = null) {
  const s = run.state
  const pick = weighRecruits(run, L, sit)
  const full = soulCount(s.party) >= rosterCap(run)
  const keeps = targetKinds(targetOf(s))
  const spare = (u) => souls(s.party).some((x) => x !== u && x.hp > 0)
  const weakest = inOssuary(s.party).filter(spare).sort((a, b) => keeps.has(b.id) - keeps.has(a.id) || byFieldPower(a, b)).at(-1)
  const none = { type: 'reap', index: null }
  const sk = sketch(s, L)
  const cands = [{ id: outId([none]), label: 'none', actions: [none], score: KEEP() }]
  for (const [index, o] of s.offers.entries()) {
    if (o.cost > s.essence || (full && !weakest)) continue
    const actions = [...(full ? [{ type: 'release', uid: weakest.uid }] : []), { type: 'reap', index }]
    const sim = lightFork(run)
    for (const a of actions) apply(sim, a)
    cands.push({ id: outId(actions), label: `recruit ${o.id}`, actions, score: sketch(sim.state, L) - sk })
  }
  const own = pick === null ? [none] : [...(pick.release != null && full ? [{ type: 'release', uid: pick.release }] : []), { type: 'reap', index: pick.index }]
  return { today: outId(own), cands }
}

// An altar's candidates (outside.js's): each rite the expert may take (altarOptions), scored by what it adds to the
// sketch (grow's score of it, the tree's rules aside); today's pick pickAltar's. → { today, cands } as spendCandidates'
export function altarCandidates (run, L, sit = null) {
  const today = pickAltar(run, L, sit)
  const sk = sketch(run.state, L)
  const cands = altarOptions(run, L).map((a) => {
    const sim = lightFork(run)
    apply(sim, a)
    return { id: outId(a), label: riteLabel(run, a), actions: [a], score: sketch(sim.state, L) - sk }
  })
  return { today: outId(today), cands }
}

// A copy of the run to read a candidate on: its state cloned but its log (apply only appends to it) and its floor's map
// (a purchase, a recruit or a release never touches one; a floor entered makes a new one), shared. Never played on.
function lightFork (run) {
  const { log, map, ...rest } = run.state
  return { state: { ...structuredClone(rest), map, log: [] }, battle: null, setup: null }
}

// The battle rooms the run walks into next, as scouting and the route tell (no battle played): the room in prep first,
// then each room the route would walk (the learned route's tree, else the hand-built route, each choice read as if the
// run stood there, the army as it is now: routeStep), at most `n` battle rooms; how many rooms on the first Shop and
// the first altar on that walk lie (null for none); and the floor's battle rooms still ahead (rank past the run's, the
// room in prep among them). → { next: [node], floor: [node], shop, altar }
function roomsAhead (run, L, sit, n = 3) {
  const s = run.state
  const here = currentNode(run)
  const next = s.phase === 'prep' && here?.foes ? [here] : []
  let at = s.at
  let shop = null
  let altar = null
  for (let step = 1; next.length < n && step <= RANKS; step++) {
    const ids = nodeOf(s.map, at)?.next ?? []
    if (!ids.length) break
    const id = ids.length > 1 ? routeStep(run, L, sit, at) : ids[0]
    const room = nodeOf(s.map, id)
    if (room.foes) next.push(room)
    if (room.type === 'shop') shop ??= step
    if (room.type === 'altar') altar ??= step
    at = id
  }
  const rank = here?.rank ?? 0
  const floor = s.map.nodes.filter((x) => x.foes && (x.rank > rank || (s.phase === 'prep' && x === here)))
  return { next, floor, shop, altar }
}
// The room the expert's route would walk into from room `at` of the floor, the army as it stands (pickRoute's choice,
// read as if the run stood on `at`, nothing noted in the audit).
function routeStep (run, L, sit, at) {
  const s = run.state
  const stood = { state: { ...s, at, phase: 'map' }, battle: null, setup: null }
  const up = standing(souls(s.party))
  const keeps = targetKinds(L.book ? targetOf(s) : null)
  const rooms = nodeOf(s.map, at).next.map((id) => scoutRoom(stood, nodeOf(s.map, id), up, keeps))
  const view = { ...sit, rank: nodeOf(s.map, at).rank, phase: 'map', rooms }
  const model = routeModel()
  if (model) return learnedRoute(model, stood, view).option.node.id
  return decide(TREES.route, view, rooms.map((room) => ({ node: nodeOf(s.map, room.id), v: roomFeatures(view, room) })), TUNING.expert.route).option.node.id
}

// A battle room as scouting shows it, once a room: its foes' worth (scoutRoom's threat), how many, their mean HP, DEF
// and hardest blow (their floor's mods counted), the share of them of each threat type (their kinds' own), its waves.
const roomReads = new Map()
function roomRead (s, room) {
  const key = JSON.stringify([s.floor, room.id, room.type, room.foes, room.waves?.map((w) => w.foes), s.scale])
  let r = roomReads.get(key)
  if (r) return r
  const foes = [...(room.foes ?? []), ...(room.waves ?? []).flatMap((w) => w.foes)]
  const mods = foeMods(s.floor, room.type === 'boss', s.scale)
  const t = Object.fromEntries(OUT_THREATS.map((k) => [k, 0]))
  let threat = 0
  let hp = 0
  let def = 0
  let raw = 0
  for (const f of foes) {
    const u = makeUnit(f.id, { lvl: f.lvl })
    const st = statsOf(u, mods)
    threat += worth(u, false, mods)
    hp += st.hp
    def += st.def
    raw += punch(u, mods)
    for (const k of unitDef(f.id).threats ?? []) if (k in t) t[k]++
  }
  const n = Math.max(1, foes.length)
  for (const k of OUT_THREATS) t[k] /= n
  r = { threat, foes: foes.length, hp: hp / n, def: def / n, raw: raw / n, waves: room.waves?.length ?? 0, type: room.type, t }
  if (roomReads.size > 5000) roomReads.clear()
  roomReads.set(key, r)
  return r
}

// The threats of rooms `reads` (roomRead's) the field `f` (fieldRead's) has no answer to: each room's share of foes that
// fly where none of the field strikes a flyer, that shoot (Reach) where none of it shoots, that hex, burn or bleed where
// none of it heals or cleanses; the mean over the rooms.
const gapOf = (reads, f) => (reads.length ? reads.reduce((n, r) => n + r.t.fly * (f.fly === 0) + r.t.reach * (f.reach === 0) + (r.t.drain + r.t.burn + r.t.bleed) * (f.tend === 0), 0) / reads.length : 0)

// The field a state would fight with, read (outforest.js FIELD_KEYS): its fieldable best (the strongest standing souls,
// wounds counted, as strength counts them, at most the Command), the field's strength (strength, a log), the book's worth
// of its target and how far along it is (bookValue, comboProgress), how many of the best answer flyers and shooters
// (ANSWERS) and the hexes and wounds (a heal of others or a cleanse), its shooters, its melee, its flyers, its
// menders, its blows' raw and its toughness (logs), its synergies (a summon counting as its kind, as the formation
// counts them) and the nearest one not held (the share of its needs met), its summons, its mean level, the most of its
// souls of one kin and of one role; and its target's id and the souls standing.
function fieldRead (s, L) {
  const up = standing(souls(s.party))
  const best = up.map((u) => ({ u, p: worth(u, L.ablate !== 'summons') * Math.sqrt(hpPct(u)) })).sort((a, b) => b.p - a.p).slice(0, fieldCap({ state: s })).map((x) => x.u)
  const target = L.book ? targetOf(s) : null
  const f = zeros(FIELD_KEYS)
  f.strength = Math.log(strength(s, L.ablate !== 'summons'))
  f.book = target ? comboWorth(s, target) * comboProgress(s, target) : 0
  f.progress = target ? comboProgress(s, target) : 0
  const kins = {}
  const roles = {}
  let lvl = 0
  for (const u of best) {
    const d = unitDef(u.id)
    const kit = kitOf(u)
    if (ANSWERS.fly(u)) f.fly++
    if (ANSWERS.reach(u)) f.reach++
    if (tends(u)) {
      f.tend++
      f.healers++
    }
    if (kit.some((a) => isBlow(a) && !a.melee)) f.ranged++
    if (meleeOnly(u)) f.melee++
    if (d.flies) f.flyers++
    f.dps += punch(u)
    f.tough += tough(u)
    f.summons += summonsOf(u)
    lvl += u.lvl
    kins[d.kin] = (kins[d.kin] ?? 0) + 1
    roles[d.role] = (roles[d.role] ?? 0) + 1
  }
  f.dps = Math.log(1 + f.dps)
  f.tough = Math.log(1 + f.tough)
  f.lvl = best.length ? lvl / best.length : 0
  f.kin = Math.max(0, ...Object.values(kins))
  f.role = Math.max(0, ...Object.values(roles))
  if (!s.ablate?.includes('synergies')) {
    const pieces = best.flatMap((u) => Array(1 + summonsOf(u)).fill(u))
    const held = activeSynergies(pieces)
    f.syn = held.length
    const c = { kin: {}, role: {} }
    for (const u of pieces) {
      const d = unitDef(u.id)
      c.kin[d.kin] = (c.kin[d.kin] ?? 0) + 1
      c.role[d.role] = (c.role[d.role] ?? 0) + 1
    }
    for (const syn of SYNERGIES) {
      if (held.includes(syn)) continue
      for (const axis of ['kin', 'role']) for (const [id, k] of Object.entries(syn.needs[axis] ?? {})) f.near = Math.max(f.near, Math.min(1, (c[axis][id] ?? 0) / k))
    }
  }
  return { f, best, target: target?.id ?? null, up: up.length }
}

// A kind as a candidate touches it, read at its level and tiers in state `s` (a soul of it at full HP): its role, whether
// it flies, shoots, fights in melee alone, heals or cleanses, gives an aura; its reach, tier, level, HP, ATK, DEF, Move,
// worth (a log), its footprint.
function kindRead (s, id, out) {
  const k = s.kinds[id] ?? { lvl: TUNING.level.base, tracks: [0, 0] }
  const u = makeUnit(id, { lvl: k.lvl, tracks: k.tracks })
  const d = unitDef(id)
  const st = statsOf(u)
  if (OUT_ROLES.includes(d.role)) put(out, `k.${d.role}`, 1)
  put(out, 'k.flies', !!d.flies)
  put(out, 'k.ranged', kitOf(u).some((a) => isBlow(a) && !a.melee))
  put(out, 'k.melee', meleeOnly(u))
  put(out, 'k.tends', tends(u))
  put(out, 'k.aura', !!auraOf(u))
  put(out, 'k.reach', reachOf(u))
  put(out, 'k.tier', d.tier)
  put(out, 'k.lvl', k.lvl)
  put(out, 'k.hp', st.hp)
  put(out, 'k.atk', st.atk)
  put(out, 'k.def', st.def)
  put(out, 'k.move', st.move)
  put(out, 'k.worth', Math.log(1 + worth(u)))
  put(out, 'k.size', sizeOf(u))
  return u
}

// How well a kind's soul `u` answers the threats of rooms `reads`: each room's share of flyers if it strikes one, of
// shooters if it shoots, of hexes, burns and bleeds if it heals or cleanses; the mean over the rooms.
const fitOf = (reads, u) => (reads.length ? reads.reduce((n, r) => n + r.t.fly * ANSWERS.fly(u) + r.t.reach * ANSWERS.reach(u) + (r.t.drain + r.t.burn + r.t.bleed) * tends(u), 0) / reads.length : 0)

// The reads the forest out of battle decides by (outforest.js: SIT_KEYS, CAND_KEYS), of decision `phase` ('recruit' or
// 'spend') at `run` (`sit` its survey) over candidates `cands` (recruitCandidates', spendCandidates': today's pick
// first). The situation once: where the run stands, the purse in tier prices (and against the cheapest next tier and
// recruit), the Monarch's and the souls' HP, the field's read (fieldRead), the rooms ahead (roomsAhead: the next battle
// room, the next three, the floor's still ahead, each read as scouting shows them: roomRead; the army's odds against
// them, the log of its strength over their threat, the least of the next three, the mean of the floor's; and the threats
// it has no answer to: gapOf), the Shop and the altar ahead (1 / (1 + the rooms on)). Each candidate: its actions
// applied to a copy (lightFork; a recruit of none and stopping change nothing), the kind it touches read (kindRead), what
// it is and grants, and the field's read of the state it leaves less this one's (d.*). No battle played. Every number
// rounded (outforest.js put): a label row's reads are play's. → { sit, f: [per candidate] }
export function outsideRead (run, L, sit, phase, cands) {
  sit ??= survey(run, L)
  const s = run.state
  const scale = tierScale(s.floor)
  const ahead = roomsAhead(run, L, sit)
  const reads = { n1: ahead.next.slice(0, 1).map((r) => roomRead(s, r)), n3: ahead.next.map((r) => roomRead(s, r)), fl: ahead.floor.map((r) => roomRead(s, r)) }
  const was = fieldRead(s, L)
  const x = zeros(SIT_KEYS)
  put(x, `phase.${s.phase}`, 1)
  put(x, 'floor', s.floor)
  put(x, 'rank', sit.rank)
  put(x, 'purse', s.essence / scale)
  put(x, 'purse.tier', sit.prices.tier ? s.essence / sit.prices.tier : 0)
  put(x, 'purse.recruit', sit.prices.recruit ? s.essence / sit.prices.recruit : 0)
  put(x, 'monarch', sit.monarch)
  put(x, 'monarch.hp', Math.max(0, monarchOf(s).hp))
  put(x, 'health', sit.health)
  put(x, 'fallen', sit.fallen)
  put(x, 'souls', was.up)
  put(x, 'room', rosterCap(run) - soulCount(s.party))
  put(x, 'command', sit.command)
  put(x, 'waiting', sit.waiting)
  put(x, 'relics', s.relics.length)
  put(x, 'unheld', sit.relics.unheld.length)
  put(x, 'cands', cands.length)
  put(x, 'shop', ahead.shop === null ? 0 : 1 / (1 + ahead.shop))
  put(x, 'altar', ahead.altar === null ? 0 : 1 / (1 + ahead.altar))
  for (const k of FIELD_KEYS) put(x, k, was.f[k])
  const odds = (r) => was.f.strength - Math.log(Math.max(1e-9, r.threat))
  for (const set of OUT_ROOMS) {
    const R = reads[set]
    if (!R.length) continue
    const mean = (g) => R.reduce((n, r) => n + g(r), 0) / R.length
    put(x, `${set}.rooms`, R.length)
    put(x, `${set}.threat`, Math.log(Math.max(1e-9, mean((r) => r.threat))))
    put(x, `${set}.odds`, set === 'fl' ? mean(odds) : Math.min(...R.map(odds)))
    for (const k of ['foes', 'hp', 'def', 'raw', 'waves']) put(x, `${set}.${k}`, mean((r) => r[k]))
    for (const t of OUT_THREATS) put(x, `${set}.t.${t}`, mean((r) => r.t[t]))
    put(x, `${set}.gap`, gapOf(R, was.f))
  }
  if (reads.n1.length) for (const type of ['elite', 'boss', 'siege']) put(x, `n1.${type}`, reads.n1[0].type === type)
  const f = cands.map((c) => candidateRead(run, L, c, reads, was, scale))
  return { sit: x, f }
}

// One candidate's read (outsideRead's), against `was` (the decision's field read).
function candidateRead (run, L, cand, reads, was, scale) {
  const s = run.state
  const out = zeros(CAND_KEYS)
  const acts = cand.actions.filter((a) => !(a.type === 'reap' && a.index === null))
  let st = s
  let sim = null
  if (acts.length) {
    sim = lightFork(run)
    for (const a of acts) apply(sim, a)
    st = sim.state
  }
  put(out, 'score', cand.score)
  put(out, 'cost', (s.essence - st.essence) / scale)
  const main = acts.find((a) => a.type !== 'release')
  let kind = null
  if (!main) put(out, 'none', 1)
  else if (main.type === 'upgrade') {
    put(out, 'tier', 1)
    kind = main.kind
    const no = st.kinds[kind].tracks[main.track]
    const tier = tracksOf(kind)[main.track].tiers[no - 1]
    put(out, 't.track', main.track)
    put(out, 't.no', no)
    put(out, 't.mods', !!tier.mods?.length)
    put(out, 't.ability', !!tier.ability)
    put(out, 't.aura', !!tier.aura)
    put(out, 't.summon', tier.summon ?? 0)
    put(out, 't.size', !!tier.size)
    put(out, 't.double', nextTier(sim, main))
  } else if (main.type === 'fuse') {
    put(out, 'fuse', 1)
    kind = fusionDef(main.id).result
    const parts = main.parts.map((uid) => s.party.find((u) => u.uid === uid))
    const made = st.party.find((u) => u.id === kind && !s.party.some((x) => x.uid === u.uid))
    const sum = parts.reduce((n, u) => n + worth(u), 0)
    put(out, 'u.parts', parts.length)
    put(out, 'u.worth', Math.log(1 + sum))
    put(out, 'u.gain', Math.log(1 + (made ? worth(made) : 0)) - Math.log(1 + sum))
    put(out, 'u.fielded', parts.filter((u) => was.best.includes(u)).length)
  } else if (main.type === 'reap') {
    put(out, 'recruit', 1)
    kind = s.offers[main.index].id
    put(out, 'r.new', !s.kinds[kind])
    const release = acts.find((a) => a.type === 'release')
    if (release) {
      const u = s.party.find((x) => x.uid === release.uid)
      const mean = was.best.reduce((n, x) => n + fieldPower(x), 0) / Math.max(1, was.best.length)
      put(out, 'r.release', 1)
      put(out, 'r.released', mean > 0 ? fieldPower(u) / mean : 0)
      put(out, 'r.kept', targetKinds(L.book ? targetOf(s) : null).has(u.id))
    }
  }
  if (kind) {
    const u = kindRead(st, kind, out)
    const target = L.book ? targetOf(s) : null
    put(out, 'k.count', standing(souls(st.party)).filter((x) => x.id === kind).length)
    put(out, 'k.fielded', was.best.filter((x) => x.id === kind).length)
    put(out, 'k.target', targetKinds(target).has(kind))
    for (const set of OUT_ROOMS) put(out, `fit.${set}`, fitOf(reads[set], u))
  }
  const now = sim ? fieldRead(st, L) : was
  for (const k of ['strength', 'book', 'progress', 'fly', 'reach', 'tend', 'ranged', 'melee', 'flyers', 'healers', 'dps', 'tough', 'syn', 'near', 'summons', 'lvl']) put(out, `d.${k}`, now.f[k] - was.f[k])
  put(out, 'd.target', now.target !== was.target)
  put(out, 'd.souls', now.up - was.up)
  put(out, 'd.purse', (st.essence - s.essence) / scale)
  for (const set of OUT_ROOMS) put(out, `d.gap.${set}`, gapOf(reads[set], now.f) - gapOf(reads[set], was.f))
  return out
}

// The candidate the expert takes at decision `phase` among `cands` (ranked: today's pick first): today's where the
// forest out of battle in use decides no such decision or reads none more than its margin above it, else the forest's.
function outChoice (run, L, sit, phase, cands) {
  const model = outForestModel()
  if (cands.length < 2 || !model?.phases?.[phase]) return cands[0]
  const read = phase === 'prep' ? prepRead(run, L, sit, cands, { boards: opensBoard(model.phases.prep) }) : outsideRead(run, L, sit, phase, cands)
  const pick = chooseOut(model, phase, read)
  if (pick.index > 0) noteRule(run, phase, { by: 'outforest' }, sit && surveyLine(sit))
  return cands[pick.index]
}

// ── the formation by the forest out of battle (outforest.js's prep) ──────────────────────────────

// The formations a prep's forest reads (prepCandidates), and the places among them its drafts may take.
export const PREP_CAP = 9
export const PREP_DRAFTS = 3
// What names a formation: the cells its pieces take (the Monarch's among them), whoever waits in the ossuary aside.
export const formationName = (party) => party.filter((u) => u.slot >= 0).map((u) => `${u.uid}@${u.slot}`).sort().join()
// Today's order of the formations a plan met (expert.js outranks, as a sort: the tree's filters' standing, first to
// last, then the static score; the order met where all are equal).
function byStanding (a, b) {
  for (let i = 0; i < a.keys.length; i++) if (a.keys[i] !== b.keys[i]) return b.keys[i] - a.keys[i]
  return b.score - a.score
}

// The formations a prep's forest reads, and outside.js's labels play out, at most `cap`: today's pick (plan `made`'s
// formation) first, then the plan's other formations in today's order (byStanding), the same formation once, to `cap`
// less `drafts`; then the best of its drafts not among them to `cap` (the zone drafts, the gate held, basic's three, the
// plan's own: formations of another shape, where today's next best are mostly today's with a piece or two moved); then,
// drafts short, today's order again to `cap`. Each with its read as the plan judged it. → { today (its id), cands: [{ id
// (formationName), label, goal ([{ uid, slot }]), party, v, keys, score, draft, rank (its place in the list) }] }
export function prepCandidates (run, L, made = plan(run, L), { cap = PREP_CAP, drafts = PREP_DRAFTS } = {}) {
  const today = formationName(made.party)
  const order = made.met.slice().sort(byStanding)
  const own = made.met.find((c) => formationName(c.party) === today)
  if (!own) throw new Error('the plan\'s formation is none it met')
  const list = [own]
  const seen = new Set([today])
  const fill = (to, keep = () => true) => {
    for (const c of order) {
      if (list.length >= to) break
      if (keep(c) && !seen.has(formationName(c.party))) {
        seen.add(formationName(c.party))
        list.push(c)
      }
    }
  }
  fill(cap - drafts)
  fill(cap, (c) => c.draft)
  fill(cap)
  return {
    today,
    cands: list.map((c, i) => ({
      id: formationName(c.party), label: i ? `formation ${i}${c.draft ? ' (a draft)' : ''}` : 'formation', goal: c.party.map((u) => ({ uid: u.uid, slot: u.slot })),
      party: c.party, v: c.v, keys: c.keys, score: c.score, draft: c.draft, rank: i
    }))
  }
}

// The expert's formation from plan `made`: its own, or the one the forest out of battle takes among prepCandidates where
// one decides the prep (outChoice). Never under the formation ablation (no search there: basic's cells).
function prepPick (run, L, made, sit) {
  if (!L.search || L.ablate === 'formation' || !outDecides('prep')) return made.party
  return outChoice(run, L, sit, 'prep', prepCandidates(run, L, made).cands).party
}

// The board formation `party` opens the coming battle on, as the battle will set it up (run.js battleSetup, the pieces
// on their cells and the foes on theirs: no turn played), read as the battle reads a board (policy.js situation, expert.js
// conditions).
const openingOf = (run, party) => conditions(situation(createBattle({ ...battleSetup(run, { party: party.filter((u) => u.slot >= 0) }), quiet: true })))

// The reads the forest out of battle decides a formation by (outforest.js PREP_SIT_KEYS, PREP_CAND_KEYS), of the prep at
// `run` (`sit` its survey) over formations `cands` (prepCandidates': today's pick first). The situation once: where the
// run stands (its floor, the room's rank and type), the Monarch's and the souls' HP, the field's read (fieldRead), the
// coming battle as scouting shows it (roomRead: the foes' worth and the army's odds, their HP, DEF and blows, their
// waves, the share of each threat type, those the field has no answer to; scout: its flyers, its shooters (a blow's
// reach of 2 or more, over any blocker), the farthest reach, the raw of all its blows and of the shooters' on the
// Monarch's HP, its boss, its roads' length, the threat map's weight), the camp's open cells and its gate, and what the
// opening board shows whatever the formation (OPENING_ROOM_KEYS, on today's pick's). Each formation: today's score of it
// and its place in the list, a draft or the climb's, formationFeatures' read (v.*), its shape against today's pick's (the
// pieces moved and the souls fielded in place of today's, those beside and near the seat, in the front row, the mean
// row, the lanes held, the 2×2 fielded, the gate's cells held, its shooters, melee, flyers and menders, the wounded and
// the HP share fielded), and the board it opens on (openingOf: OPENING_KEYS). Nothing read of where a soul stands now;
// no battle played. Every number rounded (outforest.js put): a label row's reads are play's. Without `boards` (for a
// forest that never reads them: outforest.js opensBoard) no opening board is made, and its reads (o.*) stay 0. → { sit,
// f: [per formation] }
export function prepRead (run, L, sit, cands, { boards = true } = {}) {
  sit ??= survey(run, L)
  const s = run.state
  const node = currentNode(run)
  const was = fieldRead(s, L)
  const room = roomRead(s, node)
  const foes = scout(run)
  const m = monarchOf(s)
  const x = zeros(PREP_SIT_KEYS)
  put(x, 'floor', s.floor)
  put(x, 'rank', sit.rank)
  for (const type of ['elite', 'boss', 'siege']) put(x, type, node.type === type)
  put(x, 'monarch', sit.monarch)
  put(x, 'monarch.hp', Math.max(0, m.hp))
  put(x, 'health', sit.health)
  put(x, 'fallen', sit.fallen)
  put(x, 'souls', was.up)
  put(x, 'command', sit.command)
  put(x, 'cands', cands.length)
  for (const k of FIELD_KEYS) put(x, `field.${k}`, was.f[k])
  put(x, 'room.threat', Math.log(Math.max(1e-9, room.threat)))
  put(x, 'room.odds', was.f.strength - Math.log(Math.max(1e-9, room.threat)))
  for (const k of ['foes', 'hp', 'def', 'raw', 'waves']) put(x, `room.${k}`, room[k])
  for (const t of OUT_THREATS) put(x, `room.t.${t}`, room.t[t])
  put(x, 'room.gap', gapOf([room], was.f))
  const onM = mitigation(m) / Math.max(1, m.hp)
  const ground = foes.filter((f) => !f.flies)
  put(x, 'scout.flyers', foes.length - ground.length)
  put(x, 'scout.shooters', foes.filter((f) => f.reach >= 2).length)
  put(x, 'scout.reach', Math.max(0, ...foes.map((f) => f.reach)))
  put(x, 'scout.raw', foes.reduce((n, f) => n + f.raw, 0) * onM)
  put(x, 'scout.far', foes.filter((f) => f.reach >= 2).reduce((n, f) => n + f.raw, 0) * onM)
  put(x, 'scout.boss', foes.some((f) => f.boss))
  put(x, 'scout.road', ground.length ? ground.reduce((n, f) => n + f.road.length, 0) / ground.length : 0)
  const ctx = formationContext(run, L)
  put(x, 'scout.mass', ctx.total)
  put(x, 'camp.open', openCells(s.camp).length)
  const gate = gateOf(s.camp)
  put(x, 'camp.gate', gate.length)
  const opened = cands.map((c) => (boards ? openingOf(run, c.party) : {}))
  for (const k of OPENING_ROOM_KEYS) put(x, `o.${k}`, opened[0][k] ?? 0)
  const own = cands[0]
  const f = cands.map((c, i) => formationRead(run, c, own, ctx.seat, gate, opened[i]))
  return { sit: x, f }
}

// One formation's read (prepRead's), against today's pick `own`; `opened` the board it opens on (openingOf).
function formationRead (run, c, own, seat, gate, opened) {
  const out = zeros(PREP_CAND_KEYS)
  put(out, 'score', c.score)
  put(out, 'rank', c.rank)
  put(out, 'draft', c.draft)
  for (const k of FORMATION_KEYS) put(out, `v.${k}`, c.v[k])
  const fielded = (party) => party.filter((u) => !isMonarch(u) && u.slot >= 0)
  const pieces = fielded(c.party)
  const at = new Map(fielded(own.party).map((u) => [u.uid, u.slot]))
  const mine = new Set(pieces.map((u) => u.uid))
  put(out, 'moved', pieces.filter((u) => at.get(u.uid) !== u.slot).length + [...at.keys()].filter((uid) => !mine.has(uid)).length)
  put(out, 'swapped', pieces.filter((u) => !at.has(u.uid)).length)
  const near = (u) => Math.min(...tilesAt(u, u.slot).map((t) => distance(t, seat)))
  put(out, 'seat1', pieces.filter((u) => near(u) <= 1).length)
  put(out, 'seat2', pieces.filter((u) => near(u) <= 2).length)
  put(out, 'front', pieces.filter((u) => cellsOf(u).some((cell) => rowOf(cell) === 0)).length)
  put(out, 'row', pieces.length ? pieces.reduce((n, u) => n + rowOf(u.slot), 0) / pieces.length : 0)
  put(out, 'lanes', new Set(pieces.flatMap((u) => cellsOf(u).map(colOf))).size)
  put(out, 'big', pieces.filter((u) => sizeOf(u) === 2).length)
  const held = new Set(pieces.flatMap(cellsOf))
  put(out, 'gate', gate.filter((cell) => held.has(cell)).length)
  put(out, 'shooters', pieces.filter((u) => kitOf(u).some((a) => isBlow(a) && !a.melee)).length)
  put(out, 'melee', pieces.filter(meleeOnly).length)
  put(out, 'flyers', pieces.filter((u) => !!unitDef(u.id).flies).length)
  put(out, 'menders', pieces.filter(tends).length)
  put(out, 'wounded', pieces.filter((u) => hpPct(u) < 0.5).length)
  put(out, 'hp', pieces.length ? pieces.reduce((n, u) => n + hpPct(u), 0) / pieces.length : 0)
  for (const k of OPENING_KEYS) put(out, `o.${k}`, opened[k] ?? 0)
  return out
}

// The expert's recruit as a candidate's actions (recruitCandidates'): today's, or the forest's (outChoice). Decided
// once a room, as weighRecruits decides (a release it needs leaves the offers as they were). → [action, …]
const outRecruits = new WeakMap()
export function recruitPick (run, L, sit = null) {
  const s = run.state
  const key = JSON.stringify([s.floor, s.at, s.offers.map((o) => o.id)])
  if (outRecruits.get(run)?.key === key) return outRecruits.get(run).actions
  const d = recruitCandidates(run, L, sit)
  const { actions } = outChoice(run, L, sit, 'recruit', outCandidates(d))
  outRecruits.set(run, { key, actions })
  return actions
}

// The expert's purchase: today's (grow's), or the forest's where one out of battle decides purchases (outChoice); null
// to stop. Decided once for each of grow's keys.
const outSpends = new WeakMap()
export function spendPick (run, L, sit = null) {
  const actions = [...fusionOptions(run, L), ...spendOptions(run, L)]
  const today = grow(run, L, actions, 'spend', sit)
  if (!actions.length || !outDecides('spend')) return today
  const key = growths.get(run).spend.key
  if (outSpends.get(run)?.key === key) return outSpends.get(run).pick
  const d = spendCandidates(run, L, sit)
  const pick = outChoice(run, L, sit, 'spend', outCandidates(d))
  const out = pick.id === d.today ? today : pick.actions[0] ?? null
  outSpends.set(run, { key, pick: out })
  return out
}

export function policy (run, rng, level = 'basic', turnOptions = null) {
  const L = typeof level === 'string' ? LEVELS[level] : level
  const s = run.state
  if (L.ablate) {
    if (!ABLATIONS.includes(L.ablate)) throw new Error(`unknown ablation "${L.ablate}": ${ABLATIONS.join(', ')}`)
    if (RULE_SWITCHES.includes(L.ablate) && !s.ablate?.includes(L.ablate)) throw new Error(`ablating ${L.ablate} needs a run made with it (ablatedRun)`)
  }
  if (s.phase === 'battle') return battleOrder(run, L, turnOptions)
  if (s.phase === 'draft') return pickDraft(run, L)
  // The expert's survey of the run, read once for this decision (basic reads none).
  const sit = L.spend || L.route ? survey(run, L) : null
  if (s.phase === 'map') return pickNode(run, rng, L, sit)
  if (s.phase === 'prep') return pickPrep(run, L, sit)
  if (s.phase === 'reap') return pickReap(run, L, sit)
  if (s.phase === 'shop') return pickShop(run, L, sit)
  if (s.phase === 'altar') return pickAltar(run, L, sit)
  throw new Error(`no policy for phase "${s.phase}"`)
}

// In a battle: the level's turn policy (turnsOf: LEVELS `turns`, End Turn alone under the orders ablation), planned
// once at the turn's start and given an order at a time, End Turn last, as playOut would give them (so a refight under
// the same policy plays the same battle); planned again should the next no longer be legal (an order given meanwhile by
// someone else: a test's). Under the audit, each of its decisions is noted with its rule. `turnOptions` go to the turn
// policy as they are (policy.js expertTurn's `record` and `explore`).
const planned = new WeakMap()
const same = (a, o) => a.type === o.type && a.uid === o.uid && a.tile === o.tile && a.ability === o.ability && a.target === o.target && a.id === o.id &&
  String(a.parts) === String(o.parts)
function battleOrder (run, L, turnOptions = null) {
  const b = run.battle
  // Past the sim's bound on turns, as playOut ends it: a stall (a passive side may hold a battle forever).
  if (stalled(b)) return { type: 'stall' }
  let p = planned.get(b)
  const stale = !p || p.turn !== b.turn || !p.orders.length || (p.orders[0].type !== 'end' && !legalOrders(b).some((a) => same(a, p.orders[0])))
  if (stale) {
    const note = audited(run) ? (r) => noteRule(run, r.decision, r, r.sit ? brief(r.sit) : `turn ${b.turn}`) : null
    planned.set(b, (p = { turn: b.turn, orders: TURNS[turnsOf(L)](b, { ...turnOptions, note }) }))
  }
  return p.orders.shift()
}

// Plays the run to the end. onBattle(battle, run) fires after each battle, once the run has moved on, and
// beforeFight(run) just before each fight is applied (the run as the battle will be set up from it); `turnOptions` go
// to every turn of the expert's (policy.js expertTurn: the learner's `record` and `explore`); `act(run, rng)`, where
// given, chooses every action in place of the level's policy (the harness's outside teacher: outside.js outsideTeacher). A
// clear is the end too: neither level descends past the Sovereign (the policy has nothing for 'over'), so
// the ladder's clears and floors keep their meaning; the endless floors are a player's (and a test's).
export function autoplay (run, { rng = createRng(run.state.seed).stream('autoplay'), level = 'basic', onBattle = null, beforeFight = null, turnOptions = null, act = null } = {}) {
  for (let guard = 0; run.state.phase !== 'over'; guard++) {
    if (guard > 1e5) throw new Error('autoplay is stuck')
    const was = run.state.phase
    const action = act ? act(run, rng) : policy(run, rng, level, turnOptions)
    if (action.type === 'fight') beforeFight?.(run)
    apply(run, action)
    // On turns a battle ends with an order, not with the fight that opened it.
    if (run.state.phase !== 'battle' && (action.type === 'fight' || was === 'battle')) onBattle?.(run.battle, run)
  }
  return run
}

// ── playing many runs ─────────────────────────────────────────────────────────────────────────────

// Of a battle's army (your pieces that took the board; not the Monarch, not shadows): how many there
// were, and how many acted at least once (an action event of theirs).
export function armyMeasures (b) {
  const mine = (uid) => {
    const u = b.byUid.get(uid)
    return !!u && u.side === 'party' && !u.shadow && u !== b.monarch
  }
  const army = new Set()
  const acted = new Set()
  for (const e of b.events) {
    if (e.type === 'battle:start') for (const u of e.units) if (mine(u.uid)) army.add(u.uid)
    if (e.type === 'action' && mine(e.actor)) acted.add(e.actor)
  }
  return { army: army.size, acted: [...army].filter((uid) => acted.has(uid)).length }
}

// A run's build, as the ladder's spread reads it: its Legendaries, the kin most of its fielded souls share
// (ties to the first by name; none without souls), and the tracks their kinds took.
const legendariesOf = (s) => s.relics.filter(legendary)
const buildOf = (s) => {
  const kins = {}
  for (const u of fielded(souls(s.party))) kins[unitDef(u.id).kin] = (kins[unitDef(u.id).kin] ?? 0) + 1
  const kin = Object.entries(kins).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '-'
  const tracks = [...new Set(fielded(souls(s.party)).flatMap((u) => tracksOf(u.id).filter((_, i) => u.tracks[i] > 0).map((t) => t.id)))].sort()
  return { legendaries: legendariesOf(s).sort().join('+') || '-', kin, tracks: tracks.join('+') || '-' }
}

// One seeded run at `level` (with `ablate`, that level with one mechanic taken away: ABLATIONS), as the
// reports need it: each battle as the retinue entered it (its pieces: not the Monarch, not the shadows it
// raised), its army (its pieces, how many fell, the summons its tiers brought, its 2×2 pieces, how many
// acted: armyMeasures), with
// `setups` what it was built from (for refighting) and with `snapshots` the run's state just before the fight
// (for refighting with a mechanic stripped: necessity; its log left out); how the run ended, what felled the
// Monarch, the army it ended with, its build (buildOf), and how many of each action it took (`acts`, by type;
// `tiers`: track tiers its kinds hold at the end; `relics` held, every copy, and the `legendaries` among them). With
// `forest` (a forest.json file's path, or 'none' for today's expert: withForest), that forest plays it, the one in use
// before put back after; `forest` in the result names the one that played (null for none); `route` ('hand', 'learned'
// for route.json, or a route file's path: withRoute) the route it walks; and `outforest` (an outforest.json file's
// path, or 'none': withOutForest) the forest out of battle that decides its recruits and purchases, `outforest` in the
// result; and `expert` (an expert file's path, expert.json's shape: withExpert) a whole expert, every part of it at
// once, the parts named beside it then set over it.
export function record ({ expert, forest, route, outforest, ...job }) {
  return withExpert(expert, () => withOutForest(outforest, () => withRoute(route, () => withForest(forest, () => recordRun(job)))))
}
// The harness's (redesign.md §3): `scale` the run's difficulty (createRun's), `act` its player in place of the level's
// policy (autoplay's: the outside teacher), and in the result the archetype it was committed to (commitOf: the caller's,
// withCommit), each battle's synergies your side held as it began (`syn`), its build (builtOf) and its margin (endOf).
function recordRun ({ seed, level, ablate = null, setups = false, snapshots = false, scale = 1, act = null }) {
  const battles = []
  const t0 = Date.now()
  const run = ablatedRun(seed, ablate, null, scale)
  const L = { ...LEVELS[level], ...(ablate && { ablate }) }
  let snap = null
  // The battle the run fell in: its room's rank and the share of its foes' HP removed (progressOf).
  let fell = null
  autoplay(run, {
    level: L,
    act,
    beforeFight: snapshots ? (r) => { snap = structuredClone({ ...r.state, log: [] }) } : null,
    onBattle: (b, r) => {
      if (b.winner !== 'party') fell = { rank: currentNode(r).rank, share: foeShare(b) }
      const party = b.units.filter((u) => u.side === 'party' && !u.shadow && u !== b.monarch)
      battles.push({
        floor: b.floor + (b.boss ? 'B' : ''),
        t: b.turn,
        stall: b.reason === 'stall',
        won: b.winner === 'party',
        lvl: party.reduce((n, u) => n + u.lvl, 0) / Math.max(1, party.length),
        size: party.length,
        roster: soulCount(r.state.party),
        foes: b.units.filter((u) => u.side === 'foe').length,
        relics: r.state.relics.length,
        raised: b.raised,
        pieces: party.length,
        fell: party.filter((u) => u.hp <= 0).length,
        summoned: b.units.filter((u) => u.summoned).length,
        waves: b.events.filter((e) => e.type === 'wave').length,
        foesIn: b.events.filter((e) => e.type === 'enter' && e.unit.side === 'foe').length,
        colossi: r.setup.party.filter((u) => u.uid !== 0 && sizeOf(u) === 2).length,
        syn: synergiesAt(b),
        lead: leadOf(r.setup.party.filter((u) => u.uid !== 0)),
        ...armyMeasures(b),
        camp: r.state.camp,
        setup: setups ? r.setup : undefined,
        snapshot: snapshots ? snap : undefined,
        outcome: snapshots ? { won: b.winner === 'party', t: b.turn, hash: timelineHash(b.events), turns: turnsOf(L) } : undefined
      })
    }
  })
  const s = run.state
  return {
    battles, result: s.result, floor: s.floor, camp: s.camp, relics: s.relics.length, reaped: s.stats.reaped,
    monarch: { maxHp: monarchOf(s).maxHp, command: fieldCap(run), copies: s.relics.filter(grantsArise).length, ...ariseOf(s) }, death: s.death, legendaries: legendariesOf(s), build: buildOf(s),
    ossuary: souls(s.party).filter((u) => u.slot < 0).length,
    acts: s.log.reduce((n, a) => ({ ...n, [a.type]: (n[a.type] ?? 0) + 1 }), {}),
    tiers: Object.values(s.kinds).reduce((n, k) => n + k.tracks[0] + k.tracks[1], 0),
    // How far it got (progressOf), and where it fell (null for a clear).
    progress: progressOf({ result: s.result, floor: s.floor, rank: fell?.rank ?? 1, share: fell?.share ?? 0 }),
    fell,
    commit: commitOf(),
    ...(scale !== 1 && { scale }),
    built: builtOf(run),
    end: endOf(run, battles),
    // Wall time of the run, in seconds (the only field that is not a pure function of the job).
    secs: (Date.now() - t0) / 1000,
    forest: forestModel()?.name ?? null,
    outforest: outForestModel()?.name ?? null
  }
}

// The model a job names (a forest, a forest out of battle, a whole expert: its configuration): its file (read once a
// worker), 'none' (or null) for none, or a configuration itself.
const MODELS = new Map()
export function modelOf (spec) {
  if (spec === 'none' || spec === null) return null
  if (typeof spec === 'object') return spec
  if (!MODELS.has(spec)) MODELS.set(spec, JSON.parse(fs.readFileSync(spec, 'utf8')))
  return MODELS.get(spec)
}
// `fn()` with the forest `spec` names in use (forest.js, the successor of redesign.md §2.23's ranker: a forest.json
// file's path, read once a worker; 'none' or null for none; a configuration itself: modelOf), the one in use before
// it put back after; `spec` undefined: whatever is in use (the shipped expert's). → what fn returns
export function withForest (spec, fn) {
  if (spec === undefined) return fn()
  const before = forestModel()
  useForest(modelOf(spec))
  try {
    return fn()
  } finally {
    useForest(before)
  }
}
// The same for the forest out of battle (outforest.js): `fn()` with the configuration `spec` names in use (an
// outforest.json file's path, read once a worker; 'none' or null for none: today's recruits and purchases; a
// configuration itself), the one in use before it put back after; undefined: whatever is in use (outforest.json where
// there is one). → what fn returns
export function withOutForest (spec, fn) {
  if (spec === undefined) return fn()
  const before = outForestModel()
  useOutForest(modelOf(spec))
  try {
    return fn()
  } finally {
    useOutForest(before)
  }
}
// The same for the route (useRoute): `fn()` walking route `spec`, 'hand' the hand-built (TREES.route and its weights),
// 'learned' the shipped expert's tree, a file's path that file's (read once a worker), the route in use before put back after;
// undefined: whatever is in use (ROUTE_LEARNED's). → what fn returns
const routeFiles = new Map()
export function withRoute (spec, fn) {
  if (spec === undefined) return fn()
  const before = routeModel()
  if (spec === 'hand') useRoute(false)
  else if (spec === 'learned') useRoute(shippedRoute())
  else {
    if (!routeFiles.has(spec)) routeFiles.set(spec, JSON.parse(fs.readFileSync(spec, 'utf8')))
    useRoute(routeFiles.get(spec))
  }
  try {
    return fn()
  } finally {
    useRoute(before ?? false)
  }
}
// The same for a whole expert (an expert file: expert.json's shape, its model tree at its top and its parts beside it,
// expert.js shippedFile): `fn()` with every part of it in use at once (the tree, the battle forest, the forests out of
// battle, the route: a part it lacks is none, today's for that decision), every part in use before put back after;
// `spec` an expert file's path (read once a worker) or a configuration itself; undefined: whatever is in use.
// → what fn returns
export function withExpert (spec, fn) {
  if (spec === undefined) return fn()
  const x = modelOf(spec)
  const before = { tree: expertModel(), forest: forestModel(), outforest: outForestModel(), route: routeModel() }
  useExpert(x)
  useForest(x?.forest ?? null)
  useOutForest(x?.outforest ?? null)
  useRoute(x?.route ?? false)
  try {
    return fn()
  } finally {
    useExpert(before.tree)
    useForest(before.forest)
    useOutForest(before.outforest)
    useRoute(before.route ?? false)
  }
}
// The player a paired comparison names (--paired's a or b): 'none', today's expert (no forest, whatever ships);
// `forest:<file>`, or a file, a forest; `route:<hand|learned|file>` the battle player in use (forest.json where it
// ships) walking that route; `outforest:<file|none>` the expert in use (its battle forest and route as they ship) with
// that forest out of battle, or none (today's recruits and purchases); `expert:<file>` a whole expert (withExpert). →
// the job's { forest }, { route }, { outforest } or { expert }
export function playerOf (spec) {
  if (spec === 'none') return { forest: 'none' }
  const whole = String(spec).match(/^expert:(.+)$/)
  if (whole) return { expert: whole[1] }
  const route = String(spec).match(/^route:(.+)$/)
  if (route) return { route: route[1] }
  const out = String(spec).match(/^outforest:(.+)$/)
  if (out) return { outforest: out[1] }
  return { forest: String(spec).match(/^forest:(.+)$/)?.[1] ?? spec }
}

// One seeded run at `level` with the audit on (AUDIT): what its plans considered and what it fought with, the
// recruits and fusions it weighed and took, and per battle Arise's raises and the party's synergies.
export function auditRecord ({ seed, level }) {
  const t0 = Date.now()
  const battles = { n: 0, won: 0, raised: 0, synergies: 0 }
  const run = createRun({ seed })
  resetAudit(true, run)
  autoplay(run, {
    level,
    beforeFight: (r) => chose(r.state, fielded(r.state.party)),
    onBattle: (b) => {
      battles.n++
      battles.won += b.winner === 'party'
      battles.raised += b.raised
      battles.synergies += b.events[0]?.synergies.filter((x) => x.side === 'party').length ?? 0
    }
  })
  const s = run.state
  const acts = {}
  for (const a of s.log) {
    acts[a.type] = (acts[a.type] ?? 0) + 1
  }
  const out = {
    seed, level, result: s.result, floor: s.floor, secs: (Date.now() - t0) / 1000, battles, acts,
    candidates: AUDIT.candidates, plans: AUDIT.plans, considered: AUDIT.considered, chosen: AUDIT.chosen, done: AUDIT.done, rules: AUDIT.rules,
    example: AUDIT.example
  }
  resetAudit(false)
  return out
}

// The audit (--audit): `runs` expert runs and one basic run, side by side, per mechanic: how often its plans
// considered it (formations met that use it, options weighed) and how often it chose it (formations fought
// that use it, actions taken).
async function audit ({ runs, seed: seed0 }) {
  const t0 = Date.now()
  const jobs = [...Array.from({ length: runs }, (_, k) => ({ seed: `${seed0}-${k + 1}`, level: 'expert', audit: true })), { seed: `${seed0}-1`, level: 'basic', audit: true }]
  const played = await playAll(jobs)
  const groups = [['expert', played.filter((r) => r.level === 'expert')], ['basic', played.filter((r) => r.level === 'basic')]]
  const sum = (rs, f) => rs.reduce((n, r) => n + (f(r) ?? 0), 0)
  console.log(`audit: ${runs} expert run(s) (seeds ${seed0}-1…${runs}) and one basic, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  for (const [level, rs] of groups) {
    console.log(`  ${level}: ${rs.map((r) => `${r.seed} ${r.result ?? 'over'} floor ${r.floor}, ${r.battles.n} battles, ${r.secs.toFixed(0)} s`).join('; ')}`)
  }
  const row = (name, considered, chosen) => console.log(`${name.padEnd(34)}${groups.map(([, rs]) => `${String(considered(rs)).padStart(11)}${String(chosen(rs)).padStart(9)}`).join('   ')}`)
  console.log(`\n${''.padEnd(34)}${groups.map(([l]) => `${l.padStart(11)} ${''.padStart(8)}`).join('   ')}`)
  console.log(`${'mechanic'.padEnd(34)}${groups.map(() => `${'considered'.padStart(11)}${'chosen'.padStart(9)}`).join('   ')}`)
  row('formations (met/fought)', (rs) => sum(rs, (r) => r.candidates), (rs) => sum(rs, (r) => r.plans))
  for (const f of FEATURES) row(f, (rs) => sum(rs, (r) => r.considered[f]), (rs) => sum(rs, (r) => r.chosen[f]))
  const fusions = (book) => (r) => Object.entries(r[book]).reduce((n, [k, v]) => n + (k.startsWith('fuse ') ? v : 0), 0)
  row('fuse (weighed/done)', (rs) => sum(rs, fusions('considered')), (rs) => sum(rs, (r) => r.acts.fuse))
  row('recruit (weighed/done)', (rs) => sum(rs, (r) => r.considered.recruit), (rs) => sum(rs, (r) => r.done.recruit))
  row('release (done)', () => '-', (rs) => sum(rs, (r) => r.acts.release))
  row('relic bought (done)', () => '-', (rs) => sum(rs, (r) => r.acts.buy))
  row('relic given (weighed/done)', (rs) => sum(rs, (r) => r.considered.hold), (rs) => sum(rs, (r) => r.acts.hold))
  row('upgrade (weighed/bought)', (rs) => sum(rs, (r) => r.considered.upgrade), (rs) => sum(rs, (r) => r.done.upgrade))
  // Which rule of the tree decided each decision, or the weights alone, over the expert's runs, with the situation
  // the first such decision was read in.
  const experts = groups[0][1]
  const rules = {}
  for (const r of experts) for (const [k, n] of Object.entries(r.rules)) rules[k] = (rules[k] ?? 0) + n
  console.log('\nthe expert\'s decisions, by the rule that decided them (the weights where none did), and the first one\'s situation:')
  for (const [k, n] of Object.entries(rules).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    console.log(`  ${k.padEnd(32)} ${String(n).padStart(7)}  ${experts.map((r) => r.example[k]).find(Boolean) ?? ''}`)
  }
  console.log('\nfought, per level:')
  for (const [level, rs] of groups) {
    const n = Math.max(1, sum(rs, (r) => r.battles.n))
    console.log(`  ${level}: Arise ${(sum(rs, (r) => r.battles.raised) / n).toFixed(2)} raises and ${(sum(rs, (r) => r.battles.synergies) / n).toFixed(2)} synergies a battle; ${sum(rs, (r) => r.battles.won)}/${n} won`)
  }
}

// How far a run got, from 0 to 1: the rooms it completed out of the rooms on the full route to the Sovereign
// (ROOMS_PER_FLOOR a floor, TUNING.run.floors floors), with partial credit for the battle it fell in: the share
// of that battle's foe HP it removed (foeShare) counts as that share of its room. 1 for a clear (the Sovereign
// slain). `rank` is the rank of the room it fell in (1 … ROOMS_PER_FLOOR: the rooms before it on its floor are
// completed); `share` in [0, 1]. Continuous where the clear rate is all or nothing, so far less noisy run for run.
export const ROOMS_PER_FLOOR = RANKS - 1
export const routeRooms = () => ROOMS_PER_FLOOR * TUNING.run.floors
export function progressOf ({ result, floor, rank = 1, share = 0 }) {
  if (result === 'victory') return 1
  const done = (floor - 1) * ROOMS_PER_FLOOR + (rank - 1) + Math.min(1, Math.max(0, share))
  return Math.min(1, Math.max(0, done / routeRooms()))
}
// The share of a battle's foe HP removed: of the foes that stood on the board or were still to come (the
// reserve's waves), shadows left out (they are no foe the room brought).
export function foeShare (b) {
  let hp = 0
  let max = 0
  for (const u of [...b.units, ...b.reserve]) {
    if ((u.side ?? 'party') !== 'foe' || u.shadow) continue
    hp += Math.max(0, u.hp)
    max += u.maxHp
  }
  return max ? 1 - hp / max : 0
}

// Plays every job in worker threads, one per core (or WORKERS: --workers), and returns the results in the jobs' order.
// The workers live for the whole call, each playing job after job, the longest first (jobTime: how long the job took
// the last time it was played here, else a guess), so the pool ends on short jobs. Which job runs where and when
// changes no result: a run is a pure function of its job.
let WORKERS = null
async function playAll (jobs) {
  const { Worker } = await import('node:worker_threads')
  const { availableParallelism } = await import('node:os')
  const times = loadTimes()
  const out = new Array(jobs.length)
  const queue = [...jobs.keys()].sort((a, b) => jobTime(jobs[b], times) - jobTime(jobs[a], times) || a - b)
  const worker = async () => {
    const w = new Worker(new URL(import.meta.url), { workerData: { pool: true } })
    try {
      while (queue.length) {
        const i = queue.shift()
        const t0 = Date.now()
        out[i] = await new Promise((resolve, reject) => {
          const off = () => { w.off('message', done); w.off('error', fail); w.off('exit', exit) }
          const done = (msg) => { off(); resolve(msg) }
          const fail = (err) => { off(); reject(err) }
          const exit = (code) => { off(); reject(new Error(`worker exited with ${code}`)) }
          w.on('message', done)
          w.on('error', fail)
          w.on('exit', exit)
          w.postMessage(jobs[i])
        })
        times[jobKey(jobs[i])] = (Date.now() - t0) / 1000
      }
    } finally {
      await w.terminate()
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs.length, WORKERS ?? availableParallelism()) }, worker))
  saveTimes(times)
  return out
}

// How long each job took when last played on this machine, in seconds, by its seed, level and ablation (a
// small file in the OS's temp directory; read only to order the next pool's jobs, and never needed: without
// it the guess orders them).
const TIMES = 'retinue-job-times.json'
const timeKey = (job) => job.refight ? null : `${job.seed}|${job.level}|${job.ablate ?? ''}${job.forest && job.forest !== 'none' ? `|forest:${job.forest}` : ''}${job.route ? `|route:${job.route}` : ''}${job.outforest ? `|outforest:${job.outforest}` : ''}${job.expert ? `|expert:${job.expert}` : ''}`
function loadTimes () {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.tmpdir(), TIMES), 'utf8'))
  } catch { return {} }
}
function saveTimes (times) {
  delete times.null
  try { fs.writeFileSync(path.join(os.tmpdir(), TIMES), JSON.stringify(times)) } catch {}
}
// A job's expected length: its last time if known, else a guess (an expert run far longer than a basic one, the
// full expert longest of all: it lives longest; a chunk of refights all alike; the outside teacher's far longer).
const jobTime = (job, times) => times[jobKey(job)] ?? (job.refight || job.level === 'basic' ? 1 : job.player === 'teacher' ? 67 : job.ablate ? 4 : 5)

// ── balance report ─────────────────────────────────────────────────────────────────────────────

// Autoplays `runs` seeded runs and prints clear rate, battle length, per-floor progression and how each
// camp layout fares: a camp far off its floor's average is a balance outlier.
// With `ablate`, the level with that mechanic taken away (ABLATIONS); with `forest` (a file, or 'none'), that forest's.
async function report ({ runs, seed: seed0, level, ablate = null, forest }) {
  const played = await playAll(Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level, ablate, ...(forest !== undefined && { forest }) })))
  const battles = played.flatMap((r) => r.battles)
  const turns = battles.map((b) => b.t).sort((a, b) => a - b)
  const deaths = {}
  const floors = {} // floor (B = boss) → sums at the start of each battle there
  const camps = {} // camp id → { battles, won, ended: runs lost in it }
  for (const b of battles) {
    const f = (floors[b.floor] ??= { n: 0, lvl: 0, size: 0, roster: 0, foes: 0, relics: 0, won: 0 })
    f.n++
    for (const k of ['lvl', 'size', 'roster', 'foes', 'relics', 'won']) f[k] += b[k]
    const c = (camps[b.camp] ??= { battles: 0, won: 0, ended: 0 })
    c.battles++
    c.won += b.won
  }
  for (const r of played) {
    if (r.result === 'defeat') camps[r.camp].ended++
    if (r.result !== 'victory') deaths[r.floor] = (deaths[r.floor] ?? 0) + 1
  }
  const sum = (key) => played.reduce((n, r) => n + r[key], 0)
  const q = (p) => turns[Math.min(turns.length - 1, Math.floor(p * turns.length))]
  const pct = (n) => `${(100 * n / runs).toFixed(1)}%`
  console.log(`runs ${runs} (seed ${seed0}, ${level} player${ablate ? `, ${ablate} ablated` : ''}${forest !== undefined ? `, forest ${forest}` : ''})`)
  console.log(`clear rate        ${pct(played.filter((r) => r.result === 'victory').length)}`)
  for (let f = 1; f <= TUNING.run.floors; f++) console.log(`deaths on floor ${f} ${pct(deaths[f] ?? 0)}`)
  console.log(`battles           ${turns.length}, ${(turns.length / runs).toFixed(1)} per run`)
  console.log(`battle turns      median ${q(0.5)}, p90 ${q(0.9)}, max ${turns.at(-1)}, stalls ${battles.filter((b) => b.stall).length}`)
  console.log(`mean souls reaped ${(sum('reaped') / runs).toFixed(2)}`)
  console.log('\nper floor, averaged over battles fought there (retinue as it entered the battle):')
  console.log('floor  battles  won    field lvl  fielded  roster  foes  relics')
  for (const [k, f] of Object.entries(floors)) {
    const avg = (v, d = 1) => (v / f.n).toFixed(d)
    console.log(`${k.padEnd(5)}  ${String(f.n).padStart(7)}  ${pct(f.won * runs / f.n).padStart(5)}  ${avg(f.lvl).padStart(9)}  ${avg(f.size).padStart(7)}  ${avg(f.roster).padStart(6)}  ${avg(f.foes).padStart(4)}  ${avg(f.relics).padStart(6)}`)
  }
  console.log('\nper camp (battles fought in it; runs that ended there in defeat):')
  console.log('floor  camp               battles  won     defeats')
  for (const [id, c] of Object.entries(camps).sort((a, b) => campDef(a[0]).floor - campDef(b[0]).floor || a[0].localeCompare(b[0]))) {
    console.log(`${String(campDef(id).floor).padEnd(5)}  ${campDef(id).name.padEnd(17)}  ${String(c.battles).padStart(7)}  ${(100 * c.won / c.battles).toFixed(1).padStart(5)}%  ${String(c.ended).padStart(7)}`)
  }
}

// ── two players on the same seeds ────────────────────────────────────────────────────────────────

// Runs `A` and `B` (record's results, seed for seed) of two players compared: each one's clears, progress (the mean of
// progressOf, in points), battles won and fought, runs ended by floor and seconds a run; and B against A, seed for
// seed, the clears B won (A did not clear the seed, B did) and lost, and the progress difference (B − A) with one
// standard error of the paired difference. → { runs, a, b, won, lost, diff, se }
export function pairedStats (A, B) {
  const side = (R) => {
    const battles = R.flatMap((r) => r.battles)
    const deaths = {}
    for (const r of R) if (r.result !== 'victory') deaths[r.floor] = (deaths[r.floor] ?? 0) + 1
    return {
      clears: R.filter((r) => r.result === 'victory').length,
      progress: 100 * R.reduce((n, r) => n + r.progress, 0) / Math.max(1, R.length),
      battles: battles.length,
      won: battles.filter((b) => b.won).length,
      deaths,
      secs: R.reduce((n, r) => n + r.secs, 0) / Math.max(1, R.length)
    }
  }
  const n = Math.min(A.length, B.length)
  const d = Array.from({ length: n }, (_, i) => 100 * (B[i].progress - A[i].progress))
  const diff = d.reduce((x, y) => x + y, 0) / Math.max(1, n)
  const se = n > 1 ? Math.sqrt(d.reduce((x, y) => x + (y - diff) ** 2, 0) / (n - 1) / n) : 0
  const cleared = (r) => r.result === 'victory'
  return {
    runs: n,
    a: side(A.slice(0, n)),
    b: side(B.slice(0, n)),
    won: A.slice(0, n).filter((r, i) => !cleared(r) && cleared(B[i])).length,
    lost: A.slice(0, n).filter((r, i) => cleared(r) && !cleared(B[i])).length,
    diff,
    se
  }
}

// The same `runs` seeds played by the expert as players `a` and `b` (each a forest file, a part or a whole expert, or
// 'none' for today's expert: playerOf; redesign.md §2.23), and their paired report (pairedStats). A run is a pure
// function of its seed and its player: every difference is the players'.
async function paired ({ runs, seed: seed0, level, players }) {
  const [a, b] = players
  const seeds = Array.from({ length: runs }, (_, i) => `${seed0}-${i}`)
  const all = await playAll([a, b].flatMap((spec) => seeds.map((seed) => ({ seed, level, ...playerOf(spec) }))))
  const S = pairedStats(all.slice(0, runs), all.slice(runs))
  const pct = (k, of = runs) => `${(100 * k / Math.max(1, of)).toFixed(1)}%`
  const floors = [...new Set([...Object.keys(S.a.deaths), ...Object.keys(S.b.deaths)])].sort()
  console.log(`paired: ${runs} seeds ${seed0}-0…${seed0}-${runs - 1}, ${level} player; a = ${a}, b = ${b}`)
  console.log('      clears   progress  battles won        ' + floors.map((f) => `died fl ${f}`.padStart(10)).join('') + '  s/run')
  for (const [k, x] of [['a', S.a], ['b', S.b]]) {
    console.log(`${k}     ${pct(x.clears).padStart(6)}  ${x.progress.toFixed(1).padStart(9)}  ${`${pct(x.won, x.battles)} (${x.won}/${x.battles})`.padStart(19)}` +
      floors.map((f) => String(x.deaths[f] ?? 0).padStart(10)).join('') + `  ${x.secs.toFixed(2).padStart(5)}`)
  }
  console.log(`b against a: clears won ${S.won}, lost ${S.lost} (net ${S.won - S.lost >= 0 ? '+' : ''}${S.won - S.lost}); ` +
    `progress ${S.diff >= 0 ? '+' : ''}${S.diff.toFixed(2)} ± ${S.se.toFixed(2)} points (one standard error of the paired difference)`)
  return S
}

// ── skill ladder ─────────────────────────────────────────────────────────────────────────────────

// What ended a run, one cause per defeat: the Monarch's killer's own first threat, or 'stall' for a battle played
// past the sim's bound on turns (turns.js stalled: no clock, a passive side held it); none for a run that did not end
// in one. Depth (the killer came in a later wave: death.wave) is counted apart (see ladder), so the causes add up to
// the defeats.
export const causesOf = (death) => !death ? [] : [death.reason === 'stall' ? 'stall' : death.threat ?? 'none']

// The same seeds at every level: how far planning lifts a run over rules of thumb. The gap between
// basic and expert is the game's skill range; a gap near zero means the choices barely matter, and an
// expert clear rate near 100% means a planner has solved it. With `forest` (a file, or 'none'), that forest's.
async function ladder ({ runs, seed: seed0, forest }) {
  const levels = Object.keys(LEVELS)
  const played = await playAll(levels.flatMap((level) => Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level, ...(forest !== undefined && { forest }) }))))
  console.log(`runs ${runs} per level (seed ${seed0}${forest !== undefined ? `, forest ${forest}` : ''}), the same seeds at each`)
  console.log('level    clear  died on floor 1      2      3      4  battles won  relics  reaped')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const pct = (n, d = runs) => `${(100 * n / d).toFixed(1)}%`
    const died = (f) => pct(mine.filter((r) => r.result !== 'victory' && r.floor === f).length).padStart(7)
    const battles = mine.flatMap((r) => r.battles)
    const avg = (key) => (mine.reduce((n, r) => n + r[key], 0) / runs).toFixed(1)
    console.log(`${level.padEnd(6)}  ${pct(mine.filter((r) => r.result === 'victory').length).padStart(6)}  ${' '.repeat(8)}${[1, 2, 3, 4].map(died).join('')}  ${pct(battles.filter((b) => b.won).length, battles.length).padStart(11)}  ${avg('relics').padStart(6)}  ${avg('reaped').padStart(6)}`)
  })
  // The Monarch at the run's end (its max HP, its Command, Arise's copies: all relics'), shadows raised per battle,
  // and what ended the run, by the killer's first threat or a stall (causesOf).
  console.log('\nlevel   monarch hp  com  arise  raised/battle  deaths by threat')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const avg = (f) => (mine.reduce((n, r) => n + f(r), 0) / runs).toFixed(1)
    const battles = mine.flatMap((r) => r.battles)
    const causes = {}
    for (const r of mine) for (const k of causesOf(r.death)) causes[k] = (causes[k] ?? 0) + 1
    const tally = Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '-'
    const raised = (battles.reduce((n, b) => n + b.raised, 0) / Math.max(1, battles.length)).toFixed(2)
    console.log(`${level.padEnd(6)}  ${avg((r) => r.monarch.maxHp).padStart(10)}  ${avg((r) => r.monarch.command).padStart(3)}  ${avg((r) => r.monarch.copies).padStart(5)}  ${raised.padStart(13)}  ${tally}`)
  })
  // The army: pieces in the ossuary at the run's end; per battle, the pieces fielded, the pieces that fell, the
  // summons their tiers brought, and the 2×2 pieces fielded.
  console.log('\nlevel    ossuary   pieces/battle  fell/battle  summons/battle  2×2/battle')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const avg = (f) => (mine.reduce((n, r) => n + f(r), 0) / runs).toFixed(1)
    const battles = mine.flatMap((r) => r.battles)
    const per = (key) => (battles.reduce((n, b) => n + b[key], 0) / Math.max(1, battles.length)).toFixed(2)
    console.log(`${level.padEnd(6)}  ${avg((r) => r.ossuary).padStart(8)}  ${per('pieces').padStart(14)}  ${per('fell').padStart(11)}  ${per('summoned').padStart(14)}  ${per('colossi').padStart(10)}`)
  })
  // The enemy as an army: foe waves that entered and foes that entered after the start, per battle; and the
  // Monarch's deaths by threat, floor by floor.
  console.log('\nlevel   waves/battle  foes in/battle  Monarch deaths by threat, by floor')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const battles = mine.flatMap((r) => r.battles)
    const per = (key) => (battles.reduce((n, b) => n + b[key], 0) / Math.max(1, battles.length)).toFixed(2)
    const floors = {}
    for (const r of mine) {
      if (!r.death) continue
      const f = (floors[r.floor] ??= {})
      for (const k of causesOf(r.death)) f[k] = (f[k] ?? 0) + 1
    }
    const tally = Object.entries(floors).sort((a, b) => a[0] - b[0])
      .map(([f, c]) => `${f}: ${Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`).join('; ') || '-'
    console.log(`${level.padEnd(6)}  ${per('waves').padStart(12)}  ${per('foesIn').padStart(14)}  ${tally}`)
  })
  // reDESIGN's "How to measure it", against its targets: the share of the army that acted at least once
  // (70%+), of defeats where the Monarch died (30–60%), the largest single cause's share of those deaths (no threat
  // above 40%), the deaths by a foe of a later wave (depth) and the defeats by a stall (no Monarch died: a battle
  // played past the sim's bound on turns); the median battle length by floor; and the build
  // spread in wins (no build in more than ~25%): the commonest Legendaries, kin and tracks.
  console.log('\nlevel   acted  Monarch deaths/defeats  top threat  depth  stalls')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const battles = mine.flatMap((r) => r.battles)
    const share = (n, d) => (d ? `${(100 * n / d).toFixed(0)}%` : '-')
    const army = battles.reduce((n, b) => n + b.army, 0)
    const lost = mine.filter((r) => r.death)
    const killed = lost.filter((r) => r.death.reason === 'monarch')
    const causes = {}
    for (const r of killed) for (const k of causesOf(r.death)) causes[k] = (causes[k] ?? 0) + 1
    const top = Object.entries(causes).sort((a, b) => b[1] - a[1])[0]
    const cols = [
      level.padEnd(6),
      share(battles.reduce((n, b) => n + b.acted, 0), army).padStart(5),
      `${killed.length}/${lost.length} ${share(killed.length, lost.length)}`.padStart(22),
      (top ? `${top[0]} ${share(top[1], killed.length)}` : '-').padStart(10),
      String(killed.filter((r) => r.death.wave).length).padStart(5),
      String(lost.length - killed.length).padStart(6)
    ]
    console.log(cols.join('  '))
  })
  console.log('\nlevel   median battle turns by floor')
  levels.forEach((level, i) => {
    const floors = {}
    for (const b of played.slice(i * runs, (i + 1) * runs).flatMap((r) => r.battles)) (floors[b.floor] ??= []).push(b.t)
    const median = (ts) => ts.sort((a, b) => a - b)[Math.floor(ts.length / 2)]
    console.log(`${level.padEnd(6)}  ${Object.entries(floors).sort((a, b) => parseInt(a[0]) - parseInt(b[0]) || a[0].length - b[0].length).map(([f, ts]) => `${f}: ${median(ts)} (${ts.length})`).join('  ') || '-'}`)
  })
  console.log('\nlevel   wins  build spread in wins: the commonest Legendaries, kin, tracks, and Legendaries+kin')
  levels.forEach((level, i) => {
    const wins = played.slice(i * runs, (i + 1) * runs).filter((r) => r.result === 'victory')
    const commonest = (f) => {
      const n = {}
      for (const r of wins) n[f(r.build)] = (n[f(r.build)] ?? 0) + 1
      const [k, c] = Object.entries(n).sort((a, b) => b[1] - a[1])[0] ?? ['-', 0]
      return `${k} ${wins.length ? (100 * c / wins.length).toFixed(0) : 0}%`
    }
    console.log(`${level.padEnd(6)}  ${String(wins.length).padStart(4)}  ${[(b) => b.legendaries, (b) => b.kin, (b) => b.tracks, (b) => `${b.legendaries}|${b.kin}`].map(commonest).join('; ')}`)
  })
  // The diversity block (the harness's: redesign.md §2's criterion 3), a level at a time.
  levels.forEach((level, i) => {
    console.log('')
    for (const line of diversityLines(diversity(played.slice(i * runs, (i + 1) * runs)), level)) console.log(line)
  })
}

// ── decisions report ─────────────────────────────────────────────────────────────────────────────

// How much the player's formation decides battles: every battle the autoplayer fights is fought again
// `tries` times with its souls in random open cells. A choice that never changes the result is
// cosmetic; one that always does makes a bad pick an automatic loss. Aim for the share decided by the
// cells to sit around 30–40% on floors 2–4. Most fights are wins either way, so HP kept (the share of
// the field's HP still standing at the end, 0 for a loss) shows what a formation is worth when it is
// not the result: wounds carry over to the next fight.
async function decisions ({ runs, seed: seed0, level, tries = 8 }) {
  const played = await playAll(Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level, setups: true })))
  const setups = played.flatMap((r) => r.battles.map((b) => b.setup))
  const rng = createRng(seed0).stream('decisions')
  const floors = {}
  const KEYS = ['n', 'auto', 'random', 'decided', 'autoHp', 'randomHp', 'spreadHp']
  for (const setup of setups) {
    const fight = (party) => {
      const b = playOut(createBattle({ ...setup, party, quiet: true }), TURNS[turnsOf(LEVELS[level])])
      const mine = b.units.filter((u) => u.side === 'party' && !u.shadow && !u.into)
      const hp = b.winner === 'party' ? mine.reduce((n, u) => n + u.hp, 0) / mine.reduce((n, u) => n + u.maxHp, 0) : 0
      return { won: b.winner === 'party', hp }
    }
    const open = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(setup.camp, slot))
    // Each piece on a random open cell where its whole footprint fits, the Monarch on its seat; a piece that fits
    // nowhere left sits out.
    const shuffle = (party) => {
      const cells = rng.shuffle(open)
      const taken = new Set()
      const out = []
      for (const u of [...party].sort((x, y) => isMonarch(y) - isMonarch(x))) {
        const size = u.size ?? sizeOf(u)
        const slot = isMonarch(u) ? monarchSlot(setup.camp) : cells.find((c) => fits(setup.camp, c, size, taken))
        if (slot === undefined) continue
        for (const c of footprintSlots(slot, size) ?? [slot]) taken.add(c)
        out.push({ ...u, slot })
      }
      return out
    }
    const auto = fight(setup.party)
    const random = Array.from({ length: tries }, () => fight(shuffle(setup.party)))
    const wins = random.filter((t) => t.won).length
    const f = (floors[setup.floor + (setup.boss ? 'B' : '')] ??= Object.fromEntries(KEYS.map((k) => [k, 0])))
    f.n++
    f.auto += auto.won
    f.random += wins / tries
    f.decided += wins > 0 && wins < tries
    f.autoHp += auto.hp
    f.randomHp += random.reduce((n, t) => n + t.hp, 0) / tries
    f.spreadHp += Math.max(...random.map((t) => t.hp)) - Math.min(...random.map((t) => t.hp))
  }
  const pct = (v, n) => `${(100 * v / n).toFixed(1)}%`
  const all = Object.fromEntries(KEYS.map((k) => [k, Object.values(floors).reduce((a, f) => a + f[k], 0)]))
  console.log(`runs ${runs} (seed ${seed0}, ${level} player), ${all.n} battles, each refought ${tries}× with the souls in random cells`)
  console.log('decided: the share of battles whose result changes with where the souls stand.')
  const COLS = [['autoplayer', 'auto'], ['random', 'random'], ['decided', 'decided'],
    ['autoplayer', 'autoHp'], ['random', 'randomHp'], ['best−worst', 'spreadHp']]
  const width = (name) => Math.max(6, name.length)
  const groups = [['won', 2], ['', 1], ['HP kept', 3]]
  let at = 0
  console.log(' '.repeat(16) + groups.map(([name, n]) => {
    const w = COLS.slice(at, (at += n)).reduce((a, [c]) => a + width(c) + 2, 0)
    return name.padEnd(w)
  }).join('').trimEnd())
  console.log('floor  battles  ' + COLS.map(([c]) => c.padStart(width(c))).join('  '))
  for (const [k, f] of [...Object.entries(floors), ['all', all]]) {
    console.log(`${k.padEnd(5)}  ${String(f.n).padStart(7)}  ` + COLS.map(([c, key]) => pct(f[key], f.n).padStart(width(c))).join('  '))
  }
}

// ── ablations: what each mechanic carries ────────────────────────────────────────────────────────────

// The full expert and the expert with each mechanic taken away (ABLATIONS), on the same `runs` seeds, every run
// in one pool: clear rate, where the runs died, what felled the Monarch, and the clear rate's drop against the
// full expert in points. `uses` counts what each variant did over its runs (actions by type, tiers held at the
// end, Legendaries and other relics taken), so an ablation can be seen to take its mechanic away. `variants` (the CLI's
// `--variants fusions,summons`) plays only those ablations beside the full expert, for a quicker check. Each drop
// is checked against its band (BANDS): a core mechanic should cost 25–50 points, an extra one 8–25. The core: the
// orders given in battle, the tracks and the summons a piece's tiers bring. MEASURED: played and reported, against no
// band: the formation, reclassified out of the core on 2026-10-11 (the user's call, after the balance pass measured it
// at 2 points: pieces move in battle, so the orders absorb most of where a piece starts; redesign.md §6); and the
// moves (redesign.md §2.18: what the plan's walking is worth).
export const CORE = ['orders', 'tracks', 'summons']
export const EXTRA = ['fusions', 'legendaries', 'relics', 'synergies']
export const MEASURED = ['formation', 'moves']
export const BANDS = { ...Object.fromEntries(CORE.map((m) => [m, [25, 50]])), ...Object.fromEntries(EXTRA.map((m) => [m, [8, 25]])) }
async function ablations ({ runs, seed: seed0, variants = ABLATIONS, out = null }) {
  variants = [null, ...variants]
  const t0 = Date.now()
  const played = await playAll(variants.flatMap((ablate) => Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level: 'expert', ablate }))))
  // With `out`, every run's outcome as JSON (for pairing two sweeps seed by seed).
  if (out) {
    fs.writeFileSync(out, JSON.stringify({
      runs, seed: seed0, minutes: (Date.now() - t0) / 60000,
      played: played.map((r, i) => ({ seed: `${seed0}-${i % runs}`, ablate: variants[Math.floor(i / runs)], result: r.result, floor: r.floor, fell: r.fell, progress: r.progress, secs: r.secs }))
    }, null, 1))
  }
  console.log(`runs ${runs} per variant (seed ${seed0}), the expert with one mechanic taken away, the same seeds each; ${((Date.now() - t0) / 60000).toFixed(1)} min` +
    ` (${(played.reduce((n, r) => n + r.secs, 0) / played.length).toFixed(1)} s a run)`)
  console.log('variant        clear  died on floor 1    2    3    4   drop  Monarch deaths by threat')
  const clear = (mine) => mine.filter((r) => r.result === 'victory').length / runs
  const full = clear(played.slice(0, runs))
  const rows = variants.map((ablate, i) => ({ ablate, mine: played.slice(i * runs, (i + 1) * runs) }))
  for (const { ablate, mine } of rows) {
    const died = (f) => String(mine.filter((r) => r.result !== 'victory' && r.floor === f).length).padStart(5)
    const causes = {}
    for (const r of mine) for (const k of causesOf(r.death)) causes[k] = (causes[k] ?? 0) + 1
    const tally = Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '-'
    const drop = ablate ? (100 * (full - clear(mine))).toFixed(0) : '-'
    console.log(`${(ablate ?? 'full').padEnd(13)}  ${(100 * clear(mine)).toFixed(0).padStart(4)}%  ${' '.repeat(13)}${[1, 2, 3, 4].map(died).join('')}  ${drop.padStart(5)}  ${tally}`)
  }
  console.log('\nuses over the runs: orders given in battle (moves and acts), recruits made, fusions made, track tiers held, relics')
  console.log('held when they ended (Legendaries, the rest), and relics given to a soul')
  console.log('variant        orders  reaped  fuse  tiers  legend  relics  holds')
  for (const { ablate, mine } of rows) {
    const sum = (f) => String(mine.reduce((n, r) => n + f(r), 0)).padStart(6)
    console.log(`${(ablate ?? 'full').padEnd(13)}  ${[(r) => (r.acts.move ?? 0) + (r.acts.act ?? 0), (r) => r.reaped,
      (r) => r.acts.fuse ?? 0, (r) => r.tiers, (r) => r.legendaries.length, (r) => r.relics - r.legendaries.length, (r) => r.acts.hold ?? 0].map(sum).join(' ')}`)
  }
  // Progress (progressOf): continuous, so it reads a mechanic's cost on far fewer runs than the clear rate. Runs
  // are paired by seed: a variant's drop and its standard error are those of the seed-by-seed difference from
  // the full expert. The progress drop is put on the clear rate's scale by k, the least-squares slope through
  // the origin of the clear drop on the progress drop across the variants played (clear-eq = k × progress drop).
  const prog = rows.map(({ mine }) => mine.map((r) => r.progress))
  const mean = (xs) => xs.reduce((n, x) => n + x, 0) / xs.length
  const se = (xs) => xs.length > 1 ? Math.sqrt(xs.reduce((n, x) => n + (x - mean(xs)) ** 2, 0) / (xs.length - 1) / xs.length) : 0
  const pdrops = rows.map(({ ablate, mine }, i) => {
    const diff = prog[0].map((p, j) => 100 * (p - prog[i][j]))
    return { ablate, clearDrop: 100 * (full - clear(mine)), drop: mean(diff), se: se(diff) }
  }).slice(1)
  const sxy = pdrops.reduce((n, d) => n + d.drop * d.clearDrop, 0)
  const sxx = pdrops.reduce((n, d) => n + d.drop * d.drop, 0)
  const k = sxx > 0 ? sxy / sxx : 1
  const verdict = (ablate, v) => !BANDS[ablate] ? '(no band)' : v < BANDS[ablate][0] ? 'under' : v > BANDS[ablate][1] ? 'over' : 'in'
  console.log(`\nprogress: rooms completed of the ${routeRooms()} on the route to the Sovereign, the battle lost counted by the share of its`)
  console.log(`foe HP removed (1 = cleared); drops in points, paired by seed (± one standard error of the paired difference);`)
  console.log(`clear-eq = k × progress drop, k = ${sxx > 0 ? k.toFixed(2) : '1 (no drop to fit)'}: the least-squares slope through the origin of the clear drop on the progress drop (${pdrops.length} variants)`)
  console.log('variant        clear  progress   ±se   drop    ±se  clear-eq   ±se  band    verdict')
  console.log(`${'full'.padEnd(13)}  ${(100 * full).toFixed(0).padStart(4)}%  ${(100 * mean(prog[0])).toFixed(1).padStart(8)}  ${(100 * se(prog[0])).toFixed(1).padStart(4)}`)
  for (const [i, d] of pdrops.entries()) {
    const band = BANDS[d.ablate] ? BANDS[d.ablate].join('–') : '-'
    console.log(`${d.ablate.padEnd(13)}  ${(100 * clear(rows[i + 1].mine)).toFixed(0).padStart(4)}%  ${(100 * mean(prog[i + 1])).toFixed(1).padStart(8)}  ${' '.repeat(4)}  ${d.drop.toFixed(1).padStart(5)}  ${d.se.toFixed(1).padStart(5)}  ` +
      `${(k * d.drop).toFixed(1).padStart(8)}  ${(k * d.se).toFixed(1).padStart(4)}  ${band.padEnd(6)}  ${verdict(d.ablate, k * d.drop)}`)
  }
  const drops = rows.filter((r) => BANDS[r.ablate]).map((r) => ({ ablate: r.ablate, drop: 100 * (full - clear(r.mine)), band: BANDS[r.ablate] }))
  const list = (xs) => xs.map((d) => `${d.ablate} ${d.drop.toFixed(0)}`).join(', ') || '-'
  console.log(`\ncheck: full expert ${(100 * full).toFixed(0)}% (target >= 90%), progress ${(100 * mean(prog[0])).toFixed(1)}; drops against their bands (core 25–50: ${CORE.join(', ')}; extra 8–25: ${EXTRA.join(', ')}; measured, no band: ${MEASURED.join(', ')})`)
  const eq = pdrops.filter((d) => BANDS[d.ablate]).map((d) => ({ ablate: d.ablate, drop: k * d.drop, band: BANDS[d.ablate] }))
  console.log('  by clear-eq (k × progress drop):')
  console.log(`    in band: ${list(eq.filter((d) => d.drop >= d.band[0] && d.drop <= d.band[1]))}`)
  console.log(`    too small: ${list(eq.filter((d) => d.drop < d.band[0]))}`)
  console.log(`    too large: ${list(eq.filter((d) => d.drop > d.band[1]))}`)
  console.log('  by clear rate:')
  console.log(`    in band: ${list(drops.filter((d) => d.drop >= d.band[0] && d.drop <= d.band[1]))}`)
  console.log(`    too small: ${list(drops.filter((d) => d.drop < d.band[0]))}`)
  console.log(`    too large: ${list(drops.filter((d) => d.drop > d.band[1]))}`)
}

// ── necessity: the same, battle by battle (a fast proxy) ─────────────────────────────────────────────

// The run, as it stood just before a fight (a snapshot of record), with one mechanic stripped (null: as it
// was), for battleSetup to set the battle up from. → a run { state, battle, setup }
//   orders         as it stood: refight plays it with End Turn alone
//   arise, synergies, summons  the rules switch (as the full ablation's)
//   fusions        every fused piece back in its parts (unfused)
//   tracks         no tier on any track, and so every kind at the level that gives (a fused kind's `least` kept; its
//                  souls' wounds kept as a share)
//   legendaries    no Legendary, Arise and its variants among them (the Command and the souls' relics as without them)
//   relics         no Common, Uncommon or Rare relic (no such mods, no such triggers, the field and the Monarch's
//                  max HP as without them, its wounds kept as a share)
//   formation      the souls in basic's first draft's cells
//   moves          as it stood: refight plays it with an expert that never moves a piece
// A soul holds only the relics the run still owns.
export const NECESSITY = ABLATIONS
export function stripped (state, mechanic = null) {
  const s = structuredClone(state)
  const run = { state: s, battle: null, setup: null }
  const team = souls(s.party)
  const relevel = (u, lvl) => {
    const max = baseStats(u.id, lvl).hp
    u.hp = u.hp > 0 ? Math.max(1, Math.round(u.hp / u.maxHp * max)) : 0
    u.lvl = lvl
    u.maxHp = max
  }
  if (RULE_SWITCHES.includes(mechanic)) {
    s.ablate = [...(s.ablate ?? []), mechanic]
  } else if (mechanic === 'fusions') {
    unfused(s)
  } else if (mechanic === 'tracks') {
    for (const k of Object.values(s.kinds)) {
      k.tracks = [0, 0]
      k.lvl = levelOf(k)
    }
    for (const u of team) {
      u.tracks = [0, 0]
      relevel(u, s.kinds[u.id].lvl)
    }
  } else if (mechanic === 'legendaries') {
    s.relics = s.relics.filter((id) => !legendary(id))
  } else if (mechanic === 'relics') {
    s.relics = s.relics.filter(legendary)
  } else if (mechanic === 'formation') {
    const at = new Map(basicCells(run, fielded(s.party), LEVELS.expert).map((u) => [u.uid, u.slot]))
    for (const u of s.party) if (at.has(u.uid)) u.slot = at.get(u.uid)
  } else if (mechanic !== null && mechanic !== 'orders' && mechanic !== 'moves') {
    throw new Error(`unknown mechanic "${mechanic}": ${NECESSITY.join(', ')}`)
  }
  // A soul holds only relics the run still owns (a relic stripped is no one's).
  const owned = s.relics.slice()
  for (const u of souls(s.party)) {
    if (!u.relics) continue
    u.relics = u.relics.filter((id) => {
      const i = owned.indexOf(id)
      if (i >= 0) owned.splice(i, 1)
      return i >= 0
    })
  }
  // The Monarch's max HP as its relics now give it (its wounds kept as a share).
  const m = monarchOf(s)
  const max = monarchHp(s)
  if (m.maxHp !== max) {
    m.hp = m.hp > 0 ? Math.max(1, Math.round(m.hp / m.maxHp * max)) : 0
    m.maxHp = max
  }
  // A smaller field (no relic adding Command): the weakest standing souls past it to the ossuary.
  const cap = fieldCap(run)
  for (const u of standing(fielded(souls(s.party))).sort(byFieldPower).slice(cap)) u.slot = -1
  return run
}

// A run's state with every fused piece back in its parts (the recipe whose result it is: FUSION_LIST): as many pieces
// of each kind as the recipe takes, at its kind's level and tiers (for a kind the run never held, its first level,
// with none), wounded as the fused piece was; each on the first of the fused piece's cells it fits (a 2×2 piece's
// four, the anchor first), else in the ossuary. Mutates s.
function unfused (s) {
  for (const u of souls(s.party).filter((x) => unitDef(x.id).fused)) {
    const recipe = FUSION_LIST.find((r) => r.result === u.id)
    if (!recipe) continue
    const cells = cellsOf(u)
    s.party = s.party.filter((x) => x !== u)
    const taken = new Set(s.party.filter((x) => x.slot >= 0).flatMap(cellsOf))
    for (const [kind, n] of Object.entries(recipe.needs)) {
      const k = s.kinds[kind] ?? { lvl: kindLevel(s, kind), tracks: [0, 0] }
      for (let i = 0; i < n; i++) {
        const part = makeUnit(kind, { uid: s.nextUid++, lvl: k.lvl, tracks: k.tracks.slice() })
        part.hp = u.hp > 0 ? Math.max(1, Math.round(part.maxHp * hpPct(u))) : 0
        part.slot = cells.find((c) => fits(s.camp, c, sizeOf(part), taken)) ?? -1
        cellsOf(part).forEach((c) => taken.add(c))
        s.party.push(part)
      }
    }
  }
}

// Refights each snapshot as it stood and once per mechanic stripped, under the turn policy it was played with, that
// mechanic taken from it (ablatedTurns: End Turn alone with the orders stripped, no fusing with the fusions, no move
// with the moves): →
// per snapshot, per variant { won, alive (the Monarch stands at the end), hp (the share of your side's HP kept, 0 for
// a loss) }, and whether the as-it-stood refight played out exactly as the real battle did.
export function refight ({ snaps, variants = [null, ...NECESSITY] }) {
  return snaps.map(({ snapshot, outcome }) => {
    const out = {}
    for (const m of variants) {
      // Only the as-it-stood refight is compared event by event; the rest keep no events.
      const b = playOut(createBattle({ ...battleSetup(stripped(snapshot, m)), quiet: m !== null }), TURNS[ablatedTurns(outcome?.turns ?? 'basic', m)])
      const mine = b.units.filter((u) => u.side === 'party' && !u.shadow && !u.into)
      const won = b.winner === 'party'
      out[m ?? 'full'] = { won, alive: !!b.monarch && b.monarch.hp > 0, hp: won ? mine.reduce((n, u) => n + u.hp, 0) / mine.reduce((n, u) => n + u.maxHp, 0) : 0 }
      if (m === null) out.same = !!outcome && timelineHash(b.events) === outcome.hash
    }
    return out
  })
}

// The full expert's battles over `runs` runs (recorded once; with `setups`, a file: read if it is there, else
// written, so a tuning loop refights the same battles in seconds), each refought as it stood and once per
// mechanic stripped (stripped), in one pool. Per variant: battles won, the Monarch standing at the end, HP kept,
// and battles won floor by floor.
async function necessity ({ runs, seed: seed0, setups: file = null }) {
  const t0 = Date.now()
  let snaps
  if (file && fs.existsSync(file)) {
    snaps = JSON.parse(fs.readFileSync(file, 'utf8'))
  } else {
    const played = await playAll(Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level: 'expert', snapshots: true })))
    snaps = played.flatMap((r) => r.battles.map((b) => ({ floor: b.floor, snapshot: b.snapshot, outcome: b.outcome })))
    if (file) fs.writeFileSync(file, JSON.stringify(snaps))
  }
  const t1 = Date.now()
  const { availableParallelism } = await import('node:os')
  const per = Math.max(1, Math.ceil(snaps.length / (2 * availableParallelism())))
  const chunks = []
  for (let i = 0; i < snaps.length; i += per) chunks.push({ refight: true, snaps: snaps.slice(i, i + per) })
  const results = (await playAll(chunks)).flat()
  const variants = ['full', ...NECESSITY]
  const floors = [...new Set(snaps.map((x) => x.floor))]
  console.log(`necessity: ${snaps.length} battles of the full expert (${file && t1 - t0 < 1000 ? `from ${file}` : `${runs} runs, seed ${seed0}`}), ` +
    `each refought as it stood and with one mechanic stripped; record ${((t1 - t0) / 60000).toFixed(1)} min, refights ${((Date.now() - t1) / 60000).toFixed(1)} min`)
  console.log(`as it stood, refights identical to the real battle: ${results.filter((r) => r.same).length}/${results.length}`)
  // A run-scale reading: the share of recorded runs whose every battle is still won with the mechanic stripped
  // (a run's battles are those of one seed), and its drop against the same as it stood, in points. It reads
  // against the full ablation's clear-rate drop, though it cannot see the expert adapt (a mechanic's essence
  // spent elsewhere) nor the battles a stripped run would have fought differently.
  const seeds = [...new Set(snaps.map((x) => x.snapshot.seed))]
  const clean = (v) => seeds.filter((seed) => results.every((r, i) => snaps[i].snapshot.seed !== seed || r[v].won)).length / seeds.length
  const base = clean('full')
  console.log(`runs: ${seeds.length}; "runs clean": runs whose every battle is won; "drop": its fall against full, in points`)
  console.log('variant        won   Monarch stood  HP kept   lost  runs clean  drop   ' + floors.map((f) => `fl ${f}`.padStart(6)).join(''))
  const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : '-')
  for (const v of variants) {
    const all = results.map((r) => r[v])
    const won = all.filter((x) => x.won).length
    const cols = floors.map((f) => {
      const here = results.filter((_, i) => snaps[i].floor === f).map((r) => r[v])
      return pct(here.filter((x) => x.won).length, here.length).padStart(7)
    })
    const drop = v === 'full' ? '-' : (100 * (base - clean(v))).toFixed(0)
    console.log(`${v.padEnd(13)}  ${pct(won, all.length).padStart(6)}  ${pct(all.filter((x) => x.alive).length, all.length).padStart(13)}  ${pct(all.reduce((n, x) => n + x.hp, 0), all.length).padStart(7)}  ${String(all.length - won).padStart(5)}  ${pct(clean(v), 1).padStart(10)}  ${drop.padStart(4)}   ${cols.join('')}`)
  }
}

// ── the harness: builds committed, the diversity block, the pool (redesign.md §3, §6 Step 0) ───────────

// --builds [--player expert|teacher] [--commit <archetype>[,…]|all|fused|synergies|none] [--scale 1] [--runs 256]
// [--seed div] [--workers n] [--out file.json]  (npm run builds): seeds `<seed>-0`… played in free play (the player as it
// ships) and, on the same seeds, committed to each archetype named (ARCHETYPES, withCommit; all by default; `fused` the
// fused kinds, `synergies` the synergies, `none` free play alone); a row an archetype (buildRow) and free play's
// diversity block (diversity). The player: `expert` (LEVELS.expert, the fast loop's, ~8 s a run) or `teacher`, the
// outside teacher (outside.js outsideTeacher: each choice out of battle among the expert's top six played out to the
// run's end by the expert, the first that clears taken; the expert in battle; ~67 s a run), committed through the same
// book. `--scale`: every foe's HP and ATK × it (createRun's). `--out`: the rows, the block and every run's record, as JSON.
// Noise as the old spec reported it: ± one standard error of the paired difference; 64 seeds resolve ~6 points of
// clear rate, 256 ~3.
// --pool [--runs 256] [--seed div]  (npm run pool): what a run can gather (poolTable).
export const PLAYERS = Object.freeze(['expert', 'teacher'])
// The outside teacher as §3 measures it: every phase, the expert's top six, the first line that clears taken.
export const TEACHER = Object.freeze({ won: true })

// One run of the harness (a worker's job: playAll): seed `seed` played by `player`, committed to `commit` (null: free
// play), at difficulty `scale`. The expert's is record's; the teacher's the same record with the outside teacher's
// action at every step (autoplay's `act`; outside.js, loaded here, as it imports this module), and its counts (`teacher`:
// decisions played out, playouts, overrides of the expert's pick). → a promise of record's result, with `player`
export async function buildRecord ({ seed, player = 'expert', commit = null, scale = 1 }) {
  if (!PLAYERS.includes(player)) throw new Error(`unknown player "${player}": ${PLAYERS.join(', ')}`)
  if (player === 'expert') return { ...withCommit(commit, () => record({ seed, level: 'expert', scale })), player }
  const { outsideTeacher, outsideStats } = await import('./outside.js')
  let run = null
  const act = (r, rng) => outsideTeacher((run = r), rng, TEACHER)
  const out = withCommit(commit, () => record({ seed, level: 'expert', scale, act }))
  const phases = Object.values(outsideStats(run).phases)
  const sum = (k) => phases.reduce((n, p) => n + p[k], 0)
  return { ...out, player, teacher: { decisions: sum('decided'), playouts: sum('playouts'), overrides: sum('overrides') } }
}
// A job's key for its time (playAll's order): a harness's by its player, commitment and scale too.
const jobKey = (job) => (job.builds ? `${job.seed}|builds|${job.player}|${job.commit ?? 'free'}|${job.scale}` : timeKey(job))

// The jobs of --builds: free play, then each archetype of `commits` committed, on the same seeds.
export function buildJobs ({ player = 'expert', commits = ARCHETYPES(), scale = 1, runs = 256, seed = 'div' } = {}) {
  const seeds = Array.from({ length: runs }, (_, i) => `${seed}-${i}`)
  return [null, ...commits].flatMap((commit) => seeds.map((s) => ({ builds: true, seed: s, player, commit, scale })))
}
// The archetypes a --commit names: `all`, `fused` (the fused kinds), `synergies`, `none` (free play alone), or a
// comma-separated list, each checked.
export function commitsOf (spec = 'all') {
  const all = ARCHETYPES()
  const groups = { all, fused: all.filter((a) => !synergyOf(a)), synergies: all.filter(synergyOf), none: [] }
  if (groups[spec]) return groups[spec]
  const list = String(spec).split(',').filter(Boolean)
  for (const a of list) if (!all.includes(a)) throw new Error(`unknown archetype "${a}": ${all.join(', ')}`)
  return list
}

// What a run record keeps for the harness (record's `syn`, `lead`, `built`, `end`). Your side's synergies as battle `b`
// began.
const synergiesAt = (b) => (b.events.find((e) => e.type === 'battle:start')?.synergies ?? []).filter((x) => x.side === 'party').map((x) => x.id)
// What leads the pieces a battle fielded (`pieces`, the Monarch aside), as a pivot is read (pivots): the kin most of them
// share and the fused kind most of them are (ties to the first by name; null for none).
function leadOf (pieces) {
  const most = (ids) => {
    const n = {}
    for (const id of ids) n[id] = (n[id] ?? 0) + 1
    return Object.entries(n).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null
  }
  return { kin: most(pieces.map((u) => unitDef(u.id).kin).filter(Boolean)), fused: most(pieces.filter((u) => unitDef(u.id).fused).map((u) => u.id)) }
}
// A run's build at its end: the kinds of the souls it holds (`army`, the fallen too) and of the pieces it fielded in its
// last battle (`field`); each recipe it made, with the battles its fused pieces first stood in (`made`: { recipe:
// [battle, …] }, 1-based: one made in a battle, that battle; out of one, the next); the relics it bought (`bought`, every
// copy, in order: a Shop is where relics come from).
export function builtOf (run) {
  const s = run.state
  const made = {}
  let battle = 0
  for (const a of s.log) {
    if (a.type === 'fight') battle++
    // An order in battle names the piece that fuses (`uid`); a fusion out of battle names none.
    if (a.type === 'fuse') (made[a.id] ??= []).push(a.uid === undefined ? battle + 1 : battle)
  }
  return { army: souls(s.party).map((u) => u.id), field: run.setup ? souls(run.setup.party).map((u) => u.id) : [], made, bought: s.relics.slice() }
}
// A run's margin at its end (what the outside teacher reports beside its clears, where those saturate): as its last
// battle ended (the Sovereign's, for a clear; before the heal a won battle gives), the Monarch's share of its max HP and
// the share of their max HP the pieces that fought it kept (the fallen at 0; shadows, summons and a fusion's parts
// aside); the battles lost, the essence left, and the turns its battles took.
export function endOf (run, battles) {
  const b = run.battle
  const m = b?.monarch
  let hp = 0
  let max = 0
  for (const u of b?.units ?? []) {
    if (u.side !== 'party' || u.shadow || u === m || u.into != null) continue
    hp += Math.max(0, u.hp)
    max += u.maxHp
  }
  return {
    monarch: m ? +(Math.max(0, m.hp) / m.maxHp).toFixed(4) : 0,
    souls: max ? +(hp / max).toFixed(4) : 0,
    lost: battles.filter((x) => !x.won).length,
    essence: run.state.essence,
    turns: battles.reduce((n, b) => n + b.t, 0)
  }
}

const cleared = (r) => r.result === 'victory'
const meanOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const medianOf = (xs) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null)
// The battle (1-based) in which run record `r` first reached archetype `arch`: a fused kind's, the first its own recipe's
// piece stood in (builtOf's `made`); a synergy's, the first your side began holding it; null for never.
export function reachedAt (r, arch) {
  if (synergyOf(arch)) {
    const i = r.battles.findIndex((b) => b.syn.includes(arch))
    return i < 0 ? null : i + 1
  }
  const at = FUSION_LIST.filter((x) => x.result === arch).flatMap((x) => r.built.made[x.id] ?? [])
  return at.length ? Math.min(...at) : null
}

// A row of --builds for runs `R`, an archetype's (`arch`; null for free play's) against free play's `F` on the same seeds
// (pairedStats): runs, clears, progress (in points) and its paired difference from free play's ± one standard error,
// runs ended by floor; the margin: the Monarch's and the souls' share of their HP at the end and the essence left, each
// the mean over the clears, the battles lost over every run, the turns a battle over every battle; the share of runs
// that made its fusion or reached its synergy, and the median battle it came on; seconds a run.
export function buildRow (R, arch = null, F = null) {
  const won = R.filter(cleared)
  const battles = R.flatMap((r) => r.battles)
  const at = arch ? R.map((r) => reachedAt(r, arch)).filter((x) => x !== null) : []
  const paired = F && arch ? pairedStats(F, R) : null
  return {
    arch,
    runs: R.length,
    clears: won.length,
    progress: 100 * meanOf(R.map((r) => r.progress)),
    diff: paired?.diff ?? null,
    se: paired?.se ?? null,
    deaths: Array.from({ length: TUNING.run.floors }, (_, f) => R.filter((r) => !cleared(r) && r.floor === f + 1).length),
    monarch: won.length ? 100 * meanOf(won.map((r) => r.end.monarch)) : null,
    souls: won.length ? 100 * meanOf(won.map((r) => r.end.souls)) : null,
    essence: meanOf(won.map((r) => r.end.essence)),
    lost: R.reduce((n, r) => n + r.end.lost, 0),
    turns: battles.length ? battles.reduce((n, b) => n + b.t, 0) / battles.length : null,
    reached: arch ? at.length / Math.max(1, R.length) : null,
    first: arch ? medianOf(at) : null,
    secs: meanOf(R.map((r) => r.secs))
  }
}

// What a group of runs made (redesign.md §2's criterion 3), each a share: of the runs, each archetype in its final army
// (`archetypes`: a fused kind it holds at the end, a synergy its side held as its last battle began), each kind it
// holds at the end (`kinds`), each recipe made (`made`, and how many were made in all: `fusions`); of the pieces fielded
// in the runs' last battles, each role and kin (`roles`, `kins`); of the battles, each synergy your side held as it
// began (`synergies`) and none (`none`); of the relics bought, each relic (`relics`), with relics a run (`perRun`) and
// the Command relics' share (`command`); the altars' rites (altarRites) and the pivots after floor 1 (pivots).
export function diversity (R) {
  const n = R.length
  const battles = R.flatMap((r) => r.battles)
  const share = (k, d) => (d ? k / d : 0)
  const tally = (keys) => {
    const out = {}
    for (const k of keys) out[k] = (out[k] ?? 0) + 1
    return out
  }
  const ranked = (o, d) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, v]) => [k, share(v, d)]))
  const runsWith = (f) => tally(R.flatMap((r) => [...new Set(f(r))]))
  const field = R.flatMap((r) => r.built.field.map(unitDef))
  const bought = R.flatMap((r) => r.built.bought)
  return {
    runs: n,
    battles: battles.length,
    archetypes: ranked(runsWith((r) => [...r.built.army.filter((id) => unitDef(id).fused), ...(r.battles.at(-1)?.syn ?? [])]), n),
    kinds: ranked(runsWith((r) => r.built.army), n),
    roles: ranked(tally(field.map((u) => u.role)), field.length),
    kins: ranked(tally(field.map((u) => u.kin)), field.length),
    made: ranked(runsWith((r) => Object.keys(r.built.made)), n),
    fusions: Object.fromEntries(FUSION_LIST.map((x) => [x.id, R.reduce((k, r) => k + (r.built.made[x.id]?.length ?? 0), 0)])),
    synergies: ranked(tally(battles.flatMap((b) => b.syn)), battles.length),
    none: share(battles.filter((b) => !b.syn.length).length, battles.length),
    relics: ranked(tally(bought), bought.length),
    perRun: share(bought.length, n),
    command: share(bought.filter((id) => gives(relicDef(id), 'run.command')).length, bought.length),
    altar: altarRites(R),
    pivot: pivots(R)
  }
}

// The rites taken at the altars (redesign.md §4.5; a record's `acts`): altars a run, and each rite's share of them.
export function altarRites (R) {
  const n = { heal: 0, transmute: 0, consecrate: 0 }
  for (const r of R) for (const k in n) n[k] += r.acts?.[k] ?? 0
  const all = n.heal + n.transmute + n.consecrate
  return { perRun: R.length ? all / R.length : 0, ...Object.fromEntries(Object.entries(n).map(([k, v]) => [k, all ? v / all : 0])) }
}
// The runs that turned after floor 1 (redesign.md §4.5's measure): of the runs that fought past it (`of`), those whose
// last battle's lead (leadOf) is not floor 1's last battle's: by kin (`kin`), and by fused kind where both fielded one
// (`fused`, of `fusedOf`); each with how many of them cleared. Records without a battle's lead read none.
export function pivots (R) {
  const out = { of: 0, kin: 0, kinCleared: 0, fusedOf: 0, fused: 0, fusedCleared: 0 }
  for (const r of R) {
    const one = r.battles.filter((b) => parseInt(b.floor) === 1).at(-1)?.lead
    const last = r.battles.at(-1)
    if (!one || !last?.lead || parseInt(last.floor) === 1) continue
    out.of++
    if (one.kin !== last.lead.kin) { out.kin++; out.kinCleared += cleared(r) }
    if (!one.fused || !last.lead.fused) continue
    out.fusedOf++
    if (one.fused !== last.lead.fused) { out.fused++; out.fusedCleared += cleared(r) }
  }
  return out
}

// Criterion 3 read off a diversity block: no fused kind in more than 30% of final armies; every base recipe (one of
// kinds no recipe makes) made in 8% or more of runs; six or more of the synergies each held in 5% or more of battles.
// (Its fourth, the relics ablation worth 10 points, is --ablations'.) And the kinds held in a tenth of final armies or
// more, of those a run can hold.
export function diversityChecks (d) {
  const fused = Object.entries(d.archetypes).filter(([id]) => !synergyOf(id))[0] ?? ['-', 0]
  const base = FUSION_LIST.filter((x) => Object.keys(x.needs).every((id) => !unitDef(id).fused))
  const rare = base.filter((x) => (d.made[x.id] ?? 0) < 0.08).map((x) => x.id)
  const synergies = SYNERGIES.filter((x) => (d.synergies[x.id] ?? 0) >= 0.05).map((x) => x.id)
  return {
    fused: { id: fused[0], share: fused[1], ok: fused[1] <= 0.3 },
    recipes: { rare, ok: !rare.length },
    synergies: { ids: synergies, ok: synergies.length >= 6 },
    kinds: { ids: Object.entries(d.kinds).filter(([, v]) => v >= 0.1).map(([k]) => k), of: UNIT_LIST.filter((u) => (u.spawn || u.fused) && !u.boss).length }
  }
}

const pct = (x, d = 0) => `${(100 * x).toFixed(d)}%`
const listOf = (o, top = Infinity) => Object.entries(o).slice(0, top).map(([k, v]) => `${k} ${pct(v)}`).join(', ') || '-'
const met = (ok) => (ok ? 'met' : 'NOT MET')

// The rows of --builds as lines: free play's, then each archetype's.
export function buildLines (rows, { player = 'expert', scale = 1, runs, seed } = {}) {
  const out = [`builds: the ${player}, ${runs} seeds ${seed}-0…${runs - 1}${scale !== 1 ? `, every foe's HP and ATK ×${scale}` : ''}; each archetype committed (its combos of the book alone) on free play's seeds`]
  out.push(`${'archetype'.padEnd(16)}${'clears'.padStart(7)}${'progress'.padStart(9)}${'vs free'.padStart(15)}  ${'died fl 1/2/3/4'.padStart(15)}  ${'mon'.padStart(4)}${'souls'.padStart(6)}${'ess'.padStart(6)}${'lost'.padStart(5)}${'t/b'.padStart(6)}  ${'made'.padStart(5)}${'at'.padStart(4)}${'s/run'.padStart(7)}`)
  const num = (x, d = 0) => (x === null ? '-' : x.toFixed(d))
  for (const r of rows) {
    out.push([
      (r.arch ?? 'free play').padEnd(16),
      pct(r.clears / Math.max(1, r.runs)).padStart(7),
      r.progress.toFixed(1).padStart(9),
      (r.diff === null ? '' : `${r.diff >= 0 ? '+' : ''}${r.diff.toFixed(1)} ± ${r.se.toFixed(1)}`).padStart(15),
      '  ' + r.deaths.join('/').padStart(15),
      '  ' + num(r.monarch).padStart(4),
      num(r.souls).padStart(6),
      num(r.essence).padStart(6),
      String(r.lost).padStart(5),
      num(r.turns, 1).padStart(6),
      '  ' + (r.reached === null ? '' : pct(r.reached)).padStart(5),
      String(r.first ?? '').padStart(4),
      num(r.secs, 1).padStart(7)
    ].join(''))
  }
  out.push('  vs free: progress against free play seed for seed (± one standard error of the paired difference); mon, souls,')
  out.push('  ess: the Monarch\'s and its pieces\' share of their HP (%) as the last battle ended, and the essence left, each the')
  out.push('  mean over the clears; lost: battles lost; t/b: turns a battle; made: runs that made its fusion or held its synergy;')
  out.push('  at: the median battle it came on')
  return out
}

// The diversity block as lines, with criterion 3's checks (free play's; the ladder's a level at a time).
export function diversityLines (d, label = 'free play') {
  const c = diversityChecks(d)
  const fusions = Object.keys(d.fusions).sort((a, b) => (d.made[b] ?? 0) - (d.made[a] ?? 0)).map((id) => `${id} ${pct(d.made[id] ?? 0)} (${d.fusions[id]})`).join(', ')
  return [
    `diversity, ${label} (${d.runs} runs, ${d.battles} battles; redesign.md §2, criterion 3):`,
    `  final armies' archetypes   ${listOf(d.archetypes)}   [no fused kind above 30%: ${met(c.fused.ok)}${c.fused.ok ? '' : `, ${c.fused.id} ${pct(c.fused.share)}`}]`,
    `  kinds held at the end      ${listOf(d.kinds, 12)}   [${c.kinds.ids.length} of ${c.kinds.of} kinds in a tenth or more]`,
    `  fielded in the last battle roles: ${listOf(d.roles)}; kins: ${listOf(d.kins)}`,
    `  fusions made (runs, made)  ${fusions}   [every base recipe in 8%+: ${met(c.recipes.ok)}${c.recipes.ok ? '' : `, ${c.recipes.rare.join(', ')} short`}]`,
    `  synergies (battles)        ${listOf(d.synergies)}, none ${pct(d.none)}   [six or more at 5%+: ${c.synergies.ids.length}, ${met(c.synergies.ok)}]`,
    `  relics bought              ${d.perRun.toFixed(1)} a run, Command ${pct(d.command)}: ${listOf(d.relics, 8)}`,
    `  altars' rites              ${d.altar.perRun.toFixed(1)} a run: heal ${pct(d.altar.heal)}, transmute ${pct(d.altar.transmute)}, consecrate ${pct(d.altar.consecrate)}`,
    `  turned after floor 1       of ${d.pivot.of} runs past it, the kin leading ${d.pivot.kin} (${d.pivot.kinCleared} cleared); of ${d.pivot.fusedOf} fielding a fused kind on both, the fused kind ${d.pivot.fused} (${d.pivot.fusedCleared} cleared)`
  ]
}

// --builds: plays the jobs (playAll), prints the rows and free play's diversity block (the teacher's counts too); with
// `out`, all of it and every record as JSON. → { rows, diversity, records }
export async function builds ({ player = 'expert', commits = ARCHETYPES(), scale = 1, runs = 256, seed = 'div', out = null, log = console.log } = {}) {
  if (!PLAYERS.includes(player)) throw new Error(`unknown player "${player}": ${PLAYERS.join(', ')}`)
  if (!(scale > 0)) throw new Error(`scale ${scale}: a multiplier above 0`)
  const t0 = Date.now()
  const played = await playAll(buildJobs({ player, commits, scale, runs, seed }))
  const free = played.slice(0, runs)
  const rows = [buildRow(free), ...commits.map((arch, k) => buildRow(played.slice((k + 1) * runs, (k + 2) * runs), arch, free))]
  const d = diversity(free)
  for (const line of [...buildLines(rows, { player, scale, runs, seed }), '', ...diversityLines(d)]) log(line)
  if (player === 'teacher') {
    const per = (k) => (played.reduce((n, r) => n + r.teacher[k], 0) / played.length).toFixed(1)
    log(`the teacher a run: ${per('decisions')} decisions played out, ${per('playouts')} playouts, ${per('overrides')} overrides of the expert's pick`)
  }
  log(`(${played.length} runs in ${((Date.now() - t0) / 60000).toFixed(1)} min)`)
  if (out) fs.writeFileSync(out, JSON.stringify({ player, scale, seed, runs, commits, rows, diversity: d, records: played }) + '\n')
  return { rows, diversity: d, records: played }
}

// ── the pool: what a run can gather (redesign.md §1, §4.2; criterion 1) ──────────────────────────

const BATTLE_ROOMS = ['fight', 'elite', 'siege', 'boss']
// A floor of seed `seed` as a run meets it (run.js enterFloor): its map, every battle room's foes drawn, the routes varied.
export function floorOf (seed, floor) {
  const s = { seed, floor, map: generateFloor({ seed, floor, last: floor === TUNING.run.floors }) }
  for (const n of s.map.nodes) if (BATTLE_ROOMS.includes(n.type)) Object.assign(n, drawRoom(seed, floor, n))
  varyRoutes(s)
  return s.map
}
// The chance a walk through `map` stands in each room, each fork taken evenly. → Map id → chance
export function visits (map) {
  const p = new Map([[map.start, 1]])
  for (const n of map.nodes.slice().sort((a, b) => a.rank - b.rank)) {
    const here = p.get(n.id) ?? 0
    for (const id of n.next) p.set(id, (p.get(id) ?? 0) + here / n.next.length)
  }
  return p
}
// The kinds a battle room offers: every foe of every wave (all are slain when it is won, a soul offered a kind slain).
const offered = (n) => new Set([...(n.foes ?? []), ...(n.waves ?? []).flatMap((w) => w.foes)].map((f) => f.id))
// Whether kind `id` counts toward synergy `syn` (a kin or role its rule needs).
const countsFor = (syn, id) => Object.entries(syn.needs).some(([axis, need]) => need[unitDef(id)[axis]] !== undefined)

// The availability table: `draws`, each floor's share of a fight's and an elite's draws by kind (spawnPool's weights,
// each pool summing to one); `battles`, by floor, the expected battles on a walk and by kind the expected battles on it
// offering that kind, over the floors of seeds `<seed>-0`… (`runs` of them; a walk takes each fork evenly: visits);
// `draft`, the expected picks of the draft offering each kind on the same seeds, each pick taken evenly (draftOffer: a
// pick's offer reads the souls taken); `recipes`, each recipe's parts with their expected battles by floor and by the
// end of floor 2, and its `reach`: the least of its parts' by the end of floor 2, a fused part's its own recipe's
// (criterion 1 asks 3 or more of its first fusion); `synergies`, each synergy's expected battles by the end of floor 2
// offering a kind of its kin or role (a battle once).
export function poolTable ({ runs = 256, seed = 'div' } = {}) {
  const floors = Array.from({ length: TUNING.run.floors }, (_, i) => i + 1)
  const norm = (p) => {
    const sum = p.weights.reduce((a, b) => a + b, 0)
    return Object.fromEntries(p.units.map((u, i) => [u.id, p.weights[i] / sum]))
  }
  const draws = floors.map((floor) => ({ floor, fight: norm(spawnPool(floor)), elite: norm(spawnPool(floor, TUNING.spawn.eliteTier)) }))
  const battles = floors.map((floor) => ({ floor, battles: 0, kinds: {} }))
  const synergies = Object.fromEntries(SYNERGIES.map((x) => [x.id, 0]))
  for (let k = 0; k < runs; k++) {
    for (const floor of floors) {
      const map = floorOf(`${seed}-${k}`, floor)
      const at = battles[floor - 1]
      for (const [id, p] of visits(map)) {
        const n = nodeOf(map, id)
        if (!BATTLE_ROOMS.includes(n.type)) continue
        const kinds = offered(n)
        at.battles += p / runs
        for (const kind of kinds) at.kinds[kind] = (at.kinds[kind] ?? 0) + p / runs
        if (floor <= 2) for (const x of SYNERGIES) if ([...kinds].some((kind) => countsFor(x, kind))) synergies[x.id] += p / runs
      }
    }
  }
  const draft = {}
  const deal = (seed, held, p) => {
    if (held.length >= TUNING.draft.picks) return
    const offer = draftOffer(seed, held.length, held)
    for (const id of offer) {
      draft[id] = (draft[id] ?? 0) + p / runs
      deal(seed, [...held, id], p / offer.length)
    }
  }
  for (let k = 0; k < runs; k++) deal(`${seed}-${k}`, [], 1)
  const by = (id, floor) => battles[floor - 1].kinds[id] ?? 0
  const byTwo = (id) => by(id, 1) + by(id, 2)
  const reachOf = (r) => Math.min(...Object.keys(r.needs).map((id) => (unitDef(id).fused ? Math.min(...FUSION_LIST.filter((x) => x.result === id).map(reachOf)) : byTwo(id))))
  const recipes = FUSION_LIST.map((r) => ({
    id: r.id,
    result: r.result,
    parts: Object.entries(r.needs).map(([id, need]) => ({ id, need, fused: !!unitDef(id).fused, floors: floors.map((f) => by(id, f)), byTwo: byTwo(id), draft: draft[id] ?? 0 })),
    reach: reachOf(r)
  }))
  return { runs, seed, draws, battles, draft, recipes, synergies }
}

// The availability table as lines.
export function poolLines (t) {
  const kinds = UNIT_LIST.filter((u) => u.spawn && !u.boss).sort((a, b) => a.tier - b.tier || (a.id < b.id ? -1 : 1))
  const cell = (x) => (x ? pct(x, x < 0.1 ? 1 : 0) : '-').padStart(6)
  const out = [`the pool (spawnPool, tierFalloff ${TUNING.spawn.tierFalloff}, tierOverCap ${TUNING.spawn.tierOverCap}): each floor's share of a fight's (f) and an elite's (e) draws, by kind`]
  out.push(`${'kind'.padEnd(16)}tier ${t.draws.map((d) => `${`f${d.floor}`.padStart(6)}${`e${d.floor}`.padStart(6)}`).join(' ')}`)
  for (const u of kinds) out.push(`${u.id.padEnd(16)}${String(u.tier).padStart(4)} ${t.draws.map((d) => `${cell(d.fight[u.id])}${cell(d.elite[u.id])}`).join(' ')}`)
  out.push('')
  out.push(`expected battles on a walk offering each kind (its foes among the slain), by floor (${t.runs} seeds ${t.seed}-0…, each fork`)
  out.push('taken evenly); and the draft\'s picks offering it')
  out.push(`${'kind'.padEnd(16)}${t.battles.map((b) => `fl ${b.floor}`.padStart(6)).join('')}  ${'by fl 2'.padStart(7)}  ${'draft'.padStart(5)}`)
  out.push(`${'(battles)'.padEnd(16)}${t.battles.map((b) => b.battles.toFixed(1).padStart(6)).join('')}  ${(t.battles[0].battles + t.battles[1].battles).toFixed(1).padStart(7)}`)
  for (const u of kinds) {
    const by = t.battles.map((b) => b.kinds[u.id] ?? 0)
    out.push(`${u.id.padEnd(16)}${by.map((x) => (x ? x.toFixed(2) : '-').padStart(6)).join('')}  ${(by[0] + by[1]).toFixed(2).padStart(7)}  ${(t.draft[u.id] ?? 0).toFixed(2).padStart(5)}`)
  }
  out.push('')
  out.push('recipes (criterion 1: the parts of each first fusion offered in 3 or more battles by the end of floor 2): each part\'s')
  out.push('expected battles by the end of floor 2 (by floor 1/2/3/4; the draft\'s picks), its reach the least of them')
  for (const r of t.recipes) {
    const parts = r.parts.map((p) => (p.fused ? `${p.need}× ${p.id} (fused)` : `${p.need}× ${p.id} ${p.byTwo.toFixed(1)} (${p.floors.map((x) => x.toFixed(1)).join('/')}${p.draft ? `; draft ${p.draft.toFixed(2)}` : ''})`)).join(', ')
    out.push(`  ${r.result.padEnd(26)} reach ${r.reach.toFixed(1).padStart(4)}  ${(r.reach >= 3 ? 'met' : 'NOT MET').padEnd(8)}${parts}`)
  }
  out.push(`synergies: battles by the end of floor 2 offering a kind of its kin or role: ${Object.entries(t.synergies).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`)
  return out
}

// --pool: the table, printed. → the table
export function pool ({ runs = 256, seed = 'div', log = console.log } = {}) {
  const t = poolTable({ runs, seed })
  for (const line of poolLines(t)) log(line)
  return t
}

// Run directly: a report, or (in a worker thread of playAll) one run. The default runs a report plays: about one
// expert run per core of an 8-core machine, so each finishes in about the time of its slowest run.
const RUNS = { sim: 8, decisions: 8, ladder: 8, ablations: 8, necessity: 8 }
if (typeof process !== 'undefined' && process.argv[1] === decodeURIComponent(new URL(import.meta.url).pathname)) {
  const { isMainThread, parentPort, workerData } = await import('node:worker_threads')
  if (!isMainThread) {
    // A pool's worker (playAll): job after job, until it is let go (a harness's job, --builds, is buildRecord's).
    const play = (job) => (job.audit ? auditRecord(job) : job.refight ? refight(job) : job.builds ? buildRecord(job) : record(job))
    if (workerData?.pool) parentPort.on('message', async (job) => parentPort.postMessage(await play(job)))
    else parentPort.postMessage(play(workerData))
  } else {
    const arg = (name, def) => {
      const i = process.argv.indexOf('--' + name)
      return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
    }
    const opts = { seed: arg('seed', 'sim'), level: arg('level', 'expert') }
    // `--workers n`: the pool's size (one per core by default).
    if (arg('workers', null) !== null) WORKERS = Math.max(1, Number(arg('workers', 1)))
    if (!LEVELS[opts.level]) throw new Error(`unknown level "${opts.level}": ${Object.keys(LEVELS).join(', ')}`)
    const ablate = arg('ablate', null)
    if (ablate !== null && !ABLATIONS.includes(ablate)) throw new Error(`unknown ablation "${ablate}": ${ABLATIONS.join(', ')}`)
    // `--variants full` (alone or with others): the full expert only, beside whatever ablations are named.
    const variants = arg('variants', null)?.split(',').filter((v) => v !== 'full') ?? ABLATIONS
    for (const v of variants) if (!ABLATIONS.includes(v)) throw new Error(`unknown ablation "${v}": ${ABLATIONS.join(', ')}`)
    // `--forest <file|none>`: the expert's forest (forest.js) for a report or the ladder, the shipped expert's by
    // default; `--paired <a>,<b>`: the same seeds played by a and b (each a forest file, a part or a whole expert, or
    // none: playerOf), compared.
    const forest = arg('forest', undefined)
    if (process.argv.includes('--combos')) makeBook()
    // The harness (redesign.md §3): --builds, free play and each archetype committed on the same seeds; --pool, what a run
    // can gather.
    else if (process.argv.includes('--pool')) pool({ runs: Number(arg('runs', 256)), seed: arg('seed', 'div') })
    else if (process.argv.includes('--builds')) {
      await builds({
        player: arg('player', 'expert'), commits: commitsOf(arg('commit', 'all')), scale: Number(arg('scale', 1)),
        runs: Number(arg('runs', 256)), seed: arg('seed', 'div'), out: arg('out', null)
      })
    }
    else if (arg('paired', null)) {
      const players = arg('paired').split(',')
      if (players.length !== 2) throw new Error('--paired <a>,<b>: two players (a forest file, a part or a whole expert, or none), comma-separated')
      await paired({ ...opts, players, runs: Number(arg('runs', 256)) })
    }
    else if (process.argv.includes('--audit')) await audit({ seed: arg('seed', 'audit'), runs: Number(arg('runs', 4)) })
    else if (process.argv.includes('--ablations')) await ablations({ ...opts, variants, runs: Number(arg('runs', RUNS.ablations)), out: arg('out', null) })
    else if (process.argv.includes('--necessity')) await necessity({ ...opts, runs: Number(arg('runs', RUNS.necessity)), setups: arg('setups', null) })
    else if (process.argv.includes('--decisions')) await decisions({ ...opts, runs: Number(arg('runs', RUNS.decisions)) })
    else if (process.argv.includes('--ladder')) await ladder({ ...opts, forest, runs: Number(arg('runs', RUNS.ladder)) })
    else await report({ ...opts, ablate, forest, runs: Number(arg('runs', RUNS.sim)) })
  }
}
