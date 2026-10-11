// The rules registry (redesign.md §2.13.4): each rule a synergy, a Legendary relic or a boss's override brings to a
// battle, its hooks in one place. A new rule is one entry here. turns.js calls the hooks at fixed points, each with
// the battle, a context it may change, and the rule as the side holds it (`r`: its entry, with `holder`, the unit
// whose relic or def brings it, or null for a synergy's, which is the whole side's; and `params`, its numbers):
//   onBlow    an act has resolved (never a counter): { actor, ability, primary, targets }
//   onStruck  a blow has landed on one that still stands: { actor, target, ability, damage }
//   onFall    one of the side's own has fallen (the Monarch's fall ends the battle first): { fallen, by }; a rule
//             may lift it again (Undying), and then it has not fallen for anything after
//   onKill    one of the other side has fallen, whoever felled it (a status too): { slain, by, side }
//   onRaise   a shadow has risen to an Arise of the side's: { actor, corpse, shadow }
//   onTurn    the side's turn begins: { side, turn }
//   onWave    a foe wave has entered: { wave }
//   targets   whom an ability touches: { actor, ability, primary, targets, as }, called first with `as` 'target' on the
//             side of a blow's target, before its shape spreads (it may change `primary`), then with 'actor' on the
//             actor's side, after (it may change `targets`)
//   reach     how far an ability of the side reaches its primaries: { actor, ability, range } (it may change `range`)
//   modify    damage about to land, a blow's or a status tick's: { actor, target, ability, status, damage, miss, as },
//             called with `as` 'actor' on the actor's side, then 'target' on the target's (it may change `damage`
//             or set `miss`)
//   queue     the foes' turn's order: { queue } (it may reorder it)
// and three that are not moments:
//   grants    an ability id its holder gains (Arise's: redesign.md §2.15)
//   roles     (battle, u, r) → the roles its holder counts as besides its own, for synergies (Mimicry)
//   raisable  (battle, u, r) → whether its holder may raise now (Blood Tithe: not with the Monarch's HP at the tithe)
// `params`: a rule's numbers, its defaults here, a relic's own `params` over them. A Legendary's rule is scoped to its
// holder (§2.15): its hooks look at `r.holder`. A Legendary's cost that is not its holder's (Court of Bone's Monarch
// that nothing heals) is a flag on its entry (`unhealable`), read for the run wherever it holds the relic (unhealable).
import { TUNING } from '../tuning.js'
import { unitDef, relicDef, abilityDef } from '../content.js'
import { alive, livingOn } from './unit.js'
import { around, riseTile } from './field.js'
import { emit, raise, roomFor, shadowSize, runEffect, synergiesOf, addStatus, perform, usable, shape, targetsFrom } from './turns.js'

const vanguard = (u) => unitDef(u.id).role === 'vanguard'
// Whether one of the side's own felled `slain` (a status it laid counts: `by` is its layer).
const slew = (by, side, slain) => !!by && by.side === side && slain.side !== side

