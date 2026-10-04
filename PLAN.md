# RETINUE — a party autobattler shaped like Slay the Spire

## Context

`TopDownShooter` currently holds a small PyGame prototype (`main.py`, `classes.py`), deleted from the working tree but recoverable from `HEAD` (`377c703`): WASD move + arrow-key shoot, three hardcoded enemy types (chaser / grower / spawner), manual `rect.move_ip()` movement, one inline loop, no scenes, no data tables. The design intent survives; the code doesn't.

We're building a **roguelite party autobattler**: a 40-minute run down a branching dungeon where you choose the route, choose the spoils, choose who to cut, and spend a small budget of **Commands** to override your party mid-fight. Stack: **Phaser v4 for rendering, scenes, tilemaps, sprite animation and tweens; all game logic in plain JavaScript.**

Locked-in decisions:

| Decision | Choice |
|---|---|
| Simulation | **No physics.** Deterministic stat engine, scripted 2D attack animations |
| Presentation | Leader sprite walks a generated dungeon (Pokémon-style); encounters cut to a battle screen |
| Combat | **Real-time auto-battler** — per-unit cooldown gauges |
| Party | **Up to 12 units in a 3×4 formation grid**, all fighting |
| Acquisition | **Weaken-then-persuade** — recruit enemies mid-fight, at the cost of a Command |
| Control | **You command; you never pilot.** Units act on standing orders; you spend Commands to override, and every between-fight decision is yours (§4) |
| Currency | **One: Coin.** Earned in-run, spent in-run, gone at run end. Nothing accumulates across runs but knowledge (§5) |
| Structure | Roguelite runs + an **Ascent** difficulty ladder. Prestige makes the game harder; it never makes you stronger |

### The one architectural rule everything else hangs off

> **Combat resolves entirely in pure JS. The sim emits an ordered event timeline. Phaser plays that timeline back. Animation never feeds back into resolution.**

Damage is an explicit, computed field — not an emergent property of anything visual. This is the direct answer to the concern about physics-style bugs: the renderer is a *player* for a result that has already been decided. Three things fall out of it for free — deterministic replays, headless simulation with no renderer at all, and a speed control that is literally "play the timeline faster."

> **Amended by the Command system (§2.6), and the rule survives intact.** A player command is not a control loop reaching into resolution — it is a **tick-stamped input** appended to a queue that `resolveTick` drains at a tick boundary, exactly as it drains the RNG. Resolution still reads only `(state, rng, inputs)`; animation still feeds back nothing. What changes is that the timeline is produced *incrementally* rather than in one batch, so the player can see tick 40 before tick 41 is decided. `{seed, modset, doctrine, commands[]}` still reproduces a run exactly — §14's replay format already had an `inputs: []` field waiting for this.

---

## 1. The loops

> **Superseded — the idle frame.** This section used to have four loops, the outermost two of which
> were an incremental game: bank Residue, spend it on a permanent tree, prestige for a multiplier,
> and accrue offline while not playing. All of that is gone. **Nothing carries a number out of a
> run.** What carries out is the Codex — *which species you have met* — and the Ascent, which is a
> difficulty number that only ever goes up against you. The loops below are three, and the outermost
> one contains no arithmetic at all.

```
┌─ LOOP C — META (across runs) ──────────────────────────────────┐
│  Codex widens the pool · Ascent raises the difficulty          │
│                          ▲                    │                │
│              what you have met            a harder run         │
│                          │                    ▼                │
│  ┌─ LOOP B — RUN (35–55 min) ───────────────────────────────┐  │
│  │  Floor 1 → 2 → … → 8 · choose the route · spoils · boss  │  │
│  │                    ▲              │                      │  │
│  │              battle won      you pick the next room      │  │
│  │                    │              ▼                      │  │
│  │  ┌─ LOOP A — ENCOUNTER (60–100 s) ───────────────────┐   │  │
│  │  │  Walk to the room → battle screen → auto-battle,  │   │  │
│  │  │  spending Commands → spoils: pick 1 of 3          │   │  │
│  │  └───────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

**Loop A — The Encounter (60–100 s).** The leader sprite walks the tile dungeon to the room you chose. Entering it cuts to the battle screen: two 3×4 formations, real-time gauges, scripted attack animations. The party fights on its standing orders and you watch it, with 3 **Commands** to spend and a pause key. Win, then pick 1 of 3 **spoils**. About 30–45 s of that is the battle; the rest is the two decisions bracketing it.

**Loop B — The Run (35–55 min).** Eight floors. Each floor is a branching one-way map of ~14–18 rooms of which a single path visits **6–8** — so roughly 55 rooms per run, and every one of them was chosen instead of two others. Recruit, cut, re-form, shop, boss. Ends in a party wipe or in killing the floor-8 boss.

**Loop C — The Meta.** Two things persist, neither of them a number you spend. The **Codex** records every species recruited, Pact triggered and boss killed, and widens the pool of what can turn up in future runs — breadth, never power. The **Ascent** is the difficulty ladder unlocked by winning: each rung names one rule change that makes the game harder (§5.3).

> **What was Loop D — offline accrual — is deleted, not deferred.** It required a run to be worth a number, and runs are no longer worth numbers. The Web Worker survives for two jobs that are not idle: the post-mortem's counterfactual re-sim (§4.5) and `tools/balance.js` batch runs.

---

## 2. Combat

### Tick model

Fixed logical tick of **20 Hz (50 ms)**, fully deterministic, driven by a seeded PRNG. Nothing in combat reads wall-clock time or frame delta.

> **Every constant in this section lives in `packs/core/content/tuning.json`, and that file is the authority.** The numbers written here are the current values, kept in sync by hand; where they disagree, `tuning.json` wins. Two of them were changed by measurement after the first battles ran — see the notes below.

Each unit carries an action gauge:

```js
gaugeRate      = GAUGE_BASE + spd / GAUGE_SPD_DIV   // 1.6 + spd/25, gauge units per tick
actionAt       = ability.castCost                    // gauge needed
```

When a unit's gauge fills, its policy picks an ability and a target, the sim resolves it, and it emits events. Gauge resets minus overflow.

**Revised from `1 + spd/100` (measured).** That formula put the first action of every fight at tick 80 — four dead seconds before anything happened — and compressed the whole roster's SPD into a 23% spread, making the stat nearly invisible. `1.6 + spd/25` opens at 32–48 ticks and gives SPD a ~50% spread.

**When the chosen ability is unaffordable, the unit banks its gauge and waits.** It does *not* fall through to a cheaper ability. This is load-bearing: silent fall-through means a unit only ever casts its cheapest ability, and every expensive ability in the game becomes dead data. Falling back is opt-in per rule, via an explicit `ELSE` in the Ability doctrine.

### Damage — an explicit formula, deliberately boring and tunable

```js
hitChance = clamp(0.10, 0.95, ACC_a / (ACC_a + EVA_d))
isCrit    = rng() < clamp(0.01, 0.60, CRT_a / 100)
raw       = ability.power * (ATK_a / ATK_DIVISOR)    // divisor 28, not 10
mitigated = raw * (100 / (100 + DEF_d))
elemental = AFFINITY[ability.element][d.element]     // 0.5 | 1.0 | 1.5
escalated = mitigated * elemental * escalation(t)    // see anti-stall, below
damage    = max(1, round(escalated * (isCrit ? CRIT_MULT : 1) * variance(rng)))
```

`variance` is `0.95–1.05` drawn from the seeded RNG; `CRIT_MULT` is 1.75. Every term is a named field on a data object. There is no hidden state and no float accumulation across ticks — damage is integer at the point of application, and floored at 1 so a hit is never a no-op.

**Revised from `ATK/10` (measured).** At 10, units died in two hits — so nothing was ever alive *and* below the 30% persuade threshold, and §2's own acquisition mechanic was unreachable by construction. The damage curve and the persuade threshold are a single coupled decision, not two independent knobs. Swept to 28: a kill takes ~5 hits and battles land at ~19 s on floors 1–2, rising to ~32 s by floor 4.

> **The target band moved, and the measurement did not.** §1 used to ask for 15–40 s because a run was 20 minutes long and mostly fast-forwarded; §19's balance harness recorded floor-4 battles at 32 s with a p90 of 52 s and filed it as a *miss*. Under a watched fight with three Commands to spend, 19 s is the miss — it is not long enough to notice a bad matchup, let alone answer one. **The band is now 30–60 s**, and the open balance question inverts: floors 1–2 are too short and want either tougher openers or a lower `atkDivisor` early. Nothing about the formula changes; the number it was being judged against does.

### The affinity matrix

Six elements. Each beats one and resists itself; everything unlisted is 1.0. Physical is neutral both ways — it's the floor that unelemented content sits on.

| Attacker ↓ | physical | fire | frost | arcane | dark | holy |
|---|---|---|---|---|---|---|
| **physical** | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| **fire** | 1.0 | **0.5** | **1.5** | 1.0 | 1.0 | 1.0 |
| **frost** | 1.0 | 1.0 | **0.5** | **1.5** | 1.0 | 1.0 |
| **arcane** | 1.0 | **1.5** | 1.0 | **0.5** | 1.0 | 1.0 |
| **dark** | 1.0 | 1.0 | 1.0 | 1.0 | **0.5** | **1.5** |
| **holy** | 1.0 | 1.0 | 1.0 | 1.0 | **1.5** | **0.5** |

Fire/frost/arcane form a rock-paper-scissors triangle; dark/holy are a mutual pair. 2.0 is deliberately unused at core — it's left as headroom for mods and for a later boss mechanic, because a 2× swing on top of the row modifiers is already most of a one-shot.

### Anti-stall — bounded by construction, not by balance

§10 originally treated a battle that never ends as a bug to *detect* with a tick ceiling. It isn't a bug; it's structural. Any two sides that both field sustained healing deadlock, and detection doesn't help — you still have to decide what happens.

```js
escalation(t) = min(ESC_MAX, 1 + max(0, t - ESC_START) * ESC_PER_TICK)   // 1 → 8 from tick 700
```

Every point of damage in the fight is multiplied by this. Nothing happens for the first 35 seconds, so it is invisible in a normal battle; past that, mutual immortality decays into a decision within a few seconds. Battles are bounded **by construction**. The tick ceiling stays, demoted to what it always should have been: a fuzzer assertion that the escalation is working (§18.11 asserts stalls stay under 2% of 10k battles).

### The 3×4 formation grid

Twelve slots, **3 rows deep × 4 columns wide**, mirrored for the enemy side. Position is a first-class mechanic:

| | Effect |
|---|---|
| **Front row (0)** | Melee reach. Draws ~60% of single-target aggro. +10% damage dealt with melee. |
| **Mid row (1)** | Reachable by melee only when the front row is empty. Neutral. |
| **Back row (2)** | −30% damage taken from melee, −25% damage dealt with melee. Ranged/magic unaffected. |

Ability shapes read directly off the grid, which is where most of the tactical depth comes from cheaply:

- `single` — one slot
- `column` — a whole column (front-to-back pierce)
- `row` — a whole row (sweep)
- `adjacent` — target + orthogonal neighbours (splash)
- `all` — everything
- `slot(n)` — a fixed slot index, ignoring rows (snipe the back line)

Melee abilities can only reach the enemy's frontmost occupied row. That single rule makes "who goes in front" a real decision every time you recruit.

**Aggro is a weighted roll, not a threat table and not a hard filter.** Each candidate target carries a weight of `0.6 / 0.3 / 0.1` by row; the sim draws from that distribution on the `combat` RNG stream. Three reasons over the alternatives: a threat table needs per-unit accumulating state (which the save then has to carry), a hard filter makes the back row literally unreachable and deletes half the Targeting editor, and a weighted roll composes with Doctrine cleanly — a Targeting rule *reorders candidates*, and aggro weights the draw among equals. A rule that names an exact target overrides the roll entirely; that's the point of writing one.

### 2.6 Commands — the reason to watch

An autobattler where the correct play is to look away has a presentation problem it cannot fix with art. The party fights on its standing orders (§4); **Commands are how you overrule them, and they are the only input combat accepts.**

```
commands per battle = CMD_BASE (3) + modifiers          // a stat path, so items and Banners move it
```

Three per battle, refilled at every battle start, never banked between fights. Spending one issues an order that takes effect **at the start of the next tick**:

| Command | Cost | Effect |
|---|---|---|
| **Focus** ⟨target⟩ | 1 | Every ally retargets that unit for `FOCUS_TICKS` (120 = 6 s), overriding Targeting rules and the aggro roll |
| **Parley** ⟨target⟩ | 1 | The next ally to fill its gauge attempts persuade on that unit instead of acting |
| **Brace** ⟨ally⟩ | 1 | That unit drops one row back if a slot is free and takes `BRACE_MIT` (−40%) for `BRACE_TICKS` |
| **Unleash** ⟨ally⟩ | 1 | That unit's gauge fills immediately and it casts its most expensive affordable ability |

Four verbs, chosen because each answers a different way a fight goes wrong — the wrong target, the missed recruit, the front-liner about to die, the ability that never became affordable — and because each one is expressible in ops the kernel already has (`taunt` / `mark`, `persuade`, `move_slot` + `apply_status`, `gauge`). **A Command registers as content**, so a mod's Banner can add a fifth.

Five properties, and each is doing work:

**A Command is an input, not a control.** It is stamped `{tick, verb, args}` and appended to a queue; `resolveTick` drains the queue for tick *t* before it fills a single gauge. There is no path by which the renderer computes anything the sim consumes — it relays a gesture. This is the whole of §18.15 restated for a game that now takes input, and it is why determinism survives (§18.17).

**Pause is free and unlimited.** You may pause at any time and issue Commands while paused; they still land on the next tick. Deliberation is not the scarce resource — Commands are. A game that charged for thinking time would just be punishing slow readers, and would make the speed control a difficulty setting.

**Speed is ×1 · ×2 · ×4, and it is comfort, not throughput.** At ×4 you will spend your Commands worse; that is the entire cost and it is self-inflicted. There is no ×8, no skip-to-result, and nothing in the game rewards not watching — which is the difference between this and the version of the plan that had an offline loop.

**Scarcity is what makes the Doctrine worth writing.** Three Commands against a 40-fight run is ~120 interventions for ~400 decision points. The rest run on standing orders, and every rule you write is a Command you no longer have to spend on the same mistake. **That is the design's central exchange rate**, and it replaces the old one — a self-playing game where policy was the only interaction, so policy had to carry all the interest by itself.

**Unspent Commands pay out.** A battle won with Commands in hand pays `CMD_UNSPENT_COIN` (8) per Command into the run's Coin. Without it the dominant strategy is to dump all three on the first trash fight, since they do not bank; with it, holding them is a small live bet that the fight is already won.

### Recruitment — weaken then persuade

Persuade is an **action a unit spends its gauge on**, not a post-battle roll. The target must be alive and below the persuade threshold (default 30% HP). **Every attempt costs a Command** — whether you issued it or a Parley rule in your Doctrine did.

> **The Command cost is the fix for a measured failure, not a flourish.** §19's harness recorded a mean of **61 recruits per 8-floor run** into a 12-slot party — roughly fifty automatic cuts, which is a conveyor belt and not the decision §2 claims it is. Gating persuade on the Command budget caps attempts at 3 per battle *and* prices them against Focus and Unleash, so a parley is a thing you gave something up for. Target: **≤ 12 attempts per run**, which is the number to re-measure when this lands.

```js
chance = BASE[enemy.tier]
       * (1 + charm / 100)                  // party-wide Charm stat
       * (1 + 2 * (1 - enemy.hpPct))        // the weaker, the better
       * kinAffinity(party, enemy.kin)      // sharing a Kin tag helps
       * itemMods
       * 0.7 ** enemy.persuadeAttempts      // each failure hardens them
