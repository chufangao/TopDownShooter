// Rules text, generated from the content data so it is never out of date: unit cards, ability and status
// text, room and threat tooltips, rings, the synergy tracker and its colours, the fusions, the bestiary and the codex
// (How to play).
import { TUNING } from './tuning.js'
import { unitDef, abilityDef, statusDef, relicDef, KIN, ROLES, BEHAVIOURS, SYNERGIES, THREATS, RELIC_TIERS, RELIC_LIST, UNIT_LIST, FUSION_LIST } from './content.js'
import {
  statsOf, activeSynergies, synergyActive, COLS, ROWS, slotAt, rangeOf, isAllyShape, CAMP_ROWS, abilitiesOf, auraOf, tiersOf,
  tileX, tileY, DEPTH, distance, deployTile, ringOf, strideOf, behaviourOf, bodiesOf, sizeOf, armOf, holdOf
} from './sim/unit.js'
import { foeMods, fielded, souls, monarchOf, domainOf, fieldCap, baseField, commandOf, monarchHp, ariseOf, ariseHeld, holds, isMonarch, depthOf, rosterCap, inOssuary, canFuse, fuseCost, relicCount, relicTier, floorPrice } from './sim/run.js'
import { ariseCap, ariseTier, ariseHaste, relicRules } from './sim/battle.js'
import { h, fill, icon, portrait, prefs, say } from './dom.js'
import { KEYWORDS, kw, secs } from './keywords.js'

const pct = (v) => `${Math.round(v * 100)}%`

// Camp rows by name, front first.
export const campRowLabel = (r) => (r === 0 ? 'Front' : r === CAMP_ROWS - 1 ? 'Rear' : `Row ${r + 1}`)

// Gauge filled per tick, and how long a cost takes to fill from empty.
const gaugeRate = (s) => (TUNING.gauge.base + s.spd / TUNING.gauge.spdDivisor) * s.gauge.rate
const fillTime = (s, cost) => secs(cost / gaugeRate(s))

// ── mods: what a unit really fights with ─────────────────────────────────────────────────────────

// The relics' mods, a copy each (Legion's HP among them), on every unit of yours in battle but the Monarch; and the
// roles one counts as another for your synergies (Mimicry's alias, a role once a copy, or null).
const relicMods = (relics) => relics.flatMap((id) => relicDef(id).mods ?? [])
export const aliasOf = (run) => relicRules(run.state.relics).alias

// The pieces of yours standing as the battle begins: the living on the field, the Monarch too.
export const standing = (run) => fielded(run.state.party).filter((u) => u.hp > 0)
// The mods a fielded soul starts a battle with: relics and the field's synergies. The Monarch takes none of
// them: its stats are its own and its HP relics', and its gauge as fast as Arise's copies past the first make it
// (battle.js modsFor, ariseHaste).
export const partyMods = (run, u = null) => u && isMonarch(u) ? monarchMods(run) : [...relicMods(run.state.relics),
  ...activeSynergies(standing(run), aliasOf(run)).flatMap((s) => s.mods)]
const monarchMods = (run) => {
  const haste = ariseHaste(relicRules(run.state.relics))
  return haste ? [{ path: 'gauge.rate', op: 'mul', v: 1 + haste }] : []
}

// Foes of a room on the current floor start with the floor's multipliers plus their synergies: those of the
// formation they stand in (`foes`: the room's first by default, or one of its later waves).
export const roomFoeMods = (run, node, foes = node.foes) => [...foeMods(run.state.floor, node.type === 'boss'), ...activeSynergies(foes).flatMap((s) => s.mods)]

// ── abilities and statuses ───────────────────────────────────────────────────────────────────────

const SHAPE = {
  single: 'one foe',
  ally: 'the most wounded ally',
  self: 'itself',
  row: 'a foe and everyone level with it, in every lane',
  blast: 'a foe and everyone next to it',
  column: 'a foe and everyone in its lane',
  all: 'every foe',
  all_allies: 'every ally'
}

// A shape in a word or two, for an ability's one line (SHAPE has it in full).
const SHAPE_WORD = { single: null, ally: 'wounded ally', self: 'self', row: 'row', blast: 'blast', column: 'lane', all: 'all foes', all_allies: 'all allies' }

// An effect in a few words: numbers first, a status as its keyword (its rule is in the glossary).
function effectText (e, st) {
  const est = (power) => Math.round(power * st.atk / TUNING.damage.atkDivisor)
  switch (e.op) {
    case 'damage': return [h('b', null, e.power), ' power ', h('span', { class: 'dim' }, `≈${est(e.power)} pre-DEF`)]
    case 'heal': return [e.self ? 'heals self ' : 'heals ', h('b', null, e.power), h('span', { class: 'dim' }, ` ≈${Math.round(est(e.power) * st.heal.given)} HP`)]
    case 'apply_status': {
      const s = statusDef(e.status)
      return [e.chance !== undefined ? `${pct(e.chance)} ` : '', kw(e.status, s.name), ` ${secs(e.dur ?? s.dur)}`]
    }
    case 'cleanse': return `cleanses ${e.count}`
    case 'gauge': return e.amount <= -1000 ? 'empties gauge (not bosses)' : `${e.amount < 0 ? '−' : '+'}${Math.abs(e.amount)} gauge (not bosses)`
    case 'raise': return ['raises ', h('b', null, e.count), ' dead as ', kw('shadow', 'shadows')]
    default: return e.op
  }
}

// A melee blow with a range of its own past the tiles beside it says it ("Melee 2"); one without reaches its kind's
// arm, which the card's ring line tells (ringRule).
function reachTag (a) {
  if (a.melee) return h('span', { class: 'tag-melee' }, a.range > 1 ? `Melee ${a.range}` : 'Melee')
  const r = rangeOf(a)
  if (isAllyShape(a.shape) && !Number.isFinite(r)) return null
  return h('span', { class: 'tag-ranged' }, Number.isFinite(r) ? `Range ${r}` : 'Any range')
}

// One ability in one line: name, reach, shape and effects, its cost on the right.
// realm: Arise's reach and the relics held (realmOf, or a battle's), for Arise's numbers. Arise is the Arise relic's:
// without a realm that holds a copy it is not listed at all (null).
export function abilityBlock (id, st, realm = null) {
  const a = abilityDef(id)
  if (a.shape === 'corpse' && !(realm?.held?.arise > 0)) return null
  const word = a.shape === 'all_allies' && Number.isFinite(rangeOf(a)) ? `allies ≤${rangeOf(a)}` : a.shape === 'all' && a.range ? `foes ≤${a.range}` : SHAPE_WORD[a.shape]
  return h('div', { class: 'ability' + (a.shape === 'corpse' ? ' arise' : '') },
    h('b', null, a.name), ' ',
    a.shape === 'corpse'
      ? ariseText(realm)
      : [reachTag(a), word && h('span', { class: 'tag-shape' }, word), ' ', a.effects.map((e, i) => [i ? ' · ' : '', effectText(e, st)]),
          a.cond && h('span', { class: 'dim' }, ` · only ${a.cond}`)],
    h('span', { class: 'ab-cost dim' }, `${a.castCost}g · ${fillTime(st, a.castCost)}`))
}

// A unit's aura in one line, under its abilities (a card's, a panel's), or nothing.
export function auraBlock (u) {
  const aura = auraOf(u)
  return aura && h('div', { class: 'ability' }, h('b', null, 'Aura'), ' ', h('span', { class: 'tag-shape' }, `≤${aura.range}`), ' ', aura.desc)
}

// A piece's HP as one pool of its bodies at the stats it fights with (`st`), its wounds kept in proportion:
// [hp, max].
export function poolHp (u, st) {
  const max = Math.round(st.hp * (u.count ?? 1))
  return [u.hp == null ? max : Math.max(0, Math.round(u.hp / (u.maxHp || 1) * max)), max]
}

// An HP bar, red under 35%, marked dead when empty (a card's, a panel's, a list's).
export function hpBar (hp, max) {
  const f = Math.max(0, Math.min(1, hp / max))
  return h('span', { class: 'hpbar' + (f <= 0 ? ' dead' : f < 0.35 ? ' low' : '') }, h('span', { style: `width:${f * 100}%` }))
}

function statusLine (s) {
  const d = statusDef(s.id)
  return h('span', { class: 'status-line' }, kw(s.id, d.name), s.stacks > 1 ? ` ×${s.stacks}` : '',
    h('span', { class: 'dim' }, ` ${s.dur === 'battle' ? 'all battle' : secs(s.dur)}`))
}

// ── the Monarch ──────────────────────────────────────────────────────────────────────────────────

// Arise's reach (run.js domainOf, Court of Bone's tiles too), and the relics' rules (`held`, battle.js relicRules):
// the copies of the Arise relic (none: it raises no one, and nothing of it is shown), from which its numbers come
// (ariseTier, ariseCap: the relic's own, growing with each copy past the first), its cap grown by `raises` and a
// `tithe` of the Monarch's max HP a shadow (Blood Tithe); and shadows that pay again after a win (`reap`, Hollow
// Court). A battle's realm is { domain: battle.domain, held: battle.held, reap }.
export const realmOf = (run) => ({ domain: domainOf(run.state), held: relicRules(run.state.relics), reap: holds(run.state, 'reap') })
const titheOf = (realm) => realm.held.tithe ?? 0

// A relic's name in its tier's colour, its rule on hover.
export const relicName = (id) => h('b', { class: `c-${relicTier(id)}`, tip: () => relicTip(id) }, relicDef(id).name)

