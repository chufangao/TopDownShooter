# RETINUE

A small necromancer autobattler in the browser. You lead a retinue of bound souls through four
floors, choosing your route room by room. Battles play out on their own: your only say is who stands
where before they begin. Every foe your retinue slays leaves a soul, and you reap one after each win.
Beat the boss at the end of floor 4, or lose the moment a battle goes against you.

## The gameplay loop

A run is four floors. You start with three level-2 souls (Tomb Knight, Bone Chanter, Frost Sprite)
and try to grow them into a retinue strong enough to kill the Hollow Sovereign at the bottom. Every
run follows the same loop:

```
 ┌──► MAP: scout the rooms, pick the next one ───────────────┐
 │       │ fight / elite / boss      │ reliquary  │ altar     │
 │       ▼                           ▼            ▼           │
 │    PREP: arrange the field     REAP:        heal all,     │
 │       │ Begin                  1 of 3       raise the     │
 │       ▼                        relics       fallen        │
 │    BATTLE: plays out alone        │            │           │
 │       │ win            │ loss     │            │           │
 │       ▼                ▼          │            │           │
 │    REAP: bind 1 soul  RUN OVER    │            │           │
 └───────┴───────────────────────────┴────────────┘           │
   after the floor's last room → next floor (boss on floor 4) ◄┘
```

### 1. Scout and choose a room

Each floor is a one-way map: a start, five ranks of 2–3 rooms, and a final room. It's an elite on
floors 1–3 and the boss on floor 4. You can only move forward to a room connected to the one you're
in, so taking one branch gives up the rooms on the others. A floor is 6 rooms long.

Every battle room's foes and formation are fixed when the floor is made. Hover any battle room, even
one you can't reach yet, to see the formation waiting there, its synergies and a **threat** rating.
Threat compares the foes' power with your field's, `√(HP × ATK × gauge rate)` summed per side with
wounds counted: below 0.6× the autoplayer almost always wins, around 1.0× it is a coin flip, and from
1.2× it usually loses.

| Room | What happens |
|---|---|
| Fight | 3–5 foes (more on deeper floors). Win to reap one of the souls you slay. |
| Elite | One more foe than a fight, a tier tougher. Reap a soul, or claim a relic instead. |
| Reliquary | No fight. Pick 1 of 3 relics. |
| Altar | No fight. Full heal, and the fallen rise at 50% HP. The rank before each floor's final room always has exactly one. |
| Boss | The Hollow Sovereign alone. It leaves no soul and gets stronger at 60% and 25% HP. |

### 2. Prepare the camp

Entering a battle room opens prep: their formation above your camp. This is the only place a battle
is decided by you. Up to 6 souls stand in the **camp**; the rest wait in the **ossuary** (the bench),
where they neither fight nor gain XP. Up to 12 souls in all.

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
- **Merge**: three souls of one kind at the same star fuse into one of the next star (★2, then ★3),
  with ×2 / ×3.8 HP and ATK and full health. The strongest copy is kept, standing where the frontmost
  of the three stood. Three bodies outfight one merged soul, so merging pays off once you have more
  souls than field slots.

Hover anything for exact numbers: a unit shows its stats, every ability's gauge cost, timing and
effect, its element matchups and what clicking it would do; a room shows its formation and a threat
estimate; merges, synergies, relics and buttons say exactly what they do. **H** opens How to play
from any screen, and each screen has a short guide you can hide.

You can also arrange and merge from the map. When you press Begin, the battle plays out on its own
in real time: each unit's gauge fills by speed, and it acts when the gauge covers its next ability,
using simple built-in priorities. With nothing in reach it spends 40 gauge on a step instead. Space pauses, 1 / 2 / 4 set the speed, and S skips to the result.
None of these change the outcome. Long fights escalate: all damage ramps up after 45 seconds (90 for
the boss), so nothing stalls.

### 3. Reap

If you win, fielded survivors gain XP (levels raise stats, up to level 10), and every standing soul
heals half its max HP. The fallen stay down at 0 HP until an altar raises them, or a merge. Then you
are offered the soul of each kind of foe you slew, and bind one (or take nothing). It rises at your
retinue's median level and joins the field if there is room, the ossuary if not. Elites also offer a
relic in place of a soul. With 12 souls you must release one before you can bind another.

### 4. Go deeper

Clearing a floor's final room takes you to the next floor with your retinue, relics and wounds
intact. Foes get stronger and more numerous each floor. The run ends when you lose a battle (defeat)
or kill the boss on floor 4 (victory). Nothing carries over between runs.

### How progression works

The retinue gets stronger in four ways, and the foes keep up in three. The code is the progression
section of `src/sim/run.js`; every number below lives in `src/tuning.js`.

| Retinue | How |
|---|---|
| XP | After a win, every fielded survivor gets the *full* XP of all foes slain (it is not split). A foe is worth `2.5 × tier × (1 + 0.35 × (level − 1))`; the next level costs `28 × level^1.45` (76 XP at level 2). Level cap 10. The fallen and the benched get nothing. |
| Souls | One per won fight, at the retinue's median level, up to 12. Synergies come from the mix you field. |
| Merges | Three of a kind at one star → one of the next star, ×2 / ×3.8 HP and ATK. |
| Relics | 9 run-long bonuses; one you already own is never offered. Reliquaries offer three, elites one. Grave Banner adds a field slot. |