```

`BASE[tier]` — the term that decides whether recruiting is a decision or a formality:

| tier | 1 | 2 | 3 | 4 | 5 | unlisted |
|---|---|---|---|---|---|---|
| **BASE** | 0.15 | 0.11 | 0.08 | 0.05 | 0.03 | 0.09 |

These look low in isolation and aren't, because the weaken bonus multiplies by up to 3×: a tier-1 enemy sitting exactly at the 30% threshold is ~36%, and one taken to 5% HP is ~44%. With `decay = 0.7`, a second attempt on the same target is ~25% and a third ~18%, so persuading is a real spend of actions you could have used to kill it. Final chance is clamped to 0.9 — nothing is ever a certainty. `kinAffinity` is 1.25 when the party already holds the enemy's Kin, else 1.0.

**`kinCount` counts the roster, not the survivors.** A Recruit rule like `kinCount(Drake) < 4` is a statement about the party you are *building*; counting only the units currently standing makes a party that is losing a fight suddenly eager to recruit a fifth Drake it already owns four of. Every count predicate in the Recruit editor reads the roster. Predicates about the fight in progress (`allies.alive`, `enemy.count`) are separate forms and say so in their names.

Success: the enemy leaves the fight and joins the party. Failure: the action is spent, no damage dealt, resistance rises.

**A recruit joins at the HP it was persuaded at, at the party's median level, in the frontmost free slot its Role's auto-fill rule allows** (§4 Formation). Joining at full HP would make persuade strictly better than killing; joining at level 1 would make every recruit past floor 2 worthless and quietly kill the acquisition loop the deeper you go. Median level is the compromise that keeps a late recruit playable without making it a reward for having been weak.

That's the tension the whole acquisition loop rests on — **you have to stop killing something while it's still hitting you**, and now you have to pay a Command to do it, in a fight you are watching, against a target that is about to die to the swing you could have let land.

**Party full at 12?** A successful persuade on a full party does not silently cut anybody. The recruit is held and offered at the **spoils screen** as a swap-or-decline: the new unit beside the one your Doctrine's cut rule nominates, and you take it or you don't. The Doctrine still names the nominee — that is what stops the screen asking you to compare against eleven — but the last word is a click. **Every recruit past 12 is a decision about what you're willing to lose**, and that sentence is now literally true rather than aspirational.

---

## 3. Units, tags and builds

### Two tag axes

Every unit carries one **Kin** and one **Role**. Synergies count distinct units holding a tag — this is the TFT-shaped trait engine, and with 12 slots it has room to breathe.

| Kin | Beast · Undead · Construct · Fae · Insect · Drake · Humanoid · Aberration |
|---|---|
| **Role** | Vanguard · Skirmisher · Ranger · Channeler · Warden · Trickster |

Thresholds: Kin at **2 / 4 / 6**, Role at **2 / 3 / 4**. Twelve slots means a 6-Kin monobuild costs half your party — real opportunity cost, not a free stack.

### Three layers of synergy

**1. Resonance** (automatic). `Undead 4` → allies revive once at 25% HP. `Ranger 3` → back row ignores the melee damage penalty. Emergent, always on.

**2. Pacts** (named, discoverable). Cross-axis recipes with codex entries — the "what does THIS do with THAT" moments:

- `Undead 4 + Channeler 3` → **Grave Choir** — every ally death empowers all Channelers for the rest of the fight.
- `Drake 2 + Vanguard 3` → **Scaled Wall** — front row reflects 20% of melee damage.
- `Fae 4 + Trickster 2` → **Glamour** — persuade threshold rises to 60% HP.
- `Construct 6` → **Assembly Line** — a destroyed Construct rebuilds next battle at full HP.
- `Insect 4 + Skirmisher 3` → **Swarm Logic** — each Insect grants every other Insect +4% gauge rate.

Ship ~12 Pacts at first playable, target ~30.

**3. Coherence.** Tag-concentration entropy across the party — **inverted normalised Shannon entropy, computed per axis and averaged**:

```js
score(counts) = 1 - H(counts) / log(distinctTags)      // H over p = count/partySize
coherence     = (score(kinCounts) + score(roleCounts)) / 2      // 0 … 1
```

Normalising by `log(distinct)` rather than `log(partySize)` is the choice that matters: it measures how concentrated you are *among the tags you actually brought*, so adding a 12th unit of a Kin you already run doesn't get diluted by the tags you don't. A single-tag party scores 1; an evenly spread party scores 0. Averaging the two axes means you can buy coherence on either one, which is what keeps both Kin-stacking and Role-stacking viable.

**What coherence pays, now that Residue is gone.** It was a multiplier on a banked meta-currency, which was its only consumer; with the Lattice deleted (§5) it needed an in-run one or it was dead arithmetic. It has two:

- **Coin from a won battle scales `1 + COH_COIN × coherence`** (0.6). A focused party loots better, which is felt inside the run that earned it rather than at a screen afterwards.
- **It is a live readout** on the party panel — one number that tells you what your last four recruits did to your build's shape. That readout is most of why the stat is worth computing at all: it makes "am I actually building toward something" answerable at a glance, mid-run, at the moment a spoils screen is asking you to widen.

The counter-strategy that **Dissonance** nodes used to sell is now a **Banner** (§5.2): *Motley* inverts the term, so breadth pays and concentration doesn't. Two viable strategies, neither dominant, and the choice between them is made at run start instead of bought once and never revisited.

### Per-unit progression — XP and levelling

> This is the feedback loop that closes the run. Without it, foes scale with floor depth and the party doesn't, so every run ends on floor 2 no matter how well it was assembled. **It is the highest-priority unbuilt system.**

```js
xpFromKill    = 4.5 * enemy.tier * (1 + 0.35 * (enemy.lvl - 1))   // per participant
xpFromRecruit = xpFromKill * 0.5        // you gave up the kill; you got the unit
xpToNext(lvl) = round(28 * lvl ** 1.45)      // 28 · 76 · 138 · 209 … cumulative ~2.8k to 10
levelCap      = 10 + 5 * (star - 1)          // ★1 caps at 10; fusion is how you raise it
```

Award rules, each of which is a decision the plan previously left open:

- **Every participant earns the full value — it is not a pool split by headcount.** This is a correction to an earlier draft of this section, and the reason matters: dividing a fixed pool means each new recruit slows down everyone already on the roster, so a 12-unit party levels three times slower than a 4-unit one and the party cap becomes a trap. Levelling would be pulling directly against the acquisition loop the whole game is built on.
- **Participation, not kill credit.** Everyone who was on the field earns the same, at `xp.mult` (a modifier path, so items and Banners can move it). Kill-credit XP would let the party's best unit run away with the run and would punish the front row for doing the job the formation grid asks of it.
- **The fallen get half.** Not zero — a unit that died holding the line still learned something, and zeroing it compounds one bad fight into a unit that can never catch up.
- **A lost fight still pays** for whatever it killed on the way down.
- **Recruits arrive at the party's median level** (§2) and earn from that point normally. They are behind, not hopeless.
- **Levelling restores nothing.** HP stays where it was as a fraction of the new maximum. Levelling as a stealth heal would collapse the between-encounter recovery budget below.
- **XP past the cap is banked, not discarded.** The day fusion raises the cap, the levels already earned are waiting.

Measured over 20 seeded runs against the real spawn tables, the party's median level after each floor is `2.5 · 4.2 · 6.0 · 7.0 · 7.8 · 8.8` against foes at `1 · 3 · 4 · 6 · 7 · 9` — ahead through floor 5, behind by floor 7, which is precisely where fusion stops being optional. The rate barely moves survival (13/20 runs reach floor 4 at every rate swept from 3 to 5), because early deaths happen on floors 1–3 before any XP has accumulated: **`perTier` sets the shape of the curve, not the difficulty.**

Stats follow §3's existing `base + growth × (lvl − 1)` — already implemented in `party.js`, and already the single place that formula is written down. What's missing is only the XP *source*.

At **level 5 and level 10** each unit picks 1 of 2 branch choices (data-driven, ~2 per unit). Light enough not to become a second game, deep enough that the same species recruited twice can end up different. **The pick is a prompt on the spoils screen**, taken by the player, at the moment it is earned.

> **Twice superseded, and this is the version the reframe makes obvious.** The original text said "a Doctrine rule, not a prompt — a modal would break the never-touch-the-controls rule". §4.1 then refined that to a default-plus-Precedent and made it the sixth Discipline, **Succession**. Both were solving a problem that no longer exists: there are no controls to break, and the game now stops and asks the player things by design. A branch pick is one of the best questions the game has — it is concrete, it is about a specific unit you watched earn it, and it is exactly one of two options. It joins the spoils screen, **Succession is retired as a Tenet**, and §19's debt 15 — "a panel with nothing to prefer" — is deleted rather than repaid.

**Fusion**: two units of the same species merge into one at +1 star, freeing a slot. This is the pressure valve for a hard party cap and a genuine long-term goal.

### Data shape

Units, abilities, items and Pacts are all pure data — **literally JSON files, not JS modules** (§16.1):

```json
// packs/core/content/units.json
{ "id": "core:bone_chanter", "name": "Bone Chanter",
  "kin": "Undead", "role": "Channeler", "tier": 2,
  "base":   { "hp": 78, "atk": 14, "def": 6, "spd": 22, "acc": 40, "eva": 12, "crt": 5 },
  "growth": { "hp": 9, "atk": 2.1, "def": 0.6, "spd": 1.2 },
  "abilities": ["core:dirge", "core:marrow_bolt"],
  "art":  { "descriptor": "core:bone_chanter", "attackTemplate": "core:cast_beam" },
  "branches": [ { "at": 5,  "opts": ["core:echo", "core:resonance"] },
                { "at": 10, "opts": ["core:requiem", "core:ossify"] } ] }
```

Note `art.descriptor` rather than `art.sheet`: the sprite sheet is **generated** from a descriptor and baked to disk ahead of time (§15), so adding a unit never means commissioning art.

Target ~40 units at first playable, ~120 at scale. Item mods use `{path, op, v}` triples applied in fixed order (`set` → `add` → `mul` → `clamp`) so stacking is order-independent.

---

## 4. The Doctrine — standing orders, and the decisions around them

> **Superseded a third time, and this one is a demotion rather than a rebuild.** Everything below
> was written under a premise that no longer holds: *the player never touches the controls, so
> authoring policy is the only interaction there is.* That premise made the Doctrine carry the whole
> game, which is why this section grew five editors, then six learned panels, then a priced shop of
> capabilities — three attempts to make one screen interesting enough to be a game by itself.
>
> It isn't one any more. The player now chooses the route, the spoils, the cuts and the branches, and
> spends Commands mid-fight (§2.6). **The Doctrine's job shrinks to what it was always best at:
> deciding the four hundred things per run that are not worth asking about.** Standing orders. What
> the party does when you are not overruling it.
>
> That demotion is a promotion in disguise, because it fixes the thing three redesigns could not:
> **a rule is now worth writing for a reason the player can feel** — every rule that works is a
> Command they get to keep for something that matters. Before, a rule competed with nothing.
>
> | | Was | Is |
> |---|---|---|
> | **Doctrine's role** | the entire interaction surface | standing orders between interventions |
> | **What a rule is worth** | asserted | one fewer Command spent on a repeat mistake |
> | **How a Tenet is acquired** | bought from a profile-persistent Codex shop | **picked 1-of-3 in the run, or bought with Coin at a merchant** (§5.1) |
> | **How long a Doctrine lasts** | forever, across all runs | **the run** — with saved loadouts as a convenience, never as power |
> | **Dispatches** | the main way you learned what your policy did | a lighter post-battle line, because you were watching |
>
> The machinery is untouched for the third time: the chip editor, the validator, the fire counts, the
> expr trees, the capability pricing and the export string are the same files. What moved is *when
> the player is asked* and *how much rests on the answer*.

**Where the player actually plays, restated for the whole game:**

| Decision | When | Blocking? |
|---|---|---|
| **Which room** — 2–3 forward exits, one-way | every node (§6) | yes |
| **Spoils** — 1 of 3: item · ability · Tenet · Coin · heal | after every won battle | yes |
| **Swap or decline** a recruit into a full party | when a Parley lands at 12 units | yes |
| **Branch** at level 5 and 10 | when a unit earns it (§3) | yes |
| **Commands** — Focus · Parley · Brace · Unleash | 3 per battle, live or paused (§2.6) | no — the fight continues |
| **Doctrine** — write, reorder, retire a rule | any campfire, any pause | no |
| **Banner** — one of three run-shaping keystones | run start (§5.2) | yes |

The blocking ones are the game's spine and are *deliberately* blocking, which is the exact inversion of the invariant §4.1 used to hold most sacred. That invariant existed to protect the offline loop; the offline loop is gone, and what it was protecting against — a game that stops and asks you things — is now the point. What survives of it is narrower and still absolute: **the sim never waits. `resolveTick` is pure and synchronous forever.** The *run loop* waits, at named choice points, through an interface with a headless implementation (§4.6).

The rest of this section is what the Doctrine is and how it is edited, which the reframe leaves standing.

> **Superseded — the five-editor tab.** M3 shipped what this section asked for: five editors behind a `tab` key, each a list of empty rule slots on minute one, all five available immediately. It works, it is fully authored, and it is the wrong shape. Everything the player does is filed away in a settings screen they have to know to open, know to read, and know what to write in — and the moment of maximum interest, *the thing that just happened in front of them*, is exactly the moment the design routed them away from. A self-playing game that hides its only interaction behind a tab has hidden the game.
>
> The replacement keeps every piece of M3's machinery — the chip editor, the validator, the fire counts, the expr trees, the export string — and changes two things: **when a rule arrives, and how many surfaces exist at all.** Nothing below asks for M3's work back.

Two nouns replace "five editors":

| | What it is | Where it comes from |
|---|---|---|
| **Discipline** | One named policy capability, with its own panel. Six of them. | Learned through play, one at a time |
| **Precedent** | An event: *this just happened, and nothing you wrote had an opinion about it.* Answering one writes a rule. | Raised by the sim, queued, never blocking |

A player who never opens a panel still has a Doctrine, because Precedents wrote it. A player who wants to author directly still can, because the panels are the same panels. **The Doctrine is the accumulated answer to every Precedent you have taken a position on**, and the panel is where those answers live rather than where they are born.

> **On the word "skill".** These are skills in every sense that matters — learned capabilities, each with a panel, unlocked as you go. They are called Disciplines only because `ability` already owns "skill" throughout `packs/core/content/` and in every unit's menu, and two things called skills in one UI is a naming bug that costs more than a synonym.

**Design rule (unchanged, and now enforceable):** every wipe must be attributable to a Doctrine line, and the post-mortem names it. What changes is that the line is now one the player consciously set, at a moment they remember, rather than one they typed into an empty list on minute one.

> **Superseded again, and this time by playing it — the Precedent and the Discipline.** §4.1–4.3
> below were built and shipped. They fixed M3's timing problem: a rule arrived attached to something
> that had just happened, instead of being typed into an empty list on minute one. What they did not
> fix, and quietly made worse, is *who was deciding*. A Precedent named the pattern **and** the fix,
> so the player's move was to approve a suggestion; and the thing it handed over for free was a whole
> panel — twelve pins, thirteen targeting modes, an expression editor — which is not a choice anybody
> can reasonably evaluate, only a room they are shown into. **The most consequential decision in the
> game, what you are able to say at all, was being made by the game.**
>
> The replacement splits the two halves and gives the second one to the player:
>
> | | Was | Is |
> |---|---|---|
> | **What you can say** | a Discipline, offered by a Precedent when it noticed you struggling | a **Tenet** — one narrow named power, priced in Codex, browsed and bought |
> | **What just happened** | a Precedent: the fact, the fix, and a button that writes it | a **Dispatch**: the fact, and nothing else |
>
> A tenet is *Parley threshold*, *Pin a unit*, *Mark by threat*, *What to walk past* — each one a
> sentence about what you could then say, each priced at 2–3 Codex against a shop that costs about
> three times what the game can currently pay for. So the list cannot be finished, and what you buy
> is an argument about how you want to play. A dispatch reports that three enemies went under the
> threshold and died, and stops; the response is yours to deduce and yours to buy.
>
> **What survives unchanged**, because none of it was the problem: the signal ledger of §4.3 (a
> dispatch is its only reader), the chip editor, the validator, the fire counts, the expr trees, the
> export string, and the rule that nothing ever blocks or waits. Everything below stands as the
> record of a shape that was built, played, and found to be answering its own questions.
>
> Two consequences worth stating, because they are the load-bearing ones:
>
> * **The chip menu is now as small as your purchases.** §4.4's dropdown is generated from every
>   registered form, which meant thirty on day one; it is now generated from the forms your tenets
>   grant, which is *none* on day one and *two* after the first purchase. Measured in the browser:
>   23 options before, 3 after.
> * **The shipped rules moved out of the player's list.** `DEFAULT_DOCTRINE.recruit` used to hold
>   three pre-written rules, so a freshly-bought panel would open showing three rows nobody wrote.
>   They are `STANDING_ORDERS` now — how a competent retinue behaves with no orders, run *after*
>   whatever you wrote, shown in the panel and not editable at any price. What a slot buys is the
>   right to be heard first, which is a proposition a player can actually evaluate.

### 4.1 Precedents — the decision arrives as an event

A Precedent is raised **after** the thing happened, and it shows what the default did:

```
┌ PRECEDENT ───────────────────────────────── floor 2 · node 7 ┐
│  A Frost Sprite dropped to 22% and the party killed it.      │
│  Three have now gone down under 30% and none was approached. │
│                                                              │
│  ▸ PARLEY with Fae below 30%            → Parley, rule 1     │
│  ▸ PARLEY with anything below 25%       → Parley, rule 1     │
│  ▸ Keep killing                         → Parley, rule 1     │
│                                                              │
│  taking no position leaves the default            [ later ]  │
└──────────────────────────────────────────────────────────────┘
```

Five properties, each of which is load-bearing and each of which is a thing the tab model could not do:

**It names the concrete thing that happened.** Not "configure your recruit policy" but "three Fae went down under 30%". The player is reading a fact about their own run, not a form field. This is the entire reason it works as onboarding: §4.4's chip menu is a *language*, and a language taught one word at a time in a sentence you already care about is not the same object as a language handed over as a dictionary.

**Every option is a real rule, previewed in the panel's own notation.** Answering is `discipline.rules.unshift(offer.rule)` and nothing else — there is no rule *generation*, no templating, no natural-language-to-expr step. The offer literally contains the expr tree it will insert. So the Precedent card and the panel row show the same chips, and the player who later opens the panel recognises what they see.

**"Keep doing what you did" is a real answer, and it writes a real rule.** Otherwise the same Precedent fires forever and the game nags. Declining to change something is a position, and it gets stored as one.

**It never blocks.** The run does not pause, the default already fired, and an unanswered Precedent sits in a queue. This is not a courtesy — it is what keeps §1's loop D intact, because a headless run in a Worker with no UI at all has to be able to raise Precedents into the same queue and take the default for every one. **If a Precedent could block, the game could not run offline**, and that single consequence is why "non-blocking" is an invariant rather than a preference.

> **This paragraph is the one piece of §4.1 that is now actively wrong, and the reasoning is worth
> keeping because it shows how a good argument outlives its premise.** Loop D is deleted, so the
> consequence it rests on has no force — and the game *does* stop and ask you things now, six kinds
> of thing (see the table above). The correct residue of the argument is §4.6: **headless play still
> has to answer every question**, which is solved by giving the run loop a `chooser` interface with a
> scripted implementation, not by refusing to ask. Dispatches themselves stay non-blocking, because a
> report is still a report.

**It is retroactive, never predictive.** A Precedent fires after the fact and changes the *next* forty times. A prompt that fires before — "the boss is at 20%, attack or persuade?" — is a different thing entirely, and it stays banned. That is the line §1 draws, and it is worth stating as a test rather than a vibe:

> **A Precedent is an input into the policy, not into the game.** The test is two questions: *does the run wait for it?* and *would the same answer have to be given again next time?* A Precedent answers no to both. Anything that answers yes to either is a control, and this game does not have controls.

> **This game does have controls.** The boxed test above is a good test that was being used to enforce
> a bad rule — it is still the right way to sort *a policy input* from *a control*, and the game now
> deliberately has both. The route pick, the spoils pick and a Command all answer "yes" to at least
> one question and all of them stay. What the test is genuinely useful for from here is keeping the
> two kinds honestly separated: **if a screen asks the same question every run, it belongs in the
> Doctrine; if it asks about something that happened once, it belongs in the run.** §4.2's amendment
> applies exactly that to route and branch picks, and moves both.

§3 previously wrote the branch pick as "a Doctrine rule, not a prompt — a modal would break the never-touch-the-controls rule". That was the right instinct and the wrong conclusion: what breaks the rule is *waiting for an answer*, not *asking a question*. A level-5 branch that was taken by default and can be reconsidered afterwards is a Precedent, and it is now the sixth Discipline.

**Precedents are content.** A pack ships one exactly as it ships a Pact:

```json
// packs/core/content/precedent.json
{ "id": "core:first_parley", "discipline": "core:parley", "prio": 10,
  "when": ["and", ["gte", ["signalCount", "recruit:missed"], 3],
                  ["eq", ["ruleCount", "core:parley"], 0]],
  "once": "profile",
  "title": "Three walked away",
  "body": "{signalCount:recruit:missed} enemies went below the persuade threshold and died anyway.",
  "offers": [
    { "label": "PARLEY with Fae below 30%",
      "rule": { "when": ["and", ["eq", ["kin", "$target"], "core:fae"],
                                ["lte", ["hpPct", "$target"], 0.3]],
                "action": "persuade", "at": 0.3 } },
    { "label": "PARLEY with anything below 25%",
      "rule": { "when": ["lte", ["hpPct", "$target"], 0.25], "action": "persuade", "at": 0.25 } },
    { "label": "Keep killing",
      "rule": { "when": true, "action": "kill" } } ] }
