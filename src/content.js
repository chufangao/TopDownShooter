// All game content: units, abilities, upgrade paths, statuses, kin and roles, behaviours, synergies, bonds,
// camps, relics and attack animations, plus id lookups. Data only; balance numbers live in tuning.js.

// ── units ────────────────────────────────────────────────────────────────────────────────────

// base + growth × (lvl − 1). `art` names the unit's three pictures in `assets/units/`: `${art}.alive.svg`,
// `${art}.attack.svg` and `${art}.dead.svg` (see artUrl). The battle animates them in code: no frames.
// `aura`: mods every ally (not itself) within `range` tiles gets while it stands. `threats`: what a foe
// of this kind does to a Monarch (THREATS), for the encounter draw's variety rule; never shown as intent.
// `foeOrders`: the orders (FOE_ORDERS) it may carry as an elite's captain, one drawn per room; `flavour`: a
// line of lore that hints at them. The order itself is never shown: only the flavour, and the fighting.

export const UNIT_LIST = [
  {
    // You. It stands where it is placed, never strikes, and raises the dead in its domain; if it falls the
    // battle and the run are lost. Its HP and level come from the run (TUNING.monarch: level = points
    // spent on Dominion, Command and Will), not from base + growth. Never offered, never spawns.
    id: 'monarch',
    name: 'The Monarch',
    kin: null,
    role: 'monarch',
    tier: 0,
    monarch: true,
    // hp: set by baseStats from TUNING.monarch. spd 22: Arise's 200 gauge fills in about 4 s.
    base: { hp: 0, atk: 6, def: 8, spd: 22, acc: 40, eva: 10, crt: 0 },
    growth: {},
    abilities: ['arise'],
    art: 'monarch'
  },
  {
    id: 'bone_chanter',
    name: 'Bone Chanter',
    kin: 'undead',
    role: 'channeler',
    tier: 2,
    base: { hp: 78, atk: 14, def: 6, spd: 22, acc: 40, eva: 12, crt: 5 },
    growth: { hp: 9, atk: 2.1, def: 0.6, spd: 1.2 },
    abilities: ['dirge', 'marrow_bolt'],
    spawn: { weight: 14, minFloor: 1 },
    threats: ['reach', 'drain', 'clock'],
    foeOrders: ['stay', 'hunt'],
    flavour: 'Its warband marches to the dirge, or waits close about the singer while the song lasts.',
    art: 'bone_chanter'
  },
  {
    id: 'tomb_knight',
    name: 'Tomb Knight',
    kin: 'undead',
    role: 'vanguard',
    tier: 2,
    base: { hp: 142, atk: 16, def: 22, spd: 12, acc: 45, eva: 6, crt: 4 },
    growth: { hp: 16, atk: 2.4, def: 2, spd: 0.5 },
    abilities: ['cleave', 'strike'],
    aura: { range: 1, desc: 'Allies next to it take 15% less damage.', mods: [{ path: 'damage.taken', op: 'mul', v: 0.85 }] },
    spawn: { weight: 10, minFloor: 1 },
    threats: ['shape'],
    foeOrders: ['stay', 'hunt'],
    flavour: "Some knights hold the barrow's mouth to the last; some march out to meet the living.",
    art: 'tomb_knight'
  },
  {
    id: 'ember_drake',
    name: 'Ember Drake',
    kin: 'drake',
    role: 'ranger',
    tier: 3,
    base: { hp: 96, atk: 24, def: 10, spd: 26, acc: 52, eva: 14, crt: 12 },
    growth: { hp: 11, atk: 3.2, def: 0.9, spd: 1.4 },
    abilities: ['ember_burst', 'strike'],
    spawn: { weight: 8, minFloor: 2 },
    threats: ['shape', 'reach'],
    foeOrders: ['stay', 'flank'],
    flavour: 'Drakes circle wide of a fight before they burn it, or roost where they can see the whole field.',
    art: 'ember_drake'
  },
  {
    id: 'frost_sprite',
    name: 'Frost Sprite',
    kin: 'fae',
    role: 'skirmisher',
    tier: 1,
    base: { hp: 54, atk: 15, def: 4, spd: 38, acc: 48, eva: 30, crt: 9 },
    growth: { hp: 6, atk: 2, def: 0.3, spd: 2.1 },
    abilities: ['frost_lance'],
    spawn: { weight: 12, minFloor: 1 },
    threats: ['reach', 'drain'],
    foeOrders: ['hunt', 'flank'],
    flavour: 'Sprites come at you sideways, along the edge of the field where the frost runs thin.',
    art: 'frost_sprite'
  },
  {
    id: 'hive_warden',
    name: 'Hive Warden',
    kin: 'insect',
    role: 'warden',
    tier: 2,
    base: { hp: 110, atk: 13, def: 15, spd: 18, acc: 42, eva: 10, crt: 3 },
    growth: { hp: 13, atk: 1.6, def: 1.4, spd: 0.9 },
    abilities: ['mend', 'purge', 'strike'],
    spawn: { weight: 9, minFloor: 1 },
    threats: ['clock'],
    foeOrders: ['stay'],
    flavour: 'A warden never strays far from its comb, and its swarm keeps close about it.',
    art: 'hive_warden'
  },
  {
    id: 'clockwork_page',
    name: 'Clockwork Page',
    kin: 'construct',
    role: 'trickster',
    tier: 1,
    base: { hp: 68, atk: 12, def: 9, spd: 30, acc: 44, eva: 18, crt: 7 },
    growth: { hp: 7, atk: 1.7, def: 0.8, spd: 1.6 },
    abilities: ['purge', 'strike'],
    spawn: { weight: 12, minFloor: 1 },
    threats: ['flank'],
    foeOrders: ['flank'],
    flavour: 'Pages were wound to run errands round the back of things, and their fellows follow the errand.',
    art: 'clockwork_page'
  },
  {
    id: 'grave_ghoul',
    name: 'Grave Ghoul',
    kin: 'undead',
    role: 'vanguard',
    tier: 1,
    base: { hp: 96, atk: 13, def: 9, spd: 18, acc: 42, eva: 10, crt: 6 },
    growth: { hp: 11, atk: 1.8, def: 0.8, spd: 0.9 },
    abilities: ['gnaw', 'strike'],
    spawn: { weight: 13, minFloor: 1 },
    threats: ['drain'],
    foeOrders: ['hunt'],
    flavour: 'A ghoul with a pack behind it goes straight for the meat.',
    art: 'grave_ghoul'
  },
  {
    id: 'will_o_wisp',
    name: "Will-o'-Wisp",
    kin: 'fae',
    role: 'channeler',
    tier: 1,
    base: { hp: 50, atk: 15, def: 3, spd: 32, acc: 46, eva: 28, crt: 6 },
    growth: { hp: 6, atk: 2.1, def: 0.3, spd: 1.8 },
    abilities: ['witchfire'],
    spawn: { weight: 11, minFloor: 1 },
    threats: ['reach'],
    foeOrders: ['stay', 'flank'],
    flavour: 'Wisps drift to the edges of a field, and wait for travellers to come to them.',
    art: 'will_o_wisp'
  },
  {
    id: 'thorn_dryad',
    name: 'Thorn Dryad',
    kin: 'fae',
    role: 'warden',
    tier: 2,
    base: { hp: 104, atk: 12, def: 12, spd: 20, acc: 42, eva: 14, crt: 3 },
    growth: { hp: 12, atk: 1.6, def: 1.1, spd: 1 },
    abilities: ['barkskin', 'mend', 'strike'],
    spawn: { weight: 9, minFloor: 2 },
    threats: ['clock'],
    foeOrders: ['stay'],
    flavour: 'A dryad is rooted where it stands, and its grove grows thick about it.',
    art: 'thorn_dryad'
  },
  {
    id: 'mantis_reaper',
    name: 'Mantis Reaper',
    kin: 'insect',
    role: 'trickster',
    tier: 3,
    base: { hp: 92, atk: 25, def: 9, spd: 32, acc: 50, eva: 20, crt: 16 },
    growth: { hp: 10, atk: 3.1, def: 0.8, spd: 1.8 },
    abilities: ['reap', 'strike'],
    spawn: { weight: 7, minFloor: 2 },
    threats: ['flank'],
    foeOrders: ['flank', 'hunt'],
    flavour: 'A mantis stalks the margins with its brood, and strikes from where no one is looking.',
    art: 'mantis_reaper'
  },
  {
    id: 'iron_golem',
    name: 'Iron Golem',
    kin: 'construct',
    role: 'vanguard',
    tier: 3,
    base: { hp: 220, atk: 17, def: 30, spd: 9, acc: 44, eva: 2, crt: 3 },
    growth: { hp: 22, atk: 2.2, def: 2.4, spd: 0.4 },
    abilities: ['quake', 'strike'],
    spawn: { weight: 6, minFloor: 2 },
    threats: ['shape'],
    foeOrders: ['stay', 'hunt'],
    flavour: 'A golem keeps its post until it is told otherwise, and then nothing turns it.',
    art: 'iron_golem'
  },
  {
    id: 'barrow_wight',
    name: 'Barrow Wight',
    kin: 'undead',
    role: 'skirmisher',
    tier: 4,
    base: { hp: 128, atk: 27, def: 13, spd: 30, acc: 52, eva: 22, crt: 10 },
    growth: { hp: 14, atk: 3.4, def: 1.1, spd: 1.6 },
    abilities: ['wither', 'strike'],
    spawn: { weight: 6, minFloor: 3 },
    threats: ['reach', 'drain'],
    foeOrders: ['hunt', 'flank'],
    flavour: 'Wights lead their dead up out of the barrows, hungry for any warmth, wherever it hides.',
    art: 'barrow_wight'
  },
  {
    id: 'frost_wyrm',
    name: 'Frost Wyrm',
    kin: 'drake',
    role: 'ranger',
    tier: 4,
    base: { hp: 190, atk: 29, def: 16, spd: 16, acc: 50, eva: 6, crt: 8 },
    growth: { hp: 20, atk: 3.4, def: 1.5, spd: 0.7 },
    abilities: ['glacial_breath', 'strike'],
    spawn: { weight: 6, minFloor: 3 },
    threats: ['shape', 'reach'],
    foeOrders: ['stay', 'hunt'],
    flavour: 'An old wyrm makes the field come to it, and its brood waits with it.',
    art: 'frost_wyrm'
  },
  {
    // Bosses never spawn from the pool and leave no soul.
    id: 'hollow_sovereign',
    name: 'The Hollow Sovereign',
    kin: 'undead',
    role: 'vanguard',
    tier: 5,
    boss: true,
    base: { hp: 2800, atk: 65, def: 30, spd: 18, acc: 70, eva: 8, crt: 8 },
    growth: { hp: 280, atk: 6.5, def: 2, spd: 0.8 },
    abilities: ['grave_tide', 'sovereign_sweep', 'strike'],
    phases: [{ at: 0.6, grant: 'enraged' }, { at: 0.25, grant: 'desperate' }],
    threats: ['shape', 'clock'],
    foeOrders: ['hunt'],
    flavour: 'It does not fight alone: its court walks with it, and the dead of the field rise at its tide. Without it, they are dust.',
    art: 'hollow_sovereign'
  }
]

