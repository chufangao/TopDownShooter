# RETINUE

A small necromancer autobattler in the browser. You are the **Monarch**, a necromancer who stands in its
own camp, never strikes, and leads an army of the dead down four floors, choosing the route room by room.
Each soul in your retinue is a captain that may lead a cohort of rank-and-file: bodies of the slain, bound
after a win. Battles play out on their own. Your say is who stands where (yourself included), what orders
they carry in, and what you make of them between battles. Slay the Hollow Sovereign at the bottom of floor 4
to clear the run, then descend into the endless deep for as long as you last. If the Monarch falls, the run
is over: nothing revives it.

## The loop

You start as the Monarch with three level-2 souls (Tomb Knight, Bone Chanter, Frost Sprite), 20 essence and
an empty ossuary.

```
 ┌──► MAP: scout the rooms, spend essence, pick the next room ──────────┐
 │       │ fight/elite/siege/boss    │ reliquary │ rite        │ altar  │
 │       ▼                           ▼           ▼             ▼        │
 │    PREP: arrange the camp,      1 of 3      1 of 3 tiers; heal all,  │
 │       │ give orders, spend      relics      a keystone    raise the  │
 │       │ Begin                     │         (floor 2+)    fallen     │
 │       ▼                           │           │             │        │
 │    BATTLE: plays out alone        │           │             │        │
 │       │ won   │ the Monarch falls │           │             │        │
 │       ▼       ▼ or time runs out  │           │             │        │
 │    SPOILS:    RUN OVER            │           │             │        │
 │    essence, a recruit,            │           │             │        │
 │    bodies to bind;                │           │             │        │
 │    elite: relic, keystone         │           │             │        │
 └───────┴───────────────────────────┴───────────┴─────────────┘        │
   after the floor's last room → next floor ◄───────────────────────────┘
   the Sovereign slain on floor 4 → CLEARED → Descend to floor 5, 6, …
```

## Floors and rooms

Each floor is a one-way map: a start, fourteen ranks of 2–4 rooms, and a final room. You move only to a
room linked to the one you stand in, so a branch taken gives up the others. Foes grow stronger across a
floor's ranks. Rank 1 is all fights, no elite stands before rank 4, the middle ranks hold one or two
reliquaries and one or two rites, and the rank before the final room always holds exactly one altar.

| Room | What happens |
|---|---|
| Fight | 3 / 4 / 5 / 5 foes on floors 1–4, and from floor 2 one of them is a captain with its cohort. Essence, one soul to recruit, bodies to bind. From floor 3, a fight from rank 8 on comes in 2 waves. |
| Elite | A tier stronger: 2 / 5 / 6 / 6 foes, two of them captains from floor 2. Floor 1: a late pair joins at 20 s. From floor 3: 2 waves. Spoils add 1 of 2 relics, free, and from floor 2 1 of 2 keystones. The final room of floors 1–3. |
| Siege | From floor 3, one or two a floor in ranks 9–14 (never two in a rank): one battle of 3 fight-sized waves, no prep between them. Recruits and binds after; no relic. |
| Reliquary | No battle. Take 1 of 3 relics. A retinue carries at most 6 relics: past that, reliquaries and elites offer none. |
| Rite | No battle. Take 1 of 3 free path tiers (each for a different soul where it can); from floor 2, also 1 of 2 keystones. |
| Altar | No battle. Every soul and the Monarch heal to full, fallen souls rise at 50% HP, fallen rank-and-file stand again. |
| Boss | Floor 4's final room: a siege of 2 waves, then the Hollow Sovereign and its court. It grows stronger at 60% and 25% HP and raises the dead. Killing it clears the run. |

