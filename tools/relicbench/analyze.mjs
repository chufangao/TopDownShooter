// The table from results.jsonl: each relic's paired gain over its base on the same rooms → relics.csv, report.md.
import fs from 'node:fs'
import path from 'node:path'
import { ROOMS, BUDGET, configs, ECONOMY } from './configs.mjs'
import { RELIC_LIST, relicDef, TUNING, unitDef } from './lib.mjs'

const dir = path.dirname(new URL(import.meta.url).pathname)
const rows = fs.readFileSync(path.join(dir, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.budget === BUDGET && !r.error)
const at = new Map(rows.map((r) => [`${r.room.seed}|${r.room.node}|${r.key}`, r.res]))
const roomKey = (room) => `${room.seed}|${room.node}`
const cfgs = configs()
const PRICE = TUNING.shop.price
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)) }
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN }
const f = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : 'n/a')

// Paired differences of a config against its base, room by room (only rooms where both are solved).
function paired (c) {
  const d = { value: [], score: [], foes: [], monarch: [], won: [], souls: [], raised: [], turns: [], rooms: [], margin: [] }
  for (const room of ROOMS) {
    const a = at.get(`${roomKey(room)}|${c.key}`)
    const b = at.get(`${roomKey(room)}|${c.base}`)
    if (!a || !b) continue
    for (const k of ['value', 'score', 'foes', 'monarch', 'won', 'souls', 'raised', 'turns']) d[k].push(a[k] - b[k])
    d.rooms.push(roomKey(room))
    if (a.won && b.won) d.margin.push(a.value - b.value)
    if (a.outcome === 'open' && b.outcome === 'open') (d.depth ??= []).push(a.turns - b.turns)
  }
  return d
}
const measured = cfgs.filter((c) => c.relic).map((c) => {
  const d = paired(c)
  return { ...c, n: d.score.length, gain: mean(d.score), se: sd(d.score) / Math.sqrt(Math.max(1, d.score.length)), vgain: mean(d.value), foes: mean(d.foes), monarch: mean(d.monarch), won: mean(d.won), souls: mean(d.souls), raised: mean(d.raised), turns: mean(d.turns), margin: d.margin.length ? mean(d.margin) : NaN, depth: d.depth?.length ? mean(d.depth) : 0, up: d.won.filter((x) => x > 0).length, down: d.won.filter((x) => x < 0).length, flips: d.won.filter((x) => x !== 0).length, d }
})
// A relic's row: its best holder by mean gain (the other noted).
const byRelic = []
for (const r of RELIC_LIST) {
  const tries = measured.filter((m) => m.relic === r.id).sort((a, b) => b.gain - a.gain)
  if (ECONOMY.includes(r.id)) { byRelic.push({ relic: r.id, tier: r.tier, price: PRICE[r.tier], holder: 'n/a (economy)', economy: true, n: 0 }); continue }
  if (!tries.length || !tries[0].n) { byRelic.push({ relic: r.id, tier: r.tier, price: PRICE[r.tier], holder: tries[0]?.holder ?? '?', n: 0 }); continue }
  const best = tries[0]
  byRelic.push({ ...best, tier: r.tier, price: PRICE[r.tier], alt: tries.slice(1).map((t) => `${t.holder} ${f(t.gain)}`).join('; ') })
}
const DEPTH_FLAG = 1.5
const TIERS = ['common', 'uncommon', 'rare', 'legendary']
const battle = byRelic.filter((r) => r.n > 0)
const tierStats = Object.fromEntries(TIERS.map((t) => {
  const g = battle.filter((r) => r.tier === t).map((r) => r.gain)
  return [t, { n: g.length, mean: mean(g), median: median(g), sd: sd(g), min: Math.min(...g), max: Math.max(...g) }]
}))