// ── abilities ────────────────────────────────────────────────────────────────────────────────

// Shapes: single, ally, self; row (everyone level with the target), column (its lane); blast (the
// target and everyone next to it, aimed where they stand thickest); all, all_allies (within `range`);
// corpse (a fallen foe: Arise's).
// `when(s)` gets { self, allies, enemies, t } (living units; allies includes self); `cond` says the
// same in words for tooltips. The AI banks gauge for the first ability whose `when` passes and that
// has a target in reach, so gates keep pricey ones reachable. Reach: melee hits the 8 tiles around,
// `range` is in tiles, and ally abilities and `all` reach the whole board.
const hpPct = (u) => u.hp / u.maxHp
// The units of a list within r tiles of the caster (the view's `dist`): a tier IV's area condition reads
// only what its area reaches, so a soul never banks for a cast that would touch no one it was meant for,
// nor halts short of a foe for a reach it has no use for yet.
const near = (s, list, r) => list.filter((u) => s.dist(u) <= r)

const ABILITY_LIST = [
  {
    // The Monarch's one cast. Its reach is the domain (battle.domain), its target a corpse (see battle.js):
    // a fallen foe of tier up to 1 + Will, on a tile no one living stands on, at most 1 + Will a battle.
    id: 'arise',
    name: 'Arise',
    castCost: 200,
    shape: 'corpse',
    tint: '#c8f5d2',
    anim: 'cast_beam',
    effects: [{ op: 'raise' }]
  },
  {
    id: 'strike',
    name: 'Strike',
    castCost: 100,
    shape: 'single',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }]
  },
  {
    id: 'cleave',
    name: 'Cleave',
    castCost: 140,
    shape: 'row',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 22 }]
  },
  {
    id: 'marrow_bolt',
    name: 'Marrow Bolt',
    castCost: 100,
    shape: 'single',
    range: 4,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    effects: [
      { op: 'damage', power: 34 },
      { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.35 }
    ]
  },
  {
    id: 'dirge',
    name: 'Dirge',
    castCost: 180,
    shape: 'all_allies',
    range: 2,
    tint: '#7a5c9e',
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
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 26 }]
  },
  {
    id: 'frost_lance',
    name: 'Frost Lance',
    castCost: 120,
    shape: 'single',
    range: 3,
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 30 }, { op: 'gauge', amount: -20 }]
  },
  {
    id: 'mend',
    name: 'Mend',
    castCost: 130,
    shape: 'ally',
    tint: '#ffe9a8',
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
    tint: '#ffe9a8',
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
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [
      { op: 'damage', power: 30 },
      { op: 'apply_status', status: 'brittle', dur: 100, chance: 0.25 }
    ]
  },
  {
    id: 'witchfire',
    name: 'Witchfire',
    castCost: 110,
    shape: 'single',
    range: 4,
    tint: '#b57bff',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 30 }]
  },
  {
    id: 'barkskin',
    name: 'Barkskin',
    castCost: 160,
    shape: 'all_allies',
    range: 2,
    tint: '#ffe9a8',
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
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 42 }]
  },
  {
    id: 'quake',
    name: 'Quake',
    castCost: 170,
    shape: 'blast',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 20 }, { op: 'gauge', amount: -30 }]
  },
  {
    id: 'wither',
    name: 'Wither',
    castCost: 120,
    shape: 'single',
    range: 3,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    effects: [
      { op: 'damage', power: 34 },
      { op: 'apply_status', status: 'withered', dur: 140, chance: 0.5 }
    ]
  },
  {
    id: 'glacial_breath',
    name: 'Glacial Breath',
    castCost: 170,
    shape: 'column',
    range: 3,
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 30 }, { op: 'gauge', amount: -25 }]
  },
  {
    id: 'sovereign_sweep',
    name: 'Sovereign Sweep',
    castCost: 150,
    shape: 'row',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 26 }]
  },
  {
    id: 'grave_tide',
    name: 'Grave Tide',
    castCost: 260,
    shape: 'blast',
    tint: '#7a5c9e',
    anim: 'cast_beam',
    when: (s) => hpPct(s.self) <= 0.6,
    cond: 'once it is at 60% HP or less',
    effects: [
      { op: 'damage', power: 44 },
      { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.4 },
      // The dead of the field rise on its side: up to `count` corpses as shadows (see battle.js).
      { op: 'raise', count: 2 }
    ]
  },
  // ── abilities a path grants ──
  {
    id: 'requiem',
    name: 'Requiem',
    castCost: 180,
    shape: 'all_allies',
    range: 3,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    when: (s) => s.t < 200,
    cond: 'in the first 10 s of a battle',
    effects: [{ op: 'apply_status', status: 'hasten', dur: 140 }]
  },
  {
    id: 'marrow_spear',
    name: 'Marrow Spear',
    castCost: 150,
    shape: 'column',
    range: 4,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.5 }]
  },
  {
    id: 'bone_mend',
    name: 'Bone Mend',
    castCost: 130,
    shape: 'ally',
    tint: '#7a5c9e',
    anim: 'cast_beam',
    when: (s) => s.allies.some((u) => hpPct(u) < 0.5),
    cond: 'while an ally is below 50% HP',
    effects: [{ op: 'heal', power: 30 }]
  },
  {
    id: 'rending_strike',
    name: 'Rending Strike',
    castCost: 110,
    shape: 'single',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 36 }, { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.5 }]
  },
  {
    id: 'inferno',
    name: 'Inferno',
    castCost: 170,
    shape: 'blast',
    range: 4,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 32 }]
  },
  {
    id: 'searing_bolt',
    name: 'Searing Bolt',
    castCost: 120,
    shape: 'single',
    range: 5,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 34 }]
  },
  {
    id: 'shatter_lance',
    name: 'Shatter Lance',
    castCost: 130,
    shape: 'single',
    range: 3,
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 38 }, { op: 'gauge', amount: -20 }, { op: 'apply_status', status: 'brittle', dur: 100, chance: 0.3 }]
  },
  {
    id: 'hoarfrost',
    name: 'Hoarfrost',
    castCost: 150,
    shape: 'blast',
    range: 3,
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 18 }, { op: 'gauge', amount: -30 }]
  },
  {
    id: 'swarm_mend',
    name: 'Swarm Mend',
    castCost: 150,
    shape: 'all_allies',
    range: 2,
    tint: '#ffe9a8',
    anim: 'cast_beam',
    when: (s) => s.allies.some((u) => hpPct(u) < 0.6),
    cond: 'while an ally is below 60% HP',
    effects: [{ op: 'heal', power: 18 }]
  },
  {
    id: 'spanner',
    name: 'Spanner in the Works',
    castCost: 120,
    shape: 'single',
    melee: true,
    tint: '#b57bff',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'gauge', amount: -40 }]
  },
  {
    id: 'overclock',
    name: 'Overclock',
    castCost: 120,
    shape: 'ally',
    tint: '#b57bff',
    anim: 'cast_beam',
    when: (s) => s.allies.length >= 2,
    cond: 'while it has an ally',
    effects: [{ op: 'apply_status', status: 'hasten', dur: 100 }, { op: 'cleanse', tag: 'debuff', count: 1 }]
  },
  {
    id: 'devour',
    name: 'Devour',
    castCost: 130,
    shape: 'single',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 34 }, { op: 'heal', power: 20, self: true }]
  },
  {
    id: 'plague_bite',
    name: 'Plague Bite',
    castCost: 120,
    shape: 'single',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [
      { op: 'damage', power: 30 },
      { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.5 },
      { op: 'apply_status', status: 'withered', dur: 120, chance: 0.3 }
    ]
  },
  {
    id: 'wildfire',
    name: 'Wildfire',
    castCost: 160,
    shape: 'blast',
    range: 4,
    tint: '#b57bff',
    anim: 'cast_beam',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 24 }]
  },
  {
    id: 'bloom',
    name: 'Bloom',
    castCost: 140,
    shape: 'ally',
    tint: '#ffe9a8',
    anim: 'cast_beam',
    when: (s) => s.allies.some((u) => hpPct(u) < 0.5),
    cond: 'while an ally is below 50% HP',
    effects: [{ op: 'heal', power: 34 }, { op: 'apply_status', status: 'regen', dur: 200 }]
  },
  {
    id: 'thorn_lash',
    name: 'Thorn Lash',
    castCost: 140,
    shape: 'row',
    melee: true,
    tint: '#ffe9a8',
    anim: 'melee_lunge',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 20 }]
  },
  {
    id: 'execute',
    name: 'Execute',
    castCost: 150,
    shape: 'single',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 48 }]
  },
  {
    id: 'earthshatter',
    name: 'Earthshatter',
    castCost: 180,
    shape: 'blast',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 26 }, { op: 'gauge', amount: -40 }]
  },
  {
    id: 'soul_drain',
    name: 'Soul Drain',
    castCost: 130,
    shape: 'single',
    range: 3,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 34 }, { op: 'heal', power: 20, self: true }]
  },
  {
    id: 'dread_wail',
    name: 'Dread Wail',
    castCost: 160,
    shape: 'blast',
    range: 3,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 16 }, { op: 'apply_status', status: 'withered', dur: 140, chance: 0.6 }]
  },
  {
    id: 'blizzard',
    name: 'Blizzard',
    castCost: 180,
    shape: 'row',
    range: 3,
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 26 }, { op: 'gauge', amount: -25 }]
  },
  // ── abilities a tier IV grants (a Knight's or a Marshal's) ──
  {
    id: 'dirge_unending',
    name: 'Dirge Unending',
    castCost: 200,
    shape: 'all_allies',
    range: 3,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    when: (s) => near(s, s.allies, 3).some((u) => !u.statuses.some((x) => x.id === 'hasten')),
    cond: 'while an ally within 3 tiles has no Hasten',
    effects: [{ op: 'apply_status', status: 'hasten', dur: 140 }]
  },
  {
    // `all` with a range: every foe within it of the caster.
    id: 'bone_storm',
    name: 'Bone Storm',
    castCost: 240,
    shape: 'all',
    range: 4,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    when: (s) => near(s, s.enemies, 4).length >= 3,
    cond: 'while 3+ foes stand within 4 tiles',
    effects: [{ op: 'damage', power: 16 }, { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.3 }]
  },
  {
    id: 'knit_bones',
    name: 'Knit Bones',
    castCost: 170,
    shape: 'all_allies',
    range: 3,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    when: (s) => near(s, s.allies, 3).some((u) => hpPct(u) < 0.5),
    cond: 'while an ally within 3 tiles is below 50% HP',
    effects: [{ op: 'heal', power: 22 }]
  },
  {
    id: 'shield_wall',
    name: 'Shield Wall',
    castCost: 180,
    shape: 'all_allies',
    range: 2,
    tint: '#ffe9a8',
    anim: 'cast_beam',
    when: (s) => near(s, s.allies, 2).some((u) => hpPct(u) < 0.75) && !s.self.statuses.some((x) => x.id === 'barkskin'),
    cond: 'while an ally within 2 tiles is below 75% HP and it has no Barkskin itself',
    effects: [{ op: 'apply_status', status: 'barkskin', dur: 160 }]
  },
  {
    id: 'reaving_cleave',
    name: 'Reaving Cleave',
    castCost: 140,
    shape: 'row',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 22 }, { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.6 }]
  },
  {
    id: 'cataclysm',
    name: 'Cataclysm',
    castCost: 180,
    shape: 'blast',
    range: 5,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 32 }, { op: 'apply_status', status: 'withered', dur: 140, chance: 0.4 }]
  },
  {
    // No range: it reaches the whole board.
    id: 'skyfall',
    name: 'Skyfall',
    castCost: 120,
    shape: 'single',
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 34 }]
  },
  {
    id: 'glacier_lance',
    name: 'Glacier Lance',
    castCost: 150,
    shape: 'column',
    range: 3,
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 34 }, { op: 'gauge', amount: -20 }, { op: 'apply_status', status: 'brittle', dur: 100, chance: 0.3 }]
  },
  {
    id: 'deep_winter',
    name: 'Deep Winter',
    castCost: 200,
    shape: 'all',
    range: 3,
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    when: (s) => near(s, s.enemies, 3).length >= 2,
    cond: 'while 2+ foes stand within 3 tiles',
    effects: [{ op: 'damage', power: 12 }, { op: 'gauge', amount: -40 }]
  },
  {
    id: 'brood_surge',
    name: 'Brood Surge',
    castCost: 170,
    shape: 'all_allies',
    range: 3,
    tint: '#ffe9a8',
    anim: 'cast_beam',
    when: (s) => near(s, s.allies, 3).some((u) => hpPct(u) < 0.6),
    cond: 'while an ally within 3 tiles is below 60% HP',
    effects: [{ op: 'heal', power: 18 }, { op: 'apply_status', status: 'regen', dur: 200 }]
  },
  {
    id: 'molt',
    name: 'Molt',
    castCost: 150,
    shape: 'all_allies',
    range: 2,
    tint: '#ffe9a8',
    anim: 'cast_beam',
    when: (s) => near(s, s.allies, 2).some((u) => u.statuses.some((x) => STATUSES[x.id].tags.includes('debuff'))),
    cond: 'while an ally within 2 tiles suffers a debuff',
    effects: [{ op: 'cleanse', tag: 'debuff', count: 3 }]
  },
  {
    id: 'wrench',
    name: 'Wrench the Works',
    castCost: 130,
    shape: 'single',
    melee: true,
    tint: '#b57bff',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'gauge', amount: -1000 }]
  },
  {
    id: 'perpetual_motion',
    name: 'Perpetual Motion',
    castCost: 150,
    shape: 'all_allies',
    range: 2,
    tint: '#b57bff',
    anim: 'cast_beam',
    when: (s) => near(s, s.allies, 2).length >= 2,
    cond: 'while an ally stands within 2 tiles',
    effects: [{ op: 'apply_status', status: 'hasten', dur: 100 }, { op: 'cleanse', tag: 'debuff', count: 1 }]
  },
  {
    id: 'gorge',
    name: 'Gorge',
    castCost: 150,
    shape: 'blast',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'heal', power: 24, self: true }]
  },
  {
    id: 'pestilence',
    name: 'Pestilence',
    castCost: 140,
    shape: 'blast',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [
      { op: 'damage', power: 24 },
      { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.5 },
      { op: 'apply_status', status: 'withered', dur: 120, chance: 0.4 }
    ]
  },
  {
    id: 'baying_howl',
    name: 'Baying Howl',
    castCost: 160,
    shape: 'all_allies',
    range: 2,
    tint: '#d8d4cc',
    anim: 'cast_beam',
    when: (s) => s.t < 200,
    cond: 'in the first 10 s of a battle',
    effects: [{ op: 'apply_status', status: 'hasten', dur: 120 }]
  },
  {
    id: 'conflagration',
    name: 'Conflagration',
    castCost: 220,
    shape: 'all',
    range: 4,
    tint: '#b57bff',
    anim: 'cast_beam',
    when: (s) => near(s, s.enemies, 4).length >= 3,
    cond: 'while 3+ foes stand within 4 tiles',
    effects: [{ op: 'damage', power: 18 }]
  },
  {
    id: 'veil',
    name: 'Veil',
    castCost: 160,
    shape: 'all_allies',
    range: 2,
    tint: '#b57bff',
    anim: 'cast_beam',
    when: (s) => near(s, s.allies, 2).some((u) => hpPct(u) < 0.75) && !s.self.statuses.some((x) => x.id === 'veiled'),
    cond: 'while an ally within 2 tiles is below 75% HP and it is not Veiled itself',
    effects: [{ op: 'apply_status', status: 'veiled', dur: 120 }]
  },
  {
    id: 'verdant_bloom',
    name: 'Verdant Bloom',
    castCost: 170,
    shape: 'all_allies',
    range: 2,
    tint: '#ffe9a8',
    anim: 'cast_beam',
    when: (s) => near(s, s.allies, 2).some((u) => hpPct(u) < 0.5),
    cond: 'while an ally within 2 tiles is below 50% HP',
    effects: [{ op: 'heal', power: 26 }, { op: 'apply_status', status: 'regen', dur: 200 }]
  },
  {
    id: 'briar_lash',
    name: 'Briar Lash',
    castCost: 150,
    shape: 'row',
    range: 2,
    tint: '#ffe9a8',
    anim: 'melee_lunge',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 20 }, { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.4 }]
  },
  {
    id: 'harvest',
    name: 'Harvest',
    castCost: 160,
    shape: 'blast',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 40 }]
  },
  {
    id: 'phantom_edge',
    name: 'Phantom Edge',
    castCost: 130,
    shape: 'single',
    range: 3,
    tint: '#b57bff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 34 }]
  },
  {
    // Only once engaged: a melee soul walks in to strike, never halting at 2 tiles to cast this.
    id: 'magnetize',
    name: 'Magnetize',
    castCost: 190,
    shape: 'all',
    range: 2,
    tint: '#d8d4cc',
    anim: 'cast_beam',
    when: (s) => near(s, s.enemies, 1).length >= 1 && near(s, s.enemies, 2).length >= 2,
    cond: 'while a foe is next to it and 2+ stand within 2 tiles',
    effects: [{ op: 'damage', power: 10 }, { op: 'gauge', amount: -35 }]
  },
  {
    id: 'worldbreaker',
    name: 'Worldbreaker',
    castCost: 190,
    shape: 'row',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 24 }, { op: 'gauge', amount: -40 }]
  },
  {
    id: 'soul_harvest',
    name: 'Soul Harvest',
    castCost: 160,
    shape: 'blast',
    range: 3,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 28 }, { op: 'heal', power: 24, self: true }]
  },
  {
    id: 'death_knell',
    name: 'Death Knell',
    castCost: 190,
    shape: 'all',
    range: 3,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    when: (s) => near(s, s.enemies, 3).length >= 2,
    cond: 'while 2+ foes stand within 3 tiles',
    effects: [{ op: 'damage', power: 14 }, { op: 'apply_status', status: 'withered', dur: 140, chance: 0.7 }]
  },
  {
    id: 'ice_age',
    name: 'Ice Age',
    castCost: 220,
    shape: 'all',
    range: 3,
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 22 }, { op: 'gauge', amount: -30 }]
  },
  {
    // No range: it reaches the whole board, and as a Ranger's it picks the most wounded foe.
    id: 'killing_cold',
    name: 'Killing Cold',
    castCost: 160,
    shape: 'single',
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    when: (s) => s.enemies.some((u) => hpPct(u) < 0.5),
    cond: 'once a foe is below half HP',
    effects: [{ op: 'damage', power: 40 }]
  }
]

