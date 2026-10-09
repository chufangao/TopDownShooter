# RETINUE: the dead keep the plan

The rules redesign decided on 2026-10-08, and the plan for building it. For Chufan and for any Claude Code
session working in this repo: read this before touching `src/sim/*`. It replaces `reDESIGN.md` (the Monarch
proposal and balance record) and the rules half of `HANDOFF.md`; both were deleted from the working tree the
same day. Nothing in this file is implemented yet. Section 5 says what to build and in what order.

## 1. Why

The game as committed (`4fe6148`) has too many mechanics and no way to predict a battle. Both sides pathfind
across the board; a unit's order (Hunt, Stay, Move) is an intention it interprets by searching and reacting,
and Falter, Engaged, leashes and held starts change what it does mid-fight. About forty keywords explain it.
Bloons TD and Slay the Spire are the bar for clarity: enemies come to you along a track you can see, your
units do one legible thing, and nothing is hidden. Door Kickers is the bar for command: draw the plan, press
go, watch it carried out.

The one idea that gives both: **your army does exactly what you drew, and nothing else; the living enemy is
the only side that improvises.** The dead don't rout, hesitate or chase. They walk the line you drew, fight
what comes within reach, and walk on. Every surprise in a battle comes from the living side, which is where
the discovered enemy behaviours live. That is the necromancer's advantage made into a rule.

Rejected on the way here:

- **A continuous board.** It buys spectacle, not scale, and makes pathing less predictable. Scale comes from
  stacks and horde rendering on the grid.
- **Fixed lanes with static units (PvZ).** Clear, but generic, and nothing about a commander survives.
- **Static placement with no movement at all.** Clear, but most of the roster becomes turrets and the army
  never advances. Movement is fine when it is drawn rather than searched.

## 2. Rules

### 2.1 Board

- Tiles, 8-neighbour. Distance is the Chebyshev distance (`distance` in `src/sim/unit.js`). A step may not
  squeeze diagonally past a wall's corner (`steps`).
- For now the board stays `COLS` 7 wide and `DEPTH` 11 deep: the camp's 7 rows at the bottom (y 0 is the
  rear), a gap row, the foes' 3 rows at the top. Widening it is an open question for the content pass (§6).
- Walls come from the room's camp map (`CAMP_LIST` in `src/content.js`) and stand in the camp. They are the
  enemy's track: see §2.6.
- The Monarch stands on a tile of your choosing in the rear two rows of the camp. It never moves and never
  strikes. If it falls the run is over.

### 2.2 Pieces and stacks

- A **piece** is one kind on one tile with a **count**, the bodies in it. Your pieces are souls from the
  ossuary; a foe piece is a captain and its cohort, or any group the room lists.
- Stacking is manual: in prep, drag a soul of the same kind onto a piece to add a body, drag a body off to
  split. Nothing ever stacks by itself.
- A stack's HP pool is count × body HP. Its damage is living bodies × body damage, where living bodies is
  ⌈hp ÷ body HP⌉, so bodies fall one at a time and a shrinking stack hits softer. Any hit that lands on the
  tile lands on the pool once, so a Shape hit on a stack of ten is a hit on all ten. That, and that a stack
  covers one tile, is the reason not to stack everything.
- **Command** is how many pieces you may field. The rest of your souls wait in the ossuary.
- A piece counts once toward synergies whatever its count (§2.9).

### 2.3 Rings

Every kind has a **ring**, a radius in tiles, drawn around the piece in prep.

- **A piece fights whatever is in its ring; otherwise it follows its line.** This one rule replaces "fights
  what blocks it", the Reach behaviour, Engaged and Approach.
- Melee kinds have ring 1 (the eight tiles around, as `rangeOf` has it today) or 2. A piece with ring 2 and
  a foe at distance 2 **lunges**: it steps onto a tile adjacent to the foe, strikes, and when its ring is
  clear it walks back to the tile it left and continues its line. A lunge needs an open tile to step onto;
  with none it waits. A ranged kind's ring is its reach and it never steps.
