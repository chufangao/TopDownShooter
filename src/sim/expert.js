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
// In battle the decisions nest (redesign.md §2.18, §2.21, §2.22): the battle plan once a turn (TREES.plan; plan.js, which
// also reads its target formation, the kill list and the foes' forecast, all off the board), then each piece's move and
// act with the plan among its features, by the learned decision tree (below: a model tree over the conditions, its
// leaves' weights and its soft rules, held as data in expert.json; today's TREES.battle and weights are its default
// configuration, defaultExpert), once a piece in the fast turn (policy.js expertTurn); where the plan reads the
// Monarch's shooters, the two boards the turn weighs too (TREES.board: today's static evaluation, policy.js judge).
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

// ── the vocabulary of conditions (redesign.md §2.22) ─────────────────────────────────────────────

// The situation a battle decision is read in (policy.js situation, the plan on it), as named numbers: every numeric
// field of it flattened (a list or a set its count, a flag 0 or 1, a sum where its entries are numbers), and a few
// shares a player reads at a glance (the Monarch's peril, the HP it lacks). `u`, the piece deciding, adds its own
// (`self.*`). The learned tree's conditions are these names, each with a threshold (`value > at`); a new condition is
// one entry here (add, never rename: the labelled data and the shipped trees read them by name). A field the situation
// lacks (a lean read's) reads 0.
export function conditions (sit, u = null) {
  const m = sit.monarch
  const c = {
    turn: sit.turn ?? 0,
    patience: sit.patience ?? 0,
    monarch: m ? 1 : 0,
    'monarch.hp': m?.hp ?? 0,
    'monarch.share': m?.share ?? 0,
    'monarch.lack': m ? 1 - m.share : 0,
    'monarch.danger': m?.danger ?? 0,
    'monarch.peril': m ? Math.min(4, m.danger / Math.max(1, m.hp)) : 0,
    'monarch.lethal': m?.lethal ? 1 : 0,
    'monarch.threats': m?.threats?.length ?? 0,
    'monarch.screened': m?.screened?.length ?? 0
  }
  const roads = sit.roads ?? NONE
  let foes = 0
  let open = 0
  let soonest = 99
  for (const r of roads) {
    foes += r.foes.length
    if (r.held !== null) continue
    open += r.foes.length
    for (const f of r.foes) soonest = Math.min(soonest, f.turns)
  }
  c.roads = roads.length
  c['roads.open'] = roads.filter((r) => r.held === null).length
  c['roads.foes'] = foes
  c['roads.openFoes'] = open
  c['roads.soonest'] = soonest
  c.holding = sit.holding?.size ?? 0
  c['holding.foes'] = [...(sit.holding?.values() ?? NONE)].reduce((n, xs) => n + xs.length, 0)
  c['entries.ground'] = sum(sit.entries?.ground)
  c['entries.air'] = sum(sit.entries?.air)
  const pieces = sit.pieces ?? NONE
  c.pieces = pieces.length
  c['pieces.dies'] = pieces.filter((p) => p.dies).length
  c['pieces.danger'] = pieces.reduce((n, p) => n + p.danger, 0)
  c['pieces.acted'] = pieces.filter((p) => p.acted).length
  c['pieces.ready'] = pieces.reduce((n, p) => n + p.ready.length, 0)
  c.killable = sit.killable?.length ?? 0
  const theirs = sit.foes ?? NONE
  c.foes = theirs.length
  c['foes.hexed'] = theirs.filter((x) => x.hexed).length
  c['foes.ready'] = theirs.reduce((n, x) => n + x.ready.length, 0)
  c['foes.mends'] = theirs.filter((x) => x.mends).length
  c['healers.party'] = sit.healers?.party.length ?? 0
  c['healers.foe'] = sit.healers?.foe.length ?? 0
  c.healing = [...(sit.healing?.values() ?? NONE)].reduce((n, x) => n + x, 0)
  c['synergies.party'] = sit.synergies?.party.length ?? 0
  c['synergies.foe'] = sit.synergies?.foe.length ?? 0
  c['synergies.breaks'] = sit.synergies?.breaks.length ?? 0
  c['synergies.gains'] = sit.synergies?.gains.length ?? 0
  const w = sit.wave
  c.wave = w ? 1 : 0
  c['wave.due'] = w?.due ? 1 : 0
  c['wave.in'] = w ? w.turn - (sit.turn ?? 0) : 99
  c['wave.lanes'] = w?.lanes.length ?? 0
  c['wave.wave'] = w?.wave ?? 0
  c.shadows = sit.shadows ?? 0
  c.corpses = sit.corpses?.length ?? 0
  c['corpses.corpses'] = (sit.corpses ?? NONE).reduce((n, x) => n + x.corpses.length, 0)
  c.idle = sit.idle?.length ?? 0
  c['threat.foes'] = sit.threat?.foes.length ?? 0
  const P = sit.plan
  for (const k of PLANS) c[`plan.${k}`] = P?.kind === k ? 1 : 0
  c['plan.shooters'] = P?.shooters?.length ?? 0
  c['plan.kills'] = P?.kills?.length ?? 0
  c['plan.age'] = P ? (sit.turn ?? 0) - P.since : 0
  c['plan.quarry'] = P?.quarry?.length ?? 0
  c['plan.shooter'] = P?.kind === 'focus' && P.shooters?.includes(P.target) ? 1 : 0
  if (u) {
    const g = P?.goals?.get(u.uid)
    c['self.share'] = u.hp / u.maxHp
    const p = pieces.find((x) => x.uid === u.uid)
    c['self.danger'] = p ? p.danger / Math.max(1, u.hp) : 0
    c['self.dies'] = p?.dies ? 1 : 0
    c['self.listed'] = P?.listed?.has(u.uid) ? 1 : 0
    for (const r of ROLES) c[`self.${r}`] = g?.role === r ? 1 : 0
    c['self.flies'] = u.flies ? 1 : 0
    c['self.move'] = u.move ?? 0
  }
  return c
}
const PLANS = ['hold', 'focus', 'push', 'protect']
const ROLES = ['block', 'air', 'heal', 'shoot', 'strike', 'screen']
const NONE = Object.freeze([])
const sum = (xs) => {
  let n = 0
  for (const x of xs ?? NONE) n += x
  return n
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
  // The boards a turn's orders leave (policy.js judge, the static evaluation the fast turn's two boards are compared by;
  // features policy.js boardFeatures; `sit` the camp's patience, the plan's kind and how many shooters of the Monarch's
  // it read, as the turn began): its filters are keys, each above all that follows it.
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
  ],
  // An altar's rite (autoplay.js pickAltar: `o.action` the heal, a transmutation or a free tier; redesign.md §4.5). The
  // route's two reasons for walking to an altar (route's wounded-altar and monarch-altar, at their thresholds) are
  // reasons to heal at it: the sketch reads the souls' wounds, never the Monarch's.
  altar: [
    { id: 'wounded-heal', when: (sit) => sit.health < T().wounded, force: (opts) => opts.find((o) => o.action?.type === 'heal') },
    { id: 'monarch-heal', when: (sit) => !sit.unhealed && sit.monarch < T().altar, force: (opts) => opts.find((o) => o.action?.type === 'heal') }
  ]
}

