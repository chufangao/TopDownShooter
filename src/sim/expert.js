// The expert's judgement, one shape for every decision: a situation read from what a player sees (policy.js situation,
// autoplay.js survey), its options as named feature vectors (`v`), then two layers, each decision naming its rule (`by`):
//   1. the tree (TREES): hard rules in order; a node whose `when` holds forces an option (`force`), keeps those it ranks
//      highest (`keep`), switches the weights to a mode (`mode`) or adds a mode's × `scale` (`add`)
//   2. the weights (TUNING.expert): their sum over the features (value) scores what the tree left, the best taken.
// A piece's move and act in battle is decided by the model tree below instead (decideTree).
import { TUNING } from '../tuning.js'

// The weighted sum of a feature vector. A feature missing from its table is NaN (the tests hold every vector to its table).
export function value (v, w) {
  let n = 0
  for (const k in v) n += w[k] * v[k]
  return n
}

// One decision: `options` (each with its features `v`), `sit`, `tree`, `weights` (`modes`: the sets a mode node switches
// to); ties keep the first unless `better(o, best)`. → { option (null for none), by, rules (every rule fired, in order) }
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

// The tree's filters as a candidate's standing (each holding filter's `keep`, in order), for a one-at-a-time search.
export const standing = (tree, sit, o) => tree.filter((n) => n.keep && n.when(sit)).map((n) => +n.keep(o, sit))
// Whether candidate `a` ({ keys, score }) beats `b`: → the index of the first key it wins on, keys.length on the score, else −1.
export function outranks (a, b) {
  for (let i = 0; i < a.keys.length; i++) if (a.keys[i] !== b.keys[i]) return a.keys[i] > b.keys[i] ? i : -1
  return a.score > b.score ? a.keys.length : -1
}

// ── the vocabulary of conditions ─────────────────────────────────────────────────────────────────

// The situation of a battle decision (policy.js situation, the plan on it) as named numbers: each numeric field flattened
// (a list its count, a flag 0 or 1), a few shares, and with `u` the piece's own (`self.*`). The learned trees and the
// labelled data read these names: add, never rename. A field the situation lacks reads 0.
export function conditions (sit, u = null) {
  const m = sit.monarch
  const roads = sit.roads ?? NONE
  let foes = 0
  let open = 0
  let soonest = 99
  let unheld = 0
  for (const r of roads) {
    foes += r.foes.length
    if (r.held !== null) continue
    unheld++
    open += r.foes.length
    for (const f of r.foes) soonest = Math.min(soonest, f.turns)
  }
  let held = 0
  for (const xs of sit.holding?.values() ?? NONE) held += xs.length
  const pieces = sit.pieces ?? NONE
  let dies = 0
  let danger = 0
  let acted = 0
  let ready = 0
  for (const p of pieces) if (p.dies) dies++
  for (const p of pieces) danger += p.danger
  for (const p of pieces) if (p.acted) acted++
  for (const p of pieces) ready += p.ready.length
  const theirs = sit.foes ?? NONE
  let hexed = 0
  let primed = 0
  let mends = 0
  for (const x of theirs) if (x.hexed) hexed++
  for (const x of theirs) primed += x.ready.length
  for (const x of theirs) if (x.mends) mends++
  let healing = 0
  for (const x of sit.healing?.values() ?? NONE) healing += x
  let raisable = 0
  for (const x of sit.corpses ?? NONE) raisable += x.corpses.length
  const w = sit.wave
  const P = sit.plan
  // One literal, its keys in the vocabulary's order (the rows' and the trees' names).
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
    'monarch.screened': m?.screened?.length ?? 0,
    roads: roads.length,
    'roads.open': unheld,
    'roads.foes': foes,
    'roads.openFoes': open,
    'roads.soonest': soonest,
    holding: sit.holding?.size ?? 0,
    'holding.foes': held,
    'entries.ground': sum(sit.entries?.ground),
    'entries.air': sum(sit.entries?.air),
    pieces: pieces.length,
    'pieces.dies': dies,
    'pieces.danger': danger,
    'pieces.acted': acted,
    'pieces.ready': ready,
    killable: sit.killable?.length ?? 0,
    foes: theirs.length,
    'foes.hexed': hexed,
    'foes.ready': primed,
    'foes.mends': mends,
    'healers.party': sit.healers?.party.length ?? 0,
    'healers.foe': sit.healers?.foe.length ?? 0,
    healing,
    'synergies.party': sit.synergies?.party.length ?? 0,
    'synergies.foe': sit.synergies?.foe.length ?? 0,
    'synergies.breaks': sit.synergies?.breaks.length ?? 0,
    'synergies.gains': sit.synergies?.gains.length ?? 0,
    wave: w ? 1 : 0,
    'wave.due': w?.due ? 1 : 0,
    'wave.in': w ? w.turn - (sit.turn ?? 0) : 99,
    'wave.lanes': w?.lanes.length ?? 0,
    'wave.wave': w?.wave ?? 0,
    shadows: sit.shadows ?? 0,
    corpses: sit.corpses?.length ?? 0,
    'corpses.corpses': raisable,
    idle: sit.idle?.length ?? 0,
    'threat.foes': sit.threat?.foes.length ?? 0,
    'plan.hold': P?.kind === 'hold' ? 1 : 0,
    'plan.focus': P?.kind === 'focus' ? 1 : 0,
    'plan.push': P?.kind === 'push' ? 1 : 0,
    'plan.protect': P?.kind === 'protect' ? 1 : 0,
    'plan.shooters': P?.shooters?.length ?? 0,
    'plan.kills': P?.kills?.length ?? 0,
    'plan.age': P ? (sit.turn ?? 0) - P.since : 0,
    'plan.quarry': P?.quarry?.length ?? 0,
    'plan.shooter': P?.kind === 'focus' && P.shooters?.includes(P.target) ? 1 : 0
  }
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
const ROLES = ['block', 'air', 'heal', 'shoot', 'strike', 'screen']
const NONE = Object.freeze([])
const sum = (xs) => {
  const list = xs ?? NONE
  let n = 0
  for (let i = 0; i < list.length; i++) n += list[i]
  return n
}

