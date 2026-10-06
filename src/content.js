// All game content: units, abilities, statuses, elements, kin and roles, behaviours, synergies, bonds,
// camps, relics and attack animations, plus id lookups. Data only; balance numbers live in tuning.js.

// ── units ────────────────────────────────────────────────────────────────────────────────────

// base + growth × (lvl − 1). `art` names the unit's three pictures in `assets/units/`: `${art}.alive.svg`,
// `${art}.attack.svg` and `${art}.dead.svg` (see artUrl). The battle animates them in code: no frames.
// `aura`: mods every ally (not itself) within `range` tiles gets while it stands.

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
    art: 'bone_chanter'
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
    aura: { range: 1, desc: 'Allies next to it take 15% less damage.', mods: [{ path: 'damage.taken', op: 'mul', v: 0.85 }] },
    spawn: { weight: 10, minFloor: 1 },
    art: 'tomb_knight'
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
    abilities: ['ember_burst', 'strike'],
    spawn: { weight: 8, minFloor: 2 },
    art: 'ember_drake'
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
    art: 'frost_sprite'
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
    art: 'hive_warden'
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
    art: 'clockwork_page'
  },
  {
    id: 'grave_ghoul',
    name: 'Grave Ghoul',
    kin: 'undead',
    role: 'vanguard',
    element: 'physical',
    tier: 1,
    base: { hp: 96, atk: 13, def: 9, spd: 18, acc: 42, eva: 10, crt: 6 },
    growth: { hp: 11, atk: 1.8, def: 0.8, spd: 0.9 },
    abilities: ['gnaw', 'strike'],
    spawn: { weight: 13, minFloor: 1 },
    art: 'grave_ghoul'
  },
  {
    id: 'will_o_wisp',
    name: "Will-o'-Wisp",
    kin: 'fae',
    role: 'channeler',
    element: 'arcane',
    tier: 1,
    base: { hp: 50, atk: 15, def: 3, spd: 32, acc: 46, eva: 28, crt: 6 },
    growth: { hp: 6, atk: 2.1, def: 0.3, spd: 1.8 },
    abilities: ['witchfire'],
    spawn: { weight: 11, minFloor: 1 },
    art: 'will_o_wisp'
  },
  {
    id: 'thorn_dryad',
    name: 'Thorn Dryad',
    kin: 'fae',
    role: 'warden',
    element: 'holy',
    tier: 2,
    base: { hp: 104, atk: 12, def: 12, spd: 20, acc: 42, eva: 14, crt: 3 },
    growth: { hp: 12, atk: 1.6, def: 1.1, spd: 1 },
    abilities: ['barkskin', 'mend', 'strike'],
    spawn: { weight: 9, minFloor: 2 },
    art: 'thorn_dryad'
  },
  {
    id: 'mantis_reaper',
    name: 'Mantis Reaper',
    kin: 'insect',
    role: 'trickster',
    element: 'physical',
    tier: 3,
    base: { hp: 92, atk: 25, def: 9, spd: 32, acc: 50, eva: 20, crt: 16 },
    growth: { hp: 10, atk: 3.1, def: 0.8, spd: 1.8 },
    abilities: ['reap', 'strike'],
    spawn: { weight: 7, minFloor: 2 },
    art: 'mantis_reaper'
  },
  {
    id: 'iron_golem',
    name: 'Iron Golem',
    kin: 'construct',
    role: 'vanguard',
    element: 'physical',
    tier: 3,
    base: { hp: 220, atk: 17, def: 30, spd: 9, acc: 44, eva: 2, crt: 3 },
    growth: { hp: 22, atk: 2.2, def: 2.4, spd: 0.4 },
    abilities: ['quake', 'strike'],
    spawn: { weight: 6, minFloor: 2 },
    art: 'iron_golem'
  },
  {
    id: 'barrow_wight',
    name: 'Barrow Wight',
    kin: 'undead',
    role: 'skirmisher',
    element: 'dark',
    tier: 4,
    base: { hp: 128, atk: 27, def: 13, spd: 30, acc: 52, eva: 22, crt: 10 },
    growth: { hp: 14, atk: 3.4, def: 1.1, spd: 1.6 },
    abilities: ['wither', 'strike'],
    spawn: { weight: 6, minFloor: 3 },
    art: 'barrow_wight'
  },
  {
    id: 'frost_wyrm',
    name: 'Frost Wyrm',
    kin: 'drake',
    role: 'ranger',
    element: 'frost',
    tier: 4,
    base: { hp: 190, atk: 29, def: 16, spd: 16, acc: 50, eva: 6, crt: 8 },
    growth: { hp: 20, atk: 3.4, def: 1.5, spd: 0.7 },
    abilities: ['glacial_breath', 'strike'],
    spawn: { weight: 6, minFloor: 3 },
    art: 'frost_wyrm'
  },
  {
    // Bosses never spawn from the pool and leave no soul.
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
    art: 'hollow_sovereign'
  }
]