```

`when` is an expr tree, so it is the same evaluator as everything else (§11.6) and a pack's Precedent needs no UI work. `once` is `run` · `profile` · `never`, which is the whole cooldown model — a Precedent that can fire twice a run is a Precedent that will.

**The queue is capped and Precedents expire.** An unanswered queue of forty cards is a chore, and a chore is what a tab already was. Cap it (~5 shown, highest `prio` first), expire anything older than a run, and let a dismissed one return only if its `when` is still true next run. The design failure to avoid here is precise: **a Precedent the player ignores must cost them nothing**, or the game has quietly reintroduced a thing you must attend to.

~~**On returning from offline (§1 loop D), the queue is the report.**~~ *Deleted with loop D. There is no away, and no number to come back to; the end-of-run report is the post-mortem (§4.5), which a player reaches by playing.*

### 4.2 Disciplines — six panels, learned one at a time

| Discipline | Was | Decides | Typically learned |
|---|---|---|---|
| **Marching Order** | Formation | Who stands where; auto-fill by Role | run 1 |
| **Focus** | Targeting | Which enemy, in what priority | run 1–2 |
| **Parley** | Recruit | Who to talk to, who to cut, when to decline | run 2–3 |
| **Field Orders** | Ability | Which ability under which condition | run 3–5 |
| **Pathfinding** | Route / Risk | Which nodes, when to descend, what to skip | run 4–6 |
| **Succession** | *(new — §3's branch pick)* | Which branch at level 5 and 10 | first level-5 unit |

> **Six surfaces become four, and the two that go are the two the player now does by hand.**
> **Pathfinding** is retired outright: choosing the route is the single most Slay-the-Spire decision
> in the game and automating it was the largest thing this design was giving away for free. Its
> predicates survive in one place only — the headless chooser of §4.6, which needs *something* to
> decide with when `tools/sim.js` plays 200 runs with nobody watching. **Succession** is retired for
> the reason §3 gives. What remains is the four that genuinely are standing orders — **Marching
> Order · Focus · Parley · Field Orders** — every one of which answers a question asked hundreds of
> times a run at 20 Hz, which is the actual test for whether something belongs in a policy at all.
>
> The test, stated so it can be applied to the next candidate: **if it happens once per node, the
> player decides it; if it happens many times per battle, the Doctrine decides it and a Command
> overrides it.** Route was on the wrong side of that line, and so were branches.

**Run 1 has no panels at all.** The party fights entirely by the shipped defaults and the player watches — which is the correct first experience for a game whose premise is that it plays itself. The first Precedent is not a rule, it is a Discipline: *"Your Ranger has died in the front row three times. Learn Marching Order?"* One mechanism raises both, because an offer is either `{rule}` or `{unlock}`.

That answers the shape directly: **the number of decisions available is a function of how far you have got**, and it starts at zero rather than at five empty editors.

Two axes of growth, and they are deliberately different currencies:

- **Which Disciplines you have** is *discovered* — a Precedent notices a pattern in your play and offers you the panel that would have had an opinion about it. It cannot be bought. This is what makes the opening hours a sequence of small revelations rather than a settings screen filling up.
- **How many rule slots each Discipline holds** is *bought* — ~~Lattice Doctrine nodes and Codex~~ **Coin, at a merchant, for the length of one run** (§5.1). Scarcity is what makes a rule slot a decision, and that was right the first time; what was wrong was which clock the scarcity ran on.

A panel that does not exist is not greyed out; it is absent. The Doctrine screen on run 1 is a single line explaining that the party has no policy yet, and by run 6 it is six tabs — and every one of them arrived attached to a memory of why.

### 4.3 The signal ledger — what a Precedent watches

A Precedent's `when` needs to ask *how many times did X happen*, and nothing in the sim could answer that. The seam already existed and was never built: `emit_signal` is one of §11.4's ~20 core ops and is still unwritten.

```js
signals.emit('recruit:missed', { defId, hpPct })   // counted, scoped, ordered
```

The ledger is one counted, named record with three scopes — `battle` · `run` · `profile` — and two expr forms over it, `signalCount(name)` and `signalSince(name, scope)`. It is not an event log; it is counters plus a small ring of recent payloads, because a Precedent needs "three times" and "the last one was a Frost Sprite" and nothing more.

Three systems collapse onto it, which is the argument for building it rather than special-casing Precedents:

- **§4.4's fire counts** are already this — `trace.js` counts rule firings today. The ledger generalises it rather than sitting beside it.
- **§4.5's post-mortem** needs exactly this counting to attribute a wipe, and currently plans to derive it separately.
- **§5's Codex** is a set of first-time discoveries, which is a signal ledger with a threshold of one.

So the ledger is not new machinery for a new feature; it is the thing three planned features were each about to grow privately. Ops emit into it, hooks emit into it, and a mod's script emits into it through its own namespace — `kindled:ignite:cast` — so a pack's Precedent can watch a pack's signal with no core change.

**It is save state, and it must be, which has a determinism cost worth naming.** Profile-scoped counters persist (§14), so a save carries them, a migration has to know about them, and the fuzzer has one more thing that can differ between two runs of "the same" seed. Run-scoped and battle-scoped counters are derived and are not saved. The rule: **a signal may never be read by anything inside `resolveTick`.** Precedents read signals; combat does not. Without that line, the ledger becomes a hidden input to the sim and §18.5's determinism regression starts depending on save history.

### 4.4 How a person actually edits an expression tree

Precedents are how most rules arrive; the panel is where they live, get reordered, and get rewritten. It is still a real editor and these four commitments still hold — what changed is that a player meets them on rule two rather than rule zero.

**Rules are rows; expressions are inline chips.** A rule reads left to right as `IF ⟨chip⟩ ⟨chip⟩ THEN ⟨action⟩`, where each chip is a dropdown over the forms that are *legal in that position*. There is no free-text parser and no blank canvas. The player builds `['lte', ['hpPct','$target'], 0.3]` by picking `hp%` → `≤` → dragging a slider, and never sees a bracket. The tree is the storage format, not the interface.

**Availability is discovered by exhaustion, not documentation.** Because every form is registered (§11.6) with a type signature, the dropdown at any position is *generated* — it lists exactly the predicates that fit, including a mod's, with a one-line description. A modder's new form appears in that menu automatically, with no UI work; this is the whole payoff of one evaluator.

> **Amended by §4.1.** The original sentence here was "a player learns the language by opening the menu", and that was the load-bearing claim of the whole interaction model. It is a *reference* answer to an *onboarding* problem: exhaustion tells a player what is available and nothing about what is worth saying. Precedents now carry the teaching — each one introduces one form inside a sentence about something that just happened to them — and the generated menu goes back to being what it is genuinely excellent at, which is letting a player who already knows what they want find it, and letting a pack's form show up without UI work.

**Every rule shows a live fire count.** Each row carries a badge: how many times it fired in the last run, and in the last battle. A rule that never fires is the single most common authoring bug and is otherwise completely invisible — the badge reads `0` in amber and that is the entire debugging story. Clicking it opens the last three evaluations with each sub-expression's value shown inline, so `0` becomes "`kinCount(Drake)` was 4, not < 4".

**Rules are ordered and first-match-wins, and shadowing is detected statically.** If rule 3 can never be reached because rule 1 subsumes it, the editor says so at authoring time. Ordered-first-match is chosen over a scoring system because it is the only model where "why did it do that" has a single-line answer.

### 4.5 The post-mortem

§4's design rule implies a system that appeared nowhere else in the plan. It's one screen, shown on every run end:

- **The wipe, attributed.** The battle that ended the run, the decisive event, and the Doctrine line that chose it — "Rule 4 (`DECLINE if coherenceDelta < -0.08`) declined 3 recruits on floor 2; you entered floor 3 with 6 units."
- **The counterfactual.** One number per rule: how the run's depth would have differed with that rule disabled. Cheap to compute honestly, because a replay is `{seed, modset, doctrine}` (§14) and re-simming with one rule flipped is ~1 s in the worker.
- **The one-click edit.** Every line links into the Discipline that owns it, with that rule focused.

The post-mortem is what converts a wipe from noise into the actual gameplay input. It ships at **M5** and depends on nothing but replays and the signal ledger of §4.3.

**The post-mortem and the Precedent are the same idea at two timescales**, and building them as one thing is most of why §4.3 is worth its own file. A Precedent says *this happened and you had no rule for it*; the post-mortem says *this run ended and here is the rule that ended it*. Both read the ledger, both name a Discipline, both offer a rule, and both are answered by writing one. The post-mortem is therefore not a sixth screen — it is **the end-of-run Precedent queue with a counterfactual attached to each card**, which is why it stays at M5 and costs almost nothing once §4.3 exists.

> **Amended: the post-mortem gains a second half, and it is the one the player will read.** With
> nothing banked at run end there is no reward screen to soften a wipe, so the post-mortem *is* the
> end of the run and had better be worth arriving at. It reports two things now — the Doctrine line
> that ended the run (above, unchanged) **and the route**: the floor map with the path you took drawn
> on it and the branches you didn't, annotated with what was down them. *"You took the elite on floor
> 3; the other fork held a campfire and a merchant."* That is the counterfactual a route-choosing
> game owes the player, it is nearly free (the map was generated, and the unvisited nodes already
> have their payloads), and it is the single strongest argument for one more run.

### 4.6 Choice points — how a game that asks questions still runs headless

Six kinds of decision now block the run loop (§4's table), and `tools/sim.js` has to play two hundred runs with nobody there to answer them. The resolution is one interface and no branching:

```js
// run.js never renders and never waits on a promise it constructed itself
const choice = { kind: 'room', options: [...], ctx: {...} }
const picked = await chooser.choose(choice)          // index into options
```

Three implementations, one contract:

| Chooser | Used by | Answers with |
|---|---|---|
| `uiChooser` | the browser | a click |
| `doctrineChooser` | `tools/sim.js`, `tools/balance.js`, the fuzzer | the retired Pathfinding predicates + a stated preference order per kind |
| `scriptChooser` | replays and tests | the recorded `choices[]` array, in order |

Four properties this has to hold, each of which is a thing that goes wrong if it doesn't:

- **A choice is data, not a callback.** `{kind, options, ctx}` is JSON, so it serialises into a replay, crosses the Worker boundary, and can be asserted on in a test without a renderer.
- **`chooser.choose` is the only `await` in the sim.** Everything else is synchronous and pure. One suspension point is auditable; two is a concurrency model.
- **The choice list is generated by the sim, never by the UI.** `src/ui/` renders `options` and returns an index. It does not know what a room is worth. This is §18.15's ban, holding at the new seam.
- **A recorded run replays without a chooser at all**, because `scriptChooser` is total: `{seed, modset, doctrine, choices[], commands[]}` reproduces a run to the byte, which is what makes the post-mortem's counterfactual honest and §18.17 checkable.

---

## 5. Progression

> **Rewritten. Four currencies and a permanent tree become one currency and a difficulty ladder.**
> The old §5 was an incremental game bolted to a roguelite: Residue banked at run end bought
> permanent stats, Insight multiplied Residue, Codex bought capabilities forever, and Coin was the
> only one that lived and died inside a run. §19 recorded two of the four as debts — *nothing spends
> Coin* (14) and *nothing spends Residue* (18) — and the honest reading of two idle currencies out of
> four is not that the sinks were late. It is that **the game did not need them**, and each one was
> quietly making a wipe cost less.
>
> The replacement is the shape Slay the Spire uses and it is a subtraction, not a redesign:
>
> | Was | Is |
> |---|---|
> | Coin — in-run, no sink | **Coin — the only currency, with every sink** (§5.1) |
> | Residue → Lattice stat nodes | *deleted.* Permanent stats are the incremental part |
> | Insight → global multipliers | *deleted.* Prestige is the **Ascent** and grants nothing (§5.3) |
> | Codex → a shop of Tenets and unlocks | **Codex — a record, not a balance** (§5.4) |
> | Lattice keystones, bought once | **Banners** — picked at the start of every run (§5.2) |
> | Lattice bias nodes → steer spawns across runs | *deleted.* The region you route through steers spawns *in* the run |
>
> The thing this buys is the thing a roguelite is for: **a run is worth exactly what happened during
> it.** No screen afterwards converts a floor-2 wipe into a number, and no number makes the next run
> easier. What you take out is what you learned, plus whatever new species you met.

### 5.1 Coin — the only currency

Earned inside a run, spent inside a run, **zero at run end**. There is no bank, no conversion, and no screen where Coin becomes something else.

| Earned from | Amount |
|---|---|
| Killing a foe | `tier × depth`-scaled, per §19's existing `battleCoin` |
| Winning with Commands unspent | `CMD_UNSPENT_COIN` (8) each (§2.6) |
| A won battle, scaled by build focus | `× (1 + 0.6 × coherence)` (§3) |
| Treasure rooms, elite kills | a rolled amount plus an item |

| Spent on | Where |
|---|---|
| **Items** — weapon · armour · trinket (§6.4) | merchant, 3 rolled + 1 reroll |
| **Tenets** — a doctrine capability, for this run | merchant, 1–2 offered |
| **Revive** a fallen unit | campfire, priced by that unit's level |
| **Reroll** a spoils offer | anywhere, rising cost within a battle |
| **Cut fee** — remove a unit without replacing it | campfire; a party of 9 good units beats 12 mixed ones |

Five sinks against one source is the ratio that makes a currency a decision. The old plan had two sources and, in practice, zero sinks.

**Items move from M6 to M5**, and this is why: they are the primary sink for the only currency, so shipping the currency without them is shipping debt 14 again on purpose.

### 5.2 Banners — the run-shaping choice, made every run

The Lattice's best idea was its keystones — *Warlord*, *Congregation*, *Duelist* — mutually exclusive commitments that change what a party even is. Their worst property was that you bought one and then had it forever, so a decision that should reshape a run reshaped every run after it, once.

A **Banner** is the same content (`{modifiers, hooks}`, §11.5 — no new code) offered as **1 of 3 at run start**:

| Banner | Effect |
|---|---|
| **Warlord** | +40% ATK, party cap 12 → 8 |
| **Congregation** | party cap 12 → 16, −15% all stats |
| **Duelist** | party cap 4, triple all stats |
| **Motley** | inverts the coherence term — breadth pays, concentration doesn't (§3) |
| **Vanguard's Oath** | +2 Commands per battle, −20% max HP |
| **Silent Retinue** | no Commands at all; +1 Doctrine rule slot per surface |

Ship ~10 and offer 3, so a run's identity is set before the first fight by a choice you did not fully control. `Silent Retinue` is there deliberately: an autobattler ought to let someone play it as the pure policy game the previous three drafts of this plan were about, and it costs one data row to offer that.

### 5.3 The Ascent — prestige that only makes it harder

Clear the floor-8 boss and **Ascent 1** unlocks. Each rung adds one named rule change, permanently, cumulatively, to every subsequent run at that level or above. **No rung grants anything.** There is no multiplier, no currency, no unlock behind them — the only reward for Ascent 7 is that Ascent 8 exists.

| # | Change |
|---|---|
| **1** | Foes are one level higher |
| **2** | Persuade resistance hardens faster — decay `0.7 → 0.6` |
| **3** | Post-battle heal `25% → 15%` |
| **4** | Elites appear on floor 1 |
| **5** | Party cap `12 → 10` |
| **6** | **One fewer Command** per battle |
| **7** | A campfire heals *or* revives — not both |
| **8** | Merchants stock 2 items instead of 3, and rerolls cost double |
| **9** | Recruits join one level below the party median |
| **10** | Coherence no longer scales Coin |
| **11** | Bosses gain a third phase at 10% HP |
| **12** | Floor maps branch 2-wide instead of 3 |
| **13** | The first spoils offer of each floor is 1 of 2 |
| **14** | Foes are two levels higher (replaces 1) |
| **15** | Escalation starts 200 ticks earlier — long fights punish you, not them |

Fifteen rungs, each one line of `tuning.json` overlay, because §16.1 already made every constant in the game a patchable path. **An Ascent level is a patch set** — literally the §13.2 mechanism pointed at ourselves — so adding rung 16 is a JSON row and a mod can ship its own ladder.

Two properties worth stating because they are what makes this not a difficulty slider:

- **Rungs are ordered and fixed, not chosen.** You do not pick which handicaps to take. Everyone at Ascent 9 is playing the same game, which is what makes "I cleared A9" mean something and what makes discussing it possible.
- **The Ascent is per-profile, not per-Banner or per-anything.** One number, shown on the run-start screen, and you may play any rung at or below your highest unlocked. Dropping down is not a failure state and carries no penalty; grinding a lower rung yields nothing, which is the point.

### 5.4 The Codex — a record, not a balance

The Codex survives the currency purge because it was never really a currency — §5 called it "a *count of discoveries*, not a resource you farm" while simultaneously giving it prices to pay. It is now only the first half of that sentence.

- **+1 entry** for the first kill of each boss, the first recruit of each species, and each Pact triggered for the first time.
- **Entries unlock breadth, automatically and immediately.** Recruiting a Bone Chanter for the first time puts Bone Chanters into the spawn pool for future runs, and its Pacts into the codex you can read. There is no purchase step, because there is nothing to spend.
- **It never grants power.** No stat, no starting item, no head start. A profile with 120 entries meets a wider variety of things than one with 12; it does not beat them more easily.
- **It is what a losing run reliably produces**, which was the correct argument for it and still is. A run that wipes on floor 2 having talked two new species into the party changed what every future run can contain.

The Tenet shop's pricing model (§4.2, §19) is not wasted — it moves intact from a profile-scoped Codex balance to a run-scoped Coin balance at merchants, and to 1-of-3 spoils. `capabilities()`, `validate()` and the itemised export-string check are unchanged; **what changes is which number `price` is subtracted from, and when it resets.**

---

## 6. The dungeon

Autogenerated per floor on a **tile grid** — rooms and corridors, Pokémon-style. The leader walks it by tweening between tile centres. No physics, no collision system: walkability is a lookup in the tile array.

> **The floor becomes a one-way branching map, and this is the largest single change the reframe
> asks for.** It was a tile dungeon you could walk freely with a Pathfinding rule choosing for you,
> which has two problems at once: the route was not a decision the player made, and because you could
> reach everything, it was not a decision at all. **What makes a Slay the Spire map a game is
> exclusivity** — taking the elite means not taking the campfire, permanently, and seeing what you
> gave up.
>
> The fix keeps every line of M0's work. The tiles, the walking, the follower chain and the node
> payloads are unchanged; what changes is the **graph drawn on them**. A floor is now a DAG of rooms
> laid out in ~6–8 **ranks** from entry to exit. You stand in a room, you see the 2–3 rooms it
> connects forward to and what is in them, you pick one, and the leader walks there. **Corridors
> behind you close.** There is no backtracking, so a floor of 14–18 rooms is a run of 6–8 and the
> other ten are the road not taken — which the post-mortem then shows you (§4.5).

```js
// src/sim/dungeon.js — pure JS, returns a plain data structure
{ w, h, tiles: Uint8Array, rooms: [...],
  nodes: [{ id, rank, x, y, type, payload, next: [nodeId, …] }],   // a DAG, ranked entry → exit
  entry, exit }
