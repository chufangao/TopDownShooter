# RETINUE: the dead take their turn

The combat, enemy and content redesign decided on 2026-10-10, and the plan for building it. For Chufan and for any
Claude Code session working in this repo: read this before touching `src/`. It supersedes the parts of `DESIGN.md`
that say your pieces never move (§1, §3.1), the foe rules of §2.3–2.4 (halting, sight, retaliation, no foe reach),
the rings, the gauge, the synergies' stat steps (§2.7), the Reliquary and the elites' relic offers (§2.6). Everything
else in `DESIGN.md` stands: the board, footprints, roads, essence and prices, tracks and tiers, fusions, relics and
their tiers and stacking, Arise's place, summons, the fallen, the default frontier, the interface frame. Section 5
says what to build, who owns which files, and in what order.

## 1. Why

Played through, the game had one battle action: **Fight**. The sim ran to its end and the board played it back.
Prep was two decisions, how to upgrade and where to place, and the default frontier made the second one for the
player (`frontier` in `src/sim/run.js` stands the Knight on 18 to 21 of the 21 entry roads in every camp). The
only decision left was what to recruit. The fusions ablation read 1 ± 2 points; relics were a stat nudge a run
rarely noticed; nothing in a battle was the player's.

Three balance passes found the same thing from the other side: foes walked past your pieces doing nothing, the
army lost 6% of its HP a battle, defence never registered, and a run ended at the Monarch or not at all. One rule
for every kind (walk the arrows, halt where you can hit back, strike what blocks you) is a rule a player solves once.

So, reversed here, from `DESIGN.md`:

- **"Your pieces never move."** They move now. Combat is turn-based on the same board: each piece moves, then
  acts, and the player gives those orders. The old objection to orders was to lines drawn in prep and then
  predicted; an order given on the turn resolves in front of the player, and there is nothing to predict.
- **"Foes walk until they can hit back."** The enemy is one opponent now, not a crowd of walkers: every foe is
  scored by one judgement with one shared picture of the board, and the kinds differ by temperament, not by code.
  Into the Breach is the bar for the board (small, every number visible, the Monarch to protect); Civilization and
  Wesnoth are the bar for the opponent (one pressure for the side, a danger map, one scoring function, per-kind
  weights).
- **"A reliquary is one free pick."** Relics are bought, and bought only. The Shop is the room, essence is the
  price, and relics compete with tiers for the same scarce purse.

And the redesign cuts as it goes: what the turn makes redundant (rings, the gauge, the dice and the three stats
that fed them, the escalation ramp, the stat steps of the synergies) goes with it, and what remains is data a
single record at a time (§2.13), so that adding a unit, a relic or a merge is one record and a test that says what
it lacks.

What stays true: foes walk the one drawn road and flyers the air road, blocked by your pieces, never through them;
the dead never block; enemy behaviour is discovered, never previewed; defeat is absolute; floor 1 is hard, and the
gap opens in the player's decisions. With dice gone, it opens nowhere else.

## 2. Rules

### 2.1 Board

Unchanged (`DESIGN.md` §2.1): tiles, 8-neighbour, Chebyshev distance, `COLS` 7 by `DEPTH` 11, walls from the camp
map, the Monarch pre-placed on `'M'`. Roads: the Walk field flooded from the Monarch's tile (`field`, to move from
`src/sim/battle.js` to `src/sim/turns.js`), the air road over everything (`airOf`). Drawn in prep.

### 2.2 Pieces and Move

- A piece is one soul, one body, size 1 or 2, as `DESIGN.md` §2.2 has it. Summons and the fallen as there.
- **A piece's stats are HP, ATK, DEF and Move**, and its blows' ranges. ACC, EVA and CRT are gone with the dice
  (§2.6); their mods convert (§2.7).
- Every kind has a **Move**: how many tiles it may go in a turn. `move` on the unit def replaces `stride` on both
  sides. Placeholders until the balance pass, from today's gait (a step every 16 ticks, a turn 40): stride 0.5 → 1
  (Iron Golem, Thorn Dryad), 0.75 → 2 (Tomb Knight, Frost Wyrm, Rot Bloat, Bone Colossus), 1 → 2, 1.5 → 3 (Frost
  Sprite, Mantis Reaper, Pyre Hound); flyers 3; the Monarch 0. A 2×2 piece moves as one. `move` is a stat path, so
  tiers, auras and statuses may add to it.
- **Your pieces move freely** over open ground: walls block, a step never squeezes diagonally past a wall's corner
  (`steps` in `src/sim/unit.js`), through your own pieces but never through a foe, never ending on a held tile.
  A flyer of yours goes over walls and over anyone, and shares a tile with a ground unit as today (`battle.sky`).
- **Foes move along their road only** (§2.9): a ground foe the arrows, a flyer the air road. Their choice is how far,
  from nothing to their Move, never where. The board's arrows are the truth of where a foe can be.

### 2.3 A round

1. **Your turn.** Give orders in any order you like (§2.4), then **End Turn**.
2. **The untouched act** (§2.5): every piece of yours that was given no act this turn strikes or mends by the old AI.
3. **The foes' turn** (§2.9): the camp reads its pressure and its danger map, and each foe moves and acts.
4. **The turn ends**: statuses tick (§2.8), cooldowns fall by one, a wave enters if its turn has come (§2.10), the
   clock advances, the battle is checked for its end.

The run's `fight` action opens the battle (`phase: 'battle'`), and the orders go into the run's log like any
action: `replay(seed, log)` plays the battle back exactly, order by order.

### 2.4 Your turn

- Each piece may **move**, up to its Move, then **act** once: its basic blow, a skill off cooldown, a heal, or Fuse.
  **Move then act, never act then move**: where a piece strikes from is where it stands for the foes' turn.
- A move may be **undone** until the piece acts (nothing hidden is revealed by a move; the sim is deterministic).
- **A blow shows its damage before you commit**: the exact number (§2.6) on the target, and the counter it would
  take (§2.6) on the attacker. Nothing of the foes' own turn is shown (§7).
