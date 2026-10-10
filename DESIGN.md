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
   Monarch's HP and Command, and Arise and its growth, come as relics.
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
- **The Monarch is pre-placed.** Each camp map marks its seat with `'M'`. It never moves, never strikes (its ring
  of 1 only holds the foes beside it, §2.3), and no action places it or anything on its cell (`monarchSlot(camp)`
  in `src/sim/unit.js`). If it falls the run is over. The camps are designed around the seat: it is the end of
  every road and the shape of the puzzle.

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
- **A fallen piece leaves the field.** A piece whose every body fell in a battle goes to the ossuary as the battle
  ends (`finishBattle` in `src/sim/run.js`), freeing its cell and its Command slot, and lies there fallen until an
  altar raises it (where it lies: then it may be placed again). No action places a fallen soul (`canPlace`), nor
  splits a piece of fallen bodies onto the camp; the ossuary strip marks it fallen. It may still be stacked into a
  piece of its kind (a body down in that pool), fused, or released.
- A piece counts once toward synergies whatever its count or size (§2.7).

### 2.3 Rings

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
  they did. A melee blow cannot strike a **flying** foe (§2.4), so a melee ring never holds one, and a piece whose ring
  holds only flyers it cannot strike treats its ring as empty.
- **A foe has no melee reach.** Its melee blow strikes only the piece of yours on its next tile, the Monarch once
  beside it, and a piece of yours beside it (footprints counted) that has aimed a blow at it this battle, hit or
  miss: it strikes back at that one while both stand beside each other. A Shape blow still spreads from that target
  as its shape says. The long arm is yours alone. A foe's ranged blow reaches its range, never past its ring, as
  yours does (`closeIn`, `reachOf` in `src/sim/battle.js`).
- Target, yours: the foe in reach furthest along its own road (lowest road distance to the Monarch, §2.4: a Flank
  kind's on the Flank field while a way round your pieces reaches it, a flyer's its Chebyshev distance to the
  Monarch); ties by lane, centre first (`CENTRE_OUT`).
  Target, a foe's: of what its blow may strike, the piece on its next road tile first, else the nearest, ties by
  lane. A Flank kind on a road round your pieces strikes only the Monarch and the piece in its way (as before).

### 2.4 Foes: roads, Walk, Flank, Fly

