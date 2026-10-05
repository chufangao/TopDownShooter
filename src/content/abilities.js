// `when(s)` gets { self, allies, enemies, t } (living units; allies includes self).
// The AI banks gauge for the first ability whose `when` passes, so gates keep pricey ones reachable.
const hpPct = (u) => u.hp / u.maxHp

export default [
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