- **Arise is a skill of the piece that holds the relic** (§2.15; this replaced "the Monarch's act" the same
  night): one corpse within its reach rises, of a tier the relic allows, chosen by the player. The Monarch holds no
  relic, never strikes and never raises.
- **Fuse in battle.** A piece with every part of one of its recipes standing within a tile of it (footprints
  counted) may fuse as its act: the run pays `fuseCost` from the purse as it stood when the battle began, the parts
  are consumed where they stand, and the result stands on the fuser's anchor at full HP with fresh cooldowns, its
  kind's tiers and level as `DESIGN.md` §2.6 gives them. A 2×2 result needs its footprint free once the parts' tiles
  are counted free; a recipe that would not fit is not lit. Synergies are read again as it rises. The out-of-battle
  fuse is unchanged.
- **Summons and shadows take no orders**: they act as the untouched do, every turn.

### 2.5 End Turn: the untouched

A piece of yours given no act this turn runs the old `chooseAction` with its **basic blow or its basic heal
only**, from where it stands: a strikable foe in reach → the basic blow at the old target rule (the foe furthest
along its road, ties by lane); else an ally it can mend → the heal (`helps`); else nothing. **Skills are the player's
alone.** A player who ends every turn without an order gets the old autobattle, with no skills: that player is
basic, and dies on floor 1.

### 2.6 Blows, reach, counters, and no dice

- **Reach is a blow's range, and nothing else.** The ring is gone: a piece's reach is the union of its blows'
  ranges, a ranged blow its `range`, a melee blow its own `range` where it has one, else the kind's arm (1, or 2 for
  Grave Ghoul and Mantis Reaper). The tiers that grew a ring grow a range. Melee from the ground never strikes a
  flyer; a flyer's melee strikes a flyer.
- **Reach is symmetric.** A piece, yours or a foe, strikes anything in its reach from where it stands after its
  move. `DESIGN.md` §2.3's "a foe has no melee reach" and the retaliation rule are gone; so are `holdOf`,
  `sighted`, `armed`, `closeIn`'s foe half, `wayOf`, the `walking` flag, `ringOf` and the stop line, which existed
  to decide when a walker halts. The danger map (§2.9) decides that now.
- **Counters.** A melee blow whose target survives, and stands within the target's own arm of the attacker, is
  answered at once by the target's basic melee blow, both sides alike. A ranged blow is never countered; a piece
  struck in melee counters only if its basic blow is melee (a Frost Sprite does not). One counter a blow; a Hexed
  piece (§2.8) does not counter; a counter never counters.
- **Deterministic** (§2.16: no dice at all, the path deleted). Every blow hits, none crits, damage is the mean of
  what `computeDamage` gives today. ACC, EVA and CRT leave the stat block and
  the cards; the content pass converts their mods: an EVA mod → DEF of the same percent (Veiled +20 EVA → +20% DEF;
  the Will-o'-Wisp's 22 → DEF; Fae 2's step goes with the stat steps, §2.13), an ACC or CRT mod → ATK or damage
  dealt of the same percent, Deadeye (Ranger 8) → ranged blows of yours deal 50% more. Placeholders.
- Target rules for the untouched read the road: a foe's progress is its road distance to the Monarch (a flyer's on
  the air road), as today.

### 2.7 Skills and cooldowns

The gauge is gone (`TUNING.gauge`, `castCost`, `spd` as a tempo, `cheapest`, `costliest`, banking).

- **Every kind has a basic blow** (its cheapest blow today) and, most kinds, a basic heal; both usable every turn. A
  tier that replaces a basic (Shatter Lance for Frost Lance, Spanner for Strike) replaces a basic with a basic.
- **Every other ability is a skill, and every skill rests a turn: cooldown 2.** Used, it waits the next turn. No
  number on any card: "a skill, then a turn's rest". The balance pass may grant an exception (`cooldown` on the
  ability def, 2 where absent; Grave Tide may read 3), and the text says it only then.
- **Conditions on skills go** where they only gated the old AI (`when` and `cond` on Mend, Purge, Barkskin, Dirge,
  Deep Winter, Gear Lock and the like): your skills are yours to time, and a foe's are scored (§2.9). A condition
  that *is* the rule stays (Killing Cold's "once a foe is below half HP" is an execute).
- **Gauge in the content converts by this table** (21 draining blows, 11 "+gauge rate" tiers, 12 auras, three
  relics, four statuses, Insect 2):

| Today | Now |
|---|---|
| A blow drains 20–25 gauge (Frost Lance, Shatter Lance, Glacial Breath, Blizzard, Glacier Lance, Rimefire, Rimestorm) | The drain goes; the blow keeps its damage. |
| A blow drains 30–40 (Quake, Hoarfrost, Spanner, Earthshatter, Deep Winter, Worldbreaker, Ice Age, Piston Slam, Bone Quake, Equinox, Kindled Lance, Steam Hammer) | Leaves it **Hexed** (§2.8). |
| "Empties the gauge" (Wrench the Works, Gear Lock) | Hexed for 2 turns. |
| +10–15% gauge rate (11 tiers, Dirgemaster I among them), an aura of it (12 auras), Insect 2's +6% | **+1 Move** (self; an aura's, the allies in it). |
| Hasten, Enraged's and Desperate's gauge share | +1 Move, and cooldowns fall by 2 a turn. |
| Hexed (−30% gauge rate) | The one status of its kind: loses its next act, does not counter. |
| Hourglass (Arise gains gauge when the Monarch is struck) | Arise's reach +1. |
| Bone Idol (Arise gains gauge when one of yours falls) | Arise's tier +1. |
| Arcane Focus (the killer gains 40 gauge) | The killer's cooldowns fall by 1. |

The effect op `cooldown` (an amount, to self or the target) replaces `gauge`; a drain that Hexes is
`apply_status: hexed`. A `move` stat path takes the Move mods. The gauge bar on a sprite becomes a cooldown pip on
its skill.

### 2.8 Statuses in turns

