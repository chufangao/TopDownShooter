// What a playout is worth, offline: a battle played to its end (endValue, END_WEIGHTS) and a run played on from a room
// choice or a decision out of battle, to its end (routeEndValue, ROUTE_END_WEIGHTS) or over a window of rooms
// (routeValue, ROUTE_WEIGHTS). The outside teacher (outside.js) reads them.
// value to the battle's end = −lost where lost (a stall too), else −monarch·monarch − own·own − turn·turns
// value to the run's end    = −lost·lost + Σ w·part over rooms, floors, monarch, own, souls, won
// value over a window       = −lost·lost − monarch·monarch − own·own + Σ w·part over essence, cleared, power, purse
import { currentNode, monarchOf, souls } from './run.js'
import { alive } from './unit.js'
import { survey, tierScale } from './player.js'
import { progressOf, foeShare, routeRooms } from './reports.js'
import { r6 } from './trees.js'

export const END_WEIGHTS = Object.freeze({ lost: 10, monarch: 3, own: 1, turn: 0.02 })
export const ROUTE_WEIGHTS = Object.freeze({ lost: 10, monarch: 3, own: 1, essence: 1, cleared: 1, power: 0, purse: 0 })
export const ROUTE_END_WEIGHTS = Object.freeze({ lost: 10, rooms: 1, floors: 1, monarch: 1, own: 1, souls: 0, won: 0 })

// ── a battle to its end ──────────────────────────────────────────────────────────────────────────

// What the value to the end reads of a board: the Monarch's HP share, each soul's HP and max (no shadow), the round.
export function endTally (b) {
  const m = b.monarch
  const souls = new Map()
  let max = 0
  for (const u of b.units) {
    if (!alive(u) || u.side !== 'party' || u === m || u.shadow) continue
    souls.set(u.uid, { hp: u.hp, maxHp: u.maxHp })
    max += u.maxHp
  }
  return { m: m ? Math.max(0, m.hp) / m.maxHp : 0, souls, max, turn: b.turn }
}

// The label to the battle's end of played-out `g` against `before` (endTally): monarch the share of its max HP lost, as
// the run carries it; own the souls' share lost in the battle (the run heals it back: the margin is the label's, a
// fallen soul all of its share). `stall`: the playout ran out of rounds.
export function endValue (before, g, w = END_WEIGHTS, stall = false) {
  const won = g.over && g.winner === 'party'
  const m = g.monarch
  const mAfter = m && m.hp > 0 ? m.hp / m.maxHp : 0
  let had = 0
  let kept = 0
  let fell = 0
  let fallen = 0
  for (const [uid, s] of before.souls) {
    had += s.hp
    const x = g.byUid.get(uid)
    if (x && !alive(x)) {
      fell++
      fallen += s.maxHp - s.hp
    }
  }
  for (const u of g.units) if (alive(u) && u.side === 'party' && u !== m && !u.shadow) kept += u.hp
  const parts = {
    lost: won ? 0 : 1,
    stall: stall ? 1 : 0,
    monarch: won ? before.m - mAfter : 0,
    own: won && before.max > 0 ? (had - kept + fallen) / before.max : 0,
    fell,
    turns: g.turn - before.turn
  }
  const value = won ? -w.monarch * parts.monarch - w.own * parts.own - w.turn * parts.turns : -w.lost
  return { value: r6(value), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r6(v)])) }
}

// ── a run to its end, or over a window ───────────────────────────────────────────────────────────

// What the route's value reads of a run: floor, the HP shares, essence, purse, log strength, and on the map its progress.
export function runTally (run) {
  const s = run.state
  const m = monarchOf(s)
  let hp = 0
  let max = 0
  for (const u of souls(s.party)) {
    hp += Math.max(0, u.hp)
    max += u.maxHp
  }
  const share = s.phase === 'map' ? progressOf({ result: null, floor: s.floor, rank: (currentNode(run)?.rank ?? 0) + 1 }) : null
  return { floor: s.floor, m: Math.max(0, m.hp) / m.maxHp, own: max ? hp / max : 0, essence: s.stats.essence, purse: s.essence, power: Math.log(survey(run).strength), share }
}

// The route's window value of `run` against `before` (runTally at the choice), `cleared` the rooms done. → { value, parts }
export function routeValue (before, run, cleared, w = ROUTE_WEIGHTS) {
  const after = runTally(run)
  const scale = tierScale(before.floor)
  const parts = {
    lost: run.state.death ? 1 : 0,
    monarch: before.m - after.m,
    own: before.own - after.own,
    essence: (after.essence - before.essence) / scale,
    cleared,
    power: after.power - before.power,
    purse: (after.purse - before.purse) / scale
  }
  return { value: r6(routeWindowOf(parts, w)), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r6(v)])) }
}
// A window label's value from its parts, by `w`.
export const routeWindowOf = (p, w = ROUTE_WEIGHTS) => -w.lost * p.lost - w.monarch * p.monarch - w.own * p.own + w.essence * p.essence + w.cleared * p.cleared +
  (w.power ?? 0) * (p.power ?? 0) + (w.purse ?? 0) * (p.purse ?? 0)
// A label to the end's value from its parts, by `w`.
export const routeEndOf = (p, w = ROUTE_END_WEIGHTS) => -w.lost * p.lost + w.rooms * p.rooms + w.floors * p.floors + w.monarch * p.monarch + w.own * p.own +
  w.souls * p.souls + w.won * p.won

// The route's value to the end of `run` (over) against `before` (runTally at the choice): lost 1 − the progress, the HP
// shares and souls at the end (none from a lost run). → { value, parts, share (the progress at the end), floor }
export function routeEndValue (before, run, w = ROUTE_END_WEIGHTS) {
  const s = run.state
  if (s.phase !== 'over') throw new Error(`${s.seed}: a route's value to the end, the run not over`)
  const won = s.result === 'victory'
  const b = run.battle
  const fell = !won && b ? { rank: currentNode(run)?.rank ?? 1, share: foeShare(b) } : null
  const share = progressOf({ result: s.result, floor: s.floor, rank: fell?.rank ?? 1, share: fell?.share ?? 0 })
  const m = monarchOf(s)
  const all = souls(s.party)
  const up = all.filter((u) => u.hp > 0)
  const max = all.reduce((n, u) => n + u.maxHp, 0)
  const parts = {
    lost: won ? 0 : 1 - share,
    rooms: (share - before.share) * routeRooms(),
    floors: (won ? s.floor + 1 : s.floor) - before.floor,
    monarch: won ? Math.max(0, m.hp) / m.maxHp : 0,
    own: won && max ? up.reduce((n, u) => n + u.hp, 0) / max : 0,
    souls: won ? up.length : 0,
    won: won ? 1 : 0
  }
  return { value: r6(routeEndOf(parts, w)), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r6(v)])), share: r6(share), floor: s.floor }
}

// A room done: back on the map from a room's battle or Shop, or through an altar; or the run over, the Monarch standing.
export const roomDone = (was, now, action, run) => (now === 'over' ? !run.state.death : now === 'map' && (was !== 'map' || action.type === 'node'))
