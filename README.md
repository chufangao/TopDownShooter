# RETINUE

A roguelite party autobattler shaped like Slay the Spire. Your party fights on the standing orders
you wrote; you choose the route, the spoils and the cuts, and spend a small budget of **Commands**
to overrule it mid-fight. One currency, spent inside the run. Prestige only makes it harder.

See [PLAN.md](PLAN.md) for the full design and build order.

## The architectural rule

> Combat resolves entirely in pure JS. The sim emits an ordered event timeline. Phaser plays that
> timeline back. Animation never feeds back into resolution.

Nothing under `src/sim/` may import Phaser, read a clock, or call `Math.random`.

## Layout

```
packs/core/         all first-party content — a mod like any other (§13.1)
  content/*.json    units, abilities, statuses, tuning, rigs, clips, parts, palettes
  art/descriptors/  sprite source of truth — ~40 lines per unit (§15)
  art/baked/        generated atlases, committed
  schemas/          a JSON Schema per content kind, so editors autocomplete content
src/sim/            pure JS simulation. Runs in Node and in a Worker. No Phaser, ever.
src/sim/kernel/     the seven primitives everything is built from (§11)
src/sim/combat/     resolve · battle · rules — the three files with a §18.9 size alarm
src/engine/         the only place Phaser is imported
src/ui/             the Doctrine editors — plain DOM over the canvas, never a Phaser scene
test/               every test, mirroring src/ — kernel/ combat/ sim/ mods/ tools/
tools/              headless CLI: lint, fmt, art, modcheck, sim, balance (replay to come)
legacy-pygame/      the original 2019 PyGame prototype
```

Tests live under `test/`, never beside the code they cover — colocated tests drop out of the suite
the moment the runner's glob changes, and `npm run lint` fails if one appears under `src/`.

## Run it

```
npm install
npm run dev          # → http://localhost:5173
```

The party walks the floor, cuts to a battle screen at every encounter, and carries its wounds to
the next fight. It fights on its own standing orders and you overrule it: **`tab` opens the
Doctrine**, where you rewrite those orders for the rest of the run. `1 2 4` change the view speed
and `?seed=anything` in the URL picks a run.

*Not yet built (M5, see [PLAN.md](PLAN.md) §2.6 and §6):* the branching one-way floor map you route
yourself, the 1-of-3 spoils pick after each fight, and the three **Commands** per battle — Focus ·
Parley · Brace · Unleash — that are the reason to watch a fight rather than skip it. The current
build still plays the previous design's self-routing run.

```
npm test                            # node --test over test/ — sim + art, no browser
npm run lint                        # schema, dangling refs, architecture invariants (§18)
npm run fmt                         # canonical formatting for every pack JSON
npm run art                         # rebake stale descriptors into committed atlases
npm run modcheck test/fixtures/kindled --trust
```

```
node tools/sim.js --runs 20                     # 20 seeded runs, headless, no browser
node tools/sim.js --seed 7 --verbose             # one run, node by node
node tools/balance.js --n 400 > balance.csv      # win rate and time-to-kill per floor
node tools/balance.js --n 200 --sweep damage.atkDivisor=10,28,40
```

`npm test` and `npm run lint` use Node built-ins only — they run with no `node_modules`. So do
`tools/sim.js` and `tools/balance.js`: the whole simulation runs in Node because nothing under
`src/sim/` imports Phaser, which is the payoff of the one architectural rule.

## Status

| | Deliverable | State |
|---|---|---|
| K0 | `src/sim/kernel/` — the seven primitives | done |
| K1 | pack loader + `packs/core/` as a pack + `tools/lint.js` | done |
| K2 | `tools/art.js` — descriptors to baked atlases | done |
| M0 | Vite + Phaser 4, dungeon generator, leader + follower chain | done |
| M1 | `combat/resolve.js` + `BattleScene` timeline playback | done |
| M2 | Roster, tags, Resonance, party management, **persuade** | done |
| M3 | Doctrine editors over expr trees; export/import | done |
| M4 | Floors, node types, XP, **boss**, spawn tables, run economy, save + repair | done |
| M3.5 | **Signal ledger + Tenets + Dispatches** — a Doctrine can say only what was paid for | done |
| M2.5 | Third-party pack delivery: zip → OPFS, trust toggle | open |
| M5 | **Commands, the branching one-way map, the spoils screen** | next |
| M5.5 | **One currency**: Coin only, items + merchants, **Ascent**, post-mortem | open |
| M6 | Pacts, Banners, branches, fusion, ~40 units | open |

