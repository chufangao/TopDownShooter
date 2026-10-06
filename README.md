# RETINUE

A small necromancer autobattler in the browser. You lead a retinue of bound souls through four
floors, choosing your route room by room. Battles play out on their own: your only say is who stands
where before they begin, and what you make of them between battles. Every foe your retinue slays pays
essence, which buys levels, upgrade paths and the souls of the slain. Beat the boss at the end of floor 4, or lose the moment a battle goes against you.

## The gameplay loop

A run is four floors. You start with three level-2 souls (Tomb Knight, Bone Chanter, Frost Sprite)
and try to grow them into a retinue strong enough to kill the Hollow Sovereign at the bottom. Every
run follows the same loop:

```
 ┌──► MAP: scout the rooms, spend essence, pick the next room ───────┐
 │       │ fight / elite / boss    │ reliquary │ rite      │ altar   │
 │       ▼                         ▼           ▼           ▼         │
 │    PREP: arrange the field,  1 of 3      1 of 3      heal all,  │
 │       │ spend essence         relics      path tiers  raise the  │
 │       │ Begin                   │           │         fallen    │
 │       ▼                         │           │           │       │
 │    BATTLE: plays out alone      │           │           │       │
 │       │ win          │ loss     │           │           │       │
 │       ▼              ▼          │           │           │       │
 │    SPOILS: essence;  RUN OVER   │           │           │       │
 │    recruit the slain            │           │           │       │
 └───────┴─────────────────────────┴───────────┴───────────┘       │
   after the floor's last room → next floor (boss on floor 4) ◄──────┘
```

### 1. Scout and choose a room

Each floor is a one-way map: a start, fourteen ranks of 2–4 rooms, and a final room. It's an elite
on floors 1–3 and the boss on floor 4. You can only move forward to a room connected to the one
you're in, so taking one branch gives up the rooms on the others. A floor is 15 rooms long, and its
foes grow stronger the deeper into it you go. The first rank is all fights, no elite stands before
the fourth, and a floor holds one or two reliquaries. The map scrolls, and opens on the room you stand in.

Every battle room's foes and formation are fixed when the floor is made. Hover any battle room, even
one you can't reach yet, to see the formation waiting there, its synergies and a **threat** rating.
Threat compares the foes' power with your field's, `√(HP × ATK × gauge rate)` summed per side with
wounds counted: below 0.6× the basic autoplayer almost always wins, around 1.0× it is a coin flip, and from
1.2× it usually loses.

| Room | What happens |
|---|---|
| Fight | 3–5 foes (more on deeper floors). Win essence, and the chance to recruit the souls you slay. |
| Elite | One more foe than a fight, a tier tougher. Essence and recruits, plus 1 of 2 relics, free. |
| Reliquary | No fight. Pick 1 of 3 relics. A floor's middle holds one or two. |
| Rite | No fight. Pick 1 of 3 path tiers for your souls, free. A floor's middle holds one or two. |
| Altar | No fight. Full heal, and the fallen rise at 50% HP. The rank before each floor's final room always has exactly one. |
| Boss | The Hollow Sovereign alone. It leaves no soul and gets stronger at 60% and 25% HP. |

### 2. Prepare the camp

Entering a battle room opens prep: their formation above your camp. This is the only place a battle
is decided by you. Up to 6 souls stand in the **camp**; the rest wait in the **ossuary** (the bench),
where they do not fight. Up to 12 souls in all.

- Click a soul, then a cell or another soul, to move or swap them. Click the ossuary to bench one.
- **The camp** is 7×7 cells, and each floor draws a different one from a hand-made list for that
  floor (3 per floor, in `CAMP_LIST` in `src/content.js`), kept for the whole floor. Its **walls**
  block walking, yours and theirs, but not attacks: bolts fly over them. Floor 1's camps are open
  ground with a few stones; floor 4's are mazes.
- **The foes** always come from above: their 3×7 formation stands on open ground, one empty row
  above your camp. So the walls decide which way their melee has to walk to reach you, and where your
  own melee has to walk to reach them.
- Units walk one tile at a time until a foe is in reach: melee reaches the 8 tiles around, ranged
  abilities 3–4 tiles. A unit with a foe next to it is **engaged** and can't walk away.
- How a soul moves comes from its role. Where it stands is your only say:

  | Behaviour | Roles | What it does |
  |---|---|---|
  | Advance | Vanguard, Warden | Walks to the nearest foe and fights it. |
  | Hold back | Ranger, Skirmisher, Channeler | Walks only until a foe is in range, and never steps next to one while it has a ranged attack. |
  | Flank | Trickster | Slips around the line to hunt whoever hides at the back. Exactly who is left for the player to find out. |
