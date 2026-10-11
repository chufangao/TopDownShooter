// The expert's plan (redesign.md §2.18): what your pieces do together, read off the board and kept across turns, never
// played out (§2.17: no turn of the foes is played and the camp's policy is never called). Four reads, made once a
// turn (readPlan) and read by each piece's options as features (policy.js features):
//   the plan       hold (a line on the roads into the Monarch: let them come into overlapping fire), focus (go and
//                  fell one key foe), push (take the fight to foes that will not come) or protect (close about the
//                  Monarch): the tree (expert.js TREES.plan) and the weights (TUNING.expert.plan.choose) pick one, and
//                  it is kept on the battle (battle.plan) until a trigger changes it: a wave enters, a piece of yours
//                  falls, the Monarch comes into the foes' reach, the camp's patience runs long, the plan's goal is met
//                  or fails. So the pieces do not dither, and a walk may span turns.
//   the formation  roles to tiles for the plan, read off the board (blockers on the roads' chokes, shooters behind
//                  them, healers beside them, a piece that strikes flyers where the air road comes in, strikers about a
//                  target), pieces to roles by an assignment (the Hungarian method on a fit score), each piece walking
//                  to its tile over the turns it takes. Prep deploys by its first answer (deployment).
//   the kill list  which foes your pieces can fell this turn together, by exact arithmetic on your own blows (no dice),
//                  and who strikes whom in what order (killList).
//   the forecast   where each foe will likely stand next turn: its road and Move bound it, its temperament (the
//                  bestiary's way line) says how far it comes (forecast).
import { TUNING } from '../tuning.js'
import { alive, isBlow, footprint, tileX, tileY, tileAt, distance, distanceBetween, blowReach, TILES, LANES, DEPTH, NEIGHBOURS } from './unit.js'
import { fieldOf, airOf, roadOf } from './field.js'
import { stats, roadAhead, canAct, aloft, orderable, counterOf, ariseOf, isSkill } from './turns.js'
import { danger, dangerAt, options, hardest, blowOn, struckOf } from './policy.js'
import { unitDef } from '../content.js'
import { decide, TREES } from './expert.js'

const T = () => TUNING.expert.plan
const NEUTRAL = { aggression: 1, caution: 1, prey: 'weakest' }
const NONE = Object.freeze([])

// ── the forecast ─────────────────────────────────────────────────────────────────────────────────

// Where each living foe will likely stand next turn, by rule: its road and its Move bound it (turns.js roadAhead: a held
// tile stops it), and its temperament, as the bestiary's way line tells it, picks how far. The bold (aggression ≥ 1)
// come to the edge of your pieces: as far as lets them strike one of yours (the Monarch too), else to the edge of your
// reach; and once the camp's patience has run TUNING.expert.plan.impatient turns as the counts show it, every foe comes
// as far as it can. A keeper (aggression 0) keeps behind its comrades, out of your reach where it can. The rest are
// wary: the farthest tile your side could not strike next turn (`map`, the danger map for the foes), else the least
// struck. → { at: Map uid → tile, bold: Set of the uids that come on (the bold, or all once impatient) }
export function forecast (battle, sit, map = danger(battle, 'foe')) {
  const impatient = (sit?.patience ?? battle.turn - battle.foeIn) >= T().impatient
  const at = new Map()
  const bold = new Set()
  const keepers = []
  const ours = battle.units.filter((y) => y.side === 'party' && alive(y))
  for (const x of battle.units) {
    if (x.side !== 'foe' || !alive(x)) continue
    const spots = roadAhead(battle, x, x.move).map((s) => s.tile)
    const t = x.temper ?? NEUTRAL
    const hurt = x.flies ? map.air : map.ground
    if (impatient) {
      at.set(x.uid, spots[spots.length - 1])
      bold.add(x.uid)
    } else if (t.aggression >= 1) {
      const blows = x.kit.filter((b) => isBlow(b) && !(isSkill(x, b) && x.cooldowns[b.id] > 0))
      const strikes = (s) => ours.some((y) => blows.some((b) => {
        const r = y.flies ? aloft(x, b, blowReach(x, b)) : blowReach(x, b)
        return r >= 0 && distanceBetween(s, x.size, y.tile, y.size) <= r
      }))
      let s = -1
      for (const p of spots) if (strikes(p)) s = p
      at.set(x.uid, s >= 0 ? s : wary(spots, hurt))
      bold.add(x.uid)
    } else if (t.aggression <= 0) keepers.push([x, spots, hurt])
    else at.set(x.uid, wary(spots, hurt))
  }
  // A keeper no nearer the Monarch than the nearest of its comrades will stand (each read on its own road).
  for (const [x, spots, hurt] of keepers) {
    const road = roadOf(battle, x)
    let front = Infinity
    for (const t of at.values()) front = Math.min(front, road.dist[t])
    const behind = spots.filter((s) => road.dist[s] > front)
    at.set(x.uid, wary(behind.length ? behind : [spots[0]], hurt))
  }
  return { at, bold }
}

