// Learned risk (redesign.md §2.20): two small logistic models fitted offline on thousands of the expert's runs and
// shipped as coefficients (risk.json), in the spirit of the combo book. At play time each is a weighted sum of cheap
// features read off what a player sees, squashed to a probability: pure scoring, nothing played ahead (§2.17).
//   positionRisk(battle)   the chance the Monarch falls within the model's K turns from this board (the foes' turn
//                          to come counted first), read at the start of a turn of yours or once its orders are given
//                          (`idle` tells the two apart). For the expert's board evaluation and its tree.
//   roomRisk(run, node)    the chance the run is lost in battle room `node`, read when it is chosen on the map from
//                          the army as it stands and the room as scouting shows it. 0 for a Shop, an altar. For the
//                          route.
// Each model is { k?, features, mean, sd, w, b }: the features standardised by the training data's mean and sd, then
// p = 1 / (1 + e^−(b + w·z)). A neural network may later stand behind the same two functions.
//
// Regenerate (after the game's numbers or the expert change):  node src/sim/risk.js --fit [--runs 2000]
// [--seed risk] [--workers N] [--data file] [--out file] [--no-play]: plays `runs` expert runs (seeds `risk-1`…) in
// worker threads, sampling every position at a turn's start and at its End Turn and every battle room walked into,
// labels them by what followed (the Monarch's fall and its turn; the run lost in that room), fits each model on four
// runs in five and reports it on the fifth (AUC, log-loss against the base rate, calibration), and writes risk.json.
// The samples are kept a run at a time in `--data` (by default the OS's temp directory, by the seed), so a sampling
// stopped part way goes on from where it was, and `--no-play` fits on what is there; delete it (or take another
// `--seed`) once the game or the expert has changed.
import RISK from './risk.json' with { type: 'json' }
import { TUNING } from '../tuning.js'
import { unitDef, statusDef, abilityDef, relicDef } from '../content.js'
import {
  alive, isBlow, blowReach, distanceBetween, unitDistance, lineEnds, LINE_AT, LINE_TILES, TILES, tileX, tileY, makeUnit, statsOf, heldMods,
  summonsOf, abilitiesOf, isRunPath
} from './unit.js'
import { roadOf } from './field.js'
import { stats, roadAhead, lined, isSkill, hexed, nextWave, impatience, orderable } from './turns.js'
import { souls, monarchOf, fieldCap, foeMods, roomThreats, isRunRelic, relicTier } from './run.js'
import { RANKS } from './map.js'

export { RISK }

// ── the position's features ──────────────────────────────────────────────────────────────────────

// The threat types a foe's kind may carry (content.js THREATS; depth is a room's).
const KINDS = ['reach', 'shape', 'drain', 'sustain', 'fly', 'burn', 'bleed']

// What positionFeatures reads, in its order (the Monarch's HP counted as it stands; "next turn" the foes' turn to come;
// a foe's `turns` until it can strike the Monarch: its road walked with no one in the way, 1 for the coming turn):
//   share       the Monarch's HP over its max (its wounds are the run's: redesign.md §2.18 C)
//   danger      what the foes could deal it next turn, over its HP (to 3): each foe's hardest ready blow that reaches it
//               from a tile its road takes it to this turn, on a clear line for a blow that keeps to one (§2.19)
//   lethal      that danger fells it
//   splash      what more the shape blows could deal it next turn by striking one of yours it stands beside (a blast on
//               a neighbour, a row or a lane it shares), over its HP (to 3)
//   danger2     what the foes could deal it within two turns, roads walked with no one in the way and no line, over its
//               HP (to 3)
//   strikers    the foes that could strike it next turn
//   linesNow    the foes with a blow that keeps to a line reaching it from where they stand, on a clear line
//   linesNext   the same from a tile their road takes them to next turn
//   screened    the foes whose blow would reach it next turn but for one of yours on every line
//   near        Σ over the foes of 1 / turns
//   open        the same over the foes whose road into it no one of yours stands on
//   reach … bleed   the same over the foes carrying each threat type
//   soonest     1 / the fewest turns any foe needs
//   foes        the living foes on the board
//   reserve     the foes still to come, of all the battle's left
//   wave        1 / (1 + the turns until the next wave enters); 0 with none to come
//   patience    the camp's impatience (turns.js: a player counts the turns since the last wave)
//   pieces      your pieces standing, of those that took the board
//   piecesHp    their HP over their max
//   shadows     your shadows and summons standing
//   balance     the log of your side's HP on the board over the foes'
//   killNeed    the HP of the foes that could strike it next turn over the sum of your pieces' hardest blows (to 5)
//   crowd       your units beside it
//   mend        your units that heal, none while nothing may heal it
//   foeMend     the foes that heal
//   dot         what its damage over time deals at the turn's end, over its HP
//   airGap      Σ 1 / turns over the flyers, where none of yours can strike one
//   idle        your pieces yet to act, of those standing (1 as a turn starts, 0 once its orders are given)
//   dangerIdle  danger × idle
//   floor       the floor (to 5)
//   boss        the boss's room
//   turn        the log of the turn
export const POSITION_FEATURES = [
  'share', 'danger', 'lethal', 'splash', 'danger2', 'strikers', 'linesNow', 'linesNext', 'screened', 'near', 'open',
  ...KINDS, 'soonest', 'foes', 'reserve', 'wave', 'patience', 'pieces', 'piecesHp', 'shadows', 'balance', 'killNeed',
  'crowd', 'mend', 'foeMend', 'dot', 'airGap', 'idle', 'dangerIdle', 'floor', 'boss', 'turn'
]
const P = Object.fromEntries(POSITION_FEATURES.map((f, i) => [f, i]))
const SHAPES = new Set(['blast', 'column', 'row', 'all'])
const NONE = Object.freeze([])

