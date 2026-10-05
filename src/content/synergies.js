// Active while `active(counts)` holds for a side's living units; counts = { kin: {...}, role: {...} }.
// A mod with `row` (0 front, 1 mid, 2 back) only applies to units standing in that row.
const k = (c, id) => c.kin[id] ?? 0
const r = (c, id) => c.role[id] ?? 0

export default [
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
