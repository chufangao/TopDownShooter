// All game content: units, abilities, upgrade tracks, statuses, kin and roles, behaviours, synergies, camps,
// fusions, relics and attack animations, plus id lookups. Data only; balance numbers live in tuning.js.

// ── units ────────────────────────────────────────────────────────────────────────────────────

// base + growth × (lvl − 1). `art` names the unit's three pictures in `assets/units/`: `${art}.alive.svg`,
// `${art}.attack.svg` and `${art}.dead.svg` (see artUrl). The battle animates them in code: no frames.
// `aura`: mods every ally (not itself) within `range` tiles gets while it stands. `threats`: what a foe
// of this kind does to a Monarch (THREATS), for the encounter draw's variety rule; never shown as intent.
// `ring`: the radius in tiles it fights within, measured from its footprint (DESIGN §2.3): a ranged kind's reach;
// for a melee kind its arm. `arm` (optional, 1 by default): how far a melee blow of yours with no range of its own
// reaches, never past the ring: 2 for the two long-armed kinds, whose ring is 2 (one of yours strikes two tiles off
// without stepping; unit.js armOf); a tier that grows the ring grows no arm, and a foe has no melee reach past what
// stands beside it whatever its arm (battle.js closeIn). A walking foe may halt in the sight of a piece of yours that
// can strike it (its ring, as far as its blows that need no condition reach), once it can strike something of yours
// from there (unit.js holdOf, battle.js wayOf). `stride`
// (optional, 1 by default) scales how fast a foe of the kind walks: 0.5 and 0.75 for the slow, 1.5 for the quick
// (your pieces never move). `size` (optional, 1 by default): 2 for a 2×2 footprint (DESIGN §2.2). `flies`: it flies
// the air road, over the walls but never through your pieces, and only a ranged blow (or a flyer's melee) can strike
// it (DESIGN §2.4 Fly).
// `onFall`: a death burst, its effects run from where it fell on the other side's living within `range`. `fused`: a
// fusion's result (FUSION_LIST), never spawned nor recruited, so no threats nor behaviour. Each kind does one legible
// thing on the board. `behaviour`: how it comes down the roads as a foe (BEHAVIOURS), learnt by meeting it: every
// ground kind walks the one drawn road, and the flyers, which carry the `fly` threat, fly the air road; `flavour`: a
// line of lore that hints at it, never naming it.

export const UNIT_LIST = [
  {
    // You. It stands where it is placed and never strikes; once the run holds the Arise relic it raises the dead
    // about it (its one ability, the relic's); if it falls the battle and the run are lost. Its HP comes from the
    // run (TUNING.monarch.hp and the HP relics: run.js monarchHp), not from base + growth; it has no level. Never
    // offered, never spawns. Its ring strikes nothing: it is how near a foe comes before the Monarch holds it
    // (unit.js holdOf), on the ground or in the air.
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
    ring: 1,
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
    // The singer at the back: four tiles of reach, and its dirge quickens those about it.
    ring: 4,
    spawn: { weight: 14, minFloor: 1 },
    threats: ['reach', 'drain', 'clock'],
    behaviour: 'walk',
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
    // The wall: it holds a tile, and as a foe walks slowly in its old plate.
    ring: 1,
    stride: 0.75,
    aura: { range: 1, desc: 'Allies next to it take 15% less damage.', mods: [{ path: 'damage.taken', op: 'mul', v: 0.85 }] },
    spawn: { weight: 10, minFloor: 1 },
    threats: ['shape'],
    behaviour: 'walk',
    flavour: "A tomb knight's plate is older than its barrow, and it moves like the barrow does: slowly, and never back.",
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
    // The burster: four tiles of reach, and a blast on whatever it aims at and everyone next to it.
    ring: 4,
    spawn: { weight: 8, minFloor: 2 },
    threats: ['shape', 'reach'],
    behaviour: 'walk',
    flavour: 'A drake comes down the straightest way to the thickest crowd, and the ground it breathes on burns all round.',
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
    // The quick one: it darts three tiles' reach in half the time, and its frost slows what it touches.
    ring: 3,
    stride: 1.5,
    spawn: { weight: 12, minFloor: 1 },
    threats: ['reach', 'drain'],
    behaviour: 'walk',
    flavour: 'A sprite is there before its frost is, and whatever the frost touches moves as if through snow.',
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
    // The mender at the front: it heals whichever ally is hurt worst, wherever it stands.
    ring: 1,
    spawn: { weight: 9, minFloor: 1 },
    threats: ['clock'],
    behaviour: 'walk',
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
    // The tender: it picks the curses off its fellows and marches on.
    ring: 1,
    spawn: { weight: 12, minFloor: 1 },
    threats: ['clock'],
    behaviour: 'walk',
    flavour: 'A page was wound to tend its betters: it oils the seized joint, picks the curse from the plate, and marches on.',
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
    // The long arm: yours strikes whatever passes within two tiles of it (a foe's melee reaches only beside it).
    ring: 2,
    arm: 2,
    spawn: { weight: 13, minFloor: 1 },
    threats: ['drain'],
    behaviour: 'walk',
    flavour: 'A ghoul gnaws where the armour is thinnest, and whatever it has gnawed is never as hard again.',
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
    // The far fire: it strikes from four tiles off.
    ring: 4,
    spawn: { weight: 11, minFloor: 1 },
    threats: ['reach'],
    behaviour: 'walk',
    flavour: 'A wisp keeps the road as meekly as any pilgrim, yet its cold fire leaps four paces ahead of it to whatever is warm.',
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
    // The rooted one: it walks at half pace, and its grove grows thick about it.
    ring: 1,
    stride: 0.5,
    spawn: { weight: 9, minFloor: 2 },
    threats: ['clock'],
    behaviour: 'walk',
    flavour: 'A dryad is rooted where it stands, and pulls its roots up slowly when it must move.',
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
    // Quick, and a long arm: yours strikes two tiles off (a foe's melee reaches only beside it). Its threat, Shape, is
    // a stand-in: every foe carries one, and none names a lone hard melee blow (DESIGN §6, 2026-10-10).
    ring: 2,
    arm: 2,
    stride: 1.5,
    spawn: { weight: 7, minFloor: 2 },
    threats: ['shape'],
    behaviour: 'walk',
    flavour: 'A mantis stalks the road with its brood about it, quick as a thought, and its scythes fall before its shadow does.',
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
    // The juggernaut: slowest of all, and its quake shakes everything about it.
    ring: 1,
    stride: 0.5,
    spawn: { weight: 6, minFloor: 2 },
    threats: ['shape'],
    behaviour: 'walk',
    flavour: 'A golem moves at the pace of settling stone, and nothing turns it once it does.',
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
    // The cold reach: it withers from three tiles off.
    ring: 3,
    spawn: { weight: 6, minFloor: 3 },
    threats: ['reach', 'drain'],
    behaviour: 'walk',
    flavour: 'A wight treads the road it was once borne down to its barrow, and the living wither three paces before it ever touches them.',
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
    // The slow breath: it walks at three-quarter pace and freezes a whole lane three tiles long.
    ring: 3,
    stride: 0.75,
    spawn: { weight: 6, minFloor: 3 },
    threats: ['shape', 'reach'],
    behaviour: 'walk',
    flavour: 'An old wyrm makes the field come to it, and its brood waits with it.',
    art: 'frost_wyrm'
  },
  {
    // The burner of floor 1: quick, and its bite leaves Burning, which outlasts the hound.
    id: 'pyre_hound',
    name: 'Pyre Hound',
    kin: 'drake',
    role: 'skirmisher',
    tier: 2,
    base: { hp: 84, atk: 16, def: 8, spd: 30, acc: 46, eva: 16, crt: 8 },
    growth: { hp: 9, atk: 2.2, def: 0.7, spd: 1.5 },
    abilities: ['pyre_bite'],
    ring: 1,
    stride: 1.5,
    spawn: { weight: 10, minFloor: 1 },
    threats: ['burn'],
    behaviour: 'walk',
    flavour: 'A hound of the pyre runs ahead of the pack, and what it bites smoulders long after it has let go.',
    art: 'pyre_hound'
  },
  {
    // The flyer of floor 2 (DESIGN §2.4 Fly): over the walls, straight at the Monarch, never through your pieces; only a
    // ranged blow touches it.
    id: 'hive_drone',
    name: 'Hive Drone',
    kin: 'insect',
    role: 'skirmisher',
    tier: 1,
    base: { hp: 46, atk: 12, def: 3, spd: 36, acc: 46, eva: 26, crt: 6 },
    growth: { hp: 5, atk: 1.7, def: 0.3, spd: 2 },
    abilities: ['drone_sting'],
    ring: 1,
    flies: true,
    spawn: { weight: 10, minFloor: 2 },
    threats: ['fly'],
    behaviour: 'fly',
    flavour: 'Walls mean nothing to a drone: the hive points, and it goes there by the shortest air, and stings whatever stands in it.',
    art: 'hive_drone'
  },
  {
    // The death burst of floor 2 (DESIGN §2.4): slow and thick, and when it falls what stood next to it is Withered.
    id: 'rot_bloat',
    name: 'Rot Bloat',
    kin: 'undead',
    role: 'vanguard',
    tier: 2,
    base: { hp: 150, atk: 12, def: 10, spd: 12, acc: 40, eva: 4, crt: 2 },
    growth: { hp: 16, atk: 1.6, def: 0.9, spd: 0.5 },
    abilities: ['bile', 'strike'],
    ring: 1,
    stride: 0.75,
    onFall: { range: 1, effects: [{ op: 'apply_status', status: 'withered', dur: 140 }] },
    spawn: { weight: 8, minFloor: 2 },
    threats: ['drain'],
    behaviour: 'walk',
    flavour: 'A bloat is a corpse that kept its gas: it waddles, and no one who knows stands near when one is opened.',
    art: 'rot_bloat'
  },
  {
    // The hexer of floor 3: from three tiles off, its curse leaves Hexed, a slower gauge.
    id: 'marsh_hag',
    name: 'Marsh Hag',
    kin: 'fae',
    role: 'channeler',
    tier: 3,
    base: { hp: 88, atk: 20, def: 8, spd: 24, acc: 48, eva: 16, crt: 7 },
    growth: { hp: 10, atk: 2.7, def: 0.7, spd: 1.3 },
    abilities: ['hex', 'strike'],
    ring: 3,
    spawn: { weight: 7, minFloor: 3 },
    threats: ['reach', 'drain'],
    behaviour: 'walk',
    flavour: 'A hag mutters a word over whatever she means to keep, and after it moves as if the bog had its ankles.',
    art: 'marsh_hag'
  },
  {
    // The flying burner of floor 3: over the walls, never through your pieces, and its breath leaves Burning on a crowd.
    id: 'ash_wyvern',
    name: 'Ash Wyvern',
    kin: 'drake',
    role: 'ranger',
    tier: 3,
    base: { hp: 100, atk: 22, def: 9, spd: 26, acc: 50, eva: 18, crt: 10 },
    growth: { hp: 11, atk: 3, def: 0.8, spd: 1.4 },
    abilities: ['cinder_breath', 'strike'],
    ring: 2,
    flies: true,
    spawn: { weight: 7, minFloor: 3 },
    threats: ['fly', 'burn'],
    behaviour: 'fly',
    flavour: 'An ash wyvern is seen first as a shadow on the ground, and the ground its breath falls on goes on smouldering.',
    art: 'ash_wyvern'
  },
  {
    // A fused kind (DESIGN §2.6): Tomb Knight ×2 + Bone Chanter. A 2×2 wall whose sweep strikes every foe in its
    // ring, and whose aura shelters allies within 2.
    id: 'bone_colossus',
    name: 'Bone Colossus',
    kin: 'undead',
    role: 'vanguard',
    tier: 4,
    fused: true,
    size: 2,
    base: { hp: 1050, atk: 68, def: 28, spd: 12, acc: 48, eva: 2, crt: 4 },
    growth: { hp: 101, atk: 8.5, def: 2.4, spd: 0.5 },
    abilities: ['colossal_sweep', 'strike'],
    ring: 1,
    aura: { range: 2, desc: 'Allies within 2 tiles take 15% less damage.', mods: [{ path: 'damage.taken', op: 'mul', v: 0.85 }] },
    flavour: 'Two knights and the singer who bound them, standing as one: a wall that remembers how to fight.',
    art: 'bone_colossus'
  },
  {
    // A fused kind: Ember Drake + Frost Sprite ×2. Fire that freezes: its blast burns a crowd and slows it, from
    // four tiles off.
    id: 'rime_drake',
    name: 'Rime Drake',
    kin: 'drake',
    role: 'ranger',
    tier: 4,
    fused: true,
    base: { hp: 575, atk: 82, def: 13, spd: 26, acc: 52, eva: 14, crt: 12 },
    growth: { hp: 60, atk: 10.8, def: 1.2, spd: 1.4 },
    abilities: ['rimefire', 'frost_lance'],
    ring: 4,
    flavour: 'A drake and the two sprites that rode it, breathing as one: the fire comes out cold, and the frost burns.',
    art: 'rime_drake'
  },
  {
    // A fused kind: Hive Warden ×2 + Mantis Reaper. A 2×2 mender with a reaper's arms: its jelly mends every ally
    // within 2, and its scythe falls on whatever comes next to it.
    id: 'hive_queen',
    name: 'Hive Queen',
    kin: 'insect',
    role: 'warden',
    tier: 4,
    fused: true,
    size: 2,
    base: { hp: 975, atk: 69, def: 20, spd: 18, acc: 48, eva: 8, crt: 10 },
    growth: { hp: 98, atk: 8.8, def: 1.8, spd: 0.9 },
    abilities: ['royal_jelly', 'royal_scythe', 'strike'],
    ring: 1,
    flavour: 'Two wardens and the reaper they kept, crowned: the comb is wherever she stands, and so is the harvest.',
    art: 'hive_queen'
  },
  {
    // A fused kind: Clockwork Page ×2 + Iron Golem. A 2×2 wall of gears: its slam shakes the gauge out of a crowd,
    // and its works quicken the allies beside it.
    id: 'clockwork_titan',
    name: 'Clockwork Titan',
    kin: 'construct',
    role: 'vanguard',
    tier: 4,
    fused: true,
    size: 2,
    base: { hp: 1125, atk: 60, def: 32, spd: 10, acc: 46, eva: 2, crt: 4 },
    growth: { hp: 109, atk: 7.1, def: 2.6, spd: 0.5 },
    abilities: ['piston_slam', 'strike'],
    ring: 1,
    aura: { range: 1, desc: 'Allies next to it get +10% gauge rate.', mods: [{ path: 'gauge.rate', op: 'mul', v: 1.1 }] },
    flavour: 'Two pages wound the golem tighter than its makers dared, and climbed inside to keep it ticking.',
    art: 'clockwork_titan'
  },
  {
    // A fused kind: Will-o'-Wisp ×3. Three witchfires crowned as one: a flame on a crowd, and pale fire that Hexes,
    // from four tiles off.
    id: 'pale_court',
    name: 'Pale Court',
    kin: 'fae',
    role: 'channeler',
    tier: 3,
    fused: true,
    base: { hp: 350, atk: 72, def: 6, spd: 32, acc: 50, eva: 28, crt: 8 },
    growth: { hp: 40, atk: 10, def: 0.5, spd: 1.8 },
    abilities: ['triune_flame', 'pale_fire'],
    ring: 4,
    flavour: 'Three wisps that led the lost into the same bog, and found one another there: now they hold court.',
    art: 'pale_court'
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
    ring: 1,
    phases: [{ at: 0.6, grant: 'enraged' }, { at: 0.25, grant: 'desperate' }],
    threats: ['shape', 'clock'],
    behaviour: 'walk',
    flavour: 'It does not fight alone: its court walks with it, and the dead of the field rise at its tide. Without it, they are dust.',
    art: 'hollow_sovereign'
  }
]

