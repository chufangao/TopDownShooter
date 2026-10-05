

// All game content: units, abilities, statuses, elements, kin and roles, synergies, relics and attack
// animations, plus id lookups. Data only; balance numbers live in tuning.js.

// ── units ────────────────────────────────────────────────────────────────────────────────────

// base + growth × (lvl − 1). `art` is the atlas key prefix: frames `${art}/${anim}/${n}`.

export const UNIT_LIST = [
  {
    id: 'bone_chanter',
    name: 'Bone Chanter',
    kin: 'undead',
    role: 'channeler',
    element: 'dark',
    tier: 2,
    base: { hp: 78, atk: 14, def: 6, spd: 22, acc: 40, eva: 12, crt: 5 },
    growth: { hp: 9, atk: 2.1, def: 0.6, spd: 1.2 },
    abilities: ['dirge', 'marrow_bolt'],
    spawn: { weight: 14, minFloor: 1 },
    art: 'core:bone_chanter'
  },
  {
    id: 'tomb_knight',
    name: 'Tomb Knight',
    kin: 'undead',
    role: 'vanguard',
    element: 'dark',
    tier: 2,
    base: { hp: 142, atk: 16, def: 22, spd: 12, acc: 45, eva: 6, crt: 4 },
    growth: { hp: 16, atk: 2.4, def: 2, spd: 0.5 },
    abilities: ['cleave', 'strike'],
    spawn: { weight: 10, minFloor: 1 },
    art: 'core:tomb_knight'
  },
  {
    id: 'ember_drake',
    name: 'Ember Drake',
    kin: 'drake',
    role: 'ranger',
    element: 'fire',
    tier: 3,
    base: { hp: 96, atk: 24, def: 10, spd: 26, acc: 52, eva: 14, crt: 12 },
    growth: { hp: 11, atk: 3.2, def: 0.9, spd: 1.4 },
    abilities: ['ember_arc', 'strike'],
    spawn: { weight: 8, minFloor: 2 },
    art: 'core:ember_drake'
  },
  {
    id: 'frost_sprite',
    name: 'Frost Sprite',
    kin: 'fae',
    role: 'skirmisher',
    element: 'frost',
    tier: 1,
    base: { hp: 54, atk: 15, def: 4, spd: 38, acc: 48, eva: 30, crt: 9 },
    growth: { hp: 6, atk: 2, def: 0.3, spd: 2.1 },
    abilities: ['frost_lance'],
    spawn: { weight: 12, minFloor: 1 },
    art: 'core:frost_sprite'
  },
  {
    id: 'hive_warden',
    name: 'Hive Warden',
    kin: 'insect',
    role: 'warden',
    element: 'physical',
    tier: 2,
    base: { hp: 110, atk: 13, def: 15, spd: 18, acc: 42, eva: 10, crt: 3 },
    growth: { hp: 13, atk: 1.6, def: 1.4, spd: 0.9 },
    abilities: ['mend', 'purge', 'strike'],
    spawn: { weight: 9, minFloor: 1 },
    art: 'core:hive_warden'
  },
  {
    id: 'clockwork_page',
    name: 'Clockwork Page',
    kin: 'construct',
    role: 'trickster',
    element: 'arcane',
    tier: 1,
    base: { hp: 68, atk: 12, def: 9, spd: 30, acc: 44, eva: 18, crt: 7 },
    growth: { hp: 7, atk: 1.7, def: 0.8, spd: 1.6 },
    abilities: ['purge', 'strike'],
    spawn: { weight: 12, minFloor: 1 },
    art: 'core:clockwork_page'
  },
  {
    // Bosses never spawn from the pool and cannot be persuaded.
    id: 'hollow_sovereign',
    name: 'The Hollow Sovereign',
    kin: 'undead',
    role: 'vanguard',
    element: 'dark',
    tier: 5,
    boss: true,
    base: { hp: 2800, atk: 65, def: 30, spd: 18, acc: 70, eva: 8, crt: 8 },
    growth: { hp: 280, atk: 6.5, def: 2, spd: 0.8 },
    abilities: ['grave_tide', 'sovereign_sweep', 'strike'],
    phases: [{ at: 0.6, grant: 'enraged' }, { at: 0.25, grant: 'desperate' }],
    art: 'core:hollow_sovereign'
  }
]