**K0 gate** — registry freezes; expr evaluates; modifiers resolve identically under 100 shuffles;
RNG streams are independent (draining one stream 1000× cannot move another).

**K1 gate** — nothing under `src/` imports a content file, and `core` reaches the registry only
through `createGame()`. Load `core` + three other packs in 40 random orders → one content hash.
[test/fixtures/kindled/](test/fixtures/kindled/) is a real external pack shipping content, a patch,
art and a sandboxed script through that same door.

**K2 gate** — 7 descriptors over 1 rig, 6 clips, 19 parts and 10 ramps bake to 168 frames in one
atlas. Same inputs → byte-identical PNG, so the committed art diffs cleanly and CI fails on stale
art. Adding a unit is one JSON file and one descriptor; no PNG is ever drawn by hand.

**M0 gate** — `entry → exit` reachable across 500 seeded generations, every node walkable, and the
same seed reproduces the same floor.

**M2 gate** — a Pact and a Resonance share one code path: same shape, same validator function, same
activation walk in [synergy.js](src/sim/synergy.js), same modifier collection, same hook-row walk.
Scaled Wall and Glamour are rows of JSON with no code behind them. Over 100 seeded battles the
observed recruit count matches the sum of the chances the sim rolled against, within 4σ.

**M3 gate** — a Doctrine round-trips through JSON unchanged, and *rewriting a rule changes what
happens*: a KILL-everything set recruits nobody over 24 seeded battles and a PERSUADE-everything set
recruits repeatedly, on the same seeds and the same spawns. All five editors of §4 are live —
Formation, Targeting, Ability, Recruit, Route — and none of them enumerates a hardcoded list: every
chip menu is generated from the registered form signatures, so a pack that ships a form gets an
editor entry for it with no UI work. Every rule carries a live fire count, and clicking a `0` prints
the evaluation that produced it — `tier($target) → 1`, `tier($target) ≥ 3 → false`. Editing is safe
mid-run because the draft only goes live at a node boundary, and never at all while it has an error.

**M3.5 shipped, and then the frame around it changed.** What M3.5 built stands: a Doctrine can say
only what its holder paid for, reports state facts and never recommend, and the chip editor,
validator, fire counts and export string are unchanged. What moved is how much rests on it. The
Doctrine used to be the *only* interaction in a self-playing game, which is why it grew three
designs in a row; it is now **standing orders** — what the party does between the moments you
overrule it. A rule that works is a Command you get to keep, which is the first time writing one has
had a price to beat. See §4 of [PLAN.md](PLAN.md) for the full reframe and what it retires.

**M4 gate** — two claims, both measured rather than asserted. *A seeded run reaches floor 4 without a
hand-built party*: `node tools/sim.js --runs 20` reports 15/20, median floor 8, and 14 of the 20 kill
the floor-8 boss. *Removing a pack loads the save with a readable report*: a save written against core
+ [kindled](test/fixtures/kindled/) loads against core alone, naming the dropped unit and keeping the
rest of the party — removing a mod must never brick a save, and that alone decides whether anyone is
willing to try one. Spawn tables are content, so a pack joins the pool by shipping one `spawn` block
and touching nothing else; a boss is a unit def with three extra fields and no code behind it at all.

**M1 gate** — the make-or-break one. `resolve.js` is 140 lines (89 of code) and knows nothing about any
ability. A fixed seed produces a stable timeline hash across two independently loaded kernels;
stepping tick-by-tick is byte-identical to running the battle in one go; the same seed at ×1 and
×8 yields the same hash and the same final HP. 10,000 fuzzed battles find no stall, no negative
HP, no unit acting twice on one gauge fill, and no fractional damage. The hash is printed on the
battle screen so you can check it by eye.

## License

GPL-3.0-or-later, inherited from the prototype this replaces.