// ── abilities ────────────────────────────────────────────────────────────────────────────────

// Shapes: single, ally, self; row (everyone level with the target), column (its lane); blast (the
// target and everyone next to it, aimed where they stand thickest); all, all_allies (within `range`).
// `when(s)` gets { self, allies, enemies, t } (living units; allies includes self); `cond` says the
// same in words for tooltips. The AI banks gauge for the first ability whose `when` passes and that
// has a target in reach, so gates keep pricey ones reachable. Reach: melee hits the 8 tiles around,
// `range` is in tiles, and ally abilities and `all` reach the whole board.
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
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 22, element: 'physical' }]
  },
  {
    id: 'marrow_bolt',
    name: 'Marrow Bolt',
    castCost: 100,
    shape: 'single',
    range: 4,
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
    range: 2,
    element: 'dark',
    anim: 'cast_beam',
    when: (s) => s.t < 150,
    cond: 'in the first 7.5 s of a battle',
    effects: [{ op: 'apply_status', status: 'hasten', dur: 100 }]
  },
  {
    id: 'ember_burst',
    name: 'Ember Burst',
    castCost: 160,
    shape: 'blast',
    range: 4,
    element: 'fire',
    anim: 'ranged_bolt',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 26, element: 'fire' }]
  },
  {
    id: 'frost_lance',
    name: 'Frost Lance',
    castCost: 120,
    shape: 'single',
    range: 3,
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
    cond: 'while an ally is below 50% HP',
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
    cond: 'while an ally is below 90% HP',
    effects: [{ op: 'cleanse', tag: 'debuff', count: 2 }, { op: 'heal', power: 8 }]
  },
  {
    id: 'gnaw',
    name: 'Gnaw',
    castCost: 110,
    shape: 'single',
    melee: true,
    element: 'physical',
    anim: 'melee_lunge',
    effects: [
      { op: 'damage', power: 30, element: 'physical' },
      { op: 'apply_status', status: 'brittle', dur: 100, chance: 0.25 }
    ]
  },
  {
    id: 'witchfire',
    name: 'Witchfire',
    castCost: 110,
    shape: 'single',
    range: 4,
    element: 'arcane',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 30, element: 'arcane' }]
  },
  {
    id: 'barkskin',
    name: 'Barkskin',
    castCost: 160,
    shape: 'all_allies',
    range: 2,
    element: 'holy',
    anim: 'cast_beam',
    when: (s) => s.allies.some((u) => hpPct(u) < 0.75) && !s.self.statuses.some((x) => x.id === 'barkskin'),
    cond: 'while an ally is below 75% HP and it has no Barkskin itself',
    effects: [{ op: 'apply_status', status: 'barkskin', dur: 160 }]
  },
  {
    id: 'reap',
    name: 'Reap',
    castCost: 130,
    shape: 'single',
    melee: true,
    element: 'physical',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 42, element: 'physical' }]
  },
  {
    id: 'quake',
    name: 'Quake',
    castCost: 170,
    shape: 'blast',
    melee: true,
    element: 'physical',
    anim: 'melee_lunge',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 20, element: 'physical' }, { op: 'gauge', amount: -30 }]
  },
  {
    id: 'wither',
    name: 'Wither',
    castCost: 120,
    shape: 'single',
    range: 3,
    element: 'dark',
    anim: 'cast_beam',
    effects: [
      { op: 'damage', power: 34, element: 'dark' },
      { op: 'apply_status', status: 'withered', dur: 140, chance: 0.5 }
    ]
  },
  {
    id: 'glacial_breath',
    name: 'Glacial Breath',
    castCost: 170,
    shape: 'column',
    range: 3,
    element: 'frost',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 30, element: 'frost' }, { op: 'gauge', amount: -25 }]
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
    shape: 'blast',
    element: 'dark',
    anim: 'cast_beam',
    when: (s) => hpPct(s.self) <= 0.6,
    cond: 'once it is at 60% HP or less',
    effects: [
      { op: 'damage', power: 44, element: 'dark' },
      { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.4 }
    ]
  }
]

