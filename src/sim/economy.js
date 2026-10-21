// The run's economy: the essence a battle pays (its foes, a won room's bounty), every price and the purse, a soul's
// track tiers and level, and the rewards: the spoils' soul offers and the Shop's shelf, stocked and restocked.
import { TUNING } from '../tuning.js'
import { relicDef, unitDef, RELIC_LIST, RELIC_TIERS, fusionDef } from '../content.js'
import { createRng } from './rng.js'
import { baseStats, tracksOf, canTrack, nextTracks, sizeOf, fits, onField } from './unit.js'
import { OSSUARY, at, runStat, ariseHeld, relicTier, takenBy, ascensionOf, isMonarch } from './state.js'

// ── progression: the retinue ─────────────────────────────────────────────────────────────────────

// Every real foe slain pays essence by its tier alone (perTier × tier, the entry for the floor it falls on), whatever its
// level. A shadow pays nothing: it was paid for once already, as the corpse it rose from.
export const payPer = (floor = Infinity) => at(TUNING.essence.perTier, floor)
export const foeEssence = (u, floor = Infinity) => payPer(floor) * unitDef(u.id).tier
// What a won elite pays on top of its foes, before the relics that raise a battle's pay.
export const eliteBonus = (floor) => Math.round(TUNING.essence.eliteBonus * floorPrice(floor))
export const battleEssence = (battle) => battle.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0).reduce((n, u) => n + foeEssence(u, battle.floor), 0)
// What each foe wave of a battle paid, before relics (a siege pays wave by wave).
export function essenceByWave (battle) {
  const out = battle.waveAt.map(() => 0)
  for (const u of battle.units) if (u.side === 'foe' && !u.shadow && u.hp <= 0) out[u.wave ?? 0] = (out[u.wave ?? 0] ?? 0) + foeEssence(u, battle.floor)
  return Array.from(out, (v) => v ?? 0)
}

// Whether winning room `node` clears the run: the last floor's boss room. A boss before it is won as an elite is.
export const clearsRun = (s, node) => node.type === 'boss' && s.floor === TUNING.run.floors
// What a won room pays on top of its foes: an elite's bounty, and a floor's boss's; none elsewhere.
export const bountyOf = (s, node) => (node.type === 'elite' || (node.type === 'boss' && !clearsRun(s, node)) ? eliteBonus(s.floor) : 0)

// Every price is its base × the floor's price scale (floorPrice) × what the relics' `price.…` mods leave of it (their
// cuts add up) × the run's level's `price`, never below 1.
export const floorPrice = (floor) => 1 + TUNING.essence.perFloor * (floor - 1)
// Every price's scale here, against floor 1's at level 0.
export const priceScale = (s) => floorPrice(s.floor) * ascensionOf(s).price
const price = (run, base, ...paths) => Math.max(1, Math.round(base * floorPrice(run.state.floor) * runStat(run.state, paths, 1) * ascensionOf(run.state).price))
// What tier `i` (0-based: I is 0) costs a soul now; tiers I and II take the `price.lowTier` cuts too.
export const tierPrice = (run, i) => price(run, TUNING.essence.tier[i], 'price.tier', ...(i < 2 ? ['price.lowTier'] : []))
// What soul `u`'s next tier on `track` costs.
export const tierCost = (run, u, track) => tierPrice(run, u.tracks[track])
// What the tiers soul `u` holds pay back when it is fused or released: TUNING.essence.refund of each one's price now,
// rounded down once; a tier it was given free (Soul Lantern's, a consecration's: isFree) pays back nothing.
export function tierRefund (run, u) {
  let sum = 0
  for (let t = 0; t < u.tracks.length; t++) for (let i = 0; i < u.tracks[t]; i++) if (!isFree(u, t, i)) sum += tierPrice(run, i)
  return Math.floor(TUNING.essence.refund * sum)
}
// Whether tier `i` (0-based) of soul `u`'s track `t` was given free: `u.free`, a bit a tier on each track (none: none).
export const isFree = (u, t, i) => (((u.free?.[t] ?? 0) >> i) & 1) === 1
// Marks tier `i` of soul `u`'s track `t` as given free.
export function markFree (u, t, i) {
  u.free = (u.free ?? [0, 0]).slice()
  u.free[t] |= 1 << i
}
// What recruiting a soul of kind `id` costs: TUNING.essence.recruit × its tier, whatever level it rises at.
export const recruitCost = (run, id) => price(run, TUNING.essence.recruit * unitDef(id).tier, 'price.recruit')
export const fuseCost = (run, id) => price(run, TUNING.essence.fuse * unitDef(fusionDef(id).result).tier)
export const relicPrice = (run, id) => relicTierPrice(run, relicTier(id))
const relicTierPrice = (run, tier) => price(run, TUNING.shop.price[tier], 'price.relic')