// A blow's damage before its target's DEF (policy.js rawOf's): its power × the dealer's ATK and damage dealt.
function rawOf (battle, u, b) {
  const s = stats(battle, u)
  let power = 0
  for (const e of b.effects) if (e.op === 'damage') power += e.power
  return power * s.atk / TUNING.damage.atkDivisor * s.damage.dealt
}

// What share of a raw blow `x` takes: its DEF's and its damage taken.
const mitigation = (battle, x) => {
  const s = stats(battle, x)
  return TUNING.damage.defConstant / (TUNING.damage.defConstant + Math.max(0, s.def)) * s.damage.taken
}

// Whether no one of the Monarch's side but it stands strictly between a footprint at `t` (of `size`) and it.
function clearTo (battle, t, size, m) {
  const [p, q] = lineEnds(t, size, m.tile, m.size)
  const k = p * TILES + q
  for (let i = LINE_AT[k]; i < LINE_AT[k + 1]; i++) {
    const c = LINE_TILES[i]
    const g = battle.at[c]
    if (g !== null && g.side === m.side && g !== m) return false
    const a = battle.sky[c]
    if (a !== null && a.side === m.side && a !== m) return false
  }
  return true
}

// Whether a shape blow aimed at `p` (one of the Monarch's side) from `t` takes in the Monarch `m` too.
function sweeps (shape, range, t, size, p, m) {
  if (p === m) return false
  if (shape === 'blast') return unitDistance(p, m) <= 1
  if (shape === 'column') return tileX(m.tile) < tileX(p.tile) + p.size && tileX(p.tile) < tileX(m.tile) + m.size
  if (shape === 'row') return tileY(m.tile) < tileY(p.tile) + p.size && tileY(p.tile) < tileY(m.tile) + m.size
  return !range || distanceBetween(t, size, m.tile, m.size) <= range
}

// The damage over time a unit holds will deal it at the turn's end (none from a status laid since its turn passed).
function dotOn (u) {
  let n = 0
  for (const s of u.statuses) {
    if (s.fresh) continue
    for (const e of statusDef(s.id).tick ?? NONE) if (e.op === 'dot') n += e.power * s.stacks
  }
  return n
}