// ── statuses ─────────────────────────────────────────────────────────────────────────────────

// dur is in ticks (20 per second); 'battle' lasts the fight. Tick effects fire every `tickEvery`.
const STATUS_LIST = [
  {
    id: 'brittle',
    desc: '−25% DEF per stack, up to 3 stacks.',
    name: 'Brittle',
    tags: ['debuff'],
    dur: 120,
    stacks: 3,
    mods: [{ path: 'def', op: 'mul', v: 0.75 }]
  },
  {
    id: 'hasten',
    desc: '+25% gauge rate: acts more often.',
    name: 'Hasten',
    tags: ['buff'],
    dur: 100,
    stacks: 1,
    mods: [{ path: 'gauge.rate', op: 'mul', v: 1.25 }]
  },
  {
    id: 'regen',
    desc: 'Heals 24 power every second and takes 5% less damage.',
    name: 'Regen',
    tags: ['buff'],
    dur: 200,
    stacks: 1,
    mods: [{ path: 'damage.taken', op: 'mul', v: 0.95 }],
    tick: [{ op: 'heal', power: 24 }],
    tickEvery: 20
  },
  {
    id: 'barkskin',
    desc: '+25% DEF.',
    name: 'Barkskin',
    tags: ['buff'],
    dur: 160,
    stacks: 1,
    mods: [{ path: 'def', op: 'mul', v: 1.25 }]
  },
  {
    id: 'withered',
    desc: '−20% ATK.',
    name: 'Withered',
    tags: ['debuff'],
    dur: 140,
    stacks: 1,
    mods: [{ path: 'atk', op: 'mul', v: 0.8 }]
  },
  {
    id: 'enraged',
    desc: '+35% ATK and +20% gauge rate for the rest of the battle.',
    name: 'Enraged',
    tags: ['buff'],
    dur: 'battle',
    stacks: 1,
    mods: [{ path: 'atk', op: 'mul', v: 1.35 }, { path: 'gauge.rate', op: 'mul', v: 1.2 }]
  },
  {
    id: 'desperate',
    desc: '+50% damage dealt, +25% damage taken, +15% gauge rate.',
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
export const ELEMENT_LIST = [
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

// autoRow: 0 front, 1 mid, 2 back. `move` is how the role behaves on the board (BEHAVIOURS); `target`
// picks among the foes in reach: the nearest, or the lowest HP%.
export const ROLE_LIST = [
  { id: 'vanguard', name: 'Vanguard', autoRow: 0, move: 'advance', target: 'nearest' },
  { id: 'skirmisher', name: 'Skirmisher', autoRow: 1, move: 'keep', target: 'weakest' },
  { id: 'ranger', name: 'Ranger', autoRow: 2, move: 'keep', target: 'weakest' },
  { id: 'channeler', name: 'Channeler', autoRow: 2, move: 'keep', target: 'nearest' },
  { id: 'warden', name: 'Warden', autoRow: 1, move: 'advance', target: 'nearest' },
  { id: 'trickster', name: 'Trickster', autoRow: 1, move: 'flank', target: 'weakest' }
]

// How a unit moves, by its role's `move`. Nobody moves while an ability has a target in reach, except a
// flanker whose quarry is out of reach. `slips`: it can walk away from a foe next to it; everyone else
// is held in place.
export const BEHAVIOURS = {
  advance: { name: 'Advance', slips: false, desc: 'Walks to the nearest foe and fights it.' },
  keep: { name: 'Hold back', slips: false, desc: 'Walks only until a foe is in range, and never steps next to a foe while it has a ranged attack.' },
  // Who exactly a flanker hunts is left for the player to discover; the text only hints.
  flank: { name: 'Flank', slips: true, desc: 'Slips around the line to hunt whoever hides at the back.' }
}

// ── synergies ────────────────────────────────────────────────────────────────────────────────

// Active while a side's living units meet every count in `needs` ({ kin: {…}, role: {…} }).
// A mod with `pos` only applies while the unit is 'engaged' (a foe next to it) or 'free' (none).
export const SYNERGIES = [
  { id: 'undead_2', name: 'Undead 2', desc: 'The dead do not flinch. +12% DEF.', needs: { kin: { undead: 2 } }, mods: [{ path: 'def', op: 'mul', v: 1.12 }] },
  { id: 'undead_4', name: 'Undead 4', desc: '+30% DEF, +10% max HP.', needs: { kin: { undead: 4 } }, mods: [{ path: 'def', op: 'mul', v: 1.3 }, { path: 'hp', op: 'mul', v: 1.1 }] },
  { id: 'drake_2', name: 'Drake 2', desc: '+15% ATK.', needs: { kin: { drake: 2 } }, mods: [{ path: 'atk', op: 'mul', v: 1.15 }] },
  { id: 'fae_2', name: 'Fae 2', desc: '+8 EVA.', needs: { kin: { fae: 2 } }, mods: [{ path: 'eva', op: 'add', v: 8 }] },
  { id: 'insect_2', name: 'Insect 2', desc: '+6% gauge rate.', needs: { kin: { insect: 2 } }, mods: [{ path: 'gauge.rate', op: 'mul', v: 1.06 }] },
  { id: 'construct_2', name: 'Construct 2', desc: '+10 DEF.', needs: { kin: { construct: 2 } }, mods: [{ path: 'def', op: 'add', v: 10 }] },
  { id: 'vanguard_2', name: 'Vanguard 2', desc: 'The front holds. +14% DEF.', needs: { role: { vanguard: 2 } }, mods: [{ path: 'def', op: 'mul', v: 1.14 }] },
  { id: 'ranger_3', name: 'Ranger 3', desc: 'Souls with no foe next to them deal +25% damage.', needs: { role: { ranger: 3 } }, mods: [{ path: 'damage.dealt', op: 'mul', v: 1.25, pos: 'free' }] },
  { id: 'skirmisher_2', name: 'Skirmisher 2', desc: '+7 SPD.', needs: { role: { skirmisher: 2 } }, mods: [{ path: 'spd', op: 'add', v: 7 }] },
  { id: 'channeler_2', name: 'Channeler 2', desc: '+12% damage dealt.', needs: { role: { channeler: 2 } }, mods: [{ path: 'damage.dealt', op: 'mul', v: 1.12 }] },
  { id: 'warden_2', name: 'Warden 2', desc: '+25% healing given.', needs: { role: { warden: 2 } }, mods: [{ path: 'heal.given', op: 'mul', v: 1.25 }] },
  { id: 'trickster_2', name: 'Trickster 2', desc: '+6 CRT, +6 EVA.', needs: { role: { trickster: 2 } }, mods: [{ path: 'crt', op: 'add', v: 6 }, { path: 'eva', op: 'add', v: 6 }] },
  // Pacts: cross-axis recipes.
  { id: 'scaled_wall', name: 'Scaled Wall', desc: 'Drake 2 + Vanguard 2: engaged souls take 20% less damage.', needs: { kin: { drake: 2 }, role: { vanguard: 2 } }, mods: [{ path: 'damage.taken', op: 'mul', v: 0.8, pos: 'engaged' }] },
  { id: 'glamour', name: 'Glamour', desc: 'Fae 2 + Trickster 2: +10 EVA, +8% gauge rate.', needs: { kin: { fae: 2 }, role: { trickster: 2 } }, mods: [{ path: 'eva', op: 'add', v: 10 }, { path: 'gauge.rate', op: 'mul', v: 1.08 }] },
  { id: 'swarm_logic', name: 'Swarm Logic', desc: 'Insect 4 + Skirmisher 2: +16% gauge rate.', needs: { kin: { insect: 4 }, role: { skirmisher: 2 } }, mods: [{ path: 'gauge.rate', op: 'mul', v: 1.16 }] },
  { id: 'grave_vigil', name: 'Grave Vigil', desc: 'Undead 4 + Warden 2: +25% max HP.', needs: { kin: { undead: 4 }, role: { warden: 2 } }, mods: [{ path: 'hp', op: 'mul', v: 1.25 }] },
  { id: 'ember_choir', name: 'Ember Choir', desc: 'Drake 2 + Channeler 2: +20% damage dealt, +6 CRT.', needs: { kin: { drake: 2 }, role: { channeler: 2 } }, mods: [{ path: 'damage.dealt', op: 'mul', v: 1.2 }, { path: 'crt', op: 'add', v: 6 }] }
]

// ── formation bonds ──────────────────────────────────────────────────────────────────────────

// Fixed when a battle begins, from where souls stand in their formation: a unit matching `who` gets the
// mods if one matching `with` stands `at` it: 'beside' (same row, next lane), 'behind' (same lane, one
// row further back) or 'ahead' (same lane, one row further forward).
export const BONDS = [
  { id: 'phalanx', name: 'Phalanx', desc: 'A Vanguard with another Vanguard beside it: +20% DEF.', who: { role: 'vanguard' }, with: { role: 'vanguard' }, at: 'beside', mods: [{ path: 'def', op: 'mul', v: 1.2 }] },
  { id: 'vigil', name: 'Vigil', desc: 'A Vanguard with a Warden right behind it: takes 12% less damage.', who: { role: 'vanguard' }, with: { role: 'warden' }, at: 'behind', mods: [{ path: 'damage.taken', op: 'mul', v: 0.88 }] },
  { id: 'spotter', name: 'Spotter', desc: 'A Ranger or Channeler with a Skirmisher right ahead of it: +12 ACC, +10 CRT.', who: { role: ['ranger', 'channeler'] }, with: { role: 'skirmisher' }, at: 'ahead', mods: [{ path: 'acc', op: 'add', v: 12 }, { path: 'crt', op: 'add', v: 10 }] },
  { id: 'kinship', name: 'Kinship', desc: 'Two souls of one kin side by side: +8% damage dealt.', who: {}, with: { kin: 'same' }, at: 'beside', mods: [{ path: 'damage.dealt', op: 'mul', v: 1.08 }] }
]

// ── camps ────────────────────────────────────────────────────────────────────────────────────

// Where your souls stand and fight: a 7×7 camp, listed front row first (the foes come from above it).
// '#' is a wall: it blocks walking, not attacks. Each floor draws one of its camps when you arrive.
// Every open cell must be reachable from the front row (test/content.test.js checks).
export const CAMP_LIST = [
  { id: 'stones', name: 'Standing Stones', floor: 1, map: ['.......', '.#...#.', '.......', '...#...', '.......', '.#...#.', '.......'] },
  { id: 'palisade', name: 'Broken Palisade', floor: 1, map: ['.......', '##.#.##', '.......', '.......', '.......', '.......', '.......'] },
  { id: 'firepit', name: 'Firepit', floor: 1, map: ['.......', '.......', '..#.#..', '...#...', '..#.#..', '.......', '.......'] },
  { id: 'gates', name: 'Twin Gates', floor: 2, map: ['.......', '#.###.#', '.......', '.......', '...#...', '.......', '.......'] },
  { id: 'ditch', name: 'The Ditch', floor: 2, map: ['.......', '.......', '.#####.', '.......', '.......', '.......', '.......'] },
  { id: 'barracks', name: 'Barracks', floor: 2, map: ['.......', '.##.##.', '.#...#.', '.......', '.#...#.', '.##.##.', '.......'] },
  { id: 'switchback', name: 'Switchback', floor: 3, map: ['.......', '.######', '.......', '######.', '.......', '.......', '.......'] },
  { id: 'crossroads', name: 'Crossroads', floor: 3, map: ['.......', '.##.##.', '.##.##.', '.......', '.##.##.', '.##.##.', '.......'] },
  { id: 'funnel', name: 'Funnel', floor: 3, map: ['.......', '#.....#', '##...##', '###.###', '.......', '.......', '.......'] },
  { id: 'labyrinth', name: 'Labyrinth', floor: 4, map: ['...#...', '.#.#.#.', '.#...#.', '.#####.', '.......', '.#.#.#.', '.......'] },
  { id: 'keep', name: 'The Keep', floor: 4, map: ['.......', '.#####.', '.#...#.', '.#...#.', '.##.##.', '.......', '.......'] },
  { id: 'spiral', name: 'Spiral', floor: 4, map: ['.......', '######.', '.....#.', '.###.#.', '.#...#.', '.#####.', '.......'] }
]

// ── relics ───────────────────────────────────────────────────────────────────────────────────

// Run-long passives. `mods` apply to every fielded soul in battle (a `pos` mod only in that position);
// `field` adds field slots; `soulLevel` adds levels to every soul you reap.
export const RELIC_LIST = [
  { id: 'whetstone', name: 'Whetstone', desc: '+12% ATK.', mods: [{ path: 'atk', op: 'mul', v: 1.12 }] },
  { id: 'grave_banner', name: 'Grave Banner', desc: '+1 field slot.', field: 1 },
  { id: 'soul_lantern', name: 'Soul Lantern', desc: 'Reaped souls rise 2 levels higher.', soulLevel: 2 },
  { id: 'hourglass', name: 'Hourglass', desc: '+10% gauge rate.', mods: [{ path: 'gauge.rate', op: 'mul', v: 1.1 }] },
  { id: 'heartwood', name: 'Heartwood', desc: '+15% max HP.', mods: [{ path: 'hp', op: 'mul', v: 1.15 }] },
  { id: 'tower_shield', name: 'Tower Shield', desc: 'Engaged souls take 15% less damage.', mods: [{ path: 'damage.taken', op: 'mul', v: 0.85, pos: 'engaged' }] },
  { id: 'longbow', name: 'Longbow', desc: 'Souls with no foe next to them deal 20% more damage.', mods: [{ path: 'damage.dealt', op: 'mul', v: 1.2, pos: 'free' }] },
  { id: 'keen_eye', name: 'Keen Eye', desc: '+10 ACC, +8 CRT.', mods: [{ path: 'acc', op: 'add', v: 10 }, { path: 'crt', op: 'add', v: 8 }] },
  { id: 'balm', name: 'Balm', desc: '+30% healing given.', mods: [{ path: 'heal.given', op: 'mul', v: 1.3 }] }
]

// ── attack animations ────────────────────────────────────────────────────────────────────────

// Attack templates played by TimelinePlayer. Times in ms; `who`/`at` name the actor or primary target.
// An `anim` step strikes a pose (attack, cast, hurt, idle), animated in code from the unit's pictures.
// The action's results (damage, deaths…) and the targets' flinches show at the `popup` step: the impact.
const ANIM_LIST = [
  {
    id: 'melee_lunge',
    dur: 620,
    steps: [
      { t: 0, op: 'anim', who: 'actor', key: 'attack' },
      { t: 60, op: 'tween', who: 'actor', to: 'targetAdj', dur: 140, ease: 'Cubic.Out' },
      { t: 190, op: 'slash' },
      { t: 210, op: 'fx', at: 'target' },
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
      { t: 420, op: 'popup' }
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
export const CAMPS = byId(CAMP_LIST)

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
export const campDef = lookup(CAMPS, 'camp')

// A unit's picture as a URL the page and the battle both load. pose: 'alive', 'attack' or 'dead'.
export const ART_POSES = ['alive', 'attack', 'dead']
export const artUrl = (id, pose = 'alive') => new URL(`./assets/units/${unitDef(id).art}.${pose}.svg`, import.meta.url).href
