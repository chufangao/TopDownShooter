// All game content: units, abilities, tracks, statuses, kin and roles, behaviours, synergies, camps, fusions and
// trines, relics and attack animations, with id lookups. Data, and the one rule that makes the trines; balance
// numbers live in tuning.js.
import { TUNING } from './tuning.js'

// ── units ────────────────────────────────────────────────────────────────────────────────────

// How a kind thinks as a foe (`temper`): aggression, how much road gained and a kill are worth; caution, how much the
// damage it would take is feared; prey, whom it would rather strike. A new temperament is three values, never code.
export const TEMPERS = {
  charger: { aggression: 1.5, caution: 0.3, prey: 'weakest' },
  shooter: { aggression: 0.5, caution: 1.5, prey: 'weakest' },
  seeker: { aggression: 1, caution: 0.8, prey: 'monarch' },
  keeper: { aggression: 0, caution: 1.5, prey: 'weakest' },
  sieger: { aggression: 1.5, caution: 0, prey: 'monarch' },
  stalker: { aggression: 1.5, caution: 0.8, prey: 'wounded' },
  hexer: { aggression: 0.5, caution: 1.5, prey: 'rested' },
  crowd: { aggression: 1, caution: 1, prey: 'crowd' },
  court: { aggression: 1, caution: 0.5, prey: 'weakest' }
}

const PREY_WORDS = {
  weakest: 'hunts the weakest',
  wounded: 'hunts the wounded',
  unarmoured: 'hunts where the armour is thinnest',
  monarch: 'hunts the Monarch',
  crowd: 'strikes where you stand thickest',
  rested: 'hunts the one with the most left to give'
}

// The bestiary's way line, generated from the three values so it can never say what the kind does not do.
export const temperLine = ({ aggression, caution, prey }) => [
  aggression >= 1.25 ? 'bold' : aggression >= 0.75 ? 'steady' : aggression > 0 ? 'patient' : 'holds while anything is in reach',
  caution >= 1.25 ? 'wary, keeps its distance' : caution >= 0.6 ? 'careful' : 'heedless',
  PREY_WORDS[prey]
].join('; ').replace(/^./, (c) => c.toUpperCase())

// A mod, as tiers, auras and relics write them.
const m = (path, op, v, pos) => (pos ? { path, op, v, pos } : { path, op, v })

// A unit is one record (test/content.test.js says what one lacks):
//   `base` + `growth` × (lvl − 1): HP, ATK, DEF; `move` tiles a turn; `arm` a melee blow's reach (1); `size` 2: a 2×2
//   `abilities`: its kit, basics last; `aura`: mods allies within `range` get; `tracks`: two of four tiers (TRACKS)
//   `flies`: over the walls, struck only by a ranged blow or a flyer's melee; `onFall`: a burst on the other side
//   `temper`, `threats`, `behaviour`: how it thinks, what it does to a Monarch, how it comes down the roads as a foe
//   `fused`: a fusion's result, never spawned; `trineOf`: a kind's written trine; `trine`: its made trine's name
//   `summons`: the kind its summon tiers call up; `rule`: a boss's or a capstone's rule; `art`: borrowed pictures
//   a boss: `phases` (HP shares granting a status), `court` (`kin`, `role` or `kinds`; `front`), `last` or `floors`, `answers`

