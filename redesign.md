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
| the battle teacher (`teach.js --teacher`; `teacher.js`) | each battle option played out to the battle's end by the expert | ~200 (1,100+) | 75% (78%) on 64 | the battle forest's labels at a refit; never in the loop |

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

- **In battle** (`policy.js expertTurn`, the fast turn; the beam `TUNING.expert.beam.on` is off): the **situation**
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

### Step 1. Availability (sim, ~2 h)

§4.2: the draft's guarantee (`draftOffer`), `tierFalloff` and `tierOverCap`; tests: a second pick always offers a
recipe partner or a kin-mate of the first; the pool's shares by floor. Measured by `--pool` against criterion 1 and by
the ladder for the difficulty it moves.

### Step 2. The fusion graph (content, ~6 h; then the interface, ~2 h)

§4.1: `trineOf`, `TUNING.trine`, the Pale Court as a written trine, the seven capstones (art borrowed until drawn),
the content test's graph rules, `--combos`, the codex's Fusions page and the kind cards, the glossary's Trine. The
interface: a trine drawn as its kind, bigger (2×2 as now) or thrice overlapped (a `trine` flag the engine reads; the
interface agent's call); the Field's Fuse button and the in-battle fuse unchanged. Measured: every archetype's
reachability (criterion 1) and the committed expert on 256 seeds; the teacher's committed margins overnight.

### Step 3. Synergies (sim + content, ~2 h)

§4.3 in `rules.js` and the synergy records' text; tests for each changed rule. Measured by the committed runs per
role and kin.

### Step 4. Relics (content, ~2 h)

§4.4's twelve records; the content test holds their forms; `--combos` (the book pairs relics with combos). Measured
by the relics ablation and the committed runs' relic shares.

### Step 5. The altar's choice (sim ~2 h, interface ~1.5 h)

§4.5: the altar's phase with three offers, `transmute` and `consecrate` as actions in the log and `replay`; the
expert's altar choice by the growth sketch; the altar screen. Measured by archetype changes after floor 1.

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
§4.0). Set aside the same day: the autoplayer rewritten as forests fitted by expert iteration, and search alone.

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
