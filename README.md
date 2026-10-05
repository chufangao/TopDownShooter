# RETINUE

A small roguelite autobattler in the browser. You lead a party through four floors, choosing your
route room by room. Fights play out on their own in real time, and you get three Commands per fight
to overrule them. Beat the boss at the end of floor 4, or lose when your whole party falls.

## The gameplay loop

A run is four floors. You start with three level-2 units (Tomb Knight, Bone Chanter, Frost Sprite)
and try to grow them into a party of up to 12 strong enough to kill the Hollow Sovereign at the
bottom. Every run follows the same loop:

```
 ┌──► MAP: pick the next room ───────────────────────────────┐
 │       │ fight / elite / boss      │ treasure   │ campfire  │
 │       ▼                           ▼            ▼           │
 │    BATTLE: watch, spend Commands  SPOILS:      heal all,   │
 │       │ win            │ wipe     3 relics     revive      │
 │       ▼                ▼            │            │         │
 │    SPOILS: pick 1 of 3  RUN OVER    │            │         │
 │       │                             │            │         │
 │    (SWAP if a recruit arrives        │            │         │
 │     with the party full)             │            │         │
 └───────┴──────────────────────────────┴────────────┘         │
   after the floor's last room → next floor (boss on floor 4) ◄┘
```

### 1. Choose a room

Each floor is a one-way map: a start, five ranks of 2–3 rooms, and a final room. It's an elite on
floors 1–3 and the boss on floor 4. You can only move forward to a room connected to the one you're
in, so taking one branch gives up the rooms on the others. A floor is 6 rooms long.

| Room | What happens |
|---|---|
| Fight | 3 foes. Win for 1 of 3 spoils. |
| Elite | 4 tougher foes. The spoils always include a relic. |
| Treasure | No fight. Pick 1 of 3 relics. |
| Campfire | No fight. Full heal, and the fallen revive at 50% HP. The rank before each floor's final room always has exactly one. |
| Boss | The Hollow Sovereign alone. It can't be recruited and gets stronger at 60% and 25% HP. |

While on the map you can also rearrange the party on the 3×4 formation grid (click two slots to
swap them). Position matters: melee attacks only reach the enemy's frontmost occupied row, the
front row draws most single-target attacks, and the back row takes less melee damage. Synergies
activate from how many units share a kin or role (Undead 2, Vanguard 2, …) and are listed on the
map screen.

### 2. Fight, and overrule it

Battles run on their own in real time. Each unit's gauge fills by speed, and it acts when the gauge
covers its next ability, using simple built-in priorities. You don't control units directly.
Instead you get **3 Commands per battle**, which don't carry over:

- **Focus** (Q): every party unit targets one foe for 6 seconds.
- **Parley** (W): the next party unit to act tries to persuade a weakened foe (≤30% HP) to join you
  instead of attacking. The chance is shown over each eligible foe. It's higher the weaker the foe
  is, and lower after each failed attempt on it. If the foe dies before the attempt, you get the
  Command back. **Parley is the main way to grow your party.**
- **Brace** (E): an ally steps back a row if the slot behind it is free, and takes 40% less damage
  for 5 seconds.
- **Unleash** (R): an ally's gauge fills at once and it casts its most expensive usable ability.

Picking a Command pauses the fight. Click a highlighted target to issue it, or Esc to cancel.
Space pauses at any time and 1 / 2 / 4 set the speed. Long fights escalate: all damage ramps up
after 45 seconds (90 for the boss), so nothing stalls.

### 3. Collect spoils and recruits

If you win, survivors gain XP (levels raise stats, up to level 10), and everyone standing heals
half their max HP. Fallen units stay down at 0 HP until a campfire or a Rest revives them. Then you
pick 1 of 3 spoils, or skip:

- **Relic**: a permanent party bonus for the rest of the run, such as +12% ATK, +1 Command per
  battle, or Parley working up to 45% HP.