// ── the learned decision tree (redesign.md §2.22) ────────────────────────────────────────────────

// One piece's move and act in battle (policy.js choice) is decided by a model tree held as data (an expert is a
// configuration, not code: src/sim/expert.json, the one in use; defaultExpert, today's scorer): its internal nodes split
// on a condition (conditions: a named number of the situation, `value > gt` the `then` branch), each leaf holds its own
// weights over the option features (policy.js features), and the soft rules (RULES) add a bonus to the options each
// prefers. Only legality is hard in a learned expert: what the game refuses is never an option. A rule may still be
// `hard` (today's: a filter, as decide's keep nodes), which is how the default reproduces the scorer before the tree
// was learned.
//   { name, about, tree, rules: [{ id, on, hard, strength, when }], options? }
//   options: 'shortlist' for a model fitted on today's shortlists (teach.js's labels): in play it decides among today's
//          shortlist and today's own choice (policy.js shortlisted), never among options it was never shown; else all.
//   tree:  { id?, if: <condition>, gt: <threshold>, then: <node>, else: <node> } | { leaf: <name>, w: { feature: weight },
//          by?: { <condition>: { feature: weight } } }   (`by`: weights added × that condition's value, the frail's)
//   when:  null (always) | { field: <condition>, op: 'gt' | 'le', at: <threshold> }
// A decision records its path (the conditions it passed) and its leaf, for the audit.