// The farthest of `spots` (a road's tiles, in order) that `hurt` (a danger map's list) leaves unhurt, else the least hurt.
function wary (spots, hurt) {
  let out = -1
  for (const s of spots) if (hurt[s] === 0) out = s
  return out >= 0 ? out : spots.reduce((a, s) => (hurt[s] < hurt[a] ? s : a), spots[0])
}

// ── the roads' chokes ────────────────────────────────────────────────────────────────────────────

// The chokes of `road` (field.js field: the arrows make a tree into the Monarch's seat) for foes walking from `sources`
// (tiles): for each road into the seat a source's walk takes (by the tile beside the seat it comes in by), the tile as
// far out as one piece standing there holds every source that comes that way (where no road splits and none of those
// foes stands), never more than `cap` steps from the seat. A piece on a road holds every foe whose walk crosses it (a
// foe never passes through a piece, nor routes round one: turns.js roadAhead). → [{ tile, sources (how many it holds),
// front (the tiles just before it, where the foes it holds would wait) }], by the tile it comes in by.
export function chokes (road, sources, cap) {
  const count = new Map()
  for (const s of sources) {
    for (let t = road.arrow[s], k = 0; t >= 0 && road.dist[t] > 0 && k < TILES; t = road.arrow[t], k++) count.set(t, (count.get(t) ?? 0) + 1)
  }
  const kids = new Map()
  for (const t of count.keys()) if (count.has(road.arrow[t])) kids.set(road.arrow[t], [...(kids.get(road.arrow[t]) ?? NONE), t])
  const out = []
  for (const e of [...count.keys()].filter((t) => road.dist[t] === 1).sort((a, b) => a - b)) {
    let n = e
    for (;;) {
      const k = kids.get(n) ?? NONE
      if (k.length !== 1 || count.get(k[0]) !== count.get(n) || road.dist[k[0]] > cap) break
      n = k[0]
    }
    const front = new Set(kids.get(n) ?? NONE)
    for (const s of sources) if (road.arrow[s] === n) front.add(s)
    out.push({ tile: n, sources: count.get(n), front: [...front].sort((a, b) => a - b) })
  }
  return out
}

// The tiles the foes still to come will walk from: each one's lane at the top edge (turns.js entryTile, as near as a
// player can say), those that fly (`flies`) or those that walk.
const entries = (battle, flies) => [...new Set(battle.reserve.filter((f) => !!unitDef(f.id).flies === flies).map((f) => tileAt(f.lane ?? 3, DEPTH - 1)))]

// ── the kill list ────────────────────────────────────────────────────────────────────────────────