- **Drill**: every unit gains a level.
- **Rest**: everyone is healed to at least 50%, and the fallen revive at 25%.
- **Recruit**: a random unit joins at your party's median level.

Foes won by Parley join after the battle at the party's median level, keeping the HP they were
persuaded at (minimum 25%). If the party is already at 12, a swap screen asks you to release
someone for the newcomer or turn it away.

### 4. Go deeper

Clearing a floor's final room takes you to the next floor with your party, relics and wounds
intact. Foes get stronger each floor. The run ends when your whole party falls (defeat) or when you
kill the boss on floor 4 (victory). Nothing carries over between runs.

## Run it

Everything works offline: no install, no build step, no network. Node 22+ is the only requirement.

```
npm start                      # http://localhost:5173 (node serve.js)
npm test                       # node --test, sim only, no browser
npm run sim                    # 200 headless autoplayed runs: clear rate, battle length, per-floor progression
```

Add `?seed=anything` to the URL to play a specific run. In the browser console, `retinue.run.state.log`
is the current run's action log.

## Layout

```
index.html          page shell: stylesheet + src/main.js
serve.js            static file server for npm start
src/
  main.js           boot: Phaser engine + DOM UI; turns every input into apply(run, action)
  content.js        all game data: units, abilities, statuses, elements, kin/roles, synergies, relics, attack anims
  tuning.js         every balance constant
  sim/              pure game logic, runs in Node
    run.js            the run: apply, legalActions, replay; progression (XP, levels, foe scaling); spoils
    battle.js         a fight: tick loop, effects and statuses, Commands, unit AI, combat formulas
    unit.js           stats, modifiers, synergies, the 3×4 formation grid
    map.js            floor generation
    rng.js            seeded RNG
    autoplay.js       heuristic policy for tests; run directly for the balance report
  engine.js         Phaser, battles only: boot + atlas loading, battle scene, timeline player
  ui.js             DOM: title, map, spoils, swap and end screens, battle command bar, shared parts
  style.css
  assets/           baked sprite atlas and animations
  vendor/phaser.js  Phaser 4.2.1 ESM build (MIT), vendored so the game runs offline
test/               one file per sim module, plus content checks and a fuzz test over legalActions
```

## The rules of the sim

`src/sim/` is pure: no Phaser import, no `Math.random`, no `Date`. All randomness comes from the
seeded RNG in `src/sim/rng.js`.

A run changes only through `apply(run, action)`, and `legalActions(run)` lists every action `apply`
accepts right now:

| Phase | Actions |
|---|---|
| map | `{ type: 'node', id }` walk to a room · `{ type: 'slots', a, b }` swap formation slots |
| battle | `{ type: 'command', verb, target }` issue a Command at the current tick · `{ type: 'advance', ticks }` step the fight |
| spoils | `{ type: 'spoil', index }` take an offer, `index: null` skips |
| swap | `{ type: 'release', uid }` release a unit for the waiting recruit, `uid: null` turns it away |

When a battle ends during an `advance`, the run settles it (HP, XP, recruits, spoils) on its own.
Every applied action goes into `run.state.log` (consecutive advances merge into one entry), and
`replay(seed, log)` rebuilds the identical state. The UI, the autoplayer and the tests all drive the
game the same way, which is what lets `test/run.test.js` fuzz whole runs with random legal actions,
check invariants after every step, and assert that each one replays exactly.

## Adding a unit

Add one entry to `UNIT_LIST` in `src/content.js` (stats, kin, role, element, abilities, spawn weight)
and reference abilities from `ABILITY_LIST` in the same file. Sprites come from the baked atlas in
`src/assets/`; the generator that made it is gone, so a new unit's `art` key must name frames that
already exist there. Pointing it at an existing unit's key reuses that sprite. `test/content.test.js`
checks that every reference and every frame resolves, and it also asserts the unit count, so update
that number too.

## License

GPL-3.0-or-later, inherited from the 2019 PyGame prototype. The prototype lives in git history at
commit `377c703`.