// ── abilities ────────────────────────────────────────────────────────────────────────────────

// `when(s)` gets { self, allies, enemies, t } (living units; allies includes self).
// The AI banks gauge for the first ability whose `when` passes, so gates keep pricey ones reachable.
const hpPct = (u) => u.hp / u.maxHp

const ABILITY_LIST = [
  {
    id: 'strike',
    name: 'Strike',
    castCost: 100,
    shape: 'single',
    melee: true,
    element: 'physical',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30, element: 'physical' }]
  },
  {
    id: 'cleave',
    name: 'Cleave',
    castCost: 140,
    shape: 'row',
    melee: true,
    element: 'physical',
    anim: 'melee_lunge',
    when: (s) => s.enemies.length >= 2,
    effects: [{ op: 'damage', power: 22, element: 'physical' }]
  },
  {
    id: 'marrow_bolt',
    name: 'Marrow Bolt',
    castCost: 100,
    shape: 'single',
    element: 'dark',
    anim: 'cast_beam',
    effects: [
      { op: 'damage', power: 34, element: 'dark' },
      { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.35 }
    ]
  },
  {
    id: 'dirge',
    name: 'Dirge',
    castCost: 180,
    shape: 'all_allies',
    element: 'dark',
    anim: 'cast_beam',
    when: (s) => s.t < 150,
    effects: [{ op: 'apply_status', status: 'hasten', dur: 100 }]
  },
  {
    id: 'ember_arc',
    name: 'Ember Arc',
    castCost: 160,
    shape: 'column',
    element: 'fire',
    anim: 'ranged_bolt',
    when: (s) => s.enemies.length >= 2,
    effects: [{ op: 'damage', power: 26, element: 'fire' }]
  },
  {
    id: 'frost_lance',
    name: 'Frost Lance',
    castCost: 120,
    shape: 'single',
    element: 'frost',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 30, element: 'frost' }, { op: 'gauge', amount: -20 }]
  },
  {
    id: 'mend',
    name: 'Mend',
    castCost: 130,
    shape: 'ally',
    element: 'holy',
    anim: 'cast_beam',
    when: (s) => s.allies.some((u) => hpPct(u) < 0.5),
    effects: [
      { op: 'heal', power: 28 },
      { op: 'apply_status', status: 'regen', dur: 200, chance: 0.5 }
    ]
  },
  {
    id: 'purge',
    name: 'Purge',
    castCost: 110,
    shape: 'ally',
    element: 'holy',
    anim: 'cast_beam',
    when: (s) => s.allies.some((u) => hpPct(u) < 0.9),
    effects: [{ op: 'cleanse', tag: 'debuff', count: 2 }, { op: 'heal', power: 8 }]
  },
  {
    id: 'sovereign_sweep',
    name: 'Sovereign Sweep',
    castCost: 150,
    shape: 'row',
    melee: true,
    element: 'physical',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 26, element: 'physical' }]
  },
  {
    id: 'grave_tide',
    name: 'Grave Tide',
    castCost: 260,
    shape: 'all',
    element: 'dark',
    anim: 'cast_beam',
    when: (s) => hpPct(s.self) <= 0.6,
    effects: [
      { op: 'damage', power: 24, element: 'dark' },
      { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.4 }
    ]
  }
]

// ── statuses ─────────────────────────────────────────────────────────────────────────────────

