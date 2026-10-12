// The learned expert's value of a board (redesign.md §2.21): V(board), how good a battle's board is for your side,
// learned offline (npm run train: train.js) and shipped as weights in value.json. This file is the contract between
// the learner (who fills it: the encoding, the network, training) and the player (policy.js expertTurn, which scores
// afterstates by `value` and falls back to its static board evaluation while `value` returns null).
//
//   FEATURES          the names of V's inputs, in order
//   encode(battle)    → a Float32Array of FEATURES.length, the raw reads (not standardised: the network standardises
//                       them by value.json's means and sds, folded into its first layer); what a player of your side
//                       sees (never the camp's pressure, never its coming turn). `encode(battle, out)` fills `out`.
//   value(battle)     → V for your side, a number (higher is better), or null while no weights are trained
//   loaded()          → whether trained weights are in use
//   predict(battle)   → V's three outputs { won, monarch, own } (null with no weights), values(battles) V of each
//
// The player's recording hook, for the learner's data (policy.js expertTurn's options): `record(battle, info)` is
// called at each piece's decision with the board before it decides (info: { uid, options, chosen }), and
// `explore: { rng, epsilon, top }` makes the turn take a random one of its top options with chance epsilon.
//
// V's three outputs, learned from the expert's positions (train.js): P(won), the chance the battle is won from here (a
// sigmoid, fitted by log-loss); `monarch`, the share of the Monarch's max HP it loses over the next two turns (to the
// start of the turn after next, or the battle's end; net of healing, so below 0 when it is mended); `own`, the same for
// your pieces' HP (their HP summed, over their max summed as the board stands; a piece felled loses all it had).
// `value` combines them by VALUE, fixed here (not TUNING's): V = won·P(won) − monarch·monarchLost − own·ownLost. The
// Monarch's wounds weigh three times your pieces' because they are the run's (they carry from battle to battle, and a
// fall ends the run), and the two-turn losses give the board's read its grain where P(won) sits near 1. A battle over
// is worth VALUE.won when won and −VALUE.monarch when lost.
//
// Features (raw; `turns` for a foe: the turns until its farthest blow reaches the Monarch along its road walked with
// no one in the way, 1 for the coming turn; "next turn" the foes' turn to come; "pieces" your units that take orders,
// not your shadows and summons):
//   share, monarchMax      the Monarch's HP over its max; its max over the base (TUNING.monarch.hp)
//   danger, lethal         what the foes could deal it next turn, over its HP (to 3), each foe's hardest ready blow that
//                          reaches it from a tile its road takes it to, on a clear line for a blow that keeps to one
//                          (redesign.md §2.19); and whether that fells it
//   splash                 what more shape blows could deal it by striking one of yours beside it (to 3)
//   danger2                what the foes could deal it within two turns, no one in the way and no line (to 3)
//   strikers, linesNow, linesNext, screened   the foes that could strike it next turn; with a clear line on it from
//                          where they stand; from a tile their road takes them to; in reach of it but for a screen
//   near, open             Σ 1/turns over the foes, and over those whose road no one of yours holds
//   reach … bleed          Σ 1/turns over the foes carrying each threat type (the bestiary's)
//   soonest                1 / the fewest turns any foe needs
//   roads, openRoads       the roads into the Monarch the foes come by (the tiles beside its seat they enter by), and
//                          those no one of yours holds
//   foes, reserve          the living foes on the board; the foes still to come, of all the battle's left
//   wave, nextFoes         1 / (1 + the turns until the next wave enters), 0 with none; its foes (the counter's)
//   patience               the turns since the last wave came in, over 10 (to 2): what a player counts, never the camp's
//                          pressure
//   pieces, piecesHp       your pieces standing, of those that took the board; their HP over their max
//   shadows                your shadows and summons standing
//   balance                the log of your side's HP on the board over the foes'
//   killNeed               the HP of the foes that could strike the Monarch next turn, over your pieces' hardest blows
//   killable               the foes one of your pieces yet to act could fell alone (its ready blow's exact damage, within
//                          its Move left and its reach, as the crow flies)
//   exposed, dying         the share of your pieces' HP the foes could deal them next turn (every foe on every piece,
//                          no lines); the share of your pieces that much would fell
//   crowd, mend, foeMend   your units beside the Monarch; your units that heal (none while nothing may heal); the foes'
//   hexedFoes              the foes a Hex costs their act
//   dot                    what the damage over time on the Monarch deals at the turn's end, over its HP
//   airGap                 Σ 1/turns over the flyers, where none of yours can strike one
//   idle, dangerIdle       your pieces yet to act, of those standing; danger × idle
//   synParty, synFoe       the synergies each side holds
//   floor, boss, turn      the floor, the boss's room, the log of the turn
// Then a slot for each of the 12 foes nearest the Monarch by road (the nearest first; ties by uid), zero where none:
//   ehp                    log(1 + the raw damage that fells it (its HP over its DEF's and damage taken's share) / 100)
//   share, punch           its HP over its max; its hardest raw blow, over 20
//   reach, move            how far its blows reach; its Move
//   near, deals            1/turns; what it could deal the Monarch next turn, over the Monarch's HP (to 3)
//   line                   1 with a clear line on the Monarch from where it stands, −1 with one in reach but screened
//   held, flies            its road held by one of yours; it flies
// and one for each of your 10 pieces nearest the Monarch by road (the same order):
//   ehp, share, punch      as a foe's
//   acted                  it has acted, or a Hex costs it its act
//   ready                  its skills off cooldown (to 2)
//   danger                 what the foes could deal it next turn (every foe, no lines), over its HP (to 3)
//   screen                 it stands first on a foe's line of fire into the Monarch (it takes that blow)
//   dist                   its road distance to the Monarch, over 10
import { TUNING } from '../tuning.js'
import { unitDef, statusDef } from '../content.js'
import { alive, isBlow, blowReach, distanceBetween, unitDistance, lineEnds, LINE_AT, LINE_TILES, TILES, DEPTH, tileX, tileY } from './unit.js'
import { roadOf, fieldOf, airOf, pressed, auraGivers } from './field.js'
import { stats, roadAhead, lined, isSkill, hexed, nextWave, aloft, synergiesOf } from './turns.js'