// ── abilities ────────────────────────────────────────────────────────────────────────────────

// Shapes: single, ally, self; row (everyone level with the target), column (its lane); blast (the
// target and everyone next to it; aimed as any blow is, battle.js pick); all, all_allies (within `range`);
// corpse (a fallen foe: Arise's).
// `when(s)` gets { self, allies, enemies, t } (living units; allies includes self, but a heal's lists only the allies
// it can mend: battle.js helps); `cond` says the same in words for tooltips. The AI banks gauge for the first ability whose `when` passes and that
// has a target in reach, so gates keep pricey ones reachable. Reach, from the caster's footprint: melee hits
// the tiles around (yours its own `range` where it has one, else its kind's arm, 2 for a long arm; a foe's melee only
// what blocks it, the Monarch beside it, and a piece beside it that struck it: battle.js closeIn) and never a flyer
// unless the caster flies too, `range` is in tiles, and ally abilities and `all` without a range reach the whole
// board. A blow never reaches past the caster's ring.
const hpPct = (u) => u.hp / u.maxHp
// The units of a list within r tiles of the caster (the view's `dist`): a tier IV's area condition reads
// only what its area reaches, so a soul never banks for a cast that would touch no one it was meant for.
const near = (s, list, r) => list.filter((u) => s.dist(u) <= r)

