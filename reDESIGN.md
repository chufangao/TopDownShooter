# RETINUE design: the Monarch and the army

Status: built on 2026-10-07, all eight slices of the build order. README.md describes the game as it is.
Where the build differs from this proposal: the "below half strength" start is "a body of yours falls";
the tick ceiling counts from the last foe to enter; the Monarch takes no synergy, relic or keystone stats,
only its points'; floor-1 elites are 2 foes plus the late pair; waves come only from floor 3 (elites, fights
from rank 8, sieges); essence is tallied wave by wave but paid with the win; a Marshal's second ability slot
is the second path's tiers I–III; the Legion's shadows rise only while fewer than 10 of your bodies stand; the eights'
rules hold for the foes only from the second deep floor; faltering is a flat ×0.7 for everyone; the deep
grows the enemy with both more waves and bigger cohorts; banner shapes include a mouth; the board size is
not data-driven. The mechanic-necessity tuning then changed more: the board holds 10 bodies, not 14, and a
body with no room sits the battle out, so only Arise's shadows and held detachments (10 places of their
own) stand past it; the Monarch holds a banner more each floor down; a Knight and a Marshal lead 3 and 6
bodies beyond Command and deal ×1.2 and ×1.4 (taking ÷ as much); a Stay post braces and a held start enters
fresh; a retinue holds at most 6 relics. The final balance ladders, the necessity sweep, and the targets met
and missed are under "How to measure it".

## The goal

A run should end with the player feeling invincible, and every run should get there differently. The
model is Sung Jin-Woo in *Solo Leveling*: one person whose growth multiplies an army made of everything
he has killed. But the feeling we want is not only *hero*, it is *commander*: by floor 4 you are no
longer arranging six souls, you are ordering banners into a line, holding a reserve, and watching the
dead rise to fill the gaps. The run scales from a squad to an army, and the player's decisions scale
with it.

The Monarch is the centre of both fantasies. It is you. It stands on the board, everything you command
flows from where it stands, and **if it falls, the run ends.**

## Why builds feel samey today

- **Everything is capped.** Level 10, 3 path tiers, 6 souls fielded, 12 held, 1 recruit per battle.
- **Every bonus is a small percentage on a stat.** Synergies, relics and path tiers are mostly +8% to
  +25%. They stack into one slightly bigger number and never into a new rule.
- **Nothing triggers.** There are no on-kill, on-death or on-hit effects, so nothing snowballs inside a
  battle, and two choices never combine into something neither does alone.
- **There is no centre.** Power is spread over six interchangeable souls, so no single choice reads as
  *your build*.
- **Placement barely matters.** In the last decisions report (40 runs, expert, before essence and
  paths), souls dropped in random cells still won 97.9% of battles; the formation changed the result
  in 6.8% of them.
- **Nothing changes what the player does.** Prep is one drag per soul, and would stay so at 20 souls.
  Growth adds pieces, never a new kind of decision.
- **The enemy is a squad.** Foes come 3 to 6 at a time in a 3×7 formation, and the boss fights alone.
  An army that only ever meets squads feels like a bully.

## Where the game sits today

As built, 2026-10-07: two 16-seed ladders on the final build (`npm run ladder -- --runs 16`, seeds `sim` and
`sim2`; each cell reads `sim / sim2`). A third, on seed `gate`, and the targets met and missed are under
"How to measure it".

| Measure | Basic | Expert |
|---|---|---|
| Clear rate | 0% / 0% | 87.5% / 62.5% |
| Died on floor 1 / 2 / 3 / 4 | 69% / 25% / 6% / 0 and 81% / 13% / 6% / 0 | 6% / 0 / 0 / 6% and 0 / 6% / 25% / 6% |
| Battles won | 90.5% / 87.2% | 99.7% / 99.2% |
| Recruits per run | 2.6 / 2.1 | 20.8 / 21.1 |
| Monarch points per run | 0.3 / 0.3 | 14.7 / 13.0 |
| Bodies bound per run | 9.5 / 6.8 | 104.4 / 97.8 |
| Army that acted at least once a battle | 92% / 94% | 90% / 92% |
| Battles from floor 3 where a reserve entered | 0% / 25% | 6% / 7% |
| Monarch deaths / defeats | 15 of 16 / 16 of 16 | 1 of 2 / 5 of 6 |
| Top cause of Monarch deaths | reach 67% / reach 81% | drain 1 of 1 / flank 60% |
| Median battle ticks, floors 1 / 2 / 3 / 4 | 490 / 337 / 436 / – and 529 / 457 / 1023 / – | 380 / 316 / 291 / 161 and 375 / 300 / 295 / 193 |

Before the redesign, a 16-seed ladder on this branch, 2026-10-06:

| Measure | Basic | Expert |
|---|---|---|
| Clear rate | 12.5% | 93.8% |
| Died on floor 1 / 2 / 3 / 4 | 19% / 19% / 38% / 13% | 6% / 0 / 0 / 0 |
| Recruits per run | 5.9 | 21.4 |

Expert already meets its target below. The gap is basic. The expert's 21 recruits on a 12-soul roster
also say it already treats souls as fungible bodies, which is army logic the interface does not support.

Battle cost by army size, 20 battles each, level 6 both sides, idle cores:

| Army | Per battle | Per tick |
|---|---|---|
| 6 vs 5 | 9 ms | 10 µs |
| 12 vs 12 | 30 ms | 26 µs |
| 20 vs 21 | 69 ms | 70 µs |
| 40 vs 21 | 109 ms | 189 µs |

Per-tick cost grows with the square of the unit count. The expert rehearses hundreds of battles a run,
so at 40 units a run goes from about 10 s to well over a minute, and `npm test` with it.

## Pillars

Kept:

- Battles take no input. What you decide before Begin is your whole say.
- Defeat ends the run.
- Enemy behaviour is discovered by playing, never previewed.

New:

- **The Monarch is you.** It stands on the board, and if it falls the run ends. Nothing revives it.
- **The level of decision rises with the army.** Early you place souls; later you place banners and
  give them orders. Prep never becomes twenty drags.