// Arise in one line, as the run holds it (abilityBlock lists it only then): what it raises, from how far, how many.
function ariseText (realm) {
  return [h('span', { class: 'tag-domain' }, `${realm.domain} tiles`), ` a foe corpse, tier ≤ ${ariseTier(realm.held)} → `, kw('shadow'), ` at ${pct(TUNING.arise.hp)} HP · `, h('b', null, ariseCap(realm.held)), ' a battle',
    realm.held.arise > 1 && h('span', { class: 'dim' }, ` (Arise ×${realm.held.arise})`),
    realm.reap && ' · Hollow Court reaps it',
    titheOf(realm) > 0 && h('span', { class: 'warn' }, ` · −${pct(titheOf(realm))} HP each`)]
}

// What sets the field size (pieces on the field), as the run has it: "Command 4 (3 + 1 from relics)", and the
// board's cap once Command passes it.
export const fieldRule = (run) => {
  const s = run.state
  const more = commandOf(s) - baseField(s)
  return `Command ${commandOf(s)}${more ? ` (${baseField(s)} + ${more} from relics)` : ''}${commandOf(s) > TUNING.army.board ? `, at most ${TUNING.army.board}` : ''}`
}

// The relics that give `key` (RELIC_LIST: `monarchHp`, `command`), a copy each: "Bone Horn +1 (Common)".
const giversOf = (key) => RELIC_LIST.filter((r) => r[key]).map((r) => `${r.name} +${r[key]} (${RELIC_TIERS.find((x) => x.id === r.tier).name})`)
// The relics the run holds that give `key`, a copy each: "Bone Mantle +45, Bone Horn ×2 +2", or null for none.
const heldGivers = (run, key) => {
  const ids = [...new Set(run.state.relics)].filter((id) => relicDef(id)[key])
  return ids.length ? ids.map((id) => { const n = relicCount(run.state, id); return `${relicDef(id).name}${n > 1 ? ` ×${n}` : ''} +${n * relicDef(id)[key]}` }).join(', ') : null
}

// The Monarch's read-out (DESIGN §2.6): nothing is bought for it. Its HP and Command are its base and its relics',
// every copy in full (run.js monarchHp, commandOf). Arise's numbers are the relic's, not the Monarch's: they show on
// its card and the relic's, and only while the run holds it. Each: its name, its icon (dom.js), its value now, a few
// words on what that gives, and its rule in full for the hover.
export const MONARCH_TEXT = {
  hp: {
    name: 'HP', icon: 'hp', value: (run) => monarchHp(run.state), now: (run) => monarchHp(run.state) > TUNING.monarch.hp ? `${TUNING.monarch.hp} + ${monarchHp(run.state) - TUNING.monarch.hp} relics` : 'max, no relics yet',
    rule: (run) => [`Its health: if it runs out, the run ends. ${TUNING.monarch.hp} to begin; only relics raise it, every copy in full, and heal it by as much: ${giversOf('monarchHp').join(', ')}.`,
      heldGivers(run, 'monarchHp') ? `Yours: ${heldGivers(run, 'monarchHp')}.` : 'You hold none yet.',
      holds(run.state, 'unhealable') ? 'Court of Bone: nothing heals it.' : `Its wounds carry: ${WOUNDS_TEXT}.`]
  },
  command: {
    // Its pieces on the field now, of the most it may field (the value says the Command itself).
    name: 'Command', icon: 'command', value: (run) => commandOf(run.state), now: (run) => `${fielded(souls(run.state.party)).length} of ${fieldCap(run)} on the field`,
    rule: (run) => [`How many pieces it fields (at most ${TUNING.army.board}). ${baseField(run.state)} to begin; only relics raise it, every copy in full: ${giversOf('command').join(', ')}. A won elite always offers one.`,
      heldGivers(run, 'command') ? `Yours: ${heldGivers(run, 'command')}.` : 'You hold none yet.']
  }
}
// Nothing is bought for the Monarch, in a line.
export const MONARCH_RULE = 'Nothing is bought for the Monarch: its HP and Command grow only by relics.'
// What mends between battles (TUNING.run: postBattleHeal, altarHeal), in words: wounds carry from room to room.
export const WOUNDS_TEXT = `a win heals each living body ${pct(TUNING.run.postBattleHeal)} of its HP; an altar heals ${TUNING.run.altarHeal >= 1 ? 'every body to full' : `each to ${pct(TUNING.run.altarHeal)} of its HP`}`

// ── rings ────────────────────────────────────────────────────────────────────────────────────────

// The blows a kind strikes: its abilities aimed at the other side (not an ally ability, nor Arise's raise).
const blowsOf = (u) => abilitiesOf(u).map(abilityDef).filter((a) => !isAllyShape(a.shape) && a.shape !== 'corpse')
// Whether every blow a kind strikes is a melee one (melee from the ground never touches a flyer: DESIGN §2.3).
const meleeOnly = (u) => {
  const blows = blowsOf(u)
  return blows.length > 0 && blows.every((a) => a.melee)
}
// How far a foe's blows reach (DESIGN §2.3: a foe has no melee reach): its longest ranged blow's range, never past its
// ring (battle.js reachOf), in tiles from its tile; 0 for a kind whose every blow is melee, which strikes only what
// stands beside it, and only what closeIn lets it. Its ring means nothing more: yours never walk into it.
export const foeReach = (u) => Math.min(ringOf(u), Math.max(0, ...blowsOf(u).filter((a) => !a.melee).map(rangeOf)))
// A piece's ring in a few words ("Ring 2 · melee · 2×2"), and for a foe its reach (a foe has no melee reach: "Ring 3 ·
// ranged" for a shooter, "Melee, no reach" for the rest), its gait and its way on the roads. A foe kind not yet met
// keeps them to itself (the bestiary): only what a scout sees.
export function ringText (u, foe = false) {
  const d = unitDef(u.id)
  if (d.monarch) return `Ring ${ringOf(u)} · never strikes · never moves`
  const big = sizeOf(u) > 1 && '2×2'
  if (foe && !bestiary.has(u.id)) return ['Ring ?', big, strideText(u), 'its ways unknown until met'].filter(Boolean).join(' · ')
  if (foe) return [foeReach(u) > 0 ? `Ring ${foeReach(u)} · ranged` : 'Melee, no reach', big, strideText(u), BEHAVIOURS[behaviourOf(u)].name].filter(Boolean).join(' · ')
  return [`Ring ${ringOf(u)}`, meleeOnly(u) ? 'melee' : 'ranged', big].filter(Boolean).join(' · ')
}
// How fast a foe kind walks (its stride: steps per TUNING.board.stepTicks), as a word and its number, or nothing at
// the common pace: "slow ×0.75", "fast ×1.5". Yours never step.
const strideText = (u) => {
  const x = strideOf(u)
  return x === 1 ? null : `${x < 1 ? 'slow' : 'fast'} ×${+x.toFixed(2)}`
}
// The same rule in a sentence, for a card's details (DESIGN §2.3–§2.4): yours fight what their blows reach in the ring
// (a melee blow its kind's arm: unit.js armOf), and a foe walking into it halts there only once it can strike something
// of yours from where it stands, and only as far as its blows that need no condition reach (its sight, unit.js holdOf:
// said where it falls short of the ring); a foe met fights only once halted, its ranged blows to its reach (foeReach),
// its melee only what stands beside it as closeIn allows, followed by its way in its own words (BEHAVIOURS).
export function ringRule (u, foe = false) {
  if (unitDef(u.id).monarch) return `It stands on its seat, never moves and never strikes; the roads run to it, and a foe that comes within ${ringOf(u)} tile of it halts there.`
  if (foe && !bestiary.has(u.id)) return 'Not met yet: how far it fights, and how it walks the roads, you learn by meeting it.'
  const tiles = (r) => `${r} tile${r === 1 ? '' : 's'} ${sizeOf(u) > 1 ? 'of its four tiles' : 'of its tile'}`
  const melee = meleeOnly(u) && !unitDef(u.id).flies ? ` Its blows are melee: they never reach up to a flyer${foe ? '' : ', though a flyer whose way it stands in is held there'}.` : ''
  if (!foe) {
    const arm = Math.min(ringOf(u), armOf(u))
    const farther = blowsOf(u).some((a) => a.melee && a.range > arm) ? ', farther where a blow says so' : ''
    const how = [blowsOf(u).some((a) => !a.melee) && 'its ranged blows to their range', hasMelee(u) && `its melee ${arm > 1 ? `reaching ${arm} tiles` : 'only beside it'}${farther}`].filter(Boolean).join(', ')
    const sight = holdOf(u).ground
    const halt = sight < ringOf(u)
      ? `A foe walking into that ring halts only within ${tiles(sight)}, as far as its blows that need no condition reach, and only once it can strike something of yours from where it stands.`
      : 'A foe walking into that ring halts there only once it can strike something of yours from where it stands.'
    return `It fights whatever its blows reach within ${tiles(ringOf(u))}${how ? ` (${how})` : ''}. ${halt}${melee} It never moves: with nothing to strike, it waits.`
  }
  // What its melee strikes is in its way's own words (BEHAVIOURS): a walker's and a flyer's alike, what blocks it (a
  // flyer's way held by a piece of yours, on the ground or in the air: battle.js closeIn), the Monarch, and a piece
  // beside it that struck it.
  const r = foeReach(u)
  const reach = r > 0 ? `Halted, it shoots whatever it can within ${tiles(r)}.` : 'It has no reach.'
  return `${reach}${melee} ${BEHAVIOURS[behaviourOf(u)].desc}`
}
// Whether a kind strikes any melee blow.
const hasMelee = (u) => blowsOf(u).some((a) => a.melee)