// The position as POSITION_FEATURES reads it (into `out`, a Float64Array, if given), null for a battle over or with no
// Monarch standing. Reads the board, the counts the wave counter and the bestiary show; never the camp's policy, its
// pressure or a turn ahead. Costs tens of microseconds (stats are the battle's cache).
export function positionFeatures (battle, out = new Float64Array(POSITION_FEATURES.length)) {
  const m = battle.monarch
  if (battle.over || !m || !alive(m)) return null
  out.fill(0)
  const hp = m.hp
  const mit = mitigation(battle, m)
  let danger = 0
  let splash = 0
  let danger2 = 0
  let fewest = Infinity
  let foeHp = 0
  let strikerHp = 0
  let flyers = 0
  for (const x of battle.units) {
    if (x.side !== 'foe' || !alive(x)) continue
    out[P.foes]++
    foeHp += x.hp
    if (x.mend) out[P.foeMend]++
    const stunned = hexed(x)
    const road = roadOf(battle, x)
    // Its road walked with no one in the way: the steps until its farthest blow reaches the Monarch, and whether one of
    // yours stands on it short of the seat (a ground foe's road held by one on the ground, a flyer's by one below or in
    // the air).
    let far = 0
    let hardest = 0
    for (const b of x.kit) {
      if (!isBlow(b)) continue
      const raw = rawOf(battle, x, b)
      if (!(raw > 0)) continue
      far = Math.max(far, blowReach(x, b))
      hardest = Math.max(hardest, raw)
    }
    if (!(hardest > 0)) continue
    let k = -1
    let held = false
    for (let t = x.tile, n = 0; t >= 0 && n <= TILES; t = road.arrow[t], n++) {
      if (k < 0 && distanceBetween(t, x.size, m.tile, m.size) <= far) k = n
      if (n > 0 && road.dist[t] >= 1) {
        const g = battle.at[t]
        if (g !== null && g.side === 'party' && g !== m) held = true
        if (x.flies && battle.sky[t] !== null && battle.sky[t].side === 'party') held = true
      }
      if (road.dist[t] < 1) break
    }
    const move = Math.max(0, x.move)
    const turns = k < 0 ? Infinity : k === 0 ? 1 : move > 0 ? Math.ceil(k / move) : Infinity
    const w = Number.isFinite(turns) ? 1 / turns : 0
    fewest = Math.min(fewest, turns)
    out[P.near] += w
    if (!held) out[P.open] += w
    for (const kind of unitDef(x.id).threats ?? NONE) if (kind in P) out[P[kind]] += w
    if (x.flies) flyers += w
    if (turns <= 2 && !stunned) danger2 += hardest * mit
    if (stunned) continue
    // Next turn: its ready blows from each tile its road takes it to.
    const spots = roadAhead(battle, x, x.move)
    let deals = 0
    let unlined = 0
    let sweep = 0
    let now = false
    let next = false
    for (const b of x.kit) {
      if (!isBlow(b) || (isSkill(x, b) && (x.cooldowns[b.id] ?? 0) > 0)) continue
      const raw = rawOf(battle, x, b)
      if (!(raw > 0)) continue
      const r = blowReach(x, b)
      const line = lined(b)
      for (const s of spots) {
        if (distanceBetween(s.tile, x.size, m.tile, m.size) > r) continue
        unlined = Math.max(unlined, raw)
        if (line && !clearTo(battle, s.tile, x.size, m)) continue
        deals = Math.max(deals, raw)
        if (line) {
          next = true
          if (s.tile === x.tile) now = true
        }
      }
      if (!SHAPES.has(b.shape) || raw <= sweep) continue
      // A shape aimed at one of yours that takes the Monarch in with it.
      for (const p of battle.units) {
        if (p.side !== 'party' || !alive(p) || p === m || raw <= sweep) continue
        const rp = p.flies && b.melee && !x.flies ? -1 : r
        if (rp < 0) continue
        for (const s of spots) {
          if (distanceBetween(s.tile, x.size, p.tile, p.size) <= rp && sweeps(b.shape, b.range, s.tile, x.size, p, m)) {
            sweep = raw
            break
          }
        }
      }
    }
    if (deals > 0) {
      out[P.strikers]++
      strikerHp += x.hp
      danger += deals * mit
    } else if (unlined > 0) out[P.screened]++
    if (sweep > deals) splash += (sweep - deals) * mit
    if (now) out[P.linesNow]++
    if (next) out[P.linesNext]++
  }
  // Your side.
  let all = 0
  let up = 0
  let pieceHp = 0
  let pieceMax = 0
  let ours = 0
  let blows = 0
  let idle = 0
  let air = false
  for (const u of battle.units) {
    if (u.side !== 'party' || u === m) continue
    if (!u.shadow && !u.into) all++
    if (!alive(u)) continue
    ours += u.hp
    if (u.shadow) out[P.shadows]++
    else {
      up++
      pieceHp += u.hp
      pieceMax += u.maxHp
      if (orderable(battle, u) && !u.acted) idle++
    }
    let hard = 0
    for (const b of u.kit) {
      if (!isBlow(b)) continue
      if (!b.melee || u.flies) air = true
      if (!u.shadow) hard = Math.max(hard, rawOf(battle, u, b))
    }
    blows += hard
    if (u.mend && !battle.unhealable) out[P.mend]++
    if (unitDistance(u, m) <= 1) out[P.crowd]++
  }
  out[P.share] = hp / m.maxHp
  out[P.danger] = Math.min(3, danger / hp)
  out[P.lethal] = danger >= hp ? 1 : 0
  out[P.splash] = Math.min(3, splash / hp)
  out[P.danger2] = Math.min(3, danger2 / hp)
  out[P.soonest] = Number.isFinite(fewest) ? 1 / fewest : 0
  const left = battle.reserve.length
  out[P.reserve] = left / Math.max(1, left + out[P.foes])
  const w = nextWave(battle)
  out[P.wave] = w ? 1 / (1 + Math.max(0, w.turn - battle.turn)) : 0
  out[P.patience] = impatience(battle)
  out[P.pieces] = all ? up / all : 0
  out[P.piecesHp] = pieceMax ? pieceHp / pieceMax : 0
  out[P.balance] = Math.log((1 + ours) / (1 + foeHp))
  out[P.killNeed] = Math.min(5, strikerHp / Math.max(1, blows))
  out[P.dot] = Math.min(3, dotOn(m) / hp)
  out[P.airGap] = air ? 0 : flyers
  out[P.idle] = up ? idle / up : 0
  out[P.dangerIdle] = out[P.danger] * out[P.idle]
  out[P.floor] = Math.min(5, battle.floor ?? 1)
  out[P.boss] = battle.boss ? 1 : 0
  out[P.turn] = Math.log(Math.max(1, battle.turn))
  return out
}

// ── the room's features ──────────────────────────────────────────────────────────────────────────

const BATTLE_ROOMS = new Set(['fight', 'elite', 'siege', 'boss'])

// What roomRiskFeatures reads, in its order (the army: the standing souls the field holds, the strongest first, by
// `might`; a soul's or a foe's might the root of how long it lasts times how hard it hits, its summons counted):
//   floor, rank        where the room stands (rank over the floor's ranks)
//   elite, siege, boss the room's type (a fight none of them)
//   odds               the log of the army's might (its wounds counted) over the room's scouted foes' (theirs whole,
//                      every wave's, the floor's growth on them)
//   room               the log of the room's might
//   pieces, cap        the souls the field would hold, and the field cap
//   soulsHp            their HP over their max
//   fallen             the souls lying fallen
//   monarch            the Monarch's HP over its max, and `monarchMax` its max over the base
//   essence            the log of the purse
//   relics, tiers, legendary  the relics owned, the track tiers held, the Legendaries
//   foes, late, waves  the room's foes, those of its later waves, and its waves
//   reach … bleed      its foes carrying each threat type
//   noAir, noRange     a flyer or a shooter among them and no standing soul with a blow that answers it
//   tierMax, lvlGap    its highest tier, and its foes' mean level less the army's
export const ROOM_FEATURES = [
  'floor', 'rank', 'elite', 'siege', 'boss', 'odds', 'room', 'pieces', 'cap', 'soulsHp', 'fallen', 'monarch', 'monarchMax', 'essence',
  'relics', 'tiers', 'legendary', 'foes', 'late', 'waves', ...KINDS, 'noAir', 'noRange', 'tierMax', 'lvlGap'
]
const R = Object.fromEntries(ROOM_FEATURES.map((f, i) => [f, i]))

