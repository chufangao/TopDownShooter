import { makeUnit } from '../src/sim/stats.js'
import { autoPlace } from '../src/sim/formation.js'
import { createRng } from '../src/sim/rng.js'
import { UNIT_LIST, TUNING } from '../src/content/index.js'

export function team (ids, { side = 'party', lvl = 2, uid = side === 'party' ? 1 : 100 } = {}) {
  return autoPlace(ids.map((id, i) => makeUnit(id, { uid: uid + i, lvl, side })))
}

export const START = ['tomb_knight', 'bone_chanter', 'frost_sprite']

// A plausible encounter for a floor: 3 foes (4 on odd seeds, as an elite), or the boss on floor 4.
export function encounter (seed, floor) {
  const rng = createRng(seed).stream('encounter')
  const lvl = Math.max(1, Math.round(1 + (floor - 1) * TUNING.spawn.levelPerFloor))
  if (floor === 4 && rng.chance(0.25)) {
    const boss = team(['hollow_sovereign'], { side: 'foe', lvl })
    boss[0].slot = 1
    return { foes: boss, boss: true }
  }
  const pool = UNIT_LIST.filter((u) => u.spawn && u.spawn.minFloor <= floor)
  const n = rng.chance(0.5) ? 3 : 4
  const ids = Array.from({ length: n }, () => rng.weighted(pool, pool.map((u) => u.spawn.weight)).id)
  return { foes: team(ids, { side: 'foe', lvl: lvl + (n === 4 ? 1 : 0) }), boss: false }
}