| Foes | How |
|---|---|
| Level | `1 + 2 × (floor − 1)`: 1, 3, 5, 7. Elites are the same level but a tier higher. |
| Numbers | Fights bring 3 / 4 / 5 / 5 foes on floors 1–4, elites 4 / 5 / 6 / 6. |
| Multipliers | Ordinary foes get ×0.8 / 1.02 / 0.84 / 0.95 HP and ×0.8 / 0.95 / 0.8 / 0.9 ATK on floors 1–4; the boss ×0.9 of both. |

`npm run sim` prints how this plays out per floor: field level, stars, units fielded, roster size,
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
```

The autoplayer behind both reports, and the tests, prepares each battle with the choices a player
has: it fields its strongest souls, then drafts a few formations (each role's row packed from the
middle, the same spread out, and one that uses the walls: melee where foes walking in arrive first,
ranged souls where foes have the furthest to walk), and rehearses each draft against the scouted
foes on a different battle seed, keeping the best. So it knows the rules but not the rolls, and the
camp counts in the balance numbers the way it does for a player. Planning costs a few rehearsals per battle: `npm run sim` takes a few minutes.

Add `?seed=anything` to the URL to play a specific run. In the browser console, `retinue.run.state.log`
is the current run's action log.

## Layout

```
index.html          page shell: stylesheet + src/main.js
serve.js            static file server for npm start
src/
  main.js           boot: Phaser engine + DOM UI; turns every input into apply(run, action)
  content.js        all game data: units, abilities, statuses, elements, kin/roles, behaviours, synergies,
                    bonds, camp layouts, relics, attack anims
  tuning.js         every balance constant
  sim/              pure game logic, runs in Node
    run.js            the run: apply, legalActions, replay; the retinue (place, merge, release); encounters;
                      progression (XP, levels, foe scaling); rewards
    battle.js         a fight: tick loop, effects and statuses, unit AI and movement, combat formulas;
                      takes no input
    unit.js           stats, stars, modifiers, synergies, the camp and the foes' formation, bonds, the
                      board (tiles, walls, steps, reach, shapes, auras, engagement)
    map.js            floor generation
    rng.js            seeded RNG
    autoplay.js       the autoplayer for tests and balance runs (rehearses formations before each
                      battle); run directly for the balance or decisions report
  engine.js         Phaser, battles only: boot + picture loading, FX textures, battle scene, poses, timeline
                    player
  ui.js             DOM screens: title, map, prep, reap and end, the retinue editor, battle playback bar
  codex.js          rules text generated from content.js: unit stat cards, ability text, room and threat
                    tooltips, synergy tracker, merge previews, the How to play overlay
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
| map, prep | `{ type: 'place', uid, slot }` move a soul to an open camp cell (0–48, not a wall) or the ossuary (−1); a soul already there takes the mover's old place · `{ type: 'merge', id, star }` merge three copies |
| map, prep, reap | `{ type: 'release', uid }` let a soul go (never the last one standing) |
| prep | `{ type: 'fight' }` resolve the battle; the run settles it (HP, XP, rewards) on its own |
| reap | `{ type: 'reap', index }` bind a soul or take a relic, `index: null` takes nothing |

Battles take no input, so `fight` runs the whole battle at once. `run.setup` keeps what the battle was
built from, and the battle scene rebuilds it with `createBattle(run.setup)` and steps it in time with
the animations; the same setup always produces the same events. Every applied action goes into
`run.state.log`, and `replay(seed, log)` rebuilds the identical state. The UI, the autoplayer and the
tests all drive the game the same way, which is what lets `test/run.test.js` fuzz whole runs with
random legal actions, check invariants after every step, and assert that each one replays exactly.

## Testing and debugging

`npm test` runs 44 tests in about 40 seconds, all in Node (most of it autoplaying whole runs):

- **run.test.js**: what `legalActions` offers in each phase, that illegal actions are refused
  without touching the log, scouted foes matching the battle, placing (never on a wall), each
  floor's camp, merging, releasing, altars, reliquaries, reaping (including with a full retinue)
  and replay; that the autoplayer stands souls only on open cells and rehearses without touching
  the run. The fuzz test plays 40 runs half
  by autoplay and half by random legal actions, checks invariants after every action, applies a
  sample of every listed legal action to a replayed copy, and asserts each run replays exactly.
- **battle.test.js**: determinism (same seed gives the same timeline hash), phases, the bench and
  stars, and movement (every battle in a real camp): every step is to a free neighbouring tile that
  neither is nor squeezes past a wall, no two units share a tile, and an
  engaged unit only walks away if its role slips; auras reach only adjacent allies, and bonds are set
  by the formation at the start.
- **map.test.js**, **content.test.js**, **basics.test.js**: floor rules over 500 seeds, that every
  content reference resolves and every unit has its three pictures, that every camp is 7×7 with no
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

Add one entry to `UNIT_LIST` in `src/content.js` (stats, kin, role, element, abilities, spawn weight)
and reference abilities from `ABILITY_LIST` in the same file. Its `art` key names three pictures in
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
