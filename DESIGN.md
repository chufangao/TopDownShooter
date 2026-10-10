# RETINUE: the dead hold the line

The rules redesign decided on 2026-10-09 (evening), and the plan for building it. For Chufan and for any Claude
Code session working in this repo: read this before touching `src/`. It replaces "the dead keep the plan"
(this file's morning version, commits `30f29b4` to `041093f`), whose lines, signals, lunges, Banners and timing
marks are cut here. Section 5 says what to build, who owns which files, and in what order.

## 1. Why

The morning's design let your pieces walk lines you drew. Playing it, the lines were the plan's hidden half: a
piece a few tiles from where you left it is a piece you have to predict, and predicting it is the search the
redesign set out to remove. Bloons TD 6 and Plants vs. Zombies are the bar: **your pieces never move.** Where you
put a piece is where it fights, for the whole battle. The living enemy comes down roads you can see and
improvises; your side does one legible thing each and never surprises you.

That makes prep two decisions and only two:

1. **How to upgrade**: tiers (a kind's level comes with them), fusions and recruits, bought with essence; the
   Monarch's HP and Command, and Arise's Dominion and Will, come as relics.
2. **Where to place**: which cell each piece holds, and which pieces stand together as a stack.

Placement has to be a puzzle, or the game is a shop. It is one because the roads and the Monarch's seat are the
camp's, fixed and drawn before you place anything; because a ring covers some road tiles and not others; because
Shape blows punish pieces that bunch while auras reward it; because a 2×2 piece needs four open cells and plugs a
two-wide breach alone; because flying foes come straight over the walls and only a ranged blow can touch them;
because Flank foes go round your pieces wherever a way round is open; and because Burning and Hexed punish the
piece that fights longest. Every one of those is a rule you can read on a card or on the board.

Power has to come from combos you build, or upgrading is a stat ladder. It comes from **fusions**, recipes that
consume specific souls and give one much stronger piece, usually 2×2; from **Colossus tiers**, a kind's tier IV
that grows every piece of the kind to 2×2; and from the synergies, as before. Growth changes what you command,
from a handful of souls to a wall of colossi, which is the squad-to-army scale the project has wanted all along.

The enemy scales in kind, not only in number: each floor's pool brings a new thing a foe can do (burn, fly, hex,
burst on death) on top of Walk, Flank, reach, Shape, drain, clock and waves.

Reversed here, from the morning:

- **"Static placement makes the roster turrets and the army never advances."** Turrets are the genre, and the
  army advances by growing: a 2×2 colossus, a fusion of three souls, a stack of eight. Movement bought nothing a
  BTD player wants.
- **"A lunge keeps a ring-2 melee piece honest."** A ring is a reach. A melee piece with ring 2 strikes two tiles
  away without stepping; the sprite lunges, the sim does not.

## 2. Rules

### 2.1 Board

- Tiles, 8-neighbour. Distance is the Chebyshev distance (`distance` in `src/sim/unit.js`). A step may not
  squeeze diagonally past a wall's corner (`steps`).
- The board stays `COLS` 7 wide and `DEPTH` 11 deep: the camp's 7 rows at the bottom (y 0 is the rear), a gap
  row, the foes' 3 rows at the top.
- Walls come from the camp map (`CAMP_LIST` in `src/content.js`, `'#'`). They are the enemy's track (§2.4).
- **The Monarch is pre-placed.** Each camp map marks its seat with `'M'`. It never moves, never strikes, and no
  action places it or anything on its cell (`monarchSlot(camp)` in `src/sim/unit.js`). If it falls the run is
  over. The camps are designed around the seat: it is the end of every road and the shape of the puzzle.

### 2.2 Pieces, stacks and footprints

- A **piece** is one kind on one tile (its **anchor**) with a **count**, the bodies in it, and a **size**, 1 or 2.
  Your pieces are souls from the ossuary; a foe piece is a captain and its cohort, or any group the room lists.
- A size-2 piece has a 2×2 **footprint**: its anchor, the tile in the next lane (+x), and the two ahead of those
  toward the foes (+y). `footprint(tile, size)` (a battle unit's: `footprint(u.tile, u.size)`). It stands only where
  all four are open ground in the camp with nothing else on them (`fits(camp, slot, size, taken)`). A foe piece is
  always size 1 in this pass.
- Size comes from the kind (`size` on the unit def, a fused kind's) or from a tier (`size: 2` on a tier IV, a
  **Colossus** tier): `sizeOf(u)`. When a kind takes a Colossus tier, each of its pieces that no longer fits where
  it stands goes to the ossuary until you place it again. Size is a footprint and a ring, nothing else: no stat
  comes with it that the tier's or the kind's own numbers do not say.
- Stacking is manual: in prep, drag a soul of the same kind onto a piece to add a body, drag a body off to split.
  Nothing stacks by itself. A 2×2 piece stacks like any other: footprint and count are independent.
- A stack's HP pool is count × body HP; its damage is living bodies × body damage, living bodies being
  ⌈hp ÷ body HP⌉. Any hit that lands on the piece lands on the pool once, a Shape hit too, whatever its footprint.
- **Command** is how many pieces you may field: the Monarch's base and its Command relics' (§2.6), never past the
  board's cap. The rest wait in the ossuary.
- A piece counts once toward synergies whatever its count or size (§2.7).

### 2.3 Rings

Every kind has a **ring**, a radius in tiles, drawn around the piece in prep.

- **A piece fights whatever it can strike in its ring; otherwise it waits.** It never steps. With nothing in its
  ring it banks gauge (never past its costliest ability) and casts what it can on its allies (a heal, a ward).
- A ring is measured from the footprint: the ring-1 of a 2×2 piece is the twelve tiles around it. Rings reach
  through walls.
- A melee blow reaches the ring (1, or 2 for a long-armed kind: Grave Ghoul, Mantis Reaper). A ranged blow
  reaches its range, never past the ring. A melee blow cannot strike a **flying** foe (§2.4); a piece whose ring
  holds only flyers it cannot strike treats its ring as empty.
- Target, yours: the foe in the ring furthest along its road (lowest road distance to the Monarch, §2.4; a
  flyer's road distance is its Chebyshev distance to the Monarch); ties by lane, centre first (`CENTRE_OUT`).
  Target, a foe's: the piece on its next road tile if that is in its ring, else the nearest in its ring, ties by
  lane. A Flank kind on a road round your pieces strikes only the Monarch and the piece in its way (as before).

### 2.4 Foes: roads, Walk, Flank, Fly

- Before every battle the game floods outward from the Monarch's tile through every open tile (walls block,
  pieces do not), giving each tile its road distance and one **arrow**: the neighbouring tile with the lowest
  distance; among equals the tile nearest the Monarch's lane, then straight ahead, then nearer the centre. Drawn
  on the board in prep. Arrows point strictly closer, so a queue never deadlocks.
- Foes come from the top edge as pieces, in numbered waves, each in a lane, and **swarm the Monarch**: each tick a
  foe fights what is in its ring, or waits if its next tile is held, or steps. Three behaviours, learnt by meeting
  a kind (§7), and recorded in the bestiary:
  - **Walk**: the arrows. It fights through your pieces.
  - **Flank**: floods with your pieces counted as walls and walks round them, striking nothing but the Monarch
    and what stands in its way; with no way round it Walks. Recomputed when a piece of yours rises or falls.
  - **Fly** (`flies: true`): ignores roads and walls. Each step it takes the free neighbouring tile nearest the
    Monarch (Chebyshev), ties in the arrows' order; with none nearer it waits. It may hover over a wall tile. Only
    a ranged blow can strike it. Its own blows are its kind's. Flyers of either side hold the air, not the ground: a
    flyer and a ground unit may share a tile and never block each other's steps (the Walk and Flank fields ignore
    flyers), but two flyers never share a tile, nor two on the ground.
- **Statuses the foes bring**, on top of Brittle and Withered: **Burning** (a damage-over-time: `power` true
  damage per tick interval per stack, never missing, no DEF, no crit; up to 3 stacks) and **Hexed** (a slower
  gauge). Both are debuffs Purge and Molt cleanse. Your kinds can learn to inflict them too (tiers, fusions).
- **Death burst** (`onFall: { range, effects }` on a kind): when a piece of the kind falls, its effects run from
  where it fell on the other side's living within `range`. The first: Rot Bloat, which Withers what stood near it.
- Complexity by floor, from the spawn pool's `minFloor`: floor 1 brings Burning (Pyre Hound) beside Walk, Flank,
  reach, Shape, drain and clock; floor 2 brings Fly (Hive Drone, in cohorts) and the death burst (Rot Bloat);
  floor 3 brings Hexed (Marsh Hag) and a flying burner (Ash Wyvern); floor 4 the Sovereign's court.
- Waves, bosses, crumbling and escalation stay as they are in `src/sim/battle.js`.

### 2.5 Domain and the risen

**Arise is a Legendary relic** (`arise`, §2.6). Without it no foe rises as a shadow and the domain does nothing.
**Dominion and Will are Arise's**, not the Monarch's: each copy of Arise past the first adds a point of each
(`TUNING.monarch.dominion` and `.will`, 1 and 1), on top of the `raises` each copy adds. `ariseOf(s)` in
`src/sim/run.js` says where Arise stands: `{ copies, dominion, will, domain, raises, tier, haste }`. With it, as
before: the domain is the square within `domain` + Dominion (+ Court of Bone's tiles) of the Monarch
(`domainOf`); a foe that falls inside it rises as a shadow of yours on the free tile closest to the Monarch (never
where it fell: the enemy's dead never block its roads), at the fallen count and `raiseHp`, if its tier is at most
`raiseTier` + Will and raises are left: `raises` × (copies + Will) a battle (`ariseCap` in `src/sim/battle.js`),
grown by Blood Tithe; Will also fills the Monarch's gauge `willHaste` faster a point. So one copy is the Arise that
was (domain 5, tier ≤ 3, 3 a battle, since the balance pass), and a second makes it domain 6, tier ≤ 4, 9 a battle. A shadow holds its
tile and is gone when the battle ends. A shadow of a flying kind flies (it holds, and melee cannot touch it).
Recruiting is unchanged and needs no relic: one slain foe a battle, as a full soul into the ossuary.

### 2.6 Growth

- **Essence** from slain foes, as today. It buys only tiers, recruits and fusions.
- **Upgrades belong to the kind.** A kind's panel: **two tracks** of tiers I–IV with the crosspath rule (the first
  track past II may reach IV; the other stops at II). Tier IV is a rule, never a percentage: a new or remade ability,
  an aura, +ring, or **Colossus** (`size: 2`). Banner is gone.
- **A kind's level is its tiers'.** No level is bought: a kind stands at `TUNING.level.base` + `perTier` × the tiers
  it holds on both tracks, rounded down (`levelOf`; 2 and 0.5 since the balance pass, so IV and II make level 5), and every soul of it with it, healed by what it gains. The stat growth levels gave comes with each tier. A
  recruit joins at its kind's level (a kind new to the run at its first, with no tiers), and its offer is priced by
  that level. Foes keep their floor's levels.
- **Fusions** (`FUSION_LIST` in `src/content.js`: `{ id, name, result, needs: { kind: n }, desc }`). A fusion
  consumes bodies from pieces of yours, fielded or in the ossuary, exactly `needs` of each kind (a stack of two
  Tomb Knights is two; a bigger stack gives the bodies asked and keeps the rest, as a split would), costs `TUNING.essence.fuse` × the result's tier, and
  gives one piece of the fused kind, count 1, full HP, in the ossuary, to be placed. The result joins its kind, with
  the kind's tiers (none for a kind new to the run), at the kind's level, which never falls below the highest level
  of the kinds consumed (the kind's `least`, kept and only ever raised): **a fused piece is never weaker than what
  went into it**. Fused kinds (`fused: true`) never spawn and are never recruited; they have two tracks like any
  kind; most are 2×2.
  Recipes are not discovered: the Codex lists every one from the start. They are the plan.
- The first fusions (content decides the final numbers): **Bone Colossus** (2×2; Tomb Knight ×2 + Bone
  Chanter), **Rime Drake** (Ember Drake + Frost Sprite ×2), **Hive Queen** (2×2; Hive Warden ×2 + Mantis
  Reaper), **Clockwork Titan** (2×2; Clockwork Page ×2 + Iron Golem), **Pale Court** (Will-o'-Wisp ×3).
- The first Colossus tiers: Tomb Knight's Bulwark IV (Barrow Wall), and the tier IVs that were Banners.
- **The Monarch has no points.** Nothing is bought for it. It has a base HP (`TUNING.monarch.hp`) and a base
  Command (`TUNING.party.field`: the pieces it fields), and both grow only by relics, every copy adding in full
  (`monarchHp`, `commandOf` in `src/sim/run.js`; the field still stops at `army.board`). The HP relics: Grave Shroud
  (Common, +30), Bone Mantle (Uncommon, +65), Phylactery (Rare, +110), each healing the Monarch by its gain unless
  Court of Bone holds. The Command relics: Bone Horn (Common, +1, every soul −10% HP), Muster Roll (Uncommon, +1,
  −5% HP), Grave Banner (Rare, +1) and Legion (Legendary, +2, −15% HP): the rarer, the cleaner. **Every won
  elite's relics hold a Command relic** (its first is drawn from them alone, the offer shuffled), so the army's
  size is never luck alone. The numbers are placeholders until the balance pass.
- **Relics come in four tiers**: Common, Uncommon, Rare, Legendary (`RELIC_TIERS` in `src/content.js`: id, name,
  colour token; every relic's `tier`). The twenty-six relics (the twenty-one that were and the five HP and Command
  relics) are split across the first three by strength. The **Legendaries** are the rules that rewrite the game: the
  six that were keystones (Legion, Undying, Mimicry, Hollow Court, Blood Tithe, Court of Bone) and Arise. A
  reliquary and a won elite lay out Common to Rare relics, the tier of each drawn by `TUNING.relic.weights` for the
  room and the floor, deeper floors weighted to the rarer (placeholders until the balance pass). From floor 2 both
  also lay out Legendaries (`TUNING.relic.legendary`). A relic that does nothing without Arise (`needsArise`:
  Hollow Court, Blood Tithe, Court of Bone, Hourglass, Bone Idol) is offered only once Arise is held. Relics that
  spoke of levels speak of tiers: Soul Lantern gives a kind new to the run that you recruit a free tier on its lower
  track, a copy each; Grave Ledger cuts tiers I and II by 30%. The `march` trigger is `wave` (as the battle begins,
  its opening formation the first wave, and as each later wave begins to enter; the Monarch its subject).
- **The Reliquary** is the rite and the reliquary merged: it lays out its relics, from floor 2 its Legendaries, and
  up to `TUNING.relic.offer.tiers` free next tiers of your kinds (each for a different kind where it can), and **all
  of it is one pick** (`onePick`). Releasing the last soul of a kind withdraws its tier. A won elite's offers stay
  one of each group (`offerGroup`: a recruit, a relic, a Legendary). A floor's middle holds one to three
  reliquaries, weighted as the two rooms were together; no room is a rite.
- **Copies stack, with no cap.** A relic held may be offered and taken again, and every copy applies in full: mods
  compound (two Whetstones, ATK × 1.12²), a trigger fires once a copy, a number adds once a copy (Command, the
  Monarch's HP, roster, Soul Lantern's tiers, discounts, domain, Arise's raises, Dominion and Will, Blood Tithe's
  cap and tithe, Hollow Court's essence). The on/off rules say what a copy more does: Undying rises once more a
  battle; Mimicry counts a Vanguard as one Warden more; Court of Bone's Monarch stays unhealable while its domain
  grows. `s.relics` is the ids in the order taken, a copy named again (`relicCount`).

### 2.7 Synergies

Kin and role counts over your fielded pieces, a piece counting once, steps at 2, 4, 6 and 8, the 8-step rules;
synergy glow on the board. A fused piece counts once with its own kin and role.

### 2.8 Timer and ends

One escalation bar is always visible. Won when no foe stands and no wave is left; lost when the Monarch falls
(the run ends) or the bar runs out (a defeat, the run ends). A boss's fall crumbles its side.

### 2.9 Cut

Line, Signal, Lunge, Banner, timing marks, the Monarch's seats and moving the Monarch, stride for your side (a
foe keeps its gait), horns (closed: no), the `march` moment. Late on 2026-10-09: the Monarch's points (HP,
Dominion, Command and Will bought with essence), bought levels, and the Rite as a room.

Vocabulary after the cut: Piece, Stack, Ring, Road, Wave, Domain, Shadow, Essence, Tier, Fusion, Synergy, Relic
(Common, Uncommon, Rare, Legendary), Command. Thirteen, plus the behaviours (Walk, Flank, Fly) and the statuses.
Keystone left the list on 2026-10-09 (night): the keystones are Legendary relics. Command joined it late that
night: with nothing to buy for the Monarch, relics name it ("+1 Command") and the player has to read it. Level is a
kind's tiers read as a number, and Dominion and Will are Arise's numbers, read on its card: none is a word to learn.

## 3. What the player may rely on

1. **Your pieces never move.** A piece fights from the cell you gave it, all battle.
2. **Foes walk the arrows**; a Flank kind round your pieces; a Fly kind straight at the Monarch over everything.
   Which kinds do which is learnt by meeting them, and the bestiary keeps it.
3. **The roads and the seat are the camp's**, drawn before you place anything. **Coverage**: in prep every road
   tile is shaded by how many of your rings cover it (melee rings count; they cannot reach a flyer, which the
   bestiary will have told you).

## 4. Interface

The standing rules hold: one scaled landscape layout (`src/frame.js`), one view at a time behind tabs, nothing
that needs hover, Shift or a key.

- **Layout**: the board on its side as in Bloons TD, the camp on the right beside the slim panel, the foes
  entering from the left; a thin bar above (floor, essence, Monarch HP, the tabs as icons). On a phone a tile is
  never under 44 CSS px.
- **Field tab** (the default). Drag an ossuary soul onto an open camp cell to place it (a 2×2 shows its footprint
  under the finger, red where it does not fit), onto a same-kind piece to stack. Tap selects. The Monarch cannot
  be dragged; its cell wears a crown. The panel shows the selected piece: its card, ring, count, the kind's two
  tracks and the level they give (no level button), and **Fuse**: the recipes this kind is part of, each lit when
  every part is held and essence suffices, one button each (a stack bigger than the recipe needs is split for you).
  Nothing selected means the Monarch's panel, with nothing to buy: its HP and Command (the relics that give them),
  and once Arise is held, Arise's domain, Will, raises and tier (`ariseOf`); Escape or tapping empty ground returns
  to it.
- **Prep overlays**: the roads (arrows), the domain, the selected piece's ring, coverage, synergy glow.
- **Battle**: the same board; the wave counter, the escalation bar, counts on pieces, the horde drawn as many
  small sprites per tile while the sim counts one piece; a 2×2 piece drawn large over its four tiles; a flyer
  hovering with a ground shadow; Burning as flame on the sprite, Hexed as a violet pall. Pause and speed stay.
- **End**: the death panel's facts shown as a replay beat on the board.
- **Tabs**: Field · Map · Codex. The Codex's glossary is the thirteen words, the behaviours and the statuses;
  it gains a **Fusions** page listing every recipe with its result's card.

## 5. Implementation

No branches: one working tree, each area owned by one agent, `npm test` green at the end. Tests check function,
not balance. The sim, run, content and interface are built together against this document (the contract is the
names below); the autoplayer and the integration pass follow.

### Shared contract

`src/sim/unit.js` (owned by the battle agent; seeded already):

- `sizeOf(u)` → 1 or 2: the def's `size`, or 2 if any held tier has `size: 2`.
- `footprint(tile, size)` → the footprint's tiles, or `null` where it would leave the board.
- `footprintSlots(slot, size)` → the camp cells a piece anchored at `slot` covers (its cell, the next lane, the
  two ahead), or `null` off the camp.
- `fits(camp, slot, size, taken = new Set())` → every covered cell open, in the camp, and not in `taken`.
- `monarchSlot(camp)` → the camp's `'M'` cell. `isMonarchCell(camp, slot)`.
- `unitDistance(a, b)` → the least Chebyshev distance between two units' footprints; `distanceBetween(a, sa, b, sb)`
  between a footprint of side `sa` at `a` and one of `sb` at `b`.
- Gone: `strideOf` for your side (a foe's stays), `bannerOf`, `SEAT_ROWS`, `isSeat`, `seatNear`. `sealedBy`
  stays for the camp test.

`src/content.js` (owned by the content agent; seeded already): unit defs may carry `size`, `flies`, `onFall`,
`fused`; a tier may carry `size: 2`; statuses `burning` (`tick: [{ op: 'dot', power }]`) and `hexed`;
`FUSION_LIST`, `FUSIONS`, `fusionDef`; `BEHAVIOURS` walk, flank, fly; camp maps carry `'M'`; `SIGNALS` and
`BANNER` go; `TRIGGERS` = kill, fall, wave, blow, struck.

`src/sim/run.js` (owned by the run agent): the action `{ type: 'fuse', id, parts: [{ uid, n }] }` (n bodies off
each piece, the hindmost, the whole piece when n is its count); `fuseParts(run, id)` → the canonical parts (the
ossuary's pieces first, then the fielded, the smallest stacks first) or null; `canFuse(run, id)`; `fuseCost(run, id)`;
no `lines`, no Monarch placement.

`src/tuning.js`: `essence.fuse` (seeded: 20, × the result's tier). `board.stepTicks` stays for the foes.

The simplification (late on 2026-10-09; the interface follows it): in `src/sim/run.js`, gone are the `monarch` and
`level` actions, `s.monarch`, `MONARCH_STATS`, `monarchPoints`, `monarchCost`, `monarchStatOpen`, `levelCost` and
`medianLevel`; `join` takes no `lvl`; no room is a `rite`. New: `ariseOf(s)` → `{ copies, dominion, will, domain,
raises, tier, haste }`; `monarchHp(s)`, `commandOf(s)`; `levelOf(kind state)`, `kindLevel(s, id)`, `lowerTrack`;
`onePick(run)` (a reliquary's offers are one pick). `s.kinds[id]` is `{ lvl, tracks, least? }`, `lvl` derived and
kept in step. `TUNING.monarch` loses `cost`, `costPerPoint`, `hpPerPoint` and gains `dominion`, `will`;
`TUNING.level` is `{ base, perTier }`; `TUNING.relic.offer` is `{ reliquary, elite, tiers }` and its weights have
no `rite`. Relic keys: `command` (was `field`), `monarchHp`, `soulTiers` (was `soulLevel`), `lowTierDiscount` (was
`levelDiscount`). The ablations `monarch-stats` and `levels` are gone.

### Step 1. This document

Done when `DESIGN.md` is written.

### Step 2. Sim: the battle (`src/sim/battle.js`, `src/sim/unit.js`; `test/battle.test.js`, `test/relics.test.js` (was `keystones.test.js`), `test/endless.test.js`)

- Out: lines, signals, `lineStep`, `follow`, `join`, `lunge`, the party half of `stepOf`, `timingMarks`,
  `battle.signals`, the `march` trigger, the unit fields `line`, `leg`, `home`, `leader`, `offset`, `lunges`,
  `banner`. `fired` stays for the reserve (`time`, `break`).
- In: footprints on the tile index (`battle.at` holds the ground unit on each of its tiles, `battle.sky` the flyer;
  `occupy`, `fall`, `crumble`, `fit`); `around` and `foeWithin` measured from a unit's footprint and deduplicated; Shape expansion on
  footprints; `flyStep`; melee cannot strike a flyer, and a ring holding only unstrikable flyers reads empty; the
  `dot` effect op (true damage × stacks); `onFall` death bursts; `trigger(battle, 'wave', …)` as the battle begins
  and when each later wave begins to enter; `ringTarget` with a flyer's road distance.
- `chooseAction` becomes: a strikable foe in the ring → the first blow it can afford, else bank; else an ally
  ability it can afford; a foe steps (its behaviour) when due.
- Tests: footprint occupancy and rings; a 2×2 blocks the Flank field two wide; a flyer's path over a wall; melee
  misses a flyer and a ranged blow does not; Burning ticks true damage per stack and ends; a death burst; a
  `wave` trigger; every line, lunge, Banner and timing-mark test deleted.

### Step 3. Sim: the run (`src/sim/run.js`; `test/run.test.js` but its autoplayer tests, `test/tracks.test.js`)

- Out: `s.lines`, `cleanWhen`, `cleanLine`, `isMarch`, `clipLines`, `LINE_MAX`, `lineActions`, the `line`
  action, `seatNear`, the Monarch in `place`.
- In: the Monarch on `monarchSlot(camp)` every floor; `canPlace` by `fits` and never onto the Monarch's cell; a
  Colossus tier bumping pieces that no longer fit to the ossuary; `fuse`, `canFuse`, `fuseCost`; `legalActions`
  listing one fuse per recipe that can be made (the ossuary's pieces first); `battleSetup` without lines;
  `autoPlace` honouring size.
- Tests: the Monarch fixed on `'M'` in every camp and refused by `place`; a 2×2 placed, refused where it does not
  fit, bumped by a Colossus tier; fuse consumes exactly, pays, lands in the ossuary, joins its kind, refuses a
  short set and a wrong kind; replay and the fuzz cover `fuse`; every line test deleted.

### Step 4. Content (`src/content.js`, `src/tuning.js`, `src/assets/units/*`; `test/content.test.js`, `test/enemy.test.js`)

- The new foe kinds with two tracks each, art (three SVGs each, in the house style), threats and flavour: Pyre
  Hound (floor 1, Burning), Hive Drone (floor 2, Fly), Rot Bloat (floor 2, death burst), Marsh Hag (floor 3,
  Hexed), Ash Wyvern (floor 3, Fly + Burning).
- The fused kinds, their abilities, tracks and art; `FUSION_LIST`.
- Colossus tiers where Banners were; a Burning or Hexed tier or two for your kinds.
- Camps redrawn as placement puzzles around a marked seat: twelve maps with `'M'`, a road from every tile of
  the foes' rows to the seat, no cell sealed in.
- `THREATS` gains `fly` and `burn`; `BEHAVIOURS` gains `fly`; `SIGNALS` and `BANNER` go; `tower_shield` fires on
  `wave`.
- Tests: every reference resolves; every kind two tracks; every unit its art; every recipe's parts and result
  resolve and the result is `fused`; camps as above; behaviours walk, flank, fly.

### Step 5. Interface (`src/board.js`, `src/ui.js`, `src/engine.js`, `src/codex.js`, `src/keywords.js`, `src/main.js`, `src/css/*`, `src/style.css`)

- Out: line drawing, signal markers, the signal cycle, timing marks, the line section of the panel, the Monarch
  drag, the Orders vocabulary, `timingMarks` and `SIGNALS` imports.
- In: footprint rendering and drop preview; coverage; the crown on the seat; the Fuse section; flyers hovering;
  Burning and Hexed FX; the Fusions page; the glossary cut to the thirteen words; the help text.
- Done when `node --check` passes on every module and a full run plays in the browser at 1440×900, 1024×768 and
  852×393 with no console errors.

### Step 6. Autoplayer (`src/sim/autoplay.js`; `test/planning.test.js`, `test/ablation.test.js`, the autoplayer tests of `test/run.test.js`)

- Out: lines, shapes, wings, seats, `park`, the `lines` ablation.
- In: drafts that place 2×2 pieces where they fit; the expert weighing each fusion it can make by rehearsal, as it
  weighs a tier; basic never fuses; a `fusions` ablation.

### Step 7. Integration

`npm test` green; every module `node --check`; the README and this file's §6 brought up to date.

Steps 2–7 were built on 2026-10-09: `npm test` green (218), every module passes `node --check`, and a full run
played in Chrome at the three sizes.

### Step 8. Play, then balance

Play the whole run. Then the single balance pass, at the end.

**The balance pass (2026-10-09, evening), done.** Yardstick: the rebuilt expert and its combo book (`--combos`,
regenerated after every material change and at the end). Classification decided first: core = tracks, formation,
fusions, bodies (25–50 points of clear rate when ablated); extras = arise, legendaries, relics, synergies (8–25)
(`CORE`/`EXTRA` in `src/sim/autoplay.js`). Five rounds, numbers only.

| | before (16 seeds) | after (32 seeds) |
|---|---|---|
| expert clear | 87.5% (died fl 1 burn, fl 4 ceiling) | 93.8% (died fl 1 reach, fl 4 shape) |
| basic clear | 0% (93.8% of deaths on fl 1) | 0% (90.6% on fl 1; reach 20, drain 6, burn 3) |

Ablations of the expert, 16 seeds, drop in clear-rate points (clear-eq, the paired progress reading, in brackets):

| | tracks | formation | fusions | bodies | arise | legendaries | relics | synergies |
|---|---|---|---|---|---|---|---|---|
| band | 25–50 | 25–50 | 25–50 | 25–50 | 8–25 | 8–25 | 8–25 | 8–25 |
| before | 88 (83) | 25 (38) | 6 (0) | 13 (5) | 0 (−1) | 19 (9) | 6 (6) | 6 (9) |
| after | 63 (40) | 38 (57) | 6 (8) | 31 (13) | −6 (−2) | 6 (1) | 25 (17) | 6 (18) |

Reclassified after the pass (the user's call): the expert substitutes for fusions (tiers and recruits) and for Arise
(another of the ~22 relics a run offers), so fusions moved to the extras and Arise is measured with the Legendaries
(the `legendaries` ablation now bans Arise too; no separate `arise` ablation). Re-measured, 16 seeds: legendaries
25 (in band), fusions 6 (2 under the extras' floor, inside the noise of 16 seeds). Core is now tracks, formation,
bodies.

How: the tracks carried everything (six tiers made level 10, about twice the HP and ATK, against foes two levels up
a floor), so nothing else could register. The level ladder was compressed on both sides: `level` base 2 and 0.5 a
tier (was 1 and 1.5; the start souls stand at 2, which §6 left for this pass), foes `levelPerFloor` 1 (was 2), with
floors 2–4's `foeHp`/`foeAtk` ×1.15 so the expert's margin is thin enough to show each mechanic. The power moved to
the combos: the five fused kinds' base and growth HP 2.5–3.8× and ATK 2.7–3.3× what they were (a fused piece
now about twice its parts' worth at a level; it was 0.8–1.07×, so the expert weighed fusing and declined), the
fusion price `essence.fuse` 8 a tier (was 20); the five count tiers +3 bodies (were +1); the Common–Rare relics'
magnitudes up about half (Whetstone ×1.18, Heartwood ×1.22, Blood Chalice 15%, Balm 18%, Glass Crown ×1.32, Tithe
Bowl 35%, the HP relics +30/+65/+110); Arise's domain 5 and raise tier 3 (were 3 and 2); Undying at 60% and Blood
Tithe at 2% (were 50% and 3%). Command was not touched (the expert fields 9.2 on average, under the cap of 10). Dearer
tiers (+20%) were tried and reverted: the expert fell to 62.5%, on floor 3's tick ceiling.

Missed, and why: **fusions** (6) and the **extras arise and legendaries** stay under, and **tracks** is over by clear
rate though in band by clear-eq. The expert substitutes freely: without fusions it buys tiers and recruits with the
essence and wins the same rooms; without Arise or a Legendary it takes another of the ~22 relics a run offers. A
fusion also spends its parts' tiers (a chanter's three bodies among them), so its payoff is late. Reaching 25 for
fusions by numbers alone would take a fused piece several times its parts, which the tracks' and bodies' bands then
pay for. Sixteen seeds read a drop to ±10–25 points, so formation, bodies and synergies sit near their edges within
noise. `--decisions` throws when its random-cell refights shuffle a 2×2 piece onto a taken tile (a tool fault, left
for the autoplayer's owner).

## 6. Decisions taken, and open

Taken:

- Your pieces never move. Rings are reaches; ring-2 melee strikes without stepping.
- The Monarch is pre-placed by the camp map.
- Size is a footprint: 1 or 2; from a kind or a tier IV; nothing else comes with it.
- A fusion consumes exact bodies, costs essence by the result's tier, lands in the ossuary; recipes are public.
- Fly: free neighbour nearest the Monarch, over walls; only ranged blows touch it.
- Burning is true damage per stack; Hexed slows the gauge; both cleansable.
- Walk foes fight through your pieces; only Flank routes round them.
- Shadows rise beside the Monarch at the fallen count and hold.
- The board size is left alone. (Relics and keystones were too, until the night's merge below.)

Taken while building (2026-10-09):

- Dropping a piece onto another piece of a different kind swaps the two, where both fit.
- Burning's damage is credited to whoever laid it (kills, essence, relic triggers).
- The Colossus tiers are Tomb Knight's Barrow Wall, Grave Ghoul's and Iron Golem's former Banner IVs, and Rot
  Bloat's. Ember Drake's tiers learn Burning and Clockwork Page's learn Hexed.
- Each camp's seat is placed for its puzzle, not always at the rear centre, and every camp has room for a 2×2.
- A walk that misses a threat type redraws the rooms on it in turn, up to `variety.routePasses` passes, so a
  floor with six or seven threat types still puts each on every walk.
- `fusions` is a core ablation (25–50 points), where `lines` was.

Taken that night (2026-10-09): relics.

- Keystones merge into relics as **Legendary** relics; relics have four tiers. `KEYSTONE_LIST`, the keystones'
  state and their cap are gone.
- Copies stack with no cap: `relicMax` and the keystones' max are gone; every copy applies in full.
- Arise is a Legendary relic: without it nothing rises and Dominion and Will stay locked; each copy raises
  `raises` more a battle. Recruiting is not touched.
- Legendaries come where keystones came (won elites and rites from floor 2); Common to Rare from reliquaries,
  won elites and rites (a rite now lays out a relic too). What needs Arise is offered only once it is held.
- The ablations: `legendaries` (every Legendary but Arise) replaces `keystones`; `relics` is the other three
  tiers; `arise` never takes the Arise relic (so never Dominion or Will) and stays a rules switch.

Taken late that night (2026-10-09): four simplifications.

- **No Monarch points.** Essence buys only tiers, recruits and fusions. The Monarch has a base HP and a base
  Command, and HP and Command come from stackable relics (three of each, Common to Rare; Legion the Legendary
  Command). Every won elite's relics hold a Command relic, so army size is not pure luck.
- **Dominion and Will are Arise's.** Each copy past the first adds a point of each, on top of the raises each copy
  adds; Court of Bone and Blood Tithe still add. One copy is the Arise that was.
- **Rite and Reliquary are one room**, the Reliquary: relics, Legendaries from floor 2 and free tiers, one pick in
  all. One to three a floor's middle, weighted as the two were together.
- **A kind's level is its tiers'** (`base` + `perTier` × tiers, rounded down; placeholders). Recruits join at it;
  foes keep their floors'. A fused kind never stands below the highest level of the kinds consumed. Soul Lantern
  and Grave Ledger speak of tiers now. The start souls stand at level 1 (they were bought to 2): balance later.
- The ablations: `monarch-stats` and `levels` go; `arise`, `fusions` and `bodies` are the core three. `relics`
  now also takes the Monarch's HP and Command away (Legion aside); `tracks` takes the levels with the tiers.

Open, decided later:

- **Arise's first copy.** It gives no Dominion or Will, so one copy is the Arise that was; if "each copy" should
  count the first too, it is `ariseOf`'s `pastFirst` and two numbers in `TUNING.monarch`.
- **Command relics at every elite.** The guarantee may make the field grow too fast for the expert (it took seven
  Command in two floors on one seed); the tiers' HP costs on Bone Horn and Muster Roll are the first lever.

- **Foe footprints.** The Sovereign as a 2×2 on the roads; needs a 2×2 walker. Not this pass.
- **Per-piece targeting** (first, last, strong), if one rule proves too blunt.
- **Board width.** 7 for now; the camps are the puzzle. Revisit after play.
- **Fusion count.** Five to start; more when each kind has one it belongs to.
- **The Legion without Arise.** Undead 8's rule still raises the slain as shadows with no Arise held: it is a
  synergy's, not the Monarch's. Lock it behind Arise too if a run without Arise should raise nothing at all.

## 7. Standing rules

Decided before this document and still in force (the project memory has the reasons):

- Enemy behaviour is discovered, never previewed: roads are terrain and are shown; which kinds Flank or Fly and
  what ring a kind has are learnt by meeting it, then recorded.
- Defeat is absolute. No lives, no retreat.
- Floor 1 is hard, and the skill gap opens in prep, never in dice.
- Balance comes once, at the end. No tuning while building.
- Tests are functional only until the balance pass.
- One universal landscape interface, modular tabs, nothing that needs hover or a key.
- Recruit only: one slain foe a battle, as a full soul into the ossuary.