// A unit's might with `mods`, at `share` of its HP: √(lasts × hits), and half as much again for each summon.
function might (u, mods, share = 1) {
  const s = statsOf(u, mods)
  const lasts = s.hp * share * (1 + Math.max(0, s.def) / 100) / s.damage.taken
  const hits = s.atk * s.damage.dealt
  return Math.sqrt(Math.max(0, lasts * hits)) * (1 + 0.5 * summonsOf(u))
}

const kitOf = (u) => abilitiesOf(u).map(abilityDef)

// Battle room `node` (one the run may walk into, as the map scouts it) against the army as it stands, as
// ROOM_FEATURES reads it (into `out` if given); null for a room with no battle.
export function roomRiskFeatures (run, node, out = new Float64Array(ROOM_FEATURES.length)) {
  if (!node || !BATTLE_ROOMS.has(node.type) || !node.foes) return null
  const s = run.state
  out.fill(0)
  const sideMods = s.relics.filter(isRunRelic).flatMap((id) => (relicDef(id).mods ?? []).filter((x) => !isRunPath(x.path)))
  const cap = fieldCap(run)
  const all = souls(s.party)
  const army = all.filter((u) => u.hp > 0).map((u) => ({ u, p: might(u, [...heldMods(u), ...sideMods], u.hp / u.maxHp) }))
    .sort((a, b) => b.p - a.p || a.u.uid - b.u.uid).slice(0, cap)
  const boss = node.type === 'boss'
  const fmods = foeMods(s.floor, boss)
  const late = (node.waves ?? []).flatMap((w) => w.foes)
  const foes = [...node.foes, ...late]
  let room = 0
  let lvl = 0
  for (const f of foes) {
    room += might(makeUnit(f.id, { lvl: f.lvl }), fmods)
    lvl += f.lvl
    const def = unitDef(f.id)
    for (const kind of def.threats ?? NONE) if (kind in R) out[R[kind]]++
    out[R.tierMax] = Math.max(out[R.tierMax], def.tier ?? 1)
  }
  const strength = army.reduce((n, x) => n + x.p, 0)
  const m = monarchOf(s)
  out[R.floor] = Math.min(5, s.floor)
  out[R.rank] = (node.rank ?? 0) / RANKS
  if (node.type !== 'fight') out[R[node.type]] = 1
  out[R.odds] = Math.log((1 + strength) / (1 + room))
  out[R.room] = Math.log(1 + room)
  out[R.pieces] = army.length
  out[R.cap] = cap
  const max = army.reduce((n, x) => n + x.u.maxHp, 0)
  out[R.soulsHp] = max ? army.reduce((n, x) => n + x.u.hp, 0) / max : 0
  out[R.fallen] = all.filter((u) => u.hp <= 0).length
  out[R.monarch] = m.hp / m.maxHp
  out[R.monarchMax] = m.maxHp / TUNING.monarch.hp
  out[R.essence] = Math.log(1 + Math.max(0, s.essence))
  out[R.relics] = s.relics.length
  out[R.tiers] = Object.values(s.kinds).reduce((n, k) => n + k.tracks[0] + k.tracks[1], 0)
  out[R.legendary] = s.relics.filter((id) => relicTier(id) === 'legendary').length
  out[R.foes] = foes.length
  out[R.late] = late.length
  out[R.waves] = node.waves?.length ?? 0
  const threats = roomThreats(node)
  const standing = all.filter((u) => u.hp > 0)
  const ranged = (u) => kitOf(u).some((a) => isBlow(a) && !a.melee)
  if (threats.has('fly') && !standing.some((u) => ranged(u) || !!unitDef(u.id).flies)) out[R.noAir] = 1
  if (threats.has('reach') && !standing.some(ranged)) out[R.noRange] = 1
  out[R.lvlGap] = foes.length && army.length ? lvl / foes.length - army.reduce((n, x) => n + x.u.lvl, 0) / army.length : 0
  return out
}

// ── the models ───────────────────────────────────────────────────────────────────────────────────

// A model of risk.json folded for play: the weights over the raw features (w / sd) and the bias with the means taken
// in. Null where the json holds none (before the first fit) or its features are not this file's (a stale json).
function fold (model, names) {
  if (!model || model.features?.length !== names.length || model.features.some((f, i) => f !== names[i])) return null
  const w = new Float64Array(names.length)
  let b = model.b
  for (let i = 0; i < names.length; i++) {
    const sd = model.sd[i] || 1
    w[i] = model.w[i] / sd
    b -= model.w[i] * model.mean[i] / sd
  }
  return { w, b, k: model.k ?? null }
}
const POSITION = fold(RISK.position, POSITION_FEATURES)
const ROOM = fold(RISK.room, ROOM_FEATURES)
const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const apply = (model, x) => {
  let z = model.b
  for (let i = 0; i < x.length; i++) z += model.w[i] * x[i]
  return sigmoid(z)
}

// The K the position model was fitted for (the Monarch's fall within K turns), null with no model.
export const POSITION_K = POSITION?.k ?? null

const scratch = new Float64Array(POSITION_FEATURES.length)
// The chance the Monarch falls within POSITION_K turns from this board (the foes' coming turn first): 0 for a battle
// over or with no Monarch, and with no model.
export function positionRisk (battle) {
  if (!POSITION) return 0
  const x = positionFeatures(battle, scratch)
  return x ? apply(POSITION, x) : 0
}

const roomScratch = new Float64Array(ROOM_FEATURES.length)
// The chance the run is lost in room `node` (a node of the map the run may walk into): 0 for a room with no battle,
// and with no model.
export function roomRisk (run, node) {
  if (!ROOM) return 0
  const x = roomRiskFeatures(run, node, roomScratch)
  return x ? apply(ROOM, x) : 0
}

