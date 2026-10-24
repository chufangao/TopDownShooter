// What the bench fights: the rooms (paired: every config on every room) and the configs (each relic, by its holder rule).
import { RELIC_LIST, relicDef, SOULS, EXTRA } from './lib.mjs'

export const BUDGET = Number(process.env.BENCH_BUDGET ?? 20000)

// 8 seeds × 2 floor-2 rooms: a mid fight (ranks 6–9) and a late room (an elite of rank ≥ 8 on odd seeds, a rank-11/12
// fight on even ones), the hard rooms where the defensive relics can show.
export const ROOMS = [
  { seed: 'b1', node: '7.1' }, { seed: 'b1', node: '11.0' },
  { seed: 'b2', node: '8.0' }, { seed: 'b2', node: '12.0' },
  { seed: 'b3', node: '9.0' }, { seed: 'b3', node: '12.0' },
  { seed: 'b4', node: '6.1' }, { seed: 'b4', node: '11.1' },
  { seed: 'b5', node: '7.0' }, { seed: 'b5', node: '8.2' },
  { seed: 'b6', node: '8.0' }, { seed: 'b6', node: '12.1' },
  { seed: 'b7', node: '9.1' }, { seed: 'b7', node: '9.0' },
  { seed: 'b8', node: '6.0' }, { seed: 'b8', node: '12.1' }
]

// Soul indices in SOULS.
const KNIGHT = 0 // tomb_knight: highest-ATK melee soul, the front line, the tank
const DRAKE = 1 // ember_drake: the ranged soul
const WARDEN = 2 // hive_warden: the healer

// Economy relics: no battle effect.
export const ECONOMY = ['binding_chain', 'ossuary_key', 'grave_ledger', 'rite_candle', 'tithe_bowl', 'soul_lantern']
const COMMAND = { bone_horn: 1, muster_roll: 1, grave_banner: 1, legion: 2 }
const BOTH = new Set(['whetstone', 'glass_crown', 'reapers_hunger', 'overwatch']) // stat / rule relics read like blow relics
const TO = {
  heartwood: [KNIGHT], arise: [WARDEN, DRAKE], undying: [KNIGHT], mimicry: [KNIGHT], seven_league_boots: [DRAKE],
  last_candle: [DRAKE], hold_the_line: [KNIGHT], trample: [KNIGHT]
}
const KIN_PARTY = {
  gossamer_standard: [SOULS[0], SOULS[1], EXTRA[0]], // a Fae (frost_sprite) for the Warden
  brass_standard: [SOULS[0], SOULS[1], { id: 'clockwork_page', tracks: [2, 1] }] // a Construct for the Warden
}

// The holders a piece relic is tried on (the better one reported).
export function holdersOf (id) {
  const d = relicDef(id)
  if (TO[id]) return TO[id]
  if (BOTH.has(id) || d.on === 'blow' || d.on === 'kill') return [KNIGHT, DRAKE]
  if (d.on === 'struck' || d.on === 'fall' || d.on === 'wave' || d.mods) return [KNIGHT]
  return [KNIGHT]
}

// Every config: { key, relic, holder, base (the config key it pairs against), cfg }.
export function configs () {
  const out = [{ key: 'base', relic: null, holder: null, base: null, cfg: {} }]
  const ariseOn = WARDEN
  out.push({ key: 'base:arise', relic: null, holder: null, base: null, cfg: { held: { [ariseOn]: ['arise'] } }, note: 'Arise on the Warden, the pair for needsArise and Grave Powder' })
  for (const [id, kinds] of Object.entries(KIN_PARTY)) out.push({ key: `base:${id}`, relic: null, holder: null, base: null, cfg: { kinds } })
  for (const r of RELIC_LIST) {
    const id = r.id
    if (ECONOMY.includes(id)) continue
    if (COMMAND[id]) {
      const kinds = [...SOULS, ...EXTRA.slice(0, COMMAND[id])]
      out.push({ key: id, relic: id, holder: `run (+${kinds.slice(3).map((k) => k.id).join(', +')})`, base: 'base', cfg: { kinds, relics: [id] } })
    } else if (KIN_PARTY[id]) {
      out.push({ key: id, relic: id, holder: `run (party with ${KIN_PARTY[id][2].id})`, base: `base:${id}`, cfg: { kinds: KIN_PARTY[id], relics: [id] } })
    } else if (r.needsArise) {
      out.push({ key: id, relic: id, holder: 'run (with Arise on hive_warden)', base: 'base:arise', cfg: { held: { [ariseOn]: ['arise'] }, relics: [id] } })
    } else if (id === 'grave_powder') {
      out.push({ key: id, relic: id, holder: 'tomb_knight (with Arise on hive_warden)', base: 'base:arise', cfg: { held: { [ariseOn]: ['arise'], [KNIGHT]: [id] } } })
    } else if (r.run) {
      out.push({ key: id, relic: id, holder: 'run', base: 'base', cfg: { relics: [id] } })
    } else {
      for (const h of holdersOf(id)) out.push({ key: `${id}@${SOULS[h].id}`, relic: id, holder: SOULS[h].id, base: 'base', cfg: { held: { [h]: [id] } } })
    }
  }
  return out
}
