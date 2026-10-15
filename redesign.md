# RETINUE: the improvement plan

The plan decided on 2026-10-15, after the gameplay audit of that day, for taking the game from a working prototype
with one build to a finished product with many. For Chufan and for any Claude Code session working in this repo:
read this before touching `src/`. It replaces the combat redesign spec that stood here from 2026-10-10 to
2026-10-14; that spec is history now, kept at `git show f8c536f:redesign.md`, and what it decided is in force as the
code and its comments state it (`src/content.js`, `src/tuning.js`, `src/sim/*.js` carry the rules; the README the
play; `DESIGN.md` the board, footprints, roads, essence, tracks, fusions, summons and the frame). Section 6 says what
to build, in what order, and what each step must measure before the next begins.

The user's words that shape it: "Audit game for gameplay diversity and player skill differentiation. Inspiration:
slay the spire level player customization + power. How do I get to a finished product?"; on the instruments, "use
the more costly tree search rather than the expert random forest from now on for tuning", then "remove the hand
expert… I don't want the old content. Plan around only the decision forest and the battle teacher", and after the
spike that followed (§8), "just use the old ai to tune"; on the content,
"include more fusions. Including fusions of fusions. Fusions of 3 of the same unit should always exist."

## 1. Why: what the audit found

Measured on 2026-10-15 (60 expert runs and 40 basic runs on seeds `aud-*`, the draft on, the shipped expert of
f8c536f; two content variants on the same seeds; the scripts in §5.4):

**One build.** 77% of expert runs end holding a Pale Court; those clear 83%, every other run 7%. A Pale Court fielded
on floor 1 clears 35 of 41 runs; without one, 4 of 19. 87% of the souls fielded at a run's end are Channelers; Insects
are 1%, Constructs 0%. Seven of the 23 kinds appear in a tenth of final armies or more; ten never appear, Hive Queen,
Clockwork Titan, Iron Golem and Mantis Reaper among them. Three of the eleven synergies are ever active (Echo in 61%
of battles, Legion 37%, Mirage 4%). Two relics in five bought are Command relics; the relics ablation is worth 3
points, the Legendaries 0. The draft (§2.26 of the old spec) varies how runs begin, not how they end.

**Why it is one build: availability, not power.** Per essence the Pale Court is the weakest of the five fusions
(hp × atk per essence: Court 525, Rime Drake 655, Hive Queen 764, Bone Colossus 893, Titan 938). Its edge is that
its parts are the only ones a run can gather where it stands. Recruits come from the slain alone, and `spawnPool`
(run.js) weights a kind by `weight / (1 + |tier − target|)^tierFalloff` with `tierFalloff` 3, so a room's draws are:

| Share of a fight's draws | Floor 1 | Floor 2 | Floors 3–4 |
|---|---|---|---|
| Tier 1: Frost Sprite, Clockwork Page, Grave Ghoul, Will-o'-Wisp | ~22% each (≈90% together) | ~18% each | 2% each |
| Tier 2: Bone Chanter, Tomb Knight, Hive Warden, Pyre Hound (Thorn Dryad, Rot Bloat from floor 2) | 2–3% each; elites 18–29% | 2–3% | 11–20% each |
| Tier 3: Ember Drake, Mantis Reaper, Iron Golem, Marsh Hag, Ash Wyvern | absent | absent from fights, 1% of elites' | 1% of fights', 13–17% of elites' |

So three Wisps are offered in about five of floor 1's ten battles, and the Wisp triple is the only recipe whose parts
are floor-1 fight draws. Rime Drake, Hive Queen and Titan each need a tier-3 keystone that is 1% of any fight's draws
and ~15% of a floor-3 elite's, by which floor their tier-1 partners (Sprite, Page) have fallen to 2%: cross-floor
plans the expert never completes (Queen and Titan, 0 of 60 runs). Bone Colossus needs two Knights, which on floor 1
come from the elite and the draft alone. Sprite, Page, Ghoul, Warden and Hound belong to no recipe they can complete
on the floor they are offered. The monoculture is the recipe graph times the pool's weighting; Echo (every ability
twice, reached with two souls once the Chanter's summons count) and the Court's size-1 ranged blast are second to it.

**The variants** (same 40 seeds, baseline 24 clears): with Echo removed, 19 clears and the Court still in 75% of runs;
with the Pale Court recipe removed, **0 clears**, no fusion made in any run, and the expert dead on floors 3–4 (an
expert fitted to the Court; a lower bound). The difficulty is fitted to one build.

**Skill differentiation.** Orders carry 91% of the expert's progress; the ladder reads basic 0% (all 40 runs dead on
floor 1 after 2.3 battles; the design target was three in four), hand expert ~31%, shipped expert 65–78%, the
outside teacher 63/64. A real gradient on a fair board, with a floor too hard, a middle too easy (floor-2 battles a
median 2 turns; deaths by floor 20 / 2 / 2 / 12%), one difficulty and no ceiling past the solved strategy, and a
battle whose foes' reach the expert reads off a danger map the player never sees in battle.

**The product.** A clear is ~50 battles and ~1,190 orders (three hours at five seconds an order); no save; no unlocks,
history or daily seed; one Monarch, one boss, no events, no music.

## 2. Goal

Slay the Spire's shape on this board: a run whose build is chosen by the player from among several that can each
win, where the choice is made again every floor, where power comes from combinations the player assembles, and where
a stronger player wins more at every level of a difficulty ladder. Concretely, the criteria every step is measured
against (§3 says with which instrument):

1. **Reachable.** For every archetype (§4.1), the parts of its first fusion are offered, in expectation, in three
   or more battles by the end of floor 2 (`--pool`).
2. **Viable.** The committed teacher's margin (§3) with every kin's archetype is within a band of the best
   archetype's, and its clears at the top difficulty within 15 points of the best's.
3. **Diverse in free play.** No fused kind in more than 30% of the expert's final armies; every base recipe
   made in 8% or more of runs; six or more of the eleven synergies each active in 5% or more of battles; the relics
   ablation worth 10 points or more.
4. **Still a game.** At the base difficulty the expert (§4.0, its forests refitted on the content) clears ~90% and the
   calculator (§3: sound turns, no strategy, the novice's model) reaches floor 2 about half the time; at the top
   difficulty the teacher clears ~60%, and the ladder keeps its order at every level.
5. **A product.** A run saved and resumed; a clear in 75–90 minutes; a tutorial; the first unlocks; music.

## 3. The instruments

The user's word, after the spike of §8: "just use the old ai to tune". The autoplayer stays as it ships (§4.0 says
what it is) and is the instrument; this plan rewrites, retunes and re-searches nothing of it. Nothing in the game runs
it (the foes are `foeTurn`, the untouched the basic rule): it exists to measure, and these are the rules of its use.

| Player | What | s/run | Clears | Use |
|---|---|---|---|---|
| basic (`LEVELS.basic`) | End Turn with basics; the first offer; the default frontier | ~1 | 0% (2.3 battles a run) | the ladder's floor |
| the calculator (`calc.js`) | no weight: each piece's legal options read by `features` with `brink` and `peril` at 0, taken by [Monarch safe, material in HP at unit weight]; out of battle a fixed order | ~3 | 0% (dead on floor 1 in 22 of 32) | the novice's model: sound turns, no strategy |
| **the expert** (`LEVELS.expert`, §4.0) | the shipped expert of f8c536f: a situation read, a plan, a model tree with searched weights, three forests, the learned route, the combo book | ~7–9 | 65% on `aud-0…59` with the draft; 77.7% on 768 seeds from the trio | the fast loop; the balance pass's player; the ladder's middle |
| **the outside teacher** (`outside.js`) | each out-of-battle choice among the expert's top six played out to the run's end by the expert, the first that clears taken | ~67 | 63/64 | the ceiling; viability |
| the battle teacher (`teach.js --teacher`) | each battle option played out to the battle's end by the expert | ~200 | 75% on 64 | the battle forest's labels at a refit; never in the loop |