// ── the features ─────────────────────────────────────────────────────────────────────────────────

const KINDS = ['reach', 'shape', 'drain', 'sustain', 'fly', 'burn', 'bleed']
const KIND = new Set(KINDS)
export const GLOBAL = [
  'share', 'monarchMax', 'danger', 'lethal', 'splash', 'danger2', 'strikers', 'linesNow', 'linesNext', 'screened', 'near',
  'open', ...KINDS, 'soonest', 'roads', 'openRoads', 'foes', 'reserve', 'wave', 'nextFoes', 'patience', 'pieces',
  'piecesHp', 'shadows', 'balance', 'killNeed', 'killable', 'exposed', 'dying', 'crowd', 'mend', 'foeMend', 'hexedFoes',
  'dot', 'airGap', 'idle', 'dangerIdle', 'synParty', 'synFoe', 'floor', 'boss', 'turn'
]
export const FOE = ['ehp', 'share', 'punch', 'reach', 'move', 'near', 'deals', 'line', 'held', 'flies']
export const PIECE = ['ehp', 'share', 'punch', 'acted', 'ready', 'danger', 'screen', 'dist']
export const FOE_SLOTS = 12
export const PIECE_SLOTS = 10
const slots = (name, list, n) => Array.from({ length: n }, (_, i) => list.map((f) => `${name}${i + 1}.${f}`)).flat()
export const FEATURES = [...GLOBAL, ...slots('foe', FOE, FOE_SLOTS), ...slots('piece', PIECE, PIECE_SLOTS)]
const D = FEATURES.length
const G = Object.fromEntries(GLOBAL.map((f, i) => [f, i]))
const F = Object.fromEntries(FOE.map((f, i) => [f, i]))
const P = Object.fromEntries(PIECE.map((f, i) => [f, i]))
const FOE_AT = GLOBAL.length
const PIECE_AT = FOE_AT + FOE_SLOTS * FOE.length

const SHAPES = new Set(['blast', 'column', 'row', 'all'])
const NONE = Object.freeze([])

// A unit's blows that deal damage, read once a kit (a unit's kit is fixed for its battle, and a fork's copy of the unit
// shares it): { id, power, r (its reach on the ground), ra (on a flyer: −1 for a melee blow of one that walks), lined,
// shape (blast, column, row, all; null for a single target's), range, skill }.
const KITS = new WeakMap()
function blowsOf (u) {
  let k = KITS.get(u.kit)
  if (k) return k
  k = []
  for (const b of u.kit) {
    if (!isBlow(b)) continue
    let power = 0
    for (const e of b.effects) if (e.op === 'damage') power += e.power
    if (!(power > 0)) continue
    const r = blowReach(u, b)
    k.push({ id: b.id, power, r, ra: aloft(u, b, r), lined: lined(b), shape: SHAPES.has(b.shape) ? b.shape : null, range: b.range, skill: isSkill(u, b) })
  }
  KITS.set(u.kit, k)
  return k
}
const ready = (u, b) => !b.skill || !((u.cooldowns[b.id] ?? 0) > 0)
// A blow's damage before its target's DEF (policy.js rawOf's), from the dealer's stats `s`.
const raw = (s, b) => b.power * s.atk / TUNING.damage.atkDivisor * s.damage.dealt
// What share of a raw blow a unit with stats `s` takes.
const mitigation = (s) => TUNING.damage.defConstant / (TUNING.damage.defConstant + Math.max(0, s.def)) * s.damage.taken