export const RULES = {
  // Undead 4: a foe slain rises at once as a shadow of the side holding it, past Arise's reach and tier, never a boss,
  // a shadow or a Monarch, while that side has room for it (turns.js roomFor; one of yours rises beside the Monarch:
  // riseTile). Its raiser is the slayer when it stands on that side.
  legion: {
    onKill (battle, { slain, by, side }) {
      if (alive(slain) || slain.raised || slain.shadow || slain.into || unitDef(slain.id).boss || !roomFor(battle, side)) return
      if (side === 'party' && riseTile(battle, slain.tile, shadowSize(slain, side), slain.flies) < 0) return
      const actor = by?.side === side ? by : null
      emit(battle, { type: 'rule', rule: 'legion', side, actor: actor?.uid ?? null, target: slain.uid })
      raise(battle, actor, slain, { side, rule: 'legion' })
    }
  },
  // Drake 4: a single-target blow of the side's bursts on its target and everyone of its side beside it.
  dragonfire: {
    targets (battle, ctx) {
      const { actor, ability, primary } = ctx
      if (ctx.as !== 'actor' || ability.shape !== 'single' || primary.side === actor.side) return
      const out = around(battle, primary.tile, 1, primary.side, primary.size)
      ctx.targets = ability.melee && !actor.flies ? out.filter((x) => !x.flies) : out
    }
  },
  // Fae 4: the first blow each foe would land on the side misses.
  mirage: {
    modify (battle, ctx) {
      const { actor, target } = ctx
      if (ctx.as !== 'target' || ctx.status || ctx.miss || !actor || actor.side === target.side || actor.foiled) return
      actor.foiled = true
      emit(battle, { type: 'rule', rule: 'mirage', side: target.side, actor: actor.uid, target: target.uid })
      ctx.miss = true
    }
  },
  // Insect 4: one of the side's that slays a foe has every skill ready again.
  frenzy: {
    onKill (battle, { slain, by, side }) {
      if (!slew(by, side, slain) || !alive(by)) return
      for (const id in by.cooldowns) by.cooldowns[id] = 0
      emit(battle, { type: 'rule', rule: 'frenzy', side, actor: by.uid, target: slain.uid })
    }
  },
  // Construct 4: the first blow that would fell each of the side's leaves it at 1 HP (never the Monarch).
  last_stand: {
    modify (battle, ctx) {
      const { target } = ctx
      if (ctx.as !== 'target' || ctx.miss || target.stood || target === battle.monarch || ctx.damage < target.hp) return
      target.stood = true
      ctx.damage = target.hp - 1
      emit(battle, { type: 'rule', rule: 'last_stand', side: target.side, target: target.uid })
    }
  },
  // Vanguard 4: a single-target blow at one of the side's not itself a Vanguard falls on a Vanguard beside it (the one
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
  // Ranger 4: the side's ranged blows deal `mul` times their damage (redesign.md §2.16).
  deadeye: {
    params: { mul: 1.5 },
    modify (battle, ctx, r) {
      const { actor, target, ability } = ctx
      if (ctx.as !== 'actor' || ctx.status || !ability || ability.melee || actor.side === target.side) return
      ctx.damage *= r.params.mul
    }
  },
  // Skirmisher 4: the side's pieces start the battle, and enter it, Hastened (+1 Move, cooldowns falling faster) for
  // their first turn: each the first time its side's turn begins with it on the board.
  ambush: {
    onTurn (battle, { side }) {
      const fresh = battle.units.filter((u) => u.side === side && alive(u) && !u.ambushed && u !== battle.monarch)
      if (!fresh.length) return
      emit(battle, { type: 'rule', rule: 'ambush', side })
      for (const u of fresh) {
        u.ambushed = true
        addStatus(battle, u, 'hasten', 1, u)
      }
    }
  },
  // Channeler 4: every ability of the side's rings out once more, free, on the same targets (an Arise never echoes).
  echo: {
    onBlow (battle, { actor, ability, targets }) {
      if (!alive(actor) || ability.effects.some((e) => e.op === 'raise')) return
      emit(battle, { type: 'rule', rule: 'echo', side: actor.side, actor: actor.uid, ability: ability.id })
      for (const effect of ability.effects) runEffect(battle, effect, actor, targets, ability)
    }
  },
  // Warden 4: an ability of the side's aimed at an ally reaches anyone of its side, and touches every one of its side
  // on the board.
  sanctuary: {
    reach (battle, ctx) {
      if (ctx.ability.shape === 'ally' || ctx.ability.shape === 'all_allies') ctx.range = Infinity
    },
    targets (battle, ctx) {
      if (ctx.as !== 'actor' || (ctx.ability.shape !== 'ally' && ctx.ability.shape !== 'all_allies')) return
      ctx.targets = livingOn(battle.units, ctx.actor.side)
    }
  },
  // Trickster 4: an execute (redesign.md §2.16): a blow of the side's on a foe below TUNING.deathblow.below of its max
  // HP deals TUNING.deathblow.mult times its damage.
  deathblow: {
    modify (battle, ctx) {
      const { actor, target } = ctx
      if (ctx.as !== 'actor' || ctx.status || ctx.miss || !actor || actor.side === target.side) return
      if (target.hp >= target.maxHp * TUNING.deathblow.below) return
      ctx.damage *= TUNING.deathblow.mult
      emit(battle, { type: 'rule', rule: 'deathblow', side: actor.side, actor: actor.uid, target: target.uid })
    }
  },

  // ── the Legendaries, each scoped to its holder (§2.15) ──

  // Arise: its holder gains the skill (content.js `arise`: one corpse within its reach rises, turns.js corpses).
  arise: { grants: 'arise' },
  // Undying: its holder, fallen, rises where it fell at `hp` of its max HP, once a battle.
  undying: {
    params: { hp: 0.6 },
    onFall (battle, { fallen }, r) {
      if (fallen !== r.holder || fallen.rose) return
      fallen.rose = 1
      fallen.hp = Math.max(1, Math.round(fallen.maxHp * r.params.hp))
    }
  },
  // Mimicry: its holder counts as a `role` too, for its side's synergies.
  mimicry: {
    params: { role: 'warden' },
    roles: (battle, u, r) => (u === r.holder ? [r.params.role] : [])
  },
  // Hollow Court, an Arise variant: the shadows its holder raises that still stand when the battle is won pay their
  // essence again, `reap` times (run.js finishBattle reads `reap` on the shadow).
  hollow_court: {
    grants: 'arise',
    params: { reap: 1 },
    onRaise (battle, { actor, shadow }, r) {
      if (actor === r.holder) shadow.reap = (shadow.reap ?? 0) + r.params.reap
    }
  },
  // Blood Tithe, an Arise variant: its holder's Arise rests no turn (cooldown 1), and each shadow it raises costs the
  // Monarch `tithe` of its max HP; never its last (raisable).
  blood_tithe: {
    grants: 'arise',
    params: { tithe: 0.02, cooldown: 1 },
    raisable: (battle, u, r) => !battle.monarch || battle.monarch.hp > titheOf(battle, r),
    onRaise (battle, { actor }, r) {
      const m = battle.monarch
      if (actor !== r.holder || !m || !alive(m)) return
      const cost = titheOf(battle, r)
      m.hp -= cost
      emit(battle, { type: 'tithe', target: m.uid, damage: cost, hp: m.hp })
    }
  },
  // Court of Bone, an Arise variant: its holder's Arise reaches `domain` tiles farther; and while the run holds it,
  // nothing heals the Monarch, in battle or out (unhealable).
  court_of_bone: { grants: 'arise', params: { domain: 2 }, unhealable: true },

  // ── a boss's override, on top of its temperament (§2.9.6) ──

  // The Hollow Sovereign: its court (the foes of its own wave) moves before every other foe, and it casts Grave Tide
  // as its act every `every` turns, at the start of the foes' turn, whatever the scoring would rather: where its
  // shape covers the most of yours (then the lowest uid), while its own condition holds (content.js `when`).
  sovereign: {
    params: { every: 3, ability: 'grave_tide' },
    queue (battle, ctx, r) {
      const court = (u) => u !== r.holder && u.wave === r.holder.wave
      ctx.queue.sort((a, b) => court(b) - court(a))
    },
    onTurn (battle, { turn }, r) {
      const u = r.holder
      if (!alive(u) || turn % r.params.every || u.acted) return
      const tide = u.kit.find((a) => a.id === r.params.ability)
      if (!tide || !usable(battle, u, tide)) return
      const covers = (x) => shape(battle, u, tide, x).filter((y) => y.side !== u.side).length
      const at = targetsFrom(battle, u, tide).sort((a, b) => covers(b) - covers(a) || a.uid - b.uid)[0]
      if (at) perform(battle, u, tide, at)
    }
  }
}

