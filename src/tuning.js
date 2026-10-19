// Every balance constant in one place.

// The ascension ladder's rows: level 0 the base game (every multiplier 1), level `levels` the `top` row, each level k
// between on the straight line: 1 + (top's − 1) × k / levels.
const ladder = (levels, top) => Array.from({ length: levels + 1 }, (_, k) => Object.fromEntries(Object.entries(top).map(([key, v]) => [key, 1 + (v - 1) * k / levels])))

export const TUNING = {
  // The ascension levels, a row of multipliers each on the base numbers: `foeHp`, `foeAtk` every foe's (bosses' and the
  // foes' shadows' too); `fight`, `elite` a room's foes (rounded); `every` the turns between waves (rounded, at least 1);
  // `monarchHp` the Monarch's base HP; `price` every price (an elite's bounty is pay, not a price).
  ascension: ladder(10, { foeHp: 1.4, foeAtk: 1.2, fight: 1.2, elite: 1.2, every: 0.75, monarchHp: 0.85, price: 1.2 }),
  // `turn.guard`: the sim's bound on a battle's turns, past which it is a stall. `policy.press`: the camp's pressure, 0
  // as the last wave enters, 1 `turns` turns later, nudged ± `strength` by the trade it could make.
  turn: { guard: 1000 },
  policy: {
    press: { strength: 0.25, turns: 6 },
    walk: 0.5 // the least aggression a foe that can land no blow this turn weighs its road by, so keepers and shooters with nothing to shoot come on
  },
  // The expert's weights: a decision reads each option as a named vector of features, the tree of hard rules
  // (expert.js TREES) forces or filters them, and the highest weighted sum wins; 0 marks a feature the tree reads or none.
  expert: {
    // The tree's thresholds: `wounded`, the army's share of HP below which it is badly wounded; `odds`, the log of its
    // strength over a room's threat below which a battle is the long odds; `stall`, the turns past the last wave's entry
    // after which the expert presses, two turns past the camp's own press (policy.press.turns); `altar`, `elite`, the
    // Monarch's share of its max HP below which it takes an open altar, and below which it walks into no elite while
    // another room is open.
    tree: { wounded: 0.653, odds: 0.158, stall: 8, altar: 0.5, elite: 0.7 },
    // The draft: below `ranged` drafted pieces that reach past melee, a ranged kind offered is taken over any melee one.
    draft: { ranged: 2 },
    // In battle, in HP: `option`, one piece's move and act read off the board as it stands; `board`, the board a turn's
    // orders leave before End Turn (the static evaluation two boards are compared by).
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
        // The plan's terms.
        progress: 1, // steps it ends nearer the tile the target formation gives it
        role: 2, // it ends on that tile: its role held
        post: 0, // and that role a post, a road's or a screen (the tree's hold-the-line)
        listed: 5, // its act is its strike on the kill list
        forecast: -0.15, // HP the foes could deal it next turn where it ends, each from where the forecast has it stand
        // A hold's End-Turn act: its basic blow or heal from where it ends.
        basic: 0, // HP it deals or mends
        basicKill: 0, // the max HP of a foe it fells
        basicCounter: 0 // HP the counter it draws would take
      },
      // The weight sets a mode of the tree switches to, each over `option`: `guard` while the Monarch is in the foes'
      // reach next turn; `protect` (on top of the guard's) while the plan closes about the Monarch, `push` while it takes
      // the fight to foes that hold off; `press` long past the last wave (tree.stall). `boardModes`: the same over `board`.
      modes: {
        guard: { guard: 0, harry: 0.243, screen: 0.887, hit: 0 },
        protect: {},
        push: { progress: 3, danger: -0.1, forecast: 0, loss: -0.1 },
        press: { progress: 6, engage: 1, danger: -0.1, fall: -0.2, loss: -0.3, mend: 0.2, status: 0.2 },
        // Added, not switched to (the tree's frail), × the share of its max HP the Monarch lacks, while it is in the foes'
        // reach or the plan closes about it.
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
        closer: 0, // tiles your pieces came nearer the nearest foe this turn (0: the press's alone)
        progress: 0.5, // steps your pieces came nearer the tiles the plan's target formation gives them
        shooters: 0 // the Monarch's shooters the plan read still standing (the tree's shooters-first)
      },
      // How much dearer a soul's HP is the nearer its fall: this share of its max HP × the square of the share it lost.
      brink: 0.496,
      // How much dearer the Monarch's HP is the nearer its fall: an HP weighs 1 + peril as it is about to fall, 1 whole.
      peril: 2.34
    },
    // The options a piece's shortlist keeps of all it has (the battle forest's candidates; teach.js labels as many).
    shortlist: 16,
    // The battle plan: chosen once a turn by the tree and these weights, kept until a trigger.
    plan: {
      // `line`: a road's line no more than this many road steps from the Monarch's seat; `reach`: the shooters' and
      // strikers' tiles no farther than this from the tiles they cover; `shooters`, `strikers`: how many such tiles the
      // formation offers (the strikers' in each of three rings about a target); `impatient`: the turns since the last
      // wave past which the forecast has every foe come on; `far`: a focus fails when none of yours could strike its
      // target within this many turns; `horizon`: the turns within which yours could fell one of the Monarch's shooters,
      // or they screen it instead.
      line: 4, reach: 4, shooters: 8, strikers: 4, impatient: 6, far: 2, horizon: 2,
      // Choosing the plan: a bias for each of hold, focus, push and protect, and what makes each worth it.
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
      // A slot's worth by role, for each plan, × a piece's aptness for it; `screen` a tile on a shooter's line to the Monarch.
      roles: {
        hold: { block: 3, air: 3, heal: 1.5, shoot: 1.5, strike: 0, screen: 2 },
        focus: { block: 1.5, air: 1.5, heal: 1, shoot: 1, strike: 3, screen: 1.5 },
        push: { block: 0.5, air: 1, heal: 1, shoot: 1, strike: 3, screen: 1 },
        protect: { block: 3, air: 3, heal: 2, shoot: 1.5, strike: 0, screen: 3 }
      },
      // A piece's fit beside its role's worth: `melee`, a blocker's aptness lost for a blow at range; `travel`, a turn of
      // its walk to the slot; `exposed`, the share of its HP the forecast foes could deal it there; `keep`, the slot it
      // held last turn; `raise`, an Arise holder within its reach of the kill zone.
      fit: { melee: 0.5, travel: -0.4, exposed: -1, keep: 0.5, raise: 0.5 }
    },
    // Prep (formationFeatures): a formation read against the scouted foes' roads to the seat, a piece on one holding its foe.
    formation: {
      fielded: 0, // the pieces fielded (the tree's fill-field)
      air: 0, // the fielded pieces that can strike a flyer (the tree's answer-air)
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
    // The map (roomFeatures): the next room, by its type and the army's state; no route is walked ahead.
    route: {
      fight: 0.918, // a room's type
      elite: 10,
      shop: 0.333, // never a room: its feature always 0, as `purse` and `shopAhead`
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
      monarchAhead: 1, // the same × the share of the Monarch's HP missing, where an altar may heal it
      shopAhead: 0.526 // a Shop on a route through the room, 1 / (1 + rooms to it), × the purse feature
    },
    // Growth (grow): each purchase or relic given, by what it adds to the state it leaves; keeping is an option too.
    growth: {
      strength: 0.354, // the field's strength, as a log (what a choice adds, as a share)
      book: 0.645, // the combo book's worth of the combo it plays toward, by how far along it the run is
      keep: 0.0068, // keeping the essence, or the relic where it is: what a choice must beat
      save: 0.102, // keeping the essence for a fusion whose parts it holds and cannot pay for yet: its gain (autoplay.js
      //            saving), a share
      later: 0, // a recruit that completes such a fusion: the share of the fusion's gain it is worth
      // Arise in the field's strength: the shadows its holders would raise a battle, read from the floor's rooms and
      // roads, each at `share` of its worth, and no more than `turns` a holder a battle (one corpse a turn).
      raise: { share: 0.5, turns: 3 },
      // A soul's fighting worth: √(how long it lasts × how hard it hits^`hits`), its hits raised by `move` a tile of
      // Move and `mend` of its healing; `signature` more a tier that grants an ability, an aura or a Colossus's footprint,
      // `relic` more a relic it holds. Basic's rules of thumb read it too.
      worth: { move: 0.161, mend: -0.0572, signature: 0.0461, relic: 0.115, hits: 0.893 }
    },
    // The combo book: each combo's army against the plain army on every floor, by a static formula on the souls'
    // worth, and the relics that pair with it. Its own worth keeps the book the same whatever growth's.
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
  // The Shop, the floor's shelf, open between battles: `relics` stocked, one always a Command relic and from floor 2 one
  // a Legendary; each priced price[tier] × the floor's price scale, after the discount relics.
  shop: { relics: 4, price: { common: 24, uncommon: 48, rare: 96, legendary: 72 } },
  // raw = power × atk / atkDivisor, then × defConstant / (defConstant + def). The lethality band: a same-tier foe falls
  // to about three or four basic blows; the balance pass sets the number.
  damage: { atkDivisor: 16, defConstant: 100, min: 1 },
  // Deathblow (the Trickster's rule): a blow on a foe below `below` of its max HP deals `mult` times its damage.
  deathblow: { below: 0.35, mult: 2 },
  // The other synergies' numbers. Echo (the Channeler's): below its synergy's `full` count every ability echoes at `half`
  // of its effect, from there whole. Ambush (the Skirmisher's): Hastened for the first `turns` turns. Bodyguard (the
  // Vanguard's): Vanguards take `taken` of the damage that lands on them. Last Stand (the Construct's): one that stands
  // heals `heal` of its max HP.
  echo: { half: 0.5 },
  ambush: { turns: 2 },
  bodyguard: { taken: 0.8 },
  lastStand: { heal: 0.3 },
  // The shared board: the foes' 3×7 formation at the top, your 7×7 camp at the bottom, `gap` empty rows between.
  board: { gap: 1 },
  // `field`: the Monarch's base Command; the field cap is field + fieldPerFloor × (floor − 1) + the Command relics', at
  // most army.board. `roster`: the souls a retinue holds, field and ossuary together. The Monarch counts in neither.
  party: { field: 3, fieldPerFloor: 0, roster: 12 },
  // The draft: a run starts with the Monarch alone and takes `picks` souls before the first map, each one of `offer`
  // different kinds drawn evenly from the floor-1 pool; after the first, an offer with no partner of a soul held gives
  // one place to one, and any offer with no kind that strikes past melee gives one place to one that does.
  draft: { picks: 1, offer: 3 },
  // A Monarch's kin is drawn `bias` times as often as any other kind in its draft's offers; the base Monarch has none.
  monarchs: { bias: 3 },
  // The Monarch's base max HP; the HP relics add to it, a copy each, and nothing else does.
  monarch: { hp: 375 },
  // A summon (a shadow its tiers raise beside a soul as each battle begins) stands at `hp` of a whole one's max HP.
  summon: { hp: 0.4 },
  // A trine's stats where no record is written for it: its kind's HP, ATK and DEF, base and growth, each × its factor,
  // by the parts' tier (`parts`, tier 1 first) or, for a fused kind's trine, `fused`. A fusion is never weaker than what
  // went into it: HP at least the three parts', ATK at least a part's.
  trine: {
    parts: [{ hp: 9, atk: 6.2, def: 2.2 }, { hp: 9, atk: 5.8, def: 1.7 }, { hp: 7.7, atk: 4.9, def: 1.7 }, { hp: 7, atk: 4.1, def: 1.7 }],
    fused: { hp: 3, atk: 1.8, def: 1.2 }
  },
  // Arise, a Legendary piece relic: its holder's skill raises one corpse within `domain` tiles (Chebyshev, from its
  // footprint) of tier up to `tier` as a shadow of yours at full HP; Hourglass and Bone Idol add to both.
  arise: { domain: 7, tier: 4 },
  // The field cap never passes `board` pieces, and the Legion's shadows rise only while fewer than `board` of yours
  // stand (Arise's rise past it: a skill is its own bound).
  army: { board: 10 },
  // A kind's level (every soul of it): base + perTier × the tiers it holds on both tracks, rounded down; no level is
  // bought, and a fused kind stands at least at the highest level of its parts. Foes keep their floor's levels.
  level: { base: 2, perTier: 0.67 },
  // Essence: each foe slain pays perTier[floor − 1] × its tier (the last entry past them); a run starts with `start`.
  // Every price is its base × the floor's price scale, 1 + perFloor × (floor − 1): a track tier I–IV tier[]; a recruit
  // recruit × tier × (1 + perLevel × (level − 1)); a fusion fuse × the fused kind's tier. A won elite pays eliteBonus
  // × the price scale on top. `refund`: the share of a recruit's price a released soul pays back, rounded down.
  essence: { start: 52, perTier: [7, 3.5, 3.5], perLevel: 0.35, perFloor: 1.1, tier: [16, 36, 60, 96], recruit: 8, fuse: 8, refund: 0.5, eliteBonus: 96 },
  // Foe level = 1 + (floor − 1) × levelPerFloor, rising by levelRamp[floor − 1] more across a floor's ranks. A room draws
  // its kinds from those of tier at most tierOverCap above the floor's target tier (1 + (floor − 1) × tierPerFloor,
  // rounded down, at most tierMax; an elite's eliteTier more), each by its spawn weight / (1 + its tiers from the
  // target)^tierFalloff. fight/elite: foes per room on floors 1–4; `opening`: a floor-1 fight of rank k has
  // opening[k − 1] foes where it has an entry; `openingTier`: floor 1's fights of the first that many ranks draw its
  // tier-1 kinds alone. foeHp/foeAtk multiply ordinary foes per floor, bossHp/bossAtk the floor's boss.
  spawn: {
    levelPerFloor: 1, levelRamp: [0, 2, 2], tierPerFloor: 0.5, tierMax: 5, tierOverCap: 2, tierFalloff: 1.5,
    fight: [3, 4, 5, 5], elite: [2, 5, 6, 6], eliteLevel: 0, eliteTier: 1, opening: [1, 1, 2], openingTier: 1,
    foeHp: [1.08, 1.1, 1.12, 1.52], foeAtk: [1.02, 1.03, 1.12, 1.45], bossHp: [1, 2, 0.25], bossAtk: [1, 1.4, 0.4],
    // From rank `from` of every floor, a fight's foes carry at least `fight` distinct threat types and an elite's
    // `elite`, redrawn up to `tries` times, keeping the most varied. Every walk through a floor meets every threat type
    // its foes can bring: a room on a walk that misses one is drawn again wanting it, up to `routeTries` times a type
    // in each of `routePasses` passes.
    variety: { from: 3, fight: 2, elite: 3, tries: 50, routeTries: 24, routePasses: 8 },
    // From floor 2 a room's foes have captains (`captains.fight` in a fight or a wave, `.elite` in an elite), each
    // leading a cohort of cohort[floor − 1] more. An elite's captains are of its foes, cohorts of their own kind; a
    // fight's are drawn `captains.above` tiers over the room's target, of tier minTier[floor − 1] at least, cohorts of
    // the wave's kinds. A floor-1 elite brings a late pair: `late.n` more foes, a wave of their own. From floor
    // `waves.floor` an elite, a fight from rank `waves.fightRank`, a siege and the last room come in waves (`waves.elite`,
    // `.fight`, `.siege` in all, the first included); wave k enters at the end of turn 1 + k × `waves.every`. A boss leads
    // a court of court[floor − 1] foes of its own kinds.
    captains: { fight: 1, elite: 2, above: 1, minTier: [0, 3, 3] }, cohort: [0, 2, 2, 3],
    late: { n: 2 },
    waves: { floor: 3, fightRank: 8, elite: 2, fight: 2, siege: 3, every: 4 },
    court: [2, 4, 1],
    // Endless floors, past the Sovereign's: each floor `deep` floors down reuses the last floor's camps and pool and
    // grows: foes `level` levels more per floor deep, floor(`count` × deep) more a room (at most the formation's 21), HP
    // and ATK by `hp` and `atk` of the base per floor deep; floor(`waves` × deep) more waves a room (at most `maxWaves`,
    // the first included) and floor(`cohort` × deep) more foes a cohort. The last room is a big elite: `final.count`
    // more foes, `final.level` levels higher.
    endless: { level: 0, count: 0.5, hp: 0.08, atk: 0.05, waves: 0.5, cohort: 0.5, maxWaves: 6, final: { count: 2, level: 1 } }
  },
  // `floors`: the Sovereign's floor; beating it is a clear, and the run may descend past it (the per-floor lists' fourth
  // entries serve the first floor past it). A won battle heals every soul to postBattleHeal of its max HP, the fallen
  // standing again in their cells; the Monarch keeps the HP it ended with, and between battles only an altar's heal (to
  // altarHeal of its max HP) and its HP relics mend it. An altar's transmutation offers altarOffer kinds of the floor's
  // pool at the soul's tier.
  run: { floors: 3, postBattleHeal: 1, altarHeal: 1, altarOffer: 3 },
  // Relics, bought in the Shop alone: its shelf draws each relic's tier by weights.shop[floor − 1] (the last entry past
  // them), then a relic of that tier, never one twice in a stock (copies stack, no cap). From floor `legendary.fromFloor`
  // one is a Legendary (one that needs Arise only once an Arise relic is owned). `perPiece`: the relics a soul may hold.
  relic: {
    perPiece: 1,
    weights: {
      shop: [{ common: 6, uncommon: 3, rare: 1 }, { common: 4, uncommon: 4, rare: 2 }, { common: 3, uncommon: 4, rare: 3 }, { common: 2, uncommon: 4, rare: 4 }]
    },
    legendary: { fromFloor: 2 }
  }
}