**Scouting.** Every battle room's foes are drawn when the floor is made. Hover any battle room, reachable
or not, to see its foe count, level and kinds, its formation (captains flagged with their cohort's size),
every later wave's formation and when it comes, their synergies, and a **threat** meter. What the foes will
do is never shown: no orders, paths or targets. Threat compares power, `√(HP × ATK × damage dealt × gauge
rate)` summed per side with wounds counted. Your side counts the fielded souls and the cohort members on the
board, a body outside the domain at its faltering damage; the Monarch, the reserve and held detachments add
nothing. Their waves add as the root of their squares (two equal waves count √2 of one). Bands: below 0.6×
Low, 0.6–0.8 Moderate, 0.8–1.0 High, 1.0–1.2 Severe, 1.2 and up Deadly. In the deep, their 8-step rules are
named under the meter as not counted.

**Threats.** Every foe kind carries threat tags (`THREATS` and each unit's `threats` in `src/content.js`):
**Flank** (slips through the line to whoever hides at the back), **Reach** (strikes from afar once the line
gives way), **Shape** (hits a whole row, lane or crowd), **Drain** (saps gauge or rots defence), **Clock**
(drags a fight into escalation). **Depth** is a room's tag: more foes arrive behind the first. From rank 3 of
every floor a fight's foes (every wave counted, depth included) carry at least 2 tags and an elite's 3; a draw
with fewer is redrawn, up to 50 times. And every walk through a floor meets every tag its foes can bring: a
room on a walk that misses one is redrawn wanting it (up to 6 times a tag, in two passes). Tags are never
shown in play; the defeat screen names the one that felled you.

## The Monarch

A unit in your camp like a soul, with its own pictures and a gold-framed HP bar, in every battle.

- **It never steps and never strikes.** Place it on any open camp cell; it can't be benched, released,
  levelled or given a path, and takes no orders. A cell where it would seal part of the camp off from the
  fight (a wall's one gap) is ringed red in the editor; a new floor's camp that walls its cell seats it on the
  rear row's middle lane, or the nearest open cell that seals no one in.
- **The loss rule.** The battle is lost the instant the Monarch falls, however many souls stand, and a lost
  battle ends the run. It is won when no foe stands and none is still to come. If every soul falls, the
  Monarch fights on with its shadows and can still win. A battle still undecided 120 s after the last foe
  entered (after the start, if none has) is lost too. The defeat screen names the killer, its ability, the
  tile it struck from and its threat tag.
- **Domain and faltering.** The domain is every tile within 3 + Dominion of the Monarch (Chebyshev: a square
  around it), reaching onto the open ground and their rows if it stands far enough forward. A party unit
  outside it, and every shadow, **falters**: it deals ×0.7 damage, checked every tick. Faltering also cuts a
  unit's orders (see Orders). The camp outlines the domain and marks souls outside it; the battle shows ×0.7
  beside a faltering unit.
- **Arise** is its one act (200 gauge, about 4 s). It raises a fallen foe lying in the domain, on a tile no
  one living stands on, of tier 2 + Will or lower (never a boss, a shadow or one of yours), as a **shadow** on
  your side at its level with its full HP and its own abilities: the highest tier first, then the nearest.
  At most 3 × (1 + Will) a battle. Its shadows stand past the board's cap of 10: they take no place a body
  entering needs. A shadow falters like a soul (outside the domain, unless it rose within a Marshal's domain:
  then it joins that banner), counts for synergies, holds the bonds of the tile it rose on, and is gone when
  the battle ends. With nothing to raise, the Monarch banks its gauge.
- **HP.** 220, +14 a point bought (healing it by as much). No synergy, relic or keystone changes its stats;
  only points raise its HP. Statuses and auras still reach it (Iron Oath's Barkskin included). Its wounds
  carry like a soul's: half its max HP back after a win, full at an altar.
- **Monarch points** cost `20 + 10 × points bought` essence, on the map or in prep, with no cap:

| Stat | Each point |
|---|---|
| Dominion | +1 tile of domain. |
| Command | +1 banner on the field (3 + Command on floor 1 and one more banner each floor down, + relics, + keystones, at most 10) and +1 body a cohort (a cohort holds up to Command, more under a Knight or Marshal). |
| Will | Arise raises three more a battle, one tier higher; one more body binds free after a win. |

## The army

- **Banners.** Up to 3 + Command souls stand on the field (one more each floor down: 4 + Command on floor 2, 6 + Command on floor 4), each a captain, the rest on the bench (up to 12
  souls in all, 15 with the Ossuary Key; the Monarch counts toward neither). A captain may lead a
  **cohort**: 1 to Command bodies of one kind (a Knight 2 more, a Marshal 4 more) sharing its kin or its role (a Tomb Knight, Undead Vanguard,
  can lead Grave Ghouls or any Vanguard), from the bodies standing in the ossuary that no other cohort leads. Captain and cohort are one
  banner. A benched or fallen captain's cohort stays out with it. At Command 0 only a Knight or Marshal leads one.
- **Shapes** (`SHAPES`) set where the members stand around their captain; a walled, off-camp or taken cell
  passes to the next in the shape, then to the open cell nearest the captain.

| Shape | Members |
|---|---|
| Pair | Two abreast, filing back behind the captain. |
| Line | One rank abreast of the captain, lanes out to either side, then a second rank. |
| Wedge | Fanning out behind the captain on the diagonals. |
| Block | Three lanes wide, the captain front and centre. |
| Mouth | Two horns a step ahead, the tile before the captain left open; past seven, the rest may close it. |

- **In battle** a member strikes what comes in reach and otherwise keeps within a tile of its captain (a ring
  further out when those tiles are full). If its captain falls it falters for the rest of the battle and
  hunts alone. Members count for synergies, bonds and auras like any unit; they are drawn at 0.8 scale.
- **The ossuary** keeps the rank-and-file as counts per kind, standing and fallen. Bodies that fall move to
  fallen; an altar stands them again. Bodies have no paths: all fight at the **muster level**, from 2, the
  next level costing `9 × level^1.2` essence (cap 10; Grave Ledger's discount applies).
- **Binding.** After a win the slain may be bound, up to as many of each kind as fell (never the boss, never a
  shadow). The first 1 + Will each battle are free, each more `3 × tier`. Unbound slain are lost when you move on.
- **The board and the reserve.** At most 10 of your bodies stand on the board (captains and members; the
  Legion's shadows count once risen; Arise's shadows, held detachments and the Monarch do not). Members take the board round the banners, each captain's first,
  then each one's second; a body with no room **sits the battle out** (shown on the strip behind the camp).
  Only a held detachment (see Orders) enters once the battle is under way: a later start is the only way more
  than 10 bodies fight.

## Orders

Before a battle, souls on the field can be formed into **detachments** (up to 4, each in its colour) with a
plan; a cohort goes with its captain, and a soul in none Hunts, at once.

- **Where.** **Hunt**: toward the foes, each role its own way. **Stay**: hold the tile it starts or enters on,
  and walk back to it after each fight; one of yours within a tile of the tile it holds is **braced** (−50% damage
  taken) and **holds the line**: no foe slips through it (a flanker cannot vault it) or away from beside it. **Move**: walk to a square (any non-wall cell of the board, theirs
  included); on it or next to it, it has arrived and Hunts.
- **When.** At once, after a time (5 s steps), once the Monarch is struck, once more foes enter (a wave), or
  once a body of yours on the board falls. A later start is **held**: its souls and bodies wait off the board,
  taking none of the 10 places, and when called enter beside the Monarch, captains first, one a tick, ahead of
  the reserve. They stand **past the board's cap**, in 10 places of their own (so a held start is how more than
  10 of your bodies fight at once). Held souls and bodies enter **fresh**: with a full gauge, and Shielded for
  12 s (−40% damage taken). A wave start where no foe enters mid-battle never comes.
- **The reaction rule**, for every unit on either side whatever its plan: strike what is in reach (or bank for
  it); else a melee unit steps to engage a foe within 2 tiles; else a ranged unit holds while a foe is in
  range; else follow the plan.
- **The domain's leash.** Outside the Monarch's domain only Hunt is heeded: a unit that falters drops its plan
  for the rest of the battle. A Move beyond the domain is a one-way trip, unless a Marshal's domain holds it.
- A cohort keeps its captain's plan within its leash, and Hunts once its captain does. A Trickster passes
  through bodies on any plan.

## Ranks

Feed a soul standing bodies of its kin (any kinds) from the ossuary to promote it: 3 make a Knight, 6 more a
Marshal. Unled bodies go first, lowest tier first, then led ones (their cohorts shrink). The bodies are gone
for good; no essence; a benched or fallen soul can be promoted.

| Rank | What it opens |
|---|---|
| Soldier | Tiers I–III on one path. |
| Knight | Tier IV on its path (120 essence; an ability, never a percentage) **or** tier I of a second path. Leads 2 more bodies. Deals ×1.2 damage and takes ÷1.2. |
| Marshal | Both, and the second path's tiers II–III. Leads 4 more bodies. Deals ×1.4 damage and takes ÷1.4. A domain of its own, 3 tiles around it, moving with it: there its banner never falters (so keeps its plan, even beyond the Monarch's domain), and a shadow risen there joins its banner. |

Two paths that remake the same ability, or both grant an aura, never pair. The camp marks a Knight with a
shield and a Marshal with a standard, and dashes each Marshal's domain in its banner's colour.

## The camp and the battle

- **The camp** is 7×7; each floor draws one of its three hand-made camps (`CAMP_LIST`) for the whole floor.
  Walls block walking, not attacks. Their 3×7 formation stands above it across one row of open ground.
- **Movement.** Every unit steps at most one tile every 0.8 s, off the gauge. Melee reaches the 8 tiles
  around; ranged abilities their range. Bodies block everyone but a flanker; a unit with a foe beside it is
  **engaged** and can't walk away. On Hunt each role moves its own way:

| Behaviour | Roles | What it does |
|---|---|---|
| Advance | Vanguard, Warden | Walks to the nearest foe and fights it. |
| Hold back | Ranger, Skirmisher, Channeler | Walks until a foe is in range; avoids stepping next to one while it has a ranged attack, unless that leaves it no way in. |
| Flank | Trickster | Slips through the line, friend and foe alike, vaulting bodies to the first open tile beyond, to hunt whoever hides at the back. Only walls stop it. |

- **The gauge** fills by speed; a unit acts when it covers its next ability, using the first whose condition
  holds and that has a target in reach. It banks only up to the unit's costliest ability.
- **The clock.** All damage ramps (+10% a second, up to ×8) from 45 s after the last entry, either side (90 s
  in the boss room), but never later than 90 s after the last foe entered. The ceiling is 120 s after the last
  foe entered. Space pauses, 1 / 2 / 4 set the speed, S skips; none change the outcome.
- **Under the camp** the editor reads the line (front-most row, rows ahead of the Monarch and short of their
  front) and the approach (open tiles beside the Monarch held at the start, dashed red while bare), and marks
  ⇈ a melee captain stuck behind melee of another banner. **Begin** warns of faltering souls, one-way trips and
  a Monarch alone.

## Synergies, bonds and auras

Synergies count the fielded souls and cohort members on the board sharing a kin or role (shadows too, in
battle; never the Monarch). Each kin and role has steps at 2, 4, 6 and 8 (Ranger 3, 6, 8), and they stack.
Five **pacts** need a kin and a role at once (Grave Vigil: Undead 4 + Warden 2, …). Every **8 is a rule**,
holding for whichever side reaches it (the foes only in the deep, from its second floor), named over the
unit it acts through:

| Step | Rule | What it does |
|---|---|---|
| Undead 8 | The Legion | Every foe slain rises as a shadow on your side, past Arise's limit and tier (never a boss, a shadow or a Monarch), while fewer than 10 of your bodies stand. |
| Drake 8 | Dragonfire | Every single-target attack also strikes every foe next to its target. |
| Fae 8 | Mirage | The first blow each foe would land in a battle misses. |
| Insect 8 | Frenzy | A unit that slays a foe has its gauge filled. |
| Construct 8 | Last Stand | The first blow that would fell each unit leaves it at 1 HP, once a battle (never the Monarch). |
| Vanguard 8 | Bodyguard | A single-target blow at a non-Vanguard lands on a Vanguard next to it. |
| Ranger 8 | Deadeye | Ranged blows never miss, and every one is a critical hit. |
| Skirmisher 8 | Ambush | The side starts, and enters, with full gauges. |
| Channeler 8 | Echo | Every ability runs its effects twice (Arise never echoes). |
| Warden 8 | Sanctuary | Every ability aimed at an ally touches every ally on the board. |
| Trickster 8 | Deathblow | A critical hit slays outright, except a boss or a Monarch (a Last Stand still holds, once). |

**Bonds** are fixed by the formation as the battle begins (a member by its cell, a reserve body or shadow by
where it appears): Phalanx (two Vanguards side by side, +20% DEF), Vigil (a Warden right behind a Vanguard,
−12% damage taken), Spotter (a Skirmisher right ahead of a Ranger or Channeler, +12 ACC, +10 CRT), Kinship
(two of one kin side by side, +8% damage). ◆ marks a bonded soul. Some souls give an **aura** to allies near
them; **blasts** hit their target and everyone next to it, aimed where targets stand thickest.

## Relics and keystones

**Relics** (21, `RELIC_LIST`) come free from reliquaries (1 of 3) and elites (1 of 2) and last the run;
one held is never offered again. Three are flat stats (Whetstone, Heartwood, Glass Crown), seven shape the
economy or rules (Grave Banner +1 field slot, Soul Lantern, Tithe Bowl, Grave Ledger, Rite Candle, Binding
Chain, Ossuary Key), and eleven are **triggers**, firing for your side only:

| Moment | When | Relics |
|---|---|---|
| On a kill | one of yours slays a foe | Blood Chalice (killer heals 10%), Arcane Focus (killer +40 gauge), Hunter's Mark (foes next to the slain turn Brittle) |
| On a fall | one of yours falls, never the Monarch (an Undying rise still fell) | War Drum (yours within 2 gain Hasten), Balm (yours within 2 heal 12%), Bone Idol (Arise +40 gauge) |
| On entry | a reserve body or held detachment enters (a shadow rising does not) | Tower Shield (Shielded, −40% damage taken, 8 s), Rally Horn (yours within 2 gain Hasten) |
| When struck | the Monarch takes damage and stands | Hourglass (Arise +30 gauge), Iron Oath (yours within 2 gain Barkskin), Grave Bell (attacker Withered) |

**Keystones** each rewrite a rule for the run. From floor 2 a won elite and a rite each offer 2 you do not
hold; take one, free; a run holds at most 3. Nothing ever revives the Monarch.

| Keystone | Rule |
|---|---|
| Legion | Two more banners, but every soul (and its bodies and shadows) has 15% less HP. |
| Undying | Fallen captains rise once a battle, at 50% HP, on their tile, cohort still theirs. |
| One Army | Each banner shares one HP pool between captain and cohort, and falls together. |
| Mimicry | Vanguards count as Wardens too, for your synergies and bonds. |
| Vanguard Crown | The domain centres on your front-most captain, not the Monarch, and is 1 tile smaller; entries come beside it. |
| Hollow Court | Arise's shadows still standing after a win stay, as rank-and-file in the ossuary. |
| Blood Tithe | Arise's cap a battle doubles, but each shadow costs the Monarch 3% of its max HP. |
| Court of Bone | The domain is 2 tiles larger, but nothing heals the Monarch, in battle or out. |

## The enemy army

What scouting shows is who comes, where they stand and when; what they will do is only ever hinted, in each
foe's lore line (`flavour`, at the foot of its card).

- **Floor 1: the late pair.** An elite brings 2 more foes of the floor's pool over the far edge at 20 s.
- **Floor 2+: captains.** A fight's formation (and each wave) has 1 captain, an elite's 2, each leading a
  cohort of 2 more of its kind (3 on floor 4). The cohort keeps within a tile of its captain; kill the captain
  and it falters (×0.7) and hunts. An elite's captains march under orders of their own, never shown.
- **Floor 3+: waves.** Elites, fights from rank 8 and sieges come in waves, each a formation scouted like the
  first. The next enters at the far edge, each foe in its lane, once the wave before is down to a third, or
  30 s after it began to enter. Each wave's essence is tallied as it falls (the battle shows it, the spoils
  list it) and paid with the win.
- **The Sovereign's court.** Floor 4's last wave is the Hollow Sovereign with a court of 4 undead. Its Grave
  Tide raises up to 2 of the field's dead, yours or its own, as shadows on its side. Kill it and every foe
  crumbles: the battle is won, waves not yet entered never come, and the crumbled pay as if slain.
- Bodies enter one a tick on each side, yours beside the Monarch, theirs at the far edge.

## The deep

Killing the Sovereign clears the run (the clear stands whatever follows). The end screen offers **Descend**:
floors 5, 6, … reuse floor 4's camps and foes, each ending in a big elite instead of a boss, and grow with
every floor deeper (`TUNING.spawn.endless`): foes keep rising 2 levels a floor; one more foe a wave every two
floors (at most 21) and +8% HP, +5% ATK a floor; one more wave to every room every two floors (at most 6) and
one more body in every cohort every two floors; from the second deep floor (floor 6) their 8-step rules hold.
The big elite brings 2 more foes, 1 level higher. A fall in the deep ends the run; the end screen still reads
CLEARED and counts `4/4 + n deep`. The autoplayer never descends.

## Progression

Every number lives in `src/tuning.js`; the code is the progression section of `src/sim/run.js`.

| Retinue | How |
|---|---|
| Essence | Each real foe slain pays `2.5 × tier × (1 + 0.35 × (level − 1))` when the battle is won (shadows pay nothing); a run starts with 20. |
| Levels | The next costs `8 × level^1.2` (18 at level 2, 112 at level 9). Cap 10. |
| Paths | 2–3 per kind of soul, tiers 20 / 45 / 75 / 120; tier III changes what a soul does on all but two paths (an ability or an aura). Tier IV and a second path need a rank. Rites grant a tier free. |
| Ranks | 3 bodies of the soul's kin for a Knight, 6 more for a Marshal. |
| Recruits | One per won battle, of the kinds slain, at their level: `8 × tier × (1 + 0.35 × (level − 1))`. Up to 12 souls (15 with the Ossuary Key). |
| Monarch | `20 + 10 × points bought` a point, uncapped; +14 max HP each, from 220. |
| Bodies | Bound after a win: 1 + Will free, then `3 × tier` each. |
| Muster | Every body's level, from 2: the next costs `9 × level^1.2`. Cap 10. |
| Relics | 21; three flat, seven economy or rules, eleven triggers. |
| Keystones | 8; from floor 2, 2 offered at each won elite and rite, at most 3 a run. |

| Foes | How |
|---|---|
| Level | `1 + 2 × (floor − 1)`, plus up to 2 across a floor's ranks (1→3, 3→5, 5→7, 7→9). Elites draw a tier higher. |
| Numbers | Fights 3 / 4 / 5 / 5, elites 2 / 5 / 6 / 6 on floors 1–4; from floor 2, cohorts of 2 / 2 / 3 more behind 1 captain (2 in an elite). |
| Waves | Floor-1 elites a late pair of 2; from floor 3, 2 waves for elites and fights from rank 8, 3 for sieges and the boss room. |
| Multipliers | HP ×0.8 / 0.88 / 0.76 / 0.95 and ATK ×0.75 / 0.83 / 0.76 / 0.9 on floors 1–4; the Sovereign ×1 of both. |
| The deep | Per floor deep: the usual +2 levels, +0.5 foes a wave, +0.5 waves and +0.5 cohort bodies (rounded down), HP ×(1 + 0.08 × deep), ATK ×(1 + 0.05 × deep); the big elite +2 foes, +1 level. |

## Run it

No install, no build step, no network. Node 22+.

```
npm start            # http://localhost:5173
npm test             # node --test, sim only, no browser
npm run sim          # 8 expert runs: the balance report (about 2 min on 8 cores)
npm run decisions    # 8 expert runs, how much placement decides battles (about 2 min)
npm run ladder       # basic vs expert on the same 8 seeds: the skill range (about 2 min)
npm run ablations    # the expert, and the expert with each mechanic taken away, on the same 8 seeds (about 20 min)
npm run necessity    # the expert's battles refought with each mechanic stripped (about 2 min; seconds with --setups)
```

Each report takes `--runs N`, `--seed name` and (sim, decisions) `--level basic|expert` (expert by default),
and plays its runs in parallel, a worker thread per core. A basic run takes a second; an expert run about a
minute of one core on average (with every core busy) and up to about 1.5 for a clear, so a report finishes in
about the time of its slowest run while its runs fit the cores. The defaults are sized for that, and are too
few to balance on: ask for more with `--runs N` (through npm, `npm run ladder -- --runs 16`). Past the core
count the time grows with the runs: a 16-run ladder takes about 5 minutes on 8 cores, `npm run sim -- --runs
24` about the same, `npm run ablations -- --runs 12` about 30 minutes. The expert's rehearsals are memoised (a
battle is a pure function of its setup, so the same setup on the same seed is never fought twice), and the
pool's workers share one memo, so the ablations of a seed refight nothing they share with its full run (the
pool plays each seed's full run first, then its ablations, the longest first). None of that changes a decision
or an outcome: a run is the same run however fast it is played. Two things do, a little, and only in rehearsals
(`TUNING.autoplay`): a rehearsal ends once its result is settled (`settle`: battle.js `settled`), and the formation
search stops fighting a formation's remaining rolls once they could not lift it past the best so far (`prune`;
`'finalists'` is the exact form, `null` fights every roll). A real fight is always played to its end.