// Which foes your pieces can fell this turn together, by exact arithmetic on your own blows (no dice: computeDamage, as
// policy.js blowOn reads a blow), and who strikes whom in what order. The foes in turn, the most pressing first (one that
// could strike the Monarch next turn; then one that mends; then the hardest blow for its HP), each listed where the
// pieces not yet listed can deal its HP between them: each piece's hardest blow at it, from a tile it may strike it from
// (no foe in the line between: policy.js struckOf) that no listed piece takes (the least endangered by the danger map,
// then the fewest steps); the fewest such pieces; the blows that draw no counter (ranged) first, so that the last, the
// one that fells, may be melee (a counter answers only a blow its target survives). A melee blow before it draws one, and a kill whose counter would fell a piece is not
// listed. `moving` false: each strikes from where it stands. → { list: [{ uid (the foe), strikes: [{ uid, ability,
// target, tile, damage }] }], deal: Map foe uid → what your pieces could deal it this turn, each its hardest blow }
export function killList (battle, sit, { moving = true } = {}) {
  const mine = battle.units.filter((u) => orderable(battle, u) && canAct(battle, u))
  const foes = battle.units.filter((x) => x.side === 'foe' && alive(x))
  const best = new Map()
  const deal = new Map()
  for (const u of mine) {
    const row = new Map()
    for (const o of options(battle, u, { moving })) {
      const a = o.ability
      // A blow from a tile whence one of its side stands in its line strikes that one, not this foe (§2.19).
      if (!a || !isBlow(a) || o.target.side === u.side || struckOf(battle, u, o) !== o.target) continue
      const d = blowOn(battle, u, a, o.target)
      if (!(d > 0)) continue
      const list = row.get(o.target.uid) ?? []
      list.push({ tile: o.tile, ability: a.id, damage: d, melee: !!a.melee, risk: dangerAt(battle, u, o.tile, sit.map), steps: o.path.length })
      row.set(o.target.uid, list)
    }
    for (const [uid, list] of row) {
      list.sort((p, q) => q.damage - p.damage || p.risk - q.risk || p.steps - q.steps || p.tile - q.tile)
      deal.set(uid, (deal.get(uid) ?? 0) + list[0].damage)
    }
    best.set(u.uid, row)
  }
  const m = sit.monarch
  const key = (x) => [m?.deals.has(x) ? 1 : 0, x.mend ? 1 : 0, hardest(battle, x) / Math.max(1, x.hp)]
  const order = foes.map((x) => [x, key(x)]).sort(([a, p], [b, q]) => q[0] - p[0] || q[1] - p[1] || q[2] - p[2] || a.uid - b.uid).map(([x]) => x)
  const used = new Set()
  const claimed = new Set()
  const cells = (u, t) => footprint(t, u.size).map((c) => (u.flies ? 'a' : 'g') + c)
  const list = []
  for (const x of order) {
    if ((deal.get(x.uid) ?? 0) < x.hp) continue
    const cands = []
    for (const u of mine) {
      if (used.has(u.uid)) continue
      const o = best.get(u.uid).get(x.uid)?.find((s) => !cells(u, s.tile).some((c) => claimed.has(c)))
      if (o) cands.push({ u, ...o })
    }
    cands.sort((p, q) => q.damage - p.damage || p.u.uid - q.u.uid)
    const pick = []
    let sum = 0
    for (const c of cands) {
      if (sum >= x.hp) break
      pick.push(c)
      sum += c.damage
    }
    if (sum < x.hp) continue
    // The fewest: whoever the rest can do without stands down (the weakest blow first).
    for (let i = pick.length - 1; i >= 0 && pick.length > 1; i--) {
      if (sum - pick[i].damage >= x.hp) {
        sum -= pick[i].damage
        pick.splice(i, 1)
      }
    }
    pick.sort((p, q) => p.melee - q.melee || p.damage - q.damage || p.u.uid - q.u.uid)
    const dear = pick.some((c, i) => {
      if (!c.melee || i === pick.length - 1) return false
      const b = counterOf(battle, x, c.u, c.tile)
      return !!b && blowOn(battle, x, b, c.u) >= c.u.hp
    })
    if (dear) continue
    list.push({ uid: x.uid, strikes: pick.map((c) => ({ uid: c.u.uid, ability: c.ability, target: x.uid, tile: c.tile, damage: c.damage })) })
    for (const c of pick) {
      used.add(c.u.uid)
      for (const t of cells(c.u, c.tile)) claimed.add(t)
    }
  }
  return { list, deal }
}

// ── the plan ─────────────────────────────────────────────────────────────────────────────────────

// The plan for this turn (redesign.md §2.18): the one kept from the last turn where no trigger fires (expert.js
// TREES.plan's keep-plan), else chosen afresh by the tree and the weights; then its target formation, the kill list and
// the forecast, all read off the board as it stands. Made once a turn: read again in the same turn (a test's, the
// interface's), it is the same. `store` false: the battle keeps no plan (a decision read alone: policy.js choice).
// `moving` false (the moves ablation's): the kill list strikes from where each stands. → { turn, kind, target (a foe's
// uid for focus, else null), since, trigger (what changed it: 'start', 'wave', 'fell', 'reach', 'stall', 'met',
// 'failed'; null: kept), by, rules, goals (formation), kills, listed (Map piece uid → its strike), fc (forecast), fmap
// (the danger map from where the forecast has the foes), open (the same with no line of fire stopped by a piece of
// yours: the formation's, which decides where they will stand), quarry (a push's: the uids of the foes it goes for) }
export function readPlan (battle, sit, { moving = true, store = true } = {}) {
  const had = battle.plan
  if (had && had.turn === battle.turn && had.moving === moving) return had
  const prev = had && had.turn < battle.turn ? had : null
  const reached = danger(battle, 'foe')
  const fc = forecast(battle, sit, reached)
  const fmap = danger(battle, 'party', fc.at)
  const open = danger(battle, 'party', fc.at, { lines: false })
  const kills = killList(battle, sit, { moving })
  const foes = battle.units.filter((x) => x.side === 'foe' && alive(x))
  const trigger = prev ? triggerOf(battle, sit, prev, fc, reached, foes) : 'start'
  const felled = new Set(kills.list.map((k) => k.uid))
  const ctx = {
    trigger,
    prev,
    patience: sit.patience,
    reach: threatened(sit),
    healer: foes.some((x) => x.mend && felled.has(x.uid)),
    waiting: !sit.wave && foes.length > 0 && foes.every((x) => holdsOff(x, fc, reached))
  }
  const pick = decide(TREES.plan, ctx, planOptions(battle, sit, kills, fc, foes, reached), T().choose)
  const kind = pick.option.kind
  const plan = {
    turn: battle.turn, kind, target: pick.option.target, since: trigger === null ? prev.since : battle.turn, trigger, by: pick.by, rules: pick.rules,
    moving, foeIn: battle.foeIn, fallen: fallenOf(battle), dist: distOf(battle, foes), fc, fmap, open, kills: kills.list,
    listed: new Map(kills.list.flatMap((k) => k.strikes.map((s) => [s.uid, s]))),
    // A push's quarry: the foes that held off as it began (kept while it stands, the fallen struck off).
    quarry: kind !== 'push' ? NONE : trigger === null && prev.kind === 'push' ? prev.quarry.filter((uid) => alive(battle.byUid.get(uid)))
      : foes.filter((x) => holdsOff(x, fc, reached)).map((x) => x.uid)
  }
  plan.goals = formation(battle, plan, sit, { prev: prev?.goals })
  if (store) battle.plan = plan
  return plan
}