// ── the enemy ────────────────────────────────────────────────────────────────────────────────────

// The enemy as an army: stacks, waves, the Sovereign's court. Who comes and where they stand, never what they
// mean to do.
const SP = TUNING.spawn
const W = SP.waves
// A share in words: "a third", "half", or a percentage.
const shareText = (f) => (Math.abs(f - 1 / 3) < 1e-9 ? 'a third' : f === 0.5 ? 'half' : pct(f))

export const ENEMY_TEXT = {
  // A foe piece of several bodies (`n`), one pool on one tile.
  stack: (n) => `A stack of ${n}: one pool of HP on one tile, its bodies falling one at a time.`,
  waves: `From floor ${W.floor}: elites (${W.elite} waves), fights from rank ${W.fightRank} (${W.fight}) and sieges (${W.siege}). Each enters at the far edge once the last is down to ${shareText(W.share)}, or after ${secs(W.t)}.`,
  late: `A floor-1 elite: ${SP.late.n} more foes come over the far edge at ${secs(SP.late.t)}.`,
  entry: 'Each foe that enters restarts the escalation clock.'
}

// A room's foes, every wave's: the formation that stands from the start, then each later wave's.
const roomFoes = (node) => [node.foes ?? [], ...(node.waves ?? []).map((w) => w.foes)].flat()
// A later wave (node.waves[k]) by name, and when it comes, as the scouts can tell it.
export const waveName = (node, k) => node.waves[k].foes.some((f) => unitDef(f.id).boss) ? `Wave ${k + 2}: the Sovereign` : `Wave ${k + 2}`
export const waveWhen = (w) => w.when.at === 'time'
  ? `${bodies(w.foes)} more at ${secs(w.when.t)}.`
  : `At ${shareText(W.share)} of the last, or ${secs(w.when.t)}.`
// "5 foes", "15 foes in 3 waves": bodies, a stack counting each of its own.
const bodies = (foes) => foes.reduce((n, f) => n + (f.count ?? 1), 0)
export function foeCountText (node) {
  const n = bodies(node.foes)
  const later = node.waves ?? []
  const more = later.reduce((m, w) => m + bodies(w.foes), 0)
  return !later.length ? `${n} foe${n > 1 ? 's' : ''}` : `${n + more} foes in ${later.length + 1} waves`
}
// A formation's stacks, a line: "Stacks: Grave Ghoul ×3, Drone ×3."
function stackLine (foes) {
  const big = foes.filter((f) => (f.count ?? 1) > 1)
  if (!big.length) return null
  return h('div', { class: 'dim small' }, 'Stacks: ', big.map((f, i) => [i ? ', ' : '', h('b', null, unitDef(f.id).name), ` ×${f.count}`]), '.')
}

// Where a board tile lies, in words: a camp row and lane, the open ground, or a row of their formation.
export function tileText (tile) {
  const y = tileY(tile)
  const lane = `lane ${tileX(tile) + 1}`
  const r = CAMP_ROWS - 1 - y
  if (y < CAMP_ROWS) return `your camp, ${r === 0 ? 'front row' : r === CAMP_ROWS - 1 ? 'rear row' : `row ${r + 1}`}, ${lane}`
  if (y < DEPTH - ROWS) return `the open ground between the sides, ${lane}`
  return `their formation, ${['front', 'middle', 'back'][y - (DEPTH - ROWS)]} row, ${lane}`
}

// What felled the Monarch (run.state.death), in words: who, with what, from where, and the threat. `battle`
// (run.battle, the last one) tells a shadow from the living: on their side, one of your own dead risen
// against you (their Legion).
export function deathText (s, battle = null) {
  const d = s.death
  if (!d) return null
  const threat = d.threat && THREATS[d.threat]
  if (d.reason === 'tick-ceiling') {
    return { head: 'The battle never ended', lines: [`It was still undecided ${secs(TUNING.tick.ceiling)} after the last foe entered (after the start, if none had), and an undecided battle is a defeat.`], threat }
  }
  const m = monarchOf(s)
  const own = d.uid === m?.uid
  const away = m && m.slot >= 0 && d.from != null ? distance(d.from, deployTile('party', m.slot)) : null
  return {
    head: own ? 'The Monarch fell to a lingering wound'
      : battle?.units.find((u) => u.uid === d.uid)?.shadow ? `Slain by the shadow of your own ${unitDef(d.by).name}, risen against you` : `Slain by ${unitDef(d.by).name}`,
    lines: [
      own ? 'A status ticking on it dealt the last of the damage.' : `With ${d.ability ? abilityDef(d.ability).name : 'a blow'}${d.ability && abilityDef(d.ability).shape !== 'single' && SHAPE[abilityDef(d.ability).shape] ? `, which hits ${SHAPE[abilityDef(d.ability).shape]}` : ''}.`,
      !own && d.from != null && `From ${tileText(d.from)}${away != null ? `: ${away} tile${away === 1 ? '' : 's'} from the Monarch` : ''}.`,
      !own && d.wave && waveDeath(s, d.wave)].filter(Boolean),
    threat
  }
}

// The killer came in a later wave (d.wave: 1 is the first after the formation): which, from the room's scouting.
function waveDeath (s, k) {
  const w = s.map?.nodes.find((n) => n.id === s.at)?.waves?.[k - 1]
  return w?.when.at === 'time' ? `The killer came over the far edge ${secs(w.when.t)} into the battle.` : `It came with wave ${k + 1}, over the far edge.`
}

// ── the bestiary ─────────────────────────────────────────────────────────────────────────────────

// The foe kinds met in battle, kept between runs in this browser (DESIGN §7): how far a kind strikes and its way on
// the roads are told only once it has been met, and from then on for good.
const metSet = () => new Set((prefs.get('met') ?? '').split(',').filter(Boolean))
export const bestiary = {
  has: (id) => metSet().has(id),
  record (ids) {
    const met = metSet()
    const before = met.size
    for (const id of ids) met.add(id)
    if (met.size !== before) prefs.set('met', [...met].join(','))
  }
}
// The kinds a bestiary lists: every one that can come at you, the Sovereign last.
const FOE_KINDS = UNIT_LIST.filter((u) => u.spawn || u.boss).sort((a, b) => !!a.boss - !!b.boss || a.tier - b.tier || a.name.localeCompare(b.name))

// ── unit card ────────────────────────────────────────────────────────────────────────────────────

// A tooltip's details wait under Shift: held down, a unit card opens its abilities, tiers and notes (main.js
// re-renders the tooltip as Shift goes down or up). A pinned card (a long press, or a click: dom.js) has a More ▾
// that does the same, so nothing needs the key.
export const tipDetail = { on: false }
const shiftHint = () => !tipDetail.on && h('span', { class: 'ct-more' }, h('kbd', null, 'Shift'), ' details')
// A note's first sentence, for a card's one live line.
const firstSentence = (n) => typeof n === 'string' ? n.split(/(?<=[.:;])\s/)[0].replace(/[.:;]$/, '') : null