- Before every battle the game floods outward from the Monarch's tile through every open tile (walls block,
  pieces do not), giving each tile its road distance and one **arrow**: the neighbouring tile with the lowest
  distance; among equals the tile nearest the Monarch's lane, then straight ahead, then nearer the centre. Drawn
  on the board in prep. Arrows point strictly closer, so a queue never deadlocks.
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
  - **with its next tile held** in its layer, once it is armed there: blocked by a piece of yours or the seat, a
    melee foe fights the blocker; queued behind a comrade that has stopped (halted, or stuck itself), a ranged foe
    shoots over it. **A moving queue is no halt**: behind a comrade still on the move (one whose last turn walked it,
    or queued it behind one on the move: the unit's `walking`, set each turn and read as it stands, so the order two
    foes act in delays a halt by a tick at most and a battle stays a function of its setup) a foe waits its turn,
    doing nothing. Stuck with nothing to strike, it stands and does nothing too.

  Halted, it fights: its ranged blows at whatever they reach, its ally abilities (heals, purges, wards, Grave Tide) as
  before, its melee only at what §2.3 allows. A foe standing unhalted, walking or waiting, uses none of them. Once
  nothing halts it (the piece fell, the tile cleared, the one that struck it fell) it walks on, on its step clock
  (`chooseAction` in `src/sim/battle.js`). Three behaviours, learnt by meeting a kind (§7), and recorded in the
  bestiary:
  - **Walk**: the arrows, into your rings, halting as above.
  - **Flank**: floods with your pieces counted as walls and walks round them, striking nothing but the Monarch
    and what stands in its way; with no way round it walks the arrows. It **heeds none of your rings**: it halts once
    one of its blows reaches the Monarch from where it stands (a ranged one within its reach, a melee one beside it:
    `reachesMonarch`), or when blocked (as above), and fights from there. It never strikes back at a piece that struck
    it. Recomputed when a piece of yours rises or falls.
  - **Fly** (`flies: true`): ignores roads and walls. Each step it takes the free neighbouring tile nearest the
    Monarch (Chebyshev), ties in the arrows' order; with none nearer it waits. It may hover over a wall tile. Only
    a ranged blow can strike it, so only a ranged ring (or the Monarch's) can halt it, and only where it can strike
    back (a Hive Drone: beside the Monarch, or beside a piece of yours that shot it). Its own blows are its kind's.
    Flyers of either side hold the air, not the ground: a flyer and a ground unit may share a tile and never block
    each other's steps (the Walk and Flank fields ignore flyers), but two flyers never share a tile, nor two on the
    ground.
- **Statuses the foes bring**, on top of Brittle and Withered: **Burning** (a damage-over-time: `power` true
  damage per tick interval per stack, never missing, no DEF, no crit; up to 3 stacks) and **Hexed** (a slower
  gauge). Both are debuffs Purge and Molt cleanse. Your kinds can learn to inflict them too (tiers, fusions).
- **Death burst** (`onFall: { range, effects }` on a kind): when a piece of the kind falls, its effects run from
  where it fell on the other side's living within `range`. The first: Rot Bloat, which Withers what stood near it.
- Complexity by floor, from the spawn pool's `minFloor`: floor 1 brings Burning (Pyre Hound) beside Walk, Flank,
  reach, Shape, drain and clock; floor 2 brings Fly (Hive Drone, in cohorts) and the death burst (Rot Bloat);
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
(never where it fell: the enemy's dead never block its roads), at the fallen count, if its tier is in reach and
raises are left (`ariseCap`, `ariseTier` and `ariseHaste` in `src/sim/battle.js`, read from the copies the battle
holds; Blood Tithe grows the cap). A shadow holds its tile and is gone when the battle ends. A shadow of a flying
kind flies (it holds, and melee cannot touch it). Recruiting is unchanged and needs no relic: one slain foe a battle,
as a full soul into the ossuary.

### 2.6 Growth

- **Essence** from slain foes: each foe piece slain pays `TUNING.essence.perTier` (3.5) × its tier, whatever its count
  or level (`foeEssence` in `src/sim/run.js`; a shadow pays nothing, but Hollow Court's pay again). It buys only tiers,
  recruits and fusions, and **money always matters** (§6): every price is its floor-1 price × the floor's price scale,
  1 + `perFloor` × (floor − 1) (`floorPrice`: ×1, ×2.1, ×3.2, ×4.3 on floors 1–4, and on down), after the discount
  relics. Floor-1 prices: a tier 20 / 45 / 75 / 120 (I–IV), a recruit 8 × its tier × (1 + 0.35 × (level − 1)), a
  fusion 8 × the result's tier. What a battle buys stays about level from floor to floor, and a floor's pay carried
  down buys less there.
- **Upgrades belong to the kind.** A kind's panel: **two tracks** of tiers I–IV with the crosspath rule (the first
  track past II may reach IV; the other stops at II). Tier IV is a rule, never a percentage: a new or remade ability,
  an aura, +ring, or **Colossus** (`size: 2`). Banner is gone.
- **A kind's level is its tiers'.** No level is bought: a kind stands at `TUNING.level.base` + `perTier` × the tiers
  it holds on both tracks, rounded down (`levelOf`; 2 and 0.5 since the economy pass, 0.34 in the second balance pass, so two tiers make level 3 and IV and II level 5), and every soul of it with it, healed by what it gains. The stat growth levels gave comes with each tier. A
  recruit joins at its kind's level (a kind new to the run at its first, with no tiers), and its offer is priced by
  that level. Foes keep their floor's levels.
- **Fusions** (`FUSION_LIST` in `src/content.js`: `{ id, name, result, needs: { kind: n }, desc }`). A fusion
  consumes bodies from pieces of yours, fielded or in the ossuary, exactly `needs` of each kind (a stack of two
  Tomb Knights is two; a bigger stack gives the bodies asked and keeps the rest, as a split would), costs `TUNING.essence.fuse` × the result's tier (× the floor's price scale), and
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

One escalation bar is always visible. Won when no foe stands and no wave is left; lost when the Monarch falls
(the run ends) or the bar runs out (a defeat, the run ends). A boss's fall crumbles its side.

### 2.9 Cut

Line, Signal, Lunge, Banner, timing marks, the Monarch's seats and moving the Monarch, stride for your side (a
foe keeps its gait), horns (closed: no), the `march` moment. Late on 2026-10-09: the Monarch's points (its four
stats bought with essence), bought levels, the Rite as a room, and then the two points Arise's copies gave it (its
numbers are the relic's now: §2.5).

