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
  // The shared board: the foes' 3×7 formation at the top, your 7×7 camp at the bottom, `gap` empty rows between.
  // Walking is off the gauge: a foe steps to a neighbouring tile once per `stepTicks` (0.8 s), ÷ its stride (your
  // pieces never move).
  board: { gap: 1, stepTicks: 16 },
  // After startTick (×bossMult for bosses) all damage ramps by perTick, capped at max: no stalemates. The
  // ticks count from the last foe to enter (a wave), so newcomers never meet ramped blows.
  escalation: { startTick: 900, perTick: 0.005, max: 8, bossMult: 2 },
  // field: the Monarch's base Command, the pieces that fight (a stack is one piece, whatever its count); the field cap
  // is field + fieldPerFloor × (floor − 1) + the Command relics add (run.js commandOf), never more than army.board.
  // fieldPerFloor is 0 since the army became souls (it was 1 in necessity round 2): Command alone widens the field.
  // roster: the souls (bodies) a retinue holds, on the field and in the ossuary together, stacked or not. The Monarch
  // counts toward neither.
  party: { field: 3, fieldPerFloor: 0, roster: 12 },
  // The Monarch (DESIGN §2.5, §2.6): `hp` its base max HP; the HP relics add to it, a copy each (content.js
  // RELIC_LIST `monarchHp`), and nothing else touches it (no synergy, no other relic). No points are bought: its HP
  // and its Command (party.field) grow only by relics (2026-10-09, late; the points were hp 220 + 14 a point, for
  // 20 + 10 a point bought on all four).
  monarch: { hp: 220 },
  // Arise, a Legendary relic (content.js RELIC_LIST), and its numbers are its own, a copy at a time (DESIGN §2.5):
  // without it no foe rises. One copy: a foe of tier up to `tier` slain within `domain` tiles (Chebyshev) of the
  // Monarch's tile rises as a shadow of yours, up to `raises` a battle, each shadow at the fallen piece's count, each
  // body at `hp` of its body HP (every shadow's, the Legion's and Grave Tide's too: battle.js fit). Each copy past the
  // first: `more.domain` tiles farther, `more.tier` tiers higher, `more.raises` more a battle, and the Monarch's gauge
  // (Arise's casting) `more.haste` faster (×(1 + more.haste × the copies past the first)). Court of Bone's tiles and
  // Blood Tithe's share come on top (run.js domainOf, battle.js ariseCap). Placeholders until the balance pass.
  // Necessity round 2: 3 a battle (was 2: Arise was worth less than the points it took). The balance pass: domain 5 and
  // tier 3 (were 3 and 2: few foes fell inside its reach, and Arise's ablation cost nothing). Late on 2026-10-09 the
  // two points a copy past the first gave it (one a tile; the other a tier, 3 raises and 10% haste, on top of the 3
  // raises every copy gave) became `more`, every number as it was: 3, 9, 15… a battle.
  arise: { domain: 5, tier: 3, raises: 3, hp: 1, more: { domain: 1, tier: 1, raises: 6, haste: 0.1 } },
  // The board (14 → 10 in necessity round 1): the field cap never passes `board` pieces, and the Legion's shadows
  // rise only while fewer than `board` pieces of yours stand on it (Arise's are bounded by its own cap, `arise.raises`).
  army: { board: 10 },
  // A kind's level (every soul of it) is its tiers' (DESIGN §2.6): base + perTier × the tiers it holds on both tracks,
  // rounded down (run.js levelOf), so two tiers make level 3 and six (IV and II) level 5. No level is bought
  // (2026-10-09, late; levels cost 8 × level^1.2 up to 10). A fused kind stands at least at the highest level of the
  // kinds that went into it. Foes keep their floor's levels (spawn). The balance pass (DESIGN §5 Step 8) made it base
  // 2, 0.5 a tier (was 1 and 1.5: six tiers made level 10, and the tracks carried the expert alone, an 88-point
  // ablation); the second pass (2026-10-09, night) 0.34 a tier, a level less at the top, so the power the tracks give
  // leans on their count tiers (six bodies, were three) and the bodies ablation reads apart from the tracks'. The
  // economy pass (2026-10-10) 0.5 again: with essence scarce the expert holds about 60% of its kinds' tiers, not all,
  // and at 0.34 a tier the tracks' ablation fell to 19 points (under its band) as fusions and recruits stood in.
  level: { base: 2, perTier: 0.5 },
  // Essence (DESIGN §2.6): each foe piece slain pays perTier × its tier, whatever its count or level (run.js
  // foeEssence); a run starts with `start`. It buys only tiers, recruits and fusions, and every price is its base ×
  // the floor's price scale, 1 + perFloor × (floor − 1) (run.js floorPrice: ×1, ×2.1, ×3.2, ×4.3 on floors 1–4):
  // a kind's track tiers I–IV tier[] (either track); recruiting a soul recruit × tier × (1 + perLevel × (level − 1)),
  // at the level it joins at (its kind's); a fusion fuse × the fused kind's tier, on top of the souls it consumes.
  // What a won elite offers in relics is TUNING.relic's.
  // The economy pass (2026-10-10; DESIGN §5 Step 8): "money should always matter". Before it a foe paid
  // 2.5 × tier × (1 + 0.35 × (level − 1)) for each of its bodies and prices were flat, so a floor-4 battle paid
  // twenty times a floor-1 battle and the expert ended a clear with ~4,000 essence unspent, every tier it wanted
  // held from floor 3. Paying by the piece and by tier alone (perTier 3.5 keeps floor 1's pay) and prices that grow
  // 1.1 a floor keep what a battle buys about level from floor to floor.
  essence: { start: 20, perTier: 3.5, perLevel: 0.35, perFloor: 1.1, tier: [20, 45, 75, 120], recruit: 8, fuse: 8 },
  // Foe level = 1 + (floor − 1) × levelPerFloor, rising by levelRamp more across a floor's ranks;
  // weights fall off with distance from the floor's target tier. fight/elite: foes per encounter on
  // floors 1–4. foeHp/foeAtk multiply ordinary foes per floor; bossHp/bossAtk multiply the boss. Floor 1
  // (the final balance pass, measured floor 1 alone on 64 seeds a level): a rule-of-thumb run dies there in
  // its ordinary fights as often as at elites, an expert almost only at elites it is forced into while its
  // souls are still level 1–2. So floor 1's elite is 2 foes of the higher tier (and the late pair), and its
  // foes ×0.8 (was ×0.75): 57 of 64 basic runs and 2 of 64 expert runs die on floor 1.
  spawn: {
    levelPerFloor: 1, levelRamp: 2, tierPerFloor: 0.5, tierMax: 5, tierOverCap: 1, tierFalloff: 3,
    fight: [3, 4, 5, 5], elite: [2, 5, 6, 6], eliteLevel: 0, eliteTier: 1,
    // The balance pass: levelPerFloor 1 (was 2) with floors 2–4's foeHp/foeAtk ×1.15 (were 0.88/0.83, 0.76/0.76,
    // 0.95/0.9), so a floor's foes grow less by level and the expert's margin is thin enough to show each mechanic.
    // The second pass (2026-10-09, night; DESIGN §5 Step 8), after foes came to walk past your pieces doing nothing
    // until they can hit back: floors 2–4 ×1.44, ×1.71, ×2.03 (were 1.01/0.95, 0.87/0.87, 1.09/1.04), steepest at
    // the bottom, where the expert's army has grown most; floor 1 untouched (it is the basic player's wall already).
    // The economy pass (2026-10-10): floors 2–4 ×0.75, ×0.75, ×0.68 of that (were 1.46/1.37, 1.49/1.49, 2.22/2.12),
    // for an army that holds about 60% of its kinds' tiers at a clear where it held them all; floor 1 untouched.
    foeHp: [1.08, 1.1, 1.12, 1.52], foeAtk: [1.02, 1.03, 1.12, 1.45], bossHp: 1, bossAtk: 1,
    // From rank `from` of every floor, a fight's foes carry at least `fight` distinct threat types and an
    // elite's `elite`: a room that does not is redrawn, up to `tries` times, keeping the most varied. And
    // every walk through a floor meets every threat type its foes can bring: a room on a walk that misses
    // one is drawn again wanting it, up to `routeTries` times a type in each of `routePasses` passes (run.js varyRoutes).
    variety: { from: 3, fight: 2, elite: 3, tries: 50, routeTries: 6, routePasses: 4 },
    // The enemy as an army. From floor 2 a room's foes have captains (`captains.fight` in a fight or a wave,
    // `captains.elite` in an elite), each leading a cohort of cohort[floor − 1] more of its own kind: one piece
    // of 1 + cohort bodies on the captain's slot (DESIGN §2.2). A floor-1
    // elite brings a late pair: `late.n` more foes of its pool, entering at the top edge at tick `late.t`. From
    // floor `waves.floor` an elite, a fight from rank `waves.fightRank`, a siege and the last room come in
    // waves (`waves.elite`, `.fight`, `.siege` in all, the first included): each next one enters at the top
    // edge once the one before is down to `waves.share` of its foes, or `waves.t` ticks after it entered. The
    // last room's last wave is the Hollow Sovereign leading a court of `court` undead (they and its waves take
    // foeHp/foeAtk; only the boss takes bossHp/bossAtk). Floor 3 keeps floor 2's cohorts of 2: at 3, a floor-3
    // elite's mantis brood (a captain and three more, going round your pieces together: the Mantis Flanked until
    // 2026-10-10) felled the Monarch in 8 s and ended half the expert's runs (the final balance pass).
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
    // strongest three, each floor's broods (the Flank kinds' then, the Mantis's above all) and final elite the
    // usual end.
    endless: { level: 0, count: 0.5, hp: 0.08, atk: 0.05, waves: 0.5, cohort: 0.5, maxWaves: 6, rules: 2, final: { count: 2, level: 1 } }
  },
  // floors: the Sovereign's floor; beating it is a clear, and the run may descend past it (spawn.endless). A won
  // battle heals each living body postBattleHeal of its HP; an altar heals each to altarHeal of its HP and raises a
  // fallen one at altarRevive (a stack's pool keeps the sum: run.js). Wounds carry (2026-10-10): a win mends a fifth
  // (it was half), so HP, DEF, Undying and Heartwood count between rooms, and an altar is worth walking to.
  run: { floors: 4, postBattleHeal: 0.2, altarHeal: 1, altarRevive: 0.5 },
  // The autoplayer's rehearsals: a battle budget of `rehearsalCeiling` ticks (one still going is scored
  // as a loss), and a single rehearsal seed for a battle of more than `bigBattle` units. `settle`: a rehearsal
  // ends once its result is settled (battle.js settled: margin k, looking back `window` ticks, every foe hit
  // within `recent`, checked every `every` ticks; null: always played out). `prune`: what a formation must beat
  // for its search to fight it on its remaining rolls (autoplay.js plan): 'best' the best so far, 'finalists'
  // a place among the finalists (exact: the same plan as with every roll fought).
  autoplay: { rehearsalCeiling: 1400, bigBattle: 24, settle: { k: 4, window: 100, recent: 50, every: 10 }, prune: 'best' },
  // Relics (content.js RELIC_LIST, RELIC_TIERS). A reliquary lays out `offer.reliquary` relics and a won elite
  // `offer.elite`, free: each of a tier drawn by `weights[room]`, the entry for the floor (index floor − 1; the last
  // one for every floor past them), then a relic of that tier, never the same one twice in one offer; a won elite's
  // always holds a Command relic (run.js relicOffers). A relic held may be offered again (copies stack; no cap). A
  // reliquary also lays out up to `offer.tiers` free next tiers of your kinds (what a rite gave, before the two rooms
  // merged), and from floor `legendary.fromFloor` a won elite and a reliquary lay out `legendary.offer` Legendaries
  // (the ones that need Arise only once it is held). A reliquary's offers are one pick in all; an elite's, one of
  // each kind. The weights are placeholders until the balance pass.
  relic: {
    offer: { reliquary: 3, elite: 2, tiers: 3 },
    weights: {
      reliquary: [{ common: 6, uncommon: 3, rare: 1 }, { common: 4, uncommon: 4, rare: 2 }, { common: 3, uncommon: 4, rare: 3 }, { common: 2, uncommon: 4, rare: 4 }],
      elite: [{ common: 4, uncommon: 4, rare: 2 }, { common: 3, uncommon: 4, rare: 3 }, { common: 2, uncommon: 4, rare: 4 }, { common: 1, uncommon: 4, rare: 5 }]
    },
    legendary: { offer: 2, fromFloor: 2 }
  }
}
