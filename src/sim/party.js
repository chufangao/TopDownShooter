// Party assembly and level scaling. The only place `base + growth × (lvl − 1)` is written down.

import { assignFormation, SLOTS } from './combat/formation.js'
import { DEFAULT_DOCTRINE, chooseCut } from './doctrine.js'
import { pickSpawns, foeLevel } from './spawn.js'

export function unitBaseStats (def, lvl = 1) {
  const out = {}
  for (const [k, v] of Object.entries(def.base)) {
    if (k === '_note') continue
    out[k] = v + (def.growth?.[k] ?? 0) * (lvl - 1)
  }
  out.hp = Math.round(out.hp)
  return out
}

/**
 * Every stat path the modifier pipeline may write (§11.3), with its neutral value. Defaults matter:
 * a status that multiplies `damage.dealt` must have something to multiply even on a unit that has
 * never heard of it.
 *
 * `gauge.rate` is a MULTIPLIER on the rate derived from SPD (§2), not the rate itself — so Hasten
 * and Swarm Logic stack the same way every other percentage in the game does.
 */
export function statBlock (def, lvl = 1, tuning) {
  const s = unitBaseStats(def, lvl)
  return {
    hp: s.hp, atk: s.atk, def: s.def, spd: s.spd, acc: s.acc, eva: s.eva, crt: s.crt,
    charm: s.charm ?? 0,
    gauge: { rate: 1, cost: 1 },
    persuade: { threshold: tuning.persuade.threshold, chance: 1 },
    damage: { dealt: 1, taken: 1 },
    heal: { given: 1, taken: 1 },
    residue: { mult: 1 }, loot: { mult: 1 }, xp: { mult: 1 }, coin: { mult: 1 }
  }
}

/**
 * The party's median level — where a recruit joins (§2). Lives here rather than in `progression.js`
 * because it is a fact about a party, and because the import must only ever run party → progression.
 */
export function medianLevel (roster) {
  if (!roster.length) return 1
  const lvls = roster.map((u) => u.lvl ?? 1).sort((a, b) => a - b)
  const mid = lvls.length >> 1
  return lvls.length % 2 ? lvls[mid] : Math.floor((lvls[mid - 1] + lvls[mid]) / 2)
}

/**
 * @param {object} [opts]
 * @param {object} [opts.formation]  the Doctrine's `formation` section — pins and by-Role auto-fill.
 *   Foes are built without one: a pin is a statement about your roster, not about theirs.
 * @returns {Array} unit instances placed in the 3×4 grid by the Formation doctrine's auto-fill.
 */
export function makeParty (kernel, defIds, { side = 'party', lvl = 1, formation = null } = {}) {
  const units = defIds.map((defId) => kernel.defs.instantiate('unit', defId, { lvl, side }))
  for (const u of units) u.side = side
  return assignFormation(units, kernel.registry, formation)
}

/**
 * Fold a battle's recruits into the run's roster (§2).
 *
 * Every recruit past the cap is a decision about what you are willing to lose: the Recruit doctrine
 * must name a cut rule, or the recruit is declined. Nothing here is silent — the caller gets a
 * report it can put in front of the player, because a party that quietly loses a unit is a bug
 * report waiting to happen.
 *
 * @returns {{roster, joined: Array, declined: Array, cut: Array}}
 */
export function addRecruits (kernel, roster, battle, { tuning, doctrine = DEFAULT_DOCTRINE } = {}) {
  const cap = Math.min(SLOTS, tuning?.party?.cap ?? SLOTS)
  const joined = []
  const declined = []
  const cut = []
  let next = roster.slice()

  // Where a recruit lands on the level curve (§2). Joining at its foe level would make late floors
  // hand out free veterans; joining at 1 would make every recruit past floor 2 worthless and
  // quietly kill the acquisition loop the deeper you got. The median is the honest middle: behind
  // the party, not hopeless.
  const joinLvl = medianLevel(roster)

  for (const uid of battle.recruited) {
    const won = battle.units.find((u) => u.uid === uid)
    if (!won) continue

    const def = kernel.registry.get('unit', won.defId)
    const maxHp = Math.max(1, Math.round(unitBaseStats(def, joinLvl).hp))

    // `recruitedBy` is destructured away rather than set to `undefined`. An undefined value is a
    // *present key* in memory and an absent one after `JSON.stringify`, so a recruit's instance and
    // its saved form were not the same object — which §14's round-trip is exactly the assertion
    // about. Battle-only fields must be removed, not blanked.
    const { recruitedBy: _wasRecruitedBy, ...carried } = won

    // The unit joins as it left the field: hurt, but never so hurt it is useless on arrival. HP
    // carries across as a fraction, so re-levelling is not a stealth heal (§3).
    const recruit = {
      ...carried,
      side: 'party',
      left: false,
      gauge: 0,
      statuses: [],
      persuadeAttempts: 0,
      lvl: joinLvl,
      xp: 0,
      maxHp,
      hp: Math.max(Math.round(maxHp * (won.hp / Math.max(1, won.maxHp))), Math.ceil(maxHp * 0.25)),
      // It arrives carrying the slot it held on the *other* side of the field, which is meaningless
      // here. −1 asks the formation pass to place it properly: the frontmost free slot its Role's
      // auto-fill rule allows (§2). Everyone already standing keeps where they stand.
      slot: -1
    }

    if (next.length >= cap) {
      // Never cut someone we recruited a moment ago in this same batch: a fresh recruit is usually
      // the lowest level in the party, so an unprotected cut rule would churn its own catch.
      const victim = chooseCut(next, kernel.registry, doctrine, new Set(joined.map((u) => u.uid)))
      if (!victim) { declined.push(recruit); continue }
      next = next.filter((u) => u.uid !== victim.uid)
      cut.push(victim)
    }
    next.push(recruit)
    joined.push(recruit)
  }

  return { roster: assignFormation(next, kernel.registry, doctrine?.formation), joined, declined, cut }
}

/**
 * A seeded encounter (§6.2).
 *
 * Which units can appear is content — `spawn.js` resolves the floor's tables — and this function
 * only instantiates the result. The twelve lines that used to weight every unit in the registry by
 * tier lived here, which meant a pack could ship a unit but could not say where it appeared; they
 * are now `tuning.spawn` plus a table row.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.boss]  draw a boss instead: one unit, front-centre, no formation (§6.3)
 * @param {object} [opts.bias]   Kin → weight multiplier, from the Lattice's Bias nodes (§5)
 */
export function makeFoes (kernel, rng, { floor = 1, size = 3, lvl = null, tuning, boss = false, bias = null } = {}) {
  const t = tuning ?? kernel.registry.get('tuning', 'core:tuning')
  const picked = pickSpawns(kernel, rng, { floor, tuning: t, size: boss ? 1 : size, boss, bias })
  const foes = makeParty(kernel, picked, { side: 'foe', lvl: lvl ?? foeLevel(floor, t) })
  // A boss holds one slot and nothing else does. Placing it front-centre rather than letting
  // auto-fill decide means a melee party can always reach it, which is the difference between a
  // boss fight and a stalemate against an unreachable back-row unit.
  if (boss) for (const u of foes) u.slot = 1
  return foes
}
