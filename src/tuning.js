// Every balance constant in one place.

// The ascension ladder's rows (TUNING.ascension): `levels` + 1 of them, level 0 the base game (every multiplier 1) and
// level `levels` the `top` row, each between on the straight line from one to the other: a multiplier at level k is
// 1 + (top's − 1) × k / levels.
const ladder = (levels, top) => Array.from({ length: levels + 1 }, (_, k) => Object.fromEntries(Object.entries(top).map(([key, v]) => [key, 1 + (v - 1) * k / levels])))

export const TUNING = {
  // The ascension ladder (redesign.md §4.6): a run's level (run.js createRun's `ascension`), chosen on the title screen,
  // a level opened by each clear of the one below (run.js openTo). A row a level, each multiplier × the base's number it
  // names: `foeHp`, `foeAtk` every foe's HP and ATK, the boss's and the foes' shadows' too (run.js foeMods, foeScale);
  // `fight`, `elite` the foes of a fight's and an elite's formation and waves (spawn.fight, spawn.elite, rounded: a
  // siege's and the Sovereign's waves are fight-sized); `every` the turns between waves (spawn.waves.every, rounded, at
  // least 1: below 1 they come sooner); `monarchHp` the Monarch's base HP (monarch.hp, rounded; its HP relics add to it
  // as before); `price` every price, a tier, a recruit, a fusion and a relic (run.js floorPrice's; an elite's bounty is
  // pay, not a price). Level 0 is the base game exactly. Ten levels on `ladder`'s straight line to the top row, whose
  // numbers are placeholders, as every row's are, until the balance pass (§9): level 0 tuned on the expert (~90% clears,
  // basic reaching floor 2 about half the time), the top on the outside teacher (~60%).
  ascension: ladder(10, { foeHp: 1.4, foeAtk: 1.2, fight: 1.2, elite: 1.2, every: 0.75, monarchHp: 0.85, price: 1.2 }),
  // Turns (redesign.md §2.3–2.10). No clock (§2.10): a battle ends only when a side does. `turn.guard`: the sim's bound
  // on turns, for the autoplayer and the tests alone (turns.js playOut, stalled): a battle still going past it ends as
  // a stall, no one's win (a passive side that mends the Monarch as fast as the foes in reach hurt it holds a battle
  // forever); play order by order, the interface's, has none. `policy.press`: the camp's pressure, 0 as the last wave
  // enters rising to 1 `turns` turns later (the camp out of patience: every foe comes, and tends no one), nudged
  // ± `strength` by the trade it could make. A kind's Move is its def's (content.js `move`). No dice (§2.16): every
  // blow hits, none crits, a blow deals computeDamage's mean, and nothing in a battle reads a random number.
  // Placeholders until the balance pass.
  turn: { guard: 1000 },
  policy: { press: { strength: 0.25, turns: 20 } },
  // The expert's judgement (redesign.md §2.17; expert.js): every decision it makes reads its situation, lists its
  // options, reads each as a named vector of features, lets the tree of hard rules (expert.js TREES) force or filter
  // them, and takes the one whose weighted sum is the highest (expert.js value: the seam where a learned model may
  // replace the sum). Nothing it decides is decided by playing a battle or a turn of the foes. A table a decision; a
  // weight's sign says which way it pulls; a weight of 0 marks a feature the tree reads.
  // 2026-10-11, the balance pass: every weight and threshold below but the book's offline ones, the stall threshold
  // and the press's weights was set by a black-box search (sep-CMA-ES over 103 of them, each candidate scored by mean
  // progress on the same 128 seeds, checked on 128 others; redesign.md §6, "Balance, the turns pass"); a 0 is a feature
  // the search turned off.
  expert: {
    // The tree's thresholds: `wounded`, the share of its souls' HP (the fallen's whole) below which the army is badly
    // wounded (an altar where one is open, never an elite where another room is); `odds`, the log of the army's strength
    // over a room's scouted threat below which a battle is the long odds (never taken where another room is open);
    // `stall`, the turns of the camp's patience (past the last wave's entry) after which the expert presses (the modes'
    // `press`: a battle never held forever; 2026-10-11, hand-set, past the camp's own 20); `altar` and `elite`, the share of
    // its max HP the Monarch stands at (its wounds carried from battle to battle) below which it takes an altar where one
    // is open and may heal it, and below which it walks into no elite where another room is open (2026-10-11, hand-set:
    // redesign.md §2.18 C).
    tree: { wounded: 0.653, odds: 0.158, stall: 30, altar: 0.5, elite: 0.7 },
    // The draft (autoplay.js pickDraft): while the souls drafted hold fewer than `ranged` pieces whose blows reach past
    // melee, a ranged kind offered is taken over any melee one (the growth sketch's worth reads no reach, and drafted
    // alone it fields three melee pieces that a floor-1 shooter outranges: 2026-10-14, hand-set, the trio's shape).
    draft: { ranged: 2 },
    // In battle (policy.js expertTurn), in HP. `option`: one piece's move and act, read off the board as it stands
    // (policy.js features: today's score, the prior); `board`: the board a turn's orders leave before End Turn
    // (policy.js boardFeatures, judge: the static evaluation the fast turn's two boards are compared by).
    battle: {
      option: {
        damage: 2.86, // HP its act deals the foes, each as far as its HP
        kill: 1.35, // each foe it fells: that foe's max HP
        menace: 0.108, // each foe it fells: the hardest blow that foe would have dealt next turn
        focus: 0.673, // its damage × the share of HP its target had lost already (focus fire: finish the wounded)
        bane: 0, // its damage on a foe that mends (what the rest deal, it undoes)
        harry: 0.195, // its damage on a foe that could strike the Monarch next turn
        status: 0.757, // a status it lays (content.js STATUS_WORTH): a debuff on a foe, a ward on one of yours
        mend: 1.64, // HP it mends
        rescue: 1.5, // HP it mends on one of yours that the foes could fell next turn where it stands
        danger: -0.341, // HP the foes could deal it next turn on the tile it ends on (the danger map: every foe that could
        //               reach it counted, as if all struck it, so it is weighed at a third; `loss` reads each blow once)
        fall: -1.32, // its max HP, where they could fell it there, or its blow's counter would
        counter: -1.58, // HP the counter its blow draws would take
        screen: 0, // foes' roads into the Monarch it holds from the tile it ends on (the tile beside the seat each
        //             comes in by), less those it holds where it stands
        guard: 0, // HP of what the foes could deal the Monarch next turn that it takes away (a kill, a Hex, a road held)
        lethal: -500, // the foes could still fell the Monarch next turn after it (the tree's monarch-lethal)
        cull: 34.6, // foes it fells that could strike the Monarch next turn (the tree's kill-first)
        shadow: 0.876, // a corpse it raises (Arise): the shadow's max HP
        fuse: 1.15, // a fusion: the fused piece's HP, less what its parts stand at
        essence: -0.766, // essence it spends (a fusion's price)
        waste: -1.54, // an act that changes nothing (the tree's no-waste)
        loss: -0.195, // your souls' HP the foes would take next turn, each foe's blow once on whom its way line says it hunts
        //             (policy.js assign), weighed by how near each would come to its fall (standingAt: a fall its max HP)
        shadowLoss: -0.357, // the same for your shadows and summons
        hit: 0, // HP the foes would take from the Monarch next turn, as `loss` reads them
        engage: 0.00414, // what it could deal next turn from the tile it ends on (its Move and reach to a foe's road ahead)
        undone: 0, // its damage the foes' healers could mend back next turn (policy.js healingRead), kills aside
        quell: 0.215, // each foe it wounds and leaves standing: the share of its HP taken × the hardest blow it deals (raw), as
        //          `menace` counts a kill's
        // The plan's (redesign.md §2.18; plan.js; 2026-10-11, placeholders for the weight search). `progress` replaced
        // `approach` (0.144: tiles nearer the nearest foe), which a piece with no slot still does by it.
        progress: 1, // steps it ends nearer the tile the target formation gives it
        role: 2, // it ends on that tile: its role held
        post: 0, // and that role a post, a road's or a screen (the tree's hold-the-line)
        listed: 5, // its act is its strike on the kill list
        forecast: -0.15, // HP the foes could deal it next turn where it ends, each from where the forecast has it stand
        // A hold's End-Turn act (its basic blow or heal from where it ends; 2026-10-11, for the learned tree: 0, today's
        // scorer never read them).
        basic: 0, // HP it deals or mends
        basicKill: 0, // the max HP of a foe it fells
        basicCounter: 0 // HP the counter it draws would take
      },
      // The weight sets a mode node of the tree switches to, each over `option`: `guard` while the Monarch is within the
      // foes' reach next turn; `protect` while the plan is to close about the Monarch, over the guard's, and `push` while it
      // is to take the fight to foes that hold off (2026-10-11, the plan's, placeholders: protect's empty, for on 32
      // seeds every pull toward the Monarch's attackers tried cost clears, `guard` 1 and `hit` −0.5 fifteen points, `guard`
      // 0.3 seven, `role` 6 nineteen, as the searched guard mode's `guard` and `hit` of 0 say; push's: come to them through
      // what they could deal); `press` long past the last wave (tree.stall;
      // 2026-10-11, hand-set: come on and trade, so a battle the camp's healers and yours would hold forever ends).
      // `boardModes`, the same over `board` (the push's: 2026-10-11, placeholders).
      modes: {
        guard: { guard: 0, harry: 0.243, screen: 0.887, hit: 0 },
        protect: {},
        push: { progress: 3, danger: -0.1, forecast: 0, loss: -0.1 },
        press: { progress: 6, engage: 1, danger: -0.1, fall: -0.2, loss: -0.3, mend: 0.2, status: 0.2 },
        // Added, not switched to (the tree's frail), × the share of its max HP the Monarch lacks, while it is in the foes'
        // reach or the plan is to close about it: its wounds are the run's (redesign.md §2.18 C; 2026-10-11, hand-set).
        frail: { guard: 1, hit: -1, screen: 1, harry: 0.5 }
      },
      boardModes: { push: { progress: 4, loss: -0.4 }, press: { loss: -0.3, shadowLoss: -0.1, foeHp: -2, foes: -1.5, closer: 10 } },
      board: {
        hp: 0.989, // your souls' HP (a soul's wounds leave the battle with it)
        shadows: 1.76, // your shadows' and summons' HP
        foeHp: -1.27, // the foes' HP
        foes: -0.465, // the foes standing, each its max HP (what felling it takes)
        danger: 0, // HP the foes could deal your pieces next turn where they stand
        falls: -0.322, // the max HP of each of yours they could fell there
        monarch: -0.998, // HP they could deal the Monarch next turn
        doom: -1e6, // they could fell the Monarch next turn: the run's end
        open: 0, // foes whose road into the Monarch nothing of yours holds
        spent: -0.935, // essence spent this turn (a fusion's price)
        won: 1e9, // the battle won
        lost: -1e9, // the battle lost
        loss: -1.65, // as the option's: your souls' HP the foes would take next turn (assign), by standingAt
        shadowLoss: -0.777, // the same for your shadows and summons
        hit: -2.49, // HP the foes would take from the Monarch next turn, as `loss` reads them
        counters: 2.88, // HP your pieces' counters would take from the foes whose melee blows `loss` reads
        mended: -6.24, // HP the foes' healers would mend next turn (each its most wounded in reach)
        foeTicks: 0.518, // HP the damage over time on the foes will take at the turn's end
        ticks: -0.781, // the same on your pieces
        closer: 0, // tiles your pieces came nearer the nearest foe this turn (0: the press's alone; 2026-10-11)
        progress: 0.5, // steps your pieces came nearer the tiles the plan's target formation gives them (2026-10-11, a
        //               placeholder: the plan's, redesign.md §2.18)
        shooters: 0 // the Monarch's shooters the plan read still standing (the tree's shooters-first)
      },
      // How much dearer a soul's HP is the nearer its fall (policy.js standingAt): this share of its max HP × the square
      // of the share it has lost.
      brink: 0.496,
      // How much dearer the Monarch's HP is the nearer its fall (policy.js guardAt): an HP of its weighs 1 + peril as it
      // is about to fall, 1 while it is whole.
      peril: 2.34
    },
    // The options a piece's shortlist keeps of all it has (policy.js shortlist: the battle forest's candidates; teach.js
    // labels as many). What is left of the turn's beam (redesign.md §2.21), off since 2026-10-11 (§2.22: the fast turn,
    // each piece deciding once by the model tree) and removed with V on 2026-10-15 (Step 0b of the improvement plan).
    shortlist: 16,
    // The battle plan (redesign.md §2.18; plan.js): chosen once a turn by the tree (expert.js TREES.plan) and these
    // weights, kept until a trigger; its target formation; its forecast of the foes. 2026-10-11, placeholders for the
    // weight search, hand-set.
    plan: {
      // `line`: a road's line (plan.js outOfRange) no more than this many road steps from the Monarch's seat (2026-10-11,
      // the line out of range: 3 → 4, hand-set, of 3, 4 and 5 tried on 128 seeds); `reach`: the
      // shooters' and strikers' tiles no farther than this from the tiles they cover; `shooters`, `strikers`: how many
      // such tiles the formation offers (the strikers' in each of three rings about a target); `impatient`: the turns since the last wave
      // past which the forecast has every foe come on (the expert's guess at the camp's patience: its own, never read);
      // `far`: a focus fails when none of yours could come to strike its target within this many turns; `horizon`: the
      // turns within which your pieces could fell one of the Monarch's shooters, or they screen it instead (plan.js
      // canFell; 2026-10-11, hand-set, B).
      line: 4, reach: 4, shooters: 8, strikers: 4, impatient: 20, far: 2, horizon: 2,
      // Choosing the plan (plan.js planOptions): which plan (hold, focus, push, protect: a bias each), and what makes
      // each worth it.
      choose: {
        hold: 1, focus: -0.5, push: -0.5, protect: -0.5,
        bold: 1, // hold: the share of the foes' HP the forecast has coming on
        waves: 0.5, // hold: a wave still to come
        peril: 3, // protect: what the foes could deal the Monarch next turn, a share of its HP
        mends: 1, // focus: its target mends
        picks: 0.5, // focus: its target strikes from afar, and could strike one of yours next turn
        menace: 0.5, // focus: its target's hardest blow, a share of the foes' hardest
        fell: 1.5, // focus: the kill list fells its target (1), else the share of its HP yours could deal it this turn
        threat: 1, // focus: its target could strike the Monarch next turn
        cull: 2, // focus: and the kill list fells it
        shooter: 0, // focus: its target is one of the Monarch's shooters your pieces could fell (the tree's monarch-shooter)
        wary: 2, // push: the share of the foes' HP that holds off
        edge: 0.5 // push: your side's strength over the foes', as a log
      },
      // A slot's worth by role, for each plan (plan.js formation), × a piece's aptness for it. `screen` (2026-10-11,
      // hand-set, B): a tile on a shooter's line to the Monarch (protect's held first, as its roads).
      roles: {
        hold: { block: 3, air: 3, heal: 1.5, shoot: 1.5, strike: 0, screen: 2 },
        focus: { block: 1.5, air: 1.5, heal: 1, shoot: 1, strike: 3, screen: 1.5 },
        push: { block: 0.5, air: 1, heal: 1, shoot: 1, strike: 3, screen: 1 },
        protect: { block: 3, air: 3, heal: 2, shoot: 1.5, strike: 0, screen: 3 }
      },
      // A piece's fit beside its role's worth: `melee`, a blocker's aptness lost for a blow at range (it would rather
      // shoot); `travel`, a turn of its walk to the slot; `exposed`, the share of its HP the forecast foes could deal it
      // there; `keep`, the slot it held last turn; `raise`, an Arise holder within its reach of the kill zone.
      fit: { melee: 0.5, travel: -0.4, exposed: -1, keep: 0.5, raise: 0.5 }
    },
    // Prep (autoplay.js formationFeatures): a formation read against the scouted room's roads, no battle played. A road
    // runs from where a scouted foe stands or enters to the Monarch's seat; a piece on it holds that foe there.
    formation: {
      fielded: 0, // the pieces fielded (the tree's fill-field)
      air: 0, // the fielded pieces that can strike a flyer (the tree's answer-air; 2026-10-11)
      power: 135, // the fielded souls' worth (wounds counted), a share of the best the field could hold
      cover: 0.0657, // the damage your pieces could deal, from where their Move takes them, on the roads' tiles (the nearer
      //           the seat the more)
      exposed: -8.22, // each piece: the share of its HP the scouted foes that reach it before they are held could take
      open: 0.105, // scouted foes whose road reaches the seat with nothing of yours on it
      blockers: -0.234, // scouted foes held first by a piece that fights in melee alone
      behind: 2.8, // ranged pieces that cover the roads where no foe reaches them before it is held
      mend: 16, // each healer: the exposure of the allies within its Move and heal's range
      monarch: -13, // the share of the Monarch's HP the scouted foes that reach it could take in a turn
      synergies: 12.4, // synergy rules the field holds (at 4)
      aura: 0.0867, // allies within an aura's range
      arise: 6.21, // each Arise holder: the share of the roads' weight within its reach
      lasts: -3.62, // the fielded souls' toughness (HP standing × DEF's mitigation), a share of the most the field could hold
      heals: 0.881, // HP the fielded healers mend a turn, each by its heals
      answers: 3.63, // the scouted threat types the fielded have an answer to (autoplay.js ANSWERS), less those they lack
      dps: 0.0384, // the fielded souls' hardest blows (raw), summed
      focus: 1.84, // each scouted foe: what yours could deal it next turn where it first comes within its reach of one of
      //           yours, a share of its HP, at most 1
      contact: -3.22 // each scouted foe: the share of the HP of the frailest piece it reaches there its blow would take
    },
    // The map (autoplay.js roomFeatures): the next room, by its type and the army's state; no route is walked ahead.
    route: {
      fight: 0.918, // a room's type
      elite: 10,
      shop: 0.333,
      altar: -0.586,
      boss: 1.12,
      siege: 0.0966,
      odds: 1.3, // a battle room: the log of the army's strength over the room's scouted threat
      weak: -13.4, // the same where the room is the stronger (a loss ends the run)
      wounds: 8.14, // an altar: the share of the souls' HP missing (the fallen's whole)
      monarch: 4.43, // an altar: the share of the Monarch's HP missing (none while nothing may heal it)
      purse: 1.04, // a Shop: the purse over the floor's cheapest relic price, up to 3
      want: 0.754, // a battle room: its foes of a kind the combo it plays toward is built of (each a soul on offer)
      unanswered: -1.09, // a battle room: its threat types the army has no answer to (autoplay.js ANSWERS)
      altarAhead: 1.29, // an altar on a route through the room, 1 / (1 + rooms to it), × the share of the souls' HP missing
      monarchAhead: 1, // the same × the share of the Monarch's HP missing, where an altar may heal it (2026-10-11, hand-set: C)
      shopAhead: 0.526 // a Shop on a route through the room, 1 / (1 + rooms to it), × the purse feature
    },
    // Growth (autoplay.js grow, sketch): each purchase, recruit, fusion, relic bought and relic given, by what it adds
    // to the state it leaves; keeping what it has is an option too.
    growth: {
      strength: 0.354, // the field's strength, as a log (what a choice adds, as a share)
      book: 0.645, // the combo book's worth of the combo it plays toward, by how far along it the run is
      keep: 0.0068, // keeping the essence, or the relic where it is: what a choice must beat
      save: 0.102, // keeping the essence for a fusion whose parts it holds and cannot pay for yet: its gain (autoplay.js
      //            saving), a share
      later: 0, // a recruit that completes such a fusion: the share of the fusion's gain it is worth
      // Arise in the field's strength (autoplay.js ariseWorth; 2026-10-11, hand-set, after the balance pass found the
      // expert never bought Arise: a relic held counted only as `worth.relic`, so its shadows were worth nothing to it):
      // the shadows its holders would raise a battle, read from the floor's rooms and roads (no battle played), each
      // counted at `share` of its worth (it rises mid-battle, strikes with its basic only, and the holder's act goes to
      // it), and no more a battle than `turns` raises a holder (one corpse a turn: the turns a battle has corpses to
      // raise; the ladder's median battle is 3–7 turns, the first with none).
      raise: { share: 0.5, turns: 3 },
      // A soul's fighting worth (autoplay.js worth): √(how long it lasts × how hard it hits), its hits raised by `move`
      // a tile of Move and `heal` of its healing past 1; `signature` more a tier that grants an ability, an aura or a
      // Colossus's footprint, and `relic` more a relic it holds (a run relic, the field's). Basic's rules of thumb read
      // it too.
      worth: { move: 0.161, mend: -0.0572, signature: 0.0461, relic: 0.115, hits: 0.893 }
    },
    // The combo book (autoplay.js makeBook, --combos): each combo's army against the plain army on every floor, by a
    // static formula on the souls' worth; and the relics that pair with it.
    // 2026-10-11: the offline weights (synergy, hits, worth) chosen by the combos each book made won (a book from
    // synergy 0, hits 1.2, Move 0.6 cleared 37% where the old one's 10–21%); the book has its own worth, so `npm run
    // combos` remakes the same book whatever the growth search's worth.
    book: {
      synergy: 0, // a synergy rule the army holds (at 4), a share of its power
      fused: 0.1, // a fused piece, a share of its worth
      trigger: 0.05, // a piece relic's trigger (`on`), a share of its holder's worth
      rule: 0.1, // a Legendary's rule, a share of its holder's worth
      arise: 0.05, // a run relic on Arise's reach or tier, a share of an army with an Arise holder
      floor: 0.002, // a relic pairs with a combo when it adds more than this to its power (a log)
      target: 0.217, // a soul of the combo's kinds is fielded as if worth this share more
      hits: 1.2, // a soul's worth in the book: how long it lasts × how hard it hits, the latter to this power (worth's `hits`;
      //            above 1 toughness counts against a soul: the book ranks combos by the damage they bring)
      worth: { move: 0.6, mend: 0, signature: 0.1, relic: 0.08 }, // the book's own worth (growth.worth's, but `hits`)
      ahead: 1.3 // a combo whose kinds are first met on a later floor is worth this share of its worth until that floor
    }
  },
  // The Shop (redesign.md §2.11): `relics` stocked, one always a Command relic, and from floor 2 one a Legendary;
  // each priced price[tier] × the floor's price scale (run.js relicPrice, floorPrice), after the discount relics
  // (`price.relic`). Common 24 and Uncommon 48 since the balance pass (2026-10-11; were 36 and 60): with the Shops met
  // ~2.5 a floor, the expert still left 150–300 essence unspent on floors 3–4 and bought 1.5 relics a floor there; at
  // these prices it buys ~1.9–2.3 a floor from floor 3 and ~1 on floor 2, so a relic competes with a tier for the purse.
  // Legendary 72 since 2026-10-11 (was 144), with Arise's content change: the expert now values Arise above any tier
  // per essence, but carries a median 91 / 162 essence into a floor-3 / floor-4 Shop (64 runs), so at 144 (461 / 619
  // there) one was affordable at 8–10% of those Shops, 12 bought in 128 runs and the Legendaries' ablation 0; at 72
  // (230 / 310), 21–24%. Still dearer than an Uncommon; a floor-2 Shop affords none at either price.
  shop: { relics: 4, price: { common: 24, uncommon: 48, rare: 96, legendary: 72 } },
  // raw = power × atk / atkDivisor, then × defConstant / (defConstant + def)
  damage: { atkDivisor: 40, defConstant: 100, min: 1 },
  // Deathblow (the Trickster's rule, rules.js): a blow of the side's on a foe below `below` of its max HP deals
  // `mult` times its damage (redesign.md §2.16). Placeholders; `below` 0.35 since 2026-10-15 (was a quarter: the
  // improvement plan's §4.3, the weak raised to Echo's class).
  deathblow: { below: 0.35, mult: 2 },
  // The rest of the synergies' numbers (rules.js; the improvement plan's §4.3, 2026-10-15), placeholders until the
  // balance pass. Echo (the Channeler's): below its synergy's `full` count (content.js SYNERGIES) every ability echoes at
  // `half` of its effect, from there whole. Ambush (the Skirmisher's): Hastened for the first `turns` turns. Bodyguard
  // (the Vanguard's): the side's Vanguards take `taken` of the damage that lands on them. Last Stand (the Construct's):
  // one that stands heals `heal` of its max HP.
  echo: { half: 0.5 },
  ambush: { turns: 2 },
  bodyguard: { taken: 0.8 },
  lastStand: { heal: 0.3 },
  // The shared board: the foes' 3×7 formation at the top, your 7×7 camp at the bottom, `gap` empty rows between.
  board: { gap: 1 },
  // field: the Monarch's base Command, the pieces that fight (one soul each); the field cap is field + fieldPerFloor
  // × (floor − 1) + the Command relics add (run.js commandOf), never more than army.board. fieldPerFloor 0: Command
  // alone widens the field. roster: the souls a retinue holds, on the field and in the ossuary together. The Monarch
  // counts toward neither.
  party: { field: 3, fieldPerFloor: 0, roster: 12 },
  // The draft (run.js draftOffer): a run starts with the Monarch alone and takes `picks` souls before the first map,
  // each the player's choice of `offer` different kinds drawn evenly from the floor-1 pool by the run's seed; after the
  // first, an offer with no partner of a soul held (run.js partners: a kin-mate or a recipe's) gives one place to one
  // (redesign.md §4.2). The same kind may come again in a later pick. The user's call (2026-10-14): three picks of one
  // of three.
  draft: { picks: 3, offer: 3 },
  // The Monarchs (content.js MONARCH_LIST; redesign.md §4.8): a Monarch's kin is drawn `bias` times as often as any
  // other kind in its draft's offers (run.js draftOffer). Three, not two: each favours a kin with one kind in the
  // floor-1 pool, offered in 71% of a pick's offers at 3 (58% at 2, 38% evenly). A new number (Step 9); the base Monarch
  // has no bias, and its draws are the even ones as before.
  monarchs: { bias: 3 },
  // The Monarch (DESIGN §2.5, §2.6): `hp` its base max HP; the HP relics add to it, a copy each (mods on
  // `run.monarchHp`), and nothing else touches it. 250 since the fourth balance pass (2026-10-10), so one Pyre Hound's
  // burn or a long duel with a floor-1 shooter no longer ends an expert's run on floor 1.
  monarch: { hp: 250 },
  // The summons a soul's tiers bring (unit.js summonsOf): shadows of its kind that rise beside it as each battle
  // begins, each at `hp` of a whole one's max HP (turns.js summon, fit), gone when it ends. A placeholder.
  summon: { hp: 0.4 },
  // A trine's stats where no record is written for it (redesign.md §4.1; content.js trineOf): its kind's HP, ATK and DEF,
  // base and growth alike, each × its factor here, by the parts' tier (`parts`, tier 1 first) or, for a fused kind's
  // trine, `fused`. Each keeps "a fusion is never weaker than what went into it": HP at least the three parts', ATK at
  // least a part's. The Pale Court set the first row (three Wisps: 7×, 4.8×, 2×). Placeholders until the balance pass.
  trine: {
    parts: [{ hp: 7, atk: 4.8, def: 2 }, { hp: 7, atk: 4.5, def: 1.5 }, { hp: 6, atk: 3.8, def: 1.5 }, { hp: 5.5, atk: 3.2, def: 1.5 }],
    fused: { hp: 3, atk: 1.8, def: 1.2 }
  },
  // Arise, a Legendary piece relic (content.js RELIC_LIST; redesign.md §2.15): its holder gains the skill Arise, one
  // corpse within `domain` tiles of the holder (Chebyshev, from its footprint), of tier up to `tier`, rises as a shadow of
  // yours at full HP, the player's choice; a skill with no rest (content.js: usable every turn). Hourglass and Bone Idol
  // add to both, run-wide (`arise.domain`, `arise.tier`: run.js ariseOf), and an Arise variant's rule may reach farther
  // (Court of Bone). 2026-10-11, placeholders: reach 7 and tier 4 (were 5 and 3), with the rest gone, after the balance
  // pass found the expert neither bought nor used Arise (0.00 raises a battle): the user's "content change".
  arise: { domain: 7, tier: 4 },
  // The board: the field cap never passes `board` pieces, and the Legion's shadows rise only while fewer than `board`
  // pieces of yours stand on it (Arise's rise past it: a skill is its own bound).
  army: { board: 10 },
  // A kind's level (every soul of it) is its tiers' (DESIGN §2.6): base + perTier × the tiers it holds on both tracks,
  // rounded down (run.js levelOf), so two tiers make level 3 and six level 6. No level is bought. A fused kind stands
  // at least at the highest level of the kinds that went into it. Foes keep their floor's levels (spawn). perTier 0.67
  // since the fourth balance pass (2026-10-10), with the cheaper tiers below: it keeps the tracks' ablation in its band.
  level: { base: 2, perTier: 0.67 },
  // Essence (DESIGN §2.6): each foe slain pays perTier × its tier, whatever its level (run.js foeEssence); a run
  // starts with `start`. It buys tiers, recruits, fusions and relics (TUNING.shop), and every price is its base ×
  // the floor's price scale, 1 + perFloor × (floor − 1) (run.js floorPrice: ×1, ×2.1, ×3.2, ×4.3 on floors 1–4):
  // a kind's track tiers I–IV tier[] (either track); recruiting a soul recruit × tier × (1 + perLevel × (level − 1)),
  // at the level it joins at (its kind's); a fusion fuse × the fused kind's tier, on top of the souls it consumes.
  // A won elite pays eliteBonus on top of its foes' pay, × the floor's price scale (run.js eliteBonus); it lays out no
  // relic (redesign.md §2.11). refund: a soul released pays back that share of what recruiting it would cost now
  // (run.js releaseRefund), rounded down. Money always matters (the economy pass, 2026-10-10): paying by the piece and
  // by tier, and prices growing by the floor, keep what a battle buys about level from floor to floor; the tier prices
  // are the fourth balance pass's (2026-10-10).
  essence: { start: 20, perTier: 3.5, perLevel: 0.35, perFloor: 1.1, tier: [16, 36, 60, 96], recruit: 8, fuse: 8, refund: 0.5, eliteBonus: 96 },
  // Foe level = 1 + (floor − 1) × levelPerFloor, rising by levelRamp more across a floor's ranks. A room draws its
  // kinds (run.js spawnPool) from those of tier at most tierOverCap above the floor's target tier (1 + (floor − 1) ×
  // tierPerFloor, rounded down, at most tierMax; an elite's eliteTier more), each by its spawn weight / (1 + its tiers
  // from the target)^tierFalloff. tierFalloff 1.5 and tierOverCap 2 since 2026-10-15 (were 3 and 1; redesign.md §4.2,
  // placeholders): the tier-3 kinds together ~5% of a floor-2 fight's draws (were absent) and ~13% of a floor-3
  // fight's (were 6%), the tier-1 kinds ~20% of floor 3's (were 10%), so a recipe's tier-3 keystone may come on a floor
  // its tier-1 partners still do. fight/elite: foes per encounter on floors 1–4. foeHp/foeAtk multiply ordinary foes per
  // floor; bossHp/bossAtk multiply the boss, per floor: a floor's boss on floors 1 and 2 (redesign.md §4.7, since
  // 2026-10-15: placeholders; by the codex's power, √(HP × ATK), a floor's boss room ~1.6× its floor-1 last elite's and
  // ~1× its floor-2 one's), the Hollow Sovereign at 1 on the last. Since 2026-10-16 (the user's rule) a boss shrugs off
  // a Hex until it has acted again (turns.js addStatus), and the bosses a Hex every turn had held (the Sovereign to 0–1
  // acts a battle, the floor-2 Mire Mother alike: redesign.md §8) are lighter, the balance pass's numbers: floor 2's
  // boss 3.2 → 2.4 HP and 2 → 1.6 ATK, the Sovereign 1 → 0.45 and 0.6, its court 4 → 2 (`court`). Floor 1's elite is 2
  // foes of the higher tier (and the late pair), so a rule-of-thumb run dies on floor 1 and an expert rarely does.
  spawn: {
    levelPerFloor: 1, levelRamp: 2, tierPerFloor: 0.5, tierMax: 5, tierOverCap: 2, tierFalloff: 1.5,
    fight: [3, 4, 5, 5], elite: [2, 5, 6, 6], eliteLevel: 0, eliteTier: 1,
    // Steepest at the bottom, where the expert's army has grown most; floor 1 is the basic player's wall already.
    foeHp: [1.08, 1.1, 1.12, 1.52], foeAtk: [1.02, 1.03, 1.12, 1.45], bossHp: [1, 2.4, 0.45], bossAtk: [1, 1.6, 0.6],
    // From rank `from` of every floor, a fight's foes carry at least `fight` distinct threat types and an
    // elite's `elite`: a room that does not is redrawn, up to `tries` times, keeping the most varied. And
    // every walk through a floor meets every threat type its foes can bring: a room on a walk that misses
    // one is drawn again wanting it, up to `routeTries` times a type in each of `routePasses` passes (run.js varyRoutes).
    // routeTries 24 since 2026-10-10: Bleed is the Mantis's alone, and fewer tries left floor-2 walks that met none;
    // routePasses 4 → 8 since 2026-10-16, a fight's captain a tier up (a floor-2 walk on route10 met no Shape after 4;
    // a bound, not a number to balance: a pass past the fourth acts only where a walk still misses a type).
    variety: { from: 3, fight: 2, elite: 3, tries: 50, routeTries: 24, routePasses: 8 },
    // The enemy as an army. From floor 2 a room's foes have captains (`captains.fight` in a fight or a wave,
    // `captains.elite` in an elite), each leading a cohort of cohort[floor − 1] more: foes of their own, each on the
    // free slot of the formation nearest the captain (run.js formation). An elite's captains are of its foes, their
    // cohorts of their own kind; since 2026-10-16 (the user's rule, redesign.md §4.2's alternative) a fight's are drawn
    // from the pool `captains.above` tiers over the room's target, as an elite's foes are (spawnPool), and of tier
    // `captains.minTier` at least, by floor: the keystones' tier, 3, from floor 2 (its target is tier 1, and a captain
    // one above it, tier 2, brought the Ember Drake, the Mantis Reaper and the Iron Golem, the mixed recipes' keystones,
    // to 11% of floor-2 fights; the user's intent is one on offer in most), so every fight from floor 2 carries a
    // notable recruit, and lead cohorts of the wave's own kinds. A floor-1 elite brings a
    // late pair: `late.n` more foes of its pool, a wave of their own. From floor `waves.floor` an elite, a fight from
    // rank `waves.fightRank`, a siege and the last room come in waves (`waves.elite`, `.fight`, `.siege` in all, the
    // first included). Waves enter on fixed turns (redesign.md §2.10): the room's formation stands from turn 1, and
    // wave k enters at the end of turn 1 + k × `waves.every` (turns.js entryTurn), shown on the wave counter; a siege
    // is three waves with no prep between them. A boss leads a court of `court` foes for the floor (the boss's own
    // kinds: content.js `court`): the last room's last wave is the Hollow Sovereign leading a court of 2 undead (4 until
    // 2026-10-16, with its numbers above); a
    // floor's boss on floors 1 and 2 stands with its court of 2 and 4 alone, the floor's last room (2026-10-15,
    // placeholders: redesign.md §4.7). They and its waves take foeHp/foeAtk; only the boss takes bossHp/bossAtk. Floor 3
    // keeps floor 2's cohorts of 2: at 3, a floor-3 elite's mantis brood ended half the expert's runs (the final balance
    // pass).
    captains: { fight: 1, elite: 2, above: 1, minTier: [0, 3, 3] }, cohort: [0, 2, 2, 3],
    late: { n: 2 },
    waves: { floor: 3, fightRank: 8, elite: 2, fight: 2, siege: 3, every: 4 },
    court: [2, 4, 2],
    // Endless floors, past the Sovereign's (run.floors): each floor `deep` floors down reuses the last floor's
    // camps and spawn pool (foe and elite counts and HP/ATK multipliers at their last entries), and grows from
    // there: foes rise `level` levels more per floor deep (on top of levelPerFloor), a room holds
    // floor(`count` × deep) more of them (never more than the formation's 21), and their HP and ATK grow by
    // `hp` and `atk` of the base per floor deep. The floor's last room is a big elite: `final.count` more
    // foes, `final.level` levels higher. The enemy grows as an army too: floor(`waves` × deep) more waves to
    // every room (a single formation becomes a room of waves; never more than `maxWaves`, the first
    // included) and floor(`cohort` × deep) more foes in every captain's cohort. The foes hold their synergies'
    // rules on every floor (redesign.md §2.12), as yours do.
    endless: { level: 0, count: 0.5, hp: 0.08, atk: 0.05, waves: 0.5, cohort: 0.5, maxWaves: 6, final: { count: 2, level: 1 } }
  },
  // floors: the Sovereign's floor; beating it is a clear, and the run may descend past it (spawn.endless). 3 since
  // 2026-10-15 (was 4; redesign.md §4.8, §8 Step 8): the run's length by the orders a clear, the expert's 1,274 → 949
  // on div-0…63 (RANKS 12 alone 1,084; the target ~600). The per-floor lists keep their floor-by-floor meaning, their
  // fourth entries the deep's first floor's now; floor 4's three camps no floor draws (the deep reuses floor 3's). A won
  // battle heals each living soul postBattleHeal of its max HP; an altar's heal heals each to altarHeal of it and raises
  // a fallen one at altarRevive (run.js). Wounds carry (2026-10-10): a win mends a fifth, so HP, DEF, Undying and
  // Heartwood count between rooms, and an altar is worth walking to. An altar's transmutation offers a soul altarOffer
  // kinds of the floor's pool at its tier (run.js transmuteOffer; redesign.md §4.5).
  run: { floors: 3, postBattleHeal: 0.2, altarHeal: 1, altarRevive: 0.5, altarOffer: 3 },
  // Relics (content.js RELIC_LIST, RELIC_TIERS), bought in Shops and only there (TUNING.shop; redesign.md §2.11). A
  // Shop draws each relic's tier by `weights.shop`, the entry for the floor (index floor − 1; the last one for every
  // floor past them), then a relic of that tier, never the same one twice in one stock; one held may come again
  // (copies stack; no cap). From floor `legendary.fromFloor` one of its relics is a Legendary (the ones that need Arise
  // only once an Arise relic is owned). `perPiece`: how many relics a soul may hold (redesign.md §2.15: a piece relic
  // works only through its holder). The weights are placeholders until the balance pass.
  relic: {
    perPiece: 1,
    weights: {
      shop: [{ common: 6, uncommon: 3, rare: 1 }, { common: 4, uncommon: 4, rare: 2 }, { common: 3, uncommon: 4, rare: 3 }, { common: 2, uncommon: 4, rare: 4 }]
    },
    legendary: { fromFloor: 2 }
  }
}