```

Generation: rank the floor into 6–8 columns, place 2–3 rooms per rank, wire each room forward to 1–3 rooms in the next rank (never sideways, never back), carve the tiles under that graph, then assign node types against per-floor quotas. Three constraints the generator has to hold, each because violating it silently makes the map fake:

- **Every room is reachable from `entry` and reaches `exit`.** A dead end is a trap that reads as a choice.
- **No rank is uniform.** If both forward rooms are `encounter`, the pick is a coin flip, and a floor of coin flips is a corridor with extra clicks. At least two distinct types per rank wherever the quota allows.
- **The last rank before the stairs holds a campfire on at least one branch, never all.** This is the decision §6.1 says recovery exists to create, expressed in the map rather than in a rule.

Node types: `encounter` · `elite` · `treasure` · `shrine` (buff at a cost) · `merchant` · `campfire` (heal / revive / re-form / cut) · `rare spawn` · `secret` · `boss`.

The party follows the leader as a trailing sprite chain (classic Pokémon follower rendering) — cheap, and it makes a 12-unit party legible while walking.

**Pacing.** 8 floors × 6–8 rooms = **~55 rooms per run**, of which ~35 are fights. At 30–45 s a battle plus its spoils pick, plus the route choice and the walk, a full clear is **35–55 minutes**. The old figure was 8–25 minutes over 14–22 nodes a floor — 128 rooms — which was only survivable because the game expected you to fast-forward past most of it. A watched run cannot be 128 fights long, and the fix is fewer, longer, chosen rooms rather than a faster clock.

### 6.1 Between-encounter recovery

Left unstated, this silently decides whether a run is 3 encounters or 20 — and the unstated default (none) was measured: **every run died on node 2 of floor 1**, on residual damage, before the acquisition loop could produce anything.

| Where | Effect |
|---|---|
| **After any won battle** | heal `postBattleHeal` = 25% of max HP to every survivor |
| **Campfire node** | full heal, and revive the fallen at 50% HP — plus re-form, cut, and Coin-priced revives (§5.1) |
| **Floor descent** | nothing — the campfire before the stairs is the decision |
| **Death** | a unit stays down for the rest of the floor unless revived at a campfire |

25% is enough to absorb a clean win and not enough to absorb a bad one, which is what makes "walk toward the campfire or toward the treasure" a real question — **and it is now a question the player answers with a click at the fork, rather than one a Route rule answered for them before the run started.** Recovery is **run state, and lives in `sim/run.js`** — `applyOutcome()` for the post-battle trickle, `campfire()` for the full heal. It spent M2 inside `DungeonScene`, which is how the run loop ended up in the renderer at all (§19).

### 6.2 Spawn tables and depth scaling

```json
// packs/core/content/spawn.json — a themed pool
{ "id": "core:spawn_crypt", "name": "The Crypt", "floors": [1, 3],
  "weights": [ { "unit": "core:bone_chanter", "w": 6 },
               { "unit": "core:tomb_knight",  "w": 4, "when": ["gte", ["floorNum"], 2] } ] }

// …and the base pool, which is why adding a unit is still one file
{ "id": "core:spawn_wilds", "name": "The Wilds", "floors": [1, 99], "units": "*" }
```

- **Foe level** is `1 + (floor − 1) × 1.5`, rounded — the curve the party's XP has to keep pace with, and the reason §3's XP hole was fatal rather than cosmetic.
- **Tier is capped one above the floor's target tier**, with a steep falloff inside that cap. Flat weighting was measured putting two tier-3 Drakes in the first encounter of floor 1.
- **Bias** is now *in* the run, not across runs. The Lattice's bias nodes are deleted with it; what steers a build is the **region** each floor's map is themed to (§6.2's `spawn` tables), which you can read on the map before you walk into it. Steering toward Drakes means routing through the drake-themed branch this run, at the cost of whatever the other branch held — a live trade rather than a purchase made hours ago.
- Weights are expr trees, so a spawn table is conditional content and a mod adds to the pool by shipping one row.

Three decisions the implementation had to make that this section had left open, each of which turned out to be load-bearing:

- **Two mechanisms, not one.** A `spawn` table says what a *depth* is; a unit's own `spawn: {weight, floors, when}` block says where *it* shows up. The `units: "*"` wildcard reads every unit's own block, which is what keeps "adding a unit is one JSON file and one descriptor" true (the M1 gate). If a new unit also had to be added to a table, adding a unit would touch two files and the roster would grow a coordination cost per row.
- **Matching tables sum; they never override.** A unit's weight is the total of every row naming it. Addition is commutative, so no pack load order can change what spawns — this is §18.6 holding in a place it would otherwise be very easy to break, and it is what lets "a mod adds to the pool by shipping one row" mean *adds* rather than *fights over*.
- **Depth shaping is applied once, after every table.** A themed pool therefore cannot opt out of the tier cap. Floor 1 targets tier 1, so the crypt table's tier-2 Undead stay rare there even though the table names them; the theme reads on floor 3, where the band and the table agree. The other ordering — theme first, cap second — is precisely how a flavourful table wipes a new run.

### 6.3 Bosses

A boss is **a unit def with `boss: true`**, not a new kind — one slot, no formation, and three things the flag turns on:

- **Phases.** `phases: [{ at: 0.6, grant: 'core:enraged' }, { at: 0.25, grant: 'core:desperate' }]` — HP-fraction thresholds that apply a status. A status is already `{modifiers, hooks, dur}` (§11.5), so a phase change is a data row and boss mechanics cost no new code.
- **Persuade immunity** by default (`persuadable: false`), overridable per boss — a recruitable boss should be a designed exception, not an accident of the tier table.
- **Escalation deferred.** Boss fights double `ESC_START`, because a 35-second bound on a fight designed to last 60 would make phase 3 unreachable.

Codex credit for a first boss kill is what feeds §5's Codex currency.

**Built, and the claim held.** `core:hollow_sovereign` is a unit def with three extra fields and nothing else — no boss code exists anywhere in `src/sim/`. Phases are one hook subscriber (`core:phases`, ~10 lines in `rules.js`) that walks units with a `phases` array at `tick:start` and grants an ordinary status; the two statuses it grants are ordinary rows in `status.json`. Persuade immunity is `def.persuadable ?? !def.boss`, refused in the op *and* filtered by policy — the second one matters, because a Recruit rule matching a boss would otherwise have the whole party spend gauge on attempts that cannot land and lose the fight to its own doctrine. Two things the implementation had to decide: a boss node fields **one** unit (it fielded six before, which was a large encounter wearing the name), placed front-centre so a melee party can always reach it; and a phase check is a `while` rather than an `if`, because one enormous hit can cross two thresholds and skipping the one it jumped means the hardest-hitting party never sees the middle phase. Building it also surfaced a latent bug worth naming: `addStatus` coerced any non-numeric `dur` to `0`, so every `dur: 'battle'` status would have expired on the tick after it landed — silently, with no content shipping one yet to notice.

### 6.4 Items

§11.5 already fixed the shape as `{modifiers[], hooks[]}` — what was missing is where they come from and where they go.

- **Three slots per unit**: `weapon` · `armour` · `trinket`. Slots are just a validated key on the instance; the modifier pipeline (§11.3) does the rest, so there is no equip code beyond a slot check.
- **Drops** come from `treasure` nodes and elite kills, rolled on the `loot` RNG stream against a per-floor table shaped exactly like §6.2's.
- **Economy**: merchants sell 3 rolled items, 1–2 Tenets and one reroll for Coin; there is no crafting and no upgrade tree. Items are horizontal — a tier-1 item is a different shape, not a worse one — because a vertical item ladder is an incremental ladder wearing an inventory.

> **Moved from M6 to M5.** The old line — "nothing else in the run loop depends on them" — was true
> when Coin was one of four currencies and the Lattice carried the build. With **Coin as the only
> currency** (§5.1), items are its main sink, and a currency with no sink is exactly the shape of
> debt 14. They ship with the run economy or the run economy is not shipped.

---

## 7. Animation — the cost-control system

This is what makes a 120-unit roster affordable. **Per-unit art is six animation sets and nothing else:**

`idle` · `walk` · `attack` · `cast` · `hurt` · `faint`

And those six sets are **generated from a JSON descriptor and baked to an atlas** (§15) — so the per-unit art cost is authoring ~40 lines of JSON, not drawing 24 frames.

Everything expressive is a **shared, data-defined attack template** driving tweens and pooled FX sprites. Any unit references a template by id; templates are reused across the entire roster.

```json
// packs/core/content/anim_templates.json
{ "id": "core:melee_lunge", "dur": 620, "steps": [
  { "t":   0, "op": "anim",  "who": "actor",  "key": "attack" },
  { "t":  60, "op": "tween", "who": "actor",  "to": "targetAdj", "dur": 140, "ease": "Cubic.Out" },
  { "t": 210, "op": "fx",    "key": "core:slash_a", "at": "target" },
  { "t": 215, "op": "anim",  "who": "target", "key": "hurt" },
  { "t": 215, "op": "shake", "mag": 5, "dur": 120 },
  { "t": 215, "op": "popup", "src": "event.damage" },
  { "t": 340, "op": "tween", "who": "actor",  "to": "home", "dur": 180, "ease": "Cubic.InOut" } ] }