- **The fast loop: the expert as it stands**, free and committed (the harness, Step 0), 256 paired seeds (`div-*`),
  ~30 min on four cores, after every content change, **`npm run combos` first**: the book is made from the content
  by a static formula in seconds and the expert's build targets are the book's, so a new recipe or kind is in its
  sights at once. Between refits its forests and route are stale (fitted on the Court's runs); its readers are generic
  (HP, ATK, reach, tier, role, the recipes), so it degrades rather than breaks, and the paired differences are what
  count.
- **Viability and the ceiling: the outside teacher**, committed to each archetype, 64 seeds each, at the top
  difficulty (§4.6), ~3 h for ten archetypes on four cores. It saturates at the base difficulty (63/64: nothing to
  rank), so it reports clears **and a margin**: the Monarch's HP share and the souls' at the end, battles lost, essence
  left, turns. It needs no refitting when content moves: it judges by outcome, and its playouts are the expert's.
- **The balance pass's numbers: the expert refitted at the milestone** (§4.0's refit), 768 seeds, because "the expert
  ~90%" is defined on a fast player who has learnt the game. The ladder (basic → calculator → expert → teacher) at every
  difficulty is the skill-differentiation measure: its rungs must keep their order and their gaps.
- **Not done in this plan**: no weight search on the content (the 178 numbers are feature preferences, damage against
  danger against a kill's worth, not content, and stay where the search put them); no forest rounds beyond the
  milestone refit; no new learner. Measured and rejected (§8): search alone over a weight-free player (0 of 12). Planned
  and set aside the same day: a learnt player at every decision fitted by expert iteration, which the spike showed would
  need the old expert as its seed anyway.

**The harness** (`autoplay.js`, Step 0): `--builds [--player expert|teacher] [--commit <archetype>|all] [--scale
<difficulty>] [--runs n] [--seed s]`: an archetype is a fused kind (a node of the recipe graph) or a synergy; a
committed run reads a book filtered to the archetype's combos (`BOOK.combos` by `fuse`, `kin` or `role`; `targetOf`,
`comboWorth`), so its draft, recruits and spending follow it, and the teacher's candidates (`recruitCandidates`,
`spendCandidates`) follow the same book. A row an archetype: clears, progress, the margin columns, the share of runs
that made its fusion or reached its synergy and the median battle it came on; a last block for free play: the
archetype shares, kinds held, fusions made, synergies active, relics bought (the diversity block, also in the ladder
report). `--pool`: the availability table of §1 from `spawnPool`, and for each recipe the expected battles offering
each part by floor. Noise as the old spec reported it: ± one standard error of the paired difference; 64 seeds
resolve ~6 points of clear rate, 256 ~3.

## 4. The design

### 4.0 The expert, as it stands

The autoplayer of f8c536f, kept whole. One file holds what it learnt, `src/sim/expert.json` (3.5 MB: `tree`,
`rules`, `forest`, `outforest`, `route`; `bundle.js` sets or splits a part), one table what was searched,
`TUNING.expert`, and one what it reads of the content, `src/sim/combos.json`. Every decision is one shape: read the
situation once, list the options, read each as named features, let a tree force or filter, weigh the rest, and where
a forest is confident, take its word.

- **In battle** (`policy.js expertTurn`, the fast turn: each piece once, no beam): the **situation**
  read once a decision (`situation`, ~68 named conditions in `expert.js conditions`: the Monarch's danger and whether
  it can be felled, lines of fire on it, threats by road and turns to reach, foes by threat type, the wave due, the
  camp's patience, killable foes, each piece's exposure, synergies); a **plan** chosen by a tree once a turn and kept
  (`plan.js`: hold, focus, push or protect; a target formation of posts, blocks and screens on the roads' lines out of
  the Monarch's reach and an air slot; a kill list by exact arithmetic; a forecast of where the foes will stand; the
  Monarch's shooters first); then the pieces one at a time on the board as the ones before left it, the kill list's
  strikers first. A piece's **options** (`policy.js options`: every tile its Move reaches × every act at every target,
  and its fusions) are read as ~34 **features** (`features`: damage, a kill and its worth, menace, focus, harry, a
  status's worth, mending, rescue, the danger where it ends, a fall, the counter drawn, what the foes would take of
  yours next turn by an assignment of their blows (`loss`, `shadowLoss`, `hit`), the Monarch's danger removed (`guard`),
  lethal, cull, a shadow raised, a fusion's gain and price, waste, engage, and the plan's progress, role, post, listed
  and forecast), filtered by the **model tree's hard rules** (`expert.json tree`; `expert.js TREES`: no-waste,
  monarch-lethal, kill-first, never-die, hold-the-line; the modes guard, protect, push, press, frail), weighed by the
  leaf's **weights** (`TUNING.expert.battle.option` and `.modes`: 178 numbers set by sep-CMA-ES on 128 seeds on
  2026-10-11, checked on 128 others); and the **battle forest** (`expert.json forest`, round 3 of `forest.js`: 200
  regression trees over 252 inputs, the conditions, the features, the same less the position's mean, and the
  conditions of the board the option leaves, fitted on playouts of every option to the battle's end) overrules that
  choice where it reads another candidate more than δ 0.02 above it. The untouched strike or mend with basics at End
  Turn. `--audit` names the rule or the forest that decided each order.
- **Prep** (`autoplay.js plan`, `planFor`): formations drafted from the plan's posts and the frontier, hill-climbed on a
  static score (`formationFeatures`: the danger the pieces project on the roads, blockers on the roads into the
  Monarch, shooters behind them, healers beside the threatened, the Monarch's exposure, synergies, an Arise holder by
  the kill zone; `TUNING.expert.formation`) under the tree's filters (fill-field, answer-air, block-roads); the
  **formation forest** (`expert.json outforest.prep`, δ 0.1) picks among nine (the plan's, its next five, the best
  three drafts) by `prepRead`: the run's situation, the coming battle as scouted, the formation's own read, and the
  battle's read of the board it opens on.
- **Growth** (`grow`, `sketch`): the **sketch** is the field's strength (`strength`: a formula over the fielded pieces'
  HP, blows, reach, tiers, summons and the shadows Arise would raise) plus the **book's** value (`combos.json`, made by
  `--combos` in seconds: every fusion, core, kin and role combo ranked by floor by a static formula, with the relics
  that pair with each; the run's target is the combo of the best worth × progress, `targetOf`). Each tier and fusion
  is bought by its sketch gain an essence against the best a tier gives (`tierRate`); the **recruit** by the sketch
  (`weighRecruits`), then the **recruit forest** (`expert.json outforest.recruit`, round 2, δ 0.25, over the pick and
  its next five and passing on, read by `outsideRead`): the largest single gain the old spec found (+18 to +21 points,
  mostly recruiting where the sketch declined); the Shop by sketch gain an essence against tiers (`buyFor`); a relic
  waiting given by `pickHold`; the draft by the sketch under the ranged rule (`pickDraft`, `TUNING.expert.draft`).
- **Route** (`pickRoute`): the **learned route** (`expert.json route`, `ROUTE_LEARNED` true: a model tree over the
  run's situation and each room's scouted features, fitted by `fit.js` on 10,435 room choices played out), the hand
  tree (`TREES.route`: a wounded army to an altar, never an elite on long odds or a hurt Monarch) its fallback.
- **Hand and learnt.** Written or searched: the readers (vocabulary, generic), the tree's rules, the weights, the
  plan, the formation score, the sketch, the book's formula, the draft and hold rules. Fitted on playouts of the
  content as it was: the three forests and the route.
- **Strength and cost.** ~7–9 s a run on one core; 77.7% on 768 seeds `fin` from the trio start, 65% on `aud-0…59`
  with the draft; 99.5% of battles won; its deaths on floors 1 and 4; ~50 battles a clear. The ladder: basic 0%,
  calculator 0%, expert 65–78%, outside teacher 98%.
- **What a content change does to it.** The book must be remade (`npm run combos`; the content test fails a recipe
  the book lacks). The readers need nothing for a new kind, relic or recipe; a new effect op or shape needs its line in
  the readers (`estimate`, `STATUS_WORTH`). The forests and the route go stale and keep playing. **The refit** (a
  milestone, overnight on four cores; the modules' headers give the flags): battle labels `npm run teach` (300 runs of
  the expert, `--draw state`, ~3 h) and `npm run forest`, out-of-battle labels `npm run outside -- --label --phases
  recruit,prep` (~3 h) and `npm run outforest`, the route `npm run teach -- --route` then `--fit`; each part set by
  `npm run bundle`, and kept only on a paired gain on 768 fresh seeds (`--paired expert:a.json,expert:b.json`).
