# RETINUE

A small turn-based necromancer game in the browser. You are the **Monarch**, a necromancer who stands in its
own camp, never strikes, and leads an army of the dead down three floors, choosing the route room by room. A run
begins with a draft: three picks, each of one soul from three kinds offered.
Between battles you buy tiers for your kinds with essence, fuse souls into colossi, recruit one slain foe a
battle into the ossuary, buy relics in Shops, give each relic to a soul, and place your pieces around the
Monarch's seat. A battle is played in turns on that same board: each of your pieces moves, then acts, and the
living enemy answers as one opponent, walking the roads the board draws and striking what it can. There are no
dice and no clock; a battle is lost only when the Monarch falls, and that ends the run. Hold the Arise relic and
its holder can raise slain foes as shadows. Slay the Hollow Sovereign at the bottom of floor 3 to clear the run,
then descend into the endless deep for as long as you last.

## Playing

- **The run.** Three floors, each a map of ranks: a walk through one is fifteen rooms, the last a boss and its court
  (on floor 3, the Sovereign's siege). A clear is some 35–40 battles; the expert gives about 950 orders in one. The run is saved in
  this browser after every move you make, a battle's orders among them: close the page when you like, and the title's
  **Continue** (where the run stands written beside it) puts it back as it was, mid-battle too. A run cleared or lost
  leaves no save, and a new run over a saved one asks first. A save from an older version of the game that no longer
  plays the same is set aside with a note.
- **The tutorial.** One battle before floor 1, the threshold: three souls given you, three foes, and three short
  screens of text (the camp, the battle, the spoils). The title offers it on a first visit and keeps a Tutorial button;
  it is never saved, and ends back on the title.
- **The ascension.** The title screen's − and + choose the level a run is played at, from 0, the base game, up to
  10: each level's foes have more HP and ATK, its fights and elites more foes, its waves come sooner, the Monarch has
  less HP and every price is dearer (the line under the chooser says what moved). Clearing a level opens the one above
  it; level 0 is always open. The level is kept in the URL (`?ascension=`) and in this browser, and shown beside the
  floor in the top bar.
- **The daily.** The title's **Daily** is the day's run, the same for everyone: the seed `daily-YYYY-MM-DD` of the
  UTC day, always at ascension 0 whatever level is chosen. The first you begin each day is your daily; any after it the
  same day is practice, and the History marks it so. A new one comes at midnight UTC.
- **The History.** Every run you end in this browser is kept, cleared, fallen or left for a new one (not the
  tutorial): when, its seed or its daily, its level, how far it went, the battles won, how long you played it, the
  kinds it ended holding most (its fused kinds marked) and its kin, and what felled the Monarch. The title's
  **History** lists the last 100, newest first, by tab (every run, the clears, the dailies), beside the totals of all:
  runs, clears, the best level cleared, the time played.
- **Sound and music.** Effects and music are made in the browser as they play, no files. A quiet loop a floor (the
  title's, each floor's, the deep's), with a heartbeat and an ostinato over it in battle. The speaker turns all sound
  on or off (M); the note beside it the music alone; How to play's Basics ends with both and the music's volume. Nothing
  sounds before your first tap or key, nor while the page is hidden.
- **The draft.** A run opens with the Monarch alone. Pick three souls, each from three kinds drawn from floor 1's
  foes by the run's seed. The second and third picks each offer at least one kind that goes with a soul you hold, of
  its kin or the other part of a recipe, so two of a kind (two thirds of its trine) or a recipe begun is a choice from
  the start.
- **The Field.** Arrange your souls on the Field tab before you enter a battle room: entering one starts its fight.
  Drag a soul onto a tile to place it, swap by footprint, open a kind's panel to buy tiers, tap Fuse when a recipe's
  parts are in the ossuary; a soul selected on the board shows its reach. Tap a relic in the relic strip, then a soul,
  to give it (a soul holds one piece relic). Run relics (Command, the Monarch's HP, prices, a kin's banner) work
  unheld.
- **Fusions.** Three of any kind of tier 4 or less fuse into its **trine**, two tiers higher, its blows at one foe
  now blasts and its shots a tile longer (a trine of tier 4 or less has its own; the Will-o'-Wisp's is the Pale
  Court); mixed recipes join kinds, and seven capstones join fused kinds into pieces of tier 5 and 6. The Codex's
  Fusions page lists the mixed recipes and the capstones, and a tile for each trine, its card beside them; a kind's
  card names its trine. A trine stands as three of its kind, a capstone in its lender's picture washed pale.
- **A battle.** Tap a piece to light its Move and its targets. Tap a tile to move (Undo, or tap the old tile,
  until it acts). Tap a target to see the blow and the counter it draws; tap it again to strike. A skill is a
  button, then a target; it rests a few turns. **End Turn** hands the field over: pieces you gave no act strike
  with their basic blow, then the foes move. Play on end-turn alone and you die on floor 1. Tap a foe for its card; a
  foe of a kind you have met (fought in a battle before) also lights its reach in red: the road it could take within
  its Move, and every tile it could strike from there next turn. What it could do, never what it will: nothing of the
  foes' coming turn is drawn, and a kind not met shows nothing more than its card.
- **The bosses.** Floors 1 and 2 each end in a floor's boss, one of four, chosen as the floor opens (on floor 1 once
  the draft is done) to answer what your army leans on most: casters (Channelers) meet the Mire Mother and her court of
  hexing hags; souls whose blows lay statuses, the Molting Abbess, who sheds every curse on her as her turn begins, Molts
  and Purges, among wardens and pages who purge; shooters (Rangers, and souls whose basic blow is a shot down a line),
  the Barrow Marshal behind a front row of Vanguards, every shot at its side but a Vanguard landing on a Vanguard beside
  it while it stands; walls (souls that fight in melee alone), the Swarm Queen, who flies over them with a court of
  drones and hatches more. A tie, or an army leaning on none, is drawn by the run's seed. The boss and its court are on
  the map from then, as every room's foes are, its tip saying what it came for; its fall crumbles its court, and it pays
  an elite's bounty and offers a recruit of its court (never itself). Elsewhere, where none of a floor's elites brings a
  threat your army has no answer to, one is drawn again to bring one. Each boss has a phase, flared as its HP crosses
  it; its pictures are a foe's, washed pale and drawn as big as the Sovereign's.
- **Shops** sell relics, the only place they come from. Elites pay essence and offer their recruit.
- **Altars** grant one rite of three: **heal** every soul and raise the fallen; **transmute** a standing soul into one
  of three kinds of the floor's foes at its tier, drawn by the seed, keeping its relic, its wounds and its level (tiers
  stay with their kind: the old keeps those bought for it, the soul takes its new kind's); or **consecrate** a kind, its
  next tier on a track you choose, free. A fused soul cannot be transmuted: it is made, not met.

## Running it

```
npm start         # serves the game (node serve.js [port]); open the printed URL, phones on the same Wi-Fi too
npm test          # the functional tests (node --test)
npm run build     # the store build: dist/, what the game ships and nothing more, and a service worker
node serve.js 5174 dist   # serves the build: installed (Add to Home Screen, Install), it plays offline
```

The build (`build.js`) takes index.html, its stylesheets, font, manifest and icons, every module `src/main.js` reaches by
its static imports, and `src/assets/` (122 files, 3.4 MB, Phaser 1.3 MB of it); never the offline tools, the expert's
file, the tests or `press/`. Its hash marks `dist/index.html` and names the service worker's cache: the worker caches
every file and serves them first, and is registered only on a build's page, so `npm start` runs none.

## The autoplayer

`src/sim/autoplay.js` plays whole runs at two levels, `basic` (rules of thumb) and `expert`. The expert never
simulates anything to decide: it reads the situation, runs it through a decision tree of hard rules and weights, and
then random forests mined offline from playouts correct its choices where they are confident: each piece's move and
act in battle, the recruit and the formation, and the route. The whole expert is one file, `src/sim/expert.json`: its
tree and weights at the top, its parts (`forest`, `outforest`, `route`) beside them (`npm run bundle` sets or splits
them; `--paired expert:a.json,expert:b.json` compares two experts on the same seeds).

The forests are fitted on labels made by playing each candidate out, offline: every option of a piece's decision to
the battle's end, every recruit to the run's end, every formation through the battle it opens. The same playouts make
the **teacher**, a slow player that takes the best of them (`teach.js --teacher`; out of battle `outside.js`): it is
never shipped, and its clear rate is the ceiling of play (every battle is on the screen and combat is deterministic,
so it calculates only what a player could).

```
npm run sim -- [--runs 8] [--seed sim] [--level expert] [--ablate orders]   # a balance report
npm run ladder -- [--ascension 0|<a,b,…>|all] [--teacher] [--runs 8]
                      # the rungs (basic, the calculator, the expert; the outside teacher by --teacher) on the same
                      # seeds at each level of the ascension ladder, and the gaps between them
npm run builds -- [--player expert|teacher] [--commit <archetype>|all|fused|synergies] [--strict] [--ascension 0] [--scale 1] [--runs 256] [--seed div]
                      # the harness: free play and each build committed, on the same seeds (--strict: held to it)
npm run pool          # what a run can gather: each floor's draws, the battles offering each kind, each recipe's reach
npm run ablations     # how much each mechanic carries the expert (--variants a,b to choose)
npm run necessity     # the same as a fast battle-level proxy
npm run decisions     # how much the player's choices decide battles
npm run audit         # what the expert considered, and which rule decided
npm run combos        # rank the combo book into src/sim/combos.json
npm run sim -- --paired a,b --runs 768 --seed chk   # two experts on the same seeds (forest:<f>, outforest:<f>, route:<hand|learned|f>, none)
npm run teach         # labels: a piece's options played out (--draw state, --augment, --teacher for the teacher's ceiling)
npm run outside       # the teacher out of battle, and its labels (--label --phases recruit,spend,prep)
npm run forest        # fit the battle forest; npm run outforest: the recruit's and the formation's
npm run bundle -- --forest f.json   # ship a fitted part into src/sim/expert.json (--split dir: each part as its own file)
```

Ablations: core `orders`, `tracks`, `summons`; `formation` (reported without a band); extras `fusions`,
`legendaries`, `relics`, `synergies`.

The harness (redesign.md §3) measures the builds. An archetype is a fused kind or a synergy, as content makes them; a
run committed to one reads the book's combos for it alone (those that fuse it, or reach its kin's or role's count), so
its draft, recruits, purchases and route follow it, and so do the outside teacher's candidates (`--player teacher`).
That is a nudge: the expert still buys what its sketch rates strongest. `--strict` holds a committed run to its
archetype as an ablation holds a run from a mechanic, a harness rule over the frozen expert and never the default: its
kinds (a fused kind's recipe graph, or every kind of a synergy's kin or role) are drafted and recruited where offered
(a recruit taken whatever keeping would while the archetype is short of that kind), a soul let go is never of them
while another will do, no fusion is made outside its recipes (a synergy's: those whose result is of its kin or role),
in battle or out, and no transmutation turns one of its souls into another kind; the Shop, the altar's other rites, the
route, prep, battle, and the recruit where none of its kinds is offered stay the expert's (or the teacher's).
`--builds` prints a row an archetype: clears, progress against free play seed for seed, deaths by floor, the margin
(the Monarch's and its pieces' HP as the last battle ended, essence left, battles lost, turns a battle), and how many
runs made its fusion or held its synergy, and on which battle; then free play's diversity block (the archetypes of the
final armies, kinds held, fusions made, synergies held, relics bought), checked against criterion 3, and the altars'
rites taken and the runs whose leading kin or fused kind turned after floor 1. `--ascension` plays them at a level of
the ladder (any report takes it: `npm run sim -- --ascension 5`); `--scale` multiplies every foe's HP and ATK on top of
it, an override for probing. `--pool` reads `spawnPool` and the floors as drawn: each floor's share of a fight's
and an elite's draws by kind, the battles on a walk offering each kind and the draft's picks, and each recipe's reach
by the end of floor 2 (criterion 1).