// What changed since the plan was made, if anything (`prev`, last turn's): a wave entered, a piece of yours fell, the
// Monarch came into the foes' reach, the camp's patience ran long, or the plan's goal is met or has failed (focus: its
// target felled, or none of yours can come to strike it within TUNING.expert.plan.far turns; push: its quarry felled;
// protect: the Monarch out of the foes' reach; hold: the foes came no nearer, none in your reach). → its name, or null
// for none.
function triggerOf (battle, sit, prev, fc, reached, foes) {
  if (battle.foeIn !== prev.foeIn) return 'wave'
  if (fallenOf(battle) > prev.fallen) return 'fell'
  const m = sit.monarch
  // A screened Monarch is safe from that shooter (redesign.md §2.19): only a blow that would land is a trigger.
  const reach = !!m && m.danger > 0
  const guarding = prev.kind === 'protect' || (prev.kind === 'focus' && m?.deals.has(battle.byUid.get(prev.target)))
  if (reach && !guarding) return 'reach'
  if (sit.patience >= TUNING.expert.tree.stall && prev.kind !== 'push' && prev.kind !== 'focus') return 'stall'
  if (prev.kind === 'focus') {
    const x = battle.byUid.get(prev.target)
    if (!x || !alive(x)) return 'met'
    const at = fc.at.get(x.uid) ?? x.tile
    const near = battle.units.some((u) => orderable(battle, u) && distanceBetween(u.tile, u.size, at, x.size) <= u.move * T().far + reachOf(u, x.flies))
    return near ? null : 'failed'
  }
  if (prev.kind === 'push') return prev.quarry.some((uid) => alive(battle.byUid.get(uid))) ? null : 'met'
  if (prev.kind === 'protect') return threatened(sit) ? null : 'met'
  const inReach = foes.some((x) => (x.flies ? reached.air : reached.ground)[x.tile] > 0)
  return !inReach && distOf(battle, foes) >= prev.dist ? 'failed' : null
}

// Whether the Monarch is in the foes' reach as the plan reads it: one could strike it next turn, or could but for a
// screen of yours in its line (sit.monarch.screened, redesign.md §2.19). The screen is the plan's doing (protect closes
// about the Monarch): a plan that dropped protect once its screen stood would walk the screen away the next turn, and
// prep's draft (deployment) would never settle. A screened Monarch is no trigger to change a plan (triggerOf's
// `reach`), and its peril is what would land (planOptions).
const threatened = (sit) => !!sit.monarch && (sit.monarch.danger > 0 || sit.monarch.screened?.length > 0)

// Whether foe `x` holds off: the forecast has it wary (a bold one comes as soon as it can strike: it is only waiting for
// you to be in its reach), and where it will stand your side could not strike it next turn (`reached`, the danger map
// for the foes).
const holdsOff = (x, fc, reached) => !fc.bold.has(x.uid) && (x.flies ? reached.air : reached.ground)[fc.at.get(x.uid) ?? x.tile] === 0
// Your souls fallen in the battle (a fusion's parts are not fallen).
const fallenOf = (battle) => battle.units.reduce((n, u) => n + (u.side === 'party' && !u.shadow && u !== battle.monarch && !alive(u) && !u.into ? 1 : 0), 0)
// The foes' road still to walk to the Monarch, summed.
const distOf = (battle, foes) => foes.reduce((n, x) => n + Math.min(DEPTH, roadOf(battle, x).dist[x.tile]), 0)
// How far `u`'s blows reach a foe (one that flies, `air`: only a ranged blow, or a flyer's); −1 for none.
const reachOf = (u, air) => u.kit.reduce((r, b) => (isBlow(b) ? Math.max(r, air ? aloft(u, b, blowReach(u, b)) : blowReach(u, b)) : r), -1)

