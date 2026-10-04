// The domain expr forms (§11.6), registered through the same `forms.register` door a mod uses.
//
// The kernel ships only domain-free forms — it must not know what a unit is. Everything that reads
// game state lives here, which is also what proves the extension seam works: if we could not
// express our own forms through it, a modder could not express theirs.
//
// All of these read an instance (`{uid, defId, …}`) and resolve its def through ctx.registry,
// because instances hold ids, not object references (§11.2).
//
// Each carries a type signature and a one-line description. That is not documentation: the Doctrine
// editor's dropdown at any position is *generated* from these signatures (§4.1), so a form without
// one is a form the player cannot reach — and a mod's form appears in the menu with no UI work,
// which is the whole payoff of having exactly one evaluator.

const defOf = (ctx, u) => ctx.registry.get('unit', u.defId)
const party = (ctx) => ctx.party ?? []

/** `unit` here means an instance the rule already has in hand — `$target`, `$self`, `$actor`. */
const META = {
  hpPct: { group: 'unit', label: 'HP %', desc: 'How much of its maximum a unit has left, 0–1.', sig: { args: ['unit'], returns: 'number' } },
  hp: { group: 'unit', label: 'HP', desc: 'Raw hit points remaining.', sig: { args: ['unit'], returns: 'number' } },
  lvl: { group: 'unit', label: 'level', desc: "A unit's level.", sig: { args: ['unit'], returns: 'number' } },
  alive: { group: 'unit', label: 'is alive', desc: 'Still standing.', sig: { args: ['unit'], returns: 'bool' } },

  kin: { group: 'unit', label: 'Kin', desc: 'Beast · Undead · Construct · Fae · Insect · Drake · Humanoid · Aberration.', sig: { args: ['unit'], returns: 'tag' } },
  role: { group: 'unit', label: 'Role', desc: 'Vanguard · Skirmisher · Ranger · Channeler · Warden · Trickster.', sig: { args: ['unit'], returns: 'tag' } },
  tier: { group: 'unit', label: 'tier', desc: 'How rare it is, 1–5. Higher is harder to persuade.', sig: { args: ['unit'], returns: 'number' } },
  element: { group: 'unit', label: 'element', desc: 'physical · fire · frost · arcane · dark · holy.', sig: { args: ['unit'], returns: 'tag' } },

  slot: { group: 'position', label: 'slot', desc: 'Grid position, 0–11.', sig: { args: ['unit'], returns: 'number' } },
  row: { group: 'position', label: 'row', desc: '0 front · 1 mid · 2 back.', sig: { args: ['unit'], returns: 'number' } },
  col: { group: 'position', label: 'column', desc: '0–3, left to right.', sig: { args: ['unit'], returns: 'number' } },

  attempts: { group: 'recruit', label: 'persuade attempts', desc: 'How many times this one has already been approached — each failure hardens them.', sig: { args: ['unit'], returns: 'number' } },

  hasTag: { group: 'unit', label: 'has tag', desc: 'Whether a unit carries a given Kin or Role.', sig: { args: ['unit', 'tag'], returns: 'bool' } },

  kinCount: { group: 'party', label: 'Kin count', desc: 'How many distinct roster units hold this Kin.', sig: { args: ['tag'], returns: 'number' } },
  roleCount: { group: 'party', label: 'Role count', desc: 'How many distinct roster units hold this Role.', sig: { args: ['tag'], returns: 'number' } },
  partySize: { group: 'party', label: 'party size', desc: 'How many units you own.', sig: { args: [], returns: 'number' } },
  partyFull: { group: 'party', label: 'party is full', desc: 'At the cap — a recruit now costs someone their slot.', sig: { args: [], returns: 'bool' } },

  enemyCount: { group: 'battle', label: 'enemies standing', desc: 'How many foes are still up.', sig: { args: [], returns: 'number' } },
  alliesBelow: { group: 'battle', label: 'allies below HP %', desc: 'How many living allies are under a given fraction.', sig: { args: ['number'], returns: 'number' } },
  tick: { group: 'battle', label: 'tick', desc: 'How long this fight has run, at 20 per second.', sig: { args: [], returns: 'number' } },

  coherence: { group: 'run', label: 'coherence', desc: 'Tag concentration, 0 spread to 1 monobuild. Multiplies Residue.', sig: { args: [], returns: 'number' } },
  floorNum: { group: 'run', label: 'floor', desc: 'Which floor the run is on.', sig: { args: [], returns: 'number' } },
  count: { group: 'data', label: 'count of', desc: 'How many items in a list.', sig: { args: ['list'], returns: 'number' } },

  // ── the three that read outside a battle, and are therefore legal in exactly one place ───────
  //
  // §11.6: "they are legal in a dispatch's `when` and illegal in an ability's, a Pact's or a
  // Doctrine rule's." `scope` is what makes that sentence enforceable — `forms.validate` refuses
  // them anywhere else, and `forms.list('dispatch')` is the only menu that offers them.
  signalCount: {
    group: 'ledger',
    label: 'times this happened',
    desc: 'How many times a signal fired this run (§4.3).',
    scope: 'dispatch',
    sig: { args: ['string'], returns: 'number' }
  },
  signalSince: {
    group: 'ledger',
    label: 'times this happened, since',
    desc: 'How many times a signal fired within one scope: battle, run or profile.',
    scope: 'dispatch',
    sig: { args: ['string', 'string'], returns: 'number' }
  },
  hasTenet: {
    group: 'ledger',
    label: 'has bought',
    desc: 'Whether a tenet has been bought (§4.2). For a report that is only worth making to someone who cannot yet express the answer.',
    scope: 'dispatch',
    sig: { args: ['string'], returns: 'bool' }
  }
}