// The hard rules, a decision's list apiece. Each reads the situation (`sit`) and an option's features (`o.v`) only.
const T = () => TUNING.expert.tree
// The rooms that are battles (map.js types).
const BATTLES = new Set(['fight', 'elite', 'siege', 'boss'])
export const TREES = {
  // The battle plan, once a turn (plan.js readPlan; `sit`: trigger, prev, patience, reach, shooters, fellable, healer, waiting).
  plan: [
    // A plan stands until something changes it: no dithering, and a walk that spans turns.
    { id: 'keep-plan', when: (sit) => sit.trigger === null, force: (plans, sit) => plans.find((o) => o.kind === sit.prev.kind && o.target === sit.prev.target) },
    // A foe whose ranged blow reaches the Monarch now or next turn is the focus; where none such can be felled, protect.
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
  // The boards a turn's orders leave (policy.js judge, boardFeatures): its filters are keys, each above all after it.
  board: [
    // Never a board where the foes could fell the Monarch next turn, where another is not.
    { id: 'no-doom', when: () => true, keep: (o) => !o.v.doom },
    // The Monarch's shooters first: the boards that leave the fewest of them standing.
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
    // A scouted flyer met by a field that can strike one, where any formation fields such a piece.
    { id: 'answer-air', when: (ctx) => !!ctx?.foes?.some((f) => f.flies), keep: (o) => o.v.air > 0 },
    // The roads into the Monarch held: as few scouted foes' roads open to the seat as the pieces allow.
    { id: 'block-roads', when: () => true, keep: (o) => -o.v.open }
  ],
  // The next room (autoplay.js pickRoute; features autoplay.js roomFeatures; `o.node` the room).
  route: [
    // A badly wounded army (TUNING.expert.tree.wounded) takes an altar where one is open,
    { id: 'wounded-altar', when: (sit) => sit.health < T().wounded, force: (rooms) => rooms.find((o) => o.node.type === 'altar') },
    // and so does a wounded Monarch (below TUNING.expert.tree.altar of its HP), where an altar may heal it.
    { id: 'monarch-altar', when: (sit) => !sit.unhealed && sit.monarch < T().altar, force: (rooms) => rooms.find((o) => o.node.type === 'altar') },
    // A badly wounded army never walks into an elite where another room is open,
    { id: 'wounded-no-elite', when: (sit) => sit.health < T().wounded, keep: (o) => o.node.type !== 'elite' },
    // nor does a Monarch below TUNING.expert.tree.elite of its HP.
    { id: 'monarch-no-elite', when: (sit) => sit.monarch < T().elite, keep: (o) => o.node.type !== 'elite' },
    // Never a battle the army is the underdog in (log odds below TUNING.expert.tree.odds) where another room is open.
    { id: 'no-long-odds', when: () => true, keep: (o) => (BATTLES.has(o.node.type) ? Math.min(o.v.odds, T().odds) : T().odds) }
  ],
  // A relic given, kept or taken back out of battle (autoplay.js pickHold: `o.free`, a hold onto a free slot).
  hold: [
    // A piece relic waiting works for no one: given, where a standing soul has a free slot.
    { id: 'give-relic', when: (sit) => sit.relics.unheld.length > 0 && sit.relics.free > 0, keep: (o) => !!o.free }
  ],
  // An altar's rite (autoplay.js pickAltar: `o.action`): the heal, for the route's reason to walk to an altar.
  altar: [
    { id: 'monarch-heal', when: (sit) => !sit.unhealed && sit.monarch < T().altar, force: (opts) => opts.find((o) => o.action?.type === 'heal') }
  ]
}

// ── the learned decision tree ────────────────────────────────────────────────────────────────────

// One piece's move and act in battle (policy.js choice) is decided by a model tree held as data (src/sim/expert.json;
// defaultExpert, today's scorer): nodes split on a condition, each leaf holds weights over the option features, and the
// soft rules (RULES) add a bonus to the options each prefers; a rule may be `hard` (a filter, as decide's keep). The file:
//   { name, about, tree, rules: [{ id, on, hard, strength, when }], options? }
//   options  'shortlist': decides among today's shortlist and today's choice (policy.js shortlisted); else all
//   tree     { id?, if: <condition>, gt: <threshold>, then: <node>, else: <node> } | { leaf: <name>, w: { feature: weight },
//            by?: { <condition>: { feature: weight } } }   (`by`: weights added × that condition's value)
//   when     null (always) | { field: <condition>, op: 'gt' | 'le', at: <threshold> }

// The soft rules: each hard rule of today's as an option's standing under it (`keep`, off its features: the higher the
// better) and the condition it holds in (`when`).
export const RULES = {
  // An act that changes nothing (a heal on the whole, a ward or a debuff already at its full stacks) is no act.
  'no-waste': { keep: (v) => !v.waste, when: null },
  // The foes could fell the Monarch next turn: what brings their reach on it below its HP.
  'monarch-lethal': { keep: (v) => !v.lethal, when: { field: 'monarch.lethal', op: 'gt', at: 0.5 } },
  // A foe that could strike the Monarch next turn, and can be felled now: felled first.
  'kill-first': { keep: (v) => v.cull > 0, when: { field: 'monarch.threats', op: 'gt', at: 0.5 } },
  // While the plan is to fell one of the Monarch's shooters, a piece with a strike on the kill list makes it.
  'shooters-first': { keep: (v) => v.listed > 0, when: { field: 'plan.shooter', op: 'gt', at: 0.5 } },
  // A piece does not end where it would fall, unless its act kills, shields the Monarch or wounds one of its threats.
  'never-die': { keep: (v) => !v.fall || v.kill > 0 || v.guard > 0 || v.harry > 0, when: null },
  // Protecting, a piece given a post (a block, an air slot, a screen) ends on it where that spares the Monarch a blow.
  'hold-the-line': { keep: (v) => v.post > 0 && v.guard > 0, when: { field: 'plan.protect', op: 'gt', at: 0.5 } }
}

// Whether a rule's condition holds on conditions `c`.
export const holds = (when, c) => !when || (when.op === 'le' ? (c[when.field] ?? 0) <= when.at : (c[when.field] ?? 0) > when.at)

// Today's scorer as a configuration: the six RULES hard, in order (shooters-first off), its tree the modes' (guard, the
// plan's protect and push, press), each leaf those modes' weights, the frail's added × monarch.lack. Read from TUNING.
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

// The expert as it ships: src/sim/expert.json, read once (Node only: in a browser the expert is today's scorer). At its
// top the model tree (name, about, tree, rules); beside it the other parts, each read by its own module:
//   forest      the battle forest (forest.js forestModel)
//   outforest   the forests out of battle (outforest.js outForestModel: the recruit, the formation)
//   route       the learned route (autoplay.js routeModel, where ROUTE_LEARNED is on)
// A part the file lacks is none. bundle.js writes the file.
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

// The leaf conditions `c` come to, the path there ({ id, if, gt, hi }), and the weights in effect (with `by`'s). → { leaf, path, w }
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

// The tree's reading of conditions `c`: leafOf's, and the hard and soft rules in force, in order. → { leaf, path, w, hard, soft }
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

// An option's score under a reading: its leaf's weights over its features, plus each soft rule's strength it keeps.
export function scoreOf (read, v) {
  let n = value(v, read.w)
  for (const rule of read.soft) n += rule.strength * +RULES[rule.id].keep(v)
  return n
}

// A reading's hard rules over options, in order, each keeping those it ranks highest. → { left, rules (each that filtered) }
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

// One decision by the model tree under conditions `c`: the hard rules filter, the leaf's weights and the soft rules score
// (`o.score`), the best taken (ties by `better`). → { option, by (the first hard rule that filtered, else the soft rule
// that changed the choice, else 'leaf <name>'), rules (hard rules, then named nodes passed on `then`), leaf, path, left }
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
