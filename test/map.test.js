import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateFloor, nodeOf, RANKS, WIDTH } from '../src/sim/map.js'
import { drawRoom, roomThreats, SENTRY_POSTS } from '../src/sim/spawn.js'
import { rowOf, colOf } from '../src/sim/unit.js'
import { unitDef } from '../src/content.js'
import { TUNING } from '../src/tuning.js'

// The room types: no Shop among them.
const TYPES = ['fight', 'elite', 'altar', 'boss', 'siege']

function reach (map, from, edges) {
  const seen = new Set([from])
  const queue = [from]
  while (queue.length) for (const id of edges(queue.shift())) if (!seen.has(id)) { seen.add(id); queue.push(id) }
  return seen
}

test('the same seed gives the same floor', () => {
  assert.deepEqual(generateFloor({ seed: 'm', floor: 2 }), generateFloor({ seed: 'm', floor: 2 }))
  assert.notDeepEqual(generateFloor({ seed: 'm', floor: 2 }), generateFloor({ seed: 'm', floor: 3 }))
})

test('500 seeded floors keep the rank, link and type rules, and no room is a Shop', () => {
  for (let i = 0; i < 500; i++) {
    const floor = 1 + (i % 4)
    const boss = floor <= 3
    const map = generateFloor({ seed: 'map' + i, floor, boss })
    const where = `seed ${i}`
    const ranks = Array.from({ length: RANKS }, (_, r) => map.nodes.filter((n) => n.rank === r))
    assert.equal(map.floor, floor)
    assert.equal(ranks[0].length, 1)
    assert.equal(ranks[0][0].id, map.start)
    assert.equal(ranks[0][0].type, 'start')
    assert.equal(ranks[RANKS - 1].length, 1)
    assert.equal(ranks[RANKS - 1][0].id, map.end)
    assert.equal(nodeOf(map, map.end).type, boss ? 'boss' : 'elite', where)
    assert.equal(nodeOf(map, map.end).next.length, 0)

    for (let r = 1; r < RANKS - 1; r++) {
      const rank = ranks[r]
      assert.ok(rank.length >= 2 && rank.length <= WIDTH, `${where} rank ${r} size`)
      assert.ok(rank.every((n) => TYPES.includes(n.type) && n.type !== 'boss'), `${where} rank ${r} types`)
      assert.ok(!rank.every((n) => n.type === rank[0].type && n.type !== 'fight'), `${where} rank ${r} all ${rank[0].type}`)
      assert.ok(rank.filter((n) => n.type === 'elite').length <= (r < 4 ? 0 : 1), `${where} rank ${r} elites`)
    }
    assert.ok(ranks[1].every((n) => n.type === 'fight'), `${where} rank 1 is all fights`)
    const late = ranks[RANKS - 2]
    assert.equal(late.filter((n) => n.type === 'altar').length, 1, `${where} one altar before the end`)
    assert.ok(!map.nodes.some((n) => n.type === 'shop'), `${where} no Shop room`)

    for (const n of map.nodes) {
      for (const id of n.next) assert.equal(nodeOf(map, id).rank, n.rank + 1, `${where} ${n.id} → ${id}`)
      if (n.rank > 0 && n.rank < RANKS - 1) assert.ok(n.next.length >= 1 && n.next.length <= 2, `${where} ${n.id} out-degree`)
    }
    const from = reach(map, map.start, (id) => nodeOf(map, id).next)
    const to = reach(map, map.end, (id) => map.nodes.filter((n) => n.next.includes(id)).map((n) => n.id))
    assert.equal(from.size, map.nodes.length, `${where} reachable from start`)
    assert.equal(to.size, map.nodes.length, `${where} every node reaches the end`)

    const edges = map.nodes.flatMap((n) => n.next.map((id) => [n, nodeOf(map, id)]))
    for (const [a, b] of edges) {
      for (const [c, d] of edges) {
        if (a.rank === c.rank) assert.ok((a.lane - c.lane) * (b.lane - d.lane) >= 0, `${where} ${a.id}→${b.id} crosses ${c.id}→${d.id}`)
      }
    }
  }
})

// Sentries (kinds marked `hold`) in the rooms: each wave's on its posts (the far row from the wings in, then the middle
// row's wings), so no walker of the wave stands behind one in its lane; none in floor 1's rooms before rank
// sentry.from (its first two); a room with one carries the sentries threat, and only such a room.
test('sentries stand on their posts off the walkers\' road, never in floor 1\'s first two rooms, and mark their rooms', () => {
  let sentries = 0
  for (let i = 0; i < 60; i++) {
    for (const floor of [1, 2, 3]) {
      const map = generateFloor({ seed: 'posts' + i, floor, boss: true })
      for (const node of map.nodes.filter((n) => ['fight', 'elite', 'siege', 'boss'].includes(n.type))) {
        const room = drawRoom('posts' + i, floor, node)
        const where = `seed ${i} floor ${floor} ${node.id} rank ${node.rank}`
        const waves = [room.foes, ...(room.waves ?? []).map((w) => w.foes)]
        const held = waves.flat().filter((f) => unitDef(f.id).hold)
        assert.equal(roomThreats(room).has('sentries'), held.length > 0, where)
        if (floor === 1 && node.rank < TUNING.spawn.sentry.from) assert.equal(held.length, 0, `${where}: a sentry before rank ${TUNING.spawn.sentry.from}`)
        sentries += held.length
        for (const foes of waves) {
          const posts = foes.filter((f) => unitDef(f.id).hold)
          if (posts.length <= SENTRY_POSTS.length) assert.ok(posts.every((f) => SENTRY_POSTS.includes(f.slot)), `${where}: ${posts.map((f) => f.slot)}`)
          for (const f of foes.filter((x) => !unitDef(x.id).hold)) {
            assert.ok(!posts.some((p) => colOf(p.slot) === colOf(f.slot) && rowOf(p.slot) < rowOf(f.slot)), `${where}: ${f.id} at ${f.slot} behind a sentry`)
          }
        }
      }
    }
  }
  assert.ok(sentries > 0, 'sentries come')
  // The posts: the far row, then the middle row's wings, never the front row.
  assert.ok(SENTRY_POSTS.every((slot) => rowOf(slot) >= 1) && SENTRY_POSTS.slice(0, 7).every((slot) => rowOf(slot) === 2))
})