// ── fitting (offline) ────────────────────────────────────────────────────────────────────────────

// An L2-regularised logistic regression by Newton's method on standardised features, each step halved until the
// penalised loss falls (plain Newton overshoots on near-separable data): X a Float32Array of n rows of d, y 0/1 (a
// Uint8Array), the penalty λ/2 |w|² on the weights (not the bias), `rows` the rows to fit on (all by default).
// → { mean, sd, w, b }.
const softplus = (s) => (s > 0 ? s + Math.log1p(Math.exp(-s)) : Math.log1p(Math.exp(s)))
export function fitLogistic (X, y, n, d, lambda = 1, { iters = 40, rows = null } = {}) {
  const idx = rows ?? Array.from({ length: n }, (_, i) => i)
  const N = idx.length
  const mean = new Float64Array(d)
  const sd = new Float64Array(d)
  for (const r of idx) for (let j = 0; j < d; j++) mean[j] += X[r * d + j]
  for (let j = 0; j < d; j++) mean[j] /= N
  for (const r of idx) for (let j = 0; j < d; j++) sd[j] += (X[r * d + j] - mean[j]) ** 2
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j] / N) || 1
  const D = d + 1
  // The standardised rows, the bias's 1 last.
  const Z = new Float32Array(N * D)
  const Y = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    const r = idx[i]
    for (let j = 0; j < d; j++) Z[i * D + j] = (X[r * d + j] - mean[j]) / sd[j]
    Z[i * D + d] = 1
    Y[i] = y[r]
  }
  const loss = (beta) => {
    let l = 0
    for (let i = 0; i < N; i++) {
      let s = 0
      for (let j = 0; j < D; j++) s += beta[j] * Z[i * D + j]
      l += softplus(Y[i] ? -s : s)
    }
    for (let j = 0; j < d; j++) l += lambda / 2 * beta[j] * beta[j]
    return l
  }
  let beta = new Float64Array(D)
  const pos = Y.reduce((k, v) => k + v, 0)
  beta[d] = Math.log(Math.max(1, pos) / Math.max(1, N - pos))
  let now = loss(beta)
  for (let it = 0; it < iters; it++) {
    const g = new Float64Array(D)
    const H = new Float64Array(D * D)
    for (let i = 0; i < N; i++) {
      const o = i * D
      let s = 0
      for (let j = 0; j < D; j++) s += beta[j] * Z[o + j]
      const p = sigmoid(s)
      const e = Y[i] - p
      const v = Math.max(1e-12, p * (1 - p))
      for (let a = 0; a < D; a++) {
        const za = Z[o + a]
        if (za === 0) continue
        g[a] += e * za
        const va = v * za
        for (let b = 0; b <= a; b++) H[a * D + b] += va * Z[o + b]
      }
    }
    for (let a = 0; a < d; a++) {
      g[a] -= lambda * beta[a]
      H[a * D + a] += lambda
    }
    for (let a = 0; a < D; a++) for (let b = 0; b < a; b++) H[b * D + a] = H[a * D + b]
    const step = solve(H, g, D)
    let t = 1
    let next = null
    let after = Infinity
    for (let k = 0; k < 30; k++, t /= 2) {
      next = beta.map((v, j) => v + t * step[j])
      after = loss(next)
      if (after <= now) break
    }
    if (!(after <= now)) break
    const fell = now - after
    beta = next
    now = after
    if (fell < 1e-9 * Math.max(1, now)) break
  }
  return { mean: [...mean], sd: [...sd], w: [...beta.subarray(0, d)], b: beta[d] }
}

// Solves H x = g for a symmetric positive definite H (D × D) by Cholesky.
function solve (H, g, D) {
  const L = new Float64Array(D * D)
  for (let i = 0; i < D; i++) {
    for (let j = 0; j <= i; j++) {
      let s = H[i * D + j]
      for (let k = 0; k < j; k++) s -= L[i * D + k] * L[j * D + k]
      L[i * D + j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j * D + j]
    }
  }
  const t = new Float64Array(D)
  for (let i = 0; i < D; i++) {
    let s = g[i]
    for (let k = 0; k < i; k++) s -= L[i * D + k] * t[k]
    t[i] = s / L[i * D + i]
  }
  const x = new Float64Array(D)
  for (let i = D - 1; i >= 0; i--) {
    let s = t[i]
    for (let k = i + 1; k < D; k++) s -= L[k * D + i] * x[k]
    x[i] = s / L[i * D + i]
  }
  return x
}

// A fitted model's probability for row r of X.
const predict = (model, X, d, r) => {
  let s = model.b
  for (let j = 0; j < d; j++) s += model.w[j] * (X[r * d + j] - model.mean[j]) / (model.sd[j] || 1)
  return sigmoid(s)
}

// The area under the ROC curve of scores p for labels y (ties count half).
export function auc (p, y) {
  const order = [...p.keys()].sort((a, b) => p[a] - p[b])
  let pos = 0
  let rankSum = 0
  for (let i = 0; i < order.length;) {
    let j = i
    while (j < order.length && p[order[j]] === p[order[i]]) j++
    const rank = (i + j + 1) / 2
    for (let k = i; k < j; k++) if (y[order[k]]) { pos++; rankSum += rank }
    i = j
  }
  const neg = order.length - pos
  return pos && neg ? (rankSum - pos * (pos + 1) / 2) / (pos * neg) : NaN
}

// The mean log-loss of p for labels y.
const logLoss = (p, y) => p.reduce((n, q, i) => n - Math.log(Math.max(1e-12, y[i] ? q : 1 - q)), 0) / p.length