// The economy relics in essence, at floor 2's prices (floorPrice 1 + perFloor × 1).
const E = TUNING.essence
const scale = 1 + E.perFloor
const tierP = E.tier.map((x) => x * scale)
const payPer = E.perTier[1]
const roomPay = (room) => {
  // The room's foes' pay (all slain) and an elite's bounty, from the run's own map.
  const node = ROOM_NODES.get(roomKey(room))
  return payPer * node.tiers + (node.type === 'elite' ? Math.round(E.eliteBonus * scale) : 0)
}
const { floorState } = await import('./lib.mjs')
const ROOM_NODES = new Map()
for (const room of ROOMS) {
  const n = floorState(room.seed, (await import('./lib.mjs')).SOULS).state.map.nodes.find((x) => x.id === room.node)
  const foes = [...n.foes, ...(n.waves ?? []).flatMap((w) => w.foes)]
  ROOM_NODES.set(roomKey(room), { type: n.type, rank: n.rank, foes: foes.length, tiers: foes.reduce((a, x) => a + unitDef(x.id).tier, 0) })
}
const fightPay = mean(ROOMS.filter((r) => ROOM_NODES.get(roomKey(r)).type === 'fight').map(roomPay))
const elitePay = mean(ROOMS.filter((r) => ROOM_NODES.get(roomKey(r)).type === 'elite').map(roomPay))
const ECON_NOTE = {
  binding_chain: `−30% recruit price: a tier-2 recruit costs ${(E.recruit * 2 * scale).toFixed(0)} on floor 2, so ~${(0.3 * E.recruit * 2 * scale).toFixed(0)} saved a recruit (tier 3: ~${(0.3 * E.recruit * 3 * scale).toFixed(0)}); pays back its floor-2 price (${(PRICE.common * scale).toFixed(0)}) after ~${(PRICE.common * scale / (0.3 * E.recruit * 2 * scale)).toFixed(1)} tier-2 recruits.`,
  ossuary_key: `+3 roster past ${TUNING.party.roster}: no essence; worth something only to a run hoarding fusion parts. ~0.`,
  grave_ledger: `−30% on tiers I–II (${tierP[0].toFixed(0)} + ${tierP[1].toFixed(0)} on floor 2): ~${(0.3 * (tierP[0] + tierP[1])).toFixed(0)} saved a track taken to II; pays back its price (${(PRICE.uncommon * scale).toFixed(0)}) after ~${(PRICE.uncommon * scale / (0.3 * (tierP[0] + tierP[1]))).toFixed(1)} such tracks.`,
  rite_candle: `−25% on every tier (floor 2: I ${tierP[0].toFixed(0)}, II ${tierP[1].toFixed(0)}, III ${tierP[2].toFixed(0)}, IV ${tierP[3].toFixed(0)}): ~${(0.25 * tierP.reduce((a, b) => a + b, 0)).toFixed(0)} saved over a full track I–IV; pays back its price (${(PRICE.rare * scale).toFixed(0)}) after ~${(PRICE.rare * scale / (0.25 * mean(tierP))).toFixed(1)} tiers of average price.`,
  tithe_bowl: `+35% battle essence: these rooms pay ~${fightPay.toFixed(0)} a fight and ~${elitePay.toFixed(0)} an elite (bounty included) on floor 2, so ~${(0.35 * fightPay).toFixed(0)} a fight / ~${(0.35 * elitePay).toFixed(0)} an elite; pays back its price (${(PRICE.rare * scale).toFixed(0)}) in ~${(PRICE.rare * scale / (0.35 * fightPay)).toFixed(1)} fights.`,
  soul_lantern: `each recruit joins with a free tier I (worth ${tierP[0].toFixed(0)} on floor 2, plus the level it gives); pays back its price (${(PRICE.uncommon * scale).toFixed(0)}) after ~${(PRICE.uncommon * scale / tierP[0]).toFixed(1)} recruits.`
}