A status lasts **turns**, not ticks (`turns` on the status def replaces `dur`): today's `dur` ÷ 40, half down,
so 80–100 → 2, 120–140 → 3, 160–180 → 4, 200 → 5, 620 and 760 and `'battle'` → the battle. A damage-over-time
ticks once a turn, at the turn's end, for twice its per-second power (a turn is two seconds): Burning 12 a stack,
Bleeding 8, Regen 48. Stacks and cleansing as now. Brittle, Withered, Barkskin, Veiled (as DEF), Shield, Enraged,
Desperate keep their mods; **Hexed** is "loses its next act and does not counter until then", a debuff Purge and
Molt cleanse, the one disabling status in the game; it always costs an act, even laid by a counter on a foe that has
already acted (it lasts until its next act is lost). A status laid on a piece's turn counts that turn as its first.
Every status carries a `colour`; the engine draws a generic pall in it unless a bespoke effect exists (§2.13).

### 2.9 The enemy: one opponent

The camp plays its side as one player would. Every foe turn:

**1. Pressure (the side).** One number, `press`, from 0 to 1: it rises with the clock (0 at the first turn, 1 at
the cap, §2.10) and is nudged by strength (up when the camp's foes could deal more to your pieces in reach than yours
to them, down when less; `TUNING.policy.press`, placeholders). Low, the camp holds at the edge of your reach and
shoots what it can; high, it comes in and trades; at 1 the Monarch is every foe's prey. The opponent gets impatient,
not stronger. The player sees the horde stop at their rings and wait, then come. `press` in `src/sim/policy.js`.

**2. Danger map (the side).** For every tile, how much damage your side could deal to a foe standing there on your
next turn: each of your pieces, from every tile its Move reaches, its best blow against that foe (DEF counted), summed
over your pieces (`danger` in `policy.js`; computed once a foe turn, 77 tiles by at most a dozen pieces). Drawn in
prep as the one coverage overlay (§4): "it will not walk into my reach unless it can win the trade" is read off the
board. The expert reads the same map the other way.

**3. Scoring (the unit).** In road order (nearest the Monarch first, ties by lane then uid), each foe enumerates its
options: a position (its road tile 0 to Move steps ahead, stopping at the first held tile: a comrade that stopped
ahead of it blocks it, as walkers queue today), then from there an act (its basic blow at each piece in reach, each
skill off cooldown at each target it may take, a heal or cleanse at each ally `helps` allows, or hold). One function
scores every option:

```
score = dealt × (the target is its prey ? 1.5 : 1)
      − caution × (1 − press) × taken          taken: danger[position] + the counter the act draws
      + aggression × (1 + press) × gained      gained: road distance gained + the kill's worth, if the blow kills
```

`dealt` counts HP mended as dealt for a heal; a kill's worth is the piece's max HP, the Monarch's the battle; a Shape
blow's `dealt` is the sum over what its shape covers. The best option is committed and the next foe scores against the
board as it now stands. Ties: more road gained, the lower lane, the lower uid. No seed is read: the same board gives
the same turn, every time, so the expert can play the foe turn ahead of its own, and a player who has learnt a kind
can too. Focus fire, kill-finishing, kiting, screening and the queue all emerge from the scoring; none is a rule.

**4. Temperament (the kind).** Three values on the unit def, `temper: { aggression, caution, prey }`; `prey` one of
`weakest` (lowest HP), `wounded` (lowest share of HP), `unarmoured` (lowest DEF), `monarch`, `crowd` (where its shape
covers the most), `rested` (the most skills off cooldown). The presets, and the kinds that start on them:

| Preset | aggression | caution | prey | Kinds |
|---|---|---|---|---|
| Charger | 1.5 | 0.3 | weakest | Tomb Knight, Pyre Hound, Rot Bloat; Grave Ghoul `unarmoured` ("where the armour is thinnest") |
| Shooter | 0.5 | 1.5 | weakest | Frost Sprite, Bone Chanter, Barrow Wight; Frost Wyrm at aggression 0, caution 2.5 ("makes the field come to it") |
| Seeker | 1 | 0.8 | monarch | Will-o'-Wisp, Hive Drone, Ash Wyvern |
| Keeper | 0 | 1.5 | weakest | Hive Warden, Clockwork Page, Thorn Dryad (they mend first, by `dealt`; caution keeps them behind) |
| Sieger | 1.5 | 0 | monarch | Iron Golem |
| Stalker | 1.5 | 0.8 | wounded | Mantis Reaper |
| Hexer | 0.5 | 1.5 | rested | Marsh Hag |
| Crowd | 1 | 1 | crowd | Ember Drake |
| Court | 1 | 0.5 | weakest | Hollow Sovereign; phases by HP as now, a scripted override on top (§2.9.6) |

A new kind is a row, not code. **The bestiary's way line is generated from the three values** (`temperLine`: "bold,
heedless; hunts the weakest" / "wary, keeps its distance; hunts the one that cannot answer"), so it can never say
what the kind does not do; the flavour text keeps hinting, and the line appears once the kind is met, as the ways
do today (§7).

**5. Entry.** Waves enter as they do today, on the lanes the room draws. (Reactive entry was proposed and cut: a
rule the board could not show.)

**6. Bosses.** The Sovereign keeps its phases and crumbling; a boss may carry a scripted override on top of its
temperament (a fixed cadence for Grave Tide, the court moving first), as a rule in the registry (§2.13). Not in the
slice.

Walk and Fly stay as **how a kind moves** (the road, the air road); the way line says **how it thinks**.

### 2.10 Waves and the clock

- **Waves enter on fixed turns**, shown on the wave counter ("wave 2 on turn 5"): `TUNING.spawn.waves.every`
  turns apart (placeholder 4), the first at turn 1. The `share` and `t` triggers go. Sieges are three waves with no
  prep between them. The clock is time, not behaviour, so showing it breaks no rule (§7).
- **The clock counts turns**, from the last wave's entry: `TUNING.turn = { cap: 20 }` replaces `tick.ceiling` and
  the whole of `escalation`. There is no damage ramp: the pressure (§2.9.1) rises to 1 at the cap, and a battle
  undecided at the cap is lost. One clock bar, always visible.
