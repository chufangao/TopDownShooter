// Every balance constant in one place.

export const TUNING = {
  // A battle still undecided at `ceiling` ticks ends with no winner (a defeat for the run). The ticks count
  // from the last foe to enter, so a late wave (the Sovereign's) still meets the escalation ramp first.
  tick: { ms: 50, ceiling: 2400 },
  hit: { min: 0.1, max: 0.95 },
  crit: { min: 0.01, max: 0.6, divisor: 100, mult: 1.75 },
  // raw = power × atk / atkDivisor, then × defConstant / (defConstant + def)
  damage: { atkDivisor: 40, defConstant: 100, min: 1 },
  variance: [0.95, 1.05],
  // gauge per tick = (base + spd / spdDivisor) × gauge.rate
  gauge: { base: 1.6, spdDivisor: 25 },
  // The shared board: each side's 3×7 formation at its own end, `gap` empty rows between the fronts.
  // Walking is off the gauge: a unit steps to a neighbouring tile once per `stepTicks` (0.8 s), ÷ its stride.
  board: { gap: 1, stepTicks: 16 },
  // After startTick (×bossMult for bosses) all damage ramps by perTick, capped at max: no stalemates. The
  // ticks count from the last foe to enter (a wave), so newcomers never meet ramped blows.
  escalation: { startTick: 900, perTick: 0.005, max: 8, bossMult: 2 },
  // field: the pieces that fight before Command (a stack is one piece, whatever its count); the field cap is
  // field + fieldPerFloor × (floor − 1) + Command (+ relics, keystones), never more than army.board. fieldPerFloor
  // is 0 since the army became souls (it was 1 in necessity round 2): Command alone widens the field. roster: the
  // souls (bodies) a retinue holds, on the field and in the ossuary together, stacked or not. The Monarch counts
  // toward neither.
  party: { field: 3, fieldPerFloor: 0, roster: 12 },
  // The Monarch: four stats bought a point at a time, HP, Dominion, Command and Will (DESIGN §2.8). HP hp +
  // hpPerPoint × HP points (its level); a point of any costs cost + costPerPoint × points spent on all four.
  // Its domain reaches `domain` + Dominion tiles (Chebyshev) from its tile: Arise raises the foes that
  // fall inside it. A shadow rises with the fallen piece's count, each body at `raiseHp` of its body HP. Nothing else
  // touches its HP (no synergy, relic or keystone), so hp and hpPerPoint carry all of it: 140 and +24 a point
  // (the final balance pass; it was 90 and +12 while synergies still raised it some 40%). Only a run that buys
  // points gains by hpPerPoint: the expert buys some 14 by floor 4, a rule-of-thumb run none.
  // Arise raises up to raises × (1 + Will) a battle, foes of tier up to raiseTier + Will, and each point of Will
  // fills the Monarch's gauge willHaste faster (×(1 + willHaste × Will)): Arise comes sooner. That is the half of
  // Will that free binds were, until binding went.
  // Necessity round 2: hp 280 + 10 a point (was 200 + 16: points decided whole runs), raises 3 (was 2: Arise
  // was worth less than the points its Will took). Ranks gained `might`; relics a cap (relicMax).
  // Round 3: hp 220 + 14 a point (was 280 + 10).
  monarch: { hp: 220, hpPerPoint: 14, cost: 20, costPerPoint: 10, domain: 3, raiseHp: 1, raises: 3, raiseTier: 2, willHaste: 0.1 },
  // The board (14 → 10 in necessity round 1): the field cap never passes `board` pieces, and the Legion's shadows
  // rise only while fewer than `board` pieces of yours stand on it (Arise's are bounded by its own cap).
  army: { board: 10 },
  // A kind's level (every soul of it) costs cost × level^exponent essence, up to cap.
  level: { cap: 10, cost: 8, exponent: 1.2 },
  // Essence: each foe slain pays perTier × tier × (1 + perLevel × (level − 1)); a run starts with
  // `start`. A kind's track tiers I–IV cost tier[] (either track); recruiting a soul costs recruit × tier ×
  // (1 + perLevel × (level − 1)). An elite offers `eliteRelics` relics to choose one from.
  essence: { start: 20, perTier: 2.5, perLevel: 0.35, tier: [20, 45, 75, 120], recruit: 8, eliteRelics: 2, relicMax: 6 },
  // Foe level = 1 + (floor − 1) × levelPerFloor, rising by levelRamp more across a floor's ranks;
  // weights fall off with distance from the floor's target tier. fight/elite: foes per encounter on
  // floors 1–4. foeHp/foeAtk multiply ordinary foes per floor; bossHp/bossAtk multiply the boss. Floor 1
  // (the final balance pass, measured floor 1 alone on 64 seeds a level): a rule-of-thumb run dies there in
  // its ordinary fights as often as at elites, an expert almost only at elites it is forced into while its
  // souls are still level 1–2. So floor 1's elite is 2 foes of the higher tier (and the late pair), and its
  // foes ×0.8 (was ×0.75): 57 of 64 basic runs and 2 of 64 expert runs die on floor 1.
  spawn: {
    levelPerFloor: 2, levelRamp: 2, tierPerFloor: 0.5, tierMax: 5, tierOverCap: 1, tierFalloff: 3,
    fight: [3, 4, 5, 5], elite: [2, 5, 6, 6], eliteLevel: 0, eliteTier: 1,
    foeHp: [0.8, 0.88, 0.76, 0.95], foeAtk: [0.75, 0.83, 0.76, 0.9], bossHp: 1, bossAtk: 1,
    // From rank `from` of every floor, a fight's foes carry at least `fight` distinct threat types and an
    // elite's `elite`: a room that does not is redrawn, up to `tries` times, keeping the most varied. And
    // every walk through a floor meets every threat type its foes can bring: a room on a walk that misses
    // one is drawn again wanting it, up to `routeTries` times a type (run.js varyRoutes).
    variety: { from: 3, fight: 2, elite: 3, tries: 50, routeTries: 6 },
    // The enemy as an army. From floor 2 a room's foes have captains (`captains.fight` in a fight or a wave,
    // `captains.elite` in an elite), each leading a cohort of cohort[floor − 1] more of its own kind: one piece
    // of 1 + cohort bodies on the captain's slot (DESIGN §2.2). A floor-1
    // elite brings a late pair: `late.n` more foes of its pool, entering at the top edge at tick `late.t`. From
    // floor `waves.floor` an elite, a fight from rank `waves.fightRank`, a siege and the last room come in
    // waves (`waves.elite`, `.fight`, `.siege` in all, the first included): each next one enters at the top
    // edge once the one before is down to `waves.share` of its foes, or `waves.t` ticks after it entered. The
    // last room's last wave is the Hollow Sovereign leading a court of `court` undead (they and its waves take
    // foeHp/foeAtk; only the boss takes bossHp/bossAtk). Floor 3 keeps floor 2's cohorts of 2: at 3, a floor-3
    // elite's mantis brood (a captain and three more, flanking together) felled the Monarch in 8 s and ended
    // half the expert's runs (the final balance pass).
    captains: { fight: 1, elite: 2 }, cohort: [0, 2, 2, 3],
    late: { n: 2, t: 400 },
    waves: { floor: 3, fightRank: 8, elite: 2, fight: 2, siege: 3, share: 1 / 3, t: 600 },
    court: 4,
    // Endless floors, past the Sovereign's (run.floors): each floor `deep` floors down reuses the last floor's
    // camps and spawn pool (foe and elite counts and HP/ATK multipliers at their last entries), and grows from
    // there: foes rise `level` levels more per floor deep (on top of levelPerFloor), a room holds
    // floor(`count` × deep) more of them (never more than the formation's 21), and their HP and ATK grow by
    // `hp` and `atk` of the base per floor deep. The floor's last room is a big elite: `final.count` more
    // foes, `final.level` levels higher. The enemy grows as an army too: floor(`waves` × deep) more waves to
    // every room (a single formation becomes a room of waves; never more than `maxWaves`, the first
    // included) and floor(`cohort` × deep) more bodies in every captain's piece. The foes hold their
    // synergies' 8-step rules only from `rules` floors deep (above it their cohorts reach eight of a kind
    // too easily: their ladders stop at the stat steps there). Tuned in the final balance pass on twelve expert
    // clears played on down: at +3 levels, +12% HP, +8% ATK and a body more a cohort a floor, with rules from the
    // first floor down and a final elite of +3 foes and +2 levels, seven of the twelve fell on the first deep
    // floor (its final elite) and none got past a second; at these, ten clear one deep floor or more and the
    // strongest three, each floor's broods (flank, mantis) and final elite the usual end.
    endless: { level: 0, count: 0.5, hp: 0.08, atk: 0.05, waves: 0.5, cohort: 0.5, maxWaves: 6, rules: 2, final: { count: 2, level: 1 } }
  },
  // floors: the Sovereign's floor; beating it is a clear, and the run may descend past it (spawn.endless). A won
  // battle heals each living body postBattleHeal of its HP; an altar heals each to altarHeal of its HP and raises a
  // fallen one at altarRevive (a stack's pool keeps the sum: run.js).
  run: { floors: 4, postBattleHeal: 0.5, altarHeal: 1, altarRevive: 0.5 },
  // The autoplayer's rehearsals: a battle budget of `rehearsalCeiling` ticks (one still going is scored
  // as a loss), and a single rehearsal seed for a battle of more than `bigBattle` units. `settle`: a rehearsal
  // ends once its result is settled (battle.js settled: margin k, looking back `window` ticks, every foe hit
  // within `recent`, checked every `every` ticks; null: always played out). `prune`: what a formation must beat
  // for its search to fight it on its remaining rolls (autoplay.js plan): 'best' the best so far, 'finalists'
  // a place among the finalists (exact: the same plan as with every roll fought).
  autoplay: { rehearsalCeiling: 1400, bigBattle: 24, settle: { k: 4, window: 100, recent: 50, every: 10 }, prune: 'best' },
  // Keystones (KEYSTONE_LIST): from floor `fromFloor`, a won elite and a rite each offer `offer` you do not
  // hold, one of them free for the taking, until a run holds `max`.
  keystone: { offer: 2, max: 3, fromFloor: 2 }
}