export const UNIT_LIST = [
  {
    // You. It never moves, strikes, raises or holds a relic; if it falls the battle and the run are lost. Its HP is the
    // run's (TUNING.monarch.hp and the HP relics), and it has no level.
    id: 'monarch',
    name: 'The Monarch',
    kin: null,
    role: 'monarch',
    tier: 0,
    monarch: true,
    // hp: set by baseStats from TUNING.monarch.
    base: { hp: 0, atk: 6, def: 8 },
    growth: {},
    abilities: [],
    move: 0
  },
  {
    id: 'bone_chanter',
    name: 'Bone Chanter',
    kin: 'undead',
    role: 'channeler',
    tier: 2,
    base: { hp: 78, atk: 14, def: 6 },
    growth: { hp: 9, atk: 2.1, def: 0.6 },
    abilities: ['dirge', 'marrow_bolt'],
    // The singer at the back: four tiles of reach, and its dirge hastens those about it.
    move: 2,
    temper: TEMPERS.shooter,
    tracks: [
      { id: 'dirgemaster', name: 'Dirgemaster', desc: 'Quickens the whole line.', tiers: [
        { desc: '+1 Move.', mods: [m('move', 'add', 1)] },
        { desc: '+20% damage dealt.', mods: [m('damage.dealt', 'mul', 1.2)] },
        { desc: 'Dirge becomes Requiem: Hasten for 3 turns to every ally within 3 tiles.', ability: { id: 'requiem', replace: 'dirge' } },
        { desc: 'Requiem becomes Dirge Unending: Hasten to every ally within 3 tiles, for the rest of the battle.', ability: { id: 'dirge_unending', replace: 'requiem' } }] },
      { id: 'marrowcaller', name: 'Marrowcaller', desc: 'Bones that rise, bolts that pierce a lane.', tiers: [
        { desc: '+12% ATK.', mods: [m('atk', 'mul', 1.12)] },
        { desc: 'Bones rise to its call: 2 of its kind rise beside it in every battle, gone after it.', summon: 2 },
        { desc: 'Marrow Bolt becomes Marrow Spear: hits a foe and everyone in its lane.', ability: { id: 'marrow_spear', replace: 'marrow_bolt' } },
        { desc: 'Learns Bone Storm: shards strike every foe within 4 tiles.', ability: { id: 'bone_storm' } }] }
    ],
    spawn: { weight: 14, minFloor: 1 },
    threats: ['reach', 'drain', 'sustain'],
    behaviour: 'walk',
    flavour: 'Its warband marches to the dirge, or waits close about the singer while the song lasts.'
  },
  {
    id: 'tomb_knight',
    name: 'Tomb Knight',
    kin: 'undead',
    role: 'vanguard',
    tier: 2,
    base: { hp: 142, atk: 16, def: 22 },
    growth: { hp: 16, atk: 2.4, def: 2 },
    abilities: ['cleave', 'strike'],
    // The wall: it holds a tile, and shelters those beside it.
    move: 2,
    temper: TEMPERS.charger,
    aura: { range: 1, desc: 'Allies next to it take 15% less damage.', mods: [{ path: 'damage.taken', op: 'mul', v: 0.85 }] },
    tracks: [
      { id: 'bulwark', name: 'Bulwark', desc: 'A wall the others shelter behind.', tiers: [
        { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: 'Its aura reaches allies within 2 tiles.', aura: { range: 2, desc: 'Allies within 2 tiles take 15% less damage.', mods: [m('damage.taken', 'mul', 0.85)] } },
        { desc: 'Barrow Wall (Colossus): every piece of the kind grows to 2×2, its blows and aura reaching from all four tiles.', size: 2 }] },
      { id: 'reaver', name: 'Reaver', desc: 'Trades the shield for the edge.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+15% damage dealt while a foe is next to it.', mods: [m('damage.dealt', 'mul', 1.15, 'engaged')] },
        { desc: 'Strike becomes Rending Strike: 36 power, and leaves it Brittle.', ability: { id: 'rending_strike', replace: 'strike' } },
        { desc: 'Cleave becomes Reaving Cleave: everyone level with its target, left Brittle.', ability: { id: 'reaving_cleave', replace: 'cleave' } }] }
    ],
    // Met from floor 2.
    spawn: { weight: 10, minFloor: 2 },
    threats: ['shape'],
    behaviour: 'walk',
    flavour: "A tomb knight's plate is older than its barrow, and it moves like the barrow does: slowly, and never back."
  },
  {
    id: 'ember_drake',
    name: 'Ember Drake',
    kin: 'drake',
    role: 'ranger',
    tier: 3,
    base: { hp: 96, atk: 24, def: 10 },
    growth: { hp: 11, atk: 3.2, def: 0.9 },
    abilities: ['ember_burst', 'strike'],
    // The burster: four tiles of reach, and a blast on whatever it aims at and everyone next to it.
    move: 2,
    temper: TEMPERS.crowd,
    tracks: [
      { id: 'pyroclast', name: 'Pyroclast', desc: 'Bigger fires.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Ember Burst becomes Inferno: 32 power to a foe and everyone next to it, and leaves them Burning.', ability: { id: 'inferno', replace: 'ember_burst' } },
        { desc: 'Inferno becomes Cataclysm: reaches 5 tiles, and leaves the burnt Withered as well.', ability: { id: 'cataclysm', replace: 'inferno' } }] },
      { id: 'skyhunter', name: 'Skyhunter', desc: 'Picks off whoever strays.', tiers: [
        { desc: '+12% ATK, +1 Move.', mods: [m('atk', 'mul', 1.12), m('move', 'add', 1)] },
        { desc: '+20% damage dealt with no foe next to it.', mods: [m('damage.dealt', 'mul', 1.2, 'free')] },
        { desc: 'Learns Searing Bolt: 34 power at range 5, past Ember Burst\'s reach.', ability: { id: 'searing_bolt', at: 1 } },
        { desc: 'Searing Bolt becomes Skyfall: it reaches any foe on the board.', ability: { id: 'skyfall', replace: 'searing_bolt' } }] }
    ],
    spawn: { weight: 8, minFloor: 2 },
    threats: ['shape', 'reach'],
    behaviour: 'walk',
    flavour: 'A drake comes down the straightest way to the thickest crowd, and the ground it breathes on burns all round.'
  },
  {
    id: 'frost_sprite',
    name: 'Frost Sprite',
    kin: 'fae',
    role: 'skirmisher',
    tier: 1,
    base: { hp: 54, atk: 15, def: 4 },
    growth: { hp: 6, atk: 2, def: 0.3 },
    abilities: ['frost_lance'],
    // The quick one: three tiles a turn, a lance three tiles long, and frost that Hexes once it learns it.
    move: 3,
    temper: TEMPERS.shooter,
    tracks: [
      { id: 'rimeblade', name: 'Rimeblade', desc: 'A colder, crueller lance.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Frost Lance becomes Shatter Lance: 38 power, and leaves it Brittle for 2 turns.', ability: { id: 'shatter_lance', replace: 'frost_lance' } },
        { desc: "Shatter Lance becomes Glacier Lance: it pierces everyone in its target's lane.", ability: { id: 'glacier_lance', replace: 'shatter_lance' } }] },
      { id: 'winters_herald', name: "Winter's Herald", desc: 'Locks everything near it in ice.', tiers: [
        { desc: '+1 Move.', mods: [m('move', 'add', 1)] },
        { desc: '+8% DEF.', mods: [m('def', 'mul', 1.08)] },
        { desc: 'Learns Hoarfrost: frosts a foe and everyone next to it, and leaves them Hexed.', ability: { id: 'hoarfrost' } },
        { desc: 'Learns Deep Winter: frosts every foe within 3 tiles, and leaves them Hexed.', ability: { id: 'deep_winter' } }] }
    ],
    spawn: { weight: 12, minFloor: 1 },
    threats: ['reach', 'drain'],
    behaviour: 'walk',
    flavour: 'A sprite is there before its frost is, and whatever the frost touches moves as if through snow.'
  },
  {
    id: 'hive_warden',
    name: 'Hive Warden',
    kin: 'insect',
    role: 'warden',
    tier: 2,
    base: { hp: 110, atk: 13, def: 15 },
    growth: { hp: 13, atk: 1.6, def: 1.4 },
    abilities: ['mend', 'purge', 'strike'],
    // The mender at the front: it heals whichever ally is hurt worst, wherever it stands.
    move: 2,
    temper: TEMPERS.keeper,
    tracks: [
      { id: 'brood_mother', name: 'Brood Mother', desc: 'Hatches a swarm, and mends it.', tiers: [
        { desc: '+25% healing given.', mods: [m('heal.given', 'mul', 1.25)] },
        { desc: 'Its brood hatches with it: 2 of its kind hatch beside it in every battle, gone after it.', summon: 2 },
        { desc: 'Mend becomes Swarm Mend: heals every ally within 2 tiles.', ability: { id: 'swarm_mend', replace: 'mend' } },
        { desc: 'Swarm Mend becomes Brood Surge: heals every ally within 3 tiles and gives them Regen.', ability: { id: 'brood_surge', replace: 'swarm_mend' } }] },
      { id: 'chitin_guard', name: 'Chitin Guard', desc: 'Armours those beside it.', tiers: [
        { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
        { desc: 'Takes 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] },
        { desc: 'Gains an aura: allies next to it get +15% DEF.', aura: { range: 1, desc: 'Allies next to it get +15% DEF.', mods: [m('def', 'mul', 1.15)] } },
        { desc: 'Learns Molt: strips up to 3 debuffs from itself and every ally within 2 tiles.', ability: { id: 'molt' } }] }
    ],
    spawn: { weight: 9, minFloor: 1 },
    threats: ['sustain'],
    behaviour: 'walk',
    flavour: 'A warden never strays far from its comb, and its swarm keeps close about it.'
  },
  {
    id: 'clockwork_page',
    name: 'Clockwork Page',
    kin: 'construct',
    role: 'trickster',
    tier: 1,
    base: { hp: 68, atk: 12, def: 9 },
    growth: { hp: 7, atk: 1.7, def: 0.8 },
    abilities: ['purge', 'strike'],
    // The tender: it picks the curses off its fellows and marches on.
    move: 2,
    temper: TEMPERS.keeper,
    tracks: [
      { id: 'saboteur', name: 'Saboteur', desc: 'Jams the enemy back line.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Strike becomes Spanner in the Works: 30 power, and leaves it Hexed.', ability: { id: 'spanner', replace: 'strike' } },
        { desc: 'Spanner becomes Wrench the Works: it leaves a foe Hexed for 2 turns.', ability: { id: 'wrench', replace: 'spanner' } }] },
      { id: 'gearwright', name: 'Gearwright', desc: 'Winds up soldiers, and keeps them wound.', tiers: [
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: 'Winds up its spares: 2 of its kind whir beside it in every battle, run down after it.', summon: 2 },
        { desc: 'Purge becomes Overclock: Hasten and one debuff removed, on the most wounded ally.', ability: { id: 'overclock', replace: 'purge' } },
        { desc: 'Overclock becomes Perpetual Motion: Hasten and a debuff removed for every ally within 2 tiles.', ability: { id: 'perpetual_motion', replace: 'overclock' } }] }
    ],
    spawn: { weight: 12, minFloor: 1 },
    threats: ['sustain'],
    behaviour: 'walk',
    flavour: 'A page was wound to tend its betters: it oils the seized joint, picks the curse from the plate, and marches on.'
  },
  {
    id: 'grave_ghoul',
    name: 'Grave Ghoul',
    kin: 'undead',
    role: 'vanguard',
    tier: 1,
    base: { hp: 96, atk: 13, def: 9 },
    growth: { hp: 11, atk: 1.8, def: 0.8 },
    abilities: ['gnaw', 'strike'],
    // The long arm: its blows reach two tiles off, a foe's as yours.
    arm: 2,
    move: 2,
    temper: { ...TEMPERS.charger, prey: 'unarmoured' },
    tracks: [
      { id: 'pack_leader', name: 'Pack Leader', desc: 'The pack runs at its heel.', tiers: [
        { desc: '+15% DEF.', mods: [m('def', 'mul', 1.15)] },
        { desc: '+1 Move.', mods: [m('move', 'add', 1)] },
        { desc: 'Gains an aura: allies next to it deal 10% more damage.', aura: { range: 1, desc: 'Allies next to it deal 10% more damage.', mods: [m('damage.dealt', 'mul', 1.1)] } },
        { desc: 'Charnel Brute (Colossus): every piece of the kind grows to 2×2, its blows and aura reaching from all four tiles.', size: 2 }] },
      { id: 'glutton', name: 'Glutton', desc: 'Eats to stay standing.', tiers: [
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: 'Takes 8% less damage.', mods: [m('damage.taken', 'mul', 0.92)] },
        { desc: 'Gnaw becomes Devour: 34 power, and it heals itself.', ability: { id: 'devour', replace: 'gnaw' } },
        { desc: 'Devour becomes Gorge: it bites a foe and every foe next to it, and heals itself once.', ability: { id: 'gorge', replace: 'devour' } }] }
    ],
    spawn: { weight: 13, minFloor: 1 },
    threats: ['drain'],
    behaviour: 'walk',
    flavour: 'A ghoul gnaws where the armour is thinnest, and whatever it has gnawed is never as hard again.'
  },
  {
    id: 'will_o_wisp',
    name: "Will-o'-Wisp",
    kin: 'fae',
    role: 'channeler',
    tier: 1,
    base: { hp: 50, atk: 15, def: 3 },
    growth: { hp: 6, atk: 2.1, def: 0.3 },
    abilities: ['witchfire'],
    // The far fire: it strikes from four tiles off.
    move: 2,
    temper: TEMPERS.seeker,
    tracks: [
      { id: 'lantern', name: 'Lantern', desc: 'Its light spreads to crowds.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: 'Learns Wildfire: 24 power to a foe and everyone next to it.', ability: { id: 'wildfire' } },
        { desc: 'Wildfire becomes Conflagration: it burns every foe within 4 tiles.', ability: { id: 'conflagration', replace: 'wildfire' } }] },
      { id: 'will_ward', name: 'Will-Ward', desc: 'Hard to pin down, and so are its friends.', tiers: [
        { desc: '+8% DEF.', mods: [m('def', 'mul', 1.08)] },
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: 'Gains an aura: allies next to it get +8% DEF.', aura: { range: 1, desc: 'Allies next to it get +8% DEF.', mods: [m('def', 'mul', 1.08)] } },
        { desc: 'Learns Veil: Barkskin (+25% DEF) for itself and every ally within 2 tiles.', ability: { id: 'veil' } }] }
    ],
    spawn: { weight: 11, minFloor: 1 },
    threats: ['reach'],
    behaviour: 'walk',
    flavour: 'A wisp keeps the road as meekly as any pilgrim, yet its cold fire leaps four paces ahead of it to whatever is warm.'
  },
  {
    id: 'thorn_dryad',
    name: 'Thorn Dryad',
    kin: 'fae',
    role: 'warden',
    tier: 2,
    lock: { keys: ['burning'], share: 0.35 },
    base: { hp: 104, atk: 12, def: 12 },
    growth: { hp: 12, atk: 1.6, def: 1.1 },
    abilities: ['barkskin', 'mend', 'strike'],
    // The rooted one: a tile a turn, and its grove grows thick about it.
    move: 1,
    temper: TEMPERS.keeper,
    tracks: [
      { id: 'heartwood', name: 'Heartwood', desc: "Deep-rooted healing, and the grove's lights.", tiers: [
        { desc: '+25% healing given.', mods: [m('heal.given', 'mul', 1.25)] },
        { desc: 'Wakes saplings of its grove: 2 of its kind take root beside it in every battle, gone after it.', summon: 2 },
        { desc: 'Mend becomes Bloom: 34 power, and Regen.', ability: { id: 'bloom', replace: 'mend' } },
        { desc: 'Bloom becomes Verdant Bloom: it heals every ally within 2 tiles, with Regen.', ability: { id: 'verdant_bloom', replace: 'bloom' } }] },
      { id: 'bramble', name: 'Bramble', desc: 'A healer with thorns.', tiers: [
        { desc: '+15% DEF.', mods: [m('def', 'mul', 1.15)] },
        { desc: '+12% ATK.', mods: [m('atk', 'mul', 1.12)] },
        { desc: 'Learns Thorn Lash: damage to a foe and everyone level with it.', ability: { id: 'thorn_lash' } },
        { desc: 'Thorn Lash becomes Briar Lash: it reaches 2 tiles, and leaves everyone level with its target Brittle.', ability: { id: 'briar_lash', replace: 'thorn_lash' } }] }
    ],
    spawn: { weight: 9, minFloor: 2 },
    threats: ['sustain'],
    behaviour: 'walk',
    flavour: 'A dryad is rooted where it stands, and pulls its roots up slowly when it must move.'
  },
  {
    id: 'mantis_reaper',
    name: 'Mantis Reaper',
    kin: 'insect',
    role: 'trickster',
    tier: 3,
    base: { hp: 92, atk: 25, def: 9 },
    growth: { hp: 10, atk: 3.1, def: 0.8 },
    abilities: ['reap', 'strike'],
    // Quick, and a long arm: its blows reach two tiles off. Its Reap opens a wound that Bleeds.
    arm: 2,
    move: 3,
    temper: TEMPERS.stalker,
    tracks: [
      { id: 'executioner', name: 'Executioner', desc: 'One cut, one corpse.', tiers: [
        { desc: '+12% ATK.', mods: [m('atk', 'mul', 1.12)] },
        { desc: '+12% ATK.', mods: [m('atk', 'mul', 1.12)] },
        { desc: 'Reap becomes Execute: 48 power.', ability: { id: 'execute', replace: 'reap' } },
        { desc: 'Execute becomes Harvest: 40 power to a foe and every foe next to it.', ability: { id: 'harvest', replace: 'execute' } }] },
      { id: 'phantom', name: 'Phantom', desc: 'Never quite where it was.', tiers: [
        { desc: '+10% DEF.', mods: [m('def', 'mul', 1.1)] },
        { desc: '+1 Move.', mods: [m('move', 'add', 1)] },
        { desc: '+15% DEF, +15% damage dealt.', mods: [m('def', 'mul', 1.15), m('damage.dealt', 'mul', 1.15)] },
        { desc: 'Learns Phantom Edge: it strikes from up to 3 tiles away, a tile past its scythes\' 2.', ability: { id: 'phantom_edge', at: 1 } }] }
    ],
    spawn: { weight: 7, minFloor: 2 },
    threats: ['bleed'],
    behaviour: 'walk',
    flavour: 'A mantis stalks the road with its brood about it, quick as a thought, and its scythes fall before its shadow does.'
  },
  {
    id: 'iron_golem',
    name: 'Iron Golem',
    kin: 'construct',
    role: 'vanguard',
    tier: 3,
    lock: { keys: ['brittle'], share: 0.3 },
    base: { hp: 220, atk: 17, def: 30 },
    growth: { hp: 22, atk: 2.2, def: 2.4 },
    abilities: ['quake', 'strike'],
    // The juggernaut: a tile a turn, and its quake Hexes everything about it.
    move: 1,
    temper: TEMPERS.sieger,
    tracks: [
      { id: 'juggernaut', name: 'Juggernaut', desc: 'An iron wall that shelters others.', tiers: [
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
        { desc: 'Gains an aura: allies next to it take 10% less damage.', aura: { range: 1, desc: 'Allies next to it take 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] } },
        { desc: 'Iron Bastion (Colossus): every piece of the kind grows to 2×2, its blows and aura reaching from all four tiles.', size: 2 }] },
      { id: 'siegebreaker', name: 'Siegebreaker', desc: 'Breaks whole formations.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+1 Move.', mods: [m('move', 'add', 1)] },
        { desc: 'Quake becomes Earthshatter: 26 power to a foe and everyone next to it, and leaves them Hexed.', ability: { id: 'earthshatter', replace: 'quake' } },
        { desc: 'Earthshatter becomes Worldbreaker: it hits everyone level with its target, and leaves them Hexed.', ability: { id: 'worldbreaker', replace: 'earthshatter' } }] }
    ],
    spawn: { weight: 7, minFloor: 2 },
    threats: ['shape'],
    behaviour: 'walk',
    flavour: 'A golem moves at the pace of settling stone, and nothing turns it once it does.'
  },
  {
    id: 'barrow_wight',
    name: 'Barrow Wight',
    kin: 'undead',
    role: 'skirmisher',
    tier: 4,
    lock: { keys: ['hexed'], share: 0.3 },
    base: { hp: 128, atk: 27, def: 13 },
    growth: { hp: 14, atk: 3.4, def: 1.1 },
    abilities: ['wither', 'strike'],
    // The cold reach: it withers from three tiles off.
    move: 2,
    temper: TEMPERS.shooter,
    tracks: [
      { id: 'lich', name: 'Lich-in-Waiting', desc: 'Feeds on what it kills.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Wither becomes Soul Drain: 34 power, and it heals itself.', ability: { id: 'soul_drain', replace: 'wither' } },
        { desc: 'Soul Drain becomes Soul Harvest: it drains a foe and every foe next to it, and heals itself once.', ability: { id: 'soul_harvest', replace: 'soul_drain' } }] },
      { id: 'dread', name: 'Dread', desc: 'Its wail saps whole squads.', tiers: [
        { desc: '+15% max HP.', mods: [m('hp', 'mul', 1.15)] },
        { desc: '+8% DEF.', mods: [m('def', 'mul', 1.08)] },
        { desc: 'Learns Dread Wail: Withers a foe and everyone next to it.', ability: { id: 'dread_wail' } },
        { desc: 'Dread Wail becomes Death Knell: it Withers every foe within 3 tiles.', ability: { id: 'death_knell', replace: 'dread_wail' } }] }
    ],
    spawn: { weight: 6, minFloor: 3 },
    threats: ['reach', 'drain'],
    behaviour: 'walk',
    flavour: 'A wight treads the road it was once borne down to its barrow, and the living wither three paces before it ever touches them.'
  },
  {
    id: 'frost_wyrm',
    name: 'Frost Wyrm',
    kin: 'drake',
    role: 'ranger',
    tier: 4,
    lock: { keys: ['burning'], share: 0.3 },
    base: { hp: 190, atk: 29, def: 16 },
    growth: { hp: 20, atk: 3.4, def: 1.5 },
    abilities: ['glacial_breath', 'strike'],
    // The slow breath: it waits for the field to come, and breathes down a whole lane three tiles long.
    move: 2,
    temper: { ...TEMPERS.shooter, aggression: 0, caution: 2.5 },
    tracks: [
      { id: 'ancient', name: 'Ancient', desc: 'Older, colder, and never alone.', tiers: [
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: 'Whelps of its brood: 2 of its kind rise beside it in every battle, gone after it.', summon: 2 },
        { desc: 'Glacial Breath becomes Blizzard: it strikes a foe and everyone level with it.', ability: { id: 'blizzard', replace: 'glacial_breath' } },
        { desc: 'Blizzard becomes Ice Age: it freezes every foe within 3 tiles, and leaves them Hexed.', ability: { id: 'ice_age', replace: 'blizzard' } }] },
      { id: 'rime_tyrant', name: 'Rime Tyrant', desc: 'Pure killing cold.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+1 Move.', mods: [m('move', 'add', 1)] },
        { desc: '+20% damage dealt, +10% ATK.', mods: [m('damage.dealt', 'mul', 1.2), m('atk', 'mul', 1.1)] },
        { desc: 'Learns Killing Cold: 40 power to a foe anywhere on the board, once one is below half HP.', ability: { id: 'killing_cold' } }] }
    ],
    spawn: { weight: 6, minFloor: 3 },
    threats: ['shape', 'reach'],
    behaviour: 'walk',
    flavour: 'An old wyrm makes the field come to it, and its brood waits with it.'
  },
  {
    // The burner of floor 1: quick, and its bite leaves Burning, which outlasts the hound.
    id: 'pyre_hound',
    name: 'Pyre Hound',
    kin: 'drake',
    role: 'skirmisher',
    tier: 2,
    base: { hp: 84, atk: 16, def: 8 },
    growth: { hp: 9, atk: 2.2, def: 0.7 },
    abilities: ['pyre_bite'],
    move: 3,
    temper: TEMPERS.charger,
    tracks: [
      { id: 'cinder', name: 'Cinder', desc: 'A hotter bite, and a longer burn.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Pyre Bite becomes Cinder Fang: 34 power, and its Burning lasts 5 turns.', ability: { id: 'cinder_fang', replace: 'pyre_bite' } },
        { desc: 'Cinder Fang becomes Hellmaw: it bites a foe and every foe next to it, and leaves them all Burning.', ability: { id: 'hellmaw', replace: 'cinder_fang' } }] },
      { id: 'firebrand', name: 'Firebrand', desc: 'The pack runs hot about it.', tiers: [
        { desc: '+15% max HP.', mods: [m('hp', 'mul', 1.15)] },
        { desc: '+1 Move.', mods: [m('move', 'add', 1)] },
        { desc: 'Gains an aura: allies next to it get +8% ATK.', aura: { range: 1, desc: 'Allies next to it get +8% ATK.', mods: [m('atk', 'mul', 1.08)] } },
        { desc: 'Learns Cinder Spit: 26 power and Burning at range 3.', ability: { id: 'cinder_spit' } }] }
    ],
    spawn: { weight: 10, minFloor: 1 },
    threats: ['burn'],
    behaviour: 'walk',
    flavour: 'A hound of the pyre runs ahead of the pack, and what it bites smoulders long after it has let go.'
  },
  {
    // The flyer of floor 2: over the walls, straight at the Monarch; only a ranged blow or a flyer's melee touches it.
    id: 'hive_drone',
    name: 'Hive Drone',
    kin: 'insect',
    role: 'skirmisher',
    tier: 1,
    base: { hp: 46, atk: 12, def: 3 },
    growth: { hp: 5, atk: 1.7, def: 0.3 },
    abilities: ['drone_sting'],
    move: 3,
    temper: TEMPERS.seeker,
    flies: true,
    tracks: [
      { id: 'venom', name: 'Venom', desc: 'A worse sting.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Sting becomes Venom Sting: 30 power, and leaves it Withered.', ability: { id: 'venom_sting', replace: 'drone_sting' } },
        { desc: 'Venom Sting becomes Hexing Sting: it leaves its target Hexed too.', ability: { id: 'hexing_sting', replace: 'venom_sting' } }] },
      { id: 'hum', name: 'Hum of the Hive', desc: 'The swarm keeps time with it.', tiers: [
        { desc: '+8% DEF.', mods: [m('def', 'mul', 1.08)] },
        { desc: '+15% max HP.', mods: [m('hp', 'mul', 1.15)] },
        { desc: 'Gains an aura: allies next to it get +1 Move.', aura: { range: 1, desc: 'Allies next to it get +1 Move.', mods: [m('move', 'add', 1)] } },
        { desc: 'Learns Swarm Cloud: it stings a foe and every foe next to it.', ability: { id: 'swarm_cloud' } }] }
    ],
    spawn: { weight: 10, minFloor: 2 },
    threats: ['fly'],
    behaviour: 'fly',
    flavour: 'Walls mean nothing to a drone: the hive points, and it goes there by the shortest air, and stings whatever stands in it.'
  },
  {
    // The death burst of floor 2: thick, and when it falls what stood next to it is Withered.
    id: 'rot_bloat',
    name: 'Rot Bloat',
    kin: 'undead',
    role: 'vanguard',
    tier: 2,
    lock: { keys: ['burning'], share: 0.3 },
    base: { hp: 150, atk: 12, def: 10 },
    growth: { hp: 16, atk: 1.6, def: 0.9 },
    abilities: ['bile', 'strike'],
    move: 2,
    temper: TEMPERS.charger,
    onFall: { range: 1, effects: [{ op: 'apply_status', status: 'withered' }] },
    tracks: [
      { id: 'swollen', name: 'Swollen', desc: 'Harder to open.', tiers: [
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
        { desc: 'Takes 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] },
        { desc: 'Bursting Hulk (Colossus): every piece of the kind swells to 2×2, its blows reaching from all four tiles.', size: 2 }] },
      { id: 'putrid', name: 'Putrid', desc: 'It rots what it touches.', tiers: [
        { desc: '+12% ATK.', mods: [m('atk', 'mul', 1.12)] },
        { desc: '+1 Move.', mods: [m('move', 'add', 1)] },
        { desc: 'Bile becomes Spew: 22 power to a foe and everyone next to it, and leaves them Withered.', ability: { id: 'spew', replace: 'bile' } },
        { desc: 'Learns Miasma: Withers and Hexes every foe within 2 tiles.', ability: { id: 'miasma' } }] }
    ],
    spawn: { weight: 8, minFloor: 2 },
    threats: ['drain'],
    behaviour: 'walk',
    flavour: 'A bloat is a corpse that kept its gas: it waddles, and no one who knows stands near when one is opened.'
  },
  {
    // The hexer of floor 3: from three tiles off, its curse leaves Hexed (its next act lost).
    id: 'marsh_hag',
    name: 'Marsh Hag',
    kin: 'fae',
    role: 'channeler',
    tier: 3,
    lock: { keys: ['brittle', 'burning'], share: 0.3 },
    base: { hp: 88, atk: 20, def: 8 },
    growth: { hp: 10, atk: 2.7, def: 0.7 },
    abilities: ['hex', 'strike'],
    move: 2,
    temper: TEMPERS.hexer,
    tracks: [
      { id: 'crone', name: 'Crone', desc: 'Deeper curses.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: 'Hex becomes Bog Curse: 30 power, and leaves it Hexed and Brittle.', ability: { id: 'bog_curse', replace: 'hex' } },
        { desc: 'Learns Mire: Hexes every foe within 3 tiles.', ability: { id: 'mire' } }] },
      { id: 'charmwife', name: 'Charmwife', desc: 'Charms for her own, and a longer reach.', tiers: [
        { desc: '+15% max HP.', mods: [m('hp', 'mul', 1.15)] },
        { desc: '+8% DEF.', mods: [m('def', 'mul', 1.08)] },
        { desc: 'Gains an aura: allies within 2 tiles get +6% DEF.', aura: { range: 2, desc: 'Allies within 2 tiles get +6% DEF.', mods: [m('def', 'mul', 1.06)] } },
        { desc: 'Hex becomes Long Curse: it reaches 5 tiles.', ability: { id: 'long_curse', replace: 'hex' } }] }
    ],
    spawn: { weight: 7, minFloor: 3 },
    threats: ['reach', 'drain'],
    behaviour: 'walk',
    flavour: 'A hag mutters a word over whatever she means to keep, and after it moves as if the bog had its ankles.'
  },
  {
    // The flying burner of floor 3: over the walls, never through your pieces, and its breath leaves Burning on a crowd.
    id: 'ash_wyvern',
    name: 'Ash Wyvern',
    kin: 'drake',
    role: 'ranger',
    tier: 3,
    base: { hp: 100, atk: 22, def: 9 },
    growth: { hp: 11, atk: 3, def: 0.8 },
    abilities: ['cinder_breath', 'strike'],
    move: 3,
    temper: TEMPERS.seeker,
    flies: true,
    tracks: [
      { id: 'ashstorm', name: 'Ashstorm', desc: 'Wider fires.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Cinder Breath becomes Ashfall: it reaches 3 tiles.', ability: { id: 'ashfall', replace: 'cinder_breath' } },
        { desc: 'Ashfall becomes Pyre Rain: Burning for 4 turns on every foe within 3 tiles.', ability: { id: 'pyre_rain', replace: 'ashfall' } }] },
      { id: 'skyrend', name: 'Skyrend', desc: 'Strikes from high and far.', tiers: [
        { desc: '+8% DEF.', mods: [m('def', 'mul', 1.08)] },
        { desc: '+1 Move.', mods: [m('move', 'add', 1)] },
        { desc: '+20% damage dealt with no foe next to it.', mods: [m('damage.dealt', 'mul', 1.2, 'free')] },
        { desc: 'Learns Ember Lance: 34 power and Burning at range 4.', ability: { id: 'ember_lance', at: 1 } }] }
    ],
    spawn: { weight: 7, minFloor: 3 },
    threats: ['fly', 'burn'],
    behaviour: 'fly',
    flavour: 'An ash wyvern is seen first as a shadow on the ground, and the ground its breath falls on goes on smouldering.'
  },
  // ── the simple floor-1 kinds ──
  // Tier 1, one blow of its own each and at most a basic, no aura: a lone first soul of any kin can hold a road or shoot.
  {
    // The drakes' shooter on floor 1: a spit three tiles long at one foe.
    id: 'cinder_whelp',
    name: 'Cinder Whelp',
    kin: 'drake',
    role: 'ranger',
    tier: 1,
    base: { hp: 58, atk: 14, def: 5 },
    growth: { hp: 6, atk: 1.9, def: 0.4 },
    abilities: ['ember_spit'],
    move: 2,
    temper: TEMPERS.shooter,
    tracks: [
      { id: 'kindling', name: 'Kindling', desc: 'Its spit catches.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Ember Spit becomes Cinder Spit: 26 power and Burning at range 3.', ability: { id: 'cinder_spit', replace: 'ember_spit' } },
        { desc: 'Cinder Spit becomes Ember Lance: 34 power and Burning at range 4.', ability: { id: 'ember_lance', replace: 'cinder_spit' } }] },
      { id: 'fledgling', name: 'Fledgling', desc: 'Grows into its fire.', tiers: [
        { desc: '+15% max HP.', mods: [m('hp', 'mul', 1.15)] },
        { desc: '+1 Move.', mods: [m('move', 'add', 1)] },
        { desc: 'Learns Ashfall: 26 power to a foe and everyone next to it, at range 3, and leaves them Burning.', ability: { id: 'ashfall' } },
        { desc: 'Ashfall becomes Pyre Rain: Burning for 4 turns on every foe within 3 tiles.', ability: { id: 'pyre_rain', replace: 'ashfall' } }] }
    ],
    spawn: { weight: 8, minFloor: 1 },
    threats: ['reach'],
    behaviour: 'walk',
    flavour: 'A whelp has not yet the fire for a crowd: it spits what it has at one foe, from three paces back.'
  },
  {
    // The constructs' turret: a tile a turn, and a bolt three tiles long at one foe.
    id: 'brass_sentry',
    name: 'Brass Sentry',
    kin: 'construct',
    role: 'ranger',
    tier: 1,
    base: { hp: 76, atk: 10, def: 10 },
    growth: { hp: 8, atk: 1.6, def: 0.9 },
    abilities: ['brass_bolt'],
    move: 1,
    temper: TEMPERS.shooter,
    tracks: [
      { id: 'calibrator', name: 'Calibrator', desc: 'Truer bolts, from farther off.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Brass Bolt becomes Long Bolt: 34 power at range 4.', ability: { id: 'long_bolt', replace: 'brass_bolt' } },
        { desc: "Long Bolt becomes Piercing Bolt: it pierces everyone in its target's lane, at range 4.", ability: { id: 'piercing_bolt', replace: 'long_bolt' } }] },
      { id: 'riveted', name: 'Riveted', desc: 'Plated, and keeps its fellows wound.', tiers: [
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: '+15% DEF.', mods: [m('def', 'mul', 1.15)] },
        { desc: 'Learns Overclock: Hasten and one debuff removed, on the most wounded ally.', ability: { id: 'overclock' } },
        { desc: 'Overclock becomes Perpetual Motion: Hasten and a debuff removed for every ally within 2 tiles.', ability: { id: 'perpetual_motion', replace: 'overclock' } }] }
    ],
    spawn: { weight: 8, minFloor: 1 },
    threats: ['reach'],
    behaviour: 'walk',
    flavour: 'A sentry was built to stand a post, not to walk to one: it grinds forward a pace at a time, and looses at whatever comes within three.'
  },
  {
    // The insects' shooter: a spit three tiles long at one foe, from a shell that cannot take much back.
    id: 'hive_spitter',
    name: 'Hive Spitter',
    kin: 'insect',
    role: 'ranger',
    tier: 1,
    base: { hp: 57, atk: 14, def: 3 },
    growth: { hp: 5, atk: 1.9, def: 0.3 },
    abilities: ['acid_spit'],
    move: 2,
    temper: TEMPERS.shooter,
    tracks: [
      { id: 'caustic', name: 'Caustic', desc: 'Spit that eats what it lands on.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Acid Spit becomes Venom Spit: 30 power, and leaves it Withered.', ability: { id: 'venom_spit', replace: 'acid_spit' } },
        { desc: 'Venom Spit becomes Sting Storm: it strikes every foe within 3 tiles, and leaves them Withered.', ability: { id: 'sting_storm', replace: 'venom_spit' } }] },
      { id: 'swarmer', name: 'Swarmer', desc: 'Bites when the swarm closes in.', tiers: [
        { desc: '+15% max HP.', mods: [m('hp', 'mul', 1.15)] },
        { desc: '+8% DEF.', mods: [m('def', 'mul', 1.08)] },
        { desc: 'Learns Swarm Cloud: it stings a foe and every foe next to it.', ability: { id: 'swarm_cloud' } },
        { desc: 'Swarm Cloud becomes Reaping Swarm: 34 power to a foe and every foe next to it, and leaves them Brittle.', ability: { id: 'reaping_swarm', replace: 'swarm_cloud' } }] }
    ],
    spawn: { weight: 8, minFloor: 1 },
    threats: ['reach'],
    behaviour: 'walk',
    flavour: 'A spitter\'s shell is thin as a wing: it keeps three paces behind the swarm, and spits at the weakest thing it sees.'
  },
  {
    // The fae's blocker: it holds the road, and its lash takes the whole row it stands level with.
    id: 'thornling',
    name: 'Thornling',
    kin: 'fae',
    role: 'vanguard',
    tier: 1,
    base: { hp: 84, atk: 12, def: 8 },
    growth: { hp: 10, atk: 1.6, def: 0.7 },
    abilities: ['thorn_lash', 'strike'],
    move: 2,
    temper: TEMPERS.charger,
    tracks: [
      { id: 'hedgerow', name: 'Hedgerow', desc: 'A wall of thorns across the road.', tiers: [
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: '+15% DEF.', mods: [m('def', 'mul', 1.15)] },
        { desc: 'Learns Barkskin: Barkskin (+25% DEF) for itself and every ally within 2 tiles.', ability: { id: 'barkskin' } },
        { desc: 'Bramble Wall (Colossus): every piece of the kind grows to 2×2, its blows reaching from all four tiles.', size: 2 }] },
      { id: 'briar', name: 'Briar', desc: 'Thorns that bite deeper.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Strike becomes Rending Strike: 36 power, and leaves it Brittle.', ability: { id: 'rending_strike', replace: 'strike' } },
        { desc: 'Thorn Lash becomes Briar Lash: it reaches 2 tiles, and leaves everyone level with its target Brittle.', ability: { id: 'briar_lash', replace: 'thorn_lash' } }] }
    ],
    spawn: { weight: 8, minFloor: 1 },
    threats: ['shape'],
    behaviour: 'walk',
    flavour: 'A thornling roots itself across the road like a hedge, and its thorns lash at everything that stands level with it.'
  },
  {
    // Tomb Knight ×2 + Bone Chanter: a 2×2 wall whose sweep strikes every foe beside it, its aura sheltering allies within 2.
    id: 'bone_colossus',
    name: 'Bone Colossus',
    kin: 'undead',
    role: 'vanguard',
    tier: 4,
    fused: true,
    size: 2,
    base: { hp: 472, atk: 31, def: 21 },
    growth: { hp: 45, atk: 3.8, def: 1.8 },
    abilities: ['colossal_sweep', 'strike'],
    move: 2,
    temper: TEMPERS.charger,
    aura: { range: 2, desc: 'Allies within 2 tiles take 15% less damage.', mods: [{ path: 'damage.taken', op: 'mul', v: 0.85 }] },
    tracks: [
      { id: 'rampart', name: 'Rampart', desc: 'A thicker wall, a wider shelter.', tiers: [
        { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: 'Takes 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] },
        { desc: 'Its aura reaches allies within 3 tiles.', aura: { range: 3, desc: 'Allies within 3 tiles take 15% less damage.', mods: [m('damage.taken', 'mul', 0.85)] } }] },
      { id: 'wrecker', name: 'Wrecker', desc: 'A heavier sweep.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Colossal Sweep becomes Bone Quake: every foe within 1 tile, left Hexed.', ability: { id: 'bone_quake', replace: 'colossal_sweep' } },
        { desc: 'Bone Quake becomes Grave Breaker: every foe within 2 tiles, left Brittle.', ability: { id: 'grave_breaker', replace: 'bone_quake' } }] }
    ],
    threats: ['shape'],
    flavour: 'Two knights and the singer who bound them, standing as one: a wall that remembers how to fight.'
  },
  {
    // Ember Drake + Frost Sprite ×2: fire that freezes, its blast burning a crowd from four tiles off.
    id: 'rime_drake',
    name: 'Rime Drake',
    kin: 'drake',
    role: 'ranger',
    tier: 4,
    fused: true,
    base: { hp: 259, atk: 37, def: 10 },
    growth: { hp: 27, atk: 4.9, def: 0.9 },
    abilities: ['rimefire', 'frost_lance'],
    move: 2,
    temper: TEMPERS.crowd,
    tracks: [
      { id: 'frostfire', name: 'Frostfire', desc: 'A wider storm.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Rimefire becomes Rimestorm: it reaches 5 tiles.', ability: { id: 'rimestorm', replace: 'rimefire' } },
        { desc: 'Rimestorm becomes Equinox: it burns every foe within 5 tiles, and leaves them Hexed.', ability: { id: 'equinox', replace: 'rimestorm' } }] },
      { id: 'glacier_heart', name: 'Glacier Heart', desc: 'A colder heart, a hotter lance.', tiers: [
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: '+1 Move.', mods: [m('move', 'add', 1)] },
        { desc: '+20% damage dealt with no foe next to it.', mods: [m('damage.dealt', 'mul', 1.2, 'free')] },
        { desc: 'Frost Lance becomes Kindled Lance: 38 power, and leaves it Hexed and Burning.', ability: { id: 'kindled_lance', replace: 'frost_lance' } }] }
    ],
    threats: ['shape', 'reach', 'burn'],
    flavour: 'A drake and the two sprites that rode it, breathing as one: the fire comes out cold, and the frost burns.'
  },
  {
    // Hive Warden ×2 + Mantis Reaper: a 2×2 mender whose jelly mends every ally within 2, its scythe on whatever comes near.
    id: 'hive_queen',
    name: 'Hive Queen',
    kin: 'insect',
    role: 'warden',
    tier: 4,
    fused: true,
    size: 2,
    base: { hp: 439, atk: 31, def: 15 },
    growth: { hp: 44, atk: 4.0, def: 1.4 },
    abilities: ['royal_jelly', 'royal_scythe', 'strike'],
    move: 2,
    temper: TEMPERS.keeper,
    tracks: [
      { id: 'matriarch', name: 'Matriarch', desc: 'The comb is wherever she stands.', tiers: [
        { desc: '+25% healing given.', mods: [m('heal.given', 'mul', 1.25)] },
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: 'Gains an aura: allies within 2 tiles take 10% less damage.', aura: { range: 2, desc: 'Allies within 2 tiles take 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] } },
        { desc: 'Royal Jelly becomes Hive Mind: it heals every ally within 3 tiles and strips a debuff from each.', ability: { id: 'hive_mind', replace: 'royal_jelly' } }] },
      { id: 'swarmblade', name: 'Swarmblade', desc: "A reaper's arms, and longer.", tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Royal Scythe becomes Swarm Scythe: 34 power to a foe and every foe next to it.', ability: { id: 'swarm_scythe', replace: 'royal_scythe' } },
        { desc: 'Swarm Scythe becomes Reaping Swarm: it reaches 2 tiles, and leaves them Brittle.', ability: { id: 'reaping_swarm', replace: 'swarm_scythe' } }] }
    ],
    threats: ['sustain'],
    flavour: 'Two wardens and the reaper they kept, crowned: the comb is wherever she stands, and so is the harvest.'
  },
  {
    // Clockwork Page ×2 + Iron Golem: a 2×2 wall of gears whose slam Hexes a crowd, its works speeding the allies beside it.
    id: 'clockwork_titan',
    name: 'Clockwork Titan',
    kin: 'construct',
    role: 'vanguard',
    tier: 4,
    fused: true,
    size: 2,
    base: { hp: 506, atk: 27, def: 24 },
    growth: { hp: 49, atk: 3.2, def: 2.0 },
    abilities: ['piston_slam', 'strike'],
    move: 2,
    temper: TEMPERS.sieger,
    aura: { range: 1, desc: 'Allies next to it get +1 Move.', mods: [m('move', 'add', 1)] },
    tracks: [
      { id: 'bastion', name: 'Bastion', desc: 'A wall that locks the works of all about it.', tiers: [
        { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: 'Takes 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] },
        { desc: 'Learns Gear Lock: it Hexes every foe next to it for 2 turns.', ability: { id: 'gear_lock' } }] },
      { id: 'overdrive', name: 'Overdrive', desc: 'Faster works, and those beside it keep time.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+1 Move.', mods: [m('move', 'add', 1)] },
        { desc: 'Piston Slam becomes Steam Hammer: 30 power to a foe and everyone next to it, and leaves them Hexed.', ability: { id: 'steam_hammer', replace: 'piston_slam' } },
        { desc: 'Its aura reaches allies within 2 tiles.', aura: { range: 2, desc: 'Allies within 2 tiles get +1 Move.', mods: [m('move', 'add', 1)] } }] }
    ],
    threats: ['shape', 'drain'],
    flavour: 'Two pages wound the golem tighter than its makers dared, and climbed inside to keep it wound.'
  },
  {
    // Will-o'-Wisp ×3, the Wisp's written trine (`trineOf`): a flame on a crowd, and pale fire that Hexes, from 4 tiles.
    id: 'pale_court',
    name: 'Pale Court',
    kin: 'fae',
    role: 'channeler',
    tier: 3,
    fused: true,
    trineOf: 'will_o_wisp',
    base: { hp: 158, atk: 32, def: 4 },
    growth: { hp: 18, atk: 4.5, def: 0.4 },
    abilities: ['triune_flame', 'pale_fire'],
    move: 2,
    temper: TEMPERS.seeker,
    tracks: [
      { id: 'ghostlight', name: 'Ghostlight', desc: 'Its flames catch.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: 'Triune Flame becomes Pale Pyre: it leaves its targets Burning.', ability: { id: 'pale_pyre', replace: 'triune_flame' } },
        { desc: 'Pale Pyre becomes Danse Macabre: Burning on every foe within 4 tiles.', ability: { id: 'danse_macabre', replace: 'pale_pyre' } }] },
      { id: 'masque', name: 'Masque', desc: 'A court of veils, and a long summons.', tiers: [
        { desc: '+8% DEF.', mods: [m('def', 'mul', 1.08)] },
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: 'Gains an aura: allies within 2 tiles get +8% DEF.', aura: { range: 2, desc: 'Allies within 2 tiles get +8% DEF.', mods: [m('def', 'mul', 1.08)] } },
        { desc: 'Pale Fire becomes Court Summons: it reaches 6 tiles.', ability: { id: 'court_summons', replace: 'pale_fire' } }] }
    ],
    threats: ['reach', 'shape', 'drain'],
    flavour: 'Three wisps that led the lost into the same bog, and found one another there: now they hold court.'
  },
  // ── the capstones: fusions of fusions ──
  // Tier 5–6, each one recipe of two fused kinds; what their abilities and `aura` cannot say is a `rule` scoped to the
  // piece. HP and its growth about 1.1× the parts' sum, ATK 1.4× and DEF 1.1× the best part's. Pictures borrowed (`art`).
  {
    // Bone Colossus + the Grave Ghoul's trine: a wall whose blows heal it, a foe it slays beside it rising as yours.
    id: 'charnel_cathedral',
    name: 'Charnel Cathedral',
    kin: 'undead',
    role: 'vanguard',
    tier: 5,
    fused: true,
    size: 2,
    base: { hp: 945, atk: 51, def: 23 },
    growth: { hp: 99, atk: 7.1, def: 2.0 },
    abilities: ['charnel_sweep', 'feeding_strike'],
    move: 2,
    temper: TEMPERS.charger,
    aura: { range: 2, desc: 'Allies within 2 tiles take 15% less damage.', mods: [m('damage.taken', 'mul', 0.85)] },
    rule: 'charnel_cathedral',
    tracks: [
      { id: 'nave', name: 'Nave', desc: 'A thicker wall, a wider fold.', tiers: [
        { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: 'Takes 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] },
        { desc: 'Its aura reaches allies within 3 tiles.', aura: { range: 3, desc: 'Allies within 3 tiles take 15% less damage.', mods: [m('damage.taken', 'mul', 0.85)] } }] },
      { id: 'reliquary', name: 'Reliquary', desc: 'It feeds deeper.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Charnel Sweep becomes Bone Feast: every foe within 2 tiles, and it heals itself more.', ability: { id: 'bone_feast', replace: 'charnel_sweep' } },
        { desc: 'Feeding Strike becomes Marrow Feast: it bites a foe and every foe next to it, and heals itself once.', ability: { id: 'marrow_feast', replace: 'feeding_strike' } }] }
    ],
    threats: ['shape', 'sustain'],
    art: 'bone_colossus',
    flavour: 'A colossus that took in the ghouls that gnawed at it: now it eats as it fights, and what falls at its feet gets up again.'
  },
  {
    // Pale Court + the Frost Sprite's trine: Hex and Brittle on every foe within 4, its neighbours' skills back sooner.
    id: 'winter_court',
    name: 'Winter Court',
    kin: 'fae',
    role: 'channeler',
    tier: 5,
    fused: true,
    base: { hp: 414, atk: 58, def: 8 },
    growth: { hp: 46, atk: 7.8, def: 0.5 },
    abilities: ['long_winter', 'court_of_frost', 'winter_fire'],
    move: 2,
    temper: TEMPERS.seeker,
    tracks: [
      { id: 'snow_queen', name: 'Snow Queen', desc: 'A longer winter.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: 'Long Winter becomes Endless Winter: every foe within 5 tiles.', ability: { id: 'endless_winter', replace: 'long_winter' } },
        { desc: 'Winter Fire becomes Crown of Rime: it strikes a foe and everyone next to it, and leaves them Brittle.', ability: { id: 'crown_of_rime', replace: 'winter_fire' } }] },
      { id: 'ice_court', name: 'Court of Ice', desc: 'Its court keeps faster time.', tiers: [
        { desc: '+8% DEF.', mods: [m('def', 'mul', 1.08)] },
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: 'Gains an aura: allies within 2 tiles get +8% DEF.', aura: { range: 2, desc: 'Allies within 2 tiles get +8% DEF.', mods: [m('def', 'mul', 1.08)] } },
        { desc: 'Court of Frost becomes Court Eternal: every ally within 4 tiles has its skills a turn sooner, and gains Barkskin.', ability: { id: 'court_eternal', replace: 'court_of_frost' } }] }
    ],
    threats: ['reach', 'drain', 'shape'],
    art: 'pale_court',
    flavour: 'When the court took in the sprites it learnt to keep winter: everything near it slows, and everything of its own quickens.'
  },
  {
    // Rime Drake + the Pyre Hound's trine: a flyer burning a crowd from 5 tiles, a foe it slays setting those beside alight.
    id: 'cinder_wyrm',
    name: 'Cinder Wyrm',
    kin: 'drake',
    role: 'ranger',
    tier: 5,
    fused: true,
    flies: true,
    base: { hp: 657, atk: 58, def: 11 },
    growth: { hp: 70, atk: 8.1, def: 1.0 },
    abilities: ['cinder_storm', 'wyrm_fire'],
    move: 3,
    temper: TEMPERS.crowd,
    rule: 'cinder_wyrm',
    tracks: [
      { id: 'firestorm', name: 'Firestorm', desc: 'Longer fires.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Cinder Storm becomes Firestorm: its Burning lasts 4 turns.', ability: { id: 'firestorm', replace: 'cinder_storm' } },
        { desc: 'Learns Ember Rain: Burning for 4 turns on every foe within 4 tiles.', ability: { id: 'ember_rain' } }] },
      { id: 'skyborne', name: 'Skyborne', desc: 'Burns from higher.', tiers: [
        { desc: '+8% DEF.', mods: [m('def', 'mul', 1.08)] },
        { desc: '+1 Move.', mods: [m('move', 'add', 1)] },
        { desc: '+20% damage dealt with no foe next to it.', mods: [m('damage.dealt', 'mul', 1.2, 'free')] },
        { desc: 'Learns Sky Pyre: 36 power and Burning, on a foe anywhere on the board.', ability: { id: 'sky_pyre', at: 1 } }] }
    ],
    threats: ['fly', 'burn', 'shape'],
    art: 'ash_wyvern',
    flavour: 'The drake took the hounds into its belly and never cooled: it flies over the walls, and where its dead fall the ground catches.'
  },
  {
    // Hive Queen + the Hive Drone's trine: it mends every ally, hatches drones each wave, and a kill readies its skills.
    id: 'hive_mind',
    name: 'Hive Mind',
    kin: 'insect',
    role: 'warden',
    tier: 5,
    fused: true,
    size: 2,
    base: { hp: 688, atk: 47, def: 16 },
    growth: { hp: 71, atk: 6.6, def: 1.5 },
    abilities: ['hive_chorus', 'hive_scythe', 'strike'],
    move: 2,
    temper: TEMPERS.keeper,
    rule: 'hive_mind',
    tracks: [
      { id: 'overmind', name: 'Overmind', desc: 'The whole hive is one body.', tiers: [
        { desc: '+25% healing given.', mods: [m('heal.given', 'mul', 1.25)] },
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: 'Gains an aura: allies within 2 tiles take 10% less damage.', aura: { range: 2, desc: 'Allies within 2 tiles take 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] } },
        { desc: 'Hive Chorus becomes Hive Song: it heals every ally and strips a debuff from each.', ability: { id: 'hive_song', replace: 'hive_chorus' } }] },
      { id: 'swarm_crown', name: 'Swarm Crown', desc: 'The harvest goes wider.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Hive Scythe becomes Swarm Reap: it reaches 2 tiles.', ability: { id: 'swarm_reap', replace: 'hive_scythe' } },
        { desc: 'Learns Sting Storm: Withers every foe within 3 tiles.', ability: { id: 'sting_storm' } }] }
    ],
    threats: ['sustain', 'shape'],
    art: 'hive_queen',
    flavour: 'The queen stopped laying and started thinking: every drone is a thought of hers, and every wound of yours is hers to close.'
  },
  {
    // Clockwork Titan + the Clockwork Page's trine: it Hexes all it touches, and stands at 1 HP once a battle.
    id: 'engine_of_ages',
    name: 'Engine of Ages',
    kin: 'construct',
    role: 'vanguard',
    tier: 5,
    fused: true,
    size: 2,
    base: { hp: 860, atk: 47, def: 26 },
    growth: { hp: 85, atk: 6.6, def: 2.2 },
    abilities: ['time_lock', 'gear_strike'],
    move: 2,
    temper: TEMPERS.sieger,
    aura: { range: 1, desc: 'Allies next to it get +1 Move.', mods: [m('move', 'add', 1)] },
    rule: 'engine_of_ages',
    tracks: [
      { id: 'mainspring', name: 'Mainspring', desc: 'Wound to outlast anything.', tiers: [
        { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: 'Takes 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] },
        { desc: 'Learns Still Hour: it Hexes every foe within 2 tiles.', ability: { id: 'still_hour' } }] },
      { id: 'escapement', name: 'Escapement', desc: 'Its time, and its allies\', run faster.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+1 Move.', mods: [m('move', 'add', 1)] },
        { desc: 'Time Lock becomes Time Stop: every foe within 2 tiles.', ability: { id: 'time_stop', replace: 'time_lock' } },
        { desc: 'Its aura reaches allies within 2 tiles.', aura: { range: 2, desc: 'Allies within 2 tiles get +1 Move.', mods: [m('move', 'add', 1)] } }] }
    ],
    threats: ['shape', 'drain'],
    art: 'clockwork_titan',
    flavour: 'Three pages climbed into the titan to keep it wound, and wound it until the hours themselves stuck in its gears.'
  },
  {
    // Pale Court + Rime Drake: fire and frost, a blast that burns and Hexes from four tiles off.
    id: 'aurora',
    name: 'Aurora',
    kin: 'fae',
    role: 'ranger',
    tier: 5,
    fused: true,
    base: { hp: 459, atk: 52, def: 10 },
    growth: { hp: 50, atk: 6.8, def: 1.0 },
    abilities: ['aurora_blast', 'frostfire_lance'],
    move: 2,
    temper: TEMPERS.crowd,
    tracks: [
      { id: 'borealis', name: 'Borealis', desc: 'A wider sky.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Aurora Blast becomes Corona: it reaches 5 tiles.', ability: { id: 'corona', replace: 'aurora_blast' } },
        { desc: 'Corona becomes Solar Wind: Burning and Hexed on every foe within 5 tiles.', ability: { id: 'solar_wind', replace: 'corona' } }] },
      { id: 'polar_night', name: 'Polar Night', desc: 'A colder, surer lance.', tiers: [
        { desc: '+8% DEF.', mods: [m('def', 'mul', 1.08)] },
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: '+20% damage dealt with no foe next to it.', mods: [m('damage.dealt', 'mul', 1.2, 'free')] },
        { desc: 'Frostfire Lance becomes Polar Lance: 40 power, and leaves it Hexed and Burning.', ability: { id: 'polar_lance', replace: 'frostfire_lance' } }] }
    ],
    threats: ['reach', 'burn', 'drain', 'shape'],
    art: 'rime_drake',
    flavour: 'The court rode the drake into the high cold, and came down as the lights that hang over the ice.'
  },
  {
    // Bone Colossus + Clockwork Titan: the heaviest piece, tier 6, a tile a turn, a wall that shelters all about it.
    id: 'iron_barrow',
    name: 'Iron Barrow',
    kin: 'undead',
    role: 'vanguard',
    tier: 6,
    fused: true,
    size: 2,
    base: { hp: 1224, atk: 43, def: 30 },
    growth: { hp: 118, atk: 5.4, def: 2.4 },
    abilities: ['barrow_quake', 'strike'],
    move: 1,
    temper: TEMPERS.charger,
    aura: { range: 2, desc: 'Allies within 2 tiles take 15% less damage.', mods: [m('damage.taken', 'mul', 0.85)] },
    tracks: [
      { id: 'mausoleum', name: 'Mausoleum', desc: 'Heavier still.', tiers: [
        { desc: '+20% DEF.', mods: [m('def', 'mul', 1.2)] },
        { desc: '+20% max HP.', mods: [m('hp', 'mul', 1.2)] },
        { desc: 'Takes 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] },
        { desc: 'Its aura reaches allies within 3 tiles.', aura: { range: 3, desc: 'Allies within 3 tiles take 15% less damage.', mods: [m('damage.taken', 'mul', 0.85)] } }] },
      { id: 'iron_tomb', name: 'Iron Tomb', desc: 'It falls on what it fights.', tiers: [
        { desc: '+15% ATK.', mods: [m('atk', 'mul', 1.15)] },
        { desc: '+10% ATK.', mods: [m('atk', 'mul', 1.1)] },
        { desc: 'Barrow Quake becomes Iron Quake: it leaves them Hexed too.', ability: { id: 'iron_quake', replace: 'barrow_quake' } },
        { desc: 'Learns Tomb Fall: every foe within 2 tiles, left Brittle.', ability: { id: 'tomb_fall' } }] }
    ],
    threats: ['shape', 'sustain'],
    art: 'iron_golem',
    flavour: 'A barrow of bone with an engine for a heart: it moves a tile a turn, and nothing it stands before moves at all.'
  },
  {
    // The last floor's boss: its phases and its override (`rule`) on top of its temperament: its court moves before every
    // other foe, and once its tide has come it calls Grave Tide on a fixed cadence. Bosses never spawn, leave no soul.
    id: 'hollow_sovereign',
    name: 'The Hollow Sovereign',
    kin: 'undead',
    role: 'vanguard',
    tier: 5,
    lock: { keys: ['brittle', 'burning', 'hexed'], share: 0.3 },
    boss: true,
    last: true,
    base: { hp: 2800, atk: 65, def: 30 },
    growth: { hp: 280, atk: 6.5, def: 2 },
    abilities: ['grave_tide', 'sovereign_sweep', 'strike'],
    move: 2,
    temper: TEMPERS.court,
    phases: [{ at: 0.6, grant: 'enraged' }, { at: 0.25, grant: 'desperate' }],
    rule: 'sovereign',
    court: { kin: 'undead' },
    threats: ['shape', 'sustain'],
    behaviour: 'walk',
    flavour: 'It does not fight alone: its court walks with it, and the dead of the field rise at its tide. Without it, they are dust.'
  },
  // ── the floor bosses ──
  // A boss ends each floor but the last: of those tagged with the floor (`floors`), the one that answers what the army
  // leans on most as the floor opens (`answers`), a tie drawn by the seed. Its counter is in its kit, temper and court,
  // and a `rule` where they cannot say it; its HP and ATK × TUNING.spawn.bossHp and bossAtk. Pictures borrowed (`art`).
  {
    // Against casters: Mire Hexes every foe within 3 and Hex one from 3, its court of hags Hexes too; it hunts the one
    // with the most left to give; at half HP, Enraged.
    id: 'mire_mother',
    name: 'The Mire Mother',
    kin: 'fae',
    role: 'channeler',
    tier: 4,
    lock: { keys: ['brittle', 'burning'], share: 0.3 },
    boss: true,
    floors: [1, 2],
    answers: 'casters',
    base: { hp: 300, atk: 22, def: 8 },
    growth: { hp: 30, atk: 2.6, def: 0.7 },
    abilities: ['mire', 'hex', 'witchfire'],
    move: 2,
    temper: TEMPERS.hexer,
    phases: [{ at: 0.5, grant: 'enraged' }],
    court: { kinds: ['marsh_hag'] },
    threats: ['reach', 'drain'],
    behaviour: 'walk',
    art: 'marsh_hag',
    flavour: 'The hags call her mother, and the bog minds her before it minds them: whatever has the most to give near her is the first to find its feet held.'
  },
  {
    // Against statuses: it sheds its debuffs as the foes' turn begins, Molts its court within 2 and Purges one of them as
    // its basic; its court purges as it fights; at half HP, Regen.
    id: 'molting_abbess',
    name: 'The Molting Abbess',
    kin: 'insect',
    role: 'warden',
    tier: 4,
    lock: { keys: ['brittle', 'burning'], share: 0.3 },
    boss: true,
    floors: [1, 2],
    answers: 'statuses',
    base: { hp: 420, atk: 18, def: 18 },
    growth: { hp: 42, atk: 2.1, def: 1.5 },
    abilities: ['molt', 'purge', 'royal_scythe'],
    move: 2,
    temper: TEMPERS.court,
    phases: [{ at: 0.5, grant: 'regen' }],
    rule: 'molting_abbess',
    court: { kinds: ['hive_warden', 'clockwork_page'] },
    threats: ['sustain', 'drain'],
    behaviour: 'walk',
    art: 'hive_warden',
    flavour: 'Every curse laid on the abbess is a skin she has already outgrown, and her sisters pick clean whatever she sheds.'
  },
  {
    // Against shooters: its court of vanguards stands ahead of it, and while it stands a shot at one of its side but a
    // Vanguard lands on a Vanguard beside it; it shoots from 5, its spear down a lane; at 40% HP, Desperate.
    id: 'barrow_marshal',
    name: 'The Barrow Marshal',
    kin: 'undead',
    role: 'ranger',
    tier: 4,
    lock: { keys: ['brittle', 'burning'], share: 0.3 },
    boss: true,
    floors: [1, 2],
    answers: 'shooters',
    base: { hp: 380, atk: 24, def: 14 },
    growth: { hp: 38, atk: 2.8, def: 1.2 },
    abilities: ['marrow_spear', 'searing_bolt'],
    move: 2,
    temper: TEMPERS.shooter,
    phases: [{ at: 0.4, grant: 'desperate' }],
    rule: 'barrow_marshal',
    court: { role: 'vanguard', front: true },
    threats: ['reach', 'shape'],
    behaviour: 'walk',
    art: 'barrow_wight',
    flavour: 'The marshal never stood in a line it could stand behind: its dead close ranks about it, and every arrow meets a shield first.'
  },
  {
    // Against walls: it flies at the Monarch with a court of drones, more hatching every second turn; its sting Withers,
    // its cloud stings a crowd; at half HP, Enraged.
    id: 'swarm_queen',
    name: 'The Swarm Queen',
    kin: 'insect',
    role: 'skirmisher',
    tier: 4,
    lock: { keys: ['brittle', 'burning'], share: 0.3 },
    boss: true,
    floors: [1, 2],
    answers: 'walls',
    flies: true,
    base: { hp: 280, atk: 22, def: 6 },
    growth: { hp: 28, atk: 2.6, def: 0.5 },
    abilities: ['swarm_cloud', 'venom_sting'],
    move: 3,
    temper: TEMPERS.seeker,
    phases: [{ at: 0.5, grant: 'enraged' }],
    rule: 'swarm_queen',
    court: { kinds: ['hive_drone'] },
    threats: ['fly', 'drain'],
    behaviour: 'fly',
    art: 'hive_drone',
    flavour: 'Walls are built against what walks. Her brood never learnt to: it comes over them, and while she lives it keeps hatching.'
  }
]

