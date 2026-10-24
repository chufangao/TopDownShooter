# The solver bench

Fixed boards on which two solvers are compared, paired by board: a search heuristic (anything that changes what the beam
explores) is measured here before it is kept, as the README's instrument rule asks (the solver changes only on a paired
gain). Tooling only: it reads `src/`, never writes it, and nothing of it ships (`build.js` ships what `index.html`
reaches).

## Usage

```sh
# The board set, once (boards.json, committed): 10 seeded expert runs at budget 20000 (~50 min on one worker), 120 of
# their battles kept, 40 a floor.
node tools/solverbench/boards.mjs [--seed sb] [--runs 10] [--per-floor 40] [--boss-share 0.25] [--budget 20000] [--workers n] [--file f] [--cache dir]

# A variant solved on every board (resumable; out/<variant>/<board>.json; the probes once a board in out/boards/).
node tools/solverbench/run.mjs [--variant base] [--src <a src/ tree>] [--budget 150000] [--workers n] [--boards k] [--fresh] [--file f] [--out dir]

# The paired table of two variants run.
node tools/solverbench/analyze.mjs <A> <B> [--file f] [--out dir]
```

A heuristic is measured from a copy of `src/`, the repo untouched:

```sh
cp -r src /tmp/src-wide && $EDITOR /tmp/src-wide/sim/solver.js
node tools/solverbench/run.mjs                                  # base: the repo's src/
node tools/solverbench/run.mjs --variant wide --src /tmp/src-wide
node tools/solverbench/analyze.mjs base wide                    # (run.mjs prints it too, a variant against base)
```

- **The boards.** Every battle of the runs as the retinue entered it (`record({ setups: true })`: the formation fielded,
  the foes and their waves, the walls, the mods), with its floor, room kind (fight, siege, elite, boss), rank, party
  size and whether a sentry stands among its foes or waves. A floor's share: its boss battles first (every boss kind
  met, up to a quarter of the floor), then round the cells of kind × sentry or none in turn. The same arguments and
  src/ make the same file; the runs played are cached (`out/runs/`), so a stop or a larger set resumes.
- **A solve.** `solve(createBattle(setup))` with the solver as the environment configures it (`RETINUE_SOLVER_WIDTHS`,
  `RETINUE_SOLVER_CAP`…), the budget given and no slack read: a function of the board. Each result keeps solved, level,
  plans, nodes, truncated, margin, value, turns, ms and the line's digest (its turns' orders), and what made it (the
  src tree's digest, the budget, the widths): a result made otherwise is redone. `--boards k` solves k boards evenly
  spaced through the set (still every floor and kind).
- **The probes.** End Turn alone and the one-wide search (`reports.js probeOf`) from each board, solved once by the repo's
  src: the boards' difficulty, beside the solvers'.

## A paired gain

B against A on the same boards at the same budget. B is kept only when all three hold:

1. **No board lost.** B solves every board A solves (the verdict names any it loses, and those it gains).
2. **The margin not lower by 2 SE.** On the boards both win, the paired difference B − A of the won line's value (what
   the solver maximizes: −3 × the Monarch's share of HP lost − the souls' share lost − 0.02 a round) and of the
   Monarch's share kept, each mean ≥ −2 standard errors.
3. **Something better:** a board gained, the margin higher by 2 SE, or the speed ratio (B's total solve time over A's)
   under ×0.95. Plans are shown beside it: a budgeted solve stops at the first level that wins, so fewer plans is the
   deterministic part of a speed-up; ms is the wall clock (run both variants on an idle machine with the same workers).

"Same line" is the share of boards B plays A's line on: a pure speed-up keeps it at 100%; a heuristic that changes what
the beam explores lowers it, and the margin and the solves say whether the new lines are as good. The boards were made
once and a heuristic is tuned on them, so a kept heuristic is then checked the README's way: the expert on fresh seeds,
paired by seed.

Time: a solve runs at ~0.47 ms a plan on one core (the smoke test, at budget 5000). At budget 150000 a battle's solve
takes ~4k plans on floor 1, ~14k on floor 2, ~34k on floor 3 and ~110k for a floor-3 boss (the expert's first solves,
2026-10-24), so the set is ~2.8M plans: ~22 minutes on one core, ~6–10 minutes a variant on 4 workers; the probes,
once, add under a minute.