// relics.csv
const csv = ['relic,tier,price,holder,mean_gain,se_gain,mean_end_value_gain,mean_foes_hp_left_delta,mean_monarch_hp_delta,win_rate_delta,mean_souls_hp_delta,mean_raised_delta,open_line_rounds_delta,wins_gained,wins_lost,margin_gain_in_battles_both_won,n_battles,other_holders']
for (const t of TIERS) {
  for (const r of byRelic.filter((x) => x.tier === t).sort((a, b) => (b.gain ?? -Infinity) - (a.gain ?? -Infinity))) {
    csv.push([r.relic, r.tier, r.price, `"${r.holder}"`, r.n ? r.gain.toFixed(4) : 'n/a', r.n ? r.se.toFixed(4) : 'n/a', r.n ? r.vgain.toFixed(4) : 'n/a', r.n ? r.foes.toFixed(4) : 'n/a', r.n ? r.monarch.toFixed(4) : 'n/a', r.n ? r.won.toFixed(4) : 'n/a', r.n ? r.souls.toFixed(4) : 'n/a', r.n ? r.raised.toFixed(3) : 'n/a', r.n ? r.depth.toFixed(2) : 'n/a', r.n ? r.up : 'n/a', r.n ? r.down : 'n/a', r.n && Number.isFinite(r.margin) ? r.margin.toFixed(4) : 'n/a', r.n, `"${r.alt ?? ''}"`].join(','))
  }
}
fs.writeFileSync(path.join(dir, 'relics.csv'), csv.join('\n') + '\n')

