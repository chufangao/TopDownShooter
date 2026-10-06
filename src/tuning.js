// Every balance constant in one place.

export const TUNING = {
  tick: { ms: 50, ceiling: 2400 },
  hit: { min: 0.1, max: 0.95 },
  crit: { min: 0.01, max: 0.6, divisor: 100, mult: 1.75 },
  // raw = power × atk / atkDivisor, then × defConstant / (defConstant + def)
  damage: { atkDivisor: 40, defConstant: 100, min: 1 },
  variance: [0.95, 1.05],
  // gauge per tick = (base + spd / spdDivisor) × gauge.rate
  gauge: { base: 1.6, spdDivisor: 25 },
  // The shared board: each side's 3×7 formation at its own end, `gap` empty rows between the fronts.
  // A step to a neighbouring tile costs `moveCost` gauge; flankers count a tile next to a foe as
  // `dangerCost` steps (a whole number) when they path.
  board: { gap: 1, moveCost: 40, dangerCost: 3 },
  // After startTick (×bossMult for bosses) all damage ramps by perTick, capped at max: no stalemates.
  escalation: { startTick: 900, perTick: 0.005, max: 8, bossMult: 2 },
  // field: souls that fight; roster: field + bench.
  party: { field: 6, roster: 12 },
  // `copies` souls of one kind and star merge into one of star + 1; mult[star − 1] scales HP and ATK.
  star: { max: 3, copies: 3, mult: [1, 2, 3.8] },
  xp: { perTier: 2.5, perLevel: 0.35, base: 28, exponent: 1.45, cap: 10 },
  // Foe level = 1 + (floor − 1) × levelPerFloor; weights fall off with distance from the floor's target
  // tier. fight/elite: foes per encounter on floors 1–4. foeHp/foeAtk multiply ordinary foes per floor;
  // bossHp/bossAtk multiply the boss.
  spawn: {
    levelPerFloor: 2, tierPerFloor: 0.5, tierMax: 5, tierOverCap: 1, tierFalloff: 3,
    fight: [3, 4, 5, 5], elite: [4, 5, 6, 6], eliteLevel: 0, eliteTier: 1,
    foeHp: [0.8, 1.02, 0.84, 0.95], foeAtk: [0.8, 0.95, 0.8, 0.9], bossHp: 0.9, bossAtk: 0.9
  },
  run: { floors: 4, postBattleHeal: 0.5, altarHeal: 1, altarRevive: 0.5 }
}
