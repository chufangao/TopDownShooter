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
  rows: [
    { name: 'front', aggro: 0.6, meleeDealt: 1.1, meleeTaken: 1 },
    { name: 'mid', aggro: 0.3, meleeDealt: 1, meleeTaken: 1 },
    { name: 'back', aggro: 0.1, meleeDealt: 0.75, meleeTaken: 0.7 }
  ],
  persuade: {
    threshold: 0.3,
    decay: 0.7,
    max: 0.9,
    charmDivisor: 100,
    weakenBonus: 2,
    kinAffinity: 1.25,
    base: { 1: 0.15, 2: 0.11, 3: 0.08, 4: 0.05, 5: 0.03, default: 0.09 }
  },
  // After startTick (×bossMult for bosses) all damage ramps by perTick, capped at max: no stalemates.
  escalation: { startTick: 900, perTick: 0.005, max: 8, bossMult: 2 },
  commands: { perBattle: 3, focusTicks: 120, braceTicks: 100, parleyCost: 100 },
  party: { cap: 12 },
  xp: { perTier: 2.5, perLevel: 0.35, base: 28, exponent: 1.45, cap: 10 },
  // Foe level = 1 + (floor − 1) × levelPerFloor; weights fall off with distance from the floor's target
  // tier. foeHp/foeAtk multiply ordinary foes per floor (the boss has its own numbers): the party grows
  // by recruiting, encounters stay 3–4 foes, so foes must outgrow the party one by one.
  spawn: {
    levelPerFloor: 2, tierPerFloor: 0.5, tierMax: 5, tierOverCap: 1, tierFalloff: 3,
    fight: 3, elite: 4, eliteLevel: 0, eliteTier: 1,
    foeHp: [1.2, 3.6, 5, 6.2], foeAtk: [0.75, 1.1, 1.25, 1.4]
  },
  run: { floors: 4, postBattleHeal: 0.5, campfireHeal: 1, campfireRevive: 0.5, restHeal: 0.5, restRevive: 0.25, recruitMinHp: 0.25 },
  // Offer weights after a fight.
  spoils: { relic: 1, drill: 1.5, rest: 2, recruit: 1.5 }
}
