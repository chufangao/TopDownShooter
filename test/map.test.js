import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateFloor, nodeOf, RANKS, WIDTH } from '../src/sim/map.js'

const TYPES = ['fight', 'elite', 'reliquary', 'altar', 'rite', 'boss', 'siege']

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

test('500 seeded floors keep the rank, link and type rules', () => {
  for (let i = 0; i < 500; i++) {
    const floor = 1 + (i % 4)
    const last = floor === 4
    const map = generateFloor({ seed: 'map' + i, floor, last })
    const where = `seed ${i}`
    const ranks = Array.from({ length: RANKS }, (_, r) => map.nodes.filter((n) => n.rank === r))
    assert.equal(map.floor, floor)
    assert.equal(ranks[0].length, 1)
    assert.equal(ranks[0][0].id, map.start)
    assert.equal(ranks[0][0].type, 'start')
    assert.equal(ranks[RANKS - 1].length, 1)
    assert.equal(ranks[RANKS - 1][0].id, map.end)
    assert.equal(nodeOf(map, map.end).type, last ? 'boss' : 'elite', where)
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
    for (const type of ['reliquary', 'rite']) {
      const count = map.nodes.filter((n) => n.type === type && n.rank < RANKS - 2).length
      assert.ok(count >= 1 && count <= 2, `${where} ${type} ${count}`)
    }

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
