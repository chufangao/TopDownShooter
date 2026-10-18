// The expert's plan: what your pieces do together, read off the board once a turn (readPlan) and kept across turns,
// never played out; each piece's options read it as features (policy.js features). Four reads:
//   the plan       hold, focus (one key foe), push (at foes that will not come) or protect (close about the Monarch),
//                  picked by expert.js TREES.plan and TUNING.expert.plan.choose, kept until a trigger fires (triggerOf)
//   the formation  roles to tiles for the plan, pieces to roles by assignment (formation); prep deploys by it (deployment)
//   the kill list  the foes your pieces can fell together this turn, and who strikes whom in what order (killList)
//   the forecast   where each foe will likely stand next turn (forecast)
import { TUNING } from '../tuning.js'
import {
  alive, isBlow, footprint, tileX, tileY, tileAt, distance, distanceBetween, blowReach, statsOf, abilitiesOf, lineEnds, between, LINE_AT, LINE_TILES, TILES, LANES,
  DEPTH, NEIGHBOURS
} from './unit.js'
import { fieldOf, airOf, roadOf } from './field.js'
import { stats, roadTiles, canAct, aloft, orderable, counterOf, ariseOf, isSkill, lined, lineBlocker, hexed } from './turns.js'
import { danger, dangerAt, options, hardest, blowOn, struckOf, rawOf } from './policy.js'
import { unitDef, abilityDef } from '../content.js'
import { decide, TREES } from './expert.js'

const T = () => TUNING.expert.plan
const NEUTRAL = { aggression: 1, caution: 1, prey: 'weakest' }
const NONE = Object.freeze([])
const NOBODY = new Set()

// ── the forecast ─────────────────────────────────────────────────────────────────────────────────

