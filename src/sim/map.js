// A floor is a DAG of ranks: start → 14 ranks of 2–4 rooms → a boss's room (a floor with a boss: every floor of the
// run, redesign.md §4.7) or an elite (the deep's), so a walk through it is 15 rooms long. From floor SIEGE_FLOOR one or two of the late ranks' fights are
// sieges: one battle of three waves, with no prep between them.
import { createRng } from './rng.js'

export const RANKS = 16
export const WIDTH = 4 // the most rooms in a rank

// No room is a Shop (DESIGN Next, Step 3, 2026-10-18): the Shop is the floor's shelf, open between battles (run.js
// stockShop). The Shop rooms' weight went to the fights and the altars: in the middle 5 → fight 4.5, altar 0.5 (were fight
// 5, Shop 5, altar 1), in the rank before the last 1 → fight (was 3, Shop 1). Placeholders until the balance pass.
const MID_TYPES = ['fight', 'elite', 'altar']
const MID_WEIGHTS = [9.5, 1.5, 1.5]
const LATE_TYPES = ['fight', 'elite']
const LATE_WEIGHTS = [4, 1]
const ELITE_FROM = 4 // the first rank an elite may stand in
const SIEGE_FLOOR = 3 // the first floor with sieges
export const SIEGE_RANK = 9 // the first rank a siege may stand in

// Non-crossing links between two ordered ranks: a monotone staircase from (0,0) to (a-1,b-1), with
// an optional extra edge filling each diagonal step. Every node gets ≥1 link each way, out-degree ≤ 2.
function link (rng, a, b) {
  if (a === 1 || b === 1) {
    const out = []
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) out.push([i, j])
    return out
  }
  for (;;) {
    let i = 0
    let j = 0
    const edges = [[0, 0]]
    while (i < a - 1 || j < b - 1) {
      const moves = []
      if (i < a - 1 && j < b - 1) moves.push('both')
      if (i < a - 1) moves.push('i')
      if (j < b - 1) moves.push('j')
      const m = rng.pick(moves)
      if (m === 'both' && rng.chance(0.5)) edges.push(rng.chance(0.5) ? [i, j + 1] : [i + 1, j])
      if (m !== 'j') i++
      if (m !== 'i') j++
      edges.push([i, j])
    }
    const out = new Array(a).fill(0)
    for (const [x] of edges) out[x]++
    if (out.every((n) => n <= 2)) return edges
  }
}

// Rank 1 is all fights; the middle ranks mix rooms, with no elite before ELITE_FROM, at most one elite a
// rank, and no rank all of one kind but fights; the rank before the last always holds exactly one altar.
function assignTypes (rng, ranks, boss) {
  const pick = (types, weights) => rng.weighted(types, weights)
  const late = RANKS - 2
  for (const n of ranks[1]) n.type = 'fight'
  for (let r = 2; r < late; r++) {
    let elite = false
    for (const n of ranks[r]) {
      n.type = pick(MID_TYPES, MID_WEIGHTS)
      if (n.type === 'elite' && (elite || r < ELITE_FROM)) n.type = 'fight'
      if (n.type === 'elite') elite = true
    }
  }
  for (let r = 2; r < late; r++) {
    const rank = ranks[r]
    if (rank.every((n) => n.type === rank[0].type && n.type !== 'fight')) rng.pick(rank).type = 'fight'
  }
  const altar = rng.int(ranks[late].length)
  let elite = false
  ranks[late].forEach((n, i) => {
    n.type = i === altar ? 'altar' : pick(LATE_TYPES, LATE_WEIGHTS)
    if (n.type === 'elite' && elite) n.type = 'fight'
    if (n.type === 'elite') elite = true
  })
  ranks[RANKS - 1][0].type = boss ? 'boss' : 'elite'
  ranks[0][0].type = 'start'
}

// From SIEGE_FLOOR, one or two fights of the late ranks (SIEGE_RANK to the altar's) become sieges, never two
// in a rank: a rank keeps a room of another kind, so it is never all sieges.
function assignSieges (rng, ranks, floor) {
  if (floor < SIEGE_FLOOR) return
  const options = ranks.slice(SIEGE_RANK, RANKS - 1).map((rank) => rank.filter((n) => n.type === 'fight')).filter((l) => l.length)
  for (const fights of rng.shuffle(options).slice(0, 1 + rng.int(2))) rng.pick(fights).type = 'siege'
}

// `boss`: whether the floor ends in a boss's room (run.js bossPool), else in an elite.
export function generateFloor ({ seed, floor = 1, boss = false }) {
  const rng = createRng(seed).stream('map' + floor)
  const ranks = []
  for (let r = 0; r < RANKS; r++) {
    const n = r === 0 || r === RANKS - 1 ? 1 : 2 + rng.int(WIDTH - 1)
    ranks.push(Array.from({ length: n }, (_, i) => ({ id: `${r}.${i}`, rank: r, lane: i + (WIDTH - n) / 2, type: null, next: [] })))
  }
  for (let r = 0; r < RANKS - 1; r++) {
    for (const [i, j] of link(rng, ranks[r].length, ranks[r + 1].length)) {
      const from = ranks[r][i]
      const to = ranks[r + 1][j].id
      if (!from.next.includes(to)) from.next.push(to)
    }
  }
  for (const rank of ranks) for (const n of rank) n.next.sort()
  assignTypes(rng, ranks, boss)
  assignSieges(rng, ranks, floor)
  return { floor, nodes: ranks.flat(), start: ranks[0][0].id, end: ranks[RANKS - 1][0].id }
}

export const nodeOf = (map, id) => map.nodes.find((n) => n.id === id)
