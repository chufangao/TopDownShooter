import test from 'node:test'
import assert from 'node:assert/strict'
import { generateFloor, findPath, routeThrough, walkable, tileAt, TILE } from '../../src/sim/dungeon.js'

// M0's gate (§10): assert entry → exit reachable across 500 seeded generations.
test('entry reaches exit, and every node, across 500 seeded floors', () => {
  for (let s = 0; s < 500; s++) {
    const d = generateFloor({ seed: s, floor: 1 + (s % 8) })
    assert.ok(d.reachable, `seed ${s}: entry → exit or a node was unreachable`)
    assert.ok(findPath(d, d.entry, d.exit), `seed ${s}: no path to the exit`)
    for (const n of d.nodes) assert.ok(walkable(d, n.x, n.y), `seed ${s}: node ${n.type} is not on a walkable tile`)
  }
})

test('the same seed and floor produce the identical floor', () => {
  const a = generateFloor({ seed: 'run-42', floor: 3 })
  const b = generateFloor({ seed: 'run-42', floor: 3 })
  assert.deepEqual(Array.from(a.tiles), Array.from(b.tiles))
  assert.deepEqual(a.nodes, b.nodes)
  assert.deepEqual(a.entry, b.entry)
})

test('floors are independent streams — floor 3 does not depend on floor 2', () => {
  const a = generateFloor({ seed: 'run-42', floor: 3 })
  const b = generateFloor({ seed: 'run-42', floor: 3, boss: true })
  assert.deepEqual(Array.from(a.tiles), Array.from(b.tiles), 'the boss flag must not shift the layout')
  assert.equal(b.nodes.at(-1).type, 'boss')
})

test('different seeds produce different floors', () => {
  const a = generateFloor({ seed: 1 })
  const b = generateFloor({ seed: 2 })
  assert.notDeepEqual(Array.from(a.tiles), Array.from(b.tiles))
})

test('node counts land in the designed 14–22 band, deeper floors denser', () => {
  for (let s = 0; s < 60; s++) {
    const shallow = generateFloor({ seed: s, floor: 1 })
    assert.ok(shallow.nodes.length >= 14 && shallow.nodes.length <= 22,
      `seed ${s}: floor 1 had ${shallow.nodes.length} nodes`)
  }
  const deep = Array.from({ length: 40 }, (_, s) => generateFloor({ seed: s, floor: 8 }).nodes.length)
  const shallow = Array.from({ length: 40 }, (_, s) => generateFloor({ seed: s, floor: 1 }).nodes.length)
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
  assert.ok(mean(deep) > mean(shallow), 'floor 8 should be denser than floor 1')
})

test('every walkable tile is fenced by walls, never by void', () => {
  for (let s = 0; s < 50; s++) {
    const d = generateFloor({ seed: s })
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        if (!walkable(d, x, y)) continue
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const t = tileAt(d, x + dx, y + dy)
          assert.notEqual(t, TILE.VOID, `seed ${s}: floor at ${x},${y} exposed to void`)
        }
      }
    }
  }
})

test('entry is a door and exit is stairs', () => {
  const d = generateFloor({ seed: 7 })
  assert.equal(tileAt(d, d.entry.x, d.entry.y), TILE.DOOR)
  assert.equal(tileAt(d, d.exit.x, d.exit.y), TILE.STAIRS)
})

test('findPath returns a contiguous walkable path, or null', () => {
  const d = generateFloor({ seed: 11 })
  const path = findPath(d, d.entry, d.exit)
  assert.deepEqual(path[0], d.entry)
  assert.deepEqual(path.at(-1), d.exit)
  for (let i = 1; i < path.length; i++) {
    const step = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y)
    assert.equal(step, 1, 'path steps must be orthogonal and adjacent')
    assert.ok(walkable(d, path[i].x, path[i].y))
  }
  assert.equal(findPath(d, d.entry, { x: 0, y: 0 }), null, 'the void is not reachable')
})

test('the route visits every node and finishes at the exit', () => {
  const d = generateFloor({ seed: 3, floor: 2 })
  const legs = routeThrough(d)
  assert.equal(legs.length, d.nodes.length + 1)
  assert.equal(legs.at(-1).to.type, 'exit')
  const visited = new Set(legs.slice(0, -1).map((l) => `${l.to.x},${l.to.y}`))
  for (const n of d.nodes) assert.ok(visited.has(`${n.x},${n.y}`), `node ${n.type} was never visited`)
})

test('the floor is plain data — it serialises for a save and a replay', () => {
  const d = generateFloor({ seed: 5 })
  const round = JSON.parse(JSON.stringify({ ...d, tiles: Array.from(d.tiles) }))
  assert.deepEqual(round.nodes, d.nodes)
  assert.equal(round.tiles.length, d.w * d.h)
})