// dur is in ticks (20 per second); 'battle' lasts the fight. Tick effects fire every `tickEvery`.
const STATUS_LIST = [
  {
    id: 'brittle',
    name: 'Brittle',
    tags: ['debuff'],
    dur: 120,
    stacks: 3,
    mods: [{ path: 'def', op: 'mul', v: 0.75 }]
  },
  {
    id: 'hasten',
    name: 'Hasten',
    tags: ['buff'],
    dur: 100,
    stacks: 1,
    mods: [{ path: 'gauge.rate', op: 'mul', v: 1.25 }]
  },
  {
    id: 'regen',
    name: 'Regen',
    tags: ['buff'],
    dur: 200,
    stacks: 1,
    mods: [{ path: 'damage.taken', op: 'mul', v: 0.95 }],
    tick: [{ op: 'heal', power: 24 }],
    tickEvery: 20
  },
  {
    id: 'braced',
    name: 'Braced',
    tags: ['buff'],
    dur: 100,
    stacks: 1,
    mods: [{ path: 'damage.taken', op: 'mul', v: 0.6 }]
  },
  {
    id: 'enraged',
    name: 'Enraged',
    tags: ['buff'],
    dur: 'battle',
    stacks: 1,
    mods: [{ path: 'atk', op: 'mul', v: 1.35 }, { path: 'gauge.rate', op: 'mul', v: 1.2 }]
  },
  {
    id: 'desperate',
    name: 'Desperate',
    tags: ['buff'],
    dur: 'battle',
    stacks: 1,
    mods: [
      { path: 'damage.dealt', op: 'mul', v: 1.5 },
      { path: 'damage.taken', op: 'mul', v: 1.25 },
      { path: 'gauge.rate', op: 'mul', v: 1.15 }
    ]
  }
]

// ── elements ─────────────────────────────────────────────────────────────────────────────────

// affinity[defender element] on the attacking element; unlisted matchups are 1.
const ELEMENT_LIST = [
  { id: 'physical', name: 'Physical', tint: '#d8d4cc', affinity: {} },
  { id: 'fire', name: 'Fire', tint: '#ff7a33', affinity: { frost: 1.5, fire: 0.5 } },
  { id: 'frost', name: 'Frost', tint: '#66c8ff', affinity: { arcane: 1.5, frost: 0.5 } },
  { id: 'arcane', name: 'Arcane', tint: '#b57bff', affinity: { fire: 1.5, arcane: 0.5 } },
  { id: 'dark', name: 'Dark', tint: '#7a5c9e', affinity: { holy: 1.5, dark: 0.5 } },
  { id: 'holy', name: 'Holy', tint: '#ffe9a8', affinity: { dark: 2, holy: 0.5 } }
]

// ── kin and roles ────────────────────────────────────────────────────────────────────────────

const KIN_LIST = [
  { id: 'undead', name: 'Undead' },
  { id: 'construct', name: 'Construct' },
  { id: 'fae', name: 'Fae' },
  { id: 'insect', name: 'Insect' },
  { id: 'drake', name: 'Drake' }
]

// autoRow: 0 front, 1 mid, 2 back.
const ROLE_LIST = [
  { id: 'vanguard', name: 'Vanguard', autoRow: 0 },
  { id: 'skirmisher', name: 'Skirmisher', autoRow: 1 },
  { id: 'ranger', name: 'Ranger', autoRow: 2 },
  { id: 'channeler', name: 'Channeler', autoRow: 2 },
  { id: 'warden', name: 'Warden', autoRow: 1 },
  { id: 'trickster', name: 'Trickster', autoRow: 1 }
]

// ── synergies ────────────────────────────────────────────────────────────────────────────────

// Active while `active(counts)` holds for a side's living units; counts = { kin: {...}, role: {...} }.
// A mod with `row` (0 front, 1 mid, 2 back) only applies to units standing in that row.
const k = (c, id) => c.kin[id] ?? 0
const r = (c, id) => c.role[id] ?? 0