```

Ship ~12 templates: `melee_lunge` · `melee_sweep` · `ranged_bolt` · `ranged_arc` · `cast_beam` · `cast_aoe` · `buff_pulse` · `debuff_wisp` · `heal_glow` · `summon_rise` · `channel_ray` · `ultimate_flash`.

The template runner consumes sim events and emits Phaser tween chains. **It reads `event.damage`; it never computes it.**

So there are three tiers of shared authoring, and the per-unit cost of each is one id:

| Tier | Shared asset | Count | Per-unit cost |
|---|---|---|---|
| **Skeleton** | rigs + pose clips (§15) | ~5 rigs × 6 clips | 1 rig id |
| **Skin** | part shapes + palette ramps (§15) | ~60 parts | 1 descriptor (~40 lines JSON) |
| **Flourish** | attack templates (above) | ~12 | 1 template id |

---

## 8. Architecture

The constraint — *Phaser for rendering, plain JS for logic* — is a hard boundary. **Nothing under `src/sim/` may import Phaser.**

There is a second boundary of equal weight, set from day 1: **code lives in `src/`, content lives in `packs/`, and our content is a pack like any other.**

```
packs/                      ← ALL content, ours and everyone's, identical shape
  core/                     ← we are just the first mod (§13.1)
    mod.json
    content/*.json          ← units abilities items statuses pacts resonance
                              lattice nodes spawn tuning anim_templates
    art/descriptors/*.json  ← sprite source of truth (§15)
    art/baked/              ← generated atlases + metadata, committed
    schemas/*.json          ← JSON Schema for every content kind (core only)
src/
  sim/                      ← pure JS. No Phaser. Runs in Node and in a Worker.
    kernel/                 ← registry defs modifiers ops hooks expr rng (§11)
    combat/
      resolve.js            ← ★ tick loop → { state', events[] }   (build this first)
      formula.js            ← damage, hit, crit, affinity
      formation.js          ← 3×4 grid, reach and ability shapes
      persuade.js           ← recruitment rolls
    party.js  synergy.js  coherence.js  fusion.js
    dungeon.js              ← tile + ranked node DAG generation (§6)
    commands.js             ← the tick-stamped input queue (§2.6)
    choice.js               ← the Choice contract + doctrineChooser (§4.6)
    ascent.js               ← the difficulty ladder as a tuning overlay (§5.3)
    doctrine.js  economy.js  save.js
    policy/                 ← doctrine + battle state → chosen action
    mods/                   ← loader, manifest, patch, sandbox (§13)
  engine/                   ← the ONLY place Phaser is imported
    boot.js
    scenes/DungeonScene.js  ← tilemap + grid walking
    scenes/BattleScene.js   ← formation layout + timeline playback
    anim/TimelinePlayer.js  ← sim events → tweens/anims/FX   (templates are JSON, in packs/)
    fx/FxPool.js            ← pooled effect sprites
  ui/                       ← plain DOM. Doctrine editors, party, map, spoils, post-mortem.
  workers/simWorker.js      ← counterfactual re-sims for the post-mortem; batch runs
  main.js
tools/                      ← headless CLI: sim, balance, lint, art, replay, modcheck
legacy-pygame/              ← the original prototype, restored from HEAD
```

Note what is *absent*: there is no `src/sim/data/`. Content cannot live under `src/` because the day it does, our content gets a loading path that mods don't have, and that asymmetry is exactly what makes modding second-class.

**The contract is one direction, with exactly one narrow channel back:**

```js
const { state, events } = resolveTick(state, rng, { commands })   // pure
// events: [{ t, type:'damage', actor, target, damage, isCrit, element }, …]
timelinePlayer.enqueue(events)                       // rendering only

// the only thing the engine ever sends inward, and it is a gesture, not a decision
commands.queue({ tick, verb: 'focus', args: { uid: 14 } })        // §2.6
```

`BattleScene` holds a playback clock decoupled from the sim clock. At ×1 it plays every event; at ×4 it compresses durations and drops non-essential FX; headless it never constructs a scene at all.

**Why one channel back does not break the rule.** The renderer still computes nothing the sim reads. A command is a *player gesture* — a verb and an id, both of which the UI got from sim state it was displaying — stamped with the tick it was issued on and consumed at a tick boundary. The sim decides what a Focus *means*; the UI decides only that the human clicked. The test is §18.15's, unchanged in spirit and now stated for input: **reading sim state is fine, relaying a gesture is fine, deciding is not.**

Two consequences that keep the boundary honest:

- **The command queue is drained, never inspected mid-tick.** `resolveTick` takes the commands for tick *t* as an argument and receives nothing else from outside. There is no live handle from the sim into the engine.
- **A command that arrives for a tick already resolved is applied to the next one, never retroactively.** Otherwise the timeline hash would depend on frame timing, and §18.5 would start failing on slow machines.

### Phaser v4 specifics

Verified against the current docs: **`phaser@4.2.1`** is npm `latest` (v4 shipped April 2026). Relevant to us:

- **No `physics` key in the game config at all.** We use `type: Phaser.AUTO`, scenes, `this.anims`, `this.tweens.chain()`, cameras.
- **`TilemapGPULayer`** (new in v4) — fixed rendering cost per pixel regardless of tile count. Use it for the dungeon floor.
- **Filters** replace v3's separate FX and masks, and work on any game object with no exceptions. Use for hit flash, elemental tints, screen transitions.
- **`Mesh`/`Plane` are removed** and custom WebGL pipelines must be rewritten as render nodes — neither affects us, but don't copy v3 tutorials that use them.
- **`SpriteGPULayer`** for particle-dense FX if profiling ever asks for it.

Performance is a non-issue at this scale: ~30 sprites in a battle, one GPU tilemap layer, pooled FX. Vite + ESM, no TypeScript.

**Repo layout (assumption — say if you'd rather not):** Phaser project at repo root; restore the PyGame prototype from `HEAD` into `legacy-pygame/`. The repo is **GPL-3**, which propagates to the rewrite unless deliberately changed.

---

## 9. Milestones

Each ends in something runnable. Don't author content before the resolver.

> Part II adds three preceding steps — **K0 kernel · K1 pack loader · K2 art baker** — and a **M2.5** mod-delivery gate. §17 is the authoritative build order; this table is the design-side view of what each milestone proves.

| # | Deliverable | Proves |
|---|---|---|
| **M0** | Vite + Phaser 4, tile dungeon generator, leader walking a grid with a follower chain. No combat. | The dungeon reads and the sim/engine boundary holds. |
| **M1** | `combat/resolve.js` + `BattleScene` timeline playback. 3×4 formations, 4 units, 2 abilities, 3 anim templates. | **A battle resolves in pure JS and the screen faithfully replays it.** Make-or-break: if the renderer needs to know anything the sim didn't tell it, fix the boundary before continuing. |
| **M2** | Unit roster, Kin/Role tags, Resonance, party management, **persuade**. | The acquisition loop — the thing that makes it this game and not a generic auto-battler. |
| **M3** | Doctrine editors (Formation + Targeting + Recruit minimum). | The player has something to *do*. |
| **M3.5** | **Signal ledger · Precedents · Disciplines** (§4.1–4.3). The five editors become six panels that are *learned*, and rules arrive as events. | **The player has something to do that they can find.** M3 proved policy reaches the sim; this proves a person who has never read the plan ends run 3 with a Doctrine they meant. |
| **M4** | Floors, node types, **XP + levelling (§3)**, boss, run economy, save/load. | Run structure closing. **A run must be able to reach floor 4** — without the XP loop it structurally cannot, which is what made this the top-priority gap. |
| **M5** | **Commands, the branching one-way map, the spoils screen.** | **It's a game you play.** The gate is a person watching a battle and changing its outcome, on a route they chose. Formerly "it's genuinely idle" — the exact inversion. |
| **M5.5** | **One currency**: Coin only, items + merchants, **Ascent**, post-mortem. | A run is worth what happened in it and nothing else. Nothing banks; the ladder only goes up against you. |
| **M6** | Pacts, Banners, per-unit branches, fusion, content to ~40 units. | First playable. |

---

## 10. Verification

The whole sim layer tests in Node with no browser and no renderer — that's the payoff of the no-Phaser-in-`sim` rule.

**Continuous:**
- `node --test src/sim/**/*.test.js`
- **Determinism regression** — a fixed seed must produce a stable hash of the full event timeline. This is the single most valuable test in the project; it catches accidental `Math.random()` and any leak of wall-clock time into logic.
- **Battle fuzzer** — 10k randomised battles headless: no negative HP states, no unit acting twice on one gauge fill, and **fewer than 2% of battles reach the tick ceiling**. Note the reframing: the ceiling is no longer the anti-stall mechanism, it's the assertion that §2's damage escalation is working. Detecting a deadlock never told us what to do about one.
- **Balance harness** — a script that runs N battles per tier and emits CSV of win rate and time-to-kill. Run it whenever unit data changes.

**Per-milestone, in the browser** (`npm run dev`):
- **M0** — walk a generated floor end to end; assert `entry → exit` reachable across 500 seeded generations.
- **M1** — same seed at ×1 and ×4 produces identical outcomes and identical logs. Damage popups match `resolve.js` output exactly.
- **M2** — set persuade threshold to 30%, run 100 seeded battles, assert observed recruit rate matches the formula within tolerance.
- **M3** — author a recruit rule, run 10 seeded runs, assert resulting parties match the rule.
- **M3.5** — the first half of this line asked for three runs *answering only Precedents*, and no longer means anything: nothing is offered and nothing is answered. What replaces it is the check that the shop is the only door — **assert a Doctrine cannot say anything its holder did not buy**, itemised, including on a shared export string (`test/sim/tenet.test.js`). The second half stands, and now stands on its own feet: a run that raises reports must play identically to one that raises none. ✅ It is stronger than the line asks: rather than comparing *distributions* over 20 runs, it compares six seeds pairwise on floors, reason, Coin, final roster **and the timeline hash of every battle**. A distribution can hide a compensating pair of differences; an identical hash cannot. *It was written to protect loop D, which is gone — and it survives untouched because what it actually asserts is that observation does not perturb the sim, which is the same requirement whether the observer is a Worker or a person.*
- **M4** — save, reload, assert deep state equality. Assert Coin conservation across a floor: earned − spent = held.
- **M5** — three checks, replacing the offline-accrual one:
  - **A recorded run replays exactly.** `{seed, modset, doctrine, choices[], commands[]}` re-simmed produces an identical timeline hash for every battle and an identical final roster. This is §18.5 extended over the two new input channels and it is the test that keeps determinism true now that the game takes input (§18.17).
  - **A command changes the outcome.** Same seed, same doctrine, one `Focus` issued at tick 40 → a *different* timeline hash and a measurably different result. The dual of the line above, and the one that catches a command queue that is wired up but ignored — which is precisely the shape of debt 0, where the Doctrine never reached combat and every test passed.
  - **The map is a real choice.** Over 200 seeded floors: every room reaches `exit`, no rank offers a single option, and a `doctrineChooser` steered to prefer campfires ends runs with measurably more HP than one steered to prefer elites. If the two are indistinguishable, the map is decoration.

---

# Part II — Implementation

Part I says what the game is. Part II says what we actually build, and it optimises for three things in this order: **elegance** (few primitives, one way to do each thing), **extensibility** (new content is data, new verbs are one registration), **moddability** (a third party can ship content without forking, and cannot desync the sim by doing so).

The organising claim:

> **There are exactly seven kernel primitives. Every unit, ability, item, status, Pact, Resonance, keystone, shrine curse, Banner, Ascent rung, Command, Doctrine rule and dungeon node in the game is built from them — including the ones a modder writes.**

If a feature can't be expressed in the seven, that's a signal to extend a primitive, not to add a special case. Special cases are where moddability goes to die: the moment `resolve.js` contains `if (unit.id === 'bone_chanter')`, no mod can ever ship a unit that behaves like a first-class citizen.

---

## 11. The kernel — seven primitives

```
src/sim/kernel/
  registry.js    ← 1. namespaced, frozen, order-independent content store
  defs.js        ← 2. Def → Instance instantiation
  modifiers.js   ← 3. the one stat pipeline
  ops.js         ← 4. effect verbs
  hooks.js       ← 5. ordered hook bus
  expr.js        ← 6. the serialisable expression DSL
  rng.js         ← 7. named RNG streams
```

Seven files, target **under 900 lines total**. Everything else in `src/sim/` is content, policy, or a thin arrangement of these. Build them before M0.

### 11.1 Registry — namespaced ids, frozen after boot

Every piece of content has a namespaced id: `core:bone_chanter`, `kindled:emberdirge`. The namespace is the mod id; `core` is us. Bare ids are a load-time error, not a convenience — ambiguity here is what makes mod conflicts unfixable later.

```js
const R = createRegistry()
R.define('unit', 'core:bone_chanter', def)     // throws on duplicate id
R.get('unit', 'core:bone_chanter')             // throws on missing (never returns undefined)
R.all('unit')                                  // ALWAYS sorted by id
R.freeze()                                     // after boot, every mutation throws
```

Two rules carry disproportionate weight:

- **`R.all()` sorts by id.** Iteration order therefore never depends on which mod loaded first. This one line is why mod load order cannot change simulation outcomes.
- **The registry is frozen before the first tick.** Content is immutable at runtime, so an instance can hold a `defId` string instead of an object reference — which is what makes state trivially serialisable (§14) and structurally-shared snapshots cheap.

`R.get` throwing rather than returning `undefined` means a dangling reference fails at boot with a name, not on floor 7 with a `TypeError`.

### 11.2 Defs and Instances — the only two kinds of object

| | Def | Instance |
|---|---|---|
| Where | registry, frozen | game state, mutable |
| Lifetime | forever | a battle, a run, or a save |
| Contains | data + ids | numbers + `defId` |
| Authored by | us and mods | never — always instantiated |

```js
// def (data, in a JSON file or a mod pack)
{ id:'core:bone_chanter', kin:'Undead', role:'Channeler', base:{...}, abilities:[...] }

// instance (state, in the save)
{ uid: 7, defId:'core:bone_chanter', lvl: 4, xp: 210, hp: 63, statuses:[...], branch:['echo'] }
```

Nothing else exists. No third category of "manager object", no class hierarchy. `instantiate(kind, defId, ctx)` is a per-kind pure factory registered alongside the registry; it's how a mod adds a whole new content *kind* (say, `mount`) rather than just new rows of an existing one.

### 11.3 Modifiers — one pipeline, order-independent by construction

§3 already fixes the shape as `{path, op, v}` applied `set → add → mul → clamp`. The kernel generalises it into **the only way any number in the game is ever changed**:

```js
// {path, op, v, prio?, src}
resolveStats(baseStats, modifiers) // → frozen stat block
```

Collection is a flat concat from every source — equipment, statuses, Resonance, Pacts, Banners, Ascent rungs, shrine curses, mod scripts. Within a path, application is `set → add → mul → clamp`; ties inside an op break by `(prio, src)` where `src` is the namespaced id of whatever contributed it.

The property that matters: **the result does not depend on collection order.** A mod that injects a modifier can't produce an order-dependent bug, because there is no order to depend on. That is the whole reason to spend a file on this instead of writing `stat *= 1.2` at eleven call sites.

`paths` are dotted strings validated against a stat schema at load (`atk`, `def`, `persuade.threshold`, `gauge.rate`, `residue.mult`). Typo → boot error naming the mod.

### 11.4 Ops — effect verbs, the primary extension seam

An ability is not code. It's a `when` gate, a targeting shape, and an ordered list of effects, each naming a registered op:

```js
{ id:'core:marrow_bolt', castCost: 100, shape:'single', element:'dark', anim:'core:cast_beam',
  effects: [
    { op:'core:damage',       power: 34, element:'dark' },
    { op:'core:apply_status', status:'core:brittle', dur: 6, chance: 0.35 } ] }
```

```js
ops.register('core:damage', {
  schema: { power:'number', element:'element' },   // validated at load, not at tick time
  run(ctx, args, actor, targets) { /* uses ctx.rng, ctx.emit, ctx.hooks */ } })
```

Ship ~20 core ops: `damage` `heal` `apply_status` `cleanse` `shield` `gauge` `summon` `persuade` `move_slot` `taunt` `revive` `drain` `reflect` `dispel` `mark` `chain` `repeat` `conditional` `grant_mod` `emit_signal`.

`emit_signal` was the one on that list with no stated consumer, which is usually a sign a verb is speculative. It turned out to be the seam §4.3 needed: it writes into the signal ledger, which is what a Precedent watches. A verb with no consumer is worth keeping only when something later grows into it, and this is the example — but it is also the reason the other nineteen should each name theirs.

Twenty verbs × the shape system × the modifier system covers the entire designed roster with room left over. A modder authoring 30 units writes **zero JavaScript** — they're recombining ops. A modder who genuinely needs a new verb registers one op and everything else (targeting, animation, the timeline, the balance harness) works on it immediately.

Ops are the reason `resolve.js` stays short: it fills gauges, asks policy for an action, looks up ops, runs them, emits events. It knows nothing about any specific ability.

### 11.5 Hooks — one bus, deterministic order, and the great unification

```js
bus.on('damage:compute', 'core:scaled_wall', 50, (ev, ctx) => { ev.mul *= 0.8 })
```

A fixed, documented set of hook points, each with a named mutable **proposal** object; handlers mutate declared fields only (dev builds `Proxy`-guard the rest). Ordering is `(priority, subscriberId)` — deterministic without depending on subscription order.

```
tick:start · gauge:fill · action:choose · action:chosen · target:select
damage:compute · damage:apply · status:apply · unit:death · unit:revive
persuade:roll · persuade:result · battle:start · battle:end
loot:roll · node:enter · floor:end · run:end · residue:compute
```

Here's the payoff — **seven "systems" from Part I collapse into one shape**:

| Feature | Is really | Activates when |
|---|---|---|
| Item | `{modifiers[], hooks[]}` | equipped |
| Status effect | `{modifiers[], hooks[], dur, tick?, tickEvery}` | applied |
| Resonance | `{modifiers[], hooks[], when}` | tag count ≥ threshold |
| Pact | `{modifiers[], hooks[], when}` | cross-axis `when` passes |
| Banner | `{modifiers[], hooks[]}` | chosen at run start (§5.2) |
| Shrine curse | `{modifiers[], hooks[], dur:'run'}` | accepted |
| Command | `{ops[], cost}` | issued, at the tick after (§2.6) |

One type, one activation check, one deactivation path, one place to debug. Grave Choir, Scaled Wall and Swarm Logic are **data rows**, not code — which means a mod's Pact is indistinguishable from ours, and shipping the 30th Pact costs the same as the 12th.

**Status tick effects need a period, and `dur` is not one.** A status with a `tick` effect and no stated period fires *every tick* — at 20 Hz, a Regen heals twenty times a second and out-heals the entire field. `tickEvery` is a required whole number of ticks on any status carrying a `tick` effect (`20` = once per second, the sane default), validated at load. `dur` remains in ticks and is unrelated. This is the kind of gap that reads as a footnote and is actually a balance catastrophe; the battle fuzzer found it as a stall.

### 11.6 Expr — one serialisable expression language

A tiny s-expression evaluator over JSON arrays. No `eval`, no `new Function`, no strings to parse at runtime.

```js
['and', ['lte', ['hpPct','$target'], 0.3],
        ['lt',  ['kinCount','Drake'], 4]]
```

~30 built-in forms (`and or not eq lt lte gt gte add sub mul div min max clamp count hpPct kin role tier slot row hasTag kinCount roleCount coherence floorNum rand`), plus `signalCount signalSince hasTenet` for dispatch gates (§4.3). `forms.register()` extends it.

The last three are the only forms in the game that read state from outside a battle, and that asymmetry is deliberate and load-bearing: **they are legal in a dispatch's `when` and illegal in an ability's, a Pact's or a Doctrine rule's.** It is enforced rather than described — `forms.validate` takes the caller's scope and refuses a scoped form outside it, and `forms.list(scope)` is the only menu that offers one. A signal read inside `resolveTick` would make combat depend on save history, and §18.5's determinism regression would start passing or failing according to how much you had played.

It is used by **all** of: Doctrine rules, ability `when` gates, Pact activation, spawn table weights, node quotas, shrine offers, achievement/Codex triggers. One evaluator, one test suite, one debugger, one syntax for the player to learn.

Because expressions are plain JSON, three things come free: Doctrine sets serialise into the save with no special casing, a Doctrine is a **shareable export string** (a genuinely good social feature for a game about authoring policy), and the Doctrine editor UI is a tree editor over a data structure rather than a bespoke rule compiler.

### 11.7 RNG — named streams

§2 requires determinism. Mods threaten it in a specific way: a mod that draws one extra random number shifts every subsequent draw, so *adding a cosmetic mod changes your loot*. Named streams fix it:

```js
const rng = makeRng(runSeed)
rng.stream('combat')      // independent sequence, seeded by hash(runSeed, 'combat')
rng.stream('loot')
rng.stream('mod:kindled') // every mod script gets its own, automatically
```

Streams are derived by hashing the name into the seed, so they're independent and reproducible. Mod scripts receive **only** their own stream — `Math.random` and `Date.now` throw inside mod code (§13.3).

---

## 12. Module contracts

The repo layout is in §8. What matters here is the split it encodes:

| | `src/` | `packs/` |
|---|---|---|
| Contains | kernel, systems, renderer, UI | every unit, ability, item, Pact, rule, sprite descriptor, tuning constant |
| Language | JS | JSON (+ optional sandboxed JS per pack) |
| Changes when | a new *verb* is needed | a new *thing* is added |
| Who edits | us | us, and anyone else, through the same door |
| Reviewed by | code review | `tools/lint.js` |

**The test for whether the split is holding:** shipping the 100th unit touches only `packs/`. If it touches `src/`, either the op registry is missing a verb (fix: add one op, which is a *reusable* change) or we're about to hardcode something (fix: don't).

Contracts worth writing down because everything else depends on them holding:

```js
// combat/resolve.js — the load-bearing signature. Pure. No I/O, no clock, no Phaser.
resolveTick(state, rng, ctx) → { state, events }

// the sim's entire output surface
event = { t, type, actor, target, ...payload }