- Synergies activate from how many fielded souls share a kin or role (Undead 2, Vanguard 2, …).
- **Bonds** come from the shape of the formation, and are fixed when the battle begins: a soul bonds
  with the one beside it in its row, or right behind or ahead of it in its lane. Phalanx (two
  Vanguards side by side, +20% DEF), Vigil (a Warden right behind a Vanguard), Spotter (a Skirmisher
  right ahead of a Ranger or Channeler) and Kinship (two of one kin side by side). ◆ marks a bonded
  soul in prep.
- Packing close pays in other ways too: a Tomb Knight's **aura** shields every ally next to it, and
  Bone Chanter's Dirge only reaches allies within 2 tiles. **Blasts** punish it: Ember Burst and the
  Hollow Sovereign's Grave Tide hit their target and everyone next to it, aimed wherever their targets
  stand thickest.
- **Your souls are the resource.** You hold up to 12, only 6 fight at once, the fallen stay down
  until an altar, and a full retinue must let a soul go before it can recruit another. Nothing grows
  on its own: every level and path tier is bought with essence, so who you keep, who you invest in and
  who you field is the run.
- **Spend essence** on the selected soul in the camp editor (on the map or in prep): its next level
  (up to 10, `6 × level^1.2` essence), or its next **path tier**. Every kind of soul has two or three
  upgrade paths of three tiers (`PATHS` in `src/content.js`). The first tier commits a soul to its
  path for good; tiers I–III cost 30 / 60 / 100. Tiers I and II raise stats; tier III changes what the
  soul does: a new or stronger ability, or an aura.

Hover anything for exact numbers: a unit shows its stats, every ability's gauge cost, timing and
effect and what clicking it would do; a room shows its formation and a threat
estimate; synergies, relics and buttons say exactly what they do. **H** opens How to play
from any screen, and each screen has a short guide you can hide.

You can also arrange your souls from the map. When you press Begin, the battle plays out on its own
in real time: each unit's gauge fills by speed, and it acts when the gauge covers its next ability,
using simple built-in priorities. With nothing in reach it spends 40 gauge on a step instead. Space pauses, 1 / 2 / 4 set the speed, and S skips to the result.
None of these change the outcome. Long fights escalate: all damage ramps up after 45 seconds (90 for
the boss), so nothing stalls.

### 3. Spoils

If you win, every foe slain pays essence into one purse, and every standing soul heals half its max
HP. The fallen stay down at 0 HP until an altar raises them. Then the soul of each kind of foe you
slew is for sale, at the level that foe fought at: recruit one if you can afford it, or move on. A
recruit joins the field if there is room, the ossuary if not. Elites also offer 1 of 2 relics, free.
With 12 souls you must release one before you can recruit another.

### 4. Go deeper

Clearing a floor's final room takes you to the next floor with your retinue, relics and wounds
intact. Foes get stronger and more numerous each floor. The run ends when you lose a battle (defeat)
or kill the boss on floor 4 (victory). Nothing carries over between runs.

### How progression works

The retinue gets stronger in four ways, all but relics bought with essence, and the foes keep up in
three. The code is the progression
section of `src/sim/run.js`; every number below lives in `src/tuning.js`.

| Retinue | How |
|---|---|
| Essence | Each foe slain pays `2.5 × tier × (1 + 0.35 × (level − 1))`; a run starts with 20. Nothing else grows a soul. |
| Levels | The next level costs `6 × level^1.2` (14 at level 2, 56 at level 9). Cap 10. |
| Paths | 2–3 per kind of soul, 3 tiers each, 30 / 60 / 100. Rites grant one tier free. |
| Recruits | One per won battle, from the souls you slew, at their level, for `8 × tier × (1 + 0.35 × (level − 1))`. Up to 12 held. |
| Relics | 19 run-long bonuses; one you already own is never offered. Reliquaries offer three, elites two. Some shape the economy (more essence, cheaper levels, tiers or recruits, more room) and some favour a role or kin. |

| Foes | How |
|---|---|
| Level | `1 + 2 × (floor − 1)`, plus up to 2 more across a floor's ranks: 1→3, 3→5, 5→7, 7→9. Elites are the same level as the rank they stand in, but a tier higher. |
| Numbers | Fights bring 3 / 4 / 5 / 5 foes on floors 1–4, elites 4 / 5 / 6 / 6. |
| Multipliers | Ordinary foes get ×0.8 / 0.88 / 0.92 / 1 HP and ×0.8 / 0.86 / 0.9 / 0.95 ATK on floors 1–4; the boss ×0.9 of both. |

`npm run sim` prints how this plays out per floor: field level, units fielded, roster size,
foes and relics.

## Run it

Everything works offline: no install, no build step, no network. Node 22+ is the only requirement.