/**
 * The same, for the kernel's own thirty built-ins.
 *
 * They live here rather than beside their implementations because the kernel must not know how a
 * person reads a form any more than it knows what a unit is — and §16.1 puts UI strings in the
 * content layer. `forms.describe()` is the seam; a localisation pack would use the same one.
 */
const STANDARD_META = {
  and: { group: 'logic', label: 'ALL of', desc: 'Every condition holds.', sig: { rest: 'bool', returns: 'bool' } },
  or: { group: 'logic', label: 'ANY of', desc: 'At least one condition holds.', sig: { rest: 'bool', returns: 'bool' } },
  if: { group: 'logic', label: 'if / then / else', desc: 'Pick one of two values.', sig: { args: ['bool', 'any', 'any'], returns: 'any' } },
  not: { group: 'logic', label: 'NOT', desc: 'Invert a condition.', sig: { args: ['bool'], returns: 'bool' } },

  eq: { group: 'compare', label: 'is', desc: 'Exactly equal.', sig: { args: ['any', 'any'], returns: 'bool' } },
  ne: { group: 'compare', label: 'is not', desc: 'Not equal.', sig: { args: ['any', 'any'], returns: 'bool' } },
  lt: { group: 'compare', label: '<', desc: 'Less than.', sig: { args: ['number', 'number'], returns: 'bool' } },
  lte: { group: 'compare', label: '≤', desc: 'At most.', sig: { args: ['number', 'number'], returns: 'bool' } },
  gt: { group: 'compare', label: '>', desc: 'Greater than.', sig: { args: ['number', 'number'], returns: 'bool' } },
  gte: { group: 'compare', label: '≥', desc: 'At least.', sig: { args: ['number', 'number'], returns: 'bool' } },

  add: { group: 'maths', label: '+', desc: 'Sum.', sig: { rest: 'number', returns: 'number' } },
  sub: { group: 'maths', label: '−', desc: 'Difference.', sig: { args: ['number', 'number'], returns: 'number' } },
  mul: { group: 'maths', label: '×', desc: 'Product.', sig: { rest: 'number', returns: 'number' } },
  div: { group: 'maths', label: '÷', desc: 'Quotient; dividing by zero gives zero.', sig: { args: ['number', 'number'], returns: 'number' } },
  mod: { group: 'maths', label: 'remainder', desc: 'Remainder after division.', sig: { args: ['number', 'number'], returns: 'number' } },
  min: { group: 'maths', label: 'smallest of', desc: 'The lowest value given.', sig: { rest: 'number', returns: 'number' } },
  max: { group: 'maths', label: 'largest of', desc: 'The highest value given.', sig: { rest: 'number', returns: 'number' } },
  clamp: { group: 'maths', label: 'clamp', desc: 'Hold a value between a floor and a ceiling.', sig: { args: ['number', 'number', 'number'], returns: 'number' } },
  abs: { group: 'maths', label: 'absolute', desc: 'Drop the sign.', sig: { args: ['number'], returns: 'number' } },
  floor: { group: 'maths', label: 'round down', desc: 'Toward zero.', sig: { args: ['number'], returns: 'number' } },
  ceil: { group: 'maths', label: 'round up', desc: 'Away from zero.', sig: { args: ['number'], returns: 'number' } },
  round: { group: 'maths', label: 'round', desc: 'To the nearest whole number.', sig: { args: ['number'], returns: 'number' } },
  pow: { group: 'maths', label: 'to the power of', desc: 'Exponent.', sig: { args: ['number', 'number'], returns: 'number' } },

  lit: { group: 'data', label: 'literal', desc: 'A value, never evaluated as a rule.', sig: { args: ['any'], returns: 'any' } },
  var: { group: 'data', label: 'variable', desc: 'A bound value, with a fallback if it is absent.', sig: { args: ['string', 'any'], returns: 'any' } },
  len: { group: 'data', label: 'length of', desc: 'How many items.', sig: { args: ['list'], returns: 'number' } },
  at: { group: 'data', label: 'item at', desc: 'One item out of a list.', sig: { args: ['list', 'number'], returns: 'any' } },
  includes: { group: 'data', label: 'contains', desc: 'Whether a list holds a value.', sig: { args: ['list', 'any'], returns: 'bool' } },
  list: { group: 'data', label: 'list of', desc: 'Build a list.', sig: { rest: 'any', returns: 'list' } },

  rand: { group: 'chance', label: 'random 0–1', desc: 'From the seeded stream — never the clock.', sig: { args: [], returns: 'number' } },
  rand_int: { group: 'chance', label: 'random integer', desc: 'From the seeded stream — never the clock.', sig: { args: ['number'], returns: 'number' } }
}