// ── upgrade paths ────────────────────────────────────────────────────────────────────────────

// Each kind of soul has up to three paths. A soul commits to one with its first tier, then buys tiers
// II and III along it with essence (TUNING.essence.tier). A tier can carry `mods` (always on, like a
// relic's, for that soul alone), `ability` ({ id, replace } swaps one of its abilities; { id, at }
// adds one at that place in its priority list, first by default) and `aura` (replaces its aura).
// Tier IV is a Knight's or a Marshal's (GRADES): a rule, never a percentage (a new or remade ability).
// A Knight may instead start a second path, and a Marshal take its tiers I–III: its tiers come on top of
// the first path's, so two paths that remake the same ability, or both grant an aura, never pair (see
// pathsClash in unit.js).
const m = (path, op, v, pos) => (pos ? { path, op, v, pos } : { path, op, v })
export const PATHS = {
  bone_chanter: [
    { id: 'dirgemaster', name: 'Dirgemaster', desc: 'Quickens the whole line.', tiers: [
      { desc: '+15% gauge rate.', mods: [m('gauge.rate', 'mul', 1.15)] },
      { desc: '+20% damage dealt.', mods: [m('damage.dealt', 'mul', 1.2)] },
      { desc: 'Dirge becomes Requiem: Hasten for 7 s to every ally within 3 tiles, in the first 10 s.', ability: { id: 'requiem', replace: 'dirge' } },
      { desc: 'Requiem becomes Dirge Unending: Hasten to every ally within 3 tiles whenever one lacks it, all battle long.', ability: { id: 'dirge_unending', replace: 'requiem' } }] },
    { id: 'marrowcaller', name: 'Marrowcaller', desc: 'Bolts that pierce a whole lane.', tiers: [
      { desc: '+12% ATK.', mods: [m('atk', 'mul', 1.12)] },
      { desc: '+15 ACC, +8 CRT.', mods: [m('acc', 'add', 15), m('crt', 'add', 8)] },
      { desc: 'Marrow Bolt becomes Marrow Spear: hits a foe and everyone in its lane.', ability: { id: 'marrow_spear', replace: 'marrow_bolt' } },
      { desc: 'Learns Bone Storm: shards strike every foe within 4 tiles, while 3+ foes stand there.', ability: { id: 'bone_storm' } }] },
    { id: 'grave_mender', name: 'Grave Mender', desc: 'Knits bone back together.', tiers: [
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: '+30% healing given.', mods: [m('heal.given', 'mul', 1.3)] },
      { desc: 'Learns Bone Mend: heals the most wounded ally while one is below 50% HP.', ability: { id: 'bone_mend' } },
      { desc: 'Bone Mend becomes Knit Bones: heals every ally within 3 tiles, not just one.', ability: { id: 'knit_bones', replace: 'bone_mend' } }] }
  ],
  tomb_knight: [
    { id: 'bulwark', name: 'Bulwark', desc: 'A wall the line hides behind.', tiers: [
      { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: 'Its aura reaches allies within 2 tiles.', aura: { range: 2, desc: 'Allies within 2 tiles take 15% less damage.', mods: [m('damage.taken', 'mul', 0.85)] } },
      { desc: 'Learns Shield Wall: Barkskin for itself and every ally within 2 tiles, while one is below 75% HP.', ability: { id: 'shield_wall' } }] },
    { id: 'reaver', name: 'Reaver', desc: 'Trades the shield for the edge.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+15% damage dealt while a foe is next to it.', mods: [m('damage.dealt', 'mul', 1.15, 'engaged')] },
      { desc: 'Strike becomes Rending Strike: 36 power, 50% chance of Brittle.', ability: { id: 'rending_strike', replace: 'strike' } },
      { desc: 'Cleave becomes Reaving Cleave: everyone level with its target, left Brittle.', ability: { id: 'reaving_cleave', replace: 'cleave' } }] }
  ],
  ember_drake: [
    { id: 'pyroclast', name: 'Pyroclast', desc: 'Bigger fires.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+10 CRT.', mods: [m('crt', 'add', 10)] },
      { desc: 'Ember Burst becomes Inferno: 32 power to a foe and everyone next to it.', ability: { id: 'inferno', replace: 'ember_burst' } },
      { desc: 'Inferno becomes Cataclysm: reaches 5 tiles, and leaves the burnt Withered.', ability: { id: 'cataclysm', replace: 'inferno' } }] },
    { id: 'skyhunter', name: 'Skyhunter', desc: 'Picks off whoever strays.', tiers: [
      { desc: '+12 ACC, +10% gauge rate.', mods: [m('acc', 'add', 12), m('gauge.rate', 'mul', 1.1)] },
      { desc: '+20% damage dealt with no foe next to it.', mods: [m('damage.dealt', 'mul', 1.2, 'free')] },
      { desc: 'Learns Searing Bolt: 34 power at range 5, when Ember Burst has no use.', ability: { id: 'searing_bolt', at: 1 } },
      { desc: 'Searing Bolt becomes Skyfall: it reaches any foe on the board.', ability: { id: 'skyfall', replace: 'searing_bolt' } }] }
  ],
  frost_sprite: [
    { id: 'rimeblade', name: 'Rimeblade', desc: 'A colder, crueller lance.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+10 CRT.', mods: [m('crt', 'add', 10)] },
      { desc: 'Frost Lance becomes Shatter Lance: 38 power, drains gauge, 30% chance of Brittle.', ability: { id: 'shatter_lance', replace: 'frost_lance' } },
      { desc: "Shatter Lance becomes Glacier Lance: it pierces everyone in its target's lane.", ability: { id: 'glacier_lance', replace: 'shatter_lance' } }] },
    { id: 'winters_herald', name: "Winter's Herald", desc: 'Slows everything near it.', tiers: [
      { desc: '+10% gauge rate.', mods: [m('gauge.rate', 'mul', 1.1)] },
      { desc: '+8 EVA.', mods: [m('eva', 'add', 8)] },
      { desc: 'Learns Hoarfrost: frosts a foe and everyone next to it, draining 30 gauge.', ability: { id: 'hoarfrost' } },
      { desc: 'Learns Deep Winter: frosts every foe within 3 tiles, draining 40 gauge, while 2+ foes stand there.', ability: { id: 'deep_winter' } }] }
  ],
  hive_warden: [
    { id: 'brood_mother', name: 'Brood Mother', desc: 'Mends the whole swarm.', tiers: [
      { desc: '+25% healing given.', mods: [m('heal.given', 'mul', 1.25)] },
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: 'Mend becomes Swarm Mend: heals every ally within 2 tiles.', ability: { id: 'swarm_mend', replace: 'mend' } },
      { desc: 'Swarm Mend becomes Brood Surge: heals every ally within 3 tiles and gives them Regen.', ability: { id: 'brood_surge', replace: 'swarm_mend' } }] },
    { id: 'chitin_guard', name: 'Chitin Guard', desc: 'Armours those beside it.', tiers: [
      { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
      { desc: 'Takes 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] },
      { desc: 'Gains an aura: allies next to it get +15% DEF.', aura: { range: 1, desc: 'Allies next to it get +15% DEF.', mods: [m('def', 'mul', 1.15)] } },
      { desc: 'Learns Molt: strips up to 3 debuffs from itself and every ally within 2 tiles.', ability: { id: 'molt' } }] }
  ],
  clockwork_page: [
    { id: 'saboteur', name: 'Saboteur', desc: 'Jams the enemy back line.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+10 CRT.', mods: [m('crt', 'add', 10)] },
      { desc: 'Strike becomes Spanner in the Works: 30 power, drains 40 gauge.', ability: { id: 'spanner', replace: 'strike' } },
      { desc: "Spanner becomes Wrench the Works: it empties a foe's gauge.", ability: { id: 'wrench', replace: 'spanner' } }] },
    { id: 'gearwright', name: 'Gearwright', desc: 'Keeps the others ticking.', tiers: [
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: '+10% gauge rate.', mods: [m('gauge.rate', 'mul', 1.1)] },
      { desc: 'Purge becomes Overclock: Hasten and one debuff removed, on the most wounded ally.', ability: { id: 'overclock', replace: 'purge' } },
      { desc: 'Overclock becomes Perpetual Motion: Hasten and a debuff removed for every ally within 2 tiles.', ability: { id: 'perpetual_motion', replace: 'overclock' } }] }
  ],
  grave_ghoul: [
    { id: 'glutton', name: 'Glutton', desc: 'Eats to stay standing.', tiers: [
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: 'Takes 8% less damage.', mods: [m('damage.taken', 'mul', 0.92)] },
      { desc: 'Gnaw becomes Devour: 34 power, and it heals itself.', ability: { id: 'devour', replace: 'gnaw' } },
      { desc: 'Devour becomes Gorge: it bites a foe and every foe next to it, and heals itself once.', ability: { id: 'gorge', replace: 'devour' } }] },
    { id: 'plague_bearer', name: 'Plague-Bearer', desc: 'Every bite festers.', tiers: [
      { desc: '+12% ATK.', mods: [m('atk', 'mul', 1.12)] },
      { desc: '+12% gauge rate.', mods: [m('gauge.rate', 'mul', 1.12)] },
      { desc: 'Gnaw becomes Plague Bite: Brittle and Withered.', ability: { id: 'plague_bite', replace: 'gnaw' } },
      { desc: 'Plague Bite becomes Pestilence: Brittle and Withered for a foe and every foe next to it.', ability: { id: 'pestilence', replace: 'plague_bite' } }] },
    // Glutton and Plague-Bearer both remake Gnaw, so neither can be the other's second path: this one is.
    { id: 'pack_leader', name: 'Pack Leader', desc: 'The pack runs at its heel.', tiers: [
      { desc: '+15% DEF.', mods: [m('def', 'mul', 1.15)] },
      { desc: '+10% gauge rate.', mods: [m('gauge.rate', 'mul', 1.1)] },
      { desc: 'Gains an aura: allies next to it deal 10% more damage.', aura: { range: 1, desc: 'Allies next to it deal 10% more damage.', mods: [m('damage.dealt', 'mul', 1.1)] } },
      { desc: 'Learns Baying Howl: Hasten for every ally within 2 tiles, in the first 10 s.', ability: { id: 'baying_howl' } }] }
  ],
  will_o_wisp: [
    { id: 'lantern', name: 'Lantern', desc: 'Its light spreads to crowds.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+15 ACC.', mods: [m('acc', 'add', 15)] },
      { desc: 'Learns Wildfire: 24 power to a foe and everyone next to it.', ability: { id: 'wildfire' } },
      { desc: 'Wildfire becomes Conflagration: it burns every foe within 4 tiles, while 3+ foes stand there.', ability: { id: 'conflagration', replace: 'wildfire' } }] },
    { id: 'will_ward', name: 'Will-Ward', desc: 'Hard to pin down, and so are its friends.', tiers: [
      { desc: '+8 EVA.', mods: [m('eva', 'add', 8)] },
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: 'Gains an aura: allies next to it get +8 EVA.', aura: { range: 1, desc: 'Allies next to it get +8 EVA.', mods: [m('eva', 'add', 8)] } },
      { desc: 'Learns Veil: Veiled (+20 EVA) for itself and every ally within 2 tiles, while one is below 75% HP.', ability: { id: 'veil' } }] }
  ],
  thorn_dryad: [
    { id: 'heartwood', name: 'Heartwood', desc: 'Deep-rooted healing.', tiers: [
      { desc: '+25% healing given.', mods: [m('heal.given', 'mul', 1.25)] },
      { desc: '+15% max HP.', mods: [m('hp', 'mul', 1.15)] },
      { desc: 'Mend becomes Bloom: 34 power and Regen every time.', ability: { id: 'bloom', replace: 'mend' } },
      { desc: 'Bloom becomes Verdant Bloom: it heals every ally within 2 tiles, with Regen.', ability: { id: 'verdant_bloom', replace: 'bloom' } }] },
    { id: 'bramble', name: 'Bramble', desc: 'A healer with thorns.', tiers: [
      { desc: '+15% DEF.', mods: [m('def', 'mul', 1.15)] },
      { desc: '+12% ATK.', mods: [m('atk', 'mul', 1.12)] },
      { desc: 'Learns Thorn Lash: damage to a foe and everyone level with it.', ability: { id: 'thorn_lash' } },
      { desc: 'Thorn Lash becomes Briar Lash: it reaches 2 tiles, and leaves everyone level with its target Brittle.', ability: { id: 'briar_lash', replace: 'thorn_lash' } }] }
  ],
  mantis_reaper: [
    { id: 'executioner', name: 'Executioner', desc: 'One cut, one corpse.', tiers: [
      { desc: '+12% ATK.', mods: [m('atk', 'mul', 1.12)] },
      { desc: '+12 CRT.', mods: [m('crt', 'add', 12)] },
      { desc: 'Reap becomes Execute: 48 power.', ability: { id: 'execute', replace: 'reap' } },
      { desc: 'Execute becomes Harvest: 40 power to a foe and every foe next to it.', ability: { id: 'harvest', replace: 'execute' } }] },
    { id: 'phantom', name: 'Phantom', desc: 'Never quite where it was.', tiers: [
      { desc: '+10 EVA.', mods: [m('eva', 'add', 10)] },
      { desc: '+10% gauge rate.', mods: [m('gauge.rate', 'mul', 1.1)] },
      { desc: '+15 EVA, +15% damage dealt.', mods: [m('eva', 'add', 15), m('damage.dealt', 'mul', 1.15)] },
      { desc: 'Learns Phantom Edge: it strikes from up to 3 tiles away when nothing is next to it.', ability: { id: 'phantom_edge', at: 1 } }] }
  ],
  iron_golem: [
    { id: 'juggernaut', name: 'Juggernaut', desc: 'An iron wall that shelters others.', tiers: [
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
      { desc: 'Gains an aura: allies next to it take 10% less damage.', aura: { range: 1, desc: 'Allies next to it take 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] } },
      { desc: 'Learns Magnetize: once a foe is next to it, it drags at every foe within 2 tiles, draining 35 gauge, while 2+ stand there.', ability: { id: 'magnetize' } }] },
    { id: 'siegebreaker', name: 'Siegebreaker', desc: 'Breaks whole formations.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+10% gauge rate.', mods: [m('gauge.rate', 'mul', 1.1)] },
      { desc: 'Quake becomes Earthshatter: 26 power, drains 40 gauge.', ability: { id: 'earthshatter', replace: 'quake' } },
      { desc: 'Earthshatter becomes Worldbreaker: it hits everyone level with its target, draining 40 gauge.', ability: { id: 'worldbreaker', replace: 'earthshatter' } }] }
  ],
  barrow_wight: [
    { id: 'lich', name: 'Lich-in-Waiting', desc: 'Feeds on what it kills.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+10 CRT.', mods: [m('crt', 'add', 10)] },
      { desc: 'Wither becomes Soul Drain: 34 power, and it heals itself.', ability: { id: 'soul_drain', replace: 'wither' } },
      { desc: 'Soul Drain becomes Soul Harvest: it drains a foe and every foe next to it, and heals itself once.', ability: { id: 'soul_harvest', replace: 'soul_drain' } }] },
    { id: 'dread', name: 'Dread', desc: 'Its wail saps whole squads.', tiers: [
      { desc: '+15% max HP.', mods: [m('hp', 'mul', 1.15)] },
      { desc: '+8 EVA.', mods: [m('eva', 'add', 8)] },
      { desc: 'Learns Dread Wail: Withers a foe and everyone next to it.', ability: { id: 'dread_wail' } },
      { desc: 'Dread Wail becomes Death Knell: it Withers every foe within 3 tiles.', ability: { id: 'death_knell', replace: 'dread_wail' } }] }
  ],
  frost_wyrm: [
    { id: 'ancient', name: 'Ancient', desc: 'Older, thicker, colder.', tiers: [
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: '+15% DEF.', mods: [m('def', 'mul', 1.15)] },
      { desc: 'Glacial Breath becomes Blizzard: freezes a foe and everyone level with it.', ability: { id: 'blizzard', replace: 'glacial_breath' } },
      { desc: 'Blizzard becomes Ice Age: it freezes every foe within 3 tiles.', ability: { id: 'ice_age', replace: 'blizzard' } }] },
    { id: 'rime_tyrant', name: 'Rime Tyrant', desc: 'Pure killing cold.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+10% gauge rate.', mods: [m('gauge.rate', 'mul', 1.1)] },
      { desc: '+20% damage dealt, +10 CRT.', mods: [m('damage.dealt', 'mul', 1.2), m('crt', 'add', 10)] },
      { desc: 'Learns Killing Cold: 40 power to the most wounded foe anywhere on the board, once one is below half HP.', ability: { id: 'killing_cold' } }] }
  ]
}

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
    id: 'veiled',
    desc: '+20 EVA.',
    name: 'Veiled',
    tags: ['buff'],
    dur: 120,
    stacks: 1,
    mods: [{ path: 'eva', op: 'add', v: 20 }]
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
  },
  {
    // A relic's gift to a body as it enters (Tower Shield).
    id: 'shield',
    desc: 'Takes 40% less damage.',
    name: 'Shielded',
    tags: ['buff'],
    dur: 160,
    stacks: 1,
    mods: [{ path: 'damage.taken', op: 'mul', v: 0.6 }]
  }
]