// ── abilities ────────────────────────────────────────────────────────────────────────────────

// An ability is ops, a shape and an anim; a new one that composes them is one record.
//   `effects`: damage (`power`); heal (`power`, or `pct` of max HP; `self` mends the caster); cleanse (`count` of `tag`);
//   apply_status (`status`, `turns` where not the status's own; none on a miss); raise (corpses as shadows); cooldown
//   (`amount` turns on every cooldown of its target). `shape`: single, ally, self, row, column (its lane), blast (the
//   target and its neighbours), all, all_allies (within `range`), corpse (Arise's).
//   Reach, from the caster's footprint: ranged its `range` (none: the whole board); melee (`melee`) its `range`, else its
//   kind's arm, never a flyer unless the caster flies. A ranged single-target blow hits the first piece of the target's
//   side in its way unless it arcs (`arc`). Basics are usable every turn; any other ability is a skill that rests
//   (`cooldown`, 2 by default). `when(s)` (s: the living { self, allies, enemies }) only where the condition is the rule.
const hpPct = (u) => u.hp / u.maxHp

const ABILITY_LIST = [
  {
    // The skill an Arise relic gives its holder: a corpse within Arise's reach, of a tier Arise allows, rises as a shadow
    // of yours; usable every turn (cooldown 1).
    id: 'arise',
    name: 'Arise',
    shape: 'corpse',
    cooldown: 1,
    tint: '#c8f5d2',
    anim: 'cast_beam',
    effects: [{ op: 'raise' }]
  },
  { id: 'strike', name: 'Strike', shape: 'single', melee: true, tint: '#d8d4cc', anim: 'melee_lunge', effects: [{ op: 'damage', power: 30, keyed: { status: 'brittle', mul: 2 } }] },
  { id: 'cleave', name: 'Cleave', shape: 'row', melee: true, tint: '#d8d4cc', anim: 'melee_lunge', effects: [{ op: 'damage', power: 22, keyed: { status: 'brittle', mul: 2 } }] },
  {
    id: 'marrow_bolt',
    name: 'Marrow Bolt',
    shape: 'single',
    range: 4,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    effects: [
      { op: 'damage', power: 34 },
      { op: 'apply_status', status: 'brittle' }
    ]
  },
  { id: 'dirge', name: 'Dirge', shape: 'all_allies', range: 2, tint: '#7a5c9e', anim: 'cast_beam', effects: [{ op: 'apply_status', status: 'hasten' }] },
  { id: 'ember_burst', name: 'Ember Burst', shape: 'blast', range: 4, tint: '#ff7a33', anim: 'ranged_bolt', effects: [{ op: 'damage', power: 26, keyed: { status: 'brittle', mul: 2 } }] },
  { id: 'frost_lance', name: 'Frost Lance', shape: 'single', range: 3, tint: '#66c8ff', anim: 'ranged_bolt', effects: [{ op: 'damage', power: 30, keyed: { status: 'brittle', mul: 2 } }] },
  { id: 'mend', name: 'Mend', shape: 'ally', tint: '#ffe9a8', anim: 'cast_beam', effects: [{ op: 'heal', power: 28 }, { op: 'apply_status', status: 'regen' }] },
  { id: 'purge', name: 'Purge', shape: 'ally', tint: '#ffe9a8', anim: 'cast_beam', effects: [{ op: 'cleanse', tag: 'debuff', count: 2 }, { op: 'heal', power: 8 }] },
  {
    id: 'gnaw',
    name: 'Gnaw',
    shape: 'single',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [
      { op: 'damage', power: 30, keyed: { status: 'hexed', mul: 2 } },
      { op: 'apply_status', status: 'brittle', turns: 2 }
    ]
  },
  { id: 'witchfire', name: 'Witchfire', shape: 'single', range: 4, tint: '#b57bff', anim: 'cast_beam', effects: [{ op: 'damage', power: 30, keyed: { status: 'burning', mul: 2 } }] },
  { id: 'barkskin', name: 'Barkskin', shape: 'all_allies', range: 2, tint: '#ffe9a8', anim: 'cast_beam', effects: [{ op: 'apply_status', status: 'barkskin' }] },
  {
    id: 'reap',
    name: 'Reap',
    shape: 'single',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 42 }, { op: 'apply_status', status: 'bleeding' }]
  },
  {
    id: 'quake',
    name: 'Quake',
    shape: 'blast',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 20 }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'wither',
    name: 'Wither',
    shape: 'single',
    range: 3,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    effects: [
      { op: 'damage', power: 34 },
      { op: 'apply_status', status: 'withered' }
    ]
  },
  { id: 'glacial_breath', name: 'Glacial Breath', shape: 'column', range: 3, tint: '#66c8ff', anim: 'ranged_bolt', effects: [{ op: 'damage', power: 30, keyed: { status: 'brittle', mul: 2 } }] },
  { id: 'sovereign_sweep', name: 'Sovereign Sweep', shape: 'row', melee: true, tint: '#d8d4cc', anim: 'melee_lunge', effects: [{ op: 'damage', power: 26 }] },
  {
    id: 'grave_tide',
    name: 'Grave Tide',
    shape: 'blast',
    tint: '#7a5c9e',
    anim: 'cast_beam',
    when: (s) => hpPct(s.self) <= 0.6,
    cond: 'once it is at 60% HP or less',
    effects: [
      { op: 'damage', power: 44 },
      { op: 'apply_status', status: 'brittle' },
      { op: 'raise', count: 2 }
    ]
  },
  // ── abilities a track grants ──
  { id: 'requiem', name: 'Requiem', shape: 'all_allies', range: 3, tint: '#7a5c9e', anim: 'cast_beam', effects: [{ op: 'apply_status', status: 'hasten', turns: 3 }] },
  {
    id: 'marrow_spear',
    name: 'Marrow Spear',
    shape: 'column',
    range: 4,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    id: 'rending_strike',
    name: 'Rending Strike',
    shape: 'single',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 36 }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    id: 'inferno',
    name: 'Inferno',
    shape: 'blast',
    range: 4,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 32 }, { op: 'apply_status', status: 'burning' }]
  },
  { id: 'searing_bolt', name: 'Searing Bolt', shape: 'single', range: 5, tint: '#ff7a33', anim: 'ranged_bolt', effects: [{ op: 'damage', power: 34, keyed: { status: 'hexed', mul: 2 } }] },
  {
    id: 'shatter_lance',
    name: 'Shatter Lance',
    shape: 'single',
    range: 3,
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 38 }, { op: 'apply_status', status: 'brittle', turns: 2 }]
  },
  {
    id: 'hoarfrost',
    name: 'Hoarfrost',
    shape: 'blast',
    range: 3,
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 18 }, { op: 'apply_status', status: 'hexed' }]
  },
  { id: 'swarm_mend', name: 'Swarm Mend', shape: 'all_allies', range: 2, tint: '#ffe9a8', anim: 'cast_beam', effects: [{ op: 'heal', power: 18 }] },
  {
    id: 'spanner',
    name: 'Spanner in the Works',
    shape: 'single',
    melee: true,
    tint: '#b57bff',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'overclock',
    name: 'Overclock',
    shape: 'ally',
    tint: '#b57bff',
    anim: 'cast_beam',
    effects: [{ op: 'apply_status', status: 'hasten' }, { op: 'cleanse', tag: 'debuff', count: 1 }]
  },
  {
    id: 'devour',
    name: 'Devour',
    shape: 'single',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 34, keyed: { status: 'hexed', mul: 2 } }, { op: 'heal', power: 20, self: true }]
  },
  { id: 'wildfire', name: 'Wildfire', shape: 'blast', range: 4, tint: '#b57bff', anim: 'cast_beam', effects: [{ op: 'damage', power: 24, keyed: { status: 'burning', mul: 2 } }] },
  { id: 'bloom', name: 'Bloom', shape: 'ally', tint: '#ffe9a8', anim: 'cast_beam', effects: [{ op: 'heal', power: 34 }, { op: 'apply_status', status: 'regen' }] },
  { id: 'thorn_lash', name: 'Thorn Lash', shape: 'row', melee: true, tint: '#ffe9a8', anim: 'melee_lunge', effects: [{ op: 'damage', power: 20, keyed: { status: 'burning', mul: 2 } }] },
  { id: 'execute', name: 'Execute', shape: 'single', melee: true, tint: '#d8d4cc', anim: 'melee_lunge', effects: [{ op: 'damage', power: 48, keyed: { status: 'bleeding', mul: 3 } }] },
  {
    id: 'earthshatter',
    name: 'Earthshatter',
    shape: 'blast',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 26 }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'soul_drain',
    name: 'Soul Drain',
    shape: 'single',
    range: 3,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 34, keyed: { status: 'withered', mul: 2 } }, { op: 'heal', power: 20, self: true }]
  },
  {
    id: 'dread_wail',
    name: 'Dread Wail',
    shape: 'blast',
    range: 3,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 16 }, { op: 'apply_status', status: 'withered' }]
  },
  { id: 'blizzard', name: 'Blizzard', shape: 'row', range: 3, tint: '#66c8ff', anim: 'ranged_bolt', effects: [{ op: 'damage', power: 26, keyed: { status: 'hexed', mul: 2 } }] },
  // ── abilities a tier IV grants ──
  {
    id: 'dirge_unending',
    name: 'Dirge Unending',
    shape: 'all_allies',
    range: 3,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    effects: [{ op: 'apply_status', status: 'hasten', turns: 'battle' }]
  },
  {
    // `all` with a range: every foe within it of the caster.
    id: 'bone_storm',
    name: 'Bone Storm',
    shape: 'all',
    range: 4,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 16 }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    id: 'reaving_cleave',
    name: 'Reaving Cleave',
    shape: 'row',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 22 }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    id: 'cataclysm',
    name: 'Cataclysm',
    shape: 'blast',
    range: 5,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 32 }, { op: 'apply_status', status: 'burning' }, { op: 'apply_status', status: 'withered' }]
  },
  {
    // No range: it reaches the whole board, falling from above (`arc`): no piece in the way takes it.
    id: 'skyfall',
    name: 'Skyfall',
    shape: 'single',
    arc: true,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 34, keyed: { status: 'burning', mul: 2 } }]
  },
  {
    id: 'glacier_lance',
    name: 'Glacier Lance',
    shape: 'column',
    range: 3,
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 34 }, { op: 'apply_status', status: 'brittle', turns: 2 }]
  },
  {
    id: 'deep_winter',
    name: 'Deep Winter',
    shape: 'all',
    range: 3,
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 12 }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'brood_surge',
    name: 'Brood Surge',
    shape: 'all_allies',
    range: 3,
    tint: '#ffe9a8',
    anim: 'cast_beam',
    effects: [{ op: 'heal', power: 18 }, { op: 'apply_status', status: 'regen' }]
  },
  { id: 'molt', name: 'Molt', shape: 'all_allies', range: 2, tint: '#ffe9a8', anim: 'cast_beam', effects: [{ op: 'cleanse', tag: 'debuff', count: 3 }] },
  {
    id: 'wrench',
    name: 'Wrench the Works',
    shape: 'single',
    melee: true,
    tint: '#b57bff',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'hexed', turns: 2 }]
  },
  {
    id: 'perpetual_motion',
    name: 'Perpetual Motion',
    shape: 'all_allies',
    range: 2,
    tint: '#b57bff',
    anim: 'cast_beam',
    effects: [{ op: 'apply_status', status: 'hasten' }, { op: 'cleanse', tag: 'debuff', count: 1 }]
  },
  {
    id: 'gorge',
    name: 'Gorge',
    shape: 'blast',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30, keyed: { status: 'hexed', mul: 2 } }, { op: 'heal', power: 24, self: true }]
  },
  { id: 'conflagration', name: 'Conflagration', shape: 'all', range: 4, tint: '#b57bff', anim: 'cast_beam', effects: [{ op: 'damage', power: 18, keyed: { status: 'burning', mul: 2 } }] },
  { id: 'veil', name: 'Veil', shape: 'all_allies', range: 2, tint: '#b57bff', anim: 'cast_beam', effects: [{ op: 'apply_status', status: 'barkskin' }] },
  {
    id: 'verdant_bloom',
    name: 'Verdant Bloom',
    shape: 'all_allies',
    range: 2,
    tint: '#ffe9a8',
    anim: 'cast_beam',
    effects: [{ op: 'heal', power: 26 }, { op: 'apply_status', status: 'regen' }]
  },
  {
    id: 'briar_lash',
    name: 'Briar Lash',
    shape: 'row',
    range: 2,
    tint: '#ffe9a8',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 20, keyed: { status: 'burning', mul: 2 } }, { op: 'apply_status', status: 'brittle' }]
  },
  { id: 'harvest', name: 'Harvest', shape: 'blast', melee: true, tint: '#d8d4cc', anim: 'melee_lunge', effects: [{ op: 'damage', power: 40, keyed: { status: 'bleeding', mul: 3 } }] },
  { id: 'phantom_edge', name: 'Phantom Edge', shape: 'single', range: 3, tint: '#b57bff', anim: 'ranged_bolt', effects: [{ op: 'damage', power: 34, keyed: { status: 'hexed', mul: 2 } }] },
  {
    id: 'worldbreaker',
    name: 'Worldbreaker',
    shape: 'row',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 24 }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'soul_harvest',
    name: 'Soul Harvest',
    shape: 'blast',
    range: 3,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 28, keyed: { status: 'withered', mul: 2 } }, { op: 'heal', power: 24, self: true }]
  },
  {
    id: 'death_knell',
    name: 'Death Knell',
    shape: 'all',
    range: 3,
    tint: '#7a5c9e',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 14 }, { op: 'apply_status', status: 'withered' }]
  },
  {
    id: 'ice_age',
    name: 'Ice Age',
    shape: 'all',
    range: 3,
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 22 }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    // No range, cast on its target (`arc`); its condition is its rule, an execute: a foe below half HP.
    id: 'killing_cold',
    name: 'Killing Cold',
    shape: 'single',
    arc: true,
    tint: '#66c8ff',
    anim: 'ranged_bolt',
    when: (s) => s.enemies.some((u) => hpPct(u) < 0.5),
    cond: 'once a foe is below half HP',
    effects: [{ op: 'damage', power: 40, keyed: { status: 'hexed', mul: 2 } }]
  },
  // ── the foes of the deeper floors, and the fused kinds ──
  {
    id: 'pyre_bite',
    name: 'Pyre Bite',
    shape: 'single',
    melee: true,
    tint: '#ff7a33',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 26, keyed: { status: 'brittle', mul: 2 } }, { op: 'apply_status', status: 'burning', turns: 2 }]
  },
  { id: 'drone_sting', name: 'Sting', shape: 'single', melee: true, tint: '#d8d4cc', anim: 'melee_lunge', effects: [{ op: 'damage', power: 24, keyed: { status: 'withered', mul: 2 } }] },
  // The simple floor-1 kinds' shots, three tiles long at one foe, each its kind's basic, and the tiers that sharpen them.
  { id: 'ember_spit', name: 'Ember Spit', shape: 'single', range: 3, tint: '#ff7a33', anim: 'ranged_bolt', effects: [{ op: 'damage', power: 30, keyed: { status: 'hexed', mul: 2 } }] },
  { id: 'brass_bolt', name: 'Brass Bolt', shape: 'single', range: 3, tint: '#c9a45c', anim: 'ranged_bolt', effects: [{ op: 'damage', power: 30, keyed: { status: 'brittle', mul: 2 } }] },
  { id: 'long_bolt', name: 'Long Bolt', shape: 'single', range: 4, tint: '#c9a45c', anim: 'ranged_bolt', effects: [{ op: 'damage', power: 34, keyed: { status: 'hexed', mul: 2 } }] },
  { id: 'piercing_bolt', name: 'Piercing Bolt', shape: 'column', range: 4, tint: '#c9a45c', anim: 'ranged_bolt', effects: [{ op: 'damage', power: 30, keyed: { status: 'brittle', mul: 2 } }] },
  { id: 'acid_spit', name: 'Acid Spit', shape: 'single', range: 3, tint: '#9bd14a', anim: 'ranged_bolt', effects: [{ op: 'damage', power: 30, keyed: { status: 'brittle', mul: 2 } }] },
  {
    id: 'venom_spit',
    name: 'Venom Spit',
    shape: 'single',
    range: 3,
    tint: '#9bd14a',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'withered' }]
  },
  {
    id: 'bile',
    name: 'Bile',
    shape: 'single',
    melee: true,
    tint: '#9bc25a',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 24 }, { op: 'apply_status', status: 'withered' }]
  },
  {
    id: 'hex',
    name: 'Hex',
    shape: 'single',
    range: 3,
    tint: '#9b6cd8',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 26 }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'cinder_breath',
    name: 'Cinder Breath',
    shape: 'blast',
    range: 2,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 22 }, { op: 'apply_status', status: 'burning' }]
  },
  {
    // Every foe within 1 of its footprint.
    id: 'colossal_sweep',
    name: 'Colossal Sweep',
    shape: 'all',
    range: 1,
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 26 }]
  },
  {
    id: 'rimefire',
    name: 'Rimefire',
    shape: 'blast',
    range: 4,
    tint: '#9ad8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 26 }, { op: 'apply_status', status: 'burning' }]
  },
  {
    id: 'royal_jelly',
    name: 'Royal Jelly',
    shape: 'all_allies',
    range: 2,
    tint: '#ffe9a8',
    anim: 'cast_beam',
    effects: [{ op: 'heal', power: 20 }, { op: 'apply_status', status: 'regen' }]
  },
  {
    id: 'royal_scythe',
    name: 'Royal Scythe',
    shape: 'single',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 44 }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    id: 'piston_slam',
    name: 'Piston Slam',
    shape: 'blast',
    melee: true,
    tint: '#b57bff',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 24 }, { op: 'apply_status', status: 'hexed' }]
  },
  { id: 'triune_flame', name: 'Triune Flame', shape: 'blast', range: 4, tint: '#b57bff', anim: 'cast_beam', effects: [{ op: 'damage', power: 24 }] },
  {
    id: 'pale_fire',
    name: 'Pale Fire',
    shape: 'single',
    range: 4,
    tint: '#cfe3ff',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'hexed' }]
  },
  // ── abilities their tracks grant ──
  {
    id: 'cinder_fang',
    name: 'Cinder Fang',
    shape: 'single',
    melee: true,
    tint: '#ff7a33',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 34 }, { op: 'apply_status', status: 'burning', turns: 5 }]
  },
  {
    id: 'hellmaw',
    name: 'Hellmaw',
    shape: 'blast',
    melee: true,
    tint: '#ff7a33',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'burning', turns: 5 }]
  },
  {
    id: 'cinder_spit',
    name: 'Cinder Spit',
    shape: 'single',
    range: 3,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 26 }, { op: 'apply_status', status: 'burning' }]
  },
  {
    id: 'venom_sting',
    name: 'Venom Sting',
    shape: 'single',
    melee: true,
    tint: '#9bc25a',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'withered' }]
  },
  {
    id: 'hexing_sting',
    name: 'Hexing Sting',
    shape: 'single',
    melee: true,
    tint: '#9b6cd8',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'withered' }, { op: 'apply_status', status: 'hexed' }]
  },
  { id: 'swarm_cloud', name: 'Swarm Cloud', shape: 'blast', melee: true, tint: '#d8d4cc', anim: 'melee_lunge', effects: [{ op: 'damage', power: 22, keyed: { status: 'withered', mul: 2 } }] },
  {
    id: 'spew',
    name: 'Spew',
    shape: 'blast',
    melee: true,
    tint: '#9bc25a',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 22, keyed: { status: 'withered', mul: 2 } }, { op: 'apply_status', status: 'withered' }]
  },
  {
    id: 'miasma',
    name: 'Miasma',
    shape: 'all',
    range: 2,
    tint: '#9bc25a',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 12 }, { op: 'apply_status', status: 'withered' }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'bog_curse',
    name: 'Bog Curse',
    shape: 'single',
    range: 3,
    tint: '#9b6cd8',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'hexed' }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    id: 'mire',
    name: 'Mire',
    shape: 'all',
    range: 3,
    tint: '#9b6cd8',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 12 }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'long_curse',
    name: 'Long Curse',
    shape: 'single',
    range: 5,
    tint: '#9b6cd8',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 28 }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'ashfall',
    name: 'Ashfall',
    shape: 'blast',
    range: 3,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 26 }, { op: 'apply_status', status: 'burning' }]
  },
  {
    id: 'pyre_rain',
    name: 'Pyre Rain',
    shape: 'all',
    range: 3,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 16 }, { op: 'apply_status', status: 'burning', turns: 4 }]
  },
  {
    id: 'ember_lance',
    name: 'Ember Lance',
    shape: 'single',
    range: 4,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 34 }, { op: 'apply_status', status: 'burning' }]
  },
  {
    id: 'bone_quake',
    name: 'Bone Quake',
    shape: 'all',
    range: 1,
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 26 }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'grave_breaker',
    name: 'Grave Breaker',
    shape: 'all',
    range: 2,
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 26 }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    id: 'rimestorm',
    name: 'Rimestorm',
    shape: 'blast',
    range: 5,
    tint: '#9ad8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 28 }, { op: 'apply_status', status: 'burning' }]
  },
  {
    id: 'equinox',
    name: 'Equinox',
    shape: 'all',
    range: 5,
    tint: '#9ad8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 16 }, { op: 'apply_status', status: 'hexed' }, { op: 'apply_status', status: 'burning' }]
  },
  {
    id: 'kindled_lance',
    name: 'Kindled Lance',
    shape: 'single',
    range: 3,
    tint: '#9ad8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 38 }, { op: 'apply_status', status: 'hexed' }, { op: 'apply_status', status: 'burning' }]
  },
  {
    id: 'hive_mind',
    name: 'Hive Mind',
    shape: 'all_allies',
    range: 3,
    tint: '#ffe9a8',
    anim: 'cast_beam',
    effects: [{ op: 'heal', power: 22 }, { op: 'cleanse', tag: 'debuff', count: 1 }]
  },
  { id: 'swarm_scythe', name: 'Swarm Scythe', shape: 'blast', melee: true, tint: '#d8d4cc', anim: 'melee_lunge', effects: [{ op: 'damage', power: 34 }] },
  {
    // A long arm of its own (`range` 2, past the kind's arm of 1) from her footprint, and still no flyer.
    id: 'reaping_swarm',
    name: 'Reaping Swarm',
    shape: 'blast',
    range: 2,
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 34 }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    id: 'steam_hammer',
    name: 'Steam Hammer',
    shape: 'blast',
    melee: true,
    tint: '#b57bff',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'gear_lock',
    name: 'Gear Lock',
    shape: 'all',
    range: 1,
    melee: true,
    tint: '#b57bff',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 10 }, { op: 'apply_status', status: 'hexed', turns: 2 }]
  },
  {
    id: 'pale_pyre',
    name: 'Pale Pyre',
    shape: 'blast',
    range: 4,
    tint: '#b57bff',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 24 }, { op: 'apply_status', status: 'burning' }]
  },
  {
    id: 'danse_macabre',
    name: 'Danse Macabre',
    shape: 'all',
    range: 4,
    tint: '#b57bff',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 16 }, { op: 'apply_status', status: 'burning' }]
  },
  {
    id: 'court_summons',
    name: 'Court Summons',
    shape: 'single',
    range: 6,
    tint: '#cfe3ff',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 32 }, { op: 'apply_status', status: 'hexed' }]
  },
  // ── the capstones', and their tracks' ──
  {
    // Every foe within 1 of its footprint, and it heals itself once: the Charnel Cathedral's blows feed it.
    id: 'charnel_sweep',
    name: 'Charnel Sweep',
    shape: 'all',
    range: 1,
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 28 }, { op: 'heal', power: 18, self: true }]
  },
  {
    id: 'feeding_strike',
    name: 'Feeding Strike',
    shape: 'single',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 34 }, { op: 'heal', power: 14, self: true }]
  },
  {
    id: 'bone_feast',
    name: 'Bone Feast',
    shape: 'all',
    range: 2,
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 28 }, { op: 'heal', power: 24, self: true }]
  },
  {
    id: 'marrow_feast',
    name: 'Marrow Feast',
    shape: 'blast',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 32 }, { op: 'heal', power: 20, self: true }]
  },
  {
    id: 'long_winter',
    name: 'Long Winter',
    shape: 'all',
    range: 4,
    tint: '#9ad8ff',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 14 }, { op: 'apply_status', status: 'hexed' }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    // A caster's caster: every ally within 3 has its skills back a turn sooner.
    id: 'court_of_frost',
    name: 'Court of Frost',
    shape: 'all_allies',
    range: 3,
    tint: '#cfe3ff',
    anim: 'cast_beam',
    effects: [{ op: 'cooldown', amount: -1 }]
  },
  {
    id: 'winter_fire',
    name: 'Winter Fire',
    shape: 'single',
    range: 4,
    tint: '#cfe3ff',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 32 }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    id: 'endless_winter',
    name: 'Endless Winter',
    shape: 'all',
    range: 5,
    tint: '#9ad8ff',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 14 }, { op: 'apply_status', status: 'hexed' }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    id: 'crown_of_rime',
    name: 'Crown of Rime',
    shape: 'blast',
    range: 4,
    tint: '#cfe3ff',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    id: 'court_eternal',
    name: 'Court Eternal',
    shape: 'all_allies',
    range: 4,
    tint: '#cfe3ff',
    anim: 'cast_beam',
    effects: [{ op: 'cooldown', amount: -1 }, { op: 'apply_status', status: 'barkskin' }]
  },
  {
    id: 'cinder_storm',
    name: 'Cinder Storm',
    shape: 'blast',
    range: 5,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 28 }, { op: 'apply_status', status: 'burning' }]
  },
  {
    id: 'wyrm_fire',
    name: 'Wyrm Fire',
    shape: 'single',
    range: 4,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'burning' }]
  },
  {
    id: 'firestorm',
    name: 'Firestorm',
    shape: 'blast',
    range: 5,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'burning', turns: 4 }]
  },
  {
    id: 'ember_rain',
    name: 'Ember Rain',
    shape: 'all',
    range: 4,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 16 }, { op: 'apply_status', status: 'burning', turns: 4 }]
  },
  {
    // No range: it reaches the whole board, falling from above (`arc`).
    id: 'sky_pyre',
    name: 'Sky Pyre',
    shape: 'single',
    arc: true,
    tint: '#ff7a33',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 36 }, { op: 'apply_status', status: 'burning' }]
  },
  {
    // No range: every ally of the Hive Mind's on the board.
    id: 'hive_chorus',
    name: 'Hive Chorus',
    shape: 'all_allies',
    tint: '#ffe9a8',
    anim: 'cast_beam',
    effects: [{ op: 'heal', power: 16 }, { op: 'apply_status', status: 'regen' }]
  },
  {
    id: 'hive_scythe',
    name: 'Hive Scythe',
    shape: 'blast',
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 36 }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    id: 'hive_song',
    name: 'Hive Song',
    shape: 'all_allies',
    tint: '#ffe9a8',
    anim: 'cast_beam',
    effects: [{ op: 'heal', power: 16 }, { op: 'cleanse', tag: 'debuff', count: 1 }]
  },
  {
    // A long arm of its own, as Reaping Swarm's: 2 tiles from its footprint, and still no flyer.
    id: 'swarm_reap',
    name: 'Swarm Reap',
    shape: 'blast',
    range: 2,
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 36 }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    id: 'sting_storm',
    name: 'Sting Storm',
    shape: 'all',
    range: 3,
    tint: '#9bc25a',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 16 }, { op: 'apply_status', status: 'withered' }]
  },
  {
    id: 'time_lock',
    name: 'Time Lock',
    shape: 'all',
    range: 1,
    melee: true,
    tint: '#b57bff',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 16 }, { op: 'apply_status', status: 'hexed', turns: 2 }]
  },
  {
    id: 'gear_strike',
    name: 'Gear Strike',
    shape: 'single',
    melee: true,
    tint: '#b57bff',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'still_hour',
    name: 'Still Hour',
    shape: 'all',
    range: 2,
    tint: '#b57bff',
    anim: 'cast_beam',
    effects: [{ op: 'damage', power: 10 }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'time_stop',
    name: 'Time Stop',
    shape: 'all',
    range: 2,
    melee: true,
    tint: '#b57bff',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 16 }, { op: 'apply_status', status: 'hexed', turns: 2 }]
  },
  {
    id: 'aurora_blast',
    name: 'Aurora Blast',
    shape: 'blast',
    range: 4,
    tint: '#9ad8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 26 }, { op: 'apply_status', status: 'burning' }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'frostfire_lance',
    name: 'Frostfire Lance',
    shape: 'single',
    range: 4,
    tint: '#9ad8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 32 }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    id: 'corona',
    name: 'Corona',
    shape: 'blast',
    range: 5,
    tint: '#9ad8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 28 }, { op: 'apply_status', status: 'burning' }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'solar_wind',
    name: 'Solar Wind',
    shape: 'all',
    range: 5,
    tint: '#9ad8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 16 }, { op: 'apply_status', status: 'burning' }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'polar_lance',
    name: 'Polar Lance',
    shape: 'single',
    range: 4,
    tint: '#9ad8ff',
    anim: 'ranged_bolt',
    effects: [{ op: 'damage', power: 40 }, { op: 'apply_status', status: 'hexed' }, { op: 'apply_status', status: 'burning' }]
  },
  {
    id: 'barrow_quake',
    name: 'Barrow Quake',
    shape: 'all',
    range: 1,
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'brittle' }]
  },
  {
    id: 'iron_quake',
    name: 'Iron Quake',
    shape: 'all',
    range: 1,
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'brittle' }, { op: 'apply_status', status: 'hexed' }]
  },
  {
    id: 'tomb_fall',
    name: 'Tomb Fall',
    shape: 'all',
    range: 2,
    melee: true,
    tint: '#d8d4cc',
    anim: 'melee_lunge',
    effects: [{ op: 'damage', power: 30 }, { op: 'apply_status', status: 'brittle' }]
  }
]