- The ring is measured through walls for shots. Nothing about it is hidden: each kind's ring is on its card.
- Target: the foe in the ring furthest along its road (lowest road distance to the Monarch, §2.6); ties go
  by lane, centre first (`CENTRE_OUT`). One rule for every piece. Per-piece targeting options (first, last,
  strong) are a possible later addition, not part of this pass.
- Foes have rings too. Ring 1 is a walker that fights what blocks it; a ring of 3 is what used to be
  called Reach. A foe's target is the piece on its next road tile if that is in its ring, otherwise the
  nearest piece in the ring, ties by lane.

### 2.4 Lines

- In prep, drag from a piece along tiles to draw its **line**, its march for the battle. Each step must be a
  legal step (§2.1). A line may cross tiles your other pieces hold and may run anywhere on the board.
- A piece with no line holds its tile. A piece with a line walks it one tile per `TUNING.board.stepTicks`
  (a kind may scale that with a `stride`), fighting whenever something is in its ring (§2.3) and walking on
  when the ring is clear. At the last tile it holds.
- A marcher whose next tile holds a friendly piece waits behind it, as foes queue. Since lines are finite
  and pieces never pathfind, waiting is visible in prep (§3) and never a deadlock in the sense of two
  pieces each waiting on the other for the whole battle: that is a plan you drew and can see.
- Lines persist between battles as standing orders (`s.lines[uid]`, the tiles and the signal). Moving a
  piece clears its line. In a new room a line is clipped at its first tile that is now a wall.
- Shadows and summoned bodies have no lines of their own: a shadow holds where it rose (§2.7); a body added
  to a stack is part of the stack.

### 2.5 Signals

A line may wait for one signal before it starts. Shown as a marker on the line's first step.

| Signal | Fires when |
|---|---|
| Time *t* | the battle clock reaches *t* |
| Blow | the first blow lands, either side |
| Wave *n* | wave *n* begins to enter |
| Struck | a blow lands on the Monarch |
| Fallen | the first piece of yours falls |

`battle.signals` already carries struck, wave and falls, and reserve entries already wait on `time`; Blow is
new. Five is a ceiling, not a target: cut any that go unused in the content pass.

### 2.6 Foes and roads

- Before every battle the game floods outward from the Monarch's tile through every open tile (walls block,
  pieces do not), giving each tile its road distance and one **arrow**: the neighbouring tile with the lowest
  distance. Among equals the order is fixed: the tile nearest the Monarch's column, then the one straight
  ahead, then the one nearer the centre lane. Two foes on the same tile always walk the same way. The field
  is drawn on the board in prep, and redraws live when the Monarch is moved.
- Foes come from the top edge as pieces, in numbered waves, each in a lane, and walk the arrows. Each tick a
  foe does one of three things: fights what is in its ring; waits if its next tile holds another foe; or
  steps. Arrows always point strictly closer to the Monarch, so a queue never deadlocks: the one at the
  front is fighting.
- Foe behaviours are two, plus a ring per kind: **Walk** (above) and **Flank**, which floods with your pieces
  counted as walls and so walks round your line, falling back to Walk when no such road exists. The Flank
  field is recomputed when a piece of yours rises or falls, never otherwise. Which kinds Flank is learnt by
  meeting them (§7), and the bestiary records it from then on.
- Waves, bosses, crumbling and escalation stay as they are in `src/sim/battle.js` (`broken`, `crumble`,
  `escalation`). Late pair and Siege lose their names: they are waves.

### 2.7 Domain and the risen