```
npm start                      # http://localhost:5173 (node serve.js)
npm test                       # node --test, sim only, no browser
npm run sim                    # 200 headless autoplayed runs: clear rate, battle length, per-floor
                               # progression, and per camp layout, so an outlier camp stands out
npm run decisions              # how much your formation decides: every battle of 60 runs refought with the
                               # souls in random cells
npm run ladder                 # the skill range: 60 seeds played by the basic and the expert autoplayer
```

Each report takes `--runs N`, `--seed name` and `--level basic|expert` (expert by default), and plays its
runs in parallel, one worker thread per core.

The autoplayer behind the reports and the tests plays with the choices and the scouting a player has,
at one of two levels (`LEVELS` in `src/sim/autoplay.js`):

- **basic**, rules of thumb, and what the tests play: rooms by weighted dice, its strongest souls
  fielded, a few drafted formations (each role's row packed from the middle, the same spread out, and
  one that uses the walls: melee where foes walking in arrive first, ranged souls where foes have the
  furthest to walk), each rehearsed once against the scouted foes, the best kept; the first free
  offer; recruits only to fill the field; essence on the lowest level, or a path tier (its first
  path) once a soul has three levels per tier.
- **expert**, a planner, and what the reports play: every route over the next three rooms played
  out, the first room of the best one taken; wounds counted when fielding; the best draft then
  hill-climbed (swap two souls, move one, trade one with the ossuary) over two rehearsals each; free
  offers weighed by rehearsing the fights ahead; recruits worth more than the weakest soul it would
  field; essence on whatever buys the most worth per essence, each soul committed to the path whose
  three tiers add the most.

Either way it never sees a battle's own seed: it knows the rules but not the rolls, and the camp counts in
the balance numbers the way it does for a player. An expert run takes 10–20 seconds, so `npm run sim`
takes several minutes even spread over every core.

Add `?seed=anything` to the URL to play a specific run. In the browser console, `retinue.run.state.log`
is the current run's action log.

## Layout

```
index.html          page shell: stylesheet + src/main.js
serve.js            static file server for npm start
src/
  main.js           boot: Phaser engine + DOM UI; turns every input into apply(run, action)
  content.js        all game data: units, abilities, upgrade paths, statuses, kin/roles, behaviours, synergies,
                    bonds, camp layouts, relics, attack anims
  tuning.js         every balance constant
  sim/              pure game logic, runs in Node
    run.js            the run: apply, legalActions, replay; the retinue (place, release); encounters;
                      progression (essence, prices, levels, paths, foe scaling); rewards (recruits, relics, rites)
    battle.js         a fight: tick loop, effects and statuses, unit AI and movement, combat formulas;
                      takes no input
    unit.js           stats, modifiers, synergies, the camp and the foes' formation, bonds, the
                      board (tiles, walls, steps, reach, shapes, auras, engagement)
    map.js            floor generation
    rng.js            seeded RNG
    autoplay.js       the autoplayer for tests and balance runs, basic or expert (rehearses formations,
                      plays routes out); run directly for the balance, ladder or decisions report
  engine.js         Phaser, battles only: boot + picture loading, FX textures, battle scene, poses, timeline
                    player
  ui.js             DOM screens: title, map, prep, reap and end, the retinue editor, battle playback bar
  codex.js          rules text generated from content.js: unit stat cards, ability text, room and threat
                    tooltips, synergy tracker, the How to play overlay
  dom.js            element builder, the shared tooltip, SVG icons, portraits, per-viewer prefs
  style.css
  assets/units/     three SVG pictures per unit: <art>.alive.svg, .attack.svg and .dead.svg
  assets/props/     the camp walls (3 variants) and the tiling crypt floor, SVG
  vendor/phaser.js  Phaser 4.2.1 ESM build (MIT), vendored so the game runs offline; replace the file to upgrade
test/               run (incl. the fuzz test), battle, map, content, basics (formulas, rng, board)
```

## The rules of the sim

`src/sim/` is pure: no Phaser import, no `Math.random`, no `Date`. All randomness comes from the
seeded RNG in `src/sim/rng.js`.

A run changes only through `apply(run, action)`, and `legalActions(run)` lists every action `apply`
accepts right now:

| Phase | Actions |
|---|---|
| map | `{ type: 'node', id }` walk to a room (a battle room opens prep) |
| map, prep | `{ type: 'place', uid, slot }` move a soul to an open camp cell (0–48, not a wall) or the ossuary (−1); a soul already there takes the mover's old place · `{ type: 'level', uid }` buy its next level · `{ type: 'upgrade', uid, path }` buy its next tier on `path` (the first commits it) |
| map, prep, reap | `{ type: 'release', uid }` let a soul go (never the last one standing) |
| prep | `{ type: 'fight' }` resolve the battle; the run settles it (HP, essence, offers) on its own |
| reap | `{ type: 'reap', index }` recruit one soul for its price, or take a free relic or tier; taking one takes the others of its kind off the table; `index: null` moves on |

