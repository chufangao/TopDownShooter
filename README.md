# RETINUE: design

2026-10-18. Everything a session needs is in this file and the code; the full history is the git log.

## What it is

- A turn-based tactics roguelike in the browser: a necromancer's retinue holds a line against foes walking down to the Monarch.
- A run: draft one soul, walk three floors of rooms (fights, elites, altars, a boss a floor; the Shop open wherever essence is spent), at ascension 0–10, as one of four Monarchs. Saves, a history, a tutorial, music.
- A battle: foes enter in waves along one drawn road toward your camp. Each piece moves and acts once a turn: a free basic, or a skill that then rests. End Turn: idle pieces use basics, the foes play, statuses tick. No dice. Lost the instant the Monarch falls, or nothing of yours but the Monarch stands.
- Between battles, essence buys growth for a soul: tiers (two tracks of four, each soul's own), relics (one held a soul), recruits (one slain foe a battle, fresh) and fusions (52 recipes, on the Shop's shelf: souls and essence traded for a fresh soul, the parts' tiers paid back). A won battle makes every soul whole again, the fallen too; the Monarch's HP carries, and altars heal it, transmute or consecrate. Eleven synergies of kin and role at four pieces.
- Statuses (Burning, Hexed, Brittle, Bleeding, Hasten, Rooted, Bloodlust…), each a stat mod or a tick. Elements: piece relics and Legendaries that read a status or a piece's own movement.
- Not a card game: no deck, hand, energy, discard or exhaust.

## Where things live

- Content is data: `src/content.js` (the records: units, abilities, statuses, synergies, relics, fusions, Monarchs) and `src/tuning.js` (the numbers). Code grows only when the vocabulary grows.
- The battle, shipped: `src/sim/turns.js` (the turn, effects, orders, previews), `unit.js` (stats, the board), `rules.js` (the rule registry: synergies, capstones, bosses, Legendaries), `field.js` (roads), `foe.js` (the camp's play: the danger map, a unit's options, the foes' turn).
- The run, shipped: `src/sim/run.js` (actions and their handlers, the camp, fusions, the Shop and the altar, a battle's setup and close), `state.js` (the readers of a run's state), `economy.js` (prices, refunds, a soul's tiers and level, rewards, offers, the shelf), `spawn.js` (rooms, foes, bosses, the army), `map.js`, `save.js`, `history.js`, `rng.js`.
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
- The shipped expert, its forest and the combo book were fit before the rules of 2026-10-18's evening (full heals, overrun, the shrug, the 6-turn press, the lethality band): the refit follows them.

## Decisions of 2026-10-18 (the user's word)

- Nothing is cut but the two DEF wards: the triple rule, the trines' own tracks, the relic shelf's size and the synergies stand as they are.
- The Shop is open wherever essence is spent, and sells fusions.
- Movement is a channel the elements read.
- The draft is one soul: the Monarch's kin is the plan, the two empty Command slots the first two recruits.
- The forests and the calculator stay, for the balance passes to come.
- Every soul is whole after a won battle, the fallen standing again in their cells: no wound and no fall of a soul carries between battles. The Monarch's HP is the run's: it carries from battle to battle, and only an altar's heal (the Monarch's alone now) or an HP relic mends it.
- A battle is lost the instant it cannot be won: the Monarch's fall, or nothing of yours but the Monarch standing (overrun). The Monarch has no blow of its own.
- No unit is Hexed twice in a row: once a Hex has cost it an act, it shrugs off every Hex until it has acted again.
- Standoffs end in a few turns: the camp's pressure runs its course in `policy.press.turns` (6), a foe that can land no blow comes on at an aggression of at least `policy.walk`, and Regen heals a share of max HP.
- Every draft offer holds a ranged kind. Every walk meets every threat type but Fly; Fly comes by the draw and to an elite that answers the army. The Map marks a room ahead whose threat nothing fielded can answer.
- A battle room is entered only with a living soul on the field. With nothing of yours to order, the turn ends by itself. A tile of a walk is 120 ms, the foes' stage 250 ms, and a line of foes walks as one.
- Skill rests stay at 2: a rest of 1 would leave the cooldown vocabulary (Hasten's second half, Arcane Focus, Quicksilver, Gossamer Standard, Court of Frost) with nothing to do.
- The lethality band: `damage.atkDivisor` 16, provisional, so a same-tier foe falls to about three or four basic blows (a level-2 Tomb Knight fells a level-1 Grave Ghoul in 4; the Ghoul fells the Knight in 8). The balance pass sets the number.

## Decisions of 2026-10-18, evening (the user's word): one upgrade mechanic

- Every upgrade enhances one soul, never a kind: a soul's two tracks of tiers, its level (its tiers' alone, `levelOf`), its one relic. There is no kind record (`s.kinds`, `least`, a kind's level are gone); a recruit joins fresh at the first level (Soul Lantern's free tiers in) and is priced by its tier alone; a transmuted soul keeps its tiers by index on its new kind's tracks.
- A fusion is a trade: souls and essence in, one fresh soul out (first level, no tier, no relic) in the ossuary; the tiers the parts held pay back `essence.refund` of their price, as a released soul's do on top of half its recruit price. The parts picked are the least grown. No track merging, no level carry: the fused soul starts over.
- Everything bought is a trade on one shelf, in words: a tier, a relic, a fusion, a recruit. The Shop as the one screen for them (the soul's panel its filter, the spoils and the altar its modes) is the next step; the rules are in.
- Reversed: "a tier is the kind's" (2026-10-10). Kept: relics held one a soul, the trines' own tracks (content), Arise a holder's skill, fusion a recipe, tier-V placement cancelled. The expert, its forest and the combo book were fit on per-kind tiers: the refit follows.

## Decisions of 2026-10-19 (the user's word): intents on the board

- Every unit's exact intent is drawn in battle, if End Turn came now: each foe's walk (dots down its road to a faint ghost where it stops), whom it strikes from there (a line, the damage over the struck, FALLS, SCREENED past a screen), a heal's number, HOLDS for one that does nothing, HEXED for a lost act; each of yours left untouched the same, but the selected one. Read on a fork of the sim (`turns.js intents`, the End Turn card's `untouchedPreview` its first half), so it is exact for the board as it stands and changes with every order. Tapping a foe draws its intent in full and the rest faint (and, of a kind met, its whole reach as before).
- Reverses "enemy behaviour is discovered, never previewed" (2026-10-05). A kind's reach and way are still learned by meeting it.

## Standing rules

- Every piece's intent is on the board, exactly, as the board stands (2026-10-19); what a kind could do is learned by meeting it. Defeat is absolute. Floor 1 is hard at the top of the ladder, winnable at its foot.
- One soul is one piece. Growth is a soul's own. A fusion is never weaker in power than its parts. Money always matters.
- Content is data; code grows only when the vocabulary grows. Balance once, at the end.
- Measure with the right instrument, pair by seed, never keep a change on the seeds it was chosen on.
- One landscape interface, nothing that needs hover or a key. Recruit only.