/** Give the kernel's built-ins their editor-facing half. Called once, at boot, before packs load. */
export function describeStandardForms (forms) {
  for (const [name, meta] of Object.entries(STANDARD_META)) {
    if (forms.has(name)) forms.describe(name, meta)
  }
  return forms
}

export function registerDomainForms (forms) {
  describeStandardForms(forms)
  const F = (name, arity, fn) => forms.register(name, { arity, fn, ...META[name] })

  F('hpPct', [1, 1], (a) => {
    const u = a[0]
    return u && u.maxHp > 0 ? u.hp / u.maxHp : 0
  })
  F('hp', [1, 1], (a) => a[0]?.hp ?? 0)
  F('lvl', [1, 1], (a) => a[0]?.lvl ?? 1)
  F('alive', [1, 1], (a) => (a[0]?.hp ?? 0) > 0)

  F('kin', [1, 1], (a, ctx) => defOf(ctx, a[0]).kin)
  F('role', [1, 1], (a, ctx) => defOf(ctx, a[0]).role)
  F('tier', [1, 1], (a, ctx) => defOf(ctx, a[0]).tier)
  F('element', [1, 1], (a, ctx) => defOf(ctx, a[0]).element)

  // Position is a first-class mechanic (§3): slot 0..11 in a 3×4 grid, row = slot / 4.
  F('slot', [1, 1], (a) => a[0]?.slot ?? -1)
  F('row', [1, 1], (a) => (a[0]?.slot >= 0 ? Math.floor(a[0].slot / 4) : -1))
  F('col', [1, 1], (a) => (a[0]?.slot >= 0 ? a[0].slot % 4 : -1))

  // Each failure hardens them (§2), so a Recruit rule that does not read this will keep spending
  // gauge on a mark that is now nearly impossible.
  F('attempts', [1, 1], (a) => a[0]?.persuadeAttempts ?? 0)

  F('hasTag', [2, 2], (a, ctx) => {
    const def = defOf(ctx, a[0])
    return def.kin === a[1] || def.role === a[1]
  })

  // Synergies count DISTINCT units holding a tag (§3) — the TFT-shaped trait engine.
  F('kinCount', [1, 1], (a, ctx) => party(ctx).filter((u) => defOf(ctx, u).kin === a[0]).length)
  F('roleCount', [1, 1], (a, ctx) => party(ctx).filter((u) => defOf(ctx, u).role === a[0]).length)
  F('partySize', [0, 0], (a, ctx) => party(ctx).length)
  F('partyFull', [0, 0], (a, ctx) => party(ctx).length >= (ctx.partyCap ?? 12))

  F('enemyCount', [0, 0], (a, ctx) => (ctx.enemies ?? []).filter((u) => u.hp > 0).length)
  F('alliesBelow', [1, 1], (a, ctx) => party(ctx).filter((u) => u.hp > 0 && u.hp / u.maxHp < a[0]).length)

  F('coherence', [0, 0], (a, ctx) => ctx.coherence ?? 0)
  F('floorNum', [0, 0], (a, ctx) => ctx.run?.floor ?? 0)
  F('tick', [0, 0], (a, ctx) => ctx.t ?? 0)
  F('count', [1, 1], (a) => (Array.isArray(a[0]) ? a[0].length : 0))

  // ── the ledger forms (§4.3), legal only in a dispatch's `when` ───────────────────────────────
  //
  // `ctx.signals` is supplied by `dispatch.js` and by nothing else. A battle context has no such
  // field, so even if the scope check in `forms.validate` were somehow bypassed — a hand-edited
  // save, a mod calling `forms.eval` directly — these read zero rather than reaching into save
  // history from inside a fight. Two locks on the same door, because it is the door §18.5 depends
  // on staying shut.
  F('signalCount', [1, 1], (a, ctx) => ctx.signals?.count(String(a[0]), 'run') ?? 0)
  F('signalSince', [2, 2], (a, ctx) => ctx.signals?.count(String(a[0]), String(a[1])) ?? 0)

  // Used sparingly and never to withhold a report. A measurement is worth making whether or not the
  // reader could act on it — the one honest use is a report whose *wording* only makes sense to
  // somebody who has already bought the thing it is measuring.
  F('hasTenet', [1, 1], (a, ctx) => (ctx.doctrine?.tenets ?? []).includes(a[0]))

  return forms
}

/**
 * The variables a rule can name, per editor. `$target` means different things in a Recruit rule and
 * an Ability rule, and the editor has to know which are legal where — otherwise its dropdown offers
 * a chip that throws `unbound variable` the first time the rule is evaluated.
 */
export const RULE_VARS = {
  recruit: [
    { id: '$target', label: 'the enemy', desc: 'The foe this rule is being asked about.', type: 'unit' },
    { id: '$self', label: 'the unit deciding', desc: 'Whoever is about to spend its gauge.', type: 'unit' }
  ],
  ability: [
    { id: '$self', label: 'the unit acting', desc: 'Whoever is about to spend its gauge.', type: 'unit' },
    { id: '$actor', label: 'the unit acting', desc: 'Same as $self.', type: 'unit' }
  ],
  branch: [
    { id: '$self', label: 'the unit that levelled', desc: 'Whoever just reached the branch.', type: 'unit' }
  ]
}