// Whether soul `u` (one of the run's, never the Monarch) may take its next tier on `track` (0 or 1): a kind with two
// tracks, within the crosspath rule (canTrack: up to IV, the other stopping at II).
export const canAdvance = (s, u, track) => !!u && !isMonarch(u) && s.party.includes(u) && (track === 0 || track === 1) && tracksOf(u.id).length === 2 && canTrack(u.tracks, track)
export const canUpgrade = (run, u, track) => canAdvance(run.state, u, track) && run.state.essence >= tierCost(run, u, track)

export function pay (run, cost) {
  const s = run.state
  if (s.essence < cost) throw new Error('not enough essence')
  s.essence -= cost
  s.stats.spent += cost
}

// Soul `u` takes its next tier on `track`, and the level its tiers give (setLevel). A Colossus tier (`size: 2`) grows
// it to 2×2: fielded where its footprint no longer fits, it goes to the ossuary.
export function advance (s, u, track) {
  if (!canAdvance(s, u, track)) throw new Error(`no next tier on track ${track} for ${u?.id} ${u?.uid}`)
  u.tracks = nextTracks(u.tracks, track)
  setLevel(u, levelOf(u))
  if (onField(u) && !fits(s.camp, u.slot, sizeOf(u), takenBy(s, [u]))) u.slot = OSSUARY
}

// A soul's level from the tiers it holds (`tracks`: its own, or any { tracks }): TUNING.level.base + perTier a tier on
// either track, rounded down. No level is bought; a soul with no tier (a recruit, a fused soul) stands at the first.
export const levelOf = ({ tracks }) => Math.floor(TUNING.level.base + TUNING.level.perTier * (tracks[0] + tracks[1]))
export const firstLevel = () => levelOf({ tracks: [0, 0] })

// A level-up raises the soul's max HP and heals a living one by the difference; the fallen stay at 0.
export function setLevel (u, lvl) {
  const before = u.maxHp
  u.lvl = lvl
  u.maxHp = baseStats(u.id, u.lvl).hp
  if (u.hp > 0) u.hp += u.maxHp - before
}

// The track a free tier goes on (Soul Lantern): the one with fewer tiers (the first on a tie), else the other; null: none.
export const lowerTrack = (tracks) => [tracks[1] < tracks[0] ? 1 : 0, tracks[1] < tracks[0] ? 0 : 1].find((t) => canTrack(tracks, t)) ?? null
// The tracks Soul Lantern's free tiers go on, in order, for a soul recruited (a copy each).
export function lanternSteps (s) {
  const steps = []
  for (let tracks = [0, 0], t; steps.length < runStat(s, 'run.soulTiers', 0) && (t = lowerTrack(tracks)) !== null; tracks = nextTracks(tracks, t)) steps.push(t)
  return steps
}
// The tracks a soul recruited joins with: Soul Lantern's free tiers (lanternSteps), none without it.
export const freshTracks = (s) => lanternSteps(s).reduce(nextTracks, [0, 0])

// ── rewards ──────────────────────────────────────────────────────────────────────────────────────

// One soul for sale per kind of foe slain, a fresh soul (soulOffer); one of them is recruited a battle (reap). A foe
// shadow is no foe's soul, and a boss leaves none (its court does).
export function soulOffers (run, battle) {
  const slain = battle.units.filter((u) => u.side === 'foe' && !u.shadow && u.hp <= 0 && !unitDef(u.id).boss)
  return [...new Set(slain.map((u) => u.id))].map((id) => soulOffer(run, { type: 'soul', id, name: unitDef(id).name }))
}

