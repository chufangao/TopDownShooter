# RETINUE: design

2026-10-17. Everything a session needs is in this file and the code; the full history is the git log.

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

Three steps, in order; the first two go in at placeholders, the third measures.

### 1. Fusing out of battle alone (sim ~2 h)

- Remove the `fuse` order and event and the battle's purse (`turns.js`), battleSetup's prices and closeBattle's `fuseIn` (`run.js`), the expert's fusion option (`policy.js`, `autoplay.js`), and the Fuse buttons and animation in battle (`engine.js`, `ui.js`).
- Keep the expert's feature keys `fuse`, `essence` and `spent` at 0: the forests' rows read features by name.
- Save version 3: an older log may hold an order no battle takes now.
- Delete the tests of fusing in battle. The expert's logs move wherever it fused in battle: one commit, first, so they move once.

### 2. Elements (content ~1 h, sim ~1 h, interface ~1 h)

- An element is one record with one local rule (a status, a piece relic on a moment, or a Legendary with a rule). It reads something the player can pump and never counts a team.
- One new field in `turns.js runEffect`: a relic's damage may be `per: { status }` (its amount once a stack) or `per: { tag }` (once a status of the tag), nothing on a bare target; `consume: true` spends what it counted.
- Two statuses: Rooted (debuff, 1 turn, Move `set` to 0 so Hasten cannot lift it) and Bloodlust (buff, the battle, 8 stacks, +6% ATK a stack), each with a `STATUS_WORTH`.
- Six piece relics: Snare (Uncommon, on blow: Rooted); Butcher's Hook (Rare, on kill: Bloodlust to self); Powder Keg (Rare, on blow: 10 true a stack of Burning, consumed); Glass Hammer (Rare, on blow: 12 a stack of Brittle, consumed); Headsman's Hood (Rare, on blow: 25 to a Hexed foe, the Hex left); Plague Mask (Rare, on blow: 8 a harmful status).
- Four Legendaries with rules in `rules.js`, on hooks that exist: Reaper's Hunger (`onKill` during your orders only, never a counter's or a tick's kill: `acted` false again); Seven-League Boots (`modify`: `moved` ≥ 3, ×1.5); Last Candle (`onTurn`: Monarch below half, Desperate one turn, relaid); Grave Powder (`onFall` of a shadow of yours, the holder standing: 20 true damage beside it).
- `codex.js ruleFlares` must name a relic's rule (the codex test holds every `rule` event to a flare). `test/content.test.js` pins the Legendaries' list and checks each effect's keys: add the four, and allow `per` and `consume` on a relic's flat damage. The expert prices a `per` damage at a stack and a half (`autoplay.js triggerShare`), the rules at the flat Legendary share. Remake the book (`npm run combos`).
- A test an element: Move 0 under Hasten; stacks and cap; each payoff on a Golem's DEF, spent or not; the act refunded twice, never in the foes' turn; the Boots after 3 tiles, not 2; the Candle lapsing; the Powder beside the shadow alone.
- A built draft of steps 1 and 2 is `plan/elements-and-no-battle-fuse.patch` (24 files, applies to this commit; it passed 536 tests, then was reverted to write this plan). Read it before building; apply it only after reading.
- Later: a Burning cap lifter, a Bleed that ticks per tile walked, a Feed kept between rooms, a ward that strikes, a counter by DEF, Charge, a wide army's bonus, a turtle's payoff.

### 3. The next balance pass

- Relics: worth 0 because they are bought on floor 3 and runs die on floor 1. Levers: a relic in an elite's or a boss's spoils, an early Shop, or the elements.
- Viability: kins whose one floor-1 kind is melee die there under strict commitment. Levers: a shooter a kin on floor 1, or judging a kin as its Monarch.
- The ladder's top on the outside teacher at ~60%; level 0 on the expert at ~90%, a fusion's price 8 → 6 confirmed on fresh seeds.
- The recruit forest refitted on whole runs, then diversity read again. Instruments as before: strict rows, free play, fresh seeds, every comparison paired.

## Standing rules

- Enemy behaviour is discovered, never previewed. Defeat is absolute. Floor 1 is hard at the top of the ladder, winnable at its foot.
- One soul is one piece. A fusion is never weaker than its parts. Money always matters.
- Content is data; code grows only when the vocabulary grows. Balance once, at the end.
- Measure with the right instrument, pair by seed, never keep a change on the seeds it was chosen on.
- One landscape interface, nothing that needs hover or a key. Recruit only.
