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
  // Walking is off the gauge: every unit may step to a neighbouring tile once per `stepTicks` (0.8 s).
  board: { gap: 1, stepTicks: 16 },
  // After startTick (×bossMult for bosses) all damage ramps by perTick, capped at max: no stalemates. The
  // ticks count from the battle's last entry (a reserve, a wave), so newcomers never meet ramped blows.
  escalation: { startTick: 900, perTick: 0.005, max: 8, bossMult: 2 },
  // field: captains (souls) that fight before Command on floor 1, fieldPerFloor more each floor down (round 2) (the Monarch's banners: field + command, never more
  // than army.board); roster: field + bench. The Monarch counts toward neither.
  party: { field: 3, fieldPerFloor: 1, roster: 12 },
  // The Monarch: HP hp + hpPerPoint × points spent (its level); a point costs cost + costPerPoint × points
  // spent. Its domain reaches `domain` + Dominion tiles (Chebyshev) from its tile; a party unit outside it,
  // and every shadow, deals `falter` × damage. A shadow rises with `raiseHp` of its max HP. Nothing else
  // touches its HP (no synergy, relic or keystone), so hp and hpPerPoint carry all of it: 140 and +24 a point
  // (the final balance pass; it was 90 and +12 while synergies still raised it some 40%). Only a run that buys
  // points gains by hpPerPoint: the expert buys some 14 by floor 4, a rule-of-thumb run none.
  // Arise raises up to raises × (1 + Will) a battle, foes of tier up to raiseTier + Will.
  // Necessity round 2: hp 280 + 10 a point (was 200 + 16: points decided whole runs), raises 3 (was 2: Arise
  // was worth less than the points its Will took). Ranks gained `might` and cohorts of 3/6; relics a cap (relicMax).
  // Round 3: hp 220 + 14 a point (was 280 + 10), rank cohorts 2/4 (were 3/6): once the expert made Knights by
  // rehearsal, Knights' cohorts filled the board at Command 0 and the points were worth nothing (monarch-stats −8).
  monarch: { hp: 220, hpPerPoint: 14, cost: 20, costPerPoint: 10, domain: 3, falter: 0.7, raiseHp: 1, raises: 3, raiseTier: 2, shadowFalter: false },
  // Orders' payoffs. braced: a party unit on Stay within `post` tiles of the tile it holds takes this × damage.
  // fresh: a held detachment's body (any start but 'once') enters with a full gauge and Shielded for this many
  // ticks. reserve: the places held bodies have past the board's cap (they take none of army.board's), so a
  // later start is how more than the board fights at once (necessity round 1: reserves were barely needed).
  // Round 1 also moved the Monarch to hp 200 + 16 a point (from 140 + 24: points weighed too much) and the
  // path tiers to 20/45/75/120 (from 30/60/100/150: tiers were rarely bought, paths barely needed).
  // holdFlank (round 3): a braced unit holds a flanker (it cannot vault one, and is engaged beside one), so a Stay
  // line answers the threat that most often fells the Monarch (battle.js pinned).
  orders: { braced: 0.5, post: 1, fresh: 240, reserve: 10, holdFlank: true },
  // The army (board 14 → 10 in necessity round 1, so the army is not the whole game and Arise's shadows, which
  // stand past the cap, and the reserve both count): at most `board` bodies on the board at once (captains and their cohorts, the Monarch not
  // counted; shadows count once risen); the rest wait in reserve. Rank-and-file all fight at the muster
  // level: it starts at muster.start, and the next costs muster.cost × level^muster.exponent, up to
  // muster.cap. After a win the first 1 + Will bodies bound are free, each more costs bindPerTier × tier.
  // At most `detachments` detachments carry orders at once (every other soul Hunts, at once). overflow: whether
  // bodies with no room on the board wait in reserve and enter as places free (false since necessity round 2:
  // they sit the battle out, and only a held detachment enters mid-battle, so reserves are how more fight).
  army: { board: 10, overflow: false, muster: { start: 2, cap: 10, cost: 9, exponent: 1.2 }, bindPerTier: 3, detachments: 4 },
  // Ranks: a captain is promoted by feeding it standing bodies of its kin, `knight` of them to make it a
  // Knight and `marshal` more to make it a Marshal. A Marshal's own domain reaches `domain` tiles
  // (Chebyshev) from it: there its banner never falters and heeds every order. `cohort[grade]`: bodies a
  // captain of that rank leads beyond Command (a Soldier none), so a promoted captain leads a cohort even at
  // Command 0 (necessity round 1: before, Command 0 meant no army at all, and a base cohort for every captain
  // let a rule-of-thumb run through floor 1).
  ranks: { knight: 3, marshal: 6, domain: 3, cohort: [0, 2, 4], might: [1, 1.2, 1.4] },
  // A level costs cost × level^exponent essence, up to cap.
  level: { cap: 10, cost: 8, exponent: 1.2 },
  // Essence: each foe slain pays perTier × tier × (1 + perLevel × (level − 1)); a run starts with
  // `start`. Path tiers I–IV cost tier[] (IV only for a Knight or Marshal; a second path's tiers I–III cost
  // the same as the first's); recruiting a soul costs recruit × tier × (1 + perLevel × (level − 1)). An
  // elite offers `eliteRelics` relics to choose one from.
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
    // `captains.elite` in an elite), each leading a cohort of cohort[floor − 1] more of its own kind. A floor-1
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
    // included) and floor(`cohort` × deep) more bodies in every captain's cohort. The foes hold their
    // synergies' 8-step rules only from `rules` floors deep (above it their cohorts reach eight of a kind
    // too easily: their ladders stop at the stat steps there). Tuned in the final balance pass on twelve expert
    // clears played on down: at +3 levels, +12% HP, +8% ATK and a body more a cohort a floor, with rules from the
    // first floor down and a final elite of +3 foes and +2 levels, seven of the twelve fell on the first deep
    // floor (its final elite) and none got past a second; at these, ten clear one deep floor or more and the
    // strongest three, each floor's broods (flank, mantis) and final elite the usual end.
    endless: { level: 0, count: 0.5, hp: 0.08, atk: 0.05, waves: 0.5, cohort: 0.5, maxWaves: 6, rules: 2, final: { count: 2, level: 1 } }
  },
  // floors: the Sovereign's floor; beating it is a clear, and the run may descend past it (spawn.endless).
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