// ── kin and roles ────────────────────────────────────────────────────────────────────────────

const KIN_LIST = [
  { id: 'undead', name: 'Undead' },
  { id: 'construct', name: 'Construct' },
  { id: 'fae', name: 'Fae' },
  { id: 'insect', name: 'Insect' },
  { id: 'drake', name: 'Drake' }
]

// autoRow: 0 front, 1 mid, 2 back (3 mid-camp, behind them). `move` is how the role behaves on the board
// (BEHAVIOURS); `target` picks among the foes in reach: the nearest, or the lowest HP%. A `hidden` role
// (the Monarch's) counts toward no synergy and holds no bond.
export const ROLE_LIST = [
  { id: 'vanguard', name: 'Vanguard', autoRow: 0, move: 'advance', target: 'nearest' },
  { id: 'skirmisher', name: 'Skirmisher', autoRow: 1, move: 'keep', target: 'weakest' },
  { id: 'ranger', name: 'Ranger', autoRow: 2, move: 'keep', target: 'weakest' },
  { id: 'channeler', name: 'Channeler', autoRow: 2, move: 'keep', target: 'nearest' },
  { id: 'warden', name: 'Warden', autoRow: 1, move: 'advance', target: 'nearest' },
  { id: 'trickster', name: 'Trickster', autoRow: 1, move: 'flank', target: 'weakest' },
  { id: 'monarch', name: 'Monarch', autoRow: 3, move: 'stand', target: 'nearest', hidden: true }
]