- **sim** prints the clear rate, deaths per floor, battles per run, battle length (median, p90, max, at the
  ceiling) and souls reaped; then per floor (battles, won, field level, fielded, roster, foes, relics) and
  per camp (battles, won, runs ended there).
- **decisions** refights every battle 8× with the party in random cells and prints per floor how often the
  autoplayer's formation and the random ones won, the share of battles placement decided, and HP kept.
- **ladder** plays both levels on the same seeds and prints, per level, eight blocks: clear rate, the floor
  each run died on, battles won, relics, recruits; Monarch points (total and per stat), shadows raised a
  battle, and what ended each run (the killer's threat tag, or `ceiling`); the army (muster, bodies bound and
  standing, members, reserve, entered and fallen per battle); orders per battle (detachments, units on Stay or
  Move, held, called, held entered, arrived); foe waves and foes entered per battle, and Monarch deaths by
  threat by floor; reDESIGN's measures (army share that acted, battles from floor 3 where a reserve body
  entered, time spent faltering, Monarch deaths per defeat, the top cause's share, depth deaths, ceilings);
  median battle ticks by floor; and the build spread in wins (commonest keystones, kin, paths, keystones with
  kin).
- **ablations** plays the full expert and the expert with one mechanic taken away (`ABLATIONS` in
  `autoplay.js`: monarch-stats, arise, orders, reserves, army, ranks, paths, keystones, relics, synergies,
  formation, levels) on the same seeds, every run in one pool, and prints per variant the clear rate, the
  floor each run died on, the drop against the full expert and the Monarch's deaths by threat, then what each
  variant used (points, promotions, binds, cohorts, musters, orders, tiers, levels, keystones, relics), and
  each drop against its band (a core mechanic, monarch-stats to army, 25–50 points; an extra one 8–25).
  It also reads each run's **progress**: the rooms completed of the 60 on the route to the Sovereign, the battle
  lost counted by the share of its foes' HP removed (1 for a clear). Per variant: mean progress, its drop against
  the full expert paired seed by seed with one standard error, and a **clear-equivalent** drop, k × the progress
  drop, where k (printed) is the least-squares slope through the origin of the clear drops on the progress drops
  across the variants played; each targeted mechanic is marked in, under or over its band by it, beside the
  clear-rate check. `--variants army,orders` plays only those beside the full expert (`--variants full` the full
  expert alone), and `--out runs.json` writes every run's outcome and progress, for pairing two sweeps by seed. `npm run sim -- --ablate <mechanic>` gives
  the sim report for one of them. By default it plays 8 runs a variant on seed `sim`: 104 expert runs, about
  20 minutes on 8 cores (the header gives the time and the share of rehearsals the memo spared). `--runs 16`
  takes about twice that. At 8 runs one run is 12.5 points, so a drop is coarse: two 8-run sweeps of the same
  tree on different seeds differed by up to 38 points on one mechanic. The clear-eq drop is steadier: in two
  6-run sweeps its standard error was that of 2–4 times as many runs read by the clear rate. reDESIGN.md's "Mechanic necessity" has
  the latest sweep.
