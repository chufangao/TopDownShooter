# RETINUE: design

Short form, 2026-10-17. The full design, plan and record (4,100 lines) is `git show 46321e8:DESIGN.md`.

## What it is

- A turn-based tactics roguelike in the browser. A necromancer's retinue holds a line against foes walking down to the Monarch.
- A run: draft three souls, walk three floors of rooms (fights, elites, Shops, altars, a boss each floor; the Sovereign on the third), at ascension 0–10, as one of four Monarchs. Saved every action; daily seed, history, tutorial, music.
- A battle: 7-wide board, your camp below, foes entering above in waves along one drawn road (flyers the air road). Each piece moves up to its Move and acts once: a free basic, or a skill that rests two turns. End Turn: idle pieces use basics, the foes play, statuses tick. No dice. Lost the instant the Monarch falls.
- Between battles, essence buys tiers (two tracks I–IV a kind), recruits (one slain foe a battle), fusions (44 recipes: a trine for every kind, 4 mixed, 7 capstones) and relics (45, four tiers, Shops only). Altars heal, transmute or consecrate. Eleven synergies of kin and role at four pieces; a trine counts as three.
- Statuses: Brittle, Withered, Hexed, Burning, Bleeding, Hasten, Regen, Barkskin, Veiled, Shield, Enraged, Desperate.
- Not a card game: no deck, hand, energy, discard or exhaust. The Spire shape is at the run's level.

## Where the rules live

- The code's comments are the authority: `src/content.js` (every record), `src/tuning.js` (every number), `src/sim/turns.js` (battle), `src/sim/run.js` (run), `src/sim/rules.js` (relic, synergy and boss rules).
- The in-game Codex tells the player the same (`src/keywords.js`, `src/codex.js`).
- The autoplayer (`src/sim/autoplay.js`, `npm run sim`) is the measuring instrument. It is frozen: weights not searched, rules not rewritten, forests refitted only at milestones on a paired gain over fresh seeds.

## State (balance pass part 2, 2026-10-16)

- Expert free play at ascension 0: 85% clears (target ~90%), every death on floor 1.
- Reachable recipes: 36 of 44. Viable archetypes under strict commitment: 4 of 15 within 15 points of the best. The Pale Court is in 66% of final armies. The relics ablation is worth 0 points.
- The novice calculator reaches floor 2 in an eighth of runs (target half). The ladder keeps its order; its top row is unplayable.

## Next

- **Elements** (planned, not built): ten individual rules the player combines, never a count of a team. Rooted and Snare (a hold), Bloodlust and Butcher's Hook (strength on kills), Powder Keg, Glass Hammer, Headsman's Hood and Plague Mask (true damage per status on the target, two spending it), Reaper's Hunger (act again on a kill), Seven-League Boots (×1.5 after moving 3), Last Candle (Desperate while the Monarch is below half), Grave Powder (your shadows burst). One new field: a relic's damage `per` a status, with `consume`.
- **Fusing out of battle alone**: remove the in-battle fuse order, purse and buttons; keep the expert's dead feature keys at 0 for the forests' columns; save version 3.
- Then the next balance pass: the relics line, criterion 2's floor, a fusion's price, the top of the ladder on the teacher, the recruit forest refitted.

## Standing rules

- Enemy behaviour is discovered, never previewed. Defeat is absolute. Floor 1 is hard at the top of the ladder, winnable at its foot.
- One soul is one piece. A fusion is never weaker than its parts. Money always matters.
- Content is data; code grows only when the vocabulary grows. Balance comes once, at the end; nothing tuned while building.
- Measure with the instrument the question needs, pair by seed, never keep a change on the seeds it was chosen on.
- One landscape interface, nothing that needs hover or a key. Recruit only: one slain foe a battle.