- The **domain** is the tiles within `domain` + Dominion of the Monarch (Chebyshev, so a square, as today).
- A foe piece that falls inside the domain rises as a **shadow** piece of yours, if its tier is at most
  `raiseTier` + Will and the Monarch has raises left (`raises` × (1 + Will) a battle). It rises on the free
  tile closest to the Monarch (ties: nearest where it fell, then lane order), never where it fell: the
  enemy's dead never block its roads. It keeps the fallen count at `raiseHp` of body HP, holds its tile for
  the rest of the battle, and is gone when the battle ends. With no free tile it does not rise. Arise's
  casting time and Will's haste stay as they are. (Decided 2026-10-09, replacing "rises where it fell".)
- A shadow on a tile a Banner's line (§2.8) passes through joins it: it follows the Banner's last follower.
  Otherwise shadows never move.
- Recruiting stays as decided earlier: one slain foe a battle, as a full soul into the ossuary.

### 2.8 Growth

- **Essence** from slain foes, as today.
- **Upgrades belong to the kind, not the soul.** Upgrading Grave Ghouls upgrades every Grave Ghoul you own,
  fielded or in the ossuary. Stacking and splitting then carry no bookkeeping, and a wide stack of one kind is
  cheap to upgrade while a varied field earns synergies.
- A kind's panel: **Level** (one button, essence) and **two tracks** of tiers I–IV laid out like Bloons TD 6.
  The first track taken may reach IV; the other stops at II. Tiers that used to summon now add count for the
  battle. Tier effects the new rules make natural: +1 ring, a faster stride, +count, and at tier IV
  **Banner**: the piece leads; pieces placed adjacent to it in prep are its followers, keep their offsets,
  and share its line, so a wing is one arrow. Banner is the old Marshal without the rank system.
- Ranks (Soldier, Knight, Marshal) are gone as a system.
- The Monarch's panel: HP, Dominion, Command, Will. Four buttons.
- Relics and keystones are untouched in this pass; they are rewards, not upgrades. Merging them into one
  kind of item is a later decision.

### 2.9 Synergies

Kin and role counts over your fielded pieces, a stack counting once, with the steps at 2, 4, 6 and 8 as now,
and the 8-step rules. On the board, every piece contributing to an active synergy glows in that synergy's
colour; selecting a piece brightens its partners. Bonds (beside, behind, ahead) are cut.

### 2.10 Timer and ends

One escalation bar is always visible in battle. The battle is won when no foe stands and no wave is left;
lost when the Monarch falls (the run ends) or the bar runs out (the ceiling: a defeat, the run ends). A
boss's fall crumbles its side, as today.

### 2.11 Cut

Falter, Approach, Engaged, Orders, Detachments, Hunt, Stay, Move, Braced, Held, leashes, captains as a rule,
banners as a rule (Banner is now a tier), bonds, summons as separate wandering units, Soldier, Knight,
Marshal, Late pair, Siege, Gauge as a word (attack speed is a number on the card).

Vocabulary after the cut: Piece, Stack, Ring, Line, Signal, Road, Wave, Domain, Shadow, Banner, Essence,
Tier, Synergy, Relic, Keystone. Fifteen, from about forty.

## 3. What the player may rely on

1. **Your pieces never pathfind.** A line is a line. The UI shows it as drawn.
2. **A piece is never further from its line than its ring.** The ring is drawn; a lunge stays inside it.
3. **Foes walk the arrows.** Only a Flank kind and a ring you have not met can surprise you, and the bestiary
   records both after the first meeting. The arrows are drawn before you place anything.

Before Go, the board shows **timing marks** for your side: where each piece stands at 5, 10 and 15 s, computed
by walking the lines against an empty field with friendly pieces as the only blockers. Queues behind friends
and crossings are visible before the horn.

## 4. Interface

The standing interface rules hold: one scaled landscape layout for every device (`src/frame.js`), one view at
a time behind tabs, nothing that needs hover, Shift or a key.

- **Field tab** (the default). The board in the centre. A bench strip under it holds ossuary souls; drag one
  onto an open camp tile to place it, onto a same-kind piece to stack. The panel on the right is the selected
  piece's: its card, ring, count, the kind's Level and two tracks. Nothing selected means the Monarch's panel
  (HP, Dominion, Command, Will); Escape, or tapping empty ground, returns to it.