// What a shadow of a Blood Tithe holder's costs the Monarch.
export const titheOf = (battle, r) => Math.ceil(battle.monarch.maxHp * r.params.tithe)

// A rule as a side holds it: its entry, its holder (null for a synergy's) and its numbers.
const entry = (id, holder = null, params = null) => {
  if (!Object.hasOwn(RULES, id)) throw new Error(`no rule "${id}" in the registry`)
  return { id, ...RULES[id], holder, params: { ...RULES[id].params, ...params } }
}

// The rules a unit's relics bring it (a piece relic's `rule`, scoped to it; turns.js reads them as it takes its place:
// held), and its kind's override (a def's `rule`, a boss's). → entries.
export function heldRules (u) {
  const out = []
  for (const id of u.relics ?? []) {
    const r = relicDef(id)
    if (r.rule) out.push(entry(r.rule, u, r.params))
  }
  const own = unitDef(u.id).rule
  if (own) out.push(entry(own, u))
  return out
}

// The rules `side` holds now, in a fixed order: its synergies' (turns.js synergiesOf: the foes' only where `foeRules`
// lets them, none with the `synergies` ablation), then each of its units' held rules (`u.held`, in acting order; a
// fallen holder keeps its relic and its rule, one consumed by a fusion gave it back). Kept until the synergies or the
// roster change.
export function rulesOf (battle, side) {
  const syn = synergiesOf(battle, side)
  const kept = (battle.ruleList ??= {})[side]
  if (kept?.syn === syn && kept.roster === battle.roster) return kept.list
  const list = side === 'foe' && !battle.foeRules ? [] : syn.filter((s) => s.rule).map((s) => entry(s.rule))
  for (const u of battle.units) if (u.side === side && !u.into && u.held?.length) list.push(...u.held)
  battle.ruleList[side] = { syn, roster: battle.roster, list }
  return list
}

// Each rule `side` holds runs its `hook`, in order.
export function call (battle, hook, side, ctx) {
  for (const r of rulesOf(battle, side)) if (r[hook]) r[hook](battle, ctx, r)
}

// Whether `side` holds rule `id` (for the interface's glow; nothing in a battle branches on a rule's name).
export const holds = (battle, side, id) => rulesOf(battle, side).some((r) => r.id === id)

// The abilities a unit's held rules grant it (Arise), as defs, but none the `arise` ablation takes away
// (autoplay.js: a measuring switch, never a player's).
export const grantsOf = (battle, u) => (u.held ?? []).filter((r) => r.grants && !(battle.ablate.has('arise') && r.grants === 'arise'))
  .map((r) => abilityDef(r.grants))

// Whether any of these relic ids (the run's) brings a rule that leaves the Monarch unhealable (Court of Bone).
export const unhealable = (ids) => ids.some((id) => RULES[relicDef(id).rule]?.unhealable)

// Whether relic `id` grants its holder Arise (an Arise relic: Arise and its variants; run.js needsArise).
export const grantsArise = (id) => RULES[relicDef(id).rule]?.grants === 'arise'