- **What was kept and what went** (Step 0b, done 2026-10-15: §8). Kept, as it plays: everything above. Removed, as
  nothing played by it: the earlier learners (`value.js` and `value.json`, V; `ranker.js`, the MLP correction;
  `train.js`, V's trainer; `teacher.js`, the stronger battle teacher; 3,260 lines and 405 KB, `value.json` 240 KB of
  it) with their tests (`value`, `ranker`, `teacher`, `policy-learned`, `puzzles-learned`; 981 lines), every import,
  option and CLI line that named them (`autoplay.js`'s `--learned`, `--static`, `--ranker`, a level's `learned`;
  `teach.js`'s `--ranker`; the scripts `train`, `teacher`, `rank`), and the beam in `policy.js` (`expertTurn`'s beam
  branch, `expand`, `afterstate`, the hybrid, `evaluate`, and the formation by V, `autoplay.js opening`). Of
  `TUNING.expert.beam` only the shortlist's size is left, as `TUNING.expert.shortlist` (the forest's candidates read
  it; `teach.js` labels as many). The row encoding `ranker.js` lent the forests (`encode`, `meanOf`, `playView`,
  `rowView`, `afterDiff`, `rowAfter`, `splitOf`, the label files' readers, and V's `mulberry` the fitters draw by)
  lives in `forest.js`, and the tests of it `ranker.test.js` held in `test/forest.test.js`. The expert plays move for
  move as before: 12 whole runs' logs and the outside teacher's of two, byte for byte the same.

### 4.1 Fusions: a triple for every kind, and fusions of fusions

The user's word: "Fusions of 3 of the same unit should always exist", "fusions of fusions". Today five hand-written
recipes; after this, a graph.

- **The triple rule.** Every kind of tier 4 or less that a run can hold (every spawnable kind, every fused kind, never
  the boss) fuses three of itself into its **trine**: a kind two tiers above its parts (tier 1 → 3, 2 → 4, 3 → 5,
  4 → 6; tier 6 is the top, so a tier-5 or tier-6 kind has no triple). The Pale Court is the first trine (three Wisps,
  tier 3) and sets the line: its HP is 7× a Wisp's, its ATK 4.8×, its DEF 2×.