// The soft rules: each of today's hard rules (TREES.battle's filters, 2026-10-11) as an option's standing under it
// (`keep`, read off its features: the higher the better, as a filter's) and the condition it held in (`when`, today's).
export const RULES = {
  // An act that changes nothing (a heal on the whole, a ward or a debuff already at its full stacks) is no act.
  'no-waste': { keep: (v) => !v.waste, when: null },
  // The foes could fell the Monarch next turn: what brings their reach on it below its HP (a kill, a Hex, a piece on the
  // road).
  'monarch-lethal': { keep: (v) => !v.lethal, when: { field: 'monarch.lethal', op: 'gt', at: 0.5 } },
  // A foe that could strike the Monarch next turn, and can be felled now: felled first.
  'kill-first': { keep: (v) => v.cull > 0, when: { field: 'monarch.threats', op: 'gt', at: 0.5 } },
  // The Monarch's shooters first (redesign.md §2.18 B): while the plan is to fell one of them, a piece with a strike on
  // the kill list (which has them first) makes it. TREES.board's shooters-first, a piece's since the fast turn compares
  // no boards.
  'shooters-first': { keep: (v) => v.listed > 0, when: { field: 'plan.shooter', op: 'gt', at: 0.5 } },
  // A piece does not end where the danger map (or its blow's counter) says it falls, unless its act kills, shields the
  // Monarch, or wounds a foe that could strike the Monarch next turn.
  'never-die': { keep: (v) => !v.fall || v.kill > 0 || v.guard > 0 || v.harry > 0, when: null },
  // Protecting, a piece the formation gives a post (a road's block or air slot, a screen) ends on it where that spares
  // the Monarch a blow (redesign.md §2.18 B).
  'hold-the-line': { keep: (v) => v.post > 0 && v.guard > 0, when: { field: 'plan.protect', op: 'gt', at: 0.5 } }
}

// Whether a rule's condition holds on conditions `c`.
export const holds = (when, c) => !when || (when.op === 'le' ? (c[when.field] ?? 0) <= when.at : (c[when.field] ?? 0) > when.at)

// Today's scorer as a configuration (2026-10-11; before the tree was learned, the expert's TREES.battle and
// TUNING.expert.battle's option weights and modes): its rules hard and in today's order (shooters-first among them, off:
// as a piece's rule it cost 1.3 ± 0.8 progress on 256 seeds, the fast turn weighing the kill list's board instead), its
// tree the modes' (guard
// while the Monarch is within the foes' reach, protect and push the plan's, the press long past the last wave,
// TUNING.expert.tree.stall turns), each leaf the weights those modes leave, the frail's added × the share of its max HP
// the Monarch lacks while it is in reach or the plan is to close about it. Read from TUNING, so a tuned weight is
// today's too. Its decisions are today's, rule for rule (test/expert.test.js).
export function defaultExpert () {
  const W = TUNING.expert.battle
  const leaf = (guard, kind, press) => {
    let w = { ...W.option }
    const name = []
    if (guard) { w = { ...w, ...W.modes.guard }; name.push('guard') }
    if (kind === 'protect') { w = { ...w, ...W.modes.protect }; name.push('protect') }
    if (kind === 'push') { w = { ...w, ...W.modes.push }; name.push('push') }
    if (press) { w = { ...w, ...W.modes.press }; name.push('press') }
    const out = { leaf: name.join('+') || 'base', w }
    if (guard || kind === 'protect') out.by = { 'monarch.lack': { ...W.modes.frail } }
    return out
  }
  const press = (guard, kind) => ({ id: 'no-stall', if: 'patience', gt: TUNING.expert.tree.stall - 0.5, then: leaf(guard, kind, true), else: leaf(guard, kind, false) })
  const plan = (guard) => ({
    id: 'protect', if: 'plan.protect', gt: 0.5, then: press(guard, 'protect'),
    else: { id: 'push', if: 'plan.push', gt: 0.5, then: press(guard, 'push'), else: press(guard, null) }
  })
  return {
    name: 'today',
    about: 'today\'s scorer (2026-10-11): TREES.battle\'s rules hard, TUNING.expert.battle\'s weights and modes',
    tree: { id: 'guard', if: 'monarch.danger', gt: 0, then: plan(true), else: plan(false) },
    rules: ['no-waste', 'monarch-lethal', 'kill-first', 'shooters-first', 'never-die', 'hold-the-line'].map((id) => ({ id, on: id !== 'shooters-first', hard: true, strength: 0, when: RULES[id].when }))
  }
}