// u: a run unit, a battle unit or a scouted foe { id, lvl, slot }. opts.mods: the mods it fights with;
// opts.stats overrides them with live battle stats; opts.statuses lists live statuses; opts.notes adds
// lines at the bottom of the details. realm: Arise's reach and the relics held, for its numbers (see abilityBlock:
// without a copy of the relic the Monarch's card lists no Arise). `live`: the one fact the card leads with; without
// one, the first note's first sentence, else its ring. `open`: the details shown whatever Shift says (a panel, not a
// tooltip).
// Three lines: name and level; the stats; the live line. The rest waits under Shift or More ▾ (tipDetail).
// A piece of several bodies shows its count by its name and its HP as the pool's.
export function unitCard (u, { mods = [], stats = null, statuses = null, notes = [], foe = false, realm = null, live = null, open = false } = {}) {
  const d = unitDef(u.id)
  const st = stats ?? statsOf(u, mods)
  const n = u.count ?? 1
  const [shown, maxHp] = poolHp(u, st)
  const stat = (key, label, v) => h('span', { class: 'sx', title: label }, icon(key, 13), h('b', null, v))
  const more = open || tipDetail.on
  // A multiplier on top of the stats, as a chip: ×1.20 dealt, ×0.80 taken, ×1.10 gauge.
  const mult = (v, what) => v !== 1 && h('span', { class: 'sx mult' + ((what === 'taken' ? v < 1 : v > 1) ? ' up' : ' down') }, `×${v.toFixed(2)} ${what}`)
  const aura = auraBlock(u)
  const kind = [d.kin && KIN[d.kin].name, d.monarch ? 'you' : ROLES[d.role].name, d.boss && 'Boss'].filter(Boolean).join(' · ')
  const tiers = foe ? [] : tiersOf(u)
  const abs = abilitiesOf(u).map((id) => abilityBlock(id, st, realm)).filter(Boolean)
  const lead = live ?? (d.monarch ? 'Never strikes; if it falls, the run ends' : firstSentence(notes.find((n) => typeof n === 'string')) ?? ringText(u, foe))
  return h('div', { class: 'card-tip compact' + (foe ? ' foe' : '') + (d.monarch ? ' monarch' : '') + (more ? ' open' : '') },
    h('div', { class: 'ct-name' },
      h('span', { class: 'ct-nm' }, d.name, n > 1 && h('span', { class: 'ct-count' }, ` ×${n}`)),
      // The Monarch has no level: nothing is bought for it.
      !d.monarch && h('span', { class: 'ct-lv dim' }, `Lv ${u.lvl}`),
      h('span', { class: 'ct-hp' }, hpBar(shown, maxHp), h('span', null, shown <= 0 ? 'fallen' : `${shown}/${maxHp}`))),
    // The stats as icons. The Monarch never strikes: its attack stats would mean nothing.
    h('div', { class: 'ct-stats' },
      !d.monarch && stat('atk', 'ATK', Math.round(st.atk)),
      stat('def', 'DEF', Math.round(st.def)),
      stat('spd', 'SPD', Math.round(st.spd)),
      !d.monarch && stat('acc', 'ACC', Math.round(st.acc)),
      stat('eva', 'EVA', Math.round(st.eva)),
      !d.monarch && stat('crt', 'CRT', `${Math.round(st.crt)}%`)),
    h('div', { class: 'ct-live' },
      h('span', { class: 'ct-lead' }, lead, statuses?.length > 0 && statuses.slice(0, 2).map((x) => [' · ', kw(x.id, statusDef(x.id).name)]), statuses?.length > 2 && ` +${statuses.length - 2}`),
      !open && shiftHint()),
    more && [
      h('div', { class: 'ct-kind dim' }, kind, u.shadow && [' · ', kw('shadow')], n > 1 && [' · ', kw('stack', `a stack of ${n}`)], sizeOf(u) > 1 && ' · 2×2', d.fused && [' · ', kw('fusion', 'fused')]),
      [mult(st.damage.dealt, 'dealt'), mult(st.damage.taken, 'taken'), mult(st.gauge.rate, 'gauge')].some(Boolean) &&
        h('div', { class: 'ct-mults' }, mult(st.damage.dealt, 'dealt'), mult(st.damage.taken, 'taken'), mult(st.gauge.rate, 'gauge')),
      (abs.length > 0 || aura) && h('div', { class: 'ct-abs' }, abs, aura),
      tiers.length > 0 && h('div', { class: 'ct-tiers' }, tiers.map((t, i) => h('div', { class: 'ct-tier' }, h('b', null, ROMAN[i] ?? i + 1), ' ', t.desc))),
      statuses?.length > 0 && h('div', { class: 'ct-statuses' }, statuses.map((x, i) => [i ? ' · ' : '', statusLine(x)])),
      h('div', { class: 'ct-foot' },
        h('div', { class: 'ct-role' }, h('b', null, ringText(u, foe)), h('span', { class: 'dim' }, ` · ${ringRule(u, foe)}`)),
        d.monarch && h('div', { class: 'warn' }, 'Never strikes; if it falls, the run ends. Only relics raise its HP and Command.'),
        // A foe's lore hints at what its kind does: what it will do is never shown.
        foe && d.flavour && h('div', { class: 'flavour' }, d.flavour),
        notes.filter(Boolean).map((n) => h('div', { class: 'note-line' }, n)))])
}

export const ROMAN = ['I', 'II', 'III', 'IV']

// ── threat ───────────────────────────────────────────────────────────────────────────────────────

// Rough fighting power: √(HP × ATK × damage dealt × gauge rate), wounds included. The ratio of the two sides,
// measured on the old rules (to be measured again in the balance pass): below 0.6 every battle won, 0.6–0.8
// 98%, 0.8–1.0 79%, 1.0–1.2 42%, above 1.2 19%.
// A stack of n bodies has n times the HP and deals n times the damage, so n times the power; a soul's tiers may
// add bodies for the battle (`extra`).
function power (u, mods, extra = 0) {
  const s = statsOf(u, mods)
  const hpFrac = u.maxHp ? u.hp / u.maxHp : 1
  return ((u.count ?? 1) * hpFrac + extra) * Math.sqrt(Math.max(0, s.hp) * s.atk * s.damage.dealt * gaugeRate(s))
}

const THREAT = [
  { below: 0.6, label: 'Low', cls: 't-low', text: 'Should be an easy win.' },
  { below: 0.8, label: 'Moderate', cls: 't-mod', text: 'Very likely a win.' },
  { below: 1.0, label: 'High', cls: 't-high', text: 'Usually a win, with losses.' },
  { below: 1.2, label: 'Severe', cls: 't-sev', text: 'Close to a coin flip.' },
  { below: Infinity, label: 'Deadly', cls: 't-dead', text: 'Usually a loss.' }
]
// Nothing of yours on the board can strike: no ratio to read, and no win.
const UNFIELDED = { label: 'Deadly', cls: 't-dead', text: 'Nothing of yours on the field can strike, and the Monarch alone cannot win.' }

function threat (run, node) {
  const mods = partyMods(run)
  const mine = souls(standing(run)).reduce((n, u) => n + power(u, mods, bodiesOf(u)), 0)
  // Each wave with its own formation's synergies. Waves come one after another, and a side's strength in a
  // melee grows as the square of its numbers, so the waves add as the root of their squared powers.
  const forms = [node.foes, ...(node.waves ?? []).map((w) => w.foes)]
  const waves = forms.map((foes) => { const mods = roomFoeMods(run, node, foes); return foes.reduce((m, f) => m + power(f, mods), 0) })
  const theirs = Math.sqrt(waves.reduce((n, p) => n + p * p, 0))
  // Their 8-step rules (in the deep: foeRulesOn), which no stat line shows: named, since the number cannot
  // weigh them.
  const rules = foeRulesOn(run) ? [...new Set(forms.flatMap((foes) => activeSynergies(foes).filter((syn) => syn.rule).map(ruleName)))] : []
  if (!(mine > 0)) return { mine: 0, theirs, ratio: Infinity, waves, rules, ...UNFIELDED }
  const ratio = theirs / mine
  return { mine, theirs, ratio, waves, rules, ...(THREAT.find((t) => ratio < t.below) ?? THREAT.at(-1)) }
}

export function threatMeter (run, node) {
  const t = threat(run, node)
  const share = t.theirs / (t.theirs + t.mine || 1)
  const why = () => h('div', { class: 'syn-tip' }, h('b', null, `Threat: ${t.label}`), ' ', h('span', { class: 'num foe' }, Math.round(t.theirs)), ' vs ', h('span', { class: 'num' }, Math.round(t.mine)),
    t.waves.length > 1 && h('span', { class: 'dim' }, ` (waves ${t.waves.map(Math.round).join(' + ')}, as √Σ²)`),
    h('p', { class: 'dim' }, 'HP × ATK × speed: your pieces on the field, not the Monarch. It cannot read where they stand or what they walk.'))
  return h('div', { class: `threat ${t.cls}`, tip: why },
    h('div', { class: 'threat-head' }, h('span', { class: 'dim' }, 'Threat '), h('b', null, t.label),
      h('span', { class: 'dim' }, ` · ${t.text}`)),
    h('div', { class: 'threat-bar' }, h('span', { class: 'theirs', style: `width:${share * 100}%` })),
    t.rules.length > 0 && h('div', { class: 'warn small', tip: () => 'Their 8-step rules hold in the deep. They bend the battle in ways no stat shows, so the meter does not weigh them: read it as the low end.' },
      `Not counted: their ${t.rules.join(', ')}.`))
}

// ── rooms ────────────────────────────────────────────────────────────────────────────────────────

const R = TUNING.relic
export const ROOM = {
  start: { name: 'Start', text: 'Where this floor begins.' },
  fight: { name: 'Fight', text: 'A battle: essence, and one of the slain to recruit.' },
  elite: { name: 'Elite', text: `A tier stronger. Pays essence and a recruit, plus a relic (1 of ${R.offer.elite}, one of them Command), and from floor ${R.legendary.fromFloor} a Legendary (1 of ${R.legendary.offer}).` },
  reliquary: { name: 'Reliquary', text: `No battle: one pick, free, from ${R.offer.reliquary} relics, up to ${R.offer.tiers} tiers of your kinds, and from floor ${R.legendary.fromFloor} ${R.legendary.offer} Legendaries.` },
  altar: { name: 'Altar', text: `No battle: all heal to full; the fallen rise in the ossuary (souls at ${pct(TUNING.run.altarRevive)} HP), to be placed again.` },
  boss: { name: 'The Hollow Sovereign', text: `${W.siege} waves, the last the Sovereign and its court. Kill it to clear the run.` },
  siege: { name: 'Siege', text: `${W.siege} waves, no prep between; essence paid with the win.` }
}

// ── the deep ─────────────────────────────────────────────────────────────────────────────────────