Battles take no input, so `fight` runs the whole battle at once. `run.setup` keeps what the battle was
built from, and the battle scene rebuilds it with `createBattle(run.setup)` and steps it in time with
the animations; the same setup always produces the same events. Every applied action goes into
`run.state.log`, and `replay(seed, log)` rebuilds the identical state. The UI, the autoplayer and the
tests all drive the game the same way, which is what lets `test/run.test.js` fuzz whole runs with
random legal actions, check invariants after every step, and assert that each one replays exactly.

## Testing and debugging

`npm test` runs 47 tests in about a minute, all in Node (most of it autoplaying whole runs):

- **run.test.js**: what `legalActions` offers in each phase, that illegal actions are refused
  without touching the log, scouted foes matching the battle, placing (never on a wall), each
  floor's camp, releasing, altars, reliquaries, rites, essence (levels, path tiers, priced recruits,
  including with a full retinue) and replay; that the autoplayer (both levels) stands souls only on
  open cells and rehearses and plays ahead without touching the run. The fuzz test plays 40 runs, a
  fifth of the actions random legal ones and the rest by autoplay, checks invariants after every action, applies a
  sample of every listed legal action to a replayed copy, and asserts each run replays exactly.
- **battle.test.js**: determinism (same seed gives the same timeline hash), phases, the bench, and
  movement (every battle in a real camp): every step is to a free neighbouring tile that
  neither is nor squeezes past a wall, no two units share a tile, and an
  engaged unit only walks away if its role slips; auras reach only adjacent allies, and bonds are set
  by the formation at the start; path tiers in a fight (a self-heal, a mod for one role).
- **map.test.js**, **content.test.js**, **basics.test.js**: floor rules over 500 seeds, that every
  content reference resolves (every path's tiers included) and every unit has its three pictures, that every camp is 7×7 with no
  sealed-off ground, and the formulas, RNG, placement, bonds, walls and board shapes.

To turn a bug you hit in the browser into a test, copy the run from the console and replay it:

```js
// browser console
copy(JSON.stringify({ seed: retinue.run.state.seed, log: retinue.run.state.log }))
```

```js
// test/run.test.js
const { seed, log } = /* paste */
const run = replay(seed, log)   // the exact state you saw; run.battle is the last battle fought
```

`replay` throws on the first action that is no longer legal, so it also tells you quickly whether a
content or tuning change has broken an old run.

## Adding a unit

Add one entry to `UNIT_LIST` in `src/content.js` (stats, kin, role, abilities, spawn weight)
and reference abilities from `ABILITY_LIST` in the same file. Give it two or three upgrade paths in
`PATHS`, three tiers each (`test/content.test.js` checks). Its `art` key names three pictures in
`src/assets/units/`, and those are all the art a unit needs:

- `<art>.alive.svg`: standing, ready.
- `<art>.attack.svg`: the instant its blow lands or its spell leaves its hands. It is the alive
  picture re-posed, with the feet and body in the same place, so the two swap without a jump.
- `<art>.dead.svg`: its corpse.

There are no animation frames. The battle animates the pictures in code (`strike` and `fall` in
`src/engine.js`): units breathe and hop as they walk; an attack winds up, snaps into the attack picture
with a lunge and recoils back; a hit knocks its target back; a death staggers, topples at the feet and
lands as the corpse in a puff of dust, where it stays. The prep screen and tooltips show the dead
picture for fallen souls.

To draw a unit, copy the three `tomb_knight` pictures and keep to their rules:

- A `0 0 96 96` viewBox with matching `width`/`height`. The feet stand at (48, 88), 11/12 of the
  way down, which is where the battle anchors the picture and draws its shadow. A bigger viewBox is
  drawn bigger, with the feet at the same 11/12: the heavyweights' is 120 and the boss's 144.
- 3/4 view facing the viewer, lit from the upper left, `#0d0a12` outlines. Foes are mirrored, so the
  pose has to work flipped. No team colours: the battle adds those.
- The attack picture exaggerates: the weapon swung through with a motion arc, or the spell bursting
  out, glows brighter than alive.
- The dead picture lies on the ground across the same box, with its glows out, and it must read as
  dead at portrait size (38 px).
- Plain shapes and gradients only: no `<text>`, `<image>`, `<style>`, scripts, filters or external
  references. Prefix gradient ids per file.

`test/content.test.js` checks that every reference resolves and that all three pictures exist with
the same square viewBox. It also asserts the unit count, so update that number too.

## License

GPL-3.0-or-later, inherited from the 2019 PyGame prototype. The prototype lives in git history at
commit `377c703`. `src/vendor/phaser.js` is Phaser 4.2.1 under the MIT License.
