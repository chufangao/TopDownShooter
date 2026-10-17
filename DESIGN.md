# RETINUE: design

Short form, 2026-10-17. The full design, plan and record is `git show 46321e8:DESIGN.md`.

## What it is

- A turn-based tactics roguelike in the browser: a necromancer's retinue holds a line against foes walking down to the Monarch.
- A run: draft three souls, walk three floors of rooms (fights, elites, Shops, altars, a boss a floor), at ascension 0–10, as one of four Monarchs. Saves, a daily seed, a history, a tutorial, music.
- A battle: foes enter in waves along one drawn road toward your camp. Each piece moves and acts once a turn: a free basic, or a skill that then rests. End Turn: idle pieces use basics, the foes play, statuses tick. No dice. Lost when the Monarch falls.
- Between battles, essence buys tiers (two tracks a kind), recruits (one slain foe a battle), fusions (44 recipes) and relics (Shops only). Altars heal, transmute or consecrate. Eleven synergies of kin and role at four pieces.
- Twelve statuses (Burning, Hexed, Brittle, Bleeding, Hasten…), each a stat mod or a tick.
- Not a card game: no deck, hand, energy, discard or exhaust.

## Where the rules live

- The code's comments are the authority: `src/content.js` (records), `src/tuning.js` (numbers), `src/sim/` (battle, run, rules).
- The autoplayer (`npm run sim`) is the measuring instrument, and frozen: refitted only on a paired gain over fresh seeds.

## State (2026-10-16)

- Expert free play at ascension 0: 85% clears (target ~90%), every death on floor 1.
- 36 of 44 recipes reachable; 4 of 15 archetypes viable; the Pale Court in 66% of final armies; relics worth 0 points.
- The novice reaches floor 2 in an eighth of runs (target half). The ladder keeps its order; its top row is unplayable.

## Next

- **Elements** (planned, not built): ten individual rules the player combines, never a count of a team. Snare (a hold), Butcher's Hook (strength on kills), Powder Keg, Glass Hammer, Headsman's Hood and Plague Mask (damage per status on the target), Reaper's Hunger (act again on a kill), Seven-League Boots (a charge), Last Candle (Desperate while the Monarch is low), Grave Powder (your shadows burst).
- **Fusing out of battle alone**: remove the in-battle fuse order, purse and buttons.
- Then the next balance pass: relics, viability's floor, the ladder's top, the recruit forest refitted.

## Standing rules

- Enemy behaviour is discovered, never previewed. Defeat is absolute. Floor 1 is hard at the top of the ladder, winnable at its foot.
- One soul is one piece. A fusion is never weaker than its parts. Money always matters.
- Content is data; code grows only when the vocabulary grows. Balance once, at the end.
- Measure with the right instrument, pair by seed, never keep a change on the seeds it was chosen on.
- One landscape interface, nothing that needs hover or a key. Recruit only.