// The plans the tree and the weights choose among (TUNING.expert.plan.choose), each a vector of features:
//   hold, focus, push, protect   which plan it is (1)
//   bold      hold: the share of the foes' HP the forecast has coming on
//   waves     hold: a wave is still to come
//   peril     protect: what the foes could deal the Monarch next turn, a share of its HP (at most 2)
//   mends, picks, menace   focus, of its target: it mends; it strikes from afar and could strike one of yours next turn;
//             its hardest blow, a share of the hardest of the foes'
//   fell      focus: 1 where the kill list fells the target, else the share of its HP your pieces could deal it this turn
//   threat    focus: the target could strike the Monarch next turn; cull: and the kill list fells it
//   wary      push: the share of the foes' HP that holds off (wary, and out of your reach where the forecast has them)
//   edge      push: your side's HP × hardest blows over the foes', as a log (−2 to 2)
// A focus is offered on every living foe.
function planOptions (battle, sit, kills, fc, foes, reached) {
  const hp = foes.reduce((n, x) => n + x.hp, 0) || 1
  const share = (xs) => xs.reduce((n, x) => n + x.hp, 0) / hp
  const m = sit.monarch
  const felled = new Set(kills.list.map((k) => k.uid))
  const top = Math.max(1e-9, ...foes.map((x) => hardest(battle, x)))
  const zero = { hold: 0, focus: 0, push: 0, protect: 0, bold: 0, waves: 0, peril: 0, mends: 0, picks: 0, menace: 0, fell: 0, threat: 0, cull: 0, wary: 0, edge: 0 }
  const picks = (x) => {
    const f = sit.threat.foes.find((e) => e.x === x)
    return !!f && !f.melee && [...sit.threat.d.get(f).keys()].some((y) => y !== battle.monarch)
  }
  const out = [
    { kind: 'hold', target: null, v: { ...zero, hold: 1, bold: share(foes.filter((x) => fc.bold.has(x.uid))), waves: sit.wave ? 1 : 0 } },
    { kind: 'protect', target: null, v: { ...zero, protect: 1, peril: m ? Math.min(2, m.danger / Math.max(1, m.hp)) : 0 } },
    { kind: 'push', target: null, v: { ...zero, push: 1, wary: share(foes.filter((x) => holdsOff(x, fc, reached))), edge: edgeOf(battle) } }
  ]
  for (const x of foes) {
    const fell = felled.has(x.uid) ? 1 : Math.min(1, (kills.deal.get(x.uid) ?? 0) / Math.max(1, x.hp))
    const threat = m?.deals.has(x) ? 1 : 0
    out.push({
      kind: 'focus',
      target: x.uid,
      v: { ...zero, focus: 1, mends: x.mend ? 1 : 0, picks: picks(x) ? 1 : 0, menace: hardest(battle, x) / top, fell, threat, cull: threat && felled.has(x.uid) ? 1 : 0 }
    })
  }
  return out
}

// Your side's strength over the foes', as a log, −2 to 2: each side's HP standing × its hardest blows (raw), summed.
function edgeOf (battle) {
  const side = (s) => {
    let hp = 0
    let hit = 0
    for (const u of battle.units) {
      if (u.side !== s || !alive(u) || u === battle.monarch) continue
      hp += u.hp
      hit += hardest(battle, u)
    }
    return hp * hit
  }
  const ours = side('party')
  const theirs = side('foe')
  return ours > 0 && theirs > 0 ? Math.max(-2, Math.min(2, Math.log(ours / theirs))) : ours > 0 ? 2 : -2
}

// ── the target formation ─────────────────────────────────────────────────────────────────────────

