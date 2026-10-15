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

**The interface** (2026-10-15): a kind that borrows its pictures is drawn as what it is, by one rule (`dom.js
figures`): a trine as the three it was made of, the front one whole and two behind it a step up and to either side,
smaller and darker (a trine of a trine, three trines: seven figures), 2×2 from tier 4 as before; a capstone as its
lender washed a pale ice (one colour matrix, `WASH`, for the board and the screens), so the Winter Court is never
taken for the Pale Court; a kind with pictures of its own (the Pale Court) by them. The board and the battle draw a
kind's figures as one picture made on first use from its lender's (`engine.js artOf`, `unit:<id>:<pose>`), so it
poses, falls, fades, takes a tint, a shade and a ghost as any picture, its pool of shadow under the whole group; the
screens as one portrait (`dom.js portrait`), so every card, the draft and the spoils, the ossuary, the altar and the
codex show the same. The Field's Fuse and the in-battle fuse are unchanged. A summon's line names the soul that called
it ("Summoned by your Bone Chanter Trine", `codex.js summonedBy`: a trine's summons are its kind, whose name misnamed
the caller), and a trine's panel says its summons are the kind it was made of, at that kind's HP. The codex's Fusions
page keeps the rule's line and adds a tile for each of the 33 triples (the trine drawn, its kind ×3), the one tapped
showing its card beside them. No number moved. Played in Chromium at 1440×900, 1024×768 and 852×393 (the title, the
draft, the Field with trines and a Fuse there, battles with a 1×1, a 2×2 and a great trine and a capstone through two
End Turns and the foes' playback and an in-battle fuse, the codex, an altar's three rites and a consecration taken): no
console error, nothing of Steps 1–5 broken.

### Availability (Step 1, 2026-10-15)