// engine consumes; never produces anything the sim reads
timelinePlayer.enqueue(events)
```

`resolve.js` stays around 200 lines *permanently*. If it grows, something that should have been an op or a hook got hardcoded — treat line count as a design alarm.

**Layer rule, CI-enforced (§18):** `ui/` and `engine/` may import `sim/`. `sim/` imports nothing but `sim/`. There is no shared "utils" folder spanning the boundary; duplication across it is cheaper than a leak through it.

---

## 13. Moddability

Three tiers of extension, deliberately ordered so that the overwhelming majority of mods never touch tier 3:

| Tier | What | Needs code? | Can break the sim? |
|---|---|---|---|
| **1. Content** | new units, abilities, items, Pacts, statuses, nodes, Banners, Ascent rungs | no | no |
| **2. Patch** | rebalance or rewire existing content | no | no |
| **3. Script** | new ops, hook handlers, expr forms | yes, sandboxed | only its own content |

### 13.1 Packs — and core is one of them

**The load-bearing decision, made on day 1: `packs/core/` is a mod.** Same manifest, same loader, same validator, same patch system, same art pipeline. There is no privileged path into the registry — `core` gets in by declaring content in `mod.json` exactly as a stranger's pack does, and CI asserts it (§18.12).

This is the cheapest possible way to guarantee modding stays first-class, because it makes the alternative impossible rather than merely discouraged. Every capability we want for ourselves — a new content kind, a hot-reload path, a debug view — a modder gets automatically, because we were using their door the whole time. And every bug in the mod path is a bug in *our* path, so it gets found on day 2 rather than in a forum post.

It also means "rebalance the core game" is a mod, "convert the game to a different setting" is a mod, and our own DLC-shaped content is a mod.

```
packs/kindled/
  mod.json
  content/units.json  content/abilities.json
  patches/balance.json
  art/descriptors/*.json    ← ships descriptors; art bakes from them (§15)
  art/baked/                ← or ships baked atlases directly, both accepted
  scripts/main.js           ← optional, tier 3
```

```json
{ "id": "kindled", "name": "Kindled Host", "version": "1.2.0",
  "api": 1,
  "requires": { "core": "^1.0" },
  "loadAfter": ["betterbeasts"],
  "content": ["content/*.json"],
  "patches":  ["patches/*.json"],
  "art":      { "descriptors": "art/descriptors/", "baked": "art/baked/" },
  "scripts":  ["scripts/main.js"] }
```

Load: discover → validate manifests → topological sort by `requires`/`loadAfter` (ties broken by id, so the order is total and reproducible) → define content → apply patches → run scripts → validate all references → resolve art → `R.freeze()`.

`api: 1` is the kernel contract version. A mod declaring an api we don't support is disabled with a readable message rather than crashing the game — mods failing gracefully is the difference between a modding scene and a bug tracker full of our name.

**Where packs come from at runtime.** This is a browser game, so there's no filesystem to scan — worth stating plainly since it shapes the loader:

| Source | Mechanism | Available |
|---|---|---|
| Bundled packs (`core` + first-party) | `import.meta.glob('/packs/*/mod.json')` at build | always |
| Dev packs | same glob, Vite HMR watches `packs/**` → hot reload (§16.3) | `npm run dev` |
| User-installed | drag a pack `.zip` onto the window → unpacked into **OPFS**, indexed in IndexedDB | always |
| Remote | fetch a pack URL, same unpack path, behind an explicit confirm | always |

All four converge on one in-memory shape — `{manifest, files: Map<path, bytes>}` — before the loader sees them, so the loader has exactly one input format and knows nothing about zips, OPFS or Vite.

### 13.2 Patches — rebalancing without forking

```json
{ "target": "unit:core:bone_chanter",
  "ops": [ { "op":"mul",  "path":"base.hp", "v":1.2 },
           { "op":"push", "path":"abilities", "v":"kindled:emberdirge" },
           { "op":"set",  "path":"tier", "v":3 } ] }
```

Patches apply in mod load order and are logged. Two mods patching the same path is **not** an error — the log names both, and `tools/modcheck` reports overlaps so authors can coordinate. Hard-failing on overlap is the thing that makes large mod lists impossible; a shrug plus a good report is what makes them work.

Wildcard targets (`unit:*` with `where` as an expr tree) make "rebalance every Drake" a four-line file rather than forty.

### 13.3 Script sandbox

Scripts are ESM modules receiving one frozen `api` object and returning nothing:

```js
export default function ({ ops, hooks, forms, registry, log, rng }) {
  ops.register('kindled:ignite', { schema: {...}, run(ctx, args, actor, targets) {...} })
  hooks.on('damage:compute', 'kindled:pyre', 60, (ev, ctx) => { ... })
}
```

Inside a mod script: no `globalThis`, no network, no filesystem, no DOM, and `Math.random`/`Date.now`/`new Date()` **throw** (a real error naming the mod — the failure mode we're preventing, silent nondeterminism, is otherwise undebuggable). Randomness comes from the mod's own `rng` stream. Registration is only permitted during load; calling `ops.register` after freeze throws.

This is a *cooperative* sandbox — it makes accidental sim corruption nearly impossible while making no claim to resist a hostile mod. That's the honest tradeoff for local JS mods, and it should be stated plainly in the modding docs rather than implied to be a security boundary.

### 13.4 Asset moddability

Sprite sheets and animation templates (§7) register by id like everything else, so a mod ships art the same way it ships units. One deliberate asymmetry:

> **Unknown sim op at load → hard error. Unknown animation step op at playback → skip, warn once, keep playing.**

The sim must never run content it doesn't understand. The renderer must never take the game down over a cosmetic. Same registry, opposite failure policies, both correct.

---

## 14. Save, versioning, determinism

```js
{ v: 7,
  seed, runSeed,
  mods: [{ id:'core', version:'1.0.0' }, { id:'kindled', version:'1.2.0' }],
  contentHash: 'a41f…',       // hash of sorted (id, version) over the frozen registry
  state: { … }                 // ids and numbers only — no object references
}
```

Because instances store `defId` strings and the registry is frozen, `state` is plain JSON. `save.js` is `JSON.stringify` plus a version stamp; no serialiser to maintain, no cycles to break.

- **Migrations** are an ordered array of `{to, up(state)}`, applied in sequence. Every save format change adds one; a test asserts a v1 save loads on the current version. §18.10 mandates a migration-chain test, which needs something to test *against* — so v1 is frozen as a committed fixture (`test/fixtures/saves/v1.json`) on the day `save.js` lands, and the chain is seeded with a real first entry rather than an empty array:

```js
// src/sim/migrations.js — the one place JS is allowed to know about save shape (§16.1)
export const MIGRATIONS = [
  { to: 2, up: (s) => { for (const u of s.roster) u.xp ??= 0; return s } },
  { to: 3, up: (s) => { s.doctrine = { rules: s.rules ?? [] }; delete s.rules; return s } },
]
```

  The test walks every fixture through every migration above its version and asserts the result validates against the current schema — so the chain is exercised end to end, not just its last link.
- **`contentHash` mismatch** (mods added, removed or updated) → a *Content changed* screen, not a crash. Repair pass: orphaned ids resolve through each def's `orphanPolicy` (`drop` for a unit, `substitute` for an ability, `drop` for a Banner). Removing a mod must never brick a save — that alone determines whether people are willing to try mods.
- **Replays** are `{seed, modset, doctrine, ascent, choices:[], commands:[]}` — a few hundred bytes reproducing a run exactly. They're the bug report format ("attach your replay"), the balance corpus, and the determinism test fixture, all at once. The old shape had a placeholder `inputs: []` with nothing to put in it; it now holds the two things a player actually contributes — **which room and which spoils** (`choices`, an ordered list of indices, §4.6) and **which Command on which tick** (`commands`, §2.6). Both are small, both are plain JSON, and neither needs a schema beyond an index and a verb, which is what keeps a replay a few hundred bytes rather than a recording.

---

## 15. Art generation — descriptors in, atlases out

§7 makes per-unit *animation* cheap by sharing templates. This makes per-unit *art* cheap by not drawing it. The rule:

> **Sprites are generated from JSON descriptors by an offline baker, and the baked atlases are committed. The game at runtime only ever loads finished atlases — it never generates.**

Both halves matter. Generation is what makes 120 units affordable; baking ahead of time is what keeps startup instant, keeps the renderer ignorant of the generator, and makes the art a reviewable, diffable artifact instead of something that might come out different on someone else's machine.

### 15.1 The pipeline

```
descriptor.json ─┐
rig.json ────────┤
clips.json ──────┼─→  tools/art.js  ─→  atlas-N.png   (frames, packed)
parts.json ──────┤       (Node)         atlas-N.json  (Phaser atlas)
palettes.json ───┘                      anims.json    (generated anim defs)
                                        manifest.json (id → frames + hash)
                                              │
                                packs/<pack>/art/baked/   ← committed
                                              │
                                    Phaser loads at boot
```

Four shared data kinds, one per-unit file:

| Kind | Count | What it is |
|---|---|---|
| **Rig** | ~5 | joint tree + canvas size + default clip bindings. `biped` `quadruped` `floater` `serpentine` `swarm` |
| **Clip** | ~30 | keyframed joint tracks — `idle_breathe`, `walk_biped`, `attack_swing`, `cast_raise`, `hurt_recoil`, `faint_collapse` |
| **Part** | ~60 | a drawable: primitives (capsule, ellipse, polygon) or a small pixel mask, with palette slots |
| **Palette** | ~15 | colour ramps, mostly Kin-flavoured — `bone`, `chitin`, `iron`, `fae_glow` |
| **Descriptor** | 1 per unit | rig + parts + palette + seed. ~40 lines |

```json
// packs/core/art/descriptors/bone_chanter.json
{ "id": "core:bone_chanter", "rig": "core:biped_tall", "seed": 4417,
  "palette": { "ramp": "core:bone", "accent": "core:necrotic" },
  "parts": {
    "head":  { "shape": "core:skull_horned", "scale": 1.1 },
    "torso": { "shape": "core:robe_tattered" },
    "armL":  { "shape": "core:arm_bone" },
    "armR":  { "shape": "core:arm_bone", "held": "core:censer" },
    "legs":  { "shape": "core:robe_hem" } },
  "overrides": { "clips": { "cast": "core:clip_channel_raise" } },
  "fx": { "aura": "core:soft_glow" } }
```

```json
// packs/core/content/art_clips.json
{ "id": "core:clip_walk_biped", "fps": 10, "frames": 6, "loop": true,
  "tracks": { "torso": { "y":   [0, -1,  0,  1,  0, -1] },
              "legL":  { "rot": [-14, -6, 4, 14,  6, -4] },
              "legR":  { "rot": [14,  6, -4, -14, -6, 4] } } }
```

Rasterise: walk the joint tree, transform each part by its clip track at frame *f*, z-sort, draw into an RGBA buffer, quantise to the palette, add a 1px dark outline (this single step is most of what makes procedural sprites read as deliberate), pack into an atlas. 6 clips × ~6 frames = **~36 frames per unit, generated in milliseconds.**

### 15.2 Determinism, hashing, incremental bakes

```
artHash = hash(descriptor + rig + clips + parts + palettes + GENERATOR_VERSION)
```

Same inputs → **byte-identical PNG**. Which buys: incremental bakes (skip unchanged, so a one-unit edit rebakes in ~20 ms), a meaningful `git diff` on baked output, and a CI check that re-bakes and fails if committed art is stale (§18.13). Bumping `GENERATOR_VERSION` rebakes everything on purpose.

Descriptor randomness (jitter, asymmetry, speckling) comes from the descriptor's `seed` through the kernel RNG (§11.7) — never `Math.random`, for exactly the reason baked art must be reproducible.

### 15.3 Zero dependencies

`tools/art.js` rasterises into `Uint8ClampedArray` and writes PNGs with `node:zlib.deflateSync` plus a CRC32 — about 80 lines, no `node-canvas`, no headless browser, no native build step. The whole art pipeline stays `npm ci`-clean and runs in CI in about a second.

The rasteriser itself is pure JS with no Node APIs (only the PNG *writer* touches `node:zlib`), so **the same module runs in the browser** to bake a user pack that shipped descriptors but no atlas — straight to a canvas, cached in OPFS keyed by `artHash`. One rasteriser, two hosts, zero divergence.

### 15.4 What else this generates

The same pipeline, pointed at different part sets: **dungeon tilesets** (§6, per-floor palette so floors read differently), **FX sprites** for the ~12 attack templates, **item icons**, **portraits** (crop the head region of `idle` frame 0). One generator, four asset classes, one consistent look.

And two things fall out that are hard to get any other way:

- **Coherence is free.** A 120-unit roster assembled from mixed sources looks like a jumble; one generated from 60 parts and 15 ramps is stylistically unified by construction.
- **Variants cost nothing.** An elite or ★2 form is `{"extends": "core:bone_chanter", "palette": {"ramp": "core:ember"}, "parts": {"head": {"shape": "core:skull_crowned"}}}`. Six lines.

### 15.5 Escape hatches

Neither of these is optional — a pipeline with no way out becomes a ceiling:

- **Hand-drawn art is always allowed.** A descriptor may be `{"id": "...", "type": "sheet", "src": "art/mine.png", "frames": {...}}` and the baker passes it through. Generation is the default, not the requirement.
- **Mods patch descriptors** like any other JSON (§13.2), so a full-roster recolour mod is a dozen patch ops and no PNGs at all — which is only possible because art source is data.

---

## 16. Tooling and content pipeline

### 16.1 Everything that can be JSON, is

The default is JSON; JS is the exception and needs a reason. What that covers:

| In JSON (`packs/`) | In JS (`src/`) |
|---|---|
| units · abilities · items · statuses · pacts · resonance | the 7 kernel primitives (§11) |
| **banners** · nodes · spawn tables · floor recipes · shop tables | op *implementations* (§11.4) |
| **commands** — verb, cost, and the ops it runs (§2.6) | expr form *implementations* (§11.6) |
| **ascent.json** — one patch set per rung (§5.3) | the command queue and the chooser (§2.6, §4.6) |
| anim templates · art descriptors · rigs · clips · parts · palettes | |
| **tuning.json** — every constant in §2 and §5: clamps, `CRIT_MULT`, variance range, gauge base + spd divisor, damage `atkDivisor`, row modifiers, affinity matrix, persuade base table + decay, damage escalation, XP curve, recovery percentages, **command budget and durations, coin rates, map rank/branch counts** | save migrations (§14) |
| doctrine presets · starting loadouts · codex entries · UI strings | the renderer and UI |
| **dispatches** — trigger and copy; no offers, because a report does not answer itself (§4.1) | the signal ledger (§4.3) |
| **tenets** — name, **price in Coin**, prerequisites, and exactly what buying it grants (§4.2, §5.1) | |

Pulling the §2/§5 constants into `tuning.json` is the one that pays immediately: it makes the entire balance surface a single reviewable file, patchable by mods, hot-reloadable while a battle runs, and sweepable by `tools/balance.js` without editing code.

Mechanics:

- **Plain JSON, not JSON5 or YAML** — maximum tool compatibility, and it stays parseable by the in-game editor later. For comments, every schema permits a `_note` field that the loader ignores.
- **A JSON Schema per content kind** in `packs/core/schemas/`, referenced by `$schema`. Editors then autocomplete and red-underline content authoring, including a modder's, with no plugin to install.
- **Content is never imported.** No `import units from './units.json'` — everything arrives through the pack loader, so first-party and third-party content take one identical code path (§13.1).

### 16.2 Commands

```
npm run dev            # vite; watches packs/** → hot-reloads registry (§16.3)
npm test               # node --test  (sim only, no browser)
npm run art            # bake all stale descriptors      (tools/art.js)
npm run art -- --force --pack kindled          # full rebake of one pack
node tools/sim.js      --seed 42 --floors 8 --doctrine my.json   # headless run, JSON out
node tools/balance.js  --n 2000 --tier 3 > balance.csv
node tools/lint.js                             # schema + dangling refs + orphan paths + stale art
node tools/modcheck.js packs/kindled           # validate a pack, report patch overlaps
node tools/replay.js run.replay --verify       # re-sim, assert identical timeline hash
node tools/newpack.js myMod                    # scaffold a pack with schemas wired up
```

`tools/lint.js` runs in CI and pre-commit and is the content author's fast feedback loop: every def validated against its schema, every id reference resolved, every modifier path checked, every expr form known, every art descriptor baked and current. Content bugs should be caught in under a second by a linter, never at tick time by a stack trace.

### 16.3 The tuning loop

Vite watches `packs/**`. On a JSON change: rebuild the registry, re-freeze, and restart the current battle **from its seed** — so a damage tweak is visible in under a second, in situ, without losing your place. On an art descriptor change, `npm run art` rebakes just that unit and the atlas hot-swaps.

This loop is the actual reason 120 units and ~30 Pacts are achievable by a small team. It's also, not coincidentally, the modder's loop — same door (§13.1).

---

## 17. Build order

Kernel first. It's ~900 lines and it decides the shape of everything after it. Then the pack loader — **before** any content exists, so there was never a pre-mod way of doing things to migrate away from.

| | Deliverable | Gate |
|---|---|---|
| **K0** | `kernel/` — all seven primitives + unit tests + `tools/lint.js` | Registry freeze works; expr evaluates; modifiers order-independent under shuffle; RNG streams independent |
| **K1** ★ | **Pack loader + `packs/core/` as a pack** + schemas + 6 units, 8 abilities, 5 ops, 3 statuses, `tuning.json` — all JSON | Nothing under `src/` imports a content file; `core` loads through the public loader only |
| **K2** ★ | **`tools/art.js`** — 1 rig, 6 clips, 12 parts, 2 palettes, 6 baked units | Two descriptors → two visibly different units, byte-identical across machines |
| **M0** | Vite + Phaser 4, dungeon generator, leader + follower chain (using baked art) | §9 |
| **M1** | `resolve.js` ≤ 250 loc + `BattleScene` timeline playback | §9 — plus: adding a 7th unit is **one JSON file plus one descriptor**, no code |
| **M2** | Roster, tags, Resonance, party, persuade — Resonance implemented as `{modifiers, hooks, when}` with no bespoke code | A Pact and a Resonance share one code path |
| **M2.5** ★ | **Third-party pack path: zip install → OPFS, sandbox, a real external test pack** | Load core + test pack in 5 random orders → identical registry hash and identical battle timeline |
| **M3** | Doctrine editors over expr trees; export/import Doctrine strings | A Doctrine round-trips through JSON unchanged |
| **M3.5** ★ | **`signals.js` + `tenet` and `dispatch` content kinds + the Codex shop and the report feed**; the five editors reframed as surfaces drawn from what was bought | A pack ships a dispatch that watches its own signal with no `src/` change; a run that reports plays identically to one that reports nothing; and **a Doctrine cannot say anything its holder did not buy** — ✅ all three, §19 |
| **M4** | Floors, nodes, **XP + levelling**, boss, run economy, save + migrations + repair pass | Removing the test pack loads the save with a readable report — **and a seeded run reaches floor 4 without a hand-built party** |
| **M5** ★ | **The play surface** — `commands.js` · `choice.js` · the ranked one-way map · the spoils screen | §10's three M5 checks: a replay reproduces exactly, a Command changes the outcome, and the map is a real choice |
| **M5.5** ★ | **The run economy** — Coin as the only currency (delete `residue`/`insight`, retire the Lattice, move Tenets to Coin), items + merchants, `ascent.js`, post-mortem | Coin conservation across a run; a save carries **no** cross-run balance; Ascent 5 measurably lowers the clear rate against Ascent 0 on the same 20 seeds |
| **M6** | Pacts, Banners, branches, fusion, ~40 units | The last 20 units are pure content, zero `src/` commits |

**K1 is where mod-friendliness is actually won.** Not M2.5 — by M2.5 the only thing left is *delivery* (zips, OPFS, sandboxing), because the loader has been the sole path to content since before there was content. This is the cheap version of a decision that is brutally expensive later: retrofitting a mod system means auditing every system for hardcoded assumptions, while doing it at K1 costs a day and makes every subsequent system moddable by default, since no other option ever existed.

**K2 before M0** so the art pipeline is exercised on real units before any scene is written, and M0 walks a dungeon with generated sprites rather than coloured rectangles that have to be replaced later.

The M6 gate is the real test of the whole plan. If the last twenty units land as JSON and descriptors with no `src/` commits, the kernel worked.

---

## 18. Invariants (CI-enforced)

Cheap greps and tests that keep the architecture from eroding. Each one exists because violating it silently is easy and expensive.

1. **No Phaser under `src/sim/`** — grep. The rule the whole design rests on.
2. **No `Math.random` / `Date.now` / `new Date` / `performance.now` under `src/sim/` or `tools/art.js`** — grep. Nondeterminism must be impossible, not discouraged.
3. **No bare content ids** — every id matches `^[a-z0-9_]+:[a-z0-9_]+$`.
4. **No dangling references** — `lint.js`, boot-time and CI.
5. **Determinism regression** — fixed seed → stable timeline hash (§10).
6. **Mod-order fuzz** ★ — load the packs in random permutations; assert identical registry hash *and* identical timeline hash. The moddability twin of #5, and the single most valuable test in Part II.
7. **Modifier commutativity** ★ — shuffle a modifier list 100×, assert identical resolved stats.
8. **Registry frozen before tick 1** — a mutation attempt during simulation throws.
9. **`resolve.js` ≤ 250 lines** ★ — a proxy for "no ability logic leaked into the resolver".
10. **Save round-trip + migration chain** — a v1 fixture loads on the current version, every version. Enforced in two halves: `lint.js` asserts the fixture corpus actually covers the chain (so bumping `SAVE_VERSION` fails until the version it left behind is committed), and `test/sim/save.test.js` walks every fixture through every migration above it and asserts the result loads.
11. **Battle fuzzer** — 10k headless battles: tick ceiling, no negative HP, no double-action (§10).
12. **No content under `src/`, no code paths around the loader** ★ — grep for `.json` imports in `src/`, and assert `packs/core/` loads through the same public entry point as a third-party pack. This is what keeps §13.1 true after the tenth deadline.
13. **Baked art is fresh** ★ — re-bake in CI, compare hashes against `packs/*/art/baked/manifest.json`. Stale committed art fails the build.
14. **Content is plain JSON** ★ — every file under `packs/*/content/` parses with `JSON.parse` and validates against its `$schema`.
15. **The renderer never resolves** ★ — grep `src/engine/` and `src/ui/` for calls to `runBattle` · `resolveTick` · `awardXp` · `gainXp` · `addRecruits` · `makeFoes` · `generateFloor` · `pickSpawns` · `endRun` · `battleCoin` · `bankRun` · `raiseDispatches` · `buyTenet` · `applyCommand` · `pickRoom`. The twin of #1, pointing the other way: #1 stops the sim importing the renderer, this stops the renderer *becoming* the sim. Added after exactly that happened — the run loop grew inside `DungeonScene` a node at a time, because every individual addition looked like scene code at the time. Reading sim state is fine; deciding it is not, so the ban is on the verbs, not the imports.

    **Amended for a game that now takes input.** Two functions are explicitly *not* banned, and they are the only two: `commands.queue({tick, verb, args})` and `chooser.choose(choice)`'s return. Both carry a human gesture inward and neither computes anything — the UI relays a click and an index, and the sim decides what they mean. The line to hold, because it is the one that will be crossed by accident: **`args` may contain ids the UI read out of sim state, never values it computed.** A `focus` command names a `uid`; it does not name a damage number, a target *priority*, or a resolved ability. The grep for `applyCommand` and `pickRoom` is what catches the refactor where the UI starts doing the second thing "just to make the button feel responsive".

17. **A recorded run replays to the byte** ★ — re-sim `{seed, modset, doctrine, ascent, choices[], commands[]}` and assert an identical timeline hash per battle and an identical final roster. This is #5 extended over the two channels that now carry player input, and it is the invariant that keeps determinism meaningful in a game that takes input at all. It fails in exactly one interesting way — a command applied by wall-clock arrival rather than by its stamped tick — which is why §8 states that rule twice.
16. **The sim writes signals and never reads them** ★ — grep `src/sim/combat/` and `src/sim/policy/` for `signalCount` · `signalSince` · `hasTenet` and for any read method on a ledger. §4.3's one rule, made mechanical. Profile-scoped counters are save state, so a read inside `resolveTick` would make combat depend on how much the player had played, and #5's determinism regression would start passing or failing according to save history rather than according to the code. Enforced in three places, because this is the seam the whole ledger rests on: a battle receives a **write-only** face of the ledger with one method on it, `forms.validate` refuses the three ledger forms anywhere but a dispatch's `when` (§11.6's asymmetry, now checked rather than described), and this grep catches the future refactor that threads the real ledger through "just for a moment".