// A soul offer as the run stands now: the level it rises at (its first, Soul Lantern's tiers in), its cost
// (recruitCost) and its line. Every reading of an offer's price or level goes through here, so the relics held now are
// in both.
export function soulOffer (run, o) {
  const lvl = levelOf({ tracks: freshTracks(run.state) })
  return { ...o, lvl, cost: recruitCost(run, o.id), desc: `Rises at level ${lvl}.` }
}

export const relicOffer = (r) => ({ type: 'relic', id: r.id, name: r.name, desc: r.desc, tier: r.tier })
// Whether relic `r` may be stocked: one that needs Arise only once an Arise relic is owned. One owned may come again.
const offerable = (s, r) => !r.needsArise || ariseHeld(s)
// The shelf's tier weights on the floor (its entry, the last for every floor past them).
export const relicWeights = (floor) => {
  const w = TUNING.relic.weights.shop
  return w[Math.min(floor, w.length) - 1]
}

// A relic that raises Command (the shelf always holds one).
const isCommandRelic = (r) => (r.mods ?? []).some((m) => m.path === 'run.command' && m.v > 0)
// One relic for a shelf slot, drawn on `rng`, never one of `on`: a Legendary (`legendary`), else one of a tier drawn by
// the floor's weights (relicWeights), from the Command relics alone where `command`. → a relic record, or null.
function drawSlot (s, rng, on, { command = false, legendary = false } = {}) {
  if (legendary) {
    const legendaries = RELIC_LIST.filter((r) => r.tier === 'legendary' && offerable(s, r) && !on.includes(r))
    return legendaries.length ? rng.pick(legendaries) : null
  }
  const weights = relicWeights(s.floor)
  const left = (tier) => RELIC_LIST.filter((r) => r.tier === tier && offerable(s, r) && !on.includes(r) && (!command || isCommandRelic(r)))
  const tiers = RELIC_TIERS.filter((t) => t.id !== 'legendary' && (weights[t.id] ?? 0) > 0 && left(t.id).length)
  if (!tiers.length) return null
  return rng.pick(left(rng.weighted(tiers, tiers.map((t) => weights[t.id])).id))
}
// Whether the floor's shelf holds a Legendary.
const legendaryFloor = (s) => s.floor >= TUNING.relic.legendary.fromFloor

// The floor's shelf: TUNING.shop.relics relic ids drawn on the floor's own stream as it is entered, the first a Command
// relic, so the field never grows by luck; from TUNING.relic.legendary.fromFloor one a Legendary. Shuffled.
export function stockShop (s) {
  const rng = createRng(s.seed).stream(`shop|${s.floor}`)
  const out = []
  const legendary = legendaryFloor(s) ? 1 : 0
  for (let k = 0; k < TUNING.shop.relics - legendary; k++) {
    const r = drawSlot(s, rng, out, { command: k === 0 })
    if (!r) break
    out.push(r)
  }
  const top = legendary ? drawSlot(s, rng, out, { legendary: true }) : null
  if (top) out.push(top)
  return rng.shuffle(out).map((r) => r.id)
}

// The shelf after a battle won: each bought slot (null) drawn again on the room's own stream, a Legendary while the
// floor has one and none is on the shelf, else a Command relic while none is, else any. The rest stay where they are.
export function restock (s) {
  if (!s.shop.includes(null)) return
  const rng = createRng(s.seed).stream(`shop|${s.floor}|${s.at}`)
  const on = () => s.shop.filter(Boolean).map(relicDef)
  for (let i = 0; i < s.shop.length; i++) {
    if (s.shop[i] !== null) continue
    const legendary = legendaryFloor(s) && !on().some((r) => r.tier === 'legendary')
    const command = !legendary && !on().some((r) => r.tier !== 'legendary' && isCommandRelic(r))
    s.shop[i] = drawSlot(s, rng, on(), { command, legendary })?.id ?? null
  }
}