- **necessity** records the full expert's battles (the run just before each fight), then refights each as it
  stood and once per mechanic stripped from it, and prints per variant battles won, the Monarch standing, HP
  kept, the runs whose every battle is still won (and that share's drop against the full expert, a run-scale
  reading), and battles won by floor. Its header gives how many as-it-stood refights match the real battle
  exactly (all of them, or a setup lost something). By default it records 8 runs on seed `sim`, about 1–2
  minutes, and the refights take seconds. `--setups file` keeps the recording: read if there, else written, so
  a rerun refights only. It is a proxy for **ablations**, quick enough to steer tuning: it cannot see the
  expert adapt (spend a stripped mechanic's essence elsewhere, or fight other battles), so it overstates
  what the expert re-spends (relics, keystones, monarch-stats).

The autoplayer (`LEVELS` in `src/sim/autoplay.js`) plays on a player's choices and scouting, never a
battle's own seed nor an elite captain's hidden orders (it rehearses them on orders guessed from each kind's
list). **basic** plays rules of thumb: the Monarch parked on the rear row's middle lane (or the nearest seat that seals no one in), rooms by weighted
dice, the best of three drafted formations, the first free offer, Command only for souls stuck on the bench,
free binds only, a line cohort for each captain, no orders, no promotions. **expert** plans: routes played
out (and a room it rehearses as a loss avoided while another is open), the formation (the Monarch's cell,
cohorts and orders included) hill-climbed over rehearsals and its best eight refought on fresh rolls, and
essence, Monarch points, muster, binds, offers and promotions weighed by rehearsing the fights ahead. A
rehearsal (either level's) ends once its result is settled: the Monarch alone with Arise spent and no one to
come (lost), or no foe to come, every foe standing being hit, and at the rate they are falling the party fells
them with 4 times the time to spare before the ceiling, while every blow the foes deal over that time could not
fell the Monarch 4 times over (won).

Add `?seed=anything` to the URL to play a given run; `retinue.run.state` is the run in the browser console.

## The rules of the sim

`src/sim/` is pure: no Phaser, no `Math.random`, no `Date`; all randomness comes from seeded streams in
`rng.js`. A run changes only through `apply(run, action)`; `legalActions(run)` lists every action `apply`
accepts now. Every action goes into `run.state.log`, and `replay(seed, log)` rebuilds the identical state.
Battles take no input: `fight` runs one whole, and `run.setup` lets the battle scene rebuild it with
`createBattle(run.setup)` to the same events.

| Phase | Actions |
|---|---|
| map | `node {id}` walk to a room |
| map, prep | `place {uid, slot}` (slot 0–48, or −1 bench; the Monarch is uid 0, never benched) · `level {uid}` · `upgrade {uid, path}` · `promote {uid}` · `monarch {stat}` (`dominion`, `command`, `will`) · `muster` · `cohort {uid, kind, count, shape}` (kind null clears) · `order {uids, plan}` new detachment, `order {id, plan}` re-plan, with `plan = { where: hunt\|stay\|move, square, when: { at: once\|time\|struck\|wave\|falls, t } }` · `disband {id}` |
| map, prep, reap | `release {uid}` (never the last soul, never the Monarch) |
| prep | `fight` |
| reap | `reap {index}` take an offer (recruit, relic, tier, keystone; one of each kind), `index: null` moves on · `bind {id, count}` |
| over | `descend` (only after the Sovereign, the Monarch standing) |

To turn a browser bug into a test, copy the run and replay it:

```js
copy(JSON.stringify({ seed: retinue.run.state.seed, log: retinue.run.state.log }))   // browser console
const run = replay(seed, log)   // in a test: the exact state; run.battle is the last battle
```

`replay` throws on the first action no longer legal, so it also shows when a change breaks an old run.

## Tests

`npm test` runs 238 tests in about 30 s, all in Node:

| File | Tests | Covers |
|---|---|---|
| `run.test.js` | 49 | `legalActions` per phase and refusals; placing, camps, release, altars, reliquaries, rites, essence, recruits, replay; the Monarch (seat, points, domain, death, wounds); the threat-variety rule; the army (muster, cohorts, banners and the reserve, fallen bodies, binding); orders and held detachments; both autoplayer levels; a strong run clearing floor 4; a 140-run fuzz of random legal actions with invariants and exact replay. |
| `battle.test.js` | 44 | Determinism, the step clock, flankers hopping bodies (and held by a braced line), the gauge cap, the tile index and caches, entries mid-battle, the ceiling, auras and bonds; Arise, shadows, faltering and the loss rule; the reserve and cohorts; the reaction rule, Stay, Move, the leash, held detachments and their starts. |
| `keystones.test.js` | 40 | Every trigger relic and keystone, their offers, the autoplayer weighing them, and their meetings with ranks, plans and each other; a soak of every keystone on real elites. |
| `endless.test.js` | 23 | The synergy steps, one test per 8-step rule on each side, the deep's formulas, descending, and a fuzz across endless floors. |
| `ranks.test.js` | 21 | Tier IV and second paths, clashes, promotion, the Knight's either-or, the Marshal's domain and banner, the autoplayer's promotions, a ranks fuzz. |
| `enemy.test.js` | 17 | Foe orders and flavour, sieges, room structure, late pairs and waves, foe cohorts, the Sovereign's tide and crumble, depth deaths, the ceiling from the last foe in. |
| `ablation.test.js` | 11 | The ablation harness: the un-ablated players' actions unchanged, each ablation taking its mechanic away (the Arise and synergy switches in battle), and the necessity refights (exact as recorded, each mechanic stripped). |
| `speed.test.js` | 4 | The measuring speed-ups: the progress score (1 for a clear, in [0, 1], rising with every room), a rehearsal that settles (same verdict, never a real fight), and the search's pruning (`'finalists'` exact, `'best'` fewer rehearsals). |
| `fixes.test.js` | 10 | The final pass's fixes: the Legion's board cap, Court of Bone's healers, the Monarch's stats, Crown entries, the Monarch's seat, route threats, scouted rehearsals, room dice, the ladder's measures. |
| `content.test.js` | 9 | Every reference resolves, every unit's pictures, paths, statuses, camps, banner shapes, orders. |
| `basics.test.js` | 8 | Formulas, RNG, formations, board shapes, bonds, camp placement. |
| `map.test.js` | 2 | Floor generation over 500 seeds. |

## Adding a unit

Add an entry to `UNIT_LIST` in `src/content.js` (stats, kin, role, abilities from `ABILITY_LIST`, spawn
weight, `threats`, `foeOrders` and a `flavour` that hints at them) and two or three paths of four tiers in
`PATHS`. Its `art` key names three pictures in `src/assets/units/`: `<art>.alive.svg`, `<art>.attack.svg`
(the alive pose re-posed at the instant the blow lands, feet in place) and `<art>.dead.svg` (its corpse,
readable at 38 px). The battle animates them in code (`src/engine.js`); there are no frames. Copy the
`tomb_knight` pictures and keep to their rules: a `0 0 96 96` viewBox (120 for heavyweights, 144 for the
boss) with the feet at 11/12 of the height, 3/4 view lit from the upper left, `#0d0a12` outlines, a pose that
works mirrored, no team colours, plain shapes and gradients only (no `<text>`, `<image>`, `<style>`, scripts,
filters or external references; prefix gradient ids). `test/content.test.js` checks the references, the
pictures and the unit count.

## Layout

```
index.html, serve.js   page shell; static server for npm start
src/
  main.js              boot: Phaser engine + DOM UI; every input becomes apply(run, action)
  content.js           all game data: units, abilities, paths, statuses, kin/roles, synergies, bonds, ranks,
                       shapes, orders, camps, relics, keystones, attack anims
  tuning.js            every balance constant
  sim/                 pure game logic, runs in Node
    run.js             the run: apply, legalActions, replay; the Monarch, the army, orders, ranks, encounters,
                       progression, rewards, the deep
    battle.js          a fight: tick loop, effects, AI and movement, the loss rule, Arise, the reserve, plans,
                       Marshals, triggers and keystones, waves, the court, the 8-step rules
    unit.js            stats, synergies, formations, bonds, the board and camp geometry
    map.js             floor generation
    rng.js             seeded RNG streams
    autoplay.js        the autoplayer, and the sim / ladder / decisions / ablations / necessity reports
  engine.js            Phaser, battles only: the battle scene and timeline player
  ui.js                DOM screens: title, map, prep and the camp editor, spoils, end
  codex.js             rules text generated from content and tuning: cards, tooltips, How to play (H)
  dom.js, style.css    element builder, tooltip, icons, prefs; styles
  assets/              unit pictures (three SVGs each), camp walls and floor
  vendor/phaser.js     Phaser 4.2.1 ESM build (MIT), vendored for offline play
test/                  see Tests
```

## License

GPL-3.0-or-later, inherited from the 2019 PyGame prototype (in git history at commit `377c703`).
`src/vendor/phaser.js` is Phaser 4.2.1 under the MIT License.