// The endless floors past the Sovereign's (TUNING.spawn.endless), in words: what descending means, how each
// floor deeper grows, and where a given floor stands.
const DEEP = TUNING.spawn.endless
const every = (k, what) => k >= 1 ? `${k} ${what} every floor deeper` : `one ${what} every ${+(1 / k).toFixed(1)} floors`
const perDeepWaves = every(DEEP.waves, 'more wave to every room')
const perDeepCohort = every(DEEP.cohort, 'more body in every stack')
const perDeep = DEEP.count >= 1 ? `${DEEP.count} more foe${DEEP.count === 1 ? '' : 's'} a wave` : `one more foe a wave every ${+(1 / DEEP.count).toFixed(1)} floors`
export const DEEP_TEXT = {
  descend: 'Slaying the Sovereign clears the run for good; then you may descend into the deep, floor after floor, for as long as the Monarch lasts.',
  growth: `Floor ${TUNING.run.floors}'s camps and foes; each floor deeper, +${TUNING.spawn.levelPerFloor + DEEP.level} levels, +${pct(DEEP.hp)} HP and +${pct(DEEP.atk)} ATK, with ${perDeep} (at most ${COLS * ROWS}), ${perDeepWaves} (up to ${DEEP.maxWaves}) and ${perDeepCohort}. ` +
    `Their 8-step rules hold from floor ${TUNING.run.floors + DEEP.rules}. Each floor ends in a big elite: +${DEEP.final.count} foes, +${DEEP.final.level} level${DEEP.final.level === 1 ? '' : 's'}.`,
  fall: 'A fall in the deep ends the run, but the clear stands.',
  now: (floor) => {
    const d = depthOf(floor)
    const more = Math.floor(d * DEEP.count)
    const waves = Math.floor(d * DEEP.waves)
    const cohort = Math.floor(d * DEEP.cohort)
    const up = d * DEEP.level
    return `Deep ${d}: foes ×${(1 + DEEP.hp * d).toFixed(2)} HP, ×${(1 + DEEP.atk * d).toFixed(2)} ATK${up ? `, +${up} level${up === 1 ? '' : 's'}` : ''}` +
      `${more ? `, +${more} a wave` : ''}${waves ? `, +${waves} wave${waves === 1 ? '' : 's'} a room` : ''}${cohort ? `, +${cohort} a stack` : ''}.`
  }
}

// A small read-only formation: front row at the bottom, facing the player's grid. A stack carries a flag with
// its count. `small`: a later wave's, in a row of them.
function miniGrid (foes, { small = false } = {}) {
  const at = new Map(foes.map((f) => [f.slot, f]))
  const rows = []
  for (let r = ROWS - 1; r >= 0; r--) {
    const cells = []
    for (let c = 0; c < COLS; c++) {
      const f = at.get(slotAt(r, c))
      cells.push(h('span', { class: 'mini-cell' + (f ? ' on' : '') + (f?.count > 1 ? ' cap' : '') },
        f && portrait(f.id, small ? 16 : 24), f?.count > 1 && h('i', { class: 'mini-flag' }, f.count)))
    }
    rows.push(h('div', { class: 'mini-row' }, cells))
  }
  return h('div', { class: 'mini-grid' + (small ? ' small' : '') }, rows, !small && h('div', { class: 'mini-label dim' }, 'front row ↓'))
}

// `enter`: an Enter ▸ button stands under it (a room chosen by touch), so its foot says nothing more.
// `scout`: the floor seen from prep, where no room can be entered.
export function roomTip (run, node, { reachable, enter = false, scout = false }) {
  const r = ROOM[node.type]
  const kinds = node.foes && [...new Set(roomFoes(node).map((f) => unitDef(f.id).name))]
  const syns = node.foes && synergyNames(activeSynergies(node.foes).filter((syn) => !syn.rule || foeRulesOn(run)))
  return h('div', { class: 'room-tip compact' },
    h('div', { class: `rt-head t-${node.type}` }, icon(node.type === 'boss' ? 'boss' : node.type, 20), h('b', null, r.name),
      node.foes && h('span', { class: 'rt-count' }, `${foeCountText(node)} · Lv ${node.foes[0].lvl}`)),
    h('p', { class: 'rt-text' }, r.text),
    node.type === 'altar' && holds(run.state, 'unhealable') && h('p', { class: 'warn' }, 'Court of Bone: not the Monarch.'),
    depthOf(run.state.floor) > 0 && node.type === 'elite' && node.next.length === 0 && h('p', { class: 'warn' }, `Big elite: +${DEEP.final.count} foes, +${DEEP.final.level} levels. Then floor ${run.state.floor + 1}.`),
    node.foes && [
      h('div', { class: 'rt-body' }, miniGrid(node.foes), h('div', { class: 'rt-info' },
        h('div', { class: 'dim small' }, kinds.join(', ')),
        stackLine(node.foes),
        syns.length > 0 && h('div', { class: 'dim small' }, kw('synergy', 'Synergies'), ': ', syns.map((n, i) => [i ? ' · ' : '', h('b', null, n)])))),
      node.waves && h('div', { class: 'rt-waves' }, node.waves.map((w, k) => h('div', { class: 'rt-wave' },
        h('b', null, waveName(node, k)), miniGrid(w.foes, { small: true }), h('div', { class: 'dim small' }, waveWhen(w))))),
      threatMeter(run, node)],
    !(reachable && enter) && h('div', { class: 'rt-foot ' + (reachable && !scout ? 'go' : 'dim') },
      node.id === run.state.at ? 'You are here' : scout ? (reachable ? 'Next, after this battle' : 'Not reachable yet') : reachable ? say('Click to enter', 'Tap it again to enter') : 'Not reachable yet'))
}

// Their synergies, short; `run` given, the 8-step rules only where the foes hold them (the deep: see
// TUNING.spawn.endless.rules), as the battle does.
export const foeRulesOn = (run) => depthOf(run.state.floor) >= TUNING.spawn.endless.rules
export function foeSynergyLine (foes, run = null) {
  const active = synergyNames(activeSynergies(foes).filter((syn) => !syn.rule || !run || foeRulesOn(run)))
  return h('div', { class: 'dim small' }, active.length ? ['Their synergies: ', active.map((n, i) => [i ? ' · ' : '', h('b', null, n)])] : 'No synergies.')
}

// ── synergies ────────────────────────────────────────────────────────────────────────────────────

// `alias` ({ role: role }, Mimicry's): a unit of the first role counts as the second too.
const rolesOf = (d, alias) => (alias?.[d.role] && alias[d.role] !== d.role ? [d.role, alias[d.role]] : [d.role])
// Each synergy's needs, flat: [{ axis, id, n }].
const needsOf = (syn) => ['kin', 'role'].flatMap((axis) => Object.entries(syn.needs[axis] ?? {}).map(([id, n]) => ({ axis, id, n })))

// The synergies as steps: each kin's and role's own ladder (one need, at 2/4/6/8, Ranger's at 3/6/8), whose
// steps stack and whose top step is a rule; and the pacts, which need a kin and a role at once.
const LADDERS = Object.values(Object.groupBy(SYNERGIES.filter((syn) => needsOf(syn).length === 1), (syn) => `${needsOf(syn)[0].axis}:${needsOf(syn)[0].id}`))
  .map((steps) => {
    const { axis, id } = needsOf(steps[0])[0]
    return { axis, id, name: (axis === 'kin' ? KIN : ROLES)[id].name, steps: steps.map((syn) => ({ n: needsOf(syn)[0].n, syn })).sort((a, b) => a.n - b.n) }
  })
const PACTS = SYNERGIES.filter((syn) => needsOf(syn).length > 1)
const ladderOf = (syn) => LADDERS.find((l) => l.steps.some((st) => st.syn === syn))

// A synergy's colour on the board, where its pieces glow in it (DESIGN §2.7), and on its chip: a kin's or a
// role's ladder its own hue, eleven spread round the wheel; every pact the pale white of a bond.
const SYN_COLOUR = {
  drake: '#f6935a', vanguard: '#f6cf5a', insect: '#e2f65a', undead: '#9bf65a', warden: '#5af68e', skirmisher: '#5af1f6',
  ranger: '#5ab5f6', construct: '#5a79f6', channeler: '#935af6', fae: '#f15af6', trickster: '#f65aa8'
}
const PACT_COLOUR = '#f2ecff'

// A rule step's name and what it does: "The Legion", "every foe slain rises…" (its desc reads "Name: text").
const ruleName = (syn) => syn.desc.split(': ')[0]
const ruleText = (syn) => syn.desc.slice(syn.desc.indexOf(': ') + 2)
const ruleTag = () => h('span', { class: 'tag-rule' }, 'Rule')

// Active synergies, short: of each ladder only its top step reached ("Undead 6", "Undead 8: The Legion"),
// then the pacts.
const synergyNames = (active) => active.filter((syn) => {
  const l = ladderOf(syn)
  return !l || l.steps.filter((st) => active.includes(st.syn)).at(-1).syn === syn
}).map((syn) => (syn.rule ? `${syn.name}: ${ruleName(syn)}` : syn.name))

const countsOf = (units, alias = null) => {
  const c = { kin: {}, role: {} }
  for (const u of units) {
    const d = unitDef(u.id)
    if (ROLES[d.role].hidden) continue
    c.kin[d.kin] = (c.kin[d.kin] ?? 0) + 1
    for (const role of rolesOf(d, alias)) c.role[role] = (c.role[role] ?? 0) + 1
  }
  return c
}
const counts = (u, axis, id, alias) => !ROLES[unitDef(u.id).role].hidden && (axis === 'role' ? rolesOf(unitDef(u.id), alias).includes(id) : unitDef(u.id)[axis] === id)