- **Generated, overridable.** A trine is a record like any kind, but where no record is written for it the content
  makes one from its base kind at load (`content.js trineOf(kind)`: id `trine:<kind>`, the name `trine` on the def
  or "<Name> Trine", `base` from `TUNING.trine` by the parts' tier, `growth` the kind's, `kin`, `role`, `move`,
  `flies`, `arm`, `temper`, `threats` the kind's, `size` 2 from tier 4 up, `art` the kind's, `fused: true`, its
  abilities the kind's own with every single-target blow a blast (three of them strike at once) and ranged blows one
  tile farther, `tracks` the kind's two, its summon tiers bringing the base kind). A written record with `trineOf:
  <kind>` replaces the generated one (the Pale Court's `trineOf: 'will_o_wisp'`), so a bespoke trine is one record,
  and the other four recipes of today stay as **mixed recipes** beside the triples. The content test holds every trine,
  generated or written, to the kind checklist. The vocabulary grows by one word, Trine ("three of a kind fused"), and
  the codex's Fusions page lists the mixed recipes and the capstones, with one line for the rule; a kind's card shows
  its own triple.
- **The stat line**, `TUNING.trine` by the parts' tier, placeholders until the balance pass, with the invariant "a
  fusion is never weaker than what went into it" (HP at least the parts' sum; a blow at least the parts' best):

  | Parts' tier | Result | HP × base | ATK × base | DEF × base | Size |
  |---|---|---|---|---|---|
  | 1 | 3 | 7 | 4.8 | 2 | 1 |
  | 2 | 4 | 7 | 4.5 | 1.5 | 2 |
  | 3 | 5 | 6 | 3.8 | 1.5 | 2 |
  | 4 | 6 | 5.5 | 3.2 | 1.5 | 2 |
  | a fused kind (3–4) | +2, at most 6 | 3 | 1.8 | 1.2 | 2 |

  Read against today's: a Tomb Knight trine 994 / 72 / 33 beside the Bone Colossus's 1050 / 68 / 28; a Frost Sprite
  trine 378 / 72 / 8 beside the Court's 350 / 72 / 6; a Pale Court trine 1050 / 130 / 7 at tier 5. The fuse price is
  `essence.fuse` × the result's tier × the floor's scale as now: a trine of trines is a floor-3 or floor-4 purchase.
- **Fusions of fusions, bespoke: the capstones.** Seven hand-written kinds of tier 5–6, each one record, 3 SVGs or
  `art`, two tracks, listed in the codex from the start; one a kin, two across kins:

  | Capstone | Parts | Tier, size | Idea |
  |---|---|---|---|
  | Charnel Cathedral (Undead) | Bone Colossus + Grave Ghoul trine | 5, 2×2 | the wall that feeds: its blows heal it, and what it slays beside it rises |
  | Winter Court (Fae) | Pale Court + Frost Sprite trine | 5, 1 | Hex and Brittle on everything within 4 tiles; a caster's caster |
  | Cinder Wyrm (Drake) | Rime Drake + Pyre Hound trine | 5, 1, flies | a flying burner: Burning on a crowd from 5 tiles, fire that spreads |
  | Hive Mind (Insect) | Hive Queen + Hive Drone trine | 5, 2×2 | mends everything, drones hatch at every wave, skills reset on a kill |
  | Engine of Ages (Construct) | Clockwork Titan + Clockwork Page trine | 5, 2×2 | Hexes all it touches; stands at 1 HP once a battle |
  | Aurora (Fae + Drake) | Pale Court + Rime Drake | 5, 1 | fire and frost: a blast that burns and Hexes |
  | Iron Barrow (Undead + Construct) | Bone Colossus + Clockwork Titan | 6, 2×2 | the heaviest piece in the game |

  A capstone's rule-like effects (a rise on a kill, a once-a-battle stand) are abilities and `onFall`/`on` records
  where the vocabulary allows and registry rules scoped to the kind where it does not (the Sovereign's override is
  the precedent); the content test says which.
- **The recipe graph's rules**, in `test/content.test.js`: every kind of tier ≤ 4 has exactly one triple; every
  fused kind is the result of exactly one recipe; a recipe's result tier is within two of its parts' tiers' sum minus
  the parts' count (the line today's five keep); a fusion of fusions names two or more fused kinds among its parts;
  no kind above tier 6; no cycle. Adding a kind adds its triple for free; a new mixed recipe or capstone is one
  recipe line and one unit record, as before.
- **What it means for the rest.** `canFuse`, `fuseParts`, `fuseIn` and the in-battle fuse read `FUSION_LIST`
  generically and need nothing; `--combos` enumerates every recipe into the book (`combosOf`), so a new recipe is a
  target the expert may play toward at once; `abilitiesOf` reads a generated kit as any. A trine counts once toward synergies, as every piece does: fusing trades count for a body,
  everywhere now, so a synergy at 4 should be reachable by a field of trines too (the counts are the balance pass's;
  §7). The roster (12) and Command (3–6) bound how far the graph is climbed in one run, which is the point: a run
  chooses where on it to stand.

### 4.2 Availability: what a run can gather

- **The draft guarantees a plan.** Pick 1 is free, as now; picks 2 and 3 each offer at least one kind that shares a
  recipe or a kin with a soul already held (`draftOffer`, reading `FUSION_LIST` and `kin`), so two of a kind, or a
  mixed recipe's parts, is on the table from the start for any kin the first pick chose.
- **Flatten the pool.** `spawn.tierFalloff` 3 → 1.5 and `tierOverCap` 1 → 2 (placeholders): a tier-3 kind becomes a
  few per cent of floor-2 fights and ~10% of floor-3 fights' draws; tier-1 kinds stay a fifth of floor-3's. Measured
  by `--pool` against criterion 1 and by the forest ladder for what it does to difficulty. The alternative that keeps the
  number: from floor 2 a fight's captain (`formation`'s `captains`) drawn one tier above the room's target, its cohort
  of the room's own, so every fight carries one notable recruit; harder on floor 2, and a bigger change to `formation`.
- The recruit stays one slain foe a battle (a standing rule); §4.5 is the pivot.

### 4.3 Synergies: eleven rules of one class

- **Echo split** by the one step the old spec allowed: at 4 Channelers, every ability echoes at half effect (damage,
  healing and a status's turns halved on the second landing); at 8, in full. `rules.js echo` reads the count.
- **The weak raised to Echo's class**: Ambush, Hastened for the first two turns (was one); Bodyguard, and Vanguards
  take 20% less; Mirage, the first blow each foe lands *each turn* (was each battle); Last Stand, and it heals 30%
  when it holds; Deathblow's threshold a quarter → 35% (`TUNING.deathblow.below`). Legion, Dragonfire, Deadeye,
  Frenzy, Sanctuary stand. Summons keep counting (it is what makes the summon tiers a build).
- Measured by criterion 3's synergy line, each rule committed through its role's or kin's archetype.

### 4.4 Relics that define a build

Twelve records in the forms already allowed (no rule below Legendary, for now: §7):

- **Five kin banners**, Uncommon run relics with `who`-scoped mods: "every Drake of yours has +25% ATK", "every
  Construct takes 10% less damage", "every Undead has +20% HP", "every Fae's skills come back a turn sooner", "every
  Insect has +1 Move". Commitment the player can buy.
- **Seven piece relics on `on` + `effects`**: on kill, the slain rises as your shadow if its tier is 1 or less (Rare:
  a small Legion for one holder; the `raise` op); on blow, Burning on the target (Uncommon); on struck, 12 damage to
  the attacker (Uncommon; `damage` to `other`); on blow, the holder heals 10% of its max HP (Uncommon); on blow, its
  skills come back a turn sooner (Rare: `cooldown` −1); on wave, Barkskin to allies within 2 (Common); on kill, Hasten
  to self (Uncommon).
- Measured by the relics ablation (criterion 3) and by the committed runs' relic shares. If twelve do not reach 10
  points, the next lever is `rule` on Rare relics (§7, a decision).

### 4.5 The pivot: the altar's choice

An altar offers one of three, not a heal alone: **heal** all and raise the fallen (as now); **transmute** one soul
into one of three kinds of the floor's pool at the same tier, keeping its level and relic (`{ type: 'transmute', uid,
index }`, the offer drawn by the run's seed); **consecrate**, a free tier on one kind. It bends "recruit only" without
adding a soul (§7, a decision): a run that drafted into a kin the floor does not feed can turn. Measured by the share
of committed runs that change archetype after floor 1 and still clear.

### 4.6 Difficulty as a ladder

`TUNING.ascension`, a table of rows, each the multipliers of one level over the base (foe HP and ATK, a fight's and an
elite's counts, the waves' spacing, the Monarch's HP, prices), chosen on the title screen, kept in the URL and prefs,
unlocked a level a clear. Level 0 is tuned on the expert (~90%) with basic reaching floor 2 about half the
time; the top level on the teacher (~60%); the levels between interpolate. "Floor 1 is hard" moves up the ladder: the
first run is winnable, the twentieth is not. The ladder report runs every level.

### 4.7 Foes that answer an archetype

Later, after §4.1–4.6 measure: a boss a floor, each with a counter in its kit (a Hex-spamming court against casters;
Purge and Molt against status builds; screens on every line against rangers; flyers against walls), and elites drawn
with a threat the scouted army lacks an answer to (`varyRoutes` already draws rooms for threat variety; this reads the
army). The teacher's committed margins say which archetype each boss should lean on.

### 4.8 Skill and product

- **A run saved**: `replay(seed, log)` makes a save the run's seed and log; written to prefs on every action, resumed
  from the title screen. (Step 8; small.)
- **Foe reach on tap**: in battle, tapping a met foe lights the tiles its Move and reach cover next turn (what it
  *could* strike, as the codex already tells once met: §7's "learnt by meeting it" holds; nothing of what it *will*
  do is drawn). Turns calculation into reading.
- **A tutorial**: a floor-0 room with a fixed draft and a scripted first battle, three screens of text at most.
- **Run length**: `RANKS` 16 → 12 (ten rooms a floor) or three floors, chosen by the measured orders a clear
  (target ~600, 75–90 minutes).
- **Meta**: a run history, a daily seed, Monarch variants (a starting run relic and a draft bias each) unlocked by
  clears; music (one loop a floor, synthesised like the effects, or files).

## 5. Baseline

The audit's numbers (f8c536f, 2026-10-15), the figures every step is paired against. Seeds `aud-0…59` (expert),
`aud-0…39` (basic and the variants).

| | Expert | Basic |
|---|---|---|
| clears | 39/60 (65%) | 0/40 |
| died on floor 1 / 2 / 3 / 4 | 12 / 1 / 1 / 7 | 40 / – / – / – |
| battles a run | 39.9 (a clear 50.5) | 2.3 |
| orders a run | 958 (a clear 1,188) | |
| turns a battle, floors 1–4 (median) | 6 / 2 / 6 / 5; the boss 17 | |
| final armies holding a Pale Court | 77% (their clears 83%; others 7%) | |
| fusions made (runs making one) | Pale Court 121 (78%), Rime Drake 18 (22%), Bone Colossus 6 (10%), the rest 0 | |
| synergies active (share of battles) | Echo 61%, Legion 37%, Mirage 4%, none 39% | |
| relics a run; recruits a run | 5.2; 11.6 | |

Variants on `aud-0…39` (baseline 24 clears): no Echo 19; no Pale Court recipe 0. The scripts: `measure.mjs` (a run's
draft, armies, fusions, synergies, battles), `analyse.mjs` (the tables), `variant.mjs` (a content variant in process),
`reach.mjs` (the pool table), to be folded into `--builds` and `--pool` in Step 0 (they lived in a session's
scratchpad; Step 0 rewrites them in `autoplay.js`).

## 6. Implementation

One working tree; content is data; at most two agents at once, never two on `src/content.js`; tests check function;
no number moves but the ones a step names, until the balance pass. Each step ends with its numbers appended to §8
and the README's autoplayer section kept true.

### Step 0. The harness (sim, ~3 h)

`--builds`, `--pool`, the diversity block in the ladder report (§3), the margin columns, `--scale`, `--player`,
`--commit`; `test/builds.test.js` (a committed run's targets are its archetype's; the pool table sums to one; the
report's shape). Baseline rows for every archetype that exists today, expert and teacher, into §8.

### Step 0b. The expert's cleaning (sim, ~3 h)

§4.0's last bullet, in this order: the row encoding `ranker.js` lends the forests moved into `forest.js`; then
`value.js`, `value.json`, `ranker.js`, `train.js`, `teacher.js` and their five test files deleted, with every import
and CLI line that named them (`autoplay.js`'s `--learned`, `--static`, `--ranker`; `LEVELS.expert.learned`; the
`learnedValue` and hybrid reads in `policy.js`); then the beam (`expertTurn`'s beam branch, `expand`, `afterstate`,
`TUNING.expert.beam` but `shortlist`, which the forest's candidates read); `fit.js` kept while `teach.js --route --fit`
reads it. No behaviour changes: before and after, 12 whole runs of the expert (`--runs 12 --seed clean`) and the
teacher's playouts of one, every log byte for byte the same; `npm test` green; the README's code map and this file's
§4.0 brought to match. Done before Step 2, so the content steps touch a smaller expert.

### Step 1. Availability (sim, ~2 h)

§4.2: the draft's guarantee (`draftOffer`), `tierFalloff` and `tierOverCap`; tests: a second pick always offers a
recipe partner or a kin-mate of the first; the pool's shares by floor. Measured by `--pool` against criterion 1 and by
the ladder for the difficulty it moves.

### Step 2. The fusion graph (content, ~6 h; then the interface, ~2 h)

§4.1: `trineOf`, `TUNING.trine`, the Pale Court as a written trine, the seven capstones (art borrowed until drawn),
the content test's graph rules, `--combos`, the codex's Fusions page and the kind cards, the glossary's Trine. The
interface: a trine drawn as its kind, bigger (2×2 as now) or thrice overlapped (a `trine` flag the engine reads; the
interface agent's call); the Field's Fuse button and the in-battle fuse unchanged. **The expert's part**: `--combos`
remade and the content test holding that every recipe, generated or written, is in the book; `combosOf`'s floor gains
read a generated trine's stats as any kind's (`strength`, `sketch`); `fusionOptions` and the in-battle fuse read the
new recipes through `FUSION_LIST` and need nothing; `outsideRead` and `prepRead` read a fused part's recipe progress
as they do today's. The forests go stale here by design (§3). Measured: every archetype's reachability (criterion 1)
and the committed expert on 256 seeds; the teacher's committed margins overnight.

### Step 3. Synergies (sim + content, ~2 h)

§4.3 in `rules.js` and the synergy records' text; tests for each changed rule. Measured by the committed runs per
role and kin.

### Step 4. Relics (content, ~2 h)

§4.4's twelve records; the content test holds their forms. **The expert's part**: the book's relic pairing (`pairs`
in `--combos`) and the sketch's `strength` read a `who`-scoped mod as the kin or role it names (unit.js `matches`
already applies it in battle), and an `on`-trigger relic by its op's worth (`STATUS_WORTH`, a raise as a shadow's HP);
`--combos` remade. Measured by the relics ablation and the committed runs' relic shares.

### Step 5. The altar's choice (sim ~2 h, interface ~1.5 h)

§4.5: the altar's phase with three offers, `transmute` and `consecrate` as actions in the log and `replay`; the altar
screen. **The expert's part**: a `pickAltar` in `autoplay.js policy` (each offer by the sketch's gain, as a purchase is
weighed; basic heals), mirrored in `outside.js baseStep` and its candidate list (so the teacher plays the altar out)
and in `calc.js`; `test/outside.test.js` holding baseStep to policy at an altar. Measured by archetype changes after
floor 1.

### Step 6. Measure, iterate, refit, balance

Two bug hunts (a trine fused onto a held tile, a capstone's part consumed twice, a transmute keeping the wrong relic,
a generated kit missing a basic, a recipe cycle). Then the loop: the expert on 256 seeds and the teacher committed on
64, criteria 1–3, content moved until they hold (the balance pass's domain: the trine table, the capstones' numbers,
Echo's halves, the pool's falloff). Then the milestone refit (§4.0: the forests and the route relabelled and refitted
on the content as it stands, overnight), the ladder on 768 seeds, criterion 4 at level 0. Then the README, §8, a push
to master.

### Step 7. The ascension ladder (sim ~2 h, interface ~1 h)

§4.6; the top level tuned on the teacher; the ladder report every level; the title screen's choice.

### Step 8. The skill curve (interface ~4 h, sim ~1 h)

§4.8's save and resume, foe reach on tap, the tutorial room, `RANKS` by the measured orders a clear.

### Step 9. The product

§4.7's bosses; §4.8's history, daily seed, Monarch variants, music; a store build; five to ten outside players through
a run with the time and the deaths recorded. Done when criterion 5 holds and the players' runs end where the ladder
says they should.

## 7. Decisions

Taken on 2026-10-15, the user's word: a triple for every kind; fusions of fusions; the teacher as the yardstick for
content; this file the plan, the old spec to history; and, after the spike of §8, **the old expert kept as the
instrument** ("just use the old ai to tune"): no rewrite, no retuning, its forests refitted at a milestone only (§3,
§4.0), its dead half removed with the logs held byte for byte (Step 0b). Set aside the same day: the autoplayer rewritten as forests fitted by expert iteration, and search alone.

Recommended here, open until the user rules:

1. **`tierFalloff` moves before the balance pass** (§4.2). "No tuning while building" stands; this is called
   structural, since without it there is nothing for a balance pass to balance between. The captain-a-tier-above
   alternative keeps the number.
2. **Transmute at altars** (§4.5) bends "recruit only: one slain foe a battle": it reshapes a soul, adds none.
3. **Rules below Legendary** stay forbidden; §4.4 uses the forms allowed. If the relics ablation does not reach 10
   points, Rare relics may carry a `rule`.
4. **The Pale Court's identity**: Fae's floor-1 trine, evened by the committed measure (its size, its tier or its
   blows' rests), not the odd one out.
5. **Generated trines** (§4.1) are generative content, which the project has avoided; the alternative is ~17
   hand-written kinds now and one more for every kind added later. Generation with written overrides is recommended.
6. **Trines of trines** reach tier 6 (a trine of a Pale Court trine); the alternative caps the triple rule at
   tier-3 parts (results ≤ 5) and leaves tier 6 to Iron Barrow.
7. **A trine counts once toward synergies**, as every piece does; the alternative counts it as its parts did (three),
   which makes the synergy at 4 a trine and a soul.

## 8. Record

Each step appends here: the date, the seeds, the paired numbers, what was kept. The baseline is §5.

### The spike: search alone (2026-10-15)

**The question**: whether the autoplayer could be search alone (a weight-free player, and the teacher's playouts over
it) with no learnt player, so that nothing need be fitted or refitted when content moves.

**Built** (`src/sim/calc.js`; `node src/sim/calc.js [--teacher] --seed aud --from 0 --runs n`): the calculator (§3),
and a rollout teacher over it in `calcRun`, the outside teacher's method (outside.js) without its ties to the hand
expert: at each decision out of battle with two candidates or more (the draft; a map step's purchases and rooms
together, so "stop spending" is a room; the recruit; the Shop; the holds), at most six of the calculator's candidates,
its own first, each played on a copy to the run's end by the calculator, the first that clears taken, else the
furthest; each fight a playout opens kept by the board's hash with where it led. Battles are the calculator's. No
fusion in battle; prep the calculator's (the strongest standing up to Command on `frontier`).

**Measured** (the content of f8c536f, the draft on, seeds `aud-*`, four cores):

| | Seeds | Clears | Died on floor 1 / 2 / 3 / 4 | Mean progress | Battles a run | s/run |
|---|---|---|---|---|---|---|
| basic (§5) | aud-0…39 | 0 | 40 / – / – / – | | 2.3 | ~1 |
| **the calculator** | aud-0…31 | **0** | 22 / 9 / 1 / 0 | 0.17 | 9.5 | 2.8 |
| **the teacher over it** | aud-0…11 | **0** | 0 / 2 / 4 / 6 | **0.76** (paired: the calculator 0.20) | 37 | 136 |
| the shipped expert (§5) | aud-0…59 | 39 / 60 | 12 / 1 / 1 / 7 | | 39.9 | 9.3 |
| the outside teacher over the shipped expert (old spec, 2026-10-12) | sim-0…63 | 63 / 64 | | 0.99 | | 67 |

The teacher overrode the calculator in ~8 of ~90 decisions a run, 300–460 playouts, and every one of its 12 runs
lost, six of them on floor 4 (two at 0.95 and 0.98, in sight of the Sovereign). The 64 seeds planned were cut at 12
once every seed had lost and the gap to the bar (65%) was plain.

**Why**: the calculator's field never grows past three. It spends each essence on tiers as soon as it may, never
saves for a Shop's Command relics (the expert fields six to eight), and the teacher cannot find that line, because
every playout from a "walk to the Shop" goes on with the same spender. Its battles run 42 turns on average (the
expert's 6): it never walks into reach, so the camp waits out its patience; a Hive Drone against three melee pieces
stalled one battle to the guard. What a playout continues with decides what search can see.

**Kept**: `calc.js` as the novice rung of the ladder (§3; criterion 4) and as the check that the run asks for
strategy. **Decided by it**: search alone rejected, and with it the forest rebuild it was to seed; the user's word
after it, "just use the old ai to tune" (§3, §4.0, §7). Not built:
a calculator good enough to seed (saving, Command, a formation) would be hand rules of what to do, which §9 forbids.

### The expert's cleaning (Step 0b, 2026-10-15)

**Done** as §4.0's last bullet says, in its order, in two commits: the row encoding moved into `forest.js` (its 252
inputs by the same names in the same order, the same numbers), then the learners, their tests and the beam removed.
Nothing was retuned; the expert, its one file and the book are as they were.

**Removed**: 4,531 lines net from `src/`, `test/` and `package.json` (5,058 out, 527 in, most of those the encoding
moved and the tests of it kept) and 472 KB: the five files (3,260 lines and 405 KB, `value.json` 240 KB of it), their
five test files (981 lines), the beam, `evaluate` and V's reads in `policy.js` (280 lines net), the formation by V and
the options and flags that named the learners in `autoplay.js` and `teach.js`, three npm scripts, and
`TUNING.expert.beam` but its `shortlist` (now `TUNING.expert.shortlist`). `NEAR` and the seed's number, which
`teach.js` read from `train.js`, are `teach.js`'s own. A label set played with the ranker (R2) can no longer be
augmented (`--augment` refuses it).

**The check**, by a script outside the repo, before (a0cc19e) and after: the 12 whole runs `--runs 12 --seed clean`
plays (seeds `clean-0…11`, `LEVELS.expert`, the draft on: 7 clears, 3 deaths on floor 1, one on 2, one on 4), each
run's full log as `replay(seed, log)` takes it (each replayed to the same state), and the outside teacher's runs of
`clean-1` and `clean-3` (`--won`, every phase: both cleared, 247 and 317 playouts, one override each; its log, its
decisions, playouts and overrides with their values), written as JSON, a file a run: all 14 files byte for byte the
same (sha256).

**Tests**: 502 → 422, all passing. Gone with their files: V's 12, the ranker's 10, the stronger teacher's 9, and the
second passes of `policy` (26) and `puzzles` (22) with V on; the beam's three in `policy.test.js` and `teach.test.js`'s
`--ranker`. Moved to `test/forest.test.js`, being of what stays: the rows' inputs, a label row read as play reads it
(teach.js's shortlist option for option policy.js's), the afterstates of `--augment` against play's, and `pairedStats`
(three tests, and the last into the job test); `evaluate`'s test is `judge`'s.

### The harness and the baseline (Step 0, 2026-10-15)

**Built** (`src/sim/autoplay.js`, a section of its own; `npm run builds`, `npm run pool`): the harness of §3. An
archetype is a fused kind (a result in `FUSION_LIST`, with the recipe graph under it: `recipesOf`) or a synergy, as
content makes them: sixteen today. A committed run reads the book's combos for its archetype alone (`useCommit`,
`withCommit`, set a job at a time as the forests are; `bookValue`, `targetOf`), so its draft, recruits, purchases and
route read it, and so do the outside teacher's candidates and playouts. `--builds [--player expert|teacher] [--commit
<archetype>|all|fused|synergies] [--scale 1] [--runs 256] [--seed div] [--out f]` plays free play and each archetype on
the same seeds and prints a row an archetype: clears; progress and its paired difference from free play, ± one standard
error; deaths by floor; the margin, over the clears (the Monarch's and its pieces' share of their HP as the last battle
ended, before the heal a win gives, and the essence left); battles lost; turns a battle; the runs that made its fusion
or held its synergy, and the median battle it came on. Then free play's diversity block against criterion 3, which
`--ladder` now prints a level at a time. `--player teacher` is the outside teacher (`TEACHER`: every phase, six
candidates, the first line that clears) through `autoplay`'s new `act`. `--scale` multiplies every foe's HP and ATK
(`createRun`'s `scale`, the boss's too; no field at 1). `--pool` reads `spawnPool` and the floors as a run draws them
(`floorOf`), a walk taking each fork evenly. `test/builds.test.js`, 2 s. §5's scripts are folded in but `variant.mjs`:
a content variant played in process is no part of §3's harness.

**The check**: uncommitted and unscaled, the runs are the ones they were. Six runs' logs (`div-0…2` and `aud-3` by the
expert, `div-0…1` by basic), `div-3`'s recorded battles and the outside teacher's run of `sim-0`, byte for byte the same
before (a0cc19e), after, and after the merge with Step 0b; the teacher through `act` plays `outsideRun`'s log of
`sim-0`.

**Measured** (the content and the expert of f8c536f, the draft on, seeds `div-*`, two workers beside another session):
`npm run builds -- --runs 64 --workers 2` (the expert, free play and all sixteen: 1,088 runs, 76 min);
`npm run builds -- --player teacher --runs 8 --workers 2` with `--commit fused` and with `--commit
undead_4,drake_4,fae_4,insect_4,construct_4` (the teacher, the five fused kinds and the five kins: 48 runs each, 15 and
20 min, beside the expert's); `npm run pool` (256 seeds, a second).

Criterion 1, the pool (a walk meets 11.4 battles on floor 1 and 11.3 on floor 2; the draft offers each floor-1 kind in
1.1 of its 3 picks):

| Fused kind | Its parts' expected battles by the end of floor 2 (floor 1 + floor 2) | Reach | 3 or more |
|---|---|---|---|
| Pale Court | 3 Will-o'-Wisps 9.6 (5.4 + 4.3) | 9.6 | met |
| Bone Colossus | 2 Tomb Knights 4.6 (2.1 + 2.5), a Bone Chanter 4.9 (2.1 + 2.9) | 4.6 | met |
| Hive Queen | 2 Hive Wardens 2.7 (1.3 + 1.4), a Mantis Reaper 1.3 (0 + 1.3) | 1.3 | no |
| Rime Drake | an Ember Drake 0.2 (0 + 0.2), 2 Frost Sprites 11.6 (6.0 + 5.6) | 0.2 | no |
| Clockwork Titan | 2 Clockwork Pages 11.3 (5.8 + 5.5), an Iron Golem 0.1 (0 + 0.1) | 0.1 | no |

The synergies, battles by the end of floor 2 offering a kind of the kin or role: Fae 18.0, Undead 16.6, Construct
11.3, Insect 8.6, Drake 5.0; Skirmisher 16.6, Vanguard 14.8, Channeler 13.4, Trickster 12.5, Warden 4.0, Ranger 0.2.

The expert, `div-0…63` (progress in points, against free play seed for seed ± one standard error; the margin over the
clears; "reached": runs that made its fusion or held its synergy, the median battle it came on; "Court": runs that made
a Pale Court):

| Archetype | Clears | Progress (vs free play) | Died on floor 1 / 2 / 3 / 4 | Monarch / pieces (%) | Essence left | Turns a battle | Reached (battle) | Court |
|---|---|---|---|---|---|---|---|---|
| free play | 49 (77%) | 84.4 | 10 / 1 / 1 / 3 | 96 / 94 | 1,474 | 5.9 | | 83% |
| Bone Colossus | 47 (73%) | 80.7 (−3.7 ± 5.4) | 11 / 3 / 1 / 2 | 95 / 90 | 721 | 6.4 | 3% (7) | 78% |
| Rime Drake | 36 (56%) | 70.3 (−14.0 ± 4.7) | 19 / 3 / 0 / 6 | 93 / 96 | 1,457 | 6.4 | 66% (31) | 67% |
| Hive Queen | 41 (64%) | 80.8 (−3.6 ± 4.7) | 9 / 4 / 2 / 8 | 96 / 97 | 828 | 6.6 | 25% (44) | 78% |
| Clockwork Titan | 40 (63%) | 78.9 (−5.5 ± 4.9) | 10 / 5 / 2 / 7 | 96 / 91 | 946 | 6.6 | 0% | 75% |
| Pale Court | 47 (73%) | 81.9 (−2.5 ± 4.4) | 11 / 2 / 0 / 4 | 95 / 94 | 1,311 | 6.0 | 83% (7) | 83% |
| Undead 4 (Legion) | 41 (64%) | 79.1 (−5.3 ± 5.0) | 10 / 5 / 2 / 6 | 98 / 90 | 835 | 6.2 | 67% (10) | 73% |
| Drake 4 (Dragonfire) | 39 (61%) | 75.3 (−9.0 ± 5.4) | 15 / 2 / 2 / 6 | 95 / 89 | 799 | 7.0 | 3% (50) | 73% |
| Fae 4 (Mirage) | 43 (67%) | 77.5 (−6.9 ± 4.9) | 12 / 5 / 1 / 3 | 96 / 93 | 760 | 6.8 | 36% (31) | 72% |
| Insect 4 (Frenzy) | 36 (56%) | 78.5 (−5.9 ± 4.7) | 9 / 5 / 3 / 11 | 97 / 94 | 825 | 6.4 | 16% (43) | 80% |
| Construct 4 (Last Stand) | 42 (66%) | 79.7 (−4.7 ± 4.8) | 9 / 5 / 3 / 5 | 97 / 94 | 824 | 6.7 | 0% | 77% |
| Vanguard 4 (Bodyguard) | 43 (67%) | 79.7 (−4.6 ± 4.8) | 9 / 5 / 3 / 4 | 96 / 93 | 928 | 6.6 | 0% | 77% |
| Ranger 4 (Deadeye) | 34 (53%) | 78.6 (−5.8 ± 4.6) | 9 / 5 / 3 / 13 | 96 / 92 | 675 | 6.8 | 5% (48) | 77% |
| Skirmisher 4 (Ambush) | 38 (59%) | 74.6 (−9.8 ± 4.9) | 12 / 6 / 4 / 4 | 93 / 93 | 609 | 7.0 | 2% (9) | 73% |
| Channeler 4 (Echo) | 46 (72%) | 84.0 (−0.4 ± 4.6) | 10 / 0 / 2 / 6 | 98 / 90 | 970 | 6.1 | 83% (10) | 84% |
| Warden 4 (Sanctuary) | 42 (66%) | 79.5 (−4.8 ± 4.8) | 9 / 5 / 3 / 5 | 97 / 94 | 831 | 6.7 | 9% (48) | 77% |
| Trickster 4 (Deathblow) | 40 (63%) | 79.0 (−5.4 ± 4.5) | 10 / 5 / 2 / 7 | 93 / 91 | 569 | 6.9 | 2% (45) | 78% |

The teacher, `div-0…7` (0.9 and 1.3 overrides of the expert's pick a run, ~250 decisions played out; 26–74 s a run):

| Archetype | Clears | Progress (vs free play) | Died on floor 1 / 2 / 3 / 4 | Monarch / pieces (%) | Essence left | Turns a battle | Reached (battle) | Court |
|---|---|---|---|---|---|---|---|---|
| free play | 8/8 | 100 | – | 99 / 98 | 1,287 | 5.8 | | 8/8 |
| Bone Colossus | 8/8 | 100 | – | 95 / 87 | 535 | 6.4 | 0/8 | 8/8 |
| Rime Drake | 8/8 | 100 | – | 94 / 94 | 876 | 7.1 | 8/8 (35) | 8/8 |
| Hive Queen | 7/8 | 91.0 (−9.0 ± 9.0) | 0 / 1 / 0 / 0 | 100 / 90 | 575 | 7.2 | 2/8 (46) | 7/8 |
| Clockwork Titan | 8/8 | 100 | – | 100 / 81 | 642 | 7.3 | 0/8 | 8/8 |
| Pale Court | 8/8 | 100 | – | 99 / 95 | 1,288 | 5.6 | 8/8 (9) | 8/8 |
| Undead 4 | 7/8 | 89.5 (−10.5 ± 10.5) | 1 / 0 / 0 / 0 | 99 / 88 | 581 | 6.6 | 6/8 (13) | 7/8 |
| Drake 4 | 8/8 | 100 | – | 97 / 88 | 458 | 7.4 | 0/8 | 8/8 |
| Fae 4 | 8/8 | 100 | – | 96 / 94 | 687 | 7.1 | 4/8 (26) | 8/8 |
| Insect 4 | 7/8 | 90.8 (−9.2 ± 9.2) | 0 / 1 / 0 / 0 | 100 / 95 | 746 | 6.6 | 0/8 | 7/8 |
| Construct 4 | 7/8 | 90.7 (−9.3 ± 9.3) | 0 / 1 / 0 / 0 | 94 / 92 | 563 | 7.3 | 1/8 (11) | 7/8 |

Free play's diversity block (the expert, `div-0…63`; criterion 3):

| | Free play | Criterion 3 |
|---|---|---|
| fused kinds in the final armies | Pale Court 83%, Rime Drake 34%, Bone Colossus 5% | none above 30%: not met |
| recipes made (runs; fusions) | Pale Court 83% (125), Rime Drake 34% (29), Bone Colossus 5% (3), Hive Queen and Titan 0 | each 8%+: not met, three short |
| synergies held (battles) | Echo 62%, Legion 37%, Mirage 4.8%, none 38% | six at 5%+: 2, not met |
| kinds held at the end | Chanter 88%, Court 83%, Wisp 61%, Sprite 48%, Hound 42%, Rime Drake 34%, Ghoul 9%, Knight 8%: 6 of 23 in a tenth or more | |
| pieces of the last battles | Channelers 86%, Rangers 9%, Skirmishers 4%, Vanguards 1%; Undead 46%, Fae 45%, Drakes 9% | |
| relics bought | 5.6 a run, 39% of them Command (Bone Horn 16%, Muster Roll 13%, Grave Banner 6%) | the ablation: `--ablations`' |

**What it says.** Criterion 1: two of the five fused kinds are reachable, the two whose parts are floor-1 kinds (the
Court in 9.6 battles by the end of floor 2, the Colossus in 4.6, its Knights mostly from the floor-1 elite); the other
three wait on a tier-3 keystone that 0.1 to 1.3 battles offer by then, as §1 read it, now a number Step 1 moves. Ranger
4 has no kind before floor 3 but the rare Ember Drake (0.2).

**A commitment by the book alone is a nudge, not a build.** Every committed row made a Pale Court in 67–84% of its runs
(free play 83%), and the teacher's in 7 or 8 of 8: the sketch's strength buys the Court wherever the Wisps come,
whatever the book points at. What the book moves is the keystone: the Rime Drake made in 66% of its runs (free play
34%), the Hive Queen in 25% (0); the Colossus in 3% (5%), the Titan in none. Of the synergies only Echo (83%) and Legion
(67%) are held in most of their runs, Mirage in 36%, the rest in 16% or fewer, Last Stand and Bodyguard never. Construct
4, Vanguard 4 and Warden 4, whose combos the book values at nothing (gains of 0.06 or less a floor), play as one: the
same run on 34 to 46 of the 64 seeds, the expert all but without its book. So the rows measure the expert's free play
bent a little toward each archetype, as §3 specified it; a firmer commitment (fusions, recruits or the draft held to the
archetype's recipes, kin or role) would be a harness rule over a frozen expert, and is for the user to decide before
criterion 2 is read off these rows.

Criterion 2, as far as they read it: no archetype the expert plays toward is far below free play. Committed, it clears
53% (Ranger 4) to 73% (the Court, the Colossus) against free play's 77%; progress −0.4 (Echo) to −14.0 points (the Rime
Drake, the one more than three standard errors off: 19 deaths on floor 1 against free play's 10, its keystone never
offered there). The teacher saturates at the base difficulty as §3 said it would, 7 or 8 of 8 for every
archetype; its margins part a little (its pieces kept 81% (Titan) to 95%, essence left 458 (Drake 4) to 1,288 (the
Court)). Criterion 2 needs the top difficulty: `--scale` for now, Step 7's ladder after.

Criterion 3: not met on any line. The Court is in 83% of free play's final armies, three recipes are made in under 8%
of runs, two synergies are held in 5% of battles or more (Mirage just under), and 86% of the pieces in the last battles
are Channelers: §5's audit on fresh seeds (77% clears here against 65% on `aud-*`, deaths 10 / 1 / 1 / 3).

### The fusion graph (Step 2, 2026-10-15)

**Built** (§4.1, the content step and the expert's part; the interface's drawing of a trine is left to its agent):
`content.js trineOf` makes every trine no record is written for, at load, by one rule: **32 made** (17 of the kinds met,
4 of the mixed fused kinds, 11 of trines: the Pale Court's and ten made ones', up to tier 6), **1 written** (the Pale
Court, `trineOf: 'will_o_wisp'`, its stats and line kept), 69 abilities made (`trine:<ability>`: a blow at one foe a
blast, a ranged blow a tile longer); **7 capstones** (§4.1's table), four of them with a rule in `rules.js` scoped to the
piece (Charnel Cathedral's rise beside it, Cinder Wyrm's spreading fire, Hive Mind's drones at every wave and skills
ready on a kill, Engine of Ages' stand), three by abilities and auras alone; **44 recipes** (33 triples, 4 mixed, 7
capstones), 64 kinds. `TUNING.trine` is §4.1's table. Where this differs from §4.1's letter: a made trine's growth is
scaled as its base (with the kind's growth unscaled a trine of a fused kind fell below its parts' sum past level 1), and
it keeps its kind's aura; a trine of a trine summons the trine it was made of; the line "within two of the parts' tiers'
sum less their count" holds the mixed recipes and the capstones, the triples keep their own (+2: a tier-1 triple, 0
by the line, is tier 3, as the Pale Court was). The book: 135 combos (57 before); a fused part counts as far along its
own recipe as the run is (`comboProgress`), and is met on its parts' floor (`firstFloor`). The tests: 439 (Step 0's
428 and this step's 11), all passing (`node --test --test-concurrency=1`, 641 s); `outforest.test.js` moved from `sim-395`, whose lines
the graph makes run to floor 4, to `sim-540`.

**Run time**: the larger book made the sketch 202 → 332 µs on a mid-run retinue; read once a state (`standingCounts`,
`gainFrom`), 171 µs, and on the old content three whole runs' logs byte for byte the same. Eight runs `--seed t2`, each
alone and base and graph in turn: 0.41 s a battle before, 0.38 after (365 and 407 battles); `--runs 8 --seed t2
--workers 2`, 113 s of CPU before and 115 after.

**Measured** (the expert of f8c536f as Step 0 has it, its forests stale by design; seeds `div-*`, two workers beside two
other sessions): `npm run pool` (256 seeds); `npm run builds -- --commit none --runs 64 --workers 2` (free play, 10 min),
paired seed for seed against Step 0's free play; `npm run builds -- --commit
bone_colossus,rime_drake,hive_queen,clockwork_titan,pale_court,trine:grave_ghoul,trine:pyre_hound,trine:clockwork_page,charnel_cathedral,winter_court
--runs 32 --workers 2` (352 runs, 29 min). `--commit all` (~60 archetypes) was not run.

Criterion 1, the pool: **20 of the 44 recipes** have their parts offered in 3 or more battles by the end of floor 2.
Every floor-1 kind's trine is reachable but the Hive Warden's (2.7): the Frost Sprite's 11.6, the Clockwork Page's 11.3,
the Grave Ghoul's 10.9, the Court 9.6, the Bone Chanter's and the Pyre Hound's 4.9, the Tomb Knight's 4.6, and the
floor-2 Hive Drone's 5.5; the trines of these trines, the Colossus's and the Court's with them; the Charnel Cathedral
(4.6) and the Winter Court (9.6). Not reachable: the kinds first met on floor 2 or deeper but the Drone (Dryad 1.6,
Bloat 1.4, Mantis 1.3, Ember Drake 0.2, Golem 0.1, the floor-3 and floor-4 kinds 0), the three mixed recipes with a
tier-3 keystone, and the five capstones built on them. So every kin now has a reachable fused archetype (Undead: the
Ghoul's, Knight's and Chanter's trines, the Colossus, the Cathedral; Fae: the Court, the Sprite's trine, the Winter
Court; Construct: the Page's trine; Drake: the Hound's; Insect: the Drone's), and of the roles all but Warden and
Ranger. Step 1's flatter pool is what moves the rest.

Free play, the expert on `div-0…63` against Step 0's:

| | Step 0 | The graph |
|---|---|---|
| clears | 49 (77%) | 49 (77%): +8 −8 |
| progress | 84.4 | 90.0 (+5.7 ± 4.2) |
| died on floor 1 / 2 / 3 / 4 | 10 / 1 / 1 / 3 | 7 / 0 / 0 / 8 |
| battles a run; fusions a run | 42.3; 2.5 | 44.9; 5.5 |
| fused kinds in the final armies | Court 83%, Rime Drake 34%, Colossus 5% | Chanter's trine 84%, Court 81%, Sprite's trine 30%, Winter Court 23%, Court's trine 8%, Chanter's trine's trine 5%, the rest 2% or none |
| recipes made (runs) | 3 of 5 | 9 of 44: Court 88%, Chanter's trine 86%, Sprite's trine 52%, Winter Court 23%, Court's trine 8%, Great Chanter Trine 5%, Colossus, Rime Drake, Hound's trine 2% |
| synergies held (battles) | Echo 62%, Legion 37%, Mirage 5% | Echo 52%, Legion 33%, Mirage 7%; none 44% |
| kinds in a tenth of final armies | 6 of 23 | 11 of 62 |
| pieces of the last battles | Channelers 86% | Channelers 87%, Skirmishers 11% |

Committed, `div-0…31` (progress against free play's on the same seeds, 88.6, 23 clears; "made": runs that made its
fusion, the median battle):

| Archetype | Clears | Progress (vs free play) | Died on floor 1 / 2 / 3 / 4 | Made (battle) | Court |
|---|---|---|---|---|---|
| Bone Colossus | 15 | 83.1 (−5.5 ± 8.2) | 6 / 0 / 0 / 11 | 6% (48) | 26 |
| Rime Drake | 21 | 83.4 (−5.2 ± 6.6) | 6 / 0 / 0 / 5 | 81% (30) | 26 |
| Hive Queen | 18 | 85.6 (−3.0 ± 4.9) | 5 / 0 / 0 / 9 | 19% (42) | 27 |
| Clockwork Titan | 15 | 83.8 (−4.8 ± 5.4) | 6 / 0 / 0 / 11 | 0% | 26 |
| Pale Court | 17 | 84.1 (−4.5 ± 6.6) | 5 / 0 / 1 / 9 | 84% (9) | 27 |
| Grave Ghoul Trine | 18 | 86.1 (−2.5 ± 4.9) | 5 / 0 / 0 / 9 | 78% (22) | 26 |
| Pyre Hound Trine | 17 | 75.4 (−13.2 ± 6.8) | 8 / 1 / 0 / 6 | 63% (33) | 23 |
| Clockwork Page Trine | 14 | 83.8 (−4.8 ± 5.4) | 6 / 0 / 0 / 12 | 0% | 26 |
| Charnel Cathedral | 14 | 84.7 (−3.9 ± 7.6) | 5 / 0 / 1 / 12 | 0% (its Ghoul trine 15 runs, its Colossus none) | 27 |
| Winter Court | 20 | 86.7 (−2.0 ± 5.9) | 5 / 0 / 0 / 7 | 53% (34) | 27 |

Against Step 0's own committed rows on the same 32 seeds: the Rime Drake made in 26 runs (19), its progress +17.9 ±
6.0; the Hive Queen +8.3 ± 4.3, the Titan +9.5 ± 4.4, the Colossus +5.1 ± 3.6, the Court +1.3 ± 2.1; clears fewer for
the Colossus (24 → 15), the Titan (19 → 15) and the Court (23 → 17), more runs dying on floor 4 instead of earlier.

**What it says.** Criterion 1 moved from 2 of 5 recipes to 20 of 44, and from two kins to all five: the triple rule is
what reaches a floor-1 kind. Criterion 3 is not met, and the monoculture has moved rather than broken: the Bone Chanter's
trine joins the Court (84% and 81% of final armies), both Channelers, so Echo still leads and 87% of the last battles'
pieces are Channelers; the expert's strength term buys whatever triple the Wisps and Chanters it is offered complete,
and its book now rates the deep trines highest (a trine of trines' floor-1 army, its parts as three trines, tops the
book). What did spread: the Sprite's trine (52% of runs) and the first capstone made in free play (the Winter Court,
23%), Mirage past 5%, eleven kinds in a tenth of final armies. A committed run makes its trine where the floor offers
its kind (the Ghoul's 78%, the Hound's 63%) and none where the sketch values it below the Court and the Chanters (the
Page's 0%); a capstone's parts must both be made first, and the Cathedral's Colossus never was. Difficulty: floor-1
deaths 10 → 7 and floor 4 3 → 8, so the base difficulty is a little easier early, harder late; the forests are stale
(§3), and the balance pass reads it after the refit.

## 9. Standing rules

In force before this plan and still, with the amendments it makes:

- Enemy behaviour is discovered, never previewed: roads and the waves' turns are shown; a kind's reach, Move and way
  line are learnt by meeting it and then recorded, **and a met kind's reach is drawn on the board when tapped**
  (§4.8); nothing of the foes' coming turn is drawn.
- Defeat is absolute. No lives, no retreat.
- The skill gap opens in the player's decisions, in prep and in the turn, never in dice. **Floor 1 is hard at the top
  of the ladder** (§4.6), winnable at its foot.
- The dead never block the roads. Foes keep to the one drawn road; flyers the air road, blocked by your pieces.
- One soul is one piece is one body; no stacks. A piece counts once toward synergies (§7.7 may amend).
- A fusion is never weaker than what went into it. **Every kind of tier 4 or less has a triple** (§4.1).
- Money always matters: essence is scarce on every floor, and a relic bought is a tier not bought.
- Balance comes once, at the end. No tuning while building, but the numbers a step names (§6).
- Plan first; at most two agents at once; implement → verify → clean → bug hunt → bug hunt → balance. **Measure with
  the instrument §3 names for the question**, pair by seed, and never keep a change on the seeds it was chosen on.
- **The autoplayer is frozen** (§3, §4.0): its weights are not searched again and its rules not rewritten; its
  forests and route are refitted only at a milestone, and a refit is kept only on a paired gain on fresh seeds. The
  book is remade after every content change.
- One universal landscape interface, modular tabs, nothing that needs hover or a key.
- Recruit only: one slain foe a battle, as a full soul into the ossuary (§7.2 may amend).
- Content is data; code grows only when the vocabulary grows. A generated trine is content made by one rule (§4.1).
