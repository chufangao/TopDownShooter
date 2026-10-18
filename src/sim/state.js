// The run's state as every part of the run reads it: slots, souls, run stats from relics, the Monarch's HP and Command,
// the ascension ladder's multipliers. The lowest of run.js's parts: it imports none of them.
import { TUNING } from '../tuning.js'
import { relicDef } from '../content.js'
import { onField, isRunPath, cellsOf } from './unit.js'
import { grantsArise, unhealable } from './rules.js'

export const MONARCH_UID = 0
// The slot of a soul in the ossuary: kept, not fighting.
export const OSSUARY = -1
export const BATTLE_NODES = ['fight', 'elite', 'boss', 'siege']

// A per-floor list's entry for `floor` (1-based; its last for every floor past it).
export const at = (list, floor) => list[Math.min(floor, list.length) - 1]

const relicDefs = (s) => s.relics.map(relicDef)

export { isRunPath }
// A run-level stat: `base` with every owned relic's mods on `paths` (one, or several summed as one), as statsOf applies.
export function runStat (s, paths, base) {
  const on = [paths].flat()
  let add = 0
  let mul = 1
  let set = null
  for (const r of relicDefs(s)) {
    for (const m of r.mods ?? []) {
      if (!on.includes(m.path)) continue
      if (m.op === 'add') add += m.v
      else if (m.op === 'mul') mul *= m.v
      else if (m.op === 'set') set = set === null ? m.v : Math.max(set, m.v)
    }
  }
  return set ?? (base + add) * mul
}
export const relicCount = (s, id) => s.relics.reduce((n, x) => n + (x === id), 0)
// Whether relic `id` is a run relic (it works unheld); every other relic is a piece relic.
export const isRunRelic = (id) => !!relicDef(id).run
// The piece relics owned and held by no soul, a copy each, in the order bought.
export function unheld (s) {
  const left = s.relics.filter((id) => !isRunRelic(id))
  for (const u of s.party) {
    for (const id of u.relics ?? []) {
      const i = left.indexOf(id)
      if (i >= 0) left.splice(i, 1)
    }
  }
  return left
}
// Whether soul `u` (never the Monarch) may take an unheld copy of piece relic `relic`, holding none of it yet.
export const canHold = (s, relic, u) => !!u && !isMonarch(u) && s.party.includes(u) && !(u.relics ?? []).includes(relic) && unheld(s).includes(relic)
// Whether the run owns an Arise relic (Arise or a variant): only then is a relic that needs one stocked.
export const ariseHeld = (s) => s.relics.some(grantsArise)
// Arise's reach and tier for any holder: TUNING.arise's with the run relics' mods, never below 0 (a variant adds its own
// reach in battle).
export const ariseOf = (s) => ({
  domain: Math.max(0, runStat(s, 'arise.domain', TUNING.arise.domain)),
  tier: Math.max(0, runStat(s, 'arise.tier', TUNING.arise.tier))
})
export const relicTier = (id) => relicDef(id).tier
// Hollow Court: the shadows it reaped (`reap` > 0) still standing when the last battle was won; each pays its essence again.
export const reapedShadows = (run) => run.battle && run.battle.winner === 'party'
  ? run.battle.units.filter((u) => u.reap > 0 && u.side === 'party' && u.hp > 0) : []
// Whether nothing may heal the Monarch: while the run owns Court of Bone.
export const unhealed = (s) => unhealable(s.relics)
// The field cap counts the souls fielded, the roster every soul held: the Monarch takes no room in either.
// The base Command: TUNING.party.field, and fieldPerFloor more a floor down to the Sovereign's.
export const baseField = (s) => TUNING.party.field + TUNING.party.fieldPerFloor * (Math.min(s.floor, TUNING.run.floors) - 1)
// The Monarch's Command: its base and its Command relics' adds, uncapped (the field is capped by the board: fieldCap).
export const commandOf = (s) => runStat(s, 'run.command', baseField(s))
export const fieldCap = (run) => Math.min(TUNING.army.board, commandOf(run.state))
export const rosterCap = (run) => runStat(run.state, 'run.roster', TUNING.party.roster)
export const soulCount = (party) => souls(party).length
export const fielded = (party) => party.filter(onField)
export const inOssuary = (party) => party.filter((u) => !onField(u))
export const isMonarch = (u) => u.uid === MONARCH_UID
export const monarchOf = (s) => s.party.find(isMonarch)
// The party without the Monarch: what the caps, the ossuary and the offers count.
export const souls = (party) => party.filter((u) => !isMonarch(u))

// The camp cells the fielded pieces cover, the Monarch's seat among them, but `except`'s.
export function takenBy (s, except = []) {
  const out = new Set()
  for (const u of s.party) if (onField(u) && !except.includes(u)) for (const c of cellsOf(u)) out.add(c)
  return out
}

// ── the Monarch ──────────────────────────────────────────────────────────────────────────────────

// The Monarch's max HP: its base (monarchBase) and its HP relics' adds; nothing else raises it.
export const monarchHp = (s) => runStat(s, 'run.monarchHp', monarchBase(s))

// ── the ascension ladder ─────────────────────────────────────────────────────────────────────────

export const ascensionTop = () => TUNING.ascension.length - 1
export const ascensionOf = (s) => TUNING.ascension[s.ascension ?? 0]
// What every foe's HP and ATK are multiplied by in the run's battles: its level's, × the harness's `scale`.
export const foeScale = (s) => ({ hp: ascensionOf(s).foeHp * (s.scale ?? 1), atk: ascensionOf(s).foeAtk * (s.scale ?? 1) })
// The foes of a formation on `floor` (an elite's or a fight's) at level `ascension`: TUNING.spawn's × the level's, rounded.
// A floor-1 fight of rank `rank` within TUNING.spawn.opening counts its entry there instead.
export const roomSize = (floor, elite, ascension = 0, rank = null) => {
  const row = TUNING.ascension[ascension]
  const open = !elite && floor === 1 && rank !== null ? TUNING.spawn.opening[rank - 1] : undefined
  return Math.round((open ?? at(elite ? TUNING.spawn.elite : TUNING.spawn.fight, floor)) * (elite ? row.elite : row.fight))
}
// The turns between waves in the run's battles.
export const waveEvery = (s) => Math.max(1, Math.round(TUNING.spawn.waves.every * ascensionOf(s).every))
// The Monarch's base max HP in the run, before its HP relics.
export const monarchBase = (s) => Math.round(TUNING.monarch.hp * ascensionOf(s).monarchHp)
// The highest level a player may choose, `cleared` the highest cleared (−1: none): the one above it, never past the top.
export const openTo = (cleared) => Math.min(ascensionTop(), Math.max(0, cleared + 1))
// A clear at `level`, `cleared` the highest before: the highest now, and the level it opened (null: none).
export function clearAt (cleared, level) {
  const now = Math.max(cleared, level)
  return { cleared: now, opened: openTo(now) > openTo(cleared) ? openTo(now) : null }
}