// The synergies in effect among `units` (your pieces), as the board glows them: each ladder reached and each
// pact, with its colour and its pieces' uids. → [{ key, name, colour, uids: Set }]
export function synergyGroups (units, alias = null) {
  const living = units.filter((u) => u.hp > 0)
  const c = countsOf(living, alias)
  const ladders = LADDERS.filter((l) => (c[l.axis][l.id] ?? 0) >= l.steps[0].n).map((l) => ({
    key: `${l.axis}:${l.id}`, name: synergyNames(l.steps.filter((st) => (c[l.axis][l.id] ?? 0) >= st.n).map((st) => st.syn)).at(-1),
    colour: SYN_COLOUR[l.id] ?? PACT_COLOUR, uids: new Set(living.filter((u) => counts(u, l.axis, l.id, alias)).map((u) => u.uid))
  }))
  const pacts = PACTS.filter((syn) => synergyActive(syn, c)).map((syn) => ({
    key: `pact:${syn.id}`, name: syn.name, colour: PACT_COLOUR,
    uids: new Set(living.filter((u) => needsOf(syn).some(({ axis, id }) => counts(u, axis, id, alias))).map((u) => u.uid))
  }))
  return [...ladders, ...pacts]
}

const needText = (syn, c) => needsOf(syn).map(({ axis, id, n }) => ({ name: (axis === 'kin' ? KIN : ROLES)[id].name, have: c[axis][id] ?? 0, n, axis, id }))

const COUNT_NOTE = 'Counts your pieces standing on the board (and shadows in battle), never the Monarch.'

// The kins and roles you field as chips: lit (in the synergy's colour) once a step is reached, dim while the
// next step is a single piece away; the rest fold into one "+N" chip. Each chip's tooltip holds its whole step
// ladder and who counts. `units`: your pieces. `alias`: Mimicry's (aliasOf). `focus`, `onFocus(key)`: a lit
// chip pressed lights its pieces on the board (and again, lets them go).
export function synergyTracker (units, alias = null, { focus = null, onFocus = null } = {}) {
  const living = units.filter((u) => u.hp > 0)
  const c = countsOf(living, alias)
  const who = (axis, id) => tally(living.filter((u) => counts(u, axis, id, alias)).map((u) => unitDef(u.id).name)) || 'none fielded'
  const mimicry = (axis, id) => alias && axis === 'role' && Object.values(alias).includes(id) && h('p', { class: 'dim' }, `Mimicry: ${Object.entries(alias).map(([a, b]) => `${ROLES[a].name}s count as ${ROLES[b].name}s`).join(', ')} too.`)
  const ladders = LADDERS.map((l) => ({ l, have: c[l.axis][l.id] ?? 0 })).filter((x) => x.have > 0)
    .map(({ l, have }) => ({ l, have, on: have >= l.steps[0].n, next: l.steps.find((st) => have < st.n), key: `${l.axis}:${l.id}` }))
    .map((x) => ({ ...x, near: !!x.next && x.next.n - x.have === 1 }))
  const pacts = PACTS.map((syn) => ({ syn, needs: needText(syn, c), on: synergyActive(syn, c), key: `pact:${syn.id}` }))
    .filter((x) => x.on || x.needs.every((n) => n.have > 0))
    .map((x) => ({ ...x, near: !x.on && x.needs.reduce((k, n) => k + Math.max(0, n.n - n.have), 0) === 1 }))
  if (!ladders.length && !pacts.length) return h('p', { class: 'dim' }, 'None yet: field 2 of one kin or role.')
  const press = (x) => x.on && onFocus ? () => onFocus(x.key) : null
  const ladderTip = ({ l, have, next }) => h('div', { class: 'syn-tip' },
    h('b', null, `${l.name} ${have}`), h('span', { class: 'dim' }, ` · ${who(l.axis, l.id)}`),
    h('ol', { class: 'steps-list' }, l.steps.map(({ n, syn }) => h('li', { class: have >= n ? 'held' : '' },
      h('b', null, n), ' ', syn.rule ? [ruleTag(), ' ', h('b', null, ruleName(syn)), ': ', ruleText(syn)] : syn.desc.replace(`${l.name} ${n}: `, '')))),
    h('p', { class: 'dim' }, next ? `${next.n - have} more for ${next.syn.name}. ` : 'Every step reached. ', 'Steps stack. ', COUNT_NOTE))
  const ladderChip = (x) => h(x.on && onFocus ? 'button' : 'span', {
    class: 'syn chip' + (x.on ? ' on' : '') + (x.near ? ' near' : '') + (!x.next ? ' top' : '') + (focus === x.key ? ' focus' : ''),
    style: x.on ? `--g:${SYN_COLOUR[x.l.id]}` : null, onclick: press(x), tip: () => ladderTip(x)
  }, x.l.name, ' ', h('b', null, x.have),
  h('span', { class: 'syn-steps' }, x.l.steps.map(({ n, syn }) => h('i', { class: (x.have >= n ? 'held' : '') + (syn.rule ? ' rule' : '') + (x.next?.n === n ? ' next' : '') }, n))))
  const pactTip = ({ syn, needs, on }) => h('div', { class: 'syn-tip' },
    h('b', null, syn.name), ' ', h('span', null, syn.desc.split(': ').at(-1)),
    needs.map((n) => h('div', { class: 'small' }, `${n.name} ${n.have}/${n.n} `, h('span', { class: 'dim' }, who(n.axis, n.id)))),
    needs.map((n) => mimicry(n.axis, n.id)).find(Boolean),
    !on && h('p', { class: 'dim' }, COUNT_NOTE))
  const pactChip = (x) => h(x.on && onFocus ? 'button' : 'span', {
    class: 'syn chip pact' + (x.on ? ' on' : '') + (x.near ? ' near' : '') + (focus === x.key ? ' focus' : ''),
    style: x.on ? `--g:${PACT_COLOUR}` : null, onclick: press(x), tip: () => pactTip(x)
  }, x.syn.name, ' ', h('b', null, x.needs.map((n) => `${Math.min(n.have, n.n)}/${n.n}`).join('+')))
  const far = [...ladders.filter((x) => !x.on && !x.near), ...pacts.filter((x) => !x.on && !x.near)]
  return h('div', { class: 'syns chips' },
    ladders.filter((x) => x.on || x.near).sort((a, b) => b.on - a.on || b.have - a.have).map(ladderChip),
    pacts.filter((x) => x.on || x.near).sort((a, b) => b.on - a.on).map(pactChip),
    far.length > 0 && h('span', {
      class: 'syn chip far',
      tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'Further off'), far.map((x) => x.l
        ? h('div', { class: 'small' }, `${x.l.name} ${x.have}/${x.next.n}`, h('span', { class: 'dim' }, ` · ${x.next.syn.desc}`))
        : h('div', { class: 'small' }, `${x.syn.name} ${x.needs.map((n) => `${n.have}/${n.n}`).join('+')}`, h('span', { class: 'dim' }, ` · ${x.syn.desc}`))))
    }, `+${far.length}`))
}

// Names with repeats counted: "Tomb Knight, Grave Ghoul ×3".
const tally = (names) => Object.entries(Object.groupBy(names, (n) => n)).map(([n, xs]) => (xs.length > 1 ? `${n} ×${xs.length}` : n)).join(', ')

// ── relics ─────────────────────────────────────────────────────────────────────────

// The moments a trigger relic fires on (TRIGGERS), for your side only. `short`: the moment in a few words.
export const TRIGGER_TEXT = {
  kill: { name: 'On a kill', short: 'one of yours lands a killing blow' },
  fall: { name: 'On a fall', short: 'one of yours falls (never the Monarch)' },
  wave: { name: 'On a wave', short: 'a wave begins: the opening formation as the battle starts, then each later wave as it enters' },
  blow: { name: 'First blow', short: 'the battle\'s first blow lands, either side (once a battle)' },
  struck: { name: 'When struck', short: 'the Monarch takes damage and stands' }
}

// A relic's tier (RELIC_TIERS): { id, name, colour }.
const TIER = Object.fromEntries(RELIC_TIERS.map((x) => [x.id, x]))
// A relic: its name in its tier's colour and its rule, its tier (and with a run, the copies held), and for a
// trigger, the moment it fires on (once a copy). Arise held: its numbers now, for the copies held (run.js ariseOf:
// Court of Bone's tiles and Blood Tithe's share in them).
export const relicTip = (id, run = null) => {
  const r = relicDef(id)
  const n = run ? relicCount(run.state, id) : 0
  const a = id === 'arise' && n > 0 && ariseOf(run.state)
  return h('div', { class: `syn-tip relic-tip rt-${r.tier}` }, h('b', { class: `c-${r.tier}` }, r.name), ' ', h('span', null, r.desc),
    h('div', { class: 'dim small' }, h('span', { class: `tier-tag rt-${r.tier}` }, TIER[r.tier].name), run ? (n ? ` held${n > 1 ? ` ×${n}: every copy applies` : ''}` : ' not held') : ''),
    a && h('div', { class: 'small' }, `Yours now: tier ≤ ${a.tier}, within ${a.domain} tiles, ${a.raises} a battle${a.haste > 0 ? `, ${pct(a.haste)} sooner` : ''}.`),
    r.on && h('div', { class: 'dim small' }, h('span', { class: 'trig-tag' }, TRIGGER_TEXT[r.on].name), ` fires each time ${TRIGGER_TEXT[r.on].short}${n > 1 ? `, once a copy` : ''}.`))
}

// The relics held, one chip per relic in its tier's colour (a copy more a ×N), grouped by tier from Legendary to
// Common; `chip` draws one ({ id, n } → element).
export const relicsByTier = (ids, chip) => RELIC_TIERS.slice().reverse().map((t) => {
  const mine = [...new Set(ids)].filter((id) => relicTier(id) === t.id)
  return mine.length ? h('div', { class: `relic-tier rt-${t.id}` }, h('span', { class: `tier-tag rt-${t.id}` }, t.name),
    mine.map((id) => chip({ id, n: ids.filter((x) => x === id).length }))) : null
})