- **Orders, not stats.** The memorable choices change what happens, not how big a number is. Orders are
  plans drawn in prep; the battle still takes no input.
- **Depth in time.** Battles are flows with reserves and waves, not standoffs. Committing the reserve
  is a decision.
- **Snowball inside a battle.** A strong army visibly grows while it fights.
- **Invincibility is earned.** The danger is in assembling the engine. Once it runs, the late floors
  should fall.
- **The game is hard from the first room.** A player who plays by rules of thumb should die on floor
  1. The danger is never in the dice: everything that kills on floor 1 can be seen and answered before
  Begin, so the same floor is a wall to one player and a formality to another.

## Systems

### 1. The Monarch

The necromancer is a unit on the board from the first battle. It cannot attack. It has one cast,
Arise, and three stats bought directly with essence; its level is the points spent, and its HP grows
with it.

| Stat | Rule it changes |
|---|---|
| Dominion | Its **domain**: a radius of 3 + Dominion tiles. Souls inside fight at full strength and obey their orders. Souls outside **falter**: 30% less damage dealt, and the only order they heed is Hunt. Marshals (see *Ranks*) project a domain of their own. |
| Command | Banners: 3 + Command. Rank-and-file per banner: Command. The board holds at most 14 bodies, two ranks; the rest of the army stands in reserve. So the army is 3 souls at the start, 24 at Command 3 with 10 in reserve, and 48 at Command 5 with 34 in reserve. |
| Will | Arise raises corpses of tier up to 1 + Will, at most 1 + Will a battle. Between battles, Will also sets how many of the slain bind for free (see *Extraction*). |

**Where it stands matters.** At the start the domain is 3 tiles: from the middle of the camp it covers
all of it, from the back row only the rear four rows. So the safest place has the shortest reach, and
an army that pushes onto the foes' ground leaves the domain unless Dominion or a Marshal goes with it.
The Monarch is placed in prep like any soul, can never be benched or released, and takes no order: it
stands where you put it for the whole battle. Reserves enter beside it, so a Monarch at a flank
reinforces that flank. Because the camp is fixed for the floor, where the Monarch stands is one decision
per floor, and the most important one.

**What it does in battle.** Arise: a cast of about 200 gauge (every 4 s or so) on a corpse inside the
domain; the corpse rises as a **shadow** on your side at half HP, with its own kit at its level, and
leaves when the battle ends. Shadows always falter: 30% less damage, and Hunt is the only order they
heed. They are a horde, never an elite. The Monarch alone with corpses around it can still win a fight,
which is the moment the whole fantasy is built on. With no corpse in reach it banks gauge.

**The loss rule.** The battle is lost the instant the Monarch falls, and a lost battle ends the run. It
is won when the last foe falls. There is no other end: an army wiped to the last soul fights on while the
Monarch stands and has something to raise. The tick ceiling settles a stalemate as a defeat.

**What hunts it.** Not only flankers. Ranged foes pick off a Monarch within their reach, and
Skirmishers and Rangers choose the weakest target, so a wounded Monarch draws fire. Row and blast attacks
hit it beside or behind its screen. Drains slow its Arise. Healers drag a fight into escalation, where
the Monarch's HP is the smallest on the board. The full list is in *Threats and answers*. Which roles do
what stays hinted in their flavour text, as with every enemy behaviour today. Protecting it is a
formation problem, never a stat purchase: there is no Might.

**Its wounds carry.** The Monarch heals like a soul: half its HP back after a win, all of it at an
altar. A Monarch that enters a room at 40% is the weakest target on the board, so the route to the altar
and the threat reading on the map are part of keeping it alive.

### 2. The army: banners, cohorts and rank-and-file

The field is counted in **banners**, not souls. A banner is a **captain**, a named soul with a level,
a path and a rank, plus a **cohort** of rank-and-file of one kin or role. A banner is placed as one
piece with a shape (pair, line, wedge, block), so prep at 30 souls is still six drags. The captain's
aura, bonds and synergies count its cohort: a Grave Ghoul with four ghouls behind it is Undead 5 in one
drop.

**Rank-and-file are counts, not cards.** The ossuary holds, per kind of soul, how many stand and how
many have fallen. They have no paths. They all fight at one **muster level**, bought once for the whole
army with essence, so levelling thirty bodies is one purchase. The fallen stay fallen until an altar
raises them, as souls do today, so attrition is real and cheap bodies are still a resource.

**A cohort moves with its captain.** Rank-and-file keep within a tile of their captain and strike what
comes in reach. If the captain falls, the cohort falters until the battle ends. Killing captains wins
battles, on both sides.

**Ranks that break caps.** Feed a captain rank-and-file of its kin to promote it: Soldier → Knight (4
bodies) → Marshal (8 more). Each rank removes a limit instead of adding a percentage:

- Knight: tier IV on its path, or tier I of a second path.
- Marshal: projects a domain of 2 tiles in which its banner heeds every order, so a wing can fight
  beyond the Monarch's reach; a second ability slot; shadows that rise within its reach join its banner.

### 3. Orders: plans the Monarch draws

The Monarch gives orders to **detachments**: any souls or banners the player highlights together in
prep. A soul is in one detachment, and the rest follow the default. Each detachment has a **plan**,
drawn on the camp as a marked square, so the player sees the whole battle plan before Begin. A plan has
three parts:

| Part | Choices |
|---|---|
| Where | **Stay**: hold the ground it stands on. **Move**: a square. Every unit in the detachment paths to it by the cheapest open way; one stands on it and the rest cluster round it, and a unit that is on the square or next to it has arrived and goes to Hunt. **Hunt**: toward the nearest foe, wherever that leads (today's behaviour, and the default). |
| When | At once; at a time; or on a trigger: a detachment below half strength, the Monarch struck, a wave appearing. A detachment whose plan starts later waits in the dark behind the camp and enters beside the Monarch when it fires. That is the reserve. |
| Reaction | Not a choice: the same for everyone. A unit that can hit a foe stops and hits it. A melee unit steps to engage a foe within 2 tiles of it. A ranged unit halts while anything is in its range and never steps next to a foe. A Trickster passes through bodies on any plan. When nothing is in reach the plan resumes. |

So a screen is a detachment on Stay on the Monarch's approach tiles; a reserve is a plan with a later
start; a flanking party is Tricksters sent to a square on a wing, from which they Hunt the deepest foe,
their quarry by role. A line is a square at the domain's edge for the front and Stay once it is there,
or simply souls placed there on Stay. The defaults are Hunt, at once, so an army with no orders plays
exactly as the game plays now. A cohort's members path to the square like anyone else.

**The plan is drawn.** In prep each detachment has a colour. Its square is marked in that colour, an
arrow runs to it from the detachment, and the start condition is a tag on the square. A square outside
the domain is drawn faded: the detachment would falter on the way. In battle the same marks lie faint
under the units, the arrow shortens as they close on the square, and a unit that has stopped to fight
shows a mark until it resumes. The enemy's plans are never drawn. Its captains have them too, hinted in
flavour text and learnt by fighting.

Outside the domain, only Hunt is heeded: a soul that steps out loses its plan and goes for the nearest
foe. That is what Dominion, or a Marshal, buys: an army that keeps to a plan further from the throne.

### 4. Reserves and waves: the battle as a flow

A battle is no longer everyone standing at once. Detachments whose plans start later enter from the
rear when they fire; enemy waves enter from the top edge on a timer or when their front breaks. The board stays 7
lanes wide, and that stops being a limit: about 14 units hold the line at any moment, so a 40-unit
battle stays legible, the 3×7 foe formation stops capping the enemy, and the fight has acts. The
escalation clock counts from the last entry, so a wave never arrives into ramped damage.

**Siege rooms** are one battle of three waves with no prep between them, paying essence per wave. They
appear from floor 3. Floor 4's final room is a siege whose last wave is the Hollow Sovereign and its
court.

### 5. Extraction and the economy

After a win the slain linger, as today, but the reap changes:

- **Bind the fallen.** Every kind slain offers its bodies as rank-and-file. Up to 1 + Will of them bind
  free; more cost `3 × tier` each. Bodies go to the ossuary count, standing.
- **Bind a captain.** One slain foe per kind may rise as a named soul at the level it fought at, for
  today's recruit price. This is how new captains enter the army.
- Elites still offer a relic, and from floor 2 a **keystone** (see below).

Sinks and sources have to be retuned together. Sources scale with the army (more foes slain pays more).
The sinks, roughly in the order a run meets them:

| Sink | Price |
|---|---|
| Captain level | `6 × level^1.2`, cap 10, as today |
| Captain path tier | 30 / 60 / 100, as today; tier IV for Knights at 150 |
| Monarch stat point | `20 + 10 × points spent`, uncapped |
| Muster level | `9 × level^1.2`, cap 10 |
| Bodies past the free ones | `3 × tier` each |
| Promotion | bodies, not essence |

### 6. Keystones and trigger relics

Two or three per run, offered at elites and rites. Each one rewrites a rule, and each is small enough
that a build is the combination, not the pick. The Monarch is never exempt from the loss rule: nothing
revives it, ever.

| Keystone | Rule |
|---|---|
| Legion | Two more banners, but every soul has 25% less HP. |
| Undying | Fallen captains rise once per battle at 20% HP. |
| One Army | Each banner shares one HP pool between its captain and cohort. |
| Mimicry | Vanguards count as Wardens for synergies and bonds. |
| Vanguard Crown | The domain is centred on your front-most captain, not the Monarch, and is 1 tile smaller. |
| Hollow Court | Shadows raised by Arise stay after the battle as rank-and-file. |
| Blood Tithe | Arise's cap is doubled, but each shadow costs the Monarch 5% of its HP. |
| Court of Bone | The domain is 2 tiles larger, but the Monarch cannot be healed. |

Vanguard Crown is the one moving domain, so watch it in the build-spread measure: if it is in most
wins, the fixed Monarch is too limiting and Dominion is priced wrong.

Most relics should become triggers or rule changes too: "on kill: …", "when a soul falls: …", "when a
reserve enters: …", "when the Monarch is struck: …". Keep a few flat stat relics as filler.

### 7. Synergies with big breakpoints

Use 2/4/6/8 breakpoints instead of 2/4, with the top step absurd, e.g. *Undead 8: every foe slain
rises.* Cohorts are what make 6 and 8 reachable: a kin is five units deep today, construct and drake
only two, so without cheap bodies the deep steps would be fiction.

### 8. The enemy as an army

A commander needs an opposing army. By floor, the enemy grows the way the player does:

| Floor | The enemy |
|---|---|
| 1 | Squads of 3 to 5, as today. |
| 2 | Captains with cohorts. An elite's captain carries a hinted order. |
| 3 | Waves: a second formation enters when the first breaks. Siege rooms appear. |
| 4 | Sieges. The Hollow Sovereign commands the floor's dead rather than fighting alone, and its Grave Tide raises corpses on its side. Kill the Sovereign and its court crumbles: the battle ends, and the court pays essence as if slain. |

Enemy orders are hinted in flavour text and never previewed. The player learns what a raised banner
or a captain at the rear means by fighting it.

### 9. Threats and answers

If flanking were the only thing that threatened the Monarch, the game would have one answer, a screen,
and floor 1 would be a checklist. The enemy has to bring several distinct threats, each with a
different answer, and the answers have to pull against each other. Floor 1's own pool already carries
five of these with today's content.

| Threat | What it punishes | Floor-1 carrier | Grows into | The answer |
|---|---|---|---|---|
| Flank | A Monarch with an open tile beside it and nothing behind it. Flankers walk through bodies, so a line never stops one | Clockwork Page (Trickster) | Mantis Reaper on floor 2; enemy Tricksters on a wing | A screen on the approach tiles; a decoy on the back row, since a flanker hunts the deepest unit; the camp's walls, which flankers do not pass |
| Reach | A Monarch that is the nearest thing to the shooters once the line breaks or walks off, and a wounded one most of all: Skirmishers and Rangers pick the weakest | Frost Sprite (range 3), Will-o-Wisp and Bone Chanter (range 4) | Ember Drake; Frost Wyrm; Searing Bolt at range 5 | A Stay line that stands between; Dominion, which lets the line stand further ahead and the Monarch further back; Tricksters on Hunt, which go for the shooters |
| Shape | A Monarch in the same row as its screen: Cleave hits everyone level with its target. Later, packed cohorts and a Monarch in the lane behind its screen | Tomb Knight (Cleave, a row) | Ember Drake's blast and Iron Golem's Quake on floor 2; Glacial Breath's column on floor 3; Grave Tide | The Monarch diagonal to its screen; spread shapes against blasts; an empty lane ahead of it against columns |
| Drain and rot | A Monarch that needs gauge for Arise; a screen captain under Brittle, which strips a quarter of its DEF per stack | Frost Sprite (Frost Lance drains 20 gauge), Grave Ghoul and Bone Chanter (Brittle) | Quake and Hoarfrost, blasts that drain; Plague Bite; Grave Tide | A cleanser in the screen (Clockwork Page or Hive Warden captains carry Purge); two screen bodies so the rot is spread; a Stay line at the domain's edge that keeps range-3 drainers off the Monarch |
| The clock | A slow fight. Healers and Dirge-hastened squads outlast a low-damage line, and after 45 s escalation ramps every blow toward ×8. The Monarch, with the smallest HP on the board, dies first | Hive Warden (Mend), Bone Chanter (Dirge) | Thorn Dryad; Swarm Mend cohorts; the Sovereign's phases | Damage over defence; Tricksters sent for the Chanter whose Dirge stretches the fight; shadows from the kill zone to swing the race |
| Depth | A line that advanced out of the domain when more foes arrive behind it, and an enemy cohort that fights on until its captain dies | Floor-1 elites only: a late pair that enters at 20 s | Captains and cohorts on floor 2; waves on floor 3; sieges | Stay; a detachment that starts when the wave appears; Tricksters for the captain |
| Attrition | A Monarch that enters a room already wounded and is the weakest target in it | Every floor | | Routing by threat on the map; the altar; a Mend captain |

Two more threats are the player's own doing, and the Monarch systems create them: a **faltering front**
from a Monarch parked at the back, and **no kill zone** from default orders that push the line out of
the domain so Arise has nothing to raise.

**The answers conflict, and that is the skill.** A screen packed beside the Monarch is what
Cleave and blasts punish. The mid-camp spot that covers the front is inside Reach. The Stay line that
makes a kill zone gives the healer time. Two screen bodies against rot are two bodies not on the line.
No room is answered by one order, and a player chooses which threats to answer and which to accept.

**The scouted roles say which threats a room poses.** A Trickster is Flank, Skirmishers and Channelers
are Reach, a Tomb Knight is Shape, a Warden is the clock. That much is on the map today, in the
formation preview. What each does about your formation stays hinted.

**The generator guarantees variety.** From floor 1's third rank, every fight carries at least two threat
types and every elite three, and across a floor's ranks every type appears on every route. Each kind of
unit is tagged with the threats it carries, and the encounter draw rejects a room that has only one.

#### How the movement rules shape each threat

Nothing in a battle stands still, so a threat is not a unit, it is where that unit will be and when.
The answers work by shaping movement the player cannot touch once Begin is pressed. The rules that do
the shaping, all in `src/sim/battle.js` and `src/sim/unit.js` today:

- **Everyone walks at one pace.** A step every 0.8 s for every unit, off the gauge. Speed decides
  how often a unit strikes, never how fast it moves, so a line that advances keeps its shape and an
  arrival time is a distance. The foes' front row is 2 tiles from your front row, 5 from mid-camp
  and 8 from your back row: a flanker reaches a back-row Monarch in about 6 s, 8 s or more through
  walls, whatever it is.
- **Engagement pins.** A unit with a foe next to it stops walking, except a flanker. A Stay line pins
  whatever walks into it, and what pins is pinned: a healer that walks in with its squad is held at
  your line until one side dies.
- **Shooters stand off.** A ranged unit walks only until something is in its range, and never steps
  next to a foe while it can shoot. Your front line decides where every enemy shooter stands.
- **Flankers hunt the deepest and walk through bodies.** A flanker's quarry is the unit furthest
  back on your side, kept until it dies, with ties to the most wounded. It passes through units,
  yours and theirs, never walls, needs an open tile to stand on, and is never pinned.
- **Bodies block everyone else; corpses block no one.** Two living units never share a tile, and no
  one but a flanker passes through one. A corpse's tile is open the moment it falls.
- **Walls block walking, not bolts**, and no one squeezes diagonally past a wall's corner. A cell's
  open neighbours are its approach tiles, and the camps are hand-made, so this is readable in prep.
- **Targets in reach.** Vanguards, Wardens and Channelers strike the nearest; Skirmishers, Rangers and
  Tricksters the most wounded; blasts land where most stand packed; heals go to the lowest ally from
  anywhere on the board.
- **The domain is a leash with no pull-back.** A soul that steps outside falters and heeds only
  Hunt, so it keeps walking away. A Stay line at the domain's edge is the furthest a line can stand
  and still be a line; a Move square past the edge is a one-way trip.

What that does to each threat:

**Flank.** The Page's quarry is fixed at the first step: the back row, or the Monarch if nothing
stands behind it. It walks through your line as if it were not there, so a line is never the answer.
Three things are. A **screen**, bodies on Stay around the Monarch, holds its approach tiles, so there is
no open tile for the Page to stand on next to it until a body dies; it stands next to a body instead, which strikes it, and it
hits the most wounded thing in reach, a rule a player can learn and use. A **decoy**: a Tomb Knight on
the back row behind a mid-camp Monarch is the quarry instead, and it is built to take it; this costs
no order. And the **camp's walls**, which flankers do not pass: a Monarch in a wall pocket has fewer
approach tiles to fill. Every extra step of the walk is 0.8 s under your Skirmishers' fire, who shoot
the most wounded, which a tier-1 Page soon is.

**Reach.** While your line stands, every enemy shooter stands off at its range from the line, and a
Monarch three rows behind the line is seven tiles from a range-4 Wisp. Reach is a second-act threat:
when the line breaks, the shooters walk on, cover three tiles in under 3 s, and shoot the most
wounded thing they can see. So the answers are a line that does not break (the clock), Dominion so
the line can stand further ahead with the Monarch further back, and a Trickster on Hunt, which goes for the
deepest enemy, which is where the shooters stand. A Monarch that enters a room wounded is the thing a
shooter picks the moment it is in reach, which is what *attrition* means in movement terms.

**Shape.** Cleave hits everyone level with its target, and the Tomb Knight that casts it is pinned at
the row it reaches, which your Stay line fixes. So a Cleave lands on the line's row, never the Monarch's,
unless the Monarch's screen stands in the Monarch's row and the Knight reaches the screen. The answers
are rows: stagger the line across two rows so a Cleave gets half of it; put the screen's bodies a row
ahead of the Monarch, not beside it; keep the lane ahead of the Monarch empty once columns arrive on
floor 3. Blasts on floor 2 need no walk: they are aimed from range 4 at wherever your units stand
thickest, and a screen packed round the Monarch is the thickest spot on the board, so against a Drake
the screen loosens to the diagonals or the Monarch stands alone behind a wall.

**Drain and rot.** The Frost Sprite stands off at 3 and shoots the most wounded thing in reach every
1.6 s, each bolt taking 20 gauge: three bolts on the Monarch are 60 of the 200 Arise needs, a horde a
third late. Ghouls walk in, are pinned at the line, and stack Brittle on the body they are pinned to; three bites and that body has lost 58% of its DEF. The answers are width and standoff: a
wider Stay line so each Ghoul is pinned on a different body and no one takes three stacks; a line far
enough ahead that the Sprite's standoff spot is out of its range to the Monarch; and a Purge carrier in
the screen, whose cleanse fires on its own while an ally is under 90%.

**The clock.** Dirge hastens the squad's blows in the first 7.5 s, so its first strikes come a quarter
faster than a Stay line's. Mend reaches the whole board and fires while an
ally is under half, so the Ghoul pinned at your line stays up while it rots your body. The Warden that
casts it is pinned there too, which is where it dies to focused damage, or does not, and the fight
passes 45 s, and escalation multiplies every blow, and a Wisp's bolt at ×8 ends the Monarch. The answers
are damage over defence on the line; a Trickster on Hunt, which leaves in the first second for the deepest
enemy, the Chanter whose Dirge and Brittle bolts are stretching the fight; and Stay at the domain's
edge, so the pinned Ghouls die inside it and Arise's shadows join the race in time to swing it.

**Depth.** A late pair enters at the top edge at 20 s. By then a Hunt line has walked onto the
foes' ground, outside the domain, faltering and pinned, and the pair walks eight tiles to a Monarch with
nothing beside it in about 6 s. A Stay line never left. A detachment that starts when the wave appears enters beside the
Monarch as the pair appears. Enemy cohorts on floor 2 move with their captain as yours do, so a captain
pinned at your line pins its cohort round it, and a captain that dies turns its cohort into faltering
Hunt units that walk into the kill zone.

**The kill zone, in movement terms.** Corpses lie where units die. Melee foes die pinned at your line;
shooters die where they stood off, three or four tiles beyond it, or deep in their formation where a
Trickster caught them. So Arise reaches the line's row and little else, and only if that row is
inside the domain: Monarch-to-line within the radius. A horde is a melee horde, and the line's distance
from the Monarch is the single number that decides whether Will was worth buying.

**What prep shows.** Everything on the player's side, exactly: the domain's outline on the camp,
every detachment's square and the way to it, the Monarch's approach tiles, the distance from the
Monarch to its line and from the line to the foes' front, each foe's role and reach. Nothing on the enemy's side beyond that: no paths, no quarries, no
standoff spots. Those are learnt by watching a battle, and the second Page a player meets is the one
they are ready for.

### 10. Lines and gaps

Bodies block and corpses do not, so a line is a wall and the gap is the unit of play. The two rules
above, one pace for everyone and flankers through bodies, keep that simple, and the existing content
already fills the four jobs it needs:

- **Holders** form the line: Tomb Knight, Iron Golem, Hive Warden behind them. A room of holders across
  all seven lanes is a wall, and the answer is what reaches over or through it: shooters and flankers.
- **Breakers** open it: a row (Cleave), a cluster (Quake, Ember Burst), a lane (Glacial Breath), or
  rot and drain that make a body fall. Where the body falls is the breach.
- **Exploiters** go through regardless: flankers. They are why the Monarch needs its approach tiles
  held even behind a full line.
- **Reachers** shoot over it. A line that stands still under Wisps is being shot for free, which is
  the counter to turtling and costs nothing new.

What the player does with it:

- **Deliberate gaps are traps.** A six-body line with one lane open funnels every melee foe into a
  queue in that lane, where a row or lane attack hits all of them. Banner shapes include a mouth for
  this.
- **Corpses are breaches and shadows are sandbags.** A kill zone fills with corpses, the line thins
  where it died, and what was queued behind the pinned front flows through. Arise turns a corpse back
  into a block, so Will is defence as much as damage.
- **The reserve plugs the breach.** A detachment whose plan starts when a line body falls enters
  beside the Monarch on Hunt and goes for the nearest foe, which is the one coming through. The trigger
  is a choice between plugging early and keeping the reserve for the wave.
- **Melee behind melee does nothing.** The front is on Stay, the second rank is ranged and shoots over
  it, the Tricksters are sent to a square on a wing, and a detachment waits behind for its trigger. The editor says so
  when a melee banner stands behind another.
- **The board is the front; the army is the reserve.** Fourteen bodies on the board, two ranks, and
  Command buys banners and reserve depth. A 48-soul army is a 14-body front with 34 behind it, which is
  how a phalanx works and how a siege stays legible.
- **Gauge is capped** at a unit's costliest action, so a unit that was blocked or walking arrives with
  one fresh action, not a banked flurry. Otherwise killing the enemy front would release the rank
  behind it all at once.

Allies stay solid too. Letting allies pass through each other would un-jam the army, but it would also
let a passing cohort shuffle a screen body off its post, and the jam is legible: you can see it in prep.

## The board

Keep 7 lanes. The former plan, letting Command open camp rows, adds depth, not frontage: melee queues
behind the front and ranged abilities reach 3 to 5 tiles, so souls in the rear rows would never fire.
Reserves make depth meaningful instead, and the domain is the spatial progression. The hand-made camps
stay as they are.

Continuous space is not worth it. Pathing, engagement, blasts, bonds, walls, the placement search, the
lane layout and the movement tests all assume tiles, and tiles are a strength at scale: a tile index
makes 60 units cheap. Smoother motion is the renderer's job, and it already tweens walks.

Later, once sieges want it: board size as per-battle data (9 to 11 lanes for siege and boss rooms).
That needs `COLS`, `ROWS`, `CAMP_ROWS`, `LANES` and `CAMP_SLOTS` turned into values of the setup, and a
UI that scales.

## Challenge and pacing

Good players end up invincible, so the difficulty lives in getting there, and it starts in the first
room. Floor 1 is not a tutorial. A player who fields the strongest souls, leaves the orders on their
defaults and parks the Monarch at the back should die there, and the ladder's basic autoplayer is that
player. Today it clears floor 1 four runs in five; the target is that it rarely does.

What kills that player on floor 1 is not one thing. Floor 1's own pool carries five of the threats in
*Threats and answers*: Clockwork Pages flank, Frost Sprites and Wisps reach, Tomb Knights cleave the
row, Ghouls and Chanters rot the screen, and Hive Wardens drag the fight into escalation. The Monarch's
HP is set so that any one of them, unanswered, kills it before a squad of three kills the carrier. Two
more are the player's own doing:

- **A faltering front.** A Monarch on the back row covers four rows. Souls on the front row falter at
  30% less damage and lose the damage race to foes of the same level. The answer is the Monarch in the
  middle of the camp, which is also where it is easiest to reach.
- **No kill zone.** Default orders push the line out of the domain, so corpses fall where Arise cannot
  reach them and Will does nothing. The answer is Stay at the domain's edge, which turns every floor-1
  fight into a horde by its second half.

Every one of these is visible and answerable before Begin, and the answers pull against each other:
the screen that stops the Page is what the Tomb Knight's Cleave hits, the mid-camp spot that stops
faltering is inside the Wisp's reach, and the Stay line that makes a kill zone gives the Warden time.
Floor 1 is hard because each room asks which threats to answer and which to accept, not because any one
of them is unbeatable. Which foe does what is learnt by losing to it once.

Because the defaults lose, floor 1 runs end fast and often, so the floor has to be short to die on and
the defeat screen has to say what killed the Monarch and from where. That is how the game teaches:
by a death that was readable in prep.

- **Floors 2 and 3 are the cohort economy.** Bodies, muster, captains and promotions compete for
  essence; the enemy gains captains and waves.
- **Floor 4 is the siege.** Reserves and orders decide it. A finished build should outgrow the foes by
  now, and the siege is where that shows.
- **Endless floors for people who broke it.** Past the Sovereign the floors keep coming, each deeper
  than the last. Invincibility is the reward, and the next floor is the challenge.

## How to measure it

The ladder (`npm run ladder`) stays the main tool, with these targets:

| Measure | Target |
|---|---|
| Clear rate, basic | Under 5% (12.5% before the redesign; 0% now) |
| Basic runs that die on floor 1 | 70%+ (19% before; 73% now) |
| Clear rate, expert | 90%+ (93.8% before; 79% now) |
| Expert runs that die on floor 1 | Under 5%, or floor 1 is luck, not skill |
| Share of the army that acted at least once per battle | 70%+, or the extra bodies are parking |
| Share of battles where a reserve entered | 30%+ from floor 3 |
| Monarch deaths as a share of defeats | Most of them on floor 1; 30–60% over a run |
| Cause of Monarch deaths, by threat type | No single type above 40% of them, or the floor has one answer |
| Time souls spend faltering outside the domain | Falls as Dominion and Marshals are bought; a diagnostic, not a target |
| Build spread (keystones, paths and kins in the expert's wins) | No single build in more than ~25% of wins |
| Battle length by floor | Falls for strong builds late in a run: invincibility shows as fast fights |

Battle length and HP lost measure the snowball better than a power ratio taken at battle start, which
cannot see Arise.

### Results of the balance pass

Three 16-run ladders (`npm run ladder -- --runs 16 --seed <seed>`) on the final config, the same seeds at
both levels:

| Seed | Level | Clear | Died on floor 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|---|
| `sim` | basic | 0.0% | 68.8% | 25.0% | 6.3% | 0.0% |
| `sim` | expert | 87.5% | 6.3% | 0.0% | 0.0% | 6.3% |
| `sim2` | basic | 0.0% | 81.3% | 12.5% | 6.3% | 0.0% |
| `sim2` | expert | 62.5% | 0.0% | 6.3% | 25.0% | 6.3% |
| `gate` | basic | 0.0% | 68.8% | 31.3% | 0.0% | 0.0% |
| `gate` | expert | 87.5% | 0.0% | 0.0% | 6.3% | 6.3% |

Met:
- Clear rate, basic: 0 of 48.
- Basic runs that die on floor 1: 35 of 48 (73%).
- Expert runs that die on floor 1: 1 of 48 (2%).
- Army share that acted: 90–94%.
- Battle length falls late: the expert's median ticks run 380 / 316 / 291 / 161 on floors 1–4 (`sim`).
- Build spread: the commonest keystones-and-kin build is in 7–10% of wins.

Missed:
- **Clear rate, expert: 38 of 48 (79%).** The army wins over 99% of its battles. The runs end when a flank brood
  or a shape blast reaches the Monarch in a battle otherwise won, or when a ranged foe out-ranges a Stay line
  to the tick ceiling.
- **Reserve entered from floor 3: 6–7% of battles.** The expert's bodies almost never fall (0.03–0.11 a
  battle), so nothing calls the reserve. More foe bulk moved it only to 10% and cost clears: it needs a
  structural change, not a number.
- **Threat spread.** The expert's few deaths are mostly flank (3 of 6 on `sim2`), too few to tune on. Basic's
  are mostly reach, once its souls are gone.
- **Monarch deaths as a share of defeats: 6 of 8 for the expert (`sim`, `sim2`).** Almost every defeat is a Monarch death by
  construction; the rest are ceilings.
- The threat meter's bands were measured before waves and have not been re-calibrated.

The ladders above predate the necessity tuning below. On the final config, basic still clears none and dies
on floor 1 in 81% of 64 runs.

#### Mechanic necessity

The goal is an expert who needs every mechanic to clear, with the core ones weighing most. The measure is
**ablation** (`npm run ablations`): the expert autoplayer plays the same seeds once in full and once for
each mechanic taken away (`ABLATIONS` in `src/sim/autoplay.js`). It plans around the gap: its rehearsals,
route rollouts, room veto and spending all carry the ablation, so essence the missing mechanic would have
taken goes wherever the expert would spend it next. A mechanic's **drop** is the full expert's clear rate
minus the ablated expert's, in points. The targets:

| | Mechanics | Target |
|---|---|---|
| Full expert | | 90%+ clear |
| Core | monarch-stats, arise, orders, reserves, army | 25–50 point drop each |
| Extra | ranks, paths, keystones, relics, synergies, formation | 8–25 point drop each |
| Reference | levels | reported, not targeted |

`npm run necessity` is a quick proxy. It refights the full expert's recorded battles with each mechanic
stripped. It steered the two tuning rounds between sweeps (the rule changes are listed under Status), but it
cannot see the expert adapt.

The confirming sweep: `npm run ablations -- --seed confirm`, 8 runs a variant, 104 runs, 15.4 min on 8 cores.
The last column is the round's own sweep of the same tree on seed `sim`, for the noise. At 8 runs, one run is
12.5 points.

| Variant | Tier | Clear | Died on floor 1 / 2 / 3 / 4 | Drop | What ended the runs (killer's threat, or ceiling) | Drop on `sim` |
|---|---|---|---|---|---|---|
| full | | 75% | 0 / 1 / 0 / 1 | – | ceiling 1, reach 1 | (88% clear) |
| monarch-stats | core | 0% | 2 / 5 / 1 / 0 | 75 | reach 3, flank 3, ceiling 1, drain 1 | 88 |
| arise | core | 63% | 0 / 0 / 1 / 2 | 13 | flank 1, ceiling 1, shape 1 | 38 |
| orders | core | 75% | 0 / 0 / 1 / 1 | 0 | shape 2 | 25 |
| reserves | core | 63% | 0 / 1 / 2 / 0 | 13 | reach 1, clock 1, flank 1 | 0 |
| army | core | 50% | 1 / 0 / 1 / 2 | 25 | reach 2, shape 1, flank 1 | 25 |
| ranks | extra | 88% | 0 / 1 / 0 / 0 | −13 | ceiling 1 | 0 |
| paths | extra | 88% | 0 / 0 / 0 / 1 | −13 | flank 1 | −13 |
| keystones | extra | 63% | 0 / 1 / 1 / 1 | 13 | ceiling 1, flank 1, shape 1 | 13 |
| relics | extra | 75% | 0 / 0 / 1 / 1 | 0 | shape 1, flank 1 | 38 |
| synergies | extra | 63% | 1 / 0 / 0 / 2 | 13 | shape 1, reach 1, clock 1 | 38 |
| formation | extra | 38% | 1 / 1 / 3 / 0 | 38 | reach 2, flank 2, ceiling 1 | 50 |
| levels | ref. | 88% | 1 / 0 / 0 / 0 | −13 | reach 1 | −13 |

Each ablation does remove its mechanic. Its uses fall to zero in the sweep's uses table: no points under
monarch-stats, no promotions under ranks, no cohorts or musters under army, no tiers under paths, and no
keystones or relics under theirs.

Met (seed `confirm`): army 25 (core); keystones 13 and synergies 13 (extra).

Not met:
- **Full expert 75% (target 90%+).** It cleared 88% of the same tree on `sim`: 13 of 16 over both seeds.
  Its three losses over both seeds are two Monarchs felled by reach and one tick-ceiling stall.
- **monarch-stats 75 (core, too large).** With no points, no run clears on either seed, and most die on
  floor 2 to reach and flank. Command's banners, Dominion's domain and the Monarch's HP still carry the run.
- **arise 13 (core, too small).** It read 38 on `sim` (25 over both seeds): it straddles the band's floor. The
  expert spends the Will it does not buy on Command and Dominion.
- **orders 0 (core, too small).** It read 25 on `sim`. The Stay line and braced posts seldom flip a battle:
  in the last proxy reading, all 361 of the expert's recorded battles are still won with every plan turned to
  Hunt.
- **reserves 13 (core, too small).** It read 0 on `sim`. In the last proxy reading, turning the recorded held starts to
  `once` loses 9 battles (a 50-point drop in runs clean). An expert that plans without them re-plans its
  field and spending around the board's 10, and loses little.
- **ranks −13, paths −13 (extra, too small).** Each is a run's worth better than full on one seed, and
  0 / −13 on `sim`. The freed essence buys levels (paths: 300 levels against 137; ranks: 174) and, under
  paths, Knights and Marshals (134 promotions against 45), and these replace what was lost.
- **relics 0 (extra, too small).** It read 38 on `sim` (19 over both seeds, in band). This is seed noise more
  than tuning.
- **formation 38 (extra, too large).** It read 50 on `sim`. Basic's cells park the Monarch at the rear centre
  and set souls by role row, and reach and flank foes find the Monarch there. Where the Monarch stands is most
  of the Monarch's safety, so formation weighs like a core mechanic.

Over both seeds (16 runs) the in-band set grows to arise 25, army 25, keystones 13, relics 19 and synergies 25.
Only monarch-stats (81) and formation (44) stay too large, and orders (13), reserves (6), ranks (−6) and paths
(−13) too small. At 8 runs a variant, most mechanics swing across a band from seed to seed. Settling the rest
needs 16–24 runs a variant.

## Build order

Each slice is playable on its own and measurable with the ladder.

1. **Prerequisites.** A tile-to-unit index behind engagement, auras and neighbours, and a battle budget
   for the autoplayer, so 40-unit battles do not make the tests unusable. The common step clock,
   flankers through bodies and the gauge cap go in here too: they change today's battles, so the ladder
   should see them before the Monarch does.
2. **The Monarch.** On the board, the loss rule, the domain and faltering, Arise as its cast, three
   stats bought with essence, and the threat-variety rule in the generator so floor 1 has more than one
   answer from the start. Autoplayer: places it, spends on it by rehearsal.
3. **Bodies and banners.** Rank-and-file as counts, muster, cohorts placed as one piece, binding after a
   win. Autoplayer: fields banners.
4. **Plans and reserves.** Detachments, the Move square, start triggers, the reaction rule, entry
   events, and the plan marks in prep and in battle. Autoplayer: searches plans in its hill-climb, from
   Stay, Hunt and a few squares.
5. **The enemy as an army.** Captains with cohorts and hinted orders on floor 2, waves on floor 3, Siege
   rooms, the Sovereign's court.
6. **Ranks.** Promotion by feeding bodies, with the cap-breaking rewards.
7. **Keystones and trigger relics.** Turn half the relic list into rules; add the keystones, two or
   three a run.
8. **Synergy breakpoints at 6 and 8; endless floors.** Then, if sieges want
   it, data-driven board size.

## What the code has to change

- **The loss rule.** `checkEnd` in `src/sim/battle.js` ends the battle on a wipe; it has to end it the
  instant the Monarch's HP reaches 0, and count undeployed reserves as living.
- **Units joining mid-battle.** Shadows and reserves break an invariant the sim relies on: the synergy
  cache (`synergiesOf`) versions on the living count because units only ever leave, and the stats cache
  keys on it. Both need a roster version counter. Bonds are fixed at start; shadows and reserves take
  theirs on entry. `fight` in `src/sim/run.js` reserves uids for the foes only; waves and shadows
  need theirs too. The renderer adds actors only at `battle:start`; an `enter` and an `arise` event
  need the same path, with a side tint for shadows.
- **The party model.** Rank-and-file as counts per kind in `run.state`, with standing and fallen;
  banners as `{ captain, kind, count, shape, order }`; the Monarch as a party unit with a fixed uid
  that `place` accepts and `release` and the bench refuse. New actions: `order`, `bind`, `muster`,
  `monarch` (buy a stat point), `promote`. `legalActions` lists them; the fuzz test covers them.
- **Movement.** Steps come off a common clock, one every 16 ticks for every unit, not off the gauge:
  `chooseAction` no longer prices a step at 40 gauge. The path search in `searchStep` lets a flanker
  pass through living units, keeping the danger cost out, while everyone else is blocked as now. Gauge
  is capped at the unit's costliest action. The board holds 14 bodies; `canPlace` enforces it and the
  rest deploy as reserves.
- **Battle AI.** `chooseAction` reads the detachment's plan for movement, a square, Stay or Hunt,
  and the role for targeting; the reaction rule comes first; a unit on or next to its square switches
  to Hunt; the domain check applies the faltering status; start triggers are evaluated each tick. The
  path search already takes a set of goal tiles, so a square is one more goal.
- **Encounters.** `encounter` gains captains, cohorts and waves per floor, and `map.js` a `siege` room
  type. Each unit kind carries threat tags, and the draw rejects a room with fewer than two types (three
  for an elite) from floor 1's third rank.
- **Content.** The Monarch as a unit with three pictures, Arise with a `corpse` shape, orders, the
  keystones, trigger relics, enemy order hints.
- **Autoplayer.** `pickSpend` values purchases by stat delta, so Monarch stats, orders and keystones
  would be worth zero; route them through the rehearsing path `weighOffers` already uses. Give
  rehearsals a tick budget, and fewer seeds at large sizes. The two levels define the skill gap: basic
  parks the Monarch at the back, keeps default orders, binds only the free bodies and never promotes;
  expert places the Monarch and searches plans in its hill-climb, spends by rehearsal and promotes.
- **The defeat screen.** Names what killed the Monarch, the ability's shape and where it struck from,
  from the battle's events; the ladder tallies the causes by threat type.
- **UI.** Banners as pieces in the editor with a shape; detachments by highlighting; a plan as a
  marked square with an arrow to it and a start tag, faded when outside the domain, and the same marks
  faint in battle; the ossuary as counts; the Monarch's panel; the dark behind the camp where reserves
  wait.

## Open questions

Settled on 2026-10-06 and folded into the sections above: shadows always falter; a Marshal's domain
heeds every order; two or three weaker keystones a run; the Monarch does not move; the Sovereign's
court pays essence; endless floors, not heat.

Still open:

- What mix of threat types on floor 1 makes the basic autoplayer die there 70% of the time without the
  expert dying there at all? Tune the spawn weights, the Monarch's HP and the variety rule together,
  and check the cause-of-death spread so no one type does the killing.
- Should faltering be a flat 30% for every soul, or steeper for rank-and-file than for captains?
- Do endless floors keep adding waves, or raise the enemy's own Command and Dominion as if it were a
  player?
