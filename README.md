# RETINUE

A small turn-based necromancer game in the browser. You are the **Monarch**, a necromancer who stands in its
own camp, never strikes, and leads an army of the dead down four floors, choosing the route room by room.
Between battles you buy tiers for your kinds with essence, fuse souls into colossi, recruit one slain foe a
battle into the ossuary, buy relics in Shops, give each relic to a soul, and place your pieces around the
Monarch's seat. A battle is played in turns on that same board: each of your pieces moves, then acts, and the
living enemy answers as one opponent, walking the roads the board draws and striking what it can. There are no
dice and no clock; a battle is lost only when the Monarch falls, and that ends the run. Hold the Arise relic and
its holder can raise slain foes as shadows. Slay the Hollow Sovereign at the bottom of floor 4 to clear the run,
then descend into the endless deep for as long as you last.

## Playing

- **Prep.** Drag a soul onto a tile to place it, swap by footprint, open a kind's panel to buy tiers, tap Fuse
  when a recipe's parts are in the ossuary. Tap a relic in the relic strip, then a soul, to give it (a soul
  holds one piece relic). Run relics (Command, the Monarch's HP, prices) work unheld.
- **A battle.** Tap a piece to light its Move and its targets. Tap a tile to move (Undo, or tap the old tile,
  until it acts). Tap a target to see the blow and the counter it draws; tap it again to strike. A skill is a
  button, then a target; it rests a few turns. **End Turn** hands the field over: pieces you gave no act strike
  with their basic blow, then the foes move. Play on end-turn alone and you die on floor 1.
- **Shops** sell relics, the only place they come from. Elites pay essence and offer their recruit.

## Running it

```
npm start         # serves the game (node serve.js [port]); open the printed URL, phones on the same Wi-Fi too
npm test          # the functional tests (node --test)
```

## The autoplayer

`src/sim/autoplay.js` plays whole runs at two levels, `basic` (rules of thumb) and `expert` (reads the
situation, runs it through a decision tree of hard invariant rules, then weights tuned by search; it never
simulates a battle to decide anything).

```
npm run sim -- [--runs 8] [--seed sim] [--level expert] [--ablate orders]   # a balance report
npm run ladder        # the gap between the levels
npm run ablations     # how much each mechanic carries the expert (--variants a,b to choose)
npm run necessity     # the same as a fast battle-level proxy
npm run decisions     # how much the player's choices decide battles
npm run audit         # what the expert considered, and which rule decided
npm run combos        # rank the combo book into src/sim/combos.json
```

Ablations: core `orders`, `tracks`, `summons`; `formation` (reported without a band); extras `fusions`,
`legendaries`, `relics`, `synergies`.

## Code map

- `src/sim/` is pure, seeded and DOM-free. `turns.js` the battle; `policy.js` the one policy (the camp's turn,
  the expert's); `rules.js` the rules registry (synergies, Legendary relics, boss overrides); `field.js` the
  roads and tile index; `unit.js` stats, reach, footprints; `run.js` the run state machine (`apply`, `replay`);
  `map.js` the floors; `expert.js` the decision tree and weights; `autoplay.js` the players and CLI; `rng.js`.
- `src/content.js` is all content as records, one per unit, ability and relic; `src/tuning.js` every balance
  number (`TUNING`, the expert's table included).
- The interface: `src/main.js` (composition), `ui.js` (screens), `board.js` (the prep board), `engine.js`
  (Phaser, battles only), `codex.js` and `keywords.js` (rules text generated from content), `frame.js` (one
  scaled landscape layout), `dom.js`, `sfx.js`, `css/`.
- `test/` holds the functional tests. `redesign.md` is the current spec; `DESIGN.md` still holds the board,
  roads, essence, tracks, fusions, summons and the frame.
