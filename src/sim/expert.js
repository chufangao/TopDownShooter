// The expert's judgement (redesign.md §2.17), one shape for every decision it makes. First a situation, read once a
// decision from what the board, the run and the bestiary show a player, and the combo book (policy.js situation in
// battle, autoplay.js survey out of it): never the camp's pressure, never what is still to come but the wave counter's
// public turns, never a battle or a turn of the foes played ahead. Then its options, each read as a named vector of
// features (`v`). Then two layers:
//   1. the tree (TREES): hard rules, invariants a good player never breaks, taken in order. A node whose `when` holds
//      on the situation either forces an option (`force`: the decision ends there), keeps only the options it ranks
//      highest (`keep`: a filter, where a boolean keeps those that pass, if any does), switches the weights to a mode
//      of theirs (`mode`), or adds a mode's weights to them, each × what `scale` reads off the situation (`add`).
//      Thresholds in TUNING.expert.tree.
//   2. the weights (TUNING.expert): a weighted sum of the features (value) scores what the tree left, the best taken.
// Every decision says which rule decided it (`by`: the rule that forced it, else the first that filtered, else
// 'weights'), for the audit (autoplay.js --audit). `value` is the seam where a learned model may replace the sum.
// In battle the decisions nest (redesign.md §2.18): the battle plan once a turn (TREES.plan; plan.js, which also reads
// its target formation, the kill list and the foes' forecast, all off the board), then each piece's move and act with
// the plan among its features (TREES.battle), then the board a turn's orders leave (TREES.board).
import { TUNING } from '../tuning.js'

// The weighted sum of a feature vector. Every feature has a weight in its table (a missing one is NaN, and the tests
// hold every vector to its table), so a feature and its weight never drift apart unseen.
export function value (v, w) {
  let n = 0
  for (const k in v) n += w[k] * v[k]
  return n
}

// One decision: `options` (each with its features `v`), `sit` the situation, `tree` its rules, `weights` its table
// (`modes`: the weight sets a mode node switches to, each over `weights`). Ties keep the first, unless `better(o, best)`
// says otherwise (the scores set on each as `o.score`). → { option, by, rules (every rule that fired, in order) }, the
// option null with none.
export function decide (tree, sit, options, weights, { modes = {}, better = null } = {}) {
  let w = weights
  let left = options
  const rules = []
  for (const node of tree) {
    if (!left.length || !node.when(sit)) continue
    if (node.force) {
      const o = node.force(left, sit)
      if (o) return { option: o, by: node.id, rules: [...rules, node.id] }
    } else if (node.keep) {
      const ranks = left.map((o) => +node.keep(o, sit))
      const top = Math.max(...ranks)
      if (ranks.every((r) => r === top)) continue
      left = left.filter((_, i) => ranks[i] === top)
      rules.push(node.id)
    } else if (node.mode) {
      w = { ...w, ...modes[node.mode] }
      rules.push(node.id)
    } else if (node.add) {
      const k = node.scale(sit)
      if (!(k > 0)) continue
      w = { ...w }
      for (const key in modes[node.add]) w[key] += k * modes[node.add][key]
      rules.push(node.id)
    }
  }
  let best = null
  for (const o of left) {
    o.score = value(o.v, w)
    if (best === null || (better ? better(o, best) : o.score > best.score)) best = o
  }
  return { option: best, by: rules[0] ?? 'weights', rules }
}

// The tree's filters as a candidate's standing, for a search that meets its candidates one at a time (the formation's
// hill-climb): the `keep` of each filter whose `when` holds, in order, compared first to last, the higher the better,
// and the score after them (outranks). Over candidates met all at once it orders them as decide's filters choose.
export const standing = (tree, sit, o) => tree.filter((n) => n.keep && n.when(sit)).map((n) => +n.keep(o, sit))
// Whether candidate `a` (its `keys`, standing, and its `score`) beats `b`; → the index of the first key it wins on, the
// key count where only the score does, −1 where it does not.
export function outranks (a, b) {
  for (let i = 0; i < a.keys.length; i++) if (a.keys[i] !== b.keys[i]) return a.keys[i] > b.keys[i] ? i : -1
  return a.score > b.score ? a.keys.length : -1
}