// How a unit moves, by its role's `move`. Everyone steps at one pace (TUNING.board.stepTicks). Nobody
// moves while an ability has a target in reach, except a flanker whose quarry is out of reach.
// `slips`: it can walk away from a foe next to it; everyone else is held in place. A flanker also walks
// through the living to an open tile beyond; bodies block everyone else.
export const BEHAVIOURS = {
  advance: { name: 'Advance', slips: false, desc: 'Walks to the nearest foe and fights it.' },
  keep: { name: 'Hold back', slips: false, desc: 'Walks only until a foe is in range, and never steps next to a foe while it has a ranged attack.' },
  // Who exactly a flanker hunts is left for the player to discover; the text only hints.
  flank: { name: 'Flank', slips: true, desc: 'Slips through the line, friend and foe alike, to hunt whoever hides at the back. Only walls stop it.' },
  stand: { name: 'Stand', slips: false, desc: 'Never takes a step: it stands where it was placed for the whole battle.' }
}

// What a foe can do to a Monarch, by kind (UNIT_LIST `threats`). The scouted roles hint at them; what each
// does is learnt by fighting it.
export const THREATS = {
  flank: { name: 'Flank', desc: 'Slips through the line to whoever hides at the back.' },
  reach: { name: 'Reach', desc: 'Strikes from afar once the line gives way.' },
  shape: { name: 'Shape', desc: 'Hits a whole row, lane or crowd at once.' },
  drain: { name: 'Drain', desc: 'Saps gauge or rots defence.' },
  clock: { name: 'Clock', desc: 'Drags a fight on into escalation.' },
  // A room's, not a kind's: more foes enter behind the first (a late pair, waves).
  depth: { name: 'Depth', desc: 'More foes arrive behind the first, from the far edge.' }
}

