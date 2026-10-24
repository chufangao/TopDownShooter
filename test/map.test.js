import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateFloor, nodeOf, RANKS, WIDTH } from '../src/sim/map.js'
import { drawRoom, roomThreats, SENTRY_POSTS, groundOpen, shapeWalls } from '../src/sim/spawn.js'
import { rowOf, colOf, deployTile, tileY, tileX, tileAt, wallTiles, monarchSlot, CAMP_ROWS, DEPTH, LANES, ROWS, TILES } from '../src/sim/unit.js'
import { unitDef, SHAPES, CAMP_LIST } from '../src/content.js'
import { field } from '../src/sim/field.js'
import { createRng } from '../src/sim/rng.js'
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

// A battle room's ground (spawn.js roomGround): none in a boss's room and in floor 1's rooms before rank shape.from; a
// cover, a wall in front of each sentry, where its first formation holds one; a choke only from rank shape.choke. Its
// walls stand on the open ground and the foes' rows below the top edge, never on a foe's slot; in every camp every
// other tile there (every slot, post and entry) keeps a road to the Monarch, so no shape seals the camp and a piece of
// yours walks to every foe. Every shape comes.
test('a room\'s ground: shapes by rank and sentries, walls off the camp, the top edge and every foe, every road open in every camp', () => {
  const sh = TUNING.spawn.shape
  const seen = new Set()
  const roads = (walls) => CAMP_LIST.map((camp) => field({ root: deployTile('party', monarchSlot(camp.id)), walls: [...wallTiles(camp.id), ...walls] }))
  for (let i = 0; i < 40; i++) {
    for (const floor of [1, 2, 3]) {
      const map = generateFloor({ seed: 'ground' + i, floor, boss: true })
      for (const node of map.nodes.filter((n) => ['fight', 'elite', 'siege', 'boss'].includes(n.type))) {
        const room = drawRoom('ground' + i, floor, node)
        const where = `seed ${i} floor ${floor} ${node.id} rank ${node.rank} ${room.shape}`
        assert.ok(SHAPES[room.shape] && Array.isArray(room.walls), where)
        seen.add(room.shape)
        const sentries = room.foes.filter((f) => unitDef(f.id).hold)
        if (node.type === 'boss' || (floor === 1 && node.rank < sh.from)) assert.equal(room.shape, 'none', where)
        else if (sentries.length) assert.ok(room.shape === 'cover' || room.shape === 'none', where)
        if (room.shape === 'choke') assert.ok(node.rank >= sh.choke, where)
        if (room.shape === 'none') assert.deepEqual(room.walls, [], where)
        if (room.shape === 'cover') assert.ok(room.walls.every((t) => sentries.some((f) => deployTile('foe', f.slot) === t + LANES)), `${where}: a wall in front of a sentry`)
        // Off the camp and the top edge, and off every tile a foe of the first formation stands on.
        assert.ok(room.walls.every((t) => tileY(t) >= CAMP_ROWS && tileY(t) < DEPTH - 1), where)
        const starts = new Set(room.foes.map((f) => deployTile('foe', f.slot)))
        assert.ok(room.walls.every((t) => !starts.has(t)), `${where}: a wall on a foe`)
        // Every road open: each foe's tile, each sentry post and each entry on the top edge reaches the Monarch.
        const shut = new Set(room.walls)
        const must = [...starts, ...SENTRY_POSTS.map((slot) => deployTile('foe', slot)), ...[...Array(LANES).keys()].map((x) => tileAt(x, DEPTH - 1))].filter((t) => !shut.has(t))
        for (const f of roads(room.walls)) assert.ok(must.every((t) => f.dist[t] < Infinity), `${where}: a road shut`)
      }
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(SHAPES).sort(), 'every shape comes')
  // The shapes as drawn: a choke one gap in a wall across the open ground, the gap off the edges; the pillars off the
  // edges; a corridor two walls down either side of a lane off the edges; a wall across the row ahead of seven sentries
  // would seal the far row, and is refused.
  const rng = createRng('shapes').stream('s')
  for (let k = 0; k < 20; k++) {
    const choke = shapeWalls('choke', rng)
    const gap = [...Array(LANES).keys()].find((x) => !choke.includes(tileAt(x, CAMP_ROWS)))
    assert.ok(choke.length === LANES - 1 && choke.every((t) => tileY(t) === CAMP_ROWS) && gap > 0 && gap < LANES - 1 && groundOpen(choke))
    const corridor = shapeWalls('corridor', rng)
    const sides = [...new Set(corridor.map(tileX))].sort((a, b) => a - b)
    assert.ok(sides.length === 2 && sides[1] - sides[0] === 2 && corridor.length === 2 * TUNING.spawn.shape.corridor && groundOpen(corridor))
  }
  const pillars = shapeWalls('pillars', rng)
  assert.ok(pillars.length === 4 && pillars.every((t) => tileX(t) > 0 && tileX(t) < LANES - 1) && groundOpen(pillars))
  assert.equal(groundOpen(shapeWalls('cover', rng, SENTRY_POSTS.slice(0, LANES))), false)
  assert.equal(groundOpen([tileAt(3, 2)]), false, 'never in the camp')
  assert.equal(groundOpen([...Array(LANES).keys()].map((x) => tileAt(x, CAMP_ROWS))), false, 'never a wall with no gap')
  assert.ok(TILES > 0 && ROWS > 0)
})