// Roles to tiles for `plan` (readPlan's: its kind and target, its forecast), read off the board, then your pieces to
// them. The slots:
//   block   the ground roads' chokes (chokes: no farther than TUNING.expert.plan.line road steps from the seat; protect's
//           beside the seat), the roads walked by the foes standing and the waves to come
//   air     the air road's chokes where flyers walk it (a piece there holds a flyer, ground or not), where no block is;
//           one with a wall between it and the seat, the tile inside the last wall its road crosses (but the seat)
//   shoot   the tiles behind the line (off the foes' roads up to it, and no more than a step farther from the seat by the
//           ground road than its farthest choke) within TUNING.expert.plan.reach of the tiles before the chokes, where
//           the held foes wait (the kill zone): the TUNING.expert.plan.shooters the forecast foes could deal least to
//   heal    the tiles beside each block, behind it
//   strike  focus: about its target's forecast tile; push: about each of its quarry's. TUNING.expert.plan.strikers
//           tiles beside it, as many 2 tiles off, and as many farther (to the reach), each the least endangered by the
//           forecast
// The forecast's danger here is the plan's `open` map, lines of fire taken as clear (redesign.md §2.19): screens stand
// where your pieces stand now, and the formation decides where they will, so it reads none (else it chases its own
// shadow from turn to turn). A slot one of your shadows or summons holds already is held. Each piece's fit for a slot
// (TUNING.expert.plan): its role's worth for the plan (roles) × the piece's aptness for it (block: its toughness, a
// share of your toughest, less fit.melee for one with a ranged blow; air: 1 if it can strike a flyer, else 0.2; shoot:
// its hardest blow, a share of your hardest, where its ranged blow reaches the kill zone from there; heal: 1 for a
// healer; strike: its hardest blow at the target, a share of the hardest of yours, where it reaches the target from
// there), plus fit.travel a turn of
// its walk there (its path on its layer, footprints counted, foes in the way), fit.exposed × the share of its HP the
// forecast foes could deal it there, fit.keep where it held that slot last turn, fit.raise for an Arise holder within
// its reach of the kill zone. The assignment (hungarian) takes the most fit in all, a hold's or a protect's every road
// held first (the block and air slots, while a piece can take them); a piece that no slot fits better than none
// skirmishes: it goes where its blow would reach the nearest foe. `travel` false (prep's): no walk counted; `within`: the
// tiles a piece may stand on (prep's: the camp's). → Map piece uid → { role, slot (the tile), tile (its anchor there, −1
// for none), target, field (steps to that anchor from each tile, on its layer: policy.js progress) }
export function formation (battle, plan, sit, { prev = null, travel = true, within = null } = {}) {
  const W = T()
  const worth = W.roles[plan.kind]
  const out = new Map()
  const pieces = battle.units.filter((u) => orderable(battle, u))
  if (!pieces.length) return out
  const fc = plan.fc
  const ground = fieldOf(battle)
  const air = airOf(battle)
  const foes = battle.units.filter((x) => x.side === 'foe' && alive(x))
  const cap = plan.kind === 'protect' ? 1 : W.line
  const sources = [...foes.filter((x) => !x.flies).map((x) => x.tile), ...entries(battle, false)]
  const line = chokes(ground, sources, cap)
  const aline = chokes(air, [...foes.filter((x) => x.flies).map((x) => x.tile), ...entries(battle, true)], cap)
  const taken = new Set()
  const ok = (t) => !taken.has(t) && t !== battle.root && !battle.walls.has(t) && (within === null || within.has(t)) && (battle.at[t] === null || battle.at[t].side === 'party')
  const shadow = (u) => !!u && u.side === 'party' && u !== battle.monarch && !orderable(battle, u)
  const slots = []
  const add = (s) => {
    slots.push(s)
    taken.add(s.tile)
  }
  for (const c of line) if (ok(c.tile) && !shadow(battle.at[c.tile])) add({ role: 'block', tile: c.tile })
  // Where the air road comes in: an air choke with a wall between it and the seat comes back to the tile inside the last
  // wall its road crosses (a flyer comes over the walls; your pieces on the ground meet it on your side of them), unless
  // that is the seat itself (the wall stands against it: the road is held beyond).
  for (const c of aline) {
    let t = c.tile
    for (let n = c.tile; n >= 0 && air.dist[n] > 0; n = air.arrow[n]) if (battle.walls.has(n)) t = air.arrow[n]
    if (t === battle.root) t = c.tile
    if (!line.some((g) => g.tile === t) && ok(t) && !shadow(battle.at[t]) && !shadow(battle.sky[t])) add({ role: 'air', tile: t })
  }
  const zone = [...new Set([...line, ...aline].flatMap((c) => c.front))]
  if (zone.length) {
    // The foes' approach: their roads up to the line.
    const ahead = new Set()
    const stop = new Set(line.map((c) => c.tile))
    for (const s of sources) for (let t = s, k = 0; t >= 0 && k < TILES && !stop.has(t) && ground.dist[t] > 0; t = ground.arrow[t], k++) ahead.add(t)
    const depth = 1 + Math.max(0, ...[...line, ...aline].map((c) => ground.dist[c.tile]).filter(Number.isFinite))
    const near = (t) => zone.reduce((n, z) => Math.min(n, distance(t, z)), Infinity)
    const shoot = []
    for (let t = 0; t < TILES; t++) {
      if (!ok(t) || ahead.has(t) || !(ground.dist[t] <= depth)) continue
      const n = near(t)
      if (n >= 1 && n <= W.reach) shoot.push({ t, n, d: plan.open.ground[t] })
    }
    shoot.sort((p, q) => p.d - q.d || p.n - q.n || p.t - q.t)
    for (const c of shoot.slice(0, W.shooters)) add({ role: 'shoot', tile: c.t })
    for (const s of slots.filter((x) => x.role === 'block')) {
      for (const t of NEIGHBOURS[s.tile]) if (ok(t) && ground.dist[t] <= ground.dist[s.tile]) add({ role: 'heal', tile: t, ward: s.tile })
    }
  }
  if (worth.strike > 0) {
    const targets = (plan.kind === 'focus' ? [plan.target] : plan.quarry).map((uid) => battle.byUid.get(uid)).filter((x) => x && alive(x))
    for (const x of targets) {
      const at = fc.at.get(x.uid) ?? x.tile
      const rings = [[], [], []]
      for (let t = 0; t < TILES; t++) {
        const n = distance(t, at)
        if (ok(t) && n >= 1 && n <= W.reach) rings[Math.min(n, 3) - 1].push({ t, n })
      }
      const order = (p, q) => plan.open.ground[p.t] - plan.open.ground[q.t] || p.n - q.n || p.t - q.t
      for (const ring of rings) for (const c of ring.sort(order).slice(0, W.strikers)) add({ role: 'strike', tile: c.t, target: x.uid, at })
    }
  }
  // Each piece's fit for each slot, and the assignment.
  const toughOf = (u) => {
    const s = stats(battle, u)
    return u.hp * (1 + Math.max(0, s.def) / 100) / s.damage.taken
  }
  const most = Math.max(1e-9, ...pieces.map(toughOf))
  const top = Math.max(1e-9, ...pieces.map((u) => hardest(battle, u)))
  const BIG = 1e6
  // Holding or protecting, every road is held while a piece can hold it (as the formation tree's block-roads): the road
  // slots are filled first, the weights choosing who.
  const held = plan.kind === 'hold' || plan.kind === 'protect'
  const HELD = 1e3
  const hits = new Map()
  const hardOn = (x) => hits.get(x) ?? hits.set(x, Math.max(1e-9, ...pieces.map((u) => strikeOn(battle, u, x)))).get(x)
  const paths = new Map(pieces.map((u) => [u.uid, travel ? stepsFrom(battle, u, [u.tile], true) : null]))
  const rows = pieces.map((u) => {
    const from = paths.get(u.uid)
    const melee = u.kit.filter(isBlow).every((b) => b.melee)
    const ranged = u.kit.filter((b) => isBlow(b) && !b.melee).reduce((r, b) => Math.max(r, blowReach(u, b)), -1)
    const raise = ariseOf(battle, u)
    return slots.map((s) => {
      const a = anchorFor(battle, u, s.tile, within)
      if (a < 0) return -BIG
      let apt = 0
      if (s.role === 'block') apt = toughOf(u) / most * (melee ? 1 : 1 - W.fit.melee)
      else if (s.role === 'air') apt = reachOf(u, true) >= 0 ? 1 : 0.2
      else if (s.role === 'shoot') apt = ranged >= 0 && zone.some((z) => distanceBetween(a, u.size, z, 1) <= ranged) ? hardest(battle, u) / top : 0
      else if (s.role === 'heal') apt = u.mend ? 1 : 0
      else if (s.role === 'strike') {
        const x = battle.byUid.get(s.target)
        const r = reachOf(u, x.flies)
        apt = r >= 0 && distanceBetween(a, u.size, s.at, x.size) <= r ? strikeOn(battle, u, x) / hardOn(x) : 0
      }
      if (!(apt > 0)) return -BIG
      const steps = from ? from[a] : 0
      if (!Number.isFinite(steps)) return -BIG
      let fit = (held && (s.role === 'block' || s.role === 'air') ? HELD : 0) + worth[s.role] * apt + W.fit.travel * Math.ceil(steps / Math.max(1, u.move)) +
        W.fit.exposed * dangerAt(battle, u, a, plan.open) / Math.max(1, u.hp)
      const was = prev?.get(u.uid)
      if (was && was.slot === s.tile && was.role === s.role) fit += W.fit.keep
      if (raise && zone.some((z) => distanceBetween(a, u.size, z, 1) <= raise.domain)) fit += W.fit.raise
      return fit
    })
  })
  const col = hungarian(rows.map((r) => [...r.map((f) => -f), ...pieces.map(() => 0)]))
  pieces.forEach((u, i) => {
    const s = col[i] < slots.length ? slots[col[i]] : null
    const tile = s ? anchorFor(battle, u, s.tile, within) : travel ? skirmish(battle, u, fc, paths.get(u.uid), foes) : -1
    out.set(u.uid, { role: s?.role ?? 'free', slot: s?.tile ?? tile, tile, target: s?.target ?? null, field: tile >= 0 ? stepsFrom(battle, u, [tile], false) : null })
  })
  return out
}