// What an elite's captain may be bidden to do (UNIT_LIST `foeOrders`), as a plan in battle: hold its ground,
// hunt (the default), or walk to a wing of your camp and hunt from there. Never shown to the player.
export const FOE_ORDERS = {
  stay: { where: 'stay' },
  hunt: { where: 'hunt' },
  flank: { where: 'move' }
}

// ── synergies ────────────────────────────────────────────────────────────────────────────────

// Active while a side's living units meet every count in `needs` ({ kin: {…}, role: {…} }).
// A mod with `pos` only applies while the unit is 'engaged' (a foe next to it) or 'free' (none).
export const SYNERGIES = [
  { id: 'undead_2', name: 'Undead 2', desc: 'The dead do not flinch. +6% DEF.', needs: { kin: { undead: 2 } }, mods: [{ path: 'def', op: 'mul', v: 1.06 }] },
  { id: 'undead_4', name: 'Undead 4', desc: '+15% DEF, +5% max HP.', needs: { kin: { undead: 4 } }, mods: [{ path: 'def', op: 'mul', v: 1.15 }, { path: 'hp', op: 'mul', v: 1.05 }] },
  { id: 'drake_2', name: 'Drake 2', desc: '+8% ATK.', needs: { kin: { drake: 2 } }, mods: [{ path: 'atk', op: 'mul', v: 1.08 }] },
  { id: 'fae_2', name: 'Fae 2', desc: '+4 EVA.', needs: { kin: { fae: 2 } }, mods: [{ path: 'eva', op: 'add', v: 4 }] },
  { id: 'insect_2', name: 'Insect 2', desc: '+3% gauge rate.', needs: { kin: { insect: 2 } }, mods: [{ path: 'gauge.rate', op: 'mul', v: 1.03 }] },
  { id: 'construct_2', name: 'Construct 2', desc: '+5 DEF.', needs: { kin: { construct: 2 } }, mods: [{ path: 'def', op: 'add', v: 5 }] },
  { id: 'vanguard_2', name: 'Vanguard 2', desc: 'The front holds. +7% DEF.', needs: { role: { vanguard: 2 } }, mods: [{ path: 'def', op: 'mul', v: 1.07 }] },
  { id: 'ranger_3', name: 'Ranger 3', desc: 'Souls with no foe next to them deal +12% damage.', needs: { role: { ranger: 3 } }, mods: [{ path: 'damage.dealt', op: 'mul', v: 1.12, pos: 'free' }] },
  { id: 'skirmisher_2', name: 'Skirmisher 2', desc: '+4 SPD.', needs: { role: { skirmisher: 2 } }, mods: [{ path: 'spd', op: 'add', v: 4 }] },
  { id: 'channeler_2', name: 'Channeler 2', desc: '+6% damage dealt.', needs: { role: { channeler: 2 } }, mods: [{ path: 'damage.dealt', op: 'mul', v: 1.06 }] },
  { id: 'warden_2', name: 'Warden 2', desc: '+12% healing given.', needs: { role: { warden: 2 } }, mods: [{ path: 'heal.given', op: 'mul', v: 1.12 }] },
  { id: 'trickster_2', name: 'Trickster 2', desc: '+3 CRT, +3 EVA.', needs: { role: { trickster: 2 } }, mods: [{ path: 'crt', op: 'add', v: 3 }, { path: 'eva', op: 'add', v: 3 }] },
  // Pacts: cross-axis recipes.
  { id: 'scaled_wall', name: 'Scaled Wall', desc: 'Drake 2 + Vanguard 2: engaged souls take 10% less damage.', needs: { kin: { drake: 2 }, role: { vanguard: 2 } }, mods: [{ path: 'damage.taken', op: 'mul', v: 0.9, pos: 'engaged' }] },
  { id: 'glamour', name: 'Glamour', desc: 'Fae 2 + Trickster 2: +5 EVA, +4% gauge rate.', needs: { kin: { fae: 2 }, role: { trickster: 2 } }, mods: [{ path: 'eva', op: 'add', v: 5 }, { path: 'gauge.rate', op: 'mul', v: 1.04 }] },
  { id: 'swarm_logic', name: 'Swarm Logic', desc: 'Insect 4 + Skirmisher 2: +8% gauge rate.', needs: { kin: { insect: 4 }, role: { skirmisher: 2 } }, mods: [{ path: 'gauge.rate', op: 'mul', v: 1.08 }] },
  { id: 'grave_vigil', name: 'Grave Vigil', desc: 'Undead 4 + Warden 2: +12% max HP.', needs: { kin: { undead: 4 }, role: { warden: 2 } }, mods: [{ path: 'hp', op: 'mul', v: 1.12 }] },
  { id: 'ember_choir', name: 'Ember Choir', desc: 'Drake 2 + Channeler 2: +10% damage dealt, +3 CRT.', needs: { kin: { drake: 2 }, role: { channeler: 2 } }, mods: [{ path: 'damage.dealt', op: 'mul', v: 1.1 }, { path: 'crt', op: 'add', v: 3 }] },
  // The deep steps, 4 and 6, then 8: a kin or role five units deep (most are two or three) reaches them only
  // with cohorts and shadows, which count like anyone else. Steps stack: Undead 6 also has Undead 2 and 4.
  // Ranger's first step stays at 3. An 8 is a rule, not a number (`rule`: the battle reads it, see battle.js
  // rulesOf); it holds for whichever side has it, foes deep in the endless floors too.
  { id: 'undead_6', name: 'Undead 6', desc: '+8% DEF, +10% max HP.', needs: { kin: { undead: 6 } }, mods: [{ path: 'def', op: 'mul', v: 1.08 }, { path: 'hp', op: 'mul', v: 1.1 }] },
  { id: 'undead_8', name: 'Undead 8', desc: 'The Legion: every foe slain rises at once as a shadow on your side, past Arise\'s limit and tier (never a boss, a shadow or a Monarch), while your side has room on the board for it.', needs: { kin: { undead: 8 } }, rule: 'legion', mods: [] },
  { id: 'drake_4', name: 'Drake 4', desc: '+10% damage dealt.', needs: { kin: { drake: 4 } }, mods: [{ path: 'damage.dealt', op: 'mul', v: 1.1 }] },
  { id: 'drake_6', name: 'Drake 6', desc: '+12% ATK, +5 CRT.', needs: { kin: { drake: 6 } }, mods: [{ path: 'atk', op: 'mul', v: 1.12 }, { path: 'crt', op: 'add', v: 5 }] },
  { id: 'drake_8', name: 'Drake 8', desc: 'Dragonfire: every single-target attack of yours bursts, striking its target and every foe next to it.', needs: { kin: { drake: 8 } }, rule: 'dragonfire', mods: [] },
  { id: 'fae_4', name: 'Fae 4', desc: '+6 EVA.', needs: { kin: { fae: 4 } }, mods: [{ path: 'eva', op: 'add', v: 6 }] },
  { id: 'fae_6', name: 'Fae 6', desc: '+8 EVA, +5% gauge rate.', needs: { kin: { fae: 6 } }, mods: [{ path: 'eva', op: 'add', v: 8 }, { path: 'gauge.rate', op: 'mul', v: 1.05 }] },
  { id: 'fae_8', name: 'Fae 8', desc: 'Mirage: the first blow each foe would land on one of yours in a battle strikes only an illusion, and misses.', needs: { kin: { fae: 8 } }, rule: 'mirage', mods: [] },
  { id: 'insect_4', name: 'Insect 4', desc: '+5% gauge rate.', needs: { kin: { insect: 4 } }, mods: [{ path: 'gauge.rate', op: 'mul', v: 1.05 }] },
  { id: 'insect_6', name: 'Insect 6', desc: '+10% gauge rate, +2 SPD.', needs: { kin: { insect: 6 } }, mods: [{ path: 'gauge.rate', op: 'mul', v: 1.1 }, { path: 'spd', op: 'add', v: 2 }] },
  { id: 'insect_8', name: 'Insect 8', desc: 'Frenzy: one of yours that slays a foe has its gauge filled at once, ready to strike again.', needs: { kin: { insect: 8 } }, rule: 'frenzy', mods: [] },
  { id: 'construct_4', name: 'Construct 4', desc: '+8 DEF.', needs: { kin: { construct: 4 } }, mods: [{ path: 'def', op: 'add', v: 8 }] },
  { id: 'construct_6', name: 'Construct 6', desc: '+12 DEF, +8% max HP.', needs: { kin: { construct: 6 } }, mods: [{ path: 'def', op: 'add', v: 12 }, { path: 'hp', op: 'mul', v: 1.08 }] },
  { id: 'construct_8', name: 'Construct 8', desc: 'Last Stand: the first blow that would fell each of yours in a battle leaves it standing at 1 HP (never the Monarch).', needs: { kin: { construct: 8 } }, rule: 'last_stand', mods: [] },
  { id: 'vanguard_4', name: 'Vanguard 4', desc: '+10% DEF.', needs: { role: { vanguard: 4 } }, mods: [{ path: 'def', op: 'mul', v: 1.1 }] },
  { id: 'vanguard_6', name: 'Vanguard 6', desc: 'Engaged souls take 10% less damage.', needs: { role: { vanguard: 6 } }, mods: [{ path: 'damage.taken', op: 'mul', v: 0.9, pos: 'engaged' }] },
  { id: 'vanguard_8', name: 'Vanguard 8', desc: 'Bodyguard: a single-target blow at one of yours that is not a Vanguard lands instead on a Vanguard of yours standing next to it.', needs: { role: { vanguard: 8 } }, rule: 'bodyguard', mods: [] },
  { id: 'ranger_6', name: 'Ranger 6', desc: 'Souls with no foe next to them deal +15% damage.', needs: { role: { ranger: 6 } }, mods: [{ path: 'damage.dealt', op: 'mul', v: 1.15, pos: 'free' }] },
  { id: 'ranger_8', name: 'Ranger 8', desc: 'Deadeye: ranged blows of yours never miss, and every one is a critical hit.', needs: { role: { ranger: 8 } }, rule: 'deadeye', mods: [] },
  { id: 'skirmisher_4', name: 'Skirmisher 4', desc: '+5 SPD.', needs: { role: { skirmisher: 4 } }, mods: [{ path: 'spd', op: 'add', v: 5 }] },
  { id: 'skirmisher_6', name: 'Skirmisher 6', desc: '+8 SPD, +5 EVA.', needs: { role: { skirmisher: 6 } }, mods: [{ path: 'spd', op: 'add', v: 8 }, { path: 'eva', op: 'add', v: 5 }] },
  { id: 'skirmisher_8', name: 'Skirmisher 8', desc: 'Ambush: yours start the battle, and enter it, with a full gauge.', needs: { role: { skirmisher: 8 } }, rule: 'ambush', mods: [] },
  { id: 'channeler_4', name: 'Channeler 4', desc: '+8% damage dealt.', needs: { role: { channeler: 4 } }, mods: [{ path: 'damage.dealt', op: 'mul', v: 1.08 }] },
  { id: 'channeler_6', name: 'Channeler 6', desc: '+10% damage dealt, +5% gauge rate.', needs: { role: { channeler: 6 } }, mods: [{ path: 'damage.dealt', op: 'mul', v: 1.1 }, { path: 'gauge.rate', op: 'mul', v: 1.05 }] },
  { id: 'channeler_8', name: 'Channeler 8', desc: 'Echo: every ability yours use rings out twice, its effects striking its targets again for free (Arise never echoes).', needs: { role: { channeler: 8 } }, rule: 'echo', mods: [] },
  { id: 'warden_4', name: 'Warden 4', desc: '+15% healing given.', needs: { role: { warden: 4 } }, mods: [{ path: 'heal.given', op: 'mul', v: 1.15 }] },
  { id: 'warden_6', name: 'Warden 6', desc: '+20% healing given, +8% max HP.', needs: { role: { warden: 6 } }, mods: [{ path: 'heal.given', op: 'mul', v: 1.2 }, { path: 'hp', op: 'mul', v: 1.08 }] },
  { id: 'warden_8', name: 'Warden 8', desc: 'Sanctuary: every ability yours aim at an ally (a heal, a ward, a cleanse) touches every one of yours on the board.', needs: { role: { warden: 8 } }, rule: 'sanctuary', mods: [] },
  { id: 'trickster_4', name: 'Trickster 4', desc: '+4 CRT, +4 ACC.', needs: { role: { trickster: 4 } }, mods: [{ path: 'crt', op: 'add', v: 4 }, { path: 'acc', op: 'add', v: 4 }] },
  { id: 'trickster_6', name: 'Trickster 6', desc: '+6 CRT, +8% damage dealt.', needs: { role: { trickster: 6 } }, mods: [{ path: 'crt', op: 'add', v: 6 }, { path: 'damage.dealt', op: 'mul', v: 1.08 }] },
  { id: 'trickster_8', name: 'Trickster 8', desc: 'Deathblow: a critical hit of yours slays any foe but a boss or a Monarch outright (a Last Stand still holds, once).', needs: { role: { trickster: 8 } }, rule: 'deathblow', mods: [] }
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

// ── ranks ────────────────────────────────────────────────────────────────────────────────────

// A captain's rank (u.grade: 0, 1, 2), bought with bodies of its kin, not essence (TUNING.ranks). Each rank
// removes a limit instead of adding a percentage.
export const GRADES = [
  { id: 'soldier', name: 'Soldier', desc: 'Tiers I–III on one path.' },
  { id: 'knight', name: 'Knight', desc: 'Tier IV on its path, or tier I of a second path. Leads 2 more bodies in its cohort.' },
  { id: 'marshal', name: 'Marshal', desc: 'A domain of its own: within it its banner never falters and heeds every order, and the dead raised there join its banner. Tier IV and tiers I–III of a second path, both. Leads 4 more bodies in its cohort.' }
]

// ── banner shapes ────────────────────────────────────────────────────────────────────────────

// How a captain's cohort stands around it in the camp: `offsets` are [dRow, dCol] from the captain's cell,
// in the order its members take them (dRow > 0 is further back, toward the camp's rear, dRow < 0 ahead; dCol
// > 0 the next lane right). A member whose offset is walled, off the camp or taken takes the next free one, then the
// open cell nearest its captain. In battle a member keeps within a tile of its captain, so a shape is
// how the banner meets the first blow, which bonds it holds, and how fast it closes up.
export const SHAPES = {
  pair: {
    name: 'Pair', desc: 'Two abreast, filing back behind the captain: narrow, and deep.',
    offsets: [[0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0], [6, 1]]
  },
  line: {
    name: 'Line', desc: 'One rank abreast of the captain, lanes out to either side, then a second rank behind.',
    offsets: [[0, -1], [0, 1], [0, -2], [0, 2], [0, -3], [0, 3], [1, 0], [1, -1], [1, 1], [1, -2], [1, 2], [1, -3], [1, 3]]
  },
  wedge: {
    name: 'Wedge', desc: 'The captain at the point, its cohort fanning out behind it on the diagonals.',
    offsets: [[1, -1], [1, 1], [2, -2], [2, 2], [2, 0], [3, -3], [3, 3], [3, -1], [3, 1], [4, -2], [4, 2], [4, 0]]
  },
  block: {
    name: 'Block', desc: 'Three lanes wide with the captain at the front and centre: packed close around it.',
    offsets: [[0, -1], [0, 1], [1, -1], [1, 0], [1, 1], [2, -1], [2, 0], [2, 1], [3, -1], [3, 0], [3, 1], [4, -1], [4, 0], [4, 1]]
  },
  // reDESIGN §10: a deliberate gap is a trap. The tile ahead of the captain is left open between two horns: a
  // foe that walks into it stands beside the captain and both horns at once. All seven around the captain
  // keep their leash of a tile with the mouth still open; an eighth and on stand two out, and closing up on
  // their captain in battle, may fill it.
  mouth: {
    name: 'Mouth', desc: 'Two horns a step ahead on either side of the captain, the tile before it left open: a foe that walks in is met on three sides. Past seven, the rest may close it.',
    offsets: [[-1, -1], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 1], [1, 0], [0, -2], [0, 2], [1, -2], [1, 2], [-1, -2], [-1, 2], [2, 0]]
  }
}