Vocabulary after the cut: Piece, Stack, Ring, Road, Wave, Shadow, Essence, Tier, Fusion, Synergy, Relic (Common,
Uncommon, Rare, Legendary), Command. Twelve, plus the behaviours (Walk, Flank, Fly) and the statuses. Keystone left
the list on 2026-10-09 (night): the keystones are Legendary relics. Command joined it late that night: with nothing
to buy for the Monarch, relics name it ("+1 Command") and the player has to read it. Domain left it later that
night: it is Arise's reach, and the player meets it only once Arise is held, in the relic's own words. Level is a
kind's tiers read as a number, and Arise's reach, tier and raises are the relic's numbers, read on its card: none is
a word to learn.

## 3. What the player may rely on

1. **Your pieces never move.** A piece fights from the cell you gave it, all battle: its ranged blows to their range,
   its melee to the tiles beside it (two tiles for a long arm), never past its ring.
2. **Foes walk the arrows until they can hit back**: in a ring of yours that can strike them, with something of yours
   in their own reach; beside the Monarch; or with the way ahead held (a piece of yours, the seat, or a comrade that
   has stopped; behind one still walking they only wait). Only then do they fight, and their melee reaches only what
   blocks them, the Monarch, or a piece beside them that struck them, so a melee foe walks on through your rings to
   the first of those. A Flank kind heeds no ring and goes round your pieces, stopping once it can strike the
   Monarch; a Fly kind flies straight at the Monarch over everything. Which kinds do which is learnt by meeting them,
   and the bestiary keeps it.
3. **The roads and the seat are the camp's**, drawn before you place anything. **Coverage**: in prep every road
   tile is shaded by how many of your rings cover it (melee rings count; they cannot reach a flyer, which the
   bestiary will have told you). **The stop line**: a bar on each road tile where a walker first comes under one of
   your rings, the Monarch's among them (`stopLine` in `src/sim/battle.js`): the earliest a walker can halt, never
   that it will (a melee walker passes the bars to what blocks it). It previews nothing of any foe's own: what a
   kind does there is learnt by meeting it.
4. **The fallen leave the field.** A piece that falls whole goes to the ossuary as the battle ends, its cell and its
   Command free, and stays there until an altar raises it.

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
  and nothing else; Escape or tapping empty ground returns to it.
- **Arise is shown only once held.** Without the relic the Monarch's card lists no Arise, its panel has no line of
  it, and the help page names none. Held, the card's Arise line gives its numbers now (reach, tier, raises a battle,
  the copies, Hollow Court and Blood Tithe), the held relic's tooltip the same (`ariseOf`), and the board draws its
  reach ("ARISE · 5").
- **Prep overlays**: the roads (arrows), Arise's reach (once held), the selected piece's ring, coverage, the stop
  line (where a walker first comes into your rings: the earliest it can halt, so its legend, its tile's tooltip and
  the help say), synergy glow.
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
`medianLevel`; `join` takes no `lvl`; no room is a `rite`. New: `ariseOf(s)` → `{ copies, domain, raises, tier,
haste }`; `monarchHp(s)`, `commandOf(s)`; `levelOf(kind state)`, `kindLevel(s, id)`, `lowerTrack`;
`onePick(run)` (a reliquary's offers are one pick). `s.kinds[id]` is `{ lvl, tracks, least? }`, `lvl` derived and
kept in step. `TUNING.monarch` is `{ hp }` alone, Arise's numbers `TUNING.arise` (`{ domain, tier, raises, hp, more:
{ domain, tier, raises, haste } }`); in `src/sim/battle.js` `ariseCap(held)`, `ariseTier(held)` and `ariseHaste(held)`
take the relics' rules (`relicRules`), `createBattle` takes the reach as `domain` and the rest from its `relics`, and
`battleSetup` gives no more than that; `TUNING.level` is `{ base, perTier }`; `TUNING.relic.offer` is `{ reliquary, elite, tiers }` and its weights have
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
  Burning and Hexed FX; the Fusions page; the glossary cut to the thirteen words (twelve since Domain left: §2.9); the help text.
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

Open, decided later:

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