// What `u`'s hardest blow at `x` would deal it (policy.js blowOn), wherever it stands.
const strikeOn = (battle, u, x) => u.kit.reduce((n, b) => (isBlow(b) ? Math.max(n, blowOn(battle, u, b, x)) : n), 0)

// Where piece `u` stands to cover `tile`: its anchor there (a 2×2 piece's, the first of the four whose footprint covers
// the tile and is clear of walls, and of the board's edge), within `within` where given; −1 for none.
function anchorFor (battle, u, tile, within = null) {
  for (const a of u.size === 1 ? [tile] : [tile, tile - 1, tile - LANES, tile - LANES - 1]) {
    const fp = a >= 0 ? footprint(a, u.size) : null
    if (fp?.includes(tile) && fp.every((t) => (u.flies || !battle.walls.has(t)) && t !== battle.root && (within === null || within.has(t)))) return a
  }
  return -1
}

// Steps for piece `u`'s footprint from each anchor to the nearest of `from` (anchors), as it moves (turns.js reach):
// 8 ways, a piece on the ground never on a wall nor diagonally past a wall's corner, and with `foes`, never through a
// foe; a flyer over anything. The moves are symmetric, so it is the way back too. → by tile (Infinity: no way).
function stepsFrom (battle, u, from, foes) {
  const out = new Array(TILES).fill(Infinity)
  const clear = (t) => footprint(t, u.size)?.every((x) => !battle.walls.has(x)) ?? false
  const passes = (t) => {
    const fp = footprint(t, u.size)
    if (!fp) return false
    if (u.flies) return true
    for (const x of fp) if (battle.walls.has(x) || (foes && battle.at[x] !== null && battle.at[x].side !== u.side)) return false
    return true
  }
  const queue = []
  for (const t of from) {
    if (t < 0 || out[t] === 0) continue
    out[t] = 0
    queue.push(t)
  }
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i]
    const x = tileX(t)
    const y = tileY(t)
    for (const n of NEIGHBOURS[t]) {
      if (out[n] !== Infinity || !passes(n)) continue
      if (!u.flies && tileX(n) !== x && tileY(n) !== y && !(clear(tileAt(tileX(n), y)) && clear(tileAt(x, tileY(n))))) continue
      out[n] = out[t] + 1
      queue.push(n)
    }
  }
  return out
}

