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
expert… I don't want the old content. Plan around only the decision forest and the battle teacher"; on the content,
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
3. **Diverse in free play.** No fused kind in more than 30% of the forest expert's final armies; every base recipe
   made in 8% or more of runs; six or more of the eleven synergies each active in 5% or more of battles; the relics
   ablation worth 10 points or more.
4. **Still a game.** At the base difficulty the forest expert (§4.0, refitted on the content) clears ~90% and the
   calculator (§3: sound turns, no strategy, the novice's model) reaches floor 2 about half the time; at the top
   difficulty the teacher clears ~60%, and the ladder keeps its order at every level.
5. **A product.** A run saved and resumed; a clear in 75–90 minutes; a tutorial; the first unlocks; music.

## 3. The instruments

The user's word: "remove the hand expert… I don't want the old content. Plan around only the decision forest and the
battle teacher." Nothing in the game runs the expert (the foes are `foeTurn`, the untouched the basic rule): the whole
autoplayer stack exists to measure. **The hand expert goes**: expert.json's tree of hard rules and its leaf weights,
`TUNING.expert` (178 numbers searched by CMA-ES on the old content), the hand rules out of battle (the growth sketch's
worth, the formation's static score and hill-climb, the draft's ranged rule, the hand route, the give-relic rule), the
combo book (`combos.json`, `--combos`: a hand prior for build targets) and the forests' δ margins over the hand
choice. What stays is the **vocabulary**: the situation read, the option features, the conditions, the afterstate read,
the out-of-battle reads (`outsideRead`, `prepRead`), the legal options and the candidate enumerators: a feature is a
reading of the board, not a judgement. Above the two weight-free players, two remain, both made from the content by one
loop, so nothing judged by hand on old content survives a content change:

| Player | What | s/run | Use |
|---|---|---|---|
| basic (`LEVELS.basic`) | End Turn with basics; the first offer; the default frontier | ~1 | the ladder's floor; content-agnostic |
| **the calculator** (`calc.js`) | no weight: each piece's legal options read by `features` with `brink` and `peril` at 0, taken by [Monarch safe, material in HP at unit weight]; out of battle a fixed order (the highest tier, the most souls an essence, the rarest relic, the default frontier) | ~3 | the novice's model: sound turns, no strategy (§8: dead on floor 1 in 22 of 32 runs, 9.5 battles a run, against basic's 2.3) |
| **the forest expert** (§4.0) | a random forest a decision, over every legal option, fitted on the teacher's playouts of the current content | ~5–10 | the fast loop; the balance pass's player; the ladder's middle |
| **the teacher** | the forest's top candidates each played out exactly to the end (`teach.js --teacher` in battle, `outside.js` out of it), the best taken; never shipped | ~70 (out of battle) to ~200 (battle) | the ceiling; the forest's labels; the yardstick for viability |

- **The fast loop: the forest expert** as last fitted, free and committed, 256 paired seeds (`div-*`), ~30 min on
  four cores, after every content change. Between refits it is stale (its trees were fitted before the change), but
  its features are generic (HP, ATK, reach, tier, role, the recipe graph) so it degrades, it does not break, and the
  paired differences are what count. Refit at milestones (§6), never per change.
- **Viability and the ceiling: the outside teacher**, committed to each archetype, 64 seeds each, at the top
  difficulty (§4.6), ~3 h for ten archetypes on four cores. It saturates at the base difficulty (63/64 with the old
  expert's battles: nothing to rank), so it reports clears **and a margin**: the Monarch's HP share and the souls' at
  the end, battles lost, essence left, turns. It needs no refitting when content moves: it judges by outcome. The
  battle teacher (`teach.js --teacher`; `teacher.js` where the shortlist's best all lose) is the battle ceiling and the
  battle forest's labeller; at ~200 s a run it is measured on 64 seeds, overnight, never in the loop.
- **The balance pass's numbers: the forest expert refitted on the content**, 768 seeds, because "the expert ~90%" is
  defined on a fast player who has learnt the game, and the forest is that player. The ladder (basic → forest →
  teacher) at every difficulty is the skill-differentiation measure: its rungs must keep their order and their gaps.
- **Dropped:** forest rounds for their own sake (the old spec spent days on them for a few points as corrections; a
  round now is kept only where the ladder's rung moves on fresh seeds), and the 768-seed paired search over hand
  weights (there are none).
- **Measured and rejected: search alone** (§8, the spike of 2026-10-15). The teacher over the calculator, with no
  learnt player at all, cleared 0 of 12 seeds (mean progress 0.76 against the calculator's 0.20 on the same seeds;
  136 s a run), where the outside teacher over the shipped expert cleared 63 of 64. Search amplifies a competent base;
  it does not supply one. Its playouts continue with the base, so a line that needs the base to follow through (save
  for a Shop, field a sixth piece, keep a recipe's parts) is never seen to pay. A learnt player is needed, and it must
  be learnt from a teacher whose base already wins (§4.0's round 0).

**The harness** (`autoplay.js`, Step 1): `--builds [--player forest|teacher] [--commit <archetype>|all] [--scale
<difficulty>] [--runs n] [--seed s]`: an archetype is a node of the recipe graph (a fused kind) or a synergy, read
from the content, never from a book; a committed run's draft, recruits and purchases are filtered to the archetype's
parts (its recipe's kinds, closed over the graph; a synergy's kin or role), and the forests choose among what is left;
the teacher's candidates come from the same filter. A row an archetype: clears, progress, the margin columns, the
share of runs that made its fusion or reached its synergy and the median battle it came on; a last block for free
play: the archetype shares, kinds held, fusions made, synergies active, relics bought (the diversity block, also in
the ladder report). `--pool`: the availability table of §1 from `spawnPool`, and for each recipe the expected battles
offering each part by floor. Noise as the old spec reported it: ± one standard error of the paired difference; 64
seeds resolve ~6 points of clear rate, 256 ~3.

## 4. The design

### 4.0 The expert: forests fitted on the teacher

Today's forests correct a hand choice among a hand shortlist (`forest.js choice`: the best candidate is taken only
where the forest puts it more than δ above today's; `outforest.js`: the same over today's pick and its next five).
Now the forest **is** the choice, at every decision, and the teacher is its only source of labels.

- **One forest a decision kind**, each over the legal options of that decision and the reads that exist: the battle
  (a piece's move and act, `policy.js options` pruned to a cap by geometry alone: every act at every target, from the
  nearest tiles its Move reaches to each target, to each road's held tile and to the Monarch's side, and stay; no
  hand score picks the shortlist), the prep (formations: the plan's drafts and `prepCandidates`' perturbations of the
  best so far, climbed on the prep forest's own read without the opening boards, the top nine read with them), the
  draft (new: an offer's kind, what it fuses into, the pool ahead), the recruit and the purchases (as now, over every
  offer and every affordable tier and fusion, passing on and stopping among them), the Shop (new: each relic and
  leaving), the holds (new: each unheld relic to each fielded soul), the route (the learned route's model tree stays:
  it was fitted on playouts, not written; relabelled with the rest). **Only legality is hard**: what the game refuses
  is never an option; no-waste, monarch-lethal, never-die and the rest are gone, and the audit records the forest's
  margin over its second choice in their place.
- **Inputs** as today's readers give them: the situation (the ~68 conditions), the option's features and the same
  less the mean of its position's, the board the option leaves (`aft.*`), the piece's role and size, and the reads out
  of battle; plus the recipe graph's reads that replace the book's "combo progress": for each soul, the share of each
  recipe it is part of that the run holds, the nearest fusion's gap in souls and essence, the archetype a committed run
  is held to. `expert.json` holds the forests and the route, nothing else; `bundle.js` as now.
- **Labels by the teacher, offline**, as today's labellers make them (`teach.js` in battle: every option of the
  decision played out to the battle's end; `outside.js --label` out of battle: every candidate to the run's end;
  `--draw state`, the floors' factors), the **continuation the forest expert itself**, so no label leans on a hand
  player. The target an option's value less its decision's mean; bagging by run; seeds ≡ 0 mod 5 held out.
- **Rounds, by expert iteration.** Round 0 needs a continuation before any forest exists (§7.8): the shipped expert
  of f8c536f, run once on the content as it stands, deleted with its weights when round 1 beats it on fresh seeds.
  Measured, not assumed (§8): a weight-free base makes a teacher that clears nothing, so its labels say only which line
  loses later; the shipped expert's teacher clears nearly every seed, so its labels separate a clear from a loss. Round k: 300–500 runs of forest k (ε 0.1 over its top three), labelled with forest k as the
  continuation, forest k+1 fitted on every round's labels (the last two at full weight, older halved), kept only on a
  paired gain on 768 fresh seeds; the battle forest and the out-of-battle forests alternate rounds, as the old spec's
  did; 3–5 rounds, each about a night on four cores. The bar to pass before any content work is measured: the ladder's
  order (basic < forest < teacher) and a forest at or above the old shipped expert's 65% on `aud-0…59` (§5).
- **The milestone refit** (§6) is one round of this loop on the content as it stands, labels and all; a change of
  content that adds a kind adds reads for it with no new feature (the readers are generic), so a refit is the whole of
  what keeps the expert current.
- **Cost**: a battle decision's options grow from ≤ 16 to ~40–60 with no hand shortlist; the forest's read is ~15 µs an
  option and the afterstate read the larger part, so a run of ~45 battles reads in ~5–10 s; the prep's climb on the
  boardless read ~0.2 s a prep. Acceptable for the fast loop; the teacher's costs are unchanged.
- **Risk, stated plainly**: a forest was never the whole player here. As corrections the forests realised a hundredth
  of the teacher's gain a decision, and a tree given free leaves lost 28 points. Expert iteration from a strong seed
  is the answer to that (the labels' continuation improves with the forest), and the bar above is the test; if three
  rounds do not pass it, the fallback is the forest over the shipped expert's shortlist (its candidates kept, its
  choice not), and the hand expert's deletion waits until a round passes.
- **The calculator** (`calc.js`) is kept beside it, not as a seed but as the ladder's novice rung (§3) and as the
  check that the game asks for strategy: if the calculator ever clears the base difficulty, the run needs no plan.

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
  generically and need nothing; the archetypes `--builds` commits to and the forests' recipe reads (§4.0) are the
  graph itself, so a new recipe is an archetype at once; `abilitiesOf` reads a generated kit as any. A trine counts once toward synergies, as every piece does: fusing trades count for a body,
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
unlocked a level a clear. Level 0 is tuned on the forest expert (~90%) with basic reaching floor 2 about half the
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
`reach.mjs` (the pool table), to be folded into `--builds` and `--pool` in Step 1 (they lived in a session's
scratchpad; Step 1 rewrites them in `autoplay.js`).

## 6. Implementation

One working tree; content is data; at most two agents at once, never two on `src/content.js`; tests check function;
no number moves but the ones a step names, until the balance pass. Each step ends with its numbers appended to §8
and the README's autoplayer section kept true. Step 0 comes before every other, because every measurement after it
is made with the player it builds.

### Step 0. The forest expert (sim, ~2 days of code, then 3–5 rounds of a night each)

§4.0, in order: **(a)** the candidate enumerators with no hand score (battle: geometry; prep: the climb on the forest's
read; the draft's, the Shop's and the holds' options), the recipe-graph reads, the committed filter; **(b)** the
labellers pointed at the forest expert as their continuation (`teach.js`, `outside.js`: the draft, the Shop and the
holds labelled as the recruit is), and the fitters (`forest.js`, `outforest.js`) over every decision kind; **(c)** the
hand expert deleted: `expert.js`'s tree and weights, `TUNING.expert`, `plan.js`'s static score and hill-climb,
`combos.json` and `--combos`, `value.js`/`value.json`, `ranker.js`, `fit.js`'s tree fitter and `train.js` where
nothing reads them, `LEVELS.expert`'s `search`, `book` and the rest, and their tests (`planning`, `puzzles`,
`ablation`'s formation band, `policy`'s hand-rule cases, the `*-learned` suites); the puzzles that state a *right
move* (the healer first, the shooter felled before the healer, the walled road) stay, as the teacher's and the fitted
forest's own checks; **(d)** round 0 seeded as §7.8 decides, then the rounds, each kept only on a paired gain on 768
fresh seeds. Done when the ladder reads basic < forest < teacher and the forest expert clears at least the old
shipped expert's 65% on `aud-0…59`; the README's autoplayer section rewritten for it; its numbers in §8.

### Step 1. The harness (sim, ~3 h)

`--builds`, `--pool`, the diversity block in the ladder report (§3), the margin columns, `--scale`, `--player`,
`--commit`; `test/builds.test.js` (a committed run's candidates are its archetype's; the pool table sums to one; the
report's shape). Baseline rows for every archetype that exists today, forest and teacher, into §8.

### Step 2. Availability (sim, ~2 h)

§4.2: the draft's guarantee (`draftOffer`), `tierFalloff` and `tierOverCap`; tests: a second pick always offers a
recipe partner or a kin-mate of the first; the pool's shares by floor. Measured by `--pool` against criterion 1 and by
the forest ladder for the difficulty it moves.

### Step 3. The fusion graph (content, ~6 h; then the interface, ~2 h)

§4.1: `trineOf`, `TUNING.trine`, the Pale Court as a written trine, the seven capstones (art borrowed until drawn),
the content test's graph rules, the codex's Fusions page and the kind cards, the glossary's Trine. The interface: a
trine drawn as its kind, bigger (2×2 as now) or thrice overlapped (a `trine` flag the engine reads; the interface
agent's call); the Field's Fuse button and the in-battle fuse unchanged. Measured: every archetype's reachability
(criterion 1) and the committed forest on 256 seeds; the teacher's committed margins overnight.

### Step 4. Synergies (sim + content, ~2 h)

§4.3 in `rules.js` and the synergy records' text; tests for each changed rule. Measured by the committed runs per
role and kin.

### Step 5. Relics (content, ~2 h)

§4.4's twelve records; the content test holds their forms. Measured by the relics ablation and the committed runs'
relic shares.

### Step 6. The altar's choice (sim ~2 h, interface ~1.5 h)

§4.5: the altar's phase with three offers, `transmute` and `consecrate` as actions in the log and `replay`; the
altar as a decision kind of the forest (labelled as the recruit is); the altar screen. Measured by archetype changes
after floor 1.

### Step 7. Measure, iterate, refit, balance

Two bug hunts (a trine fused onto a held tile, a capstone's part consumed twice, a transmute keeping the wrong relic,
a generated kit missing a basic, a recipe cycle, a forest offered an illegal option). Then the loop: the forest expert
on 256 seeds and the teacher committed on 64, criteria 1–3, content moved until they hold (the balance pass's domain:
the trine table, the capstones' numbers, Echo's halves, the pool's falloff). Then the milestone refit (§4.0: one
round of labels and fits on the content as it stands, overnight), the forest ladder on 768 seeds, criterion 4 at level
0. Then the README, §8, a push to master.

### Step 8. The ascension ladder (sim ~2 h, interface ~1 h)

§4.6; the top level tuned on the teacher; the ladder report every level; the title screen's choice.

### Step 9. The skill curve (interface ~4 h, sim ~1 h)

§4.8's save and resume, foe reach on tap, the tutorial room, `RANKS` by the measured orders a clear.

### Step 10. The product

§4.7's bosses; §4.8's history, daily seed, Monarch variants, music; a store build; five to ten outside players through
a run with the time and the deaths recorded. Done when criterion 5 holds and the players' runs end where the ladder
says they should.

## 7. Decisions

Taken on 2026-10-15, the user's word: a triple for every kind; fusions of fusions; the teacher as the yardstick for
content, the forests refitted at milestones only; the hand expert removed, the autoplayer the decision forests and the
teacher alone (§3, §4.0); this file the plan, the old spec to history.

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
8. **Round 0's continuation** (§4.0): the shipped expert of f8c536f, run once on the new content as scaffolding and
   deleted when round 1 beats it. Measured on 2026-10-15 (§8): the weight-free alternatives make a teacher that
   clears nothing (the calculator's, 0 of 12), so the old expert is the only seed whose labels tell a clear from a
   loss. Recommended; the user to confirm, since it keeps the old expert alive until round 1.
9. **The combo book goes with the hand expert**; archetypes and the forests' build reads come from the recipe graph
   and the synergies (§3, §4.0). The alternative keeps the book as a read-only prior feature; recommended against,
   since its weights were chosen by hand on the old content.
10. **Which puzzles survive** (Step 0c): those that state a right move a teacher must find, kept as checks on the
    fitted forest; those that state a hand rule's behaviour go with the rule.

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
strategy. **Decided by it**: search alone rejected (§3); round 0 seeded by the shipped expert (§4.0, §7.8). Not built:
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
- **No judgement by hand in the autoplayer**: every weight it holds is fitted on the teacher's playouts of the content
  as it stands; a reader of the board is vocabulary and may be written, a rule of what to do is not (§3, §4.0).
- One universal landscape interface, modular tabs, nothing that needs hover or a key.
- Recruit only: one slain foe a battle, as a full soul into the ossuary (§7.2 may amend).
- Content is data; code grows only when the vocabulary grows. A generated trine is content made by one rule (§4.1).