// ── the codex: How to play ───────────────────────────────────────────────────────────────────────

// The floor's price scale (run.js floorPrice) as the help tells it: every price, floor by floor, and the one now.
const times = (x) => `×${+x.toFixed(2)}`
export const priceScaleText = (run) => `every price is its floor-1 price ${[1, 2, 3, 4].map((f) => times(floorPrice(f))).join(', ')} on floors 1–4, and +${TUNING.essence.perFloor} a floor deeper` +
  (run ? ` (here, ${times(floorPrice(run.state.floor))})` : '')

// What each word's rule says beyond its one line, for the glossary's "more"; `run`, when one is in play, adds
// where it stands now.
const WORD_MORE = {
  piece: () => `Command sets how many pieces you field (at most ${TUNING.army.board}); the rest of your souls wait in the ossuary. A 2×2 piece (a fused kind, or a kind with a Colossus tier) needs four open cells and plugs a two-wide breach alone. The Monarch is a piece too: it stands on the seat the camp marks with a crown, never moves and never strikes (though a foe that comes beside it halts there), and nothing else may stand there.`,
  stack: () => 'Drag a soul of the same kind onto a piece to add a body; split one off from its panel. A stack covers its footprint and nothing more, and a blow that hits it hits the whole pool once: the reason not to stack everything. It counts once toward synergies.',
  ring: () => 'Measured from the footprint: the ring 1 of a 2×2 piece is the twelve tiles around it. A piece fights what its blows reach within it: a ranged blow its range, a melee blow the tiles beside it (two tiles for a long-armed kind, without stepping), or as far as the blow says; a tier that widens the ring lengthens no arm. Your rings are what the foes see you by: a foe walking into a ring of yours that can strike it halts there only once it can strike something of yours from where it stands (a shooter, a piece of yours in its reach; a melee foe, the piece in its way, the Monarch, or a piece beside it that struck it), and otherwise walks on. A ring holds a foe only as far as the piece\'s blows that need no condition reach: where a blow with a condition reaches farther, it strikes there once the condition holds, but no foe halts there for it, and the shading and the stop line stop short of it too. Within the Monarch\'s ring of 1 every foe halts. Yours aim at the foe in the ring furthest along its road, the centre lane first on a tie. A melee blow from the ground never reaches up to a flyer, so a melee ring on the ground never holds one (a flyer\'s melee meets a flyer in the air), and a ring holding only flyers it cannot strike reads as empty (a piece standing in a flyer\'s way still holds it there, as any blocker does). Rings reach through walls. In prep the road tiles are shaded by how many of your rings cover them, and a bar marks the stop line, where a walker first comes into them: the earliest it can halt there, not where it will.',
  road: () => 'Before every battle the board floods out from the Monarch through every open tile: each tile\'s arrow points to its neighbour nearest the Monarch. Two foes on one tile always walk the same way. A foe walks, doing nothing else, until it halts where it can hit back: in one of your rings with something of yours its blows reach, or with its next tile held (a piece of yours, the seat, or a foe ahead of it that has stopped; behind one still on the move it only waits). Halted, it fights: its ranged blows to their range, never past its own ring, so one queued behind a stopped one shoots over it; its melee only what blocks its way, the Monarch, and a piece beside it that struck it, so a melee foe walks on through your rings until one of those is there. Every foe on the ground walks these arrows. Some kinds Fly instead, straight over the walls but never through your pieces: one in a flyer\'s way holds it there. You learn which by meeting them.',
  wave: () => `${ENEMY_TEXT.waves} ${ENEMY_TEXT.entry}`,
  // Arise, and Hollow Court (offered only once Arise is held), only while the run holds the relic (DESIGN §4).
  shadow: (run) => `${run && ariseHeld(run.state) ? 'The Arise relic raises foes slain near the Monarch; ' : ''}Undead 8 raises every foe slain. A shadow of yours rises on the free tile nearest the Monarch, never where it fell, so the dead never block a road, and holds there. A shadow of a flying kind flies. Shadows count toward your synergies and are gone after the battle.` +
    (run && holds(run.state, 'reap') ? ' Under Hollow Court, those standing at a win pay their essence again.' : ''),
  essence: (run) => `Each foe slain pays ${TUNING.essence.perTier} × its tier, whatever its count or level, into one purse. It buys only tiers, fusions (${TUNING.essence.fuse} × the result's tier) and one recruit after a win (${TUNING.essence.recruit} × its tier, more for a higher level), and ${priceScaleText(run)}: what a floor pays is worth less on the next. Nothing is bought for the Monarch, and no level is bought: a kind's level is its tiers'.`,
  tier: (run) => `Two tracks a kind, four tiers each (${TUNING.essence.tier.join(' / ')} essence on floor 1; ${priceScaleText(run)}). The first track you take may reach IV; the other then stops at II. A tier IV is a rule: a new ability, an aura, more ring, or Colossus, which grows every piece of the kind to 2×2 (one that no longer fits where it stands goes to the ossuary). A kind's level is its tiers': ${TUNING.level.base} + ${TUNING.level.perTier} × the tiers it holds on both tracks, rounded down; every soul of it rises with each tier, and a recruit joins at it.`,
  fusion: () => `It takes exactly the bodies the recipe names, from pieces on the field or in the ossuary (a bigger stack gives what is asked and keeps the rest), costs ${TUNING.essence.fuse} essence × the result's tier on floor 1 (× the floor's price scale, as every price), and gives one piece of the fused kind in the ossuary, to be placed. The result joins its kind with its tiers, at its level, never below the highest level of the kinds that went into it. Select a piece for the recipes its kind is part of; the Codex's Fusions lists them all.`,
  command: (run) => `${TUNING.party.field} to begin. Nothing is bought for the Monarch: only Command relics raise it, every copy in full (${giversOf('command').join(', ')}); the rarer, the cleaner. A won elite's relics always hold one. The field stops at ${TUNING.army.board} pieces however high it goes.` + (run ? ` Now: ${fieldRule(run)}.` : ''),
  synergy: () => `Steps stack: Undead 6 holds Undead 2 and 4 too. Ranger's are at 3, 6 and 8, and every 8 is a rule that changes what happens. A fused piece counts once, with its own kin and role. ${COUNT_NOTE}`,
  relic: (run) => `Four tiers: ${RELIC_TIERS.map((x) => x.name).join(', ')}. Reliquaries and won elites offer Common to Rare, free, deeper floors the rarer; a won elite's always hold a Command relic. From floor ${R.legendary.fromFloor} both also offer ${R.legendary.offer} Legendaries, rules that rewrite the game${run && ariseHeld(run.state) ? ': Arise, the Monarch\'s raising of the dead, is one' : ''}. A reliquary is one pick in all: a relic, a Legendary or a free tier. A relic you hold may come again: copies stack with no cap, and every copy applies in full. A trigger fires in battle for your side only, once a copy, and its name flashes over the one it fired for.`
}

// The glossary: the twelve words, the foes' ways, then the statuses. { name, entries: [{ name, line, more?, sys? }] }
function glossary (run) {
  const entry = (id) => ({ name: KEYWORDS[id].name, sys: KEYWORDS[id].sys, line: KEYWORDS[id].line, more: WORD_MORE[id]?.(run) ?? null })
  const group = (g) => Object.keys(KEYWORDS).filter((id) => KEYWORDS[id].group === g).map(entry)
  return ['Words', 'Behaviours', 'Statuses'].map((name) => ({ name, entries: group(name) }))
}

// The fusions (DESIGN §2.6): every recipe, public from the start, each with its result's card, its parts and its
// price; with a run in play, how many of each part's bodies you hold, and whether it can be made now.
function fusionsView (run = null) {
  const held = (kind) => run ? souls(run.state.party).filter((u) => u.id === kind).reduce((n, u) => n + u.count, 0) : null
  return h('div', { class: 'help-view fusions' },
    h('p', { class: 'dim' }, 'Every recipe, from the start: they are the plan. Select a piece on the Field for the ones its kind is part of, and fuse there.'),
    h('div', { class: 'fusion-list' }, FUSION_LIST.map((f) => {
      const d = unitDef(f.result)
      const kind = run?.state.kinds[f.result]
      const ready = !!run && canFuse(run, f.id)
      return h('div', { class: 'fusion' + (ready ? ' ready' : '') },
        h('div', { class: 'fusion-head' },
          h('span', { class: 'beast-port' }, portrait(f.result, 56)),
          h('div', { class: 'beast-text' },
            h('b', null, f.name),
            h('div', { class: 'dim small' }, `${KIN[d.kin]?.name ?? ''} ${ROLES[d.role].name} · tier ${d.tier}${(d.size ?? 1) > 1 ? ' · 2×2' : ''} · ${run ? fuseCost(run, f.id) : TUNING.essence.fuse * d.tier} essence`),
            h('div', { class: 'small' }, f.desc),
            h('div', { class: 'fusion-parts small' }, Object.entries(f.needs).map(([k, n]) => {
              const have = held(k)
              return h('span', { class: 'fusion-part' + (have === null ? '' : have >= n ? ' met' : ' short') }, portrait(k, 26), `${unitDef(k).name} ×${n}`, have !== null && h('span', { class: 'dim' }, ` (${have} held)`))
            })),
            ready && h('div', { class: 'small fusion-ready' }, 'You can make it now: select one of its parts on the Field.'))),
        unitCard({ id: f.result, lvl: kind?.lvl ?? 1, tracks: kind?.tracks ?? [0, 0] }, { open: true }))
    })))
}

