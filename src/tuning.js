// Every balance constant in one place.

export const TUNING = {
  // Turns (redesign.md §2.3–2.10). `turn.cap`: the clock, in turns from the last wave's entry; a battle undecided at
  // the cap is lost. `policy.press`: the camp's pressure, 0 at turn 1 rising to 1 at the cap, nudged ± `strength` by the
  // trade it could make. A kind's Move is its def's (content.js `move`). No dice (§2.16): every blow hits, none crits,
  // a blow deals computeDamage's mean, and nothing in a battle reads a random number. Placeholders until the balance
  // pass.
  turn: { cap: 20 },
  policy: { press: { strength: 0.25 } },
  // The Shop (redesign.md §2.11): `relics` stocked, one always a Command relic, and from floor 2 one a Legendary;
  // each priced price[tier] × the floor's price scale (run.js relicPrice, floorPrice), after the discount relics
  // (`price.relic`). Placeholders.
  shop: { relics: 4, price: { common: 36, uncommon: 60, rare: 96, legendary: 144 } },
  // raw = power × atk / atkDivisor, then × defConstant / (defConstant + def)
  damage: { atkDivisor: 40, defConstant: 100, min: 1 },
  // Deathblow (the Trickster's rule, rules.js): a blow of the side's on a foe below `below` of its max HP deals
  // `mult` times its damage (redesign.md §2.16). Placeholders.
  deathblow: { below: 0.25, mult: 2 },
  // The shared board: the foes' 3×7 formation at the top, your 7×7 camp at the bottom, `gap` empty rows between.
  board: { gap: 1 },
  // field: the Monarch's base Command, the pieces that fight (one soul each); the field cap is field + fieldPerFloor
  // × (floor − 1) + the Command relics add (run.js commandOf), never more than army.board. fieldPerFloor 0: Command
  // alone widens the field. roster: the souls a retinue holds, on the field and in the ossuary together. The Monarch
  // counts toward neither.
  party: { field: 3, fieldPerFloor: 0, roster: 12 },
  // The Monarch (DESIGN §2.5, §2.6): `hp` its base max HP; the HP relics add to it, a copy each (mods on
  // `run.monarchHp`), and nothing else touches it. 250 since the fourth balance pass (2026-10-10), so one Pyre Hound's
  // burn or a long duel with a floor-1 shooter no longer ends an expert's run on floor 1.
  monarch: { hp: 250 },
  // The summons a soul's tiers bring (unit.js summonsOf): shadows of its kind that rise beside it as each battle
  // begins, each at `hp` of a whole one's max HP (turns.js summon, fit), gone when it ends. A placeholder.
  summon: { hp: 0.4 },
  // Arise, a Legendary piece relic (content.js RELIC_LIST; redesign.md §2.15): its holder gains the skill Arise, one
  // corpse within `domain` tiles of the holder (Chebyshev, from its footprint), of tier up to `tier`, rises as a shadow of
  // yours at full HP, the player's choice; a skill, so a turn's rest. Hourglass and Bone Idol add to both, run-wide
  // (`arise.domain`, `arise.tier`: run.js ariseOf), and an Arise variant's rule may reach farther (Court of Bone).
  // Placeholders until the balance pass.
  arise: { domain: 5, tier: 3 },
  // The board: the field cap never passes `board` pieces, and the Legion's shadows rise only while fewer than `board`
  // pieces of yours stand on it (Arise's rise past it: a skill is its own bound).
  army: { board: 10 },
  // A kind's level (every soul of it) is its tiers' (DESIGN §2.6): base + perTier × the tiers it holds on both tracks,
  // rounded down (run.js levelOf), so two tiers make level 3 and six level 6. No level is bought. A fused kind stands
  // at least at the highest level of the kinds that went into it. Foes keep their floor's levels (spawn). perTier 0.67
  // since the fourth balance pass (2026-10-10), with the cheaper tiers below: it keeps the tracks' ablation in its band.
  level: { base: 2, perTier: 0.67 },
  // Essence (DESIGN §2.6): each foe slain pays perTier × its tier, whatever its level (run.js foeEssence); a run
  // starts with `start`. It buys tiers, recruits, fusions and relics (TUNING.shop), and every price is its base ×
  // the floor's price scale, 1 + perFloor × (floor − 1) (run.js floorPrice: ×1, ×2.1, ×3.2, ×4.3 on floors 1–4):
  // a kind's track tiers I–IV tier[] (either track); recruiting a soul recruit × tier × (1 + perLevel × (level − 1)),
  // at the level it joins at (its kind's); a fusion fuse × the fused kind's tier, on top of the souls it consumes.
  // A won elite pays eliteBonus on top of its foes' pay, × the floor's price scale (run.js eliteBonus); it lays out no
  // relic (redesign.md §2.11). refund: a soul released pays back that share of what recruiting it would cost now
  // (run.js releaseRefund), rounded down. Money always matters (the economy pass, 2026-10-10): paying by the piece and
  // by tier, and prices growing by the floor, keep what a battle buys about level from floor to floor; the tier prices
  // are the fourth balance pass's (2026-10-10).
  essence: { start: 20, perTier: 3.5, perLevel: 0.35, perFloor: 1.1, tier: [16, 36, 60, 96], recruit: 8, fuse: 8, refund: 0.5, eliteBonus: 96 },
  // Foe level = 1 + (floor − 1) × levelPerFloor, rising by levelRamp more across a floor's ranks;
  // weights fall off with distance from the floor's target tier. fight/elite: foes per encounter on
  // floors 1–4. foeHp/foeAtk multiply ordinary foes per floor; bossHp/bossAtk multiply the boss. Floor 1's elite is 2
  // foes of the higher tier (and the late pair), so a rule-of-thumb run dies on floor 1 and an expert rarely does.
  spawn: {
    levelPerFloor: 1, levelRamp: 2, tierPerFloor: 0.5, tierMax: 5, tierOverCap: 1, tierFalloff: 3,
    fight: [3, 4, 5, 5], elite: [2, 5, 6, 6], eliteLevel: 0, eliteTier: 1,
    // Steepest at the bottom, where the expert's army has grown most; floor 1 is the basic player's wall already.
    foeHp: [1.08, 1.1, 1.12, 1.52], foeAtk: [1.02, 1.03, 1.12, 1.45], bossHp: 1, bossAtk: 1,
    // From rank `from` of every floor, a fight's foes carry at least `fight` distinct threat types and an
    // elite's `elite`: a room that does not is redrawn, up to `tries` times, keeping the most varied. And
    // every walk through a floor meets every threat type its foes can bring: a room on a walk that misses
    // one is drawn again wanting it, up to `routeTries` times a type in each of `routePasses` passes (run.js varyRoutes).
    // routeTries 24 since 2026-10-10: Bleed is the Mantis's alone, and fewer tries left floor-2 walks that met none.
    variety: { from: 3, fight: 2, elite: 3, tries: 50, routeTries: 24, routePasses: 4 },
    // The enemy as an army. From floor 2 a room's foes have captains (`captains.fight` in a fight or a wave,
    // `captains.elite` in an elite), each leading a cohort of cohort[floor − 1] more of its own kind: foes of their
    // own, each on the free slot of the formation nearest the captain (run.js formation). A floor-1 elite brings a
    // late pair: `late.n` more foes of its pool, a wave of their own. From floor `waves.floor` an elite, a fight from
    // rank `waves.fightRank`, a siege and the last room come in waves (`waves.elite`, `.fight`, `.siege` in all, the
    // first included). Waves enter on fixed turns (redesign.md §2.10): the room's formation stands from turn 1, and
    // wave k enters at the end of turn 1 + k × `waves.every` (turns.js entryTurn), shown on the wave counter; a siege
    // is three waves with no prep between them. The last room's last wave is the Hollow Sovereign leading a court of
    // `court` undead (they and its waves take foeHp/foeAtk; only the boss takes bossHp/bossAtk). Floor 3 keeps floor
    // 2's cohorts of 2: at 3, a floor-3 elite's mantis brood ended half the expert's runs (the final balance pass).
    captains: { fight: 1, elite: 2 }, cohort: [0, 2, 2, 3],
    late: { n: 2 },
    waves: { floor: 3, fightRank: 8, elite: 2, fight: 2, siege: 3, every: 4 },
    court: 4,
    // Endless floors, past the Sovereign's (run.floors): each floor `deep` floors down reuses the last floor's
    // camps and spawn pool (foe and elite counts and HP/ATK multipliers at their last entries), and grows from
    // there: foes rise `level` levels more per floor deep (on top of levelPerFloor), a room holds
    // floor(`count` × deep) more of them (never more than the formation's 21), and their HP and ATK grow by
    // `hp` and `atk` of the base per floor deep. The floor's last room is a big elite: `final.count` more
    // foes, `final.level` levels higher. The enemy grows as an army too: floor(`waves` × deep) more waves to
    // every room (a single formation becomes a room of waves; never more than `maxWaves`, the first
    // included) and floor(`cohort` × deep) more foes in every captain's cohort. The foes hold their synergies'
    // rules on every floor (redesign.md §2.12), as yours do.
    endless: { level: 0, count: 0.5, hp: 0.08, atk: 0.05, waves: 0.5, cohort: 0.5, maxWaves: 6, final: { count: 2, level: 1 } }
  },
  // floors: the Sovereign's floor; beating it is a clear, and the run may descend past it (spawn.endless). A won
  // battle heals each living soul postBattleHeal of its max HP; an altar heals each to altarHeal of it and raises a
  // fallen one at altarRevive (run.js). Wounds carry (2026-10-10): a win mends a fifth, so HP, DEF, Undying and
  // Heartwood count between rooms, and an altar is worth walking to.
  run: { floors: 4, postBattleHeal: 0.2, altarHeal: 1, altarRevive: 0.5 },
  // Relics (content.js RELIC_LIST, RELIC_TIERS), bought in Shops and only there (TUNING.shop; redesign.md §2.11). A
  // Shop draws each relic's tier by `weights.shop`, the entry for the floor (index floor − 1; the last one for every
  // floor past them), then a relic of that tier, never the same one twice in one stock; one held may come again
  // (copies stack; no cap). From floor `legendary.fromFloor` one of its relics is a Legendary (the ones that need Arise
  // only once an Arise relic is owned). `perPiece`: how many relics a soul may hold (redesign.md §2.15: a piece relic
  // works only through its holder). The weights are placeholders until the balance pass.
  relic: {
    perPiece: 1,
    weights: {
      shop: [{ common: 6, uncommon: 3, rare: 1 }, { common: 4, uncommon: 4, rare: 2 }, { common: 3, uncommon: 4, rare: 3 }, { common: 2, uncommon: 4, rare: 4 }]
    },
    legendary: { fromFloor: 2 }
  }
}