// ── upgrade tracks ───────────────────────────────────────────────────────────────────────────

// Each kind of soul has two tracks of four tiers (`tracks`), bought with essence by one soul at a time: each soul holds
// its own. One track may pass tier II, and the other then stops at II (canTrack). A tier can carry `mods` (always on, for
// the kind's souls), `ability` ({ id, replace } swaps one; { id, at } adds one there, first by default, so the basics
// stay last), `aura` (replaces its aura), `summon` (shadows of its kind beside each soul as a battle begins) and `size`
// (2: Colossus, the kind's pieces grow to 2×2, one that no longer fits going to the ossuary). Tier IV is a rule, never
// a percentage; no tier I–II remakes an ability or grants an aura, so the other track's III–IV never undo it. TRACKS
// (below): every kind's, by id; none for the Monarch and the bosses.

// ── statuses ─────────────────────────────────────────────────────────────────────────────────

// A status lasts `turns` of its holder's ('battle': the rest of the battle; Hexed's are the acts it costs), the turn it
// is laid counted its first. Up to `stacks` at once (each stack's `mods` apply); `tags` say what a cleanse strips;
// `tick`: its effects at each turn's end, a stack each; `colour`: the pall the board draws it in.
const STATUS_LIST = [
  {
    id: 'brittle',
    desc: '−25% DEF per stack, up to 3 stacks.',
    name: 'Brittle',
    tags: ['debuff'],
    colour: '#d9c9a3',
    turns: 3,
    stacks: 3,
    mods: [{ path: 'def', op: 'mul', v: 0.75 }]
  },
  {
    // It, Enraged and Desperate: +1 Move, and cooldowns falling by 2 a turn (`cooldown.rate`).
    id: 'hasten',
    desc: '+1 Move, and its skills come back a turn sooner.',
    name: 'Hasten',
    tags: ['buff'],
    colour: '#ffd34d',
    turns: 2,
    stacks: 1,
    mods: [m('move', 'add', 1), m('cooldown.rate', 'add', 1)]
  },
  {
    // Its tick heals a share of its holder's max HP (`pct`), whoever laid it: 0.06 a turn.
    id: 'regen',
    desc: 'Heals 6% of its max HP each turn and takes 5% less damage.',
    name: 'Regen',
    tags: ['buff'],
    colour: '#7fe08a',
    turns: 5,
    stacks: 1,
    mods: [{ path: 'damage.taken', op: 'mul', v: 0.95 }],
    tick: [{ op: 'heal', pct: 0.06 }]
  },
  // The one DEF ward.
  { id: 'barkskin', desc: '+25% DEF.', name: 'Barkskin', tags: ['buff'], colour: '#a0763f', turns: 4, stacks: 1, mods: [{ path: 'def', op: 'mul', v: 1.25 }] },

  { id: 'withered', desc: '−20% ATK.', name: 'Withered', tags: ['debuff'], colour: '#8a8a4a', turns: 3, stacks: 1, mods: [{ path: 'atk', op: 'mul', v: 0.8 }] },
  {
    id: 'enraged',
    desc: '+35% ATK, +1 Move, and its skills come back a turn sooner, for the rest of the battle.',
    name: 'Enraged',
    tags: ['buff'],
    colour: '#e04040',
    turns: 'battle',
    stacks: 1,
    mods: [m('atk', 'mul', 1.35), m('move', 'add', 1), m('cooldown.rate', 'add', 1)]
  },
  {
    id: 'desperate',
    desc: '+50% damage dealt, +25% damage taken, +1 Move, and its skills come back a turn sooner.',
    name: 'Desperate',
    tags: ['buff'],
    colour: '#ff5a8a',
    turns: 'battle',
    stacks: 1,
    mods: [
      { path: 'damage.dealt', op: 'mul', v: 1.5 },
      { path: 'damage.taken', op: 'mul', v: 1.25 },
      m('move', 'add', 1),
      m('cooldown.rate', 'add', 1)
    ]
  },
  {
    // A damage-over-time: true damage a stack at each turn's end (no DEF), up to 3 stacks.
    id: 'burning',
    desc: 'Takes 12 true damage each turn per stack, up to 3 stacks.',
    name: 'Burning',
    tags: ['debuff'],
    colour: '#ff7a33',
    turns: 3,
    stacks: 3,
    mods: [],
    tick: [{ op: 'dot', power: 12 }]
  },
  {
    // The Mantis's wound: a damage-over-time as Burning is, slower, stacking deeper.
    id: 'bleeding',
    desc: 'Takes 8 true damage each turn per stack, up to 5 stacks.',
    name: 'Bleeding',
    tags: ['debuff'],
    colour: '#c0202e',
    turns: 2,
    stacks: 5,
    mods: [],
    tick: [{ op: 'dot', power: 8 }]
  },
  {
    // The one disabling status: no act and no counter while it holds, so its `turns` are the acts it costs. Nothing is
    // Hexed twice running (turns.js addStatus).
    id: 'hexed',
    desc: 'Loses its next act, and does not counter until then. Never twice in a row: once a Hex has cost a piece or a foe its act, it shrugs off every Hex until it has acted again.',
    name: 'Hexed',
    tags: ['debuff'],
    colour: '#9b5cff',
    turns: 1,
    stacks: 1,
    mods: []
  },
  {
    // A relic's gift (Tower Shield: about its holder, as the battle begins and as each later wave enters).
    id: 'shield',
    desc: 'Takes 40% less damage.',
    name: 'Shielded',
    tags: ['buff'],
    colour: '#cfe3ff',
    turns: 4,
    stacks: 1,
    mods: [{ path: 'damage.taken', op: 'mul', v: 0.6 }]
  },
  {
    // Snare's: a foe held where it stands for a turn (Move set to 0, whatever adds to it); its energy is as if free, so
    // it still pays any act (turns.js energyOf).
    id: 'rooted',
    desc: 'Cannot move; keeps its energy.',
    name: 'Rooted',
    tags: ['debuff'],
    colour: '#9a7a4a',
    turns: 1,
    stacks: 1,
    mods: [{ path: 'move', op: 'set', v: 0 }]
  },
  {
    // Butcher's Hook's: strength that grows with each kill for the rest of the battle.
    id: 'bloodlust',
    desc: '+6% ATK per stack, up to 8 stacks, for the rest of the battle.',
    name: 'Bloodlust',
    tags: ['buff'],
    colour: '#c43a3a',
    turns: 'battle',
    stacks: 8,
    mods: [m('atk', 'mul', 1.06)]
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

// How a foe moves, by its kind's `behaviour`: Walk for every ground kind (the one drawn road), Fly for the flyers (the
// air road). A foe chooses how far it comes each turn, up to its Move, never where; the text says only what each does.
export const BEHAVIOURS = {
  walk: { name: 'Walk', desc: 'Walks the arrows to the Monarch; a piece of yours in its way blocks it.' },
  // A flyer flies the air road: no wall stops it, but a piece of yours in its way does, and it never goes round.
  fly: { name: 'Fly', desc: 'Flies straight at the Monarch over the walls; a piece of yours in its way, on the ground or in the air, blocks it. Ranged blows and flyers alone reach it.' }
}

// What laying a status is worth to the policy, in HP-equivalents a stack.
export const STATUS_WORTH = {
  brittle: 20, hasten: 20, regen: 40, barkskin: 25, withered: 20, enraged: 25, desperate: 20,
  burning: 24, bleeding: 16, hexed: 40, shield: 30, rooted: 30, bloodlust: 12
}

// What a foe can do to a Monarch, by kind (`threats`); what each does is learnt by fighting it.
export const THREATS = {
  reach: { name: 'Reach', desc: 'Strikes from afar; a piece of yours on its line takes the blow.' },
  shape: { name: 'Shape', desc: 'Hits a whole row, lane or crowd at once.' },
  drain: { name: 'Drain', desc: 'Hexes, saps strength or rots defence.' },
  sustain: { name: 'Sustain', desc: 'Keeps its side fighting: mends, wards, hastens or cleanses it, or raises its dead, so what you deal may not stay dealt.' },
  fly: { name: 'Fly', desc: 'Comes over the walls, never through your pieces, and only a ranged blow (or a flyer\'s melee) can touch it.' },
  burn: { name: 'Burn', desc: 'Leaves a fire that keeps hurting after the blow.' },
  bleed: { name: 'Bleed', desc: 'Opens wounds that bleed deeper with every blow.' },
  // A room's, not a kind's: more foes enter behind the first (a late pair, waves).
  depth: { name: 'Depth', desc: 'More foes arrive behind the first, from the far edge.' }
}

// ── synergies ────────────────────────────────────────────────────────────────────────────────

// One rule a kin and one a role, at 4 pieces: active while a side's living units meet every count in `needs`, a piece
// counting once (a trine as three), a shadow and a summon as anyone, the Monarch never. `rule` names its entry in the
// rules registry, which does what `desc` says, for either side. A split rule holds whole at `full` and its lesser form
// below it. The numbers a `desc` says are TUNING's.
const pctOf = (x) => `${Math.round(x * 100)}%`
const partOf = (x, what) => (x === 0.5 ? `half ${what}` : `${pctOf(x)} of ${what}`)
const firstTurns = (n) => (n === 1 ? 'first turn' : `first ${['two', 'three', 'four'][n - 2] ?? n} turns`)
const ECHO_FULL = 8
export const SYNERGIES = [
  { id: 'undead_4', name: 'Undead 4', desc: 'Legion: every foe slain rises at once as a shadow on your side, past Arise\'s reach and tier (never a boss, a shadow or a Monarch), while your side has room on the board for it.', needs: { kin: { undead: 4 } }, rule: 'legion' },
  { id: 'drake_4', name: 'Drake 4', desc: 'Dragonfire: every single-target blow of yours bursts, striking its target and every foe next to it.', needs: { kin: { drake: 4 } }, rule: 'dragonfire' },
  { id: 'fae_4', name: 'Fae 4', desc: 'Mirage: the first blow each foe would land on one of yours in a battle strikes only an illusion and lays nothing (the rest of a blast, and an echo, land).', needs: { kin: { fae: 4 } }, rule: 'mirage' },
  { id: 'insect_4', name: 'Insect 4', desc: 'Frenzy: one of yours that slays a foe has every skill ready again at once.', needs: { kin: { insect: 4 } }, rule: 'frenzy' },
  { id: 'construct_4', name: 'Construct 4', desc: `Last Stand: the first time each of yours would fall in a battle, to anything that harms it (a burn and a bleed too), it stands at 1 HP instead and heals ${pctOf(TUNING.lastStand.heal)} of its max HP (never the Monarch).`, needs: { kin: { construct: 4 } }, rule: 'last_stand' },
  { id: 'vanguard_4', name: 'Vanguard 4', desc: `Bodyguard: a single-target blow at one of yours that is not a Vanguard lands instead on a Vanguard of yours standing next to it, and your Vanguards take ${pctOf(1 - TUNING.bodyguard.taken)} less damage.`, needs: { role: { vanguard: 4 } }, rule: 'bodyguard' },
  { id: 'ranger_4', name: 'Ranger 4', desc: 'Deadeye: ranged blows of yours deal 50% more damage.', needs: { role: { ranger: 4 } }, rule: 'deadeye' },
  { id: 'skirmisher_4', name: 'Skirmisher 4', desc: `Ambush: yours start the battle, and enter it, Hastened for their ${firstTurns(TUNING.ambush.turns)} (+1 Move, and their skills come back sooner).`, needs: { role: { skirmisher: 4 } }, rule: 'ambush' },
  { id: 'channeler_4', name: 'Channeler 4', desc: `Echo: every ability yours use echoes, landing on its targets once more at ${partOf(TUNING.echo.half, 'its effect')} (${partOf(TUNING.echo.half, 'its damage')} and healing, a status for ${partOf(TUNING.echo.half, 'its turns')}); with ${ECHO_FULL} Channelers, in full. Arise never echoes.`, needs: { role: { channeler: 4 } }, full: ECHO_FULL, rule: 'echo' },
  { id: 'warden_4', name: 'Warden 4', desc: 'Sanctuary: every ability yours aim at an ally (a heal, a ward, a cleanse) touches every one of yours on the board.', needs: { role: { warden: 4 } }, rule: 'sanctuary' },
  { id: 'trickster_4', name: 'Trickster 4', desc: `Deathblow: a blow of yours on a foe below ${pctOf(TUNING.deathblow.below)} of its HP deals ${TUNING.deathblow.mult === 2 ? 'double' : `${TUNING.deathblow.mult}×`} damage.`, needs: { role: { trickster: 4 } }, rule: 'deathblow' }
]

// ── camps ────────────────────────────────────────────────────────────────────────────────────

// Where your souls stand and fight: a 7×7 camp, listed front row first (the foes come from above it). '#' is a wall: it
// blocks walking, not attacks or flight, and the roads run round the walls to the Monarch. 'M' is the Monarch's seat: no
// piece may stand on it. Each floor draws one of its camps; from the seat a road reaches every tile of the foes' rows.
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

// ── the tutorial ─────────────────────────────────────────────────────────────────────────────

// One room before floor 1, the threshold: a real run on its seed's floor-1 camp, its draft fixed (`party`) and its foe
// set where it stands (`foes`: a row of their formation, 0 the front, and a lane). Its three screens of text come once
// each: `field` as it opens, `battle` as the fight begins, `spoils` once it is won.
export const TUTORIAL = {
  seed: 'threshold',
  party: ['tomb_knight'],
  // One foe, a plain melee brute, at a fraction of its strength: it walks into the Knight's reach and falls in a few blows.
  scale: 0.35,
  foes: [{ id: 'grave_ghoul', row: 0, lane: 3 }],
  screens: {
    field: {
      title: 'The threshold',
      lines: [
        'You are the Monarch. You stand on your seat in the camp, never move and never strike; the foes come down the roads to you, and if you fall, the run is over.',
        'One soul is yours: a Tomb Knight, to hold the road. On the Field, drag it to move it.',
        'Then, on the Map, enter the room: its battle begins at once.'
      ],
      go: 'To the camp'
    },
    battle: {
      title: 'Command',
      lines: [
        'Tap a piece: where it can walk lights blue, its blow\'s reach red. Tap a lit tile to move it there, a foe in reach to see the blow, and the foe again to strike.',
        'End Turn when you are done: what you left alone strikes with its basic blow, then the foes take their turn.',
        'Every foe shows its coming turn on the board: dots to where it will stop, a line to what it will strike, the damage over it. Tap a foe to read it; a kind you have met also lights every tile it could reach and strike: this one you meet now.'
      ],
      go: 'Fight'
    },
    spoils: {
      title: 'Reap',
      lines: [
        'The slain pay essence, and one slain foe a battle may join you for its price: recruit it, or move on.',
        `Between rooms, essence buys a kind its tiers, and three of a kind fuse into one far stronger. At the bottom of floor ${TUNING.run.floors}, the Hollow Sovereign waits.`,
        'A run is saved as you play: leave when you like, and Continue from the title.'
      ],
      go: 'Reap'
    }
  }
}

// ── the Monarchs ─────────────────────────────────────────────────────────────────────────────

// Who the player is, chosen on the title and kept with the run. The first is the base Monarch, with nothing more; each
// other starts its run holding `relic` (a run relic, one copy), is offered its kin's kinds more often in the draft
// (TUNING.monarchs.bias), and opens with a clear at ascension `unlock` or above. Its piece is the same Monarch.
export const MONARCH_LIST = [
  { id: 'monarch', name: 'The Monarch', line: 'The necromancer every run began with. The dead it raises, it takes as they come.' },
  {
    id: 'brass', name: 'The Brass Monarch', relic: 'brass_standard', bias: 'construct', unlock: 0,
    line: 'A clockwork crown on a hollow king. Its Constructs come to it first, and take less of every blow.'
  },
  {
    id: 'ember', name: 'The Ember Monarch', relic: 'wyrm_standard', bias: 'drake', unlock: 2,
    line: 'It warms its bones at a dragon\'s pyre. Its Drakes come to it first, and bite harder.'
  },
  {
    id: 'hive', name: 'The Hive Monarch', relic: 'hive_standard', bias: 'insect', unlock: 4,
    line: 'A queen\'s husk, humming. Its Insects come to it first, and run farther.'
  }
]

// ── fusions ──────────────────────────────────────────────────────────────────────────────────

// A recipe: `needs` counts souls per kind, consumed whole, fielded or in the ossuary; `result` is the fused kind, risen
// as one piece at full HP in the ossuary, for TUNING.essence.fuse × its tier × the floor's price scale. Its id is its
// result's; every recipe is public. Every kind of tier 4 or less has its triple (below); the mixed recipes and the
// capstones are written here, a trine named `trine:<kind>`. test/content.test.js holds the graph to its rules.
export const FUSION_LIST = [
  { id: 'bone_colossus', name: 'Bone Colossus', result: 'bone_colossus', needs: { tomb_knight: 2, bone_chanter: 1 }, desc: 'Two Tomb Knights and a Bone Chanter become a 2×2 wall whose sweep strikes every foe around it.' },
  { id: 'rime_drake', name: 'Rime Drake', result: 'rime_drake', needs: { ember_drake: 1, frost_sprite: 2 }, desc: 'An Ember Drake and two Frost Sprites become a drake whose fire freezes: a blast that burns a crowd from four tiles off.' },
  { id: 'hive_queen', name: 'Hive Queen', result: 'hive_queen', needs: { hive_warden: 2, mantis_reaper: 1 }, desc: 'Two Hive Wardens and a Mantis Reaper become a 2×2 queen who mends every ally about her and reaps whatever comes near.' },
  { id: 'clockwork_titan', name: 'Clockwork Titan', result: 'clockwork_titan', needs: { clockwork_page: 2, iron_golem: 1 }, desc: 'Two Clockwork Pages and an Iron Golem become a 2×2 titan whose slam Hexes a crowd, and whose works speed those beside it.' },
  // The Wisp's triple, written: its trine is the Pale Court (`trineOf`).
  { id: 'pale_court', name: 'Pale Court', result: 'pale_court', needs: { will_o_wisp: 3 }, desc: "Three Will-o'-Wisps become one crowned flame: fire on a crowd, and pale fire that Hexes from four tiles off." },
  // The capstones: fusions of fusions.
  { id: 'charnel_cathedral', name: 'Charnel Cathedral', result: 'charnel_cathedral', needs: { bone_colossus: 1, 'trine:grave_ghoul': 1 }, desc: 'A Bone Colossus and a Grave Ghoul Trine become a 2×2 wall that feeds: its blows heal it, and a foe it slays beside it rises as yours.' },
  { id: 'winter_court', name: 'Winter Court', result: 'winter_court', needs: { pale_court: 1, 'trine:frost_sprite': 1 }, desc: 'A Pale Court and a Frost Sprite Trine become a caster\'s caster: Hex and Brittle on every foe within 4 tiles, and the skills of those about it back a turn sooner.' },
  { id: 'cinder_wyrm', name: 'Cinder Wyrm', result: 'cinder_wyrm', needs: { rime_drake: 1, 'trine:pyre_hound': 1 }, desc: 'A Rime Drake and a Pyre Hound Trine become a flying burner: Burning on a crowd from 5 tiles, and a foe it slays sets those beside it alight.' },
  { id: 'hive_mind', name: 'Hive Mind', result: 'hive_mind', needs: { hive_queen: 1, 'trine:hive_drone': 1 }, desc: 'A Hive Queen and a Hive Drone Trine become a 2×2 mind that mends every ally, hatches drones at every wave, and has its skills ready again when it slays.' },
  { id: 'engine_of_ages', name: 'Engine of Ages', result: 'engine_of_ages', needs: { clockwork_titan: 1, 'trine:clockwork_page': 1 }, desc: 'A Clockwork Titan and a Clockwork Page Trine become a 2×2 engine that Hexes all it touches, and stands at 1 HP once a battle.' },
  { id: 'aurora', name: 'Aurora', result: 'aurora', needs: { pale_court: 1, rime_drake: 1 }, desc: 'A Pale Court and a Rime Drake become fire and frost: a blast that burns and Hexes a crowd from four tiles off.' },
  { id: 'iron_barrow', name: 'Iron Barrow', result: 'iron_barrow', needs: { bone_colossus: 1, clockwork_titan: 1 }, desc: 'A Bone Colossus and a Clockwork Titan become the heaviest piece there is: a 2×2 wall of tier 6 that shelters all about it.' }
]

// ── trines ───────────────────────────────────────────────────────────────────────────────────────

// The triple rule: every kind of tier 4 or less that a run can hold fuses three of itself into its trine, TRINE_RISE
// tiers above it (TOP_TIER the top). A record with `trineOf: <kind>` is that kind's written trine; for any other the
// content makes one at load (makeTrine):
//   id `trine:<kind>`; name the kind's `trine` or "<Name> Trine" ("Great <name>" for a trine's); 2×2 from tier 4 up
//   HP, ATK and DEF, base and growth, the kind's × TUNING.trine; kin, role, Move, flight, arm, aura, temper, threats
//   and pictures the kind's; its abilities the kind's, each blow at one foe a blast, each ranged one a tile longer
//   its tracks the kind's, each tier's ability its trine form, a summon tier calling up the kind it was made of
// Made in order, so a made trine of tier 4 or less has its own: trines of trines. A trine counts as three toward its
// kin's and role's synergies.
export const TOP_TIER = 6
export const TRINE_RISE = 2
// Whether a run can hold a kind: one that spawns (a recruit's) or a fused one (a fusion's).
export const holdable = (d) => !d.monarch && !d.boss && !!(d.spawn || d.fused)
// "Will-o'-Wisps", "Bone Colossi".
const plural = (name) => (name.endsWith('us') ? `${name.slice(0, -2)}i` : `${name}s`)
const tenths = (x) => Math.round(x * 10) / 10
const isAlly = (a) => ['ally', 'all_allies', 'self', 'corpse'].includes(a.shape)
const abilityById = new Map(ABILITY_LIST.map((a) => [a.id, a]))

// The trine form of ability `id`: a blow at one foe a blast, a ranged one a tile longer (made once, id `trine:<id>`).
function trineAbility (id) {
  const a = abilityById.get(id)
  const blast = a.shape === 'single' && !isAlly(a)
  const longer = !a.melee && !isAlly(a) && Number.isInteger(a.range)
  if (!blast && !longer) return id
  const made = `trine:${id}`
  if (!abilityById.has(made)) {
    const b = { ...a, id: made, trineOf: id, ...(blast && { shape: 'blast' }), ...(longer && { range: a.range + 1 }) }
    abilityById.set(made, b)
    ABILITY_LIST.push(b)
  }
  return made
}

// A made blow in words, for the tier that grants it: its power, whom it takes and how far, what it leaves and mends.
function blowText (a) {
  const power = a.effects.find((e) => e.op === 'damage')?.power
  const at = a.range ? `, at range ${a.range}` : ''
  const whom = {
    single: `a foe${a.range || a.melee ? '' : ' anywhere on the board'}`,
    blast: `a foe${a.range || a.melee ? '' : ' anywhere on the board'} and everyone next to it${at}`,
    row: `a foe and everyone level with it${at}`,
    column: `a foe and everyone in its lane${at}`,
    all: a.range ? `every foe within ${a.range} tiles` : 'every foe'
  }[a.shape]
  const statusName = (e) => `${STATUS_LIST.find((s) => s.id === e.status).name}${e.turns ? ` for ${e.turns === 'battle' ? 'the battle' : `${e.turns} turns`}` : ''}`
  const lays = a.effects.filter((e) => e.op === 'apply_status').map(statusName)
  return [`${power ?? 0} power to ${whom}`, lays.length && `leaving them ${lays.join(' and ')}`,
    a.effects.some((e) => e.op === 'heal' && e.self) && 'and it heals itself', a.cond].filter(Boolean).join(', ')
}

// The trine's tier made from tier `x` of the kind `d`'s track `track` (its `i`th), for a trine of `size`.
function trineTier (d, track, x, i, size) {
  if (x.ability) {
    const id = trineAbility(x.ability.id)
    const ability = { ...x.ability, id, ...(x.ability.replace && { replace: trineAbility(x.ability.replace) }) }
    if (id === x.ability.id) return { ...x, ability }
    const name = abilityById.get(id).name
    const lead = x.ability.replace ? `${abilityById.get(x.ability.replace).name} becomes ${name}` : `Learns ${name}`
    return { ...x, desc: `${lead}: ${blowText(abilityById.get(id))}.`, ability }
  }
  if (x.summon) {
    // The kind's card says "2 of its kind", or a trine's "2 Bone Chanters": its own are the kind's.
    const was = d.summons ? plural(UNIT_LIST.find((u) => u.id === d.summons).name) : 'of its kind'
    return { ...x, desc: x.desc.replace(`${x.summon} ${was}`, `${x.summon} ${plural(d.name)}`) }
  }
  if (x.size !== 2 || size !== 2) return x
  // A Colossus on a trine already 2×2: the aura this tier would follow, a tile wider, or with none a wall's.
  const was = track.tiers.slice(0, i).reverse().find((t) => t.aura)?.aura ?? d.aura
  if (!was) {
    const aura = { range: 1, desc: 'Allies next to it take 10% less damage.', mods: [m('damage.taken', 'mul', 0.9)] }
    return { desc: 'Gains an aura: allies next to it take 10% less damage.', aura }
  }
  const range = was.range + 1
  return { desc: `Its aura reaches allies within ${range} tiles.`, aura: { ...was, range, desc: was.desc.replace(/^Allies (next to it|within \d+ tiles)/, `Allies within ${range} tiles`) } }
}

// The triple of kind `d` into trine `t`, a recipe line; a made trine's says what the rule made of it.
const tripleOf = (d, t) => ({
  id: t.id,
  name: t.name,
  result: t.id,
  needs: { [d.id]: 3 },
  desc: t.id === `trine:${d.id}`
    ? `Three ${plural(d.name)} become one${t.size ? ' 2×2' : ''} piece of tier ${t.tier}: their kit as one, each blow at one foe a blast and each shot a tile longer.`
    : `Three ${plural(d.name)} become one ${t.name}.`
})

// The trine content makes for kind `d`, by the triple rule above.
function makeTrine (d) {
  const tier = Math.min(TOP_TIER, d.tier + TRINE_RISE)
  const size = tier >= 4 ? 2 : 1
  const k = d.fused ? TUNING.trine.fused : TUNING.trine.parts[d.tier - 1]
  const name = d.trine ?? `${d.name} Trine`
  const stats = (s, round) => Object.fromEntries(Object.entries(s).map(([key, v]) => [key, round(key, v * k[key])]))
  const summons = d.tracks.some((t) => t.tiers.some((x) => x.summon))
  return {
    id: `trine:${d.id}`,
    name,
    trine: `Great ${name}`,
    trineOf: d.id,
    kin: d.kin,
    role: d.role,
    tier,
    fused: true,
    ...(size > 1 && { size }),
    base: stats(d.base, (key, v) => Math.round(v)),
    growth: stats(d.growth, (key, v) => (key === 'hp' ? Math.round(v) : tenths(v))),
    abilities: d.abilities.map(trineAbility),
    move: d.move,
    ...(d.flies && { flies: true }),
    ...(d.arm && { arm: d.arm }),
    ...(d.aura && { aura: d.aura }),
    temper: d.temper,
    tracks: d.tracks.map((t) => ({ ...t, tiers: t.tiers.map((x, i) => trineTier(d, t, x, i, size)) })),
    ...(summons && { summons: d.id }),
    threats: d.threats,
    art: d.art ?? d.id,
    flavour: 'Three of one kind bound into one body: what each of them did to a foe, it does to a crowd.'
  }
}

// Every kind's trine by its id, the written then the made (each joining UNIT_LIST, so the walk reaches it in turn).
const TRINES = {}
for (const u of UNIT_LIST) if (u.trineOf) TRINES[u.trineOf] = u
for (let i = 0; i < UNIT_LIST.length; i++) {
  const d = UNIT_LIST[i]
  if (!holdable(d) || d.tier > TOP_TIER - TRINE_RISE) continue
  if (!TRINES[d.id]) UNIT_LIST.push((TRINES[d.id] = makeTrine(d)))
  if (!FUSION_LIST.some((r) => r.result === TRINES[d.id].id)) FUSION_LIST.push(tripleOf(d, TRINES[d.id]))
}
// Kind `id`'s trine (written or made), or null for a kind with none (tier 5 or 6, or no run's).
export const trineOf = (id) => TRINES[id] ?? null
export const isTriple = (r) => Object.keys(r.needs).length === 1 && Object.values(r.needs)[0] === 3

// ── relics ───────────────────────────────────────────────────────────────────────────────────

// A relic's tier, from the most often stocked to the rarest (`colour`: its colour token). Legendaries are the rules
// that rewrite the game.
export const RELIC_TIERS = [
  { id: 'common', name: 'Common', colour: '--c-common' },
  { id: 'uncommon', name: 'Uncommon', colour: '--c-uncommon' },
  { id: 'rare', name: 'Rare', colour: '--c-rare' },
  { id: 'legendary', name: 'Legendary', colour: '--c-legendary' }
]

// Relics, each of a `tier`, bought in the Shop, one held stocked again: a run relic or a piece relic, its form `mods`,
// `on` + `effects`, or a Legendary's `rule`.
//   run (`run: true`): works unheld, its copies stacking without cap; `mods` on the run's paths (run.*, price.*,
//   essence.gain, arise.*) or a unit's on every soul (a side-wide cost; a kin banner's scoped by `who`), never the Monarch
//   piece: works only through its holder, its copies more holders; `mods` the holder's; `on` a trigger (TRIGGERS) at a
//   place, with the one on its other end ('kill' the slain, 'struck' its attacker, 'fall' its killer, 'blow' its target,
//   'wave' and 'move' no one); `when`: { moved: n } or { still: true } this turn; an effect's `to`: 'self', 'other', or
//   'allies' / 'foes' within `range` of the place. A `rule` (its numbers in `params`) may teach a skill (`grants`).
//   `needsArise`: stocked only once an Arise relic is held. Nothing ever revives the Monarch.
// A kin banner's mod: a unit's, on the souls of `kin` alone.
const banner = (kin, path, op, v) => ({ ...m(path, op, v), who: { kin } })
export const RELIC_LIST = [
  { id: 'whetstone', tier: 'common', name: 'Whetstone', desc: 'Its holder has +18% ATK.', mods: [m('atk', 'mul', 1.18)] },
  { id: 'heartwood', tier: 'common', name: 'Heartwood', desc: 'Its holder has +22% max HP.', mods: [m('hp', 'mul', 1.22)] },
  { id: 'blood_chalice', tier: 'common', name: 'Blood Chalice', desc: 'When its holder slays a foe, it heals 15% of its max HP.', on: 'kill', effects: [{ op: 'heal', pct: 0.15, to: 'self' }] },
  { id: 'balm', tier: 'common', name: 'Balm', desc: 'When its holder falls, your side within 2 tiles of it heals 18% of its max HP.', on: 'fall', effects: [{ op: 'heal', pct: 0.18, to: 'allies', range: 2 }] },
  { id: 'binding_chain', tier: 'common', name: 'Binding Chain', run: true, desc: 'Recruiting a soul costs 30% less essence.', mods: [m('price.recruit', 'add', -0.3)] },
  { id: 'ossuary_key', tier: 'common', name: 'Ossuary Key', run: true, desc: 'Your ossuary holds 3 more souls.', mods: [m('run.roster', 'add', 3)] },
  { id: 'grave_shroud', tier: 'common', name: 'Grave Shroud', run: true, desc: 'The Monarch has 30 more max HP.', mods: [m('run.monarchHp', 'add', 30)] },
  { id: 'bone_horn', tier: 'common', name: 'Bone Horn', run: true, desc: '+1 Command (a piece more on the field), but every soul has 10% less HP.', mods: [m('run.command', 'add', 1), m('hp', 'mul', 0.9)] },
  { id: 'iron_oath', tier: 'common', name: 'Iron Oath', desc: 'When its holder is struck, your side within 2 tiles of it gains Barkskin (+25% DEF).', on: 'struck', effects: [{ op: 'apply_status', status: 'barkskin', to: 'allies', range: 2 }] },
  { id: 'grave_bell', tier: 'common', name: 'Grave Bell', desc: 'When its holder is struck, its attacker is Withered (−20% ATK).', on: 'struck', effects: [{ op: 'apply_status', status: 'withered', to: 'other' }] },
  { id: 'rowan_charm', tier: 'common', name: 'Rowan Charm', desc: 'As the battle begins, and as each later wave begins to enter, while its holder stands: your side within 2 tiles of it gains Barkskin (+25% DEF).', on: 'wave', effects: [{ op: 'apply_status', status: 'barkskin', to: 'allies', range: 2 }] },
  { id: 'war_drum', tier: 'uncommon', name: 'War Drum', desc: 'When its holder falls, your side within 2 tiles of it gains Hasten.', on: 'fall', effects: [{ op: 'apply_status', status: 'hasten', to: 'allies', range: 2 }] },
  { id: 'rally_horn', tier: 'uncommon', name: 'Rally Horn', desc: 'When its holder strikes, your side within 2 tiles of it gains Hasten.', on: 'blow', effects: [{ op: 'apply_status', status: 'hasten', to: 'allies', range: 2 }] },
  { id: 'soul_lantern', tier: 'uncommon', name: 'Soul Lantern', run: true, desc: 'A soul you recruit joins with a free tier, on its lower track. Each copy: a tier more.', mods: [m('run.soulTiers', 'add', 1)] },
  { id: 'tower_shield', tier: 'uncommon', name: 'Tower Shield', desc: 'As the battle begins, and as each later wave begins to enter, while its holder stands: your side within 2 tiles of it is Shielded for 4 turns (takes 40% less damage).', on: 'wave', effects: [{ op: 'apply_status', status: 'shield', to: 'allies', range: 2 }] },
  { id: 'grave_ledger', tier: 'uncommon', name: 'Grave Ledger', run: true, desc: 'Tiers I and II cost 30% less essence.', mods: [m('price.lowTier', 'add', -0.3)] },
  { id: 'bone_mantle', tier: 'uncommon', name: 'Bone Mantle', run: true, desc: 'The Monarch has 65 more max HP.', mods: [m('run.monarchHp', 'add', 65)] },
  { id: 'muster_roll', tier: 'uncommon', name: 'Muster Roll', run: true, desc: '+1 Command (a piece more on the field), but every soul has 5% less HP.', mods: [m('run.command', 'add', 1), m('hp', 'mul', 0.95)] },
  { id: 'hunters_mark', tier: 'uncommon', name: "Hunter's Mark", desc: 'When its holder slays a foe, the foes next to the slain turn Brittle.', on: 'kill', effects: [{ op: 'apply_status', status: 'brittle', to: 'foes', range: 1 }] },
  { id: 'hourglass', tier: 'uncommon', name: 'Hourglass', run: true, desc: 'Every Arise of yours reaches a tile farther.', mods: [m('arise.domain', 'add', 1)], needsArise: true },
  { id: 'bone_idol', tier: 'uncommon', name: 'Bone Idol', run: true, desc: 'Every Arise of yours raises a foe of a tier higher.', mods: [m('arise.tier', 'add', 1)], needsArise: true },
  { id: 'firebrand', tier: 'uncommon', name: 'Firebrand', desc: 'When its holder strikes, its target is set Burning (12 true damage each turn, up to 3 stacks).', on: 'blow', effects: [{ op: 'apply_status', status: 'burning', to: 'other' }] },
  { id: 'briar_mail', tier: 'uncommon', name: 'Briar Mail', desc: 'When its holder is struck, its attacker takes 12 true damage.', on: 'struck', effects: [{ op: 'damage', amount: 12, to: 'other' }] },
  { id: 'leech_fang', tier: 'uncommon', name: 'Leech Fang', desc: 'When its holder strikes, it heals 10% of its max HP.', on: 'blow', effects: [{ op: 'heal', pct: 0.1, to: 'self' }] },
  { id: 'raiders_spur', tier: 'uncommon', name: "Raider's Spur", desc: 'When its holder slays a foe, it gains Hasten (+1 Move, and its skills come back a turn sooner).', on: 'kill', effects: [{ op: 'apply_status', status: 'hasten', to: 'self' }] },
  // The kin banners: a build the player can buy, each on the souls of its kin alone.
  { id: 'wyrm_standard', tier: 'uncommon', name: 'Wyrm Standard', run: true, desc: 'Every Drake of yours has +25% ATK.', mods: [banner('drake', 'atk', 'mul', 1.25)] },
  { id: 'brass_standard', tier: 'uncommon', name: 'Brass Standard', run: true, desc: 'Every Construct of yours takes 10% less damage.', mods: [banner('construct', 'damage.taken', 'mul', 0.9)] },
  { id: 'barrow_standard', tier: 'uncommon', name: 'Barrow Standard', run: true, desc: 'Every Undead of yours has +20% max HP.', mods: [banner('undead', 'hp', 'mul', 1.2)] },
  { id: 'gossamer_standard', tier: 'uncommon', name: 'Gossamer Standard', run: true, desc: 'The skills of every Fae of yours come back a turn sooner.', mods: [banner('fae', 'cooldown.rate', 'add', 1)] },
  { id: 'hive_standard', tier: 'uncommon', name: 'Hive Standard', run: true, desc: 'Every Insect of yours has +1 Move.', mods: [banner('insect', 'move', 'add', 1)] },
  { id: 'grave_banner', tier: 'rare', name: 'Grave Banner', run: true, desc: '+1 Command (a piece more on the field).', mods: [m('run.command', 'add', 1)] },
  { id: 'phylactery', tier: 'rare', name: 'Phylactery', run: true, desc: 'The Monarch has 110 more max HP.', mods: [m('run.monarchHp', 'add', 110)] },
  { id: 'tithe_bowl', tier: 'rare', name: 'Tithe Bowl', run: true, desc: 'Battles pay 35% more essence.', mods: [m('essence.gain', 'add', 0.35)] },
  { id: 'rite_candle', tier: 'rare', name: 'Rite Candle', run: true, desc: 'Track tiers cost 25% less essence.', mods: [m('price.tier', 'add', -0.25)] },
  { id: 'arcane_focus', tier: 'rare', name: 'Arcane Focus', desc: 'When its holder slays a foe, its skills come back a turn sooner.', on: 'kill', effects: [{ op: 'cooldown', amount: -1, to: 'self' }] },
  { id: 'glass_crown', tier: 'rare', name: 'Glass Crown', desc: 'Its holder deals 32% more damage, but takes 15% more.', mods: [m('damage.dealt', 'mul', 1.32), m('damage.taken', 'mul', 1.15)] },
  { id: 'gravediggers_spade', tier: 'rare', name: "Gravedigger's Spade", desc: 'When its holder slays a foe of tier 1 (not a shadow), the slain rises at once as a shadow on your side, while your side has room on the board for it.', on: 'kill', effects: [{ op: 'raise', tier: 1, to: 'other' }] },
  { id: 'quicksilver', tier: 'rare', name: 'Quicksilver', desc: 'When its holder strikes, its skills come back a turn sooner.', on: 'blow', effects: [{ op: 'cooldown', amount: -1, to: 'self' }] },
  // Snare holds a foe; Butcher's Hook grows on kills; the four payoffs read what the target carries, two spending it.
  { id: 'snare', tier: 'uncommon', name: 'Snare', desc: 'When its holder strikes, its target is Rooted: it cannot move on its next turn.', on: 'blow', effects: [{ op: 'apply_status', status: 'rooted', to: 'other' }] },
  { id: 'butchers_hook', tier: 'rare', name: "Butcher's Hook", desc: 'When its holder slays a foe, it gains Bloodlust (+6% ATK a stack, up to 8 stacks, for the rest of the battle).', on: 'kill', effects: [{ op: 'apply_status', status: 'bloodlust', to: 'self' }] },
  { id: 'powder_keg', tier: 'rare', name: 'Powder Keg', desc: 'When its holder strikes, its target takes 10 true damage for each stack of Burning on it, and the fire goes out.', on: 'blow', effects: [{ op: 'damage', amount: 10, per: { status: 'burning' }, consume: true, to: 'other' }] },
  { id: 'glass_hammer', tier: 'rare', name: 'Glass Hammer', desc: 'When its holder strikes, its target takes 12 true damage for each stack of Brittle on it, and the Brittle is spent.', on: 'blow', effects: [{ op: 'damage', amount: 12, per: { status: 'brittle' }, consume: true, to: 'other' }] },
  { id: 'headsmans_hood', tier: 'rare', name: "Headsman's Hood", desc: 'When its holder strikes a Hexed foe, the foe takes 25 true damage more.', on: 'blow', effects: [{ op: 'damage', amount: 25, per: { status: 'hexed' }, to: 'other' }] },
  { id: 'plague_mask', tier: 'rare', name: 'Plague Mask', desc: 'When its holder strikes, its target takes 8 true damage for each harmful status on it.', on: 'blow', effects: [{ op: 'damage', amount: 8, per: { tag: 'debuff' }, to: 'other' }] },
  { id: 'arise', tier: 'legendary', name: 'Arise', desc: `Its holder learns Arise, a skill usable every turn: a foe of tier ${TUNING.arise.tier} or lower that fell within ${TUNING.arise.domain} tiles of it rises as your shadow, the corpse of your choosing.`, rule: 'arise' },
  { id: 'legion', tier: 'legendary', name: 'Legion', run: true, desc: '+2 Command (two pieces more on the field), but every soul has 15% less HP.', mods: [m('run.command', 'add', 2), m('hp', 'mul', 0.85)] },
  { id: 'undying', tier: 'legendary', name: 'Undying', desc: 'When its holder falls, it rises at once at 60% HP, once a battle.', rule: 'undying', params: { hp: 0.6 } },
  { id: 'mimicry', tier: 'legendary', name: 'Mimicry', desc: 'Its holder counts as a Warden too, for synergies.', rule: 'mimicry', params: { role: 'warden' } },
  { id: 'hollow_court', tier: 'legendary', name: 'Hollow Court', desc: 'Its holder learns Arise, as the relic gives it; the shadows it raised that still stand when a battle is won are reaped, and each pays its essence again.', rule: 'hollow_court' },
  { id: 'blood_tithe', tier: 'legendary', name: 'Blood Tithe', desc: 'Its holder learns Arise, as the relic gives it but raising two corpses a turn (the one you choose, then the highest tier in its reach); each shadow it raises costs the Monarch 2% of its max HP.', rule: 'blood_tithe', params: { count: 2, tithe: 0.02 } },
  { id: 'court_of_bone', tier: 'legendary', name: 'Court of Bone', desc: 'Its holder learns Arise, as the relic gives it but reaching 2 tiles farther; and nothing heals the Monarch, in battle or out.', rule: 'court_of_bone', params: { domain: 2 } },
  // The Legendaries with a rule: an act refunded, a charge, a glass Monarch, a horde that bursts.
  { id: 'reapers_hunger', tier: 'legendary', name: "Reaper's Hunger", desc: 'When its holder slays a foe in your turn, it may act again.', rule: 'reapers_hunger' },
  { id: 'seven_league_boots', tier: 'legendary', name: 'Seven-League Boots', desc: 'On a turn its holder has moved 3 tiles or more, its blows deal 50% more damage.', rule: 'seven_league_boots', params: { tiles: 3, mul: 1.5 } },
  { id: 'last_candle', tier: 'legendary', name: 'Last Candle', desc: 'While the Monarch is below half its HP, its holder is Desperate (+50% damage dealt, +25% damage taken, +1 Move, and its skills come back a turn sooner).', rule: 'last_candle', params: { below: 0.5 } },
  { id: 'grave_powder', tier: 'legendary', name: 'Grave Powder', desc: 'While its holder stands, a shadow of yours that falls bursts: every foe next to it takes 20 true damage.', rule: 'grave_powder', params: { amount: 20 } },
  // Movement: each reads a piece's own tiles moved this turn, or its target's, or a walk once it is committed.
  { id: 'momentum', tier: 'rare', name: 'Momentum', desc: 'When its holder strikes, its target takes 6 true damage for each tile its holder moved this turn.', on: 'blow', effects: [{ op: 'damage', amount: 6, per: { moved: 'actor' }, to: 'other' }] },
  { id: 'quarry', tier: 'rare', name: 'Quarry', desc: 'When its holder strikes a foe that moved on its last turn, the foe takes 15 true damage more.', on: 'blow', effects: [{ op: 'damage', amount: 15, per: { walked: 'target' }, to: 'other' }] },
  { id: 'bastion', tier: 'uncommon', name: 'Bastion', desc: 'When its holder is struck on a turn it has not moved, its attacker takes 12 true damage.', on: 'struck', when: { still: true }, effects: [{ op: 'damage', amount: 12, to: 'other' }] },
  { id: 'trample', tier: 'rare', name: 'Trample', desc: 'When its holder ends a move (as it acts, or at End Turn), every foe next to where it stands takes 10 true damage.', on: 'move', effects: [{ op: 'damage', amount: 10, to: 'foes', range: 1 }] },
  { id: 'overwatch', tier: 'legendary', name: 'Overwatch', desc: 'Once a turn, when a foe ends its move within reach of its holder\'s basic blow, its holder strikes it at once with that blow, as a counter (a melee holder never reaches a flyer).', rule: 'overwatch', params: { times: 1 } },
  { id: 'hold_the_line', tier: 'legendary', name: 'Hold the Line', desc: 'On a turn they have not moved, its holder and each of yours next to it deal 25% more damage to foes.', rule: 'hold_the_line', params: { mul: 1.25 } }
]

// The holder's moments a piece relic can trigger on ('move': a walk of its committed).
export const TRIGGERS = ['kill', 'fall', 'wave', 'blow', 'struck', 'move']

// ── attack animations ────────────────────────────────────────────────────────────────────────

// Attack templates played by TimelinePlayer, times in ms; `who`/`at` name the actor or primary target. An `anim` step
// strikes a pose (attack, cast, hurt, idle); the results and the targets' flinches show at the `popup` step.
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
export const TRACKS = Object.fromEntries(UNIT_LIST.filter((u) => u.tracks).map((u) => [u.id, u.tracks]))
// A kind's pictures are its own id's unless it borrows another's (`art`), filled in here so readers read `art` alone.
for (const u of UNIT_LIST) u.art ??= u.id
export const ABILITIES = byId(ABILITY_LIST)
export const STATUSES = byId(STATUS_LIST)
export const KIN = byId(KIN_LIST)
export const ROLES = byId(ROLE_LIST)
export const RELICS = byId(RELIC_LIST)
export const ANIMS = byId(ANIM_LIST)
const CAMPS = byId(CAMP_LIST)
export const FUSIONS = byId(FUSION_LIST)
export const MONARCHS = byId(MONARCH_LIST)

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

// A unit's picture as a URL the page and the battle both load (its own, or the kind's it borrows: `art`). pose:
// 'alive', 'attack' or 'dead'.
export const ART_POSES = ['alive', 'attack', 'dead']
export const artUrl = (id, pose = 'alive') => new URL(`./assets/units/${unitDef(id).art}.${pose}.svg`, import.meta.url).href