// Held-out reading of a model: AUC, log-loss against the base rate's, and calibration by bins of the prediction
// (BINS: [mean predicted, observed rate, rows]).
const BINS = [0, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1.0001]
function evaluate (model, X, y, d, rows) {
  const p = rows.map((r) => predict(model, X, d, r))
  const t = rows.map((r) => y[r])
  const base = t.reduce((n, v) => n + v, 0) / t.length
  const cal = []
  for (let k = 0; k + 1 < BINS.length; k++) {
    const inBin = p.map((q, i) => i).filter((i) => p[i] >= BINS[k] && p[i] < BINS[k + 1])
    if (!inBin.length) continue
    cal.push([+(inBin.reduce((n, i) => n + p[i], 0) / inBin.length).toFixed(5), +(inBin.reduce((n, i) => n + t[i], 0) / inBin.length).toFixed(5), inBin.length])
  }
  return {
    n: t.length,
    positives: t.reduce((n, v) => n + v, 0),
    auc: +auc(p, t).toFixed(4),
    logLoss: +logLoss(p, t).toFixed(5),
    baseLogLoss: +logLoss(t.map(() => base), t).toFixed(5),
    predicted: +(p.reduce((n, q) => n + q, 0) / p.length).toFixed(5),
    observed: +base.toFixed(5),
    calibration: cal,
    p,
    t
  }
}

// Fits on `train`, λ among LAMBDAS picked by log-loss on its runs whose index is 1 mod 5 when fitted on the rest
// (`runOf`: a row's run), then fitted again on all of `train` and read on `test` (held out throughout).
// → { model, lambda, held (evaluate's) }.
const LAMBDAS = [1, 10, 100, 1000]
function fitBest (X, y, d, train, test, runOf) {
  const inner = train.filter((r) => runOf[r] % 5 === 1)
  const outer = train.filter((r) => runOf[r] % 5 !== 1)
  let pick = null
  for (const lambda of LAMBDAS) {
    const v = evaluate(fitLogistic(X, y, outer.length, d, lambda, { rows: outer }), X, y, d, inner)
    console.log(`    λ ${String(lambda).padStart(4)}: validation AUC ${v.auc}, log-loss ${v.logLoss} (base ${v.baseLogLoss})`)
    if (!pick || v.logLoss < pick.logLoss) pick = { lambda, logLoss: v.logLoss }
  }
  const model = fitLogistic(X, y, train.length, d, pick.lambda, { rows: train })
  return { model, lambda: pick.lambda, held: evaluate(model, X, y, d, test) }
}