// The expert as it ships is one file, src/sim/expert.json beside this file (2026-10-13; the user: "combine"), read once
// (Node only: in a browser there is none, and the expert is today's scorer): at its top the model tree this module
// reads (name, about, tree, rules), and beside it the expert's other parts, each read by its own module from here:
//   forest      the battle forest (forest.js forestModel: each piece's move and act corrected)
//   outforest   the forests out of battle (outforest.js outForestModel: the recruit, the formation)
//   route       the learned route (autoplay.js routeModel, where ROUTE_LEARNED is on)
// A part the file lacks is none (today's for that decision). bundle.js writes the file from its parts.
let FILE
export function shippedFile () {
  if (FILE !== undefined) return FILE
  FILE = null
  try {
    const fs = globalThis.process?.getBuiltinModule?.('node:fs')
    const url = new URL('./expert.json', import.meta.url)
    if (fs?.existsSync(url)) FILE = JSON.parse(fs.readFileSync(url, 'utf8'))
  } catch {
    FILE = null
  }
  return FILE
}
// A part of the shipped expert (`forest`, `outforest`, `route`), or null where it ships none.
export const shippedPart = (name) => shippedFile()?.[name] ?? null

// The configuration in use: the shipped expert's model tree, else today's (defaultExpert); or what useExpert installed.
let MODEL = null
export function expertModel () {
  if (MODEL) return MODEL
  const shipped = shippedFile()
  return shipped ? (MODEL = checkModel(shipped)) : defaultExpert()
}
// Installs configuration `config` as the expert in use (null: back to expert.json, else today's). → the one in use.
export function useExpert (config) {
  MODEL = config ? checkModel(config) : null
  return expertModel()
}

// A configuration as decideTree reads it, checked: every leaf's weights finite, every rule known. → the configuration.
export function checkModel (config) {
  const walk = (n) => {
    if (n.leaf !== undefined) {
      for (const [k, x] of Object.entries(n.w)) if (!Number.isFinite(x)) throw new Error(`expert: leaf ${n.leaf}: weight ${k} is ${x}`)
      return
    }
    if (typeof n.if !== 'string' || !Number.isFinite(n.gt) || !n.then || !n.else) throw new Error(`expert: a malformed node ${JSON.stringify(n).slice(0, 80)}`)
    walk(n.then)
    walk(n.else)
  }
  walk(config.tree)
  for (const r of config.rules ?? NONE) if (!RULES[r.id]) throw new Error(`expert: unknown rule "${r.id}"`)
  return config
}