// The codex, one view at a time behind four tabs: Basics (the primer and what your run holds now), Glossary
// (every word, filtered as you type in the search box over them), Fusions (every recipe) and Bestiary (the foe
// kinds met). An entry is
// its word and one line; one with more to its rule is a fold. The search box takes the keys: Esc closes, and H
// or ? close while it is empty (`onClose`: the dialog's; none inside the Codex tab). `run`: the run in play, if
// any.
export function codexView (run = null, { onClose = null } = {}) {
  const s = run?.state
  const none = h('p', { class: 'dim gl-none', hidden: true }, 'Nothing matches.')
  const sections = glossary(run).map((g) => {
    const items = g.entries.map((e) => {
      const row = h('div', { class: 'gl-row' },
        h('b', { class: 'gl-term', style: e.sys ? `--k:var(--c-${e.sys})` : null }, e.name), ' ', h('span', { class: 'gl-line' }, e.line))
      const el = e.more
        ? h('details', { class: 'gl-entry gl-more' }, h('summary', null, row), h('p', null, e.more))
        : h('div', { class: 'gl-entry' }, row)
      return { el, det: e.more ? el : null, head: `${g.name} ${e.name} ${e.line}`.toLowerCase(), more: (e.more ?? '').toLowerCase() }
    })
    const n = h('span', { class: 'gl-n' }, g.entries.length)
    return { items, n, el: h('details', { class: 'gl-sec', open: g.name === 'Words' }, h('summary', null, g.name, n), h('div', { class: 'gl-items' }, items.map((x) => x.el))) }
  })
  function filter () {
    const q = search.value.trim().toLowerCase()
    if (q) view('glossary')
    let shown = 0
    for (const sec of sections) {
      let hits = 0
      for (const x of sec.items) {
        const line = !q || x.head.includes(q)
        const more = !!q && !line && x.more.includes(q)
        x.el.hidden = !(line || more)
        if (x.det) x.det.open = more
        hits += line || more
      }
      sec.n.textContent = hits
      sec.el.hidden = hits === 0
      if (q) sec.el.open = hits > 0
      shown += hits > 0
    }
    none.hidden = shown > 0
  }
  const search = h('input', {
    type: 'search', class: 'gl-search', placeholder: 'Search: ring, fusion, Burning…', 'aria-label': 'Search the rules', spellcheck: 'false',
    oninput: filter,
    onkeydown: (e) => {
      if (!onClose || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape' || (['h', 'H', '?'].includes(e.key) && !search.value)) { e.preventDefault(); onClose() }
    }
  })
  const tipsBack = h('button', {
    class: 'small ghost', onclick: () => { for (const k of ['select', 'place', 'fuse']) prefs.set('did:' + k, '0'); tipsBack.textContent = 'The tips are back on the Field' }
  }, 'Show the tips again')
  const basics = h('div', { class: 'help-view basics' },
    h('p', { class: 'lede' }, `Slay the Hollow Sovereign at the bottom of floor ${TUNING.run.floors} to clear the run, then descend as deep as you dare.`),
    h('ol', { class: 'primer' },
      h('li', null, 'You are the Monarch. You never strike, and ', h('b', { class: 'warn' }, 'if you fall, the run ends'), '.'),
      h('li', null, 'Foes walk the ', kw('road', 'roads'), ', the arrows on the board, to your seat, the crowned cell, and halt to fight only where they can hit back: in one of your ', kw('ring', 'rings'), ' with something of yours in their reach, beside the Monarch, or with the way ahead held. Some ', kw('fly'), ' over the walls.'),
      h('li', null, 'Place your souls in the camp: each ', kw('piece'), ' fights whatever its blows reach in its ', kw('ring'), ' from where you put it (its melee only beside it, two tiles for a long arm), and ', h('b', null, 'never moves'), '. The shading on the roads is how many rings cover them; the blue bars, the stop line, are where a foe first comes into them: the earliest it can halt.'),
      h('li', null, `Begin, and the battle plays out alone. Wounds carry: ${WOUNDS_TEXT}.`),
      h('li', null, 'Spend ', kw('essence'), ' on your kinds\' ', kw('tier', 'tiers'), ' (each raises the kind\'s level) and on ', kw('fusion', 'fusions'), '; after a win, recruit one of the slain. The Monarch grows only by ', kw('relic', 'relics'), ': its HP and its ', kw('command'), '.')),
    h('p', { class: 'gestures' }, h('b', null, say('Mouse', 'Touch')), ': ', say('click', 'tap'), ' a piece to select it; drag a soul from the ossuary onto the camp to place it, onto a piece of its kind to ', kw('stack'), ' it, onto another piece to swap them; ',
      say('click', 'tap'), ' empty ground to go back to the Monarch. A selected piece\'s panel holds its kind\'s upgrades and Fuse. ', say('Hover', 'Long-press'), ' anything for what it is.'),
    s && h('div', { class: 'gl-run' },
      h('span', null, `The Monarch ${monarchOf(s).hp}/${monarchOf(s).maxHp} HP · Command ${commandOf(s)}${ariseHeld(s) ? ` · Arise ×${relicCount(s, 'arise')}: tier ≤ ${ariseOf(s).tier} within ${ariseOf(s).domain} tiles, ${ariseOf(s).raises} a battle` : ''}`),
      h('span', null, `Souls ${souls(s.party).length}/${rosterCap(run)} · ${fielded(souls(s.party)).length}/${fieldCap(run)} on the field · ${inOssuary(souls(s.party)).length} in the ossuary`),
      h('span', { class: 'gl-relics' }, kw('relic', 'Relics'), s.relics.length ? relicsByTier(s.relics, ({ id, n }) => h('span', { class: `relic rt-${relicTier(id)}`, tip: () => relicTip(id, run) }, relicDef(id).name, n > 1 && h('span', { class: 'relic-n' }, `×${n}`))) : ' none'),
      depthOf(s.floor) > 0 && h('span', null, DEEP_TEXT.now(s.floor)),
      holds(s, 'unhealable') && h('span', { class: 'warn' }, 'Court of Bone: nothing heals the Monarch.')),
    h('div', { class: 'help-foot' },
      h('p', { class: 'dim' }, say([h('kbd', null, 'H'), ' or ', h('kbd', null, '?'), ' opens How to play anywhere; ', h('kbd', null, 'Esc'), ' closes it.'],
        'The ? button opens How to play from any screen.')),
      tipsBack))
  const gloss = h('div', { class: 'help-view glossary' }, sections.map((x) => x.el), none)
  const tabs = h('div', { class: 'tabs help-tabs', role: 'tablist' })
  const body = h('div', { class: 'help-body' })
  let on = null
  function view (id) {
    if (id === on) return
    on = id
    fill(tabs, [['basics', 'Basics'], ['glossary', 'Glossary'], ['fusions', 'Fusions'], ['bestiary', 'Bestiary']].map(([k, name]) =>
      h('button', { class: 'tab' + (k === id ? ' on' : ''), role: 'tab', 'aria-selected': k === id ? 'true' : 'false', 'data-tab': k, onclick: () => view(k) }, name)))
    fill(body, id === 'basics' ? basics : id === 'glossary' ? gloss : id === 'fusions' ? fusionsView(run) : bestiaryView())
    body.scrollTop = 0
  }
  view('basics')
  return h('div', { class: 'codex' },
    h('div', { class: 'help-head' },
      h('h2', { class: 'modal-title' }, onClose ? 'How to play' : 'Codex'),
      h('label', { class: 'gl-bar' }, icon('search', 20), search),
      onClose && h('button', { class: 'icon-btn close', 'aria-label': 'Close', onclick: onClose, tip: () => 'Close (Esc)' }, icon('close', 22))),
    tabs,
    body)
}

// The bestiary: every foe kind, the ones met with their reach (ringText), their way on the roads and their lore;
// the rest a shade, until met.
function bestiaryView () {
  const met = FOE_KINDS.filter((d) => bestiary.has(d.id))
  return h('div', { class: 'help-view bestiary' },
    h('p', { class: 'dim' }, `Met ${met.length} of ${FOE_KINDS.length}. How far a kind strikes and its way on the roads are told once you have fought it, here and on its card.`),
    h('div', { class: 'beasts' }, FOE_KINDS.map((d) => {
      const known = bestiary.has(d.id)
      const u = { id: d.id, lvl: 1 }
      return h('div', { class: 'beast' + (known ? '' : ' unknown') },
        h('span', { class: 'beast-port' }, portrait(d.id, 48)),
        h('div', { class: 'beast-text' },
          h('b', null, known ? d.name : '???'),
          h('div', { class: 'dim small' }, known ? `${KIN[d.kin]?.name ?? ''} ${ROLES[d.role].name} · tier ${d.tier}` : 'Not met yet'),
          known && h('div', { class: 'small' }, ringText(u, true)),
          known && d.flavour && h('div', { class: 'flavour small' }, d.flavour)))
    })))
}

// How to play as a dialog over any screen (H, ?, the help buttons).
export function helpOverlay (onClose, run = null) {
  const el = h('div', { class: 'overlay', onclick: (e) => { if (e.target === el) onClose() } },
    h('div', { class: 'modal help', role: 'dialog', 'aria-label': 'How to play' }, codexView(run, { onClose })))
  return el
}