// The first of the Monarch's side but it standing strictly between a footprint at `t` (of `size`) and the Monarch `m`
// (the one a blow that keeps to a line strikes instead: turns.js lineStruck), null for none.
function blocker (battle, t, size, m) {
  const [p, q] = lineEnds(t, size, m.tile, m.size)
  const k = p * TILES + q
  for (let i = LINE_AT[k]; i < LINE_AT[k + 1]; i++) {
    const c = LINE_TILES[i]
    const g = battle.at[c]
    if (g !== null && g.side === m.side && g !== m) return g
    const a = battle.sky[c]
    if (a !== null && a.side === m.side && a !== m) return a
  }
  return null
}

// Whether a shape blow aimed at `p` (one of the Monarch's side) from `t` takes in the Monarch `m` too (risk.js sweeps).
function sweeps (shape, range, t, size, p, m) {
  if (p === m) return false
  if (shape === 'blast') return unitDistance(p, m) <= 1
  if (shape === 'column') return tileX(m.tile) < tileX(p.tile) + p.size && tileX(p.tile) < tileX(m.tile) + m.size
  if (shape === 'row') return tileY(m.tile) < tileY(p.tile) + p.size && tileY(p.tile) < tileY(m.tile) + m.size
  return !range || distanceBetween(t, size, m.tile, m.size) <= range
}

// The damage over time the statuses on a unit will deal it at the turn's end (none from one laid since its turn passed).
function dotOn (u) {
  let n = 0
  for (const s of u.statuses) {
    if (s.fresh) continue
    for (const e of statusDef(s.id).tick ?? NONE) if (e.op === 'dot') n += e.power * s.stacks
  }
  return n
}

// A unit's stats (turns.js stats), remembered across the forks of one battle: a fork starts with empty caches, and
// refilling them (the stats, the synergies) is most of what reading a fresh fork costs. Keyed on all stats read: the
// unit (its kind, level, tiers and relics are its uid's for the battle), whether a foe stands next to it, its statuses
// with their stacks, the allies whose aura reaches it, and the units standing on its side (its side's synergies); a
// battle's own mods are its family's (`battle.relics`: made fresh by createBattle, shared by its forks). The battle's
// own cache first, where it holds the unit.
const FAMILY = new WeakMap()
function familyOf (battle) {
  let f = FAMILY.get(battle.relics)
  if (!f) FAMILY.set(battle.relics, (f = new Map()))
  else if (f.size > 50000) f.clear()
  return f
}
function statsFor (battle, u, fam, sides) {
  if (battle.cache.has(u.uid)) return stats(battle, u)
  let key = `${u.uid}|${pressed(battle, u) ? 1 : 0}|`
  for (const s of u.statuses) key += `${s.id}:${s.stacks},`
  key += '|'
  for (const g of auraGivers(battle, u)) key += `${g.uid},`
  if (u !== battle.monarch) key += `|${sides[u.side]}`
  let s = fam.get(key)
  if (s === undefined) fam.set(key, (s = stats(battle, u)))
  return s
}
// The synergies a side holds (turns.js synergiesOf), remembered as statsFor's stats are.
function synergyCount (battle, side, fam, sides) {
  if (battle.syn[side]?.v === battle.roster) return battle.syn[side].list.length
  const key = `syn|${side}|${sides[side]}`
  let n = fam.get(key)
  if (n === undefined) fam.set(key, (n = synergiesOf(battle, side).length))
  return n
}

const byRoad = (a, b) => a.dist - b.dist || a.u.uid - b.u.uid