// Where a piece with no slot goes: the nearest tile (by its walk, `from`) whence a blow of its reaches a foe where the
// forecast has it, and no one else stands; −1 for none.
function skirmish (battle, u, fc, from, foes) {
  let best = -1
  for (const x of foes) {
    const r = reachOf(u, x.flies)
    if (r < 0) continue
    const at = fc.at.get(x.uid) ?? x.tile
    for (let t = 0; t < TILES; t++) {
      if (!(from[t] < Infinity) || (best >= 0 && from[t] > from[best]) || distanceBetween(t, u.size, at, x.size) > r) continue
      const fp = footprint(t, u.size)
      if (fp.some((c) => c === battle.root || ((u.flies ? battle.sky : battle.at)[c] ?? u) !== u)) continue
      if (best < 0 || from[t] < from[best] || (from[t] === from[best] && t < best)) best = t
    }
  }
  return best
}

// Rows to columns (n ≤ m), the least cost in all: the Hungarian method (Kuhn–Munkres, by potentials), O(n² m). → each
// row's column.
export function hungarian (cost) {
  const n = cost.length
  const m = n ? cost[0].length : 0
  const u = new Array(n + 1).fill(0)
  const v = new Array(m + 1).fill(0)
  const p = new Array(m + 1).fill(0)
  const way = new Array(m + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array(m + 1).fill(Infinity)
    const used = new Array(m + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else minv[j] -= delta
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0)
  }
  const out = new Array(n).fill(-1)
  for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1
  return out
}

// ── prep ─────────────────────────────────────────────────────────────────────────────────────────

// Prep's formation (autoplay.js drafts): the target formation's first answer, on `battle` set up as the room would
// begin (no turn played): the plan the tree would choose then, its roles' slots among the `within` tiles (the camp's),
// no walk counted. → Map piece uid → its anchor tile (the pieces it gives a slot)
export function deployment (battle, sit, within) {
  const plan = readPlan(battle, sit, { store: false })
  const goals = formation(battle, plan, sit, { travel: false, within })
  return new Map([...goals].filter(([, g]) => g.role !== 'free' && g.tile >= 0).map(([uid, g]) => [uid, g.tile]))
}