// ── orders ───────────────────────────────────────────────────────────────────────────────────

// A detachment's plan: where it goes once nothing calls for a reaction, and when it takes the field. A
// detachment that starts later waits off the board, in the dark behind the camp, and enters beside the
// Monarch when its start comes. The reaction rule comes before every plan: a unit that can hit a foe hits
// it, a melee unit steps to engage a foe within 2 tiles, a ranged one holds while a foe is in its range.
// Outside the Monarch's domain only Hunt is heeded. A held detachment, once called, still enters only while
// fewer than TUNING.army.board of the party's bodies stand on the board (it waits for room, as the reserve
// does), so on a full board every later start enters as bodies fall.
export const ORDERS = {
  where: {
    hunt: { name: 'Hunt', desc: 'Each walks as its role does: Advance to the nearest foe, Hold back until a foe is in range, Flank through the line to whoever hides at the back. Every soul with no order Hunts.' },
    stay: { name: 'Stay', desc: 'Holds the ground it starts or enters on, and walks back to it after each fight.' },
    move: { name: 'Move', desc: 'Walks to its square by the cheapest open way; on the square or next to it, it has arrived and Hunts.' }
  },
  when: {
    once: { name: 'At once', desc: 'On the board from the start.' },
    time: { name: 'At a time', desc: 'Waits behind the camp, and enters beside the Monarch when the time comes, as the board has room.' },
    struck: { name: 'Monarch struck', desc: 'Waits behind the camp, and enters beside the Monarch once a blow lands on it, as the board has room.' },
    wave: { name: 'A wave', desc: 'Waits behind the camp, and enters beside the Monarch once more foes enter the field, as the board has room.' },
    falls: { name: 'A body falls', desc: 'Waits behind the camp, and enters beside the Monarch once one of yours on the board falls, as the board has room.' }
  }
}