- Won when no foe stands and no wave is left; lost when the Monarch falls or the cap is reached. A boss's fall
  crumbles its side. Defeat ends the run.

### 2.11 Growth: the Shop

- **Relics come from Shops, and only from Shops.** The Reliquary becomes the Shop (`shop` node; `reliquary` goes
  from `src/sim/map.js`, `walk` in `src/sim/run.js`, the interface, the codex, the tests), and a won elite lays out
  no relic: it pays essence (`TUNING.essence.eliteBonus` on top of its foes' pay: placeholder, a tier IV's price at
  the floor's scale) and offers its recruit, as any fight does. `relicOffers`, `legendaryOffers`, `offerGroup` and
  the elite's one-of-each go.
- **A Shop stocks `TUNING.shop.relics` (4) relics**, drawn by tier as the reliquary's were (`relic.weights.shop`),
  **one of them always a Command relic** (what the elites' guarantee was, so army size is never luck), and from
  floor 2 one a Legendary (`relic.legendary`, the `needsArise` rule as now). **Every relic has a price** and you
  buy any number: `TUNING.shop.price[tier]` (Common 36, Uncommon 60, Rare 96, Legendary 144: a tier II, III, IV and
  one and a half; placeholders) × the floor's price scale (`floorPrice`), after the discount relics. Copies stack,
  no cap, as now; a bought relic may be stocked again later. Nothing else is sold: tiers are bought on the field at
  any time. Leaving is free.
- **Shops are common**: `MID_WEIGHTS` reliquary 2 → shop 3, `RARE` 3 → 4, `LATE_WEIGHTS` 0.5 → 1, so an average
  walk meets about 2.5 shops a floor (it met 1.1 reliquaries and 2.3 relic-paying elites).
- Essence buys tiers, recruits, fusions and relics. Prices stay floor-scaled and money keeps mattering: a relic
  taken is a tier not taken.
- Recruits, tiers, fusions, levels, Command and the relics' own rules: `DESIGN.md` §2.5–2.6, unchanged but as
  §2.13 restates their form. Two-part recipes and new fused kinds are a later content step (§5).

### 2.12 Synergies: rules only

The stat steps go (`DESIGN.md` §2.7's 2/4/6/8 with +DEF, +ATK, +EVA and the rest: the ladder the balance passes
had to double to see at all). **Each kin and each role has one rule, at 4 pieces** (a piece counting once, a
shadow and a summon as now): the rules that stood at 8 (Legion, Dragonfire, Deadeye, Echo, Sanctuary, Ambush,
Bodyguard, Mirage, Last Stand, Frenzy, Deathblow and the others) move to 4. Where a rule proves too strong at 4 the
balance pass may split it (a lesser form at 4, the full at 8); that is the only step. Synergy glow on the board as
now. Foes' cohorts count too, **on every floor** (the user, 2026-10-10 night: the deep-floor gate went with the
stat steps it guarded).

### 2.13 Content is data

The rule for every piece of content, enforced by `test/content.test.js`: **content is records composed from a small
vocabulary, and code grows only when the vocabulary grows.** Three forms and one registry:

1. **A unit is one record**: its def with `base` (HP, ATK, DEF, Move), `kin`, `role`, `size`, `flies`, `arm`,
   `abilities`, `tracks` (folded into the def from `TRACKS`), `temper`, `threat`, `flavour`, `spawn`, `onFall`,
   `fused`; its three pictures by the convention `src/assets/units/<id>.alive|attack|dead.svg`, or `art: '<id>'`
   naming another kind's pictures to borrow until its own are drawn (a fused kind plays before it is painted). The
   only kind the code names is `monarch`; `START_PARTY` in `src/sim/run.js` names the three start souls, and the
   autoplayer's `FILLER` is derived from the floor-1 pool, not written.
2. **An ability is ops, a shape, an anim**: `effects` from the op vocabulary (`damage`, `heal`, `cleanse`,
   `apply_status`, `raise`, `cooldown`), a `shape` (single, blast, column, row, all, corpse), `range` or `melee`,
   `anim` (cast_beam, melee_lunge, ranged_bolt) and `tint`, `cooldown` only where not 2. The policy scores it
   generically (damage, HP mended, a status's worth from `STATUS_WORTH`); the engine draws it by its anim. A new op
   is a sim change with its own test; a new anim an engine change; nothing else is code.
3. **A relic is `mods`, or `on` + `effects`, or `rule`.** The sixteen bespoke keys today (`command`, `monarchHp`,
   `roster`, `recruitDiscount`, `tierDiscount`, `lowTierDiscount`, `soulTiers`, `essence`, `arise`, `raises`,
   `domain`, `tithe`, `rise`, `alias`, `reap`, `unhealable`) collapse: Command, the Monarch's HP, the roster, the
   discounts and essence gain become `mods` on run-level stat paths (`run.command`, `run.monarchHp`, `run.roster`,
   `price.tier`, `price.lowTier`, `price.recruit`, `essence.gain`), read by the same `modsFor` that reads a unit's;
   Arise and its growth, Undying, Mimicry, Hollow Court, Blood Tithe, Court of Bone, Soul Lantern become `rule`
   entries with `params`. **A Common, Uncommon or Rare relic never has a `rule`**; only a Legendary may.
4. **One registry for rules**, `src/sim/rules.js`: `RULES = { legion: { onFall }, dragonfire: { onBlow },
   sanctuary: { targets }, arise: { onTurn, params }, … }`, each rule its hooks in one place, used by synergies,
   Legendaries and boss overrides alike. The thirteen `has('…')` branches scattered through `src/sim/battle.js`
   become hook calls at fixed points in `turns.js` (`onBlow`, `onStruck`, `onFall`, `onKill`, `onTurn`, `onWave`,
   `targets`, `modify`). A new rule is one entry in one file.

The test is the checklist. A kind fails until it has two tracks of four, a Move, a temper, a threat, pictures or an
`art`, and every ability resolves; an ability fails if its op, shape or anim is not in the vocabulary; a relic fails
if its tier and form do not match, or names a rule the registry lacks; the registry fails if a rule is used by
nothing; a recipe fails if its result is not a fused kind. "Add a unit" means "make the test pass":

| Add | Touches |
|---|---|
| a unit | one record, 3 SVGs (or `art`), `--combos` |
| an ability | one record, if it composes existing ops, shapes and anims |
| a relic (Common–Rare) | one record |
| a Legendary with a new rule | one record + one registry entry |
| a merge | one recipe line + one unit record |
| a temperament | three values on the unit |

### 2.14 Cut

The gauge and everything that read it; `stride` on both sides; `tick`, `stepTicks`, the tick ceiling and the whole
of `escalation`; the ring, `ringOf`, the ring tiers (now range), the coverage and ring overlays and the stop line;
`holdOf`, `sighted`, `armed`, `wayOf`, the `walking` flag, QUEUE/STUCK/HALT; the foe melee reach rule and
retaliation; `settled` (a rehearsal ends at the cap); hit, crit and variance from the default path (kept behind
`TUNING.dice`) and ACC, EVA, CRT as stats; the synergies' stat steps; the AI-gating `when` conditions; the
Reliquary; the elites' relic offers; Arise's raise cap, cooldown and haste; the waves' `share` and `t`; the sixteen
relic keys and `TRACKS` as a table apart from the units. Never born: Slow, Stagger, Nimble, the three postures,
reactive entry, the Shop's tiers.

Vocabulary after it: Piece, Summon, Road, Wave, Shadow, Essence, Tier, Fusion, Synergy, Relic (Common, Uncommon,
Rare, Legendary), Command, **Turn, Move, Skill, Cooldown, Counter, Shop**. Seventeen, plus the ways (Walk, Fly), the
statuses, and the bestiary's way line. Ring and Gauge leave.

### 2.15 Held relics and Arise (2026-10-10, night)

The user's word: "make arise a relic you can use to upgrade a unit (units can hold at most 1 relic (tunable))", and
of the options, piece relics held, run relics not; Arise a skill that rests.

- **A relic is a run relic or a piece relic.** A run relic touches the run or the whole side: `mods` on the run's
  paths only (`run.command`, `run.monarchHp`, `run.roster`, `price.*`, `essence.gain`, `arise.domain`,
  `arise.tier`), plus a side-wide cost where it has one (Legion's −15% HP). It works unheld, as relics did, and its
  copies stack without cap. **Every other relic is a piece relic** and works only through the piece holding it: its
  `mods` are the holder's, its `on` triggers fire on the holder's events (`kill` when the holder slays, `struck`
  when it is struck, `fall` when it falls, `blow` when it strikes, `wave` on each wave while it stands), a
  Legendary's `rule` is scoped to the holder. The content test holds the form: a run relic names only run paths, a
  piece relic none.
- **A piece holds at most `TUNING.relic.perPiece` relics (1).** Bought piece relics wait unheld (the Relics strip
  beside the ossuary) until given. **Give, take back and swap freely out of battle** (prep, a Shop, the spoils),
  never in battle: actions `{ type: 'hold', relic, uid }` and `{ type: 'unhold', uid }`. A held relic stays with
  its soul in the ossuary and works only on the field. It comes back unheld when its holder is released or fused
  away; a fallen holder keeps it. Copies of a piece relic stack only across holders, one each.
- **Arise**, a Legendary piece relic: its holder gains the skill **Arise**: one corpse within `TUNING.arise.domain`
  tiles of the holder, of tier ≤ `TUNING.arise.tier`, rises as a shadow of yours, the player's choice among those
  that qualify; a skill, so a turn's rest. More copies are more raisers; `arise.more` goes. Hourglass and Bone Idol
  are run relics on `arise.domain` and `arise.tier`, every raiser's. The other Arise Legendaries are **Arise
  variants**, each a piece relic that grants Arise with its rule on top: Court of Bone (2 tiles farther; nothing
  heals the Monarch), Hollow Court (the shadows its holder raised that stand at a win pay their essence again),
  Blood Tithe (as its rule today, scoped to the holder). `needsArise` reads "once an Arise relic is owned".
- The other Legendaries scope to the holder: Undying (the holder rises once a battle at 60% HP), Mimicry (the
  holder counts as a Warden too, for synergies). One a piece: a Legendary's copies are more holders.
- **Interface**: a relic slot on every piece's card and panel; tap an unheld relic, then a piece (or the slot) to
  give it; the card's relic shows on the sprite as a small mark. A relic card says Held or Run.

### 2.16 No dice (2026-10-10, night)

The user's word: "remove dice rolls as much as possible". **The battle reads no random number.** Deleted:
`TUNING.dice` and the dice path (`hitChance`, `critChance`, `rollVariance`, `TUNING.hit`, `crit`, `variance`, the
battle's rng), ACC, EVA and CRT from every stat block, and **every status `chance`**: a status an effect lays always
lands (the hidden cadence goes); where a chance kept a status rare, the balance pass lowers its turns or the blow's
power. Deathblow (a sure crit) becomes an execute: a blow of yours on a foe below a quarter of its HP deals double
(placeholder). The run's draws (the map, the rooms, the recruits, the Shop's stock) stay seeded: they are the run,
not a roll. This reverses §2.6's "kept behind the switch" and closes §6's open question on dice.

## 3. What the player may rely on

1. **A turn is yours.** Every piece may move its Move and act once, move first. A blow's damage, and the counter it
   would draw, are shown before you commit. A move can be undone until the piece acts.
2. **What you leave alone fights anyway**, with its basic blow or heal, never a skill. **Every skill rests a turn.**
3. **Foes keep to the roads.** A ground foe is always on the arrows, a flyer on the air road; how far it comes each
   turn is its choice, where it goes is the board's. Your pieces block either; the dead never do.
4. **A foe strikes what it can reach, as you do**, and counters as you do. Which piece it chooses, and whether it
   comes into your reach at all, is the camp's judgement: it is learnt by meeting the kinds, and the bestiary keeps
   a line on each once met. Nothing of the foes' coming turn is drawn.
5. **No dice.** The same board, the same orders, the same battle.
6. **The clock is shown and the camp knows it**: the waves' turns are on the counter, and a horde that waits at the
   edge of your reach comes as the clock runs down. It never hits harder; it only stops waiting.
7. **Shops sell relics**, as many as you can pay for, and nothing else sells them. The fallen leave the field, wounds
   carry, essence binds, as `DESIGN.md` §3 has them.

## 4. Interface

The standing rules hold: one scaled landscape layout, one view at a time behind tabs, nothing that needs hover,
Shift or a key; the board on its side, BTD-sized, a tile never under 44 CSS px on a phone.

- **Prep** is unchanged in its gestures: drag to place, swap by footprint, the kind's panel, Fuse. **One overlay
  replaces three**: the danger map (§2.9.2), the damage your side could deal on each road tile, shaded; the rings,
  coverage and stop-line overlays go. The roads, Arise's reach and synergy glow stay.
- **Battle, your turn.** Tap a piece: its Move range lights (reachable tiles), its targets in reach glow, its panel
  shows its basic blow and its skills with a cooldown pip. Tap a tile to move (the sprite walks; the move is undoable:
  an Undo button and tapping the piece's old tile). Tap a target: the damage number and the counter number appear
  on the two sprites; tap again to commit (a second tap is the commit everywhere, so a phone never strikes by
  accident). A skill button then a target, the same. Fuse lights on a piece when a recipe's parts stand beside it.
  The Monarch's panel is Arise's, when held: tap a corpse in reach, once a turn. **End Turn** sits in the side panel,
  always. Input is locked while an order's events play back.
- **Battle, the foes' turn.** The camp's turn plays back as the old battle did: the `TimelinePlayer` in
  `src/engine.js` keeps its queue, hit-stop, speed and skip; events carry a beat index rather than a tick. At
  speed 4 only `ESSENTIAL` ops play, as now. The pressure is never shown; the player reads it from where the horde
  stops.
- **Counts on the board**: the turn, the clock bar by turns, the wave counter with the next wave's turn; Hexed as the
  violet pall it is today; every other status a pall in its `colour`; a cooldown pip on a sprite's skill icon.
- **The Shop**: the offer panel with a price on each relic and the purse in the bar; buy lights what can be paid for;
  a Leave button. A won elite's panel: its essence and its recruit.
- **Codex**: the glossary's seventeen words; the bestiary's way line per kind once met, generated; the help page
  rewritten for turns; Gauge and Ring gone from every tooltip; the Fusions page as now.
- **End**: the death panel's facts as a replay beat, as now.
- **Tabs**: Field · Map · Codex, as now.

## 5. Implementation

One working tree, no branches: the slice lives behind `TUNING.turns` (false: today's battle; true: turns), so
`npm test` stays green throughout and the two can be played side by side in the browser. The flag and
`src/sim/battle.js` go when the full conversion lands. Each area is owned by one agent, at most two at once; tests
check function, not balance; no tuning, no ladder loops, until the balance pass at the end.

### Shared contract

`src/sim/turns.js` (the battle agent):

- `createBattle(setup)` → the battle, shaped as `battle.js`'s is (`units`, `at`, `sky`, `events`, `relics`,
  `domain`, `waves`, `winner`, `over`), plus `turn` (1-based), `phase` (`'orders'` | `'resolving'`), and on each
  unit `move`, `moved` (tiles spent this turn), `acted`, `cooldowns` (ability id → turns), `temper`.
- `legalOrders(battle)` → every order the player may give now: `{ type: 'move', uid, tile }`, `{ type: 'act', uid,
  ability, target }` (`target`: a unit uid, a tile for a shaped blow, a corpse for Arise), `{ type: 'fuse', id,
  parts }`, `{ type: 'undo', uid }`, `{ type: 'end' }`.
- `order(battle, o)` applies one and returns its events; `end` runs §2.3's steps 2–4 and returns theirs. Throws on
  an illegal order.
- `preview(battle, uid, ability, target)` → `{ damage, counter }` for the interface, from the same code that deals it.
- `playOut(battle, policy)` → the battle played to its end with `policy(battle)` giving each of your turns' orders
  (the autoplayer's rehearsals).
- Kept from `battle.js`, moved or re-exported: the effect system (`runEffect`, `applyDamage`, `heal`, `fall`,
  `burst`, `crumble`, `raise`, `summon`, `addStatus`), `stats`/`modsFor`, `synergiesOf`, `trigger`, `field`/`airOf`,
  `enter`/`entryTile`/`reinforce`, `phases`, `helps`/`pickTarget` for the untouched, footprint occupancy.
  `computeDamage` with `TUNING.dice` honoured. The rule hooks (`onBlow`, `onStruck`, `onFall`, `onKill`, `onTurn`,
  `onWave`, `targets`, `modify`) called at their fixed points.

`src/sim/policy.js` (the battle agent): the one policy, both sides.

- `danger(battle, side)` → damage by tile the other side could deal next turn.
- `press(battle)` → 0 to 1.
- `options(battle, u)` → the unit's positions and acts; `score(battle, u, option, temper, press)`.
- `foeTurn(battle)` → the orders, applied in road order, their events; deterministic.
- `expertTurn(battle)` → your side's orders by the same enumerate-score-commit, scored for your side (dealt, kills,
  danger to your pieces from a one-ply foe turn played ahead on the candidate board, the Monarch's exposure, wounds
  that carry), pieces in the order most constrained first; `basicTurn(battle)` → `[{ type: 'end' }]`.

`src/sim/rules.js` (the battle agent): `RULES`, the registry of §2.13.4; `rulesOf(battle, side)` → the rules the
side's synergies, relics and overrides bring, each hook called with the battle.

`src/content.js` (the content agent): §2.13's forms. On unit defs `move`, `temper`, `tracks`, `art`; abilities
without `castCost` and `when` (but the rule conditions), `cooldown` only where not 2; the effect op `cooldown`;
statuses with `turns` and `colour`; relics in the three forms; synergies as one rule each at 4; `TEMPERS` the presets
by name, `temperLine(temper)` the generated way line, `STATUS_WORTH`; `BEHAVIOURS` keeps walk and fly; `TRACKS`
gone as a table (a `tracksOf(id)` reads the def).

`src/tuning.js`: `turns` (the slice flag), `turn: { cap }`, `dice: false`, `move` (the placeholder table),
`policy: { press }`, `shop`, `arise: { domain, tier, more }`, `spawn.waves.every`, `essence.eliteBonus`;
`gauge`, `tick`, `escalation`, `board.stepTicks`, `arise.raises/hp/haste`, `relic.offer`, `relic.weights.elite`
go with the conversion.

`src/sim/run.js` (the run agent, which is the battle agent in the slice): `fight` sets `phase: 'battle'` and
`run.battle`; `apply` routes `move`, `act`, `fuse`, `undo`, `end` to `order`; `legalActions` in the battle phase is
`legalOrders`; `finishBattle` when `battle.over`; the `shop` node and its `buy` action (`{ type: 'buy', index }`,
`{ type: 'leave' }`); the elite's essence; `fuseCost` in battle; run-level mods (`commandOf`, `monarchHp`,
`rosterCap`, the prices and essence gain through `modsFor`); `frontier` unchanged.

`src/sim/map.js`: `shop` for `reliquary`, the weights of §2.11.

### Step 1. This document

Done when `redesign.md` is written. `DESIGN.md` carries a note at its head pointing here; its §6 history stands.

### Step 2. The slice: floor 1 on turns (two agents)

Behind `TUNING.turns`. Floor 1 only: the three start kinds (Tomb Knight, Bone Chanter, Frost Sprite) and the
floor-1 pool (Hive Warden, Clockwork Page, Grave Ghoul, Will-o'-Wisp, Pyre Hound with those three) converted by
§2.7–2.8, their temperaments by §2.9, the floor-1 elite's late pair with them. Everything of floors 2–4 keeps its
old numbers and is not played on turns. The content model (§2.13) is applied to these eight kinds and to the relics
the slice can meet; the rest waits for Step 4.

- **Agent A, the sim** (`src/sim/turns.js`, `src/sim/policy.js`, `src/sim/rules.js`, `src/sim/run.js`,
  `src/sim/map.js`, `src/content.js`'s floor-1 kinds and the Shop's relics, `src/tuning.js`; `test/turns.test.js`,
  `test/policy.test.js`, `test/run.test.js`, `test/map.test.js`, `test/content.test.js`): the round, orders, undo,
  counters, cooldown 2, Hexed's rule, statuses in turns, the untouched, Arise's act, Fuse in battle, the danger map,
  the pressure, scoring, temperaments, waves on turns, the clock in turns; the run's battle phase and log; the Shop
  and the elite's essence; the rules registry with the rules the slice meets; `basicTurn`; the content test's new
  checks. Tests: a move refused through a foe, a wall and a corner, and allowed through an ally; undo restores;
  move-then-act only; a counter both ways, none on ranged, none from a Hexed piece; a skill rests a turn and is back;
  End Turn acts the untouched with basics only; the same board gives the same foe turn; a foe at low pressure stops
  outside the danger map and at high pressure enters it; the pressure reaches 1 at the cap; a wave enters on its
  turn and the counter says so; Arise raises one a turn, the player's choice; Fuse in battle consumes, pays, places,
  refuses where a 2×2 cannot fit; the Shop prices scale, always stocks a Command relic, refuses an empty purse; an
  elite pays and lays out no relic; `replay` equality over a logged battle; the fuzz over orders; `TUNING.dice` true
  still runs; the content test holds the eight kinds to §2.13.
- **Agent B, the interface** (`src/engine.js`, `src/ui.js`, `src/board.js`, `src/codex.js`, `src/keywords.js`,
  `src/main.js`, `src/css/*`, `src/style.css`): §4 for the slice: the order input mode, Move range, targets, the
  two-tap commit with damage and counter numbers, Undo, End Turn, skill buttons with a pip, the foes' turn played
  back with speed and skip, the turn, the clock bar and the wave counter, the danger-map overlay in prep, the Shop
  panel, the elite's panel, the generated way line in the bestiary, the generic status pall, the help for turns.
  Done when `node --check` passes on every module and floor 1 plays in Chrome at 1440×900, 1024×768 and 852×393
  with no console error, on both flag settings.

The two share nothing but the contract above. A is told the interface's needs (`preview`, `legalOrders`) and B is
told the sim's shapes; neither edits the other's files.

### Step 3. Play, then decide

Chufan plays floor 1 on turns. Go or no-go. On no-go the flag is set false and the slice stays as a record; on go,
Step 4.

### Step 4. The full conversion (two agents)

- Both agents: §2.15 (held relics, Arise a held skill) and §2.16 (no dice), split as the rest is: the records and
  the content test to Content; `hold`/`unhold`, holder-scoped mods and triggers, Arise as a skill and the dice
  deletion to Sim. The interface for §2.15 and the dice's last words (ACC/EVA/CRT on cards) follow in an interface
  pass after the two, with the old battle's playback and `src/flag.js` removed there.
- **Content**: every kind to §2.13's record (`tracks` folded in, `art` where it borrows), every ability by §2.7 (the
  gauge table, cooldown 2, the `when` cut), every status by §2.8, every relic to one of the three forms, every
  synergy to one rule at 4, the stat steps gone, ACC/EVA/CRT and their mods converted, `move` and `temper` on every
  kind, the fused kinds included; the Sovereign's override; waves on turns for every floor; the glossary; every
  card's text. `test/content.test.js` holds all of it.
- **Sim**: `src/sim/battle.js` and `TUNING.turns` deleted, `turns.js` the battle; the rules registry complete and
  the thirteen `has('…')` branches gone; the run-level mods; floors 2–4's rooms, sieges, boss phases, crumbling and
  the Legendaries on turns; the ~150 test call sites that step or run a battle (`test/battle.test.js` 63,
  `test/enemy.test.js` 22, `test/relics.test.js` 12, `test/endless.test.js` 11, `test/fixes.test.js` 9,
  `test/speed.test.js`, `test/tracks.test.js`, `test/movement.test.js`) re-harnessed as "play N turns under basic"
  with their assertions kept; `test/battle.test.js` becomes `test/turns.test.js`.

### Step 5. The autoplayer (one agent)

`src/sim/autoplay.js`: `rehearse` fights with `playOut(battle, policy)` at the level's turn policy (`expertTurn`,
`basicTurn`); the memo's digest takes the policy level; `plan`, `drafts`, `frontier` and the formation search stand;
`threatOf`, `gateOf` and `roadsTo` read the danger map and a played-ahead foe turn instead of guessing a walker's
halt; `FILLER` derived from the pool; `pickReap`/`weighOffers` become the Shop's buying (a relic's `comboWorth` per
essence against the tiers it displaces, in `grow`); the combo book regenerated (`--combos`). Ablations: `orders`
joins the core three (the expert ends every turn without an order: what in-battle play is worth, 25–50 points),
`fusions` stays, `relics` is "buys no Common–Rare relic" and `legendaries` "buys no Legendary". `test/planning.test.js`,
`test/ablation.test.js`, the autoplayer tests of `test/run.test.js`.

### Step 6. Clean, then two bug hunts

The code-cleaning pass; then a bug hunt (places the code breaks its own rules: counters that counter, a Hexed
piece acting, a foe off its road, a 2×2 fused onto a held tile, undo after an act, a Shop price unscaled, a skill
back a turn early, a relic with a key the registry does not know); then a second. No number moves.

### Step 7. Balance

The single pass, as `DESIGN.md` §5 Step 8 ran them, with the policy among its subjects: the expert ~90%, basic dead
on floor 1 three runs in four, money binding on every floor, every ablation in its band (`orders` now core), the
Shop's prices and frequency, the elite's essence, Move, the pressure's curve, the temperaments, the synergy rules
at 4, any cooldown exception. About 30 placeholders, where the first draft of this plan had 60. Then the README,
this file's §6 and `DESIGN.md`'s head brought up to date, and a push to master.

### Later content, not in these steps

Two-part recipes and a recipe for every kind (five new fused kinds, three SVGs each or `art` until drawn, two
tracks each); a one-tile sidestep off the road ("may stand beside its road", drawn); the camp spending (an elite
that holds relics).

## 6. Decisions taken, and open

Taken on 2026-10-10, after the audit:

- **Turn-based combat, reversing "your pieces never move" and the no-orders rule.** The user's word: "yes reverse".
  Into the Breach's shape on the existing board, not Polytopia's (no cities, no tech: the run map, essence and
  tracks do those jobs).
- **Deterministic blows**, "but leave open": `TUNING.dice` false by default; the dice path kept, never deleted
  without asking.
- **Shops for relics, more common** than the reliquaries were. The Reliquary becomes the Shop.
- **In-battle fusing allowed.**
- **The enemy as one opponent**: pressure, danger map, one scoring function, temperaments as data, the way line
  generated from the values. Chosen over a role per kind (eight scripts, no coordination, a second AI beside the
  expert's) after the question "how does Civ do it". The policy and the expert's turn are one module.
- Defaults the user did not overrule: move-then-act only; the untouched act with basics only; counters on both
  sides; the slice behind a flag in one working tree; bonus-goal relics dropped for the Shop.

Taken later the same day: **all the simplifications**, the user's word ("all simplifications"), and the content
model ("adding a new unit / relics / merges should be straightforward and modular"):

1. Pressure as one number, not three postures.
2. Temperament as three values (aggression, caution, prey), not five weights.
3. One disabling status, Hexed; Slow and Nimble never born; the small drains become damage.
4. Every skill cooldown 2; exceptions only by the balance pass.
5. Reactive wave entry cut.
6. Waves on fixed turns, shown.
7. No escalation damage ramp; the cap and the pressure do its work.
8. The Shop sells relics only.
9. Rings cut; reach is a blow's range.
10. One prep overlay, the danger map.
11. ACC, EVA and CRT cut as stats.
12. Arise once a turn, two numbers a copy; no raise cap, cooldown or haste.
13. The AI-gating `when` conditions cut; rule conditions kept.
14. Synergies as one rule each at 4; the stat steps cut.
15. Relics from Shops only; elites pay essence and a recruit; a Command relic in every Shop's stock.
16. Content is data: one record a unit (tracks folded in, `art` to borrow), an ability from the op vocabulary, a
    relic in one of three forms with no `rule` below Legendary, one registry of rules, the content test as the
    checklist.

Taken that night, after the slice (Step 3: "go"): **held relics** and **Arise a held skill** (§2.15); **no dice
at all** (§2.16).

Open, decided later:

- **A rule too strong at 4** may be split into a lesser form at 4 and the full at 8 by the balance pass; no other
  synergy step is to be added.
- **The sidestep**, **two-part recipes**, **the camp spending**: later content (§5).

## 7. Standing rules

Decided before this document and still in force (the project memory has the reasons):

- Enemy behaviour is discovered, never previewed: roads are terrain and are shown; the clock and the waves' turns
  are time and are shown; a kind's reach, Move and way line are learnt by meeting it, then recorded; nothing of the
  foes' coming turn is drawn.
- Defeat is absolute. No lives, no retreat.
- Floor 1 is hard, and the skill gap opens in the player's decisions: in prep and now in the turn. Never in dice.
- The dead never block the roads. Foes keep to the one drawn road; flyers the air road, blocked by your pieces.
- One soul is one piece is one body; no stacks.
- A fusion is never weaker than what went into it.
- Money always matters: essence is scarce on every floor, and a relic bought is a tier not bought.
- Balance comes once, at the end. No tuning while building. Tests are functional only until then.
- Plan first; at most two agents at once; implement → verify → clean → bug hunt → bug hunt → balance.
- One universal landscape interface, modular tabs, nothing that needs hover or a key.
- Recruit only: one slain foe a battle, as a full soul into the ossuary.
- Content is data; code grows only when the vocabulary grows.
