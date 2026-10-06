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
  // A level costs cost × level^exponent essence, up to cap.
  level: { cap: 10, cost: 6, exponent: 1.2 },
  // Essence: each foe slain pays perTier × tier × (1 + perLevel × (level − 1)); a run starts with
  // `start`. Path tiers I–III cost tier[]; recruiting a soul costs recruit × tier × (1 + perLevel ×
  // (level − 1)). An elite offers `eliteRelics` relics to choose one from.
  essence: { start: 20, perTier: 2.5, perLevel: 0.35, tier: [30, 60, 100], recruit: 8, eliteRelics: 2 },
  // Foe level = 1 + (floor − 1) × levelPerFloor, rising by levelRamp more across a floor's ranks;
  // weights fall off with distance from the floor's target tier. fight/elite: foes per encounter on
  // floors 1–4. foeHp/foeAtk multiply ordinary foes per floor; bossHp/bossAtk multiply the boss.
  spawn: {
    levelPerFloor: 2, levelRamp: 2, tierPerFloor: 0.5, tierMax: 5, tierOverCap: 1, tierFalloff: 3,
    fight: [3, 4, 5, 5], elite: [4, 5, 6, 6], eliteLevel: 0, eliteTier: 1,
    foeHp: [0.9, 0.98, 0.84, 0.95], foeAtk: [0.88, 0.92, 0.84, 0.92], bossHp: 0.9, bossAtk: 0.9
  },
  run: { floors: 4, postBattleHeal: 0.5, altarHeal: 1, altarRevive: 0.5 }
}