- **Prep overlays**: the roads (arrows), the domain, the selected piece's ring, its line with its signal
  marker, timing marks, synergy glow. A drag from a piece along tiles draws its line; tapping the marker
  cycles its signal; a drag of the piece itself moves it (and clears the line).
- **Battle**: the same board, with the wave counter, the escalation bar, counts on pieces, and the horde drawn
  as many small sprites per tile while the sim counts one piece. Pause and speed stay (`src/engine.js`).
- **End**: the death panel's facts (`deathPanel` in `src/ui.js`) shown as a replay beat on the board.
- **Tabs**: Field · Map · Codex. The Orders tab and the detachment UI go. The codex's glossary is the fifteen
  words plus statuses.

## 5. Implementation

One branch (`dead-keep-the-plan`), one commit per step, `npm test` green at each (tests check function, not
balance; the strength-dependent scenarios stay out until the balance pass). Steps 2 to 4 are sim only and
can be verified by tests alone; the game is unplayable in the browser between steps 2 and 5, which is
accepted.

### Step 1. This document

Done when `DESIGN.md` is committed.

### Step 2. Sim: roads, rings and lines

`src/sim/battle.js`:

- Out: the movement half of `chooseAction`, and `searchStep`, `stepToward`, `planStep`, `roleStep`, `leash`,
  `falter`, `orphan`, `reinforce`, `call`, `isEngaged`, `frontOf`/`recentre` (Vanguard Crown's centre moves
  to the field's root), `bannerOf`/`spread`/`pool` (One Army is now the stack rule).
- In: `field(battle, { walls, blockers })` the flood with the tie order of §2.6, cached on `battle` and
  rebuilt when the Monarch's tile or (for Flank) your roster changes; `arrowOf`; `ringTarget(battle, u)`;
  `lunge`; `marchStep` (next line tile, wait on a friend); `returnStep`; `foeStep`.
- `act` becomes: ring target → ability; else party: line; foe: arrow.
- Signals: add `blow`; a line's `when` uses the same shape as reserve entries (`{ at, t }`).
- Shadows: `raise` keeps the count and holds; the Banner join rule.

`src/sim/unit.js`: `rangeOf` reads the kind's `ring`; `deployTile` and `CAMP_ROWS` stay; `autoPlace` becomes
a plain fill with no rows by role.

`src/sim/run.js`: `s.lines`; placement of the Monarch in the rear two rows; detachments, held starts,
`waits`, `samePlan` go.

`src/content.js`: every unit gets `ring` (and optionally `stride`); `BEHAVIOURS` shrinks to Walk and Flank;
`FOE_ORDERS`, `ROLE_LIST`'s `move`/`target`/`autoRow` go.

Tests: `test/battle.test.js` movement tests become road tests. New: a foe on tile T steps to `arrowOf(T)`; a
tie resolves by the stated order; a foe queues behind a foe; a piece with ring 2 lunges and returns; a line
waits for each signal; a marcher waits behind a friend; a Flank field routes round a line and falls back
with none; a shadow holds its tile. Detachment, held, braced, engaged and falter tests are deleted.

### Step 3. Sim: stacks

`src/sim/unit.js`: `makeUnit` gets `count`; `statsOf` exposes body HP; `livingBodies(u)`. `src/sim/battle.js`:
damage reads living bodies; `applyDamage` and `fall` work on the pool; Shape hits land once per tile.
`src/sim/run.js`: `stack(uidA, uidB)`, `split(uid, n)`, recruit-into-stack, tiers that add count for the
battle (`summonsOf` becomes `bodiesOf`); foe rooms list pieces with counts and captains become the piece.
`activeSynergies` counts a piece once.

Tests: pool arithmetic; bodies fall one at a time; a Shape hit on a stack; stack and split round-trip; a
synergy counts a stack once; a foe cohort is one piece.

### Step 4. Sim and content: upgrades per kind

`src/sim/run.js`: upgrade state keyed by kind (`s.kinds[id] = { lvl, tracks: [tier, tier] }`), applied to
every soul of the kind; ranks removed from `run.js`, `tuning.js` and `unit.js`; the Monarch's four stats.
`src/content.js`: `PATHS` re-cut into two tracks per kind with the crosspath rule; Banner as a tier IV.
`src/tuning.js`: costs for Level and tiers, nothing per rank.

Tests: `test/ranks.test.js` becomes track tests; `test/keystones.test.js` updated where keystones read ranks
or detachments.

### Step 5. Interface

`src/board.js`: placement in the camp, drag-to-stack, drag-to-draw lines, signal markers, roads, domain,
ring, timing marks, synergy glow, n sprites per tile with a count. `src/ui.js`: the Field tab with the
selected-piece panel and the Monarch as default, the bench strip, three tabs; the Orders tab and detachment
UI deleted; `reapScreen` unchanged but for bodies into stacks. `src/keywords.js` and `src/codex.js` cut to
the fifteen words. `src/engine.js`: horde rendering and the end-screen replay beat.

Done when a full run plays in the browser at 1440×900, 1024×768 and 852×393 with no console errors.

### Step 6. Content pass

Rings and strides per kind; which foes Flank; the twelve camps reviewed as road layouts; the bestiary's
recording of behaviours; cut unused signals. Decide the board width here, from play (§6).

### Step 7. Play, then balance

Play the whole run. Then the single balance pass, at the end, with the win-rate scenarios restored.

## 6. Decisions taken, and open

Taken (each can be reversed before step 2 starts; after it, it costs a rewrite of that part):

- Foes fight through your pieces; only Flank routes round them.
- A lunge returns to the tile it left and never continues the line from where it lunged.
- Rings are measured through walls for shots; a lunge needs an open tile.
- A marcher blocked by a friend waits behind it.
- Standing orders persist between battles; moving a piece clears its line.
- A stack counts once toward synergies; stack damage scales with living bodies.
- Upgrades are per kind.
- Shadows rise on the free tile closest to the Monarch at the fallen count and hold, unless a Banner's line
  passes them. The enemy's dead never block its roads.
- Foe behaviour is Walk or Flank plus a ring; nothing else.
- Relics, keystones and the board size are left alone in this pass.

Open, decided later:

- **Board width.** With `domain` 3 on a board 7 wide the domain already spans the camp, so "inside or outside
  the circle" is barely a choice. Likely answer: 11 wide with a base domain of 2, and rooms that grow by
  floor. Three constants plus the camp maps; decide in step 6 after play.
- **Shadow count.** Rising at the full fallen count may be too strong; balance pass.
- **Horns.** Two or three live signals the commander can sound in battle (charge, hold, raise now), each just
  a signal a line can wait on. Deterministic given when it is pressed, but a step toward RTS. Try the pure
  plan first.
- **Per-piece targeting** (first, last, strong) as a tier or a toggle, if one rule proves too blunt.
- **The war table.** If drawn lines prove too fiddly on a phone, the fallback is sectors (left, centre,
  right, reserve) with one order each and the tile board as a rendering. Only if needed.

## 7. Standing rules

Decided before this document and still in force (the project memory has the reasons):

- Enemy behaviour is discovered, never previewed: the roads are terrain and are shown; which kinds Flank and
  what ring a kind has are learnt by meeting it, then recorded.
- Defeat is absolute. No lives, no retreat.
- Floor 1 is hard, and the skill gap opens in prep, never in dice.
- Balance comes once, at the end. No tuning while building.
- Tests are functional only until the balance pass.
- One universal landscape interface, modular tabs, nothing that needs hover or a key.
- Recruit only: one slain foe a battle, as a full soul into the ossuary.
