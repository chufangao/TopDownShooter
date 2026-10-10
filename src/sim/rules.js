// The rules registry (redesign.md §2.13.4): each rule a synergy, a Legendary relic or a boss's override brings to a
// battle on turns, its hooks in one place. A new rule is one entry here. turns.js calls the hooks at fixed points,
// each with the battle and a context it may change:
//   onBlow    an ability has resolved (never a counter, never Arise): { actor, ability, primary, targets }
//   onStruck  a blow has landed on one that still stands: { actor, target, ability, damage }
//   onFall    one of the side's own has fallen (the Monarch's fall ends the battle first): { fallen, by }
//   onKill    one of the other side has fallen, whoever felled it (a status too): { slain, by, side }
//   onTurn    the side's turn begins: { side, turn }
//   onWave    a foe wave has entered: { wave }
//   targets   whom an ability touches: { actor, ability, primary, targets, as }, called first with `as` 'target' on the
//             side of a blow's target, before its shape spreads (it may change `primary`), then with 'actor' on the
//             actor's side, after (it may change `targets`)
//   modify    damage about to land, a blow's or a status tick's: { actor, target, ability, status, crit, damage, miss,
//             as }, called with `as` 'actor' on the actor's side, then 'target' on the target's (it may change `damage`
//             or set `miss`)
// `params(battle)`: a rule's numbers, where it has some. The synergy rules are the 8 steps' (content.js SYNERGIES
// `rule`; stat steps as they stand in the slice); a Legendary relic's is its `rule` (RELIC_LIST: Arise's so far, the
// other Legendaries keeping their old keys, which battle.js reads, until the full conversion).
import { unitDef, relicDef } from '../content.js'
import { alive, livingOn } from './unit.js'
import { rulesOf as heldRules, emit, around, raise, riseTile, roomFor, shadowSize, runEffect, ariseTier } from './battle.js'

const vanguard = (u) => unitDef(u.id).role === 'vanguard'