// Each detachment's colour, by its id (1 to TUNING.army.detachments): its mark on the camp and the board.
export const DETACHMENT_COLORS = ['#e8c15a', '#5ab4e8', '#e8708f', '#86d67a']

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

// Run-long passives. `mods` apply to every fielded soul in battle (a `pos` mod only in that position, a
// `who` mod only to souls of that role or kin); `field` adds field slots; `roster` adds room in the
// retinue; `soulLevel` adds levels to every soul you recruit; `essence` raises the essence battles
// pay by that share; `levelDiscount`, `tierDiscount` and `recruitDiscount` cut those prices by theirs.
// Most are triggers: `on` names a moment of a battle, for your side only, and `effects` run then (as an
// ability's do; a heal with `pct` mends that share of the target's max HP, whoever casts it). Each moment
// has a subject, a place and the one on its other end: 'kill' (one of yours slays a foe: the killer, where
// the slain fell, the slain), 'fall' (one of yours falls, the Monarch aside, whose fall ends the battle: the
// fallen, where it fell, its killer), 'enter' (one of yours enters from behind the camp, a reserve body or a
// held detachment's: the newcomer, where it enters)
// and 'struck' (a blow lands on the Monarch and it stands: the Monarch, where it stands, its attacker). An
// effect's `to` picks its targets: 'self' (the subject) or 'other', if it stands; 'monarch'; or 'allies' /
// 'foes' (yours / theirs standing within `range` tiles of the place).
export const RELIC_LIST = [
  { id: 'whetstone', name: 'Whetstone', desc: '+12% ATK.', mods: [{ path: 'atk', op: 'mul', v: 1.12 }] },
  { id: 'grave_banner', name: 'Grave Banner', desc: '+1 field slot.', field: 1 },
  { id: 'soul_lantern', name: 'Soul Lantern', desc: 'Recruited souls rise 2 levels higher.', soulLevel: 2 },
  { id: 'hourglass', name: 'Hourglass', desc: 'When the Monarch is struck: Arise gains 30 gauge.', on: 'struck', effects: [{ op: 'gauge', amount: 30, to: 'monarch' }] },
  { id: 'heartwood', name: 'Heartwood', desc: '+15% max HP.', mods: [{ path: 'hp', op: 'mul', v: 1.15 }] },
  { id: 'tower_shield', name: 'Tower Shield', desc: 'When one of yours enters from behind the camp: it is Shielded for 8 s (takes 40% less damage).', on: 'enter', effects: [{ op: 'apply_status', status: 'shield', dur: 160, to: 'self' }] },
  { id: 'blood_chalice', name: 'Blood Chalice', desc: 'When one of yours slays a foe: the killer heals 10% of its max HP.', on: 'kill', effects: [{ op: 'heal', pct: 0.1, to: 'self' }] },
  { id: 'war_drum', name: 'War Drum', desc: 'When one of yours falls: your side within 2 tiles of it gains Hasten.', on: 'fall', effects: [{ op: 'apply_status', status: 'hasten', to: 'allies', range: 2 }] },
  { id: 'balm', name: 'Balm', desc: 'When one of yours falls: your side within 2 tiles of it heals 12% of its max HP.', on: 'fall', effects: [{ op: 'heal', pct: 0.12, to: 'allies', range: 2 }] },
  { id: 'tithe_bowl', name: 'Tithe Bowl', desc: 'Battles pay 25% more essence.', essence: 0.25 },
  { id: 'grave_ledger', name: 'Grave Ledger', desc: 'Levels cost 25% less essence.', levelDiscount: 0.25 },
  { id: 'rite_candle', name: 'Rite Candle', desc: 'Path tiers cost 25% less essence.', tierDiscount: 0.25 },
  { id: 'binding_chain', name: 'Binding Chain', desc: 'Recruiting a soul costs 30% less essence.', recruitDiscount: 0.3 },
  { id: 'ossuary_key', name: 'Ossuary Key', desc: 'Your retinue holds 3 more souls.', roster: 3 },
  { id: 'iron_oath', name: 'Iron Oath', desc: 'When the Monarch is struck: your side within 2 tiles of it gains Barkskin (+25% DEF).', on: 'struck', effects: [{ op: 'apply_status', status: 'barkskin', to: 'allies', range: 2 }] },
  { id: 'arcane_focus', name: 'Arcane Focus', desc: 'When one of yours slays a foe: the killer gains 40 gauge.', on: 'kill', effects: [{ op: 'gauge', amount: 40, to: 'self' }] },
  { id: 'hunters_mark', name: "Hunter's Mark", desc: 'When one of yours slays a foe: the foes next to the slain turn Brittle.', on: 'kill', effects: [{ op: 'apply_status', status: 'brittle', to: 'foes', range: 1 }] },
  { id: 'bone_idol', name: 'Bone Idol', desc: 'When one of yours falls: Arise gains 40 gauge.', on: 'fall', effects: [{ op: 'gauge', amount: 40, to: 'monarch' }] },
  { id: 'glass_crown', name: 'Glass Crown', desc: '+25% damage dealt, but +15% damage taken.', mods: [{ path: 'damage.dealt', op: 'mul', v: 1.25 }, { path: 'damage.taken', op: 'mul', v: 1.15 }] },
  { id: 'grave_bell', name: 'Grave Bell', desc: 'When the Monarch is struck: its attacker is Withered (−20% ATK).', on: 'struck', effects: [{ op: 'apply_status', status: 'withered', to: 'other' }] },
  { id: 'rally_horn', name: 'Rally Horn', desc: 'When one of yours enters from behind the camp: your side within 2 tiles of it gains Hasten.', on: 'enter', effects: [{ op: 'apply_status', status: 'hasten', to: 'allies', range: 2 }] }
]

// The moments a relic can trigger on.
export const TRIGGERS = ['kill', 'fall', 'enter', 'struck']

// ── keystones ────────────────────────────────────────────────────────────────────────────────

// Rules that rewrite the game, two or three a run (offered at elites and rites from floor 2, free; see
// TUNING.keystone). Each holds one or more of: `field` (more banners), `mods` (on every party unit in
// battle but the Monarch: your souls, their cohorts and shadows), `rise` (a fallen captain rises once a
// battle at that share of its max HP), `pool` (each banner's captain and cohort share one HP pool), `alias`
// ({ role: role }: a unit of the first counts as the second too, for your synergies and bonds), `crown` (the
// domain centres on your front-most captain), `domain` (tiles more or fewer), `keep` (shadows stay after a
// battle as rank-and-file), `raises` (Arise's cap a battle times this), `tithe` (each shadow costs the
// Monarch this share of its max HP) and `unhealable` (nothing heals the Monarch, in battle or out). Nothing
// ever revives the Monarch.
export const KEYSTONE_LIST = [
  { id: 'legion', name: 'Legion', desc: 'Two more banners, but every soul has 15% less HP.', field: 2, mods: [{ path: 'hp', op: 'mul', v: 0.85 }] },
  { id: 'undying', name: 'Undying', desc: 'Fallen captains rise once a battle, at 50% HP.', rise: 0.5 },
  { id: 'one_army', name: 'One Army', desc: 'Each banner shares one HP pool between its captain and its cohort.', pool: true },
  { id: 'mimicry', name: 'Mimicry', desc: 'Vanguards count as Wardens too, for synergies and bonds.', alias: { vanguard: 'warden' } },
  { id: 'vanguard_crown', name: 'Vanguard Crown', desc: 'The domain is centred on your front-most captain, not the Monarch, and is 1 tile smaller.', crown: true, domain: -1 },
  { id: 'hollow_court', name: 'Hollow Court', desc: 'Shadows raised by Arise that still stand when a battle ends stay, as rank-and-file in the ossuary.', keep: true },
  { id: 'blood_tithe', name: 'Blood Tithe', desc: "Arise's cap a battle is doubled, but each shadow costs the Monarch 3% of its max HP.", raises: 2, tithe: 0.03 },
  { id: 'court_of_bone', name: 'Court of Bone', desc: 'The domain is 2 tiles larger, but nothing heals the Monarch, in battle or out.', domain: 2, unhealable: true }
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
export const KIN = byId(KIN_LIST)
export const ROLES = byId(ROLE_LIST)
export const RELICS = byId(RELIC_LIST)
export const ANIMS = byId(ANIM_LIST)
export const CAMPS = byId(CAMP_LIST)
export const KEYSTONES = byId(KEYSTONE_LIST)

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
export const relicDef = lookup(RELICS, 'relic')
export const animDef = lookup(ANIMS, 'anim')
export const campDef = lookup(CAMPS, 'camp')
export const keystoneDef = lookup(KEYSTONES, 'keystone')

// A unit's picture as a URL the page and the battle both load. pose: 'alive', 'attack' or 'dead'.
export const ART_POSES = ['alive', 'attack', 'dead']
export const artUrl = (id, pose = 'alive') => new URL(`./assets/units/${unitDef(id).art}.${pose}.svg`, import.meta.url).href