---

## 19. Build status

*Audited against the tree on 2026-08-10. 352 tests pass; `npm run lint` passes all 16 invariants; `npm run build` is clean. Every number below comes from `npm run lint`, `npm test` or `tools/sim.js` — none of them from memory.*

> **Everything in this section is a measurement of the tree as it stands, which is the tree the
> *previous* design built.** The pivot in §1–§6 — one currency, Ascent instead of prestige, a played
> game instead of an idle one — is a plan change and nothing has been written for it yet. Read the
> gate table as *what exists*, and the section immediately below it as *what the pivot does to what
> exists*. Nothing here is retracted: K0–M4 all pass their gates, and the pivot's cost is confined to
> a list short enough to enumerate, which is itself the strongest evidence the kernel was the right
> place to spend the first thousand lines.

> **The previous edition understated one gate and overstated nothing else.** It listed M4 as needing "`economy.js` · `save.js` · boss", which read as three files of similar size. Two of those were files; **boss was nothing at all** — `generateFloor` placed a boss node on floor 8, `BATTLE_NODES.boss` fielded *six ordinary foes* at it, and the unit schema (`additionalProperties: false`) could not even express `boss: true`. A "boss fight" was a large encounter wearing the name. That is the shape to watch for in this section: a gap listed beside two real files, sized by how short its name is.

| Gate | State | Evidence |
|---|---|---|
| **K0** kernel | ✅ done | 7 primitives, 802 loc of code against §11's 900 target |
| **K1** pack loader + `core` as a pack | ✅ done | 16 content kinds, 16 schemas, loads only through the public loader |
| **K2** art baker | ✅ done | zero-dep PNG writer, byte-identical rebake asserted in CI |
| **M0** dungeon + walking | ✅ done | `dungeon.js` 261 loc, all 10 node types generated |
| **M1** resolve + timeline playback | ✅ done | `resolve.js` **140 loc** of the 250 budget |
| **M2** roster, tags, Resonance, persuade | ✅ done | Resonance and Pact share one `{modifiers, hooks, when}` path |
| **M2.5** mod delivery | ⬜ open | sandbox exists; zip → OPFS does not |
| **M3** Doctrine editors | ✅ done | all five editors live; a Doctrine round-trips and exports as a string |
| **M3.5** ledger + Tenets + Dispatches | ✅ **done** | `signals.js` · `tenet.js` · `dispatch.js` · two content kinds · the Codex shop · the report feed. **Run 1 can say nothing, and the only way that changes is a purchase.** All three halves of §17's gate asserted in `test/sim/tenet.test.js` and `test/sim/dispatch.test.js` |
| **M4** floors, boss, run economy, save | ✅ **done** | `spawn.js` · `economy.js` · `save.js` · `migrations.js`; **15 of 20 seeded runs reach floor 4 and 14 kill the floor-8 boss** |
| **M5** the play surface | ⬜ open | needs `commands.js` · `choice.js` · the ranked map in `dungeon.js` · the spoils screen |
| **M5.5** the run economy | ⬜ open | needs items, merchants, `ascent.js`, the post-mortem; and needs `economy.js` cut roughly in half |
| **M6** Pacts, Banners, branches, fusion | ⬜ open | needs `fusion.js` |

### What the pivot costs, enumerated

The point of enumerating it is that it is short. Three files change shape, one shrinks, and nothing in `kernel/` is touched at all.