## Code map

- `src/sim/` is pure, seeded and DOM-free. `turns.js` the battle; `policy.js` the one policy (the camp's turn,
  the expert's); `rules.js` the rules registry (synergies, Legendary relics, capstones, boss overrides); `field.js` the
  roads and tile index; `unit.js` stats, reach, footprints; `run.js` the run state machine (`apply`, `replay`; the
  tutorial's run, `tutorialRun`); `save.js` a run saved (its createRun options and its log) and played back; `history.js`
  the runs kept (a run's line, the book of them, read as far as it holds) and the daily's seed; `map.js`
  the floors; `expert.js` the decision tree and weights; `forest.js` and `outforest.js` the forests (and
  their fitting; `forest.js` holds the label rows' encoding the forests read); `autoplay.js` the players and CLI;
  `rng.js`. Offline only, never imported by play: `teach.js`, `outside.js` (labels and the teachers), `fit.js` (the
  learned route's fit), `calc.js` (the calculator, a weight-free player and the novice rung, and a rollout teacher
  over it: redesign.md §3, §8). The earlier learners (V, the ranker), the stronger battle teacher and the turn's beam
  were removed on 2026-10-15 (redesign.md §8).
- `src/content.js` is all content as records, one per unit, ability and relic, and the one rule that makes the trines
  a kind has no record for (`trineOf`, redesign.md §4.1); `src/tuning.js` every balance number (`TUNING`, the trines',
  the expert's and the ascension's tables included).
- The interface: `src/main.js` (composition), `ui.js` (screens), `board.js` (the Field's board), `engine.js`
  (Phaser, battles only), `codex.js` and `keywords.js` (rules text generated from content), `frame.js` (one
  scaled landscape layout), `dom.js`, `sfx.js` (the effects), `music.js` (the loops), `css/`. `build.js` makes the store
  build, `serve.js` serves the game or the build.
- `test/` holds the functional tests. `redesign.md` is the improvement plan (and says where the rules live: the
  code's comments, and the superseded spec at `git show f8c536f:redesign.md`); `DESIGN.md` still holds the board,
  roads, essence, tracks, fusions, summons and the frame.
