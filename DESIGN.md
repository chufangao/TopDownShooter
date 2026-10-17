# RETINUE: the design and the plan

One document, merged on 2026-10-17 from `DESIGN.md` (the rules redesign of 2026-10-09, "the dead hold the line") and
`redesign.md` (the improvement plan of 2026-10-15). For Chufan and for any Claude Code session working in this repo:
read "The game as it stands" below before touching `src/`, then Part two (the plan, what each step must measure, the
standing rules), and Part one where a rule of the board, the pieces, growth or the frame is in question. Nothing of
either file was dropped: Part one is the rules spec with its superseded parts marked, Part two the plan, and the
record (Part two §8) now opens with the balance passes and decisions of 2026-10-09 to 2026-10-10 that stood in
`DESIGN.md` §5–§6.

**How the code cites this document.** `DESIGN §2.6` is Part one §2.6 (the rules keep their numbers). `the improvement
plan's §4.1`, or `redesign.md §3`, `§4.1`–`§4.8`, `§7`, `§7.7` and `§8` (with an entry's name, "§8, Step 9"), is Part two.
`redesign.md §2.3`–`§2.26` (the battle §2.3–2.10, relics §2.15, the counter §2.18, line of fire §2.19, the draft
§2.26), `§5 Step N` and `§6 "The learned route"` are the combat spec that stood in `redesign.md` from 2026-10-10 to
2026-10-14: history now, read with `git show f8c536f:redesign.md`; what it decided is in force as the code and its
comments state it. The morning design before the rules redesign is `git show 041093f:DESIGN.md`.

## The game as it stands (2026-10-17)

RETINUE is a single-player, turn-based tactics roguelike in the browser: a necromancer's retinue holding a line
against the foes that walk down to the Monarch. No server; `npm start` serves `src/`, `npm run build` makes the store
build, `npm test` runs the suite, `npm run sim` and its siblings run the autoplayer (Part two §3). The rules' authority is
the code and its comments: `src/content.js` (every kind, ability, status, relic, fusion, synergy, camp, boss and
Monarch, as records), `src/tuning.js` (every number, each with its reason), `src/sim/turns.js` (the battle),
`src/sim/run.js` (the run), `src/sim/rules.js` (the relics' and synergies' rules), `src/sim/unit.js` (stats, footprints,
synergy counts); the in-game Codex and glossary (`src/keywords.js`, `src/codex.js`) tell the player the same.

**A run.** The Monarch alone drafts three souls, each from three floor-1 kinds (a later pick always offers a partner of
a soul held), then walks three floors of rooms (fights, elites, Shops, altars; a boss at each floor's end, chosen to
answer what the army leans on; the Hollow Sovereign's siege on the third; the deep past a clear) at an ascension level
0–10 chosen on the title, as one of four Monarchs (three unlocked by clears, each with a kin's banner and a draft bias).
A run is saved after every action and resumed from the title; there is a daily seed, a run history, a one-room
tutorial and synthesised music. A clear is ~30 battles and ~80 minutes of battle.

**The battle.** A board 7 wide: your 7-row camp at the bottom with the Monarch's seat fixed by the camp map, a gap row,
the foes' 3 rows at the top; walls from the map. Foes enter in numbered waves and walk the one drawn road (ground) or
the air road (flyers, blocked by your pieces, never by walls) toward the Monarch. Your turn: each fielded piece may move
up to its Move, then act once: its basic blow or basic heal, free every turn, or a skill, which then rests (cooldown 2
unless its record says; Arise 1; Hasten brings skills back a turn sooner). End Turn: every piece you gave no act strikes
or mends with its basic; the foes play as one opponent (`src/sim/policy.js foeTurn`); statuses tick, cooldowns fall, a
wave whose turn has come enters. A melee blow at a target that can reach back is countered; a ranged blow at one target
follows a line of fire; area blows ignore both. No dice: every blow hits for the mean. Fusions may be made in battle.
Won when no foe stands and none is still to come; lost the instant the Monarch falls; no clock.

**Between battles.** Essence, paid by each foe slain by its tier, buys **tiers** (two tracks I–IV a kind, the crosspath
rule; a kind's level is its tiers'), **recruits** (one slain foe a battle, from the spoils), **fusions** (44 recipes:
a trine for every kind of tier 4 or less, 4 mixed recipes, 7 capstones; a fused piece is never weaker than its parts)
and **relics** (45, four tiers, sold in Shops; run relics, and piece relics one a soul; the Legendaries rewrite rules,
Arise among them). Every price scales with the floor and the ascension. An **altar** grants one rite of three: heal
and raise the fallen; transmute a soul into a kind of the floor's pool; consecrate a kind's next tier. **Synergies**:
eleven, one a kin or a role, at four pieces (a trine counting as the three it was made of), Echo whole at eight.
Command 3 to begin, more by Command relics, at most 10 on the field; the roster 12. Wounds carry: a win heals 20%.

**Statuses** (`content.js STATUS_LIST`, twelve): Brittle (−25% DEF a stack, up to 3), Withered (−20% ATK), Hexed (loses
its next act and does not counter; a boss is never Hexed twice running), Burning (12 true damage a turn a stack, up to
3), Bleeding (8 a turn a stack, up to 5), Hasten (+1 Move, skills a turn sooner), Regen (heals a turn, 5% less damage),
Barkskin (+25% DEF), Veiled (+20% DEF), Shield (40% less damage), Enraged and Desperate (the bosses' phases). Debuffs
are cleansed by Purge, Molt and their like; statuses laid again gain a stack and keep the longer turns.

**What it is not.** There is no deck: no cards, hand, draw, discard or exhaust, no energy or mana, no poison by that
name (Burning and Bleeding are the damage over time). Slay the Spire's shape is taken at the run's level (Part two §2: a
build chosen among several, the choice made again every floor, power from combinations, a ladder of difficulty), not the
card's: a piece's acts are its kind's kit, their only cost in battle a turn's rest, and essence between battles is the
one currency.

**Measured at HEAD** (Part two §8, "The balance pass, part 2", 2026-10-16; the retrained expert of Part two §4.0): free
play at ascension 0 clears 217 of 256 (84.8%), every death on floor 1; criterion 1 (reachable) 36 of 44 recipes;
criterion 2 (viable) not met, 4 of 15 strictly committed archetypes within 15 points of the best; criterion 3 (diverse)
not met, the Pale Court in 66% of final armies, 4 of 11 synergies held in 5% of battles or more, the relics ablation 0
points; criterion 4 the expert at 85% against ~90% wanted, the calculator reaching floor 2 in an eighth of runs against
half, the ladder keeping its order at every level and its top row past what any rung can play. Left (that entry's
list): the relics line as a rule's question, criterion 2's floor and the strict commitment, a fusion's price 8 → 6
to confirm with the difficulty part, criterion 1's last eight; then the top of the ladder on the teacher, the recruit
forest refitted on the content as it stands, and the outside players of Step 9.

---

# Part one: the rules (2026-10-09, amended)

The rules redesign decided on 2026-10-09 (evening). It replaced "the dead keep the plan" (the morning version, commits
`30f29b4` to `041093f`), whose lines, signals, lunges, Banners and timing marks were cut. **Superseded since**, by the
combat spec of 2026-10-11 (`git show f8c536f:redesign.md`) and in force as the code states it: the battle (it is
turn-based, your pieces move and act under orders, not "your pieces never move" with rings as reaches: §2.3, §3.1 and
the ring and halting rules of §2.4 are history, the roads and the air road stand); the enemy (one opponent playing its
turn, `policy.js foeTurn`, not halting and sight rules); relics (sold in Shops only; piece relics held one a soul; Arise
a held relic's skill, its reach 7 and tier 4); the dice (none); the clock (none: §2.8's bar is gone, the camp's patience
ends a battle that drags); the gauge (cooldowns); and the expert (Part two §4.0). **What stands**: the board and the
camp maps, footprints and swaps, the Monarch's seat, roads, Walk and Fly, summons, the fallen to the ossuary, essence and
every price, the two tracks and the kind's level, fusions (the graph of Part two §4.1 on top), relics' tiers and
stacking, synergies (a trine as three since 2026-10-16), the frame. Its balance tables are history (Part two §8).

## 1. Why

The morning's design let your pieces walk lines you drew. Playing it, the lines were the plan's hidden half: a
piece a few tiles from where you left it is a piece you have to predict, and predicting it is the search the
redesign set out to remove. Bloons TD 6 and Plants vs. Zombies are the bar: **your pieces never move.** Where you
put a piece is where it fights, for the whole battle. The living enemy comes down roads you can see and
improvises; your side does one legible thing each and never surprises you.

That makes prep two decisions and only two:

1. **How to upgrade**: tiers (a kind's level comes with them), fusions and recruits, bought with essence; the
   Monarch's HP and Command, and Arise and its growth, come as relics.
2. **Where to place**: which cell each piece holds, and which souls take the field at all.

Placement has to be a puzzle, or the game is a shop. It is one because the roads and the Monarch's seat are the
camp's, fixed and drawn before you place anything, and every foe on the ground walks the road the board draws;
because a ring covers some road tiles and not others; because Shape blows punish pieces that bunch while auras reward
it; because a 2×2 piece needs four open cells and plugs a two-wide breach alone; because flying foes come straight
over the walls, held only by a piece in their way, and only a ranged blow or a flyer's melee can touch them; and
because Burning and Hexed punish the piece that fights longest. Every one of those is a rule you can read on a card
or on the board.

Power has to come from combos you build, or upgrading is a stat ladder. It comes from **fusions**, recipes that
consume specific souls and give one much stronger piece, usually 2×2; from **Colossus tiers**, a kind's tier IV
that grows every piece of the kind to 2×2; and from the synergies, as before. Growth changes what you command,
from a handful of souls to a wall of colossi, which is the squad-to-army scale the project has wanted all along.

The enemy scales in kind, not only in number: each floor's pool brings a new thing a foe can do (burn, fly, hex,
burst on death) on top of Walk, reach, Shape, drain, clock and waves.

Reversed here, from the morning:

- **"Static placement makes the roster turrets and the army never advances."** Turrets are the genre, and the
  army advances by growing: a 2×2 colossus, a fusion of three souls, a kind of four with its summons. Movement bought nothing a
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
- **The Monarch is pre-placed.** Each camp map marks its seat with `'M'`. It never moves, never strikes (its ring
  of 1 only holds the foes beside it, §2.3), and no action places it or anything on its cell (`monarchSlot(camp)`
  in `src/sim/unit.js`). If it falls the run is over. The camps are designed around the seat: it is the end of
  every road and the shape of the puzzle.

### 2.2 Pieces and footprints

- A **piece** is one soul, one body, of one kind on one tile (its **anchor**), with a **size**, 1 or 2. Your pieces
  are souls from the ossuary; a foe piece is one foe. Nothing stacks: no piece, yours or the enemy's, ever holds more
  than one body. (Stacks were cut on 2026-10-10: merging two wounded souls into one pool felled one of them, and a
  stack counting once toward synergies made merging a trap. A duplicate is a decision as a piece: a Command slot and
  a cell, a synergy count, a fusion part, a second piece the kind's tiers grow, a second position.)
- A size-2 piece has a 2×2 **footprint**: its anchor, the tile in the next lane (+x), and the two ahead of those
  toward the foes (+y). `footprint(tile, size)` (a battle unit's: `footprint(u.tile, u.size)`). It stands only where
  all four are open ground in the camp with nothing else on them (`fits(camp, slot, size, taken)`). A foe piece is
  always size 1 in this pass.
- Size comes from the kind (`size` on the unit def, a fused kind's) or from a tier (`size: 2` on a tier IV, a
  **Colossus** tier): `sizeOf(u)`. When a kind takes a Colossus tier, each of its pieces that no longer fits where
  it stands goes to the ossuary until you place it again. Size is a footprint and a ring, nothing else: no stat
  comes with it that the tier's or the kind's own numbers do not say.
- **A swap is by footprint.** A piece moved onto cells another one piece covers swaps with it (`swapWith` in
  `src/sim/run.js`): the other takes the mover's old place where it fits there, or the ossuary if the mover came
  from there. Never with the Monarch, and never with two pieces at once.
- **A heal counts only the allies it can mend**, in its condition and in its aim: within its reach (anywhere under
  Sanctuary), below their max HP, never a Monarch nothing can heal (Court of Bone); one that also cleanses (Purge,
  Hive Mind) counts an ally carrying a debuff it would strip (`helps` in `src/sim/battle.js`). Both sides' heals
  alike: a healer with no one to mend strikes.
- A soul whose kind holds a **summon tier** (`summon` on a tier: Marrowcaller II, Brood Mother II, Gearwright II,
  Heartwood II, Ancient II) brings that many **summons** to every battle: shadows of its own kind (§2.5), at
  `TUNING.summon.hp` of a whole one's HP, risen as the battle begins on the free ground nearest it. They hold where
  they rose, count toward synergies as shadows do, pay nothing, bring no summons of their own, and are gone after
  the battle (`summonsOf` in `src/sim/unit.js`).
- **Command** is how many pieces you may field: the Monarch's base and its Command relics' (§2.6), never past the
  board's cap. The rest wait in the ossuary.
- **A fallen piece leaves the field.** A piece that falls in a battle goes to the ossuary as the battle ends
  (`finishBattle` in `src/sim/run.js`), freeing its cell and its Command slot, and lies there fallen until an altar
  raises it (where it lies: then it may be placed again). No action places a fallen soul (`canPlace`); the ossuary
  strip marks it fallen. It may still be fused or released.
- **Releasing a soul pays back** `TUNING.essence.refund` of what recruiting it would cost now (`releaseRefund`), a
  fallen one too: a third Grave Ghoul is a choice of field, fuse or sell.
- A piece counts once toward synergies whatever its size (§2.7).

### 2.3 Rings

*Superseded 2026-10-11: the battle is turn-based. A piece moves up to its Move and acts; reach is a blow's own range (melee 1, or 2 for a long arm); nothing halts a foe by sight. Kept for the record of what the roads, the arm, the flyer rules and the targeting grew out of.*

Every kind has a **ring**, a radius in tiles, drawn around the piece in prep.

- **A piece of yours fights whatever its blows reach in its ring; otherwise it waits.** It never steps. With nothing
  in reach it banks gauge (never past its costliest ability) and casts what it can on its allies (a heal, a ward).
- **Your rings are what the foes see you by**: a walking foe in the ring of a piece of yours that can strike it may
  halt there, and does once it can strike something of yours from where it stands (§2.4; `holdOf` in
  `src/sim/unit.js`, `wayOf` in `src/sim/battle.js`). **A piece sees only as far as its blows that need no condition
  reach** (no `when`): where a blow with one reaches farther (Killing Cold's board, Briar Lash, Miasma, Pyre Rain), it
  strikes there once its condition holds, but no foe halts there for it, so a shooter never stands shooting a piece
  that cannot answer; the coverage and the stop line (§3) read the same sight. A piece with no blow in its kit holds
  nothing. **The Monarch's ring is 1**: it still never strikes, but holds every foe within a tile of its seat, walking
  or flying (from there every foe's blow reaches it).
- A ring is measured from the footprint: the ring-1 of a 2×2 piece is the twelve tiles around it. Rings reach
  through walls.
- **Your reach.** A ranged blow reaches its range, never past the ring. A melee blow reaches its own `range` where it
  has one (Grave Breaker, Reaping Swarm: 2), else the kind's **arm**, never past the ring: 1, or 2 for the two
  long-armed kinds (`arm: 2` on the unit def: Grave Ghoul, Mantis Reaper; `armOf` in `src/sim/unit.js`, `reachOf` in
  `src/sim/battle.js`). A ring-2 melee piece of a long arm strikes two tiles off without stepping. **A tier that grows
  the ring grows no arm**: the ring grows for the blow the tier teaches (Briar Lash, Phantom Edge, Miasma, a tier's
  "reaches N tiles", which the content test holds to the truth), and the kind's other melee blows reach as far as
  they did. A melee blow from the ground cannot strike a **flying** foe (§2.4; a flyer's melee can), so a melee ring
  on the ground never holds one, and a piece whose ring holds only flyers it cannot strike treats its ring as empty (it
  still blocks a flyer whose way it stands in: §2.4).
- **A foe has no melee reach.** Its melee blow strikes only the piece of yours on its next tile, the Monarch once
  beside it, and a piece of yours beside it (footprints counted) that has aimed a blow at it this battle, hit or
  miss: it strikes back at that one while both stand beside each other. A Shape blow still spreads from that target
  as its shape says. The long arm is yours alone. A foe's ranged blow reaches its range, never past its ring, as
  yours does (`closeIn`, `reachOf` in `src/sim/battle.js`).
- Target, yours: the foe in reach furthest along its own road (lowest road distance to the Monarch, §2.4: a ground
  foe's on the Walk field, a flyer's on the air road, its Chebyshev distance to the Monarch); ties by lane, centre
  first (`CENTRE_OUT`).
  Target, a foe's: of what its blow may strike, the piece on its next road tile first, else the nearest, ties by
  lane.

### 2.4 Foes: roads, Walk, Fly

*Stands: the Walk field and the air road, Walk and Fly, the statuses the foes bring, death bursts, the floors' complexity. History: the halting rules (a foe now plays its turn, `policy.js foeTurn`, walking and striking as its policy chooses), the gauge, "no melee reach" (a foe's blows reach as its kit says).*

- Before every battle the game floods outward from the Monarch's tile through every open tile (walls block,
  pieces do not), giving each tile its road distance and one **arrow**: the neighbouring tile with the lowest
  distance; among equals the tile nearest the Monarch's lane, then straight ahead, then nearer the centre. Drawn
  on the board in prep. This is the **Walk field**, the one ground road: **every foe on the ground walks the arrows
  the board draws**. They point strictly closer, so a queue never deadlocks. The **air road** is the same flood over
  every tile, walls included (`airOf`): a flyer's road, every arrow a step nearer the Monarch.
- Foes come from the top edge as pieces, in numbered waves, each in a lane, and **swarm the Monarch**. A foe
  **walks** its road and does nothing else, struck or not, its gauge filling (never past its costliest), until it
  **halts where it can hit back** (`wayOf` in `src/sim/battle.js`):
  - **in the sight of a piece of yours that can strike it** (§2.3: its ring, as far as its blows that need no
    condition reach), once one of its blows has a permitted target from where it stands: a ranged blow, a piece of
    yours within its reach (`reachOf`); a melee blow, the piece of yours on its next tile, the Monarch beside it, or a
    piece beside it that struck it (`closeIn`). The test is the one the battle makes to choose an ability (in reach,
    its `when` holding), the gauge aside, over its blows alone (`armed`): an ally ability never halts a foe. So a
    shooter stops in your ring and shoots from the back, while a melee foe or a drone walks on through your rings
    until something blocks it, it reaches the Monarch, or a piece beside it strikes it (it halts then, and strikes
    back);
  - **with its next tile held**, once it is armed there (a walker's by anyone on the ground; a flyer's by a piece of
    yours on the ground or in the air, or by a flyer of its side: `holderOf`): blocked by a piece of yours or the seat,
    a melee foe fights the blocker; queued behind a comrade that has stopped (halted, or stuck itself), a ranged foe
    shoots over it. **A moving queue is no halt**: behind a comrade still on the move (one whose last turn walked it,
    or queued it behind one on the move: the unit's `walking`, set each turn and read as it stands, so the order two
    foes act in delays a halt by a tick at most and a battle stays a function of its setup) a foe waits its turn,
    doing nothing. Stuck with nothing to strike, it stands and does nothing too.

  Halted, it fights: its ranged blows at whatever they reach, its ally abilities (heals, purges, wards, Grave Tide) as
  before, its melee only at what §2.3 allows. A foe standing unhalted, walking or waiting, uses none of them. Once
  nothing halts it (the piece fell, the tile cleared, the one that struck it fell) it walks on, on its step clock
  (`chooseAction` in `src/sim/battle.js`). Two behaviours, learnt by meeting a kind (§7), and recorded in the
  bestiary:
  - **Walk**, every ground foe's: the arrows, into your rings, halting as above.
  - **Fly** (`flies: true`): walks the air road, over the walls (it may hover over one), **never through your
    pieces**. It is blocked as a walker is: a piece of yours on its next air-road tile, on the ground or in the air (a
    shadow of a flying kind too), holds it there, and it fights the blocker; a flyer of its own side there queues it,
    as walkers queue. **Only a ranged blow, or a flyer's melee, can strike it**: melee from the ground never reaches
    up, while a flyer's melee meets a flyer in the air, either side's (`aloft` in `src/sim/battle.js`). So in your
    rings only a ranged ring, a flyer's or the Monarch's halts it, and only where it can strike back (a Hive Drone:
    beside the Monarch, beside a piece of yours that struck it, or before the piece that blocks it). A melee piece on
    the ground in its way holds it but cannot strike it, nor can a ground foe's melee strike a flyer of yours: your
    ranged pieces and your flyers bring it down. Its own blows are its kind's. Flyers of either side hold the air, not
    the ground: a flyer and a ground unit may share a tile, and a ground foe and a flyer never block each other (nor
    does a flyer of yours block a walker: a walker's way is held only on the ground), but two flyers never share a
    tile, nor two on the ground.
- **Statuses the foes bring**, on top of Brittle and Withered: **Burning** (a damage-over-time: `power` true
  damage per tick interval per stack, never missing, no DEF, no crit; up to 3 stacks) and **Hexed** (a slower
  gauge). Both are debuffs Purge and Molt cleanse. Your kinds can learn to inflict them too (tiers, fusions).
- **Death burst** (`onFall: { range, effects }` on a kind): when a piece of the kind falls, its effects run from
  where it fell on the other side's living within `range`. The first: Rot Bloat, which Withers what stood near it.
- Complexity by floor, from the spawn pool's `minFloor`: floor 1 brings Burning (Pyre Hound) beside Walk, reach,
  Shape, drain and clock; floor 2 brings Fly (Hive Drone, its captains leading cohorts of their kind: separate foes) and the death burst (Rot Bloat);
  floor 3 brings Hexed (Marsh Hag) and a flying burner (Ash Wyvern); floor 4 the Sovereign's court.
- Waves, bosses, crumbling and escalation stay as they are in `src/sim/battle.js`.

### 2.5 Arise and the risen

**Arise is a Legendary relic** (`arise`, §2.6). Without it no foe rises as a shadow, its reach does nothing, and
nothing of it is shown (§4). **Its numbers are the relic's own, a copy at a time**, never the Monarch's
(`TUNING.arise`): one copy raises a foe of tier at most `tier` slain within `domain` tiles of the Monarch, up to
`raises` a battle, each body at `hp` of its HP; each copy past the first adds `more`: `more.domain` tiles farther,
`more.tier` tiers higher, `more.raises` more a battle, and the Monarch's gauge (Arise's casting) `more.haste` faster.
Since the balance pass that is 5 tiles, tier ≤ 3, 3 a battle at full HP for one copy, and a tile, a tier, 6 raises
and 10% a copy more: two copies are 6, ≤ 4, 9 a battle; three 7, ≤ 5, 15. `ariseOf(s)` in `src/sim/run.js` says
where Arise stands: `{ copies, domain, raises, tier, haste }`. The domain (the code's word; the player reads
"Arise's reach") is the square within that reach, Court of Bone's tiles added, of the Monarch (`domainOf`, given the
battle as `domain`); a foe that falls inside it rises as a shadow of yours on the free tile closest to the Monarch
(never where it fell: the enemy's dead never block its roads), if its tier is in reach and
raises are left (`ariseCap`, `ariseTier` and `ariseHaste` in `src/sim/battle.js`, read from the copies the battle
holds; Blood Tithe grows the cap). A shadow holds its tile and is gone when the battle ends. A shadow of a flying
kind flies (it holds, blocks a foe flyer in its way, and melee from the ground cannot touch it). Recruiting is unchanged and needs no
relic: one slain foe a battle, as a full soul into the ossuary.

### 2.6 Growth

- **Essence** from slain foes: each foe slain pays `TUNING.essence.perTier` (3.5) × its tier, whatever its level
  (`foeEssence` in `src/sim/run.js`; a shadow pays nothing, but Hollow Court's pay again). It buys only tiers,
  recruits and fusions, and **money always matters** (§6): every price is its floor-1 price × the floor's price scale,
  1 + `perFloor` × (floor − 1) (`floorPrice`: ×1, ×2.1, ×3.2, ×4.3 on floors 1–4, and on down), after the discount
  relics. Floor-1 prices: a tier 16 / 36 / 60 / 96 (I–IV), a recruit 8 × its tier × (1 + 0.35 × (level − 1)), a
  fusion 8 × the result's tier. What a battle buys stays about level from floor to floor, and a floor's pay carried
  down buys less there.
- **Wounds carry.** A won battle heals each living body `TUNING.run.postBattleHeal` of its HP (20% since 2026-10-10,
  §6; it was half), the Monarch too unless Court of Bone holds; an altar's heal, one of its three rites
  (Part two §4.5), heals every body to full and raises the fallen (`altarHeal`, `altarRevive`), and nothing else
  raises them (§2.2). So HP, DEF, Undying and Heartwood count between rooms.
- **Upgrades belong to the kind.** A kind's panel: **two tracks** of tiers I–IV with the crosspath rule (the first
  track past II may reach IV; the other stops at II). Tier IV is a rule, never a percentage: a new or remade ability,
  an aura, +ring, or **Colossus** (`size: 2`). Banner is gone.
- **A kind's level is its tiers'.** No level is bought: a kind stands at `TUNING.level.base` + `perTier` × the tiers
  it holds on both tracks, rounded down (`levelOf`; 2 and 0.67 since the fourth balance pass, 0.5 in the economy pass, 0.34 in the second balance pass, so two tiers make level 3, three level 4, and IV and II level 6), and every soul of it with it, healed by what it gains. The stat growth levels gave comes with each tier. A
  recruit joins at its kind's level (a kind new to the run at its first, with no tiers), and its offer is priced by
  that level. Foes keep their floor's levels.
- **Fusions** (`FUSION_LIST` in `src/content.js`: `{ id, name, result, needs: { kind: n }, desc }`). A fusion
  consumes whole pieces of yours, fielded or in the ossuary, exactly `needs` of each kind, costs
  `TUNING.essence.fuse` × the result's tier (× the floor's price scale), and gives one piece of the fused kind, full
  HP, in the ossuary, to be placed. The result joins its kind, with
  the kind's tiers (none for a kind new to the run), at the kind's level, which never falls below the highest level
  of the kinds consumed (the kind's `least`, kept and only ever raised): **a fused piece is never weaker than what
  went into it**. Fused kinds (`fused: true`) never spawn and are never recruited; they have two tracks like any
  kind; most are 2×2.
  Recipes are not discovered: the Codex lists every one from the start. They are the plan.
- The first fusions (content decides the final numbers): **Bone Colossus** (2×2; Tomb Knight ×2 + Bone
  Chanter), **Rime Drake** (Ember Drake + Frost Sprite ×2), **Hive Queen** (2×2; Hive Warden ×2 + Mantis
  Reaper), **Clockwork Titan** (2×2; Clockwork Page ×2 + Iron Golem), **Pale Court** (Will-o'-Wisp ×3).
- The fusion graph (Part two §4.1, 2026-10-15): every kind of tier 4 or less a run can hold fuses three of itself
  into its **trine**, two tiers up (at most 6), made from the kind by one rule where no record is written for it
  (`content.js trineOf`; the Pale Court is the Wisp's, written); the four mixed recipes above stand beside the
  triples; and seven **capstones** of tier 5–6 fuse two fused kinds (Charnel Cathedral, Winter Court, Cinder Wyrm,
  Hive Mind, Engine of Ages, Aurora, Iron Barrow), their rule-like effects registry rules scoped to the piece.
- The first Colossus tiers: Tomb Knight's Bulwark IV (Barrow Wall), and the tier IVs that were Banners.
- **The Monarch has no points.** Nothing is bought for it. It has a base HP (`TUNING.monarch.hp`) and a base
  Command (`TUNING.party.field`: the pieces it fields), and both grow only by relics, every copy adding in full
  (`monarchHp`, `commandOf` in `src/sim/run.js`; the field still stops at `army.board`). Its panel shows those two
  and nothing else: Arise's numbers are the relic's (§2.5), told on the Monarch's card and the relic's, and only
  once the run holds it. The HP relics: Grave Shroud (Common, +30), Bone Mantle (Uncommon, +65), Phylactery (Rare,
  +110), each healing the Monarch by its gain unless Court of Bone holds. The Command relics: Bone Horn (Common, +1, every soul −10% HP), Muster Roll (Uncommon, +1,
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
  Monarch's HP, roster, Soul Lantern's tiers, discounts, Court of Bone's tiles, Arise's reach, tier, raises and haste
  past its first copy, Blood Tithe's cap and tithe, Hollow Court's essence). The on/off rules say what a copy more
  does: Undying rises once more a battle; Mimicry counts a Vanguard as one Warden more; Court of Bone's Monarch stays
  unhealable while Arise's reach grows. `s.relics` is the ids in the order taken, a copy named again (`relicCount`).

### 2.7 Synergies

Kin and role counts over your fielded pieces, a piece counting once, steps at 2, 4, 6 and 8, the 8-step rules;
synergy glow on the board. A fused piece counts once with its own kin and role.

### 2.8 Timer and ends

*Superseded: no bar. Won when no foe stands and none is still to come; lost the instant the Monarch falls; the camp's patience (`TUNING.policy.press`) ends a battle that drags; a boss's fall still crumbles its side.*

One escalation bar is always visible. Won when no foe stands and no wave is left; lost when the Monarch falls
(the run ends) or the bar runs out (a defeat, the run ends). A boss's fall crumbles its side.

### 2.9 Cut

Line, Signal, Lunge, Banner, timing marks, the Monarch's seats and moving the Monarch, stride for your side (a
foe keeps its gait), horns (closed: no), the `march` moment. Late on 2026-10-09: the Monarch's points (its four
stats bought with essence), bought levels, the Rite as a room, and then the two points Arise's copies gave it (its
numbers are the relic's now: §2.5). On 2026-10-10: Flank, a second ground road round your pieces, and its threat
(§6).

Vocabulary after the cut: Piece, Summon, Ring, Road, Wave, Shadow, Essence, Tier, Fusion, Synergy, Relic (Common,
Uncommon, Rare, Legendary), Command. Twelve, plus the behaviours (Walk, Fly) and the statuses. Keystone left
the list on 2026-10-09 (night): the keystones are Legendary relics. Command joined it late that night: with nothing
to buy for the Monarch, relics name it ("+1 Command") and the player has to read it. Domain left it later that
night: it is Arise's reach, and the player meets it only once Arise is held, in the relic's own words. Level is a
kind's tiers read as a number, and Arise's reach, tier and raises are the relic's numbers, read on its card: none is
a word to learn.

## 3. What the player may rely on

*Item 1 is history (pieces move under orders; a move may be undone until the piece acts); items 2–4 stand in the form the code gives them: foes keep to the drawn roads, the roads and the seat are the camp's, the fallen leave the field. The in-battle reads now are the keyword tips, a met foe's reach on tap (Part two §4.8) and the End Turn preview.*

1. **Your pieces never move.** A piece fights from the cell you gave it, all battle: its ranged blows to their range,
   its melee to the tiles beside it (two tiles for a long arm), never past its ring.
2. **Foes walk the arrows until they can hit back**: in a ring of yours that can strike them, with something of yours
   in their own reach; beside the Monarch; or with the way ahead held (a piece of yours, the seat, or a comrade that
   has stopped; behind one still walking they only wait). Only then do they fight, and their melee reaches only what
   blocks them, the Monarch, or a piece beside them that struck them, so a melee foe walks on through your rings to
   the first of those. Every foe on the ground keeps to the arrows; a Fly kind flies straight at the Monarch over the
   walls but never through your pieces: one in its way holds it, though only a ranged blow, or a flyer's melee, can
   strike it. Which kinds fly is learnt by meeting them, and the bestiary keeps it.
3. **The roads and the seat are the camp's**, drawn before you place anything. **Coverage**: in prep every road
   tile is shaded by how many of your rings cover it (melee rings count, though one on the ground cannot reach a
   flyer, which the bestiary will have told you). **The stop line**: a bar on each road tile where a walker first
   comes under one of your rings, the Monarch's among them (`stopLine` in `src/sim/battle.js`): the earliest it can
   halt in them, never that it will (a melee walker passes the bars to what blocks it; a ranged one queued behind a
   stopped comrade halts and shoots before it reaches them). It previews nothing of any foe's own: what a kind does
   there is learnt by meeting it.
4. **The fallen leave the field.** A piece that falls whole goes to the ossuary as the battle ends, its cell and its
   Command free, and stays there until an altar raises it.

## 4. Interface

*The layout, the tabs, the Field tab's drag and drop, the Fuse section, the Monarch's panel, the frontier and the prep overlays that are the roads stand; the rings, coverage and the stop line went with the halting rules. The battle screen since is the turn's: orders by tap, Undo, End Turn and its preview, the foes' playback, a met foe's reach on tap.*

The standing rules hold: one scaled landscape layout (`src/frame.js`), one view at a time behind tabs, nothing
that needs hover, Shift or a key.

- **Layout**: the board on its side as in Bloons TD, the camp on the right beside the slim panel, the foes
  entering from the left; a thin bar above (floor, essence, Monarch HP, the tabs as icons). On a phone a tile is
  never under 44 CSS px.
- **Field tab** (the default). Drag an ossuary soul onto an open camp cell to place it (a 2×2 shows its footprint
  under the finger, red where it does not fit), onto a piece of yours to swap them. Tap selects. The Monarch cannot
  be dragged; its cell wears a crown. The panel shows the selected piece: its card, ring, summons, the kind's two
  tracks and the level they give (no level button), and **Fuse**: the recipes this kind is part of, each lit when
  every part is held and essence suffices, one button each. A recruit card of a kind you hold says what one more is
  worth: the synergy steps it reaches, the tiers it shares, the recipes it fills.
  Nothing selected means the Monarch's panel, with nothing to buy: its HP and Command (the relics that give them),
  and nothing else; Escape or tapping empty ground returns to it.
- **Arise is shown only once held.** Without the relic the Monarch's card lists no Arise, its panel has no line of
  it, and the help page names none. Held, the card's Arise line gives its numbers now (reach, tier, raises a battle,
  the copies, Hollow Court and Blood Tithe), the held relic's tooltip the same (`ariseOf`), and the board draws its
  reach ("ARISE · 5").
- **Prep overlays**: the roads (arrows), Arise's reach (once held), the selected piece's ring, coverage, the stop
  line (where a walker first comes into your rings: the earliest it can halt in them, so its legend, its tile's
  tooltip and the help say), synergy glow.
- **The default frontier**: at the run's start and on each floor's arrival the fielded pieces take a default
  placement (`frontier` in `src/sim/run.js`): the tankiest melee piece on the road tile most entry roads pass
  before the seat, outside the Monarch's ring, and each other piece where its ring reaches all round it while
  covering as little of the road beyond as it can: the melee walkers on those roads are blocked by the front piece
  (in every camp it stands on 18 to 21 of the 21 entry roads), and the shooters that halt to shoot at it stand in
  the others' reach. Fight pressed at once makes sense; the player moves pieces from there. A camp drawn again on the next floor down (the deep
  reuses the last floor's) keeps the layout the player gave it. A recruit with room on the field joins on the free
  cell nearest the Monarch (`join`), never out ahead of the pieces placed.
- **Battle**: the same board; the wave counter, the escalation bar, counts on pieces, the horde drawn as many
  small sprites per tile while the sim counts one piece; a 2×2 piece drawn large over its four tiles; a flyer
  hovering with a ground shadow; Burning as flame on the sprite, Hexed as a violet pall. Pause and speed stay.
- **End**: the death panel's facts shown as a replay beat on the board.
- **Tabs**: Field · Map · Codex. The Codex's glossary is the twelve words, the behaviours and the statuses;
  it gains a **Fusions** page listing every recipe with its result's card.

---

# Part two: the improvement plan (2026-10-15)

The plan decided on 2026-10-15, after the gameplay audit of that day, for taking the game from a working prototype
with one build to a finished product with many. Read this before touching `src/`. It replaced the combat redesign spec
that stood in `redesign.md` from 2026-10-10 to 2026-10-14 (history, `git show f8c536f:redesign.md`; what it decided is
in force as the code and its comments state it: `src/content.js`, `src/tuning.js`, `src/sim/*.js` carry the rules, Part
one the board, footprints, roads, essence, tracks, fusions, summons and the frame). Section 6 says what to build, in what
order, and what each step must measure before the next begins; §8 is the record, each step's numbers appended as it
ends; §9 the standing rules.

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
  ~30 min on four cores (less when a comparison stops early or its base side is cached: below), after every content
  change, **`npm run combos` first**: the book is made from the content by a static formula in seconds and the
  expert's build targets are the book's, so a new recipe or kind is in its sights at once. Between refits its forests
  and route are stale (fitted on the Court's runs); its readers are generic (HP, ATK, reach, tier, role, the recipes),
  so it degrades rather than breaks, and the paired differences are what count.
- **Viability and the ceiling: the outside teacher**, committed to each archetype, 64 seeds each, at the top
  difficulty (§4.6), ~3 h for ten archetypes on four cores. It saturates at the base difficulty (63/64: nothing to
  rank), so it reports clears **and a margin**: the Monarch's HP share and the souls' at the end, battles lost, essence
  left, turns. It needs no refitting when content moves: it judges by outcome, and its playouts are the expert's.
- **The balance pass's numbers: the expert refitted at the milestone** (§4.0's refit), 768 seeds, because "the expert
  ~90%" is defined on a fast player who has learnt the game. The ladder (basic → calculator → expert → teacher) at every
  difficulty is the skill-differentiation measure: its rungs must keep their order and their gaps.
- **Not done in this plan**: no weight search on the content (the 178 numbers are feature preferences, damage against
  danger against a kill's worth, not content, and stay where the search put them); no forest rounds beyond the
  milestone refit; no new learner (but the recruit's, the user's word of 2026-10-16: §7). Measured and rejected (§8):
  search alone over a weight-free player (0 of 12). Planned and set aside the same day: a learnt player at every
  decision fitted by expert iteration, which the spike showed would need the old expert as its seed anyway.

**The harness** (`autoplay.js`, Step 0): `--builds [--player expert|teacher] [--commit <archetype>|all] [--scale
<difficulty>] [--runs n] [--seed s]`: an archetype is a fused kind (a node of the recipe graph) or a synergy; a
committed run reads a book filtered to the archetype's combos (`BOOK.combos` by `fuse`, `kin` or `role`; `targetOf`,
`comboWorth`), so its draft, recruits and spending follow it, and the teacher's candidates (`recruitCandidates`,
`spendCandidates`) follow the same book. A row an archetype: clears, progress, the margin columns, the share of runs
that made its fusion or reached its synergy and the median battle it came on; a last block for free play: the
archetype shares, kinds held, fusions made, synergies active, relics bought (the diversity block, also in the ladder
report). `--pool`: the availability table of §1 from `spawnPool`, and for each recipe the expected battles offering
each part by floor. Noise as the old spec reported it: ± one standard error of the paired difference; 64 seeds
resolve ~6 points of clear rate, 256 ~3. **A comparison may stop early** (§8, "Cheaper measurement", 2026-10-16:
`--paired a,b --sequential`, `--builds --sequential`): seeds in blocks of 64 in seed order, a prefix of the fixed run's;
stopped for a win or a loss at |z| ≥ 3 on progress (2.03 at the last block of 768, 1.98 of 256: Haybittle–Peto,
two-sided α 0.05 over every look), for futility when b's one-sided 95% upper bound is under a point of progress and b
is not ahead on clears, else played to the end, level there with the clears the tiebreak. The selection and
confirmation seed sets stay distinct (§9): a change chosen on `rfs` stopped early is still confirmed on `rfc`. Every run
the harness plays is kept in a cache keyed by the code, the expert's bytes and the run's options, and never played
twice.

## 4. The design

### 4.0 The expert, as it stands

The autoplayer of f8c536f, kept whole. One file holds what it learnt, `src/sim/expert.json` (3.7 MB: `tree`,
`rules`, `forest`, `outforest`, `route`; `bundle.js` sets or splits a part), one table what was searched,
`TUNING.expert`, and one what it reads of the content, `src/sim/combos.json`. Every decision is one shape: read the
situation once, list the options, read each as named features, let a tree force or filter, weigh the rest, and where
a forest is confident, take its word.

- **In battle** (`policy.js expertTurn`, the fast turn: each piece once, no beam): the **situation** read once a
  decision (`situation`, ~68 named conditions in `expert.js conditions`: the Monarch's danger and whether it can be
  felled, lines of fire on it, threats by road and turns to reach, foes by threat type, the wave due, the camp's
  patience, killable foes, each piece's exposure, synergies); a **plan** chosen by a tree once a turn and kept
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
  regression trees over 252 inputs, the conditions, the features, the same less the position's mean, and the conditions
  of the board the option leaves, fitted on playouts of every option to the battle's end) overrules that choice where it
  reads another candidate more than δ 0.02 above it (kept at the refit of 2026-10-16, §8, its refit on 160 runs' labels
  no better; worth 5.6 points there). The untouched strike or mend with basics at End Turn. `--audit` names the rule or
  the forest that decided each order.
- **Prep** (`autoplay.js plan`, `planFor`): formations drafted from the plan's posts and the frontier, hill-climbed on a
  static score (`formationFeatures`: the danger the pieces project on the roads, blockers on the roads into the Monarch,
  shooters behind them, healers beside the threatened, the Monarch's exposure, synergies, an Arise holder by the kill
  zone; `TUNING.expert.formation`) under the tree's filters (fill-field, answer-air, block-roads); the **formation
  forest** (`expert.json outforest.prep`, refitted at the refit of 2026-10-16 on the game of 7721702, δ 0.05) picks
  among nine (the plan's, its next five, the best three drafts) by `prepRead`: the run's situation, the coming battle as
  scouted, the formation's own read, and the battle's read of the board it opens on.
- **Growth** (`grow`, `sketch`): the **sketch** is the field's strength (`strength`: a formula over the fielded pieces'
  HP, blows, reach, tiers, summons and the shadows Arise would raise) plus the **book's** value (`combos.json`, made by
  `--combos` in seconds: every fusion, core, kin and role combo ranked by floor by a static formula, with the relics
  that pair with each; the run's target is the combo of the best worth × progress, `targetOf`). Each tier and fusion is
  bought by its sketch gain an essence against the best a tier gives (`tierRate`); the **recruit** by the sketch
  (`weighRecruits`), then the **recruit forest** (`expert.json outforest.recruit`, over the pick and its next five and
  passing on, read by `outsideRead`; the recruit learner's of 2026-10-16, §8): round 2's 200 trees, the largest single
  gain the old spec found (+18 to +21 points, mostly recruiting where the sketch declined), counted twice beside 200
  fitted at the refit on the current game's playouts and 200 on playouts made by the learner itself (a round of policy
  iteration), their mean read, δ 0.25, and a bias of 0.4 toward recruiting on floor 1 (`adjust`) taking off the new
  forests' pass bias, chosen on whole runs: +3.9 points and 41 clears of 768 over round 2 alone (82.9% against 77.6%).
  Its worth is all floor 1's (silenced on floors 2 and 3 it plays level); the Shop by sketch gain an essence against
  tiers (`buyFor`); a relic waiting given by `pickHold`; the draft by the sketch under the ranged rule (`pickDraft`,
  `TUNING.expert.draft`).
- **Route** (`pickRoute`): the **learned route** (`expert.json route`, `ROUTE_LEARNED` true: a model tree over the run's
  situation and each room's scouted features, fitted by `fit.js` on 10,435 room choices played out; kept at the refit,
  its refits level or worse), the hand tree (`TREES.route`: a wounded army to an altar, never an elite on long odds or a
  hurt Monarch) its fallback.
- **Hand and learnt.** Written or searched: the readers (vocabulary, generic), the tree's rules, the weights, the plan,
  the formation score, the sketch, the book's formula, the draft and hold rules. Fitted on playouts: the formation's
  forest on the game of 7721702 (the refit, 2026-10-16); the battle and the recruit's forests and the route on f8c536f's
  content, each kept at the refit as worth 7, 15 and 5 points of clears there; beside the recruit's, the refit's of the
  current game and one of the learner's own playouts (2026-10-16). Searched on whole runs: the recruit's bias toward
  taking on floor 1 (the recruit learner).
- **Strength and cost.** ~4.4 s a run (the game of 7721702, a core of four busy), ~2.1 s since the speed pass (§8);
  78.4% on 768 seeds `rfc` after the refit (the shipped expert 76.2%); 82.9% on 768 seeds `rcd` after the recruit
  learner (the refit's 77.6% there); 99.5% of battles won; its deaths on floor 1 (14% of runs) and in the Sovereign's
  room (2%); ~33 battles a run. At f8c536f: ~7–9 s a run, 77.7% on 768 seeds `fin` from the trio start, 65% on
  `aud-0…59` with the draft. The ladder: basic 0%, calculator 0%, expert 65–83%, outside teacher 98%.
- **What a content change does to it.** The book must be remade (`npm run combos`; the content test fails a recipe the
  book lacks). The readers need nothing for a new kind, relic or recipe; a new effect op or shape needs its line in the
  readers (`estimate`, `STATUS_WORTH`). The forests and the route go stale and keep playing. **The refit** (a milestone,
  overnight on four cores; the modules' headers give the flags): battle labels `npm run teach` (300 runs of the expert,
  `--draw state`, ~3 h) and `npm run forest`, out-of-battle labels `npm run outside -- --label --phases recruit,prep`
  (~3 h) and `npm run outforest`, the route `npm run teach -- --route` then `--fit`; each part set by `npm run bundle`,
  and kept only on a paired gain on 768 fresh seeds (`--paired expert:a.json,expert:b.json`). The refit of 2026-10-16
  (§8) kept the formation's forest; it found the recruit's labels (one decision played to the run's end, by a base that
  decides the rest) pricing a pass as nearly free; the battle forest's refit on 160 runs' labels played no better than
  the old one. The recruit learner the same day kept the refit's recruit forest and one of its own playouts beside the
  old one, their pass bias taken off by a correction searched on whole runs (§8): a recruit forest's refit is judged,
  and corrected, by whole runs, and its next round's labels are made by the expert it ships in (`--recruits 1,0`:
  floor 1's alone).
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
  §7). **Since 2026-10-16 a trine counts as the three it was made of** (§7.7, the user's word). The roster (12) and
  Command (3–6) bound how far the graph is climbed in one run, which is the point: a run chooses where on it to stand.

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

### 4.9 Elements: one local rule each, for the player to combine (2026-10-17)

The user's words, in order: synergies of this kind should not be rules over a team ("that's too complicated"); they
"should occur as individual elements, and it should be up to the player to combine them in a powerful way", as a
Spire deck's cards do (lightning spam is "spending all your energy in a turn" plus one card that channels it); and
beyond multipliers, "ways to go infinite, mass poison stacking, defense being attack, etc." using the mechanics that
exist; then "pick the top 10 easiest to implement", and "remove the ability to fuse during battle. Fusing should be
done outside battle". This section is that plan; nothing of it is built (the user's word: "write the plan").

**What the audit of 2026-10-17 found.** No rule reads a status on a target: the only status payoffs are the statuses'
own stat mods and ticks (Burning 12 and Bleeding 8 true damage a turn a stack, capped at 3 and 5, nothing amplifying
them), and Hexed's lost act. The eleven synergies are counts of kin and role; three touch statuses by the way they are
built (Echo lays every status twice, Dragonfire bursts a single-target blow's status onto the neighbours, Frenzy resets
skills on a kill). Status themes follow the kins (Drakes burn, Undead and Sprites lay Brittle, Constructs and the Court
Hex, Insects and the Bloat Wither; Bleed is the Mantis alone) and no rule rewards any of them. In Spire's terms the
game has generators and multipliers and no payoffs, and the one engine in play (Echo, the Chanters' Dirge, the Court's
Pale Fire) is the monoculture.

**The principle.** An element is one record with one local rule: a status, a piece relic on a moment of its holder, or
a Legendary with a rule scoped to its holder (the forms §4.4 allows; no rule below Legendary). It reads something the
player can pump (stacks on a foe, kills, tiles moved, the Monarch's HP, shadows standing) and never counts a team. The
combinations are the player's: a generator, a multiplier and a payoff from different sources. Every number below is a
placeholder.

**The ten**, the easiest first, with what each combines with and the code it needs:

| Element | Form | Rule | Combines with | Needs |
|---|---|---|---|---|
| Rooted | status, debuff, 1 turn | Move `set` to 0 (the `set` op beats Hasten's add) | a hold for the pile-up a blast pays off | record; `STATUS_WORTH` |
| Snare | Uncommon piece relic, on blow | its target Rooted | any shooter; Shape blows | record |
| Bloodlust | status, buff, the battle, 8 stacks | +6% ATK a stack | whoever kills | record; `STATUS_WORTH` |
| Butcher's Hook | Rare piece relic, on kill | the holder gains Bloodlust (Feed) | Frenzy, Deathblow, Reaper's Hunger | record |
| Powder Keg | Rare piece relic, on blow | 10 true damage a stack of Burning on the target, the fire spent (Detonate) | the Hound, Firebrand, Echo, Dragonfire | the `per` field |
| Glass Hammer | Rare piece relic, on blow | 12 true damage a stack of Brittle, the Brittle spent (Shatter) | the Chanter's bolt, the Knight's and Ghoul's tiers, Hunter's Mark | the `per` field |
| Headsman's Hood | Rare piece relic, on blow | 25 true damage more to a Hexed foe, the Hex left (Executioner) | the Court, the Hag, the Golem; a Hexed foe never counters, so melee | the `per` field |
| Plague Mask | Rare piece relic, on blow | 8 true damage for each harmful status on the target (Plague) | the Hag's Hex and Wither, Brittle, Burning | the `per` field |
| Reaper's Hunger | Legendary, a rule | a kill while your orders are taken gives the holder its act again (the infinite) | 1-HP foes, Deathblow, a trine's blast | an `onKill` rule |
| Seven-League Boots | Legendary, a rule | its blows ×1.5 on a turn it has moved 3 tiles or more (a charge) | Hasten, Ambush, the Hive Standard | a `modify` rule |
| Last Candle | Legendary, a rule | while the Monarch is below half, the holder is Desperate (the glass Monarch) | Blood Tithe, Court of Bone, the HP relics | an `onTurn` rule |
| Grave Powder | Legendary, a rule | while the holder stands, a shadow of yours that falls bursts: 20 true damage to every foe beside it (the sacrifice horde) | Legion, the Chanter's summons, Gravedigger's Spade | an `onFall` rule |

Two statuses and ten relics: twelve records for ten elements.

**The vocabulary it needs: one field.** A relic's damage effect may carry `per: { status }` (the amount once for each
stack of that status on the target) or `per: { tag }` (once for each status of the tag it carries), nothing where it
carries none; and `consume: true`, the statuses counted spent as the damage lands (a `cleanse` event each). In
`turns.js runEffect`'s damage branch, before the amount is dealt, a dozen lines and a `perOf(u, per)` reader; the
content test's `checkEffect` holds a `per` to a relic's flat `amount` and a `consume` to a `per`. Nothing else in the
vocabulary grows: the four rules are `rules.js` entries on hooks that exist (`onKill`, `modify`, `onTurn`, `onFall`),
as Frenzy's, Deadeye's, Ambush's and Undying's are.

**The rules, exactly.** Reaper's Hunger: `onKill`, the slayer the holder (`slew`), alive, `acted`, and the battle in
`phase 'orders'` and `stage 'party'` (never a counter's kill in the foes' turn, nor a tick's at the turn's end): set
`acted` false; the untouched rule uses an act left unspent, the expert's turn does not revisit the piece (its loop is
once a piece), so the refund is the player's. Seven-League Boots: `modify` as the actor, no status tick, a foe the
target, `actor.moved ≥ 3` (tiles this turn): `damage × 1.5`; a counter's too. Last Candle: `onTurn` for the holder's
side, the Monarch standing below half: `addStatus(holder, 'desperate', 1)` (one turn, laid again each such turn, so
it lapses once the Monarch is mended past it; Desperate's own record says "the battle"). Grave Powder: `onFall`, the
fallen a shadow of the holder's side, the holder standing: `runEffect({ op: 'damage', amount: 20 }, holder, around(…, 1,
the foes' side))`, so the holder is credited the kills. Each emits a `rule` event; `codex.js ruleFlares` must then name
a relic's rule ("Relic · its name") or the codex test fails, since it holds every `rule` event in `rules.js` to a flare.

**The expert's part.** Nothing it decides changes. `autoplay.js triggerShare` prices a damage effect by `e.amount ??
hit(e.power)`: with `per` it would read `undefined × stacks`, so price it as the amount a stack and a half of the time
(a guess, a constant). The four rules are priced as every Legendary is, by the flat relic share: the expert will buy
them and never for what they do, as it never gathered a synergy's rule (Step 3's finding). `STATUS_WORTH` needs the two
statuses (the content test holds every status to a worth). The book remade.

**Fusing out of battle alone.** What goes: in `turns.js` the `fuse` order and event, `fusing`, `fusible`,
`fusionsOf`, `fuse`, the battle's `purse`, `spent`, `fused` and `fuse` fields and a part's `into`; in `run.js`
battleSetup's `essence` and `fuse`, closeBattle's payment and `fuseIn`, `'fuse'` in the battle's order list; in
`policy.js` the fusion option of `expertOptions`, its `fuse` switch through `expertTurn`, `fastTurn` and `fastPass`,
`features`' fusion branch; in `autoplay.js` the `unfused` turns and `battleFuse` (the fusions ablation keeps its
out-of-battle half); in `teach.js` a label row's `fusion`; in `engine.js` the Fuse buttons of the piece panel, the
`fused` animation, the battle's `bank`; in `ui.js` the `fusing` state and its buttons; the trine's codex line
("fused out of battle or beside one another in it"). What stays, deliberately: the feature keys `fuse` and `essence`
(`policy.js blank`) and the board feature `spent`, at 0, so the forests' rows keep their columns (`forest.js encode`
reads the features by name; the shipped `expert.json` was fitted on them). The save's version goes to 3 (an older log
may hold an order no battle takes). The tests of fusing in battle go (`turns`, `fusions`, `run`, `policy`,
`ablation`, `builds`; the fuzz snapshot's `purse` and `fused`; the forest test's option key's `fusion` column). The
expert's logs move wherever it fused in battle (24 fusions in battle over the 64 runs of `div-0…63` at Step 8), so no
identity check: a measured step, paired on fresh seeds, if its clears are wanted. The "Measured at HEAD" numbers
above predate it.

**Order of work** (§6, Step 10): the removal first, in one commit, so the expert's logs move once; then the `per` field
with its content test; then the twelve records and the rules; then a test a element (`test/elements.test.js`: Rooted's
Move 0 under Hasten and a foe standing through the foes' turn, Bloodlust's stacks and cap, each payoff's true damage on
a Golem's DEF, spent or not, nothing on a foe carrying none, the act refunded twice and never in the foes' turn, the
Boots after 3 tiles and not 2, the Candle laid as a turn begins and gone once the Monarch is mended, the Powder beside
the fallen shadow alone); then §8's entry. About four hours. A draft of all of it exists as a patch (6,646 lines, the
session of 2026-10-17's scratchpad, `elements-and-no-battle-fuse.patch`): built, 536 tests green, then reverted at
the user's word; worth reading, not applying blind, when the step is taken.

**Measurement, after.** Not a balance pass: the elements go in at placeholders, by the user's word that more mechanics
come before the next one. When it comes: the relics ablation (`--ablations --variants relics`, 0 points at HEAD; the
elements are relics, so the line is theirs to move), the strict rows, and the Shop's supply (four on a shelf, one a
Command relic, Legendaries from floor 2: whether a plan's payoff is offered often enough, the record's open relics
question). The expert cannot show their worth until a reader values a `per` relic by the stacks its army lays and a
rule by what it does; until then the measure is the strict commitment and play.

**The rest of the list** (2026-10-17, not among the ten; each a few lines once wanted): a Burning cap lifter ("this
piece's targets' Burning has no cap"), a Bleed that ticks again each tile a foe walks (the road as a weapon), a Feed
for the run (+max HP on a kill, kept between rooms; needs run state), a ward that strikes ("when Barkskin or Shield
lands on a piece, it strikes the nearest foe", Sanctuary's volley), a Tomb Knight tier whose counter uses DEF (Body
Slam), Charge ("a piece that used no skill this turn deals +50% with its basic"; needs a per-turn flag), a wide army's
bonus ("+10% ATK per empty Command slot"; needs the run's Command in the setup), a turtle's payoff ("a foe that has
stood 5 turns in your reach turns Brittle each turn"), an in-battle essence spend ("pay 20 essence: this piece's skills
are ready"; the purse would have to come back for it). Fusion as a heal (a fused piece enters whole) goes with fusing
in battle.

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

### Step 10. Elements, and fusing out of battle alone (sim ~2 h, content ~1 h, interface ~1 h)

§4.9, in its order: the removal of fusing in battle first (one commit; the save's version 3; the feature keys kept at
0); the `per` field and its content test; the two statuses, six piece relics and four Legendary rules, with the codex's
relic flares and the expert's reader; `test/elements.test.js`; the book remade; §8's entry. Not measured until the
next balance pass (§4.9, "Measurement, after"). The standing rules then gain two lines: fusions are made between
battles, never in one; and power the player assembles is made of elements, one local rule each, never a count of a team.

## 7. Decisions

Taken on 2026-10-15, the user's word: a triple for every kind; fusions of fusions; the teacher as the yardstick for
content; this file the plan, the old spec to history; and, after the spike of §8, **the old expert kept as the
instrument** ("just use the old ai to tune"): no rewrite, no retuning, its forests refitted at a milestone only (§3,
§4.0), its dead half removed with the logs held byte for byte (Step 0b). Set aside the same day: the autoplayer rewritten as forests fitted by expert iteration, and search alone.

Taken on 2026-10-16, the user's word, before the expert's refit labels anything (so it learns the game as decided):
**a boss is never Hexed twice in a row** (one whose act a Hex took shrugs off every Hex until it has acted again), and
the bosses a Hex every turn had held lighter to answer it (the balance pass's draft numbers: floor 2's boss 2.4 HP and
1.6 ATK of its own, the Sovereign 0.45 and 0.6, its court of 2); **a captain a tier above from floor 2** (§4.2's
alternative: a fight's captain drawn a tier or more over the room's target and of tier 3 at least, so a keystone of
the mixed recipes is on offer in every floor-2 fight, its cohort of the room's own kinds), the pool kept as §8's "The
user's rules" says (decision 1); **a trine counts as three toward synergies** (decision 7's
alternative: a trine as the three it was made of, a trine of a trine as three; mixed recipes and capstones once; both
sides alike); **the expert retrained before the content is balanced again**; and **criterion 2 judged by the strict
commitment** (`--builds --strict`, §8's balance pass, part 1), the soft commitment staying the harness's default.

Taken on 2026-10-16: **a new recruit learner**, the user's word ("New recruit learner first"), after the refit (§8)
found the shipped recruit forest worth 15 points of clears and the Pale Court's engine, and both its relabels on one
decision's playouts failing (a pass priced as nearly free, the passes compounding in play). It overrides §3's "no new
learner" and §9's frozen autoplayer for the recruit alone: the recruit forest's advantages corrected and its margin set
by floor, searched on whole runs, and forests fitted on the current game's playouts beside the old one (§8, "The recruit
learner").

Taken on 2026-10-17, the user's word (§4.9): **synergies are individual elements the player combines**, never rules
over a team ("that's too complicated"); the **ten easiest** are the plan's; **fusing is done outside battle** alone.
Written as a plan, not built ("Cancel, I just meant write the plan"): Step 10.

Recommended here, open until the user rules:

1. **`tierFalloff` moves before the balance pass** (§4.2). "No tuning while building" stands; this is called
   structural, since without it there is nothing for a balance pass to balance between. The captain-a-tier-above
   alternative keeps the number. **2026-10-16: the captain taken beside the flattened pool, not instead of it** (§8,
   "The user's rules"): with the pool restored (3, 1) a captain a tier over the target brings the three mixed recipes'
   keystones by the end of floor 2 in 0.2–1.8 battles, with it flattened in 0.8–2.0, criterion 1 met by neither (22 of
   44 both); free play between the two within noise. `tierFalloff` 1.5 and `tierOverCap` 2 stay. Then the captain of
   tier 3 at least (`captains.minTier`, the user's intent): the keystones in 2.9–4.1 battles, 31 of 44 reachable, the
   Rime Drake and the Hive Queen among them, the Clockwork Titan 0.1 short.
2. **Transmute at altars** (§4.5) bends "recruit only: one slain foe a battle": it reshapes a soul, adds none.
3. **Rules below Legendary** stay forbidden; §4.4 uses the forms allowed. If the relics ablation does not reach 10
   points, Rare relics may carry a `rule`.
4. **The Pale Court's identity**: Fae's floor-1 trine, evened by the committed measure (its size, its tier or its
   blows' rests), not the odd one out.
5. **Generated trines** (§4.1) are generative content, which the project has avoided; the alternative is ~17
   hand-written kinds now and one more for every kind added later. Generation with written overrides is recommended.
6. **Trines of trines** reach tier 6 (a trine of a Pale Court trine); the alternative caps the triple rule at
   tier-3 parts (results ≤ 5) and leaves tier 6 to Iron Barrow.
7. ~~A trine counts once toward synergies~~ **Taken 2026-10-16: the alternative.** A trine counts as its parts did
   (three), so the synergy at 4 is a trine and a soul (and Echo whole at 8 two Courts and two Chanters).

## 8. Record

Each step appends here: the date, the seeds, the paired numbers, what was kept. The baseline of the plan is §5. The
record opens before the plan, with what `DESIGN.md` §5–§6 kept of the rules redesign: how it was built (2026-10-09),
its four balance passes and the economy pass (2026-10-09 to 2026-10-10), and the decisions taken and left open then.
The combat spec's own record (2026-10-10 to 2026-10-14) is in `git show f8c536f:redesign.md` §5–§6.

### The rules redesign built (2026-10-09)

No branches: one working tree, each area owned by one agent, `npm test` green at the end. Tests check function,
not balance. The sim, run, content and interface are built together against the rules (Part one; the contract is the
names below); the autoplayer and the integration pass follow.

#### Shared contract

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
`FUSION_LIST`, `FUSIONS`, `fusionDef`; `BEHAVIOURS` walk, fly (flank too, until 2026-10-10: §6); camp maps carry
`'M'`; `SIGNALS` and `BANNER` go; `TRIGGERS` = kill, fall, wave, blow, struck.

`src/sim/run.js` (owned by the run agent): the action `{ type: 'fuse', id, parts: [uid, …] }` (whole pieces; since 2026-10-10,
when stacks were cut); `fuseParts(run, id)` → the canonical parts (the ossuary's pieces first, then the fielded) or
null; `canFuse(run, id)`; `fuseCost(run, id)`;
no `lines`, no Monarch placement.

`src/tuning.js`: `essence.fuse` (seeded: 20, × the result's tier). `board.stepTicks` stays for the foes.

The simplification (late on 2026-10-09; the interface follows it): in `src/sim/run.js`, gone are the `monarch` and
`level` actions, `s.monarch`, `MONARCH_STATS`, `monarchPoints`, `monarchCost`, `monarchStatOpen`, `levelCost` and
`medianLevel`; `join` takes no `lvl`; no room is a `rite`. New: `ariseOf(s)` → `{ copies, domain, raises, tier,
haste }`; `monarchHp(s)`, `commandOf(s)`; `levelOf(kind state)`, `kindLevel(s, id)`, `lowerTrack`;
`onePick(run)` (a reliquary's offers are one pick). `s.kinds[id]` is `{ lvl, tracks, least? }`, `lvl` derived and
kept in step. `TUNING.monarch` is `{ hp }` alone, Arise's numbers `TUNING.arise` (`{ domain, tier, raises, hp, more:
{ domain, tier, raises, haste } }`); in `src/sim/battle.js` `ariseCap(held)`, `ariseTier(held)` and `ariseHaste(held)`
take the relics' rules (`relicRules`), `createBattle` takes the reach as `domain` and the rest from its `relics`, and
`battleSetup` gives no more than that; `TUNING.level` is `{ base, perTier }`; `TUNING.relic.offer` is `{ reliquary, elite, tiers }` and its weights have
no `rite`. Relic keys: `command` (was `field`), `monarchHp`, `soulTiers` (was `soulLevel`), `lowTierDiscount` (was
`levelDiscount`). The ablations `monarch-stats` and `levels` are gone.

#### Step 1. This document

Done when `DESIGN.md` (Part one here) is written.

#### Step 2. Sim: the battle (`src/sim/battle.js`, `src/sim/unit.js`; `test/battle.test.js`, `test/relics.test.js` (was `keystones.test.js`), `test/endless.test.js`)

- Out: lines, signals, `lineStep`, `follow`, `join`, `lunge`, the party half of `stepOf`, `timingMarks`,
  `battle.signals`, the `march` trigger, the unit fields `line`, `leg`, `home`, `leader`, `offset`, `lunges`,
  `banner`. `fired` stays for the reserve (`time`, `break`).
- In: footprints on the tile index (`battle.at` holds the ground unit on each of its tiles, `battle.sky` the flyer;
  `occupy`, `fall`, `crumble`, `fit`); `around` and `foeWithin` measured from a unit's footprint and deduplicated; Shape expansion on
  footprints; `flyStep` (since 2026-10-10 the air road, `airOf`: §6); melee cannot strike a flyer, and a ring holding only unstrikable flyers reads empty; the
  `dot` effect op (true damage × stacks); `onFall` death bursts; `trigger(battle, 'wave', …)` as the battle begins
  and when each later wave begins to enter; `ringTarget` with a flyer's road distance.
- `chooseAction` becomes: a strikable foe in the ring → the first blow it can afford, else bank; else an ally
  ability it can afford; a foe steps (its behaviour) when due.
- Tests: footprint occupancy and rings; a flyer's path over a wall; melee misses a flyer and a ranged blow does not;
  Burning ticks true damage per stack and ends; a death burst; a `wave` trigger; every line, lunge, Banner and
  timing-mark test deleted. (A 2×2 blocking the Flank field two wide was tested until Flank went on 2026-10-10: §6.)

#### Step 3. Sim: the run (`src/sim/run.js`; `test/run.test.js` but its autoplayer tests, `test/tracks.test.js`)

- Out: `s.lines`, `cleanWhen`, `cleanLine`, `isMarch`, `clipLines`, `LINE_MAX`, `lineActions`, the `line`
  action, `seatNear`, the Monarch in `place`.
- In: the Monarch on `monarchSlot(camp)` every floor; `canPlace` by `fits` and never onto the Monarch's cell; a
  Colossus tier bumping pieces that no longer fit to the ossuary; `fuse`, `canFuse`, `fuseCost`; `legalActions`
  listing one fuse per recipe that can be made (the ossuary's pieces first); `battleSetup` without lines;
  `autoPlace` honouring size.
- Tests: the Monarch fixed on `'M'` in every camp and refused by `place`; a 2×2 placed, refused where it does not
  fit, bumped by a Colossus tier; fuse consumes exactly, pays, lands in the ossuary, joins its kind, refuses a
  short set and a wrong kind; replay and the fuzz cover `fuse`; every line test deleted.

#### Step 4. Content (`src/content.js`, `src/tuning.js`, `src/assets/units/*`; `test/content.test.js`, `test/enemy.test.js`)

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
  resolve and the result is `fused`; camps as above; behaviours walk, fly.

#### Step 5. Interface (`src/board.js`, `src/ui.js`, `src/engine.js`, `src/codex.js`, `src/keywords.js`, `src/main.js`, `src/css/*`, `src/style.css`)

- Out: line drawing, signal markers, the signal cycle, timing marks, the line section of the panel, the Monarch
  drag, the Orders vocabulary, `timingMarks` and `SIGNALS` imports.
- In: footprint rendering and drop preview; coverage; the crown on the seat; the Fuse section; flyers hovering;
  Burning and Hexed FX; the Fusions page; the glossary cut to the thirteen words (twelve since Domain left: §2.9); the help text.
- Done when `node --check` passes on every module and a full run plays in the browser at 1440×900, 1024×768 and
  852×393 with no console errors.

#### Step 6. Autoplayer (`src/sim/autoplay.js`; `test/planning.test.js`, `test/ablation.test.js`, the autoplayer tests of `test/run.test.js`)

- Out: lines, shapes, wings, seats, `park`, the `lines` ablation.
- In: drafts that place 2×2 pieces where they fit; the expert weighing each fusion it can make by rehearsal, as it
  weighs a tier; basic never fuses; a `fusions` ablation.

#### Step 7. Integration

`npm test` green; every module `node --check`; the README and this file's §6 brought up to date.

Steps 2–7 were built on 2026-10-09: `npm test` green (218), every module passes `node --check`, and a full run
played in Chrome at the three sizes.

### The balance passes before the plan (2026-10-09 to 2026-10-10)

Four balance passes and the economy pass on the rules redesign, Step 8 of its plan ("play the whole run, then the single balance pass"). Their yardstick was the expert of the time and its ablation bands (core 25–50 points of clear rate, extras 8–25); their numbers predate the turn-based battle and are history.

**The first balance pass (2026-10-09, evening)**, kept as history: its numbers were measured under the rules before the
night's (§6, "how foes come at you" and after). Yardstick: the rebuilt expert and its combo book (`--combos`,
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
noise. (A `--decisions` fault noted here, a refight shuffling a 2×2 piece onto a taken tile, could not be reproduced
in the cleaning pass of 2026-10-09 and is taken as gone.)

**The second balance pass (2026-10-09, night), done.** Why: the night's rules (foes walk the roads doing nothing else
until they can hit back, no foe melee reach, the Monarch's ring 1, the fallen to the ossuary, the default frontier)
made the expert unbeatable: 32 of 32 clears, every battle won, battles on floors 2–4 over in about 10 s, 0.13 of 18
bodies lost a battle; only tracks and formation registered when ablated. Method as before: the combo book regenerated
first, after every material change and at the end; `--ladder` for the expert and basic; `--ablations` on 32 seeds a
round (13 sweeps, three of them the final numbers on the seed sets `sim`, `b` and `c`, read together, paired by seed:
96 seeds, a drop's standard error 3–5 points); `--necessity` once; numbers only. About two hours of measurement.

| | before (32 seeds) | after (64 seeds) |
|---|---|---|
| expert clear | 100% (no run lost, no battle lost) | 93.8% (died fl 1 reach; fl 2 reach ×2; fl 3 fly) |
| basic clear | 0% (87.5% of deaths on fl 1: reach 16, burn 10, drain 2; fl 2 reach 3, fly 1) | 0% (85.9% on fl 1: reach 29, burn 21, drain 3, shape, clock; fl 2 reach 6, drain 2, fly) |

Ablations of the expert, drop in clear-rate points (clear-eq in brackets); the full expert 100% before, 94.8% after:

| | tracks | formation | bodies | fusions | legendaries | relics | synergies |
|---|---|---|---|---|---|---|---|
| band | 25–50 | 25–50 | 25–50 | 8–25 | 8–25 | 8–25 | 8–25 |
| before (32 seeds) | 25 (10) | 22 (29) | 13 (4) | 6 (2) | 3 (0) | 9 (6) | 3 (5) |
| after (96 seeds) | 53 (33) | 31 (51) | 22 (18) | 7 (5) | 9 (4) | 31 (20) | 8 (7) |

What changed, and why:

- **Foes on floors 2–4 ×1.44, ×1.71, ×2.03**, HP and ATK alike (`spawn.foeHp` 1.46/1.49/2.22, `foeAtk` 1.37/1.49/2.12;
  were 1.01/0.87/1.09 and 0.95/0.87/1.04). Uniform ×1.3 left the expert at 97%; ×2 at 69%, six of its ten deaths at
  floor 2's door. Steepest at floor 4, where the expert's army has grown most, so floor 2 stays survivable and the
  late floors need the build. Floor 1 untouched: it already stops basic.
- **A level is 0.34 a tier** (`level.perTier`, was 0.5: six tiers make level 4, not 5) and **the five count tiers add
  six bodies** (were three; their text and the content test with them). Together, because the count tiers are tiers:
  every body they add is in the tracks ablation too. At 0.5 a tier, four bodies read bodies 5 and tracks 50 (64
  seeds), six bodies 13 with tracks 53 and fusions −3 (32); a level of the tracks' power moved into their bodies read
  bodies 25, tracks 38 (32), the most separable mix found (these three with the synergy steps then ×1.5, below).
- **Equinox (Rime Drake, Frostfire IV) and Grave Breaker (Bone Colossus, Wrecker IV) lose their crowd conditions**
  (3+ and 2+ foes; the Equinox tier's text with it). Their tiers grow the ring (to 5, to 2) past the piece's other
  blow (3, 1), and a ring holds a shooter that can hit something from it: a lone one halted 4–5 tiles off shot,
  unanswered and healed through, to the tick ceiling. Three of five full-expert defeats in one sweep, and four of ten
  in its bodies ablation, were this stall.

Tried and reverted: the synergies' stat steps ×1.5 (their ablation did not move, and the foes' steps grew too); the
fused kinds' HP and ATK ×1.3 (fusions unchanged, and tracks fell to 25 as fused pieces stood in for tiers); Arise's
reach 7 (legendaries unchanged); harder-hitting, frailer foes (ATK ×1.25, HP ×0.9: no help to the defensive extras).

Missed, and why:

- **Bodies (22) and fusions (7)** sit about a standard error under their floors, **tracks (53) and relics (31)** as far
  over by clear rate (in band by clear-eq). They pull against each other. Bodies cannot rise without tracks rising
  (the count tiers are tiers) unless the tracks' other power falls, which is what 0.34 a tier did. And the two big-
  piece mechanics stand in for each other: the bodies-ablated expert fuses nearly twice as often, the fusions-ablated
  one leans on its count tiers, so whichever is stronger hides the other. Past this the nudges are below the noise.
- **Defence buys the expert little under the night's rules.** Foes walk past your pieces; its army loses about 0.5 of
  29 bodies a battle, and its runs end at the Monarch (a reach, fly or flank foe come through), not in a beaten army. So
  HP and DEF (Undead's steps, Undying, Heartwood, a stack's pool) are worth little, and a mechanic worth a tenth of the
  army's power cannot move a 95% clear rate by 8 points. For the defensive extras to count, something must hit your
  pieces on its way: today only a shooter halted in your rings and a blocked melee foe do.
- **Two autoplayer distortions, reported, not compensated.** (1) Court of Bone with Blood Tithe: in 32 runs the expert
  took Court of Bone 17 times and Blood Tithe 31; with both, the Monarch stands at 1–3% of its HP for whole floors (and
  Arise, unable to pay the tithe, raises nothing), and dies to the first blow that reaches it: two of the full
  expert's three defeats in one sweep, while the legendaries-ablated expert cleared 32 of 32 in two sweeps. The book
  weighs a relic in single battles and the offer rehearsals carry no Monarch HP between rooms, so neither sees the
  run-long cost; the fix is in `src/sim/autoplay.js` (weigh relics over rooms with the Monarch's HP carried). (2) A
  ring holds a foe by a blow its `when` forbids (`holdOf` counts every blow): the stall above, and the same shape in
  Frost Wyrm's Killing Cold (its ring the board, "once a foe is below half HP"), Thorn Dryad's Briar Lash, Rot Bloat's
  Miasma and Ash Wyvern's Pyre Rain. Suggested rule: a piece holds a foe only with a blow it could use on it now, its
  `when` included, as a foe's own halt already asks (`armed`). **Both fixed after the pass** (the numbers above
  predate them): (2) by a simpler rule, a piece sees only as far as its blows that need no condition reach (§2.3); (1)
  the expert rehearses the fights ahead in a row, the Monarch's HP carried and mended only as the run would mend it
  (`rehearseAhead`), scores a win under Court of Bone with no heal for the Monarch, counts the Monarch's HP at a
  route's end under Court of Bone, and its book fights a camp's rooms in a row (`bookScore`) and counts no Blood Tithe
  points under Court of Bone (`comboWorth`); `combos.json` is to be regenerated with the pass. Left: the fights ahead
  are at most five, fewer late in a floor, so Court of Bone taken late in a floor with Blood Tithe held can still
  bleed the Monarch over the next floor (1 of 32 probe runs).
- **Essence binds only on floor 1** (3,300–11,500 unspent at a clear, four runs; the expert buys every tier it can
  hold), and Command reaches 9–10 by floor 4 on most runs (the `relics` ablation, with no Command relic, still clears
  64% on a field of three, Legion's aside). Left for the user: they shape what the expert can substitute, not one mechanic.

**The economy pass (2026-10-10), done.** Why: the second pass met its clear rates, but essence bound only on floor 1.
Measured with the combo book regenerated after the two fixes above, the expert ended floor 3 with a median 1,378
essence unspent and its clears with 4,193, spent 22% of what it earned, and from floor 3 on its growth search wanted
nothing more even with essence no object: it held every tier of its fielded kinds. The user's rule: **money should
always matter**; the player should feel very limited, so that spending wisely is the game.

Method. A harness outside the repo played the autoplayer unchanged (a copy of `src/sim/autoplay.js` with a few
internals exported), the expert and basic on the same seeds, and recorded per floor: essence earned (the floor's battles'
pay), spent (on the floor), and **unspent as the floor's last fight began** (that fight's pay is spent on the next
floor; at a clear, the Sovereign's pay comes with nothing left to buy and is left out of the run's spendable essence);
what the growth search would **still buy** at that moment with essence no object (its picks in turn until it wants
nothing: their price and tiers); the **recruits refused for price** (the expert's pick with essence no object costs
more than it holds); at a clear, the share of the six tiers (IV and II) each fielded kind could hold that it holds; and
bodies lost a battle. Defence by refights: each of 32 expert runs' battles fought again without the six defensive
relics, without each one, with the pieces' HP ×0.8 or ×1.25 (the Monarch's untouched), or with their DEF at 0. The
combo book regenerated first, after each material change and at the end. Iterating on 64 expert seeds (2.5 min), confirming
on 128 (`sim` and `b`) and with `--ablations` on 64 (`sim`, then `b`, 15 min each; the "before" sweep on a copy of the
tree at the pre-pass numbers, its book regenerated there). About two hours of measurement.

| | before (64 seeds) | after (128 seeds) |
|---|---|---|
| expert clear | 93.8% (died fl 1 ×1, fl 2 ×2, fl 3 ×1) | 93.0% (fl 1 ×1, fl 2 ×2, fl 3 ×2, fl 4 ×4) |
| basic clear | 0% (85.9% of deaths on fl 1) | 0% (75.8% on fl 1: reach 49, burn 38, drain 7; fl 2 30, fl 3 1) |

The expert's economy, floor by floor (medians; "unspent" as the floor's last fight began, beside a tier II's price
there; "still wanted": what its growth search would buy then with essence no object, in essence and tiers; recruits
refused for price, of its recruit rooms):

| floor | earned | spent | unspent | tier II | still wanted | recruits refused |
|---|---|---|---|---|---|---|
| 1, before | 169 | 172 | 8 | 45 | 831, 12.4 tiers | 20% |
| 2, before | 535 | 415 | 31 | 45 | 315, 4.8 | 0% |
| 3, before | 2,146 | 555 | 1,378 | 45 | 0, 0 | 0% |
| 4, before | 2,968 | 33 | 4,193 | 45 | 0, 0 | 0% |
| 1, after | 175 | 180 | 7 | 45 | 910, 14.8 tiers | 14% |
| 2, after | 251 | 210 | 19 | 95 | 1,705, 11.5 | 18% |
| 3, after | 889 | 804 | 58 | 144 | 1,314, 6.2 | 13% |
| 4, after | 977 | 785 | 131 | 194 | 839, 2.8 | 13% |

Over a run: spent of what it could spend, median 22% → 94% (mean 24% → 88%, pooled over the clears 22% → 87%); at a
clear, the share of its fielded kinds' tiers held, median 100% (mean 88%; 14.5 tiers over 2.9 kinds) → 57% (mean 61%;
12.1 over 3.8 kinds); tiers held in all 19.9 → 14.8; fusions 1.6 → 1.2 a run. Basic spends a median 78% → 85% and
dies before any of this binds it. Bodies lost a battle (the expert): 0.43 of 28.5 → 0.36 of 21.5.

Ablations of the expert, drop in clear-rate points (clear-eq in brackets); before, 64 seeds (`sim`), the full expert
93.8%; after, the sweeps on `sim` and `b` and the two paired by seed (128 seeds, a drop's standard error 2.5–5 points),
the full expert 93.8%, 92.2%, 93.0%:

| | tracks | formation | bodies | fusions | legendaries | relics | synergies |
|---|---|---|---|---|---|---|---|
| band | 25–50 | 25–50 | 25–50 | 8–25 | 8–25 | 8–25 | 8–25 |
| before (`sim`) | 59 (47) | 25 (42) | 16 (15) | 2 (3) | 9 (3) | 23 (19) | 11 (10) |
| after (`sim`) | 34 (35) | 25 (37) | 33 (20) | 6 (3) | 25 (12) | 14 (7) | 6 (5) |
| after (`b`) | 33 (22) | 36 (51) | 25 (11) | 8 (6) | 34 (19) | 17 (15) | 9 (5) |
| after (128) | 34 (28) | 31 (45) | 29 (15) | 7 (5) | 30 (16) | 16 (12) | 8 (5) |

What changed, and why:

- **A foe pays for its piece, by its tier alone**: `foeEssence` = `essence.perTier` × tier, whatever the piece's count or
  level (was 2.5 × tier × (1 + 0.35 × (level − 1)) for each body). `perTier` 3.5 keeps floor 1's pay (its foes stand
  near level 2: 2.5 × 1.35 ≈ 3.4); floors 3 and 4, with cohorts of three and four bodies at levels 4–6, paid three times
  what this pays. A battle's pay before relics: 14, 21, 67, 65 on floors 1–4 (was 14, 45, 160, 186).
- **Every price grows with the floor**: a tier, a recruit and a fusion cost their floor-1 price × `floorPrice` = 1 +
  `essence.perFloor` × (floor − 1), `perFloor` 1.1 (×1, ×2.1, ×3.2, ×4.3; the fusion price now goes through the same
  `price` as the others, with no discount of its own). Income still grows down the floors (waves from floor 3 double a
  battle's pieces), so what a battle buys runs about 15, 10, 26, 22 floor-1 essence: floor 2 is the squeeze.
- **Foes on floors 2–4 ×0.75, ×0.75, ×0.68** (`foeHp` 1.1/1.12/1.52, `foeAtk` 1.03/1.12/1.45; were 1.46/1.37,
  1.49/1.49, 2.22/2.12), in four steps as the price scale settled: an army holding about 60% of its tiers met foes
  tuned for one holding all of them (78% clears at the first step, deaths on floors 2 and 4). Floor 1 untouched.
- **A level is 0.5 a tier again** (`level.perTier`, was 0.34). With essence scarce the expert holds 12 tiers of its
  fielded kinds at a clear, not 14.5, and at 0.34 the tracks ablation fell to 19 points (under its band; the
  tracks-ablated expert made 205 fusions in 64 runs to the full one's 72, the essence standing in for tiers). At 0.5 it
  reads 34. Two tiers now make level 3, so basic's floor-1 tiers lift it a level: its floor-1 share of deaths fell from
  86% to 76%.

Tried and reverted: `perFloor` 1, the cleanest sentence ("× the floor"): the expert cleared 94.5% of 128 but floor 4's
median unspent rose to 152–212 against a tier II's 180, and the pooled spend fell to 85%; `perFloor` 1.25: floor 2 so
tight (a battle's pay worth 10 floor-1 essence) that the expert cleared 84% even with floor 2's foes eased; for
defence, doubling the spawn weights of the floor 2–4 ranged and Shape kinds (Ember Drake, Marsh Hag, Frost Wyrm), and
glass-cannon foes on floors 3–4 (ATK ×1.9, HP ×0.7): neither moved the pieces' HP lost a battle (7%) nor what their HP
is worth (below).

Missed, and why:

- **The spend tail is the autoplayer's.** The median clear spends 94%, but the pooled share is 87%: at floor 4's last
  fight, in 39 of 119 runs the growth search wants nothing even with essence no object, with a median 546 unspent
  (the 80 runs that still want spend 94.7%). Seed `sim-0`: 2,364 unspent, seven Bone Chanters at IV and II and a stack
  of eight Frost Sprites at [1, 1] whose next tier (194) it declines: under the level's rounding that tier gives no
  level, and its sketch (`grow`: one purchase at a time, taken only past `EPS`) cannot see a tier whose worth shows one
  tier later. Not compensated with numbers; the fix is in `src/sim/autoplay.js` (weigh a track's next two tiers
  together, or a tier's level as a fraction).
- **Defence still does not register through HP or DEF.** Refights, per battle, before → after: the pieces' HP ×0.8 costs
  0.2 → 0.1 points of battles won, ×1.25 and DEF 0 nothing; Heartwood, Balm, Blood Chalice, Iron Oath and Tower Shield
  each 0–0.1. The six defensive relics together cost 0.9 → 2.2 points (floor 4: 2.4 → 5.1): Undying alone 0.5 → 1.2 (floor 4
  1.6 → 3.1), a fallen piece back; every other one alone 0–0.1. The army loses 6% of its HP a battle; foes walk past your pieces doing nothing
  and die fast, the shooters that halt in your rings are shot down first, and a run ends at the Monarch (reach, flank,
  fly) or in a cascade of pieces fallen to the ossuary with no altar near, not in a worn-down army. No number tried
  moves this. Suggested, for the user: wounds that carry (`run.postBattleHeal` 0.5 → about 0.2, a number but not a
  foe's: left alone), or a rule that makes the walk cost something (a walking foe strikes a piece of yours it passes
  within its reach).
- **The ablations sit at their bands' edges.** By clear rate tracks, formation, bodies and relics are in; fusions (7.0 ±
  2.5) and synergies (7.8 ± 3.4) a point under 8, legendaries (29.7 ± 4.3) five over 25, each within about a standard
  error; by clear-eq bodies (15), fusions (5) and synergies (5) are under. Scarcity moved the tracks from over (59) into
  the band and the bodies from under (16) into it: with essence short every tier is a choice, and the count tiers are
  the ones the expert makes. Fusions and synergies stay what the two passes before found: the expert substitutes for
  them (tiers and recruits for a fusion; another kin's stat steps for a synergy), and no number tried here moved them.

**The fourth balance pass (2026-10-10), done** (the economy pass was the third). Why: since the economy pass the rules
moved under the numbers (§6): foes walk until they can hit back, flyers are blocked by your pieces, wounds carry
(`run.postBattleHeal` 0.2), Flank is gone (the Will-o'-Wisp, Mantis Reaper and Barrow Wight walk the drawn road and
halt in your sight), and the bug hunt fixed the zero heals, the fallen bodies and the gate. `combos.json` predated all
of it. With the book regenerated, the expert cleared 83.6% of 128 and died on floor 1 in seven runs (5.5%: a Pyre
Hound's burn four times, a long duel with a floor-1 shooter three), and two extras read nothing: synergies −2, fusions 2.

Method, as the economy pass's: the combo book regenerated first, after every material change and at the end (the last
regeneration byte-identical to the one measured); the economy harness outside the repo (the autoplayer unchanged; it
reproduces `--ladder`'s runs exactly, checked on 64 seeds before and after), here also able to stop at a floor (floor 1
alone, 256 seeds a level on the set `f`, under a minute) and to play an ablated expert, with numbers patched into its
workers for screens; screens and rounds on 64 expert seeds (`sim`), the confirmation on 128 (`sim` and `b`), and
`--ablations` on 64 seeds of each set read together, paired by seed (128, a drop's standard error 2–5 points). Four
rounds, numbers only, about 2.5 hours of measurement.

| | before (128 seeds) | after (128 seeds) |
|---|---|---|
| expert clear | 83.6% (died fl 1 ×7: burn 4, reach 3; fl 2 ×2: reach, shape; fl 3 ×5: fly 2, shape 2, reach; fl 4 ×7: shape 4, reach 2, none) | 90.6% (fl 1 ×2: burn 2; fl 2 ×1: reach; fl 3 ×8: fly 3, shape 3, reach 2; fl 4 ×1: reach) |
| basic clear | 0% (89.8% of deaths on fl 1: reach 74, burn 31, drain 6, clock 2, shape 2; fl 2 12; fl 3 1) | 0% (76.6% on fl 1: reach 60, burn 29, drain 4, clock 3, shape 2; fl 2 27; fl 3 3) |
| floor 1 alone (256 seeds a level, `f`) | the expert dies there 3.9%, basic 90.6% | the expert 1.2%, basic 84.4% |

The former Flank kinds as killers, in the 128 whole runs a level before and after: the Wisp killed the expert once before and never
after, basic 30 and 31 times (nearly all on floor 1, one of its three commonest killers there with the Frost Sprite and
the Pyre Hound); the
Mantis killed the expert once before (a floor-4 elite), never after; the Wight never killed anyone.

The expert's economy, floor by floor (medians over 128 seeds, read as the economy pass read them: "unspent" as the
floor's last fight began, beside a tier II's price there; "still wanted": what its growth search would buy then with
essence no object; recruits refused for price, of its recruit rooms):

| floor | earned | spent | unspent | tier II | still wanted | recruits refused |
|---|---|---|---|---|---|---|
| 1, before | 174 | 178 | 6 | 45 | 1,150, 19.0 tiers | 15% |
| 2, before | 244 | 197 | 19 | 95 | 2,252, 17.2 | 18% |
| 3, before | 877 | 771 | 50 | 144 | 2,432, 12.4 | 11% |
| 4, before | 956 | 860 | 104 | 194 | 1,855, 7.7 | 20% |
| 1, after | 172 | 176 | 6 | 36 | 952, 19.7 tiers | 18% |
| 2, after | 249 | 217 | 15 | 76 | 1,920, 17.7 | 20% |
| 3, after | 874 | 771 | 32 | 115 | 2,341, 13.4 | 14% |
| 4, after | 941 | 860 | 77 | 155 | 2,220, 9.0 | 24% |

Over a run: spent of what it could spend, median 96% → 97% (pooled over the clears 93% both); at a clear, the share of
its fielded kinds' tiers held, median 63% → 56% (mean 63% → 61%; 11.9 tiers over 3.6 kinds → 15.9 over 4.6); tiers held
in all 15.4 → 19.8; fusions 0.83 → 0.86 a run; bodies lost a battle 0.54 of 20.5 → 0.42 of 19.9. Money still binds on
every floor: the expert ends each with at most half a tier II's price, still wants 950–2,340 essence of growth, and
refuses 14–24% of its recruits for price.

Ablations of the expert, drop in clear-rate points (clear-eq in brackets); before, 64 seeds (`sim`), the full expert
81.3%; after, the sweeps on `sim` and `b` and the two paired by seed (128), the full expert 92.2%, 89.1%, 90.6%:

| | tracks | formation | bodies | fusions | legendaries | relics | synergies |
|---|---|---|---|---|---|---|---|
| band | 25–50 | 25–50 | 25–50 | 8–25 | 8–25 | 8–25 | 8–25 |
| before (`sim`) | 25 (12) | 53 (63) | 44 (12) | 2 (1) | 9 (4) | 14 (6) | −2 (2) |
| after (`sim`) | 34 (20) | 47 (61) | 36 (17) | 3 (1) | 30 (9) | 11 (7) | 17 (6) |
| after (`b`) | 20 (7) | 44 (54) | 30 (9) | −2 (−1) | 28 (8) | 11 (4) | 19 (7) |
| after (128) | 27 ± 5 (13) | 45 ± 5 (58) | 33 ± 4 (13) | 1 ± 2 (0) | 29 ± 4 (9) | 11 ± 4 (6) | 18 ± 4 (7) |

Clear-eq reads low for everything but formation, and that is the fit, not the mechanics: k is the slope through all
seven, and the formation-ablated expert dies on floor 1 (a third to a half of its runs, its progress drop 38–49 points for a clear
drop of 45–53), while every other ablated expert dies on floors 3–4 (3–5 clear points per progress point), so k (1.3
before, 1.5 after) reads the others at about a third of their clear drops. Fit without formation (k 3.9), the 128 after
read tracks 32, bodies 32, legendaries 22, relics 14, synergies 17, fusions 0.

What changed, and why:

- **Pyre Bite's Burning lasts 4 s** (`pyre_bite` dur 120 → 80; Cinder Fang's 10 s still the longer burn). The hound was
  the expert's commonest floor-1 death: one that reached the Monarch laid three stacks (18 true damage a second) and
  burned it for about 190, most of it after the hound fell.
- **The Will-o'-Wisp's EVA 22** (was 28). Walking the road, it halts in your rings and duels from four tiles; at 28 (32
  beside a Frost Sprite, Fae 2) a floor-1 Bone Chanter's bolts landed about half the time, and the duel ran into
  escalation (the expert's floor-1 reach deaths came at 900–1,400 ticks). The two together (with the level step below),
  floor 1 alone: the expert's deaths there 3.9% → 2.3%, basic's 90.6% → 91.0%. The Mantis and the Wight were looked at and left: neither killed the
  expert after the pass (above).
- **The Monarch's base HP 250** (`monarch.hp`, was 220). Floor 1 alone, on top of the two above: the expert 2.3% → 1.6%,
  basic 91% → 89%; and every defeat of the expert is the Monarch's, on every floor.
- **Tiers cost 16 / 36 / 60 / 96** (`essence.tier`, was 20 / 45 / 75 / 120: ×0.8). The expert needed about six points
  more. Floors 2–4's foes ×0.9 gave them (88% of 128) but shrank the drops with the foes (tracks 23, relics 9 on 64);
  cheaper tiers, with the foes left at the economy pass's numbers, gave the expert 91% and the tracks 39 (64 `sim`): it
  holds 19.8 tiers at a clear, not 15.4, and the tracks-ablated expert none. It still spends 97% of its essence.
- **A level is 0.67 a tier** (`level.perTier`, was 0.5): three tiers make level 4 and six level 6 (were 3 and 5); two
  stay level 3, so basic's floor 1 is as it was. Taken with the cheaper tiers, not measured apart from them.
- **Every synergy's stat step doubled**, each `desc` with it (Undead 2 +12% DEF, Undead 4 +30% DEF and +10% max HP, Drake
  2 +16% ATK, Fae 2 +8 EVA, Channeler 2 +12% damage dealt, Scaled Wall and Vanguard 6 20% less damage, and so on; the
  8-step rules unchanged). At the old steps the synergies ablation read −2 and −3 (64); doubled, 17 and 19. Both sides'
  steps doubled, and the ablation strips only yours, so part of what it now reads is the foes' cohorts (Drake 2, Undead
  4) met without yours on floors 3–4. Basic's floor-1 deaths were unchanged by it (floor 1 alone 86% → 84%). Two scene
  tests were rebuilt for it (`test/endless.test.js`: Fae 8's squad without its Frost Sprites, whose Fae-6-quickened
  Frost Lance drained a knight until it fell without a blow; Construct 8's Barrow Wight at level 6, as at 3 the doubled
  DEF and the pages' Purge outlasted it), and `test/fixes.test.js`'s Undead 4 HP step reads 1.1.

Tried and reverted: Burning 5 or 4 a stack (floor 1 alone, the expert 2.3% and 2.0% beside 2.3%, and it weakens every
burn of yours too); floor 1's foe ATK 1.02 → 0.94 (the expert's floor-1 deaths 5.5% of 256, no better); floors 2–4's
foes ×0.9 (above); a level 1.0 a tier (the expert 80% of 64, basic's floor-1 share 75%: two tiers made level 4); the
fusion price 8 → 4 a tier (the fusions ablation 3 → 4); the stat relics up (Whetstone +25% ATK, Heartwood +30% max HP,
Glass Crown +42%, Arcane Focus 55 gauge, Blood Chalice 20%: the relics ablation 8 → 6); the Ember Drake's spawn weight
8 → 6 (the expert's commonest late killer, at floor 3–4 elites: 84% → 83%).

Missed, and why:

- **Fusions (1 ± 2)**, as every pass before found. The expert fuses 0.86 times a run, and without fusions spends their
  parts and essence on tiers and recruits; halving the fusion price changed nothing. Left.
- **Legendaries (29 ± 4)**, a standard error over 25, as in the economy pass (30). They rose with the doubled
  synergies: Mimicry (102 copies held in 64 runs) counts Vanguards as Wardens for them, and Undying (134) is the
  expert's commonest relic. A number on either (Undying's 60%) was not tried: within the noise, left for the next pass.
- **Tracks (27 ± 5)** are in by clear rate but sit near the floor, and read 34 and 20 on the two sets.
- **Clear-eq** reads all but formation under, and formation over, for the reason above; fit without formation all but
  fusions are in.
- Floor 3 now holds 8 of the expert's 12 defeats (Ember Drakes, Bone Chanters, Ash Wyverns and a Hive Drone, all but
  one at elites). Basic's floor-1
  share fell from 90% to 77% (the Monarch's 30 HP and the shorter burn let it through floor 1 more often; it dies on floor
  2, mostly to reach), still above the 70% the user set. Left open, as asked: the Mantis's stand-in Shape threat, and count
  tiers refilling wounds.

### Decisions taken and left open before the plan (2026-10-09 to 2026-10-10)

From `DESIGN.md` §6. Entries that state a rule the battle redesign later changed (rings, halting, the gauge, "no foe melee reach", the stop line, the clock) are history; the rest are in force as the code states them.

Taken:

- Your pieces never move. Rings are reaches; ring-2 melee strikes without stepping.
- The Monarch is pre-placed by the camp map.
- Size is a footprint: 1 or 2; from a kind or a tier IV; nothing else comes with it.
- A fusion consumes exact pieces, costs essence by the result's tier, lands in the ossuary; recipes are public.
- Fly: over walls; only ranged blows touch it. (Its step was the free neighbour nearest the Monarch, over everything;
  since 2026-10-10 it walks the air road and your pieces block it: below.)
- Burning is true damage per stack; Hexed slows the gauge; both cleansable.
- Walk foes fight through your pieces; only Flank routes round them.
- Shadows rise beside the Monarch and hold.
- The board size is left alone. (Relics and keystones were too, until the night's merge below.)

Taken 2026-10-10, after a manual playthrough:

- **Stacks are cut.** One soul is one piece is one body, on both sides. Merging two wounded souls felled one of
  them (the pool's living bodies are ⌈hp ÷ body⌉), and a stack counting once toward synergies made merging a
  trap. A duplicate stays a decision as a piece (§2.2). The five count tiers became summon tiers (2 summons, shadows
  of the kind, gone after the battle); a foe captain's cohort became separate foes of its kind; fusions take whole
  pieces; releasing a soul refunds half its recruit price. Balance for all of it waits for the balance pass.
- **A 2×2 swaps by its footprint**, with the one piece under it, not only the one under its anchor.

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
- Arise is a Legendary relic: without it nothing rises; each copy raises more a battle (its numbers: §2.5).
  Recruiting is not touched.
- Legendaries come where keystones came (won elites and rites from floor 2); Common to Rare from reliquaries,
  won elites and rites (a rite now lays out a relic too). What needs Arise is offered only once it is held.
- The ablations: `legendaries` (every Legendary but Arise) replaces `keystones`; `relics` is the other three
  tiers; `arise` never takes the Arise relic and stays a rules switch.

Taken late that night (2026-10-09): four simplifications.

- **No Monarch points.** Essence buys only tiers, recruits and fusions. The Monarch has a base HP and a base
  Command, and HP and Command come from stackable relics (three of each, Common to Rare; Legion the Legendary
  Command). Every won elite's relics hold a Command relic, so army size is not pure luck.
- **Arise's growth is the relic's**, not the Monarch's: each copy past the first grows it, on top of the raises each
  copy adds; Court of Bone and Blood Tithe still add. One copy is the Arise that was. (As two points a copy, at
  first: they went later that night, below.)
- **Rite and Reliquary are one room**, the Reliquary: relics, Legendaries from floor 2 and free tiers, one pick in
  all. One to three a floor's middle, weighted as the two were together.
- **A kind's level is its tiers'** (`base` + `perTier` × tiers, rounded down; placeholders). Recruits join at it;
  foes keep their floors'. A fused kind never stands below the highest level of the kinds consumed. Soul Lantern
  and Grave Ledger speak of tiers now. The start souls stand at level 1 (they were bought to 2): balance later.
- The ablations: `monarch-stats` and `levels` go; `arise`, `fusions` and `bodies` are the core three. `relics`
  now also takes the Monarch's HP and Command away (Legion aside); `tracks` takes the levels with the tiers.

Taken late at night (2026-10-09): how foes come at you. Playing floor 1, the first fight's two Frost Sprites (ring 3)
parked two tiles from the Tomb Knight (ring 1) and shot it thirteen times while it swung once: a foe halted as soon
as its own ring held a piece of yours, so a ranged foe out-ranged every melee piece for good.

- **Foes walk until your rings or a held tile halt them.** Walking, a foe does nothing else; a ring of yours that
  can strike it holds it (your rings are its vision of you), and so does a held next tile. Halted, it fights.
- **The Monarch's ring is 1**: it holds every foe within a tile, ground or air, and still never strikes.
- **Flank kinds ignore your rings**: they halt only on a held next tile or within the Monarch's ring.
- **Foes have no melee reach, and retaliate**: a foe's melee strikes only the piece in its way, the Monarch beside
  it, and a piece beside it that struck it. The long arm (Grave Ghoul, Mantis Reaper) is yours alone.
- The start souls, and the fielded pieces on each floor's arrival, take a default frontier (`frontier`), and the stop
  line joins the prep overlays.

Taken later still that night (2026-10-09): Arise's numbers.

- **Dominion and Will are gone**, from the code, the tuning and the interface. Arise's numbers are the relic's, a
  copy at a time (`TUNING.arise`): one copy, a foe of tier ≤ 3 slain within 5 tiles rises, 3 a battle, at full HP;
  each copy past the first, a tile farther, a tier higher, 6 more a battle, and the gauge 10% faster. Every number
  is as it was (3, 9, 15… a battle; Blood Tithe and Court of Bone as before), so the balance does not move.
- **Nothing about Arise is shown until it is held.** No Arise line on the Monarch's card, no lock line and no Arise
  columns on its panel (HP and Command only), no Arise in the help; held, its card's line and the relic's tooltip
  give its numbers now.
- **Domain leaves the glossary** (twelve words): the player reads "Arise's reach"; `domain` stays the code's word.
- **Arise's first copy** (it was open): it stays the Arise that was, and "each copy" means each one past it.

Taken later still that night (2026-10-09): where a foe halts, how far your melee reaches, and the fallen. Playtests
of the rule above (a foe halted in any ring of yours that could strike it) found melee foes held by a long ring
standing out of everyone's reach doing nothing: 32% of foe melee pieces never acted, 96 of 97 Hive Drones never
acted, and 6 of 32 runs were lost to the tick ceiling, once with the Sovereign frozen 4 tiles from a shadow Chanter
all battle. Ranged Flankers (Wisps) walked right up beside the Monarch; a melee blow reached a piece's whole ring (the
Ember Drake's Strike hit 4 tiles off, and the Mantis's Phantom Edge tier added nothing); foes in a single-file queue
on the march fired (a follower counted as halted while a comrade still walking held its next tile); and fallen pieces
kept their cell and Command slot after a battle, with nothing saying so.

- **A foe halts only where it can hit back** (§2.4): in your ring only once one of its blows has a permitted target
  from where it stands (a ranged one, a piece of yours in its reach; a melee one, the blocker, the Monarch beside it,
  a piece beside it that struck it), or blocked. Melee foes and drones walk on until something blocks them, they
  reach the Monarch, or a piece beside them strikes them: retaliation now halts them. Ally abilities never halt a
  foe; a halted one still uses them. The test is the battle's own choice of ability, gauge aside (`armed`).
- **Ranged Flankers stop once the Monarch is in range**: Flank still heeds no ring and goes round your pieces, but
  halts as soon as a blow of it reaches the Monarch (a melee one beside it), or when blocked, and fires from there.
- **Your melee reaches 1, or 2 for a long arm** (§2.3): a melee blow's own range where it has one, else the kind's
  `arm` (Grave Ghoul, Mantis Reaper: 2), never past the ring; a ring-growing tier grows no arm. Phantom Edge now
  reaches a tile past the Mantis's scythes; the Grave Ghoul's flavour hints at its drain, not a long arm.
- **A moving queue is no halt**: behind a comrade still on the move a foe waits; behind a stopped one (or your piece)
  it halts if it can strike something, so a shooter still fires over the front rank.
- **Fallen pieces leave the field after a battle** (§2.2), to the ossuary, freeing their cell and Command, until an
  altar raises them; a fallen soul cannot be placed.
- **The stop line stays**, claiming only what it can: where a walker first comes into your rings, the earliest it can
  halt.
- On touch, a tap on a button while a long press's tooltip is pinned presses the button and closes the pin (it used
  to only close the pin for Begin, offers, buys and the like).

Decided while building it:

- "Still walking" is **on the move**: a comrade whose last turn walked it, or queued it behind one on the move (the
  unit's `walking`). A comrade stuck behind a stopped one with nothing to strike counts as stopped, so a shooter two
  ranks back fires; read as "not halted", a stationary queue three deep would have stood silent behind its fight.
- A foe stuck with nothing to strike is **no halt**: it stands, and its ally abilities wait with it (a healer queued
  behind the front rank does not heal), as "ally abilities never halt a foe" reads.
- A Walk foe and a Flank foe each holding the other's next tile (their roads are two fields) stand stuck, never
  queued on each other for good.
- A fallen soul may still be stacked into a piece of its kind (a body down in that pool, on the field or not), fused
  (fuseParts takes the ossuary's pieces first) or released; bodies split off onto the camp need one standing among
  them. The ossuary strip drops a fallen soul's empty HP bar for its FALLEN mark.
- A melee blow with its own range past 1 says it on its line ("Melee 2"); a card's ring line says the kind's arm.
- The default frontier stands as it was: in every camp its Knight stands on 18 to 21 of the 21 entry roads (so it
  blocks the melee walkers there), and the Chanter and Sprite stand within 3 and 2 tiles of it (so the foes before it
  are in their reach).
- Measured, before and after, with the start souls at the default frontier in every battle room of floors 1 and 2
  of 20 seeds (1,399 battles): foe melee pieces standing 10 s or more with their way open, neither stepping nor
  acting, 21% to 0% (floor 1: 6% to 0%); Hive Drones so, 93% to 0%, and drones that never act, 98% to 1%; Wisps
  ending a battle beside the Monarch, 96% to 0% on floor 1; battles at the tick ceiling, 6 to 2; the Tomb Knight's
  actions a battle on floor 1, 7.1 to 6.0. The start souls now win 72% of those floor-1 rooms (98% before): the
  walkers that stood frozen now reach them, which is floor 1 being hard, for the balance pass to weigh. The expert,
  20 seeds of whole runs: foe melee pieces frozen so, 19% to 0%, and the Sovereign, 13 of 18 to none; foe melee
  pieces that never act, 64% to 55% (they die on the way in now, never frozen); Hive Drones that never act, 100% to
  56% (shot down on the way in); the Tomb Knight's actions a battle, 0.2 to 1.6; runs lost to the tick ceiling, 2 to
  1; clears, 18 to 19.

Taken in the second balance pass (2026-10-09, night; §5 Step 8): foes on floors 2–4 tougher (×1.44, ×1.71, ×2.03),
a level 0.34 a tier, the count tiers six bodies, and Equinox and Grave Breaker without their crowd conditions (a tier
that grows the ring past the piece's other blows must strike what its ring holds).

Taken in the economy pass (2026-10-10; §5 Step 8): **money always matters.** A foe piece pays by its tier alone (3.5 a
tier, whatever its count or level), and every price, a tier, a recruit or a fusion, is its floor-1 price × 1 + 1.1 ×
(floor − 1). The expert spends about 94% of what it earns, ends each floor with less than a tier II's price, and at a
clear holds about 60% of its kinds' tiers: choosing what to buy is the game. The essence relics (Tithe Bowl, the
discounts, Hollow Court) are worth more for it. A level is 0.5 a tier again, and floors 2–4's foes ease to meet the
smaller army.

Taken after the economy pass (2026-10-10): three changes. The balance re-check that was to follow them was cut short
and then cancelled by the user, so the numbers stand as the economy pass left them (`level.perTier` 0.5;
`combos.json` from that pass, not regenerated since). Its one reading, at 32 seeds (±5 points) before it stopped: the
expert cleared 88% and the tracks ablation read 20 (under its 25–50 band); 0.67 a tier was being tried and was
reverted, unmeasured. Regenerate the book (`--combos`) and re-check in the next balance pass.

- **Flyers are blocked by your pieces; they only ignore walls** (the user's rule: "Flyers should get blocked by my units
  as well (they just ignore walls)"). A flyer walks the **air road** (`airOf`: the roads flooded from the Monarch's tile
  over every tile, walls included, in the arrows' tie order, so every arrow points strictly closer and no queue
  deadlocks), no longer the free neighbour nearest the Monarch (`flyStep` is gone). Its next air-road tile held by a
  piece of yours, on the ground or in the air (a shadow of a flying kind too), blocks it: it halts there and fights the
  blocker, as a walker does. A foe flyer there queues it (a moving queue is no halt); a ground foe never blocks a flyer,
  nor a flyer a ground foe. Everything else about halting stands: in your rings only ranged sight holds a flyer, and
  only where one of its blows can hit something of yours; it never Flanks. Melee still never strikes a flyer, its
  blocker's either: a Tomb Knight holds a drone it cannot hit, and your ranged pieces kill it.
- Decided while building it: a flyer's blocker is a piece of yours on the ground on that tile before a flyer over it
  (the one its melee can strike). A flyer's melee meets a flyer in the air (decided after: a melee foe flyer held by a
  flyer of yours had nothing to strike and stood there, neither stinging the other, a stall): only melee from the
  ground never reaches up. A foe flyer aims first at the piece in its way, as a walker does. Your aim at a flyer reads its air road (the
  same number as its Chebyshev distance before). The expert's threat map walks a flyer down the air road. The Fly
  behaviour, the threat, the drone's flavour, your melee pieces' cards and the glossary say it: over the walls, never
  through your pieces.
- Measured, before and after, with the start kinds at the default frontier (floor 1 as they start; floor 2 at two tiers
  a kind in stacks of two; floor 3 at four tiers in stacks of three) in every battle room of floors 1–3 of 20 seeds
  (2,099 battles, 701 foe flyers): flyers ending the battle beside the Monarch 36.9% → 18.3% (floor 2 54.7% → 24.7%,
  floor 3 15.9% → 10.6%); flyers with a piece of yours on their next tile 59% both (before they flew over it, now it
  holds them); flyer blows at the Monarch 852 → 519 and at your pieces 1,436 → 2,236; flyers that never act 10.4% →
  6.1%; bodies lost a battle 1.20 → 1.21 (floor 2 0.76 → 0.80); battles at the tick ceiling 0 and 0; won 79.8% → 80.3%.
  A floor-2 drone room played in the browser at 1440×900: the drone hovers held before the Knight and stings it, with no
  console error.
- **Wounds carry**: `run.postBattleHeal` 0.5 → 0.2, as the economy pass suggested (§5 Step 8), so a piece's HP and DEF,
  Undying and Heartwood count between rooms. Altars are unchanged (full heal, the fallen raised). The help, the
  Monarch's HP rule and its chip say the number, read from TUNING (`WOUNDS_TEXT`).
- **The expert weighs a track's next two tiers together.** Late in a run its growth search wanted nothing with essence
  to spare (the economy pass: seed `sim-0`, 2,364 held, a Frost Sprite tier of 194 declined): it weighed one purchase at
  a time against `EPS`, and a tier whose level rounds away (`base` + `perTier` × tiers, rounded down) shows its worth
  only with the next. Now `grow` weighs each next tier alone and, as one more candidate, with the tier after it on the
  same track (where the crosspath rule allows it and the purse holds both prices together), at their gain together, and
  buys the first of the two when that wins. The rest of the search stands, and the expert still never reads a battle's
  own seed. A pair competes at its whole gain against the others' single ones, so a track's next two may outbid another
  kind's one tier: an ordering the re-check may read.

Open, decided later:

- **Command relics at every elite.** The guarantee may make the field grow too fast for the expert (it took seven
  Command in two floors on one seed); the tiers' HP costs on Bone Horn and Muster Roll are the first lever.

- **Foe footprints.** The Sovereign as a 2×2 on the roads; needs a 2×2 walker. Not this pass.
- **Per-piece targeting** (first, last, strong), if one rule proves too blunt.
- **Board width.** 7 for now; the camps are the puzzle. Revisit after play.
- **Fusion count.** Five to start; more when each kind has one it belongs to.
- **The Legion without Arise.** Undead 8's rule still raises the slain as shadows with no Arise held: it is a
  synergy's, not the Monarch's. Lock it behind Arise too if a run without Arise should raise nothing at all.

Taken after that (2026-10-10): **walkers and Flankers never jam each other** (§2.4), from the user's report of a Flank
and Walk pathing deadlock. A foe held up by a comrade of the other kind steps round it onto a free tile nearer by its
own road; foes standing each in the next one's way round a loop change places. One kind's queue is unchanged, so
blocking with your pieces is too. Not measured, at the user's word.

Taken after that (2026-10-10): **Flank is gone; every foe on the ground walks the one drawn road.** A Will-o'-Wisp, a
Flank kind, killed the Monarch on floor 1: it walked a hidden road round the player's pieces (the Flank field) instead
of the drawn arrows, heeded none of the rings, and parked four rows off, out of reach, shooting the Monarch. The arrows
on the board lied about where a Flank kind went, so the board could not be read. The user: "Just remove flanking
completely. All units use the same pathing algo."

- **Two behaviours, Walk and Fly** (§2.4). Every ground foe walks the Walk field, the arrows drawn on the board, and
  halts as any walker does: in the sight of a piece of yours once it can hit back, or with its next tile held. Flyers
  are unchanged: they fly the air road over the walls, and your pieces still block them. The `flank` behaviour and
  threat are gone, and with them a Flank kind's deafness to your rings, its halt once its blows reached the Monarch,
  and its striking only the Monarch and the piece in its way.
- **Will-o'-Wisp, Mantis Reaper and Barrow Wight walk.** Their flavour hints at what is true now: the Wisp keeps the
  road and its fire leaps four tiles, the Wight withers from three, the Mantis is quick and stalks with its brood. The
  Mantis's one threat was Flank, and every foe carries one, so it carries **Shape** as a stand-in, though its Reap and
  Strike each hit one target where Shape says a crowd: no threat names a lone hard melee blow, and Reach would
  contradict its card's "Melee, no reach". A threat of its own is open. The help, the bestiary's way line and the
  glossary drop Flank.
- It supersedes that day's **walkers and Flankers never jam each other** (above): with one road for every foe on the
  ground, each queue is walkers on the same arrows, which never deadlocks (§2.4), so `roundOf`, `loopOf` and `rotate`
  are gone too. The older entries that state Flank as a rule (the first list's "only Flank routes round them", the
  night's **Flank kinds ignore your rings** and **Ranged Flankers stop once the Monarch is in range**, the Walk foe and
  Flank foe stuck on each other, a flyer that "never Flanks") are history now.
- The balance waits for the pass that follows: three kinds now meet your rings and blockers as walkers do, which moves
  floors 1 to 3 (the Wisp on floor 1 above all), and nothing was measured or tuned here. `combos.json` is to be
  regenerated then (`--combos`).

Taken after that (2026-10-10): **the bug hunt before the balance pass.** A sweep for places the code broke its own
rules, fixed where they broke; no number moved. The rules as they now stand:

- **A heal counts only the allies it can mend** (§2.2). A heal never lifts a fallen body, yet Mend's condition (an
  ally below 50%), Purge's (below 90%) and a heal's aim (the lowest share of max HP) read a stack's HP against its
  fallen bodies too, so a stack that lost a body in an earlier room (wounds carry) read as hurt for good, its living
  bodies whole. Purge reaches every ally: a Clockwork Page Purged such a stack 26 times for 0 and fell beside an Iron
  Golem it never struck. Your Hive Warden and a foe Warden captain (three bodies, two fallen), each with only a broken
  stack to mend, Mended for 0 every turn, and the battle ran to the tick ceiling with no blow struck: a run lost. Now
  a heal's condition and its aim count only the allies whose living bodies are not whole, and for one that cleanses
  (Purge, Hive Mind) an ally carrying a debuff it would strip: the Court of Bone rule (no heal counts the Monarch it
  cannot heal) widened, both sides alike (`helps`, `View`, `pickTarget` in `src/sim/battle.js`); the content's
  conditions are unchanged. It counts only the allies within the heal's reach too (anywhere under Sanctuary): Swarm
  Mend (Brood Mother III, every ally within 2 tiles) read the whole board, and with its one wound out of reach healed
  for 0 every cast, all battle; it waits now for a wound within its 2 tiles, as Brood Surge, Verdant Bloom and Royal
  Jelly always did (its card still says "an ally"). Barkskin and Veil read an ally's HP the same way, but each lays a
  real ward and then waits for its own to lapse, so neither loops; they stand. A Regen tick on a whole stack still
  mends 0: a status's tick, not a choice.
- **A body fallen before a battle stays down after it** (§2.2), though count tiers add bodies that fight in its pool:
  the added bodies stand in front and fall first, and what they left in the pool stood a fallen body up again.
  `finishBattle` (`src/sim/run.js`) now keeps at most the living bodies a piece came in with.
- **Undying's rise refreshes its side's synergies.** A soul that burst as it fell had its side's synergies read
  without it, and once risen went uncounted (what it made dropped, for every piece) until the roster next moved; they
  are read again as it rises.
- **The codex tells a foe's melee reach only of a kind with a melee blow** (`BEHAVIOURS`' `melee`, `ringRule` in
  `src/codex.js`): a shooter's card no longer says what its melee strikes.
- **The expert's gate reads the drawn roads** (`src/sim/autoplay.js`).
- The words caught up with two rules. A flyer's melee strikes a flyer in the air, either side's; only melee from the
  ground never reaches up (§1, §2.3, §2.4, §3, as the Fly behaviour and threat say). The stop line is the earliest a
  walker can halt in your rings (§3, §4, as the board says), for a ranged foe queued behind a stopped comrade halts
  and shoots before it reaches them.

Open, for the user:

- **Count tiers also refill wounds on living bodies.** The added bodies take the blows first, so a piece leaves with
  its living bodies whole unless the blows ate through the added ones too: a Bone Chanter coming in at 30% with +6
  bodies leaves at 100%. Cap what a piece keeps at the HP it came in with (a count tier then only shields), or leave
  it (a count tier then mends between rooms too).

Taken in the fourth balance pass (2026-10-10; §5 Step 8), numbers only, after Flank went and wounds came to carry: the
Monarch's base HP 250; Pyre Bite's Burning 4 s; the Will-o'-Wisp's EVA 22; tiers 16 / 36 / 60 / 96 on floor 1 and a
level 0.67 a tier; every synergy's stat step doubled. The expert clears about 90% and almost never dies on floor 1 (1%
there); basic clears none and dies on floor 1 in three runs of four; the expert still spends all it earns and wants
more; every ablation is in its band by clear rate but fusions (under, as always) and legendaries (a standard error over).

Taken after that (2026-10-10), the user's two calls on the bug hunt's open questions:

- **The Mantis Reaper Bleeds.** Its Reap lays **Bleeding** (a damage-over-time as Burning is: 4 true damage a second a
  stack, up to 5 stacks, a debuff Purge cleanses), and its threat is **Bleed**, in place of the Shape stand-in. Bleed
  is the Mantis's alone, so the route variety rule redraws harder (`spawn.variety.routeTries` 24, was 6) to put it on
  every walk through floors 2 and on.
- **Bodies a tier adds bring little HP.** Each strikes as a body does but brings only `TUNING.bodies.hp` (0.1) of a
  body's HP to the pool, the piece's bodies thinning to share it (battle.js `grown`, `fit`). Their HP is spent first,
  so a piece leaves a battle with its own bodies' HP, never more (run.js `finishBattle`): a Bone Chanter that comes in
  at 30% leaves at 30%, not 100%. Not measured: the next balance pass reads both.

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
The tier rule, the least surprising: tiers are a kind's, not a soul's (Part one §2.6), so none moves. The old kind keeps
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
  to the ossuary, so a footprint meeting one of their cells failed to fit, against Part one §2.2 (a fallen piece leaves
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

**A cleanup after Step 9**: two timing tests in CPU time and on a clock of their own; the forest's fitting out of the build
(`forestfit.js`, 3505 → 3466 KB); a scene outliving its run ignored; the teachers' `--monarch`. The expert's logs the same.

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

### The balance pass, part 1 (Step 6, 2026-10-16)

**Built: a strict commitment, an instrument beside the plan's soft one** (`autoplay.js`, the archetypes' section:
`--builds --strict`; `strictOf`, `strictRecruit`, `mayFuse`, `strictBars`; README). Step 0 found a commitment by the book
alone a nudge (§8, Step 0: every committed row made a Pale Court in 67–84% of its runs) and left a firmer one to the user
as a harness rule over the frozen expert; it is that, as a measuring tool only, the soft commitment staying the plan's
default and the rows of §3. A strictly committed run holds to its archetype as an ablation holds a run from a mechanic.
Its kinds: a fused kind's, every kind of its recipe graph (`recipesOf`: the parts and the fused kinds between); a
synergy's, every kind a run can hold of its kin or role. Its recipes: a fused kind's graph; a synergy's, those whose
result is of its kin or role. Then the draft takes one of its kinds where a pick offers one (the expert's pick among
them, its ranged rule within them); a recruit is one of its kinds where the spoils offer one the purse affords, taken
whatever keeping would while the archetype is short of that kind (`strictShort`: a fused kind's graph wants more of it
than the run holds, every soul counted and a fused one as its parts; a synergy's kin or role held by fewer souls than its
count or the field's cap), else the expert's choice among them or none; a soul let go is never of its kinds while another
will do; no fusion is made outside its recipes, out of battle (`fusionOptions`, `completes`) or in it (`expertTurn`'s
`fuse`, which now takes a recipe filter, `policy.js expertOptions`); no transmutation turns one of its souls into another
kind (`altarOptions`). The Shop, the altar's other rites, the route, prep and battle, and the recruit where none of its
kinds is offered, stay the expert's, and the outside teacher's candidates and playouts read the same restrictions (its
draft and recruits through `pickDraft` and `recruitCandidates`, its purchases through `fusionOptions`, its rites through
`altarOptions`). Free play and the soft commitment play byte for byte as before (whole logs of `same-0…4` free and
committed to Fae 4, sha256, before and after). `test/builds.test.js` (one test: the kinds and recipes of a fused and a
synergy archetype; fusions offered out of battle and in it; whole runs held to the Pale Court and Undead 4, every pick,
recruit, release, fusion and transmutation checked; the jobs). Merged with the Monarchs (961bb56) and the cleanup
(47439ac): 521 tests, all passing (`--test-concurrency=2`, 219 s).

**Measured** (the expert as Step 0 has it, its forests and route stale; the draft on; seeds `bal-*`, fresh `chk-*` for
the checks, two workers beside two other sessions; the content of 094e111 and the base Monarch: the Monarchs and the
cleanup change no base run):
`npm run builds -- --commit none --runs 256 --seed bal` (free play, 11 min); `npm run pool -- --seed bal`; `npm run ladder --
--ascension 0 --runs 64 --seed bal`; `npm run ablations -- --variants relics --runs 64 --seed bal`; the strict commitment,
`--builds --strict --runs 64 --seed bal` for the five kins, the five fused kinds of §1 and six trines of floor-1 kinds
(1,088 runs, 56 min), beside the soft one for the five kins; and the outside teacher's free play up the ladder
(`--player teacher --ascension a --runs 16`).

Free play, `bal-0…255` (criteria 3 and 4):

| | Free play |
|---|---|
| clears | 168 (66%); progress 80.4 |
| died on floor 1 / 2 / 3 | 56 / 5 / 27: floor 1's rooms 3–10 most (45), its boss 3 (the Barrow Marshal); the Mire Mother on floor 2, 4; the Sovereign 27 of the 195 that met it |
| battles a run (a clear); battles lost; orders a clear | 30.0 (37.1); 88; 938 |
| fused kinds in the final armies | Pale Court 72%, Chanter's trine 58%, Winter Court 27%, Sprite's trine 20%, Rime Drake 2%, the Court's trine 2% |
| recipes made (runs) | 11 of 44 in a run or more: the Court 77%, the Chanter's trine 59%, the Sprite's trine 42%, the Winter Court 27%, the rest 2% or less |
| synergies held (battles) | Echo 46%, Legion 25%, Mirage 3%; none 52% |
| kinds in a tenth of final armies; pieces of the last battles | 9 of 62; Channelers 82%, Skirmishers 16% (Fae 65%, Undead 33%) |
| relics bought a run (Command); altars' rites | 2.0 (36%); 2.3 a run: the free tier 65%, the heal 31%, a transmutation 3% |
| the floors' bosses met (lost) | floor 1: the Mire Mother 107, the Marshal 80 (3), the Abbess 13, the Queen 3; floor 2: the Mire Mother 195 (4), the Abbess 3, the Marshal 1 |

On fresh seeds, `chk-0…255` (the base for the loop's confirmations): 176 clears (69%), progress 83.6, dead on floor 1 / 2 /
3 47 / 4 / 29 (the Sovereign 22 of 196); the Court in 76% of final armies, the Chanter's trine 61%, the Winter Court 25%,
the Sprite's trine 22%; Echo 45%, Legion 23%, Mirage 3% of battles; 10 kinds in a tenth of final armies.

Criterion 1, the pool (256 seeds `bal`): **22 of 44** recipes reachable, as Step 1 left them. Short: the three mixed
recipes' keystones by the end of floor 2 (the Ember Drake 0.9 battles, the Mantis Reaper 2.0, the Iron Golem 0.7; their
partners 9.4, 3.5 and 9.3), so the Rime Drake, the Hive Queen and the Clockwork Titan and the five capstones on them;
the trines of the kinds first met on floor 2 but the Drone (the Thorn Dryad's 1.7, the Rot Bloat's 1.7, the Mantis's 2.0,
the Golem's 0.7, the Ember Drake's 0.9); the Marsh Hag's 0.5 (its floor-1 and floor-2 offers are the Mire Mother's court);
and the floor-3 kinds' trines, none.

Criterion 4, the ladder at level 0 (`bal-0…63`): basic 0 clears, all 64 dead on floor 1 (2.0 battles, progress 3.8); the
calculator 0 clears, dead on floor 1 / 2 / 3 56 / 6 / 2, **floor 2 reached in 8 runs of 64** (12.5%; ~half wanted),
progress 19.8 (+16.0 ± 2.3 over basic); the expert **42 (66%)** (~90% wanted), dead 15 / 2 / 5, progress 78.8 (+59.0 ± 5.0
over the calculator, +42 −0 in clears). The order kept. The outside teacher up the ladder (`bal-0…15`, its free play):
94% at 3, 88% at 5, 81% at 6, **75% at 7**, 56% at 8, every run lost on floor 1, none in the Sovereign's room; level 7 is
where it does not saturate, criterion 2's level below.

Criterion 3's relic line, `--ablations --variants relics` (`bal-0…63`): the full expert 42 clears, without Common,
Uncommon and Rare relics 40: **a drop of 3 points** (progress 0.2 ± 0.2; clear-equivalent 3.1 ± 3.1), under its band of
8–25 and **no longer met** (Step 4: 20.3 ± 6.0 at four floors). At three floors the expert buys 1.9 relics a run (5.3 at
four), a third of them Command, and ends a clear with a median 426 essence unspent; floor 4's wall, which Command was
for, is gone.

Criterion 2, **the expert strictly committed**, `bal-0…63` (progress against free play's on the same seeds, 78.8, 42
clears; "reached": runs that made its fusion or held its synergy; "its kinds": the share of the final army, and of the
last battle's field, of the archetype's kinds; the rest are the recruits taken where none of its kinds was offered):

| Archetype | Clears | Progress (vs free) | Died on floor 1 / 2 / 3 | Monarch / pieces (%) | Reached | Its kinds |
|---|---|---|---|---|---|---|
| **Pale Court** | **49** | 80.9 (+2.1 ± 6.0) | 14 / 0 / 1 | 96 / 84 | 50 | 23% / 29% |
| Fae 4 (Mirage) | 28 | 84.1 (+5.3 ± 5.7) | 8 / 8 / 20 | 99 / 91 | 18 | 58% / 56% |
| Rime Drake | 12 | 47.3 (−31.5 ± 6.0) | 34 / 17 / 1 | 100 / 95 | 13 | 38% / 42% |
| Bone Chanter's trine | 7 | 70.4 (−8.4 ± 5.7) | 20 / 8 / 29 | 90 / 93 | 40 | 26% / 58% |
| Frost Sprite's trine | 3 | 70.8 (−8.0 ± 6.0) | 17 / 11 / 33 | 41 / 80 | 47 | 24% / 39% |
| Undead 4 (Legion) | 2 | 62.2 (−16.6 ± 5.4) | 20 / 17 / 25 | 100 / 96 | 42 | 57% / 84% |
| Insect 4 (Frenzy) | 1 | 47.8 (−31.0 ± 5.0) | 26 / 29 / 8 | 100 / 100 | 37 | 26% / 43% |
| Grave Ghoul's trine | 0 | 57.0 (−21.8 ± 5.3) | 18 / 23 / 23 | | 47 | 21% / 32% |
| Bone Colossus | 0 | 55.4 (−23.5 ± 5.4) | 26 / 15 / 23 | | 42 | 37% / 71% |
| Hive Warden's trine | 0 | 50.7 (−28.1 ± 5.3) | 26 / 24 / 14 | | 29 | 12% / 24% |
| Hive Queen | 0 | 43.7 (−35.1 ± 4.7) | 32 / 26 / 6 | | 15 | 18% / 34% |
| Pyre Hound's trine | 0 | 37.0 (−41.8 ± 5.2) | 41 / 11 / 12 | | 18 | 31% / 42% |
| Clockwork Page's trine | 0 | 31.3 (−47.5 ± 5.6) | 43 / 13 / 8 | | 24 | 41% / 54% |
| Drake 4 (Dragonfire) | 0 | 30.9 (−47.9 ± 4.8) | 46 / 15 / 3 | | 1 | 36% / 45% |
| Construct 4 (Last Stand) | 0 | 30.1 (−48.8 ± 5.6) | 45 / 13 / 6 | | 24 | 48% / 67% |
| Clockwork Titan | 0 | 20.1 (−58.7 ± 5.0) | 56 / 7 / 1 | | 3 | 49% / 62% |

On fresh seeds, `chk-0…63` (free play 48 of 64), the same picture: the Pale Court 39, Fae 4 25, the Rime Drake 10 (each of
the 10 runs that made one), the Chanter's trine 3, the Sprite's 2, Drake 4, Construct 4 and Undead 4 2 or 1, the
Ghoul's trine, the Ember Drake's and Insect 4 none.

The soft commitment, `bal-0…63`, the five kins: Undead 4 33 clears (+2.5 ± 4.4), Drake 4 37 (−6.1 ± 5.1), Fae 4 36
(−4.4 ± 5.5), Insect 4 29 (−3.1 ± 3.3), Construct 4 32 (+0.1 ± 3.3); each made a Pale Court in 39–49 of its 64 runs, and
held its synergy in 70%, 2%, 17%, 5% and none of them.

The outside teacher strictly committed to each kin at ascension 7 (`--player teacher --strict`, criterion 2's own
instrument): **not done.** Its run on `bal-0…15` was cut twice, by the container's restart and then after 77 minutes at
under a sixth of its free play's pace: where no line clears, the teacher plays every one of its six candidates out at
every decision, and a strict run at 7 meets that at nearly every decision (its free play at 7, 30 s a run; strictly,
past three minutes). It wants four workers and a few hours, or fewer seeds; the expert's strict rows above stand for it
until then.

**What it says.** Criterion 1: 22 of 44, as Step 1 left it. Criterion 2: **not met, and far off.** Held to its archetype,
the expert wins with one: the Pale Court (49 of 64, more than free play's 42, though its kinds are a quarter of its final
armies and the Chanters the rest), and Fae 4 through it (28); the Rime Drake where its keystone comes (12 of the 13 runs
that made one cleared); every other archetype 0 to 7 clears of 64, the floor-1 kins that start without a ranged kind
(Drake 4, Construct 4, the Hound's and the Page's trines) dead on floor 1 in two runs of three, the rest mostly on
floors 2 and 3. The soft commitment cannot show it: each kin's soft row made a Pale Court in 39–49 of its 64 runs and
cleared 29–37 (free play 42), its synergy held in 0–70% of runs: Step 0's "nudge", on today's content. Criterion 3: not met
on any line, and its relic line, met at Step 4, no longer is (3 points). Criterion 4: the calculator reaches floor 2 in
an eighth of its runs, the expert clears two in three; the ladder keeps its order.

**Why the Court wins: it holds the bosses.** Its basic, Pale Fire, lays a Hex every turn from four tiles, and a Hexed foe
loses its next act. In the expert's free play on `bal-1…3` the Hollow Sovereign was Hexed 15–16 times in battles of 18–27
turns and acted 0–1 times; the floor-2 Mire Mother alike (7 Hexes in a battle of 7 turns). No other build holds a boss,
and every other trine's strict row dies where the Sovereign stands (the Sprite's trine 33 of its 61 falls on floor 3, the
Chanter's 29, the Ghoul's 23): the last floor is tuned to a fight only the Court has. Two variants played in copies of the
tree say so (nothing kept; `bal-0…31`, the strict rows of the Court and five trines): with a boss never Hexed two turns
running, free play falls 18 → 7 clears and the Court's strict row 22 → 4, the losses moving to the Sovereign's room (11 of
the 18 that met it); with the Court's Hex on a rest instead (Pale Fire a skill, Triune Flame its basic: §7.4's "its blows'
rests"), the Court's row 22 → 20 and free play 18 → 17, for the Chanters' Dirge Hastens it and a Hastened skill is ready
every turn. So criterion 2 waits on the bosses as much as on the trines, and free play's diversity on what the refit
learns once the Court no longer wins the last floor alone.

### The user's rules (2026-10-16)

**Taken** (§7, the user's word of 2026-10-16) and built on b083df2 before the expert's refit labels anything, a commit a
rule. The balance pass's draft (`bal-phase2-draft`, 14d037e) is taken for its bosses alone, and Mirage's card (text
only); its other changes (the Ember Drake on floor 1, the Marsh Hag a Trickster, Echo's lesser form) were not decided
and are not here.

- **A boss is never Hexed twice in a row.** A boss whose act a Hex took (`policy.js foeTurn`, where an act is lost)
  carries `shrugs` until its turn next comes unHexed (it acts, it has acted already, the Sovereign's Tide, or it has
  nothing to do but walk); while it does, `turns.js addStatus` lays no Hex on it, whoever lays it and whenever, and says
  so (a `shrug` event: "SHRUGS OFF HEX" over it). One Hex of 2 turns (Wrench the Works, Gear Lock) is one Hex: it costs
  two acts. The draft's check (`hexLost`, a turn number: shrug while `hexLost === turn − 1`) had holes this closes: a
  Hex laid later in the round whose act it took (a trigger's in the foes' turn, anything at the turn's end before the
  count moves) was not shrugged, came fresh and cost the next act too, two running (no content lays one so today: no
  relic or tick Hexes, and a counter answers only the boss's own blow, which it cannot strike Hexed); its window was the
  turn after, ending with the turn's count rather than with the boss's act; and the Hex vanished with no word to the
  player. Where the two agree: a counter's Hex on the boss's act after a lost one lands now (it has acted), fresh, for
  its next act, where the draft shrugged it and the next turn's Hex landed: the same act lost either way; an echo's or a
  relic's Hex goes through `addStatus` as any; two bosses in a room each carry their own; the deep holds no boss
  (`bossPool` is empty past the last floor), so the lighter Sovereign's numbers, the lists' last entries, reach no deep
  room. The bosses lighter to answer it, the draft's numbers (the balance agent's confirmation on `chk-0…255`, −3.1 ±
  4.4 points, was with its other changes): floor 2's boss 3.2 → 2.4 HP and 2 → 1.6 ATK of its own, the Sovereign 1 →
  0.45 and 0.6, its court 4 → 2 (`TUNING.spawn`). Text: the Hexed card, How to play's lede, the README; no bestiary line
  names a Hex. Tests: `enemy.test.js` (the Sovereign's and the Mire Mother's every other act lost beside a ghoul's every
  one; Hexes after the lost act, in the foes' turn and at its end, by either side, shrugged and the one held not renewed;
  the next landing once its turn came unHexed, fresh after it acted; a Hex of 2 turns costing two), `bosses.test.js`
  (the Sovereign lighter).
- **A captain a tier above from floor 2** (§4.2's alternative). From floor 2, where cohorts come, the first draw of each
  fight's wave (`captains.fight`, one) is its captain, drawn from `run.js captainPool`: the pool `captains.above` (1)
  tiers up, as an elite's foes are drawn (`spawnPool`'s target and caps, `tierMax` and `tierOverCap`), those of its kinds
  a tier or more over the floor's target (a tier-1 Wisp would be no notable recruit), each by its weight there; where it
  holds none, the pool's highest tier. It stands among its wave where a shuffle puts it, and its cohort (2 on floors
  2–3) are of the wave's other kinds, each drawn among its other foes. With the pool as it stands a floor-2 fight's
  captain is tier 2, and tier 3 in 11% of fights (the Ember Drake 4.2%, the Mantis Reaper 3.7%, the Iron Golem 3.1%); a
  floor-3 fight's is tier 3 in 89% (each keystone 15–20%) and tier 4 in 11%. A siege's waves are fights'; an elite keeps
  its captains among its foes, leading cohorts of their own kind (its foes are drawn a tier up already: a captain above
  them would make a floor-2 elite a floor-3 one); a boss's room (its court, the Sovereign's waves) is as it was.
  Deterministic per seed, on the room's own stream; replay-equal. `--pool` shows the captains' draws. The routes' passes
  4 → 8 (`variety.routePasses`, a bound, the draft's for the same reason): a floor-2 walk of `route10` met no Shape after
  four; a pass past the fourth acts only where a walk still misses a type (on `rul-0…255`'s floors drawn by the seed, 4
  miss a type after four passes at the base, 1 with the captain, none after eight). Tests: `enemy.test.js` (the rooms: a
  fight's captain from `captainPool`, a tier or more up, its cohort of the wave's own kinds, an elite's and a boss's waves
  as before, captains of tiers 2, 3 and 4 met), `pieces.test.js` (a fight's cohort beside its captain, an elite's of its
  kind), `endless.test.js` (the deep's).
- **A trine counts as three toward synergies** (§7.7's alternative). `unit.js synergyWeight`: a trine (a kind with
  `trineOf`, made or written: the Pale Court) counts as the three it was made of toward its kin and its role; a trine of
  a trine as three too, its parts' own fusions not unfolded (three Courts are nine Fae, fused into a Court trine three:
  fusing still trades count for a body, a level down); a mixed recipe's piece and a capstone once; a role a relic lends
  (Mimicry's) once, the relic's and not the parts'. `synergyCounts` reads it, so `synergiesOf` on both sides, Echo's whole
  form (two Courts and two Chanters are eight Channelers) and every reader built on it follow; the codex's counts (the
  tracker, the board's glow, the Synergies page) are `synergyCounts`, and the tracker's card and the battle's chips name
  a trine "(as 3)". The expert's and the harness's readers count the same way (reader fixes, nothing searched): the
  formation's and the book's synergies and the field read's nearest one, a summon now as the kind it calls up
  (`withSummons`: a trine's, its base kind, once; for every other piece the count it was); `policy.js synergyRead`'s breaks
  and gains; `comboProgress`'s kin and role combos; the strict commitment's `strictShort` (short while the kin or role
  counts under its need, or fewer souls of it are held than the field's cap). The field read's `kin` and `role` (the most
  souls of one kin, of one role) count souls, as they say, and stay. Text: the glossary's Trine and Synergy (word and
  more), the Synergies page, the count note, the README. Tests: `content.test.js` (every trine three toward its kin and
  role, a trine of a trine three, the mixed recipes and the capstones one, Echo whole at two Courts and two Chanters,
  Mimicry's lent role once, a Chanter trine's summons as Bone Chanters), `endless.test.js` (a trine and one more hold
  Legion on either side, beside a shadow too), `codex.test.js` (the tracker's chip, the glossary, the page).
- **The book**: `npm run combos` remade it byte for byte the same (`TUNING.expert.book.synergy` is 0: the book weighs no
  synergy, nor a boss or the pool's weights).

`npm test`: 521 → 524, all passing (`--test-concurrency=2`). Moved for the rules, their intent kept: the Sovereign's "as
it was" (`bosses.test.js`), the cohorts' "of the captain's kind" for fights (`enemy.test.js`, `pieces.test.js`,
`endless.test.js`), the trine's "counts once" (`content.test.js`); no test that pins a seed's outcome moved.

**Measured** (the expert as Step 0 has it, its forests and route stale by design; the draft on; fresh seeds `rul-*`; four
workers; the base b083df2 played from a copy of its tree): free play on `rul-0…127` for two arms, all three rules in
each, the captain beside the pool as it stands (A: `tierFalloff` 1.5, `tierOverCap` 2) and with the pool restored (B: 3
and 1), each paired against the base seed for seed; `npm run pool -- --seed rul` (256 seeds) for each; the strict
commitment (`--builds --strict`) on `rul-0…31` for five archetypes, the arm kept against the base. The arms were played
with four route passes; the commits' free play on `rul-0…127`, with eight, plays every run as A did (128 of 128: its result,
its battles, its army).

Free play, `rul-0…127`:

| | Base (b083df2) | A: captain, pool flattened (kept) | B: captain, pool restored |
|---|---|---|---|
| clears | 80 (63%) | 95 (74%): +20 −5, +11.7 ± 3.8 points | 101 (79%): +37 −16, +16.4 ± 5.5 |
| progress | 81.2 | 82.7 (+1.4 ± 0.8) | 86.8 (+5.6 ± 4.0) |
| died on floor 1 / 2 / 3 | 26 / 5 / 17 | 26 / 1 / 6 | 21 / 0 / 6 |
| floor 1's bosses met (lost) | Marshal 45 (1), Mire Mother 50 (1), Abbess 9 (1), Queen 1 | the same | Marshal 53 (5), Mire Mother 50 (2), Abbess 11 (1), Queen 1 |
| floor 2's Mire Mother (lost; turns a battle) | 97 (4; 8.2) | 99 (1; 5.6) | 100 (0; 4.8) |
| the Sovereign (lost; turns a battle) | 96 (16; 21.4) | 101 (6; 15.8) | 107 (6; 15.7) |
| the Court in final armies (of the clears) | 77% (95%) | 79% (100%) | 80% (95%) |
| fused kinds in final armies | Court 77%, Chanter's trine 57%, Sprite's trine 28%, Winter Court 27%, Rime Drake 2% | Court 79%, Chanter's trine 65%, Sprite's trine 39%, Winter Court 13%, Rime Drake 3% | Court 80%, Chanter's trine 55%, Sprite's trine 39%, Winter Court 20%, Rime Drake 2% |
| synergies held (battles) | Echo 39%, Legion 21%, Mirage 4%; none 58% | Echo 73%, Mirage 66%, Legion 37%, Ambush 10%; none 18% | Echo 73%, Mirage 72%, Legion 25%, Ambush 10%; none 18% |

A against B seed for seed: B +4.7 ± 5.4 points of clears, +4.1 ± 4.0 of progress, within noise.

Criterion 1, the pool (`rul`, 256 seeds; battles offering a kind by the end of floor 2; on floor 3):

| | Base | A | B |
|---|---|---|---|
| recipes reachable | 22 of 44 | 22 of 44 | 22 of 44 |
| the Ember Drake (the Rime Drake's keystone) | 0.9; 2.9 | 1.1; 4.8 | 0.3; 4.5 |
| the Mantis Reaper (the Hive Queen's) | 2.0; 3.1 | 2.0; 4.3 | 1.8; 4.1 |
| the Iron Golem (the Clockwork Titan's) | 0.7; 2.4 | 0.8; 3.8 | 0.2; 3.6 |
| the Thorn Dryad, the Rot Bloat | 1.7, 1.6 | 2.3, 2.2 | 1.8, 1.7 |

**Criterion 1 is met by neither arm**: the Hive Queen, the Clockwork Titan and the Rime Drake stay out of reach by the end
of floor 2. A floor-2 fight's target is tier 1, so its captain is tier 2 and reaches tier 3 only by the falloff (11% of
captains flattened, 4% restored); what the captain brings is floor 3's keystones (×1.4–1.6) and floor 2's tier-2 kinds.
**Kept: A**, the captain beside the flattened pool, no number moved: with neither arm meeting criterion 1, A comes
nearer it (the three keystones 0.8–2.0 battles by the end of floor 2 against B's 0.2–1.8), and B's better free play is
within one standard error and comes from floor 1 (21 deaths there against 26), whose fights the restored falloff fills
with fewer tier-2 foes (10% of the draws against 24%): a softer floor 1, not a richer pool. §7's decision 1 says so.

Criterion 2, the strict commitment, `rul-0…31` (free play 19 → 25 of 32):

| Archetype | Base clears | A clears | Paired (clears; progress) | Died on floor 1 / 2 / 3 | Reached (made or held) |
|---|---|---|---|---|---|
| Pale Court | 23 | 20 | −9.4 ± 5.2; +1.9 ± 2.6 | 6 / 2 / 1 → 6 / 1 / 5 | 81% → 78% |
| Fae 4 (Mirage) | 7 | 17 | +31.3 ± 9.5; +9.3 ± 2.8 | 5 / 9 / 11 → 5 / 0 / 10 | 13% → 75% |
| Bone Chanter's trine | 5 | 11 | +18.8 ± 8.3; +1.8 ± 2.1 | 12 / 6 / 9 → 12 / 6 / 3 | 56% → 53% |
| Rime Drake | 12 | 11 | −3.1 ± 7.1; +1.9 ± 2.3 | 18 / 2 / 0 → 18 / 0 / 3 | 38% → 41% |
| Undead 4 (Legion) | 1 | 10 | +28.1 ± 8.1; +4.8 ± 2.5 | 7 / 12 / 12 → 7 / 7 / 8 | 72% → 84% |

**What it says.** The bosses act again: in the expert's free play on `rul-1…4` the Sovereign was Hexed 12–42 times in
battles of 19–33 turns and acted not once at the base; with the rule it is Hexed 0–10 times in 12–15 turns and acts 2–3
times, and it falls sooner (21.4 → 15.8 turns a battle) for its lighter numbers; deaths in its room 16 → 6 of ~100, at
floor 2's boss 4 → 1. Free play gains (+11.7 ± 3.8 points of clears with A), most of it, by the synergy lines, from the
trine counted as three: the Court and any Fae are Fae 4, the Court and any Channeler Channeler 4, so Mirage (4% → 66% of
battles) and Echo (39% → 73%) are held in most battles, and battles with no synergy fall from 58% to 18%; four synergies
at 5% or more (two before), criterion 3's line still short of six. The monoculture holds: the Court in 79% of final
armies and all of A's clears. Held to an archetype the gap narrows: the Court 23 → 20 of 32 while Fae 4 (7 → 17),
Undead 4 (1 → 10) and the Chanter's trine (5 → 11) rise, the first two by their synergy reached with a trine and a soul
(Fae 4 held in 75% of its runs, 13% before); the Rime Drake (12 → 11) waits on its keystone, which the captain brings to
floor 3 rather than floor 2, and dies on floor 1 as before (18 of its 21 falls). The three rules were not measured apart.
Not measured: the outside teacher (criterion 2's own instrument) and the ladder. The expert is stale against all three
rules by design; its refit, next, learns them.

**The captain's tier, the user's intent** (a follow-up the same day). The user chose the captain on "from floor 2 each
fight carries one foe a tier above the room's, so a keystone recruit is on offer in most floor-2 fights": the Ember
Drake, the Mantis Reaper and the Iron Golem, tier 3, reachable by the end of floor 2. As built above, floor 2's captain
was tier 2 (its target tier 1, one above), a keystone in 11% of fights. Now a fight's captain is drawn at the floor's
`captains.minTier` (`[0, 3, 3]`: the keystones' tier from floor 2) or a tier over the target, whichever is higher
(`captainPool`): floor 2's captain is a keystone in every fight (the Ember Drake 38%, the Mantis Reaper 33%, the Iron
Golem 29% by their weights), floor 3's as it was (tier 3 in 89%, tier 4 in 11%). Arm A's pool kept. Every walk still
meets every threat type (`route0…23` floors 1–5, `rul-0…255` floors 1–3, eight passes).

| | A (captain a tier over the target) | K (and of tier 3 at least) |
|---|---|---|
| criterion 1: recipes reachable (`rul`, 256 seeds) | 22 of 44 | **31 of 44** |
| by the end of floor 2: the Ember Drake, the Mantis Reaper, the Iron Golem | 1.1, 2.0, 0.8 | 4.1, 3.6, 2.9 |
| the Rime Drake, the Hive Queen, the Clockwork Titan | 1.1, 2.0, 0.8: none met | 4.1, 3.5, 2.9: the Rime Drake and the Hive Queen met, the Titan 0.1 short |
| the Hive Warden, the Tomb Knight, the Thorn Dryad, the Rot Bloat (no longer floor 2's captains) | 4.3, 5.6, 2.3, 2.2 | 3.5, 4.4, 1.4, 1.4 |
| free play, `rul-0…127`: clears | 95 | 96 (+0.8 ± 2.4 against A; +12.5 ± 3.8 against the base) |
| died on floor 1 / 2 / 3 | 26 / 1 / 6 | 26 / 0 / 6 |
| floor 2's Mire Mother (lost; turns) | 99 (1; 5.6) | 99 (0; 5.1) |
| the Rime Drake made (runs); in final armies | 3%; 3% | 9%; 8% |
| the Court in final armies; synergies | 79%; Echo 73%, Mirage 66% | 77%; Echo 72%, Mirage 69% |

The recipes newly reachable: the Rime Drake and the Hive Queen, their capstones on them (the Cinder Wyrm, Aurora, the Hive
Mind), the Ember Drake's and the Mantis Reaper's trines; the Titan, the Engine of Ages, the Iron Barrow and the Golem's
trine 0.1 short (the Golem 2.9 battles); the Dryad's and the Bloat's trines, never met, further off than before (1.4).
Floor 2 is not harder for the expert: no death there in 128 runs (1 with A), the expert's floor-2 armies holding a tier-3
foe a fight.

Strictly committed, `rul-0…31` (base → A → K; free play 19 → 25 → 26 of 32): the Rime Drake 12 → 11 → 9 (made in 38%,
41%, 38%; dead on floor 1 in 18 of its falls each time), the Hive Queen 0 → 1 → 1 (made 38%, 44%, 41%; dead on floors 1
and 2), the Clockwork Titan 0 → 0 → 0 (dead on floor 1 in 28 of 32, made in one run). Held to these three, the expert
seldom lives to floor 2's captains: their rows wait on floor 1, which the captain does not touch, and on the refit.

### The refit (2026-10-16)

**Why** (§4.0's refit; §7, "the expert retrained before the content is balanced again"): the expert's four learned
parts (the battle forest, `expert.json forest`; the recruit's and the formation's forests, `outforest.recruit` and
`.prep`; the learned route, `route`) were fitted on playouts of f8c536f's content, four floors and one boss, and every
step of this record since, with the user's rules of 2026-10-16 (a boss never Hexed twice running, a captain of tier 3
from floor 2, a trine three toward synergies), moved the game under them. Done on improvement-plan 7721702, the base
game (ascension 0, the base Monarch, free play), the hand tree and the searched weights untouched, every label made
from a frozen copy of 7721702's `src/` (its shipped expert unless said), four workers. Selection on 256 seeds
`rfs-0…255`, confirmation on 768 fresh ones `rfc-0…767`; progress in points ± one standard error of the paired
difference, clears as the tiebreak. (Begun on 47439ac and paused before labelling for the user's rules; step 1 below
was measured on both, the earlier in the session's scratchpad, rf-status.md.)

**What each part was worth before** (the shipped expert against itself with the part dropped: `npm run bundle --
--<part> none`, the outforest with one phase; `rfs`):

| Dropped | Clears | Progress (paired) | Clears won / lost | Died on floor 1 / 2 / 3 | s a run |
|---|---|---|---|---|---|
| nothing (the shipped) | 181 (70.7%) | 78.0 | | 67 / 2 / 6 | 4.0 |
| both forests out of battle | 124 (48.4%) | −7.50 ± 2.77 | +26 −83 | 80 / 15 / 37 | 3.7 |
| the formation's forest | 158 (61.7%) | −6.62 ± 2.33 | +17 −40 | 86 / 1 / 11 | 3.4 |
| the recruit's forest | 143 (55.9%) | +1.97 ± 2.42 | +26 −64 | 56 / 11 / 46 | 4.7 |
| the learned route (the hand route) | 168 (65.6%) | −3.33 ± 2.55 | +30 −43 | 80 / 0 / 8 | 4.1 |
| the battle forest | 174 (68.0%) | −0.37 ± 2.12 | +19 −26 | 68 / 1 / 13 | 3.0 |
| the battle forest, on `rfc` | 528 (68.8%) against 585 | −5.59 ± 1.33 | +62 −119 | 201 / 0 / 39 against 149 / 3 / 31 | 2.6 |

Nothing stale hurt. The recruit's forest is worth its clears, not its progress: without it the runs die less on floor
1 and more to the Sovereign (46 against 6), the Pale Court in 27% of final armies against 68% and the Sprite's trine in
57% (the balance pass's lead holds: it is the monoculture's engine and its clears both). The battle forest read nothing
on 256 seeds and 5.6 points on 768: step 1 at 47439ac had read it so too (−0.50 ± 2.16), and dropping it, the faster
expert, is not the bargain 256 seeds suggest. The confirmation seeds' baseline, the shipped on `rfc`: 585 clears
(76.2%), progress 83.4, died 149 / 3 / 31 (the Sovereign's room 30, the Barrow Marshal's 12, the Mire Mother's 8), 31.2
battles a run, the Court in 75% of final armies, Echo held in 74% of battles and Mirage in 69%.

**The route** (labels: `npm run teach -- --route --runs 20 --seed rfrN --out rf-route/cNN`, N 0…14: 300 runs of the
shipped expert, 223 cleared, every room of a kept choice played to the run's end; 3,100 choices of 6,575 rooms, 1,329
/ 1,213 / 558 by floor, 741 with an elite open; 68 min). The shipped route takes the playout's best room in 67.8% of the
choices (held out 73.5%, regret 1.66; the hand route 67.1%, 2.14), and no tree fitted on them agrees more (`--fit`,
held out top-1 and regret): grown as round 1 (tau 10, λ 0.3, depth 3) 69.5%, 2.08; with the hand rules kept (`--hand`)
68.0%, 2.15; tau from the data 67.9%, 1.76; λ 3 69.0%, 1.74; the shipped tree's leaves refitted (`--prior <the
shipped route> --structure prior`) 72.8%, 1.53 at λ 0.3 and 73.2%, 1.66 at λ 3. On `rfs` against the shipped: the
grown tree +2.67 ± 2.74 (clears +47 −32), the shipped's leaves refitted +2.44 ± 1.29 (+15 −8), tau from the data −2.86
± 2.98. The first on `rfc`: −1.77 ± 1.41 (587 clears, +98 −96); the second, a second look, −0.49 ± 0.60 (585, +26
−26). **Not kept**: the shipped route stays.

**The formation** (labels: `npm run outside -- --label --seed rfo --from 16N --runs 16 --phases recruit,prep --floors
1,1,1 --out rf-out/cNN`, N 0…6, and `--seed rfp --from 24N --runs 24 --phases prep --floors 1,1,1 --out rf-prep/cNN`,
N 0…11: every prep of 400 runs of the shipped expert, 112 and 288, its 9 formations each fielded and its battle played
out; 12,291 preps, 4,307 / 4,008 / 3,976 by floor, another formation's battle the better at 52% of them by 0.21; the
preps alone 39 min, those beside the recruits below). Refitted as round 1 (`npm run outforest -- --phases prep --depth
12 --leaves 512 --min-leaf 40 --with <the shipped outforest>`: 200 trees, the centred target; 69,592 nodes): held out
(seeds ≡ 0 mod 5, 2,568 preps) +0.031 a decision at δ 0.1 and +0.035 at 0.05, where the shipped formation forest gains
+0.019 at its 0.1 (the teacher +0.107). On `rfs`: δ 0.1 +3.74 ± 2.00 (193 clears, +28 −16), δ 0.05 +4.45 ± 2.15 (199,
+36 −18). δ 0.05 on `rfc`: **602 clears (78.4%) against 585 (+80 −63, +2.2 ± 1.6 points), progress −0.35 ± 1.18**,
died 153 / 1 / 12, the Sovereign's room 10 against 30. **Kept** on the clears, its progress level (2a8632c: outforest
`round-2-prep-2`, the recruit's forest of round 2 beside it as it was).

**The recruit: refitted twice, kept as it was.** First as round 2 was relabelled, under the shipped expert (`rf-out`
above: every recruit of the 112 runs, 3,284 of 4.3 candidates, each played to the run's end; another candidate's line
the better at 42% of them, by 2.8, 6.8% clearing where the base's lost; ~3 h with the formations beside them), fitted
as round 2 (200 trees, depth ≤ 6, ≤ 64 leaves of ≥ 50 rows): out of bag +0.21 a decision at δ 0.25, held out −0.03
(679 recruits; the shipped recruit forest on them +0.03). On `rfs`: **−19.59 ± 2.97 at δ 0.25 (80 clears against
181), −15.02 ± 2.95 at 0.5 (92)**, worse than none, its armies ending with 4.9 souls against 7.8 (the sketch alone
6.3). Under a base that recruits at most offers, a candidate's playout is played on by that base, which recruits again
at the next offer: passing on one reads as nearly free, and the forest learnt to pass. So, second, as round 1 was:
labels under the expert without the recruit forest (a frozen copy whose `expert.json` drops it; `--seed rfq --from 16N
--runs 16 --phases recruit --out rf-out1/cNN`, N 0…3: 64 runs, 1,912 recruits of 4.5 candidates, another candidate
the better at 74%, by 1.3, 24% clearing where the sketch's line lost; ~1.7 h), fitted alone and with the first set as
round 2 was (5,196 recruits), beside the kept formation forest; selection against the expert with it (199 clears, 82.4):

| Recruit forest | Held out | `rfs` (paired) | Clears | Souls at the end |
|---|---|---|---|---|
| the shipped's (round 2 of f8c536f), δ 0.25 | +0.00 (1,070) | | 199 | 7.9 |
| the shipped's at δ 0.5 | +0.09 | −1.88 ± 1.01 | 187 (+7 −19) | |
| both sets, δ 0.25 | +0.13 | −7.56 ± 2.63 | 135 (+20 −84) | 4.8 |
| both sets, δ 0.5 | +0.21 | −6.65 ± 2.55 | 120 (+18 −97) | 5.1 |
| round 1's set alone, δ 0.5 | +0.15 (391) | −33.18 ± 2.80 | 89 (+9 −119) | 4.4 |

Every refit ends with fewer souls than the sketch alone. In play (`rfs-0…7`) the last turned the sketch's recruit into a
pass 44 times in 59 (the shipped forest 14); on its own labels, where the sketch recruits, passing beats the recruit's
playout in 249 of 529 (47%, coin flips) and it learnt to pass in 372. One recruit's playout, run on by a base that
decides the rest, cannot price a policy that passes at every such offer: the passes compound, the army thins and floor 1
kills it (154 deaths there of 256). The old rounds escaped it (their sketch passed three offers in four, so recruiting
showed); on the current game it does not. **Not kept**: the shipped recruit forest at its δ 0.25 stays. A recruit forest
for this game needs labels that see a policy's repeated choice (whole runs played by the candidate forest, policy
iteration over runs), not one decision's.

**The battle forest: relabelled, kept as it was.** Worth 5.6 points (above), so not dropped. Labels: `npm run teach --
--runs 20 --seed rftN --out rf-battle/cNN --draw state --keep 1,0.5,0.3,0.03 --keep-floor 1=2,3=3 --forest <the
shipped's>`, N 0…7, then `--augment`: 160 runs of the shipped expert (120 cleared), 14,904 positions of 9.7 options,
9,741 / 794 / 4,369 by floor, every option played to the battle's end; 51 min, cut from 300 runs for time once the
recruit's labels had been made twice. Refitted as round 3 (`npm run forest -- --inputs aft`: 200 trees, depth ≤ 12, ≤
512 leaves of ≥ 40 rows, the centred target; 64,358 nodes): held out (3,040 positions) +0.017 a decision at δ 0.02 and
+0.006 at 0.05, where the shipped forest, fitted on 95,749 positions of the old game, reads −0.021 at its 0.02 (the
teacher +0.207). On `rfs`, beside the kept formation forest and against it: δ 0.02 −0.92 ± 2.37 (192 clears against 199,
+27 −34), δ 0.05 −3.48 ± 2.28 (183, +19 −35). **Not kept** (not a candidate for `rfc`): the shipped forest stays. The
old spec's round 4 (relabelled under the shipped expert, 39,300 positions, fitted beside round 3's) played level too; a
forest of 14,904 fresh positions alone stands in for one fitted on six times as many, and its next relabel wants the 300
runs and more, or the old sets' successors beside it.

**The expert at the end** (the shipped with the formation's forest refitted; `rfc-0…767`, seed for seed):

| | The shipped (7721702) | The refit |
|---|---|---|
| clears | 585 (76.2%) | 602 (78.4%): +80 −63 |
| progress | 83.4 | 83.0 (−0.35 ± 1.18) |
| died on floor 1 / 2 / 3 | 149 / 3 / 31 | 153 / 1 / 12 |
| in a boss's room | the Sovereign 30, the Barrow Marshal 12, the Mire Mother 8, the Molting Abbess 4, the Swarm Queen 2 | the Barrow Marshal 13, the Sovereign 10, the Mire Mother 8, the Swarm Queen 3, the Molting Abbess 2 |
| battles a run; lost; s a run | 31.2; 183; 4.5 | 31.2; 166; 4.4 |
| final armies | Court 75%, Chanter's trine 61%, Sprite's trine 38%, Winter Court 13%, Rime Drake 4% | Court 75%, Chanter's trine 60%, Sprite's trine 36%, Winter Court 15%, Rime Drake 6% |
| synergies (battles); kinds in a tenth | Echo 74%, Mirage 69%, Legion 34%, Ambush 9%; 11 of 62 | Echo 74%, Mirage 67%, Legion 35%, Ambush 9%; 11 of 62 |

**How it was run** (scripts in the session's scratchpad, `rf-refit/`, beside every label set and play file): a frozen
copy of `src/` for the labels; a queue of resumable jobs, one runner at a time (a lock), each label set in chunks of
seeds with its own directory, each play file a line a run, what a restart cut mended before a job went on (the container
restarted once mid-measure: one play file's 214 runs resumed). Plays by `autoplay.js record` with `expert:` files
(`--paired`'s players), paired per seed, the diversity block by `autoplay.js diversity` on the same records. ~10 h of
four workers: labels ~7.4 h (the route 1.1, recruits and formations 3.0, formations alone 0.7, recruits under the sketch
1.7, the battle 0.9), plays ~2.7 h.

**What it says.** The parts fitted on the old game still carry the expert on the new one: the recruit's forest 15 points
of clears, the formation's 9, the battle forest 7, the route 5, against each dropped. A relabel under the shipped expert
improves what is judged a battle deep (the formation, kept: more clears, the Sovereign's room 30 → 10 deaths) and not
what is judged to the run's end by one decision's playout (the recruit, the route), nor the battle forest on a sixth of
its old data: those labels are coin flips where the parts decide, and the fits learn their noise or, for the recruit, a
bias that compounds. The Court's monoculture is the recruit's forest's, and the refit leaves it (75% of final armies);
breaking it is the balance pass's or a recruit forest fitted on whole runs'. The book's fourth army (the second bug
hunt's "seen and left") is the hand formula's, not a learned part, and stays.

**Tests**: 524, all passing (`--test-concurrency=2`, 191 s); no test's seed or expectation moved (the outside teacher's
clearing line, the cheap seeds of `outforest`, `teach` and `builds`, the puzzles: the same with the formation's forest
refitted).

### Cheaper measurement (2026-10-16)

**Why** (the user's ask): every call of this plan, a refitted part kept or a content change, is a paired comparison of
two autoplayer configurations on the same seeds, at a fixed 256 (selection) then 768 (confirmation), ~4.6 s a run on
a core: a confirmation is 1,536 runs, its base side the same expert each time. Two changes, the game, the expert and a
fixed comparison's results untouched (d8cd866): a comparison stops once it is decided, and no run whose record is
known is played again.

**The stopping rule** (`--paired a,b --sequential`; `--builds --sequential`, each archetype against free play;
`src/sim/sequential.js`). Seeds in blocks of 64 (`--block`) in seed order, so a sequential comparison's seeds are a
prefix of the fixed one's, to `--runs` at most (768 by default). After each block the paired difference in progress
(b − a in points, the primary measure) over its standard error, z, against the look's bound:

- **A win or a loss**: |z| at or past the bound. Haybittle–Peto: 3 at every look before the last, the last's solved
  (recursive integration, Armitage–McPherson–Rowe; the published Pocock and O'Brien–Fleming constants to the third
  decimal) so the whole design spends two-sided α 0.05: 2.03 at 768 seeds (12 looks), 1.98 at 256 (4). Why it: its
  last bound is nearly the fixed test's 1.96, so a comparison played out reads and decides as before (power at a gain
  of 2.8 standard errors 78% against 80%), and 3 is far enough out that the standard error's own noise at 64 seeds
  hardly moves it. O'Brien–Fleming (`--design obf`) wants 7.3 at 64 seeds and stops nothing early there; Pocock
  (`--design pocock`) holds 2.59 at every look (2.36 to 256), which costs power at the end and would have read the
  formation's selection (+4.45 ± 2.15, z 2.07) level. On the history below the three saved alike: futility does most.
- **Futility**, from the second look to the one before the last: b's one-sided 95% upper bound on the gain (difference
  + 1.645 standard errors) under a point of progress (`--min-gain`, 1: under what 768 seeds resolve, ± ~1.2) **and** b
  not ahead on clears (won ≤ lost), so a change level in progress and ahead on clears, the tiebreak's keep (the
  formation's on `rfc`), is never cut. Non-binding: it spends no α, so it only lowers the error rate.
- **Level**: neither by the last look; the clears break the tie as they always did, reported, the call the reader's.

Each look is printed (seeds, progress ± its standard error, z against the bound, clears), then the paired report of the
seeds played and the decision with its look. The fixed mode stays the default: every number of this record was made
with it, and the harness's margins and diversity block want every seed.

**On the record's paired data** (the stopping rule replayed in seed order on the refit's play files, `rf-refit/plays`,
and on the free play of steps 1, the balance pass and the user's rules, their `--builds --out` files; the session's
scratchpad, `seq/history.mjs`):

| Comparison | All seeds: progress, z, clears | The record's call | Sequential: seeds, decision |
|---|---|---|---|
| `rfs` (256), against the shipped: the forests out of battle dropped | −7.50 ± 2.77, −2.71, +26 −83 | not dropped | 128, futile |
| the formation's forest dropped | −6.62 ± 2.33, −2.85, +17 −40 | not dropped | 128, futile |
| the recruit's forest dropped | +1.97 ± 2.42, +0.81, +26 −64 | not dropped | 256, level |
| the learned route dropped | −3.33 ± 2.55, −1.31, +30 −43 | not dropped | 192, futile |
| the battle forest dropped | −0.37 ± 2.12, −0.17, +19 −26 | to `rfc` | 256, level |
| route A; C; D | +2.67, +0.97; −2.86, −0.96; +2.44, +1.90 | A and D to `rfc`; C not | 256, level (all three) |
| the formation, δ 0.1; δ 0.05 | +3.74, +1.87; +4.45 ± 2.15, +2.07 | δ 0.05 to `rfc` | 256, level; 256, win |
| the recruit 2, δ 0.25; δ 0.5 | −19.59, −6.61; −15.02, −5.08 | not kept | 128, loss (both) |
| against the formation kept: the recruit, shipped δ 0.5 | −1.88 ± 1.01, −1.86, +7 −19 | not kept | 128, futile |
| the recruit 3, δ 0.25; δ 0.5; round 1's set δ 0.5 | −7.56, −2.88; −6.65, −2.61; −33.18, −11.87 | not kept | 128 futile; 128 futile; 64 loss |
| the battle forest, δ 0.02; δ 0.05 | −0.92, −0.39; −3.48, −1.52 | not kept | 256, level; 128, futile |
| `rfc` (768), against the shipped: the battle forest dropped | −5.59 ± 1.33, −4.19, +62 −119 | not dropped | 128, futile |
| route A; route D | −1.77 ± 1.41, −1.25; −0.49 ± 0.60, −0.81 | not kept | 256, futile; 128, futile |
| the formation, δ 0.05 | −0.35 ± 1.18, −0.29, +80 −63 | **kept** (the clears) | 768, level, the tiebreak b's |

The refit's 22 comparisons: **4,608 seeds of 7,680 (60%)**, and no call changed: every early stop is a reject where
the record rejected, every candidate the record sent on or kept played to its end and read as before. The content
steps' free play (10 comparisons of 128 or 256 seeds): 1,664 of 1,920; two stopped futile at 128 (step 1's `after2`
against `base2`, −5.09 ± 2.72 on all; its draft alone, −1.18 ± 1.50), the rules' K won at its last look (+1.70 ±
0.74, z 2.30), as their full runs read. In all 6,272 of 9,600 (65%). The largest savings are clear losses and futile
candidates at confirmation: the battle forest's drop decided at 128 seeds of 768, route D at 128, route A at 256.

**Null checks.** Each of the 32 comparisons with a and b swapped seed by seed at random (the paired difference's sign
flipped, progress and clears together: nothing to find, the data's own spread and ties), 2,000 times each: **3.30%
false positives** (a win or a loss), 14.6% futile, 93% of the seeds played. The shipped expert of 7721702 against
itself on different seeds (its 1,024 runs, `rfc` and `rfs`), 4,000 draws each: split at random into a and b of 512,
2.77% (to 256 seeds, 3.08%); 768 pairs drawn with replacement, 2.92% (the fixed test on the same draws 4.63%, to 256
4.85%); futile in 12–27%, 83–95% of the seeds played. Under α everywhere: futility ends some paths that would have
crossed. Power (per-seed differences normal with the expert's spread, 34 points; no clears to spare a futile path): at
most 768 seeds, a true gain of 3.5 points is won 80.0% of the time (the fixed test 81.4%) in 599 seeds on average, 5
points 97.5% in 432, 8 points always in 202; a point 12.3% (12.9%), 16% futile; no difference 2.6% won, in 603.

**The run cache** (`src/sim/runcache.js`). A run is a pure function of the code, the expert and its job, so playAll
keeps every finished run's record (the harness's line, gzipped JSON, ~1 KB) under a sha256 of the code (every file of
`src/sim`, the sim, `expert.json` and `combos.json` and the offline tools beside them, so a change to any misses, the
safe side; the `src/` modules it imports, `content.js` and `tuning.js`; Node's version), the job (its keys sorted:
seed, level, ascension, Monarch, scale, commitment and strictness, ablation, rung…) and every file a job names
(`expert:`, `forest:`, `outforest:`, a route's) by its bytes, never its path; it reads it before playing, and jobs alike
in one call are played once (`--paired x,x`). `--paired`, `--builds`, `--ladder`, `--ablations` and the sim report use
it; a caller of the exports, none. It lives in `~/.cache/retinue-runs/<code hash>/` (`--cache <dir>`, `RETINUE_CACHE`;
`--no-cache` bypasses it), a directory a code version: deleting one clears it. A record read back is the one played,
its seconds as played. So a comparison's base side is played once a code version, and since a sequential comparison's
seeds are a fixed one's first, a fixed run after it plays only the seeds left. Checked on tiny `--paired`, `--builds`,
`--ladder` and sim reports: the same lines as d4880b7's, played and read back; a changed source file misses (tested).

**Tests**: 529, all passing (`--test-concurrency=2`, 199 s): `test/measure.test.js`'s 5 new (the bounds, the rule on
made-up pairs, false positives under α, the cache's key and hits, `--paired --sequential` end to end);
`ascension.test.js`'s run of the CLI takes `--no-cache`.

### The speed pass (2026-10-16)

**Why** (the user's ask): every label, playout and paired measurement of this plan is made of expert runs, ~4.6 s each
on a core. The ask: the expert and the sim under it at least twice as fast a run, every decision the same, every run's
log byte for byte as it was. Thirteen commits on d4880b7 (9ecedee…b94c069), then improvement-plan merged in (ae5c410);
no tuning number, no content, no decision changed, the harness's CLI untouched.

**What was done**, by the profile's order (the four runs `prof-0…3`, `node --cpu-prof`; 3,411 actions, 112 battles):

- **Copies of a run** (`run.js copyRun`): by hand, not by structuredClone (14% of the profile): the state is plain data
  with no object reached twice; the log's entries and the floor's map shared (never written once made; the map copied
  while the draft is on, whose last pick opens it). A late state: 1.40 ms → 5 µs. The growth search's forks, the
  teachers' playouts (outside.js, calc.js, teach.js).
- **A unit's stats** (`unit.js`): tiersOf kept a kind and pair of tiers, trackMods with it, statsOf kept on a key of all
  it reads (kind, level, tiers, position, each mod by identity in order, TUNING.monarch.hp), the stats frozen and shared.
- **The book and the formation** (autoplay.js): bookValue and targetOf one pass over the combos, kept by state on what
  they read; a combo's entries made once; formationFeatures' per-piece reads once a plan (`ctx.reads`: the hill-climb's
  120 formations are the run's souls in other cells), its coverage once a formation; coverage's key joined, not JSON.
- **The battle forest** (forest.js `predictions`): the trees read tree by tree for all of a decision's candidates and
  today's choice at once (megabytes of trees, a dozen candidates), the decision's inputs encoded once.
- **The battle's reads** (policy.js, expert.js, turns.js, plan.js): an option's features start from a literal (a spread
  of the frozen BLANK took V8's slow path: 773 ns against 34); conditions one literal; the full situation built whole (the
  lean read's getter spread was slow too); afterOf's and the opening board's situation `short` of the threat's strikes,
  which conditions never reads; a move given by the path its option read (turns.js order's `path`, not reach flooded
  again); a road ahead as tiles where only tiles are read (`roadTiles`); a one-tile piece's footprint read without one
  made; synergies' needs made once; danger's scratch kept; the shortlist's scores taken from decideTree's where no hard
  rule filtered.

Why reads may be skipped or reordered on the battle's copies: stats' cache (turns.js `stats`) answers the same whoever
asks first. refresh reads every living unit after every order, so between orders each unit's entry stands at the
current roster and synergies, and an entry's roster only ever moves with a list it was made with.

**Before → after** (d4880b7 against ae5c410, one process at a time on a four-core box another agent shared; wall, CPU
in brackets: V8's GC and compiler threads):

| Job | Before | After | |
|---|---|---|---|
| The expert, 32 runs `div-0…31` | 123.8 s (159.4), 3.87 s a run | 66.5 s (97.6), 2.08 s a run | 1.86× |
| The profile's four runs `prof-0…3` (min of three, interleaved) | 16.0 s | 8.7 s | 1.8× |
| basic, 32 runs | 0.56 s | 0.43 s | 1.3× |
| the calculator, 32 runs | 25.4 s | 21.3 s | 1.19× |
| its teacher, `div-1` | 38.6 s | 34.0 s | 1.13× |
| the outside teacher, `prof-1` `--won` | 16.5 s | 6.5 s | 2.5× |
| `teach.js --runs 2 --draw state`, a worker (74 positions) | 36.6 s | 24.1 s | 1.52× |
| `outside.js --label --phases recruit,prep --runs 1`, a worker | 12.9 s | 7.9 s | 1.62× |
| `npm test` (529, `--test-concurrency=2`; a8d3bd1 against ae5c410) | 199 s | 119 s | 1.67× |

Short of 2× on the expert: what is left is the battle's afterstate (afterOf, ~21%: a copied board, the option given, a
full situation read for each candidate the forest weighs), the copies' unit spreads (megamorphic, a dozen shapes), V8's
GC (~8%) and the forest's trees (~4%, memory-bound). The calculator reads every option's features, twice a piece, and
none of this pass's large gains were its.

**The identity check** (`sp-check.sh` in the session's scratchpad, after every step and after the merge): 117 files,
each one's sha256 as at d4880b7: 16 expert runs (`div-0…7`, `prof-0…3`, clears and floor-1 deaths alike; `div-0` at
ascension 5, `div-4` at 3; `div-1` as the Brass Monarch, `div-2` as the Hive) with each one's full log, end state, state
replayed from the log, harness record and every battle's events; basic on 4 seeds, the calculator on 4 and its teacher
on 1 with every battle's events; the outside teacher's run with `--won`; a battle-label job (`teach.js --runs 2 --draw
state`) and an out-of-battle one (`outside.js --label --phases recruit,prep --runs 1`), their rows timing aside. One
battle played in Chromium after the steps that touch the game's modules (unit.js, turns.js, run.js): no console error.
Tried and not kept: the trees interleaved in one array (no faster), a larger young generation (`--max-semi-space-size`,
no faster), synergyCounts reading each def once and statsOf's key without a join (no measurable gain). Tests: 529, all
passing.

### The recruit learner (2026-10-16)

**Why** (§7, the user's word: "New recruit learner first"): the refit found the shipped recruit forest (round 2, fitted on
the four-floor game) worth 15 points of clears and the Pale Court's engine, and both its relabels failing: a candidate's
playout is finished by a base that recruits at the next offer, so passing on one reads as nearly free, the forests learnt
to pass, and in play the passes compounded. The ask: a recruit decision-maker judged by what a decision is worth when it
keeps deciding afterwards, kept only on a gain over the shipped expert on fresh seeds. Done on 0418ba3 (the speed pass),
the base game (ascension 0, the base Monarch, free play), four workers; every run played by a frozen copy of the
worktree's `src/` and an expert file (the shipped's, 0418ba3's `expert.json`, with its recruit phase changed).
Selection on 256 seeds `rcs-0…255`, confirmation on 768 fresh ones `rcc-0…767` (and `rcd-0…767`, fresh again, for the
round after), each paired against the shipped expert or the one kept before and stopped by §3's rule (blocks of 64;
Haybittle–Peto; futile under a point unless ahead on clears); progress ± one standard error of the paired difference,
clears the tiebreak.

**The design.** Of the brief's three, the cheapest robust one first: a recruit rule of a few numbers over the forest,
searched by whole runs, which cannot be fooled by the compounding since every run is played by the candidate from first
to last. Two knobs on the forest out of battle (`outforest.js`, commits 1977ee8, 62a9246): `adjust`, a correction of
each candidate's advantage over today's pick, Σ w × (its read − today's) over the candidate's reads (a recruit or
passing on, a new kind, the souls of its kind, melee, ranged, tier, its answers to the rooms ahead), each w a number or a
list by floor; and `deltas`, the margin by floor. Then the same search over forests fitted on one decision's playouts,
the refit's (`rf-refit/rf-fits`: recruit-2 on `rf-out`, the labels made under the shipped expert, on-policy for it;
recruit-3 on those and `rf-out1`, made under the sketch alone), whose pass bias a bias toward recruiting can take off;
and over both forests at once (`mergeOutForests`: their trees as one forest, a forest's trees counted `times` over, the
mean read). Then option 1 from the kept (policy iteration: labels made under the learner itself, a forest of them
beside the rest, the bias set again by whole runs). Option 3 (ε-perturbed whole runs, each decision credited by its
run) is option 1's label with one candidate a run in place of all, and was not run.

**What the search found** (`rcs`, against the shipped: 201 clears, 78.5%; progress 83.1; died on floor 1 / 2 / 3 50 / 1
/ 4; 11.6 recruits a run, 7.7 souls at the end; the Court in 78% of final armies; a w of a list is by floor):

| Candidate | Seeds, decision | Progress | Clears | Recruits | Souls | Court |
|---|---|---|---|---|---|---|
| A1 δ 0.1 | 128, futile | −0.54 ± 0.53 | +3 −5 | 14.2 | 8.9 | 77% |
| A2 recruit +0.1 | 128, futile | −0.80 ± 0.59 | +1 −1 | 13.3 | 8.4 | 77% |
| A3 recruit −0.1 | 128, futile | +0.00 ± 0.00 | +0 −0 | 10.1 | 6.7 | 77% |
| A4 recruit [+1, 0, 0] | 128, futile | −7.97 ± 2.80 | +6 −21 | 12.6 | 8.7 | 61% |
| A5 recruit [−1, 0, 0] | 256, level | +0.17 ± 1.67 | +18 −18 | 9.7 | 6.7 | 74% |
| A6 recruit [0, +0.2, +0.2] | 128, futile | −0.03 ± 0.38 | +2 −2 | 16.0 | 9.5 | 73% |
| A7 recruit [0, −0.2, −0.2] | 128, futile | +0.00 ± 0.00 | +1 −1 | 9.3 | 6.1 | 76% |
| A8 a new kind +0.3 | 192, futile | −0.23 ± 0.74 | +3 −3 | 12.7 | 8.7 | 77% |
| B1 a new kind [1.5, 0, 0] | 128, futile | −5.95 ± 2.36 | +5 −13 | 10.9 | 8.1 | 68% |
| B2 souls of its kind [−1, 0, 0] | 128, loss | −14.75 ± 3.19 | +5 −29 | 7.2 | 6.0 | 58% |
| B3 melee [1.5, 0, 0] | 128, futile | −4.16 ± 1.99 | +4 −13 | 12.9 | 8.5 | 68% |
| B4 ranged [1.5, 0, 0] | 128, loss | −11.92 ± 3.06 | +7 −26 | 11.5 | 8.3 | 59% |
| B5 its answers to the next three rooms [3, 0, 0] | 128, loss | −10.02 ± 2.89 | +8 −23 | 12.0 | 8.4 | 63% |
| B6 tier [1, 0, 0] | 128, loss | −13.68 ± 3.31 | +8 −32 | 11.8 | 8.7 | 51% |
| B7 a new kind [0, 0.3, 0.3] | 256, level | +0.13 ± 0.13 | +3 −2 | 12.7 | 8.7 | 79% |
| B8 souls of its kind [0, −0.2, −0.2] | 128, futile | +0.00 ± 0.00 | +3 −6 | 8.2 | 6.4 | 73% |
| C1 floor 1 silent (δ 10⁹ there) | 192, futile | −3.98 ± 2.99 | +18 −32 | 12.2 | 8.5 | 58% |
| C3 δ 3 on floor 1 | 256, level | −3.36 ± 2.41 | +23 −42 | 11.8 | 8.3 | 60% |
| C2 δ 1 on floor 1 | 256, level | −1.14 ± 1.69 | +13 −24 | 11.2 | 7.5 | 71% |
| C6 δ 0.5 on floor 1 | 256, level | +0.47 ± 0.74 | +4 −4 | 11.8 | 7.7 | 77% |
| C4 floor 2 silent | 128, futile | +0.00 ± 0.00 | +2 −2 | 10.2 | 6.8 | 75% |
| C5 floor 3 silent | 256, level | +0.00 ± 0.00 | +1 −0 | 10.2 | 6.7 | 77% |
| C7 floors 2 and 3 silent | 128, futile | +0.00 ± 0.00 | +2 −3 | 8.2 | 5.6 | 75% |
| D1 recruit-2, recruit [2, 0.15, 0.15] | 64, loss | −23.36 ± 4.89 | +1 −30 | 13.0 | 9.3 | 20% |
| D2 recruit-2, [3, 0.15, 0.15] | 64, loss | −30.34 ± 4.84 | +0 −34 | 12.6 | 9.6 | 17% |
| D6 recruit-2, [2, 0, 0] | 64, loss | −23.16 ± 4.89 | +1 −34 | 9.3 | 8.1 | 20% |
| D3 recruit-3, [2.5, 0.2, 0.2] | 256, level | −1.83 ± 2.47 | +28 −56 | 24.0 | 10.4 | 52% |
| D4 recruit-3, [3.5, 0.2, 0.2] | 128, futile | −5.10 ± 3.31 | +11 −28 | 24.5 | 10.5 | 48% |
| D5 recruit-3, [2.5, 0, 0] | 256, level | −2.09 ± 2.47 | +26 −56 | 10.1 | 7.1 | 47% |
| E4 round 2 and recruit-3 as one, no bias | 128, futile | −4.69 ± 3.08 | +9 −17 | 8.1 | 5.9 | 70% |
| E2 the same, [1, 0, 0] | 256, level | +0.66 ± 1.95 | +24 −24 | 10.8 | 7.1 | 71% |
| E1 the same, [0.5, 0, 0] | 256, level | +1.40 ± 2.08 | +26 −25 | 10.2 | 6.6 | 68% |
| **E3 round 2 twice and recruit-3, [0.4, 0, 0]** | 256, level | **+1.75 ± 1.63** | **+19 −12** | 11.0 | 7.1 | 76% |

- **Floors 2 and 3 decide nothing.** The forest silenced there (C4, C5, C7), or a bias of ±0.2 that moves the recruits
  a run from 9.3 to 16 and the souls at the end from 6.1 to 9.5 (A6, A7), changes no run's progress and a few clears
  either way. (A death in the Sovereign's room reads ~99.9 of progress: late changes show in the clears alone.)
- **Floor 1 decides everything, and the shipped forest's floor 1 is a sharp optimum of this family.** Silenced there
  −4 (+18 −32), its confident decisions alone (δ 3) −3.4, a bias toward taking −8, every nudge of its choice of kind −4
  to −15; a bias toward passing (A5) and a margin of 0.5 (C6) level. The Court is made there: on `rcs`, 239 of the
  shipped's 418 Courts in floor 1's battles, 147 on floor 2's. Every candidate that loosens the Court's grip (A4, B,
  C1, C3, D) pays in clears: on floor 1 where its choice of kind is worse, in the Sovereign's room where its floor 1
  holds (D3, D5): the Court is the Sovereign's answer.
- **One decision's labels, corrected on whole runs.** recruit-2, fitted on labels made under the shipped expert (the
  on-policy relabel, k = 0), stays ruinous whatever the bias (floor 1 kills 27 of 64 runs against 9): its floor-1
  choice of kind is wrong, not only its passing. recruit-3, its pass bias taken off (it reads passing on floor 1
  +2.1–2.4 over the sketch's recruit at the median, the shipped forest −0.1–0.1), plays floor 1 as well as the shipped
  (D5 died there 53 against 50) and builds another army (the Court in 47% of final armies, the Frost Sprite's trine
  62%, Winter Court 24%; 14 kinds in a tenth of them against 12, 15 recipes made against 11, the skirmishers' synergy
  in 42% of battles against 9%) that the Sovereign kills (19 against 4).
- **Both as one.** The shipped forest's trees and recruit-3's read together, their pass bias (+0.3 at the median on
  floor 1) taken off by a bias of 0.4 toward recruiting there: level or better in every weighing, the best the old
  forest counted twice (E3), where its sense of floor 1 leads and the refit's of the current game corrects it. Without
  the bias (E4) it passes, −4.7.

**Confirmation** (E3 on `rcc-0…767`, sequential, played to its last look):

| | The shipped (0418ba3) | The recruit learner (E3) |
|---|---|---|
| clears | 584 (76.0%) | **599 (78.0%): +66 −51, +2.0 ± 1.4 points** |
| progress | 81.9 | **84.2: +2.28 ± 0.96, z 2.38 ≥ 2.03, a win** |
| died on floor 1 / 2 / 3 | 164 / 3 / 17 | 141 / 1 / 27 |
| in a boss's room | the Sovereign 17, the Barrow Marshal 15, the Mire Mother 11, the Molting Abbess 5, the Swarm Queen 1 | the Sovereign 27, the Mire Mother 7, the Barrow Marshal 4, the Molting Abbess 4, the Swarm Queen 2 |
| battles a run; lost | 30.8; 184 | 31.7; 169 |
| recruits a run; souls at the end | 11.7; 7.8 | 11.0; 7.4 |
| final armies | Court 74%, Chanter's trine 60%, Sprite's trine 40%, Winter Court 12%, Rime Drake 5% | Court 72%, Chanter's trine 56%, Sprite's trine 51%, Winter Court 19%, Rime Drake 5% |
| synergies (battles); kinds in a tenth | channeler 74%, fae 67%, undead 36%, skirmisher 10%; 4 at 5%+; 10 of 62 | fae 72%, channeler 67%, undead 31%, skirmisher 20%; 4 at 5%+; 10 of 62 |

**Kept** (148dad0; the round below built on it): `expert.json outforest` "recruit-merged-prep-2", its recruit phase 600
trees (round 2's 200 twice and recruit-3's 200; 42,306 nodes; `npm run outforest -- --merge src/sim/expert.json:2,<recruit-3>
--adjust '{"recruit":[0.4,0,0]}'`), δ 0.25, the formation's forest as it was; expert.json 3.3 → 3.6 MB. Fewer runs die on
floor 1 (−23) and more in the Sovereign's room (+10); the Court's grip two points looser (74% → 72%, within the noise),
the Frost Sprite's trine (40% → 51%), Winter Court (12% → 19%) and the skirmishers' synergy (10% → 20% of battles)
grown.

**Policy iteration, one round from the kept** (the brief's option 1: labels made under the learner itself). Labels under
E3 (a frozen copy whose `expert.json` is E3's; `npm run outside -- --label --phases recruit --recruits 1,0`, the new
chance of a recruit's label by floor, floor 1's alone since the rest decide nothing; seeds `rlq-0…127`): 128 runs (97
cleared), 1,346 recruits of 3.3 candidates, each played to the run's end by E3; another candidate the better at 40% of
them (by 6.9), 8.3% clearing where E3's line lost; 39 min. Fitted as round 2 was (200 trees, depth ≤ 6, ≤ 64 leaves of
≥ 50 rows): recruit-4 on them alone (held out, 284 recruits: −0.28 a decision at δ 0.25, +0.31 at 1, the teacher's
+2.67), recruit-5 on them and the refit's (6,542). Under E3 the pass bias is a sixth of the refit's (passing on floor 1
+0.33 over the sketch's recruit at the median, recruit-3 +2.1): the line after a pass recruits as the learner would, so
a pass costs what it costs. Against E3 on `rcs` (208 clears, 84.8; 11.0 recruits a run, 7.1 souls, the Court 76%):

| Candidate | Seeds, decision | Progress | Clears | Recruits | Souls | Court |
|---|---|---|---|---|---|---|
| G4 recruit-4 alone, [0.4, 0, 0], floors 2–3 silent | 64, loss | −16.25 ± 3.96 | +0 −22 | 9.4 | 7.3 | 47% |
| G2 round 2 twice and recruit-4, [0.2, 0, 0] | 128, futile | −2.94 ± 2.31 | +5 −12 | 9.3 | 6.4 | 73% |
| G3 round 2 twice and recruit-5, [0.25, 0, 0] | 256, level | +0.82 ± 1.45 | +14 −11 | 10.8 | 6.9 | 77% |
| G5 round 2 twice, recruit-3 and recruit-4, [0.6, 0, 0] | 256, level | +0.64 ± 1.53 | +15 −13 | 10.6 | 6.8 | 72% |
| **G1 the same, [0.4, 0, 0]** | 256, level | **+0.99 ± 1.42** | **+13 −9** | 10.1 | 6.6 | 70% |

The pure step (recruit-4 alone) fails as the refit's forests did: on-policy or not, one decision's playout is nearly a
coin flip to a forest of a thousand decisions. Beside the old forest and the refit's it is a correction: G1 on 768
fresh seeds `rcd-0…767` against E3, **progress +1.00 ± 0.83 (z 1.21, level by the sequential bound, beyond one standard
error), clears 637 against 628 (+44 −35, +1.2 ± 1.2 points)**, died on floor 1 111 against 120, 17 and 17 on floor 3.
**Kept** on the gain beyond one standard error, the clears ahead (8948207): `expert.json outforest`
"recruit-merged-2-prep-2", its recruit phase 800 trees (round 2's twice, recruit-3's, recruit-4's; 47,384 nodes), δ
0.25, the bias 0.4 on floor 1; 3.7 MB.

**A second round** (labels under G1, seeds `rlr-0…127`: 128 runs (103 cleared), 1,381 floor-1 recruits, another
candidate the better at 47% (by 5.3), 6.2% clearing where G1's line lost; 37 min). recruit-6 on them (held out, 271
recruits: +0.10 to +0.12 a decision at δ 0–0.25, the first labels of this record to read above nothing; the teacher's
+1.68), its pass bias gone (−0.11 at the median); recruit-7 on both rounds' (2,727). Against G1 on `rcs` (212 clears,
85.8; 10.1 recruits a run, 6.6 souls, the Court 70%):

| Candidate | Seeds, decision | Progress | Clears | Recruits | Souls | Court |
|---|---|---|---|---|---|---|
| H3 recruit-6 alone, floors 2–3 silent | 128, futile | −7.81 ± 3.41 | +5 −42 | 7.3 | 6.0 | 37% |
| H2 round 2 twice, recruit-3 and recruit-7, [0.4, 0, 0] | 256, level | +0.71 ± 0.78 | +4 −3 | 10.2 | 6.6 | 70% |
| **H1 round 2 twice, recruit-3, recruit-4 and recruit-6, [0.4, 0, 0]** | 256, level | **+1.40 ± 1.09** | **+8 −7** | 9.9 | 6.5 | 70% |

H1 on 768 fresh seeds `rce-0…767` against G1: **futile at 128** (−1.26 ± 0.88, clears +1 −2): **not kept**, G1 stays.
Alone, recruit-6 holds floor 1 (28 deaths there in 128) and loses to the Sovereign (19), the Court in 37% of final
armies. The second round's +1.40 on `rcs` was the selection's: on 1,400 labels a round the iteration paid once.

**The expert at the end** (`rcd-0…767`, fresh to all three; E3 and the kept chosen on `rcs`, E3 confirmed on `rcc`):

| | The shipped (0418ba3) | E3 (148dad0) | The kept (8948207) |
|---|---|---|---|
| clears | 596 (77.6%) | 628 (81.8%): +71 −39 | **637 (82.9%): +76 −35, +5.3 ± 1.4 points** |
| progress | 83.4 | 86.3: +2.93 ± 0.97 | **87.3: +3.93 ± 0.97 (z 4.04)** |
| died on floor 1 / 2 / 3 | 148 / 3 / 21 | 120 / 3 / 17 | 111 / 3 / 17 |
| in a boss's room | the Sovereign 21, the Barrow Marshal 15, the Mire Mother 7, the Molting Abbess 3, the Swarm Queen 1 | the Sovereign 17, the Barrow Marshal 7, the Mire Mother 7, the Molting Abbess 3, the Swarm Queen 1 | the Sovereign 17, the Barrow Marshal 6, the Mire Mother 6, the Molting Abbess 3, the Swarm Queen 1 |
| battles a run; lost | 31.4; 172 | 32.5; 140 | 32.9; 131 |
| recruits a run; souls at the end | 11.9; 7.8 | 11.2; 7.3 | 10.1; 6.7 |
| final armies | Court 76%, Chanter's trine 61%, Sprite's trine 34%, Winter Court 17%, Rime Drake 5% | Court 73%, Chanter's trine 61%, Sprite's trine 50%, Winter Court 22%, Rime Drake 5% | Court 72%, Sprite's trine 55%, Chanter's trine 51%, Winter Court 21%, Rime Drake 5% |
| synergies (battles); at 5%+; kinds in a tenth | channeler 74%, fae 67%, undead 38%, skirmisher 10%; 4; 11 of 62 | fae 72%, channeler 69%, undead 33%, skirmisher 20%; 4; 10 | fae 73%, channeler 67%, undead 31%, skirmisher 24%; 4; 10 |

**The monoculture.** The clears are gained while the Court's grip loosens a little (76% → 72% of final armies here, 74%
→ 72% on `rcc`), the second pillar moving from the Chanter's trine (61% → 51%) to the Frost Sprite's (34% → 55%) and
Winter Court (17% → 21%), the skirmishers' synergy held in 24% of battles against 10%; the kinds in a tenth of final
armies (10–11) and the synergies held (4 at 5%+) as they were. The recruit can loosen the Court by a few points for
nothing (E1 68%, the kept 70% on `rcs`), not break it: every candidate that held it under 64% (A4, B2, B4–B6, C1, C3,
D) lost clears, on floor 1 or to the Sovereign. Breaking it stays the balance pass's.

**How it was run** (scripts in the session's scratchpad, `rl-recruit/`, its NOTES.txt the log): a frozen copy of the
worktree's `src/` (and, for the labels, copies whose `expert.json` is the expert labelled); a queue of resumable jobs
under one runner (a lock, `rf-refit`'s); a comparison a job (`rl-seq.mjs`: every run a line appended to its player's
play file as it ends, never played twice, a base's file shared by every comparison on its seeds; §3's rule applied at
each block); the diversity block by `autoplay.js diversity` on the same lines. Cost, four workers: selection 7,424 runs
(rounds A–E 69 min, G 12, H 8), confirmation 4,096 (`rcc` 20 min, `rcd` 31, `rce` 3), labels 76 min (two rounds of
128 runs, floor 1's recruits alone), fits a minute each: ~3.7 h of compute in 4.0 h, 11,520 whole runs at ~0.7 s a
run wall. The kept expert's battle costs what the shipped's did (61.2 ms against 60.9 on `div-0…15`, one process,
alternating); its runs are as long as they live (2.13 s a run against 1.43 there, 35 battles a run against 23).

**What it says.** Judged by whole runs, the recruit decision is a floor-1 decision: later recruits, moved from 8 to 16
a run, move no outcome. There the old forest is a sharp optimum against every rule of a few numbers, and forests
of one decision's playouts, the refit's or the learner's own, fail alone (they pass, or choose the wrong kind). As a
correction beside the old forest, their pass bias taken off by one number chosen on whole runs, they gain: the
current game's playouts (the refit's) +2.3 to +2.9 points, the learner's own a point more. Policy iteration works here
as a conservative step (the new forest's vote among the old ones', a bias set by whole runs), not as a refit, and its
second step gave nothing on 1,400 labels. Labels made by the learner itself price a pass more truly each round (the
pass bias +2.1, +0.33, −0.11): what the refit asked for. The next attempt: a round's labels from more runs (the held-out
gain first read positive at the second round), or the label of a decision averaged over several continuations.

**Tests**: 532, all passing (`--test-concurrency=2`, 113 s): `test/outforest.test.js`'s 3 new (the correction and the
margin by floor, the recruits' labels by floor, forests merged); no test's seed or expectation moved.

### The balance pass, part 2 (2026-10-16)

**What** (§6 Step 6's loop, on the retrained expert: §4.0, the refit's formation forest and the recruit learner's G1;
`src/content.js` and `src/tuning.js`'s game numbers the domain; the expert's weights, tree and forests as they are).
Criteria 1–3, criterion 2 first and judged by the strict commitment (§7, the user's word); criterion 4 is the next
part's, and level-0 free play was held near where it stood. Selection on seeds `b2s-*`, confirmation on fresh `b2c-*`;
the base eaeaab0. Each candidate played in a copy of the tree with the change and its book remade (`npm run combos`),
paired seed for seed against the base by its own runs (a script beside the harness's `--builds --strict`, every run a
harness job kept in the run cache, so the CLI's rows and the script's are the same runs): the strict rows on 64 seeds,
free play on 256 in blocks of 64 stopped for a loss by §3's bound. Four workers, nothing else on the box.

**Phase A: the base on the retrained expert** (eaeaab0; `npm run builds -- --commit none --runs 256 --seed b2s`;
`npm run pool -- --seed b2s`; `--builds --strict --runs 64 --seed b2s` for the five kins, the five mixed and written
fused kinds, the ten trines of base kinds a run can reach and the five reachable capstones; `npm run ablations --
--variants relics --runs 256 --seed b2s`; free play on `b2c-0…255`, the confirmations' base).

Free play, `b2s-0…255`: **201 clears (78.5%)**, progress 82.7; dead on floor 1 / 2 / 3 **50 / 2 / 3**, the floor-1 deaths
in its fights (ranks 2–12; the Barrow Marshal's and the Molting Abbess's rooms one each), the Sovereign 3 of the 204
that met it (15.8 turns a battle), floor 2's Mire Mother 1 of 189; 31.3 battles a run, 9.7 recruits, 6.6 souls at the
end. Criterion 3: the Pale Court in 68% of final armies (the Frost Sprite's trine 55%, the Chanter's 47%, the Winter
Court 22%, the Rime Drake 3%); 3 of the 22 base recipes made in 8% of runs or more, the Court (77%) and the Sprite's
(69%) and the Chanter's (47%) trines (the Rime Drake 4%, the Ghoul's trine and the Colossus 2%); synergies held in 5% of battles
or more **4 of 11** (Mirage 74%, Echo 67%, Legion 27%, Ambush 22%; Dragonfire under 1%; none in 16%); 10 of 62 kinds
in a tenth of final armies (the Marsh Hag, the Mire Mother's court, in 39%); relics 2.7 a run (Command 33%), bought
on floor 3 (557 of 702), floor 2 (131) and hardly on floor 1 (14); a clear ends with a median 507 essence unspent.
On `b2c-0…255` (the confirmations' base): 210 clears (82.0%), progress 86.7, dead 39 / 0 / 7; the Court in 75% of
final armies; the same four synergies at 5% or more.

Criterion 1, the pool (256 seeds `b2s`): **31 of 44**, as the user's rules left it. Short: the Clockwork Titan (its
Iron Golem 2.9 battles by the end of floor 2), the Engine of Ages and the Iron Barrow on it, the Golem's and the Titan's
trines; the Thorn Dryad's and the Rot Bloat's trines (1.4, 1.5) and their trines; the Marsh Hag's (0.5) and the
floor-3 kinds' (the Ash Wyvern's, the Barrow Wight's, the Frost Wyrm's: none by floor 2).

Criterion 3's relic line, `--ablations --variants relics` (`b2s-0…255`): the full expert 201 clears, without Common,
Uncommon and Rare relics 201: **a drop of 0 points** (progress −0.3 ± 0.2, the ablated a hair ahead; dead 50 / 0 / 5
against 50 / 2 / 3). Relics are bought on floor 3, where hardly a run dies; the deaths are floor 1's, where none are
bought.

Criterion 2, the expert strictly committed, `b2s-0…63` (free play 48 of 64, progress 80.3; progress against it seed
for seed; the boss rooms the most runs fell in; "reached": runs that made its fusion or held its synergy):

| Archetype | Clears | Progress (vs free) | Died on floor 1 / 2 / 3 | Fell most to | Reached |
|---|---|---|---|---|---|
| Winter Court | **49** | 84.5 (+4.2 ± 3.5) | 11 / 0 / 4 | the Sovereign 4 | 19% |
| Aurora | 46 | 78.3 (−2.1 ± 3.6) | 17 / 0 / 1 | the Marshal 3, the Abbess 3 | 2% |
| Pale Court | 41 | 82.8 (+2.5 ± 5.5) | 13 / 0 / 10 | the Sovereign 10 | 80% |
| Fae 4 (Mirage) | 26 | 79.3 (−1.1 ± 5.2) | 14 / 1 / 23 | the Sovereign 20 | 77% |
| Bone Chanter's trine | 17 | 63.1 (−17.3 ± 5.4) | 22 / 16 / 9 | the Mire Mother on floor 2 12, the Sovereign 9 | 56% |
| Frost Sprite's trine | 17 | 70.0 (−10.3 ± 5.2) | 20 / 3 / 24 | the Sovereign 19 | 69% |
| Undead 4 (Legion) | 14 | 64.8 (−15.5 ± 6.2) | 22 / 10 / 18 | the Swarm Queen 12, the Sovereign 9 | 77% |
| Rime Drake | 12 | 41.1 (−39.2 ± 4.8) | 39 / 12 / 1 | the Barrow Marshal 13 | 20% |
| Hive Drone's trine | 9 | 45.8 (−34.5 ± 5.0) | 36 / 15 / 4 | the Barrow Marshal 13 | 25% |
| Ember Drake's trine | 7 | 44.1 (−36.2 ± 4.7) | 36 / 19 / 2 | the Barrow Marshal 13, the Mire Mother 12 | 17% |
| Clockwork Page's trine | 6 | 31.5 (−48.8 ± 5.1) | 47 / 6 / 5 | (floor 1's fights) | 33% |
| Mantis Reaper's trine | 5 | 41.8 (−38.6 ± 4.6) | 36 / 21 / 2 | the Barrow Marshal 13, the Mire Mother 12 | 14% |
| Cinder Wyrm | 5 | 37.7 (−42.6 ± 5.4) | 44 / 10 / 5 | the Barrow Marshal 13 | 6% |
| Pyre Hound's trine | 4 | 38.9 (−41.5 ± 5.6) | 35 / 19 / 6 | (floor 1's fights) | 44% |
| Bone Colossus | 3 | 47.8 (−32.6 ± 5.5) | 32 / 14 / 15 | the Swarm Queen 12 | 66% |
| Tomb Knight's trine | 2 | 41.9 (−38.4 ± 5.4) | 37 / 14 / 11 | the Swarm Queen 8 | 38% |
| Charnel Cathedral | 2 | 52.3 (−28.0 ± 5.0) | 27 / 20 / 15 | the Swarm Queen 16 | 55% |
| Hive Mind | 2 | 44.4 (−35.9 ± 5.0) | 33 / 22 / 7 | the Swarm Queen 18 | 6% |
| Grave Ghoul's trine | 1 | 64.1 (−16.3 ± 5.7) | 12 / 23 / 28 | the Sovereign 11, the Mire Mother 10 | 81% |
| Drake 4 (Dragonfire) | 1 | 32.6 (−47.8 ± 5.6) | 44 / 12 / 7 | (floor 1's fights) | 22% |
| Insect 4 (Frenzy) | 1 | 43.7 (−36.6 ± 4.5) | 32 / 26 / 5 | the Swarm Queen 17 | 69% |
| Construct 4 (Last Stand) | 1 | 26.6 (−53.8 ± 4.9) | 49 / 10 / 4 | (floor 1's fights) | 31% |
| Clockwork Titan | 1 | 20.5 (−59.9 ± 4.7) | 54 / 7 / 2 | (floor 1's fights) | 8% |
| Hive Warden's trine | 1 | 51.2 (−29.2 ± 5.4) | 27 / 22 / 14 | the Mire Mother 12, the Swarm Queen 11 | 56% |
| Hive Queen | 0 | 45.0 (−35.3 ± 5.0) | 32 / 24 / 8 | the Swarm Queen 16 | 31% |

Three of 25 within 15 points of the best, all three the Court's graph (the Winter Court's and Aurora's kinds take in the
Wisps and the Court). Across the 24 committed rows' 1,327 falls, 716 in the floors' fights (451 on floor 1) and 611 in a
boss's room, each boss killing what it answers: the Swarm Queen (walls) 48% of the 257 strict runs that met it on floor
1, the Barrow Marshal (shooters) 29% of 363 there, the Mire Mother (casters) 17% on floor 1 and 25% of 496 on floor 2,
the Sovereign 35% of 417 (free play: 1.5%). The insect rows stall (Wardens mending against foes mending: 19–31 turns a
battle, 1,000-turn stalls lost) and cost 10–15 s a run.

**Phase B: the loop.** Each candidate in a copy of the tree, its book remade, against the base on the same seeds: a
screen of twelve strict rows on `b2s-0…31` (the five kins but Insect 4, whose stalls cost a third of a screen, the Court,
the Sprite's, the Chanter's, the Ghoul's, the Page's and the Hound's trines, the Rime Drake and the Bone Colossus: 384
runs a tree; the base's are phase A's runs) and free play on `b2s-0…127`; what passed it, all 25 rows on 64 seeds and
free play on 256, then the same on fresh `b2c-*`. "Strict sum": the twelve rows' clears added (the base's 65 of 384).

Round 1 (`b2s`, free play 100 of 128 at the base):

- **The floors' bosses lighter where they kill builds** (the Swarm Queen 280 → 220 HP and 22 → 18 ATK of its own, the
  Barrow Marshal 380 → 320 and 24 → 20, floor 2's boss 2.4 → 2 HP and 1.6 → 1.4 ATK): free play the same runs to their
  ends (+0 −0: its deaths come before the bosses), strict sum 65 → 67. Not kept.
- **The Sovereign lighter** (`bossHp` 0.45 → 0.35, `bossAtk` 0.6 → 0.5): free play +2 −0 (+1.6 ± 1.1 points), its two
  deaths in the Sovereign's room gone; strict sum 65 → 84, every row that reaches floor 3 up (Fae 4 12 → 17, the Sprite's
  trine 11 → 15, Undead 4 8 → 11) and the Court with them (20 → 24).
- **The trine table up a seventh** (`TUNING.trine.parts`: HP ×7 → 8 and ATK ×4.8 → 5.5 at tier 1, 7 → 8 and 4.5 → 5.2 at
  tier 2, 6 → 7 and 3.8 → 4.4 at 3, 5.5 → 6.3 and 3.2 → 3.7 at 4; the Court, written, as it was): free play +3 −4 (−0.8 ±
  2.1; progress −1.41 ± 1.28); strict sum 65 → 76, the Court 20 → 20 and the made trines up (the Chanter's 6 → 10, the
  Sprite's 11 → 13, the Page's 2 → 3): the gap narrows from below.

Round 2 (`b2s`, the same screen):

- **Both** (the Sovereign 0.35 / 0.5 and the table up a seventh): free play +3 −3 (+0.0 ± 1.9); strict sum 65 → 93 (the
  Court 20 → 24, Fae 4 12 → 19, the Chanter's trine 6 → 12, the Sprite's 11 → 15, Undead 4 8 → 11).
- **The table up a third alone** (HP ×9, ×9, ×7.7, ×7 by the parts' tier 1–4; ATK ×6.2, ×5.8, ×4.9, ×4.1; DEF a tenth
  up): free play +6 −4 (+1.6 ± 2.5); strict sum 65 → 81, the Court 20 → 20. The Winter Court falls out of free play
  (26% → 8% of final armies): a Frost Sprite's trine now outweighs the capstone it would be fused into, which the
  capstones' rule (HP 1.1× the parts' sum, ATK 1.4× the best part's) set on the old table.
- **Both further** (the Sovereign 0.3 / 0.45 and its court of 1; the table up a third): free play +7 −3 (+3.1 ± 2.5),
  the Sovereign's deaths gone; strict sum 65 → 104 (the Court 25, Fae 4 20, the Sprite's trine 17, Undead 4 and the
  Chanter's trine 12, the Hound's 3, the Page's 4, Construct 4 3). The best so far; the Ghoul's trine (0), the Rime
  Drake (5) and the Colossus (0–1) unmoved, dying on floor 1 and to the floors' bosses before the Sovereign.

Round 3 (`b2s`; the screen with the Winter Court's and Aurora's rows added, the base's sum 109 of 448):

- **The capstones on the new table** (the five with a made trine among their parts, set again by their own rule on the
  table up a third: the Charnel Cathedral 2,100 HP and 113 ATK, the Winter Court 920 and 130, the Cinder Wyrm 1,460 and
  130, the Hive Mind 1,530 and 104, the Engine of Ages 1,910 and 104, their growth alike; on the old ones the Winter Court
  and the Cinder Wyrm fall under their parts' HP, which the content test forbids), with the Sovereign 0.3 / 0.45 and its
  court of 1: free play +5 −4 (+0.8 ± 2.4), the Winter Court back in 28% of final armies; strict sum 109 → 149.
- **The same with the Court lighter** (its ATK 72 → 62 and its growth 10 → 8.6): free play +7 −5 (+1.6 ± 2.7); strict
  sum 142, the Court 25 → 19 but Fae 4, the Winter Court and Aurora (which hold it) no higher: four rows within 15 points
  of the best, the gap closed from above at a cost to all of them. Not kept.
- **The same with the Sovereign lighter still** (0.25 HP and 0.4 ATK of its own, its court of 1): free play as the
  second (the same runs: none of them falls to the Sovereign either way); strict sum 109 → 158: Fae 4 12 → 24 beside the
  Court's 25, the Sprite's trine 11 → 18, Undead 4 and the Chanter's trine 12, the Ghoul's trine 0 → 4. Four rows within
  15 points of the best. **To confirmation.**

**Kept: the Sovereign lighter, the trine table up a third, the capstones on it** (`TUNING.spawn.bossHp` and `bossAtk`
on floor 3 0.45 → 0.25 and 0.6 → 0.4, `court` 2 → 1; `TUNING.trine.parts`; the five capstones' base and growth). Confirmed
on fresh `b2c` (free play `b2c-0…255`; fifteen strict rows on `b2c-0…63`, Insect 4 among them):

| | Base (eaeaab0) | Kept |
|---|---|---|
| free play: clears | 210 (82.0%) | **216 (84.4%): +13 −7, +2.3 ± 1.7 points** |
| progress; died on floor 1 / 2 / 3 | 86.7; 39 / 0 / 7 (the Sovereign 7) | +0.08 ± 1.16; 39 / 0 / 1 (the Sovereign 1) |
| final armies | the Court 75%, the Sprite's trine 54%, the Chanter's 45%, the Winter Court 24% | the Court 68%, the Chanter's trine 53%, the Sprite's 52%, the Winter Court 27%, the Ghoul's trine 6%, the Rime Drake 5% |
| synergies at 5%+ | 4 | 4 (Mirage 77%, Echo 68%, Legion 30%, Ambush 23%) |

| Strict, `b2c-0…63` | Base | Kept (paired) | Died on floor 1 / 2 / 3, kept |
|---|---|---|---|
| Winter Court | 46 | **54** (+9 −1) | 10 / 0 / 0 |
| Pale Court | 41 | 45 (+5 −1) | 18 / 0 / 1 |
| Fae 4 | 33 | **45** (+16 −4) | 10 / 3 / 6 |
| Frost Sprite's trine | 26 | **44** (+21 −3) | 12 / 6 / 2 |
| Aurora | 40 | 42 (+3 −1) | 18 / 2 / 2 |
| Bone Chanter's trine | 16 | **25** (+10 −1) | 21 / 18 / 0 (the Mire Mother 12) |
| Undead 4 | 15 | 21 (+6 −0) | 21 / 13 / 9 (the Swarm Queen 7) |
| Rime Drake | 12 | 12 (+1 −1) | 46 / 4 / 2 (the Barrow Marshal 21) |
| Clockwork Page's trine | 5 | 12 (+9 −2) | 43 / 6 / 3 |
| Grave Ghoul's trine | 3 | 10 (+7 −0) | 20 / 17 / 17 |
| Bone Colossus | 4 | 9 (+5 −0) | 29 / 18 / 8 |
| Drake 4 | 2 | 6 (+4 −0) | 44 / 10 / 4 |
| Pyre Hound's trine | 3 | 6 (+4 −1) | 39 / 14 / 5 |
| Insect 4 | 0 | 5 (+5 −0) | 30 / 21 / 8 (the Swarm Queen 18) |
| Construct 4 | 4 | 5 (+3 −2) | 45 / 8 / 6 |
| sum of the fifteen | 250 | **341** | |

Every row but the Rime Drake's up (it dies on floor 1, 21 of its falls to the Barrow Marshal, before its keystone is
offered), the made trines most; the Sovereign kills 23 of the 960 strict runs against 88. The best is the Winter Court
(54); within 15 points of it the Court and Fae 4 (45), the Sprite's trine a clear short (44).

Round 4 (`b2s`, on the kept; seventeen strict rows, the Tomb Knight's trine, the Charnel Cathedral and the Clockwork
Titan added; the kept's sum 164 of 544; free play 101 of 128 at the kept):

- **The Iron Golem's spawn weight 6 → 7** (criterion 1: a floor-2 fight's captain is a Golem in 32% of fights, was 29%):
  criterion 1 31 → **36 of 44** (the Golem 2.9 → 3.2 battles by the end of floor 2: the Clockwork Titan, the Engine of
  Ages, the Iron Barrow, the Golem's and the Titan's trines; the Ember Drake 4.1 → 3.9, the Mantis Reaper 3.7 → 3.6);
  free play the same outcomes on all 128 seeds (+0 −0); strict sum 164 → 166 (the Titan 0 → 0).
- **The Swarm Queen lighter and slower** (280 → 240 HP, 22 → 20 ATK; two drones every third turn, three standing at
  most, `rules.js swarm_queen`'s params, were every second and four): free play the same; strict sum 164 → 164 (Undead 4,
  the Colossus, the Cathedral as they were). Not kept.
- **And floor 2's boss lighter** (`bossHp` 2.4 → 2, `bossAtk` 1.6 → 1.4: the Mire Mother, which kills the Chanter's
  trine there): free play the same; strict sum 171 (the Sprite's trine 18 → 21, the Chanter's 12 → 13, Undead 4 12 → 13).
  The Golem's weight and floor 2's boss together **to confirmation** (the Swarm Queen's numbers left).

**Kept: the Iron Golem's weight 7 and floor 2's boss lighter** (`content.js` iron_golem `spawn.weight`;
`TUNING.spawn.bossHp` and `bossAtk` on floor 2 2.4 → 2 and 1.6 → 1.4). Confirmed on `b2c` against the first kept change:
free play 216 → 217 (+1 −0; its one death in the Sovereign's room gone); the fifteen strict rows 341 → 355 (Undead 4 21
→ 26, Construct 4 5 → 8, the Page's trine 12 → 15, the Chanter's 25 → 27, Aurora 42 → 45, Insect 4 5 → 7; the Sprite's
trine 44 → 42, the Winter Court 54 → 52, the Court 45 → 44); four rows within 15 points of the best (the Winter Court
52; the Court, Fae 4 46, Aurora), the Sprite's trine at the line's edge (42). Criterion 1: **36 of 44**.

Round 5 (`b2s`, on the second kept change; its sum 166 of 544, free play 101 of 128), screened and **not confirmed**
(the pass was wrapped up here, the user's word: more mechanics are coming, no need to balance hard):

- **A fusion cheaper** (`TUNING.essence.fuse` 8 → 6 an essence a tier of the result): free play +7 −1 (+4.7 ± 2.2 points;
  progress +4.79 ± 1.77, z 2.7), its floor-1 deaths 27 → 20; strict sum 166 → 185 (the Page's trine 5 → 9, the Hound's 2
  → 5, the Chanter's 13 → 16, Aurora 21 → 26; the Ghoul's trine 4 → 0). The best of the screen, and a floor-1 change: the
  difficulty part's to weigh (below).
- **Echo's lesser form at 0.35** (was half): free play the same outcomes on all 128 seeds; strict sum 166 → 162. Not kept.
- **The fusion cheaper and the Barrow Marshal lighter** (320 HP, 20 ATK of its own): as the first, the Rime Drake 4 → 7;
  strict sum 187.

**Rejected or left, with why** (from part 1's side branch `bal-phase2-draft`, re-read on the new expert where still
relevant): the bosses' Hex rule and lighter bosses are the user's rules now (§8, "The user's rules"); the Ember Drake on
floor 1 is superseded by the captain; the Marsh Hag as a Trickster, Echo's lesser form laying a status only where none
is held (a rule, `rules.js`), the synergies at 3 and Mirage foiling a whole blow were not re-measured (rules or rejected
there by large losses); relics a third cheaper bought more and gained nothing there, and the relic line here is a rule's
question (below).

**The criteria at HEAD** (the two kept changes; `b2c` unless said):

- **Criterion 1: 36 of 44** recipes reachable (`b2s`, 256 seeds; 31 at eaeaab0). Short: the Thorn Dryad's and the Rot
  Bloat's trines (1.4, 1.5 battles; floor-2 kinds of a fight's draws, 4% each) and their trines, and the four floor-3
  kinds' trines (the Marsh Hag's 0.5, the Ash Wyvern's, the Barrow Wight's, the Frost Wyrm's: none by floor 2). The first
  two need the Dryad met on floor 1 (the floor-1 pool's slice, Part one §2.4, a test pins it) or the Bloat drawn twice as
  often on floor 2; the floor-3 kinds can't be offered by the end of floor 2 while they are floor 3's.
- **Criterion 2: not met.** Strict on `b2c-0…63`, the fifteen rows (eaeaab0 → HEAD): the Winter Court 46 → 52, Fae 4 33
  → 46, Aurora 40 → 45, the Court 41 → 44, the Frost Sprite's trine 26 → 42, the Bone Chanter's 16 → 27, Undead 4 15 →
  26, the Clockwork Page's 5 → 15, the Rime Drake 12 → 13, the Grave Ghoul's 3 → 9, the Bone Colossus 4 → 9, Construct
  4 4 → 8, Drake 4 2 → 7, Insect 4 0 → 7, the Pyre Hound's 6 → 5: the sum 250 → 355, the kins' own archetypes in single
  figures where the kin's one floor-1 kind fights in melee (Drake 4, Construct 4, Insect 4). Within 15 points of the
  best (the Winter Court's 52 of 64): 4 of the 15 (were 3), the Sprite's trine at the edge. The other ten rows were not
  measured at HEAD on `b2c`; on `b2s-0…31` at HEAD the Tomb Knight's trine 3, the Charnel Cathedral 5, the Clockwork Titan
  0. What holds the bottom: held to its kinds a melee build fields melee pieces on floor 1 and falls there to shooters and
  flyers (the Monarch's killers in the strict runs of the Ghoul's trine at eaeaab0: Reach 28, Shape 13, Fly 10; Undead 4:
  Fly 20, Shape 15, Reach 9), and the mixed recipes and capstones whose keystone is a floor-2 kind (the Rime Drake, the
  Hive Queen, the Titan) fight floor 1 with no fusion of theirs to make (the Rime Drake 46 of its 51 falls on floor 1,
  21 to the Barrow Marshal). Neither is a number's to answer.
- **Criterion 3: not met** (free play `b2c-0…255`, 217 clears): the Court in 66% of final armies (75% at eaeaab0); 3 of
  22 base recipes made in 8% of runs or more (the Court 81%, the Sprite's trine 72%, the Chanter's 54%; the Ghoul's trine
  6%, the Rime Drake 4%); 4 of 11 synergies at 5% of battles or more (Mirage 77%, Echo 68%, Legion 30%, Ambush 23%), as
  at eaeaab0; 10 of 62 kinds in a tenth of final armies; the relics ablation 0 points at eaeaab0 (not measured again: no
  change here touches a relic, a Shop or floor 1). The Court's grip is the recruit forest's (fitted on the old game: it
  takes the Wisps on floor 1, §8 "The recruit learner"); content moved it 9 points, the made trines gaining.
- **Not mine, for the difficulty part** (criterion 4): the expert's free play at level 0 on `b2c-0…255` 210 → 217 clears
  (82.0% → 84.8%), its deaths 39 / 0 / 7 → 39 / 0 / 0: every death now on floor 1, in its fights (ranks 2–12) and once
  in the Barrow Marshal's room; the Sovereign kills nothing in free play and 0–6 strict runs of 64 a row. The ~90%
  is floor 1's to give: the screened fusion price (above) is +4.7 points there. The calculator's reach of floor 2 was
  not measured in this part (part 1: 8 of 64 on `bal`); nothing kept touches floor 1's foes, so it should stand.

**Left for later** (the user's, or the next pass's):

1. **The relics line, a rule's question.** 0 points on 256 seeds at three floors: relics are bought on floor 3 (557 of
   702; floor 2 131, floor 1 14), where hardly a run dies (50 / 2 / 3), and a clear ends with a median 507 essence
   unspent. No price makes them matter while the deaths are floor 1's and the purchases floor 3's (part 1: relics a third
   cheaper, more bought, nothing gained). For the user: relics where runs die (an elite's or a floor boss's spoils laying
   out a relic, the old spec's "an elite lays out no relic" reversed, or a floor-1 Shop early), §7.3's Rare relics with a
   rule (they would act on floor 3, where nothing is decided at level 0), or the line judged at a level of the ladder
   where floors 2–3 kill.
2. **Criterion 2's floor and the strict commitment.** The kins with one floor-1 kind, a melee one (Drake: the Pyre Hound;
   Construct: the Clockwork Page; Insect: the Hive Warden, whose armies stall, mending against menders), and the melee
   trines are held by the harness to melee armies on floor 1. A harness question (a strict run allowed the field's
   answers, a soul outside its kinds that shoots), the kin archetypes judged as their Monarch (the Brass, Ember and Hive
   Monarchs hold their kin's banner and draw it ×3), or content (a shooter of each kin on floor 1): the user's.
3. **A fusion's price 8 → 6**, screened above (+4.7 points of free play, strict sum +19), to confirm on fresh seeds with
   the difficulty part, since it eases floor 1 for every build.
4. **Criterion 1's last eight** (above), and the recruit forest refitted on the content as it now stands (§3's
   milestone) before criterion 3's fused-kind line is read again.

**How it was run** (scripts in the session's scratchpad, `b2/`): the base and every candidate a copy of `src/` with its
patch and its book remade (`b2-mkvar.sh`, `b2-patch.py`); `b2-seq.mjs` played a comparison as harness jobs through each
copy's `buildRecord` and its run cache (the CLI's `--builds --strict` rows and the script's are the same runs), the free
play in blocks of 64 stopped only for a loss. Four workers, ~0.6–0.9 s a run wall (a stalled strict run of the insect
rows 10–80 s): phase A 2,600 runs in 37 min; five screens and two confirmations ~13,000 runs in 2.4 h.

**Tests**: 532, all passing (`--test-concurrency=2`); no test's number moved (the trine table, the bosses' and the
capstones' numbers are read from `TUNING` and the records where a test reads them).

## 9. Standing rules

In force before the plan and still, with the amendments it makes (`DESIGN.md` §7's list, decided before the rules
redesign, is folded in here):

- Enemy behaviour is discovered, never previewed: roads and the waves' turns are shown; a kind's reach, Move and way
  line are learnt by meeting it and then recorded, **and a met kind's reach is drawn on the board when tapped**
  (§4.8); nothing of the foes' coming turn is drawn.
- Defeat is absolute. No lives, no retreat.
- The skill gap opens in the player's decisions, in prep and in the turn, never in dice. **Floor 1 is hard at the top
  of the ladder** (§4.6), winnable at its foot.
- The dead never block the roads. Foes keep to the one drawn road; flyers the air road, blocked by your pieces.
- One soul is one piece is one body; no stacks. A piece counts once toward synergies, **a trine as the three it was
  made of** (§7.7, 2026-10-16).
- A fusion is never weaker than what went into it. **Every kind of tier 4 or less has a triple** (§4.1).
- Money always matters: essence is scarce on every floor, and a relic bought is a tier not bought.
- Balance comes once, at the end. No tuning while building, but the numbers a step names (§6).
- Plan first; at most two agents at once; implement → verify → clean → bug hunt → bug hunt → balance. **Measure with
  the instrument §3 names for the question**, pair by seed, and never keep a change on the seeds it was chosen on (a
  comparison may stop once decided by §3's rule, 2026-10-16; its selection and confirmation seeds stay distinct).
- **The autoplayer is frozen** (§3, §4.0): its weights are not searched again and its rules not rewritten; its
  forests and route are refitted only at a milestone (the recruit learner of 2026-10-16 aside, §7), and a refit is kept
  only on a paired gain on fresh seeds. The book is remade after every content change.
- One universal landscape interface, modular tabs, nothing that needs hover or a key.
- Recruit only: one slain foe a battle, as a full soul into the ossuary (§7.2 may amend).
- Content is data; code grows only when the vocabulary grows. A generated trine is content made by one rule (§4.1).
- Tests are functional only until the balance pass: a test pins a rule, never a seed's outcome a balance pass may move.