const ABILITY_LIST = [
  {
    // The Monarch's one cast, the Arise relic's: without a copy of it, it never casts. Its reach is Arise's
    // (battle.domain), its target a corpse (see battle.js): a fallen foe of tier up to Arise's (ariseTier), while it
    // has raises left a battle (ariseCap); the shadow rises on the free tile nearest the Monarch.
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
  // ── abilities a track grants ──
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
    effects: [{ op: 'damage', power: 32 }, { op: 'apply_status', status: 'burning', dur: 120 }]
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
    cond: 'while an ally within 2 tiles is below 60% HP',
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
    effects: [{ op: 'damage', power: 30 }, { op: 'gauge', amount: -40 }, { op: 'apply_status', status: 'hexed', dur: 140 }]
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
  // ── abilities a tier IV grants ──
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
    effects: [{ op: 'damage', power: 32 }, { op: 'apply_status', status: 'burning', dur: 120 }, { op: 'apply_status', status: 'withered', dur: 140, chance: 0.4 }]
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
    effects: [{ op: 'damage', power: 30 }, { op: 'gauge', amount: -1000 }, { op: 'apply_status', status: 'hexed', dur: 140 }]
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
    // No range: it reaches as far as the ring (the tier that teaches it widens that to the whole board), aimed as
    // any blow is (battle.js pick). Its condition keeps it from holding a foe: the Wyrm sees only as far as its
    // breath (unit.js holdOf).
    id: 'killing_cold',
    name: 'Killing Cold',
    castCost: 160,
    shape: 'single',
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    when: (s) => s.enemies.some((u) => hpPct(u) < 0.5),
    cond: 'once a foe is below half HP',
    effects: [{ op: 'damage', power: 40 }]
  },
  // ── the foes of the deeper floors, and the fused kinds ──
  {
    // Its Burning outlasts the hound.
    id: 'pyre_bite',
    name: 'Pyre Bite',
    castCost: 110,
    shape: 'single',
    melee: true,
    tint: '#ff7a33',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 26 }, { op: 'apply_status', status: 'burning', dur: 120 }]
  },
  {
    id: 'drone_sting',
    name: 'Sting',
    castCost: 100,
    shape: 'single',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 24 }]
  },
  {
    id: 'bile',
    name: 'Bile',
    castCost: 130,
    shape: 'single',
    melee: true,
    tint: '#9bc25a',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 24 }, { op: 'apply_status', status: 'withered', dur: 140, chance: 0.4 }]
  },
  {
    id: 'hex',
    name: 'Hex',
    castCost: 120,
    shape: 'single',
    range: 3,
    tint: '#9b6cd8',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 26 }, { op: 'apply_status', status: 'hexed', dur: 140 }]
  },
  {
    id: 'cinder_breath',
    name: 'Cinder Breath',
    castCost: 150,
    shape: 'blast',
    range: 2,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 22 }, { op: 'apply_status', status: 'burning', dur: 120 }]
  },
  {
    // Every foe within 1 of its footprint.
    id: 'colossal_sweep',
    name: 'Colossal Sweep',
    castCost: 160,
    shape: 'all',
    range: 1,
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 26 }]
  },
  {
    id: 'rimefire',
    name: 'Rimefire',
    castCost: 160,
    shape: 'blast',
    range: 4,
    tint: '#9ad8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 26 }, { op: 'gauge', amount: -20 }, { op: 'apply_status', status: 'burning', dur: 120 }]
  },
  {
    id: 'royal_jelly',
    name: 'Royal Jelly',
    castCost: 150,
    shape: 'all_allies',
    range: 2,
    tint: '#ffe9a8',
    anim: 'cast_beam',
    when: (s) => near(s, s.allies, 2).some((u) => hpPct(u) < 0.6),
    cond: 'while an ally within 2 tiles is below 60% HP',
    effects: [{ op: 'heal', power: 20 }, { op: 'apply_status', status: 'regen', dur: 200, chance: 0.5 }]
  },
  {
    id: 'royal_scythe',
    name: 'Royal Scythe',
    castCost: 140,
    shape: 'single',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 44 }, { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.3 }]
  },
  {
    id: 'piston_slam',
    name: 'Piston Slam',
    castCost: 170,
    shape: 'blast',
    melee: true,
    tint: '#b57bff',
    anim: 'melee_lunge',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 24 }, { op: 'gauge', amount: -35 }]
  },
  {
    id: 'triune_flame',
    name: 'Triune Flame',
    castCost: 150,
    shape: 'blast',
    range: 4,
    tint: '#b57bff',
    anim: 'cast_beam',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 24 }]
  },
  {
    id: 'pale_fire',
    name: 'Pale Fire',
    castCost: 120,
    shape: 'single',
    range: 4,
    tint: '#cfe3ff',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'hexed', dur: 120, chance: 0.5 }]
  },
  // ── abilities their tracks grant ──
  {
    id: 'cinder_fang',
    name: 'Cinder Fang',
    castCost: 120,
    shape: 'single',
    melee: true,
    tint: '#ff7a33',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 34 }, { op: 'apply_status', status: 'burning', dur: 200 }]
  },
  {
    id: 'hellmaw',
    name: 'Hellmaw',
    castCost: 150,
    shape: 'blast',
    melee: true,
    tint: '#ff7a33',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'burning', dur: 200 }]
  },
  {
    id: 'cinder_spit',
    name: 'Cinder Spit',
    castCost: 120,
    shape: 'single',
    range: 3,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 26 }, { op: 'apply_status', status: 'burning', dur: 120 }]
  },
  {
    id: 'venom_sting',
    name: 'Venom Sting',
    castCost: 110,
    shape: 'single',
    melee: true,
    tint: '#9bc25a',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'withered', dur: 140, chance: 0.5 }]
  },
  {
    id: 'hexing_sting',
    name: 'Hexing Sting',
    castCost: 120,
    shape: 'single',
    melee: true,
    tint: '#9b6cd8',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'withered', dur: 140, chance: 0.5 }, { op: 'apply_status', status: 'hexed', dur: 140 }]
  },
  {
    id: 'swarm_cloud',
    name: 'Swarm Cloud',
    castCost: 150,
    shape: 'blast',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 22 }]
  },
  {
    id: 'spew',
    name: 'Spew',
    castCost: 140,
    shape: 'blast',
    melee: true,
    tint: '#9bc25a',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 22 }, { op: 'apply_status', status: 'withered', dur: 140, chance: 0.5 }]
  },
  {
    id: 'miasma',
    name: 'Miasma',
    castCost: 190,
    shape: 'all',
    range: 2,
    tint: '#9bc25a',
    anim: 'cast_beam',
    when: (s) => near(s, s.enemies, 2).length >= 2,
    cond: 'while 2+ foes stand within 2 tiles',
    effects: [{ op: 'damage', power: 12 }, { op: 'apply_status', status: 'withered', dur: 140 }, { op: 'apply_status', status: 'hexed', dur: 140 }]
  },
  {
    id: 'bog_curse',
    name: 'Bog Curse',
    castCost: 130,
    shape: 'single',
    range: 3,
    tint: '#9b6cd8',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'hexed', dur: 140 }, { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.5 }]
  },
  {
    id: 'mire',
    name: 'Mire',
    castCost: 200,
    shape: 'all',
    range: 3,
    tint: '#9b6cd8',
    anim: 'cast_beam',
    when: (s) => near(s, s.enemies, 3).length >= 2,
    cond: 'while 2+ foes stand within 3 tiles',
    effects: [{ op: 'damage', power: 12 }, { op: 'apply_status', status: 'hexed', dur: 140 }]
  },
  {
    id: 'long_curse',
    name: 'Long Curse',
    castCost: 130,
    shape: 'single',
    range: 5,
    tint: '#9b6cd8',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 28 }, { op: 'apply_status', status: 'hexed', dur: 140 }]
  },
  {
    id: 'ashfall',
    name: 'Ashfall',
    castCost: 160,
    shape: 'blast',
    range: 3,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 26 }, { op: 'apply_status', status: 'burning', dur: 120 }]
  },
  {
    id: 'pyre_rain',
    name: 'Pyre Rain',
    castCost: 200,
    shape: 'all',
    range: 3,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    when: (s) => near(s, s.enemies, 3).length >= 2,
    cond: 'while 2+ foes stand within 3 tiles',
    effects: [{ op: 'damage', power: 16 }, { op: 'apply_status', status: 'burning', dur: 160 }]
  },
  {
    id: 'ember_lance',
    name: 'Ember Lance',
    castCost: 130,
    shape: 'single',
    range: 4,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 34 }, { op: 'apply_status', status: 'burning', dur: 120 }]
  },
  {
    id: 'bone_quake',
    name: 'Bone Quake',
    castCost: 170,
    shape: 'all',
    range: 1,
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 26 }, { op: 'gauge', amount: -30 }]
  },
  {
    // No crowd condition (it was 2+ foes within 2, until the second balance pass): the tier that teaches it grows the
    // ring to 2, and a ring then held a ranged foe by any blow, so a lone one there had to be one it strikes. (A piece
    // now sees only as far as its blows that need no condition reach: unit.js holdOf.)
    id: 'grave_breaker',
    name: 'Grave Breaker',
    castCost: 190,
    shape: 'all',
    range: 2,
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 26 }, { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.6 }]
  },
  {
    id: 'rimestorm',
    name: 'Rimestorm',
    castCost: 170,
    shape: 'blast',
    range: 5,
    tint: '#9ad8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 28 }, { op: 'gauge', amount: -20 }, { op: 'apply_status', status: 'burning', dur: 120 }]
  },
  {
    // No crowd condition (it was 3+ foes within 5, until the second balance pass), as Grave Breaker: its ring is 5 and
    // its other blow reaches 3, so a lone shooter halted 4–5 tiles off stood shooting, unanswered, to the tick ceiling,
    // while a ring held a foe by any blow (unit.js holdOf).
    id: 'equinox',
    name: 'Equinox',
    castCost: 220,
    shape: 'all',
    range: 5,
    tint: '#9ad8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 16 }, { op: 'gauge', amount: -30 }, { op: 'apply_status', status: 'burning', dur: 120 }]
  },
  {
    id: 'kindled_lance',
    name: 'Kindled Lance',
    castCost: 130,
    shape: 'single',
    range: 3,
    tint: '#9ad8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 38 }, { op: 'gauge', amount: -30 }, { op: 'apply_status', status: 'burning', dur: 120 }]
  },
  {
    id: 'hive_mind',
    name: 'Hive Mind',
    castCost: 180,
    shape: 'all_allies',
    range: 3,
    tint: '#ffe9a8',
    anim: 'cast_beam',
    when: (s) => near(s, s.allies, 3).some((u) => hpPct(u) < 0.6),
    cond: 'while an ally within 3 tiles is below 60% HP',
    effects: [{ op: 'heal', power: 22 }, { op: 'cleanse', tag: 'debuff', count: 1 }]
  },
  {
    id: 'swarm_scythe',
    name: 'Swarm Scythe',
    castCost: 150,
    shape: 'blast',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 34 }]
  },
  {
    // A long arm of its own (its `range`, past the kind's arm of 1): it reaches 2 tiles from her footprint, and still no
    // flyer.
    id: 'reaping_swarm',
    name: 'Reaping Swarm',
    castCost: 160,
    shape: 'blast',
    range: 2,
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 34 }, { op: 'apply_status', status: 'brittle', dur: 120, chance: 0.3 }]
  },
  {
    id: 'steam_hammer',
    name: 'Steam Hammer',
    castCost: 180,
    shape: 'blast',
    melee: true,
    tint: '#b57bff',
    anim: 'melee_lunge',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 30 }, { op: 'gauge', amount: -40 }]
  },
  {
    id: 'gear_lock',
    name: 'Gear Lock',
    castCost: 200,
    shape: 'all',
    range: 1,
    melee: true,
    tint: '#b57bff',
    anim: 'melee_lunge',
    when: (s) => near(s, s.enemies, 1).length >= 2,
    cond: 'while 2+ foes stand next to it',
    effects: [{ op: 'damage', power: 10 }, { op: 'gauge', amount: -1000 }]
  },
  {
    id: 'pale_pyre',
    name: 'Pale Pyre',
    castCost: 160,
    shape: 'blast',
    range: 4,
    tint: '#b57bff',
    anim: 'cast_beam',
    when: (s) => s.enemies.length >= 2,
    cond: 'while 2+ foes stand',
    effects: [{ op: 'damage', power: 24 }, { op: 'apply_status', status: 'burning', dur: 120 }]
  },
  {
    id: 'danse_macabre',
    name: 'Danse Macabre',
    castCost: 220,
    shape: 'all',
    range: 4,
    tint: '#b57bff',
    anim: 'cast_beam',
    when: (s) => near(s, s.enemies, 4).length >= 3,
    cond: 'while 3+ foes stand within 4 tiles',
    effects: [{ op: 'damage', power: 16 }, { op: 'apply_status', status: 'burning', dur: 120 }]
  },
  {
    id: 'court_summons',
    name: 'Court Summons',
    castCost: 130,
    shape: 'single',
    range: 6,
    tint: '#cfe3ff',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 32 }, { op: 'apply_status', status: 'hexed', dur: 140 }]
  }
]