export const SYNERGIES = [
  { id: 'undead_2', name: 'Undead 2', desc: 'The dead do not flinch. +12% DEF.', active: (c) => k(c, 'undead') >= 2, mods: [{ path: 'def', op: 'mul', v: 1.12 }] },
  { id: 'undead_4', name: 'Undead 4', desc: '+30% DEF, +10% max HP.', active: (c) => k(c, 'undead') >= 4, mods: [{ path: 'def', op: 'mul', v: 1.3 }, { path: 'hp', op: 'mul', v: 1.1 }] },
  { id: 'drake_2', name: 'Drake 2', desc: '+15% ATK.', active: (c) => k(c, 'drake') >= 2, mods: [{ path: 'atk', op: 'mul', v: 1.15 }] },
  { id: 'fae_2', name: 'Fae 2', desc: '+8 EVA.', active: (c) => k(c, 'fae') >= 2, mods: [{ path: 'eva', op: 'add', v: 8 }] },
  { id: 'insect_2', name: 'Insect 2', desc: '+6% gauge rate.', active: (c) => k(c, 'insect') >= 2, mods: [{ path: 'gauge.rate', op: 'mul', v: 1.06 }] },
  { id: 'construct_2', name: 'Construct 2', desc: '+10 DEF.', active: (c) => k(c, 'construct') >= 2, mods: [{ path: 'def', op: 'add', v: 10 }] },
  { id: 'vanguard_2', name: 'Vanguard 2', desc: 'The front holds. +14% DEF.', active: (c) => r(c, 'vanguard') >= 2, mods: [{ path: 'def', op: 'mul', v: 1.14 }] },
  { id: 'ranger_3', name: 'Ranger 3', desc: 'The back row deals +25% damage.', active: (c) => r(c, 'ranger') >= 3, mods: [{ path: 'damage.dealt', op: 'mul', v: 1.25, row: 2 }] },
  { id: 'skirmisher_2', name: 'Skirmisher 2', desc: '+7 SPD.', active: (c) => r(c, 'skirmisher') >= 2, mods: [{ path: 'spd', op: 'add', v: 7 }] },
  { id: 'channeler_2', name: 'Channeler 2', desc: '+12% damage dealt.', active: (c) => r(c, 'channeler') >= 2, mods: [{ path: 'damage.dealt', op: 'mul', v: 1.12 }] },
  { id: 'warden_2', name: 'Warden 2', desc: '+25% healing given.', active: (c) => r(c, 'warden') >= 2, mods: [{ path: 'heal.given', op: 'mul', v: 1.25 }] },
  { id: 'trickster_2', name: 'Trickster 2', desc: '+6 CRT, +15 Charm.', active: (c) => r(c, 'trickster') >= 2, mods: [{ path: 'crt', op: 'add', v: 6 }, { path: 'charm', op: 'add', v: 15 }] },
  // Pacts: cross-axis recipes.
  { id: 'scaled_wall', name: 'Scaled Wall', desc: 'Drake 2 + Vanguard 2: the front row takes 20% less damage.', active: (c) => k(c, 'drake') >= 2 && r(c, 'vanguard') >= 2, mods: [{ path: 'damage.taken', op: 'mul', v: 0.8, row: 0 }] },
  { id: 'glamour', name: 'Glamour', desc: 'Fae 2 + Trickster 2: Parley works on foes up to 60% HP.', active: (c) => k(c, 'fae') >= 2 && r(c, 'trickster') >= 2, mods: [{ path: 'persuade.threshold', op: 'set', v: 0.6 }] },
  { id: 'swarm_logic', name: 'Swarm Logic', desc: 'Insect 4 + Skirmisher 2: +16% gauge rate.', active: (c) => k(c, 'insect') >= 4 && r(c, 'skirmisher') >= 2, mods: [{ path: 'gauge.rate', op: 'mul', v: 1.16 }] },
  { id: 'grave_vigil', name: 'Grave Vigil', desc: 'Undead 4 + Warden 2: +25% max HP.', active: (c) => k(c, 'undead') >= 4 && r(c, 'warden') >= 2, mods: [{ path: 'hp', op: 'mul', v: 1.25 }] },
  { id: 'ember_choir', name: 'Ember Choir', desc: 'Drake 2 + Channeler 2: +20% damage dealt, +6 CRT.', active: (c) => k(c, 'drake') >= 2 && r(c, 'channeler') >= 2, mods: [{ path: 'damage.dealt', op: 'mul', v: 1.2 }, { path: 'crt', op: 'add', v: 6 }] }
]

// ── relics ───────────────────────────────────────────────────────────────────────────────────