// The largest weights of a model (on standardised features), by size.
const top = (model, names, n = 10) => names.map((f, i) => [f, +model.w[i].toFixed(3)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, n)

// ── sampling (offline): one expert run's positions and rooms ─────────────────────────────────────

// One expert run (autoplay.js's policy, the stream autoplay's), the samples it gives: each position at the start of a
// turn of yours (kind 0) and as its End Turn is given (kind 1), with its battle, turn and the turn the Monarch fell in
// (−1 for none); each battle room walked into, labelled 1 for the room the run was lost in. Dynamic imports: the
// autoplayer is never this module's at play.
async function sampleRun (seed) {
  const { policy } = await import('./autoplay.js')
  const { createRun, apply: act } = await import('./run.js')
  const { createRng } = await import('./rng.js')
  const { nodeOf } = await import('./map.js')
  const run = createRun({ seed })
  const rng = createRng(run.state.seed).stream('autoplay')
  const dp = POSITION_FEATURES.length
  const dr = ROOM_FEATURES.length
  const pos = []
  const meta = []
  const rooms = []
  const roomMeta = []
  let battleNo = -1
  let first = 0
  let last = -1
  const take = (kind) => {
    const x = positionFeatures(run.battle)
    if (!x) return
    pos.push(...x)
    meta.push(battleNo, run.battle.turn, kind, -1, run.battle.floor)
  }
  for (let guard = 0; run.state.phase !== 'over'; guard++) {
    if (guard > 1e6) throw new Error('stuck')
    const was = run.state.phase
    if (was === 'battle' && !run.battle.over && run.battle.stage === 'party' && run.battle.turn !== last) {
      last = run.battle.turn
      take(0)
    }
    const action = policy(run, rng, 'expert')
    if (was === 'battle' && action.type === 'end') take(1)
    if (was === 'map' && action.type === 'node') {
      const node = nodeOf(run.state.map, action.id)
      const x = roomRiskFeatures(run, node)
      if (x) {
        rooms.push(...x)
        roomMeta.push(run.state.floor, 0)
      }
    }
    act(run, action)
    if (action.type === 'fight') {
      battleNo++
      first = meta.length
      last = -1
    }
    if (was === 'battle' && run.state.phase !== 'battle') {
      const b = run.battle
      const fell = b.winner !== 'party' && b.reason === 'monarch' ? b.turn : -1
      for (let i = first; i < meta.length; i += 5) meta[i + 3] = fell
    }
  }
  if (run.state.result === 'defeat' && roomMeta.length) roomMeta[roomMeta.length - 1] = 1
  return {
    seed,
    result: run.state.result,
    pos: Float32Array.from(pos),
    meta: Int32Array.from(meta),
    rooms: Float32Array.from(rooms),
    roomMeta: Int32Array.from(roomMeta),
    dp,
    dr
  }
}

// Plays the runs of `seeds` in worker threads of this module, `workers` at a time, handing each run's samples to
// `done` as it ends (in the order they end).
async function sampleAll (seeds, workers, done) {
  const { Worker } = await import('node:worker_threads')
  const queue = seeds.slice()
  let n = 0
  const t0 = Date.now()
  const worker = async () => {
    const w = new Worker(new URL(import.meta.url), { workerData: { risk: true } })
    try {
      while (queue.length) {
        const seed = queue.shift()
        done(await new Promise((resolve, reject) => {
          const off = () => { w.off('message', ok); w.off('error', fail) }
          const ok = (msg) => { off(); resolve(msg) }
          const fail = (err) => { off(); reject(err) }
          w.on('message', ok)
          w.on('error', fail)
          w.postMessage(seed)
        }))
        if (++n % 50 === 0) console.log(`  ${n}/${seeds.length} runs, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
      }
    } finally {
      await w.terminate()
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, seeds.length) }, worker))
}

// The samples file (--data): a line naming the features, then a record a run, appended as each ends (so a sampling
// stopped part way keeps what it played, and goes on from there): a 4-byte length, a JSON head ({ seed, result, the
// arrays' lengths }), then the arrays' bytes (pos, meta, rooms, roomMeta).
const NAMES = () => JSON.stringify({ position: POSITION_FEATURES, room: ROOM_FEATURES })
const PARTS = [['pos', Float32Array], ['meta', Int32Array], ['rooms', Float32Array], ['roomMeta', Int32Array]]
function record (r) {
  const head = Buffer.from(JSON.stringify({ seed: r.seed, result: r.result, lengths: PARTS.map(([k]) => r[k].length) }))
  const len = Buffer.alloc(4)
  len.writeUInt32LE(head.length)
  return Buffer.concat([len, head, ...PARTS.map(([k]) => Buffer.from(r[k].buffer, r[k].byteOffset, r[k].byteLength))])
}
function readRecords (buf) {
  const nl = buf.indexOf(10)
  if (buf.subarray(0, nl).toString() !== NAMES()) throw new Error('the samples file\'s features are not this file\'s: sample again')
  const runs = []
  for (let at = nl + 1; at + 4 <= buf.length;) {
    const len = buf.readUInt32LE(at)
    const head = JSON.parse(buf.subarray(at + 4, at + 4 + len).toString())
    let o = at + 4 + len
    const r = { seed: head.seed, result: head.result }
    for (const [i, [k, T]] of PARTS.entries()) {
      const bytes = head.lengths[i] * T.BYTES_PER_ELEMENT
      if (o + bytes > buf.length) return runs
      r[k] = new T(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + bytes))
      o += bytes
    }
    runs.push(r)
    at = o
  }
  return runs
}

// A seed's number (`risk-17` → 17): what the split by run reads.
const seedNo = (seed) => Number(String(seed).match(/(\d+)$/)?.[1] ?? 0)

// The samples of many runs as flat arrays, the runs in seed order, each row with its run's seed number.
function gather (list) {
  const runs = list.slice().sort((a, b) => seedNo(a.seed) - seedNo(b.seed))
  const dp = POSITION_FEATURES.length
  const dr = ROOM_FEATURES.length
  const np = runs.reduce((n, r) => n + r.meta.length / 5, 0)
  const nr = runs.reduce((n, r) => n + r.roomMeta.length / 2, 0)
  const data = {
    pos: new Float32Array(np * dp), meta: new Int32Array(np * 5), posRun: new Int32Array(np),
    rooms: new Float32Array(nr * dr), roomMeta: new Int32Array(nr * 2), roomRun: new Int32Array(nr),
    runs: runs.length, defeats: runs.filter((r) => r.result === 'defeat').length
  }
  let a = 0
  let b = 0
  for (const r of runs) {
    const k = seedNo(r.seed)
    const n = r.meta.length / 5
    data.pos.set(r.pos, a * dp)
    data.meta.set(r.meta, a * 5)
    data.posRun.fill(k, a, a + n)
    a += n
    const m = r.roomMeta.length / 2
    data.rooms.set(r.rooms, b * dr)
    data.roomMeta.set(r.roomMeta, b * 2)
    data.roomRun.fill(k, b, b + m)
    b += m
  }
  return data
}

// The held-out runs: those whose seed number is a multiple of 5.
const heldOut = (run) => run % 5 === 0

// Fits both models on the samples and returns risk.json's content, printing what it finds.
function fitAll (data, { seed, ks = [1, 2, 3], pick = [2, 3] }) {
  const out = { made: { seed, runs: data.runs, defeats: data.defeats, held: 'runs whose seed number is a multiple of 5' } }
  // Positions: a model for each K, read on held-out slices: every position; those the danger read does not call lethal
  // (what the expert's tree does not see already); of those, the threatened (a foe could strike the Monarch within two
  // turns); and the positions of lost battles (when, not whether). K is the one of `pick` best on the threatened.
  const dp = POSITION_FEATURES.length
  const n = data.meta.length / 5
  const train = []
  const test = []
  for (let r = 0; r < n; r++) (heldOut(data.posRun[r]) ? test : train).push(r)
  const f = (r, name) => data.pos[r * dp + POSITION_FEATURES.indexOf(name)]
  const slices = {
    notLethal: test.filter((r) => f(r, 'lethal') === 0),
    threatened: test.filter((r) => f(r, 'lethal') === 0 && f(r, 'danger2') > 0),
    lost: test.filter((r) => data.meta[r * 5 + 3] >= 0),
    start: test.filter((r) => data.meta[r * 5 + 2] === 0),
    end: test.filter((r) => data.meta[r * 5 + 2] === 1)
  }
  console.log(`positions: ${n} (${train.length} to fit, ${test.length} held out; ${data.runs} runs, ${data.defeats} lost); held-out slices ${Object.entries(slices).map(([k, v]) => `${k} ${v.length}`).join(', ')}`)
  const auc0 = (v) => (Number.isFinite(v) ? v : -Infinity)
  let best = null
  for (const k of ks) {
    const y = new Uint8Array(n)
    for (let r = 0; r < n; r++) {
      const fell = data.meta[r * 5 + 3]
      y[r] = fell >= 0 && fell - data.meta[r * 5 + 1] < k ? 1 : 0
    }
    console.log(`  K ${k}: ${y.reduce((a, v) => a + v, 0)} positives`)
    const fit = fitBest(data.pos, y, dp, train, test, data.posRun)
    const aucs = Object.fromEntries(Object.entries(slices).map(([name, rows]) => [name, evaluate(fit.model, data.pos, y, dp, rows).auc]))
    console.log(`  K ${k}: λ ${fit.lambda}, held-out AUC ${fit.held.auc} (${Object.entries(aucs).map(([a, v]) => `${a} ${v}`).join(', ')}), log-loss ${fit.held.logLoss} against the base rate's ${fit.held.baseLogLoss}`)
    console.log(`         calibration [predicted, observed, n]: ${JSON.stringify(fit.held.calibration)}`)
    const entry = { k, fit, aucs }
    if (pick.includes(k) && (!best || auc0(aucs.threatened) > auc0(best.aucs.threatened))) best = entry
  }
  out.position = model(best.fit, POSITION_FEATURES, { k: best.k, slices: best.aucs })
  console.log(`  taken: K ${best.k}; top weights ${JSON.stringify(top(best.fit.model, POSITION_FEATURES, 12))}`)
  // Rooms.
  const dr = ROOM_FEATURES.length
  const m = data.roomMeta.length / 2
  const yr = new Uint8Array(m)
  const rtrain = []
  const rtest = []
  for (let r = 0; r < m; r++) {
    yr[r] = data.roomMeta[r * 2 + 1]
    ;(heldOut(data.roomRun[r]) ? rtest : rtrain).push(r)
  }
  console.log(`rooms: ${m} (${rtrain.length} to fit, ${rtest.length} held out), ${yr.reduce((a, v) => a + v, 0)} lost in`)
  const room = fitBest(data.rooms, yr, dr, rtrain, rtest, data.roomRun)
  out.room = model(room, ROOM_FEATURES)
  console.log(`  taken: λ ${room.lambda}, held-out AUC ${room.held.auc}, log-loss ${room.held.logLoss} against ${room.held.baseLogLoss}; top weights ${JSON.stringify(top(room.model, ROOM_FEATURES))}`)
  console.log(`  calibration [predicted, observed, n]: ${JSON.stringify(room.held.calibration)}`)
  return out
}

// A fitted model as risk.json holds it.
const round = (v, k = 6) => +v.toFixed(k)
const model = (fit, names, extra = {}) => ({
  ...extra,
  lambda: fit.lambda,
  features: names,
  mean: fit.model.mean.map((v) => round(v)),
  sd: fit.model.sd.map((v) => round(v)),
  w: fit.model.w.map((v) => round(v)),
  b: round(fit.model.b),
  held: {
    n: fit.held.n, positives: fit.held.positives, auc: fit.held.auc, logLoss: fit.held.logLoss, baseLogLoss: fit.held.baseLogLoss,
    predicted: fit.held.predicted, observed: fit.held.observed, calibration: fit.held.calibration
  }
})

// Run directly: --fit (or a worker thread of sampleAll's, playing run after run).
if (typeof process !== 'undefined' && process.argv[1] === decodeURIComponent(new URL(import.meta.url).pathname)) {
  const { isMainThread, parentPort, workerData } = await import('node:worker_threads')
  if (!isMainThread && workerData?.risk) {
    parentPort.on('message', async (seed) => {
      const r = await sampleRun(seed)
      parentPort.postMessage(r, [r.pos.buffer, r.meta.buffer, r.rooms.buffer, r.roomMeta.buffer])
    })
  } else if (isMainThread && process.argv.includes('--fit')) {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const arg = (name, def) => {
      const i = process.argv.indexOf('--' + name)
      return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
    }
    const seed = arg('seed', 'risk')
    const runs = Number(arg('runs', 2000))
    const file = arg('data', path.join(os.tmpdir(), `retinue-risk-${seed}.bin`))
    const t0 = Date.now()
    if (!fs.existsSync(file)) fs.writeFileSync(file, NAMES() + '\n')
    const have = readRecords(fs.readFileSync(file))
    const had = new Set(have.map((r) => r.seed))
    const todo = Array.from({ length: runs }, (_, k) => `${seed}-${k + 1}`).filter((x) => !had.has(x))
    if (todo.length && !process.argv.includes('--no-play')) {
      const workers = Number(arg('workers', Math.max(1, os.availableParallelism() - 2)))
      console.log(`sampling ${todo.length} expert runs (seeds ${seed}-1…${runs}, ${had.size} already in ${file}) on ${workers} workers`)
      await sampleAll(todo, workers, (r) => fs.appendFileSync(file, record(r)))
    }
    const data = gather(readRecords(fs.readFileSync(file)).filter((r) => seedNo(r.seed) <= runs))
    console.log(`${data.runs} runs sampled, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
    const json = fitAll(data, { seed })
    const out = arg('out', new URL('./risk.json', import.meta.url).pathname)
    fs.writeFileSync(out, JSON.stringify(json, null, 1) + '\n')
    console.log(`wrote ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  }
}