// The leaf conditions `c` come to, the path to it ({ id, if, gt, hi }: each node passed and the branch taken), and the
// weights in effect there (its own, and its `by` × each condition's value). → { leaf, path, w }
export function leafOf (model, c) {
  let n = model.tree
  const path = []
  while (n.leaf === undefined) {
    const hi = (c[n.if] ?? 0) > n.gt
    path.push({ id: n.id, if: n.if, gt: n.gt, hi })
    n = hi ? n.then : n.else
  }
  let w = n.w
  if (n.by) {
    for (const [field, add] of Object.entries(n.by)) {
      const k = c[field] ?? 0
      if (!(k !== 0)) continue
      if (w === n.w) w = { ...w }
      for (const key in add) w[key] += k * add[key]
    }
  }
  return { leaf: n, path, w }
}

// A path in words, for the audit: "monarch.danger>0 plan.protect≤0.5 → guard".
export const pathName = (r) => `${r.path.map((p) => `${p.if}${p.hi ? '>' : '≤'}${+p.gt.toFixed(3)}`).join(' ')} → ${r.leaf.leaf}`

// The tree's reading of one decision (conditions `c`): its leaf and weights (leafOf), its hard rules in force, in order,
// and its soft rules in force (each on, of a strength, its condition holding). → { leaf, path, w, hard, soft }
export function readTree (model, c) {
  const r = leafOf(model, c)
  r.hard = []
  r.soft = []
  for (const rule of model.rules ?? NONE) {
    if (!rule.on || !holds(rule.when, c)) continue
    if (rule.hard) r.hard.push(rule)
    else if (rule.strength) r.soft.push(rule)
  }
  return r
}

// An option's score under a reading (readTree): its leaf's weights over its features, and each soft rule's strength
// where the option keeps it (its standing, × the strength).
export function scoreOf (read, v) {
  let n = value(v, read.w)
  for (const rule of read.soft) n += rule.strength * +RULES[rule.id].keep(v)
  return n
}

// A reading's hard rules over options (each with its features `v`), in order, as decide's keep nodes: each keeps those it
// ranks highest, a rule that ranks them all alike passing. → { left, rules (each that filtered) }
export function hardFilter (read, options) {
  let left = options
  const rules = []
  for (const rule of read.hard) {
    if (left.length < 2) break
    const keep = RULES[rule.id].keep
    const ranks = left.map((o) => +keep(o.v))
    const top = Math.max(...ranks)
    if (ranks.every((x) => x === top)) continue
    left = left.filter((_, i) => ranks[i] === top)
    rules.push(rule.id)
  }
  return { left, rules }
}

// One decision by the model tree: options (each with its features `v`), conditions `c` (conditions(sit, u)); the hard
// rules filter, the leaf's weights and the soft rules score (`o.score`), the best taken (ties by `better`, else the
// first). → { option, by (the hard rule that filtered first, else the soft rule that changed the choice, else
// 'leaf <name>'), rules (the hard rules that filtered, then the named nodes passed on their `then` branch: today's
// modes), leaf (its name), path (pathName's), left (the options the hard rules left, each scored) }
export function decideTree (model, c, options, { better = null } = {}) {
  const read = readTree(model, c)
  const { left, rules } = hardFilter(read, options)
  let best = null
  let plain = null
  for (const o of left) {
    o.score = scoreOf(read, o.v)
    if (best === null || (better ? better(o, best) : o.score > best.score)) best = o
  }
  // The choice without the soft rules: where it differs, the soft rule that pulled the most toward this one decided.
  let by = rules[0]
  if (!by && read.soft.length && best) {
    let top = -Infinity
    for (const o of left) {
      const n = value(o.v, read.w)
      if (n > top) { top = n; plain = o }
    }
    if (plain !== best) {
      let most = 0
      for (const rule of read.soft) {
        const d = rule.strength * (+RULES[rule.id].keep(best.v) - +RULES[rule.id].keep(plain.v))
        if (d > most) { most = d; by = rule.id }
      }
    }
  }
  return {
    option: best,
    by: by ?? `leaf ${read.leaf.leaf}`,
    rules: [...rules, ...read.path.filter((p) => p.hi && p.id).map((p) => p.id)],
    leaf: read.leaf.leaf,
    path: pathName(read),
    left
  }
}