// The board as V reads it (FEATURES, raw), into `out` if given. Reads the board, the counts the wave counter and the
// bestiary show; never the camp's policy, its pressure or a turn ahead; changes nothing in the battle but its caches.
export function encode (battle, out = new Float32Array(D)) {
  out.fill(0)
  const fam = familyOf(battle)
  const sides = { party: '', foe: '' }
  for (const u of battle.units) if (alive(u)) sides[u.side] += `${u.uid},`
  const m = battle.monarch && alive(battle.monarch) ? battle.monarch : null
  const mitM = m ? mitigation(statsFor(battle, m, fam, sides)) : 1
  const foes = []
  const pieces = []
  let shadows = 0
  let ours = 0
  let foeHp = 0
  let air = false
  let crowd = 0
  let mend = 0
  let foeMend = 0
  let blows = 0
  for (const u of battle.units) {
    if (!alive(u)) continue
    if (u.side === 'foe') {
      foeHp += u.hp
      if (u.mend) foeMend++
      foes.push({ u, s: statsFor(battle, u, fam, sides), dist: Math.min(99, roadOf(battle, u).dist[u.tile]), spots: null, blows: null })
      continue
    }
    if (u === battle.monarch) continue
    ours += u.hp
    const list = blowsOf(u)
    if (u.flies) air = true
    for (const b of list) if (b.ra >= 0) air = true
    if (u.mend && !battle.unhealable) mend++
    if (m && unitDistance(u, m) <= 1) crowd++
    if (u.shadow) {
      shadows++
      continue
    }
    const s = statsFor(battle, u, fam, sides)
    let hard = 0
    for (const b of list) hard = Math.max(hard, raw(s, b))
    blows += hard
    const road = u.flies ? airOf(battle) : fieldOf(battle)
    pieces.push({ u, s, dist: Math.min(20, road.dist[u.tile]), hard, danger: 0, screen: 0, mit: mitigation(s) })
  }
  // The foes: their roads to the Monarch, what they could deal it and yours next turn.
  let danger = 0
  let splash = 0
  let danger2 = 0
  let fewest = Infinity
  let strikerHp = 0
  let flyers = 0
  let hexedFoes = 0
  const entries = new Set()
  const open = new Set()
  for (const f of foes) {
    const x = f.u
    const list = blowsOf(x)
    let far = 0
    let hardest = 0
    for (const b of list) {
      far = Math.max(far, b.r)
      hardest = Math.max(hardest, raw(f.s, b))
    }
    far = Math.min(far, DEPTH)
    f.ehp = x.hp / mitigation(f.s)
    f.hardest = hardest
    f.far = far
    f.near = 0
    f.deals = 0
    f.line = 0
    f.held = 0
    const stunned = hexed(x)
    if (stunned) hexedFoes++
    if (!(hardest > 0)) continue
    if (!stunned) {
      f.spots = roadAhead(battle, x, x.move)
      f.blows = list.filter((b) => ready(x, b)).map((b) => ({ raw: raw(f.s, b), r: b.r, ra: b.ra }))
    }
    if (!m) continue
    const road = roadOf(battle, x)
    let k = -1
    let held = false
    let entry = -1
    for (let t = x.tile, n = 0; t >= 0 && n <= TILES; t = road.arrow[t], n++) {
      if (k < 0 && distanceBetween(t, x.size, m.tile, m.size) <= far) k = n
      if (road.dist[t] === 1) entry = t
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
    f.near = w
    f.held = held ? 1 : 0
    fewest = Math.min(fewest, turns)
    out[G.near] += w
    if (!held) out[G.open] += w
    for (const kind of unitDef(x.id).threats ?? NONE) if (KIND.has(kind)) out[G[kind]] += w
    if (x.flies) flyers += w
    if (entry >= 0) {
      entries.add(entry)
      if (!held) open.add(entry)
    }
    if (turns <= 2 && !stunned) danger2 += hardest * mitM
    if (stunned) continue
    // Next turn: its ready blows from each tile its road takes it to.
    let deals = 0
    let unlined = 0
    let sweep = 0
    let now = false
    let next = false
    for (const b of list) {
      if (!ready(x, b)) continue
      const rb = raw(f.s, b)
      for (const s of f.spots) {
        if (distanceBetween(s.tile, x.size, m.tile, m.size) > b.r) continue
        unlined = Math.max(unlined, rb)
        if (b.lined) {
          const g = blocker(battle, s.tile, x.size, m)
          if (g !== null) {
            const p = pieces.find((q) => q.u === g)
            if (p) p.screen = 1
            continue
          }
        }
        deals = Math.max(deals, rb)
        if (b.lined) {
          next = true
          if (s.tile === x.tile) now = true
        }
      }
      if (!b.shape || rb <= sweep) continue
      // A shape aimed at one of yours that takes the Monarch in with it (where it does whatever the tile it is aimed
      // from, that read first).
      const fixed = b.shape !== 'all'
      for (const p of battle.units) {
        if (p.side !== 'party' || !alive(p) || p === m || rb <= sweep) continue
        const rp = p.flies ? b.ra : b.r
        if (rp < 0 || (fixed && !sweeps(b.shape, b.range, x.tile, x.size, p, m))) continue
        for (const s of f.spots) {
          if (distanceBetween(s.tile, x.size, p.tile, p.size) <= rp && (fixed || sweeps(b.shape, b.range, s.tile, x.size, p, m))) {
            sweep = rb
            break
          }
        }
      }
    }
    if (deals > 0) {
      out[G.strikers]++
      strikerHp += x.hp
      danger += deals * mitM
      f.deals = Math.min(3, deals * mitM / m.hp)
    } else if (unlined > 0) {
      out[G.screened]++
      f.line = -1
    }
    if (sweep > deals) splash += (sweep - deals) * mitM
    if (now) {
      out[G.linesNow]++
      f.line = 1
    }
    if (next) out[G.linesNext]++
  }
  // Your pieces: what the foes could deal each next turn (every foe on every piece, no lines), and what each yet to act
  // could fell alone.
  const fells = new Uint8Array(foes.length)
  let pieceHp = 0
  let pieceMax = 0
  let idle = 0
  let exposed = 0
  let dying = 0
  for (const p of pieces) {
    const u = p.u
    pieceHp += u.hp
    pieceMax += u.maxHp
    if (!u.acted) idle++
    let d = 0
    for (const f of foes) {
      if (!f.blows) continue
      // The nearest it could stand to the piece, then its hardest blow that reaches that far.
      let near = Infinity
      for (const s of f.spots) near = Math.min(near, distanceBetween(s.tile, f.u.size, u.tile, u.size))
      let best = 0
      for (const b of f.blows) {
        const r = u.flies ? b.ra : b.r
        if (r >= near && b.raw > best) best = b.raw
      }
      d += best
    }
    p.danger = d * p.mit
    exposed += Math.min(u.hp, p.danger)
    if (p.danger >= u.hp) dying++
    if (u.acted || hexed(u)) continue
    const budget = Math.max(0, u.move - u.moved)
    for (const b of blowsOf(u)) {
      if (!ready(u, b)) continue
      const rb = raw(p.s, b)
      for (let i = 0; i < foes.length; i++) {
        const f = foes[i]
        if (fells[i]) continue
        const r = f.u.flies ? b.ra : b.r
        if (r >= 0 && rb >= f.ehp && unitDistance(u, f.u) <= budget + r) fells[i] = 1
      }
    }
  }
  // The board's globals.
  if (m) {
    const hp = m.hp
    out[G.share] = hp / m.maxHp
    out[G.monarchMax] = m.maxHp / TUNING.monarch.hp
    out[G.danger] = Math.min(3, danger / hp)
    out[G.lethal] = danger >= hp ? 1 : 0
    out[G.splash] = Math.min(3, splash / hp)
    out[G.danger2] = Math.min(3, danger2 / hp)
    out[G.soonest] = Number.isFinite(fewest) ? 1 / fewest : 0
    out[G.killNeed] = Math.min(5, strikerHp / Math.max(1, blows))
    out[G.dot] = Math.min(3, dotOn(m) / hp)
    out[G.crowd] = crowd
  }
  out[G.roads] = entries.size
  out[G.openRoads] = open.size
  out[G.foes] = foes.length
  const left = battle.reserve.length
  out[G.reserve] = left / Math.max(1, left + foes.length)
  const w = nextWave(battle)
  if (w) {
    out[G.wave] = 1 / (1 + Math.max(0, w.turn - battle.turn))
    out[G.nextFoes] = battle.waves.find((x) => x.wave === w.wave)?.foes ?? 0
  }
  out[G.patience] = Math.min(2, Math.max(0, battle.turn - battle.foeIn) / 10)
  let all = 0
  for (const u of battle.units) if (u.side === 'party' && u !== battle.monarch && !u.shadow && !u.into) all++
  out[G.pieces] = all ? pieces.length / all : 0
  out[G.piecesHp] = pieceMax ? pieceHp / pieceMax : 0
  out[G.shadows] = shadows
  out[G.balance] = Math.log((1 + ours) / (1 + foeHp))
  out[G.killable] = fells.reduce((n, v) => n + v, 0)
  out[G.exposed] = pieceHp ? exposed / pieceHp : 0
  out[G.dying] = pieces.length ? dying / pieces.length : 0
  out[G.mend] = mend
  out[G.foeMend] = foeMend
  out[G.hexedFoes] = hexedFoes
  out[G.airGap] = air ? 0 : flyers
  out[G.idle] = pieces.length ? idle / pieces.length : 0
  out[G.dangerIdle] = out[G.danger] * out[G.idle]
  out[G.synParty] = synergyCount(battle, 'party', fam, sides)
  out[G.synFoe] = synergyCount(battle, 'foe', fam, sides)
  out[G.floor] = Math.min(5, battle.floor ?? 1)
  out[G.boss] = battle.boss ? 1 : 0
  out[G.turn] = Math.log(Math.max(1, battle.turn))
  // The slots, the nearest the Monarch by road first.
  foes.sort(byRoad)
  for (let i = 0; i < foes.length && i < FOE_SLOTS; i++) {
    const f = foes[i]
    const o = FOE_AT + i * FOE.length
    out[o + F.ehp] = Math.log1p(f.ehp / 100)
    out[o + F.share] = f.u.hp / f.u.maxHp
    out[o + F.punch] = f.hardest / 20
    out[o + F.reach] = f.far
    out[o + F.move] = f.u.move
    out[o + F.near] = f.near
    out[o + F.deals] = f.deals
    out[o + F.line] = f.line
    out[o + F.held] = f.held
    out[o + F.flies] = f.u.flies ? 1 : 0
  }
  pieces.sort(byRoad)
  for (let i = 0; i < pieces.length && i < PIECE_SLOTS; i++) {
    const p = pieces[i]
    const u = p.u
    const o = PIECE_AT + i * PIECE.length
    let skills = 0
    for (const a of u.kit) if (isSkill(u, a) && !((u.cooldowns[a.id] ?? 0) > 0)) skills++
    out[o + P.ehp] = Math.log1p(u.hp / p.mit / 100)
    out[o + P.share] = u.hp / u.maxHp
    out[o + P.punch] = p.hard / 20
    out[o + P.acted] = u.acted || hexed(u) ? 1 : 0
    out[o + P.ready] = Math.min(2, skills)
    out[o + P.danger] = Math.min(3, p.danger / u.hp)
    out[o + P.screen] = p.screen
    out[o + P.dist] = p.dist / 10
  }
  return out
}

// ── the network ──────────────────────────────────────────────────────────────────────────────────

// A multilayer perceptron, inputs → hidden (ReLU) … → 3 outputs (a logit for P(won), and the two HP shares lost, plain),
// for training (Float64Arrays; inputs standardised): `sizes` [inputs, …hidden, 3], `W[l]` input-major (row i the weights
// from unit i of layer l to every unit of layer l + 1), `b[l]`. Deterministic from `seed`.
export const OUTPUTS = 3
export function createNet ({ inputs, hidden = [64, 64], seed = 1 }) {
  const sizes = [inputs, ...hidden, OUTPUTS]
  const rand = mulberry(seed)
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
  const W = []
  const b = []
  for (let l = 0; l + 1 < sizes.length; l++) {
    const fan = sizes[l]
    const scale = l + 2 < sizes.length ? Math.sqrt(2 / fan) : Math.sqrt(1 / fan) * 0.1
    W.push(Float64Array.from({ length: fan * sizes[l + 1] }, () => gauss() * scale))
    b.push(new Float64Array(sizes[l + 1]))
  }
  return { sizes, W, b }
}

// A small seeded generator (mulberry32): [0, 1).
export function mulberry (seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const softplus = (s) => (s > 0 ? s + Math.log1p(Math.exp(-s)) : Math.log1p(Math.exp(s)))

// The activations of a training forward pass over `n` rows of X (n × inputs, standardised), kept for backward:
// `acts[0]` X itself, `acts[l]` layer l's (after ReLU), the last the raw outputs (n × 3).
export function forwardAll (net, X, n, acts = []) {
  const { sizes, W, b } = net
  acts[0] = X
  for (let l = 0; l + 1 < sizes.length; l++) {
    const A = acts[l]
    const I = sizes[l]
    const J = sizes[l + 1]
    let Z = acts[l + 1]
    if (!Z || Z.length < n * J) Z = acts[l + 1] = new Float64Array(n * J)
    const Wl = W[l]
    const bl = b[l]
    const last = l + 2 === sizes.length
    for (let r = 0; r < n; r++) {
      const zo = r * J
      for (let j = 0; j < J; j++) Z[zo + j] = bl[j]
      const ao = r * I
      for (let i = 0; i < I; i++) {
        const v = A[ao + i]
        if (v === 0) continue
        const wo = i * J
        for (let j = 0; j < J; j++) Z[zo + j] += v * Wl[wo + j]
      }
      if (!last) for (let j = 0; j < J; j++) if (Z[zo + j] < 0) Z[zo + j] = 0
    }
  }
  return acts
}

// The loss of a batch: Σ over its rows of wt·(the log-loss of P(won) / norms[0] + each HP output's squared error /
// norms[k]), over Σ wt (Y: n × 3 targets, P(won)'s in [0, 1]; wt the rows' weights, 1 each by default). With `grads`
// ({ W, b } shaped as the net's, zeroed here), its gradient too. → the loss.
export function batchLoss (net, X, Y, n, norms, grads = null, wt = null, acts = []) {
  forwardAll(net, X, n, acts)
  const { sizes, W } = net
  const L = sizes.length - 1
  const O = acts[L]
  let total = 0
  let wsum = 0
  for (let r = 0; r < n; r++) wsum += wt ? wt[r] : 1
  const delta = new Float64Array(n * OUTPUTS)
  for (let r = 0; r < n; r++) {
    const w = (wt ? wt[r] : 1) / wsum
    const o = r * OUTPUTS
    const z = O[o]
    const y = Y[o]
    total += w * (y * softplus(-z) + (1 - y) * softplus(z)) / norms[0]
    delta[o] = w * (sigmoid(z) - y) / norms[0]
    for (let k = 1; k < OUTPUTS; k++) {
      const e = O[o + k] - Y[o + k]
      total += w * e * e / norms[k]
      delta[o + k] = w * 2 * e / norms[k]
    }
  }
  if (!grads) return total
  for (let l = 0; l < L; l++) {
    grads.W[l].fill(0)
    grads.b[l].fill(0)
  }
  let d = delta
  for (let l = L - 1; l >= 0; l--) {
    const I = sizes[l]
    const J = sizes[l + 1]
    const A = acts[l]
    const gW = grads.W[l]
    const gb = grads.b[l]
    const Wl = W[l]
    const prev = l > 0 ? new Float64Array(n * I) : null
    for (let r = 0; r < n; r++) {
      const dO = r * J
      const aO = r * I
      for (let j = 0; j < J; j++) gb[j] += d[dO + j]
      for (let i = 0; i < I; i++) {
        const v = A[aO + i]
        const wo = i * J
        if (v !== 0) for (let j = 0; j < J; j++) gW[wo + j] += v * d[dO + j]
        if (prev && v > 0) {
          let s = 0
          for (let j = 0; j < J; j++) s += Wl[wo + j] * d[dO + j]
          prev[aO + i] = s
        }
      }
    }
    d = prev
  }
  return total
}

// Gradient buffers shaped as a net's.
export const gradsFor = (net) => ({ W: net.W.map((w) => new Float64Array(w.length)), b: net.b.map((v) => new Float64Array(v.length)) })

// One Adam step on the net from `grads`, with L2 `l2` on the weights (not the biases). `state` (made here when empty)
// keeps the moments and the step count.
export function adam (net, grads, state, { lr = 1e-3, beta1 = 0.9, beta2 = 0.999, eps = 1e-8, l2 = 0 } = {}) {
  if (!state.m) {
    state.m = { W: net.W.map((w) => new Float64Array(w.length)), b: net.b.map((v) => new Float64Array(v.length)) }
    state.v = { W: net.W.map((w) => new Float64Array(w.length)), b: net.b.map((v) => new Float64Array(v.length)) }
    state.t = 0
  }
  state.t++
  const c1 = 1 - beta1 ** state.t
  const c2 = 1 - beta2 ** state.t
  const step = (p, g, m, v, decay) => {
    for (let i = 0; i < p.length; i++) {
      const gi = g[i] + decay * p[i]
      m[i] = beta1 * m[i] + (1 - beta1) * gi
      v[i] = beta2 * v[i] + (1 - beta2) * gi * gi
      p[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + eps)
    }
  }
  for (let l = 0; l < net.W.length; l++) {
    step(net.W[l], grads.W[l], state.m.W[l], state.v.W[l], l2)
    step(net.b[l], grads.b[l], state.m.b[l], state.v.b[l], 0)
  }
}

// ── value.json ───────────────────────────────────────────────────────────────────────────────────

// value.json: { features, mean, sd (the standardisation of each feature), sizes, W, b (as createNet's, plain arrays),
// made (how it was trained), held (its held-out reading) }. toJSON writes a net so; fromJSON reads one back for more
// training (null for a json whose features are not FEATURES: a stale one).
const round = (v) => +v.toPrecision(7)
export const toJSON = (net, { mean, sd, ...rest } = {}) => ({
  ...rest,
  features: FEATURES,
  mean: Array.from(mean, round),
  sd: Array.from(sd, round),
  sizes: net.sizes,
  W: net.W.map((w) => Array.from(w, round)),
  b: net.b.map((v) => Array.from(v, round))
})
const fits = (json) => !!json && Array.isArray(json.features) && json.features.length === D && json.features.every((f, i) => f === FEATURES[i]) &&
  json.sizes?.[0] === D && json.sizes.at(-1) === OUTPUTS && json.W?.length === json.sizes.length - 1
export function fromJSON (json) {
  if (!fits(json)) return null
  return {
    net: { sizes: json.sizes.slice(), W: json.W.map((w) => Float64Array.from(w)), b: json.b.map((v) => Float64Array.from(v)) },
    mean: Float64Array.from(json.mean),
    sd: Float64Array.from(json.sd)
  }
}

// The net for play: the standardisation folded into the first layer (its weights over each sd, the means into its
// biases), so a raw encoding goes straight in and its zeros (the empty slots) cost nothing; each layer's weights
// transposed (output-major: row j the weights into unit j), so each unit is one dot product over the inputs that are
// not zero.
function fold (json) {
  const read = fromJSON(json)
  if (!read) return null
  const { net, mean, sd } = read
  const { sizes } = net
  const b = net.b.map((v) => Float64Array.from(v))
  const WT = net.W.map((w, l) => {
    const I = sizes[l]
    const J = sizes[l + 1]
    const t = new Float64Array(I * J)
    for (let i = 0; i < I; i++) {
      const s = l === 0 ? sd[i] || 1 : 1
      for (let j = 0; j < J; j++) {
        const v = w[i * J + j] / s
        t[j * I + i] = v
        if (l === 0) b[0][j] -= v * mean[i]
      }
    }
    return t
  })
  const wide = Math.max(...sizes)
  return { sizes, WT, b, acts: sizes.map((n) => new Float64Array(n)), idx: new Int32Array(wide), val: new Float64Array(wide) }
}

// The raw outputs for one raw encoding `x` into `o` (the play forward: the inputs that are zero, the empty slots and
// ReLU's zeros, skipped).
function run (rt, x, o) {
  const { sizes, WT, b, acts, idx, val } = rt
  let A = x
  for (let l = 0; l + 1 < sizes.length; l++) {
    const I = sizes[l]
    const J = sizes[l + 1]
    let m = 0
    for (let i = 0; i < I; i++) {
      const v = A[i]
      if (v !== 0) {
        idx[m] = i
        val[m++] = v
      }
    }
    const last = l + 2 === sizes.length
    const Z = last ? o : acts[l + 1]
    const W = WT[l]
    const bl = b[l]
    for (let j = 0; j < J; j++) {
      const off = j * I
      let s = bl[j]
      for (let k = 0; k < m; k++) s += val[k] * W[off + idx[k]]
      Z[j] = last || s > 0 ? s : 0
    }
    A = Z
  }
  return o
}

// The weights in use: value.json beside this file, read once (Node only: in a browser V has none, and the expert falls
// back to its static evaluation), or what `load` installed.
function readJSON () {
  try {
    const fs = globalThis.process?.getBuiltinModule?.('node:fs')
    return fs ? JSON.parse(fs.readFileSync(new URL('./value.json', import.meta.url), 'utf8')) : null
  } catch {
    return null
  }
}
const SHIPPED = readJSON()
let RT = fold(SHIPPED)
let JSON_IN_USE = RT ? SHIPPED : null

// Installs `json` (value.json's content) as the weights in use, or none with null; → loaded().
export function load (json) {
  RT = json ? fold(json) : null
  JSON_IN_USE = RT ? json : null
  return loaded()
}

export const loaded = () => RT !== null

// ── V ────────────────────────────────────────────────────────────────────────────────────────────

// V's combination of its three outputs (see the header): fixed here, not tuned.
export const VALUE = Object.freeze({ won: 1, monarch: 3, own: 1 })

const X = new Float32Array(D)
const O = new Float32Array(OUTPUTS)
const combine = (o) => VALUE.won * sigmoid(o[0]) - VALUE.monarch * o[1] - VALUE.own * o[2]
const terminal = (battle) => (battle.winner === 'party' ? VALUE.won : -VALUE.monarch)

// The raw outputs for raw encodings: `k` rows of `Xs` (k × FEATURES.length) into `out` (k × 3), with no weights null.
export function forwardBatch (Xs, k, out = new Float32Array(k * OUTPUTS)) {
  if (!RT) return null
  for (let r = 0; r < k; r++) {
    run(RT, Xs.subarray(r * D, (r + 1) * D), O)
    out[r * OUTPUTS] = O[0]
    out[r * OUTPUTS + 1] = O[1]
    out[r * OUTPUTS + 2] = O[2]
  }
  return out
}

// V's three outputs for a battle: { won (P(won)), monarch, own (the HP shares lost over the next two turns) }; null
// with no weights. A battle over: won 1 or 0, nothing more lost.
export function predict (battle) {
  if (!RT) return null
  if (battle.over) return { won: battle.winner === 'party' ? 1 : 0, monarch: 0, own: 0 }
  run(RT, encode(battle, X), O)
  return { won: sigmoid(O[0]), monarch: O[1], own: O[2] }
}

// V for your side (see the header): higher is better; null with no weights.
export function value (battle) {
  if (!RT) return null
  if (battle.over) return terminal(battle)
  return combine(run(RT, encode(battle, X), O))
}

// V of each of `battles` (one encoding buffer and one batched forward): a Float64Array, or null with no weights.
let XS = new Float32Array(0)
export function values (battles) {
  if (!RT) return null
  const k = battles.length
  if (XS.length < k * D) XS = new Float32Array(k * D)
  for (let r = 0; r < k; r++) if (!battles[r].over) encode(battles[r], XS.subarray(r * D, (r + 1) * D))
  const o = forwardBatch(XS, k)
  const out = new Float64Array(k)
  for (let r = 0; r < k; r++) out[r] = battles[r].over ? terminal(battles[r]) : combine(o.subarray(r * OUTPUTS, (r + 1) * OUTPUTS))
  return out
}

// The json in use (null with none): for the trainer's reading.
export const weights = () => JSON_IN_USE