**Built** (`src/sim/run.js`, `src/tuning.js`; beside Step 2, merged after it): §4.2 as planned. `draftOffer(seed, pick,
held)` reads the kinds the picks took: the first offer is the draw as before; a later one is drawn as before and, where
it holds no kind that goes with a soul held (`partners`: a kin shared, a kind its own; or a recipe of `FUSION_LIST`
needing both, a kind with itself where it needs two or more), one of its places, drawn on the pick's own stream, goes to
one of the floor-1 pool's partners, drawn evenly. The kinds distinct, the floor-1 pool's, the seed's.
`TUNING.spawn.tierFalloff` 3 → 1.5 and `tierOverCap` 1 → 2 (§7 decision 1, taken as recommended); no other number moved.
`--pool`'s draft column plays `draftOffer` on the pool's seeds, each pick taken evenly (it was the even draw's formula).
A log's picks index into the offers, so an old log's later pick may now name another kind; no log is kept anywhere yet
(the save is Step 8), and every test that replays plays its log on the same code.

The guarantee (`div-0…255`, every path of picks taken evenly): the plain draw already held a partner in 61% of second
offers and 79% of third; the rest changed in one place. The three floor-1 kinds with no kin-mate in the floor-1 pool
(Pyre Hound, Clockwork Page, Hive Warden) are offered again at the second pick every time (were 36–39%), the Fae and the
Undead in 43–54% (35–42%). Step 2's triples make every kind its own recipe partner, which its kin already made it: the
offers are the same with the graph and without (the same numbers on both trees).

**Tests**: the guarantee over 100 seeds and every path of picks (1,300 offers: the first the plain draw; a later one the
plain draw unless that held no partner, then changed in one place; every one from the second holding a partner), the
relation (every recipe's parts partners, a kin, a recipe across kins, and none), a run dealing it; the pool by tier
(each pool summing to one; tier 1 65–90% of a floor-1 fight's draws and 15–30% of floor 3's; tier 3 2–10% of floor 2's
and 7–20% of floor 3's; an elite a tier up); the pool table's draft column. Fixed, their intent kept: the cheap floor-1
run of `outside`, `outforest` and `builds` is sim-10 (five battles, three recruits, a purchase; sim-0 clears now,
sim-395 ends after two battles, Step 2's sim-540 clears); `outside`'s clearing run is sim-1 (sim-5 falls on floor 1,
sim-3 with the graph on floor 4); the route puzzle's two rooms have the same foes, so the Monarch's rule is read and not
the odds, which now refused its elite. 430 before the merge, 441 after (`--test-concurrency=1`, 443 s), all passing.

**Measured** (the expert of f8c536f, its forests and route unrefitted; the draft on; seeds `div-*`; two workers beside
another session): `npm run pool` at 09052bf (Step 2) and on the merge; the expert's free play, `npm run builds --
--commit none --runs 256 --workers 2`, at 09052bf (24 min; its first 64 runs are Step 2's free play, the same runs) and
on the merge (21 min), and a third arm, the merge with the old `tierFalloff` and `tierOverCap` in a copy (the draft's
guarantee alone); the same pair on the content before Step 2 (c0a2aff, and this step's first commit a2aa214); basic and
the calculator (`calc.js`) on `div-0…63`.

The pool (Step 2 adds no spawnable kind: the same on both trees), each tier's share of a fight's draws (an elite's in
brackets), before → after:

| Tier | Floor 1 | Floor 2 | Floors 3–4 |
|---|---|---|---|
| 1 | 90 → 76% (12 → 28%) | 89 → 70% (10 → 23%) | 10 → 22% (5 → 16%) |
| 2 | 10 → 24% (88 → 72%) | 12 → 26% (86 → 68%) | 84 → 63% (16 → 30%) |
| 3 | – | 0 → 5% (4 → 8%) | 6 → 13% (76 → 49%) |
| 4 | – | – | 0 → 2% (3 → 6%) |

Criterion 1 (256 seeds): **22 of the 44 recipes** have their parts offered in 3 or more battles by the end of floor 2
(20 at Step 2): the Hive Warden's trine (2.7 → 4.2) and its trine join. The kinds first met on floor 2 come nearer and
stay short: the Thorn Dryad's trine 1.6 → 2.2, the Rot Bloat's 1.4 → 2.0, the Mantis Reaper's 1.3 → 1.9, the Ember
Drake's 0.2 → 1.1, the Iron Golem's 0.1 → 0.7; the floor-3 and floor-4 kinds' none. The floor-1 kinds' trines give a
little (the Sprite's 11.6 → 10.2, the Page's 11.3 → 9.7, the Ghoul's 10.9 → 10.1, the Court 9.6 → 8.9, the Drone's 5.5 →
4.1), the tier-2 kinds' gain (the Chanter's 4.9 → 6.6, the Hound's 4.9 → 5.7, the Knight's 4.6 → 5.2). The mixed
recipes:

| Fused kind | Its parts, by the end of floor 2 (floor 1 + floor 2) | Reach | 3 or more |
|---|---|---|---|
| Bone Colossus | 2 Tomb Knights 4.6 → 5.2, a Bone Chanter 4.9 → 6.6 | 4.6 → 5.2 | met |
| Hive Queen | 2 Hive Wardens 2.7 → 4.2, a Mantis Reaper 1.3 → 1.9 (0 + 1.9) | 1.3 → 1.9 | no |
| Rime Drake | an Ember Drake 0.2 → 1.1 (0 + 1.1), 2 Frost Sprites 11.6 → 10.2 | 0.2 → 1.1 | no |
| Clockwork Titan | 2 Clockwork Pages 11.3 → 9.7, an Iron Golem 0.1 → 0.7 (0 + 0.7) | 0.1 → 0.7 | no |

On floor 3 the keystones' partners stay: Frost Sprites in 1.6 → 3.4 battles, Clockwork Pages 1.5 → 3.4; the keystones
2.5–2.8 → 2.8–3.5. The synergies, battles by the end of floor 2: Drake 5.0 → 6.5, Warden 4.0 → 6.0, Ranger 0.2 → 1.1,
Fae 18.0 → 16.9, Construct 11.3 → 10.1, the rest within a battle. No falloff alone meets criterion 1 for the three
keystone recipes (the pool table with `TUNING.spawn` patched in process, 64 seeds): at 1, 0.5 and 0 (every kind by its
weight alone) their keystones reach 1.0–2.1, 1.4–2.4 and 1.8–2.7, while floor 1's fights fall to 53% tier 1 at 0. A
keystone is a floor-2 kind (`minFloor` 2), one of fourteen in floor 2's eleven battles.

The expert, free play, `div-0…255`, seed for seed (± one standard error of the paired difference), on the merge:

| | Step 2 (09052bf) | The draft's guarantee alone | Step 1 (the merge) |
|---|---|---|---|
| clears | 189 (74%) | 183 (71%): −2.3 ± 2.1 points | 162 (63%): −10.5 ± 3.8 points (35 seeds won, 62 lost) |
| progress | 89.7 | 88.5 (−1.2 ± 1.5) | 84.6 (−5.1 ± 2.7) |
| died on floor 1 / 2 / 3 / 4 (of them, in the Sovereign's room) | 29 / 0 / 1 / 37 (33) | 32 / 0 / 1 / 40 (34) | 42 / 1 / 2 / 49 (45) |
| battles a run; battles lost; fusions a run | 45.2; 67; 5.4 | 44.7; 73; 5.5 | 42.4; 94; 5.0 |
| fused kinds in the final armies | Chanter's trine 81%, Court 80%, Winter Court 27%, Sprite's trine 19%, Chanter's trine's trine 9%, Court's trine 6%, Colossus 2%, Rime Drake 1% | Court 80%, Chanter's trine 79%, Winter Court 31%, Sprite's trine 19%, Chanter's trine's trine 10%, Court's trine 5%, Colossus and Rime Drake 2% | Chanter's trine 78%, Court 74%, Winter Court 25%, Sprite's trine 21%, Chanter's trine's trine 7%, Court's trine 5%, Rime Drake 4%, Colossus 3% |
| recipes made in a run or more | 10 of 44 | 11 | 10 |
| synergies held (battles) | Echo 58%, Legion 37%, Mirage 6.2%; none 39% | Echo 56%, Legion 36%, Mirage 6.9%; none 41% | Echo 60%, Legion 39%, Mirage 4.8%; none 38% |
| kinds held at the end in a tenth of runs or more | 10 of 62 | 11 | 8 |
| pieces of the last battles | Channelers 88%, Skirmishers 9% | Channelers 87%, Skirmishers 11% | Channelers 85%, Skirmishers 12% |

On Step 2's 64 seeds alone the merge reads 49 → 41 clears (−12.5 ± 7.2 points; progress −3.7 ± 5.4; deaths 7 / 0 / 0 / 8
→ 9 / 0 / 2 / 12). On the content before Step 2 the same change read the other way, `div-0…255`: clears 187 (73%) → 199
(78%), +4.7 ± 3.6 points, progress −0.5 ± 2.6, deaths 38 / 5 / 3 / 23 → 42 / 2 / 5 / 8 (to floor 4's rooms 20 → 7; the
Sovereign 3 → 1), the Rime Drake made in 28% → 38% of runs, the Court 84% → 83%, the Colossus 5% → 2%, Mirage 6.3% →
4.3%; there its first 64 seeds read −4.7 ± 6.5, the noise 256 resolve.

Basic, `div-0…63`: all 64 dead on floor 1 at Step 2 and on the merge, 2.2 → 2.1 battles a run. The calculator,
`div-0…63`: no clear either side, dead on floor 1 / 2 / 3 / 4 47 / 9 / 7 / 1 → 47 / 10 / 6 / 1 (floor 2 reached in 17
runs both), 11.4 → 10.2 battles a run.

**What it says.** Criterion 1: 20 → 22 of 44 recipes, the Insect kin's second archetype and the Warden role's first (the
Hive Warden's trine), so every role but Ranger now has a reachable one. The flattening moves what §1 said it would, not
far enough: by the end of floor 2 the Ember Drake and the Iron Golem are offered six and eight times as often, the
Mantis Reaper half as often again, and on floor 3 the keystones' partners twice as often; but no recipe with a floor-2
keystone reaches 3, and no falloff alone would (at 0, 2.7 at best). What is left is §4.2's alternative (a captain a tier
up), or a keystone allowed on floor 1. The draft's guarantee changes 39% of second offers and 21% of third, so a second
of a kind or a kin-mate is always on the table, at a cost within the noise (−2.3 ± 2.1 points). Criterion 3: unmoved
(the Chanter's trine and the Court in 78% and 74% of final armies, ten recipes made, two synergies in 5% of battles or
more, Mirage falling under it); the expert's forests, route and book were fitted on the old pool and play the Channelers
wherever their parts come, so the new reach is the committed runs' and the refit's to read. Criterion 4: on what ships
the pool costs the expert **8.2 ± 3.9 points of clears** (the merge against the draft alone), at both ends. Floor 1's
fights carry 24% tier-2 foes (were 10%): its deaths 32 → 42. The Sovereign's room draws its two first waves from floor
4's fight pool, now 13% tier 3 and 2% tier 4 (were 6% and none): the deaths in it 34 → 45, on a content where it was
already the expert's wall (Step 2: 3 → 8 deaths on floor 4; 33 of 256 to the Sovereign here). On the old content the
same pool made floor 4's rooms easier (20 → 7 deaths) and the Sovereign no harder. Basic and the calculator do not move:
the ladder keeps its order, its foot still too hard (§1). Kept as §7 decision 1 took it; the balance pass may want the
Sovereign's waves drawn from the old falloff, or floor 1's fights capped at their own tier, before the refit reads the
difficulty.

### Synergies (Step 3, 2026-10-15)

**Built** (§4.3, in `rules.js`, the synergy records and `TUNING`; no other number moved): Echo split by the one step,
the Channeler synergy's record carrying `full: 8`, the count of its role at which the rule holds whole; `rulesOf` tells
a split rule which (`params.full`, by the side's counts, now kept with its synergies: `synergyCounts`,
`synergyCountsOf`, `synergyFull`). Below it every ability echoes at `TUNING.echo.half` (0.5) of its effect: the second
landing's damage and healing power halved, a status laid for half its turns (Regen 5 → 3, Brittle 3 → 2). Ambush
Hastened for the first `TUNING.ambush.turns` (2) turns; Bodyguard, and the side's Vanguards take
`TUNING.bodyguard.taken` (0.8) of what lands on them; Mirage the first blow each foe would land each turn; Last Stand,
and it heals `TUNING.lastStand.heal` (30%) as it stands; `TUNING.deathblow.below` 0.25 → 0.35. Each card writes its
number in from TUNING; the codex's ladders read `full` as a step of its own (the Synergies page, the tracker's chip and
its card: Echo at 4, "Echo in full" at 8). Where this differs from §4.3's letter: a status's halved turns round up (a
one-turn Hex echoes whole), and a cleanse or a cooldown echoes whole; Bodyguard's 20% covers a burst and a tick too; and
a new hook, `stand`, after every `modify` and on the rounded damage, where Last Stand and the Engine of Ages now stand,
so a Construct Vanguard under Bodyguard is never stood up from a blow the 20% leaves it alive from. **The expert's
part**: nothing to change. No reader estimates a rule's strength: the sketch's `strength`, the book's `bookPower` and
the situation count the synergies held, a split one once, and nothing reads Echo's second landing, a stand or
Deathblow's threshold; the book remade, byte for byte the same (before the merge with Step 1 and after). The tests: 445
before the merge (439 and six), 447 after, all passing (`--test-concurrency=1`, 330 s); `outside.test.js`'s clearing run
moved to sim-2, sim-1's expert now falling on floor 4.

**Measured** on the merge with Step 1 (7b853ed and this step; the expert as Step 0 has it, its forests stale; seeds
`div-*`; workers beside other sessions): free play `--commit none --runs 256 --workers 3` (14 min), paired seed for seed
against Step 1's own free play at 7b853ed (its §8 numbers, the same runs); `--commit synergies --runs 32` (36 min), and
at 7b853ed the six archetypes whose rules changed and Legion's (27 min); Echo's two forms counted in process on
`div-0…15` (the rule's hook wrapped by a script outside the repo, in the battles played, not the expert's rehearsals);
the foes' synergies read off the rooms of `div-0…255` as drawn (a walk taking each fork evenly, a room's formations each
counted as it enters). Before the merge the same measure against Step 2 (09052bf), on 64 and 32 seeds, is the last
paragraph's.

Free play, `div-0…255`:

| | Step 1 (7b853ed) | Synergies |
|---|---|---|
| clears | 162 (63%) | 152 (59%): +13 −23, −3.9 ± 2.3 points |
| progress | 84.6 | 83.8 (−0.8 ± 0.4) |
| died on floor 1 / 2 / 3 / 4 | 42 / 1 / 2 / 49 | 42 / 2 / 4 / 56 |
| battles a run; fusions a run; turns a battle | 42.4; 5.0; 5.9 | 42.0; 4.9; 6.1 |
| synergies held (battles) | Echo 60%, Legion 39%, Mirage 4.8%; none 38% | Echo 60%, Legion 38%, Mirage 4.9%; none 39% |
| six or more of eleven at 5%+ | 2: not met | 2: not met |
| fused kinds in the final armies | Chanter's trine 78%, Court 74%, Winter Court 25%, Sprite's trine 21% | Chanter's trine 77%, Court 74%, Winter Court 25%, Sprite's trine 20% |
| pieces of the last battles | Channelers 85%, Skirmishers 12% | Channelers 84%, Skirmishers 12% |
| kinds in a tenth of final armies | 8 of 62 | 9 of 62 |

Echo's two forms, `div-0…15`: of the 307 battles your Echo rang in, 146 at half throughout, 102 whole throughout and 59
both (the count crossing 8 mid-battle); 2,715 echoes at half, 3,634 whole. The last battles field 3.9 Channeler pieces
on average and 8 in three runs of 256 (summons aside): the whole Echo is the Bone Chanters' summons'.

Committed, `div-0…31` (Step 1 and Synergies seed for seed; "reached": runs that held the synergy, the median battle it
came on; "held": the battles that began with it):

| Archetype | Clears | Progress (paired) | Died on floor 1 / 2 / 3 / 4 | Reached (battle) | Held |
|---|---|---|---|---|---|
| free play | 21 → 20 (+2 −3) | 90.1 → 86.0 (−4.1 ± 2.4) | 3 / 0 / 1 / 7 → 3 / 1 / 3 / 5 | | |
| Fae 4 (Mirage) | 20 → 19 (+3 −4) | 82.8 → 82.0 (−0.9 ± 0.9) | 6 / 0 / 0 / 6 → 6 / 0 / 1 / 6 | 12 → 12 (38%, 33) | 9% → 10% |
| Construct 4 (Last Stand) | 13 → 13 (+1 −1) | 81.9 → 81.0 (−0.9 ± 1.4) | 6 / 0 / 0 / 13 → 6 / 0 / 1 / 12 | 0 → 0 | 0 |
| Vanguard 4 (Bodyguard) | 14 → 14 (+1 −1) | 81.9 → 81.1 (−0.8 ± 1.4) | 6 / 0 / 0 / 12 → 6 / 0 / 1 / 11 | 0 → 0 | 0 |
| Skirmisher 4 (Ambush) | 15 → 12 (+1 −4) | 80.3 → 79.1 (−1.2 ± 0.7) | 7 / 0 / 0 / 10 → 7 / 0 / 0 / 13 | 0 → 0 | 0 |
| Channeler 4 (Echo) | 16 → 15 (+1 −2) | 89.4 → 88.0 (−1.4 ± 1.0) | 3 / 0 / 1 / 12 → 3 / 0 / 2 / 12 | 28 → 27 (84%, 9) | 61% → 61% |
| Trickster 4 (Deathblow) | 13 → 11 (+1 −3) | 76.4 → 74.5 (−1.9 ± 1.3) | 8 / 0 / 0 / 11 → 8 / 0 / 1 / 12 | 0 → 0 | 0 |
| Undead 4 (Legion, unchanged) | 11 → 11 (+5 −5) | 81.1 → 79.4 (−1.7 ± 1.1) | 6 / 1 / 0 / 14 → 6 / 1 / 1 / 13 | 23 → 22 (69%, 10) | 41% → 40% |

The rules that stand, committed on the Synergies' side alone (against its free play, 20 clears): Drake 4 14 clears
(−11.3 ± 7.7), reached in none; Insect 4 13 (−5.9 ± 7.0), 9% (47); Ranger 4 11 (−5.8 ± 6.9), 6% (48); Warden 4 12 (−5.0
± 6.6), 9% (48).

The foes hold them too (§2.12 of the old spec), and on the deep floors often: a formation holds Bodyguard in 16%, 29%
and 42% of the battle rooms of floors 2, 3 and 4, Ambush in 21%, 19% and 31%, Mirage in 19%, 23% and 33%, Deathblow in
7%, 7% and 15%, Last Stand in 5%, 5% and 13%, Echo in 11%, 22% and 33% (none on floor 1: no formation there is four
strong).

**What it says.** Criterion 3's synergy line has not moved: two of the eleven at 5% of battles or more (Echo 60%, Legion
38%; Mirage 4.9%, just under, as at Step 1), and of the five rules raised Bodyguard, Last Stand and Deathblow were never
held by the expert in free play and Ambush in one battle of 10,748; committed to Construct 4, Vanguard 4, Skirmisher 4
or Trickster 4 it holds the synergy in none of 32 runs, as Step 0 found on the old content and as before the merge. Two
things keep them out of play, neither of them their strength. The expert does not read a rule's strength: its sketch and
its book count the synergies a field holds, each one alike, so raising Ambush or Last Stand changes no choice it makes.
And it does not gather them: what the sketch buys first are the Court's parts and the Chanters, and the book values the
Construct's, the Vanguard's and the Warden's combos at nothing (Step 0); Step 1's flatter pool brought Ranger 4 and
Warden 4 within a few runs (6% and 9%), Construct, Vanguard, Skirmisher, Trickster and Drake 4 within none. Whether the
raised rules are of Echo's class is unmeasured until a player holds them: Step 4's kin banners, the committed teacher,
or a harness rule holding a committed run to its kin or role (Step 0's question for the user) are what would show it.

What did move is the cost, from two sources this record does not part: the expert's Echo halved (in about half the
battles it rings in, until the Chanters' summons make eight), and the foes' raised rules (the deep floors' formations
hold Bodyguard in 29–42% of their rooms, Ambush, Mirage and Echo in a fifth to a third, their Echo halved too). Free
play lost 0.8 ± 0.4 points of progress and 3.9 ± 2.3 of clears (13 seeds won, 23 lost), its deaths on floors 3–4 51 →
60; committed, every changed archetype lost 0.8 to 1.9 points (Ambush three clears, Deathblow two, Echo and Mirage one,
Last Stand and Bodyguard none), runs whose own side gains nothing from the raise. The end of a run reads harder, on top
of Step 1's (above: the Sovereign's room); the balance pass reads it with the rest (§6, Step 6: Echo's halves among its
numbers).

Before the merge, against Step 2 (09052bf): free play on `div-0…63` 49 → 44 clears (+1 −6), progress −1.5 ± 0.9, floor-4
deaths 8 → 11, the synergies held as before (Echo 52% → 51%, Legion 33% → 32%, Mirage 7% → 7%); committed on `div-0…31`,
Mirage 20 → 20 clears, Last Stand 16 → 12, Bodyguard 18 → 14, Ambush 20 → 15, Echo 18 → 11, Deathblow 15 → 17, Legion 11
→ 5, and none of Last Stand, Bodyguard, Ambush or Deathblow held in any run; Echo's forms on `div-0…15` 142 battles at
half, 105 whole, 31 both.

### The altar's choice (Step 5, 2026-10-15)

**Built** (§4.5, §7 decision 2 taken as recommended; on 7b853ed beside Step 3, merged after it): walking into an altar
asks its rite, and the rite ends the room (`run.js`: phase `altar`, `altarActions`): `{ type: 'heal' }`, as every altar
gave; `{ type: 'transmute', uid, index }`, a standing soul of a kind the foes bring made one of `TUNING.run.altarOffer`
(3, a new number; none moved) kinds of the floor's pool (`spawnPool`) at its tier, never its own, drawn evenly on a
stream of the altar's and the kind's (`transmuteOffer`); `{ type: 'consecrate', kind, track }`, the kind's next tier,
free, as `advance` gives a bought one. Nothing else is done at an altar; the log holds the rite and `replay` plays it.
The tier rule, the least surprising: tiers are a kind's, not a soul's (DESIGN §2.6), so none moves. The old kind keeps
those bought for it, the soul holds its new kind's (none for a kind new to the run; Soul Lantern lights recruits
alone), and its level is kept by its new kind's `least`, a fused kind's rule, so it and every soul of its new kind
stand at the higher of the two; its uid, relics, share of HP and cell (where its new footprint fits) kept. A fused
soul has no offer (made, not met); a fallen one is the heal's. **The expert's part**: `autoplay.js pickAltar`, every
rite weighed by the growth search as a purchase is (`grow`: each on a copy, its sketch's gain), the heal where nothing
beats keeping; basic heals. Where this differs from §6's letter: the sketch reads the souls' wounds but never the
Monarch's, so the new decision has a tree of its own, `expert.js TREES.altar`, holding the route's two reasons for
walking to an altar (`wounded-altar`, `monarch-altar`, at their thresholds in `TUNING.expert.tree`) as reasons to heal
there; no weight or rule of the expert's moved. `outside.js` mirrors it (`baseStep`, `ORDER`, `PHASES` gaining
`altar`: the rites by the sketch's gain, the expert's pick first, no passing on), and `calc.js` (the heal first while
the Monarch is below half or a soul fallen, else the free tiers in its purchases' order; the transmutations last). The
harness reads each battle's lead (the kin and the fused kind most of its pieces are) and prints the altars' rites and
the runs whose lead turned after floor 1 (`altarRites`, `pivots`). The screen: the rites as tabs; a transmutation's
three kinds as the draft's cards beside a chooser of its souls, a consecration's two tracks beside its kinds; the heal
as before; each rite's note on the map (Chromium at 1440×900, 1024×768 and 852×393, every rite taken, no console
error). The tests: 441 → 452 (`altar.test.js` 8, and one each in `outside`, `builds` and `codex`), 458 on the merge
with Step 3, all passing (`--test-concurrency=1`, 548 s; the speed test passes alone, under load it ran past its
milliseconds).

**Measured** (the expert as Step 0 has it, its forests stale; seeds `div-*`; two or three workers): free play, `--commit
none --runs 64`, on the merge and on its base e6266bb (Step 3), and before the merge on this step and 7b853ed; three
kins the floor feeds least committed, `--commit drake_4,construct_4,insect_4 --runs 32`, on the merge (against Step 3's
own `--commit synergies` run at e6266bb) and before it (against 7b853ed); the rites the expert took, by a script outside
the repo, on `div-0…31` free and `div-0…15` committed. Each base was played again with the harness's lead read and
nothing else: 7b853ed's runs are Step 1's first 64 and e6266bb's Step 3's, result, floor, progress and battles, seed for
seed.

Free play on the merge, `div-0…63`, seed for seed:

| | Step 3 (e6266bb) | The altar's choice |
|---|---|---|
| clears | 39 (61%) | 39 (61%): +5 −5, 0.0 ± 5.0 points |
| progress | 84.6 | 86.3 (+1.7 ± 1.2) |
| died on floor 1 / 2 / 3 / 4 | 9 / 1 / 3 / 12 | 9 / 0 / 1 / 15 |
| battles a run; battles lost | 42.0; 25 | 42.9; 25 |
| altars' rites | every one a heal | 3.3 a run: consecrate 51%, heal 46%, transmute 3% |
| fused kinds in the final armies | Chanter's trine 80%, Court 78%, Winter Court 36%, Sprite's trine 16% | Chanter's trine 84%, Court 77%, Winter Court 33%, Sprite's trine 23% |
| synergies held (battles) | Echo 57%, Legion 36%, Mirage 3.9%; none 42% | Echo 60%, Legion 37%, Mirage 7.4%; none 38% |
| the lead turned after floor 1: kin (of the runs past it) | 30 of 55 (19 cleared) | 30 of 55 (17 cleared) |
| fused kind (of the runs fielding one on both) | 24 of 46 (13 cleared) | 29 of 49 (16 cleared) |

The rites, `div-0…31` (before the merge; 110 in 32 runs): on floors 1 and 2 the free tier, 48 of 60 (the heal 10, a
transmutation 2), on floors 3 and 4 the heal, 38 of 50; the tiers to the Chanter's trine 19, the Sprite's trine 12, the
Wisp 8, the Court 7, the Sprite 6; the three transmutations Sprite → Wisp and Hound → Chanter twice; 3 of the 48 heals
with the Monarch below half.

Committed on the merge, `div-0…31` (Step 3 → the altar's choice; "reached": runs that held the synergy):

| Archetype | Clears | Progress (paired) | Died on floor 1 / 2 / 3 / 4 | Reached | Rites: heal / transmute / free tier |
|---|---|---|---|---|---|
| free play | 20 → 20 (+3 −3) | 86.0 → 89.8 (+3.8 ± 2.2) | 3 / 1 / 3 / 5 → 3 / 0 / 1 / 8 | | 40 / 3 / 57% |
| Drake 4 | 14 → 19 (+7 −2) | 74.7 → 77.4 (+2.7 ± 4.2) | 8 / 0 / 1 / 9 → 8 / 0 / 0 / 5 | 0 → 1 | 24 / 20 / 57% |
| Construct 4 | 13 → 20 (+9 −2) | 81.0 → 86.9 (+5.8 ± 4.3) | 6 / 0 / 1 / 12 → 4 / 0 / 1 / 7 | 0 → 0 | 29 / 7 / 64% |
| Insect 4 | 13 → 15 (+7 −5) | 80.1 → 85.6 (+5.5 ± 4.5) | 6 / 0 / 2 / 11 → 4 / 1 / 0 / 12 | 3 → 7 (held 1% → 4% of battles) | 17 / 27 / 56% |

What the committed runs transmute (`div-0…15`, on the merge): Drake 4 Chanters into Pyre Hounds 7 times and Knights 3;
Insect 4 Chanters into Hive Wardens 7 and Sprites into Hive Drones 4, a Wisp into a Drone, a Chanter into a Knight;
Construct 4 three times (a Chanter into a Knight, a Sprite into a Wisp, an Ember Drake into an Iron Golem). Before the
merge (7b853ed, the same seeds), the lead's kin turned after floor 1 in Drake 4's runs 4 → 8 of 24 (3 → 7 of them
cleared), Construct 4's 11 of 26 → 15 of 28 (4 → 10), Insect 4's 13 of 26 → 14 of 28 (5 → 8), free play's 16 of 29 →
16 of 29 (11 → 11).

Before the merge, against 7b853ed: free play on `div-0…63` 41 → 43 clears (+5 −3, +3.1 ± 4.4 points), progress +0.7 ±
0.6, deaths 9 / 0 / 2 / 12 → 9 / 0 / 0 / 12, the rites 3.3 a run (heal 48%, the free tier 50%, a transmutation 3%),
Mirage 4.4% → 7.0% of battles, the lead's kin turned in 30 → 31 of 55 runs (20 → 20 cleared), its fused kind in 25 of
45 → 30 of 48 (15 → 20); committed on `div-0…31`, Drake 4 20 → 20 clears (−0.1 ± 4.1), Construct 4 13 → 18 (+6.0 ±
3.9), Insect 4 16 → 19 (+5.6 ± 3.8, reached 3 → 8), free play 21 → 23 (+1.0 ± 0.9).

**What it says.** In free play the expert spends its altars as a planner of one build would: the free tier while its
army is whole (floors 1 and 2, the tiers to the Channelers' trines and parts), the heal once the floors wound it, a
transmutation hardly ever, and then toward the Court and the Chanters. Free play neither gains nor loses clears (39 →
39 on the merge, 41 → 43 before it, both within the noise; progress +1.7 ± 1.2 and +0.7 ± 0.6), and its deaths move
from floor 3 to floor 4. Criterion 3: the fused kinds as before (the Chanter's trine in 84% of final armies); Mirage
past 5% of battles on both pairings (3.9% → 7.4%, 4.4% → 7.0%), so three of the eleven synergies at 5% on 64 seeds, two
before: 256 would say whether it holds.

§4.5's measure, as specified, reads little in free play: the leading kin changes after floor 1 in more than half the
runs on both sides alike, the Court's Fae on floor 1 giving way to the Chanters' Undead (21 and 22 runs of 55 turn Fae →
Undead): a succession within one build, not a turn. Where a run is held to a kin the floor does not feed, the
transmutation is what it is for: a fifth to a quarter of Drake 4's and Insect 4's rites, all but one of them toward the
kin (the Chanters and Knights into Pyre Hounds, the Chanters into Hive Wardens and the Sprites into Drones); the kin
leading their armies turns after floor 1 in more of their runs, and more of those clear (before the merge, of them
cleared: Drake 4 3 → 7, Construct 4 4 → 10, Insect 4 5 → 8); Insect 4 is held in 7 runs of 32 against 3; and on the
merge the committed runs gain as much as free play or more, 2.7 to 5.8 points of progress against its 3.8, and 2 to 7
clears of 32 against none. What stays short is reach: Drake 4 is held in 1 run of 32 and Construct 4 in none (a
transmutation keeps the tier, and the floors' Constructs are the tier-1 Clockwork Page and from floor 2 the tier-3 Iron
Golem: no tier-2 soul can become one), and a soul a rite, about three rites a run, cannot gather four of a kin by
themselves; the recruits and the book's weight on these kins (Step 0: Construct, Vanguard and Warden combos valued at
nothing) are still what decide it.

### Relics (Step 4, 2026-10-15)

**Built** (§4.4, in the forms allowed, §7 decision 3 kept: no rule below Legendary; on e6266bb beside Step 5, merged
after it and after Step 2's interface): **five kin banners**, Uncommon run relics, each one mod scoped by `who` to its
kin (`unit.js statsOf` matches it in battle, as the foes' boss mods): the Wyrm Standard every Drake +25% ATK, the Brass
Standard every Construct 10% less damage taken, the Barrow Standard every Undead +20% max HP, the Gossamer Standard
every Fae's skills a turn sooner (`cooldown.rate` +1, the path Hasten's "a turn sooner" is on: every skill rests 2 but
Arise, so a rate of 2 brings each back a turn sooner; no path new), the Hive Standard every Insect +1 Move; unheld,
copies stacking, never the Monarch's or a foe's. **Seven piece relics**: Gravedigger's Spade (Rare, on a kill the slain
of tier 1 rises as yours), Firebrand (Uncommon, on a blow its target Burning), Briar Mail (Uncommon, when struck its
attacker takes 12), Leech Fang (Uncommon, on a blow it heals 10%), Quicksilver (Rare, on a blow its skills a turn
sooner), Rowan Charm (Common, on a wave Barkskin within 2), Raider's Spur (Uncommon, on a kill Hasten). The vocabulary
grew by two parameters, a relic's alone: `raise` with a `tier` lifts the slain where its tier is no higher, as Legion
would raise it (`turns.js risable`: never risen, a shadow, a boss, a Monarch or a fusion's part, while the side has
room; so Legion finds it risen), a trigger's `other` for a raise being the slain lying dead; `damage` with a flat
`amount` deals it true (no ATK, DEF or mod; the rules bend it as they bend a burst). Where this differs from §4.4's
letter: Briar Mail's 12 is true damage. The content test: a run relic names the run's paths, a side-wide cost, or a
kin's or a role's mods, never a unit's path unscoped but the cost; a piece relic's mods are its holder's, unscoped; the
twelve on §4.4's numbers. The codex: a run relic's tip reads a scoped mod as its kin's ("every Drake's ATK ×1.25 →
×1.56"), a cost apart; the relics page lists them by tier as every relic, with the reliquary's glyph. **The expert's
part** (`autoplay.js relicReads`, read by the sketch's `strength` and the book's `bookPower` alike): the run relics'
`who`-scoped mods go on the souls they name through `worth`; a `cooldown.rate` past 1, which `worth` does not read, as
a cooldown a turn sooner each blow; and each trigger a soul holds a share more (`triggerShare`): each effect's worth
where it lands, priced as the battle's own weights pay for it against an HP of damage (`TUNING.expert.battle.option`: a
status its `STATUS_WORTH`, an HP mended, a shadow's max HP; a raise the floor's draws of its tier at the holder's
level, `raiseHp`), on as many as it touches, as often as its moment comes in a battle, over the holder's max HP. The
moments and the touched are measured, not searched (`MOMENTS`, `AROUND`: the expert at e6266bb, seeds `mom-0…5`, 170
battles, 574 fielded pieces: a piece strikes 3.2 times a battle, slays 2.4, is struck and stands 0.8, falls 0.01,
stands through 1.4 waves; with Rally Horn and Hunter's Mark given every fielded soul, 3.4 of yours within 2 of a holder
as it strikes, the Monarch and itself among them, and 1.7 foes within 1 of a slain one). The flat shares stay (worth's
`relic`, the book's `trigger`) but for a banner, read on its kin alone (below: on that share the first measure bought
17 of its 21 banners for armies another kin led). No weight or tree rule moved. The book: the same 135 combos and
gains; the Wyrm Standard pairs first with Drake 4, the Hive Standard with Insect 4, the Gossamer Standard third with
Fae 4, the Barrow and Brass Standards with nothing (the book's `hits` of 1.2 counts toughness against a soul), and the
triggers by their ops (Rally Horn first for Undead, Fae and Construct 4). **A fix**, found by the committed runs:
`policy.js untouchedOrders` gave an order to a Hexed piece a shadow's Purge freed on the copy a turn is read on, and
the battle refused it, the Hex still on it there (`div-25` committed to Fae 4 throws at c403ff1 too: "winter_court 297
cannot use winter_fire on 284"); such a piece's act is now made on the copy as End Turn makes it, after the shadow's,
and takes no order; every other order as before. The tests: 458 → 466 (the twelve's forms; each in battle, the banners'
scoping, the Shop stocking them by tier at its price; the untouched fix), 467 on the interface's merge, all passing
(`--test-concurrency=2`, 251 s; under six workers the turn's milliseconds test ran past its 250 ms, alone it passes);
`outside.test.js`'s clearing run moved to sim-0 (sim-2 falls on floor 4 with the twelve in the Shops).

**Measured** (the expert as Step 0 has it, its forests stale; seeds `div-*`; two to six workers): free play `--commit
none --runs 64` and `--ablations --variants relics,legendaries --runs 64`, on the merge (d02aaed; the untouched fix
after it changes only a turn that would throw, and the interface merge no sim) and on its base c403ff1 (Step 5's merge,
played again: its record's 39 clears and 86.3, seed for seed); the five kins committed, `--commit
undead_4,drake_4,fae_4,insect_4,construct_4 --runs 32`, on 8222da0 and on the base with the untouched fix alone, so as
not to throw; and two arms in free play: the first reading, a banner taking the flat run relic's share (90b2d29), and
the twelve with the readers as they were (`relicReads` reading held mods alone, the flat share for every run relic, the
book remade so).

Free play, `div-0…63`, seed for seed:

| | Step 5 (c403ff1) | Relics |
|---|---|---|
| clears | 39 (61%) | 35 (55%): +2 −6, −6.3 ± 4.4 points |
| progress | 86.3 | 86.0 (−0.4 ± 0.2) |
| died on floor 1 / 2 / 3 / 4 | 9 / 0 / 1 / 15 | 9 / 0 / 1 / 19 |
| relics bought a run; given a soul | 5.2; 2.7 | 5.3; 2.9 |
| of them Command; the banners; the seven | 33%; –; – | 31%; 1.2% (the Gossamer Standard, 4 in 4 runs); 8.6% (29 in 25 runs: Raider's Spur and Firebrand 6, Rowan Charm, Quicksilver and Leech Fang 4, Gravedigger's Spade 3, Briar Mail 2) |
| fused kinds in the final armies | Chanter's trine 84%, Court 77%, Winter Court 33%, Sprite's trine 23% | Chanter's trine 81%, Court 75%, Winter Court 33%, Sprite's trine 20% |
| synergies held (battles) | Echo 60%, Legion 37%, Mirage 7%; none 38% | Echo 60%, Legion 37%, Mirage 6%; none 39% |
| kinds in a tenth of final armies; pieces of the last battles | 8 of 62; Channelers 86% | 8 of 62; Channelers 87% |

The arms, against the same base: the first reading 38 clears (+4 −5, −1.6 ± 4.7; progress −0.4 ± 0.2), its banners 6.0%
of relics (21 in 19 runs, 17 for armies another kin led, five Brass Standards with no Construct held), and against it
the final reading lost three runs in their last room (+0 −3, progress the same); the twelve with the old readers 38 (+2
−3, −1.6 ± 3.5; progress −0.2 ± 0.2), the banners 4.7% and the seven 8.0% of relics, and against it the readers 38 → 35
(+2 −5, −4.7 ± 4.1; progress −0.2 ± 0.1).

The ablations, `div-0…63` (clears; the drop against the full expert, seed for seed, in points ± one standard error):

| | Step 5 (c403ff1) | Relics |
|---|---|---|
| the full expert | 39 | 35 |
| no Common, Uncommon or Rare relic | 22: 26.6 ± 6.0 (progress 1.5 ± 0.5); died on floor 4 15 → 32 | 22: 20.3 ± 6.0 (progress 1.1 ± 0.4); 19 → 32 |
| no Legendary | 40: −1.6 ± 5.2 | 39: −6.3 ± 4.9 |

Without its relics the expert plays the same runs on both sides, seed for seed (it buys none of the twelve, and the
readers read none).

Committed, `div-0…31` (Step 5 → Relics, seed for seed; "reached": runs that held the synergy):

| Archetype | Clears | Progress (paired) | Died on floor 1 / 2 / 3 / 4 | Reached | Relics a run | Its banner; the seven bought |
|---|---|---|---|---|---|---|
| free play | 20 → 18 (+1 −3) | 89.8 → 89.7 (−0.1 ± 0.1) | 3 / 0 / 1 / 8 → 3 / 0 / 1 / 10 | | 5.3 → 5.7 | –; 17 |
| Undead 4 | 12 → 9 (+1 −4) | 80.4 → 81.0 (+0.6 ± 0.7) | 5 / 1 / 2 / 12 → 5 / 1 / 2 / 15 | 72% → 72% | 2.7 → 2.7 | none; 10 |
| Drake 4 | 19 → 18 (+1 −2) | 77.4 → 76.9 (−0.5 ± 0.4) | 8 / 0 / 0 / 5 → 8 / 0 / 0 / 6 | 3% → 3% | 1.6 → 1.8 | none; 7 |
| Fae 4 | 20 → 18 (+2 −4) | 82.5 → 82.6 (+0.1 ± 0.3) | 6 / 0 / 0 / 6 → 6 / 0 / 0 / 8 | 44% → 47% | 4.0 → 4.0 | none; 14 |
| Insect 4 | 15 → 14 (+3 −4) | 85.6 → 85.9 (+0.3 ± 0.4) | 4 / 1 / 0 / 12 → 4 / 1 / 0 / 13 | 22% → 19% | 2.4 → 2.4 | 2 in 2 runs; 5 |
| Construct 4 | 20 → 18 (+0 −2) | 86.9 → 86.2 (−0.6 ± 1.5) | 4 / 0 / 1 / 7 → 4 / 0 / 2 / 8 | 0 → 0 | 3.1 → 3.0 | none; 8 |

**What it says.** Criterion 3's relic line is met, and was before the twelve: the relics ablation is worth 26.6 ± 6.0
points at c403ff1 and 20.3 ± 6.0 after (the audit's 3 at f8c536f, §1). What carries it is the Command relics: without
them the field stays at its base and floor 4, the wall since Step 1's pool and Step 3's raised synergies, takes 32 runs
of 64 against 15. The twelve, as the expert reads them, do not add to it: it buys the seven in two runs of five (8.6%
of its relics, the Command share 33% → 31%) and a banner almost never, and loses 4 clears of 64 (−6.3 ± 4.4 points;
progress −0.4 ± 0.2), all on floor 4, within the noise but the same way in every committed row (1 to 3 clears of 32
each). Of that the readers are −4.7 ± 4.1 against the same content read the old way, the content alone −1.6 ± 3.5:
neither past its noise, both the same way; the readers move few purchases (the seven 8.0% → 8.6% of relics, the banners
4.7% → 1.2%). The banners are a commitment the expert cannot make: committed to a kin it buys its banner in 2 runs of
160, since the sketch reads a banner on the souls of its kin it holds, and Step 3's finding stands (four of a kin
outside the Channelers almost never gathered: Drake 4 held in 1 run of 32, Construct 4 in none); the book pairs three
banners with their kins' combos, by how far along them the run is, and the Barrow and Brass Standards with nothing (its
formula counts toughness against a soul). So §4.4's measure reads the instrument as much as the relics: a player
holding a kin is what a banner is for, and the free and committed expert seldom is one. What would show it: a harness
rule holding a committed run to its kin's recruits (Step 0's open question), or the committed teacher at the top
difficulty (criterion 2's instrument). Criterion 3's other lines unmoved (the Chanter's trine in 81% of final armies,
three synergies at 5%). §4.4's next lever (`rule` on a Rare relic, §7 decision 3) is not needed for the ablation's 10
points; whether the twelve should be retuned is the balance pass's.

### The first bug hunt (Step 6, 2026-10-15)

**Looked at** (on 5c23270, Steps 0–5 merged): what Steps 0–3 and 5 built, read against their own rules, the relics
left to the second hunt. The plan's list, each held by a test or the fuzz below: a trine fused onto a held tile or off
the board, in battle (`turns.js fusible`: the fused footprint free on the fuser's anchor, parts aside, a flyer's in the
air) and in the run (`run.js fuseIn`: on the fuser's camp cell where it fits, else the ossuary); a capstone's part
consumed twice (`partsOf`, `fusible`: each part once, the recipe's counts exactly; a fusion of a piece fused earlier
in the same battle takes it in order); a transmutation's offer (its tier, never its own kind, never a fused one, the
floor's pool, the same on replay) and what it keeps (its uid, relics, level, share of HP, cell where it fits, its old
kind's tiers); every generated kit at every pair of tiers the crosspath allows, against its kind's (the same abilities
in trine form, the same basic blow and heal, summons, tracks of four, HP at least three parts' and ATK at least one's);
no recipe cycle, no result made twice; an in-battle fuse's price (`fuseCost` through the setup) and its parts off the
board; Echo's halves, Mirage once a foe a turn, Last Stand and the Engine of Ages once a unit, Bodyguard's guard a
Vanguard of the target's side; consecrate within the tracks; an altar's rite once, nothing else at it; the draft's
guarantee at every pick; `--scale` on every foe, the boss and the waves; replay with the scale. And a reader at a time
for what Step 2's `summons` changed (a trine calls up the kind it was made of): that is where the bugs were.

**Found and fixed** (each with a test that failed before it):

- **The expert read a trine's summons as trines** (`autoplay.js worth`: the sketch's `strength`, the book's
  `bookPower`, the formation's and the recruits' order). It valued each summon as much again as the soul itself, at
  the root of a summon's share of HP, true while a kind's summons were its own and not since Step 2: a Bone Chanter
  Trine's two Chanters on Marrowcaller II read at 4.75 times their worth, the soul 1.79 times; the Page's, Warden's and
  Dryad's trines alike, a trine of a trine's 1.9 times, the Frost Wyrm's 3.4. Now each summon is a whole one of the kind
  it calls up (`summonedOf`) at the soul's level and tiers; a kind's own as before, number for number. The book remade:
  the same 135 combos, 18 gains lower (the Chanter's trine on Marrowcaller 29th → 60th; the Chanter's trine's trine
  first → third). No weight or rule moved. Free play, `div-0…63`, seed for seed against 5c23270 (its §8 numbers
  played again, the same runs):

  | | Relics (5c23270) | The reader fixed |
  |---|---|---|
  | clears | 35 (55%) | 44 (69%): +11 −2, +14.1 ± 5.4 points |
  | progress | 86.0 | 85.9 (−0.0 ± 0.3) |
  | died on floor 1 / 2 / 3 / 4 | 9 / 0 / 1 / 19 | 9 / 0 / 1 / 10 |
  | battles lost; relics bought a run | 29; 5.3 | 20; 4.0 |
  | fused kinds in the final armies | Chanter's trine 81%, Court 75%, Winter Court 33%, Sprite's trine 20%, Chanter's trine's trine 2% | Court 84%, Chanter's trine 72%, Winter Court 42%, Sprite's trine 25%, Chanter's trine's trine 11% |
  | synergies held (battles) | Echo 60%, Legion 37%, Mirage 6%; none 39% | Echo 49%, Legion 31%, Mirage 8%; none 49% |

  The expert ends 48 runs holding a Chanter's trine or its trine against 53, and its floor-4 deaths halve; 11 runs of
  the 64 are the same (the book moves the rest). Criterion 3 as it was (the Court 84%). Every number of §8 from Step 2
  on was measured with the misreading; the loop of Step 6 starts from this one.
- **The threat meter read them so too** (`codex.js power`, the interface's): a Bone Chanter Trine alone on
  Marrowcaller II counted 563 where it is 304, its rooms read easier than they are. Fixed alike.
- **Clean**: How to play's wounds line now says an altar's heal is one rite of three; `turns.js rateOf`'s example of a
  Hasten in its last turn is Ambush's second (its Hasten is two turns since Step 3). Nothing else found dead, doubled
  or lying in what these steps added.

**Seen and left** (no rule broken; the balance pass's or the interface's): Echo's halved status turns never show: the
second landing meets the status the first laid, and a status laid again lasts the longer (`addStatus`), so at half or
whole an echo adds a stack (Burning, Brittle, Bleeding) and nothing to a status of one stack; only the damage and the
healing are halved. Mirage foils a landing, as it did a battle at a time: a blast's first, and an Echo's second landing
lands. `fuseIn` places a fused piece before the battle's fallen leave the field, so a cell of one fallen in that battle
sends it to the ossuary (the player places it). The capstones' rules emit their events, but the battle scene flares
the synergies' alone.

**The fuzz** (a script outside the repo; the run's own fuzz in `run.test.js` now checks the board after every order
too): 2,227 runs, 1.1 million actions of which 0.91 million battle orders, 23,771 fights; from the draft (the guarantee
checked at every pick) at scales 1, 0.6, 1.5 and 2, and from set-ups outside the log (each recipe's parts and two more
of its first, with the Command and the essence to make them; four to eight of each synergy's kin or role, Legendaries
among their relics; the kinds bought five tiers up); a fifth of the actions a random legal one, the rest a steady hand
that brings a recipe's parts beside one another in battle and fuses: 4,784 fusions out of battle and 278 in it (163 of
a 2×2 piece), 820 transmutations, 823 consecrations, and in the last 722 runs 80,355 blows Mirage foiled and 1,175 Last
Stands. After every action the run's invariants (no two pieces on a cell, each on open ground, HP within bounds, the
roster and the field within their caps, relics at most `perPiece` a soul and no more than owned, every soul at its
kind's level and tiers, no fused kind offered or met as a foe, an altar's offers as above) and in battle the board's
(each layer's index the living alone, each on its whole footprint, no wall under a ground piece, a fusion's parts off
it; a stand once a unit, a foil once a foe a turn, a guard a Vanguard); each run replayed, or rebuilt from its set-up
and log, to the same state. The harness: basic on 300 seeds,
the expert committed to every archetype on 3 (168 runs, `--builds --commit all`), 28 expert runs replayed at scales
0.7 and 1.3, the calculator on 16, the outside teacher on 2: no throw, every replay the same.

### The ascension ladder (Step 7, 2026-10-15)

**Built** (§4.6, the sim and the interface; on 5c23270, merged with the first bug hunt at cddeab4): `TUNING.ascension`,
a row a level, 0 to 10, each the multipliers of its level over the base game: `foeHp` and `foeAtk` (every foe's, the
boss's, its court's and the foes' shadows' with them: `foeMods` by `run.js foeScale`), `fight` and `elite` (a
formation's count, rounded: `roomSize`; a siege's and the Sovereign's waves are fight-sized, the cohorts and the late
pair as they were), `every` (the turns between waves, rounded, at least 1: `waveEvery`, carried in a battle's setup
where it moves, read by `turns.js entryTurn` and the schedule), `monarchHp` (its base, rounded, its HP relics on top:
`monarchBase`), `price` (a tier, a recruit, a fusion, a relic; an elite's bounty is pay and stays). Level 0 every one 1;
the top row foe HP ×1.4, ATK ×1.2, fights and elites ×1.2 (fights of 3 / 4 / 5 / 5 foes on floors 1–4 → 4 / 5 / 6 / 6,
elites of 2 / 5 / 6 / 6 → 2 / 6 / 7 / 7), waves ×0.75 (every 4 turns → 3), the Monarch ×0.85 (250 → 213 HP), prices
×1.2; the rows between on the straight line to it (`tuning.js ladder`: 1 + (top − 1) × k / 10). **Every row is a
placeholder until the balance pass** (§9): level 0 to be tuned on the expert at ~90%, the top on the teacher at ~60%. No
number of the base game moved.

A run's level is its own from its first floor: `createRun({ ascension })`, `replay(seed, log, { ascension })`, a field
on the state above 0 (none at 0); a run is its seed, its level and its log, and a record of one names its level where it
is not 0 (autoplay.js `record`, calc.js `calcRun`, the outside teacher's settings). Step 0's `scale` stays, the
harness's override on top of the level (`foeScale` multiplies both; `--scale` as before). Every reader that makes or
replays a run passes it: autoplay.js (`ablatedRun`, `record`, `--builds --ascension`, any report's `--ascension
<level>`), outside.js (`--ascension`, the paired expert's run too), teach.js (every mode's `--ascension`, into its
settings where not 0), calc.js (`calcRun`, `--ascension`); the forests' label sets stay the base game's, as the refit
is. The expert reads the level's foes in its scouting (`scoutRoom`, `scoutAt`, `roomRead`) as it read `scale`, and the
level's waves in battle through the battle's own schedule; its route still reads a purse in the base's tier prices
(`tierScale`), frozen as it is. The unlock rule (`openTo`, `clearAt`): a level opens with a clear of the one below it,
level 0 always open, never past the top.

**The ladder report** (`npm run ladder -- [--ascension 0|a,b,…|all] [--teacher] [--runs 8]`): the rungs basic, the
calculator (a worker's job, `ladderRecord`: `calcRun` with its plain readers set for its run and put back), the expert
and with `--teacher` the outside teacher, on the same seeds at each level: clears, deaths by floor, progress, battles a
run, and against the rung below seed for seed the clears won and lost and the progress's difference ± one standard
error; then whether each level keeps the order (each rung's progress above the one below's). At one level the old detail
tables follow, the record players'.

**The interface**: on the title screen, − the level + in the actions' row (`ui.js ascensionChooser`, a function of its
own), never above the highest open, and a line under it naming what the level moves ("foes +40% HP, +20% ATK · more foes
· waves every 3 turns · the Monarch 213 HP · prices +20%" at 10) and, at the highest open, that its clear opens the
next; each number in full in its tip. Kept in the URL (`?ascension=`, written back as it steps; a link asking past this
browser's unlocks is held to them) and in prefs (`ascension`, the chosen; `ascended`, the highest cleared). The top bar:
"Floor 1 · A3" above 0, the level's line in the floor's tip. The end screen of a clear: "Ascension N is open. Choose it
on the title screen." (once a run), and the level beside the seed. Played in Chromium at 1440×900, 1024×768 and 852×393
(a link asking 7 with 2 cleared, the steps either way and past the open, a run begun at its level, the top bar and its
tip, a clear's end screen and the title after it, the level opened then chosen): no console error. At 852×393 the
actions keep one line (a short frame's title box a little wider, its sigil smaller).

**The check**: level 0 is the base game byte for byte. The expert's runs of `asc0-0…2` and `div-3`, basic's of
`asc0-0…1` (each log, end state and record, each log replayed to the same state), the outside teacher's run of `sim-10`
and the calculator's of `asc0-0…1`: 15 files, the same sha256 before and after, on 5c23270 and again on the merge
against cddeab4 (where the bug hunt's reader had changed four of them). **Tests**: `test/ascension.test.js`, 11 (the
rows; level 0 the base game; a level reaching the formation, the boss, a wave come in and a foe's shadow; the counts and
the waves' turns; the Monarch in the run and in battle; the prices at three levels; replay at a level; the unlock rule;
the ladder's levels, jobs, table and lines; a calculator's run at a level, its readers put back), and one in
`codex.test.js` (every level's words, a room's at the top): 469 → 481 on the merge, all passing (`--test-concurrency=2`,
293 s).

**Measured** (the expert as Step 0 has it with the bug hunt's reader, its forests stale; seeds `asc-*`, the draft on;
two workers beside two other sessions): `npm run ladder -- --ascension 0,1,2,3,5,10 --runs 32 --workers 2` on the merge
(576 runs, 12 min), and the teacher at the top, `--ascension 10 --teacher --runs 16` (64 runs, 1 min). Clears; deaths on
floor 1 / 2 / 3 / 4; progress in points; the gap to the rung below in points of progress, seed for seed, ± one standard
error:

| Level | basic | the calculator | the expert | basic → calculator | calculator → expert |
|---|---|---|---|---|---|
| 0 | 0; 32 / 0 / 0 / 0; 2.1 | 0; 28 / 2 / 2 / 0; 14.3 | **21 (66%)**; 4 / 0 / 0 / 7; 88.5 | +12.2 ± 2.9 | +74.2 ± 5.7 (+21 −0) |
| 1 | 0; 32 / 0 / 0 / 0; 1.9 | 0; 28 / 3 / 0 / 1; 15.3 | 19 (59%); 7 / 0 / 0 / 6; 79.4 | +13.4 ± 3.1 | +64.0 ± 6.7 (+19 −0) |
| 2 | 0; 32 / 0 / 0 / 0; 1.8 | 0; 29 / 2 / 1 / 0; 12.1 | 14 (44%); 11 / 0 / 1 / 6; 67.1 | +10.3 ± 2.1 | +55.0 ± 7.2 (+14 −0) |
| 3 | 0; 32 / 0 / 0 / 0; 1.8 | 0; 28 / 3 / 1 / 0; 11.8 | 12 (38%); 13 / 0 / 1 / 6; 61.2 | +9.9 ± 2.3 | +49.4 ± 7.7 (+12 −0) |
| 5 | 0; 32 / 0 / 0 / 0; 1.6 | 0; 29 / 2 / 1 / 0; 12.4 | 5 (16%); 23 / 0 / 2 / 2; 32.0 | +10.8 ± 2.6 | +19.6 ± 7.4 (+5 −0) |
| 10 | 0; 32 / 0 / 0 / 0; 0.6 | 0; 32 / 0 / 0 / 0; 3.9 | 0; 32 / 0 / 0 / 0; 2.1 | +3.3 ± 0.6 | −1.8 ± 0.7 |

The top, `asc-0…15`: basic 0.6, the calculator 3.2, the expert 2.1, the outside teacher 3.0 (+0.8 ± 0.3 over the
expert), every run of every rung dead on floor 1, in its first or second battle; the Monarch's killers by threat, the
expert's and the teacher's, Reach 6 and 6, Drain 5 and 3, Burn 3 and 4. Before the merge (5c23270, the reader misreading
trines' summons), the same seeds: the expert 63%, 41%, 38%, 34%, 13% and 0% at 0, 1, 2, 3, 5 and 10, the order kept but
at 10, and the teacher 1 of 8 at the top.

**What it says.** The placeholders do what a ladder's rows must, and too steeply at the top. Each level is harder for
the expert than the one below (66% → 59% → 44% → 38% → 16% → 0%; progress 88.5 → 2.1), its deaths moving to floor 1 (4
at 0, 13 at 3, 23 at 5, all 32 at 10): "floor 1 is hard at the top of the ladder" (§9) holds, at 10 harder than anyone
survives. Basic dies on floor 1 at every level, as at the base, and the calculator reaches floor 2 in 3 or 4 runs of 32
at 0 to 5 and in none at 10 (criterion 4 and §4.6 would have the novice reach it about half the time at 0: unmet, and
further off up the ladder). The ladder keeps its order and its gaps at 0 to 5, the expert's above the calculator's
narrowing from 74 points to 20 as its clears fall; at 10 it breaks: every rung dies in its first battles, and there the
calculator's battles, which never walk into reach, last a turn or two longer than the expert's and read as more progress
(3.9 against 2.1), and the teacher, whose battles are the expert's, gains nothing (0 of 16). So the top row as placed is
past what any rung can play; the balance pass pulls it in. Where the teacher's ~60% (criterion 4) falls is unmeasured
below the top (it was played at 10 alone); the expert's own clears fall from 66% to 16% by level 5, and at level 0 the
expert's 66% on these seeds is short of its ~90%. Those are the balance pass's numbers (§6, Step 6), with the refit
first: these rows are placeholders, as every number here.

### The skill curve (Step 8, 2026-10-15)

**Built** (§4.8 but its meta; on cddeab4 beside Step 7, merged after it at 65e5503):

- **A run saved** (`src/sim/save.js`): a save is the run's createRun options (whatever createRun takes: the seed, a
  level of the ladder, `scale`…) and its log, `{ v, run, log, at }` as JSON, with `at` where it stood (`placeOf`: the
  floor, the room's rank, the phase, the battle's turn, the purse, the Monarch's HP, the actions taken). main.js saves
  after every action, a battle's orders among them (prefs `save`, ~55 KB at a run's end), and drops the save of a run
  cleared or lost; the tutorial is never saved. `restore` plays the log again (`replay`, which now passes every option
  it is given) and checks it ends where `at` says: a save another version made, or whose log no longer plays the same
  (an illegal action, another place), is set aside with a note on the title, never thrown. The title's Continue (its
  primary button, Enter) stands in the tagline's place with where the run waits ("Floor 2, room 6 of 15 · in battle,
  turn 3"); a new run over a saved one asks first. Resumed mid-battle, the battle is the replayed one, order by order;
  the scene is built from its start and every order since played again at once (Skip's flush), unheard and as reduced
  motion plays it, behind a dark camera that fades in once caught up. A full run's log (1,398 actions) restores in
  ~0.7 s in Node.
- **Foe reach on tap** (`policy.js threatOf`, exported for the board): the tiles a foe could stand on next turn (its road
  ahead within its Move, as the board stands: `spotsOf`, the danger map's own, which `danger` now reads too) and every
  tile a blow of its kit could strike from any of them (the danger map's reach and dilation; `air` apart: a melee blow
  from the ground never reaches a flyer). What it could strike, never what it will: every blow whether it rests or not
  (a foe's rests are never shown), no line of fire (your pieces may move first), nothing of its prey, its patience or
  its path; a foe whose next act a Hex takes strikes nothing (its Hex is on its card). The battle scene draws it for a
  foe of a kind met (the bestiary) when tapped (`engine.js study`, `drawStudy`): the struck tiles filled, hatched and
  edged in the foes' red, the road dotted from it to a dashed ring on the farthest tile, apart in look from a selected
  piece's box and dashes; the next tap anywhere, the same foe again, or End Turn clears it; a kind not met shows its card
  alone, as before. The test holds it, foe by foe, to the danger map with its lines aside.
- **The tutorial** (`run.js tutorialRun`, `content.js TUTORIAL`): one room before floor 1, the threshold, a real run
  state under the game's rules (seed `threshold`, its floor-1 camp): the draft fixed (the old trio: a Tomb Knight, a Bone
  Chanter, a Frost Sprite), one fight of two Clockwork Pages and a Will-o'-Wisp at floor 1's first level; won, its spoils
  end it (phase `over`, no result) and the title says so; lost, the same, saying so. Three screens of text, once each at
  their moment (the camp, as the battle opens, the spoils), in the game's voice. The tutorial's foes are met as its
  battle opens, so its second screen can say to tap one. End Turn alone wins it in 8 turns, the expert in 7, random
  orders 38 times in 40 (Ghouls in place of the Pages: End Turn alone lost it). Offered on the title always (the
  Tutorial button, where How to play stood: the corner's ? and H open that still), and once, over the title, on a first
  visit ("New here?").
- **Run length**: `TUNING.run.floors` 4 → 3 (below). Nothing else moved: the per-floor lists keep their floor-by-floor
  meaning (their fourth entries are the deep's first floor's now: the deep reads their last entries, as its counts
  did), and floor 4's three camps are drawn by no floor (the deep reuses floor 3's). How to play's Basics names the
  floors and rooms, the save and the foe's reach; the README's Playing too.

**Measured** (the expert of cddeab4, its forests and route as Step 6 left them, the draft on; level 0, byte for byte
Step 7's; seeds `div-0…63`, `npm run builds -- --commit none --runs 64 --workers 2` on cddeab4 and on copies of it with
each change; an order is a battle order, a move, an act, an End Turn, a fusion, as the audit's 1,188 counted them):

| | Today (16 ranks, 4 floors) | RANKS 12 | Three floors | Both |
|---|---|---|---|---|
| battle orders a clear (a run) | 1,274 (1,126) | 1,084 (910) | **949** (830) | 819 (692) |
| every action a clear | 1,626 | 1,335 | 1,206 | 1,008 |
| battles a clear; turns a battle | 49.9; 5.9 | 35.9; 7.1 | 37.2; 5.9 | 27.1; 7.1 |
| clears (paired against today) | 44 (69%) | 34 (53%): +8 −18, −15.6 ± 7.7 | **50 (78%)**: +10 −4, +9.4 ± 5.7 | 36 (56%): +10 −18, −12.5 ± 8.1 |
| died on floor 1 / 2 / 3 / 4 | 9 / 0 / 1 / 10 | 12 / 0 / 1 / 17 | 9 / 0 / 5 / – | 12 / 0 / 16 / – |
| s a run | 10.2 | 6.8 | 6.7 | 4.8 |

RANKS 12 scaled with it what reads rank, by 11/15 (an elite from rank 4 → 3, a siege from 9 → 7, a floor's Shops at
most 7 → 5, a fight's waves from rank 8 → 6, a room's threat variety from rank 3 → 2); the map's weights are shares and
stayed. Today's run reproduces Step 6's measure (44 clears, progress 85.9). **Neither change alone reaches ~600**, nor
both (819). Three floors is the nearer (949 against 1,084), moves one number, keeps the floor's shape the expert's
learned route and forests read (RANKS 12 makes them stale), and loses nothing the expert gains from: its battles stay 5.9
turns, where on twelve ranks the army grows less a floor and its battles lengthen to 7.1, which is why twelve ranks save
so few orders. So the run is three floors: −26% of the orders a clear (five seconds an order, §1's rate: 106 → 79
minutes of battle; with every action, 136 → 100). Stacking twelve ranks on it was not done, as the plan asked; it
would be another −14% of the orders at −22 points of clears against three floors alone (36 against 50). The expert at
the new length clears **50 of 64 (78%)**, its deaths 9 on floor 1 as before and 5 on floor 3, the Sovereign's (were 1 on
floor 3 and 10 on floor 4): the end is easier, the Sovereign's floor drawing floor 3's foes (×1.12 HP and ATK, not floor 4's
×1.52 and ×1.45).
§9's "floor 1 is hard" stands, the balance pass reads the end.

**The browser** (Chromium at 1440×900, 1024×768 and 852×393, `npm start`, by a script outside the repo): a first visit
offered the tutorial, played through its three screens to the title (the expert's orders given through the scene, as
taps give them); a met foe's reach drawn on tap and gone at a tap elsewhere, a kind not met showing its card alone; a
run begun, saved mid-battle in turn 2 with orders given in it, the page reloaded, Continue, and the battle the same, the
sim's units (tile, HP, moved, acted, statuses) and the scene's (tile, HP, place on the screen) alike, then played on; a
new run over the save asking first, and kept; a save given an illegal action set aside with its note; How to play's
Basics; the title in its three states (a first visit, a save, neither), every control on the screen. No console error.

**Tests**: `test/save.test.js` (5: a run saved mid-battle restored as it stood, the battle's units order by order, and
played on the same; a save at ascension 2 and at a scale back with them, and without them set aside; the save's shape;
every way a save is set aside; replay's options) and the foe's reach against the danger map in `policy.test.js`; the
tests that pinned four floors read `TUNING.run.floors` (builds' and the ladder's deaths by floor, the last floor's siege,
boss and multipliers, the deep's multipliers from the lists' last entries, a route's rooms by `routeRooms`), and the
outside teacher's clearing line late on the last floor is sim-1's (sim-0 falls on floor 3). 481 on Step 7's merge →
487, all passing (`--test-concurrency=2`, 212 s).

### The second bug hunt (Step 6, 2026-10-15)

**Looked at** (on 65e5503, Steps 0–5 and 7 merged with the first hunt; Step 8 merged into it at 710a50a and its code
looked at too): what the first hunt left, read against the rules' own words, each item held by a test, the fuzz or a
sweep below. Relics (Step 4): the five banners' `who` (stacking; a transmuted or fused soul's new kin; your shadows and
summons of the kin; never a foe, a foe's shadow of a kind of it, or the Monarch), the seven's moments (kill, blow,
struck, wave), the Spade's tiered `raise` against Legion and Arise on one corpse, `to: 'other'` as the slain, Briar
Mail's flat true damage (no loop: no foe holds a relic; once on a counter), Echo and the triggers (its second landing is
a second 'struck', never a second 'blow'), Quicksilver at 0, Rowan Charm alone, `hold`/`unhold`, a holder transmuted
(its relic kept, §4.5) or fused away (back unheld), the Shop's tiers and prices, the expert's readers (`relicReads`,
`triggerShare`, `MOMENTS`, `AROUND`, `raiseHp`) and `untouchedOrders`' Hexed fix. The ascension (Step 7): every foe at
its level (the boss, its court, the waves, the foes' shadows; foes have no summons), counts and spacing (never 0), the
Monarch's HP in the run and in battle with its relics on top, every price (a consecration is free; a release pays back a
share of the level's recruit price; an elite's bounty is pay), replay and `--scale` on a level, the unlock rule (a
corrupted pref reads as none: main.js's parse; `openTo` itself is never handed one), the URL before prefs, records. The
first hunt's "seen and left". Step 8: the save (`saveOf`, `restore`, Continue), `threatOf`/`spotsOf`, the tutorial, three
floors (every per-floor list read through `at`'s clamp, the deep from their fourth entries, floor 3's camps and pool).

**Found and fixed** (each with a test that failed before it):

- **A fusion made in battle went to the ossuary for a cell a fallen piece held** (`run.js fuseIn`, the first hunt's
  "seen and left"): closeBattle placed the fused piece on its fuser's cell before finishBattle sent the battle's fallen
  to the ossuary, so a footprint meeting one of their cells failed to fit, against DESIGN §2.2 (a fallen piece leaves
  the field as the battle ends, its cell free) and fuseIn's own rule. It counts the cells of the souls standing as the
  battle ended now. The expert's play: unchanged, its free play on `div-0…63` at 65e5503 and with the fix every run's
  whole log the same (sha256; 44 clears, 32 fusions in battle), and again on Step 8's three floors, 710a50a against
  this hunt's merge with it (50 clears, 24 fusions in battle).
- **Every report but three dropped `--ascension`** (autoplay.js's CLI): the report, `--builds` and `--ladder` played at
  the level, `--paired`, `--ablations`, `--decisions`, `--necessity` and `--audit` at 0 under a header that named none
  (`--ablations --ascension 5` measured the base game). Each carries the level into its jobs and names it now.
- **The reports' deaths by floor kept four floors after Step 8's three**: the ladder's and `--builds`' headers read
  "died fl 1/2/3/4" over three columns; the ladder's one-level table and `--ablations` printed a fourth, always 0; the
  title's level line told a level's fights and elites "on floors 1–4", the fourth the deep's (`codex.js ascensionText`).
  Each reads `TUNING.run.floors`.
- **The capstones' rules had no flare** (an interface gap, the first hunt's "seen and left"): rules.js emits a 'rule'
  event for the Charnel Cathedral's rise, the Cinder Wyrm's spreading fire, the Hive Mind's hatching and the Engine of
  Ages' stand, and the battle scene flared the synergies' alone. `codex.js ruleFlares` names every rule at work, a
  capstone's by its kind ("Capstone · Hive Mind", rising over the piece); seen in Chromium, a Hive Mind's drones hatching
  as its battle opens.
- **How to play's Wave told the base game's spacing at a level** (`codex.js` WORD_MORE, Step 7's): "4 turns after the
  one before" where the level brings them every 3, the one place left reading `TUNING.spawn.waves.every` alone; at a
  level that moves it, it adds "At ascension 10 they come 3 turns apart."
- **Clean**: worth's flat relic share said a trigger's worth no static read can tell (relicReads reads it since Step
  4); drawRoom's waves came at `TUNING.spawn.waves.every`, battleSetup's and createBattle's side mods were "side-wide
  costs" and "the floor's growth" alone, codex.js partyMods the same: each says the level's spacing, a kin banner's mods
  and the level's now. Nothing else found dead or lying in what Steps 4, 7 and 8 added.

**Seen and left** (no rule broken, or not this hunt's to move):

- **Echo's halved status turns.** The rule's text: every ability "echoes, landing on its targets once more at half its
  effect (half its damage and healing, a status for half its turns)". The code lays the echoed status for half its turns
  (rules.js `scaled`, rounded up), as the text says; but the second landing meets the status the first laid, and a status
  laid again keeps the longer turns and gains a stack (`addStatus`), so the half never shows: at half or whole an echoed
  status adds a stack (Burning, Brittle, Bleeding) lasting the first's turns, and nothing to a status of one stack. Text
  and code agree on the landing; what the half is worth is the balance pass's (Echo's halves are among its numbers, §6).
- **The untouched on the copy** (`policy.js untouchedOrders`): the copy a turn is read on has the shadows and summons act
  in acting order between the pieces' orders, where the battle has the orders given first and the shadows act at End
  Turn. Read for every way an order could then be refused (a target a shadow's act made, a heal's condition): none with
  the content as it is (a death burst lays Withered, never damage; an ally ability takes any ally in range, and no kind's
basic blow or heal at any tiers has a `when`), so
  the Hexed fix of Step 4 is the one that was needed.
- **The book's floors** (`autoplay.js BOOK_FLOORS`): four armies, its combos' gains read over four floors, the fourth now
  the deep's first; the book is the frozen expert's formula, remade, not reshaped, until the refit.
- **A save from Step 8's build before the fuseIn fix** whose log placed a piece fused in battle back on its fuser's cell
  replays to a refused 'place' and is set aside, as save.js means an older game's save to be; no build was shipped.

**The fuzz** (a script outside the repo, the first hunt's extended): 3,000 runs, 1.03 million actions of which 0.81
million battle orders, 20,279 fights, every run at an ascension level 0–10 drawn by its seed (250 to 310 runs a level), from
the draft at scales 1, 0.6, 1.5 and 2 and from set-ups outside the log as the first hunt's, and one more: relics owned and
held at random, the twelve among them, banners stacked (a third of the runs); the steady hand buys in Shops (each of the
twelve bought 13 to 78 times a batch) and gives relics. The relics fired: Briar Mail 17,039 times, Quicksilver 17,130,
Leech Fang 16,904, Firebrand 13,524, Rowan Charm 6,464, Gravedigger's Spade 4,978 (1,798 raises), Raider's Spur 1,932;
1,125 to 1,521 fusions out of battle a batch and 164 in it. After every action the first hunt's invariants and, new:
each event's holder one of yours holding the relic it fired, no foe holding one, a relic's raise a slain foe of its tier
at most, no corpse risen twice, every cooldown, damage and heal whole and never below 0, no foe's or Monarch's mods
holding a banner, the Monarch's max HP its level's in the run and in battle, the battle's wave spacing the run's, every
price whole and above 0; each run replayed at its level, or rebuilt. The last 900 on Step 8's merge with 1,710 save round
trips (the save made and restored at the first of each phase and at random: 309 in the draft, 305 on the map, 306 in
prep, 583 mid-battle, 124 on the spoils, 55 at a Shop, 28 at an altar), the state and the battle the same each time.

**The sweeps**: the ladder at levels 0, 3, 7 and 10 on `h2l-0…39` (480 runs of basic, the calculator and the expert, 13
min on two workers, before Step 8's merge): no throw, the order kept at every level (the expert 70%, 43%, 15% and 3%; the
calculator never a clear); the expert's relic readers on 1,500 random retinues (any floor and level, every relic owned
and held at random, the fallen and the wounded among them): every read finite, no throw, the out-of-battle picks made;
36 expert runs played to their clear and on into the deep (`h2d-0…23` at level 0, `h2e-0…11` at 2, after the merge), 18
cleared and went on, 11 through three deep floors and 7 falling in them: every floor's camp its own list's (the deep's
floor 3's), its rooms' foes on their slots at their levels, the save restored as it stood at every new floor (142), every
run replayed the same; the tutorial won by basic and by the expert, its log replayed the same; and in Chromium (1440×900), a
run Continued from a save mid-battle in turn 2 at ascension 2, at an altar, at a Shop at 1, mid-draft, on the spoils at
3 and on the map: the state and the place the same, the screen its own, no console error.

**Tests**: 487 on Step 8 → 491 (the fused piece on its fuser's cell past a fallen one; a report at a level, --paired's
runs and an audit's; the flares of every rule at work; the twelve at their edges; and in the tests that were, How to
play's Wave at a level and the reports' and the level line's floors), all passing (`--test-concurrency=2`, 272 s).

### The product (Step 9, 2026-10-15)

**Built** (§4.8's meta but the Monarch variants, which wait on `src/content.js`; and a store build; on 710a50a, merged
with the second bug hunt at 4c3e86e; §4.7's bosses and the outside players are not this step's part):

- **The run history** (`src/sim/history.js`, pure; main.js keeps it in prefs `history`): every run that ends is a line,
  cleared (the Sovereign slain and the run stopped there), fallen (on the way down, or in the deep after a clear) or
  left (ended under way for a new run: the save is played back to read it), never the tutorial: when, its seed and level,
  its daily, the floor and room it ended in, the battles won of those fought, the kinds it ended holding most (three, a
  higher tier first among equals), its fused kinds and the kin most held, what felled the Monarch (the kind and its
  threat) and its play time. The play time is the time between the run's actions, a gap counted at most two minutes and
  a hidden page's not at all, kept with the save (`save.js`'s new `meta`: when it began, the time, its daily; a save
  without one restores as before). A run is one line by its id (its seed and when it began): a clear that descends and
  later falls is brought up to date, not added. The book keeps the last 100 newest first beside running totals of every
  run (runs, clears, the best level cleared, the time); a book that does not read (bad JSON, a line of the wrong shape,
  totals that count fewer than the lines) is read as far as it holds, its totals counted again, never thrown. The
  History screen (`ui.js historyScreen`), from the title's History button, is laid out as the end screen: the totals and
  Back (Escape) on the left, the runs behind three tabs on the right (every run, the clears, the dailies), a line a run
  with its army's portraits and its killer's.
- **The daily**: the title's Daily button plays `daily-YYYY-MM-DD`, the UTC day's seed, the same run for everyone: at
  **ascension 0 whatever level is chosen** (one run to compare, the first-time player's too). **The first begun each UTC
  day is the daily** (prefs `daily`, the last day begun, set as it begins: leaving it and beginning again does not
  reset it); **later attempts the same day are allowed, as practice**, kept and marked so in the History. The button
  says "practice" once the day's is begun, its tip the day's result.
- **Music** (`src/music.js`): five loops of eight bars, synthesised as the effects are (no files): the title (D minor, a
  music box), floor 1 (D minor), floor 2 (A phrygian), floor 3 (D phrygian), the deep (D harmonic minor), each a slow
  pad, a bass and a few bells; in battle a heartbeat drum and a plucked ostinato come in (at once, mid-bar). A new loop
  crossfades in over 2.5 s (title, floor, deep, the end screen's the title's); map and battle are the same loop, the
  battle layer faded in and out. Notes are scheduled a bar ahead on the audio clock by a 250 ms timer that runs only
  while music sounds; nothing runs a frame. It sounds only with sound on (the speaker: `sfx.muted`) and the music on (the
  note button beside it, prefs `music`), never before the first gesture (sfx makes the context then; `sfx.audio`,
  `sfx.listen` share it), and stops while the page is hidden. How to play's Basics ends with the sound's settings: the
  effects and the music on or off, the music's volume (prefs `music:volume`). Rendered offline at the first visit's
  volume, through a limiter as the effects': peaks −16 to −22 dBFS, −32.5 dBFS RMS over a loop, under the effects.
- **The store build** (`build.js`, `npm run build`, `dist/` ignored): index.html, its stylesheets and their `url()`s,
  the font, the manifest and its icons, every module `src/main.js` reaches by its static imports, and `src/assets/` whole
  (a unit's pictures are named at run time): **122 files, 3.4 MB** (26 modules 2.5 MB, Phaser 1.3 MB of them; the art and
  the font 0.75 MB; the stylesheets 0.15 MB). Never the offline tools (`teach.js`, `outside.js`, `fit.js`,
  `outforest.js`, `calc.js`, `bundle.js`, `autoplay.js`), `expert.json` or `combos.json`; a game module reaching one fails
  the build. `forest.js` ships, its fitting with it: `policy.js` imports its model reader statically (in a browser it
  reads no forest; splitting the module was not this step's). The build's hash (sha256 of every file shipped) marks
  `dist/index.html` and names the service worker's cache: `dist/sw.js` caches every file on install and serves them
  first; a page is asked of the network first, and one with no build's mark (the source tree served on the same origin)
  retires the worker and its cache; a new build's worker takes over once no page of the old one is open. main.js
  registers it on a build's page alone (http or https), and on the source tree lets go of any a build left: `npm start`
  runs none. `node serve.js 5174 dist` serves the build.
- **The title**: the actions in one row (a run, the Daily, the Tutorial, the History), the ascension and the seed in a
  quieter row under it; to stand in one view the four steps go to one row of four on a short or 1100–1280-wide frame,
  and the sigil shrinks on a tall 4:3 one. The note button stands beside the speaker on every screen.

**The browser** (Chromium at 1440×900, 1024×768 and 852×393, by scripts outside the repo; screenshots `s9-*` in the
session's scratchpad): the title in its states (a save and none, the daily begun) with every control on the screen; a
corrupt book opening an empty History; a saved run Continued and played by End Turn to its fall, its line kept with its
play time carried from the save; the History from the title (its tabs, its lines); the daily begun at ascension 0 with
2 chosen, left for a second attempt (asking first), that one practice, both kept; the music: nothing before a gesture
(no context, no timer), the title's loop after one, the note button and the speaker stopping it and the timer with it,
the page hidden and seen again, the draft's crossfade to floor 1, a battle's layer, the volume slider, the bars with the
note on the screen; `dist/` served, its worker active and the page controlled, a run begun and a battle entered, the
server stopped and the page reloaded from the cache, the saved battle Continued offline, then the source tree served on
the same origin and the worker and its cache gone. No console error.

**Tests**: `test/history.test.js` (6: the daily's UTC day, a run's line, its army, the book's cap and totals and a run
kept again, a corrupt book, the save's meta) and `test/build.test.js` (4: every module the game imports, read by a second
pattern and closed; every stylesheet, `url()`, icon and unit picture; never the offline tools, tests, press/ or docs, a
game module reaching one refused; dist's page marked, its worker listing exactly what ships, the hash stable). 491 on the
second hunt → 501, all passing (`--test-concurrency=2`, 254 s).

**The Monarch variants** (after the floors' bosses, on 094e111; `src/content.js` `MONARCH_LIST`): four records, the base
Monarch and three, each of these a kin the floors feed least, its banner (Step 4's) held from the start as if bought, and
that kin's kinds weighted ×3 in its draft's offers (`TUNING.monarchs.bias`, a new number: each kin has one kind in the
floor-1 pool, offered in 71% of a pick's draws at ×3, 58% at ×2, 38% evenly): **the Brass Monarch** (Constructs, the
Brass Standard), opened by the first clear; **the Ember Monarch** (Drakes, the Wyrm Standard), by a clear at ascension 2
or above; **the Hive Monarch** (Insects, the Hive Standard), at 4 or above. The unlock reads the ladder's own record (prefs
`ascended`, the highest level cleared: `run.js monarchsOpen`, `monarchsAt`), so no new pref keeps it; a clear's end screen
names what it opened. A run's Monarch is a createRun option (`monarch`, the base's by default: a run as it has no field and
draws its draft as before, `draftOffer`'s weighted draw taken only with a bias), carried by `replay`, the save (its
options), the history (a line's `monarch`) and every report of the harness (`--monarch <id>`: `autoplay.js` jobs, a
record's `variant`, `calc.js calcRun`). The title's second row leads with a crowned button naming the Monarch chosen
(`ui.js monarchChooser`), which puts up the four as cards (`monarchPicker`: each's line, relic and bias, the locked with
the clear that opens them); kept in prefs `monarch` and the URL (`?monarch=`), held to those open. The daily is played as
the base Monarch. The save's version is 2 since the bosses: a save from before them no longer plays, and is set aside at
the title with its note (Chromium: no Continue, the note, no error). **The check**: the expert's whole runs of `mon-0…2`
and `div-3` and basic's of `mon-0…1` (each log, end state and harness record, each replayed), the calculator's of
`mon-0…1` and the outside teacher's of `sim-10`: the same before (094e111) and after, byte for byte. In Chromium at the
three sizes: a first visit's chooser (the base alone; a link asking for the Hive held to it; the three locked in the
picker, a tap on one refused), a clear at 0 opening the Brass Monarch, chosen and kept, the title's two rows in one
view each, a run begun as it (its banner held, its save carrying it), a run as it Continued at its floor-1 boss battle
(the Barrow Marshal) and played on to its end, its History line naming it; no console error. `test/monarchs.test.js`
(5: the records; the base changing nothing; a variant's relic, draft and bias over 300 seeds, its offers still a plan;
replay, the save, the history and the harness; the unlock rule): 514 on the bosses' merge → 519, all passing but the
expert's-turn milliseconds test, which fails alike on 094e111 with the machine at a load of 9 (367 ms here, 425 ms there,
against its 250; `--test-concurrency=2`, 587 s).

**Criterion 5**: a run saved and resumed, a clear in ~79 minutes of battle and a tutorial (Step 8), music, and the first
unlocks (the ascension's, Step 7; the Monarchs, here) hold; §4.7's bosses are their own subsection, the outside players
are left.

### Bosses a floor (Step 9, 2026-10-15)

**Built** (§4.7, on 4c3e86e beside Step 9's product agent; the content, the sim, the codex and the interface): floors 1
and 2 end in a floor's boss and its court, where the last elite stood; floor 3 keeps the Hollow Sovereign's siege, its
phases, its Grave Tide and its crumbling, its room and every floor-3 room drawn byte for byte as before. Four bosses,
each one record (`boss`, `floors: [1, 2]`, `answers`, `court`, `phases`, a `temper`, `threats`, flavour; no tracks),
each one counter of §4.7's in its kit, a rule in `rules.js` scoped to it only where the kit cannot say it:

| Boss | Answers | Kit | Court | Rule | Phase | Art |
|---|---|---|---|---|---|---|
| The Mire Mother (Fae Channeler) | casters | Mire (Hex every foe within 3), Hex (one from 3), Witchfire; hexer temper (hunts the one with the most skills ready) | Marsh Hags (each Hexes) | none | Enraged at 50%: Mire and Hex every turn | Marsh Hag |
| The Molting Abbess (Insect Warden) | statuses | Molt, Purge as its basic heal, Royal Scythe | Hive Wardens and Clockwork Pages (each Purges) | `molting_abbess`: as the foes' turn begins it sheds every debuff on itself | Regen at 50% | Hive Warden |
| The Barrow Marshal (Undead Ranger) | shooters | Marrow Spear down a lane, Searing Bolt from 5; shooter temper | the floor's elite Vanguards, across the front row, it behind | `barrow_marshal`: while it stands, a shot at one of its side but a Vanguard lands on a Vanguard beside it | Desperate at 40% | Barrow Wight |
| The Swarm Queen (Insect Skirmisher, flies) | walls | Swarm Cloud, Venom Sting (Withers); seeker temper | Hive Drones | `swarm_queen`: every second turn two drones hatch beside it, four standing at most | Enraged at 50% | Hive Drone |

A boss is tier 4, HP and ATK its own × `TUNING.spawn.bossHp` [1, 3.2, 1] and `bossAtk` [1, 2, 1] by floor, its court
`TUNING.spawn.court` [2, 4, 4] (new placeholders, set by the codex's power, √(HP × ATK) summed a wave and the waves
as the root of their squares: a floor's boss room 201 on floor 1 against its last elite's 127, 494 on floor 2 against
483, on 64 seeds; the Sovereign's 1, 1 and 4 as they were). Its pictures are its lender's, washed as a
capstone's and drawn as big as the Sovereign's (`dom.js figures`: 1.5×, the Sovereign's 144 box to a kind's 96).

**Which boss**: the army read as the floor opens (§4.7's intent, kept fair and visible). Each living soul leans on one
thing, the first that holds (`run.js leaningOf`): a Channeler casts; a Ranger shoots; a blow of its kit laying a debuff
is statuses; a basic blow that is a shot down a line shoots; fighting in melee alone on the ground is a wall. The floor's
boss (`bossFor`) is the pool's (`bossPool`: those tagged with the floor; the last floor's the Sovereign, `last`) that
answers what the most souls lean on; a tie, or an army leaning on nothing a boss answers, drawn by the seed among the
tied. A floor opens (`openFloor`) as it is entered and the first once the draft is done: the boss chosen, every battle
room drawn (floor 1's now after the draft, on the same streams), the routes varied (`varyRoutes`, which never redraws a
boss room and reads its threats as it read the elite's), the elites answered. The boss and its court are on the map from
then like every room's foes, its tip naming it and what it came for ("It came for casters, your Channelers: what your army
leaned on most as the floor opened"); a run cleared or saved replays to the same boss (its log, its army). A floor's
boss room is one formation, won as an elite is (its bounty, `bountyOf`; its spoils, its court's souls, never the boss's:
`soulOffers`); the last floor's alone is a clear (`clearsRun`).

**Elites that answer the army** (`answerArmy`): as the floor opens, the threat types its foes can bring (`routeThreats`)
that no living soul answers (`ANSWERS`, moved from `autoplay.js` to `run.js` unchanged: Fly by a blow that reaches a flyer,
Reach by a ranged blow, Drain, Burn and Bleed by a heal of others or a cleanse); where no elite of the floor carries one,
one elite is drawn again wanting one and keeping every type it had (`drawRoom`'s `want`, on a stream of its own), the
elites in an order the seed draws, the types in order; with no such draw, the elites stay. Deterministic per seed and
army; replay-equal. With the expert's armies it seldom fires: on `div-0…63`, an army of Wisp, Chanter and Sprite (floor
1), of the Court, two Chanters, a Sprite and a Wisp (floor 2), and of the Court and the Chanter's and Sprite's trines
and a Hag (floor 3) leave Drain, Burn and Bleed unanswered, and an elite already brings one on 64, 61 and 64 of the 64
floors (the three left hold no elite); its test holds it on an army of walls and shots.

**Generalised from one boss**: `BOSS` gone (`bossIn`, `bossPool`, the court by `courtPool`: a boss's `kinds`, or the
floor's elite pool of its `kin` or `role`, the Sovereign's undead, drawn as before); `foeMods`'s boss multipliers by floor;
a boss's fall ends a battle as `'crumble'` (was `'sovereign'`), any boss's; `map.js generateFloor` takes `boss` (a floor
with a pool ends in one, the deep in its big elite). Arise, Legion, the Tide, the ascension and crumble already read any
boss. The expert reads nothing new: its readers are generic (a room by its type, a foe's `boss`, `foeMods`), the book
reads no boss (`npm run combos`: the same), the harness records each boss room's boss and `--pool` offers none. The codex:
a boss room's name and line, a boss's wave by its name ("Wave 3: the Sovereign"), its bestiary line once met ("it may end
floors 1 and 2, and comes for an army that leans on walls…"), a boss's rule flared as "Boss · its name", a foe's summons
on its card, How to play's lede, the floors' tip. The battle: a boss's wave banner, "THE MIRE MOTHER FALLS" with its court
crumbled and its tally, the spoils "The boss falls" with its bounty.

**Tests**: `test/bosses.test.js` (12: the records and their counters; what a soul leans on; the choice, its ties and an
army leaning on nothing, the last floor the Sovereign whatever the army; a boss a floor on the maps, its court, the
Marshal's front row; the draft opening floor 1, the same on replay; a run through the three, a floor's boss's bounty and
spoils, never its own soul, the Sovereign's fall the clear; the Abbess's shell, the Marshal's screen against a shot and
not a melee blow or a blast, the Queen's brood, each with the boss fallen; for every boss its first phase, its fall's
crumble, no Arise or Legion; the ascension on every boss; the elites that answer the army) and one in `codex.test.js`
(the room's name and line, the Sovereign's, a boss's wave, the bestiary line, How to play); the tests that read one
boss, four floors' `last`, scalar boss numbers or the `'sovereign'` reason brought to the rule. 491 → 504, all passing
(`--test-concurrency=2`, 264 s; under the measuring's load the turn's milliseconds test once ran past its 250 ms, alone
it passes).

**The browser** (Chromium at 1440×900 and 852×393, `npm start`, by a script outside the repo): a run begun on the title,
its draft taken and a Pale Court given, its floor-1 boss room set to each boss in turn by the run's own `drawRoom`; the
map's tip on the boss room (its name, why it came, the bounty and the recruit, its court in the mini grid, the threat);
a battle against each, played to its end by the expert's orders given through the scene (`send`, as taps give them;
the Mire Mother's by End Turn alone), the boss drawn washed and as big as the Sovereign, its phase played as its HP
crossed it (Enraged, Regen, Desperate, Enraged; for the three the expert played, its HP set a little above it as the
battle opened, outside the log), the Abbess's shell and the Queen's brood flared over them and announced once, the
Marshal's screen in its aim preview (the expert's shots went elsewhere; its rule is the tests'); the end banner ("THE
MIRE MOTHER FALLS · Its court crumbled with it. 3 foes slain · +131 essence") and the spoils ("The boss falls", the
bounty, a Marsh Hag to recruit); the bestiary with every boss met, each its line. No console error. Screenshots
`boss-*.png` in the session's scratchpad. Seen there: the Abbess and her wardens, keepers all, wait at the edge for an
army that does not come to them, as the camp's patience allows (§2.10 of the old spec): with that run's weak draft and a
Pale Court left behind the battle took 35 turns, the Monarch at 21 HP at its end (the expert's runs below: 2 to 7.5 turns on
average).

**Measured** (the expert as Step 0 has it, its forests and route stale by design; the draft on; seeds `div-*`; two
workers beside the product agent): free play, `--commit none --runs 64`, on 4c3e86e and here, seed for seed, and a third
arm here with the elites' rule switched off (a copy); `--commit channeler_4,fae_4,undead_4,bone_colossus,trine:pyre_hound
--runs 32` on both (the Channelers, the Fae and the Undead, and two that lean otherwise: the Colossus's Knights, walls; the
Hound's trine, Burning). The bosses met and the rooms the runs fell in are read off the records (each boss room's battle
names its boss: `boss`; the room a run fell in, `fell.rank`).

Free play, `div-0…63`:

| | 4c3e86e | Bosses a floor |
|---|---|---|
| clears | 50 (78%) | 41 (64%): +5 −14, −14.1 ± 6.6 points |
| progress | 87.0 | 79.1 (−7.9 ± 3.5) |
| died on floor 1 / 2 / 3 | 9 / 0 / 5 | 15 / 1 / 7 |
| of them in the floor's last room | the Sovereign's 4 (the old elites' none) | the Barrow Marshal's 2 (floor 1), the Sovereign's 5 |
| battles a run; turns of floor 1's and 2's last battle | 32.3; 8.1 and 4.1 (elites) | 29.4; 4.4 and 7.4 (bosses) |
| fused kinds in the final armies (of the clears) | Court 80% (92%), Chanter's trine 64% (74%), Winter Court 33% (40%), Sprite's trine 28% (30%) | Court 73% (95%), Chanter's trine 59% (83%), Sprite's trine 30% (37%), Winter Court 17% (22%) |
| Marsh Hags held at the end (of the clears) | 8% (10%) | 36% (51%) |
| pieces of the last battles | Channelers 83%, Skirmishers 16% | Channelers 74%, Skirmishers 25% |
| synergies held (battles) | Echo 38%, Legion 20%, Mirage 4% | Echo 38%, Legion 21%, Mirage 4% |

The bosses met: on floor 1 (51 runs) the Barrow Marshal 26 times (2 runs fell there; 5.4 turns a battle), the Mire Mother
22 (none; 4.2), the Molting Abbess 2 (3.0) and the Swarm Queen once (2.0); on floor 2 (48 runs) the Mire Mother 46 (none;
7.5 turns) and the Marshal 2 (6.0). The arm without the elites' rule plays all 64 runs battle for battle as the change
does: with the expert's armies an elite always brings a threat they cannot answer already (above). Where the runs lost were
lost (of the 14 seeds that went from a clear to a fall): 6 on floor 1, one in the Marshal's room, five in earlier rooms;
1 on floor 2; 7 on floor 3, five in the Sovereign's room. The rooms before a floor's last are drawn otherwise on 21 of 64
floor 1s (61 of 1,975 rooms) and 40 floor 2s (138 of 1,973), varyRoutes reading the boss room's threats where it read
the elite's; floor 3's not at all, its every room and the Sovereign's byte for byte as at 4c3e86e.

Committed, `div-0…31`, each against itself at 4c3e86e seed for seed:

| Archetype | Clears | Progress (paired) | Died on floor 1 / 2 / 3 | Floor 1's boss met (fell there) | Floor 2's |
|---|---|---|---|---|---|
| free play | 26 → 21 (+3 −8) | 90.5 → 84.7 (−5.9 ± 3.7) | 3 / 0 / 3 → 5 / 1 / 5 | Marshal 13 (1), Mire Mother 14, Queen 1 | Mire Mother 25, Marshal 1 |
| Channeler 4 (Echo) | 24 → 22 (+2 −4) | 88.6 → 86.9 (−1.7 ± 2.9) | 4 / 0 / 4 → 4 / 2 / 4 | Mire Mother 22 (1), Marshal 5, Abbess 1, Queen 1 | Mire Mother 28 (2) |
| Fae 4 (Mirage) | 22 → 23 (+4 −3) | 83.9 → 85.6 (+1.7 ± 4.5) | 6 / 0 / 4 → 5 / 1 / 3 | Marshal 15 (1), Mire Mother 9, Abbess 2, Queen 2 | Mire Mother 26 (1), Marshal 1 |
| Undead 4 (Legion) | 16 → 16 (+8 −8) | 84.3 → 82.4 (−1.9 ± 4.7) | 5 / 1 / 10 → 6 / 2 / 8 | Marshal 12, Mire Mother 9 (1), Queen 4, Abbess 2 | Mire Mother 25 (2), Queen 1 |
| Bone Colossus | 19 → 19 (+6 −6) | 86.1 → 83.9 (−2.2 ± 5.1) | 4 / 1 / 8 → 6 / 1 / 6 | Marshal 12 (1), Mire Mother 10, Queen 4, Abbess 2 (1) | Mire Mother 26 (1) |
| Pyre Hound's trine | 17 → 16 (+6 −7) | 83.5 → 77.6 (−6.0 ± 4.0) | 5 / 0 / 10 → 8 / 1 / 7 | Marshal 13 (1), Mire Mother 10 (1), Queen 2, Abbess 1 | Mire Mother 24 (1) |

**What it says.** The bosses meet the builds §4.7 means them for, as far as the expert builds them. Floor 1's is read off
the draft: the Mire Mother takes Channeler 4's drafts 22 times in 29 (free play's 14 in 28), the Marshal the drafts of
Sprites and Hounds; the Abbess and the Queen come for the few drafts of Ghouls and Hounds or of Knights, Pages and Wardens
(1–4 a row). By floor 2 every army the expert builds leans on casters whatever its book commits it to (the Court, the
Chanters, the Hags), and meets the Mire Mother in 24 to 28 of each row's runs: the floor's counter lands on the
monoculture, and on the committed runs as much as on free play, because the committed expert is free play bent a little
(Step 0). Floor 1 is not unwinnable: its bosses fall in 2 to 6 turns on average, the Marshal the hardest (2 runs of 26 fell to it),
and none was softened. The floors' bosses cost the expert little in their own rooms (2 runs of 64 fell in them, 97 of 99
battles won) and floor 2's last battle runs longer (4.1 → 7.4 turns); what the change costs free play, −14.1 ± 6.6 points of
clears (−7.9 ± 3.5 of progress), is mostly elsewhere: the Sovereign's room (5 new falls, 3 new clears) and the earlier rooms
of floor 1, on maps a few rooms of which are drawn otherwise and on runs that grow otherwise. One way they grow otherwise
is the bosses' own courts: the Mire Mother's spoils offer a Marsh Hag, a tier-3 Channeler on floor 1 or 2, and the expert
takes it (Hags in 36% of final armies, 8% before), and the Winter Court falls beside them (33% → 17%).
So the Channelers do not lose share among the clears (the Court 92% → 95%, the Chanter's trine 74% → 83%): the counter
feeds its target its own kind. Committed, every row's paired difference is within two standard errors: the Hound's trine
(−6.0 ± 4.0) and free play (−5.9 ± 3.7) lose most, the Channeler, Fae, Undead and Colossus rows move −2.2 to +1.7 points
of progress, their clears within 2 of 32 of what they were. What the teacher's margins would say of which boss leans on which build is unmeasured (the teacher was not run; §3's
instrument for it, overnight). For the balance pass: a boss's court as its spoils (the Abbess's pages and wardens, the
Marshal's Vanguards, the Hags) pulls a run toward the kinds the boss answers or away from them, a lever beside the bosses'
numbers; and the elite drawn for the army never fired in the expert's 64 runs (Drain, which few armies answer, is on most
elites from floor 1), so it acts only where a floor's elites all lack every type an army cannot answer.

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