// report.md
const base = ROOMS.map((room) => ({ room, b: at.get(`${roomKey(room)}|base`), node: ROOM_NODES.get(roomKey(room)) })).filter((x) => x.b)
const nRooms = base.length
const lines = []
const L = (s = '') => lines.push(s)
L('# RETINUE relic power table (floor 2, solver-measured)')
L()
L(`Every relic measured on the same ${nRooms} floor-2 battles, each paired against the same battles without it (or the pair named in "holder"). The battles are played by the game's own solver (src/sim/solver.js \`solve\`) under a fixed budget of ${BUDGET} plans and no wall-clock cap, so every number below is a pure function of the board and reruns identically.`)
L()
L('**Gain** = the paired mean difference (relic − base, battle by battle) of one composite the solver itself optimises: for a battle that ended, the solver\'s end value (`valueOf`, END_WEIGHTS: a win scores −3 × the Monarch\'s share of max HP lost − 1 × the souls\' share lost − 0.02 × rounds; a loss −10); for a line the budget cut open (a long battle still going), the solver\'s own board score of where it stood (`scoreOf`: the value so far, plus shadows\' HP, − 2 × (the foes\' share of HP left − 0.5 × the threat yours pose), − 0.1 × the danger to yours). So a win flip from a loss is worth ≈ +10, while finishing a long battle the budget left open is worth roughly the foes\' remaining share × 2. Within won battles +0.03 ≈ 1% of the Monarch\'s HP kept. ± is the standard error over battles (the rooms are the only noise: every solve is deterministic). ΔMonarch = Monarch HP share out; ΔWin = win-rate change; "end value gain" in relics.csv is the plain `valueOf` difference with every unfinished line at −10.')
L()
L('## Setup')
L()
L('- Party: the Monarch (375 HP, full) and Command\'s 3 souls (TUNING.party.field 3, fieldPerFloor 0; `canPlace` would refuse a 4th), each level 4 (3 tiers): tomb_knight [2,1] (Vanguard, melee front, tank), ember_drake [2,1] (Ranger, ranged, highest ATK), hive_warden [2,1] (Warden, healer; Brood Mother II hatches 2 summoned wardens). Seated by run.js `frontier` on the seed\'s floor-2 camp; foes from the seed\'s own floor-2 map (`generateFloor` + `drawRoom` + `varyRoutes` + `answerArmy`, as `openFloor` does), set up by run.js `battleSetup`.')
L('- Run relics go in as the run does: `partyMods` (non-run paths), `relics`, `ariseOf` for Hourglass/Bone Idol, and the Monarch\'s max HP raised as `takeRelic` does. Piece relics: `relics: [id]` on the holder.')
L('- Holder rule: blow/slay triggers (`on: blow|kill`) and Whetstone, Glass Crown, Reaper\'s Hunger, Overwatch are tried on both the highest-ATK melee soul (tomb_knight) and the ranged soul (ember_drake), the better reported (the other in relics.csv). struck/fall/wave triggers, HP/DEF relics, Undying, Mimicry, Hold the Line, Trample: tomb_knight (front line). Seven-League Boots, Last Candle: ember_drake (the mover with Move 3; the damage dealer). Arise: hive_warden and ember_drake. Hourglass/Bone Idol: with Arise on hive_warden, against Arise on hive_warden alone; Grave Powder: tomb_knight with Arise on hive_warden, against the same. Command relics (Bone Horn, Muster Roll, Grave Banner: +frost_sprite [2,1]; Legion: +frost_sprite, +bone_chanter [1,2]) against the 3-soul party. Kin banners on the main party (drake, undead, insect present); Gossamer Standard on a party with frost_sprite for the warden, Brass Standard with clockwork_page for the warden, each against its own baseline.')
L(`- Rooms: 8 seeds × 2 (a mid fight of ranks 6–9, and an elite or a rank-11/12 fight). Baseline (no relic):`)
L()
const status = (r) => (r.won ? 'won' : r.outcome === 'lost' ? (r.monarch <= 0 ? '**lost** (Monarch fell)' : '**lost**') : `**open** at the budget (${(r.foes * 100).toFixed(0)}% foe HP left)`)
L('| room | type | rank | foes | outcome | composite | rounds | Monarch out | souls out | configs won |')
L('|---|---|---|---|---|---|---|---|---|---|')
for (const { room, b, node } of base) {
  const all = cfgs.map((c) => at.get(`${roomKey(room)}|${c.key}`)).filter(Boolean)
  L(`| ${room.seed} ${room.node} | ${node.type} | ${node.rank} | ${node.foes} | ${status(b)} | ${b.score.toFixed(3)} | ${b.turns} | ${(b.monarch * 100).toFixed(0)}% | ${(b.souls * 100).toFixed(0)}% | ${all.filter((x) => x.won).length}/${all.length} |`)
}
L()
L(`Baseline wins ${base.filter((x) => x.b.won).length}/${nRooms}.`)
L()
L('## Tier summary (battle relics)')
L()
L('| tier | price | n | mean gain | median | sd | min | max |')
L('|---|---|---|---|---|---|---|---|')
for (const t of TIERS) { const s = tierStats[t]; L(`| ${t} | ${PRICE[t]} | ${s.n} | ${f(s.mean)} | ${f(s.median)} | ${s.sd.toFixed(3)} | ${f(s.min)} | ${f(s.max)} |`) }
L()
L('## Outliers')
L()
const rareMed = tierStats.rare.median
const uncMed = tierStats.uncommon.median
const weakLeg = battle.filter((r) => r.tier === 'legendary' && r.gain < rareMed).sort((a, b) => a.gain - b.gain)
const strongCom = battle.filter((r) => r.tier === 'common' && r.gain > uncMed).sort((a, b) => b.gain - a.gain)
L(`- Legendaries weaker than the rare median (${f(rareMed)}): ${weakLeg.length ? weakLeg.map((r) => `${r.relic} ${f(r.gain)}`).join(', ') : 'none'}.`)
L(`- Commons stronger than the uncommon median (${f(uncMed)}): ${strongCom.length ? strongCom.map((r) => `${r.relic} ${f(r.gain)}`).join(', ') : 'none'}.`)
const neg = battle.filter((r) => r.gain < -0.05).sort((a, b) => a.gain - b.gain)
L(`- Net harmful on this sample (gain < −0.05): ${neg.length ? neg.map((r) => `${r.relic} (${r.tier}) ${f(r.gain)}`).join(', ') : 'none'}.`)
const outOfTier = []
for (const r of battle) {
  const i = TIERS.indexOf(r.tier)
  const above = TIERS.slice(i + 1).filter((t) => t !== 'legendary' || r.tier !== 'rare')
  for (const t of TIERS.slice(i + 1)) if (r.gain - r.se > tierStats[t].median) { outOfTier.push(`${r.relic} (${r.tier}) beats the ${t} median`); break }
}
L(`- Above a higher tier's median by more than one standard error: ${outOfTier.length ? outOfTier.join('; ') : 'none'}.`)
L()
L('## The table (by gain within tier)')
for (const t of TIERS) {
  L()
  L(`### ${t[0].toUpperCase() + t.slice(1)} (price ${PRICE[t]}; mean ${f(tierStats[t].mean)}, median ${f(tierStats[t].median)})`)
  L()
  L('| relic | holder | gain ± se | ΔMonarch | ΔWin | Δsouls | wins +/− | margin (both won) | n | other holder |')
  L('|---|---|---|---|---|---|---|---|---|---|')
  for (const r of byRelic.filter((x) => x.tier === t).sort((a, b) => (b.gain ?? -Infinity) - (a.gain ?? -Infinity))) {
    if (r.economy) { L(`| ${r.relic} | economy | n/a | | | | | | 0 | ${ECON_NOTE[r.relic]} |`); continue }
    if (!r.n) { L(`| ${r.relic} | ${r.holder} | not measured | | | | | | 0 | |`); continue }
    L(`| ${r.relic}${Math.abs(r.depth) >= DEPTH_FLAG ? ' ⚠' : ''} | ${r.holder} | ${f(r.gain)} ± ${r.se.toFixed(3)} | ${f(r.monarch * 100, 1)}% | ${f(r.won * 100, 0)}% | ${f(r.souls * 100, 1)}% | +${r.up}/−${r.down} | ${f(r.margin)} | ${r.n} | ${r.alt ?? ''} |`)
  }
}
L()
L('## Economy relics (not battle relics: n/a above), in essence on floor 2')
L()
L(`Floor 2's price scale is ${scale.toFixed(1)} (TUNING.essence.perFloor), so the shop's floor-2 prices are common ${(PRICE.common * scale).toFixed(0)}, uncommon ${(PRICE.uncommon * scale).toFixed(0)}, rare ${(PRICE.rare * scale).toFixed(0)}, legendary ${(PRICE.legendary * scale).toFixed(0)}.`)
L()
for (const id of ECONOMY) L(`- **${id}** (${relicDef(id).tier}): ${ECON_NOTE[id]}`)
L()
L('## Caveats: what this bench cannot see')
L()
const flagged = battle.filter((r) => Math.abs(r.depth) >= DEPTH_FLAG).map((r) => `${r.relic} (${r.depth > 0 ? '+' : ''}${r.depth.toFixed(1)} rounds)`)
L(`- **⚠ The plan budget and open lines (the biggest caveat).** Most of these floor-2 battles run 14–50 rounds, past what ${BUDGET} plans reach, so the solver hands back an open line and the composite reads its board (\`scoreOf\`) where the budget stopped it. A config with more pieces (Command relics; Arise and Gravedigger\'s Spade raising shadows; summons) spends more plans a round, so its open line stops at a different round than the baseline\'s, and a board read at another round is not like for like (fewer rounds can mean less damage taken yet, or more foes left). Relics whose open lines ended ≥ ${DEPTH_FLAG} rounds away from the baseline\'s on average are marked ⚠: ${flagged.length ? flagged.join(', ') : 'none'}. Read their gain with care; for them the "wins +/−" and "margin (both won)" columns, which compare finished battles only, are the safer reading. A fix would be a per-piece plan budget or the solver\'s \`turns\` horizon with a budget that always reaches it (a probe: Legion\'s 5 souls used 30,000 plans by round 5 where the base reached round 11 on 16,600), which is ~2–4× this run\'s compute.`)
const low = base.filter((x) => x.b.monarch < 0.5).length
const hurt = base.filter((x) => x.b.souls < 0.6).length
const lostN = base.filter((x) => x.b.outcome === 'lost').length
const openN = base.filter((x) => x.b.outcome === 'open').length
L(`- **How hard the rooms were.** Baseline: ${base.filter((x) => x.b.won).length} won, ${lostN} lost, ${openN} open at the budget (long battles the ${BUDGET}-plan search could not finish; scored by \`scoreOf\`, not −10). The Monarch ended below half its HP in ${low} of ${nRooms} baseline battles and the souls kept under 60% of their HP in ${hurt}. Undying (a holder that falls) and Last Candle (the Monarch below half) can only show where those happen, so their numbers are a floor, not a verdict: a run's later floors, a wounded Monarch carried from earlier rooms, and the boss are where they pay.`)
L('- **The Monarch starts every battle at full HP.** In a run its HP carries over (only altars and HP relics mend it), so the HP relics\' and Last Candle\'s worth across a floor is larger than one battle shows; here they register only as a smaller share lost.')
L('- **Command relics** (Bone Horn, Muster Roll, Grave Banner, Legion) are measured by fielding the extra souls they allow (frost_sprite, then bone_chanter, level 4, free). In a run that piece must be recruited and levelled (a tier-1 recruit plus 3 tiers ≈ ' + `${Math.round(E.recruit * scale + tierP[0] * 2 + tierP[1])}` + ' essence on floor 2), so their gain is the relic plus a free soul: compare them against the price of the relic and the soul together.')
L('- **Mimicry** needs three other Wardens: here the hive_warden\'s Brood Mother II hatches two summoned wardens, so the holder makes four (Warden 4, Sanctuary, confirmed active at battle start). A party with no wardens would see nothing from it.')
L('- **Grave Powder, Hourglass, Bone Idol** need shadows: each is paired with Arise (held by the hive_warden) against Arise alone, so their gain is the increment over Arise, on a party that raises few shadows (see Δraised in relics.csv).')
L('- **Kin banners** need their kin: Wyrm/Barrow/Hive Standards on the main party (1 drake, 1 undead, 1 insect plus its 2 summons); Gossamer and Brass Standards on a variant party (frost_sprite / clockwork_page for the warden), each against that party\'s own baseline. A banner\'s worth scales with how many of its kin are fielded; one or three pieces is the low end.')
L('- **One party, one formation.** One 3-soul composition at level 4, seated by run.js \`frontier\` (not the expert\'s \`bestFormation\`). Relics that want a different build (Seven-League Boots on a fast skirmisher, Powder Keg/Glass Hammer/Headsman\'s Hood with Burning/Brittle/Hex layers, Hold the Line beside a wall of Vanguards) are measured as this party gets them; combo relics read low here by construction.')
L('- **Holder selection.** Relics tried on two holders report the better: the max of two noisy estimates is biased up a little against single-holder relics.')
L('- **Economy relics** (binding_chain, ossuary_key, grave_ledger, rite_candle, tithe_bowl, soul_lantern) do nothing in battle: n/a, with an essence estimate above.')
L(`- **Sample size.** ${nRooms} battles; a single win flip moves a relic\'s gain by ≈ 10/${nRooms}. Treat differences under ~2 standard errors as ties. Every solve is deterministic (a plan budget, no clock), so a rerun reproduces the table exactly; adding rooms to configs.mjs ROOMS is the way to tighten it.`)
L('- **"Open" is a mixed bag.** The solver ranks an unfinished line above a lost one, so where the narrow level lost and the wider level ran out of budget, the result is an open line from early in the battle (b7 9.1\'s baseline: round 3). A few configs ran into very long open lines (Briar Mail in b4 11.1 and b7 9.1 reached rounds 187 and 228: a stalemate the search kept extending), which alone puts Briar Mail at −0.43; Grave Banner\'s −0.24 is mostly one such room (b2 12.0, round 159). Legion\'s lines stop at round 3–4 (five souls and their summons spend the budget fast), so its +0.59 is mostly the depth artefact above, though it also gained 3 wins.')
L('- **Exact zeros** mean the relic never fired on this party: Hourglass and Bone Idol (Arise\'s base reach 7 and tier 3 already cover these floor-2 foes; Arise raised 0–5 shadows a battle), Gossamer Standard (the frost_sprite\'s Frost Lance has no cooldown to shorten at its tiers), Powder Keg, Glass Hammer, Headsman\'s Hood and Plague Mask (this party lays no Burning, Brittle, Hex or debuff for them to cash in), Last Candle (the Monarch never fell below half). They are untested here, not worthless: each needs its enabling build.')
L('- **Prices.** The legendary price (72) is below the rare one (96), so a legendary at the rare median is still a bargain by gain per essence.')
L()
fs.writeFileSync(path.join(dir, 'report.md'), lines.join('\n') + '\n')
console.log(`relics.csv and report.md written (${rows.length} solves, ${nRooms} rooms with a baseline)`)