| Built thing | Fate | Why |
|---|---|---|
| `kernel/` — all 7 primitives | **untouched** | A Banner, a Command and an Ascent rung are all `{modifiers, hooks}`, an op list and a patch set. This is §11's claim being tested by a design change it was never shown, and passing |
| `combat/` — resolve, formula, formation, persuade, rules | **untouched but for one argument** | `resolveTick(state, rng, ctx)` gains `ctx.commands`. The formula, the grid, the affinity matrix and the escalation all stand |
| `dungeon.js` (261 loc) | **rewritten, ~60% kept** | Tiles, rooms, corridors and node payloads survive; node *placement* becomes ranked DAG wiring. The generator's shape changes, its output type gains three fields |
| `economy.js` (146 loc) | **cut to ~60 loc** | `runResidue`, `floorResidue` and `insightFrom` are deleted outright with the tuning keys behind them. `battleCoin` and the Codex counter stay and grow |
| `tenet.js` (187 loc) | **kept; one number changes** | `capabilities()`, `validate()`, the pricing and the itemised export-string check are all currency-agnostic. What changes is that `price` is subtracted from Coin and the whole thing resets at run end |
| `dispatch.js` · `signals.js` | **kept, demoted** | The ledger still feeds the post-mortem and the Codex. Dispatches become a lighter post-battle line, because the player was watching |
| `ui/editors/route.js` · `ui/editors/succession.js` | **deleted** | Both automate a decision the player now makes (§4.2's amendment). Route's predicates move to `doctrineChooser` |
| `ui/shop.js` | **moved** | From a between-runs Codex screen to the merchant node |
| `lattice.js` · `workers/simWorker.js` | **never written, and now never will be in that form** | The single luckiest consequence of the ordering: the two biggest pieces of the idle design were the two that M5 had not started. The worker returns for counterfactuals only |
| 22 Tenets · 9 Dispatches · 3 spawn tables · 7 units · all art | **untouched** | Content survives a design pivot, which is the entire argument of §12 and §13.1 |

**The one genuinely uncomfortable line** is that `test/sim/tenet.test.js`'s M3.5 gate — *a Doctrine cannot say anything its holder did not buy* — was written against a profile-scoped balance and now has to hold against a run-scoped one. The assertion does not change; its fixture does. Worth naming because it is the only test in the suite whose *premise* the pivot moves rather than its numbers.

**The M3.5 gate, measured rather than asserted.** §17 asks for three things now, and the last two are the ones that carry the design.

*A pack ships a dispatch that watches its own signal, with no `src/` change* — `test/fixtures/kindled/content/dispatch.json` is 15 lines of JSON gating on `kindled:ember:missed`, a signal name nothing in `src/` has ever heard of. No code was added for it and none could have been: `when` is the same evaluator every other gate uses.

*A run that reports plays identically to one that reports nothing* — six seeds, played twice each: once with a ledger holding a lifetime history so reports genuinely fire mid-run, once with a ledger that notices nothing. Floors, end reason, Residue, Coin, final roster with levels, **and the hash of every battle timeline** are equal across both arms. The equality is structural rather than lucky: `raise()` is handed no RNG stream, so `rand` throws inside a dispatch's `when` instead of quietly consuming a draw and shifting everyone's loot.

*★ A Doctrine cannot say anything its holder did not buy* — the check that makes prices mean anything, and the one that was not in the plan before this milestone. `validate` prices every rule against `capabilities()`: too many rules for the slots bought, a chip no tenet granted, an action or a targeting mode nobody paid for, a route field left unopened. It is reported as errors so `commit()` refuses them rather than silently deleting rows, and it applies to an imported export string too — so a shared Doctrine is an itemised bill rather than a way of handing somebody the whole game.

**Two numbers from playing it, both of which changed the design.** The chip dropdown of a player holding exactly one tenet was **23 options** and is now **3** (`value · HP % · if / then / else`); the difference is that arithmetic moved to the paid side of `STRUCTURAL_GROUPS` after the first browser run showed thirteen maths chips in a menu that should have had two entries. And the shop is **22 tenets costing 53 Codex** against a current ceiling of about 14 — one boss, seven species, six Pacts — so it is about a quarter affordable at full discovery and cannot be finished.

**The M4 gate still holds**, re-measured after all of the above. Nothing in this milestone touches what a run does, which is the same claim the second gate makes, checked a second way.

**The M4 gate, measured rather than asserted.** §17 asks for two things. *A seeded run reaches floor 4 without a hand-built party* — `node tools/sim.js --runs 20` reports **15/20 (75%)**, median floor 8. *Removing the test pack loads the save with a readable report* — `test/sim/save.test.js` builds a save against core + `kindled`, loads it against core alone, and asserts a `contentChanged` report naming the dropped unit and a party that survives the repair. Neither number was checkable before this milestone, because nothing could play twenty runs without a browser.

**Code.** Added at M4: `spawn.js` (spawn tables and depth scaling) · `economy.js` (Residue · Coin · Codex · Insight) · `save.js` · `migrations.js`. Added at M3.5: **`signals.js`** (the ledger) · **`tenet.js`** (capabilities, prices, the shop) · **`dispatch.js`** (raise, cap, report) · `ui/shop.js` · `ui/dispatch.js` · `ui/editors/succession.js`. Still missing: **`fusion.js` · `coherence.js`** (a placement nit — it is inside `synergy.js`) · **`workers/simWorker.js`**, and now also **`commands.js` · `choice.js` · `ascent.js`**. `lattice.js` was on this list in every previous edition and is struck rather than built — the one line in this section the pivot deletes outright.

**Ops: 7 of ~20 registered.** `damage` `heal` `apply_status` `cleanse` `gauge` `persuade` **`emit_signal`**. Notably, **boss phases needed none of the missing thirteen**: a phase is a data row granting an ordinary status, which is §11.5 paying out exactly as designed. `emit_signal` is the one §11.4 shipped with no stated consumer and §4.3 turned out to need — kept, in the end, for exactly the reason §11.4 gave for keeping it.

**Tools: 7 of 9.** Built: `lint.js` `art.js` `modcheck.js` `fmt.js` `schema.js` **`sim.js` `balance.js`** (plus `harness.js`, the shared boot both use). Missing: `replay.js` `newpack.js`.

**Invariants: 16 of 16 enforced.** §18.10 is live in `lint.js` (the fixture corpus covers the chain) and in `test/sim/save.test.js` (every fixture walks it and loads). §18.15's verb ban grew five entries — `pickSpawns` `endRun` `battleCoin` `bankRun` `raiseDispatches` `buyTenet` — because pricing a run is a decision, and so are deciding that something is worth reporting and whether a purchase is legal. **§18.16 is new**: the sim writes signals and never reads them.

**Content.** In `packs/core/`: **7 units** of ~40 (one of them the first boss) · 11 abilities · 6 elements · 8 Kin · 6 Roles · **5 statuses** · 15 Resonance · 6 Pacts of ~12 · **3 spawn tables** · **22 Tenets · 9 Dispatches** · 3 anim templates of ~12 · 1 rig of ~5 · 6 clips of ~30 · 19 parts of ~60 · 10 palettes of ~15 · 8 art descriptors · **0 items · 0 Banners · 0 branches** (and 0 Lattice nodes, which is now the correct number rather than a gap).

> Count `packs/core/` alone, not the registry. `tools/lint.js` reports one more unit and one more ability because it loads the `kindled` fixture alongside core — §13.1 working as designed, and a reliable way to over-count the roster by one.

### What M4 measured, now that measuring is possible

The harness paid for itself immediately, and two of the three things it found are unresolved. They are recorded here rather than fixed, because they are balance decisions and this section's job is to stop a measurement decaying into folklore.

1. **Battles run long past floor 2.** §1 sets a 15–40 s band and §2 records "battles land at ~19 s". That holds on floors 1–2 (19–20 s) and stops holding immediately after: floor 3 means 29 s, floor 4 means 32 s with a p90 of **52 s**. The band is a design constraint that current content misses by a third, and `node tools/balance.js` prints it in one line.
2. **The recruit loop churns.** A full 8-floor run recruits a mean of **61 units** into a 12-slot party — roughly fifty cuts per run. The acquisition loop works; the *cut* rule turns it into a conveyor belt, and "every recruit past 12 is a decision about what you're willing to lose" (§2) is not what 50 automatic cuts feel like.
3. **Outcomes are bimodal.** Of 20 seeded runs, 5 die on floor 1 and 14 clear the game. Almost nothing lands in between. Whatever the right difficulty curve is, it is not one with no middle.

None of these was visible before `tools/sim.js` and `tools/balance.js` existed, which is the whole of §19's twice-repeated point about the balance harness.

**And then the pivot moved two of the three, without a line of code being written.** This is worth recording carefully, because "the design changed so the bug went away" is usually a way of not fixing something:

1. **Battle length was a miss and is now nearly a hit.** The 15–40 s band was set for a run you fast-forward through 128 rooms of; the band for a watched fight with three Commands is 30–60 s (§2). Floor 3–4 at 29–32 s lands inside it, and **the failing end is now floors 1–2 at 19 s** — too short to contain a decision. The measurement was always right; it was being compared against a number derived from a design that no longer exists. *The correct response is to make early fights longer, which is the opposite of what finding 1 originally implied.*
2. **Recruit churn is fixed structurally, and the number to check is stated in advance.** Persuade now costs a Command (§2), which caps attempts at 3 per battle and prices them against Focus and Unleash; and a recruit into a full party stops at a swap-or-decline screen. Predicted: **≤ 12 attempts and ≤ 6 accepted recruits per run**, against a measured 61. If it lands anywhere near 61 after M5, the Command cost is not doing what this paragraph claims and the claim is wrong, not the measurement.
3. **The bimodal curve is untouched and is now the top balance risk.** 5 of 20 runs die on floor 1 and 14 clear the game, with almost nothing between. Under the old design that was survivable — a floor-1 death still banked Residue and the meta tree eventually pushed you past it. **Nothing pushes you past it now.** A player who dies on floor 1 gets a Codex entry and a post-mortem, and if the curve stays bimodal, Ascent 1 is unreachable for a quarter of players and irrelevant for the rest. *Removing the meta-progression removed the thing that was quietly papering over this*, which is the honest cost of the pivot and the reason this is finding 3 rather than a footnote.

The general shape, since it has now happened twice in this document: **a measurement is a fact and a target is a design choice, and it is the target that moves.** Findings 1 and 2 were never really about the sim's behaviour; they were about what behaviour we had decided to want.

### Debts to repay, in order

Repaid, kept because the reasoning is the useful part:

0. ~~**The Doctrine never reached combat.**~~ **Done** — and worth recording, because the shape recurs. `resolve.js` called `chooseAction(ctx, unit)` with no doctrine, so policy defaulted to the frozen shipped set on every tick of every fight, and **every test passed** — each one either used the default set or asserted determinism, and the bug was perfectly deterministic. The lesson generalises: **a plumbing gap in a system with no consumer yet is untestable by construction**, so the test to write is the one that asserts the consumer's effect, not the plumbing's presence.
1. ~~**XP and levelling has no implementation.**~~ **Done** — `progression.js`, wired into the run loop.
2. ~~**Between-encounter recovery lives in `DungeonScene`.**~~ **Done** — `run.js` owns the floor, the route, the battles, recovery, XP and recruitment. Enforced by §18.15 rather than by good intentions.
3. ~~**The kernel is 1052 lines against a 900-line target.**~~ **Not a debt — a measuring error.** 802 lines of code; the count included comments.
4. ~~**`battle.js` sits outside the §18.9 budget that `resolve.js` respects.**~~ **Done** — core rules moved to `combat/rules.js`, and all three files carry a budget `npm run lint` checks.
5. ~~**`tuning.json`'s tick ceiling disagrees with its own `_note`.**~~ **Already fixed** when re-checked.
6. ~~**Three editors have a backing field and no surface.**~~ **Done** — Formation, Ability and Route are live.
7. ~~**Formation pins are keyed by uid, and uids belong to a run.**~~ **Done — pins now name a unit def.** The old note framed this as "a stored pin is dead the moment a run ends", which undersold it: a Doctrine is meant to be a **shareable export string** (§11.6), and a uid-keyed pin makes every shared Doctrine broken by construction — your pins name *your* instances and mean nothing in anyone else's game. Keying on the def is the only choice that is true across both a run boundary and a share. `DOCTRINE_VERSION` went to 2; v1 pins are dropped by `normalize` rather than guessed at, because a pin that silently lands on the wrong unit is worse than one that is gone. When a party holds two of the same def the pin takes the lowest uid, which is stated rather than incidental.
8. ~~**`tools/sim.js` and `tools/balance.js` still do not exist.**~~ **Done** — plus `tools/harness.js`, the shared boot, so the two tools cannot disagree about which packs are loaded. `balance.js --sweep damage.atkDivisor=10,20,28,40` re-runs the whole measurement against a patched tuning path in about a second, which is the literal thing §19 twice said would have caught the gauge and divisor errors.
9. **Formation placement changed shape** (kept — the note still stands). `assignFormation` keeps a unit where it stands rather than re-deriving the grid after every fight. Battle-level determinism is untouched; the *run* fingerprint past the first recruit moved once, on purpose.

Open:

10. **A recruit's `recruitedBy: undefined` broke the save round-trip, and the class of bug is worth naming.** An `undefined` value is a *present key* in memory and an *absent* one after `JSON.stringify`, so a recruited unit and its saved form were not the same object — a §14 round-trip failure that no test before `save.js` could have seen. Fixed by destructuring the field away rather than blanking it, and `test/sim/save.test.js` now walks a whole save asserting nothing is `undefined`. Left open as a **standing question about every other battle-only field**: `left`, `gauge` and `persuadeAttempts` are all reset rather than removed, and the audit that they should be is unwritten.
11. **The three balance findings above — now one finding and two predictions.** Battle length and recruit churn both have stated targets and stated mechanisms (§19's revised findings 1 and 2), so they become measurements to take rather than questions to answer. **The bimodal outcome curve is the one that got worse**, because removing the meta-progression removed the thing that let a floor-1 death eventually stop happening. It is the top balance risk in the project and it is unowned.
12. **Codex under-counts Pacts.** `discoveriesFrom` reads the opening `battle:start` event, so a Pact that only came online mid-fight — after a death dropped a count — is not credited. Deliberate and documented at the call site: crediting it needs either a second event or state the battle does not otherwise carry. Worth revisiting when M6 ships the other ~24 Pacts, at which point the under-count stops being a rounding error.
13. ~~**§4's interaction model was rebuilt after M3 shipped it, and M3 was not wasted.**~~ **Rebuilt twice, and the second rebuild is the one that found the real problem.** M3.5 first shipped §4 as written — Precedents offering rules, six Disciplines handed over one at a time — and it did fix the timing. What it could not fix from inside its own frame is that the game was choosing *for* the player, in the one place where choosing is the entire game. Both rebuilds cost the same thing and taught the same lesson at a different depth: **a shape can look correct in the plan, pass every gate in §10 and §18, and only read as wrong once somebody plays it.** M3's five-editor tab passed "a Doctrine round-trips through JSON unchanged", which is a statement about data that is entirely silent about whether a person would ever write one. M3.5's Precedent passed "an ignored Precedent costs nothing", which is silent about whether the player or the game was doing the deciding. Both times the machinery survived intact — the chip editor, the validator, the fire counts, the expr trees, the export string are the same files across all three designs — and both times what changed was *who acts and when*. That is worth recording as the shape to expect: **the parts of this plan most likely to be wrong are the ones about agency, and no test in §10 can catch one.**

    The original diagnosis is worth keeping in full:

    **§4's interaction model was rebuilt after M3 shipped it, and M3 was not wasted.** The five-editor tab did everything it was specified to do; the specification was the problem. Every rule was authored in an empty list, behind a key the player had to know to press, at the moment furthest from the thing the rule was about — a self-playing game with all of its interaction filed away in a settings screen. §4.1–4.3 replace *when a rule arrives* (a Precedent, raised after the fact, never waited on) and *how many surfaces exist* (zero on run 1, six by run 6) while keeping the chip editor, the validator, the fire counts, the expr trees and the export string exactly as they are. Worth recording as a debt rather than a design note because of what it cost to find out: **the tab model looked correct in the plan, passed every gate, and only read as wrong once someone played it.** No test in §10 would ever have caught it, and the M3 gate — "a Doctrine round-trips through JSON unchanged" — is a statement about data that is entirely silent about whether a person would ever write one.
14. ~~**Nothing spends Coin.**~~ **Not repaid — promoted.** It accrued correctly and bought nothing, because merchants needed items and items were M6. Coin is now the *only* currency (§5.1) with five sinks, and items moved to M5.5 for exactly this reason. Worth keeping the entry, because the debt turned out to be a symptom: a currency with no sink is usually a currency the design does not need, and this game had three of those and one real one. **The diagnostic generalises — when a sink keeps slipping a milestone, ask whether the currency should exist**, not when the shop ships.
15. ~~**Succession is a panel with nothing to prefer.**~~ **Deleted, not repaid** — §3 moves the branch pick to the spoils screen, where it is a prompt about a unit the player just watched earn it. The Tenet is retired and the panel goes with it. The old entry is kept below because its *reasoning* was correct and its conclusion was a consequence of the never-touch-the-controls rule, which is the thing that changed:

    **The original, for the record.** *(Unchanged by the tenet rebuild — it is now a tenet with nothing to prefer, and `Which branch at 5 and 10` is the one row in the shop whose subject does not exist yet.)* The sixth Discipline is real — the `branch` field, the editor, the rule list, the `when` evaluation at level-up, the Precedent that fires the first time a unit picks for itself — and **`packs/core/` ships zero branch defs**, because branches are M6. So the one Discipline the player cannot yet be offered is the one §4.2 says arrives on their first level-5 unit. This is the honest ordering rather than a gap: the alternative is two placeholder branches shipped early, which is exactly the "shop selling placeholders" mistake one line up. Recorded because it is the shape §19's own preamble warns about — a gap listed beside five working panels, sized by how short its name is. The check when M6 lands is a single seeded run reaching level 5 and raising `core:learn_succession`.
16. **A report's body can name something the ledger no longer remembers, and the fix was structural rather than editorial.** A Precedent gated on a *lifetime* count could fire on a fresh session, at which point a run-scoped payload ring held nothing and the copy read "the last was —, a —". Found by playing it in the browser, not by any test, and worth naming because the class recurs: **a counter that outlives a run and a payload that does not are not two independent decisions** — the sentence on the card needs both. Fixed by persisting the most recent payload per signal alongside the profile counters, and by collapsing the ring rather than clearing it at `beginRun`. The remaining hazard is a content one: a pack whose body names `{last:X}` while its `when` only counts X at profile scope will read badly the first time it fires on a fresh save. Not enforced — a validator that tried would have to parse copy — so it is documented in the schema and left as a thing a pack author can get wrong.
17. **A dispatch that recommends is a Precedent wearing a report's clothes, and only a test of the *copy* catches it.** The kind refuses an `offers` field outright, which stops the mechanism coming back; nothing structural stops a body from reading "you should be parleying". `test/sim/dispatch.test.js` greps every shipped title and body for `you should` · `consider` · `try` · `buy` · `tenet` · `unlock` · `learn`, which is a blunt instrument and will need loosening the first time a legitimate line contains the word "learn". Kept blunt on purpose: the failure it guards against is gradual, one helpful sentence at a time, and a test that fires on a false positive costs a minute while the thing it prevents cost this milestone twice.
18. ~~**Nothing spends Residue.**~~ **Deleted with the currency.** The old entry read: *"§5 gives Doctrine nodes to Residue and Tenets to Codex — two currencies for depth and breadth — and only the Codex half is built, because the Lattice is M5. So a run banks Residue that buys nothing, exactly as it banks Coin that buys nothing (debt 14). Two idle currencies is one more than is comfortable, and it is the strongest argument for M5 being next."*

    It was the strongest argument for M5 being next, and it was pointing at the wrong M5. **Two idle currencies out of four is not a scheduling problem; it is the design telling you it has more currencies than jobs.** The fix that got built in the plan is to have one currency, one sink list, and nothing that survives a run. Recorded at length because the reasoning in the original entry is *correct up to its last clause* — it diagnosed the symptom exactly and then prescribed building the thing that would have added a fifth idle screen.

19. **The Ascent needs a difficulty curve it does not have yet.** §5.3 ships fifteen rungs as `tuning.json` overlays, which is cheap and right — and completely untested, because the base game's outcome curve is bimodal (finding 3) and a ladder built on a bimodal base amplifies it rather than smoothing it. The check when M5.5 lands is not "does Ascent 5 lower the clear rate" (it trivially will) but **"is there a rung where the clear rate is near 50%"**. If every rung is either 75% or 5%, the ladder has fifteen rungs and two difficulties.

20. **Nothing has been built for the pivot, and the estimate above is a plan's estimate of itself.** §19's own enumeration of what the pivot costs is the least trustworthy passage in this document, for the reason §19 keeps re-learning: a gap sized by how short its name is. "The ranked map in `dungeon.js`" is one table row and is a rewrite of the file M0 was built around; "the spoils screen" is one row and is a new UI surface with a blocking contract behind it (§4.6). **The first thing M5 should produce is a corrected version of that table**, measured rather than estimated.

## Decided

- **Repo layout** — Phaser project at root, prototype restored into `legacy-pygame/`, and **content in `packs/` from the first commit with `packs/core/` as a pack like any other** (§8, §13.1). Mod-friendly is a day-1 structural property, not a later feature.
- **Content format** — JSON everywhere it can be, including tuning constants, anim templates and art descriptors; JS reserved for the kernel, op implementations and migrations (§16.1).
- **Art** — neither placeholders nor a purchased pack: **generated from JSON descriptors, baked to committed atlases** (§15), with hand-drawn art always accepted as an escape hatch. Exercised at K2, before the first scene.
- **The party is collected permanently and levelled per run** (was open question 6, decided at M4 because `save.js` could not be written without it). The profile owns a `collection` of unit ids — who is *allowed* to turn up, which the Codex widens by discovery (§5.4) — and each run instantiates fresh from it. So **the Codex decides who can appear and the run decides who gets strong.** The alternative, a roster that levels forever, makes §1's roguelite frame decorative: nothing is at stake in a wipe if the party walks away with its levels. This also settled debt 7, since a fresh roster each run is what makes a uid-keyed pin meaningless. *The pivot strengthens this rather than changing it: it is now the only thing that persists at all.*
- **One currency, and it dies with the run.** Coin, five sinks, zero balance carried out (§5.1). Residue, Insight and the Codex *balance* are deleted; the Lattice is deleted with them. Decided because two of four currencies had accrued for a whole milestone without a sink, and the honest reading of that is that the game had more currencies than jobs.
- **Prestige is the Ascent and it grants nothing** (§5.3). Fifteen fixed, ordered rungs, each one named rule change that makes the game harder, implemented as a `tuning.json` patch overlay. No multiplier, no unlock, no currency. The reward for clearing Ascent 7 is that Ascent 8 exists.
- **The player watches and decides.** Combat auto-resolves from standing orders; the player spends 3 Commands a battle to override it (§2.6) and makes every between-fight decision directly (§4). The Doctrine is demoted from *the whole game* to *what happens when you are not overruling it*, and gets a real exchange rate for the first time: a rule that works is a Command you keep.
- **The floor is a one-way branching map** (§6). Rooms are chosen, corridors close behind you, and a floor of 14–18 rooms is a run of 6–8. This deletes the Pathfinding surface and is the largest rewrite the pivot asks for.

## Open questions

1. ~~**Offline cap** — 8 hours at 60% efficiency, or longer and harsher?~~ **Moot.** There is no offline accrual (§1). The `tuning.json` keys ship and are now dead; deleting them is part of M5.5.
2. **Mod scripting (tier 3)** — ship it, or stay data-and-patches-only at first? Recommendation: build the sandbox at M2.5 but keep tier 3 behind a "trust this pack" toggle, off by default.
3. **Mod distribution** — drag-a-zip into OPFS (§13.1) is enough to start, but is an in-game browser part of the plan later? It changes whether pack ids need to be globally unique.
4. **Licensing under GPL-3** — worth deciding explicitly what the license means for pack scripts loaded at runtime (§13.3), since the answer affects who is willing to publish one.
5. **Art style commitment** — the generator implies a resolution and silhouette budget (48×48, ~36 frames/unit, 32-colour ramps). Worth locking now that 8 descriptors exist, because rigs and parts are the one thing that is expensive to re-decide once 40 do.
6. ~~**Does the party persist across runs?**~~ **Decided** — see *Decided*, above.
7. **How many bosses, and on which floors?** `tuning.spawn.bossEvery` is 8, so a base run meets exactly one. §6.3 describes bosses as a kind rather than an event, and a single one at the very bottom means most runs never see the phase system at all. A boss every 4 floors would make it a mechanic rather than an ending. **The pivot sharpens this into a real problem**: a 45-minute watched run that meets one boss at minute 44 has one memorable fight, and the Command system's most interesting use — a phase change you have to answer — fires once.
8. **Is 3 Commands right, and are the four verbs the right four?** (§2.6.) Three against ~35 fights is a guess, and the four verbs were chosen to cover four distinct failure modes rather than measured. The number is a `tuning.json` path and the verbs are content, so both are sweepable — but neither can be swept until somebody plays a fight, which makes this the first question M5 should answer and the one least amenable to the headless harness.
9. **What does a floor-1 wipe give a player who has met everything?** The Codex is the reward for a losing run and it is finite. Once a profile holds every species, a bad run yields a post-mortem and nothing else — which is correct for a roguelite and is also exactly when finding 3's bimodal curve stops being survivable. Related to open question 7 and to debt 19; possibly all three are one question about the difficulty curve.
10. **Do saved Doctrine loadouts leak power across runs?** §4 offers them as a convenience so a player is not rewriting the same four rules every run. The rules only apply when the run has independently granted the matching Tenets, so the claim is that they grant nothing — but "nothing" is exactly what was claimed for the Codex before it grew prices. Worth a test at M5.5: a run with a saved loadout and a run that types the same rules by hand must produce identical timelines.

> Items 2–5 predate the build; 6 was decided at M4; 7 surfaced while building the first boss; 1 was made moot and 8–10 were raised by the pivot.