// ── upgrade tracks ───────────────────────────────────────────────────────────────────────────

// Each kind of soul has two tracks of four tiers (DESIGN §2.6), bought with essence for the kind
// (TUNING.essence.tier, × the floor's price scale: run.js floorPrice): every soul of the kind holds them (run.js s.kinds). The crosspath rule, as Bloons TD
// 6's: one track may pass tier II, and the other then stops at II (unit.js canTrack). A tier can carry `mods`
// (always on, like a relic's, for the souls of the kind alone), `ability` ({ id, replace } swaps one of its
// abilities; { id, at } adds one at that place in its priority list, first by default), `aura` (replaces its
// aura), `count` (bodies more in its piece each battle, whole, gone when it ends: unit.js bodiesOf), `ring`
// (tiles more: a tier whose blow reaches past the ring raises the ring with it, so the card never lies) and `size`
// (2: Colossus, every piece of the kind grows to 2×2, and one that no longer fits where it stands goes to the
// ossuary; unit.js sizeOf). Tier IV is a rule, never a percentage: a new or remade ability, an aura, a wider ring,
// or Colossus. No tier I–II of one track remakes an ability or grants an aura, so the other track's tiers III–IV
// never undo it.
const m = (path, op, v, pos) => (pos ? { path, op, v, pos } : { path, op, v })
export const TRACKS = {
  bone_chanter: [
    { id: 'dirgemaster', name: 'Dirgemaster', desc: 'Quickens the whole line.', tiers: [
      { desc: '+15% gauge rate.', mods: [m('gauge.rate', 'mul', 1.15)] },
      { desc: '+20% damage dealt.', mods: [m('damage.dealt', 'mul', 1.2)] },
      { desc: 'Dirge becomes Requiem: Hasten for 7 s to every ally within 3 tiles, in the first 10 s.', ability: { id: 'requiem', replace: 'dirge' } },
      { desc: 'Requiem becomes Dirge Unending: Hasten to every ally within 3 tiles whenever one lacks it, all battle long.', ability: { id: 'dirge_unending', replace: 'requiem' } }] },
    { id: 'marrowcaller', name: 'Marrowcaller', desc: 'Bones that rise, bolts that pierce a lane.', tiers: [
      { desc: '+12% ATK.', mods: [m('atk', 'mul', 1.12)] },
      { desc: 'Bones rise to its call: +6 bodies in every battle.', count: 6 },
      { desc: 'Marrow Bolt becomes Marrow Spear: hits a foe and everyone in its lane.', ability: { id: 'marrow_spear', replace: 'marrow_bolt' } },
      { desc: 'Learns Bone Storm: shards strike every foe within 4 tiles, while 3+ foes stand there.', ability: { id: 'bone_storm' } }] }
  ],
  tomb_knight: [
    { id: 'bulwark', name: 'Bulwark', desc: 'A wall the others shelter behind.', tiers: [
      { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: 'Its aura reaches allies within 2 tiles.', aura: { range: 2, desc: 'Allies within 2 tiles take 15% less damage.', mods: [m('damage.taken', 'mul', 0.85)] } },
      { desc: 'Barrow Wall (Colossus): every piece of the kind grows to 2×2, its ring and aura reaching from all four tiles.', size: 2 }] },
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
      { desc: 'Ember Burst becomes Inferno: 32 power to a foe and everyone next to it, and leaves them Burning.', ability: { id: 'inferno', replace: 'ember_burst' } },
      { desc: 'Inferno becomes Cataclysm: reaches 5 tiles, and leaves the burnt Withered as well. Its ring grows to 5.', ability: { id: 'cataclysm', replace: 'inferno' }, ring: 1 }] },
    { id: 'skyhunter', name: 'Skyhunter', desc: 'Picks off whoever strays.', tiers: [
      { desc: '+12 ACC, +10% gauge rate.', mods: [m('acc', 'add', 12), m('gauge.rate', 'mul', 1.1)] },
      { desc: '+20% damage dealt with no foe next to it.', mods: [m('damage.dealt', 'mul', 1.2, 'free')] },
      { desc: 'Learns Searing Bolt: 34 power at range 5, past Ember Burst\'s reach. Its ring grows to 5.', ability: { id: 'searing_bolt', at: 1 }, ring: 1 },
      { desc: 'Searing Bolt becomes Skyfall: it reaches any foe on the board, and so does its ring.', ability: { id: 'skyfall', replace: 'searing_bolt' }, ring: 5 }] }
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
    { id: 'brood_mother', name: 'Brood Mother', desc: 'Hatches a swarm, and mends it.', tiers: [
      { desc: '+25% healing given.', mods: [m('heal.given', 'mul', 1.25)] },
      { desc: 'Its brood hatches with it: +6 bodies in every battle.', count: 6 },
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
      { desc: 'Strike becomes Spanner in the Works: 30 power, drains 40 gauge, and leaves it Hexed.', ability: { id: 'spanner', replace: 'strike' } },
      { desc: "Spanner becomes Wrench the Works: it empties a foe's gauge, and leaves it Hexed.", ability: { id: 'wrench', replace: 'spanner' } }] },
    { id: 'gearwright', name: 'Gearwright', desc: 'Winds up soldiers, and keeps them ticking.', tiers: [
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: 'Winds up six spares: +6 bodies in every battle.', count: 6 },
      { desc: 'Purge becomes Overclock: Hasten and one debuff removed, on the most wounded ally.', ability: { id: 'overclock', replace: 'purge' } },
      { desc: 'Overclock becomes Perpetual Motion: Hasten and a debuff removed for every ally within 2 tiles.', ability: { id: 'perpetual_motion', replace: 'overclock' } }] }
  ],
  grave_ghoul: [
    { id: 'pack_leader', name: 'Pack Leader', desc: 'The pack runs at its heel.', tiers: [
      { desc: '+15% DEF.', mods: [m('def', 'mul', 1.15)] },
      { desc: '+10% gauge rate.', mods: [m('gauge.rate', 'mul', 1.1)] },
      { desc: 'Gains an aura: allies next to it deal 10% more damage.', aura: { range: 1, desc: 'Allies next to it deal 10% more damage.', mods: [m('damage.dealt', 'mul', 1.1)] } },
      { desc: 'Charnel Brute (Colossus): every piece of the kind grows to 2×2, its ring and aura reaching from all four tiles.', size: 2 }] },
    { id: 'glutton', name: 'Glutton', desc: 'Eats to stay standing.', tiers: [
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: 'Takes 8% less damage.', mods: [m('damage.taken', 'mul', 0.92)] },
      { desc: 'Gnaw becomes Devour: 34 power, and it heals itself.', ability: { id: 'devour', replace: 'gnaw' } },
      { desc: 'Devour becomes Gorge: it bites a foe and every foe next to it, and heals itself once.', ability: { id: 'gorge', replace: 'devour' } }] }
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
    { id: 'heartwood', name: 'Heartwood', desc: "Deep-rooted healing, and the grove's lights.", tiers: [
      { desc: '+25% healing given.', mods: [m('heal.given', 'mul', 1.25)] },
      { desc: 'Wakes six saplings of its grove: +6 bodies in every battle.', count: 6 },
      { desc: 'Mend becomes Bloom: 34 power and Regen every time.', ability: { id: 'bloom', replace: 'mend' } },
      { desc: 'Bloom becomes Verdant Bloom: it heals every ally within 2 tiles, with Regen.', ability: { id: 'verdant_bloom', replace: 'bloom' } }] },
    { id: 'bramble', name: 'Bramble', desc: 'A healer with thorns.', tiers: [
      { desc: '+15% DEF.', mods: [m('def', 'mul', 1.15)] },
      { desc: '+12% ATK.', mods: [m('atk', 'mul', 1.12)] },
      { desc: 'Learns Thorn Lash: damage to a foe and everyone level with it.', ability: { id: 'thorn_lash' } },
      { desc: 'Thorn Lash becomes Briar Lash: it reaches 2 tiles, and leaves everyone level with its target Brittle. Its ring grows to 2.', ability: { id: 'briar_lash', replace: 'thorn_lash' }, ring: 1 }] }
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
      { desc: 'Learns Phantom Edge: it strikes from up to 3 tiles away, a tile past its scythes\' 2, when no foe is within those. Its ring grows to 3.', ability: { id: 'phantom_edge', at: 1 }, ring: 1 }] }
  ],
  iron_golem: [
    { id: 'juggernaut', name: 'Juggernaut', desc: 'An iron wall that shelters others.', tiers: [
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
      { desc: 'Gains an aura: allies next to it take 10% less damage.', aura: { range: 1, desc: 'Allies next to it take 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] } },
      { desc: 'Iron Bastion (Colossus): every piece of the kind grows to 2×2, its ring and aura reaching from all four tiles.', size: 2 }] },
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
    { id: 'ancient', name: 'Ancient', desc: 'Older, colder, and never alone.', tiers: [
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: 'Whelps of its brood: +6 bodies in every battle.', count: 6 },
      { desc: 'Glacial Breath becomes Blizzard: freezes a foe and everyone level with it.', ability: { id: 'blizzard', replace: 'glacial_breath' } },
      { desc: 'Blizzard becomes Ice Age: it freezes every foe within 3 tiles.', ability: { id: 'ice_age', replace: 'blizzard' } }] },
    { id: 'rime_tyrant', name: 'Rime Tyrant', desc: 'Pure killing cold.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+10% gauge rate.', mods: [m('gauge.rate', 'mul', 1.1)] },
      { desc: '+20% damage dealt, +10 CRT.', mods: [m('damage.dealt', 'mul', 1.2), m('crt', 'add', 10)] },
      { desc: 'Learns Killing Cold: 40 power to a foe anywhere on the board, once one is below half HP; its ring covers the board.', ability: { id: 'killing_cold' }, ring: 7 }] }
  ],
  pyre_hound: [
    { id: 'cinder', name: 'Cinder', desc: 'A hotter bite, and a longer burn.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+10 CRT.', mods: [m('crt', 'add', 10)] },
      { desc: 'Pyre Bite becomes Cinder Fang: 34 power, and its Burning lasts 10 s.', ability: { id: 'cinder_fang', replace: 'pyre_bite' } },
      { desc: 'Cinder Fang becomes Hellmaw: it bites a foe and every foe next to it, and leaves them all Burning.', ability: { id: 'hellmaw', replace: 'cinder_fang' } }] },
    { id: 'firebrand', name: 'Firebrand', desc: 'The pack runs hot about it.', tiers: [
      { desc: '+15% max HP.', mods: [m('hp', 'mul', 1.15)] },
      { desc: '+10% gauge rate.', mods: [m('gauge.rate', 'mul', 1.1)] },
      { desc: 'Gains an aura: allies next to it get +8 CRT.', aura: { range: 1, desc: 'Allies next to it get +8 CRT.', mods: [m('crt', 'add', 8)] } },
      { desc: 'Learns Cinder Spit: 26 power and Burning at range 3. Its ring grows to 3.', ability: { id: 'cinder_spit', at: 1 }, ring: 2 }] }
  ],
  hive_drone: [
    { id: 'venom', name: 'Venom', desc: 'A worse sting.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+10 CRT.', mods: [m('crt', 'add', 10)] },
      { desc: 'Sting becomes Venom Sting: 30 power, 50% chance of Withered.', ability: { id: 'venom_sting', replace: 'drone_sting' } },
      { desc: 'Venom Sting becomes Hexing Sting: it leaves its target Hexed too.', ability: { id: 'hexing_sting', replace: 'venom_sting' } }] },
    { id: 'hum', name: 'Hum of the Hive', desc: 'The swarm keeps time with it.', tiers: [
      { desc: '+8 EVA.', mods: [m('eva', 'add', 8)] },
      { desc: '+15% max HP.', mods: [m('hp', 'mul', 1.15)] },
      { desc: 'Gains an aura: allies next to it get +10% gauge rate.', aura: { range: 1, desc: 'Allies next to it get +10% gauge rate.', mods: [m('gauge.rate', 'mul', 1.1)] } },
      { desc: 'Learns Swarm Cloud: it stings a foe and every foe next to it, while 2+ foes stand.', ability: { id: 'swarm_cloud' } }] }
  ],
  rot_bloat: [
    { id: 'swollen', name: 'Swollen', desc: 'Harder to open.', tiers: [
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
      { desc: 'Takes 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] },
      { desc: 'Bursting Hulk (Colossus): every piece of the kind swells to 2×2, its ring reaching from all four tiles.', size: 2 }] },
    { id: 'putrid', name: 'Putrid', desc: 'It rots what it touches.', tiers: [
      { desc: '+12% ATK.', mods: [m('atk', 'mul', 1.12)] },
      { desc: '+10% gauge rate.', mods: [m('gauge.rate', 'mul', 1.1)] },
      { desc: 'Bile becomes Spew: 22 power to a foe and everyone next to it, 50% chance of Withered.', ability: { id: 'spew', replace: 'bile' } },
      { desc: 'Learns Miasma: Withers and Hexes every foe within 2 tiles, while 2+ stand there. Its ring grows to 2.', ability: { id: 'miasma' }, ring: 1 }] }
  ],
  marsh_hag: [
    { id: 'crone', name: 'Crone', desc: 'Deeper curses.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+15 ACC.', mods: [m('acc', 'add', 15)] },
      { desc: 'Hex becomes Bog Curse: 30 power, Hexed, and 50% chance of Brittle.', ability: { id: 'bog_curse', replace: 'hex' } },
      { desc: 'Learns Mire: Hexes every foe within 3 tiles, while 2+ stand there.', ability: { id: 'mire' } }] },
    { id: 'charmwife', name: 'Charmwife', desc: 'Charms for her own, and a longer reach.', tiers: [
      { desc: '+15% max HP.', mods: [m('hp', 'mul', 1.15)] },
      { desc: '+8 EVA.', mods: [m('eva', 'add', 8)] },
      { desc: 'Gains an aura: allies within 2 tiles get +6 EVA.', aura: { range: 2, desc: 'Allies within 2 tiles get +6 EVA.', mods: [m('eva', 'add', 6)] } },
      { desc: 'Hex becomes Long Curse: it reaches 5 tiles. Its ring grows to 5.', ability: { id: 'long_curse', replace: 'hex' }, ring: 2 }] }
  ],
  ash_wyvern: [
    { id: 'ashstorm', name: 'Ashstorm', desc: 'Wider fires.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+10 CRT.', mods: [m('crt', 'add', 10)] },
      { desc: 'Cinder Breath becomes Ashfall: it reaches 3 tiles. Its ring grows to 3.', ability: { id: 'ashfall', replace: 'cinder_breath' }, ring: 1 },
      { desc: 'Ashfall becomes Pyre Rain: Burning on every foe within 3 tiles, while 2+ stand there.', ability: { id: 'pyre_rain', replace: 'ashfall' } }] },
    { id: 'skyrend', name: 'Skyrend', desc: 'Strikes from high and far.', tiers: [
      { desc: '+8 EVA.', mods: [m('eva', 'add', 8)] },
      { desc: '+10% gauge rate.', mods: [m('gauge.rate', 'mul', 1.1)] },
      { desc: '+20% damage dealt with no foe next to it.', mods: [m('damage.dealt', 'mul', 1.2, 'free')] },
      { desc: 'Learns Ember Lance: 34 power and Burning at range 4. Its ring grows to 4.', ability: { id: 'ember_lance', at: 1 }, ring: 2 }] }
  ],
  bone_colossus: [
    { id: 'rampart', name: 'Rampart', desc: 'A thicker wall, a wider shelter.', tiers: [
      { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: 'Takes 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] },
      { desc: 'Its aura reaches allies within 3 tiles.', aura: { range: 3, desc: 'Allies within 3 tiles take 15% less damage.', mods: [m('damage.taken', 'mul', 0.85)] } }] },
    { id: 'wrecker', name: 'Wrecker', desc: 'A heavier sweep.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+10 CRT.', mods: [m('crt', 'add', 10)] },
      { desc: 'Colossal Sweep becomes Bone Quake: every foe within 1 tile, draining 30 gauge.', ability: { id: 'bone_quake', replace: 'colossal_sweep' } },
      { desc: 'Bone Quake becomes Grave Breaker: every foe within 2 tiles, left Brittle. Its ring grows to 2.', ability: { id: 'grave_breaker', replace: 'bone_quake' }, ring: 1 }] }
  ],
  rime_drake: [
    { id: 'frostfire', name: 'Frostfire', desc: 'A wider storm.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+10 CRT.', mods: [m('crt', 'add', 10)] },
      { desc: 'Rimefire becomes Rimestorm: it reaches 5 tiles. Its ring grows to 5.', ability: { id: 'rimestorm', replace: 'rimefire' }, ring: 1 },
      { desc: 'Rimestorm becomes Equinox: it burns and slows every foe within 5 tiles.', ability: { id: 'equinox', replace: 'rimestorm' } }] },
    { id: 'glacier_heart', name: 'Glacier Heart', desc: 'A colder heart, a hotter lance.', tiers: [
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: '+10% gauge rate.', mods: [m('gauge.rate', 'mul', 1.1)] },
      { desc: '+20% damage dealt with no foe next to it.', mods: [m('damage.dealt', 'mul', 1.2, 'free')] },
      { desc: 'Frost Lance becomes Kindled Lance: 38 power, drains 30 gauge, and leaves Burning.', ability: { id: 'kindled_lance', replace: 'frost_lance' } }] }
  ],
  hive_queen: [
    { id: 'matriarch', name: 'Matriarch', desc: 'The comb is wherever she stands.', tiers: [
      { desc: '+25% healing given.', mods: [m('heal.given', 'mul', 1.25)] },
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: 'Gains an aura: allies within 2 tiles take 10% less damage.', aura: { range: 2, desc: 'Allies within 2 tiles take 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] } },
      { desc: 'Royal Jelly becomes Hive Mind: it heals every ally within 3 tiles and strips a debuff from each.', ability: { id: 'hive_mind', replace: 'royal_jelly' } }] },
    { id: 'swarmblade', name: 'Swarmblade', desc: "A reaper's arms, and longer.", tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+10 CRT.', mods: [m('crt', 'add', 10)] },
      { desc: 'Royal Scythe becomes Swarm Scythe: 34 power to a foe and every foe next to it.', ability: { id: 'swarm_scythe', replace: 'royal_scythe' } },
      { desc: 'Swarm Scythe becomes Reaping Swarm: it reaches 2 tiles, 30% chance of Brittle. Its ring grows to 2.', ability: { id: 'reaping_swarm', replace: 'swarm_scythe' }, ring: 1 }] }
  ],
  clockwork_titan: [
    { id: 'bastion', name: 'Bastion', desc: 'A wall that locks the works of all about it.', tiers: [
      { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: 'Takes 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] },
      { desc: 'Learns Gear Lock: it empties the gauge of every foe next to it, while 2+ stand there.', ability: { id: 'gear_lock' } }] },
    { id: 'overdrive', name: 'Overdrive', desc: 'Faster works, and those beside it keep time.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+10% gauge rate.', mods: [m('gauge.rate', 'mul', 1.1)] },
      { desc: 'Piston Slam becomes Steam Hammer: 30 power, drains 40 gauge.', ability: { id: 'steam_hammer', replace: 'piston_slam' } },
      { desc: 'Its aura reaches allies within 2 tiles, and quickens them more: +15% gauge rate.', aura: { range: 2, desc: 'Allies within 2 tiles get +15% gauge rate.', mods: [m('gauge.rate', 'mul', 1.15)] } }] }
  ],
  pale_court: [
    { id: 'ghostlight', name: 'Ghostlight', desc: 'Its flames catch.', tiers: [
      { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
      { desc: '+15 ACC.', mods: [m('acc', 'add', 15)] },
      { desc: 'Triune Flame becomes Pale Pyre: it leaves its targets Burning.', ability: { id: 'pale_pyre', replace: 'triune_flame' } },
      { desc: 'Pale Pyre becomes Danse Macabre: Burning on every foe within 4 tiles, while 3+ stand there.', ability: { id: 'danse_macabre', replace: 'pale_pyre' } }] },
    { id: 'masque', name: 'Masque', desc: 'A court of veils, and a long summons.', tiers: [
      { desc: '+8 EVA.', mods: [m('eva', 'add', 8)] },
      { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
      { desc: 'Gains an aura: allies within 2 tiles get +8 EVA.', aura: { range: 2, desc: 'Allies within 2 tiles get +8 EVA.', mods: [m('eva', 'add', 8)] } },
      { desc: 'Pale Fire becomes Court Summons: it reaches 6 tiles, and always Hexes. Its ring grows to 6.', ability: { id: 'court_summons', replace: 'pale_fire' }, ring: 2 }] }
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
    // A damage-over-time (DESIGN §2.4): each tick interval it deals `power` true damage per stack (battle.js 'dot':
    // never missing, no DEF, no crit), up to 3 stacks.
    id: 'burning',
    desc: 'Takes 6 true damage a second per stack, up to 3 stacks.',
    name: 'Burning',
    tags: ['debuff'],
    dur: 120,
    stacks: 3,
    mods: [],
    tick: [{ op: 'dot', power: 6 }],
    tickEvery: 20
  },
  {
    id: 'hexed',
    desc: '−30% gauge rate: acts less often.',
    name: 'Hexed',
    tags: ['debuff'],
    dur: 140,
    stacks: 1,
    mods: [{ path: 'gauge.rate', op: 'mul', v: 0.7 }]
  },
  {
    // A relic's gift (Tower Shield: your side about the Monarch, as the battle begins and as each later wave enters).
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

// A `hidden` role (the Monarch's) counts toward no synergy.
const ROLE_LIST = [
  { id: 'vanguard', name: 'Vanguard' },
  { id: 'skirmisher', name: 'Skirmisher' },
  { id: 'ranger', name: 'Ranger' },
  { id: 'channeler', name: 'Channeler' },
  { id: 'warden', name: 'Warden' },
  { id: 'trickster', name: 'Trickster' },
  { id: 'monarch', name: 'Monarch', hidden: true }
]

// How a foe comes to the Monarch (DESIGN §2.4), by its kind's `behaviour`: two ways, Walk for every ground kind (the
// one drawn road, the Walk field) and Fly for the flyers (the air road, battle.js airOf). One step a
// TUNING.board.stepTicks ÷ its stride, doing nothing else, until it halts where it can hit back (battle.js wayOf);
// only then does it fight. Which kinds fly is learnt by meeting them; the text only says what each way does. `desc`
// is the way; `melee`, what a foe's melee strikes on it (battle.js closeIn), told on a kind's card only where the
// kind has a melee blow (codex.js ringRule), and in the glossary after the way.
export const BEHAVIOURS = {
  walk: { name: 'Walk', desc: 'Walks the arrows to the Monarch, doing nothing else, until it can strike something of yours from inside one of your rings, or something stands in its way; there it halts and fights.', melee: 'Its melee reaches only what blocks it, the Monarch beside it, or a piece beside it that struck it.' },
  // A flyer flies the air road (battle.js airOf): no wall stops it, but a piece of yours in its way does, and it never
  // goes round. Only a ranged blow, or a flyer's melee, can touch it, so only a ranged ring, a flyer's or the
  // Monarch's may halt it in your rings, and only where it can strike back.
  fly: { name: 'Fly', desc: 'Flies straight at the Monarch over the walls, and may hover over one, but never through your pieces: one of yours in its way, on the ground or in the air, holds it there, and it never goes round. Only a ranged blow, or a flyer\'s melee, can strike it, so in your rings only a ranged ring, a flyer\'s or the Monarch\'s may halt it, and only where its own blows reach something of yours.', melee: 'Its melee reaches only what blocks it, the Monarch beside it, or a piece beside it that struck it.' }
}

// What a foe can do to a Monarch, by kind (UNIT_LIST `threats`). The scouted roles hint at them; what each
// does is learnt by fighting it.
export const THREATS = {
  reach: { name: 'Reach', desc: 'Strikes from afar, over whatever stands in front of it.' },
  shape: { name: 'Shape', desc: 'Hits a whole row, lane or crowd at once.' },
  drain: { name: 'Drain', desc: 'Saps gauge or rots defence.' },
  clock: { name: 'Clock', desc: 'Drags a fight on into escalation.' },
  fly: { name: 'Fly', desc: 'Comes over the walls, never through your pieces, and only a ranged blow (or a flyer\'s melee) can touch it.' },
  burn: { name: 'Burn', desc: 'Leaves a fire that keeps hurting after the blow.' },
  // A room's, not a kind's: more foes enter behind the first (a late pair, waves).
  depth: { name: 'Depth', desc: 'More foes arrive behind the first, from the far edge.' }
}

// ── synergies ────────────────────────────────────────────────────────────────────────────────

// Active while a side's living units meet every count in `needs` ({ kin: {…}, role: {…} }).
// A mod with `pos` only applies while the unit has a foe next to it ('engaged') or has none ('free').
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
  // The deep steps, 4 and 6, then 8: a kin or role five pieces deep (most are two or three) reaches them only
  // with shadows, which count like anyone else (a stack counts once, whatever its count). Steps stack: Undead 6 also has Undead 2 and 4.
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

// ── camps ────────────────────────────────────────────────────────────────────────────────────

// Where your souls stand and fight: a 7×7 camp, listed front row first (the foes come from above it).
// '#' is a wall: it blocks walking, not attacks or flight, and the walls are the foes' track: the roads run round
// them to the Monarch (battle.js field). 'M' is the Monarch's seat (DESIGN §2.1): it is pre-placed there and never
// moves, and no piece may stand on its cell. Each floor draws one of its camps when you arrive. From the seat a road
// reaches every tile of the foes' rows, and the seat cuts no cell off from the open ground ahead of the camp
// (test/battle.test.js checks). Each camp is a placement puzzle around its seat:
//   stones      the seat amid a ring of stones, open on every side: four doors to hold, and the rear is no refuge
//   palisade    a fence with two breaches two wide, the seat at the rear right: a near road, a long one, and a 2×2
//               plugs a breach alone
//   firepit     the seat with its back to the fire: the road forks round the pit and meets again at its feet
//   gates       a wall across the middle, the seat behind it between two narrow gates: the open ground before
//               the wall, the gates, or the seat's own flanks
//   ditch       a trench open at the far right, the seat at its left end: one long road along the inside, rings
//               over the trench reach it twice
//   barracks    the seat at the end of the middle alley between two halls: one straight file at it, two more
//               round behind it, and room for a 2×2 only at the rear
//   switchback  the road zig-zags the width of the camp twice to the seat in the rear corner: a ring can reach
//               two legs at once
//   crossroads  four blocks, the seat at the foot of the narrow street: the road jogs at the crossing, the wide
//               way round is longer
//   funnel      walls sloping in to one gap, the seat off to the side behind it: a single choke, and a killing
//               ground between the choke and the seat
//   labyrinth   two gates at the centre lead out to the edges and round to a niche at the rear: the seat faces
//               away from the foes, and every road ends behind it
//   keep        the seat inside a walled court whose one gate faces the foes: every road comes through the gate,
//               and the galleries outside its walls lie off every road
//   spiral      a wall across the front open at the right, then a coil: the longest road, wound round the seat at
//               its heart, with a 2×2 pocket beside it
export const CAMP_LIST = [
  { id: 'stones', name: 'Standing Stones', floor: 1, map: ['.......', '.......', '..#.#..', '#..M..#', '..#.#..', '.......', '.......'] },
  { id: 'palisade', name: 'Broken Palisade', floor: 1, map: ['.......', '#..#..#', '.......', '.......', '.......', '.......', '.....M.'] },
  { id: 'firepit', name: 'Firepit', floor: 1, map: ['.......', '.......', '..###..', '..###..', '...M...', '.......', '.......'] },
  { id: 'gates', name: 'Twin Gates', floor: 2, map: ['.......', '.......', '.......', '#.###.#', '.......', '...M...', '.......'] },
  { id: 'ditch', name: 'The Ditch', floor: 2, map: ['.......', '.......', '######.', 'M......', '.......', '.......', '.......'] },
  { id: 'barracks', name: 'Barracks', floor: 2, map: ['.......', '.##.##.', '.##.##.', '.##.##.', '.##M##.', '.......', '.......'] },
  { id: 'switchback', name: 'Switchback', floor: 3, map: ['.......', '.######', '.......', '.......', '######.', '.......', 'M......'] },
  { id: 'crossroads', name: 'Crossroads', floor: 3, map: ['.......', '##.##..', '##.##..', '.......', '..##.#.', '..##.#.', '....M..'] },
  { id: 'funnel', name: 'Funnel', floor: 3, map: ['.......', '#.....#', '##...##', '####.##', '.......', '.......', '.M.....'] },
  { id: 'labyrinth', name: 'Labyrinth', floor: 4, map: ['.......', '##.#.##', '.......', '..###..', '..###..', '..#M#..', '.......'] },
  { id: 'keep', name: 'The Keep', floor: 4, map: ['.......', '.......', '.##.##.', '.#...#.', '.#.M.#.', '.#...#.', '.#####.'] },
  { id: 'spiral', name: 'Spiral', floor: 4, map: ['.......', '.......', '######.', '.....#.', '.#M..#.', '.#####.', '.......'] }
]

// ── fusions ──────────────────────────────────────────────────────────────────────────────────

// A recipe (DESIGN §2.6): `needs` counts bodies per kind, consumed exactly from your pieces, fielded or in the
// ossuary (a bigger stack gives the bodies asked and keeps the rest, as a split would); `result` is the fused kind
// (a unit def with `fused: true`, never spawned, never recruited) that rises as one piece, count 1, full HP, in the
// ossuary. It costs TUNING.essence.fuse × the result's tier, × the floor's price scale (run.js floorPrice). Recipes are public: the Codex lists every one from the
// start.
export const FUSION_LIST = [
  { id: 'bone_colossus', name: 'Bone Colossus', result: 'bone_colossus', needs: { tomb_knight: 2, bone_chanter: 1 }, desc: 'Two Tomb Knights and a Bone Chanter become a 2×2 wall whose sweep strikes every foe around it.' },
  { id: 'rime_drake', name: 'Rime Drake', result: 'rime_drake', needs: { ember_drake: 1, frost_sprite: 2 }, desc: 'An Ember Drake and two Frost Sprites become a drake whose fire freezes: a blast that burns a crowd and slows it.' },
  { id: 'hive_queen', name: 'Hive Queen', result: 'hive_queen', needs: { hive_warden: 2, mantis_reaper: 1 }, desc: 'Two Hive Wardens and a Mantis Reaper become a 2×2 queen who mends every ally about her and reaps whatever comes near.' },
  { id: 'clockwork_titan', name: 'Clockwork Titan', result: 'clockwork_titan', needs: { clockwork_page: 2, iron_golem: 1 }, desc: 'Two Clockwork Pages and an Iron Golem become a 2×2 titan whose slam shakes the gauge out of a crowd, and whose works quicken those beside it.' },
  { id: 'pale_court', name: 'Pale Court', result: 'pale_court', needs: { will_o_wisp: 3 }, desc: "Three Will-o'-Wisps become one crowned flame: fire on a crowd, and pale fire that Hexes from four tiles off." }
]

// ── relics ───────────────────────────────────────────────────────────────────────────────────

// A relic's tier, from the most often offered to the rarest (`colour`: the interface's colour token for it). The
// first three come from reliquaries and won elites, deeper floors weighted toward the rarer (TUNING.relic.weights);
// a Legendary comes from won elites and reliquaries from floor TUNING.relic.legendary.fromFloor (run.js
// relicOffers, legendaryOffers). Legendaries are the rules that rewrite the game.
export const RELIC_TIERS = [
  { id: 'common', name: 'Common', colour: '--c-common' },
  { id: 'uncommon', name: 'Uncommon', colour: '--c-uncommon' },
  { id: 'rare', name: 'Rare', colour: '--c-rare' },
  { id: 'legendary', name: 'Legendary', colour: '--c-legendary' }
]

// Run-long passives, each of a `tier` (RELIC_TIERS). A relic held may be offered and taken again: copies stack, and
// every copy applies in full (its mods compound, a trigger fires once a copy, a number adds once a copy). `mods`
// apply to every party unit in battle but the Monarch: your souls and shadows (a `pos` mod only in that position, a
// `who` mod only to souls of that role or kin). The Monarch's own two numbers come only from relics (DESIGN §2.6):
// `command` adds Command (a piece more on the field: run.js commandOf) and `monarchHp` adds to its max HP (and heals
// it by as much, unless nothing may heal it); a won elite always lays out a Command relic (run.js relicOffers).
// `roster` adds room in the retinue; `soulTiers` gives a kind new to the run that you recruit that many free tiers,
// each on its lower track (run.js reap); `essence` raises the essence battles pay by that share; `tierDiscount`,
// `lowTierDiscount` (tiers I and II only) and `recruitDiscount` cut those prices by theirs (never below 1 essence).
// Many are triggers: `on` names a moment of a battle, for your side only, and `effects` run then (as an
// ability's do; a heal with `pct` mends that share of the target's max HP, whoever casts it). Each moment
// has a subject, a place and the one on its other end: 'kill' (one of yours slays a foe: the killer, where
// the slain fell, the slain), 'fall' (one of yours falls, the Monarch aside, whose fall ends the battle: the
// fallen, where it fell, its killer), 'wave' (a foe wave begins: the battle's opening, the foes standing from the
// start its first wave, then each later wave as it begins to enter; the Monarch, where it stands, no one),
// 'blow' (the battle's first blow lands, either side's: the Monarch, where it stands, the
// striker) and 'struck' (a blow lands on the Monarch and it stands: the Monarch, where it stands, its attacker). An
// effect's `to` picks its targets: 'self' (the subject) or 'other', if it stands; 'monarch'; or 'allies' /
// 'foes' (yours / theirs standing within `range` tiles of the place).
//
// The Legendaries' rules (battle.js relicRules, run.js): `arise` (the Monarch's Arise: without a copy no foe rises
// as a shadow; its numbers are its own, TUNING.arise's for one copy and TUNING.arise.more's more for each copy past
// the first: run.js ariseOf; its desc keeps in step with them), `rise` (a fallen soul rises at that share of its max
// HP, once a battle a copy), `alias` ({ role: role }: a unit of the first counts as one of the second more a copy,
// for your synergies), `domain` (Arise reaches that many tiles more or fewer), `reap` (Arise's shadows
// still standing when a battle is won pay their essence again, once a copy), `raises` (Arise's cap a battle grows by
// this share of itself a copy), `tithe` (each shadow costs the Monarch this share of its max HP) and `unhealable`
// (nothing heals the Monarch, in battle or out). `needsArise`: offered only once the run holds Arise (it does
// nothing without it). Nothing ever revives the Monarch.
export const RELIC_LIST = [
  { id: 'whetstone', tier: 'common', name: 'Whetstone', desc: '+18% ATK.', mods: [{ path: 'atk', op: 'mul', v: 1.18 }] },
  { id: 'heartwood', tier: 'common', name: 'Heartwood', desc: '+22% max HP.', mods: [{ path: 'hp', op: 'mul', v: 1.22 }] },
  { id: 'blood_chalice', tier: 'common', name: 'Blood Chalice', desc: 'When one of yours slays a foe: the killer heals 15% of its max HP.', on: 'kill', effects: [{ op: 'heal', pct: 0.15, to: 'self' }] },
  { id: 'balm', tier: 'common', name: 'Balm', desc: 'When one of yours falls: your side within 2 tiles of it heals 18% of its max HP.', on: 'fall', effects: [{ op: 'heal', pct: 0.18, to: 'allies', range: 2 }] },
  { id: 'binding_chain', tier: 'common', name: 'Binding Chain', desc: 'Recruiting a soul costs 30% less essence.', recruitDiscount: 0.3 },
  { id: 'ossuary_key', tier: 'common', name: 'Ossuary Key', desc: 'Your ossuary holds 3 more souls.', roster: 3 },
  { id: 'grave_shroud', tier: 'common', name: 'Grave Shroud', desc: 'The Monarch has 30 more max HP.', monarchHp: 30 },
  { id: 'bone_horn', tier: 'common', name: 'Bone Horn', desc: '+1 Command (a piece more on the field), but every soul has 10% less HP.', command: 1, mods: [{ path: 'hp', op: 'mul', v: 0.9 }] },
  { id: 'iron_oath', tier: 'common', name: 'Iron Oath', desc: 'When the Monarch is struck: your side within 2 tiles of it gains Barkskin (+25% DEF).', on: 'struck', effects: [{ op: 'apply_status', status: 'barkskin', to: 'allies', range: 2 }] },
  { id: 'grave_bell', tier: 'common', name: 'Grave Bell', desc: 'When the Monarch is struck: its attacker is Withered (−20% ATK).', on: 'struck', effects: [{ op: 'apply_status', status: 'withered', to: 'other' }] },
  { id: 'war_drum', tier: 'uncommon', name: 'War Drum', desc: 'When one of yours falls: your side within 2 tiles of it gains Hasten.', on: 'fall', effects: [{ op: 'apply_status', status: 'hasten', to: 'allies', range: 2 }] },
  { id: 'rally_horn', tier: 'uncommon', name: 'Rally Horn', desc: 'When the first blow of a battle lands: your side within 2 tiles of the Monarch gains Hasten.', on: 'blow', effects: [{ op: 'apply_status', status: 'hasten', to: 'allies', range: 2 }] },
  { id: 'soul_lantern', tier: 'uncommon', name: 'Soul Lantern', desc: 'A kind new to the run that you recruit joins with a free tier, on its lower track. Each copy: a tier more.', soulTiers: 1 },
  { id: 'tower_shield', tier: 'uncommon', name: 'Tower Shield', desc: 'As the battle begins, and as each later wave begins to enter: your side within 2 tiles of the Monarch is Shielded for 8 s (takes 40% less damage).', on: 'wave', effects: [{ op: 'apply_status', status: 'shield', dur: 160, to: 'allies', range: 2 }] },
  { id: 'grave_ledger', tier: 'uncommon', name: 'Grave Ledger', desc: 'Tiers I and II cost 30% less essence.', lowTierDiscount: 0.3 },
  { id: 'bone_mantle', tier: 'uncommon', name: 'Bone Mantle', desc: 'The Monarch has 65 more max HP.', monarchHp: 65 },
  { id: 'muster_roll', tier: 'uncommon', name: 'Muster Roll', desc: '+1 Command (a piece more on the field), but every soul has 5% less HP.', command: 1, mods: [{ path: 'hp', op: 'mul', v: 0.95 }] },
  { id: 'hunters_mark', tier: 'uncommon', name: "Hunter's Mark", desc: 'When one of yours slays a foe: the foes next to the slain turn Brittle.', on: 'kill', effects: [{ op: 'apply_status', status: 'brittle', to: 'foes', range: 1 }] },
  { id: 'hourglass', tier: 'uncommon', name: 'Hourglass', desc: 'When the Monarch is struck: Arise gains 30 gauge.', on: 'struck', effects: [{ op: 'gauge', amount: 30, to: 'monarch' }], needsArise: true },
  { id: 'bone_idol', tier: 'uncommon', name: 'Bone Idol', desc: 'When one of yours falls: Arise gains 40 gauge.', on: 'fall', effects: [{ op: 'gauge', amount: 40, to: 'monarch' }], needsArise: true },
  { id: 'grave_banner', tier: 'rare', name: 'Grave Banner', desc: '+1 Command (a piece more on the field).', command: 1 },
  { id: 'phylactery', tier: 'rare', name: 'Phylactery', desc: 'The Monarch has 110 more max HP.', monarchHp: 110 },
  { id: 'tithe_bowl', tier: 'rare', name: 'Tithe Bowl', desc: 'Battles pay 35% more essence.', essence: 0.35 },
  { id: 'rite_candle', tier: 'rare', name: 'Rite Candle', desc: 'Track tiers cost 25% less essence.', tierDiscount: 0.25 },
  { id: 'arcane_focus', tier: 'rare', name: 'Arcane Focus', desc: 'When one of yours slays a foe: the killer gains 40 gauge.', on: 'kill', effects: [{ op: 'gauge', amount: 40, to: 'self' }] },
  { id: 'glass_crown', tier: 'rare', name: 'Glass Crown', desc: '+32% damage dealt, but +15% damage taken.', mods: [{ path: 'damage.dealt', op: 'mul', v: 1.32 }, { path: 'damage.taken', op: 'mul', v: 1.15 }] },
  { id: 'arise', tier: 'legendary', name: 'Arise', desc: 'A foe of tier 3 or lower slain within 5 tiles of the Monarch rises as your shadow, 3 a battle. Each copy: a tile farther, a tier higher, 6 more a battle, and it comes 10% sooner.', arise: 1 },
  { id: 'legion', tier: 'legendary', name: 'Legion', desc: '+2 Command (two pieces more on the field), but every soul has 15% less HP.', command: 2, mods: [{ path: 'hp', op: 'mul', v: 0.85 }] },
  { id: 'undying', tier: 'legendary', name: 'Undying', desc: 'Fallen souls rise once a battle, at 60% HP. Each copy: once more a battle.', rise: 0.6 },
  { id: 'mimicry', tier: 'legendary', name: 'Mimicry', desc: 'Vanguards count as Wardens too, for synergies. Each copy: a Vanguard counts as one Warden more.', alias: { vanguard: 'warden' } },
  { id: 'hollow_court', tier: 'legendary', name: 'Hollow Court', desc: 'Shadows raised by Arise that still stand when a battle is won are reaped: each pays its essence again. Each copy: once more.', reap: 1, needsArise: true },
  { id: 'blood_tithe', tier: 'legendary', name: 'Blood Tithe', desc: "Arise's cap a battle is doubled, but each shadow costs the Monarch 2% of its max HP. Each copy: the cap grows by as much again, and the cost by 2%.", raises: 1, tithe: 0.02, needsArise: true },
  { id: 'court_of_bone', tier: 'legendary', name: 'Court of Bone', desc: 'Arise reaches 2 tiles farther, but nothing heals the Monarch, in battle or out. Each copy: 2 tiles more.', domain: 2, unhealable: true, needsArise: true }
]

// The moments a relic can trigger on.
export const TRIGGERS = ['kill', 'fall', 'wave', 'blow', 'struck']

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
const CAMPS = byId(CAMP_LIST)
export const FUSIONS = byId(FUSION_LIST)

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
export const fusionDef = lookup(FUSIONS, 'fusion')

// A unit's picture as a URL the page and the battle both load. pose: 'alive', 'attack' or 'dead'.
export const ART_POSES = ['alive', 'attack', 'dead']
export const artUrl = (id, pose = 'alive') => new URL(`./assets/units/${unitDef(id).art}.${pose}.svg`, import.meta.url).href
