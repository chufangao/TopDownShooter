# RETINUE: design

2026-10-18. Everything a session needs is in this file and the code; the full history is the git log.

## What it is

- A turn-based tactics roguelike in the browser: a necromancer's retinue holds a line against foes walking down to the Monarch.
- A run: draft one soul, walk three floors of rooms (fights, elites, altars, a boss a floor; the Shop open wherever essence is spent), at ascension 0–10, as one of four Monarchs. Saves, a history, a tutorial, music.
- A battle: foes enter in waves along one drawn road toward your camp. Each piece moves and acts once a turn: a free basic, or a skill that then rests. End Turn: idle pieces use basics, the foes play, statuses tick. No dice. Lost when the Monarch falls.
- Between battles, essence buys tiers (two tracks a kind), recruits (one slain foe a battle), fusions (44 recipes, on the Shop's shelf) and relics. Altars heal, transmute or consecrate. Eleven synergies of kin and role at four pieces.
- Statuses (Burning, Hexed, Brittle, Bleeding, Hasten, Rooted, Bloodlust…), each a stat mod or a tick. Elements: piece relics and Legendaries that read a status or a piece's own movement.
- Not a card game: no deck, hand, energy, discard or exhaust.

## Where things live

- Content is data: `src/content.js` (the records: units, abilities, statuses, synergies, relics, fusions, Monarchs) and `src/tuning.js` (the numbers). Code grows only when the vocabulary grows.
- The battle, shipped: `src/sim/turns.js` (the turn, effects, orders, previews), `unit.js` (stats, the board), `rules.js` (the rule registry: synergies, capstones, bosses, Legendaries), `field.js` (roads), `foe.js` (the camp's play: the danger map, a unit's options, the foes' turn).
- The run, shipped: `src/sim/run.js` (actions and their handlers, the camp, fusions, the Shop and the altar, a battle's setup and close), `state.js` (the readers of a run's state), `economy.js` (prices, levels, rewards, offers, the shelf), `spawn.js` (rooms, foes, bosses, the army), `map.js`, `save.js`, `history.js`, `rng.js`.
- The page, shipped: `src/main.js` (the run's flow), `src/ui/` (one screen a file; `src/ui.js` re-exports them), `src/engine/` (Phaser: palette, textures, marks, geometry, the battle scene, the timeline player; `src/engine.js` the entry), `board.js` (the prep board), `codex.js` (the rules' text), `dom.js`, `keywords.js`, `frame.js`, `music.js`, `sfx.js`, `src/css/`.
- The expert, never shipped: `src/sim/policy.js` (its battle turn), `plan.js`, `expert.js` (the model tree), `forest.js` (the battle forest as play reads it), `player.js` (its play out of battle: route, formation, growth, recruits, the combo book), `reports.js` (the balance reports), `autoplay.js` (the command line; re-exports the two).
- The offline tools: `teach.js` (the battle teacher and its labels), `outside.js` (the outside teacher and its labels), `fit.js` (the model tree's fitting), `forestfit.js` and `outforest.js` (the forests' fitting), `calc.js` (the calculator, the ladder's second rung), `sequential.js`, `runcache.js`, `bundle.js` (the parts of `expert.json`), `pool.js` (worker threads), `cli.js`. `src/sim/expert.json` is the shipped expert (its tree, forest, outforest and route); `combos.json` the book.
- `build.js` writes dist/ (what ships, and nothing of the tools); `serve.js` serves either tree; `test/` is the suite (`npm test`, functional only: no win-rate assertions until the balance pass).
- The code's comments say the rule, not the history: git holds the history. The autoplayer (`npm run sim`) is the measuring instrument, and frozen: refitted only on a paired gain over fresh seeds.

## State (2026-10-16)

- Expert free play at ascension 0: 85% clears (target ~90%), every death on floor 1.
- 36 of 44 recipes reachable; 4 of 15 archetypes viable; the Pale Court in 66% of final armies; relics worth 0 points.
- The novice reaches floor 2 in an eighth of runs (target half). The ladder keeps its order; its top row is unplayable.

## Next

Landed on 2026-10-18: fusing out of battle alone; the elements (two statuses, six piece relics, four Legendaries); the Shop open between battles with fusions on its shelf, Barkskin and Veiled merged into one ward; movement as a channel (six elements that read a piece's own tiles moved); the draft of one soul; floor 1's first rooms sized to it. What remains is the measurement.

### The next balance pass

- Relics: worth 0 because they are bought on floor 3 and runs die on floor 1. Levers: a relic in an elite's or a boss's spoils, an early Shop, or the elements.
- Viability: kins whose one floor-1 kind is melee die there under strict commitment. Levers: a shooter a kin on floor 1, or judging a kin as its Monarch.
- The ladder's top on the outside teacher at ~60%; level 0 on the expert at ~90%, a fusion's price 8 → 6 confirmed on fresh seeds.
- The recruit forest refitted on whole runs, then diversity read again. Instruments as before: strict rows, free play, fresh seeds, every comparison paired.
- The expert's draft rule and floor-1 labels follow the draft of one soul in the refit.

## Decisions of 2026-10-18 (the user's word)

- Nothing is cut but the two DEF wards: the triple rule, the trines' own tracks, the relic shelf's size and the synergies stand as they are.
- The Shop is open wherever essence is spent, and sells fusions.
- Movement is a channel the elements read.
- The draft is one soul: the Monarch's kin is the plan, the two empty Command slots the first two recruits.
- The forests and the calculator stay, for the balance passes to come.

## Standing rules

- Enemy behaviour is discovered, never previewed. Defeat is absolute. Floor 1 is hard at the top of the ladder, winnable at its foot.
- One soul is one piece. A fusion is never weaker than its parts. Money always matters.
- Content is data; code grows only when the vocabulary grows. Balance once, at the end.
- Measure with the right instrument, pair by seed, never keep a change on the seeds it was chosen on.
- One landscape interface, nothing that needs hover or a key. Recruit only.
