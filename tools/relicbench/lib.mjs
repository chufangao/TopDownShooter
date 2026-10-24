// The relic bench's shared pieces: floor-2 rooms from a real run state, the battles each config fights, one solve.
// The game, read from the repo this file sits in (tools/relicbench/ → src/).
const R = new URL('../../src', import.meta.url).pathname
const { createRun, battleSetup, frontier, bossPool, poolFloor, drawRoom, bossFor, varyRoutes, answerArmy, ariseOf, monarchHp, monarchOf, souls, fielded, isRunRelic } = await import(`${R}/sim/run.js`)
const { generateFloor } = await import(`${R}/sim/map.js`)
const { monarchSlot, makeUnit, isRunPath } = await import(`${R}/sim/unit.js`)
const { CAMP_LIST, relicDef, RELIC_LIST, unitDef } = await import(`${R}/content.js`)
const { createRng } = await import(`${R}/sim/rng.js`)
const { createBattle } = await import(`${R}/sim/turns.js`)
const { solve, scoreOf, tallyOf } = await import(`${R}/sim/solver.js`)
const { TUNING } = await import(`${R}/tuning.js`)
export { RELIC_LIST, relicDef, TUNING, unitDef, isRunRelic }

// The party: the Monarch and Command's 3 souls at level 4 (3 tiers each), the extras a Command relic fields.
export const SOULS = [
  { id: 'tomb_knight', tracks: [2, 1] }, // Vanguard, melee front line (Bulwark II, Reaver I)
  { id: 'ember_drake', tracks: [2, 1] }, // Ranger, ranged, highest ATK (Pyroclast II, Skyhunter I)
  { id: 'hive_warden', tracks: [2, 1] } // Warden, healer (Brood Mother II: 2 summoned wardens; Chitin I)
]
export const EXTRA = [{ id: 'frost_sprite', tracks: [2, 1] }, { id: 'bone_chanter', tracks: [1, 2] }]

// A floor-2 state for `seed` as enterFloor + openFloor make it, the souls `kinds` on the camp's frontier, `relics` owned.
export function floorState (seed, kinds, relics = []) {
  const run = createRun({ seed, start: ['tomb_knight'] })
  const s = run.state
  s.party = s.party.filter((u) => u.uid === 0)
  let uid = 1
  for (const k of kinds) s.party.push(makeUnit(k.id, { uid: uid++, lvl: Math.floor(2 + 0.67 * (k.tracks[0] + k.tracks[1])), tracks: k.tracks }))
  s.nextUid = uid
  s.floor = 2
  s.map = generateFloor({ seed, floor: 2, boss: bossPool(2).length > 0 })
  s.camp = createRng(seed).stream('camp|2').pick(CAMP_LIST.filter((c) => c.floor === poolFloor(2))).id
  monarchOf(s).slot = monarchSlot(s.camp)
  const pieces = souls(s.party)
  frontier(s.camp, pieces).forEach((slot, i) => { pieces[i].slot = slot })
  const army = souls(s.party)
  const boss = bossFor(seed, 2, army)
  for (const n of s.map.nodes) if (['fight', 'elite', 'boss', 'siege'].includes(n.type)) Object.assign(n, drawRoom(seed, 2, n, { boss: boss?.id }))
  varyRoutes(s)
  answerArmy(s, army)
  for (const id of relics) {
    const gain = monarchHp({ ...s, relics: [...s.relics, id] }) - monarchHp(s)
    s.relics.push(id)
    const m = monarchOf(s)
    m.maxHp += gain
    m.hp += gain
  }
  return run
}

// The rooms a seed gives: its floor-2 fights and elites of ranks lo..hi (the room-draw is independent of the party).
export function roomsOf (seed, lo = 6, hi = 12) {
  const run = floorState(seed, SOULS)
  return run.state.map.nodes.filter((n) => (n.type === 'fight' || n.type === 'elite') && n.rank >= lo && n.rank <= hi)
    .map((n) => ({ seed, node: n.id, type: n.type, rank: n.rank, foes: n.foes.length + (n.waves ?? []).reduce((a, w) => a + w.foes.length, 0) }))
}

// The battle setup for a config: { kinds, held: { [soulIndex]: [relicIds] }, relics: [owned ids] }, in room `room`.
export function setupFor (room, cfg) {
  const kinds = cfg.kinds ?? SOULS
  const owned = [...(cfg.relics ?? []), ...Object.values(cfg.held ?? {}).flat()]
  const run = floorState(room.seed, kinds, owned)
  const s = run.state
  for (const [i, ids] of Object.entries(cfg.held ?? {})) souls(s.party)[i].relics = ids.slice()
  s.at = room.node
  // battleSetup reads the node's rank only for where the walk came from: none.
  return battleSetup(run)
}

// One solve of a config in a room → the record.
export function measure (room, cfg, budget) {
  const setup = setupFor(room, cfg)
  const battle = createBattle({ ...setup, quiet: true })
  const t0 = Date.now()
  const r = solve(battle, { budget, cap: Infinity, slack: false })
  const end = r.end
  const before = tallyOf(battle)
  const foesLeft = (b) => b.units.reduce((n, u) => n + (u.side === 'foe' && u.hp > 0 ? u.hp : 0), 0) + b.reserve.reduce((n, u) => n + u.hp, 0)
  const outcome = r.won ? 'won' : end.over ? 'lost' : 'open'
  // The composite: the solver's end value where the battle ended (a loss −10), and where the budget cut the line open,
  // the solver's own board score of where it stood (scoreOf: the value so far, less the foes' HP left and the danger).
  const score = outcome === 'open' ? scoreOf(end, before) : r.won ? r.value : -10
  const m = end.monarch
  const start = battle.units.filter((u) => u.side === 'party' && u !== battle.monarch && !u.shadow && u.hp > 0)
  const maxOwn = start.reduce((a, u) => a + u.maxHp, 0)
  const kept = end.units.filter((u) => u.side === 'party' && u !== end.monarch && !u.shadow && start.some((b) => b.uid === u.uid) && u.hp > 0).reduce((a, u) => a + u.hp, 0)
  return {
    won: r.won ? 1 : 0,
    outcome,
    score,
    foes: before.foes ? foesLeft(end) / before.foes : 0,
    value: r.won ? r.value : -TUNING_LOST,
    turns: end.turn,
    monarch: m ? Math.max(0, m.hp) / m.maxHp : 0,
    souls: maxOwn ? kept / maxOwn : 0,
    raised: end.raised ?? 0,
    plans: r.stats.plans,
    level: r.stats.level,
    ms: Date.now() - t0
  }
}
const TUNING_LOST = 10
