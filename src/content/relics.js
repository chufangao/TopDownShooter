// Run-long party passives. `mods` apply to every party unit in battle (a `row` mod only in that
// row); `commands` adds Commands per battle; `brace` adds ticks to Braced.
export default [
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