// The hard rules, a decision's list apiece. Each reads the situation (`sit`) and an option's features (`o.v`) only.
const T = () => TUNING.expert.tree
// The rooms that are battles (map.js types).
const BATTLES = new Set(['fight', 'elite', 'siege', 'boss'])
export const TREES = {
  // The battle plan, once a turn (plan.js readPlan; features plan.js planOptions; `sit` its context: the `trigger` that
  // fired since the last turn's plan, null for none, that plan `prev`, the camp's `patience`, the Monarch in the foes'
  // `reach`, its `shooters` (plan.js shootersOf) and those of them your pieces could fell (`fellable`), a `healer` of
  // theirs the kill list fells, the foes `waiting`: each holds off out of your reach, and no wave is to come).
  plan: [
    // A plan stands until something changes it: no dithering, and a walk that spans turns.
    { id: 'keep-plan', when: (sit) => sit.trigger === null, force: (plans, sit) => plans.find((o) => o.kind === sit.prev.kind && o.target === sit.prev.target) },
    // A foe whose blow from range reaches the Monarch, now or from where it will stand next turn, is the focus (redesign.md
    // §2.18, B): go and fell it (the kill list has it first); where your pieces could fell none such, close about the
    // Monarch and screen its line.
    { id: 'monarch-shooter', when: (sit) => sit.shooters?.length > 0, keep: (o, sit) => (sit.fellable.length ? o.v.shooter > 0 : o.v.protect > 0) },
    // The Monarch within the foes' reach next turn: close about it, or fell what reaches it where the kill list can.
    { id: 'monarch-reach', when: (sit) => sit.reach, keep: (o) => o.v.protect > 0 || o.v.cull > 0 },
    // A healer of theirs that can be felled this turn is: what the rest deal, it undoes.
    { id: 'fell-healer', when: (sit) => sit.healer, keep: (o) => o.v.focus > 0 && o.v.mends > 0 && o.v.fell >= 1 },
    // Long past the last wave (TUNING.expert.tree.stall turns): take the fight to them.
    { id: 'no-stall', when: (sit) => sit.patience >= T().stall, keep: (o) => o.v.push > 0 || o.v.focus > 0 },
    // Foes that hold off out of your reach, and no wave to come: a line they never walk into holds nothing; go to them.
    { id: 'go-to-them', when: (sit) => sit.waiting, keep: (o) => o.v.hold === 0 && o.v.protect === 0 }
  ],
  // One piece's move and act in battle (policy.js choice; features policy.js features).
  battle: [
    // An act that changes nothing (a heal on the whole, a ward or a debuff already at its full stacks) is no act.
    { id: 'no-waste', when: () => true, keep: (o) => !o.v.waste },
    // The foes could fell the Monarch next turn: only what brings their reach on it below its HP (a kill, a Hex, a
    // piece on the road), where anything does.
    { id: 'monarch-lethal', when: (sit) => !!sit.monarch?.lethal, keep: (o) => !o.v.lethal },
    // A foe that could strike the Monarch next turn, and can be felled now: felled first.
    { id: 'kill-first', when: (sit) => sit.monarch?.threats.length > 0, keep: (o) => o.v.cull > 0 },
    // A piece never ends where the danger map (or its blow's counter) says it falls, unless its act kills, shields the
    // Monarch, or wounds a foe that could strike the Monarch next turn (the Monarch's fall is the run's: a piece is
    // spent for it).
    { id: 'never-die', when: () => true, keep: (o) => !o.v.fall || o.v.kill > 0 || o.v.guard > 0 || o.v.harry > 0 },
    // The Monarch within the foes' reach next turn: the guard's weights (TUNING.expert.battle.modes.guard).
    { id: 'guard', when: (sit) => sit.monarch?.danger > 0, mode: 'guard' },
    // The plan is to close about the Monarch (plan.js): the protect's weights over the guard's
    // (TUNING.expert.battle.modes.protect), what an option takes from the foes' reach of the Monarch counted.
    { id: 'protect', when: (sit) => sit.plan?.kind === 'protect', mode: 'protect' },
    // Protecting, a piece the formation gives a post (a road's block or air slot, a screen) ends on it where that spares
    // the Monarch a blow, a road held or a line screened (redesign.md §2.18 B: the screen is the fallback, so it must be
    // stood on, not merely wished for).
    { id: 'hold-the-line', when: (sit) => sit.plan?.kind === 'protect', keep: (o) => o.v.post > 0 && o.v.guard > 0 },
    // The Monarch wounded, its wounds the run's (redesign.md §2.18 C): while it is in the foes' reach or the plan is to
    // close about it, the frail weights (TUNING.expert.battle.modes.frail) added, × the share of its max HP it lacks.
    { id: 'frail', when: (sit) => !!sit.monarch && (sit.monarch.danger > 0 || sit.plan?.kind === 'protect'), add: 'frail', scale: (sit) => 1 - sit.monarch.share },
    // The plan is to take the fight to foes that hold off (plan.js): the push's weights (TUNING.expert.battle.modes.push),
    // a piece walking into what they could deal to come to them.
    { id: 'push', when: (sit) => sit.plan?.kind === 'push', mode: 'push' },
    // Never a battle held forever: long past the last wave (TUNING.expert.tree.stall turns of the camp's patience, as
    // the counts show it), the press's weights (TUNING.expert.battle.modes.press): come on and trade.
    { id: 'no-stall', when: (sit) => sit?.patience >= T().stall, mode: 'press' }
  ],
  // The boards a turn's orders leave, a few orders of the pieces apiece (policy.js expertTurn; features
  // policy.js boardFeatures; `sit` the camp's patience, the plan's kind and how many shooters of the Monarch's it read).
  board: [
    // Never a board where the foes could fell the Monarch next turn, where another is not.
    { id: 'no-doom', when: () => true, keep: (o) => !o.v.doom },
    // The Monarch's shooters first (redesign.md §2.18, B): of the boards, those that leave the fewest of them standing.
    { id: 'shooters-first', when: (sit) => sit?.shooters > 0, keep: (o) => -o.v.shooters },
    // The plan is to take the fight to foes that hold off: the push's board weights (TUNING.expert.battle.boardModes.push).
    { id: 'push', when: (sit) => sit?.plan === 'push', mode: 'push' },
    // And long past the last wave, the press's board weights (TUNING.expert.battle.boardModes.press), as the pieces'.
    { id: 'no-stall', when: (sit) => sit?.patience >= T().stall, mode: 'press' }
  ],
  // A formation (autoplay.js plan; features autoplay.js formationFeatures).
  formation: [
    // The field filled: as many pieces as any formation fields (the Command, where their footprints fit).
    { id: 'fill-field', when: () => true, keep: (o) => o.v.fielded },
    // A scouted flyer met by a field that can strike one (a ranged blow, or a flyer's own), where any formation fields
    // such a piece: a field that cannot touch a flyer can only lose to it, or hold it forever.
    { id: 'answer-air', when: (ctx) => !!ctx?.foes?.some((f) => f.flies), keep: (o) => o.v.air > 0 },
    // The roads into the Monarch held: as few scouted foes' roads open to the seat as the pieces allow.
    { id: 'block-roads', when: () => true, keep: (o) => -o.v.open }
  ],
  // The next room (autoplay.js pickRoute; features autoplay.js roomFeatures; `o.node` the room).
  route: [
    // A badly wounded army (TUNING.expert.tree.wounded) takes an altar where one is open,
    { id: 'wounded-altar', when: (sit) => sit.health < T().wounded, force: (rooms) => rooms.find((o) => o.node.type === 'altar') },
    // and so does a wounded Monarch (its HP below TUNING.expert.tree.altar of its max), where an altar may heal it: its
    // wounds are the run's, and its fall the run's end (redesign.md §2.18 C).
    { id: 'monarch-altar', when: (sit) => !sit.unhealed && sit.monarch < T().altar, force: (rooms) => rooms.find((o) => o.node.type === 'altar') },
    // A badly wounded army never walks into an elite where another room is open,
    { id: 'wounded-no-elite', when: (sit) => sit.health < T().wounded, keep: (o) => o.node.type !== 'elite' },
    // nor does a Monarch below TUNING.expert.tree.elite of its HP.
    { id: 'monarch-no-elite', when: (sit) => sit.monarch < T().elite, keep: (o) => o.node.type !== 'elite' },
    // Never a battle the army is the underdog in (its strength over the room's scouted threat, as a log, below
    // TUNING.expert.tree.odds) where another room is open, and of such battles the least long: a loss ends the run.
    { id: 'no-long-odds', when: () => true, keep: (o) => (BATTLES.has(o.node.type) ? Math.min(o.v.odds, T().odds) : T().odds) }
  ],
  // A relic given, kept or taken back out of battle (autoplay.js pickHold: `o.free`, a hold onto a free slot).
  hold: [
    // A piece relic waiting works for no one: given, where a standing soul has a free slot.
    { id: 'give-relic', when: (sit) => sit.relics.unheld.length > 0 && sit.relics.free > 0, keep: (o) => !!o.free }
  ]
}