// Run-long party passives. `mods` apply to every party unit in battle (a `row` mod only in that
// row); `commands` adds Commands per battle; `brace` adds ticks to Braced.
export const RELIC_LIST = [
  { id: 'whetstone', name: 'Whetstone', desc: '+12% ATK.', mods: [{ path: 'atk', op: 'mul', v: 1.12 }] },
  { id: 'war_horn', name: 'War Horn', desc: '+1 Command per battle.', commands: 1 },
  { id: 'silver_tongue', name: 'Silver Tongue', desc: '+40 Charm: Parley succeeds more often.', mods: [{ path: 'charm', op: 'add', v: 40 }] },
  { id: 'hourglass', name: 'Hourglass', desc: '+10% gauge rate.', mods: [{ path: 'gauge.rate', op: 'mul', v: 1.1 }] },
  { id: 'heartwood', name: 'Heartwood', desc: '+15% max HP.', mods: [{ path: 'hp', op: 'mul', v: 1.15 }] },
  { id: 'iron_resolve', name: 'Iron Resolve', desc: 'Braced lasts 3 s longer.', brace: 60 },
  { id: 'tower_shield', name: 'Tower Shield', desc: 'The front row takes 15% less damage.', mods: [{ path: 'damage.taken', op: 'mul', v: 0.85, row: 0 }] },
  { id: 'longbow', name: 'Longbow', desc: 'The back row deals 20% more damage.', mods: [{ path: 'damage.dealt', op: 'mul', v: 1.2, row: 2 }] },
  { id: 'keen_eye', name: 'Keen Eye', desc: '+10 ACC, +8 CRT.', mods: [{ path: 'acc', op: 'add', v: 10 }, { path: 'crt', op: 'add', v: 8 }] },
  { id: 'balm', name: 'Balm', desc: '+30% healing given.', mods: [{ path: 'heal.given', op: 'mul', v: 1.3 }] },
  { id: 'envoy_seal', name: 'Envoy Seal', desc: 'Parley works on foes up to 45% HP.', mods: [{ path: 'persuade.threshold', op: 'set', v: 0.45 }] }
]

// ── attack animations ────────────────────────────────────────────────────────────────────────

// Attack templates played by TimelinePlayer. Times in ms; `who`/`at` name the actor or primary target.
const ANIM_LIST = [
  {
    id: 'melee_lunge',
    dur: 620,
    steps: [
      { t: 0, op: 'anim', who: 'actor', key: 'attack' },
      { t: 60, op: 'tween', who: 'actor', to: 'targetAdj', dur: 140, ease: 'Cubic.Out' },
      { t: 210, op: 'fx', at: 'target' },
      { t: 215, op: 'anim', who: 'target', key: 'hurt' },
      { t: 215, op: 'shake', mag: 5, dur: 120 },
      { t: 215, op: 'popup' },
      { t: 340, op: 'tween', who: 'actor', to: 'home', dur: 180, ease: 'Cubic.InOut' }
    ]
  },
  {
    id: 'ranged_bolt',
    dur: 540,
    steps: [
      { t: 0, op: 'anim', who: 'actor', key: 'attack' },
      { t: 120, op: 'projectile', from: 'actor', to: 'target', dur: 180 },
      { t: 300, op: 'fx', at: 'target' },
      { t: 305, op: 'anim', who: 'target', key: 'hurt' },
      { t: 305, op: 'popup' }
    ]
  },
  {
    id: 'cast_beam',
    dur: 760,
    steps: [
      { t: 0, op: 'anim', who: 'actor', key: 'cast' },
      { t: 80, op: 'fx', at: 'actor' },
      { t: 320, op: 'beam', from: 'actor', to: 'target', dur: 220 },
      { t: 420, op: 'anim', who: 'target', key: 'hurt' },
      { t: 420, op: 'popup' },
      { t: 560, op: 'anim', who: 'actor', key: 'idle' }
    ]
  }
]

// ── lookups ──────────────────────────────────────────────────────────────────────────────────

const byId = (list) => Object.fromEntries(list.map((d) => [d.id, d]))

export const UNITS = byId(UNIT_LIST)
export const ABILITIES = byId(ABILITY_LIST)
export const STATUSES = byId(STATUS_LIST)
export const ELEMENTS = byId(ELEMENT_LIST)
export const KIN = byId(KIN_LIST)
export const ROLES = byId(ROLE_LIST)
export const RELICS = byId(RELIC_LIST)
export const ANIMS = byId(ANIM_LIST)

function lookup (map, kind) {
  return (id) => {
    const d = map[id]
    if (!d) throw new Error(`unknown ${kind} "${id}"`)
    return d
  }
}

export const unitDef = lookup(UNITS, 'unit')
export const abilityDef = lookup(ABILITIES, 'ability')
export const statusDef = lookup(STATUSES, 'status')
export const elementDef = lookup(ELEMENTS, 'element')
export const relicDef = lookup(RELICS, 'relic')
export const animDef = lookup(ANIMS, 'anim')
