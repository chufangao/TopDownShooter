import { createRng } from './rng.js'

// A floor is a small DAG of ranks: start → 5 ranks of 2–3 rooms → elite (or the boss on the last floor).

export const RANKS = 7

const MID_TYPES = ['fight', 'elite', 'treasure', 'campfire']
const MID_WEIGHTS = [5, 1.5, 1, 1]
const LATE_TYPES = ['fight', 'elite', 'treasure']
const LATE_WEIGHTS = [3, 1, 0.5]

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

function assignTypes (rng, ranks, last) {
  const pick = (types, weights) => rng.weighted(types, weights)
  for (const n of ranks[1]) n.type = 'fight'
  for (let r = 2; r <= 4; r++) {
    let elite = false
    for (const n of ranks[r]) {
      n.type = pick(MID_TYPES, MID_WEIGHTS)
      if (n.type === 'elite' && elite) n.type = 'fight'
      if (n.type === 'elite') elite = true
    }
  }
  const mid = ranks.slice(2, 5).flat()
  const treasures = mid.filter((n) => n.type === 'treasure')
  for (const n of treasures.slice(2)) n.type = 'fight'
  if (!treasures.length) {
    const fights = mid.filter((n) => n.type === 'fight')
    rng.pick(fights.length ? fights : mid).type = 'treasure'
  }
  for (let r = 2; r <= 4; r++) {
    const rank = ranks[r]
    if (rank.every((n) => n.type === rank[0].type)) rng.pick(rank).type = rank[0].type === 'fight' ? 'campfire' : 'fight'
  }
  const late = ranks[5]
  const fire = rng.int(late.length)
  let elite = false
  late.forEach((n, i) => {
    n.type = i === fire ? 'campfire' : pick(LATE_TYPES, LATE_WEIGHTS)
    if (n.type === 'elite' && elite) n.type = 'fight'
    if (n.type === 'elite') elite = true
  })
  ranks[RANKS - 1][0].type = last ? 'boss' : 'elite'
  ranks[0][0].type = 'start'
}

export function generateFloor ({ seed, floor = 1, last = false }) {
  const rng = createRng(seed).stream('map' + floor)
  const ranks = []
  for (let r = 0; r < RANKS; r++) {
    const n = r === 0 || r === RANKS - 1 ? 1 : 2 + rng.int(2)
    ranks.push(Array.from({ length: n }, (_, i) => ({ id: `${r}.${i}`, rank: r, lane: i + (3 - n) / 2, type: null, next: [] })))
  }
  for (let r = 0; r < RANKS - 1; r++) {
    for (const [i, j] of link(rng, ranks[r].length, ranks[r + 1].length)) {
      const from = ranks[r][i]
      const to = ranks[r + 1][j].id
      if (!from.next.includes(to)) from.next.push(to)
    }
  }
  for (const rank of ranks) for (const n of rank) n.next.sort()
  assignTypes(rng, ranks, last)
  return { floor, nodes: ranks.flat(), start: ranks[0][0].id, end: ranks[RANKS - 1][0].id }
}

export const nodeOf = (map, id) => map.nodes.find((n) => n.id === id)