export const RULES = {
  // Undead 8: a foe slain rises at once as a shadow of the side holding it, past Arise's reach and tier, never a boss,
  // a shadow or a Monarch, while that side has room for it (battle.js roomFor; one of yours rises beside the
  // Monarch: riseTile). Its raiser is the slayer when it stands on that side.
  legion: {
    onKill (battle, { slain, by, side }) {
      if (alive(slain) || slain.raised || slain.shadow || unitDef(slain.id).boss || !roomFor(battle, side)) return
      if (side === 'party' && riseTile(battle, slain.tile, shadowSize(slain, side), slain.flies) < 0) return
      const actor = by?.side === side ? by : null
      emit(battle, { type: 'rule', rule: 'legion', side, actor: actor?.uid ?? null, target: slain.uid })
      raise(battle, actor, slain, { side, rule: 'legion' })
    }
  },
  // Drake 8: a single-target blow of the side's bursts on its target and everyone of its side beside it.
  dragonfire: {
    targets (battle, ctx) {
      const { actor, ability, primary } = ctx
      if (ctx.as !== 'actor' || ability.shape !== 'single' || primary.side === actor.side) return
      const out = around(battle, primary.tile, 1, primary.side, primary.size)
      ctx.targets = ability.melee && !actor.flies ? out.filter((x) => !x.flies) : out
    }
  },
  // Fae 8: the first blow each foe would land on the side misses.
  mirage: {
    modify (battle, ctx) {
      const { actor, target } = ctx
      if (ctx.as !== 'target' || ctx.status || ctx.miss || !actor || actor.side === target.side || actor.foiled) return
      actor.foiled = true
      emit(battle, { type: 'rule', rule: 'mirage', side: target.side, actor: actor.uid, target: target.uid })
      ctx.miss = true
    }
  },
  // Insect 8: one of the side's that slays a foe has every skill ready again (the gauge filled, on turns).
  frenzy: {
    onKill (battle, { slain, by, side }) {
      if (!by || by.side !== side || slain.side === side || !alive(by)) return
      for (const id in by.cooldowns) by.cooldowns[id] = 0
      emit(battle, { type: 'rule', rule: 'frenzy', side, actor: by.uid, target: slain.uid })
    }
  },
  // Construct 8: the first blow that would fell each of the side's leaves it at 1 HP (never the Monarch).
  last_stand: {
    modify (battle, ctx) {
      const { target } = ctx
      if (ctx.as !== 'target' || ctx.miss || target.stood || target === battle.monarch || ctx.damage < target.hp) return
      target.stood = true
      ctx.damage = target.hp - 1
      emit(battle, { type: 'rule', rule: 'last_stand', side: target.side, target: target.uid })
    }
  },
  // Vanguard 8: a single-target blow at one of the side's not itself a Vanguard falls on a Vanguard beside it (the one
  // with the most HP, then the first to act).
  bodyguard: {
    targets (battle, ctx) {
      const { actor, ability, primary } = ctx
      if (ctx.as !== 'target' || ability.shape !== 'single' || primary.side === actor.side || vanguard(primary)) return
      const guard = around(battle, primary.tile, 1, primary.side, primary.size).filter(vanguard).sort((a, b) => b.hp - a.hp || a.ord - b.ord)[0]
      if (!guard) return
      emit(battle, { type: 'rule', rule: 'bodyguard', side: guard.side, actor: guard.uid, target: primary.uid })
      ctx.primary = guard
    }
  },
  // Ranger 8: with no dice, the side's ranged blows deal 50% more (redesign.md §2.6); with dice (TUNING.dice) they
  // never miss and always crit (turns.js damage reads it there).
  deadeye: {
    modify (battle, ctx) {
      const { actor, target, ability } = ctx
      if (ctx.as !== 'actor' || battle.dice || ctx.status || !ability || ability.melee || actor.side === target.side) return
      ctx.damage *= 1.5
    }
  },
  // Skirmisher 8: the side's pieces start, and enter, with a full gauge: on turns every skill is ready then anyway,
  // so it waits for its conversion (redesign.md §5 Step 4).
  ambush: {},
  // Channeler 8: every ability of the side's rings out once more, free, on the same targets (Arise never echoes).
  echo: {
    onBlow (battle, { actor, ability, targets }) {
      if (!alive(actor) || ability.effects.some((e) => e.op === 'raise')) return
      emit(battle, { type: 'rule', rule: 'echo', side: actor.side, actor: actor.uid, ability: ability.id })
      for (const effect of ability.effects) runEffect(battle, effect, actor, targets, ability)
    }
  },
  // Warden 8: an ability of the side's aimed at an ally touches every one of its side on the board (and a heal reaches
  // anyone: turns.js reads it).
  sanctuary: {
    targets (battle, ctx) {
      if (ctx.as !== 'actor' || (ctx.ability.shape !== 'ally' && ctx.ability.shape !== 'all_allies')) return
      ctx.targets = livingOn(battle.units, ctx.actor.side)
    }
  },
  // Trickster 8: with dice, a critical hit of the side's slays outright, a boss and the Monarch excepted (a Last
  // Stand still holds, once). With no dice nothing crits, and it waits for its conversion.
  deathblow: {
    modify (battle, ctx) {
      const { actor, target } = ctx
      if (ctx.as !== 'actor' || !ctx.crit || ctx.status || actor.side === target.side || unitDef(target.id).boss || target === battle.monarch) return
      if (ctx.damage >= target.hp) return
      ctx.damage = target.hp
      emit(battle, { type: 'rule', rule: 'deathblow', side: actor.side, actor: actor.uid, target: target.uid })
    }
  },
  // The Legendary relic: the Monarch's act, once a turn, one corpse of up to `tier` within `domain` tiles of it (turns.js
  // corpses). Its reach and tier are the run's (run.js domainOf and ariseOf: the copies, and the relics' mods on them).
  arise: {
    params: (battle) => ({ domain: battle.domain, tier: battle.ariseTier ?? ariseTier(battle.held) })
  }
}

const entry = (id) => {
  if (!Object.hasOwn(RULES, id)) throw new Error(`no rule "${id}" in the registry`)
  return { id, ...RULES[id] }
}

// The rules `side` holds now, in a fixed order: its synergies' (battle.js rulesOf: the foes' only where `foeRules`
// lets them, none with the `synergies` ablation), then for yours the run's relics' (their `rule`, once whatever the
// copies; an ablated one none: Arise's under the `arise` ablation). Kept until the synergies change (the set battle.js
// keeps is made again only then).
export function rulesOf (battle, side) {
  const names = heldRules(battle, side)
  const kept = (battle.ruleList ??= {})[side]
  if (kept?.names === names) return kept.list
  const list = [...names].map(entry)
  if (side === 'party') {
    for (const id of new Set((battle.relics ?? []).map((r) => relicDef(r).rule).filter(Boolean))) if (!battle.ablate.has(id)) list.push(entry(id))
  }
  battle.ruleList[side] = { names, list }
  return list
}

// Each rule `side` holds runs its `hook`, in order.
export function call (battle, hook, side, ctx) {
  for (const r of rulesOf(battle, side)) if (r[hook]) r[hook](battle, ctx)
}

// Whether `side` holds rule `id`.
export const holds = (battle, side, id) => rulesOf(battle, side).some((r) => r.id === id)

// Arise's numbers for this battle (RULES.arise.params), or null without it.
export const ariseOf = (battle) => (holds(battle, 'party', 'arise') ? RULES.arise.params(battle) : null)

// The rules every synergy and relic may name, for the content test.
export const RULE_IDS = Object.keys(RULES)