// Where each living foe will likely stand next turn, along its road within its Move: the bold (aggression ≥ 1) as far
// as lets them strike one of yours, else to your reach's edge; a keeper (0) behind its comrades; the rest wary (`map`,
// the foes' danger map); all as far as they can once patience reaches plan.impatient. → { at: Map uid → tile, bold: Set }
export function forecast (battle, sit, map = danger(battle, 'foe')) {
  const impatient = (sit?.patience ?? battle.turn - battle.foeIn) >= T().impatient
  const at = new Map()
  const bold = new Set()
  const keepers = []
  const ours = battle.units.filter((y) => y.side === 'party' && alive(y))
  for (const x of battle.units) {
    if (x.side !== 'foe' || !alive(x)) continue
    const spots = roadTiles(battle, x, x.move)
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

// The chokes of `road` (a field: arrows into the Monarch's seat) for foes walking from `sources`: for each road into the
// seat, of the chain of tiles out from its entry where one piece holds every source that comes that way (no split, no
// foe on it, within `cap` steps), the tile `hold(chain, sources' indices)` picks, else the farthest.
// → [{ tile, sources (how many it holds), front (the tiles just before it, where those foes wait) }], by entry tile
export function chokes (road, sources, cap, hold = null) {
  const count = new Map()
  const by = new Map()
  sources.forEach((s, i) => {
    let last = -1
    for (let t = road.arrow[s], k = 0; t >= 0 && road.dist[t] > 0 && k < TILES; t = road.arrow[t], k++) {
      count.set(t, (count.get(t) ?? 0) + 1)
      last = t
    }
    if (last >= 0) by.set(last, [...(by.get(last) ?? NONE), i])
  })
  const kids = new Map()
  for (const t of count.keys()) if (count.has(road.arrow[t])) kids.set(road.arrow[t], [...(kids.get(road.arrow[t]) ?? NONE), t])
  const out = []
  for (const e of [...count.keys()].filter((t) => road.dist[t] === 1).sort((a, b) => a - b)) {
    const chain = [e]
    for (let n = e; ;) {
      const k = kids.get(n) ?? NONE
      if (k.length !== 1 || count.get(k[0]) !== count.get(n) || road.dist[k[0]] > cap) break
      n = k[0]
      chain.push(n)
    }
    const n = chain[hold ? hold(chain, by.get(e) ?? NONE) : chain.length - 1]
    const front = new Set(kids.get(n) ?? NONE)
    for (const s of sources) if (road.arrow[s] === n) front.add(s)
    out.push({ tile: n, sources: count.get(n), front: [...front].sort((a, b) => a - b) })
  }
  return out
}

// The line out of range, as chokes' `hold`: the first tile of the chain (`ok` to stand on) where a piece keeps every foe
// of that road out of the Monarch's reach (exposure 0), else the farthest of the least exposed. `src`: roadSources'.
function outOfRange (battle, road, src, ok) {
  const m = battle.monarch
  return (chain, from) => {
    if (!m || !alive(m)) return chain.length - 1
    let best = -1
    let low = Infinity
    for (let i = 0; i < chain.length; i++) {
      if (!ok(chain[i])) continue
      const e = exposure(battle, road, src, from, chain[i], m)
      if (e === 0) return i
      if (e <= low) {
        low = e
        best = i
      }
    }
    return best >= 0 ? best : chain.length - 1
  }
}

// The Monarch's exposure with a piece on road tile `b`: the hardest blow (raw) of each foe of sources `from` that reaches
// it from its road short of b (a lined one not through b), summed.
function exposure (battle, road, src, from, b, m) {
  let n = 0
  for (const i of from) {
    const pos = []
    for (let t = src.tiles[i], k = 0; t >= 0 && t !== b && road.dist[t] > 0 && k < TILES; t = road.arrow[t], k++) pos.push(t)
    for (const x of src.who[i]) n += reachesFrom(battle, x, pos, m, { screen: b })
  }
  return n
}

// Foe `x`'s hardest blow (raw) reaching `m` from one of `pos` (a lined one not through `screen`), 0 for none; `board`: ready
// next turn, none if Hexed, lines as the board stands; `ranged`: no melee. A reserve foe reads its kind's kit.
function reachesFrom (battle, x, pos, m, { screen = -1, board = false, ranged = false } = {}) {
  if (board && hexed(x)) return 0
  let best = 0
  for (const a of x.kit ?? abilitiesOf(x).map(abilityDef)) {
    if (!isBlow(a) || (ranged && a.melee) || (board && isSkill(x, a) && (x.cooldowns[a.id] ?? 0) > 0)) continue
    const raw = x.kit ? rawOf(battle, x, a) : a.effects.reduce((n, e) => n + (e.op === 'damage' ? e.power : 0), 0) * statsOf(x).atk / TUNING.damage.atkDivisor
    if (!(raw > best)) continue
    const r = blowReach(x, a)
    const line = lined(a)
    for (const t of pos) {
      if (distanceBetween(t, 1, m.tile, m.size) > r) continue
      if (line) {
        const [p, q] = lineEnds(t, 1, m.tile, m.size)
        if (onLine(p, q, screen) || (board && lineBlocker(battle, p, q, m.side, m))) continue
      }
      best = raw
      break
    }
  }
  return best
}

// Whether tile `t` lies strictly between tiles p and q (unit.js LINE_TILES).
function onLine (p, q, t) {
  if (t < 0) return false
  const k = p * TILES + q
  for (let i = LINE_AT[k]; i < LINE_AT[k + 1]; i++) if (LINE_TILES[i] === t) return true
  return false
}

// The foes that walk a layer's road (`flies`), as chokes' sources: each living one's tile, and each lane's top-edge tile
// the foes still to come enter by, with the foes there (`who`, by the same index). → { tiles, who }
function roadSources (battle, foes, flies) {
  const tiles = []
  const who = []
  for (const x of foes) {
    if (!!x.flies !== flies) continue
    tiles.push(x.tile)
    who.push([x])
  }
  const at = new Map()
  for (const f of battle.reserve) {
    if (!!unitDef(f.id).flies !== flies) continue
    const t = tileAt(f.lane ?? 3, DEPTH - 1)
    at.set(t, [...(at.get(t) ?? NONE), f])
  }
  for (const [t, list] of [...at].sort((a, b) => a[0] - b[0])) {
    tiles.push(t)
    who.push(list)
  }
  return { tiles, who }
}

// ── the kill list ────────────────────────────────────────────────────────────────────────────────

// Which foes your pieces can fell together this turn, and who strikes whom in what order: the foes the most pressing
// first (in `first`, the Monarch's shooters; able to strike the Monarch; a healer; the hardest blow for its HP), each
// listed where the pieces not yet listed can deal its HP, the fewest of them, ranged blows first (a counter answers only
// a blow its target survives), none whose counter would fell a piece. `opts`: Map piece uid → its options, read already.
// → { list: [{ uid, strikes: [{ uid, ability, target, tile, damage }] }], deal: Map foe uid → what yours could deal it }
export function killList (battle, sit, { moving = true, first = NOBODY, opts = null } = {}) {
  const mine = battle.units.filter((u) => orderable(battle, u) && canAct(battle, u))
  const foes = battle.units.filter((x) => x.side === 'foe' && alive(x))
  const best = new Map()
  const deal = new Map()
  for (const u of mine) {
    const row = new Map()
    for (const o of opts?.get(u.uid) ?? options(battle, u, { moving })) {
      const a = o.ability
      // A blow from a tile whence one of its side stands in its line strikes that one, not this foe.
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
  const key = (x) => [first.has(x.uid) ? 1 : 0, m?.deals.has(x) ? 1 : 0, x.mend ? 1 : 0, hardest(battle, x) / Math.max(1, x.hp)]
  const order = foes.map((x) => [x, key(x)]).sort(([a, p], [b, q]) => q[0] - p[0] || q[1] - p[1] || q[2] - p[2] || q[3] - p[3] || a.uid - b.uid).map(([x]) => x)
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

// The plan for this turn: last turn's where no trigger fires, else chosen afresh by the tree and the weights; then its
// formation, the kill list and the forecast. Made once a turn (read again, the same). `store` false: the battle keeps
// no plan; `moving` false: the kill list strikes from where each stands; `opts`: as killList's.
// → { turn, kind, target (focus: a foe's uid), since, trigger ('start', 'wave', 'fell', 'shooter', 'reach', 'stall', 'met',
// 'failed'; null: kept), by, rules, goals (formation), kills, listed (Map piece uid → its strike), shooters, quarry (a
// push's foes), fc (forecast), fmap (danger from where it has the foes), open (the same, no line of fire stopped) }
export function readPlan (battle, sit, { moving = true, store = true, opts = null } = {}) {
  const had = battle.plan
  if (had && had.turn === battle.turn && had.moving === moving) return had
  const prev = had && had.turn < battle.turn ? had : null
  const reached = danger(battle, 'foe')
  const fc = forecast(battle, sit, reached)
  const fmap = danger(battle, 'party', fc.at)
  const open = danger(battle, 'party', fc.at, { lines: false })
  const foes = battle.units.filter((x) => x.side === 'foe' && alive(x))
  const shooters = shootersOf(battle, fc, foes)
  const kills = killList(battle, sit, { moving, first: new Set(shooters), opts })
  const felled = new Set(kills.list.map((k) => k.uid))
  const fellable = shooters.filter((uid) => felled.has(uid) || canFell(battle, battle.byUid.get(uid), fc))
  const trigger = prev ? triggerOf(battle, sit, prev, fc, reached, foes, { shooters, fellable }) : 'start'
  const ctx = {
    trigger,
    prev,
    patience: sit.patience,
    reach: threatened(sit),
    shooters,
    fellable,
    healer: foes.some((x) => x.mend && felled.has(x.uid)),
    waiting: !sit.wave && foes.length > 0 && foes.every((x) => holdsOff(x, fc, reached))
  }
  const pick = decide(TREES.plan, ctx, planOptions(battle, sit, kills, fc, foes, reached, fellable), T().choose)
  const kind = pick.option.kind
  const plan = {
    turn: battle.turn, kind, target: pick.option.target, since: trigger === null ? prev.since : battle.turn, trigger, by: pick.by, rules: pick.rules,
    moving, foeIn: battle.foeIn, fallen: fallenOf(battle), dist: distOf(battle, foes), fc, fmap, open, kills: kills.list, shooters,
    listed: new Map(kills.list.flatMap((k) => k.strikes.map((s) => [s.uid, s]))),
    // A push's quarry: the foes that held off as it began (kept while it stands, the fallen struck off).
    quarry: kind !== 'push' ? NONE : trigger === null && prev.kind === 'push' ? prev.quarry.filter((uid) => alive(battle.byUid.get(uid)))
      : foes.filter((x) => holdsOff(x, fc, reached)).map((x) => x.uid)
  }
  plan.goals = formation(battle, plan, sit, { prev: prev?.goals })
  if (store) battle.plan = plan
  return plan
}

// What changed since last turn's plan `prev`: a wave entered, a piece fell, an unanswered shooter, the Monarch in reach,
// the camp's patience long, or the goal met or failed (focus: felled, or out of reach for plan.far turns; push: quarry
// felled; protect: the Monarch out of reach; hold: the foes came no nearer). → the trigger's name, or null.
function triggerOf (battle, sit, prev, fc, reached, foes, { shooters, fellable }) {
  if (battle.foeIn !== prev.foeIn) return 'wave'
  if (fallenOf(battle) > prev.fallen) return 'fell'
  if (shooters.length && !(prev.kind === 'focus' && shooters.includes(prev.target)) && !(prev.kind === 'protect' && !fellable.length)) return 'shooter'
  const m = sit.monarch
  // A screened Monarch is safe from that shooter: only a blow that would land is a trigger.
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

// The Monarch's shooters: the uids of the living foes whose ranged blow, ready next turn, could reach the Monarch from
// where they stand or the forecast has them, on a clear line as the board stands.
function shootersOf (battle, fc, foes) {
  const m = battle.monarch
  if (!m || !alive(m)) return NONE
  const out = []
  for (const x of foes) {
    const at = fc.at.get(x.uid)
    if (reachesFrom(battle, x, at === undefined || at === x.tile ? [x.tile] : [x.tile, at], m, { board: true, ranged: true }) > 0) out.push(x.uid)
  }
  return out
}

// Whether your pieces could fell foe `x` within TUNING.expert.plan.horizon turns: each that can strike it at all, its
// hardest blow once a turn from when its Move brings it in reach of x's forecast tile, against x's HP.
function canFell (battle, x, fc) {
  const at = fc.at.get(x.uid) ?? x.tile
  let dealt = 0
  for (const u of battle.units) {
    if (!orderable(battle, u)) continue
    const r = reachOf(u, x.flies)
    if (r < 0) continue
    const gap = Math.max(0, distanceBetween(u.tile, u.size, at, x.size) - r)
    const blows = T().horizon - Math.ceil(gap / Math.max(1, u.move))
    if (blows > 0) dealt += blows * strikeOn(battle, u, x)
  }
  return dealt >= x.hp
}

// Whether the Monarch is in the foes' reach for the plan: one could strike it next turn, or could but for a screen
// (counting the screened keeps a protect from walking its own screen away the next turn).
const threatened = (sit) => !!sit.monarch && (sit.monarch.danger > 0 || sit.monarch.screened?.length > 0)

// Whether foe `x` holds off: the forecast has it wary, where your side could not strike it next turn (`reached`).
const holdsOff = (x, fc, reached) => !fc.bold.has(x.uid) && (x.flies ? reached.air : reached.ground)[fc.at.get(x.uid) ?? x.tile] === 0
// Your souls fallen in the battle.
const fallenOf = (battle) => battle.units.reduce((n, u) => n + (u.side === 'party' && !u.shadow && u !== battle.monarch && !alive(u) ? 1 : 0), 0)
// The foes' road still to walk to the Monarch, summed.
const distOf = (battle, foes) => foes.reduce((n, x) => n + Math.min(DEPTH, roadOf(battle, x).dist[x.tile]), 0)
// How far `u`'s blows reach a foe (one that flies, `air`: only a ranged blow, or a flyer's); −1 for none.
const reachOf = (u, air) => u.kit.reduce((r, b) => (isBlow(b) ? Math.max(r, air ? aloft(u, b, blowReach(u, b)) : blowReach(u, b)) : r), -1)

// The plans the tree and the weights choose among (TUNING.expert.plan.choose), each a vector of features:
//   hold, focus, push, protect   which plan it is (1)
//   bold      hold: the share of the foes' HP the forecast has coming on
//   waves     hold: a wave is still to come
//   peril     protect: the Monarch's danger next turn, a share of its HP (at most 2)
//   mends, picks, menace   focus, of its target: it mends; it strikes from afar at one of yours; its hardest blow's share
//   fell      focus: 1 where the kill list fells the target, else the share of its HP yours could deal this turn
//   threat    focus: the target could strike the Monarch next turn; cull: and the kill list fells it
//   shooter   focus: the target is one of the Monarch's shooters yours could fell
//   wary      push: the share of the foes' HP that holds off
//   edge      push: edgeOf
// A focus is offered on every living foe.
function planOptions (battle, sit, kills, fc, foes, reached, fellable = NONE) {
  const hp = foes.reduce((n, x) => n + x.hp, 0) || 1
  const share = (xs) => xs.reduce((n, x) => n + x.hp, 0) / hp
  const m = sit.monarch
  const felled = new Set(kills.list.map((k) => k.uid))
  const top = Math.max(1e-9, ...foes.map((x) => hardest(battle, x)))
  const zero = { hold: 0, focus: 0, push: 0, protect: 0, bold: 0, waves: 0, peril: 0, mends: 0, picks: 0, menace: 0, fell: 0, threat: 0, cull: 0, shooter: 0, wary: 0, edge: 0 }
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
      v: {
        ...zero, focus: 1, mends: x.mend ? 1 : 0, picks: picks(x) ? 1 : 0, menace: hardest(battle, x) / top, fell, threat, cull: threat && felled.has(x.uid) ? 1 : 0,
        shooter: fellable.includes(x.uid) ? 1 : 0
      }
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

// Roles to tiles for `plan` (its kind, target and forecast), read off the board, then your pieces to them. The slots:
//   block   each ground road's choke at the line out of range (outOfRange), within TUNING.expert.plan.line steps
//   air     the air road's chokes where flyers walk it and no block is
//   shoot   the TUNING.expert.plan.shooters safest tiles behind the line within plan.reach of the kill zone
//   heal    the tiles beside each block, behind it
//   screen  on the line of each foe whose lined blow reaches the Monarch from its forecast tile
//   strike  focus: about its target's forecast tile; push: about each of its quarry's (plan.strikers a ring)
// Danger here is the plan's `open` map (lines of fire as clear: the formation decides where the screens will stand).
// A piece's fit for a slot (TUNING.expert.plan): the role's worth for the plan × its aptness, plus fit.travel a turn of
// its walk, fit.exposed × its danger there, fit.keep for last turn's slot, fit.raise for an Arise holder near the kill
// zone; the assignment (hungarian) fills a hold's or protect's road slots first; a piece no slot fits skirmishes.
// `travel` false: no walk counted; `within`: the tiles a piece may stand on (prep's).
// → Map piece uid → { role, slot, tile (its anchor, −1 for none), target, field (steps to the anchor, by tile) }
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
  const taken = new Set()
  const ok = (t) => !taken.has(t) && t !== battle.root && !battle.walls.has(t) && (within === null || within.has(t)) && (battle.at[t] === null || battle.at[t].side === 'party')
  const shadow = (u) => !!u && u.side === 'party' && u !== battle.monarch && !orderable(battle, u)
  const slots = []
  const add = (s) => {
    slots.push(s)
    taken.add(s.tile)
  }
  // Each road held at the line out of range (outOfRange), the ground's, then the air's.
  const gsrc = roadSources(battle, foes, false)
  const sources = gsrc.tiles
  const line = chokes(ground, sources, W.line, outOfRange(battle, ground, gsrc, ok))
  for (const c of line) if (ok(c.tile) && !shadow(battle.at[c.tile])) add({ role: 'block', tile: c.tile })
  const asrc = roadSources(battle, foes, true)
  const aline = chokes(air, asrc.tiles, W.line, outOfRange(battle, air, asrc, (t) => ok(t) || line.some((g) => g.tile === t && taken.has(t))))
  // An air choke past a wall comes back to the tile inside the last wall its road crosses, unless that is the seat.
  for (const c of aline) {
    let t = c.tile
    for (let n = c.tile; n >= 0 && air.dist[n] > 0; n = air.arrow[n]) if (battle.walls.has(n)) t = air.arrow[n]
    if (t === battle.root) t = c.tile
    if (!line.some((g) => g.tile === t) && ok(t) && !shadow(battle.at[t]) && !shadow(battle.sky[t])) add({ role: 'air', tile: t })
  }
  // A screen on the line of each foe whose lined blow reaches the Monarch from its forecast tile, where no slot stands on
  // that line already: its tile nearest the Monarch, or one of yours on it already.
  const m = battle.monarch
  if (m && alive(m) && worth.screen > 0) {
    for (const x of foes) {
      const at = fc.at.get(x.uid) ?? x.tile
      if (!x.kit.some((a) => isBlow(a) && lined(a) && rawOf(battle, x, a) > 0 && distanceBetween(at, x.size, m.tile, m.size) <= blowReach(x, a))) continue
      const [p, q] = lineEnds(at, x.size, m.tile, m.size)
      const on = between(p, q)
      if (on.some((t) => taken.has(t))) continue
      const t = on.find((c) => battle.at[c] !== null && orderable(battle, battle.at[c])) ?? on.findLast((c) => ok(c))
      if (t !== undefined && ok(t)) add({ role: 'screen', tile: t, target: x.uid })
    }
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
  // Holding or protecting, the road slots (and a protect's screens) are filled first while a piece can take them.
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
      else if (s.role === 'screen') apt = toughOf(u) / most
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
      const first = held && (s.role === 'block' || s.role === 'air' || (s.role === 'screen' && plan.kind === 'protect'))
      let fit = (first ? HELD : 0) + worth[s.role] * apt + W.fit.travel * Math.ceil(steps / Math.max(1, u.move)) +
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

// Where piece `u` stands to cover `tile`: its anchor (a 2×2's, the first of the four whose footprint covers it, clear of
// walls and the edge), within `within` where given; −1 for none.
function anchorFor (battle, u, tile, within = null) {
  for (const a of u.size === 1 ? [tile] : [tile, tile - 1, tile - LANES, tile - LANES - 1]) {
    const fp = a >= 0 ? footprint(a, u.size) : null
    if (fp?.includes(tile) && fp.every((t) => (u.flies || !battle.walls.has(t)) && t !== battle.root && (within === null || within.has(t)))) return a
  }
  return -1
}

// Steps for `u`'s footprint from each anchor to the nearest of `from`, as it moves (turns.js reach), with `foes` never
// through one; the moves are symmetric, so the way back too. → by tile (Infinity: no way)
function stepsFrom (battle, u, from, foes) {
  const out = new Array(TILES).fill(Infinity)
  const one = u.size === 1
  const clear = (t) => (one ? !battle.walls.has(t) : footprint(t, u.size)?.every((x) => !battle.walls.has(x)) ?? false)
  const passes = (t) => {
    if (one) return u.flies || !(battle.walls.has(t) || (foes && battle.at[t] !== null && battle.at[t].side !== u.side))
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

// Where a piece with no slot goes: the nearest tile by its walk (`from`) whence it reaches a foe's forecast tile, unoccupied; −1 for none.
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

// Rows to columns (n ≤ m), the least cost in all: the Hungarian method (Kuhn–Munkres, by potentials). → each row's column
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

// Prep's formation (autoplay.js drafts): the formation's first answer on `battle` as the room would begin, its slots
// among the camp's `within` tiles, no walk counted. → Map piece uid → its anchor tile
export function deployment (battle, sit, within) {
  const plan = readPlan(battle, sit, { store: false })
  const goals = formation(battle, plan, sit, { travel: false, within })
  return new Map([...goals].filter(([, g]) => g.role !== 'free' && g.tile >= 0).map(([uid, g]) => [uid, g.tile]))
}
